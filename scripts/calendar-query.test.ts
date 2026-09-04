import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { RepeatSeriesEntry, RepeatTemporalTemplate } from '../src/storage/repeat-series-store';
import { queryCalendarItemsForVisibleDates } from '../src/systems/calendar-query';
import type { CalendarItem } from '../src/types/calendar';
import type { IndexedTask } from '../src/types/fields';
import {
	buildDueDateDropPayload,
	buildDueDateMovePayload,
	canEditAllDayCalendarItemPlacement,
	canResizeAllDayCalendarItemPlacement,
	canEditDueCalendarItemPlacement,
	canTransferCalendarItemThroughDueLane,
	isCalendarDropDateBeforeStarted,
} from '../src/ui/calendar/all-day-drag';
import {
	buildAllDayCalendarWritebackPlanForExistingTask,
	buildAllDayMoveWritebackPlan,
	buildAllDayResizeRightWritebackPlan,
	buildAllDaySlotSelection,
	buildTimedCalendarWritebackPlanForDueLaneTransfer,
	buildTimedCalendarWritebackPlanForExistingCalendarAssignment,
	buildTimedSlotSelection,
	isExpandedAllDayRange,
} from '../src/systems/calendar-writeback';
import { buildCalendarHiddenTimeOptions } from '../src/ui/calendar/calendar-hidden-time-options';
import { activateI18nLocale, installI18nLocale, resetI18nToEnglish, t } from '../src/core/i18n';
import ptBrLocale from '../i18n/locales/pt-BR.json';

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
	deepEqual(
		buildCalendarHiddenTimeOptions({
			boundary: 'start',
			currentValue: '00:00',
			otherValue: '02:00',
		}).map(option => option.value),
		['00:00', '00:30', '01:00', '01:30'],
		'Hidden-time start options use 30-minute steps and remain before the end.',
	);
	deepEqual(
		buildCalendarHiddenTimeOptions({
			boundary: 'end',
			currentValue: '23:59',
			otherValue: '22:30',
		}).map(option => option.value),
		['23:00', '23:30', '23:59'],
		'Hidden-time end options use 30-minute steps and expose the end-of-day boundary.',
	);
	deepEqual(
		buildCalendarHiddenTimeOptions({
			boundary: 'end',
			currentValue: '06:15',
			otherValue: '05:30',
		}).map(option => option.value).filter(value => value.startsWith('06:')),
		['06:00', '06:15', '06:30'],
		'An existing quarter-hour value remains selectable without adding new quarter-hour choices.',
	);
	for (const sourcePath of [
		'src/ui/settings-tab.ts',
		'src/ui/calendar/calendar-preset-quick-settings-modal.ts',
	]) {
		const source = readFileSync(sourcePath, 'utf8');
		equal(source.includes('showTimePicker'), false, `${sourcePath} must not restore writable hidden-time inputs.`);
		equal(source.includes('buildCalendarHiddenTimeOptions'), true, `${sourcePath} must use the guarded dropdown options.`);
	}

	installI18nLocale('pt-BR', ptBrLocale);
	equal(activateI18nLocale('pt-BR'), true);
	equal(
		t('calendar', 'taskPoolSummary', {
			visible: '3',
			total: '8',
			mode: t('calendar', 'open'),
			taskWord: t('calendar', 'taskPlural'),
		}),
		'Modificadas recentemente: 3 de 8 tarefas · Em aberto',
	);
	equal(
		t('calendar', 'taskPoolFinishedSummary', {
			visible: '1',
			total: '1',
			date: '18 de março',
			taskWord: t('calendar', 'taskSingular'),
		}),
		'Conclusão em 18 de março: 1 de 1 tarefa',
	);
	resetI18nToEnglish();
	equal(t('notifications', 'calendarDropBeforeStart'), "The selected date cannot be earlier than the task's start date.");

	const scheduledOnly = itemsOfKind(query([
		task('scheduled-1', { dateScheduled: '2026-08-18' }),
	]).items, 'allDayScheduled');
	equal(scheduledOnly.length, 1);
	assertSingletonRange(scheduledOnly[0], 'allDayScheduled', '2026-08-18');
	equal(canEditAllDayCalendarItemPlacement(scheduledOnly[0]), true);
	equal(canResizeAllDayCalendarItemPlacement(scheduledOnly[0]), true);

	const startedOnly = itemsOfKind(query([
		task('started-1', { dateStarted: '2026-08-18' }),
	]).items, 'allDayScheduled');
	equal(startedOnly.length, 1);
	assertSingletonRange(startedOnly[0], 'allDayScheduled', '2026-08-18');
	equal(canEditAllDayCalendarItemPlacement(startedOnly[0]), false, 'started-only items must not expose unsupported move or resize controls');
	equal(canResizeAllDayCalendarItemPlacement(startedOnly[0]), false);

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
	equal(canEditAllDayCalendarItemPlacement(rangeItems[0]), false, 'independent started/due ranges must remain read-only in the all-day lane');
	equal(canResizeAllDayCalendarItemPlacement(rangeItems[0]), false);
	equal(itemsOfKind(startedAndDue, 'dueMarker').length, 1);

	const managedRange = itemsOfKind(query([
		task('managed-range-1', {
			dateScheduled: '2026-08-18',
			dateStarted: '2026-08-18',
			dateDue: '2026-08-20',
		}),
	]).items, 'allDayScheduled');
	equal(managedRange.length, 1);
	equal(isExpandedAllDayRange(managedRange[0].renderSnapshot.fieldValues), true);
	equal(canEditAllDayCalendarItemPlacement(managedRange[0]), true);
	equal(canResizeAllDayCalendarItemPlacement(managedRange[0]), true);

	const independentDates = itemsOfKind(query([
		task('independent-7-8-9', {
			dateStarted: '2026-08-17',
			dateScheduled: '2026-08-18',
			dateDue: '2026-08-19',
		}),
	]).items, 'allDayScheduled');
	equal(independentDates.length, 1);
	equal(independentDates[0].startDate, '2026-08-17');
	equal(independentDates[0].endDate, '2026-08-19');
	equal(isExpandedAllDayRange(independentDates[0].renderSnapshot.fieldValues), false);
	equal(canEditAllDayCalendarItemPlacement(independentDates[0]), false);
	equal(canResizeAllDayCalendarItemPlacement(independentDates[0]), false);

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
	equal(canEditDueCalendarItemPlacement(dueMarkers[0]), true);
	equal(canEditDueCalendarItemPlacement({
		...dueMarkers[0],
		origin: 'external',
	}), false);
	equal(canEditDueCalendarItemPlacement({
		...dueMarkers[0],
		renderSnapshot: {
			...dueMarkers[0].renderSnapshot,
			fieldValues: { ...dueMarkers[0].renderSnapshot.fieldValues, dateDue: 'not-a-date' },
		},
	}), false);
	equal(canTransferCalendarItemThroughDueLane(dueMarkers[0]), true);
	equal(canTransferCalendarItemThroughDueLane({ ...dueMarkers[0], origin: 'external' }), false);
	equal(canTransferCalendarItemThroughDueLane({
		...dueMarkers[0],
		repeatRef: {
			seriesId: 'series-1',
			occurrenceDate: '2026-08-18',
			isLatestMaterialized: true,
			isProjected: false,
			projectionKind: 'scheduled',
		},
	}), false);
	equal(canTransferCalendarItemThroughDueLane({
		...dueMarkers[0],
		renderSnapshot: {
			...dueMarkers[0].renderSnapshot,
			fieldValues: { ...dueMarkers[0].renderSnapshot.fieldValues, repeat: 'malformed recurrence' },
		},
	}), false);
	equal(isCalendarDropDateBeforeStarted('2026-08-16', '2026-08-17'), true);
	equal(isCalendarDropDateBeforeStarted('2026-08-17', '2026-08-17'), false);
	deepEqual(buildDueDateDropPayload('', '2026-08-20'), { dateDue: '2026-08-20' });
	deepEqual(buildDueDateDropPayload('2026-08-18', '2026-08-20'), { dateDue: '2026-08-20' });
	equal(buildDueDateDropPayload('', '2026-08-16', '2026-08-17'), null);
	equal(buildDueDateDropPayload('not-a-date', '2026-08-20'), null);
	deepEqual(buildDueDateMovePayload('2026-08-18', '2026-08-20'), { dateDue: '2026-08-20' });
	equal(buildDueDateMovePayload('2026-08-18', '2026-08-18'), null);
	equal(buildDueDateMovePayload('2026-08-18', '2026-08-16', '2026-08-17'), null);
	deepEqual(buildDueDateMovePayload('2026-08-18', '2026-08-17', '2026-08-17'), { dateDue: '2026-08-17' });
	const dueToTimedPlan = buildTimedCalendarWritebackPlanForDueLaneTransfer(
		buildTimedSlotSelection('2026-08-20', 9 * 60, 9 * 60 + 15),
		{
			dateDue: '2026-08-22',
			dateStarted: '2026-08-17',
			estimate: '5400',
		},
	);
	equal(dueToTimedPlan.payload.dateScheduled, '2026-08-20');
	equal(dueToTimedPlan.payload.datetimeStart, '2026-08-20T09:00:00');
	equal(dueToTimedPlan.payload.datetimeEnd, '2026-08-20T10:30:00');
	equal(dueToTimedPlan.payload.estimate, '5400');
	equal('dateDue' in dueToTimedPlan.payload, false);
	equal('dateStarted' in dueToTimedPlan.payload, false);

	const independentTimedPlan = buildTimedCalendarWritebackPlanForExistingCalendarAssignment(
		buildTimedSlotSelection('2026-08-20', 9 * 60, 9 * 60 + 15),
		{
			dateStarted: '2026-08-17',
			dateScheduled: '2026-08-18',
			dateDue: '2026-08-19',
			datetimeStart: '2026-08-18T09:00:00',
			datetimeEnd: '2026-08-18T10:30:00',
			estimate: '5400',
		},
		{ preserveExistingDuration: true },
	);
	deepEqual(independentTimedPlan.payload, {
		dateScheduled: '2026-08-20',
		datetimeStart: '2026-08-20T09:00:00',
		datetimeEnd: '2026-08-20T10:30:00',
		estimate: '5400',
	});

	deepEqual(
		buildAllDayCalendarWritebackPlanForExistingTask(
			buildAllDaySlotSelection('2026-08-20', '2026-08-20'),
			{
				dateStarted: '2026-08-17',
				dateScheduled: '2026-08-18',
				dateDue: '2026-08-19',
				datetimeStart: '2026-08-18T09:00:00',
				datetimeEnd: '2026-08-18T10:30:00',
			},
		).payload,
		{
			dateScheduled: '2026-08-20',
			datetimeStart: '',
			datetimeEnd: '',
		},
	);

	const managedRangeToTimed = buildTimedCalendarWritebackPlanForExistingCalendarAssignment(
		buildTimedSlotSelection('2026-08-20', 9 * 60, 9 * 60 + 15),
		{
			dateStarted: '2026-08-18',
			dateScheduled: '2026-08-18',
			dateDue: '2026-08-19',
		},
	);
	equal(managedRangeToTimed.payload.dateStarted, '');
	equal(managedRangeToTimed.payload.dateDue, '');

	deepEqual(
		buildAllDayMoveWritebackPlan({
			dateStarted: '2026-08-17',
			dateScheduled: '2026-08-18',
			dateDue: '2026-08-19',
		}, '2026-08-20').payload,
		{ dateScheduled: '2026-08-20' },
	);
	deepEqual(
		buildAllDayResizeRightWritebackPlan({
			dateStarted: '2026-08-17',
			dateScheduled: '2026-08-18',
			dateDue: '2026-08-19',
		}, '2026-08-21').payload,
		{},
	);

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

	const calendarSource = readFileSync('src/ui/calendar/calendar-view.ts', 'utf8');
	const mainSource = readFileSync('main.ts', 'utf8');
	const calendarStyles = readFileSync('styles.css', 'utf8');
	equal(calendarSource.includes("ownerWindow.addEventListener('pointerdown', onPointerDown, true)"), true);
	equal(calendarSource.includes("ownerDocument.addEventListener('visibilitychange', onVisibilityChange, true)"), true);
	equal(calendarSource.includes('scrollTimedSurfaceBy(pending.previousClientY - moveEvent.clientY)'), true);
	equal(calendarSource.includes("pending.mode = 'scrolling';"), true);
	equal(calendarSource.includes("block.closest<HTMLElement>('.operon-calendar-mobile-timegrid-viewport, .operon-calendar-surface-scroll')"), true);
	equal(calendarSource.includes("if (isMobileTimeGridItem || settings.calendarTouchTimeGridTaskMoveEnabled !== false) {\n\t\t\tblock.addClass('is-touch-arbitrated');"), true);
	equal(calendarSource.includes("if (!startDragFromPointer(pointerId, pending.latestClientX, pending.latestClientY, 'move'"), true);
	equal(calendarSource.includes('startPendingTouch(event, !target?.closest'), true);
	equal(calendarSource.includes("row.closest<HTMLElement>('.operon-calendar-sidebar-task-pool-list')"), true);
	equal(calendarSource.includes('scheduleTouchAutoScroll(event.clientX, event.clientY)'), true);
	equal(calendarSource.includes('resolveMultiWeekAllDayDropTarget(clientX, clientY)'), true);
	equal(calendarSource.includes('resolveMultiWeekInDayDropTarget(clientX, clientY)'), true);
	equal(calendarSource.includes('startDragState(event.pointerId, event.clientX, event.clientY, false)'), true);
	equal(calendarStyles.includes('.operon-calendar-sidebar-task-pool-row {\n\t--operon-calendar-sidebar-task-pool-row-accent: var(--operon-calendar-accent, var(--interactive-accent));\n\ttouch-action: none;'), true);
	equal(calendarStyles.includes('.operon-calendar-timed-item.is-draggable.is-touch-arbitrated {\n\ttouch-action: none;'), true);

	const touchSessionSource = readFileSync('src/ui/touch-drag-session.ts', 'utf8');
	equal(touchSessionSource.includes('export function beginLongPressTouchGesture'), true);
	equal(touchSessionSource.includes('Math.hypot(latestX - initialX, latestY - initialY) > cancelDistancePx'), true);
	equal(touchSessionSource.includes("ownerWindow.addEventListener('pointerdown', onPointerDown, true)"), true);
	equal(touchSessionSource.includes("ownerDocument.addEventListener('visibilitychange', onVisibilityChange, true)"), true);
	equal(touchSessionSource.includes('scrolling || !target.isConnected'), true);
	equal(touchSessionSource.includes('export function createVerticalTouchAutoScroll'), true);
	equal(calendarSource.includes('private bindMultiWeekInDayItemInteraction('), true);
	equal(calendarSource.includes("onActivate: (pointerId, clientX, clientY) => startDrag(pointerId, clientX, clientY, 'move', true, true)"), true);
	equal(calendarSource.includes("if (mode !== 'move') {"), true);
	equal(calendarSource.includes('trackedTouchAutoScroll.stop()'), true);
	equal(calendarSource.includes('timedTouchAutoScroll.stop()'), true);
	equal(calendarSource.includes("itemEl.addClass('is-touch-arbitrated')"), true);
	equal(calendarSource.includes('private bindDateMarkerAllDayItemInteraction('), true);
	equal(calendarSource.includes('this.multiWeekDueDropContexts'), true);
	equal(calendarSource.includes('this.callbacks.onDueItemMove?.(placement.item.taskId, payload.dateDue)'), true);
	equal(calendarSource.includes('this.callbacks.onDueItemDropToTimed?.(placement.item.taskId, timedSelection)'), true);
	equal(calendarSource.includes('this.callbacks.onTimedItemDropToDue?.(placement.item.taskId, payload.dateDue)'), true);
	equal(calendarSource.includes('dragState.targetDate = inDayTarget.dateKey'), true);
	equal(calendarSource.includes("new Notice(t('notifications', 'calendarDropBeforeStart'))"), true);
	equal(calendarSource.includes('if (options.verifyOptimisticPatchAfterWrite === false) return;'), true);
	equal(calendarSource.includes('verifyOptimisticPatchAfterWrite: isMobileTimeGridItem'), false);
	equal(calendarSource.includes('buildAllDayCalendarWritebackPlanForExistingTask('), true);
	equal(mainSource.includes('private async handleCalendarDueMove('), true);
	equal(mainSource.includes('private async handleCalendarDueDropToTimed('), true);
equal(mainSource.includes('private async handleCalendarTimedDropToDue('), true);
equal(mainSource.includes('private isCalendarDueCrossLaneTask('), true);
equal(mainSource.includes("&& !(task.fieldValues['repeat'] ?? '').trim()"), true);
equal(mainSource.includes("changedKeys: ['dateDue']"), true);
	equal(mainSource.includes("this.applyLatestMaterializedCalendarTemporalEdit(task, payload, ['dateDue'])"), true);
	const timedMutationSource = mainSource.slice(
		mainSource.indexOf('private async handleCalendarTimedMove('),
		mainSource.indexOf('private resolveTrackedSessionByRange('),
	);
	equal(timedMutationSource.includes("payload.dateStarted = ''"), false);
	equal(mainSource.includes('buildTimedCalendarWritebackPlanForExistingCalendarAssignment(selection, task.fieldValues'), true);
	equal(mainSource.includes('buildAllDayCalendarWritebackPlanForExistingTask(selection, task.fieldValues'), true);
	equal(calendarStyles.includes('.operon-calendar-all-day-item.is-touch-arbitrated,'), true);
	equal(calendarStyles.includes('.operon-calendar-all-day-item.is-date-marker-draggable {'), true);
	equal(calendarStyles.includes('.operon-calendar-multi-week-inday-item.is-touch-arbitrated {'), true);

	console.log(`Calendar query tests passed: ${assertions} assertions`);
}

declare global {
	var __operonCalendarQueryTestRun: Promise<void> | undefined;
}

globalThis.__operonCalendarQueryTestRun = run();
