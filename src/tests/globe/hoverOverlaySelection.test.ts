/**
 * Selection in the hover overlay, pinned.
 *
 * `select(result)` is the persistent counterpart of `applyHover`: the host
 * hands it a `HoverResult` (never the overlay's internal `HoverInfo`), the
 * overlay styles and draws the dot itself, resolves the meaning once, and hands
 * it to the `selectionCard` snippet — which is rendered ONCE and updated in
 * place. Each of those is a thing a host used to have to rebuild beside the
 * overlay, and each broke in its own way (double resolution, a tap replayed as
 * a hover that a touch pan overwrote, a sheet remounting per cell).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

import OverlaySelectionHost from '../helpers/OverlaySelectionHost.svelte';
import type { DotStyle, HoverOverlayHandle, HoverResult } from '$lib/globe/hover/hoverTypes.js';

/** What `mount` returns for the host: its exported `handle()`. */
type Host = { handle(): HoverOverlayHandle };

const style: DotStyle = { color: '#fc0', size: 12, hidden: false, absent: false } as DotStyle;
const hiddenStyle: DotStyle = { ...style, hidden: true } as DotStyle;

function cell(id: string, x = 100, y = 100, noData = false): HoverResult {
	return {
		resolution: 'r4',
		attributes: { h3id: id },
		dotScreenX: x,
		dotScreenY: y,
		dotLat: 40,
		dotLng: -3,
		noData
	};
}

describe('HoverTooltipOverlay.select', () => {
	let target: HTMLElement;
	let host: Host | null = null;
	const meaning = vi.fn((r: HoverResult) => ({ label: `cell ${r.attributes.h3id}` }));
	const computeStyle = vi.fn((r: HoverResult) =>
		r.attributes.h3id === 'hidden' ? hiddenStyle : style
	);

	beforeEach(() => {
		vi.useFakeTimers();
		meaning.mockClear();
		computeStyle.mockClear();
		target = document.createElement('div');
		document.body.appendChild(target);
		host = mount(OverlaySelectionHost, { target, props: { computeStyle, meaning } }) as Host;
		flushSync();
	});

	afterEach(() => {
		if (host) unmount(host as unknown as Record<string, unknown>);
		target.remove();
		vi.useRealTimers();
	});

	const handle = () =>
		(
			host as unknown as { handle(): import('$lib/globe/hover/hoverTypes.js').HoverOverlayHandle }
		).handle();
	const selectionNode = () => target.querySelector<HTMLElement>('[data-selection]')!;
	const pinnedDot = () => target.querySelector<HTMLElement>('.hex-hover-dot-pinned');

	it('draws the selected dot from the HoverResult, styled by computeStyle, and resolves its meaning once', () => {
		handle().select(cell('a', 120, 80));
		flushSync();
		expect(pinnedDot()).not.toBeNull();
		expect(pinnedDot()!.style.left).toBe('120px');
		expect(pinnedDot()!.style.background).toBe('rgb(255, 204, 0)');
		expect(meaning).toHaveBeenCalledTimes(1);
		expect(selectionNode().textContent!.trim()).toBe('cell a');
		expect(selectionNode().dataset.key).toBe('a');
		expect(handle().hasOverlays()).toBe(true);
	});

	it('survives hover events: a pan after a tap moves the hover dot, not the selection', () => {
		handle().select(cell('a'));
		flushSync();
		handle().applyHover(cell('b', 300, 300));
		flushSync();
		handle().applyHover(null);
		flushSync();
		expect(pinnedDot()).not.toBeNull();
		expect(selectionNode().textContent!.trim()).toBe('cell a');
		// The hover ring is skipped for the selected cell itself (let b's ring expire first).
		vi.advanceTimersByTime(700);
		flushSync();
		expect(target.querySelector('.hex-hover-ring')).toBeNull();
		handle().applyHover(cell('a'));
		flushSync();
		expect(target.querySelector('.hex-hover-ring')).toBeNull();
	});

	it('updates the selection surface in place — same DOM node across selections', () => {
		handle().select(cell('a'));
		flushSync();
		const node = selectionNode();
		handle().select(cell('b', 200, 200));
		flushSync();
		expect(selectionNode()).toBe(node);
		expect(node.textContent!.trim()).toBe('cell b');
		expect(node.dataset.key).toBe('b');
		expect(meaning).toHaveBeenCalledTimes(2);
		// The previous dot shrinks out through the leaving trail.
		expect(target.querySelector('.hex-hover-dot-leave')).not.toBeNull();
	});

	it('clears with null: the surface stays mounted and empties, the dot leaves', () => {
		handle().select(cell('a'));
		flushSync();
		const node = selectionNode();
		handle().select(null);
		flushSync();
		expect(pinnedDot()).toBeNull();
		expect(selectionNode()).toBe(node);
		expect(node.textContent!.trim()).toBe('');
		expect(node.dataset.key).toBe('');
		expect(target.querySelector('.hex-hover-dot-leave')).not.toBeNull();
		vi.advanceTimersByTime(300);
		flushSync();
		expect(handle().hasOverlays()).toBe(false);
	});

	it('does not select a cell that draws no dot', () => {
		handle().select(cell('a'));
		flushSync();
		handle().select(cell('hidden'));
		flushSync();
		expect(pinnedDot()).toBeNull();
		expect(selectionNode().dataset.key).toBe('');
	});

	it('carries noData beside the meaning', () => {
		handle().select(cell('land', 10, 10, true));
		flushSync();
		expect(selectionNode().dataset.nodata).toBe('true');
	});
});
