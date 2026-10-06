---
title: Unreleased
---

# Unreleased

What is on `main` and not yet in a tagged version. When it ships, this page is
renamed to its version and a new, empty one takes its place — see
[all releases](./index.md).

[Compare against `main` on GitHub](https://github.com/fndvit/VizVit-Map/compare/v0.8.0...main)

## Added

- **`maxZoom`** on `GlobeConfig`, `MapCanvas` and `MapEngineOptions`: the deepest zoom level any navigation (wheel, pinch, zoom buttons, fly-to) can reach. Zooming out is unaffected. A 2D `MapView` takes it as `constraints.maxZoom` and MapLibre as the map's `maxZoom`. A 3D `SceneView` only has an altitude constraint, and a zoom level's altitude depends on the viewport (zoom 12 is about 29 km up on a phone and 54 km on a desktop), so the ArcGIS adapter derives the altitude `min` from the live view and re-derives it on resize. `goTo` does not hold an explicit camera to that constraint, so `camera.flyTo` clamps an altitude target to the cap too (a host's own `altitudeConstraint` alone still lets altitude fly-tos through, as before). It is read once, when the view is built.
- **`capSceneZoom(view, maxZoom, floor?)`** and **`sceneDistanceForScale(scale, fov, width, height)`** in `…/arcgis`: the conversion behind it, for hosts that build their own `SceneView`.
