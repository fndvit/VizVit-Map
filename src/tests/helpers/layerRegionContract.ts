/**
 * The `LayerHandle.setRegion` contract, as one suite every provider adapter
 * runs (ArcGIS, MapLibre, the fake). The rule is the package's — a feature is
 * drawn when its anchor (`anchorOf`) is inside the region — so the same data
 * and the same region must leave the same features drawn whichever adapter
 * draws them. Each adapter supplies a harness that builds a layer on its own
 * test doubles and reads back what that layer would draw.
 */

import { describe, it, expect } from 'vitest';
import { regionShapeOf } from '$lib/geo';
import type { GeoJsonLayerHandle, PointItem, PointLayerHandle } from '$lib/map-engine/provider.js';

/** A GeoJSON feature the contract feeds a layer; `properties.id` names it. */
export interface ContractFeature {
	type: 'Feature';
	properties: { id: string };
	geometry: { type: string; coordinates: unknown };
}

/** What one adapter provides the contract. */
export interface RegionHarness {
	/** A points layer with these items, and the ids it draws now. */
	points(items: PointItem[]): { handle: PointLayerHandle; drawn(): string[] };
	/** A GeoJSON layer over this inline collection, and the feature ids it draws now. */
	geojson(features: ContractFeature[]): { handle: GeoJsonLayerHandle; drawn(): string[] };
}

const SYMBOL = { shape: 'circle' as const, size: 6, color: '#000' };

/** A box region, counter-clockwise. */
const box = (w: number, s: number, e: number, n: number) =>
	regionShapeOf({
		type: 'Polygon',
		coordinates: [
			[
				[w, s],
				[e, s],
				[e, n],
				[w, n],
				[w, s]
			]
		]
	});

const WEST = box(0, 0, 10, 10);
const EAST = box(20, 0, 30, 10);

const point = (id: string, lng: number, lat: number): PointItem => ({
	id,
	lng,
	lat,
	symbol: SYMBOL
});

/** One of each geometry, in the west box, the east box, or straddling the west edge. */
const FEATURES: ContractFeature[] = [
	{
		type: 'Feature',
		properties: { id: 'pt-west' },
		geometry: { type: 'Point', coordinates: [5, 5] }
	},
	{
		type: 'Feature',
		properties: { id: 'pt-east' },
		geometry: { type: 'Point', coordinates: [25, 5] }
	},
	{
		type: 'Feature',
		properties: { id: 'line-west' },
		// Its middle vertex is inside; its ends are not.
		geometry: {
			type: 'LineString',
			coordinates: [
				[-5, 5],
				[5, 5],
				[15, 5]
			]
		}
	},
	{
		type: 'Feature',
		properties: { id: 'poly-straddle' },
		// Centroid (1, 5) is inside the west box; most of its area is not.
		geometry: {
			type: 'Polygon',
			coordinates: [
				[
					[-8, 3],
					[10, 3],
					[10, 7],
					[-8, 7],
					[-8, 3]
				]
			]
		}
	},
	{
		type: 'Feature',
		properties: { id: 'poly-east' },
		geometry: {
			type: 'Polygon',
			coordinates: [
				[
					[22, 2],
					[28, 2],
					[28, 8],
					[22, 8],
					[22, 2]
				]
			]
		}
	}
];

/**
 * Registers the contract suite for one adapter.
 *
 * @param name - The adapter, for the suite title.
 * @param harness - Builds layers on the adapter's own doubles (called per test).
 */
export function describeLayerRegionContract(name: string, harness: () => RegionHarness): void {
	describe(`${name} — LayerHandle.setRegion contract`, () => {
		it('draws only the points inside, keeps the region across set, and releases it', async () => {
			const { handle, drawn } = harness().points([point('w', 5, 5), point('e', 25, 5)]);
			await handle.setRegion(WEST);
			expect(drawn()).toEqual(['w']);
			expect(handle.getRegion()).toBe(WEST);

			handle.set([point('w2', 1, 1), point('e2', 21, 1)]);
			expect(drawn()).toEqual(['w2']);

			await handle.setRegion(null);
			expect(drawn().sort()).toEqual(['e2', 'w2']);
			expect(handle.getRegion()).toBeNull();
		});

		it('keeps the features whose anchor is inside: point, middle vertex, centroid', async () => {
			const { handle, drawn } = harness().geojson(FEATURES);
			await handle.setRegion(WEST);
			expect(drawn().sort()).toEqual(['line-west', 'poly-straddle', 'pt-west']);
			await handle.setRegion(EAST);
			expect(drawn().sort()).toEqual(['poly-east', 'pt-east']);
			await handle.setRegion(null);
			expect(drawn()).toHaveLength(FEATURES.length);
		});

		it('ends on the later of two quick calls, and reports only the applied region', async () => {
			const { handle, drawn } = harness().geojson(FEATURES);
			const first = handle.setRegion(WEST);
			const second = handle.setRegion(EAST);
			await Promise.all([first, second]);
			expect(drawn().sort()).toEqual(['poly-east', 'pt-east']);
			expect(handle.getRegion()).toBe(EAST);
		});
	});
}
