import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HoverManager } from '$lib/map-engine/HoverManager';

/* eslint-disable @typescript-eslint/no-explicit-any -- fakes stand in for ArcGIS view events */

/** A `Subscribe` that records handlers by event name so the test can fire them. */
function makeSubscribe(handlers: Record<string, (e?: any) => void>) {
	return (name: string, h: (e: any) => void) => {
		handlers[name] = h;
		return { remove: vi.fn() };
	};
}

beforeEach(() => {
	// Run the rAF callback synchronously so the throttled resolve is testable.
	vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => {
		cb(0);
		return 1;
	});
	vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => vi.unstubAllGlobals());

describe('HoverManager', () => {
	it('resolves via the injected strategy on pointer-move and emits onHover', async () => {
		const handlers: Record<string, (e?: any) => void> = {};
		const hm = new HoverManager<{ id: string }>(makeSubscribe(handlers));
		const strategy = vi.fn(async () => ({ id: 'abc' }));
		const onHover = vi.fn();
		hm.setStrategy(strategy);
		hm.onHover(onHover);
		hm.start();

		handlers['pointer-move']({ x: 1, y: 1 });
		await vi.waitFor(() => expect(onHover).toHaveBeenCalledWith({ id: 'abc' }));
		expect(strategy).toHaveBeenCalledWith({ x: 1, y: 1 });
	});

	it('emits onHover(null) + onLeave on pointer-leave', () => {
		const handlers: Record<string, (e?: any) => void> = {};
		const hm = new HoverManager(makeSubscribe(handlers));
		const onHover = vi.fn();
		const onLeave = vi.fn();
		hm.setStrategy(async () => ({}));
		hm.onHover(onHover);
		hm.onLeave(onLeave);
		hm.start();

		handlers['pointer-leave']();
		expect(onHover).toHaveBeenCalledWith(null);
		expect(onLeave).toHaveBeenCalledOnce();
	});

	it('emits onHover(null) when the strategy throws', async () => {
		const handlers: Record<string, (e?: any) => void> = {};
		const hm = new HoverManager(makeSubscribe(handlers));
		const onHover = vi.fn();
		hm.setStrategy(async () => {
			throw new Error('boom');
		});
		hm.onHover(onHover);
		hm.start();

		handlers['pointer-move']({ x: 1, y: 1 });
		await vi.waitFor(() => expect(onHover).toHaveBeenCalledWith(null));
	});

	it('resolveAt runs the strategy once WITHOUT emitting (click/validation path)', async () => {
		const handlers: Record<string, (e?: any) => void> = {};
		const hm = new HoverManager<{ id: string }>(makeSubscribe(handlers));
		const onHover = vi.fn();
		hm.setStrategy(async (e) => ({ id: `${e.x},${e.y}` }));
		hm.onHover(onHover);
		hm.start();

		const result = await hm.resolveAt({ x: 5, y: 6 });
		expect(result).toEqual({ id: '5,6' });
		expect(onHover).not.toHaveBeenCalled();
	});

	it('refresh re-emits only while the pointer is inside', async () => {
		const handlers: Record<string, (e?: any) => void> = {};
		const hm = new HoverManager<{ id: string }>(makeSubscribe(handlers));
		const onHover = vi.fn();
		hm.setStrategy(async () => ({ id: 'x' }));
		hm.onHover(onHover);
		hm.start();

		// No pointer inside yet → refresh is a no-op.
		hm.refresh();
		expect(onHover).not.toHaveBeenCalled();

		// Pointer enters, then leaves.
		handlers['pointer-move']({ x: 1, y: 1 });
		await vi.waitFor(() => expect(onHover).toHaveBeenCalledTimes(1));
		handlers['pointer-leave'](); // onHover(null) → 2 calls, inside=false
		onHover.mockClear();

		// Refresh after leave → still a no-op.
		hm.refresh();
		expect(onHover).not.toHaveBeenCalled();
	});

	it('destroy removes the subscriptions', () => {
		const removes = { move: vi.fn(), leave: vi.fn() };
		let n = 0;
		const subscribe = () => ({ remove: n++ === 0 ? removes.move : removes.leave });
		const hm = new HoverManager(subscribe);
		hm.start();
		hm.destroy();
		expect(removes.move).toHaveBeenCalledOnce();
		expect(removes.leave).toHaveBeenCalledOnce();
	});
});
