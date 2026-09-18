/**
 * @module map-engine/arcgis/flatStyle
 * How the ArcGIS adapter renders a `flat` basemap spec: a MapLibre-format style
 * document over Esri's World Basemap vector tiles, with the land and ocean fills
 * swapped for the caller's colours. ArcGIS-bound (the tile source is Esri's), so
 * it lives with the adapter rather than in the app's basemap config.
 */

/**
 * Returns whether a basemap ID is a flat preset (needs VectorTileLayer).
 * @param id - Registry basemap ID
 */
export function isFlatBasemap(id: string): boolean {
	return id.startsWith('flat-') || id === 'custom-flat';
}

/**
 * Builds a flat-color VectorTileLayer style with custom land/ocean colors.
 * Used by flat presets and the configurator's custom color mode.
 *
 * @param oceanColor - Hex color for ocean/marine areas
 * @param landColor - Hex color for land masses
 * @returns MapLibre GL style object ready for ArcGIS VectorTileLayer
 */
export function buildFlatStyle(oceanColor: string, landColor: string) {
	return {
		version: 8,
		sprite:
			'https://basemaps.arcgis.com/arcgis/rest/services/World_Basemap_v2/VectorTileServer/resources/sprites/sprite',
		glyphs:
			'https://basemaps.arcgis.com/arcgis/rest/services/World_Basemap_v2/VectorTileServer/resources/fonts/{fontstack}/{range}.pbf',
		sources: {
			esri: {
				url: 'https://basemaps.arcgis.com/arcgis/rest/services/World_Basemap_v2/VectorTileServer',
				type: 'vector'
			}
		},
		layers: [
			{
				id: 'Marine area',
				type: 'fill',
				source: 'esri',
				'source-layer': 'Marine area',
				minzoom: 0,
				layout: {},
				paint: { 'fill-color': oceanColor }
			},
			{
				id: 'Land',
				type: 'fill',
				source: 'esri',
				'source-layer': 'Land',
				minzoom: 0,
				layout: {},
				paint: { 'fill-color': landColor }
			}
		]
	};
}
