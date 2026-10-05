/**
 * @module globe/capabilities/focus
 * The **focus**: the one region the globe is about, outlined.
 *
 * Draws the region's outline as a draped stroke layer that fades in and out
 * (the shared `./fadingStrokeLayers`, the same as `outlines`). The layer is
 * keyed by the region id: a new region mounts its own layer and the previous
 * one fades out but stays mounted, so returning to it needs no re-fetch. An
 * outline style change restyles the live layer; `outline: false` hides it
 * while the region still confines.
 *
 * Confinement is not done here. Each capability named in
 * `FocusConfig.confine` reads its region through `focusRegionFor` in its own
 * rule and confines itself — so this capability knows none of them.
 *
 * Provider-neutral: uses the `layers` port only.
 */

import { defineRule, type Capability, type GlobeContext } from '../capability.js';
import type { FocusConfig } from '../config.js';
import { createFadingStrokeLayers } from './fadingStrokeLayers.js';

const DEFAULT_COLOR = '#000000';
const DEFAULT_WIDTH = 1.5;

/**
 * Builds the `focus` capability.
 *
 * @returns The capability.
 */
export function createFocusCapability(): Capability<FocusConfig> {
	const layers = createFadingStrokeLayers();

	/**
	 * Draws a config: mounts or restyles its region's layer, and fades every
	 * layer to shown (the current region, outlined and visible) or hidden.
	 *
	 * @param ctx - The globe context.
	 * @param config - The focus config.
	 */
	function apply(ctx: GlobeContext, config: FocusConfig): void {
		const region = config.region;
		const outline = config.outline === false ? null : (config.outline ?? {});
		const shown = !!region && !!outline && config.visible !== false;
		if (region && outline) {
			const color = outline.color ?? DEFAULT_COLOR;
			const width = outline.width ?? DEFAULT_WIDTH;
			layers.ensure(ctx, { id: region.id, src: region.src, color, width, visible: shown });
			layers.restyle(region.id, color, width);
		}
		for (const id of layers.ids()) layers.fade(id, shown && id === region?.id);
	}

	return {
		name: 'focus',
		setup: apply,
		update: apply,
		destroy() {
			layers.removeAll();
		}
	};
}

/**
 * Registry rule: active when the config carries a `focus` sub-config — even
 * one with `region: null`, which a scrolly passes on the steps that focus
 * nothing, so the capability is mounted from the first render.
 */
export const focusRule = defineRule<FocusConfig>({
	name: 'focus',
	applies: (config) => config.focus != null,
	select: (config) => config.focus!,
	create: createFocusCapability
});
