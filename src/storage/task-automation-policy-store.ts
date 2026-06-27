import { App } from 'obsidian';
import type { OperonSettings } from '../types/settings';
import { WriteQueue } from './write-queue';
import { preserveInvalidJsonFile, shouldSkipStoreWrite, writeJsonSafely, type RecoveredStoreWriteOptions } from './storage-file-ops';
import { buildOperonPluginStoragePath } from './operon-storage-paths';

const TASK_AUTOMATION_POLICY_FILE_NAME = 'task-automation-policy.json';
const TASK_AUTOMATION_POLICY_STORE_VERSION = 1;

export type TaskAutomationPolicyStoreSettings = Pick<
	OperonSettings,
	| 'autoCompleteParentWhenAllChildrenTerminal'
	| 'cascadeCancelToDescendants'
	| 'newOccurrencePosition'
	| 'fileTaskAutoArchiveEnabled'
	| 'fileTaskArchiveFolder'
	| 'fileTaskArchiveDelaySeconds'
	| 'fileTaskArchiveOnlyFromFileTasksFolder'
	| 'fileRepeatDestination'
	| 'fileRepeatCustomFolder'
	| 'estimateAutoReallocation'
	| 'trackerSplitSessionsAtMidnight'
>;

interface TaskAutomationPolicyStoreData extends TaskAutomationPolicyStoreSettings {
	version: number;
}

const TASK_AUTOMATION_POLICY_STORE_SETTING_KEYS = [
	'autoCompleteParentWhenAllChildrenTerminal',
	'cascadeCancelToDescendants',
	'newOccurrencePosition',
	'fileTaskAutoArchiveEnabled',
	'fileTaskArchiveFolder',
	'fileTaskArchiveDelaySeconds',
	'fileTaskArchiveOnlyFromFileTasksFolder',
	'fileRepeatDestination',
	'fileRepeatCustomFolder',
	'estimateAutoReallocation',
	'trackerSplitSessionsAtMidnight',
] as const satisfies readonly (keyof TaskAutomationPolicyStoreSettings)[];

function cloneSettings(settings: TaskAutomationPolicyStoreSettings): TaskAutomationPolicyStoreSettings {
	return { ...settings };
}

function readBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

function readString(value: unknown, fallback: string): string {
	return typeof value === 'string' ? value : fallback;
}

function readNumber(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readStoreData(
	raw: Partial<TaskAutomationPolicyStoreData>,
	fallback: TaskAutomationPolicyStoreSettings,
): TaskAutomationPolicyStoreSettings {
	return {
		autoCompleteParentWhenAllChildrenTerminal: readBoolean(
			raw.autoCompleteParentWhenAllChildrenTerminal,
			fallback.autoCompleteParentWhenAllChildrenTerminal,
		),
		cascadeCancelToDescendants: readBoolean(raw.cascadeCancelToDescendants, fallback.cascadeCancelToDescendants),
		newOccurrencePosition: readString(raw.newOccurrencePosition, fallback.newOccurrencePosition) as TaskAutomationPolicyStoreSettings['newOccurrencePosition'],
		fileTaskAutoArchiveEnabled: readBoolean(raw.fileTaskAutoArchiveEnabled, fallback.fileTaskAutoArchiveEnabled),
		fileTaskArchiveFolder: readString(raw.fileTaskArchiveFolder, fallback.fileTaskArchiveFolder),
		fileTaskArchiveDelaySeconds: readNumber(raw.fileTaskArchiveDelaySeconds, fallback.fileTaskArchiveDelaySeconds),
		fileTaskArchiveOnlyFromFileTasksFolder: readBoolean(raw.fileTaskArchiveOnlyFromFileTasksFolder, fallback.fileTaskArchiveOnlyFromFileTasksFolder),
		fileRepeatDestination: readString(raw.fileRepeatDestination, fallback.fileRepeatDestination) as TaskAutomationPolicyStoreSettings['fileRepeatDestination'],
		fileRepeatCustomFolder: readString(raw.fileRepeatCustomFolder, fallback.fileRepeatCustomFolder),
		estimateAutoReallocation: readBoolean(raw.estimateAutoReallocation, fallback.estimateAutoReallocation),
		trackerSplitSessionsAtMidnight: readBoolean(raw.trackerSplitSessionsAtMidnight, fallback.trackerSplitSessionsAtMidnight),
	};
}

function hasAllStoreSettings(raw: Partial<TaskAutomationPolicyStoreData>): boolean {
	return TASK_AUTOMATION_POLICY_STORE_SETTING_KEYS.every(key => Object.prototype.hasOwnProperty.call(raw, key));
}

export class TaskAutomationPolicyStore {
	private app: App;
	private writeQueue: WriteQueue;
	private settings: TaskAutomationPolicyStoreSettings;
	private serializedSettings: string;
	private recoveredFromMalformed = false;
	private packagePersist: ((settings: TaskAutomationPolicyStoreSettings) => Promise<void>) | null = null;

	constructor(app: App, writeQueue: WriteQueue, defaults: TaskAutomationPolicyStoreSettings) {
		this.app = app;
		this.writeQueue = writeQueue;
		this.settings = cloneSettings(defaults);
		this.serializedSettings = JSON.stringify(this.settings);
	}

	private getFilePath(): string {
		return buildOperonPluginStoragePath(this.app.vault.configDir, 'data', TASK_AUTOMATION_POLICY_FILE_NAME);
	}

	getAll(): TaskAutomationPolicyStoreSettings {
		return cloneSettings(this.settings);
	}

	setPackagePersistence(persist: (settings: TaskAutomationPolicyStoreSettings) => Promise<void>): void {
		this.packagePersist = persist;
	}

	loadFromPackage(settings: TaskAutomationPolicyStoreSettings): void {
		this.settings = cloneSettings(settings);
		this.serializedSettings = JSON.stringify(this.settings);
		this.recoveredFromMalformed = false;
	}

	async exists(): Promise<boolean> {
		return this.app.vault.adapter.exists(this.getFilePath());
	}

	async load(
		legacySettings: TaskAutomationPolicyStoreSettings | null = null,
		defaults: TaskAutomationPolicyStoreSettings,
	): Promise<void> {
		const adapter = this.app.vault.adapter;
		const filePath = this.getFilePath();
		if (!(await adapter.exists(filePath))) {
			this.settings = cloneSettings(legacySettings ?? defaults);
			this.serializedSettings = JSON.stringify(this.settings);
			this.recoveredFromMalformed = false;
			if (legacySettings) {
				await this.persist();
			}
			return;
		}

		let raw = '';
		try {
			raw = await adapter.read(filePath);
			const parsed = JSON.parse(raw) as Partial<TaskAutomationPolicyStoreData>;
			this.settings = readStoreData(parsed, legacySettings ?? defaults);
			this.serializedSettings = hasAllStoreSettings(parsed) ? JSON.stringify(this.settings) : '';
			this.recoveredFromMalformed = false;
		} catch {
			console.warn('Operon: Failed to parse task automation policy store, preserving invalid file as backup and recovering from fallback settings');
			await preserveInvalidJsonFile(adapter, filePath, raw);
			this.settings = cloneSettings(legacySettings ?? defaults);
			this.serializedSettings = JSON.stringify(this.settings);
			this.recoveredFromMalformed = true;
		}
	}

	async replaceAll(settings: TaskAutomationPolicyStoreSettings, options: RecoveredStoreWriteOptions = {}): Promise<void> {
		const nextSettings = cloneSettings(settings);
		const nextSerialized = JSON.stringify(nextSettings);
		const adapter = this.app.vault.adapter;
		if (shouldSkipStoreWrite(
			nextSerialized === this.serializedSettings,
			await adapter.exists(this.getFilePath()),
			this.recoveredFromMalformed,
			options,
		)) {
			this.settings = nextSettings;
			return;
		}
		this.settings = nextSettings;
		this.serializedSettings = nextSerialized;
		if (this.packagePersist) {
			await this.packagePersist(this.getAll());
			this.recoveredFromMalformed = false;
			return;
		}
		await this.persist();
	}

	private async persist(): Promise<void> {
		const adapter = this.app.vault.adapter;
		const filePath = this.getFilePath();
		const data: TaskAutomationPolicyStoreData = {
			version: TASK_AUTOMATION_POLICY_STORE_VERSION,
			...cloneSettings(this.settings),
		};
		await this.writeQueue.enqueue(`${filePath}::__store__`, async () => {
			await writeJsonSafely(adapter, filePath, data);
		});
		this.recoveredFromMalformed = false;
	}
}
