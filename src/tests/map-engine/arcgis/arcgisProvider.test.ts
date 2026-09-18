import { describe, it, expect, vi, beforeEach } from 'vitest';

/* eslint-disable @typescript-eslint/no-explicit-any -- fakes stand in for ArcGIS objects */

import { ArcgisProvider } from '$lib/map-engine/arcgis/ArcgisProvider';
import { ProviderMismatchError, zoomForScale } from '$lib/map-engine';

/** A fake ArcGIS `GraphicsLayer`. */
class FakeGraphicsLayer {
	graphics: any[] = [];
	visible = true;
	opacity = 1;
	minScale = 0;
	maxScale = 0;
	elevationInfo: any;
	constructor(public opts: any) {
		Object.assign(this, opts);
	}
	removeAll() {
		this.graphics = [];
	}
	add(g: any) {
		g.layer = this;
		this.graphics.push(g);
	}
}

/** A fake ArcGIS `GeoJSONLayer`. */
class FakeGeoJSONLayer {
	visible = true;
	opacity = 1;
	minScale = 0;
	maxScale = 0;
	renderer: any;
	url: string;
	elevationInfo: any;
	constructor(public opts: any) {
		Object.assign(this, opts);
		this.url = opts.url;
	}
}

class FakeGraphic {
	layer: any = null;
	constructor(public props: any) {
		Object.assign(this, props);
	}
}

class FakePoint {
	longitude: number;
	latitude: number;
	constructor(opts: any) {
		this.longitude = opts.longitude;
		this.latitude = opts.latitude;
	}
}

/** A fake view that records watchers and answers projections deterministically. */
function fakeView() {
	const watchers: Record<string, (v: any) => void> = {};
	const handlers: Record<string, (e: any) => void> = {};
	let hit: any[] = [];
	const view: any = {
		map: { add: vi.fn(), remove: vi.fn(), ground: {} },
		camera: {
			position: { longitude: 10, latitude: 20, z: 1_000_000 },
			tilt: 30,
			heading: 40,
			clone() {
				return {
					position: { ...view.camera.position },
					tilt: view.camera.tilt,
					heading: view.camera.heading
				};
			}
		},
		scale: 5_000_000,
		width: 800,
		height: 600,
		padding: { top: 0, right: 0, bottom: 0, left: 0 },
		container: { style: { cursor: '' } },
		environment: { background: { color: null } },
		qualitySettings: { maximumPixelRatio: 1 },
		updating: false,
		interacting: false,
		goTo: vi.fn(async () => {}),
		toScreen: vi.fn((p: any) => ({ x: p.longitude * 2, y: p.latitude * 3 })),
		toMap: vi.fn((p: any) => ({ longitude: p.x / 2, latitude: p.y / 3 })),
		hitTest: vi.fn(async () => ({ results: hit })),
		on: vi.fn((name: string, cb: any) => {
			handlers[name] = cb;
			return { remove: vi.fn() };
		}),
		watch: vi.fn((name: string, cb: any) => {
			watchers[name] = cb;
			return { remove: vi.fn() };
		}),
		destroy: vi.fn()
	};
	return {
		view,
		fire: (name: string, e: any) => handlers[name]?.(e),
		tick: (name: string, v: any) => watchers[name]?.(v),
		setHit: (results: any[]) => {
			hit = results;
		}
	};
}

function makeProvider() {
	const f = fakeView();
	const provider = new ArcgisProvider({
		view: f.view,
		modules: { Map: vi.fn(), Basemap: vi.fn(), VectorTileLayer: vi.fn() } as any,
		mode: '3d',
		ctors: {
			GraphicsLayer: FakeGraphicsLayer,
			Graphic: FakeGraphic,
			GeoJSONLayer: FakeGeoJSONLayer,
			Point: FakePoint
		} as any,
		loaders: { Thing: async () => ({ default: 'THING' }) } as any
	});
	return { provider, ...f };
}

const SYMBOL = {
	shape: 'diamond' as const,
	size: 12,
	color: [1, 2, 3, 1] as [number, number, number, number],
	outline: { color: [4, 5, 6, 1] as [number, number, number, number], width: 2 }
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe('ArcgisProvider — camera port', () => {
	it('reads the camera and derives zoom from the view scale', () => {
		const { provider, view } = makeProvider();
		const cam = provider.camera.get()!;
		expect(cam).toMatchObject({ longitude: 10, latitude: 20, z: 1_000_000, tilt: 30, heading: 40 });
		expect(cam.scale).toBe(view.scale);
		expect(cam.zoom).toBeCloseTo(zoomForScale(view.scale, 20), 9);
	});

	it('flies by altitude through a cloned camera', async () => {
		const { provider, view } = makeProvider();
		await provider.camera.flyTo({ longitude: 1, latitude: 2, z: 500, tilt: 10, heading: 20 });
		const [target, animation] = (view.goTo as any).mock.calls[0];
		expect(target.position).toEqual({ longitude: 1, latitude: 2, z: 500 });
		expect(target.tilt).toBe(10);
		expect(animation).toEqual({ duration: 1500, easing: 'ease-in-out' });
	});

	it('flies by zoom when no altitude is given', async () => {
		const { provider, view } = makeProvider();
		await provider.camera.flyTo({ longitude: 3, latitude: 4, zoom: 7 }, { duration: 0 });
		expect((view.goTo as any).mock.calls[0][0]).toMatchObject({ center: [3, 4], zoom: 7 });
	});

	it('converts a scale target into a zoom', async () => {
		const { provider, view } = makeProvider();
		await provider.camera.flyTo({ longitude: 0, latitude: 0, scale: 100_000 });
		expect((view.goTo as any).mock.calls[0][0].zoom).toBeCloseTo(zoomForScale(100_000, 0), 9);
	});

	it('resolves rather than rejects when a newer move aborts this one', async () => {
		const { provider, view } = makeProvider();
		(view.goTo as any).mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'AbortError' }));
		await expect(provider.camera.flyTo({ z: 1 })).resolves.toBeUndefined();
	});
});

describe('ArcgisProvider — screen port', () => {
	it('projects ground to screen and back', () => {
		const { provider } = makeProvider();
		expect(provider.screen.toScreen({ lng: 5, lat: 6 })).toEqual({ x: 10, y: 18 });
		expect(provider.screen.toMap({ x: 10, y: 18 })).toEqual({ lng: 5, lat: 6 });
	});

	it('reuses one Point across projections (no per-frame allocation)', () => {
		const { provider, view } = makeProvider();
		provider.screen.toScreen({ lng: 1, lat: 1 });
		provider.screen.toScreen({ lng: 2, lat: 2 });
		const [first, second] = (view.toScreen as any).mock.calls;
		expect(first[0]).toBe(second[0]);
	});

	it('reports a miss when the point does not project', () => {
		const { provider, view } = makeProvider();
		(view.toScreen as any).mockReturnValueOnce(null);
		expect(provider.screen.toScreen({ lng: 0, lat: 0 })).toBeNull();
	});
});

describe('ArcgisProvider — event port', () => {
	it('maps a click to screen coords plus lng/lat', () => {
		const { provider, fire } = makeProvider();
		const seen: any[] = [];
		provider.events.on('click', (e) => seen.push(e));
		fire('click', { x: 7, y: 8, mapPoint: { longitude: 11, latitude: 12 } });
		expect(seen[0]).toMatchObject({ x: 7, y: 8, lngLat: { lng: 11, lat: 12 } });
	});

	it('reports a click off the globe as a null lngLat', () => {
		const { provider, fire } = makeProvider();
		const seen: any[] = [];
		provider.events.on('click', (e) => seen.push(e));
		fire('click', { x: 1, y: 2 });
		expect(seen[0].lngLat).toBeNull();
	});

	it('emits the whole camera state on a camera change', () => {
		const { provider, tick } = makeProvider();
		const seen: any[] = [];
		provider.events.on('camera', (c) => seen.push(c));
		tick('camera', null);
		expect(seen[0]).toMatchObject({ longitude: 10, scale: 5_000_000 });
	});

	it('passes the boolean flags straight through', () => {
		const { provider, tick } = makeProvider();
		const seen: boolean[] = [];
		provider.events.on('stationary', (v) => seen.push(v));
		tick('stationary', true);
		expect(seen).toEqual([true]);
	});

	it('reads the synchronous flags from the live view', () => {
		const { provider, view } = makeProvider();
		expect(provider.events.interacting).toBe(false);
		view.interacting = true;
		view.updating = true;
		expect(provider.events.interacting).toBe(true);
		expect(provider.events.updating).toBe(true);
	});
});

describe('ArcgisProvider — scene port', () => {
	it('sets an rgba background and toggles alpha compositing', () => {
		const { provider, view } = makeProvider();
		provider.scene.setBackground('transparent');
		expect(view.environment.background.color).toEqual([0, 0, 0, 0]);
		expect(view.alphaCompositingEnabled).toBe(true);
		provider.scene.setBackground('#ff0000');
		expect(view.environment.background.color).toEqual([255, 0, 0, 1]);
		expect(view.alphaCompositingEnabled).toBe(false);
	});

	it('colours the ground surface independently of the background', () => {
		const { provider, view } = makeProvider();
		provider.scene.setGround('#ffffff');
		expect(view.map.ground.surfaceColor).toEqual([255, 255, 255, 1]);
	});

	it('applies the quality profile and the pixel-ratio cap', () => {
		const { provider, view } = makeProvider();
		provider.scene.setQuality({ profile: 'low', maxPixelRatio: 0.6 });
		expect(view.qualityProfile).toBe('low');
		expect(view.qualitySettings.maximumPixelRatio).toBe(0.6);
	});

	it('resolves whenSettled immediately once the view is idle', async () => {
		const { provider } = makeProvider();
		await expect(provider.scene.whenSettled()).resolves.toBeUndefined();
	});

	it('waits for updating to clear when the view is busy', async () => {
		const { provider, view, tick } = makeProvider();
		view.updating = true;
		let settled = false;
		const pending = provider.scene.whenSettled().then(() => (settled = true));
		expect(settled).toBe(false);
		tick('updating', false);
		await pending;
		expect(settled).toBe(true);
	});

	it('sets the cursor on the view container', () => {
		const { provider, view } = makeProvider();
		provider.scene.setCursor('pointer');
		expect(view.container.style.cursor).toBe('pointer');
	});
});

describe('ArcgisProvider — points layer', () => {
	it('adds the layer to the map and builds a graphic per item', () => {
		const { provider, view } = makeProvider();
		const layer = provider.layers.points({
			id: 'markers',
			placement: 'floating',
			items: [{ id: 'a', lng: 1, lat: 2, symbol: SYMBOL }]
		});

		expect(view.map.add).toHaveBeenCalledOnce();
		const arcLayer = (view.map.add as any).mock.calls[0][0];
		expect(arcLayer.elevationInfo).toEqual({ mode: 'relative-to-ground' });
		expect(arcLayer.graphics).toHaveLength(1);
		expect(arcLayer.graphics[0].symbol).toMatchObject({
			type: 'simple-marker',
			style: 'diamond',
			size: 12
		});
		expect(arcLayer.graphics[0].attributes).toEqual({ __id: 'a', __hittable: true });
		expect(layer.id).toBe('markers');
	});

	it('replaces all items on set', () => {
		const { provider, view } = makeProvider();
		const layer = provider.layers.points({
			id: 'm',
			items: [{ id: 'a', lng: 0, lat: 0, symbol: SYMBOL }]
		});
		layer.set([
			{ id: 'b', lng: 1, lat: 1, symbol: SYMBOL },
			{ id: 'c', lng: 2, lat: 2, symbol: SYMBOL }
		]);
		const arcLayer = (view.map.add as any).mock.calls[0][0];
		expect(arcLayer.graphics.map((g: any) => g.attributes.__id)).toEqual(['b', 'c']);
	});

	it('restyles one item in place', () => {
		const { provider, view } = makeProvider();
		const layer = provider.layers.points({
			id: 'm',
			items: [
				{ id: 'a', lng: 0, lat: 0, symbol: SYMBOL },
				{ id: 'b', lng: 1, lat: 1, symbol: SYMBOL }
			]
		});
		layer.restyle('b', { ...SYMBOL, size: 99 });
		const arcLayer = (view.map.add as any).mock.calls[0][0];
		expect(arcLayer.graphics[0].symbol.size).toBe(12);
		expect(arcLayer.graphics[1].symbol.size).toBe(99);
	});

	it('answers a hit test with the item id, and only for its own hittable graphics', async () => {
		const { provider, view, setHit } = makeProvider();
		const layer = provider.layers.points({
			id: 'm',
			items: [{ id: 'a', lng: 0, lat: 0, symbol: SYMBOL }]
		});
		const arcLayer = (view.map.add as any).mock.calls[0][0];

		setHit([{ type: 'graphic', graphic: arcLayer.graphics[0] }]);
		await expect(layer.hitTest({ x: 1, y: 1 })).resolves.toBe('a');

		// A graphic from another layer, or a non-hittable one, is not ours.
		setHit([
			{ type: 'graphic', graphic: { layer: {}, attributes: { __id: 'z', __hittable: true } } }
		]);
		await expect(layer.hitTest({ x: 1, y: 1 })).resolves.toBeNull();

		arcLayer.graphics[0].attributes.__hittable = false;
		setHit([{ type: 'graphic', graphic: arcLayer.graphics[0] }]);
		await expect(layer.hitTest({ x: 1, y: 1 })).resolves.toBeNull();
	});

	it('maps the common handle members onto the ArcGIS layer', () => {
		const { provider, view } = makeProvider();
		const layer = provider.layers.points({ id: 'm' });
		const arcLayer = (view.map.add as any).mock.calls[0][0];

		layer.setVisible(false);
		layer.setOpacity(0.5);
		layer.setScaleRange(1000, 10);
		layer.setPlacement('draped');

		expect(arcLayer.visible).toBe(false);
		expect(arcLayer.opacity).toBe(0.5);
		expect(arcLayer.minScale).toBe(1000);
		expect(arcLayer.maxScale).toBe(10);
		expect(arcLayer.elevationInfo).toEqual({ mode: 'on-the-ground' });
		expect(layer.getVisible()).toBe(false);
		expect(layer.getOpacity()).toBe(0.5);
	});
});

describe('ArcgisProvider — geojson layer', () => {
	it('builds a stroke-only renderer from a url source', () => {
		const { provider, view } = makeProvider();
		provider.layers.geojson({
			id: 'cerrado',
			source: { url: '/cerrado.geojson' },
			style: { stroke: { color: '#c00', width: 1.5 } }
		});
		const arcLayer = (view.map.add as any).mock.calls[0][0];
		expect(arcLayer.url).toBe('/cerrado.geojson');
		expect(arcLayer.renderer.symbol.color).toEqual([0, 0, 0, 0]);
		expect(arcLayer.renderer.symbol.outline).toEqual({ color: '#c00', width: 1.5 });
	});

	it('rebuilds the renderer on setStyle', () => {
		const { provider, view } = makeProvider();
		const layer = provider.layers.geojson({
			id: 'x',
			source: { url: '/x.geojson' },
			style: { stroke: { color: '#000', width: 1 } }
		});
		layer.setStyle({ fill: '#abc', stroke: { color: '#fff', width: 3 } });
		const arcLayer = (view.map.add as any).mock.calls[0][0];
		expect(arcLayer.renderer.symbol.color).toBe('#abc');
		expect(arcLayer.renderer.symbol.outline).toEqual({ color: '#fff', width: 3 });
	});
});

describe('ArcgisProvider — layer registry and lifecycle', () => {
	it('lists live layers and drops them when they remove themselves', () => {
		const { provider } = makeProvider();
		const a = provider.layers.points({ id: 'a' });
		provider.layers.geojson({ id: 'b', source: { url: '/b.json' }, style: {} });
		expect(provider.layers.all.map((l) => l.id)).toEqual(['a', 'b']);

		a.remove();
		expect(provider.layers.all.map((l) => l.id)).toEqual(['b']);
	});

	it('destroys the view, its layers and the cached basemaps', () => {
		const { provider, view } = makeProvider();
		provider.layers.points({ id: 'a' });
		provider.destroy();

		expect(view.map.remove).toHaveBeenCalledOnce();
		expect(view.destroy).toHaveBeenCalledOnce();
		expect(provider.layers.all).toHaveLength(0);
	});
});

describe('ArcgisProvider — native escape hatch', () => {
	it('hands back the view, the map and a de-duped module loader', async () => {
		const { provider, view } = makeProvider();
		const native = provider.native('arcgis');
		expect(native.view).toBe(view);
		expect(native.map).toBe(view.map);
		await expect(native.loadModules(['Thing'])).resolves.toEqual({ Thing: 'THING' });
	});

	it('rejects an unknown module name', async () => {
		const { provider } = makeProvider();
		await expect(provider.native('arcgis').loadModules(['Nope'])).rejects.toThrow(
			/Unknown ArcGIS module: Nope/
		);
	});

	it('throws for any other provider', () => {
		const { provider } = makeProvider();
		expect(() => provider.native('maplibre')).toThrow(ProviderMismatchError);
	});
});
