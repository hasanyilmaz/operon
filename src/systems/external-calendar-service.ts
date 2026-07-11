import { localNow, localToday } from '../core/local-time';
import {
	ExternalCalendarCacheStore,
	ExternalCalendarCachedEvent,
	ExternalCalendarSourceCache,
} from '../storage/external-calendar-cache';
import { ExternalCalendarSource } from '../types/settings';
import {
	fetchExternalCalendarIcs,
	parseExternalCalendarIcsEvents,
} from './external-calendar-ics';
import {
	isExternalCalendarCoverageExpanding,
	resolveExternalCalendarRequestedRange,
	shouldPersistExternalCalendarCacheUpdate,
	shouldRunExternalCalendarCoverageCheck,
	shouldSyncExternalCalendarSource,
} from './external-calendar-sync-policy';

const SYNC_RANGE_PAST_DAYS = 30;
const SYNC_RANGE_FUTURE_DAYS = 180;

export class ExternalCalendarService {
	private readonly cacheStore: ExternalCalendarCacheStore;
	private readonly onChange: () => void;
	private sources = new Map<string, ExternalCalendarSource>();
	private caches = new Map<string, ExternalCalendarSourceCache>();
	private syncPromises = new Map<string, Promise<void>>();
	private timers = new Map<string, number>();
	private requestedRangeStart = shiftDateKey(localToday(), -SYNC_RANGE_PAST_DAYS);
	private requestedRangeEnd = shiftDateKey(localToday(), SYNC_RANGE_FUTURE_DAYS);
	private lastCoverageCheckKey: string | null = null;
	private lastCoverageCheckAt = 0;
	private destroyed = false;

	constructor(
		cacheStore: ExternalCalendarCacheStore,
		onChange: () => void,
	) {
		this.cacheStore = cacheStore;
		this.onChange = onChange;
		for (const source of cacheStore.getAllSources()) {
			this.caches.set(source.sourceId, source);
		}
	}

	async applySettings(sources: ExternalCalendarSource[]): Promise<void> {
		if (this.destroyed) return;
		this.sources = new Map(sources.map(source => [source.id, { ...source }]));
		await this.cacheStore.removeSourcesExcept(this.sources.keys());
		if (this.destroyed) return;
		const retained = new Map<string, ExternalCalendarSourceCache>();
		for (const [sourceId, cache] of this.caches.entries()) {
			if (this.sources.has(sourceId)) {
				retained.set(sourceId, cache);
			}
		}
		this.caches = retained;
		for (const sourceId of Array.from(this.timers.keys())) {
			const source = this.sources.get(sourceId);
			if (!source || !this.isAutoSyncableSource(source)) {
				this.clearTimer(sourceId);
			}
		}
		for (const source of sources) {
			if (!this.isAutoSyncableSource(source)) continue;
			this.scheduleTimer(source.id);
			if (this.shouldSyncSource(source.id, this.requestedRangeStart, this.requestedRangeEnd)) {
				void this.syncSource(source.id, this.requestedRangeStart, this.requestedRangeEnd);
			}
		}
	}

	/**
	 * Returns the shared cached event objects without cloning; callers treat
	 * them as read-only (they are wrapped into fresh CalendarItems downstream
	 * and replaced wholesale on the next sync). This runs on every calendar
	 * render, so per-event clones were pure allocation churn.
	 */
	getCachedEvents(rangeStart: string, rangeEnd: string): ExternalCalendarCachedEvent[] {
		if (this.destroyed) return [];
		this.ensureCoverage(rangeStart, rangeEnd);
		const events: ExternalCalendarCachedEvent[] = [];
		for (const source of this.sources.values()) {
			if (!this.isAutoSyncableSource(source)) continue;
			const cache = this.caches.get(source.id);
			if (!cache) continue;
			for (const event of cache.events) {
				if (event.startDate <= rangeEnd && event.endDate >= rangeStart) {
					events.push(event);
				}
			}
		}
		return events;
	}

	getSourceCache(sourceId: string): ExternalCalendarSourceCache | null {
		const found = this.caches.get(sourceId);
		return found
			? {
				...found,
				events: found.events.map(event => ({ ...event })),
			}
			: null;
	}

	async syncNow(sourceId: string): Promise<'synced' | 'skipped' | 'failed'> {
		if (this.destroyed) return 'skipped';
		const source = this.sources.get(sourceId);
		if (!source || !this.isAutoSyncableSource(source)) return 'skipped';
		await this.syncSource(sourceId, this.requestedRangeStart, this.requestedRangeEnd);
		if (!this.destroyed && this.isAutoSyncableSource(source)) {
			this.scheduleTimer(sourceId);
		}
		if (this.destroyed) return 'skipped';
		return this.caches.get(sourceId)?.lastError ? 'failed' : 'synced';
	}

	async syncAllNow(): Promise<{ synced: number; skipped: number; failed: number }> {
		const results = await Promise.all(
			Array.from(this.sources.keys(), sourceId => this.syncNow(sourceId)),
		);
		return results.reduce(
			(summary, result) => {
				summary[result] += 1;
				return summary;
			},
			{ synced: 0, skipped: 0, failed: 0 },
		);
	}

	async destroy(): Promise<void> {
		this.destroyed = true;
		for (const sourceId of Array.from(this.timers.keys())) {
			this.clearTimer(sourceId);
		}
		const pendingSyncs = Array.from(this.syncPromises.values());
		await Promise.allSettled(pendingSyncs);
		this.syncPromises.clear();
	}

	private ensureCoverage(rangeStart: string, rangeEnd: string): void {
		if (this.destroyed) return;
		const requestedKey = `${rangeStart}|${rangeEnd}`;
		if (!shouldRunExternalCalendarCoverageCheck({
			requestedKey,
			lastCheckedKey: this.lastCoverageCheckKey,
			lastCheckedAtMs: this.lastCoverageCheckAt,
			nowMs: Date.now(),
		})) {
			return;
		}
		this.lastCoverageCheckKey = requestedKey;
		this.lastCoverageCheckAt = Date.now();
		const nextRange = resolveExternalCalendarRequestedRange({
			currentStart: this.requestedRangeStart,
			currentEnd: this.requestedRangeEnd,
			neededStart: shiftDateKey(rangeStart, -SYNC_RANGE_PAST_DAYS),
			neededEnd: shiftDateKey(rangeEnd, SYNC_RANGE_FUTURE_DAYS),
		});
		this.requestedRangeStart = nextRange.start;
		this.requestedRangeEnd = nextRange.end;
		for (const source of this.sources.values()) {
			if (!this.isAutoSyncableSource(source)) continue;
			if (!this.shouldSyncSource(source.id, this.requestedRangeStart, this.requestedRangeEnd)) continue;
			void this.syncSource(source.id, this.requestedRangeStart, this.requestedRangeEnd);
		}
	}

	private shouldSyncSource(sourceId: string, rangeStart: string, rangeEnd: string): boolean {
		if (this.destroyed) return false;
		if (this.syncPromises.has(sourceId)) return false;
		const source = this.sources.get(sourceId);
		if (!source || !this.isAutoSyncableSource(source)) return false;
		return shouldSyncExternalCalendarSource({
			cache: this.caches.get(sourceId) ?? null,
			refreshIntervalHours: source.refreshIntervalHours,
			rangeStart,
			rangeEnd,
			nowMs: Date.now(),
		});
	}

	private scheduleTimer(sourceId: string): void {
		if (this.destroyed) return;
		this.clearTimer(sourceId);
		const source = this.sources.get(sourceId);
		if (!source || !this.isAutoSyncableSource(source)) return;
		const delayMs = Math.max(1, Math.min(2147483647, Math.round(source.refreshIntervalHours * 3600000)));
		const timer = window.setTimeout(() => {
			this.timers.delete(sourceId);
			if (this.destroyed) return;
			void this.syncSource(sourceId, this.requestedRangeStart, this.requestedRangeEnd)
				.finally(() => {
					if (!this.destroyed) {
						this.scheduleTimer(sourceId);
					}
				});
		}, delayMs);
		this.timers.set(sourceId, timer);
	}

	private clearTimer(sourceId: string): void {
		const timer = this.timers.get(sourceId);
		if (typeof timer === 'number') {
			window.clearTimeout(timer);
		}
		this.timers.delete(sourceId);
	}

	private syncSource(
		sourceId: string,
		rangeStart: string,
		rangeEnd: string,
	): Promise<void> {
		if (this.destroyed) return Promise.resolve();
		const existing = this.syncPromises.get(sourceId);
		if (existing) return existing;
		const run = this.syncSourceInternal(sourceId, rangeStart, rangeEnd)
			.finally(() => {
				if (this.syncPromises.get(sourceId) === run) {
					this.syncPromises.delete(sourceId);
				}
			});
		this.syncPromises.set(sourceId, run);
		return run;
	}

	private async syncSourceInternal(
		sourceId: string,
		rangeStart: string,
		rangeEnd: string,
	): Promise<void> {
		if (this.destroyed) return;
		const source = this.sources.get(sourceId);
		if (!source) return;
		if (!this.isAutoSyncableSource(source)) return;
		const cache = this.caches.get(sourceId) ?? {
			sourceId,
			syncedAt: null,
			lastAttemptAt: null,
			etag: null,
			lastModified: null,
			coveredRangeStart: null,
			coveredRangeEnd: null,
			lastError: null,
			events: [],
		};
		const attemptAt = localNow();
		try {
			// A 304 keeps the previously parsed events, which only cover the old
			// range; validators are safe only while the requested range stays
			// inside the covered range.
			const canUseCacheValidators = !isExternalCalendarCoverageExpanding(cache, rangeStart, rangeEnd);
			const response = await fetchExternalCalendarIcs(source.url, canUseCacheValidators ? cache : null);
			if (response.status === 'notModified') {
				// The feed body is unchanged, so previously covered coverage is
				// still valid; keep the union with the requested range.
				const nextCache: ExternalCalendarSourceCache = {
					...cache,
					lastAttemptAt: attemptAt,
					syncedAt: attemptAt,
					etag: response.etag ?? cache.etag,
					lastModified: response.lastModified ?? cache.lastModified,
					coveredRangeStart: cache.coveredRangeStart && cache.coveredRangeStart < rangeStart
						? cache.coveredRangeStart
						: rangeStart,
					coveredRangeEnd: cache.coveredRangeEnd && cache.coveredRangeEnd > rangeEnd
						? cache.coveredRangeEnd
						: rangeEnd,
					lastError: null,
				};
				await this.commitSourceCache(sourceId, cache, nextCache);
				return;
			}
			const events = parseExternalCalendarIcsEvents({
				sourceId,
				url: source.url,
				body: response.body ?? '',
				rangeStart,
				rangeEnd,
			});
			const nextCache: ExternalCalendarSourceCache = {
				sourceId,
				syncedAt: attemptAt,
				lastAttemptAt: attemptAt,
				etag: response.etag,
				lastModified: response.lastModified,
				coveredRangeStart: rangeStart,
				coveredRangeEnd: rangeEnd,
				lastError: null,
				events,
			};
			await this.commitSourceCache(sourceId, cache, nextCache);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const nextCache: ExternalCalendarSourceCache = {
				...cache,
				lastAttemptAt: attemptAt,
				lastError: message,
			};
			await this.commitSourceCache(sourceId, cache, nextCache);
		}
	}

	private async commitSourceCache(
		sourceId: string,
		previousCache: ExternalCalendarSourceCache,
		nextCache: ExternalCalendarSourceCache,
	): Promise<void> {
		if (this.destroyed) return;
		const renderedEventsChanged = !areExternalCalendarEventListsEqual(previousCache.events, nextCache.events);
		this.caches.set(sourceId, nextCache);
		// Bookkeeping-only updates (syncedAt / lastAttemptAt) live in memory;
		// rewriting the whole multi-source cache file for them cost a disk
		// write per refresh interval and per failed attempt.
		if (shouldPersistExternalCalendarCacheUpdate(previousCache, nextCache, renderedEventsChanged)) {
			await this.cacheStore.upsertSource(nextCache);
			if (this.destroyed) return;
		}
		if (renderedEventsChanged) this.onChange();
	}

	private isAutoSyncableSource(source: ExternalCalendarSource): boolean {
		return source.enabled && source.url.trim().length > 0;
	}
}

function areExternalCalendarEventListsEqual(
	left: ExternalCalendarCachedEvent[],
	right: ExternalCalendarCachedEvent[],
): boolean {
	if (left.length !== right.length) return false;
	for (let index = 0; index < left.length; index++) {
		if (!areExternalCalendarEventsEqual(left[index], right[index])) return false;
	}
	return true;
}

function areExternalCalendarEventsEqual(
	left: ExternalCalendarCachedEvent,
	right: ExternalCalendarCachedEvent,
): boolean {
	return left.id === right.id
		&& left.sourceId === right.sourceId
		&& left.uid === right.uid
		&& left.recurrenceId === right.recurrenceId
		&& left.title === right.title
		&& left.isAllDay === right.isAllDay
		&& left.startDate === right.startDate
		&& left.endDate === right.endDate
		&& left.startDateTime === right.startDateTime
		&& left.endDateTime === right.endDateTime;
}

function shiftDateKey(dateKey: string, deltaDays: number): string {
	const [year, month, day] = dateKey.split('-').map(Number);
	const date = new Date(year, month - 1, day, 12, 0, 0, 0);
	date.setDate(date.getDate() + deltaDays);
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
