/**
 * Local time utilities for Operon.
 * All user-facing timestamps use local time, NOT UTC.
 *
 * Format: YYYY-MM-DDTHH:MM:SS (no timezone suffix, no milliseconds)
 * Date-only: YYYY-MM-DD
 */

/**
 * Get current local datetime as ISO-like string without timezone.
 * Example: "2026-03-01T17:44:32"
 */
export function localNow(): string {
	const d = new Date();
	return formatLocalDatetimeParts(d);
}

/**
 * Get current local date as YYYY-MM-DD.
 * Example: "2026-03-01"
 */
export function localToday(): string {
	const d = new Date();
	return formatLocalDateParts(d);
}

/**
 * Convert a Date object to local ISO-like datetime string.
 */
export function toLocalDatetime(date: Date): string {
	return formatLocalDatetimeParts(date);
}

/**
 * Convert a Date object to local date string YYYY-MM-DD.
 */
export function toLocalDate(date: Date): string {
	return formatLocalDateParts(date);
}

function formatLocalDatetimeParts(date: Date): string {
	return `${formatLocalDateParts(date)}T${padLocalComponent(date.getHours())}:${padLocalComponent(date.getMinutes())}:${padLocalComponent(date.getSeconds())}`;
}

function formatLocalDateParts(date: Date): string {
	return `${String(date.getFullYear()).padStart(4, '0')}-${padLocalComponent(date.getMonth() + 1)}-${padLocalComponent(date.getDate())}`;
}

function padLocalComponent(value: number): string {
	return String(value).padStart(2, '0');
}

const LOCAL_DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_DATETIME_OPTIONAL_SECONDS_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Parse an Operon timestamp string to epoch milliseconds using LOCAL time.
 *
 * Date.parse treats date-only ISO strings as UTC midnight but naive datetimes as
 * local time, so mixing "2026-07-07" and "2026-07-06T18:00" in one comparison
 * produces cross-day inversions in non-UTC timezones. Both Operon formats are
 * therefore parsed with local semantics; anything else (e.g. timezone-suffixed
 * ISO) falls back to Date.parse. Returns null when unparseable.
 */
export function parseLocalTimestamp(value: string): number | null {
	const trimmed = value.trim();
	if (!trimmed) return null;
	const dateOnly = LOCAL_DATE_ONLY_RE.exec(trimmed);
	if (dateOnly) {
		return createLocalDate(
			Number(dateOnly[1]),
			Number(dateOnly[2]) - 1,
			Number(dateOnly[3]),
		).getTime();
	}
	const dateTime = LOCAL_DATETIME_OPTIONAL_SECONDS_RE.exec(trimmed);
	if (dateTime) {
		return createLocalDate(
			Number(dateTime[1]),
			Number(dateTime[2]) - 1,
			Number(dateTime[3]),
			Number(dateTime[4]),
			Number(dateTime[5]),
			Number(dateTime[6] ?? 0),
			0,
		).getTime();
	}
	const fallback = Date.parse(trimmed);
	return Number.isFinite(fallback) ? fallback : null;
}

function createLocalDate(
	year: number,
	monthIndex: number,
	day: number,
	hours = 0,
	minutes = 0,
	seconds = 0,
	milliseconds = 0,
): Date {
	const date = new Date(0);
	date.setFullYear(year, monthIndex, day);
	date.setHours(hours, minutes, seconds, milliseconds);
	return date;
}
