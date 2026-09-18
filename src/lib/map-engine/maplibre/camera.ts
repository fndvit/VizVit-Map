/**
 * @module map-engine/maplibre/camera
 * Altitude ↔ zoom for the MapLibre adapter.
 *
 * The site's camera vocabulary is ArcGIS-shaped: a story step says "put the eye
 * at 12,000,000 m". MapLibre has no camera-altitude API in v5, so the adapter
 * converts, using the standard perspective relationship between the eye
 * distance, the vertical field of view and the ground resolution at a zoom.
 *
 * This is an approximation: it ignores tilt (the eye rises as the camera
 * pitches) and globe-projection curvature. It is accurate enough to place a
 * story camera, and it round-trips exactly — see the tests. Anything that needs
 * pixel parity with ArcGIS should tune through the LOD ladder, not here.
 */

/** Ground resolution in metres per pixel at zoom 0 on the equator (256 px tiles). */
const METERS_PER_PIXEL_Z0 = 156543.03392804097;

/** MapLibre's default vertical field of view, in radians (36.87°). */
export const DEFAULT_FOV = 0.6435011087932844;

/**
 * Ground resolution at a zoom and latitude.
 *
 * @param zoom - Map zoom level.
 * @param latitude - Latitude in degrees.
 * @returns Metres per pixel.
 */
export function metersPerPixel(zoom: number, latitude: number): number {
	const lat = Math.max(-85, Math.min(85, latitude));
	return (METERS_PER_PIXEL_Z0 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
}

/**
 * The camera's eye distance from the ground, in pixels, for a viewport height.
 * MapLibre places the eye so that the viewport's vertical half-angle is `fov/2`.
 *
 * @param viewportHeight - Viewport height in CSS pixels.
 * @param fov - Vertical field of view in radians.
 * @returns Eye distance in pixels.
 */
function eyeDistanceInPixels(viewportHeight: number, fov: number): number {
	return viewportHeight / 2 / Math.tan(fov / 2);
}

/**
 * Converts a zoom level to the equivalent camera altitude.
 *
 * @param zoom - Map zoom level.
 * @param latitude - Latitude in degrees.
 * @param viewportHeight - Viewport height in CSS pixels (default 800).
 * @param fov - Vertical field of view in radians (default {@link DEFAULT_FOV}).
 * @returns Camera altitude in metres.
 */
export function altitudeForZoom(
	zoom: number,
	latitude: number,
	viewportHeight = 800,
	fov = DEFAULT_FOV
): number {
	return eyeDistanceInPixels(viewportHeight, fov) * metersPerPixel(zoom, latitude);
}

/**
 * Converts a camera altitude to the equivalent zoom level — the inverse of
 * {@link altitudeForZoom}.
 *
 * @param altitude - Camera altitude in metres (must be > 0).
 * @param latitude - Latitude in degrees.
 * @param viewportHeight - Viewport height in CSS pixels (default 800).
 * @param fov - Vertical field of view in radians (default {@link DEFAULT_FOV}).
 * @returns The zoom level that puts the eye at `altitude`.
 */
export function zoomForAltitude(
	altitude: number,
	latitude: number,
	viewportHeight = 800,
	fov = DEFAULT_FOV
): number {
	const lat = Math.max(-85, Math.min(85, latitude));
	const groundAtZ0 = METERS_PER_PIXEL_Z0 * Math.cos((lat * Math.PI) / 180);
	return Math.log2((eyeDistanceInPixels(viewportHeight, fov) * groundAtZ0) / altitude);
}
