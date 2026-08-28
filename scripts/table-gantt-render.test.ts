import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildWorkflowStatusIdentityIndex } from '../src/core/workflow-status-identity';
import type { IndexedTask } from '../src/types/fields';
import { GANTT_SCALES, GANTT_UNIT_WIDTH_MULTIPLIERS } from '../src/types/gantt';
import type { OperonSettings } from '../src/types/settings';
import type { TableGanttSettings } from '../src/types/table';
import type { TableTaskTreeRenderItem } from '../src/ui/table/table-task-tree';
import {
	TABLE_GANTT_MIN_AXIS_WIDTH_PX,
	areTableGanttRenderIntentsEqual,
	areTableGanttHeaderRenderIntentsEqual,
	areTableGanttRowRenderIntentsEqual,
	buildTableGanttTimelineLayout,
	formatTableGanttContextHeaderLabel,
	formatTableGanttHeaderLabel,
	getTableGanttBaseDayWidthPx,
	resolveTableGanttAnchoredScrollLeft,
	resolveTableGanttBarGeometry,
	resolveTableGanttDateMarkerCenterX,
	resolveTableGanttDateMarkerIcon,
	resolveTableGanttDateMarkerVisibility,
	resolveTableGanttHorizontalRange,
	resolveTableGanttContextLabelGeometry,
	resolveTableGanttInitialScrollLeft,
	resolveTableGanttNavigationPoints,
	resolveTableGanttNavigationTarget,
	resolveTableGanttHeaderRenderIntent,
	resolveTableGanttRenderIntent,
	resolveTableGanttBarTooltipContent,
	resolveTableGanttStartAnchoredScrollLeft,
	resolveTableGanttTaskAccent,
	resolveTableGanttViewportAnchorDate,
	resolveTableGanttViewportStartAnchor,
	shouldRenderTableGanttTimeline,
	type TableGanttRenderIntentOptions,
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

	for (const [scale, base] of [['day', 48], ['week', 20]] as const) {
		for (const multiplier of GANTT_UNIT_WIDTH_MULTIPLIERS) {
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
	const navigationTask = task('navigation', {
		dateStarted: '2026-08-24',
		dateScheduled: '2026-08-26',
		dateDue: '2026-08-28',
	});
	const navigationLayout = buildTableGanttTimelineLayout({
		items: [taskItem(navigationTask)],
		gantt: gantt(),
		calendarWeekStart: 'monday',
		globalShowToday: true,
		globalShowWeekends: true,
		viewportWidth: 400,
		today: '2026-08-26',
	});
	const navigationProjection = navigationLayout.projections.get('navigation');
	assert.ok(navigationProjection);
	assertions += 1;
	const navigationPoints = resolveTableGanttNavigationPoints(
		navigationLayout.axis,
		navigationProjection,
	);
	deepEqual(navigationPoints.map(point => ({ date: point.date, keys: point.keys })), [
		{ date: '2026-08-24', keys: ['dateStarted'] },
		{ date: '2026-08-26', keys: ['dateScheduled'] },
		{ date: '2026-08-28', keys: ['dateDue'] },
	], 'bar endpoints and canonical markers are de-duplicated by day');
	const scheduledPoint = navigationPoints[1]!;
	const duePoint = navigationPoints[2]!;
	const centeredOnScheduled = scheduledPoint.x - 20;
	equal(
		resolveTableGanttNavigationTarget(
			navigationLayout.axis,
			navigationProjection,
			centeredOnScheduled,
			40,
			'previous',
			0,
		)?.date,
		'2026-08-24',
	);
	equal(
		resolveTableGanttNavigationTarget(
			navigationLayout.axis,
			navigationProjection,
			centeredOnScheduled,
			40,
			'next',
			0,
		)?.date,
		'2026-08-28',
	);
	equal(
		resolveTableGanttNavigationTarget(
			navigationLayout.axis,
			navigationProjection,
			duePoint.x - 20,
			40,
			'previous',
			0,
		)?.date,
		'2026-08-26',
		'repeated navigation advances to the nearest remaining hidden point',
	);
	equal(
		resolveTableGanttNavigationTarget(
			navigationLayout.axis,
			navigationProjection,
			duePoint.x - 20,
			40,
			'next',
			0,
		),
		null,
	);
	for (const scale of GANTT_SCALES) {
		for (const multiplier of GANTT_UNIT_WIDTH_MULTIPLIERS) {
			const scaledNavigationLayout = buildTableGanttTimelineLayout({
				items: [taskItem(navigationTask)],
				gantt: gantt({ scale, unitWidthMultiplier: multiplier }),
				calendarWeekStart: 'monday',
				globalShowToday: true,
				globalShowWeekends: true,
				viewportWidth: 400,
				today: '2026-08-26',
			});
			const scaledProjection = scaledNavigationLayout.projections.get('navigation')!;
			const scaledPoints = resolveTableGanttNavigationPoints(
				scaledNavigationLayout.axis,
				scaledProjection,
			);
			const centerX = scaledPoints[1]!.x;
			const navigationViewportWidth = scaledNavigationLayout.axis.dayWidthPx * 1.5;
			const navigationScrollLeft = centerX - (navigationViewportWidth / 2);
			deepEqual([
				resolveTableGanttNavigationTarget(
					scaledNavigationLayout.axis,
					scaledProjection,
					navigationScrollLeft,
					navigationViewportWidth,
					'previous',
				)?.date,
				resolveTableGanttNavigationTarget(
					scaledNavigationLayout.axis,
					scaledProjection,
					navigationScrollLeft,
					navigationViewportWidth,
					'next',
				)?.date,
			], ['2026-08-24', '2026-08-28']);
		}
	}
	deepEqual(
		resolveTableGanttNavigationPoints(layout.axis, layout.projections.get('timed')!)
			.map(point => ({ date: point.date, keys: point.keys })),
		[
			{ date: '2026-09-03', keys: ['datetimeStart'] },
			{ date: '2026-09-04', keys: ['datetimeEnd'] },
		],
	);
	deepEqual(resolveTableGanttBarTooltipContent(rangeTask, layout.projections.get('range')!, 'en'), {
		title: 'range',
		content: '5 days\nStarts on: 24 Aug 2026\nDue on: 28 Aug 2026',
	});
	deepEqual(resolveTableGanttBarTooltipContent(scheduledTask, layout.projections.get('scheduled')!, 'en'), {
		title: 'scheduled',
		content: '1 day\n\nScheduled on: 2 Sep 2026',
	});
	deepEqual(resolveTableGanttBarTooltipContent(timedTask, layout.projections.get('timed')!, 'en'), {
		title: 'timed',
		content: '2 days',
	});
	equal(resolveTableGanttBarTooltipContent(dueOnlyTask, layout.projections.get('due')!, 'en'), null);

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

	const renderIntentGantt = gantt();
	const renderIntentSettings = {} as TableGanttRenderIntentOptions['settings'];
	const renderIntentOptions: TableGanttRenderIntentOptions = {
		items,
		verticalRange: {
			startIndex: 0,
			endIndex: 7,
			scrollTop: 0,
			viewportHeight: 266,
			totalHeight: 266,
		},
		rowHeight: 38,
		layout,
		scrollLeft: 405,
		locale: 'en',
		gantt: renderIntentGantt,
		settings: renderIntentSettings,
		workflowStatusIdentityIndex: workflowIndex,
	};
	const renderIntent = resolveTableGanttRenderIntent(renderIntentOptions);
	equal(areTableGanttRenderIntentsEqual(null, renderIntent), false);
	const stableRenderIntent = resolveTableGanttRenderIntent({
		...renderIntentOptions,
		scrollLeft: 410,
		verticalRange: { ...renderIntentOptions.verticalRange, scrollTop: 19 },
	});
	equal(areTableGanttRenderIntentsEqual(renderIntent, stableRenderIntent), true);
	equal(
		shouldRenderTableGanttTimeline(renderIntent, stableRenderIntent),
		false,
		'Native scrolling within the same horizontal and vertical render ranges reuses the Gantt DOM',
	);
	equal(shouldRenderTableGanttTimeline(renderIntent, stableRenderIntent, true), true, 'Explicit invalidation forces a Gantt render');
	equal(
		areTableGanttRenderIntentsEqual(
			renderIntent,
			resolveTableGanttRenderIntent({ ...renderIntentOptions, scrollLeft: 420 }),
		),
		false,
		'Crossing a horizontal overscan boundary invalidates the Gantt DOM',
	);
	equal(
		areTableGanttRenderIntentsEqual(
			renderIntent,
			resolveTableGanttRenderIntent({
				...renderIntentOptions,
				verticalRange: { ...renderIntentOptions.verticalRange, startIndex: 1, endIndex: 8 },
			}),
		),
		false,
		'Changing the virtual row range invalidates the Gantt DOM',
	);
	const shiftedVerticalIntent = resolveTableGanttRenderIntent({
		...renderIntentOptions,
		verticalRange: { ...renderIntentOptions.verticalRange, startIndex: 1, endIndex: 8 },
	});
	equal(
		areTableGanttHeaderRenderIntentsEqual(
			resolveTableGanttHeaderRenderIntent(renderIntent),
			resolveTableGanttHeaderRenderIntent(shiftedVerticalIntent),
		),
		true,
		'Changing only the virtual row range preserves the Gantt header',
	);
	equal(
		areTableGanttRowRenderIntentsEqual(renderIntent, shiftedVerticalIntent),
		true,
		'Changing only the virtual row range preserves overlapping Gantt row content',
	);
	equal(
		areTableGanttHeaderRenderIntentsEqual(
			resolveTableGanttHeaderRenderIntent(renderIntent),
			resolveTableGanttHeaderRenderIntent(resolveTableGanttRenderIntent({ ...renderIntentOptions, scrollLeft: 420 })),
		),
		false,
		'Crossing a horizontal overscan boundary invalidates the Gantt header',
	);
	equal(
		areTableGanttRenderIntentsEqual(
			renderIntent,
			resolveTableGanttRenderIntent({ ...renderIntentOptions, items: [...items] }),
		),
		false,
		'New projected items invalidate the Gantt DOM',
	);
	equal(
		areTableGanttRenderIntentsEqual(
			renderIntent,
			resolveTableGanttRenderIntent({ ...renderIntentOptions, settings: {} as TableGanttRenderIntentOptions['settings'] }),
		),
		false,
		'New render settings invalidate the Gantt DOM',
	);

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
	deepEqual(rangeProjection.markers, [
		{ key: 'dateStarted', date: '2026-08-24' },
		{ key: 'dateDue', date: '2026-08-28' },
	], 'multi-day ranges retain their canonical endpoint markers');
	const markerSettings = {
		tableGanttShowDateStartedMarkers: true,
		tableGanttShowDateScheduledMarkers: false,
		tableGanttShowDateDueMarkers: true,
	};
	equal(resolveTableGanttDateMarkerVisibility('dateStarted', markerSettings), true);
	equal(resolveTableGanttDateMarkerVisibility('dateScheduled', markerSettings), false);
	equal(resolveTableGanttDateMarkerVisibility('dateDue', markerSettings), true);
	const dueProjection = layout.projections.get('due');
	assert.ok(dueProjection);
	assertions += 1;
	equal(resolveTableGanttBarGeometry(layout.axis, dueProjection), null);
	equal(resolveTableGanttDateMarkerCenterX(layout.axis, dueProjection.markers[0]!), 810);
	equal(resolveTableGanttDateMarkerIcon('dateDue', { keyMappings: [] }), 'calendar-clock');
	equal(resolveTableGanttDateMarkerIcon('dateScheduled', { keyMappings: [{
		canonicalKey: 'dateScheduled',
		visiblePropertyName: 'Scheduled',
		type: 'date',
		sync: 'yes',
		enabled: true,
		icon: 'calendar-heart',
		isSystem: true,
	}] }), 'calendar-heart');

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
	const currentWeekContext = dayLayout.axis.contextHeaderGroups.find(group => (
		group.startDate <= '2026-08-26' && group.endDate >= '2026-08-26'
	));
	assert.ok(currentWeekContext);
	assertions += 1;
	equal(formatTableGanttContextHeaderLabel(dayLayout.axis, currentWeekContext, 'en'), 'Aug 24 – Aug 30, 2026');
	equal(formatTableGanttHeaderLabel(layout.axis, layout.axis.headerGroups[0], 'en').includes('2026'), true);
	const weekLayout = buildTableGanttTimelineLayout({
		items,
		gantt: gantt({ scale: 'week' }),
		calendarWeekStart: 'monday',
		globalShowToday: true,
		globalShowWeekends: true,
		viewportWidth: 400,
		today: '2026-08-26',
	});
	equal(formatTableGanttContextHeaderLabel(weekLayout.axis, weekLayout.axis.contextHeaderGroups[0], 'en').includes('2026'), false);
	deepEqual(resolveTableGanttContextLabelGeometry(0, 1000, 400, 300), { left: 550, maxWidth: 288 });
	deepEqual(resolveTableGanttContextLabelGeometry(500, 300, 400, 200), { left: 50, maxWidth: 88 });

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
	const [workspaceSource, embedSource, rendererSource, headerSource, cssSource] = await Promise.all([
		readFile(path.join(rootDir, 'src/ui/table/operon-table-view.ts'), 'utf8'),
		readFile(path.join(rootDir, 'src/ui/embed-table-processor.ts'), 'utf8'),
		readFile(path.join(rootDir, 'src/ui/table/table-gantt-renderer.ts'), 'utf8'),
		readFile(path.join(rootDir, 'src/ui/table/table-header-interactions.ts'), 'utf8'),
		readFile(path.join(rootDir, 'styles.css'), 'utf8'),
	]);
	for (const source of [workspaceSource, embedSource]) {
		assert.match(source, /buildTableGanttTimelineLayout/);
		assert.match(source, /renderTableGanttTimeline/);
		assert.match(source, /resolveTableGanttViewportStartAnchor/);
		assert.match(source, /resolveTableGanttAnchoredScrollLeft/);
		assert.match(source, /syncTableGanttNavigationRows\(renderOptions\)/);
		assert.match(source, /syncTableGanttContextHeaderLabels\(renderOptions\)/);
		assert.match(source, /behavior: 'smooth'/);
		assert.match(source, /onNavigateToDate:/);
		assert.match(
			source,
			/const renderOptions: TableGanttRenderOptions = \{[\s\S]*renderTableGanttTimeline\(renderOptions, nextRenderIntent, forceRows\);[\s\S]*bodyScroller\.scrollLeft = restoredScrollLeft/,
		);
		assert.match(source, /onOpenDateMarkerPicker:/);
		assert.match(source, /shouldRenderTableGanttTimeline/);
		assert.match(source, /reconcileTableVirtualRows\(\{/);
		assert.match(source, /openTaskFieldPicker\(\{/);
		assert.doesNotMatch(source, /bodyScroller\.scrollLeft = scrollLeft/);
		assertions += 13;
	}
	assert.match(cssSource, /\.operon-table-gantt-bar\s*\{[\s\S]*height: 26px;[\s\S]*border-radius: 6px/);
	assert.match(cssSource, /\.operon-table-gantt-bar\.is-done\s*\{[\s\S]*repeating-linear-gradient\([\s\S]*135deg/);
	assert.match(cssSource, /\.operon-table-gantt-bar\.is-done\s*\{[\s\S]*color-mix\(in srgb, var\(--operon-table-gantt-accent\) 6%, var\(--operon-table-surface\)\)/);
	assert.match(cssSource, /\.operon-table-gantt-row-content\s*\{[\s\S]*position: absolute;[\s\S]*pointer-events: none/);
	assert.match(cssSource, /\.operon-table-gantt-row-navigation\s*\{[\s\S]*position: absolute;[\s\S]*pointer-events: none/);
	assert.match(cssSource, /button\.operon-table-gantt-navigation-button\s*\{[\s\S]*pointer-events: auto/);
	assert.match(cssSource, /\.operon-table-gantt-today-line\s*\{[\s\S]*#e14b4b/);
	assert.match(cssSource, /\.operon-table-gantt-header-scroller\s*\{[\s\S]*flex: 0 0 70px/);
	assert.match(cssSource, /\.operon-table-gantt-timeline-header\s*\{[\s\S]*height: 70px/);
	assert.match(cssSource, /\.operon-table-gantt-header-group\.is-primary\s*\{[\s\S]*top: 35px/);
	assert.match(cssSource, /\.operon-table-gantt-table-pane \.operon-table-header-cell\s*\{[\s\S]*height: 69px/);
	assert.match(cssSource, /\.operon-table-header-cell\s*\{[\s\S]*justify-content: center;[\s\S]*text-align: center/);
	assert.doesNotMatch(headerSource, /applyTableColumnAlignmentClass/);
	assert.match(embedSource, /resolveTableEmbedShellHeightPx\([\s\S]*result\.preset\.gantt\.enabled/);
	assert.match(cssSource, /\.operon-table-gantt-date-marker\s*\{[\s\S]*width: 18px;[\s\S]*height: 18px/);
	assert.match(cssSource, /\.operon-table-gantt-bar:is\(:hover, :focus-within, \.is-operon-linked-row-hover\)[\s\S]*box-shadow/);
	assert.match(cssSource, /\.operon-table-gantt-date-marker-group\.is-operon-linked-row-hover \.operon-table-gantt-date-marker:not\(\.is-inside-bar\)[\s\S]*box-shadow/);
	assert.doesNotMatch(cssSource, /\.operon-table-gantt-deadline\s*\{/);
	assert.match(rendererSource, /setIcon\(markerEl, resolveTableGanttDateMarkerIcon\(marker\.key, options\.settings\)\)/);
	assert.match(rendererSource, /markerEl\.dataset\.ganttDateMarker = marker\.key/);
	assert.match(rendererSource, /laneEl\.dataset\.operonRowIndex = String\(index\)/);
	assert.match(rendererSource, /bar\.dataset\.operonRowIndex = String\(index\)/);
	assert.match(rendererSource, /if \(task\.checkbox === 'done'\) bar\.classList\.add\('is-done'\)/);
	assert.match(rendererSource, /group\.dataset\.operonRowIndex = String\(index\)/);
	assert.match(rendererSource, /markerEl\.classList\.add\('is-inside-bar'\)/);
	assert.match(rendererSource, /if \(!options\.onOpenDateMarkerPicker\) group\.setAttribute\('aria-hidden', 'true'\)/);
	assert.match(rendererSource, /bindOperonHoverTooltip\(markerEl, \{[\s\S]*title: markerTitle,[\s\S]*content: marker\.date/);
	assert.match(rendererSource, /tableGanttBarClickAction !== 'none'/);
	assert.match(rendererSource, /tableGanttBarRightClickAction !== 'none'/);
	assert.match(rendererSource, /bar\.addEventListener\('click'/);
	assert.match(rendererSource, /bar\.addEventListener\('contextmenu'/);
	assert.match(rendererSource, /onActivateBar\?\.\(task, bar, 'secondary'\)/);
	assert.match(rendererSource, /bindOperonHoverTooltip\(bar, \{[\s\S]*title: tooltip\.title,[\s\S]*content: tooltip\.content/);
	assert.match(rendererSource, /setIcon\(button, direction === 'previous' \? 'chevron-left' : 'chevron-right'\)/);
	assert.match(rendererSource, /button\.addEventListener\('pointerdown', event => event\.stopPropagation\(\)\)/);
	assert.match(rendererSource, /options\.onNavigateToDate\?\.\(target\.date\)/);
	assert.match(rendererSource, /navigationEl\.style\.left = `\$\{navigationScrollLeft\}px`/);
	assert.match(rendererSource, /areTableGanttHeaderRenderIntentsEqual/);
	assert.match(rendererSource, /reconcileTableVirtualRows\(\{/);
	assert.match(rendererSource, /ganttDependencyRebuilds/);
	assertions += 43;

	console.log(`Table Gantt render tests passed (${assertions} assertions).`);
}

declare global {
	var __operonTableGanttRenderTestRun: Promise<void> | undefined;
}

globalThis.__operonTableGanttRenderTestRun = run();
