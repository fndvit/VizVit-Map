# Changelog

All notable changes to `@vit-foundation/map` are documented here, **one page per
version**, newest first. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

| Version                       | Released   | What it is                                                                     |
| ----------------------------- | ---------- | ------------------------------------------------------------------------------ |
| [Unreleased](./unreleased.md) | —          | On `main`, not yet in a tagged version                                         |
| [0.6.0](./0.6.0.md)           | 2026-09-23 | Selection is first-class in the hover overlay: `select` and `selectionCard`    |
| [0.5.0](./0.5.0.md)           | 2026-09-23 | Style-complete: the overlay stacks by its own CSS and a named z-ladder         |
| [0.4.0](./0.4.0.md)           | 2026-09-22 | Label primitives: a style compiler, a vector tile overlay, fonts, tile schemes |
| [0.3.0](./0.3.0.md)           | 2026-09-22 | The tooltip is placed by the shared `anchor` from `ui/overlay`                 |
| [0.2.1](./0.2.1.md)           | 2026-09-21 | A pinned camera stops re-flying on unrelated config changes                    |
| [0.2.0](./0.2.0.md)           | 2026-09-21 | The PMTiles cell id column becomes yours to name                               |
| [0.1.0](./0.1.0.md)           | 2026-09-18 | The first extraction: the provider seam, three adapters, `<Globe>`             |

Version numbers here describe a **package somebody installs**, so they describe
the API rather than a deployment: MAJOR when an existing import, type or
behaviour changes in a way that breaks a consumer, MINOR for a new entry point
or capability, PATCH for a fix that leaves the surface alone.

Until 1.0.0 the surface is still settling, and a MINOR may narrow it. Pin the
minor if that matters to you.

A released page is history and is never edited again; a correction lands in the
next version's page. [CONTRIBUTING](https://github.com/fndvit/VizVit-Map/blob/main/CONTRIBUTING.md#the-changelog-and-cutting-a-version)
has the whole ritual: which page an entry goes on while you work, and what
release day does to this directory.
