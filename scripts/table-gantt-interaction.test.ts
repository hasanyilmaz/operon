import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { IndexedTask } from '../src/types/fields';
import {
	buildTableGanttEditPlan,
	buildTableGanttLaneSelectionPlan,
	resolveTableGanttKeyboardDate,
	resolveTableGanttPointerDate,
} from '../src/ui/table/table-gantt-interaction';

let assertions = 0;

function equal<T>(actual: T, expected: T, message?: string): void {
	if (message === undefined) assert.equal(actual, expected);
	else assert.equal(actual, expected, message);
	assertions += 1;
}

function deepEqual(actual: unknown, expected: unknown, message?: string): void {
	if (message === undefined) assert.deepEqual(actual, expected);
	else assert.deepEqual(actual, expected, message);
	assertions += 1;
}

function task(id: string, fieldValues: Record<string, string>): IndexedTask {
	return {
		operonId: id,
		description: id,
		checkbox: 'open',
		fieldValues,
		tags: [],
		primary: { filePath: 'Gantt interaction fixtures.md', lineNumber: 1, format: 'inline' },
		datetimeModified: '2026-08-26T12:00:00',
		tier: 'hot',
	};
}

async function run(): Promise<void> {
	const range = task('range', {
		dateScheduled: '2026-08-24',
		dateStarted: '2026-08-24',
		dateDue: '2026-08-28',
		datetimeStart: '2026-08-24T09:00:00',
		datetimeEnd: '2026-08-24T10:00:00',
	});
	deepEqual(buildTableGanttEditPlan({
		task: range,
		intent: 'move',
		targetDate: '2026-08-31',
	})?.payload, {
		dateScheduled: '',
		dateStarted: '2026-08-31',
		dateDue: '2026-09-04',
		datetimeStart: '',
		datetimeEnd: '',
	});
	equal(buildTableGanttEditPlan({ task: range, intent: 'move', targetDate: '2026-08-31' })?.projection.bar?.startDate, '2026-08-31');
	equal(buildTableGanttEditPlan({ task: range, intent: 'resize-start', targetDate: '2026-09-10' })?.payload.dateStarted, '2026-08-28');
	equal(buildTableGanttEditPlan({ task: range, intent: 'resize-end', targetDate: '2026-08-01' })?.payload.dateDue, '2026-08-24');
	equal(buildTableGanttEditPlan({ task: range, intent: 'move', targetDate: '2028-02-29' })?.payload.dateDue, '2028-03-04');

	const scheduled = task('scheduled', { dateScheduled: '2026-09-02', dateDue: '2026-09-10' });
	deepEqual(buildTableGanttEditPlan({
		task: scheduled,
		intent: 'move',
		targetDate: '2026-09-05',
	})?.payload, { dateScheduled: '2026-09-05' }, 'Scheduled moves preserve an independent due marker');
	deepEqual(buildTableGanttEditPlan({
		task: scheduled,
		intent: 'resize-start',
		targetDate: '2026-08-31',
	})?.payload, {
		dateScheduled: '',
		dateStarted: '2026-08-31',
		dateDue: '2026-09-02',
		datetimeStart: '',
		datetimeEnd: '',
	});
	equal(buildTableGanttEditPlan({ task: scheduled, intent: 'resize-end', targetDate: '2026-09-04' })?.projection.bar?.kind, 'all-day-range');
	equal(buildTableGanttEditPlan({ task: scheduled, intent: 'resize-start', targetDate: '2026-09-20' })?.payload.dateStarted, '2026-09-02');
	equal(buildTableGanttEditPlan({ task: scheduled, intent: 'resize-end', targetDate: '2026-08-20' })?.payload.dateDue, '2026-09-02');

	const timed = task('timed', {
		dateScheduled: '2026-10-24',
		dateDue: '2026-11-01',
		datetimeStart: '2026-10-24T23:30:00',
		datetimeEnd: '2026-10-25T01:30:00',
		estimate: '7200',
	});
	deepEqual(buildTableGanttEditPlan({ task: timed, intent: 'move', targetDate: '2026-10-26' })?.payload, {
		datetimeStart: '2026-10-26T23:30:00',
		datetimeEnd: '2026-10-27T01:30:00',
		estimate: '7200',
		dateScheduled: '2026-10-26',
	});
	equal(buildTableGanttEditPlan({ task: timed, intent: 'resize-end', targetDate: '2026-10-28' })?.payload.datetimeEnd, '2026-10-28T01:30:00');
	equal(
		buildTableGanttEditPlan({ task: timed, intent: 'resize-end', targetDate: '2026-10-28' })?.payload.estimate,
		'270000',
		'Calendar local-time duration semantics include the DST fallback hour',
	);
	equal(buildTableGanttEditPlan({ task: timed, intent: 'resize-start', targetDate: '2026-11-02' })?.payload.datetimeStart, '2026-10-24T23:30:00');

	const estimated = task('estimated', {
		datetimeStart: '2026-03-28T10:00:00',
		estimate: '172800',
	});
	deepEqual(buildTableGanttEditPlan({ task: estimated, intent: 'move', targetDate: '2026-03-30' })?.payload, {
		datetimeStart: '2026-03-30T10:00:00',
		estimate: '172800',
		datetimeEnd: '',
	});
	equal(buildTableGanttEditPlan({ task: estimated, intent: 'resize-end', targetDate: '2026-04-02' })?.payload.datetimeEnd, '');
	equal(Number(buildTableGanttEditPlan({ task: estimated, intent: 'resize-end', targetDate: '2026-04-02' })?.payload.estimate) > 0, true);

	const dueOnly = task('due-only', { dateDue: '2026-09-10', dateStarted: 'stale', datetimeStart: 'broken' });
	deepEqual(buildTableGanttLaneSelectionPlan({
		task: dueOnly,
		startDate: '2026-09-03',
		endDate: '2026-09-03',
		oneDayBehavior: 'scheduled',
	})?.payload, {
		dateScheduled: '2026-09-03',
		dateStarted: '',
		datetimeStart: '',
		datetimeEnd: '',
	});
	equal(buildTableGanttLaneSelectionPlan({
		task: dueOnly,
		startDate: '2026-09-03',
		endDate: '2026-09-03',
		oneDayBehavior: 'scheduled',
	})?.projection.deadline?.date, '2026-09-10');
	deepEqual(buildTableGanttLaneSelectionPlan({
		task: dueOnly,
		startDate: '2026-09-07',
		endDate: '2026-09-04',
		oneDayBehavior: 'scheduled',
	})?.payload, {
		dateScheduled: '',
		dateStarted: '2026-09-04',
		dateDue: '2026-09-07',
		datetimeStart: '',
		datetimeEnd: '',
	});
	equal(buildTableGanttLaneSelectionPlan({
		task: scheduled,
		startDate: '2026-09-03',
		endDate: '2026-09-03',
		oneDayBehavior: 'scheduled',
	}), null, 'Lane scheduling is disabled when a task already has a bar');

	equal(resolveTableGanttKeyboardDate('2026-08-31', 'ArrowRight', false), '2026-09-01');
	equal(resolveTableGanttKeyboardDate('2026-08-31', 'ArrowLeft', true), '2026-08-24');
	equal(resolveTableGanttKeyboardDate('2026-08-31', 'Enter', false), null);
	for (const base of [48, 20, 6]) {
		for (const multiplier of [0.75, 1, 1.25, 1.5]) {
			equal(resolveTableGanttPointerDate(
				'2026-08-01',
				'2026-08-31',
				base * multiplier,
				(base * multiplier * 4) + 0.5,
			), '2026-08-05');
		}
	}
	equal(resolveTableGanttPointerDate('2026-08-01', '2026-08-31', 20, -100), '2026-08-01');
	equal(resolveTableGanttPointerDate('2026-08-01', '2026-08-31', 20, 99999), '2026-08-31');

	const rootDir = process.cwd();
	const [workspaceSource, embedSource, rendererSource, mainSource, cssSource] = await Promise.all([
		readFile(path.join(rootDir, 'src/ui/table/operon-table-view.ts'), 'utf8'),
		readFile(path.join(rootDir, 'src/ui/embed-table-processor.ts'), 'utf8'),
		readFile(path.join(rootDir, 'src/ui/table/table-gantt-renderer.ts'), 'utf8'),
		readFile(path.join(rootDir, 'main.ts'), 'utf8'),
		readFile(path.join(rootDir, 'styles.css'), 'utf8'),
	]);
	for (const source of [workspaceSource, embedSource]) {
		assert.match(source, /new TableGanttInteractionController/);
		assert.match(source, /interaction:/);
		assertions += 2;
	}
	assert.match(rendererSource, /operon-table-gantt-resize-handle/);
	assert.match(rendererSource, /aria-busy/);
	assert.match(mainSource, /applyLatestMaterializedCalendarTemporalEdit\(task, guardedPayload, changedKeys\)/);
	assert.match(cssSource, /\.operon-table-gantt-bar:focus-visible/);
	assert.match(cssSource, /\.operon-table-gantt-resize-handle\.is-start/);
	assertions += 5;

	console.log(`Table Gantt interaction tests passed (${assertions} assertions).`);
}

globalThis.__operonTableGanttInteractionTestRun = run();

declare global {
	var __operonTableGanttInteractionTestRun: Promise<void> | undefined;
}

export {};
