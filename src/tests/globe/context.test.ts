import { describe, it, expect } from 'vitest';
import { buildGlobeContext } from '$lib/globe/context';
import type { MapEngine } from '$lib/map-engine';
import { makeFakeProvider } from '$lib/testing/fakeProvider';

/* eslint-disable @typescript-eslint/no-explicit-any -- the engine stub is a partial MapEngine */

describe('buildGlobeContext — provider pass-through', () => {
	it('exposes the engine, its live provider and the provider mode', () => {
		const provider = makeFakeProvider({ mode: '3d' });
		const engine = { provider } as unknown as MapEngine;

		const ctx = buildGlobeContext(engine);

		expect(ctx.engine).toBe(engine);
		expect(ctx.provider).toBe(provider);
		expect(ctx.mode).toBe('3d');
	});

	it('takes the mode from the provider, not from a caller argument', () => {
		const provider = makeFakeProvider({ mode: '2d' });
		const ctx = buildGlobeContext({ provider } as unknown as MapEngine);
		expect(ctx.mode).toBe('2d');
	});

	it('throws when the engine has no live provider yet', () => {
		expect(() => buildGlobeContext({ provider: null } as any)).toThrow(/no live provider/);
	});
});
