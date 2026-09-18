/**
 * @module map-engine/arcgis/basemap
 * Applies a provider-neutral {@link BasemapSpec} to an ArcGIS view.
 *
 * The adapter knows four kinds of basemap and nothing about the app's basemap
 * *ids* — resolving `'natgeo-soils'` to a portal item is the app basemap
 * catalog's job (`$lib/config/map`). Dispatch is keyed off the spec's `kind`, so
 * adding a kind never requires editing an existing branch (OCP).
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- ArcGIS dynamic imports have no static types */

import { buildFlatStyle } from './flatStyle.js';
import type { ArcgisModules } from '../types.js';
import type { BasemapSpec } from '../provider.js';

/**
 * Fallback flat colours when a `native`/`style` basemap needs a synchronous
 * placeholder. Neutral engine values — an app that cares passes a `flat` spec.
 */
const FALLBACK_FLAT = { landColor: '#725B53', oceanColor: '#E5DACA' } as const;

/**
 * A cache of the *custom* `Basemap` instances this module builds (flat styles
 * and app-supplied native basemaps), keyed by {@link customBasemapKey}. Reusing
 * instances across swaps is how we avoid the WebGL leak — see {@link swapBasemap}.
 */
export type BasemapCache = Map<string, any>;

/**
 * Assigns a basemap to the view. Does NOT destroy the previous one.
 *
 * Two kinds of basemap flow through here and both make destroy-on-swap unsafe:
 *
 * - **well-known** basemaps are assigned as an id string (e.g. `'gray-vector'`),
 *   which ArcGIS autocasts from its *shared* well-known basemap registry.
 *   Destroying one destroys the shared `baseLayers`, so returning to that id
 *   later hands back a poisoned instance whose `.load()` rejects (blank globe).
 * - **custom** basemaps (flat/style/native) are instead reused from a per-provider
 *   {@link BasemapCache}; the same instance is reattached on every revisit, so
 *   there is nothing to leak between swaps and its GPU tiles stay warm.
 *
 * Cached custom instances are released once, at provider teardown, not here.
 *
 * @param view - A ready ArcGIS view.
 * @param next - A `Basemap` instance or an ArcGIS basemap id string.
 */
function swapBasemap(view: any, next: any): void {
	view.map.basemap = next;
}

/**
 * Cache key for a basemap we own and may reuse, or `null` for `well-known`
 * basemaps (ArcGIS owns/caches those — we keep them as id strings).
 *
 * @param spec - The basemap to key.
 * @returns A stable cache key, or `null` when the basemap must not be cached here.
 */
function customBasemapKey(spec: BasemapSpec): string | null {
	switch (spec.kind) {
		case 'flat':
			return `flat:${spec.landColor}|${spec.oceanColor}`;
		case 'style':
			return `style:${spec.url}`;
		case 'native':
			return `native:${spec.key}`;
		case 'well-known':
			return null;
	}
}

/**
 * Returns the cached basemap for `key`, or builds it via `build`, stores it, and
 * returns it. Mirrors how ArcGIS caches its own well-known basemaps. When no
 * cache is supplied (e.g. unit tests), every call builds a fresh instance.
 *
 * @param cache - The provider's cache, or `undefined` to always build.
 * @param key - Cache key from {@link customBasemapKey}.
 * @param build - Builds the instance on a miss.
 * @returns The cached or freshly built `Basemap`.
 */
async function getOrBuildCustomBasemap(
	cache: BasemapCache | undefined,
	key: string,
	build: () => any | Promise<any>
): Promise<any> {
	if (!cache) return build();
	const cached = cache.get(key);
	if (cached) return cached;
	const built = await build();
	cache.set(key, built);
	return built;
}

/** Synchronous variant of {@link getOrBuildCustomBasemap} for {@link initialBasemap}. */
function getOrBuildCustomBasemapSync(
	cache: BasemapCache | undefined,
	key: string,
	build: () => any
): any {
	if (!cache) return build();
	const cached = cache.get(key);
	if (cached) return cached;
	const built = build();
	cache.set(key, built);
	return built;
}

/**
 * Builds a flat-colour `Basemap` instance.
 *
 * @param modules - ArcGIS constructors (needs `Basemap` + `VectorTileLayer`).
 * @param landColor - Hex colour for land masses.
 * @param oceanColor - Hex colour for ocean/marine areas.
 * @returns A new ArcGIS `Basemap`.
 */
function buildFlatBasemap(modules: ArcgisModules, landColor: string, oceanColor: string): any {
	return new modules.Basemap({
		baseLayers: [new modules.VectorTileLayer({ style: buildFlatStyle(oceanColor, landColor) })]
	});
}

/**
 * Resolves the basemap value to use when first constructing a view — a value
 * available synchronously so `view.when()` is never blocked on a network load.
 *
 * `flat` returns a `Basemap` instance; `well-known` returns the ArcGIS id string;
 * `style` and `native` return a neutral flat placeholder (the real basemap is
 * swapped in by {@link applyBasemap} once the view is ready).
 *
 * @param modules - ArcGIS constructors.
 * @param spec - The basemap to show.
 * @param cache - Per-provider cache; built instances are stored so a later return
 *   to this basemap reuses them instead of rebuilding (and orphaning) one.
 * @returns A `Basemap` instance or an ArcGIS basemap id string.
 */
export function initialBasemap(
	modules: ArcgisModules,
	spec: BasemapSpec,
	cache?: BasemapCache
): any {
	if (spec.kind === 'well-known') return spec.id;
	if (spec.kind === 'flat') {
		return getOrBuildCustomBasemapSync(cache, customBasemapKey(spec)!, () =>
			buildFlatBasemap(modules, spec.landColor, spec.oceanColor)
		);
	}
	// Defer the async style/native load — start with a neutral flat placeholder,
	// itself cached as a real flat basemap for later reuse.
	const placeholder: BasemapSpec = { kind: 'flat', ...FALLBACK_FLAT };
	return getOrBuildCustomBasemapSync(cache, customBasemapKey(placeholder)!, () =>
		buildFlatBasemap(modules, FALLBACK_FLAT.landColor, FALLBACK_FLAT.oceanColor)
	);
}

/**
 * Returns `true` when constructing a view with this basemap still requires a
 * follow-up {@link applyBasemap} call after `view.when()` — i.e. the basemap
 * loads asynchronously (`style`, `native`) or the caller's catalog may want to
 * decorate it (`well-known`). Flat basemaps resolve synchronously and need none.
 *
 * @param spec - The basemap to test.
 * @returns Whether a deferred apply is needed.
 */
export function needsDeferredApply(spec: BasemapSpec): boolean {
	return spec.kind !== 'flat';
}

/**
 * Applies a basemap to a live view, dispatching by kind.
 *
 * Pass `isCurrent` to discard stale async loads — when a newer basemap swap has
 * started while a fetch was in flight, the result is dropped instead of
 * clobbering the newer basemap.
 *
 * @param view - A ready ArcGIS view (`SceneView` or `MapView`).
 * @param spec - The basemap to apply.
 * @param modules - ArcGIS constructors.
 * @param native - The provider's ArcGIS native surface, handed to a `native` spec's loader.
 * @param isCurrent - Returns `false` if this call has been superseded; defaults to always-current.
 * @param cache - Per-provider cache of custom basemaps. Reused on revisit instead
 *   of rebuilt; well-known basemaps are never cached here.
 */
export async function applyBasemap(
	view: any,
	spec: BasemapSpec,
	modules: ArcgisModules,
	native: unknown,
	isCurrent: () => boolean = () => true,
	cache?: BasemapCache
): Promise<void> {
	switch (spec.kind) {
		case 'well-known':
			swapBasemap(view, spec.id);
			return;
		case 'flat': {
			const flat = await getOrBuildCustomBasemap(cache, customBasemapKey(spec)!, () =>
				buildFlatBasemap(modules, spec.landColor, spec.oceanColor)
			);
			if (!isCurrent()) return;
			swapBasemap(view, flat);
			return;
		}
		case 'style': {
			const styled = await getOrBuildCustomBasemap(
				cache,
				customBasemapKey(spec)!,
				() =>
					new modules.Basemap({
						baseLayers: [new modules.VectorTileLayer({ url: spec.url })]
					})
			);
			if (!isCurrent()) return;
			swapBasemap(view, styled);
			return;
		}
		case 'native': {
			const built = await getOrBuildCustomBasemap(cache, customBasemapKey(spec)!, () =>
				spec.load(native)
			);
			if (!isCurrent()) return;
			swapBasemap(view, built);
			return;
		}
	}
}
