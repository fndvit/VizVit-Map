/**
 * @module map-engine/maplibre
 * The MapLibre adapter's public face: build a {@link MapProvider} over a fresh
 * `maplibregl.Map`.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- the MapLibre map is loaded dynamically */

import type { MapProvider } from '../provider.js';
import type { MapEngineOptions } from '../types.js';
import { MaplibreProvider, flatStyleFor } from './MaplibreProvider.js';
import { zoomForAltitude } from './camera.js';

export { MaplibreProvider, flatStyleFor } from './MaplibreProvider.js';
export { altitudeForZoom, zoomForAltitude, metersPerPixel, DEFAULT_FOV } from './camera.js';
export { zoomRangeForScaleWindow } from './layers.js';

/** The style a map starts on, before the engine applies the real basemap. */
const PLACEHOLDER_STYLE = flatStyleFor('#725B53', '#E5DACA');

/**
 * Builds a MapLibre map and wraps it in a {@link MapProvider}.
 *
 * `'3d'` mode uses MapLibre's globe projection, so the same camera and pin
 * projection the ArcGIS globes use still mean what they say.
 *
 * @param options - Engine options (mode, camera, interactivity, quality, …).
 *   The basemap *id* is not read here: the engine resolves it through its
 *   catalog and applies it once the map is ready.
 * @param container - DOM element to render the map into.
 * @returns The ready provider.
 */
export async function createMaplibreProvider(
	options: MapEngineOptions,
	container: HTMLElement
): Promise<MapProvider> {
	const maplibre: any = await import('maplibre-gl');
	// The stylesheet ships with the package and is only needed on pages that
	// actually build a MapLibre map, so it is imported here rather than globally.
	await import('maplibre-gl/dist/maplibre-gl.css');
	const MapCtor = maplibre.Map ?? maplibre.default?.Map;

	const camera = options.camera;
	const height = container.clientHeight || 800;
	const zoom =
		options.mode === '3d' && camera
			? zoomForAltitude(camera.z, camera.latitude, height)
			: (options.zoom ?? 3);

	const map = new MapCtor({
		container,
		style: PLACEHOLDER_STYLE,
		center: camera ? [camera.longitude, camera.latitude] : (options.center ?? [0, 20]),
		zoom,
		pitch: camera?.tilt ?? 0,
		bearing: camera?.heading ?? 0,
		interactive: options.interactive !== false,
		attributionControl: false
	});

	await new Promise<void>((resolve) => {
		if (map.loaded?.()) resolve();
		else map.once('load', () => resolve());
	});

	const provider = new MaplibreProvider({ map, container, mode: options.mode });
	// Globe projection is a style property in MapLibre, so it is applied to the
	// live map rather than passed to the constructor (which ignores it).
	provider.applyProjection();
	if (options.background) provider.scene.setBackground(options.background);
	provider.scene.setQuality({ maxPixelRatio: options.maxPixelRatio });
	return provider;
}
