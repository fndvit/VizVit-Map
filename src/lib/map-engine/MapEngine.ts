/**
 * @module map-engine/MapEngine
 * The lifecycle facade over one map view.
 *
 * `MapEngine` picks a **map provider** (ArcGIS by default, MapLibre on request,
 * an injected fake in tests), boots it into a container, and offers the handful
 * of services that sit above a provider rather than inside one:
 *
 * - the generic {@link HoverManager} loop (`engine.hover`), whose resolution
 *   strategy is injected by whoever owns the data layers;
 * - basemap *ids*, resolved through the app's {@link BasemapCatalog} into
 *   provider-neutral specs and decorated after they apply;
 * - camera conveniences the ports deliberately leave out (geocoded fly-to).
 *
 * It exposes no SDK object. Code that genuinely needs one reaches it through
 * `engine.provider.native('arcgis')`, and says why.
 */

import { HoverManager } from './HoverManager.js';
import { locatePlace } from './geocode.js';
import { zoomForExtent } from './camera-fit.js';
import {
	PASSTHROUGH_BASEMAP_CATALOG,
	type BasemapCatalog,
	type Handle,
	type MapProvider,
	type Padding,
	type ProviderEvents,
	type ProviderKind,
	type QualityOptions
} from './provider.js';
import type {
	CameraReadout,
	FlatColors,
	FlyToOptions,
	FlyToPlaceOptions,
	MapEngineOptions,
	SceneCamera,
	ViewMode
} from './types.js';

/** Options accepted by {@link MapEngine.setBasemap}. */
export interface SetBasemapOptions {
	/** Land/ocean overrides for flat presets. */
	customColors?: FlatColors;
	/** Ask the catalog to decorate with dynamic labels. Defaults to the engine option. */
	labelOverlay?: boolean;
}

export class MapEngine {
	private readonly options: MapEngineOptions;
	private readonly catalog: BasemapCatalog;
	private currentProvider: MapProvider | null = null;
	private currentBasemapId: string;
	/** Monotonic counter used to discard stale async basemap swaps. */
	private basemapGeneration = 0;
	/** The generic hover loop — owns pointer events + rAF; a strategy is injected by the data-layer owner. */
	private hoverManager: HoverManager | null = null;

	/**
	 * @param options - Provider choice, basemap catalog and initial view configuration.
	 *   See {@link MapEngineOptions}.
	 */
	constructor(options: MapEngineOptions) {
		this.options = options;
		// A view requires a basemap — refuse to silently invent one. The type makes
		// `basemap` required, but guard anyway so a misconfigured caller (`as any`
		// / plain JS) fails loud at construction instead of building a view against
		// an undefined basemap.
		if (!options.basemap) {
			throw new Error(
				`MapEngine (${options.mode ?? '3d'}) requires a basemap id; none was provided.`
			);
		}
		this.currentBasemapId = options.basemap;
		this.catalog = options.basemaps ?? PASSTHROUGH_BASEMAP_CATALOG;
	}

	/** The live provider, or `null` before {@link init} resolves / after {@link destroy}. */
	get provider(): MapProvider | null {
		return this.currentProvider;
	}

	/** Which map SDK renders this view. */
	get kind(): ProviderKind {
		return this.options.provider ?? 'arcgis';
	}

	/** Which view the engine drives. */
	get mode(): ViewMode {
		return this.options.mode;
	}

	/**
	 * The generic hover loop (pointer→resolve→emit), or `null` before {@link init}.
	 * The data-layer owner injects the resolution strategy via `hover.setStrategy`;
	 * `<Globe>` consumes results via `hover.onHover`. The engine stays domain-free.
	 */
	get hover(): HoverManager | null {
		return this.hoverManager;
	}

	/**
	 * Boots the engine: runs the app's init hook, builds the provider into
	 * `container`, starts the hover loop, and applies the initial basemap.
	 *
	 * @param container - DOM element to render the view into.
	 * @returns The ready provider.
	 */
	async init(container: HTMLElement): Promise<MapProvider> {
		// The init hook (e.g. installing a request proxy) only matters for the later
		// basemap fetch, and provider construction makes no proxied request before
		// the view is ready — so there is no ordering dependency between them.
		const [, provider] = await Promise.all([
			this.options.onInit?.(),
			this.createProvider(container)
		]);
		this.currentProvider = provider;

		// The hover loop subscribes to the now-ready view's pointer events; a
		// strategy is injected later by whoever owns the data layers.
		this.hoverManager = new HoverManager((name, handler) =>
			provider.events.on(name as 'pointer-move' | 'pointer-leave', handler)
		);
		this.hoverManager.start();

		// The provider started on a neutral placeholder; apply the real basemap now
		// that the view exists (portal/style basemaps load async, and the catalog's
		// decoration needs a live map).
		await this.setBasemap(this.currentBasemapId);

		return provider;
	}

	/**
	 * Builds the provider for the configured kind.
	 *
	 * @param container - DOM element to render into.
	 * @returns The ready provider.
	 */
	private async createProvider(container: HTMLElement): Promise<MapProvider> {
		if (this.options.createProvider) return this.options.createProvider(this.options, container);
		if (this.kind === 'maplibre') {
			const { createMaplibreProvider } = await import('./maplibre/index.js');
			return createMaplibreProvider(this.options, container);
		}
		const { createArcgisProvider } = await import('./arcgis/index.js');
		return createArcgisProvider(this.options, container);
	}

	/**
	 * Swaps the basemap. The id is resolved through the app's catalog into a
	 * provider-neutral spec, applied, then decorated (label hiding/overlay).
	 * Concurrent calls are made safe by a generation guard — a slow load whose
	 * newer swap has already begun is dropped before it decorates.
	 *
	 * @param id - Registry basemap id.
	 * @param opts - Custom flat colors and label-overlay toggle.
	 */
	async setBasemap(id: string, opts: SetBasemapOptions = {}): Promise<void> {
		const provider = this.currentProvider;
		if (!provider) return;
		this.currentBasemapId = id;
		const gen = ++this.basemapGeneration;
		const spec = this.catalog.resolve(id, opts.customColors ?? this.options.basemapColors);
		await provider.scene.setBasemap(spec);
		if (gen !== this.basemapGeneration) return;
		await this.catalog.decorate?.(provider, spec, {
			labelOverlay: opts.labelOverlay ?? this.options.labelOverlay
		});
	}

	/**
	 * Sets the scene background — the space around the globe.
	 *
	 * @param color - `'transparent'` or a hex color.
	 */
	setBackground(color: string): void {
		this.currentProvider?.scene.setBackground(color);
	}

	/**
	 * Sets the ground (sphere) surface color. Independent of the background: an
	 * opaque ground stops draped basemaps showing the globe interior as dark land.
	 *
	 * @param color - Hex color.
	 */
	setGround(color: string): void {
		this.currentProvider?.scene.setGround(color);
	}

	/**
	 * Applies render-quality knobs.
	 *
	 * @param quality - Profile and/or pixel-ratio cap.
	 */
	setQuality(quality: QualityOptions): void {
		this.currentProvider?.scene.setQuality(quality);
	}

	/**
	 * Caps the render pixel ratio. A value below 1 renders sub-natively and
	 * shrinks the framebuffer — the practical lever for memory-constrained
	 * devices. Re-apply after any quality-profile change, which resets it.
	 *
	 * @param ratio - Max device-pixel ratio (e.g. `0.6`), or `undefined` for no cap.
	 */
	setMaxPixelRatio(ratio: number | undefined): void {
		if (ratio == null) return;
		this.setQuality({ maxPixelRatio: ratio });
	}

	/**
	 * Animates the camera to a target.
	 *
	 * @param cam - Target camera state.
	 * @param opts - Duration, easing, padding.
	 */
	async flyTo(cam: SceneCamera, opts?: FlyToOptions): Promise<void> {
		await this.currentProvider?.camera.flyTo({ ...cam }, opts);
	}

	/**
	 * Geocodes a place name and flies to it.
	 *
	 * The landing zoom adapts to the matched place: unless `opts.zoom` overrides
	 * it, the result's extent is fed through {@link zoomForExtent} so a city lands
	 * close while a country stays wide (extent-less results fall back to 5).
	 *
	 * @param query - Free-text place / address.
	 * @param opts - Zoom override and optional suggestion `magicKey` that pins the
	 *   geocode to an exact autocomplete result.
	 */
	async flyToPlace(query: string, opts: FlyToPlaceOptions = {}): Promise<void> {
		if (!this.currentProvider) return;
		const loc = await locatePlace(query, opts.magicKey);
		if (!loc) return;
		const zoom = opts.zoom ?? (loc.extent ? zoomForExtent(loc.extent) : 5);
		await this.flyToLocation(loc.longitude, loc.latitude, zoom);
	}

	/**
	 * Flies to a known lon/lat, skipping the geocode step {@link flyToPlace} needs.
	 *
	 * @param lon - Target longitude.
	 * @param lat - Target latitude.
	 * @param zoom - Zoom level to settle at (default 5).
	 * @param duration - Animation duration in ms (default 1500).
	 */
	async flyToLocation(lon: number, lat: number, zoom = 5, duration = 1500): Promise<void> {
		await this.currentProvider?.camera.flyTo({ longitude: lon, latitude: lat, zoom }, { duration });
	}

	/** Zooms in one level. */
	zoomIn(): void {
		this.currentProvider?.camera.zoomBy(1);
	}

	/** Zooms out one level. */
	zoomOut(): void {
		this.currentProvider?.camera.zoomBy(-1);
	}

	/** Reads the current camera + scale, or `null` if unavailable. */
	readCamera(): CameraReadout | null {
		return this.currentProvider?.camera.get() ?? null;
	}

	/**
	 * Subscribes to live camera changes.
	 *
	 * @param cb - Called with the latest camera readout on every change.
	 * @returns A handle (`.remove()` to stop listening), or `null` before init.
	 */
	watchCamera(cb: (readout: CameraReadout) => void): Handle | null {
		return this.currentProvider?.events.on('camera', cb) ?? null;
	}

	/**
	 * Subscribes to the view's `stationary` flag — `true` once the camera settles
	 * AND streaming stops, `false` when movement resumes. Generic: carries no
	 * feature knowledge, so capabilities inject their own logic.
	 *
	 * @param cb - Called with the latest `stationary` value on every change.
	 * @returns A handle, or `null` before init.
	 */
	watchStationary(cb: (isStationary: boolean) => void): Handle | null {
		return this.currentProvider?.events.on('stationary', cb) ?? null;
	}

	/**
	 * Subscribes to a provider event.
	 *
	 * @param name - Event name from {@link ProviderEvents}.
	 * @param handler - Event handler.
	 * @returns A handle (`.remove()` to unsubscribe), or `null` before init.
	 */
	on<K extends keyof ProviderEvents>(
		name: K,
		handler: (e: ProviderEvents[K]) => void
	): Handle | null {
		return this.currentProvider?.events.on(name, handler) ?? null;
	}

	/**
	 * Shifts the view center within its container (e.g. to clear a sidebar).
	 *
	 * @param padding - Padding in CSS pixels.
	 */
	setPadding(padding: Padding): void {
		this.currentProvider?.scene.setPadding(padding);
	}

	/** Destroys the view and releases references. Safe to call once. */
	destroy(): void {
		this.hoverManager?.destroy();
		this.hoverManager = null;
		this.currentProvider?.destroy();
		this.currentProvider = null;
	}
}
