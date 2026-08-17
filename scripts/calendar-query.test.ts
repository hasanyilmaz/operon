import assert from 'node:assert/strict';
import type { RepeatSeriesEntry, RepeatTemporalTemplate } from '../src/storage/repeat-series-store';
import { queryCalendarItemsForVisibleDates } from '../src/systems/calendar-query';
import type { CalendarItem } from '../src/types/calendar';
import type { IndexedTask } from '../src/types/fields';
import { canEditAllDayCalendarItemPlacement } from '../src/ui/calendar/all-day-drag';

let assertions = 0;

function equal<T>(actual: T, expected: T, message?: string): void {
	assert.equal(actual, expected, message);
	assertions += 1;
}

function deepEqual(actual: unknown, expected: unknown, message?: string): void {
	assert.deepEqual(actual, expected, message);
	assertions += 1;
}

function task(
	operonId: string,
	fieldValues: Record<string, string>,
	checkbox: IndexedTask['checkbox'] = 'open',
): IndexedTask {
	return {
		operonId,
		description: operonId,
		checkbox,
		fieldValues,
		tags: [],
		primary: {
			filePath: 'Calendar query fixtures.md',
			lineNumber: Number.parseInt(operonId.replace(/\D/gu, ''), 10) || 0,
			format: 'inline',
		},
		datetimeModified: '2026-08-17T12:00:00',
		tier: checkbox === 'open' ? 'hot' : 'warm',
	};
}

function seriesEntry(
	seriesId: string,
	sourceTaskId: string,
	baseTemporalTemplate: RepeatTemporalTemplate | null = null,
): RepeatSeriesEntry {
	return {
		seriesId,
		sourceTaskId,
		sourceFormat: 'inline',
		baseTitle: null,
		lastMaterializedTitle: null,
		naming: null,
		skipDates: [],
		yamlPropertyValueRemovalConfigured: false,
		yamlPropertyValueRemovals: [],
		baseTemporalTemplate,
		inlineCompletionMode: 'keep-completed',
		createdAt: '2026-08-17T12:00:00',
		updatedAt: '2026-08-17T12:00:00',
		overrides: {
			single: {},
			following: [],
		},
	};
}

function itemsOfKind(items: CalendarItem[], kind: CalendarItem['kind']): CalendarItem[] {
	return items.filter(item => item.kind === kind);
}

function query(tasks: IndexedTask[], entries: RepeatSeriesEntry[] = [], showProjectedOccurrences = true) {
	return queryCalendarItemsForVisibleDates(
		tasks,
		['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21'],
		{ showProjectedOccurrences },
		entries,
		{ todayKey: '2026-08-17' },
	);
}

function assertSingletonRange(
	item: CalendarItem,
	kind: CalendarItem['kind'],
	date: string,
	origin: CalendarItem['origin'] = 'materialized',
): void {
	equal(item.kind, kind);
	equal(item.startDate, date);
	equal(item.endDate, date);
	equal(item.origin, origin);
}

async function run(): Promise<void> {
	const scheduledOnly = itemsOfKind(query([
		task('scheduled-1', { dateScheduled: '2026-08-18' }),
	]).items, 'allDayScheduled');
	equal(scheduledOnly.length, 1);
	assertSingletonRange(scheduledOnly[0], 'allDayScheduled', '2026-08-18');
	equal(canEditAllDayCalendarItemPlacement(scheduledOnly[0]), true);

	const startedOnly = itemsOfKind(query([
		task('started-1', { dateStarted: '2026-08-18' }),
	]).items, 'allDayScheduled');
	equal(startedOnly.length, 1);
	assertSingletonRange(startedOnly[0], 'allDayScheduled', '2026-08-18');
	equal(canEditAllDayCalendarItemPlacement(startedOnly[0]), false, 'started-only items must not expose unsupported move or resize controls');

	const blankCompetingFields = itemsOfKind(query([
		task('started-blank-1', {
			dateScheduled: '   ',
			dateStarted: '2026-08-18',
			dateDue: '',
		}),
	]).items, 'allDayScheduled');
	equal(blankCompetingFields.length, 1);
	assertSingletonRange(blankCompetingFields[0], 'allDayScheduled', '2026-08-18');
	equal(canEditAllDayCalendarItemPlacement(blankCompetingFields[0]), false);

	const startedAndDue = query([
		task('range-1', { dateStarted: '2026-08-18', dateDue: '2026-08-20' }),
	]).items;
	const rangeItems = itemsOfKind(startedAndDue, 'allDayScheduled');
	equal(rangeItems.length, 1);
	equal(rangeItems[0].startDate, '2026-08-18');
	equal(rangeItems[0].endDate, '2026-08-20');
	equal(canEditAllDayCalendarItemPlacement(rangeItems[0]), true);
	equal(itemsOfKind(startedAndDue, 'dueMarker').length, 1);

	const scheduledPrecedence = itemsOfKind(query([
		task('precedence-1', {
			dateScheduled: '2026-08-19',
			dateStarted: '2026-08-18',
		}),
	]).items, 'allDayScheduled');
	equal(scheduledPrecedence.length, 1);
	assertSingletonRange(scheduledPrecedence[0], 'allDayScheduled', '2026-08-19');

	const invalidRange = query([
		task('invalid-1', {
			dateStarted: '2026-08-20',
			dateDue: '2026-08-18',
		}),
	]).items;
	equal(itemsOfKind(invalidRange, 'allDayScheduled').length, 0);
	equal(itemsOfKind(invalidRange, 'dueMarker').length, 1);

	const malformedDue = query([
		task('malformed-due-1', {
			dateStarted: '2026-08-18',
			dateDue: 'not-a-date',
		}),
	]).items;
	equal(itemsOfKind(malformedDue, 'allDayScheduled').length, 0);
	equal(itemsOfKind(malformedDue, 'dueMarker').length, 0);

	const malformedScheduled = query([
		task('malformed-scheduled-1', {
			dateScheduled: 'not-a-date',
			dateStarted: '2026-08-18',
		}),
	]).items;
	equal(itemsOfKind(malformedScheduled, 'allDayScheduled').length, 0);

	const dueOnly = query([
		task('due-1', { dateDue: '2026-08-18' }),
	]).items;
	equal(itemsOfKind(dueOnly, 'allDayScheduled').length, 0);
	const dueMarkers = itemsOfKind(dueOnly, 'dueMarker');
	equal(dueMarkers.length, 1);
	assertSingletonRange(dueMarkers[0], 'dueMarker', '2026-08-18');

	const seriesId = 'rsi75zv';
	const rewardTasks = [
		task('reward-mon', {
			status: 'Task.Done',
			dateCompleted: '2026-08-17',
			repeat: 'mode=done|freq=day|interval=1',
			repeatSeriesId: seriesId,
			repeatOccurrenceDate: '2026-08-17',
		}, 'done'),
		task('316647b', {
			status: 'Task.Open',
			priority: 'C',
			dateStarted: '2026-08-18',
			repeat: 'mode=done|freq=day|interval=1',
			repeatSeriesId: seriesId,
			repeatOccurrenceDate: '2026-08-18',
		}, 'open'),
	];
	const allDayTemplate: RepeatTemporalTemplate = {
		mode: 'allDay',
		dateShiftDays: 0,
		startDateShiftDays: 0,
		endDateShiftDays: 0,
		startTime: null,
		endTime: null,
		estimate: null,
	};
	const rewardEntry = seriesEntry(seriesId, 'reward-mon', allDayTemplate);
	const rewardResult = query(rewardTasks, [rewardEntry]);
	const rewardItems = itemsOfKind(rewardResult.items, 'allDayScheduled');
	deepEqual(
		rewardItems.map(item => [item.startDate, item.origin, item.repeatRef?.occurrenceDate]),
		[
			['2026-08-18', 'materialized', '2026-08-18'],
			['2026-08-19', 'projected', '2026-08-19'],
			['2026-08-20', 'projected', '2026-08-20'],
			['2026-08-21', 'projected', '2026-08-21'],
		],
	);
	equal(rewardItems.filter(item => item.startDate === '2026-08-18').length, 1, 'Tuesday must not be duplicated');
	equal(rewardItems.find(item => item.startDate === '2026-08-18')?.sourceTask?.checkbox, 'open');
	deepEqual(
		rewardItems.filter(item => item.origin === 'projected').map(item => item.repeatRef?.projectionKind),
		['doneRolling', 'doneRolling', 'doneRolling'],
	);
	equal(itemsOfKind(rewardResult.items, 'finishedMarker').length, 1);

	const rewardWithoutProjections = itemsOfKind(
		query(rewardTasks, [rewardEntry], false).items,
		'allDayScheduled',
	);
	deepEqual(
		rewardWithoutProjections.map(item => [item.startDate, item.origin]),
		[
			['2026-08-18', 'materialized'],
		],
	);

	const timedSeriesId = 'rsn0hm4';
	const timedRecurrence = query([
		task('meditate-completed', {
			status: 'Task.Done',
			dateCompleted: '2026-08-17',
			dateScheduled: '2026-08-17',
			datetimeStart: '2026-08-17T08:45:00',
			datetimeEnd: '2026-08-17T09:00:00',
			repeat: 'mode=done|freq=day|interval=1',
			repeatSeriesId: timedSeriesId,
			repeatOccurrenceDate: '2026-08-17',
		}, 'done'),
		task('359cc8d', {
			status: 'Task.Open',
			dateScheduled: '2026-08-18',
			datetimeStart: '2026-08-18T08:45:00',
			datetimeEnd: '2026-08-18T09:00:00',
			estimate: '900',
			repeat: 'mode=done|freq=day|interval=1',
			repeatSeriesId: timedSeriesId,
			repeatOccurrenceDate: '2026-08-18',
		}),
	], [seriesEntry(timedSeriesId, 'meditate-completed', {
		mode: 'timed',
		dateShiftDays: 0,
		startDateShiftDays: 0,
		endDateShiftDays: 0,
		startTime: '08:45:00',
		endTime: '09:00:00',
		estimate: '900',
	})]);
	const timedRecurrenceItems = itemsOfKind(timedRecurrence.items, 'timed');
	deepEqual(
		timedRecurrenceItems
			.filter(item => item.origin === 'projected' || item.sourceTask?.checkbox === 'open')
			.map(item => [
			item.startDateTime,
			item.origin,
			item.repeatRef?.occurrenceDate,
			]),
		[
			['2026-08-18T08:45:00', 'materialized', '2026-08-18'],
			['2026-08-19T08:45:00', 'projected', '2026-08-19'],
			['2026-08-20T08:45:00', 'projected', '2026-08-20'],
			['2026-08-21T08:45:00', 'projected', '2026-08-21'],
		],
		'The uniquely indexed timed successor must materialize once and drive later projections.',
	);
	equal(
		timedRecurrenceItems.find(item => item.startDate === '2026-08-18')?.sourceTask?.checkbox,
		'open',
		'The materialized timed successor must be open.',
	);
	equal(
		timedRecurrenceItems.filter(item => item.startDate === '2026-08-18').length,
		1,
		'The materialized timed successor must not be duplicated.',
	);

	const timed = query([
		task('359cc8d', {
			dateScheduled: '2026-08-18',
			datetimeStart: '2026-08-18T08:45:00',
			datetimeEnd: '2026-08-18T09:00:00',
			estimate: '900',
		}),
	]).items;
	const timedItems = itemsOfKind(timed, 'timed');
	equal(timedItems.length, 1);
	equal(timedItems[0].startDateTime, '2026-08-18T08:45:00');
	equal(timedItems[0].endDateTime, '2026-08-18T09:00:00');
	equal(itemsOfKind(timed, 'allDayScheduled').length, 0);

	const estimated = query([
		task('estimated-1', {
			dateScheduled: '2026-08-18',
			datetimeStart: '2026-08-18T08:45:00',
			estimate: '900',
		}),
	]).items;
	const estimatedItems = itemsOfKind(estimated, 'timed');
	equal(estimatedItems.length, 1);
	equal(estimatedItems[0].startDateTime, '2026-08-18T08:45:00');
	equal(estimatedItems[0].endDateTime, '2026-08-18T09:00:00');
	equal(itemsOfKind(estimated, 'allDayScheduled').length, 0);

	console.log(`Calendar query tests passed: ${assertions} assertions`);
}

declare global {
	var __operonCalendarQueryTestRun: Promise<void> | undefined;
}

globalThis.__operonCalendarQueryTestRun = run();
