---
title: Unreleased
---

# Unreleased

What is on `main` and not yet in a tagged version. When it ships, this page is
renamed to its version and a new, empty one takes its place — see
[all releases](./index.md).

[Compare against `main` on GitHub](https://github.com/fndvit/VizVit-Map/compare/v0.6.0...main)

## Added

- **Regions: `@vit-foundation/map/geo`.** `regionShapeOf` / `loadRegionShape`
  turn a GeoJSON polygon file into a `RegionShape` (`bbox`, `contains`) that
  ignores ring winding — d3's `geoContains` reads an RFC 7946 file as its
  complement — and handles the antimeridian (`regionBoxes` splits a wrapping
  box). `anchorOf` / `anchorOfArcgis` give the one point that decides whether a
  feature is inside a region. A leaf entry point: no engine, no SDK.
- **`LayerHandle.setRegion(shape | null)` / `getRegion()`** on every provider:
  a layer draws only the features whose anchor is inside the region. ArcGIS
  filters a points layer's graphics and narrows a GeoJSON layer by object ids;
  MapLibre filters the source it feeds the map; the fake records the region.
- **`confineFeatureLayer(layer, region)`** in `…/arcgis` (with
  `confinementOf` and `featureIdsInRegion`): narrows a loaded `FeatureLayer` to a
  region server-side, by pinning the ids inside as `objectid IN (…)` on its
  `definitionExpression`. One confinement per layer keeps the original
  expression, looks regions up on a clone (no refetch of the live layer) and
  lets the later of two quick calls win.
- **`pageThrough(fetchPage, options)`** in `…/arcgis`: every page of a feature
  query, with stop rules that cannot loop on a service without pagination.

**Upgrading:** `LayerHandle` gains two required members. A consumer that only
calls the package's providers needs nothing; one that implements its own
`MapProvider` adds `setRegion` and `getRegion` to its handles.
