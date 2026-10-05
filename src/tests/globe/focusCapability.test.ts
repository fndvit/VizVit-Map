import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFocusCapability, focusRule } from '$lib/globe/capabilities/focusCapability';
import type { FocusConfig } from '$lib/globe/config';
import { DEFAULT_CAPABILITY_RULES } from '$lib/globe/registry';
import {
	makeFakeContext,
	type FakeGeoJsonLayer,
	type FakeProvider
} from '$lib/testing/fakeProvider';

const DECCAN = { id: 'deccan', src: '/regions/deccan.geojson' };
const CERRADO = { id: 'cerrado', src: '/regions/cerrado.geojson' };

const focus = (over: Partial<FocusConfig> = {}): FocusConfig => ({ region: DECCAN, ...over });
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

describe('focusCapability', () => {
	it('outlines the region with a draped, stroke-only layer at its src', () => {
		const { ctx, provider } = makeFakeContext();
		createFocusCapability().setup(ctx, focus());
		const layer = layerOf(provider, 'deccan');
		expect(layer.source).toEqual({ url: '/regions/deccan.geojson' });
		expect(layer.placement).toBe('draped');
		expect(layer.style).toEqual({ stroke: { color: '#000000', width: 1.5 } });
		expect(layer.opacity).toBe(1);
	});

	it('fades the outline out and back with `visible`, without remounting', async () => {
		const { ctx, provider } = makeFakeContext();
		const cap = createFocusCapability();
		await cap.setup(ctx, focus());
		cap.update!(ctx, focus({ visible: false }));
		expect(layerOf(provider, 'deccan').opacity).toBe(0);
		cap.update!(ctx, focus());
		expect(layerOf(provider, 'deccan').opacity).toBe(1);
		expect(provider.created).toHaveLength(1);
	});

	it('swaps regions: the new one fades in, the old one fades out but stays mounted', async () => {
		const { ctx, provider } = makeFakeContext();
		const cap = createFocusCapability();
		await cap.setup(ctx, focus());
		cap.update!(ctx, focus({ region: CERRADO }));
		expect(layerOf(provider, 'cerrado').opacity).toBe(1);
		expect(layerOf(provider, 'deccan').opacity).toBe(0);
		cap.update!(ctx, focus());
		expect(layerOf(provider, 'deccan').opacity).toBe(1);
		expect(provider.created).toHaveLength(2);
	});

	it('restyles the live outline, and hides it with `outline: false`', async () => {
		const { ctx, provider } = makeFakeContext();
		const cap = createFocusCapability();
		await cap.setup(ctx, focus());
		cap.update!(ctx, focus({ outline: { color: '#942a45', width: 3 } }));
		expect(layerOf(provider, 'deccan').style).toEqual({ stroke: { color: '#942a45', width: 3 } });
		cap.update!(ctx, focus({ outline: false }));
		expect(layerOf(provider, 'deccan').opacity).toBe(0);
	});

	it('mounts nothing for `region: null`, then outlines a region that arrives later', async () => {
		const { ctx, provider } = makeFakeContext();
		const cap = createFocusCapability();
		await cap.setup(ctx, focus({ region: null }));
		expect(provider.created).toHaveLength(0);
		cap.update!(ctx, focus());
		expect(layerOf(provider, 'deccan').opacity).toBe(1);
	});

	it('removes every layer on destroy', async () => {
		const { ctx, provider } = makeFakeContext();
		const cap = createFocusCapability();
		await cap.setup(ctx, focus());
		cap.update!(ctx, focus({ region: CERRADO }));
		cap.destroy!();
		expect(provider.created.every((l) => l.removed)).toBe(true);
	});

	it('is a default rule, active on the presence of `focus` — even with no region', () => {
		expect(DEFAULT_CAPABILITY_RULES).toContain(focusRule);
		expect(focusRule.applies({ basemap: { id: 'x' } } as never)).toBe(false);
		expect(focusRule.applies({ basemap: { id: 'x' }, focus: { region: null } } as never)).toBe(
			true
		);
	});
});
