/**
 * @module geo
 * Provider-neutral geometry: regions (`regionShapeOf`, `loadRegionShape`) and
 * the feature-anchor rule (`anchorOf`) every provider's
 * `LayerHandle.setRegion` filters by. A leaf: it imports nothing from the
 * engine, the globe layer or any SDK.
 *
 * ```ts
 * import { loadRegionShape } from '@vit-foundation/map/geo';
 *
 * const deccan = await loadRegionShape('/regions/deccan.geojson');
 * deccan.contains(77.59, 12.97); // true — Bengaluru
 * ```
 */

export {
	loadRegionShape,
	polygonsOf,
	regionBoxes,
	regionCenter,
	regionShapeOf,
	type PolygonRings,
	type Position,
	type RegionShape
} from './region.js';
export { anchorOf, anchorOfArcgis, type GeometryLike } from './anchor.js';
