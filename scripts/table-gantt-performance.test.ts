import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
	TableScrollPerformanceRecorder,
	type TableScrollPerformanceSummary,
} from '../src/ui/table/table-scroll-performance';
import {
	createTableVirtualRowCache,
	orderTableVirtualRowElements,
	reconcileTableVirtualRows,
	resolveTableVirtualRowKey,
} from '../src/ui/table/table-virtual-row-reconciler';
import type { TableTaskTreeRenderItem } from '../src/ui/table/table-task-tree';

let assertions = 0;

function equal<T>(actual: T, expected: T, message?: string): void {
	if (message === undefined) assert.equal(actual, expected);
	else assert.equal(actual, expected, message);
	assertions += 1;
}

function match(actual: string, expected: RegExp): void {
	assert.match(actual, expected);
	assertions += 1;
}

interface RecorderHarness {
	recorder: TableScrollPerformanceRecorder;
	summaries: TableScrollPerformanceSummary[];
	setEnabled: (enabled: boolean) => void;
	setNow: (value: number) => void;
	runIdle: () => void;
	getScheduledCount: () => number;
	getCancelledCount: () => number;
}

function createHarness(surface: 'workspace' | 'embedded', initialEnabled = true): RecorderHarness {
	let enabled = initialEnabled;
	let now = 0;
	let nextTimerId = 1;
	let scheduledCount = 0;
	let cancelledCount = 0;
	const timers = new Map<number, () => void>();
	const summaries: TableScrollPerformanceSummary[] = [];
	const recorder = new TableScrollPerformanceRecorder(surface, {
		isEnabled: () => enabled,
		now: () => now,
		scheduleIdle: callback => {
			const timerId = nextTimerId++;
			timers.set(timerId, callback);
			scheduledCount += 1;
			return timerId;
		},
		cancelIdle: timerId => {
			if (timers.delete(timerId)) cancelledCount += 1;
		},
		emit: summary => summaries.push(summary),
	});
	return {
		recorder,
		summaries,
		setEnabled: value => { enabled = value; },
		setNow: value => { now = value; },
		runIdle: () => {
			const pending = [...timers.values()];
			timers.clear();
			for (const callback of pending) callback();
		},
		getScheduledCount: () => scheduledCount,
		getCancelledCount: () => cancelledCount,
	};
}

const context = {
	ganttEnabled: true,
	taskTreeEnabled: true,
	itemCount: 100,
	columnCount: 7,
	rowHeight: 44,
};

async function run(): Promise<void> {
	{
		class FakeElement {
			parent: FakeContainer | null = null;
			constructor(readonly name: string) {}
			get nextElementSibling(): FakeElement | null {
				if (!this.parent) return null;
				const index = this.parent.children.indexOf(this);
				return this.parent.children[index + 1] ?? null;
			}
		}
		class FakeContainer {
			children: FakeElement[];
			constructor(children: FakeElement[]) {
				this.children = children;
				for (const child of children) child.parent = this;
			}
			get firstElementChild(): FakeElement | null {
				return this.children[0] ?? null;
			}
			insertBefore(element: FakeElement, reference: FakeElement | null): void {
				this.children = this.children.filter(child => child !== element);
				const index = reference ? this.children.indexOf(reference) : this.children.length;
				this.children.splice(index < 0 ? this.children.length : index, 0, element);
				element.parent = this;
			}
		}
		const a = new FakeElement('a');
		const b = new FakeElement('b');
		const c = new FakeElement('c');
		const container = new FakeContainer([a, b, c]);
		orderTableVirtualRowElements(
			container as unknown as HTMLElement,
			[b, c, a] as unknown as HTMLElement[],
		);
		assert.deepEqual(container.children.map(child => child.name), ['b', 'c', 'a']);
		assertions += 1;
		equal(container.children[2], a, 'DOM ordering moves rather than recreates retained rows');
	}

	{
		const key = (item: object): string => resolveTableVirtualRowKey(item as TableTaskTreeRenderItem);
		equal(key({ kind: 'task', ordinalKey: 'group\u0000task\u00001' }), 'task:group\u0000task\u00001');
		equal(key({ kind: 'task', ordinalKey: 'group\u0000task\u00001\u0000treeChild\u0000child' }), 'task:group\u0000task\u00001\u0000treeChild\u0000child');
		equal(key({ kind: 'parentContext', occurrenceKey: 'group\u0000parentContext\u0000task' }), 'parentContext:group\u0000parentContext\u0000task');
		equal(key({ kind: 'group', groupKey: 'parent\u0000subgroup' }), 'group:parent\u0000subgroup');
		equal(key({ kind: 'groupSummary', groupKey: 'parent\u0000subgroup' }), 'groupSummary:parent\u0000subgroup');
		equal(key({ kind: 'summary' }), 'summary:total');
	}

	{
		interface FakeRow {
			id: number;
			index: number;
			removed: boolean;
		}
		const cache = createTableVirtualRowCache<FakeRow>();
		const host = {};
		const identity = {};
		let nextId = 1;
		const removedRows: FakeRow[] = [];
		const reconcile = (
			startIndex: number,
			endIndex: number,
			forceReset = false,
			renderIdentity: object = identity,
			nextHost: object = host,
		) => reconcileTableVirtualRows({
			cache,
			host: nextHost,
			renderIdentity,
			items: ['a', 'b', 'c', 'd', 'e', 'f'],
			startIndex,
			endIndex,
			forceReset,
			resolveKey: item => item,
			createRow: descriptor => ({ id: nextId++, index: descriptor.index, removed: false }),
			updateRow: (row, descriptor) => { row.index = descriptor.index; },
			removeRow: row => {
				row.removed = true;
				removedRows.push(row);
			},
		});
		const first = reconcile(0, 4);
		equal(first.stats.created, 4);
		equal(first.stats.reused, 0);
		const retainedB = first.entries[1]?.row;
		const retainedC = first.entries[2]?.row;
		const second = reconcile(1, 5);
		equal(second.stats.created, 1);
		equal(second.stats.reused, 3);
		equal(second.stats.removed, 1);
		equal(second.stats.entered, 1);
		equal(second.stats.exited, 1);
		equal(second.entries[0]?.row, retainedB, 'Overlapping rows retain object identity');
		equal(second.entries[1]?.row, retainedC, 'A second overlapping row retains object identity');
		equal(removedRows[0]?.removed, true);
		const jump = reconcile(5, 6);
		equal(jump.stats.created, 1);
		equal(jump.stats.reused, 0);
		equal(jump.stats.removed, 4);
		const reset = reconcile(0, 2, true);
		equal(reset.stats.reset, true);
		equal(reset.stats.created, 2);
		equal(reset.stats.reused, 0);
		const empty = reconcile(2, 2);
		equal(empty.entries.length, 0);
		equal(empty.stats.removed, 2);
		const repopulated = reconcile(0, 2);
		equal(repopulated.stats.created, 2);
		const replacementIdentity = {};
		const identityReset = reconcile(0, 2, false, replacementIdentity);
		equal(identityReset.stats.reset, true);
		equal(identityReset.stats.created, 2);
		const hostReset = reconcile(0, 2, false, replacementIdentity, {});
		equal(hostReset.stats.reset, true);
		equal(hostReset.stats.created, 2);
	}

	{
		const harness = createHarness('workspace', false);
		const startedAt = harness.recorder.beginVerticalScroll(context);
		harness.recorder.recordScheduleRequest(true);
		harness.recorder.endVerticalScroll(startedAt);
		equal(startedAt, null);
		equal(harness.getScheduledCount(), 0);
		harness.runIdle();
		equal(harness.summaries.length, 0);
	}

	{
		const harness = createHarness('workspace');
		harness.setNow(10);
		const firstScroll = harness.recorder.beginVerticalScroll(context);
		harness.recorder.recordScheduleRequest(true);
		harness.recorder.recordVirtualRange(false);
		harness.setNow(12);
		harness.recorder.endVerticalScroll(firstScroll);
		harness.setNow(13);
		const secondScroll = harness.recorder.beginVerticalScroll(context);
		harness.recorder.recordScheduleRequest(false);
		harness.recorder.recordVirtualRange(true);
		const rafStartedAt = harness.recorder.beginRafRun();
		const tableStartedAt = harness.recorder.beginTiming();
		harness.setNow(17);
		harness.recorder.recordCounter('tableDomReplacements');
		harness.recorder.recordCounter('tableRowsCreated', 2);
		harness.recorder.recordCounter('tableRowsReused', 7);
		harness.recorder.recordCounter('renderScheduleSkipsCovered', 3);
		harness.recorder.recordCounter('virtualWindowRetentions', 3);
		harness.recorder.recordCounter('virtualWindowShifts');
		harness.recorder.recordCounter('ganttProjectionCacheHits', 5);
		harness.recorder.recordCounter('ganttProjectionCacheMisses');
		harness.recorder.recordCounter('ganttDependencyModelCacheHits', 4);
		harness.recorder.recordCounter('ganttDependencyModelCacheMisses', 2);
		harness.recorder.recordCounter('ganttDependencyOverlayRetentions', 3);
		harness.recorder.recordCounter('ganttDependencyRebuilds');
		harness.recorder.endTiming('tableDomBuild', tableStartedAt);
		harness.setNow(19);
		harness.recorder.endRafRun(rafStartedAt);
		harness.recorder.endVerticalScroll(secondScroll);
		equal(harness.getScheduledCount(), 2);
		equal(harness.getCancelledCount(), 1);
		equal(harness.summaries.length, 0);
		harness.runIdle();
		equal(harness.summaries.length, 1);
		const summary = harness.summaries[0];
		assert.ok(summary);
		equal(summary.surface, 'workspace');
		assert.deepEqual(summary.context, context);
		assertions += 1;
		equal(summary.counters.verticalScrollEvents, 2);
		equal(summary.counters.renderScheduleRequests, 2);
		equal(summary.counters.renderRafScheduled, 1);
		equal(summary.counters.renderRafRuns, 1);
		equal(summary.counters.changedVirtualRanges, 1);
		equal(summary.counters.stableVirtualRanges, 1);
		equal(summary.counters.tableDomReplacements, 1);
		equal(summary.counters.tableRowsCreated, 2);
		equal(summary.counters.tableRowsReused, 7);
		equal(summary.counters.renderScheduleSkipsCovered, 3);
		equal(summary.counters.virtualWindowRetentions, 3);
		equal(summary.counters.virtualWindowShifts, 1);
		equal(summary.counters.ganttProjectionCacheHits, 5);
		equal(summary.counters.ganttProjectionCacheMisses, 1);
		equal(summary.counters.ganttDependencyModelCacheHits, 4);
		equal(summary.counters.ganttDependencyModelCacheMisses, 2);
		equal(summary.counters.ganttDependencyOverlayRetentions, 3);
		equal(summary.counters.ganttDependencyRebuilds, 1);
		equal(summary.timings.scrollHandler.count, 2);
		equal(summary.timings.scrollHandler.totalMs, 8);
		equal(summary.timings.scrollHandler.p50Ms, 2);
		equal(summary.timings.scrollHandler.p95Ms, 6);
		equal(summary.timings.visibleRowsFrame.maxMs, 6);
		equal(summary.timings.tableDomBuild.maxMs, 4);
	}

	{
		const harness = createHarness('embedded');
		harness.setNow(1);
		const scrollStartedAt = harness.recorder.beginVerticalScroll({ ...context, ganttEnabled: false });
		for (let index = 0; index < 513; index += 1) {
			harness.setNow(index * 2);
			const startedAt = harness.recorder.beginTiming();
			harness.setNow((index * 2) + index);
			harness.recorder.endTiming('ganttBodyBuild', startedAt);
		}
		harness.setNow(2000);
		harness.recorder.endVerticalScroll(scrollStartedAt);
		const summary = harness.recorder.flush();
		assert.ok(summary);
		assertions += 1;
		equal(summary.surface, 'embedded');
		equal(summary.context.ganttEnabled, false);
		equal(summary.timings.ganttBodyBuild.count, 513);
		equal(summary.timings.ganttBodyBuild.maxMs, 512);
		equal(summary.timings.ganttBodyBuild.p50Ms, 256);
		equal(summary.timings.ganttBodyBuild.p95Ms, 487);
		const serialized = JSON.stringify(summary);
		assert.doesNotMatch(serialized, /operonId|description|filePath|dateStarted|dateDue|2026-/);
		assertions += 1;
	}

	{
		const harness = createHarness('workspace');
		const startedAt = harness.recorder.beginVerticalScroll(context);
		harness.recorder.endVerticalScroll(startedAt);
		equal(harness.getScheduledCount(), 1);
		harness.recorder.destroy();
		equal(harness.getCancelledCount(), 1);
		harness.runIdle();
		equal(harness.summaries.length, 0);

		const disabledAfterStart = createHarness('workspace');
		const secondStartedAt = disabledAfterStart.recorder.beginVerticalScroll(context);
		disabledAfterStart.recorder.endVerticalScroll(secondStartedAt);
		disabledAfterStart.setEnabled(false);
		disabledAfterStart.runIdle();
		equal(disabledAfterStart.summaries.length, 0);
	}

	const root = path.resolve(process.cwd());
	const workspaceSource = await readFile(path.join(root, 'src/ui/table/operon-table-view.ts'), 'utf8');
	const embeddedSource = await readFile(path.join(root, 'src/ui/embed-table-processor.ts'), 'utf8');
	const rendererSource = await readFile(path.join(root, 'src/ui/table/table-gantt-renderer.ts'), 'utf8');
	for (const source of [workspaceSource, embeddedSource]) {
		match(source, /beginVerticalScroll\(\{/);
		match(source, /verticalScrollChanged/);
		match(source, /ganttEnabled: false/);
		match(source, /recordScheduleRequest/);
		match(source, /recordVirtualRange/);
		match(source, /resolveTableRetainedVirtualRange/);
		match(source, /resolveTableVisibleRowsRenderAdmission/);
		match(source, /renderScheduleSkipsCovered/);
		match(source, /const rangeStable = rangeKey ===/);
		match(source, /reconcileTableVirtualRows\(\{/);
		match(source, /shouldRenderTableGanttTimeline/);
		match(source, /tableRowsReused/);
		match(source, /endRafRun/);
	}
	match(rendererSource, /performanceRecorder\?: TableScrollPerformanceRecorder/);
	match(rendererSource, /ganttHeaderReplacements/);
	match(rendererSource, /ganttBodyReplacements/);
	match(rendererSource, /ganttRowsReused/);
	match(rendererSource, /ganttDependencyRebuilds/);
	match(rendererSource, /ganttDependencyOverlayRetentions/);
	assert.doesNotMatch(workspaceSource, /enginePerfLog\(\s*'table\.visibleRows'/);
	assert.doesNotMatch(embeddedSource, /enginePerfLog\(\s*'table\.embed\.visibleRows'/);
	assertions += 2;

	console.log(`Table Gantt performance tests passed (${assertions} assertions).`);
}

declare global {
	var __operonTableGanttPerformanceTestRun: Promise<void> | undefined;
}

globalThis.__operonTableGanttPerformanceTestRun = run();
