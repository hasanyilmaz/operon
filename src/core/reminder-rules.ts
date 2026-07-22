import { toLocalDatetime } from './local-time';

export const REMINDER_RULE_ANCHORS = [
	'datetimeStart',
	'datetimeEnd',
	'dateStarted',
	'dateScheduled',
	'dateDue',
] as const;

export type ReminderRuleAnchor = typeof REMINDER_RULE_ANCHORS[number];

export interface ReminderRuleOffset {
	calendarDays: number;
	clockMinutes: number;
	canonical: string;
}

export interface ParsedReminderRule {
	raw: string;
	anchor: ReminderRuleAnchor;
	offset: ReminderRuleOffset;
	canonical: string;
}

export type ReminderOffsetParseErrorReason = 'empty' | 'format' | 'overflow';

export type ReminderOffsetParseResult =
	| { ok: true; value: ReminderRuleOffset }
	| { ok: false; reason: ReminderOffsetParseErrorReason };

export type ReminderRuleParseErrorReason =
	| 'empty'
	| 'format'
	| 'unsupported-anchor'
	| 'invalid-offset'
	| 'overflow';

export type ReminderRuleParseResult =
	| { ok: true; value: ParsedReminderRule }
	| { ok: false; raw: string; reason: ReminderRuleParseErrorReason };

export interface ParsedAbsoluteReminder {
	raw: string;
	epochMs: number;
	localDatetime: string;
}

export type AbsoluteReminderParseErrorReason = 'empty' | 'format' | 'invalid-date' | 'overflow';

export type AbsoluteReminderParseResult =
	| { ok: true; value: ParsedAbsoluteReminder }
	| { ok: false; raw: string; reason: AbsoluteReminderParseErrorReason };

export type ReminderRuleResolution =
	| { status: 'resolved'; rule: ParsedReminderRule; epochMs: number; localDatetime: string }
	| { status: 'invalid-rule'; raw: string; reason: ReminderRuleParseErrorReason }
	| { status: 'missing-anchor'; rule: ParsedReminderRule; anchor: ReminderRuleAnchor }
	| { status: 'invalid-anchor'; rule: ParsedReminderRule; anchor: ReminderRuleAnchor; rawValue: string };

export interface CanonicalReminderRuleList {
	items: ReminderRuleParseResult[];
	canonicalRules: string[];
}

export interface CanonicalAbsoluteReminderList {
	items: AbsoluteReminderParseResult[];
	canonicalDatetimes: string[];
}

const REMINDER_RULE_ANCHOR_SET = new Set<string>(REMINDER_RULE_ANCHORS);
const DATE_ONLY_REMINDER_ANCHOR_SET = new Set<ReminderRuleAnchor>([
	'dateStarted',
	'dateScheduled',
	'dateDue',
]);
const STRICT_LOCAL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const STRICT_LOCAL_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/u;
const STRICT_OFFSET_RE = /^(?:(\d+)w)?(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?$/u;
const FRIENDLY_OFFSET_RE = /^(?:(\d+)w\s*)?(?:(\d+)d\s*)?(?:(\d+)h\s*)?(?:(\d+)m)?$/u;
const MINUTES_PER_HOUR = 60;
const DAYS_PER_WEEK = 7;
const MILLISECONDS_PER_MINUTE = 60_000;

/** Parse the picker-facing duration input. Spaces are allowed only between unit components. */
export function parseReminderOffsetInput(input: string): ReminderOffsetParseResult {
	return parseReminderOffset(input, true);
}

/** Parse and canonicalize one persisted canonicalKey.offset rule. */
export function parseReminderRule(raw: string): ReminderRuleParseResult {
	const trimmed = raw.trim();
	if (!trimmed) return { ok: false, raw, reason: 'empty' };
	const separatorIndex = trimmed.indexOf('.');
	if (separatorIndex <= 0 || separatorIndex !== trimmed.lastIndexOf('.')) {
		return { ok: false, raw, reason: 'format' };
	}

	const anchorToken = trimmed.slice(0, separatorIndex);
	const offsetToken = trimmed.slice(separatorIndex + 1);
	if (!isReminderRuleAnchor(anchorToken)) {
		return { ok: false, raw, reason: 'unsupported-anchor' };
	}
	const offsetResult = parseReminderOffset(offsetToken, false);
	if (!offsetResult.ok) {
		return {
			ok: false,
			raw,
			reason: offsetResult.reason === 'overflow' ? 'overflow' : 'invalid-offset',
		};
	}

	return {
		ok: true,
		value: {
			raw,
			anchor: anchorToken,
			offset: offsetResult.value,
			canonical: `${anchorToken}.${offsetResult.value.canonical}`,
		},
	};
}

/** Parse an absolute local reminder datetime and normalize optional seconds. */
export function parseAbsoluteReminder(raw: string): AbsoluteReminderParseResult {
	const trimmed = raw.trim();
	if (!trimmed) return { ok: false, raw, reason: 'empty' };
	const parsed = parseStrictLocalDatetime(trimmed);
	if (parsed.status === 'format') return { ok: false, raw, reason: 'format' };
	if (parsed.status === 'invalid') return { ok: false, raw, reason: 'invalid-date' };
	if (!Number.isFinite(parsed.date.getTime())) return { ok: false, raw, reason: 'overflow' };
	return {
		ok: true,
		value: {
			raw,
			epochMs: parsed.date.getTime(),
			localDatetime: toLocalDatetime(parsed.date),
		},
	};
}

/** Resolve one dynamic rule against the task's current canonical field values. */
export function resolveReminderRule(
	raw: string,
	fieldValues: Readonly<Record<string, string | undefined>>,
): ReminderRuleResolution {
	const parsedResult = parseReminderRule(raw);
	if (!parsedResult.ok) {
		return { status: 'invalid-rule', raw, reason: parsedResult.reason };
	}
	const rule = parsedResult.value;
	const rawAnchorValue = (fieldValues[rule.anchor] ?? '').trim();
	if (!rawAnchorValue) {
		return { status: 'missing-anchor', rule, anchor: rule.anchor };
	}

	const anchorDate = DATE_ONLY_REMINDER_ANCHOR_SET.has(rule.anchor)
		? parseStrictLocalDate(rawAnchorValue)
		: parseStrictLocalDatetime(rawAnchorValue);
	if (anchorDate.status !== 'valid') {
		return {
			status: 'invalid-anchor',
			rule,
			anchor: rule.anchor,
			rawValue: rawAnchorValue,
		};
	}

	const resolvedDate = new Date(anchorDate.date.getTime());
	resolvedDate.setDate(resolvedDate.getDate() - rule.offset.calendarDays);
	const calendarAdjustedEpoch = resolvedDate.getTime();
	const clockOffsetMs = rule.offset.clockMinutes * MILLISECONDS_PER_MINUTE;
	const epochMs = calendarAdjustedEpoch - clockOffsetMs;
	if (!Number.isFinite(calendarAdjustedEpoch) || !Number.isSafeInteger(clockOffsetMs) || !Number.isFinite(epochMs)) {
		return { status: 'invalid-rule', raw, reason: 'overflow' };
	}
	const triggerDate = new Date(epochMs);
	const triggerYear = triggerDate.getFullYear();
	if (
		!Number.isFinite(triggerDate.getTime())
		|| triggerYear < 1
		|| triggerYear > 9999
	) {
		return { status: 'invalid-rule', raw, reason: 'overflow' };
	}
	const localDatetime = toLocalDatetime(triggerDate);
	return { status: 'resolved', rule, epochMs, localDatetime };
}

/** Resolve every source token independently, preserving source order and diagnostics. */
export function resolveReminderRules(
	rawRules: readonly string[],
	fieldValues: Readonly<Record<string, string | undefined>>,
): ReminderRuleResolution[] {
	return rawRules.map(raw => resolveReminderRule(raw, fieldValues));
}

/** Return task date fields that can currently anchor a relative reminder. */
export function getAvailableReminderRuleAnchors(
	fieldValues: Readonly<Record<string, string | undefined>>,
): ReminderRuleAnchor[] {
	return REMINDER_RULE_ANCHORS.filter(anchor =>
		resolveReminderRule(`${anchor}.0m`, fieldValues).status === 'resolved');
}

/** Canonicalize valid rules and remove canonical duplicates while retaining per-item diagnostics. */
export function canonicalizeReminderRuleList(rawRules: readonly string[]): CanonicalReminderRuleList {
	const items = rawRules.map(parseReminderRule);
	const seen = new Set<string>();
	const canonicalRules: string[] = [];
	for (const item of items) {
		if (!item.ok || seen.has(item.value.canonical)) continue;
		seen.add(item.value.canonical);
		canonicalRules.push(item.value.canonical);
	}
	return { items, canonicalRules };
}

/** Canonicalize, deduplicate, and chronologically sort valid absolute reminder datetimes. */
export function canonicalizeAbsoluteReminderList(rawValues: readonly string[]): CanonicalAbsoluteReminderList {
	const items = rawValues.map(parseAbsoluteReminder);
	const validByDatetime = new Map<string, ParsedAbsoluteReminder>();
	for (const item of items) {
		if (item.ok && !validByDatetime.has(item.value.localDatetime)) {
			validByDatetime.set(item.value.localDatetime, item.value);
		}
	}
	const canonicalDatetimes = [...validByDatetime.values()]
		.sort((left, right) => left.epochMs - right.epochMs)
		.map(item => item.localDatetime);
	return { items, canonicalDatetimes };
}

export function isReminderRuleAnchor(value: string): value is ReminderRuleAnchor {
	return REMINDER_RULE_ANCHOR_SET.has(value);
}

function parseReminderOffset(raw: string, allowComponentWhitespace: boolean): ReminderOffsetParseResult {
	const trimmed = raw.trim();
	if (!trimmed) return { ok: false, reason: 'empty' };
	const match = (allowComponentWhitespace ? FRIENDLY_OFFSET_RE : STRICT_OFFSET_RE).exec(trimmed);
	if (!match || !match.slice(1).some(value => value !== undefined)) {
		return { ok: false, reason: 'format' };
	}
	const values = match.slice(1).map(value => Number(value ?? 0));
	if (values.some(value => !Number.isSafeInteger(value) || value < 0)) {
		return { ok: false, reason: 'overflow' };
	}
	const [weeks, days, hours, minutes] = values;
	const calendarDays = weeks * DAYS_PER_WEEK + days;
	const clockMinutes = hours * MINUTES_PER_HOUR + minutes;
	if (
		!Number.isSafeInteger(calendarDays)
		|| !Number.isSafeInteger(clockMinutes)
		|| !Number.isSafeInteger(clockMinutes * MILLISECONDS_PER_MINUTE)
	) {
		return { ok: false, reason: 'overflow' };
	}
	return {
		ok: true,
		value: {
			calendarDays,
			clockMinutes,
			canonical: formatReminderOffset(calendarDays, clockMinutes),
		},
	};
}

function formatReminderOffset(calendarDays: number, clockMinutes: number): string {
	const weeks = Math.floor(calendarDays / DAYS_PER_WEEK);
	const days = calendarDays % DAYS_PER_WEEK;
	const hours = Math.floor(clockMinutes / MINUTES_PER_HOUR);
	const minutes = clockMinutes % MINUTES_PER_HOUR;
	const parts: string[] = [];
	if (weeks > 0) parts.push(`${weeks}w`);
	if (days > 0) parts.push(`${days}d`);
	if (hours > 0) parts.push(`${hours}h`);
	if (minutes > 0) parts.push(`${minutes}m`);
	return parts.join('') || '0m';
}

type StrictLocalDateParseResult =
	| { status: 'valid'; date: Date }
	| { status: 'format' }
	| { status: 'invalid' };

function parseStrictLocalDate(value: string): StrictLocalDateParseResult {
	const match = STRICT_LOCAL_DATE_RE.exec(value);
	if (!match) return { status: 'format' };
	return buildStrictLocalDate(
		Number(match[1]),
		Number(match[2]),
		Number(match[3]),
		0,
		0,
		0,
		true,
	);
}

function parseStrictLocalDatetime(value: string): StrictLocalDateParseResult {
	const match = STRICT_LOCAL_DATETIME_RE.exec(value);
	if (!match) return { status: 'format' };
	return buildStrictLocalDate(
		Number(match[1]),
		Number(match[2]),
		Number(match[3]),
		Number(match[4]),
		Number(match[5]),
		Number(match[6] ?? 0),
		false,
	);
}

function buildStrictLocalDate(
	year: number,
	month: number,
	day: number,
	hour: number,
	minute: number,
	second: number,
	allowSkippedLocalMidnight: boolean,
): StrictLocalDateParseResult {
	if (
		![year, month, day, hour, minute, second].every(Number.isInteger)
		|| year < 1
		|| year > 9999
		|| month < 1
		|| month > 12
		|| day < 1
		|| day > 31
		|| hour < 0
		|| hour > 23
		|| minute < 0
		|| minute > 59
		|| second < 0
		|| second > 59
	) {
		return { status: 'invalid' };
	}
	const date = new Date(0);
	date.setHours(0, 0, 0, 0);
	date.setFullYear(year, month - 1, day);
	date.setHours(hour, minute, second, 0);
	if (
		date.getFullYear() !== year
		|| date.getMonth() !== month - 1
		|| date.getDate() !== day
		|| (!allowSkippedLocalMidnight && date.getHours() !== hour)
		|| (!allowSkippedLocalMidnight && date.getMinutes() !== minute)
		|| (!allowSkippedLocalMidnight && date.getSeconds() !== second)
	) {
		return { status: 'invalid' };
	}
	return { status: 'valid', date };
}
