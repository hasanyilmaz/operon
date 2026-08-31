import type { IndexedTask, PlainCheckboxProgress } from '../types/fields';

export const PLAIN_CHECKBOXES_FILTER_FIELD_KEY = '__plainCheckboxes';

export type PlainCheckboxesFilterOperator = 'hasOpen' | 'allClosed' | 'exists';

export const PLAIN_CHECKBOXES_FILTER_OPERATORS = [
	{ id: 'hasOpen', label: 'has open' },
	{ id: 'allClosed', label: 'are all closed' },
	{ id: 'exists', label: 'exist' },
] as const satisfies readonly { id: PlainCheckboxesFilterOperator; label: string }[];

export function evaluatePlainCheckboxesCondition(
	task: Pick<IndexedTask, 'plainCheckboxProgress'>,
	operator: string,
): boolean {
	const progress = task.plainCheckboxProgress;
	if (!isCoherentPlainCheckboxProgress(progress)) return false;
	if (operator === 'hasOpen') return progress.completed < progress.total;
	if (operator === 'allClosed') return progress.completed === progress.total;
	if (operator === 'exists') return true;
	return false;
}

function isCoherentPlainCheckboxProgress(
	progress: PlainCheckboxProgress | null | undefined,
): progress is PlainCheckboxProgress {
	return !!progress
		&& Number.isInteger(progress.total)
		&& progress.total > 0
		&& Number.isInteger(progress.completed)
		&& progress.completed >= 0
		&& progress.completed <= progress.total;
}
