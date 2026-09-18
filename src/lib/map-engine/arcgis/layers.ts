/**
 * @module map-engine/arcgis/layers
 * The ArcGIS implementations of the provider's two layer kinds.
 *
 * A **layer handle** is the neutral object a capability gets back from
 * `provider.layers.points(...)` / `.geojson(...)`. Everything ArcGIS about a
 * layer — `GraphicsLayer`, `Graphic`, `GeoJSONLayer`, simple-marker symbols,
 * `elevationInfo`, `minScale`/`maxScale`, `view.hitTest` — is hidden here, so
 * the capabilities above never name an ArcGIS type.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- ArcGIS dynamic imports have no static types */

import type {
	GeoJsonLayerHandle,
	GeoJsonLayerSpec,
	GeoJsonStyle,
	Placement,
	PointItem,
	PointLayerHandle,
	PointLayerSpec,
	PointSymbol,
	ScreenPoint
} from '../provider.js';

/** Attribute carrying a point item's neutral id on its ArcGIS graphic. */
const ID_ATTR = '__id';
/** Attribute carrying whether a point item answers hit tests. */
const HITTABLE_ATTR = '__hittable';

/** The ArcGIS constructors a layer needs, preloaded by the provider. */
export interface LayerCtors {
	GraphicsLayer: any;
	Graphic: any;
	GeoJSONLayer: any;
	Point: any;
}

/** What a layer needs from the provider to attach itself. */
export interface LayerDeps {
	/** The live ArcGIS `Map`. */
	map: any;
	/** The live ArcGIS view (for hit testing). */
	view: any;
	/** Preloaded constructors, so the factory methods can stay synchronous. */
	ctors: LayerCtors;
}

/**
 * Translates a placement into ArcGIS elevation info.
 *
 * @param placement - `'draped'` sits on the surface, `'floating'` above other content.
 * @returns The `elevationInfo` value for an ArcGIS layer.
 */
function elevationFor(placement: Placement): { mode: string } {
	return { mode: placement === 'floating' ? 'relative-to-ground' : 'on-the-ground' };
}

/**
 * Translates a neutral point symbol into an ArcGIS simple-marker symbol.
 *
 * @param symbol - The neutral symbol.
 * @returns An ArcGIS simple-marker symbol object.
 */
function markerSymbol(symbol: PointSymbol): Record<string, unknown> {
	return {
		type: 'simple-marker',
		style: symbol.shape,
		size: symbol.size,
		color: symbol.color,
		...(symbol.outline
			? { outline: { color: symbol.outline.color, width: symbol.outline.width } }
			: {})
	};
}

/**
 * Builds the renderer for a GeoJSON layer. A missing `fill` renders a
 * transparent interior, which is how stroke-only outlines are drawn.
 *
 * @param style - The neutral fill/stroke style.
 * @returns An ArcGIS simple renderer.
 */
function geoJsonRenderer(style: GeoJsonStyle): Record<string, unknown> {
	return {
		type: 'simple',
		symbol: {
			type: 'simple-fill',
			color: style.fill ?? [0, 0, 0, 0],
			outline: style.stroke
				? { color: style.stroke.color, width: style.stroke.width }
				: { color: [0, 0, 0, 0], width: 0 }
		}
	};
}

/** The state every layer handle shares, plus the ArcGIS layer it wraps. */
function baseHandle(layer: any, spec: { id: string; placement?: Placement }, onRemove: () => void) {
	let placement: Placement = spec.placement ?? 'draped';
	return {
		id: spec.id,
		setVisible(visible: boolean) {
			layer.visible = visible;
		},
		getVisible(): boolean {
			return layer.visible !== false;
		},
		setOpacity(opacity: number) {
			layer.opacity = opacity;
		},
		getOpacity(): number {
			return layer.opacity ?? 1;
		},
		setScaleRange(minScale: number, maxScale: number) {
			layer.minScale = minScale;
			layer.maxScale = maxScale;
		},
		setPlacement(next: Placement) {
			placement = next;
			layer.elevationInfo = elevationFor(next);
		},
		getPlacement(): Placement {
			return placement;
		},
		remove() {
			onRemove();
		}
	};
}

/**
 * Creates an ArcGIS-backed points layer (a `GraphicsLayer` of simple markers).
 *
 * @param deps - Live map/view plus preloaded constructors.
 * @param spec - The neutral layer spec.
 * @returns The neutral handle; the ArcGIS layer is already attached to the map.
 */
export function createPointLayer(deps: LayerDeps, spec: PointLayerSpec): PointLayerHandle {
	const { Graphic, GraphicsLayer } = deps.ctors;
	const layer = new GraphicsLayer({
		elevationInfo: elevationFor(spec.placement ?? 'draped'),
		visible: spec.visible ?? true,
		opacity: spec.opacity ?? 1
	});
	deps.map.add(layer);

	/** Builds the ArcGIS graphic for one neutral item. */
	function graphicFor(item: PointItem): any {
		return new Graphic({
			geometry: { type: 'point', longitude: item.lng, latitude: item.lat },
			symbol: markerSymbol(item.symbol),
			attributes: { [ID_ATTR]: item.id, [HITTABLE_ATTR]: item.hittable !== false }
		});
	}

	function set(items: readonly PointItem[]): void {
		layer.removeAll();
		for (const item of items) layer.add(graphicFor(item));
	}

	set(spec.items ?? []);

	const base = baseHandle(layer, spec, () => deps.map.remove(layer));
	return {
		...base,
		set,
		restyle(id: string, symbol: PointSymbol) {
			layer.graphics.forEach((g: any) => {
				if (g.attributes?.[ID_ATTR] === id) g.symbol = markerSymbol(symbol);
			});
		},
		async hitTest(p: ScreenPoint): Promise<string | null> {
			const response = await deps.view.hitTest({ x: p.x, y: p.y });
			const hit = (response?.results ?? []).find(
				(r: any) =>
					r.type === 'graphic' &&
					r.graphic?.layer === layer &&
					r.graphic?.attributes?.[HITTABLE_ATTR] === true
			);
			return hit?.graphic?.attributes?.[ID_ATTR] ?? null;
		}
	};
}

/**
 * Creates an ArcGIS-backed GeoJSON layer.
 *
 * ArcGIS's `GeoJSONLayer` only reads from a URL, so inline `data` is published
 * as an object URL and revoked when the layer is removed.
 *
 * @param deps - Live map/view plus preloaded constructors.
 * @param spec - The neutral layer spec.
 * @returns The neutral handle; the ArcGIS layer is already attached to the map.
 */
export function createGeoJsonLayer(deps: LayerDeps, spec: GeoJsonLayerSpec): GeoJsonLayerHandle {
	const { GeoJSONLayer } = deps.ctors;
	let objectUrl: string | null = null;
	let url: string;
	if ('url' in spec.source) {
		url = spec.source.url;
	} else {
		objectUrl = URL.createObjectURL(
			new Blob([JSON.stringify(spec.source.data)], { type: 'application/json' })
		);
		url = objectUrl;
	}

	const layer = new GeoJSONLayer({
		url,
		renderer: geoJsonRenderer(spec.style) as any,
		elevationInfo: elevationFor(spec.placement ?? 'draped'),
		visible: spec.visible ?? true,
		// Set the initial opacity directly (no tween) so a remount on an
		// already-visible step doesn't flash a fade-in.
		opacity: spec.opacity ?? 1
	});
	deps.map.add(layer);

	const base = baseHandle(layer, spec, () => {
		deps.map.remove(layer);
		if (objectUrl) URL.revokeObjectURL(objectUrl);
		objectUrl = null;
	});
	return {
		...base,
		setStyle(style: GeoJsonStyle) {
			layer.renderer = geoJsonRenderer(style) as any;
		}
	};
}
