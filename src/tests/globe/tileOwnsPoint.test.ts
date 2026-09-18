import { describe, it, expect } from 'vitest';
import { tileOwnsPoint } from '$lib/map-engine/tiles/PmtilesLayerAdapter';

/**
 * MVT tiles carry a buffer of neighboring features, so a cell near a tile
 * edge is decoded from two adjacent tiles (four at corners). Every decoded
 * copy used to be added to the client-side FeatureLayer, and the tiered-
 * opacity renderer composited the duplicates: a 0.3-alpha "marginal" dot
 * read as ~0.51 along tile edges and ~0.76 at corners (the "marginally
 * suitable has 2–3 different colors" report). `tileOwnsPoint` assigns each
 * point to exactly one tile so duplicates are dropped at decode time.
 */
describe('tileOwnsPoint — one owner per point across the tile grid', () => {
	// z1 splits the world into 4 tiles at (0°, 0°); handy exact boundaries.
	it('accepts a point inside the tile footprint', () => {
		expect(tileOwnsPoint(1, 0, 0, -90, 45)).toBe(true);
	});

	it('rejects a buffer point that lies in the neighboring tile', () => {
		// Just east of the 0° meridian: belongs to tile x=1, not x=0.
		expect(tileOwnsPoint(1, 0, 0, 0.001, 45)).toBe(false);
		expect(tileOwnsPoint(1, 1, 0, 0.001, 45)).toBe(true);
	});

	it('assigns edge points to exactly one tile (half-open bounds)', () => {
		// A point exactly on the shared meridian/equator must have one owner.
		const owners = [
			[0, 0],
			[1, 0],
			[0, 1],
			[1, 1]
		].filter(([x, y]) => tileOwnsPoint(1, x, y, 0, 0));
		expect(owners).toHaveLength(1);
	});

	it('covers the whole tile row: every point has an owner', () => {
		for (const lng of [-179.9, -90.5, -0.0001, 0, 0.0001, 90.5, 179.9]) {
			const owners = [0, 1, 2, 3].filter((x) => tileOwnsPoint(2, x, 1, lng, 20));
			expect(owners).toHaveLength(1);
		}
	});

	it('matches Web Mercator latitude rows', () => {
		// z1 row boundary is the equator: 45°N belongs to row 0, 45°S to row 1.
		expect(tileOwnsPoint(1, 0, 0, -90, 45)).toBe(true);
		expect(tileOwnsPoint(1, 0, 1, -90, 45)).toBe(false);
		expect(tileOwnsPoint(1, 0, 1, -90, -45)).toBe(true);
		expect(tileOwnsPoint(1, 0, 0, -90, -45)).toBe(false);
	});
});
