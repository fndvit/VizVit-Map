/**
 * @module map-engine/maplibre/MaplibreProvider
 * The MapLibre GL adapter: one `maplibregl.Map` behind the {@link MapProvider}
 * contract, in globe projection for `'3d'` mode.
 *
 * It exists to keep the seam honest — the capabilities above it (markers, pins,
 * outlines, hex overlay, cursor hover) run unchanged on it, and the test fake is
 * no longer the only second adapter. It deliberately does NOT implement the
 * explore dot tiers: those are Arcade visual variables and SQL draw gates, so
 * `dataLayers` declares `requires: 'arcgis'` and the registry refuses to mount
 * it here (see `docs/adr/0001-map-provider-seam.md`).
 *
 * Known fidelity gaps, each documented at its member: camera altitude is derived
 * from zoom rather than read from a free camera (MapLibre v5 has none);
 * `placement` has no z-order meaning; `setGround` is a no-op; a `well-known`
 * ArcGIS basemap id cannot be honoured.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- the MapLibre map is loaded dynamically */

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
import { scaleForZoom, zoomForScale } from '../scale.js';
import type { ViewMode } from '../types.js';
import { altitudeForZoom, zoomForAltitude } from './camera.js';
import { createGeoJsonLayer, createPointLayer, type MaplibreLayer } from './layers.js';

/**
 * The land source used to draw a `flat` basemap. MapLibre ships no built-in
 * geometry, so the adapter borrows the public demo tiles; an app that cannot
 * reach them should pass a `style` basemap instead.
 */
const DEMO_TILES_URL = 'https://demotiles.maplibre.org/tiles/tiles.json';

/**
 * How long a style swap may take to report itself loaded before the adapter
 * carries on anyway. A basemap is cosmetic and the engine awaits it during
 * `init`, so this bound is what stops a stalled style deadlocking the view.
 */
const STYLE_SETTLE_TIMEOUT_MS = 4000;

/** Basemap ids this adapter knows natively, for `well-known` specs. */
const KNOWN_STYLES: Record<string, string> = {
	demotiles: 'https://demotiles.maplibre.org/style.json'
};

/** Construction inputs for {@link MaplibreProvider}. */
export interface MaplibreProviderDeps {
	/** The live `maplibregl.Map`, already `load`-ed. */
	map: any;
	/** The container the map renders into (for size and background colour). */
	container: HTMLElement;
	/** Which view kind this stands in for. */
	mode: ViewMode;
}

/** One MapLibre map behind the provider contract. */
export class MaplibreProvider implements MapProvider {
	readonly kind: ProviderKind = 'maplibre';
	readonly mode: ViewMode;

	private map: any;
	private readonly container: HTMLElement;
	/** Live layer handles, in creation order; replayed after a style swap. */
	private readonly liveLayers: (LayerHandle & MaplibreLayer)[] = [];
	/** Tracks whether a deliberate gesture is in progress, for `events.interacting`. */
	private gesturing = false;
	/** Cached native basemaps, keyed by a `native` spec's key. */
	private readonly basemapCache = new Map<string, unknown>();

	readonly events: EventPort;
	readonly layers: LayerFactory;

	/** @param deps - The loaded map and the element it renders into. */
	constructor(deps: MaplibreProviderDeps) {
		this.map = deps.map;
		this.container = deps.container;
		this.mode = deps.mode;
		for (const start of ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart']) {
			this.map.on(start, () => {
				this.gesturing = true;
			});
		}
		for (const end of ['dragend', 'zoomend', 'rotateend', 'pitchend']) {
			this.map.on(end, () => {
				this.gesturing = false;
			});
		}
		this.events = this.buildEventPort();
		this.layers = this.buildLayerFactory();
	}

	// ── camera ────────────────────────────────────────────────────────

	readonly camera: CameraPort = {
		/**
		 * Reads the live camera. `z` is *derived* from the zoom (MapLibre v5 exposes
		 * no camera altitude), so a round-trip through `flyTo({ z })` is stable but
		 * the value is not an independent measurement.
		 */
		get: (): CameraState | null => {
			if (!this.map) return null;
			const centre = this.map.getCenter();
			const zoom = this.map.getZoom();
			const height = this.container?.clientHeight || 800;
			return {
				longitude: centre.lng,
				latitude: centre.lat,
				z: altitudeForZoom(zoom, centre.lat, height),
				tilt: this.map.getPitch(),
				heading: this.map.getBearing(),
				scale: scaleForZoom(zoom, centre.lat),
				zoom
			};
		},

		flyTo: (target: CameraTarget, opts: FlyOptions = {}): Promise<void> => {
			if (!this.map) return Promise.resolve();
			const current = this.camera.get();
			const latitude = target.latitude ?? current?.latitude ?? 0;
			const height = this.container?.clientHeight || 800;
			const zoom =
				target.z != null
					? zoomForAltitude(target.z, latitude, height)
					: (target.zoom ??
						(target.scale != null ? zoomForScale(target.scale, latitude) : current?.zoom));
			const duration = opts.duration ?? 1500;

			this.map.easeTo({
				center: [target.longitude ?? current?.longitude ?? 0, latitude],
				zoom,
				pitch: target.tilt ?? current?.tilt ?? 0,
				bearing: target.heading ?? current?.heading ?? 0,
				...(opts.padding ? { padding: opts.padding } : {}),
				duration
			});

			if (duration === 0) return Promise.resolve();
			// Resolve when the move settles. A newer move fires its own `moveend`,
			// which resolves this one too — the contract only promises "settled or
			// superseded", never a rejection.
			return new Promise((resolve) => {
				this.map.once('moveend', () => resolve());
			});
		},

		zoomBy: (delta: number, durationMs = 300): void => {
			this.map?.easeTo({ zoom: this.map.getZoom() + delta, duration: durationMs });
		}
	};

	// ── screen ────────────────────────────────────────────────────────

	readonly screen: ScreenPort = {
		size: () => ({
			width: this.container?.clientWidth ?? 0,
			height: this.container?.clientHeight ?? 0
		}),

		/**
		 * Projects a ground point. On the globe, MapLibre still projects points on
		 * the far side, so the same dot-product test the pin projection uses decides
		 * whether the point actually faces the camera.
		 */
		toScreen: (p: LngLat): ScreenPoint | null => {
			if (!this.map) return null;
			const centre = this.map.getCenter();
			if (this.mode === '3d' && !facesCamera(p, { lng: centre.lng, lat: centre.lat })) return null;
			const projected = this.map.project([p.lng, p.lat]);
			if (!projected || Number.isNaN(projected.x) || Number.isNaN(projected.y)) return null;
			return { x: projected.x, y: projected.y };
		},

		toMap: (p: ScreenPoint): LngLat | null => {
			if (!this.map) return null;
			try {
				const ll = this.map.unproject([p.x, p.y]);
				if (!ll || Number.isNaN(ll.lng) || Number.isNaN(ll.lat)) return null;
				return { lng: ll.lng, lat: ll.lat };
			} catch {
				// Off the globe (the pixel is in space) — a miss, not an error.
				return null;
			}
		}
	};

	// ── events ────────────────────────────────────────────────────────

	/** @returns The event port bound to this provider's map. */
	private buildEventPort(): EventPort {
		// `self` is load-bearing, not laziness: the ports below are object literals
		// with getters, and a getter's `this` is the literal, not the provider. An
		// arrow function cannot express a getter, so the alias is how the getters
		// reach the live view.
		// eslint-disable-next-line @typescript-eslint/no-this-alias -- see above
		const self = this;
		/** Subscribes to one or more MapLibre events and returns one handle. */
		function sub(names: string[], handler: (e: any) => void): Handle {
			for (const n of names) self.map.on(n, handler);
			return {
				// Teardown order is not ours to control: `<MapCanvas>` destroys the
				// engine (and with it the map) on unmount, and a capability's
				// `destroy()` removes its handles afterwards — so by the time this
				// runs the map may already be gone. Unsubscribing from a destroyed
				// map is a no-op worth tolerating, not a crash worth propagating.
				remove() {
					for (const n of names) self.map?.off?.(n, handler);
				}
			};
		}

		return {
			on<K extends keyof ProviderEvents>(name: K, handler: (e: ProviderEvents[K]) => void): Handle {
				const cb = handler as (e: any) => void;
				switch (name) {
					case 'pointer-move':
						return sub(['mousemove'], (e) => cb({ x: e.point.x, y: e.point.y, native: e }));
					case 'pointer-leave':
						return sub(['mouseout'], () => cb(undefined));
					case 'click':
						return sub(['click'], (e) =>
							cb({
								x: e.point.x,
								y: e.point.y,
								native: e,
								lngLat: e.lngLat ? { lng: e.lngLat.lng, lat: e.lngLat.lat } : null
							})
						);
					case 'camera':
						return sub(['move'], () => {
							const state = self.camera.get();
							if (state) cb(state);
						});
					case 'stationary':
						// Settled AND streaming stopped ≙ `idle`; movement resuming ≙ `movestart`.
						return sub(['idle', 'movestart'], (e) => cb(e?.type === 'idle'));
					case 'interacting':
						return sub(
							[
								'dragstart',
								'zoomstart',
								'rotatestart',
								'pitchstart',
								'dragend',
								'zoomend',
								'rotateend',
								'pitchend'
							],
							(e) => cb(!String(e?.type ?? '').endsWith('end'))
						);
					case 'updating':
						return sub(['dataloading', 'idle'], (e) => cb(e?.type !== 'idle'));
					case 'size':
						return sub(['resize'], () => cb(self.screen.size()));
					case 'padding':
						return sub(['move'], () => cb(self.scene.getPadding()));
					default:
						return { remove() {} };
				}
			},
			/** Whether a deliberate user gesture is in progress right now. */
			get interacting(): boolean {
				return self.gesturing;
			},
			/** Whether tiles or sources are still settling right now. */
			get updating(): boolean {
				return !(self.map?.loaded?.() && self.map?.areTilesLoaded?.());
			}
		};
	}

	// ── scene ─────────────────────────────────────────────────────────

	readonly scene: ScenePort = {
		setBasemap: async (spec: BasemapSpec): Promise<void> => {
			if (!this.map) return;
			switch (spec.kind) {
				case 'flat':
					this.applyStyle(flatStyleFor(spec.landColor, spec.oceanColor));
					break;
				case 'style':
					this.applyStyle(spec.url);
					break;
				case 'well-known': {
					const known = KNOWN_STYLES[spec.id];
					if (!known) {
						// A provider's built-in basemap id is provider-specific by
						// definition; an ArcGIS id cannot be drawn here.
						throw new ProviderMismatchError('arcgis', 'maplibre', `The basemap '${spec.id}'`);
					}
					this.applyStyle(known);
					break;
				}
				case 'native': {
					let built = this.basemapCache.get(spec.key);
					if (!built) {
						built = await spec.load(this.native('maplibre'));
						this.basemapCache.set(spec.key, built);
					}
					// A native loader may hand back a style document or a style URL.
					if (typeof built === 'string' || (built && typeof built === 'object')) {
						this.applyStyle(built as any);
					}
					break;
				}
			}
			await this.restyled();
		},

		setBackground: (color: string): void => {
			// The canvas itself is transparent, so the container's background shows
			// through where the style does not paint — the closest equivalent to a
			// scene background.
			if (this.container) this.container.style.background = color;
		},

		/** No-op: MapLibre has no globe interior to colour. */
		setGround: (): void => {},

		setQuality: (q: QualityOptions): void => {
			if (q.maxPixelRatio != null) this.map?.setPixelRatio?.(q.maxPixelRatio);
		},

		setPadding: (p: Padding): void => {
			this.map?.setPadding?.(p);
		},

		getPadding: (): Padding => {
			const p = this.map?.getPadding?.();
			return p
				? { top: p.top, right: p.right, bottom: p.bottom, left: p.left }
				: { top: 0, right: 0, bottom: 0, left: 0 };
		},

		setCursor: (cursor: string): void => {
			const canvas = this.map?.getCanvas?.();
			if (canvas) canvas.style.cursor = cursor;
		},

		whenSettled: (): Promise<void> =>
			new Promise((resolve) => {
				if (!this.map || (this.map.loaded?.() && this.map.areTilesLoaded?.())) {
					resolve();
					return;
				}
				this.map.once('idle', () => resolve());
			})
	};

	/**
	 * Swaps the style and replays every live layer into it — MapLibre drops all
	 * sources and layers on `setStyle`, so the handles rebuild themselves.
	 *
	 * The projection lives on the style too, so a swap silently drops the globe
	 * back to Mercator unless it is re-asserted. That is done here rather than at
	 * construction, because a constructor `projection` option is ignored.
	 *
	 * @param style - A style URL or a style document.
	 */
	private applyStyle(style: string | object): void {
		this.map.setStyle(style as any);
		this.applyProjection();
	}

	/**
	 * Puts the view back into globe projection (3D mode only).
	 *
	 * MapLibre treats the projection as a style property, so it must be set after
	 * the map exists and re-set after every style swap — passing it to the `Map`
	 * constructor has no effect.
	 */
	applyProjection(): void {
		if (this.mode !== '3d') return;
		this.map?.setProjection?.({ type: 'globe' });
	}

	/**
	 * Resolves once the new style is live, then reattaches the layers.
	 *
	 * Two things make this harder than awaiting one event. `styledata` fires
	 * several times while a style loads and the first one is far too early —
	 * adding a source, a layer or an image before the style is done throws
	 * "Style is not done loading". But waiting for `isStyleLoaded()` alone can
	 * wait forever, because the flag may flip in the same tick the listener is
	 * attached, or a source may never settle.
	 *
	 * So: check immediately, then on either `styledata` or `idle`, and give up
	 * after {@link STYLE_SETTLE_TIMEOUT_MS} and carry on regardless. A basemap is
	 * cosmetic; the engine awaits this during `init`, so a style that never
	 * settles must not be able to deadlock the whole view.
	 */
	private restyled(): Promise<void> {
		return new Promise((resolve) => {
			let settled = false;
			const finish = () => {
				if (settled) return;
				settled = true;
				this.map?.off?.('styledata', check);
				this.map?.off?.('idle', check);
				clearTimeout(timer);
				for (const layer of this.liveLayers) layer.reattach();
				resolve();
			};
			const check = () => {
				if (this.map?.isStyleLoaded?.()) finish();
			};
			const timer = setTimeout(finish, STYLE_SETTLE_TIMEOUT_MS);
			this.map.on('styledata', check);
			this.map.on('idle', check);
			check();
		});
	}

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
				self.track(createPointLayer(self.map, spec)),
			geojson: (spec: GeoJsonLayerSpec): GeoJsonLayerHandle =>
				self.track(createGeoJsonLayer(self.map, spec)),
			get all(): readonly LayerHandle[] {
				return [...self.liveLayers];
			}
		};
	}

	/** Registers a handle as live and un-registers it when it removes itself. */
	private track<T extends LayerHandle & MaplibreLayer>(handle: T): T {
		this.liveLayers.push(handle);
		const remove = handle.remove.bind(handle);
		handle.remove = () => {
			const i = this.liveLayers.indexOf(handle);
			if (i >= 0) this.liveLayers.splice(i, 1);
			remove();
		};
		return handle;
	}

	// ── native / lifecycle ────────────────────────────────────────────

	native<K extends ProviderKind>(kind: K): NativeSurfaces[K] {
		if (kind !== 'maplibre') throw new ProviderMismatchError(kind, 'maplibre');
		return { kind: 'maplibre', map: this.map } as NativeSurfaces[K];
	}

	destroy(): void {
		for (const handle of [...this.liveLayers]) handle.remove();
		this.liveLayers.length = 0;
		this.basemapCache.clear();
		this.map?.remove?.();
		this.map = null;
	}
}

/**
 * Whether a ground point faces the camera on a globe — the same unit-vector dot
 * product the pin projection uses to hide points behind the earth.
 *
 * @param p - The point to test.
 * @param centre - The map centre (the point the camera looks at).
 * @returns True when the point is on the near side.
 */
function facesCamera(p: LngLat, centre: LngLat): boolean {
	const rad = Math.PI / 180;
	const unit = (ll: LngLat) => ({
		x: Math.cos(ll.lat * rad) * Math.cos(ll.lng * rad),
		y: Math.cos(ll.lat * rad) * Math.sin(ll.lng * rad),
		z: Math.sin(ll.lat * rad)
	});
	const a = unit(p);
	const b = unit(centre);
	return a.x * b.x + a.y * b.y + a.z * b.z > 0;
}

/**
 * A minimal two-colour style: an ocean-coloured background with land drawn from
 * MapLibre's public demo tiles.
 *
 * @param landColor - Hex colour for land masses.
 * @param oceanColor - Hex colour for ocean/marine areas.
 * @returns A MapLibre style document.
 */
export function flatStyleFor(landColor: string, oceanColor: string): object {
	return {
		version: 8,
		sources: {
			land: { type: 'vector', url: DEMO_TILES_URL }
		},
		layers: [
			{ id: 'ocean', type: 'background', paint: { 'background-color': oceanColor } },
			{
				id: 'land',
				type: 'fill',
				source: 'land',
				'source-layer': 'countries',
				paint: { 'fill-color': landColor }
			}
		]
	};
}
