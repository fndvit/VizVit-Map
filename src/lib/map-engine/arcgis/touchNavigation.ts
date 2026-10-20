/**
 * @module map-engine/arcgis/touchNavigation
 * `touchNavigation: 'map'` on a 3D `SceneView`: the phone-map gesture grammar.
 *
 * A `SceneView`'s own touch navigation is a 3D camera rig. One pinch both zooms
 * AND rotates (by the angle between the fingers). A two-finger vertical drag
 * tilts. The tilt limit follows the altitude (`TiltConstraint` mode `auto`), and
 * a lifted finger leaves the globe spinning on momentum. Small, accidental
 * twists and tilts add up, so after a minute the globe is turned and leaning:
 * the same drag moves it a different way than it did at the start. On a phone
 * that reads as "the controls change over time".
 *
 * `'map'` keeps the SDK's own pan and pinch-zoom (and with them its constraints,
 * `interacting`/`stationary` flags and frame pacing) and removes the rest, for
 * touch pointers only:
 *
 * - **No twist.** A pinch rotates by the change in its `angle`. A handler that
 *   runs ahead of the SDK's own pins every touch drag's angle to 0, so a pinch
 *   only zooms (and pans by its centre).
 * - **No tilt.** The two-finger vertical drag is stopped before the SDK's tilt
 *   handler sees it. A pinch on the sphere also tilts: zooming toward the
 *   fingers rather than the view centre leans the camera (about 5° per pinch
 *   in at country scale), so when the last finger lifts the camera eases back
 *   to the tilt the gesture started from. (Capping the `TiltConstraint`
 *   instead does not hold it: in `manual` mode a 5.1 `SceneView` settles well
 *   below the cap, so every pinch lowers the tilt rather than raising it.)
 * - **No fling.** Momentum is switched off for a touch drag as it starts (the
 *   SDK reads the flag once, when a drag begins) and left as the view had it
 *   for every mouse drag.
 * - **No ghost fingers.** A touch whose ending never reached the view would
 *   turn every later one-finger pan into a pinch-zoom; `sweepStaleTouches`
 *   replays the missing ending (see `./staleTouches`).
 * - **North-up.** A long one-finger pan on the sphere can still turn the
 *   heading a little. When the last finger lifts, the camera eases back to
 *   north.
 *
 * The SDK exposes no public switch for the twist, the tilt gesture or momentum
 * per pointer type, so the handler sits in the view's input pipeline
 * (`view.inputManager`). That is internal to ArcGIS; {@link mapLikeTouch}
 * checks for it and, if a later SDK moves it, warns once and leaves the view's
 * own navigation in place.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- ArcGIS internals have no static types */

import type { Handle } from '../provider.js';
import { sweepStaleTouches } from './staleTouches.js';

/** Name of the handler group installed into the view's input manager. */
const GROUP = 'vit-touch-navigation';

/**
 * ArcGIS's `ViewEventPriorities.ALWAYS`: runs ahead of the view's own
 * (`INTERNAL`, -3) navigation handlers and of `view.on` listeners (`DEFAULT`, 0).
 */
const PRIORITY_ALWAYS = 1;

/** Headings closer to north than this (degrees) are left alone. */
const NORTH_EPSILON = 0.01;

/** Tilt drift (degrees) below which a lifted gesture is left alone. */
const TILT_EPSILON = 0.05;

/** How long (ms) the camera takes to ease back to north and its tilt. */
const SETTLE_MS = 200;

/**
 * The SDK's input-handler base class, which the input manager requires.
 *
 * @returns The `InputHandler` constructor.
 */
export async function loadInputHandler(): Promise<any> {
	// @ts-expect-error -- internal SDK module, shipped without a .d.ts
	const { InputHandler } = await import('@arcgis/core/views/input/InputHandler.js');
	return InputHandler;
}

/**
 * Whether a heading (degrees, any range) is north.
 *
 * @param heading - Camera heading in degrees.
 * @returns `true` when it is within {@link NORTH_EPSILON} of 0 / 360.
 */
export function isNorth(heading: number): boolean {
	const h = ((heading % 360) + 360) % 360;
	return Math.min(h, 360 - h) < NORTH_EPSILON;
}

/**
 * Gives a `SceneView` the phone-map touch grammar: one finger pans, a pinch only
 * zooms, the camera stays north-up at its tilt, and a drag stops where the
 * finger lifts. Mouse, wheel and keyboard navigation are untouched.
 *
 * @param view - A ready `SceneView`.
 * @param InputHandler - The SDK's input-handler base class ({@link loadInputHandler}).
 * @returns A handle that restores the view's own touch navigation.
 */
export function mapLikeTouch(view: any, InputHandler: any): Handle {
	// Plain DOM, so it holds even when the input manager below is out of reach.
	const sweep: Handle = view.surface ? sweepStaleTouches(view.surface) : { remove() {} };

	const manager = view.inputManager?._inputManager;
	if (typeof manager?.installHandlers !== 'function' || typeof InputHandler !== 'function') {
		console.warn(
			'[map] touchNavigation "map": this ArcGIS version has no reachable input manager; ' +
				'touch keeps the SceneView defaults.'
		);
		return sweep;
	}

	// The view's own momentum setting, restored for every non-touch drag.
	const momentum = view.navigation.momentumEnabled;
	// The tilt the current touch drag started from; the camera returns to it.
	let startTilt: number | null = null;

	class MapLikeTouch extends InputHandler {
		constructor() {
			// `true`: the handler has side effects (it edits the event in flight).
			super(true);
			this.registerIncoming('drag', (e: any) => onDrag(e.data));
			this.registerIncoming('vertical-two-finger-drag', (e: any) => e.stopPropagation());
		}
	}

	/**
	 * Edits one drag event before the SDK's pan/pinch handler reads it.
	 *
	 * @param data - The drag payload (`action`, `pointerType`, `angle`, …).
	 */
	function onDrag(data: any): void {
		const touch = data.pointerType === 'touch';
		if (data.action === 'start') {
			view.navigation.momentumEnabled = touch ? false : momentum;
			startTilt = touch ? (view.camera?.tilt ?? null) : null;
		}
		if (!touch) return;
		data.angle = 0;
		// `end` fires once, when the last finger lifts (`removed` is one of several).
		if (data.action === 'end') queueMicrotask(settle);
	}

	/** Eases the view, about its centre, back to north and to the tilt the gesture started from. */
	function settle(): void {
		const camera = view.camera;
		if (!camera) return;
		const target: { heading?: number; tilt?: number } = {};
		if (!isNorth(camera.heading)) target.heading = 0;
		if (startTilt != null && Math.abs(camera.tilt - startTilt) > TILT_EPSILON) {
			target.tilt = startTilt;
		}
		startTilt = null;
		if (Object.keys(target).length === 0) return;
		view.goTo(target, { duration: SETTLE_MS }).catch(() => {});
	}

	manager.installHandlers(GROUP, [new MapLikeTouch()], PRIORITY_ALWAYS);

	return {
		remove() {
			sweep.remove();
			if (manager.hasHandlers?.(GROUP)) manager.uninstallHandlers(GROUP);
			view.navigation.momentumEnabled = momentum;
		}
	};
}
