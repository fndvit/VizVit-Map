import { describe, it, expect } from 'vitest';
import { SCALE_Z0, scaleForZoom, zoomForScale } from '$lib/map-engine/scale';
import { defaultLodConfig } from '$lib/config/exploreLayerData';

describe('scale ↔ zoom', () => {
	it('puts zoom 0 at the equator at the reference scale', () => {
		expect(scaleForZoom(0, 0)).toBeCloseTo(SCALE_Z0, 6);
		expect(zoomForScale(SCALE_Z0, 0)).toBeCloseTo(0, 9);
	});

	it('halves the scale for every zoom level', () => {
		expect(scaleForZoom(1, 0)).toBeCloseTo(SCALE_Z0 / 2, 6);
		expect(scaleForZoom(4, 0)).toBeCloseTo(SCALE_Z0 / 16, 6);
	});

	it('narrows the ground scale away from the equator', () => {
		expect(scaleForZoom(5, 60)).toBeLessThan(scaleForZoom(5, 0));
	});

	it('round-trips any scale at any latitude', () => {
		for (const latitude of [0, 23.5, -45, 60, 84]) {
			for (const scale of [1_000, 50_000, 2_000_000, 200_000_000]) {
				expect(scaleForZoom(zoomForScale(scale, latitude), latitude)).toBeCloseTo(scale, 6);
			}
		}
	});

	it('clamps beyond the web-mercator limits instead of collapsing to zero', () => {
		expect(scaleForZoom(3, 89)).toBe(scaleForZoom(3, 85));
		expect(Number.isFinite(zoomForScale(1000, -90))).toBe(true);
	});
});

describe('the explore LOD ladder survives the currency', () => {
	it('round-trips every tier scale window a provider might derive from zoom', () => {
		const windows = Object.values(defaultLodConfig).flatMap((tier) => [
			tier.minScale,
			tier.maxScale
		]);
		const bounded = windows.filter((s) => s > 0);
		expect(bounded.length).toBeGreaterThan(0);
		for (const scale of bounded) {
			const back = scaleForZoom(zoomForScale(scale, 0), 0);
			expect(Math.abs(back - scale) / scale).toBeLessThan(1e-9);
		}
	});
});
