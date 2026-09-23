---
title: Unreleased
---

# Unreleased

What is on `main` and not yet in a tagged version. When it ships, this page is
renamed to its version and a new, empty one takes its place — see
[all releases](./index.md).

[Compare against `main` on GitHub](https://github.com/fndvit/VizVit-Map/compare/v0.4.0...main)

## Fixed

- **The hover tooltip card no longer renders under the hover dot in consumers
  that do not generate the package's utility classes.** The overlay's six
  elements were placed and stacked with Tailwind utilities (`absolute`,
  `pointer-events-none`, `z-[3..7]`) written in the published markup — which a
  consumer's CSS toolchain never generates from `node_modules`, so the card fell
  to `z-index: auto` and the enlarged dot, later in DOM order, painted over it.
  Placement and stacking now live in `hoverOverlay.css`; the globe stage and the
  canvas are styled by `Globe.svelte`'s own scoped CSS. The package ships no
  utility classes, and `libraryBoundary.test.ts` forbids them.

## Added

- **The z-ladder is a contract.** The globe stage declares
  `--vit-map-z-ring` (3), `--vit-map-z-dot` (4), `--vit-map-z-pinned` (5),
  `--vit-map-z-host` (6) and `--vit-map-z-tooltip` (7). A host slots its own
  `children` overlays in with `z-index: var(--vit-map-z-host)` instead of
  guessing a number between the package's rungs, and may override a rung on the
  stage. Documented in the reference under _Styling contract_.
- **The globe applies the over-a-dot cursor itself.** `tooltip.onCursorChange`
  is still called, for hosts that mirror the state elsewhere, but toggling the
  package's `hex-cursor-pointer` class is no longer something a host has to do.

## Removed

- `.tooltip-shimmer-line` and its keyframes left `hoverOverlay.css`. They styled
  a consumer's card skeleton by name — the inside of the card is the host's;
  the one known consumer already owns an identical rule.
