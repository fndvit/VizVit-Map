/**
 * @module globe/capability
 * The capability (feature-module) contract and the stable context it depends on.
 *
 * Each globe feature — markers, pins, data layers, hover, … — is a self-contained
 * {@link Capability} with a tiny lifecycle. Capabilities depend ONLY on the
 * {@link GlobeContext} abstraction (Clean Code Ch10: DIP), never on each other,
 * so a feature can be added or removed without touching its siblings or the core
 * (Ch10: OCP). The `<Globe>` component owns the context and drives the lifecycle.
 *
 * The context hands a capability the **map provider** (`ctx.provider`), the
 * provider-neutral view behind five ports (camera, screen, events, scene,
 * layers). A capability that is inherently bound to one SDK — the explore dot
 * tiers, which are Arcade + SQL + `FeatureLayer` — declares `requires` and
 * reaches the SDK through `ctx.provider.native('arcgis')`; the registry refuses
 * to mount it on any other provider.
 */

import type { MapEngine, ViewMode } from '$lib/map-engine/index.js';
import type { MapProvider, ProviderKind } from '$lib/map-engine/provider.js';
import type { GlobeConfig } from './config.js';

/**
 * The stable surface every capability is given.
 *
 * - `provider` — the neutral view: `camera`, `screen`, `events`, `scene`,
 *   `layers`, and the typed `native()` escape hatch.
 * - `engine` — lifecycle-level services the provider does not own: the generic
 *   hover loop (`engine.hover`), geocoded fly-to, the basemap catalog.
 */
export interface GlobeContext {
	/** The engine hosting the view (hover loop, catalog, geocoding). */
	readonly engine: MapEngine;
	/** The provider-neutral live view. */
	readonly provider: MapProvider;
	/** Which view the engine drives. */
	readonly mode: ViewMode;
}

/**
 * A globe feature with a small, idempotent lifecycle.
 *
 * @typeParam C - The capability's slice of {@link GlobeConfig}.
 */
export interface Capability<C> {
	/** Stable identifier (used in the registry and tests). */
	readonly name: string;
	/**
	 * The one provider this capability can run on, when it is SDK-bound. Omit for
	 * provider-neutral capabilities. The registry throws
	 * {@link ProviderMismatchError} at resolve time — before `setup` — when the
	 * view's provider differs.
	 */
	readonly requires?: ProviderKind;
	/** Attach the feature to the ready view. Called once. */
	setup(ctx: GlobeContext, config: C): void | Promise<void>;
	/** Re-apply on a reactive config change. Optional. */
	update?(ctx: GlobeContext, config: C): void;
	/** Detach and release resources. Must be safe to call once. Optional. */
	destroy?(): void;
}

/**
 * A rule binding a config sub-object to a capability (type-erased for the array).
 * Lives here, not in the registry, so capability files can declare their own rule
 * without importing the registry back (keeps the dependency graph acyclic).
 */
export interface CapabilityRule {
	name: string;
	/** True when this capability should be active for the given config. */
	applies(config: GlobeConfig): boolean;
	/** Extracts this capability's slice of the config. */
	select(config: GlobeConfig): unknown;
	/** Constructs a fresh capability instance. */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- erased for the homogeneous rule array
	create(): Capability<any>;
}

/** A resolved, ready-to-mount capability paired with its config selector. */
export interface ResolvedCapability {
	name: string;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- erased for the homogeneous rule array
	capability: Capability<any>;
	select: (config: GlobeConfig) => unknown;
}

/**
 * Type-checked rule definition. The closure keeps the concrete slice type `C` at
 * the definition site; the returned rule is erased so rules of different slice
 * types live in one homogeneous array.
 */
export function defineRule<C>(rule: {
	name: string;
	applies(config: GlobeConfig): boolean;
	select(config: GlobeConfig): C;
	create(): Capability<C>;
}): CapabilityRule {
	return rule as CapabilityRule;
}
