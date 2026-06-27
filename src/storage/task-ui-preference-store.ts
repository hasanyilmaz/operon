import { App } from 'obsidian';
import {
	buildCompatibilityTaskEditorWorkflowPickerItems,
	InlineExpandedTaskChips,
	normalizeTaskEditorMobileCoreTools,
	normalizeTaskEditorWorkflowPickers,
	OperonSettings,
} from '../types/settings';
import { WriteQueue } from './write-queue';
import { preserveInvalidJsonFile, shouldSkipStoreWrite, writeJsonSafely, type RecoveredStoreWriteOptions } from './storage-file-ops';

const TASK_UI_PREFERENCES_FILE = '.operon/task-ui-preferences.json';
const TASK_UI_PREFERENCE_STORE_VERSION = 2;
const TASK_UI_PREFERENCE_STORE_QUEUE_KEY = `${TASK_UI_PREFERENCES_FILE}::__store__`;

export type TaskUiPreferenceStoreSettings = Pick<
	OperonSettings,
	| 'taskCreatorToolbar'
	| 'taskEditorShowLineNumbers'
	| 'taskEditorWorkflowPickers'
	| 'taskEditorMobileCoreTools'
	| 'inlineExpandedTaskChips'
	| 'inlineTaskCompactChips'
	| 'filterTaskCompactChips'
	| 'taskFinderCompactChips'
	| 'taskFinderDefaultScope'
	| 'taskFinderRememberLastScopes'
	| 'taskFinderSelectedProjectId'
	| 'taskFinderShortcuts'
	| 'overlayTaskCompactChips'
	| 'overlayTaskShowPlayAction'
	| 'overlayTaskShowPinAction'
	| 'overlayTaskShowNoteAction'
	| 'overlayTaskShowSubtaskAction'
	| 'overlayTaskShowPlainCheckboxAction'
	| 'inlineTaskShowPlayAction'
	| 'inlineTaskShowPinAction'
	| 'inlineTaskShowSubtaskAction'
	| 'filterTaskShowPlayAction'
	| 'filterTaskShowPinAction'
	| 'filterTaskShowSubtaskAction'
	| 'filterTaskShowPlainCheckboxAction'
>;

interface TaskUiPreferenceStoreData extends TaskUiPreferenceStoreSettings {
	version: number;
}

function cloneSettings(settings: TaskUiPreferenceStoreSettings): TaskUiPreferenceStoreSettings {
	return {
		taskCreatorToolbar: settings.taskCreatorToolbar.map(item => ({ ...item })),
		taskEditorShowLineNumbers: settings.taskEditorShowLineNumbers,
		taskEditorWorkflowPickers: settings.taskEditorWorkflowPickers.map(item => ({ ...item })),
		taskEditorMobileCoreTools: settings.taskEditorMobileCoreTools.map(item => ({ ...item })),
		inlineExpandedTaskChips: { ...settings.inlineExpandedTaskChips },
		inlineTaskCompactChips: settings.inlineTaskCompactChips.map(item => ({ ...item })),
		filterTaskCompactChips: settings.filterTaskCompactChips.map(item => ({ ...item })),
		taskFinderCompactChips: settings.taskFinderCompactChips.map(item => ({ ...item })),
		taskFinderDefaultScope: settings.taskFinderDefaultScope.map(item => ({ ...item })),
		taskFinderRememberLastScopes: settings.taskFinderRememberLastScopes,
		taskFinderSelectedProjectId: settings.taskFinderSelectedProjectId,
		taskFinderShortcuts: settings.taskFinderShortcuts.map(item => ({ ...item })),
		overlayTaskCompactChips: settings.overlayTaskCompactChips.map(item => ({ ...item })),
		overlayTaskShowPlayAction: settings.overlayTaskShowPlayAction,
		overlayTaskShowPinAction: settings.overlayTaskShowPinAction,
		overlayTaskShowNoteAction: settings.overlayTaskShowNoteAction,
		overlayTaskShowSubtaskAction: settings.overlayTaskShowSubtaskAction,
		overlayTaskShowPlainCheckboxAction: settings.overlayTaskShowPlainCheckboxAction,
		inlineTaskShowPlayAction: settings.inlineTaskShowPlayAction,
		inlineTaskShowPinAction: settings.inlineTaskShowPinAction,
		inlineTaskShowSubtaskAction: settings.inlineTaskShowSubtaskAction,
		filterTaskShowPlayAction: settings.filterTaskShowPlayAction,
		filterTaskShowPinAction: settings.filterTaskShowPinAction,
		filterTaskShowSubtaskAction: settings.filterTaskShowSubtaskAction,
		filterTaskShowPlainCheckboxAction: settings.filterTaskShowPlainCheckboxAction,
	};
}

function readArray<T>(
	value: unknown,
	fallback: T[],
): T[] {
	const source = Array.isArray(value) ? value : fallback;
	return source.map(item => ({ ...(item as object) } as T));
}

function readBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

function readString(value: unknown, fallback: string): string {
	return typeof value === 'string' ? value.trim() : fallback;
}

function readInlineExpandedTaskChips(
	value: unknown,
	fallback: InlineExpandedTaskChips,
): InlineExpandedTaskChips {
	const merged = { ...fallback };
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return merged;
	}

	const raw = value as Record<string, unknown>;
	for (const chip of Object.keys(merged) as (keyof InlineExpandedTaskChips)[]) {
		if (typeof raw[chip] === 'boolean') {
			merged[chip] = raw[chip] as boolean;
		}
	}
	return merged;
}

function readStoreData(
	raw: Partial<TaskUiPreferenceStoreData> & { taskBarChips?: unknown },
	fallback: TaskUiPreferenceStoreSettings,
): TaskUiPreferenceStoreSettings {
	return {
		taskCreatorToolbar: readArray(raw.taskCreatorToolbar, fallback.taskCreatorToolbar),
		taskEditorShowLineNumbers: readBoolean(raw.taskEditorShowLineNumbers, fallback.taskEditorShowLineNumbers),
		taskEditorWorkflowPickers: normalizeTaskEditorWorkflowPickers(
			raw.taskEditorWorkflowPickers,
			raw.taskEditorWorkflowPickers === undefined
				? buildCompatibilityTaskEditorWorkflowPickerItems()
				: fallback.taskEditorWorkflowPickers,
		),
		taskEditorMobileCoreTools: normalizeTaskEditorMobileCoreTools(
			raw.taskEditorMobileCoreTools,
			fallback.taskEditorMobileCoreTools,
		),
		inlineExpandedTaskChips: readInlineExpandedTaskChips(
			raw.inlineExpandedTaskChips ?? raw.taskBarChips,
			fallback.inlineExpandedTaskChips,
		),
		inlineTaskCompactChips: readArray(raw.inlineTaskCompactChips, fallback.inlineTaskCompactChips),
		filterTaskCompactChips: readArray(raw.filterTaskCompactChips, fallback.filterTaskCompactChips),
		taskFinderCompactChips: readArray(raw.taskFinderCompactChips, fallback.taskFinderCompactChips),
		taskFinderDefaultScope: readArray(raw.taskFinderDefaultScope, fallback.taskFinderDefaultScope),
		taskFinderRememberLastScopes: readBoolean(raw.taskFinderRememberLastScopes, fallback.taskFinderRememberLastScopes),
		taskFinderSelectedProjectId: readString(raw.taskFinderSelectedProjectId, fallback.taskFinderSelectedProjectId),
		taskFinderShortcuts: readArray(raw.taskFinderShortcuts, fallback.taskFinderShortcuts),
		overlayTaskCompactChips: readArray(raw.overlayTaskCompactChips, fallback.overlayTaskCompactChips),
		overlayTaskShowPlayAction: readBoolean(raw.overlayTaskShowPlayAction, fallback.overlayTaskShowPlayAction),
		overlayTaskShowPinAction: readBoolean(raw.overlayTaskShowPinAction, fallback.overlayTaskShowPinAction),
		overlayTaskShowNoteAction: readBoolean(raw.overlayTaskShowNoteAction, fallback.overlayTaskShowNoteAction),
		overlayTaskShowSubtaskAction: readBoolean(raw.overlayTaskShowSubtaskAction, fallback.overlayTaskShowSubtaskAction),
		overlayTaskShowPlainCheckboxAction: readBoolean(raw.overlayTaskShowPlainCheckboxAction, fallback.overlayTaskShowPlainCheckboxAction),
		inlineTaskShowPlayAction: readBoolean(raw.inlineTaskShowPlayAction, fallback.inlineTaskShowPlayAction),
		inlineTaskShowPinAction: readBoolean(raw.inlineTaskShowPinAction, fallback.inlineTaskShowPinAction),
		inlineTaskShowSubtaskAction: readBoolean(raw.inlineTaskShowSubtaskAction, fallback.inlineTaskShowSubtaskAction),
		filterTaskShowPlayAction: readBoolean(raw.filterTaskShowPlayAction, fallback.filterTaskShowPlayAction),
		filterTaskShowPinAction: readBoolean(raw.filterTaskShowPinAction, fallback.filterTaskShowPinAction),
		filterTaskShowSubtaskAction: readBoolean(raw.filterTaskShowSubtaskAction, fallback.filterTaskShowSubtaskAction),
		filterTaskShowPlainCheckboxAction: readBoolean(raw.filterTaskShowPlainCheckboxAction, fallback.filterTaskShowPlainCheckboxAction),
	};
}

export class TaskUiPreferenceStore {
	private app: App;
	private writeQueue: WriteQueue;
	private settings: TaskUiPreferenceStoreSettings;
	private serializedSettings: string;
	private recoveredFromMalformed = false;
	private packagePersist: ((settings: TaskUiPreferenceStoreSettings) => Promise<void>) | null = null;

	constructor(app: App, writeQueue: WriteQueue, defaults: TaskUiPreferenceStoreSettings) {
		this.app = app;
		this.writeQueue = writeQueue;
		this.settings = cloneSettings(defaults);
		this.serializedSettings = JSON.stringify(this.settings);
	}

	getAll(): TaskUiPreferenceStoreSettings {
		return cloneSettings(this.settings);
	}

	setPackagePersistence(persist: (settings: TaskUiPreferenceStoreSettings) => Promise<void>): void {
		this.packagePersist = persist;
	}

	loadFromPackage(settings: TaskUiPreferenceStoreSettings): void {
		this.settings = cloneSettings(settings);
		this.serializedSettings = JSON.stringify(this.settings);
		this.recoveredFromMalformed = false;
	}

	async exists(): Promise<boolean> {
		return this.app.vault.adapter.exists(TASK_UI_PREFERENCES_FILE);
	}

	async load(
		legacySettings: TaskUiPreferenceStoreSettings | null = null,
		defaults: TaskUiPreferenceStoreSettings,
	): Promise<void> {
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(TASK_UI_PREFERENCES_FILE))) {
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
			raw = await adapter.read(TASK_UI_PREFERENCES_FILE);
			const parsed = JSON.parse(raw) as Partial<TaskUiPreferenceStoreData>;
			this.settings = readStoreData(parsed, defaults);
			this.serializedSettings = JSON.stringify(this.settings);
			this.recoveredFromMalformed = false;
		} catch {
			console.warn('Operon: Failed to parse task UI preferences store, preserving invalid file as backup and recovering from fallback settings');
			await preserveInvalidJsonFile(adapter, TASK_UI_PREFERENCES_FILE, raw);
			this.settings = cloneSettings(legacySettings ?? defaults);
			this.serializedSettings = JSON.stringify(this.settings);
			this.recoveredFromMalformed = true;
		}
	}

	async replaceAll(settings: TaskUiPreferenceStoreSettings, options: RecoveredStoreWriteOptions = {}): Promise<void> {
		const nextSettings = cloneSettings(settings);
		const nextSerialized = JSON.stringify(nextSettings);
		const adapter = this.app.vault.adapter;
		if (shouldSkipStoreWrite(
			nextSerialized === this.serializedSettings,
			await adapter.exists(TASK_UI_PREFERENCES_FILE),
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
		const data: TaskUiPreferenceStoreData = {
			version: TASK_UI_PREFERENCE_STORE_VERSION,
			...cloneSettings(this.settings),
		};
		await this.writeQueue.enqueue(TASK_UI_PREFERENCE_STORE_QUEUE_KEY, async () => {
			await writeJsonSafely(adapter, TASK_UI_PREFERENCES_FILE, data);
		});
		this.recoveredFromMalformed = false;
	}
}
