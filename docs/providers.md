# Providers

A **provider** is one live map view behind five small ports. Capabilities
program against those ports, so the same feature runs on any adapter.

```ts
interface MapProvider {
	readonly kind: ProviderKind; // 'arcgis' | 'maplibre' | 'fake'
	readonly mode: ViewMode; // '3d' | '2d'
	readonly camera: CameraPort; // get · flyTo · zoomBy
	readonly screen: ScreenPort; // size · toScreen · toMap
	readonly events: EventPort; // on(…) + interacting / updating
	readonly scene: ScenePort; // basemap · background · ground · quality · padding · cursor · whenSettled
	readonly layers: LayerFactory; // points(…) · geojson(…) · all
	native<K extends ProviderKind>(kind: K): NativeSurfaces[K];
	destroy(): void;
}
```

## The three adapters

| Adapter      | Import                         | State                                                     |
| ------------ | ------------------------------ | --------------------------------------------------------- |
| **ArcGIS**   | `@vit-foundation/map/arcgis`   | Production. `SceneView` (3D) and `MapView` (2D).          |
| **MapLibre** | `@vit-foundation/map/maplibre` | Globe projection. Runs markers, pins, outlines and hover. |
| **Fake**     | `@vit-foundation/map/testing`  | In-memory. No SDK, no GPU, no DOM.                        |

You rarely import an adapter directly — `MapEngine` picks one from
`options.provider` and loads it dynamically, so a consumer that only uses
MapLibre never pulls ArcGIS into its bundle.

## Layer handles, not SDK objects

`layers.points(spec)` and `.geojson(spec)` return a **handle**: visibility,
opacity, scale range, placement, and for points `set` / `restyle` / `hitTest`.

Hit testing lives on the handle on purpose. "Which of _my_ items is under the
pointer" is a question about your layer, so answering it never requires an SDK
type to cross the seam:

```ts
const layer = provider.layers.points({ id: 'markers', placement: 'floating' });
layer.set(items);
const hitId = await layer.hitTest({ x, y }); // your id, or null
```

## Scale is the currency

Ports speak **scale** — 1:N at the view centre, ArcGIS convention, `0` meaning
unbounded. Zoom is derived.

This matters more than it looks. A level-of-detail ladder is tuned by hand
against real data, and those numbers live in configuration files and shareable
permalinks. If the currency changed with the provider, every tuned number would
be invalidated by a swap. Instead, a provider that thinks in zoom converts:

```ts
import { scaleForZoom, zoomForScale } from '@vit-foundation/map/engine';
```

Note the ends swap. ArcGIS calls the _coarsest_ scale `minScale`, which is the
_lowest_ zoom — the MapLibre adapter handles that conversion for you, but it is
the kind of thing that silently inverts a layer's visibility if you do it by
hand.

### Tile schemes

A zoom level only means something against a **tile scheme**, so both conversions
take one as their second argument:

```ts
scaleForZoom(2, { tilePx: 512, snap: 0.5 });
zoomForScale(view.scale, { latitude, tilePx: 512 });
```

- **`latitude`** — pass the view-centre latitude when the provider reports a
  _ground_ scale, which a 3D globe does, so handoffs land at the same visual
  density everywhere. A bare number is still read as this, so existing calls
  mean what they always did.
- **`tilePx`** — the tile size the levels were authored for. `256` is the
  web-mercator default; Esri VectorTileServers publish **512 px** tiles, which
  halves the scale at every level.
- **`snap`** — how far past a level's own scale a renderer goes before it
  switches. ArcGIS picks the _nearest_ LOD for a `VectorTileLayer`, so a style
  zoom takes effect half a level late: `0.5`.

Both are properties of the **service** you are reading, not of your map, which
is why they are arguments rather than constants. Read a style's `minzoom` with
the wrong scheme and every band lands a level out — content appears and vanishes
one level early, which looks like a data problem and is not.

## Basemaps: your app owns the ids

The engine knows no basemap ids. You give it a catalog:

```ts
interface BasemapCatalog {
	resolve(id: string, customColors?: FlatColors): BasemapSpec;
	decorate?(
		provider: MapProvider,
		spec: BasemapSpec,
		opts: { labelOverlay?: boolean }
	): Promise<void>;
}
```

`resolve` turns your id into a neutral spec — `flat`, `style`, `well-known`, or
`native` for something only one SDK can build, such as a hosted web map.
`decorate` runs after the basemap is applied, which is where label handling
lives, because that has no neutral form.

## The escape hatch

Some work is genuinely SDK-bound — a renderer expression language, a SQL
filter, a hosted feature service. Reach for the SDK explicitly, and say so:

```ts
return {
	name: 'dataLayers',
	requires: 'arcgis',
	setup(ctx, config) {
		const { view, map, loadModules } = ctx.provider.native('arcgis');
		…
	}
};
```

`requires` is checked by the registry **before any setup runs**, so a config
that asks for an ArcGIS-only capability on MapLibre throws
`ProviderMismatchError` at mount instead of rendering an empty map.
`native()` for the wrong provider throws the same error.

## Writing a fourth adapter

1. Implement `MapProvider` in your own module.
2. Export `create<Name>Provider(options, container): Promise<MapProvider>`.
3. Add the kind to `ProviderKind` and `NativeSurfaces`.
4. Add the branch in `MapEngine`'s provider construction.

Nothing above the engine changes. A capability that cannot run on your provider
declares `requires`.

**Verify it in a browser with a real GPU.** A passing adapter test suite proves
the _contract_ is implemented, never that the stack renders — and a blank page
in a WebGL-limited automation environment proves nothing at all. Both mistakes
have been made on this codebase, in opposite directions, on the same adapter.

## Known gaps in the MapLibre adapter

Each is documented at its member in the source:

- **Camera altitude is derived from zoom.** MapLibre v5 exposes no camera
  altitude, so `camera.get().z` comes from the perspective relationship. It
  round-trips exactly but is not an independent measurement, and it ignores
  tilt.
- **`placement` has no z-order meaning.** MapLibre orders by layer order alone.
- **`setGround` is a no-op.** There is no globe interior to colour.
- **A `well-known` ArcGIS basemap id throws.** A provider's built-in basemaps
  are provider-specific by definition.
- **Scale parity under tilt is approximate.** Calibrate before trusting a tuned
  ladder across providers.
