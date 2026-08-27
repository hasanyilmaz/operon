import assert from 'node:assert/strict';
import {
	buildGanttDateAxis,
	diffGanttDateKeys,
	ganttDateKeyToOrdinal,
	ganttDateToX,
	ganttOrdinalToDateKey,
	ganttXToDate,
	getGanttInclusiveBarWidthPx,
	normalizeGanttDateKey,
	normalizeGanttScale,
	normalizeGanttUnitWidthMultiplier,
	projectTaskToGantt,
	shiftGanttDateKey,
} from '../src/systems/gantt-core';
import { GANTT_UNIT_WIDTH_MULTIPLIERS, type GanttScale, type GanttWeekStart } from '../src/types/gantt';
import type { IndexedTask } from '../src/types/fields';

let assertions = 0;

function equal<T>(actual: T, expected: T, message?: string): void {
	assert.equal(actual, expected, message);
	assertions += 1;
}

function deepEqual(actual: unknown, expected: unknown, message?: string): void {
	assert.deepEqual(actual, expected, message);
	assertions += 1;
}

function task(id: string, fieldValues: Record<string, string>): IndexedTask {
	return {
		operonId: id,
		description: id,
		checkbox: 'open',
		fieldValues,
		tags: [],
		primary: { filePath: 'Gantt fixtures.md', lineNumber: 1, format: 'inline' },
		datetimeModified: '2026-08-26T12:00:00',
		tier: 'hot',
	};
}

function axis(
	startDate: string,
	endDate: string,
	scale: GanttScale = 'week',
	weekStart: GanttWeekStart = 'monday',
	baseDayWidthPx = 20,
	unitWidthMultiplier: 0.75 | 1 | 1.25 | 1.5 = 1,
) {
	const result = buildGanttDateAxis({
		startDate,
		endDate,
		scale,
		weekStart,
		baseDayWidthPx,
		unitWidthMultiplier,
	});
	assert.ok(result, `Expected a valid Gantt axis for ${startDate}..${endDate}`);
	assertions += 1;
	return result;
}

async function run(): Promise<void> {
	equal(normalizeGanttDateKey('2024-02-29'), '2024-02-29');
	equal(normalizeGanttDateKey('2025-02-29'), '');
	equal(normalizeGanttDateKey('2026-13-01'), '');
	equal(normalizeGanttDateKey(' 2026-08-26 '), '2026-08-26');
	equal(shiftGanttDateKey('2024-02-28', 2), '2024-03-01');
	equal(diffGanttDateKeys('2026-03-28', '2026-03-30'), 2, 'DST boundaries must remain whole-day arithmetic');
	const ordinal = ganttDateKeyToOrdinal('2026-10-25');
	assert.notEqual(ordinal, null);
	assertions += 1;
	equal(ganttOrdinalToDateKey(ordinal!), '2026-10-25');
	equal(normalizeGanttScale('month'), 'month');
	equal(normalizeGanttScale('quarter'), 'week');
	equal(normalizeGanttUnitWidthMultiplier(1.5), 1.5);
	equal(normalizeGanttUnitWidthMultiplier(2), 1);

	const range = projectTaskToGantt(task('range', {
		dateStarted: '2026-08-18',
		dateDue: '2026-08-20',
		dateScheduled: '2026-08-19',
		datetimeStart: '2026-08-17T09:00:00',
		datetimeEnd: '2026-08-21T10:00:00',
	}));
	deepEqual(range.bar, {
		kind: 'all-day-range',
		startDate: '2026-08-18',
		endDate: '2026-08-20',
		startDateTime: null,
		endDateTime: null,
	});
	deepEqual(range.deadline, { date: '2026-08-20' });
	deepEqual(range.markers, [
		{ key: 'dateStarted', date: '2026-08-18' },
		{ key: 'dateScheduled', date: '2026-08-19' },
		{ key: 'dateDue', date: '2026-08-20' },
	], 'all canonical date markers remain available on multi-day ranges');

	const timed = projectTaskToGantt(task('timed', {
		dateScheduled: '2026-08-21',
		datetimeStart: '2026-08-18T23:30:00',
		datetimeEnd: '2026-08-19T01:00:00',
	}));
	equal(timed.bar?.kind, 'timed');
	equal(timed.bar?.startDate, '2026-08-18');
	equal(timed.bar?.endDate, '2026-08-19');
	equal(timed.bar?.startDateTime, '2026-08-18T23:30:00');
	equal(timed.bar?.endDateTime, '2026-08-19T01:00:00');

	const estimated = projectTaskToGantt(task('estimated', {
		datetimeStart: '2026-08-18T23:45:00',
		estimate: '1800',
	}));
	equal(estimated.bar?.kind, 'timed');
	equal(estimated.bar?.startDate, '2026-08-18');
	equal(estimated.bar?.endDate, '2026-08-19');
	equal(estimated.bar?.endDateTime, '2026-08-19T00:15:00');

	const scheduledDue = projectTaskToGantt(task('scheduled-due', {
		dateScheduled: '2026-08-18',
		dateDue: '2026-08-22',
	}));
	equal(scheduledDue.bar?.kind, 'scheduled');
	equal(scheduledDue.bar?.startDate, '2026-08-18');
	equal(scheduledDue.bar?.endDate, '2026-08-18');
	deepEqual(scheduledDue.deadline, { date: '2026-08-22' });
	deepEqual(scheduledDue.markers, [
		{ key: 'dateScheduled', date: '2026-08-18' },
		{ key: 'dateDue', date: '2026-08-22' },
	]);

	const dueOnly = projectTaskToGantt(task('due-only', { dateDue: '2026-08-20' }));
	equal(dueOnly.bar, null);
	deepEqual(dueOnly.deadline, { date: '2026-08-20' });
	deepEqual(dueOnly.markers, [{ key: 'dateDue', date: '2026-08-20' }]);
	const startedOnly = projectTaskToGantt(task('started-only', { dateStarted: '2026-08-18' }));
	equal(startedOnly.bar, null);
	equal(startedOnly.deadline, null);
	deepEqual(startedOnly.markers, [{ key: 'dateStarted', date: '2026-08-18' }]);
	const singleDayRange = projectTaskToGantt(task('single-day-range', {
		dateStarted: '2026-08-18',
		dateDue: '2026-08-18',
		dateScheduled: '2026-08-18',
	}));
	deepEqual(singleDayRange.markers, [
		{ key: 'dateStarted', date: '2026-08-18' },
		{ key: 'dateScheduled', date: '2026-08-18' },
		{ key: 'dateDue', date: '2026-08-18' },
	]);

	const reversedFallback = projectTaskToGantt(task('reversed', {
		dateStarted: '2026-08-20',
		dateDue: '2026-08-18',
		dateScheduled: '2026-08-19',
	}));
	equal(reversedFallback.bar?.kind, 'scheduled');
	deepEqual(reversedFallback.deadline, { date: '2026-08-18' });
	deepEqual(reversedFallback.markers, [
		{ key: 'dateStarted', date: '2026-08-20' },
		{ key: 'dateScheduled', date: '2026-08-19' },
		{ key: 'dateDue', date: '2026-08-18' },
	]);
	const invalidTimedFallback = projectTaskToGantt(task('invalid-timed', {
		dateScheduled: '2026-08-19',
		datetimeStart: '2026-08-20T10:00:00',
		datetimeEnd: '2026-08-19T10:00:00',
	}));
	equal(invalidTimedFallback.bar?.kind, 'scheduled');
	const invalidTimeFallback = projectTaskToGantt(task('invalid-time', {
		dateScheduled: '2026-08-19',
		datetimeStart: '2026-08-18T99:00:00',
		datetimeEnd: '2026-08-18T99:30:00',
	}));
	equal(invalidTimeFallback.bar?.kind, 'scheduled');
	const optionalSeconds = projectTaskToGantt(task('optional-seconds', {
		datetimeStart: '2026-08-18T09:00',
		datetimeEnd: '2026-08-18T10:00',
	}));
	equal(optionalSeconds.bar?.startDateTime, '2026-08-18T09:00:00');
	equal(optionalSeconds.bar?.endDateTime, '2026-08-18T10:00:00');
	const malformed = projectTaskToGantt(task('malformed', {
		dateStarted: '2026-02-30',
		dateDue: 'not-a-date',
		dateScheduled: '2025-02-29',
		datetimeStart: '2026-13-01T10:00:00',
		estimate: '900',
	}));
	equal(malformed.bar, null);
	equal(malformed.deadline, null);
	deepEqual(malformed.markers, []);

	const leapAxis = axis('2024-02-28', '2024-03-01', 'day', 'monday', 20, 1.25);
	equal(leapAxis.days.length, 3);
	deepEqual(leapAxis.days.map(day => day.date), ['2024-02-28', '2024-02-29', '2024-03-01']);
	equal(leapAxis.dayWidthPx, 25);
	equal(leapAxis.totalWidthPx, 75);
	equal(leapAxis.days.every(day => day.width === 25), true);
	equal(leapAxis.headerGroups.length, 3);
	deepEqual(leapAxis.contextHeaderGroups.map(group => [group.unit, group.startDate, group.endDate]), [
		['week', '2024-02-28', '2024-03-01'],
	]);
	equal(ganttDateToX(leapAxis, '2024-02-28'), 0);
	equal(ganttDateToX(leapAxis, '2024-02-29'), 25);
	equal(ganttDateToX(leapAxis, '2024-03-02'), null);
	equal(ganttXToDate(leapAxis, -5), '2024-02-28');
	equal(ganttXToDate(leapAxis, 24.999), '2024-02-28');
	equal(ganttXToDate(leapAxis, 25), '2024-02-29');
	equal(ganttXToDate(leapAxis, 75), '2024-03-01');
	equal(ganttXToDate(leapAxis, Number.NaN), null);
	equal(getGanttInclusiveBarWidthPx(leapAxis, '2024-02-28', '2024-03-01'), 75);
	equal(getGanttInclusiveBarWidthPx(leapAxis, '2024-03-01', '2024-02-28'), null);

	const mondayWeeks = axis('2026-08-16', '2026-08-18', 'week', 'monday');
	deepEqual(mondayWeeks.headerGroups.map(group => [group.startDate, group.endDate, group.dayCount]), [
		['2026-08-16', '2026-08-16', 1],
		['2026-08-17', '2026-08-18', 2],
	]);
	deepEqual(mondayWeeks.contextHeaderGroups.map(group => [group.unit, group.startDate, group.endDate]), [
		['month', '2026-08-16', '2026-08-18'],
	]);
	const sundayWeeks = axis('2026-08-15', '2026-08-17', 'week', 'sunday');
	deepEqual(sundayWeeks.headerGroups.map(group => [group.startDate, group.endDate, group.dayCount]), [
		['2026-08-15', '2026-08-15', 1],
		['2026-08-16', '2026-08-17', 2],
	]);
	const months = axis('2026-01-30', '2026-02-02', 'month');
	deepEqual(months.headerGroups.map(group => [group.startDate, group.endDate, group.dayCount, group.width]), [
		['2026-01-30', '2026-01-31', 2, 40],
		['2026-02-01', '2026-02-02', 2, 40],
	]);
	deepEqual(months.contextHeaderGroups.map(group => [group.unit, group.startDate, group.endDate]), [
		['quarter', '2026-01-30', '2026-02-02'],
	]);
	const quarterBoundary = axis('2026-03-31', '2026-04-01', 'month');
	deepEqual(quarterBoundary.contextHeaderGroups.map(group => [group.unit, group.startDate, group.endDate]), [
		['quarter', '2026-03-31', '2026-03-31'],
		['quarter', '2026-04-01', '2026-04-01'],
	]);
	const yearBoundary = axis('2026-12-31', '2027-01-01', 'month');
	deepEqual(yearBoundary.contextHeaderGroups.map(group => [group.unit, group.startDate, group.endDate]), [
		['quarter', '2026-12-31', '2026-12-31'],
		['quarter', '2027-01-01', '2027-01-01'],
	]);
	for (const multiplier of GANTT_UNIT_WIDTH_MULTIPLIERS) {
		const scaled = axis('2026-08-17', '2026-08-18', 'day', 'monday', 40, multiplier);
		equal(scaled.dayWidthPx, 40 * multiplier);
		equal(scaled.totalWidthPx, 80 * multiplier);
	}

	equal(buildGanttDateAxis({
		startDate: '2026-08-20',
		endDate: '2026-08-18',
		scale: 'week',
		weekStart: 'monday',
		baseDayWidthPx: 20,
		unitWidthMultiplier: 1,
	}), null);
	equal(buildGanttDateAxis({
		startDate: '2026-08-18',
		endDate: '2026-08-20',
		scale: 'week',
		weekStart: 'monday',
		baseDayWidthPx: 0,
		unitWidthMultiplier: 1,
	}), null);

	console.log(`Gantt core tests passed (${assertions} assertions).`);
}

declare global {
	var __operonGanttCoreTestRun: Promise<void> | undefined;
}

globalThis.__operonGanttCoreTestRun = run();
