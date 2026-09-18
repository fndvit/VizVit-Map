<!--
	@component Globe

	The one config-driven globe used across the site. Renders a {@link MapCanvas}
	(which owns the {@link MapEngine} lifecycle), then mounts the capabilities the
	{@link GlobeConfig} enables. A feature is active iff its sub-config is present
	(Clean Code Ch3: no flag arguments). New view features are added via a
	capability + one registry rule — never by editing this component (Ch10: OCP).
	Which rules are in play is the host's call: `config.capabilities` (defaulting
	to the library's neutral set), so a published `<Globe>` need not ship a
	domain-bound capability to let one exist.

	The ONE presentation feature that lives here (not as a capability, since
	capabilities only touch the map view and can't render DOM) is the hover
	tooltip: when `config.tooltip` is present, Globe mounts the shared
	{@link HoverTooltipOverlay} in a positioned stage over the canvas, auto-wires
	the `hover` capability from it, owns container-dims + camera reprojection, and
	renders the host's tooltip card via the `tooltipCard` snippet. Host-owned
	extras (loaders, gradients, dev panels, pinned dots) render in the same stage
	via the `children` snippet so they share the overlay's stacking context.

	@prop {GlobeConfig} config - The single declarative argument object.
	@prop {(api: GlobeApi) => void} [onready] - Imperative camera handle, once the view is ready.
	@prop {(ctx: GlobeContext) => void} [oncontext] - Escape hatch for advanced consumers (e.g. ExploreGlobe) that drive their own reactive orchestration against the live view. The context hands them the provider-neutral ports (`ctx.provider.camera` / `.screen` / `.events` / `.scene` / `.layers`) and, for genuinely SDK-bound work, the typed escape hatch `ctx.provider.native('arcgis')`. Called once the view is ready, after capabilities are set up.
	@prop {(coords: { lon: number; lat: number }) => void} [onclick] - Map click in lon/lat.
	@prop {(readout: CameraReadout) => void} [oncamerachange] - Live camera state (3D).
	@prop {(error: unknown) => void} [onerror] - View initialization failed.
	@prop {string} [class] - Extra classes on the outer container.
	@prop {Snippet<[TooltipMeaning, TooltipRender]>} [tooltipCard] - Renders the tooltip card for the resolved hovered cell (paired with config.tooltip).
	@prop {Snippet} [children] - Host overlays rendered in the globe stage (share the overlay's stacking context).
-->
<script lang="ts">
	import { onDestroy, type Snippet } from 'svelte';
	import MapCanvas from './MapCanvas.svelte';
	import type { MapEngine, CameraReadout } from '$lib/map-engine/index.js';
	import type { GlobeConfig } from './config.js';
	import { resolveAnimation } from './config.js';
	import type { GlobeContext } from './capability.js';
	import { buildGlobeContext } from './context.js';
	import { mapConfigToCapabilities, type ResolvedCapability } from './registry.js';
	import { makeGlobeApi, type GlobeApi } from './api.js';
	import HoverTooltipOverlay from './hover/HoverTooltipOverlay.svelte';
	import type {
		HoverResult,
		HoverOverlayHandle,
		TooltipMeaning,
		TooltipRender
	} from './hover/hoverTypes.js';

	let {
		config,
		onready,
		oncontext,
		onclick,
		oncamerachange,
		onerror,
		class: className = '',
		tooltipCard,
		children
	}: {
		config: GlobeConfig;
		onready?: (api: GlobeApi) => void;
		oncontext?: (ctx: GlobeContext) => void;
		onclick?: (coords: { lon: number; lat: number }) => void;
		oncamerachange?: (readout: CameraReadout) => void;
		onerror?: (error: unknown) => void;
		class?: string;
		tooltipCard?: Snippet<[TooltipMeaning, TooltipRender]>;
		children?: Snippet;
	} = $props();

	let ctx: GlobeContext | null = null;
	let caps = $state<ResolvedCapability[]>([]);

	// ── Tooltip overlay (presentation, driven by config.tooltip) ──────
	let overlay = $state<HoverOverlayHandle | null>(null);
	let containerW = $state(0);
	let containerH = $state(0);
	let reprojectHandle: { remove(): void } | null = null;

	async function handleReady(engine: MapEngine) {
		ctx = buildGlobeContext(engine);
		// A capability that declares `requires` is refused on the wrong provider.
		// Surface that wiring bug through the existing error channel rather than
		// rejecting an unhandled promise inside <MapCanvas>'s onready.
		let resolved: ResolvedCapability[];
		try {
			resolved = mapConfigToCapabilities(config, engine.kind);
		} catch (err) {
			onerror?.(err);
			return;
		}
		// Set up every enabled capability against the ready view, then publish the
		// list so the reactive update effect can drive them. The `dataLayers`
		// capability registers the hover STRATEGY on `engine.hover` here.
		//
		// Guarded: this function is invoked from `<MapCanvas>`'s `onready` without
		// being awaited, so a throwing `setup` would reject a floating promise —
		// the mount would abort silently, `oncontext` would never fire, and the
		// host would see an empty globe with nothing in the console.
		try {
			for (const rc of resolved) {
				await rc.capability.setup(ctx, rc.select(config));
			}
		} catch (err) {
			onerror?.(err);
			return;
		}
		caps = resolved;

		// Presentation: pipe the engine's generic hover loop into the overlay. The
		// engine owns the pointer→resolve→emit loop; the data-layer capability
		// supplies the strategy; Globe owns the DOM overlay, so it consumes results.
		if (config.tooltip) {
			engine.hover?.onHover((r) => overlay?.applyHover(r as HoverResult | null));
			engine.hover?.onLeave(() => config.tooltip!.onLeave?.());

			// Globe owns overlay reprojection: keep the hovered dot / rings / leaving
			// trails glued to their cells as the camera moves. Gated on hasOverlays()
			// so plain pan/zoom pays nothing.
			reprojectHandle = ctx.provider.events.on('camera', () => {
				if (!overlay?.hasOverlays()) return;
				overlay.reproject((lat, lng) => ctx!.provider.screen.toScreen({ lng, lat }));
			});
			config.tooltip.onReady?.(overlay!);
		}

		onready?.(makeGlobeApi(engine));
		oncontext?.(ctx);
	}

	// Re-apply capabilities on reactive config changes.
	//
	// The reactive reads (`caps`, `config`) MUST happen before the `ctx` guard:
	// `ctx` is assigned asynchronously in handleReady (after the view is ready), so
	// on this effect's first run ctx is null. If we returned before touching them,
	// the effect would subscribe to nothing and never re-run — capability.update()
	// would then never fire on selection/active changes. The `caps` assignment in
	// handleReady (a $state write) re-runs this once the view is up.
	$effect(() => {
		const activeCaps = caps;
		const currentConfig = config;
		if (!ctx) return;
		for (const rc of activeCaps) rc.capability.update?.(ctx, rc.select(currentConfig));
	});

	// Camera fly options, with padding folded in so it tweens with the camera
	// (scrolly). The configurator sets padding imperatively via the GlobeApi.
	const flyToOptions = $derived.by(() => {
		const animation = resolveAnimation(config.animation);
		if (!config.padding) return animation;
		return { ...animation, padding: config.padding };
	});

	onDestroy(() => {
		reprojectHandle?.remove();
		reprojectHandle = null;
		for (const rc of caps) rc.capability.destroy?.();
		caps = [];
		ctx = null;
	});
</script>

<div class={className}>
	<!-- Globe stage: the positioned stacking context shared by the canvas, the
	     tooltip overlay (z-[3..7]), and any host `children` overlays. -->
	<div
		class="relative isolate h-full w-full"
		bind:clientWidth={containerW}
		bind:clientHeight={containerH}
	>
		<MapCanvas
			mode={config.mode}
			provider={config.engine?.provider}
			basemaps={config.engine?.basemaps}
			onInit={config.engine?.onInit}
			basemap={config.basemap.id}
			basemapColors={config.basemap.customColors}
			labelOverlay={config.basemap.labelOverlay}
			background={config.basemap.background}
			groundColor={config.basemap.groundColor}
			interactive={config.interactive}
			camera={config.camera}
			center={config.center}
			zoom={config.zoom}
			altitudeConstraint={config.altitudeConstraint}
			qualityProfile={config.qualityProfile}
			maxPixelRatio={config.maxPixelRatio}
			{flyToOptions}
			{onclick}
			{oncamerachange}
			{onerror}
			class="absolute inset-0 h-full w-full"
			onready={handleReady}
		/>

		{#if config.tooltip}
			<HoverTooltipOverlay
				bind:this={overlay}
				computeStyle={config.tooltip.computeStyle}
				meaning={config.tooltip.meaning}
				card={tooltipCard}
				{containerW}
				{containerH}
				padTop={config.tooltip.padding?.top ?? 0}
				padBottom={config.tooltip.padding?.bottom ?? 0}
				padX={config.tooltip.padding?.x ?? 20}
				tooltipWidth={config.tooltip.cardWidth ?? 277}
				onCursorChange={config.tooltip.onCursorChange}
				tooltipDelay={config.tooltip.timing?.tooltipDelay}
				leaveDuration={config.tooltip.timing?.leaveDuration}
				ringDuration={config.tooltip.timing?.ringDuration}
				tooltipLeaveDuration={config.tooltip.timing?.tooltipLeaveDuration}
			/>
		{/if}

		{@render children?.()}
	</div>
</div>
