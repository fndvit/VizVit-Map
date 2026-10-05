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
import type { FocusRegion, PinsConfig } from '../config.js';
import { createFocusRegionTracker, focusRegionFor } from '../focus.js';
import type { RegionShape } from '../../geo/region.js';
import { setupPinProjection, type PinProjection } from '../pinProjection.js';

/**
 * What the capability is configured with: the `pins` sub-config plus the
 * focused region it is confined to (`focus.confine` listing `'pins'`).
 */
export interface PinsCapabilityConfig extends PinsConfig {
	/** The region to confine the pins to, or `null`/absent for none. */
	region?: FocusRegion | null;
}

/**
 * Builds the `pins` capability.
 *
 * @param loadRegion - Loads a focused region's shape. Default: `loadRegionShape`.
 * @returns The capability.
 */
export function createPinsCapability(
	loadRegion?: (src: string) => Promise<RegionShape>
): Capability<PinsCapabilityConfig> {
	/** The latest config slice (read by the projection callbacks). */
	let cfg: PinsCapabilityConfig | null = null;
	/** The live projection loop (schedule + unsubscribe); null until setup runs. */
	let projection: PinProjection | null = null;
	/** The focused region's shape; pins outside it are not projected. */
	let shape: RegionShape | null = null;
	/**
	 * Pins have no layer to confine: the region filters the items the
	 * projection reads, and a new shape re-projects.
	 */
	const region = createFocusRegionTracker((next) => {
		shape = next;
		projection?.schedule();
	}, loadRegion);

	return {
		name: 'pins',

		setup(ctx, config) {
			cfg = config;
			projection = setupPinProjection(
				ctx.provider,
				() => (shape ? cfg?.items.filter((p) => shape!.contains(p.lon, p.lat)) : cfg?.items),
				(projected) => cfg?.onProjected(projected)
			);
			region.set(config.region);
		},

		update(_ctx, config) {
			cfg = config;
			region.set(config.region);
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

/**
 * Registry rule: active when a `pins` sub-config is present. Selects the
 * focused region with it when `focus.confine` lists `'pins'`.
 */
export const pinsRule = defineRule<PinsCapabilityConfig>({
	name: 'pins',
	applies: (config) => config.pins != null,
	select: (config) => ({ ...config.pins!, region: focusRegionFor(config, 'pins') }),
	create: () => createPinsCapability()
});
