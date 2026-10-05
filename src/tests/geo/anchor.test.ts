import { describe, it, expect } from 'vitest';
import { anchorOf, anchorOfArcgis } from '$lib/geo';

const ring = [
	[0, 0],
	[4, 0],
	[4, 2],
	[0, 2],
	[0, 0]
];

describe('anchorOf (GeoJSON)', () => {
	it('is the point itself, or a multipoint`s first point', () => {
		expect(anchorOf({ type: 'Point', coordinates: [3, 4] })).toEqual([3, 4]);
		expect(
			anchorOf({
				type: 'MultiPoint',
				coordinates: [
					[1, 2],
					[5, 6]
				]
			})
		).toEqual([1, 2]);
	});

	it('is the middle vertex of a line`s longest part', () => {
		expect(
			anchorOf({
				type: 'LineString',
				coordinates: [
					[0, 0],
					[1, 1],
					[2, 2]
				]
			})
		).toEqual([1, 1]);
		expect(
			anchorOf({
				type: 'MultiLineString',
				coordinates: [
					[
						[9, 9],
						[8, 8]
					],
					[
						[0, 0],
						[1, 0],
						[2, 0],
						[3, 0],
						[4, 0]
					]
				]
			})
		).toEqual([2, 0]);
	});

	it('is the area centroid of the largest exterior ring, winding regardless', () => {
		expect(anchorOf({ type: 'Polygon', coordinates: [ring] })).toEqual([2, 1]);
		expect(anchorOf({ type: 'Polygon', coordinates: [[...ring].reverse()] })).toEqual([2, 1]);
		const small = ring.map(([x, y]) => [x / 4 + 50, y / 4]);
		expect(anchorOf({ type: 'MultiPolygon', coordinates: [[small], [ring]] })).toEqual([2, 1]);
	});

	it('falls back to the box centre for a ring with no area, and is null for nothing', () => {
		expect(
			anchorOf({
				type: 'Polygon',
				coordinates: [
					[
						[0, 0],
						[2, 2],
						[0, 0]
					]
				]
			})
		).toEqual([1, 1]);
		expect(anchorOf(null)).toBeNull();
		expect(anchorOf({ type: 'LineString', coordinates: [] })).toBeNull();
	});
});

describe('anchorOf across the antimeridian', () => {
	it('puts the centroid of a polygon crossing ±180° on the polygon, not near 0°', () => {
		const fiji = [
			[176, -20],
			[-178, -20],
			[-178, -16],
			[176, -16],
			[176, -20]
		];
		expect(anchorOf({ type: 'Polygon', coordinates: [fiji] })).toEqual([179, -18]);
		expect(anchorOfArcgis({ rings: [fiji] })).toEqual([179, -18]);
	});
});

describe('anchorOfArcgis (ArcGIS JSON)', () => {
	it('applies the same rule to points, paths and rings', () => {
		expect(anchorOfArcgis({ x: 3, y: 4 })).toEqual([3, 4]);
		expect(
			anchorOfArcgis({
				paths: [
					[
						[0, 0],
						[1, 1],
						[2, 2]
					]
				]
			})
		).toEqual([1, 1]);
		expect(anchorOfArcgis({ rings: [ring] })).toEqual([2, 1]);
		expect(anchorOfArcgis(null)).toBeNull();
	});
});
