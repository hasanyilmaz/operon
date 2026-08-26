import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildWorkflowStatusIdentityIndex } from '../src/core/workflow-status-identity';
import type { IndexedTask } from '../src/types/fields';
import type { OperonSettings } from '../src/types/settings';
import type { TableGanttSettings } from '../src/types/table';
import type { TableTaskTreeRenderItem } from '../src/ui/table/table-task-tree';
import {
	TABLE_GANTT_MIN_AXIS_WIDTH_PX,
	buildTableGanttTimelineLayout,
	formatTableGanttHeaderLabel,
	getTableGanttBaseDayWidthPx,
	resolveTableGanttAnchoredScrollLeft,
	resolveTableGanttBarGeometry,
	resolveTableGanttDeadlineCenterX,
	resolveTableGanttHorizontalRange,
	resolveTableGanttInitialScrollLeft,
	resolveTableGanttStartAnchoredScrollLeft,
	resolveTableGanttTaskAccent,
	resolveTableGanttViewportAnchorDate,
	resolveTableGanttViewportStartAnchor,
} from '../src/ui/table/table-gantt-renderer';

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
		primary: { filePath: 'Gantt render fixtures.md', lineNumber: 1, format: 'inline' },
		datetimeModified: '2026-08-26T12:00:00',
		tier: 'hot',
	};
}

function taskItem(value: IndexedTask, ordinalKey = value.operonId): TableTaskTreeRenderItem {
	return { kind: 'task', task: value, groupKey: null, ordinalKey };
}

function gantt(overrides: Partial<TableGanttSettings> = {}): TableGanttSettings {
	return {
		enabled: true,
		splitPercent: 70,
		scale: 'week',
		unitWidthMultiplier: 1,
		barColorMode: 'noColor',
		todayVisibility: 'inherit',
		weekendVisibility: 'inherit',
		...overrides,
	};
}

const colorSettings: Pick<OperonSettings, 'colorPalette' | 'pipelines' | 'priorities'> = {
	colorPalette: [
		{ id: 'blue', name: 'Blue', hex: '#2563EB' },
		{ id: 'rose', name: 'Rose', hex: '#E11D48' },
	],
	pipelines: [{
		id: 'pl_test',
		name: 'Test',
		statuses: [{
			id: 'st_doing',
			label: 'Doing',
			color: '#123456',
			isFinished: false,
			isCancelled: false,
			isScheduledTarget: false,
			isTrackingTarget: false,
			propertyMapping: null,
		}],
	}],
	priorities: [{ id: 'pr_high', label: 'High', color: '#654321' }],
};
const workflowIndex = buildWorkflowStatusIdentityIndex(colorSettings.pipelines);

async function run(): Promise<void> {
	equal(getTableGanttBaseDayWidthPx('day'), 48);
	equal(getTableGanttBaseDayWidthPx('week'), 20);
	equal(getTableGanttBaseDayWidthPx('month'), 6);

	const rangeTask = task('range', {
		dateStarted: '2026-08-24',
		dateDue: '2026-08-28',
		taskColor: 'abcdef',
		status: 'Test.Doing',
		priority: 'High',
	});
	const scheduledTask = task('scheduled', { dateScheduled: '2026-09-02' });
	const timedTask = task('timed', {
		datetimeStart: '2026-09-03T23:00:00',
		datetimeEnd: '2026-09-04T01:00:00',
	});
	const dueOnlyTask = task('due', { dateDue: '2026-09-05' });
	const childTask = task('child', { dateScheduled: '2026-09-06', parentTask: 'range' });
	const items: TableTaskTreeRenderItem[] = [
		taskItem(rangeTask),
		taskItem(childTask, 'range\u0000treeChild\u0000child'),
		{ kind: 'parentContext', task: rangeTask, groupKey: 'parent', occurrenceKey: 'parent-context' },
		taskItem(scheduledTask),
		taskItem(timedTask),
		taskItem(dueOnlyTask),
		{ kind: 'summary' },
	];

	for (const [scale, base] of [['day', 48], ['week', 20], ['month', 6]] as const) {
		for (const multiplier of [0.75, 1, 1.25, 1.5] as const) {
			const layout = buildTableGanttTimelineLayout({
				items,
				gantt: gantt({ scale, unitWidthMultiplier: multiplier }),
				calendarWeekStart: 'monday',
				globalShowToday: true,
				globalShowWeekends: true,
				viewportWidth: 600,
				today: '2026-08-26',
			});
			equal(layout.axis.dayWidthPx, base * multiplier);
			equal(layout.axis.days.every(day => day.width === base * multiplier), true);
			equal(layout.axis.totalWidthPx >= Math.max(TABLE_GANTT_MIN_AXIS_WIDTH_PX, 1800), true);
		}
	}

	const layout = buildTableGanttTimelineLayout({
		items,
		gantt: gantt(),
		calendarWeekStart: 'monday',
		globalShowToday: true,
		globalShowWeekends: false,
		viewportWidth: 400,
		today: '2026-08-26',
	});
	equal(layout.axis.startDate < '2026-08-24', true, 'The axis must include a viewport of leading padding');
	equal(layout.axis.endDate > '2026-09-06', true, 'The axis must include a viewport of trailing padding');
	equal(new Date(`${layout.axis.startDate}T00:00:00Z`).getUTCDay(), 1, 'Week axes align to the configured Monday start');
	equal(new Date(`${layout.axis.endDate}T00:00:00Z`).getUTCDay(), 0);
	equal(layout.showToday, true);
	equal(layout.showWeekends, false);
	equal(layout.earliestTaskDate, '2026-08-24');
	equal(layout.projections.size, 5, 'Parent-context repeats share one task projection');
	equal(layout.projections.get('range')?.bar?.kind, 'all-day-range');
	equal(layout.projections.get('scheduled')?.bar?.kind, 'scheduled');
	equal(layout.projections.get('timed')?.bar?.kind, 'timed');
	equal(layout.projections.get('due')?.bar, null);
	equal(layout.projections.get('child')?.bar?.startDate, '2026-09-06');

	const hiddenLayout = buildTableGanttTimelineLayout({
		items,
		gantt: gantt({ todayVisibility: 'hide', weekendVisibility: 'show' }),
		calendarWeekStart: 'sunday',
		globalShowToday: true,
		globalShowWeekends: false,
		viewportWidth: 400,
		today: '2026-08-26',
	});
	equal(hiddenLayout.showToday, false);
	equal(hiddenLayout.showWeekends, true);
	equal(new Date(`${hiddenLayout.axis.startDate}T00:00:00Z`).getUTCDay(), 0);
	const anchoredLayout = buildTableGanttTimelineLayout({
		items: [{ kind: 'summary' }],
		gantt: gantt(),
		calendarWeekStart: 'monday',
		globalShowToday: true,
		globalShowWeekends: true,
		viewportWidth: 400,
		today: '2026-08-26',
		anchorDate: '2027-03-15',
	});
	equal(anchoredLayout.axis.startDate <= '2027-03-15', true);
	equal(anchoredLayout.axis.endDate >= '2027-03-15', true);
	equal(
		resolveTableGanttViewportAnchorDate(
			anchoredLayout,
			resolveTableGanttAnchoredScrollLeft(anchoredLayout, '2027-03-15'),
		),
		'2027-03-15',
	);

	const horizontal = resolveTableGanttHorizontalRange(layout.axis, 400, 200);
	equal(horizontal.visibleStartIndex, 20);
	equal(horizontal.visibleEndIndex, 30);
	equal(horizontal.startIndex, 10);
	equal(horizontal.endIndex, 40);
	deepEqual(resolveTableGanttHorizontalRange(layout.axis, -100, 200), {
		visibleStartIndex: 0,
		visibleEndIndex: 10,
		startIndex: 0,
		endIndex: 20,
	});

	const todayScroll = resolveTableGanttInitialScrollLeft(layout, true);
	equal(resolveTableGanttViewportAnchorDate(layout, todayScroll), '2026-08-26');
	const earliestScroll = resolveTableGanttInitialScrollLeft(layout, false);
	equal(earliestScroll, 520, 'Earliest-task focus keeps a ten-percent leading buffer');
	const anchored = resolveTableGanttAnchoredScrollLeft(layout, '2026-09-02');
	equal(resolveTableGanttViewportAnchorDate(layout, anchored), '2026-09-02');
	const startAnchor = resolveTableGanttViewportStartAnchor(layout, todayScroll + 17);
	const resizedLayout = buildTableGanttTimelineLayout({
		items,
		gantt: gantt(),
		calendarWeekStart: 'monday',
		globalShowToday: true,
		globalShowWeekends: true,
		viewportWidth: 620,
		today: '2026-08-26',
		anchorDate: startAnchor.date,
	});
	deepEqual(
		resolveTableGanttViewportStartAnchor(
			resizedLayout,
			resolveTableGanttStartAnchoredScrollLeft(resizedLayout, startAnchor),
		),
		startAnchor,
		'split resize preserves the exact left-edge day and intra-day offset',
	);
	const tableRefreshLayout = buildTableGanttTimelineLayout({
		items: [...items],
		gantt: gantt(),
		calendarWeekStart: 'monday',
		globalShowToday: true,
		globalShowWeekends: true,
		viewportWidth: layout.viewportWidth,
		today: '2026-08-26',
		anchorDate: startAnchor.date,
	});
	deepEqual(
		resolveTableGanttViewportStartAnchor(
			tableRefreshLayout,
			resolveTableGanttStartAnchoredScrollLeft(tableRefreshLayout, startAnchor),
		),
		startAnchor,
		'ordinary Table cell refresh preserves the exact timeline viewport',
	);

	const rangeProjection = layout.projections.get('range');
	assert.ok(rangeProjection);
	assertions += 1;
	deepEqual(resolveTableGanttBarGeometry(layout.axis, rangeProjection), {
		left: 560,
		width: 100,
	});
	equal(resolveTableGanttDeadlineCenterX(layout.axis, rangeProjection), 650);
	const dueProjection = layout.projections.get('due');
	assert.ok(dueProjection);
	assertions += 1;
	equal(resolveTableGanttBarGeometry(layout.axis, dueProjection), null);
	equal(resolveTableGanttDeadlineCenterX(layout.axis, dueProjection), 810);

	const dayLayout = buildTableGanttTimelineLayout({
		items,
		gantt: gantt({ scale: 'day' }),
		calendarWeekStart: 'monday',
		globalShowToday: true,
		globalShowWeekends: true,
		viewportWidth: 400,
		today: '2026-08-26',
	});
	const todayGroup = dayLayout.axis.headerGroups.find(group => group.startDate === '2026-08-26');
	assert.ok(todayGroup);
	assertions += 1;
	equal(formatTableGanttHeaderLabel(dayLayout.axis, todayGroup, 'en'), 'W 26');
	equal(formatTableGanttHeaderLabel(layout.axis, layout.axis.headerGroups[0], 'en').includes('2026'), true);
	const monthLayout = buildTableGanttTimelineLayout({
		items,
		gantt: gantt({ scale: 'month' }),
		calendarWeekStart: 'monday',
		globalShowToday: true,
		globalShowWeekends: true,
		viewportWidth: 400,
		today: '2026-08-26',
	});
	equal(formatTableGanttHeaderLabel(monthLayout.axis, monthLayout.axis.headerGroups[0], 'en').includes('2026'), true);

	equal(resolveTableGanttTaskAccent(rangeTask, gantt({ barColorMode: 'noColor' }), colorSettings, workflowIndex), null);
	equal(resolveTableGanttTaskAccent(rangeTask, gantt({ barColorMode: 'taskColor' }), colorSettings, workflowIndex), '#abcdef');
	equal(resolveTableGanttTaskAccent(rangeTask, gantt({ barColorMode: 'statusColor' }), colorSettings, workflowIndex), '#123456');
	equal(resolveTableGanttTaskAccent(rangeTask, gantt({ barColorMode: 'priorityColor' }), colorSettings, workflowIndex), '#654321');
	const randomOne = resolveTableGanttTaskAccent(rangeTask, gantt({ barColorMode: 'randomColors' }), colorSettings, workflowIndex);
	const randomTwo = resolveTableGanttTaskAccent(rangeTask, gantt({ barColorMode: 'randomColors' }), colorSettings, workflowIndex);
	equal(randomOne, randomTwo);
	equal(/^#[0-9a-f]{6}$/iu.test(randomOne ?? ''), true);
	equal(resolveTableGanttTaskAccent(task('fallback', {}), gantt({ barColorMode: 'taskColor' }), colorSettings, workflowIndex), null);

	const rootDir = process.cwd();
	const [workspaceSource, embedSource, cssSource] = await Promise.all([
		readFile(path.join(rootDir, 'src/ui/table/operon-table-view.ts'), 'utf8'),
		readFile(path.join(rootDir, 'src/ui/embed-table-processor.ts'), 'utf8'),
		readFile(path.join(rootDir, 'styles.css'), 'utf8'),
	]);
	for (const source of [workspaceSource, embedSource]) {
		assert.match(source, /buildTableGanttTimelineLayout/);
		assert.match(source, /renderTableGanttTimeline/);
		assert.match(source, /resolveTableGanttViewportStartAnchor/);
		assertions += 3;
	}
	assert.match(cssSource, /\.operon-table-gantt-bar\s*\{[\s\S]*height: 26px;[\s\S]*border-radius: 6px/);
	assert.match(cssSource, /\.operon-table-gantt-today-line\s*\{[\s\S]*#e14b4b/);
	assert.match(cssSource, /\.operon-table-gantt-deadline\s*\{[\s\S]*width: 8px;[\s\S]*height: 8px/);
	assertions += 3;

	console.log(`Table Gantt render tests passed (${assertions} assertions).`);
}

declare global {
	var __operonTableGanttRenderTestRun: Promise<void> | undefined;
}

globalThis.__operonTableGanttRenderTestRun = run();
