---
title: Unreleased
---

# Unreleased

What is on `main` and not yet in a tagged version. When it ships, this page is
renamed to its version and a new, empty one takes its place — see
[all releases](./index.md).

[Compare against `main` on GitHub](https://github.com/fndvit/VizVit-Map/compare/v0.2.1...main)

## Changed

- `<HoverTooltipOverlay>` positions its card with `anchor` from
  `@vit-foundation/ui/overlay` instead of a local `tooltipPos`. The placement is
  identical — the same offsets, paddings and card width go in — but the
  arithmetic now has a test suite and one other adapter, rather than being a
  copy that only ran inside a live layout.
- New dependency: `@vit-foundation/ui` (for the `./overlay` subpath).
