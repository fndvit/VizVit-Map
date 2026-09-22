import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadFontFaces, resetFontFaceCache, type FontFaceSpec } from '$lib/map-engine/fonts';

/* eslint-disable @typescript-eslint/no-explicit-any -- fakes stand in for the FontFace API */

const heavy: FontFaceSpec = {
	name: 'Caption Heavy',
	family: 'Caption',
	weight: 800,
	src: 'url(/fonts/caption-heavy.woff2) format("woff2")'
};
const regular: FontFaceSpec = {
	name: 'Caption Regular',
	family: 'Caption',
	weight: 400,
	src: 'url(/fonts/caption-regular.woff2) format("woff2")'
};

/** A `FontFace` that records its descriptors and loads (or fails) on demand. */
function fakeEnv(failing: ReadonlySet<string> = new Set()) {
	const constructed: { family: string; src: string; descriptors: Record<string, string> }[] = [];
	const added: any[] = [];
	class FakeFontFace {
		constructor(
			public family: string,
			public src: string,
			public descriptors: Record<string, string>
		) {
			constructed.push({ family, src, descriptors });
		}
		async load() {
			if (failing.has(this.src)) throw new Error(`cannot fetch ${this.src}`);
			return this;
		}
	}
	const fonts = { add: (f: any) => added.push(f), load: vi.fn(async () => []) };
	const head = { appendChild: vi.fn() };
	const document = {
		createElement: () => ({ textContent: '' }),
		head
	} as any;
	return { env: { FontFace: FakeFontFace as any, fonts, document }, constructed, added, head };
}

beforeEach(() => resetFontFaceCache());

describe('loadFontFaces', () => {
	it('registers each face with its family, weight and style through the FontFace API', async () => {
		const { env, constructed, added } = fakeEnv();

		const status = await loadFontFaces([heavy, regular], env);

		expect(status).toEqual({ loaded: ['Caption Heavy', 'Caption Regular'], failed: [] });
		expect(constructed).toEqual([
			{ family: 'Caption', src: heavy.src, descriptors: { weight: '800', style: 'normal' } },
			{ family: 'Caption', src: regular.src, descriptors: { weight: '400', style: 'normal' } }
		]);
		expect(added).toHaveLength(2);
	});

	it('loads a face once however many callers ask for it', async () => {
		const { env, constructed } = fakeEnv();

		await Promise.all([loadFontFaces([heavy], env), loadFontFaces([heavy], env)]);
		await loadFontFaces([heavy], env);

		expect(constructed).toHaveLength(1);
	});

	it('falls back to a CSS @font-face rule when the FontFace API rejects', async () => {
		const { env, head } = fakeEnv(new Set([heavy.src]));

		const status = await loadFontFaces([heavy], env);

		expect(status.loaded).toEqual(['Caption Heavy']);
		expect(head.appendChild).toHaveBeenCalledTimes(1);
		const rule = head.appendChild.mock.calls[0][0].textContent as string;
		expect(rule).toContain("font-family: 'Caption'");
		expect(rule).toContain('font-weight: 800');
		expect(env.fonts.load).toHaveBeenCalledWith('normal 800 16px "Caption"');
	});

	it('reports a face that fails both methods without failing the others', async () => {
		const { env } = fakeEnv(new Set([heavy.src]));
		env.fonts.load = vi.fn(async () => {
			throw new Error('no such font');
		});

		const status = await loadFontFaces([heavy, regular], env);

		expect(status.loaded).toEqual(['Caption Regular']);
		expect(status.failed.map((f) => f.name)).toEqual(['Caption Heavy']);
	});

	it('lets a failed face be retried on a later call', async () => {
		const failing = new Set([heavy.src]);
		const { env } = fakeEnv(failing);
		env.fonts.load = vi.fn(async () => {
			throw new Error('offline');
		});
		expect((await loadFontFaces([heavy], env)).failed).toHaveLength(1);

		failing.clear();
		expect((await loadFontFaces([heavy], env)).loaded).toEqual(['Caption Heavy']);
	});
});
