import { describe, it, expect } from 'vitest';

import { createHoverCapability } from '$lib/globe/capabilities/hoverCapability';
import type { HoverConfig } from '$lib/globe/config';
import { makeFakeContext } from '$lib/testing/fakeProvider';

describe('hoverCapability (cursor)', () => {
	it('toggles the view cursor based on a point-layer hit', async () => {
		const { ctx, provider } = makeFakeContext();
		provider.layers.points({ id: 'markers' });

		createHoverCapability().setup(ctx, { mode: 'cursor' });

		provider.hits.markers = 'india';
		await provider.fire('pointer-move', { x: 1, y: 1 });
		expect(provider.cursor).toBe('pointer');

		provider.hits.markers = null;
		await provider.fire('pointer-move', { x: 2, y: 2 });
		expect(provider.cursor).toBe('grab');
	});

	it('subscribes to nothing when the mode is not `cursor`', async () => {
		const { ctx, provider } = makeFakeContext();
		provider.layers.points({ id: 'markers' });

		// `cursor` is today's only mode; the guard must still hold for a future one.
		createHoverCapability().setup(ctx, { mode: 'tooltip' } as unknown as HoverConfig);

		provider.hits.markers = 'india';
		await provider.fire('pointer-move', { x: 1, y: 1 });
		expect(provider.cursor).toBe('grab'); // untouched default
	});
});
