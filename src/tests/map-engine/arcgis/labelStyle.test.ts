import { describe, it, expect } from 'vitest';
import {
	createLabelStyleCompiler,
	pxToPoints,
	type LabelFontResolver
} from '$lib/map-engine/arcgis/labelStyle';
import { scaleForZoom } from '$lib/map-engine/scale';

/** A slice of an Esri vector tile style: a point class with a ramp, a polygon class with the `/label` suffix, two classes on one source-layer. */
const STYLE = {
	layers: [
		{ id: 'landF', type: 'fill', 'source-layer': 'landF', paint: { 'fill-color': '#eee' } },
		{
			id: 'countryLgT',
			type: 'symbol',
			'source-layer': 'countryLgT',
			minzoom: 2,
			maxzoom: 6,
			layout: {
				'text-field': '{_name}',
				'text-font': ['NatGeo NeoGothic Regular', 'Arial Regular'],
				'text-size': {
					stops: [
						[2, 12],
						[6, 24]
					]
				},
				'text-transform': 'uppercase',
				'text-max-width': 8
			},
			paint: { 'text-halo-color': '#fff', 'text-halo-width': 2 }
		},
		{
			id: 'stateLgT/label/Class 1',
			type: 'symbol',
			'source-layer': 'stateLgT/label',
			minzoom: 4,
			layout: { 'text-field': '{_name}', 'text-font': ['NatGeo Caption Heavy'], 'text-size': 11 },
			paint: { 'text-color': '#ff5050' }
		},
		{
			id: 'stateLgT/label/Class 2',
			type: 'symbol',
			'source-layer': 'stateLgT/label',
			minzoom: 5,
			layout: { 'text-field': '{_name}', 'text-size': 9 }
		},
		{ id: 'icon-only', type: 'symbol', 'source-layer': 'poi', layout: { 'icon-image': 'x' } }
	]
};

const fonts: LabelFontResolver = (face) =>
	face === 'NatGeo Caption Heavy'
		? { family: 'NatGeo Caption', weight: 'bold' }
		: { family: 'NatGeo NeoGothic', weight: 'normal' };

describe('createLabelStyleCompiler', () => {
	const labels = createLabelStyleCompiler(STYLE, { scheme: { tilePx: 512, snap: 0.5 } });

	it('lists only the symbol layers that carry text', () => {
		expect(labels.textLayers().map((l) => l.id)).toEqual([
			'countryLgT',
			'stateLgT/label/Class 1',
			'stateLgT/label/Class 2'
		]);
	});

	it('reads a class’s text style, taking the first face of the stack and the middle stop of a ramp', () => {
		expect(labels.textStyleFor('countryLgT')).toEqual({
			color: '#333333',
			font: 'NatGeo NeoGothic Regular',
			size: 24,
			haloColor: '#fff',
			haloWidth: 2,
			haloBlur: undefined,
			textTransform: 'uppercase',
			letterSpacing: undefined,
			lineHeight: 1.2,
			maxWidth: 8
		});
	});

	it('matches a polygon label class through the Esri `/label` suffix and picks the first class', () => {
		expect(labels.textStyleFor('stateLgT')?.font).toBe('NatGeo Caption Heavy');
		expect(labels.textStyleFor('stateLgT')?.color).toBe('#ff5050');
	});

	it('lets the caller choose the class', () => {
		const second = createLabelStyleCompiler(STYLE, {
			pickClass: (candidates) => candidates[candidates.length - 1]
		});
		expect(second.textStyleFor('stateLgT')?.size).toBe(9);
		expect(second.zoomBandFor('stateLgT')?.minZoom).toBe(5);
	});

	it('applies the caller’s defaults where the style declares nothing', () => {
		const branded = createLabelStyleCompiler(STYLE, {
			defaults: { color: '#404040', font: 'Brand Face', haloWidth: 1 }
		});
		const style = branded.textStyleFor('stateLgT')!;
		// Declared red stays; the undeclared halo width takes the caller's default.
		expect(style.color).toBe('#ff5050');
		expect(style.haloWidth).toBe(1);
		expect(branded.textStyleFor('countryLgT')?.color).toBe('#404040');
	});

	it('returns null for a source-layer the style does not label', () => {
		expect(labels.textStyleFor('poi')).toBeNull();
		expect(labels.zoomBandFor('nowhere')).toBeNull();
		expect(labels.sizeRampFor('nowhere')).toBeNull();
	});

	it('converts a zoom band to scales through the given tile scheme', () => {
		const band = labels.zoomBandFor('countryLgT')!;
		expect(band).toMatchObject({ minZoom: 2, maxZoom: 6 });
		expect(band.minScale).toBe(Math.round(scaleForZoom(2, { tilePx: 512, snap: 0.5 })));
		expect(band.maxScale).toBe(Math.round(scaleForZoom(6, { tilePx: 512, snap: 0.5 })));
		// Appears before it hides.
		expect(band.minScale).toBeGreaterThan(band.maxScale);
	});

	it('leaves an undeclared edge unbounded (0)', () => {
		expect(labels.zoomBandFor('stateLgT')).toMatchObject({ maxZoom: null, maxScale: 0 });
	});

	it('returns a size ramp as sorted stops, and null for a static size', () => {
		expect(labels.sizeRampFor('countryLgT')).toEqual([
			{ zoom: 2, size: 12 },
			{ zoom: 6, size: 24 }
		]);
		expect(labels.sizeRampFor('stateLgT')).toBeNull();
	});

	it('round-trips scale and zoom through its own scheme', () => {
		expect(labels.zoomForScale(labels.scaleForZoom(3))).toBeCloseTo(3, 5);
	});

	it('builds an ArcGIS TextSymbol with the face resolved and px turned into points', () => {
		const symbol = labels.textSymbol(labels.textStyleFor('stateLgT')!, fonts);
		expect(symbol).toEqual({
			type: 'text',
			color: '#ff5050',
			font: { family: 'NatGeo Caption', size: pxToPoints(11), style: 'normal', weight: 'bold' },
			haloColor: '#ffffff',
			haloSize: 1,
			lineHeight: 1.2,
			angle: 0,
			xOffset: 0,
			yOffset: 0
		});
	});
});

describe('pxToPoints', () => {
	it('converts CSS pixels to typographic points at 96 dpi', () => {
		expect(pxToPoints(16)).toBe(12);
		expect(pxToPoints(12)).toBe(9);
	});

	it('rounds to a tenth of a point', () => {
		expect(pxToPoints(11)).toBe(8.3);
	});
});
