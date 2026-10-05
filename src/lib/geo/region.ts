/**
 * @module geo/region
 * A **region**: an area on the globe a host confines something to — the place
 * names a story discusses, the markers of one country. Built from a GeoJSON
 * polygon file and answering two questions cheaply: its bounding box (to send
 * to a feature service as a spatial filter) and whether a point is inside (the
 * exact test the box overshoots).
 *
 * Provider-neutral and dependency-free: the layer handles of every provider
 * take a {@link RegionShape} (`LayerHandle.setRegion`), and the ArcGIS
 * `confineFeatureLayer` helper uses it to narrow a feature service.
 *
 * **Why not d3's `geoContains`.** d3 reads a polygon by the spherical winding
 * rule (clockwise exterior = inside), and GeoJSON per RFC 7946 winds exteriors
 * counter-clockwise — so d3 takes an RFC-conformant region for its complement:
 * the whole world minus the region. The even-odd ray cast here ignores
 * winding. Treating lon/lat as planar is exact enough for a region up to a few
 * thousand kilometres across.
 *
 * **The antimeridian.** A region whose rings jump more than 180° of longitude
 * between consecutive vertices crosses ±180° (Fiji, the Bering Sea). Such a
 * region is tested in a 0–360° frame, and its {@link RegionShape.bbox} reports
 * `west > east`, the GeoJSON convention for a box that wraps.
 */

/** A GeoJSON position, `[lon, lat]` (any further ordinates are ignored). */
export type Position = readonly number[];

/** One polygon: exterior ring first, then its holes. */
export type PolygonRings = readonly (readonly Position[])[];

/** A region, ready to test points against. */
export interface RegionShape {
	/**
	 * `[west, south, east, north]` in degrees. `west > east` when the region
	 * crosses the antimeridian (see {@link crossesAntimeridian}).
	 */
	readonly bbox: readonly [number, number, number, number];
	/** Whether the region straddles ±180° of longitude. */
	readonly crossesAntimeridian: boolean;
	/** The region's polygons, as read (unshifted). */
	readonly polygons: readonly PolygonRings[];
	/**
	 * Whether a point lies inside the region: inside an exterior ring and
	 * outside that polygon's holes.
	 *
	 * @param lon - Longitude in degrees (any wrap: −180–180 or 0–360).
	 * @param lat - Latitude in degrees.
	 * @returns `true` when the point is inside.
	 */
	contains(lon: number, lat: number): boolean;
}

/**
 * Every polygon in a GeoJSON value, whatever wraps it.
 *
 * @param value - A FeatureCollection, Feature, GeometryCollection, Polygon or
 *   MultiPolygon. Other geometry types contribute nothing.
 * @returns The polygons, in document order.
 */
export function polygonsOf(value: unknown): PolygonRings[] {
	if (!value || typeof value !== 'object') return [];
	const g = value as Record<string, unknown>;
	switch (g.type) {
		case 'FeatureCollection':
			return ((g.features as unknown[]) ?? []).flatMap(polygonsOf);
		case 'Feature':
			return polygonsOf(g.geometry);
		case 'GeometryCollection':
			return ((g.geometries as unknown[]) ?? []).flatMap(polygonsOf);
		case 'Polygon':
			return [g.coordinates as PolygonRings];
		case 'MultiPolygon':
			return g.coordinates as PolygonRings[];
		default:
			return [];
	}
}

/**
 * Even-odd ray cast: whether a point is inside one ring, regardless of winding.
 *
 * @param ring - The ring's vertices.
 * @param x - Longitude.
 * @param y - Latitude.
 * @returns `true` when the point is inside the ring.
 */
function ringContains(ring: readonly Position[], x: number, y: number): boolean {
	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const [xi, yi] = ring[i];
		const [xj, yj] = ring[j];
		if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
	}
	return inside;
}

/**
 * Whether any ring jumps more than 180° of longitude between two consecutive
 * vertices — the mark of a polygon drawn across the antimeridian.
 *
 * @param polygons - The polygons.
 * @returns `true` when the region crosses ±180°.
 */
function jumpsAntimeridian(polygons: readonly PolygonRings[]): boolean {
	return polygons.some((rings) =>
		rings.some((ring) => ring.some((p, i) => i > 0 && Math.abs(p[0] - ring[i - 1][0]) > 180))
	);
}

/**
 * Builds a {@link RegionShape} from a parsed GeoJSON value.
 *
 * @param geojson - The region's GeoJSON.
 * @returns The shape.
 * @throws When the value holds no polygon — a region that contains nothing
 *   would silently confine everything away.
 */
export function regionShapeOf(geojson: unknown): RegionShape {
	const polygons = polygonsOf(geojson).filter((p) => p.length > 0 && p[0].length >= 3);
	if (polygons.length === 0) throw new Error('Region GeoJSON has no polygon');

	const crosses = jumpsAntimeridian(polygons);
	// In a 0–360 frame a crossing region is contiguous.
	const frame = (lon: number) => (crosses && lon < 0 ? lon + 360 : lon);
	const framed = polygons.map((rings) =>
		rings.map((ring) => ring.map(([lon, lat]) => [frame(lon), lat] as const))
	);

	let west = Infinity;
	let south = Infinity;
	let east = -Infinity;
	let north = -Infinity;
	for (const [lon, lat] of framed.flatMap((rings) => rings[0])) {
		if (lon < west) west = lon;
		if (lon > east) east = lon;
		if (lat < south) south = lat;
		if (lat > north) north = lat;
	}
	const wrap = (lon: number) => (lon > 180 ? lon - 360 : lon);

	return {
		bbox: [wrap(west), south, wrap(east), north],
		crossesAntimeridian: crosses,
		polygons,
		contains(lon, lat) {
			const x = frame(lon > 180 ? lon - 360 : lon);
			if (x < west || x > east || lat < south || lat > north) return false;
			return framed.some(
				([outer, ...holes]) =>
					ringContains(outer, x, lat) && !holes.some((hole) => ringContains(hole, x, lat))
			);
		}
	};
}

/**
 * The box(es) to send to a service that cannot take a wrapping box: one for an
 * ordinary region, two (east of the antimeridian, west of it) for a crossing one.
 *
 * @param shape - The region.
 * @returns `[west, south, east, north]` boxes, each with `west <= east`.
 */
export function regionBoxes(shape: RegionShape): [number, number, number, number][] {
	const [west, south, east, north] = shape.bbox;
	if (!shape.crossesAntimeridian) return [[west, south, east, north]];
	return [
		[west, south, 180, north],
		[-180, south, east, north]
	];
}

/** Shapes already loaded, by URL — every caller on a page shares one fetch. */
const shapes = new Map<string, Promise<RegionShape>>();

/**
 * Fetches and parses a region's GeoJSON, once per URL per page.
 *
 * @param src - URL of the GeoJSON.
 * @param fetchImpl - The fetch to use. Default: the global `fetch`.
 * @returns The region's shape.
 * @throws On a failed request or a file with no polygon; a failed load is not
 *   cached, so a later call retries.
 */
export function loadRegionShape(
	src: string,
	fetchImpl: typeof fetch = fetch
): Promise<RegionShape> {
	let shape = shapes.get(src);
	if (!shape) {
		shape = fetchImpl(src)
			.then((response) => {
				if (!response.ok) throw new Error(`Region ${src} failed to load (${response.status})`);
				return response.json();
			})
			.then(regionShapeOf);
		shape.catch(() => shapes.delete(src));
		shapes.set(src, shape);
	}
	return shape;
}
