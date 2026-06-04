import { RepeatFrequency, RepeatRule, RepeatWeekday, serializeRepeatRule } from './repeat-rule';

export type TasksRecurrenceToOperonResult =
	| {
		kind: 'converted';
		repeat: string;
		repeatOccurrenceDate?: string;
	}
	| {
		kind: 'unsupported';
		leftover: string;
	};

export interface TasksRecurrenceContext {
	dateDue?: string;
	dateScheduled?: string;
	dateStarted?: string;
}

interface AnchorDate {
	date: string;
	month: number;
	day: number;
}

const WEEKDAY_ORDER: RepeatWeekday[] = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'];

const WEEKDAY_BY_NAME: Record<string, RepeatWeekday> = {
	monday: 'mo',
	tuesday: 'tu',
	wednesday: 'we',
	thursday: 'th',
	friday: 'fr',
	saturday: 'sa',
	sunday: 'su',
};

const MONTH_BY_NAME: Record<string, number> = {
	january: 1,
	february: 2,
	march: 3,
	april: 4,
	may: 5,
	june: 6,
	july: 7,
	august: 8,
	september: 9,
	october: 10,
	november: 11,
	december: 12,
};

const WEEKDAY_NAMES = Object.keys(WEEKDAY_BY_NAME).join('|');
const MONTH_NAMES = Object.keys(MONTH_BY_NAME).join('|');

function unsupported(leftover: string): TasksRecurrenceToOperonResult {
	return { kind: 'unsupported', leftover };
}

function normalizeRecurrenceText(raw: string): string {
	return raw
		.trim()
		.replace(/^🔁\s*/u, '')
		.replace(/\s+/gu, ' ')
		.trim()
		.toLowerCase();
}

function parseInterval(raw: string | undefined): number | null {
	if (!raw) return 1;
	const parsed = Number.parseInt(raw.trim(), 10);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseAnchorDate(context: TasksRecurrenceContext): AnchorDate | null {
	const candidate = context.dateDue || context.dateScheduled || context.dateStarted || '';
	const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(candidate.trim());
	if (!match) return null;

	const year = Number.parseInt(match[1], 10);
	const month = Number.parseInt(match[2], 10);
	const day = Number.parseInt(match[3], 10);
	const date = new Date(year, month - 1, day, 12, 0, 0, 0);
	if (Number.isNaN(date.getTime())) return null;
	if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
	return { date: candidate.trim(), month, day };
}

function parseOrdinalDay(raw: string): number | null {
	const match = /^(\d{1,2})(?:st|nd|rd|th)$/u.exec(raw.trim());
	if (!match) return null;
	const day = Number.parseInt(match[1], 10);
	return Number.isInteger(day) && day >= 1 && day <= 31 ? day : null;
}

function parseSetpos(raw: string): number | null {
	switch (raw.trim()) {
		case 'first':
		case '1st':
			return 1;
		case 'second':
		case '2nd':
			return 2;
		case 'third':
		case '3rd':
			return 3;
		case 'fourth':
		case '4th':
			return 4;
		case 'last':
			return -1;
		default:
			return null;
	}
}

function parseWeekdayList(raw: string): RepeatWeekday[] | null {
	const values = raw
		.split(/\s*,\s*|\s+and\s+/u)
		.map(value => value.trim())
		.filter(Boolean);
	if (values.length === 0) return null;

	const days = new Set<RepeatWeekday>();
	for (const value of values) {
		const weekday = WEEKDAY_BY_NAME[value];
		if (!weekday) return null;
		days.add(weekday);
	}
	return [...days].sort((left, right) => WEEKDAY_ORDER.indexOf(left) - WEEKDAY_ORDER.indexOf(right));
}

function serialize(rule: RepeatRule, repeatOccurrenceDate?: string): TasksRecurrenceToOperonResult {
	return {
		kind: 'converted',
		repeat: serializeRepeatRule(rule),
		...(repeatOccurrenceDate ? { repeatOccurrenceDate } : {}),
	};
}

function buildSimpleDoneRule(text: string): RepeatRule | null {
	const match = /^every(?:\s+(\d+))?\s+(day|days|week|weeks|month|months|year|years)$/u.exec(text);
	if (!match) return null;
	const interval = parseInterval(match[1]);
	if (!interval) return null;
	const unit = match[2].replace(/s$/u, '') as RepeatFrequency;
	return {
		mode: 'done',
		freq: unit,
		interval,
	};
}

export function parseTasksRecurrenceToOperon(
	raw: string,
	context: TasksRecurrenceContext = {},
): TasksRecurrenceToOperonResult {
	const leftover = raw.trim();
	const text = normalizeRecurrenceText(raw);
	if (!text.startsWith('every ')) return unsupported(leftover);
	if (/\buntil\b/u.test(text) || /\bfor\s+\d+\s+times?\b/u.test(text)) return unsupported(leftover);

	const whenDone = /\s+when done$/u.test(text);
	const ruleText = whenDone ? text.replace(/\s+when done$/u, '') : text;
	const anchor = parseAnchorDate(context);

	if (whenDone) {
		const doneRule = buildSimpleDoneRule(ruleText);
		return doneRule ? serialize(doneRule) : unsupported(leftover);
	}

	if (!anchor) return unsupported(leftover);

	if (ruleText === 'every weekday') {
		return serialize({
			mode: 'schedule',
			freq: 'week',
			interval: 1,
			days: ['mo', 'tu', 'we', 'th', 'fr'],
		}, anchor.date);
	}

	const directWeekdayMatch = new RegExp(`^every\\s+(${WEEKDAY_NAMES})$`, 'u').exec(ruleText);
	if (directWeekdayMatch) {
		return serialize({
			mode: 'schedule',
			freq: 'week',
			interval: 1,
			days: [WEEKDAY_BY_NAME[directWeekdayMatch[1]]],
		}, anchor.date);
	}

	const weeklyOnMatch = /^every(?:\s+(\d+))?\s+weeks?\s+on\s+(.+)$/u.exec(ruleText);
	if (weeklyOnMatch) {
		const interval = parseInterval(weeklyOnMatch[1]);
		const days = parseWeekdayList(weeklyOnMatch[2]);
		if (!interval || !days) return unsupported(leftover);
		return serialize({
			mode: 'schedule',
			freq: 'week',
			interval,
			days,
		}, anchor.date);
	}

	const simpleDayOrWeekMatch = /^every(?:\s+(\d+))?\s+(day|days|week|weeks)$/u.exec(ruleText);
	if (simpleDayOrWeekMatch) {
		const interval = parseInterval(simpleDayOrWeekMatch[1]);
		if (!interval) return unsupported(leftover);
		const unit = simpleDayOrWeekMatch[2].replace(/s$/u, '') as 'day' | 'week';
		return serialize({
			mode: 'schedule',
			freq: unit,
			interval,
		}, anchor.date);
	}

	const monthlyDayMatch = /^every(?:\s+(\d+))?\s+months?\s+on\s+the\s+(\d{1,2}(?:st|nd|rd|th))$/u.exec(ruleText);
	if (monthlyDayMatch) {
		const interval = parseInterval(monthlyDayMatch[1]);
		const day = parseOrdinalDay(monthlyDayMatch[2]);
		if (!interval || !day) return unsupported(leftover);
		return serialize({
			mode: 'schedule',
			freq: 'month',
			interval,
			monthdays: [day],
		}, anchor.date);
	}

	const monthlyLastWeekdayMatch = new RegExp(`^every(?:\\s+(\\d+))?\\s+months?\\s+on\\s+the\\s+last\\s+(${WEEKDAY_NAMES})$`, 'u').exec(ruleText);
	if (monthlyLastWeekdayMatch) {
		const interval = parseInterval(monthlyLastWeekdayMatch[1]);
		const weekday = WEEKDAY_BY_NAME[monthlyLastWeekdayMatch[2]];
		if (!interval || !weekday) return unsupported(leftover);
		return serialize({
			mode: 'schedule',
			freq: 'month',
			interval,
			days: [weekday],
			setpos: -1,
		}, anchor.date);
	}

	const monthlyNthWeekdayMatch = new RegExp(`^every(?:\\s+(\\d+))?\\s+months?\\s+on\\s+the\\s+(first|second|third|fourth|1st|2nd|3rd|4th)\\s+(${WEEKDAY_NAMES})$`, 'u').exec(ruleText);
	if (monthlyNthWeekdayMatch) {
		const interval = parseInterval(monthlyNthWeekdayMatch[1]);
		const setpos = parseSetpos(monthlyNthWeekdayMatch[2]);
		const weekday = WEEKDAY_BY_NAME[monthlyNthWeekdayMatch[3]];
		if (!interval || !setpos || !weekday) return unsupported(leftover);
		return serialize({
			mode: 'schedule',
			freq: 'month',
			interval,
			days: [weekday],
			setpos,
		}, anchor.date);
	}

	const simpleMonthMatch = /^every(?:\s+(\d+))?\s+months?$/u.exec(ruleText);
	if (simpleMonthMatch) {
		const interval = parseInterval(simpleMonthMatch[1]);
		if (!interval) return unsupported(leftover);
		return serialize({
			mode: 'schedule',
			freq: 'month',
			interval,
			monthdays: [anchor.day],
		}, anchor.date);
	}

	const yearlyMonthDayMatch = new RegExp(`^every\\s+(${MONTH_NAMES})\\s+on\\s+the\\s+(\\d{1,2}(?:st|nd|rd|th))$`, 'u').exec(ruleText);
	if (yearlyMonthDayMatch) {
		const month = MONTH_BY_NAME[yearlyMonthDayMatch[1]];
		const day = parseOrdinalDay(yearlyMonthDayMatch[2]);
		if (!month || !day) return unsupported(leftover);
		return serialize({
			mode: 'schedule',
			freq: 'year',
			interval: 1,
			monthdays: [day],
			month,
		}, anchor.date);
	}

	const simpleYearMatch = /^every(?:\s+(\d+))?\s+years?$/u.exec(ruleText);
	if (simpleYearMatch) {
		const interval = parseInterval(simpleYearMatch[1]);
		if (!interval) return unsupported(leftover);
		return serialize({
			mode: 'schedule',
			freq: 'year',
			interval,
			monthdays: [anchor.day],
			month: anchor.month,
		}, anchor.date);
	}

	return unsupported(leftover);
}
