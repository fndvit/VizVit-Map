/**
 * @module map-engine/maplibre/layers
 * The MapLibre implementations of the provider's two layer kinds.
 *
 * MapLibre keeps sources and layers in the *style*, and `setStyle` throws them
 * away — so every handle knows how to {@link MaplibreLayer.reattach} itself, and
 * the provider replays them after a basemap swap.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- the MapLibre map is loaded dynamically */

import type {
	GeoJsonLayerHandle,
	GeoJsonLayerSpec,
	GeoJsonStyle,
	LayerHandle,
	Placement,
	PointItem,
	PointLayerHandle,
	PointLayerSpec,
	PointSymbol,
	ScreenPoint
} from '../provider.js';
import { zoomForScale } from '../scale.js';
import type { RegionShape } from '../../geo/region.js';
import { anchorOf, type GeometryLike } from '../../geo/anchor.js';
import { ensureIcon } from './icons.js';

/** Default hit-test tolerance in pixels — markers are small, so the box helps. */
const DEFAULT_HIT_TOLERANCE = 6;

/** A layer handle that can rebuild itself into a freshly-applied style. */
export interface MaplibreLayer extends LayerHandle {
	/** Re-adds this layer's source and layers after `setStyle` cleared them. */
	reattach(): void;
}

/**
 * Converts an ArcGIS-convention scale window to a MapLibre zoom range.
 *
 * ArcGIS names the COARSEST scale `minScale` (a large denominator = zoomed out)
 * and `0` means unbounded, so the two ends swap on the way to zoom levels.
 *
 * @param minScale - Coarsest scale at which the layer draws (`0` = unbounded).
 * @param maxScale - Finest scale at which the layer draws (`0` = unbounded).
 * @param latitude - Latitude to convert at (scale is latitude-dependent).
 * @returns `[minzoom, maxzoom]` for `setLayerZoomRange`.
 */
export function zoomRangeForScaleWindow(
	minScale: number,
	maxScale: number,
	latitude = 0
): [number | null, number | null] {
	return [
		minScale > 0 ? zoomForScale(minScale, latitude) : null,
		maxScale > 0 ? zoomForScale(maxScale, latitude) : null
	];
}

/** Shared bookkeeping for both layer kinds. */
function baseLayer(
	map: any,
	id: string,
	layerIds: () => string[],
	spec: { placement?: Placement; visible?: boolean; opacity?: number },
	opacityProps: () => { layer: string; prop: string }[],
	onRemove: () => void
) {
	let visible = spec.visible ?? true;
	let opacity = spec.opacity ?? 1;
	let placement: Placement = spec.placement ?? 'draped';
	let scaleRange: [number, number] = [0, 0];

	const apply = {
		visibility() {
			for (const l of layerIds()) {
				if (map.getLayer(l)) {
					map.setLayoutProperty(l, 'visibility', visible ? 'visible' : 'none');
				}
			}
		},
		opacity() {
			for (const { layer, prop } of opacityProps()) {
				if (map.getLayer(layer)) map.setPaintProperty(layer, prop, opacity);
			}
		},
		zoomRange() {
			const [minzoom, maxzoom] = zoomRangeForScaleWindow(
				scaleRange[0],
				scaleRange[1],
				map.getCenter?.()?.lat ?? 0
			);
			for (const l of layerIds()) {
				if (map.getLayer(l)) map.setLayerZoomRange(l, minzoom, maxzoom);
			}
		}
	};

	return {
		id,
		applyAll() {
			apply.visibility();
			apply.opacity();
			apply.zoomRange();
		},
		setVisible(next: boolean) {
			visible = next;
			apply.visibility();
		},
		getVisible: () => visible,
		setOpacity(next: number) {
			opacity = next;
			apply.opacity();
		},
		getOpacity: () => opacity,
		setScaleRange(minScale: number, maxScale: number) {
			scaleRange = [minScale, maxScale];
			apply.zoomRange();
		},
		setPlacement(next: Placement) {
			// MapLibre has no draped/floating distinction — z-order is layer order.
			// Recorded so the handle reports what the caller asked for.
			placement = next;
		},
		getPlacement: () => placement,
		remove: onRemove
	};
}

/**
 * Creates a MapLibre-backed points layer: one GeoJSON source and one symbol
 * layer, with a generated icon per distinct {@link PointSymbol}.
 *
 * @param map - The live MapLibre map.
 * @param spec - The neutral layer spec.
 * @returns The neutral handle, already attached to the style.
 */
export function createPointLayer(map: any, spec: PointLayerSpec): PointLayerHandle & MaplibreLayer {
	const sourceId = `pts:${spec.id}`;
	const layerId = `pts:${spec.id}:symbols`;
	let items: PointItem[] = [...(spec.items ?? [])];
	let region: RegionShape | null = null;

	/** The GeoJSON the source carries — the items inside the region — with an icon per item. */
	function collection() {
		const drawn = region ? items.filter((item) => region!.contains(item.lng, item.lat)) : items;
		return {
			type: 'FeatureCollection' as const,
			features: drawn.map((item) => ({
				type: 'Feature' as const,
				id: item.id,
				geometry: { type: 'Point' as const, coordinates: [item.lng, item.lat] },
				properties: {
					id: item.id,
					hittable: item.hittable !== false,
					iconId: ensureIcon(map, item.symbol)
				}
			}))
		};
	}

	function attach() {
		if (!map.getSource(sourceId)) {
			map.addSource(sourceId, { type: 'geojson', data: collection() });
		}
		if (!map.getLayer(layerId)) {
			map.addLayer({
				id: layerId,
				type: 'symbol',
				source: sourceId,
				layout: {
					'icon-image': ['get', 'iconId'],
					'icon-allow-overlap': true,
					'icon-ignore-placement': true
				}
			});
		}
	}

	attach();

	const base = baseLayer(
		map,
		spec.id,
		() => [layerId],
		spec,
		() => [{ layer: layerId, prop: 'icon-opacity' }],
		() => {
			if (map.getLayer(layerId)) map.removeLayer(layerId);
			if (map.getSource(sourceId)) map.removeSource(sourceId);
		}
	);
	base.applyAll();

	return {
		...base,
		reattach() {
			attach();
			base.applyAll();
		},
		set(next: readonly PointItem[]) {
			items = [...next];
			map.getSource(sourceId)?.setData(collection());
		},
		async setRegion(next: RegionShape | null) {
			region = next;
			map.getSource(sourceId)?.setData(collection());
		},
		getRegion: () => region,
		restyle(id: string, symbol: PointSymbol) {
			const item = items.find((i) => i.id === id);
			if (!item) return;
			item.symbol = symbol;
			map.getSource(sourceId)?.setData(collection());
		},
		async hitTest(p: ScreenPoint, tolerancePx = DEFAULT_HIT_TOLERANCE): Promise<string | null> {
			if (!map.getLayer(layerId)) return null;
			const box = [
				[p.x - tolerancePx, p.y - tolerancePx],
				[p.x + tolerancePx, p.y + tolerancePx]
			];
			const found = map
				.queryRenderedFeatures(box, { layers: [layerId] })
				.find((f: any) => f.properties?.hittable !== false && f.properties?.hittable !== 'false');
			return found?.properties?.id ?? null;
		}
	};
}

/**
 * Creates a MapLibre-backed GeoJSON layer: one source plus a fill layer (when a
 * fill is asked for) and a line layer (when a stroke is).
 *
 * @param map - The live MapLibre map.
 * @param spec - The neutral layer spec.
 * @returns The neutral handle, already attached to the style.
 */
export function createGeoJsonLayer(
	map: any,
	spec: GeoJsonLayerSpec
): GeoJsonLayerHandle & MaplibreLayer {
	const sourceId = `geo:${spec.id}`;
	const fillId = `geo:${spec.id}:fill`;
	const lineId = `geo:${spec.id}:line`;
	let style: GeoJsonStyle = spec.style;
	/** The source as given: a URL, or inline data. */
	const original: unknown = 'url' in spec.source ? spec.source.url : spec.source.data;
	/** What the source carries now: the original, or the region's features. */
	let data: unknown = original;
	/** The region the source is filtered to — set once the filtered data is in. */
	let region: RegionShape | null = null;
	/** Bumped per call, so a call superseded while the source is read does nothing. */
	let generation = 0;
	/** The parsed source, read once when a region first needs its features. */
	let parsed: Promise<{ features?: { geometry?: GeometryLike }[] }> | null = null;

	function attach() {
		if (!map.getSource(sourceId)) {
			map.addSource(sourceId, { type: 'geojson', data });
		}
		if (style.fill != null && !map.getLayer(fillId)) {
			map.addLayer({
				id: fillId,
				type: 'fill',
				source: sourceId,
				paint: { 'fill-color': style.fill as any }
			});
		}
		if (style.stroke && !map.getLayer(lineId)) {
			map.addLayer({
				id: lineId,
				type: 'line',
				source: sourceId,
				paint: {
					'line-color': style.stroke.color as any,
					'line-width': style.stroke.width
				}
			});
		}
	}

	attach();

	const base = baseLayer(
		map,
		spec.id,
		() => [fillId, lineId],
		spec,
		() => [
			{ layer: fillId, prop: 'fill-opacity' },
			{ layer: lineId, prop: 'line-opacity' }
		],
		() => {
			for (const l of [fillId, lineId]) if (map.getLayer(l)) map.removeLayer(l);
			if (map.getSource(sourceId)) map.removeSource(sourceId);
		}
	);
	base.applyAll();

	return {
		...base,
		reattach() {
			attach();
			base.applyAll();
		},
		async setRegion(next: RegionShape | null) {
			const mine = ++generation;
			if (next === null) {
				data = original;
			} else {
				// MapLibre filters by expression, but `within` keeps only features
				// ENTIRELY inside — a different rule from the anchor every other
				// provider applies. Filtering the source by anchor keeps one rule.
				parsed ??=
					typeof original === 'string'
						? fetch(original).then((r) => {
								if (!r.ok)
									throw new Error(`GeoJSON source ${original} failed to load (${r.status})`);
								return r.json();
							})
						: Promise.resolve(original as { features?: { geometry?: GeometryLike }[] });
				const source = await parsed.catch((error) => {
					parsed = null; // a failed read is retried by the next call
					throw error;
				});
				if (mine !== generation) return;
				data = {
					type: 'FeatureCollection',
					features: (source.features ?? []).filter((feature) => {
						const anchor = anchorOf(feature.geometry);
						return anchor !== null && next.contains(anchor[0], anchor[1]);
					})
				};
			}
			region = next;
			map.getSource(sourceId)?.setData(data);
		},
		getRegion: () => region,
		setStyle(next: GeoJsonStyle) {
			style = next;
			if (next.fill != null && map.getLayer(fillId)) {
				map.setPaintProperty(fillId, 'fill-color', next.fill);
			}
			if (next.stroke && map.getLayer(lineId)) {
				map.setPaintProperty(lineId, 'line-color', next.stroke.color);
				map.setPaintProperty(lineId, 'line-width', next.stroke.width);
			}
			// A style that adds a fill or stroke it didn't have needs the layer built.
			attach();
			base.applyAll();
		}
	};
}
