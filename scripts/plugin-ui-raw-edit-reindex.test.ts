import './startup-file-events.test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { TFile } from 'obsidian';
import { OperonIndexer } from '../src/indexer/indexer';
import { TaskSourceModifyReconciler } from '../src/systems/task-source-modify-reconciliation';
import { DEFAULT_SETTINGS, type OperonSettings } from '../src/types/settings';
import { runtimeTransactionPort } from './agent-runtime/mutation/transaction-id-fixture';

interface FakeTimer {
	readonly id: number;
	readonly dueAt: number;
	readonly callback: () => void;
}

class FakeClock {
	now = 0;
	private nextId = 1;
	private readonly timers = new Map<number, FakeTimer>();

	setTimer = (callback: () => void, delayMs: number): FakeTimer => {
		const timer = { id: this.nextId++, dueAt: this.now + delayMs, callback };
		this.timers.set(timer.id, timer);
		return timer;
	};

	clearTimer = (timer: FakeTimer): void => {
		this.timers.delete(timer.id);
	};

	pendingCount(): number {
		return this.timers.size;
	}

	async advanceTo(target: number): Promise<void> {
		while (true) {
			const next = [...this.timers.values()]
				.filter(timer => timer.dueAt <= target)
				.sort((a, b) => a.dueAt - b.dueAt || a.id - b.id)[0];
			if (!next) break;
			this.timers.delete(next.id);
			this.now = next.dueAt;
			next.callback();
			await Promise.resolve();
		}
		this.now = target;
		await Promise.resolve();
	}
}

function createSchedulerHarness() {
	const clock = new FakeClock();
	const reconciliations: Array<{ filePath: string; mode: 'immediate' | 'deferred' }> = [];
	const errors: Array<{ filePath: string; error: unknown }> = [];
	const reconciler = new TaskSourceModifyReconciler<FakeTimer>({
		suppressionMs: 750,
		settleDelayMs: 25,
		now: () => clock.now,
		setTimer: clock.setTimer,
		clearTimer: clock.clearTimer,
		reconcile: async (filePath, mode) => {
			reconciliations.push({ filePath, mode });
		},
		onError: (filePath, error) => errors.push({ filePath, error }),
	});
	return { clock, reconciler, reconciliations, errors };
}

test('ordinary source modifies reconcile immediately on the shared platform route', async () => {
	const harness = createSchedulerHarness();
	assert.equal(harness.reconciler.handleModify('Tasks.md'), 'immediate');
	await Promise.resolve();
	assert.deepEqual(harness.reconciliations, [{ filePath: 'Tasks.md', mode: 'immediate' }]);
	assert.equal(harness.clock.pendingCount(), 0);
});

test('suppressed modify events coalesce into one deferred reconciliation', async () => {
	const harness = createSchedulerHarness();
	harness.reconciler.markInternalWrite('Tasks.md');
	assert.equal(harness.reconciler.handleModify('Tasks.md'), 'deferred');
	assert.equal(harness.reconciler.handleModify('Tasks.md'), 'deferred');
	assert.equal(harness.clock.pendingCount(), 1);
	await harness.clock.advanceTo(774);
	assert.deepEqual(harness.reconciliations, []);
	await harness.clock.advanceTo(775);
	assert.deepEqual(harness.reconciliations, [{ filePath: 'Tasks.md', mode: 'deferred' }]);
});

test('a later internal write extends an already scheduled reconciliation', async () => {
	const harness = createSchedulerHarness();
	harness.reconciler.markInternalWrite('Tasks.md');
	harness.reconciler.handleModify('Tasks.md');
	await harness.clock.advanceTo(500);
	harness.reconciler.markInternalWrite('Tasks.md');
	assert.equal(harness.clock.pendingCount(), 1);
	await harness.clock.advanceTo(775);
	assert.deepEqual(harness.reconciliations, []);
	await harness.clock.advanceTo(1_275);
	assert.deepEqual(harness.reconciliations, [{ filePath: 'Tasks.md', mode: 'deferred' }]);
});

test('rename transfers pending work while delete and destroy cancel it', async () => {
	const harness = createSchedulerHarness();
	harness.reconciler.markInternalWrite('Old.md');
	harness.reconciler.handleModify('Old.md');
	harness.reconciler.handleRename('Old.md', 'New.md');
	assert.equal(harness.clock.pendingCount(), 1);
	await harness.clock.advanceTo(775);
	assert.deepEqual(harness.reconciliations, [{ filePath: 'New.md', mode: 'deferred' }]);

	harness.reconciler.markInternalWrite('Deleted.md');
	harness.reconciler.handleModify('Deleted.md');
	harness.reconciler.handleDelete('Deleted.md');
	assert.equal(harness.clock.pendingCount(), 0);

	harness.reconciler.markInternalWrite('Unload.md');
	harness.reconciler.handleModify('Unload.md');
	harness.reconciler.destroy();
	assert.equal(harness.clock.pendingCount(), 0);
	await harness.clock.advanceTo(2_000);
	assert.equal(harness.reconciliations.length, 1);
});

test('committed source waits ignore unrelated work and release on delete or unload', async () => {
	const { clock, reconciler } = createSchedulerHarness();
	reconciler.markInternalWrite('Unrelated.md');
	reconciler.handleModify('Unrelated.md');
	await reconciler.awaitReconciliations(['Committed.md']);
	assert.equal(clock.pendingCount(), 1);

	reconciler.markInternalWrite('Committed.md');
	reconciler.handleModify('Committed.md');
	const deleted = reconciler.awaitReconciliations(['Committed.md']);
	reconciler.handleDelete('Committed.md');
	await deleted;
	assert.equal(clock.pendingCount(), 1);

	const unloaded = reconciler.awaitReconciliations(['Unrelated.md']);
	reconciler.destroy();
	await unloaded;
	assert.equal(clock.pendingCount(), 0);
});

function createIndexerHarness(initialContent: string) {
	const filePath = 'Tasks.md';
	const content = { value: initialContent };
	const exists = { value: true };
	const file = new (TFile as unknown as { new(path: string): TFile })(filePath);
	file.path = filePath;
	file.name = filePath;
	file.basename = 'Tasks';
	file.extension = 'md';
	file.stat = { ctime: 1, mtime: 1, size: initialContent.length };
	const app = {
		vault: {
			getMarkdownFiles: () => exists.value ? [file] : [],
			getAbstractFileByPath: (path: string) => exists.value && path === filePath ? file : null,
			read: async () => content.value,
		},
	};
	const settings: OperonSettings = { ...DEFAULT_SETTINGS, indexEventDebounceMs: 0 };
	const storage = {
		getSettings: () => settings,
		saveIndex: async () => undefined,
		loadIndex: async () => null,
	};
	return {
		content,
		exists,
		file,
		filePath,
		indexer: new OperonIndexer(app as never, storage as never),
	};
}

test('Runtime reindex waits for the delayed modify of the committed source before returning', async () => {
	const source = (type: string) => `---\noperonId: yaml001\nstatus: Project.Inbox\ntaskType: ${type}\n---\nTask body`;
	const harness = createIndexerHarness(source('Before'));
	const clock = new FakeClock();
	const reconciled: string[] = [];
	const reconciler = new TaskSourceModifyReconciler({
		suppressionMs: 750,
		settleDelayMs: 25,
		now: () => clock.now,
		setTimer: clock.setTimer,
		clearTimer: clock.clearTimer,
		reconcile: async filePath => {
			reconciled.push(filePath);
			if (filePath === harness.filePath) await harness.indexer.forceReindexFilePathAfterMutation(filePath);
		},
	});
	await harness.indexer.fullReindex();
	const reindexCommitted = runtimeTransactionPort('reindexAffectedSources', {}, {
		indexer: harness.indexer,
		taskSourceModifyReconciler: reconciler,
	});
	const changeSource = (type: string) => {
		harness.content.value = source(type);
		harness.file.stat.mtime += 1;
		harness.file.stat.size = harness.content.value.length;
	};

	for (const [index, type] of ['First', 'Second'].entries()) {
		const start = clock.now;
		reconciler.markInternalWrite(harness.filePath);
		changeSource(type);
		assert.equal(reconciler.handleModify(harness.filePath), 'deferred');
		let published = false;
		const postflight = reindexCommitted([harness.filePath]).then(() => { published = true; });
		await harness.indexer.awaitRamSettlement();
		await clock.advanceTo(start + 774);
		await new Promise<void>(resolve => setImmediate(resolve));
		assert.equal(published, false, 'Runtime must not acknowledge a write with its modify still pending');
		await clock.advanceTo(start + 775);
		await postflight;
		assert.equal(reconciled.length, index + 1);
		assert.equal(harness.indexer.getTask('yaml001')?.fieldValues.taskType, type);
		const revisionAfterApply = harness.indexer.getGeneration();
		await clock.advanceTo(start + 1_600);
		assert.equal(harness.indexer.getGeneration(), revisionAfterApply, 'The next plan keeps the same RAM revision');
	}

	const sealedGeneration = harness.indexer.getGeneration();
	changeSource('External edit');
	assert.equal(reconciler.handleModify(harness.filePath), 'immediate');
	await harness.indexer.awaitRamSettlement();
	assert.ok(harness.indexer.getGeneration() > sealedGeneration, 'An external edit still invalidates the earlier RAM revision');
	assert.equal(harness.indexer.getTask('yaml001')?.fieldValues.taskType, 'External edit');
});

async function verifyDeferredSourceChange(input: {
	readonly initialContent: string;
	readonly nextContent: string;
	readonly operonId: string;
	readonly expectedStatus?: string;
}): Promise<void> {
	const harness = createIndexerHarness(input.initialContent);
	await harness.indexer.fullReindex();
	assert.ok(harness.indexer.getTask(input.operonId));
	let removedCount = 0;
	let indexUpdateCount = 0;
	harness.indexer.onTasksRemoved = removed => { removedCount += removed.length; };
	harness.indexer.onIndexUpdated = () => { indexUpdateCount += 1; };

	const clock = new FakeClock();
	let reconciliationDone!: () => void;
	const settled = new Promise<void>(resolve => { reconciliationDone = resolve; });
	const reconciler = new TaskSourceModifyReconciler<FakeTimer>({
		suppressionMs: 750,
		settleDelayMs: 25,
		now: () => clock.now,
		setTimer: clock.setTimer,
		clearTimer: clock.clearTimer,
		reconcile: async filePath => {
			await harness.indexer.forceReindexFilePathAfterMutation(filePath);
			reconciliationDone();
		},
	});
	reconciler.markInternalWrite(harness.filePath);
	harness.content.value = input.nextContent;
	harness.file.stat.mtime += 1;
	harness.file.stat.size = input.nextContent.length;
	assert.equal(reconciler.handleModify(harness.filePath), 'deferred');
	await clock.advanceTo(775);
	await settled;

	if (input.expectedStatus) {
		assert.equal(harness.indexer.getTask(input.operonId)?.fieldValues.status, input.expectedStatus);
		assert.equal(removedCount, 0);
	} else {
		assert.equal(harness.indexer.getTask(input.operonId), undefined);
		assert.equal(removedCount, 1);
	}
	assert.equal(indexUpdateCount, 1);
}

test('inline deletion inside suppression removes the stale indexed task', async () => {
	await verifyDeferredSourceChange({
		initialContent: '- [ ] Inline task {{operonId:: inline1}} {{status:: Project.Inbox}}',
		nextContent: '',
		operonId: 'inline1',
	});
});

test('removing a YAML task identity inside suppression removes the File Task', async () => {
	await verifyDeferredSourceChange({
		initialContent: '---\noperonId: yaml001\nstatus: Project.Inbox\n---\nTask body',
		nextContent: '---\nstatus: Project.Inbox\n---\nTask body',
		operonId: 'yaml001',
	});
});

test('a raw field edit inside suppression publishes the final source value', async () => {
	await verifyDeferredSourceChange({
		initialContent: '- [ ] Inline task {{operonId:: inline1}} {{status:: Project.Inbox}}',
		nextContent: '- [ ] Inline task {{operonId:: inline1}} {{status:: Project.Planned}}',
		operonId: 'inline1',
		expectedStatus: 'Project.Planned',
	});
});

test('a source removed before deferred reconciliation uses the file-delete path', async () => {
	const harness = createIndexerHarness(
		'- [ ] Inline task {{operonId:: inline1}} {{status:: Project.Inbox}}',
	);
	await harness.indexer.fullReindex();
	assert.ok(harness.indexer.getTask('inline1'));
	let removedCount = 0;
	harness.indexer.onTasksRemoved = removed => { removedCount += removed.length; };

	const clock = new FakeClock();
	let reconciliationDone!: () => void;
	const settled = new Promise<void>(resolve => { reconciliationDone = resolve; });
	const reconciler = new TaskSourceModifyReconciler<FakeTimer>({
		suppressionMs: 750,
		settleDelayMs: 25,
		now: () => clock.now,
		setTimer: clock.setTimer,
		clearTimer: clock.clearTimer,
		reconcile: async filePath => {
			if (harness.exists.value) {
				await harness.indexer.forceReindexFilePathAfterMutation(filePath);
			} else {
				await harness.indexer.handleFileDelete(filePath);
			}
			reconciliationDone();
		},
	});
	reconciler.markInternalWrite(harness.filePath);
	assert.equal(reconciler.handleModify(harness.filePath), 'deferred');
	harness.exists.value = false;
	await clock.advanceTo(775);
	await settled;
	assert.equal(harness.indexer.getTask('inline1'), undefined);
	assert.equal(removedCount, 1);
});

test('main wiring defers suppressed events and forces exact reconciliation without platform forks', () => {
	const mainSource = readFileSync('main.ts', 'utf8');
	const watcherStart = mainSource.indexOf('private registerFileWatchers()');
	const watcherEnd = mainSource.indexOf('\n\tprivate registerLivePreviewSessionWatchers()', watcherStart);
	const watcher = mainSource.slice(watcherStart, watcherEnd);
	assert.match(watcher, /taskSourceModifyReconciler\?\.handleModify\(file\.path\)/u);
	assert.match(watcher, /taskSourceModifyReconciler\?\.handleDelete\(file\.path\)/u);
	assert.match(watcher, /taskSourceModifyReconciler\?\.handleRename\(oldPath, file\.path\)/u);
	assert.doesNotMatch(watcher, /Platform\./u);
	assert.doesNotMatch(watcher, /shouldSuppressInternalTaskWrite/u);

	const reconcileStart = mainSource.indexOf('private async reconcileTaskSourceModify(');
	const reconcileEnd = mainSource.indexOf('\n\tprivate applyFieldRulesToTaskPayload(', reconcileStart);
	const reconcile = mainSource.slice(reconcileStart, reconcileEnd);
	const normalize = reconcile.indexOf('await this.normalizeWorkflowStateAfterRawEdit(filePath, canContinue)');
	const forceReindex = reconcile.indexOf('await this.indexer.forceReindexFilePathAfterMutation(filePath)', normalize);
	assert.ok(normalize >= 0 && forceReindex > normalize);
	assert.match(reconcile, /await this\.indexer\.handleFileDelete\(filePath\)/u);
	assert.match(mainSource, /onunload\(\): void \{[\s\S]*?taskSourceModifyReconciler\?\.destroy\(\)/u);
});
