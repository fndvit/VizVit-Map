---
title: Unreleased
---

# Unreleased

What is on `main` and not yet in a tagged version. When it ships, this page is
renamed to its version and a new, empty one takes its place — see
[all releases](./index.md).

[Compare against `main` on GitHub](https://github.com/fndvit/VizVit-Map/compare/v0.3.0...main)

## Added

- **`ZoomScaleOptions`** on `scaleForZoom` / `zoomForScale`
  (`@vit-foundation/map/engine`). The second argument still accepts a latitude,
  and now also `{ latitude?, tilePx?: 256 | 512, snap? }`: the tile size a
  service's zoom levels are authored for (Esri VectorTileServers publish 512 px
  tiles, which halves every level's scale) and the LOD snap a renderer applies
  (ArcGIS switches a `VectorTileLayer`'s style zoom at the midpoint between
  LODs, i.e. `0.5`). Both were properties of the service that consumers had
  been re-deriving by hand, four different ways, in one app.
- **`loadFontFaces(faces, env?)`** (`@vit-foundation/map/engine`): loads web
  font faces into `document.fonts` so a map SDK can rasterise label glyphs with
  them — `FontFace` API first, CSS `@font-face` fallback, one fetch per face
  however many callers ask, and a `{ loaded, failed }` status so a caller can
  tell "fonts ready" from "styles ready". Domain-free; the faces are yours.
- **`createLabelStyleCompiler(style, options?)`** (`@vit-foundation/map/arcgis`):
  the one place a Mapbox / MapLibre style document's `symbol` layers become
  ArcGIS label primitives — text style, zoom band (as scales, through a
  `ZoomScaleOptions` scheme), `text-size` ramp, and an autocastable
  `TextSymbol` with px turned into points and the face resolved by an injected
  `LabelFontResolver`. Defaults and the "which class wins" policy are injected
  too; the compiler knows no service, palette or font.
- **`addVectorTileOverlay(native, spec)`** (`@vit-foundation/map/arcgis`): a
  vector tile style as an operational layer above the basemap, with an optional
  `keep` filter on its style layers applied after load and before the layer is
  added. Returns a handle that can hide, raise or remove it.
- `VectorTileLayer` joins `ARCGIS_LOADERS`, so a capability can reach it
  through `native('arcgis').loadModules` like `FeatureLayer`.

## Changed

- `SCALE_Z0` is now `591_657_527.591555` — LOD 0 of the ArcGIS default tiling
  scheme, as every Esri service's `tileInfo.lods[0].scale` publishes it — rather
  than the `591_657_550.5` derived from a rounded metres-per-pixel. The change
  is 4 parts in 10⁸; scales derived here now agree with Esri LOD tables to the
  digit.
- `BasemapConfig.labelOverlay` is documented as the per-basemap tweak it is; a
  label stack with a lifecycle belongs in a host capability.
