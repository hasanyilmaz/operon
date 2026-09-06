import { isValidOperonId } from '../core/id-generator';
import type { IndexedTaskSnapshot } from '../indexer/indexer';
import { readTaskCardPlacement, type TaskCardLayoutOptions, type TaskCardPlacementError } from './task-card-layout-model';

export interface TaskCardEmbedOptions extends TaskCardLayoutOptions { taskId: string }
export type TaskCardParseError = TaskCardPlacementError | 'syntax' | 'duplicateOption' | 'mixed' | 'view' | 'taskId';
export type TaskCardParseResult = { options: TaskCardEmbedOptions } | { error: TaskCardParseError };

/** Leave legacy filter syntax entirely with its existing processor. */
export function isTaskCardEmbedSource(source: string): boolean {
	return /^\s*(?:view|taskId)\s*:/im.test(source);
}

export function parseTaskCardEmbed(source: string, defaults?: TaskCardLayoutOptions): TaskCardParseResult {
	const values = new Map<string, string>();
	for (const line of source.split('\n')) {
		if (!line.trim()) continue;
		const match = /^\s*([a-zA-Z]+)\s*:\s*(.*?)\s*$/.exec(line);
		if (!match) return { error: 'syntax' };
		const [, rawKey, rawValue] = match;
		const key = rawKey.toLowerCase();
		if (key === 'filter' || key === 'filterid') return { error: 'mixed' };
		if (!['view', 'taskid', 'width', 'align', 'wrap'].includes(key)) return { error: 'syntax' };
		if (values.has(key)) return { error: 'duplicateOption' };
		const value = /^(?:"([^"\n]*)"|'([^'\n]*)')$/.exec(rawValue);
		values.set(key, value ? (value[1] ?? value[2]) : rawValue);
	}
	if (values.get('view') !== 'card') return { error: 'view' };
	const taskId = values.get('taskid') ?? '';
	if (!isValidOperonId(taskId)) return { error: 'taskId' };
	const placement = readTaskCardPlacement(values, defaults);
	return typeof placement === 'string' ? { error: placement } : { options: { ...placement, taskId } };
}

export type TaskCardIndexState = 'loading' | 'ready' | 'error';
export interface TaskCardReader {
	getIndexState: () => TaskCardIndexState;
	getTask: (id: string) => IndexedTaskSnapshot | undefined;
	hasDuplicate: (id: string) => boolean;
}
export type TaskCardResolution = { state: 'ready'; task: IndexedTaskSnapshot }
	| { state: 'loading' | 'missing' | 'duplicate' | 'error' };

/** Only the requested ID is read; rendering has no task-writing capability. */
export function resolveTaskCard(reader: TaskCardReader, id: string): TaskCardResolution {
	try {
		const state = reader.getIndexState();
		if (state !== 'ready') return { state };
		if (reader.hasDuplicate(id)) return { state: 'duplicate' };
		const task = reader.getTask(id);
		return task ? { state: 'ready', task } : { state: 'missing' };
	} catch { return { state: 'error' }; }
}
