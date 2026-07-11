import type { OperonIndexer } from '../indexer/indexer';
import type { PinnedCache } from '../storage/pinned-cache';
import type { IndexedTask } from '../types/fields';
import type { PriorityDefinition } from '../types/priority';
import { buildPriorityRankMap, normalizePriorityValue } from './priority-rank';

export function getPinnedTasksForDisplay(
	indexer: OperonIndexer,
	pinnedCache: PinnedCache,
	priorities: PriorityDefinition[],
): IndexedTask[] {
	const pinnedTasks = indexer.getAllTasks().filter(task => pinnedCache.isPinned(task.operonId));
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
		return (b.datetimeModified ?? '').localeCompare(a.datetimeModified ?? '');
	});
}
