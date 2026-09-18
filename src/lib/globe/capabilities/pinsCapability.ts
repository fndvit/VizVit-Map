/**
 * @module globe/capabilities/pins
 * Geo-anchored overlay pins projected to screen pixels each frame.
 *
 * Thin wrapper over the existing {@link setupPinProjection} helper: it installs
 * the rAF-throttled camera/size/padding watchers and re-projects when the pin
 * set changes.
 *
 * Provider-neutral: the helper is handed the `screen`, `camera` and `events`
 * ports and nothing else.
 */

import { type Capability } from '../capability.js';
import { defineRule } from '../capability.js';
import type { PinsConfig } from '../config.js';
import { setupPinProjection, type PinProjection } from '../pinProjection.js';

export function createPinsCapability(): Capability<PinsConfig> {
	/** The latest config slice (read by the projection callbacks). */
	let cfg: PinsConfig | null = null;
	/** The live projection loop (schedule + unsubscribe); null until setup runs. */
	let projection: PinProjection | null = null;

	return {
		name: 'pins',

		setup(ctx, config) {
			cfg = config;
			projection = setupPinProjection(
				ctx.provider,
				() => cfg?.items,
				(projected) => cfg?.onProjected(projected)
			);
		},

		update(_ctx, config) {
			cfg = config;
			projection?.schedule();
		},

		destroy() {
			// The projection owns three provider subscriptions; release them here
			// rather than leaning on the view teardown.
			projection?.destroy();
			projection = null;
			cfg = null;
		}
	};
}

/** Registry rule: active when a `pins` sub-config is present. */
export const pinsRule = defineRule<PinsConfig>({
	name: 'pins',
	applies: (config) => config.pins != null,
	select: (config) => config.pins!,
	create: createPinsCapability
});
