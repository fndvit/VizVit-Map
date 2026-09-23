---
title: Unreleased
---

# Unreleased

What is on `main` and not yet in a tagged version. When it ships, this page is
renamed to its version and a new, empty one takes its place — see
[all releases](./index.md).

[Compare against `main` on GitHub](https://github.com/fndvit/VizVit-Map/compare/v0.5.0...main)

## Added

- **Selection is first-class in the hover overlay.** `handle.select(result)`
  selects a cell (or clears it with `null`): styled through the same
  `computeStyle` as a hover, drawn as the pinned dot with its pop animation,
  reprojected on camera moves, immune to hover events, and resolved once into a
  meaning for the new `selectionCard` snippet on `<Globe>` —
  `(meaning | null, { noData, key })`, rendered once and updated in place so a
  host's sheet or panel never remounts between selections. `SelectionRender`
  joins `…/hover`. Until now a host had to keep its own copy of the selected
  cell, resolve its meaning a second time and replay the tap as a hover, which
  a touch pan could then overwrite.

## Removed

- `handle.setPinned(HoverInfo)` and `handle.pushLeavingDot(HoverInfo)`. Both
  exposed the overlay's internal `HoverInfo`, so no host could call them without
  rebuilding `applyHover`'s styling; `select` replaces them. **Upgrading:** a
  host that called `setPinned(info)` calls `select(result)` with the
  `HoverResult` it had; one that called `setPinned(null)` calls `select(null)`.
