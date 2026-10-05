import { describe, it, expect } from 'vitest';
import {
	confineFeatureLayer,
	confinementOf,
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
/** [20, 30] × [0, 10]. */
const east = regionShapeOf({
	type: 'Polygon',
	coordinates: [
		[
			[20, 0],
			[30, 0],
			[30, 10],
			[20, 10],
			[20, 0]
		]
	]
});

type Feature = { id: number; geometry: Record<string, unknown> };
type FakeLayer = ConfinableLayer & {
	queries: Record<string, unknown>[];
	clones: number;
	/** Every expression the live layer was given, in order. */
	history: (string | null | undefined)[];
};

/** A layer answering every query with these features, `pageSize` at a time. */
function fakeLayer(
	features: Feature[],
	opts: {
		pageSize?: number;
		where?: string;
		geometryType?: string;
		type?: string;
		cloneable?: boolean;
		paginates?: boolean;
	} = {}
): FakeLayer {
	const pageSize = opts.pageSize ?? 1000;
	let expression: string | null | undefined = opts.where;
	const layer: FakeLayer = {
		objectIdField: 'objectid',
		get definitionExpression() {
			return expression;
		},
		set definitionExpression(value) {
			expression = value;
			layer.history.push(value);
		},
		geometryType: opts.geometryType,
		type: opts.type,
		capabilities: { query: { maxRecordCount: pageSize, supportsPagination: opts.paginates } },
		queries: [],
		clones: 0,
		history: [],
		async queryFeatures(query) {
			layer.queries.push(query);
			await Promise.resolve();
			const start = opts.paginates === false ? 0 : (query.start as number);
			return {
				features: features
					.slice(start, start + pageSize)
					.map((f) => ({ attributes: { objectid: f.id }, geometry: f.geometry })),
				exceededTransferLimit: start + pageSize < features.length
			};
		},
		...(opts.cloneable === false
			? {}
			: {
					clone() {
						layer.clones++;
						const copy = fakeLayer(features, { ...opts, where: undefined });
						copy.queries = layer.queries;
						// Like ArcGIS: a clone knows its fields only once loaded.
						const loaded = { objectIdField: copy.objectIdField };
						Object.assign(copy, { objectIdField: '' });
						copy.load = async () => Object.assign(copy, loaded);
						return copy;
					}
				})
	};
	return layer;
}

const pt = (id: number, x: number, y: number) => ({ id, geometry: { x, y } });

describe('featureIdsInRegion', () => {
	it('queries the region box ordered by id, then keeps the features whose anchor is inside', async () => {
		const layer = fakeLayer([pt(1, 2, 2), pt(2, 8, 8), pt(3, 4, 9)]);
		expect(await featureIdsInRegion(layer, region)).toEqual([1, 3]);
		expect(layer.queries[0]).toMatchObject({
			geometry: { type: 'extent', xmin: 0, ymin: 0, xmax: 10, ymax: 10 },
			outSpatialReference: { wkid: 4326 },
			outFields: ['objectid'],
			orderByFields: ['objectid']
		});
	});

	it('pages past the record limit', async () => {
		const layer = fakeLayer([pt(1, 1, 1), pt(2, 2, 2), pt(3, 3, 3)], { pageSize: 2 });
		expect(await featureIdsInRegion(layer, region)).toEqual([1, 2, 3]);
		expect(layer.queries.map((q) => q.start)).toEqual([0, 2]);
	});

	it('refuses a capped service that cannot page, instead of looping or dropping features', async () => {
		const layer = fakeLayer([pt(1, 1, 1), pt(2, 2, 2), pt(3, 3, 3)], {
			pageSize: 2,
			paginates: false
		});
		await expect(featureIdsInRegion(layer, region)).rejects.toThrow(/cannot page/);
		expect(layer.queries).toHaveLength(1);
	});

	it('generalizes geometry only for a server-backed line or polygon layer', async () => {
		const square = {
			id: 1,
			geometry: {
				rings: [
					[
						[1, 1],
						[3, 1],
						[3, 3],
						[1, 3],
						[1, 1]
					]
				]
			}
		};
		const served = fakeLayer([square], { geometryType: 'polygon', type: 'feature' });
		const local = fakeLayer([square], { geometryType: 'polygon', type: 'geojson' });
		expect(await featureIdsInRegion(served, region)).toEqual([1]);
		expect(await featureIdsInRegion(local, region)).toEqual([1]);
		expect(served.queries[0].maxAllowableOffset).toBeCloseTo(10 / 500);
		expect(local.queries[0]).not.toHaveProperty('maxAllowableOffset');
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

describe('confinementOf / confineFeatureLayer', () => {
	it('pins the ids, keeping the layer`s own where clause, and is one object per layer', async () => {
		const layer = fakeLayer([pt(7, 1, 1)], { where: 'rank = 1' });
		expect(await confineFeatureLayer(layer, region)).toBe(1);
		expect(layer.definitionExpression).toBe('(rank = 1) AND objectid IN (7)');
		expect(confinementOf(layer)).toBe(confinementOf(layer));
		expect(confinementOf(layer).region).toBe(region);
	});

	it('draws nothing from an empty region, and says so', async () => {
		const layer = fakeLayer([pt(1, 50, 50)]);
		expect(await confineFeatureLayer(layer, region)).toBe(0);
		expect(layer.definitionExpression).toBe('1=0');
	});

	it('looks a new region up on a clone, never resetting the live layer', async () => {
		const layer = fakeLayer([pt(1, 1, 1), pt(2, 25, 5)], { where: 'rank = 1' });
		await confineFeatureLayer(layer, region);
		await confineFeatureLayer(layer, east);
		expect(layer.history).toEqual([
			'(rank = 1) AND objectid IN (1)',
			'(rank = 1) AND objectid IN (2)'
		]);
		expect(layer.clones).toBe(1);
	});

	it('loads the clone before querying it — an unloaded clone has no object id field', async () => {
		const layer = fakeLayer([pt(4, 1, 1)]);
		await confineFeatureLayer(layer, region);
		await confineFeatureLayer(layer, region);
		expect(layer.definitionExpression).toBe('objectid IN (4)');
		expect(layer.queries.every((q) => (q.outFields as string[])[0] === 'objectid')).toBe(true);
	});

	it('without a clone, searches with the original expression', async () => {
		const layer = fakeLayer([pt(1, 1, 1), pt(2, 25, 5)], { where: 'rank = 1', cloneable: false });
		await confineFeatureLayer(layer, region);
		expect(await confineFeatureLayer(layer, east)).toBe(1);
		expect(layer.definitionExpression).toBe('(rank = 1) AND objectid IN (2)');
	});

	it('ends on the later of two quick calls; the superseded one applies nothing', async () => {
		const layer = fakeLayer([pt(1, 1, 1), pt(2, 25, 5)]);
		const first = confineFeatureLayer(layer, region);
		const second = confineFeatureLayer(layer, east);
		expect(await first).toBeNull();
		expect(await second).toBe(1);
		expect(layer.definitionExpression).toBe('objectid IN (2)');
		expect(confinementOf(layer).region).toBe(east);
	});

	it('adopts a host`s own edit of the expression as the new original', async () => {
		const layer = fakeLayer([pt(1, 1, 1)], { where: 'rank = 1' });
		await confineFeatureLayer(layer, region);
		layer.definitionExpression = 'rank = 2';
		await confineFeatureLayer(layer, region);
		expect(layer.definitionExpression).toBe('(rank = 2) AND objectid IN (1)');
		expect(await confineFeatureLayer(layer, null)).toBe(Infinity);
		expect(layer.definitionExpression).toBe('rank = 2');
		expect(confinementOf(layer).region).toBeNull();
	});

	it('keeps the previous region when a lookup fails', async () => {
		const layer = fakeLayer([pt(1, 1, 1)], { pageSize: 1, paginates: false });
		await expect(confineFeatureLayer(layer, region)).resolves.toBe(1);
		const failing = fakeLayer([pt(1, 1, 1), pt(2, 2, 2)], { pageSize: 1, paginates: false });
		await expect(confineFeatureLayer(failing, region)).rejects.toThrow(/cannot page/);
		expect(confinementOf(failing).region).toBeNull();
		expect(confinementOf(layer).region).toBe(region);
	});
});
