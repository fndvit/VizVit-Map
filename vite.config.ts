import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		include: ['src/**/*.{test,spec}.{js,ts}'],
		environment: 'jsdom',
		setupFiles: ['src/tests/setup.ts']
	},
	// Svelte 5 ships separate client/server builds; without the browser
	// condition vitest resolves the server one and component tests fail
	// with `mount(...) is not available on the server`.
	resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined
});
