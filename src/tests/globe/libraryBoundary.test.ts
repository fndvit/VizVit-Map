/**
 * The packaging boundary, pinned.
 *
 * `src/lib/globe` is the provider-neutral globe library — the layer that is meant
 * to leave this repository as a package, the way `src/lib/map-engine` already
 * did. Two properties make that possible, and both are the kind that erode with
 * one convenient import:
 *
 * 1. **No app imports.** The library may reach the map engine and nothing else
 *    in `$lib`. A single `$lib/explore/...` import would drag the explore state,
 *    the H3 ladder and the CROPGRIDS column vocabulary into the package.
 * 2. **Fully specified module specifiers** (`./foo.js`, `$lib/map-engine/x.js`).
 *    Node does not guess extensions. `svelte-package` emits relative specifiers
 *    verbatim and rewrites a `$lib` alias to a relative path *without* inventing
 *    the extension the source omitted — so either kind, left bare, builds here
 *    and is unimportable from the published package. Both halves of this have
 *    now bitten this repo once each: `./config` in the engine, and
 *    `$lib/map-engine/provider` in this library, the latter slipping past an
 *    earlier version of this very test because it only checked relative ones.
 *
 * The app's own globe layer (`src/lib/site-globe`) is deliberately not covered:
 * binding `<Globe>` to the NatGeo domain is its whole job.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const LIBRARY_ROOT = 'src/lib/globe';

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
 * snippets, and a fenced `import … from '$lib/globe'` in a doc block is prose,
 * not a dependency.
 */
function specifiersOf(source: string): string[] {
	const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
	return [...code.matchAll(/(?:import|export)[^;]*?from\s*'([^']+)'/gs)].map((m) => m[1]);
}

describe('the globe library is packageable', () => {
	const files = sourceFiles(LIBRARY_ROOT);

	it('has files to check', () => {
		expect(files.length).toBeGreaterThan(5);
	});

	it('imports nothing from the app but the map engine', () => {
		const offenders: string[] = [];
		for (const file of files) {
			for (const specifier of specifiersOf(readFileSync(file, 'utf8'))) {
				if (!specifier.startsWith('$lib/')) continue;
				if (specifier === '$lib/map-engine' || specifier.startsWith('$lib/map-engine/')) continue;
				offenders.push(`${file} imports ${specifier}`);
			}
		}
		expect(offenders).toEqual([]);
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
});
