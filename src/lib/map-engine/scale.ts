/**
 * @module map-engine/scale
 * The one place the map stack converts between *scale* and *zoom*.
 *
 * Scale (1:N at the view centre, ArcGIS convention, `0` = unbounded) is the
 * LOD currency of the whole explore stack: every tier window, size step,
 * permalink and `explore-config.json` speaks scale, and the dev panel tunes
 * those numbers by hand. Providers that think in zoom (MapLibre) derive scale
 * through these two functions so no persisted config ever has to change.
 */

/**
 * Web-Mercator scale denominator at zoom 0 for a 256 px tile at the equator
 * (`156543.03392804097 m/px × 96 dpi / 0.0254 m/in`).
 */
export const SCALE_Z0 = 591_657_550.5;

/**
 * Converts a map scale to the fractional tile zoom level that renders it.
 *
 * @param scale - Scale denominator (1:N). Must be > 0.
 * @param latitude - View-centre latitude in degrees. Defaults to the equator; pass
 *   the real latitude when the provider reports a *ground* scale (a 3D globe) so
 *   the tier handoffs land at the same visual density everywhere.
 * @returns Fractional zoom level.
 */
export function zoomForScale(scale: number, latitude = 0): number {
	const lat = Math.max(-85, Math.min(85, latitude));
	return Math.log2((SCALE_Z0 * Math.cos((lat * Math.PI) / 180)) / scale);
}

/**
 * Converts a tile zoom level to the scale denominator it renders at.
 *
 * @param zoom - Fractional zoom level.
 * @param latitude - View-centre latitude in degrees (see {@link zoomForScale}).
 * @returns Scale denominator (1:N).
 */
export function scaleForZoom(zoom: number, latitude = 0): number {
	const lat = Math.max(-85, Math.min(85, latitude));
	return (SCALE_Z0 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
}
