import { describe, it, expect, vi, beforeEach } from 'vitest';

/* eslint-disable @typescript-eslint/no-explicit-any -- the fake provider stands in for a live view */

import { MapEngine } from '$lib/map-engine/MapEngine';
import type { BasemapCatalog, BasemapSpec, MapProvider } from '$lib/map-engine';
import { makeFakeProvider, type FakeProvider } from '$lib/testing/fakeProvider';

const container = {} as HTMLElement;

/** A catalog that resolves every id to a distinguishable spec and records decorations. */
function fakeCatalog() {
	const decorated: { spec: BasemapSpec; labelOverlay?: boolean }[] = [];
	const catalog: BasemapCatalog = {
		resolve: vi.fn((id: string, customColors?: any): BasemapSpec => {
			if (id.startsWith('flat')) {
				return {
					kind: 'flat',
					landColor: customColors?.landColor ?? '#111111',
					oceanColor: customColors?.oceanColor ?? '#222222'
				};
			}
			return { kind: 'well-known', id };
		}),
		decorate: vi.fn(async (_p: MapProvider, spec: BasemapSpec, opts: any) => {
			decorated.push({ spec, labelOverlay: opts.labelOverlay });
		})
	};
	return { catalog, decorated };
}

/** Builds an engine over a fake provider, returning both. */
function makeEngine(options: Record<string, unknown> = {}) {
	const provider = makeFakeProvider();
	const engine = new MapEngine({
		mode: '3d',
		basemap: 'flat-natgeo',
		createProvider: async () => provider as unknown as MapProvider,
		...options
	} as any);
	return { engine, provider };
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('MapEngine construction', () => {
	it('throws when no basemap is provided', () => {
		// A view has no sensible basemap-less default — refuse to invent one so a
		// misconfigured caller fails loud instead of silently rendering a fallback.
		expect(() => new MapEngine({ mode: '3d' } as any)).toThrow(/requires a basemap/);
	});

	it('reports the configured provider kind, defaulting to arcgis', () => {
		expect(makeEngine().engine.kind).toBe('arcgis');
		expect(makeEngine({ provider: 'maplibre' }).engine.kind).toBe('maplibre');
	});
});

describe('MapEngine.init', () => {
	it('runs the app init hook before handing the provider back', async () => {
		const onInit = vi.fn(async () => {});
		const { engine, provider } = makeEngine({ onInit });

		const result = await engine.init(container);

		expect(onInit).toHaveBeenCalledOnce();
		expect(result).toBe(provider as unknown as MapProvider);
		expect(engine.provider).toBe(provider as unknown as MapProvider);
	});

	it('applies the initial basemap through the catalog and decorates it', async () => {
		const { catalog, decorated } = fakeCatalog();
		const { engine, provider } = makeEngine({ basemaps: catalog, labelOverlay: true });

		await engine.init(container);

		expect(catalog.resolve).toHaveBeenCalledWith('flat-natgeo', undefined);
		expect(provider.basemaps).toHaveLength(1);
		expect(provider.basemaps[0]).toMatchObject({ kind: 'flat' });
		expect(decorated).toEqual([
			{ spec: expect.objectContaining({ kind: 'flat' }), labelOverlay: true }
		]);
	});

	it('starts the hover loop on the provider pointer events', async () => {
		const { engine, provider } = makeEngine();
		await engine.init(container);

		const strategy = vi.fn(async () => 'cell');
		const seen: unknown[] = [];
		engine.hover!.setStrategy(strategy);
		engine.hover!.onHover((r) => seen.push(r));

		// The loop is rAF-throttled; resolve one frame by hand.
		const frames: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			frames.push(cb);
			return frames.length;
		});
		vi.stubGlobal('cancelAnimationFrame', () => {});
		await provider.fire('pointer-move', { x: 5, y: 6 });
		for (const frame of frames) await frame(0);
		vi.unstubAllGlobals();

		expect(strategy).toHaveBeenCalledWith({ x: 5, y: 6 });
		expect(seen).toEqual(['cell']);
	});

	it('passes a flat basemap without a catalog straight through as well-known', async () => {
		const { engine, provider } = makeEngine({ basemap: 'gray' });
		await engine.init(container);
		expect(provider.basemaps[0]).toEqual({ kind: 'well-known', id: 'gray' });
	});
});

describe('MapEngine.setBasemap', () => {
	it('resolves through the catalog, forwarding custom colours', async () => {
		const { catalog } = fakeCatalog();
		const { engine, provider } = makeEngine({ basemaps: catalog });
		await engine.init(container);

		await engine.setBasemap('flat-custom', {
			customColors: { landColor: '#abcdef', oceanColor: '#fedcba' }
		});

		expect(provider.basemaps.at(-1)).toEqual({
			kind: 'flat',
			landColor: '#abcdef',
			oceanColor: '#fedcba'
		});
	});

	it('skips the decoration of a swap that a newer one superseded', async () => {
		const { catalog, decorated } = fakeCatalog();
		const { engine, provider } = makeEngine({ basemaps: catalog });
		await engine.init(container);
		decorated.length = 0;

		// Make the first apply hang until the second has already started.
		let releaseFirst: (() => void) | null = null;
		let call = 0;
		(provider.scene.setBasemap as any).mockImplementation(async (spec: BasemapSpec) => {
			provider.basemaps.push(spec);
			if (++call === 1) await new Promise<void>((r) => (releaseFirst = r));
		});

		const slow = engine.setBasemap('slow');
		const fast = engine.setBasemap('fast');
		await fast;
		releaseFirst!();
		await slow;

		// Only the winning swap decorated.
		expect(decorated).toHaveLength(1);
		expect(decorated[0].spec).toEqual({ kind: 'well-known', id: 'fast' });
	});

	it('does nothing before init', async () => {
		const { catalog } = fakeCatalog();
		const engine = new MapEngine({
			mode: '3d',
			basemap: 'gray',
			basemaps: catalog,
			createProvider: async () => makeFakeProvider() as unknown as MapProvider
		} as any);

		await engine.setBasemap('dark-gray');
		expect(catalog.resolve).not.toHaveBeenCalled();
	});
});

describe('MapEngine scene + camera delegation', () => {
	let engine: MapEngine;
	let provider: FakeProvider;

	beforeEach(async () => {
		({ engine, provider } = makeEngine());
		await engine.init(container);
	});

	it('forwards background, ground, quality and padding to the scene port', () => {
		engine.setBackground('#f1eee8');
		engine.setGround('#ffffff');
		engine.setQuality({ profile: 'low' });
		engine.setMaxPixelRatio(0.6);
		engine.setPadding({ top: 1, right: 2, bottom: 3, left: 4 });

		expect(provider.backgrounds).toEqual(['#f1eee8']);
		expect(provider.scene.setGround).toHaveBeenCalledWith('#ffffff');
		expect(provider.quality).toEqual([{ profile: 'low' }, { maxPixelRatio: 0.6 }]);
		expect(provider.scene.getPadding()).toEqual({ top: 1, right: 2, bottom: 3, left: 4 });
	});

	it('ignores an undefined pixel-ratio cap instead of clearing the quality profile', () => {
		engine.setMaxPixelRatio(undefined);
		expect(provider.quality).toEqual([]);
	});

	it('flies the camera with the full camera state', async () => {
		const cam = { longitude: 1, latitude: 2, z: 3, tilt: 4, heading: 5 };
		await engine.flyTo(cam, { duration: 10 });
		expect(provider.flyCalls[0]).toEqual({ target: cam, opts: { duration: 10 } });
	});

	it('zooms through the camera port', () => {
		engine.zoomIn();
		engine.zoomOut();
		expect(provider.camera.zoomBy).toHaveBeenNthCalledWith(1, 1);
		expect(provider.camera.zoomBy).toHaveBeenNthCalledWith(2, -1);
	});

	it('flies to a known location by zoom, not altitude', async () => {
		await engine.flyToLocation(10, 20, 7);
		expect(provider.flyCalls[0].target).toEqual({ longitude: 10, latitude: 20, zoom: 7 });
	});

	it('reads the camera back from the provider', () => {
		provider.setCamera({ longitude: 42, scale: 1234 });
		expect(engine.readCamera()).toMatchObject({ longitude: 42, scale: 1234 });
	});

	it('subscribes camera and stationary watchers to the provider events', async () => {
		const onCamera = vi.fn();
		const onStationary = vi.fn();
		engine.watchCamera(onCamera);
		engine.watchStationary(onStationary);

		provider.setCamera({ scale: 999 }, true);
		await provider.fire('stationary', true);

		expect(onCamera).toHaveBeenCalledWith(expect.objectContaining({ scale: 999 }));
		expect(onStationary).toHaveBeenCalledWith(true);
	});
});

describe('MapEngine.destroy', () => {
	it('destroys the provider and clears the references', async () => {
		const { engine, provider } = makeEngine();
		await engine.init(container);

		engine.destroy();

		expect(provider.destroy).toHaveBeenCalledOnce();
		expect(engine.provider).toBeNull();
		expect(engine.hover).toBeNull();
	});
});
