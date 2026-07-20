import assert from 'node:assert/strict';
import { TFile } from 'obsidian';
import {
	buildReminderOccurrences,
	buildReminderOccurrenceKey,
	isReminderOccurrenceDue,
} from '../src/core/reminder-scheduler-model';
import {
	isSupportedReminderSoundExtension,
	resolveReminderDeliveryChannel,
} from '../src/core/reminder-delivery-model';
import { getFocusedVisibleWorkspaceWindow } from '../src/core/dom-compat';
import { ReminderScheduler } from '../src/core/reminder-scheduler';
import { buildOperonDataPackageFromSettings, composeOperonSettingsFromDataPackage } from '../src/storage/operon-data-package';
import { ReminderDeliveryStore } from '../src/storage/reminder-delivery-store';
import { CURRENT_SETTINGS_VERSION, DEFAULT_SETTINGS, migrateSettings } from '../src/types/settings';
import type { IndexedTask } from '../src/types/fields';
import type { IndexReconciliationEvent } from '../src/indexer/indexer';
import type {
	ReminderDeliveryBatchResult,
	ReminderDeliveryItem,
	ReminderDeliveryPort,
} from '../src/systems/reminder-delivery';
import {
	ReminderDeliveryController,
	ReminderSoundPreviewController,
} from '../src/systems/reminder-delivery';

let assertions = 0;

function equal(actual: unknown, expected: unknown, message?: string): void {
	assert.equal(actual, expected, message);
	assertions += 1;
}

function deepEqual(actual: unknown, expected: unknown, message?: string): void {
	assert.deepEqual(actual, expected, message);
	assertions += 1;
}

function toLocalDatetime(epochMs: number): string {
	const date = new Date(epochMs);
	const pad = (value: number): string => String(value).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function buildReminderOccurrenceLogicalKey(operonId: string, localDatetime: string): string {
	return buildReminderOccurrenceKey(operonId, new Date(localDatetime).getTime());
}

function task(operonId: string, fields: Record<string, string>, checkbox: IndexedTask['checkbox'] = 'open'): IndexedTask {
	return {
		operonId,
		description: operonId,
		checkbox,
		fieldValues: fields,
		tags: [],
		primary: { filePath: `${operonId}.md`, lineNumber: 0, format: 'inline' },
		datetimeModified: '',
		tier: checkbox === 'open' ? 'hot' : 'warm',
	};
}

class MemoryAdapter {
	readonly files = new Map<string, string>();
	readonly folders = new Set<string>();
	writeCalls = 0;

	async exists(path: string): Promise<boolean> { return this.files.has(path) || this.folders.has(path); }
	async mkdir(path: string): Promise<void> { this.folders.add(path); }
	async read(path: string): Promise<string> {
		const value = this.files.get(path);
		if (value === undefined) throw new Error('ENOENT');
		return value;
	}
	async write(path: string, value: string): Promise<void> {
		this.writeCalls += 1;
		this.files.set(path, value);
	}
	async remove(path: string): Promise<void> { this.files.delete(path); }
	async rename(from: string, to: string): Promise<void> {
		const value = this.files.get(from);
		if (value === undefined) throw new Error('ENOENT');
		this.files.delete(from);
		this.files.set(to, value);
	}
}

class FailingMemoryAdapter extends MemoryAdapter {
	failWrites = true;
	override async write(path: string, value: string): Promise<void> {
		if (this.failWrites) throw new Error('WRITE_FAILED');
		await super.write(path, value);
	}
}

class FailingNthWriteAdapter extends MemoryAdapter {
	private failingWriteCount = 0;
	failOnWrite = 2;
	override async write(path: string, value: string): Promise<void> {
		this.failingWriteCount += 1;
		if (this.failingWriteCount === this.failOnWrite) throw new Error('WRITE_FAILED_ON_CALL');
		await super.write(path, value);
	}
}

class FailingSecondRenameAdapter extends MemoryAdapter {
	renameCount = 0;
	override async rename(from: string, to: string): Promise<void> {
		this.renameCount += 1;
		if (this.renameCount === 2) throw new Error('RENAME_FAILED_AFTER_BACKUP');
		await super.rename(from, to);
	}
}

class FailingBackupAdapter extends MemoryAdapter {
	override async write(path: string, value: string): Promise<void> {
		if (path.includes('.invalid-')) throw new Error('BACKUP_FAILED');
		await super.write(path, value);
	}
}

class FailingReadAdapter extends MemoryAdapter {
	override async read(): Promise<string> {
		throw new Error('READ_FAILED');
	}
}

class FailingExistsAdapter extends MemoryAdapter {
	override async exists(): Promise<boolean> {
		throw new Error('EXISTS_FAILED');
	}
}

class MemoryLocalStorage {
	private readonly values = new Map<string, string>();
	getItem(key: string): string | null { return this.values.get(key) ?? null; }
	setItem(key: string, value: string): void { this.values.set(key, value); }
}

class FakeWindow {
	readonly localStorage = new MemoryLocalStorage();
	readonly document = new FakeDocument();
	readonly timers = new Map<number, { callback: () => void; delay: number }>();
	private nextTimerId = 1;
	audioFactory: (() => FakeAudio) | null = null;
	createEl(tagName: string): FakeAudio {
		if (tagName !== 'audio' || !this.audioFactory) throw new Error(`UNSUPPORTED_ELEMENT:${tagName}`);
		return this.audioFactory();
	}
	setTimeout(callback: () => void, delay: number): number {
		const id = this.nextTimerId++;
		this.timers.set(id, {
			callback: () => {
				this.timers.delete(id);
				callback();
			},
			delay,
		});
		return id;
	}
	clearTimeout(id: number): void { this.timers.delete(id); }
	private readonly listeners = new Map<string, Set<() => void>>();
	addEventListener(type: string, listener: () => void): void {
		const listeners = this.listeners.get(type) ?? new Set<() => void>();
		listeners.add(listener);
		this.listeners.set(type, listeners);
	}
	removeEventListener(type: string, listener: () => void): void { this.listeners.get(type)?.delete(listener); }
	dispatch(type: string): void { for (const listener of this.listeners.get(type) ?? []) listener(); }
}

class FakeAudio {
	src = '';
	paused = false;
	loaded = false;
	private endedListener: (() => void) | null = null;
	constructor(private readonly playResult: Promise<void>) {}
	play(): Promise<void> { return this.playResult; }
	pause(): void { this.paused = true; }
	load(): void { this.loaded = true; }
	removeAttribute(name: string): void { if (name === 'src') this.src = ''; }
	addEventListener(type: string, listener: () => void): void {
		if (type === 'ended') this.endedListener = listener;
	}
	removeEventListener(type: string, listener: () => void): void {
		if (type === 'ended' && this.endedListener === listener) this.endedListener = null;
	}
}

class FakeNotification {
	static permission: NotificationPermission = 'granted';
	static instances: FakeNotification[] = [];
	static async requestPermission(): Promise<NotificationPermission> { return this.permission; }
	onclick: (() => void) | null = null;
	onclose: (() => void) | null = null;
	onerror: (() => void) | null = null;
	onshow: (() => void) | null = null;
	constructor(readonly title: string, readonly options?: NotificationOptions) {
		FakeNotification.instances.push(this);
	}
	close(): void { this.onclose?.(); }
}

class FakeDocument {
	hidden = false;
	focused = true;
	hasFocus(): boolean { return this.focused; }
	private readonly listeners = new Map<string, Set<() => void>>();
	addEventListener(type: string, listener: () => void): void {
		const listeners = this.listeners.get(type) ?? new Set<() => void>();
		listeners.add(listener);
		this.listeners.set(type, listeners);
	}
	removeEventListener(type: string, listener: () => void): void { this.listeners.get(type)?.delete(listener); }
	dispatch(type: string): void { for (const listener of this.listeners.get(type) ?? []) listener(); }
}

class FakeIndexer {
	readonly tasks = new Map<string, IndexedTask>();
	readonly conflicts = new Set<string>();
	private listeners = new Set<(event: IndexReconciliationEvent) => void>();
	getAllTasks(): IndexedTask[] { return [...this.tasks.values()]; }
	getTask(operonId: string): IndexedTask | null { return this.tasks.get(operonId) ?? null; }
	hasDuplicateOperonIdConflict(operonId: string): boolean { return this.conflicts.has(operonId); }
	subscribeIndexReconciliation(listener: (event: IndexReconciliationEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	emit(event: IndexReconciliationEvent): void {
		for (const listener of this.listeners) listener(event);
	}
}

function readLedger(adapter: MemoryAdapter): Record<string, { state: string; sources: unknown[]; epochMs: number }> {
	const entry = [...adapter.files.entries()].find(([path]) => path.includes('/state/reminder-deliveries/'));
	if (!entry) return {};
	return (JSON.parse(entry[1]) as {
		itemsByKey: Record<string, { state: string; sources: unknown[]; epochMs: number }>;
	}).itemsByKey;
}

function readLifecycle(adapter: MemoryAdapter): Record<string, { state: string; reopenCutoffMs?: number }> {
	const entry = [...adapter.files.entries()].find(([path]) => path.includes('/state/reminder-deliveries/'));
	if (!entry) return {};
	return (JSON.parse(entry[1]) as {
		taskLifecycleByOperonId: Record<string, { state: string; reopenCutoffMs?: number }>;
	}).taskLifecycleByOperonId;
}

function deferredDeliveryPort(): ReminderDeliveryPort {
	return {
		async deliverBatch(items: readonly ReminderDeliveryItem[]): Promise<ReminderDeliveryBatchResult> {
			return {
				deliveredKeys: [],
				deferredKeys: items.map(item => item.occurrence.key),
				retryKeys: [],
			};
		},
		destroy(): void {},
	};
}

class ScriptedDeliveryPort implements ReminderDeliveryPort {
	readonly calls: ReminderDeliveryItem[][] = [];
	constructor(private readonly deliver: (
		items: readonly ReminderDeliveryItem[],
		callIndex: number,
	) => Promise<ReminderDeliveryBatchResult>) {}
	async deliverBatch(items: readonly ReminderDeliveryItem[]): Promise<ReminderDeliveryBatchResult> {
		this.calls.push([...items]);
		return this.deliver(items, this.calls.length - 1);
	}
	destroy(): void {}
}

function deliveryResult(
	items: readonly ReminderDeliveryItem[],
	state: 'delivered' | 'deferred' | 'retry',
): ReminderDeliveryBatchResult {
	const logicalKeys = items.map(item => item.occurrence.key);
	return {
		deliveredKeys: state === 'delivered' ? logicalKeys : [],
		deferredKeys: state === 'deferred' ? logicalKeys : [],
		retryKeys: state === 'retry' ? logicalKeys : [],
	};
}

async function run(): Promise<void> {
	const nowMs = new Date(2026, 6, 20, 12, 0, 0).getTime();
	const start = toLocalDatetime(nowMs + 45 * 60_000);
	const modelTask = task('model', {
		reminderDatetimes: `${toLocalDatetime(nowMs)}; broken; ${toLocalDatetime(nowMs + 600_000)}`,
		reminderRules: 'datetimeStart.45m; dateDue.2d',
		datetimeStart: start,
	});
	const occurrences = buildReminderOccurrences(modelTask);
	equal(occurrences.length, 2, 'invalid and missing-anchor values do not schedule');
	equal(occurrences[0]?.sources.length, 2, 'absolute and rule sources at the same task epoch dedupe');
	equal(
		occurrences[0]?.key,
		buildReminderOccurrenceLogicalKey('model', toLocalDatetime(nowMs)),
	);
	equal(occurrences[0]?.key, buildReminderOccurrenceKey('model', nowMs), 'epoch occurrence key contract is preserved');
	equal(occurrences[0]?.sourceLogicalKeys.length, 2, 'same-epoch sources retain independent logical identities');
	const reindexedModelTask = task('model', {
		...modelTask.fieldValues,
		reminderDatetimes: `${toLocalDatetime(nowMs + 600_000)}; ${toLocalDatetime(nowMs)}`,
	});
	deepEqual(
		buildReminderOccurrences(reindexedModelTask).find(item => item.epochMs === nowMs)?.sourceLogicalKeys,
		occurrences[0]?.sourceLogicalKeys,
		'source logical identity is independent from list index',
	);
	const dstFoldOccurrences = buildReminderOccurrences(task('dst-fold', {
		reminderDatetimes: '2026-10-25T02:30:00',
		reminderRules: 'datetimeStart.1h',
		datetimeStart: '2026-10-25T03:30:00',
	}));
	equal(dstFoldOccurrences.length, 2, 'DST fold local twins remain distinct epoch occurrences');
	equal(dstFoldOccurrences[0]?.localDatetime, dstFoldOccurrences[1]?.localDatetime, 'DST fold occurrences share display-local datetime');
	equal(dstFoldOccurrences[0]?.key === dstFoldOccurrences[1]?.key, false, 'DST fold occurrences use distinct runtime keys');
	equal(
		buildReminderOccurrences(modelTask, fieldKey => fieldKey !== 'reminderDatetimes').length,
		1,
		'custom-owned reminderDatetimes values do not produce absolute occurrences',
	);
	equal(
		buildReminderOccurrences(modelTask, fieldKey => fieldKey !== 'reminderRules').length,
		2,
		'custom-owned reminderRules values do not produce dynamic occurrences',
	);
	equal(
		buildReminderOccurrences(modelTask, () => false).length,
		0,
		'custom ownership of both reserved reminder fields suppresses scheduling',
	);
	equal(buildReminderOccurrences(task('done', modelTask.fieldValues, 'done')).length, 0, 'terminal tasks do not schedule');
	equal(isReminderOccurrenceDue(nowMs - 60_000, nowMs, 0), true, 'Never preserves on-time tolerance');
	equal(isReminderOccurrenceDue(nowMs - 60_001, nowMs, 0), false, 'Never rejects older reminders');
	equal(isReminderOccurrenceDue(nowMs - 30 * 60_000, nowMs, 30), true, 'catch-up boundary is inclusive');
	for (const minutes of [30, 60, 360, 1440]) {
		equal(isReminderOccurrenceDue(nowMs - minutes * 60_000, nowMs, minutes), true, `${minutes}m boundary is included`);
		equal(isReminderOccurrenceDue(nowMs - minutes * 60_000 - 1, nowMs, minutes), false, `${minutes}m boundary rejects older values`);
	}
	equal(isReminderOccurrenceDue(nowMs + 1, nowMs, 1440), false, 'future reminders are not due');
	equal(
		buildReminderOccurrenceLogicalKey('model', '2026-07-20T12:00:00'),
		buildReminderOccurrenceLogicalKey('model', '2026-07-20T12:00:00'),
		'logical identity is independent from the timezone-resolved epoch',
	);
	equal(resolveReminderDeliveryChannel({
		documentVisible: true,
		windowFocused: true,
		isDesktopApp: true,
		systemNotificationsEnabled: true,
		systemNotificationPermission: 'granted',
	}), 'notice', 'foreground delivery uses an Obsidian notice');
	equal(resolveReminderDeliveryChannel({
		documentVisible: false,
		windowFocused: false,
		isDesktopApp: true,
		systemNotificationsEnabled: true,
		systemNotificationPermission: 'granted',
	}), 'system', 'background desktop delivery uses an authorized system notification');
	equal(resolveReminderDeliveryChannel({
		documentVisible: false,
		windowFocused: false,
		isDesktopApp: false,
		systemNotificationsEnabled: true,
		systemNotificationPermission: 'granted',
	}), 'deferred', 'unsupported background delivery remains deferred');
	for (const extension of ['mp3', 'wav', 'm4a', 'aac', 'ogg', '.MP3', ' WAV ']) {
		equal(isSupportedReminderSoundExtension(extension), true, `${extension} is an accepted reminder sound extension`);
	}
	for (const extension of ['md', 'flac']) {
		equal(isSupportedReminderSoundExtension(extension), false, `${extension} is rejected as a reminder sound extension`);
	}
	const unfocusedMainWindow = new FakeWindow();
	unfocusedMainWindow.document.focused = false;
	const focusedPopoutWindow = new FakeWindow();
	const multiWindowApp = {
		workspace: {
			containerEl: { ownerDocument: { defaultView: unfocusedMainWindow } },
			iterateAllLeaves(callback: (leaf: unknown) => void): void {
				callback({ containerEl: { ownerDocument: { defaultView: focusedPopoutWindow } } });
			},
		},
	};
	equal(
		getFocusedVisibleWorkspaceWindow(multiWindowApp as never, unfocusedMainWindow as never),
		focusedPopoutWindow,
		'a focused popout is treated as the foreground reminder host when the main window is unfocused',
	);

	const notificationWindow = new FakeWindow();
	notificationWindow.document.hidden = true;
	notificationWindow.document.focused = false;
	Reflect.set(notificationWindow, 'Notification', FakeNotification);
	const soundFile = Object.assign(Object.create(TFile.prototype) as TFile, {
		path: 'Sounds/reminder.mp3',
		name: 'reminder.mp3',
		basename: 'reminder',
		extension: 'mp3',
	});
	const notificationApp = {
		vault: {
			getFileByPath: (path: string) => path === soundFile.path ? soundFile : null,
			getResourcePath: () => 'app://local/reminder.mp3',
		},
		workspace: {
			containerEl: { ownerDocument: { defaultView: notificationWindow } },
			iterateAllLeaves: () => {},
		},
	};
	const notificationOccurrence = buildReminderOccurrences(task('delivery-controller', {
		reminderDatetimes: toLocalDatetime(nowMs),
	}))[0]!;
	const deliveryItem: ReminderDeliveryItem = {
		occurrence: notificationOccurrence,
		task: task('delivery-controller', { reminderDatetimes: toLocalDatetime(nowMs) }),
	};
	const buildDeliveryController = (soundPath = ''): ReminderDeliveryController => new ReminderDeliveryController({
		app: notificationApp as never,
		getSystemNotificationsEnabled: () => true,
		getSoundFilePath: () => soundPath,
		onOpenTask: () => {},
		ownerWindow: notificationWindow as never,
		isDesktopApp: () => true,
	});

	FakeNotification.instances.length = 0;
	const noEventController = buildDeliveryController();
	const noEventDelivery = noEventController.deliverBatch([deliveryItem]);
	await Promise.resolve();
	const noEventTimer = [...notificationWindow.timers.values()].find(timer => timer.delay === 2_000);
	noEventTimer?.callback();
	const noEventResult = await noEventDelivery;
	deepEqual(noEventResult.retryKeys, [notificationOccurrence.key], 'notification no-event timeout remains pending for retry');
	noEventController.destroy();

	FakeNotification.instances.length = 0;
	const errorController = buildDeliveryController();
	const errorDelivery = errorController.deliverBatch([deliveryItem]);
	await Promise.resolve();
	FakeNotification.instances[0]?.onerror?.();
	const errorResult = await errorDelivery;
	deepEqual(errorResult.retryKeys, [notificationOccurrence.key], 'asynchronous notification errors remain pending for retry');
	errorController.destroy();

	FakeNotification.instances.length = 0;
	const destroyedAckController = buildDeliveryController();
	const destroyedAckDelivery = destroyedAckController.deliverBatch([deliveryItem]);
	await Promise.resolve();
	destroyedAckController.destroy();
	const destroyedAckResult = await destroyedAckDelivery;
	deepEqual(destroyedAckResult.retryKeys, [notificationOccurrence.key], 'delivery teardown settles pending notification acknowledgements as retry');
	equal(notificationWindow.timers.size, 0, 'delivery teardown clears pending notification acknowledgement timers');

	const neverPlayingAudio: FakeAudio[] = [];
	notificationWindow.audioFactory = () => {
		const audio = new FakeAudio(new Promise<void>(() => {}));
		neverPlayingAudio.push(audio);
		return audio;
	};
	FakeNotification.instances.length = 0;
	const soundController = buildDeliveryController(soundFile.path);
	const soundDelivery = soundController.deliverBatch([deliveryItem]);
	await Promise.resolve();
	FakeNotification.instances[0]?.onshow?.();
	const soundResult = await soundDelivery;
	deepEqual(soundResult.deliveredKeys, [notificationOccurrence.key], 'never-settling audio does not delay visible delivery acknowledgement');
	soundController.destroy();
	equal(neverPlayingAudio[0]?.paused, true, 'delivery teardown cancels never-settling audio playback');

	const previewController = new ReminderSoundPreviewController(notificationApp as never, notificationWindow as never);
	const firstPreview = previewController.play(soundFile.path);
	const secondPreview = previewController.play(soundFile.path);
	equal(await firstPreview, 'cancelled', 'a repeated preview cancels the prior owned player');
	previewController.stop();
	equal(await secondPreview, 'cancelled', 'preview teardown settles and stops a pending audio start');
	const timedOutPreview = previewController.play(soundFile.path);
	const soundStartTimer = [...notificationWindow.timers.values()].find(timer => timer.delay === 2_000);
	soundStartTimer?.callback();
	equal(await timedOutPreview, 'failed', 'a never-settling audio start fails within the bounded startup window');
	equal(neverPlayingAudio.at(-1)?.paused, true, 'audio startup timeout releases the media element');

	const migrated = migrateSettings({ settingsVersion: 108 });
	equal(migrated.settingsVersion, CURRENT_SETTINGS_VERSION);
	equal(migrated.reminderCatchUpWindowMinutes, 60, 'pre-v109 migration defaults to one hour');
	equal(migrateSettings({ settingsVersion: 109, reminderCatchUpWindowMinutes: 360 }).reminderCatchUpWindowMinutes, 360);
	equal(migrateSettings({ settingsVersion: 109, reminderCatchUpWindowMinutes: 50 }).reminderCatchUpWindowMinutes, 60, 'invalid option normalizes');
	const preV110 = migrateSettings({ settingsVersion: 109 });
	equal(preV110.reminderSystemNotificationsEnabled, false, 'pre-v110 migration keeps system notifications opt-in');
	equal(preV110.reminderSoundFilePath, '', 'pre-v110 migration defaults to silent reminders');
	const normalizedV110 = migrateSettings({
		settingsVersion: 110,
		reminderSystemNotificationsEnabled: true,
		reminderSoundFilePath: '  Sounds/reminder.mp3  ',
	});
	equal(normalizedV110.reminderSystemNotificationsEnabled, true, 'v110 preserves explicit system notification opt-in');
	equal(normalizedV110.reminderSoundFilePath, 'Sounds/reminder.mp3', 'v110 trims the vault-relative sound path');
	equal(migrateSettings({
		settingsVersion: 110,
		reminderSystemNotificationsEnabled: 'true',
		reminderSoundFilePath: 42,
	}).reminderSystemNotificationsEnabled, false, 'invalid notification setting fails closed');
	equal(migrateSettings({
		settingsVersion: 110,
		reminderSoundFilePath: 42,
	}).reminderSoundFilePath, '', 'invalid sound paths normalize to silent');
	const dataPackage = buildOperonDataPackageFromSettings(migrateSettings({
		reminderCatchUpWindowMinutes: 1440,
		reminderSystemNotificationsEnabled: true,
		reminderSoundFilePath: 'Sounds/reminder.ogg',
	}));
	equal(dataPackage.automation.taskAutomationPolicy.reminderCatchUpWindowMinutes, 1440);
	equal(dataPackage.automation.taskAutomationPolicy.reminderSystemNotificationsEnabled, true);
	equal(dataPackage.automation.taskAutomationPolicy.reminderSoundFilePath, 'Sounds/reminder.ogg');
	equal(Object.prototype.hasOwnProperty.call(dataPackage.settings, 'reminderCatchUpWindowMinutes'), false, 'automation setting is not duplicated at root');
	equal(Object.prototype.hasOwnProperty.call(dataPackage.settings, 'reminderSoundFilePath'), false, 'sound setting is not duplicated at root');
	equal(composeOperonSettingsFromDataPackage(dataPackage, DEFAULT_SETTINGS).reminderCatchUpWindowMinutes, 1440);
	equal(composeOperonSettingsFromDataPackage(dataPackage, DEFAULT_SETTINGS).reminderSystemNotificationsEnabled, true);
	equal(composeOperonSettingsFromDataPackage(dataPackage, DEFAULT_SETTINGS).reminderSoundFilePath, 'Sounds/reminder.ogg');
	const migratedPackage = buildOperonDataPackageFromSettings(migrateSettings({ settingsVersion: 108 }));
	equal(migratedPackage.automation.taskAutomationPolicy.reminderCatchUpWindowMinutes, 60, 'v108 canonical package migration owns the default in task automation policy');
	equal(
		JSON.stringify(buildOperonDataPackageFromSettings(migrateSettings(composeOperonSettingsFromDataPackage(migratedPackage, DEFAULT_SETTINGS)))),
		JSON.stringify(migratedPackage),
		'v110 canonical package normalization is idempotent',
	);

	Object.assign(globalThis, {
		window: { crypto: { randomUUID: () => 'device-test-0001' } },
	});
	const reindexAdapter = new MemoryAdapter();
	const reindexWindow = new FakeWindow();
	const reindexIndexer = new FakeIndexer();
	const firstStartMs = nowMs + 120 * 60_000;
	const shiftedStartMs = nowMs + 180 * 60_000;
	reindexIndexer.tasks.set('recurring-successor', task('recurring-successor', {
		reminderRules: 'datetimeStart.45m',
		datetimeStart: toLocalDatetime(firstStartMs),
	}));
	const reindexApp = {
		vault: { configDir: '.obsidian', adapter: reindexAdapter },
		workspace: { containerEl: { ownerDocument: { defaultView: reindexWindow } } },
	};
	const reindexScheduler = new ReminderScheduler({
		app: reindexApp as never,
		indexer: reindexIndexer as never,
		deliveryPort: deferredDeliveryPort(),
		getCatchUpWindowMinutes: () => 60,
		ownerWindow: reindexWindow as never,
		now: () => nowMs,
	});
	await reindexScheduler.start();
	equal([...reindexWindow.timers.values()][0]?.delay, 75 * 60_000, 'carried rule resolves against the successor start date');
	reindexIndexer.tasks.set('recurring-successor', task('recurring-successor', {
		reminderRules: 'datetimeStart.45m',
		datetimeStart: toLocalDatetime(shiftedStartMs),
	}));
	reindexIndexer.emit({ kind: 'incremental', generation: 2, affectedOperonIds: ['recurring-successor'] });
	await (reindexScheduler as unknown as { operationTail: Promise<void> }).operationTail;
	equal([...reindexWindow.timers.values()][0]?.delay, 135 * 60_000, 'incremental reindex re-resolves the carried rule against the shifted start date');
	await reindexScheduler.destroy();

	const adapter = new MemoryAdapter();
	const fakeWindow = new FakeWindow();
	const fakeIndexer = new FakeIndexer();
	fakeIndexer.tasks.set('runtime', task('runtime', {
		reminderDatetimes: `${toLocalDatetime(nowMs)}; ${toLocalDatetime(nowMs + 600_000)}`,
		reminderRules: `datetimeStart.45m`,
		datetimeStart: start,
	}));
	let currentNow = nowMs;
	const app = {
		vault: { configDir: '.obsidian', adapter },
		workspace: { containerEl: { ownerDocument: { defaultView: fakeWindow } } },
	};
	const scheduler = new ReminderScheduler({
		app: app as never,
		indexer: fakeIndexer as never,
		deliveryPort: deferredDeliveryPort(),
		getCatchUpWindowMinutes: () => 60,
		ownerWindow: fakeWindow as never,
		now: () => currentNow,
	});
	await scheduler.start();
	const dueKey = buildReminderOccurrenceLogicalKey('runtime', toLocalDatetime(nowMs));
	equal(readLedger(adapter)[dueKey]?.state, 'pending', 'startup queues the due occurrence');
	equal(readLedger(adapter)[dueKey]?.sources.length, 2, 'pending ledger retains both source identities');
	equal(fakeWindow.timers.size, 1, 'scheduler owns one nearest-deadline timer');
	equal([...fakeWindow.timers.values()][0]?.delay, 600_000, 'nearest future occurrence controls the timer');

	fakeIndexer.conflicts.add('runtime');
	fakeIndexer.emit({ kind: 'incremental', generation: 2, affectedOperonIds: ['runtime'] });
	await scheduler.destroy();
	equal(readLedger(adapter)[dueKey]?.state, 'expired', 'duplicate conflict expires a pending occurrence');
	fakeIndexer.conflicts.delete('runtime');
	const conflictRecoveryPort = new ScriptedDeliveryPort(async items => deliveryResult(items, 'delivered'));
	const conflictRecoveryScheduler = new ReminderScheduler({
		app: app as never,
		indexer: fakeIndexer as never,
		deliveryPort: conflictRecoveryPort,
		getCatchUpWindowMinutes: () => 60,
		ownerWindow: fakeWindow as never,
		now: () => currentNow,
	});
	await conflictRecoveryScheduler.start();
	await conflictRecoveryScheduler.destroy();
	equal(conflictRecoveryPort.calls.length, 1, 'authority-lost expiration revives at the same epoch after conflict recovery');
	equal(readLedger(adapter)[dueKey]?.state, 'delivered', 'revived same-epoch occurrence completes delivery');

	const mixedConflictAdapter = new MemoryAdapter();
	const mixedConflictApp = { ...app, vault: { configDir: '.obsidian', adapter: mixedConflictAdapter } };
	const mixedConflictWindow = new FakeWindow();
	const mixedConflictIndexer = new FakeIndexer();
	mixedConflictIndexer.tasks.set('mixed-conflict', task('mixed-conflict', {
		reminderDatetimes: toLocalDatetime(nowMs - 5 * 60_000),
	}, 'done'));
	mixedConflictIndexer.conflicts.add('mixed-conflict');
	const mixedConflictScheduler = new ReminderScheduler({
		app: mixedConflictApp as never,
		indexer: mixedConflictIndexer as never,
		deliveryPort: deferredDeliveryPort(),
		getCatchUpWindowMinutes: () => 60,
		ownerWindow: mixedConflictWindow as never,
		now: () => nowMs,
	});
	await mixedConflictScheduler.start();
	await mixedConflictScheduler.destroy();
	equal(readLifecycle(mixedConflictAdapter)['mixed-conflict'], undefined, 'duplicate conflict cannot establish lifecycle authority');
	mixedConflictIndexer.conflicts.delete('mixed-conflict');
	mixedConflictIndexer.tasks.set('mixed-conflict', task('mixed-conflict', {
		reminderDatetimes: toLocalDatetime(nowMs - 5 * 60_000),
	}, 'open'));
	const mixedConflictPort = new ScriptedDeliveryPort(async items => deliveryResult(items, 'delivered'));
	const resolvedMixedConflictScheduler = new ReminderScheduler({
		app: mixedConflictApp as never,
		indexer: mixedConflictIndexer as never,
		deliveryPort: mixedConflictPort,
		getCatchUpWindowMinutes: () => 60,
		ownerWindow: mixedConflictWindow as never,
		now: () => nowMs,
	});
	await resolvedMixedConflictScheduler.start();
	await resolvedMixedConflictScheduler.destroy();
	equal(mixedConflictPort.calls.length, 1, 'resolved mixed-state duplicate schedules without a false reopen cutoff');

	const reopenIndexer = new FakeIndexer();
	reopenIndexer.tasks.set('reopen', task('reopen', {
		reminderDatetimes: `${toLocalDatetime(nowMs - 10 * 60_000)}; ${toLocalDatetime(nowMs + 10 * 60_000)}`,
	}, 'done'));
	const reopenScheduler = new ReminderScheduler({
		app: app as never,
		indexer: reopenIndexer as never,
		deliveryPort: deferredDeliveryPort(),
		getCatchUpWindowMinutes: () => 60,
		ownerWindow: fakeWindow as never,
		now: () => currentNow,
	});
	await reopenScheduler.start();
	reopenIndexer.tasks.set('reopen', task('reopen', {
		reminderDatetimes: `${toLocalDatetime(nowMs - 10 * 60_000)}; ${toLocalDatetime(nowMs + 10 * 60_000)}`,
	}, 'open'));
	reopenIndexer.emit({ kind: 'incremental', generation: 3, affectedOperonIds: ['reopen'] });
	await reopenScheduler.destroy();
	const reopenedPastKey = buildReminderOccurrenceLogicalKey('reopen', toLocalDatetime(nowMs - 10 * 60_000));
	const reopenedFutureKey = buildReminderOccurrenceLogicalKey('reopen', toLocalDatetime(nowMs + 10 * 60_000));
	equal(readLedger(adapter)[reopenedPastKey]?.state, 'suppressed', 'reopen permanently suppresses past occurrences');
	equal(readLedger(adapter)[reopenedFutureKey], undefined, 'reopen retains only the future occurrence for scheduling');

	currentNow = nowMs + 10 * 60_000;
	const restarted = new ReminderScheduler({
		app: app as never,
		indexer: reopenIndexer as never,
		deliveryPort: deferredDeliveryPort(),
		getCatchUpWindowMinutes: () => 60,
		ownerWindow: fakeWindow as never,
		now: () => currentNow,
	});
	await restarted.start();
	await restarted.destroy();
	equal(readLedger(adapter)[reopenedPastKey]?.state, 'suppressed', 'restart does not revive a suppressed past occurrence');
	equal(readLedger(adapter)[reopenedFutureKey]?.state, 'pending', 'future occurrence becomes pending at its time');

	const coldReopenAdapter = new MemoryAdapter();
	const coldReopenApp = { ...app, vault: { configDir: '.obsidian', adapter: coldReopenAdapter } };
	const coldReopenWindow = new FakeWindow();
	const coldReopenIndexer = new FakeIndexer();
	coldReopenIndexer.tasks.set('cold-reopen', task('cold-reopen', {
		reminderDatetimes: toLocalDatetime(nowMs - 5 * 60_000),
	}, 'done'));
	const terminalScheduler = new ReminderScheduler({
		app: coldReopenApp as never,
		indexer: coldReopenIndexer as never,
		deliveryPort: deferredDeliveryPort(),
		getCatchUpWindowMinutes: () => 60,
		ownerWindow: coldReopenWindow as never,
		now: () => nowMs,
	});
	await terminalScheduler.start();
	await terminalScheduler.destroy();
	coldReopenIndexer.tasks.set('cold-reopen', task('cold-reopen', {
		reminderDatetimes: toLocalDatetime(nowMs - 5 * 60_000),
	}, 'open'));
	const coldReopenPort = new ScriptedDeliveryPort(async items => deliveryResult(items, 'delivered'));
	const coldReopenScheduler = new ReminderScheduler({
		app: coldReopenApp as never,
		indexer: coldReopenIndexer as never,
		deliveryPort: coldReopenPort,
		getCatchUpWindowMinutes: () => 60,
		ownerWindow: coldReopenWindow as never,
		now: () => nowMs,
	});
	await coldReopenScheduler.start();
	await coldReopenScheduler.destroy();
	equal(coldReopenPort.calls.length, 0, 'persisted terminal marker suppresses cold-start reopen catch-up');
	equal(
		readLedger(coldReopenAdapter)[buildReminderOccurrenceLogicalKey('cold-reopen', toLocalDatetime(nowMs - 5 * 60_000))]?.state,
		'suppressed',
		'cold-start reopen persists permanent suppression',
	);
	equal(readLifecycle(coldReopenAdapter)['cold-reopen']?.state, 'open', 'cold-start reopen persists its lifecycle cutoff');
	coldReopenIndexer.tasks.delete('cold-reopen');
	const deletedTaskScheduler = new ReminderScheduler({
		app: coldReopenApp as never,
		indexer: coldReopenIndexer as never,
		deliveryPort: deferredDeliveryPort(),
		getCatchUpWindowMinutes: () => 60,
		ownerWindow: coldReopenWindow as never,
		now: () => nowMs,
	});
	await deletedTaskScheduler.start();
	await deletedTaskScheduler.destroy();
	equal(readLifecycle(coldReopenAdapter)['cold-reopen'], undefined, 'authoritative task deletion removes lifecycle state');

	const lifecycleScopeAdapter = new MemoryAdapter();
	const lifecycleScopeApp = { ...app, vault: { configDir: '.obsidian', adapter: lifecycleScopeAdapter } };
	const lifecycleScopeWindow = new FakeWindow();
	const lifecycleScopeIndexer = new FakeIndexer();
	lifecycleScopeIndexer.tasks.set('terminal-without-reminder', task('terminal-without-reminder', {}, 'done'));
	lifecycleScopeIndexer.tasks.set('terminal-with-reminder', task('terminal-with-reminder', {
		reminderRules: 'datetimeStart.45m',
	}, 'done'));
	let lifecycleNow = nowMs;
	const lifecycleScopeScheduler = new ReminderScheduler({
		app: lifecycleScopeApp as never,
		indexer: lifecycleScopeIndexer as never,
		deliveryPort: deferredDeliveryPort(),
		getCatchUpWindowMinutes: () => 60,
		ownerWindow: lifecycleScopeWindow as never,
		now: () => lifecycleNow,
	});
	await lifecycleScopeScheduler.start();
	equal(readLifecycle(lifecycleScopeAdapter)['terminal-without-reminder'], undefined, 'terminal tasks without reminder tokens do not enter the lifecycle ledger');
	equal(readLifecycle(lifecycleScopeAdapter)['terminal-with-reminder']?.state, 'terminal', 'terminal tasks with reminder tokens retain reopen authority');
	const writesBeforeRepeatedTerminalReconcile = lifecycleScopeAdapter.writeCalls;
	lifecycleNow += 60_000;
	lifecycleScopeWindow.dispatch('focus');
	await lifecycleScopeScheduler.destroy();
	equal(lifecycleScopeAdapter.writeCalls, writesBeforeRepeatedTerminalReconcile, 'unchanged terminal lifecycle does not rewrite the ledger on focus reconciliation');

	const migrationAdapter = new MemoryAdapter();
	const migrationApp = { ...app, vault: { configDir: '.obsidian', adapter: migrationAdapter } };
	const migrationPath = '.obsidian/plugins/operon/state/reminder-deliveries/migrate-device.json';
	const migrationLocalDatetime = toLocalDatetime(nowMs);
	const legacyPendingKey = `model@${nowMs}`;
	const legacyDeliveredKey = `model@${nowMs + 3_600_000}`;
	const legacySource = [{ fieldKey: 'reminderDatetimes', index: 0, rawValue: migrationLocalDatetime }];
	migrationAdapter.files.set(migrationPath, JSON.stringify({
		version: 1,
		deviceId: 'migrate-device',
		itemsByKey: {
			[legacyPendingKey]: {
				key: legacyPendingKey,
				operonId: 'model',
				epochMs: nowMs,
				localDatetime: migrationLocalDatetime,
				sources: legacySource,
				state: 'pending',
				updatedAt: new Date(nowMs).toISOString(),
			},
			[legacyDeliveredKey]: {
				key: legacyDeliveredKey,
				operonId: 'model',
				epochMs: nowMs + 3_600_000,
				localDatetime: migrationLocalDatetime,
				sources: legacySource,
				state: 'delivered',
				updatedAt: new Date(nowMs - 1_000).toISOString(),
			},
		},
	}));
	const migrationStore = new ReminderDeliveryStore(migrationApp as never, 'migrate-device');
	await migrationStore.load();
	const migratedLedger = JSON.parse(migrationAdapter.files.get(migrationPath) ?? '{}') as {
		version: number;
		itemsByKey: Record<string, { state: string }>;
	};
	equal(migratedLedger.version, 3, 'v1 ledger is rewritten to schema v3');
	equal(Object.keys(migratedLedger.itemsByKey).length, 2, 'v1 epochs remain distinct during migration');
	equal(migratedLedger.itemsByKey[legacyPendingKey]?.state, 'pending', 'migration preserves pending epoch state');
	equal(migratedLedger.itemsByKey[legacyDeliveredKey]?.state, 'delivered', 'migration preserves delivered epoch state');

	const emptySourceAdapter = new MemoryAdapter();
	const emptySourceApp = { ...app, vault: { configDir: '.obsidian', adapter: emptySourceAdapter } };
	const emptySourcePath = '.obsidian/plugins/operon/state/reminder-deliveries/empty-source.json';
	const emptySourceRaw = JSON.stringify({
		version: 1,
		deviceId: 'empty-source',
		itemsByKey: {
			[legacyPendingKey]: {
				key: legacyPendingKey,
				operonId: 'model',
				epochMs: nowMs,
				localDatetime: migrationLocalDatetime,
				sources: [],
				state: 'pending',
				updatedAt: new Date(nowMs).toISOString(),
			},
		},
	});
	emptySourceAdapter.files.set(emptySourcePath, emptySourceRaw);
	const emptySourceStore = new ReminderDeliveryStore(emptySourceApp as never, 'empty-source');
	await emptySourceStore.load();
	equal(emptySourceStore.getPending().length, 0, 'legacy records without source identity are rejected instead of migrated');
	equal(emptySourceAdapter.files.get(emptySourcePath), emptySourceRaw, 'invalid legacy source data is preserved without writing a self-invalid v3 ledger');
	equal([...emptySourceAdapter.files.keys()].some(path => path.startsWith(`${emptySourcePath}.invalid-`)), true, 'invalid legacy source data is backed up for recovery');

	const migrationFailureAdapter = new FailingMemoryAdapter();
	const migrationFailureApp = { ...app, vault: { configDir: '.obsidian', adapter: migrationFailureAdapter } };
	const migrationFailurePath = '.obsidian/plugins/operon/state/reminder-deliveries/migration-failure.json';
	const migrationFailureRaw = JSON.stringify({ version: 1, deviceId: 'migration-failure', itemsByKey: {} });
	migrationFailureAdapter.files.set(migrationFailurePath, migrationFailureRaw);
	const migrationFailureStore = new ReminderDeliveryStore(migrationFailureApp as never, 'migration-failure');
	await assert.rejects(migrationFailureStore.load(), /WRITE_FAILED/u);
	assertions += 1;
	equal(
		migrationFailureAdapter.files.get(migrationFailurePath),
		migrationFailureRaw,
		'failed v1 migration leaves the original ledger intact and fails closed',
	);

	const renameFailureAdapter = new FailingSecondRenameAdapter();
	const renameFailureApp = { ...app, vault: { configDir: '.obsidian', adapter: renameFailureAdapter } };
	const renameFailurePath = '.obsidian/plugins/operon/state/reminder-deliveries/rename-failure.json';
	const renameFailureRaw = JSON.stringify({ version: 1, deviceId: 'rename-failure', itemsByKey: {} });
	renameFailureAdapter.files.set(renameFailurePath, renameFailureRaw);
	const renameFailureStore = new ReminderDeliveryStore(renameFailureApp as never, 'rename-failure');
	await assert.rejects(renameFailureStore.load(), /RENAME_FAILED_AFTER_BACKUP/u);
	assertions += 1;
	equal(
		renameFailureAdapter.files.get(renameFailurePath),
		renameFailureRaw,
		'rename failure after moving the original restores the authoritative ledger',
	);

	const futureAdapter = new MemoryAdapter();
	const futureApp = { ...app, vault: { configDir: '.obsidian', adapter: futureAdapter } };
	const futurePath = '.obsidian/plugins/operon/state/reminder-deliveries/future-device.json';
	const futureRaw = JSON.stringify({ version: 4, deviceId: 'future-device', itemsByKey: {}, taskLifecycleByOperonId: {} });
	futureAdapter.files.set(futurePath, futureRaw);
	const futureStore = new ReminderDeliveryStore(futureApp as never, 'future-device');
	await assert.rejects(futureStore.load(), /Unsupported reminder ledger version/u);
	assertions += 1;
	equal(futureAdapter.files.get(futurePath), futureRaw, 'future schema fails closed without rewriting the ledger');
	equal([...futureAdapter.files.keys()].some(path => path.includes('.invalid-')), false, 'future schema is not mislabeled as corrupt');

	const corruptPath = '.obsidian/plugins/operon/state/reminder-deliveries/corrupt-device.json';
	adapter.files.set(corruptPath, '{not-json');
	const corruptStore = new ReminderDeliveryStore(app as never, 'corrupt-device');
	await corruptStore.load();
	equal(corruptStore.getPending().length, 0, 'corrupt ledger opens with empty state');
	equal([...adapter.files.keys()].some(path => path.startsWith(`${corruptPath}.invalid-`) && path.endsWith('.bak')), true, 'corrupt ledger is preserved as a backup');

	const failingBackupAdapter = new FailingBackupAdapter();
	const failingBackupApp = { ...app, vault: { configDir: '.obsidian', adapter: failingBackupAdapter } };
	const failingBackupPath = '.obsidian/plugins/operon/state/reminder-deliveries/backup-failure.json';
	failingBackupAdapter.files.set(failingBackupPath, '{still-corrupt');
	const failingBackupStore = new ReminderDeliveryStore(failingBackupApp as never, 'backup-failure');
	await assert.rejects(failingBackupStore.load(), /BACKUP_FAILED/u);
	assertions += 1;
	equal(failingBackupAdapter.files.get(failingBackupPath), '{still-corrupt', 'backup failure never overwrites the only corrupt ledger copy');

	const failingReadAdapter = new FailingReadAdapter();
	const failingReadApp = { ...app, vault: { configDir: '.obsidian', adapter: failingReadAdapter } };
	const failingReadPath = '.obsidian/plugins/operon/state/reminder-deliveries/read-failure.json';
	const validLedger = JSON.stringify({ version: 1, deviceId: 'read-failure', itemsByKey: {} });
	failingReadAdapter.files.set(failingReadPath, validLedger);
	const failingReadStore = new ReminderDeliveryStore(failingReadApp as never, 'read-failure');
	await assert.rejects(failingReadStore.load(), /READ_FAILED/u);
	assertions += 1;
	equal(failingReadAdapter.files.get(failingReadPath), validLedger, 'read failure never overwrites or backs up unread ledger data');

	const secondDeviceStore = new ReminderDeliveryStore(app as never, 'device-test-0002');
	await secondDeviceStore.load();
	await secondDeviceStore.mutate({ pending: [occurrences[0]!], updatedAtMs: nowMs });
	equal([...adapter.files.keys()].some(path => path.endsWith('/device-test-0002.json')), true, 'a second device writes an independent ledger');

	const failingAdapter = new FailingMemoryAdapter();
	const failingApp = { ...app, vault: { configDir: '.obsidian', adapter: failingAdapter } };
	const failingStore = new ReminderDeliveryStore(failingApp as never, 'device-write-failure');
	await failingStore.load();
	await assert.rejects(
		failingStore.mutate({ pending: [occurrences[0]!], updatedAtMs: nowMs }),
		/WRITE_FAILED/u,
	);
	assertions += 1;
	equal(failingStore.get(occurrences[0]!.key)?.state, 'pending', 'write failure preserves session dedupe state');
	failingAdapter.failWrites = false;
	await failingStore.mutate({ updatedAtMs: nowMs + 1 });
	equal([...failingAdapter.files.keys()].some(path => path.endsWith('/device-write-failure.json')), true, 'later explicit mutation retries persistence without a tight loop');

	const schedulerRetryAdapter = new FailingMemoryAdapter();
	const schedulerRetryApp = { ...app, vault: { configDir: '.obsidian', adapter: schedulerRetryAdapter } };
	const retryWindow = new FakeWindow();
	const retryIndexer = new FakeIndexer();
	retryIndexer.tasks.set('retry', task('retry', { reminderDatetimes: toLocalDatetime(nowMs) }));
	const retryScheduler = new ReminderScheduler({
		app: schedulerRetryApp as never,
		indexer: retryIndexer as never,
		deliveryPort: deferredDeliveryPort(),
		getCatchUpWindowMinutes: () => 60,
		ownerWindow: retryWindow as never,
		now: () => nowMs,
	});
	await retryScheduler.start();
	equal(retryWindow.timers.size, 1, 'a failed ledger write schedules one bounded retry timer');
	equal([...retryWindow.timers.values()][0]?.delay, 60_000, 'first ledger persistence retry waits one minute');
	let retryCallback = [...retryWindow.timers.values()][0]?.callback;
	retryCallback?.();
	await new Promise<void>(resolve => setImmediate(resolve));
	equal([...retryWindow.timers.values()][0]?.delay, 5 * 60_000, 'second ledger persistence retry waits five minutes');
	retryCallback = [...retryWindow.timers.values()][0]?.callback;
	retryCallback?.();
	await new Promise<void>(resolve => setImmediate(resolve));
	equal([...retryWindow.timers.values()][0]?.delay, 30 * 60_000, 'third ledger persistence retry waits thirty minutes');
	schedulerRetryAdapter.failWrites = false;
	retryCallback = [...retryWindow.timers.values()][0]?.callback;
	retryCallback?.();
	await retryScheduler.destroy();
	equal(
		readLedger(schedulerRetryAdapter)[buildReminderOccurrenceLogicalKey('retry', toLocalDatetime(nowMs))]?.state,
		'pending',
		'bounded retry persists the session pending record',
	);

	const deliveredAdapter = new MemoryAdapter();
	const deliveredApp = { ...app, vault: { configDir: '.obsidian', adapter: deliveredAdapter } };
	const deliveredWindow = new FakeWindow();
	const deliveredIndexer = new FakeIndexer();
	deliveredIndexer.tasks.set('deliver', task('deliver', { reminderDatetimes: toLocalDatetime(nowMs) }));
	const deliveredPort = new ScriptedDeliveryPort(async items => deliveryResult(items, 'delivered'));
	const deliveredScheduler = new ReminderScheduler({
		app: deliveredApp as never,
		indexer: deliveredIndexer as never,
		deliveryPort: deliveredPort,
		getCatchUpWindowMinutes: () => 60,
		ownerWindow: deliveredWindow as never,
		now: () => nowMs,
	});
	await deliveredScheduler.start();
	await deliveredScheduler.destroy();
	const deliveredKey = buildReminderOccurrenceLogicalKey('deliver', toLocalDatetime(nowMs));
	equal(deliveredPort.calls.length, 1, 'durably pending occurrence is passed to the delivery port once');
	equal(readLedger(deliveredAdapter)[deliveredKey]?.state, 'delivered', 'successful delivery is durably marked delivered');

	const revivedAdapter = new MemoryAdapter();
	const revivedApp = { ...app, vault: { configDir: '.obsidian', adapter: revivedAdapter } };
	const revivedWindow = new FakeWindow();
	const revivedIndexer = new FakeIndexer();
	const revivedLocalDatetime = toLocalDatetime(nowMs);
	const revivedLogicalKey = buildReminderOccurrenceLogicalKey('revive', revivedLocalDatetime);
	const revivedOccurrenceKey = buildReminderOccurrenceKey('revive', nowMs - 3_600_000);
	const revivedPath = '.obsidian/plugins/operon/state/reminder-deliveries/device-test-0001.json';
	revivedAdapter.files.set(revivedPath, JSON.stringify({
		version: 2,
		deviceId: 'device-test-0001',
		itemsByLogicalKey: {
			[revivedLogicalKey]: {
				key: revivedOccurrenceKey,
				logicalKey: revivedLogicalKey,
				operonId: 'revive',
				epochMs: nowMs - 3_600_000,
				localDatetime: revivedLocalDatetime,
				sources: [{ fieldKey: 'reminderDatetimes', index: 0, rawValue: revivedLocalDatetime }],
				state: 'expired',
				updatedAt: new Date(nowMs - 60_000).toISOString(),
			},
		},
	}));
	revivedIndexer.tasks.set('revive', task('revive', { reminderDatetimes: revivedLocalDatetime }));
	const revivedPort = new ScriptedDeliveryPort(async items => deliveryResult(items, 'delivered'));
	const revivedScheduler = new ReminderScheduler({
		app: revivedApp as never,
		indexer: revivedIndexer as never,
		deliveryPort: revivedPort,
		getCatchUpWindowMinutes: () => 60,
		ownerWindow: revivedWindow as never,
		now: () => nowMs,
	});
	await revivedScheduler.start();
	await revivedScheduler.destroy();
	equal(revivedPort.calls.length, 1, 'expired identity does not suppress a currently authoritative due occurrence');
	equal(readLedger(revivedAdapter)[revivedLogicalKey]?.state, 'delivered', 'revived occurrence completes the normal delivery transition');

	const deferredAdapter = new MemoryAdapter();
	const deferredApp = { ...app, vault: { configDir: '.obsidian', adapter: deferredAdapter } };
	const deferredWindow = new FakeWindow();
	const deferredIndexer = new FakeIndexer();
	deferredIndexer.tasks.set('defer', task('defer', { reminderDatetimes: toLocalDatetime(nowMs) }));
	let deferDelivery = true;
	const wakePort = new ScriptedDeliveryPort(async items => deliveryResult(
		items,
		deferDelivery ? 'deferred' : 'delivered',
	));
	const deferredScheduler = new ReminderScheduler({
		app: deferredApp as never,
		indexer: deferredIndexer as never,
		deliveryPort: wakePort,
		getCatchUpWindowMinutes: () => 60,
		ownerWindow: deferredWindow as never,
		now: () => nowMs,
	});
	await deferredScheduler.start();
	const deferredKey = buildReminderOccurrenceLogicalKey('defer', toLocalDatetime(nowMs));
	equal(readLedger(deferredAdapter)[deferredKey]?.state, 'pending', 'deferred delivery stays durably pending');
	equal(deferredWindow.timers.size, 0, 'deferred delivery does not create a background retry loop');
	deferDelivery = false;
	deferredWindow.dispatch('focus');
	await deferredScheduler.destroy();
	equal(wakePort.calls.length, 2, 'focus wake retries a previously deferred reminder');
	equal(readLedger(deferredAdapter)[deferredKey]?.state, 'delivered', 'wake delivery closes the pending record');

	const deliveryRetryAdapter = new MemoryAdapter();
	const deliveryRetryApp = { ...app, vault: { configDir: '.obsidian', adapter: deliveryRetryAdapter } };
	const deliveryRetryWindow = new FakeWindow();
	const deliveryRetryIndexer = new FakeIndexer();
	deliveryRetryIndexer.tasks.set('portretry', task('portretry', { reminderDatetimes: toLocalDatetime(nowMs) }));
	const deliveryRetryPort = new ScriptedDeliveryPort(async (items, callIndex) => (
		deliveryResult(items, callIndex === 0 ? 'retry' : 'delivered')
	));
	const deliveryRetryScheduler = new ReminderScheduler({
		app: deliveryRetryApp as never,
		indexer: deliveryRetryIndexer as never,
		deliveryPort: deliveryRetryPort,
		getCatchUpWindowMinutes: () => 60,
		ownerWindow: deliveryRetryWindow as never,
		now: () => nowMs,
	});
	await deliveryRetryScheduler.start();
	equal([...deliveryRetryWindow.timers.values()][0]?.delay, 60_000, 'delivery failure uses the bounded one-minute first retry');
	[...deliveryRetryWindow.timers.values()][0]?.callback();
	await deliveryRetryScheduler.destroy();
	equal(deliveryRetryPort.calls.length, 2, 'delivery retry reuses the durable pending occurrence');
	equal(
		readLedger(deliveryRetryAdapter)[buildReminderOccurrenceLogicalKey('portretry', toLocalDatetime(nowMs))]?.state,
		'delivered',
		'successful delivery retry is marked delivered',
	);

	const markerFailureAdapter = new FailingNthWriteAdapter();
	const markerFailureApp = { ...app, vault: { configDir: '.obsidian', adapter: markerFailureAdapter } };
	const markerFailureWindow = new FakeWindow();
	const markerFailureIndexer = new FakeIndexer();
	markerFailureIndexer.tasks.set('marker', task('marker', { reminderDatetimes: toLocalDatetime(nowMs) }));
	const markerFailurePort = new ScriptedDeliveryPort(async items => deliveryResult(items, 'delivered'));
	const markerFailureScheduler = new ReminderScheduler({
		app: markerFailureApp as never,
		indexer: markerFailureIndexer as never,
		deliveryPort: markerFailurePort,
		getCatchUpWindowMinutes: () => 60,
		ownerWindow: markerFailureWindow as never,
		now: () => nowMs,
	});
	await markerFailureScheduler.start();
	equal([...markerFailureWindow.timers.values()][0]?.delay, 60_000, 'delivered-marker write failure schedules persistence retry');
	[...markerFailureWindow.timers.values()][0]?.callback();
	await markerFailureScheduler.destroy();
	equal(markerFailurePort.calls.length, 1, 'delivered-marker write failure does not duplicate the visible reminder in-session');
	equal(
		readLedger(markerFailureAdapter)[buildReminderOccurrenceLogicalKey('marker', toLocalDatetime(nowMs))]?.state,
		'delivered',
		'persistence retry flushes the in-memory delivered marker',
	);

	const failingExistsAdapter = new FailingExistsAdapter();
	const failingExistsApp = { ...app, vault: { configDir: '.obsidian', adapter: failingExistsAdapter } };
	const failSoftWindow = new FakeWindow();
	const failSoftScheduler = new ReminderScheduler({
		app: failingExistsApp as never,
		indexer: new FakeIndexer() as never,
		deliveryPort: deferredDeliveryPort(),
		getCatchUpWindowMinutes: () => 60,
		ownerWindow: failSoftWindow as never,
		now: () => nowMs,
	});
	await failSoftScheduler.start();
	equal(failSoftWindow.timers.size, 0, 'ledger initialization failure skips scheduler startup without rejecting');
	await failSoftScheduler.destroy();

	console.log(`Reminder scheduler tests: ${assertions}/${assertions} passed`);
}

declare global {
	var __operonReminderSchedulerTestRun: Promise<void> | undefined;
}

globalThis.__operonReminderSchedulerTestRun = run();
