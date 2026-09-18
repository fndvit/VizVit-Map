/**
 * The packaging boundary, pinned.
 *
 * This repository *is* the package, so the properties that used to protect the
 * extraction now protect the published output. All three are the kind that
 * erode with one convenient import:
 *
 * 1. **Fully specified module specifiers** (`./foo.js`, `$lib/map-engine/x.js`).
 *    Node does not guess extensions. `svelte-package` emits relative specifiers
 *    verbatim and rewrites a `$lib` alias to a relative path *without* inventing
 *    the extension the source omitted — so either kind, left bare, builds here
 *    and is unimportable from the published package. Both halves of this have
 *    bitten once each: `./config` in the engine, and `$lib/map-engine/provider`
 *    in the globe layer, the latter slipping past an earlier version of this
 *    very test because it only checked relative ones.
 * 2. **The layering holds.** The globe layer may reach the map engine; the map
 *    engine may not reach back. A single import the other way would make the
 *    engine unusable on its own (`@vit-foundation/map/engine`).
 * 3. **The worker the build has to find exists.** The PMTiles decode worker is
 *    named inside a `new URL(...)` *string*, which neither `svelte-check` nor
 *    the unit tests resolve — only a consumer's bundler does, against `dist`,
 *    where the file is `.js`. That has now bitten twice.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const LIBRARY_ROOT = 'src/lib';

/** Every `.ts` / `.svelte` source file under a root, recursively. */
function sourceFiles(root: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(root)) {
		const path = join(root, entry);
		if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
		else if (entry.endsWith('.ts') || entry.endsWith('.svelte')) out.push(path);
	}
	return out;
}

/**
 * Every module specifier a file imports (static `import`/`export … from`).
 * Comments are stripped first — these modules document themselves with usage
 * snippets, and a fenced `import … from '@vit-foundation/map'` in a doc
 * block is prose, not a dependency.
 */
function specifiersOf(source: string): string[] {
	const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
	return [...code.matchAll(/(?:import|export)[^;]*?from\s*'([^']+)'/gs)].map((m) => m[1]);
}

describe('the map library is packageable', () => {
	const files = sourceFiles(LIBRARY_ROOT);

	it('has files to check', () => {
		expect(files.length).toBeGreaterThan(5);
	});

	it('spells every relative and aliased import out in full', () => {
		// `$lib/…` counts: svelte-package turns it into a relative specifier and
		// carries the missing extension straight through into `dist`.
		const offenders: string[] = [];
		for (const file of files) {
			for (const specifier of specifiersOf(readFileSync(file, 'utf8'))) {
				const resolvable = specifier.startsWith('.') || specifier.startsWith('$lib/');
				if (!resolvable) continue;
				if (/\.(js|svelte|css|json)$/.test(specifier)) continue;
				offenders.push(`${file} imports ${specifier}`);
			}
		}
		expect(offenders).toEqual([]);
	});

	it('keeps the map engine independent of the globe layer', () => {
		const offenders: string[] = [];
		for (const file of files) {
			if (!file.startsWith(join('src', 'lib', 'map-engine'))) continue;
			for (const specifier of specifiersOf(readFileSync(file, 'utf8'))) {
				if (specifier.startsWith('$lib/globe')) offenders.push(`${file} imports ${specifier}`);
			}
		}
		expect(offenders).toEqual([]);
	});

	it("hardcodes no consumer's column names", () => {
		// The published adapter used to read `attributes['h3id']` directly — this
		// project's pipeline convention, and not a stable one even there (the same
		// project's Schneider sources name the column `id`). A consumer whose
		// tiles name it anything else got a silently empty hover index. Column
		// names are the consumer's vocabulary, so they arrive as options.
		const offenders: string[] = [];
		for (const file of files) {
			const source = readFileSync(file, 'utf8');
			for (const [, literal] of source.matchAll(/attributes\??\.?\[['"]([^'"]+)['"]\]/g)) {
				offenders.push(`${file} reads attributes['${literal}']`);
			}
		}
		expect(offenders).toEqual([]);
	});

	it('names no NatGeo domain vocabulary in executable code', () => {
		// Doc comments may cite the consumer that drove a design; code may not
		// know it exists.
		const DOMAIN = /\b(natgeo|cropgrids|schneider|glcfcs|koppen|pepsico)\b/i;
		const offenders: string[] = [];
		for (const file of files) {
			const code = readFileSync(file, 'utf8')
				// Svelte `<!-- @component -->` blocks are documentation too.
				.replace(/<!--[\s\S]*?-->/g, '')
				.replace(/\/\*[\s\S]*?\*\//g, '')
				.replace(/\/\/.*$/gm, '');
			const hit = code.match(DOMAIN);
			if (hit) offenders.push(`${file} names ${hit[0]}`);
		}
		expect(offenders).toEqual([]);
	});

	it('names a decode worker that survives `svelte-package`', () => {
		// `svelte-package` copies this string through verbatim while transpiling
		// the worker itself, so the name has to be the one `dist` ends up with —
		// `.js`. Vite maps that back to the `.ts` source when the library is run
		// from source; nothing maps `.ts` forward to a `dist` that has no `.ts`.
		const dir = join('src', 'lib', 'map-engine', 'tiles');
		const client = readFileSync(join(dir, 'pmtilesDecodeClient.ts'), 'utf8');
		const named = client.match(/new URL\('\.\/([^']+)'/)?.[1];
		expect(named).toMatch(/\.js$/);
		const source = named!.replace(/\.js$/, '.ts');
		expect(existsSync(join(dir, source)) || existsSync(join(dir, named!))).toBe(true);
	});
});
