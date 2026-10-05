import { describe, it, expect, vi } from 'vitest';
import { loadRegionShape, regionBoxes, regionShapeOf } from '$lib/geo';

/** A 10° square around the origin, counter-clockwise (RFC 7946), with a 2° hole. */
const square = {
	type: 'Polygon',
	coordinates: [
		[
			[-5, -5],
			[5, -5],
			[5, 5],
			[-5, 5],
			[-5, -5]
		],
		[
			[-1, -1],
			[-1, 1],
			[1, 1],
			[1, -1],
			[-1, -1]
		]
	]
};

/** A box from 170°E to 170°W across the antimeridian, as GeoJSON writes it. */
const fiji = {
	type: 'Polygon',
	coordinates: [
		[
			[170, -20],
			[-170, -20],
			[-170, -10],
			[170, -10],
			[170, -20]
		]
	]
};

describe('regionShapeOf', () => {
	it('tests points against the polygon, holes excluded', () => {
		const shape = regionShapeOf(square);
		expect(shape.bbox).toEqual([-5, -5, 5, 5]);
		expect(shape.crossesAntimeridian).toBe(false);
		expect(shape.contains(3, 3)).toBe(true);
		expect(shape.contains(0, 0)).toBe(false);
		expect(shape.contains(6, 0)).toBe(false);
	});

	it('ignores winding — the spherical rule would read an RFC 7946 ring as its complement', () => {
		const clockwise = { type: 'Polygon', coordinates: [[...square.coordinates[0]].reverse()] };
		expect(regionShapeOf(clockwise).contains(3, 3)).toBe(true);
		expect(regionShapeOf(clockwise).contains(100, 40)).toBe(false);
	});

	it('reads Features, FeatureCollections and MultiPolygons', () => {
		const far = square.coordinates[0].map(([x, y]) => [x + 50, y]);
		const shape = regionShapeOf({
			type: 'FeatureCollection',
			features: [
				{ type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: [[far]] } },
				{ type: 'Feature', geometry: square }
			]
		});
		expect(shape.contains(50, 0)).toBe(true);
		expect(shape.contains(3, 3)).toBe(true);
		expect(shape.contains(25, 0)).toBe(false);
	});

	it('handles a region across the antimeridian', () => {
		const shape = regionShapeOf(fiji);
		expect(shape.crossesAntimeridian).toBe(true);
		expect(shape.bbox).toEqual([170, -20, -170, -10]);
		expect(shape.contains(178, -15)).toBe(true);
		expect(shape.contains(-178, -15)).toBe(true);
		expect(shape.contains(182, -15)).toBe(true); // 0–360 input
		expect(shape.contains(0, -15)).toBe(false);
		expect(shape.contains(160, -15)).toBe(false);
	});

	it('refuses a file with no polygon', () => {
		expect(() => regionShapeOf({ type: 'Point', coordinates: [0, 0] })).toThrow(/no polygon/);
	});
});

describe('regionBoxes', () => {
	it('is the bbox for an ordinary region, and two boxes across the antimeridian', () => {
		expect(regionBoxes(regionShapeOf(square))).toEqual([[-5, -5, 5, 5]]);
		expect(regionBoxes(regionShapeOf(fiji))).toEqual([
			[170, -20, 180, -10],
			[-180, -20, -170, -10]
		]);
	});
});

describe('loadRegionShape', () => {
	it('fetches a URL once, and retries one that failed', async () => {
		const ok = { ok: true, status: 200, json: async () => square } as Response;
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce({ ok: false, status: 404 } as Response)
			.mockResolvedValue(ok);
		await expect(loadRegionShape('/once.json', fetchImpl)).rejects.toThrow(/404/);
		await new Promise((r) => setTimeout(r, 0));
		const a = await loadRegionShape('/once.json', fetchImpl);
		expect(await loadRegionShape('/once.json', fetchImpl)).toBe(a);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});
});
