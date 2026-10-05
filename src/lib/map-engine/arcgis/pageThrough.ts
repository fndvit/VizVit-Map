/**
 * @module map-engine/arcgis/pageThrough
 * Reads every page of an ArcGIS feature query: the one paging loop, so its
 * stop rules are written once.
 *
 * A feature service caps the records it returns per query (`maxRecordCount`)
 * and says so with `exceededTransferLimit`. Following that flag alone is not
 * enough to stop:
 *
 * - a service without pagination (`supportsPagination: false`) ignores the
 *   offset and answers every request with the same first page, flag set —
 *   a loop on the flag never ends;
 * - a page can come back empty with the flag still set.
 *
 * So the loop advances by the number of features actually returned (a service
 * may return fewer than asked), stops on an empty page, reads only one page
 * from a service that cannot page (reporting it as incomplete), and refuses
 * to run past `maxPages`. Order the query by object id where the service
 * allows it, or pages can overlap.
 *
 * Transport-agnostic: the caller fetches each page (a layer's
 * `queryFeatures`, a REST `fetch`), so the same rules cover both.
 */

/** One page of a feature query, as either transport returns it. */
export interface QueryPage<F> {
	/** The page's features. */
	features?: F[];
	/** Whether the service held more back. */
	exceededTransferLimit?: boolean;
}

/** How {@link pageThrough} pages. */
export interface PageThroughOptions {
	/** Records to ask for per page (`num` / `resultRecordCount`). Default `1000`. */
	pageSize?: number;
	/**
	 * Whether the service honours an offset (`advancedQueryCapabilities.supportsPagination`).
	 * `false` reads one page only. Default `true`.
	 */
	supportsPagination?: boolean;
	/** Pages to read at most before giving up with an error. Default `10 000`. */
	maxPages?: number;
}

/** Every feature a query returned, and whether that is all of them. */
export interface PagedResult<F> {
	/** The features of every page, in order. */
	features: F[];
	/** `false` when the service held features back that could not be paged to. */
	complete: boolean;
}

/**
 * Reads every page of a query.
 *
 * @param fetchPage - Fetches one page: `start` is the offset, `num` the page size.
 * @param options - Page size, whether the service can page, the page cap.
 * @returns The features, and whether they are all of them.
 * @throws When the service still reports more after `maxPages` pages, or
 *   whatever `fetchPage` throws.
 */
export async function pageThrough<F>(
	fetchPage: (start: number, num: number) => Promise<QueryPage<F>>,
	options: PageThroughOptions = {}
): Promise<PagedResult<F>> {
	const num = options.pageSize ?? 1000;
	const maxPages = options.maxPages ?? 10_000;
	const features: F[] = [];
	let start = 0;
	for (let page = 0; page < maxPages; page++) {
		const result = await fetchPage(start, num);
		const got = result.features ?? [];
		features.push(...got);
		if (!result.exceededTransferLimit) return { features, complete: true };
		// More promised, nothing delivered: stop rather than ask for the same page again.
		if (got.length === 0) return { features, complete: false };
		if (options.supportsPagination === false) return { features, complete: false };
		start += got.length;
	}
	throw new Error(`Feature query still had more after ${maxPages} pages`);
}
