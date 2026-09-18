/**
 * @module map-engine/camera-fit
 * Fitting a geographic extent to a zoom level — provider-neutral arithmetic,
 * used when flying to a geocoded place.
 */

import type { PlaceExtent } from './geocode.js';

/** Degrees of longitude a ~1000 px-wide viewport spans at zoom 0 (360 × 1000/256). */
const VIEWPORT_SPAN_AT_ZOOM_0 = 1440;
/** Breathing-room factor so a place's extent doesn't touch the viewport edges. */
const EXTENT_PADDING_FACTOR = 1.4;
/** Widest landing zoom — a continent-sized extent never zooms out past this. */
const MIN_PLACE_ZOOM = 3;
/** Tightest landing zoom — a village-sized extent never dives past this. */
const MAX_PLACE_ZOOM = 10;

/**
 * Derives the zoom level at which a geocoded place's extent comfortably fills
 * the view, so flying to Girona lands close while flying to Spain stays wide.
 *
 * Each zoom level halves the visible span, so the fit is `log2` of the ratio
 * between a reference viewport's zoom-0 span and the (padded) extent span.
 * Clamped to [{@link MIN_PLACE_ZOOM}, {@link MAX_PLACE_ZOOM}] so continents
 * keep the globe readable and tiny places don't dive to street level.
 *
 * @param extent - Bounding box of the place in WGS84 degrees.
 * @returns Zoom level for the fly-to animation.
 */
export function zoomForExtent(extent: PlaceExtent): number {
	const span = Math.max(extent.xmax - extent.xmin, extent.ymax - extent.ymin, 0.001);
	const fit = Math.log2(VIEWPORT_SPAN_AT_ZOOM_0 / (span * EXTENT_PADDING_FACTOR));
	return Math.min(MAX_PLACE_ZOOM, Math.max(MIN_PLACE_ZOOM, fit));
}
