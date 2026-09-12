import type { IndexedTask } from '../types/fields';

// Keyed by task object identity: the indexer replaces task objects whenever
// a file is reindexed, so cached search text can never go stale, and the
// WeakMap lets replaced objects be collected. Building the concatenated text
// per candidate per keystroke was the largest string cost of pool search.
const searchTextCache = new WeakMap<IndexedTask, string>();

export function buildTaskPoolSearchText(task: IndexedTask): string {
	const cached = searchTextCache.get(task);
	if (cached !== undefined) return cached;
	const text = [
		task.description,
		task.operonId,
		task.primary.filePath,
		task.tags.join(' '),
		task.fieldValues['status'] ?? '',
		task.fieldValues['contexts'] ?? '',
		task.fieldValues['related'] ?? '',
		task.fieldValues['note'] ?? '',
		task.fieldValues['dateScheduled'] ?? '',
		task.fieldValues['dateDue'] ?? '',
		task.fieldValues['datetimeStart'] ?? '',
	]
		.filter(Boolean)
		.join(' ');
	searchTextCache.set(task, text);
	return text;
}
