import { describe, it, expect, vi } from 'vitest';
import {
	confineFeatureLayer,
	featureIdsInRegion,
	type ConfinableLayer
} from '$lib/map-engine/arcgis/confineFeatureLayer';
import { regionShapeOf } from '$lib/geo';

/** A region holding [0, 10] × [0, 10] minus its north-east quarter. */
const region = regionShapeOf({
	type: 'Polygon',
	coordinates: [
		[
			[0, 0],
			[10, 0],
			[10, 5],
			[5, 5],
			[5, 10],
			[0, 10],
			[0, 0]
		]
	]
});

/** A layer whose service answers every query with these features, `pageSize` at a time. */
function fakeLayer(
	features: { id: number; geometry: Record<string, unknown> }[],
	opts: { pageSize?: number; where?: string; geometryType?: string } = {}
) {
	const pageSize = opts.pageSize ?? 1000;
	const queries: Record<string, unknown>[] = [];
	const expressionsAtQuery: (string | null | undefined)[] = [];
	const layer: ConfinableLayer & {
		queries: typeof queries;
		expressionsAtQuery: typeof expressionsAtQuery;
	} = {
		objectIdField: 'objectid',
		definitionExpression: opts.where,
		geometryType: opts.geometryType,
		capabilities: { query: { maxRecordCount: pageSize } },
		queries,
		expressionsAtQuery,
		async queryFeatures(query) {
			queries.push(query);
			expressionsAtQuery.push(layer.definitionExpression);
			const start = query.start as number;
			return {
				features: features
					.slice(start, start + pageSize)
					.map((f) => ({ attributes: { objectid: f.id }, geometry: f.geometry })),
				exceededTransferLimit: start + pageSize < features.length
			};
		}
	};
	return layer;
}

const pt = (id: number, x: number, y: number) => ({ id, geometry: { x, y } });

describe('featureIdsInRegion', () => {
	it('queries the region box, then keeps the features whose anchor is inside', async () => {
		const layer = fakeLayer([pt(1, 2, 2), pt(2, 8, 8), pt(3, 4, 9)]);
		expect(await featureIdsInRegion(layer, region)).toEqual([1, 3]);
		expect(layer.queries[0]).toMatchObject({
			geometry: { type: 'extent', xmin: 0, ymin: 0, xmax: 10, ymax: 10 },
			outSpatialReference: { wkid: 4326 },
			outFields: ['objectid']
		});
		expect(layer.queries[0]).not.toHaveProperty('maxAllowableOffset');
	});

	it('pages past the record limit', async () => {
		const layer = fakeLayer([pt(1, 1, 1), pt(2, 2, 2), pt(3, 3, 3)], { pageSize: 2 });
		expect(await featureIdsInRegion(layer, region)).toEqual([1, 2, 3]);
		expect(layer.queries.map((q) => q.start)).toEqual([0, 2]);
	});

	it('anchors polygons at their centroid, with generalized geometry', async () => {
		const square = (id: number, x: number, y: number) => ({
			id,
			geometry: {
				rings: [
					[
						[x - 1, y - 1],
						[x + 1, y - 1],
						[x + 1, y + 1],
						[x - 1, y + 1],
						[x - 1, y - 1]
					]
				]
			}
		});
		const layer = fakeLayer([square(1, 2, 2), square(2, 8, 8)], { geometryType: 'polygon' });
		expect(await featureIdsInRegion(layer, region)).toEqual([1]);
		expect(layer.queries[0].maxAllowableOffset).toBeCloseTo(10 / 500);
	});

	it('queries both sides of a region across the antimeridian', async () => {
		const fiji = regionShapeOf({
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
		});
		const layer = fakeLayer([pt(1, 178, -15), pt(2, -178, -15)]);
		expect(await featureIdsInRegion(layer, fiji)).toEqual([1, 2]);
		expect(layer.queries.map((q) => (q.geometry as { xmin: number }).xmin)).toEqual([170, -180]);
	});
});

describe('confineFeatureLayer', () => {
	it('pins the ids, keeping the layer`s own where clause', async () => {
		const layer = fakeLayer([pt(7, 1, 1)], { where: 'rank = 1' });
		expect(await confineFeatureLayer(layer, region)).toBe(1);
		expect(layer.definitionExpression).toBe('(rank = 1) AND objectid IN (7)');
	});

	it('draws nothing from an empty region, and says so', async () => {
		const layer = fakeLayer([pt(1, 50, 50)]);
		expect(await confineFeatureLayer(layer, region)).toBe(0);
		expect(layer.definitionExpression).toBe('1=0');
	});

	it('searches with the original expression when confined again, and restores it on null', async () => {
		const layer = fakeLayer([pt(1, 1, 1)], { where: 'rank = 1' });
		const idsIn = vi.fn(async () => [1]);
		await confineFeatureLayer(layer, region, idsIn);
		await confineFeatureLayer(layer, region);
		expect(layer.expressionsAtQuery).toEqual(['rank = 1']);
		expect(await confineFeatureLayer(layer, null)).toBe(Infinity);
		expect(layer.definitionExpression).toBe('rank = 1');
	});
});
