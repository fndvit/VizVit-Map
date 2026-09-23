/**
 * @module globe/hover/hoverTypes
 * Shared types for the reusable hover tooltip overlay ({@link HoverTooltipOverlay}).
 *
 * `HoverResult` is the shape a host's resolver emits (structurally the explore
 * `HexHoverResult` and the scrolly hitTest result). `HoverInfo` augments it with
 * the resolved dot visuals the overlay tracks per hovered cell. `DotStyle` is
 * re-exported from {@link module:globe/hover/dotStylePrimitives} (single source
 * of truth) so the overlay and both hosts agree on the mirror-dot shape.
 *
 * Provider- AND domain-neutral (part of the packageable globe library): the
 * overlay carries the host's tier id and raw attributes without reading them,
 * and what a hovered cell *means* is the host's {@link TooltipMeaning} — an
 * intentionally empty interface the host fills by declaration merging (see
 * `globe/config`'s module note on keeping the library open yet strongly typed).
 */

export type { DotStyle } from './dotStylePrimitives.js';

/**
 * What a hovered cell means, in the host's own vocabulary — the value the
 * overlay resolves once per cell (via {@link TooltipConfig.meaning}) and hands
 * to the host's tooltip card snippet.
 *
 * Declared empty here on purpose: the globe library renders the card through a
 * snippet and never reads a single field of it, so it has nothing to say about
 * the shape. A host gives it one by **declaration merging**, which keeps the
 * card snippet strongly typed on both sides of the seam without making
 * `GlobeConfig` generic:
 *
 * ```ts
 * declare module '$lib/globe/hover/hoverTypes' {
 * 	interface TooltipMeaning extends CellMeaning {}
 * }
 * ```
 *
 * This site does exactly that in `$lib/site-globe/config` (the explore
 * `CellMeaning`; CONTEXT.md "cell meaning").
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- the host fills this by declaration merging; see the doc above
export interface TooltipMeaning {}

/**
 * A resolved hovered cell — what a host's `resolve` returns to the overlay.
 * Matches the explore `HexHoverResult` and the scrolly hitTest result.
 */
export type HoverResult = {
	/**
	 * The host's tier id for this cell (this site: an H3 {@link Resolution} such
	 * as `'r4'`). Typed as a plain `string` because the library never interprets
	 * it — it only carries it back to the host's `computeStyle`/`meaning`
	 * injectors. A host narrows it with an intersection alias
	 * (`HoverResult & { resolution: Resolution }`) rather than making every
	 * hover type generic.
	 */
	resolution: string;
	/** Raw feature attributes (v2 canonical keys) for the tooltip cards. */
	attributes: Record<string, unknown>;
	/** Dot centroid screen X. */
	dotScreenX: number;
	/** Dot centroid screen Y. */
	dotScreenY: number;
	/** Dot geographic latitude — for reprojection during camera movement. */
	dotLat: number;
	/** Dot geographic longitude. */
	dotLng: number;
	/** Land cell with no data row — tooltip shows the "No data" card. */
	noData?: boolean;
};

/**
 * The overlay's per-hover record: the resolved cell plus the mirror-dot visuals
 * (color/size/outline) computed via the host-injected `computeStyle`.
 */
export type HoverInfo = {
	/** The host's tier id — carried, never read (see {@link HoverResult.resolution}). */
	resolution: string;
	attributes: Record<string, unknown>;
	noData: boolean;
	dotScreenX?: number;
	dotScreenY?: number;
	dotColor?: string;
	/** The mirror dot's per-feature fill alpha (from {@link DotStyle.opacity}).
	 *  The overlay renders highlights solid by default but can carry this instead
	 *  when its `highlightOpacity` is `null`. */
	dotOpacity?: number;
	dotSize?: number;
	dotOutlineColor?: string;
	dotOutlineWidth?: number;
	dotKey?: string;
	dotLat?: number;
	dotLng?: number;
};

/**
 * The two render-time facts the overlay hands the card snippet alongside the
 * resolved {@link TooltipMeaning} — everything a card needs that is *not* what
 * the cell means.
 */
export type TooltipRender = {
	/**
	 * Suppresses `BaseTooltip`'s mount shimmer. Set on the leaving-tooltip clone
	 * so the exit animation fades the real content instead of a fresh skeleton;
	 * false for every live card, which always shimmers into its content
	 * (the overlay remounts the card per cell via `{#key hover.dotKey}`).
	 */
	skipShimmer: boolean;
	/**
	 * Land cell with no data row at all — the hover synthesized a marker so land
	 * reads differently from ocean. A fact about the *hover hit* (from
	 * {@link HoverResult.noData}), not about what the cell means, so it travels
	 * beside the meaning rather than inside it.
	 */
	noData: boolean;
};

/**
 * What the overlay hands the selection snippet beside the resolved
 * {@link TooltipMeaning} — the render-time facts about the selected cell.
 */
export type SelectionRender = {
	/** Land cell with no data row at all (see {@link TooltipRender.noData}). */
	noData: boolean;
	/** The selected cell's key, `null` when nothing is selected. Lets a host that
	 *  keeps its own per-cell state notice a change without remounting. */
	key: string | null;
};

/** Screen-space projector handed to {@link HoverTooltipOverlay.reproject}. */
export type ToScreen = (lat: number, lng: number) => { x: number; y: number } | null | undefined;

/**
 * The imperative API a host drives on the overlay via `bind:this`. Typed
 * explicitly so hosts can annotate their `$state` ref without depending on
 * Svelte's component-instance type inference.
 */
export interface HoverOverlayHandle {
	/** `onHover` — react to a resolved cell (or `null` on miss/leave). */
	applyHover(result: HoverResult | null): void;
	/**
	 * Select a cell (or clear the selection with `null`). Selection is the
	 * persistent counterpart of hover: the overlay styles the dot through the
	 * same `computeStyle`, keeps drawing and reprojecting it until the next
	 * `select`, resolves its meaning once and hands it to the `selectionCard`
	 * snippet. Hover events never touch it — a touch pan after a tap moves the
	 * hover dot, not the selection. A cell that draws no dot clears it.
	 */
	select(result: HoverResult | null): void;
	/** Reproject every overlay's screen position on camera move. */
	reproject(toScreen: ToScreen): void;
	/** Whether any overlay is currently on screen. */
	hasOverlays(): boolean;
}
