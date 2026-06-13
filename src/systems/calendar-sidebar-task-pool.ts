import { localToday } from '../core/local-time';
import { IndexedTask } from '../types/fields';
import type { CalendarSidebarTaskPoolMode } from '../types/calendar';

export const CALENDAR_SIDEBAR_TASK_POOL_INITIAL_LIMIT = 25;
export const CALENDAR_SIDEBAR_TASK_POOL_SEARCH_LIMIT = 50;

export function buildCalendarSidebarTaskPoolSearchText(task: IndexedTask): string {
	return [
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
}

export function collectFinishedTasksForDate(
	tasks: IndexedTask[],
	date: string,
): IndexedTask[] {
	return [...tasks]
		.filter(task => task.checkbox === 'done' && (task.fieldValues['dateCompleted'] ?? '').trim() === date)
		.sort((left, right) => {
			const leftModified = Date.parse(left.datetimeModified || left.fieldValues['datetimeModified'] || '') || 0;
			const rightModified = Date.parse(right.datetimeModified || right.fieldValues['datetimeModified'] || '') || 0;
			if (leftModified !== rightModified) return rightModified - leftModified;
			return left.operonId.localeCompare(right.operonId);
		});
}

export function collectCalendarSidebarTaskPoolCandidates(
	tasks: IndexedTask[],
	mode: CalendarSidebarTaskPoolMode,
	options: {
		finishedDate?: string;
	} = {},
): IndexedTask[] {
	if (mode === 'finished') {
		return collectFinishedTasksForDate(tasks, options.finishedDate ?? localToday());
	}

	const today = localToday();
	const isValidDateKey = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value);
	const isOverdue = (task: IndexedTask): boolean => {
		const scheduled = (task.fieldValues['dateScheduled'] ?? '').trim();
		const due = (task.fieldValues['dateDue'] ?? '').trim();
		return (isValidDateKey(scheduled) && scheduled < today)
			|| (isValidDateKey(due) && due < today);
	};
	return [...tasks]
		.filter(task => task.checkbox === 'open')
		.filter(task => {
			if (mode === 'all') return true;
			if (mode === 'overdue') return isOverdue(task);
			return !(task.fieldValues['dateScheduled'] ?? '').trim();
		})
		.sort((left, right) => {
			const leftModified = Date.parse(left.datetimeModified || left.fieldValues['datetimeModified'] || '') || 0;
			const rightModified = Date.parse(right.datetimeModified || right.fieldValues['datetimeModified'] || '') || 0;
			if (leftModified !== rightModified) return rightModified - leftModified;
			return left.operonId.localeCompare(right.operonId);
		});
}
