import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createPinsCapability, pinsRule } from '$lib/globe/capabilities/pinsCapability';
import { regionShapeOf } from '$lib/geo';
import type { PinsConfig, ProjectedPin } from '$lib/globe/config';
import { makeFakeContext } from '$lib/testing/fakeProvider';

// The real projection helper is rAF-throttled: queue the frames the helper asks
// for and run them on demand, so one `schedule()` really is one projection.
let frames: ((t: number) => void)[] = [];
const flush = () => {
	for (const cb of frames.splice(0)) cb(0);
};

beforeEach(() => {
	frames = [];
	vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => frames.push(cb));
	vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

/**
 * Builds a pins config. The fake provider projects `x = 500 + lng * 2`,
 * `y = 400 - lat * 2` into a 1000×800 view, with the camera over longitude 0 /
 * latitude 20.
 *
 * @param items - The pins to project.
 * @param onProjected - Spy receiving each projection result.
 */
const config = (
	items: PinsConfig['items'],
	onProjected: PinsConfig['onProjected']
): PinsConfig => ({
	items,
	onProjected
});

/** The pins handed to `onProjected` by its most recent call. */
const last = (onProjected: ReturnType<typeof vi.fn>): ProjectedPin[] =>
	onProjected.mock.calls.at(-1)![0];

describe('pinsCapability', () => {
	it('projects a near-side pin to screen pixels and marks it visible', () => {
		const { ctx } = makeFakeContext();
		const onProjected = vi.fn();
		createPinsCapability().setup(ctx, config([{ id: 'near', lon: 5, lat: 10 }], onProjected));
		flush();

		expect(last(onProjected)).toEqual([{ id: 'near', x: 510, y: 380, visible: true }]);
	});

	it('marks a pin on the far side of the globe invisible (dot-product heuristic)', () => {
		const { ctx } = makeFakeContext();
		const onProjected = vi.fn();
		createPinsCapability().setup(ctx, config([{ id: 'far', lon: 170, lat: 10 }], onProjected));
		flush();

		expect(last(onProjected)).toEqual([{ id: 'far', x: 840, y: 380, visible: false }]);
	});

	it('projects an empty set to an empty result', () => {
		const { ctx } = makeFakeContext();
		const onProjected = vi.fn();
		createPinsCapability().setup(ctx, config([], onProjected));
		flush();
		expect(last(onProjected)).toEqual([]);
	});

	it('re-projects when the camera moves', () => {
		const { ctx, provider } = makeFakeContext();
		const onProjected = vi.fn();
		createPinsCapability().setup(ctx, config([{ id: 'near', lon: 5, lat: 10 }], onProjected));
		flush();
		onProjected.mockClear();

		provider.setCamera({ longitude: 180 }, true);
		flush();

		expect(onProjected).toHaveBeenCalledOnce();
		// The camera swung to the antipode: the same pin is now behind the globe.
		expect(last(onProjected)[0].visible).toBe(false);
	});

	it('re-projects the new pin set on update', () => {
		const { ctx } = makeFakeContext();
		const onProjected = vi.fn();
		const cap = createPinsCapability();
		cap.setup(ctx, config([{ id: 'a', lon: 1, lat: 2 }], onProjected));
		flush();
		onProjected.mockClear();

		cap.update!(ctx, config([{ id: 'b', lon: 3, lat: 4 }], onProjected));
		flush();

		expect(last(onProjected)).toEqual([{ id: 'b', x: 506, y: 392, visible: true }]);
	});

	it('stops projecting after destroy', () => {
		const { ctx, provider } = makeFakeContext();
		const onProjected = vi.fn();
		const cap = createPinsCapability();
		cap.setup(ctx, config([{ id: 'a', lon: 1, lat: 2 }], onProjected));
		flush();

		cap.destroy!();
		onProjected.mockClear();
		provider.setCamera({ longitude: 40 }, true);
		flush();

		expect(onProjected).not.toHaveBeenCalled();
	});
});

describe('pinsCapability — confined to the focus', () => {
	/** A region holding the pin at lon 10 and not the one at lon 50. */
	const west = regionShapeOf({
		type: 'Polygon',
		coordinates: [
			[
				[0, 0],
				[20, 0],
				[20, 40],
				[0, 40],
				[0, 0]
			]
		]
	});
	const REGION = { id: 'west', src: '/regions/west.json' };
	const pins = [
		{ id: 'in', lon: 10, lat: 20 },
		{ id: 'out', lon: 50, lat: 20 }
	];

	it('projects only the pins inside the region, and all of them once released', async () => {
		const { ctx } = makeFakeContext();
		const onProjected = vi.fn();
		const cap = createPinsCapability(async () => west);
		cap.setup(ctx, { ...config(pins, onProjected), region: REGION });
		await vi.waitFor(() => {
			flush();
			expect(last(onProjected).map((p) => p.id)).toEqual(['in']);
		});

		cap.update!(ctx, { ...config(pins, onProjected), region: null });
		flush();
		expect(last(onProjected).map((p) => p.id)).toEqual(['in', 'out']);
	});

	it('takes its region from the config through the rule, only when `confine` lists it', () => {
		const base = { basemap: { id: 'x' }, pins: config(pins, vi.fn()) };
		expect(
			pinsRule.select({ ...base, focus: { region: REGION, confine: ['pins'] } } as never)
		).toMatchObject({ region: REGION });
		expect(
			pinsRule.select({ ...base, focus: { region: REGION, confine: ['markers'] } } as never)
		).toMatchObject({ region: null });
	});
});
