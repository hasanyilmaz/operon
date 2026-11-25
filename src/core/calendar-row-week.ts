import type { FilterNode } from '../types/settings';

export interface WeekNumbering {
	firstDay: number;
	januaryAnchor: number;
}

const ISO_WEEK: WeekNumbering = { firstDay: 1, januaryAnchor: 4 };
const DAY = 86_400_000;

function firstWeekStart(year: number, rules: WeekNumbering): number {
	const anchor = new Date(0);
	anchor.setUTCFullYear(year, 0, rules.januaryAnchor);
	return anchor.getTime() - ((anchor.getUTCDay() - rules.firstDay + 7) % 7) * DAY;
}

/** The sidebar labels the whole row by its Monday, even when Sunday is first. */
export function calendarRowWeekNumber(day: string, weekStart: 'monday' | 'sunday', rules = ISO_WEEK): number {
	const monday = new Date(day + 'T00:00:00Z');
	const weekday = monday.getUTCDay();
	const offset = weekStart === 'sunday' ? 1 - weekday : -((weekday + 6) % 7);
	monday.setUTCDate(monday.getUTCDate() + offset);
	const year = monday.getUTCFullYear();
	let start = firstWeekStart(year, rules);
	if (monday.getTime() < start) start = firstWeekStart(year - 1, rules);
	else {
		const next = firstWeekStart(year + 1, rules);
		if (monday.getTime() >= next) start = next;
	}
	return Math.floor((monday.getTime() - start) / (7 * DAY)) + 1;
}

export function isWeekNumberOperator(operator: string): boolean {
	return operator === 'weekIs' || operator === 'weekNot';
}

export function isValidWeekNumber(value: string | undefined): boolean {
	return /^(?:[1-9]|[1-4]\d|5[0-3])$/u.test(value ?? '');
}

export function hasInvalidWeekNumber(node: FilterNode): boolean {
	return 'children' in node
		? node.children.some(hasInvalidWeekNumber)
		: isWeekNumberOperator(node.operator) && !isValidWeekNumber(node.value);
}
