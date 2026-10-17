---
title: Unreleased
---

# Unreleased

What is on `main` and not yet in a tagged version. When it ships, this page is
renamed to its version and a new, empty one takes its place — see
[all releases](./index.md).

[Compare against `main` on GitHub](https://github.com/fndvit/VizVit-Map/compare/v0.9.0...main)

## Added

- **`touchNavigation`** on `GlobeConfig`, `MapCanvas` and `MapEngineOptions`: `'free'` (the default, unchanged) or `'map'`, the phone-map gesture grammar. With `'map'`, one finger pans, a pinch only zooms, the camera stays north-up at its tilt, and a pan stops where the finger lifts. Mouse, wheel and keyboard navigation are unaffected. A `SceneView`'s own touch navigation lets a pinch rotate (by the angle between the fingers), a two-finger vertical drag tilt, and a drag fling on momentum, so small accidental twists and tilts add up and the same drag moves the globe a different way later in a session. The ArcGIS adapter keeps the SDK's own pan and pinch-zoom and, for touch pointers only, pins the pinch angle, stops the two-finger tilt and turns momentum off. A pinch toward the fingers still leans the camera (about 5° per pinch at country scale) and a long pan on the sphere can turn it, so when the last finger lifts the camera eases back (200 ms) to north and to the tilt the gesture started from. The SDK has no public switch for these, so this goes through the view's internal input manager; if a later SDK moves it, the adapter warns once and keeps the defaults. MapLibre turns off touch rotation and touch pitch. It is read once, when the view is built.
- **`mapLikeTouch(view, InputHandler)`**, **`loadInputHandler()`** and **`isNorth(heading)`** in `…/arcgis`: the same behaviour for hosts that build their own `SceneView`.
