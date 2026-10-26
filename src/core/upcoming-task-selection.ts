import type { OperonSettings } from '../types/settings';
import type { IndexedTask } from '../types/fields';
import { queryUpcomingTasks, validUpcomingTimestamp, type UpcomingTaskEntry, type UpcomingTaskQuerySettings } from './upcoming-task-query';
import { deriveDatetimeEnd, parseEstimateSeconds } from './scheduling-rules';
import { findNextUpcomingEntry } from './upcoming-task-countdown';

/** Select future tasks, or ordered desktop ongoing blocks with a retained fallback. */
export class UpcomingTaskSelection {
	private selected: UpcomingTaskEntry | null = null;

	update(tasks: readonly IndexedTask[], settings: UpcomingTaskQuerySettings & Partial<Pick<OperonSettings, 'upcomingStatusBarExpiryAction'>>, now: Date, preferOngoing = false): {
		selected: UpcomingTaskEntry | null; next: UpcomingTaskEntry | null; ongoingUntil?: number | null; ongoing?: UpcomingTaskEntry[];
	} {
		const entries = queryUpcomingTasks(tasks, settings, now).flatMap(day => day.groups.flatMap(group => group.entries));
		const next = findNextUpcomingEntry(entries, now.getTime());
		if (this.selected) {
			const previous = this.selected;
			const task = tasks.find(candidate => candidate.operonId === previous.operonId);
			const valid = task ? queryUpcomingTasks([task], { ...settings, upcomingDays: 1 }, new Date(previous.timestamp!))
				.flatMap(day => day.groups.flatMap(group => group.entries))
				.find(entry => entry.timestamp === previous.timestamp && !entry.allDay) : undefined;
			this.selected = valid ?? null;
		}
		const ongoingById = new Map<string, { entry: UpcomingTaskEntry; end: number }>();
		if (preferOngoing) for (const task of tasks) {
			const start = validUpcomingTimestamp(task.fieldValues.datetimeStart ?? '', true);
			if (start === null || start > now.getTime()) continue;
			const explicitEnd = task.fieldValues.datetimeEnd?.trim();
			const estimate = parseEstimateSeconds(task.fieldValues.estimate);
			const end = validUpcomingTimestamp(explicitEnd || (estimate !== null ? deriveDatetimeEnd(task.fieldValues.datetimeStart, estimate) : ''), true);
			if (end === null || end <= now.getTime()) continue;
			// Reuse the query's terminal/workflow rules, including cross-midnight blocks.
			const entry = queryUpcomingTasks([task], settings, new Date(start)).flatMap(day => day.groups.flatMap(group => group.entries))
				.find(candidate => candidate.timestamp === start && !candidate.allDay);
			if (!entry) continue;
			ongoingById.set(entry.operonId, { entry, end });
		}
		const ongoing = [...ongoingById.values()].sort((a, b) => a.entry.timestamp! - b.entry.timestamp!
			|| (a.entry.operonId < b.entry.operonId ? -1 : a.entry.operonId > b.entry.operonId ? 1 : 0));
		if (ongoing.length) this.selected = ongoing[0].entry;
		else if (!this.selected || this.selected.timestamp! > now.getTime() || (settings.upcomingStatusBarExpiryAction === 'next' && next)) this.selected = next;
		return { selected: this.selected, next, ...(preferOngoing ? { ongoing: ongoing.map(item => item.entry), ongoingUntil: ongoing.length ? Math.min(...ongoing.map(item => item.end)) : null } : {}) };
	}
}
