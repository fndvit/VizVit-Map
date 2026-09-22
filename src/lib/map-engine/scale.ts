/**
 * @module map-engine/scale
 * The one place the map stack converts between *scale* and *zoom*.
 *
 * Scale (1:N at the view centre, ArcGIS convention, `0` = unbounded) is the
 * LOD currency of the whole explore stack: every tier window, size step,
 * permalink and `explore-config.json` speaks scale, and the dev panel tunes
 * those numbers by hand. Providers that think in zoom (MapLibre) derive scale
 * through these two functions so no persisted config ever has to change.
 *
 * Zoom is not one number system, though. A zoom level names a tile level, and
 * what scale that level renders at depends on the **tile scheme**: the tile
 * size the levels were authored for (256 px web-mercator tiles, or the 512 px
 * tiles Esri VectorTileServers publish), and how the renderer snaps a view
 * scale to a level (ArcGIS picks the *nearest* LOD for a `VectorTileLayer`, so
 * a style zoom takes effect half a level later than its LOD scale). Both are
 * properties of the service being drawn, not of the map, so both are options
 * here rather than constants somewhere else. Getting either wrong puts every
 * derived band one level (or half a level) out.
 */

/**
 * Web-Mercator scale denominator at zoom 0 for a 256 px tile at the equator —
 * the value ArcGIS publishes as LOD 0 of its default tiling scheme
 * (`tileInfo.lods[0].scale`), so scales derived here agree with the LOD tables
 * of every Esri tile service to the digit.
 */
export const SCALE_Z0 = 591_657_527.591555;

/**
 * How a zoom level maps onto a scale, for one tile service.
 */
export interface ZoomScaleOptions {
	/**
	 * View-centre latitude in degrees. Defaults to the equator; pass the real
	 * latitude when the provider reports a *ground* scale (a 3D globe) so tier
	 * handoffs land at the same visual density everywhere.
	 */
	latitude?: number;
	/**
	 * Tile size the zoom levels are authored for. `256` is the web-mercator
	 * default; `512` is what Esri VectorTileServers publish, and halves the
	 * scale at every level (level 0 covers the world in one 512 px tile).
	 */
	tilePx?: 256 | 512;
	/**
	 * LOD snap, in levels: how far past a level's own scale the view must go
	 * before a renderer that snaps to the NEAREST level actually switches. ArcGIS
	 * `VectorTileLayer` switches at the midpoint between two LODs, i.e. `0.5`.
	 * Default `0` (a level takes effect exactly at its scale).
	 */
	snap?: number;
}

/** A complete scheme, every option resolved. */
interface ResolvedScheme {
	latitude: number;
	tilePx: 256 | 512;
	snap: number;
}

/**
 * Resolves the second argument of the two conversions: a bare number keeps its
 * original meaning (latitude), an options object may set any of the three.
 *
 * @param options - Latitude, or a full {@link ZoomScaleOptions}.
 * @returns Every option resolved to a value.
 */
function resolve(options: number | ZoomScaleOptions | undefined): ResolvedScheme {
	if (typeof options === 'number') return { latitude: options, tilePx: 256, snap: 0 };
	return {
		latitude: options?.latitude ?? 0,
		tilePx: options?.tilePx ?? 256,
		snap: options?.snap ?? 0
	};
}

/**
 * The scale denominator at zoom 0 for a scheme: the reference value, narrowed
 * by latitude on a ground scale and halved for 512 px tiles.
 *
 * @param scheme - The resolved scheme.
 * @returns Scale at zoom 0.
 */
function scaleAtZoom0(scheme: ResolvedScheme): number {
	const lat = Math.max(-85, Math.min(85, scheme.latitude));
	return (SCALE_Z0 * Math.cos((lat * Math.PI) / 180)) / (scheme.tilePx / 256);
}

/**
 * Converts a map scale to the fractional zoom level in effect at it.
 *
 * @param scale - Scale denominator (1:N). Must be > 0.
 * @param options - View-centre latitude in degrees, or a {@link ZoomScaleOptions}
 *   naming the tile scheme the zoom belongs to.
 * @returns Fractional zoom level, in the scheme's own units (comparable with a
 *   style's `minzoom`/`maxzoom` when the scheme is the style's service).
 */
export function zoomForScale(scale: number, options?: number | ZoomScaleOptions): number {
	const scheme = resolve(options);
	return Math.log2(scaleAtZoom0(scheme) / scale) - scheme.snap;
}

/**
 * Converts a zoom level to the scale denominator at which it takes effect.
 *
 * @param zoom - Fractional zoom level.
 * @param options - View-centre latitude in degrees, or a {@link ZoomScaleOptions}
 *   naming the tile scheme (see {@link zoomForScale}).
 * @returns Scale denominator (1:N).
 */
export function scaleForZoom(zoom: number, options?: number | ZoomScaleOptions): number {
	const scheme = resolve(options);
	return scaleAtZoom0(scheme) / Math.pow(2, zoom + scheme.snap);
}
