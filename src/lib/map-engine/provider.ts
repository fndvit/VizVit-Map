/**
 * @module map-engine/provider
 * The **map provider** contract: the provider-neutral interface every globe
 * capability programs against, and the only thing a map SDK adapter has to
 * implement. Plain TypeScript — no Svelte, no `@arcgis/core`, no `maplibre-gl`.
 *
 * One provider = one live view. It is split into five small **ports** so a
 * capability can type its dependency to the slice it uses
 * (`Pick<MapProvider, 'screen' | 'events'>`), plus one typed **native escape
 * hatch** for the capabilities that are inherently provider-bound (the explore
 * dot tiers: Arcade, SQL gates, `FeatureLayer.applyEdits`).
 *
 * Adapters: `./arcgis` (SceneView / MapView), `./maplibre` (globe projection),
 * and the in-memory fake in `src/tests/helpers/fakeProvider.ts`.
 *
 * Scale, not zoom, is the LOD currency (see {@link module:map-engine/scale}).
 */

import type { FlatColors, SceneCamera, ViewMode } from './types.js';

/* eslint-disable @typescript-eslint/no-explicit-any -- native SDK surfaces are untyped by design */

/** Which SDK is behind a provider. `'fake'` is the in-memory test adapter. */
export type ProviderKind = 'arcgis' | 'maplibre' | 'fake';

/** A subscription or resource that can be released. */
export interface Handle {
	remove(): void;
}

/** A geographic point in degrees. */
export interface LngLat {
	lng: number;
	lat: number;
}

/** A point in view pixels, origin top-left. */
export interface ScreenPoint {
	x: number;
	y: number;
}

/** The view's size in CSS pixels. */
export interface Size {
	width: number;
	height: number;
}

/** Padding that shifts the view centre within its container. */
export interface Padding {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

// ── Camera ────────────────────────────────────────────────────────────

/**
 * The live camera: the site's {@link SceneCamera} shape (longitude/latitude/z/
 * tilt/heading — what story steps, permalinks and the configurator persist)
 * plus the derived `scale` (the LOD currency) and `zoom` for convenience.
 */
export type CameraState = SceneCamera & {
	/** Scale denominator at the view centre (1:N). */
	scale: number;
	/** Fractional tile zoom equivalent of `scale`. */
	zoom: number;
};

/**
 * A camera move target. Every field is optional; the adapter fills the rest from
 * the live camera. Give `z` for an altitude-based 3D move (story steps), or
 * `zoom`/`scale` for a level-based move (fly-to-place, zoom buttons). When both
 * are present `z` wins.
 */
export interface CameraTarget {
	longitude?: number;
	latitude?: number;
	/** Camera altitude in metres (3D). */
	z?: number;
	tilt?: number;
	heading?: number;
	zoom?: number;
	scale?: number;
}

/** Options for an animated camera move. */
export interface FlyOptions {
	/** Animation duration in ms. Adapter default: 1500. */
	duration?: number;
	/** Easing name (`'linear'`, `'ease-in-out'`, `'ease-out'`, …). Adapter default: `'ease-in-out'`. */
	easing?: string;
	/** Padding to animate alongside the camera. */
	padding?: Padding;
}

/** Camera read + move. */
export interface CameraPort {
	/** The live camera, or `null` before the view is ready / after destroy. */
	get(): CameraState | null;
	/**
	 * Animates to a target. Resolves when the move settles **or is superseded**
	 * by a newer move — it never rejects on cancellation.
	 */
	flyTo(target: CameraTarget, opts?: FlyOptions): Promise<void>;
	/** Zooms by a relative number of levels (negative = out). */
	zoomBy(delta: number, durationMs?: number): void;
}

// ── Screen ────────────────────────────────────────────────────────────

/** Screen ↔ ground projection and view size. */
export interface ScreenPort {
	size(): Size;
	/** Ground → pixels, or `null` when the point is off-view or behind the globe. */
	toScreen(p: LngLat): ScreenPoint | null;
	/** Pixels → ground, or `null` when the pixel is in space. */
	toMap(p: ScreenPoint): LngLat | null;
}

// ── Events ────────────────────────────────────────────────────────────

/** A pointer event in view pixels; `native` is the SDK event for adapters only. */
export interface PointerEvt extends ScreenPoint {
	native?: unknown;
}

/**
 * The closed event vocabulary. Capabilities may subscribe to these and nothing
 * else — an arbitrary SDK property name cannot be honoured by another provider.
 */
export interface ProviderEvents {
	'pointer-move': PointerEvt;
	'pointer-leave': void;
	click: PointerEvt & { lngLat: LngLat | null };
	/** Fires on every camera change frame. */
	camera: CameraState;
	/** `true` once the camera has settled AND streaming has stopped. */
	stationary: boolean;
	/** `true` while a deliberate user gesture (drag / pinch / wheel) is in progress. */
	interacting: boolean;
	/** `true` while the renderer has unsettled work (tiles loading, layers updating). */
	updating: boolean;
	size: Size;
	padding: Padding;
}

/** Event subscription plus the two synchronous flags hot paths read directly. */
export interface EventPort {
	on<K extends keyof ProviderEvents>(name: K, handler: (e: ProviderEvents[K]) => void): Handle;
	readonly interacting: boolean;
	readonly updating: boolean;
}

// ── Scene (appearance) ────────────────────────────────────────────────

/**
 * How a basemap is described to a provider. Provider-neutral by construction:
 * the site's basemap *ids* (`'natgeo-lightGray'`, `'flat-natgeo'`, …) are resolved
 * to one of these by the app's {@link BasemapCatalog}, never by the engine.
 */
export type BasemapSpec =
	/** Two-colour land/ocean rendering. Each provider draws it its own way. */
	| { kind: 'flat'; landColor: string; oceanColor: string }
	/** A vector style document by URL (MapLibre style JSON / ArcGIS VTL style). */
	| { kind: 'style'; url: string }
	/** One of the provider's built-in basemaps (ArcGIS `'gray-vector'`, `'satellite'`, …). */
	| { kind: 'well-known'; id: string }
	/**
	 * Provider-native object built by an injected loader (e.g. an ArcGIS Web Map
	 * fetched from a portal). The provider caches the result by `key` so a basemap
	 * revisited during the session is reattached, never rebuilt — the WebGL-leak
	 * rule from `basemap.ts`.
	 */
	| { kind: 'native'; key: string; load: (native: any) => Promise<unknown> };

/**
 * Resolves the app's basemap ids to {@link BasemapSpec}s and, optionally,
 * decorates a freshly applied basemap (hide baked-in labels, add an overlay).
 * Lives in the *app* (`$lib/config/map`); the engine only calls it.
 */
export interface BasemapCatalog {
	/**
	 * @param id - Registry basemap id.
	 * @param customColors - Land/ocean overrides for flat presets.
	 */
	resolve(id: string, customColors?: FlatColors): BasemapSpec;
	/**
	 * Runs after every basemap apply, with the provider so it can reach native
	 * objects if it must. Skipped when the apply was superseded.
	 */
	decorate?(
		provider: MapProvider,
		spec: BasemapSpec,
		opts: { labelOverlay?: boolean }
	): Promise<void>;
}

/** Rendering quality knobs (3D). */
export interface QualityOptions {
	profile?: 'low' | 'medium' | 'high';
	/** Cap on the render pixel ratio; below 1 renders sub-natively to save GPU memory. */
	maxPixelRatio?: number;
}

/** Appearance of the view as a whole. */
export interface ScenePort {
	/**
	 * Swaps the basemap. Generation-guarded inside the adapter: a slow async
	 * apply that has been superseded is dropped, never applied late.
	 */
	setBasemap(spec: BasemapSpec): Promise<void>;
	/** The space around the globe: `'transparent'` or a hex colour. */
	setBackground(color: string): void;
	/** The sphere surface colour (3D). No-op on 2D views and on providers without a ground. */
	setGround(color: string): void;
	setQuality(q: QualityOptions): void;
	setPadding(p: Padding): void;
	getPadding(): Padding;
	setCursor(cursor: string): void;
	/** Resolves once `updating` is false (immediately if already settled). */
	whenSettled(): Promise<void>;
}

// ── Layers ────────────────────────────────────────────────────────────

/** How a layer sits on a 3D globe: on the surface, or lifted above other content. */
export type Placement = 'draped' | 'floating';

/** A simple marker symbol. Colours are CSS strings or `[r, g, b, a]`. */
export interface PointSymbol {
	shape: 'circle' | 'diamond' | 'square';
	/** Diameter in px. */
	size: number;
	color: string | [number, number, number, number];
	outline?: { color: string | [number, number, number, number]; width: number };
}

/** One point in a points layer. `hittable: false` excludes it from {@link PointLayerHandle.hitTest}. */
export interface PointItem {
	id: string;
	lng: number;
	lat: number;
	symbol: PointSymbol;
	hittable?: boolean;
}

/** Fill/stroke for a GeoJSON layer. Omit `fill` for a stroke-only outline. */
export interface GeoJsonStyle {
	fill?: string | [number, number, number, number];
	stroke?: { color: string | [number, number, number, number]; width: number };
}

/** What every layer handle can do, regardless of kind. */
export interface LayerHandle {
	readonly id: string;
	setVisible(visible: boolean): void;
	getVisible(): boolean;
	/** Immediate; tweens are the caller's job so every provider animates identically. */
	setOpacity(opacity: number): void;
	getOpacity(): number;
	/** LOD window in ArcGIS convention: `0` = unbounded. */
	setScaleRange(minScale: number, maxScale: number): void;
	setPlacement(placement: Placement): void;
	remove(): void;
}

/** A layer of simple point symbols (markers). */
export interface PointLayerHandle extends LayerHandle {
	/** Replaces all items; diffing is the adapter's business. */
	set(items: readonly PointItem[]): void;
	/** Restyles one item in place (active/inactive). */
	restyle(id: string, symbol: PointSymbol): void;
	/** The id of the hittable item under `p`, or `null`. */
	hitTest(p: ScreenPoint, tolerancePx?: number): Promise<string | null>;
}

/** A GeoJSON polygon/line layer (outlines, hex grids). */
export interface GeoJsonLayerHandle extends LayerHandle {
	setStyle(style: GeoJsonStyle): void;
}

export interface PointLayerSpec {
	id: string;
	items?: readonly PointItem[];
	placement?: Placement;
	visible?: boolean;
	opacity?: number;
}

export interface GeoJsonLayerSpec {
	id: string;
	source: { url: string } | { data: unknown };
	style: GeoJsonStyle;
	placement?: Placement;
	visible?: boolean;
	opacity?: number;
}

/** Layer creation. The kinds are a closed set: an opaque "any layer" is exactly the coupling this seam removes. */
export interface LayerFactory {
	points(spec: PointLayerSpec): PointLayerHandle;
	geojson(spec: GeoJsonLayerSpec): GeoJsonLayerHandle;
	/** Every live handle, in creation order. */
	readonly all: readonly LayerHandle[];
}

// ── Native escape hatch ───────────────────────────────────────────────

/** The ArcGIS surface behind `native('arcgis')`. */
export interface ArcgisNative {
	kind: 'arcgis';
	/** The live `SceneView` / `MapView`. */
	view: any;
	/** The live `Map`. */
	map: any;
	/** De-duped loader for `@arcgis/core` constructors by registry name. */
	loadModules<T extends string>(names: readonly T[]): Promise<Record<T, any>>;
}

/** The MapLibre surface behind `native('maplibre')`. */
export interface MaplibreNative {
	kind: 'maplibre';
	/** The live `maplibregl.Map`. */
	map: any;
}

/** The fake surface — whatever a test hands in. */
export interface FakeNative {
	kind: 'fake';
	[k: string]: unknown;
}

export interface NativeSurfaces {
	arcgis: ArcgisNative;
	maplibre: MaplibreNative;
	fake: FakeNative;
}

/** Thrown when a capability or caller asks for a provider the view is not. */
export class ProviderMismatchError extends Error {
	constructor(
		public readonly wanted: ProviderKind,
		public readonly got: ProviderKind,
		what = 'This operation'
	) {
		super(`${what} requires the '${wanted}' map provider but the view is '${got}'.`);
		this.name = 'ProviderMismatchError';
	}
}

// ── The provider ──────────────────────────────────────────────────────

/** One live map view, behind five ports and a typed escape hatch. */
export interface MapProvider {
	readonly kind: ProviderKind;
	readonly mode: ViewMode;
	readonly camera: CameraPort;
	readonly screen: ScreenPort;
	readonly events: EventPort;
	readonly scene: ScenePort;
	readonly layers: LayerFactory;
	/**
	 * The SDK surface, typed by provider. Throws {@link ProviderMismatchError}
	 * on any other provider — a loud failure at the call site, not an
	 * `undefined is not a function` three frames later.
	 */
	native<K extends ProviderKind>(kind: K): NativeSurfaces[K];
	/** Tears the view down. Safe to call once. */
	destroy(): void;
}

/**
 * A default catalog for hosts that only ever use the provider's built-in
 * basemaps: every id is passed through as `well-known`.
 */
export const PASSTHROUGH_BASEMAP_CATALOG: BasemapCatalog = {
	resolve: (id) => ({ kind: 'well-known', id })
};
