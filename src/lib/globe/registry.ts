/**
 * @module globe/registry
 * The OCP seam: the ONE place that maps config presence → active capabilities.
 *
 * Clean Code Ch10 (OCP): adding a globe feature means adding one rule and a
 * capability file — never editing `<Globe>` or the engine. Each capability file
 * declares its own rule (via `defineRule`); this module only aggregates the
 * library's own rules and resolves a config against a rule set.
 *
 * The rule set is **injectable**, which is what makes the globe layer
 * publishable: {@link DEFAULT_CAPABILITY_RULES} is the neutral set a package can
 * ship (markers, hover, pins, outlines), and a host adds its domain-bound
 * capabilities — this site's explore dot tiers, hex overlay and click-to-inspect
 * — by passing its own set through {@link GlobeConfig.capabilities}
 * (`$lib/site-globe/rules`). A published `<Globe>` must not carry a rule whose
 * module imports the explore engine.
 */

import { ProviderMismatchError, type ProviderKind } from '$lib/map-engine/provider.js';
import type { GlobeConfig } from './config.js';
import type { CapabilityRule, ResolvedCapability } from './capability.js';
import { markersRule } from './capabilities/markersCapability.js';
import { hoverRule } from './capabilities/hoverCapability.js';
import { pinsRule } from './capabilities/pinsCapability.js';
import { outlinesRule } from './capabilities/outlineCapability.js';

export type { CapabilityRule, ResolvedCapability } from './capability.js';
export { defineRule } from './capability.js';

/**
 * The capability rules the globe library itself ships — every one of them
 * provider-neutral and domain-free. Used when a config names no
 * {@link GlobeConfig.capabilities} set of its own.
 */
export const DEFAULT_CAPABILITY_RULES: CapabilityRule[] = [
	markersRule,
	hoverRule,
	pinsRule,
	outlinesRule
];

/**
 * Resolves which capabilities a config activates. Presence of a sub-config →
 * its capability; absence → the feature is simply not mounted.
 *
 * The rule set is resolved in one order: an explicit `rules` argument (tests
 * inject fakes), else the config's own {@link GlobeConfig.capabilities} (the
 * host's set), else {@link DEFAULT_CAPABILITY_RULES}.
 *
 * A capability that declares `requires` is checked against the view's provider
 * here, before any `setup` runs: a `GlobeConfig` with `dataLayers` on a MapLibre
 * view is a wiring bug and must surface loudly, not render an empty globe.
 *
 * @param config - The globe config to inspect.
 * @param provider - The provider the view runs on.
 * @param rules - Rule set override (tests inject fakes). Defaults to the
 *   config's own set, then to {@link DEFAULT_CAPABILITY_RULES}.
 * @throws {ProviderMismatchError} When an active capability requires another provider.
 */
export function mapConfigToCapabilities(
	config: GlobeConfig,
	provider: ProviderKind,
	rules?: CapabilityRule[]
): ResolvedCapability[] {
	const active = rules ?? config.capabilities ?? DEFAULT_CAPABILITY_RULES;
	return active
		.filter((rule) => rule.applies(config))
		.map((rule) => {
			const capability = rule.create();
			if (capability.requires && capability.requires !== provider) {
				throw new ProviderMismatchError(
					capability.requires,
					provider,
					`The '${rule.name}' capability`
				);
			}
			return { name: rule.name, capability, select: rule.select };
		});
}
