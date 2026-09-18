# Getting started

## Install

```sh
npm install @vit-foundation/map
```

`svelte` ^5 is a peer. The two map SDKs are **optional** peers — install only
the provider you actually use:

```sh
npm install @arcgis/core     # the ArcGIS provider
npm install maplibre-gl      # the MapLibre provider
```

Installing neither is fine if you only render against the test double.

## A map on screen

`<Globe>` takes one configuration object. Every feature is enabled by the
_presence_ of its sub-config, never by a flag.

```svelte
<script lang="ts">
	import { Globe } from '@vit-foundation/map';
	import type { GlobeConfig, BasemapSpec } from '@vit-foundation/map';

	// The engine knows no basemap ids — you decide what yours mean.
	const basemaps = {
		resolve: (id: string): BasemapSpec =>
			id === 'plain'
				? { kind: 'flat', landColor: '#725B53', oceanColor: '#E5DACA' }
				: { kind: 'well-known', id }
	};

	let selected = $state<string | undefined>();

	const config: GlobeConfig = {
		engine: { provider: 'maplibre', basemaps },
		basemap: { id: 'plain' },
		camera: { longitude: 2.8, latitude: 41.9, z: 12_000_000, tilt: 0, heading: 0 },
		markers: {
			items: [{ id: 'girona', lon: 2.8, lat: 41.9 }],
			onSelect: (id) => (selected = id)
		}
	};
</script>

<Globe {config} class="h-full w-full" /><p>Selected: {selected ?? 'none'}</p>
```

Swap `provider: 'maplibre'` for `'arcgis'` and nothing else in that file
changes. That is the seam doing its job.

## Driving the map yourself

`<Globe>` hands you the live provider once the view is ready:

```svelte
<Globe
	{config}
	oncontext={(ctx) => {
		ctx.provider.camera.flyTo({ longitude: 2.8, latitude: 41.9, z: 500_000 });

		const layer = ctx.provider.layers.points({ id: 'mine', placement: 'floating' });
		layer.set([
			{
				id: 'a',
				lng: 2.8,
				lat: 41.9,
				symbol: { shape: 'diamond', size: 12, color: '#f5c518' }
			}
		]);
	}}
/>
```

Type a function to the ports it actually uses, and the signature documents its
reach:

```ts
import type { MapProvider } from '@vit-foundation/map/provider';

function projectPins(provider: Pick<MapProvider, 'screen' | 'camera' | 'events'>) { … }
```

## Without the component

The engine works on its own if you are not using `<Globe>`:

```ts
import { MapEngine } from '@vit-foundation/map/engine';

const engine = new MapEngine({ mode: '3d', provider: 'arcgis', basemap: 'plain', basemaps });
const provider = await engine.init(container);

provider.scene.setBackground('#f1eee8');
await engine.flyToPlace('Girona');
engine.destroy();
```

## Testing what you build

The in-memory provider is published, so your own capabilities can be tested
without a browser, a GPU or an SDK:

```ts
import { makeFakeContext } from '@vit-foundation/map/testing';

const { ctx, provider } = makeFakeContext();
myCapability().setup(ctx, myConfig);

provider.hits.markers = 'girona';
await provider.fire('click', { x: 10, y: 20, lngLat: null });
expect(onSelect).toHaveBeenCalledWith('girona');
```

## Next

- [Providers](./providers.md) — what the five ports are, and the gaps in each adapter
- [Capabilities](./capabilities.md) — adding a feature of your own
