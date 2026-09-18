import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { suggestPlaces, locatePlace } from '$lib/map-engine/geocode';

/**
 * The geocoder speaks the public REST API over `fetch`, so the test replaces
 * `fetch` — no SDK, no network. Each helper returns a body and records the URL
 * the module asked for, which is where the query contract is asserted.
 */
function mockGeocoder(body: unknown, ok = true) {
	const fetchMock = vi.fn(async (_url: string) => ({
		ok,
		json: async () => body
	}));
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

/** The URL of the single request the module made. */
function urlOf(fetchMock: ReturnType<typeof mockGeocoder>): string {
	return fetchMock.mock.calls[0][0];
}

/** The query parameters of the single request the module made. */
function queryOf(fetchMock: ReturnType<typeof mockGeocoder>): URLSearchParams {
	return new URL(urlOf(fetchMock)).searchParams;
}

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('suggestPlaces', () => {
	it('maps geocoder results to text + magicKey suggestions', async () => {
		const fetchMock = mockGeocoder({
			suggestions: [
				{ text: 'Girona, Cataluña, ESP', magicKey: 'key-girona', isCollection: false },
				{ text: 'Gironella, Cataluña, ESP', magicKey: 'key-gironella', isCollection: false }
			]
		});

		const result = await suggestPlaces('Giro');

		expect(urlOf(fetchMock)).toContain('geocode.arcgis.com');
		expect(queryOf(fetchMock).get('text')).toBe('Giro');
		expect(result).toEqual([
			{ text: 'Girona, Cataluña, ESP', magicKey: 'key-girona' },
			{ text: 'Gironella, Cataluña, ESP', magicKey: 'key-gironella' }
		]);
	});

	it('restricts suggestions to place categories (no POIs)', async () => {
		const fetchMock = mockGeocoder({ suggestions: [] });
		await suggestPlaces('Hanoi');
		expect(queryOf(fetchMock).get('category')).toBe('Populated Place,Land Features,Water Features');
	});

	it('filters out collection results (no single location to fly to)', async () => {
		mockGeocoder({
			suggestions: [
				{ text: 'Restaurants', magicKey: 'key-collection', isCollection: true },
				{ text: 'Girona', magicKey: 'key-girona', isCollection: false }
			]
		});
		await expect(suggestPlaces('x')).resolves.toEqual([{ text: 'Girona', magicKey: 'key-girona' }]);
	});

	it('caps results at maxSuggestions', async () => {
		mockGeocoder({
			suggestions: Array.from({ length: 8 }, (_, i) => ({
				text: `Place ${i}`,
				magicKey: `key-${i}`,
				isCollection: false
			}))
		});
		await expect(suggestPlaces('p', 3)).resolves.toHaveLength(3);
	});

	it('resolves to an empty list when the request fails', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('offline');
			})
		);
		await expect(suggestPlaces('x')).resolves.toEqual([]);
	});

	it('resolves to an empty list on a non-OK response', async () => {
		mockGeocoder({}, false);
		await expect(suggestPlaces('x')).resolves.toEqual([]);
	});
});

describe('locatePlace', () => {
	it('returns the first candidate location as lon/lat', async () => {
		mockGeocoder({ candidates: [{ location: { x: 2.82, y: 41.98 } }] });
		await expect(locatePlace('Girona')).resolves.toEqual({
			longitude: 2.82,
			latitude: 41.98,
			extent: undefined
		});
	});

	it('asks for WGS84 so the candidate location is plain degrees', async () => {
		const fetchMock = mockGeocoder({ candidates: [] });
		await locatePlace('Girona');
		expect(queryOf(fetchMock).get('outSR')).toBe('4326');
		expect(queryOf(fetchMock).get('SingleLine')).toBe('Girona');
	});

	it('includes the candidate extent so the camera can derive a landing zoom', async () => {
		mockGeocoder({
			candidates: [
				{
					location: { x: 2.82, y: 41.98 },
					extent: { xmin: 2.7, ymin: 41.9, xmax: 2.9, ymax: 42.1 }
				}
			]
		});
		await expect(locatePlace('Girona')).resolves.toMatchObject({
			extent: { xmin: 2.7, ymin: 41.9, xmax: 2.9, ymax: 42.1 }
		});
	});

	it('omits the extent when the candidate has an incomplete one', async () => {
		mockGeocoder({
			candidates: [{ location: { x: 1, y: 2 }, extent: { xmin: 0, ymin: 0 } }]
		});
		await expect(locatePlace('x')).resolves.toEqual({
			longitude: 1,
			latitude: 2,
			extent: undefined
		});
	});

	it('forwards the magicKey so the geocode pins to an exact suggestion', async () => {
		const fetchMock = mockGeocoder({ candidates: [{ location: { x: 1, y: 2 } }] });
		await locatePlace('Girona', 'key-girona');
		expect(queryOf(fetchMock).get('magicKey')).toBe('key-girona');
	});

	it('omits the magicKey entirely on a free-text search', async () => {
		const fetchMock = mockGeocoder({ candidates: [] });
		await locatePlace('Girona');
		expect(queryOf(fetchMock).has('magicKey')).toBe(false);
	});

	it('returns null when no candidate matches', async () => {
		mockGeocoder({ candidates: [] });
		await expect(locatePlace('nowhere')).resolves.toBeNull();
	});

	it('returns null when the request fails', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('offline');
			})
		);
		await expect(locatePlace('x')).resolves.toBeNull();
	});
});
