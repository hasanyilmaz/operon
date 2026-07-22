/**
 * Operon storage manager.
 * Handles Obsidian plugin-config storage, JSON persistence, and settings.
 * Based on Spec Section 9.6 Storage Location Contract.
 */

import { App } from 'obsidian';
import { OperonSettings, DEFAULT_SETTINGS, migrateSettings } from '../types/settings';
import { WriteQueue } from './write-queue';
import { PinnedCache } from './pinned-cache';
import { RepeatSeriesStore } from './repeat-series-store';
import { ExternalCalendarCacheStore } from './external-calendar-cache';
import { FilterStore } from './filter-store';
import { PipelineStore, PipelineStoreSettings } from './pipeline-store';
import { CalendarPresetStore, CalendarPresetStoreSettings } from './calendar-preset-store';
import { KanbanPresetStore, KanbanPresetStoreSettings } from './kanban-preset-store';
import { pickTablePresetStoreSettings, TablePresetStore } from './table-preset-store';
import { KanbanOrderStore } from './kanban-order-store';
import { KeyMappingStore } from './key-mapping-store';
import { PriorityStore, PriorityStoreSettings } from './priority-store';
import { ExternalCalendarSourceStore } from './external-calendar-source-store';
import { ContextualMenuStore, ContextualMenuStoreSettings } from './contextual-menu-store';
import { TaskUiPreferenceStore, TaskUiPreferenceStoreSettings } from './task-ui-preference-store';
import { TaskCreationProfileStore, TaskCreationProfileStoreSettings } from './task-creation-profile-store';
import { TaskAutomationPolicyStore, TaskAutomationPolicyStoreSettings } from './task-automation-policy-store';
import { ActiveTrackerStore } from './active-tracker-store';
import { ProjectSerialStore } from './project-serial-store';
import { FieldRenameJournalStore } from './field-rename-journal-store';
import { TablePresetFileMigrationJournalStore } from './table-preset-file-migration-journal-store';
import {
	enginePerfNow,
	WriteJsonMetrics,
} from '../core/engine-perf';
import { writeTextSafely, type RecoveredStoreWriteOptions } from './storage-file-ops';
import {
	buildOperonDataPackageFromSettings,
	adoptMobileNotificationsIntegration,
	getNextMobileNotificationsGeneratedAtEpochMs,
	composeOperonSettingsFromDataPackage,
	mergePinnedTasksPackages,
	OPERON_PINNED_TASK_TOMBSTONE_RETENTION_MS,
	prunePinnedTaskTombstones,
	type OperonDataPackageV1,
	type OperonMobileNotificationsIntegrationAdoption,
	type OperonMobileNotificationsIntegrationV1,
} from './operon-data-package';
import {
	OperonDataPackageStore,
	type OperonDataPackageReloadStage,
	type OperonDataPackageReloadDiagnostics,
	type OperonPipelineTaxonomyDiagnostics,
	type OperonPluginDataAccess,
} from './operon-data-package-store';
import {
	buildOperonStoragePaths,
	joinVaultPath,
	type OperonStoragePaths,
} from './operon-storage-paths';
import {
	clonePresetFavorites,
	createDefaultPresetFavorites,
	isPresetFavorite,
	removePresetFavorite,
	togglePresetFavorite,
	type PresetFavoriteKind,
} from '../core/preset-favorites';
import { isSpecialDynamicFilterSetId } from '../core/dynamic-file-task-filter';
import { cloneTablePreset, type TablePreset, type TablePresetStoreSettings } from '../types/table';
import { getAppLocale } from '../core/obsidian-app';

export type IndexV8RecoveryMarkerStatus = 'missing' | 'required' | 'invalid' | 'io-error';

const MAX_INDEX_V8_RECOVERY_MARKER_BYTES = 4 * 1024;

export interface OperonStorageOptions extends Partial<OperonPluginDataAccess> {
	pluginId?: string;
}

export interface OperonStorageReloadSettingsResult {
	changed: boolean;
	diagnostics: OperonDataPackageReloadDiagnostics;
}

function cloneOperonSettings(settings: OperonSettings): OperonSettings {
	return migrateSettings(JSON.parse(JSON.stringify(settings)) as unknown);
}

function cloneOperonSettingsPartial(partial: Partial<OperonSettings>): Partial<OperonSettings> {
	return JSON.parse(JSON.stringify(partial)) as Partial<OperonSettings>;
}

function pickPipelineStoreSettings(settings: OperonSettings): PipelineStoreSettings {
	return {
		pipelines: settings.pipelines,
		defaultPipelineName: settings.defaultPipelineName,
	};
}

function pickCalendarPresetStoreSettings(settings: OperonSettings): CalendarPresetStoreSettings {
	return {
		calendarPresets: settings.calendarPresets,
		calendarDefaultPresetId: settings.calendarDefaultPresetId,
	};
}

function pickKanbanPresetStoreSettings(settings: OperonSettings): KanbanPresetStoreSettings {
	return {
		kanbanPresets: settings.kanbanPresets,
		kanbanDefaultPresetId: settings.kanbanDefaultPresetId,
	};
}

function pickPriorityStoreSettings(settings: OperonSettings): PriorityStoreSettings {
	return {
		priorities: settings.priorities,
		defaultPriority: settings.defaultPriority,
	};
}

function pickContextualMenuStoreSettings(settings: OperonSettings): ContextualMenuStoreSettings {
	return {
		contextualMenuActionAllowlist: settings.contextualMenuActionAllowlist,
		contextualMenuSurfaceActionMatrix: settings.contextualMenuSurfaceActionMatrix,
		contextualMenuOpenDelayMs: settings.contextualMenuOpenDelayMs,
		contextualMenuMobileEnabled: settings.contextualMenuMobileEnabled,
		contextualMenuMobileLongPressMs: settings.contextualMenuMobileLongPressMs,
		contextualMenuMobileTransitionGraceMs: settings.contextualMenuMobileTransitionGraceMs,
		contextualMenuMobileAutoHideMs: settings.contextualMenuMobileAutoHideMs,
	};
}

function pickTaskUiPreferenceStoreSettings(settings: OperonSettings): TaskUiPreferenceStoreSettings {
	return {
		taskCreatorToolbar: settings.taskCreatorToolbar,
		taskEditorShowLineNumbers: settings.taskEditorShowLineNumbers,
		taskEditorWorkflowPickers: settings.taskEditorWorkflowPickers,
		taskEditorMobileCoreTools: settings.taskEditorMobileCoreTools,
		inlineExpandedTaskChips: settings.inlineExpandedTaskChips,
		inlineTaskCompactChips: settings.inlineTaskCompactChips,
		filterTaskCompactChips: settings.filterTaskCompactChips,
		kanbanTaskCompactChips: settings.kanbanTaskCompactChips,
		kanbanTaskShowPlayAction: settings.kanbanTaskShowPlayAction,
		kanbanTaskShowPinAction: settings.kanbanTaskShowPinAction,
		kanbanTaskShowNoteAction: settings.kanbanTaskShowNoteAction,
		kanbanTaskShowSubtaskAction: settings.kanbanTaskShowSubtaskAction,
		kanbanTaskShowPlainCheckboxAction: settings.kanbanTaskShowPlainCheckboxAction,
		taskFinderCompactChips: settings.taskFinderCompactChips,
		taskFinderDefaultScope: settings.taskFinderDefaultScope,
		taskFinderRememberLastScopes: settings.taskFinderRememberLastScopes,
		taskFinderSelectedProjectId: settings.taskFinderSelectedProjectId,
		taskFinderShortcuts: settings.taskFinderShortcuts,
		taskWikilinkOverlayCompactChips: settings.taskWikilinkOverlayCompactChips,
		taskWikilinkOverlayShowPlayAction: settings.taskWikilinkOverlayShowPlayAction,
		taskWikilinkOverlayShowPinAction: settings.taskWikilinkOverlayShowPinAction,
		taskWikilinkOverlayShowNoteAction: settings.taskWikilinkOverlayShowNoteAction,
		taskWikilinkOverlayShowSubtaskAction: settings.taskWikilinkOverlayShowSubtaskAction,
		taskWikilinkOverlayShowPlainCheckboxAction: settings.taskWikilinkOverlayShowPlainCheckboxAction,
		inlineTaskShowPlayAction: settings.inlineTaskShowPlayAction,
		inlineTaskShowPinAction: settings.inlineTaskShowPinAction,
		inlineTaskShowNoteAction: settings.inlineTaskShowNoteAction,
		inlineTaskShowSubtaskAction: settings.inlineTaskShowSubtaskAction,
		filterTaskShowPlayAction: settings.filterTaskShowPlayAction,
		filterTaskShowPinAction: settings.filterTaskShowPinAction,
		filterTaskShowNoteAction: settings.filterTaskShowNoteAction,
		filterTaskShowSubtaskAction: settings.filterTaskShowSubtaskAction,
		filterTaskShowPlainCheckboxAction: settings.filterTaskShowPlainCheckboxAction,
	};
}

function pickTaskCreationProfileStoreSettings(settings: OperonSettings): TaskCreationProfileStoreSettings {
	return {
		taskDescriptionRequired: settings.taskDescriptionRequired,
		assigneesRequired: settings.assigneesRequired,
		fileTasksFolder: settings.fileTasksFolder,
		inlineTaskSaveMode: settings.inlineTaskSaveMode,
		inlineTaskUseDailyNote: settings.inlineTaskUseDailyNote,
		inlineTaskTargetFile: settings.inlineTaskTargetFile,
		inlineTaskHeading: settings.inlineTaskHeading,
		fileTaskParentInlineTargetMode: settings.fileTaskParentInlineTargetMode,
		fileTaskParentFileTargetMode: settings.fileTaskParentFileTargetMode,
		inlineToFileTaskMovePlainCheckboxes: settings.inlineToFileTaskMovePlainCheckboxes,
		inlineTaskParentInlineTargetMode: settings.inlineTaskParentInlineTargetMode,
		inlineTaskParentFileTargetMode: settings.inlineTaskParentFileTargetMode,
		inlineTaskParentFileHeadingKeyword: settings.inlineTaskParentFileHeadingKeyword,
		inlineTaskDailyNoteAddStartDate: settings.inlineTaskDailyNoteAddStartDate,
		inlineTaskDailyNoteAddScheduledDate: settings.inlineTaskDailyNoteAddScheduledDate,
		calendarInlineTaskHeading: settings.calendarInlineTaskHeading,
		autoParentFileTask: settings.autoParentFileTask,
		autoParentLinkedFileSubtasks: settings.autoParentLinkedFileSubtasks,
		childTaskInheritanceFields: settings.childTaskInheritanceFields,
		childTaskInheritanceStatusPipelineSource: settings.childTaskInheritanceStatusPipelineSource,
		taskCreatorDefaultToFileTask: settings.taskCreatorDefaultToFileTask,
		taskCreatorDefaultFileTemplateId: settings.taskCreatorDefaultFileTemplateId,
		fileTaskTemplateFolder: settings.fileTaskTemplateFolder,
		createDailyNotesAsOperonTask: settings.createDailyNotesAsOperonTask,
		defaultEstimateMinutes: settings.defaultEstimateMinutes,
	};
}

function pickTaskAutomationPolicyStoreSettings(settings: OperonSettings): TaskAutomationPolicyStoreSettings {
	return {
		autoCompleteParentWhenAllChildrenTerminal: settings.autoCompleteParentWhenAllChildrenTerminal,
		cascadeCancelToDescendants: settings.cascadeCancelToDescendants,
		newOccurrencePosition: settings.newOccurrencePosition,
		fileTaskAutoArchiveEnabled: settings.fileTaskAutoArchiveEnabled,
		fileTaskArchiveFolder: settings.fileTaskArchiveFolder,
		fileTaskArchiveDelaySeconds: settings.fileTaskArchiveDelaySeconds,
		fileTaskArchiveOnlyFromFileTasksFolder: settings.fileTaskArchiveOnlyFromFileTasksFolder,
		fileRepeatDestination: settings.fileRepeatDestination,
		fileRepeatCustomFolder: settings.fileRepeatCustomFolder,
		estimateAutoReallocation: false,
		trackerSplitSessionsAtMidnight: settings.trackerSplitSessionsAtMidnight,
		reminderCatchUpWindowMinutes: settings.reminderCatchUpWindowMinutes,
		reminderNoticeDurationSeconds: settings.reminderNoticeDurationSeconds,
		reminderAutoPinDueTasks: settings.reminderAutoPinDueTasks,
		reminderSystemNotificationsEnabled: settings.reminderSystemNotificationsEnabled,
		reminderSoundFilePath: settings.reminderSoundFilePath,
	};
}

export class OperonStorage {
	private app: App;
	private writeQueue: WriteQueue;
	private settingsSaveQueue: Promise<void> = Promise.resolve();
	private settings: OperonSettings;
	private storagePaths: OperonStoragePaths;
	private dataPackageStore: OperonDataPackageStore;
	private pinnedCache: PinnedCache;
	private repeatSeriesStore: RepeatSeriesStore;
	private externalCalendarCache: ExternalCalendarCacheStore;
	private filterStore: FilterStore;
	private pipelineStore: PipelineStore;
	private calendarPresetStore: CalendarPresetStore;
	private kanbanPresetStore: KanbanPresetStore;
	private tablePresetStore: TablePresetStore;
	private kanbanOrderStore: KanbanOrderStore;
	private keyMappingStore: KeyMappingStore;
	private priorityStore: PriorityStore;
	private externalCalendarSourceStore: ExternalCalendarSourceStore;
	private contextualMenuStore: ContextualMenuStore;
	private taskUiPreferenceStore: TaskUiPreferenceStore;
	private taskCreationProfileStore: TaskCreationProfileStore;
	private taskAutomationPolicyStore: TaskAutomationPolicyStore;
	private activeTrackerStore: ActiveTrackerStore;
	private projectSerialStore: ProjectSerialStore;
	private tablePresetFileMigrationJournalStore: TablePresetFileMigrationJournalStore;
	private fieldRenameJournalStore: FieldRenameJournalStore;

	constructor(app: App, options: OperonStorageOptions = {}) {
		this.app = app;
		this.writeQueue = new WriteQueue();
		this.storagePaths = buildOperonStoragePaths(this.app.vault.configDir, options.pluginId ?? 'operon');
		const pluginData = options.loadData && options.saveData
			? { loadData: options.loadData, saveData: options.saveData }
			: null;
		this.dataPackageStore = new OperonDataPackageStore(
			this.app.vault.adapter,
			this.storagePaths,
			pluginData,
		);
		this.settings = { ...DEFAULT_SETTINGS };
		this.pinnedCache = new PinnedCache(
			app,
			this.writeQueue,
		);
		this.pinnedCache.setPackagePersistence({
			getPackage: () => this.dataPackageStore.getDataPackage().state.pinnedTasks,
			updatePackage: async (mutator) => {
				let nextPinnedTasksPackage = this.pinnedCache.toPackage();
				await this.dataPackageStore.updateDataPackage(dataPackage => {
					nextPinnedTasksPackage = mutator(dataPackage.state.pinnedTasks);
					return {
						...dataPackage,
						state: {
							...dataPackage.state,
							pinnedTasks: nextPinnedTasksPackage,
						},
					};
				});
				return nextPinnedTasksPackage;
			},
			canPersist: () => this.dataPackageStore.canPersist(),
		});
		this.repeatSeriesStore = new RepeatSeriesStore(
			app,
			this.writeQueue,
			this.storagePaths.state.repeatSeriesPath,
		);
		this.externalCalendarCache = new ExternalCalendarCacheStore(
			app,
			this.writeQueue,
			this.storagePaths.cache.externalCalendarsPath,
		);
		this.filterStore = new FilterStore(app, this.writeQueue);
		this.pipelineStore = new PipelineStore(
			app,
			this.writeQueue,
			pickPipelineStoreSettings(DEFAULT_SETTINGS),
		);
		this.calendarPresetStore = new CalendarPresetStore(
			app,
			this.writeQueue,
			pickCalendarPresetStoreSettings(DEFAULT_SETTINGS),
		);
		this.kanbanPresetStore = new KanbanPresetStore(
			app,
			this.writeQueue,
			pickKanbanPresetStoreSettings(DEFAULT_SETTINGS),
		);
		this.tablePresetStore = new TablePresetStore(
			app,
			this.writeQueue,
			pickTablePresetStoreSettings(DEFAULT_SETTINGS),
			joinVaultPath(this.storagePaths.pluginDir, 'data', 'table-presets'),
		);
		this.tablePresetFileMigrationJournalStore = new TablePresetFileMigrationJournalStore(
			app,
			this.writeQueue,
			this.storagePaths.state.tablePresetFileMigrationJournalPath,
		);
		this.kanbanOrderStore = new KanbanOrderStore(app, this.writeQueue);
		this.keyMappingStore = new KeyMappingStore(app, this.writeQueue);
		this.priorityStore = new PriorityStore(
			app,
			this.writeQueue,
			pickPriorityStoreSettings(DEFAULT_SETTINGS),
		);
		this.externalCalendarSourceStore = new ExternalCalendarSourceStore(app, this.writeQueue);
		this.contextualMenuStore = new ContextualMenuStore(
			app,
			this.writeQueue,
			pickContextualMenuStoreSettings(DEFAULT_SETTINGS),
		);
		this.taskUiPreferenceStore = new TaskUiPreferenceStore(
			app,
			this.writeQueue,
			pickTaskUiPreferenceStoreSettings(DEFAULT_SETTINGS),
		);
		this.taskCreationProfileStore = new TaskCreationProfileStore(
			app,
			this.writeQueue,
			pickTaskCreationProfileStoreSettings(DEFAULT_SETTINGS),
		);
		this.taskAutomationPolicyStore = new TaskAutomationPolicyStore(
			app,
			this.writeQueue,
			pickTaskAutomationPolicyStoreSettings(DEFAULT_SETTINGS),
		);
		this.activeTrackerStore = new ActiveTrackerStore(
			app,
			this.writeQueue,
			this.storagePaths.state.activeTrackersPath,
		);
		this.projectSerialStore = new ProjectSerialStore(
			app,
			this.writeQueue,
			this.storagePaths.state.projectSerialsPath,
		);
		this.fieldRenameJournalStore = new FieldRenameJournalStore(
			app,
			this.writeQueue,
			this.storagePaths.state.fieldRenameJournalPath,
		);
		this.filterStore.setPackagePersistence(async () => {
			this.settings.filterSets = this.filterStore.getAll();
			await this.saveSettings();
		});
		this.keyMappingStore.setPackagePersistence(async (keyMappings) => {
			this.settings.keyMappings = keyMappings;
			await this.saveSettings();
		});
		this.pipelineStore.setPackagePersistence(async (settings) => {
			await this.updateSettings(settings);
		});
		this.calendarPresetStore.setPackagePersistence(async (settings) => {
			Object.assign(this.settings, settings);
			await this.saveSettings();
		});
		this.kanbanPresetStore.setPackagePersistence(async (settings) => {
			Object.assign(this.settings, settings);
			await this.saveSettings();
		});
		this.kanbanOrderStore.setPackagePersistence(async () => {
			await this.saveSettings();
		});
		this.priorityStore.setPackagePersistence(async (settings) => {
			Object.assign(this.settings, settings);
			await this.saveSettings();
		});
		this.externalCalendarSourceStore.setPackagePersistence(async (sources) => {
			this.settings.externalCalendars = sources;
			await this.saveSettings();
		});
		this.contextualMenuStore.setPackagePersistence(async (settings) => {
			Object.assign(this.settings, settings);
			await this.saveSettings();
		});
		this.taskUiPreferenceStore.setPackagePersistence(async (settings) => {
			Object.assign(this.settings, settings);
			await this.saveSettings();
		});
		this.taskCreationProfileStore.setPackagePersistence(async (settings) => {
			Object.assign(this.settings, settings);
			await this.saveSettings();
		});
		this.taskAutomationPolicyStore.setPackagePersistence(async (settings) => {
			Object.assign(this.settings, settings);
			await this.saveSettings();
		});
	}

	/**
	 * Initialize storage: create plugin-config folders, load settings package, then load state/cache.
	 */
	async initialize(): Promise<void> {
		await this.ensureCanonicalFolders();
		const { dataPackage, loadedExistingPinnedTasksPackage } = await this.dataPackageStore.initialize(
			DEFAULT_SETTINGS,
			getAppLocale(this.app),
		);
		await this.hydrateFromDataPackage(dataPackage);
		await this.pinnedCache.load({ preferPackage: loadedExistingPinnedTasksPackage });
		await this.saveSettings({ forceRecoveredWrite: false });
		await this.activeTrackerStore.load();
		await this.repeatSeriesStore.load();
		await this.projectSerialStore.load();
		await this.fieldRenameJournalStore.load();
		await this.tablePresetFileMigrationJournalStore.load();
		await this.externalCalendarCache.load();
	}

	/**
	 * Ensure the plugin config directory structure exists.
	 */
	private async ensureCanonicalFolders(): Promise<void> {
		await this.ensureFolder(this.storagePaths.pluginDir);
		await this.ensureFolder(`${this.storagePaths.pluginDir}/state`);
		await this.ensureFolder(`${this.storagePaths.pluginDir}/runtime`);
		await this.ensureFolder(`${this.storagePaths.pluginDir}/cache`);
	}

	private async ensureFolder(path: string): Promise<void> {
		const adapter = this.app.vault.adapter;
		const segments = path.split('/').filter(Boolean);
		let current = '';
		for (const segment of segments) {
			current = current ? `${current}/${segment}` : segment;
			if (!(await adapter.exists(current))) {
				await adapter.mkdir(current);
			}
		}
	}

	// --- Settings ---

	/**
	 * Load settings from the canonical data package.
	 */
	async loadSettings(): Promise<OperonSettings> {
		return this.settings;
	}

	/**
	 * Save current settings to the canonical data package.
	 */
	async saveSettings(_options: RecoveredStoreWriteOptions = { forceRecoveredWrite: true }): Promise<void> {
		const run = this.settingsSaveQueue.then(() => this.persistSettings(_options));
		this.settingsSaveQueue = run.catch(() => {});
		await run;
	}

	async commitTablePresetFileBinding(presetId: string, path: string): Promise<void> {
		await this.enqueueSettingsTransaction(async () => {
			const previousIndex = this.settings.tablePresetFileBindings.findIndex(binding => binding.id === presetId);
			const previousBinding = previousIndex >= 0
				? { ...this.settings.tablePresetFileBindings[previousIndex] }
				: null;
			this.settings.tablePresetFileBindings = this.settings.tablePresetFileBindings
				.filter(binding => binding.id !== presetId);
			this.settings.tablePresetFileBindings.push({ id: presetId, path });
			try {
				await this.persistSettings({ forceRecoveredWrite: true });
			} catch (error) {
				this.settings.tablePresetFileBindings = this.settings.tablePresetFileBindings
					.filter(binding => binding.id !== presetId);
				if (previousBinding) {
					this.settings.tablePresetFileBindings.splice(
						Math.min(previousIndex, this.settings.tablePresetFileBindings.length),
						0,
						previousBinding,
					);
				}
				throw error;
			}
		});
	}

	async commitTablePresetFileMigrationVersion(version: number): Promise<void> {
		await this.enqueueSettingsTransaction(async () => {
			const previousVersion = this.settings.tablePresetFileMigrationVersion;
			this.settings.tablePresetFileMigrationVersion = version;
			try {
				await this.persistSettings({ forceRecoveredWrite: true });
			} catch (error) {
				if (this.settings.tablePresetFileMigrationVersion === version) {
					this.settings.tablePresetFileMigrationVersion = previousVersion;
				}
				throw error;
			}
		});
	}

	async commitTablePresetFileMigrationFinalizedVersion(version: number): Promise<void> {
		await this.enqueueSettingsTransaction(async () => {
			const previousVersion = this.settings.tablePresetFileMigrationFinalizedVersion;
			this.settings.tablePresetFileMigrationFinalizedVersion = version;
			try {
				await this.persistSettings({ forceRecoveredWrite: true });
			} catch (error) {
				if (this.settings.tablePresetFileMigrationFinalizedVersion === version) {
					this.settings.tablePresetFileMigrationFinalizedVersion = previousVersion;
				}
				throw error;
			}
		});
	}

	private enqueueSettingsTransaction<T>(operation: () => Promise<T>): Promise<T> {
		const run = this.settingsSaveQueue.then(operation);
		this.settingsSaveQueue = run.then(() => undefined, () => undefined);
		return run;
	}

	private isStoredPresetFavoriteTarget(kind: PresetFavoriteKind, presetId: string): boolean {
		switch (kind) {
			case 'calendar':
				return this.settings.calendarPresets.some(entry => entry.id === presetId);
			case 'kanban':
				return this.settings.kanbanPresets.some(entry => entry.id === presetId);
			case 'filter':
				return !isSpecialDynamicFilterSetId(presetId)
					&& this.filterStore.getAll().some(entry => entry.id === presetId);
			case 'table':
				return this.settings.tablePresets.some(entry => entry.id === presetId);
		}
	}

	private restorePresetFavoriteMembership(
		kind: PresetFavoriteKind,
		presetId: string,
		previousFavorites: OperonSettings['presetFavorites'],
	): void {
		const wasFavorite = isPresetFavorite(previousFavorites, kind, presetId);
		const isFavorite = isPresetFavorite(this.settings.presetFavorites, kind, presetId);
		if (wasFavorite === isFavorite) return;
		if (!wasFavorite) {
			this.settings.presetFavorites = removePresetFavorite(this.settings.presetFavorites, kind, presetId);
			return;
		}
		const nextFavorites = clonePresetFavorites(this.settings.presetFavorites);
		const previousIndex = previousFavorites[kind].indexOf(presetId);
		nextFavorites[kind].splice(Math.min(Math.max(previousIndex, 0), nextFavorites[kind].length), 0, presetId);
		this.settings.presetFavorites = nextFavorites;
	}

	private syncCalendarPresetStoreFromSettings(): void {
		const dataPackage = buildOperonDataPackageFromSettings(this.settings, {
			filterSets: this.filterStore.getAll(),
			kanbanOrderBoards: this.kanbanOrderStore.toPackage().boards,
		});
		this.calendarPresetStore.loadFromPackage(dataPackage.views.calendarPresets);
	}

	private syncKanbanPresetStoreFromSettings(): void {
		const dataPackage = buildOperonDataPackageFromSettings(this.settings, {
			filterSets: this.filterStore.getAll(),
			kanbanOrderBoards: this.kanbanOrderStore.toPackage().boards,
		});
		this.kanbanPresetStore.loadFromPackage(dataPackage.views.kanbanPresets);
	}

	async togglePresetFavorite(kind: PresetFavoriteKind, presetId: string): Promise<boolean> {
		return this.enqueueSettingsTransaction(async () => {
			if (!this.isStoredPresetFavoriteTarget(kind, presetId)) return false;
			const previousFavorites = clonePresetFavorites(this.settings.presetFavorites);
			this.settings.presetFavorites = togglePresetFavorite(this.settings.presetFavorites, kind, presetId);
			try {
				await this.persistSettings({ forceRecoveredWrite: true });
			} catch (error) {
				this.restorePresetFavoriteMembership(kind, presetId, previousFavorites);
				throw error;
			}
			return true;
		});
	}

	async deleteCalendarPresetWithFavoriteCleanup(presetId: string): Promise<boolean> {
		return this.enqueueSettingsTransaction(async () => {
			if (this.settings.calendarPresets.length <= 1) return false;
			if (!this.settings.calendarPresets.some(entry => entry.id === presetId)) return false;
			const previousPreset = this.settings.calendarPresets.find(entry => entry.id === presetId)!;
			const previousPresetIndex = this.settings.calendarPresets.indexOf(previousPreset);
			const previousDefaultId = this.settings.calendarDefaultPresetId;
			const previousFavorites = clonePresetFavorites(this.settings.presetFavorites);
			this.settings.calendarPresets = this.settings.calendarPresets.filter(entry => entry.id !== presetId);
			this.settings.presetFavorites = removePresetFavorite(this.settings.presetFavorites, 'calendar', presetId);
			if (!this.settings.calendarPresets.some(entry => entry.id === this.settings.calendarDefaultPresetId)) {
				this.settings.calendarDefaultPresetId = this.settings.calendarPresets[0]?.id ?? null;
			}
			const replacementDefaultId = this.settings.calendarDefaultPresetId;
			try {
				await this.persistSettings({ forceRecoveredWrite: true });
			} catch (error) {
				if (!this.settings.calendarPresets.some(entry => entry.id === presetId)) {
					this.settings.calendarPresets.splice(
						Math.min(previousPresetIndex, this.settings.calendarPresets.length),
						0,
						previousPreset,
					);
				}
				if (previousDefaultId === presetId && this.settings.calendarDefaultPresetId === replacementDefaultId) {
					this.settings.calendarDefaultPresetId = previousDefaultId;
				}
				this.restorePresetFavoriteMembership('calendar', presetId, previousFavorites);
				this.syncCalendarPresetStoreFromSettings();
				throw error;
			}
			return true;
		});
	}

	async deleteKanbanPresetWithFavoriteCleanup(presetId: string): Promise<boolean> {
		return this.enqueueSettingsTransaction(async () => {
			if (this.settings.kanbanPresets.length <= 1) return false;
			if (!this.settings.kanbanPresets.some(entry => entry.id === presetId)) return false;
			const previousPreset = this.settings.kanbanPresets.find(entry => entry.id === presetId)!;
			const previousPresetIndex = this.settings.kanbanPresets.indexOf(previousPreset);
			const previousDefaultId = this.settings.kanbanDefaultPresetId;
			const previousFavorites = clonePresetFavorites(this.settings.presetFavorites);
			const previousKanbanOrder = this.kanbanOrderStore.toPackage();
			const nextKanbanOrder = this.kanbanOrderStore.toPackage();
			delete nextKanbanOrder.boards[presetId];
			this.kanbanOrderStore.loadFromPackage(nextKanbanOrder);
			this.settings.kanbanPresets = this.settings.kanbanPresets.filter(entry => entry.id !== presetId);
			this.settings.presetFavorites = removePresetFavorite(this.settings.presetFavorites, 'kanban', presetId);
			if (!this.settings.kanbanPresets.some(entry => entry.id === this.settings.kanbanDefaultPresetId)) {
				this.settings.kanbanDefaultPresetId = this.settings.kanbanPresets[0]?.id ?? null;
			}
			const replacementDefaultId = this.settings.kanbanDefaultPresetId;
			try {
				await this.persistSettings({ forceRecoveredWrite: true });
			} catch (error) {
				if (!this.settings.kanbanPresets.some(entry => entry.id === presetId)) {
					this.settings.kanbanPresets.splice(
						Math.min(previousPresetIndex, this.settings.kanbanPresets.length),
						0,
						previousPreset,
					);
				}
				if (previousDefaultId === presetId && this.settings.kanbanDefaultPresetId === replacementDefaultId) {
					this.settings.kanbanDefaultPresetId = previousDefaultId;
				}
				this.restorePresetFavoriteMembership('kanban', presetId, previousFavorites);
				const currentKanbanOrder = this.kanbanOrderStore.toPackage();
				if (!(presetId in currentKanbanOrder.boards) && presetId in previousKanbanOrder.boards) {
					currentKanbanOrder.boards[presetId] = previousKanbanOrder.boards[presetId]!;
					this.kanbanOrderStore.loadFromPackage(currentKanbanOrder);
				}
				this.syncKanbanPresetStoreFromSettings();
				throw error;
			}
			return true;
		});
	}

	private async persistSettings(_options: RecoveredStoreWriteOptions): Promise<void> {
		if (!this.dataPackageStore.canPersist()) {
			if (_options.forceRecoveredWrite === false) return;
			throw new Error(`Operon settings writes are suspended: ${this.dataPackageStore.getWriteSuspensionReason() ?? 'data.json could not be preserved safely'}`);
		}
		if (this.settings.pipelines.length === 0) {
			throw new Error('Operon requires at least one configured pipeline');
		}
		this.settings.filterSets = this.filterStore.getAll();
		const normalized = migrateSettings(this.settings);
		this.applySettingsInPlace(normalized);
		const legacyTableStoreActive = this.settings.tablePresetFileMigrationVersion < 1;
		const previousTableSettings = legacyTableStoreActive ? this.tablePresetStore.getAll() : null;
		const fileBackedTablePresetIds = new Set(this.settings.tablePresetFileBindings.map(binding => binding.id));
		const legacyTableSettings = pickTablePresetStoreSettings(this.settings);
		legacyTableSettings.tablePresets = legacyTableSettings.tablePresets.filter(preset => !fileBackedTablePresetIds.has(preset.id));
		legacyTableSettings.tablePresetOrderIds = (legacyTableSettings.tablePresetOrderIds ?? [])
			.filter(presetId => !fileBackedTablePresetIds.has(presetId));
		if (legacyTableStoreActive) {
			await this.tablePresetStore.replaceAll(legacyTableSettings, {
				preservePresetIds: fileBackedTablePresetIds,
				allowEmpty: fileBackedTablePresetIds.size > 0,
			});
		}
		const dataPackage = buildOperonDataPackageFromSettings(this.settings, {
			filterSets: this.filterStore.getAll(),
			kanbanOrderBoards: this.kanbanOrderStore.toPackage().boards,
			pinnedTasks: this.pinnedCache.toPackage(),
		});
		try {
			await this.dataPackageStore.updateDataPackage(currentPackage => {
				const nextSnapshotEnabled = dataPackage.integrations.mobileNotifications.snapshotEnabled;
				const currentMobileNotifications = currentPackage.integrations.mobileNotifications;
				const pinnedTasks = prunePinnedTaskTombstones(
					mergePinnedTasksPackages(
						currentPackage.state.pinnedTasks,
						dataPackage.state.pinnedTasks,
					),
					new Date().toISOString(),
					OPERON_PINNED_TASK_TOMBSTONE_RETENTION_MS,
				);
				return {
					...dataPackage,
					integrations: {
						...dataPackage.integrations,
						mobileNotifications: {
							...currentMobileNotifications,
							snapshotEnabled: nextSnapshotEnabled,
							cancelPending: nextSnapshotEnabled
								? false
								: currentMobileNotifications.snapshotEnabled || currentMobileNotifications.cancelPending,
						},
					},
					state: {
						...dataPackage.state,
						pinnedTasks,
					},
				};
			});
		} catch (error) {
			if (previousTableSettings) {
				try {
					await this.tablePresetStore.replaceAll(previousTableSettings, { preservePresetIds: fileBackedTablePresetIds });
				} catch (rollbackError) {
					console.error('Operon: failed to roll back Table preset storage after settings save failure', rollbackError);
				}
			}
			throw error;
		}
		this.hydratePackageBackedSettingStores();
	}

	/**
	 * Get current settings (in-memory).
	 */
	getSettings(): OperonSettings {
		return this.settings;
	}

	/**
	 * Update settings and persist.
	 */
	async updateSettings(partial: Partial<OperonSettings>): Promise<void> {
		const pendingUpdate = cloneOperonSettingsPartial(partial);
		if (pendingUpdate.pipelines?.length === 0) {
			throw new Error('Operon requires at least one configured pipeline');
		}
		// Apply the patch only after earlier saves or reloads commit, so it rebases on their latest state.
		const run = this.settingsSaveQueue.then(async () => {
			const previousSettings = this.getCommittedSettingsSnapshot();
			Object.assign(this.settings, pendingUpdate);
			try {
				await this.persistSettings({ forceRecoveredWrite: true });
			} catch (error) {
				this.applySettingsInPlace(previousSettings);
				this.hydratePackageBackedSettingStores();
				throw error;
			}
		});
		this.settingsSaveQueue = run.then(() => undefined, () => undefined);
		await run;
	}

	async reloadCanonicalSettingsPackage(): Promise<OperonStorageReloadSettingsResult> {
		// Reload occupies the settings mutex so a later save cannot build from a half-staged package.
		const run = this.settingsSaveQueue.then(async () => {
			const result = await this.dataPackageStore.reloadCanonicalDataPackage(DEFAULT_SETTINGS, {
				stage: dataPackage => this.stageCanonicalDataPackageReload(dataPackage),
			});
			if (!result.dataPackage.ui.presetFavorites) {
				await this.persistSettings({ forceRecoveredWrite: true });
			}
			return {
				changed: result.changed,
				diagnostics: result.diagnostics,
			};
		});
		this.settingsSaveQueue = run.then(() => undefined, () => undefined);
		return run;
	}

	async backupCanonicalSettingsPackage(raw?: unknown): Promise<string> {
		return this.dataPackageStore.backupCanonicalDataPackage(raw);
	}

	suspendCanonicalSettingsWrites(reason: string): void {
		this.dataPackageStore.suspendWrites(reason);
	}

	resumeCanonicalSettingsWrites(): void {
		this.dataPackageStore.resumeWrites();
	}

	getCanonicalSettingsWriteSuspensionReason(): string | null {
		return this.dataPackageStore.getWriteSuspensionReason();
	}

	getStartupPipelineTaxonomyDiagnostics(): OperonPipelineTaxonomyDiagnostics {
		return this.dataPackageStore.getStartupPipelineTaxonomyDiagnostics();
	}

	private applySettingsInPlace(normalized: OperonSettings): void {
		const target = this.settings as unknown as Record<string, unknown>;
		const source = normalized as unknown as Record<string, unknown>;
		for (const key of Object.keys(normalized)) {
			target[key] = source[key];
		}
	}

	private getCommittedSettingsSnapshot(): OperonSettings {
		const committed = this.dataPackageStore.getSettings(DEFAULT_SETTINGS);
		const packageTableManifest = pickTablePresetStoreSettings(committed);
		const legacyTableSettings = this.tablePresetStore.getAll();
		if (this.hasFileBackedTablePresetAuthority(packageTableManifest)) {
			committed.tablePresets = legacyTableSettings.tablePresets.map(cloneTablePreset);
			this.applyFileBackedTablePresetManifest(committed, packageTableManifest, this.settings.tablePresets);
		} else {
			Object.assign(committed, legacyTableSettings);
		}
		return committed;
	}

	private hasFileBackedTablePresetAuthority(settings: TablePresetStoreSettings): boolean {
		return (settings.tablePresetFileBindings?.length ?? 0) > 0
			|| settings.tablePresetFileMigrationVersion >= 1;
	}

	private applyFileBackedTablePresetManifest(
		target: OperonSettings,
		manifest: TablePresetStoreSettings,
		runtimePresets: readonly TablePreset[] = [],
	): void {
		const boundPresetIds = new Set((manifest.tablePresetFileBindings ?? []).map(binding => binding.id));
		const presetsById = new Map(target.tablePresets.map(preset => [preset.id, preset]));
		for (const preset of runtimePresets) {
			if (boundPresetIds.has(preset.id)) presetsById.set(preset.id, cloneTablePreset(preset));
		}
		const orderIds = [...(manifest.tablePresetOrderIds ?? [])];
		const orderedPresetIds = new Set(orderIds);
		target.tablePresets = [
			...orderIds.flatMap(presetId => {
				const preset = presetsById.get(presetId);
				return preset ? [preset] : [];
			}),
			...[...presetsById.values()].filter(preset => !orderedPresetIds.has(preset.id)),
		];
		target.tablePresetOrderIds = orderIds;
		target.tablePresetFileBindings = (manifest.tablePresetFileBindings ?? []).map(binding => ({ ...binding }));
		target.tablePresetFileMigrationVersion = manifest.tablePresetFileMigrationVersion;
		target.tablePresetFileMigrationFinalizedVersion = manifest.tablePresetFileMigrationFinalizedVersion;
		target.tableDefaultPresetId = manifest.tableDefaultPresetId;
		target.tableEmbedVisibleRows = manifest.tableEmbedVisibleRows;
		target.tableShowLineNumbers = manifest.tableShowLineNumbers;
		target.tableShowTaskIcon = manifest.tableShowTaskIcon;
		target.tableShowTaskTypeIcon = manifest.tableShowTaskTypeIcon;
	}

	private async stageCanonicalDataPackageReload(
		dataPackage: OperonDataPackageV1,
	): Promise<OperonDataPackageReloadStage> {
		const nextSettings = composeOperonSettingsFromDataPackage(dataPackage, DEFAULT_SETTINGS);
		const packageTableManifest = pickTablePresetStoreSettings(nextSettings);
		const currentFileProjectionSignature = JSON.stringify({
			orderIds: this.settings.tablePresetOrderIds,
			bindings: this.settings.tablePresetFileBindings,
			defaultPresetId: this.settings.tableDefaultPresetId,
		});
		const packageFileProjectionSignature = JSON.stringify({
			orderIds: packageTableManifest.tablePresetOrderIds ?? [],
			bindings: packageTableManifest.tablePresetFileBindings ?? [],
			defaultPresetId: packageTableManifest.tableDefaultPresetId,
		});
		const stagedFilterStore = new FilterStore(this.app, this.writeQueue);
		stagedFilterStore.loadFromPackage(dataPackage.views.filters, {
			seedDynamicDefaultSorts: dataPackage.settings.settingsVersion < 88,
		});
		nextSettings.filterSets = stagedFilterStore.getAll();
		const stagedTablePresetStore = new TablePresetStore(
			this.app,
			this.writeQueue,
			pickTablePresetStoreSettings(nextSettings),
		);
		const tableLoad = await stagedTablePresetStore.load(
			pickTablePresetStoreSettings(nextSettings),
			{
				availableFilterSetIds: nextSettings.filterSets.map(filterSet => filterSet.id),
				canSeedFromFallback: false,
			},
		);
		Object.assign(nextSettings, tableLoad.settings);
		if (this.hasFileBackedTablePresetAuthority(packageTableManifest)) {
			this.applyFileBackedTablePresetManifest(nextSettings, packageTableManifest, this.settings.tablePresets);
		}
		nextSettings.tablePresetFileMigrationFinalizedVersion = Math.max(
			nextSettings.tablePresetFileMigrationFinalizedVersion,
			this.settings.tablePresetFileMigrationFinalizedVersion,
		);
		nextSettings.tablePresetFileMigrationVersion = Math.max(
			nextSettings.tablePresetFileMigrationVersion,
			this.settings.tablePresetFileMigrationVersion,
			nextSettings.tablePresetFileMigrationFinalizedVersion >= 1 ? 1 : 0,
		);
		if (!dataPackage.ui.presetFavorites) {
			nextSettings.presetFavorites = createDefaultPresetFavorites({
				table: nextSettings.tableDefaultPresetId,
				calendar: nextSettings.calendarDefaultPresetId,
				kanban: nextSettings.kanbanDefaultPresetId,
			});
		}

		const previousSettings = cloneOperonSettings(this.settings);
		const previousDataPackage = this.dataPackageStore.getDataPackage();
		const previousTableSnapshot = this.tablePresetStore.captureRuntimeSnapshot();
		Object.assign(previousSettings, previousTableSnapshot.settings);
		const nextTableSnapshot = stagedTablePresetStore.captureRuntimeSnapshot();
		const tablePresetsChanged = JSON.stringify(previousTableSnapshot.settings)
			!== JSON.stringify(nextTableSnapshot.settings);
		const fileProjectionChanged = this.hasFileBackedTablePresetAuthority(packageTableManifest)
			&& currentFileProjectionSignature !== packageFileProjectionSignature;
		let commitStarted = false;

		const applyRuntimePackage = (
			packageToApply: OperonDataPackageV1,
			settingsToApply: OperonSettings,
		): void => {
			this.filterStore.loadFromPackage(packageToApply.views.filters, {
				seedDynamicDefaultSorts: packageToApply.settings.settingsVersion < 88,
			});
			this.kanbanOrderStore.loadFromPackage(packageToApply.views.kanbanOrder);
			this.pinnedCache.loadFromPackage(packageToApply.state.pinnedTasks, {
				resetGeneration: false,
			});
			this.applySettingsInPlace(settingsToApply);
			this.settings.filterSets = this.filterStore.getAll();
			this.hydratePackageBackedSettingStores();
		};

		return {
			changed: tablePresetsChanged || fileProjectionChanged,
			commit: () => {
				commitStarted = true;
				this.tablePresetStore.restoreRuntimeSnapshot(nextTableSnapshot);
				applyRuntimePackage(dataPackage, nextSettings);
			},
			rollback: () => {
				if (!commitStarted) return;
				this.tablePresetStore.restoreRuntimeSnapshot(previousTableSnapshot);
				applyRuntimePackage(previousDataPackage, previousSettings);
			},
		};
	}

	private async hydrateFromDataPackage(
		dataPackage: OperonDataPackageV1,
		options: { preserveSettingsIdentity?: boolean } = {},
	): Promise<boolean> {
		const shouldSeedPresetFavorites = !dataPackage.ui.presetFavorites;
		this.filterStore.loadFromPackage(dataPackage.views.filters, {
			seedDynamicDefaultSorts: dataPackage.settings.settingsVersion < 88,
		});
		this.kanbanOrderStore.loadFromPackage(dataPackage.views.kanbanOrder);
		this.pinnedCache.loadFromPackage(dataPackage.state.pinnedTasks, {
			resetGeneration: !options.preserveSettingsIdentity,
		});
		const nextSettings = composeOperonSettingsFromDataPackage(dataPackage, DEFAULT_SETTINGS);
		const packageTableManifest = pickTablePresetStoreSettings(nextSettings);
		const tableLoad = await this.tablePresetStore.load(
			pickTablePresetStoreSettings(nextSettings),
			{
				availableFilterSetIds: this.filterStore.getAll().map(filterSet => filterSet.id),
				canSeedFromFallback: this.dataPackageStore.canPersist(),
			},
		);
		Object.assign(nextSettings, tableLoad.settings);
		if (this.hasFileBackedTablePresetAuthority(packageTableManifest)) {
			this.applyFileBackedTablePresetManifest(nextSettings, packageTableManifest);
		}
		if (shouldSeedPresetFavorites) {
			nextSettings.presetFavorites = createDefaultPresetFavorites({
				table: nextSettings.tableDefaultPresetId,
				calendar: nextSettings.calendarDefaultPresetId,
				kanban: nextSettings.kanbanDefaultPresetId,
			});
		}
		if (options.preserveSettingsIdentity) {
			this.applySettingsInPlace(nextSettings);
		} else {
			this.settings = nextSettings;
		}
		this.settings.filterSets = this.filterStore.getAll();
		this.hydratePackageBackedSettingStores();
		return tableLoad.changed;
	}

	private hydratePackageBackedSettingStores(): void {
		const dataPackage = buildOperonDataPackageFromSettings(this.settings, {
			filterSets: this.filterStore.getAll(),
			kanbanOrderBoards: this.kanbanOrderStore.toPackage().boards,
		});
		this.keyMappingStore.loadFromPackage(dataPackage.taxonomy.keyMappings);
		this.pipelineStore.loadFromPackage(dataPackage.taxonomy.pipelines);
		this.calendarPresetStore.loadFromPackage(dataPackage.views.calendarPresets);
		this.kanbanPresetStore.loadFromPackage(dataPackage.views.kanbanPresets);
		this.priorityStore.loadFromPackage(dataPackage.taxonomy.priorities);
		this.externalCalendarSourceStore.loadFromPackage(dataPackage.integrations.externalCalendarSources.sources);
		this.contextualMenuStore.loadFromPackage(dataPackage.ui.contextualMenu);
		this.taskUiPreferenceStore.loadFromPackage(dataPackage.ui.taskUiPreferences);
		this.taskCreationProfileStore.loadFromPackage(dataPackage.ui.taskCreationProfile);
		this.taskAutomationPolicyStore.loadFromPackage(dataPackage.automation.taskAutomationPolicy);
	}

	async inspectIndexV8RecoveryRequired(): Promise<IndexV8RecoveryMarkerStatus> {
		const path = this.storagePaths.runtime.indexV8RecoveryRequiredPath;
		try {
			const stat = await this.app.vault.adapter.stat(path);
			if (!stat) return 'missing';
			if (stat.type !== 'file' || stat.size > MAX_INDEX_V8_RECOVERY_MARKER_BYTES) return 'invalid';
			const payload = await this.app.vault.adapter.read(path);
			if (this.getJsonByteLength(payload) > MAX_INDEX_V8_RECOVERY_MARKER_BYTES) return 'invalid';
			let parsed: unknown;
			try {
				parsed = JSON.parse(payload) as unknown;
			} catch {
				return 'invalid';
			}
			const marker = parsed as { version?: unknown; required?: unknown } | null;
			return marker?.version === 1 && marker.required === true ? 'required' : 'invalid';
		} catch {
			return 'io-error';
		}
	}

	async hasIndexV8RecoveryRequired(): Promise<boolean> {
		return await this.inspectIndexV8RecoveryRequired() !== 'missing';
	}

	async markIndexV8RecoveryRequired(): Promise<void> {
		await this.writeJson(this.storagePaths.runtime.indexV8RecoveryRequiredPath, {
			version: 1,
			required: true,
		});
	}

	async clearIndexV8RecoveryRequired(): Promise<void> {
		const path = this.storagePaths.runtime.indexV8RecoveryRequiredPath;
		await this.writeQueue.enqueue(path, async () => {
			if (await this.app.vault.adapter.exists(path)) await this.app.vault.adapter.remove(path);
		});
	}

	// --- Generic JSON I/O ---

	/**
	 * Read and parse a JSON file. Returns null if file doesn't exist or parse fails.
	 */
	private async readJson<T>(path: string): Promise<T | null> {
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(path))) return null;

		try {
			const raw = await adapter.read(path);
			return JSON.parse(raw) as T;
		} catch {
			console.warn(`Operon: Failed to parse ${path}`);
			return null;
		}
	}

	/**
	 * Write data as JSON to a file. Uses write queue for atomic writes.
	 */
	private async writeJson<T>(path: string, data: T): Promise<WriteJsonMetrics> {
		const totalStartedAt = enginePerfNow();
		let metrics: WriteJsonMetrics | null = null;
		await this.writeQueue.enqueue(path, async () => {
			const operationStartedAt = enginePerfNow();
			const stringifyStartedAt = enginePerfNow();
			const json = JSON.stringify(data, null, '\t');
			const stringifyMs = enginePerfNow() - stringifyStartedAt;
			const writeStartedAt = enginePerfNow();
			await writeTextSafely(this.app.vault.adapter, path, json);
			const writeMs = enginePerfNow() - writeStartedAt;
			metrics = {
				jsonBytes: this.getJsonByteLength(json),
				stringifyMs,
				writeMs,
				queueWaitMs: operationStartedAt - totalStartedAt,
				totalMs: enginePerfNow() - totalStartedAt,
			};
		});
		return metrics ?? {
			jsonBytes: 0,
			stringifyMs: 0,
			writeMs: 0,
			queueWaitMs: 0,
			totalMs: enginePerfNow() - totalStartedAt,
		};
	}

	private getJsonByteLength(json: string): number {
		if (typeof TextEncoder !== 'undefined') {
			return new TextEncoder().encode(json).length;
		}
		return json.length;
	}

	// --- Paths ---

	get dataFolder(): string { return this.storagePaths.pluginDir; }
	get settingsPath(): string { return this.storagePaths.dataPackagePath; }
	get indexPath(): string { return this.storagePaths.runtime.indexPath; }
	get indexV8Paths(): OperonStoragePaths['runtime']['indexV8'] { return { ...this.storagePaths.runtime.indexV8 }; }
	get pinned(): PinnedCache { return this.pinnedCache; }
	get activeTrackers(): ActiveTrackerStore { return this.activeTrackerStore; }
	get repeatSeries(): RepeatSeriesStore { return this.repeatSeriesStore; }
	get projectSerials(): ProjectSerialStore { return this.projectSerialStore; }
	get fieldRenameJournal(): FieldRenameJournalStore { return this.fieldRenameJournalStore; }
	get externalCalendars(): ExternalCalendarCacheStore { return this.externalCalendarCache; }
	get externalCalendarSources(): ExternalCalendarSourceStore { return this.externalCalendarSourceStore; }
	get filters(): FilterStore { return this.filterStore; }

	getMobileNotificationsIntegration(): OperonMobileNotificationsIntegrationV1 {
		return structuredClone(this.dataPackageStore.getDataPackage().integrations.mobileNotifications);
	}

	async adoptMobileNotificationsIntegration(
		candidate: OperonMobileNotificationsIntegrationAdoption,
	): Promise<OperonMobileNotificationsIntegrationV1> {
		let adopted = this.getMobileNotificationsIntegration();
		await this.dataPackageStore.updateDataPackage(dataPackage => {
			adopted = adoptMobileNotificationsIntegration(dataPackage.integrations.mobileNotifications, candidate);
			return {
				...dataPackage,
				integrations: {
					...dataPackage.integrations,
					mobileNotifications: adopted,
				},
			};
		});
		return structuredClone(adopted);
	}

	async getOrCreateMobileNotificationsVaultId(adoptedVaultId?: string | null): Promise<string> {
		let vaultId = '';
		await this.dataPackageStore.updateDataPackage(dataPackage => {
			let current = adoptMobileNotificationsIntegration(dataPackage.integrations.mobileNotifications, {
				vaultId: adoptedVaultId,
			});
			if (!current.vaultId) {
				const generatedVaultId = window.crypto?.randomUUID?.().toLowerCase();
				if (!generatedVaultId) throw new Error('Could not generate the mobile notifications vault identity');
				current = adoptMobileNotificationsIntegration(current, { vaultId: generatedVaultId });
			}
			vaultId = current.vaultId ?? '';
			return {
				...dataPackage,
				integrations: {
					...dataPackage.integrations,
					mobileNotifications: current,
				},
			};
		});
		if (!vaultId) throw new Error('Could not persist the mobile notifications vault identity');
		return vaultId;
	}

	async reserveMobileNotificationsGeneratedAtEpochMs(
		nowEpochMs: number,
		minimumExclusive = -1,
	): Promise<number> {
		let reservedEpochMs = nowEpochMs;
		await this.dataPackageStore.updateDataPackage(dataPackage => {
			const current = dataPackage.integrations.mobileNotifications;
			reservedEpochMs = getNextMobileNotificationsGeneratedAtEpochMs(current, nowEpochMs, minimumExclusive);
			return {
				...dataPackage,
				integrations: {
					...dataPackage.integrations,
					mobileNotifications: {
						...current,
						lastGeneratedAtEpochMs: reservedEpochMs,
					},
				},
			};
		});
		return reservedEpochMs;
	}

	async markMobileNotificationsCancelAllPublished(): Promise<void> {
		await this.dataPackageStore.updateDataPackage(dataPackage => ({
			...dataPackage,
			integrations: {
				...dataPackage.integrations,
				mobileNotifications: {
					...dataPackage.integrations.mobileNotifications,
					cancelPending: false,
				},
			},
		}));
	}

	async deleteFilterSetWithFavoriteCleanup(filterId: string): Promise<void> {
		await this.enqueueSettingsTransaction(async () => {
			if (isSpecialDynamicFilterSetId(filterId)) return;
			const previousFavorites = clonePresetFavorites(this.settings.presetFavorites);
			const previousFilters = this.filterStore.toPackage();
			if (!previousFilters.filterIds.includes(filterId)) return;
			const nextFilters = this.filterStore.toPackage();
			nextFilters.filterIds = nextFilters.filterIds.filter(id => id !== filterId);
			delete nextFilters.itemsById[filterId];
			this.filterStore.loadFromPackage(nextFilters);
			this.settings.filterSets = this.filterStore.getAll();
			this.settings.presetFavorites = removePresetFavorite(this.settings.presetFavorites, 'filter', filterId);
			try {
				await this.persistSettings({ forceRecoveredWrite: true });
			} catch (error) {
				const currentFilters = this.filterStore.toPackage();
				if (!(filterId in currentFilters.itemsById)) {
					const previousFilter = previousFilters.itemsById[filterId];
					if (previousFilter) {
						currentFilters.itemsById[filterId] = previousFilter;
						const previousIndex = previousFilters.filterIds.indexOf(filterId);
						currentFilters.filterIds.splice(
							Math.min(Math.max(previousIndex, 0), currentFilters.filterIds.length),
							0,
							filterId,
						);
					}
				}
				this.filterStore.loadFromPackage(currentFilters);
				this.settings.filterSets = this.filterStore.getAll();
				this.restorePresetFavoriteMembership('filter', filterId, previousFavorites);
				throw error;
			}
		});
	}

	get pipelines(): PipelineStore { return this.pipelineStore; }
	get calendarPresets(): CalendarPresetStore { return this.calendarPresetStore; }
	get kanbanPresets(): KanbanPresetStore { return this.kanbanPresetStore; }
	get tablePresets(): TablePresetStore { return this.tablePresetStore; }
	get tablePresetFileMigrationJournal(): TablePresetFileMigrationJournalStore { return this.tablePresetFileMigrationJournalStore; }
	get tablePresetFileMigrationBackupRootPath(): string { return this.storagePaths.tablePresetFileMigrationBackupRootPath; }
	get tablePresetFileMigrationReceiptPath(): string { return this.storagePaths.state.tablePresetFileMigrationReceiptPath; }
	get kanbanOrder(): KanbanOrderStore { return this.kanbanOrderStore; }
	get keyMappings(): KeyMappingStore { return this.keyMappingStore; }
	get priorities(): PriorityStore { return this.priorityStore; }

		async flushPendingWrites(): Promise<void> {
			const storeDrainResults = await Promise.allSettled([
				this.settingsSaveQueue,
				this.dataPackageStore.drain(),
				this.pinnedCache.drain(),
				this.activeTrackerStore.drain(),
			this.repeatSeriesStore.drain(),
			this.projectSerialStore.drain(),
			this.fieldRenameJournalStore.drain(),
			this.tablePresetFileMigrationJournalStore.drain(),
			this.externalCalendarCache.drain(),
		]);
		await this.writeQueue.drain();
		const failedDrain = storeDrainResults.find(result => result.status === 'rejected');
		if (failedDrain?.status === 'rejected') {
			throw failedDrain.reason;
		}
	}

	/**
	 * Cleanup on plugin unload.
	 */
	destroy(): void {
		this.writeQueue.clear();
	}
}
