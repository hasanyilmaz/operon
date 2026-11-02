/** Axis-only geometry. No cell matrix or task data is retained here. */
export interface KanbanVirtualTrack { key: string; size: number }
export interface KanbanVirtualAxis {
	tracks: readonly KanbanVirtualTrack[];
	starts: readonly number[];
	indices: ReadonlyMap<string, number>;
	extent: number;
}
export function buildKanbanVirtualAxis(tracks: readonly KanbanVirtualTrack[], gap: number): KanbanVirtualAxis {
	const starts: number[] = [];
	const indices = new Map<string, number>();
	let offset = 0;
	for (const [index, track] of tracks.entries()) {
		starts.push(offset);
		indices.set(track.key, index);
		offset += Math.max(0, track.size) + gap;
	}
	return { tracks, starts, indices, extent: Math.max(0, offset - (tracks.length ? gap : 0)) };
}
/** Half-open visible interval, extended by one neighbouring track on each side. */
export function getKanbanVirtualRange(axis: KanbanVirtualAxis, offset: number, size: number, overscan = 1): { start: number; end: number } {
	if (!(size > 0) || axis.tracks.length === 0) return { start: 0, end: 0 };
	let low = 0;
	let high = axis.tracks.length;
	while (low < high) {
		const mid = (low + high) >>> 1;
		if (axis.starts[mid] + axis.tracks[mid].size <= offset) low = mid + 1;
		else high = mid;
	}
	const first = low;
	high = axis.tracks.length;
	while (low < high) {
		const mid = (low + high) >>> 1;
		if (axis.starts[mid] < offset + size) low = mid + 1;
		else high = mid;
	}
	return { start: Math.max(0, first - overscan), end: Math.min(axis.tracks.length, low + overscan) };
}
export function kanbanVirtualCellKey(rowKey: string, columnKey: string): string {
	return JSON.stringify([rowKey, columnKey]);
}
