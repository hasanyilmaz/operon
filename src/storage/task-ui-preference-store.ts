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
import { buildOperonPluginStoragePath } from './operon-storage-paths';

const TASK_UI_PREFERENCES_FILE_NAME = 'task-ui-preferences.json';
const TASK_UI_PREFERENCE_STORE_VERSION = 3;

export type TaskUiPreferenceStoreSettings = Pick<
	OperonSettings,
	| 'taskCreatorToolbar'
	| 'taskEditorShowLineNumbers'
	| 'taskEditorWorkflowPickers'
	| 'taskEditorMobileCoreTools'
	| 'inlineExpandedTaskChips'
	| 'inlineTaskCompactChips'
	| 'filterTaskCompactChips'
	| 'kanbanTaskCompactChips'
	| 'kanbanTaskShowPlayAction'
	| 'kanbanTaskShowPinAction'
	| 'kanbanTaskShowNoteAction'
	| 'kanbanTaskShowSubtaskAction'
	| 'kanbanTaskShowPlainCheckboxAction'
	| 'taskFinderCompactChips'
	| 'taskFinderDefaultScope'
	| 'taskFinderRememberLastScopes'
	| 'taskFinderSelectedProjectId'
	| 'taskFinderShortcuts'
	| 'taskWikilinkOverlayCompactChips'
	| 'taskWikilinkOverlayShowPlayAction'
	| 'taskWikilinkOverlayShowPinAction'
	| 'taskWikilinkOverlayShowNoteAction'
	| 'taskWikilinkOverlayShowSubtaskAction'
	| 'taskWikilinkOverlayShowPlainCheckboxAction'
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

type LegacyTaskWikilinkOverlayPreferenceData = {
	overlayTaskCompactChips?: unknown;
	overlayTaskShowPlayAction?: unknown;
	overlayTaskShowPinAction?: unknown;
	overlayTaskShowNoteAction?: unknown;
	overlayTaskShowSubtaskAction?: unknown;
	overlayTaskShowPlainCheckboxAction?: unknown;
};

function cloneSettings(settings: TaskUiPreferenceStoreSettings): TaskUiPreferenceStoreSettings {
	return {
		taskCreatorToolbar: settings.taskCreatorToolbar.map(item => ({ ...item })),
		taskEditorShowLineNumbers: settings.taskEditorShowLineNumbers,
		taskEditorWorkflowPickers: settings.taskEditorWorkflowPickers.map(item => ({ ...item })),
		taskEditorMobileCoreTools: settings.taskEditorMobileCoreTools.map(item => ({ ...item })),
		inlineExpandedTaskChips: { ...settings.inlineExpandedTaskChips },
		inlineTaskCompactChips: settings.inlineTaskCompactChips.map(item => ({ ...item })),
		filterTaskCompactChips: settings.filterTaskCompactChips.map(item => ({ ...item })),
		kanbanTaskCompactChips: settings.kanbanTaskCompactChips.map(item => ({ ...item })),
		kanbanTaskShowPlayAction: settings.kanbanTaskShowPlayAction,
		kanbanTaskShowPinAction: settings.kanbanTaskShowPinAction,
		kanbanTaskShowNoteAction: settings.kanbanTaskShowNoteAction,
		kanbanTaskShowSubtaskAction: settings.kanbanTaskShowSubtaskAction,
		kanbanTaskShowPlainCheckboxAction: settings.kanbanTaskShowPlainCheckboxAction,
		taskFinderCompactChips: settings.taskFinderCompactChips.map(item => ({ ...item })),
		taskFinderDefaultScope: settings.taskFinderDefaultScope.map(item => ({ ...item })),
		taskFinderRememberLastScopes: settings.taskFinderRememberLastScopes,
		taskFinderSelectedProjectId: settings.taskFinderSelectedProjectId,
		taskFinderShortcuts: settings.taskFinderShortcuts.map(item => ({ ...item })),
		taskWikilinkOverlayCompactChips: settings.taskWikilinkOverlayCompactChips.map(item => ({ ...item })),
		taskWikilinkOverlayShowPlayAction: settings.taskWikilinkOverlayShowPlayAction,
		taskWikilinkOverlayShowPinAction: settings.taskWikilinkOverlayShowPinAction,
		taskWikilinkOverlayShowNoteAction: settings.taskWikilinkOverlayShowNoteAction,
		taskWikilinkOverlayShowSubtaskAction: settings.taskWikilinkOverlayShowSubtaskAction,
		taskWikilinkOverlayShowPlainCheckboxAction: settings.taskWikilinkOverlayShowPlainCheckboxAction,
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
		const savedChip = raw[chip];
		if (typeof savedChip === 'boolean') {
			merged[chip] = savedChip;
		}
	}
	return merged;
}

function readStoreData(
	raw: Partial<TaskUiPreferenceStoreData> & LegacyTaskWikilinkOverlayPreferenceData & { taskBarChips?: unknown },
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
		kanbanTaskCompactChips: readArray(raw.kanbanTaskCompactChips, fallback.kanbanTaskCompactChips),
		kanbanTaskShowPlayAction: readBoolean(raw.kanbanTaskShowPlayAction, fallback.kanbanTaskShowPlayAction),
		kanbanTaskShowPinAction: readBoolean(raw.kanbanTaskShowPinAction, fallback.kanbanTaskShowPinAction),
		kanbanTaskShowNoteAction: readBoolean(raw.kanbanTaskShowNoteAction, fallback.kanbanTaskShowNoteAction),
		kanbanTaskShowSubtaskAction: readBoolean(raw.kanbanTaskShowSubtaskAction, fallback.kanbanTaskShowSubtaskAction),
		kanbanTaskShowPlainCheckboxAction: readBoolean(raw.kanbanTaskShowPlainCheckboxAction, fallback.kanbanTaskShowPlainCheckboxAction),
		taskFinderCompactChips: readArray(raw.taskFinderCompactChips, fallback.taskFinderCompactChips),
		taskFinderDefaultScope: readArray(raw.taskFinderDefaultScope, fallback.taskFinderDefaultScope),
		taskFinderRememberLastScopes: readBoolean(raw.taskFinderRememberLastScopes, fallback.taskFinderRememberLastScopes),
		taskFinderSelectedProjectId: readString(raw.taskFinderSelectedProjectId, fallback.taskFinderSelectedProjectId),
		taskFinderShortcuts: readArray(raw.taskFinderShortcuts, fallback.taskFinderShortcuts),
		taskWikilinkOverlayCompactChips: readArray(
			raw.taskWikilinkOverlayCompactChips ?? raw.overlayTaskCompactChips,
			fallback.taskWikilinkOverlayCompactChips,
		),
		taskWikilinkOverlayShowPlayAction: readBoolean(
			raw.taskWikilinkOverlayShowPlayAction ?? raw.overlayTaskShowPlayAction,
			fallback.taskWikilinkOverlayShowPlayAction,
		),
		taskWikilinkOverlayShowPinAction: readBoolean(
			raw.taskWikilinkOverlayShowPinAction ?? raw.overlayTaskShowPinAction,
			fallback.taskWikilinkOverlayShowPinAction,
		),
		taskWikilinkOverlayShowNoteAction: readBoolean(
			raw.taskWikilinkOverlayShowNoteAction ?? raw.overlayTaskShowNoteAction,
			fallback.taskWikilinkOverlayShowNoteAction,
		),
		taskWikilinkOverlayShowSubtaskAction: readBoolean(
			raw.taskWikilinkOverlayShowSubtaskAction ?? raw.overlayTaskShowSubtaskAction,
			fallback.taskWikilinkOverlayShowSubtaskAction,
		),
		taskWikilinkOverlayShowPlainCheckboxAction: readBoolean(
			raw.taskWikilinkOverlayShowPlainCheckboxAction ?? raw.overlayTaskShowPlainCheckboxAction,
			fallback.taskWikilinkOverlayShowPlainCheckboxAction,
		),
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

	private getFilePath(): string {
		return buildOperonPluginStoragePath(this.app.vault.configDir, 'data', TASK_UI_PREFERENCES_FILE_NAME);
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
		return this.app.vault.adapter.exists(this.getFilePath());
	}

	async load(
		legacySettings: TaskUiPreferenceStoreSettings | null = null,
		defaults: TaskUiPreferenceStoreSettings,
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
			const parsed = JSON.parse(raw) as Partial<TaskUiPreferenceStoreData>;
			this.settings = readStoreData(parsed, defaults);
			this.serializedSettings = JSON.stringify(this.settings);
			this.recoveredFromMalformed = false;
		} catch {
			console.warn('Operon: Failed to parse task UI preferences store, preserving invalid file as backup and recovering from fallback settings');
			await preserveInvalidJsonFile(adapter, filePath, raw);
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
		const data: TaskUiPreferenceStoreData = {
			version: TASK_UI_PREFERENCE_STORE_VERSION,
			...cloneSettings(this.settings),
		};
		await this.writeQueue.enqueue(`${filePath}::__store__`, async () => {
			await writeJsonSafely(adapter, filePath, data);
		});
		this.recoveredFromMalformed = false;
	}
}
