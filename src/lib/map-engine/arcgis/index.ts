/**
 * @module map-engine/arcgis
 * The ArcGIS adapter's public face: build a {@link MapProvider} over a fresh
 * `SceneView`/`MapView`.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- ArcGIS dynamic imports have no static types */

import type { MapProvider } from '../provider.js';
import type { MapEngineOptions } from '../types.js';
import { ArcgisProvider } from './ArcgisProvider.js';
import { loadArcgisCore } from './modules.js';
import { createMapView, createSceneView } from './viewFactory.js';
import { ARCGIS_LOADERS, type ArcgisLoaders } from './loaders.js';
import { initialBasemap } from './basemap.js';
import type { LayerCtors } from './layers.js';

export { ArcgisProvider } from './ArcgisProvider.js';
export { ARCGIS_LOADERS, type ArcgisLoaders, type ArcgisModuleName } from './loaders.js';
export { loadArcgisCore } from './modules.js';
export { toRgba } from './colors.js';
export { buildFlatStyle, isFlatBasemap } from './flatStyle.js';
export {
	createSceneView,
	createMapView,
	NEUTRAL_SCENE_CAMERA,
	NEUTRAL_MAP_DEFAULTS,
	type BuiltView
} from './viewFactory.js';
export { applyBasemap, initialBasemap, needsDeferredApply, type BasemapCache } from './basemap.js';

/**
 * The layer constructors the provider preloads. The contract's layer factory is
 * synchronous, so these must be in hand before a provider is handed out.
 */
const LAYER_CTOR_NAMES = ['GraphicsLayer', 'Graphic', 'GeoJSONLayer', 'Point'] as const;

/**
 * Builds an ArcGIS view and wraps it in a {@link MapProvider}.
 *
 * The returned provider is ready: the view has settled (`view.when()`), the
 * quality knobs are applied, and the layer constructors are preloaded.
 *
 * @param options - Engine options (mode, camera, background, quality, …). The
 *   basemap *id* is not read here — the engine resolves it through its catalog
 *   and applies it after the view is ready; a neutral placeholder is shown until
 *   then, exactly as before.
 * @param container - DOM element to render the view into.
 * @param loaders - Module loader registry (tests inject a fake).
 * @returns The ready provider.
 */
export async function createArcgisProvider(
	options: MapEngineOptions,
	container: HTMLElement,
	loaders: ArcgisLoaders = ARCGIS_LOADERS
): Promise<MapProvider> {
	const load = options.loadModules ?? loadArcgisCore;
	const modules = await load(options.mode);

	// The engine applies the real basemap after the view is ready; start from the
	// neutral flat placeholder so `view.when()` is never blocked on a network load.
	const basemap = initialBasemap(modules, {
		kind: 'flat',
		landColor: '#725B53',
		oceanColor: '#E5DACA'
	});

	const built =
		options.mode === '3d'
			? createSceneView(modules, basemap, container, options)
			: createMapView(modules, basemap, container, options);

	await built.view.when();

	const loaded = await Promise.all(
		LAYER_CTOR_NAMES.map((name) => loaders[name]().then((m: any) => m.default))
	);
	const ctors = Object.fromEntries(
		LAYER_CTOR_NAMES.map((name, i) => [name, loaded[i]])
	) as unknown as LayerCtors;

	const provider = new ArcgisProvider({
		view: built.view,
		modules,
		mode: options.mode,
		ctors,
		loaders
	});

	// Sub-native render resolution — a real framebuffer-memory cut on
	// memory-constrained devices. Applied after the view is ready because
	// `qualitySettings` only exists then.
	provider.scene.setQuality({ maxPixelRatio: options.maxPixelRatio });

	return provider;
}
