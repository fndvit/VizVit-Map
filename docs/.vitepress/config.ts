import { defineConfig } from 'vitepress';
import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The documentation site for `@vit-foundation/map`.
 *
 * Scoped to `docs/`. README, CONTRIBUTING and CHANGELOG live at the repository
 * root, outside VitePress's `srcDir`, and are linked from the index rather than
 * pulled in — widening `srcDir` to the root would drag in every other markdown
 * file in the tree.
 *
 * The changelog is the one of those three read every release, and it lives here
 * whole: `docs/changelog/` holds one page per version, and the root
 * `CHANGELOG.md` points at this directory rather than duplicating it.
 */

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The changelog sidebar, read off the directory rather than restated here.
 *
 * Release day adds a file, and a hand-kept list is a list that goes stale
 * silently. `unreleased` sorts above every version, and versions sort by
 * NUMBER — a string sort puts 0.10.0 below 0.9.0, which is wrong the first
 * time a minor reaches double digits and quietly right until then.
 */
const changelogSidebar = readdirSync(resolve(here, '../changelog'))
	.filter((file) => file !== 'index.md' && file.endsWith('.md'))
	.map((file) => file.replace(/\.md$/, ''))
	.sort((a, b) => {
		if (a === 'unreleased') return -1;
		if (b === 'unreleased') return 1;
		const [am, an, ap] = a.split('.').map(Number);
		const [bm, bn, bp] = b.split('.').map(Number);
		return bm - am || bn - an || bp - ap;
	})
	.map((name) => ({
		text: name === 'unreleased' ? 'Unreleased' : name,
		link: `/changelog/${name}`
	}));

export default defineConfig({
	title: '@vit-foundation/map',
	description:
		'A map engine with a provider seam: one view behind five ports, so features run on ArcGIS, MapLibre or a test double.',
	cleanUrls: true,
	lastUpdated: true,
	themeConfig: {
		nav: [
			{ text: 'Guide', link: '/getting-started' },
			{ text: 'Reference', link: '/reference' },
			{ text: 'Changelog', link: '/changelog/' }
		],
		sidebar: [
			{
				text: 'Guide',
				items: [
					{ text: 'Overview', link: '/' },
					{ text: 'Getting started', link: '/getting-started' },
					{ text: 'Providers', link: '/providers' },
					{ text: 'Capabilities', link: '/capabilities' }
				]
			},
			{ text: 'Reference', items: [{ text: 'Entry points', link: '/reference' }] },
			{
				text: 'Changelog',
				items: [{ text: 'All releases', link: '/changelog/' }, ...changelogSidebar]
			}
		],
		socialLinks: [{ icon: 'github', link: 'https://github.com/fndvit/VizVit-Map' }],
		search: { provider: 'local' },
		editLink: {
			pattern: 'https://github.com/fndvit/VizVit-Map/edit/main/docs/:path',
			text: 'Edit this page on GitHub'
		}
	}
});
