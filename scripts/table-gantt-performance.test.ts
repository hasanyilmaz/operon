import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
	TableScrollPerformanceRecorder,
	type TableScrollPerformanceSummary,
} from '../src/ui/table/table-scroll-performance';

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
		match(source, /tableDomReplacements/);
		match(source, /endRafRun/);
	}
	match(rendererSource, /performanceRecorder\?: TableScrollPerformanceRecorder/);
	match(rendererSource, /ganttHeaderReplacements/);
	match(rendererSource, /ganttBodyReplacements/);
	assert.doesNotMatch(workspaceSource, /enginePerfLog\(\s*'table\.visibleRows'/);
	assert.doesNotMatch(embeddedSource, /enginePerfLog\(\s*'table\.embed\.visibleRows'/);
	assertions += 2;

	console.log(`Table Gantt performance tests passed (${assertions} assertions).`);
}

declare global {
	var __operonTableGanttPerformanceTestRun: Promise<void> | undefined;
}

globalThis.__operonTableGanttPerformanceTestRun = run();
