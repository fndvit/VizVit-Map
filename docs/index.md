# @vit-foundation/map

A map **engine with a provider seam**: one live view behind five small ports, so
the features you build on it run on ArcGIS, on MapLibre GL, or on an in-memory
double in tests — without being rewritten for each.

Extracted from the National Geographic _Food for Tomorrow_ globe, which still
consumes it.

## Start here

|                                         |                                                           |
| --------------------------------------- | --------------------------------------------------------- |
| [Getting started](./getting-started.md) | Install, peers, and a map on screen                       |
| [Providers](./providers.md)             | The seam, the three adapters, and how to write a fourth   |
| [Capabilities](./capabilities.md)       | How a feature is added — yours as well as the library's   |
| [Reference](./reference.md)             | Every entry point, what it exports, and when to import it |
| [Changelog](./changelog/)               | What has landed, one page per version, newest first       |

## If you are new

1. **[Getting started](./getting-started.md)** — five minutes to a rendered map,
   and the one decision you cannot avoid (which provider).
2. **[Providers](./providers.md)** next, even if you only ever use ArcGIS. The
   seam explains why the API looks the way it does, and the section on **scale
   as the level-of-detail currency** will save you a confusing afternoon.
3. **[Capabilities](./capabilities.md)** when you have a feature to add. The
   library's own markers and outlines are written exactly the way yours will be.
4. **[Reference](./reference.md)** is not for reading front to back — it is
   where you look up which entry point holds a symbol.

## The shape of it, in one picture

```
your app
  │   GlobeConfig  { basemap, camera, markers?, pins?, …, capabilities?, engine? }
  ▼
<Globe>  ── mounts the capabilities the config enables
  │
  ▼
MapEngine ── picks a provider, hosts the hover loop, resolves basemap ids
  │
  ▼
MapProvider ─── camera · screen · events · scene · layers · native()
  │
  ├── ArcGIS adapter      (production)
  ├── MapLibre adapter    (globe projection)
  └── fake adapter        (your tests)
```

Nothing above the provider line names a map SDK. That is the whole idea: the
things you write — a marker layer, a pin projection, an outline that fades —
are written once and keep working when the SDK underneath changes.

## Three conventions worth knowing before you start

- **Scale, not zoom.** Ports speak scale (1:N at the view centre, `0` =
  unbounded). A provider that thinks in zoom converts internally, so a tuned
  level-of-detail ladder survives a provider change unchanged.
- **Your app owns basemap ids.** The engine knows none of them. You give it a
  `BasemapCatalog` that turns your ids into neutral specs, and it hands the
  result back to you to decorate.
- **Layer handles, not SDK objects.** `layers.points(…)` returns a handle that
  hit-tests itself, so "which of _my_ items is under the pointer" never crosses
  the seam in SDK shape.
