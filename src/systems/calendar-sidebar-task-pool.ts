import { localToday } from '../core/local-time';
import { IndexedTask } from '../types/fields';
import type { CalendarSidebarTaskPoolMode } from '../types/calendar';

export const CALENDAR_SIDEBAR_TASK_POOL_INITIAL_LIMIT = 25;
export const CALENDAR_SIDEBAR_TASK_POOL_SEARCH_LIMIT = 50;
export const CALENDAR_SIDEBAR_TASK_POOL_SEARCH_DEBOUNCE_MS = 120;

export { buildTaskPoolSearchText as buildCalendarSidebarTaskPoolSearchText } from './task-pool-search';

function sortTasksByRecentModification(tasks: IndexedTask[]): IndexedTask[] {
	// Precompute the timestamp once per task instead of Date.parse inside the
	// comparator (which runs O(n log n) times and per keystroke while
	// searching the task pool).
	return tasks
		.map(task => ({
			task,
			modifiedTs: Date.parse(task.datetimeModified || task.fieldValues['datetimeModified'] || '') || 0,
		}))
		.sort((left, right) => {
			if (left.modifiedTs !== right.modifiedTs) return right.modifiedTs - left.modifiedTs;
			return left.task.operonId.localeCompare(right.task.operonId);
		})
		.map(entry => entry.task);
}

export function collectFinishedTasksForDate(
	tasks: IndexedTask[],
	date: string,
): IndexedTask[] {
	return sortTasksByRecentModification(
		tasks.filter(task => task.checkbox === 'done' && (task.fieldValues['dateCompleted'] ?? '').trim() === date),
	);
}

/**
 * Per-task pool membership predicate, shared by the pool collectors and the
 * status-click signature fast path (which uses it to skip collecting and
 * ranking every task when the clicked task cannot appear in the pool).
 */
export function isCalendarSidebarTaskPoolMember(
	task: IndexedTask,
	mode: CalendarSidebarTaskPoolMode,
	options: {
		finishedDate?: string;
	} = {},
): boolean {
	if (mode === 'finished') {
		return task.checkbox === 'done'
			&& (task.fieldValues['dateCompleted'] ?? '').trim() === (options.finishedDate ?? localToday());
	}
	if (task.checkbox !== 'open') return false;
	if (mode === 'all') return true;
	if (mode === 'overdue') {
		const today = localToday();
		const isValidDateKey = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value);
		const scheduled = (task.fieldValues['dateScheduled'] ?? '').trim();
		const due = (task.fieldValues['dateDue'] ?? '').trim();
		return (isValidDateKey(scheduled) && scheduled < today)
			|| (isValidDateKey(due) && due < today);
	}
	return !(task.fieldValues['dateScheduled'] ?? '').trim();
}

export function collectCalendarSidebarTaskPoolCandidates(
	tasks: IndexedTask[],
	mode: CalendarSidebarTaskPoolMode,
	options: {
		finishedDate?: string;
	} = {},
): IndexedTask[] {
	return sortTasksByRecentModification(
		tasks.filter(task => isCalendarSidebarTaskPoolMember(task, mode, options)),
	);
}
