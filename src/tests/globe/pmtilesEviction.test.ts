import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tile residency for the REAL `PmtilesLayerAdapter`.
 *
 * The adapter's eviction rules are load-bearing for iOS survival
 * (docs/guide/mobile-memory.md): the mobile tile budget
 * (`{maxCacheTiles: 24, maxTiles: 16}`) is the only thing bounding decoded-tile
 * residency at deep zoom, and PMTiles tiers are never paged out precisely
 * because "the adapter already evicts every tile the moment the camera leaves
 * its scale window". Both claims are asserted here.
 *
 * Only the network/decode seam is faked ({@link file://../../lib/map-engine/tiles/pmtilesDecodeClient.ts},
 * via the adapter's `decodeInWorker` path) plus the map provider. The adapter
 * emits plain `TileCell`s now — no SDK object anywhere in this suite — and the
 * layer side is the {@link RecordingTileSink} double; the adapter itself is
 * never mocked.
 */

/** Tile zoom the faked archive serves; `zoomForScale` clamps every scale to it. */
const ZOOM = 5;
/** Debounce used by every adapter here (the adapter's own default is 300 ms). */
const DEBOUNCE = 10;

const env = vi.hoisted(() => {
	/** Centre (lng/lat) of Web Mercator tile `z/x/y`. */
	const centerOf = (z: number, x: number, y: number) => {
		const n = 2 ** z;
		const latAt = (ty: number) =>
			(Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n))) * 180) / Math.PI;
		return { lng: ((x + 0.5) / n) * 360 - 180, lat: (latAt(y) + latAt(y + 1)) / 2 };
	};

	const state = {
		/** Archive zoom range reported by the faked header. */
		header: { minZoom: 5, maxZoom: 5 },
		/** Cells each decoded tile carries inside its own footprint. */
		cellsPerTile: 2,
		/** `z/x/y` of every tile the adapter asked the decoder for, in order. */
		decoded: [] as string[],
		/**
		 * When true each tile also carries its east neighbour's first cell — the
		 * MVT buffer overlap `tileOwnsPoint` is there to drop.
		 */
		withBufferFeature: false
	};

	/** Fake decode: deterministic cells placed inside the requested tile. */
	const decodeTile = async (_url: string, z: number, x: number, y: number) => {
		state.decoded.push(`${z}/${x}/${y}`);
		const coords: number[] = [];
		const props: Record<string, unknown>[] = [];
		const c = centerOf(z, x, y);
		const tileW = 360 / 2 ** z;
		for (let i = 0; i < state.cellsPerTile; i++) {
			const spread = (i - (state.cellsPerTile - 1) / 2) * (tileW / (state.cellsPerTile * 2));
			coords.push(c.lng + spread, c.lat);
			props.push({ h3id: `${z}/${x}/${y}#${i}`, value: i });
		}
		if (state.withBufferFeature) {
			const nb = centerOf(z, x + 1, y);
			coords.push(nb.lng, nb.lat);
			props.push({ h3id: `${z}/${x + 1}/${y}#0`, value: 0 });
		}
		return { coords: Float64Array.from(coords), props, layerNames: ['cells'] };
	};

	return { state, centerOf, decodeTile };
});

// The only mocked seam: fetch + MVT decode (the adapter's worker client).
vi.mock('$lib/map-engine/tiles/pmtilesDecodeClient', () => ({
	getHeader: vi.fn(async () => env.state.header),
	decodeTile: vi.fn((url: string, z: number, x: number, y: number) => env.decodeTile(url, z, x, y)),
	retainDecodeWorker: vi.fn(),
	releaseDecodeWorker: vi.fn()
}));

import { PmtilesLayerAdapter } from '$lib/map-engine/tiles/PmtilesLayerAdapter';
import type { ScaleWindow } from '$lib/map-engine/tiles/PmtilesLayerAdapter';
import { RecordingTileSink } from '../helpers/recordingTileSink';
import { makeFakeProvider, type FakeProvider } from '../helpers/fakeProvider';

/** A lng/lat box the fake provider unprojects its sample grid into. */
interface Box {
	lng: number;
	lat: number;
	/** Half-width/height in degrees. */
	half: number;
}

/** The adapter's view: the three provider ports it uses, plus test knobs. */
interface FakeView {
	/** The provider handed to the adapter. */
	provider: FakeProvider;
	/** Live `events.on` subscriptions — 0 again once the adapter is destroyed. */
	readonly watchers: number;
	/** Moves the camera to a new box and fires the `camera` event. */
	moveTo(box: Box): void;
	/** Changes the camera scale and fires the `camera` event. */
	setScale(scale: number): void;
}

/**
 * The slice of the provider the adapter actually touches: `camera.get()`
 * (scale + the horizon fallback's look-at point), `screen.size()`/`screen.toMap`
 * (the sample grid it unprojects) and `events.on('camera')`.
 *
 * `toMap` is overridden to unproject into the current box (no tilt, no horizon);
 * the subscription counter makes "destroy stops watching" observable, the way
 * the old fake view's `watchRemoved` flag did.
 */
function fakeView(): FakeView {
	const provider = makeFakeProvider({
		camera: { longitude: 0, latitude: 0, z: 5_000_000, scale: 1_000_000 }
	});
	const { width, height } = provider.screen.size();
	let box: Box = { lng: 0, lat: 0, half: 0.5 };
	provider.screen.toMap = ({ x, y }) => ({
		lng: box.lng - box.half + (x / width) * 2 * box.half,
		lat: box.lat + box.half - (y / height) * 2 * box.half
	});

	const on = provider.events.on.bind(provider.events);
	let watchers = 0;
	(provider.events as { on: typeof on }).on = (name, handler) => {
		watchers++;
		const handle = on(name, handler);
		return {
			remove() {
				watchers--;
				handle.remove();
			}
		};
	};

	return {
		provider,
		get watchers() {
			return watchers;
		},
		moveTo(next: Box) {
			box = next;
			provider.setCamera({ longitude: next.lng, latitude: next.lat, z: 5_000_000 }, true);
		},
		setScale(scale: number) {
			provider.setCamera({ scale }, true);
		}
	};
}

/** Box A and a far-away box B — disjoint tile columns at z5. */
const BOX_A: Box = { lng: 0, lat: 0, half: 0.5 };
const BOX_B: Box = { lng: 120, lat: 0, half: 0.5 };

/**
 * Builds an adapter wired to a {@link RecordingTileSink} and a {@link fakeView},
 * and runs its `init()` (header + ArcGIS module load + first update).
 *
 * @param opts.maxCacheTiles - LRU cap under test.
 * @param opts.scaleWindow - LOD window; defaults to unbounded.
 */
async function mount(opts: { maxCacheTiles?: number; scaleWindow?: ScaleWindow } = {}) {
	const view = fakeView();
	const sink = new RecordingTileSink();
	const adapter = new PmtilesLayerAdapter({
		url: 'https://example.test/h3_r5.pmtiles',
		sink,
		provider: view.provider,
		layerName: 'cells',
		debounce: DEBOUNCE,
		decodeInWorker: true,
		maxCacheTiles: opts.maxCacheTiles ?? 192,
		scaleWindow: opts.scaleWindow
	});
	await adapter.init();
	await settle(adapter);
	return { adapter, sink, view };
}

/** Runs the debounced update and waits for its tile batch to finish. */
async function settle(adapter: PmtilesLayerAdapter) {
	await vi.advanceTimersByTimeAsync(DEBOUNCE);
	for (let i = 0; i < 100 && adapter.isLoading(); i++) await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

/** How many times the decoder was asked for a given tile key. */
const decodeCount = (key: string) => env.state.decoded.filter((k) => k === key).length;

beforeEach(() => {
	vi.useFakeTimers();
	env.state.decoded.length = 0;
	env.state.cellsPerTile = 2;
	env.state.withBufferFeature = false;
	// The adapter narrates header/tile loads; keep the test output readable.
	vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('PmtilesLayerAdapter — LRU eviction', () => {
	it('evicts cached tiles past maxCacheTiles and removes each one exactly once', async () => {
		const { adapter, sink, view } = await mount({ maxCacheTiles: 4 });

		const tilesA = [...adapter.debug.lastTilesFetched];
		expect(tilesA.length).toBeGreaterThan(4); // the cap must actually bite
		expect(tilesA.every((t) => t.startsWith(`${ZOOM}/`))).toBe(true); // header-clamped zoom
		expect(sink.residentH3Ids()).toHaveLength(tilesA.length * env.state.cellsPerTile);
		// Every graphic added so far belongs to a box-A tile; remember them.
		const addedA = sink.batches.filter((b) => b.op === 'add').flatMap((b) => b.h3ids);

		// Pan far away: box-A tiles are hidden, then evicted down to the cap.
		sink.resetBatches();
		view.moveTo(BOX_B);
		await settle(adapter);

		const tilesB = [...adapter.debug.lastTilesFetched];
		expect(tilesB.some((t) => tilesA.includes(t))).toBe(false);
		// Exactly one remove per box-A graphic (hide removes; eviction must not
		// remove a second time), and nothing from box A is resident any more.
		const removedA = sink.batches.filter((b) => b.op === 'remove').flatMap((b) => b.h3ids);
		expect([...removedA].sort()).toEqual([...addedA].sort());
		for (const [, count] of sink.removeCounts()) expect(count).toBe(1);
		expect(sink.residentH3Ids().some((id) => addedA.includes(id))).toBe(false);

		// Panning back must refetch: the cap dropped box A from the tile cache.
		view.moveTo(BOX_A);
		await settle(adapter);
		for (const key of tilesA) expect(decodeCount(key)).toBe(2);
	});

	it('keeps hidden tiles cached when the cap is generous (no refetch on pan-back)', async () => {
		const { adapter, sink, view } = await mount({ maxCacheTiles: 64 });
		const tilesA = [...adapter.debug.lastTilesFetched];

		view.moveTo(BOX_B);
		await settle(adapter);
		// Hidden, not evicted — no box-A cell is resident, but all stay cached.
		const cellsA = tilesA.flatMap((t) => [`${t}#0`, `${t}#1`]);
		expect(sink.residentH3Ids().some((id) => cellsA.includes(id))).toBe(false);

		sink.resetBatches();
		view.moveTo(BOX_A);
		await settle(adapter);
		for (const key of tilesA) expect(decodeCount(key)).toBe(1);
		// Re-shown from the cache: added again, never decoded again.
		const readded = sink.batches.filter((b) => b.op === 'add').flatMap((b) => b.h3ids);
		expect(readded.length).toBe(tilesA.length * env.state.cellsPerTile);
	});
});

describe('PmtilesLayerAdapter — scale window', () => {
	/** Window the fake view starts inside (`maxScale <= scale <= minScale`). */
	const WINDOW: ScaleWindow = { minScale: 2_000_000, maxScale: 500_000 };

	it('drops every tile and pauses fetching when the camera leaves the window', async () => {
		const { adapter, sink, view } = await mount({ scaleWindow: WINDOW });
		const tilesA = [...adapter.debug.lastTilesFetched];
		expect(sink.residentH3Ids().length).toBeGreaterThan(0);

		const decodedInside = env.state.decoded.length;
		view.setScale(5_000_000); // zoomed out past minScale
		await settle(adapter);

		expect(sink.residentH3Ids()).toEqual([]);
		expect(adapter.debug.tilesLoaded).toBe(0);
		for (const [, count] of sink.removeCounts()) expect(count).toBe(1);

		// Fetching is paused: camera moves outside the window decode nothing.
		view.moveTo(BOX_B);
		await settle(adapter);
		expect(env.state.decoded.length).toBe(decodedInside);
		expect(sink.residentH3Ids()).toEqual([]);
		expect(tilesA.length).toBeGreaterThan(0);
	});

	it('re-adds tiles on re-entry without duplicate ObjectIDs', async () => {
		const { adapter, sink, view } = await mount({ scaleWindow: WINDOW });
		view.setScale(5_000_000);
		await settle(adapter);

		sink.resetBatches();
		view.setScale(1_000_000); // back inside the window
		await settle(adapter);

		const resident = sink.residentObjectIds();
		expect(resident.length).toBeGreaterThan(0);
		expect(new Set(resident).size).toBe(resident.length);
		const residentH3 = sink.residentH3Ids();
		expect(new Set(residentH3).size).toBe(residentH3.length);
		expect(sink.doubleAdds).toEqual([]);
		expect(residentH3).toHaveLength(adapter.debug.lastTilesFetched.length * env.state.cellsPerTile);
		expect(sink.clears).toBe(0); // clear() is destroy-only

		// A further update over the same tiles must not re-add what is already
		// shown — that would double every cell's ObjectID on the layer.
		sink.resetBatches();
		view.moveTo(BOX_A);
		await settle(adapter);
		expect(sink.batches.filter((b) => b.op === 'add')).toEqual([]);
		expect(sink.doubleAdds).toEqual([]);
		expect(sink.residentObjectIds()).toEqual(resident);
	});
});

describe('PmtilesLayerAdapter — tile-border dedupe', () => {
	it('drops buffer features owned by a neighbouring tile', async () => {
		env.state.withBufferFeature = true;
		const { adapter, sink } = await mount();

		const tiles = adapter.debug.lastTilesFetched.length;
		const resident = sink.residentH3Ids();
		// Decode handed over (cellsPerTile + 1) cells per tile; tileOwnsPoint must
		// drop the borrowed one, so each cell is added by exactly one tile.
		expect(resident).toHaveLength(tiles * env.state.cellsPerTile);
		expect(new Set(resident).size).toBe(resident.length);
		expect(adapter.debug.cellsCount).toBe(tiles * env.state.cellsPerTile);
	});
});

describe('PmtilesLayerAdapter — destroy', () => {
	it('clears the sink and stops watching the camera', async () => {
		const { adapter, sink, view } = await mount();
		expect(sink.residentH3Ids().length).toBeGreaterThan(0);

		adapter.destroy();
		expect(sink.clears).toBe(1);
		expect(view.watchers).toBe(0);

		const decoded = env.state.decoded.length;
		view.moveTo(BOX_B);
		await settle(adapter);
		expect(env.state.decoded.length).toBe(decoded);
	});
});
