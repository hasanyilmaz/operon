import type { IndexedTask } from '../types/fields';

export const TASK_DATA_TYPE_FIELD_KEY = '__taskDataType';

export type TaskDataType = 'inline' | 'file';
export type TaskDataTypeFilterOperator = 'is' | 'isNot';

export const TASK_DATA_TYPE_FILTER_OPERATORS = [
	{ id: 'is', label: 'is' },
	{ id: 'isNot', label: 'is not' },
] as const satisfies readonly { id: TaskDataTypeFilterOperator; label: string }[];

export function resolveTaskDataType(task: Pick<IndexedTask, 'primary'>): TaskDataType {
	return task.primary.format === 'inline' ? 'inline' : 'file';
}

export function isTaskDataType(value: string | null | undefined): value is TaskDataType {
	return value === 'inline' || value === 'file';
}

export function evaluateTaskDataTypeCondition(
	task: Pick<IndexedTask, 'primary'>,
	operator: string,
	value: string | null | undefined,
): boolean {
	if (!isTaskDataType(value)) return false;
	const matches = resolveTaskDataType(task) === value;
	if (operator === 'is') return matches;
	if (operator === 'isNot') return !matches;
	return false;
}
