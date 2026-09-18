/**
 * @module map-engine/geocode
 * Place search against the ArcGIS World Geocoding Service.
 *
 * Speaks the geocoder's REST API directly with `fetch` rather than through the
 * ArcGIS SDK's locator wrapper: place search is not a view operation, and the
 * engine's neutral core must not pull a map SDK in for it. The service is public
 * and needs no key for these two calls.
 *
 * Owns the geocoder endpoint and both halves of the search flow:
 * {@link suggestPlaces} powers autocomplete (each suggestion carries a
 * `magicKey`), and {@link locatePlace} resolves a query — deterministically
 * when given that key — to a lon/lat the camera module can fly to.
 * View-independent by design: components can fetch suggestions without a map.
 */

/** REST endpoint of Esri's World Geocoding Service. */
const WORLD_GEOCODER_URL = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer';

/**
 * Geocoder categories the suggest call is restricted to. Keeps suggestions at
 * the geographic level a globe can meaningfully fly to — countries, regions,
 * cities ("Populated Place") and named natural features like continents,
 * mountain ranges or seas ("Land Features" / "Water Features") — and excludes
 * the POI category, whose businesses and venues ("Hanoi Propaganda Posters")
 * are far too specific for a travel-to search.
 */
const SUGGEST_CATEGORIES = ['Populated Place', 'Land Features', 'Water Features'];

/** One autocomplete entry returned by {@link suggestPlaces}. */
export interface PlaceSuggestion {
	/** Display label, e.g. `"Girona, Cataluña, ESP"`. */
	text: string;
	/**
	 * Opaque geocoder result id. Passing it back via {@link locatePlace} makes
	 * the geocode resolve to exactly this suggestion instead of a fuzzy match.
	 */
	magicKey: string;
}

/** Bounding box of a geocoded place in WGS84 degrees. */
export interface PlaceExtent {
	/** Western edge, degrees longitude. */
	xmin: number;
	/** Southern edge, degrees latitude. */
	ymin: number;
	/** Eastern edge, degrees longitude. */
	xmax: number;
	/** Northern edge, degrees latitude. */
	ymax: number;
}

/** A geocoded point in WGS84 degrees. */
export interface PlaceLocation {
	/** Longitude in degrees. */
	longitude: number;
	/** Latitude in degrees. */
	latitude: number;
	/**
	 * Bounding box of the matched place, when the geocoder provides one. Its
	 * size reflects how specific the place is (country vs. city), which the
	 * camera uses to pick an appropriate landing zoom.
	 */
	extent?: PlaceExtent;
}

/**
 * Fetches character-by-character autocomplete suggestions for a place query.
 *
 * Suggestions are restricted to {@link SUGGEST_CATEGORIES} (places, not POIs),
 * and collection results (category groupings like "Restaurants") are filtered
 * out — they have no single location to fly to. Failures resolve to an empty
 * list so the UI degrades to a plain free-text search.
 *
 * @param text - Partial place / address text the user has typed.
 * @param maxSuggestions - Cap on returned suggestions (default 5).
 * @returns Matching suggestions, best first; `[]` on error.
 */
/**
 * Requests JSON from the geocoder and parses it.
 *
 * @param path - Operation path (e.g. `'suggest'`).
 * @param params - Query parameters; `f=json` is added for you.
 * @returns The parsed body, or `null` when the request or the parse failed.
 */
async function geocoderRequest(
	path: string,
	params: Record<string, string | number | undefined>
): Promise<Record<string, unknown> | null> {
	const query = new URLSearchParams({ f: 'json' });
	for (const [key, value] of Object.entries(params)) {
		if (value != null) query.set(key, String(value));
	}
	const response = await fetch(`${WORLD_GEOCODER_URL}/${path}?${query}`);
	if (!response.ok) return null;
	return (await response.json()) as Record<string, unknown>;
}

/**
 * Fetches character-by-character autocomplete suggestions for a place query.
 *
 * Suggestions are restricted to {@link SUGGEST_CATEGORIES} (places, not POIs),
 * and collection results (category groupings like "Restaurants") are filtered
 * out — they have no single location to fly to. Failures resolve to an empty
 * list so the UI degrades to a plain free-text search.
 *
 * @param text - Partial place / address text the user has typed.
 * @param maxSuggestions - Cap on returned suggestions (default 5).
 * @returns Matching suggestions, best first; `[]` on error.
 */
export async function suggestPlaces(text: string, maxSuggestions = 5): Promise<PlaceSuggestion[]> {
	try {
		const body = await geocoderRequest('suggest', {
			text,
			category: SUGGEST_CATEGORIES.join(','),
			maxSuggestions
		});
		const suggestions = (body?.suggestions ?? []) as {
			text?: string;
			magicKey?: string;
			isCollection?: boolean;
		}[];
		return suggestions
			.filter((r) => !r.isCollection && r.text && r.magicKey)
			.slice(0, maxSuggestions)
			.map((r) => ({ text: r.text as string, magicKey: r.magicKey as string }));
	} catch {
		/* suggestion failures are non-fatal — the input still works as free text */
		return [];
	}
}

/**
 * Geocodes a place query to a single location.
 *
 * With a `magicKey` (from {@link suggestPlaces}) the geocoder returns exactly
 * that suggestion's location; without one it falls back to the best fuzzy
 * match, which is how free-text submits resolve.
 *
 * @param query - Place / address text.
 * @param magicKey - Suggestion id that pins the result to a specific place.
 * @returns The matched location (with its extent when the geocoder provides
 *   one), or `null` if nothing matched or the request failed.
 */
export async function locatePlace(query: string, magicKey?: string): Promise<PlaceLocation | null> {
	try {
		const body = await geocoderRequest('findAddressCandidates', {
			SingleLine: query,
			magicKey,
			maxLocations: 1,
			// Pin the output to WGS84 so `location` is plain lon/lat degrees.
			outSR: 4326
		});
		const candidate = ((body?.candidates ?? []) as Candidate[])[0];
		const loc = candidate?.location;
		if (loc && loc.x != null && loc.y != null) {
			const ext = candidate.extent;
			const extent =
				ext && ext.xmin != null && ext.ymin != null && ext.xmax != null && ext.ymax != null
					? { xmin: ext.xmin, ymin: ext.ymin, xmax: ext.xmax, ymax: ext.ymax }
					: undefined;
			return { longitude: loc.x, latitude: loc.y, extent };
		}
		return null;
	} catch {
		/* geocode failures are non-fatal — the user can retry */
		return null;
	}
}

/** One `findAddressCandidates` result, as the REST service shapes it. */
interface Candidate {
	/** Matched point in the requested spatial reference (`x` = longitude). */
	location?: { x?: number; y?: number };
	/** Bounding box of the matched place, when the service provides one. */
	extent?: { xmin?: number; ymin?: number; xmax?: number; ymax?: number };
}
