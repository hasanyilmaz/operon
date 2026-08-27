import type { IndexedTask } from '../types/fields';
import { normalizeGanttDateKey } from '../systems/gantt-core';

export interface ParentTaskDateRangeBounds {
	earliestStarted: string;
	latestFinished: string;
}

export const EMPTY_PARENT_TASK_DATE_RANGE_BOUNDS: ParentTaskDateRangeBounds = Object.freeze({
	earliestStarted: '',
	latestFinished: '',
});

export function resolveTaskDateRangeBounds(task: IndexedTask): ParentTaskDateRangeBounds {
	if (task.checkbox === 'cancelled') return { ...EMPTY_PARENT_TASK_DATE_RANGE_BOUNDS };
	const dateStarted = normalizeGanttDateKey(task.fieldValues['dateStarted']);
	const dateDue = normalizeGanttDateKey(task.fieldValues['dateDue']);
	const dateCompleted = normalizeGanttDateKey(task.fieldValues['dateCompleted']);
	return {
		earliestStarted: dateStarted,
		latestFinished: maxDateKey(dateDue, dateCompleted),
	};
}

export function mergeParentTaskDateRangeBounds(
	left: ParentTaskDateRangeBounds,
	right: ParentTaskDateRangeBounds,
): ParentTaskDateRangeBounds {
	return {
		earliestStarted: minDateKey(left.earliestStarted, right.earliestStarted),
		latestFinished: maxDateKey(left.latestFinished, right.latestFinished),
	};
}

export function buildParentTaskDateRangeExpansionPatch(
	parentTask: IndexedTask,
	descendantBounds: ParentTaskDateRangeBounds,
	enabled: boolean,
): Record<string, string> {
	if (!enabled || parentTask.checkbox === 'cancelled') return {};

	const rawStart = (parentTask.fieldValues['dateStarted'] ?? '').trim();
	const rawDue = (parentTask.fieldValues['dateDue'] ?? '').trim();
	const currentStart = normalizeGanttDateKey(rawStart);
	const currentDue = normalizeGanttDateKey(rawDue);
	const startCanChange = rawStart === '' || currentStart !== '';
	const dueCanChange = rawDue === '' || currentDue !== '';
	const patch: Record<string, string> = {};

	if (
		startCanChange
		&& descendantBounds.earliestStarted
		&& (!currentStart || descendantBounds.earliestStarted < currentStart)
	) {
		patch['dateStarted'] = descendantBounds.earliestStarted;
	}
	if (
		dueCanChange
		&& descendantBounds.latestFinished
		&& (!currentDue || descendantBounds.latestFinished > currentDue)
	) {
		patch['dateDue'] = descendantBounds.latestFinished;
	}

	if (!wouldCreateInvertedRange(currentStart, currentDue, patch)) return patch;

	const withoutStart = { ...patch };
	delete withoutStart['dateStarted'];
	if (!wouldCreateInvertedRange(currentStart, currentDue, withoutStart)) return withoutStart;

	const withoutDue = { ...patch };
	delete withoutDue['dateDue'];
	if (!wouldCreateInvertedRange(currentStart, currentDue, withoutDue)) return withoutDue;

	return {};
}

function wouldCreateInvertedRange(
	currentStart: string,
	currentDue: string,
	patch: Readonly<Record<string, string>>,
): boolean {
	const nextStart = patch['dateStarted'] ?? currentStart;
	const nextDue = patch['dateDue'] ?? currentDue;
	return !!nextStart && !!nextDue && nextStart > nextDue;
}

function minDateKey(left: string, right: string): string {
	if (!left) return right;
	if (!right) return left;
	return left < right ? left : right;
}

function maxDateKey(left: string, right: string): string {
	if (!left) return right;
	if (!right) return left;
	return left > right ? left : right;
}
