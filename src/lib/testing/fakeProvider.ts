/**
 * @module testing/fakeProvider
 * The in-memory {@link MapProvider} — the second adapter that makes the provider
 * seam real. Capability tests drive it by firing events and inspecting the
 * layers it recorded; nothing here touches ArcGIS or MapLibre.
 */

import { vi } from 'vitest';
import type { MapEngine } from '$lib/map-engine/index.js';
import {
	ProviderMismatchError,
	type CameraState,
	type GeoJsonLayerHandle,
	type GeoJsonLayerSpec,
	type GeoJsonStyle,
	type Handle,
	type MapProvider,
	type Padding,
	type Placement,
	type PointItem,
	type PointLayerHandle,
	type PointLayerSpec,
	type PointSymbol,
	type ProviderEvents,
	type ProviderKind,
	type ScreenPoint
} from '$lib/map-engine/provider.js';
import type { GlobeContext } from '$lib/globe/capability.js';

/* eslint-disable @typescript-eslint/no-explicit-any -- test double */

/** A recorded points layer: the handle plus the state tests assert on. */
export interface FakePointLayer extends PointLayerHandle {
	kind: 'points';
	items: PointItem[];
	visible: boolean;
	opacity: number;
	scaleRange: [number, number];
	placement: Placement;
	removed: boolean;
}

/** A recorded GeoJSON layer. */
export interface FakeGeoJsonLayer extends GeoJsonLayerHandle {
	kind: 'geojson';
	source: GeoJsonLayerSpec['source'];
	style: GeoJsonStyle;
	visible: boolean;
	opacity: number;
	scaleRange: [number, number];
	placement: Placement;
	removed: boolean;
}

export type FakeLayer = FakePointLayer | FakeGeoJsonLayer;

/** The fake provider plus the knobs tests poke. */
export interface FakeProvider extends MapProvider {
	/** Every layer ever created, including removed ones (check `.removed`). */
	readonly created: FakeLayer[];
	/** Live layers by id. */
	layer(id: string): FakeLayer | undefined;
	/** Fires an event to every subscriber, awaiting async handlers. */
	fire<K extends keyof ProviderEvents>(name: K, e?: ProviderEvents[K]): Promise<void>;
	/** Mutates the live camera (also fires `camera` when `emit` is true). */
	setCamera(patch: Partial<CameraState>, emit?: boolean): void;
	/** Per-layer hit results returned by `hitTest`: layer id → item id. */
	hits: Record<string, string | null>;
	/** Last cursor set through `scene.setCursor`. */
	cursor: string;
	/** Recorded `camera.flyTo` calls. */
	flyCalls: { target: unknown; opts: unknown }[];
	/** Recorded `scene.setBasemap` calls. */
	basemaps: unknown[];
	/** Recorded `scene.setBackground` calls. */
	backgrounds: string[];
	/** Recorded `scene.setQuality` calls. */
	quality: unknown[];
	/** Flip the synchronous flags. */
	flags: { interacting: boolean; updating: boolean };
}

export interface FakeProviderOptions {
	kind?: ProviderKind;
	mode?: '3d' | '2d';
	camera?: Partial<CameraState>;
	/** Native surfaces `native(kind)` should return instead of throwing. */
	native?: Partial<Record<ProviderKind, any>>;
	/** Screen projection override (default: a flat 2 px/degree mapping around 500,400). */
	toScreen?: (p: { lng: number; lat: number }) => ScreenPoint | null;
	/** Unprojection override (default: the inverse of the `toScreen` default). */
	toMap?: (p: ScreenPoint) => { lng: number; lat: number } | null;
	/** View size override (default 1000×800). */
	size?: { width: number; height: number };
}

const DEFAULT_CAMERA: CameraState = {
	longitude: 0,
	latitude: 20,
	z: 12_000_000,
	tilt: 0,
	heading: 0,
	scale: 50_000_000,
	zoom: 3.56
};

export function makeFakeProvider(options: FakeProviderOptions = {}): FakeProvider {
	// Keyed loosely: a generic `K extends keyof ProviderEvents` index narrows to
	// `never` on write, and a test double gains nothing from that precision.
	const handlers: Record<string, ((e: any) => void | Promise<void>)[]> = {};
	const created: FakeLayer[] = [];
	const live = new Map<string, FakeLayer>();
	const cam: CameraState = { ...DEFAULT_CAMERA, ...options.camera };
	let padding: Padding = { top: 0, right: 0, bottom: 0, left: 0 };
	const flags = { interacting: false, updating: false };

	const toScreen =
		options.toScreen ??
		((p: { lng: number; lat: number }) => ({ x: 500 + p.lng * 2, y: 400 - p.lat * 2 }));
	const toMap =
		options.toMap ?? ((s: ScreenPoint) => ({ lng: (s.x - 500) / 2, lat: (400 - s.y) / 2 }));
	const size = options.size ?? { width: 1000, height: 800 };

	function baseHandle(
		spec: { id: string; placement?: Placement; visible?: boolean; opacity?: number },
		extra: Record<string, unknown>
	): any {
		const h: any = {
			id: spec.id,
			visible: spec.visible ?? true,
			opacity: spec.opacity ?? 1,
			scaleRange: [0, 0] as [number, number],
			placement: spec.placement ?? 'draped',
			removed: false,
			setVisible(v: boolean) {
				h.visible = v;
			},
			getVisible: () => h.visible,
			setOpacity(o: number) {
				h.opacity = o;
			},
			getOpacity: () => h.opacity,
			setScaleRange(a: number, b: number) {
				h.scaleRange = [a, b];
			},
			setPlacement(p: Placement) {
				h.placement = p;
			},
			remove() {
				h.removed = true;
				live.delete(spec.id);
			},
			...extra
		};
		created.push(h);
		live.set(spec.id, h);
		return h;
	}

	const provider: FakeProvider = {
		kind: options.kind ?? 'fake',
		mode: options.mode ?? '3d',
		created,
		layer: (id) => live.get(id),
		hits: {},
		cursor: 'grab',
		flyCalls: [],
		basemaps: [],
		backgrounds: [],
		quality: [],
		flags,
		camera: {
			get: () => ({ ...cam }),
			flyTo: vi.fn(async (target, opts) => {
				provider.flyCalls.push({ target, opts });
			}),
			zoomBy: vi.fn()
		},
		screen: {
			size: () => size,
			toScreen,
			toMap
		},
		events: {
			on(name, handler): Handle {
				const key = name as string;
				(handlers[key] ??= []).push(handler as (e: any) => void);
				return {
					remove() {
						handlers[key] = (handlers[key] ?? []).filter((h) => h !== handler);
					}
				};
			},
			get interacting() {
				return flags.interacting;
			},
			get updating() {
				return flags.updating;
			}
		},
		scene: {
			setBasemap: vi.fn(async (spec) => {
				provider.basemaps.push(spec);
			}),
			setBackground: vi.fn((c) => {
				provider.backgrounds.push(c);
			}),
			setGround: vi.fn(),
			setQuality: vi.fn((q) => {
				provider.quality.push(q);
			}),
			setPadding(p) {
				padding = p;
			},
			getPadding: () => padding,
			setCursor(c) {
				provider.cursor = c;
			},
			whenSettled: async () => {}
		},
		layers: {
			points(spec: PointLayerSpec): PointLayerHandle {
				const h: FakePointLayer = baseHandle(spec, {
					kind: 'points',
					items: [...(spec.items ?? [])],
					set(items: readonly PointItem[]) {
						h.items = [...items];
					},
					restyle(id: string, symbol: PointSymbol) {
						const it = h.items.find((x) => x.id === id);
						if (it) it.symbol = symbol;
					},
					hitTest: async () => provider.hits[spec.id] ?? null
				});
				return h;
			},
			geojson(spec: GeoJsonLayerSpec): GeoJsonLayerHandle {
				const h: FakeGeoJsonLayer = baseHandle(spec, {
					kind: 'geojson',
					source: spec.source,
					style: spec.style,
					setStyle(style: GeoJsonStyle) {
						h.style = style;
					}
				});
				return h;
			},
			get all() {
				return [...live.values()];
			}
		},
		native(kind) {
			const surface = options.native?.[kind];
			if (surface) return surface;
			if (kind === (options.kind ?? 'fake')) return { kind: 'fake' } as any;
			throw new ProviderMismatchError(kind, options.kind ?? 'fake');
		},
		destroy: vi.fn(),
		async fire(name, e) {
			for (const h of handlers[name as string] ?? []) await h(e);
		},
		setCamera(patch, emit = false) {
			Object.assign(cam, patch);
			if (emit) void provider.fire('camera', { ...cam });
		}
	};
	return provider;
}

/** A {@link GlobeContext} over a fake provider, plus the provider for assertions. */
export function makeFakeContext(
	options: FakeProviderOptions & { engine?: Partial<MapEngine> } = {}
): { ctx: GlobeContext; provider: FakeProvider } {
	const provider = makeFakeProvider(options);
	const engine = { hover: null, provider, ...options.engine } as unknown as MapEngine;
	return { ctx: { engine, provider, mode: provider.mode }, provider };
}
