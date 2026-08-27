import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
	isTableScrollTopWithinRetainedCoverage,
	resolveTableRetainedVirtualCoverage,
	resolveTableVirtualRange,
	syncTableGanttCanvasOffsets,
} from '../src/ui/table/table-gantt-split';
import { TableTrailingIdleScheduler } from '../src/ui/table/table-trailing-idle-scheduler';

let assertions = 0;

function equal<T>(actual: T, expected: T, message?: string): void {
	assert.equal(actual, expected, message);
	assertions += 1;
}

function deepEqual(actual: unknown, expected: unknown, message?: string): void {
	assert.deepEqual(actual, expected, message);
	assertions += 1;
}

function match(actual: string, expected: RegExp, message?: string): void {
	assert.match(actual, expected, message);
	assertions += 1;
}

function doesNotMatch(actual: string, expected: RegExp, message?: string): void {
	assert.doesNotMatch(actual, expected, message);
	assertions += 1;
}

async function run(): Promise<void> {
	const top38 = resolveTableVirtualRange({
		itemCount: 100,
		rowHeight: 38,
		viewportHeight: 380,
		scrollTop: 0,
		overscanRows: 8,
	});
	const top38Coverage = resolveTableRetainedVirtualCoverage(top38, 100, 38);
	deepEqual(top38Coverage, { minScrollTop: 0, maxScrollTop: 228 });
	equal(isTableScrollTopWithinRetainedCoverage(top38Coverage, 0), true);
	equal(isTableScrollTopWithinRetainedCoverage(top38Coverage, 228), true, 'coverage bounds are inclusive');
	equal(isTableScrollTopWithinRetainedCoverage(top38Coverage, 228.01), false);

	const middle38 = resolveTableVirtualRange({
		itemCount: 100,
		rowHeight: 38,
		viewportHeight: 380,
		scrollTop: 1900,
		overscanRows: 8,
	});
	const middle38Coverage = resolveTableRetainedVirtualCoverage(middle38, 100, 38);
	deepEqual(middle38Coverage, { minScrollTop: 1672, maxScrollTop: 2128 });
	equal(isTableScrollTopWithinRetainedCoverage(middle38Coverage, 1672), true);
	equal(isTableScrollTopWithinRetainedCoverage(middle38Coverage, 2128), true);
	equal(isTableScrollTopWithinRetainedCoverage(middle38Coverage, 1671.99), false);
	equal(isTableScrollTopWithinRetainedCoverage(middle38Coverage, 2128.01), false);

	const middle44 = resolveTableVirtualRange({
		itemCount: 100,
		rowHeight: 44,
		viewportHeight: 440,
		scrollTop: 2200,
		overscanRows: 8,
	});
	deepEqual(
		resolveTableRetainedVirtualCoverage(middle44, 100, 44),
		{ minScrollTop: 1936, maxScrollTop: 2464 },
		'44px rows use the same two-row safety contract',
	);

	const bottom38 = resolveTableVirtualRange({
		itemCount: 100,
		rowHeight: 38,
		viewportHeight: 380,
		scrollTop: 9999,
		overscanRows: 8,
	});
	deepEqual(resolveTableRetainedVirtualCoverage(bottom38, 100, 38), {
		minScrollTop: 3192,
		maxScrollTop: 3420,
	});
	const small = resolveTableVirtualRange({
		itemCount: 5,
		rowHeight: 38,
		viewportHeight: 114,
		scrollTop: 0,
		overscanRows: 8,
	});
	deepEqual(resolveTableRetainedVirtualCoverage(small, 5, 38), { minScrollTop: 0, maxScrollTop: 76 });
	const empty = resolveTableVirtualRange({
		itemCount: 0,
		rowHeight: 38,
		viewportHeight: 380,
		scrollTop: 0,
		overscanRows: 8,
	});
	deepEqual(resolveTableRetainedVirtualCoverage(empty, 0, 38), { minScrollTop: 0, maxScrollTop: 0 });
	equal(resolveTableRetainedVirtualCoverage(middle38, 99, 38), null, 'item-count changes invalidate coverage');
	equal(resolveTableRetainedVirtualCoverage(middle38, 100, 44), null, 'row-height changes invalidate coverage');
	equal(isTableScrollTopWithinRetainedCoverage(null, 0), false);
	equal(isTableScrollTopWithinRetainedCoverage(top38Coverage, Number.NaN), false);

	const firstCanvas = { style: { transform: '' } } as unknown as HTMLElement;
	const secondCanvas = { style: { transform: '' } } as unknown as HTMLElement;
	syncTableGanttCanvasOffsets(125, firstCanvas, secondCanvas);
	equal(firstCanvas.style.transform, 'translateY(-125px)');
	equal(secondCanvas.style.transform, firstCanvas.style.transform, 'both Gantt canvases receive one shared transform');
	syncTableGanttCanvasOffsets(-20, firstCanvas, secondCanvas);
	equal(firstCanvas.style.transform, 'translateY(0px)', 'negative offsets clamp to the top');

	{
		let now = 0;
		let nextTimerId = 1;
		let callbackCount = 0;
		let scheduleCount = 0;
		let cancelCount = 0;
		const timers = new Map<number, () => void>();
		const scheduler = new TableTrailingIdleScheduler(80, () => { callbackCount += 1; }, {
			now: () => now,
			schedule: callback => {
				const id = nextTimerId++;
				timers.set(id, callback);
				scheduleCount += 1;
				return id;
			},
			cancel: timerId => {
				if (timers.delete(timerId)) cancelCount += 1;
			},
		});
		const runTimers = () => {
			const pending = [...timers.values()];
			timers.clear();
			for (const callback of pending) callback();
		};
		scheduler.request();
		now = 30;
		scheduler.request();
		now = 60;
		scheduler.request();
		equal(scheduleCount, 1, 'continuous events share the first timer');
		equal(cancelCount, 0, 'continuous events do not churn timers');
		now = 80;
		runTimers();
		equal(callbackCount, 0, 'callback does not run before trailing idle');
		equal(scheduleCount, 2, 'early timer rearms for the remaining delay');
		now = 140;
		runTimers();
		equal(callbackCount, 1, 'callback runs once after the final event is idle');
		now = 200;
		scheduler.request();
		scheduler.cancel();
		equal(cancelCount, 1);
		runTimers();
		equal(callbackCount, 1, 'cancel prevents delayed callbacks');
	}

	{
		let now = 100;
		let callbackCount = 0;
		let scheduled: (() => void) | null = null;
		const scheduler = new TableTrailingIdleScheduler(80, () => { callbackCount += 1; }, {
			now: () => now,
			schedule: callback => {
				scheduled = callback;
				return 1;
			},
			cancel: () => { scheduled = null; },
		});
		scheduler.request();
		now = 90;
		const firstCallback = scheduled as (() => void) | null;
		assert.ok(firstCallback);
		assertions += 1;
		firstCallback();
		equal(callbackCount, 0, 'clock rollback never fires an early callback');
		scheduler.cancel();
	}

	const root = process.cwd();
	const workspaceSource = await readFile(path.join(root, 'src/ui/table/operon-table-view.ts'), 'utf8');
	const embeddedSource = await readFile(path.join(root, 'src/ui/embed-table-processor.ts'), 'utf8');
	const splitSource = await readFile(path.join(root, 'src/ui/table/table-gantt-split.ts'), 'utf8');
	const performanceSource = await readFile(path.join(root, 'src/ui/table/table-scroll-performance.ts'), 'utf8');
	for (const source of [workspaceSource, embeddedSource]) {
		match(source, /beginVerticalScroll\(resolveScrollPerformanceContext\)/, 'both surfaces use lazy debug context');
		match(source, /resolveTableRetainedVirtualCoverage\(range, items\.length, rowHeight\)/);
		match(source, /isTableScrollTopWithinRetainedCoverage\([^,]+, scroller\.scrollTop\)/);
		match(source, /syncTableGanttCanvasOffsets\([\s\S]*?canvas[\s\S]*?timelineCanvas\)/);
		match(source, /closeActivePicker|closeEmbedTableActivePicker/);
		match(source, /scheduleVisibleRowsRender\('vertical-scroll'\)|scheduleEmbedTableVisibleRowsRender\([\s\S]*?vertical-scroll/);
	}
	match(workspaceSource, /this\.state\.scrollTop = scrollTop/);
	match(workspaceSource, /this\.state\.scrollLeft = tableBodyScroller\.scrollLeft/);
	doesNotMatch(workspaceSource, /this\.state\s*=\s*\{[\s\S]*?\.\.\.this\.ensureState\(\),\s*scroll(?:Top|Left)/);
	match(workspaceSource, /persistStateScheduler\.request\(\)/);
	match(workspaceSource, /persistStateScheduler\.cancel\(\)/);
	match(embeddedSource, /closeFloatingPanelsForRoot\(root\)/);
	match(embeddedSource, /closeIconOnlyChipPreviewsForRoot\(root\)/);
	match(performanceSource, /typeof context === 'function' \? context\(\) : context/);
	match(performanceSource, /idleScheduler\.request\(\)/);
	match(splitSource, /TABLE_GANTT_WHEEL_GESTURE_RESET_MS = 140/);
	match(splitSource, /TABLE_GANTT_WHEEL_DOMINANCE_RATIO = 1\.5/);

	const workspaceRetainStart = workspaceSource.indexOf('private canRetainVisibleRowsForCurrentScroll');
	const workspaceRetainEnd = workspaceSource.indexOf('private shouldDeferMobileVisibleRowsRender', workspaceRetainStart);
	const workspaceRetainSource = workspaceSource.slice(workspaceRetainStart, workspaceRetainEnd);
	doesNotMatch(workspaceRetainSource, /clientHeight|resolveTableRetainedVirtualRange/, 'workspace coverage fast path performs no layout read or full range calculation');
	const embedRetainStart = embeddedSource.indexOf('function canRetainEmbedTableVisibleRowsForCurrentScroll');
	const embedRetainEnd = embeddedSource.indexOf('function shouldDeferEmbedMobileVisibleRows', embedRetainStart);
	const embedRetainSource = embeddedSource.slice(embedRetainStart, embedRetainEnd);
	doesNotMatch(embedRetainSource, /clientHeight|resolveTableRetainedVirtualRange/, 'embedded coverage fast path performs no layout read or full range calculation');

	console.log(`Table Gantt scroll hot-path tests passed (${assertions} assertions).`);
}

declare global {
	var __operonTableGanttScrollHotPathTestRun: Promise<void> | undefined;
}

globalThis.__operonTableGanttScrollHotPathTestRun = run();
