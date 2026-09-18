/**
 * @module map-engine/arcgis/colors
 * Color conversion shared by the view factory and the engine.
 */

/**
 * Converts a hex color or `'transparent'` into an ArcGIS rgba array.
 *
 * @param color - `'transparent'` or a `#rrggbb` hex string.
 * @returns `[r, g, b, a]` — alpha 0 for transparent, 1 otherwise.
 */
export function toRgba(color: string): [number, number, number, number] {
	if (color === 'transparent') return [0, 0, 0, 0];
	const h = color.replace('#', '');
	return [
		parseInt(h.substring(0, 2), 16),
		parseInt(h.substring(2, 4), 16),
		parseInt(h.substring(4, 6), 16),
		1
	];
}
