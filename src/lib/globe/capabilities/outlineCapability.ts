/**
 * @module globe/capabilities/outlines
 * Stroke-only region boundaries drawn from GeoJSON sources (e.g. the Brazil
 * Cerrado biome, the Amazon).
 *
 * Owns one **GeoJSON layer** per outline (keyed by its stable `id`), each with a
 * stroke-only style (same pattern as the explore hex overlay). Visibility is a
 * fade toward `visible ? 1 : 0`; the layers and their fades are the shared
 * `./fadingStrokeLayers`, which the `focus` capability draws with too.
 * Outlines are declared per-step: `update()` diffs the current step's set against
 * the live layers (= the previous step's state) — mounting an outline the first
 * time its `id` appears and fading each layer toward `visible ? 1 : 0`. An
 * outline dropped from a step fades to 0 but stays mounted, so re-entering a step
 * that shows it fades back in without a re-fetch or flash. Layers are only
 * disposed on full teardown (`destroy`).
 *
 * Provider-neutral: uses the `layers` port only.
 */

import { defineRule, type Capability, type GlobeContext } from '../capability.js';
import type { OutlineConfig } from '../config.js';
import { createFadingStrokeLayers } from './fadingStrokeLayers.js';

const DEFAULT_COLOR = '#000000';
const DEFAULT_WIDTH = 1.5;

export function createOutlineCapability(): Capability<OutlineConfig[]> {
	/** The boundary layers, keyed by outline id (mounting and fades: `./fadingStrokeLayers`). */
	const layers = createFadingStrokeLayers();

	/**
	 * Mounts the stroke layer for one outline config (once per id).
	 *
	 * @param ctx - The globe context (layers port).
	 * @param config - The outline to mount.
	 */
	function addLayer(ctx: GlobeContext, config: OutlineConfig) {
		layers.ensure(ctx, {
			id: config.id,
			src: config.src,
			color: config.color ?? DEFAULT_COLOR,
			width: config.width ?? DEFAULT_WIDTH,
			visible: !!config.visible
		});
	}

	return {
		name: 'outlines',

		setup(ctx: GlobeContext, configs) {
			// `configs` may be empty (the story uses outlines on a later step); layers
			// are then built lazily as ids first appear in `update`.
			for (const config of configs ?? []) addLayer(ctx, config);
		},

		update(ctx, configs) {
			const current = new Map((configs ?? []).map((c) => [c.id, c]));
			// Mount any outline whose id is appearing for the first time.
			for (const config of current.values()) addLayer(ctx, config);
			// Fade every live layer to its target: shown when present-and-visible this
			// step, hidden otherwise. Dropped outlines fade to 0 but stay mounted, so a
			// later step can fade them back in without a re-fetch.
			for (const id of layers.ids()) layers.fade(id, !!current.get(id)?.visible);
		},

		destroy() {
			layers.removeAll();
		}
	};
}

/**
 * Registry rule: active when the config carries an `outlines` array at all —
 * even an empty one. A scrolly that shows outlines on some steps emits `[]` on the
 * others (like `pins`), so the capability mounts from the first render and can fade
 * outlines in/out as steps declare them.
 */
export const outlinesRule = defineRule<OutlineConfig[]>({
	name: 'outlines',
	applies: (config) => config.outlines != null,
	select: (config) => config.outlines!,
	create: createOutlineCapability
});
