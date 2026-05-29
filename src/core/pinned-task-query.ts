import type { OperonIndexer } from '../indexer/indexer';
import type { PinnedCache } from '../storage/pinned-cache';
import type { IndexedTask } from '../types/fields';
import type { PriorityDefinition } from '../types/priority';

export function getPinnedTasksForDisplay(
	indexer: OperonIndexer,
	pinnedCache: PinnedCache,
	priorities: PriorityDefinition[],
): IndexedTask[] {
	const priorityLabels = priorities.map(priority => priority.label);
	return indexer.getAllTasks()
		.filter(task => pinnedCache.isPinned(task.operonId))
		.sort((a, b) => {
			const ai = priorityLabels.indexOf(a.fieldValues['priority'] ?? '');
			const bi = priorityLabels.indexOf(b.fieldValues['priority'] ?? '');
			const pa = ai === -1 ? priorityLabels.length : ai;
			const pb = bi === -1 ? priorityLabels.length : bi;
			if (pa !== pb) return pa - pb;
			return (b.datetimeModified ?? '').localeCompare(a.datetimeModified ?? '');
		});
}
