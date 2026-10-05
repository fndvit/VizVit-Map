import { makeFakeProvider, type FakeGeoJsonLayer, type FakePointLayer } from '$lib/testing';
import { describeLayerRegionContract } from '../helpers/layerRegionContract';

describeLayerRegionContract('the fake', () => {
	const provider = makeFakeProvider();
	return {
		points(items) {
			const handle = provider.layers.points({ id: 'p', items }) as FakePointLayer;
			return { handle, drawn: () => handle.drawn.map((i) => i.id) };
		},
		geojson(features) {
			const data = { type: 'FeatureCollection', features };
			const handle = provider.layers.geojson({
				id: 'g',
				source: { data },
				style: {}
			}) as FakeGeoJsonLayer;
			return {
				handle,
				drawn: () =>
					(handle.drawn ?? []).map((f) => (f as { properties: { id: string } }).properties.id)
			};
		}
	};
});
