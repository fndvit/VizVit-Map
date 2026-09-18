/**
 * @module globe/capabilities/outlines
 * Stroke-only region boundaries drawn from GeoJSON sources (e.g. the Brazil
 * Cerrado biome, the Amazon).
 *
 * Owns one **GeoJSON layer** per outline (keyed by its stable `id`), each with a
 * stroke-only style (same pattern as the explore hex overlay). Visibility is a
 * fade: layer handles set opacity immediately — tweening is the caller's job so
 * every provider animates identically — so a small rAF opacity tween runs per
 * layer toward `visible ? 1 : 0`, matching the scrolly's 500ms DOM crossfades.
 * Outlines are declared per-step: `update()` diffs the current step's set against
 * the live layers (= the previous step's state) — mounting an outline the first
 * time its `id` appears and fading each layer toward `visible ? 1 : 0`. An
 * outline dropped from a step fades to 0 but stays mounted, so re-entering a step
 * that shows it fades back in without a re-fetch or flash. Layers are only
 * disposed on full teardown (`destroy`).
 *
 * Provider-neutral: uses the `layers` port only.
 */

import type { GeoJsonLayerHandle } from '$lib/map-engine/provider.js';
import { defineRule, type Capability, type GlobeContext } from '../capability.js';
import type { OutlineConfig } from '../config.js';

/** Fade duration in ms — matches the scrolly's `duration-500` DOM crossfades. */
const FADE_MS = 500;

const DEFAULT_COLOR = '#000000';
const DEFAULT_WIDTH = 1.5;

/** Per-outline layer state: the provider layer handle and its active fade handle. */
interface OutlineLayer {
	handle: GeoJsonLayerHandle;
	/** Active rAF handle for the opacity tween; cancelled before a new one starts. */
	raf: number | null;
}

/** Cubic ease-in-out. */
function easeInOut(t: number): number {
	return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function createOutlineCapability(): Capability<OutlineConfig[]> {
	/** GeoJSON layer handles holding the boundaries, keyed by outline id. */
	const layers = new Map<string, OutlineLayer>();

	/** Cancels an entry's in-flight fade. */
	function cancelFade(entry: OutlineLayer) {
		if (entry.raf != null) {
			cancelAnimationFrame(entry.raf);
			entry.raf = null;
		}
	}

	/** Tweens the entry layer's opacity to `target` over {@link FADE_MS}. */
	function fadeTo(entry: OutlineLayer, target: number) {
		cancelFade(entry);
		const from = entry.handle.getOpacity() ?? 0;
		if (from === target) return;
		const start = performance.now();
		const step = (now: number) => {
			const t = Math.min(1, (now - start) / FADE_MS);
			entry.handle.setOpacity(from + (target - from) * easeInOut(t));
			if (t < 1) {
				entry.raf = requestAnimationFrame(step);
			} else {
				entry.raf = null;
			}
		};
		entry.raf = requestAnimationFrame(step);
	}

	/**
	 * Builds and registers a stroke-only GeoJSON layer for one outline config.
	 *
	 * @param ctx - The globe context (layers port).
	 * @param config - The outline to mount.
	 */
	function addLayer(ctx: GlobeContext, config: OutlineConfig) {
		const handle = ctx.provider.layers.geojson({
			id: config.id,
			source: { url: config.src },
			// No fill — the boundary stroke is the whole point.
			style: {
				stroke: { color: config.color ?? DEFAULT_COLOR, width: config.width ?? DEFAULT_WIDTH }
			},
			placement: 'draped',
			// Set the initial opacity directly (no tween) so a remount on an
			// already-visible step doesn't flash a fade-in.
			opacity: config.visible ? 1 : 0
		});
		layers.set(config.id, { handle, raf: null });
	}

	/**
	 * Removes and disposes an entry's layer.
	 *
	 * @param id - The outline id to unmount.
	 */
	function removeLayer(id: string) {
		const entry = layers.get(id);
		if (!entry) return;
		cancelFade(entry);
		entry.handle.remove();
		layers.delete(id);
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
			for (const config of current.values()) {
				if (!layers.has(config.id)) addLayer(ctx, config);
			}
			// Fade every live layer to its target: shown when present-and-visible this
			// step, hidden otherwise. Dropped outlines fade to 0 but stay mounted, so a
			// later step can fade them back in without a re-fetch.
			for (const [id, entry] of layers) {
				fadeTo(entry, current.get(id)?.visible ? 1 : 0);
			}
		},

		destroy() {
			for (const id of [...layers.keys()]) removeLayer(id);
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
