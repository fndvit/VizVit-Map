/**
 * @module map-engine/arcgis/vectorTileOverlay
 * A vector tile style drawn as an operational layer above the basemap, with an
 * optional filter on which of its style layers show.
 *
 * ArcGIS draws a `VectorTileLayer` from a VectorTileServer's default style or
 * from a style document URL, and after load exposes that style's layers so
 * they can be switched off one by one. That is enough to draw "only the labels"
 * or "only the POI symbols and admin-1 boundaries" of a full basemap style
 * without asking the publisher for a trimmed style item — which is what this
 * helper does, generically: URL in, filtered layer out, and a handle to remove
 * it or float it back to the top.
 *
 * In a 3D scene a vector tile layer is always **draped** on the ground, so it
 * renders beneath anything elevated above the surface. Nothing here can change
 * that; a caller who needs symbols above floating data must draw them as a
 * feature layer instead.
 *
 * @example
 * ```ts
 * import { addVectorTileOverlay } from '@vit-foundation/map/arcgis';
 *
 * const poi = await addVectorTileOverlay(ctx.provider.native('arcgis'), {
 * 	url: 'https://…/VectorTileServer',
 * 	title: 'POI + admin-1',
 * 	keep: (layer) => layer.id.startsWith('g_spriteGlyph/') || /^g_politicalLine\/state/.test(layer.id)
 * });
 * // later
 * poi.remove();
 * ```
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- ArcGIS objects come from the untyped native surface */

import type { ArcgisNative } from '../provider.js';

/** The slice of a style layer a {@link VectorTileOverlaySpec.keep} filter sees. */
export interface StyleLayerSummary {
	id: string;
	/** `symbol`, `line`, `fill`, `circle`, … */
	type: string;
	sourceLayer?: string;
}

export interface VectorTileOverlaySpec {
	/** A VectorTileServer URL (its default style is used) or a style document URL. */
	url: string;
	/** Layer title, for layer lists and debugging. */
	title?: string;
	/** Layer opacity, 0–1. Default 1. */
	opacity?: number;
	/**
	 * Keep only the style layers this returns `true` for; every other layer is
	 * hidden once the style has loaded. Omit to draw the whole style.
	 */
	keep?: (layer: StyleLayerSummary) => boolean;
}

/** A vector tile overlay on the map. */
export interface VectorTileOverlayHandle {
	/** The live ArcGIS `VectorTileLayer`. */
	readonly layer: any;
	/** Ids of the style layers left visible (every layer when no filter was given). */
	readonly visibleStyleLayers: readonly string[];
	setVisible(visible: boolean): void;
	/** Moves the layer to the top of the map's operational layers. */
	raise(): void;
	/** Takes the layer off the map. Safe to call once. */
	remove(): void;
}

/**
 * Builds the layer, loads its style, applies the filter, then adds it to the
 * map — in that order, so a filtered style never flashes complete.
 *
 * @param native - The ArcGIS native surface (`ctx.provider.native('arcgis')`).
 * @param spec - What to draw.
 * @returns The handle, once the layer is on the map.
 * @throws When the style fails to load (a bad URL, a service that is down).
 */
export async function addVectorTileOverlay(
	native: ArcgisNative,
	spec: VectorTileOverlaySpec
): Promise<VectorTileOverlayHandle> {
	const { VectorTileLayer } = await native.loadModules(['VectorTileLayer']);
	const layer = new VectorTileLayer({
		url: spec.url,
		title: spec.title,
		opacity: spec.opacity ?? 1
	});
	await layer.load();

	const styleLayers: any[] = layer.currentStyleInfo?.style?.layers ?? [];
	const visible: string[] = [];
	for (const styleLayer of styleLayers) {
		const summary: StyleLayerSummary = {
			id: styleLayer.id,
			type: styleLayer.type,
			sourceLayer: styleLayer['source-layer']
		};
		if (spec.keep && !spec.keep(summary)) {
			layer.setStyleLayerVisibility(styleLayer.id, 'none');
		} else {
			visible.push(styleLayer.id);
		}
	}

	const map = native.map;
	map.add(layer);
	let onMap = true;

	return {
		layer,
		visibleStyleLayers: visible,
		setVisible(v) {
			layer.visible = v;
		},
		raise() {
			if (onMap && map.layers?.includes?.(layer)) map.reorder(layer, map.layers.length - 1);
		},
		remove() {
			if (!onMap) return;
			onMap = false;
			map.remove(layer);
		}
	};
}
