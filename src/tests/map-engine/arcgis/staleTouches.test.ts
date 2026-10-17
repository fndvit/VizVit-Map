import { describe, it, expect, vi, afterEach } from 'vitest';
import { sweepStaleTouches } from '$lib/map-engine/arcgis/staleTouches';
import type { Handle } from '$lib/map-engine/provider';

/**
 * A surface inside the document, plus a sibling overlay outside it, with a spy
 * on the `pointercancel` events the surface receives.
 *
 * @returns The surface, the overlay and the pointer ids cancelled on the surface.
 */
function setup() {
	const surface = document.createElement('div');
	const overlay = document.createElement('div');
	document.body.append(surface, overlay);
	const cancelled: number[] = [];
	surface.addEventListener('pointercancel', (e) => cancelled.push((e as PointerEvent).pointerId));
	return { surface, overlay, cancelled };
}

/**
 * Dispatches a touch pointer event.
 *
 * @param el - The element the event targets.
 * @param type - `pointerdown`, `pointerup` or `pointercancel`.
 * @param pointerId - The touch's pointer id.
 * @param isPrimary - Whether it is the first touch of its sequence.
 */
function touch(el: Element, type: string, pointerId: number, isPrimary = false) {
	el.dispatchEvent(
		new PointerEvent(type, { pointerId, pointerType: 'touch', isPrimary, bubbles: true })
	);
}

let sweep: Handle | null = null;
afterEach(() => {
	sweep?.remove();
	sweep = null;
	document.body.innerHTML = '';
});

describe('sweepStaleTouches', () => {
	it('leaves touches that end on the surface alone', () => {
		const { surface, cancelled } = setup();
		sweep = sweepStaleTouches(surface);
		touch(surface, 'pointerdown', 1, true);
		touch(surface, 'pointerup', 1);
		touch(surface, 'pointerdown', 2, true);
		expect(cancelled).toEqual([]);
	});

	it('forwards a touch that lifts outside the surface as a cancel', () => {
		const { surface, overlay, cancelled } = setup();
		sweep = sweepStaleTouches(surface);
		touch(surface, 'pointerdown', 1, true);
		touch(overlay, 'pointerup', 1);
		expect(cancelled).toEqual([1]);
	});

	it('cancels a touch the browser never ended before a new sequence starts', () => {
		const { surface, cancelled } = setup();
		const order: string[] = [];
		surface.addEventListener('pointercancel', () => order.push('cancel'));
		surface.addEventListener('pointerdown', () => order.push('down'));
		sweep = sweepStaleTouches(surface);
		touch(surface, 'pointerdown', 1, true);
		order.length = 0;
		touch(surface, 'pointerdown', 2, true);
		expect(cancelled).toEqual([1]);
		// The view hears about the ghost before the new finger.
		expect(order).toEqual(['cancel', 'down']);
	});

	it('keeps the other fingers of a running multi-touch gesture', () => {
		const { surface, cancelled } = setup();
		sweep = sweepStaleTouches(surface);
		touch(surface, 'pointerdown', 1, true);
		touch(surface, 'pointerdown', 2, false);
		expect(cancelled).toEqual([]);
	});

	it('ignores touches that start outside the surface, and mouse pointers', () => {
		const { surface, overlay, cancelled } = setup();
		sweep = sweepStaleTouches(surface);
		touch(overlay, 'pointerdown', 1, true);
		surface.dispatchEvent(
			new PointerEvent('pointerdown', {
				pointerId: 5,
				pointerType: 'mouse',
				isPrimary: true,
				bubbles: true
			})
		);
		touch(surface, 'pointerdown', 2, true);
		expect(cancelled).toEqual([]);
	});

	it('stops watching once removed', () => {
		const { surface, overlay, cancelled } = setup();
		const listen = vi.spyOn(window, 'removeEventListener');
		sweepStaleTouches(surface).remove();
		touch(surface, 'pointerdown', 1, true);
		touch(overlay, 'pointerup', 1);
		expect(cancelled).toEqual([]);
		expect(listen).toHaveBeenCalledTimes(3);
		listen.mockRestore();
	});
});
