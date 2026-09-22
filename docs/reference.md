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
| Convert between zoom and scale    | `…/engine`                      |
| Load web fonts for map labels     | `…/engine`                      |
| Draw labels from a vector style   | `…/arcgis`                      |

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
`scaleForZoom` / `zoomForScale` / `SCALE_Z0` and their `ZoomScaleOptions`,
`zoomForExtent`, `loadFontFaces`, and the geocoding functions.

`loadFontFaces(faces, env?)` puts web font faces into `document.fonts`, which is
where a map SDK's canvas text rendering looks for them. An `@font-face` rule
alone is lazy and nothing in the DOM asks for a label's family, so the faces
have to be loaded explicitly or the first glyph atlas is built without them. It
tries the `FontFace` API, falls back to a CSS rule, fetches each face once
however many callers ask, and never rejects — the result says which faces loaded
and which did not, so you can tell "fonts ready" from "styles ready" instead of
conflating the two.

The faces are yours: this knows no families and hosts nothing.

### `…/provider`

The contract alone: `MapProvider`, the five ports, `BasemapSpec`,
`BasemapCatalog`, the layer handles and specs, `ProviderMismatchError`,
`ProviderKind`. Types only plus one error class — the cheapest import in the
package, and the right one for typing a helper.

### `…/geocode`

`suggestPlaces`, `locatePlace`. Place search over the public REST API, with no
map and no SDK — a search box can use this on its own.

### `…/arcgis` · `…/maplibre`

The adapters. You rarely import these for the provider itself — `MapEngine`
loads the one you asked for. Reach for them to construct a provider by hand, for
`toRgba` / `ARCGIS_LOADERS` / `buildFlatStyle`, or, on the ArcGIS side, for the
two helpers below.

#### Labels from a vector tile style

A vector tile style already says how every label class looks and at which zooms
it shows. When those labels have to be drawn again as `FeatureLayer` labels —
because a vector tile layer is draped on the ground in 3D and your data floats
above it — that authored styling is the source of truth, and
`createLabelStyleCompiler` reads it:

```ts
import { createLabelStyleCompiler } from '@vit-foundation/map/arcgis';

const labels = createLabelStyleCompiler(styleJson, {
	scheme: { tilePx: 512, snap: 0.5 }, // the service's tile scheme
	defaults: { color: '#404040', haloColor: '#ffffff', haloWidth: 1 }
});

const style = labels.textStyleFor('countryLgT'); // fill, face, size, halo, casing, wrap
const band = labels.zoomBandFor('countryLgT'); // { minZoom, maxZoom, minScale, maxScale }
const ramp = labels.sizeRampFor('countryLgT'); // [{ zoom, size }, …] or null

layer.minScale = band.minScale;
layer.labelingInfo = [{ symbol: labels.textSymbol(style!, resolveFont) }];
```

Everything host-specific is injected: the tile scheme, the defaults for what a
layer declares nothing for, which class wins when several share a source-layer,
and a `LabelFontResolver` that turns the style's _face_ name into the CSS family
you actually host plus the weight keyword ArcGIS accepts. The compiler knows no
service, no palette and no font. `textSymbol` also does the px → point
conversion (`pxToPoints`) that a style's sizes need and an ArcGIS `TextSymbol`
expects; passing px straight through renders every label 4/3 too large.

#### A vector tile style above the basemap

`addVectorTileOverlay(native, spec)` draws a style as an operational layer, with
an optional filter on which of its style layers show — which is how you draw
"only the POI symbols" of a style whose publisher offers you the whole basemap:

```ts
const poi = await addVectorTileOverlay(ctx.provider.native('arcgis'), {
	url: serviceUrl,
	title: 'POI',
	keep: (layer) => layer.id.startsWith('g_spriteGlyph/')
});

poi.raise(); // back to the top after something else was added
poi.remove();
```

The filter is applied after the style loads and before the layer is added, so a
filtered style never flashes complete. In 3D the layer is **draped** on the
ground: it cannot render above content that floats above the surface, whatever
its position in the layer list.

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
