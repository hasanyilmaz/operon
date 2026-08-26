import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
	TABLE_GANTT_DEFAULT_SPLIT_PERCENT,
	clampTableGanttSplitPercent,
	createTableGanttSessionState,
	getTableGanttLaneClassName,
	resolveTableGanttDividerKey,
	resolveTableGanttWheelIntent,
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
	});
	equal(clampTableGanttSplitPercent(Number.NaN), TABLE_GANTT_DEFAULT_SPLIT_PERCENT);
	equal(clampTableGanttSplitPercent(10), 20);
	equal(clampTableGanttSplitPercent(90), 80);
	equal(clampTableGanttSplitPercent(63.25), 63.25);
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

	deepEqual(resolveTableGanttWheelIntent(12, 24, 0, false, 400), { horizontalDelta: 12, verticalDelta: 24 });
	deepEqual(resolveTableGanttWheelIntent(0, 3, 1, false, 400), { horizontalDelta: 0, verticalDelta: 48 });
	deepEqual(resolveTableGanttWheelIntent(2, 1, 2, false, 300), { horizontalDelta: 600, verticalDelta: 300 });
	deepEqual(resolveTableGanttWheelIntent(2, 3, 0, true, 400), { horizontalDelta: 5, verticalDelta: 0 });

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
		assertions += 4;
	}
	assert.match(toolbarSource, /'settings',[\s\S]*'gantt',[\s\S]*'search'/);
	assert.match(cssSource, /\.operon-table-gantt-vertical-scroller\s*\{[\s\S]*overflow-y: scroll/);
	assert.match(cssSource, /\.operon-table-gantt-pane-body\s*\{[\s\S]*overflow-x: auto;[\s\S]*overflow-y: hidden/);
	assert.match(splitSource, /const commitPercent = clampTableGanttSplitPercent\(options\.getPercent\(\)\);[\s\S]*options\.onCommit\?\.\(commitPercent\)/);
	assertions += 4;

	console.log(`Table Gantt split tests passed (${assertions} assertions).`);
}

declare global {
	var __operonTableGanttSplitTestRun: Promise<void> | undefined;
}

globalThis.__operonTableGanttSplitTestRun = run();
