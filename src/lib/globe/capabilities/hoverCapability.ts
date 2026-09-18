/**
 * @module globe/capabilities/hover
 * Cursor feedback: toggles the view cursor between `pointer` (over a point-layer
 * item) and `grab` (was OurStoriesMap's pointer-move handler). The rich
 * data-cell hover (tooltip) is NOT here — that loop lives in the engine
 * ({@link MapEngine.hover}), with the strategy supplied by the `dataLayers`
 * capability and results piped to the overlay by `<Globe>`. This capability is
 * only the cursor affordance for globes that want it (markers / pins).
 *
 * Provider-neutral: hit-tests every live **point layer** through its handle
 * (`layers.all`) and sets the cursor through the `scene` port.
 */

import type { Handle, LayerHandle, PointLayerHandle } from '$lib/map-engine/provider.js';
import { defineRule, type Capability } from '../capability.js';
import type { HoverConfig } from '../config.js';

/**
 * Type guard: a layer handle is a point layer when it can hit-test.
 *
 * @param layer - Any live layer handle.
 * @returns True for {@link PointLayerHandle}s.
 */
function isPointLayer(layer: LayerHandle): layer is PointLayerHandle {
	return typeof (layer as PointLayerHandle).hitTest === 'function';
}

/**
 * Creates the `hover` (cursor) capability.
 *
 * @returns A fresh, unmounted capability instance.
 */
export function createHoverCapability(): Capability<HoverConfig> {
	/** Handle for the pointer-move listener; removed on destroy. */
	let moveHandle: Handle | null = null;

	return {
		name: 'hover',

		setup(ctx, config) {
			if (config.mode !== 'cursor') return;
			moveHandle = ctx.provider.events.on('pointer-move', async (event) => {
				const hits = await Promise.all(
					ctx.provider.layers.all.filter(isPointLayer).map((layer) => layer.hitTest(event))
				);
				const over = hits.some(Boolean);
				ctx.provider.scene.setCursor(over ? 'pointer' : 'grab');
			});
		},

		destroy() {
			moveHandle?.remove();
			moveHandle = null;
		}
	};
}

/** Registry rule: active when a `hover` sub-config is present. */
export const hoverRule = defineRule<HoverConfig>({
	name: 'hover',
	applies: (config) => config.hover != null,
	select: (config) => config.hover!,
	create: createHoverCapability
});
