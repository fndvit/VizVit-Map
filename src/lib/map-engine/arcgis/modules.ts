/**
 * @module map-engine/arcgis/modules
 * The single place that dynamically imports `@arcgis/core` view constructors.
 *
 * Replaces the `Promise.all(import('@arcgis/core/...'))` block that was
 * copy-pasted into every globe component. Returns a plain object of
 * constructors so it can be injected into the engine and faked in tests.
 */

import type { ArcgisModules, ViewMode } from '../types.js';

/**
 * Loads the ArcGIS SDK constructors needed to build a view of the given mode.
 * In `'3d'` mode this includes `SceneView`; in `'2d'` mode, `MapView`.
 *
 * @param mode - The view mode to load modules for.
 * @returns The constructors the engine needs ({@link ArcgisModules}).
 */
export async function loadArcgisCore(mode: ViewMode): Promise<ArcgisModules> {
	const [{ default: Map }, { default: Basemap }, { default: VectorTileLayer }] = await Promise.all([
		import('@arcgis/core/Map'),
		import('@arcgis/core/Basemap'),
		import('@arcgis/core/layers/VectorTileLayer')
	]);

	if (mode === '3d') {
		const { default: SceneView } = await import('@arcgis/core/views/SceneView');
		return { Map, Basemap, VectorTileLayer, SceneView };
	}

	const { default: MapView } = await import('@arcgis/core/views/MapView');
	return { Map, Basemap, VectorTileLayer, MapView };
}
