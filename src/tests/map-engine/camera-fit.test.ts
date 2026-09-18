import { describe, it, expect } from 'vitest';
import { zoomForExtent } from '$lib/map-engine/camera-fit';

describe('zoomForExtent', () => {
	it('lands closer on a city-sized extent than on a country-sized one', () => {
		const city = zoomForExtent({ xmin: 2.8, ymin: 41.9, xmax: 2.9, ymax: 42.0 });
		const country = zoomForExtent({ xmin: -9.3, ymin: 36, xmax: 3.3, ymax: 43.8 });
		expect(city).toBeGreaterThan(country);
	});

	it('clamps tiny extents to the max landing zoom (no street-level dives)', () => {
		expect(zoomForExtent({ xmin: 0, ymin: 0, xmax: 0.0001, ymax: 0.0001 })).toBe(10);
	});

	it('clamps hemisphere-sized extents to the min landing zoom', () => {
		expect(zoomForExtent({ xmin: -180, ymin: -85, xmax: 180, ymax: 85 })).toBe(3);
	});
});
