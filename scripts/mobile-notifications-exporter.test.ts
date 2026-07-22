import assert from 'node:assert/strict';
import { buildMobileNotificationsSnapshot, formatOffsetInstant } from '../src/core/mobile-notifications-snapshot';
import {
	MobileNotificationsExporter,
	readExistingMobileNotificationsVaultId,
	writeMobileNotificationsSnapshotAtomically,
} from '../src/systems/mobile-notifications-exporter';
import { DEFAULT_SETTINGS } from '../src/types/settings';
import type { IndexedTask } from '../src/types/fields';
import type { IndexReconciliationEvent } from '../src/indexer/indexer';

const VAULT_ID = '11111111-2222-4333-8444-555555555555';
const nowMs = new Date(2026, 6, 21, 12, 0, 0).getTime();

function localDatetime(epochMs: number): string {
	const date = new Date(epochMs);
	const pad = (value: number): string => String(value).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function task(description = 'Snapshot task'): IndexedTask {
	return {
		operonId: 'snapshot-task',
		description,
		checkbox: 'open',
		fieldValues: {
			reminderDatetimes: localDatetime(nowMs + 60 * 60_000),
			reminderRules: 'datetimeStart.30m',
			datetimeStart: localDatetime(nowMs + 90 * 60_000),
			taskIcon: 'lucide-rocket',
			taskColor: '12abEF',
		},
		tags: [],
		primary: { filePath: '20 Projects/Snapshot.md', lineNumber: 3, format: 'inline' },
		datetimeModified: localDatetime(nowMs),
		tier: 'hot',
	};
}

function taskAt(operonId: string, reminderEpochMs: number): IndexedTask {
	return {
		...task(operonId),
		operonId,
		fieldValues: { reminderDatetimes: localDatetime(reminderEpochMs) },
		primary: { filePath: `20 Projects/${operonId}.md`, lineNumber: 0, format: 'inline' },
	};
}

class MemoryAdapter {
	readonly files = new Map<string, string>();
	readonly folders = new Set<string>();
	writes = 0;
	async exists(path: string): Promise<boolean> { return this.files.has(path) || this.folders.has(path); }
	async mkdir(path: string): Promise<void> { this.folders.add(path); }
	async read(path: string): Promise<string> {
		const value = this.files.get(path);
		if (value === undefined) throw new Error('ENOENT');
		return value;
	}
	async write(path: string, value: string): Promise<void> { this.writes += 1; this.files.set(path, value); }
	async remove(path: string): Promise<void> { this.files.delete(path); }
	async rename(from: string, to: string): Promise<void> {
		const value = this.files.get(from);
		if (value === undefined) throw new Error('ENOENT');
		this.files.delete(from);
		this.files.set(to, value);
	}
}

class FailingReplacementAdapter extends MemoryAdapter {
	renames = 0;
	override async rename(from: string, to: string): Promise<void> {
		this.renames += 1;
		if (this.renames === 2) throw new Error('REPLACE_FAILED');
		await super.rename(from, to);
	}
}

class FailingFirstWriteAdapter extends MemoryAdapter {
	failWrites = true;
	override async write(path: string, value: string): Promise<void> {
		if (this.failWrites) throw new Error('TRANSIENT_WRITE_FAILURE');
		await super.write(path, value);
	}
}

class FakeWindow {
	private nextId = 1;
	readonly timers = new Map<number, { callback: () => void; delay: number }>();
	setTimeout(callback: () => void, delay = 0): number { const id = this.nextId++; this.timers.set(id, { callback, delay }); return id; }
	clearTimeout(id: number): void { this.timers.delete(id); }
	runNext(): void {
		const entry = [...this.timers.entries()].sort((left, right) => left[1].delay - right[1].delay)[0];
		if (!entry) return;
		this.timers.delete(entry[0]);
		entry[1].callback();
	}
}

class FakeIndexer {
	readonly tasks = new Map<string, IndexedTask>();
	private listeners = new Set<(event: IndexReconciliationEvent) => void>();
	getAllTasks(): IndexedTask[] { return [...this.tasks.values()]; }
	getTask(operonId: string): IndexedTask | undefined { return this.tasks.get(operonId); }
	hasDuplicateOperonIdConflict(): boolean { return false; }
	subscribeIndexReconciliation(listener: (event: IndexReconciliationEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	emit(event: IndexReconciliationEvent): void { for (const listener of this.listeners) listener(event); }
}

async function run(): Promise<void> {
	const snapshot = buildMobileNotificationsSnapshot({
		tasks: [task()],
		generatedAtEpochMs: nowMs,
		vaultId: VAULT_ID,
		vaultName: 'Stratejya Next',
		timezone: 'Europe/Berlin',
		catchUpMinutes: 60,
		appearanceSettings: DEFAULT_SETTINGS,
		isDuplicateOperonId: () => false,
	});
	globalThis.__operonMobileNotificationsSample = snapshot;
	assert.equal(snapshot.tasks.length, 1);
	assert.equal(snapshot.tasks[0]?.notifications.length, 1, 'same-epoch sources merge');
	assert.deepEqual(snapshot.tasks[0]?.notifications[0]?.sources, [
		{ kind: 'reminderDatetime' },
		{ kind: 'reminderRule' },
	]);
	assert.equal(snapshot.tasks[0]?.appearance.taskIcon, 'rocket');
	assert.equal(snapshot.tasks[0]?.appearance.taskColor, '#12abEF');
	assert.equal(snapshot.tasks[0]?.taskStart?.epochMs, nowMs + 90 * 60_000);
	assert.equal(snapshot.tasks[0]?.notifications[0]?.triggerAt, '2026-07-21T13:00:00+02:00');
	assert.throws(() => buildMobileNotificationsSnapshot({
		tasks: [task()], generatedAtEpochMs: nowMs, vaultId: 'not-a-uuid', vaultName: 'Stratejya Next',
		timezone: 'Europe/Berlin', catchUpMinutes: 60, appearanceSettings: DEFAULT_SETTINGS,
		isDuplicateOperonId: () => false,
	}), /vault id/u);
	assert.throws(() => buildMobileNotificationsSnapshot({
		tasks: [task()], generatedAtEpochMs: nowMs, vaultId: VAULT_ID, vaultName: 'Stratejya Next',
		timezone: 'Not/A-Timezone', catchUpMinutes: 60, appearanceSettings: DEFAULT_SETTINGS,
		isDuplicateOperonId: () => false,
	}), /timezone/u);
	const duplicateExcluded = buildMobileNotificationsSnapshot({
		tasks: [task()], generatedAtEpochMs: nowMs, vaultId: VAULT_ID, vaultName: 'Stratejya Next',
		timezone: 'Europe/Berlin', catchUpMinutes: 60, appearanceSettings: DEFAULT_SETTINGS,
		isDuplicateOperonId: () => true,
	});
	assert.deepEqual(duplicateExcluded.tasks, [], 'duplicate-id tasks are excluded fail closed');
	const unsafeTask = { ...task(), primary: { ...task().primary, filePath: '../Unsafe.md' } };
	const unresolvedTask = {
		...task(),
		operonId: 'unresolved-rule',
		fieldValues: { reminderRules: 'datetimeStart.30m' },
		primary: { filePath: '20 Projects/Unresolved.md', lineNumber: 0, format: 'inline' as const },
	};
	assert.throws(() => buildMobileNotificationsSnapshot({
		tasks: [unsafeTask], generatedAtEpochMs: nowMs, vaultId: VAULT_ID, vaultName: 'Stratejya Next',
		timezone: 'Europe/Berlin', catchUpMinutes: 60, appearanceSettings: DEFAULT_SETTINGS,
		isDuplicateOperonId: () => false,
	}), /unsafe mobile notification source path/u);
	const unresolvedSources = buildMobileNotificationsSnapshot({
		tasks: [unresolvedTask], generatedAtEpochMs: nowMs, vaultId: VAULT_ID, vaultName: 'Stratejya Next',
		timezone: 'Europe/Berlin', catchUpMinutes: 60, appearanceSettings: DEFAULT_SETTINGS,
		isDuplicateOperonId: () => false,
	});
	assert.deepEqual(unresolvedSources.tasks, [], 'unresolved rules do not create incomplete notifications');

	const windowStart = nowMs - 60 * 60_000;
	const windowEnd = nowMs + 7 * 24 * 60 * 60_000;
	const boundarySnapshot = buildMobileNotificationsSnapshot({
		tasks: [
			taskAt('end-exclusive', windowEnd),
			taskAt('same-b', nowMs + 2 * 60_000),
			taskAt('start-inclusive', windowStart),
			taskAt('same-a', nowMs + 2 * 60_000),
			taskAt('before-end', windowEnd - 1_000),
		],
		generatedAtEpochMs: nowMs, vaultId: VAULT_ID, vaultName: 'Stratejya Next', timezone: 'Europe/Berlin',
		catchUpMinutes: 60, appearanceSettings: DEFAULT_SETTINGS, isDuplicateOperonId: () => false,
	});
	assert.deepEqual(
		boundarySnapshot.tasks.map(item => item.operonId),
		['start-inclusive', 'same-a', 'same-b', 'before-end'],
		'window is inclusive/exclusive and task order is earliest epoch then operonId',
	);

	const fallbackTask = task();
	delete fallbackTask.fieldValues.taskIcon;
	fallbackTask.fieldValues.datetimeStart = 'not-a-datetime';
	const fallbackSnapshot = buildMobileNotificationsSnapshot({
		tasks: [fallbackTask], generatedAtEpochMs: nowMs, vaultId: VAULT_ID, vaultName: 'Stratejya Next',
		timezone: 'Europe/Berlin', catchUpMinutes: 60, appearanceSettings: DEFAULT_SETTINGS,
		isDuplicateOperonId: () => false,
	});
	assert.equal(fallbackSnapshot.tasks[0]?.appearance.taskIcon, DEFAULT_SETTINGS.fallbackStateIcons.open);
	assert.equal(fallbackSnapshot.tasks[0]?.taskStart, null, 'invalid task starts remain null rather than using another date');
	const lowYearTask = task();
	lowYearTask.fieldValues.datetimeStart = '0001-01-02T03:04:05';
	const lowYearSnapshot = buildMobileNotificationsSnapshot({
		tasks: [lowYearTask], generatedAtEpochMs: nowMs, vaultId: VAULT_ID, vaultName: 'Stratejya Next',
		timezone: 'Europe/Berlin', catchUpMinutes: 60, appearanceSettings: DEFAULT_SETTINGS,
		isDuplicateOperonId: () => false,
	});
	assert.equal(lowYearSnapshot.tasks[0]?.taskStart?.localDatetime, '0001-01-02T03:04:05');
	assert.equal(formatOffsetInstant(Date.parse('2026-10-25T00:30:00Z'), 'Europe/Berlin'), '2026-10-25T02:30:00+02:00');
	assert.equal(formatOffsetInstant(Date.parse('2026-10-25T01:30:00Z'), 'Europe/Berlin'), '2026-10-25T02:30:00+01:00');

	const disabled = buildMobileNotificationsSnapshot({
		tasks: [task()],
		generatedAtEpochMs: nowMs,
		vaultId: VAULT_ID,
		vaultName: 'Stratejya Next',
		timezone: 'Europe/Berlin',
		catchUpMinutes: 60,
		appearanceSettings: DEFAULT_SETTINGS,
		isDuplicateOperonId: () => false,
		enabled: false,
	});
	assert.deepEqual(disabled.tasks, []);
	assert.deepEqual(disabled.sourcePolicy, { reminderDatetimes: false, reminderRules: false, datetimeStart: false });

	const adapter = new MemoryAdapter();
	const indexer = new FakeIndexer();
	indexer.tasks.set('snapshot-task', task());
	const ownerWindow = new FakeWindow();
	let enabled = true;
	let watermark = -1;
	let cancelAllPublished = 0;
	const path = '.obsidian/plugins/operon/state/mobile-notifications.json';
	const exporter = new MobileNotificationsExporter({
		app: {
			vault: { adapter, configDir: '.obsidian', getName: () => 'Stratejya Next' },
			workspace: { containerEl: { ownerDocument: { defaultView: ownerWindow } } },
		} as never,
		indexer,
		getEnabled: () => enabled,
		producerState: {
			getOrCreateVaultId: async () => VAULT_ID,
			reserveGeneratedAtEpochMs: async (now, minimumExclusive) => {
				watermark = Math.max(now, watermark + 1, minimumExclusive + 1);
				return watermark;
			},
			markCancelAllPublished: async () => { cancelAllPublished += 1; },
		},
		getCatchUpMinutes: () => 60,
		getAppearanceSettings: () => DEFAULT_SETTINGS,
		isSystemReminderFieldEnabled: () => true,
		getTimezone: () => 'Europe/Berlin',
		now: () => nowMs,
		ownerWindow: ownerWindow as never,
		path,
	});
	await exporter.start();
	assert.equal(cancelAllPublished, 0, 'enabled publication never clears a newer cancel intent');
	assert.equal(adapter.writes, 1, 'startup writes one complete temp snapshot');
	assert.equal(adapter.folders.has('.obsidian/plugins/operon/state'), true, 'parent state directory is created');
	assert.equal(await readExistingMobileNotificationsVaultId(adapter as never, path), VAULT_ID, 'existing valid identity is adoptable');

	indexer.emit({ kind: 'incremental', generation: 1, affectedOperonIds: ['snapshot-task'] });
	ownerWindow.runNext();
	await exporter.flush();
	assert.equal(adapter.writes, 1, 'unchanged incremental reconciliation does not rewrite synced state');

	indexer.tasks.set('snapshot-task', task('Updated snapshot task'));
	indexer.emit({ kind: 'incremental', generation: 2, affectedOperonIds: ['snapshot-task'] });
	ownerWindow.runNext();
	await exporter.flush();
	assert.equal(adapter.writes, 2, 'affected task is rebuilt and exported incrementally');

	enabled = false;
	await exporter.handleSettingsChanged();
	const finalSnapshot = JSON.parse(adapter.files.get(path) ?? '{}') as { enabled?: boolean; tasks?: unknown[] };
	assert.equal(finalSnapshot.enabled, false);
	assert.deepEqual(finalSnapshot.tasks, []);
	assert.equal(cancelAllPublished, 1, 'only a published disabled snapshot clears the cancel intent');
	await exporter.destroy();

	const malformedAdapter = new MemoryAdapter();
	const malformedIndexer = new FakeIndexer();
	malformedIndexer.tasks.set('valid-candidate', taskAt('valid-candidate', nowMs + 60 * 60_000));
	malformedIndexer.tasks.set('invalid-candidate', taskAt('invalid-candidate', nowMs + 2 * 60 * 60_000));
	const malformedWindow = new FakeWindow();
	let malformedWatermark = -1;
	const malformedExporter = new MobileNotificationsExporter({
		app: {
			vault: { adapter: malformedAdapter, configDir: '.obsidian', getName: () => 'Stratejya Next' },
			workspace: { containerEl: { ownerDocument: { defaultView: malformedWindow } } },
		} as never,
		indexer: malformedIndexer,
		getEnabled: () => true,
		producerState: {
			getOrCreateVaultId: async () => VAULT_ID,
			reserveGeneratedAtEpochMs: async (now, minimum) => (
				malformedWatermark = Math.max(now, minimum + 1, malformedWatermark + 1)
			),
		},
		getCatchUpMinutes: () => 60,
		getAppearanceSettings: () => DEFAULT_SETTINGS,
		isSystemReminderFieldEnabled: () => true,
		getTimezone: () => 'Europe/Berlin',
		now: () => nowMs,
		ownerWindow: malformedWindow as never,
		path,
	});
	await malformedExporter.start();
	const initialMixedSnapshot = JSON.parse(malformedAdapter.files.get(path) ?? '{}') as {
		tasks?: Array<{ operonId: string }>;
	};
	assert.deepEqual(
		initialMixedSnapshot.tasks?.map(item => item.operonId),
		['valid-candidate', 'invalid-candidate'],
		'initial valid candidates establish the stale occurrence regression precondition',
	);
	const updatedValidCandidate = taskAt('valid-candidate', nowMs + 90 * 60_000);
	updatedValidCandidate.description = 'Updated valid candidate';
	malformedIndexer.tasks.set('valid-candidate', updatedValidCandidate);
	const malformedCandidate = taskAt('invalid-candidate', nowMs + 2 * 60 * 60_000);
	malformedCandidate.primary = { ...malformedCandidate.primary, filePath: '../Unsafe.md' };
	malformedIndexer.tasks.set('invalid-candidate', malformedCandidate);
	let malformedWarningCaptured = false;
	const malformedOriginalWarn = console.warn;
	console.warn = (...args: unknown[]) => {
		if (String(args[0]).includes('skipped malformed mobile notification candidate')) {
			malformedWarningCaptured = true;
		} else {
			malformedOriginalWarn(...args);
		}
	};
	try {
		malformedIndexer.emit({
			kind: 'incremental',
			generation: 1,
			affectedOperonIds: ['invalid-candidate', 'valid-candidate'],
		});
		malformedWindow.runNext();
		await malformedExporter.flush();
	} finally {
		console.warn = malformedOriginalWarn;
	}
	const recoveredMixedSnapshot = JSON.parse(malformedAdapter.files.get(path) ?? '{}') as {
		tasks?: Array<{ operonId: string; description: string }>;
	};
	assert.equal(malformedWarningCaptured, true, 'the malformed candidate is reported without failing the batch');
	assert.deepEqual(recoveredMixedSnapshot.tasks?.map(item => ({
		operonId: item.operonId,
		description: item.description,
	})), [{
		operonId: 'valid-candidate',
		description: 'Updated valid candidate',
	}], 'the stale invalid occurrence is removed while the valid candidate is still published');
	await malformedExporter.destroy();

	const drainAdapter = new MemoryAdapter();
	const drainIndexer = new FakeIndexer();
	drainIndexer.tasks.set('snapshot-task', task());
	const drainWindow = new FakeWindow();
	let drainWatermark = -1;
	const drainExporter = new MobileNotificationsExporter({
		app: {
			vault: { adapter: drainAdapter, configDir: '.obsidian', getName: () => 'Stratejya Next' },
			workspace: { containerEl: { ownerDocument: { defaultView: drainWindow } } },
		} as never,
		indexer: drainIndexer,
		getEnabled: () => true,
		producerState: {
			getOrCreateVaultId: async () => VAULT_ID,
			reserveGeneratedAtEpochMs: async (now, minimum) => (drainWatermark = Math.max(now, minimum + 1, drainWatermark + 1)),
		},
		getCatchUpMinutes: () => 60,
		getAppearanceSettings: () => DEFAULT_SETTINGS,
		isSystemReminderFieldEnabled: () => true,
		getTimezone: () => 'Europe/Berlin',
		now: () => nowMs,
		ownerWindow: drainWindow as never,
		path,
	});
	await drainExporter.start();
	drainIndexer.tasks.set('snapshot-task', task('Unload-drained update'));
	drainIndexer.emit({ kind: 'incremental', generation: 3, affectedOperonIds: ['snapshot-task'] });
	await drainExporter.destroy();
	const drained = JSON.parse(drainAdapter.files.get(path) ?? '{}') as { enabled?: boolean; tasks?: Array<{ description: string }> };
	assert.equal(drained.enabled, true, 'unload does not write a disabled control message');
	assert.equal(drained.tasks?.[0]?.description, 'Unload-drained update', 'unload drains pending affected ids');

	const rollbackAdapter = new MemoryAdapter();
	const rollbackIndexer = new FakeIndexer();
	rollbackIndexer.tasks.set('snapshot-task', task());
	const rollbackWindow = new FakeWindow();
	let rollbackEnabled = true;
	const rollbackExporter = new MobileNotificationsExporter({
		app: {
			vault: { adapter: rollbackAdapter, configDir: '.obsidian', getName: () => 'Stratejya Next' },
			workspace: { containerEl: { ownerDocument: { defaultView: rollbackWindow } } },
		} as never,
		indexer: rollbackIndexer,
		getEnabled: () => rollbackEnabled,
		producerState: {
			getOrCreateVaultId: async () => VAULT_ID,
			reserveGeneratedAtEpochMs: async () => nowMs + 5 * 60_000 + 1,
		},
		getCatchUpMinutes: () => 60,
		getAppearanceSettings: () => DEFAULT_SETTINGS,
		isSystemReminderFieldEnabled: () => true,
		getTimezone: () => 'Europe/Berlin',
		now: () => nowMs,
		ownerWindow: rollbackWindow as never,
		path,
	});
	const originalWarn = console.warn;
	let rollbackWarningCaptured = false;
	console.warn = (...args: unknown[]) => {
		if (String(args[0]).includes('mobile notifications snapshot export failed')) rollbackWarningCaptured = true;
		else originalWarn(...args);
	};
	try {
		await rollbackExporter.start();
	} finally {
		console.warn = originalWarn;
	}
	assert.equal(rollbackWarningCaptured, true, 'the expected clock-rollback failure follows the exporter diagnostic path');
	assert.equal(rollbackAdapter.writes, 0, 'a watermark beyond Android clock tolerance fails closed');
	assert.equal(rollbackWindow.timers.size > 0, true, 'failed reservation retains work on a bounded retry timer');
	rollbackEnabled = false;
	await rollbackExporter.destroy();

	const retryAdapter = new FailingFirstWriteAdapter();
	const retryIndexer = new FakeIndexer();
	retryIndexer.tasks.set('snapshot-task', task());
	const retryWindow = new FakeWindow();
	let retryWatermark = -1;
	const retryExporter = new MobileNotificationsExporter({
		app: {
			vault: { adapter: retryAdapter, configDir: '.obsidian', getName: () => 'Stratejya Next' },
			workspace: { containerEl: { ownerDocument: { defaultView: retryWindow } } },
		} as never,
		indexer: retryIndexer,
		getEnabled: () => true,
		producerState: {
			getOrCreateVaultId: async () => VAULT_ID,
			reserveGeneratedAtEpochMs: async (now, minimum) => (retryWatermark = Math.max(now, minimum + 1, retryWatermark + 1)),
		},
		getCatchUpMinutes: () => 60,
		getAppearanceSettings: () => DEFAULT_SETTINGS,
		isSystemReminderFieldEnabled: () => true,
		getTimezone: () => 'Europe/Berlin',
		now: () => nowMs,
		ownerWindow: retryWindow as never,
		path,
	});
	const retryOriginalWarn = console.warn;
	console.warn = () => {};
	try {
		await retryExporter.start();
	} finally {
		console.warn = retryOriginalWarn;
	}
	assert.equal(retryAdapter.files.has(path), false, 'transient startup failure preserves the prior file state');
	retryAdapter.failWrites = false;
	retryWindow.runNext();
	await retryExporter.flush();
	assert.equal(retryAdapter.files.has(path), true, 'retained startup work succeeds on bounded retry');
	await retryExporter.destroy();

	const identityAdapter = new MemoryAdapter();
	const identityWindow = new FakeWindow();
	let identityAttempts = 0;
	let identityWatermark = -1;
	const identityExporter = new MobileNotificationsExporter({
		app: {
			vault: { adapter: identityAdapter, configDir: '.obsidian', getName: () => 'Stratejya Next' },
			workspace: { containerEl: { ownerDocument: { defaultView: identityWindow } } },
		} as never,
		indexer: retryIndexer,
		getEnabled: () => true,
		producerState: {
			getOrCreateVaultId: async () => {
				identityAttempts += 1;
				if (identityAttempts === 1) throw new Error('IDENTITY_WRITE_FAILED');
				return VAULT_ID;
			},
			reserveGeneratedAtEpochMs: async (now, minimum) => (
				identityWatermark = Math.max(now, minimum + 1, identityWatermark + 1)
			),
		},
		getCatchUpMinutes: () => 60,
		getAppearanceSettings: () => DEFAULT_SETTINGS,
		isSystemReminderFieldEnabled: () => true,
		getTimezone: () => 'Europe/Berlin',
		now: () => nowMs,
		ownerWindow: identityWindow as never,
		path,
	});
	console.warn = () => {};
	try {
		await identityExporter.start();
	} finally {
		console.warn = retryOriginalWarn;
	}
	assert.equal(identityAdapter.files.has(path), false, 'identity persistence failure stays isolated from startup');
	identityWindow.runNext();
	await identityExporter.flush();
	assert.equal(identityAdapter.files.has(path), true, 'identity initialization is retried before activation');
	await identityExporter.destroy();

	const cancelAdapter = new FailingFirstWriteAdapter();
	const cancelWindow = new FakeWindow();
	let cancelPending = true;
	let cancelWatermark = -1;
	const createCancelExporter = () => new MobileNotificationsExporter({
		app: {
			vault: { adapter: cancelAdapter, configDir: '.obsidian', getName: () => 'Stratejya Next' },
			workspace: { containerEl: { ownerDocument: { defaultView: cancelWindow } } },
		} as never,
		indexer: retryIndexer,
		getEnabled: () => false,
		producerState: {
			isCancelPending: () => cancelPending,
			getOrCreateVaultId: async () => VAULT_ID,
			reserveGeneratedAtEpochMs: async (now, minimum) => (
				cancelWatermark = Math.max(now, minimum + 1, cancelWatermark + 1)
			),
			markCancelAllPublished: async () => { cancelPending = false; },
		},
		getCatchUpMinutes: () => 60,
		getAppearanceSettings: () => DEFAULT_SETTINGS,
		isSystemReminderFieldEnabled: () => true,
		getTimezone: () => 'Europe/Berlin',
		now: () => nowMs,
		ownerWindow: cancelWindow as never,
		path,
	});
	const failedCancelExporter = createCancelExporter();
	console.warn = () => {};
	try {
		await failedCancelExporter.start();
	} finally {
		console.warn = retryOriginalWarn;
	}
	assert.equal(cancelPending, true, 'failed disabled snapshot keeps a durable cancel intent');
	await failedCancelExporter.destroy();
	cancelAdapter.failWrites = false;
	const restartedCancelExporter = createCancelExporter();
	await restartedCancelExporter.start();
	const restartedCancel = JSON.parse(cancelAdapter.files.get(path) ?? '{}') as { enabled?: boolean };
	assert.equal(restartedCancel.enabled, false, 'disabled startup completes the retained cancel-all intent');
	assert.equal(cancelPending, false, 'successful cancel-all clears the durable intent');
	await restartedCancelExporter.destroy();

	const mobileAdapter = new MemoryAdapter();
	const mobileExporter = new MobileNotificationsExporter({
		app: {
			vault: { adapter: mobileAdapter, configDir: '.obsidian', getName: () => 'Stratejya Next' },
			workspace: { containerEl: { ownerDocument: { defaultView: cancelWindow } } },
		} as never,
		indexer: retryIndexer,
		canProduce: () => false,
		getEnabled: () => false,
		producerState: {
			isCancelPending: () => true,
			getOrCreateVaultId: async () => { throw new Error('mobile producer path was entered'); },
			reserveGeneratedAtEpochMs: async () => { throw new Error('mobile watermark path was entered'); },
		},
		getCatchUpMinutes: () => 60,
		getAppearanceSettings: () => DEFAULT_SETTINGS,
		isSystemReminderFieldEnabled: () => true,
		getTimezone: () => 'Europe/Berlin',
		now: () => nowMs,
		ownerWindow: cancelWindow as never,
		path,
	});
	await mobileExporter.start();
	assert.equal(mobileAdapter.files.has(path), false, 'non-desktop startup cannot publish a synced pending cancel');
	await mobileExporter.destroy();

	const raceAdapter = new MemoryAdapter();
	const raceIndexer = new FakeIndexer();
	raceIndexer.tasks.set('snapshot-task', task());
	const raceWindow = new FakeWindow();
	let raceEnabled = true;
	let raceWatermark = -1;
	let blockNextReservation = false;
	let reservationEntered = (): void => {};
	let releaseReservation = (): void => {};
	const reservationEnteredPromise = new Promise<void>(resolve => { reservationEntered = resolve; });
	const reservationReleasePromise = new Promise<void>(resolve => { releaseReservation = resolve; });
	const raceExporter = new MobileNotificationsExporter({
		app: {
			vault: { adapter: raceAdapter, configDir: '.obsidian', getName: () => 'Stratejya Next' },
			workspace: { containerEl: { ownerDocument: { defaultView: raceWindow } } },
		} as never,
		indexer: raceIndexer,
		getEnabled: () => raceEnabled,
		producerState: {
			getOrCreateVaultId: async () => VAULT_ID,
			reserveGeneratedAtEpochMs: async (now, minimum) => {
				if (blockNextReservation) {
					blockNextReservation = false;
					reservationEntered();
					await reservationReleasePromise;
				}
				raceWatermark = Math.max(now, minimum + 1, raceWatermark + 1);
				return raceWatermark;
			},
		},
		getCatchUpMinutes: () => 60,
		getAppearanceSettings: () => DEFAULT_SETTINGS,
		isSystemReminderFieldEnabled: () => true,
		getTimezone: () => 'Europe/Berlin',
		now: () => nowMs,
		ownerWindow: raceWindow as never,
		path,
	});
	await raceExporter.start();
	blockNextReservation = true;
	raceEnabled = false;
	const disabling = raceExporter.handleSettingsChanged();
	await reservationEnteredPromise;
	raceEnabled = true;
	const enabling = raceExporter.handleSettingsChanged();
	releaseReservation();
	await Promise.all([disabling, enabling]);
	const raceFinal = JSON.parse(raceAdapter.files.get(path) ?? '{}') as { enabled?: boolean };
	assert.equal(raceFinal.enabled, true, 'serialized disable-to-enable race leaves the last requested state authoritative');
	await raceExporter.destroy();

	const failing = new FailingReplacementAdapter();
	failing.files.set(path, 'live-snapshot');
	await assert.rejects(() => writeMobileNotificationsSnapshotAtomically(failing as never, path, 'replacement'));
	assert.equal(failing.files.get(path), 'live-snapshot', 'failed replacement restores the live snapshot');

	console.log('Mobile notification producer unit tests passed');
}

declare global {
	var __operonMobileNotificationsExporterTestRun: Promise<void> | undefined;
	var __operonMobileNotificationsSample: unknown;
}

globalThis.__operonMobileNotificationsExporterTestRun = run();
