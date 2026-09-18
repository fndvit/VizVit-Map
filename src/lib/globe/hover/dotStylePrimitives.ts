/**
 * @module globe/hover/dotStylePrimitives
 * The shared, render-state-free primitives behind the hover dot-style adapter
 * ({@link computeDotStyle}, which mirrors the explore renderer on the CPU) — the
 * value→visual math (point→pixel, curve, normalize) plus the non-rendering
 * {@link hiddenDotStyle}.
 *
 * `DotStyle` is defined here as the single source of truth and re-exported from
 * `explore/dotStyle` and `globe/hover/hoverTypes` for back-compat.
 */

/**
 * Shape of the value → visual ramp curve. Declared here (rather than in the
 * app's render types) because {@link applyCurve} is its only consumer inside the
 * globe library; `$lib/explore/render/types` re-exports it, so every existing
 * app import is unchanged and there is still ONE definition.
 */
export type CurveShape = 'linear' | 'sqrt' | 'quadratic' | 'cubic' | 'log';

/** ArcGIS symbol sizes are typographic points; CSS uses pixels. 1pt ≈ 1.333px. */
export const PT_TO_PX = 4 / 3;

/**
 * Hover dot visual style.
 * - `color` — the dot's fill, always a SOLID (fully-opaque) color. The
 *   per-feature transparency lives in `opacity`, kept separate so the hover
 *   overlay can draw its highlight solid (the default) while still knowing the
 *   dot's true alpha — a host can opt to carry it via `highlightOpacity`.
 * - `opacity` — fill alpha in [0,1], default 1. Mirrors the GPU renderer's
 *   opacity visual variable; `color × opacity` reproduces the rendered dot.
 * - `absent` — the cell has no value for the current selection (boolean false /
 *   categorical null / no data). When absence dots are *enabled* such a cell
 *   still draws a grey marker, so `absent` does NOT imply "nothing is drawn".
 * - `hidden` — nothing is drawn for this cell (absence dots disabled). The hover
 *   overlay gates its tooltip / cursor / pulse-ring on this so "no dot" means
 *   "no hover reaction". Only {@link hiddenDotStyle} sets it.
 */
export type DotStyle = {
	color: string;
	size: number;
	outlineColor: string;
	outlineWidth: number;
	absent: boolean;
	opacity?: number;
	hidden?: boolean;
};

/** Applies a curve shape to a normalized `t ∈ [0,1]` (JS mirror of `curveReturn`). */
export function applyCurve(t: number, curve: CurveShape): number {
	switch (curve) {
		case 'linear':
			return t;
		case 'sqrt':
			return Math.sqrt(t);
		case 'cubic':
			return t * t * t;
		case 'log':
			return Math.log(1 + t * 9) / Math.log(10);
		case 'quadratic':
		default:
			return t * t;
	}
}

/**
 * A non-rendering hover style — the overlay draws nothing. `hidden: true` tells
 * the overlay to skip the tooltip / cursor / pulse-ring entirely (no dot → no
 * hover reaction); `size: 0` also fails the overlay's `&& hover.dotSize` render
 * guard. Returned when absence dots are disabled.
 */
export function hiddenDotStyle(): DotStyle {
	return {
		color: 'transparent',
		size: 0,
		outlineColor: 'transparent',
		outlineWidth: 0,
		absent: true,
		hidden: true
	};
}

/**
 * Normalizes a raw field value to `t ∈ [0,1]` over `[min, max]`, or `null` when
 * the value is empty / missing / non-finite. Guards before coercion: `Number('')`
 * and `Number(null)` are both `0` (finite), which would otherwise draw a stray
 * bottom-of-ramp dot on cells the map renders nothing for.
 *
 * @param raw - Raw attribute value.
 * @param min - Domain minimum.
 * @param max - Domain maximum.
 */
export function normalizeT(raw: unknown, min: number, max: number): number | null {
	if (raw === null || raw === undefined || raw === '') return null;
	const value = typeof raw === 'number' ? raw : Number(raw);
	if (!Number.isFinite(value)) return null;
	const range = max - min || 1;
	return Math.max(0, Math.min(1, (value - min) / range));
}
