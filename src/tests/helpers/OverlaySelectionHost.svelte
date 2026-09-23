<!--
  @component OverlaySelectionHost

  Test host for `HoverTooltipOverlay`: mounts the overlay with a fake dot style
  and a spied meaning injector, and renders a `selectionCard` snippet whose DOM
  node a test can hold on to — the way to prove the selection surface is
  updated in place and never remounted between selections.

  @prop {(r: HoverResult) => DotStyle} computeStyle - Fake mirror-dot style.
  @prop {(r: HoverResult) => TooltipMeaning | null} meaning - Spied injector.
-->
<script lang="ts">
	import HoverTooltipOverlay from '$lib/globe/hover/HoverTooltipOverlay.svelte';
	import type {
		DotStyle,
		HoverOverlayHandle,
		HoverResult,
		TooltipMeaning
	} from '$lib/globe/hover/hoverTypes.js';

	let {
		computeStyle,
		meaning
	}: {
		computeStyle: (r: HoverResult) => DotStyle;
		meaning: (r: HoverResult) => TooltipMeaning | null;
	} = $props();

	let overlay = $state<HoverOverlayHandle | null>(null);

	/** The overlay's imperative handle, for the test to drive. */
	export function handle(): HoverOverlayHandle {
		return overlay!;
	}
</script>

<HoverTooltipOverlay bind:this={overlay} {computeStyle} {meaning} containerW={800} containerH={600}>
	{#snippet selectionCard(m, render)}
		<div data-selection data-key={render.key ?? ''} data-nodata={render.noData}>
			{m ? String((m as { label?: string }).label ?? '') : ''}
		</div>
	{/snippet}
</HoverTooltipOverlay>
