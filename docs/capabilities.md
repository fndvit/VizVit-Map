# Capabilities

A **capability** is one globe feature, self-contained, with a tiny lifecycle.
Markers, pins, outlines and the cursor hover are written exactly the way yours
will be.

```ts
interface Capability<C> {
	readonly name: string;
	readonly requires?: ProviderKind; // omit unless the feature is SDK-bound
	setup(ctx: GlobeContext, config: C): void | Promise<void>;
	update?(ctx: GlobeContext, config: C): void;
	destroy?(): void;
}
```

Two rules make them composable: a capability depends only on `GlobeContext`,
never on a sibling; and it is active **iff its sub-config is present**, so
nothing takes a flag argument.

## Adding one

### 1. Write it

```ts
import { defineRule, type Capability } from '@vit-foundation/map/capability';
import type { Handle, PointLayerHandle } from '@vit-foundation/map/provider';

export interface HeatSpotsConfig {
	items: { id: string; lon: number; lat: number; weight: number }[];
	onSelect?: (id: string) => void;
}

export function createHeatSpots(): Capability<HeatSpotsConfig> {
	let layer: PointLayerHandle | null = null;
	let click: Handle | null = null;
	let cfg: HeatSpotsConfig | null = null;

	return {
		name: 'heatSpots',

		setup(ctx, config) {
			cfg = config;
			layer = ctx.provider.layers.points({ id: 'heat-spots', placement: 'floating' });
			layer.set(config.items.map(toItem));

			click = ctx.provider.events.on('click', async (e) => {
				const id = await layer?.hitTest(e);
				if (id) cfg?.onSelect?.(id);
			});
		},

		update(_ctx, config) {
			cfg = config;
			layer?.set(config.items.map(toItem));
		},

		destroy() {
			click?.remove();
			layer?.remove();
			click = null;
			layer = null;
			cfg = null;
		}
	};
}

export const heatSpotsRule = defineRule<HeatSpotsConfig>({
	name: 'heatSpots',
	applies: (config) => config.heatSpots != null,
	select: (config) => config.heatSpots!,
	create: createHeatSpots
});
```

`destroy` must be safe to call once and must release everything `setup` took —
every handle, every layer. The provider tears the view down underneath you, so
treat an already-gone map as a no-op rather than an error.

### 2. Tell the type system about its sub-config

`GlobeConfig` is open through declaration merging, which keeps the library's own
fields strongly typed while letting you add yours:

```ts
declare module '@vit-foundation/map/config' {
	interface GlobeConfig {
		heatSpots?: HeatSpotsConfig;
	}
}
```

Augment `@vit-foundation/map/config` — the module that _declares_ the interface.
Augmenting the barrel that re-exports it creates a shadow interface instead of
merging, and the symptom is a property the compiler refuses to see.

### 3. Register it

```svelte
<script lang="ts">
	import { Globe, DEFAULT_CAPABILITY_RULES } from '@vit-foundation/map';
	import { heatSpotsRule } from './heatSpots';

	const config: GlobeConfig = {
		capabilities: [...DEFAULT_CAPABILITY_RULES, heatSpotsRule],
		basemap: { id: 'plain' },
		heatSpots: { items, onSelect }
	};
</script>

<Globe {config} />
```

Rules resolve in this order: an explicit argument to
`mapConfigToCapabilities` (how tests inject fakes), then
`config.capabilities`, then `DEFAULT_CAPABILITY_RULES`.

### 4. Test it without a map

```ts
import { makeFakeContext } from '@vit-foundation/map/testing';

const { ctx, provider } = makeFakeContext();
const cap = createHeatSpots();
cap.setup(ctx, { items: [{ id: 'a', lon: 0, lat: 0, weight: 1 }], onSelect });

expect(provider.layer('heat-spots')!.items).toHaveLength(1);

provider.hits['heat-spots'] = 'a';
await provider.fire('click', { x: 1, y: 2, lngLat: null });
expect(onSelect).toHaveBeenCalledWith('a');

cap.destroy?.();
expect(provider.created.find((l) => l.id === 'heat-spots')!.removed).toBe(true);
```

No SDK, no GPU, no DOM. If your capability can only be tested against a real
map, it is probably reaching for `native()` when a port would do.

## When a capability is SDK-bound

Sometimes there is no neutral form — a renderer expression language, a SQL
filter, a hosted feature service. Declare it and reach for the SDK:

```ts
return {
	name: 'dots',
	requires: 'arcgis',
	setup(ctx, config) {
		const { map, loadModules } = ctx.provider.native('arcgis');
		…
	}
};
```

The registry then refuses to mount it on another provider before any setup runs,
which turns a silent empty map into a loud `ProviderMismatchError`.

Take the constructors from `loadModules` rather than importing `@arcgis/core`
yourself: the adapter de-dupes them, so two capabilities asking for
`FeatureLayer` load it once. The adapter also ships the SDK-bound pieces that are
still general — `createLabelStyleCompiler` and `addVectorTileOverlay` for label
work — so reach for those before writing your own. See
[Reference](./reference.md#arcgis-maplibre).

## What a capability cannot do

It cannot render DOM — capabilities touch the view, not the page. A feature that
needs an overlay is a component the host renders in `<Globe>`'s stage, the way
the hover tooltip is.

It cannot depend on another capability. If two features must coordinate, the
host owns the state and passes it to both through their sub-configs.
