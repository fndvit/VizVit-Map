/**
 * @module globe/context
 * Builds the {@link GlobeContext} handed to every capability.
 *
 * Clean Code Ch11 ("Separate Constructing a System from Using It"): the context
 * is assembled once, after the engine has a ready provider, so capabilities just
 * use it.
 */

import type { MapEngine } from '$lib/map-engine/index.js';
import type { GlobeContext } from './capability.js';

/**
 * Creates a {@link GlobeContext} for a ready engine.
 *
 * @param engine - The booted {@link MapEngine}; `engine.provider` must be live.
 * @throws If the engine has no provider yet (called before `init` resolved).
 */
export function buildGlobeContext(engine: MapEngine): GlobeContext {
	const provider = engine.provider;
	if (!provider) {
		throw new Error(
			'buildGlobeContext: the engine has no live provider yet (await engine.init first).'
		);
	}
	return { engine, provider, mode: provider.mode };
}
