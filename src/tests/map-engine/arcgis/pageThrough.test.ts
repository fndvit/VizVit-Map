import { describe, it, expect, vi } from 'vitest';
import { pageThrough } from '$lib/map-engine/arcgis/pageThrough';

/** A service holding `total` records, answering `cap` at most per page. */
function service(total: number, cap: number, paginates = true) {
	return vi.fn(async (start: number, num: number) => {
		const from = paginates ? start : 0;
		const count = Math.min(num, cap, total - from);
		return {
			features: Array.from({ length: Math.max(0, count) }, (_, i) => from + i),
			exceededTransferLimit: from + count < total
		};
	});
}

describe('pageThrough', () => {
	it('reads every page, advancing by what was returned when the service caps below the page size', async () => {
		const fetchPage = service(5, 2);
		const result = await pageThrough(fetchPage, { pageSize: 10 });
		expect(result).toEqual({ features: [0, 1, 2, 3, 4], complete: true });
		expect(fetchPage.mock.calls.map(([start]) => start)).toEqual([0, 2, 4]);
	});

	it('reads one page from a service that cannot page, and says it is incomplete', async () => {
		const fetchPage = service(5, 2, false);
		const result = await pageThrough(fetchPage, { pageSize: 2, supportsPagination: false });
		expect(result).toEqual({ features: [0, 1], complete: false });
		expect(fetchPage).toHaveBeenCalledOnce();
	});

	it('stops on an empty page that still promises more', async () => {
		const fetchPage = vi.fn(async () => ({ features: [], exceededTransferLimit: true }));
		expect(await pageThrough(fetchPage)).toEqual({ features: [], complete: false });
		expect(fetchPage).toHaveBeenCalledOnce();
	});

	it('gives up past maxPages instead of looping forever', async () => {
		const fetchPage = vi.fn(async () => ({ features: [1], exceededTransferLimit: true }));
		await expect(pageThrough(fetchPage, { maxPages: 3 })).rejects.toThrow(/3 pages/);
		expect(fetchPage).toHaveBeenCalledTimes(3);
	});
});
