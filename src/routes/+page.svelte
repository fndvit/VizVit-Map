<!--
	@component The package's own showcase route.

	Not published: only `src/lib` is packaged. It exists because `svelte-kit sync`
	(which `prepack` runs before `svelte-package`) requires an app scaffold, and
	because `npm run dev` is the quickest way to try the library by hand.
-->
<main>
	<h1>@vit-foundation/map</h1>
	<p>
		A map engine with a provider seam: one live view behind five ports, so the features you build on
		it run on ArcGIS, on MapLibre GL, or on an in-memory double in tests.
	</p>
	<p>See <code>README.md</code> for the entry points and the contract.</p>
</main>

<style>
	main {
		max-width: 42rem;
		margin: 4rem auto;
		padding: 0 1rem;
		font-family: system-ui, sans-serif;
		line-height: 1.6;
	}
</style>
