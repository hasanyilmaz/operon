import { shiftCalendarDateKey } from '../../systems/calendar-query';
import { isExpandedAllDayRange } from '../../systems/calendar-writeback';
import type { CalendarItem } from '../../types/calendar';

export interface AnchoredAllDayMoveRange {
	startDate: string;
	endDate: string;
}

export function canEditAllDayCalendarItemPlacement(
	item: Pick<CalendarItem, 'kind' | 'origin' | 'repeatRef'> & {
		renderSnapshot: Pick<CalendarItem['renderSnapshot'], 'fieldValues'>;
	},
): boolean {
	return item.origin !== 'external'
		&& item.repeatRef?.projectionKind !== 'doneRolling'
		&& !isStartedOnlyAllDayItem(item)
		&& !isAmbiguousAllDayRange(item);
}

export function canResizeAllDayCalendarItemPlacement(
	item: Pick<CalendarItem, 'kind' | 'origin' | 'repeatRef'> & {
		renderSnapshot: Pick<CalendarItem['renderSnapshot'], 'fieldValues'>;
	},
): boolean {
	if (!canEditAllDayCalendarItemPlacement(item)) return false;
	const fields = item.renderSnapshot.fieldValues;
	return isExpandedAllDayRange(fields)
		|| (!(fields['dateStarted'] ?? '').trim() && !(fields['dateDue'] ?? '').trim());
}

function isStartedOnlyAllDayItem(
	item: Pick<CalendarItem, 'kind'> & {
		renderSnapshot: Pick<CalendarItem['renderSnapshot'], 'fieldValues'>;
	},
): boolean {
	if (item.kind !== 'allDayScheduled') return false;
	const fields = item.renderSnapshot.fieldValues;
	return !!fields['dateStarted']?.trim()
		&& !fields['dateScheduled']?.trim()
		&& !fields['dateDue']?.trim();
}

function isAmbiguousAllDayRange(
	item: Pick<CalendarItem, 'kind'> & {
		renderSnapshot: Pick<CalendarItem['renderSnapshot'], 'fieldValues'>;
	},
): boolean {
	if (item.kind !== 'allDayScheduled') return false;
	const fields = item.renderSnapshot.fieldValues;
	return !!(fields['dateStarted'] ?? '').trim()
		&& !!(fields['dateDue'] ?? '').trim()
		&& !isExpandedAllDayRange(fields);
}

export function canEditFinishedCalendarItemPlacement(
	item: Pick<CalendarItem, 'kind' | 'origin' | 'repeatRef'> & {
		renderSnapshot: Pick<CalendarItem['renderSnapshot'], 'checkbox' | 'fieldValues'>;
	},
): boolean {
	return item.kind === 'finishedMarker'
		&& item.origin === 'materialized'
		&& item.repeatRef?.projectionKind !== 'doneRolling'
		&& item.renderSnapshot.checkbox === 'done'
		&& parseDateKey(item.renderSnapshot.fieldValues['dateCompleted'] ?? '') !== null;
}

export function canEditDueCalendarItemPlacement(
	item: Pick<CalendarItem, 'kind' | 'origin' | 'repeatRef'> & {
		renderSnapshot: Pick<CalendarItem['renderSnapshot'], 'fieldValues'>;
	},
): boolean {
	return item.kind === 'dueMarker'
		&& item.origin === 'materialized'
		&& item.repeatRef?.projectionKind !== 'doneRolling'
		&& parseDateKey(item.renderSnapshot.fieldValues['dateDue'] ?? '') !== null;
}

export function canTransferCalendarItemThroughDueLane(
	item: Pick<CalendarItem, 'origin' | 'repeatRef'> & {
		renderSnapshot: Pick<CalendarItem['renderSnapshot'], 'fieldValues'>;
	},
): boolean {
	const fields = item.renderSnapshot.fieldValues;
	return item.origin === 'materialized'
		&& item.repeatRef === null
		&& !(fields['repeatSeriesId'] ?? '').trim()
		&& !(fields['repeat'] ?? '').trim();
}

export function isCalendarDropDateBeforeStarted(targetDate: string, dateStarted = ''): boolean {
	const target = parseDateKey(targetDate);
	const started = parseDateKey(dateStarted);
	return !!target && !!started && target < started;
}

export function buildDueDateDropPayload(
	currentDate: string,
	targetDate: string,
	dateStarted = '',
): { dateDue: string } | null {
	const current = currentDate.trim();
	if ((current && !parseDateKey(current)) || !parseDateKey(targetDate) || current === targetDate) {
		return null;
	}
	if (isCalendarDropDateBeforeStarted(targetDate, dateStarted)) return null;
	return { dateDue: targetDate };
}

export function buildDueDateMovePayload(
	currentDate: string,
	targetDate: string,
	dateStarted = '',
): { dateDue: string } | null {
	if (!parseDateKey(currentDate)) return null;
	return buildDueDateDropPayload(currentDate, targetDate, dateStarted);
}

export function buildFinishedDateMovePayload(
	currentDate: string,
	targetDate: string,
): { dateCompleted: string } | null {
	if (!parseDateKey(currentDate) || !parseDateKey(targetDate) || currentDate === targetDate) {
		return null;
	}
	return { dateCompleted: targetDate };
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
