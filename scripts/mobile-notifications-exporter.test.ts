import assert from 'node:assert/strict';
import {
	buildMobileNotificationsSnapshot,
	formatOffsetInstant,
} from '../src/core/mobile-notifications-snapshot';
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
const path = '.obsidian/plugins/operon/state/mobile-notifications.json';

function localDatetime(epochMs: number): string {
	const date = new Date(epochMs);
	const pad = (value: number): string => String(value).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function task(description = 'Snapshot task', operonId = 'snapshot-task'): IndexedTask {
	return {
		operonId,
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
		primary: { filePath: `20 Projects/${operonId}.md`, lineNumber: 3, format: 'inline' },
		datetimeModified: localDatetime(nowMs),
		tier: 'hot',
	};
}

class MemoryAdapter {
	readonly files = new Map<string, string>();
	readonly folders = new Set<string>();
	private revision = 0;
	publishedWrites = 0;
	statReads = 0;
	async exists(target: string): Promise<boolean> { return this.files.has(target) || this.folders.has(target); }
	async mkdir(target: string): Promise<void> { this.folders.add(target); }
	async read(target: string): Promise<string> {
		const value = this.files.get(target);
		if (value === undefined) throw new Error('ENOENT');
		return value;
	}
	async stat(target: string): Promise<{ type: 'file'; ctime: number; mtime: number; size: number } | null> {
		this.statReads += 1;
		const value = this.files.get(target);
		return value === undefined ? null : { type: 'file', ctime: 0, mtime: this.revision, size: value.length };
	}
	async write(target: string, value: string): Promise<void> {
		this.revision += 1;
		this.files.set(target, value);
	}
	async remove(target: string): Promise<void> {
		this.revision += 1;
		this.files.delete(target);
	}
	async rename(from: string, to: string): Promise<void> {
		const value = this.files.get(from);
		if (value === undefined) throw new Error('ENOENT');
		this.revision += 1;
		this.files.delete(from);
		this.files.set(to, value);
		if (to === path) this.publishedWrites += 1;
	}
	externalWrite(target: string, value: string): void {
		this.revision += 1;
		this.files.set(target, value);
	}
}

class FailingReplacementAdapter extends MemoryAdapter {
	private renames = 0;
	override async rename(from: string, to: string): Promise<void> {
		this.renames += 1;
		if (this.renames === 2) throw new Error('REPLACE_FAILED');
		await super.rename(from, to);
	}
}

class FailNextRenameAdapter extends MemoryAdapter {
	failNextRename = false;
	override async rename(from: string, to: string): Promise<void> {
		if (this.failNextRename) {
			this.failNextRename = false;
			throw new Error('TRANSIENT_RENAME_FAILED');
		}
		await super.rename(from, to);
	}
}

class FakeEventTarget {
	readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
	addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
		const listeners = this.listeners.get(type) ?? new Set();
		listeners.add(listener);
		this.listeners.set(type, listeners);
	}
	removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
		this.listeners.get(type)?.delete(listener);
	}
	dispatch(type: string): void {
		for (const listener of this.listeners.get(type) ?? []) {
			if (typeof listener === 'function') listener({ type } as Event);
			else listener.handleEvent({ type } as Event);
		}
	}
	listenerCount(): number {
		return [...this.listeners.values()].reduce((count, listeners) => count + listeners.size, 0);
	}
}

class FakeDocument extends FakeEventTarget {
	visibilityState: DocumentVisibilityState = 'visible';
	defaultView: FakeWindow | null = null;
}

class FakeWindow extends FakeEventTarget {
	private nextId = 1;
	readonly timers = new Map<number, { callback: () => void; delay: number }>();
	setTimeout(callback: () => void, delay = 0): number {
		const id = this.nextId++;
		this.timers.set(id, { callback, delay });
		return id;
	}
	clearTimeout(id: number): void { this.timers.delete(id); }
	runDelay(delay: number): void {
		const entry = [...this.timers.entries()].find(([, timer]) => timer.delay === delay);
		assert.ok(entry, `expected a timer delayed ${delay}ms`);
		this.timers.delete(entry[0]);
		entry[1].callback();
	}
	captureDelay(delay: number): () => void {
		const entry = [...this.timers.values()].find(timer => timer.delay === delay);
		assert.ok(entry, `expected a timer delayed ${delay}ms`);
		return entry.callback;
	}
}

class FakeIndexer {
	readonly tasks = new Map<string, IndexedTask>();
	private listeners = new Set<(event: IndexReconciliationEvent) => void>();
	fullReads = 0;
	getAllTasks(): IndexedTask[] {
		this.fullReads += 1;
		return [...this.tasks.values()];
	}
	getTask(operonId: string): IndexedTask | undefined { return this.tasks.get(operonId); }
	hasDuplicateOperonIdConflict(): boolean { return false; }
	subscribeIndexReconciliation(listener: (event: IndexReconciliationEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	emit(event: IndexReconciliationEvent): void {
		for (const listener of this.listeners) listener(event);
	}
	listenerCount(): number { return this.listeners.size; }
}

function buildSnapshot(tasks: IndexedTask[], generatedAtEpochMs: number) {
	return buildMobileNotificationsSnapshot({
		tasks,
		generatedAtEpochMs,
		vaultId: VAULT_ID,
		vaultName: 'Stratejya Next',
		timezone: 'Europe/Berlin',
		catchUpMinutes: 60,
		appearanceSettings: DEFAULT_SETTINGS,
		isDuplicateOperonId: () => false,
	});
}

function serialize(value: unknown): string {
	return `${JSON.stringify(value, null, 2)}\n`;
}

function readSnapshot(adapter: MemoryAdapter) {
	return JSON.parse(adapter.files.get(path) ?? '{}') as ReturnType<typeof buildSnapshot>;
}

function createExporter(
	adapter: MemoryAdapter,
	indexer: FakeIndexer,
	ownerWindow: FakeWindow,
	ownerDocument: FakeDocument,
	canProduce = true,
	onAdoptedVaultId?: (vaultId: string | null | undefined) => void,
	now: () => number = () => nowMs,
	startupRefreshDelaysMs: readonly number[] = [60_000, 3 * 60_000, 5 * 60_000],
): MobileNotificationsExporter {
	return new MobileNotificationsExporter({
		app: {
			vault: { adapter, configDir: '.obsidian', getName: () => 'Stratejya Next' },
			workspace: { containerEl: { ownerDocument } },
		} as never,
		indexer,
		canProduce: () => canProduce,
		producerState: {
			getOrCreateVaultId: async adoptedVaultId => {
				onAdoptedVaultId?.(adoptedVaultId);
				return VAULT_ID;
			},
		},
		getCatchUpMinutes: () => 60,
		getAppearanceSettings: () => DEFAULT_SETTINGS,
		isSystemReminderFieldEnabled: () => true,
		getTimezone: () => 'Europe/Berlin',
		now,
		ownerWindow,
		ownerDocument,
		path,
		debounceMs: 10,
		refreshIntervalMs: 24 * 60 * 60_000,
		startupRefreshDelaysMs,
		monitorStatIntervalMs: 30_000,
		monitorFullReadIntervalMs: 5 * 60_000,
		recoveryDelayMs: 2_000,
		recoveryAttempts: 3,
		hashText: async text => text,
	});
}

async function run(): Promise<void> {
	const contractSnapshot = buildSnapshot([task()], nowMs);
	assert.equal(contractSnapshot.enabled, true);
	assert.equal(contractSnapshot.tasks[0]?.notifications.length, 1, 'same-epoch sources merge');
	assert.deepEqual(contractSnapshot.tasks[0]?.notifications[0]?.sources, [
		{ kind: 'reminderDatetime' },
		{ kind: 'reminderRule' },
	]);
	assert.equal(contractSnapshot.tasks[0]?.appearance.taskIcon, 'rocket');
	assert.equal(contractSnapshot.tasks[0]?.appearance.taskColor, '#12abEF');
	assert.equal(contractSnapshot.tasks[0]?.notifications[0]?.triggerAt, '2026-07-21T13:00:00+02:00');
	assert.equal(formatOffsetInstant(Date.parse('2026-10-25T01:30:00Z'), 'Europe/Berlin'), '2026-10-25T02:30:00+01:00');

	const adapter = new MemoryAdapter();
	const indexer = new FakeIndexer();
	indexer.tasks.set('snapshot-task', task());
	const ownerWindow = new FakeWindow();
	const ownerDocument = new FakeDocument();
	ownerDocument.defaultView = ownerWindow;
	const priorGeneratedAt = nowMs + 10_000;
	adapter.externalWrite(path, serialize(buildSnapshot([task('Stale synced content')], priorGeneratedAt)));
	let adoptedVaultId: string | null | undefined;
	const exporter = createExporter(adapter, indexer, ownerWindow, ownerDocument, true, value => {
		adoptedVaultId = value;
	});
	await exporter.start();

	assert.equal(adoptedVaultId, VAULT_ID, 'existing snapshot vault identity is preserved');
	assert.equal(adapter.publishedWrites, 1, 'elapsed-zero startup publishes a full snapshot');
	assert.equal(readSnapshot(adapter).enabled, true, 'automatic snapshots are always enabled');
	assert.equal(readSnapshot(adapter).generatedAtEpochMs, priorGeneratedAt + 1, 'existing watermark is adopted monotonically');
	assert.equal(readSnapshot(adapter).tasks[0]?.description, 'Snapshot task', 'startup fully rebuilds from the index');
	assert.equal(await readExistingMobileNotificationsVaultId(adapter as never, path), VAULT_ID);

	for (const delay of [60_000, 3 * 60_000, 5 * 60_000]) {
		const previousWatermark = readSnapshot(adapter).generatedAtEpochMs;
		const previousReads = indexer.fullReads;
		ownerWindow.runDelay(delay);
		await exporter.flush();
		assert.equal(indexer.fullReads, previousReads + 1, `startup ${delay}ms publication fully rebuilds candidates`);
		assert.equal(readSnapshot(adapter).generatedAtEpochMs, previousWatermark + 1, `startup ${delay}ms publication is distinct`);
	}
	assert.equal(adapter.publishedWrites, 4, 'startup publishes at elapsed 0, 1, 3, and 5 minutes');
	assert.equal(ownerWindow.listenerCount(), 1, 'foreground monitor starts after minute five');
	assert.equal(ownerDocument.listenerCount(), 1, 'visibility monitor starts after minute five');

	const catchUpAdapter = new MemoryAdapter();
	const catchUpIndexer = new FakeIndexer();
	catchUpIndexer.tasks.set('snapshot-task', task());
	const catchUpWindow = new FakeWindow();
	const catchUpDocument = new FakeDocument();
	catchUpDocument.defaultView = catchUpWindow;
	let catchUpNow = nowMs;
	const catchUpExporter = createExporter(
		catchUpAdapter,
		catchUpIndexer,
		catchUpWindow,
		catchUpDocument,
		true,
		undefined,
		() => catchUpNow,
	);
	await catchUpExporter.start();
	const overdueCallbacks = [60_000, 3 * 60_000, 5 * 60_000]
		.map(delay => catchUpWindow.captureDelay(delay));
	catchUpNow += 5 * 60_000;
	for (const callback of overdueCallbacks) callback();
	await catchUpExporter.flush();
	assert.equal(catchUpAdapter.publishedWrites, 2, 'overdue 1/3/5-minute checkpoints coalesce into one catch-up snapshot');
	assert.equal(catchUpWindow.listenerCount(), 1, 'catch-up starts monitoring after consuming the final checkpoint');
	await catchUpExporter.destroy();

	const immediateMonitorAdapter = new MemoryAdapter();
	const immediateMonitorIndexer = new FakeIndexer();
	immediateMonitorIndexer.tasks.set('snapshot-task', task());
	const immediateMonitorWindow = new FakeWindow();
	const immediateMonitorDocument = new FakeDocument();
	immediateMonitorDocument.defaultView = immediateMonitorWindow;
	const immediateMonitorExporter = createExporter(
		immediateMonitorAdapter,
		immediateMonitorIndexer,
		immediateMonitorWindow,
		immediateMonitorDocument,
		true,
		undefined,
		() => nowMs,
		[],
	);
	await immediateMonitorExporter.start();
	assert.equal(immediateMonitorAdapter.publishedWrites, 1, 'empty startup delays publish only the initial snapshot');
	assert.equal(immediateMonitorWindow.listenerCount(), 1, 'empty startup delays start window monitoring immediately');
	assert.equal(immediateMonitorDocument.listenerCount(), 1, 'empty startup delays start document monitoring immediately');
	assert.deepEqual(
		[...immediateMonitorWindow.timers.values()].map(timer => timer.delay).sort((left, right) => left - right),
		[30_000, 5 * 60_000, 24 * 60 * 60_000],
		'empty startup delays leave only monitor and periodic refresh timers',
	);
	await immediateMonitorExporter.destroy();

	const monitorFailureAdapter = new FailNextRenameAdapter();
	const monitorFailureIndexer = new FakeIndexer();
	monitorFailureIndexer.tasks.set('snapshot-task', task('Local authority'));
	const monitorFailureWindow = new FakeWindow();
	const monitorFailureDocument = new FakeDocument();
	monitorFailureDocument.defaultView = monitorFailureWindow;
	const monitorFailureExporter = createExporter(
		monitorFailureAdapter,
		monitorFailureIndexer,
		monitorFailureWindow,
		monitorFailureDocument,
	);
	await monitorFailureExporter.start();
	for (const delay of [60_000, 3 * 60_000, 5 * 60_000]) {
		monitorFailureWindow.runDelay(delay);
		await monitorFailureExporter.flush();
	}
	monitorFailureAdapter.externalWrite(
		path,
		serialize(buildSnapshot([task('External conflict')], readSnapshot(monitorFailureAdapter).generatedAtEpochMs + 10)),
	);
	monitorFailureAdapter.failNextRename = true;
	monitorFailureWindow.runDelay(30_000);
	await monitorFailureExporter.flush();
	assert.equal(
		[...monitorFailureWindow.timers.values()].filter(timer => timer.delay === 30_000).length,
		2,
		'transient conflict repair failure keeps both retry and stat-monitor timers armed',
	);
	await monitorFailureExporter.destroy();

	indexer.emit({ kind: 'incremental', generation: 1, affectedOperonIds: ['snapshot-task'] });
	ownerWindow.runDelay(10);
	await exporter.flush();
	assert.equal(adapter.publishedWrites, 4, 'unchanged incremental work does not rewrite');

	indexer.tasks.set('snapshot-task', task('Updated incrementally'));
	indexer.emit({ kind: 'incremental', generation: 2, affectedOperonIds: ['snapshot-task'] });
	ownerWindow.runDelay(10);
	await exporter.flush();
	assert.equal(adapter.publishedWrites, 5);
	assert.equal(readSnapshot(adapter).tasks[0]?.description, 'Updated incrementally');

	indexer.tasks.delete('snapshot-task');
	indexer.emit({ kind: 'incremental', generation: 3, affectedOperonIds: ['snapshot-task'] });
	ownerWindow.runDelay(10);
	await exporter.flush();
	assert.deepEqual(readSnapshot(adapter).tasks, [], 'incremental deletion removes exported occurrences');

	const beforeOwnCheck = adapter.publishedWrites;
	ownerWindow.runDelay(30_000);
	await exporter.flush();
	assert.equal(adapter.publishedWrites, beforeOwnCheck, 'stat observation of the exact own hash does not self-loop');

	ownerDocument.visibilityState = 'hidden';
	const statReadsWhileHidden = adapter.statReads;
	ownerWindow.runDelay(30_000);
	await exporter.flush();
	assert.equal(adapter.statReads, statReadsWhileHidden, '30-second stat polling pauses outside the foreground');
	ownerDocument.visibilityState = 'visible';
	ownerDocument.dispatch('visibilitychange');
	await exporter.flush();
	assert.equal(adapter.statReads, statReadsWhileHidden + 1, 'visibility wake performs an immediate stat check');

	const semanticallySameWatermark = readSnapshot(adapter).generatedAtEpochMs + 100;
	adapter.externalWrite(path, serialize(buildSnapshot([], semanticallySameWatermark)));
	ownerDocument.dispatch('visibilitychange');
	await exporter.flush();
	assert.equal(adapter.publishedWrites, beforeOwnCheck, 'generatedAt and derived-window-only external changes are semantic no-ops');

	indexer.tasks.set('snapshot-task', task('After external watermark'));
	indexer.emit({ kind: 'incremental', generation: 4, affectedOperonIds: ['snapshot-task'] });
	ownerWindow.runDelay(10);
	await exporter.flush();
	assert.equal(
		readSnapshot(adapter).generatedAtEpochMs,
		semanticallySameWatermark + 1,
		'external semantic no-op watermark is still adopted monotonically',
	);

	const externalMismatch = buildSnapshot([task('External conflict')], readSnapshot(adapter).generatedAtEpochMs + 10);
	adapter.externalWrite(path, serialize(externalMismatch));
	ownerWindow.dispatch('focus');
	await exporter.flush();
	assert.equal(readSnapshot(adapter).tasks[0]?.description, 'After external watermark', 'external semantic mismatch triggers a full authoritative rebuild');

	const beforeMalformedRecovery = adapter.publishedWrites;
	adapter.externalWrite(path, '{broken');
	ownerWindow.runDelay(30_000);
	await exporter.flush();
	for (let attempt = 0; attempt < 3; attempt += 1) {
		ownerWindow.runDelay(2_000);
		await exporter.flush();
	}
	assert.equal(adapter.publishedWrites, beforeMalformedRecovery + 1, 'malformed external state gets bounded retries then recovers');
	assert.equal(readSnapshot(adapter).enabled, true);

	const beforeMissingRecovery = adapter.publishedWrites;
	await adapter.remove(path);
	ownerWindow.runDelay(30_000);
	await exporter.flush();
	for (let attempt = 0; attempt < 3; attempt += 1) {
		ownerWindow.runDelay(2_000);
		await exporter.flush();
	}
	assert.equal(adapter.publishedWrites, beforeMissingRecovery + 1, 'missing external state gets bounded retries then recovers');

	const beforeForcedRead = adapter.publishedWrites;
	ownerWindow.runDelay(5 * 60_000);
	await exporter.flush();
	assert.equal(adapter.publishedWrites, beforeForcedRead, 'five-minute forced read recognizes the exact owned snapshot');

	ownerWindow.runDelay(24 * 60 * 60_000);
	await exporter.flush();
	assert.equal(adapter.publishedWrites, beforeForcedRead + 1, '24-hour refresh remains a forced full publication');

	await exporter.destroy();
	assert.equal(ownerWindow.timers.size, 0, 'destroy clears every exporter timer');
	assert.equal(ownerWindow.listenerCount(), 0, 'destroy removes focus listeners');
	assert.equal(ownerDocument.listenerCount(), 0, 'destroy removes visibility listeners');
	assert.equal(indexer.listenerCount(), 0, 'destroy unsubscribes index reconciliation');

	const ineligibleAdapter = new MemoryAdapter();
	const ineligibleWindow = new FakeWindow();
	const ineligibleDocument = new FakeDocument();
	ineligibleDocument.defaultView = ineligibleWindow;
	const ineligibleExporter = createExporter(ineligibleAdapter, indexer, ineligibleWindow, ineligibleDocument, false);
	await ineligibleExporter.start();
	assert.equal(ineligibleAdapter.files.has(path), false, 'an ineligible runtime remains non-producing');
	await ineligibleExporter.destroy();

	const failing = new FailingReplacementAdapter();
	failing.externalWrite(path, 'live-snapshot');
	await assert.rejects(() => writeMobileNotificationsSnapshotAtomically(failing as never, path, 'replacement'));
	assert.equal(failing.files.get(path), 'live-snapshot', 'failed replacement restores the live snapshot');

	console.log('Mobile notification exporter unit tests passed');
}

declare global {
	var __operonMobileNotificationsExporterTestRun: Promise<void> | undefined;
	var __operonMobileNotificationsSample: unknown;
}

globalThis.__operonMobileNotificationsSample = buildSnapshot([task()], nowMs);
globalThis.__operonMobileNotificationsExporterTestRun = run();
