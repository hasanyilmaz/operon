import type { OperonIndexer } from '../../indexer/indexer';
import type { IndexedTask } from '../../types/fields';
import { resolveWorkflowStatus } from '../../types/pipeline';
import type { OperonSettings } from '../../types/settings';

type TableValueSettings = Pick<OperonSettings, 'pipelines'>;

export interface TableTaskLookup {
	getTask(operonId: string): IndexedTask | null | undefined;
}

export function createTableTaskLookup(tasks: readonly IndexedTask[]): TableTaskLookup {
	const byId = new Map(tasks.map(task => [task.operonId, task] as const));
	return {
		getTask: (operonId: string) => byId.get(operonId) ?? null,
	};
}

export function createIndexerTableTaskLookup(indexer: Pick<OperonIndexer, 'getTask'>): TableTaskLookup {
	return {
		getTask: (operonId: string) => indexer.getTask(operonId),
	};
}

export function getTableTaskRawValue(task: IndexedTask, key: string): string {
	if (key === 'taskType') return getTableTaskTypeValue(task);
	if (key === 'description') return task.description;
	if (key === 'checkbox') return task.checkbox;
	if (key === 'tags') return (task.tags ?? []).join('; ');
	if (key === 'source') return formatTableTaskSource(task);
	if (key === 'sourcePath') return task.primary.filePath;
	if (key === 'sourceLine') return String(task.primary.lineNumber + 1);
	if (key === 'sourceFormat') return task.primary.format;
	if (key === 'file.path') return task.primary.filePath;
	if (key === 'file.name') return getFileName(task.primary.filePath);
	if (key === 'file.basename') return getFileName(task.primary.filePath).replace(/\.[^.]+$/u, '');
	if (key === 'file.folder') return getFolderPath(task.primary.filePath);
	if (key === 'operonId') return task.operonId;
	return task.fieldValues[key] ?? '';
}

export function isTableTerminalTask(task: IndexedTask, settings: TableValueSettings): boolean {
	const workflow = resolveWorkflowStatus(settings.pipelines, task.fieldValues['status']);
	if (workflow) {
		return workflow.definition.isFinished === true || workflow.definition.isCancelled === true;
	}
	return task.checkbox === 'done' || task.checkbox === 'cancelled';
}

export function compareTableSourceOrder(left: IndexedTask, right: IndexedTask): number {
	const pathResult = left.primary.filePath.localeCompare(right.primary.filePath);
	if (pathResult !== 0) return pathResult;
	const lineResult = left.primary.lineNumber - right.primary.lineNumber;
	if (lineResult !== 0) return lineResult;
	return left.operonId.localeCompare(right.operonId);
}

export function formatTableTaskSource(task: IndexedTask): string {
	const line = task.primary.format === 'inline' ? `:${task.primary.lineNumber + 1}` : '';
	return `${task.primary.filePath}${line}`;
}

export function formatCompactTableTaskSource(task: IndexedTask): string {
	const fileName = getFileName(task.primary.filePath);
	const line = task.primary.format === 'inline' ? `:${task.primary.lineNumber + 1}` : '';
	return `${fileName}${line}`;
}

export function getTableTaskTypeValue(task: IndexedTask): 'inline' | 'file' {
	return task.primary.format === 'inline' ? 'inline' : 'file';
}

function getFileName(filePath: string): string {
	return filePath.split('/').pop() ?? filePath;
}

function getFolderPath(filePath: string): string {
	const slashIndex = filePath.lastIndexOf('/');
	return slashIndex === -1 ? '' : filePath.slice(0, slashIndex);
}
