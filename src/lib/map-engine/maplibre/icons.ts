/**
 * @module map-engine/maplibre/icons
 * Marker images for the MapLibre adapter.
 *
 * MapLibre draws point symbols from registered images, so each distinct
 * {@link PointSymbol} becomes one canvas-drawn icon registered under a
 * deterministic id. Colours and outlines are baked into the image, which keeps
 * them exact (no SDF tinting approximation) and lets one symbol layer render a
 * mixed set of markers through `icon-image: ['get', 'iconId']`.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- the MapLibre map is loaded dynamically */

import type { PointSymbol } from '../provider.js';

/** Icons are drawn at twice the requested size so they stay crisp on retina. */
const PIXEL_RATIO = 2;

/**
 * Normalises a colour to a CSS string.
 *
 * @param color - A CSS colour or an `[r, g, b, a]` tuple (alpha 0–1).
 * @returns A CSS colour string.
 */
function toCss(color: string | [number, number, number, number]): string {
	if (typeof color === 'string') return color;
	const [r, g, b, a] = color;
	return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/**
 * A stable id for a symbol, so the same symbol is only ever drawn once.
 *
 * @param symbol - The neutral point symbol.
 * @returns The image id.
 */
export function iconIdFor(symbol: PointSymbol): string {
	const outline = symbol.outline
		? `${toCss(symbol.outline.color)}@${symbol.outline.width}`
		: 'none';
	return `pt:${symbol.shape}:${symbol.size}:${toCss(symbol.color)}:${outline}`;
}

/**
 * Traces the symbol's outline path on a 2D context, centred on `c` with radius `r`.
 *
 * @param ctx - The canvas context to draw into.
 * @param shape - The symbol shape.
 * @param c - Centre coordinate (x and y are equal on a square canvas).
 * @param r - Radius in device pixels.
 */
function tracePath(
	ctx: CanvasRenderingContext2D,
	shape: PointSymbol['shape'],
	c: number,
	r: number
) {
	ctx.beginPath();
	if (shape === 'circle') {
		ctx.arc(c, c, r, 0, Math.PI * 2);
	} else if (shape === 'diamond') {
		ctx.moveTo(c, c - r);
		ctx.lineTo(c + r, c);
		ctx.lineTo(c, c + r);
		ctx.lineTo(c - r, c);
	} else {
		const s = r * Math.SQRT1_2 * 2;
		ctx.rect(c - s / 2, c - s / 2, s, s);
	}
	ctx.closePath();
}

/**
 * Registers the image for a symbol on the map, if it is not registered already.
 *
 * @param map - The live MapLibre map.
 * @param symbol - The neutral point symbol.
 * @returns The image id to reference from `icon-image`.
 */
export function ensureIcon(map: any, symbol: PointSymbol): string {
	const id = iconIdFor(symbol);
	if (map.hasImage?.(id)) return id;

	const outlineWidth = symbol.outline?.width ?? 0;
	// Leave room for the stroke, which straddles the path.
	const side = Math.ceil((symbol.size + outlineWidth * 2) * PIXEL_RATIO);
	const canvas = document.createElement('canvas');
	canvas.width = side;
	canvas.height = side;
	const ctx = canvas.getContext('2d');
	if (!ctx) return id;

	const centre = side / 2;
	const radius = (symbol.size / 2) * PIXEL_RATIO;
	tracePath(ctx, symbol.shape, centre, radius);
	ctx.fillStyle = toCss(symbol.color);
	ctx.fill();
	if (symbol.outline) {
		ctx.lineWidth = symbol.outline.width * PIXEL_RATIO;
		ctx.strokeStyle = toCss(symbol.outline.color);
		ctx.stroke();
	}

	map.addImage(id, ctx.getImageData(0, 0, side, side), { pixelRatio: PIXEL_RATIO });
	return id;
}
