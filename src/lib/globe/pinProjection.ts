/**
 * @module globe/pinProjection
 * Pin-to-screen projection for geo-anchored overlay cards (formerly
 * `components/map/storyGlobePins`, moved into the globe library with its only
 * caller, the `pins` capability).
 * Projects lon/lat pins to pixel coordinates through the map provider's
 * **screen port**, with a dot-product heuristic to detect pins behind the globe.
 *
 * Provider-neutral: it types its dependency to the three ports it uses
 * (`screen`, `camera`, `events`) and knows no SDK object.
 */

import type { MapProvider } from '$lib/map-engine/provider.js';

/** Geographic anchor for an overlay pin. */
export type PinInput = { id: string; lon: number; lat: number };

/** Projected screen position for a pin. `visible` is false when behind the globe. */
export type PinProjected = { id: string; x: number; y: number; visible: boolean };

/** The provider slice the projection needs: screen projection, camera, events. */
export type PinProjectionProvider = Pick<MapProvider, 'screen' | 'camera' | 'events'>;

/** The projection loop's controls: force a re-projection, or tear it down. */
export interface PinProjection {
	/** Triggers a re-projection on the next frame (e.g. when pins change). */
	schedule: () => void;
	/** Removes the camera/size/padding subscriptions. Safe to call once. */
	destroy: () => void;
}

/**
 * Sets up rAF-throttled pin projection on a map provider.
 * Call once from onMount after the view is ready.
 *
 * @param provider - The map provider's `screen`/`camera`/`events` ports
 * @param getPins - Returns the current pin array (called on each projection)
 * @param onProjected - Callback with projected screen positions
 * @returns The projection controls (`schedule` to re-project, `destroy` to unsubscribe)
 */
export function setupPinProjection(
	provider: PinProjectionProvider,
	getPins: () => PinInput[] | undefined,
	onProjected: (projected: PinProjected[]) => void
): PinProjection {
	let rafId: number | null = null;

	const project = () => {
		rafId = null;
		const pins = getPins();
		if (!pins || pins.length === 0) {
			onProjected([]);
			return;
		}

		const { width, height } = provider.screen.size();
		const cam = provider.camera.get();
		const out: PinProjected[] = [];
		for (const p of pins) {
			const screen = provider.screen.toScreen({ lng: p.lon, lat: p.lat });

			if (screen && cam) {
				const inView = screen.x >= 0 && screen.x <= width && screen.y >= 0 && screen.y <= height;

				// Visibility test: dot product heuristic to detect behind-globe pins.
				// If the pin's unit vector and camera's unit vector have a positive dot
				// product, the pin is on the near side of the globe (visible).
				const pv = {
					x: Math.cos((p.lat * Math.PI) / 180) * Math.cos((p.lon * Math.PI) / 180),
					y: Math.cos((p.lat * Math.PI) / 180) * Math.sin((p.lon * Math.PI) / 180),
					z: Math.sin((p.lat * Math.PI) / 180)
				};
				const cv = {
					x: Math.cos((cam.latitude * Math.PI) / 180) * Math.cos((cam.longitude * Math.PI) / 180),
					y: Math.cos((cam.latitude * Math.PI) / 180) * Math.sin((cam.longitude * Math.PI) / 180),
					z: Math.sin((cam.latitude * Math.PI) / 180)
				};
				const dot = pv.x * cv.x + pv.y * cv.y + pv.z * cv.z;
				out.push({ id: p.id, x: screen.x, y: screen.y, visible: inView && dot > 0 });
			} else {
				out.push({ id: p.id, x: 0, y: 0, visible: false });
			}
		}
		onProjected(out);
	};

	const schedule = () => {
		if (rafId !== null) return;
		rafId = requestAnimationFrame(project);
	};

	const handles = [
		provider.events.on('camera', schedule),
		provider.events.on('size', schedule),
		provider.events.on('padding', schedule)
	];
	schedule(); // initial projection

	return {
		schedule,
		destroy() {
			for (const handle of handles) handle.remove();
			if (rafId !== null) {
				cancelAnimationFrame(rafId);
				rafId = null;
			}
		}
	};
}
