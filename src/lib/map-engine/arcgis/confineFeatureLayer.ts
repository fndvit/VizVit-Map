/**
 * @module map-engine/arcgis/confineFeatureLayer
 * Confines an ArcGIS `FeatureLayer` (URL-backed or client-side, including a
 * `GeoJSONLayer`) to a region, so it draws — and, for a feature service,
 * fetches — only the features whose anchor lies inside.
 *
 * How: one query per region box (two when the region crosses the
 * antimeridian), read with `pageThrough`, asking only for the object id and
 * the geometry; the exact polygon test on each feature's anchor
 * (`anchorOfArcgis`: a point, a line's middle vertex, a polygon's centroid);
 * then the kept ids are pinned as an `objectid IN (…)` `definitionExpression`.
 * From then on every request the layer makes carries that clause, so a
 * feature service only ever returns the region's features.
 *
 * **One confinement per layer** ({@link confinementOf}) owns everything a
 * layer's confinement needs to stay right across calls:
 *
 * - the layer's own expression (its *original*), AND-ed with every id list
 *   and restored on release — re-read if the host changes the expression
 *   while the layer is confined;
 * - a **query clone** of the layer carrying only the original expression, so
 *   looking up a new region never touches the live layer (resetting the live
 *   expression to query would make a layer on the map refetch the world);
 * - a **generation**: a call superseded by a later one resolves without
 *   applying, so two quick calls always end on the later region.
 *
 * Why ids and not the polygon: a region outline can be megabytes, and a
 * spatial filter would travel with every tile request; a box is four numbers,
 * sent once. Why not `FeatureLayerView.filter`: the layer would still download
 * the whole world, and a 3D view's labels do not reliably honour it.
 *
 * Geometry is generalized for the lookup only on a **server-backed** layer
 * (`type: 'feature'`) of lines or polygons, where the full geometry is a
 * download; a client-side layer is tested on its own geometry, so it keeps
 * exactly the features every other provider keeps for the same data.
 *
 * Limits: the ids are pinned when the lookup runs — a republished service
 * with new object ids needs another call; and the `IN` list travels with every
 * request (ArcGIS switches to POST past its URL limit), which suits regions of
 * up to a few thousand features.
 *
 * The layer is typed structurally ({@link ConfinableLayer}), so nothing here
 * imports `@arcgis/core` and a test passes a plain object.
 */

import { anchorOfArcgis } from '../../geo/anchor.js';
import { regionBoxes, type RegionShape } from '../../geo/region.js';
import { pageThrough } from './pageThrough.js';

/** An ArcGIS JSON geometry, as far as the anchor rule reads it. */
type ArcgisJsonGeometry = Parameters<typeof anchorOfArcgis>[0];

/** The part of a loaded `FeatureLayer` / `GeoJSONLayer` this module reads and writes. */
export interface ConfinableLayer {
	/** Name of the layer's object id field. */
	readonly objectIdField: string;
	/** The `where` clause the layer draws (and, URL-backed, fetches) with. */
	definitionExpression?: string | null;
	/** `'point' | 'multipoint' | 'polyline' | 'polygon'`; unset reads as point. */
	readonly geometryType?: string;
	/** ArcGIS layer type: `'feature'` for a server-backed layer, `'geojson'`, … */
	readonly type?: string;
	/** What the layer's service allows per query. */
	readonly capabilities?: { query?: { maxRecordCount?: number; supportsPagination?: boolean } };
	/**
	 * Runs a query against the layer, which applies its own
	 * `definitionExpression` (ArcGIS autocasts the property bag).
	 *
	 * @param query - The query properties.
	 * @returns The features, and whether the service held some back.
	 */
	queryFeatures(query: Record<string, unknown>): Promise<{
		features?: { attributes: Record<string, unknown>; geometry?: ArcgisJsonGeometry }[];
		exceededTransferLimit?: boolean;
	}>;
	/**
	 * A copy of the layer (ArcGIS `Layer.clone`), used to query without
	 * touching the live one. Without it, a lookup briefly resets the live
	 * expression instead.
	 *
	 * @returns The copy — not yet loaded: its object id field, geometry type
	 *   and capabilities are empty until {@link load} resolves.
	 */
	clone?(): ConfinableLayer;
	/**
	 * Loads the layer's service description (ArcGIS `Layer.load`).
	 *
	 * @returns Resolves once the layer's fields and capabilities are known.
	 */
	load?(): Promise<unknown>;
}

/**
 * The object ids of a layer's features whose anchor is inside a region. The
 * layer's own expression applies: pass a layer carrying only the filter you
 * want searched.
 *
 * @param layer - A layer to query.
 * @param region - The region.
 * @returns The ids, possibly none; in query order, without duplicates.
 * @throws When the service caps the results and cannot page past the cap —
 *   a partial id list would silently drop features.
 */
export async function featureIdsInRegion(
	layer: ConfinableLayer,
	region: RegionShape
): Promise<number[]> {
	const oidField = layer.objectIdField;
	const isPoint = !layer.geometryType || layer.geometryType === 'point';
	const generalizes = !isPoint && layer.type === 'feature';
	const ids = new Set<number>();
	for (const [xmin, ymin, xmax, ymax] of regionBoxes(region)) {
		const { features, complete } = await pageThrough(
			(start, num) =>
				layer.queryFeatures({
					where: '1=1',
					geometry: { type: 'extent', xmin, ymin, xmax, ymax, spatialReference: { wkid: 4326 } },
					spatialRelationship: 'intersects',
					outFields: [oidField],
					orderByFields: [oidField],
					returnGeometry: true,
					outSpatialReference: { wkid: 4326 },
					// Only enough geometry to place an anchor, where it is a download.
					...(generalizes ? { maxAllowableOffset: Math.max(xmax - xmin, ymax - ymin) / 500 } : {}),
					start,
					num
				}),
			{
				pageSize: layer.capabilities?.query?.maxRecordCount ?? 1000,
				supportsPagination: layer.capabilities?.query?.supportsPagination
			}
		);
		if (!complete) {
			throw new Error('The service caps its results and cannot page; the region is incomplete');
		}
		for (const feature of features) {
			const anchor = anchorOfArcgis(feature.geometry);
			const id = Number(feature.attributes[oidField]);
			if (anchor && Number.isFinite(id) && region.contains(anchor[0], anchor[1])) ids.add(id);
		}
	}
	return [...ids];
}

/** One layer's confinement: the region it draws, and the call that changes it. */
export interface FeatureLayerConfinement {
	/** The region the layer currently draws, or `null` when unconfined. */
	readonly region: RegionShape | null;
	/**
	 * Confines the layer to a region, or releases it with `null`.
	 *
	 * @param region - The region, or `null`.
	 * @returns How many features the layer now draws from the region
	 *   (`Infinity` once released; `0` means the region holds none, and a
	 *   caller may drop the layer) — or `null` when a later call superseded
	 *   this one, which then applied nothing.
	 * @throws What the lookup throws; the layer keeps its previous region.
	 */
	set(region: RegionShape | null): Promise<number | null>;
}

/** Each layer's confinement, created on first use. */
const confinements = new WeakMap<ConfinableLayer, FeatureLayerConfinement>();

/**
 * The confinement of a layer — the same object on every call for that layer.
 *
 * @param layer - A loaded `FeatureLayer` / `GeoJSONLayer`.
 * @param idsIn - Ids inside a region, given a layer to query. Default:
 *   {@link featureIdsInRegion}.
 * @returns The layer's confinement.
 */
export function confinementOf(
	layer: ConfinableLayer,
	idsIn: (layer: ConfinableLayer, region: RegionShape) => Promise<number[]> = featureIdsInRegion
): FeatureLayerConfinement {
	const existing = confinements.get(layer);
	if (existing) return existing;

	let region: RegionShape | null = null;
	/** The layer's own expression, AND-ed with every id list. */
	let original: string | null = layer.definitionExpression ?? null;
	/** The expression this confinement last wrote, to notice a host's edit. */
	let written: string | null | undefined;
	let generation = 0;
	let queryLayer: ConfinableLayer | null = null;

	/**
	 * Adopts a host's own edit of the expression as the new original: any
	 * expression while unconfined, or one other than this confinement wrote.
	 */
	function syncOriginal(): void {
		const current = layer.definitionExpression ?? null;
		if ((written === undefined || current !== written) && current !== original) {
			original = current;
			queryLayer = null;
		}
	}

	/** Looks a region up without touching the live layer when it can. */
	async function lookUp(next: RegionShape): Promise<number[]> {
		if (layer.clone) {
			if (!queryLayer) {
				queryLayer = layer.clone();
				queryLayer.definitionExpression = original;
			}
			// A clone starts unloaded: until it loads, its object id field is
			// empty, and the lookup would ask for no fields and pin `IN (NaN)`.
			await queryLayer.load?.();
			return idsIn(queryLayer, next);
		}
		// No clone: the layer's own queries honour its expression, so search
		// with the original one, or a second region would only find the first's.
		layer.definitionExpression = original;
		written = original;
		return idsIn(layer, next);
	}

	const confinement: FeatureLayerConfinement = {
		get region() {
			return region;
		},
		async set(next) {
			syncOriginal();
			const mine = ++generation;
			if (next === null) {
				layer.definitionExpression = original;
				written = undefined;
				region = null;
				return Infinity;
			}
			const ids = await lookUp(next);
			if (mine !== generation) return null;
			const inRegion = ids.length ? `${layer.objectIdField} IN (${ids.join(',')})` : '1=0';
			const expression = original ? `(${original}) AND ${inRegion}` : inRegion;
			layer.definitionExpression = expression;
			written = expression;
			region = next;
			return ids.length;
		}
	};
	confinements.set(layer, confinement);
	return confinement;
}

/**
 * Confines a loaded layer to a region, or releases it: shorthand for
 * `confinementOf(layer).set(region)`.
 *
 * @param layer - A loaded `FeatureLayer` / `GeoJSONLayer`.
 * @param region - The region, or `null` to release.
 * @returns See {@link FeatureLayerConfinement.set}.
 */
export function confineFeatureLayer(
	layer: ConfinableLayer,
	region: RegionShape | null
): Promise<number | null> {
	return confinementOf(layer).set(region);
}
