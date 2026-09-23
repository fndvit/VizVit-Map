/**
 * The overlay's stacking contract, pinned as text.
 *
 * The hover overlay's elements are placed and stacked by `hoverOverlay.css`
 * and the globe stage's `--vit-map-z-*` ladder — not by utility classes, which
 * a consumer's toolchain would have to generate (see `libraryBoundary.test.ts`).
 * These checks read the two files rather than mounting the overlay: the order
 * they protect is decided entirely by these declarations.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync('src/lib/globe/hover/hoverOverlay.css', 'utf8');
const globe = readFileSync('src/lib/globe/Globe.svelte', 'utf8');

/** The `z-index` declaration of the first block whose selector list names `selector`. */
function zIndexOf(selector: string): string | null {
	for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
		if (
			!selectors
				.split(',')
				.map((s) => s.trim())
				.includes(selector)
		)
			continue;
		const z = body.match(/z-index:\s*([^;]+);/);
		if (z) return z[1].trim();
	}
	return null;
}

const LADDER: Record<string, string> = {
	'.hex-hover-ring': 'var(--vit-map-z-ring, 3)',
	'.hex-hover-dot': 'var(--vit-map-z-dot, 4)',
	'.hex-hover-dot-leave': 'var(--vit-map-z-dot, 4)',
	'.hex-hover-dot-pinned': 'var(--vit-map-z-pinned, 5)',
	'.hex-tooltip-enter': 'var(--vit-map-z-tooltip, 7)',
	'.hex-tooltip-leave': 'var(--vit-map-z-tooltip, 7)'
};

describe('the overlay stacks by its own stylesheet', () => {
	it.each(Object.entries(LADDER))('%s sits at %s', (selector, expected) => {
		expect(zIndexOf(selector)).toBe(expected);
	});

	it('positions every overlay element absolutely and lets the pointer through', () => {
		const shared = css.match(
			/\.hex-hover-dot,\s*\.hex-hover-dot-leave,\s*\.hex-hover-dot-pinned,\s*\.hex-hover-ring,\s*\.hex-tooltip-enter,\s*\.hex-tooltip-leave\s*\{([^}]*)\}/
		);
		expect(shared, 'the shared placement block').not.toBeNull();
		expect(shared![1]).toMatch(/position:\s*absolute;/);
		expect(shared![1]).toMatch(/pointer-events:\s*none;/);
	});

	it('keeps the card above the dots and the host rung between them', () => {
		const rung = (name: string) =>
			Number(globe.match(new RegExp(`--vit-map-z-${name}:\\s*(\\d+);`))?.[1]);
		expect(rung('ring')).toBeLessThan(rung('dot'));
		expect(rung('dot')).toBeLessThan(rung('pinned'));
		expect(rung('pinned')).toBeLessThan(rung('host'));
		expect(rung('host')).toBeLessThan(rung('tooltip'));
	});

	it('gives the stage its own scoped placement and isolation', () => {
		const stage = globe.match(/\.vit-map-stage\s*\{([^}]*)\}/);
		expect(stage).not.toBeNull();
		expect(stage![1]).toMatch(/position:\s*relative;/);
		expect(stage![1]).toMatch(/isolation:\s*isolate;/);
		expect(globe).toMatch(
			/\.vit-map-stage :global\(\.vit-map-canvas\)\s*\{[^}]*position:\s*absolute;/
		);
	});
});
