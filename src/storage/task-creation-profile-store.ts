import { App } from 'obsidian';
import {
	normalizeChildTaskInheritanceStatusPipelineSource,
	normalizeInlineTaskParentFileHeadingKeyword,
	type OperonSettings,
} from '../types/settings';
import { WriteQueue } from './write-queue';
import { preserveInvalidJsonFile, shouldSkipStoreWrite, writeJsonSafely, type RecoveredStoreWriteOptions } from './storage-file-ops';
import { buildOperonPluginStoragePath } from './operon-storage-paths';
import { OPERON_TASK_CREATION_PROFILE_PACKAGE_VERSION } from './operon-data-package';

const TASK_CREATION_PROFILE_FILE_NAME = 'task-creation-profile.json';
const TASK_CREATION_PROFILE_STORE_VERSION = OPERON_TASK_CREATION_PROFILE_PACKAGE_VERSION;

export type TaskCreationProfileStoreSettings = Pick<
	OperonSettings,
	| 'taskDescriptionRequired'
	| 'assigneesRequired'
	| 'fileTasksFolder'
	| 'fileTaskPipelineLocations'
	| 'moveConvertedNotesToPipelineLocation'
	| 'inlineTaskSaveMode'
	| 'inlineTaskUseDailyNote'
	| 'inlineTaskTargetFile'
	| 'inlineTaskHeading'
	| 'fileTaskParentInlineTargetMode'
	| 'fileTaskParentFileTargetMode'
	| 'inlineToFileTaskMovePlainCheckboxes'
	| 'inlineTaskParentInlineTargetMode'
	| 'inlineTaskParentFileTargetMode'
	| 'inlineTaskParentFileHeadingKeyword'
	| 'inlineTaskDailyNoteAddStartDate'
	| 'inlineTaskDailyNoteAddScheduledDate'
	| 'calendarInlineTaskHeading'
	| 'autoParentFileTask'
	| 'autoParentLinkedFileSubtasks'
	| 'childTaskInheritanceFields'
	| 'childTaskInheritanceStatusPipelineSource'
	| 'taskCreatorDefaultToFileTask'
	| 'taskCreatorDefaultFileTemplateId'
	| 'fileTaskTemplateFolder'
	| 'manageDailyNotesWithOperon'
	| 'dailyNoteFormat'
	| 'dailyNoteTemplate'
	| 'dailyNoteFolder'
	| 'createDailyNotesAsOperonTask'
	| 'manageWeeklyNotesWithOperon'
	| 'weeklyNoteFormat'
	| 'weeklyNoteTemplate'
	| 'weeklyNoteFolder'
	| 'createWeeklyNotesAsOperonTask'
	| 'defaultEstimateMinutes'
>;

interface TaskCreationProfileStoreData extends TaskCreationProfileStoreSettings {
	version: number;
}

function cloneSettings(settings: TaskCreationProfileStoreSettings): TaskCreationProfileStoreSettings {
	return {
		...settings,
		childTaskInheritanceFields: [...settings.childTaskInheritanceFields],
		fileTaskPipelineLocations: settings.fileTaskPipelineLocations.map(rule => ({ ...rule })),
	};
}

function readBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

function readString(value: unknown, fallback: string): string {
	return typeof value === 'string' ? value : fallback;
}

function readNullableString(value: unknown, fallback: string | null): string | null {
	if (value === null || value === undefined) return fallback;
	if (typeof value !== 'string') return fallback;
	return value.trim() || null;
}

function readStringArray(value: unknown, fallback: string[]): string[] {
	if (!Array.isArray(value)) return [...fallback];
	const seen = new Set<string>();
	const values: string[] = [];
	for (const item of value) {
		if (typeof item !== 'string') continue;
		const normalized = item.trim();
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		values.push(normalized);
	}
	return values;
}

function readNumber(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readFileTaskParentTargetMode(
	value: unknown,
	fallback: TaskCreationProfileStoreSettings['fileTaskParentInlineTargetMode'],
): TaskCreationProfileStoreSettings['fileTaskParentInlineTargetMode'] {
	return value === 'default' || value === 'same-folder' ? value : fallback;
}

function readInlineTaskParentInlineTargetMode(
	value: unknown,
	fallback: TaskCreationProfileStoreSettings['inlineTaskParentInlineTargetMode'],
): TaskCreationProfileStoreSettings['inlineTaskParentInlineTargetMode'] {
	return value === 'default' || value === 'below-parent' ? value : fallback;
}

function readInlineTaskParentFileTargetMode(
	value: unknown,
	fallback: TaskCreationProfileStoreSettings['inlineTaskParentFileTargetMode'],
): TaskCreationProfileStoreSettings['inlineTaskParentFileTargetMode'] {
	return value === 'default' || value === 'inside-parent-file' ? value : fallback;
}

function readInlineTaskSaveMode(
	raw: Partial<TaskCreationProfileStoreData>,
	fallback: TaskCreationProfileStoreSettings,
): TaskCreationProfileStoreSettings['inlineTaskSaveMode'] {
	if (
		raw.inlineTaskSaveMode === 'daily-notes'
		|| raw.inlineTaskSaveMode === 'weekly-notes'
		|| raw.inlineTaskSaveMode === 'specific-file'
		|| raw.inlineTaskSaveMode === 'active-file'
		|| raw.inlineTaskSaveMode === 'ask-every-time'
	) {
		return raw.inlineTaskSaveMode;
	}
	return raw.inlineTaskUseDailyNote === false
		? 'specific-file'
		: fallback.inlineTaskSaveMode;
}

function readStoreData(
	raw: Partial<TaskCreationProfileStoreData>,
	fallback: TaskCreationProfileStoreSettings,
): TaskCreationProfileStoreSettings {
	const inlineTaskSaveMode = readInlineTaskSaveMode(raw, fallback);
	return {
		taskDescriptionRequired: readBoolean(raw.taskDescriptionRequired, fallback.taskDescriptionRequired),
		assigneesRequired: readBoolean(raw.assigneesRequired, fallback.assigneesRequired),
		fileTasksFolder: readString(raw.fileTasksFolder, fallback.fileTasksFolder),
		fileTaskPipelineLocations: Array.isArray(raw.fileTaskPipelineLocations)
			? raw.fileTaskPipelineLocations
				.filter((item): item is { pipelineId: string; folder: string } => !!item && typeof item === 'object'
					&& typeof (item as { pipelineId?: unknown }).pipelineId === 'string'
					&& typeof (item as { folder?: unknown }).folder === 'string')
				.map(item => ({ pipelineId: item.pipelineId.trim(), folder: item.folder.trim() }))
				.filter(item => !!item.pipelineId)
			: fallback.fileTaskPipelineLocations.map(rule => ({ ...rule })),
		moveConvertedNotesToPipelineLocation: readBoolean(
			raw.moveConvertedNotesToPipelineLocation,
			fallback.moveConvertedNotesToPipelineLocation,
		),
		inlineTaskSaveMode,
		inlineTaskUseDailyNote: inlineTaskSaveMode === 'daily-notes',
		inlineTaskTargetFile: readString(raw.inlineTaskTargetFile, fallback.inlineTaskTargetFile),
		inlineTaskHeading: readString(raw.inlineTaskHeading, fallback.inlineTaskHeading),
		fileTaskParentInlineTargetMode: readFileTaskParentTargetMode(
			raw.fileTaskParentInlineTargetMode,
			fallback.fileTaskParentInlineTargetMode,
		),
		fileTaskParentFileTargetMode: readFileTaskParentTargetMode(
			raw.fileTaskParentFileTargetMode,
			fallback.fileTaskParentFileTargetMode,
		),
		inlineToFileTaskMovePlainCheckboxes: readBoolean(
			raw.inlineToFileTaskMovePlainCheckboxes,
			fallback.inlineToFileTaskMovePlainCheckboxes,
		),
		inlineTaskParentInlineTargetMode: readInlineTaskParentInlineTargetMode(
			raw.inlineTaskParentInlineTargetMode,
			fallback.inlineTaskParentInlineTargetMode,
		),
		inlineTaskParentFileTargetMode: readInlineTaskParentFileTargetMode(
			raw.inlineTaskParentFileTargetMode,
			fallback.inlineTaskParentFileTargetMode,
		),
		inlineTaskParentFileHeadingKeyword: normalizeInlineTaskParentFileHeadingKeyword(
			readString(raw.inlineTaskParentFileHeadingKeyword, fallback.inlineTaskParentFileHeadingKeyword),
		),
		inlineTaskDailyNoteAddStartDate: readBoolean(
			raw.inlineTaskDailyNoteAddStartDate,
			fallback.inlineTaskDailyNoteAddStartDate,
		),
		inlineTaskDailyNoteAddScheduledDate: readBoolean(
			raw.inlineTaskDailyNoteAddScheduledDate,
			fallback.inlineTaskDailyNoteAddScheduledDate,
		),
		calendarInlineTaskHeading: readString(raw.calendarInlineTaskHeading, fallback.calendarInlineTaskHeading),
		autoParentFileTask: readBoolean(raw.autoParentFileTask, fallback.autoParentFileTask),
		autoParentLinkedFileSubtasks: readBoolean(raw.autoParentLinkedFileSubtasks, fallback.autoParentLinkedFileSubtasks),
		childTaskInheritanceFields: readStringArray(
			raw.childTaskInheritanceFields,
			fallback.childTaskInheritanceFields,
		),
		childTaskInheritanceStatusPipelineSource: normalizeChildTaskInheritanceStatusPipelineSource(
			raw.childTaskInheritanceStatusPipelineSource,
			fallback.childTaskInheritanceStatusPipelineSource,
		),
		taskCreatorDefaultToFileTask: readBoolean(
			raw.taskCreatorDefaultToFileTask,
			fallback.taskCreatorDefaultToFileTask,
		),
		taskCreatorDefaultFileTemplateId: readNullableString(
			raw.taskCreatorDefaultFileTemplateId,
			fallback.taskCreatorDefaultFileTemplateId,
		),
		fileTaskTemplateFolder: readString(raw.fileTaskTemplateFolder, fallback.fileTaskTemplateFolder),
		manageDailyNotesWithOperon: readBoolean(
			raw.manageDailyNotesWithOperon,
			fallback.manageDailyNotesWithOperon,
		),
		dailyNoteFormat: readString(raw.dailyNoteFormat, fallback.dailyNoteFormat).trim() || fallback.dailyNoteFormat,
		dailyNoteTemplate: readString(raw.dailyNoteTemplate, fallback.dailyNoteTemplate).trim(),
		dailyNoteFolder: readString(raw.dailyNoteFolder, fallback.dailyNoteFolder).trim(),
		createDailyNotesAsOperonTask: readBoolean(raw.createDailyNotesAsOperonTask, fallback.createDailyNotesAsOperonTask),
		manageWeeklyNotesWithOperon: readBoolean(
			raw.manageWeeklyNotesWithOperon,
			fallback.manageWeeklyNotesWithOperon,
		),
		weeklyNoteFormat: readString(raw.weeklyNoteFormat, fallback.weeklyNoteFormat).trim() || fallback.weeklyNoteFormat,
		weeklyNoteTemplate: readString(raw.weeklyNoteTemplate, fallback.weeklyNoteTemplate).trim(),
		weeklyNoteFolder: readString(raw.weeklyNoteFolder, fallback.weeklyNoteFolder).trim(),
		createWeeklyNotesAsOperonTask: readBoolean(
			raw.createWeeklyNotesAsOperonTask,
			fallback.createWeeklyNotesAsOperonTask,
		),
		defaultEstimateMinutes: readNumber(raw.defaultEstimateMinutes, fallback.defaultEstimateMinutes),
	};
}

export class TaskCreationProfileStore {
	private app: App;
	private writeQueue: WriteQueue;
	private settings: TaskCreationProfileStoreSettings;
	private serializedSettings: string;
	private recoveredFromMalformed = false;
	private packagePersist: ((settings: TaskCreationProfileStoreSettings) => Promise<void>) | null = null;

	constructor(app: App, writeQueue: WriteQueue, defaults: TaskCreationProfileStoreSettings) {
		this.app = app;
		this.writeQueue = writeQueue;
		this.settings = cloneSettings(defaults);
		this.serializedSettings = JSON.stringify(this.settings);
	}

	private getFilePath(): string {
		return buildOperonPluginStoragePath(this.app.vault.configDir, 'data', TASK_CREATION_PROFILE_FILE_NAME);
	}

	getAll(): TaskCreationProfileStoreSettings {
		return cloneSettings(this.settings);
	}

	setPackagePersistence(persist: (settings: TaskCreationProfileStoreSettings) => Promise<void>): void {
		this.packagePersist = persist;
	}

	loadFromPackage(settings: TaskCreationProfileStoreSettings): void {
		this.settings = cloneSettings(settings);
		this.serializedSettings = JSON.stringify(this.settings);
		this.recoveredFromMalformed = false;
	}

	async exists(): Promise<boolean> {
		return this.app.vault.adapter.exists(this.getFilePath());
	}

	async load(
		legacySettings: TaskCreationProfileStoreSettings | null = null,
		defaults: TaskCreationProfileStoreSettings,
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
			const parsed = JSON.parse(raw) as Partial<TaskCreationProfileStoreData>;
			this.settings = readStoreData(parsed, defaults);
			this.serializedSettings = JSON.stringify(this.settings);
			this.recoveredFromMalformed = false;
		} catch {
			console.warn('Operon: Failed to parse task creation profile store, preserving invalid file as backup and recovering from fallback settings');
			await preserveInvalidJsonFile(adapter, filePath, raw);
			this.settings = cloneSettings(legacySettings ?? defaults);
			this.serializedSettings = JSON.stringify(this.settings);
			this.recoveredFromMalformed = true;
		}
	}

	async replaceAll(settings: TaskCreationProfileStoreSettings, options: RecoveredStoreWriteOptions = {}): Promise<void> {
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
		const data: TaskCreationProfileStoreData = {
			version: TASK_CREATION_PROFILE_STORE_VERSION,
			...cloneSettings(this.settings),
		};
		await this.writeQueue.enqueue(`${filePath}::__store__`, async () => {
			await writeJsonSafely(adapter, filePath, data);
		});
		this.recoveredFromMalformed = false;
	}
}
