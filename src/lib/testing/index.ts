/**
 * @module testing
 * The library's test doubles, published so consumers can drive their own
 * capabilities against the provider seam without booting ArcGIS or MapLibre:
 *
 * ```ts
 * import { makeFakeContext } from '@vit-foundation/map/testing';
 * ```
 *
 * The fake provider uses vitest's spies, so this entry point is only importable
 * from a vitest run — it is deliberately not part of the runtime surface.
 */

export {
	makeFakeProvider,
	makeFakeContext,
	type FakeProvider,
	type FakeLayer,
	type FakePointLayer,
	type FakeGeoJsonLayer,
	type FakeProviderOptions
} from './fakeProvider.js';
