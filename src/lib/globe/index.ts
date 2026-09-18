/**
 * @module globe
 * The config-driven globe library. Import everything through this barrel:
 *
 * ```ts
 * import Globe, { type GlobeConfig, ANIMATION_PRESETS } from '$lib/globe/index.js';
 * ```
 *
 * One `<Globe>` component, configured by one {@link GlobeConfig}; each feature is
 * a {@link Capability} enabled by the presence of its sub-config.
 *
 * This is the **provider-neutral, packageable** half of the globe layer: it
 * imports the map engine and nothing else from the app. The NatGeo explore/story
 * half — the `dataLayers` / `hexOverlay` / `validation` capabilities, their
 * sub-config types, the story step document and the four site globes' preset
 * builders — lives in `$lib/site-globe`, and reaches `<Globe>` through
 * {@link GlobeConfig.capabilities} plus declaration merging on `GlobeConfig`.
 *
 * NOTE (project rule): leaf UI components deep-import the module they need
 * (`$lib/globe/hover/hoverTypes`, …) rather than this barrel — the barrel's
 * dependency graph OOMs Storybook CI.
 */

export { default as Globe } from './Globe.svelte';
export { default as MapCanvas } from './MapCanvas.svelte';
export {
	ANIMATION_PRESETS,
	resolveAnimation,
	type GlobeConfig,
	type AnimationConfig,
	type BasemapConfig,
	type MarkersConfig,
	type MarkerItem,
	type PinsConfig,
	type PinItem,
	type ProjectedPin,
	type HoverConfig,
	type TooltipConfig,
	type OutlineConfig
} from './config.js';
export type {
	DotStyle,
	HoverInfo,
	HoverOverlayHandle,
	HoverResult,
	ToScreen,
	TooltipMeaning,
	TooltipRender
} from './hover/hoverTypes.js';
export { setupPinProjection, type PinProjection } from './pinProjection.js';
export type { Capability, GlobeContext } from './capability.js';
export { buildGlobeContext } from './context.js';
export {
	mapConfigToCapabilities,
	defineRule,
	DEFAULT_CAPABILITY_RULES,
	type CapabilityRule,
	type ResolvedCapability
} from './registry.js';
export { makeGlobeApi, type GlobeApi } from './api.js';
