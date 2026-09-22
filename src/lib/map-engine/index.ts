/**
 * @module map-engine
 * The map engine: one view's lifecycle, behind a provider-neutral seam. Import
 * everything through this barrel:
 *
 * ```ts
 * import { MapEngine, type MapProvider } from '$lib/map-engine';
 * ```
 *
 * {@link MapEngine} boots a **map provider** and hosts the services that sit
 * above one (the hover loop, the basemap catalog, geocoded fly-to). The provider
 * contract itself lives in `./provider`, and the adapters under `./arcgis` and
 * `./maplibre`. Nothing here imports from the app.
 */

export { MapEngine, type SetBasemapOptions } from './MapEngine.js';
export { HoverManager, type HoverStrategy, type Subscribe } from './HoverManager.js';

// The provider seam: the contract every capability programs against.
export {
	ProviderMismatchError,
	PASSTHROUGH_BASEMAP_CATALOG,
	type ArcgisNative,
	type BasemapCatalog,
	type BasemapSpec,
	type CameraPort,
	type CameraState,
	type CameraTarget,
	type EventPort,
	type FakeNative,
	type FlyOptions,
	type GeoJsonLayerHandle,
	type GeoJsonLayerSpec,
	type GeoJsonStyle,
	type Handle,
	type LayerFactory,
	type LayerHandle,
	type LngLat,
	type MaplibreNative,
	type MapProvider,
	type NativeSurfaces,
	type Padding,
	type Placement,
	type PointerEvt,
	type PointItem,
	type PointLayerHandle,
	type PointLayerSpec,
	type PointSymbol,
	type ProviderEvents,
	type ProviderKind,
	type QualityOptions,
	type ScenePort,
	type ScreenPoint,
	type ScreenPort,
	type Size
} from './provider.js';

// Scale is the LOD currency; zoom is derived.
export { SCALE_Z0, scaleForZoom, zoomForScale, type ZoomScaleOptions } from './scale.js';

// Web font faces a map SDK rasterises label glyphs with.
export {
	loadFontFaces,
	type FontFaceSpec,
	type FontFaceStatus,
	type FontFaceEnvironment
} from './fonts.js';
export { zoomForExtent } from './camera-fit.js';

// Place search (view-independent: components can fetch suggestions without a map).
export { suggestPlaces, locatePlace } from './geocode.js';
export type { PlaceSuggestion, PlaceLocation, PlaceExtent } from './geocode.js';

// The ArcGIS adapter. Deep-import `$lib/map-engine/arcgis` for its internals;
// these are the pieces the app itself still needs (colour conversion, the
// constructor registry behind `native('arcgis').loadModules`).
export { createArcgisProvider, toRgba, ARCGIS_LOADERS } from './arcgis/index.js';
export type { ArcgisLoaders, ArcgisModuleName } from './arcgis/index.js';

export type * from './types.js';
