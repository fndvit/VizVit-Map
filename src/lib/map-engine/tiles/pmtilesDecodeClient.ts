/**
 * @module map-engine/tiles/pmtilesDecodeClient
 *
 * Main-thread client for {@link file://./pmtilesDecode.worker.ts}. Lazily spins up
 * one shared worker and routes request → response by id. SSR-safe: the worker is
 * only created on first use (which always happens in the browser).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- message payloads are dynamic */

/** Decoded tile: flat `[lng,lat,…]` coords + one attributes object per cell. */
export interface DecodedTile {
	coords: Float64Array;
	props: Record<string, unknown>[];
	layerNames: string[];
}

type Pending = { resolve: (value: any) => void; reject: (err: Error) => void };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();
/** Live consumers (PMTiles adapters) — the worker terminates at zero. */
let retainCount = 0;

/**
 * Registers a consumer of the shared decode worker. Pair with
 * {@link releaseDecodeWorker} — when the last consumer releases, the worker is
 * terminated so its per-archive PMTiles instances (directory caches for
 * multi-GB archives) don't stay resident after every globe is unmounted in
 * this SPA. The worker is lazy ({@link getWorker}), so a later retain simply
 * recreates it on the next request.
 */
export function retainDecodeWorker(): void {
	retainCount++;
}

/** Releases a consumer registered via {@link retainDecodeWorker}. */
export function releaseDecodeWorker(): void {
	retainCount = Math.max(0, retainCount - 1);
	if (retainCount > 0 || !worker) return;
	for (const [, p] of pending) p.reject(new Error('pmtiles worker terminated'));
	pending.clear();
	worker.terminate();
	worker = null;
}

function getWorker(): Worker {
	if (worker) return worker;
	worker = new Worker(new URL('./pmtilesDecode.worker.js', import.meta.url), { type: 'module' });
	worker.onmessage = (e: MessageEvent) => {
		const msg = e.data as { type: string; id: number; message?: string };
		const p = pending.get(msg.id);
		if (!p) return;
		pending.delete(msg.id);
		if (msg.type === 'error') p.reject(new Error(msg.message ?? 'worker decode error'));
		else p.resolve(msg);
	};
	worker.onerror = (e) => {
		// Fail everything in flight and drop the worker; the next call recreates it.
		for (const [, p] of pending) p.reject(new Error(e.message || 'pmtiles worker error'));
		pending.clear();
		worker?.terminate();
		worker = null;
	};
	return worker;
}

function request<T>(message: Record<string, unknown>): Promise<T> {
	const id = nextId++;
	return new Promise<T>((resolve, reject) => {
		pending.set(id, { resolve, reject });
		getWorker().postMessage({ ...message, id });
	});
}

/** Reads a PMTiles archive's zoom range (worker-side). */
export function getHeader(url: string): Promise<{ minZoom: number; maxZoom: number }> {
	return request({ type: 'header', url });
}

/** Fetches + decodes one MVT tile (worker-side) into cell coords + attributes. */
export function decodeTile(
	url: string,
	z: number,
	x: number,
	y: number,
	layerName?: string
): Promise<DecodedTile> {
	return request({ type: 'tile', url, z, x, y, layerName });
}
