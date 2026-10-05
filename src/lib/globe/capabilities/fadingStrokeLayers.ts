/**
 * @module globe/capabilities/fadingStrokeLayers
 * A keyed set of stroke-only GeoJSON layers that fade in and out — what the
 * `outlines` and `focus` capabilities both draw. Shared here so neither
 * capability depends on the other.
 *
 * Each layer is draped, has no fill (the boundary stroke is the whole point)
 * and is keyed by a stable id, so a capability can mount one the first time
 * its id appears and fade it on every update. Layer handles set opacity
 * immediately — tweening is the caller's job so every provider animates
 * identically — so a small rAF opacity tween runs per layer, matching the
 * scrolly's 500 ms DOM crossfades. A layer faded out stays mounted, so
 * fading it back in needs no re-fetch; layers are disposed by `removeAll`.
 *
 * Provider-neutral: uses the `layers` port only.
 */

import type { GeoJsonLayerHandle } from '$lib/map-engine/provider.js';
import type { GlobeContext } from '../capability.js';

/** Fade duration in ms — matches the scrolly's `duration-500` DOM crossfades. */
export const STROKE_FADE_MS = 500;

/** One stroke layer to mount. */
export interface StrokeLayerSpec {
	/** Stable identity: the layer is mounted once per id. */
	id: string;
	/** URL of the GeoJSON polygon(s). */
	src: string;
	/** Stroke colour. */
	color: string;
	/** Stroke width in px. */
	width: number;
	/** Whether the layer starts shown (set directly, no fade-in on mount). */
	visible: boolean;
}

/** The set of layers, and what a capability does with them. */
export interface FadingStrokeLayers {
	/**
	 * Mounts a layer for the spec's id unless one is already mounted.
	 *
	 * @param ctx - The globe context (layers port).
	 * @param spec - The layer to mount.
	 */
	ensure(ctx: GlobeContext, spec: StrokeLayerSpec): void;
	/**
	 * Fades a mounted layer to shown or hidden; a no-op for an unknown id.
	 *
	 * @param id - The layer id.
	 * @param visible - Whether it should end shown.
	 */
	fade(id: string, visible: boolean): void;
	/**
	 * Restyles a mounted layer's stroke; a no-op when nothing changed.
	 *
	 * @param id - The layer id.
	 * @param color - Stroke colour.
	 * @param width - Stroke width in px.
	 */
	restyle(id: string, color: string, width: number): void;
	/**
	 * The mounted ids, in mount order.
	 *
	 * @returns The ids.
	 */
	ids(): string[];
	/** Cancels every fade and removes every layer. */
	removeAll(): void;
}

/** One mounted layer: its handle, its active fade and the stroke it draws. */
interface StrokeLayer {
	handle: GeoJsonLayerHandle;
	/** Active rAF handle for the opacity tween; cancelled before a new one starts. */
	raf: number | null;
	color: string;
	width: number;
}

/**
 * Cubic ease-in-out.
 *
 * @param t - Progress, 0–1.
 * @returns Eased progress.
 */
function easeInOut(t: number): number {
	return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Creates an empty set of fading stroke layers.
 *
 * @returns The set.
 */
export function createFadingStrokeLayers(): FadingStrokeLayers {
	const layers = new Map<string, StrokeLayer>();

	function cancelFade(entry: StrokeLayer): void {
		if (entry.raf != null) {
			cancelAnimationFrame(entry.raf);
			entry.raf = null;
		}
	}

	return {
		ensure(ctx, spec) {
			if (layers.has(spec.id)) return;
			const handle = ctx.provider.layers.geojson({
				id: spec.id,
				source: { url: spec.src },
				style: { stroke: { color: spec.color, width: spec.width } },
				placement: 'draped',
				// Set the initial opacity directly (no tween) so a remount on an
				// already-visible step doesn't flash a fade-in.
				opacity: spec.visible ? 1 : 0
			});
			layers.set(spec.id, { handle, raf: null, color: spec.color, width: spec.width });
		},

		fade(id, visible) {
			const entry = layers.get(id);
			if (!entry) return;
			cancelFade(entry);
			const target = visible ? 1 : 0;
			const from = entry.handle.getOpacity() ?? 0;
			if (from === target) return;
			const start = performance.now();
			const step = (now: number) => {
				const t = Math.min(1, (now - start) / STROKE_FADE_MS);
				entry.handle.setOpacity(from + (target - from) * easeInOut(t));
				entry.raf = t < 1 ? requestAnimationFrame(step) : null;
			};
			entry.raf = requestAnimationFrame(step);
		},

		restyle(id, color, width) {
			const entry = layers.get(id);
			if (!entry || (entry.color === color && entry.width === width)) return;
			entry.color = color;
			entry.width = width;
			entry.handle.setStyle({ stroke: { color, width } });
		},

		ids: () => [...layers.keys()],

		removeAll() {
			for (const entry of layers.values()) {
				cancelFade(entry);
				entry.handle.remove();
			}
			layers.clear();
		}
	};
}
