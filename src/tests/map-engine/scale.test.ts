import { describe, it, expect } from 'vitest';
import { SCALE_Z0, scaleForZoom, zoomForScale } from '$lib/map-engine/scale';

describe('scale ↔ zoom', () => {
	it('puts zoom 0 at the equator at the reference scale', () => {
		expect(scaleForZoom(0, 0)).toBeCloseTo(SCALE_Z0, 6);
		expect(zoomForScale(SCALE_Z0, 0)).toBeCloseTo(0, 9);
	});

	it('matches the LOD table ArcGIS publishes for 256 px tiles', () => {
		// `tileInfo.lods` of any Esri web-mercator service: level 0 and level 2.
		expect(scaleForZoom(0)).toBeCloseTo(591_657_527.591555, 5);
		expect(scaleForZoom(2)).toBeCloseTo(147_914_381.897889, 5);
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

	describe('tile schemes', () => {
		it('treats a bare number exactly as the latitude option', () => {
			expect(scaleForZoom(4, 30)).toBe(scaleForZoom(4, { latitude: 30 }));
			expect(zoomForScale(2_000_000, 30)).toBe(zoomForScale(2_000_000, { latitude: 30 }));
		});

		it('halves every level for 512 px tiles, matching an Esri VectorTileServer’s LODs', () => {
			// `ngbasemap_blackline/VectorTileServer` tileInfo: level 0 = 295,828,763.8, level 1 = 147,914,381.9
			expect(scaleForZoom(0, { tilePx: 512 })).toBeCloseTo(295_828_763.7957775, 5);
			expect(scaleForZoom(1, { tilePx: 512 })).toBeCloseTo(147_914_381.897889, 5);
			expect(scaleForZoom(3, { tilePx: 512 })).toBeCloseTo(scaleForZoom(4, { tilePx: 256 }), 6);
		});

		it('applies the LOD snap as a fraction of a level', () => {
			// ArcGIS switches a VectorTileLayer's style zoom at the midpoint between
			// LODs: style zoom 2 takes effect at 1:52.3M in a 512 px scheme, not 1:74M.
			const snapped = scaleForZoom(2, { tilePx: 512, snap: 0.5 });
			expect(snapped).toBeCloseTo(52_295_631, -1);
			expect(snapped).toBe(scaleForZoom(2.5, { tilePx: 512 }));
		});

		it('round-trips through a full scheme', () => {
			const scheme = { tilePx: 512 as const, snap: 0.5, latitude: 40 };
			for (const zoom of [0, 2.5, 7, 11.25]) {
				expect(zoomForScale(scaleForZoom(zoom, scheme), scheme)).toBeCloseTo(zoom, 9);
			}
		});

		it('reads a view scale as the style zoom in effect there', () => {
			// Just past the snapped z2 threshold the style zoom in effect is 2.
			const scheme = { tilePx: 512 as const, snap: 0.5 };
			expect(zoomForScale(52_000_000, scheme)).toBeGreaterThan(2);
			expect(zoomForScale(54_000_000, scheme)).toBeLessThan(2);
		});
	});
});
