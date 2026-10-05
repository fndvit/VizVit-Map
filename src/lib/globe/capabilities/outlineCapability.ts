/**
 * @module globe/capabilities/outlines
 * Stroke-only region boundaries drawn from GeoJSON sources (e.g. the Brazil
 * Cerrado biome, the Amazon) — the authored `outlines`, and the region a
 * `focus` names.
 *
 * Owns one **GeoJSON layer** per outline (keyed by its stable `id`), each with a
 * stroke-only style (same pattern as the explore hex overlay). Visibility is a
 * fade: layer handles set opacity immediately — tweening is the caller's job so
 * every provider animates identically — so a small rAF opacity tween runs per
 * layer toward `visible ? 1 : 0`, matching the scrolly's 500ms DOM crossfades.
 * Outlines are declared per-step: `update()` diffs the current step's set against
 * the live layers (= the previous step's state) — mounting an outline the first
 * time its `id` appears, restyling one whose stroke changed, and fading each
 * layer toward `visible ? 1 : 0`. An outline dropped from a step fades to 0 but
 * stays mounted, so re-entering a step that shows it fades back in without a
 * re-fetch or flash. Layers are only disposed on full teardown (`destroy`).
 *
 * **The focus outline.** `GlobeConfig.focus` names the one region the globe is
 * about; its outline is drawn here, as one more entry keyed by the region id
 * ({@link outlinesOf}) — a separate capability would have been this one with
 * a single entry. An authored outline with the same id as the focus region is
 * the same boundary, so the focus entry replaces it rather than drawing it
 * twice. What makes a focus more than an outline — capabilities confining
 * themselves to the region — is read by each of them in its own rule
 * (`focusRegionFor`), not here.
 *
 * Provider-neutral: uses the `layers` port only.
 */

import type { GeoJsonLayerHandle } from '$lib/map-engine/provider.js';
import { defineRule, type Capability, type GlobeContext } from '../capability.js';
import type { GlobeConfig, OutlineConfig } from '../config.js';

/** Fade duration in ms — matches the scrolly's `duration-500` DOM crossfades. */
const FADE_MS = 500;

const DEFAULT_COLOR = '#000000';
const DEFAULT_WIDTH = 1.5;

/** Per-outline layer state: the provider layer handle, its fade and the stroke it draws. */
interface OutlineLayer {
	handle: GeoJsonLayerHandle;
	/** Active rAF handle for the opacity tween; cancelled before a new one starts. */
	raf: number | null;
	color: string;
	width: number;
}

/** Cubic ease-in-out. */
function easeInOut(t: number): number {
	return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Every outline a config draws: its authored `outlines`, then the `focus`
 * region's outline (shown unless `focus.visible` is `false`; absent with
 * `outline: false` or no region). An authored entry with the focus region's id
 * is dropped — the focus entry is that boundary.
 *
 * @param config - The globe config.
 * @returns The outlines to draw, possibly none.
 */
export function outlinesOf(config: GlobeConfig): OutlineConfig[] {
	const focus = config.focus;
	const region = focus?.outline === false ? null : (focus?.region ?? null);
	const authored = config.outlines ?? [];
	if (!region) return authored;
	const stroke = focus?.outline || {};
	return [
		...authored.filter((outline) => outline.id !== region.id),
		{
			id: region.id,
			src: region.src,
			visible: focus?.visible !== false,
			color: stroke.color,
			width: stroke.width
		}
	];
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
			entry.raf = t < 1 ? requestAnimationFrame(step) : null;
		};
		entry.raf = requestAnimationFrame(step);
	}

	/**
	 * Mounts the stroke layer for one outline the first time its id appears, and
	 * restyles a mounted one whose stroke changed.
	 *
	 * @param ctx - The globe context (layers port).
	 * @param config - The outline.
	 */
	function ensureLayer(ctx: GlobeContext, config: OutlineConfig) {
		const color = config.color ?? DEFAULT_COLOR;
		const width = config.width ?? DEFAULT_WIDTH;
		const entry = layers.get(config.id);
		if (entry) {
			if (entry.color === color && entry.width === width) return;
			entry.color = color;
			entry.width = width;
			entry.handle.setStyle({ stroke: { color, width } });
			return;
		}
		const handle = ctx.provider.layers.geojson({
			id: config.id,
			source: { url: config.src },
			// No fill — the boundary stroke is the whole point.
			style: { stroke: { color, width } },
			placement: 'draped',
			// Set the initial opacity directly (no tween) so a remount on an
			// already-visible step doesn't flash a fade-in.
			opacity: config.visible ? 1 : 0
		});
		layers.set(config.id, { handle, raf: null, color, width });
	}

	return {
		name: 'outlines',

		setup(ctx: GlobeContext, configs) {
			// `configs` may be empty (the story uses outlines on a later step); layers
			// are then built lazily as ids first appear in `update`.
			for (const config of configs ?? []) ensureLayer(ctx, config);
		},

		update(ctx, configs) {
			const current = new Map((configs ?? []).map((c) => [c.id, c]));
			for (const config of current.values()) ensureLayer(ctx, config);
			// Fade every live layer to its target: shown when present-and-visible this
			// step, hidden otherwise. Dropped outlines fade to 0 but stay mounted, so a
			// later step can fade them back in without a re-fetch.
			for (const [id, entry] of layers) {
				fadeTo(entry, current.get(id)?.visible ? 1 : 0);
			}
		},

		destroy() {
			for (const entry of layers.values()) {
				cancelFade(entry);
				entry.handle.remove();
			}
			layers.clear();
		}
	};
}

/**
 * Registry rule: active when the config carries an `outlines` array at all —
 * even an empty one — or a `focus`. A scrolly that shows outlines on some
 * steps emits `[]` (or a region-less `focus`) on the others, like `pins`, so
 * the capability mounts from the first render and can fade outlines in/out as
 * steps declare them.
 */
export const outlinesRule = defineRule<OutlineConfig[]>({
	name: 'outlines',
	applies: (config) => config.outlines != null || config.focus != null,
	select: outlinesOf,
	create: createOutlineCapability
});
