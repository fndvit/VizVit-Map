import { describe, it, expect, vi } from 'vitest';
import { capSceneZoom, sceneDistanceForScale } from '$lib/map-engine/arcgis/zoomCap';
import { scaleForZoom } from '$lib/map-engine/scale';

/* eslint-disable @typescript-eslint/no-explicit-any -- fakes stand in for ArcGIS objects */

/** The scale ArcGIS 5.1 reported at `view.zoom === 12`. */
const Z12_SCALE = 144_448;

/**
 * A fake `SceneView`: size, camera fov, the altitude constraint and the one
 * `watch('size')` the cap subscribes to, with a way to fire it.
 *
 * @param width - View width in px.
 * @param height - View height in px.
 * @returns The fake view plus `resize`, which changes the size and fires the watch.
 */
function fakeView(width: number, height: number) {
	let onSize: (() => void) | null = null;
	const remove = vi.fn();
	const view: any = {
		width,
		height,
		camera: { fov: 55 },
		constraints: { altitude: { min: -200_000, max: 25_512_548 } },
		watch: vi.fn((prop: string, cb: () => void) => {
			if (prop === 'size') onSize = cb;
			return { remove };
		})
	};
	const resize = (w: number, h: number) => {
		view.width = w;
		view.height = h;
		onSize?.();
	};
	return { view, resize, remove };
}

describe('sceneDistanceForScale', () => {
	// Camera altitudes read off a live SceneView at zoom 12, tilt 0, equator.
	it.each([
		[1280, 752, 54_494],
		[390, 700, 29_414]
	])('matches ArcGIS at zoom 12 in a %ix%i view', (w, h, measured) => {
		expect(sceneDistanceForScale(Z12_SCALE, 55, w, h)).toBeCloseTo(measured, -1);
	});

	it('halves with each zoom level', () => {
		const z11 = sceneDistanceForScale(scaleForZoom(11), 55, 1000, 800);
		const z12 = sceneDistanceForScale(scaleForZoom(12), 55, 1000, 800);
		expect(z11 / z12).toBeCloseTo(2, 10);
	});
});

describe('capSceneZoom', () => {
	it('sets the altitude min for the view and leaves max alone', () => {
		const { view } = fakeView(1280, 752);
		capSceneZoom(view, 12);
		expect(view.constraints.altitude.min).toBeCloseTo(54_494, -1);
		expect(view.constraints.altitude.max).toBe(25_512_548);
	});

	it('re-derives the min when the view is resized', () => {
		const { view, resize } = fakeView(1280, 752);
		capSceneZoom(view, 12);
		resize(390, 700);
		expect(view.constraints.altitude.min).toBeCloseTo(29_414, -1);
	});

	it('never goes under the floor', () => {
		const { view } = fakeView(390, 700);
		capSceneZoom(view, 12, 100_000);
		expect(view.constraints.altitude.min).toBe(100_000);
	});

	it('skips a zero-size view instead of capping at altitude 0', () => {
		const { view, resize } = fakeView(0, 0);
		capSceneZoom(view, 12);
		expect(view.constraints.altitude.min).toBe(-200_000);
		resize(1280, 752);
		expect(view.constraints.altitude.min).toBeCloseTo(54_494, -1);
	});

	it('returns the size watch handle', () => {
		const { view, remove } = fakeView(1280, 752);
		capSceneZoom(view, 12).remove();
		expect(remove).toHaveBeenCalled();
	});
});
