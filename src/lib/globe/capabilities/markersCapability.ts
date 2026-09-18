/**
 * @module globe/capabilities/markers
 * Interactive geo-anchored markers with click-to-select (OurStoriesMap diamonds).
 *
 * Owns one **points layer** on the map provider (`provider.layers.points`), the
 * symbol styling (was `makeDiamondSymbol`), the click→`onSelect` hit test (on the
 * layer handle, so it only ever answers "which of MY items"), and the fly-to
 * selection through the camera port. Selection state lives in the host
 * component; it flows back in via `config.activeId`, so the "active changed →
 * restyle + fly" behaviour is handled in {@link Capability.update}.
 *
 * Provider-neutral: uses the `layers`, `events` and `camera` ports only.
 */

import type { Handle, PointItem, PointLayerHandle, PointSymbol } from '$lib/map-engine/provider.js';
import { defineRule, type Capability, type GlobeContext } from '../capability.js';
import { resolveAnimation, type MarkersConfig } from '../config.js';

/**
 * Item id of the "you are here" marker. It is not one of the config's items, so
 * a click can never select it and `restyle` leaves it white.
 */
const CURRENT_ID = '__current';

/**
 * Diamond/circle marker symbol — amber when active, tan otherwise.
 *
 * @param isActive - Whether this marker is the highlighted one.
 * @param shape - Marker shape from {@link MarkersConfig.symbol}.
 * @returns The provider-neutral point symbol.
 */
function markerSymbol(isActive: boolean, shape: 'diamond' | 'circle'): PointSymbol {
	return {
		shape,
		size: isActive ? 16 : 12,
		color: isActive ? [245, 197, 24, 1] : [184, 176, 154, 0.9],
		outline: {
			color: isActive ? [180, 140, 10, 1] : [140, 132, 118, 1],
			width: isActive ? 2 : 1.5
		}
	};
}

/**
 * "You are here" marker — white diamond, active-sized, amber outline. Non-clickable.
 *
 * @returns The provider-neutral point symbol.
 */
function currentMarkerSymbol(): PointSymbol {
	return {
		shape: 'diamond',
		size: 16,
		color: [255, 255, 255, 0.9],
		outline: { color: [180, 140, 10, 1], width: 2 }
	};
}

/**
 * Creates the `markers` capability.
 *
 * @returns A fresh, unmounted capability instance.
 */
export function createMarkersCapability(): Capability<MarkersConfig> {
	/** The provider points layer holding the marker symbols; null until setup. */
	let layer: PointLayerHandle | null = null;
	/** The items last handed to the layer (so `restyle` iterates what is drawn). */
	let drawn: PointItem[] = [];
	/** The latest config slice (kept so click/update handlers see fresh items). */
	let cfg: MarkersConfig | null = null;
	/** Previous `activeId`, so `update` only flies when the active marker changes. */
	let lastActiveId: string | undefined;
	/** Handle for the map-click listener; removed on destroy. */
	let clickHandle: Handle | null = null;

	/** Rebuilds the layer's items from the current config. */
	function render() {
		if (!layer || !cfg) return;
		const shape = cfg.symbol ?? 'diamond';
		const items: PointItem[] = [];
		for (const item of cfg.items) {
			if (item.id === cfg.excludeId) continue;
			items.push({
				id: item.id,
				lng: item.lon,
				lat: item.lat,
				symbol: markerSymbol(item.id === cfg.activeId, shape),
				hittable: true
			});
		}
		// "You are here" marker — `hittable: false` so the layer's hitTest never
		// reports it (non-clickable), and keyed `__current` so restyle() skips it.
		const currentId = cfg.currentId;
		if (currentId != null) {
			const current = cfg.items.find((m) => m.id === currentId);
			if (current) {
				items.push({
					id: CURRENT_ID,
					lng: current.lon,
					lat: current.lat,
					symbol: currentMarkerSymbol(),
					hittable: false
				});
			}
		}
		drawn = items;
		layer.set(items);
	}

	/**
	 * Restyles every drawn marker for the given active id.
	 *
	 * @param activeId - The marker to draw amber; all others go tan.
	 */
	function restyle(activeId: string | undefined) {
		if (!layer || !cfg) return;
		const shape = cfg.symbol ?? 'diamond';
		for (const item of drawn) {
			// Skip the "you are here" marker — it stays white.
			if (item.id === CURRENT_ID) continue;
			layer.restyle(item.id, markerSymbol(item.id === activeId, shape));
		}
	}

	/**
	 * Flies the camera to a marker.
	 *
	 * @param ctx - The globe context (camera port).
	 * @param id - The marker to centre on; no-op when unknown.
	 */
	function flyTo(ctx: GlobeContext, id: string | undefined) {
		if (!cfg || id == null) return;
		const item = cfg.items.find((m) => m.id === id);
		if (!item) return;
		ctx.provider.camera
			.flyTo(
				{ longitude: item.lon, latitude: item.lat, tilt: 0, heading: 0 },
				resolveAnimation(cfg.flyOnSelect) ?? { duration: 0 }
			)
			.catch((err: unknown) => {
				// The camera port never rejects on supersession; anything else is real.
				console.error(err);
			});
	}

	return {
		name: 'markers',

		setup(ctx, config) {
			cfg = config;
			layer = ctx.provider.layers.points({ id: 'markers', placement: 'floating' });
			render();
			lastActiveId = config.activeId;

			clickHandle = ctx.provider.events.on('click', async (event) => {
				const id = await layer?.hitTest(event);
				if (id != null) cfg?.onSelect?.(id);
			});
		},

		update(ctx, config) {
			cfg = config;
			if (!layer) return;
			restyle(config.activeId);
			if (config.activeId !== lastActiveId) {
				lastActiveId = config.activeId;
				flyTo(ctx, config.activeId);
			}
		},

		destroy() {
			clickHandle?.remove();
			clickHandle = null;
			layer?.remove();
			layer = null;
			drawn = [];
			cfg = null;
		}
	};
}

/** Registry rule: active when a `markers` sub-config is present. */
export const markersRule = defineRule<MarkersConfig>({
	name: 'markers',
	applies: (config) => config.markers != null,
	select: (config) => config.markers!,
	create: createMarkersCapability
});
