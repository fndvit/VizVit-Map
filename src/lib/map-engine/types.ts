/**
 * @module map-engine/types
 * Shared types for the framework-agnostic map engine.
 *
 * The engine owns a single ArcGIS view (3D `SceneView` or 2D `MapView`) and the
 * operations performed on it: basemap swaps, camera moves, lifecycle. These
 * types describe its configuration surface. ArcGIS SDK objects themselves are
 * loaded dynamically and typed as `any` (the SDK has no ambient module types
 * for the deep import paths we use).
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- ArcGIS dynamic imports have no static types */

/** Which kind of view the engine drives. `'3d'` = globe SceneView, `'2d'` = flat MapView. */
export type ViewMode = '3d' | '2d';

/**
 * ArcGIS SceneView rendering quality. `'low'` renders at a reduced resolution
 * scale and disables expensive effects — far cheaper on GPU memory, which is why
 * decorative globes (e.g. the homepage scrolly) request it.
 */
export type QualityProfile = 'low' | 'medium' | 'high';

/** Full 3D camera state (position + orientation) for a SceneView globe. */
export interface SceneCamera {
	/** Camera longitude in degrees. */
	longitude: number;
	/** Camera latitude in degrees. */
	latitude: number;
	/** Camera altitude in meters. */
	z: number;
	/** Camera tilt in degrees (0 = straight down, 90 = horizon). */
	tilt: number;
	/** Camera compass heading in degrees (0/360 = north). */
	heading: number;
}

/** Camera state read back from a live view, including the derived map scale. */
export type CameraReadout = SceneCamera & { scale: number };

/** Custom land/ocean colors for flat-preset basemaps. */
export type FlatColors = { landColor: string; oceanColor: string };

/** Navigation limits for a 2D MapView. */
export interface MapViewConstraints {
	/** Minimum zoom level. */
	minZoom: number;
	/** Maximum zoom level. */
	maxZoom: number;
	/** Whether the user may rotate the map. */
	rotationEnabled: boolean;
}

/** Options that control how a basemap is applied to a view. */
export interface BasemapOptions {
	/** Land/ocean overrides for flat presets (ignored for standard/portal). */
	customColors?: FlatColors;
	/**
	 * Whether to ask the host's basemap catalog to decorate the basemap with a
	 * label overlay after it loads (`BasemapCatalog.decorate`). A label stack with
	 * its own lifecycle is better modelled as a host capability; see
	 * `GlobeConfig.basemap.labelOverlay`.
	 */
	labelOverlay?: boolean;
}

/**
 * The subset of ArcGIS SDK constructors the engine needs. Injected into the
 * engine (DIP) so it can be unit-tested with fakes instead of the real SDK.
 */
export interface ArcgisModules {
	/** `@arcgis/core/Map` default export. */
	Map: any;
	/** `@arcgis/core/views/SceneView` default export (present in `'3d'` mode). */
	SceneView?: any;
	/** `@arcgis/core/views/MapView` default export (present in `'2d'` mode). */
	MapView?: any;
	/** `@arcgis/core/Basemap` default export. */
	Basemap: any;
	/** `@arcgis/core/layers/VectorTileLayer` default export. */
	VectorTileLayer: any;
}

/** A function that supplies the ArcGIS modules for a given view mode (the injectable dependency). */
export type ModuleLoader = (mode: ViewMode) => Promise<ArcgisModules>;

/** Construction options for {@link MapEngine}. */
export interface MapEngineOptions {
	/** Which view to build. */
	mode: ViewMode;
	/**
	 * Which map SDK renders the view. Default `'arcgis'`. Capabilities that are
	 * inherently provider-bound declare `requires` and the registry refuses to
	 * mount them on any other provider.
	 */
	provider?: import('./provider.js').ProviderKind;
	/**
	 * Initial basemap id, resolved through {@link MapEngineOptions.basemaps}.
	 * Required — a view has no sensible basemap-less default, so omitting it throws
	 * at construction rather than silently inventing one.
	 */
	basemap: string;
	/**
	 * Resolves basemap ids to provider-neutral specs (and optionally decorates an
	 * applied basemap). The app supplies its registry here; the engine itself
	 * knows no basemap ids. Default: every id is a provider `well-known` basemap.
	 */
	basemaps?: import('./provider.js').BasemapCatalog;
	/** Custom flat colors for the initial basemap. */
	basemapColors?: FlatColors;
	/** Ask the catalog to overlay dynamic labels after each basemap apply. Default `false`. */
	labelOverlay?: boolean;
	/** Whether the user can pan/zoom/rotate. Default `true`. */
	interactive?: boolean;
	/** Initial camera (3D mode). Defaults to a whole-earth view centred on 0°/20°. */
	camera?: SceneCamera;
	/** Initial center `[lng, lat]` (2D mode). Default `[0, 20]`. */
	center?: [number, number];
	/** Initial zoom (2D mode). Default `3`. */
	zoom?: number;
	/** Scene background: `'transparent'` or a hex color (3D mode). Default `'transparent'`. */
	background?: string;
	/**
	 * Ground (sphere) surface color as a hex string (3D mode). Fully independent of
	 * `background` (the space around the sphere) — it is never inferred from it. Set
	 * an opaque color so draped portal basemaps whose land fill isn't opaque don't
	 * show the black globe interior as dark land; a transparent-background globe
	 * (scrolly) can still request an opaque ground. Default: a see-through surface.
	 */
	groundColor?: string;
	/** Lock the globe to a fixed altitude range (3D mode), e.g. the homepage globe. */
	altitudeConstraint?: { min: number; max: number };
	/**
	 * Rendering quality (3D mode). Defaults to `'medium'`. Decorative globes pass
	 * `'low'` to cut GPU memory; the explore tool tunes it at runtime.
	 */
	qualityProfile?: QualityProfile;
	/**
	 * Hard cap on the render pixel ratio (3D mode). A value **below 1** (e.g. `0.6`)
	 * renders sub-natively — a real framebuffer-memory cut for memory-constrained
	 * (mobile) devices. Omit on desktop.
	 */
	maxPixelRatio?: number;
	/** 2D navigation constraints. Default: zoom 2–10, rotation off. */
	constraints?: MapViewConstraints;
	/** Provider UI widgets to show. Default `[]` (3D) / `['zoom']` (2D). */
	uiComponents?: string[];
	/**
	 * Runs once before the view is built — the hook for app-level request setup
	 * (e.g. installing a portal proxy) that must precede any basemap fetch. The
	 * engine awaits it in parallel with SDK module loading.
	 */
	onInit?: () => Promise<void> | void;
	/**
	 * Override the ArcGIS module loader (ArcGIS provider only). Defaults to the
	 * real dynamic-import loader; tests inject a fake.
	 */
	loadModules?: ModuleLoader;
	/**
	 * Override provider construction entirely — tests inject the in-memory fake.
	 * Receives the resolved options and the container; returns a ready provider.
	 */
	createProvider?: (
		options: MapEngineOptions,
		container: HTMLElement
	) => Promise<import('./provider.js').MapProvider>;
}

/** Options for a geocoded place fly-to (`flyToPlace`). */
export interface FlyToPlaceOptions {
	/**
	 * Zoom level to settle at. Defaults to a zoom derived from the geocoded
	 * place's extent (`camera.zoomForExtent`) — cities land close, countries
	 * stay wide — falling back to 5 when the geocoder returns no extent.
	 */
	zoom?: number;
	/**
	 * Geocoder suggestion id (from `geocode.suggestPlaces`). When set, the
	 * geocode resolves to exactly that suggestion instead of a fuzzy match.
	 */
	magicKey?: string;
}

/** Options for an animated camera move. */
export interface FlyToOptions {
	/** Animation duration in milliseconds. */
	duration?: number;
	/** ArcGIS easing name (e.g. `'ease-in-out'`). */
	easing?: string;
	/** SceneView padding to apply/animate alongside the camera. */
	padding?: { top: number; right: number; bottom: number; left: number };
}
