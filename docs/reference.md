# Reference

Fifteen entry points. They exist so a leaf component can import the one symbol
it needs without pulling the whole graph — a barrel import in a widely-used
component is how a build's memory use gets away from you.

**Rule of thumb:** import from the root in app-level code where you want the
whole surface; import the narrow subpath in a component or a helper.

## Find it by task

| You want to…                      | Import from                     |
| --------------------------------- | ------------------------------- |
| Render a map                      | `@vit-foundation/map`           |
| Drive a view without `<Globe>`    | `…/engine`                      |
| Type a function against the ports | `…/provider`                    |
| Write a capability                | `…/capability`                  |
| Register your capability          | `…/registry`                    |
| Add a sub-config to `GlobeConfig` | `…/config` (the augment target) |
| Add a payload to the tooltip      | `…/hover` (the augment target)  |
| Test your capability              | `…/testing`                     |
| Search for a place                | `…/geocode`                     |
| Stream PMTiles                    | `…/tiles`                       |

## The entry points

### `@vit-foundation/map`

The library surface: `Globe`, `MapCanvas`, `DEFAULT_CAPABILITY_RULES`,
`mapConfigToCapabilities`, `defineRule`, `makeGlobeApi`, `buildGlobeContext`,
`ANIMATION_PRESETS`, `resolveAnimation`, and the config and capability types.

### `…/Globe.svelte` · `…/MapCanvas.svelte`

The components by direct path, for a lazy `import()` that should not drag the
barrel with it.

### `…/config`

`GlobeConfig` and every sub-config type. **The `declare module` target** for
adding your own — see [Capabilities](./capabilities.md#2-tell-the-type-system-about-its-sub-config).

### `…/capability`

`Capability`, `GlobeContext`, `CapabilityRule`, `defineRule`. What you import
while writing a feature.

### `…/registry`

`mapConfigToCapabilities`, `DEFAULT_CAPABILITY_RULES`. Presence of a sub-config
activates its capability; a `requires` mismatch throws before any setup runs.

### `…/hover`

`HoverResult`, `HoverInfo`, `DotStyle`, `TooltipRender`, `HoverOverlayHandle`,
and `TooltipMeaning` — **the `declare module` target** for the payload your
tooltip card receives.

### `…/dot-style`

`applyCurve`, `CurveShape`. The curve primitives alone, for a host that mirrors
the map's dot maths without wanting the hover graph.

### `…/engine`

`MapEngine`, `HoverManager`, the whole `MapProvider` contract re-exported,
`scaleForZoom` / `zoomForScale` / `SCALE_Z0`, `zoomForExtent`, and the geocoding
functions.

### `…/provider`

The contract alone: `MapProvider`, the five ports, `BasemapSpec`,
`BasemapCatalog`, the layer handles and specs, `ProviderMismatchError`,
`ProviderKind`. Types only plus one error class — the cheapest import in the
package, and the right one for typing a helper.

### `…/geocode`

`suggestPlaces`, `locatePlace`. Place search over the public REST API, with no
map and no SDK — a search box can use this on its own.

### `…/arcgis` · `…/maplibre`

The adapters. You rarely import these: `MapEngine` loads the one you asked for.
Reach for them to construct a provider yourself, or for `toRgba` /
`ARCGIS_LOADERS` / `flatStyleFor`.

### `…/tiles`

`PmtilesLayerAdapter`, `TileSink`, `TileCell`, `tileOwnsPoint`, `ScaleWindow`,
`H3AttributeIndex`, `H3IndexHit`. Streams a PMTiles archive into whatever sink
you give it; the adapter itself is provider-neutral.

`PmtilesLayerAdapter implements H3AttributeIndex` — the synchronous cell →
attributes lookup a hover resolver answers in-frame from, rather than awaiting
a query. **The column it keys that index by is yours to name:** `idField`
defaults to `'h3id'` and takes any attribute name, or `null` to skip the index
when you do not hover by cell id.

```ts
import { PmtilesLayerAdapter, type H3AttributeIndex } from '@vit-foundation/map/tiles';

const tiles = new PmtilesLayerAdapter({ url, sink, provider, layerName, idField: 'id' });

const index: H3AttributeIndex = tiles;
const hit = index.queryAttributesByH3(cellId); // attributes + centroid, or null
```

### `…/testing`

`makeFakeProvider`, `makeFakeContext` and the `Fake*` types. The in-memory
provider — no SDK, no GPU, no DOM.

`vitest` is an optional peer, because the fake uses its spy helpers. If you test
with something else, the module still imports; only the `vi.fn()` call sites
need it.
