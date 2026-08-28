import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
	TABLE_GANTT_DEFAULT_SPLIT_PERCENT,
	clampTableGanttSplitPercent,
	createTableGanttSessionState,
	createTableGanttWheelGestureState,
	getTableGanttLaneClassName,
	resolveTableGanttDividerKey,
	resolveTableGanttHoverRowIndex,
	resolveTableGanttWheelGesture,
	resolveTableGanttWheelIntent,
	resolveTableRetainedVirtualRange,
	resolveTableVisibleRowsRenderAdmission,
	resolveTableVirtualRange,
} from '../src/ui/table/table-gantt-split';

let assertions = 0;

function equal<T>(actual: T, expected: T, message?: string): void {
	assert.equal(actual, expected, message);
	assertions += 1;
}

function deepEqual(actual: unknown, expected: unknown, message?: string): void {
	assert.deepEqual(actual, expected, message);
	assertions += 1;
}

async function run(): Promise<void> {
	deepEqual(createTableGanttSessionState(), {
		enabled: false,
		splitPercent: 70,
		timelineScrollLeft: 0,
		timelineAnchorDate: null,
		timelineAnchorDayOffsetRatio: 0,
		timelineCenterAnchorDate: null,
		timelineCenterAnchorDayOffsetRatio: 0.5,
		timelineInitialized: false,
	});
	equal(clampTableGanttSplitPercent(Number.NaN), TABLE_GANTT_DEFAULT_SPLIT_PERCENT);
	equal(clampTableGanttSplitPercent(10), 20);
	equal(clampTableGanttSplitPercent(90), 80);
	equal(clampTableGanttSplitPercent(63.25), 63.25);
	equal(clampTableGanttSplitPercent(63.257), 63.26, 'pointer-derived percentages are persistence-safe');
	equal(resolveTableGanttDividerKey(70, 'ArrowLeft', false), 69);
	equal(resolveTableGanttDividerKey(70, 'ArrowRight', true), 75);
	equal(resolveTableGanttDividerKey(20, 'ArrowLeft', true), 20);
	equal(resolveTableGanttDividerKey(80, 'ArrowRight', false), 80);
	equal(resolveTableGanttDividerKey(50, 'Home', false), 20);
	equal(resolveTableGanttDividerKey(50, 'End', false), 80);
	equal(resolveTableGanttDividerKey(50, 'Enter', false), null);

	deepEqual(resolveTableVirtualRange({
		itemCount: 100,
		rowHeight: 38,
		viewportHeight: 380,
		scrollTop: 0,
		overscanRows: 8,
	}), {
		startIndex: 0,
		endIndex: 18,
		scrollTop: 0,
		viewportHeight: 380,
		totalHeight: 3800,
	});
	deepEqual(resolveTableVirtualRange({
		itemCount: 100,
		rowHeight: 44,
		viewportHeight: 440,
		scrollTop: 2200,
		overscanRows: 8,
	}), {
		startIndex: 42,
		endIndex: 68,
		scrollTop: 2200,
		viewportHeight: 440,
		totalHeight: 4400,
	});
	deepEqual(resolveTableVirtualRange({
		itemCount: 5,
		rowHeight: 38,
		viewportHeight: 114,
		scrollTop: 999,
		overscanRows: 8,
	}), {
		startIndex: 0,
		endIndex: 5,
		scrollTop: 76,
		viewportHeight: 114,
		totalHeight: 190,
	}, 'Filtering or collapse must clamp the shared scroll position');

	const retainedTopWindow = resolveTableVirtualRange({
		itemCount: 100,
		rowHeight: 38,
		viewportHeight: 380,
		scrollTop: 0,
		overscanRows: 8,
	});
	const retainedSubrow = resolveTableRetainedVirtualRange({
		itemCount: 100,
		rowHeight: 38,
		viewportHeight: 380,
		scrollTop: 37,
		overscanRows: 8,
	}, retainedTopWindow);
	equal(retainedSubrow.retained, true, 'sub-row scroll retains the existing virtual window');
	equal(retainedSubrow.range.startIndex, 0);
	equal(retainedSubrow.range.endIndex, 18);
	const retainedAtGuard = resolveTableRetainedVirtualRange({
		itemCount: 100,
		rowHeight: 38,
		viewportHeight: 380,
		scrollTop: 228,
		overscanRows: 8,
	}, retainedTopWindow);
	equal(retainedAtGuard.retained, true, 'the two-row lower safety boundary remains covered');
	const shiftedPastGuard = resolveTableRetainedVirtualRange({
		itemCount: 100,
		rowHeight: 38,
		viewportHeight: 380,
		scrollTop: 266,
		overscanRows: 8,
	}, retainedTopWindow);
	equal(shiftedPastGuard.retained, false, 'crossing the safety boundary shifts the window');
	deepEqual(
		{ startIndex: shiftedPastGuard.range.startIndex, endIndex: shiftedPastGuard.range.endIndex },
		{ startIndex: 0, endIndex: 25 },
	);
	const middleWindow = resolveTableVirtualRange({
		itemCount: 100,
		rowHeight: 38,
		viewportHeight: 380,
		scrollTop: 1900,
		overscanRows: 8,
	});
	equal(resolveTableRetainedVirtualRange({
		itemCount: 100,
		rowHeight: 38,
		viewportHeight: 380,
		scrollTop: 1938,
		overscanRows: 8,
	}, middleWindow).retained, true, 'forward movement retains a compatible middle window');
	equal(resolveTableRetainedVirtualRange({
		itemCount: 100,
		rowHeight: 38,
		viewportHeight: 380,
		scrollTop: 1634,
		overscanRows: 8,
	}, middleWindow).retained, false, 'reverse movement past the upper guard shifts the window');
	equal(resolveTableRetainedVirtualRange({
		itemCount: 100,
		rowHeight: 38,
		viewportHeight: 380,
		scrollTop: 3000,
		overscanRows: 8,
	}, middleWindow).retained, false, 'a large jump never reuses an uncovered window');
	equal(resolveTableRetainedVirtualRange({
		itemCount: 100,
		rowHeight: 44,
		viewportHeight: 440,
		scrollTop: 2200,
		overscanRows: 8,
	}, middleWindow).retained, false, 'row-height and viewport changes invalidate retention');
	const compactWindow = resolveTableVirtualRange({
		itemCount: 100,
		rowHeight: 44,
		viewportHeight: 440,
		scrollTop: 2200,
		overscanRows: 8,
	});
	equal(resolveTableRetainedVirtualRange({
		itemCount: 100,
		rowHeight: 44,
		viewportHeight: 440,
		scrollTop: 2244,
		overscanRows: 8,
	}, compactWindow).retained, true, '44px rows retain the same safety window');
	equal(resolveTableRetainedVirtualRange({
		itemCount: 100,
		rowHeight: 38,
		viewportHeight: 456,
		scrollTop: 1900,
		overscanRows: 8,
	}, middleWindow).retained, false, 'viewport-only changes invalidate retention');
	const shrunkWindow = resolveTableRetainedVirtualRange({
		itemCount: 5,
		rowHeight: 38,
		viewportHeight: 380,
		scrollTop: 1900,
		overscanRows: 8,
	}, middleWindow);
	equal(shrunkWindow.retained, false, 'item-count shrinkage invalidates the old window');
	deepEqual(
		{ startIndex: shrunkWindow.range.startIndex, endIndex: shrunkWindow.range.endIndex, scrollTop: shrunkWindow.range.scrollTop },
		{ startIndex: 0, endIndex: 5, scrollTop: 0 },
		'item-count shrinkage clamps to the new bounds',
	);
	const smallWindow = resolveTableVirtualRange({
		itemCount: 5,
		rowHeight: 38,
		viewportHeight: 114,
		scrollTop: 0,
		overscanRows: 8,
	});
	equal(resolveTableRetainedVirtualRange({
		itemCount: 5,
		rowHeight: 38,
		viewportHeight: 114,
		scrollTop: 999,
		overscanRows: 8,
	}, smallWindow).retained, true, 'a fully rendered small table remains covered after scroll clamp');
	equal(resolveTableRetainedVirtualRange({
		itemCount: 0,
		rowHeight: 38,
		viewportHeight: 380,
		scrollTop: 0,
		overscanRows: 8,
	}, null).range.endIndex, 0, 'an empty table produces an empty retained-window candidate');
	deepEqual(resolveTableVisibleRowsRenderAdmission({
		reason: 'vertical-scroll',
		hasPendingFrame: false,
		retainedRangeCovered: true,
	}), 'skip-covered');
	deepEqual(resolveTableVisibleRowsRenderAdmission({
		reason: 'vertical-scroll',
		hasPendingFrame: false,
		retainedRangeCovered: false,
	}), 'schedule');
	deepEqual(resolveTableVisibleRowsRenderAdmission({
		reason: 'required',
		hasPendingFrame: false,
		retainedRangeCovered: true,
	}), 'schedule', 'force and non-scroll invalidations bypass coverage');
	deepEqual(resolveTableVisibleRowsRenderAdmission({
		reason: 'vertical-scroll',
		hasPendingFrame: true,
		retainedRangeCovered: false,
	}), 'coalesce', 'multiple events share an already pending RAF');

	deepEqual(resolveTableGanttWheelIntent(12, 24, 0, false, 400), { horizontalDelta: 12, verticalDelta: 24 });
	deepEqual(resolveTableGanttWheelIntent(0, 3, 1, false, 400), { horizontalDelta: 0, verticalDelta: 48 });
	deepEqual(resolveTableGanttWheelIntent(2, 1, 2, false, 300), { horizontalDelta: 600, verticalDelta: 300 });
	deepEqual(resolveTableGanttWheelIntent(2, 3, 0, true, 400), { horizontalDelta: 5, verticalDelta: 0 });
	const initialGesture = createTableGanttWheelGestureState();
	deepEqual(initialGesture, {
		axis: 'pending',
		accumulatedX: 0,
		accumulatedY: 0,
		lastTimestamp: Number.NEGATIVE_INFINITY,
	});
	const verticalGesture = resolveTableGanttWheelGesture(initialGesture, { horizontalDelta: 2, verticalDelta: 12 }, 0);
	equal(verticalGesture.state.axis, 'vertical');
	deepEqual(verticalGesture.intent, { horizontalDelta: 0, verticalDelta: 12 }, 'vertical trackpad intent suppresses small horizontal noise');
	const continuedVertical = resolveTableGanttWheelGesture(verticalGesture.state, { horizontalDelta: 5, verticalDelta: 10 }, 16);
	equal(continuedVertical.state.axis, 'vertical');
	deepEqual(continuedVertical.intent, { horizontalDelta: 0, verticalDelta: 10 }, 'the dominant axis remains locked across one gesture');
	const diagonalBreakout = resolveTableGanttWheelGesture(continuedVertical.state, { horizontalDelta: 20, verticalDelta: 8 }, 32);
	equal(diagonalBreakout.state.axis, 'free');
	deepEqual(diagonalBreakout.intent, { horizontalDelta: 20, verticalDelta: 8 }, 'an intentional diagonal gesture remains available after a stronger breakout');
	const resetHorizontal = resolveTableGanttWheelGesture(diagonalBreakout.state, { horizontalDelta: 9, verticalDelta: 1 }, 200);
	equal(resetHorizontal.state.axis, 'horizontal');
	deepEqual(resetHorizontal.intent, { horizontalDelta: 9, verticalDelta: 0 }, 'a pause begins a fresh horizontal gesture');
	const pendingDiagonal = resolveTableGanttWheelGesture(initialGesture, { horizontalDelta: 9, verticalDelta: 9 }, 0);
	equal(pendingDiagonal.state.axis, 'pending');
	deepEqual(pendingDiagonal.intent, { horizontalDelta: 0, verticalDelta: 0 }, 'diagonal intent waits past the first sensitive trackpad sample');
	const confirmedDiagonal = resolveTableGanttWheelGesture(pendingDiagonal.state, { horizontalDelta: 9, verticalDelta: 9 }, 16);
	equal(confirmedDiagonal.state.axis, 'free');
	deepEqual(confirmedDiagonal.intent, { horizontalDelta: 9, verticalDelta: 9 }, 'sustained diagonal input remains available');
	deepEqual(
		resolveTableGanttWheelGesture(initialGesture, { horizontalDelta: 1, verticalDelta: 1 }, 0).intent,
		{ horizontalDelta: 0, verticalDelta: 0 },
		'ambiguous sub-threshold jitter waits for a clear axis',
	);
	equal(resolveTableGanttHoverRowIndex(100, 100, 38), 0);
	equal(resolveTableGanttHoverRowIndex(137.9, 100, 38), 0);
	equal(resolveTableGanttHoverRowIndex(138, 100, 38), 1);
	equal(resolveTableGanttHoverRowIndex(99, 100, 38), null);
	equal(resolveTableGanttHoverRowIndex(100, 100, 0), null);

	for (const kind of ['task', 'parentContext', 'group', 'groupSummary', 'summary'] as const) {
		equal(getTableGanttLaneClassName({ kind }), `operon-table-gantt-lane operon-table-gantt-lane-${kind}`);
	}

	const rootDir = process.cwd();
	const [workspaceSource, embedSource, toolbarSource, cssSource] = await Promise.all([
		readFile(path.join(rootDir, 'src/ui/table/operon-table-view.ts'), 'utf8'),
		readFile(path.join(rootDir, 'src/ui/embed-table-processor.ts'), 'utf8'),
		readFile(path.join(rootDir, 'src/ui/table/table-toolbar-composition.ts'), 'utf8'),
		readFile(path.join(rootDir, 'styles.css'), 'utf8'),
	]);
	const splitSource = await readFile(path.join(rootDir, 'src/ui/table/table-gantt-split.ts'), 'utf8');
	for (const source of [workspaceSource, embedSource]) {
		assert.match(source, /renderGantt:/);
		assert.match(source, /Platform\.isPhone/);
		assert.match(source, /bindTableGanttPaneWheel/);
		assert.match(source, /resolveTableVirtualRange/);
		assert.match(source, /bindTableGanttLinkedRowHover\(canvas, timelineCanvas, rowHeight\)/);
		assert.match(source, /row\.dataset\.operonRowIndex = String\(index\)/);
		assertions += 6;
	}
	assert.match(toolbarSource, /'settings',[\s\S]*'gantt',[\s\S]*'search'/);
	assert.match(cssSource, /\.operon-table-gantt-vertical-scroller\s*\{[\s\S]*overflow-y: scroll/);
	assert.match(cssSource, /\.operon-table-gantt-pane-body\s*\{[\s\S]*overflow-x: auto;[\s\S]*overflow-y: hidden/);
	assert.match(splitSource, /const commitPercent = clampTableGanttSplitPercent\(options\.getPercent\(\)\);[\s\S]*options\.onCommit\?\.\(commitPercent\)/);
	assert.match(splitSource, /timelineCanvas\.addEventListener\('pointermove',[\s\S]*resolveTableGanttHoverRowIndex/);
	assert.match(splitSource, /resolveTableGanttWheelGesture\(gesture, rawIntent, event\.timeStamp\)/);
	assert.match(splitSource, /axisFiltered[\s\S]*event\.preventDefault\(\)/);
	assert.match(splitSource, /TABLE_VIRTUAL_RANGE_GUARD_ROWS = 2/);
	assert.match(splitSource, /resolveTableRetainedVirtualRange/);
	assert.match(splitSource, /resolveTableVisibleRowsRenderAdmission/);
	assertions += 10;

	console.log(`Table Gantt split tests passed (${assertions} assertions).`);
}

declare global {
	var __operonTableGanttSplitTestRun: Promise<void> | undefined;
}

globalThis.__operonTableGanttSplitTestRun = run();
