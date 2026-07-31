export interface ParsedTrackerSession {
	start: string;
	end: string;
	raw: string;
	durationSeconds: number;
}

export type TrackerSessionProjectionInput =
	| { operation: 'add-session'; start: string; end: string }
	| { operation: 'update-session'; sessionNumber: number; start: string; end: string }
	| { operation: 'remove-session'; sessionNumber: number };

export interface TrackerSessionProjection {
	currentTrackers: string;
	currentDuration: number;
	nextTrackers: string;
	nextDuration: number;
	selectedRawIndex?: number;
	selectedStart?: string;
	selectedEnd?: string;
	noChange: boolean;
}

export type TrackerSessionProjectionResult =
	| { ok: true; value: TrackerSessionProjection }
	| { ok: false; reason: string };

const LOCAL_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/;
const DATETIME_LOCAL_WITH_OPTIONAL_SECONDS_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2}))?$/;

export function parseLocalDatetime(value: string): Date | null {
	const match = LOCAL_DATETIME_RE.exec(value.trim());
	if (!match) return null;

	const [, year, month, day, hour, minute, second] = match;
	const parsed = new Date(
		Number(year),
		Number(month) - 1,
		Number(day),
		Number(hour),
		Number(minute),
		Number(second),
		0,
	);
	if (
		parsed.getFullYear() !== Number(year)
		|| parsed.getMonth() !== Number(month) - 1
		|| parsed.getDate() !== Number(day)
		|| parsed.getHours() !== Number(hour)
		|| parsed.getMinutes() !== Number(minute)
		|| parsed.getSeconds() !== Number(second)
	) return null;
	return parsed;
}

export function toDatetimeLocalValue(value: string | undefined | null): string {
	if (!value) return '';
	const trimmed = value.trim();
	return LOCAL_DATETIME_RE.test(trimmed) ? trimmed : '';
}

export function fromDatetimeLocalValue(value: string | undefined | null): string {
	if (!value) return '';
	const trimmed = value.trim();
	const match = DATETIME_LOCAL_WITH_OPTIONAL_SECONDS_RE.exec(trimmed);
	if (!match) return '';
	return `${match[1]}:${match[2] ?? '00'}`;
}

export function normalizeActiveTrackerValue(value: string | undefined | null): string {
	if (!value) return '';
	const trimmed = value.trim();
	if (!trimmed) return '';
	const slashIndex = trimmed.indexOf('/');
	return slashIndex === -1 ? trimmed : trimmed.substring(0, slashIndex).trim();
}

export function buildTrackerRange(start: string, end: string): string {
	return `${start}/${end}`;
}

function formatLocalDatetime(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	const hour = String(date.getHours()).padStart(2, '0');
	const minute = String(date.getMinutes()).padStart(2, '0');
	const second = String(date.getSeconds()).padStart(2, '0');
	return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

function getNextLocalMidnight(date: Date): Date {
	return new Date(
		date.getFullYear(),
		date.getMonth(),
		date.getDate() + 1,
		0,
		0,
		0,
		0,
	);
}

export function splitTrackerRangeByMidnight(start: string, end: string): Array<{ start: string; end: string }> {
	const startDate = parseLocalDatetime(start);
	const endDate = parseLocalDatetime(end);
	if (!startDate || !endDate || endDate.getTime() <= startDate.getTime()) {
		return [{ start, end }];
	}

	const fragments: Array<{ start: string; end: string }> = [];
	let cursor = startDate;

	while (cursor.getTime() < endDate.getTime()) {
		const nextMidnight = getNextLocalMidnight(cursor);
		const fragmentEnd = nextMidnight.getTime() < endDate.getTime() ? nextMidnight : endDate;
		fragments.push({
			start: formatLocalDatetime(cursor),
			end: formatLocalDatetime(fragmentEnd),
		});
		cursor = fragmentEnd;
	}

	return fragments.length > 0 ? fragments : [{ start, end }];
}

export function parseTrackerRange(raw: string): ParsedTrackerSession | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;

	const [start, end] = trimmed.split('/').map(part => part.trim());
	if (!start || !end) return null;

	const startDate = parseLocalDatetime(start);
	const endDate = parseLocalDatetime(end);
	if (!startDate || !endDate) return null;

	const durationSeconds = Math.max(0, Math.floor((endDate.getTime() - startDate.getTime()) / 1000));
	return {
		start,
		end,
		raw: buildTrackerRange(start, end),
		durationSeconds,
	};
}

export function parseTrackerList(value: string | undefined | null): ParsedTrackerSession[] {
	if (!value?.trim()) return [];
	return value
		.split(';')
		.map(part => parseTrackerRange(part))
		.filter((session): session is ParsedTrackerSession => !!session);
}

export function serializeTrackerList(
	sessions: Array<{ start: string; end: string } | string>,
): string {
	return sessions
		.map(session => typeof session === 'string' ? session.trim() : buildTrackerRange(session.start, session.end))
		.filter(Boolean)
		.join('; ');
}

export function calculateDurationFromTrackers(value: string | undefined | null): number {
	return parseTrackerList(value).reduce((sum, session) => sum + session.durationSeconds, 0);
}

export function projectTrackerSessionMutation(
	currentValue: string | undefined | null,
	input: TrackerSessionProjectionInput,
	splitAtMidnight: boolean,
): TrackerSessionProjectionResult {
	const currentTrackers = currentValue?.trim() ?? '';
	const rawItems = currentTrackers ? currentTrackers.split(';').map(item => item.trim()) : [];
	const sessions: Array<ParsedTrackerSession & { rawIndex: number }> = [];
	for (let rawIndex = 0; rawIndex < rawItems.length; rawIndex++) {
		const raw = rawItems[rawIndex];
		if (!raw || raw.split('/').length !== 2) {
			return { ok: false, reason: 'The stored tracker list is malformed.' };
		}
		const parsed = parseTrackerRange(raw);
		if (!parsed || parsed.durationSeconds <= 0 || parsed.raw !== raw) {
			return { ok: false, reason: 'The stored tracker list cannot be hydrated exactly.' };
		}
		sessions.push({ ...parsed, rawIndex });
	}
	const ordered = [...sessions].sort((left, right) => (
		left.start.localeCompare(right.start)
		|| left.end.localeCompare(right.end)
		|| left.rawIndex - right.rawIndex
	));
	const nextRanges = sessions.map(session => session.raw);
	let selected: (typeof sessions)[number] | undefined;
	if (input.operation !== 'add-session') {
		if (!Number.isInteger(input.sessionNumber) || input.sessionNumber < 1) {
			return { ok: false, reason: 'Session number must be a positive 1-based integer.' };
		}
		selected = ordered[input.sessionNumber - 1];
		if (!selected) return { ok: false, reason: 'The selected tracker session does not exist.' };
	}
	if (input.operation === 'remove-session') {
		nextRanges.splice(selected!.rawIndex, 1);
	} else {
		const start = fromDatetimeLocalValue(input.start);
		const end = fromDatetimeLocalValue(input.end);
		const startDate = parseLocalDatetime(start);
		const endDate = parseLocalDatetime(end);
		if (!start || !end || !startDate || !endDate || endDate.getTime() <= startDate.getTime()) {
			return { ok: false, reason: 'Tracker session requires a valid local-naive range with end after start.' };
		}
		const fragments = (splitAtMidnight ? splitTrackerRangeByMidnight(start, end) : [{ start, end }])
			.map(fragment => buildTrackerRange(fragment.start, fragment.end));
		if (input.operation === 'add-session') nextRanges.push(...fragments);
		else nextRanges.splice(selected!.rawIndex, 1, ...fragments);
	}
	const nextTrackers = serializeTrackerList(nextRanges);
	const currentDuration = sessions.reduce((sum, session) => sum + session.durationSeconds, 0);
	const nextDuration = calculateDurationFromTrackers(nextTrackers);
	return {
		ok: true,
		value: {
			currentTrackers,
			currentDuration,
			nextTrackers,
			nextDuration,
			...(selected
				? {
					selectedRawIndex: selected.rawIndex,
					selectedStart: selected.start,
					selectedEnd: selected.end,
				}
				: {}),
			noChange: nextTrackers === currentTrackers,
		},
	};
}

export function formatDurationClock(seconds: number): string {
	const total = Math.max(0, Math.floor(seconds));
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const secs = total % 60;
	return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatDurationHuman(seconds: number): string {
	const total = Math.max(0, Math.floor(seconds));
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const secs = total % 60;

	if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
	if (minutes > 0) return `${minutes}m ${secs}s`;
	return `${secs}s`;
}

export function isLocalDateInRange(dateValue: string, rangeDays: number, now: Date = new Date()): boolean {
	const sessionDate = parseLocalDatetime(`${dateValue}T00:00:00`);
	if (!sessionDate) return false;

	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
	const oldest = new Date(today);
	oldest.setDate(today.getDate() - Math.max(0, rangeDays - 1));
	return sessionDate.getTime() >= oldest.getTime() && sessionDate.getTime() <= today.getTime();
}
