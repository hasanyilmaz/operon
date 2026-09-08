import type { OperonSettings } from '../types/settings';
import type { IndexedTask } from '../types/fields';
import { queryUpcomingTasks, type UpcomingTaskEntry, type UpcomingTaskQuerySettings } from './upcoming-task-query';
import { findNextUpcomingEntry } from './upcoming-task-countdown';

/** Follow the nearest future task; optionally advance when the current countdown expires. */
export class UpcomingTaskSelection {
	private selected: UpcomingTaskEntry | null = null;

	update(tasks: readonly IndexedTask[], settings: UpcomingTaskQuerySettings & Partial<Pick<OperonSettings, 'upcomingStatusBarExpiryAction'>>, now: Date): {
		selected: UpcomingTaskEntry | null; next: UpcomingTaskEntry | null;
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
		if (!this.selected || this.selected.timestamp! > now.getTime() || (settings.upcomingStatusBarExpiryAction === 'next' && next)) this.selected = next;
		return { selected: this.selected, next };
	}
}
