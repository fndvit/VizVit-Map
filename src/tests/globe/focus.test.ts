import { describe, it, expect, vi } from 'vitest';
import { createFocusRegionTracker, focusRegionFor } from '$lib/globe/focus';
import type { GlobeConfig } from '$lib/globe/config';
import type { RegionShape } from '$lib/geo';

const DECCAN = { id: 'deccan', src: '/regions/deccan.geojson' };
const config = (focus: GlobeConfig['focus']) => ({ basemap: { id: 'x' }, focus }) as GlobeConfig;

describe('focusRegionFor', () => {
	it('gives the region to the capabilities `confine` names, and to no other', () => {
		const cfg = config({ region: DECCAN, confine: ['markers'] });
		expect(focusRegionFor(cfg, 'markers')).toBe(DECCAN);
		expect(focusRegionFor(cfg, 'pins')).toBeNull();
	});

	it('is null with no focus, no region or no confine list', () => {
		expect(focusRegionFor(config(undefined), 'markers')).toBeNull();
		expect(focusRegionFor(config({ region: null, confine: ['markers'] }), 'markers')).toBeNull();
		expect(focusRegionFor(config({ region: DECCAN }), 'markers')).toBeNull();
	});
});

describe('createFocusRegionTracker', () => {
	const shape = (id: string) => ({ id }) as unknown as RegionShape;

	it('loads a region once per id and hands over its shape', async () => {
		const onShape = vi.fn();
		const load = vi.fn(async (src: string) => shape(src));
		const tracker = createFocusRegionTracker(onShape, load);
		tracker.set(DECCAN);
		tracker.set({ ...DECCAN });
		await vi.waitFor(() => expect(onShape).toHaveBeenCalledOnce());
		expect(load).toHaveBeenCalledOnce();
		expect(onShape).toHaveBeenCalledWith(shape(DECCAN.src));
	});

	it('drops a shape superseded by a later region, and unconfines on null', async () => {
		const onShape = vi.fn();
		let release!: () => void;
		const slow = new Promise<void>((r) => (release = r));
		const load = vi.fn(async (src: string) => {
			if (src === DECCAN.src) await slow;
			return shape(src);
		});
		const tracker = createFocusRegionTracker(onShape, load);
		tracker.set(DECCAN);
		tracker.set(null);
		release();
		await new Promise((r) => setTimeout(r, 0));
		expect(onShape.mock.calls).toEqual([[null]]);
	});

	it('logs a region that fails to load and leaves things as they were', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const onShape = vi.fn();
		createFocusRegionTracker(onShape, async () => {
			throw new Error('404');
		}).set(DECCAN);
		await vi.waitFor(() => expect(warn).toHaveBeenCalled());
		expect(onShape).not.toHaveBeenCalled();
		warn.mockRestore();
	});
});
