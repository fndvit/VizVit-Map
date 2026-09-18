/**
 * @module map-engine/arcgis/viewFactory
 * Pure constructors for an ArcGIS `Map` + view.
 *
 * Each function does one thing: build the Map with a ready basemap, then build
 * the view (SceneView or MapView) with environment/camera/constraints. They take
 * an already-resolved `basemap` value (string id or `Basemap` instance) so they
 * never touch the network — async basemap loading is the engine's job.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- ArcGIS dynamic imports have no static types */

import { toRgba } from './colors.js';
import type { ArcgisModules, MapEngineOptions, SceneCamera } from '../types.js';

/**
 * The subset of {@link MapEngineOptions} the view factories consume. The
 * `basemap` id is resolved by the engine and passed as a separate argument (never
 * read from here), and `loadModules` is the engine's concern — so both are
 * omitted, letting callers build a view without a basemap id in the options bag.
 */
export type ViewFactoryOptions = Omit<MapEngineOptions, 'basemap' | 'loadModules'>;

/** Result of building a view: the Map and the view that renders it. */
export interface BuiltView {
	/** The ArcGIS `Map` (or `SceneMap`) instance. */
	map: any;
	/** The `SceneView` (3D) or `MapView` (2D) instance. */
	view: any;
}

/**
 * The engine's own whole-earth camera, used when a caller supplies none. It is
 * deliberately neutral — an app with a house default (a region, a tilt) passes
 * its own `camera`; the engine never reaches into app config for one.
 */
export const NEUTRAL_SCENE_CAMERA: SceneCamera = {
	longitude: 0,
	latitude: 20,
	z: 12_000_000,
	tilt: 0,
	heading: 0
};

/** The engine's own neutral 2D defaults (see {@link NEUTRAL_SCENE_CAMERA}). */
export const NEUTRAL_MAP_DEFAULTS = {
	center: [0, 20] as [number, number],
	zoom: 3,
	constraints: { minZoom: 2, maxZoom: 10, rotationEnabled: false }
} as const;

/**
 * Disables all user navigation on a non-interactive view and lets the page
 * scroll over the globe (so a scrolly step can't trap the user).
 *
 * @param view - The view to lock down.
 * @param container - The view's container element (an ancestor of the surface).
 */
function lockNavigation(view: any, container: HTMLElement): void {
	view.navigation.mouseWheelZoomEnabled = false;
	view.navigation.browserTouchPanEnabled = false;
	view.on('drag', (e: any) => e.stopPropagation());
	view.on('key-down', (e: any) => e.stopPropagation());
	view.on('double-click', (e: any) => e.stopPropagation());
	// ArcGIS's surface attaches a non-passive `wheel` listener that preventDefaults
	// the event, which blocks the page from scrolling over a non-interactive globe
	// (e.g. a scrolly tooltip step whose wrapper is pointer-events:auto for hover).
	// Intercept the wheel in the CAPTURE phase on the container — an ancestor of the
	// surface — and stop it before ArcGIS sees it, WITHOUT preventDefault, so the
	// browser performs its native page scroll. Hover (pointer-move) is untouched.
	container.addEventListener('wheel', (e) => e.stopPropagation(), {
		capture: true,
		passive: true
	});
}

/**
 * Builds a 3D globe `SceneView` and its Map.
 *
 * @param modules - ArcGIS constructors (needs `Map` + `SceneView`).
 * @param basemap - Resolved basemap (id string or `Basemap` instance).
 * @param container - DOM element to render into.
 * @param opts - Engine options (camera, background, interactivity, constraints).
 * @returns The built {@link BuiltView}.
 */
export function createSceneView(
	modules: ArcgisModules,
	basemap: any,
	container: HTMLElement,
	opts: ViewFactoryOptions
): BuiltView {
	const camera = opts.camera ?? NEUTRAL_SCENE_CAMERA;
	const background = opts.background ?? 'transparent';
	const transparent = background === 'transparent';

	// The ground surface (the sphere itself) is fully independent of the
	// environment background (the space AROUND the sphere). An opaque ground makes
	// draped portal basemaps whose land fill isn't opaque (e.g. NatGeo Black Line
	// Base) read light instead of showing the black globe interior through them.
	// Callers that want an opaque ground must pass `groundColor` explicitly — it is
	// NOT inferred from the background. Default is a see-through surface.
	const map = new modules.Map({
		basemap,
		ground: { surfaceColor: opts.groundColor ? toRgba(opts.groundColor) : [0, 0, 0, 0] }
	});

	const view = new modules.SceneView({
		container,
		map,
		viewingMode: 'global',
		camera: {
			position: { longitude: camera.longitude, latitude: camera.latitude, z: camera.z },
			tilt: camera.tilt,
			heading: camera.heading
		},
		environment: {
			background: { type: 'color', color: toRgba(background) },
			atmosphereEnabled: false,
			starsEnabled: false,
			// Virtual lighting with direct shadows OFF and clear ("sunny") weather.
			// Shadow maps and weather effects each allocate their own GPU buffers and
			// are invisible on this near-flat draped globe, so dropping them trims
			// WebGL memory (helps memory-constrained mobile). SSAO is already off at
			// the 'low' quality profile mobile uses.
			lighting: { type: 'virtual', directShadowsEnabled: false },
			weather: { type: 'sunny' }
		},
		ui: { components: opts.uiComponents ?? [] },
		alphaCompositingEnabled: transparent,
		qualityProfile: opts.qualityProfile ?? 'medium',
		...(opts.altitudeConstraint ? { constraints: { altitude: opts.altitudeConstraint } } : {})
	});

	if (opts.interactive === false) lockNavigation(view, container);

	return { map, view };
}

/**
 * Builds a 2D `MapView` and its Map.
 *
 * @param modules - ArcGIS constructors (needs `Map` + `MapView`).
 * @param basemap - Resolved basemap (id string or `Basemap` instance).
 * @param container - DOM element to render into.
 * @param opts - Engine options (center, zoom, constraints, UI).
 * @returns The built {@link BuiltView}.
 */
export function createMapView(
	modules: ArcgisModules,
	basemap: any,
	container: HTMLElement,
	opts: ViewFactoryOptions
): BuiltView {
	const map = new modules.Map({ basemap });

	const view = new modules.MapView({
		container,
		map,
		center: opts.center ?? NEUTRAL_MAP_DEFAULTS.center,
		zoom: opts.zoom ?? NEUTRAL_MAP_DEFAULTS.zoom,
		constraints: opts.constraints ?? NEUTRAL_MAP_DEFAULTS.constraints,
		ui: { components: opts.uiComponents ?? ['zoom'] }
	});

	return { map, view };
}
