import assert from 'node:assert/strict';
import type { IndexedTask } from '../src/types/fields';
import { buildTableGanttDescendantShiftPlan } from '../src/ui/table/table-gantt-descendant-shift';

let assertions = 0;

function equal<T>(actual: T, expected: T, message?: string): void {
	if (message) assert.equal(actual, expected, message);
	else assert.equal(actual, expected);
	assertions += 1;
}

function deepEqual(actual: unknown, expected: unknown, message?: string): void {
	if (message) assert.deepEqual(actual, expected, message);
	else assert.deepEqual(actual, expected);
	assertions += 1;
}

function task(
	id: string,
	fieldValues: Record<string, string> = {},
	checkbox: IndexedTask['checkbox'] = 'open',
): IndexedTask {
	return {
		operonId: id,
		description: id,
		checkbox,
		fieldValues,
		tags: [],
		primary: { filePath: `${id}.md`, lineNumber: 1, format: 'inline' },
		datetimeModified: '2026-08-27T12:00:00',
		tier: 'hot',
	};
}

function plan(
	tasks: readonly IndexedTask[],
	deltaDays: number,
	options: {
		directChildIds?: string[];
		descendantIds?: string[];
		duplicateIds?: string[];
		recurringIds?: string[];
		hasHierarchyCycle?: boolean;
	} = {},
) {
	const byId = new Map([task('parent'), ...tasks].map(value => [value.operonId, value]));
	const recurringIds = new Set(options.recurringIds ?? []);
	return buildTableGanttDescendantShiftPlan({
		parentTaskId: 'parent',
		deltaDays,
		directChildIds: options.directChildIds ?? [tasks[0]?.operonId ?? 'child'],
		descendantIds: options.descendantIds ?? tasks.map(value => value.operonId),
		getTask: id => byId.get(id) ?? null,
		hasDuplicateTaskId: id => options.duplicateIds?.includes(id) === true,
		hasHierarchyCycle: () => options.hasHierarchyCycle === true,
		requiresRecurrenceScope: value => recurringIds.has(value.operonId),
	});
}

async function run(): Promise<void> {
	const dated = task('child', {
		dateStarted: '2026-08-27',
		dateScheduled: '2026-08-28',
		dateDue: '2026-08-30',
		datetimeStart: '2026-08-28T09:00:00',
		datetimeEnd: '2026-08-28T10:00:00',
		estimate: '3600',
	});
	const shifted = plan([dated], 3);
	equal(shifted.outcome, 'planned');
	deepEqual(shifted.entries[0]?.payload, {
		dateStarted: '2026-08-30',
		dateScheduled: '2026-08-31',
		dateDue: '2026-09-02',
		datetimeStart: '2026-08-31T09:00:00',
		datetimeEnd: '2026-08-31T10:00:00',
	});
	equal(shifted.entries[0]?.payload.estimate, undefined, 'Estimate is never rewritten');

	const backwards = plan([task('child', {
		dateStarted: '2026-03-01',
		dateDue: '2026-03-02',
		datetimeStart: '2026-03-29T09:30:00',
	})], -1);
	deepEqual(backwards.entries[0]?.payload, {
		dateStarted: '2026-02-28',
		dateDue: '2026-03-01',
		datetimeStart: '2026-03-28T09:30:00',
	});

	const leap = plan([task('child', { dateScheduled: '2028-02-28' })], 1);
	equal(leap.entries[0]?.payload.dateScheduled, '2028-02-29');

	const terminalTasks = [
		task('done', { dateStarted: '2026-01-01' }, 'done'),
		task('cancelled', { dateDue: '2026-01-02' }, 'cancelled'),
		task('completed-date', { dateStarted: '2026-01-03', dateCompleted: '2026-01-04' }),
		task('cancelled-date', { dateDue: '2026-01-05', dateCancelled: '2026-01-06' }),
		task('malformed-terminal', { dateScheduled: '2026-01-07', dateCompleted: 'not-a-date' }),
	];
	const terminalPlan = plan(terminalTasks, 2, {
		descendantIds: ['done', 'cancelled', 'completed-date', 'cancelled-date', 'malformed-terminal'],
	});
	deepEqual(terminalPlan.skippedTerminalTaskIds, ['cancelled', 'cancelled-date', 'completed-date', 'done']);
	equal(terminalPlan.entries.length, 1);
	equal(terminalPlan.entries[0]?.task.operonId, 'malformed-terminal');
	equal(terminalPlan.entries[0]?.payload.dateCompleted, undefined);

	const malformed = plan([task('child', {
		dateStarted: '2026-02-30',
		dateScheduled: '2026-05-01',
		datetimeStart: '2026-02-30T09:00:00',
		datetimeEnd: '2026-05-01T24:00:00',
	})], 2);
	deepEqual(malformed.entries[0]?.payload, { dateScheduled: '2026-05-03' });

	const undated = plan([task('child', { estimate: '3600' })], 4);
	equal(undated.outcome, 'noop');
	deepEqual(undated.skippedUndatedTaskIds, ['child']);

	for (const noOp of [
		plan([dated], 0),
		plan([dated], 1, { directChildIds: [] }),
	]) {
		equal(noOp.outcome, 'noop');
		equal(noOp.entries.length, 0);
	}

	const deduplicated = plan([
		task('child', { dateScheduled: '2026-08-01' }),
		task('grandchild', { dateDue: '2026-08-02' }),
	], 1, {
		descendantIds: ['parent', 'grandchild', 'child', 'child'],
	});
	deepEqual(deduplicated.entries.map(entry => entry.task.operonId), ['child', 'grandchild']);

	const duplicate = plan([dated], 1, { duplicateIds: ['child'] });
	equal(duplicate.outcome, 'blocked');
	equal(duplicate.blockedReason, 'duplicate-task');
	equal(duplicate.blockedTaskId, 'child');
	equal(plan([], 1, { descendantIds: ['missing'] }).blockedReason, 'missing-task');
	const missingParent = buildTableGanttDescendantShiftPlan({
		parentTaskId: 'missing-parent',
		deltaDays: 1,
		directChildIds: ['child'],
		descendantIds: ['child'],
		getTask: id => id === 'child' ? dated : null,
	});
	equal(missingParent.blockedReason, 'missing-task');
	equal(missingParent.blockedTaskId, 'missing-parent');
	const missingDirectChild = buildTableGanttDescendantShiftPlan({
		parentTaskId: 'parent',
		deltaDays: 1,
		directChildIds: ['missing-child'],
		descendantIds: ['missing-child'],
		getTask: id => id === 'parent' ? task('parent') : null,
	});
	equal(missingDirectChild.blockedReason, 'missing-task');
	equal(missingDirectChild.blockedTaskId, 'missing-child');
	const incompleteHierarchy = plan([dated], 1, {
		directChildIds: ['child'],
		descendantIds: [],
	});
	equal(incompleteHierarchy.blockedReason, 'invalid-hierarchy');
	equal(incompleteHierarchy.blockedTaskId, 'child');
	const cyclicHierarchy = plan([dated], 1, { hasHierarchyCycle: true });
	equal(cyclicHierarchy.blockedReason, 'hierarchy-cycle');
	equal(cyclicHierarchy.blockedTaskId, 'parent');

	const recurringA = task('recurring-a', {
		dateScheduled: '2026-09-01',
		repeatSeriesId: 'series-b',
		repeatOccurrenceDate: '2026-09-01',
	});
	const recurringB = task('recurring-b', {
		dateScheduled: '2026-09-08',
		repeatSeriesId: 'series-b',
		repeatOccurrenceDate: '2026-09-08',
	});
	const recurringC = task('recurring-c', {
		dateScheduled: '2026-09-03',
		repeatSeriesId: 'series-a',
		repeatOccurrenceDate: '2026-09-03',
	});
	const recurringPlan = plan([recurringA, recurringB, recurringC], 7, {
		descendantIds: ['recurring-c', 'recurring-b', 'recurring-a'],
		recurringIds: ['recurring-a', 'recurring-b', 'recurring-c'],
	});
	deepEqual(recurringPlan.recurrenceRequirements, [
		{ seriesId: 'series-a', occurrenceDate: '2026-09-03', taskIds: ['recurring-c'] },
		{ seriesId: 'series-b', occurrenceDate: '2026-09-01', taskIds: ['recurring-a', 'recurring-b'] },
	]);

	const invalidRecurring = task('child', {
		dateScheduled: '2026-09-01',
		repeatSeriesId: 'series-a',
		repeatOccurrenceDate: 'invalid',
	});
	const invalidRecurringPlan = plan([invalidRecurring], 1, { recurringIds: ['child'] });
	equal(invalidRecurringPlan.outcome, 'blocked');
	equal(invalidRecurringPlan.blockedReason, 'invalid-recurrence');

	console.log(`Table Gantt descendant shift tests passed (${assertions} assertions).`);
}

globalThis.__operonTableGanttDescendantShiftTestRun = run();

declare global {
	var __operonTableGanttDescendantShiftTestRun: Promise<void> | undefined;
}
