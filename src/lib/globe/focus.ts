/**
 * @module globe/focus
 * How a capability learns the region it is confined to.
 *
 * {@link FocusConfig.confine} names the capabilities that confine themselves
 * to the focused region. A capability's rule reads its region here, in
 * `select`, from the whole config — so a capability never depends on the
 * `focus` capability or on any other sibling, and a host capability opts in
 * exactly like the package's own:
 *
 * ```ts
 * export const labelsRule = defineRule({
 * 	name: 'labels',
 * 	applies: (config) => config.labels != null,
 * 	select: (config) => ({ ...config.labels!, region: focusRegionFor(config, 'labels') }),
 * 	create: () => createLabelsCapability()
 * });
 * ```
 */

import type { FocusRegion, GlobeConfig } from './config.js';
import { loadRegionShape, type RegionShape } from '../geo/region.js';

/**
 * The focused region a capability is confined to.
 *
 * @param config - The globe config.
 * @param name - The capability's name, as {@link FocusConfig.confine} lists it.
 * @returns The region when the config focuses one and confines `name` to it;
 *   `null` otherwise.
 */
export function focusRegionFor(config: GlobeConfig, name: string): FocusRegion | null {
	const focus = config.focus;
	if (!focus?.region || !focus.confine?.includes(name)) return null;
	return focus.region;
}

/**
 * Follows the region a capability is confined to and hands it the loaded
 * shape: once per region id, never a stale one. What `markers` and `pins` do
 * with the region from {@link focusRegionFor}, and what a host capability can
 * reuse.
 *
 * Setting the same region id again does nothing; a new id loads its shape
 * (`loadRegionShape` caches one fetch per URL) and calls `onShape` unless a
 * later `set` superseded it; `null` calls `onShape(null)` at once. A shape
 * that fails to load is logged and leaves the capability as it was.
 */
export interface FocusRegionTracker {
	/**
	 * Follows a region.
	 *
	 * @param region - The region from {@link focusRegionFor}, or `null`.
	 */
	set(region: FocusRegion | null | undefined): void;
}

/**
 * Creates a {@link FocusRegionTracker}.
 *
 * @param onShape - Receives the loaded shape, or `null` when unconfined.
 * @param load - Loads a region's shape. Default: `loadRegionShape`.
 * @returns The tracker.
 */
export function createFocusRegionTracker(
	onShape: (shape: RegionShape | null) => void,
	load: (src: string) => Promise<RegionShape> = loadRegionShape
): FocusRegionTracker {
	let currentId: string | null = null;
	let generation = 0;
	return {
		set(region) {
			const id = region?.id ?? null;
			if (id === currentId) return;
			currentId = id;
			const mine = ++generation;
			if (!region) {
				onShape(null);
				return;
			}
			load(region.src)
				.then((shape) => {
					if (mine === generation) onShape(shape);
				})
				.catch((error: unknown) => {
					console.warn(`focus: region '${region.id}' failed to load:`, error);
				});
		}
	};
}
