import { describe, it, expect, vi } from 'vitest';
import { isNorth, mapLikeTouch } from '$lib/map-engine/arcgis/touchNavigation';

/* eslint-disable @typescript-eslint/no-explicit-any -- fakes stand in for ArcGIS internals */

/**
 * A stand-in for the SDK's `InputHandler`: records each `registerIncoming`
 * callback by event type so a test can feed it events.
 */
class FakeInputHandler {
	/** Callbacks by incoming event type. */
	incoming: Record<string, (e: any) => void> = {};

	/**
	 * @param hasSideEffects - Recorded, as the SDK's base class does.
	 */
	constructor(public hasSideEffects: boolean) {}

	/**
	 * @param type - The incoming event type.
	 * @param callback - Called with each event of that type.
	 */
	registerIncoming(type: string, callback: (e: any) => void) {
		this.incoming[type] = callback;
	}
}

/**
 * A fake `SceneView` with the internal input manager `mapLikeTouch` installs into.
 *
 * @param heading - The camera heading the view reports.
 * @returns The view, its input manager and the installed handler (once installed).
 */
function fakeView(heading = 0) {
	const groups = new Map<string, { handlers: any[]; priority: number }>();
	const manager = {
		installHandlers: vi.fn((name: string, handlers: any[], priority: number) => {
			groups.set(name, { handlers, priority });
		}),
		uninstallHandlers: vi.fn((name: string) => groups.delete(name)),
		hasHandlers: (name: string) => groups.has(name)
	};
	const view: any = {
		inputManager: { _inputManager: manager },
		navigation: { momentumEnabled: true },
		camera: { heading, tilt: 10 },
		goTo: vi.fn(() => Promise.resolve())
	};
	const handler = () => [...groups.values()][0]?.handlers[0] as FakeInputHandler;
	return { view, manager, groups, handler };
}

/**
 * Sends one drag event through the installed handler.
 *
 * @param h - The installed handler.
 * @param data - The drag payload.
 * @returns The payload, as the SDK's own handlers would then read it.
 */
function drag(h: FakeInputHandler, data: Record<string, unknown>) {
	h.incoming.drag({ data });
	return data;
}

describe('isNorth', () => {
	it.each([0, 360, -360, 0.005, 359.995])('%s° is north', (h) => expect(isNorth(h)).toBe(true));
	it.each([1, -1, 90, 180, 359])('%s° is not', (h) => expect(isNorth(h)).toBe(false));
});

describe('mapLikeTouch', () => {
	it('installs one handler ahead of the SDK navigation', () => {
		const { view, groups, handler } = fakeView();
		mapLikeTouch(view, FakeInputHandler);
		expect(groups.size).toBe(1);
		expect([...groups.values()][0].priority).toBeGreaterThan(-3);
		expect(handler().hasSideEffects).toBe(true);
	});

	it('pins the pinch angle so a touch pinch never rotates', () => {
		const { view, handler } = fakeView();
		mapLikeTouch(view, FakeInputHandler);
		const h = handler();
		expect(drag(h, { action: 'start', pointerType: 'touch', angle: 0.4 }).angle).toBe(0);
		expect(drag(h, { action: 'update', pointerType: 'touch', angle: -1.2 }).angle).toBe(0);
	});

	it('leaves mouse drags untouched', () => {
		const { view, handler } = fakeView();
		mapLikeTouch(view, FakeInputHandler);
		expect(drag(handler(), { action: 'update', pointerType: 'mouse', angle: 0.4 }).angle).toBe(0.4);
	});

	it('stops the two-finger tilt gesture', () => {
		const { view, handler } = fakeView();
		mapLikeTouch(view, FakeInputHandler);
		const stopPropagation = vi.fn();
		handler().incoming['vertical-two-finger-drag']({ stopPropagation });
		expect(stopPropagation).toHaveBeenCalled();
	});

	it('turns momentum off for touch drags and back on for mouse drags', () => {
		const { view, handler } = fakeView();
		mapLikeTouch(view, FakeInputHandler);
		drag(handler(), { action: 'start', pointerType: 'touch', angle: 0 });
		expect(view.navigation.momentumEnabled).toBe(false);
		drag(handler(), { action: 'start', pointerType: 'mouse', angle: 0 });
		expect(view.navigation.momentumEnabled).toBe(true);
	});

	it('keeps a view built without momentum without it', () => {
		const { view, handler } = fakeView();
		view.navigation.momentumEnabled = false;
		mapLikeTouch(view, FakeInputHandler);
		drag(handler(), { action: 'start', pointerType: 'mouse', angle: 0 });
		expect(view.navigation.momentumEnabled).toBe(false);
	});

	it('turns a drifted view back to north when the last finger lifts', async () => {
		const { view, handler } = fakeView(3.5);
		mapLikeTouch(view, FakeInputHandler);
		drag(handler(), { action: 'removed', pointerType: 'touch', angle: 0 });
		await Promise.resolve();
		expect(view.goTo).not.toHaveBeenCalled();
		drag(handler(), { action: 'end', pointerType: 'touch', angle: 0 });
		await Promise.resolve();
		expect(view.goTo).toHaveBeenCalledWith({ heading: 0 }, { duration: 200 });
	});

	it('eases a pinch-leaned view back to the tilt the gesture started from', async () => {
		const { view, handler } = fakeView(0);
		mapLikeTouch(view, FakeInputHandler);
		drag(handler(), { action: 'start', pointerType: 'touch', angle: 0 });
		view.camera.tilt = 5.1;
		drag(handler(), { action: 'end', pointerType: 'touch', angle: 0 });
		await Promise.resolve();
		expect(view.goTo).toHaveBeenCalledWith({ tilt: 10 }, { duration: 200 });
	});

	it('leaves a north-up view at its starting tilt alone', async () => {
		const { view, handler } = fakeView(0);
		mapLikeTouch(view, FakeInputHandler);
		drag(handler(), { action: 'start', pointerType: 'touch', angle: 0 });
		drag(handler(), { action: 'end', pointerType: 'touch', angle: 0 });
		await Promise.resolve();
		expect(view.goTo).not.toHaveBeenCalled();
	});

	it('removes the handler and restores momentum', () => {
		const { view, manager, groups, handler } = fakeView();
		const nav = mapLikeTouch(view, FakeInputHandler);
		drag(handler(), { action: 'start', pointerType: 'touch', angle: 0 });
		nav.remove();
		expect(manager.uninstallHandlers).toHaveBeenCalled();
		expect(groups.size).toBe(0);
		expect(view.navigation.momentumEnabled).toBe(true);
	});

	it('warns and keeps the SDK defaults when the input manager is out of reach', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const view: any = { navigation: { momentumEnabled: true } };
		const nav = mapLikeTouch(view, FakeInputHandler);
		expect(warn).toHaveBeenCalledOnce();
		expect(() => nav.remove()).not.toThrow();
		warn.mockRestore();
	});
});
