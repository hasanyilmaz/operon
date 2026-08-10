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
import { pickTablePresetProjectionSettings } from './table-preset-manifest';
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
import {
	enginePerfNow,
	WriteJsonMetrics,
} from '../core/engine-perf';
import { writeTextSafely, type RecoveredStoreWriteOptions } from './storage-file-ops';
import {
	buildOperonDataPackageFromSettings,
	adoptMobileNotificationsIntegration,
	composeOperonSettingsFromDataPackage,
	isUnsupportedTablePresetPackage,
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
import { cloneTablePreset, type TablePreset, type TablePresetProjectionSettings } from '../types/table';
import { getAppLocale } from '../core/obsidian-app';
import {
	buildOperonSettingsBackupSelectedPatchV1,
	computeOperonSettingsBackupSelectedSettingsFingerprintV1,
	computeOperonSettingsBackupSettingsFingerprintV1,
	createOperonSettingsBackupApplyAcknowledgementV1,
	createOperonSettingsBackupApplyReceiptV1,
	projectOperonSettingsBackupApplyDataPackageV1,
	validateOperonSettingsBackupApplyAcknowledgementV1,
	type OperonSettingsBackupApplyInputV1,
	type OperonSettingsBackupApplyBlockedReasonV1,
	type OperonSettingsBackupApplyReceiptV1,
	type OperonSettingsBackupApplyResultV1,
} from '../core/settings-backup-apply';
import {
	preflightOperonSettingsBackupRestoreV1,
	type OperonSettingsBackupPreflightSummaryV1,
	type OperonSettingsBackupRestorePlanV1,
} from '../core/settings-backup-preflight';
import { sha256HexV1 } from '../agent-runtime/contracts/v1/canonical';
import { canonicalizeOperonSettingsBackupJson } from '../core/settings-backup-format';
import {
	computeOperonSettingsBackupTableResourcePlanIdV1,
	type OperonSettingsBackupTableResourceProjectionV1,
	type OperonSettingsBackupTableResourceRestorePlanV1,
} from '../core/settings-backup-table-resource-preflight';
import type {
	OperonSettingsBackupCanonicalTableWriteResultV1,
	OperonSettingsBackupInstalledTableResourceV1,
} from '../core/settings-backup-table-resource-apply';

export type IndexV8RecoveryMarkerStatus = 'missing' | 'required' | 'invalid' | 'io-error';

const MAX_INDEX_V8_RECOVERY_MARKER_BYTES = 4 * 1024;

export interface OperonStorageOptions extends Partial<OperonPluginDataAccess> {
	pluginId?: string;
}

export interface OperonStorageReloadSettingsResult {
	changed: boolean;
	diagnostics: OperonDataPackageReloadDiagnostics;
}

export interface OperonCommittedSettingsBackupSnapshot {
	settings: OperonSettings;
	dataPackageSchemaVersion: OperonDataPackageV1['schemaVersion'];
	settingsVersion: number;
	canonicalWritesSuspended: boolean;
	canonicalWriteSuspensionReason: string | null;
}

export type OperonSettingsBackupUndoResultV1 =
	| { status: 'success'; receiptId: string; blockedReason: null }
	| {
		status: 'partial-user-decision-required';
		receiptId: string;
		blockedReason: null;
		failurePhase: 'runtime-commit' | 'commit-state-unknown';
	}
	| { status: 'blocked'; receiptId: string; blockedReason: 'not-available' | 'stale-target' | 'writes-suspended' }
	| { status: 'failed'; receiptId: string; blockedReason: null };

interface OperonSettingsBackupUndoEntryV1 {
	receiptId: string;
	selectedGroups: OperonSettingsBackupApplyReceiptV1['selectedGroups'];
	previousSettings: OperonSettings;
	expectedSelectedFingerprint: string;
}

interface OperonSettingsBackupTableResourceUndoEntryV1 {
	previousSettings: OperonSettings;
	selectedGroups: OperonSettingsBackupRestorePlanV1['selectedGroups'];
	expectedCurrentFingerprint: string;
}

export interface OperonSettingsBackupTableResourceCanonicalCommitInputV1 {
	settingsPlan: OperonSettingsBackupRestorePlanV1;
	tablePlan: OperonSettingsBackupTableResourceRestorePlanV1;
	installed: readonly OperonSettingsBackupInstalledTableResourceV1[];
	appliedAt: string;
}

export type OperonSettingsBackupTableResourceCanonicalUndoResultV1 =
	| 'committed'
	| 'committed-reload-required'
	| 'failed-clean'
	| 'state-unknown';

function blockedSettingsBackupApply(
	reason: OperonSettingsBackupApplyBlockedReasonV1,
): OperonSettingsBackupApplyResultV1 {
	return { status: 'blocked', receipt: null, blockedReason: reason, failurePhase: null };
}

function failedSettingsBackupApply(
	phase: 'stage' | 'persist' | 'runtime-commit' | 'commit-state-unknown',
): OperonSettingsBackupApplyResultV1 {
	return { status: 'failed', receipt: null, blockedReason: null, failurePhase: phase };
}

function successfulSettingsBackupApply(
	receipt: OperonSettingsBackupApplyReceiptV1,
): OperonSettingsBackupApplyResultV1 {
	return {
		status: receipt.status === 'success-with-migrations' ? 'success-with-migrations' : 'success',
		receipt,
		blockedReason: null,
		failurePhase: null,
	};
}

function compareSettingsBackupRestorePlans(
	expected: OperonSettingsBackupRestorePlanV1,
	current: OperonSettingsBackupRestorePlanV1,
): OperonSettingsBackupApplyBlockedReasonV1 | null {
	if (expected.sourceBodyChecksum !== current.sourceBodyChecksum) return 'source-mismatch';
	if (sha256HexV1(canonicalizeOperonSettingsBackupJson(expected.vaultReferenceChecks))
		!== sha256HexV1(canonicalizeOperonSettingsBackupJson(current.vaultReferenceChecks))) {
		return 'vault-reference-changed';
	}
	if (expected.targetConfigurationFingerprint !== current.targetConfigurationFingerprint) return 'stale-target';
	if (expected.selectionFingerprint !== current.selectionFingerprint) return 'selection-mismatch';
	if (expected.candidateFingerprint !== current.candidateFingerprint) return 'candidate-mismatch';
	if (expected.planId !== current.planId) return 'acknowledgement-mismatch';
	return null;
}

function pickSettingsBackupApplyCounts(
	summary: OperonSettingsBackupPreflightSummaryV1 | null,
): OperonSettingsBackupApplyReceiptV1['counts'] {
	return {
		added: summary?.added ?? 0,
		removed: summary?.removed ?? 0,
		changed: summary?.changed ?? 0,
		unchanged: summary?.unchanged ?? 0,
		migrated: summary?.migrated ?? 0,
		skipped: summary?.skipped ?? 0,
		conflicts: summary?.conflicts ?? 0,
		unresolved: summary?.unresolved ?? 0,
	};
}

function isCanonicalIsoTimestamp(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
	const parsed = new Date(value);
	return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function buildSettingsBackupUndoTokenId(planId: string, appliedAt: string): string {
	return sha256HexV1(`settings-backup-undo-v1\n${planId}\n${appliedAt}`);
}

function buildSettingsBackupTableResourceUndoStateId(
	settingsPlanId: string,
	tablePlanId: string,
	appliedAt: string,
	expectedCurrentFingerprint: string,
): string {
	return sha256HexV1(canonicalizeOperonSettingsBackupJson({
		version: 1,
		settingsPlanId,
		tablePlanId,
		appliedAt,
		expectedCurrentFingerprint,
	}));
}

function computeSettingsBackupTargetConfigurationFingerprint(
	settings: OperonSettings,
	dataPackageSchemaVersion: OperonDataPackageV1['schemaVersion'],
): string {
	return sha256HexV1(canonicalizeOperonSettingsBackupJson(JSON.parse(JSON.stringify({
		settings,
		dataPackageSchemaVersion,
		settingsVersion: settings.settingsVersion,
	}))));
}

function installedTableResourcesMatchPlan(
	installed: readonly OperonSettingsBackupInstalledTableResourceV1[],
	plan: OperonSettingsBackupTableResourceRestorePlanV1,
): boolean {
	const activeActions = plan.actions.filter(action => action.kind !== 'skip');
	if (installed.length !== activeActions.length) return false;
	return activeActions.every((action, index) => {
		const item = installed[index];
		return !!item
			&& item.id === action.id
			&& item.path === action.path
			&& item.sha256 === action.sha256
			&& item.disposition === (action.kind === 'reuse' ? 'reused' : 'created');
	});
}

function tableResourceProjectionFromSettings(
	settings: OperonSettings,
): OperonSettingsBackupTableResourceProjectionV1 {
	return {
		tablePresetFileBindings: settings.tablePresetFileBindings.map(binding => ({ ...binding })),
		tablePresetOrderIds: [...settings.tablePresetOrderIds],
		tableDefaultPresetId: settings.tableDefaultPresetId,
		tablePresetFileInitialized: settings.tablePresetFileInitialized,
		tableFavoriteIds: [...settings.presetFavorites.table],
	};
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
	private unsupportedTablePresetPackage = false;
	private fieldRenameJournalStore: FieldRenameJournalStore;
	private settingsBackupUndoEntries = new Map<string, OperonSettingsBackupUndoEntryV1>();
	private settingsBackupTableResourceUndoEntries = new Map<string, OperonSettingsBackupTableResourceUndoEntryV1>();

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
	 * Narrow host-owned persistence seam for Developer API grants. The
	 * controller receives no direct adapter or plugin-data access.
	 */
	getDeveloperApiGrantDataStore(): Pick<
		OperonDataPackageStore,
		'canPersist' | 'getDataPackage' | 'updateDataPackage'
	> {
		return this.dataPackageStore;
	}

	/**
	 * Initialize storage: create plugin-config folders, load settings package, then load state/cache.
	 */
	async initialize(): Promise<void> {
		const { dataPackage, loadedExistingPinnedTasksPackage, unsupportedTablePresetPackage } = await this.dataPackageStore.initialize(
			DEFAULT_SETTINGS,
			getAppLocale(this.app),
		);
		this.unsupportedTablePresetPackage = unsupportedTablePresetPackage;
		await this.hydrateFromDataPackage(dataPackage);
		if (this.unsupportedTablePresetPackage) return;
		await this.ensureCanonicalFolders();
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

	async attachKanbanPresetFilterIfUnchanged(
		presetId: string,
		expectedFilterSetId: string | null,
		nextFilterSetId: string,
	): Promise<boolean> {
		return this.enqueueSettingsTransaction(async () => {
			const preset = this.settings.kanbanPresets.find(entry => entry.id === presetId) ?? null;
			if (!preset || preset.filterSetId !== expectedFilterSetId) return false;
			preset.filterSetId = nextFilterSetId;
			try {
				await this.persistSettings({ forceRecoveredWrite: true });
			} catch (error) {
				const currentPreset = this.settings.kanbanPresets.find(entry => entry.id === presetId) ?? null;
				if (currentPreset?.filterSetId === nextFilterSetId) {
					currentPreset.filterSetId = expectedFilterSetId;
					this.syncKanbanPresetStoreFromSettings();
				}
				throw error;
			}
			return this.settings.kanbanPresets.find(entry => entry.id === presetId)?.filterSetId === nextFilterSetId;
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
		const dataPackage = buildOperonDataPackageFromSettings(this.settings, {
			filterSets: this.filterStore.getAll(),
			kanbanOrderBoards: this.kanbanOrderStore.toPackage().boards,
			pinnedTasks: this.pinnedCache.toPackage(),
		});
		await this.dataPackageStore.updateDataPackage(currentPackage => {
			const currentMobileNotifications = currentPackage.integrations.mobileNotifications;
			const currentDeveloperApi = currentPackage.integrations.developerApi;
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
					mobileNotifications: adoptMobileNotificationsIntegration(currentMobileNotifications, {}),
					developerApi: currentDeveloperApi,
				},
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
	 * Capture a logical settings snapshot from the last successfully persisted
	 * canonical package. This read participates in both settings and package
	 * queues and intentionally does not overlay runtime Table preset contents.
	 */
	captureCommittedSettingsBackupSnapshot(): Promise<OperonCommittedSettingsBackupSnapshot> {
		return this.enqueueSettingsTransaction(async () => {
			const committed = await this.dataPackageStore.captureCommittedSettingsSnapshot(DEFAULT_SETTINGS);
			const canonicalWritesSuspended = !this.dataPackageStore.canPersist();
			return {
				settings: committed.settings,
				dataPackageSchemaVersion: committed.dataPackageSchemaVersion,
				settingsVersion: committed.settings.settingsVersion,
				canonicalWritesSuspended,
				canonicalWriteSuspensionReason: canonicalWritesSuspended
					? this.dataPackageStore.getWriteSuspensionReason() ?? 'Canonical settings writes are suspended'
					: null,
			};
		});
	}

	async applySettingsBackupRestorePlanV1(
		input: OperonSettingsBackupApplyInputV1,
	): Promise<OperonSettingsBackupApplyResultV1> {
		return this.enqueueSettingsTransaction(async () => {
			const acknowledgement = validateOperonSettingsBackupApplyAcknowledgementV1(
				input.restorePlan,
				input.acknowledgement,
			);
			if (!acknowledgement.ok) return blockedSettingsBackupApply(acknowledgement.reason);
			if (!isCanonicalIsoTimestamp(input.appliedAt)) return blockedSettingsBackupApply('invalid-applied-at');
			if (!this.dataPackageStore.canPersist()) return blockedSettingsBackupApply('writes-suspended');

			let staged: OperonDataPackageReloadStage | null = null;
			let previousSettings: OperonSettings | null = null;
			let activePlan = input.restorePlan;
			let activeSummary: OperonSettingsBackupPreflightSummaryV1 | null = null;
			let admissionResult: OperonSettingsBackupApplyResultV1 | null = null;
			let alreadyApplied = false;

			let observed: Awaited<ReturnType<OperonDataPackageStore['updateDataPackageObserved']>>;
			try {
				observed = await this.dataPackageStore.updateDataPackageObserved(currentPackage => {
				const currentSettings = composeOperonSettingsFromDataPackage(currentPackage, DEFAULT_SETTINGS);
				const fresh = preflightOperonSettingsBackupRestoreV1({
					sourceJson: input.sourceJson,
					targetSnapshot: {
						settings: currentSettings,
						dataPackageSchemaVersion: currentPackage.schemaVersion,
						settingsVersion: currentSettings.settingsVersion,
						canonicalWritesSuspended: !this.dataPackageStore.canPersist(),
						canonicalWriteSuspensionReason: this.dataPackageStore.getWriteSuspensionReason(),
					},
					selectedGroups: input.restorePlan.selectedGroups,
					vaultReferenceChecks: input.refreshedVaultReferenceChecks,
					vaultReferenceDecisions: input.restorePlan.vaultReferenceDecisions,
				});
				if (!fresh.ok) {
					admissionResult = blockedSettingsBackupApply('source-mismatch');
					return currentPackage;
				}
				if (fresh.classification !== 'ready' || !fresh.restorePlan) {
					admissionResult = blockedSettingsBackupApply(
						fresh.preview.canonicalWritesSuspended ? 'writes-suspended' : 'user-decision-required',
					);
					return currentPackage;
				}
				activeSummary = fresh.preview.summary;
				const currentSettingsFingerprint = computeOperonSettingsBackupSettingsFingerprintV1(currentSettings);
				if (fresh.restorePlan.candidateFingerprint === currentSettingsFingerprint) {
					alreadyApplied = true;
					activePlan = input.restorePlan;
					return currentPackage;
				}
				const staleReason = compareSettingsBackupRestorePlans(input.restorePlan, fresh.restorePlan);
				if (staleReason) {
					admissionResult = blockedSettingsBackupApply(staleReason);
					return currentPackage;
				}
				activePlan = fresh.restorePlan;
				previousSettings = cloneOperonSettings(currentSettings);
				const candidatePackage = projectOperonSettingsBackupApplyDataPackageV1(
					currentPackage,
					fresh.restorePlan.candidateSettings,
				);
				staged = this.stageCanonicalDataPackageReload(candidatePackage);
				return candidatePackage;
				});
			} catch {
				return failedSettingsBackupApply('stage');
			}

			if (admissionResult) return admissionResult;
			const counts = pickSettingsBackupApplyCounts(activeSummary);
			if (alreadyApplied || observed.status === 'unchanged') {
				const receipt = createOperonSettingsBackupApplyReceiptV1({
					status: counts.migrated > 0 ? 'success-with-migrations' : 'success',
					appliedAt: input.appliedAt,
					plan: activePlan,
					previousTargetFingerprint: activePlan.targetConfigurationFingerprint,
					currentTargetFingerprint: activePlan.candidateFingerprint,
					counts,
					recovery: {
						mode: 'none', undoTokenId: null, expectedCurrentFingerprint: null,
						keepAvailable: false, retryRuntimeRefreshAvailable: false, undoAvailable: false,
					},
					alreadyApplied: true,
					canonicalWrite: 'not-attempted',
					runtimeSettlement: 'settled',
				});
				return successfulSettingsBackupApply(receipt);
			}
			if (observed.status === 'failed-clean') return failedSettingsBackupApply('persist');
			if (observed.status === 'commit-state-unknown') {
				const receipt = createOperonSettingsBackupApplyReceiptV1({
					status: 'commit-state-unknown',
					appliedAt: input.appliedAt,
					plan: activePlan,
					previousTargetFingerprint: activePlan.targetConfigurationFingerprint,
					currentTargetFingerprint: null,
					counts,
					recovery: {
						mode: 'manual-backup-required', undoTokenId: null, expectedCurrentFingerprint: null,
						keepAvailable: false, retryRuntimeRefreshAvailable: false, undoAvailable: false,
					},
					canonicalWrite: 'state-unknown',
					runtimeSettlement: 'not-started',
					warnings: ['Canonical settings commit state could not be verified.'],
				});
				return {
					status: 'partial-user-decision-required',
					receipt,
					blockedReason: null,
					failurePhase: 'commit-state-unknown',
				};
			}

			let runtimeCommitFailed = false;
			const stagedRuntime = staged as OperonDataPackageReloadStage | null;
			try {
				stagedRuntime?.commit();
			} catch {
				runtimeCommitFailed = true;
				try {
					stagedRuntime?.rollback();
				} catch {
					// The canonical package is already committed. Main owns explicit reload recovery.
				}
			}
			const recoveryTokenId = runtimeCommitFailed || previousSettings
				? buildSettingsBackupUndoTokenId(activePlan.planId, input.appliedAt)
				: null;
			const receipt = createOperonSettingsBackupApplyReceiptV1({
				status: runtimeCommitFailed
					? 'runtime-degraded'
					: counts.migrated > 0 ? 'success-with-migrations' : 'success',
				appliedAt: input.appliedAt,
				plan: activePlan,
				previousTargetFingerprint: activePlan.targetConfigurationFingerprint,
				currentTargetFingerprint: activePlan.candidateFingerprint,
				counts,
				recovery: recoveryTokenId
					? {
						mode: 'session-conditional-undo',
						undoTokenId: recoveryTokenId,
					expectedCurrentFingerprint: computeOperonSettingsBackupSelectedSettingsFingerprintV1(
						activePlan.candidateSettings,
						activePlan.selectedGroups,
					),
						keepAvailable: true,
						retryRuntimeRefreshAvailable: runtimeCommitFailed,
						undoAvailable: true,
					}
					: {
						mode: 'none', undoTokenId: null, expectedCurrentFingerprint: null,
						keepAvailable: false, retryRuntimeRefreshAvailable: false, undoAvailable: false,
					},
				canonicalWrite: observed.status === 'committed-after-error' ? 'committed-after-error' : 'committed',
				runtimeSettlement: runtimeCommitFailed ? 'degraded' : 'not-started',
				warnings: observed.status === 'committed-after-error'
					? ['Canonical write acknowledgement failed, but committed data was verified.']
					: [],
			});
			if (recoveryTokenId && previousSettings) {
				this.settingsBackupUndoEntries.set(recoveryTokenId, {
					receiptId: receipt.receiptId,
					selectedGroups: receipt.selectedGroups,
					previousSettings,
					expectedSelectedFingerprint: computeOperonSettingsBackupSelectedSettingsFingerprintV1(
						activePlan.candidateSettings,
						activePlan.selectedGroups,
					),
				});
			}
			if (runtimeCommitFailed) {
				return {
					status: 'partial-user-decision-required',
					receipt,
					blockedReason: null,
					failurePhase: 'runtime-commit',
				};
			}
			return successfulSettingsBackupApply(receipt);
		});
	}

	/**
	 * Commit the one canonical package for a freshly admitted Table-resource
	 * restore. Resource files are installed and verified by the owning outer
	 * transaction before this method is called.
	 */
	async commitSettingsBackupTableResourceProjectionV1(
		input: OperonSettingsBackupTableResourceCanonicalCommitInputV1,
	): Promise<OperonSettingsBackupCanonicalTableWriteResultV1> {
		return this.enqueueSettingsTransaction(async () => {
			if (!isCanonicalIsoTimestamp(input.appliedAt) || !this.dataPackageStore.canPersist()) {
				return { state: 'failed-clean' };
			}
			const acknowledgement = validateOperonSettingsBackupApplyAcknowledgementV1(
				input.settingsPlan,
				createOperonSettingsBackupApplyAcknowledgementV1(input.settingsPlan),
			);
			const { planId: _planId, ...tablePlanMaterial } = input.tablePlan;
			if (
				!acknowledgement.ok
				|| input.tablePlan.sourceBodyChecksum !== input.settingsPlan.sourceBodyChecksum
				|| input.tablePlan.planId !== computeOperonSettingsBackupTableResourcePlanIdV1(tablePlanMaterial)
				|| !installedTableResourcesMatchPlan(input.installed, input.tablePlan)
			) {
				return { state: 'failed-clean' };
			}

			let staged: OperonDataPackageReloadStage | null = null;
			let previousSettings: OperonSettings | null = null;
			let expectedCurrentFingerprint: string | null = null;
			let stale = false;
			let observed: Awaited<ReturnType<OperonDataPackageStore['updateDataPackageObserved']>>;
			try {
				observed = await this.dataPackageStore.updateDataPackageObserved(currentPackage => {
					const currentSettings = composeOperonSettingsFromDataPackage(currentPackage, DEFAULT_SETTINGS);
					if (
						computeSettingsBackupTargetConfigurationFingerprint(currentSettings, currentPackage.schemaVersion)
						!== input.settingsPlan.targetConfigurationFingerprint
					) {
						stale = true;
						return currentPackage;
					}
					previousSettings = cloneOperonSettings(currentSettings);
					const candidatePackage = projectOperonSettingsBackupApplyDataPackageV1(
						currentPackage,
						input.settingsPlan.candidateSettings,
						{ tableResourceProjection: input.tablePlan.projection },
					);
					expectedCurrentFingerprint = computeOperonSettingsBackupSettingsFingerprintV1(
						composeOperonSettingsFromDataPackage(candidatePackage, DEFAULT_SETTINGS),
					);
					staged = this.stageCanonicalDataPackageReload(candidatePackage);
					return candidatePackage;
				});
			} catch {
				return { state: 'failed-clean' };
			}
			if (stale || !previousSettings || !expectedCurrentFingerprint) return { state: 'failed-clean' };
			if (observed.status === 'failed-clean') return { state: 'failed-clean' };
			if (observed.status === 'commit-state-unknown') return { state: 'state-unknown' };

			const stagedRuntime = staged as OperonDataPackageReloadStage | null;
			let needsCanonicalReload = false;
			try {
				stagedRuntime?.commit();
			} catch {
				needsCanonicalReload = true;
				try {
					stagedRuntime?.rollback();
				} catch {
					// Canonical state is committed; the outer coordinator owns runtime settlement.
				}
			}
			const canonicalUndoStateId = buildSettingsBackupTableResourceUndoStateId(
				input.settingsPlan.planId,
				input.tablePlan.planId,
				input.appliedAt,
				expectedCurrentFingerprint,
			);
			this.settingsBackupTableResourceUndoEntries.set(canonicalUndoStateId, {
				previousSettings,
				selectedGroups: [...input.settingsPlan.selectedGroups],
				expectedCurrentFingerprint,
			});
			return {
				state: observed.status === 'committed-after-error' ? 'committed-after-error' : 'committed',
				currentFingerprint: expectedCurrentFingerprint,
				canonicalUndoStateId,
				needsCanonicalReload,
			};
		});
	}

	discardSettingsBackupTableResourceUndoStateV1(canonicalUndoStateId: string): boolean {
		return this.settingsBackupTableResourceUndoEntries.delete(canonicalUndoStateId);
	}

	async undoSettingsBackupTableResourceProjectionV1(input: {
		canonicalUndoStateId: string;
		expectedCurrentFingerprint: string;
	}): Promise<OperonSettingsBackupTableResourceCanonicalUndoResultV1> {
		return this.enqueueSettingsTransaction(async () => {
			const entry = this.settingsBackupTableResourceUndoEntries.get(input.canonicalUndoStateId);
			if (
				!entry
				|| input.expectedCurrentFingerprint !== entry.expectedCurrentFingerprint
				|| !this.dataPackageStore.canPersist()
			) return 'failed-clean';

			let staged: OperonDataPackageReloadStage | null = null;
			let stale = false;
			let observed: Awaited<ReturnType<OperonDataPackageStore['updateDataPackageObserved']>>;
			try {
				observed = await this.dataPackageStore.updateDataPackageObserved(currentPackage => {
					const currentSettings = composeOperonSettingsFromDataPackage(currentPackage, DEFAULT_SETTINGS);
					if (
						computeOperonSettingsBackupSettingsFingerprintV1(currentSettings)
						!== entry.expectedCurrentFingerprint
					) {
						stale = true;
						return currentPackage;
					}
					const previousPatch = buildOperonSettingsBackupSelectedPatchV1({
						selectedGroups: entry.selectedGroups,
						candidateSettings: entry.previousSettings,
					});
					const candidateSettings = migrateSettings({ ...currentSettings, ...previousPatch });
					const candidatePackage = projectOperonSettingsBackupApplyDataPackageV1(
						currentPackage,
						candidateSettings,
						{ tableResourceProjection: tableResourceProjectionFromSettings(entry.previousSettings) },
					);
					staged = this.stageCanonicalDataPackageReload(candidatePackage);
					return candidatePackage;
				});
			} catch {
				return 'failed-clean';
			}
			if (stale || observed.status === 'failed-clean') return 'failed-clean';
			if (observed.status === 'commit-state-unknown') {
				this.settingsBackupTableResourceUndoEntries.delete(input.canonicalUndoStateId);
				return 'state-unknown';
			}
			const stagedRuntime = staged as OperonDataPackageReloadStage | null;
			let needsCanonicalReload = false;
			try {
				stagedRuntime?.commit();
			} catch {
				needsCanonicalReload = true;
				try {
					stagedRuntime?.rollback();
				} catch {
					// Canonical undo is committed; the outer coordinator owns runtime settlement.
				}
			}
			this.settingsBackupTableResourceUndoEntries.delete(input.canonicalUndoStateId);
			return needsCanonicalReload ? 'committed-reload-required' : 'committed';
		});
	}

	discardSettingsBackupUndo(undoTokenId: string, expectedReceiptId: string): boolean {
		const entry = this.settingsBackupUndoEntries.get(undoTokenId);
		if (!entry || entry.receiptId !== expectedReceiptId) return false;
		return this.settingsBackupUndoEntries.delete(undoTokenId);
	}

	updateSettingsBackupUndoReceiptId(undoTokenId: string, expectedReceiptId: string, receiptId: string): void {
		const entry = this.settingsBackupUndoEntries.get(undoTokenId);
		if (entry?.receiptId === expectedReceiptId) entry.receiptId = receiptId;
	}

	async undoSettingsBackupRestoreV1(
		undoTokenId: string,
		expectedReceiptId: string,
	): Promise<OperonSettingsBackupUndoResultV1> {
		return this.enqueueSettingsTransaction(async () => {
			const entry = this.settingsBackupUndoEntries.get(undoTokenId);
			if (!entry) return { status: 'blocked', receiptId: undoTokenId, blockedReason: 'not-available' };
			const { receiptId } = entry;
			if (receiptId !== expectedReceiptId) {
				return { status: 'blocked', receiptId: expectedReceiptId, blockedReason: 'not-available' };
			}
			if (!this.dataPackageStore.canPersist()) {
				return { status: 'blocked', receiptId, blockedReason: 'writes-suspended' };
			}
			let staged: OperonDataPackageReloadStage | null = null;
			let stale = false;
			let observed: Awaited<ReturnType<OperonDataPackageStore['updateDataPackageObserved']>>;
			try {
				observed = await this.dataPackageStore.updateDataPackageObserved(currentPackage => {
				const currentSettings = composeOperonSettingsFromDataPackage(currentPackage, DEFAULT_SETTINGS);
				const currentSelectedFingerprint = computeOperonSettingsBackupSelectedSettingsFingerprintV1(
					currentSettings,
					entry.selectedGroups,
				);
				if (currentSelectedFingerprint !== entry.expectedSelectedFingerprint) {
					stale = true;
					return currentPackage;
				}
				const previousPatch = buildOperonSettingsBackupSelectedPatchV1({
					selectedGroups: entry.selectedGroups,
					candidateSettings: entry.previousSettings,
				});
				const candidateSettings = migrateSettings({ ...currentSettings, ...previousPatch });
				const candidatePackage = projectOperonSettingsBackupApplyDataPackageV1(currentPackage, candidateSettings);
				staged = this.stageCanonicalDataPackageReload(candidatePackage);
				return candidatePackage;
				});
			} catch {
				return { status: 'failed', receiptId, blockedReason: null };
			}
			if (stale) return { status: 'blocked', receiptId, blockedReason: 'stale-target' };
			if (observed.status === 'failed-clean') {
				return { status: 'failed', receiptId, blockedReason: null };
			}
			if (observed.status === 'commit-state-unknown') {
				this.settingsBackupUndoEntries.delete(undoTokenId);
				return {
					status: 'partial-user-decision-required',
					receiptId,
					blockedReason: null,
					failurePhase: 'commit-state-unknown',
				};
			}
			const stagedRuntime = staged as OperonDataPackageReloadStage | null;
			try {
				stagedRuntime?.commit();
			} catch {
				try {
					stagedRuntime?.rollback();
				} catch {
					// Leave the recovery token available for an explicit retry or manual recovery.
				}
				this.settingsBackupUndoEntries.delete(undoTokenId);
				return {
					status: 'partial-user-decision-required',
					receiptId,
					blockedReason: null,
					failurePhase: 'runtime-commit',
				};
			}
			this.settingsBackupUndoEntries.delete(undoTokenId);
			return { status: 'success', receiptId, blockedReason: null };
		});
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
				stage: async dataPackage => this.stageCanonicalDataPackageReload(dataPackage),
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
		const packageTableManifest = pickTablePresetProjectionSettings(committed);
		this.applyTablePresetManifest(committed, packageTableManifest, this.settings.tablePresets);
		return committed;
	}

	private applyTablePresetManifest(
		target: OperonSettings,
		manifest: TablePresetProjectionSettings,
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
		target.tablePresetFileInitialized = manifest.tablePresetFileInitialized;
		target.tableDefaultPresetId = manifest.tableDefaultPresetId;
		target.tableEmbedVisibleRows = manifest.tableEmbedVisibleRows;
		target.tableShowLineNumbers = manifest.tableShowLineNumbers;
		target.tableShowTaskIcon = manifest.tableShowTaskIcon;
		target.tableShowTaskTypeIcon = manifest.tableShowTaskTypeIcon;
	}

	private stageCanonicalDataPackageReload(
		dataPackage: OperonDataPackageV1,
	): OperonDataPackageReloadStage {
		if (isUnsupportedTablePresetPackage(dataPackage)) {
			throw new Error('Unsupported Table preset package.');
		}
		const nextSettings = composeOperonSettingsFromDataPackage(dataPackage, DEFAULT_SETTINGS);
		const packageTableManifest = pickTablePresetProjectionSettings(nextSettings);
		const stagedFilterStore = new FilterStore(this.app, this.writeQueue);
		stagedFilterStore.loadFromPackage(dataPackage.views.filters, {
			seedDynamicDefaultSorts: dataPackage.settings.settingsVersion < 88,
		});
		nextSettings.filterSets = stagedFilterStore.getAll();
		this.applyTablePresetManifest(nextSettings, packageTableManifest, this.settings.tablePresets);
		if (!dataPackage.ui.presetFavorites) {
			nextSettings.presetFavorites = createDefaultPresetFavorites({
				table: nextSettings.tableDefaultPresetId,
				calendar: nextSettings.calendarDefaultPresetId,
				kanban: nextSettings.kanbanDefaultPresetId,
			});
		}

		const previousSettings = cloneOperonSettings(this.settings);
		const previousDataPackage = this.dataPackageStore.getDataPackage();
		const previousTableSnapshot = pickTablePresetProjectionSettings(previousSettings);
		const nextTableSnapshot = pickTablePresetProjectionSettings(nextSettings);
		const tableProjectionChanged = JSON.stringify(previousTableSnapshot)
			!== JSON.stringify(nextTableSnapshot);
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
			changed: tableProjectionChanged,
			commit: () => {
				commitStarted = true;
				applyRuntimePackage(dataPackage, nextSettings);
			},
			rollback: () => {
				if (!commitStarted) return;
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
		const previousTableSnapshot = pickTablePresetProjectionSettings(this.settings);
		const packageTableManifest = pickTablePresetProjectionSettings(nextSettings);
		this.applyTablePresetManifest(nextSettings, packageTableManifest);
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
		return JSON.stringify(previousTableSnapshot)
			!== JSON.stringify(pickTablePresetProjectionSettings(nextSettings));
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
	hasUnsupportedTablePresetPackage(): boolean { return this.unsupportedTablePresetPackage; }
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
