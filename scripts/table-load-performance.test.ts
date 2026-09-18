import assert from 'node:assert/strict';
import { beginTableLoadPerformance, type TableLoadPerformanceDependencies } from '../src/ui/table/table-load-performance';

export function testTableLoadPerformance(): void {
	let enabled = true;
	let current = true;
	let now = 0;
	let clockReads = 0;
	const frames: Array<() => void> = [];
	const emitted: Array<{ label: string; values: Record<string, number | string> }> = [];
	const dependencies: TableLoadPerformanceDependencies = {
		isEnabled: () => enabled,
		now: () => { clockReads += 1; return now; },
		scheduleFrame: callback => { frames.push(callback); },
		emit: (label, values) => { emitted.push({ label, values }); },
	};
	const owner = {} as Window;
	enabled = false;
	assert.equal(beginTableLoadPerformance('table.file.load', owner, dependencies), null);
	assert.equal(clockReads, 0);
	assert.equal(frames.length, 0);
	enabled = true;
	const trace = beginTableLoadPerformance('table.file.load', owner, dependencies)!;
	now = 2; trace.mark('loadingShell');
	now = 7; trace.mark('read');
	now = 10; trace.mark('resolve');
	now = 22; trace.mark('render');
	trace.finish('loaded', () => current);
	assert.deepEqual(emitted[0], { label: 'table.file.load', values: {
		status: 'loaded', totalMs: 22, loadingShellMs: 2, readMs: 5, resolveMs: 3, renderMs: 12,
	} });
	trace.finish('loaded', () => current);
	assert.equal(frames.length, 1, 'a trace completes once');
	now = 30; frames.shift()!();
	assert.deepEqual(emitted[1], { label: 'table.file.load.next-frame', values: { totalMs: 30, frameWaitMs: 8 } });
	const stale = beginTableLoadPerformance('table.preset.switch', owner, dependencies)!;
	current = false; stale.finish('loaded', () => current);
	assert.equal(emitted.length, 2, 'superseded navigation is not reported as successful');
	current = true;
	const pendingFrame = beginTableLoadPerformance('table.preset.switch', owner, dependencies)!;
	pendingFrame.finish('loaded', () => current);
	current = false; frames.shift()!();
	assert.equal(emitted.length, 3, 'closing or switching before the frame suppresses the stale sample');
	current = true;
	for (const status of ['invalid', 'failed'] as const) {
		beginTableLoadPerformance('table.file.load', owner, dependencies)!.finish(status, () => true);
	}
	assert.equal(frames.length, 0, 'failed and invalid loads do not produce a first-frame sample');
	const disabled = beginTableLoadPerformance('table.file.load', owner, dependencies)!;
	enabled = false; disabled.finish('loaded', () => true);
	assert.equal(emitted.length, 5);
	assert.doesNotMatch(JSON.stringify(emitted), /filePath|operonId|presetId|description/);
}
