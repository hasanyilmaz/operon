export const EXTERNAL_CALENDAR_FAILURE_BACKOFF_MS = 10 * 60 * 1000;
export const EXTERNAL_CALENDAR_MAX_RANGE_SPAN_DAYS = 400;
export const EXTERNAL_CALENDAR_COVERAGE_CHECK_INTERVAL_MS = 30000;

const RANGE_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseRangeDateUtcMs(dateKey: string): number | null {
	const match = RANGE_DATE_RE.exec(dateKey);
	if (!match) return null;
	return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function diffRangeDays(fromDateKey: string, toDateKey: string): number {
	const from = parseRangeDateUtcMs(fromDateKey);
	const to = parseRangeDateUtcMs(toDateKey);
	if (from === null || to === null) return 0;
	return Math.round((to - from) / 86400000);
}

function shiftRangeDateKey(dateKey: string, deltaDays: number): string {
	const parsed = parseRangeDateUtcMs(dateKey);
	if (parsed === null) return dateKey;
	const shifted = new Date(parsed + (deltaDays * 86400000));
	const year = shifted.getUTCFullYear();
	const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
	const day = String(shifted.getUTCDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

/**
 * The requested sync window follows the ranges the calendar views ask for,
 * but must not grow without bound within a session (a single far navigation
 * would otherwise make every subsequent sync parse a huge window forever).
 * The union of the tracked and needed windows is capped at `maxSpanDays`;
 * when the cap is exceeded, history (the past side) is trimmed first so the
 * forward-looking window survives, and the needed window always stays fully
 * covered. Trimmed regions self-heal on return thanks to the coverage
 * expansion refetch.
 */
export function resolveExternalCalendarRequestedRange(input: {
	currentStart: string | null;
	currentEnd: string | null;
	neededStart: string;
	neededEnd: string;
	maxSpanDays?: number;
}): { start: string; end: string } {
	const neededStart = input.neededStart <= input.neededEnd ? input.neededStart : input.neededEnd;
	const neededEnd = input.neededEnd >= input.neededStart ? input.neededEnd : input.neededStart;
	const currentStart = input.currentStart && RANGE_DATE_RE.test(input.currentStart) ? input.currentStart : null;
	const currentEnd = input.currentEnd && RANGE_DATE_RE.test(input.currentEnd) ? input.currentEnd : null;
	let start = currentStart && currentStart < neededStart ? currentStart : neededStart;
	let end = currentEnd && currentEnd > neededEnd ? currentEnd : neededEnd;

	const maxSpanDays = Math.max(1, input.maxSpanDays ?? EXTERNAL_CALENDAR_MAX_RANGE_SPAN_DAYS);
	if (diffRangeDays(neededStart, neededEnd) >= maxSpanDays) {
		return { start: neededStart, end: neededEnd };
	}
	let excessDays = diffRangeDays(start, end) - maxSpanDays;
	if (excessDays <= 0) {
		return { start, end };
	}
	const frontSlackDays = diffRangeDays(start, neededStart);
	const frontTrimDays = Math.min(frontSlackDays, excessDays);
	if (frontTrimDays > 0) {
		start = shiftRangeDateKey(start, frontTrimDays);
		excessDays -= frontTrimDays;
	}
	if (excessDays > 0) {
		end = shiftRangeDateKey(end, -excessDays);
	}
	return { start, end };
}

export interface ExternalCalendarPersistSnapshot {
	etag: string | null;
	lastModified: string | null;
	coveredRangeStart: string | null;
	coveredRangeEnd: string | null;
	lastError: string | null;
}

/**
 * Every sync attempt used to rewrite the whole multi-source cache file even
 * when only bookkeeping (`syncedAt` / `lastAttemptAt`) changed, which meant a
 * full-document disk write per refresh interval and per failed attempt. Only
 * durable state is worth persisting; skipping bookkeeping-only writes costs
 * at most one extra conditional fetch per source after a restart (the stale
 * on-disk `syncedAt` looks due), which a 304 answers cheaply.
 */
export function shouldPersistExternalCalendarCacheUpdate(
	previous: ExternalCalendarPersistSnapshot,
	next: ExternalCalendarPersistSnapshot,
	eventsChanged: boolean,
): boolean {
	if (eventsChanged) return true;
	return previous.etag !== next.etag
		|| previous.lastModified !== next.lastModified
		|| previous.coveredRangeStart !== next.coveredRangeStart
		|| previous.coveredRangeEnd !== next.coveredRangeEnd
		|| previous.lastError !== next.lastError;
}

/**
 * `ensureCoverage` runs from the render path; the check itself is cheap but
 * does not need to repeat on every render. It reruns immediately when the
 * views request a different range, and otherwise at most once per interval.
 */
export function shouldRunExternalCalendarCoverageCheck(input: {
	requestedKey: string;
	lastCheckedKey: string | null;
	lastCheckedAtMs: number;
	nowMs: number;
	intervalMs?: number;
}): boolean {
	if (input.requestedKey !== input.lastCheckedKey) return true;
	return input.nowMs - input.lastCheckedAtMs >= (input.intervalMs ?? EXTERNAL_CALENDAR_COVERAGE_CHECK_INTERVAL_MS);
}

export interface ExternalCalendarSyncPolicyCacheState {
	syncedAt: string | null;
	lastAttemptAt: string | null;
	lastError: string | null;
	coveredRangeStart: string | null;
	coveredRangeEnd: string | null;
}

export interface ExternalCalendarSyncDecisionInput {
	cache: ExternalCalendarSyncPolicyCacheState | null;
	refreshIntervalHours: number;
	rangeStart: string;
	rangeEnd: string;
	nowMs: number;
}

export function isExternalCalendarCoverageExpanding(
	cache: Pick<ExternalCalendarSyncPolicyCacheState, 'coveredRangeStart' | 'coveredRangeEnd'> | null,
	rangeStart: string,
	rangeEnd: string,
): boolean {
	if (!cache?.coveredRangeStart || !cache.coveredRangeEnd) return true;
	return rangeStart < cache.coveredRangeStart || rangeEnd > cache.coveredRangeEnd;
}

export function isExternalCalendarFailureBackoffActive(
	cache: Pick<ExternalCalendarSyncPolicyCacheState, 'lastError' | 'lastAttemptAt'> | null,
	nowMs: number,
	backoffMs = EXTERNAL_CALENDAR_FAILURE_BACKOFF_MS,
): boolean {
	if (!cache?.lastError || !cache.lastAttemptAt) return false;
	const attemptedAt = Date.parse(cache.lastAttemptAt);
	if (!Number.isFinite(attemptedAt)) return false;
	return nowMs - attemptedAt < backoffMs;
}

export function shouldSyncExternalCalendarSource(input: ExternalCalendarSyncDecisionInput): boolean {
	const { cache, refreshIntervalHours, rangeStart, rangeEnd, nowMs } = input;
	if (isExternalCalendarFailureBackoffActive(cache, nowMs)) return false;
	if (!cache) return true;
	if (isExternalCalendarCoverageExpanding(cache, rangeStart, rangeEnd)) return true;
	if (!cache.syncedAt) return true;
	const syncedAt = Date.parse(cache.syncedAt);
	if (!Number.isFinite(syncedAt)) return true;
	return nowMs - syncedAt >= refreshIntervalHours * 3600000;
}
