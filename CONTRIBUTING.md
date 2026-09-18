# Contributing to `@vit-foundation/map`

## Setup

```sh
pnpm install
pnpm dev          # the showcase route, for trying the library by hand
pnpm dev:docs     # the documentation site
```

## Everyday commands

| Command           | What it does                                          |
| ----------------- | ----------------------------------------------------- |
| `pnpm test`       | The unit suite (vitest, jsdom)                        |
| `pnpm check`      | `svelte-check` over the whole package                 |
| `pnpm lint`       | prettier + eslint                                     |
| `pnpm format`     | prettier, writing                                     |
| `pnpm docs:build` | Builds the docs site — **fails on a dead link**       |
| `pnpm prepack`    | `svelte-package` + `publint`; what `npm publish` runs |

## Architectural rules the tooling enforces

`src/tests/globe/libraryBoundary.test.ts` fails the build on three things, each
because it has bitten this package before:

1. **The map engine never imports the globe layer.** The dependency runs one
   way. A capability may use the engine; the engine may not know a capability
   exists.
2. **Every relative and aliased specifier is fully spelled out** (`./foo.js`,
   not `./foo`). Node does not guess extensions, and `svelte-package` emits
   relative specifiers verbatim and rewrites a `$lib` alias _without_ inventing
   the extension the source omitted. Either kind, left bare, builds here and is
   unimportable from the published package.
3. **The PMTiles worker URL ends `.js`.** `new URL('./pmtilesDecode.worker.js',
import.meta.url)` resolves in `dist`, and Vite maps it back to the `.ts`
   source when the package runs from source. Nothing type-checks that string.

## Writing doc comments

Every module opens with `@module` and a paragraph on what it owns and why.
Every exported function, type and component member carries JSDoc with `@param`,
`@returns` or `@prop`. Comments explain the _why_ — a reader can see the what.

## Verify in a browser before you claim it renders

A passing test suite proves the contract is implemented, never that the stack
renders. This package has been described wrongly in both directions on the
strength of green tests and an HTTP 200, and again on the strength of a blank
page in an automation browser that cannot give either SDK a usable WebGL
context. Use a real browser with a real GPU.

## The changelog, and cutting a version

The changelog is **one page per version**, in
[`docs/changelog/`](./docs/changelog/index.md), newest first on
[its index](./docs/changelog/index.md). The root `CHANGELOG.md` is a pointer at
that directory, not a copy — the sidebar is derived from the directory listing
(`docs/.vitepress/config.ts`), so a new page appears there the moment it is
written and the list cannot go stale. It follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**While you work**, add the entry to
[`docs/changelog/unreleased.md`](./docs/changelog/unreleased.md) in the same PR
as the change, under one of Keep a Changelog's types — `Added`, `Changed`,
`Deprecated`, `Removed`, `Fixed`, `Security` — or `Other (dependencies, CI,
tools…)` for things a consumer never sees. Three rules keep a page readable:

- **One fact, one entry.** If a type already has an entry for the thing you
  changed, edit it so it describes the end state. Appending a second bullet is
  how a release ends up contradicting itself.
- **One `##` heading per type per page.**
- **Write what changed for the consumer.** An internal refactor with no visible
  effect belongs in the git history, not here. A change that needs action on
  upgrade carries an **Upgrading:** paragraph.

**What the version number means here.** This is a package somebody installs, so
the number describes the API, not a deployment: MAJOR when an existing import,
type or behaviour breaks a consumer; MINOR for a new entry point or capability;
PATCH for a fix that leaves the surface alone. Before 1.0.0 the surface is still
settling and a MINOR may narrow it — say so in the entry when it does.

**On release day**, in one commit (`chore(release): x.y.z`):

1. Read `unreleased.md` once as a whole and merge what individual PRs restated —
   it is written over weeks and read in a minute.
2. `git mv docs/changelog/unreleased.md docs/changelog/x.y.z.md`. Retitle it
   `# x.y.z`, date it, and point its compare link at the tag range rather than
   at `main`.
3. Write a fresh `docs/changelog/unreleased.md` with the same header and no
   entries. Copy the one you just renamed; do not invent a new shape.
4. Add the row to `docs/changelog/index.md` — version, date, one line on what
   the release is.
5. Bump `version` in `package.json` to match.
6. `pnpm docs:build`. It fails on a dead link, which catches a mistyped filename
   in the index before a reader finds it.
7. Tag `vx.y.z` and push the tag. GitHub's release notes are the page you just
   cut, pasted — there is no automation between the two.

**Then publish.** `npm publish` runs `prepublishOnly` first, which is lint,
check and tests; that gate is the only thing between a broken build and the
registry, so do not pass `--ignore-scripts`.

```sh
npm publish            # prepublishOnly → prepack → publish
```

Publishing is manual on purpose. An npm release is effectively permanent —
unpublish is unavailable after 72 hours — so it is a decision somebody makes,
not a thing a merge does.

## Reporting issues

<https://github.com/fndvit/VizVit-Map/issues>
