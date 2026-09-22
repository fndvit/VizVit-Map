import { describe, it, expect, vi } from 'vitest';
import { addVectorTileOverlay } from '$lib/map-engine/arcgis/vectorTileOverlay';

/* eslint-disable @typescript-eslint/no-explicit-any -- fakes stand in for ArcGIS objects */

const STYLE_LAYERS = [
	{ id: 'landF', type: 'fill', 'source-layer': 'landF' },
	{ id: 'g_politicalLine/stateLgL', type: 'line', 'source-layer': 'stateLgL' },
	{ id: 'g_spriteGlyph/POI/POI 0k', type: 'symbol', 'source-layer': 'POI 0k' },
	{ id: 'countryLgT', type: 'symbol', 'source-layer': 'countryLgT' }
];

/** A `VectorTileLayer` that records construction, load order and visibility calls. */
function fakeNative(loadError?: Error) {
	const events: string[] = [];
	class FakeVectorTileLayer {
		visible = true;
		hidden: string[] = [];
		currentStyleInfo = { style: { layers: STYLE_LAYERS } };
		constructor(public props: any) {}
		async load() {
			events.push('load');
			if (loadError) throw loadError;
		}
		setStyleLayerVisibility(id: string, visibility: string) {
			events.push(`hide:${id}`);
			if (visibility === 'none') this.hidden.push(id);
		}
	}
	const layers: any[] = [];
	const map = {
		layers: {
			get length() {
				return layers.length;
			},
			includes: (l: any) => layers.includes(l)
		},
		add(layer: any) {
			events.push('add');
			layers.push(layer);
		},
		remove(layer: any) {
			events.push('remove');
			layers.splice(layers.indexOf(layer), 1);
		},
		reorder: vi.fn((layer: any, index: number) => {
			layers.splice(layers.indexOf(layer), 1);
			layers.splice(index, 0, layer);
		})
	};
	const loadModules = vi.fn(async () => ({ VectorTileLayer: FakeVectorTileLayer }) as any);
	return {
		native: { kind: 'arcgis' as const, view: {}, map, loadModules },
		map,
		layers,
		events
	};
}

const URL = 'https://example.test/server/rest/services/basemaps/blackline/VectorTileServer';

describe('addVectorTileOverlay', () => {
	it('builds the layer from the adapter loader with the url, title and opacity', async () => {
		const { native, layers } = fakeNative();

		const handle = await addVectorTileOverlay(native as any, {
			url: URL,
			title: 'POI',
			opacity: 0.8
		});

		expect(native.loadModules).toHaveBeenCalledWith(['VectorTileLayer']);
		expect(handle.layer.props).toEqual({ url: URL, title: 'POI', opacity: 0.8 });
		expect(layers).toEqual([handle.layer]);
	});

	it('draws the whole style when no filter is given', async () => {
		const { native } = fakeNative();
		const handle = await addVectorTileOverlay(native as any, { url: URL });
		expect(handle.layer.hidden).toEqual([]);
		expect(handle.visibleStyleLayers).toEqual(STYLE_LAYERS.map((l) => l.id));
	});

	it('hides every style layer the filter rejects, and only those', async () => {
		const { native } = fakeNative();

		const handle = await addVectorTileOverlay(native as any, {
			url: URL,
			keep: (layer) => layer.id.startsWith('g_spriteGlyph/') || layer.sourceLayer === 'stateLgL'
		});

		expect(handle.layer.hidden).toEqual(['landF', 'countryLgT']);
		expect(handle.visibleStyleLayers).toEqual([
			'g_politicalLine/stateLgL',
			'g_spriteGlyph/POI/POI 0k'
		]);
	});

	it('loads and filters BEFORE adding, so a filtered style never flashes complete', async () => {
		const { native, events } = fakeNative();
		await addVectorTileOverlay(native as any, { url: URL, keep: (l) => l.type === 'symbol' });
		expect(events.indexOf('add')).toBeGreaterThan(events.lastIndexOf('hide:landF'));
		expect(events[0]).toBe('load');
	});

	it('rejects when the style fails to load, adding nothing to the map', async () => {
		const { native, layers } = fakeNative(new Error('404'));
		await expect(addVectorTileOverlay(native as any, { url: URL })).rejects.toThrow('404');
		expect(layers).toEqual([]);
	});

	it('removes itself once and floats back to the top on request', async () => {
		const { native, map, layers } = fakeNative();
		const other = { id: 'other' };
		const handle = await addVectorTileOverlay(native as any, { url: URL });
		layers.push(other);

		handle.raise();
		expect(map.reorder).toHaveBeenCalledWith(handle.layer, 1);
		expect(layers).toEqual([other, handle.layer]);

		handle.setVisible(false);
		expect(handle.layer.visible).toBe(false);

		handle.remove();
		handle.remove();
		expect(layers).toEqual([other]);
	});
});
