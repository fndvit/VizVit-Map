import { describe, it, expect, vi, beforeEach } from 'vitest';

/* eslint-disable @typescript-eslint/no-explicit-any -- fakes stand in for ArcGIS objects */

import {
	applyBasemap,
	initialBasemap,
	needsDeferredApply,
	type BasemapCache
} from '$lib/map-engine/arcgis/basemap';
import type { BasemapSpec } from '$lib/map-engine';

/**
 * Fake ArcGIS constructors. `Basemap` records the options it was built with and
 * carries a destroy spy, so caching (build once, free once) can be observed
 * without loading the SDK.
 */
function fakeModules() {
	return {
		Map: vi.fn(),
		Basemap: vi.fn(function (this: any, opts: any) {
			this.opts = opts;
			this.__basemap = true;
			this.destroy = vi.fn();
		}),
		VectorTileLayer: vi.fn(function (this: any, opts: any) {
			this.opts = opts;
		})
	} as any;
}

function fakeView() {
	return { map: { basemap: null as any } };
}

const FLAT: BasemapSpec = { kind: 'flat', landColor: '#725B53', oceanColor: '#E5DACA' };
const WELL_KNOWN: BasemapSpec = { kind: 'well-known', id: 'gray-vector' };

/** A `native` spec whose loader hands back a fresh basemap each call. */
function nativeSpec(key = 'portal:abc') {
	const load = vi.fn(async () => ({ __native: true, destroy: vi.fn() }));
	return { spec: { kind: 'native', key, load } as BasemapSpec, load };
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('initialBasemap', () => {
	it('builds a flat Basemap instance for a flat spec', () => {
		const bm = initialBasemap(fakeModules(), FLAT);
		expect(bm.__basemap).toBe(true);
		expect(bm.opts.baseLayers).toHaveLength(1);
	});

	it('returns the id string for a well-known spec (ArcGIS owns those)', () => {
		expect(initialBasemap(fakeModules(), WELL_KNOWN)).toBe('gray-vector');
	});

	it('returns a flat placeholder — never a network load — for a native spec', () => {
		const { spec, load } = nativeSpec();
		const bm = initialBasemap(fakeModules(), spec);
		expect(bm.__basemap).toBe(true);
		expect(load).not.toHaveBeenCalled();
	});

	it('returns a flat placeholder for a style spec', () => {
		const bm = initialBasemap(fakeModules(), { kind: 'style', url: 'https://x/style.json' });
		expect(bm.__basemap).toBe(true);
	});
});

describe('needsDeferredApply', () => {
	it('is false for flat (resolves synchronously, no decoration needed)', () => {
		expect(needsDeferredApply(FLAT)).toBe(false);
	});

	it('is true for every other kind', () => {
		expect(needsDeferredApply(WELL_KNOWN)).toBe(true);
		expect(needsDeferredApply({ kind: 'style', url: 'u' })).toBe(true);
		expect(needsDeferredApply(nativeSpec().spec)).toBe(true);
	});
});

describe('applyBasemap', () => {
	it('assigns a built Basemap for a flat spec', async () => {
		const view = fakeView();
		await applyBasemap(view, FLAT, fakeModules(), null);
		expect(view.map.basemap.__basemap).toBe(true);
	});

	it('assigns the id string for a well-known spec', async () => {
		const view = fakeView();
		await applyBasemap(view, WELL_KNOWN, fakeModules(), null);
		expect(view.map.basemap).toBe('gray-vector');
	});

	it('builds a VectorTileLayer from the url for a style spec', async () => {
		const view = fakeView();
		const modules = fakeModules();
		await applyBasemap(view, { kind: 'style', url: 'https://x/style.json' }, modules, null);
		expect(modules.VectorTileLayer).toHaveBeenCalledWith({ url: 'https://x/style.json' });
	});

	it('hands the native surface to a native spec loader', async () => {
		const view = fakeView();
		const { spec, load } = nativeSpec();
		const native = { kind: 'arcgis', view, map: view.map };
		await applyBasemap(view, spec, fakeModules(), native);
		expect(load).toHaveBeenCalledWith(native);
		expect((view.map.basemap as any).__native).toBe(true);
	});

	it('discards a stale load when isCurrent() is false', async () => {
		const view = fakeView();
		const { spec } = nativeSpec();
		await applyBasemap(view, spec, fakeModules(), null, () => false);
		expect(view.map.basemap).toBeNull();
	});
});

describe('basemap caching — no leak', () => {
	let cache: BasemapCache;

	beforeEach(() => {
		cache = new Map();
	});

	it('reuses one flat instance across repeated swaps (builds once)', async () => {
		const view = fakeView();
		const modules = fakeModules();
		await applyBasemap(view, FLAT, modules, null, () => true, cache);
		const first = view.map.basemap;
		await applyBasemap(view, WELL_KNOWN, modules, null, () => true, cache);
		await applyBasemap(view, FLAT, modules, null, () => true, cache);

		expect(view.map.basemap).toBe(first);
		expect(modules.Basemap).toHaveBeenCalledTimes(1);
	});

	it('reuses one native instance across repeated swaps (loads once)', async () => {
		const view = fakeView();
		const { spec, load } = nativeSpec();
		await applyBasemap(view, spec, fakeModules(), null, () => true, cache);
		const first = view.map.basemap;
		await applyBasemap(view, FLAT, fakeModules(), null, () => true, cache);
		await applyBasemap(view, spec, fakeModules(), null, () => true, cache);

		expect(view.map.basemap).toBe(first);
		expect(load).toHaveBeenCalledTimes(1);
	});

	it('keys flat basemaps by their colours, so a recolour builds a new one', async () => {
		const view = fakeView();
		const modules = fakeModules();
		await applyBasemap(view, FLAT, modules, null, () => true, cache);
		await applyBasemap(
			view,
			{ kind: 'flat', landColor: '#000000', oceanColor: '#ffffff' },
			modules,
			null,
			() => true,
			cache
		);
		expect(modules.Basemap).toHaveBeenCalledTimes(2);
		expect(cache.size).toBe(2);
	});

	it('stays bounded when cycling A→B→A→B (built count = distinct specs, not swaps)', async () => {
		const view = fakeView();
		const modules = fakeModules();
		const other: BasemapSpec = { kind: 'flat', landColor: '#111111', oceanColor: '#222222' };
		for (const spec of [FLAT, other, FLAT, other]) {
			await applyBasemap(view, spec, modules, null, () => true, cache);
		}
		expect(modules.Basemap).toHaveBeenCalledTimes(2);
		expect(cache.size).toBe(2);
	});

	it('never destroys a basemap during a swap', async () => {
		const view = fakeView();
		const modules = fakeModules();
		await applyBasemap(view, FLAT, modules, null, () => true, cache);
		const flat = view.map.basemap;
		await applyBasemap(view, WELL_KNOWN, modules, null, () => true, cache);
		expect(flat.destroy).not.toHaveBeenCalled();
	});

	it('does not cache well-known basemaps (the shared-registry crash fix)', async () => {
		const view = fakeView();
		await applyBasemap(view, WELL_KNOWN, fakeModules(), null, () => true, cache);
		expect(cache.size).toBe(0);
	});
});
