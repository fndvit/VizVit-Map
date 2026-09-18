<!--
	@component MapCanvas

	The single reusable map view wrapper used across the site. Owns a
	{@link MapEngine} instance (3D globe or 2D map), wires its lifecycle to
	Svelte, and reactively applies basemap/camera prop changes.

	It is provider-neutral: which SDK renders the view, and how this app's basemap
	ids resolve, come in as the `provider` / `basemaps` / `onInit` props (the site
	passes `NATGEO_ENGINE` from `$lib/config/map`).

	Feature-rich callers (markers, pins, data layers, PMTiles, hover) receive the
	live engine through `onready` and drive it through `engine` / `engine.provider`.

	@prop {('3d'|'2d')} [mode='3d'] - Build a globe (3D) or a flat map (2D).
	@prop {ProviderKind} [provider='arcgis'] - Which map SDK renders the view.
	@prop {BasemapCatalog} [basemaps] - Resolves this app's basemap ids to provider-neutral specs. Defaults to passing every id through as a provider built-in.
	@prop {() => Promise<void> | void} [onInit] - Runs once before the first basemap fetch (e.g. installing the NatGeo portal request proxy).
	@prop {string} basemap - Registry basemap id (e.g. 'flat-natgeo', 'natgeo-lightGray', 'natgeo-soils'). Required — MapEngine throws if absent.
	@prop {FlatColors} [basemapColors] - Custom land/ocean colors for flat presets.
	@prop {boolean} [labelOverlay=false] - Overlay dynamic country/city labels on standard/portal basemaps.
	@prop {boolean} [interactive=true] - Allow user pan/zoom/rotate.
	@prop {SceneCamera} [camera] - Initial + reactive camera target (3D).
	@prop {[number, number]} [center] - Initial map center (2D).
	@prop {number} [zoom] - Initial zoom (2D).
	@prop {string} [background='transparent'] - Scene background ('transparent' or hex) (3D).
	@prop {string} [groundColor] - Ground (sphere) surface color as hex (3D), fully independent of background (never inferred from it). Set an opaque light color so draped portal basemaps don't show dark land; defaults to a see-through surface.
	@prop {{min:number,max:number}} [altitudeConstraint] - Lock the globe to a fixed altitude range (3D).
	@prop {QualityProfile} [qualityProfile='medium'] - SceneView render quality (3D). Pass 'low' for decorative globes to cut GPU memory.
	@prop {number} [maxPixelRatio] - Cap the SceneView render pixel ratio (3D). Pass a value below 1 (e.g. 0.6) on memory-constrained devices to render sub-natively and shrink the WebGL framebuffer.
	@prop {MapViewConstraints} [constraints] - 2D navigation constraints.
	@prop {string[]} [uiComponents] - ArcGIS UI widgets to show.
	@prop {FlyToOptions} [flyToOptions] - Duration/easing/padding for reactive camera moves.
	@prop {(engine: MapEngine) => void} [onready] - Called once the view is ready, with the live engine.
	@prop {(readout: CameraReadout) => void} [oncamerachange] - Live camera state callback (3D).
	@prop {(coords: { lon: number; lat: number }) => void} [onclick] - Map click in lon/lat.
	@prop {(error: unknown) => void} [onerror] - Called if the view fails to initialize.
	@prop {string} [class] - Extra classes on the container.
-->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { MapEngine } from '$lib/map-engine/index.js';
	import type {
		BasemapCatalog,
		CameraReadout,
		FlatColors,
		FlyToOptions,
		MapViewConstraints,
		ProviderKind,
		QualityProfile,
		SceneCamera,
		ViewMode
	} from '$lib/map-engine/index.js';

	let {
		mode = '3d' as ViewMode,
		provider,
		basemaps,
		onInit,
		basemap,
		basemapColors,
		labelOverlay = false,
		interactive = true,
		camera,
		center,
		zoom,
		background = 'transparent',
		groundColor,
		altitudeConstraint,
		qualityProfile,
		maxPixelRatio,
		constraints,
		uiComponents,
		flyToOptions,
		onready,
		oncamerachange,
		onclick,
		onerror,
		class: className = ''
	}: {
		mode?: ViewMode;
		provider?: ProviderKind;
		basemaps?: BasemapCatalog;
		onInit?: () => Promise<void> | void;
		/** Required — MapEngine throws at construction if no basemap is provided. */
		basemap: string;
		basemapColors?: FlatColors;
		labelOverlay?: boolean;
		interactive?: boolean;
		camera?: SceneCamera;
		center?: [number, number];
		zoom?: number;
		background?: string;
		groundColor?: string;
		altitudeConstraint?: { min: number; max: number };
		qualityProfile?: QualityProfile;
		maxPixelRatio?: number;
		constraints?: MapViewConstraints;
		uiComponents?: string[];
		flyToOptions?: FlyToOptions;
		onready?: (engine: MapEngine) => void;
		oncamerachange?: (readout: CameraReadout) => void;
		onclick?: (coords: { lon: number; lat: number }) => void;
		onerror?: (error: unknown) => void;
		class?: string;
	} = $props();

	let container: HTMLDivElement;
	let engine: MapEngine | null = null;
	let ready = $state(false);

	onMount(async () => {
		engine = new MapEngine({
			mode,
			provider,
			basemaps,
			onInit,
			basemap,
			basemapColors,
			labelOverlay,
			interactive,
			camera,
			center,
			zoom,
			background,
			groundColor,
			altitudeConstraint,
			qualityProfile,
			maxPixelRatio,
			constraints,
			uiComponents
		});
		try {
			await engine.init(container);
		} catch (err) {
			onerror?.(err);
			return;
		}
		ready = true;

		if (oncamerachange) engine.watchCamera(oncamerachange);
		if (onclick) {
			engine.on('click', (e) => {
				if (e.lngLat) onclick({ lon: e.lngLat.lng, lat: e.lngLat.lat });
			});
		}

		onready?.(engine);
	});

	// ── Reactive basemap swap ───────────────────────────────────────────
	// Skip no-op swaps (consecutive scrolly steps often share a basemap). The
	// engine's generation guard handles stale async portal loads internally.
	let prevBasemapKey = '';
	$effect(() => {
		if (!ready || !engine || !basemap) return;
		const key = `${basemap}|${basemapColors?.landColor ?? ''}|${basemapColors?.oceanColor ?? ''}`;
		if (key === prevBasemapKey) return;
		prevBasemapKey = key;
		engine.setBasemap(basemap, { customColors: basemapColors });
	});

	// ── Reactive background swap (3D) ───────────────────────────────────
	let prevBackground = '';
	$effect(() => {
		if (!ready || !engine || mode !== '3d') return;
		if (background === prevBackground) return;
		prevBackground = background;
		engine.setBackground(background);
	});

	// ── Reactive camera move (3D) ───────────────────────────────────────
	$effect(() => {
		if (!ready || !engine || !camera) return;
		engine.flyTo(camera, flyToOptions);
	});

	onDestroy(() => {
		engine?.destroy();
		engine = null;
	});
</script>

<div bind:this={container} class="map-canvas {className}"></div>

<style>
	.map-canvas {
		width: 100%;
		height: 100%;
	}

	.map-canvas :global(.esri-view-root),
	.map-canvas :global(.esri-view-surface),
	.map-canvas :global(.esri-view-surface canvas) {
		width: 100% !important;
		height: 100% !important;
	}

	/* Remove the blue focus outline from the ArcGIS container/canvas */
	.map-canvas :global(.esri-view),
	.map-canvas :global(.esri-view-root),
	.map-canvas :global(.esri-view-surface),
	.map-canvas :global(.esri-view-surface canvas),
	.map-canvas :global(.esri-view-surface:focus),
	.map-canvas :global(.esri-view-surface canvas:focus),
	.map-canvas :global(*:focus) {
		outline: none !important;
	}

	/* Hide ArcGIS attribution & default UI chrome */
	.map-canvas :global(.esri-view-attribution),
	.map-canvas :global(.esri-attribution) {
		display: none !important;
	}
</style>
