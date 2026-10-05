/**
 * @module geo/anchor
 * The **anchor** of a feature: the one point that decides whether the feature
 * is inside a region. Every provider's `LayerHandle.setRegion` and the ArcGIS
 * `confineFeatureLayer` use this rule, so a region keeps the same features
 * whichever renderer draws them.
 *
 * - a point is its own anchor (a multipoint: its first point);
 * - a line's anchor is the middle vertex of its longest part;
 * - a polygon's anchor is the area centroid of its largest exterior ring,
 *   falling back to the ring's box centre when the ring has no area.
 *
 * A concave polygon's centroid can fall outside it; for a region filter that
 * is the right trade — the rule is cheap, deterministic and the same on every
 * provider. A feature that straddles the region's edge is in or out by where
 * its anchor falls, never half-drawn.
 */

import type { Position } from './region.js';

/** A GeoJSON geometry, as far as {@link anchorOf} reads it. */
export interface GeometryLike {
	type: string;
	coordinates?: unknown;
	geometries?: readonly GeometryLike[];
}

/**
 * The area centroid of a ring (shoelace), or its box centre when degenerate.
 *
 * @param ring - The ring's vertices.
 * @returns The anchor and the ring's absolute area.
 */
function ringCentroid(ring: readonly Position[]): { point: [number, number]; area: number } {
	let a = 0;
	let cx = 0;
	let cy = 0;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const [x0, y0] = ring[j];
		const [x1, y1] = ring[i];
		const cross = x0 * y1 - x1 * y0;
		a += cross;
		cx += (x0 + x1) * cross;
		cy += (y0 + y1) * cross;
	}
	if (Math.abs(a) < 1e-12) {
		const xs = ring.map((p) => p[0]);
		const ys = ring.map((p) => p[1]);
		return {
			point: [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2],
			area: 0
		};
	}
	return { point: [cx / (3 * a), cy / (3 * a)], area: Math.abs(a / 2) };
}

/**
 * The middle vertex of the longest of a line's parts (by vertex count).
 *
 * @param parts - The line's parts.
 * @returns The anchor, or `null` for an empty line.
 */
function lineAnchor(parts: readonly (readonly Position[])[]): [number, number] | null {
	const longest = parts.reduce<readonly Position[]>(
		(best, part) => (part.length > best.length ? part : best),
		[]
	);
	if (longest.length === 0) return null;
	const mid = longest[Math.floor(longest.length / 2)];
	return [mid[0], mid[1]];
}

/**
 * The anchor of the largest of a polygon set's exterior rings.
 *
 * @param exteriors - Each polygon's exterior ring.
 * @returns The anchor, or `null` when there is no ring.
 */
function polygonAnchor(exteriors: readonly (readonly Position[])[]): [number, number] | null {
	let best: { point: [number, number]; area: number } | null = null;
	for (const ring of exteriors) {
		if (ring.length === 0) continue;
		const c = ringCentroid(ring);
		if (!best || c.area > best.area) best = c;
	}
	return best?.point ?? null;
}

/**
 * The anchor of a GeoJSON geometry (see the module rules).
 *
 * @param geometry - A GeoJSON geometry, or `null`.
 * @returns `[lon, lat]`, or `null` for an empty or unknown geometry.
 */
export function anchorOf(geometry: GeometryLike | null | undefined): [number, number] | null {
	if (!geometry) return null;
	const c = geometry.coordinates as never;
	switch (geometry.type) {
		case 'Point':
			return [(c as Position)[0], (c as Position)[1]];
		case 'MultiPoint': {
			const first = (c as Position[])[0];
			return first ? [first[0], first[1]] : null;
		}
		case 'LineString':
			return lineAnchor([c as Position[]]);
		case 'MultiLineString':
			return lineAnchor(c as Position[][]);
		case 'Polygon':
			return polygonAnchor([(c as Position[][])[0] ?? []]);
		case 'MultiPolygon':
			return polygonAnchor((c as Position[][][]).map((p) => p[0] ?? []));
		case 'GeometryCollection':
			for (const g of geometry.geometries ?? []) {
				const a = anchorOf(g);
				if (a) return a;
			}
			return null;
		default:
			return null;
	}
}

/**
 * {@link anchorOf} for an ArcGIS JSON geometry (`{ x, y }`, `{ paths }`,
 * `{ rings }`, `{ points }`), as a feature service or an ArcGIS layer query
 * returns it — so the ArcGIS adapter applies the same rule without converting.
 *
 * Rings are not split into exteriors and holes (ArcGIS orders them by winding,
 * clockwise exteriors); every ring competes and the largest wins, which is the
 * exterior for any real polygon.
 *
 * @param geometry - An ArcGIS JSON geometry, or `null`.
 * @returns `[x, y]` in the geometry's spatial reference, or `null`.
 */
export function anchorOfArcgis(
	geometry:
		| {
				x?: number;
				y?: number;
				points?: Position[];
				paths?: Position[][];
				rings?: Position[][];
		  }
		| null
		| undefined
): [number, number] | null {
	if (!geometry) return null;
	if (typeof geometry.x === 'number' && typeof geometry.y === 'number') {
		return [geometry.x, geometry.y];
	}
	if (geometry.points?.length) return [geometry.points[0][0], geometry.points[0][1]];
	if (geometry.paths) return lineAnchor(geometry.paths);
	if (geometry.rings) return polygonAnchor(geometry.rings);
	return null;
}
