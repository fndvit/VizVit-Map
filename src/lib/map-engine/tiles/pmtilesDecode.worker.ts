/**
 * @module map-engine/tiles/pmtilesDecode.worker
 *
 * Web Worker: fetches + decodes PMTiles MVT tiles off the main thread and returns
 * each cell's coordinates + attributes. The main thread zips those into neutral
 * `TileCell`s and its sink builds the layer's features. This mirrors,
 * line-for-line, the inline decode in `PmtilesLayerAdapter.ts` so the cells are
 * identical whichever path produced them.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- worker globals + loose MVT types */

import { PMTiles, FetchSource } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';

// Minimal typed view of the dedicated-worker global (avoids needing the WebWorker lib).
const ctx = self as unknown as {
	postMessage: (message: unknown, transfer?: Transferable[]) => void;
	onmessage: ((e: MessageEvent) => void) | null;
};

/** One PMTiles archive per URL (range requests reuse the same source). */
const archives = new Map<string, PMTiles>();

function archiveFor(url: string): PMTiles {
	let archive = archives.get(url);
	if (!archive) {
		const source = new FetchSource(url);
		// Same workaround as PmtilesLayerAdapter.ts: force no-store so Chrome can't answer
		// a `Range:` request with a whole-file 200 that the pmtiles client rejects.
		(source as unknown as { chromeWindowsNoCache: boolean }).chromeWindowsNoCache = true;
		archive = new PMTiles(source);
		archives.set(url, archive);
	}
	return archive;
}

type InMessage =
	| { type: 'header'; id: number; url: string }
	| {
			type: 'tile';
			id: number;
			url: string;
			z: number;
			x: number;
			y: number;
			layerName?: string;
	  };

ctx.onmessage = async (e: MessageEvent) => {
	const msg = e.data as InMessage;
	try {
		if (msg.type === 'header') {
			const header = await archiveFor(msg.url).getHeader();
			ctx.postMessage({
				type: 'header',
				id: msg.id,
				minZoom: header.minZoom,
				maxZoom: header.maxZoom
			});
			return;
		}

		const { id, url, z, x, y, layerName } = msg;
		const tileData = await archiveFor(url).getZxy(z, x, y);
		const empty = { type: 'tile', id, coords: new Float64Array(0), props: [], layerNames: [] };
		if (!tileData?.data) {
			ctx.postMessage(empty);
			return;
		}

		const tile = new VectorTile(new Pbf(tileData.data));
		const layerNames = Object.keys(tile.layers);
		const layerData =
			(layerName ? tile.layers[layerName] : undefined) ?? tile.layers[layerNames[0]];
		if (!layerData) {
			ctx.postMessage({ ...empty, layerNames });
			return;
		}

		const coords = new Float64Array(layerData.length * 2);
		const props: Record<string, unknown>[] = [];
		let n = 0;
		for (let i = 0; i < layerData.length; i++) {
			const geojson = layerData.feature(i).toGeoJSON(x, y, z) as any;
			if (geojson.geometry.type !== 'Point') continue;
			const [lng, lat] = geojson.geometry.coordinates as [number, number];
			coords[n * 2] = lng;
			coords[n * 2 + 1] = lat;
			props.push(geojson.properties || {});
			n++;
		}
		// Trim to the Point count and transfer the backing buffer (zero-copy).
		const out = coords.slice(0, n * 2);
		ctx.postMessage({ type: 'tile', id, coords: out, props, layerNames }, [out.buffer]);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		ctx.postMessage({ type: 'error', id: (msg as { id: number }).id, message });
	}
};
