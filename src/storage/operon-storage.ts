/**
 * Operon storage manager.
 * Handles Obsidian plugin-config storage, JSON persistence, and settings.
 * Based on Spec Section 9.6 Storage Location Contract.
 */

import { App } from 'obsidian';
import { OperonSettings, DEFAULT_SETTINGS, migrateSettings } from '../types/settings';
import { IndexData } from '../types/fields';
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
import { enginePerfNow, WriteJsonMetrics } from '../core/engine-perf';
import { writeTextSafely, type RecoveredStoreWriteOptions } from './storage-file-ops';
import {
	buildOperonDataPackageFromSettings,
	composeOperonSettingsFromDataPackage,
	mergePinnedTasksPackages,
	OPERON_PINNED_TASK_TOMBSTONE_RETENTION_MS,
	prunePinnedTaskTombstones,
	type OperonDataPackageV1,
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
		inlineTaskShowSubtaskAction: settings.inlineTaskShowSubtaskAction,
		filterTaskShowPlayAction: settings.filterTaskShowPlayAction,
		filterTaskShowPinAction: settings.filterTaskShowPinAction,
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
		const { dataPackage, loadedExistingPinnedTasksPackage } = await this.dataPackageStore.initialize(DEFAULT_SETTINGS);
		await this.hydrateFromDataPackage(dataPackage);
		await this.pinnedCache.load({ preferPackage: loadedExistingPinnedTasksPackage });
		await this.saveSettings({ forceRecoveredWrite: false });
		await this.activeTrackerStore.load();
		await this.repeatSeriesStore.load();
		await this.projectSerialStore.load();
		await this.fieldRenameJournalStore.load();
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
		await this.tablePresetStore.replaceAll(pickTablePresetStoreSettings(this.settings));
		const dataPackage = buildOperonDataPackageFromSettings(this.settings, {
			filterSets: this.filterStore.getAll(),
			kanbanOrderBoards: this.kanbanOrderStore.toPackage().boards,
			pinnedTasks: this.pinnedCache.toPackage(),
		});
		await this.dataPackageStore.updateDataPackage(currentPackage => {
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
				state: {
					...dataPackage.state,
					pinnedTasks,
				},
			};
		});
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
		Object.assign(committed, this.tablePresetStore.getAll());
		return committed;
	}

	private async stageCanonicalDataPackageReload(
		dataPackage: OperonDataPackageV1,
	): Promise<OperonDataPackageReloadStage> {
		const nextSettings = composeOperonSettingsFromDataPackage(dataPackage, DEFAULT_SETTINGS);
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

		const previousSettings = cloneOperonSettings(this.settings);
		const previousDataPackage = this.dataPackageStore.getDataPackage();
		const previousTableSnapshot = this.tablePresetStore.captureRuntimeSnapshot();
		Object.assign(previousSettings, previousTableSnapshot.settings);
		const nextTableSnapshot = stagedTablePresetStore.captureRuntimeSnapshot();
		const tablePresetsChanged = JSON.stringify(previousTableSnapshot.settings)
			!== JSON.stringify(pickTablePresetStoreSettings(nextSettings));
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
			changed: tablePresetsChanged,
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
		this.filterStore.loadFromPackage(dataPackage.views.filters, {
			seedDynamicDefaultSorts: dataPackage.settings.settingsVersion < 88,
		});
		this.kanbanOrderStore.loadFromPackage(dataPackage.views.kanbanOrder);
		this.pinnedCache.loadFromPackage(dataPackage.state.pinnedTasks, {
			resetGeneration: !options.preserveSettingsIdentity,
		});
		const nextSettings = composeOperonSettingsFromDataPackage(dataPackage, DEFAULT_SETTINGS);
		const tableLoad = await this.tablePresetStore.load(
			pickTablePresetStoreSettings(nextSettings),
			{
				availableFilterSetIds: this.filterStore.getAll().map(filterSet => filterSet.id),
				canSeedFromFallback: this.dataPackageStore.canPersist(),
			},
		);
		Object.assign(nextSettings, tableLoad.settings);
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

	// --- Index ---

	/**
	 * Load active task index from plugin runtime storage.
	 */
	async loadIndex(): Promise<IndexData | null> {
		return this.readJson<IndexData>(this.storagePaths.runtime.indexPath);
	}

	/**
	 * Save active task index to plugin runtime storage (atomic write).
	 */
	async saveIndex(data: IndexData): Promise<WriteJsonMetrics> {
		return await this.writeJson(this.storagePaths.runtime.indexPath, data);
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
	get pinned(): PinnedCache { return this.pinnedCache; }
	get activeTrackers(): ActiveTrackerStore { return this.activeTrackerStore; }
	get repeatSeries(): RepeatSeriesStore { return this.repeatSeriesStore; }
	get projectSerials(): ProjectSerialStore { return this.projectSerialStore; }
	get fieldRenameJournal(): FieldRenameJournalStore { return this.fieldRenameJournalStore; }
	get externalCalendars(): ExternalCalendarCacheStore { return this.externalCalendarCache; }
	get externalCalendarSources(): ExternalCalendarSourceStore { return this.externalCalendarSourceStore; }
	get filters(): FilterStore { return this.filterStore; }
	get pipelines(): PipelineStore { return this.pipelineStore; }
	get calendarPresets(): CalendarPresetStore { return this.calendarPresetStore; }
	get kanbanPresets(): KanbanPresetStore { return this.kanbanPresetStore; }
	get tablePresets(): TablePresetStore { return this.tablePresetStore; }
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
