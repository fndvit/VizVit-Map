// jsdom has no ResizeObserver, which Svelte's bind:clientWidth relies on.
// A no-op stub keeps components using dimension bindings renderable in tests
// (observed sizes stay 0, so size-dependent behavior takes its zero-width path).
if (typeof globalThis.ResizeObserver === 'undefined') {
	globalThis.ResizeObserver = class {
		observe() {}
		unobserve() {}
		disconnect() {}
	} as unknown as typeof ResizeObserver;
}
