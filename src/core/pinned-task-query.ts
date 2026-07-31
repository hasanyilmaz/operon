import type { OperonIndexer } from '../indexer/indexer';
import type { PinnedCache } from '../storage/pinned-cache';
import type { IndexedTask } from '../types/fields';
import type { PriorityDefinition } from '../types/priority';
import { buildPriorityRankMap, normalizePriorityValue } from './priority-rank';

export type PinnedTaskSortMode = 'priority' | 'lastModified' | 'manual';

export function getPinnedTasksForDisplay(
	indexer: OperonIndexer,
	pinnedCache: PinnedCache,
	priorities: PriorityDefinition[],
	sortMode: PinnedTaskSortMode = 'priority',
): IndexedTask[] {
	const pinnedTasks = indexer.getAllTasks().filter(task => pinnedCache.isPinned(task.operonId));
	if (sortMode === 'manual') {
		return sortPinnedTasksByManualOrder(pinnedTasks, pinnedCache);
	}
	if (sortMode === 'lastModified') {
		return sortPinnedTasksByLastModified(pinnedTasks);
	}
	return sortPinnedTasksForDisplay(pinnedTasks, priorities);
}

export function sortPinnedTasksForDisplay(
	tasks: IndexedTask[],
	priorities: PriorityDefinition[],
): IndexedTask[] {
	const priorityRank = buildPriorityRankMap(priorities);
	const unrankedRank = priorities.length;
	return tasks.slice().sort((a, b) => {
		const pa = priorityRank.get(normalizePriorityValue(a.fieldValues['priority'] ?? '')) ?? unrankedRank;
		const pb = priorityRank.get(normalizePriorityValue(b.fieldValues['priority'] ?? '')) ?? unrankedRank;
		if (pa !== pb) return pa - pb;
		return comparePinnedTasksByLastModified(a, b);
	});
}

export function sortPinnedTasksByLastModified(tasks: IndexedTask[]): IndexedTask[] {
	return tasks.slice().sort(comparePinnedTasksByLastModified);
}

export function sortPinnedTasksByManualOrder(
	tasks: IndexedTask[],
	pinnedCache: PinnedCache,
): IndexedTask[] {
	const manualRank = new Map(
		pinnedCache.getManualOrderIds().map((operonId, index) => [operonId, index]),
	);
	return tasks.slice().sort((a, b) => {
		const aRank = manualRank.get(a.operonId);
		const bRank = manualRank.get(b.operonId);
		if (aRank !== undefined && bRank !== undefined) return aRank - bRank;
		if (aRank !== undefined) return -1;
		if (bRank !== undefined) return 1;

		const aPinnedAt = pinnedCache.getEntry(a.operonId)?.updatedAt ?? '';
		const bPinnedAt = pinnedCache.getEntry(b.operonId)?.updatedAt ?? '';
		const byPinnedAt = aPinnedAt.localeCompare(bPinnedAt);
		if (byPinnedAt !== 0) return byPinnedAt;
		return comparePinnedTaskIds(a, b);
	});
}

function comparePinnedTasksByLastModified(a: IndexedTask, b: IndexedTask): number {
	const byLastModified = (b.datetimeModified ?? '').localeCompare(a.datetimeModified ?? '');
	return byLastModified !== 0 ? byLastModified : comparePinnedTaskIds(a, b);
}

function comparePinnedTaskIds(a: IndexedTask, b: IndexedTask): number {
	return a.operonId.localeCompare(b.operonId);
}
