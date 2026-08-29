import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { IndexedTask } from '../src/types/fields';
import { DEFAULT_SETTINGS } from '../src/types/settings';
import {
	buildTableGanttEditPlan,
	buildTableGanttLaneSelectionPlan,
	resolveTableGanttKeyboardDate,
	resolveTableGanttPointerDate,
} from '../src/ui/table/table-gantt-interaction';
import {
	applyTaskCreatorParentSeedToDraft,
	buildGanttDependencyTaskCreatorDraft,
} from '../src/ui/task-creator-integrations';

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
	deepEqual(buildGanttDependencyTaskCreatorDraft('source', 'follow-up'), {
		description: '',
		note: '',
		tags: [],
		inheritedTags: [],
		subtaskIds: [],
		fieldValues: { blockedBy: 'source' },
		explicitFieldKeys: ['blockedBy'],
		inheritedFieldKeys: [],
		taskIcon: '',
		taskColor: '',
		noteOpen: false,
		fileTemplateId: '',
		inlineCompletionMode: 'keep-completed',
	}, 'Right-side follow-up seed makes the new task blocked by the source');
	equal(
		buildGanttDependencyTaskCreatorDraft('source', 'preceding')?.fieldValues.blocking,
		'source',
		'Left-side preceding seed makes the new task block the source',
	);
	equal(buildGanttDependencyTaskCreatorDraft('  ', 'follow-up'), null);
	const siblingDraft = buildGanttDependencyTaskCreatorDraft('source', 'follow-up');
	if (!siblingDraft) throw new Error('Expected a Gantt dependency Task Creator draft');
	applyTaskCreatorParentSeedToDraft(siblingDraft, {
		parentTaskId: 'project',
		parentFieldValues: {
			priority: 'A',
			taskColor: 'green',
			blockedBy: 'unrelated',
		},
		parentTags: ['project-tag'],
	}, {
		...DEFAULT_SETTINGS,
		childTaskInheritanceFields: ['priority', 'taskColor', 'tags'],
	});
	deepEqual(siblingDraft.fieldValues, {
		blockedBy: 'source',
		parentTask: 'project',
		priority: 'A',
		taskColor: 'green',
	}, 'A linked task keeps its explicit dependency while inheriting its source task parent context');
	deepEqual(siblingDraft.explicitFieldKeys, ['blockedBy']);
	deepEqual(siblingDraft.inheritedFieldKeys.sort(), ['priority', 'taskColor']);
	deepEqual(siblingDraft.tags, ['project-tag']);
	const precedingSiblingDraft = buildGanttDependencyTaskCreatorDraft('source', 'preceding');
	if (!precedingSiblingDraft) throw new Error('Expected a preceding Gantt dependency Task Creator draft');
	applyTaskCreatorParentSeedToDraft(precedingSiblingDraft, {
		parentTaskId: 'project',
		parentFieldValues: { priority: 'A' },
	}, DEFAULT_SETTINGS);
	deepEqual(precedingSiblingDraft.fieldValues, {
		blocking: 'source',
		parentTask: 'project',
		status: 'Project.Brainstorming',
		priority: 'A',
	}, 'A preceding sibling keeps its explicit blocking relationship while inheriting the same parent');
	deepEqual(precedingSiblingDraft.explicitFieldKeys, ['blocking']);

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
		dateScheduled: '2026-08-31',
		dateStarted: '2026-08-31',
		dateDue: '2026-09-04',
		datetimeStart: '2026-08-31T09:00:00',
		datetimeEnd: '2026-08-31T10:00:00',
	}, 'All-day range moves shift in-range scheduled and timed dates by the same delta');
	equal(buildTableGanttEditPlan({ task: range, intent: 'move', targetDate: '2026-08-31' })?.projection.bar?.startDate, '2026-08-31');
	equal(buildTableGanttEditPlan({ task: range, intent: 'resize-start', targetDate: '2026-09-10' })?.payload.dateStarted, '2026-08-28');
	equal(buildTableGanttEditPlan({ task: range, intent: 'resize-end', targetDate: '2026-08-01' })?.payload.dateDue, '2026-08-24');
	equal(buildTableGanttEditPlan({ task: range, intent: 'move', targetDate: '2028-02-29' })?.payload.dateDue, '2028-03-04');
	const rangeWithExternalScheduled = task('range-external-scheduled', {
		dateScheduled: '2026-08-20',
		dateStarted: '2026-08-24',
		dateDue: '2026-08-28',
	});
	equal(
		buildTableGanttEditPlan({ task: rangeWithExternalScheduled, intent: 'move', targetDate: '2026-08-31' })?.payload.dateScheduled,
		undefined,
		'All-day range moves preserve a scheduled date outside the bar',
	);

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
		dateStarted: '2026-08-31',
		dateDue: '2026-09-02',
	}, 'Scheduled resize adds a range without clearing the scheduled date');
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
	deepEqual(buildTableGanttEditPlan({ task: timed, intent: 'resize-end', targetDate: '2026-10-28' })?.payload, {
		dateStarted: '2026-10-24',
		dateDue: '2026-10-28',
	}, 'Timed resize promotes the day span without changing scheduled or timed metadata');
	deepEqual(buildTableGanttEditPlan({ task: timed, intent: 'resize-start', targetDate: '2026-11-02' })?.payload, {
		dateStarted: '2026-10-25',
		dateDue: '2026-10-25',
	});

	const estimated = task('estimated', {
		datetimeStart: '2026-03-28T10:00:00',
		estimate: '172800',
	});
	deepEqual(buildTableGanttEditPlan({ task: estimated, intent: 'move', targetDate: '2026-03-30' })?.payload, {
		datetimeStart: '2026-03-30T10:00:00',
		estimate: '172800',
		datetimeEnd: '',
	});
	deepEqual(buildTableGanttEditPlan({ task: estimated, intent: 'resize-end', targetDate: '2026-04-02' })?.payload, {
		dateStarted: '2026-03-28',
		dateDue: '2026-04-02',
	});

	const singleTimed = task('single-timed', {
		dateScheduled: '2026-12-01',
		datetimeStart: '2026-12-01T09:00:00',
		datetimeEnd: '2026-12-01T10:00:00',
		estimate: '3600',
	});
	const promotedPlan = buildTableGanttEditPlan({
		task: singleTimed,
		intent: 'resize-end',
		targetDate: '2026-12-04',
	});
	deepEqual(promotedPlan?.payload, {
		dateStarted: '2026-12-01',
		dateDue: '2026-12-04',
	}, 'Single-day timed resize writes only the all-day range');
	const promotedTask = task('single-timed-promoted', {
		...singleTimed.fieldValues,
		...promotedPlan?.payload,
	});
	deepEqual(buildTableGanttEditPlan({
		task: promotedTask,
		intent: 'move',
		targetDate: '2026-12-03',
	})?.payload, {
		dateScheduled: '2026-12-03',
		datetimeStart: '2026-12-03T09:00:00',
		datetimeEnd: '2026-12-03T10:00:00',
		dateStarted: '2026-12-03',
		dateDue: '2026-12-06',
	}, 'Promoted ranges move scheduled and timed metadata by the same day delta');
	deepEqual(buildTableGanttEditPlan({
		task: promotedTask,
		intent: 'resize-start',
		targetDate: '2026-11-28',
	})?.payload, {
		dateStarted: '2026-11-28',
		dateDue: '2026-12-04',
	}, 'Later range resizes preserve scheduled and timed metadata');

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
	for (const base of [48, 20]) {
		for (const multiplier of [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]) {
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
		assert.match(source, /onActivateBar:/);
		assert.match(source, /onActivateDependencyPort:/);
		assert.match(source, /tableGanttBarClickAction/);
		assert.match(source, /tableGanttBarRightClickAction/);
		assert.match(source, /showTableTaskContextualMenu/);
		assertions += 7;
	}
	assert.match(rendererSource, /canActivatePrimary/);
	assert.match(rendererSource, /canActivateSecondary/);
	assert.match(rendererSource, /options\.onActivateBar\?\.\(task, bar, 'primary'\)/);
	assert.match(rendererSource, /options\.onActivateBar\?\.\(task, bar, 'secondary'\)/);
	assert.match(rendererSource, /event\.key === 'ContextMenu'/);
	assert.match(rendererSource, /supportsDependencyTaskCreation/);
	assert.match(rendererSource, /port\.setAttribute\('role', 'button'\)/);
	assertions += 7;
	assert.match(rendererSource, /operon-table-gantt-resize-handle/);
	assert.match(rendererSource, /aria-busy/);
	assert.match(mainSource, /applyLatestMaterializedCalendarTemporalEdit\(task, guardedPayload, changedKeys\)/);
	assert.match(mainSource, /buildGanttDependencyTaskCreatorDraft/);
	assert.match(mainSource, /applyTaskCreatorParentSeedToDraft/);
	assert.match(mainSource, /hasDuplicateOperonIdConflict\(parentTaskId\)/);
	assert.match(mainSource, /applyGenericDefaults: true/);
	assert.match(mainSource, /initialOutsidePointerGraceMs: 250/);
	assert.match(cssSource, /\.operon-table-gantt-bar:focus-visible/);
	assert.match(cssSource, /\.operon-table-gantt-bar:focus-within \.operon-table-gantt-dependency-port/);
	assert.match(cssSource, /\.operon-table-gantt-resize-handle\.is-start/);
	assertions += 11;

	console.log(`Table Gantt interaction tests passed (${assertions} assertions).`);
}

globalThis.__operonTableGanttInteractionTestRun = run();

declare global {
	var __operonTableGanttInteractionTestRun: Promise<void> | undefined;
}

export {};
