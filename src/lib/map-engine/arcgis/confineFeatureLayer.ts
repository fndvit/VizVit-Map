/**
 * @module map-engine/arcgis/confineFeatureLayer
 * Confines an ArcGIS `FeatureLayer` (URL-backed or client-side, including a
 * `GeoJSONLayer`) to a region, so it draws — and, for a feature service,
 * fetches — only the features whose anchor lies inside.
 *
 * How: one query per region box (two when the region crosses the
 * antimeridian), paged past the service's record limit, asking only for the
 * object id and the geometry; the exact polygon test on each feature's anchor
 * (`anchorOfArcgis`: a point, a line's middle vertex, a polygon's centroid);
 * then the kept ids are pinned as an `objectid IN (…)` `definitionExpression`.
 * From then on every request the layer makes carries that clause, so a
 * feature service only ever returns the region's features.
 *
 * Why ids and not the polygon: a region outline can be megabytes, and a
 * spatial filter would travel with every tile request; a box is four numbers,
 * sent once. Why not `FeatureLayerView.filter`: the layer would still download
 * the whole world, and a 3D view's labels do not reliably honour it.
 *
 * Limits: the ids are pinned when this runs — a republished service with new
 * object ids needs another call; and the `IN` list travels with every request
 * (ArcGIS switches to POST past its URL limit), which suits regions of up to a
 * few thousand features.
 *
 * The layer is typed structurally ({@link ConfinableLayer}), so nothing here
 * imports `@arcgis/core` and a test passes a plain object.
 */

import { anchorOfArcgis } from '../../geo/anchor.js';
import { regionBoxes, type RegionShape } from '../../geo/region.js';

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
	/** Present on a layer whose service caps the records per query. */
	readonly capabilities?: { query?: { maxRecordCount?: number } };
	/**
	 * Runs a query against the layer (ArcGIS autocasts the property bag).
	 *
	 * @param query - The query properties.
	 * @returns The features, and whether the service held some back.
	 */
	queryFeatures(query: Record<string, unknown>): Promise<{
		features?: { attributes: Record<string, unknown>; geometry?: ArcgisJsonGeometry }[];
		exceededTransferLimit?: boolean;
	}>;
}

/** The expression each layer had before its first confinement, to restore on `null`. */
const originals = new WeakMap<ConfinableLayer, string | null>();

/**
 * The object ids of a layer's features whose anchor is inside a region.
 *
 * @param layer - A loaded layer.
 * @param region - The region.
 * @returns The ids, possibly none; in query order, without duplicates.
 */
export async function featureIdsInRegion(
	layer: ConfinableLayer,
	region: RegionShape
): Promise<number[]> {
	const oidField = layer.objectIdField;
	const pageSize = layer.capabilities?.query?.maxRecordCount ?? 1000;
	const isPoint = !layer.geometryType || layer.geometryType === 'point';
	const ids = new Set<number>();
	for (const [xmin, ymin, xmax, ymax] of regionBoxes(region)) {
		// Lines and polygons only need enough geometry to place an anchor.
		const generalize = isPoint
			? {}
			: { maxAllowableOffset: Math.max(xmax - xmin, ymax - ymin) / 500 };
		for (let start = 0; ; start += pageSize) {
			const result = await layer.queryFeatures({
				where: '1=1',
				geometry: { type: 'extent', xmin, ymin, xmax, ymax, spatialReference: { wkid: 4326 } },
				spatialRelationship: 'intersects',
				outFields: [oidField],
				returnGeometry: true,
				outSpatialReference: { wkid: 4326 },
				...generalize,
				start,
				num: pageSize
			});
			for (const feature of result.features ?? []) {
				const anchor = anchorOfArcgis(feature.geometry);
				if (anchor && region.contains(anchor[0], anchor[1])) {
					ids.add(Number(feature.attributes[oidField]));
				}
			}
			if (!result.exceededTransferLimit) break;
		}
	}
	return [...ids];
}

/**
 * Confines a loaded layer to a region, or releases it.
 *
 * The layer's own `definitionExpression` is kept and AND-ed with the id list;
 * confining again replaces the previous region, and `null` restores the
 * expression the layer had before its first confinement.
 *
 * @param layer - A loaded `FeatureLayer` / `GeoJSONLayer`.
 * @param region - The region, or `null` to release.
 * @param idsIn - Ids inside the region. Default: {@link featureIdsInRegion}.
 * @returns How many features the layer now draws from the region (`Infinity`
 *   when released). `0` means the region holds none: a caller may drop the layer.
 */
export async function confineFeatureLayer(
	layer: ConfinableLayer,
	region: RegionShape | null,
	idsIn: (layer: ConfinableLayer, region: RegionShape) => Promise<number[]> = featureIdsInRegion
): Promise<number> {
	if (!originals.has(layer)) originals.set(layer, layer.definitionExpression ?? null);
	const original = originals.get(layer) ?? null;
	if (region === null) {
		layer.definitionExpression = original;
		originals.delete(layer);
		return Infinity;
	}
	// A layer's own queries honour its expression: search with the original one,
	// or a second region would only ever find the first region's features.
	layer.definitionExpression = original;
	const ids = await idsIn(layer, region);
	const inRegion = ids.length ? `${layer.objectIdField} IN (${ids.join(',')})` : '1=0';
	layer.definitionExpression = original ? `(${original}) AND ${inRegion}` : inRegion;
	return ids.length;
}
