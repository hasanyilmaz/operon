import type { OperonIndexer } from '../indexer/indexer';
import type { IndexedTask } from '../types/fields';
import type { OperonSettings } from '../types/settings';
import { canonicalizeLocalDatetime, parseLocalTimestamp, toLocalDate, toLocalDatetime } from './local-time';
import { shouldAutoUnpinTerminalTask } from './pinned-task-rules';
import { buildPriorityRankMap, normalizePriorityValue } from './priority-rank';
import { buildWorkflowStatusIdentityIndex } from './workflow-status-identity';

export type UpcomingTaskSource = 'scheduled' | 'due';
export interface UpcomingTaskEntry {
	operonId: string;
	task: IndexedTask;
	sources: UpcomingTaskSource[];
	date: string;
	allDay: boolean;
	/** Local scheduled start, absent for all-day entries. */
	timestamp: number | null;
}
export interface UpcomingTaskGroup {
	kind: 'timed' | 'all-day';
	entries: UpcomingTaskEntry[];
}
export interface UpcomingTaskDay {
	date: string;
	groups: UpcomingTaskGroup[];
}
export type UpcomingTaskQuerySettings = Pick<OperonSettings,
	'upcomingDays' | 'upcomingShowAllDayTasks' | 'upcomingDailyGroupOrder' | 'pipelines' | 'priorities'>;

/** Reads the current index only; it neither writes tasks nor expands recurrence. */
export function getUpcomingTasksForDisplay(
	indexer: Pick<OperonIndexer, 'getAllTasks'>,
	settings: UpcomingTaskQuerySettings,
	now: Date = new Date(),
): UpcomingTaskDay[] {
	return queryUpcomingTasks(indexer.getAllTasks(), settings, now);
}

export function queryUpcomingTasks(
	tasks: readonly IndexedTask[],
	settings: UpcomingTaskQuerySettings,
	now: Date,
): UpcomingTaskDay[] {
	if (!Number.isFinite(now.getTime())) return [];
	const today = toLocalDate(now);
	const end = new Date(now);
	const days = Number.isInteger(settings.upcomingDays) && settings.upcomingDays >= 1 && settings.upcomingDays <= 7
		? settings.upcomingDays : 3;
	// Calendar arithmetic, not elapsed 24-hour blocks, preserves DST boundaries.
	end.setDate(end.getDate() + days);
	const endDate = toLocalDate(end);
	const byDay = new Map<string, UpcomingTaskEntry[]>();
	const workflowIndex = buildWorkflowStatusIdentityIndex(settings.pipelines);
	const priorityRanks = buildPriorityRankMap(settings.priorities);
	const rank = (entry: UpcomingTaskEntry): number => priorityRanks.get(
		normalizePriorityValue(entry.task.fieldValues['priority'] ?? ''),
	) ?? settings.priorities.length;
	const compare = (a: UpcomingTaskEntry, b: UpcomingTaskEntry): number =>
		(a.timestamp ?? 0) - (b.timestamp ?? 0) || rank(a) - rank(b)
		|| (a.operonId < b.operonId ? -1 : a.operonId > b.operonId ? 1 : 0);

	for (const task of tasks) {
		if (shouldAutoUnpinTerminalTask(task, settings.pipelines, workflowIndex)) continue;
		const fields = task.fieldValues;
		const start = validUpcomingTimestamp(fields['datetimeStart'] ?? '', true);
		const scheduled = start ?? validUpcomingTimestamp(fields['dateScheduled'] ?? '', false);
		const due = validUpcomingTimestamp(fields['dateDue'] ?? '', false);
		const entries: UpcomingTaskEntry[] = [];
		if (scheduled !== null) entries.push({
			operonId: task.operonId, task, sources: ['scheduled'],
			date: toLocalDate(new Date(scheduled)), allDay: start === null, timestamp: start,
		});
		if (due !== null) {
			const date = toLocalDate(new Date(due));
			const shared = entries.find(entry => entry.allDay && entry.date === date);
			if (shared) shared.sources.push('due');
			else entries.push({ operonId: task.operonId, task, sources: ['due'], date, allDay: true, timestamp: null });
		}
		for (const entry of entries) {
			if (entry.date < today || entry.date >= endDate || (entry.allDay && !settings.upcomingShowAllDayTasks)) continue;
			const day = byDay.get(entry.date) ?? [];
			day.push(entry);
			byDay.set(entry.date, day);
		}
	}
	return [...byDay.keys()].sort().map(date => {
		const entries = byDay.get(date) ?? [];
		const kinds: UpcomingTaskGroup['kind'][] = settings.upcomingDailyGroupOrder === 'all-day-first'
			? ['all-day', 'timed'] : ['timed', 'all-day'];
		return { date, groups: kinds.map(kind => ({
			kind, entries: entries.filter(entry => entry.allDay === (kind === 'all-day')).sort(compare),
		})).filter(group => group.entries.length > 0) };
	});
}

/** Reject rollover dates and nonexistent local clock times instead of silently repairing notes. */
export function validUpcomingTimestamp(raw: string, timed: boolean): number | null {
	const value = raw.trim();
	const pattern = timed ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/u : /^\d{4}-\d{2}-\d{2}$/u;
	if (!pattern.test(value)) return null;
	const timestamp = parseLocalTimestamp(value);
	if (timestamp === null || !Number.isFinite(timestamp)) return null;
	const parsed = new Date(timestamp);
	const roundTrip = timed ? toLocalDatetime(parsed) : toLocalDate(parsed);
	return roundTrip === (timed ? canonicalizeLocalDatetime(value) : value) ? timestamp : null;
}
