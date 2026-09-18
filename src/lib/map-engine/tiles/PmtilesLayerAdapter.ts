/**
 * @module map-engine/tiles/PmtilesLayerAdapter
 * Streams a PMTiles archive into a {@link TileSink} as the camera moves —
 * the provider-neutral half of the explore PMTiles seam.
 *
 * PMTiles files serve vector tiles via HTTP range requests — only visible tiles
 * are fetched, keeping bandwidth low even for large datasets (H3 level 5: 357K features).
 *
 * Flow:
 * 1. Listen to the provider's camera changes (debounced)
 * 2. Compute the visible extent by unprojecting a grid of screen points
 *    (`screen.toMap`) — robust to camera tilt/rotation, unlike any
 *    camera-position heuristic — then enumerate the z/x/y tiles covering it
 * 3. Fetch + decode MVT tiles from PMTiles
 * 4. Zip the decode output into neutral {@link TileCell}s and hand them to the sink
 * 5. Remove off-screen tiles to manage memory
 *
 * Nothing in this module — or in the decode path beside it — imports a map SDK.
 * The adapter talks to the live view through three {@link MapProvider} ports
 * (`camera`, `screen`, `events`) and to its layer through the three
 * {@link TileSink} calls; building features out of cells is the sink's job, so
 * a second provider needs a second sink and no change here.
 *
 * Scale handling mirrors ArcGIS layer semantics: the adapter maps
 * the camera scale to a tile zoom level (clamped to the archive's header
 * zoom range) and honours an optional `scaleWindow` so the tier only
 * renders inside its LOD handoff window (a streamed sink has no native
 * minScale/maxScale support).
 */

import { PMTiles, FetchSource } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import {
	getHeader as workerGetHeader,
	decodeTile as workerDecodeTile,
	retainDecodeWorker,
	releaseDecodeWorker,
	type DecodedTile
} from './pmtilesDecodeClient.js';

import type { Handle, MapProvider } from '../provider.js';

/**
 * ArcGIS-style scale visibility window. The layer renders when:
 *   (minScale === 0 || scale <= minScale)
 *   && (maxScale === 0 || scale >= maxScale)
 * `0` means unbounded in that direction.
 */
export interface ScaleWindow {
	minScale: number;
	maxScale: number;
}

/** Web Mercator scale at zoom 0 with 256px tiles and 96 DPI. */
const SCALE_Z0 = 591_657_550.5;

/**
 * Default max decoded tiles kept in the LRU cache (~2× the visible working set
 * so a pan-and-return doesn't refetch). Desktop default; mobile passes a lower
 * value via {@link PmtilesLayerOptions.maxCacheTiles}.
 */
const DEFAULT_MAX_CACHE_TILES = 192;

/** Default hard ceiling on tiles requested per update (desktop). */
const DEFAULT_MAX_TILES = 96;

/** Tile cache key */
const tileKey = (z: number, x: number, y: number) => `${z}/${x}/${y}`;

/**
 * True when a WGS84 point lies inside tile `z/x/y`'s own footprint (Web
 * Mercator tiling; half-open on the east and south edges so every point
 * belongs to exactly one tile).
 *
 * MVT tiles carry a buffer of features from neighboring tiles, so a cell
 * near a tile edge is decoded from two tiles (four at corners). Without
 * this ownership test the sink adds each copy to the FeatureLayer, and any
 * translucent renderer composites the duplicates — a 0.3-alpha dot reads
 * as ~0.51 along tile edges and up to ~0.76 at corners.
 *
 * @param z - Tile zoom level.
 * @param x - Tile column (west-origin).
 * @param y - Tile row (north-origin).
 * @param lng - Point longitude in degrees.
 * @param lat - Point latitude in degrees.
 */
export function tileOwnsPoint(z: number, x: number, y: number, lng: number, lat: number): boolean {
	const n = 2 ** z;
	const lngMin = (x / n) * 360 - 180;
	const lngMax = ((x + 1) / n) * 360 - 180;
	if (lng < lngMin || lng >= lngMax) return false;
	const latNorth = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
	const latSouth = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n))) * 180) / Math.PI;
	return lat > latSouth && lat <= latNorth;
}

/** Debug state exposed for the debug panel */
export interface PmtilesDebugInfo {
	tilesLoaded: number;
	/** Cells resident in the sink right now (sum over shown tiles). */
	cellsCount: number;
	lastTilesFetched: string[];
	lastError: string | null;
	layerName: string | null;
	/** Last visible extent used for tile enumeration (debug readout). */
	lastExtent: string | null;
}

export interface PmtilesLayerOptions {
	/** URL to the .pmtiles file (relative or absolute) */
	url: string;
	/** Output sink for decoded tiles (e.g. a {@link FeatureTileSink}). */
	sink: TileSink;
	/**
	 * The live view, as the three provider ports this adapter needs: `camera`
	 * (scale + look-at fallback), `screen` (size + unproject) and `events` (the
	 * camera ticks that schedule an update). Provider-neutral throughout — the
	 * cells it hands the sink are plain data, not SDK objects.
	 */
	provider: Pick<MapProvider, 'camera' | 'screen' | 'events'>;
	/**
	 * MVT layer name inside the tiles (tippecanoe `-l` value). Falls back
	 * to the first layer present in the tile when unset or not found.
	 */
	layerName?: string;
	/**
	 * Scale visibility window for LOD handoff. When the camera scale falls
	 * outside it, loaded tiles are unloaded and fetching pauses. Defaults
	 * to unbounded. Tune via the dev panel — never treat code defaults as
	 * the source of truth.
	 */
	scaleWindow?: ScaleWindow;
	/** Debounce delay (ms) for extent changes. Default: 300 */
	debounce?: number;
	/**
	 * Decode tiles in a Web Worker (fetch + MVT parse off the main thread) instead
	 * of inline. The main thread still zips the result into cells and the sink
	 * still builds the layer's features. Default `false`.
	 */
	decodeInWorker?: boolean;
	/**
	 * Max decoded tiles kept in the LRU cache. Default {@link DEFAULT_MAX_CACHE_TILES}.
	 * Lower it on memory-constrained (mobile) devices to cap GPU/heap growth.
	 */
	maxCacheTiles?: number;
	/**
	 * Hard ceiling on tiles requested per update. Default {@link DEFAULT_MAX_TILES}.
	 * Lower it on mobile so deep zoom doesn't load more cells than the device
	 * can hold (which otherwise crashes/reloads the tab).
	 */
	maxTiles?: number;
}

/**
 * One decoded cell — the provider-neutral payload of the PMTiles seam.
 *
 * The decode path (worker or inline) yields parallel `coords`/`props` arrays;
 * the adapter zips them into these, drops the ones a neighbouring tile owns
 * ({@link tileOwnsPoint}) and hands the rest to its {@link TileSink}. Nothing
 * here is SDK-shaped: the ArcGIS `Graphic`/`Point` pair is built by the ArcGIS
 * sink, at the edge, which is why this module imports no map SDK at all.
 *
 * The object is the adapter's **residency identity**: the same instances are
 * cached per tile key, re-handed to `add` when a hidden tile is re-shown, and
 * handed to `remove` on hide/eviction, so a sink may key its own bookkeeping
 * (ObjectIDs, feature handles) off them.
 */
export interface TileCell {
	/** Cell centroid longitude, WGS84 degrees. */
	lng: number;
	/** Cell centroid latitude, WGS84 degrees. */
	lat: number;
	/**
	 * The cell's decoded attributes, verbatim from the tile. Mutable by
	 * contract: a sink may rename keys to its layer's schema and stamp an id
	 * onto them (the adapter's hover index shares this very object, so a
	 * tooltip sees whatever the sink wrote).
	 */
	attributes: Record<string, unknown>;
}

/**
 * Cells in/out — the whole of what {@link PmtilesLayerAdapter} needs from the
 * layer it renders into. Deliberately styling-free: the adapter streams decoded
 * tile cells in and evicts them again, and knows nothing about renderers,
 * definition expressions or LOD windows (those are the *styling* half of a
 * sink — `StyledTileSink` in `$lib/explore/render/featureTileSink`).
 *
 * The payload is {@link TileCell}, not an SDK object: constructing the layer's
 * features is the sink's job, so this module — and the adapter above it — stay
 * free of `@arcgis/core` and a second provider needs only a second sink.
 *
 * Two things implement it: `FeatureTileSink` in production (streams into a GPU
 * ArcGIS `FeatureLayer`), and the recording double in
 * `src/tests/helpers/recordingTileSink.ts`, which captures the add/remove/clear
 * batches so tile residency and eviction can be asserted without a map view.
 */
export interface TileSink {
	/** Adds a decoded tile's cells to the layer. */
	add(cells: TileCell[]): void;
	/** Removes previously-added cells — the tile was hidden or evicted. */
	remove(cells: TileCell[]): void;
	/** Drops the layer entirely (adapter destroy). */
	clear(): void;
}

export class PmtilesLayerAdapter {
	/** Local PMTiles archive — `null` when {@link decodeInWorker} (the worker owns it). */
	private pmtiles: PMTiles | null = null;
	private url: string;
	private decodeInWorker: boolean;
	private sink: TileSink;
	private provider: Pick<MapProvider, 'camera' | 'screen' | 'events'>;
	private layerName: string | undefined;
	private scaleWindow: ScaleWindow;
	private debounceMs: number;
	/** LRU cache cap (decoded tiles kept in memory). Lower on mobile. */
	private maxCacheTiles: number;
	/** Per-update tile request ceiling. Lower on mobile. */
	private maxTiles: number;

	private loadedTiles = new Set<string>();
	/**
	 * LRU cache of decoded cells per tile key, newest at the tail. These arrays
	 * ARE the residency identity handed to `sink.add`/`sink.remove`: the same
	 * {@link TileCell} instances are re-handed on re-show and on eviction, so a
	 * sink can key its own per-feature bookkeeping off them.
	 */
	private tileCells = new Map<string, TileCell[]>();
	/** h3id → feature attributes + centroid, for hex hover lookup. */
	private h3Index = new Map<
		string,
		{ attributes: Record<string, unknown>; lat: number; lng: number; tile: string }
	>();
	private timer: ReturnType<typeof setTimeout> | undefined;
	private watchHandle: Handle | null = null;
	private destroyed = false;

	/**
	 * Count of in-flight `update()` calls that have tiles to fetch. `isLoading()`
	 * is `activeLoads > 0`; when it returns to 0 the `onTilesSettled` callback
	 * fires. A counter (not a boolean) stays correct if a debounced `update()`
	 * starts while a prior one is still awaiting its `Promise.all`.
	 */
	private activeLoads = 0;
	/**
	 * True between a camera change (which schedules a debounced `update()`) and
	 * that `update()` actually starting. During this window tiles for the new
	 * view aren't fetched yet but `activeLoads` is still 0 — `isLoading()` folds
	 * it in so the hex-hover lookup defers (and doesn't cache) "no data" verdicts
	 * for cells whose tiles are merely pending, not genuinely empty.
	 */
	private updatePending = false;
	/** Fired when the last in-flight tile batch settles — see {@link setOnTilesSettled}. */
	private onTilesSettled: (() => void) | null = null;

	private headerMinZoom = 0;
	private headerMaxZoom = 15;

	/** Expose debug info */
	debug: PmtilesDebugInfo = {
		tilesLoaded: 0,
		cellsCount: 0,
		lastTilesFetched: [],
		lastError: null,
		lastExtent: null,
		layerName: null
	};

	constructor(options: PmtilesLayerOptions) {
		this.url = options.url;
		this.decodeInWorker = options.decodeInWorker ?? false;
		// Refcount the shared decode worker so it terminates (freeing its
		// per-archive directory caches) once the last adapter is destroyed.
		if (this.decodeInWorker) retainDecodeWorker();
		// The local PMTiles archive is only needed for the inline decode path; on
		// the worker path the worker owns its own archive (see pmtilesDecode.worker).
		if (!this.decodeInWorker) {
			const source = new FetchSource(options.url);
			// Chrome can serve range requests from its HTTP cache and answer a
			// `Range:` fetch with a cached 200/whole-file response, which makes
			// pmtiles throw "content-length exceeding request". The library
			// auto-enables its `cache: 'no-store'` workaround only on Chrome+Windows,
			// but the bug reproduces on macOS too (seen both with the NatGeo portal
			// host AND the local dev server serving these multi-GB archives).
			// `no-store` is therefore forced unconditionally — gating it broke local
			// loading. The per-pan refetch cost it implies is absorbed by the
			// adapter's in-memory LRU tile cache (decoded cells are reused on
			// re-pan, so we don't re-request bytes anyway).
			(source as unknown as { chromeWindowsNoCache: boolean }).chromeWindowsNoCache = true;
			this.pmtiles = new PMTiles(source);
		}
		this.sink = options.sink;
		this.provider = options.provider;
		this.layerName = options.layerName;
		this.scaleWindow = options.scaleWindow ?? { minScale: 0, maxScale: 0 };
		this.debounceMs = options.debounce ?? 300;
		this.maxCacheTiles = options.maxCacheTiles ?? DEFAULT_MAX_CACHE_TILES;
		this.maxTiles = options.maxTiles ?? DEFAULT_MAX_TILES;
	}

	/**
	 * Initializes the adapter — loads ArcGIS modules and starts watching the view.
	 */
	async init(): Promise<void> {
		// Verify PMTiles is accessible (worker- or main-thread-side, per config).
		try {
			const header = this.decodeInWorker
				? await workerGetHeader(this.url)
				: await this.pmtiles!.getHeader();
			this.headerMinZoom = header.minZoom;
			this.headerMaxZoom = header.maxZoom;
			console.log('[PMTiles] Header loaded:', {
				minZoom: header.minZoom,
				maxZoom: header.maxZoom
			});
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			console.error('[PMTiles] Failed to load header:', msg);
			this.debug.lastError = `Header load failed: ${msg}`;
			return;
		}

		// A destroy() during the header await above must not register the camera
		// watch posthumously — that would leak the watch (and this adapter) for
		// the lifetime of the view.
		if (this.destroyed) return;

		this.watchHandle = this.provider.events.on('camera', () => {
			this.scheduleUpdate();
		});

		// Initial load
		this.scheduleUpdate();
	}

	/**
	 * Updates the LOD scale window and re-evaluates visibility — entering
	 * the window resumes tile loading, leaving it unloads everything.
	 *
	 * @param window - New ArcGIS-style `{minScale, maxScale}` window
	 */
	setScaleWindow(window: ScaleWindow): void {
		this.scaleWindow = window;
		this.scheduleUpdate();
	}

	/**
	 * Returns a loaded feature's attributes + centroid by H3 cell id, or
	 * null when the cell isn't in any currently-loaded tile. Synchronous —
	 * backs the hex hover lookup for PMTiles tiers (a streamed sink offers no
	 * `queryFeatures`).
	 *
	 * @param h3id - H3 cell id (matches the `h3id` tile attribute)
	 */
	queryAttributesByH3(
		h3id: string
	): { attributes: Record<string, unknown>; lat: number; lng: number } | null {
		const hit = this.h3Index.get(h3id);
		return hit ? { attributes: hit.attributes, lat: hit.lat, lng: hit.lng } : null;
	}

	/**
	 * Whether the adapter is currently fetching tiles. The hex-hover lookup
	 * uses this to defer a "no data" verdict while tiles stream in — a miss
	 * during loading is ambiguous (cell not yet loaded vs. genuinely empty).
	 */
	isLoading(): boolean {
		return this.updatePending || this.activeLoads > 0;
	}

	/**
	 * Registers a callback fired when the last in-flight tile batch settles
	 * (i.e. `isLoading()` transitions back to false). Used to re-resolve a
	 * stationary hover once late-arriving tiles populate the h3 index. Pass
	 * `null` to clear.
	 */
	setOnTilesSettled(cb: (() => void) | null): void {
		this.onTilesSettled = cb;
	}

	/** Whether `scale` falls inside the configured scale window. */
	private inScaleWindow(scale: number): boolean {
		const { minScale, maxScale } = this.scaleWindow;
		const aboveMin = minScale === 0 || scale <= minScale;
		const belowMax = maxScale === 0 || scale >= maxScale;
		return aboveMin && belowMax;
	}

	private scheduleUpdate(): void {
		this.updatePending = true;
		clearTimeout(this.timer);
		this.timer = setTimeout(() => this.update(), this.debounceMs);
	}

	/** Geographic bounds; `lngRanges` has two entries when crossing ±180°. */
	private static readonly SAMPLE_FRACTIONS = [0.02, 0.35, 0.65, 0.98];

	/**
	 * Computes the visible geographic bounds by unprojecting a grid of
	 * screen points (`screen.toMap`). Unlike any camera-position heuristic,
	 * this is correct under tilt/rotation — the camera usually sits behind
	 * the look-at point, so a box around `camera.position` misses the far
	 * half of the viewport (top of the screen).
	 *
	 * Points in the sky/space unproject to null and are skipped. With
	 * fewer than 3 ground hits (horizon/space view) we fall back to a
	 * generous box around the view center (camera position as last
	 * resort).
	 *
	 * @param zoom - Target tile zoom, used to pad by one tile width
	 * @returns Bounds with one or two longitude ranges (antimeridian), or
	 *   null when nothing of the globe is in view
	 */
	private visibleBounds(
		zoom: number
	): { ymin: number; ymax: number; lngRanges: [number, number][] } | null {
		const pts: [number, number][] = [];
		const { width: w, height: h } = this.provider.screen.size();
		if (w > 0 && h > 0) {
			for (const fx of PmtilesLayerAdapter.SAMPLE_FRACTIONS) {
				for (const fy of PmtilesLayerAdapter.SAMPLE_FRACTIONS) {
					try {
						const p = this.provider.screen.toMap({ x: w * fx, y: h * fy });
						if (p && p.lng != null && p.lat != null) {
							pts.push([p.lng, p.lat]);
						}
					} catch {
						/* point off the globe */
					}
				}
			}
		}

		const tileWidth = 360 / 2 ** zoom;

		if (pts.length < 3) {
			// Horizon/space view — generous box around the look-at point. The camera
			// state IS the look-at point on both providers (2D centre / 3D camera
			// position), so the old `view.center ?? view.camera.position` pair is one
			// read now.
			const cam = this.provider.camera.get();
			if (!cam || cam.longitude == null) return null;
			const altitude = cam.z ?? 12_000_000;
			const lonSpan = Math.min(180, (altitude / 111_000) * 1.6);
			const latSpan = Math.min(90, (altitude / 111_000) * 1.0);
			return {
				ymin: cam.latitude - latSpan,
				ymax: cam.latitude + latSpan,
				lngRanges: [[cam.longitude - lonSpan, cam.longitude + lonSpan]]
			};
		}

		let lngMin = Infinity;
		let lngMax = -Infinity;
		let latMin = Infinity;
		let latMax = -Infinity;
		for (const [lng, lat] of pts) {
			if (lng < lngMin) lngMin = lng;
			if (lng > lngMax) lngMax = lng;
			if (lat < latMin) latMin = lat;
			if (lat > latMax) latMax = lat;
		}

		const latPad = (latMax - latMin) * 0.15 + tileWidth;
		const lngPad = (lngMax - lngMin) * 0.15 + tileWidth;

		// A raw spread > 180° means the view straddles the antimeridian
		// (e.g. lngs -179 and +178): the true extent is the complement.
		if (lngMax - lngMin > 180) {
			const west = pts.filter(([lng]) => lng < 0).map(([lng]) => lng);
			const east = pts.filter(([lng]) => lng >= 0).map(([lng]) => lng);
			const westMax = Math.max(...west);
			const eastMin = Math.min(...east);
			return {
				ymin: latMin - latPad,
				ymax: latMax + latPad,
				lngRanges: [
					[eastMin - lngPad, 180],
					[-180, westMax + lngPad]
				]
			};
		}

		return {
			ymin: latMin - latPad,
			ymax: latMax + latPad,
			lngRanges: [[lngMin - lngPad, lngMax + lngPad]]
		};
	}

	private async update(): Promise<void> {
		if (this.destroyed) return;
		this.updatePending = false;

		const scale = this.provider.camera.get()?.scale;
		if (!scale || !this.inScaleWindow(scale)) {
			// Tier no longer active — free its cache entirely (the active tier
			// needs the memory; returning here will refetch).
			this.evictAll();
			return;
		}

		const zoom = this.zoomForScale(scale);
		const bounds = this.visibleBounds(zoom);
		if (!bounds) return;
		this.debug.lastExtent = `lat ${bounds.ymin.toFixed(2)}..${bounds.ymax.toFixed(2)} lng ${bounds.lngRanges
			.map(([a, b]) => `${a.toFixed(2)}..${b.toFixed(2)}`)
			.join(' + ')} @z${zoom}`;

		const tiles = this.getTilesForExtent(bounds, zoom);

		this.debug.lastTilesFetched = tiles.map((t) => tileKey(t.z, t.x, t.y));

		const neededKeys = new Set(tiles.map((t) => tileKey(t.z, t.x, t.y)));

		// Hide tiles that scrolled off-screen — keep their decoded cells in
		// the LRU cache so panning back re-shows them without a refetch/redecode.
		for (const key of [...this.loadedTiles]) {
			if (!neededKeys.has(key)) this.hideTile(key);
		}

		// Reconcile needed tiles: re-show cached ones instantly, queue the rest.
		const toLoad: { z: number; x: number; y: number }[] = [];
		for (const t of tiles) {
			const key = tileKey(t.z, t.x, t.y);
			if (this.loadedTiles.has(key)) {
				this.touch(key);
				continue;
			}
			const cached = this.tileCells.get(key);
			if (cached) this.showTile(key, cached);
			else toLoad.push(t);
		}
		this.enforceCacheCap();

		if (toLoad.length === 0) return;

		console.log(
			`[PMTiles] Loading ${toLoad.length} tiles at z${zoom}`,
			toLoad.map((t) => `${t.z}/${t.x}/${t.y}`)
		);

		// Mark the tier as loading so the hex-hover lookup defers any "no data"
		// verdict until these tiles settle; fire the settle callback when the
		// last in-flight batch finishes (re-resolves a stationary hover).
		this.activeLoads++;
		try {
			await this.loadTileBatch(toLoad);
		} finally {
			this.activeLoads--;
			if (this.activeLoads === 0 && !this.destroyed) this.onTilesSettled?.();
		}
		this.enforceCacheCap();
	}

	/** Fetches + renders a batch of tiles in parallel (called by {@link update}). */
	private async loadTileBatch(toLoad: { z: number; x: number; y: number }[]): Promise<void> {
		await Promise.all(
			toLoad.map(async ({ z, x, y }) => {
				const key = tileKey(z, x, y);
				if (this.loadedTiles.has(key) || this.destroyed) return;

				try {
					// Fetch + MVT-decode either in a worker or inline; both yield the
					// same `{ coords, props }`, which the main thread zips into cells.
					const decoded = this.decodeInWorker
						? await workerDecodeTile(this.url, z, x, y, this.layerName)
						: await this.decodeTileInline(z, x, y);
					if (this.destroyed) return;

					if (this.debug.layerName === null && decoded.layerNames.length) {
						this.debug.layerName = decoded.layerNames.join(', ');
					}

					const cells = this.buildCells(key, z, x, y, decoded.coords, decoded.props);

					if (cells.length > 0 && !this.destroyed) {
						this.sink.add(cells);
						this.tileCells.set(key, cells);
						this.loadedTiles.add(key);
						this.debug.tilesLoaded = this.loadedTiles.size;
						this.debug.cellsCount += cells.length;
					}
				} catch (e) {
					const msg = e instanceof Error ? e.message : String(e);
					console.error(`[PMTiles] Error loading tile ${key}:`, msg);
					this.debug.lastError = `Tile ${key}: ${msg}`;
				}
			})
		);
	}

	/**
	 * Inline (main-thread) fetch + MVT decode of one tile into `{ coords, props }`
	 * — the same shape the worker returns, so {@link buildCells} is shared.
	 */
	private async decodeTileInline(z: number, x: number, y: number): Promise<DecodedTile> {
		const tileData = await this.pmtiles!.getZxy(z, x, y);
		if (!tileData?.data) return { coords: new Float64Array(0), props: [], layerNames: [] };

		const tile = new VectorTile(new Pbf(tileData.data));
		const layerNames = Object.keys(tile.layers);
		const layerData =
			(this.layerName ? tile.layers[this.layerName] : undefined) ?? tile.layers[layerNames[0]];
		if (!layerData) return { coords: new Float64Array(0), props: [], layerNames };

		const coords = new Float64Array(layerData.length * 2);
		const props: Record<string, unknown>[] = [];
		let n = 0;
		for (let i = 0; i < layerData.length; i++) {
			const geojson = layerData.feature(i).toGeoJSON(x, y, z);
			if (geojson.geometry.type !== 'Point') continue;
			const [lng, lat] = geojson.geometry.coordinates as [number, number];
			coords[n * 2] = lng;
			coords[n * 2 + 1] = lat;
			props.push(geojson.properties || {});
			n++;
		}
		return { coords: coords.slice(0, n * 2), props, layerNames };
	}

	/**
	 * Zips a decoded tile's parallel `coords`/`props` arrays into neutral
	 * {@link TileCell}s and indexes each one for hover. Buffer features the tile
	 * carries from its neighbors are dropped via {@link tileOwnsPoint}, so each
	 * cell is added by exactly one tile — a translucent renderer would otherwise
	 * composite the duplicates.
	 *
	 * The cell's `attributes` IS the decoded `props` entry (not a copy), exactly
	 * as the hover index entry's is: a sink that renames keys or stamps an id
	 * onto them is seen by the tooltip, which is the behaviour the ArcGIS sink's
	 * field renaming has always relied on.
	 *
	 * @param key - Tile cache key (`z/x/y`), stored on hover-index entries.
	 * @param z - Tile zoom level.
	 * @param x - Tile column.
	 * @param y - Tile row.
	 * @param coords - Decoded `[lng, lat]` pairs, flattened.
	 * @param props - Decoded per-feature attribute objects, parallel to `coords`.
	 */
	private buildCells(
		key: string,
		z: number,
		x: number,
		y: number,
		coords: Float64Array,
		props: Record<string, unknown>[]
	): TileCell[] {
		const cells: TileCell[] = [];
		for (let i = 0; i < props.length; i++) {
			const lng = coords[i * 2];
			const lat = coords[i * 2 + 1];
			if (!tileOwnsPoint(z, x, y, lng, lat)) continue;
			const attributes = props[i];
			cells.push({ lng, lat, attributes });

			const h3id = attributes['h3id'];
			if (typeof h3id === 'string') {
				this.h3Index.set(h3id, { attributes, lat, lng, tile: key });
			}
		}
		return cells;
	}

	/** Marks a cached tile most-recently-used (re-inserts at the Map tail). */
	private touch(key: string): void {
		const cells = this.tileCells.get(key);
		if (cells) {
			this.tileCells.delete(key);
			this.tileCells.set(key, cells);
		}
	}

	/**
	 * Re-adds a cached tile's cells to the layer (no fetch/decode). The SAME
	 * {@link TileCell} instances go back in, so the sink sees the tile it
	 * removed earlier, not a look-alike.
	 *
	 * @param key - Tile cache key (`z/x/y`).
	 * @param cells - The tile's cached cells.
	 */
	private showTile(key: string, cells: TileCell[]): void {
		if (this.destroyed) return;
		this.sink.add(cells);
		this.loadedTiles.add(key);
		this.debug.cellsCount += cells.length;
		this.debug.tilesLoaded = this.loadedTiles.size;
		this.touch(key);
	}

	/** Removes a tile from the layer but keeps its cells in the LRU cache. */
	private hideTile(key: string): void {
		const cells = this.tileCells.get(key);
		if (cells) {
			this.sink.remove(cells);
			this.debug.cellsCount -= cells.length;
		}
		this.loadedTiles.delete(key);
		this.debug.tilesLoaded = this.loadedTiles.size;
		this.touch(key);
	}

	/** Fully drops a tile: from the layer (if shown), the cache, and the h3 index. */
	private evictTile(key: string): void {
		const cells = this.tileCells.get(key);
		if (cells) {
			if (this.loadedTiles.has(key)) {
				this.sink.remove(cells);
				this.debug.cellsCount -= cells.length;
			}
			for (const cell of cells) {
				const h3id = cell.attributes?.['h3id'];
				if (typeof h3id === 'string' && this.h3Index.get(h3id)?.tile === key) {
					this.h3Index.delete(h3id);
				}
			}
			this.tileCells.delete(key);
		}
		this.loadedTiles.delete(key);
		this.debug.tilesLoaded = this.loadedTiles.size;
	}

	/** Evicts every cached tile (used when the camera scale leaves the window). */
	private evictAll(): void {
		if (this.tileCells.size === 0) return;
		for (const key of [...this.tileCells.keys()]) {
			this.evictTile(key);
		}
	}

	/** Evicts oldest non-visible cached tiles until the cache is under cap. */
	private enforceCacheCap(): void {
		if (this.tileCells.size <= this.maxCacheTiles) return;
		for (const key of this.tileCells.keys()) {
			if (this.tileCells.size <= this.maxCacheTiles) break;
			if (this.loadedTiles.has(key)) continue; // never evict a visible tile
			this.evictTile(key);
		}
	}

	/**
	 * Maps a camera scale to the matching web-map tile zoom,
	 * clamped to the archive's header zoom range.
	 *
	 * @param scale - Current camera scale (1:N)
	 */
	private zoomForScale(scale: number): number {
		const z = Math.round(Math.log2(SCALE_Z0 / scale));
		return Math.max(this.headerMinZoom, Math.min(this.headerMaxZoom, z));
	}

	/**
	 * Computes which tiles cover the visible bounds at a given zoom level.
	 * Supports a split longitude range (antimeridian). When the extent
	 * needs more than {@link maxTiles} tiles, keeps the ones closest to
	 * the extent center — partial center-first coverage instead of a
	 * blank layer.
	 *
	 * @param bounds - Visible bounds from {@link visibleBounds}
	 * @param zoom - Tile zoom level
	 */
	private getTilesForExtent(
		bounds: { ymin: number; ymax: number; lngRanges: [number, number][] },
		zoom: number
	): { z: number; x: number; y: number }[] {
		const ymin = Math.max(-85.05, bounds.ymin);
		const ymax = Math.min(85.05, bounds.ymax);

		const n = 2 ** zoom;
		const toTileX = (lng: number) =>
			Math.max(0, Math.min(n - 1, Math.floor(((lng + 180) / 360) * n)));
		const toTileY = (lat: number) => {
			const rad = (lat * Math.PI) / 180;
			return Math.max(
				0,
				Math.min(
					n - 1,
					Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n)
				)
			);
		};

		const minTileY = toTileY(ymax); // y is inverted
		const maxTileY = toTileY(ymin);

		const tiles: { z: number; x: number; y: number }[] = [];
		const seen = new Set<string>();
		for (const [lngMin, lngMax] of bounds.lngRanges) {
			const minTileX = toTileX(Math.max(-180, lngMin));
			const maxTileX = toTileX(Math.min(180, lngMax));
			for (let x = minTileX; x <= maxTileX; x++) {
				for (let y = minTileY; y <= maxTileY; y++) {
					const key = `${x}/${y}`;
					if (seen.has(key)) continue;
					seen.add(key);
					tiles.push({ z: zoom, x, y });
				}
			}
		}

		if (tiles.length > this.maxTiles) {
			// Keep the tiles nearest the extent center (Chebyshev distance)
			// — render the middle of the view rather than nothing.
			const cx = tiles.reduce((s, t) => s + t.x, 0) / tiles.length;
			const cy = tiles.reduce((s, t) => s + t.y, 0) / tiles.length;
			tiles.sort(
				(a, b) =>
					Math.max(Math.abs(a.x - cx), Math.abs(a.y - cy)) -
					Math.max(Math.abs(b.x - cx), Math.abs(b.y - cy))
			);
			console.log(
				`[PMTiles] Extent needs ${tiles.length} tiles at z${zoom} — capping to nearest ${this.maxTiles}`
			);
			tiles.length = this.maxTiles;
		}

		return tiles;
	}

	/**
	 * Cleans up the adapter — drops the sink's layer and stops watching.
	 */
	destroy(): void {
		this.destroyed = true;
		this.onTilesSettled = null;
		clearTimeout(this.timer);
		this.watchHandle?.remove();
		this.sink.clear();
		this.loadedTiles.clear();
		this.tileCells.clear();
		this.h3Index.clear();
		if (this.decodeInWorker) releaseDecodeWorker();
	}
}
