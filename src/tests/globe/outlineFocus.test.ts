import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	createOutlineCapability,
	outlinesOf,
	outlinesRule
} from '$lib/globe/capabilities/outlineCapability';
import type { FocusConfig, GlobeConfig, OutlineConfig } from '$lib/globe/config';
import { mapConfigToCapabilities } from '$lib/globe/registry';
import {
	makeFakeContext,
	type FakeGeoJsonLayer,
	type FakeProvider
} from '$lib/testing/fakeProvider';

const DECCAN = { id: 'deccan', src: '/regions/deccan.geojson' };
const CERRADO = { id: 'cerrado', src: '/regions/cerrado.geojson' };

const config = (focus?: FocusConfig, outlines?: OutlineConfig[]) =>
	({ basemap: { id: 'x' }, focus, outlines }) as GlobeConfig;
const layerOf = (provider: FakeProvider, id: string) => provider.layer(id) as FakeGeoJsonLayer;

// Run each opacity tween to completion on its first frame (as outlineCapability.test does).
let nowVal = 0;
beforeEach(() => {
	nowVal = 0;
	vi.stubGlobal('performance', { now: () => nowVal });
	vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => {
		nowVal += 1000;
		cb(nowVal);
		return 1;
	});
	vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

describe('the focus outline', () => {
	it('is one more outline, keyed by the region id, shown unless `visible: false`', () => {
		expect(outlinesOf(config({ region: DECCAN }))).toEqual([
			{ ...DECCAN, visible: true, color: undefined, width: undefined }
		]);
		expect(outlinesOf(config({ region: DECCAN, visible: false }))[0].visible).toBe(false);
		expect(
			outlinesOf(config({ region: DECCAN, outline: { color: '#942a45', width: 3 } }))[0]
		).toMatchObject({ color: '#942a45', width: 3 });
	});

	it('draws nothing for `outline: false` or no region', () => {
		expect(outlinesOf(config({ region: DECCAN, outline: false }))).toEqual([]);
		expect(outlinesOf(config({ region: null }))).toEqual([]);
	});

	it('replaces an authored outline with the same id instead of drawing the boundary twice', () => {
		const authored = [
			{ id: 'deccan', src: '/other.json', visible: true },
			{ id: 'cerrado', src: CERRADO.src, visible: true }
		];
		const drawn = outlinesOf(config({ region: DECCAN }, authored));
		expect(drawn.map((o) => [o.id, o.src])).toEqual([
			['cerrado', CERRADO.src],
			['deccan', DECCAN.src]
		]);
	});

	it('mounts the outlines capability on a focus alone — even a region-less one', () => {
		expect(outlinesRule.applies(config({ region: null }))).toBe(true);
		expect(outlinesRule.applies(config())).toBe(false);
	});

	it('swaps regions on the globe: the new one fades in, the old one out but stays mounted', async () => {
		const { ctx, provider } = makeFakeContext();
		const cap = createOutlineCapability();
		await cap.setup(ctx, outlinesOf(config({ region: DECCAN })));
		cap.update!(ctx, outlinesOf(config({ region: CERRADO })));
		expect(layerOf(provider, 'cerrado').opacity).toBe(1);
		expect(layerOf(provider, 'deccan').opacity).toBe(0);
		cap.update!(ctx, outlinesOf(config({ region: DECCAN })));
		expect(layerOf(provider, 'deccan').opacity).toBe(1);
		expect(provider.created).toHaveLength(2);
	});

	it('restyles a live outline whose stroke changed', async () => {
		const { ctx, provider } = makeFakeContext();
		const cap = createOutlineCapability();
		await cap.setup(ctx, outlinesOf(config({ region: DECCAN })));
		cap.update!(
			ctx,
			outlinesOf(config({ region: DECCAN, outline: { color: '#942a45', width: 3 } }))
		);
		expect(layerOf(provider, 'deccan').style).toEqual({ stroke: { color: '#942a45', width: 3 } });
	});
});

describe('focus.confine names', () => {
	it('warns about a name no mounted capability answers to', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		mapConfigToCapabilities(
			{ ...config({ region: DECCAN, confine: ['outlines', 'label'] }) },
			'fake'
		);
		expect(warn).toHaveBeenCalledOnce();
		expect(warn.mock.calls[0][0]).toContain("'label'");
		warn.mockRestore();
	});
});
