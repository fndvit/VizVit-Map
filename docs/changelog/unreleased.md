---
title: Unreleased
---

# Unreleased

What is on `main` and not yet in a tagged version. When it ships, this page is
renamed to its version and a new, empty one takes its place — see
[all releases](./index.md).

## Fixed

### A pinned camera no longer snaps the view back on unrelated config changes

`MapCanvas`'s reactive camera effect had no guard against re-running, unlike the
basemap and background effects beside it. Because `camera` is read through the
host's `GlobeConfig`, the effect re-fired whenever _any_ part of that config
churned — a basemap swap, a palette edit, a capability toggle — flying the view
back to the configured camera each time.

A host that left `camera` unset never saw it (the `if (!camera) return` guard
masked it). A host that pins a start camera, which is the documented way to
override `NEUTRAL_SCENE_CAMERA`, was yanked out of wherever the user had
navigated on every basemap switch.

The effect now compares the camera by value and skips no-op moves, matching
`prevBasemapKey` and `prevBackground`. Reactive moves that genuinely change the
camera — scrolly steps, `flyTo` targets — are unaffected.

[Compare against `main` on GitHub](https://github.com/fndvit/VizVit-Map/compare/v0.2.0...main)
