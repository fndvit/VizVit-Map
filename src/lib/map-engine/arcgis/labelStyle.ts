/**
 * @module map-engine/arcgis/labelStyle
 * The **label style compiler**: the one place a Mapbox / MapLibre style
 * document's `symbol` layers become ArcGIS label styling primitives.
 *
 * A vector tile style already says how every label class looks — typeface,
 * size (often a zoom ramp), fill, halo, casing, wrap width — and at which zooms
 * it shows. When the same labels have to be redrawn as ArcGIS `FeatureLayer`
 * labels (because a vector tile layer is draped and the data floats above it),
 * that authored styling is the source of truth, and this module reads it:
 *
 * - {@link LabelStyleCompiler.textStyleFor} — the neutral text style of a
 *   source-layer's label class;
 * - {@link LabelStyleCompiler.zoomBandFor} — its `minzoom`/`maxzoom`, converted
 *   to ArcGIS scales through the service's tile scheme;
 * - {@link LabelStyleCompiler.sizeRampFor} — its `text-size` stops;
 * - {@link LabelStyleCompiler.textSymbol} — a neutral style as an autocastable
 *   ArcGIS `TextSymbol`, with px turned into points and the face name resolved
 *   through the caller's font resolver.
 *
 * Everything site-specific is injected: which tile scheme the style's zooms
 * belong to, what the defaults are when a layer declares nothing, how a face
 * name maps to a hosted family, and which class wins when several share a
 * source-layer. The compiler itself knows no service, no palette and no font.
 *
 * @example
 * ```ts
 * import { createLabelStyleCompiler } from '@vit-foundation/map/arcgis';
 *
 * const labels = createLabelStyleCompiler(styleJson, { scheme: { tilePx: 512, snap: 0.5 } });
 * const style = labels.textStyleFor('countryLgT');
 * const band = labels.zoomBandFor('countryLgT'); // { minZoom: 2, maxZoom: 6, minScale, maxScale }
 * layer.labelingInfo = [{ symbol: labels.textSymbol(style!, resolveFont), … }];
 * ```
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- parses raw, untyped style JSON */

import { scaleForZoom, zoomForScale, type ZoomScaleOptions } from '../scale.js';

/** The slice of a style-document layer this module reads. */
export interface StyleSymbolLayer {
	id: string;
	type: string;
	'source-layer'?: string;
	minzoom?: number;
	maxzoom?: number;
	layout?: Record<string, any>;
	paint?: Record<string, any>;
}

/** A label class's text styling, in the style document's own units (CSS px). */
export interface LabelTextStyle {
	/** Text fill. */
	color: string;
	/** Face name as the style names it (e.g. `'NatGeo Caption Heavy'`) — not a CSS family. */
	font: string;
	/** Size in CSS px. For a zoom ramp, the ramp's middle stop; see {@link LabelStyleCompiler.sizeRampFor}. */
	size: number;
	haloColor?: string;
	haloWidth?: number;
	haloBlur?: number;
	letterSpacing?: number;
	lineHeight?: number;
	/** `text-max-width` in ems, when declared. */
	maxWidth?: number;
	/**
	 * The declared `text-transform`, when any. An ArcGIS `TextSymbol` has no
	 * equivalent, so a caller applies it in the label expression instead.
	 */
	textTransform?: string;
}

/**
 * A label class's zoom visibility band, as declared and as ArcGIS scales.
 * `0` on the scale side means unbounded, per the ArcGIS convention.
 */
export interface LabelZoomBand {
	/** Declared `minzoom` (the class appears here), or `null` when unbounded. */
	minZoom: number | null;
	/** Declared `maxzoom` (the class hides past here), or `null` when unbounded. */
	maxZoom: number | null;
	/** ArcGIS `minScale` for {@link minZoom}; `0` = visible from fully zoomed out. */
	minScale: number;
	/** ArcGIS `maxScale` for {@link maxZoom}; `0` = visible all the way in. */
	maxScale: number;
}

/** One point of a zoom-ramped label size curve: `size` px at `zoom`. */
export interface LabelSizeStop {
	zoom: number;
	size: number;
}

/** What an ArcGIS `TextSymbol.font` needs to select one hosted face. */
export interface LabelFont {
	/** CSS `font-family`. */
	family: string;
	/** CSS `font-style` (default `'normal'`). */
	style?: string;
	/**
	 * ArcGIS accepts only the CSS keywords, never a numeric weight — a Heavy
	 * (800) face is requested as `'bold'` and CSS matching resolves it.
	 */
	weight: 'normal' | 'bold' | 'bolder' | 'lighter';
}

/**
 * Resolves a style document's face name to a hosted family + weight. The one
 * thing a compiler cannot know: which faces a site actually ships.
 */
export type LabelFontResolver = (face: string | undefined) => LabelFont;

/** What a label class gets when the style declares nothing for it. */
export interface LabelStyleDefaults {
	color: string;
	haloColor: string;
	haloWidth: number;
	lineHeight: number;
	/** Face name handed to the font resolver when a layer declares no `text-font`. */
	font: string;
	/** Size in px when a layer declares no `text-size`. */
	size: number;
}

/** Neutral defaults: a dark grey on a 1 px white halo. */
export const NEUTRAL_LABEL_DEFAULTS: LabelStyleDefaults = {
	color: '#333333',
	haloColor: '#ffffff',
	haloWidth: 1,
	lineHeight: 1.2,
	font: 'sans-serif',
	size: 12
};

export interface LabelStyleCompilerOptions {
	/**
	 * The tile scheme the style's zooms belong to — the service's tile size and
	 * the renderer's LOD snap. Default: 256 px, no snap.
	 */
	scheme?: ZoomScaleOptions;
	/** Overrides for {@link NEUTRAL_LABEL_DEFAULTS}. */
	defaults?: Partial<LabelStyleDefaults>;
	/**
	 * Which class to use when several symbol layers share a source-layer
	 * (`Class 1`, `Class 2`, …). Default: the first in document order.
	 */
	pickClass?: (candidates: StyleSymbolLayer[]) => StyleSymbolLayer | null;
	/**
	 * Source-layer suffixes to also match. Esri vector tile styles name a
	 * polygon or line layer's label class `<source-layer>/label`. Default `['/label']`.
	 */
	sourceLayerSuffixes?: readonly string[];
}

/** One parsed style document, queried by source-layer. */
export interface LabelStyleCompiler {
	/**
	 * The text style of a source-layer's label class.
	 *
	 * @param sourceLayer - The style's `source-layer` name (e.g. `placeXLgST`, `stateLgT`).
	 * @returns The style, or `null` when the document has no text symbol layer for it.
	 */
	textStyleFor(sourceLayer: string): LabelTextStyle | null;
	/**
	 * The zoom band a source-layer's label class is visible in, as ArcGIS scales.
	 *
	 * @param sourceLayer - The style's `source-layer` name.
	 * @returns The band, or `null` when the document has no text symbol layer for it.
	 */
	zoomBandFor(sourceLayer: string): LabelZoomBand | null;
	/**
	 * The `text-size` zoom ramp of a source-layer's label class.
	 *
	 * @param sourceLayer - The style's `source-layer` name.
	 * @returns Stops in ascending zoom order, or `null` when the size is static or
	 *   the layer is missing — callers then use {@link textStyleFor}'s `size`.
	 */
	sizeRampFor(sourceLayer: string): LabelSizeStop[] | null;
	/** Every text symbol layer in the document, in document order. */
	textLayers(): StyleSymbolLayer[];
	/**
	 * A neutral text style as an autocastable ArcGIS `TextSymbol` property bag.
	 *
	 * @param style - A style from {@link textStyleFor} (or one the caller built).
	 * @param fonts - Resolves the style's face name to a hosted family + weight.
	 * @returns `{ type: 'text', color, font: { family, size, style, weight }, haloColor, haloSize, lineHeight, … }`.
	 */
	textSymbol(style: LabelTextStyle, fonts: LabelFontResolver): Record<string, unknown>;
	/** Style zoom → ArcGIS scale, through the compiler's scheme (integer). */
	scaleForZoom(zoom: number): number;
	/** ArcGIS scale → style zoom, through the compiler's scheme. */
	zoomForScale(scale: number): number;
}

/** CSS pixels per typographic point (96 dpi / 72 pt). */
const PX_PER_POINT = 96 / 72;

/**
 * Converts a CSS pixel size to the typographic points an ArcGIS symbol wants.
 * Everything upstream — a style's `text-size`, a design spec — is in px, while
 * `TextSymbol.font.size` is in points; passing px straight through renders every
 * label 4/3 too large.
 *
 * @param px - Size in CSS pixels.
 * @returns The equivalent size in points, rounded to 0.1 pt.
 */
export function pxToPoints(px: number): number {
	return Math.round((px / PX_PER_POINT) * 10) / 10;
}

/**
 * Builds a compiler over one style document.
 *
 * @param style - The style document (`{ layers: [...] }`); only symbol layers with a `text-field` are read.
 * @param options - Tile scheme, defaults, class policy.
 * @returns The compiler.
 */
export function createLabelStyleCompiler(
	style: { layers?: unknown[] },
	options: LabelStyleCompilerOptions = {}
): LabelStyleCompiler {
	const scheme = options.scheme ?? {};
	const defaults: LabelStyleDefaults = { ...NEUTRAL_LABEL_DEFAULTS, ...options.defaults };
	const pickClass =
		options.pickClass ?? ((candidates: StyleSymbolLayer[]) => candidates[0] ?? null);
	const suffixes = options.sourceLayerSuffixes ?? ['/label'];

	const textLayers: StyleSymbolLayer[] = ((style.layers ?? []) as any[]).filter(
		(layer) => layer?.type === 'symbol' && layer.layout?.['text-field']
	);

	const toScale = (zoom: number) => Math.round(scaleForZoom(zoom, scheme));

	function find(sourceLayer: string): StyleSymbolLayer | null {
		const names = new Set([sourceLayer, ...suffixes.map((s) => `${sourceLayer}${s}`)]);
		const candidates = textLayers.filter((layer) => names.has(layer['source-layer'] ?? ''));
		return candidates.length ? pickClass(candidates) : null;
	}

	function color(value: unknown, fallback: string): string {
		return typeof value === 'string' ? value : fallback;
	}

	function font(value: unknown): string {
		if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
		return typeof value === 'string' ? value : defaults.font;
	}

	function size(value: unknown): number {
		if (typeof value === 'number') return value;
		const stops = (value as any)?.stops;
		if (Array.isArray(stops) && stops.length) {
			// A ramp has no single size; the middle stop is the representative one.
			const mid = stops[Math.floor(stops.length / 2)];
			if (Array.isArray(mid) && typeof mid[1] === 'number') return mid[1];
		}
		return defaults.size;
	}

	return {
		textLayers: () => [...textLayers],

		textStyleFor(sourceLayer) {
			const layer = find(sourceLayer);
			if (!layer) return null;
			const layout = layer.layout ?? {};
			const paint = layer.paint ?? {};
			return {
				color: color(paint['text-color'], defaults.color),
				font: font(layout['text-font']),
				size: size(layout['text-size']),
				haloColor: color(paint['text-halo-color'], defaults.haloColor),
				haloWidth:
					typeof paint['text-halo-width'] === 'number'
						? paint['text-halo-width']
						: defaults.haloWidth,
				haloBlur: paint['text-halo-blur'],
				textTransform: layout['text-transform'],
				letterSpacing: layout['text-letter-spacing'],
				lineHeight: layout['text-line-height'] ?? defaults.lineHeight,
				// No default on purpose: a caller may need to tell "declared 10"
				// from "declared nothing".
				maxWidth: layout['text-max-width']
			};
		},

		zoomBandFor(sourceLayer) {
			const layer = find(sourceLayer);
			if (!layer) return null;
			const minZoom = typeof layer.minzoom === 'number' ? layer.minzoom : null;
			const maxZoom = typeof layer.maxzoom === 'number' ? layer.maxzoom : null;
			return {
				minZoom,
				maxZoom,
				minScale: minZoom !== null ? toScale(minZoom) : 0,
				maxScale: maxZoom !== null ? toScale(maxZoom) : 0
			};
		},

		sizeRampFor(sourceLayer) {
			const stops = find(sourceLayer)?.layout?.['text-size']?.stops;
			if (!Array.isArray(stops) || stops.length < 2) return null;
			const ramp = stops
				.filter(
					(stop: unknown): stop is [number, number] =>
						Array.isArray(stop) && typeof stop[0] === 'number' && typeof stop[1] === 'number'
				)
				.map(([zoom, px]) => ({ zoom, size: px }))
				.sort((a, b) => a.zoom - b.zoom);
			return ramp.length >= 2 ? ramp : null;
		},

		textSymbol(textStyle, fonts) {
			const face = fonts(textStyle.font);
			return {
				type: 'text',
				color: textStyle.color,
				font: {
					family: face.family,
					size: pxToPoints(textStyle.size),
					style: face.style ?? 'normal',
					weight: face.weight
				},
				haloColor: textStyle.haloColor,
				haloSize: textStyle.haloWidth || 0,
				lineHeight: textStyle.lineHeight || 1.0,
				angle: 0,
				xOffset: 0,
				yOffset: 0
			};
		},

		scaleForZoom: toScale,
		zoomForScale: (scale) => zoomForScale(scale, scheme)
	};
}
