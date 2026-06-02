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
import { KanbanOrderStore } from './kanban-order-store';
import { KeyMappingStore } from './key-mapping-store';
import { PriorityStore, PriorityStoreSettings } from './priority-store';
import { ExternalCalendarSourceStore } from './external-calendar-source-store';
import { ContextualMenuStore, ContextualMenuStoreSettings } from './contextual-menu-store';
import { TaskUiPreferenceStore, TaskUiPreferenceStoreSettings } from './task-ui-preference-store';
import { TaskCreationProfileStore, TaskCreationProfileStoreSettings } from './task-creation-profile-store';
import { TaskAutomationPolicyStore, TaskAutomationPolicyStoreSettings } from './task-automation-policy-store';
import { ActiveTrackerStore } from './active-tracker-store';
import { enginePerfNow, WriteJsonMetrics } from '../core/engine-perf';
import { writeTextSafely, type RecoveredStoreWriteOptions } from './storage-file-ops';
import {
	buildOperonDataPackageFromSettings,
	type OperonDataPackageV1,
} from './operon-data-package';
import {
	OperonDataPackageStore,
	type OperonDataPackageReloadDiagnostics,
	type OperonPluginDataAccess,
} from './operon-data-package-store';
import {
	buildOperonStoragePaths,
	type OperonStoragePaths,
} from './operon-storage-paths';

export interface OperonStorageOptions extends Partial<OperonPluginDataAccess> {
	pluginId?: string;
}

export interface OperonStorageReloadSettingsResult {
	changed: boolean;
	diagnostics: OperonDataPackageReloadDiagnostics;
}

export type OperonLegacyStorageCleanupMethod = 'trash-system' | 'trash-local';
export type OperonLegacyStorageCleanupState = 'ready' | 'blocked' | 'missing' | 'retired';

export interface OperonStorageMigrationMarker {
	version: 1;
	legacyStorageRetired: true;
	retiredAt: string;
	cleanupMethod: OperonLegacyStorageCleanupMethod;
	legacyFileCount: number;
	legacyFolderCount: number;
}

export interface OperonLegacyStorageCleanupStatus {
	legacyPath: string;
	markerPath: string;
	legacyExists: boolean;
	legacyStorageRetired: boolean;
	canonicalSettingsReadable: boolean;
	canCleanup: boolean;
	state: OperonLegacyStorageCleanupState;
	blockedReason: string | null;
	legacyFileCount: number;
	legacyFolderCount: number;
	marker: OperonStorageMigrationMarker | null;
}

export interface OperonLegacyStorageCleanupResult {
	cleanupPerformed: boolean;
	cleanupMethod: OperonLegacyStorageCleanupMethod | null;
	status: OperonLegacyStorageCleanupStatus;
	marker: OperonStorageMigrationMarker | null;
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
	};
}

function pickTaskUiPreferenceStoreSettings(settings: OperonSettings): TaskUiPreferenceStoreSettings {
	return {
		taskCreatorToolbar: settings.taskCreatorToolbar,
		taskEditorShowLineNumbers: settings.taskEditorShowLineNumbers,
		taskEditorWorkflowPickers: settings.taskEditorWorkflowPickers,
		inlineExpandedTaskChips: settings.inlineExpandedTaskChips,
		inlineTaskCompactChips: settings.inlineTaskCompactChips,
		filterTaskCompactChips: settings.filterTaskCompactChips,
		taskFinderCompactChips: settings.taskFinderCompactChips,
		taskFinderDefaultScope: settings.taskFinderDefaultScope,
		taskFinderRememberLastScopes: settings.taskFinderRememberLastScopes,
		taskFinderSelectedProjectId: settings.taskFinderSelectedProjectId,
		taskFinderShortcuts: settings.taskFinderShortcuts,
		overlayTaskCompactChips: settings.overlayTaskCompactChips,
		overlayTaskShowPlayAction: settings.overlayTaskShowPlayAction,
		overlayTaskShowPinAction: settings.overlayTaskShowPinAction,
		overlayTaskShowNoteAction: settings.overlayTaskShowNoteAction,
		overlayTaskShowSubtaskAction: settings.overlayTaskShowSubtaskAction,
		inlineTaskShowPlayAction: settings.inlineTaskShowPlayAction,
		inlineTaskShowPinAction: settings.inlineTaskShowPinAction,
		inlineTaskShowSubtaskAction: settings.inlineTaskShowSubtaskAction,
		filterTaskShowPlayAction: settings.filterTaskShowPlayAction,
		filterTaskShowPinAction: settings.filterTaskShowPinAction,
		filterTaskShowSubtaskAction: settings.filterTaskShowSubtaskAction,
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
		inlineTaskParentInlineTargetMode: settings.inlineTaskParentInlineTargetMode,
		inlineTaskParentFileTargetMode: settings.inlineTaskParentFileTargetMode,
		inlineTaskParentFileHeadingKeyword: settings.inlineTaskParentFileHeadingKeyword,
		calendarInlineTaskHeading: settings.calendarInlineTaskHeading,
		autoParentFileTask: settings.autoParentFileTask,
		autoParentLinkedFileSubtasks: settings.autoParentLinkedFileSubtasks,
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
		estimateAutoReallocation: settings.estimateAutoReallocation,
		trackerSplitSessionsAtMidnight: settings.trackerSplitSessionsAtMidnight,
	};
}

export class OperonStorage {
	private app: App;
	private writeQueue: WriteQueue;
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
	private kanbanOrderStore: KanbanOrderStore;
	private keyMappingStore: KeyMappingStore;
	private priorityStore: PriorityStore;
	private externalCalendarSourceStore: ExternalCalendarSourceStore;
	private contextualMenuStore: ContextualMenuStore;
	private taskUiPreferenceStore: TaskUiPreferenceStore;
	private taskCreationProfileStore: TaskCreationProfileStore;
	private taskAutomationPolicyStore: TaskAutomationPolicyStore;
	private activeTrackerStore: ActiveTrackerStore;
	private legacyStorageRetired = false;
	private latestLegacyStorageCleanupStatus: OperonLegacyStorageCleanupStatus | null = null;

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
			this.storagePaths.state.pinnedTasksPath,
			this.storagePaths.legacy.pinnedCachePath,
		);
		this.repeatSeriesStore = new RepeatSeriesStore(
			app,
			this.writeQueue,
			this.storagePaths.state.repeatSeriesPath,
			this.storagePaths.legacy.repeatSeriesPath,
		);
		this.externalCalendarCache = new ExternalCalendarCacheStore(
			app,
			this.writeQueue,
			this.storagePaths.cache.externalCalendarsPath,
			this.storagePaths.legacy.externalCalendarsCachePath,
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
			this.storagePaths.legacy.activeTrackersPath,
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
			Object.assign(this.settings, settings);
			await this.saveSettings();
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
		this.legacyStorageRetired = (await this.readStorageMigrationMarker())?.legacyStorageRetired === true;
		this.applyLegacyFallbackPolicy();
		const { dataPackage } = await this.dataPackageStore.initialize(DEFAULT_SETTINGS, {
			legacyFallbackEnabled: !this.legacyStorageRetired,
		});
		this.hydrateFromDataPackage(dataPackage);
		await this.saveSettings({ forceRecoveredWrite: false });
		await this.pinnedCache.load();
		await this.activeTrackerStore.load();
		await this.repeatSeriesStore.load();
		await this.externalCalendarCache.load();
		await this.getLegacyStorageCleanupStatus();
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
		this.settings.filterSets = this.filterStore.getAll();
		const normalized = migrateSettings(this.settings);
		this.applySettingsInPlace(normalized);
		this.hydratePackageBackedSettingStores();
		if (!this.dataPackageStore.canPersist()) return;
		const dataPackage = buildOperonDataPackageFromSettings(this.settings, {
			filterSets: this.filterStore.getAll(),
			kanbanOrderBoards: this.kanbanOrderStore.toPackage().boards,
		});
		await this.dataPackageStore.replaceDataPackage(dataPackage);
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
		Object.assign(this.settings, partial);
		await this.saveSettings();
	}

	async reloadCanonicalSettingsPackage(): Promise<OperonStorageReloadSettingsResult> {
		const result = await this.dataPackageStore.reloadCanonicalDataPackage(DEFAULT_SETTINGS);
		if (result.changed) {
			this.hydrateFromDataPackage(result.dataPackage, { preserveSettingsIdentity: true });
		}
		return {
			changed: result.changed,
			diagnostics: result.diagnostics,
		};
	}

	async getLegacyStorageCleanupStatus(): Promise<OperonLegacyStorageCleanupStatus> {
		const marker = await this.readStorageMigrationMarker();
		const legacyStorageRetired = marker?.legacyStorageRetired === true;
		const legacyExists = await this.app.vault.adapter.exists(this.storagePaths.legacy.dataFolder);
		const counts = legacyExists
			? await this.countLegacyStorageEntries(this.storagePaths.legacy.dataFolder)
			: { files: 0, folders: 0 };
		const canonicalSettingsReadable = legacyExists
			? await this.dataPackageStore.canReadCanonicalDataPackage()
			: true;
		const state: OperonLegacyStorageCleanupState = legacyStorageRetired
			? 'retired'
			: !legacyExists
				? 'missing'
				: canonicalSettingsReadable
					? 'ready'
					: 'blocked';
		const blockedReason = legacyExists && !canonicalSettingsReadable
			? 'canonical-settings-unreadable'
			: null;
		const status = {
			legacyPath: this.storagePaths.legacy.dataFolder,
			markerPath: this.storagePaths.state.storageMigrationPath,
			legacyExists,
			legacyStorageRetired,
			canonicalSettingsReadable,
			canCleanup: legacyExists && canonicalSettingsReadable,
			state,
			blockedReason,
			legacyFileCount: counts.files,
			legacyFolderCount: counts.folders,
			marker,
		};
		this.latestLegacyStorageCleanupStatus = status;
		return status;
	}

	getCachedLegacyStorageCleanupStatus(): OperonLegacyStorageCleanupStatus | null {
		return this.latestLegacyStorageCleanupStatus;
	}

	async cleanupLegacyStorageFromSettings(): Promise<OperonLegacyStorageCleanupResult> {
		await this.flushPendingWrites();
		const status = await this.getLegacyStorageCleanupStatus();
		if (!status.canCleanup) {
			return {
				cleanupPerformed: false,
				cleanupMethod: null,
				status,
				marker: status.marker,
			};
		}

		const cleanupMethod = await this.trashLegacyStorageFolder();
		const marker: OperonStorageMigrationMarker = {
			version: 1,
			legacyStorageRetired: true,
			retiredAt: new Date().toISOString(),
			cleanupMethod,
			legacyFileCount: status.legacyFileCount,
			legacyFolderCount: status.legacyFolderCount,
		};
		await this.writeJson(this.storagePaths.state.storageMigrationPath, marker);
		this.legacyStorageRetired = true;
		this.applyLegacyFallbackPolicy();
		return {
			cleanupPerformed: true,
			cleanupMethod,
			status: await this.getLegacyStorageCleanupStatus(),
			marker,
		};
	}

	private applySettingsInPlace(normalized: OperonSettings): void {
		const target = this.settings as unknown as Record<string, unknown>;
		const source = normalized as unknown as Record<string, unknown>;
		for (const key of Object.keys(normalized)) {
			target[key] = source[key];
		}
	}

	private hydrateFromDataPackage(
		dataPackage: OperonDataPackageV1,
		options: { preserveSettingsIdentity?: boolean } = {},
	): void {
		this.filterStore.loadFromPackage(dataPackage.views.filters, {
			seedDynamicDefaultSorts: dataPackage.settings.settingsVersion < 88,
		});
		this.kanbanOrderStore.loadFromPackage(dataPackage.views.kanbanOrder);
		const nextSettings = this.dataPackageStore.getSettings(DEFAULT_SETTINGS);
		if (options.preserveSettingsIdentity) {
			this.applySettingsInPlace(nextSettings);
		} else {
			this.settings = nextSettings;
		}
		this.settings.filterSets = this.filterStore.getAll();
		this.hydratePackageBackedSettingStores();
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
	 * Load active task index from plugin runtime storage, with read-only legacy fallback.
	 */
	async loadIndex(): Promise<IndexData | null> {
		const adapter = this.app.vault.adapter;
		if (await adapter.exists(this.storagePaths.runtime.indexPath)) {
			return this.readJson<IndexData>(this.storagePaths.runtime.indexPath);
		}
		if (this.legacyStorageRetired) return null;
		const legacyIndex = await this.readJson<IndexData>(this.storagePaths.legacy.indexPath);
		if (legacyIndex) {
			await this.writeJson(this.storagePaths.runtime.indexPath, legacyIndex);
		}
		return legacyIndex;
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

	private async readStorageMigrationMarker(): Promise<OperonStorageMigrationMarker | null> {
		const marker = await this.readJson<Partial<OperonStorageMigrationMarker>>(this.storagePaths.state.storageMigrationPath);
		if (!marker || marker.legacyStorageRetired !== true) return null;
		if (marker.version !== 1) return null;
		if (marker.cleanupMethod !== 'trash-system' && marker.cleanupMethod !== 'trash-local') return null;
		return {
			version: 1,
			legacyStorageRetired: true,
			retiredAt: typeof marker.retiredAt === 'string' ? marker.retiredAt : '',
			cleanupMethod: marker.cleanupMethod,
			legacyFileCount: Number.isFinite(marker.legacyFileCount) ? marker.legacyFileCount ?? 0 : 0,
			legacyFolderCount: Number.isFinite(marker.legacyFolderCount) ? marker.legacyFolderCount ?? 0 : 0,
		};
	}

	private applyLegacyFallbackPolicy(): void {
		const enabled = !this.legacyStorageRetired;
		this.pinnedCache.setLegacyFallbackEnabled(enabled);
		this.activeTrackerStore.setLegacyFallbackEnabled(enabled);
		this.repeatSeriesStore.setLegacyFallbackEnabled(enabled);
		this.externalCalendarCache.setLegacyFallbackEnabled(enabled);
	}

	private async countLegacyStorageEntries(path: string): Promise<{ files: number; folders: number }> {
		try {
			const listed = await this.app.vault.adapter.list(path);
			let files = listed.files.length;
			let folders = listed.folders.length;
			for (const folder of listed.folders) {
				const nested = await this.countLegacyStorageEntries(folder);
				files += nested.files;
				folders += nested.folders;
			}
			return { files, folders };
		} catch {
			return { files: 0, folders: 0 };
		}
	}

	private async trashLegacyStorageFolder(): Promise<OperonLegacyStorageCleanupMethod> {
		const adapter = this.app.vault.adapter;
		try {
			if (await adapter.trashSystem(this.storagePaths.legacy.dataFolder)) {
				return 'trash-system';
			}
		} catch {
			// Fall back to Obsidian's local trash when system trash is unavailable.
		}
		await adapter.trashLocal(this.storagePaths.legacy.dataFolder);
		return 'trash-local';
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
	get externalCalendars(): ExternalCalendarCacheStore { return this.externalCalendarCache; }
	get externalCalendarSources(): ExternalCalendarSourceStore { return this.externalCalendarSourceStore; }
	get filters(): FilterStore { return this.filterStore; }
	get pipelines(): PipelineStore { return this.pipelineStore; }
	get calendarPresets(): CalendarPresetStore { return this.calendarPresetStore; }
	get kanbanPresets(): KanbanPresetStore { return this.kanbanPresetStore; }
	get kanbanOrder(): KanbanOrderStore { return this.kanbanOrderStore; }
	get keyMappings(): KeyMappingStore { return this.keyMappingStore; }
	get priorities(): PriorityStore { return this.priorityStore; }

	async flushPendingWrites(): Promise<void> {
		const storeDrainResults = await Promise.allSettled([
			this.dataPackageStore.drain(),
			this.pinnedCache.drain(),
			this.activeTrackerStore.drain(),
			this.repeatSeriesStore.drain(),
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
