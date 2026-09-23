/**
 * @module globe/config
 * The single declarative argument object every `<Globe>` takes.
 *
 * Clean Code Ch3 ("Argument Objects"): rather than a long prop list, the three
 * site globes (stories map, scrolly, explore) are configured by ONE
 * {@link GlobeConfig}. Clean Code Ch3 ("Flag Arguments are ugly"): a feature is
 * enabled by the PRESENCE of its sub-config object (`markers`, `hover`, …) — not
 * by a boolean flag plus a parallel field that could contradict it. The only
 * sanctioned boolean is `interactive`, which is one intrinsic property of the
 * view, not a feature with its own data.
 *
 * `GlobeConfig` is plain serializable data except the `on*` callbacks and the
 * {@link GlobeConfig.engine} / {@link GlobeConfig.capabilities} wiring (which a
 * host supplies once and never serializes).
 *
 * ## The neutral half
 *
 * This module is part of the **packageable globe library**: it describes only
 * features the library itself ships (basemap, camera, markers, pins, outlines,
 * hover, tooltip, animation, padding, quality, engine) and imports nothing from
 * `$lib/{config,explore,data,components}`. The NatGeo explore/story sub-configs
 * — `dataLayers`, `hexOverlay`, `validation` — live in the app's globe layer
 * (`$lib/site-globe/config`), because a published `<Globe>` cannot ship a
 * capability that imports the explore engine.
 *
 * ## How `GlobeConfig` stays open AND strongly typed
 *
 * A host registers its own capabilities through
 * {@link GlobeConfig.capabilities}, so `GlobeConfig` must be able to carry
 * sub-configs this module has never heard of. Three ways were on the table:
 *
 * 1. an **index signature** (`[key: string]: unknown`) — open, but it silently
 *    accepts every typo and erases excess-property checking for the whole
 *    object, including `markers`;
 * 2. a **generic parameter** (`GlobeConfig<TExtra>`) — type-safe, but viral: it
 *    would infect `CapabilityRule`, `Capability`, the registry, `<Globe>`'s
 *    props and every call site, for a value nobody reads generically;
 * 3. **declaration merging** — the host augments this interface once.
 *
 * (3) wins, and is what this site uses. `markers`, `pins` and friends keep their
 * exact declared types and their excess-property checks; a host-declared
 * `dataLayers` gets the same treatment from its own module:
 *
 * ```ts
 * // $lib/site-globe/config.ts
 * declare module '$lib/globe/config' {
 * 	interface GlobeConfig {
 * 		dataLayers?: DataLayersConfig;
 * 	}
 * }
 * ```
 *
 * It is also the idiom the surrounding ecosystem already uses for exactly this
 * shape of problem (SvelteKit's `App.Locals`, Vite's `ImportMetaEnv`), so it
 * needs no explanation to a consumer. The one cost — the augmentation is global
 * to the TypeScript program that declares it — is a non-issue for an app, which
 * has exactly one globe layer. Published from a package the module specifier
 * becomes the package subpath instead of the `$lib` alias; nothing else changes.
 *
 * The same mechanism keeps the tooltip card typed across the seam: see
 * {@link TooltipMeaning} in `./hover/hoverTypes`.
 */

import type {
	SceneCamera,
	FlatColors,
	FlyToOptions,
	ViewMode,
	QualityProfile,
	BasemapCatalog,
	ProviderKind
} from '$lib/map-engine/index.js';
import type { CapabilityRule } from './capability.js';
import type {
	HoverResult,
	DotStyle,
	HoverOverlayHandle,
	TooltipMeaning
} from './hover/hoverTypes.js';

/** Named camera-animation profiles — replaces the three hardcoded durations (1800/1500/1200ms). */
export const ANIMATION_PRESETS = {
	/** OurStoriesMap fly-to-story. */
	storySelect: { duration: 1800, easing: 'ease-in-out' },
	/** StoryMapScrolly per-step camera transition. */
	scrolly: { duration: 1500, easing: 'ease-in-out' },
	/** ExploreGlobe basemap/preset fly. */
	explore: { duration: 1200, easing: 'ease-in-out' },
	/** Live slider drag in the Globe Configurator. */
	configurator: { duration: 300, easing: 'ease-in-out' }
} as const satisfies Record<string, FlyToOptions>;

/** A named preset key or an inline animation spec. */
export type AnimationConfig = keyof typeof ANIMATION_PRESETS | FlyToOptions;

// NOTE: a `GlobeConfig` has no responsive branch and no breakpoint vocabulary
// of its own. Per-breakpoint overrides are authored on the STEP and resolved by
// the story step resolver (`$lib/site-globe/presets/storyGlobeResolver`), which
// hands `<Globe>` one already-resolved config; `ResponsiveBreakpoint` therefore
// lives with the step types (`$lib/site-globe/storyStepConfig`), which is where
// every caller — the resolver, the scrolly and the configurator — already
// imports it from.

/** Basemap + background + label configuration for the view. */
export interface BasemapConfig {
	/** Registry basemap id (e.g. `'flat-natgeo'`, `'gray'`, `'natgeo-soils'`). */
	id: string;
	/** Custom land/ocean colors for flat presets. */
	customColors?: FlatColors;
	/**
	 * Scene background: `'transparent'` or a hex color (3D). This is the space
	 * AROUND the globe sphere (the sky/void), not the sphere itself — `'transparent'`
	 * lets the globe composite over the page. For the sphere's own surface see
	 * {@link BasemapConfig.groundColor}.
	 */
	background?: string;
	/**
	 * Ground (sphere) surface color as a hex string (3D). Fully independent of
	 * `background` (the space around the sphere) — never inferred from it. Set an
	 * opaque light color so draped portal basemaps (e.g. NatGeo Soils) don't show
	 * the black globe interior as dark land; a transparent-background globe
	 * (scrolly) can still request an opaque ground. Default: a see-through surface.
	 */
	groundColor?: string;
	/**
	 * Ask the host's basemap catalog to decorate each applied basemap with a
	 * label overlay (`BasemapCatalog.decorate`'s `labelOverlay` option).
	 *
	 * A label stack with its own lifecycle — layers to build, fonts to load,
	 * sizes to re-bake on zoom — is better modelled as a host **capability**
	 * (one sub-config, one rule; see `docs/capabilities.md`) than as a flag the
	 * catalog re-applies on every basemap swap. This option stays for hosts whose
	 * decoration really is a per-basemap tweak.
	 */
	labelOverlay?: boolean;
}

/** A geo-anchored marker (OurStoriesMap diamonds). */
export interface MarkerItem {
	id: string;
	lon: number;
	lat: number;
}

/** `markers` capability config — interactive symbols with click-to-select. */
export interface MarkersConfig {
	items: MarkerItem[];
	/** Marker shape. Default `'diamond'`. */
	symbol?: 'diamond' | 'circle';
	/** Id of the currently active (highlighted) marker. */
	activeId?: string;
	/** Id to omit from rendering (e.g. the story currently being viewed). */
	excludeId?: string;
	/** Id of the "you are here" marker — rendered as a non-clickable white diamond. */
	currentId?: string;
	/** Called with the marker id when the user clicks one. */
	onSelect?: (id: string) => void;
	/** Camera animation used when flying to a selected marker. */
	flyOnSelect?: AnimationConfig;
}

/** A geo-anchored pin to project to screen pixels each frame. */
export interface PinItem {
	id: string;
	lon: number;
	lat: number;
}

/** A pin projected to screen-space. */
export interface ProjectedPin {
	id: string;
	x: number;
	y: number;
	visible: boolean;
}

/** `pins` capability config — geo-anchored overlay pins. */
export interface PinsConfig {
	items: PinItem[];
	/** Called with projected screen positions whenever the camera/view changes. */
	onProjected: (pins: ProjectedPin[]) => void;
}

/**
 * `hover` capability config — the cursor affordance only (toggles the view cursor
 * between `pointer` over a graphic and `grab`). The rich data-cell hover (tooltip)
 * is NOT here: that loop lives in the engine (`MapEngine.hover`), fed a strategy by
 * a host's data-layer capability and piped to the overlay by `<Globe>`.
 */
export interface HoverConfig {
	mode: 'cursor';
}

/**
 * `tooltip` config — presence mounts the reusable hex-hover overlay INSIDE
 * `<Globe>` (a positioned layer over the canvas). `<Globe>` pipes the engine's
 * hover results (`MapEngine.hover.onHover`) into that overlay; the strategy that
 * produces them comes from the host's data-layer capability. The host injects
 * only the presentation that differs between maps (mirror-dot style, what the
 * hovered cell means, timing); `<Globe>` owns the overlay lifecycle,
 * container-dims, and camera reprojection. The tooltip CARD itself is a separate
 * `tooltipCard` snippet on `<Globe>`.
 *
 * NOTE: presentation, not a capability — it has no registry rule.
 */
export interface TooltipConfig {
	/** Mirror-dot visual for a resolved cell (mirrors the host's renderer math). */
	computeStyle: (r: HoverResult) => DotStyle;
	/**
	 * What the hovered cell means, in the host's vocabulary — resolved ONCE per
	 * cell by the overlay and handed to the `tooltipCard` snippet.
	 *
	 * This is the whole semantic seam. The library resolves nothing itself: on
	 * this site the injector projects the cell's **render plan** (the same
	 * resolution the renderer and the mirror dot are projections of, so the card
	 * cannot describe a cell differently from the dot it points at) together with
	 * the host's crop colours into a `CellMeaning` — see
	 * `$lib/site-globe/hover/cellMeaningSource`. `null` → the host draws nothing
	 * for this cell (a step with no selection), so no card.
	 *
	 * It is called inside the overlay's `$derived`, so a host closure that reads
	 * reactive state (the live selection, a dev-panel palette edit) re-resolves
	 * the card under a resting cursor exactly as before.
	 */
	meaning: (r: HoverResult) => TooltipMeaning | null;
	/** Tooltip clamp paddings within the container. */
	padding?: { top?: number; bottom?: number; x?: number };
	/** Tooltip card width used for clamping. Default 277. */
	cardWidth?: number;
	/** Animation timings (all optional; the overlay supplies defaults). */
	timing?: {
		tooltipDelay?: number;
		leaveDuration?: number;
		ringDuration?: number;
		tooltipLeaveDuration?: number;
	};
	/**
	 * Over-a-dot cursor-state change. The globe already switches the map's
	 * cursor itself; this is for a host that wants to mirror the state elsewhere.
	 */
	onCursorChange?: (cursor: boolean) => void;
	/** Pointer-leave companion (host cache clear). Runs AFTER the overlay's onHover(null). */
	onLeave?: () => void;
	/** Receives the overlay handle once mounted (the host drives `applyHover` for taps, `select` for selection). */
	onReady?: (handle: HoverOverlayHandle) => void;
}

/**
 * A single stroke-only region boundary drawn from GeoJSON.
 *
 * Story-agnostic: the engine takes a resolved `src` URL (the story layer resolves
 * a named `key` via `REGION_OUTLINE_SOURCES`), so any globe can draw any outline.
 */
export interface OutlineConfig {
	/**
	 * Stable identity (the source key) — lets the `outlines` capability diff
	 * mount/unmount across updates and fade each boundary independently.
	 */
	id: string;
	/** URL of the GeoJSON polygon(s) (e.g. `'/stories/brazil/cerrado.geojson'`). */
	src: string;
	/** Whether the outline is shown — drives the fade. Default `false`. */
	visible?: boolean;
	/** Stroke color. Default `'#000000'`. */
	color?: string;
	/** Stroke width in px. Default `1.5`. */
	width?: number;
}

/**
 * The one argument object the `<Globe>` component takes.
 *
 * Core view fields are always meaningful; every other field is an OPTIONAL
 * capability whose presence enables it. Host-declared capabilities add their own
 * optional fields by augmenting this interface (see the module doc).
 */
export interface GlobeConfig {
	// ── Core view ────────────────────────────────────────────────
	/**
	 * Engine wiring: which provider renders the view and how the app's basemap
	 * ids resolve. Omit for the ArcGIS default with pass-through ids.
	 *
	 * Every globe on this site passes `NATGEO_ENGINE` (`$lib/config/map`), which
	 * bundles the ArcGIS provider, the NatGeo basemap catalog and the portal
	 * request proxy.
	 */
	engine?: {
		/** Which map SDK renders the view. Default `'arcgis'`. */
		provider?: ProviderKind;
		/** Resolves this app's basemap ids to provider-neutral specs. */
		basemaps?: BasemapCatalog;
		/** Ran once before the first basemap fetch (e.g. installing a request proxy). */
		onInit?: () => Promise<void> | void;
	};
	/**
	 * The capability rule set `<Globe>` resolves this config against — the second
	 * half of the OCP seam. Omit for the library's neutral set
	 * (`DEFAULT_CAPABILITY_RULES`: markers, hover, pins, outlines); pass a host
	 * set to add domain-bound capabilities a published library cannot ship.
	 *
	 * This site passes `SITE_CAPABILITY_RULES` (`$lib/site-globe/rules`), which
	 * is the neutral set plus `dataLayers`, `hexOverlay` and `validation`.
	 *
	 * Wiring, like {@link GlobeConfig.engine}: supply one stable array (a module
	 * constant), not a fresh literal per render — `<Globe>` resolves capability
	 * presence once, at view-ready.
	 */
	capabilities?: CapabilityRule[];
	/** `'3d'` globe (default) or `'2d'` flat map. */
	mode?: ViewMode;
	/**
	 * Basemap + background + label config. Required — a view needs a basemap, so
	 * omitting it throws in {@link MapEngine} (via `<MapCanvas>`) rather than
	 * silently defaulting. Every globe builder supplies one.
	 */
	basemap: BasemapConfig;
	/** Initial + reactive camera target (3D). */
	camera?: SceneCamera;
	/** Initial center `[lng, lat]` (2D). */
	center?: [number, number];
	/** Initial zoom (2D). */
	zoom?: number;
	/** Allow user pan/zoom/rotate. The one sanctioned boolean (see module note). */
	interactive?: boolean;
	/** Lock the globe to a fixed altitude range (3D). */
	altitudeConstraint?: { min: number; max: number };
	/** SceneView render quality (3D). Defaults to `'medium'`; decorative globes pass `'low'` to cut GPU memory. */
	qualityProfile?: QualityProfile;
	/**
	 * Cap the SceneView render pixel ratio (3D). Pass a value below 1 (e.g. `0.6`)
	 * on memory-constrained (mobile) devices to render sub-natively and shrink the
	 * WebGL framebuffer. Omit on desktop.
	 */
	maxPixelRatio?: number;
	/** Camera transition profile for reactive camera moves. */
	animation?: AnimationConfig;
	/**
	 * SceneView padding (shifts the view center within its container). Tweened
	 * alongside the camera on reactive moves (scrolly). The configurator drives
	 * padding imperatively via {@link GlobeApi.setPadding} instead.
	 */
	padding?: { top: number; right: number; bottom: number; left: number };

	// ── Optional capabilities — PRESENCE = ENABLED ───────────────
	markers?: MarkersConfig;
	pins?: PinsConfig;
	hover?: HoverConfig;
	tooltip?: TooltipConfig;
	/** `outlines` capability config — one stroke-only region boundary per entry. */
	outlines?: OutlineConfig[];
}

/** Resolves an {@link AnimationConfig} to concrete {@link FlyToOptions}. */
export function resolveAnimation(animation: AnimationConfig | undefined): FlyToOptions | undefined {
	if (!animation) return undefined;
	if (typeof animation === 'string') return ANIMATION_PRESETS[animation];
	return animation;
}
