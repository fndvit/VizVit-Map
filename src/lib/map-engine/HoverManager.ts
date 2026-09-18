/**
 * @module map-engine/HoverManager
 * The generic hover loop owned by {@link MapEngine} — the domain-free half of the
 * globe's hover machine. It subscribes to the provider's `pointer-move`/`pointer-leave`
 * events, rAF-throttles them, runs an **injected** resolution strategy, and emits
 * the result. It knows nothing about H3 tiers, explore data, or the DOM overlay:
 *
 * - the STRATEGY (screen coords → data cell) is supplied by whoever owns the data
 *   layers — the `dataLayers` capability — via {@link setStrategy}, so this stays
 *   generic and the engine keeps zero `globe/`/`explore/` imports;
 * - the PRESENTATION consumes results via {@link onHover}/{@link onLeave} (wired by
 *   `<Globe>` to the hover overlay).
 *
 * A one-shot {@link resolveAt} lets the click/validation path reuse the same
 * strategy (and its cache) without driving the emit loop.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- the resolved result type is the host's business */

/** Resolves the screen point under the pointer to a result `T`, or `null` for a miss. */
export type HoverStrategy<T> = (event: { x: number; y: number }) => Promise<T | null>;

/**
 * A pointer-event subscription: returns a handle with `.remove()`, or `null`
 * before the view is ready. Satisfied by a map provider's event port narrowed to
 * the two pointer events this loop needs.
 */
export type Subscribe = (
	eventName: 'pointer-move' | 'pointer-leave',
	handler: (event: any) => void
) => { remove(): void } | null;

/**
 * Generic pointer→resolve→emit loop. Construct with a `subscribe` bound to the
 * live view (the engine passes its own `on`), inject a strategy + sinks, `start()`.
 */
export class HoverManager<T = unknown> {
	private strategy: HoverStrategy<T> | null = null;
	private onHoverCb: ((r: T | null) => void) | null = null;
	private onLeaveCb: (() => void) | null = null;
	private moveHandle: { remove(): void } | null = null;
	private leaveHandle: { remove(): void } | null = null;
	private raf = 0;
	private lastEvent: { x: number; y: number } | null = null;
	/** Whether the pointer is currently over the view — gates {@link refresh}. */
	private inside = false;

	/** @param subscribe - Bound pointer-event subscriber (e.g. `provider.events.on`). */
	constructor(private readonly subscribe: Subscribe) {}

	/** Injects the cell-resolution strategy (data-layer owner). `null` disables hover. */
	setStrategy(strategy: HoverStrategy<T> | null): void {
		this.strategy = strategy;
	}

	/** Registers the result sink (presentation pipes it to the overlay). */
	onHover(cb: (r: T | null) => void): void {
		this.onHoverCb = cb;
	}

	/** Registers the pointer-leave sink (fired after the leave `onHover(null)`). */
	onLeave(cb: () => void): void {
		this.onLeaveCb = cb;
	}

	/** Subscribes to the provider's pointer events. Idempotent-safe if called once post-init. */
	start(): void {
		this.moveHandle = this.subscribe('pointer-move', (event: any) => {
			this.inside = true;
			this.lastEvent = { x: event.x, y: event.y };
			this.schedule();
		});
		this.leaveHandle = this.subscribe('pointer-leave', () => {
			this.inside = false;
			if (this.raf) cancelAnimationFrame(this.raf);
			this.raf = 0;
			this.onHoverCb?.(null);
			this.onLeaveCb?.();
		});
	}

	/** rAF-throttled resolve+emit of the last pointer position. */
	private schedule(): void {
		if (this.raf) cancelAnimationFrame(this.raf);
		this.raf = requestAnimationFrame(async () => {
			this.raf = 0;
			await this.emit();
		});
	}

	private async emit(): Promise<void> {
		const event = this.lastEvent;
		if (!event) return;
		try {
			const result = this.strategy ? await this.strategy(event) : null;
			this.onHoverCb?.(result);
		} catch {
			this.onHoverCb?.(null);
		}
	}

	/**
	 * One-shot resolve at an arbitrary event WITHOUT emitting — the click/validation
	 * path uses this so it shares the strategy (and its cache) with the hover loop.
	 */
	async resolveAt(event: { x: number; y: number }): Promise<T | null> {
		return this.strategy ? this.strategy(event) : null;
	}

	/**
	 * Re-runs the strategy at the last pointer position and re-emits — but only
	 * while the pointer is still inside. Used to heal a stationary hover after
	 * late-arriving data (e.g. PMTiles tiles settling).
	 */
	refresh(): void {
		if (this.inside && this.lastEvent) this.schedule();
	}

	/** Cancels any pending resolve and marks the pointer outside (no emit). */
	clear(): void {
		if (this.raf) cancelAnimationFrame(this.raf);
		this.raf = 0;
		this.inside = false;
	}

	/** Removes the view subscriptions and cancels any pending resolve. */
	destroy(): void {
		if (this.raf) cancelAnimationFrame(this.raf);
		this.raf = 0;
		this.moveHandle?.remove();
		this.leaveHandle?.remove();
		this.moveHandle = null;
		this.leaveHandle = null;
	}
}
