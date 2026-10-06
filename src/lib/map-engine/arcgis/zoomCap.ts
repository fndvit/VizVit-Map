/**
 * @module map-engine/arcgis/zoomCap
 * `maxZoom` on a 3D `SceneView`, which only knows an *altitude* constraint.
 *
 * A zoom level is a scale (`scaleForZoom`), and a `SceneView` relates scale to
 * camera distance through its field of view, which it spreads over the
 * viewport **diagonal**:
 *
 *     distance = scale × (0.0254 / 96) × diagonalPx / (2 · tan(fov / 2))
 *
 * `0.0254 / 96` is the metres one pixel stands for at scale 1 (ArcGIS's 96 DPI).
 * Measured against ArcGIS 5.1 at tilt 0 on the equator, zoom 12 (scale
 * 144,448) sat at 54,494 m in a 1280×752 view and at 29,414 m in a 390×700 one;
 * the formula gives both to the metre. The altitude for a zoom therefore
 * depends on the viewport, so one fixed altitude cannot mean "zoom 12" on a
 * phone and a desktop alike. {@link capSceneZoom} derives it from the live view
 * and re-derives it whenever the view is resized.
 *
 * The constraint bounds camera *altitude*, while scale follows the distance to
 * the view centre. Tilting the camera lengthens that distance, so at the cap a
 * tilted view sits slightly below `maxZoom` — never above it.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- ArcGIS dynamic imports have no static types */

import type { Handle } from '../provider.js';
import { scaleForZoom } from '../scale.js';

/** Metres one screen pixel stands for at scale 1:1 — ArcGIS assumes 96 DPI. */
const METERS_PER_PIXEL_AT_SCALE_1 = 0.0254 / 96;

/**
 * The camera distance at which a `SceneView` of the given size renders at a
 * scale.
 *
 * @param scale - Scale denominator (1:N).
 * @param fov - The camera's field of view in degrees (`camera.fov`, 55 by default).
 * @param width - View width in CSS pixels.
 * @param height - View height in CSS pixels.
 * @returns Camera distance to the view centre in metres (the altitude at tilt 0).
 */
export function sceneDistanceForScale(
	scale: number,
	fov: number,
	width: number,
	height: number
): number {
	const diagonal = Math.hypot(width, height);
	return (scale * METERS_PER_PIXEL_AT_SCALE_1 * diagonal) / (2 * Math.tan((fov * Math.PI) / 360));
}

/**
 * Keeps a `SceneView` from zooming in past `maxZoom` — wheel, pinch, `goTo`
 * and the zoom buttons alike, since all of them honour the view's altitude
 * constraint. Only the constraint's `min` is touched; zooming out keeps
 * whatever `max` the view has.
 *
 * @param view - A ready `SceneView`.
 * @param maxZoom - The deepest zoom level allowed (256 px tile scheme, as
 *   `scaleForZoom` counts it at the equator — the levels `view.zoom` reports
 *   and `goTo({ zoom })` takes, at any latitude).
 * @param floor - A lower altitude bound the cap must never go under, e.g. the
 *   `min` of an `altitudeConstraint` the view was built with.
 * @returns A handle that stops tracking viewport resizes.
 */
export function capSceneZoom(view: any, maxZoom: number, floor = -Infinity): Handle {
	const scale = scaleForZoom(maxZoom);
	const apply = () => {
		const { width, height } = view;
		const fov = view.camera?.fov;
		if (!width || !height || !fov) return;
		view.constraints.altitude.min = Math.max(
			floor,
			sceneDistanceForScale(scale, fov, width, height)
		);
	};
	apply();
	return view.watch('size', apply);
}
