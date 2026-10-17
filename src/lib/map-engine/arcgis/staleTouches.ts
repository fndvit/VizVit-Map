/**
 * @module map-engine/arcgis/staleTouches
 * Clears touch pointers an ArcGIS view still believes are down.
 *
 * The view tracks fingers from `pointerdown` / `pointerup` / `pointercancel`
 * listeners on its own surface element only. When the browser delivers a
 * finger's `pointerup` somewhere else, or not at all (iOS Safari does both now
 * and then), the view keeps that finger forever. From then on every one-finger
 * drag is a pinch against the ghost: the globe zooms instead of panning, and
 * the longer the session the likelier it is. Pointer events alone cannot tell
 * the view about it, so {@link sweepStaleTouches} watches the whole window and
 * replays the missing ending to the surface as a `pointercancel`, which the
 * view handles like any cancelled touch:
 *
 * - **A finger lifted off the surface.** A `pointerup` / `pointercancel` for a
 *   touch that went down on the surface but ends outside it is forwarded.
 * - **A finger the browser forgot.** A primary touch `pointerdown` starts a
 *   new touch sequence: no other finger is on the screen. Every touch still
 *   held from earlier is cancelled before the view sees the new one.
 */

import type { Handle } from '../provider.js';

/**
 * Keeps a view's touch bookkeeping in step with the fingers actually on the
 * screen (see the module note).
 *
 * @param surface - The view's surface element (`view.surface`), whose own
 *   pointer listeners the view tracks fingers with.
 * @param target - Where to watch for pointer events. Default `window`.
 * @returns A handle that stops watching.
 */
export function sweepStaleTouches(surface: HTMLElement, target: Window = window): Handle {
	/** Touch pointers that went down on the surface and have not ended. */
	const down = new Set<number>();

	/**
	 * Tells the view a touch is over.
	 *
	 * @param pointerId - The touch's pointer id.
	 */
	const cancel = (pointerId: number) => {
		surface.dispatchEvent(
			new PointerEvent('pointercancel', { pointerId, pointerType: 'touch', bubbles: true })
		);
	};

	/** @param e - Any pointerdown in the window (capture phase, ahead of the view). */
	const onDown = (e: PointerEvent) => {
		if (e.pointerType !== 'touch') return;
		if (e.isPrimary) {
			for (const id of down) cancel(id);
			down.clear();
		}
		if (surface.contains(e.target as Node)) down.add(e.pointerId);
	};

	/** @param e - Any pointerup / pointercancel in the window (capture phase). */
	const onEnd = (e: PointerEvent) => {
		if (e.pointerType !== 'touch' || !down.delete(e.pointerId)) return;
		if (!surface.contains(e.target as Node)) cancel(e.pointerId);
	};

	const opts = { capture: true, passive: true };
	target.addEventListener('pointerdown', onDown, opts);
	target.addEventListener('pointerup', onEnd, opts);
	target.addEventListener('pointercancel', onEnd, opts);

	return {
		remove() {
			target.removeEventListener('pointerdown', onDown, opts);
			target.removeEventListener('pointerup', onEnd, opts);
			target.removeEventListener('pointercancel', onEnd, opts);
			down.clear();
		}
	};
}
