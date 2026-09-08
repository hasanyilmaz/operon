import type { UpcomingTaskEntry } from './upcoming-task-query';

export function formatUpcomingCountdown(timestamp: number | null, now: number, seconds = false): string | null {
	if (timestamp === null || !Number.isFinite(timestamp) || !Number.isFinite(now)) return null;
	if (seconds) {
		const total = Math.max(0, Math.ceil((timestamp - now) / 1_000));
		if (total > 359_999) return null;
		return [Math.floor(total / 3_600), Math.floor(total / 60) % 60, total % 60].map(value => String(value).padStart(2, '0')).join(':');
	}
	const minutes = Math.max(0, Math.ceil((timestamp - now) / 60_000));
	if (minutes > 5_999) return null;
	return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Input order already carries the query's priority/id tie-breaks. */
export function findNextUpcomingEntry(entries: readonly UpcomingTaskEntry[], now: number): UpcomingTaskEntry | null {
	let next: UpcomingTaskEntry | null = null;
	for (const entry of entries) {
		if (entry.timestamp === null || entry.timestamp <= now) continue;
		if (next === null || entry.timestamp < (next.timestamp ?? Infinity)) next = entry;
	}
	return next;
}

export function upcomingEntryKey(entry: UpcomingTaskEntry): string {
	return `${entry.operonId}|${entry.date}|${entry.timestamp ?? 'all-day'}`;
}

/** One wake-up covers minute display changes, exact starts and local midnight. */
export function getUpcomingWakeDelay(entries: readonly UpcomingTaskEntry[], now: number, seconds = false): number {
	const midnight = new Date(now);
	midnight.setHours(24, 0, 0, 0);
	const interval = seconds ? 1_000 : 60_000;
	let delay = Math.min(interval - (now % interval), midnight.getTime() - now);
	for (const entry of entries) {
		if (entry.timestamp === null || entry.timestamp <= now) continue;
		const remaining = entry.timestamp - now;
		delay = Math.min(delay, remaining % interval || interval);
	}
	return Math.max(1, delay);
}
