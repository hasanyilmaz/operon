import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
	executeTableGanttCascadeTransaction,
	normalizeTableGanttCascadeTemporalPayload,
	type TableGanttCascadeFilePlan,
} from '../src/ui/table/table-gantt-cascade-transaction';

let assertions = 0;
function equal(actual: unknown, expected: unknown, message?: string): void {
	assert.equal(actual, expected, message);
	assertions += 1;
}
function deepEqual(actual: unknown, expected: unknown, message?: string): void {
	assert.deepEqual(actual, expected, message);
	assertions += 1;
}

const files: TableGanttCascadeFilePlan[] = [
	{ filePath: 'B.md', expectedContent: 'b0', nextContent: 'b1' },
	{ filePath: 'A.md', expectedContent: 'a0', nextContent: 'a1' },
];

async function run(): Promise<void> {
	deepEqual(normalizeTableGanttCascadeTemporalPayload(
		{ estimate: '3600', status: 'open', parentTask: 'parent-a' },
		{ dateStarted: '2026-08-20', dateDue: '2026-08-27', estimate: '3600' },
		'2026-08-27T10:00:00',
	), {
		dateStarted: '2026-08-20',
		dateDue: '2026-08-27',
		estimate: '3600',
		datetimeModified: '2026-08-27T10:00:00',
	}, 'Cascade normalization preserves the exact temporal patch and only adds modified time');
	equal(normalizeTableGanttCascadeTemporalPayload(
		{ estimate: '3600' },
		{ estimate: '7200' },
		'2026-08-27T10:00:00',
	), null, 'Cascade normalization cannot change estimate duration');
	equal(normalizeTableGanttCascadeTemporalPayload(
		{ status: 'open' },
		{ status: 'scheduled' },
		'2026-08-27T10:00:00',
	), null, 'Cascade normalization rejects non-temporal task fields');

	const events: string[] = [];
	const committed = await executeTableGanttCascadeTransaction({
		files,
		recurrences: [{
			seriesId: 'series-a',
			begin: async () => { events.push('repeat:begin'); return 'repeat-tx'; },
			rollback: async () => { events.push('repeat:rollback'); return true; },
		}],
		runExclusive: async operation => await operation('permit'),
		applyFile: async file => { events.push(`write:${file.filePath}`); return 'committed'; },
		rollbackFile: async file => { events.push(`rollback:${file.filePath}`); return true; },
	});
	equal(committed, 'committed');
	deepEqual(events, ['repeat:begin', 'write:A.md', 'write:B.md'], 'Writes are deterministic and file-batched');

	events.length = 0;
	const rolledBack = await executeTableGanttCascadeTransaction({
		files,
		recurrences: [{
			seriesId: 'series-a',
			begin: async () => { events.push('repeat:begin'); return 'repeat-tx'; },
			rollback: async () => { events.push('repeat:rollback'); return true; },
		}],
		runExclusive: async operation => await operation('permit'),
		applyFile: async file => {
			events.push(`write:${file.filePath}`);
			return file.filePath === 'B.md' ? 'conflict' : 'committed';
		},
		rollbackFile: async file => { events.push(`rollback:${file.filePath}`); return true; },
	});
	equal(rolledBack, 'rolled-back');
	deepEqual(events, [
		'repeat:begin',
		'write:A.md',
		'write:B.md',
		'rollback:A.md',
		'repeat:rollback',
	], 'A later failure restores committed files and recurrence state in reverse order');

	const recoveryRequired = await executeTableGanttCascadeTransaction({
		files: [files[0]],
		recurrences: [{
			seriesId: 'series-a',
			begin: async () => 'repeat-tx',
			rollback: async () => false,
		}],
		runExclusive: async operation => await operation('permit'),
		applyFile: async () => 'failed',
		rollbackFile: async () => false,
	});
	equal(recoveryRequired, 'recovery-required', 'Rejected recurrence rollback requires recovery');

	let fileWrites = 0;
	const recurrenceRejected = await executeTableGanttCascadeTransaction({
		files,
		recurrences: [{
			seriesId: 'series-a',
			begin: async () => null,
			rollback: async () => true,
		}],
		runExclusive: async operation => await operation('permit'),
		applyFile: async () => { fileWrites += 1; return 'committed'; },
		rollbackFile: async () => true,
	});
	equal(recurrenceRejected, 'rolled-back');
	equal(fileWrites, 0, 'A rejected recurrence preflight prevents every Markdown write');

	let firstRecurrenceRolledBack = false;
	const thrownRecurrence = await executeTableGanttCascadeTransaction({
		files,
		recurrences: [
			{
				seriesId: 'series-a',
				begin: async () => 'repeat-tx',
				rollback: async () => { firstRecurrenceRolledBack = true; return true; },
			},
			{
				seriesId: 'series-b',
				begin: async () => { throw new Error('injected recurrence failure'); },
				rollback: async () => true,
			},
		],
		runExclusive: async operation => await operation('permit'),
		applyFile: async () => 'committed',
		rollbackFile: async () => true,
	});
	equal(thrownRecurrence, 'rolled-back');
	equal(firstRecurrenceRolledBack, true, 'A thrown later recurrence transaction rolls back earlier recurrence state');

	const rootDir = process.cwd();
	const [mainSource, interactionSource, workspaceSource, embedSource, modalSource] = await Promise.all([
		readFile(path.join(rootDir, 'main.ts'), 'utf8'),
		readFile(path.join(rootDir, 'src/ui/table/table-gantt-interaction.ts'), 'utf8'),
		readFile(path.join(rootDir, 'src/ui/table/operon-table-view.ts'), 'utf8'),
		readFile(path.join(rootDir, 'src/ui/embed-table-processor.ts'), 'utf8'),
		readFile(path.join(rootDir, 'src/ui/calendar/repeat-occurrence-scope-modal.ts'), 'utf8'),
	]);
	assert.match(mainSource, /tableGanttMoveOpenDescendantsWithParent[\s\S]*?context\?\.intent === 'move'/u);
	assert.match(mainSource, /tableGanttMoveOpenBlockedTasksWithBlocker[\s\S]*?collectTableGanttCascadeScope\(\{/u);
	assert.match(mainSource, /includeDependencies: cascadeOpenBlockedTasks/u);
	assert.match(mainSource, /buildTableGanttDescendantShiftPlan\(/u);
	assert.match(mainSource, /renderGuardedTaskSourceContent\(/u);
	assert.match(mainSource, /executeTableGanttCascadeTransaction</u);
	assert.match(mainSource, /reindexFilesBatch\(touchedFilePaths, \{ notify: false \}\)[\s\S]*?refreshAfterTaskMutations\(mutations/u);
	assert.match(interactionSource, /onCommit\(task, plan\.payload, \{ intent, deltaDays \}\)/u);
	assert.match(workspaceSource, /ganttWriteback\(task\.operonId, payload, context\)/u);
	assert.match(embedSource, /ganttWriteback\(task\.operonId, payload, context\)/u);
	assert.match(modalSource, /this\.options\.includeSkip !== false/u);
	assert.match(mainSource, /includeSkip: false/u);
	assertions += 12;

	console.log(`Table Gantt cascade transaction tests passed (${assertions} assertions).`);
}

globalThis.__operonTableGanttCascadeTransactionTestRun = run();

declare global {
	var __operonTableGanttCascadeTransactionTestRun: Promise<void> | undefined;
}

export {};
