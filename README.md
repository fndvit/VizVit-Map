# @vit-foundation/vizvit-map

A map **engine** with a provider seam: one live view behind five small ports, so
the features you build on it run on ArcGIS, on MapLibre GL, or on an in-memory
double in tests — without being rewritten for each.

> Extracted from the National Geographic _Food for Tomorrow_ globe. This first
> cut ships the engine; the `<Globe>` component and its capability system follow
> once their remaining app-specific wires are cut.

## Install

```sh
npm install @vit-foundation/vizvit-map
```

`svelte` ^5 is a peer. The two map SDKs are **optional** peers — install only
the provider you use:

```sh
npm install @arcgis/core     # for the ArcGIS provider
npm install maplibre-gl      # for the MapLibre provider
```

## The idea

```ts
import { MapEngine, type MapProvider } from '@vit-foundation/vizvit-map';

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
level-of-detail ladder survives a provider change unchanged.

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

| Import                                | Contents                                                          |
| ------------------------------------- | ----------------------------------------------------------------- |
| `@vit-foundation/vizvit-map`          | `MapEngine`, the `MapProvider` contract, scale helpers, geocoding |
| `@vit-foundation/vizvit-map/arcgis`   | the ArcGIS adapter                                                |
| `@vit-foundation/vizvit-map/maplibre` | the MapLibre adapter                                              |
| `@vit-foundation/vizvit-map/tiles`    | the PMTiles streaming adapter and its `TileSink` seam             |

## License

Apache-2.0
