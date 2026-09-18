/**
 * @module map-engine/arcgis/ArcgisProvider
 * The ArcGIS adapter: one `SceneView`/`MapView` behind the {@link MapProvider}
 * contract.
 *
 * This is the only module above `@arcgis/core` that names ArcGIS concepts. It
 * owns the view, the `Map`, the loaded SDK constructors, the custom-basemap
 * cache and its generation guard, and the de-duped module loader that capability
 * code reaches through `native('arcgis').loadModules`.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- ArcGIS dynamic imports have no static types */

import {
	ProviderMismatchError,
	type BasemapSpec,
	type CameraPort,
	type CameraState,
	type CameraTarget,
	type EventPort,
	type FlyOptions,
	type GeoJsonLayerHandle,
	type GeoJsonLayerSpec,
	type Handle,
	type LayerFactory,
	type LayerHandle,
	type LngLat,
	type MapProvider,
	type NativeSurfaces,
	type Padding,
	type PointLayerHandle,
	type PointLayerSpec,
	type ProviderEvents,
	type ProviderKind,
	type QualityOptions,
	type ScenePort,
	type ScreenPoint,
	type ScreenPort
} from '../provider.js';
import { zoomForScale } from '../scale.js';
import type { ArcgisModules, ViewMode } from '../types.js';
import { applyBasemap, type BasemapCache } from './basemap.js';
import { toRgba } from './colors.js';
import { createGeoJsonLayer, createPointLayer, type LayerCtors } from './layers.js';
import { ARCGIS_LOADERS, type ArcgisLoaders } from './loaders.js';

/** The ArcGIS view properties the event port maps straight onto `view.watch`. */
type WatchedFlag = 'stationary' | 'interacting' | 'updating';

/** Options the provider needs beyond a built view. */
export interface ArcgisProviderDeps {
	/** The built ArcGIS view (already `await view.when()`-ed). */
	view: any;
	/** The SDK constructors used to build it. */
	modules: ArcgisModules;
	/** Which view kind was built. */
	mode: ViewMode;
	/** Layer constructors, preloaded so the layer factory can stay synchronous. */
	ctors: LayerCtors;
	/** Module loader registry (tests inject a fake). */
	loaders?: ArcgisLoaders;
}

/**
 * One ArcGIS view behind the provider contract.
 *
 * Construct it through {@link createArcgisProvider}, which builds the view and
 * preloads the constructors the synchronous layer factory needs.
 */
export class ArcgisProvider implements MapProvider {
	readonly kind: ProviderKind = 'arcgis';
	readonly mode: ViewMode;

	private view: any;
	private readonly modules: ArcgisModules;
	private readonly ctors: LayerCtors;
	private readonly loaders: ArcgisLoaders;
	/** In-flight/resolved module promises, de-duped by name. */
	private readonly moduleCache = new Map<string, Promise<any>>();
	/** Custom basemaps we built, reused across swaps and freed on destroy. */
	private readonly basemapCache: BasemapCache = new Map();
	/** Monotonic counter used to discard stale async basemap swaps. */
	private basemapGeneration = 0;
	/** Live layer handles, in creation order. */
	private readonly liveLayers: LayerHandle[] = [];

	/**
	 * Pointer/camera/flag subscriptions. Built in the constructor because its two
	 * synchronous flags are getters that must read the live view through `this`.
	 */
	readonly events: EventPort;
	/** Layer creation. Built in the constructor for the same reason (`all`). */
	readonly layers: LayerFactory;

	/** @param deps - The built view and the SDK pieces it was built with. */
	constructor(deps: ArcgisProviderDeps) {
		this.view = deps.view;
		this.modules = deps.modules;
		this.mode = deps.mode;
		this.ctors = deps.ctors;
		this.loaders = deps.loaders ?? ARCGIS_LOADERS;
		this.events = this.buildEventPort();
		this.layers = this.buildLayerFactory();
	}

	// ── camera ────────────────────────────────────────────────────────

	readonly camera: CameraPort = {
		get: (): CameraState | null => {
			const cam = this.view?.camera;
			if (cam?.position) {
				const latitude = cam.position.latitude;
				const scale = this.view.scale;
				return {
					longitude: cam.position.longitude,
					latitude,
					z: cam.position.z,
					tilt: cam.tilt,
					heading: cam.heading,
					scale,
					zoom: zoomForScale(scale, latitude)
				};
			}
			// 2D MapView: no camera object, but centre + scale still describe it.
			const center = this.view?.center;
			if (!center) return null;
			const scale = this.view.scale;
			return {
				longitude: center.longitude,
				latitude: center.latitude,
				z: 0,
				tilt: 0,
				heading: this.view.rotation ?? 0,
				scale,
				zoom: this.view.zoom ?? zoomForScale(scale, center.latitude)
			};
		},

		flyTo: async (target: CameraTarget, opts: FlyOptions = {}): Promise<void> => {
			if (!this.view) return;
			const animation = {
				duration: opts.duration ?? 1500,
				easing: opts.easing ?? 'ease-in-out'
			};
			const current = this.camera.get();
			try {
				if (target.z != null && this.view.camera) {
					// Altitude-based 3D move. Clone the live camera first so the target
					// keeps its spatial reference, then override position + orientation.
					const next = this.view.camera.clone();
					next.position.longitude = target.longitude ?? current?.longitude ?? 0;
					next.position.latitude = target.latitude ?? current?.latitude ?? 0;
					next.position.z = target.z;
					next.tilt = target.tilt ?? current?.tilt ?? 0;
					next.heading = target.heading ?? current?.heading ?? 0;
					await this.view.goTo(
						opts.padding ? { target: next, padding: opts.padding } : next,
						animation
					);
					return;
				}
				// Level-based move (fly-to-place, zoom buttons, 2D).
				const zoom =
					target.zoom ??
					(target.scale != null
						? zoomForScale(target.scale, target.latitude ?? current?.latitude ?? 0)
						: undefined);
				const go: any = {
					center: [
						target.longitude ?? current?.longitude ?? 0,
						target.latitude ?? current?.latitude ?? 0
					]
				};
				if (zoom != null) go.zoom = zoom;
				if (target.tilt != null) go.tilt = target.tilt;
				if (target.heading != null) go.heading = target.heading;
				await this.view.goTo(opts.padding ? { ...go, padding: opts.padding } : go, animation);
			} catch (err: any) {
				// A newer goTo cancelled this one — the contract says resolve, not reject.
				if (err?.name !== 'AbortError') console.error('[map-engine] flyTo failed:', err);
			}
		},

		zoomBy: (delta: number, durationMs = 300): void => {
			if (!this.view) return;
			this.view.goTo({ zoom: this.view.zoom + delta }, { duration: durationMs });
		}
	};

	// ── screen ────────────────────────────────────────────────────────

	/**
	 * One reused `Point` — projection runs on every camera frame, so allocating a
	 * Point per call per frame would be needless GC churn.
	 */
	private projectionPoint: any = null;

	readonly screen: ScreenPort = {
		size: () => ({ width: this.view?.width ?? 0, height: this.view?.height ?? 0 }),

		toScreen: (p: LngLat): ScreenPoint | null => {
			if (!this.view) return null;
			if (!this.projectionPoint) {
				this.projectionPoint = new this.ctors.Point({ longitude: p.lng, latitude: p.lat });
			} else {
				this.projectionPoint.longitude = p.lng;
				this.projectionPoint.latitude = p.lat;
			}
			const sp = this.view.toScreen(this.projectionPoint);
			return sp ? { x: sp.x, y: sp.y } : null;
		},

		toMap: (p: ScreenPoint): LngLat | null => {
			const mapPoint = this.view?.toMap({ x: p.x, y: p.y });
			if (!mapPoint) return null;
			return { lng: mapPoint.longitude, lat: mapPoint.latitude };
		}
	};

	// ── events ────────────────────────────────────────────────────────

	/** @returns The event port bound to this provider's view. */
	private buildEventPort(): EventPort {
		// `self` is load-bearing, not laziness: the ports below are object literals
		// with getters, and a getter's `this` is the literal, not the provider. An
		// arrow function cannot express a getter, so the alias is how the getters
		// reach the live view.
		// eslint-disable-next-line @typescript-eslint/no-this-alias -- see above
		const self = this;
		return {
			on: <K extends keyof ProviderEvents>(
				name: K,
				handler: (e: ProviderEvents[K]) => void
			): Handle => {
				if (!this.view) return { remove() {} };
				const cb = handler as (e: any) => void;

				switch (name) {
					case 'pointer-move':
						return this.view.on('pointer-move', (e: any) => cb({ x: e.x, y: e.y, native: e }));
					case 'pointer-leave':
						return this.view.on('pointer-leave', () => cb(undefined));
					case 'click':
						return this.view.on('click', (e: any) =>
							cb({
								x: e.x,
								y: e.y,
								native: e,
								lngLat: e.mapPoint ? { lng: e.mapPoint.longitude, lat: e.mapPoint.latitude } : null
							})
						);
					case 'camera':
						return this.view.watch('camera', () => {
							const state = this.camera.get();
							if (state) cb(state);
						});
					case 'size':
						return this.view.watch('size', () => cb(this.screen.size()));
					case 'padding':
						return this.view.watch('padding', (p: Padding) => cb(p));
					default:
						// stationary | interacting | updating — plain boolean view properties.
						return this.view.watch(name as WatchedFlag, (v: boolean) => cb(v));
				}
			},

			/** Whether a deliberate user gesture is in progress right now. */
			get interacting(): boolean {
				return self.view?.interacting === true;
			},
			/** Whether the renderer still has unsettled work right now. */
			get updating(): boolean {
				return self.view?.updating === true;
			}
		};
	}

	// ── scene ─────────────────────────────────────────────────────────

	readonly scene: ScenePort = {
		setBasemap: async (spec: BasemapSpec): Promise<void> => {
			if (!this.view) return;
			const gen = ++this.basemapGeneration;
			await applyBasemap(
				this.view,
				spec,
				this.modules,
				this.native('arcgis'),
				() => gen === this.basemapGeneration,
				this.basemapCache
			);
		},

		setBackground: (color: string): void => {
			const env = this.view?.environment;
			if (!env) return;
			// A 2D MapView has no environment at all; a SceneView always does, but it
			// may have no background object yet (the view factory sets one, a caller
			// building a view by hand might not) — so build it rather than no-op.
			if (env.background) {
				env.background.color = toRgba(color);
			} else {
				env.background = { type: 'color', color: toRgba(color) };
			}
			this.view.alphaCompositingEnabled = color === 'transparent';
		},

		setGround: (color: string): void => {
			const ground = this.view?.map?.ground;
			if (!ground) return;
			ground.surfaceColor = toRgba(color);
		},

		setQuality: (q: QualityOptions): void => {
			if (!this.view) return;
			if (q.profile) this.view.qualityProfile = q.profile;
			// `qualitySettings` only exists once the view is ready, and a profile
			// change rebuilds it — so the pixel-ratio cap is applied after it.
			if (q.maxPixelRatio != null && this.view.qualitySettings) {
				this.view.qualitySettings.maximumPixelRatio = q.maxPixelRatio;
			}
		},

		setPadding: (p: Padding): void => {
			if (this.view) this.view.padding = p;
		},

		getPadding: (): Padding => this.view?.padding ?? { top: 0, right: 0, bottom: 0, left: 0 },

		setCursor: (cursor: string): void => {
			const container = this.view?.container;
			if (container?.style) container.style.cursor = cursor;
		},

		whenSettled: (): Promise<void> =>
			new Promise((resolve) => {
				if (!this.view || !this.view.updating) {
					resolve();
					return;
				}
				const handle = this.view.watch('updating', (updating: boolean) => {
					if (updating) return;
					handle?.remove?.();
					resolve();
				});
			})
	};

	// ── layers ────────────────────────────────────────────────────────

	/** @returns The layer factory bound to this provider's map. */
	private buildLayerFactory(): LayerFactory {
		// `self` is load-bearing, not laziness: the ports below are object literals
		// with getters, and a getter's `this` is the literal, not the provider. An
		// arrow function cannot express a getter, so the alias is how the getters
		// reach the live view.
		// eslint-disable-next-line @typescript-eslint/no-this-alias -- see above
		const self = this;
		return {
			points: (spec: PointLayerSpec): PointLayerHandle =>
				self.track(createPointLayer(self.layerDeps(), spec)) as PointLayerHandle,
			geojson: (spec: GeoJsonLayerSpec): GeoJsonLayerHandle =>
				self.track(createGeoJsonLayer(self.layerDeps(), spec)) as GeoJsonLayerHandle,
			get all(): readonly LayerHandle[] {
				return [...self.liveLayers];
			}
		};
	}

	/** Dependencies handed to each layer factory call. */
	private layerDeps() {
		return { map: this.view?.map, view: this.view, ctors: this.ctors };
	}

	/** Registers a handle as live and un-registers it when it removes itself. */
	private track<T extends LayerHandle>(handle: T): T {
		this.liveLayers.push(handle);
		const remove = handle.remove.bind(handle);
		handle.remove = () => {
			const i = this.liveLayers.indexOf(handle);
			if (i >= 0) this.liveLayers.splice(i, 1);
			remove();
		};
		return handle;
	}

	// ── native ────────────────────────────────────────────────────────

	native<K extends ProviderKind>(kind: K): NativeSurfaces[K] {
		if (kind !== 'arcgis') throw new ProviderMismatchError(kind, 'arcgis');
		return {
			kind: 'arcgis',
			view: this.view,
			map: this.view?.map ?? null,
			loadModules: this.loadModules
		} as NativeSurfaces[K];
	}

	/**
	 * Loads the named ArcGIS constructors, de-duped across the whole provider:
	 * one in-flight promise per module name.
	 *
	 * @param names - Registry names from `ARCGIS_LOADERS`.
	 * @returns The default exports, keyed by name.
	 */
	private loadModules = async <T extends string>(names: readonly T[]): Promise<Record<T, any>> => {
		const one = (name: string): Promise<any> => {
			const cached = this.moduleCache.get(name);
			if (cached) return cached;
			const loader = this.loaders[name];
			if (!loader) return Promise.reject(new Error(`Unknown ArcGIS module: ${name}`));
			const p = loader().then((m) => m.default);
			this.moduleCache.set(name, p);
			return p;
		};
		const resolved = await Promise.all(names.map((n) => one(n)));
		const out = {} as Record<T, any>;
		names.forEach((n, i) => {
			out[n] = resolved[i];
		});
		return out;
	};

	// ── lifecycle ─────────────────────────────────────────────────────

	destroy(): void {
		for (const handle of [...this.liveLayers]) handle.remove();
		this.liveLayers.length = 0;
		this.projectionPoint = null;
		this.view?.destroy();
		// Release the custom basemaps we cached — ArcGIS does not free a detached
		// basemap's GPU tiles on its own. Only our own instances live here;
		// well-known basemaps are ArcGIS-owned and must never be destroyed.
		for (const bm of this.basemapCache.values()) bm?.destroy?.();
		this.basemapCache.clear();
		this.moduleCache.clear();
		this.view = null;
	}
}
