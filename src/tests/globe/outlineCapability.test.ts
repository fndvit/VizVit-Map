import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createOutlineCapability } from '$lib/globe/capabilities/outlineCapability';
import type { OutlineConfig } from '$lib/globe/config';
import { makeFakeContext, type FakeGeoJsonLayer, type FakeProvider } from '../helpers/fakeProvider';

const baseConfig = (over: Partial<OutlineConfig> = {}): OutlineConfig => ({
	id: 'cerrado',
	src: '/stories/brazil/cerrado.geojson',
	...over
});

/** The live layer for an outline id. */
const layerOf = (provider: FakeProvider, id: string) => provider.layer(id) as FakeGeoJsonLayer;

/** Every layer ever created for an outline id, removed ones included. */
const createdFor = (provider: FakeProvider, id: string) =>
	provider.created.filter((l) => l.id === id);

// Run the rAF opacity tween synchronously to completion: each frame advances the
// mocked clock by a full fade duration so `t` reaches 1 on the first step.
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

describe('outlineCapability.setup', () => {
	it('creates one stroke-only, draped GeoJSON layer at the configured src', () => {
		const { ctx, provider } = makeFakeContext();
		createOutlineCapability().setup(ctx, [baseConfig()]);

		expect(provider.created).toHaveLength(1);
		const layer = layerOf(provider, 'cerrado');
		expect(layer.source).toEqual({ url: '/stories/brazil/cerrado.geojson' });
		expect(layer.placement).toBe('draped');
		expect(layer.style.fill).toBeUndefined(); // stroke only
		expect(layer.style.stroke).toEqual({ color: '#000000', width: 1.5 }); // defaults
	});

	it('honors custom color and width', () => {
		const { ctx, provider } = makeFakeContext();
		createOutlineCapability().setup(ctx, [baseConfig({ color: '#942a45', width: 3 })]);

		expect(layerOf(provider, 'cerrado').style.stroke).toEqual({ color: '#942a45', width: 3 });
	});

	it('starts hidden (opacity 0) when not visible', () => {
		const { ctx, provider } = makeFakeContext();
		createOutlineCapability().setup(ctx, [baseConfig({ visible: false })]);
		expect(layerOf(provider, 'cerrado').opacity).toBe(0);
	});

	it('starts shown (opacity 1) when initially visible — no fade flash', () => {
		const { ctx, provider } = makeFakeContext();
		createOutlineCapability().setup(ctx, [baseConfig({ visible: true })]);
		expect(layerOf(provider, 'cerrado').opacity).toBe(1);
	});

	it('mounts one layer per outline entry', () => {
		const { ctx, provider } = makeFakeContext();
		createOutlineCapability().setup(ctx, [
			baseConfig({ id: 'cerrado', src: '/a.geojson', visible: true }),
			baseConfig({ id: 'amazon', src: '/b.geojson', visible: false })
		]);

		expect(provider.created).toHaveLength(2);
		expect(layerOf(provider, 'cerrado').opacity).toBe(1);
		expect(layerOf(provider, 'amazon').opacity).toBe(0);
	});
});

describe('outlineCapability.update', () => {
	it('fades opacity up to 1 when becoming visible', () => {
		const { ctx, provider } = makeFakeContext();
		const cap = createOutlineCapability();
		cap.setup(ctx, [baseConfig({ visible: false })]);

		cap.update!(ctx, [baseConfig({ visible: true })]);
		expect(layerOf(provider, 'cerrado').opacity).toBe(1);
	});

	it('fades opacity back to 0 when hidden', () => {
		const { ctx, provider } = makeFakeContext();
		const cap = createOutlineCapability();
		cap.setup(ctx, [baseConfig({ visible: true })]);

		cap.update!(ctx, [baseConfig({ visible: false })]);
		expect(layerOf(provider, 'cerrado').opacity).toBe(0);
	});

	it('fades each outline independently — toggling one leaves the other untouched', () => {
		const { ctx, provider } = makeFakeContext();
		const cap = createOutlineCapability();
		const cerrado = baseConfig({ id: 'cerrado', src: '/a.geojson', visible: true });
		const amazon = baseConfig({ id: 'amazon', src: '/b.geojson', visible: true });
		cap.setup(ctx, [cerrado, amazon]);

		// Hide only the Cerrado; the Amazon stays fully visible.
		cap.update!(ctx, [{ ...cerrado, visible: false }, amazon]);
		expect(layerOf(provider, 'cerrado').opacity).toBe(0);
		expect(layerOf(provider, 'amazon').opacity).toBe(1);
	});

	it('fades a dropped outline to 0 but keeps it mounted (no re-fetch on re-entry)', () => {
		const { ctx, provider } = makeFakeContext();
		const cap = createOutlineCapability();
		const cerrado = baseConfig({ id: 'cerrado', src: '/a.geojson', visible: true });
		const amazon = baseConfig({ id: 'amazon', src: '/b.geojson', visible: true });
		cap.setup(ctx, [cerrado, amazon]);

		// Amazon dropped from the step → fades out, but its layer is never removed.
		cap.update!(ctx, [cerrado]);
		expect(layerOf(provider, 'amazon').removed).toBe(false);
		expect(layerOf(provider, 'amazon').opacity).toBe(0);

		// Re-declaring Amazon fades the SAME layer back in — no second layer created.
		cap.update!(ctx, [cerrado, amazon]);
		expect(createdFor(provider, 'amazon')).toHaveLength(1);
		expect(layerOf(provider, 'amazon').opacity).toBe(1);
	});

	it('mounts from an empty set, then fades in an outline added by a later update', () => {
		const { ctx, provider } = makeFakeContext();
		const cap = createOutlineCapability();
		// Story uses outlines on a later step: this globe mounts with no layers.
		cap.setup(ctx, []);
		expect(provider.created).toHaveLength(0);

		cap.update!(ctx, [baseConfig({ id: 'cerrado', src: '/a.geojson', visible: true })]);
		expect(provider.created).toHaveLength(1);
		expect(layerOf(provider, 'cerrado').opacity).toBe(1);
	});
});

describe('outlineCapability.destroy', () => {
	it('removes every layer it mounted', () => {
		const { ctx, provider } = makeFakeContext();
		const cap = createOutlineCapability();
		cap.setup(ctx, [
			baseConfig({ id: 'cerrado', src: '/a.geojson' }),
			baseConfig({ id: 'amazon', src: '/b.geojson' })
		]);

		cap.destroy!();
		expect(provider.created.every((l) => l.removed)).toBe(true);
	});
});
