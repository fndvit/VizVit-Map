/**
 * A {@link TileSink} test double that records what the PMTiles adapter streams
 * in and out.
 *
 * `PmtilesLayerAdapter` only ever talks to its layer through the three
 * {@link TileSink} calls, so recording them is enough to observe tile residency,
 * LRU eviction and the scale-window pause WITHOUT a map view or a real
 * `FeatureLayer` — the production sink (`FeatureTileSink`) needs both.
 *
 * Since the seam's payload is a plain {@link TileCell}, this double records the
 * cells themselves: object identity IS the adapter's residency contract (the
 * same instances come back on re-show and on eviction), so the maps below are
 * keyed by cell.
 *
 * ObjectIDs are assigned here exactly as `FeatureTileSink.add` assigns them
 * (a fresh id per cell on every `add`, stamped onto its attributes), so a
 * re-shown tile is visible as new ids on the same cells.
 */

import type { TileCell, TileSink } from '$lib/map-engine/tiles/PmtilesLayerAdapter.js';

/** One recorded `add`/`remove` call, in the order the adapter made it. */
export interface RecordedBatch {
	/** Which sink call this was. */
	op: 'add' | 'remove';
	/** ObjectIDs of the batch's cells (assigned on `add`, read back on `remove`). */
	objectIds: number[];
	/** The batch cells' `h3id` attributes, in order (absent ones are skipped). */
	h3ids: string[];
	/** Number of cells in the batch. */
	count: number;
}

/**
 * Records every `add`/`remove`/`clear` the adapter makes, and tracks which
 * cells are currently resident (added and not since removed).
 */
export class RecordingTileSink implements TileSink {
	/** Every `add`/`remove` call, in order. */
	readonly batches: RecordedBatch[] = [];
	/** How many times `clear()` was called. */
	clears = 0;

	private oid = 0;
	/** Cell → its current ObjectID, for cells that are resident right now. */
	private resident = new Map<TileCell, number>();
	/** Cell → how many times it was handed to `remove()`. */
	private removes = new Map<TileCell, number>();
	/** Cells handed to `add()` while already resident (a double-add bug). */
	readonly doubleAdds: TileCell[] = [];

	/**
	 * Records an add batch and marks its cells resident.
	 *
	 * @param cells - The decoded tile's cells.
	 */
	add(cells: TileCell[]): void {
		const objectIds: number[] = [];
		for (const cell of cells) {
			if (this.resident.has(cell)) this.doubleAdds.push(cell);
			const id = ++this.oid;
			cell.attributes.ObjectID = id;
			this.resident.set(cell, id);
			objectIds.push(id);
		}
		this.batches.push({ op: 'add', objectIds, h3ids: h3idsOf(cells), count: cells.length });
	}

	/**
	 * Records a remove batch and drops its cells from residency.
	 *
	 * @param cells - Cells the adapter hid or evicted.
	 */
	remove(cells: TileCell[]): void {
		const objectIds: number[] = [];
		for (const cell of cells) {
			const id = this.resident.get(cell);
			if (id !== undefined) objectIds.push(id);
			this.resident.delete(cell);
			this.removes.set(cell, (this.removes.get(cell) ?? 0) + 1);
		}
		this.batches.push({
			op: 'remove',
			objectIds,
			h3ids: h3idsOf(cells),
			count: cells.length
		});
	}

	/** Records a `clear()` (adapter destroy) and empties residency. */
	clear(): void {
		this.clears++;
		this.resident.clear();
	}

	/** ObjectIDs of the cells resident right now, in insertion order. */
	residentObjectIds(): number[] {
		return [...this.resident.values()];
	}

	/** `h3id`s of the cells resident right now, in insertion order. */
	residentH3Ids(): string[] {
		return h3idsOf([...this.resident.keys()]);
	}

	/**
	 * How many times a cell was handed to `remove()` — `1` for a tile that
	 * was hidden or evicted exactly once.
	 *
	 * @param cell - The cell to count removals for.
	 */
	removeCount(cell: TileCell): number {
		return this.removes.get(cell) ?? 0;
	}

	/** Every cell this sink has ever seen removed, with its removal count. */
	removeCounts(): Map<TileCell, number> {
		return new Map(this.removes);
	}

	/** Forgets all recorded batches (keeps residency) — for per-phase assertions. */
	resetBatches(): void {
		this.batches.length = 0;
	}
}

/**
 * Reads the `h3id` attribute off each cell, skipping cells without one.
 *
 * @param cells - Cells to read.
 */
function h3idsOf(cells: TileCell[]): string[] {
	const ids: string[] = [];
	for (const cell of cells) {
		const h3id = cell.attributes?.['h3id'];
		if (typeof h3id === 'string') ids.push(h3id);
	}
	return ids;
}
