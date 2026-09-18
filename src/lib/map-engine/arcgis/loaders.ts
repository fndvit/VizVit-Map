/**
 * @module map-engine/arcgis/loaders
 * The single registry of ArcGIS layer/graphic constructor imports.
 *
 * Callers ask the ArcGIS native surface (`provider.native('arcgis').loadModules`)
 * for constructors by name; this registry maps each name to a literal dynamic
 * `import()` (literal so Vite can statically bundle it) and returns the module's
 * default export. Adding a new constructor is a one-line addition here — nothing
 * above the adapter writes its own `import('@arcgis/core/...')`.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- ArcGIS dynamic imports have no static types */

/** Maps a constructor name to a thunk that imports it (literal specifier for Vite). */
export const ARCGIS_LOADERS = {
	GraphicsLayer: () => import('@arcgis/core/layers/GraphicsLayer'),
	Graphic: () => import('@arcgis/core/Graphic'),
	CSVLayer: () => import('@arcgis/core/layers/CSVLayer'),
	GeoJSONLayer: () => import('@arcgis/core/layers/GeoJSONLayer'),
	FeatureLayer: () => import('@arcgis/core/layers/FeatureLayer'),
	Point: () => import('@arcgis/core/geometry/Point'),
	SimpleRenderer: () => import('@arcgis/core/renderers/SimpleRenderer'),
	UniqueValueRenderer: () => import('@arcgis/core/renderers/UniqueValueRenderer')
} as const satisfies Record<string, () => Promise<{ default: any }>>;

/** Valid constructor names accepted by `loadModules`. */
export type ArcgisModuleName = keyof typeof ARCGIS_LOADERS;

/** A loader registry (the real one, or a fake injected in tests). */
export type ArcgisLoaders = Record<string, () => Promise<{ default: any }>>;
