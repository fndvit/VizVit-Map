import { describe, it, expect, vi } from 'vitest';
import { createSceneView, createMapView } from '$lib/map-engine/arcgis/viewFactory';
import type { ArcgisModules } from '$lib/map-engine';

/* eslint-disable @typescript-eslint/no-explicit-any -- fakes stand in for ArcGIS objects */

/**
 * Fake ArcGIS constructors that record the options they were built with, so we
 * can assert the factory maps engine options onto the right ArcGIS shape — no
 * real SDK, GPU, or DOM required (dependency inversion makes this possible).
 */
function fakeModules(): ArcgisModules & {
	lastSceneViewOpts: any;
	lastMapViewOpts: any;
	lastMapOpts: any;
} {
	const bag: any = {};
	bag.Map = vi.fn(function (this: any, opts: any) {
		bag.lastMapOpts = opts;
		this.basemap = opts.basemap;
	});
	bag.SceneView = vi.fn(function (this: any, opts: any) {
		bag.lastSceneViewOpts = opts;
		this.navigation = { mouseWheelZoomEnabled: true, browserTouchPanEnabled: true };
		this.on = vi.fn();
	});
	bag.MapView = vi.fn(function (this: any, opts: any) {
		bag.lastMapViewOpts = opts;
	});
	bag.Basemap = vi.fn();
	bag.VectorTileLayer = vi.fn();
	return bag;
}

function fakeContainer() {
	return { addEventListener: vi.fn() } as unknown as HTMLElement;
}

const container = fakeContainer();

describe('createSceneView', () => {
	it('builds a global SceneView with the given basemap and camera', () => {
		const m = fakeModules();
		const camera = { longitude: 10, latitude: 20, z: 5_000_000, tilt: 30, heading: 90 };
		createSceneView(m, 'gray-vector', container, { mode: '3d', camera });

		expect(m.lastMapOpts.basemap).toBe('gray-vector');
		expect(m.lastSceneViewOpts.viewingMode).toBe('global');
		expect(m.lastSceneViewOpts.camera.position).toEqual({
			longitude: 10,
			latitude: 20,
			z: 5_000_000
		});
		expect(m.lastSceneViewOpts.camera.tilt).toBe(30);
		expect(m.lastSceneViewOpts.ui.components).toEqual([]);
	});

	it('uses transparent background + alpha compositing by default', () => {
		const m = fakeModules();
		createSceneView(m, 'gray', container, { mode: '3d' });
		expect(m.lastSceneViewOpts.environment.background.color).toEqual([0, 0, 0, 0]);
		expect(m.lastSceneViewOpts.alphaCompositingEnabled).toBe(true);
	});

	it('converts a hex background to rgba and disables alpha compositing', () => {
		const m = fakeModules();
		createSceneView(m, 'gray', container, { mode: '3d', background: '#f1eee8' });
		expect(m.lastSceneViewOpts.environment.background.color).toEqual([241, 238, 232, 1]);
		expect(m.lastSceneViewOpts.alphaCompositingEnabled).toBe(false);
	});

	// The ground surface (the sphere) is fully independent of the environment
	// background (the space around it): only `groundColor` colors the ground, and
	// it is never inferred from `background`.
	it('keeps a see-through ground surface when no groundColor is given', () => {
		const m = fakeModules();
		createSceneView(m, 'gray', container, { mode: '3d' });
		expect(m.lastMapOpts.ground.surfaceColor).toEqual([0, 0, 0, 0]);
	});

	it('does NOT infer the ground from an opaque background (they are independent)', () => {
		const m = fakeModules();
		createSceneView(m, 'gray', container, { mode: '3d', background: '#f1eee8' });
		// Opaque background, but no groundColor → ground stays see-through.
		expect(m.lastMapOpts.ground.surfaceColor).toEqual([0, 0, 0, 0]);
	});

	it('honors an explicit groundColor while keeping a transparent background (scrolly)', () => {
		const m = fakeModules();
		createSceneView(m, 'gray', container, { mode: '3d', groundColor: '#f1eee8' });
		// Ground is opaque so draped basemaps read light...
		expect(m.lastMapOpts.ground.surfaceColor).toEqual([241, 238, 232, 1]);
		// ...but the environment background stays transparent for compositing.
		expect(m.lastSceneViewOpts.environment.background.color).toEqual([0, 0, 0, 0]);
		expect(m.lastSceneViewOpts.alphaCompositingEnabled).toBe(true);
	});

	it('honors background and groundColor independently (explore/Our Stories)', () => {
		const m = fakeModules();
		createSceneView(m, 'gray', container, {
			mode: '3d',
			background: '#f1eee8',
			groundColor: '#f1eee8'
		});
		expect(m.lastMapOpts.ground.surfaceColor).toEqual([241, 238, 232, 1]);
		expect(m.lastSceneViewOpts.environment.background.color).toEqual([241, 238, 232, 1]);
		expect(m.lastSceneViewOpts.alphaCompositingEnabled).toBe(false);
	});

	it('applies an altitude constraint when provided', () => {
		const m = fakeModules();
		createSceneView(m, 'gray', container, { mode: '3d', altitudeConstraint: { min: 1, max: 1 } });
		expect(m.lastSceneViewOpts.constraints).toEqual({ altitude: { min: 1, max: 1 } });
	});

	it('locks navigation when not interactive', () => {
		const m = fakeModules();
		const { view } = createSceneView(m, 'gray', fakeContainer(), {
			mode: '3d',
			interactive: false
		});
		expect(view.navigation.mouseWheelZoomEnabled).toBe(false);
		expect(view.navigation.browserTouchPanEnabled).toBe(false);
		expect(view.on).toHaveBeenCalledWith('drag', expect.any(Function));
	});

	// A non-interactive globe must not swallow the wheel — a capture-phase passive
	// listener on the container stops it before ArcGIS's surface preventDefaults it,
	// so the page scrolls (a scrolly tooltip step can't trap the user).
	it('lets the page scroll over a non-interactive globe (wheel passthrough)', () => {
		const m = fakeModules();
		const c = fakeContainer();
		createSceneView(m, 'gray', c, { mode: '3d', interactive: false });
		expect(c.addEventListener).toHaveBeenCalledWith('wheel', expect.any(Function), {
			capture: true,
			passive: true
		});
	});

	it('leaves navigation enabled by default', () => {
		const m = fakeModules();
		const c = fakeContainer();
		const { view } = createSceneView(m, 'gray', c, { mode: '3d' });
		expect(view.navigation.mouseWheelZoomEnabled).toBe(true);
		expect(view.on).not.toHaveBeenCalled();
		expect(c.addEventListener).not.toHaveBeenCalled();
	});
});

describe('createMapView', () => {
	it('builds a MapView with center, zoom and the zoom widget by default', () => {
		const m = fakeModules();
		createMapView(m, 'gray', container, { mode: '2d', center: [5, 6], zoom: 4 });
		expect(m.lastMapOpts.basemap).toBe('gray');
		expect(m.lastMapViewOpts.center).toEqual([5, 6]);
		expect(m.lastMapViewOpts.zoom).toBe(4);
		expect(m.lastMapViewOpts.ui.components).toEqual(['zoom']);
	});

	it('falls back to NEUTRAL_MAP_DEFAULTS for center/zoom/constraints', () => {
		const m = fakeModules();
		createMapView(m, 'gray', container, { mode: '2d' });
		expect(m.lastMapViewOpts.center).toBeDefined();
		expect(m.lastMapViewOpts.constraints).toBeDefined();
	});
});
