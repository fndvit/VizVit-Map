<!--
  @component HoverTooltipOverlay

  The reusable hex-hover overlay, extracted from ExploreGlobe so any map that
  renders H3 dots can get the same feedback: an animated dot mirror over the
  hovered dot, an expanding pulse ring, shrinking leaving-dot trails, and a
  dwell-gated rich tooltip card (with a fading leaving clone).

  The component owns ONLY the animation state machine + overlay DOM. Each host
  injects the pieces that differ:
  - `computeStyle(result)` — mirrors that map's renderer so the overlay dot
    matches the rendered dot (explore: `computeDotStyle`; scrolly: story style).
  - `meaning(result)` — what the hovered cell means, in the host's own
    vocabulary (this site: one `CellMeaning` projected from the cell's render
    plan). The overlay resolves it once per cell and hands it to the card; it
    reads no field of it, which is what keeps this component domain-free.
  and drives it imperatively (via `bind:this`) from the `hover` capability's
  `onHover`/`onLeave` callbacks and its own camera watcher (`reproject`).

  Renders as a fragment (no wrapper element) so, dropped into the globe stage,
  its layers stack by the stage's `--vit-map-z-*` ladder (see hoverOverlay.css,
  which also places every element — this component ships no utility classes).

  @prop {(r: HoverResult) => DotStyle} computeStyle - Mirror-dot visual for a resolved cell.
  @prop {(r: HoverResult) => TooltipMeaning | null} meaning - What the hovered cell means (host-injected); null → the host draws nothing for it, so no card.
  @prop {Snippet<[TooltipMeaning, TooltipRender]>} [card] - Renders the tooltip card for a resolved cell (host-injected).
  @prop {Snippet<[TooltipMeaning | null, SelectionRender]>} [selectionCard] - Renders the selected cell; mounted once, updated in place.
  @prop {number} containerW - Host container width (for tooltip clamping).
  @prop {number} containerH - Host container height (for tooltip clamping).
  @prop {number} [padTop] - Top clamp padding (clears host chrome). Default 0.
  @prop {number} [padBottom] - Bottom clamp padding. Default 0.
  @prop {number} [padX] - Horizontal clamp padding. Default 20.
  @prop {number} [tooltipWidth] - Tooltip card width used for clamping. Default 277.
  @prop {(cursor: boolean) => void} [onCursorChange] - Fired when the over-a-dot cursor state changes.
  @prop {number} [tooltipDelay] - Dwell before the tooltip appears (ms). Default 350.
  @prop {number} [leaveDuration] - Leaving-dot shrink duration (ms). Default 500.
  @prop {number} [ringDuration] - Pulse-ring duration (ms). Default 1200.
  @prop {number} [tooltipLeaveDuration] - Leaving-tooltip fade duration (ms). Default 200.
-->
<script lang="ts">
	import { anchor } from '@vit-foundation/ui/overlay';
	import { onDestroy, type Snippet } from 'svelte';
	import type {
		HoverInfo,
		HoverResult,
		DotStyle,
		ToScreen,
		SelectionRender,
		TooltipMeaning,
		TooltipRender
	} from './hoverTypes.js';
	import './hoverOverlay.css';

	type Props = {
		computeStyle: (r: HoverResult) => DotStyle;
		/** What the hovered cell means, in the host's vocabulary (see {@link TooltipMeaning}). */
		meaning: (r: HoverResult) => TooltipMeaning | null;
		/** Renders the tooltip card for a resolved cell meaning — host-injected so
		 *  the overlay isn't coupled to any one card component. */
		card?: Snippet<[TooltipMeaning, TooltipRender]>;
		/** Renders the SELECTED cell — rendered once and updated in place (a
		 *  `null` meaning while nothing is selected), never remounted per cell,
		 *  because a selection surface (a sheet, a pinned panel) must not flicker
		 *  between selections the way a pointer-following card may. */
		selectionCard?: Snippet<[TooltipMeaning | null, SelectionRender]>;
		containerW: number;
		containerH: number;
		padTop?: number;
		padBottom?: number;
		padX?: number;
		tooltipWidth?: number;
		onCursorChange?: (cursor: boolean) => void;
		tooltipDelay?: number;
		leaveDuration?: number;
		ringDuration?: number;
		tooltipLeaveDuration?: number;
		/** Fill opacity for the highlight (hover + selected) dots. Defaults to 1 —
		 *  the highlight is drawn fully solid so it stays visible regardless of the
		 *  cell's per-feature transparency (e.g. the percent-opacity encoding). A
		 *  number pins every highlight to that flat opacity; `null` makes the
		 *  highlight instead carry the dot's actual per-feature alpha. */
		highlightOpacity?: number | null;
	};

	let {
		computeStyle,
		meaning,
		card,
		selectionCard,
		containerW,
		containerH,
		padTop = 0,
		padBottom = 0,
		padX = 20,
		tooltipWidth = 277,
		onCursorChange,
		tooltipDelay = 175,
		leaveDuration = 250,
		ringDuration = 600,
		tooltipLeaveDuration = 100,
		highlightOpacity = 1
	}: Props = $props();

	/** Resolves a highlight dot's fill opacity: the flat `highlightOpacity` when
	 *  set, else the dot's actual per-feature alpha (`highlightOpacity === null`). */
	const resolveOpacity = (dotOpacity: number | undefined): number =>
		highlightOpacity ?? dotOpacity ?? 1;

	let hover = $state<HoverInfo | null>(null);
	// The selected cell — the persistent counterpart of `hover`: set by `select`,
	// untouched by hover events, drawn as the pinned dot and reprojected with the
	// rest of the overlay under one camera watcher.
	let selected = $state<HoverInfo | null>(null);
	// The selected cell's key — the ring/hover-dot for it is skipped (it's already
	// drawn as the pinned dot).
	const selectedDotKey = $derived(selected?.dotKey);
	// Current tooltip card height — updated via bind:clientHeight; 300 is the fallback.
	let tooltipElH = $state(300);

	/**
	 * Computes CSS left/top for the tooltip so it stays within the container.
	 *
	 * The arithmetic is `anchor` from `@vit-foundation/ui/overlay`, not a local
	 * copy: "place a card beside a point and keep it inside its container" was
	 * implemented here and again in a chart, differently, and neither copy was
	 * testable because both could only run inside a live layout. This overlay is
	 * one of its two adapters; the sizes and paddings it passes are unchanged, so
	 * the placement is identical to the version that lived here.
	 *
	 * @param dotX - The dot's x in container coordinates.
	 * @param dotY - The dot's y in container coordinates.
	 * @param h - The card's measured height, or the fallback before it is known.
	 * @returns The `left` / `top` to position the card at, in px.
	 */
	function tooltipPos(dotX: number, dotY: number, h: number): { left: number; top: number } {
		return anchor(
			{ x: dotX, y: dotY },
			{ width: tooltipWidth, height: h },
			{ width: containerW, height: containerH },
			{
				offset: { x: 16 },
				align: 'center',
				padding: { left: padX, right: padX, top: padTop, bottom: padBottom }
			}
		);
	}

	// Dots animating out (shrinking) — supports multiple simultaneous trails so
	// fast cursor sweeps show all dots smoothly shrinking.
	type LeavingDot = HoverInfo & { _id: number };
	let leavingDots = $state<LeavingDot[]>([]);
	let leavingIdCounter = 0;

	// Tooltip dwell delay — tooltip only appears after the cursor lingers on a
	// dot; the dot animation + ring still fire immediately for visual feedback.
	let tooltipVisible = $state(false);
	let tooltipTimer: ReturnType<typeof setTimeout> | undefined;

	// Leaving tooltip — fades out + slides down before removal. Snapshots the
	// resolved meaning so the exit animation shows the same rich card (rendered
	// with `skipShimmer` so the clone doesn't re-skeleton).
	type LeavingTooltip = {
		dotX: number;
		dotY: number;
		dotLat: number;
		dotLng: number;
		meaning: TooltipMeaning;
		noData: boolean;
		_id: number;
	};
	let leavingTooltip = $state<LeavingTooltip | null>(null);
	let leavingTooltipTimer: ReturnType<typeof setTimeout> | undefined;

	// Pulse rings — tracked independently so they always finish their animation
	// even if hover clears before the ring completes.
	type ActiveRing = {
		_id: number;
		x: number;
		y: number;
		size: number;
		color: string;
		lat: number;
		lng: number;
	};
	let activeRings = $state<ActiveRing[]>([]);
	let ringIdCounter = 0;

	/**
	 * What the hovered cell means — resolved ONCE per cell, here, above the card
	 * boundary (the card remounts per cell via `{#key hover.dotKey}`, so it must
	 * derive nothing itself). Null when nothing is hovered, or when the host's
	 * injector declines this cell (nothing is drawn for its tier).
	 *
	 * The leaving-tooltip snapshot reads this same value rather than re-resolving,
	 * so one hovered cell costs exactly one {@link Props.meaning} call. Being a
	 * `$derived`, it re-runs whenever the reactive state the host's injector reads
	 * changes under a resting cursor (a selection change, a dev-panel palette
	 * edit) — which is precisely when the card must say something new.
	 */
	const tooltipMeaning = $derived.by<TooltipMeaning | null>(() => {
		if (!hover) return null;
		return meaning({
			resolution: hover.resolution,
			attributes: hover.attributes,
			dotScreenX: hover.dotScreenX ?? 0,
			dotScreenY: hover.dotScreenY ?? 0,
			dotLat: hover.dotLat ?? 0,
			dotLng: hover.dotLng ?? 0,
			noData: hover.noData
		});
	});

	/**
	 * What the SELECTED cell means — resolved once per selection, the same way
	 * {@link tooltipMeaning} is for the hover, and handed to `selectionCard`.
	 * `null` while nothing is selected, so the host's selection surface stays
	 * mounted and empties rather than unmounting.
	 */
	const selectedMeaning = $derived.by<TooltipMeaning | null>(() => {
		if (!selected) return null;
		return meaning({
			resolution: selected.resolution,
			attributes: selected.attributes,
			dotScreenX: selected.dotScreenX ?? 0,
			dotScreenY: selected.dotScreenY ?? 0,
			dotLat: selected.dotLat ?? 0,
			dotLng: selected.dotLng ?? 0,
			noData: selected.noData
		});
	});

	// Adds the current hover dot to the leaving trail. Each dot shrinks
	// independently and is removed after `leaveDuration`.
	function startLeaveAnimation() {
		if (hover?.dotScreenX != null && hover.dotColor && hover.dotSize) {
			const id = ++leavingIdCounter;
			leavingDots = [...leavingDots, { ...hover, _id: id }];
			setTimeout(() => {
				leavingDots = leavingDots.filter((d) => d._id !== id);
			}, leaveDuration);
		}
	}

	// Starts the tooltip exit animation if currently visible.
	function hideTooltip() {
		// Named `snapshot`, not `meaning` — the prop of that name is the injector.
		const snapshot = tooltipMeaning;
		if (
			tooltipVisible &&
			hover &&
			snapshot &&
			hover.dotScreenX != null &&
			hover.dotScreenY != null
		) {
			clearTimeout(leavingTooltipTimer);
			leavingTooltip = {
				dotX: hover.dotScreenX,
				dotY: hover.dotScreenY,
				dotLat: hover.dotLat!,
				dotLng: hover.dotLng!,
				meaning: snapshot,
				noData: hover.noData,
				_id: ++leavingIdCounter
			};
			leavingTooltipTimer = setTimeout(() => {
				leavingTooltip = null;
			}, tooltipLeaveDuration);
		}
		tooltipVisible = false;
		clearTimeout(tooltipTimer);
	}

	/**
	 * Reacts to a resolved hover cell (or `null` on miss/leave). Mirrors the
	 * rendered dot via the injected `computeStyle`, spawns a pulse ring on a new
	 * dot, and starts the tooltip dwell timer. The `hover` capability's `onHover`.
	 */
	export function applyHover(result: HoverResult | null) {
		if (!result) {
			startLeaveAnimation();
			hideTooltip();
			hover = null;
			onCursorChange?.(false);
			return;
		}
		const newKey = String(result.attributes.h3id ?? '');
		const isNewDot = hover?.dotKey !== newKey;
		// Moving to a different dot — animate the old one out.
		if (hover?.dotKey && isNewDot) {
			startLeaveAnimation();
		}
		const dotStyle = computeStyle(result);
		// A cell that draws no dot (absence dots disabled) gets no hover reaction:
		// no tooltip, no cursor change, no pulse ring — "no dot" means "not there".
		const rendered = !dotStyle.hidden;
		// No-data cells aren't clickable — keep the default cursor; a hidden cell
		// isn't there at all.
		onCursorChange?.(rendered && !result.noData);
		// Spawn a pulse ring for the new dot (skip if same dot, the selected cell,
		// an absent cell, or one that draws nothing — no data dot to pulse around).
		if (isNewDot && newKey !== selectedDotKey && rendered && !dotStyle.absent) {
			const rid = ++ringIdCounter;
			activeRings = [
				...activeRings,
				{
					_id: rid,
					x: result.dotScreenX,
					y: result.dotScreenY,
					size: dotStyle.size,
					color: dotStyle.color,
					lat: result.dotLat,
					lng: result.dotLng
				}
			];
			setTimeout(() => {
				activeRings = activeRings.filter((r) => r._id !== rid);
			}, ringDuration);
		}
		// Start tooltip dwell timer on new dot — but only if a dot actually renders.
		// A hidden cell never arms the timer, so no card ever shows for it.
		if (isNewDot) {
			hideTooltip();
			if (rendered) {
				tooltipTimer = setTimeout(() => {
					tooltipVisible = true;
				}, tooltipDelay);
			}
		}
		hover = {
			resolution: result.resolution,
			attributes: result.attributes,
			noData: result.noData ?? false,
			dotScreenX: result.dotScreenX,
			dotScreenY: result.dotScreenY,
			dotColor: dotStyle.color,
			dotOpacity: dotStyle.opacity,
			dotSize: dotStyle.size,
			dotOutlineColor: dotStyle.outlineColor,
			dotOutlineWidth: dotStyle.outlineWidth,
			dotKey: newKey,
			dotLat: result.dotLat,
			dotLng: result.dotLng
		};
	}

	/** Pushes a dot into the leaving trail so it shrinks out. */
	function pushLeavingDot(dot: HoverInfo) {
		if (dot?.dotScreenX != null && dot.dotColor && dot.dotSize) {
			const id = ++leavingIdCounter;
			leavingDots = [...leavingDots, { ...dot, _id: id }];
			setTimeout(() => {
				leavingDots = leavingDots.filter((d) => d._id !== id);
			}, leaveDuration);
		}
	}

	/**
	 * Selects a cell, or clears the selection with `null`. The persistent
	 * counterpart of {@link applyHover}: styled through the same `computeStyle`,
	 * drawn as the pinned dot (with its pop animation on a new cell), reprojected
	 * with everything else, resolved once into {@link selectedMeaning} for the
	 * `selectionCard` snippet — and never touched by hover events. Clearing
	 * animates the dot out through the leaving trail. A cell that draws no dot
	 * (`computeStyle(...).hidden`) is not selectable: it clears instead.
	 */
	export function select(result: HoverResult | null) {
		if (!result) {
			if (selected) pushLeavingDot(selected);
			selected = null;
			return;
		}
		const dotStyle = computeStyle(result);
		if (dotStyle.hidden) {
			select(null);
			return;
		}
		const newKey = String(result.attributes.h3id ?? '');
		if (selected && selected.dotKey !== newKey) pushLeavingDot(selected);
		selected = {
			resolution: result.resolution,
			attributes: result.attributes,
			noData: result.noData ?? false,
			dotScreenX: result.dotScreenX,
			dotScreenY: result.dotScreenY,
			dotColor: dotStyle.color,
			dotOpacity: dotStyle.opacity,
			dotSize: dotStyle.size,
			dotOutlineColor: dotStyle.outlineColor,
			dotOutlineWidth: dotStyle.outlineWidth,
			dotKey: newKey,
			dotLat: result.dotLat,
			dotLng: result.dotLng
		};
	}

	/**
	 * Reprojects every overlay's screen position from its geo coords — called by
	 * the globe's camera watcher on camera move; the selected dot included.
	 */
	export function reproject(toScreen: ToScreen) {
		if (hover?.dotLat != null && hover.dotLng != null) {
			const sp = toScreen(hover.dotLat, hover.dotLng);
			if (sp) hover = { ...hover, dotScreenX: sp.x, dotScreenY: sp.y };
		}
		if (leavingDots.length > 0) {
			leavingDots = leavingDots.map((ld) => {
				if (ld.dotLat == null || ld.dotLng == null) return ld;
				const sp = toScreen(ld.dotLat, ld.dotLng);
				return sp ? { ...ld, dotScreenX: sp.x, dotScreenY: sp.y } : ld;
			});
		}
		if (activeRings.length > 0) {
			activeRings = activeRings.map((r) => {
				const sp = toScreen(r.lat, r.lng);
				return sp ? { ...r, x: sp.x, y: sp.y } : r;
			});
		}
		if (leavingTooltip?.dotLat != null && leavingTooltip.dotLng != null) {
			const sp = toScreen(leavingTooltip.dotLat, leavingTooltip.dotLng);
			if (sp) leavingTooltip = { ...leavingTooltip, dotX: sp.x, dotY: sp.y };
		}
		if (selected?.dotLat != null && selected.dotLng != null) {
			const sp = toScreen(selected.dotLat, selected.dotLng);
			if (sp) selected = { ...selected, dotScreenX: sp.x, dotScreenY: sp.y };
		}
	}

	/** Whether any overlay is currently on screen (gates the host's reproject work). */
	export function hasOverlays(): boolean {
		return (
			hover != null ||
			selected != null ||
			leavingDots.length > 0 ||
			activeRings.length > 0 ||
			leavingTooltip != null
		);
	}

	onDestroy(() => {
		clearTimeout(tooltipTimer);
		clearTimeout(leavingTooltipTimer);
		leavingDots = [];
		activeRings = [];
	});
</script>

{#if leavingTooltip}
	{@const lpos = tooltipPos(leavingTooltip.dotX, leavingTooltip.dotY, tooltipElH)}
	<div class="hex-tooltip-leave" style="left: {lpos.left}px; top: {lpos.top}px;">
		{@render card?.(leavingTooltip.meaning, {
			skipShimmer: true,
			noData: leavingTooltip.noData
		})}
	</div>
{/if}

{#if hover && tooltipVisible && tooltipMeaning}
	{#key hover.dotKey}
		{@const apos = tooltipPos(hover.dotScreenX ?? 0, hover.dotScreenY ?? 0, tooltipElH)}
		<div
			class="hex-tooltip-enter"
			style="left: {apos.left}px; top: {apos.top}px;"
			bind:clientHeight={tooltipElH}
		>
			{@render card?.(tooltipMeaning, { skipShimmer: false, noData: hover.noData })}
		</div>
	{/key}
{/if}

<!-- Leaving dots trail — each shrinks back independently -->
{#each leavingDots as ld (ld._id)}
	{@const low = ld.dotOutlineWidth ?? 0}
	<div
		class="hex-hover-dot-leave"
		style="
			left: {ld.dotScreenX}px;
			top: {ld.dotScreenY}px;
			width: {ld.dotSize}px;
			height: {ld.dotSize}px;
			background: {ld.dotColor};
			border: {low}px solid {ld.dotOutlineColor ?? 'transparent'};
		"
	></div>
{/each}

<!-- Pulse rings — independent of hover, always finish their animation -->
{#each activeRings as ring (ring._id)}
	<div
		class="hex-hover-ring"
		style="
			left: {ring.x}px;
			top: {ring.y}px;
			width: {ring.size}px;
			height: {ring.size}px;
			border-color: {ring.color};
		"
	></div>
{/each}

{#if hover?.dotScreenX != null && hover.dotColor && hover.dotSize && hover.dotKey !== selectedDotKey}
	{@const ow = hover.dotOutlineWidth ?? 0}
	{#key hover.dotKey}
		<!-- Animated dot overlay -->
		<div
			class="hex-hover-dot"
			style="
				left: {hover.dotScreenX}px;
				top: {hover.dotScreenY}px;
				width: {hover.dotSize}px;
				height: {hover.dotSize}px;
				background: {hover.dotColor};
				opacity: {resolveOpacity(hover.dotOpacity)};
				border: {ow}px solid {hover.dotOutlineColor ?? 'transparent'};
			"
		></div>
	{/key}
{/if}

<!-- Selected dot — pop animation on a new selection, stays highlighted until cleared -->
{#if selected?.dotScreenX != null && selected.dotColor && selected.dotSize}
	{@const pow = selected.dotOutlineWidth ?? 0}
	{#key selected.dotKey}
		<div
			class="hex-hover-dot-pinned"
			style="
				left: {selected.dotScreenX}px;
				top: {selected.dotScreenY}px;
				width: {selected.dotSize}px;
				height: {selected.dotSize}px;
				background: {selected.dotColor};
				opacity: {resolveOpacity(selected.dotOpacity)};
				border: {pow}px solid {selected.dotOutlineColor ?? 'transparent'};
			"
		></div>
	{/key}
{/if}

<!-- The selection surface: rendered ONCE (no key), fed a null meaning while
     nothing is selected, so a host's sheet or panel persists across selections
     and only its content changes. -->
{@render selectionCard?.(selectedMeaning, {
	noData: selected?.noData ?? false,
	key: selected?.dotKey ?? null
})}
