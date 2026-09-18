import { describe, it, expect, vi } from 'vitest';
import { createMarkersCapability } from '$lib/globe/capabilities/markersCapability';
import type { MarkersConfig } from '$lib/globe/config';
import type { PointItem } from '$lib/map-engine/provider';
import { makeFakeContext, type FakePointLayer, type FakeProvider } from '$lib/testing/fakeProvider';

const items = [
	{ id: 'india', lon: 78, lat: 20 },
	{ id: 'china', lon: 104, lat: 35 },
	{ id: 'kenya', lon: 36, lat: -1 }
];

const baseConfig = (over: Partial<MarkersConfig> = {}): MarkersConfig => ({
	items,
	symbol: 'diamond',
	activeId: 'india',
	flyOnSelect: 'storySelect',
	...over
});

/** The items currently drawn on the capability's points layer. */
const drawn = (provider: FakeProvider): PointItem[] => {
	const layer = provider.layer('markers');
	expect(layer?.kind).toBe('points');
	return (layer as FakePointLayer).items;
};

describe('markersCapability.setup', () => {
	it('adds one item per marker, excluding excludeId', async () => {
		const { ctx, provider } = makeFakeContext();
		await createMarkersCapability().setup(ctx, baseConfig({ excludeId: 'kenya' }));

		expect(drawn(provider).map((i) => i.id)).toEqual(['india', 'china']);
	});

	it('styles the active marker larger (size 16) than the rest', async () => {
		const { ctx, provider } = makeFakeContext();
		await createMarkersCapability().setup(ctx, baseConfig({ activeId: 'china' }));

		const list = drawn(provider);
		expect(list.find((i) => i.id === 'china')!.symbol.size).toBe(16);
		expect(list.find((i) => i.id === 'india')!.symbol.size).toBe(12);
	});

	it('routes a click on a marker to onSelect', async () => {
		const { ctx, provider } = makeFakeContext();
		const onSelect = vi.fn();
		await createMarkersCapability().setup(ctx, baseConfig({ onSelect }));

		provider.hits.markers = 'china';
		await provider.fire('click', { x: 1, y: 2, lngLat: null });
		expect(onSelect).toHaveBeenCalledWith('china');
	});

	it('ignores a click that misses every marker', async () => {
		const { ctx, provider } = makeFakeContext();
		const onSelect = vi.fn();
		await createMarkersCapability().setup(ctx, baseConfig({ onSelect }));

		provider.hits.markers = null;
		await provider.fire('click', { x: 1, y: 2, lngLat: null });
		expect(onSelect).not.toHaveBeenCalled();
	});

	it('renders the currentId story as a non-clickable white "you are here" marker', async () => {
		const { ctx, provider } = makeFakeContext();
		await createMarkersCapability().setup(
			ctx,
			baseConfig({ excludeId: 'india', currentId: 'india' })
		);

		// india is excluded from the clickable diamonds but added as the white marker.
		const list = drawn(provider);
		const clickable = list.filter((i) => i.hittable !== false);
		expect(clickable.map((i) => i.id)).toEqual(['china', 'kenya']);

		const current = list.find((i) => i.id === '__current');
		expect(current).toBeDefined();
		expect(current!.hittable).toBe(false); // excluded from hitTest → never clickable
		expect(current!.symbol.size).toBe(16);
		expect(current!.symbol.color).toEqual([255, 255, 255, 0.9]);
		expect(current!.symbol.outline).toEqual({ color: [180, 140, 10, 1], width: 2 });
	});

	it('does not route a click to onSelect for the white current marker', async () => {
		const { ctx, provider } = makeFakeContext();
		const onSelect = vi.fn();
		await createMarkersCapability().setup(
			ctx,
			baseConfig({ excludeId: 'india', currentId: 'india', onSelect })
		);

		// The white marker is `hittable: false`, so the layer's hitTest is a miss.
		provider.hits.markers = null;
		await provider.fire('click', { x: 1, y: 2, lngLat: null });
		expect(onSelect).not.toHaveBeenCalled();
	});
});

describe('markersCapability.update', () => {
	it('restyles and flies to the new active marker when activeId changes', async () => {
		const { ctx, provider } = makeFakeContext();
		const cap = createMarkersCapability();
		await cap.setup(ctx, baseConfig({ activeId: 'india' }));

		cap.update!(ctx, baseConfig({ activeId: 'china' }));

		expect(drawn(provider).find((i) => i.id === 'china')!.symbol.size).toBe(16);
		expect(provider.flyCalls).toHaveLength(1);
		expect(provider.flyCalls[0].target).toMatchObject({
			longitude: 104,
			latitude: 35,
			tilt: 0,
			heading: 0
		});
	});

	it('does not fly when the active marker is unchanged', async () => {
		const { ctx, provider } = makeFakeContext();
		const cap = createMarkersCapability();
		await cap.setup(ctx, baseConfig({ activeId: 'india' }));

		cap.update!(ctx, baseConfig({ activeId: 'india' }));
		expect(provider.flyCalls).toHaveLength(0);
	});

	it('leaves the white current marker untouched on restyle', async () => {
		const { ctx, provider } = makeFakeContext();
		const cap = createMarkersCapability();
		await cap.setup(ctx, baseConfig({ activeId: 'china', excludeId: 'india', currentId: 'india' }));

		cap.update!(ctx, baseConfig({ activeId: 'kenya', excludeId: 'india', currentId: 'india' }));

		const current = drawn(provider).find((i) => i.id === '__current')!;
		expect(current.symbol.color).toEqual([255, 255, 255, 0.9]);
		expect(current.symbol.size).toBe(16);
	});
});

describe('markersCapability.destroy', () => {
	it('removes the points layer it created', async () => {
		const { ctx, provider } = makeFakeContext();
		const cap = createMarkersCapability();
		await cap.setup(ctx, baseConfig());

		cap.destroy!();
		expect(provider.created.find((l) => l.id === 'markers')!.removed).toBe(true);
	});
});
