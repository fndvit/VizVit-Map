import { describe, it, expect } from 'vitest';
import { defineRule, mapConfigToCapabilities, type CapabilityRule } from '$lib/globe/registry';
import type { Capability } from '$lib/globe/capability';
import type { GlobeConfig } from '$lib/globe/config.js';
import { ProviderMismatchError, type ProviderKind } from '$lib/map-engine/provider';

/**
 * A host's extra capability, declared the way the library asks for one: the
 * sub-config is merged onto `GlobeConfig` from outside. This is the extension
 * point under test — the NatGeo app adds `dataLayers` exactly like this.
 */
declare module '$lib/globe/config.js' {
	interface GlobeConfig {
		dataLayers?: { kind: 'explore'; state: unknown; selection: string[] };
	}
}

/** A no-op capability that just records its name (and optionally its provider). */
const fakeCapability = (name: string, requires?: ProviderKind): Capability<unknown> => ({
	name,
	requires,
	setup() {}
});

/** Fake rules mirroring how real ones are declared — presence-of-subconfig. */
const markersRule = defineRule({
	name: 'markers',
	applies: (c) => c.markers != null,
	select: (c) => c.markers,
	create: () => fakeCapability('markers')
});
const hoverRule = defineRule({
	name: 'hover',
	applies: (c) => c.hover != null,
	select: (c) => c.hover,
	create: () => fakeCapability('hover')
});
const dataRule = defineRule({
	name: 'dataLayers',
	applies: (c) => c.dataLayers != null,
	select: (c) => c.dataLayers,
	create: () => fakeCapability('dataLayers', 'arcgis')
});

const RULES: CapabilityRule[] = [markersRule, hoverRule, dataRule];

// These fixtures deliberately omit core view fields (basemap etc.) — the seam
// under test only reads capability sub-configs, so a Partial keeps them focused.
const names = (config: Partial<GlobeConfig>, provider: ProviderKind = 'fake') =>
	mapConfigToCapabilities(config as GlobeConfig, provider, RULES).map((r) => r.name);

describe('mapConfigToCapabilities (the OCP seam)', () => {
	it('activates only the capabilities whose sub-config is present', () => {
		expect(names({ markers: { items: [] } })).toEqual(['markers']);
	});

	it('activates several when several sub-configs are present, in rule order', () => {
		expect(names({ markers: { items: [] }, hover: { mode: 'cursor' } })).toEqual([
			'markers',
			'hover'
		]);
	});

	it('activates nothing for a bare core-only config', () => {
		expect(names({ basemap: { id: 'gray' }, interactive: false })).toEqual([]);
	});

	it('activates the full set for a feature-rich config', () => {
		const config: Partial<GlobeConfig> = {
			markers: { items: [] },
			hover: { mode: 'cursor' },
			// eslint-disable-next-line @typescript-eslint/no-explicit-any -- state stub; rule only checks presence
			dataLayers: { kind: 'explore', state: {} as any, selection: [] }
		};
		expect(names(config, 'arcgis')).toEqual(['markers', 'hover', 'dataLayers']);
	});

	it('pairs each active capability with a selector that extracts its slice', () => {
		const config: Partial<GlobeConfig> = { markers: { items: [{ id: 'a', lon: 1, lat: 2 }] } };
		const [resolved] = mapConfigToCapabilities(config as GlobeConfig, 'fake', RULES);
		expect(resolved.capability.name).toBe('markers');
		expect(resolved.select(config as GlobeConfig)).toBe(config.markers);
	});

	it('creates a fresh capability instance per resolution', () => {
		const config: Partial<GlobeConfig> = { markers: { items: [] } };
		const first = mapConfigToCapabilities(config as GlobeConfig, 'fake', RULES)[0].capability;
		const second = mapConfigToCapabilities(config as GlobeConfig, 'fake', RULES)[0].capability;
		expect(first).not.toBe(second);
	});
});

describe('mapConfigToCapabilities (provider gate)', () => {
	const config: Partial<GlobeConfig> = {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- state stub; rule only checks presence
		dataLayers: { kind: 'explore', state: {} as any, selection: [] }
	};

	it('throws ProviderMismatchError for a capability that requires another provider', () => {
		expect(() => mapConfigToCapabilities(config as GlobeConfig, 'fake', RULES)).toThrow(
			ProviderMismatchError
		);
		expect(() => mapConfigToCapabilities(config as GlobeConfig, 'fake', RULES)).toThrow(
			/'dataLayers' capability requires the 'arcgis' map provider but the view is 'fake'/
		);
	});

	it('resolves normally on the provider it requires', () => {
		expect(names(config, 'arcgis')).toEqual(['dataLayers']);
	});
});
