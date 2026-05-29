import { Pipeline } from '../types/pipeline';
import { KanbanPreset } from '../types/kanban';
import { buildKanbanCellKey, KanbanColumn, KanbanLane } from './kanban-query';

interface KanbanStatusCollapseOptions {
	preset: KanbanPreset;
	columns: KanbanColumn[];
	manuallyCollapsedStatusIds?: Iterable<string>;
	temporarilyExpandedAutoCollapsedStatusIds?: Iterable<string>;
	searchActive?: boolean;
}

interface KanbanSkippedMaterializationOptions {
	pipeline: Pipeline;
	preset: KanbanPreset;
	manuallyCollapsedStatusIds?: Iterable<string>;
	temporarilyExpandedAutoCollapsedStatusIds?: Iterable<string>;
}

interface KanbanLaneCollapseOptions {
	preset: KanbanPreset;
	columns: KanbanColumn[];
	lanes: KanbanLane[];
	cellCountMap: Map<string, number>;
	autoCollapsedStatusIds: Iterable<string>;
	manuallyCollapsedLaneKeys?: Iterable<string>;
	temporarilyExpandedAutoCollapsedLaneKeys?: Iterable<string>;
	searchActive?: boolean;
}

export function resolveAutoCollapsedKanbanStatusIds(options: KanbanStatusCollapseOptions): Set<string> {
	const temporarilyExpanded = new Set(options.temporarilyExpandedAutoCollapsedStatusIds ?? []);
	const collapsed = new Set<string>();
	if (options.preset.collapseEmptyColumns) {
		for (const column of options.columns) {
			if (column.count === 0 && !temporarilyExpanded.has(column.statusId)) {
				collapsed.add(column.statusId);
			}
		}
	}
	if (options.preset.autoCollapseFinishedColumns) {
		for (const column of options.columns) {
			if (column.isFinished && !temporarilyExpanded.has(column.statusId)) {
				collapsed.add(column.statusId);
			}
		}
	}
	return collapsed;
}

export function resolveCollapsedKanbanStatusIds(options: KanbanStatusCollapseOptions): Set<string> {
	if (options.searchActive) {
		return new Set(
			options.columns
				.filter(column => column.count === 0)
				.map(column => column.statusId),
		);
	}
	return new Set([
		...(options.manuallyCollapsedStatusIds ?? []),
		...resolveAutoCollapsedKanbanStatusIds(options),
	]);
}

export function resolveSkippedKanbanStatusMaterializationIds(options: KanbanSkippedMaterializationOptions): Set<string> {
	const temporarilyExpanded = new Set(options.temporarilyExpandedAutoCollapsedStatusIds ?? []);
	const skipped = new Set(
		Array.from(options.manuallyCollapsedStatusIds ?? [])
			.filter(statusId => options.pipeline.statuses.some(status => status.id === statusId)),
	);
	if (options.preset.autoCollapseFinishedColumns) {
		for (const status of options.pipeline.statuses) {
			if (status.isFinished && !temporarilyExpanded.has(status.id)) {
				skipped.add(status.id);
			}
		}
	}
	return skipped;
}

export function resolveAutoCollapsedKanbanLaneKeys(options: KanbanLaneCollapseOptions): Set<string> {
	const collapsed = new Set<string>();
	if (!options.preset.collapseEmptySwimlanes) return collapsed;
	const temporarilyExpanded = new Set(options.temporarilyExpandedAutoCollapsedLaneKeys ?? []);
	const autoCollapsedStatusIds = new Set(options.autoCollapsedStatusIds);
	for (const lane of options.lanes) {
		if (temporarilyExpanded.has(lane.key)) continue;
		if (resolveVisibleLaneTaskCount(options.columns, options.cellCountMap, autoCollapsedStatusIds, lane.key) === 0) {
			collapsed.add(lane.key);
		}
	}
	return collapsed;
}

export function resolveCollapsedKanbanLaneKeys(options: KanbanLaneCollapseOptions): Set<string> {
	if (options.searchActive) {
		return new Set(
			options.lanes
				.filter(lane => lane.count === 0)
				.map(lane => lane.key),
		);
	}
	return new Set([
		...(options.manuallyCollapsedLaneKeys ?? []),
		...resolveAutoCollapsedKanbanLaneKeys(options),
	]);
}

function resolveVisibleLaneTaskCount(
	columns: KanbanColumn[],
	cellCountMap: Map<string, number>,
	autoCollapsedStatusIds: Set<string>,
	laneKey: string,
): number {
	let count = 0;
	for (const column of columns) {
		if (autoCollapsedStatusIds.has(column.statusId)) continue;
		count += cellCountMap.get(buildKanbanCellKey(column.statusId, laneKey)) ?? 0;
	}
	return count;
}
