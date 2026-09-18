/**
 * @module globe/api
 * The imperative handle a `<Globe>` exposes through `onready`.
 *
 * Replaces `StoryGlobeApi`: the Globe Configurator and ExploreGlobe drive the
 * camera imperatively (fly to a waypoint, set padding, read the current camera,
 * zoom). This is a thin pass-through to the {@link MapEngine} boundary.
 */

import type {
	MapEngine,
	SceneCamera,
	CameraReadout,
	FlyToOptions,
	FlyToPlaceOptions
} from '$lib/map-engine/index.js';

/** Imperative camera control surface for tools (configurator) and ExploreGlobe. */
export interface GlobeApi {
	/** Animate the globe camera to a target (3D). */
	flyTo(cam: SceneCamera, opts?: FlyToOptions): Promise<void>;
	/** Geocode a place name and fly to it (optionally pinned via a suggestion `magicKey`). */
	flyToPlace(query: string, opts?: FlyToPlaceOptions): Promise<void>;
	/** Shift the view center within its container (e.g. to clear a sidebar). */
	setPadding(padding: { top: number; right: number; bottom: number; left: number }): void;
	/** Read the current camera + scale, or null if unavailable. */
	readCamera(): CameraReadout | null;
	/** Zoom in one level. */
	zoomIn(): void;
	/** Zoom out one level. */
	zoomOut(): void;
}

/** Builds a {@link GlobeApi} over a ready engine. */
export function makeGlobeApi(engine: MapEngine): GlobeApi {
	return {
		flyTo: (cam, opts) => engine.flyTo(cam, opts),
		flyToPlace: (query, opts) => engine.flyToPlace(query, opts),
		setPadding: (padding) => engine.setPadding(padding),
		readCamera: () => engine.readCamera(),
		zoomIn: () => engine.zoomIn(),
		zoomOut: () => engine.zoomOut()
	};
}
