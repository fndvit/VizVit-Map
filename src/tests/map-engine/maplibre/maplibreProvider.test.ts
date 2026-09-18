import { describe, it, expect, vi, beforeEach } from 'vitest';

/* eslint-disable @typescript-eslint/no-explicit-any -- the fake stands in for maplibre-gl */

import { MaplibreProvider, flatStyleFor } from '$lib/map-engine/maplibre/MaplibreProvider';
import { zoomRangeForScaleWindow } from '$lib/map-engine/maplibre/layers';
import { altitudeForZoom, zoomForAltitude } from '$lib/map-engine/maplibre/camera';
import { ProviderMismatchError, scaleForZoom, zoomForScale } from '$lib/map-engine';

/**
 * A fake `maplibregl.Map` that records style mutations and answers the geometry
 * questions the provider asks. Projection is a simple linear mapping so screen
 * assertions stay readable.
 */
function fakeMap() {
	const handlers: Record<string, ((e: any) => void)[]> = {};
	const sources = new Map<string, any>();
	const layers = new Map<string, any>();
	const images = new Set<string>();
	let rendered: any[] = [];

	const map: any = {
		sources,
		layers,
		images,
		paint: [] as any[],
		layout: [] as any[],
		zoomRanges: [] as any[],
		styles: [] as any[],
		eased: [] as any[],
		center: { lng: 0, lat: 20 },
		zoom: 4,
		pitch: 0,
		bearing: 0,
		padding: { top: 0, right: 0, bottom: 0, left: 0 },
		canvas: { style: { cursor: '' } },

		getCenter: () => map.center,
		getZoom: () => map.zoom,
		getPitch: () => map.pitch,
		getBearing: () => map.bearing,
		getPadding: () => map.padding,
		setPadding: (p: any) => {
			map.padding = p;
		},
		getCanvas: () => map.canvas,
		setPixelRatio: vi.fn(),
		project: ([lng, lat]: [number, number]) => ({ x: lng * 2 + 500, y: 400 - lat * 2 }),
		unproject: ([x, y]: [number, number]) => ({ lng: (x - 500) / 2, lat: (400 - y) / 2 }),
		loaded: () => true,
		areTilesLoaded: () => true,
		isStyleLoaded: () => true,
		easeTo: (opts: any) => {
			map.eased.push(opts);
			if (opts.center) map.center = { lng: opts.center[0], lat: opts.center[1] };
			if (opts.zoom != null) map.zoom = opts.zoom;
			queueMicrotask(() => map.fire('moveend', {}));
		},
		setStyle: (style: any) => {
			map.styles.push(style);
			sources.clear();
			layers.clear();
		},
		addSource: (id: string, s: any) => sources.set(id, { ...s, setData: vi.fn() }),
		getSource: (id: string) => sources.get(id),
		removeSource: (id: string) => sources.delete(id),
		addLayer: (l: any) => layers.set(l.id, l),
		getLayer: (id: string) => layers.get(id),
		removeLayer: (id: string) => layers.delete(id),
		setPaintProperty: (layer: string, prop: string, value: any) =>
			map.paint.push({ layer, prop, value }),
		setLayoutProperty: (layer: string, prop: string, value: any) =>
			map.layout.push({ layer, prop, value }),
		setLayerZoomRange: (layer: string, minzoom: any, maxzoom: any) =>
			map.zoomRanges.push({ layer, minzoom, maxzoom }),
		hasImage: (id: string) => images.has(id),
		addImage: (id: string) => images.add(id),
		queryRenderedFeatures: () => rendered,
		setRendered: (f: any[]) => {
			rendered = f;
		},
		on: (name: string, cb: any) => {
			(handlers[name] ??= []).push(cb);
		},
		once: (name: string, cb: any) => {
			const wrapped = (e: any) => {
				cb(e);
				handlers[name] = handlers[name].filter((h) => h !== wrapped);
			};
			(handlers[name] ??= []).push(wrapped);
		},
		off: (name: string, cb: any) => {
			handlers[name] = (handlers[name] ?? []).filter((h) => h !== cb);
		},
		fire: (name: string, e: any = {}) => {
			for (const h of [...(handlers[name] ?? [])]) h({ type: name, ...e });
		},
		remove: vi.fn()
	};
	return map;
}

function makeProvider(mode: '3d' | '2d' = '3d') {
	const map = fakeMap();
	const container = { clientWidth: 1000, clientHeight: 800, style: {} } as unknown as HTMLElement;
	const provider = new MaplibreProvider({ map, container, mode });
	return { provider, map, container };
}

const SYMBOL = {
	shape: 'diamond' as const,
	size: 12,
	color: '#f5c518',
	outline: { color: '#b48c0a', width: 2 }
};

beforeEach(() => {
	vi.clearAllMocks();
	// Icon generation draws on a canvas; jsdom has no 2D context, so the drawing
	// step degrades to "register nothing" — the id is what the layer references.
	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null as any);
});

describe('MaplibreProvider — camera port', () => {
	it('derives scale from zoom and latitude', () => {
		const { provider, map } = makeProvider();
		const cam = provider.camera.get()!;
		expect(cam.zoom).toBe(map.zoom);
		expect(cam.scale).toBeCloseTo(scaleForZoom(map.zoom, map.center.lat), 6);
		expect(cam.longitude).toBe(0);
		expect(cam.latitude).toBe(20);
	});

	it('converts an altitude target into a zoom before easing', async () => {
		const { provider, map } = makeProvider();
		await provider.camera.flyTo({ longitude: 5, latitude: 10, z: 2_000_000 }, { duration: 0 });
		const eased = map.eased[0];
		expect(eased.center).toEqual([5, 10]);
		expect(eased.zoom).toBeCloseTo(zoomForAltitude(2_000_000, 10, 800), 9);
	});

	it('converts a scale target into a zoom', async () => {
		const { provider, map } = makeProvider();
		await provider.camera.flyTo({ latitude: 0, scale: 1_000_000 }, { duration: 0 });
		expect(map.eased[0].zoom).toBeCloseTo(zoomForScale(1_000_000, 0), 9);
	});

	it('resolves once the move settles', async () => {
		const { provider } = makeProvider();
		await expect(provider.camera.flyTo({ zoom: 6 }, { duration: 200 })).resolves.toBeUndefined();
	});

	it('round-trips altitude through zoom', () => {
		for (const [z, lat] of [
			[2, 0],
			[7, 45],
			[11, -30]
		]) {
			expect(zoomForAltitude(altitudeForZoom(z, lat), lat)).toBeCloseTo(z, 9);
		}
	});
});

describe('MaplibreProvider — screen port', () => {
	it('projects a near-side point', () => {
		const { provider } = makeProvider();
		expect(provider.screen.toScreen({ lng: 5, lat: 10 })).toEqual({ x: 510, y: 380 });
	});

	it('hides a point on the far side of the globe', () => {
		const { provider } = makeProvider('3d');
		expect(provider.screen.toScreen({ lng: 170, lat: 0 })).toBeNull();
	});

	it('projects everything in 2d mode (no globe to hide behind)', () => {
		const { provider } = makeProvider('2d');
		expect(provider.screen.toScreen({ lng: 170, lat: 0 })).not.toBeNull();
	});

	it('unprojects screen to ground', () => {
		const { provider } = makeProvider();
		expect(provider.screen.toMap({ x: 510, y: 380 })).toEqual({ lng: 5, lat: 10 });
	});
});

describe('MaplibreProvider — event port', () => {
	it('maps a click to screen coords plus lng/lat', () => {
		const { provider, map } = makeProvider();
		const seen: any[] = [];
		provider.events.on('click', (e) => seen.push(e));
		map.fire('click', { point: { x: 3, y: 4 }, lngLat: { lng: 9, lat: 8 } });
		expect(seen[0]).toMatchObject({ x: 3, y: 4, lngLat: { lng: 9, lat: 8 } });
	});

	it('reports stationary true on idle and false when movement resumes', () => {
		const { provider, map } = makeProvider();
		const seen: boolean[] = [];
		provider.events.on('stationary', (v) => seen.push(v));
		map.fire('idle');
		map.fire('movestart');
		expect(seen).toEqual([true, false]);
	});

	it('brackets a gesture with interacting true/false', () => {
		const { provider, map } = makeProvider();
		const seen: boolean[] = [];
		provider.events.on('interacting', (v) => seen.push(v));
		map.fire('dragstart');
		map.fire('dragend');
		expect(seen).toEqual([true, false]);
		expect(provider.events.interacting).toBe(false);
	});

	it('removes its subscriptions', () => {
		const { provider, map } = makeProvider();
		const seen: any[] = [];
		const handle = provider.events.on('click', (e) => seen.push(e));
		handle.remove();
		map.fire('click', { point: { x: 0, y: 0 } });
		expect(seen).toHaveLength(0);
	});
});

describe('MaplibreProvider — scene port', () => {
	it('applies a flat basemap as a two-colour style', async () => {
		const { provider, map } = makeProvider();
		await provider.scene.setBasemap({ kind: 'flat', landColor: '#725B53', oceanColor: '#E5DACA' });
		const style: any = map.styles[0];
		expect(style.layers[0]).toMatchObject({ type: 'background' });
		expect(style.layers[0].paint['background-color']).toBe('#E5DACA');
		expect(style.layers[1].paint['fill-color']).toBe('#725B53');
	});

	it('applies a style basemap by url', async () => {
		const { provider, map } = makeProvider();
		await provider.scene.setBasemap({ kind: 'style', url: 'https://x/style.json' });
		expect(map.styles[0]).toBe('https://x/style.json');
	});

	it('refuses an ArcGIS well-known basemap id', async () => {
		const { provider } = makeProvider();
		await expect(
			provider.scene.setBasemap({ kind: 'well-known', id: 'gray-vector' })
		).rejects.toThrow(ProviderMismatchError);
	});

	it('replays live layers into a freshly applied style', async () => {
		const { provider, map } = makeProvider();
		provider.layers.geojson({
			id: 'cerrado',
			source: { url: '/c.geojson' },
			style: { stroke: { color: '#c00', width: 1 } }
		});
		expect(map.getSource('geo:cerrado')).toBeTruthy();

		await provider.scene.setBasemap({ kind: 'style', url: 'https://x/style.json' });

		// setStyle cleared the style; the handle rebuilt itself.
		expect(map.getSource('geo:cerrado')).toBeTruthy();
		expect(map.getLayer('geo:cerrado:line')).toBeTruthy();
	});

	it('sets the cursor on the canvas and the background on the container', () => {
		const { provider, map, container } = makeProvider();
		provider.scene.setCursor('pointer');
		provider.scene.setBackground('#f1eee8');
		expect(map.canvas.style.cursor).toBe('pointer');
		expect((container as any).style.background).toBe('#f1eee8');
	});
});

describe('MaplibreProvider — points layer', () => {
	it('builds one source and one symbol layer, keyed by generated icons', () => {
		const { provider, map } = makeProvider();
		provider.layers.points({
			id: 'markers',
			items: [{ id: 'china', lng: 104, lat: 35, symbol: SYMBOL }]
		});
		expect(map.getSource('pts:markers')).toBeTruthy();
		expect(map.getLayer('pts:markers:symbols').layout['icon-image']).toEqual(['get', 'iconId']);
	});

	it('answers a hit test with the hittable feature id', async () => {
		const { provider, map } = makeProvider();
		const layer = provider.layers.points({
			id: 'markers',
			items: [{ id: 'china', lng: 104, lat: 35, symbol: SYMBOL }]
		});

		map.setRendered([{ properties: { id: 'china', hittable: true } }]);
		await expect(layer.hitTest({ x: 1, y: 2 })).resolves.toBe('china');

		map.setRendered([{ properties: { id: 'current', hittable: false } }]);
		await expect(layer.hitTest({ x: 1, y: 2 })).resolves.toBeNull();

		map.setRendered([]);
		await expect(layer.hitTest({ x: 1, y: 2 })).resolves.toBeNull();
	});

	it('pushes new data on set and restyle', () => {
		const { provider, map } = makeProvider();
		const layer = provider.layers.points({ id: 'm', items: [] });
		const source = map.getSource('pts:m');
		layer.set([{ id: 'a', lng: 0, lat: 0, symbol: SYMBOL }]);
		layer.restyle('a', { ...SYMBOL, size: 16 });
		expect(source.setData).toHaveBeenCalledTimes(2);
	});

	it('removes its layer and source', () => {
		const { provider, map } = makeProvider();
		const layer = provider.layers.points({ id: 'm' });
		layer.remove();
		expect(map.getLayer('pts:m:symbols')).toBeUndefined();
		expect(map.getSource('pts:m')).toBeUndefined();
		expect(provider.layers.all).toHaveLength(0);
	});
});

describe('zoomRangeForScaleWindow', () => {
	it('swaps the ArcGIS scale ends for zoom ends', () => {
		// minScale is the COARSEST scale, which is the LOWEST zoom.
		const [minzoom, maxzoom] = zoomRangeForScaleWindow(10_000_000, 100_000, 0);
		expect(minzoom).toBeLessThan(maxzoom!);
		expect(minzoom).toBeCloseTo(zoomForScale(10_000_000, 0), 9);
		expect(maxzoom).toBeCloseTo(zoomForScale(100_000, 0), 9);
	});

	it('treats 0 as unbounded on either end', () => {
		expect(zoomRangeForScaleWindow(0, 0)).toEqual([null, null]);
		expect(zoomRangeForScaleWindow(5_000, 0)[1]).toBeNull();
	});
});

describe('MaplibreProvider — native escape hatch', () => {
	it('hands back the maplibre map', () => {
		const { provider, map } = makeProvider();
		expect(provider.native('maplibre').map).toBe(map);
	});

	it('throws for ArcGIS', () => {
		const { provider } = makeProvider();
		expect(() => provider.native('arcgis')).toThrow(ProviderMismatchError);
	});

	it('destroys the map and its layers', () => {
		const { provider, map } = makeProvider();
		provider.layers.points({ id: 'm' });
		provider.destroy();
		expect(map.remove).toHaveBeenCalledOnce();
		expect(provider.layers.all).toHaveLength(0);
	});
});

describe('flatStyleFor', () => {
	it('is a valid two-layer style document', () => {
		const style: any = flatStyleFor('#111111', '#222222');
		expect(style.version).toBe(8);
		expect(style.layers.map((l: any) => l.type)).toEqual(['background', 'fill']);
	});
});
