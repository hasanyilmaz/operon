import { shiftCalendarDateKey } from '../../systems/calendar-query';
import type { CalendarItem } from '../../types/calendar';

export interface AnchoredAllDayMoveRange {
	startDate: string;
	endDate: string;
}

export function canEditAllDayCalendarItemPlacement(
	item: Pick<CalendarItem, 'origin' | 'repeatRef'>,
): boolean {
	return item.origin !== 'external'
		&& item.repeatRef?.projectionKind !== 'doneRolling';
}

export function resolveAnchoredAllDayMoveRange(
	startDate: string,
	endDate: string,
	anchorDate: string,
	targetDate: string,
): AnchoredAllDayMoveRange {
	const deltaDays = diffCalendarDateKeys(anchorDate, targetDate);
	return {
		startDate: shiftCalendarDateKey(startDate, deltaDays),
		endDate: shiftCalendarDateKey(endDate, deltaDays),
	};
}

function diffCalendarDateKeys(fromDate: string, toDate: string): number {
	const from = parseDateKey(fromDate);
	const to = parseDateKey(toDate);
	if (!from || !to) return 0;
	return Math.round((to.getTime() - from.getTime()) / 86400000);
}

function parseDateKey(dateKey: string): Date | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(dateKey);
	if (!match) return null;
	const year = Number.parseInt(match[1], 10);
	const month = Number.parseInt(match[2], 10);
	const day = Number.parseInt(match[3], 10);
	const parsed = new Date(year, month - 1, day, 12, 0, 0, 0);
	if (
		parsed.getFullYear() !== year
		|| parsed.getMonth() !== month - 1
		|| parsed.getDate() !== day
	) {
		return null;
	}
	return parsed;
}
