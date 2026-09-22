# @vit-foundation/map

A map **engine** with a provider seam: one live view behind five small ports, so
the features you build on it run on ArcGIS, on MapLibre GL, or on an in-memory
double in tests — without being rewritten for each.

> It ships the engine, the config-driven `<Globe>` component
> and its capability system.

## Install

```sh
npm install @vit-foundation/map
```

`svelte` ^5 is a peer. The two map SDKs are **optional** peers — install only
the provider you use:

```sh
npm install @arcgis/core     # for the ArcGIS provider
npm install maplibre-gl      # for the MapLibre provider
```

## The idea

```ts
import { MapEngine, type MapProvider } from '@vit-foundation/map/engine';

const engine = new MapEngine({
	mode: '3d',
	provider: 'maplibre', // or 'arcgis' (the default)
	basemap: 'streets',
	basemaps: myCatalog // your ids → provider-neutral specs
});

const provider = await engine.init(container);

provider.camera.flyTo({ longitude: 2.8, latitude: 41.9, z: 500_000 });
const markers = provider.layers.points({ id: 'markers', placement: 'floating' });
markers.set([
	{ id: 'girona', lng: 2.8, lat: 41.9, symbol: { shape: 'diamond', size: 12, color: '#f5c518' } }
]);
const hit = await markers.hitTest({ x, y });
```

Nothing above names an SDK type. That is the point.

## The ports

| Port     | What it owns                                                             |
| -------- | ------------------------------------------------------------------------ |
| `camera` | read the camera, fly to a target, zoom by levels                         |
| `screen` | view size, ground ↔ pixel projection                                     |
| `events` | pointer, click, camera, stationary, interacting, updating, size, padding |
| `scene`  | basemap, background, ground, quality, padding, cursor, settle            |
| `layers` | point and GeoJSON layers, returned as handles                            |

Type a dependency to the ports it actually uses, and the signature documents its
reach:

```ts
function projectPins(provider: Pick<MapProvider, 'screen' | 'camera' | 'events'>) { … }
```

### Layer handles, not SDK objects

`layers.points(spec)` and `.geojson(spec)` return a handle: visibility, opacity,
scale range, placement, and for points `set` / `restyle` / `hitTest`. Hit
testing lives on the handle, so "which of _my_ items is under the pointer" never
crosses the seam in SDK shape.

### Scale is the currency

Ports speak scale (1:N at the view centre, `0` = unbounded). Providers that
think in zoom convert through `scaleForZoom` / `zoomForScale`, so a tuned
level-of-detail ladder survives a provider change unchanged. Those two take the
**tile scheme** a zoom belongs to — tile size and LOD snap, both properties of
the service you are reading — so a 512 px vector tile service's bands convert
correctly instead of landing a level out.

### Basemaps: your app owns the ids

The engine knows no basemap ids. You give it a `BasemapCatalog` that resolves
your ids to neutral specs (`flat`, `style`, `well-known`, `native`) and may
decorate a basemap once it is applied.

### The escape hatch

Something genuinely SDK-bound reaches it explicitly, and says so:

```ts
const { view, map, loadModules } = provider.native('arcgis');
```

`native()` for the wrong provider throws `ProviderMismatchError`.

## Entry points

The root entry point is the globe library; the engine and the adapters sit on
their own subpaths, so a leaf component can import the one module it needs
without pulling a whole barrel's dependency graph into its bundle.

| Import                                 | Contents                                                                                                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@vit-foundation/map`                  | `<Globe>`, `<MapCanvas>`, the capability contract and registry, the neutral capabilities (markers, hover, pins, outlines), the hover overlay types, pin projection |
| `@vit-foundation/map/Globe.svelte`     | `<Globe>` alone — the component, for a lazy `import()` or a leaf that wants no barrel                                                                              |
| `@vit-foundation/map/MapCanvas.svelte` | `<MapCanvas>` alone — one view's lifecycle without the capability layer                                                                                            |
| `@vit-foundation/map/config`           | `GlobeConfig` and its sub-configs. **The `declare module` target** a host augments to add its own capability's sub-config                                          |
| `@vit-foundation/map/capability`       | the `Capability` / `GlobeContext` contract and `defineRule`                                                                                                        |
| `@vit-foundation/map/registry`         | `mapConfigToCapabilities`, `DEFAULT_CAPABILITY_RULES`                                                                                                              |
| `@vit-foundation/map/hover`            | the hover/tooltip types. **The `declare module` target** for a host's `TooltipMeaning`                                                                             |
| `@vit-foundation/map/dot-style`        | `DotStyle` and the curve primitives dot renderers share                                                                                                            |
| `@vit-foundation/map/engine`           | `MapEngine`, the `MapProvider` contract, scale helpers, web font loading, geocoding                                                                                |
| `@vit-foundation/map/provider`         | the provider contract alone — the types a capability programs against                                                                                              |
| `@vit-foundation/map/geocode`          | place search, view-independent (no engine, no SDK until it is called)                                                                                              |
| `@vit-foundation/map/arcgis`           | the ArcGIS adapter, plus the label style compiler and vector tile overlay an SDK-bound capability draws labels with                                                |
| `@vit-foundation/map/maplibre`         | the MapLibre adapter                                                                                                                                               |
| `@vit-foundation/map/tiles`            | the PMTiles streaming adapter, its `TileSink` seam and the `H3AttributeIndex` hover lookup                                                                         |
| `@vit-foundation/map/testing`          | the in-memory fake provider, for a host's own capability tests (needs vitest)                                                                                      |

## Documentation

The full site lives in [`docs/`](./docs/index.md) and is served by
`pnpm dev:docs`:

- **[Getting started](./docs/getting-started.md)** — install, peers, a map on screen
- **[Providers](./docs/providers.md)** — the seam, the three adapters, writing a fourth
- **[Capabilities](./docs/capabilities.md)** — adding a feature of your own
- **[Reference](./docs/reference.md)** — every entry point and what it exports
- **[Changelog](./docs/changelog/index.md)** — one page per version, newest first

[CONTRIBUTING](./CONTRIBUTING.md) has the setup, the rules the tooling enforces,
and the release ritual.

## License

Apache-2.0
