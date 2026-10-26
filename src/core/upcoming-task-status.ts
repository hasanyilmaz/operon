import type { OperonIndexer } from '../indexer/indexer';
import type { OperonSettings } from '../types/settings';
import type { IndexedTask } from '../types/fields';
import { UpcomingTaskSelection } from './upcoming-task-selection';
import { formatUpcomingCountdown, getUpcomingWakeDelay } from './upcoming-task-countdown';
import { formatDurationHuman } from '../systems/tracker-utils';

export interface UpcomingTaskStatusSnapshot {
	task: IndexedTask | null;
	countdown: string | null;
	due: boolean;
	current?: boolean;
	/** All active desktop calendar blocks, ordered by start then ID. */
	ongoing?: readonly IndexedTask[];
	/** Desktop dock only: the nearest future task after the current-task group. */
	next?: { task: IndexedTask; countdown: string | null } | null;
}

/** Same countdown limits and rounding as the native status item, with human units. */
export function humanizeUpcomingCountdown(value: string | null, seconds: boolean): string | null {
	if (value === null) return null;
	const parts = value.split(':').map(Number);
	return formatDurationHuman(parts[0] * 3600 + parts[1] * 60 + (parts[2] ?? 0), seconds ? 'seconds' : 'minutes');
}

/** One selection cache and wake-up shared by every desktop window. */
export class UpcomingTaskStatusModel {
	private readonly selection = new UpcomingTaskSelection();
	private cached: ReturnType<UpcomingTaskSelection['update']> | null = null;
	private cacheKey = '';
	private cancelWake: (() => void) | null = null;
	private readonly listeners = new Set<() => void>();
	private snapshot: UpcomingTaskStatusSnapshot = { task: null, countdown: null, due: false };
	private disposed = false;
	private actionPending = false;

	constructor(
		private readonly indexer: Pick<OperonIndexer, 'getAllTasks'> & Partial<Pick<OperonIndexer, 'getGeneration'>>,
		private readonly getSettings: () => OperonSettings,
		private readonly onTaskClick: (taskId: string, action: OperonSettings['upcomingStatusBarClickAction']) => void | Promise<void>,
		private readonly schedule: (callback: () => void, delay: number) => () => void,
		private readonly clock: () => Date = () => new Date(),
		private readonly retainAndShowNext = false,
	) {}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => { this.listeners.delete(listener); };
	}

	getSnapshot(): UpcomingTaskStatusSnapshot { return { ...this.snapshot, ...(this.snapshot.ongoing ? { ongoing: [...this.snapshot.ongoing] } : {}) }; }

	refresh(): void {
		if (this.disposed) return;
		this.cancelWake?.();
		this.cancelWake = null;
		const configured = this.getSettings();
		const settings = this.retainAndShowNext ? { ...configured, upcomingStatusBarExpiryAction: 'keep' as const } : configured;
		if (!settings.upcomingShowStatusBar) {
			this.snapshot = { task: null, countdown: null, due: false };
			this.emit();
			return;
		}
		const now = this.clock();
		const generation = this.indexer.getGeneration?.();
		const key = JSON.stringify([generation, Math.floor(now.getTime() / 60_000), settings.upcomingStatusBarExpiryAction,
			settings.upcomingDays, settings.upcomingShowAllDayTasks, settings.upcomingDailyGroupOrder, settings.pipelines, settings.priorities]);
		const expiredWithNext = (this.retainAndShowNext || settings.upcomingStatusBarExpiryAction === 'next')
			&& (this.cached?.next?.timestamp ?? Infinity) <= now.getTime();
		if (generation === undefined || !this.cached || key !== this.cacheKey || expiredWithNext || (this.cached.ongoingUntil ?? Infinity) <= now.getTime()) {
			this.cached = this.selection.update(this.indexer.getAllTasks(), settings, now, this.retainAndShowNext);
			this.cacheKey = key;
		}
		const { selected, next } = this.cached;
		const seconds = settings.upcomingCountdownDisplay === 'seconds';
		const countdown = selected ? formatUpcomingCountdown(selected.timestamp, now.getTime(), seconds) : null;
		const due = countdown === '00:00' || countdown === '00:00:00';
		this.snapshot = { task: selected?.task ?? null, countdown, due,
			...(this.retainAndShowNext ? { current: !!selected && selected.timestamp! <= now.getTime(), ongoing: this.cached.ongoing?.map(entry => entry.task) ?? [], next: due && next && next.operonId !== selected?.operonId
				? { task: next.task, countdown: formatUpcomingCountdown(next.timestamp, now.getTime(), seconds) } : null } : {}),
		};
		this.cancelWake = this.schedule(() => { this.cancelWake = null; this.refresh(); },
			getUpcomingWakeDelay([...(selected ? [selected] : []), ...(next ? [next] : []),
				...(selected && this.cached.ongoingUntil ? [{ ...selected, timestamp: this.cached.ongoingUntil }] : [])], now.getTime(), seconds));
		this.emit();
	}

	async openSelected(): Promise<void> {
		if (this.disposed || this.actionPending || !this.snapshot.task) return;
		const taskId = this.snapshot.task.operonId;
		this.actionPending = true;
		try { await this.onTaskClick(taskId, this.getSettings().upcomingStatusBarClickAction); }
		finally { this.actionPending = false; }
	}

	destroy(): void {
		this.disposed = true;
		this.cancelWake?.();
		this.cancelWake = null;
		this.listeners.clear();
	}

	private emit(): void { for (const listener of this.listeners) listener(); }
}
