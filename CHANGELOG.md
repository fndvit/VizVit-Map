# Changelog

## 0.1.0 — unreleased

First extraction, from the National Geographic _Food for Tomorrow_ globe.

### The seam

A map **engine** with a provider seam: one live view behind five small ports —
`camera`, `screen`, `events`, `scene`, `layers` — plus a typed `native(kind)`
escape hatch for work that is genuinely SDK-bound. Features written against the
ports run on any adapter without being rewritten.

Three adapters ship: **ArcGIS** (`SceneView`/`MapView`), **MapLibre GL** (globe
projection), and an in-memory **fake** for tests. A capability may declare
`requires: 'arcgis'`, and the registry refuses to mount it on another provider
before any setup runs, rather than rendering an empty map.

### What is in the box

| Entry point          | Contents                                                                                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.`                  | `<Globe>`, `<MapCanvas>`, the capability contract and registry, the neutral capabilities (markers, hover, pins, outlines), the hover tooltip overlay, pin projection |
| `./Globe.svelte`     | `<Globe>` alone, for a lazy `import()` or a leaf that wants no barrel                                                                                                |
| `./MapCanvas.svelte` | `<MapCanvas>` alone                                                                                                                                                  |
| `./config`           | `GlobeConfig` and its sub-configs — the `declare module` target for a host's own capability sub-config                                                               |
| `./capability`       | the `Capability` / `GlobeContext` contract and `defineRule`                                                                                                          |
| `./registry`         | `mapConfigToCapabilities`, `DEFAULT_CAPABILITY_RULES`                                                                                                                |
| `./hover`            | the hover/tooltip types — the `declare module` target for a host's `TooltipMeaning`                                                                                  |
| `./dot-style`        | `DotStyle` and the curve primitives dot renderers share                                                                                                              |
| `./engine`           | `MapEngine`, the `MapProvider` contract, scale conversion, geocoding                                                                                                 |
| `./provider`         | the provider contract alone — the types a capability programs against                                                                                                |
| `./geocode`          | place search, view-independent                                                                                                                                       |
| `./arcgis`           | the ArcGIS adapter                                                                                                                                                   |
| `./maplibre`         | the MapLibre adapter                                                                                                                                                 |
| `./tiles`            | the PMTiles streaming adapter and its `TileSink` seam                                                                                                                |
| `./testing`          | the in-memory fake provider, for a host's own capability tests (vitest is an optional peer)                                                                          |

`@arcgis/core` and `maplibre-gl` are **optional** peers — install only the
provider you use.

### Conventions worth knowing

- **Scale, not zoom, is the level-of-detail currency** (1:N at the view centre,
  `0` = unbounded). Providers that think in zoom convert through
  `scaleForZoom`/`zoomForScale`, so a tuned ladder survives a provider change.
- **The app owns basemap ids.** The engine knows none; it calls a
  `BasemapCatalog` you supply to resolve an id into a neutral spec, and lets you
  decorate the result.
- **Layer handles, not SDK objects.** Hit testing lives on the handle, so "which
  of my items is under the pointer" never crosses the seam in SDK shape.
