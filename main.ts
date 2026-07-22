/**
 * Operon is a task management system for humans and agents in Obsidian, built around inline tasks,
 * file tasks, reusable filters, customizable pipelines, pinned task workflows, unique calendar and
 * Kanban views, recurrence, and time tracking.
 *
 * Plugin entry point. Manages lifecycle, commands, and module initialization.
 */

import { Editor, EditorPosition, EditorSelection, MarkdownRenderer, MarkdownRenderChild, MarkdownSectionInformation, MarkdownView, MarkdownPostProcessorContext, Menu, MenuItem, Notice, Platform, Plugin, TFile, TAbstractFile, TFolder, WorkspaceLeaf, editorLivePreviewField, normalizePath, requestUrl, requireApiVersion, setIcon } from 'obsidian';
import { EditorView } from '@codemirror/view';
import type { StateEffect } from '@codemirror/state';
import { OperonStorage } from './src/storage/operon-storage';
import { TablePresetRegistry } from './src/storage/table-preset-registry';
import type { TablePresetRegistryEntry, TablePresetRegistryPatchControl } from './src/types/table-preset-registry';
import { TablePresetFileLifecycle } from './src/storage/table-preset-file-lifecycle';
import type {
	TablePresetFileConflictResolutionResult,
	TablePresetFileMigrationReceiptV1,
} from './src/types/table-preset-file-lifecycle';
import {
	runTablePresetFileMigration,
	summarizeTablePresetFileMigrationJournal,
	type TablePresetFileMigrationSummary,
} from './src/storage/table-preset-file-migration-runner';
import {
	buildUniqueOperonTableFilePath,
	deriveOperonTableNameFromPath,
	getOperonTableFilePathKey,
	isOperonTableFilePath,
	parseOperonTableFile,
	serializeOperonTableFile,
} from './src/storage/table-file';
import { OperonIndexer, type IndexedTaskDelta } from './src/indexer/indexer';
import {
	IndexV8DiagnosticsModal,
	type IndexV8DiagnosticsActionResult,
	type IndexV8DiagnosticsSummary,
} from './src/ui/index-v8-diagnostics-modal';
import { IndexV8Store } from './src/indexer/persistence/index-v8-store';
import { IndexV8PersistenceCoordinator } from './src/indexer/persistence/index-v8-shadow-writer';
import {
	startIndexV8CleanupMaintenance,
	type IndexV8MaintenanceHandle,
} from './src/indexer/persistence/index-v8-maintenance-scheduler';
import type { ProjectSerialDisplay } from './src/core/project-serials';
import { scanFileWithMappings } from './src/indexer/file-scanner';
import { TaskWriter } from './src/core/task-writer';
import {
	isSupportedRawYamlPropertyValue,
	isWritableRawYamlPropertyName,
	readRawYamlPropertyExpectation,
	type RawYamlPropertyExpectation,
	type RawYamlPropertyMutation,
	type RawYamlPropertyWriteOutcome,
} from './src/core/raw-yaml-property';
import { registerObsidianIconFallbacks } from './src/core/obsidian-icon-fallbacks';
import { invalidateLocationPlaceIndex } from './src/core/location-source-resolver';
import { DependencyManager } from './src/systems/dependency-manager';
import {
	ActiveDependencyBlocker,
	DependencyEdgeValidationResult,
	DependencyFieldMutation,
	DependencyStatusChangeAttempt,
	resolveActiveBlockers,
	resolveDependencyStatusChangeAttempt,
} from './src/core/dependency-graph';
import { AggregateCoordinator, type AggregateRefreshResult } from './src/systems/aggregate-coordinator';
import { TaskStatsBackfillRunner } from './src/systems/task-stats-backfill';
import { TimeTracker } from './src/systems/time-tracker';
import { applyManualEstimateReallocationWrites } from './src/systems/estimate-reallocation';
import type { TrackerSession, TrackerSource, TrackerStopReason } from './src/types/tracker';
import { RecurrenceMaterializationResult, RecurrenceService } from './src/systems/recurrence-service';
import {
	canMoveOccurrenceDate,
	deriveTemporalTemplateFromTask,
	getSeriesMaterializedTasks as getSeriesMaterializedTasksFromTasks,
	getTaskRepeatOccurrenceDate,
	isLatestMaterializedRecurringTask as isLatestMaterializedRecurringTaskFromTasks,
	resolveMoveWindow,
	resolveOccurrencePlan,
	shiftDateKey,
} from './src/systems/recurrence-domain';
import {
	buildFollowingOverride,
	buildRepeatTemporalSnapshotFromFieldValues,
	buildRepeatTemporalSnapshotFromSelection,
	buildSingleOccurrenceOverride,
	hasRepeatTemporalChange,
	reanchorRepeatTemporalSnapshotToScheduledDate,
	resolveAuthoritativeRepeatOccurrenceDate,
	RepeatEditScopeChoice,
	RepeatTemporalSnapshot,
} from './src/systems/recurrence-edit-scope';
import {
	buildRecurrenceIdentityRepairPlan,
	type RecurrenceIdentityRepairCandidate,
} from './src/systems/recurrence-identity-repair';
import { TaskEditorModal } from './src/ui/task-editor-modal';
import {
	TaskCreatorDraft,
	TaskCreatorModal,
	TaskCreatorSubmitMode,
	buildSubtaskTaskCreatorDraft,
	buildTaskCreatorSubmitFieldSeed,
	cloneTaskCreatorDraft,
	createEmptyTaskCreatorDraft,
	isTaskCreatorFieldExplicitlyCleared,
	type TaskCreatorCreateType,
} from './src/ui/task-creator-modal';
import {
	OPERON_PUBLIC_API_VERSION,
	buildOperonPublicFilterEvaluationOptions,
	isOperonPublicAdoptInlineTaskInput,
	isOperonPublicConvertTaskInput,
	isOperonPublicCreateTaskInput,
	isOperonPublicFilterQueryInput,
	isOperonPublicRelocateTaskInput,
	isOperonPublicTransitionTaskInput,
	isOperonPublicUpdateTaskInput,
	isPublicManagedFieldWritable,
	type OperonPublicApiV1,
	type OperonPublicAdoptInlineTaskInput,
	type OperonPublicConvertTaskInput,
	type OperonPublicCreateTaskInput,
	type OperonPublicFilterQueryInput,
	type OperonPublicFilterQueryResult,
	type OperonPublicMutationResult,
	type OperonPublicRelocateTaskInput,
	type OperonPublicTransitionTaskInput,
	type OperonPublicUpdateTaskInput,
} from './src/api/public-api';
import {
	applyTaskCreatorParentSeedToDraft,
	buildCalendarTaskCreatorDraft,
	buildKanbanTaskCreatorDraft,
	type QuickInlineTaskCreationResult,
	type TaskCreatorParentSeed,
} from './src/ui/task-creator-integrations';
import {
	OnSaveCallback,
	TaskEditorContentOptions,
	TaskEditorEstimateReallocationApplyResult,
	TaskEditorEstimateReallocationRequest,
	TaskEditorFileBodyContext,
	TaskEditorRepeatSkipUpdateRequest,
	TaskEditorRepeatSkipUpdateResult,
	TaskEditorSaveRequest,
	TaskEditorSubtaskRequest,
} from './src/ui/task-editor-content';
import {
	getEmbeddedMarkdownSourceEditorFilePath,
	refreshEmbeddedMarkdownSourceEditors,
} from './src/ui/embedded-markdown-source-editor';
import {
	openMoveInlineTaskHereFinder,
	openTaskFinder,
	promptTaskFinderSelection,
	TASK_FINDER_SCOPE_CALENDAR_SCHEDULE,
	TASK_FINDER_SCOPE_CALENDAR_TRACKED_SESSION,
	TASK_FINDER_SCOPE_CONVERT_FILE_TASK_TO_INLINE,
	TASK_FINDER_SCOPE_KANBAN_PLACE,
	TASK_FINDER_SCOPE_TASK_WIKILINK_OVERLAY,
} from './src/ui/task-finder-integrations';
import {
	buildTaskWikilinkOverlayLink,
	insertTaskWikilinkOverlayLink,
} from './src/ui/task-wikilink-overlay-insertion';
import {
	rewriteTaskWikilinkOverlayLinksInContent,
	type TaskWikilinkOverlayRewriteReplacement,
	type TaskWikilinkOverlayRewriteResult,
	type TaskWikilinkOverlayRewriteTarget,
} from './src/ui/task-wikilink-overlay-link-maintenance';
import {
	operonLivePreviewConcealExtension,
	operonIndexRefreshEffect,
	operonEditorCloseRefreshEffect,
	type LivePreviewCursorRestoreRequest,
} from './src/ui/live-preview-conceal';
import { operonLivePreviewClassicTaskConvertExtension } from './src/ui/live-preview-classic-task-convert';
import { operonLivePreviewTaskWikilinkOverlayExtension, operonTaskWikilinkForceRevealEffect } from './src/ui/live-preview-task-wikilink-overlay';
import { operonLivePreviewKeySuggestExtension } from './src/ui/live-preview-key-suggest';
import { debugTaskFieldSuggestion } from './src/ui/task-field-suggest';
import { buildReadingTaskRowElement } from './src/ui/reading-task-row';
import {
	createIndexedReadingResolvedTask,
	resolveReadingInlineTaskFromText,
	resolveReadingSectionInlineTasks,
	type ReadingResolvedTask,
	type ReadingSectionInlineTaskResolution,
} from './src/ui/reading-task-operon-id';
import { enhanceReadingTaskFileWikilinks } from './src/ui/reading-task-wikilink-overlay';
import { MobileGlobalTaskFab } from './src/ui/mobile-global-task-fab';
import {
	OPERON_COMPACT_CHIP_HOVER_SOURCE,
	OPERON_TASK_DESCRIPTION_WIKILINK_HOVER_SOURCE,
	OPERON_TASK_TITLE_HOVER_SOURCE,
} from './src/ui/compact-chip-link-preview';
import { cleanupOperonRenderRoot } from './src/ui/render-root-cleanup';
import { hideTaskContextualHoverMenu } from './src/ui/contextual-hover-menu';
import {
	WindowTimeoutHandle,
	asHTMLElement,
	clearWindowTimeout,
	delayWithActiveWindow,
	getActiveDocument,
	getActiveWindow,
	getOwnerWindow,
	setWindowTimeout,
} from './src/core/dom-compat';
import { CoalescedAsyncScheduler } from './src/core/coalesced-async-scheduler';
import { ReminderScheduler } from './src/core/reminder-scheduler';
import { getAvailableReminderRuleAnchors } from './src/core/reminder-rules';
import { ReminderDeliveryController } from './src/systems/reminder-delivery';
import {
	MobileNotificationsExporter,
	readExistingMobileNotificationsProducerState,
} from './src/systems/mobile-notifications-exporter';
import { buildOperonPluginStoragePath } from './src/storage/operon-storage-paths';
import { resolveTaskColorSourceForTask } from './src/core/task-color-source';
import { asyncHandler, runAsyncAction } from './src/core/async-action';
import { getCommunityPlugin, isDailyNotesCoreAvailable } from './src/core/obsidian-app';
import { InlineTaskSaveMode, resolveEffectiveInlineTaskSaveMode } from './src/core/inline-task-save-mode';
import { isRecord, isUnknownFunction, readString } from './src/core/unknown-value';
import {
	buildTaskCreationNotices,
	formatTaskNotice,
	formatTaskNoticeCount,
	type TaskNoticeCreationInput,
	type TaskNoticeKind,
	type TaskNoticeNameParts,
} from './src/core/task-notice';
import {
	EphemeralFieldSession,
	EphemeralFieldSessionCancelReason,
	LivePreviewEphemeralSessionController,
	shouldAbandonLivePreviewSessionForWorkspaceFile,
} from './src/ui/live-preview-ephemeral-session';
import { invalidateCustomFieldValueCandidateCache } from './src/ui/custom-field-surfaces';
import { openTaskFieldPicker } from './src/ui/task-field-picker-dispatch';
import {
	moveOperonDocsFolder,
	previewOperonDocsFolderMove,
	syncOperonDocs,
	type OperonDocsFolderMovePreview,
	type OperonDocsSyncResult,
} from './src/systems/operon-docs-sync';
import { showPlainCheckboxPopover } from './src/ui/plain-checkbox-popover';
import {
	collectScopedPlainCheckboxMoveLines,
	removePlainCheckboxMoveLinesFromContent,
	type PlainCheckboxMoveLine,
} from './src/core/plain-checkbox-lines';
import type { ManualDatePickerOptions } from './src/ui/field-pickers/date-picker';
import { applyFileTaskPropertyVisibility } from './src/ui/file-task-property-visibility';
import { PinnedTasksDock } from './src/ui/pinned-tasks-dock';
import { PinnedTasksSidebarView, PINNED_TASKS_SIDEBAR_VIEW_TYPE } from './src/ui/pinned-tasks-sidebar-view';
import { PinnedCache } from './src/storage/pinned-cache';
import { FilterView, FILTER_VIEW_TYPE } from './src/ui/filter-view';
import {
	createFilterSurfaceInstance,
	destroyFilterSurfaceInstance,
	registerEmbedFilterProcessor,
	refreshEmbedFilters,
	EmbedFilterDeps,
	FilterSurfaceInstance,
} from './src/ui/embed-filter-processor';
import {
	registerEmbedTableProcessor,
	refreshEmbedTables,
	type EmbedTableDeps,
} from './src/ui/embed-table-processor';
import {
	clearTableFilePropertyIndex,
	createCachedTableFilePropertyTypeResolver,
	getTableFilePropertyIndex,
	loadTableFilePropertyTypesFromConfig,
	type TableFilePropertyIndex,
} from './src/ui/table/table-file-property';
import {
	resolveTableParentSearchVisibleTaskIds,
	resolveTableSearchScopedTasks,
} from './src/ui/table/table-search-scope';
import {
	applyDynamicFileTaskFilterHostPlacement,
	DYNAMIC_FILE_TASK_FILTER_HOST_CLASS,
	operonDynamicFileTaskFilterLivePreviewExtension,
	renderDynamicFileTaskFilterSurface,
} from './src/ui/dynamic-file-task-filter';
import { SubtasksFilterModal } from './src/ui/subtasks-filter-modal';
import { FilterSetModal, refreshFilterPreviewModals, refreshFilterSetModals, type FilterModalEvalDeps } from './src/ui/filter-set-modal';
import { OperonReleaseNotesModal } from './src/ui/release-notes-modal';
import { OperonSettingsTab, type TablePresetSettingsFileIntegration } from './src/ui/settings-tab';
import { TimeSessionHistoryView, TIME_SESSION_HISTORY_VIEW_TYPE } from './src/ui/time-session-history-view';
import { FlowTimeView, FLOW_TIME_VIEW_TYPE } from './src/ui/flow-time-view';
import { TimeTrackerStatusBar } from './src/ui/time-tracker-status-bar';
import { FormatConverter } from './src/systems/format-converter';
import { FileTaskArchiver } from './src/systems/file-task-archiver';
import { ExternalCalendarService } from './src/systems/external-calendar-service';
import { buildExternalCalendarItems } from './src/systems/external-calendar-query';
import { formatDurationHuman, parseLocalDatetime } from './src/systems/tracker-utils';
import { hasOperonFields, isTaskLineCandidate, parseListValue, parseTaskLine, resolveInlineTaskDescriptionCursorCh } from './src/core/parser';
import { buildSubtaskExcludedIds } from './src/core/task-hierarchy';
import { serializeTask } from './src/core/serializer';
import { applyFieldRules } from './src/core/field-rules';
import { normalizeTaskFieldPatch, type DependencyFieldKey } from './src/core/task-field-patch';
import { convertTasksEmojiLineToOperon } from './src/core/tasks-emoji-to-operon';
import { applyTasksEmojiConversionToParsedTask } from './src/core/tasks-emoji-application';
import {
	extractMarkdownCheckboxListItem,
	extractMarkdownListItemDescription,
	measureMarkdownIndent,
	normalizeMarkdownCheckboxMarker,
} from './src/core/markdown-list-items';
import { generateOperonId, generateRepeatSeriesId, setExistingIdsProvider } from './src/core/id-generator';
import { resolveDefaultFileTaskStatus, resolveFileTaskDefaults } from './src/core/file-task-defaults';
import {
	resolveOperonIdPlaceholders,
	resolveOperonIdPlaceholdersInTaskBlock,
	resolveOperonTemplatePlaceholders,
	type OperonTemplatePlaceholderContext,
	type RawOperonTaskLinePlaceholderContext,
} from './src/core/operon-id-placeholders';
import {
	getNormalFilterSets,
	isDynamicFileTaskFilterSet,
	isDynamicSubtasksFilterSet,
	isSpecialDynamicFilterSet,
	normalizeDynamicFileTaskFilterSet,
	normalizeDynamicSubtasksFilterSet,
} from './src/core/dynamic-file-task-filter';
import { evaluateFilterSet } from './src/core/filter-evaluator';
import { getReleaseNotesForUpdate } from './src/core/release-notes';
import {
	getAvailableOperonReleaseVersion,
	OPERON_COMMUNITY_PLUGIN_URL,
	shouldNotifyForOperonRelease,
} from './src/systems/release-check';
import { isOperonExcludedPath } from './src/core/operon-path-exclusions';
import { hasNonEmptyManagedYamlValue } from './src/core/yaml-fields';
import { normalizeRepeatIdentityPayload } from './src/core/repeat-identity';
import { shouldAutoUnpinTerminalTask } from './src/core/pinned-task-rules';
import { OPERON_DEMO_AGGREGATE_PARENT_IDS, createOrRepairBasicsWorkspace, hasBasicsWorkspaceArtifact } from './src/core/demo-project';
import {
	formatDailyNoteTitleFromDateKey,
	resolveDailyNotePathFromDateKey,
} from './src/core/daily-note-path';
import { loadDailyNotesCoreConfig } from './src/core/daily-notes-core-config';
import { buildDailyNoteInlineTaskDefaultWritePlans } from './src/core/daily-note-inline-task-defaults';
import { resolveDailyNoteParentRealignmentTargetDate } from './src/core/daily-note-parent-realignment';
import { resolveCoreTemplateVariables } from './src/core/core-template-variables';
import { loadTemplatesCoreConfig } from './src/core/templates-core-config';
import {
	calculateRepeatEndFromCount,
	parseRepeatRule,
} from './src/core/repeat-rule';
import type { RepeatRule } from './src/core/repeat-rule';
import { isManagedYamlCanonicalKey, normalizeLegacyCreatedDatetime } from './src/core/yaml-fields';
import {
	buildMergedFileTaskDraft,
	MergedFileTaskDraft,
	parseFrontmatterDocument,
	ParsedFrontmatterDocument,
	splitFrontmatterDocument,
} from './src/core/file-task-template-merge';
import {
	buildFileTaskTemplateOptions,
	buildPipelineMinimalFileTaskTemplateOptions,
	FileTaskTemplateOption,
	findFileTaskTemplateOptionById,
	orderFileTaskTemplateOptionsByLastUsed,
	resolvePipelineMinimalFileTaskTemplateStatus,
	templateDocumentContainsTemplaterSyntax,
} from './src/core/file-task-templates';
import { localNow, localToday } from './src/core/local-time';
import { formatUiTime } from './src/core/ui-time-format';
import {
	commitContextualReminderValue,
	executeContextualMenuAction,
	type ContextualMenuActionId,
	type ContextualMenuActionInvocation,
	type ContextualMenuContext,
} from './src/core/contextual-menu-engine';
import {
	getSubtaskInitialFieldKeys,
	resolveSubtaskInitialFields,
	resolveSubtaskInitialFieldsFromParentValues,
	SubtaskInitialFields,
} from './src/core/subtask-inheritance';
import { dispatchSubtaskActionByParentKind, resolveSubtaskActionKind } from './src/core/subtask-action';
import {
	applyLinkedFileTaskAutoParentSeed,
	resolveFileTaskAutoParentOperonId,
} from './src/core/file-task-auto-parent';
import {
	createGlobalMarkdownRefreshScope,
	createScopedMarkdownRefreshScope,
	MarkdownRefreshScope,
	mergeMarkdownRefreshScopes,
	resolveStatusMarkdownRefreshScope,
} from './src/core/markdown-refresh-scope';
import { insertInlineTaskUnderFirstHeadingKeyword } from './src/core/markdown-heading-insertion';
import {
	resolveIndexedTaskSourceFolderPath,
	resolveInlineParentInsertionLineNumber,
	resolveTaskCreatorFileTargetFolderOverride as resolveTaskCreatorFileTargetFolderOverrideDecision,
	resolveTaskCreatorInlinePlacement,
} from './src/core/task-creator-target-resolver';
import {
	cloneFilterSet,
	CURRENT_TASK_STATS_BACKFILL_VERSION,
	DEFAULT_INLINE_TASK_TARGET_FILE,
	DUPLICATE_ALERT_DELAY_SECONDS_OPTIONS,
	FilterSet,
	normalizeInlineTaskHeadingKeyword,
	normalizeStoredFileTaskTemplateId,
	OperonSettings,
} from './src/types/settings';
import {
	type InlineRepeatCompletionMode,
	normalizeInlineCompletionMode,
} from './src/storage/repeat-series-store';
import {
	CalendarItem,
	CalendarLeafState,
	CalendarPreset,
	CalendarSlotSelection,
	ExternalCalendarTaskSeed,
	cloneDefaultCalendarPresets,
	createCalendarPresetId,
	normalizeCalendarSidebarTaskPoolMode,
} from './src/types/calendar';
import {
	KanbanDropContext,
	KanbanCellActionContext,
	KanbanCellActionId,
	KanbanLeafState,
	KanbanPreset,
	buildKanbanLaneCollapseScopeKey,
	buildKanbanStatusCollapseScopeKey,
	cloneDefaultKanbanPresets,
	createKanbanPresetId,
	normalizeKanbanLeafState,
} from './src/types/kanban';
import { DuplicateRegistrySnapshot, IndexedTask, IndexedTaskInstance, OperonField, ParsedTask } from './src/types/fields';
import { CANONICAL_KEY_MAP } from './src/types/keys';
import {
	clonePipeline,
	composeStatusValue,
	getCheckboxToggleWorkflowStatus,
	getNextWorkflowStatus,
	resolveAutomationWorkflowStatus,
	resolveReverseWorkflowFromTerminalDate,
	resolveWorkflowStatus,
	shouldTriggerOneShotAutomation,
	type WorkflowStatusResolution,
} from './src/types/pipeline';
import { DEFAULT_PRIORITIES } from './src/types/priority';
import {
	activateI18nLocale,
	initI18n,
	installI18nLocale,
	resetI18nToEnglish,
	t,
} from './src/core/i18n';
import { LocalePackManager } from './src/core/locale-pack-manager';
import {
	buildLocalePackReconcileOrder,
	hasLocalePackIntentChanged,
	shouldActivateReconciledLocale,
} from './src/core/locale-pack-orchestration';
import { buildWorkflowStatusSemanticsSignature } from './src/core/workflow-status-semantics';
import {
	buildWorkflowStatusIdentityIndex,
	resolveConfiguredPipelineNameIdentity,
	resolveConfiguredStatusIdentity,
} from './src/core/workflow-status-identity';
import { ConfirmActionModal } from './src/ui/confirm-action-modal';
import { FileTaskTemplatePickerModal } from './src/ui/file-task-template-picker-modal';
import { InlineTaskTargetFilePickerModal } from './src/ui/inline-task-target-file-picker-modal';
import { FieldRenameProgressModal } from './src/ui/field-rename-progress-modal';
import { DuplicateOperonIdModal } from './src/ui/duplicate-operonid-modal';
import { BlockedTaskModal } from './src/ui/blocked-task-modal';
import {
	PipelineRenameProgressSnapshot,
	PipelineRenamePreview,
} from './src/core/pipeline-rename-migration';
import type {
	PrepareWorkflowFieldRenameInput,
	WorkflowFieldRenameRunResult,
} from './src/systems/workflow-field-rename-coordinator';
import {
	WorkflowFieldRenameCoordinator,
	workflowTaxonomySnapshotsEqual,
} from './src/systems/workflow-field-rename-coordinator';
import type { WorkflowFieldRenameTaxonomySnapshot } from './src/storage/field-rename-journal-store';
import {
	executePriorityRenamePreview,
	PriorityRenameExecutionResult,
	PriorityRenamePreview,
} from './src/core/priority-rename-migration';
import { CalendarView, CALENDAR_VIEW_TYPE, type CalendarTrackedSessionRef } from './src/ui/calendar/calendar-view';
import {
	filterTasksForCalendar,
} from './src/systems/calendar-filter-materialization';
import {
	buildAllDayCalendarWritebackPlan,
	buildAllDayMoveWritebackPlan,
	buildAllDayResizeRightWritebackPlan,
	buildCalendarWritebackPlan,
	buildTimedCalendarWritebackPlanForExistingTask,
	buildTimedCalendarWritebackPlan,
	formatCalendarSlotSelectionLabel,
	insertInlineTaskUnderHeading,
	isExpandedAllDayRange,
	resolveCalendarInlineHeading,
} from './src/systems/calendar-writeback';
import { CalendarSlotActionId, SlotActionModal } from './src/ui/calendar/slot-action-modal';
import { buildTrackerSessionEditContext, TrackerSessionEditModal } from './src/ui/tracker-session-edit-modal';
import { CalendarPresetQuickSettingsModal } from './src/ui/calendar/calendar-preset-quick-settings-modal';
import { buildRepeatScopeModalLabels, promptRepeatOccurrenceScope } from './src/ui/calendar/repeat-occurrence-scope-modal';
import { KanbanView, KANBAN_VIEW_TYPE } from './src/ui/kanban/kanban-view';
import { OperonTableView } from './src/ui/table/operon-table-view';
import {
	OPERON_TABLE_FILE_VIEW_TYPE,
	OPERON_TABLE_VIEW_TYPE,
	cloneTablePreset,
	createDefaultTablePreset,
	createTablePresetId,
	type TableLeafState,
	type TablePreset,
	type TablePresetFileBinding,
	type TablePresetPatch,
} from './src/types/table';
import { buildUniqueRelatedPresetName } from './src/ui/related-views';
import type { RelatedViewCreateTarget, RelatedViewOpenTarget } from './src/types/related-views';
import { isEditableTableTaskFieldKey, normalizeTableTaskFieldKey } from './src/ui/table/table-field-catalog';
import { getExcludedTablePickerTaskIds } from './src/ui/table/table-editing';
import { buildTableEmbedCode } from './src/ui/table/table-export';
import { applyTablePresetPatch, resolveTablePresetForSettings } from './src/ui/table/table-preset-model';
import {
	clonePresetFavorites,
	removePresetFavorite,
	togglePresetFavorite,
	type PresetFavoriteKind,
	type PresetFavorites,
} from './src/core/preset-favorites';
import { TablePresetMutationQueue } from './src/ui/table/table-preset-mutation-queue';
import { TablePresetQuickSettingsModal } from './src/ui/table/table-preset-quick-settings-modal';
import { KanbanPresetQuickSettingsModal } from './src/ui/kanban/kanban-preset-quick-settings-modal';
import { KanbanCellActionModal } from './src/ui/kanban/kanban-cell-action-modal';
import { buildKanbanWritebackPlan } from './src/systems/kanban-writeback';
import {
	buildKanbanCellKey,
	extractLaneKeys,
	KANBAN_NO_VALUE_KEY,
	queryKanbanBoard,
	resolveTaskStatusDefinition,
} from './src/systems/kanban-query';
import { getManagedCustomFieldOptionMapping, getManagedTaskFieldType } from './src/core/managed-task-fields';
import {
	enginePerfLog,
	enginePerfNow,
	EnginePerfTraceMetadata,
	IndexPerfContext,
	isOperonEnginePerfDebugEnabled,
} from './src/core/engine-perf';

const FILTER_PERF_DEBUG = false;
const TABLE_REPEAT_AUXILIARY_WRITEBACK_KEYS = new Set(['repeatSeriesId', 'repeatOccurrenceDate']);
const perfNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const perfLog = (...args: unknown[]) => {
	if (FILTER_PERF_DEBUG) console.debug('[Operon filter perf]', ...args);
};

const LIVE_PREVIEW_INSERT_DAY_PICKER_DATE_KEYS = new Set<string>([
	'dateStarted',
	'dateScheduled',
	'dateDue',
	'dateCompleted',
	'dateCancelled',
]);

interface CreateFileTaskSourceSeed {
	description: string;
	replacementMode: 'none' | 'selection' | 'line';
	selection?: EditorSelection;
	lineNumber?: number;
	sourceFilePath?: string;
}

interface BulkSelectionTaskNode {
	indent: number;
	operonId: string;
	fieldValues: Record<string, string>;
	tags: string[];
}

interface BulkSelectionLineChange {
	from: EditorPosition;
	to: EditorPosition;
	text: string;
}

interface CreateFileTaskOptions {
	fallbackFile?: TFile | null;
	initialDescription?: string;
	seedFieldValues?: Record<string, string>;
	seedFieldPresence?: Set<string>;
	explicitEmptyFieldKeys?: Set<string>;
	seedTags?: string[];
	seedTagsPresent?: boolean;
	sourceReplacement?: CreateFileTaskSourceSeed | null;
	sourceContextFilePath?: string | null;
	targetFolderOverride?: string | null;
	focusDescriptionOnMount?: boolean;
	selectDescriptionOnMount?: boolean;
	openEditorOnCreate?: boolean;
}

interface OpenTaskCreatorOptions {
	submitMode?: TaskCreatorSubmitMode;
	initialCreateType?: TaskCreatorCreateType;
	onSubmitInline?: (draft: TaskCreatorDraft) => Promise<boolean> | boolean;
	onSubmitFile?: (draft: TaskCreatorDraft) => Promise<boolean> | boolean;
	initialOutsidePointerGraceMs?: number;
	preventFocusScroll?: boolean;
}

interface CalendarTaskCreatorOpenOptions extends Pick<OpenTaskCreatorOptions, 'initialOutsidePointerGraceMs' | 'preventFocusScroll'> {
	preserveMobileTimeGridScrollOnSubmit?: boolean;
}

interface TaskCreatorInlineCreationOptions {
	targetDateKey?: string | null;
	targetPath?: string | null;
	forceDailyNote?: boolean;
	parentAwarePlacement?: boolean;
}

interface TaskCreatorInlineTargetFile {
	file: TFile;
	fallbackParentTaskId: string | null;
	fallbackParentFieldValues: Record<string, string> | null;
	fallbackParentTags: string[] | null;
	dailyDateHeading?: string | null;
}

type TaskCreatorInlineTargetResolution =
	| ({ kind: 'target' } & TaskCreatorInlineTargetFile)
	| { kind: 'cancelled' }
	| { kind: 'failed' };

type TaskCreatorInlineCreationAttempt =
	| { kind: 'created'; result: QuickInlineTaskCreationResult }
	| { kind: 'cancelled' }
	| { kind: 'failed' };

interface ProjectedCalendarOccurrenceRef {
	seriesId: string;
	occurrenceDate: string;
}

const PROJECTED_CALENDAR_ITEM_ID_RE = /^projected:([^:]+):(\d{4}-\d{2}-\d{2})$/u;

interface CreatedCalendarFileTask {
	file: TFile;
	description: string;
	fieldValues: Record<string, string>;
	tags: string[];
}

type EditorScrollRange = { from: EditorPosition; to: EditorPosition };

interface CursorEditor {
	setCursor(position: EditorPosition): void;
	scrollIntoView?(range: EditorScrollRange, center?: boolean): void;
}

function hasUnknownMethod(value: unknown, methodName: string): boolean {
	return isRecord(value) && isUnknownFunction(value[methodName]);
}

function callUnknownMethod(value: unknown, methodName: string, ...args: unknown[]): unknown {
	if (!isRecord(value)) return undefined;
	const method = value[methodName];
	if (!isUnknownFunction(method)) return undefined;
	return method.call(value, ...args);
}

function readViewStateString(view: unknown, key: string): string | null {
	const state = callUnknownMethod(view, 'getState');
	if (!isRecord(state)) return null;
	return readString(state[key]) ?? null;
}

function isCursorEditor(value: unknown): value is CursorEditor {
	if (!isRecord(value)) return false;
	if (!isUnknownFunction(value.setCursor)) return false;
	const scrollIntoView = value.scrollIntoView;
	return scrollIntoView === undefined || isUnknownFunction(scrollIntoView);
}

function getCursorEditorFromView(view: unknown): CursorEditor | null {
	if (!isRecord(view)) return null;
	return isCursorEditor(view.editor) ? view.editor : null;
}

function getEditorViewFromEditor(editor: Editor): EditorView | null {
	const cm = (editor as Editor & { cm?: unknown }).cm;
	return cm instanceof EditorView ? cm : null;
}

function getWorkspaceEventFilePath(info: unknown): string {
	if (info instanceof MarkdownView) return info.file?.path ?? '';
	if (!isRecord(info)) return '';
	const file = info.file;
	return file instanceof TFile ? file.path : '';
}

interface LoadedFileTaskTemplateResult {
	'document': ParsedFrontmatterDocument | null;
	resolvedOperonIdSeed: string | null;
	resolvedContent: string | null;
}

interface FileTaskToInlineCursorTarget {
	file: TFile;
	view: MarkdownView;
	editor: Editor;
	lineNumber: number;
}

interface StatusCyclePerfTrace {
	traceId: string;
	taskId: string;
	format: IndexedTask['primary']['format'];
	filePath: string;
	changedKeys: string[];
	startedAt: number;
}

interface TaskFieldsUpdateOptions {
	mode?: 'merge' | 'replace';
	changedKeys?: string[];
	statusCycleTrace?: StatusCyclePerfTrace | null;
	refreshReason?: 'status-cycle';
	inlineCompletionMode?: InlineRepeatCompletionMode;
}

interface LivePreviewAuthoringCursorRestoreLease {
	filePath: string;
	position: EditorPosition;
	clampToDescription: boolean;
	editorView?: EditorView;
	trackDescriptionEnd: boolean;
	expiresAt: number;
}

interface RefreshViewsOptions {
	scheduleFollowup?: boolean;
	statusCycleTrace?: StatusCyclePerfTrace | null;
	reason?: string;
	markdownScope?: MarkdownRefreshScope;
	/**
	 * True only for the refresh that follows an index update. Such passes may
	 * let calendar views skip their full rebuild when the rendered content is
	 * provably unchanged. Every other channel (settings saves, pinned or
	 * project-serial subscriptions, external calendar changes, UI handlers)
	 * must leave this unset so the calendar always force-renders for them.
	 */
	fromIndexUpdate?: boolean;
}

interface RefreshViewsPerfContext {
	trace: StatusCyclePerfTrace;
	reason: string;
	requestedAt: number;
	requestCount: number;
	surfaceMetadata: string[];
	markdownScope: MarkdownRefreshScope;
}

interface RefreshViewsStageTiming {
	stage: string;
	stageMs: number;
}

interface MarkdownTaskSurfaceRefreshResult {
	scope: MarkdownRefreshScope;
	refreshedLeaves: number;
	skippedLeaves: number;
	refreshedEmbeddedEditors: number;
	skippedEmbeddedEditors: number;
}

interface MarkdownTaskSurfaceRefreshOptions {
	resetLivePreviewReveal?: boolean;
	scope?: MarkdownRefreshScope;
	forceTaskWikilinkOverlayFilePath?: string;
	forceReadingViewRerender?: boolean;
}

type DuplicateAlertStatusBarState = 'hidden' | 'conflict' | 'resolved';

const OPERON_ID_PLACEHOLDER_VALUE_PATTERN = /^\{\{operonId[0-9A-Za-z]?\}\}$/;
const DEFERRED_FILE_TASK_TEMPLATE_PLACEHOLDER_PATTERN = /\{\{(note|dateStarted|dateScheduled|dateDue|status|priority)\}\}/g;
const TEMPLATED_FILE_TASK_CREATION_WINDOW_MS = 30_000;
const RAW_TASK_CREATION_BULK_NOTICE_THRESHOLD = 4;
const RAW_TASK_CREATION_NOTICE_SUPPRESSION_TTL_MS = 30_000;
const INTERNAL_TASK_WRITE_SUPPRESSION_MS = 750;
const DUPLICATE_ALERT_RESOLVED_HIDE_DELAY_MS = 10_000;
const CANONICAL_SETTINGS_RELOAD_THROTTLE_MS = 5_000;
const TABLE_FILE_PROPERTY_TYPE_CHECK_THROTTLE_MS = 5_000;
const WORKSPACE_TWEAK_HIDE_SCROLLBARS_CLASS = 'operon-tweak-hide-scrollbars';
const WORKSPACE_TWEAK_PROPERTIES_COLLAPSER_CLASS = 'operon-tweak-properties-collapser';
const WORKSPACE_TWEAK_PROPERTIES_COLLAPSER_TARGET_CLASS = 'operon-tweak-properties-collapser-target';
const WORKSPACE_TWEAK_COMPACT_SIDEBAR_TAB_ICONS_CLASS = 'operon-tweak-compact-sidebar-tab-icons';
const WORKSPACE_TWEAK_PROPERTIES_COLLAPSE_RETRY_DELAYS_MS = [0, 75, 200, 500, 1000] as const;

interface WorkspaceTweakPropertiesCollapseCycle {
	id: number;
	attempted: boolean;
}

interface NativeFileTaskConversionMenuState {
	priority: number;
	targetFile: TFile | null;
	item: MenuItem | null;
}

type SettingsReindexReason = 'key-mappings' | 'workflow-semantics';

interface TablePresetSettingsSnapshot {
	tablePresets: TablePreset[];
	tablePresetFileBindings: TablePresetFileBinding[];
	tablePresetOrderIds: string[];
	tableDefaultPresetId: string | null;
	presetFavorites: PresetFavorites;
}

export default class OperonPlugin extends Plugin {
	api: OperonPublicApiV1 = this.buildPublicApi();
	storage!: OperonStorage;
	indexer!: OperonIndexer;
	writer!: TaskWriter;
	dependencyManager!: DependencyManager;
	aggregateCoordinator!: AggregateCoordinator;
	taskStatsBackfillRunner!: TaskStatsBackfillRunner;
	workflowFieldRenameCoordinator!: WorkflowFieldRenameCoordinator;
	timeTracker!: TimeTracker;
	recurrenceService!: RecurrenceService;
	formatConverter!: FormatConverter;
	settings!: OperonSettings;
	private localePackManager: LocalePackManager | null = null;
	private keyMappingSignature = '';
	private workflowStatusSemanticsSignature = '';
	private indexV8ManifestFingerprint: string | null = null;
	private indexV8ManifestCheckActive = false;
	private settingsReindexTimer: WindowTimeoutHandle | null = null;
	private startupReleaseCheckTimer: WindowTimeoutHandle | null = null;
	private releaseCheckGeneration = 0;
	private pendingSettingsReindexReasons = new Set<SettingsReindexReason>();
	private settingsReindexRetryAttempted = false;
	private canonicalSettingsReloadTimer: WindowTimeoutHandle | null = null;
	private canonicalSettingsReloadRunning = false;
	private canonicalSettingsReloadLastCheckAt = 0;
	private yamlPropertyVisibilityRefreshTimer: WindowTimeoutHandle | null = null;
	private locationPlaceTableRefreshTimer: WindowTimeoutHandle | null = null;
	private tableFilePropertyRefreshTimer: WindowTimeoutHandle | null = null;
	private tableFilePropertyTypeFingerprint: string | null = null;
	private tableFilePropertyTypeCheckActive = false;
	private tableFilePropertyTypeLastCheckAt = 0;
	private readonly tableFilePropertyTypeResolver = createCachedTableFilePropertyTypeResolver();
	private tableFilePropertyIndex: TableFilePropertyIndex | null = null;
	private readonly nativeFileTaskConversionMenus = new WeakMap<Menu, NativeFileTaskConversionMenuState>();
	private workspaceTweakPropertiesCollapseCycleId = 0;
	private workspaceTweakPropertiesCollapseCycles = new WeakMap<MarkdownView, WorkspaceTweakPropertiesCollapseCycle>();
	private workspaceTweakPropertiesCollapseTimers: WindowTimeoutHandle[] = [];
	private workspaceTweakPropertiesTargetEls = new Set<HTMLElement>();
	private workspaceTweakBodyDocuments = new Set<Document>();
	private embedFilterDeps: EmbedFilterDeps | null = null;
	private embedTableDeps: EmbedTableDeps | null = null;
	private readonly tablePresetMutationQueue = new TablePresetMutationQueue();
	private tablePresetRegistry!: TablePresetRegistry<TFile>;
	private tablePresetFileLifecycle!: TablePresetFileLifecycle<TFile>;
	private readonly tablePresetRegistrySubscriptions = new Map<string, () => void>();
	private settingsTab: OperonSettingsTab | null = null;
	private tablePresetRegistryRefreshTimer: WindowTimeoutHandle | null = null;
	private readonly expectedTableFileModifyHashes = new Map<string, string>();
	private readonly expectedTableFileRenames = new Map<string, string>();
	private readonly expectedTableFileDeletes = new Map<string, string>();
	private tablePresetFileMigrationRunning = false;
	private tablePresetFileMigrationSummary: TablePresetFileMigrationSummary | null = null;
	private tablePresetFileMigrationReceipt: TablePresetFileMigrationReceiptV1 | null = null;
	private dynamicFileTaskFilterReadingTimers = new Map<string, WindowTimeoutHandle>();
	private dynamicFileTaskFilterReadingHosts = new Set<HTMLElement>();
	private dynamicFileTaskFilterReadingInstances = new WeakMap<HTMLElement, FilterSurfaceInstance>();
	private deferredRefreshTimer: WindowTimeoutHandle | null = null;
	private editableFocusRefreshTimer: WindowTimeoutHandle | null = null;
	private refreshViewsFrame: number | null = null;
	private refreshViewsFollowupRequested = false;
	private refreshViewsPendingNonIndexRequest = false;
	private refreshViewsPendingRequestCount = 0;
	private refreshViewsPendingPerfContext: RefreshViewsPerfContext | null = null;
	private refreshViewsPendingMarkdownScope: MarkdownRefreshScope | null = null;
	private livePreviewAuthoringCursorRestoreLease: LivePreviewAuthoringCursorRestoreLease | null = null;
	private livePreviewAuthoringCursorRestoreClearTimer: WindowTimeoutHandle | null = null;
	private indexSideEffectTimer: WindowTimeoutHandle | null = null;
	private indexV8CleanupMaintenance: IndexV8MaintenanceHandle | null = null;
	private indexSideEffectRunning = false;
	private indexSideEffectFollowupRequested = false;
	private projectSerialIndexReconcileScheduler: CoalescedAsyncScheduler | null = null;
	private projectSerialIndexReconcilePendingBeforeStartup = false;
	private fileTaskArchiver: FileTaskArchiver | null = null;
	private reminderScheduler: ReminderScheduler | null = null;
	private reminderDeliveryController: ReminderDeliveryController | null = null;
	private mobileNotificationsExporter: MobileNotificationsExporter | null = null;
	private livePreviewEphemeralSession = new LivePreviewEphemeralSessionController();
	private activeLivePreviewPickerClose: (() => void) | null = null;
	private suppressLivePreviewSessionEditorChange = false;
	private livePreviewPendingPickerSessionId: string | null = null;
	private livePreviewPendingPickerUntil = 0;
	private workflowNormalizationInProgress = new Set<string>();
	private workflowNormalizationPending = new Set<string>();
	private workflowNormalizationRenameTargets = new Map<string, string>();
	private templatedFileTaskCreationCandidates = new Map<string, number>();
	private trackerStatusBar: TimeTrackerStatusBar | null = null;
	private pinnedDock: PinnedTasksDock | null = null;
	private mobileGlobalTaskFab: MobileGlobalTaskFab | null = null;
	private taskCreatorModal: TaskCreatorModal | null = null;
	private subtasksFilterModal: SubtasksFilterModal | null = null;
	private pinnedCache: PinnedCache | null = null;
	private externalCalendarService: ExternalCalendarService | null = null;
	private operonDocsSyncInFlight: Promise<OperonDocsSyncResult> | null = null;
	private operonDocsOperationQueue: Promise<void> = Promise.resolve();
	private duplicateOperonIdModal: DuplicateOperonIdModal | null = null;
	private duplicateConflictCounts: Map<string, number> = new Map();
	private duplicateConflictAutoOpenSuppressionDepth = 0;
	private duplicateAlertStatusBarEl: HTMLElement | null = null;
	private duplicateAlertTimer: WindowTimeoutHandle | null = null;
	private duplicateAlertResolvedTimer: WindowTimeoutHandle | null = null;
	private duplicateAlertStatusBarState: DuplicateAlertStatusBarState = 'hidden';
		private duplicateAlertPendingFocusOperonId: string | null = null;
		private duplicateAlertLastNoticeSignature: string | null = null;
		private unsubscribePinnedCache: (() => void) | null = null;
		private unsubscribeProjectSerials: (() => void) | null = null;
		private startupReady = false;
	private refreshViewsCallCount = 0;
	private statusCyclePerfTraceCounter = 0;
	private pendingCalendarRefresh = false;
	private pendingKanbanRefresh = false;
		private internalTaskWriteSuppressUntilByPath = new Map<string, number>();
		private rawTaskCreationNoticeSuppressUntilById = new Map<string, number>();
		private blockedStatusWriteSuppressFallbackUntilById = new Map<string, number>();
		private calendarDailyNoteParentSeedPromises = new Map<string, Promise<TaskCreatorParentSeed | null>>();
		private calendarDailyNoteCreatedNoticePaths = new Set<string>();

	private isPinnedDockDisabledOnCurrentDevice(): boolean {
		return this.settings.pinnedDockDisableOnMobile && Platform.isPhone;
	}

	private isPinnedTasksSidebarForcedOnCurrentDevice(): boolean {
		return Platform.isMobile || Platform.isMobileApp || Platform.isPhone;
	}

	private shouldOpenPinnedTasksInSidebar(): boolean {
		return this.isPinnedTasksSidebarForcedOnCurrentDevice()
			|| this.settings.pinnedTasksDesktopSurface === 'sidebar';
	}

	async openPinnedTasksSurface(): Promise<void> {
		if (this.shouldOpenPinnedTasksInSidebar()) {
			await this.openPinnedTasksSidebarView();
			return;
		}
		if (this.isPinnedDockDisabledOnCurrentDevice()) {
			await this.openPinnedTasksSidebarView();
			return;
		}
		this.pinnedDock?.toggle();
	}

	async openPinnedTasksSidebarView(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(PINNED_TASKS_SIDEBAR_VIEW_TYPE)[0];
		if (existing) {
			await existing.setViewState({ type: PINNED_TASKS_SIDEBAR_VIEW_TYPE, active: true });
			callUnknownMethod(existing.view, 'markDirty');
			callUnknownMethod(existing.view, 'render');
			await this.app.workspace.revealLeaf(existing);
			return;
		}

		const leaf = this.settings.pinnedTasksSidebarSide === 'right'
			? this.app.workspace.getRightLeaf(false)
			: this.app.workspace.getLeftLeaf(false);
		if (!leaf) return;

		await leaf.setViewState({ type: PINNED_TASKS_SIDEBAR_VIEW_TYPE, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}

	private syncFilterSetsFromStore(): void {
		this.settings.filterSets = this.storage.filters.getAll();
	}

	private async togglePresetFavoriteAndRefresh(kind: PresetFavoriteKind, presetId: string): Promise<void> {
		if (await this.storage.togglePresetFavorite(kind, presetId)) {
			this.refreshViews();
		}
	}

	private async saveFilterSetAndRefresh(filterSet: FilterSet): Promise<void> {
		await this.storage.filters.upsert(filterSet);
		this.syncFilterSetsFromStore();
		this.refreshViews();
	}

	private generateFilterSetId(): string {
		return 'fs_' + Math.random().toString(36).slice(2, 9);
	}

	private async duplicateFilterSetAndRefresh(filterSet: FilterSet): Promise<void> {
		if (isSpecialDynamicFilterSet(filterSet)) return;
		const copy = cloneFilterSet(filterSet);
		copy.id = this.generateFilterSetId();
		copy.name = `${filterSet.name} Copy`;

		const ids = getNormalFilterSets(this.settings.filterSets).map(entry => entry.id);
		const idx = ids.indexOf(filterSet.id);
		await this.storage.filters.upsert(copy);
		this.syncFilterSetsFromStore();

		const nextIds = this.settings.filterSets.map(entry => entry.id);
		const copyIdx = nextIds.indexOf(copy.id);
		if (idx !== -1 && copyIdx !== -1 && copyIdx !== idx + 1) {
			nextIds.splice(copyIdx, 1);
			nextIds.splice(idx + 1, 0, copy.id);
			await this.storage.filters.replaceOrder(nextIds);
			this.syncFilterSetsFromStore();
		}
		this.refreshViews();
	}

	private async deleteFilterSetAndRefresh(filterSetId: string): Promise<void> {
		await this.storage.deleteFilterSetWithFavoriteCleanup(filterSetId);
		this.syncFilterSetsFromStore();
		this.refreshViews();
	}

	private openDynamicFileTaskFilterSettings(template?: FilterSet): void {
		const filterSet = normalizeDynamicFileTaskFilterSet(
			template ?? this.settings.filterSets.find(entry => isDynamicFileTaskFilterSet(entry)) ?? null,
		);
		new FilterSetModal(this.app, filterSet, this.settings.keyMappings, asyncHandler('dynamic file task filter settings save failed', async (saved) => {
			await this.saveFilterSetAndRefresh(normalizeDynamicFileTaskFilterSet(saved));
		}), undefined, {
			title: t('filterSets', 'dynamicFileTaskFilterTitle'),
			lockConditions: 'dynamicFileTask',
			hideUsageInfo: true,
			showCountBadge: false,
			getSettings: () => this.settings,
			getFilePropertyDiscoveryTasks: () => this.indexer.getAllTasks(),
			getFilePropertySnapshot: tasks => this.getTableFilePropertySnapshot(tasks),
		}).open();
	}

	private openDynamicSubtasksFilterSettings(template?: FilterSet): void {
		const filterSet = normalizeDynamicSubtasksFilterSet(
			template ?? this.settings.filterSets.find(entry => isDynamicSubtasksFilterSet(entry)) ?? null,
		);
		new FilterSetModal(this.app, filterSet, this.settings.keyMappings, asyncHandler('dynamic subtasks filter settings save failed', async (saved) => {
			await this.saveFilterSetAndRefresh(normalizeDynamicSubtasksFilterSet(saved));
		}), undefined, {
			title: t('filterSets', 'dynamicSubtasksFilterTitle'),
			lockConditions: 'dynamicSubtasks',
			hideUsageInfo: true,
			showCountBadge: false,
			getSettings: () => this.settings,
			getFilePropertyDiscoveryTasks: () => this.indexer.getAllTasks(),
			getFilePropertySnapshot: tasks => this.getTableFilePropertySnapshot(tasks),
		}).open();
	}

	private async createOrRepairBasicsWorkspaceFromUi(): Promise<void> {
		try {
			const result = await createOrRepairBasicsWorkspace(this.app, this.storage, this.settings);
			this.syncFilterSetsFromStore();
			await this.app.workspace.getLeaf(false).openFile(result.file);
			await this.indexer.reindexFilePath(result.file.path, { notify: false });
			await this.indexer.reindexFilePath(result.setupProjectFile.path, { notify: false });
			await this.aggregateCoordinator.refreshAfterTaskIds(OPERON_DEMO_AGGREGATE_PARENT_IDS);
			this.refreshViews();
			new Notice(t('notifications', 'demoWorkspaceReady', {
				path: result.file.path,
			}));
		} catch (error) {
			new Notice(t('notifications', 'demoWorkspaceCreateFailed'));
			throw error;
		}
	}

	private async markDemoWorkspacePromptDismissed(): Promise<void> {
		if (this.settings.demoWorkspacePromptDismissed) return;
		this.settings.demoWorkspacePromptDismissed = true;
		await this.storage.saveSettings();
	}

	private async maybeShowDemoWorkspacePrompt(): Promise<void> {
		if (this.settings.demoWorkspacePromptDismissed) return;
		if (await hasBasicsWorkspaceArtifact(this.app, this.storage)) {
			await this.markDemoWorkspacePromptDismissed();
			return;
		}

		new ConfirmActionModal(this.app, {
			title: t('settings', 'demoWorkspacePromptTitle'),
			message: t('settings', 'demoWorkspacePromptMessage'),
			confirmText: t('settings', 'demoWorkspacePromptCreate'),
			cancelText: t('settings', 'demoWorkspacePromptSkip'),
		}, (confirmed) => {
			runAsyncAction('demo workspace prompt action failed', async () => {
				try {
					if (confirmed) {
						await this.createOrRepairBasicsWorkspaceFromUi();
					}
				} finally {
					await this.markDemoWorkspacePromptDismissed();
				}
			});
		}).open();
	}

	private maybeShowReleaseNotesOnUpdate(): void {
		if (!this.settings.releaseNotesShowOnUpdate) return;
		const currentVersion = this.manifest.version;
		const releaseNotes = getReleaseNotesForUpdate(this.settings.releaseNotesLastShownVersion, currentVersion);
		if (releaseNotes.length === 0) return;

		new OperonReleaseNotesModal(this.app, releaseNotes, {
			docsFolder: this.settings.operonDocsFolder,
			onClose: async () => {
				if (this.settings.releaseNotesLastShownVersion === currentVersion) return;
				this.settings.releaseNotesLastShownVersion = currentVersion;
				await this.storage.saveSettings();
			},
		}).open();
	}

	private async checkForNewReleaseOnStartup(generation: number): Promise<void> {
		if (!this.settings.checkForUpdatesOnStartup) return;
		try {
			const availableVersion = await getAvailableOperonReleaseVersion({
				requestJson: async url => {
					const response = await requestUrl({ url, method: 'GET' });
					return response.json as unknown;
				},
				canRunMinAppVersion: minAppVersion => requireApiVersion(minAppVersion),
			});
			if (generation !== this.releaseCheckGeneration
				|| !this.settings.checkForUpdatesOnStartup) return;
			if (!shouldNotifyForOperonRelease(
				this.manifest.version,
				availableVersion,
				this.settings.lastNotifiedReleaseVersion,
			)) return;

			this.settings.lastNotifiedReleaseVersion = availableVersion;
			if (generation !== this.releaseCheckGeneration) return;
			await this.storage.saveSettings();
			if (generation !== this.releaseCheckGeneration
				|| !this.settings.checkForUpdatesOnStartup) return;
			new Notice(this.createReleaseAvailableNotice(availableVersion), 15_000);
		} catch (error) {
			console.debug('Operon: release check failed', error);
		}
	}

	private createReleaseAvailableNotice(version: string): DocumentFragment {
		const fragment = createFragment();
		fragment.appendText(t('notifications', 'releaseAvailable', { version }));
		fragment.appendText(' ');
		const action = fragment.createEl('a');
		action.textContent = t('notifications', 'releaseAvailableAction');
		action.href = OPERON_COMMUNITY_PLUGIN_URL;
		action.addEventListener('click', event => {
			event.preventDefault();
			getActiveWindow().open(OPERON_COMMUNITY_PLUGIN_URL, '_blank');
		});
		return fragment;
	}

	private cancelStartupReleaseCheck(): void {
		this.releaseCheckGeneration += 1;
		if (!this.startupReleaseCheckTimer) return;
		clearWindowTimeout(this.startupReleaseCheckTimer);
		this.startupReleaseCheckTimer = null;
	}

	private handleSettingsChanged(): void {
		if (!this.settings.checkForUpdatesOnStartup) this.cancelStartupReleaseCheck();
		this.writer.updateKeyMappings(this.settings.keyMappings);
		const previousKeyMappingSignature = this.keyMappingSignature;
		this.keyMappingSignature = this.buildKeyMappingSignature();
		if (previousKeyMappingSignature !== this.keyMappingSignature) {
			this.scheduleSettingsReindex('key-mappings');
		}
		const previousWorkflowStatusSemanticsSignature = this.workflowStatusSemanticsSignature;
		this.workflowStatusSemanticsSignature = buildWorkflowStatusSemanticsSignature(this.settings.pipelines);
		if (previousWorkflowStatusSemanticsSignature !== this.workflowStatusSemanticsSignature) {
			runAsyncAction(
				'workflow semantics reconciliation marker persistence failed',
				() => this.markTaskStatsBackfillPending(),
			);
			this.scheduleSettingsReindex('workflow-semantics');
		}
		void this.externalCalendarService?.applySettings(this.settings.externalCalendars);
		this.reminderScheduler?.handleSettingsChanged();
		runAsyncAction('mobile notifications snapshot settings reconciliation failed', async () => {
			await this.mobileNotificationsExporter?.handleSettingsChanged();
		});
		initI18n(undefined, this.settings.language);
		void this.reconcileProjectSerials({ notifyCapacity: true })
			.then(() => {
				if (this.startupReady) {
					this.refreshViews({ reason: 'project-serials' });
				}
			})
			.catch(error => {
				console.warn('Operon: failed to reconcile project serials after settings change', error);
			});
		this.applyWorkspaceTweaks();
		this.scheduleWorkspacePropertiesCollapseForAllViews();
		this.trackerStatusBar?.render();
		this.refreshDuplicateAlertStatusBar();
		this.mobileGlobalTaskFab?.refresh();
		this.refreshViews();
	}

	private async synchronizeLanguagePacksAfterLayout(): Promise<void> {
		if (!this.localePackManager) return;
		const orderedLanguages = buildLocalePackReconcileOrder(this.settings);
		for (const language of orderedLanguages) {
			try {
				const pack = await this.localePackManager.ensureLocale(language);
				installI18nLocale(language, pack.translations);
				if (!shouldActivateReconciledLocale(language, this.settings.language)) continue;
				if (!activateI18nLocale(language)) continue;
				this.settingsTab?.refreshLanguageState();
				this.trackerStatusBar?.render();
				this.mobileGlobalTaskFab?.refresh();
				this.refreshViews();
			} catch (error) {
				console.warn(`Operon: language pack synchronization failed for ${language}`, error);
			}
		}
	}

	private getProjectSerialDisplayForTask(operonId: string): ProjectSerialDisplay | null {
		return this.storage.projectSerials.getDisplayForTask(operonId);
	}

	private getReadingProjectSerialDisplayForTask(operonId: string, task?: IndexedTask): ProjectSerialDisplay | null {
		return this.storage.projectSerials.getDisplayForTaskWithFallback(
			operonId,
			this.settings.projectSerialScopes,
			(candidateId) => {
				if (task?.operonId === candidateId) return task;
				return this.indexer.getTask(candidateId) ?? null;
			},
		);
	}

	private getProjectSerialSignature(): string {
		return this.storage.projectSerials.getSignature();
	}

	private getRepeatSkipSignature(): string {
		return JSON.stringify(this.storage.repeatSeries.getAllEntries().map(entry => [
			entry.seriesId,
			entry.skipDates,
		]));
	}

	private async reconcileProjectSerials(options: { notifyCapacity?: boolean } = {}): Promise<void> {
		const result = await this.storage.projectSerials.reconcile(
			this.settings.projectSerialScopes,
			this.indexer.getAllTasks(),
			localNow(),
		);
		if (options.notifyCapacity === true && result.capacityBlockedScopeIds.length > 0) {
			new Notice(t('notifications', 'projectSerialCapacityReached'));
		}
	}

	private async reconcileProjectSerialsForIndexMutation(): Promise<void> {
		await this.reconcileProjectSerials();
	}

	private reportStartupPipelineTaxonomyDiagnostics(): void {
		const diagnostics = this.storage.getStartupPipelineTaxonomyDiagnostics();
		if (diagnostics.backupFailed) {
			new Notice(t('notifications', 'pipelineTaxonomyRecoveryFailed', {
				count: String(diagnostics.issues.length),
			}));
			return;
		}
		if (diagnostics.backupPath) {
			new Notice(t('notifications', 'pipelineTaxonomyRecovered', {
				count: String(diagnostics.issues.length),
				path: diagnostics.backupPath,
			}));
		}
	}

	private registerCanonicalSettingsReloadWatchers(): void {
		this.registerDomEvent(getActiveWindow(), 'focus', () => {
			this.scheduleCanonicalSettingsReloadCheck();
		});
		this.registerDomEvent(getActiveDocument(), 'visibilitychange', () => {
			if (getActiveDocument().visibilityState !== 'visible') return;
			this.scheduleCanonicalSettingsReloadCheck();
		});
		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				this.scheduleCanonicalSettingsReloadCheck();
			})
		);
	}

	private registerEditableFocusRefreshWatchers(): void {
		const scheduleFlush = (): void => this.scheduleEditableFocusRefreshFlush();
		this.registerDomEvent(getActiveDocument(), 'focusout', scheduleFlush, true);
	}

	private scheduleEditableFocusRefreshFlush(delayMs = 120): void {
		if (!this.pendingCalendarRefresh) return;
		if (this.editableFocusRefreshTimer) return;
		this.editableFocusRefreshTimer = setWindowTimeout(() => {
			this.editableFocusRefreshTimer = null;
			if (!this.pendingCalendarRefresh) return;
			if (this.shouldFreezeCalendarRefresh()) {
				this.scheduleEditableFocusRefreshFlush(240);
				return;
			}
			this.flushPendingCalendarRefresh();
		}, delayMs);
	}

	private scheduleCanonicalSettingsReloadCheck(): void {
		if (!this.startupReady) return;
		if (this.canonicalSettingsReloadTimer) return;
		const elapsedMs = Date.now() - this.canonicalSettingsReloadLastCheckAt;
		const delayMs = Math.max(0, CANONICAL_SETTINGS_RELOAD_THROTTLE_MS - elapsedMs);
		this.canonicalSettingsReloadTimer = setWindowTimeout(() => {
			this.canonicalSettingsReloadTimer = null;
			void this.runCanonicalStorageBackgroundRefresh();
		}, delayMs);
	}

	private async runCanonicalStorageBackgroundRefresh(): Promise<void> {
		await this.reloadCanonicalSettingsFromStorage('background');
	}

	private async reloadCanonicalSettingsFromStorage(mode: 'background' | 'manual'): Promise<void> {
		if (this.canonicalSettingsReloadRunning) return;
		this.canonicalSettingsReloadRunning = true;
		this.canonicalSettingsReloadLastCheckAt = Date.now();
		try {
			const previousLocaleIntent = {
				language: this.settings.language,
				languagePackSubscriptions: [...this.settings.languagePackSubscriptions],
			};
			const result = await this.storage.reloadCanonicalSettingsPackage();
			const localeIntentChanged = hasLocalePackIntentChanged(previousLocaleIntent, this.settings);
			const taxonomyDiagnostics = result.diagnostics.pipelineTaxonomy;
			const failed = result.diagnostics.malformedPackage || taxonomyDiagnostics.backupFailed;
			if (failed) {
				console.warn('Operon: canonical settings reload warning', result.diagnostics);
				new Notice(t('notifications', taxonomyDiagnostics.backupFailed
					? 'pipelineTaxonomyRecoveryFailed'
					: 'settingsReloadFailed', {
					count: String(taxonomyDiagnostics.issues.length),
				}));
				return;
			}
			if (taxonomyDiagnostics.backupPath) {
				new Notice(t('notifications', 'pipelineTaxonomyRecovered', {
					count: String(taxonomyDiagnostics.issues.length),
					path: taxonomyDiagnostics.backupPath,
				}));
			}
			const hasFileBackedTablePresetAuthority = this.settings.tablePresetFileBindings.length > 0
				|| this.settings.tablePresetFileMigrationVersion >= 1;
			if (result.changed || hasFileBackedTablePresetAuthority) {
				await this.refreshTablePresetRegistry({ adoptUnbound: true, persistBindings: true });
			}
			if (result.changed) {
				this.handleSettingsChanged();
				if (localeIntentChanged) {
					await this.synchronizeLanguagePacksAfterLayout();
				}
				if (mode === 'manual') {
					new Notice(t('notifications', 'settingsReloadedFromStorage'));
				}
			} else if (mode === 'manual') {
				new Notice(t('notifications', 'settingsReloadUnchanged'));
			}
			if (result.diagnostics.invalidDomains.length > 0) {
				console.warn('Operon: canonical settings reload warning', result.diagnostics);
			}
		} catch (error) {
			console.warn('Operon: canonical settings reload failed', error);
			if (mode === 'manual') {
				new Notice(t('notifications', 'settingsReloadFailed'));
			}
		} finally {
			this.canonicalSettingsReloadRunning = false;
		}
	}

	private resolvePreferredFilterSetId(filterSetId: string | null | undefined): string | null {
		const filterSets = getNormalFilterSets(this.settings.filterSets);
		if (filterSetId && filterSets.some(filterSet => filterSet.id === filterSetId)) {
			return filterSetId;
		}

		if (
			this.settings.leftRailDefaultFilterViewId
			&& filterSets.some(filterSet => filterSet.id === this.settings.leftRailDefaultFilterViewId)
		) {
			return this.settings.leftRailDefaultFilterViewId;
		}

		return filterSets[0]?.id ?? null;
	}

	private hasActiveEditableFocus(): boolean {
		const activeElement = asHTMLElement(getActiveDocument().activeElement);
		return this.isEditableFocusElement(activeElement);
	}

	private isEditableFocusElement(element: HTMLElement | null): boolean {
		if (!element || element === getActiveDocument().body) return false;
		const tagName = element.tagName.toLowerCase();
		if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') return true;
		if (element.isContentEditable) return true;
		return element.closest('.cm-editor, .cm-content, [contenteditable="true"], [contenteditable="plaintext-only"]') !== null;
	}

	private isFocusedMarkdownEditor(): boolean {
		if (!this.app.workspace.getActiveViewOfType(MarkdownView)) return false;
		const activeElement = asHTMLElement(getActiveDocument().activeElement);
		return !!activeElement?.closest('.cm-editor');
	}

	private isTaskEditorModalOpen(): boolean {
		return asHTMLElement(getActiveDocument().body.querySelector('.operon-task-editor-modal')) !== null;
	}

	private shouldFreezeCalendarRefresh(): boolean {
		return this.hasActiveEditableFocus()
			|| this.isTaskEditorModalOpen()
			|| this.hasActiveCalendarDragInteraction();
	}

	private shouldFreezeKanbanRefresh(): boolean {
		return this.isFocusedMarkdownEditor() || this.isTaskEditorModalOpen();
	}

	private hasActiveCalendarDragInteraction(): boolean {
		for (const leaf of this.app.workspace.getLeavesOfType(CALENDAR_VIEW_TYPE)) {
			if (callUnknownMethod(leaf.view, 'hasActiveCalendarDragInteraction') === true) {
				return true;
			}
		}
		return false;
	}

	private refreshCalendarLeaves(
		statusCycleTrace: StatusCyclePerfTrace | null = null,
		allowContentSkip = false,
	): void {
		for (const leaf of this.app.workspace.getLeavesOfType(CALENDAR_VIEW_TYPE)) {
			if (
				statusCycleTrace
				&& callUnknownMethod(leaf.view, 'markDirtyForStatusCycle', statusCycleTrace) === true
			) {
				continue;
			}
			callUnknownMethod(leaf.view, 'markDirty', { allowContentSkip });
		}
	}

	private refreshKanbanLeaves(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(KANBAN_VIEW_TYPE)) {
			callUnknownMethod(leaf.view, 'markDirty');
		}
	}

	private refreshTableLeaves(presetId?: string, registryEntry?: TablePresetRegistryEntry<TFile> | null): void {
		const leaves = [
			...this.app.workspace.getLeavesOfType(OPERON_TABLE_VIEW_TYPE),
			...this.app.workspace.getLeavesOfType(OPERON_TABLE_FILE_VIEW_TYPE),
		];
		for (const leaf of leaves) {
			const tableView = leaf.view instanceof OperonTableView ? leaf.view : null;
			const isFileView = tableView?.getViewType() === OPERON_TABLE_FILE_VIEW_TYPE;
			if (presetId !== undefined) {
				if (isFileView) {
					const path = tableView?.file?.path;
					const entry = this.tablePresetRegistry.get(presetId);
					const candidatePaths = new Set([
						...(entry?.source.path ? [entry.source.path] : []),
						...(entry?.conflicts.flatMap(conflict => conflict.paths) ?? []),
					].map(getOperonTableFilePathKey));
					if (!path || !candidatePaths.has(getOperonTableFilePathKey(path))) continue;
				} else {
					const state = leaf.view instanceof OperonTableView
					? leaf.view.getState() as Partial<TableLeafState>
					: {};
					const activePresetId = state.presetId ?? this.settings.tableDefaultPresetId;
					if (activePresetId !== presetId) continue;
				}
			}
			if (isFileView && tableView && presetId !== undefined) {
				if (registryEntry?.status === 'available' && registryEntry.preset) {
					tableView.applyRegistryPreset(registryEntry.preset);
					continue;
				}
				runAsyncAction('table file leaf reload failed', () => tableView.reloadCurrentTableFile());
				continue;
			}
			if (hasUnknownMethod(leaf.view, 'renderIfVisibleOrInvalidate')) {
				callUnknownMethod(leaf.view, 'renderIfVisibleOrInvalidate');
			} else {
				callUnknownMethod(leaf.view, 'render');
			}
		}
	}

	private refreshTablePresetSurfaces(presetId: string, registryEntry?: TablePresetRegistryEntry<TFile> | null): void {
		this.refreshTableLeaves(presetId, registryEntry);
		if (this.embedTableDeps) refreshEmbedTables(this.embedTableDeps, presetId);
	}

	private refreshTimeSessionHistoryLeaves(force = false): void {
		for (const leaf of this.app.workspace.getLeavesOfType(TIME_SESSION_HISTORY_VIEW_TYPE)) {
			if (force) callUnknownMethod(leaf.view, 'markDirty');
			callUnknownMethod(leaf.view, 'render');
		}
	}

	private getExternalCalendarItemsForRange(
		rangeStart: string,
		rangeEnd: string,
		presetId?: string,
		showExternalCalendarsOverride?: boolean,
	): CalendarItem[] {
		if (!this.externalCalendarService) return [];
		const events = this.externalCalendarService.getCachedEvents(rangeStart, rangeEnd);
		const preset = presetId ? this.settings.calendarPresets.find(p => p.id === presetId) : undefined;
		return buildExternalCalendarItems(
			events,
			this.settings.externalCalendars,
			rangeStart,
			rangeEnd,
			preset?.externalCalendarVisibility,
			showExternalCalendarsOverride ?? preset?.showExternalCalendars,
		);
	}

	private async syncExternalCalendarSourceNow(sourceId: string): Promise<void> {
		if (!this.externalCalendarService) return;
		await this.externalCalendarService.applySettings(this.settings.externalCalendars);
		const result = await this.externalCalendarService.syncNow(sourceId);
		if (result === 'skipped') {
			new Notice(t('notifications', 'externalCalendarSyncSkipped'));
			return;
		}
		if (result === 'failed') {
			new Notice(t('notifications', 'externalCalendarSyncFailed'));
			return;
		}
		new Notice(t('notifications', 'externalCalendarSyncComplete'));
		this.refreshViews();
	}

	private async syncAllExternalCalendarsNow(): Promise<void> {
		if (!this.externalCalendarService) return;
		if (this.settings.externalCalendars.length === 0) {
			new Notice(t('notifications', 'externalCalendarsNoneConfigured'));
			return;
		}
		new Notice(t('notifications', 'externalCalendarsSyncStarted'));
		await this.externalCalendarService.applySettings(this.settings.externalCalendars);
		const result = await this.externalCalendarService.syncAllNow();
		if (result.synced === 0 && result.failed === 0 && result.skipped > 0) {
			new Notice(t('notifications', 'externalCalendarSyncSkipped'));
			return;
		}
		new Notice(t('notifications', 'externalCalendarsSyncComplete', {
			synced: String(result.synced),
			failed: String(result.failed),
			skipped: String(result.skipped),
		}));
		this.refreshViews();
	}

	private async runOperonDocsOperation<T>(operation: () => Promise<T>): Promise<T> {
		const run = this.operonDocsOperationQueue.then(operation);
		this.operonDocsOperationQueue = run.then(() => undefined, () => undefined);
		return run;
	}

	private async syncOperonDocsNow(source: 'manual' | 'auto' = 'manual'): Promise<OperonDocsSyncResult | null> {
		if (this.operonDocsSyncInFlight) {
			if (source === 'manual') {
				new Notice(t('notifications', 'operonDocsSyncAlreadyRunning'));
			}
			return this.operonDocsSyncInFlight.catch(() => null);
		}
		return this.runOperonDocsOperation(() => this.syncOperonDocsNowUnlocked(source));
	}

	private async syncOperonDocsNowUnlocked(source: 'manual' | 'auto' = 'manual'): Promise<OperonDocsSyncResult | null> {
		if (this.operonDocsSyncInFlight) {
			if (source === 'manual') {
				new Notice(t('notifications', 'operonDocsSyncAlreadyRunning'));
			}
			return this.operonDocsSyncInFlight.catch(() => null);
		}
		if (source === 'manual') {
			new Notice(t('notifications', 'operonDocsSyncStarted'));
		}
		const syncPromise = syncOperonDocs({
			app: this.app,
			pluginId: this.manifest.id,
			keyMappings: this.settings.keyMappings,
			targetRoot: this.settings.operonDocsFolder,
			requestText: url => this.requestOperonDocsText(url),
		});
		this.operonDocsSyncInFlight = syncPromise;
		try {
			const result = await syncPromise;
			this.showOperonDocsSyncResult(result, source);
			return result;
		} catch (error) {
			console.error('Operon docs sync failed', error);
			new Notice(t('notifications', 'operonDocsSyncFailed'));
			return null;
		} finally {
			if (this.operonDocsSyncInFlight === syncPromise) {
				this.operonDocsSyncInFlight = null;
			}
		}
	}

	private async requestOperonDocsText(url: string): Promise<string> {
		const response = await requestUrl({
			url,
			throw: false,
		});
		if (response.status < 200 || response.status >= 300) {
			throw new Error(`HTTP ${response.status}`);
		}
		return response.text;
	}

	private showOperonDocsSyncResult(result: OperonDocsSyncResult, source: 'manual' | 'auto'): void {
		if (result.written.length === 0 && result.staleManagedFiles.length === 0 && result.warnings.length === 0) {
			if (source === 'auto') return;
			new Notice(t('notifications', 'operonDocsSyncUpToDate'));
			return;
		}
		new Notice(t('notifications', 'operonDocsSyncComplete', {
			written: String(result.written.length),
			skipped: String(result.skipped.length),
			stale: String(result.staleManagedFiles.length),
			warnings: String(result.warnings.length),
		}));
	}

	private maybeSyncOperonDocsAfterPluginUpdate(): void {
		if (!this.settings.operonDocsAutoUpdateEnabled) return;
		const currentVersion = this.manifest.version.trim();
		if (!currentVersion || this.settings.operonDocsLastAutoUpdateVersion === currentVersion) return;
		runAsyncAction('operon docs auto update failed', async () => {
			const result = await this.syncOperonDocsNow('auto');
			if (!result) return;
			await this.markOperonDocsAutoUpdateVersion(currentVersion);
		});
	}

	private async syncOperonDocsFromSettings(): Promise<void> {
		const result = await this.syncOperonDocsNow('manual');
		if (!result || !this.settings.operonDocsAutoUpdateEnabled) return;
		await this.markOperonDocsAutoUpdateVersion(this.manifest.version.trim());
	}

	private async changeOperonDocsFolder(requestedFolder: string): Promise<boolean> {
		return this.runOperonDocsOperation(() => this.changeOperonDocsFolderUnlocked(requestedFolder));
	}

	private async changeOperonDocsFolderUnlocked(requestedFolder: string): Promise<boolean> {
		const nextFolder = requestedFolder.trim().replace(/^\/+|\/+$/gu, '');
		const currentFolder = this.settings.operonDocsFolder;
		if (!nextFolder || nextFolder === currentFolder) return nextFolder === currentFolder;

		const folder = this.app.vault.getAbstractFileByPath(nextFolder);
		if (!(folder instanceof TFolder) || !folder.path || folder.path === '/') {
			new Notice(t('notifications', 'operonDocsFolderInvalid'));
			return false;
		}

		let preview: OperonDocsFolderMovePreview;
		try {
			preview = await previewOperonDocsFolderMove({
				app: this.app,
				pluginId: this.manifest.id,
				oldRoot: currentFolder,
				newRoot: folder.path,
			});
		} catch (error) {
			console.error('Operon docs folder preview failed', error);
			new Notice(t('notifications', 'operonDocsFolderMoveFailed'));
			return false;
		}

		if (preview.files.length === 0) {
			try {
				await this.storage.updateSettings({ operonDocsFolder: folder.path });
				this.handleSettingsChanged();
				return true;
			} catch (error) {
				console.error('Operon docs folder save failed', error);
				new Notice(t('notifications', 'operonDocsFolderMoveFailed'));
				return false;
			}
		}

		const confirmed = await this.confirmOperonDocsFolderMove(preview);
		if (!confirmed) return false;

		try {
			const transaction = await moveOperonDocsFolder({ app: this.app }, preview);
			try {
				await this.storage.updateSettings({ operonDocsFolder: folder.path });
				this.handleSettingsChanged();
				new Notice(t('notifications', 'operonDocsFolderMoveComplete', { count: String(transaction.movedFiles.length) }));
				return true;
			} catch (error) {
				try {
					await transaction.rollback();
				} catch (rollbackError) {
					console.error('Operon docs folder setting rollback failed', rollbackError);
				}
				throw error;
			}
		} catch (error) {
			console.error('Operon docs folder move failed', error);
			new Notice(t('notifications', 'operonDocsFolderMoveFailed'));
			return false;
		}
	}

	private confirmOperonDocsFolderMove(preview: OperonDocsFolderMovePreview): Promise<boolean> {
		return new Promise(resolve => {
			new ConfirmActionModal(this.app, {
				title: t('settings', 'operonDocsFolderMoveTitle'),
				message: t('settings', 'operonDocsFolderMoveMessage', { count: String(preview.files.length) }),
				confirmText: t('settings', 'operonDocsFolderMoveConfirm'),
				cancelText: t('buttons', 'cancel'),
				detailsTable: [{
					label: t('settings', 'operonDocsFolder'),
					before: preview.oldRoot,
					after: preview.newRoot,
				}],
			}, resolve).open();
		});
	}

	private async markOperonDocsAutoUpdateVersion(version: string): Promise<void> {
		if (!version || this.settings.operonDocsLastAutoUpdateVersion === version) return;
		this.settings.operonDocsLastAutoUpdateVersion = version;
		await this.storage.saveSettings();
	}

	private flushPendingCalendarRefresh(): void {
		if (!this.pendingCalendarRefresh) return;
		if (this.shouldFreezeCalendarRefresh()) return;
		this.pendingCalendarRefresh = false;
		this.refreshCalendarLeaves();
	}

	private flushPendingKanbanRefresh(): void {
		if (!this.pendingKanbanRefresh) return;
		if (this.shouldFreezeKanbanRefresh()) return;
		this.pendingKanbanRefresh = false;
		this.refreshKanbanLeaves();
	}

	private getFilterViewLeafStateId(leaf: import('obsidian').WorkspaceLeaf): string | null {
		if (leaf.view.getViewType() !== FILTER_VIEW_TYPE) return null;

		const viewId = readViewStateString(leaf.view, 'filterSetId');
		if (viewId) {
			return this.resolvePreferredFilterSetId(viewId);
		}

		const leafState = leaf.getViewState().state as { filterSetId?: string | null } | undefined;
		const directId = typeof leafState?.filterSetId === 'string' ? leafState.filterSetId : null;
		return this.resolvePreferredFilterSetId(directId);
	}

	private getCalendarLeafPresetId(leaf: import('obsidian').WorkspaceLeaf): string | null {
		if (leaf.view.getViewType() !== CALENDAR_VIEW_TYPE) return null;

		const viewId = readViewStateString(leaf.view, 'presetId');
		if (viewId && this.settings.calendarPresets.some(preset => preset.id === viewId)) return viewId;

		const leafState = leaf.getViewState().state as { presetId?: string | null } | undefined;
		const directId = typeof leafState?.presetId === 'string' ? leafState.presetId : null;
		return directId && this.settings.calendarPresets.some(preset => preset.id === directId)
			? directId
			: null;
	}

	private getCalendarFilterSetForLeaf(leaf: import('obsidian').WorkspaceLeaf): FilterSet | null {
		const presetId = this.getCalendarLeafPresetId(leaf);
		if (!presetId) return null;
		const filterSetId = this.settings.calendarPresets.find(preset => preset.id === presetId)?.filterSetId ?? null;
		const filterSet = filterSetId
			? this.settings.filterSets.find(filterSet => filterSet.id === filterSetId) ?? null
			: null;
		return filterSet && !isSpecialDynamicFilterSet(filterSet) ? filterSet : null;
	}

	private getKanbanLeafPresetId(leaf: import('obsidian').WorkspaceLeaf): string | null {
		if (leaf.view.getViewType() !== KANBAN_VIEW_TYPE) return null;

		const viewId = readViewStateString(leaf.view, 'presetId');
		if (viewId && this.settings.kanbanPresets.some(preset => preset.id === viewId)) return viewId;

		const leafState = leaf.getViewState().state as { presetId?: string | null } | undefined;
		const directId = typeof leafState?.presetId === 'string' ? leafState.presetId : null;
		return directId && this.settings.kanbanPresets.some(preset => preset.id === directId)
			? directId
			: null;
	}

	private getKanbanPresetForLeaf(leaf: import('obsidian').WorkspaceLeaf) {
		const presetId = this.getKanbanLeafPresetId(leaf);
		if (!presetId) return null;
		return this.settings.kanbanPresets.find(preset => preset.id === presetId) ?? null;
	}

	async openFilterViewById(filterSetId: string | null | undefined): Promise<void> {
		const resolvedFilterSetId = this.resolvePreferredFilterSetId(filterSetId);
		const leaf = this.app.workspace.getLeaf('tab');
		if (!leaf) return;

		await leaf.setViewState({
			type: FILTER_VIEW_TYPE,
			active: true,
			state: resolvedFilterSetId ? { filterSetId: resolvedFilterSetId } : undefined,
		});
		await this.app.workspace.revealLeaf(leaf);
	}

	async openTimeSessionHistoryView(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(TIME_SESSION_HISTORY_VIEW_TYPE)[0];
		if (existing) {
			await existing.setViewState({ type: TIME_SESSION_HISTORY_VIEW_TYPE, active: true });
			this.refreshTimeSessionHistoryLeaves(true);
			await this.app.workspace.revealLeaf(existing);
			return;
		}

		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) return;

		await leaf.setViewState({ type: TIME_SESSION_HISTORY_VIEW_TYPE, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}

	async openFlowTimeView(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(FLOW_TIME_VIEW_TYPE)[0];
		if (existing) {
			await existing.setViewState({ type: FLOW_TIME_VIEW_TYPE, active: true });
			await this.app.workspace.revealLeaf(existing);
			return;
		}

		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) return;

		await leaf.setViewState({ type: FLOW_TIME_VIEW_TYPE, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}

	private async startTimerForTask(taskId: string, source: TrackerSource = 'command', startOverride?: string | null): Promise<boolean> {
		if (this.redirectDuplicateOperonIdAction(taskId)) return false;
		const alreadyRunning = this.timeTracker.isTimerRunning(taskId);
		const started = await this.timeTracker.start(taskId, source, startOverride);
		// A new start emits `state`, whose subscription refreshes these surfaces.
		// Preserve the explicit refresh only for the idempotent already-running path,
		// which returns without emitting another event.
		if (started && alreadyRunning) this.refreshTimerStateSurfaces();
		return started;
	}

	private async stopActiveTimer(reason: TrackerStopReason = 'manual'): Promise<boolean> {
		return await this.timeTracker.stop(reason);
	}

	private async startUnassignedTimer(source: TrackerSource = 'command'): Promise<boolean> {
		const alreadyUnassigned = this.timeTracker.getActiveState()?.isUnassigned === true;
		const started = await this.timeTracker.startUnassigned(source);
		if (started && alreadyUnassigned) this.refreshTimerStateSurfaces();
		return started;
	}

	private async toggleTimerForTask(taskId: string, source: TrackerSource = 'command'): Promise<boolean> {
		if (this.timeTracker.isTimerRunning(taskId)) {
			return await this.stopActiveTimer('manual');
		}
		return await this.startTimerForTask(taskId, source);
	}

	async openCalendarView(state?: Partial<CalendarLeafState>): Promise<void> {
		const leaf = this.app.workspace.getLeaf('tab');
		if (!leaf) return;

		const defaultPresetId = this.settings.calendarDefaultPresetId ?? this.settings.calendarPresets[0]?.id ?? null;
		const shouldOpenFinishedTaskPoolMode = state?.finishedTasksOpen === true;
		const nextState: CalendarLeafState = {
			presetId: typeof state?.presetId === 'string' && state.presetId.trim()
				? state.presetId
				: defaultPresetId,
			anchorDate: typeof state?.anchorDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(state.anchorDate)
				? state.anchorDate
				: localToday(),
			scrollMinutes: typeof state?.scrollMinutes === 'number' && Number.isFinite(state.scrollMinutes)
				? Math.max(0, Math.min(24 * 60, Math.round(state.scrollMinutes)))
				: this.settings.calendarDefaultScrollHour * 60,
			filterSetId: typeof state?.filterSetId === 'string' && state.filterSetId.trim().length > 0
				? state.filterSetId
				: null,
			navigationMode: state?.navigationMode === 'toolbar' ? 'toolbar' : 'sidebar',
			calendarsOpen: typeof state?.calendarsOpen === 'boolean'
				? state.calendarsOpen
				: this.settings.calendarSidebarCalendarsDefaultExpanded,
			taskPoolOpen: shouldOpenFinishedTaskPoolMode
				? true
				: (typeof state?.taskPoolOpen === 'boolean'
					? state.taskPoolOpen
					: this.settings.calendarSidebarTaskPoolDefaultExpanded),
			taskPoolMode: shouldOpenFinishedTaskPoolMode
				? 'finished'
				: normalizeCalendarSidebarTaskPoolMode(state?.taskPoolMode),
			finishedTasksOpen: false,
			showAllDayLane: typeof state?.showAllDayLane === 'boolean'
				? state.showAllDayLane
				: this.settings.calendarShowAllDayLane,
			showDueMarkers: typeof state?.showDueMarkers === 'boolean'
				? state.showDueMarkers
				: this.settings.calendarShowDueMarkers,
			showInDayLane: typeof state?.showInDayLane === 'boolean'
				? state.showInDayLane
				: true,
			showFinishedLane: typeof state?.showFinishedLane === 'boolean'
				? state.showFinishedLane
				: true,
			mobileViewMode: state?.mobileViewMode ?? this.settings.calendarMobileDefaultView,
			mobileSourcePresetId: typeof state?.mobileSourcePresetId === 'string' && state.mobileSourcePresetId.trim()
				? state.mobileSourcePresetId
				: this.settings.calendarMobileDefaultSourcePresetId ?? defaultPresetId,
			mobileAnchorDate: typeof state?.mobileAnchorDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(state.mobileAnchorDate)
				? state.mobileAnchorDate
				: localToday(),
		};

		await leaf.setViewState({
			type: CALENDAR_VIEW_TYPE,
			active: true,
			state: nextState as unknown as Record<string, unknown>,
		});
		await this.app.workspace.revealLeaf(leaf);
	}

	async openKanbanView(state?: Partial<KanbanLeafState>): Promise<void> {
		const leaf = this.app.workspace.getLeaf('tab');
		if (!leaf) return;

		const availablePresetIds = this.settings.kanbanPresets.map(preset => preset.id);
		const fallbackPresetId = this.settings.kanbanDefaultPresetId ?? this.settings.kanbanPresets[0]?.id ?? null;
		const requestedPresetId = typeof state?.presetId === 'string' && state.presetId.trim()
			? state.presetId
			: fallbackPresetId;
		const preset = this.settings.kanbanPresets.find(entry => entry.id === requestedPresetId)
			?? this.settings.kanbanPresets.find(entry => entry.id === fallbackPresetId)
			?? this.settings.kanbanPresets[0]
			?? null;
		const pipeline = preset?.pipelineId
			? this.settings.pipelines.find(entry => entry.id === preset.pipelineId) ?? null
			: null;
		const nextState = normalizeKanbanLeafState(state, {
			availablePresetIds,
			availableStatusIds: pipeline?.statuses.map(status => status.id) ?? [],
			defaultPresetId: fallbackPresetId,
			statusCollapseScopeKey: buildKanbanStatusCollapseScopeKey(preset?.id ?? null, preset?.pipelineId ?? null),
			laneCollapseScopeKey: buildKanbanLaneCollapseScopeKey(preset?.id ?? null, preset?.pipelineId ?? null, preset?.swimlaneBy ?? null),
		});

		await leaf.setViewState({
			type: KANBAN_VIEW_TYPE,
			active: true,
			state: nextState as unknown as Record<string, unknown>,
		});
		await this.app.workspace.revealLeaf(leaf);
	}

	async openOperonTable(state?: Partial<TableLeafState>): Promise<void> {
		const leaf = this.app.workspace.getLeaf('tab');
		if (!leaf) return;

		const availablePresetIds = this.settings.tablePresets.map(preset => preset.id);
		const fallbackPresetId = this.settings.tableDefaultPresetId && availablePresetIds.includes(this.settings.tableDefaultPresetId)
			? this.settings.tableDefaultPresetId
			: availablePresetIds[0] ?? null;
		const requestedPresetId = typeof state?.presetId === 'string' && availablePresetIds.includes(state.presetId)
			? state.presetId
			: fallbackPresetId;
		const nextState: TableLeafState = {
			presetId: requestedPresetId,
			searchQuery: typeof state?.searchQuery === 'string' ? state.searchQuery : '',
			scrollTop: typeof state?.scrollTop === 'number' && Number.isFinite(state.scrollTop)
				? Math.max(0, state.scrollTop)
				: 0,
			scrollLeft: typeof state?.scrollLeft === 'number' && Number.isFinite(state.scrollLeft)
				? Math.max(0, state.scrollLeft)
				: 0,
		};

		await leaf.setViewState({
			type: OPERON_TABLE_VIEW_TYPE,
			active: true,
			state: nextState as unknown as Record<string, unknown>,
		});
		await this.app.workspace.revealLeaf(leaf);
	}

	private resolveDefaultTableEmbedPreset(): TablePreset | null {
		const availablePresets = this.settings.tablePresets;
		const defaultPresetId = this.settings.tableDefaultPresetId;
		return defaultPresetId
			? availablePresets.find(preset => preset.id === defaultPresetId) ?? availablePresets[0] ?? null
			: availablePresets[0] ?? null;
	}

	private insertOperonTableEmbedAtCursor(editor: Editor, view: MarkdownView): void {
		if (!view.file) {
			new Notice(t('notifications', 'noActiveFile'));
			return;
		}

		const preset = this.resolveDefaultTableEmbedPreset();
		if (!preset) {
			new Notice(t('notifications', 'tablePresetsMissing'));
			return;
		}

		const selections = editor.listSelections();
		if (selections.length !== 1) {
			new Notice(t('notifications', 'singleCursorOrSelectionRequired'));
			return;
		}

		const embedCode = buildTableEmbedCode(preset.id);
		const selection = selections[0];
		const cursor = editor.getCursor();
		const range = editor.somethingSelected()
			? this.normalizeEditorSelection(selection)
			: { from: cursor, to: cursor };
		editor.replaceRange(embedCode, range.from, range.to);
		editor.setCursor(this.resolveInsertedTextEndPosition(range.from, embedCode));
		editor.focus();
		this.refreshMarkdownAfterInlineAuthoring(view.file.path);
	}

	private resolveInsertedTextEndPosition(start: EditorPosition, text: string): EditorPosition {
		const lines = text.split('\n');
		if (lines.length === 1) {
			return { line: start.line, ch: start.ch + lines[0].length };
		}
		const lastLine = lines[lines.length - 1] ?? '';
		return {
			line: start.line + lines.length - 1,
			ch: lastLine.length,
		};
	}

	private openTaskFinderModal(): void {
		openTaskFinder(
			this.app,
			this.indexer,
			() => this.settings,
			(operonId) => this.openEditorForId(operonId),
			{
				getProjectSerialDisplay: (operonId: string) => this.getProjectSerialDisplayForTask(operonId),
				onPersistDefaultScope: async (scope, selectedProjectId) => {
					this.settings.taskFinderDefaultScope = scope;
					this.settings.taskFinderSelectedProjectId = selectedProjectId;
					await this.storage.saveSettings();
				},
			},
		);
	}

	private openTaskWikilinkOverlayFinder(editor: Editor, view: MarkdownView): void {
		if (!view.file) {
			new Notice(t('notifications', 'noActiveFile'));
			return;
		}

		openTaskFinder(
			this.app,
			this.indexer,
			() => this.settings,
			(_operonId, task) => {
				const wikilink = this.buildTaskWikilinkOverlayTarget(task);
				if (!wikilink) {
					new Notice(t('notifications', 'taskWikilinkOverlayInsertFailed'));
					return;
				}
				insertTaskWikilinkOverlayLink(editor, wikilink);
				new Notice(t('notifications', 'taskWikilinkOverlayInserted'));
			},
			{
				initialScope: TASK_FINDER_SCOPE_TASK_WIKILINK_OVERLAY,
				getProjectSerialDisplay: (operonId: string) => this.getProjectSerialDisplayForTask(operonId),
			},
		);
	}

	onload(): void {
		runAsyncAction('plugin load failed', () => this.loadPlugin());
	}

	private publicMutationResult(
		ok: boolean,
		operonId: string | null,
		code: OperonPublicMutationResult['code'],
		message?: string,
	): OperonPublicMutationResult {
		return { ok, operonId, code, ...(message ? { message } : {}) };
	}

	private buildPublicApi(): OperonPublicApiV1 {
		return {
			version: OPERON_PUBLIC_API_VERSION,
			capabilities: () => ({
				ready: this.startupReady,
				adopt: this.startupReady,
				create: this.startupReady,
				update: this.startupReady,
				transition: this.startupReady,
				convert: this.startupReady,
				filterQuery: this.startupReady,
				relocate: this.startupReady,
			}),
			adoptInlineTask: input => this.publicAdoptInlineTask(input),
			createTask: input => this.publicCreateTask(input),
			updateTask: (operonId, input) => this.publicUpdateTask(operonId, input),
			transitionTask: (operonId, input) => this.publicTransitionTask(operonId, input),
			convertTask: (operonId, input) => this.publicConvertTask(operonId, input),
			queryFilterSet: input => this.publicQueryFilterSet(input),
			relocateTask: (operonId, input) => this.publicRelocateTask(operonId, input),
		};
	}

	private ensurePublicApiReady(): OperonPublicMutationResult | null {
		return this.startupReady
			? null
			: this.publicMutationResult(false, null, 'not-ready', 'Operon startup is not complete.');
	}

	private async publicAdoptInlineTask(
		input: OperonPublicAdoptInlineTaskInput,
	): Promise<OperonPublicMutationResult> {
		const notReady = this.ensurePublicApiReady();
		if (notReady) return notReady;
		if (!isOperonPublicAdoptInlineTaskInput(input)) {
			return this.publicMutationResult(false, null, 'invalid-input', 'Invalid adoption payload.');
		}
		const targetPath = normalizePath(input.targetPath?.trim() ?? '');
		if (!targetPath || !Number.isInteger(input.line) || input.line < 1) {
			return this.publicMutationResult(false, null, 'invalid-input', 'targetPath and a positive one-based line are required.');
		}
		if (!input.expectedLine || /[\r\n]/.test(input.expectedLine)) {
			return this.publicMutationResult(false, null, 'invalid-input', 'expectedLine must contain exactly one non-empty source line.');
		}
		const file = this.app.vault.getAbstractFileByPath(targetPath);
		if (!(file instanceof TFile) || file.extension.toLocaleLowerCase() !== 'md') {
			return this.publicMutationResult(false, null, 'not-found', `Markdown source file not found: ${targetPath}`);
		}
		if (isOperonExcludedPath(file.path, this.settings)) {
			return this.publicMutationResult(false, null, 'invalid-input', 'The adoption source is excluded from Operon indexing.');
		}
		const requestedStatusId = input.statusId?.trim() ?? '';
		const requestedStatusValue = requestedStatusId ? this.resolvePublicStatusValueById(requestedStatusId) : '';
		const requestedWorkflow = requestedStatusValue
			? resolveWorkflowStatus(this.settings.pipelines, requestedStatusValue)
			: null;
		if (requestedStatusId && !requestedWorkflow) {
			return this.publicMutationResult(false, null, 'invalid-input', `Unknown workflow status id: ${requestedStatusId}`);
		}

		const lineNumber = input.line - 1;
		const adoptionState: {
			operonId: string | null;
			outcome: 'pending' | 'applied' | 'conflict' | 'invalid';
			message: string;
		} = { operonId: null, outcome: 'pending', message: '' };
		try {
			await this.app.vault.process(file, content => {
				const lines = content.split('\n');
				const currentLine = lines[lineNumber];
				if (currentLine === undefined) {
					adoptionState.outcome = 'conflict';
					adoptionState.message = `Source line no longer exists: ${input.line}`;
					return content;
				}
				const normalizedCurrentLine = currentLine.endsWith('\r') ? currentLine.slice(0, -1) : currentLine;
				const sourceIndent = normalizedCurrentLine.match(/^\s*/u)?.[0] ?? '';
				if (normalizedCurrentLine !== input.expectedLine) {
					adoptionState.outcome = 'conflict';
					adoptionState.message = 'expectedLine does not match the live source line.';
					return content;
				}

				const now = localNow();
				const inherited = this.resolveInlineTaskInheritedFields(file);
				const tasksEmojiConversion = convertTasksEmojiLineToOperon(normalizedCurrentLine, {
					priorities: this.settings.priorities ?? DEFAULT_PRIORITIES,
				});
				let parsed: ParsedTask | null = null;
				if (tasksEmojiConversion.kind === 'converted') {
					const provisionalTaskLine = this.buildNewInlineTaskWithInheritedFields(
						tasksEmojiConversion.description,
						tasksEmojiConversion.checkbox,
						inherited,
						now,
						targetPath,
						lineNumber,
					);
					parsed = this.parseInlineTaskLine(provisionalTaskLine, lineNumber, targetPath);
					if (parsed?.operonId) {
						const previousFieldValues = this.getParsedTaskFieldValues(parsed);
						const applied = applyTasksEmojiConversionToParsedTask({
							task: parsed,
							tags: tasksEmojiConversion.tags,
							mappedFields: tasksEmojiConversion.mappedFields,
							leftovers: tasksEmojiConversion.leftovers,
							previousFieldValues,
							pipelines: this.settings.pipelines,
							defaultPipelineName: this.settings.defaultPipelineName,
							defaultPriority: this.settings.defaultPriority,
							repeatSeriesIdFactory: this.createRepeatSeriesIdFactory(),
						});
						if (!applied.ok) {
							parsed = null;
							adoptionState.message = applied.errorMessage ?? 'Tasks metadata conversion failed.';
						}
					}
				} else if (tasksEmojiConversion.kind === 'already_operon') {
					adoptionState.outcome = 'conflict';
					adoptionState.message = 'The source line is already an Operon task.';
					return content;
				} else if (tasksEmojiConversion.kind === 'hybrid_unsupported') {
					adoptionState.outcome = 'invalid';
					adoptionState.message = 'The source line mixes Operon and unsupported Tasks metadata.';
					return content;
				} else {
					parsed = this.parseInlineTaskLine(normalizedCurrentLine, lineNumber, targetPath);
					if (parsed && !parsed.operonId && parsed.fields.length === 0) {
						const generatedOperonId = generateOperonId();
						this.setParsedTaskField(parsed, 'operonId', generatedOperonId, 'text');
						// setParsedTaskField mutates the serialized fields, while the parsed identity
						// remains a separate property until the line is reparsed.
						parsed.operonId = generatedOperonId;
						this.normalizeParsedTaskCreatedTimestamp(parsed, now);
						this.applyInheritedSubtaskFields(parsed, inherited);
					}
				}

				if (!parsed?.operonId) {
					adoptionState.outcome = 'invalid';
					adoptionState.message ||= 'The source line is not an adoptable plain Markdown or Tasks checkbox.';
					return content;
				}
				if (requestedWorkflow) {
					parsed.checkbox = requestedWorkflow.checkbox;
					this.setParsedTaskField(parsed, 'status', requestedWorkflow.value, 'text');
				}
				this.touchParsedTaskModifiedTimestamp(parsed, now);
				adoptionState.operonId = parsed.operonId;
				const serialized = this.serializeInlineTask(parsed).trimStart();
				lines[lineNumber] = `${sourceIndent}${serialized}${currentLine.endsWith('\r') ? '\r' : ''}`;
				adoptionState.outcome = 'applied';
				return lines.join('\n');
			});

			if (adoptionState.outcome === 'conflict') return this.publicMutationResult(false, null, 'conflict', adoptionState.message);
			if (adoptionState.outcome !== 'applied' || !adoptionState.operonId) {
				return this.publicMutationResult(false, null, 'invalid-input', adoptionState.message || 'Operon rejected checkbox adoption.');
			}
			await this.indexer.reindexFilePath(targetPath);
			this.refreshViews();
			const adopted = this.indexer.getTask(adoptionState.operonId);
			if (!adopted || adopted.primary.filePath !== targetPath || adopted.primary.lineNumber !== lineNumber) {
				let rolledBack = false;
				await this.app.vault.process(file, content => {
					const lines = content.split('\n');
					const currentLine = lines[lineNumber];
					if (currentLine === undefined) return content;
					const normalizedCurrentLine = currentLine.endsWith('\r') ? currentLine.slice(0, -1) : currentLine;
					if (this.parseInlineTaskLine(normalizedCurrentLine, lineNumber, targetPath)?.operonId !== adoptionState.operonId) {
						return content;
					}
					lines[lineNumber] = `${input.expectedLine}${currentLine.endsWith('\r') ? '\r' : ''}`;
					rolledBack = true;
					return lines.join('\n');
				}).catch(() => undefined);
				await this.indexer.reindexFilePath(targetPath).catch(() => undefined);
				return this.publicMutationResult(false, adoptionState.operonId, 'failed', rolledBack
					? 'The adopted task could not be proven in the final index; the source line was restored.'
					: 'The adopted task could not be proven and source rollback failed.');
			}
			const adoptedDraft = createEmptyTaskCreatorDraft();
			adoptedDraft.description = adopted.description;
			adoptedDraft.tags = [...adopted.tags];
			adoptedDraft.fieldValues = { ...adopted.fieldValues };
			adoptedDraft.explicitFieldKeys = Array.from(new Set([
				...Object.keys(adoptedDraft.fieldValues),
				...(adopted.tags.length > 0 ? ['tags'] : []),
			]));
			await this.finalizeTaskCreatorCreatedTask(
				adoptionState.operonId,
				adoptedDraft,
				adopted.fieldValues['parentTask'],
			);
			this.refreshViews();
			return this.publicMutationResult(true, adoptionState.operonId, 'applied');
		} catch (error) {
			return this.publicMutationResult(false, adoptionState.operonId, 'failed', error instanceof Error ? error.message : String(error));
		}
	}

	private async publicCreateTask(input: OperonPublicCreateTaskInput): Promise<OperonPublicMutationResult> {
		const notReady = this.ensurePublicApiReady();
		if (notReady) return notReady;
		if (!isOperonPublicCreateTaskInput(input)) {
			return this.publicMutationResult(false, null, 'invalid-input', 'Invalid task creation payload.');
		}
		const description = this.normalizeTaskCreatorText(input.description);
		if (!description) return this.publicMutationResult(false, null, 'invalid-input', 'Description is required.');
		const unsupportedFields = Object.keys(input.fields ?? {}).filter(key => (
			key !== 'status' && !isPublicManagedFieldWritable(
				key,
				this.settings.keyMappings,
				candidate => isEditableTableTaskFieldKey(candidate, this.settings),
			)
		));
		if (unsupportedFields.length > 0) {
			return this.publicMutationResult(
				false,
				null,
				'invalid-input',
				`Unmanaged fields must be supplied through properties: ${unsupportedFields.join(', ')}`,
			);
		}
		const requestedParentTaskId = input.fields?.parentTask?.trim() ?? '';
		if (requestedParentTaskId && !this.indexer.getTask(requestedParentTaskId)) {
			return this.publicMutationResult(false, null, 'invalid-input', `Parent task not found: ${requestedParentTaskId}`);
		}
		if (input.source === 'inline' && input.properties && Object.keys(input.properties).length > 0) {
			return this.publicMutationResult(false, null, 'invalid-input', 'Unmanaged properties are supported only for file tasks.');
		}
		if (input.source === 'inline' && input.targetFolder?.trim()) {
			return this.publicMutationResult(false, null, 'invalid-input', 'targetFolder is supported only for file tasks.');
		}
		if (input.source === 'inline' && input.targetPath?.trim()
			&& isOperonExcludedPath(input.targetPath.trim(), this.settings)) {
			return this.publicMutationResult(false, null, 'invalid-input', 'targetPath is excluded from Operon indexing.');
		}
		if (input.source === 'file' && input.targetFolder?.trim()
			&& isOperonExcludedPath(normalizePath(input.targetFolder.trim()), this.settings)) {
			return this.publicMutationResult(false, null, 'invalid-input', 'targetFolder is excluded from Operon indexing.');
		}
		if (input.source === 'file' && input.targetPath?.trim()) {
			return this.publicMutationResult(false, null, 'invalid-input', 'targetPath is supported only for inline tasks.');
		}
		if (input.statusId?.trim() && input.fields?.status?.trim()) {
			return this.publicMutationResult(false, null, 'invalid-input', 'Provide at most one of fields.status or statusId.');
		}
		const unsupportedProperty = Object.entries(input.properties ?? {}).find(([propertyName, value]) => (
			!isWritableRawYamlPropertyName(propertyName, this.settings.keyMappings)
			|| !isSupportedRawYamlPropertyValue(value)
		));
		if (unsupportedProperty) {
			return this.publicMutationResult(false, null, 'invalid-input', `Unsupported unmanaged property: ${unsupportedProperty[0]}`);
		}
		const requestedStatusId = input.statusId?.trim() ?? '';
		const requestedStatusValue = input.fields?.status?.trim()
			|| (requestedStatusId ? this.resolvePublicStatusValueById(requestedStatusId) : '');
		if (requestedStatusId && !requestedStatusValue) {
			return this.publicMutationResult(false, null, 'invalid-input', `Unknown workflow status id: ${requestedStatusId}`);
		}
		if (requestedStatusValue && !resolveWorkflowStatus(this.settings.pipelines, requestedStatusValue)) {
			return this.publicMutationResult(false, null, 'invalid-input', `Unknown workflow status: ${requestedStatusValue}`);
		}

		const draft = createEmptyTaskCreatorDraft();
		draft.description = description;
		draft.tags = Array.from(new Set((input.tags ?? [])
			.map(tag => tag.replace(/^#/, '').trim())
			.filter(Boolean)));
		draft.fieldValues = Object.fromEntries(
			Object.entries(input.fields ?? {})
				.map(([key, value]) => [key, String(value)]),
		);
		if (requestedParentTaskId) draft.fieldValues['parentTask'] = requestedParentTaskId;
		if (requestedStatusValue) draft.fieldValues['status'] = requestedStatusValue;
		draft.explicitFieldKeys = Array.from(new Set([
			...Object.keys(draft.fieldValues),
			...(input.tags ? ['tags'] : []),
		]));

		try {
			if (input.source === 'inline') {
				const created = await this.createInlineTaskFromCreatorDraftResult(draft, {
					targetDateKey: input.targetDateKey,
					targetPath: input.targetPath,
					forceDailyNote: Boolean(input.targetDateKey?.trim() && !input.targetPath?.trim()),
					parentAwarePlacement: input.targetPath?.trim() ? false : undefined,
				});
				if (!created) return this.publicMutationResult(false, null, 'rejected', 'Operon rejected inline task creation.');
				const createdFilePath = created.filePath;
				const createdLineNumber = created.lineNumber;
				if (!createdFilePath || createdLineNumber === undefined) {
					return this.publicMutationResult(false, created.operonId, 'failed', 'Inline task creation returned no source location.');
				}
				const indexedCreatedTask = this.indexer.getTask(created.operonId);
				const parentValidationError = indexedCreatedTask
					? this.getPublicParentTaskValidationError(indexedCreatedTask, indexedCreatedTask.fieldValues['parentTask'])
					: null;
				if (indexedCreatedTask?.primary.format !== 'inline'
					|| indexedCreatedTask.primary.filePath !== createdFilePath
					|| parentValidationError) {
					const rolledBack = await this.deleteInlineTaskById(
						createdFilePath,
						created.operonId,
						createdLineNumber,
					).catch(() => false);
					await this.indexer.reindexFilePath(createdFilePath).catch(() => undefined);
					return this.publicMutationResult(false, created.operonId, 'failed', rolledBack
						? parentValidationError
							? `Inline task creation was rolled back: ${parentValidationError}`
							: 'Inline task creation was rolled back because the task was not indexed.'
						: 'Inline task creation could not be proven and rollback failed.');
				}
				return this.publicMutationResult(true, created.operonId, 'applied');
			}

			const templateOptions = this.getFileTaskTemplateOptions();
			const templateId = input.fileTemplateId
				|| this.getAvailableTaskCreatorDefaultFileTemplateId()
				|| templateOptions[0]?.id
				|| '';
			if (!templateId) {
				return this.publicMutationResult(false, null, 'invalid-input', 'No file task template is available.');
			}
			draft.fileTemplateId = templateId;
			let createdOperonId: string | null = null;
			let createdFilePath: string | null = null;
			const created = await this.createFileTaskFromCreatorDraft(draft, {
				reopenCreator: () => {},
				targetFolderOverride: input.targetFolder?.trim() || null,
				rollbackOnFinalizeFailure: true,
				onCreated: result => {
					createdOperonId = (result.fieldValues['operonId'] ?? '').trim() || null;
					createdFilePath = result.file.path;
				},
			});
			if (!created || !createdOperonId) {
				return this.publicMutationResult(false, createdOperonId, 'rejected', 'Operon rejected file task creation.');
			}
			const indexedCreatedFileTask = this.indexer.getTask(createdOperonId);
			const parentValidationError = indexedCreatedFileTask
				? this.getPublicParentTaskValidationError(indexedCreatedFileTask, indexedCreatedFileTask.fieldValues['parentTask'])
				: null;
			if (!createdFilePath || indexedCreatedFileTask?.primary.format !== 'yaml'
				|| indexedCreatedFileTask.primary.filePath !== createdFilePath
				|| parentValidationError) {
				const rolledBack = createdFilePath
					? await this.deleteYamlTaskByPath(createdFilePath).catch(() => false)
					: false;
				return this.publicMutationResult(false, createdOperonId, 'failed', rolledBack
					? parentValidationError
						? `File task creation was rolled back: ${parentValidationError}`
						: 'File task creation was rolled back because the task was not indexed.'
					: 'File task creation could not be proven and rollback failed.');
			}
			if (input.properties && Object.keys(input.properties).length > 0) {
				for (const [propertyName, value] of Object.entries(input.properties)) {
					const updated = await this.publicUpdateTask(createdOperonId, { properties: { [propertyName]: value } });
					if (!updated.ok) {
						const rolledBack = createdFilePath
							? await this.deleteYamlTaskByPath(createdFilePath).catch(() => false)
							: false;
						return this.publicMutationResult(false, createdOperonId, 'failed', rolledBack
							? `File task creation was rolled back: ${updated.message ?? updated.code}`
							: `File task creation failed and rollback could not be proven: ${updated.message ?? updated.code}`);
					}
				}
			}
			return this.publicMutationResult(true, createdOperonId, 'applied');
		} catch (error) {
			return this.publicMutationResult(false, null, 'failed', error instanceof Error ? error.message : String(error));
		}
	}

	private async publicUpdateTask(
		operonId: string,
		input: OperonPublicUpdateTaskInput,
	): Promise<OperonPublicMutationResult> {
		const notReady = this.ensurePublicApiReady();
		if (notReady) return { ...notReady, operonId };
		if (typeof operonId !== 'string' || !operonId.trim() || !isOperonPublicUpdateTaskInput(input)) {
			return this.publicMutationResult(false, typeof operonId === 'string' ? operonId : null, 'invalid-input', 'Invalid task update payload.');
		}
		const task = this.indexer.getTask(operonId);
		if (!task) return this.publicMutationResult(false, operonId, 'not-found');
		const mutationGroups = [
			input.description !== undefined,
			input.fields !== undefined || input.tags !== undefined,
			input.properties !== undefined,
		].filter(Boolean).length;
		if (mutationGroups !== 1) {
			return this.publicMutationResult(
				false,
				operonId,
				'invalid-input',
				'Provide exactly one mutation group: description, managed fields/tags, or one unmanaged file property.',
			);
		}
		if (input.properties && Object.keys(input.properties).length !== 1) {
			return this.publicMutationResult(false, operonId, 'invalid-input', 'Update exactly one unmanaged file property per operation.');
		}

		const unsupportedFields: string[] = [];
		const fields = Object.fromEntries(
			Object.entries(input.fields ?? {})
				.filter(([key]) => {
					const supported = isPublicManagedFieldWritable(
						key,
						this.settings.keyMappings,
						candidate => isEditableTableTaskFieldKey(candidate, this.settings),
					);
					if (!supported) unsupportedFields.push(key);
					return supported;
				})
				.map(([key, value]) => [key, String(value)]),
		);
		if (unsupportedFields.length > 0) {
			return this.publicMutationResult(
				false,
				operonId,
				'invalid-input',
				`Unmanaged fields must be supplied through properties: ${unsupportedFields.join(', ')}`,
			);
		}
		if (Object.prototype.hasOwnProperty.call(fields, 'parentTask')) {
			const requestedParentTaskId = fields['parentTask']?.trim() ?? '';
			if (requestedParentTaskId) {
				const parentValidationError = this.getPublicParentTaskValidationError(task, requestedParentTaskId);
				if (parentValidationError) {
					return this.publicMutationResult(false, operonId, 'invalid-input', parentValidationError);
				}
				fields['parentTask'] = requestedParentTaskId;
			}
		}
		const payload: Record<string, string> = { ...fields };
		if (input.tags !== undefined) {
			payload['_tags'] = Array.from(new Set(input.tags
				.map(tag => tag.replace(/^#/, '').trim())
				.filter(Boolean))).join(';');
		}
		if (Object.keys(payload).length === 0 && input.description === undefined && input.properties === undefined) {
			return this.publicMutationResult(false, operonId, 'invalid-input', 'No supported field was provided.');
		}
		try {
			if (input.description !== undefined) {
				const description = this.normalizeTaskCreatorText(input.description);
				if (!description) return this.publicMutationResult(false, operonId, 'invalid-input', 'Description is required.');
				const descriptionTask = this.indexer.getTask(operonId);
				if (!descriptionTask || !await this.updateTableTaskDescriptionAndRefresh(descriptionTask, description)) {
					return this.publicMutationResult(false, operonId, 'rejected', 'Operon rejected the description update.');
				}
			}
			if (Object.keys(payload).length > 0 && !await this.updateTaskFieldsAndRefresh(operonId, payload, {
				changedKeys: Object.keys(payload),
			})) {
				return this.publicMutationResult(false, operonId, 'rejected');
			}
			if (input.properties !== undefined) {
				const propertyTask = this.indexer.getTask(operonId);
				if (!propertyTask || propertyTask.primary.format !== 'yaml') {
					return this.publicMutationResult(false, operonId, 'invalid-input', 'Unmanaged properties are supported only for file tasks.');
				}
				for (const [propertyName, value] of Object.entries(input.properties)) {
					if (!isWritableRawYamlPropertyName(propertyName, this.settings.keyMappings) || !isSupportedRawYamlPropertyValue(value)) {
						return this.publicMutationResult(false, operonId, 'invalid-input', `Unsupported unmanaged property: ${propertyName}`);
					}
					const latest = this.indexer.getTask(operonId);
					if (!latest || latest.primary.format !== 'yaml') return this.publicMutationResult(false, operonId, 'not-found');
					const file = this.app.vault.getAbstractFileByPath(latest.primary.filePath);
					if (!(file instanceof TFile)) return this.publicMutationResult(false, operonId, 'not-found');
					const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
					const expected = readRawYamlPropertyExpectation(frontmatter, propertyName);
					if (!expected) return this.publicMutationResult(false, operonId, 'rejected', `Current property value is unsupported: ${propertyName}`);
					const outcome = await this.updateTableFilePropertyAndRefresh(operonId, {
						propertyName,
						expected,
						mutation: { kind: 'set', value },
					});
					if (outcome !== 'updated' && outcome !== 'already-updated') {
						return this.publicMutationResult(false, operonId, 'rejected', `Property update ${propertyName} returned ${outcome}.`);
					}
				}
			}
			return this.publicMutationResult(true, operonId, 'applied');
		} catch (error) {
			return this.publicMutationResult(false, operonId, 'failed', error instanceof Error ? error.message : String(error));
		}
	}

	private getPublicParentTaskValidationError(task: IndexedTask, requestedParentTaskId: string | undefined): string | null {
		const normalizedParentTaskId = requestedParentTaskId?.trim() ?? '';
		if (!normalizedParentTaskId) return null;
		if (!this.indexer.getTask(normalizedParentTaskId)) return `Parent task not found: ${normalizedParentTaskId}`;
		const excludedParentTaskIds = new Set(getExcludedTablePickerTaskIds(
			'parentTask',
			task,
			this.indexer.getAllTasks(),
		));
		return excludedParentTaskIds.has(normalizedParentTaskId)
			? 'A task cannot use itself or one of its descendants as its parent.'
			: null;
	}

	private async publicTransitionTask(
		operonId: string,
		input: OperonPublicTransitionTaskInput,
	): Promise<OperonPublicMutationResult> {
		const notReady = this.ensurePublicApiReady();
		if (notReady) return { ...notReady, operonId };
		if (typeof operonId !== 'string' || !operonId.trim() || !isOperonPublicTransitionTaskInput(input)) {
			return this.publicMutationResult(false, typeof operonId === 'string' ? operonId : null, 'invalid-input', 'Invalid task transition payload.');
		}
		const task = this.indexer.getTask(operonId);
		if (!task) return this.publicMutationResult(false, operonId, 'not-found');
		const requestedStatus = input.status?.trim() ?? '';
		const requestedStatusId = input.statusId?.trim() ?? '';
		if ((!requestedStatus && !requestedStatusId) || (requestedStatus && requestedStatusId)) {
			return this.publicMutationResult(
				false,
				operonId,
				'invalid-input',
				'Provide exactly one of status or statusId.',
			);
		}
		const statusValue = requestedStatus || this.resolvePublicStatusValueById(requestedStatusId);
		if (!statusValue) {
			return this.publicMutationResult(false, operonId, 'invalid-input', `Unknown workflow status id: ${requestedStatusId}`);
		}
		const workflow = resolveWorkflowStatus(this.settings.pipelines, statusValue);
		if (!workflow) {
			return this.publicMutationResult(false, operonId, 'invalid-input', `Unknown workflow status: ${statusValue}`);
		}
		try {
			const now = localNow();
			const payload = this.buildStatusCycleFieldPayload(task, workflow, now, now.substring(0, 10));
			if (!await this.guardTaskStatusChangeOrShow(task, payload)) {
				return this.publicMutationResult(false, operonId, 'rejected');
			}
			const applyTransition = (fieldValues: Record<string, string>): Promise<boolean> =>
				this.updateTaskFieldsAndRefresh(operonId, fieldValues, {
					changedKeys: Object.keys(fieldValues),
					refreshReason: 'status-cycle',
				});
			let applied = false;
			if (workflow.checkbox !== 'open' && this.timeTracker.isTimerRunning(operonId)) {
				let attemptedCoalescedStop = false;
				await this.timeTracker.stopActiveWithExternalTaskMutation(operonId, now, async (timerPayload) => {
					attemptedCoalescedStop = true;
					applied = await applyTransition({ ...timerPayload, ...payload });
					return applied;
				});
				if (!attemptedCoalescedStop) {
					if (this.timeTracker.isTimerRunning(operonId)) {
						await this.stopActiveTimer('terminal-status');
					}
					applied = await applyTransition(payload);
				}
			} else {
				applied = await applyTransition(payload);
			}
			return applied
				? this.publicMutationResult(true, operonId, 'applied')
				: this.publicMutationResult(false, operonId, 'rejected');
		} catch (error) {
			return this.publicMutationResult(false, operonId, 'failed', error instanceof Error ? error.message : String(error));
		}
	}

	private resolvePublicStatusValueById(statusId: string): string {
		if (!statusId) return '';
		for (const pipeline of this.settings.pipelines) {
			const status = pipeline.statuses.find(candidate => candidate.id === statusId);
			if (status) return composeStatusValue(pipeline.name, status.label);
		}
		return '';
	}

	private async publicConvertTask(
		operonId: string,
		input: OperonPublicConvertTaskInput,
	): Promise<OperonPublicMutationResult> {
		const notReady = this.ensurePublicApiReady();
		if (notReady) return { ...notReady, operonId };
		if (typeof operonId !== 'string' || !operonId.trim() || !isOperonPublicConvertTaskInput(input)) {
			return this.publicMutationResult(false, typeof operonId === 'string' ? operonId : null, 'invalid-input', 'Invalid task conversion payload.');
		}
		const task = this.indexer.getTask(operonId);
		if (!task) return this.publicMutationResult(false, operonId, 'not-found');
		const currentSource = task.primary.format === 'yaml' ? 'file' : 'inline';
		if (currentSource === input.target) return this.publicMutationResult(true, operonId, 'applied');

		try {
			if (input.target === 'file') {
				const sourceFile = this.app.vault.getAbstractFileByPath(task.primary.filePath);
				if (!(sourceFile instanceof TFile)) return this.publicMutationResult(false, operonId, 'not-found');
				const targetFolder = this.getTargetFileTaskFolder(sourceFile, input.targetFolder?.trim() || null);
				if (targetFolder && isOperonExcludedPath(normalizePath(targetFolder), this.settings)) {
					return this.publicMutationResult(false, operonId, 'invalid-input', 'targetFolder is excluded from Operon indexing.');
				}
				const parsed = await this.loadEditableParsedTask(task);
				const options = this.getFileTaskTemplateOptions();
				const template = findFileTaskTemplateOptionById(
					options,
					input.fileTemplateId || this.getAvailableTaskCreatorDefaultFileTemplateId() || options[0]?.id || '',
				);
				if (!template) return this.publicMutationResult(false, operonId, 'invalid-input', 'No file task template is available.');
				await this.finishInlineTaskToFileTaskConversion(
					sourceFile,
					parsed,
					template,
					targetFolder,
				);
				const converted = this.indexer.getTask(operonId);
				return converted?.primary.format === 'yaml'
					? this.publicMutationResult(true, operonId, 'applied')
					: this.publicMutationResult(false, operonId, 'rejected');
			}

			const targetPath = input.targetPath?.trim();
			if (!targetPath) {
				return this.publicMutationResult(false, operonId, 'invalid-input', 'targetPath is required for file-to-inline conversion.');
			}
			const targetFile = this.app.vault.getAbstractFileByPath(targetPath);
			if (!(targetFile instanceof TFile) || targetFile.extension.toLowerCase() !== 'md'
				|| isOperonExcludedPath(targetFile.path, this.settings)
				|| targetFile.path === task.primary.filePath) {
				return this.publicMutationResult(false, operonId, 'invalid-input', 'targetPath must identify a different indexed Markdown file.');
			}
			const inlineTaskLine = this.formatConverter.yamlToInline(operonId);
			if (!inlineTaskLine?.trim()) return this.publicMutationResult(false, operonId, 'rejected');
			const inserted = await this.insertInlineTaskLineIntoFile(targetFile, inlineTaskLine);
			if (!inserted) return this.publicMutationResult(false, operonId, 'rejected');
			const rollbackInsertedInline = async (): Promise<boolean> => {
				const rolledBack = await this.deleteInlineTaskById(targetFile.path, operonId, inserted.lineNumber)
					.catch(() => false);
				await this.indexer.reindexFilePath(targetFile.path).catch(() => undefined);
				return rolledBack;
			};
			let transitioned: { lineNumber: number } | null = null;
			try {
				transitioned = await this.withFileTaskToInlineTransitionSafePass(
					operonId,
					task.primary.filePath,
					targetFile.path,
					inserted.lineNumber,
					async () => {
						await this.indexer.reindexFilePath(targetFile.path);
						return await this.deleteYamlTaskByPath(task.primary.filePath) ? inserted : null;
					},
				);
			} catch (error) {
				const rolledBack = await rollbackInsertedInline();
				return this.publicMutationResult(false, operonId, 'failed', rolledBack
					? `File-to-inline conversion was rolled back: ${error instanceof Error ? error.message : String(error)}`
					: 'File-to-inline conversion failed and duplicate rollback could not be proven.');
			}
			if (!transitioned) {
				const rolledBack = await rollbackInsertedInline();
				return this.publicMutationResult(false, operonId, rolledBack ? 'rejected' : 'failed', rolledBack
					? 'Operon rejected file-to-inline conversion; the inserted inline copy was removed.'
					: 'Operon rejected file-to-inline conversion and duplicate rollback could not be proven.');
			}
			this.refreshViews();
			return this.indexer.getTask(operonId)?.primary.format === 'inline'
				? this.publicMutationResult(true, operonId, 'applied')
				: this.publicMutationResult(false, operonId, 'rejected');
		} catch (error) {
			return this.publicMutationResult(false, operonId, 'failed', error instanceof Error ? error.message : String(error));
		}
	}


	private async publicQueryFilterSet(
		input: OperonPublicFilterQueryInput,
	): Promise<OperonPublicFilterQueryResult> {
		if (!this.startupReady) {
			return { ok: false, code: 'not-ready', operonIds: [], message: 'Operon startup is not complete.' };
		}
		if (!isOperonPublicFilterQueryInput(input) || !input.filterSetId.trim()) {
			return { ok: false, code: 'invalid-input', operonIds: [], message: 'A non-empty filterSetId is required.' };
		}
		const filterSet = getNormalFilterSets(this.settings.filterSets)
			.find(candidate => candidate.id === input.filterSetId.trim());
		if (!filterSet) {
			return { ok: false, code: 'not-found', operonIds: [], message: `Saved filter not found: ${input.filterSetId.trim()}` };
		}
		const rawScopePath = input.scopePath?.trim() ?? '';
		if (rawScopePath.split(/[\\/]+/u).some(segment => segment === '.' || segment === '..')) {
			return { ok: false, code: 'invalid-input', operonIds: [], message: 'scopePath cannot contain relative path segments.' };
		}
		const scopePath = rawScopePath ? normalizePath(rawScopePath).replace(/^\/+|\/+$/gu, '') : '';
		try {
			const allTasks = this.indexer.getAllTasks();
			const tasks = allTasks.filter(task => (
				!scopePath
				|| task.primary.filePath === scopePath
				|| task.primary.filePath.startsWith(`${scopePath}/`)
			));
			const matched = evaluateFilterSet(
				filterSet,
				tasks,
				this.settings.priorities,
				this.pinnedCache,
				this.settings.pipelines,
				buildOperonPublicFilterEvaluationOptions(
					allTasks,
					this.settings.projectSerialScopes,
					this.getTableFilePropertySnapshot(),
				),
			);
			return {
				ok: true,
				code: 'ok',
				operonIds: Array.from(new Set(matched.map(task => task.operonId))),
			};
		} catch (error) {
			return {
				ok: false,
				code: 'failed',
				operonIds: [],
				message: error instanceof Error ? error.message : String(error),
			};
		}
	}

	private async publicRelocateTask(
		operonId: string,
		input: OperonPublicRelocateTaskInput,
	): Promise<OperonPublicMutationResult> {
		const notReady = this.ensurePublicApiReady();
		if (notReady) return { ...notReady, operonId };
		if (typeof operonId !== 'string' || !operonId.trim() || !isOperonPublicRelocateTaskInput(input)) {
			return this.publicMutationResult(false, typeof operonId === 'string' ? operonId : null, 'invalid-input', 'Invalid task relocation payload.');
		}
		const task = this.indexer.getTask(operonId);
		if (!task) return this.publicMutationResult(false, operonId, 'not-found');
		if (task.primary.format !== 'inline') {
			return this.publicMutationResult(false, operonId, 'invalid-input', 'V1 relocation supports inline tasks only.');
		}
		const targetPathRaw = input.targetPath.trim();
		if (!targetPathRaw || targetPathRaw.split(/[\\/]+/u).some(segment => segment === '.' || segment === '..')) {
			return this.publicMutationResult(false, operonId, 'invalid-input', 'targetPath must be a canonical Markdown path.');
		}
		const targetPath = normalizePath(targetPathRaw);
		if (targetPath === task.primary.filePath) {
			return this.publicMutationResult(true, operonId, 'applied');
		}
		const sourceFile = this.app.vault.getAbstractFileByPath(task.primary.filePath);
		const targetFile = this.app.vault.getAbstractFileByPath(targetPath);
		if (!(sourceFile instanceof TFile) || !(targetFile instanceof TFile) || targetFile.extension.toLocaleLowerCase() !== 'md') {
			return this.publicMutationResult(false, operonId, 'not-found', 'Source or target Markdown file was not found.');
		}
		if (isOperonExcludedPath(targetFile.path, this.settings)) {
			return this.publicMutationResult(false, operonId, 'invalid-input', 'The relocation target is excluded from Operon indexing.');
		}

		const sourceContent = await this.app.vault.cachedRead(sourceFile);
		const sourceLines = sourceContent.split('\n');
		let sourceLineNumber = task.primary.lineNumber;
		if (this.parseInlineTaskLine(sourceLines[sourceLineNumber] ?? '', sourceLineNumber, sourceFile.path)?.operonId !== operonId) {
			sourceLineNumber = sourceLines.findIndex((line, index) => (
				this.parseInlineTaskLine(line, index, sourceFile.path)?.operonId === operonId
			));
		}
		if (sourceLineNumber < 0) {
			return this.publicMutationResult(false, operonId, 'conflict', 'The indexed source line no longer contains this task.');
		}
		const sourceLine = (sourceLines[sourceLineNumber] ?? '').replace(/\r$/u, '');
		let insertedLineNumber: number | null = null;
		let sourceDeleted = false;
		const removeTargetCopy = async (): Promise<boolean> => {
			if (insertedLineNumber === null) return true;
			const removed = await this.deleteInlineTaskById(targetFile.path, operonId, insertedLineNumber).catch(() => false);
			await this.indexer.reindexFilePath(targetFile.path).catch(() => undefined);
			return removed;
		};
		const restoreSource = async (): Promise<boolean> => {
			if (!sourceDeleted) return true;
			try {
				await this.app.vault.process(sourceFile, content => {
					const lines = content.split('\n');
					if (lines.some((line, index) => this.parseInlineTaskLine(line, index, sourceFile.path)?.operonId === operonId)) {
						return content;
					}
					lines.splice(Math.min(sourceLineNumber, lines.length), 0, sourceLine);
					return lines.join('\n');
				});
				await this.indexer.reindexFilePath(sourceFile.path);
				return this.indexer.getTask(operonId)?.primary.filePath === sourceFile.path;
			} catch {
				return false;
			}
		};

		try {
			const inserted = await this.insertInlineTaskLineIntoFile(targetFile, sourceLine);
			if (!inserted) return this.publicMutationResult(false, operonId, 'rejected', 'Operon rejected target insertion.');
			insertedLineNumber = inserted.lineNumber;
			await this.indexer.reindexFilePath(targetFile.path);
			sourceDeleted = await this.deleteInlineTaskById(sourceFile.path, operonId, sourceLineNumber);
			if (!sourceDeleted) {
				const targetRolledBack = await removeTargetCopy();
				return this.publicMutationResult(false, operonId, targetRolledBack ? 'conflict' : 'failed', targetRolledBack
					? 'The source changed before relocation; the target copy was removed.'
					: 'The source changed before relocation and target rollback could not be proven.');
			}
			await this.indexer.reindexFilePath(sourceFile.path);
			await this.indexer.reindexFilePath(targetFile.path);
			const relocated = this.indexer.getTask(operonId);
			if (relocated?.primary.format === 'inline' && relocated.primary.filePath === targetFile.path) {
				this.refreshViews();
				return this.publicMutationResult(true, operonId, 'applied');
			}
			const targetRolledBack = await removeTargetCopy();
			const sourceRestored = await restoreSource();
			return this.publicMutationResult(false, operonId, 'failed', targetRolledBack && sourceRestored
				? 'Relocation final-state verification failed; the source task was restored.'
				: 'Relocation final-state verification failed and rollback could not be proven.');
		} catch (error) {
			const targetRolledBack = await removeTargetCopy();
			const sourceRestored = await restoreSource();
			return this.publicMutationResult(false, operonId, 'failed', targetRolledBack && sourceRestored
				? `Relocation was rolled back: ${error instanceof Error ? error.message : String(error)}`
				: 'Relocation failed and rollback could not be proven.');
		}
	}

	private async initializeTablePresetRegistry(): Promise<void> {
		await this.executeTablePresetFileMigration({ notify: true, refreshRegistry: false });
		this.tablePresetRegistry = new TablePresetRegistry<TFile>({
			loadLegacyPresets: () => this.settings.tablePresetFileMigrationVersion < 1
				? this.storage.tablePresets.getAll().tablePresets
				: [],
			loadFileBindings: () => this.settings.tablePresetFileBindings.map(binding => ({ ...binding })),
			listTableFiles: () => this.app.vault.getFiles(),
			readTableFile: file => this.app.vault.read(file),
			applyPatch: (preset, patch) => applyTablePresetPatch(preset, patch),
			writeTableFile: (path, serialized, context) => this.writeCanonicalTableFile(path, serialized, context.baseFileContent),
		});
		this.tablePresetFileLifecycle = new TablePresetFileLifecycle(
			this.app,
			this.storage,
			this.tablePresetRegistry,
			{ receiptPath: this.storage.tablePresetFileMigrationReceiptPath },
		);
		try {
			this.tablePresetFileMigrationReceipt = await this.tablePresetFileLifecycle.reconcileFinalizedReceipt(
				this.settings.tablePresetFileMigrationFinalizedVersion,
			);
		} catch (error) {
			console.error('Operon: failed to load Table file migration receipt', error);
			this.tablePresetFileMigrationReceipt = null;
		}
		await this.refreshTablePresetRegistry({ adoptUnbound: true, persistBindings: true });
		this.registerTablePresetFileWatchers();
		this.register(() => {
			if (this.tablePresetRegistryRefreshTimer !== null) {
				clearWindowTimeout(this.tablePresetRegistryRefreshTimer);
				this.tablePresetRegistryRefreshTimer = null;
			}
			for (const unsubscribe of this.tablePresetRegistrySubscriptions.values()) unsubscribe();
			this.tablePresetRegistrySubscriptions.clear();
		});
	}

	private async executeTablePresetFileMigration(
		options: { notify: boolean; refreshRegistry: boolean },
	): Promise<TablePresetFileMigrationSummary | null> {
		if (this.tablePresetFileMigrationRunning) return this.tablePresetFileMigrationSummary;
		const wasComplete = this.settings.tablePresetFileMigrationVersion >= 1;
		this.tablePresetFileMigrationRunning = true;
		try {
			try {
				this.tablePresetFileMigrationSummary = await runTablePresetFileMigration(this.app, this.storage);
			} catch (error) {
				console.error('Operon: Table file migration failed before it could persist recovery state', error);
				this.tablePresetFileMigrationSummary = summarizeTablePresetFileMigrationJournal(
					this.storage.tablePresetFileMigrationJournal.get(),
					'failed',
				);
			}
		} finally {
			this.tablePresetFileMigrationRunning = false;
		}
		if (options.refreshRegistry && this.tablePresetRegistry) {
			await this.refreshTablePresetRegistry({ adoptUnbound: true, persistBindings: true });
		}
		this.settingsTab?.refreshTablePresetFileState();
		if (options.notify && !wasComplete && this.tablePresetFileMigrationSummary) {
			this.showTablePresetFileMigrationNotice(this.tablePresetFileMigrationSummary);
		}
		return this.tablePresetFileMigrationSummary;
	}

	private showTablePresetFileMigrationNotice(summary: TablePresetFileMigrationSummary): void {
		if (summary.status === 'completed') {
			new Notice(t('settings', 'tableFileMigrationCompletedNotice', {
				count: String(summary.migrated + summary.adopted + summary.alreadyMigrated),
			}));
			return;
		}
		if (summary.status === 'partial' || summary.status === 'failed') {
			new Notice(t('settings', 'tableFileMigrationNeedsReviewNotice', {
				count: String(summary.blocked + summary.failed),
			}), 8_000);
		}
	}

	private registerTablePresetFileWatchers(): void {
		this.registerEvent(this.app.vault.on('modify', file => {
			if (this.tablePresetFileMigrationRunning) return;
			if (!(file instanceof TFile) || !isOperonTableFilePath(file.path)) return;
			runAsyncAction('table file modify refresh failed', async () => {
				const source = await this.app.vault.read(file);
				const pathKey = getOperonTableFilePathKey(file.path);
				if (this.expectedTableFileModifyHashes.get(pathKey) === this.hashTableFileContent(source)) {
					this.expectedTableFileModifyHashes.delete(pathKey);
					return;
				}
				this.scheduleTablePresetRegistryRefresh();
			});
		}));
		this.registerEvent(this.app.vault.on('create', file => {
			if (this.tablePresetFileMigrationRunning) return;
			if (!(file instanceof TFile) || !isOperonTableFilePath(file.path)) return;
			runAsyncAction('table file create refresh failed', async () => {
				const source = await this.app.vault.read(file);
				const pathKey = getOperonTableFilePathKey(file.path);
				if (this.expectedTableFileModifyHashes.get(pathKey) === this.hashTableFileContent(source)) {
					this.expectedTableFileModifyHashes.delete(pathKey);
					return;
				}
				this.scheduleTablePresetRegistryRefresh();
			});
		}));
		this.registerEvent(this.app.vault.on('delete', file => {
			if (this.tablePresetFileMigrationRunning) return;
			if (!(file instanceof TFile) || !isOperonTableFilePath(file.path)) return;
			runAsyncAction('table file delete lifecycle failed', () => this.handleDeletedTableFile(file.path));
		}));
		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
			if (this.tablePresetFileMigrationRunning) return;
			if (!(file instanceof TFile) || (!isOperonTableFilePath(oldPath) && !isOperonTableFilePath(file.path))) return;
			runAsyncAction('table file rename synchronization failed', () => this.handleExternalTableFileRename(file, oldPath));
		}));
	}

	private async handleDeletedTableFile(path: string): Promise<void> {
		const pathKey = getOperonTableFilePathKey(path);
		const expectedPresetId = this.expectedTableFileDeletes.get(pathKey);
		if (expectedPresetId) {
			this.expectedTableFileDeletes.delete(pathKey);
			return;
		}
		const binding = this.settings.tablePresetFileBindings.find(candidate => getOperonTableFilePathKey(candidate.path) === pathKey);
		if (binding) this.tablePresetRegistry.cancelPatches(binding.id);
		this.closeTableFileLeavesForPath(path);
		if (!binding) {
			await this.refreshTablePresetRegistry({ adoptUnbound: true, persistBindings: true });
			return;
		}
		await new Promise<void>(resolve => window.setTimeout(resolve, 180));
		await this.refreshTablePresetRegistry({ adoptUnbound: true, persistBindings: true });
		this.refreshTablePresetSurfaces(binding.id);
		this.settingsTab?.refreshTablePresetFileState();
	}

	private closeTableFileLeavesForPath(path: string): void {
		const pathKey = getOperonTableFilePathKey(path);
		for (const leaf of this.app.workspace.getLeavesOfType(OPERON_TABLE_FILE_VIEW_TYPE)) {
			const file = leaf.view instanceof OperonTableView ? leaf.view.file : null;
			if (!file || getOperonTableFilePathKey(file.path) !== pathKey) continue;
			leaf.detach();
		}
	}

	private getTableWorkspaceLeavesForPreset(presetId: string): WorkspaceLeaf[] {
		const leaves: WorkspaceLeaf[] = [];
		for (const leaf of this.app.workspace.getLeavesOfType(OPERON_TABLE_VIEW_TYPE)) {
			if (!(leaf.view instanceof OperonTableView)) continue;
			if (leaf.view.getRequestedPresetId() === presetId) leaves.push(leaf);
		}
		return leaves;
	}

	private closeTableWorkspaceLeaves(presetId: string, leaves: readonly WorkspaceLeaf[]): void {
		const currentLeaves = new Set(this.app.workspace.getLeavesOfType(OPERON_TABLE_VIEW_TYPE));
		for (const leaf of leaves) {
			if (!currentLeaves.has(leaf) || !(leaf.view instanceof OperonTableView)) continue;
			if (leaf.view.getRequestedPresetId() === presetId) leaf.detach();
		}
	}

	private scheduleTablePresetRegistryRefresh(): void {
		if (this.tablePresetRegistryRefreshTimer !== null) clearWindowTimeout(this.tablePresetRegistryRefreshTimer);
		this.tablePresetRegistryRefreshTimer = setWindowTimeout(() => {
			this.tablePresetRegistryRefreshTimer = null;
			runAsyncAction('table preset registry refresh failed', () =>
				this.refreshTablePresetRegistry({ adoptUnbound: true, persistBindings: true })
			);
		}, 120);
	}

	private async refreshTablePresetRegistry(options: { adoptUnbound?: boolean; persistBindings?: boolean } = {}): Promise<void> {
		const previousSnapshot = this.tablePresetRegistry.getSnapshot();
		const previousOrderSignature = this.settings.tablePresetOrderIds.join('\u0000');
		await this.tablePresetRegistry.refresh();
		let bindingsChanged = false;
		for (const entry of this.tablePresetRegistry.getSnapshot().entries.values()) {
			if (entry.status !== 'available' || entry.source.kind !== 'table-file' || !entry.source.bound || !entry.source.path) continue;
			const binding = this.settings.tablePresetFileBindings.find(candidate => candidate.id === entry.id);
			if (!binding || getOperonTableFilePathKey(binding.path) === getOperonTableFilePathKey(entry.source.path)) continue;
			binding.path = entry.source.path;
			bindingsChanged = true;
		}
		if (options.adoptUnbound) {
			for (const entry of this.tablePresetRegistry.getSnapshot().entries.values()) {
				if (entry.status !== 'available' || !entry.preset || entry.source.kind !== 'table-file' || entry.source.bound || !entry.source.path) continue;
				if (this.settings.tablePresetFileBindings.some(binding => binding.id === entry.id)) continue;
				this.settings.tablePresetFileBindings.push({ id: entry.id, path: entry.source.path });
				bindingsChanged = true;
			}
		}
		if (bindingsChanged) await this.tablePresetRegistry.refresh();
		this.syncTablePresetProjectionFromRegistry();
		if (await this.reconcileBoundTableFileNames()) {
			await this.tablePresetRegistry.refresh();
			this.syncTablePresetProjectionFromRegistry();
		}
		const orderChanged = previousOrderSignature !== this.settings.tablePresetOrderIds.join('\u0000');
		if ((bindingsChanged || orderChanged) && options.persistBindings) await this.storage.saveSettings();
		const nextSnapshot = this.tablePresetRegistry.getSnapshot();
		const newlySubscribedIds = this.syncTablePresetRegistrySubscriptions();
		const changedPresetIds = new Set([...previousSnapshot.entries.keys(), ...nextSnapshot.entries.keys()]);
		for (const presetId of changedPresetIds) {
			if (this.getTablePresetRegistryEntrySignature(previousSnapshot.entries.get(presetId))
				=== this.getTablePresetRegistryEntrySignature(nextSnapshot.entries.get(presetId))) continue;
			if (newlySubscribedIds.has(presetId)) this.refreshTablePresetSurfaces(presetId);
		}
	}

	private syncTablePresetRegistrySubscriptions(): Set<string> {
		const presetIds = new Set(this.tablePresetRegistry.getSnapshot().entries.keys());
		for (const [presetId, unsubscribe] of this.tablePresetRegistrySubscriptions) {
			if (presetIds.has(presetId)) continue;
			unsubscribe();
			this.tablePresetRegistrySubscriptions.delete(presetId);
		}
		const subscribed = new Set<string>();
		for (const presetId of presetIds) {
			if (this.tablePresetRegistrySubscriptions.has(presetId)) continue;
			const unsubscribe = this.tablePresetRegistry.subscribe(presetId, entry => {
				this.syncTablePresetProjectionFromRegistry();
				this.refreshTablePresetSurfaces(presetId, entry);
				this.settingsTab?.refreshTablePresetFileState();
			}, false);
			this.tablePresetRegistrySubscriptions.set(presetId, unsubscribe);
			subscribed.add(presetId);
		}
		return subscribed;
	}

	private resolveTableFileForView(path: string, source: string): {
		preset: TablePreset | null;
		diagnostics: Array<{
			code: 'invalid-json' | 'invalid-root' | 'invalid-format' | 'unsupported-version' | 'missing-field' | 'invalid-field' | 'unknown-field' | 'read-failed' | 'duplicate-id';
			severity: 'error';
			message: string;
			path?: string;
			field?: string;
		}>;
	} {
		const parsed = parseOperonTableFile(source, path);
		if (parsed.status !== 'valid') return { preset: null, diagnostics: [...parsed.diagnostics] };
		const entry = this.tablePresetRegistry.get(parsed.preset.id);
		if (entry?.status !== 'conflict') {
			return { preset: this.tablePresetRegistry.projectFilePreset(path, parsed.preset), diagnostics: [] };
		}
		const conflictPaths = [...new Set(entry.conflicts.flatMap(conflict => conflict.paths))];
		return {
			preset: null,
			diagnostics: [{
				code: 'duplicate-id',
				severity: 'error',
				path,
				field: 'id',
				message: `Table preset id "${parsed.preset.id}" has an unresolved conflict across: ${conflictPaths.join(', ') || path}.`,
			}],
		};
	}

	private getTablePresetRegistryEntrySignature(entry: ReturnType<TablePresetRegistry<TFile>['get']> | undefined): string {
		if (!entry) return '';
		return JSON.stringify({
			status: entry.status,
			preset: entry.preset,
			source: { kind: entry.source.kind, path: entry.source.path, bound: entry.source.bound },
			conflicts: entry.conflicts,
		});
	}

	private syncTablePresetProjectionFromRegistry(): void {
		const snapshot = this.tablePresetRegistry.getSnapshot();
		const currentOrder = this.settings.tablePresetOrderIds;
		const availableById = new Map<string, TablePreset>();
		for (const entry of snapshot.entries.values()) {
			if (entry.status === 'available' && entry.preset) availableById.set(entry.id, entry.preset);
		}
		const nextOrder: string[] = [];
		const seen = new Set<string>();
		for (const id of currentOrder) {
			if (!snapshot.entries.has(id) || seen.has(id)) continue;
			nextOrder.push(id);
			seen.add(id);
		}
		const additions = [...snapshot.entries.values()]
			.filter(entry => !seen.has(entry.id))
			.sort((left, right) => {
				const leftPath = this.tablePresetRegistry.getPath(left.id) ?? left.preset?.name ?? left.id;
				const rightPath = this.tablePresetRegistry.getPath(right.id) ?? right.preset?.name ?? right.id;
				return leftPath.localeCompare(rightPath, 'en', { sensitivity: 'base' });
			});
		nextOrder.push(...additions.map(entry => entry.id));
		this.settings.tablePresetOrderIds = nextOrder;
		const next = nextOrder.flatMap(id => {
			const preset = availableById.get(id);
			return preset ? [cloneTablePreset(preset)] : [];
		});
		this.settings.tablePresets.splice(0, this.settings.tablePresets.length, ...next);
		if (this.settings.tableDefaultPresetId && !nextOrder.includes(this.settings.tableDefaultPresetId)) {
			this.settings.tableDefaultPresetId = this.resolveEffectiveTablePresetId();
		}
	}

	private resolveTablePresetForSurface(presetId: string): TablePreset | null {
		const registryEntry = this.tablePresetRegistry.get(presetId);
		if (registryEntry) {
			return registryEntry.status === 'available' && registryEntry.preset
				? cloneTablePreset(registryEntry.preset)
				: null;
		}
		const legacyPreset = this.settings.tablePresets.find(preset => preset.id === presetId);
		return legacyPreset ? cloneTablePreset(legacyPreset) : null;
	}

	private getTablePresetsForSurfaces(): TablePreset[] {
		const snapshot = this.tablePresetRegistry.getSnapshot();
		const availableById = new Map<string, TablePreset>();
		for (const entry of snapshot.entries.values()) {
			if (entry.status === 'available' && entry.preset) availableById.set(entry.id, entry.preset);
		}
		const ordered: TablePreset[] = [];
		const seen = new Set<string>();
		for (const presetId of this.settings.tablePresetOrderIds) {
			const preset = availableById.get(presetId);
			if (!preset || seen.has(presetId)) continue;
			ordered.push(cloneTablePreset(preset));
			seen.add(presetId);
		}
		for (const [presetId, preset] of availableById) {
			if (seen.has(presetId)) continue;
			ordered.push(cloneTablePreset(preset));
		}
		if (ordered.length > 0) return ordered;
		return snapshot.entries.size === 0 ? this.settings.tablePresets.map(cloneTablePreset) : [];
	}

	private resolveEffectiveTablePresetId(excludedPresetId?: string): string | null {
		const tablePresets = this.getTablePresetsForSurfaces();
		const availableIds = new Set(tablePresets.map(preset => preset.id));
		for (const presetId of this.settings.tablePresetOrderIds) {
			if (presetId !== excludedPresetId && availableIds.has(presetId)) return presetId;
		}
		return tablePresets.find(preset => preset.id !== excludedPresetId)?.id ?? null;
	}

	private async writeCanonicalTableFile(path: string, serialized: string, expectedSource?: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) throw new Error(`Table file not found: ${path}`);
		const previous = await this.app.vault.read(file);
		if (expectedSource !== undefined && previous !== expectedSource) {
			throw new Error(`Table file changed before save: ${path}`);
		}
		const parsed = parseOperonTableFile(serialized, path);
		if (parsed.status !== 'valid') throw new Error(`Refusing to write invalid Table file: ${path}`);
		this.expectedTableFileModifyHashes.set(getOperonTableFilePathKey(path), this.hashTableFileContent(serialized));
		try {
			await this.app.vault.modify(file, serialized);
		} catch (error) {
			this.expectedTableFileModifyHashes.delete(getOperonTableFilePathKey(path));
			throw error;
		}
		try {
			const verified = parseOperonTableFile(await this.app.vault.read(file), path);
			if (verified.status !== 'valid' || verified.preset.id !== parsed.preset.id) {
				throw new Error(`Table file verification failed: ${path}`);
			}
			const nextPath = this.resolveTableFilePathForName(file, parsed.preset.name);
			if (nextPath !== file.path) {
				await this.renameCanonicalTableFile(file, nextPath);
				await this.tablePresetRegistry.refresh();
				this.syncTablePresetProjectionFromRegistry();
			}
		} catch (error) {
			const currentFile = this.app.vault.getAbstractFileByPath(file.path);
			if (currentFile instanceof TFile && await this.app.vault.read(currentFile) === serialized) {
				this.expectedTableFileModifyHashes.set(getOperonTableFilePathKey(currentFile.path), this.hashTableFileContent(previous));
				await this.app.vault.modify(currentFile, previous);
			}
			throw error;
		}
	}

	private resolveTableFilePathForName(file: TFile, name: string): string {
		const folder = file.parent?.path ?? '';
		return buildUniqueOperonTableFilePath(
			folder,
			name,
			this.app.vault.getFiles().filter(candidate => candidate.path !== file.path).map(candidate => candidate.path),
		);
	}

	private async renameCanonicalTableFile(file: TFile, targetPath: string): Promise<void> {
		const oldPath = file.path;
		const binding = this.settings.tablePresetFileBindings.find(entry => getOperonTableFilePathKey(entry.path) === getOperonTableFilePathKey(oldPath));
		try {
			if (getOperonTableFilePathKey(oldPath) === getOperonTableFilePathKey(targetPath)) {
				const temporaryPath = buildUniqueOperonTableFilePath(file.parent?.path ?? '', '.operon-table-rename', this.app.vault.getFiles().map(candidate => candidate.path));
				this.expectedTableFileRenames.set(getOperonTableFilePathKey(oldPath), getOperonTableFilePathKey(temporaryPath));
				await this.app.fileManager.renameFile(file, temporaryPath);
				this.expectedTableFileRenames.set(getOperonTableFilePathKey(temporaryPath), getOperonTableFilePathKey(targetPath));
				await this.app.fileManager.renameFile(file, targetPath);
			} else {
				this.expectedTableFileRenames.set(getOperonTableFilePathKey(oldPath), getOperonTableFilePathKey(targetPath));
				await this.app.fileManager.renameFile(file, targetPath);
			}
			if (binding) {
				binding.path = targetPath;
				await this.storage.saveSettings();
			}
		} catch (error) {
			if (binding) binding.path = oldPath;
			if (file.path !== oldPath && !this.app.vault.getAbstractFileByPath(oldPath)) {
				this.expectedTableFileRenames.set(getOperonTableFilePathKey(file.path), getOperonTableFilePathKey(oldPath));
				await this.app.fileManager.renameFile(file, oldPath);
			}
			throw error;
		}
	}

	private async handleExternalTableFileRename(file: TFile, oldPath: string): Promise<void> {
		const expectedTarget = this.expectedTableFileRenames.get(getOperonTableFilePathKey(oldPath));
		if (expectedTarget === getOperonTableFilePathKey(file.path)) {
			this.expectedTableFileRenames.delete(getOperonTableFilePathKey(oldPath));
			return;
		}
		const binding = this.settings.tablePresetFileBindings.find(entry => getOperonTableFilePathKey(entry.path) === getOperonTableFilePathKey(oldPath));
		if (binding && !isOperonTableFilePath(file.path)) {
			this.tablePresetRegistry.cancelPatches(binding.id);
			this.closeTableFileLeavesForPath(oldPath);
			this.closeTableFileLeavesForPath(file.path);
			await this.refreshTablePresetRegistry({ adoptUnbound: true, persistBindings: true });
			this.refreshTablePresetSurfaces(binding.id);
			this.settingsTab?.refreshTablePresetFileState();
			return;
		}
		if (binding && isOperonTableFilePath(file.path)) {
			const oldName = deriveOperonTableNameFromPath(oldPath);
			const nextName = deriveOperonTableNameFromPath(file.path);
			try {
				binding.path = file.path;
				if (oldName !== nextName) {
					const source = await this.app.vault.read(file);
					const parsed = parseOperonTableFile(source, file.path);
					if (parsed.status === 'valid') {
						const serialized = serializeOperonTableFile({ ...parsed.preset, name: nextName });
						this.expectedTableFileModifyHashes.set(getOperonTableFilePathKey(file.path), this.hashTableFileContent(serialized));
						await this.app.vault.modify(file, serialized);
					}
				}
				await this.storage.saveSettings();
			} catch (error) {
				binding.path = oldPath;
				this.expectedTableFileModifyHashes.delete(getOperonTableFilePathKey(file.path));
				this.scheduleTablePresetRegistryRefresh();
				throw error;
			}
		}
		this.scheduleTablePresetRegistryRefresh();
	}

	private async reconcileBoundTableFileNames(): Promise<boolean> {
		let renamed = false;
		for (const binding of this.settings.tablePresetFileBindings) {
			const entry = this.tablePresetRegistry.get(binding.id);
			if (entry?.status !== 'available' || !entry.preset || entry.source.kind !== 'table-file') continue;
			const file = this.app.vault.getAbstractFileByPath(binding.path);
			if (!(file instanceof TFile)) continue;
			const desiredPath = this.resolveTableFilePathForName(file, entry.preset.name);
			if (desiredPath !== file.path) {
				await this.renameCanonicalTableFile(file, desiredPath);
				renamed = true;
			}
		}
		return renamed;
	}

	private hashTableFileContent(source: string): string {
		let hash = 2166136261;
		for (let index = 0; index < source.length; index++) {
			hash ^= source.charCodeAt(index);
			hash = Math.imul(hash, 16777619);
		}
		return (hash >>> 0).toString(16);
	}

	private async loadPlugin(): Promise<void> {
		registerObsidianIconFallbacks();

		// Initialize storage and settings
		this.storage = new OperonStorage(this.app, {
			pluginId: this.manifest.id,
			loadData: () => this.loadData(),
			saveData: (data: unknown) => this.saveData(data),
		});
		await this.storage.initialize();
		this.localePackManager = new LocalePackManager({
			adapter: this.app.vault.adapter,
			configDir: this.app.vault.configDir,
			pluginId: this.manifest.id,
		});
		await this.localePackManager.initialize();
		this.projectSerialIndexReconcileScheduler = new CoalescedAsyncScheduler({
			delayMs: 80,
			maxRetries: 1,
			run: () => this.reconcileProjectSerialsForIndexMutation(),
			onError: error => console.warn('Operon: failed to reconcile project serials after index mutation', error),
		});
		this.settings = this.storage.getSettings();
		resetI18nToEnglish();
		if (this.settings.language !== 'en') {
			const cachedLocale = await this.localePackManager.loadCachedLocale(this.settings.language);
			if (cachedLocale) installI18nLocale(this.settings.language, cachedLocale.translations);
		}
		initI18n(undefined, this.settings.language);
		this.tableFilePropertyIndex = getTableFilePropertyIndex(this.app, {
			typeResolver: this.tableFilePropertyTypeResolver,
		});
		await this.refreshTableFilePropertyTypes(true, false);
		await this.initializeTablePresetRegistry();
		this.pinnedCache = this.storage.pinned;
		this.unsubscribePinnedCache = this.pinnedCache.subscribe(() => {
			if (!this.startupReady) return;
			this.refreshViews();
		});
		this.unsubscribeProjectSerials = this.storage.projectSerials.subscribe(() => {
			if (!this.startupReady) return;
			this.refreshViews({ reason: 'project-serials' });
		});
		this.externalCalendarService = new ExternalCalendarService(
			this.storage.externalCalendars,
			() => {
				if (!this.startupReady) return;
				this.refreshViews();
			},
		);
		await this.externalCalendarService.applySettings(this.settings.externalCalendars);
		this.register(() => {
			this.unsubscribePinnedCache?.();
			this.unsubscribePinnedCache = null;
			this.unsubscribeProjectSerials?.();
			this.unsubscribeProjectSerials = null;
		});
		this.keyMappingSignature = this.buildKeyMappingSignature();
		this.workflowStatusSemanticsSignature = buildWorkflowStatusSemanticsSignature(this.settings.pipelines);

		this.reportStartupPipelineTaxonomyDiagnostics();
		this.applyWorkspaceTweaks();
		for (const source of [
			OPERON_COMPACT_CHIP_HOVER_SOURCE,
			OPERON_TASK_TITLE_HOVER_SOURCE,
			OPERON_TASK_DESCRIPTION_WIKILINK_HOVER_SOURCE,
		]) {
			this.registerHoverLinkSource(source, {
				display: 'Operon',
				defaultMod: true,
			});
		}

		// Initialize indexer, task writer, and core systems
		const indexV8Store = new IndexV8Store(this.app.vault.adapter, this.storage.indexV8Paths);
		const indexV8PersistenceCoordinator = new IndexV8PersistenceCoordinator(indexV8Store);
		this.indexer = new OperonIndexer(this.app, this.storage, indexV8PersistenceCoordinator, indexV8Store);
		this.reminderDeliveryController = new ReminderDeliveryController({
			app: this.app,
			getSystemNotificationsEnabled: () => this.settings.reminderSystemNotificationsEnabled,
			getSoundFilePath: () => this.settings.reminderSoundFilePath,
			getNoticeDurationMs: () => this.settings.reminderNoticeDurationSeconds * 1_000,
			onOpenTask: operonId => this.navigateToTaskById(operonId),
		});
		this.reminderScheduler = new ReminderScheduler({
			app: this.app,
			indexer: this.indexer,
			getCatchUpWindowMinutes: () => this.settings.reminderCatchUpWindowMinutes,
		isSystemReminderFieldEnabled: fieldKey => this.settings.keyMappings.some(mapping => (
			mapping.canonicalKey === fieldKey && mapping.isSystem !== false
		)),
		onDueTasks: async tasks => {
			if (!this.settings.reminderAutoPinDueTasks || !this.pinnedCache) return;
			for (const task of tasks) {
				const current = this.indexer.getTask(task.operonId);
				if (!current || current.checkbox !== 'open') continue;
				if (this.indexer.hasDuplicateOperonIdConflict(task.operonId)) continue;
				if (this.pinnedCache.isPinned(task.operonId)) continue;
				await this.pinnedCache.pin(task.operonId);
			}
		},
			deliveryPort: this.reminderDeliveryController,
		});
		const mobileNotificationsSnapshotPath = buildOperonPluginStoragePath(
			this.app.vault.configDir,
			'state',
			'mobile-notifications.json',
		);
		let existingMobileNotificationsProducerState: ReturnType<
			typeof readExistingMobileNotificationsProducerState
		> | null = null;
		this.mobileNotificationsExporter = new MobileNotificationsExporter({
			app: this.app,
			indexer: this.indexer,
			canProduce: () => Platform.isDesktopApp,
			getEnabled: () => this.settings.mobileNotificationsSnapshotEnabled,
			producerState: {
				isCancelPending: () => this.storage.getMobileNotificationsIntegration().cancelPending,
				getOrCreateVaultId: async () => {
					existingMobileNotificationsProducerState ??= readExistingMobileNotificationsProducerState(
						this.app.vault.adapter,
						mobileNotificationsSnapshotPath,
					);
					const existingState = await existingMobileNotificationsProducerState;
					if (existingState) await this.storage.adoptMobileNotificationsIntegration(existingState);
					return this.storage.getOrCreateMobileNotificationsVaultId(existingState?.vaultId);
				},
				reserveGeneratedAtEpochMs: (nowEpochMs, minimumExclusive) => (
					this.storage.reserveMobileNotificationsGeneratedAtEpochMs(nowEpochMs, minimumExclusive)
				),
				markCancelAllPublished: () => this.storage.markMobileNotificationsCancelAllPublished(),
			},
			getCatchUpMinutes: () => this.settings.reminderCatchUpWindowMinutes,
			getAppearanceSettings: () => this.settings,
			isSystemReminderFieldEnabled: fieldKey => this.settings.keyMappings.some(mapping => (
				mapping.canonicalKey === fieldKey && mapping.isSystem !== false
			)),
			path: mobileNotificationsSnapshotPath,
		});
		setExistingIdsProvider(() => this.indexer.getAllOperonIds());
		this.writer = new TaskWriter(this.app, this.indexer, this.settings.keyMappings, {
			onBeforeWriteFile: filePath => this.markInternalTaskWrite(filePath),
			onDuplicateConflict: operonId => {
				this.scheduleDuplicateConflictAlert(operonId);
			},
		});
		this.workflowFieldRenameCoordinator = new WorkflowFieldRenameCoordinator({
			journal: this.storage.fieldRenameJournal,
			getCurrentTaxonomySnapshot: () => this.getWorkflowTaxonomySnapshot(),
			commitTaxonomySnapshot: snapshot => this.commitWorkflowTaxonomySnapshot(snapshot),
			writeTaskStatusIfCurrent: mapping => this.writer.writeTaskFieldIfCurrent(
				mapping.operonId,
				'status',
					mapping.oldValue,
					mapping.newValue,
					{
						reindex: 'none',
						allowMissingAfterReindex: mapping.attemptCount > 1,
						fallbackLocation: {
							filePath: mapping.filePath,
							format: mapping.format,
						},
					},
				),
			rebuildIndex: () => this.indexer.fullReindex(),
			reconcileAggregates: async () => {
				const completed = await this.runTaskStatsBackfill({ force: true, source: 'workflow-semantics' });
				if (!completed) throw new Error('workflow aggregate reconciliation remains incomplete');
			},
		});
		this.dependencyManager = new DependencyManager(this.indexer, this.writer);
		this.aggregateCoordinator = new AggregateCoordinator(this.indexer, this.writer);
		this.taskStatsBackfillRunner = new TaskStatsBackfillRunner(
			this.indexer,
			this.aggregateCoordinator,
			() => this.settings,
			(version) => this.markTaskStatsBackfillComplete(version),
		);
		this.timeTracker = new TimeTracker(
			this.app,
			this.indexer,
			this.writer,
			this.storage.activeTrackers,
			() => this.settings,
			(operonId) => {
				this.scheduleDuplicateConflictAlert(operonId);
			},
			async (operonId, modifiedTimestamp) => {
				return await this.aggregateCoordinator.refreshDurationAfterTaskIds([operonId], { modifiedTimestamp });
			},
			(task, payload) => this.guardTaskStatusChangeOrShow(task, payload),
			async (beforeTask, afterTask, modifiedTimestamp) => this.refreshAggregateTotalsAfterTaskMutation(
				beforeTask,
				afterTask,
				{ modifiedTimestamp, autoUnpinCandidate: afterTask },
			),
			// TimeTracker runs this exactly once after the aggregate attempt and its
			// bounded retry, so a transient failure cannot expose a stale interim view.
			() => this.refreshViews({ reason: 'tracker-start-aggregates' }),
			// Session writes use the same post-commit retry boundary and request one
			// full refresh only after all duration aggregate attempts finish.
			() => this.refreshViews({ reason: 'tracker-duration-aggregates' }),
		);
		this.recurrenceService = new RecurrenceService(
			this.app,
			this.indexer,
			this.writer,
			this.storage,
			() => this.settings,
			operonId => this.suppressRawTaskCreationNotice(operonId),
		);
		this.formatConverter = new FormatConverter(this.app, this.indexer, this.settings);
		this.fileTaskArchiver = new FileTaskArchiver(this.app, this.indexer, () => this.settings, {
			isTaskActive: operonId => this.timeTracker.isTimerRunning(operonId),
		});

		// Ensure file tasks folder exists on startup
		await this.formatConverter.ensureFileTasksFolder();

		// Load cached index first for fast startup (Architecture doc Section 4.5)
		await this.primeIndexV8ManifestFingerprint();
		const cacheLoad = await this.indexer.loadCachedIndex();
		const hasCached = cacheLoad.status === 'loaded';
		const loadedFromV8 = cacheLoad.status === 'loaded' && cacheLoad.source === 'v8';
		const requiresFullReindex = cacheLoad.status === 'loaded' && cacheLoad.requiresFullReindex;
		this.initializeIndexV8ManifestMonitor();
		this.initializeTableFilePropertyTypeMonitor();

		// Refresh sidebar views whenever the index is updated
		// Suppressed during startup — onLayoutReady handles the authoritative render
		this.indexer.onIndexUpdated = () => {
			if (!this.startupReady) return;
			this.scheduleIndexSideEffects();
		};
		this.indexer.onTasksRemoved = (removedTasks) => {
			if (!this.startupReady || removedTasks.length === 0) return;
			for (const task of removedTasks) {
				if (task.primary.format !== 'yaml') continue;
				if (this.indexer.getFileTaskByPath(task.primary.filePath)) continue;
				this.tableFilePropertyIndex?.removeFile(task.primary.filePath);
			}
			void this.handleTasksRemovedFromIndex(removedTasks);
		};
		this.indexer.onTasksChanged = (changes) => {
			if (!this.startupReady || changes.length === 0) return;
			void this.handleIndexedTasksChanged(changes);
		};

		this.register(
			this.timeTracker.subscribe((event) => {
				if (event !== 'state') return;
				this.refreshTimerStateSurfaces();
			}),
		);

		// Auto-pin on timer start
		this.register(
			this.timeTracker.subscribe(asyncHandler('auto-pin active timer failed', async (event) => {
				if (event !== 'state') return;
				if (!this.settings.pinnedDockAutoPin) return;
				if (!this.pinnedCache) return;
				const operonId = this.timeTracker.getActiveOperonId();
				if (!operonId) return;
				if (this.pinnedCache.isPinned(operonId)) return; // already pinned
				await this.pinnedCache.pin(operonId);
			})),
		);

		// Register file watchers for incremental updates (Architecture doc Section 4.2)
		this.registerFileWatchers();
		this.registerNativeFileTaskConversionMenus();
		this.registerLivePreviewSessionWatchers();
		this.registerFilterPerformanceWatchers();
		this.registerCanonicalSettingsReloadWatchers();
		this.registerEditableFocusRefreshWatchers();

		// Register commands
		this.registerCommands();

		// Register CM6 inline task bar extension for Live Preview
		this.registerInlineTaskBar();

		// Register Reading mode post-processor
		this.registerReadingModeProcessor();
		this.registerYamlPropertyVisibilityWatchers();
		this.registerWorkspaceTweakWatchers();

		// Register views (Filter View, etc.) and floating dock
		this.registerViews();

		// Register embedded filter code block processor
		this.registerEmbedFilterProcessor();
		this.registerEmbedTableProcessor();

		// Register settings tab
		this.settingsTab = new OperonSettingsTab(
			this.app,
			this,
			this.settings,
			this.storage,
			() => this.handleSettingsChanged(),
			this.indexer,
			(filterSetId) => this.openFilterViewById(filterSetId),
			() => this.pinnedDock?.refreshLayout(),
			this.storage.pinned,
			(operonId) => this.openEditorForId(operonId),
				(operonId) => { void this.cycleTaskStatusById(operonId); },
				(task) => { this.navigateToTask(task); },
				(operonId, key, value) => { void this.updateTaskFieldAndRefresh(operonId, key, value); },
				(taskId, actionId, context, invocation) => this.handleContextualMenuAction(taskId, actionId, context, invocation),
				(taskId) => this.timeTracker.isTimerRunning(taskId),
				async (taskId) => {
					await this.toggleTimerForTask(taskId, 'command');
				},
				() => this.timeTracker.getActiveOperonId() ?? '',
				(operonId, payload) => { void this.updateTaskFieldsAndRefresh(operonId, payload); },
				(operonId, subtaskIds) => { void this.syncExistingSubtasksForParent(operonId, subtaskIds); },
				(operonId, field, value) => { void this.updateTaskDependencyFieldAndRefresh(operonId, field, value); },
				(preview) => this.applyPipelineRenameMigration(preview),
				(preview) => this.applyPriorityRenameMigration(preview),
				(sourceId) => this.syncExternalCalendarSourceNow(sourceId),
				(presetId, sortMode) => this.handleKanbanSortModeChange(presetId, sortMode),
				(sourcePresetId, targetPresetId) => this.copyKanbanManualOrder(sourcePresetId, targetPresetId),
					(presetId) => this.removeKanbanManualOrder(presetId),
					() => this.createOrRepairBasicsWorkspaceFromUi(),
					() => this.syncOperonDocsFromSettings(),
					(folder) => this.changeOperonDocsFolder(folder),
					(operation) => this.enqueueTablePresetMutation(operation),
					(input) => this.applyWorkflowFieldRenameTransaction(input),
					() => this.retryPendingWorkflowRename(),
					() => this.resolvePendingWorkflowRenameConflict(),
			this.buildTablePresetSettingsFileIntegration(),
			this.localePackManager,
			() => this.reminderDeliveryController?.previewInOperon(),
			async () => await this.reminderDeliveryController?.previewSystemNotification() ?? false,
			);
		this.addSettingTab(this.settingsTab);

		const statusBarItem = this.addStatusBarItem();
		this.trackerStatusBar = new TimeTrackerStatusBar(
			statusBarItem,
			this.timeTracker,
			() => this.settings,
			() => this.openFlowTimeView(),
		);
		this.trackerStatusBar.initialize();
		this.initializeDuplicateAlertStatusBar();

		// Run startup maintenance after layout is ready
		this.app.workspace.onLayoutReady(() => {
			runAsyncAction('startup locale pack synchronization failed', () =>
				this.synchronizeLanguagePacksAfterLayout());
			const releaseCheckGeneration = ++this.releaseCheckGeneration;
			this.startupReleaseCheckTimer = setWindowTimeout(() => {
				this.startupReleaseCheckTimer = null;
				runAsyncAction('startup release check failed', () =>
					this.checkForNewReleaseOnStartup(releaseCheckGeneration));
			}, 10);
			runAsyncAction('startup layout maintenance failed', async () => {
			// Add ribbon icons after all plugins have loaded so they appear at the end
			this.addRibbonIcon('list-plus', t('commands', 'openTaskCreator'), () => {
				this.openTaskCreator();
			});

				this.addRibbonIcon('funnel-plus', t('commands', 'openFilterView'), () => {
					runAsyncAction('open filter view from ribbon failed', () => this.openFilterViewById(this.settings.leftRailDefaultFilterViewId));
				});

				this.addRibbonIcon('scan-search', t('commands', 'openTaskFinder'), () => {
					this.openTaskFinderModal();
				});

				this.addRibbonIcon('calendar', t('commands', 'openCalendar'), () => {
					runAsyncAction('open calendar from ribbon failed', () => this.openCalendarView());
				});

			this.addRibbonIcon('square-kanban', t('commands', 'openKanban'), () => {
				runAsyncAction('open kanban from ribbon failed', () => this.openKanbanView());
			});

			this.addRibbonIcon('table-2', t('commands', 'openOperonTable'), () => {
				runAsyncAction('open operon table from ribbon failed', () => this.openOperonTable());
			});

				this.addRibbonIcon('pin', t('commands', 'openPinnedTasks'), () => {
					runAsyncAction('open pinned tasks from ribbon failed', () => this.openPinnedTasksSurface());
				});

			this.scheduleYamlPropertyVisibilityRefresh(150);

			// Startup reindex strategy:
			// - No cache: full reindex immediately (nothing usable yet)
			// - Cache exists: diff reindex (catches agent-written tasks while app was closed),
			//   then optionally follow with a full reindex after 15s for completeness
			if (!hasCached || requiresFullReindex) {
				await this.indexer.fullReindex();
				if (cacheLoad.status === 'incompatible') {
					await this.runTaskStatsBackfill({ force: true, source: 'workflow-semantics' });
				} else {
					await this.runStartupTaskStatsBackfill();
				}
			} else {
				if (loadedFromV8) {
					await this.indexer.reconcileV8StartupSources();
				} else {
					await this.indexer.adoptV8ShadowProvenance();
					await this.indexer.diffReindex();
				}
				if (this.settings.fullReindexOnStartup) {
					setWindowTimeout(() => {
						runAsyncAction('startup full reindex failed', async () => {
							await this.indexer.fullReindex();
							await this.runStartupTaskStatsBackfill();
						});
					}, 15_000);
				} else {
					await this.runStartupTaskStatsBackfill();
				}
			}
			this.indexer.recoverStartupV8IfNeeded(cacheLoad.status === 'loaded' || cacheLoad.status === 'missing'
				? cacheLoad.fallbackReason
				: undefined);

				try {
					const renameRecovery = await this.workflowFieldRenameCoordinator.resume();
					this.finishWorkflowFieldRenameRun(renameRecovery);
					} catch (error) {
						console.warn('Operon: pending workflow rename recovery could not continue', error);
						if (this.storage.fieldRenameJournal.get() || this.storage.fieldRenameJournal.getRecoveryRequired()) {
							new Notice(t('notifications', 'workflowRenameRecoveryFailed'));
						}
				}

					await this.recurrenceService.reconcileStoredSeries();
					await this.dependencyManager.reconcileAdditiveInverseLinks();
					await this.reconcileProjectSerials({ notifyCapacity: true });

					// Mark startup complete — one authoritative render + resumeFromIndex
				this.startupReady = true;
				await this.reminderScheduler?.start();
				await this.mobileNotificationsExporter?.start();
				if (this.projectSerialIndexReconcilePendingBeforeStartup) {
					this.scheduleProjectSerialIndexReconcile();
				}
				await this.timeTracker.resumeFromIndex({ migrateLegacy: true });
				this.indexV8CleanupMaintenance?.cancel();
				this.indexV8CleanupMaintenance = startIndexV8CleanupMaintenance({
					run: () => this.indexer.runIndexV8CleanupMaintenance(),
					isActive: () => this.startupReady,
					setTimeout: (callback, delayMs) => setWindowTimeout(callback, delayMs),
					clearTimeout: handle => clearWindowTimeout(handle),
					onError: error => console.error('Operon: V8 index cleanup failed', error),
				});
				this.refreshViews();
				this.scheduleWorkspacePropertiesCollapseForAllViews();
				this.syncDuplicateConflictUi(true);
				await this.maybeShowDemoWorkspacePrompt();
				this.maybeSyncOperonDocsAfterPluginUpdate();
				setWindowTimeout(() => {
					runAsyncAction('release notes update popup failed', () => {
						this.maybeShowReleaseNotesOnUpdate();
						return Promise.resolve();
					});
				}, 750);
			});
			});
		}

	private initializeIndexV8ManifestMonitor(): void {
		const win = getActiveWindow();
		const doc = getActiveDocument();
		const checkVisible = (): void => {
			if (doc.hidden) return;
			void this.checkIndexV8ManifestStat();
		};
		this.registerInterval(win.setInterval(checkVisible, 30_000));
		this.registerDomEvent(win, 'focus', checkVisible);
		this.registerDomEvent(doc, 'visibilitychange', checkVisible);
		checkVisible();
	}

	private initializeTableFilePropertyTypeMonitor(): void {
		const win = getActiveWindow();
		const doc = getActiveDocument();
		const checkVisible = (): void => {
			if (doc.hidden) return;
			void this.refreshTableFilePropertyTypes();
		};
		this.registerInterval(win.setInterval(checkVisible, 30_000));
		this.registerDomEvent(win, 'focus', checkVisible);
		this.registerDomEvent(doc, 'visibilitychange', checkVisible);
	}

	private async primeIndexV8ManifestFingerprint(): Promise<void> {
		try {
			const stat = await this.app.vault.adapter.stat(this.storage.indexV8Paths.manifestPath);
			this.indexV8ManifestFingerprint = stat && stat.type === 'file' ? `${stat.mtime}:${stat.size}` : 'missing';
		} catch {
			this.indexV8ManifestFingerprint = null;
		}
	}

	private async checkIndexV8ManifestStat(): Promise<void> {
		if (this.indexV8ManifestCheckActive) return;
		this.indexV8ManifestCheckActive = true;
		try {
			const stat = await this.app.vault.adapter.stat(this.storage.indexV8Paths.manifestPath);
			const fingerprint = stat && stat.type === 'file' ? `${stat.mtime}:${stat.size}` : 'missing';
			if (this.indexV8ManifestFingerprint === null) {
				this.indexV8ManifestFingerprint = fingerprint;
				await this.indexer.observeIndexV8ManifestChange();
				return;
			}
			if (fingerprint === this.indexV8ManifestFingerprint) return;
			this.indexV8ManifestFingerprint = fingerprint;
			await this.indexer.observeIndexV8ManifestChange();
		} catch {
			console.debug('Operon: V8 manifest monitor probe deferred');
		} finally {
			this.indexV8ManifestCheckActive = false;
		}
	}

	onunload(): void {
		this.cancelStartupReleaseCheck();
		runAsyncAction('plugin unload failed', () => this.unloadPlugin());
	}

	private async unloadPlugin(): Promise<void> {
		this.startupReady = false;
		this.projectSerialIndexReconcilePendingBeforeStartup = false;
		this.projectSerialIndexReconcileScheduler?.cancel();
		this.projectSerialIndexReconcileScheduler = null;
		if (this.settingsReindexTimer) {
			clearWindowTimeout(this.settingsReindexTimer);
			this.settingsReindexTimer = null;
		}
		if (this.canonicalSettingsReloadTimer) {
			clearWindowTimeout(this.canonicalSettingsReloadTimer);
			this.canonicalSettingsReloadTimer = null;
		}
		if (this.yamlPropertyVisibilityRefreshTimer) {
			clearWindowTimeout(this.yamlPropertyVisibilityRefreshTimer);
			this.yamlPropertyVisibilityRefreshTimer = null;
		}
		if (this.locationPlaceTableRefreshTimer) {
			clearWindowTimeout(this.locationPlaceTableRefreshTimer);
			this.locationPlaceTableRefreshTimer = null;
		}
		if (this.tableFilePropertyRefreshTimer) {
			clearWindowTimeout(this.tableFilePropertyRefreshTimer);
			this.tableFilePropertyRefreshTimer = null;
		}
		clearTableFilePropertyIndex(this.app);
		this.tableFilePropertyIndex = null;
		this.clearWorkspaceTweakPropertiesCollapseTimers();
		this.clearWorkspaceTweakPropertiesCollapserTargetClasses();
		this.removeWorkspaceTweakBodyClasses();
		if (this.deferredRefreshTimer) {
			clearWindowTimeout(this.deferredRefreshTimer);
			this.deferredRefreshTimer = null;
		}
		if (this.editableFocusRefreshTimer) {
			clearWindowTimeout(this.editableFocusRefreshTimer);
			this.editableFocusRefreshTimer = null;
		}
		this.clearDynamicFileTaskFilterReadingTimers();
		this.removeAllDynamicFileTaskFilterReadingHosts();
			if (this.refreshViewsFrame !== null) {
				window.cancelAnimationFrame(this.refreshViewsFrame);
				this.refreshViewsFrame = null;
			}
			if (this.livePreviewAuthoringCursorRestoreClearTimer) {
				clearWindowTimeout(this.livePreviewAuthoringCursorRestoreClearTimer);
				this.livePreviewAuthoringCursorRestoreClearTimer = null;
			}
			this.livePreviewAuthoringCursorRestoreLease = null;
		if (this.indexSideEffectTimer) {
				clearWindowTimeout(this.indexSideEffectTimer);
				this.indexSideEffectTimer = null;
			}
		this.clearDuplicateAlertTimer();
		this.clearDuplicateAlertResolvedTimer();
		this.hideDuplicateAlertStatusBar();
		this.duplicateAlertStatusBarEl = null;
		this.trackerStatusBar?.destroy();
		this.trackerStatusBar = null;
		this.unsubscribePinnedCache?.();
		this.unsubscribePinnedCache = null;
		this.unsubscribeProjectSerials?.();
		this.unsubscribeProjectSerials = null;
		await this.externalCalendarService?.destroy();
		this.externalCalendarService = null;
		this.duplicateOperonIdModal?.close();
		this.duplicateOperonIdModal = null;
		this.taskCreatorModal?.close();
		this.taskCreatorModal = null;
		this.subtasksFilterModal?.close();
		this.subtasksFilterModal = null;
		this.fileTaskArchiver?.destroy();
		this.fileTaskArchiver = null;
		this.reminderDeliveryController?.destroy();
		this.reminderDeliveryController = null;
		await this.mobileNotificationsExporter?.destroy();
		this.mobileNotificationsExporter = null;
		await this.reminderScheduler?.destroy();
		this.reminderScheduler = null;
		this.pinnedDock = null;
		await this.timeTracker.flushPendingTransitions();
		this.timeTracker.destroy();
		this.closeActiveLivePreviewPicker();
		this.livePreviewEphemeralSession.cancel('plugin_unload');
		hideTaskContextualHoverMenu(true);

		let tablePresetDrainError: unknown = null;
		try {
			await this.tablePresetRegistry?.drain();
		} catch (error) {
			tablePresetDrainError = error;
		} finally {
			this.tablePresetRegistry?.dispose();
		}
		this.indexV8CleanupMaintenance?.cancel();
		await this.indexV8CleanupMaintenance?.drain();
		this.indexV8CleanupMaintenance = null;
		await this.indexer.prepareForUnload();
		await this.storage.flushPendingWrites();
		this.indexer.destroy();
		this.storage.destroy();
		this.settingsTab = null;
		if (tablePresetDrainError) {
			throw tablePresetDrainError instanceof Error
				? tablePresetDrainError
				: new Error('Table preset registry drain failed during plugin unload.');
		}
	}

	/**
	 * Register file watchers for incremental index updates.
	 * Uses Obsidian vault events — file modify, create, delete, rename.
	 */
	/**
	 * Register the CM6 inline task bar extension for Live Preview rendering.
	 */
	/**
	 * Register workspace views and floating dock.
	 */
	private registerViews(): void {
		const openEditorForId = (operonId: string) => this.openEditorForId(operonId);
		const openTaskSourceInNewTab = (operonId: string) => this.openMaterializedTaskSourceInNewTab(operonId);

		// Pinned Tasks dock (floating, not a sidebar view).
		// Initialize dock as a child Component for proper lifecycle.
		this.pinnedDock = new PinnedTasksDock(
			this.indexer,
			this.settings,
			this.timeTracker,
			{
					openTaskEditor: openEditorForId,
					openTaskSource: openTaskSourceInNewTab,
						cycleStatus: (operonId) => {
							runAsyncAction('pinned dock status cycle failed', () => this.cycleTaskStatusById(operonId));
						},
						onContextualAction: (taskId, actionId, context, invocation) => this.handleContextualMenuAction(taskId, actionId, context, invocation),
						hasSubtasks: (taskId) => this.indexer.secondary.getChildIds(taskId).size > 0,
						toggleTimer: (taskId) => this.toggleTimerForTask(taskId, 'command'),
						saveSettings: () => {
							runAsyncAction('pinned dock settings save failed', () => this.storage.saveSettings());
						},
					refreshLayout: () => this.pinnedDock?.refreshLayout(),
				},
			this.storage.pinned,
			);
			this.addChild(this.pinnedDock);

			this.registerView(PINNED_TASKS_SIDEBAR_VIEW_TYPE, (leaf) =>
				new PinnedTasksSidebarView(
					leaf,
					this.indexer,
					this.settings,
					this.timeTracker,
					{
						openTaskEditor: openEditorForId,
						openTaskSource: openTaskSourceInNewTab,
						cycleStatus: (operonId) => this.cycleTaskStatusById(operonId),
						onContextualAction: (taskId, actionId, context, invocation) => this.handleContextualMenuAction(taskId, actionId, context, invocation),
						hasSubtasks: (taskId) => this.indexer.secondary.getChildIds(taskId).size > 0,
						toggleTimer: (taskId) => this.toggleTimerForTask(taskId, 'command'),
					},
					this.storage.pinned,
				)
			);

			this.mobileGlobalTaskFab = new MobileGlobalTaskFab(
				this.app,
				this.settings,
			{
				openTaskCreator: () => this.openTaskCreator(),
				shouldHideForActiveView: () => (
					this.settings.mobileGlobalTaskFabHideInCalendar === true
					&& this.app.workspace.getActiveViewOfType(CalendarView) != null
				) || (
					this.settings.mobileGlobalTaskFabHideInKanban === true
					&& this.app.workspace.getActiveViewOfType(KanbanView) != null
				),
				onPositionChange: async (position) => {
					this.settings.mobileGlobalTaskFabPosition = position;
					await this.storage.saveSettings();
				},
			},
		);
		this.addChild(this.mobileGlobalTaskFab);

		// Filter View
		this.registerView(FILTER_VIEW_TYPE, (leaf) =>
			new FilterView(
				leaf,
				this.indexer,
				this.settings,
				() => this.storage.saveSettings(),
				openEditorForId,
				(operonId) => this.cycleTaskStatusById(operonId),
				() => this.settings.pipelines,
				() => this.settings.priorities ?? DEFAULT_PRIORITIES,
				(parentId) => [...this.indexer.secondary.getChildIds(parentId)],
				(task: IndexedTask) => { this.navigateToTask(task); },
				() => this.settings,
				async (operonId, key, value) => {
					await this.updateTaskFieldAndRefresh(operonId, key, value);
				},
				async (operonId, payload) => {
					await this.updateTaskFieldsAndRefresh(operonId, payload);
				},
				(operonId, subtaskIds) => {
					void this.syncExistingSubtasksForParent(operonId, subtaskIds);
				},
				(operonId, field, value) => {
					void this.updateTaskDependencyFieldAndRefresh(operonId, field, value);
				},
				(repeatSeriesId) => this.storage.repeatSeries.getSkipDates(repeatSeriesId),
				() => this.getRepeatSkipSignature(),
				(repeatSeriesId) => this.getRepeatSeriesInlineCompletionMode(repeatSeriesId),
				(operonId, mode) => {
					void this.applyInlineRepeatCompletionModeIfRequested(this.indexer.getTask(operonId), mode);
				},
				(operonId) => {
					void this.requestSubtaskForParentId(operonId);
				},
				(taskId, actionId, context, invocation) => this.handleContextualMenuAction(taskId, actionId, context, invocation),
					this.storage.pinned,
					(taskId) => this.timeTracker.isTimerRunning(taskId),
					async (taskId) => {
						await this.toggleTimerForTask(taskId, 'command');
					},
				() => this.timeTracker.getActiveOperonId() ?? '',
				(operonId) => this.getProjectSerialDisplayForTask(operonId),
				() => this.getProjectSerialSignature(),
				(filterSet) => this.saveFilterSetAndRefresh(filterSet),
				(dateKey) => this.openDailyNoteFromDateKey(dateKey),
				(filterSet) => this.duplicateFilterSetAndRefresh(filterSet),
				(filterSetId) => this.deleteFilterSetAndRefresh(filterSetId),
				(filterSetId) => this.togglePresetFavoriteAndRefresh('filter', filterSetId),
				(target) => this.openRelatedViewTarget(target),
				(target) => this.createRelatedViewPresetAndOpen(target),
			)
		);

		this.registerView(TIME_SESSION_HISTORY_VIEW_TYPE, (leaf) =>
			new TimeSessionHistoryView(
				leaf,
				this.indexer,
				this.timeTracker,
				{
					cycleStatus: (operonId) => this.cycleTaskStatusById(operonId),
					navigateToTask: (task) => { this.navigateToTask(task); },
						navigateToDailyNote: (dateKey) => {
							runAsyncAction('time history daily note navigation failed', () => this.app.workspace.openLinkText(dateKey, '', false));
						},
					openTaskEditor: openEditorForId,
					getPipelines: () => this.settings.pipelines,
					getSettings: () => this.settings,
					startTimerForTask: (operonId, source) => this.startTimerForTask(operonId, source),
					onContextualAction: (
						taskId: string,
						actionId: ContextualMenuActionId,
						context?: ContextualMenuContext,
						invocation?: ContextualMenuActionInvocation,
					) => this.handleContextualMenuAction(taskId, actionId, context, invocation),
					isTaskPinned: (taskId) => this.pinnedCache?.isPinned(taskId) === true,
					hasSubtasks: (taskId) => this.indexer.secondary.getChildIds(taskId).size > 0,
				},
			)
		);

		this.registerView(FLOW_TIME_VIEW_TYPE, (leaf) =>
			new FlowTimeView(
				leaf,
				this.indexer,
				this.timeTracker,
				{
					cycleStatus: (operonId) => this.cycleTaskStatusById(operonId),
					openTaskEditor: openEditorForId,
					getPipelines: () => this.settings.pipelines,
					getSettings: () => this.settings,
					saveSettings: () => this.storage.saveSettings(),
					createInlineTaskFromQuickInput: (draft) => this.createInlineTaskFromCreatorDraftResult(draft),
					shouldPromptForInlineTaskTarget: () => this.resolveEffectiveInlineTaskSaveMode() === 'ask-every-time',
					startTimerForTask: (operonId, source, startOverride) => this.startTimerForTask(operonId, source, startOverride),
					startUnassignedTimer: (source) => this.startUnassignedTimer(source),
					stopActiveTimer: (reason) => this.stopActiveTimer(reason),
					onContextualAction: (
						taskId: string,
						actionId: ContextualMenuActionId,
						context?: ContextualMenuContext,
						invocation?: ContextualMenuActionInvocation,
					) => this.handleContextualMenuAction(taskId, actionId, context, invocation),
					isTaskPinned: (taskId) => this.pinnedCache?.isPinned(taskId) === true,
					hasSubtasks: (taskId) => this.indexer.secondary.getChildIds(taskId).size > 0,
				},
			)
		);

		this.registerView(CALENDAR_VIEW_TYPE, (leaf) =>
			new CalendarView(
				leaf,
				this.indexer,
				() => this.settings,
				() => this.pinnedCache,
				() => this.storage.repeatSeries.getAllEntries(),
				(rangeStart, rangeEnd, presetId, showExternalCalendarsOverride) => this.getExternalCalendarItemsForRange(rangeStart, rangeEnd, presetId, showExternalCalendarsOverride),
				{
					getTrackedSessions: (rangeStart, rangeEnd) => this.timeTracker.getSessionsForRange(rangeStart, rangeEnd),
					getActiveTrackerState: () => this.timeTracker.getActiveState(),
					onTimedSlotSelection: (selection) => this.handleCalendarSlotSelection(leaf, selection),
					onTrackedSlotSelection: (selection) => this.createTrackedSessionFromCalendarSelection(selection),
					onMobileTimedSlotCreate: (selection) => this.handleMobileCalendarSlotCreate(leaf, selection),
					onTimedItemMove: (taskId, selection, sourcePayload) => this.handleCalendarTimedMove(taskId, selection, sourcePayload),
					onTimedItemResizeStart: (taskId, selection, sourcePayload) => this.handleCalendarTimedResize(taskId, selection, sourcePayload),
					onTimedItemResizeEnd: (taskId, selection, sourcePayload) => this.handleCalendarTimedResize(taskId, selection, sourcePayload),
					onTrackedSessionMove: (session, selection) => this.handleCalendarTrackedSessionUpdate(session, selection),
					onTrackedSessionResize: (session, selection) => this.handleCalendarTrackedSessionUpdate(session, selection),
					onTrackedSessionOpen: (session) => this.openCalendarTrackedSessionEditor(session),
					onTimedItemDropToAllDay: (taskId, selection) => this.handleCalendarTimedDropToAllDay(taskId, selection),
					onAllDaySlotSelection: (selection) => this.handleCalendarSlotSelection(leaf, selection),
					onAllDayScheduledMove: (taskId, selection) => this.handleCalendarScheduledMove(taskId, selection),
					onAllDayScheduledResizeRight: (taskId, selection) => this.handleCalendarScheduledResizeRight(taskId, selection),
					onAllDayItemDropToTimed: (taskId, selection, sourcePayload) => this.handleCalendarAllDayDropToTimed(taskId, selection, sourcePayload),
					onItemAction: (taskId, actionId, context, invocation) => this.handleContextualMenuAction(taskId, actionId, context, invocation),
					onOpenTaskSource: openTaskSourceInNewTab,
					onStatusIconClick: (taskId) => this.handleCalendarStatusIconClick(taskId),
					onSidebarTaskDropToTimed: (taskId, selection) => this.handleCalendarSidebarTaskDrop(leaf, taskId, selection),
					onSidebarTaskDropToAllDay: (taskId, selection) => this.handleCalendarSidebarTaskDrop(leaf, taskId, selection),
					onSidebarWidthChange: async (widthPx) => {
						this.settings.calendarSidebarWidthPx = widthPx;
						await this.storage.saveSettings();
						this.refreshViews();
					},
					onOpenDailyNote: async (dateKey) => {
						await this.openDailyNoteFromDateKey(dateKey);
					},
					onToggleAllDayLaneVisibility: async (nextValue) => {
						this.settings.calendarShowAllDayLane = nextValue;
						await this.storage.saveSettings();
						this.refreshViews();
					},
					onToggleDueLaneVisibility: async (nextValue) => {
						this.settings.calendarShowDueMarkers = nextValue;
						await this.storage.saveSettings();
						this.refreshViews();
					},
					onToggleProjectedOccurrences: async (presetId, nextValue) => {
						const preset = this.settings.calendarPresets.find(entry => entry.id === presetId);
						if (!preset) return;
						preset.showProjectedOccurrences = nextValue;
						await this.storage.saveSettings();
						this.refreshViews();
					},
					onToggleExternalCalendars: async (presetId, nextValue) => {
						const preset = this.settings.calendarPresets.find(entry => entry.id === presetId);
						if (!preset) return;
						preset.showExternalCalendars = nextValue;
						await this.storage.saveSettings();
						this.refreshViews();
					},
					onCycleTaskColorSource: async (presetId, nextSource) => {
						const preset = this.settings.calendarPresets.find(entry => entry.id === presetId);
						if (!preset) return;
						preset.colorSource = nextSource;
						await this.storage.saveSettings();
						this.refreshViews();
					},
					onMobileCalendarSettingsChange: async (patch) => {
						Object.assign(this.settings, patch);
						await this.storage.saveSettings();
						this.refreshViews();
					},
					onSyncExternalCalendars: () => {
						runAsyncAction('calendar quick action external calendar sync failed', () => this.syncAllExternalCalendarsNow());
					},
					onExternalItemCreateTask: (seed) => this.handleExternalCalendarItemCreate(leaf, seed),
					onCalendarDragInteractionEnd: () => this.flushPendingCalendarRefresh(),
					hasEditableFocus: () => this.hasActiveEditableFocus(),
					getRepeatSeriesRevision: () => this.storage.repeatSeries.getRevision(),
					onOpenPresetSettings: (presetId) => {
						const preset = this.settings.calendarPresets.find(entry => entry.id === presetId) ?? null;
						new CalendarPresetQuickSettingsModal(this.app, {
							getSettings: () => this.settings,
							preset,
							onSave: async (updated) => {
								this.replaceCalendarPreset(updated);
								this.applyCalendarPresetSaveEffects(updated);
								await this.storage.saveSettings();
								this.refreshViews();
							},
							onToggleFavorite: presetId => this.togglePresetFavoriteAndRefresh('calendar', presetId),
							onToggleFilterFavorite: filterSetId => this.togglePresetFavoriteAndRefresh('filter', filterSetId),
							onSaveFilterSet: (filterSet) => this.saveFilterSetAndRefresh(filterSet),
							getFilterModalEvalDeps: () => this.buildFilterModalEvalDeps(),
						}).open();
					},
					onOpenRelatedView: (target) => this.openRelatedViewTarget(target),
					onCreateRelatedView: (target) => this.createRelatedViewPresetAndOpen(target),
				},
			)
		);

		this.registerView(KANBAN_VIEW_TYPE, (leaf) =>
			new KanbanView(
				leaf,
				this.indexer,
				() => this.settings,
				() => this.pinnedCache,
				{
					getManualOrder: (presetId) => this.storage.kanbanOrder.getBoard(presetId),
					onCardDrop: (context) => this.handleKanbanCardDrop(leaf, context),
					onCellAction: (context) => this.handleKanbanCellAction(leaf, context),
					onItemAction: (taskId, actionId, context, invocation) => this.handleContextualMenuAction(taskId, actionId, context, invocation),
					onOpenTaskSource: openTaskSourceInNewTab,
					onStatusIconClick: (taskId) => this.handleCalendarStatusIconClick(taskId),
					updateField: async (operonId, key, value) => {
						return this.updateTaskFieldAndRefresh(operonId, key, value);
					},
					updateFields: async (operonId, payload) => {
						return this.updateTaskFieldsAndRefresh(operonId, payload);
					},
					updateSubtasks: (operonId, subtaskIds) => {
						void this.syncExistingSubtasksForParent(operonId, subtaskIds);
					},
					updateDependencyField: (operonId, field, value) => {
						void this.updateTaskDependencyFieldAndRefresh(operonId, field, value);
					},
					getRepeatSkipDates: (repeatSeriesId) => this.storage.repeatSeries.getSkipDates(repeatSeriesId),
					getRepeatSkipSignature: () => this.getRepeatSkipSignature(),
					getRepeatSeriesInlineCompletionMode: (repeatSeriesId) => this.getRepeatSeriesInlineCompletionMode(repeatSeriesId),
					updateRepeatSeriesInlineCompletionMode: (operonId, mode) => {
						void this.applyInlineRepeatCompletionModeIfRequested(this.indexer.getTask(operonId), mode);
					},
					getProjectSerialDisplay: (operonId) => this.getProjectSerialDisplayForTask(operonId),
					getProjectSerialSignature: () => this.getProjectSerialSignature(),
					isTaskTracking: (operonId) => this.timeTracker.isTimerRunning(operonId),
					toggleTimer: async (operonId) => {
						await this.toggleTimerForTask(operonId, 'command');
					},
					getTrackingSignature: () => this.timeTracker.getActiveOperonId() ?? '',
					onOpenPresetSettings: (presetId) => {
						const preset = this.settings.kanbanPresets.find(entry => entry.id === presetId) ?? null;
						new KanbanPresetQuickSettingsModal(this.app, {
							getSettings: () => this.settings,
							preset,
							onSave: async (updated) => {
								this.replaceKanbanPreset(updated);
								await this.storage.saveSettings();
								await this.handleKanbanSortModeChange(updated.id, updated.sortMode);
								this.refreshViews();
							},
							onToggleFavorite: presetId => this.togglePresetFavoriteAndRefresh('kanban', presetId),
							onToggleFilterFavorite: filterSetId => this.togglePresetFavoriteAndRefresh('filter', filterSetId),
							onSaveFilterSet: (filterSet) => this.saveFilterSetAndRefresh(filterSet),
							getFilterModalEvalDeps: () => this.buildFilterModalEvalDeps(),
						}).open();
					},
					onOpenRelatedView: (target) => this.openRelatedViewTarget(target),
					onCreateRelatedView: (target) => this.createRelatedViewPresetAndOpen(target),
				},
			)
		);
		this.registerView(OPERON_TABLE_VIEW_TYPE, (leaf) =>
			new OperonTableView(
				leaf,
				this.indexer,
				() => this.settings,
				() => this.pinnedCache,
				{
					resolveTablePreset: (presetId) => this.resolveTablePresetForSurface(presetId),
					getTablePresets: () => this.getTablePresetsForSurfaces(),
					onOpenTaskEditor: (operonId) => this.openEditorForId(operonId),
					onOpenTaskSource: openTaskSourceInNewTab,
					onOpenPresetSettings: (presetId, options) => this.openTablePresetSettingsModal(presetId, leaf, options),
					onOpenRelatedView: (target) => this.openRelatedViewTarget(target),
					onCreateRelatedView: (target) => this.createRelatedViewPresetAndOpen(target),
						onSavePresetPatch: (patch, context) => this.queueTablePresetPatchAndRefresh(patch, this.getTablePresetPatchScope(patch), context.surfaceToken),
						onFlushPresetWrites: presetId => this.tablePresetRegistry.flushPatches(presetId),
					onSaveFilterSet: (filterSet) => this.saveFilterSetAndRefresh(filterSet),
					onUpdateTaskFields: (operonId, payload) => this.updateTableTaskFieldsAndRefresh(operonId, payload),
					onUpdateFileProperty: (operonId, request) => this.updateTableFilePropertyAndRefresh(operonId, request),
					getTaskSessions: (operonId) => this.timeTracker.getTaskSessions(operonId),
					onAddTaskSession: (operonId, start, end) => this.addTableTaskSessionAndRefresh(operonId, start, end),
					onEditTaskSession: (session, start, end) => this.editTableTaskSessionAndRefresh(session, start, end),
					onDeleteTaskSession: (session) => this.deleteTableTaskSessionAndRefresh(session),
					onStatusIconClick: (taskId) => this.handleCalendarStatusIconClick(taskId),
					onOpenCheckboxes: (taskId, actionAnchor, actionAnchorRect) => this.openCheckboxesForTaskId(taskId, actionAnchor, actionAnchorRect),
					onContextualAction: (taskId, actionId, context, invocation) => this.handleContextualMenuAction(taskId, actionId, context, invocation),
					getProjectSerialDisplay: (operonId, task) => task
						? this.getReadingProjectSerialDisplayForTask(operonId, task)
						: this.getProjectSerialDisplayForTask(operonId),
					getProjectSerialSignature: () => this.getProjectSerialSignature(),
					isTaskPinned: (taskId) => this.pinnedCache?.isPinned(taskId) === true,
					hasSubtasks: (taskId) => this.indexer.secondary.getChildIds(taskId).size > 0,
				},
			)
		);
		this.registerView(OPERON_TABLE_FILE_VIEW_TYPE, (leaf) =>
			new OperonTableView(
				leaf,
				this.indexer,
				() => this.settings,
				() => this.pinnedCache,
					{
						resolveTableFile: (path, source) => this.resolveTableFileForView(path, source),
						resolveTablePreset: (presetId) => this.resolveTablePresetForSurface(presetId),
						getTablePresets: () => this.getTablePresetsForSurfaces(),
						onOpenTaskEditor: (operonId) => this.openEditorForId(operonId),
						onOpenTaskSource: openTaskSourceInNewTab,
						onSelectPreset: (presetId) => this.openTablePresetInLeaf(leaf, presetId),
						onOpenPresetSettings: (presetId, options) => this.openTablePresetSettingsModal(presetId, leaf, options),
						onOpenRelatedView: (target) => this.openRelatedViewTarget(target),
						onCreateRelatedView: (target) => this.createRelatedViewPresetAndOpen(target),
							onSavePresetPatch: (patch, context) => this.queueTablePresetPatchAndRefresh(patch, this.getTablePresetPatchScope(patch), context.surfaceToken),
						onFlushPresetWrites: presetId => this.tablePresetRegistry.flushPatches(presetId),
						onSaveFilterSet: (filterSet) => this.saveFilterSetAndRefresh(filterSet),
					onUpdateTaskFields: (operonId, payload) => this.updateTableTaskFieldsAndRefresh(operonId, payload),
					onUpdateFileProperty: (operonId, request) => this.updateTableFilePropertyAndRefresh(operonId, request),
					getTaskSessions: (operonId) => this.timeTracker.getTaskSessions(operonId),
					onAddTaskSession: (operonId, start, end) => this.addTableTaskSessionAndRefresh(operonId, start, end),
					onEditTaskSession: (session, start, end) => this.editTableTaskSessionAndRefresh(session, start, end),
					onDeleteTaskSession: (session) => this.deleteTableTaskSessionAndRefresh(session),
					onStatusIconClick: (taskId) => this.handleCalendarStatusIconClick(taskId),
					onOpenCheckboxes: (taskId, actionAnchor, actionAnchorRect) => this.openCheckboxesForTaskId(taskId, actionAnchor, actionAnchorRect),
					onContextualAction: (taskId, actionId, context, invocation) => this.handleContextualMenuAction(taskId, actionId, context, invocation),
					getProjectSerialDisplay: (operonId, task) => task
						? this.getReadingProjectSerialDisplayForTask(operonId, task)
						: this.getProjectSerialDisplayForTask(operonId),
					getProjectSerialSignature: () => this.getProjectSerialSignature(),
					isTaskPinned: (taskId) => this.pinnedCache?.isPinned(taskId) === true,
					hasSubtasks: (taskId) => this.indexer.secondary.getChildIds(taskId).size > 0,
				},
				{ mode: 'file' },
			)
		);
		this.registerExtensions(['table'], OPERON_TABLE_FILE_VIEW_TYPE);
	}

	private navigateToTask(task: IndexedTask): void {
		if (task.primary.format === 'yaml') {
			runAsyncAction('task file navigation failed', () => this.app.workspace.openLinkText(task.primary.filePath, '', false));
			return;
		}

		const file = this.app.vault.getAbstractFileByPath(task.primary.filePath);
		if (!(file instanceof TFile)) return;
		const leaf = this.app.workspace.getLeaf(false);
			runAsyncAction('inline task navigation failed', async () => {
				await leaf.openFile(file);
				const editor = getCursorEditorFromView(leaf.view);
				if (editor) {
					editor.setCursor({ line: task.primary.lineNumber, ch: 0 });
					editor.scrollIntoView?.({ from: { line: task.primary.lineNumber, ch: 0 }, to: { line: task.primary.lineNumber, ch: 0 } }, true);
				}
			});
	}

	private navigateToTaskById(operonId: string): void {
		if (this.redirectDuplicateOperonIdAction(operonId)) return;
		const task = this.indexer.getTask(operonId);
		if (!task) return;
		this.navigateToTask(task);
	}

	private openMaterializedTaskSourceInNewTab(taskId: string): void {
		const task = this.indexer.getTask(taskId);
		if (!task) return;
		const file = this.app.vault.getAbstractFileByPath(task.primary.filePath);
		if (!(file instanceof TFile)) return;
		runAsyncAction('task source open in new tab failed', async () => {
			const leaf = this.app.workspace.getLeaf('tab');
			await leaf.openFile(file);
			await this.app.workspace.revealLeaf(leaf);
			if (task.primary.format !== 'inline') return;
			const editor = getCursorEditorFromView(leaf.view);
			if (!editor) return;
			const cursor = { line: task.primary.lineNumber, ch: 0 };
			editor.setCursor(cursor);
			editor.scrollIntoView?.({ from: cursor, to: cursor }, true);
		});
	}

	private openTaskFile(task: IndexedTask | IndexedTaskInstance): void {
		runAsyncAction('task file open failed', () => this.app.workspace.openLinkText(task.primary.filePath, '', false));
	}

	private initializeDuplicateAlertStatusBar(): void {
		const statusBarItem = this.addStatusBarItem();
		statusBarItem.addClass('operon-duplicate-alert-status-bar');
		statusBarItem.addClass('is-hidden');
		this.duplicateAlertStatusBarEl = statusBarItem;
	}

	private buildDuplicateConflictCounts(snapshot: DuplicateRegistrySnapshot): Map<string, number> {
		return new Map(snapshot.conflicts.map(conflict => [conflict.operonId, conflict.instances.length]));
	}

	private getDuplicateAlertDuplicateCount(snapshot: DuplicateRegistrySnapshot): number {
		return snapshot.conflicts.reduce((total, conflict) => total + Math.max(0, conflict.instances.length - 1), 0);
	}

	private getDuplicateAlertDelayMs(): number {
		const delaySeconds = Math.floor(this.settings.duplicateAlertDelaySeconds);
		const normalizedSeconds = (DUPLICATE_ALERT_DELAY_SECONDS_OPTIONS as readonly number[]).includes(delaySeconds)
			? delaySeconds
			: 10;
		return normalizedSeconds * 1000;
	}

	private buildDuplicateAlertSignature(snapshot: DuplicateRegistrySnapshot): string {
		return snapshot.conflicts
			.map(conflict => `${conflict.operonId}:${conflict.instances.length}`)
			.sort()
			.join('|');
	}

	private findDuplicateConflictIncrease(snapshot: DuplicateRegistrySnapshot, previousCounts: Map<string, number>): string | null {
		return snapshot.conflicts.find(conflict => conflict.instances.length > (previousCounts.get(conflict.operonId) ?? 0))?.operonId ?? null;
	}

	private hasDuplicateConflictDecrease(previousCounts: Map<string, number>, nextCounts: Map<string, number>): boolean {
		for (const [operonId, previousCount] of previousCounts) {
			if ((nextCounts.get(operonId) ?? 0) < previousCount) return true;
		}
		return false;
	}

	private isDuplicateConflictAutoOpenSuppressed(): boolean {
		return this.duplicateConflictAutoOpenSuppressionDepth > 0;
	}

	private syncDuplicateConflictUi(allowAutoOpen: boolean): void {
		const snapshot = this.indexer.getDuplicateRegistry();
		const previousCounts = this.duplicateConflictCounts;
		const nextCounts = this.buildDuplicateConflictCounts(snapshot);
		const autoOpenSuppressed = this.isDuplicateConflictAutoOpenSuppressed();
		const focusOperonId = allowAutoOpen && !autoOpenSuppressed
			? this.findDuplicateConflictIncrease(snapshot, previousCounts)
			: null;
		if (!autoOpenSuppressed) {
			this.duplicateConflictCounts = nextCounts;
		}
		this.duplicateOperonIdModal?.refresh(focusOperonId);
		if (focusOperonId) {
			this.scheduleDuplicateConflictAlert(focusOperonId);
			return;
		}
		if (autoOpenSuppressed) return;

		const duplicateCount = this.getDuplicateAlertDuplicateCount(snapshot);
		if (duplicateCount === 0) {
			this.handleDuplicateConflictsResolved();
		} else {
			if (this.duplicateAlertLastNoticeSignature !== null && this.hasDuplicateConflictDecrease(previousCounts, nextCounts)) {
				this.duplicateAlertLastNoticeSignature = this.buildDuplicateAlertSignature(snapshot);
			}
			if (this.duplicateAlertStatusBarState === 'conflict') {
				this.renderDuplicateAlertStatusBar('conflict', duplicateCount);
			}
		}
	}

	private scheduleDuplicateConflictAlert(focusOperonId: string | null = null): void {
		const snapshot = this.indexer.getDuplicateRegistry();
		if (this.getDuplicateAlertDuplicateCount(snapshot) === 0) {
			this.handleDuplicateConflictsResolved();
			return;
		}

		this.clearDuplicateAlertResolvedTimer();
		if (this.duplicateAlertStatusBarState === 'resolved') {
			this.hideDuplicateAlertStatusBar();
		}

		this.duplicateAlertPendingFocusOperonId = focusOperonId
			?? this.duplicateAlertPendingFocusOperonId
			?? snapshot.conflicts[0]?.operonId
			?? null;
		this.clearDuplicateAlertTimer();
		this.duplicateAlertTimer = setWindowTimeout(() => {
			this.duplicateAlertTimer = null;
			this.showDelayedDuplicateConflictAlert();
		}, this.getDuplicateAlertDelayMs());
	}

	private showDelayedDuplicateConflictAlert(): void {
		const snapshot = this.indexer.getDuplicateRegistry();
		const duplicateCount = this.getDuplicateAlertDuplicateCount(snapshot);
		if (duplicateCount === 0) {
			this.handleDuplicateConflictsResolved();
			return;
		}

		this.clearDuplicateAlertResolvedTimer();
		this.renderDuplicateAlertStatusBar('conflict', duplicateCount);
		const signature = this.buildDuplicateAlertSignature(snapshot);
		if (signature !== this.duplicateAlertLastNoticeSignature) {
			new Notice(this.formatDuplicateAlertNotice(duplicateCount));
			this.duplicateAlertLastNoticeSignature = signature;
		}
		if (this.settings.duplicateAlertAutoOpenManager) {
			this.openDuplicateOperonIdModal(this.duplicateAlertPendingFocusOperonId ?? snapshot.conflicts[0]?.operonId ?? null);
		}
		this.duplicateAlertPendingFocusOperonId = null;
	}

	private formatDuplicateAlertNotice(duplicateCount: number): string {
		return duplicateCount === 1
			? t('notifications', 'duplicateOperonIdAlertOne')
			: t('notifications', 'duplicateOperonIdAlertMany', { count: String(duplicateCount) });
	}

	private handleDuplicateConflictsResolved(): void {
		this.clearDuplicateAlertTimer();
		this.duplicateAlertPendingFocusOperonId = null;
		this.duplicateAlertLastNoticeSignature = null;
		if (this.duplicateAlertStatusBarState === 'conflict') {
			this.renderDuplicateAlertStatusBar('resolved');
			this.clearDuplicateAlertResolvedTimer();
			this.duplicateAlertResolvedTimer = setWindowTimeout(() => {
				this.duplicateAlertResolvedTimer = null;
				if (this.duplicateAlertStatusBarState === 'resolved') {
					this.hideDuplicateAlertStatusBar();
				}
			}, DUPLICATE_ALERT_RESOLVED_HIDE_DELAY_MS);
		} else if (this.duplicateAlertStatusBarState !== 'resolved') {
			this.hideDuplicateAlertStatusBar();
		}
	}

	private clearDuplicateAlertTimer(): void {
		if (!this.duplicateAlertTimer) return;
		clearWindowTimeout(this.duplicateAlertTimer);
		this.duplicateAlertTimer = null;
	}

	private clearDuplicateAlertResolvedTimer(): void {
		if (!this.duplicateAlertResolvedTimer) return;
		clearWindowTimeout(this.duplicateAlertResolvedTimer);
		this.duplicateAlertResolvedTimer = null;
	}

	private refreshDuplicateAlertStatusBar(): void {
		if (this.duplicateAlertStatusBarState === 'conflict') {
			const duplicateCount = this.getDuplicateAlertDuplicateCount(this.indexer.getDuplicateRegistry());
			if (duplicateCount > 0) {
				this.renderDuplicateAlertStatusBar('conflict', duplicateCount);
				return;
			}
		}
		if (this.duplicateAlertStatusBarState === 'resolved') {
			this.renderDuplicateAlertStatusBar('resolved');
		}
	}

	private renderDuplicateAlertStatusBar(state: Exclude<DuplicateAlertStatusBarState, 'hidden'>, duplicateCount = 0): void {
		const rootEl = this.duplicateAlertStatusBarEl;
		if (!rootEl) return;

		rootEl.empty();
		rootEl.removeClass('is-hidden');
		rootEl.removeClass('is-conflict');
		rootEl.removeClass('is-resolved');
		rootEl.addClass(`is-${state}`);
		this.duplicateAlertStatusBarState = state;

		const label = state === 'conflict'
			? t('duplicateOperonId', 'statusBarConflictLabel', { count: String(duplicateCount) })
			: t('duplicateOperonId', 'statusBarResolvedLabel');
		const button = rootEl.createEl('button', {
			cls: `operon-duplicate-alert-status-bar-button is-${state}`,
			attr: {
				type: 'button',
				'aria-label': label,
				title: label,
			},
		});
		setIcon(button, state === 'conflict' ? 'shield-alert' : 'shield-check');
		if (state === 'conflict') {
			button.createSpan({
				cls: 'operon-duplicate-alert-status-bar-count',
				text: String(duplicateCount),
			});
		}
		button.addEventListener('click', () => {
			this.openDuplicateOperonIdModal();
		});
	}

	private hideDuplicateAlertStatusBar(): void {
		this.duplicateAlertStatusBarState = 'hidden';
		const rootEl = this.duplicateAlertStatusBarEl;
		if (!rootEl) return;
		rootEl.empty();
		rootEl.removeClass('is-conflict');
		rootEl.removeClass('is-resolved');
		rootEl.addClass('is-hidden');
	}

	private async withDuplicateConflictAutoOpenSuppressed<T>(operation: () => Promise<T>): Promise<T> {
		const modalExistedBefore = !!this.duplicateOperonIdModal;
		this.duplicateConflictAutoOpenSuppressionDepth += 1;
		try {
			return await operation();
		} finally {
			this.duplicateConflictAutoOpenSuppressionDepth = Math.max(0, this.duplicateConflictAutoOpenSuppressionDepth - 1);
			this.syncDuplicateConflictUi(true);
			if (!modalExistedBefore && this.duplicateOperonIdModal && this.indexer.getDuplicateRegistry().conflicts.length === 0) {
				this.duplicateOperonIdModal.close();
			}
		}
	}

	private openDuplicateOperonIdModal(focusOperonId: string | null = null): void {
		if (this.duplicateOperonIdModal) {
			this.duplicateOperonIdModal.refresh(focusOperonId);
			return;
		}
		this.duplicateOperonIdModal = new DuplicateOperonIdModal(this.app, {
			getSnapshot: () => this.indexer.getDuplicateRegistry(),
			onOpenFile: task => this.openTaskFile(task),
			onRevealLine: task => this.navigateToTask(task),
			onOpenTaskEditor: task => {
				void this.openEditorForTaskInstance(task.instanceKey);
			},
			onDeleteCopy: async task => {
				return await this.confirmAndDeleteTaskInstance(task.instanceKey);
			},
			onRegenerateId: async task => {
				return await this.regenerateDuplicateTaskInstanceId(task.instanceKey);
			},
			onClose: () => {
				this.duplicateOperonIdModal = null;
			},
		});
		this.duplicateOperonIdModal.open();
		this.duplicateOperonIdModal.refresh(focusOperonId);
	}

	private redirectDuplicateOperonIdAction(operonId: string, showNotice = true): boolean {
		if (!this.indexer.hasDuplicateOperonIdConflict(operonId)) return false;
		if (showNotice) {
			this.scheduleDuplicateConflictAlert(operonId);
		}
		return true;
	}

	private async handleCalendarSlotSelection(
		leaf: import('obsidian').WorkspaceLeaf,
		selection: CalendarSlotSelection,
		options: { preserveMobileTimeGridScrollOnTaskCreate?: boolean } = {},
	): Promise<void> {
		const preserveMobileTimeGridScrollOnTaskCreate = options.preserveMobileTimeGridScrollOnTaskCreate === true;
		while (true) {
			const actionId = await this.promptCalendarSlotAction(selection, {
				preventInitialFocusScroll: preserveMobileTimeGridScrollOnTaskCreate,
			});
			if (!actionId) return;

			try {
				if (actionId === 'pickTask') {
					if (preserveMobileTimeGridScrollOnTaskCreate) {
						this.preserveMobileCalendarTimeGridScrollForLeaf(leaf);
					}
					await this.assignTaskToCalendarSelection(leaf, selection, {
						preventTaskFinderFocusScroll: preserveMobileTimeGridScrollOnTaskCreate,
					});
					return;
				}

				if (actionId === 'createTrackedSession') {
					if (preserveMobileTimeGridScrollOnTaskCreate) {
						this.preserveMobileCalendarTimeGridScrollForLeaf(leaf);
					}
					await this.createTrackedSessionFromCalendarSelection(selection, {
						preventTaskFinderFocusScroll: preserveMobileTimeGridScrollOnTaskCreate,
					});
					return;
				}

				if (actionId === 'createFileTask') {
					this.openCalendarTaskCreator(leaf, selection, 'file-only', null, '', {
						preserveMobileTimeGridScrollOnSubmit: preserveMobileTimeGridScrollOnTaskCreate,
						preventFocusScroll: preserveMobileTimeGridScrollOnTaskCreate,
					});
					return;
				}

				if (actionId === 'createInlineTask') {
					this.openCalendarTaskCreator(leaf, selection, 'inline-only', null, '', {
						preserveMobileTimeGridScrollOnSubmit: preserveMobileTimeGridScrollOnTaskCreate,
						preventFocusScroll: preserveMobileTimeGridScrollOnTaskCreate,
					});
					return;
				}
			} catch (error) {
				console.error('Operon: calendar timed slot action failed', error);
				new Notice(t('notifications', 'calendarEventActionFailed'));
				return;
			}
		}
	}

	private handleMobileCalendarSlotCreate(
		leaf: import('obsidian').WorkspaceLeaf,
		selection: CalendarSlotSelection,
	): void {
		setWindowTimeout(() => {
			void this.handleCalendarSlotSelection(leaf, selection, {
				preserveMobileTimeGridScrollOnTaskCreate: true,
			});
		}, 0);
	}

	private preserveMobileCalendarTimeGridScrollForLeaf(leaf: import('obsidian').WorkspaceLeaf): void {
		if (leaf.view instanceof CalendarView) {
			leaf.view.preserveMobileTimeGridScrollForTaskCreate();
		}
	}

	private async handleExternalCalendarItemCreate(
		leaf: import('obsidian').WorkspaceLeaf,
		seed: ExternalCalendarTaskSeed,
	): Promise<void> {
		while (true) {
			const actionId = await this.promptCalendarSlotAction(seed.selection, {
				title: t('modals', 'createTaskFromCalendarEvent'),
				actions: ['createFileTask', 'createInlineTask'],
			});
			if (!actionId) return;

			try {
				if (actionId === 'createFileTask') {
					this.openCalendarTaskCreator(leaf, seed.selection, 'file-only', null, seed.title);
					return;
				}

				if (actionId === 'createInlineTask') {
					this.openCalendarTaskCreator(leaf, seed.selection, 'inline-only', null, seed.title);
					return;
				}
			} catch (error) {
				console.error('Operon: external calendar action failed', error);
				new Notice(t('notifications', 'calendarEventActionFailed'));
				return;
			}
		}
	}

	private parseProjectedCalendarOccurrenceRef(taskId: string): ProjectedCalendarOccurrenceRef | null {
		const match = taskId.match(PROJECTED_CALENDAR_ITEM_ID_RE);
		if (!match) return null;
		return {
			seriesId: match[1],
			occurrenceDate: match[2],
		};
	}

	private getSeriesMaterializedTasks(seriesId: string): IndexedTask[] {
		return getSeriesMaterializedTasksFromTasks(this.indexer.getAllTasks(), seriesId);
	}

	private getRepeatRuleForSeries(seriesId: string): RepeatRule | null {
		const tasks = this.getSeriesMaterializedTasks(seriesId);
		for (let index = tasks.length - 1; index >= 0; index -= 1) {
			const rule = parseRepeatRule(tasks[index].fieldValues['repeat']);
			if (rule) return rule;
		}
		return null;
	}

	private canMoveRepeatScheduledDate(
		seriesId: string,
		occurrenceDate: string,
		scheduledDate: string,
		rule: RepeatRule,
	): boolean {
		const entry = this.storage.repeatSeries.getEntry(seriesId);
		const window = resolveMoveWindow({
			seriesId,
			tasks: this.indexer.getAllTasks(),
			entry,
			occurrenceDate,
			rule,
		});
		return canMoveOccurrenceDate({
			rule,
			occurrenceDate,
			scheduledDate,
			window,
		});
	}

	private showRepeatDateMoveLimit(rule: RepeatRule): void {
		const key = rule.freq === 'day' && rule.interval === 1
			? 'dailyRecurringDateMoveLimit'
			: 'recurringDateMoveWindowLimit';
		new Notice(t('notifications', key));
	}

	private isLatestMaterializedRecurringTask(task: IndexedTask): boolean {
		return isLatestMaterializedRecurringTaskFromTasks(task, this.indexer.getAllTasks());
	}

	private async ensureSeriesBaseTemporalTemplate(task: IndexedTask): Promise<void> {
		const seriesId = (task.fieldValues['repeatSeriesId'] ?? '').trim();
		if (!seriesId) return;
		const entry = this.storage.repeatSeries.getEntry(seriesId);
		if (!entry) return;
		if (entry.baseTemporalTemplate) return;
		await this.storage.repeatSeries.updateBaseTemporalTemplate(seriesId, deriveTemporalTemplateFromTask(task), localNow());
	}

	private resolveProjectedOccurrenceCurrentSnapshot(
		seriesId: string,
		occurrenceDate: string,
	): RepeatTemporalSnapshot | null {
		const entry = this.storage.repeatSeries.getEntry(seriesId);
		if (!entry) return null;
		const materializedTasks = this.getSeriesMaterializedTasks(seriesId);
		const fallbackTask = materializedTasks[0];
		if (!fallbackTask) return null;
		const occurrencePlan = resolveOccurrencePlan({
			entry,
			occurrenceDate,
			fallbackTemplate: deriveTemporalTemplateFromTask(fallbackTask),
		});
		if (!occurrencePlan) return null;
		const template = occurrencePlan.temporalTemplate;
		const startDate = shiftDateKey(occurrenceDate, template.startDateShiftDays);
		const endDate = shiftDateKey(occurrenceDate, template.endDateShiftDays);
		return buildRepeatTemporalSnapshotFromFieldValues(occurrenceDate, {
			dateScheduled: occurrencePlan.scheduledDate,
			dateStarted: template.mode === 'allDay' ? startDate : '',
			dateDue: template.mode === 'allDay' ? endDate : '',
			datetimeStart: template.mode === 'timed' && template.startTime ? `${startDate}T${template.startTime}` : '',
			datetimeEnd: template.mode === 'timed' && template.endTime ? `${endDate}T${template.endTime}` : '',
			estimate: template.estimate ?? '',
		});
	}

	private async promptRepeatScopeForTemporalChange(
		title: string,
		currentSnapshot: RepeatTemporalSnapshot | null,
		nextSnapshot: RepeatTemporalSnapshot | null,
	): Promise<RepeatEditScopeChoice | null> {
		const labels = buildRepeatScopeModalLabels({
			current: currentSnapshot,
			pending: nextSnapshot,
		});
		return await promptRepeatOccurrenceScope(this.app, {
			title,
			beforeSnapshotLabel: labels.beforeLabel,
			afterSnapshotLabel: labels.afterLabel,
		});
	}

	private async applyProjectedCalendarTemporalEdit(
		projected: ProjectedCalendarOccurrenceRef,
		selection: CalendarSlotSelection,
		options: { preserveExistingDuration?: boolean } = {},
	): Promise<boolean> {
		const currentSnapshot = this.resolveProjectedOccurrenceCurrentSnapshot(projected.seriesId, projected.occurrenceDate);
		const nextSnapshot = buildRepeatTemporalSnapshotFromSelection(
			projected.occurrenceDate,
			selection,
			{ estimate: currentSnapshot?.estimate ?? '' },
			options,
		);
		if (!currentSnapshot || !nextSnapshot || !hasRepeatTemporalChange(currentSnapshot, nextSnapshot)) {
			return false;
		}
		const scope = await this.promptRepeatScopeForTemporalChange(
			t('modals', 'editRecurringTaskOccurrence'),
			currentSnapshot,
			nextSnapshot,
		);
		if (!scope) {
			this.refreshViews();
			return true;
		}
		const rule = this.getRepeatRuleForSeries(projected.seriesId);
		if (scope === 'thisTask' && rule && !this.canMoveRepeatScheduledDate(
			projected.seriesId,
			projected.occurrenceDate,
			nextSnapshot.scheduledDate,
			rule,
		)) {
			this.showRepeatDateMoveLimit(rule);
			this.refreshViews();
			return true;
		}

		const now = localNow();
		if (scope === 'skipThisTask') {
			await this.storage.repeatSeries.skipOccurrence(projected.seriesId, projected.occurrenceDate, now);
		} else if (scope === 'thisTask') {
			await this.storage.repeatSeries.upsertSingleOverride(
				projected.seriesId,
				buildSingleOccurrenceOverride(nextSnapshot, now),
				now,
			);
		} else {
			const overrideCommitted = await this.storage.repeatSeries.upsertFollowingOverride(
				projected.seriesId,
				buildFollowingOverride(nextSnapshot, now),
				now,
			);
			if (!overrideCommitted) return false;
		}

		this.refreshViews();
		return true;
	}

	private async applyLatestMaterializedCalendarTemporalEdit(
		task: IndexedTask,
		payload: Record<string, string>,
		changedKeys: string[],
	): Promise<boolean> {
		await this.ensureSeriesBaseTemporalTemplate(task);
		const occurrenceDate = getTaskRepeatOccurrenceDate(task);
		const currentSnapshot = buildRepeatTemporalSnapshotFromFieldValues(occurrenceDate, task.fieldValues);
		const nextSnapshot = buildRepeatTemporalSnapshotFromFieldValues(occurrenceDate, {
			...task.fieldValues,
			...payload,
		});
		if (!currentSnapshot || !nextSnapshot || !hasRepeatTemporalChange(currentSnapshot, nextSnapshot)) {
			return false;
		}
		const scope = await this.promptRepeatScopeForTemporalChange(
			t('modals', 'editRecurringTaskOccurrence'),
			currentSnapshot,
			nextSnapshot,
		);
		if (!scope) {
			this.refreshViews();
			return true;
		}
		const seriesId = (task.fieldValues['repeatSeriesId'] ?? '').trim();
		const rule = seriesId ? this.getRepeatRuleForSeries(seriesId) ?? parseRepeatRule(task.fieldValues['repeat']) : null;
		if (scope === 'thisTask' && seriesId && rule && !this.canMoveRepeatScheduledDate(
			seriesId,
			occurrenceDate,
			nextSnapshot.scheduledDate,
			rule,
		)) {
			this.showRepeatDateMoveLimit(rule);
			this.refreshViews();
			return true;
		}

		const now = localNow();
		if (scope === 'skipThisTask') {
			await this.updateTaskFieldsAndRefresh(task.operonId, {
				_checkbox: 'cancelled',
				dateCancelled: localToday(),
				dateCompleted: '',
			}, {
				changedKeys: ['dateCancelled'],
			});
			this.refreshViews();
			return true;
		}

		const persistedPayload = { ...payload };
		const persistedChangedKeys = [...changedKeys];
		let followingSnapshot = nextSnapshot;
		if (scope === 'thisAndFollowingTasks') {
			followingSnapshot = reanchorRepeatTemporalSnapshotToScheduledDate(nextSnapshot);
			persistedPayload['repeatOccurrenceDate'] = followingSnapshot.occurrenceDate;
			if (!persistedChangedKeys.includes('repeatOccurrenceDate')) {
				persistedChangedKeys.push('repeatOccurrenceDate');
			}
		}

		const pendingFollowingOverride = scope === 'thisAndFollowingTasks' && seriesId
			? buildFollowingOverride(followingSnapshot, now)
			: null;
		const taskCommitted = await this.persistTaskMutationWithFollowingOverride(
			seriesId,
			pendingFollowingOverride,
			now,
			() => this.updateTaskFieldsAndRefresh(
				task.operonId,
				persistedPayload,
				{ changedKeys: persistedChangedKeys },
			),
			() => this.isPendingRepeatIdentityCommitted(
				this.indexer.getTask(task.operonId),
				followingSnapshot,
				pendingFollowingOverride,
			),
		);
		if (!taskCommitted) return false;
		if (scope === 'thisAndFollowingTasks' && seriesId) {
			if (!pendingFollowingOverride) return false;
			const afterTask = this.indexer.getTask(task.operonId);
			if (!this.isPendingRepeatIdentityCommitted(afterTask, followingSnapshot, pendingFollowingOverride)) {
				console.error('Operon: Calendar edit did not persist the reanchored occurrence identity');
				return false;
			}
		}
		this.refreshViews();
		return true;
	}

	private async handleContextualMenuAction(
		taskId: string,
		actionId: ContextualMenuActionId,
		sourceContext?: ContextualMenuContext,
		invocation?: ContextualMenuActionInvocation,
	): Promise<void> {
		const context = sourceContext ?? this.buildFallbackContextualMenuContext(taskId);

		await executeContextualMenuAction(context, actionId, {
			cycleStatus: async (id) => {
				await this.handleCalendarStatusIconClick(id);
			},
			togglePin: async (id) => {
				if (!this.pinnedCache) return;
				await this.pinnedCache.toggle(id);
				this.refreshViews();
			},
			openEditor: async (id) => {
				this.openEditorForId(id);
			},
			openSubtasks: (id) => {
				this.openSubtasksForTaskId(id);
			},
			createSubtask: async (id) => {
				await this.requestSubtaskForParentId(id);
			},
			openCheckboxes: async (id, actionAnchor, actionAnchorRect) => {
				await this.openCheckboxesForTaskId(id, actionAnchor, actionAnchorRect);
			},
			startTimer: async (id) => {
				await this.startTimerForTask(id, 'command');
			},
			markDone: async (id) => {
				await this.markTaskDoneById(id);
			},
			cancelTask: async (id) => {
				await this.cancelTaskById(id);
			},
			unschedule: async (id) => {
				await this.unscheduleTaskById(id);
			},
			jumpToSource: async (id) => {
				const indexedTask = this.indexer.getTask(id);
				if (!indexedTask) return;
				this.navigateToTask(indexedTask);
			},
			setAsTracked: async (id, start, end) => {
				const added = await this.timeTracker.addSession(id, start, end);
				if (!added) {
					new Notice(t('notifications', 'calendarTrackedSessionSaveFailed'));
					return;
				}
				this.refreshTimeSessionHistoryLeaves(true);
				this.refreshViews();
				const task = this.indexer.getTask(id);
				const startDate = parseLocalDatetime(start);
				const endDate = parseLocalDatetime(end);
				const durationSeconds = startDate && endDate
					? Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / 1000))
					: 0;
				new Notice(t('notifications', 'calendarPlannedTimeLoggedAsTracked', {
					task: task?.description || id,
					duration: formatDurationHuman(durationSeconds),
					range: this.formatCalendarTrackedSessionRange(start, end),
				}));
			},
			clearDueDate: async (id) => {
				const indexedTask = this.indexer.getTask(id);
				if (!indexedTask || !(indexedTask.fieldValues['dateDue'] ?? '').trim()) return;
				await this.updateTaskFieldsAndRefresh(indexedTask.operonId, { dateDue: '' }, {
					changedKeys: ['dateDue'],
				});
				this.refreshViews();
			},
			openReminderPicker: async (id, fieldKey, actionAnchor, actionAnchorRect) => {
				await this.openReminderPickerForTaskId(id, fieldKey, actionAnchor, actionAnchorRect);
			},
			convertInlineToFileTask: async (id) => {
				await this.convertInlineTaskToFileTaskById(id);
			},
			convertFileToInlineTask: async (id) => {
				await this.convertFileTaskToInlineTaskById(id);
			},
			openProjectedOccurrenceLatestTaskEditor: async (projectedRef) => {
				await this.openProjectedOccurrenceLatestTaskEditor(projectedRef);
			},
			skipProjectedOccurrence: async (projectedRef) => {
				const rule = this.getRepeatRuleForSeries(projectedRef.seriesId);
				if (rule?.mode === 'done') return;
				await this.storage.repeatSeries.skipOccurrence(projectedRef.seriesId, projectedRef.occurrenceDate, localNow());
				this.refreshViews();
				new Notice(t('notifications', 'skippedThisOccurrence'));
			},
		}, invocation);
	}

	private async openReminderPickerForTaskId(
		taskId: string,
		fieldKey: 'reminderDatetimes' | 'reminderRules',
		actionAnchor?: HTMLElement | null,
		actionAnchorRect?: DOMRect | null,
	): Promise<void> {
		const indexedTask = this.indexer.getTask(taskId);
		if (!indexedTask) {
			new Notice(t('notifications', 'taskNotInIndex'));
			return;
		}
		if (indexedTask.checkbox !== 'open') return;
		const fieldEnabled = this.settings.keyMappings.some(mapping => (
			mapping.canonicalKey === fieldKey && mapping.isSystem !== false
		));
		if (!fieldEnabled) return;
		if (
			fieldKey === 'reminderRules'
			&& getAvailableReminderRuleAnchors(indexedTask.fieldValues).length === 0
		) return;

		const { anchor, cleanup } = this.resolveContextualActionAnchor(actionAnchor, actionAnchorRect);
		let pickerClosed = false;
		const cleanupPickerAnchor = () => {
			if (pickerClosed) return;
			pickerClosed = true;
			cleanup();
		};
		const closePanel = openTaskFieldPicker({
			app: this.app,
			settings: this.settings,
			allTasks: this.indexer.getAllTasks(),
			canonicalKey: fieldKey,
			anchor,
			currentFieldValues: indexedTask.fieldValues,
			getCurrentFieldValues: () => this.indexer.getTask(taskId)?.fieldValues ?? indexedTask.fieldValues,
			currentTags: indexedTask.tags,
			currentTaskId: indexedTask.operonId,
			taskFormat: indexedTask.primary.format,
			reminderOperation: { kind: 'add' },
			onCommit: payload => {
				const fieldValue = payload[fieldKey];
				runAsyncAction('contextual reminder save failed', async () => {
					const result = await commitContextualReminderValue({
						fieldValue,
						getTaskCheckbox: () => this.indexer.getTask(taskId)?.checkbox ?? null,
						write: value => this.updateTaskFieldsAndRefresh(taskId, { [fieldKey]: value }, {
							changedKeys: [fieldKey],
						}),
					});
					if (result.status === 'saved') return;
					if (result.status === 'task-missing') {
						new Notice(t('notifications', 'taskNotInIndex'));
						return;
					}
					if (result.status === 'write-failed') {
						console.error('Operon: contextual reminder save failed', result.error);
					}
					new Notice(t('reminders', 'saveFailed'));
				});
			},
			onCancel: cleanupPickerAnchor,
			onClose: cleanupPickerAnchor,
		});
		if (!closePanel) cleanupPickerAnchor();
	}

	private async openCheckboxesForTaskId(
		taskId: string,
		actionAnchor?: HTMLElement | null,
		actionAnchorRect?: DOMRect | null,
	): Promise<void> {
		const indexedTask = this.indexer.getTask(taskId);
		if (!indexedTask) {
			new Notice(t('notifications', 'taskNotInIndex'));
			return;
		}
		const { anchor, cleanup } = this.resolveContextualActionAnchor(actionAnchor, actionAnchorRect);
		await showPlainCheckboxPopover(anchor, {
			app: this.app,
			task: indexedTask,
			keyMappings: this.settings.keyMappings,
			taskColor: this.resolveCheckboxPopoverTaskColor(indexedTask),
			seedEmptyDraft: (indexedTask.plainCheckboxProgress?.total ?? 0) <= 0,
			centerOnDesktop: true,
			onDispose: cleanup,
		});
	}

	private openSubtasksForTaskId(taskId: string): void {
		const indexedTask = this.indexer.getTask(taskId);
		if (!indexedTask) {
			new Notice(t('notifications', 'taskNotInIndex'));
			return;
		}
		if (indexedTask.checkbox !== 'open') return;
		if (this.indexer.secondary.getChildIds(indexedTask.operonId).size <= 0) return;

		this.subtasksFilterModal?.close();
		let modal: SubtasksFilterModal | null = null;
		modal = new SubtasksFilterModal(this.app, {
			parentTaskId: indexedTask.operonId,
			deps: this.buildFilterSurfaceDeps(),
			onEditFilter: (template) => this.openDynamicSubtasksFilterSettings(template),
			onClose: () => {
				if (this.subtasksFilterModal === modal) {
					this.subtasksFilterModal = null;
				}
			},
		});
		this.subtasksFilterModal = modal;
		modal.open();
	}

	private resolveContextualActionAnchor(
		actionAnchor?: HTMLElement | null,
		actionAnchorRect?: DOMRect | null,
	): {
		anchor: HTMLElement;
		cleanup: () => void;
	} {
		if (!actionAnchorRect && actionAnchor?.isConnected) {
			return { anchor: actionAnchor, cleanup: () => undefined };
		}
		const document = actionAnchor?.ownerDocument ?? getActiveDocument();
		const anchor = document.win.createSpan();
		const left = actionAnchorRect?.left ?? 0;
		const top = actionAnchorRect?.top ?? 0;
		const width = Math.max(1, actionAnchorRect?.width ?? 1);
		const height = Math.max(1, actionAnchorRect?.height ?? 1);
		anchor.setAttribute('aria-hidden', 'true');
		anchor.setCssProps({
			display: 'block',
			position: 'fixed',
			left: `${Math.round(left)}px`,
			top: `${Math.round(top)}px`,
			width: `${Math.round(width)}px`,
			height: `${Math.round(height)}px`,
			opacity: '0',
			pointerEvents: 'none',
		});
		document.body.appendChild(anchor);
		return {
			anchor,
			cleanup: () => anchor.remove(),
		};
	}

	private resolveCheckboxPopoverTaskColor(task: IndexedTask): string | null {
		return resolveTaskColorSourceForTask(task, 'taskColor', this.settings)
			?? resolveTaskColorSourceForTask(task, 'statusColor', this.settings)
			?? resolveTaskColorSourceForTask(task, 'priorityColor', this.settings);
	}

	private buildFallbackContextualMenuContext(taskId: string): ContextualMenuContext {
		const projected = this.parseProjectedCalendarOccurrenceRef(taskId);
		const task = this.indexer.getTask(taskId);
		return {
			surface: projected ? 'calendarProjectedOccurrence' : 'filterTask',
			taskId,
			task: task ?? null,
			now: localNow(),
			hasSubtasks: task ? this.indexer.secondary.getChildIds(task.operonId).size > 0 : false,
			projectedRef: projected
				? { seriesId: projected.seriesId, occurrenceDate: projected.occurrenceDate }
				: null,
		};
	}

	private async openProjectedOccurrenceLatestTaskEditor(
		projected: ProjectedCalendarOccurrenceRef,
	): Promise<void> {
		const tasks = this.getSeriesMaterializedTasks(projected.seriesId);
		const latestTask = tasks[tasks.length - 1] ?? null;
		if (!latestTask) return;
		new Notice(t('notifications', 'openingLatestRecurringRealTask'));
		this.openEditorForId(latestTask.operonId);
	}

	private async handleCalendarStatusIconClick(taskId: string): Promise<void> {
		await this.cycleTaskStatusById(taskId);
	}

	private async handleCalendarScheduledMove(taskId: string, selection: CalendarSlotSelection): Promise<void> {
		const projected = this.parseProjectedCalendarOccurrenceRef(taskId);
		if (projected) {
			await this.applyProjectedCalendarTemporalEdit(projected, selection, {
				preserveExistingDuration: true,
			});
			return;
		}
		const task = this.indexer.getTask(taskId);
		if (!task) return;

		const writebackPlan = buildAllDayMoveWritebackPlan(task.fieldValues, selection.startDate);
		const payload = this.normalizeCalendarPayloadForPersistedUpdate(writebackPlan);
		if (Object.keys(payload).length === 0) return;

		const changedKeys = Object.keys(payload);
		if (this.isLatestMaterializedRecurringTask(task)) {
			const handled = await this.applyLatestMaterializedCalendarTemporalEdit(task, payload, changedKeys);
			if (handled) return;
		}

		await this.updateTaskFieldsAndRefresh(task.operonId, payload, {
			changedKeys,
		});
		this.refreshViews();
	}

	private async handleCalendarTimedMove(
		taskId: string,
		selection: CalendarSlotSelection,
		sourcePayload?: Record<string, string | undefined>,
	): Promise<boolean> {
		const projected = this.parseProjectedCalendarOccurrenceRef(taskId);
		if (projected) {
			await this.applyProjectedCalendarTemporalEdit(projected, selection, {
				preserveExistingDuration: true,
			});
			return true;
		}
		const task = this.indexer.getTask(taskId);
		if (!task) return false;

		const payload = sourcePayload
			? this.normalizeCalendarPayloadForPersistedUpdate({ payload: sourcePayload })
			: (() => {
				const writebackPlan = buildTimedCalendarWritebackPlanForExistingTask(selection, task.fieldValues, {
					preserveExistingDuration: true,
				});
				writebackPlan.payload.dateStarted = '';
				return this.normalizeCalendarPayloadForPersistedUpdate(writebackPlan);
			})();
		if (Object.keys(payload).length === 0) return false;

		const changedKeys = Object.keys(payload);
		if (this.isLatestMaterializedRecurringTask(task)) {
			const handled = await this.applyLatestMaterializedCalendarTemporalEdit(task, payload, changedKeys);
			if (handled) return true;
		}

		const updated = await this.updateTaskFieldsAndRefresh(task.operonId, payload, {
			changedKeys,
		});
		this.refreshViews();
		return updated;
	}

	private async handleCalendarTimedResize(
		taskId: string,
		selection: CalendarSlotSelection,
		sourcePayload?: Record<string, string | undefined>,
	): Promise<boolean> {
		const projected = this.parseProjectedCalendarOccurrenceRef(taskId);
		if (projected) {
			await this.applyProjectedCalendarTemporalEdit(projected, selection);
			return true;
		}
		const task = this.indexer.getTask(taskId);
		if (!task) return false;

		const payload = sourcePayload
			? this.normalizeCalendarPayloadForPersistedUpdate({ payload: sourcePayload })
			: (() => {
				const writebackPlan = buildTimedCalendarWritebackPlan(selection);
				writebackPlan.payload.dateStarted = '';
				return this.normalizeCalendarPayloadForPersistedUpdate(writebackPlan);
			})();
		if (Object.keys(payload).length === 0) return false;

		const changedKeys = Object.keys(payload);
		if (this.isLatestMaterializedRecurringTask(task)) {
			const handled = await this.applyLatestMaterializedCalendarTemporalEdit(task, payload, changedKeys);
			if (handled) return true;
		}

		const updated = await this.updateTaskFieldsAndRefresh(task.operonId, payload, {
			changedKeys,
		});
		this.refreshViews();
		return updated;
	}

	private resolveTrackedSessionByRange(session: CalendarTrackedSessionRef): TrackerSession | null {
		if (!session.operonId) return null;
		const sessions = this.timeTracker.getTaskSessions(session.operonId);
		if (typeof session.sessionIndex === 'number') {
			const candidate = sessions.find(entry => entry.sessionIndex === session.sessionIndex);
			if (candidate?.start === session.start && candidate.end === session.end) {
				return candidate;
			}
		}
		const matches = sessions.filter(candidate => candidate.start === session.start && candidate.end === session.end);
		return matches.length === 1 ? matches[0] : null;
	}

	private formatCalendarTrackedSessionRange(start: string, end: string): string {
		const startDate = start.substring(0, 10);
		const endDate = end.substring(0, 10);
		const startTime = formatUiTime(this.app, this.settings, start);
		const endTime = formatUiTime(this.app, this.settings, end);
		if (startDate && startDate === endDate) {
			return `${startDate} ${startTime}-${endTime}`;
		}
		return `${startDate || start} ${startTime} - ${endDate || end} ${endTime}`;
	}

	private handleCalendarTrackedSessionStale(): void {
		new Notice(t('notifications', 'calendarTrackedSessionStale'));
		this.refreshTimeSessionHistoryLeaves(true);
		this.refreshViews();
	}

	private async handleCalendarTrackedSessionUpdate(
		session: CalendarTrackedSessionRef,
		selection: CalendarSlotSelection,
	): Promise<void> {
		if (selection.mode !== 'timed' || !session.operonId) return;
		const currentSession = this.resolveTrackedSessionByRange(session);
		if (!currentSession) {
			this.handleCalendarTrackedSessionStale();
			return;
		}
		const task = currentSession?.task ?? this.indexer.getTask(session.operonId) ?? null;
		const updated = await this.timeTracker.updateSessionByRange(
			session.operonId,
			session.start,
			session.end,
			selection.start,
			selection.end,
			session.sessionIndex,
		);
		if (!updated) {
			this.handleCalendarTrackedSessionStale();
			return;
		}
		this.refreshTimeSessionHistoryLeaves(true);
		this.refreshViews();
		new Notice(formatTaskNotice('time-session-edited', {
			description: task?.description ?? session.operonId,
			operonId: session.operonId,
		}));
	}

	private openCalendarTrackedSessionEditor(session: CalendarTrackedSessionRef): void {
		if (!session.operonId) return;
		const currentSession = this.resolveTrackedSessionByRange(session);
		const task = currentSession?.task ?? this.indexer.getTask(session.operonId) ?? null;
		if (!currentSession || !task) {
			this.handleCalendarTrackedSessionStale();
			return;
		}
		const taskLabel = task.description || task.operonId;

		new TrackerSessionEditModal(this.app, {
			title: t('taskEditor', 'editSession'),
			...buildTrackerSessionEditContext({
				taskLabel,
				start: currentSession.start,
				end: currentSession.end,
			}),
			initialStart: currentSession.start,
			initialEnd: currentSession.end,
			onSave: async (start, end) => {
				const updated = await this.timeTracker.updateSessionByRange(
					session.operonId,
					session.start,
					session.end,
					start,
					end,
					session.sessionIndex,
				);
				if (!updated) {
					this.handleCalendarTrackedSessionStale();
					return false;
				}
				this.refreshTimeSessionHistoryLeaves(true);
				this.refreshViews();
				new Notice(formatTaskNotice('time-session-edited', {
					description: taskLabel,
					operonId: session.operonId,
				}));
				return true;
			},
			onDelete: async () => {
				const deleted = await this.timeTracker.deleteSessionByRange(
					session.operonId,
					session.start,
					session.end,
					session.sessionIndex,
				);
				if (!deleted) {
					this.handleCalendarTrackedSessionStale();
					return false;
				}
				this.refreshTimeSessionHistoryLeaves(true);
				this.refreshViews();
				new Notice(t('notifications', 'calendarTrackedSessionDeleted', { task: taskLabel }));
				return true;
			},
		}).open();
	}

	private async handleCalendarTimedDropToAllDay(taskId: string, selection: CalendarSlotSelection): Promise<void> {
		const projected = this.parseProjectedCalendarOccurrenceRef(taskId);
		if (projected) {
			await this.applyProjectedCalendarTemporalEdit(projected, selection);
			return;
		}
		const task = this.indexer.getTask(taskId);
		if (!task) return;

		const writebackPlan = buildAllDayCalendarWritebackPlan(selection);
		const payload = this.normalizeCalendarPayloadForPersistedUpdate(writebackPlan);
		if (Object.keys(payload).length === 0) return;

		const changedKeys = Object.keys(payload);
		if (this.isLatestMaterializedRecurringTask(task)) {
			const handled = await this.applyLatestMaterializedCalendarTemporalEdit(task, payload, changedKeys);
			if (handled) return;
		}

		await this.updateTaskFieldsAndRefresh(task.operonId, payload, {
			changedKeys,
		});
		this.refreshViews();
	}

	private async handleCalendarAllDayDropToTimed(
		taskId: string,
		selection: CalendarSlotSelection,
		sourcePayload?: Record<string, string | undefined>,
	): Promise<boolean> {
		const projected = this.parseProjectedCalendarOccurrenceRef(taskId);
		if (projected) {
			await this.applyProjectedCalendarTemporalEdit(projected, selection, {
				preserveExistingDuration: true,
			});
			return true;
		}
		const task = this.indexer.getTask(taskId);
		if (!task) return false;

		const payload = sourcePayload
			? this.normalizeCalendarPayloadForPersistedUpdate({ payload: sourcePayload })
			: (() => {
				const writebackPlan = buildTimedCalendarWritebackPlanForExistingTask(selection, task.fieldValues, {
					preserveExistingDuration: true,
				});
				writebackPlan.payload.dateStarted = '';
				if (isExpandedAllDayRange(task.fieldValues)) {
					writebackPlan.payload.dateDue = '';
				}
				return this.normalizeCalendarPayloadForPersistedUpdate(writebackPlan);
			})();
		if (Object.keys(payload).length === 0) return false;

		const changedKeys = Object.keys(payload);
		if (this.isLatestMaterializedRecurringTask(task)) {
			const handled = await this.applyLatestMaterializedCalendarTemporalEdit(task, payload, changedKeys);
			if (handled) return true;
		}

		const updated = await this.updateTaskFieldsAndRefresh(task.operonId, payload, {
			changedKeys,
		});
		this.refreshViews();
		return updated;
	}

	private async handleCalendarScheduledResizeRight(taskId: string, selection: CalendarSlotSelection): Promise<void> {
		const projected = this.parseProjectedCalendarOccurrenceRef(taskId);
		if (projected) {
			await this.applyProjectedCalendarTemporalEdit(projected, selection);
			return;
		}
		const task = this.indexer.getTask(taskId);
		if (!task) return;

		const writebackPlan = buildAllDayResizeRightWritebackPlan(task.fieldValues, selection.endDate);
		const payload = this.normalizeCalendarPayloadForPersistedUpdate(writebackPlan);
		if (Object.keys(payload).length === 0) return;

		const changedKeys = Object.keys(payload);
		if (this.isLatestMaterializedRecurringTask(task)) {
			const handled = await this.applyLatestMaterializedCalendarTemporalEdit(task, payload, changedKeys);
			if (handled) return;
		}

		await this.updateTaskFieldsAndRefresh(task.operonId, payload, {
			changedKeys,
		});
		this.refreshViews();
	}

	private async handleCalendarSidebarTaskDrop(
		leaf: import('obsidian').WorkspaceLeaf,
		taskId: string,
		selection: CalendarSlotSelection,
	): Promise<void> {
		const task = this.indexer.getTask(taskId);
		if (!task) return;

		const filterSet = this.getCalendarFilterSetForLeaf(leaf);
		const writebackPlan = selection.mode === 'timed'
			? buildTimedCalendarWritebackPlanForExistingTask(selection, task.fieldValues, {
				preserveExistingDuration: true,
			})
			: buildCalendarWritebackPlan(selection);
		if (selection.mode === 'timed') {
			writebackPlan.payload.dateStarted = '';
			if (isExpandedAllDayRange(task.fieldValues)) {
				writebackPlan.payload.dateDue = '';
			}
		}
		const payload = this.normalizeCalendarPayloadForPersistedUpdate(writebackPlan);
		if (Object.keys(payload).length === 0) return;

		const nextDraft = {
			description: task.description,
			checkbox: task.checkbox,
			fieldValues: {
				...task.fieldValues,
				...payload,
			},
			tags: [...task.tags],
		};

		await this.updateTaskFieldsAndRefresh(task.operonId, payload, {
			changedKeys: Object.keys(payload),
		});
		this.refreshViews();
		await this.maybeOpenCalendarEditorForFilterMismatch(filterSet, nextDraft, () => {
			this.openEditorForId(task.operonId);
		});
	}

	private openRelatedViewTarget(target: RelatedViewOpenTarget): Promise<void> | void {
		if (target.type === 'filter') return this.openFilterViewById(target.presetId);
		if (target.type === 'calendar') return this.openCalendarView({ presetId: target.presetId });
		if (target.type === 'kanban') return this.openKanbanView({ presetId: target.presetId });
		return this.openOperonTable({ presetId: target.presetId });
	}

	private async createRelatedViewPresetAndOpen(target: RelatedViewCreateTarget): Promise<void> {
		if (target.type === 'calendar') {
			const preset = this.createRelatedCalendarPreset(target.variant, target.filterSetId, target.presetName);
			this.settings.calendarPresets.push(preset);
			if (!this.settings.calendarDefaultPresetId) {
				this.settings.calendarDefaultPresetId = this.settings.calendarPresets[0]?.id ?? null;
			}
			this.applyCalendarPresetSaveEffects(preset);
			await this.storage.saveSettings();
			this.refreshViews();
			await this.openCalendarView({ presetId: preset.id });
			return;
		}
		if (target.type === 'kanban') {
			const preset = this.createRelatedKanbanPreset(target.filterSetId, target.presetName);
			this.settings.kanbanPresets.push(preset);
			if (!this.settings.kanbanDefaultPresetId) {
				this.settings.kanbanDefaultPresetId = this.settings.kanbanPresets[0]?.id ?? null;
			}
			await this.storage.saveSettings();
			await this.handleKanbanSortModeChange(preset.id, preset.sortMode);
			this.refreshViews();
			await this.openKanbanView({ presetId: preset.id });
			return;
		}
		const preset = this.createRelatedTablePreset(target.filterSetId, target.presetName);
		await this.addTablePresetAndRefresh(preset);
		await this.openOperonTable({ presetId: preset.id });
	}

	private createRelatedCalendarPreset(
		variant: Extract<RelatedViewCreateTarget, { type: 'calendar' }>['variant'],
		filterSetId: string | null,
		presetName?: string,
	): CalendarPreset {
		const defaults = cloneDefaultCalendarPresets();
		const template = variant === 'multiWeek'
			? defaults.find(preset => preset.surfaceType === 'multiWeek') ?? defaults[0]
			: defaults.find(preset => preset.surfaceType === 'timeGrid') ?? defaults[0];
		return {
			...template,
			id: createCalendarPresetId(),
			name: buildUniqueRelatedPresetName(presetName ?? this.getRelatedCalendarPresetName(variant), this.settings.calendarPresets),
			surfaceType: variant,
			filterSetId,
			externalCalendarVisibility: { ...template.externalCalendarVisibility },
		};
	}

	private getRelatedCalendarPresetName(variant: Extract<RelatedViewCreateTarget, { type: 'calendar' }>['variant']): string {
		if (variant === 'timeTrackerGrid') return t('table', 'relatedViewsCalendarTimeTrackerGridPresetName');
		if (variant === 'multiWeek') return t('table', 'relatedViewsCalendarMultiWeekPresetName');
		return t('table', 'relatedViewsCalendarTimeGridPresetName');
	}

	private createRelatedKanbanPreset(filterSetId: string | null, presetName?: string): KanbanPreset {
		const template = cloneDefaultKanbanPresets()[0];
		return {
			...template,
			id: createKanbanPresetId(),
			name: buildUniqueRelatedPresetName(presetName ?? t('table', 'relatedViewsKanbanDefaultPipelinePresetName'), this.settings.kanbanPresets),
			pipelineId: this.resolveDefaultKanbanPipelineId(),
			filterSetId,
			sortRules: template.sortRules.map(rule => ({ ...rule })),
		};
	}

	private resolveDefaultKanbanPipelineId(): string | null {
		const explicitDefault = resolveConfiguredPipelineNameIdentity(
			this.settings.defaultPipelineName,
			buildWorkflowStatusIdentityIndex(this.settings.pipelines),
		);
		if (explicitDefault.kind === 'ambiguous') return null;
		return (explicitDefault.kind === 'configured' ? explicitDefault.pipeline : this.settings.pipelines[0])?.id ?? null;
	}

	private createRelatedTablePreset(filterSetId: string | null, presetName?: string): TablePreset {
		const preset = createDefaultTablePreset();
		return {
			...preset,
			id: createTablePresetId(),
			name: buildUniqueRelatedPresetName(presetName ?? t('table', 'relatedViewsTableDefaultPresetName'), this.settings.tablePresets),
			filterSetId,
			columns: preset.columns.map(column => ({ ...column })),
			sortRules: preset.sortRules.map(rule => ({ ...rule })),
			summaries: preset.summaries.map(summary => ({ ...summary })),
			display: { ...preset.display },
		};
	}

	private replaceCalendarPreset(updated: CalendarPreset): void {
		const index = this.settings.calendarPresets.findIndex(entry => entry.id === updated.id);
		if (index === -1) return;
		this.settings.calendarPresets[index] = updated;
		if (!this.settings.calendarPresets.some(entry => entry.id === this.settings.calendarDefaultPresetId)) {
			this.settings.calendarDefaultPresetId = this.settings.calendarPresets[0]?.id ?? null;
		}
	}

	private applyCalendarPresetSaveEffects(preset: CalendarPreset): void {
		for (const source of this.settings.externalCalendars) {
			if (preset.externalCalendarVisibility[source.id] === true) {
				source.enabled = true;
			}
		}
	}

	private replaceKanbanPreset(updated: KanbanPreset): void {
		const index = this.settings.kanbanPresets.findIndex(entry => entry.id === updated.id);
		if (index === -1) return;
		this.settings.kanbanPresets[index] = updated;
		if (!this.settings.kanbanPresets.some(entry => entry.id === this.settings.kanbanDefaultPresetId)) {
			this.settings.kanbanDefaultPresetId = this.settings.kanbanPresets[0]?.id ?? null;
		}
	}

	private patchTablePreset(patch: TablePresetPatch): void {
		const index = this.settings.tablePresets.findIndex(entry => entry.id === patch.id);
		if (index === -1) return;
		this.settings.tablePresets[index] = applyTablePresetPatch(this.settings.tablePresets[index], patch);
		if (this.settings.tableDefaultPresetId && !this.settings.tablePresetOrderIds.includes(this.settings.tableDefaultPresetId)) {
			this.settings.tableDefaultPresetId = this.resolveEffectiveTablePresetId();
		}
	}

	private enqueueTablePresetMutation<T>(operation: () => Promise<T>): Promise<T> {
		return this.tablePresetMutationQueue.enqueue(operation);
	}

	private snapshotTablePresetSettings(): TablePresetSettingsSnapshot {
		return {
			tablePresets: this.settings.tablePresets.map(cloneTablePreset),
			tablePresetFileBindings: this.settings.tablePresetFileBindings.map(binding => ({ ...binding })),
			tablePresetOrderIds: [...this.settings.tablePresetOrderIds],
			tableDefaultPresetId: this.settings.tableDefaultPresetId,
			presetFavorites: clonePresetFavorites(this.settings.presetFavorites),
		};
	}

	private restoreTablePresetSettings(snapshot: TablePresetSettingsSnapshot): void {
		this.settings.tablePresets = snapshot.tablePresets.map(cloneTablePreset);
		this.settings.tablePresetFileBindings = snapshot.tablePresetFileBindings.map(binding => ({ ...binding }));
		this.settings.tablePresetOrderIds = [...snapshot.tablePresetOrderIds];
		this.settings.tableDefaultPresetId = snapshot.tableDefaultPresetId;
		this.settings.presetFavorites = clonePresetFavorites(snapshot.presetFavorites);
	}

	private async saveTablePresetPatchAndRefresh(patch: TablePresetPatch): Promise<void> {
		const source = this.tablePresetRegistry.getSource(patch.id);
		if (source?.kind === 'table-file') {
			await this.tablePresetRegistry.flushPatches(patch.id);
			const control = this.tablePresetRegistry.queuePatch(patch.id, 'explicit-save', patch, {
				delayMs: 0,
				onError: error => this.handleTablePresetFileWriteFailure(error),
			});
			await control.flush();
			return;
		}
		if (source?.kind === 'missing-bound-file' || source?.kind === 'conflict') {
			throw new Error(`Table preset "${patch.id}" cannot be edited while its file source is ${source.kind}.`);
		}
		await this.enqueueTablePresetMutation(async () => {
			const snapshot = this.snapshotTablePresetSettings();
			this.patchTablePreset(patch);
			try {
				await this.storage.saveSettings();
			} catch (error) {
				this.restoreTablePresetSettings(snapshot);
				this.refreshViews();
				throw error;
			}
			this.refreshViews();
		});
	}

	private queueTablePresetPatchAndRefresh(
		patch: TablePresetPatch,
		scope: string,
		surfaceToken: string,
	): TablePresetRegistryPatchControl {
		const source = this.tablePresetRegistry.getSource(patch.id);
		if (source?.kind !== 'table-file') {
			const settled = this.saveTablePresetPatchAndRefresh(patch).catch(error => {
				this.handleTablePresetFileWriteFailure(error);
				throw error;
			});
			void settled.catch(() => {});
			return {
				acceptedRevision: this.tablePresetRegistry.getSnapshot().revision,
				settled,
				flush: () => settled,
				cancel: () => undefined,
			};
		}
		return this.tablePresetRegistry.queuePatch(patch.id, scope, patch, {
			surfaceToken,
			onError: error => {
				this.handleTablePresetFileWriteFailure(error);
			},
		});
	}

	private getTablePresetPatchScope(patch: TablePresetPatch): string {
		const domains = new Set<string>();
		if ('name' in patch) domains.add('identity');
		if ('filterSetId' in patch) domains.add('filter');
		if ('columns' in patch) domains.add('columns');
		if ('sortRules' in patch) domains.add('sorting');
		if ('groupBy' in patch || 'groupOrder' in patch || 'subgroupBy' in patch || 'subgroupOrder' in patch || 'collapsedGroupKeys' in patch) {
			domains.add('grouping');
		}
		if ('summaries' in patch) domains.add('summaries');
		if ('search' in patch) domains.add('search');
		if ('display' in patch) domains.add('display');
		return [...domains].sort().join('+') || 'preset';
	}

	private handleTablePresetFileWriteFailure(error: unknown): void {
		console.error('Operon: Table file save failed', error);
		new Notice(`Operon could not save the Table file. ${error instanceof Error ? error.message : String(error)}`);
	}

	private async addTablePresetAndRefresh(
		preset: TablePreset,
		leaf?: WorkspaceLeaf,
		insertAfterPresetId?: string | null,
	): Promise<void> {
		await this.enqueueTablePresetMutation(async () => {
			const snapshot = this.snapshotTablePresetSettings();
			if (this.tablePresetRegistry.get(preset.id) || this.settings.tablePresets.some(entry => entry.id === preset.id)) {
				throw new Error(`Table preset id "${preset.id}" already exists.`);
			}
			await this.ensureVaultFolder('Operon/Tables');
			const path = buildUniqueOperonTableFilePath(
				'Operon/Tables',
				preset.name,
				this.app.vault.getFiles().map(file => file.path),
			);
			const serialized = serializeOperonTableFile(preset);
			let createdByOperon = false;
			try {
				this.expectedTableFileModifyHashes.set(getOperonTableFilePathKey(path), this.hashTableFileContent(serialized));
				await this.app.vault.create(path, serialized);
				createdByOperon = true;
				this.settings.tablePresetFileBindings.push({ id: preset.id, path });
				const sourceIndex = insertAfterPresetId
					? this.settings.tablePresetOrderIds.indexOf(insertAfterPresetId)
					: -1;
				if (sourceIndex >= 0) {
					this.settings.tablePresetOrderIds.splice(sourceIndex + 1, 0, preset.id);
				} else {
					this.settings.tablePresetOrderIds.push(preset.id);
				}
				this.settings.tablePresets.push(cloneTablePreset(preset));
				if (!this.settings.tableDefaultPresetId) {
					this.settings.tableDefaultPresetId = preset.id;
				}
				await this.storage.saveSettings();
			} catch (error) {
				this.expectedTableFileModifyHashes.delete(getOperonTableFilePathKey(path));
				this.restoreTablePresetSettings(snapshot);
				const createdFile = this.app.vault.getAbstractFileByPath(path);
				if (createdByOperon && createdFile instanceof TFile && await this.app.vault.read(createdFile) === serialized) {
					try {
						await this.app.fileManager.trashFile(createdFile);
					} catch (rollbackError) {
						console.warn('Operon: failed to roll back Table file creation', rollbackError);
					}
				}
				this.refreshViews();
				throw error;
			}
			try {
				await this.refreshTablePresetRegistry();
			} catch (error) {
				console.error('Operon: Table preset was created, but the registry refresh failed', error);
				this.scheduleTablePresetRegistryRefresh();
			}
		});
		if (leaf) await this.openTablePresetInLeaf(leaf, preset.id);
		this.refreshViews();
	}

	private buildTablePresetSettingsFileIntegration(): TablePresetSettingsFileIntegration {
		const toMetadata = (presetId: string): ReturnType<TablePresetSettingsFileIntegration['getSourceMetadata']> => {
			const entry = this.tablePresetRegistry.get(presetId);
			if (!entry) return null;
			const source = entry.source;
			const kind = source.kind === 'table-file'
				? 'file-backed'
				: source.kind === 'missing-bound-file'
					? 'missing'
					: source.kind;
			const paths = [...new Set([
				...(source.path ? [source.path] : []),
				...entry.conflicts.flatMap(conflict => conflict.paths),
			])];
			const path = source.path ?? paths[0] ?? null;
			return {
				id: presetId,
				kind,
				path,
				name: entry.preset?.name ?? (path ? deriveOperonTableNameFromPath(path) : presetId),
				paths,
			};
		};
		return {
			getSourceMetadata: toMetadata,
			listAvailablePresets: () => this.getTablePresetsForSurfaces(),
			listUnavailableSources: () => [...new Set([
				...this.settings.tablePresetOrderIds,
				...this.tablePresetRegistry.getSnapshot().entries.keys(),
			])].flatMap(presetId => {
				const metadata = toMetadata(presetId);
				return metadata?.kind === 'conflict' || metadata?.kind === 'missing' ? [metadata] : [];
			}),
			createPreset: (preset, context) => this.addTablePresetAndRefresh(
				preset,
				undefined,
				context.reason === 'duplicate' ? context.sourcePresetId : null,
			),
			patchPreset: patch => this.saveTablePresetPatchAndRefresh(patch),
			deletePreset: presetId => this.deleteTablePresetAndRefresh(presetId),
			getMigrationSummary: () => this.tablePresetFileMigrationSummary,
			getMigrationReceipt: () => this.tablePresetFileMigrationReceipt,
			retryMigration: async () => {
				await this.executeTablePresetFileMigration({ notify: true, refreshRegistry: true });
			},
			recoverMigrationBackup: presetId => this.recoverTablePresetMigrationBackup(presetId),
			resolveIdConflict: (presetId, originalPath) => this.resolveTablePresetIdConflict(presetId, originalPath),
			preflightFinalization: () => this.tablePresetFileLifecycle.preflightFinalization(),
			finalizeMigration: () => this.finalizeTablePresetFileMigration(),
			retryFinalization: () => this.retryTablePresetFileMigrationFinalization(),
			openTablesFolder: () => this.openTablePresetMigrationFolder(),
		};
	}

	private async recoverTablePresetMigrationBackup(presetId: string): Promise<void> {
		const result = await this.runTablePresetFileLifecycleMutation(() =>
			this.tablePresetFileLifecycle.recoverBackup({ presetId })
		);
		await this.refreshTablePresetRegistry({ adoptUnbound: true, persistBindings: true });
		new Notice(t('settings', 'tableFileMigrationRecoveryCompletedNotice', { name: result.createdPreset.name }));
	}

	private async resolveTablePresetIdConflict(
		presetId: string,
		originalPath: string,
	): Promise<TablePresetFileConflictResolutionResult> {
		const result = await this.runTablePresetFileLifecycleMutation(() =>
			this.tablePresetFileLifecycle.resolveDuplicateIdConflict({ presetId, chosenOriginalPath: originalPath })
		);
		await this.refreshTablePresetRegistry({ adoptUnbound: true, persistBindings: true });
		new Notice(result.failed.length === 0
			? t('settings', 'tableFileMigrationConflictResolvedNotice', { count: String(result.succeeded.length) })
			: t('settings', 'tableFileMigrationConflictPartialNotice', {
				succeeded: String(result.succeeded.length),
				failed: String(result.failed.length),
			}));
		return result;
	}

	private async runTablePresetFileLifecycleMutation<T>(operation: () => Promise<T>): Promise<T> {
		if (this.tablePresetFileMigrationRunning) throw new Error('A Table file migration operation is already running.');
		this.tablePresetFileMigrationRunning = true;
		try {
			return await operation();
		} finally {
			this.tablePresetFileMigrationRunning = false;
		}
	}

	private async finalizeTablePresetFileMigration(): Promise<void> {
		this.tablePresetFileMigrationReceipt = await this.tablePresetFileLifecycle.finalize({
			commitFinalizedVersion: version => this.storage.commitTablePresetFileMigrationFinalizedVersion(version),
		});
		this.settingsTab?.refreshTablePresetFileState();
		if (this.tablePresetFileMigrationReceipt.status === 'finalized') {
			new Notice(t('settings', 'tableFileMigrationFinalizedNotice'));
		} else {
			new Notice(t('settings', 'tableFileMigrationFinalizationFailedNotice'));
		}
	}

	private async retryTablePresetFileMigrationFinalization(): Promise<void> {
		this.tablePresetFileMigrationReceipt = await this.tablePresetFileLifecycle.retryFinalization({
			commitFinalizedVersion: version => this.storage.commitTablePresetFileMigrationFinalizedVersion(version),
		});
		this.settingsTab?.refreshTablePresetFileState();
		new Notice(this.tablePresetFileMigrationReceipt.status === 'finalized'
			? t('settings', 'tableFileMigrationFinalizedNotice')
			: t('settings', 'tableFileMigrationFinalizationFailedNotice'));
	}

	private async openTablePresetMigrationFolder(): Promise<void> {
		await this.ensureVaultFolder('Operon/Tables');
		const folder = this.app.vault.getAbstractFileByPath('Operon/Tables');
		if (!(folder instanceof TFolder)) return;
		let explorerLeaf: WorkspaceLeaf | undefined = this.app.workspace.getLeavesOfType('file-explorer')[0];
		if (!explorerLeaf) {
			explorerLeaf = this.app.workspace.getLeftLeaf(false) ?? undefined;
			await explorerLeaf?.setViewState({ type: 'file-explorer', active: true });
		}
		const explorerView = explorerLeaf?.view as { revealInFolder?: (file: TAbstractFile) => Promise<void> | void } | undefined;
		if (explorerView?.revealInFolder) {
			await explorerView.revealInFolder(folder);
			return;
		}
		if (explorerLeaf) await this.app.workspace.revealLeaf(explorerLeaf);
		const firstTableFile = this.app.vault.getFiles()
			.filter(file => isOperonTableFilePath(file.path) && file.path.startsWith(`${folder.path}/`))
			.sort((left, right) => left.path.localeCompare(right.path))[0];
		if (firstTableFile) await this.app.workspace.getLeaf(false).openFile(firstTableFile);
	}

	private async ensureVaultFolder(path: string): Promise<void> {
		let current = '';
		for (const part of path.split('/').filter(Boolean)) {
			current = current ? `${current}/${part}` : part;
			const existing = this.app.vault.getAbstractFileByPath(current);
			if (existing instanceof TFolder) continue;
			if (existing) throw new Error(`Cannot create Table folder because a file exists at "${current}".`);
			await this.app.vault.createFolder(current);
		}
	}

	private async deleteTablePresetAndRefresh(presetId: string, leaf?: WorkspaceLeaf): Promise<void> {
		const source = this.tablePresetRegistry.getSource(presetId);
		if (source?.kind === 'table-file') {
			await this.deleteFileBackedTablePresetAndRefresh(presetId);
			return;
		}
		let fallbackPresetId: string | null = null;
		let deleted = false;
		await this.enqueueTablePresetMutation(async () => {
			if (this.settings.tablePresets.length <= 1) {
				new Notice(t('settings', 'tableAtLeastOnePresetRequired'));
				return;
			}
			const snapshot = this.snapshotTablePresetSettings();
			const deletedIndex = this.settings.tablePresets.findIndex(entry => entry.id === presetId);
			if (deletedIndex === -1) return;
			this.settings.tablePresets.splice(deletedIndex, 1);
			this.settings.tablePresetOrderIds = this.settings.tablePresetOrderIds.filter(id => id !== presetId);
			this.settings.presetFavorites = removePresetFavorite(this.settings.presetFavorites, 'table', presetId);
			deleted = true;
			fallbackPresetId = this.resolveEffectiveTablePresetId();
			if (this.settings.tableDefaultPresetId === presetId) {
				this.settings.tableDefaultPresetId = fallbackPresetId;
			}
			try {
				await this.storage.saveSettings();
			} catch (error) {
				this.restoreTablePresetSettings(snapshot);
				this.refreshViews();
				throw error;
			}
		});
		if (!deleted) return;
		if (fallbackPresetId && leaf) {
			await this.activateTablePresetInLeaf(leaf, fallbackPresetId);
		}
		this.refreshViews();
	}

	private async deleteFileBackedTablePresetAndRefresh(presetId: string): Promise<void> {
		const tablePresets = this.getTablePresetsForSurfaces();
		if (tablePresets.length <= 1) {
			new Notice(t('settings', 'tableAtLeastOnePresetRequired'));
			return;
		}
		const preset = tablePresets.find(entry => entry.id === presetId);
		const source = this.tablePresetRegistry.getSource(presetId);
		if (!preset || source?.kind !== 'table-file' || !source.path) return;
		if (!await this.confirmDeleteFileBackedTablePreset(preset.name)) return;

		const affectedWorkspaceLeaves = this.getTableWorkspaceLeavesForPreset(presetId);
		await this.tablePresetRegistry.flushPatches(presetId);
		const path = source.path;
		let fallbackPresetId: string | null = null;
		let deleted = false;
		await this.enqueueTablePresetMutation(async () => {
			const currentSource = this.tablePresetRegistry.getSource(presetId);
			const file = this.app.vault.getAbstractFileByPath(path);
			if (currentSource?.kind !== 'table-file' || !(file instanceof TFile)) return;
			const snapshot = this.snapshotTablePresetSettings();
			fallbackPresetId = this.resolveEffectiveTablePresetId(presetId);
			this.settings.tablePresets = this.settings.tablePresets.filter(entry => entry.id !== presetId);
			this.settings.tablePresetFileBindings = this.settings.tablePresetFileBindings.filter(binding => binding.id !== presetId);
			this.settings.tablePresetOrderIds = this.settings.tablePresetOrderIds.filter(id => id !== presetId);
			this.settings.presetFavorites = removePresetFavorite(this.settings.presetFavorites, 'table', presetId);
			if (this.settings.tableDefaultPresetId === presetId) this.settings.tableDefaultPresetId = fallbackPresetId;
			try {
				await this.storage.saveSettings();
			} catch (error) {
				this.restoreTablePresetSettings(snapshot);
				throw error;
			}

			this.expectedTableFileDeletes.set(getOperonTableFilePathKey(path), presetId);
			try {
				await this.app.fileManager.trashFile(file);
				window.setTimeout(() => {
					const pathKey = getOperonTableFilePathKey(path);
					if (this.expectedTableFileDeletes.get(pathKey) === presetId) {
						this.expectedTableFileDeletes.delete(pathKey);
					}
				}, 5_000);
			} catch (error) {
				this.expectedTableFileDeletes.delete(getOperonTableFilePathKey(path));
				this.restoreTablePresetSettings(snapshot);
				try {
					await this.storage.saveSettings();
				} catch (rollbackError) {
					console.error('Operon: Table preset delete rollback failed', rollbackError);
				}
				throw error;
			}
			deleted = true;
			await this.refreshTablePresetRegistry();
		});
		if (!deleted) return;
		this.closeTableFileLeavesForPath(path);
		if (fallbackPresetId) {
			await this.transitionDeletedTableWorkspaceLeaves(presetId, fallbackPresetId, affectedWorkspaceLeaves);
		} else {
			this.closeTableWorkspaceLeaves(presetId, affectedWorkspaceLeaves);
		}
		this.refreshTablePresetSurfaces(presetId);
		this.settingsTab?.refreshTablePresetFileState();
		new Notice(t('settings', 'tablePresetMovedToTrash', { name: preset.name }));
	}

	private async transitionDeletedTableWorkspaceLeaves(
		deletedPresetId: string,
		fallbackPresetId: string,
		leaves: readonly WorkspaceLeaf[] = [],
	): Promise<void> {
		const currentLeaves = new Set(this.app.workspace.getLeavesOfType(OPERON_TABLE_VIEW_TYPE));
		for (const leaf of leaves) {
			if (!currentLeaves.has(leaf) || !(leaf.view instanceof OperonTableView)) continue;
			if (leaf.view.getRequestedPresetId() !== deletedPresetId) continue;
			await this.activateTablePresetInLeaf(leaf, fallbackPresetId);
		}
	}

	private async confirmDeleteFileBackedTablePreset(presetName: string): Promise<boolean> {
		return await new Promise(resolve => {
			new ConfirmActionModal(this.app, {
				title: t('settings', 'deleteTablePresetTitle', { name: presetName }),
				message: t('settings', 'deleteTablePresetFileMessage'),
				confirmText: t('settings', 'moveTablePresetToTrash'),
				cancelText: t('buttons', 'cancel'),
				danger: true,
			}, resolve).open();
		});
	}

	private async removeTablePresetReferences(presetIds: readonly string[]): Promise<string | null> {
		const removedIds = new Set(presetIds);
		if (removedIds.size === 0) return null;
		let fallbackPresetId: string | null = null;
		let changed = false;
		await this.enqueueTablePresetMutation(async () => {
			const snapshot = this.snapshotTablePresetSettings();
			changed = this.settings.tablePresetFileBindings.some(binding => removedIds.has(binding.id))
				|| this.settings.tablePresetOrderIds.some(id => removedIds.has(id))
				|| this.settings.tablePresets.some(preset => removedIds.has(preset.id));
			if (!changed) return;
			const availablePresets = this.getTablePresetsForSurfaces().filter(preset => !removedIds.has(preset.id));
			const availableIds = new Set(availablePresets.map(preset => preset.id));
			fallbackPresetId = this.settings.tablePresetOrderIds.find(id => !removedIds.has(id) && availableIds.has(id))
				?? availablePresets[0]?.id
				?? null;
			this.settings.tablePresets = this.settings.tablePresets.filter(preset => !removedIds.has(preset.id));
			this.settings.tablePresetFileBindings = this.settings.tablePresetFileBindings.filter(binding => !removedIds.has(binding.id));
			this.settings.tablePresetOrderIds = this.settings.tablePresetOrderIds.filter(id => !removedIds.has(id));
			for (const presetId of removedIds) {
				this.settings.presetFavorites = removePresetFavorite(this.settings.presetFavorites, 'table', presetId);
			}
			if (this.settings.tableDefaultPresetId && removedIds.has(this.settings.tableDefaultPresetId)) {
				this.settings.tableDefaultPresetId = fallbackPresetId;
			}
			try {
				await this.storage.saveSettings();
			} catch (error) {
				this.restoreTablePresetSettings(snapshot);
				try {
					await this.refreshTablePresetRegistry();
				} catch (refreshError) {
					console.warn('Operon: Table preset registry rollback refresh failed', refreshError);
					this.scheduleTablePresetRegistryRefresh();
				}
				this.settingsTab?.refreshTablePresetFileState();
				for (const presetId of removedIds) this.refreshTablePresetSurfaces(presetId);
				throw error;
			}
			try {
				await this.refreshTablePresetRegistry();
			} catch (error) {
				console.warn('Operon: Table preset registry refresh failed after reference cleanup', error);
				this.scheduleTablePresetRegistryRefresh();
			}
		});
		if (changed) this.settingsTab?.refreshTablePresetFileState();
		return fallbackPresetId;
	}

	private async toggleTablePresetFavoriteAndRefresh(presetId: string): Promise<void> {
		await this.enqueueTablePresetMutation(async () => {
			if (!this.getTablePresetsForSurfaces().some(entry => entry.id === presetId)) return;
			const snapshot = this.snapshotTablePresetSettings();
			this.settings.presetFavorites = togglePresetFavorite(this.settings.presetFavorites, 'table', presetId);
			try {
				await this.storage.saveSettings();
			} catch (error) {
				this.restoreTablePresetSettings(snapshot);
				this.refreshViews();
				throw error;
			}
			this.refreshViews();
		});
	}

	private async activateTablePresetInLeaf(leaf: WorkspaceLeaf, presetId: string): Promise<void> {
		const currentState = leaf.view instanceof OperonTableView
			? leaf.view.getState() as Partial<TableLeafState>
			: {};
		const nextState: Record<string, unknown> = {
			...currentState,
			presetId,
			scrollTop: 0,
		};
		await leaf.setViewState({
			type: OPERON_TABLE_VIEW_TYPE,
			active: true,
			state: nextState,
		});
	}

	private async openTablePresetInLeaf(leaf: WorkspaceLeaf, presetId: string): Promise<void> {
		const source = this.tablePresetRegistry.getSource(presetId);
		if (source?.kind === 'table-file' && source.path) {
			const file = this.app.vault.getAbstractFileByPath(source.path);
			if (file instanceof TFile) {
				await leaf.openFile(file, { active: true });
				return;
			}
		}
		await this.activateTablePresetInLeaf(leaf, presetId);
	}

	private openTablePresetSettingsModal(
		presetId: string,
		leafOrResolver: WorkspaceLeaf | (() => WorkspaceLeaf),
		options: { managementMode?: 'full' | 'current-only' } = {},
	): void {
		const resolveLeaf = () => typeof leafOrResolver === 'function' ? leafOrResolver() : leafOrResolver;
		const registryEntry = this.tablePresetRegistry.get(presetId);
		const legacyPreset = this.settings.tablePresets.find(entry => entry.id === presetId) ?? null;
		const preset = resolveTablePresetForSettings(registryEntry, legacyPreset);
		const source = this.tablePresetRegistry.getSource(presetId);
		new TablePresetQuickSettingsModal(this.app, {
			getSettings: () => ({
				...this.settings,
				tablePresets: this.getTablePresetsForSurfaces(),
			}),
			preset,
			onSave: (patch) => this.saveTablePresetPatchAndRefresh(patch),
			onCreate: (created) => this.addTablePresetAndRefresh(created, resolveLeaf()),
			onDuplicate: (created) => this.addTablePresetAndRefresh(created, resolveLeaf(), presetId),
			...(source?.kind === 'table-file'
				? { onDelete: (deletedPresetId: string) => this.deleteTablePresetAndRefresh(deletedPresetId, resolveLeaf()) }
				: source?.kind === 'legacy' || !source
				? { onDelete: (deletedPresetId: string) => this.deleteTablePresetAndRefresh(deletedPresetId, resolveLeaf()) }
				: {}),
			onToggleFavorite: (favoritePresetId) => this.toggleTablePresetFavoriteAndRefresh(favoritePresetId),
			onToggleFilterFavorite: (filterSetId) => this.togglePresetFavoriteAndRefresh('filter', filterSetId),
			onSaveFilterSet: (filterSet) => this.saveFilterSetAndRefresh(filterSet),
			getFilterModalEvalDeps: () => this.buildFilterModalEvalDeps(),
			getAdditionalColumnFields: scopedPreset => {
				const filterSet = scopedPreset.filterSetId
					? this.settings.filterSets.find(entry => entry.id === scopedPreset.filterSetId) ?? null
					: null;
				const allTasks = this.indexer.getAllTasks();
				let tasks = resolveTableSearchScopedTasks({
					filterSet,
					tasks: allTasks,
					priorities: this.settings.priorities,
					pinnedCache: this.pinnedCache,
					scope: scopedPreset.search.scope,
					settings: this.settings,
					filePropertyContext: this.getTableFilePropertySnapshot() ?? undefined,
				});
				const parent = scopedPreset.search.parent;
				if (parent && parent.mode === scopedPreset.search.scope.projectMode) {
					const visibleIds = resolveTableParentSearchVisibleTaskIds(parent.parentId, parent.mode, tasks, {
						getChildIds: parentId => this.indexer.secondary.getChildIds(parentId),
						getAllDescendantIds: parentId => this.indexer.secondary.getAllDescendantIds(parentId),
					});
					tasks = tasks.filter(task => visibleIds.has(task.operonId));
				}
				return this.tableFilePropertyIndex?.getSnapshot(tasks, this.indexer.getGeneration(), {
					keyMappings: this.settings.keyMappings,
				}).fields ?? [];
			},
			managementMode: options.managementMode ?? 'full',
		}).open();
	}

	private async handleKanbanSortModeChange(
		presetId: string,
		sortMode: KanbanPreset['sortMode'],
	): Promise<void> {
		if (sortMode !== 'manual' || this.storage.kanbanOrder.hasBoard(presetId)) return;
		const preset = this.settings.kanbanPresets.find(entry => entry.id === presetId) ?? null;
		if (!preset) return;
		await this.storage.kanbanOrder.replaceBoard(presetId, this.buildKanbanManualOrderSnapshot(preset));
	}

	private async copyKanbanManualOrder(sourcePresetId: string, targetPresetId: string): Promise<void> {
		await this.storage.kanbanOrder.replaceBoard(targetPresetId, this.storage.kanbanOrder.getBoard(sourcePresetId));
	}

	private async removeKanbanManualOrder(presetId: string): Promise<void> {
		await this.storage.kanbanOrder.removeBoard(presetId);
	}

	private buildKanbanManualOrderSnapshot(preset: KanbanPreset): Record<string, string[]> {
		const board = this.queryKanbanBoardForOrder({
			...preset,
			sortMode: 'automatic',
			sortRules: preset.sortRules.map(rule => ({ ...rule })),
		});
		return board ? this.extractKanbanBoardOrder(board.cellMap) : {};
	}

	private queryKanbanBoardForOrder(
		preset: KanbanPreset,
		manualOrder?: Record<string, string[]>,
	): ReturnType<typeof queryKanbanBoard> | null {
		if (!preset.pipelineId) return null;
		const pipeline = this.settings.pipelines.find(entry => entry.id === preset.pipelineId) ?? null;
		if (!pipeline) return null;
		const filterSet = preset.filterSetId
			? this.settings.filterSets.find(entry => entry.id === preset.filterSetId) ?? null
			: null;
		if (filterSet && isSpecialDynamicFilterSet(filterSet)) return null;
		return queryKanbanBoard({
			preset,
			pipeline,
			pipelines: this.settings.pipelines,
			filterSet,
			tasks: this.indexer.getAllTasks(),
			priorities: this.settings.priorities,
			pinnedCache: this.pinnedCache,
			manualOrder,
			keyMappings: this.settings.keyMappings,
			filterEvaluationOptions: {
				filePropertyContext: this.getTableFilePropertySnapshot() ?? undefined,
			},
		});
	}

	private extractKanbanBoardOrder(cellMap: Map<string, IndexedTask[]>): Record<string, string[]> {
		const order: Record<string, string[]> = {};
		for (const [cellKey, tasks] of cellMap.entries()) {
			if (tasks.length > 0) {
				order[cellKey] = tasks.map(task => task.operonId);
			}
		}
		return order;
	}

	private buildKanbanManualDropOrderCells(
		preset: KanbanPreset,
		context: KanbanDropContext,
	): Record<string, string[]> {
		const currentOrder = this.storage.kanbanOrder.getBoard(preset.id);
		const board = this.queryKanbanBoardForOrder(preset, currentOrder);
		const sourceCellKey = context.sourceStatusId
			? buildKanbanCellKey(context.sourceStatusId, context.sourceLaneKey)
			: null;
		const targetCellKey = buildKanbanCellKey(context.targetStatusId, context.targetLaneKey);
		const cells: Record<string, string[]> = {};
		const sourceIds = sourceCellKey
			? (board?.cellMap.get(sourceCellKey) ?? []).map(task => task.operonId)
			: [];
		const targetIds = (board?.cellMap.get(targetCellKey) ?? []).map(task => task.operonId);

		if (sourceCellKey && sourceCellKey === targetCellKey) {
			cells[targetCellKey] = this.insertKanbanTaskIdBefore(sourceIds, context.taskId, context.targetBeforeTaskId);
			return cells;
		}

		if (sourceCellKey) {
			cells[sourceCellKey] = sourceIds.filter(taskId => taskId !== context.taskId);
		}
		cells[targetCellKey] = this.insertKanbanTaskIdBefore(targetIds, context.taskId, context.targetBeforeTaskId);
		return cells;
	}

	private insertKanbanTaskIdBefore(taskIds: string[], taskId: string, beforeTaskId: string | null): string[] {
		const next = taskIds.filter(entry => entry !== taskId);
		const beforeIndex = beforeTaskId ? next.indexOf(beforeTaskId) : -1;
		if (beforeIndex >= 0) {
			next.splice(beforeIndex, 0, taskId);
		} else {
			next.push(taskId);
		}
		return next;
	}

	private getKanbanManualOrderCells(
		presetId: string,
		cellKeys: string[],
	): Record<string, string[]> {
		const board = this.storage.kanbanOrder.getBoard(presetId);
		const cells: Record<string, string[]> = {};
		for (const cellKey of cellKeys) {
			cells[cellKey] = board[cellKey] ?? [];
		}
		return cells;
	}

	private async handleKanbanCardDrop(
		leaf: import('obsidian').WorkspaceLeaf,
		context: KanbanDropContext,
	): Promise<void> {
		const task = this.indexer.getTask(context.taskId);
		if (!task) throw new Error(`Kanban drop failed: task not found (${context.taskId})`);

		const preset = this.getKanbanPresetForLeaf(leaf);
		if (!preset?.pipelineId) throw new Error('Kanban drop failed: preset has no pipeline');
		const pipeline = this.settings.pipelines.find(entry => entry.id === preset.pipelineId) ?? null;
		if (!pipeline) throw new Error(`Kanban drop failed: pipeline not found (${preset.pipelineId})`);
		const targetStatus = pipeline.statuses.find(status => status.id === context.targetStatusId) ?? null;
		if (!targetStatus) throw new Error(`Kanban drop failed: target status not found (${context.targetStatusId})`);
		const manualOrderCells = preset.sortMode === 'manual'
			? this.buildKanbanManualDropOrderCells(preset, context)
			: null;
		const previousManualOrderCells = manualOrderCells
			? this.getKanbanManualOrderCells(preset.id, Object.keys(manualOrderCells))
			: null;

		const plan = buildKanbanWritebackPlan({
			task,
			pipeline,
			targetStatus,
			sourceLaneKey: context.sourceLaneKey,
			targetLaneKey: context.targetLaneKey,
			swimlaneBy: context.swimlaneBy ?? preset.swimlaneBy,
			keyMappings: this.settings.keyMappings,
		});
		if (plan.changedKeys.length === 0) {
			if (this.isKanbanTaskAtDropTarget(task, pipeline, preset.swimlaneBy, context)) {
				if (manualOrderCells) {
					await this.storage.kanbanOrder.replaceCells(preset.id, manualOrderCells);
				}
				this.refreshViews();
				return;
			}
			if (previousManualOrderCells) {
				await this.storage.kanbanOrder.replaceCells(preset.id, previousManualOrderCells);
			}
			throw new Error(`Kanban drop failed: no writeback changes for ${context.taskId}`);
		}
		if (!await this.guardTaskStatusChangeOrShow(task, plan.payload)) {
			callUnknownMethod(leaf.view, 'clearOptimisticMove', context.taskId);
			return;
		}
		if (manualOrderCells) {
			await this.storage.kanbanOrder.replaceCells(preset.id, manualOrderCells);
		}

		const wrote = await this.updateTaskFieldsAndRefresh(task.operonId, plan.payload, {
			changedKeys: plan.changedKeys,
		});
		if (!wrote) {
			if (previousManualOrderCells) {
				await this.storage.kanbanOrder.replaceCells(preset.id, previousManualOrderCells);
			}
			throw new Error(`Kanban drop failed: task write failed (${context.taskId})`);
		}
		const freshTask = this.indexer.getTask(context.taskId);
		if (!freshTask || !this.isKanbanTaskAtDropTarget(freshTask, pipeline, preset.swimlaneBy, context)) {
			if (previousManualOrderCells) {
				await this.storage.kanbanOrder.replaceCells(preset.id, previousManualOrderCells);
			}
			throw new Error(`Kanban drop failed: persisted task did not reach target cell (${context.taskId})`);
		}
	}

	private isKanbanTaskAtDropTarget(
		task: IndexedTask,
		pipeline: import('./src/types/pipeline').Pipeline,
		presetSwimlaneBy: KanbanDropContext['swimlaneBy'],
		context: KanbanDropContext,
	): boolean {
		const status = resolveTaskStatusDefinition(task, pipeline, this.settings.pipelines);
		if (status?.id !== context.targetStatusId) return false;
		const laneKeys = extractLaneKeys(task, context.swimlaneBy ?? presetSwimlaneBy, this.settings.keyMappings, this.settings.priorities);
		return laneKeys.includes(context.targetLaneKey);
	}

	private async handleKanbanCellAction(
		leaf: import('obsidian').WorkspaceLeaf,
		context: KanbanCellActionContext,
	): Promise<void> {
		while (true) {
			const actionId = await this.promptKanbanCellAction(context);
			if (!actionId) return;

			try {
				if (actionId === 'pickTask') {
					await this.assignTaskToKanbanCell(leaf, context);
					return;
				}

				if (actionId === 'createFileTask') {
					this.openKanbanTaskCreator(leaf, context, 'file-only');
					return;
				}

				if (actionId === 'createInlineTask') {
					this.openKanbanTaskCreator(leaf, context, 'inline-only');
					return;
				}
			} catch (error) {
				console.error('Operon: kanban cell action failed', error);
				new Notice(t('notifications', 'kanbanActionFailed'));
				return;
			}
		}
	}

	private async markTaskDoneById(operonId: string): Promise<boolean> {
		const task = this.indexer.getTask(operonId);
		if (!task || task.checkbox !== 'open') return false;
		const now = localNow();
			const today = now.substring(0, 10);
			const statusVal = task.fieldValues['status'] ?? '';
			const toggleResolution = getCheckboxToggleWorkflowStatus(this.settings.pipelines, statusVal, task.checkbox);
			if (toggleResolution.checkbox !== 'done') return false;

			const payload: Record<string, string> = {
			datetimeModified: now,
		};
		if (statusVal && toggleResolution.workflow) {
			payload['status'] = toggleResolution.workflow.value;
			}
			this.applyCheckboxStateToFieldPayload(payload, 'done', today, task.fieldValues);
			if (!await this.guardTaskStatusChangeOrShow(task, payload)) return false;
			const changedKeys = ['_checkbox', 'dateCompleted', 'dateCancelled', 'datetimeModified', ...(payload['status'] ? ['status'] : [])];
			if (this.timeTracker.isTimerRunning(operonId)) {
				let taskWriteAttempted = false;
				let taskWriteSucceeded = false;
				const timerStopped = await this.timeTracker.stopActiveWithExternalTaskMutation(operonId, now, async (timerPayload) => {
					taskWriteAttempted = true;
					taskWriteSucceeded = await this.updateTaskFieldsAndRefresh(
						operonId,
						{ ...timerPayload, ...payload },
						{ changedKeys: [...Object.keys(timerPayload), ...changedKeys] },
					);
					return taskWriteSucceeded;
				});
				return timerStopped && taskWriteAttempted && taskWriteSucceeded;
			}

			return this.updateTaskFieldsAndRefresh(operonId, payload, { changedKeys });
	}

	private async cancelTaskById(operonId: string): Promise<void> {
		const task = this.indexer.getTask(operonId);
		if (!task || task.checkbox !== 'open') return;
		const now = localNow();
		const today = now.substring(0, 10);
		const statusVal = task.fieldValues['status'] ?? '';
		const statusIdentity = resolveConfiguredStatusIdentity(
			statusVal,
			buildWorkflowStatusIdentityIndex(this.settings.pipelines),
		);
		if (statusIdentity.kind === 'ambiguous') return;
		const reverseResolution = resolveReverseWorkflowFromTerminalDate(
			this.settings.pipelines,
			statusVal,
			this.settings.defaultPipelineName,
				'dateCancelled',
				today,
			);

			const payload: Record<string, string> = {
				datetimeModified: now,
		};
		if (statusVal && reverseResolution.workflow) {
			payload['status'] = reverseResolution.workflow.value;
			}
			this.applyCheckboxStateToFieldPayload(payload, 'cancelled', today, task.fieldValues);
			if (!await this.guardTaskStatusChangeOrShow(task, payload)) return;
			if (this.timeTracker.isTimerRunning(operonId)) {
				await this.stopActiveTimer('terminal-status');
			}

			await this.updateTaskFieldsAndRefresh(operonId, payload, {
			changedKeys: ['_checkbox', 'dateCompleted', 'dateCancelled', 'datetimeModified', ...(payload['status'] ? ['status'] : [])],
		});
	}

	private async unscheduleTaskById(operonId: string): Promise<void> {
		const task = this.indexer.getTask(operonId);
		if (!task) return;

		const payload: Record<string, string> = {
			dateScheduled: '',
			dateStarted: '',
			dateDue: '',
			datetimeStart: '',
			datetimeEnd: '',
		};

		await this.updateTaskFieldsAndRefresh(task.operonId, payload, {
			changedKeys: Object.keys(payload),
		});
		this.refreshViews();
	}

	private async promptCalendarSlotAction(
		selection: CalendarSlotSelection,
		options: {
			title?: string;
			actions?: CalendarSlotActionId[];
			preventInitialFocusScroll?: boolean;
		} = {},
	): Promise<CalendarSlotActionId | null> {
		const availability = this.getCalendarInlineTaskAvailability();
		return await new Promise(resolve => {
			new SlotActionModal(this.app, {
				title: options.title ?? t('calendar', 'slotActionChooseCalendarAction'),
				actions: options.actions ?? (selection.mode === 'timed'
					? ['pickTask', 'createFileTask', 'createInlineTask', 'createTrackedSession']
					: undefined),
				selectionLabel: formatCalendarSlotSelectionLabel(selection),
				inlineTaskEnabled: availability.enabled,
				inlineTaskDisabledReason: availability.reason,
				preventInitialFocusScroll: options.preventInitialFocusScroll === true,
				onChooseAction: resolve,
				onCancel: () => resolve(null),
			}).open();
		});
	}

	private async promptCalendarTaskSelection(options: { preventFocusScroll?: boolean } = {}): Promise<IndexedTask | null> {
		return await promptTaskFinderSelection(
			this.app,
			this.indexer,
			() => this.settings,
			TASK_FINDER_SCOPE_CALENDAR_SCHEDULE,
			{
				getProjectSerialDisplay: (operonId: string) => this.getProjectSerialDisplayForTask(operonId),
				preventFocusScroll: options.preventFocusScroll === true,
			},
		);
	}

	private async promptCalendarTrackedSessionTaskSelection(options: { preventFocusScroll?: boolean } = {}): Promise<IndexedTask | null> {
		return await promptTaskFinderSelection(
			this.app,
			this.indexer,
			() => this.settings,
			TASK_FINDER_SCOPE_CALENDAR_TRACKED_SESSION,
			{
				getProjectSerialDisplay: (operonId: string) => this.getProjectSerialDisplayForTask(operonId),
				preventFocusScroll: options.preventFocusScroll === true,
			},
		);
	}

	private async createTrackedSessionFromCalendarSelection(
		selection: CalendarSlotSelection,
		options: { preventTaskFinderFocusScroll?: boolean } = {},
	): Promise<void> {
		if (selection.mode !== 'timed') return;
		const start = selection.start;
		const end = selection.end;
		const startDate = parseLocalDatetime(start);
		const endDate = parseLocalDatetime(end);
		if (!startDate || !endDate || endDate.getTime() <= startDate.getTime()) {
			new Notice(t('notifications', 'calendarTrackedSessionInvalidRange'));
			return;
		}

		const task = await this.promptCalendarTrackedSessionTaskSelection({
			preventFocusScroll: options.preventTaskFinderFocusScroll === true,
		});
		if (!task) return;

		const added = await this.timeTracker.addSession(task.operonId, start, end);
		if (!added) {
			new Notice(t('notifications', 'calendarTrackedSessionSaveFailed'));
			return;
		}
		this.refreshTimeSessionHistoryLeaves(true);
		this.refreshViews();
		new Notice(t('notifications', 'calendarTrackedSessionAdded', {
			task: task.description || task.operonId,
			duration: formatDurationHuman(Math.round((endDate.getTime() - startDate.getTime()) / 1000)),
		}));
	}

	private async promptCalendarTemplateSelection(): Promise<FileTaskTemplateOption | null> {
		return await new Promise(resolve => {
			this.openFileTaskTemplatePicker(
				(selectedTemplate) => resolve(selectedTemplate),
				() => resolve(null),
			);
		});
	}

	private async promptInlineTaskTargetFileSelection(options: {
		excludedFilePath?: string | null;
	} = {}): Promise<TFile | null> {
		return await new Promise(resolve => {
			new InlineTaskTargetFilePickerModal(this.app, {
				excludedFilePath: options.excludedFilePath,
				onChooseFile: file => resolve(file),
				onCancel: () => resolve(null),
			}).open();
		});
	}

	private resolveEffectiveInlineTaskSaveMode(): InlineTaskSaveMode {
		return resolveEffectiveInlineTaskSaveMode(this.settings, isDailyNotesCoreAvailable(this.app));
	}

	private getCalendarInlineTaskAvailability(): { enabled: boolean; reason?: string } {
		const dailyNotesAvailable = isDailyNotesCoreAvailable(this.app);
		const saveMode = this.resolveEffectiveInlineTaskSaveMode();
		if (saveMode !== 'daily-notes' || dailyNotesAvailable) {
			return { enabled: true };
		}
		return {
			enabled: false,
			reason: t('notifications', 'dailyNoteUnavailable'),
		};
	}

	private async promptKanbanCellAction(context: KanbanCellActionContext): Promise<KanbanCellActionId | null> {
		const availability = this.getKanbanInlineTaskAvailability();
		const actions: KanbanCellActionId[] = this.isKanbanCellTaskCreationAllowed(context)
			? ['pickTask', 'createFileTask', 'createInlineTask']
			: ['pickTask'];
		return await new Promise(resolve => {
			new KanbanCellActionModal(this.app, {
				context,
				actions,
				inlineTaskEnabled: availability.enabled,
				inlineTaskDisabledReason: availability.reason,
				onChooseAction: resolve,
				onCancel: () => resolve(null),
			}).open();
		});
	}

	private isKanbanCellTaskCreationAllowed(context: KanbanCellActionContext): boolean {
		const pipeline = context.pipelineId
			? this.settings.pipelines.find(entry => entry.id === context.pipelineId) ?? null
			: null;
		const targetStatus = pipeline?.statuses.find(status => status.id === context.targetStatusId) ?? null;
		return !(targetStatus?.isFinished || targetStatus?.isCancelled);
	}

	private async promptKanbanTaskSelection(): Promise<IndexedTask | null> {
		return await promptTaskFinderSelection(
			this.app,
			this.indexer,
			() => this.settings,
			TASK_FINDER_SCOPE_KANBAN_PLACE,
			{
				getProjectSerialDisplay: (operonId: string) => this.getProjectSerialDisplayForTask(operonId),
			},
		);
	}

	private async promptKanbanTemplateSelection(): Promise<FileTaskTemplateOption | null> {
		return await new Promise(resolve => {
			this.openFileTaskTemplatePicker(
				(selectedTemplate) => resolve(selectedTemplate),
				() => resolve(null),
			);
		});
	}

	private getKanbanInlineTaskAvailability(): { enabled: boolean; reason?: string } {
		const dailyNotesAvailable = isDailyNotesCoreAvailable(this.app);
		const saveMode = this.resolveEffectiveInlineTaskSaveMode();
		if (saveMode !== 'daily-notes' || dailyNotesAvailable) {
			return { enabled: true };
		}
		return {
			enabled: false,
			reason: t('notifications', 'dailyNoteUnavailable'),
		};
	}

	private doesCalendarDraftMatchFilter(
		filterSet: FilterSet | null,
		draft: {
			description: string;
			checkbox: IndexedTask['checkbox'];
			fieldValues: Record<string, string>;
			tags: string[];
		},
	): boolean {
		if (!filterSet) return true;

		const syntheticTask: IndexedTask = {
			operonId: draft.fieldValues['operonId'] || 'calendar-filter-preview',
			description: draft.description,
			checkbox: draft.checkbox,
			fieldValues: { ...draft.fieldValues },
			tags: [...draft.tags],
			primary: {
				filePath: 'calendar-filter-preview.md',
				lineNumber: 0,
				format: 'inline',
			},
			datetimeModified: draft.fieldValues['datetimeModified'] || '',
			tier: 'hot',
		};

		return filterTasksForCalendar(
			filterSet,
			[syntheticTask],
			this.settings.priorities,
			this.pinnedCache,
			{
				filePropertyContext: this.getTableFilePropertySnapshot() ?? undefined,
			},
		).length > 0;
	}

	private maybeOpenCalendarEditorForFilterMismatch(
		filterSet: FilterSet | null,
		draft: {
			description: string;
			checkbox: IndexedTask['checkbox'];
			fieldValues: Record<string, string>;
			tags: string[];
		},
		openEditor: () => void | Promise<void>,
	): void | Promise<void> {
		if (this.doesCalendarDraftMatchFilter(filterSet, draft)) return;
		new Notice(t('notifications', 'calendarFilterMismatch'));
		return openEditor();
	}

	private maybeOpenKanbanEditorForFilterMismatch(
		filterSet: FilterSet | null,
		draft: {
			description: string;
			checkbox: IndexedTask['checkbox'];
			fieldValues: Record<string, string>;
			tags: string[];
		},
		openEditor: () => void | Promise<void>,
	): void | Promise<void> {
		if (this.doesCalendarDraftMatchFilter(filterSet, draft)) return;
		new Notice(t('notifications', 'kanbanFilterMismatch'));
		return openEditor();
	}

	private maybeNoticeCalendarCreatorFilterMismatch(
		leaf: import('obsidian').WorkspaceLeaf,
		draft: {
			description: string;
			checkbox: IndexedTask['checkbox'];
			fieldValues: Record<string, string>;
			tags: string[];
		},
	): void {
		if (this.doesCalendarDraftMatchFilter(this.getCalendarFilterSetForLeaf(leaf), draft)) return;
		new Notice(t('notifications', 'calendarCreatedTaskFilterMismatch'));
	}

	private maybeNoticeKanbanCreatorFilterMismatch(
		leaf: import('obsidian').WorkspaceLeaf,
		draft: {
			description: string;
			checkbox: IndexedTask['checkbox'];
			fieldValues: Record<string, string>;
			tags: string[];
		},
	): void {
		const preset = this.getKanbanPresetForLeaf(leaf);
		const filterSet = preset?.filterSetId
			? this.settings.filterSets.find(entry => entry.id === preset.filterSetId) ?? null
			: null;
		const effectiveFilterSet = filterSet && !isSpecialDynamicFilterSet(filterSet) ? filterSet : null;
		if (this.doesCalendarDraftMatchFilter(effectiveFilterSet, draft)) return;
		new Notice(t('notifications', 'kanbanCreatedTaskFilterMismatch'));
	}

	private async assignTaskToKanbanCell(
		leaf: import('obsidian').WorkspaceLeaf,
		context: KanbanCellActionContext,
	): Promise<void> {
		const preset = this.getKanbanPresetForLeaf(leaf);
		if (!preset?.pipelineId) return;
		const pipeline = this.settings.pipelines.find(entry => entry.id === preset.pipelineId) ?? null;
		if (!pipeline) return;
		const targetStatus = pipeline.statuses.find(status => status.id === context.targetStatusId) ?? null;
		if (!targetStatus) return;
		const filterSet = preset.filterSetId
			? this.settings.filterSets.find(entry => entry.id === preset.filterSetId) ?? null
			: null;
		const effectiveFilterSet = filterSet && !isSpecialDynamicFilterSet(filterSet) ? filterSet : null;

		while (true) {
			const task = await this.promptKanbanTaskSelection();
			if (!task) return;

			const plan = buildKanbanWritebackPlan({
				task,
				pipeline,
				targetStatus,
				sourceLaneKey: this.resolveKanbanSourceLaneKey(task, context.swimlaneBy, context.targetLaneKey),
				targetLaneKey: context.targetLaneKey,
				swimlaneBy: context.swimlaneBy,
				keyMappings: this.settings.keyMappings,
			});
			if (plan.changedKeys.length === 0) return;

			await this.updateTaskFieldsAndRefresh(task.operonId, plan.payload, {
				changedKeys: plan.changedKeys,
			});
			this.refreshViews();
			await this.maybeOpenKanbanEditorForFilterMismatch(effectiveFilterSet, plan.nextDraft, () => {
				this.openEditorForId(task.operonId);
			});
			new Notice(t('notifications', 'kanbanPlaced', {
				label: task.description || task.operonId,
			}));
			return;
		}
	}

	private openKanbanTaskCreator(
		leaf: import('obsidian').WorkspaceLeaf,
		context: KanbanCellActionContext,
		submitMode: TaskCreatorSubmitMode,
		initialDraft: TaskCreatorDraft | null = null,
	): void {
		const seed = this.buildKanbanSeedForCell(leaf, context);
		const draft = initialDraft ?? buildKanbanTaskCreatorDraft(seed);
		this.openTaskCreator(draft, {
			submitMode,
			onSubmitFile: (nextDraft) => this.createKanbanFileTaskFromCreatorDraft(leaf, context, nextDraft, seed.tagsPresent === true),
			onSubmitInline: (nextDraft) => this.createKanbanInlineTaskFromCreatorDraft(leaf, context, nextDraft),
		});
	}

	private async createKanbanFileTaskFromCreatorDraft(
		leaf: import('obsidian').WorkspaceLeaf,
		context: KanbanCellActionContext,
		draft: TaskCreatorDraft,
		seedTagsPresent: boolean,
	): Promise<boolean> {
		return await this.createFileTaskFromCreatorDraft(draft, {
			reopenCreator: preservedDraft => this.openKanbanTaskCreator(leaf, context, 'file-only', preservedDraft),
			seedTagsPresent,
			onCreated: created => {
				const createdTask = this.getCreatedFileTaskForFilterDraft(created);
				this.maybeNoticeKanbanCreatorFilterMismatch(leaf, {
					...(createdTask
						? this.buildFilterDraftFromIndexedTask(createdTask)
						: {
							description: created.description,
							checkbox: this.resolveKanbanSeedCheckbox(context, leaf),
							fieldValues: { ...created.fieldValues },
							tags: [...created.tags],
						}),
				});
			},
		});
	}

	private async createKanbanInlineTaskFromCreatorDraft(
		leaf: import('obsidian').WorkspaceLeaf,
		context: KanbanCellActionContext,
		draft: TaskCreatorDraft,
	): Promise<boolean> {
		const created = await this.createInlineTaskFromCreatorDraftResult(draft);
		if (!created) return false;

		this.maybeNoticeKanbanCreatorFilterMismatch(
			leaf,
			this.getCreatedInlineTaskFilterDraft(created.operonId, draft, this.resolveKanbanSeedCheckbox(context, leaf)),
		);
		return true;
	}

	private resolveKanbanSeedCheckbox(
		context: KanbanCellActionContext,
		leaf: import('obsidian').WorkspaceLeaf,
	): IndexedTask['checkbox'] {
		const preset = this.getKanbanPresetForLeaf(leaf);
		if (!preset?.pipelineId) return 'open';
		const pipeline = this.settings.pipelines.find(entry => entry.id === preset.pipelineId) ?? null;
		const targetStatus = pipeline?.statuses.find(status => status.id === context.targetStatusId) ?? null;
		if (!targetStatus) return 'open';
		if (targetStatus.isFinished) return 'done';
		if (targetStatus.isCancelled) return 'cancelled';
		return 'open';
	}

	private buildKanbanSeedForCell(
		leaf: import('obsidian').WorkspaceLeaf,
		context: KanbanCellActionContext,
	): {
		fieldValues: Record<string, string>;
		tags: string[];
		tagsPresent: boolean;
	} {
		const preset = this.getKanbanPresetForLeaf(leaf);
		const pipeline = preset?.pipelineId
			? this.settings.pipelines.find(entry => entry.id === preset.pipelineId) ?? null
			: null;
		const targetStatus = pipeline?.statuses.find(status => status.id === context.targetStatusId) ?? null;
		const fieldValues: Record<string, string> = {};
		const tags: string[] = [];
		let tagsPresent = false;

		if (pipeline && targetStatus) {
			fieldValues.status = composeStatusValue(pipeline.name, targetStatus.label);
			if (targetStatus.isFinished) {
				fieldValues.dateCompleted = localToday();
			} else if (targetStatus.isCancelled) {
				fieldValues.dateCancelled = localToday();
			}
		}

		const customSwimlaneMapping = getManagedCustomFieldOptionMapping(context.swimlaneBy, this.settings.keyMappings);
		if (context.swimlaneBy === 'priority' || context.swimlaneBy === 'dateDue' || context.swimlaneBy === 'dateScheduled') {
			fieldValues[context.swimlaneBy] = context.targetLaneKey === KANBAN_NO_VALUE_KEY ? '' : context.targetLaneKey;
		} else if (context.swimlaneBy === 'tags') {
			tagsPresent = true;
			if (context.targetLaneKey !== KANBAN_NO_VALUE_KEY) {
				tags.push(context.targetLaneKey);
			}
		} else if (context.swimlaneBy === 'contexts' || context.swimlaneBy === 'assignees') {
			fieldValues[context.swimlaneBy] = context.targetLaneKey === KANBAN_NO_VALUE_KEY ? '' : context.targetLaneKey;
		} else if (customSwimlaneMapping) {
			fieldValues[customSwimlaneMapping.canonicalKey] = context.targetLaneKey === KANBAN_NO_VALUE_KEY ? '' : context.targetLaneKey;
		}

		return { fieldValues, tags, tagsPresent };
	}

	private resolveKanbanSourceLaneKey(
		task: IndexedTask,
		swimlaneBy: KanbanCellActionContext['swimlaneBy'],
		targetLaneKey: string,
	): string | null {
		if (!swimlaneBy) return KANBAN_NO_VALUE_KEY;
		if (swimlaneBy === 'priority') {
			// Resolve to the canonical lane key so lenient-cased priorities match their lane.
			return extractLaneKeys(task, 'priority', this.settings.keyMappings, this.settings.priorities)[0] ?? KANBAN_NO_VALUE_KEY;
		}
		if (swimlaneBy === 'dateDue' || swimlaneBy === 'dateScheduled') {
			return (task.fieldValues[swimlaneBy] ?? '').trim() || KANBAN_NO_VALUE_KEY;
		}
		if (swimlaneBy === 'tags') {
			return task.tags.includes(targetLaneKey) ? targetLaneKey : null;
		}
		if (swimlaneBy === 'contexts' || swimlaneBy === 'assignees') {
			return parseListValue(task.fieldValues[swimlaneBy] ?? '').includes(targetLaneKey) ? targetLaneKey : null;
		}
		const customSwimlaneMapping = getManagedCustomFieldOptionMapping(swimlaneBy, this.settings.keyMappings);
		if (customSwimlaneMapping?.type === 'list') {
			return parseListValue(task.fieldValues[customSwimlaneMapping.canonicalKey] ?? '').includes(targetLaneKey) ? targetLaneKey : null;
		}
		if (customSwimlaneMapping) {
			return (task.fieldValues[customSwimlaneMapping.canonicalKey] ?? '').trim() || KANBAN_NO_VALUE_KEY;
		}
		return null;
	}

	private async assignTaskToCalendarSelection(
		leaf: import('obsidian').WorkspaceLeaf,
		selection: CalendarSlotSelection,
		options: { preventTaskFinderFocusScroll?: boolean } = {},
	): Promise<void> {
		const filterSet = this.getCalendarFilterSetForLeaf(leaf);
		while (true) {
			const task = await this.promptCalendarTaskSelection({
				preventFocusScroll: options.preventTaskFinderFocusScroll === true,
			});
			if (!task) return;

			const writebackPlan = selection.mode === 'timed'
				? buildTimedCalendarWritebackPlanForExistingTask(selection, task.fieldValues)
				: buildCalendarWritebackPlan(selection);
			if (selection.mode === 'timed') {
				writebackPlan.payload.dateStarted = '';
			}
			const schedulePayload = this.normalizeCalendarPayloadForPersistedUpdate(writebackPlan);
			const nextDraft = {
				description: task.description,
				checkbox: task.checkbox,
				fieldValues: {
					...task.fieldValues,
					...schedulePayload,
				},
				tags: [...task.tags],
			};

			await this.updateTaskFieldsAndRefresh(task.operonId, schedulePayload, {
				changedKeys: Object.keys(schedulePayload),
			});
			this.refreshViews();
			await this.maybeOpenCalendarEditorForFilterMismatch(filterSet, nextDraft, () => {
				this.openEditorForId(task.operonId);
			});
			new Notice(t('notifications', 'scheduledTask', { task: task.description || task.operonId }));
			return;
		}
	}

	private openCalendarTaskCreator(
		leaf: import('obsidian').WorkspaceLeaf,
		selection: CalendarSlotSelection,
		submitMode: TaskCreatorSubmitMode,
		initialDraft: TaskCreatorDraft | null = null,
		initialDescription = '',
		openOptions: CalendarTaskCreatorOpenOptions = {},
	): void {
		const {
			preserveMobileTimeGridScrollOnSubmit: shouldPreserveMobileTimeGridScrollOnSubmit,
			...taskCreatorOpenOptions
		} = openOptions;
		const draft = initialDraft ?? buildCalendarTaskCreatorDraft(selection, initialDescription);
		const preserveMobileTimeGridScrollOnSubmit = (): void => {
			if (shouldPreserveMobileTimeGridScrollOnSubmit === true) {
				this.preserveMobileCalendarTimeGridScrollForLeaf(leaf);
			}
		};
		this.openTaskCreator(draft, {
			submitMode,
			...taskCreatorOpenOptions,
			onSubmitFile: (nextDraft) => {
				preserveMobileTimeGridScrollOnSubmit();
				return this.createCalendarFileTaskFromCreatorDraft(leaf, selection, nextDraft, openOptions);
			},
			onSubmitInline: (nextDraft) => {
				preserveMobileTimeGridScrollOnSubmit();
				return this.createCalendarInlineTaskFromCreatorDraft(leaf, selection, nextDraft);
			},
		});
		if (!initialDraft) {
			this.queueCalendarDailyNoteParentSeedBackgroundEnsure(selection.startDate, submitMode);
		}
	}

	private async applyCalendarDailyNoteParentSeedForCreatorSubmit(
		selection: CalendarSlotSelection,
		draft: TaskCreatorDraft,
	): Promise<TaskCreatorDraft> {
		if (!isDailyNotesCoreAvailable(this.app)) return draft;
		if ((draft.fieldValues['parentTask'] ?? '').trim()) return draft;
		if (isTaskCreatorFieldExplicitlyCleared(draft, 'parentTask')) return draft;
		const parentSeed = await this.getCalendarDailyNoteParentSeedPromise(selection.startDate);
		if (!parentSeed) return draft;
		return applyTaskCreatorParentSeedToDraft(cloneTaskCreatorDraft(draft), parentSeed, this.settings);
	}

	private queueCalendarDailyNoteParentSeedBackgroundEnsure(dateKey: string, submitMode: TaskCreatorSubmitMode): void {
		const normalizedDateKey = dateKey.trim();
		if (!normalizedDateKey || !this.settings.createDailyNotesAsOperonTask) return;
		if (!isDailyNotesCoreAvailable(this.app)) return;
		if (submitMode === 'inline-only' && this.resolveEffectiveInlineTaskSaveMode() !== 'daily-notes') return;
		const modal = this.taskCreatorModal;
		setWindowTimeout(() => {
			void this.getCalendarDailyNoteParentSeedPromise(normalizedDateKey)
				.then(parentSeed => {
					if (!modal || this.taskCreatorModal !== modal) return;
					this.maybeNoticeCalendarDailyNoteCreated(parentSeed);
					if (parentSeed) {
						modal.applyBackgroundParentSeed(parentSeed.parentTaskId, parentSeed.parentFieldValues, parentSeed.parentTags);
					}
				});
		}, 0);
	}

	private maybeNoticeCalendarDailyNoteCreated(parentSeed: TaskCreatorParentSeed | null): void {
		if (!parentSeed?.wasCreated) return;
		const noticeKey = parentSeed.sourceFilePath?.trim() || parentSeed.sourceTitle?.trim() || parentSeed.parentTaskId.trim();
		if (!noticeKey || this.calendarDailyNoteCreatedNoticePaths.has(noticeKey)) return;
		this.calendarDailyNoteCreatedNoticePaths.add(noticeKey);
		new Notice(t('notifications', 'dailyNoteCreated', {
			title: parentSeed.sourceTitle?.trim() || noticeKey,
		}), 2200);
	}

	private getCalendarDailyNoteParentSeedPromise(dateKey: string): Promise<TaskCreatorParentSeed | null> {
		const normalizedDateKey = dateKey.trim();
		if (!normalizedDateKey) return Promise.resolve(null);

		const existing = this.calendarDailyNoteParentSeedPromises.get(normalizedDateKey);
		if (existing) return existing;

		const promise = this.resolveCalendarDailyNoteTaskCreatorParentSeed(normalizedDateKey)
			.finally(() => {
				if (this.calendarDailyNoteParentSeedPromises.get(normalizedDateKey) === promise) {
					this.calendarDailyNoteParentSeedPromises.delete(normalizedDateKey);
				}
			});
		this.calendarDailyNoteParentSeedPromises.set(normalizedDateKey, promise);
		return promise;
	}

	private async resolveCalendarDailyNoteTaskCreatorParentSeed(dateKey: string): Promise<TaskCreatorParentSeed | null> {
		if (!this.settings.createDailyNotesAsOperonTask) return null;
		if (!isDailyNotesCoreAvailable(this.app)) return null;

		try {
			const dailyNote = await this.resolveOrCreateCalendarDailyNoteResult(dateKey);
			if (!(dailyNote.file instanceof TFile)) return null;

			let parentTaskId = dailyNote.operonParentTaskId?.trim() || null;
			let parentFieldValues = dailyNote.operonParentFieldValues
				? { ...dailyNote.operonParentFieldValues }
				: null;
			let parentTags: string[] | null = dailyNote.operonParentTags
				? [...dailyNote.operonParentTags]
				: null;

			if (!parentTaskId) {
				parentTaskId = resolveFileTaskAutoParentOperonId({
					enabled: true,
					filePath: dailyNote.file.path,
					tasks: this.indexer.getAllTasks(),
					frontmatter: this.app.metadataCache.getFileCache(dailyNote.file)?.frontmatter ?? null,
					keyMappings: this.settings.keyMappings,
				});
			}

			if (parentTaskId && !this.indexer.getTask(parentTaskId)) {
				await this.indexer.reindexFilePath(dailyNote.file.path, { notify: false });
			}

			const indexedParent = parentTaskId ? this.indexer.getTask(parentTaskId) ?? null : null;
			if (indexedParent) {
				parentFieldValues = { ...indexedParent.fieldValues };
				parentTags = [...indexedParent.tags];
			}

			if (!parentTaskId || !parentFieldValues) {
				const document = await this.loadParsedFrontmatterDocument(dailyNote.file);
				if (!parentTaskId) {
					parentTaskId = document.managedFieldValues['operonId']?.trim() || null;
				}
				parentFieldValues = parentFieldValues ?? { ...document.managedFieldValues };
				parentTags = parentTags ?? [...document.tags];
			}

			if (!parentTaskId) return null;

			if (!this.indexer.getTask(parentTaskId)) {
				await this.indexer.reindexFilePath(dailyNote.file.path, { notify: false });
			}

			return {
				parentTaskId,
				parentFieldValues,
				parentTags,
				wasCreated: dailyNote.wasCreated,
				sourceTitle: dailyNote.file.basename,
				sourceFilePath: dailyNote.file.path,
			};
		} catch (error) {
			console.error('Operon: failed to resolve calendar daily note parent seed', error);
			return null;
		}
	}

	private async createCalendarFileTaskFromCreatorDraft(
		leaf: import('obsidian').WorkspaceLeaf,
		selection: CalendarSlotSelection,
		draft: TaskCreatorDraft,
		openOptions: CalendarTaskCreatorOpenOptions = {},
	): Promise<boolean> {
		const selectedTemplate = findFileTaskTemplateOptionById(
			this.getFileTaskTemplateOptions(),
			draft.fileTemplateId,
		);
		const submitDraft = selectedTemplate
			? await this.applyCalendarDailyNoteParentSeedForCreatorSubmit(selection, draft)
			: draft;
		return await this.createFileTaskFromCreatorDraft(submitDraft, {
			reopenCreator: preservedDraft => this.openCalendarTaskCreator(leaf, selection, 'file-only', preservedDraft, '', openOptions),
			onCreated: created => {
				const createdTask = this.getCreatedFileTaskForFilterDraft(created);
				this.maybeNoticeCalendarCreatorFilterMismatch(leaf, {
					...(createdTask
						? this.buildFilterDraftFromIndexedTask(createdTask)
						: {
							description: created.description,
							checkbox: 'open',
							fieldValues: { ...created.fieldValues },
							tags: [...created.tags],
						}),
				});
			},
		});
	}

	private async createCalendarInlineTaskFromCreatorDraft(
		leaf: import('obsidian').WorkspaceLeaf,
		selection: CalendarSlotSelection,
		draft: TaskCreatorDraft,
	): Promise<boolean> {
		const explicitParentTaskId = (draft.fieldValues['parentTask'] ?? '').trim();
		const hasExplicitParentTask = !!explicitParentTaskId && draft.explicitFieldKeys.includes('parentTask');
		const saveMode = this.resolveEffectiveInlineTaskSaveMode();
		if (hasExplicitParentTask || saveMode !== 'daily-notes') {
			const inlineCreationOptions: TaskCreatorInlineCreationOptions = {
				targetDateKey: selection.startDate,
			};
			if (!hasExplicitParentTask) {
				inlineCreationOptions.parentAwarePlacement = false;
			}
			const created = await this.createInlineTaskFromCreatorDraftResult(draft, inlineCreationOptions);
			if (!created) return false;
			this.maybeNoticeCalendarCreatorFilterMismatch(
				leaf,
				this.getCreatedInlineTaskFilterDraft(created.operonId, draft, 'open'),
			);
			return true;
		}

		const parentTaskExplicitlyCleared = isTaskCreatorFieldExplicitlyCleared(draft, 'parentTask');
		const parentSeed = this.settings.createDailyNotesAsOperonTask && !parentTaskExplicitlyCleared
			? await this.getCalendarDailyNoteParentSeedPromise(selection.startDate)
			: null;
		const dailyNote = await this.resolveOrCreateCalendarDailyNoteResult(selection.startDate);
		if (!(dailyNote.file instanceof TFile)) {
			new Notice(t('notifications', 'dailyNoteResolveFailed'));
			return false;
		}

		const created = await this.insertTaskCreatorInlineTaskIntoFile(dailyNote.file, draft, {
			fallbackParentTaskId: parentTaskExplicitlyCleared
				? null
				: parentSeed?.parentTaskId ?? (dailyNote.wasCreated ? dailyNote.operonParentTaskId : null),
			fallbackParentFieldValues: parentTaskExplicitlyCleared
				? null
				: parentSeed?.parentFieldValues ?? (dailyNote.wasCreated ? dailyNote.operonParentFieldValues : null),
			fallbackParentTags: parentTaskExplicitlyCleared
				? null
				: parentSeed?.parentTags ?? (dailyNote.wasCreated ? dailyNote.operonParentTags : null),
			autoParentEnabled: !parentTaskExplicitlyCleared,
		});
		if (!created) {
			new Notice(t('notifications', 'dailyNoteInlineCreateFailed'));
			return false;
		}

		this.showTaskNotice('inline-created', {
			description: draft.description,
			operonId: created.operonId,
		});
		await this.indexer.reindexFilePath(dailyNote.file.path);
		await this.finalizeTaskCreatorCreatedTask(created.operonId, draft);
		this.maybeNoticeCalendarCreatorFilterMismatch(
			leaf,
			this.getCreatedInlineTaskFilterDraft(created.operonId, draft, 'open'),
		);
		this.refreshViews();
		return true;
	}

	private async resolveOrCreateCalendarDailyNote(dateKey: string): Promise<TFile | null> {
		const resolved = await this.resolveOrCreateCalendarDailyNoteResult(dateKey);
		return resolved.file;
	}

	private async openDailyNoteFromDateKey(dateKey: string): Promise<void> {
		const dailyNote = await this.resolveOrCreateCalendarDailyNote(dateKey);
		if (!(dailyNote instanceof TFile)) {
			new Notice(t('notifications', 'dailyNoteResolveFailed'));
			return;
		}
		await this.app.workspace.getLeaf(false).openFile(dailyNote);
	}

	private async resolveOrCreateCalendarDailyNoteResult(dateKey: string): Promise<{
		file: TFile | null;
		wasCreated: boolean;
		operonParentTaskId: string | null;
		operonParentFieldValues: Record<string, string> | null;
		operonParentTags: string[] | null;
	}> {
		const config = await loadDailyNotesCoreConfig(this.app);
		const filePath = resolveDailyNotePathFromDateKey(dateKey, config);
		if (!filePath) {
			return {
				file: null,
				wasCreated: false,
				operonParentTaskId: null,
				operonParentFieldValues: null,
				operonParentTags: null,
			};
		}
		const existing = this.app.vault.getAbstractFileByPath(filePath);
		if (existing instanceof TFile) {
			return {
				file: existing,
				wasCreated: false,
				operonParentTaskId: null,
				operonParentFieldValues: null,
				operonParentTags: null,
			};
		}
		if (existing) {
			return {
				file: null,
				wasCreated: false,
				operonParentTaskId: null,
				operonParentFieldValues: null,
				operonParentTags: null,
			};
		}

		await this.ensureParentFolderPathExists(filePath);
		const template = await this.loadDailyNoteTemplateSource(config.template);
		this.workflowNormalizationInProgress.add(filePath);
		try {
			await this.app.vault.create(filePath, template.content);

			const created = this.app.vault.getAbstractFileByPath(filePath);
			if (!(created instanceof TFile)) {
				return {
					file: null,
					wasCreated: false,
					operonParentTaskId: null,
					operonParentFieldValues: null,
					operonParentTags: null,
				};
			}

			const renderedContent = await this.maybeProcessDailyNoteTemplateContent(created, template.file, template.content);
			const now = localNow();
			const templatesConfig = await loadTemplatesCoreConfig(this.app);
			const coreResolvedContent = resolveCoreTemplateVariables(renderedContent, {
				title: created.basename,
				date: now.slice(0, 10),
				now,
				dateFormat: templatesConfig.dateFormat,
				timeFormat: templatesConfig.timeFormat,
			});
			const initializedDocument = await this.maybeInitializeDailyNoteAsOperonTask(created, coreResolvedContent, now);
			if (!initializedDocument) {
				if (coreResolvedContent !== await this.app.vault.cachedRead(created)) {
					await this.app.vault.modify(created, coreResolvedContent);
				}
			}
			return {
				file: created,
				wasCreated: true,
				operonParentTaskId: initializedDocument?.managedFieldValues['operonId']?.trim() || null,
				operonParentFieldValues: initializedDocument?.managedFieldValues
					? { ...initializedDocument.managedFieldValues }
					: null,
				operonParentTags: initializedDocument ? [...initializedDocument.tags] : null,
			};
		} finally {
			this.workflowNormalizationInProgress.delete(filePath);
			this.templatedFileTaskCreationCandidates.delete(filePath);
			this.indexer.scheduleReindex(filePath);
			if (this.workflowNormalizationPending.delete(filePath)) {
				void this.normalizeWorkflowStateAfterRawEdit(filePath);
			}
		}
	}

	private async maybeInitializeDailyNoteAsOperonTask(
		file: TFile,
		content: string,
		now: string,
	): Promise<ParsedFrontmatterDocument | null> {
		if (!this.settings.createDailyNotesAsOperonTask && !this.hasTemplatedFileTaskIdentity(content)) return null;

		const currentContent = await this.app.vault.cachedRead(file);
		const resolvedContent = this.resolveTemplatedFileTaskContent(content, file.basename, now);
		if (resolvedContent !== currentContent) {
			await this.app.vault.modify(file, resolvedContent);
		}
		return await this.loadParsedFrontmatterDocument(file);
	}

	private async resolveOrCreateDailyNoteParentTaskId(dateKey: string): Promise<string | null> {
		if (!this.settings.createDailyNotesAsOperonTask) return null;

		const dailyNote = await this.resolveOrCreateCalendarDailyNoteResult(dateKey);
		if (!(dailyNote.file instanceof TFile)) return null;

		let parentTaskId = dailyNote.operonParentTaskId?.trim() || null;
		if (!parentTaskId) {
			parentTaskId = resolveFileTaskAutoParentOperonId({
				enabled: true,
				filePath: dailyNote.file.path,
				tasks: this.indexer.getAllTasks(),
				frontmatter: this.app.metadataCache.getFileCache(dailyNote.file)?.frontmatter ?? null,
				keyMappings: this.settings.keyMappings,
			});
		}
		if (!parentTaskId) {
			const document = await this.loadParsedFrontmatterDocument(dailyNote.file);
			parentTaskId = document.managedFieldValues['operonId']?.trim() || null;
		}
		if (parentTaskId && !this.indexer.getTask(parentTaskId)) {
			await this.indexer.reindexFilePath(dailyNote.file.path, { notify: false });
		}
		return parentTaskId;
	}

	private async maybeApplyDailyNoteParentRealignmentToPayload(
		task: IndexedTask,
		payload: Record<string, string>,
		options: { mode?: 'merge' | 'replace' } = {},
	): Promise<string | null> {
		if (!this.settings.createDailyNotesAsOperonTask) return null;
		if (!Object.prototype.hasOwnProperty.call(payload, 'dateScheduled')) return null;

		const parentTaskId = (task.fieldValues['parentTask'] ?? '').trim();
		if (!parentTaskId) return null;

		const config = await loadDailyNotesCoreConfig(this.app);
		const targetDateKey = resolveDailyNoteParentRealignmentTargetDate({
			enabled: this.settings.createDailyNotesAsOperonTask,
			currentFieldValues: task.fieldValues,
			patch: payload,
			currentParentTask: this.indexer.getTask(parentTaskId),
			dailyNotesFolder: config.folder,
			dailyNotesFormat: config.format,
			mode: options.mode ?? 'merge',
		});
		if (!targetDateKey) return null;

		const nextParentTaskId = await this.resolveOrCreateDailyNoteParentTaskId(targetDateKey);
		if (!nextParentTaskId || nextParentTaskId === parentTaskId) return null;

		payload['parentTask'] = nextParentTaskId;
		return nextParentTaskId;
	}

	private async ensureParentFolderPathExists(filePath: string): Promise<void> {
		const lastSlash = filePath.lastIndexOf('/');
		if (lastSlash < 0) return;
		await this.ensureFolderPathExists(filePath.slice(0, lastSlash));
	}

	private async ensureFolderPathExists(folderPath: string): Promise<void> {
		if (!folderPath.trim()) return;
		const segments = folderPath.split('/').filter(Boolean);
		let currentPath = '';
		for (const segment of segments) {
			currentPath = currentPath ? `${currentPath}/${segment}` : segment;
			if (this.app.vault.getAbstractFileByPath(currentPath)) continue;
			await this.app.vault.createFolder(currentPath).catch(() => undefined);
		}
	}

	private async loadDailyNoteTemplateSource(templatePath: string): Promise<{ file: TFile | null; content: string }> {
		const normalizedPath = templatePath.trim();
		if (!normalizedPath) {
			return { file: null, content: '' };
		}

		const templateFile = this.app.vault.getAbstractFileByPath(normalizedPath);
		if (!(templateFile instanceof TFile)) {
			return { file: null, content: '' };
		}

		return {
			file: templateFile,
			content: await this.app.vault.cachedRead(templateFile),
		};
	}

	private async maybeProcessDailyNoteTemplateContent(
		file: TFile,
		templateFile: TFile | null,
		content: string,
	): Promise<string> {
		if (!content.includes('<%') || !(templateFile instanceof TFile)) return content;

		const templater = this.getTemplaterEngine();
		if (!templater) return content;

		try {
			const parseTemplate = templater['parse_template'];
			const createRunningConfig = templater['create_running_config'];
			const startTask = templater['start_templater_task'];
			const endTask = templater['end_templater_task'];

			if (
				typeof parseTemplate === 'function'
				&& typeof createRunningConfig === 'function'
			) {
				if (typeof startTask === 'function') {
					await startTask.call(templater, file.path);
				}

				try {
					const config = callUnknownMethod(templater, 'create_running_config', templateFile, file, 2);
					const rendered = await callUnknownMethod(templater, 'parse_template', config, content);
					return typeof rendered === 'string' ? rendered : content;
				} finally {
					if (typeof endTask === 'function') {
						await endTask.call(templater, file.path);
					}
				}
			}
		} catch (error) {
			console.error('Operon: failed to process Daily Notes template with Templater', error);
		}

		return content;
	}

	private async insertCalendarInlineTaskIntoDailyNote(
		file: TFile,
		selection: CalendarSlotSelection,
		options: {
			description?: string;
			additionalFieldValues?: Record<string, string>;
			tags?: string[];
			fallbackParentTaskId?: string | null;
			fallbackParentFieldValues?: Record<string, string> | null;
			fallbackParentTags?: string[] | null;
		} = {},
	): Promise<{ operonId: string; lineNumber: number } | null> {
		const content = await this.app.vault.cachedRead(file);
		const inlineHeading = resolveCalendarInlineHeading(this.settings.calendarInlineTaskHeading);
		const insertionPreview = insertInlineTaskUnderHeading(content, inlineHeading, '- [ ]');
		const now = localNow();
		const autoParentTaskId = resolveFileTaskAutoParentOperonId({
			enabled: true,
			filePath: file.path,
			tasks: this.indexer.getAllTasks(),
			frontmatter: this.app.metadataCache.getFileCache(file)?.frontmatter ?? null,
			keyMappings: this.settings.keyMappings,
		});
		const inherited = autoParentTaskId
			? resolveSubtaskInitialFields(autoParentTaskId, this.indexer, this.settings)
			: resolveSubtaskInitialFieldsFromParentValues(
				options.fallbackParentTaskId ?? null,
				options.fallbackParentFieldValues,
				this.settings,
				options.fallbackParentTags,
			);
		const provisionalTaskLine = this.buildNewInlineTaskWithInheritedFields(
			options.description ?? '',
			'open',
			inherited,
			now,
			file.path,
			insertionPreview.insertedLineNumber,
		);
		const parsed = this.parseInlineTaskLine(provisionalTaskLine, insertionPreview.insertedLineNumber, file.path);
		if (!parsed?.operonId) return null;

		const writebackPlan = buildCalendarWritebackPlan(selection);
		for (const [key, value] of Object.entries(writebackPlan.payload)) {
			if (value === undefined || value === '') continue;
			this.setParsedTaskField(parsed, key, value);
		}
		for (const [key, value] of Object.entries(options.additionalFieldValues ?? {})) {
			if (!value.trim()) continue;
			this.setParsedTaskField(parsed, key, value);
		}
		if (options.tags?.length) {
			parsed.tags = [...new Set([
				...parsed.tags.map(tag => tag.replace(/^#/, '').trim()).filter(Boolean),
				...options.tags.map(tag => tag.replace(/^#/, '').trim()).filter(Boolean),
			])];
		}
		this.touchParsedTaskModifiedTimestamp(parsed, now);

		const taskLine = this.serializeInlineTask(parsed);
		const insertion = insertInlineTaskUnderHeading(content, inlineHeading, taskLine);
		await this.app.vault.modify(file, insertion.content);
		return {
			operonId: parsed.operonId,
			lineNumber: insertion.insertedLineNumber,
		};
	}

	private async insertKanbanInlineTaskIntoDailyNote(
		file: TFile,
		seed: {
			additionalFieldValues: Record<string, string>;
			tags: string[];
			checkbox: ParsedTask['checkbox'];
			fallbackParentTaskId?: string | null;
			fallbackParentFieldValues?: Record<string, string> | null;
			fallbackParentTags?: string[] | null;
		},
	): Promise<{ operonId: string; lineNumber: number } | null> {
		const content = await this.app.vault.cachedRead(file);
		const inlineHeading = resolveCalendarInlineHeading(this.settings.calendarInlineTaskHeading);
		const insertionPreview = insertInlineTaskUnderHeading(content, inlineHeading, '- [ ]');
		const now = localNow();
		const autoParentTaskId = resolveFileTaskAutoParentOperonId({
			enabled: true,
			filePath: file.path,
			tasks: this.indexer.getAllTasks(),
			frontmatter: this.app.metadataCache.getFileCache(file)?.frontmatter ?? null,
			keyMappings: this.settings.keyMappings,
		});
		const inherited = autoParentTaskId
			? resolveSubtaskInitialFields(autoParentTaskId, this.indexer, this.settings)
			: resolveSubtaskInitialFieldsFromParentValues(
				seed.fallbackParentTaskId ?? null,
				seed.fallbackParentFieldValues,
				this.settings,
				seed.fallbackParentTags,
			);
		const provisionalTaskLine = this.buildNewInlineTaskWithInheritedFields(
			'',
			seed.checkbox,
			inherited,
			now,
			file.path,
			insertionPreview.insertedLineNumber,
		);
		const parsed = this.parseInlineTaskLine(provisionalTaskLine, insertionPreview.insertedLineNumber, file.path);
		if (!parsed?.operonId) return null;

		for (const [key, value] of Object.entries(seed.additionalFieldValues)) {
			if (!value.trim()) continue;
			this.setParsedTaskField(parsed, key, value);
		}
		if (seed.tags.length) {
			parsed.tags = [...new Set([
				...parsed.tags.map(tag => tag.replace(/^#/, '').trim()).filter(Boolean),
				...seed.tags.map(tag => tag.replace(/^#/, '').trim()).filter(Boolean),
			])];
		}
		this.touchParsedTaskModifiedTimestamp(parsed, now);

		const taskLine = this.serializeInlineTask(parsed);
		const insertion = insertInlineTaskUnderHeading(content, inlineHeading, taskLine);
		await this.app.vault.modify(file, insertion.content);
		return {
			operonId: parsed.operonId,
			lineNumber: insertion.insertedLineNumber,
		};
	}

	private async openCalendarDailyNoteAtLine(file: TFile, lineNumber: number): Promise<MarkdownView | null> {
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(file);
		const view = leaf.view;
		if (view instanceof MarkdownView) {
			view.editor.setCursor({ line: lineNumber, ch: 0 });
			return view;
		}
		return null;
	}

	private async openMarkdownFileAtLine(file: TFile, lineNumber: number): Promise<void> {
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(file);
		const view = leaf.view;
		if (!(view instanceof MarkdownView)) return;
		view.editor.setCursor({ line: lineNumber, ch: 0 });
		view.editor.scrollIntoView({
			from: { line: lineNumber, ch: 0 },
			to: { line: lineNumber, ch: 0 },
		}, true);
	}

	private async openCalendarInlineTaskEditor(
		file: TFile,
		lineNumber: number,
		indexedTask: IndexedTask | null,
	): Promise<void> {
		if (indexedTask) {
			this.openEditorForId(indexedTask.operonId);
			return;
		}

		const view = await this.openCalendarDailyNoteAtLine(file, lineNumber);
		if (!(view instanceof MarkdownView)) {
			new Notice(t('notifications', 'dailyNoteInlineOpenFailed'));
			return;
		}

		const line = view.editor.getLine(lineNumber);
		const parsed = this.parseInlineTaskLine(line, lineNumber, file.path);
		if (!parsed) {
			new Notice(t('notifications', 'dailyNoteInlineParseFailed'));
			return;
		}

		await this.openInlineTaskEditorFromParsedTask(parsed, view.editor, file.path, {
			focusDescriptionOnMount: true,
			selectDescriptionOnMount: true,
		});
	}

	private normalizeCalendarPayloadForPersistedUpdate(writebackPlan: { payload: Record<string, string | undefined> }): Record<string, string> {
		const payload: Record<string, string> = {};
		for (const [key, value] of Object.entries(writebackPlan.payload)) {
			payload[key] = value ?? '';
		}
		return payload;
	}

	private normalizeCalendarPayloadForNewTask(writebackPlan: { payload: Record<string, string | undefined> }): Record<string, string> {
		const payload: Record<string, string> = {};
		for (const [key, value] of Object.entries(writebackPlan.payload)) {
			if ((value ?? '').trim().length === 0) continue;
			payload[key] = value!;
		}
		return payload;
	}

	private parseInlineTaskLine(line: string, lineNumber: number, filePath: string): ParsedTask | null {
		return parseTaskLine(line, lineNumber, filePath, this.settings.keyMappings);
	}

	private serializeInlineTask(task: ParsedTask): string {
		this.normalizeParsedTaskCreatedTimestamp(task);
		return serializeTask(task, this.settings.keyMappings);
	}

	private normalizeParsedTaskCreatedTimestamp(task: ParsedTask, fallbackNow?: string): void {
		const existing = task.fields.find(field => field.key === 'datetimeCreated');
		if (!existing) {
			if (!fallbackNow) return;
			task.fields.push(this.createInlineField('datetimeCreated', fallbackNow, 'datetime'));
			return;
		}

		const normalizedValue = normalizeLegacyCreatedDatetime(existing.value || fallbackNow || '');
		if (normalizedValue) {
			existing.value = normalizedValue;
			existing.rawValue = normalizedValue;
		}
		existing.type = 'datetime';
		if (existing.sourceKey === 'dateCreated') {
			existing.sourceKey = this.getInlineWriteKeyName('datetimeCreated');
		}
	}

	private touchParsedTaskModifiedTimestamp(task: ParsedTask, now: string): void {
		const modified = task.fields.find(field => field.key === 'datetimeModified');
		if (modified) {
			modified.value = now;
			modified.rawValue = now;
			modified.type = 'datetime';
			return;
		}
		task.fields.push(this.createInlineField('datetimeModified', now, 'datetime'));
	}

	private getDisplayPropertyName(canonicalKey: string): string {
		const mapping = this.settings.keyMappings.find(candidate =>
			candidate.enabled
			&& candidate.canonicalKey === canonicalKey
			&& candidate.visiblePropertyName
		);
		return mapping?.visiblePropertyName ?? canonicalKey;
	}

	private getInlineWriteKeyName(canonicalKey: string): string {
		return canonicalKey;
	}

	private createInlineField(
		key: string,
		value: string,
		type: OperonField['type'],
		sourceKey?: string,
	): OperonField {
		return {
			sourceKey: sourceKey ?? this.getInlineWriteKeyName(key),
			key,
			value,
			rawValue: value,
			type,
			isCanonical: true,
			containerRange: { from: 0, to: 0 },
			valueRange: { from: 0, to: 0 },
		};
	}

	private setParsedTaskField(
		task: ParsedTask,
		key: string,
		value: string,
		type?: OperonField['type'],
	): void {
		const existing = task.fields.find(field => field.key === key);
		if (existing) {
			existing.value = value;
			existing.rawValue = value;
			if (type) existing.type = type;
			if (key === 'datetimeCreated') {
				this.normalizeParsedTaskCreatedTimestamp(task, value);
			}
			return;
		}
		const resolvedType = type ?? getManagedTaskFieldType(key, this.settings.keyMappings) ?? 'text';
		task.fields.push(this.createInlineField(key, value, resolvedType));
		if (key === 'datetimeCreated') {
			this.normalizeParsedTaskCreatedTimestamp(task, value);
		}
	}

	private applyInheritedSubtaskFields(task: ParsedTask, inherited: SubtaskInitialFields): void {
		if (inherited.tags?.length) {
			task.tags = Array.from(new Set([
				...task.tags.map(tag => tag.replace(/^#/, '').trim()).filter(Boolean),
				...inherited.tags.map(tag => tag.replace(/^#/, '').trim()).filter(Boolean),
			]));
		}
		for (const key of getSubtaskInitialFieldKeys(inherited)) {
			const rawValue = inherited[key];
			const value = typeof rawValue === 'string' ? rawValue.trim() : '';
			if (!value) continue;
			this.setParsedTaskField(task, key, value, getManagedTaskFieldType(key, this.settings.keyMappings) ?? 'text');
		}
	}

	private buildNewInlineTaskWithInheritedFields(
		description: string,
		checkbox: ParsedTask['checkbox'],
		inherited: SubtaskInitialFields,
		now: string,
		filePath: string,
		lineNumber: number,
	): string {
		const checkboxToken = checkbox === 'done' ? 'x' : checkbox === 'cancelled' ? '-' : ' ';
		const parsed = this.parseInlineTaskLine(`- [${checkboxToken}] ${description}`.trimEnd(), lineNumber, filePath);
		if (!parsed) {
			const operonIdKey = this.getInlineWriteKeyName('operonId');
			const datetimeCreatedKey = this.getInlineWriteKeyName('datetimeCreated');
			const datetimeModifiedKey = this.getInlineWriteKeyName('datetimeModified');
			const inheritedFragments = getSubtaskInitialFieldKeys(inherited)
				.map(key => {
					const value = inherited[key];
					return `{{${this.getInlineWriteKeyName(key)}:: ${typeof value === 'string' ? value.trim() : ''}}}`;
				});
			const inheritedTagFragments = (inherited.tags ?? [])
				.map(tag => tag.replace(/^#/, '').trim())
				.filter(Boolean)
				.map(tag => `#${tag}`);
			return [
				`- [${checkboxToken}] ${description}`,
				...inheritedTagFragments,
				`{{${operonIdKey}:: ${generateOperonId()}}}`,
				`{{${datetimeCreatedKey}:: ${now}}}`,
				...inheritedFragments,
				`{{${datetimeModifiedKey}:: ${now}}}`,
			].join(' ').trimEnd();
		}

		if (!parsed.operonId) this.setParsedTaskField(parsed, 'operonId', generateOperonId(), 'text');
		this.normalizeParsedTaskCreatedTimestamp(parsed, now);
		this.applyInheritedSubtaskFields(parsed, inherited);
		this.touchParsedTaskModifiedTimestamp(parsed, now);
		return this.serializeInlineTask(parsed);
	}

	private resolveInlineTaskInheritedFields(file: TFile | null): SubtaskInitialFields {
		const autoParentTaskId = resolveFileTaskAutoParentOperonId({
			enabled: this.settings.autoParentFileTask,
			filePath: file?.path,
			tasks: this.indexer.getAllTasks(),
			frontmatter: file ? this.app.metadataCache.getFileCache(file)?.frontmatter ?? null : null,
			keyMappings: this.settings.keyMappings,
		});
		return resolveSubtaskInitialFields(autoParentTaskId, this.indexer, this.settings);
	}

	private stripInlineTaskBulletMarker(text: string): string {
		const trimmed = text.replace(/^\s+/, '');
		return trimmed.replace(/^([-*+]|\d+[.)])\s+/, '');
	}

	private buildTaskFromPlainLine(
		lineText: string,
		lineNumber: number,
		filePath: string,
		inherited: SubtaskInitialFields,
		now: string,
	): string {
		const indent = lineText.match(/^\s*/)?.[0] ?? '';
		const description = this.stripInlineTaskBulletMarker(lineText).trim();
		const taskLine = this.buildNewInlineTaskWithInheritedFields(description, 'open', inherited, now, filePath, lineNumber);
		return `${indent}${taskLine}`;
	}

	private placeCursorAfterInlineTaskDescription(
		editor: Editor,
		filePath: string,
		lineNumber: number,
		lineText: string = editor.getLine(lineNumber),
	): void {
		const parsed = this.parseInlineTaskLine(lineText, lineNumber, filePath);
		if (!parsed) return;
		editor.setCursor({
			line: lineNumber,
			ch: resolveInlineTaskDescriptionCursorCh(parsed),
		});
	}

	private openInlineTaskEditorForLine(
		editor: Editor,
		filePath: string,
		lineNumber: number,
		task: ParsedTask,
	): void {
		runAsyncAction('inline task editor open failed', () => this.openTaskEditorFor(task, (request) => {
			return (async () => {
				editor.setLine(lineNumber, request.taskLine);
				this.placeCursorAfterInlineTaskDescription(editor, filePath, lineNumber, request.taskLine);
				await this.persistInlineEditorBufferAndReindex(filePath);
				return true;
			})();
		}));
	}

	private upgradePlainCheckboxLineToOperonInlineTask(
		editor: Editor,
		view: MarkdownView,
		lineNumber: number,
	): void {
		const filePath = view.file?.path ?? '';
		if (!filePath) {
			new Notice(t('notifications', 'openMarkdownForCheckboxLine'));
			return;
		}
		const line = editor.getLine(lineNumber);
		const parsed = this.parseInlineTaskLine(line, lineNumber, filePath);
		if (!parsed || parsed.operonId) {
			new Notice(t('notifications', 'currentLineNotPlainCheckbox'));
			return;
		}

		const now = localNow();
		const inherited = this.resolveInlineTaskInheritedFields(view.file ?? null);
		this.setParsedTaskField(parsed, 'operonId', generateOperonId(), 'text');
		this.normalizeParsedTaskCreatedTimestamp(parsed, now);
		this.applyInheritedSubtaskFields(parsed, inherited);
		this.touchParsedTaskModifiedTimestamp(parsed, now);
		const upgraded = this.serializeInlineTask(parsed);
		editor.setLine(lineNumber, upgraded);
		this.placeCursorAfterInlineTaskDescription(editor, filePath, lineNumber, upgraded);
		this.refreshMarkdownAfterInlineAuthoring(filePath);
		const upgradedParsed = this.parseInlineTaskLine(upgraded, lineNumber, filePath);
		if (!upgradedParsed) {
			new Notice(t('notifications', 'checkboxUpgradeFailed'));
			return;
		}
		this.showTaskNotice('inline-created', {
			description: upgradedParsed.description,
			operonId: upgradedParsed.operonId,
		});
	}

	private buildTaskFromSelection(
		editor: Editor,
		view: MarkdownView,
		selection: EditorSelection,
		inherited: SubtaskInitialFields,
		now: string,
	): { lineNumber: number; taskLine: string } | null {
		const from = selection.anchor.line < selection.head.line
			|| (selection.anchor.line === selection.head.line && selection.anchor.ch <= selection.head.ch)
			? selection.anchor
			: selection.head;
		const to = from === selection.anchor ? selection.head : selection.anchor;
		if (from.line !== to.line) {
			new Notice(t('notifications', 'singleLineFragmentOrCursor'));
			return null;
		}

		const selectedText = editor.getRange(from, to);
		if (!selectedText.trim()) return null;

		const lineText = editor.getLine(from.line);
		const indent = lineText.match(/^\s*/)?.[0] ?? '';
		const before = lineText.slice(0, from.ch);
		const after = lineText.slice(to.ch);
		const filePath = view.file?.path ?? '';
		const taskLine = `${indent}${this.buildNewInlineTaskWithInheritedFields(selectedText.trim(), 'open', inherited, now, filePath, from.line)}`;
		const replacementParts: string[] = [];
		if (before) replacementParts.push(before);
		replacementParts.push(taskLine);
		if (after) replacementParts.push(after);
		editor.replaceSelection(replacementParts.join('\n'));
		const taskLineNumber = from.line + (before ? 1 : 0);
		return { lineNumber: taskLineNumber, taskLine };
	}

	private normalizeEditorSelection(selection: EditorSelection): { from: EditorPosition; to: EditorPosition } {
		const from = selection.anchor.line < selection.head.line
			|| (selection.anchor.line === selection.head.line && selection.anchor.ch <= selection.head.ch)
			? selection.anchor
			: selection.head;
		const to = from === selection.anchor ? selection.head : selection.anchor;
		return { from, to };
	}

	private buildFileTaskWikilink(file: TFile): string {
		return `[[${this.escapeFileTaskWikilinkTarget(file.basename)}]]`;
	}

	private buildTaskWikilinkOverlayTarget(task: IndexedTask): string | null {
		const sourceFile = this.app.vault.getAbstractFileByPath(task.primary.filePath);
		if (!(sourceFile instanceof TFile)) return null;

		return buildTaskWikilinkOverlayLink(
			task,
			sourceFile.basename,
			target => this.escapeFileTaskWikilinkTarget(target),
		);
	}

	private escapeFileTaskWikilinkTarget(target: string): string {
		return target
			.replace(/%/gu, '%25')
			.replace(/\[/gu, '%5B')
			.replace(/\]/gu, '%5D')
			.replace(/#/gu, '%23')
			.replace(/\^/gu, '%5E');
	}

	private async loadEditableParsedTask(task: IndexedTask): Promise<ParsedTask> {
		if (task.primary.format !== 'inline') {
			return this.parsedTaskFromIndexed(task);
		}

		const file = this.app.vault.getAbstractFileByPath(task.primary.filePath);
		if (!(file instanceof TFile)) {
			return this.parsedTaskFromIndexed(task);
		}

		const content = await this.app.vault.cachedRead(file);
		const lines = content.split('\n');
		const hintedLine = task.primary.lineNumber;

		if (hintedLine >= 0 && hintedLine < lines.length) {
			const hinted = this.parseInlineTaskLine(lines[hintedLine], hintedLine, task.primary.filePath);
			if (hinted?.operonId === task.operonId) {
				return hinted;
			}
		}

		for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
			const parsed = this.parseInlineTaskLine(lines[lineNumber], lineNumber, task.primary.filePath);
			if (parsed?.operonId === task.operonId) {
				return parsed;
			}
		}

		return this.parsedTaskFromIndexed(task);
	}

	private parsedTaskFromIndexed(task: IndexedTask): ParsedTask {
		const fieldEntries = task.primary.format === 'yaml'
			? Object.entries(task.fieldValues).filter(([key]) => isManagedYamlCanonicalKey(key, this.settings.keyMappings))
			: Object.entries(task.fieldValues);
		const fields = fieldEntries
			.filter(([key]) => key !== 'pinned')
			.map(([key, value]) => ({
				sourceKey: this.getInlineWriteKeyName(key),
				key,
				value,
				rawValue: value,
				type: 'text' as const,
				isCanonical: true,
				containerRange: { from: 0, to: 0 },
				valueRange: { from: 0, to: 0 },
			}));

		return {
			lineNumber: task.primary.lineNumber,
			filePath: task.primary.filePath,
			checkbox: task.checkbox,
			checkboxRange: { from: 0, to: 0 },
			timePrefix: null,
			timePrefixRange: null,
			description: task.description,
			descriptionRange: { from: 0, to: 0 },
			tags: task.tags,
			tagTokens: [],
			fields,
			metadataTailRange: null,
			operonId: task.operonId,
			rawLine: '',
		};
	}

	private buildFilterModalEvalDeps(): FilterModalEvalDeps {
		return {
			indexer: this.indexer,
			getFilePropertySnapshot: tasks => this.getTableFilePropertySnapshot(tasks),
			getPipelines: () => this.settings.pipelines,
			getPriorities: () => this.settings.priorities ?? DEFAULT_PRIORITIES,
			openEditor: (operonId: string) => {
				void (async () => {
					const task = this.indexer.getTask(operonId);
					if (!task) return;
					const parsed = await this.loadEditableParsedTask(task);
					await this.openTaskEditorFor(parsed, async (request) => {
						const saved = await this.applyEditedTaskFromView(task, request);
						if (saved === false) {
							new Notice(t('notifications', 'taskSaveFailed'));
						}
						return saved;
					});
				})();
			},
			cycleStatus: (operonId: string) => {
				void this.cycleTaskStatusById(operonId);
			},
			getChildIds: (parentId: string) => [...this.indexer.secondary.getChildIds(parentId)],
			navigateToTask: (task: IndexedTask) => this.navigateToTask(task),
			getSettings: () => this.settings,
			updateField: (operonId: string, key: string, value: string) => (
				this.updateTaskFieldAndRefresh(operonId, key, value)
			),
			updateFields: (operonId: string, payload: Record<string, string>) => (
				this.updateTaskFieldsAndRefresh(operonId, payload)
			),
			updateSubtasks: (operonId: string, subtaskIds: string[]) => {
				void this.syncExistingSubtasksForParent(operonId, subtaskIds);
			},
			updateDependencyField: (operonId: string, field: 'blocking' | 'blockedBy', value: string) => {
				void this.updateTaskDependencyFieldAndRefresh(operonId, field, value);
			},
			onContextualAction: (taskId, actionId, context, invocation) => this.handleContextualMenuAction(taskId, actionId, context, invocation),
			pinnedCache: this.storage.pinned,
			isTaskTracking: (taskId: string) => this.timeTracker.isTimerRunning(taskId),
			toggleTimer: async (taskId: string) => {
				await this.toggleTimerForTask(taskId, 'command');
			},
			getTrackingSignature: () => this.timeTracker.getActiveOperonId() ?? '',
			getProjectSerialDisplay: (operonId: string) => this.getProjectSerialDisplayForTask(operonId),
			getProjectSerialSignature: () => this.getProjectSerialSignature(),
		};
	}

	private getTableFilePropertySnapshot(tasks: readonly IndexedTask[] = this.indexer.getAllTasks()) {
		return this.tableFilePropertyIndex?.getSnapshot(
			tasks,
			this.indexer.getGeneration(),
			{ keyMappings: this.settings.keyMappings },
		) ?? null;
	}

	private buildFilterSurfaceDeps(): EmbedFilterDeps {
		return {
				app: this.app,
				indexer: this.indexer,
				settings: this.settings,
				openTaskEditor: (operonId: string) => {
					void (async () => {
						const task = this.indexer.getTask(operonId);
						if (!task) return;
						const parsed = await this.loadEditableParsedTask(task);
						await this.openTaskEditorFor(parsed, async (request) => {
							const saved = await this.applyEditedTaskFromView(task, request);
							if (saved === false) {
								new Notice(t('notifications', 'taskSaveFailed'));
							}
							return saved;
						});
					})();
				},
					toggleCheckbox: (operonId: string) => { void this.toggleTaskById(operonId); },
					cycleStatus: (operonId: string) => { void this.cycleTaskStatusById(operonId); },
				getPipelines: () => this.settings.pipelines,
				getPriorities: () => this.settings.priorities ?? DEFAULT_PRIORITIES,
				saveSettings: () => this.storage.saveSettings(),
				getChildIds: (parentId: string) => [...this.indexer.secondary.getChildIds(parentId)],
					navigateToTask: (task: IndexedTask) => {
						if (task.primary.format === 'yaml') {
							runAsyncAction('embedded filter task file navigation failed', () => this.app.workspace.openLinkText(task.primary.filePath, '', false));
						} else {
							const leaf = this.app.workspace.getLeaf(false);
							const file = this.app.vault.getAbstractFileByPath(task.primary.filePath);
								if (!(file instanceof TFile)) return;
								runAsyncAction('embedded filter inline task navigation failed', async () => {
									await leaf.openFile(file);
									const editor = getCursorEditorFromView(leaf.view);
									if (editor) {
										editor.setCursor({ line: task.primary.lineNumber, ch: 0 });
									}
							});
						}
					},
				getSettings: () => this.settings,
				updateField: (operonId: string, key: string, value: string) => (
					this.updateTaskFieldAndRefresh(operonId, key, value)
				),
				updateFields: (operonId: string, payload: Record<string, string>) => (
					this.updateTaskFieldsAndRefresh(operonId, payload)
				),
				updateSubtasks: (operonId: string, subtaskIds: string[]) => {
					void this.syncExistingSubtasksForParent(operonId, subtaskIds);
				},
				updateDependencyField: (operonId: string, field: 'blocking' | 'blockedBy', value: string) => {
					void this.updateTaskDependencyFieldAndRefresh(operonId, field, value);
				},
				getRepeatSkipDates: (repeatSeriesId: string) => this.storage.repeatSeries.getSkipDates(repeatSeriesId),
				getRepeatSkipSignature: () => this.getRepeatSkipSignature(),
				getRepeatSeriesInlineCompletionMode: (repeatSeriesId: string) => this.getRepeatSeriesInlineCompletionMode(repeatSeriesId),
				updateRepeatSeriesInlineCompletionMode: (operonId: string, mode: InlineRepeatCompletionMode) => {
					void this.applyInlineRepeatCompletionModeIfRequested(this.indexer.getTask(operonId), mode);
				},
				requestSubtask: (operonId: string) => {
					void this.requestSubtaskForParentId(operonId);
				},
					onContextualAction: (
						taskId: string,
						actionId: ContextualMenuActionId,
						context?: ContextualMenuContext,
						invocation?: ContextualMenuActionInvocation,
					) => this.handleContextualMenuAction(taskId, actionId, context, invocation),
					pinnedCache: this.storage.pinned,
					isTaskTracking: (taskId: string) => this.timeTracker.isTimerRunning(taskId),
					toggleTimer: async (taskId: string) => {
						await this.toggleTimerForTask(taskId, 'command');
					},
				getTrackingSignature: () => this.timeTracker.getActiveOperonId() ?? '',
				getProjectSerialDisplay: (operonId: string) => this.getProjectSerialDisplayForTask(operonId),
				getProjectSerialSignature: () => this.getProjectSerialSignature(),
				saveFilterSet: (filterSet: FilterSet) => this.saveFilterSetAndRefresh(filterSet),
				openDailyNote: (dateKey: string) => this.openDailyNoteFromDateKey(dateKey),
				duplicateFilterSet: (filterSet: FilterSet) => this.duplicateFilterSetAndRefresh(filterSet),
				deleteFilterSet: (filterSetId: string) => this.deleteFilterSetAndRefresh(filterSetId),
				toggleFilterFavorite: (filterSetId: string) => this.togglePresetFavoriteAndRefresh('filter', filterSetId),
			};
	}

	/**
	 * Register the `operon` code block processor for embedded filter views.
	 */
	private registerEmbedFilterProcessor(): void {
		const deps = this.buildFilterSurfaceDeps();
		this.embedFilterDeps = deps;
		registerEmbedFilterProcessor(
			(lang, handler) => this.registerMarkdownCodeBlockProcessor(lang, handler),
			deps,
		);
	}

	/**
	 * Register the `operon-table` code block processor for embedded table views.
	 */
	private registerEmbedTableProcessor(): void {
		const deps = this.buildTableSurfaceDeps();
		this.embedTableDeps = deps;
		registerEmbedTableProcessor(
			(lang, handler) => this.registerMarkdownCodeBlockProcessor(lang, handler),
			deps,
		);
	}

	private buildTableSurfaceDeps(): EmbedTableDeps {
		return {
			app: this.app,
			indexer: this.indexer,
			getSettings: () => this.settings,
			resolveTablePreset: presetId => this.resolveTablePresetForSurface(presetId),
			getTablePresets: () => this.getTablePresetsForSurfaces(),
			getPinnedCache: () => this.pinnedCache,
			openTaskEditor: (operonId: string) => this.openEditorForId(operonId),
			openTaskSource: (operonId: string) => this.openMaterializedTaskSourceInNewTab(operonId),
			allowWrites: true,
			updateTaskFields: (operonId, payload) => this.updateTableTaskFieldsAndRefresh(operonId, payload),
			updateFileProperty: (operonId, request) => this.updateTableFilePropertyAndRefresh(operonId, request),
			getTaskSessions: (operonId) => this.timeTracker.getTaskSessions(operonId),
			addTaskSession: (operonId, start, end) => this.addTableTaskSessionAndRefresh(operonId, start, end),
			editTaskSession: (session, start, end) => this.editTableTaskSessionAndRefresh(session, start, end),
			deleteTaskSession: (session) => this.deleteTableTaskSessionAndRefresh(session),
			onStatusIconClick: (taskId) => this.handleCalendarStatusIconClick(taskId),
			onOpenCheckboxes: (taskId, actionAnchor, actionAnchorRect) => this.openCheckboxesForTaskId(taskId, actionAnchor, actionAnchorRect),
			onContextualAction: (taskId, actionId, context, invocation) => this.handleContextualMenuAction(taskId, actionId, context, invocation),
			onOpenPresetSettings: (presetId) => this.openTablePresetSettingsModal(presetId, () => this.resolveTablePresetSettingsLeafForEmbed()),
			onSavePresetPatch: (patch) => this.queueTablePresetPatchAndRefresh(
				patch,
				this.getTablePresetPatchScope(patch),
				'embed-table',
			).settled,
			onSaveFilterSet: (filterSet) => this.saveFilterSetAndRefresh(filterSet),
			onOpenRelatedView: (target) => this.openRelatedViewTarget(target),
			onCreateRelatedView: (target) => this.createRelatedViewPresetAndOpen(target),
			getProjectSerialDisplay: (operonId, task) => task
				? this.getReadingProjectSerialDisplayForTask(operonId, task)
				: this.getProjectSerialDisplayForTask(operonId),
			getProjectSerialSignature: () => this.getProjectSerialSignature(),
			isTaskPinned: (taskId) => this.pinnedCache?.isPinned(taskId) === true,
			hasSubtasks: (taskId) => this.indexer.secondary.getChildIds(taskId).size > 0,
		};
	}

	private resolveTablePresetSettingsLeafForEmbed(): WorkspaceLeaf {
		const activeTableView = this.app.workspace.getActiveViewOfType(OperonTableView);
		const activeTableLeaf = activeTableView
			? this.app.workspace.getLeavesOfType(OPERON_TABLE_VIEW_TYPE).find(leaf => leaf.view === activeTableView)
			: null;
		return activeTableLeaf ?? this.app.workspace.getLeaf(true);
	}

	private getMarkdownViewForEditorView(editorView: EditorView): MarkdownView | null {
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
				const view = leaf.view;
				if (!(view instanceof MarkdownView)) continue;
				if (getEditorViewFromEditor(view.editor) === editorView) return view;
			}
			return null;
		}

	private getMarkdownViewForPath(filePath: string): MarkdownView | null {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView?.file?.path === filePath) return activeView;

		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView)) continue;
			if (view.file?.path === filePath) return view;
		}
		return null;
	}

	private getFilePathForEditorView(editorView: EditorView): string {
		return this.getMarkdownViewForEditorView(editorView)?.file?.path
			?? getEmbeddedMarkdownSourceEditorFilePath(editorView);
	}

	private registerInlineTaskBar(): void {
		const ext = operonLivePreviewConcealExtension({
			app: this.app,
			getFilePath: (editorView: EditorView) => this.getFilePathForEditorView(editorView),
			// getIndexedTask
			getIndexedTask: (id: string) => this.indexer.getTask(id),
			getAllTasks: () => this.indexer.getAllTasks(),
			getProjectSerialDisplay: (operonId: string) => this.getProjectSerialDisplayForTask(operonId),
			// openEditor
			openEditor: (task: ParsedTask, editorView: EditorView) => {
				const view = this.getMarkdownViewForEditorView(editorView);
				const editor = view?.editor;
				const filePath = view?.file?.path ?? '';

				// Track subtask insert position across multiple auto-save calls
				let subtaskInsertedAt: number | null = null;

				const insertSubtaskAfterParent = async (parentTask: ParsedTask, taskLine: string): Promise<boolean> => {
					if (!parentTask.operonId) return false;

					const freshParent = this.indexer.getTask(parentTask.operonId);
					const parentPath = freshParent?.primary.filePath ?? parentTask.filePath;
					const parentLineHint = freshParent?.primary.lineNumber ?? parentTask.lineNumber;

					if (!parentPath) return false;
					const parentFile = this.app.vault.getAbstractFileByPath(parentPath);
					if (!(parentFile instanceof TFile)) return false;

					const content = await this.app.vault.cachedRead(parentFile);
					const lines = content.split('\n');
					let parentLine = -1;

					if (parentLineHint >= 0 && parentLineHint < lines.length) {
						const hinted = this.parseInlineTaskLine(lines[parentLineHint], parentLineHint, parentPath);
						if (hinted?.operonId === parentTask.operonId) parentLine = parentLineHint;
					}

					if (parentLine === -1) {
						for (let i = 0; i < lines.length; i++) {
							const parsed = this.parseInlineTaskLine(lines[i], i, parentPath);
							if (parsed?.operonId === parentTask.operonId) {
								parentLine = i;
								break;
							}
						}
					}

					if (parentLine === -1) return false;

					lines.splice(parentLine + 1, 0, taskLine);
					await this.app.vault.modify(parentFile, lines.join('\n'));
					this.indexer.scheduleReindex(parentPath);
					return true;
				};

				const resolveTaskPath = (): string => {
					if (!task.operonId) return task.filePath;
					return this.indexer.getTask(task.operonId)?.primary.filePath ?? task.filePath;
				};

					runAsyncAction('task row editor open failed', () => this.openTaskEditorFor(task, async (request) => {
					const { taskLine, isNew } = request;
					// New task created from "Add subtask" inside the editor.
					// Keep fast in-editor updates when editing the same file, otherwise
					// insert by parent operonId so cross-file subtask flows stay correct.
						if (isNew) {
							const taskPath = resolveTaskPath();
							if (editor && taskPath && filePath === taskPath) {
								if (subtaskInsertedAt === null) {
									const afterParent = { line: task.lineNumber + 1, ch: 0 };
								editor.replaceRange(taskLine + '\n', afterParent, afterParent);
								subtaskInsertedAt = task.lineNumber + 1;
								} else {
									editor.setLine(subtaskInsertedAt, taskLine);
								}
								this.placeCursorAfterInlineTaskDescription(editor, filePath, subtaskInsertedAt, taskLine);
								await this.persistInlineEditorBufferAndReindex(filePath);
								return true;
							}

						const inserted = await insertSubtaskAfterParent(task, taskLine);
						if (!inserted) new Notice(t('notifications', 'taskSaveFailed'));
						return;
					}

					const edited = this.parseInlineTaskLine(taskLine, task.lineNumber, task.filePath);
					const editedId = edited?.operonId ?? task.operonId;
					if (editedId) {
						const fresh = this.indexer.getTask(editedId);
						if (fresh) {
							const saved = await this.applyEditedTaskFromView(fresh, request);
							if (saved === false) new Notice(t('notifications', 'taskSaveFailed'));
							return saved;
						}
					}

					// Fallback: same-file direct line write for edge cases where the
					// index has not caught up yet.
					const taskPath = resolveTaskPath();
						if (editor && taskPath && filePath === taskPath) {
							editor.setLine(task.lineNumber, taskLine);
							this.placeCursorAfterInlineTaskDescription(editor, filePath, task.lineNumber, taskLine);
							await this.persistInlineEditorBufferAndReindex(filePath);
							return true;
						}
					}));
			},
			cycleStatus: (task: ParsedTask, _editorView: EditorView) => {
				if (!task.operonId) return;
				void this.cycleTaskStatusById(task.operonId);
			},
			// getPipelines
			getPipelines: () => this.settings.pipelines,
			// getPriorities
			getPriorities: () => this.settings.priorities ?? DEFAULT_PRIORITIES,
			getSettings: () => this.settings,
			getRepeatSeriesInlineCompletionMode: (repeatSeriesId: string) => this.getRepeatSeriesInlineCompletionMode(repeatSeriesId),
			updateRepeatSeriesInlineCompletionMode: (operonId: string, mode: InlineRepeatCompletionMode) => {
				void this.applyInlineRepeatCompletionModeIfRequested(this.indexer.getTask(operonId), mode);
			},
			getRepeatSkipDates: (repeatSeriesId: string) => this.storage.repeatSeries.getSkipDates(repeatSeriesId),
				updateField: (
					operonId: string,
					key: string,
					value: string,
					restoreCursor?: { filePath: string; lineNumber: number; ch: number; editorView?: EditorView; trackDescriptionEnd?: boolean },
				) => {
						return (async () => {
							let wrote = await this.updateTaskFieldAndRefresh(operonId, key, value);
							if (!wrote && restoreCursor && !this.shouldSuppressLivePreviewFallbackAfterBlockedStatus(operonId)) {
								wrote = await this.updateLivePreviewInlineFieldsFallback(operonId, { [key]: value }, restoreCursor);
							}
						if (restoreCursor && wrote) {
							this.restoreLivePreviewAuthoringCursor(
							restoreCursor.filePath,
							{ line: restoreCursor.lineNumber, ch: restoreCursor.ch },
								true,
								true,
								restoreCursor.editorView,
									restoreCursor.trackDescriptionEnd === true,
								);
							}
							return wrote;
						})();
				},
				onContextualAction: (taskId, actionId, context, invocation) => this.handleContextualMenuAction(taskId, actionId, context, invocation),
				isTaskPinned: (taskId) => this.pinnedCache?.isPinned(taskId) === true,
				hasSubtasks: (taskId) => this.indexer.secondary.getChildIds(taskId).size > 0,
				isTaskTracking: (taskId) => this.timeTracker.isTimerRunning(taskId),
				toggleTimer: async (taskId) => {
					await this.toggleTimerForTask(taskId, 'command');
				},
				requestSubtask: (operonId) => {
					void this.requestSubtaskForParentId(operonId);
				},
				updateFields: (
					operonId: string,
					payload: Record<string, string>,
					restoreCursor?: { filePath: string; lineNumber: number; ch: number; editorView?: EditorView; trackDescriptionEnd?: boolean },
				) => {
						return (async () => {
							let wrote = await this.updateTaskFieldsAndRefresh(operonId, payload);
							if (!wrote && restoreCursor && !this.shouldSuppressLivePreviewFallbackAfterBlockedStatus(operonId)) {
								wrote = await this.updateLivePreviewInlineFieldsFallback(operonId, payload, restoreCursor);
							}
						if (restoreCursor && wrote) {
							this.restoreLivePreviewAuthoringCursor(
							restoreCursor.filePath,
							{ line: restoreCursor.lineNumber, ch: restoreCursor.ch },
								true,
								true,
								restoreCursor.editorView,
									restoreCursor.trackDescriptionEnd === true,
								);
							}
							return wrote;
						})();
				},
			updateSubtasks: (operonId: string, subtaskIds: string[]) => {
				void this.syncExistingSubtasksForParent(operonId, subtaskIds);
			},
			updateDependencyField: (operonId: string, field: 'blocking' | 'blockedBy', value: string) => {
				void this.updateTaskDependencyFieldAndRefresh(operonId, field, value);
			},
		});

		this.registerEditorExtension(ext);
			this.registerEditorExtension(operonLivePreviewClassicTaskConvertExtension({
				getFilePath: (editorView: EditorView) => this.getFilePathForEditorView(editorView),
				getSettings: () => this.settings,
				convertTasksEmojiLine: (lineNumber: number, editorView: EditorView) => {
					const view = this.getMarkdownViewForEditorView(editorView);
					if (!view) return;
					runAsyncAction('convert tasks emoji line from live preview failed', () => this.handleConvertTasksEmojiLineToOperonInlineTaskCommand(view.editor, view, lineNumber));
				},
				upgradePlainCheckboxLine: (lineNumber: number, editorView: EditorView) => {
					const view = this.getMarkdownViewForEditorView(editorView);
					if (!view) return;
					this.upgradePlainCheckboxLineToOperonInlineTask(view.editor, view, lineNumber);
			},
		}));
		this.registerEditorExtension(operonLivePreviewTaskWikilinkOverlayExtension({
			app: this.app,
			getFilePath: (editorView: EditorView) => this.getFilePathForEditorView(editorView),
			getSettings: () => this.settings,
			getPipelines: () => this.settings.pipelines,
			getAllTasks: () => this.indexer.getAllTasks(),
			getFileTaskByPath: (filePath: string) => this.indexer.getFileTaskByPath(filePath),
			hasDuplicateOperonIdConflict: (operonId: string) => this.indexer.hasDuplicateOperonIdConflict(operonId),
			getDescendantTaskSummary: (operonId: string) => this.indexer.getDescendantTaskSummary(operonId),
			getProjectSerialDisplay: (operonId: string) => this.getProjectSerialDisplayForTask(operonId),
			openTaskEditor: (operonId: string) => this.openEditorForId(operonId),
			cycleStatus: (operonId: string) => { void this.cycleTaskStatusById(operonId); },
				onContextualAction: (taskId, actionId, context, invocation) => this.handleContextualMenuAction(taskId, actionId, context, invocation),
				isTaskPinned: (taskId) => this.pinnedCache?.isPinned(taskId) === true,
				hasSubtasks: (taskId) => this.indexer.secondary.getChildIds(taskId).size > 0,
				isTaskTracking: (taskId) => this.timeTracker.isTimerRunning(taskId),
				toggleTimer: async (taskId) => {
					await this.toggleTimerForTask(taskId, 'command');
				},
				requestSubtask: (operonId) => {
					void this.requestSubtaskForParentId(operonId);
				},
				getRepeatSkipDates: (repeatSeriesId: string) => this.storage.repeatSeries.getSkipDates(repeatSeriesId),
			}));
			this.registerEditorExtension(operonDynamicFileTaskFilterLivePreviewExtension({
				getFilePath: (editorView: EditorView) => this.getFilePathForEditorView(editorView),
				getFilterDeps: () => {
					if (!this.embedFilterDeps) this.embedFilterDeps = this.buildFilterSurfaceDeps();
					return this.embedFilterDeps;
				},
				openDynamicFilterSettings: (template) => this.openDynamicFileTaskFilterSettings(template),
			}));
			this.registerEditorSuggest(operonLivePreviewKeySuggestExtension(this.app, {
				getSettings: () => this.settings,
				beginSession: (input) => {
					const session = this.livePreviewEphemeralSession.begin(input);
					this.livePreviewPendingPickerSessionId = session.id;
					this.livePreviewPendingPickerUntil = Date.now() + 300;
					return session.id;
				},
				removeTriggerToken: (editor, start, end) => this.removeLivePreviewSessionTrigger(editor, start, end),
				openInsertedField: (canonicalKey: string, sessionId?: string) => {
					this.openLivePreviewInsertedFieldPicker(canonicalKey, sessionId);
				},
		}));
	}

	/**
	 * Register a Reading mode post-processor that renders compact Operon rows.
	 * Reading View uses the same native/concealed product language as Live Preview,
	 * but renders from markdown preview DOM instead of CM6 decorations.
	 */
		private registerReadingModeProcessor(): void {
			this.registerMarkdownPostProcessor((el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
				if (this.isRenderedCodeElement(el)) return;
				const rootSectionInfo = ctx.getSectionInfo(el);
				if (rootSectionInfo && this.isFencedMarkdownSection(rootSectionInfo)) return;
				ctx.addChild(new class extends MarkdownRenderChild {
					onunload(): void {
						cleanupOperonRenderRoot(el);
					}
				}(el));

			const linkOverlayCallbacks = {
				app: this.app,
				getSettings: () => this.settings,
				getPipelines: () => this.settings.pipelines,
				getAllTasks: () => this.indexer.getAllTasks(),
				getFileTaskByPath: (filePath: string) => this.indexer.getFileTaskByPath(filePath),
				hasDuplicateOperonIdConflict: (operonId: string) => this.indexer.hasDuplicateOperonIdConflict(operonId),
				getDescendantTaskSummary: (operonId: string) => this.indexer.getDescendantTaskSummary(operonId),
				getProjectSerialDisplay: (operonId: string, task?: IndexedTask) => this.getReadingProjectSerialDisplayForTask(operonId, task),
				openTaskEditor: (operonId: string) => this.openEditorForId(operonId),
				cycleStatus: (operonId: string) => { void this.cycleTaskStatusById(operonId); },
				onContextualAction: (
					taskId: string,
					actionId: ContextualMenuActionId,
					context?: ContextualMenuContext,
					invocation?: ContextualMenuActionInvocation,
				) => this.handleContextualMenuAction(taskId, actionId, context, invocation),
				isTaskPinned: (taskId: string) => this.pinnedCache?.isPinned(taskId) === true,
				hasSubtasks: (taskId: string) => this.indexer.secondary.getChildIds(taskId).size > 0,
				isTaskTracking: (taskId: string) => this.timeTracker.isTimerRunning(taskId),
				toggleTimer: async (taskId: string) => {
					await this.toggleTimerForTask(taskId, 'command');
				},
				requestSubtask: (operonId: string) => {
					void this.requestSubtaskForParentId(operonId);
				},
				getRepeatSkipDates: (repeatSeriesId: string) => this.storage.repeatSeries.getSkipDates(repeatSeriesId),
			};
			const workflowStatusIdentityIndex = buildWorkflowStatusIdentityIndex(this.settings.pipelines);
			const listItems = el.querySelectorAll<HTMLElement>('li.task-list-item');
			const sectionTaskResolutions = new Map<string, ReadingSectionInlineTaskResolution>();
			const sectionCursors = new Map<string, number>();

			for (const li of Array.from(listItems)) {
				if (this.isRenderedCodeElement(li)) continue;

				const sectionInfo = ctx.getSectionInfo(li);
				if (sectionInfo && this.isFencedMarkdownSection(sectionInfo)) continue;

					let resolvedTask: ReadingResolvedTask | null = null;
					let resolvedBy: 'source-line' | 'rendered-id' | 'section-cursor' | null = null;
					let sectionResolved: ReadingResolvedTask | null = null;
					let sourceLineMatchedTask = false;
					if (sectionInfo) {
						const sectionKey = `${sectionInfo.lineStart}:${sectionInfo.lineEnd}`;
						let sectionResolution = sectionTaskResolutions.get(sectionKey);
						if (!sectionResolution) {
							sectionResolution = this.resolveReadingViewSectionTasks(sectionInfo, ctx.sourcePath);
							sectionTaskResolutions.set(sectionKey, sectionResolution);
							sectionCursors.set(sectionKey, 0);
							if (sectionResolution.needsReindex) {
								this.indexer.scheduleReindex(ctx.sourcePath);
							}
						}

						const cursor = sectionCursors.get(sectionKey) ?? 0;
						sectionResolved = sectionResolution.orderedTasks[cursor] ?? null;
						sectionCursors.set(sectionKey, cursor + 1);

						const sourceLine = this.getReadingListItemSourceLine(li, sectionInfo);
						if (sourceLine !== null && sectionResolution.lineTasks.has(sourceLine)) {
							sourceLineMatchedTask = true;
							resolvedTask = sectionResolution.lineTasks.get(sourceLine) ?? null;
							resolvedBy = resolvedTask ? 'source-line' : null;
						}
					}

					if (!resolvedTask && !sourceLineMatchedTask) {
						const renderedIndexed = resolveReadingInlineTaskFromText(
							this.getReadingListItemOwnText(li),
							ctx.sourcePath,
							operonId => this.indexer.getTask(operonId),
							this.settings.keyMappings,
						);
						if (renderedIndexed) {
							if (!this.indexer.hasDuplicateOperonIdConflict(renderedIndexed.operonId)) {
								resolvedTask = createIndexedReadingResolvedTask(renderedIndexed);
								resolvedBy = 'rendered-id';
							}
						}
					}

					if (!resolvedTask && !sourceLineMatchedTask) {
						resolvedTask = sectionResolved;
						if (resolvedTask) resolvedBy = 'section-cursor';
					}
					if (!resolvedTask) continue;
					const indexed = resolvedTask.task;
					if (resolvedBy === 'section-cursor' && !this.readingListItemMatchesTask(li, indexed)) continue;

					const callbacks = {
					app: this.app,
					getPipelines: () => this.settings.pipelines,
					getPriorities: () => this.settings.priorities ?? DEFAULT_PRIORITIES,
					getSettings: () => this.settings,
					getAllTasks: () => this.indexer.getAllTasks(),
					getProjectSerialDisplay: (operonId: string, task?: IndexedTask) => this.getReadingProjectSerialDisplayForTask(operonId, task),
					openEditor: (operonId: string) => {
						void (async () => {
							const task = this.indexer.getTask(operonId);
							if (!task) return;
							const pt = await this.loadEditableParsedTask(task);
							await this.openTaskEditorFor(pt, async (request) => {
								const { taskLine, isNew } = request;
								const editedId = this.parseInlineTaskLine(taskLine, 0, '')?.operonId ?? operonId;
								if (isNew && editedId) {
									// New subtask: insert after parent in the file
									const parent = this.indexer.getTask(operonId);
									if (!parent) return;
									const parentPath = parent.primary.filePath;
									const parentFile = this.app.vault.getAbstractFileByPath(parentPath);
									if (!(parentFile instanceof TFile)) return;
									const content = await this.app.vault.cachedRead(parentFile);
									const lines = content.split('\n');
									lines.splice(parent.primary.lineNumber + 1, 0, taskLine);
									await this.app.vault.modify(parentFile, lines.join('\n'));
									this.indexer.scheduleReindex(parentPath);
									return;
								}
								if (editedId) {
									const fresh = this.indexer.getTask(editedId);
									if (fresh) {
										const saved = await this.applyEditedTaskFromView(fresh, request);
										if (saved === false) new Notice(t('notifications', 'taskSaveFailed'));
										return saved;
									}
								}
							});
						})();
					},
					cycleStatus: (operonId: string) => {
						void this.cycleTaskStatusById(operonId);
					},
					navigateToTask: (task: IndexedTask) => {
							if (task.primary.format === 'yaml') {
								runAsyncAction('filter task file navigation failed', () => this.app.workspace.openLinkText(task.primary.filePath, '', false));
							} else {
								const leaf = this.app.workspace.getLeaf(false);
								const file = this.app.vault.getAbstractFileByPath(task.primary.filePath);
								if (!(file instanceof TFile)) return;
									runAsyncAction('filter inline task navigation failed', async () => {
										await leaf.openFile(file);
									const editor = getCursorEditorFromView(leaf.view);
									if (editor) {
										editor.setCursor({ line: task.primary.lineNumber, ch: 0 });
										editor.scrollIntoView?.({ from: { line: task.primary.lineNumber, ch: 0 }, to: { line: task.primary.lineNumber, ch: 0 } }, true);
									}
									});
							}
					},
							updateField: (operonId: string, key: string, value: string) => (
								this.updateTaskFieldAndRefresh(operonId, key, value)
							),
					onContextualAction: (
						taskId: string,
						actionId: ContextualMenuActionId,
						context?: ContextualMenuContext,
						invocation?: ContextualMenuActionInvocation,
					) => this.handleContextualMenuAction(taskId, actionId, context, invocation),
					isTaskPinned: (taskId: string) => this.pinnedCache?.isPinned(taskId) === true,
					isTaskTracking: (taskId: string) => this.timeTracker.isTimerRunning(taskId),
					toggleTimer: async (taskId: string) => {
						await this.toggleTimerForTask(taskId, 'command');
					},
					requestSubtask: (operonId: string) => {
						void this.requestSubtaskForParentId(operonId);
					},
						updateFields: async (operonId: string, payload: Record<string, string>) => {
							await this.updateTaskFieldsAndRefresh(operonId, payload);
						},
					updateSubtasks: (operonId: string, subtaskIds: string[]) => {
						void this.syncExistingSubtasksForParent(operonId, subtaskIds);
					},
					updateDependencyField: (operonId: string, field: 'blocking' | 'blockedBy', value: string) => {
						void this.updateTaskDependencyFieldAndRefresh(operonId, field, value);
					},
					getRepeatSeriesInlineCompletionMode: (repeatSeriesId: string) => this.getRepeatSeriesInlineCompletionMode(repeatSeriesId),
					updateRepeatSeriesInlineCompletionMode: (operonId: string, mode: InlineRepeatCompletionMode) => {
						void this.applyInlineRepeatCompletionModeIfRequested(this.indexer.getTask(operonId), mode);
					},
					getRepeatSkipDates: (repeatSeriesId: string) => this.storage.repeatSeries.getSkipDates(repeatSeriesId),
				};

					const nestedLists = Array.from(li.children).filter((child): child is HTMLElement =>
						asHTMLElement(child) !== null && (child.tagName === 'UL' || child.tagName === 'OL')
					);
						for (const nested of nestedLists) {
							nested.remove();
						}
							const renderedDescription = createDiv({ cls: 'operon-reading-task-description-content' });
							const renderChild = new class extends MarkdownRenderChild {
								private unloaded = false;

								onunload(): void {
									this.unloaded = true;
									cleanupOperonRenderRoot(renderedDescription);
								}

								isUnloaded(): boolean {
									return this.unloaded;
								}
							}(renderedDescription);
							ctx.addChild(renderChild);
							void MarkdownRenderer.render(
							this.app,
							indexed.description || '(untitled)',
							renderedDescription,
								ctx.sourcePath,
								renderChild,
							).then(() => {
								if (renderChild.isUnloaded() || !renderedDescription.isConnected) {
									cleanupOperonRenderRoot(renderedDescription);
									return;
								}
								enhanceReadingTaskFileWikilinks(renderedDescription, ctx.sourcePath, linkOverlayCallbacks, {
									sourceText: indexed.description || '(untitled)',
								});
						});

							// Replace the task item content while preserving any nested lists.
							li.empty();
							li.addClass('operon-rendered-inline-task-list-item');
							li.appendChild(buildReadingTaskRowElement(indexed, callbacks, renderedDescription, {
								readOnly: resolvedTask.readOnly,
								projectSerialPlacement: 'tail',
								workflowStatusIdentityIndex,
							}));
						for (const nested of nestedLists) {
							li.appendChild(nested);
						}
			}

			enhanceReadingTaskFileWikilinks(el, ctx.sourcePath, linkOverlayCallbacks, {
				sourceText: rootSectionInfo?.text ?? '',
			});
			applyFileTaskPropertyVisibility(el, this.indexer.getFileTaskByPath(ctx.sourcePath) ?? null, this.settings.keyMappings);
			this.scheduleDynamicFileTaskFilterReadingMount(ctx.sourcePath);
		});
	}

	private scheduleDynamicFileTaskFilterReadingMount(filePath: string): void {
		if (!filePath) return;
		const existing = this.dynamicFileTaskFilterReadingTimers.get(filePath);
		if (existing) clearWindowTimeout(existing);
		const timer = setWindowTimeout(() => {
			this.dynamicFileTaskFilterReadingTimers.delete(filePath);
			this.refreshDynamicFileTaskFilterReadingMount(filePath);
		}, 0);
		this.dynamicFileTaskFilterReadingTimers.set(filePath, timer);
	}

	private clearDynamicFileTaskFilterReadingTimers(): void {
		for (const timer of this.dynamicFileTaskFilterReadingTimers.values()) {
			clearWindowTimeout(timer);
		}
		this.dynamicFileTaskFilterReadingTimers.clear();
	}

	private removeAllDynamicFileTaskFilterReadingHosts(): void {
		for (const host of Array.from(this.dynamicFileTaskFilterReadingHosts)) {
			this.destroyDynamicFileTaskFilterReadingHost(host);
		}
	}

	private pruneDisconnectedDynamicFileTaskFilterReadingHosts(): void {
		for (const host of Array.from(this.dynamicFileTaskFilterReadingHosts)) {
			if (!host.isConnected) {
				this.destroyDynamicFileTaskFilterReadingHost(host);
			}
		}
	}

	private refreshDynamicFileTaskFilterReadingMount(filePath: string): void {
		this.pruneDisconnectedDynamicFileTaskFilterReadingHosts();
		const deps = this.embedFilterDeps ?? this.buildFilterSurfaceDeps();
		if (!this.embedFilterDeps) this.embedFilterDeps = deps;
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView) || view.file?.path !== filePath || view.getMode() !== 'preview') continue;
			const root = this.getReadingPreviewContentRoot(view);
			if (!root) continue;
			this.removeDynamicFileTaskFilterHosts(root);
			const host = root.ownerDocument.win.createDiv();
			host.className = `${DYNAMIC_FILE_TASK_FILTER_HOST_CLASS} ${DYNAMIC_FILE_TASK_FILTER_HOST_CLASS}--reading`;
			this.insertDynamicFileTaskFilterReadingHost(root, host);
			const instance = createFilterSurfaceInstance(host);
			this.dynamicFileTaskFilterReadingHosts.add(host);
			this.dynamicFileTaskFilterReadingInstances.set(host, instance);
			const rendered = renderDynamicFileTaskFilterSurface(
				instance,
				filePath,
				deps,
				(template) => this.openDynamicFileTaskFilterSettings(template),
			);
			if (!rendered) {
				this.removeDynamicFileTaskFilterHosts(root);
			}
		}
	}

	private getReadingPreviewContentRoot(view: MarkdownView): HTMLElement | null {
		const previewMode = view.previewMode as unknown as { containerEl?: HTMLElement } | undefined;
		const container = previewMode?.containerEl ?? view.containerEl;
		return container.querySelector<HTMLElement>('.markdown-preview-sizer')
			?? container.querySelector<HTMLElement>('.markdown-preview-view')
			?? container;
	}

	private removeDynamicFileTaskFilterHosts(root: HTMLElement): void {
		for (const host of Array.from(root.querySelectorAll<HTMLElement>(`.${DYNAMIC_FILE_TASK_FILTER_HOST_CLASS}`))) {
			this.destroyDynamicFileTaskFilterReadingHost(host);
		}
	}

		private destroyDynamicFileTaskFilterReadingHost(host: HTMLElement): void {
			const instance = this.dynamicFileTaskFilterReadingInstances.get(host);
			if (instance) {
				destroyFilterSurfaceInstance(instance);
			} else {
				cleanupOperonRenderRoot(host);
			}
			this.dynamicFileTaskFilterReadingInstances.delete(host);
			this.dynamicFileTaskFilterReadingHosts.delete(host);
			host.remove();
	}

	private insertDynamicFileTaskFilterReadingHost(root: HTMLElement, host: HTMLElement): void {
		const placement = this.settings.dynamicFileTaskFilterPlacement;
		applyDynamicFileTaskFilterHostPlacement(host, placement);
		if (placement === 'body-bottom') {
			root.insertBefore(host, root.querySelector<HTMLElement>('.markdown-preview-pusher'));
			return;
		}
		const metadataContainer = root.querySelector<HTMLElement>('.metadata-container, .frontmatter-container');
		if (metadataContainer?.parentElement) {
			metadataContainer.parentElement.insertBefore(host, metadataContainer.nextSibling);
			return;
		}
		const firstBodyChild = Array.from(root.children).find((child): child is HTMLElement => {
			const element = asHTMLElement(child);
			if (!element) return false;
			if (element.hasClass(DYNAMIC_FILE_TASK_FILTER_HOST_CLASS)) return false;
			if (element.hasClass('metadata-container') || element.hasClass('frontmatter-container')) return false;
			if (element.querySelector('.metadata-container, .frontmatter-container')) return false;
			if (element.hasClass('markdown-preview-pusher')) return false;
			return true;
		});
		root.insertBefore(host, firstBodyChild ?? root.querySelector<HTMLElement>('.markdown-preview-pusher'));
	}

	private getTaskEditorSubtaskOptions(task: ParsedTask | null): Partial<TaskEditorContentOptions> {
		if (!task?.operonId) return {};

		const indexed = this.indexer.getTask(task.operonId);
		const kind = resolveSubtaskActionKind(indexed);

		return {
			subtaskActionKind: kind,
			onRequestSubtask: async (request) => {
				await this.handleSubtaskRequest(request, task);
			},
				onOpenTask: (operonId: string) => {
					this.openEditorForId(operonId);
				},
				onMarkSubtaskDone: (operonId: string) => this.markTaskDoneById(operonId),
				onUpdateExistingSubtaskParent: async (childId: string, parentId: string | null) => {
				await this.writeParentToExistingChildTask(childId, parentId);
			},
		};
	}

	private async requestSubtaskForParentId(operonId: string): Promise<void> {
		if (this.redirectDuplicateOperonIdAction(operonId)) return;
		const indexed = this.indexer.getTask(operonId);
		if (!indexed) {
			new Notice(t('notifications', 'taskSaveFailed'));
			return;
		}

		try {
			const parentTask = await this.loadEditableParsedTask(indexed);
			const parsedFieldValues = Object.fromEntries(parentTask.fields.map(field => [field.key, field.value]));
			await this.handleSubtaskRequest({
				parentOperonId: operonId,
				parentDescription: parentTask.description,
				parentFieldValues: {
					...indexed.fieldValues,
					...parsedFieldValues,
				},
				parentTags: [...parentTask.tags],
			}, parentTask);
		} catch (error) {
			console.error('Operon: failed to request subtask from quick action', error);
			new Notice(t('notifications', 'taskSaveFailed'));
		}
	}

	private async handleSubtaskRequest(
		request: TaskEditorSubtaskRequest,
		parentTask: ParsedTask,
	): Promise<void> {
		const indexed = this.indexer.getTask(request.parentOperonId);
		await dispatchSubtaskActionByParentKind(indexed, {
			file: () => {
				this.openFileSubtaskCreatorFromParent(request, parentTask);
			},
			inline: async () => {
				this.openInlineSubtaskCreatorFromParent(request, parentTask);
			},
		});
	}

	private registerWorkspaceTweakWatchers(): void {
		this.registerEvent(
			this.app.workspace.on('file-open', () => {
				this.scheduleWorkspacePropertiesCollapseForActiveView();
			}),
		);

		this.registerEvent(
			this.app.workspace.on('active-leaf-change', leaf => {
				if (!(leaf?.view instanceof MarkdownView)) return;
				this.scheduleWorkspacePropertiesCollapseForView(leaf.view);
			}),
		);

		this.app.workspace.onLayoutReady(() => {
			this.applyWorkspaceTweaks();
			this.scheduleWorkspacePropertiesCollapseForAllViews();
		});
	}

	private applyWorkspaceTweaks(): void {
		for (const doc of this.getWorkspaceTweakDocuments()) {
			this.workspaceTweakBodyDocuments.add(doc);
			doc.body.classList.toggle(WORKSPACE_TWEAK_HIDE_SCROLLBARS_CLASS, this.settings.workspaceTweaksHideScrollbars);
			doc.body.classList.toggle(WORKSPACE_TWEAK_PROPERTIES_COLLAPSER_CLASS, this.settings.workspaceTweaksCollapseProperties);
			doc.body.classList.toggle(
				WORKSPACE_TWEAK_COMPACT_SIDEBAR_TAB_ICONS_CLASS,
				this.settings.workspaceTweaksCompactSidebarTabIcons,
			);
		}
		if (!this.settings.workspaceTweaksCollapseProperties) {
			this.clearWorkspaceTweakPropertiesCollapseTimers();
			this.clearWorkspaceTweakPropertiesCollapserTargetClasses();
		}
	}

	private removeWorkspaceTweakBodyClasses(): void {
		for (const doc of this.getWorkspaceTweakDocuments()) {
			this.workspaceTweakBodyDocuments.add(doc);
		}
		for (const doc of this.workspaceTweakBodyDocuments) {
			doc.body?.classList.remove(
				WORKSPACE_TWEAK_HIDE_SCROLLBARS_CLASS,
				WORKSPACE_TWEAK_PROPERTIES_COLLAPSER_CLASS,
				WORKSPACE_TWEAK_COMPACT_SIDEBAR_TAB_ICONS_CLASS,
			);
		}
		this.workspaceTweakBodyDocuments.clear();
	}

	private getWorkspaceTweakDocuments(): Document[] {
		const docs = new Set<Document>();
		docs.add(getActiveDocument());
		const workspaceContainer = (this.app.workspace as { containerEl?: HTMLElement }).containerEl;
		if (workspaceContainer?.ownerDocument) {
			docs.add(workspaceContainer.ownerDocument);
		}
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			if (leaf.view instanceof MarkdownView) {
				docs.add(leaf.view.containerEl.ownerDocument);
			}
		}
		return Array.from(docs).filter(doc => !!doc.body);
	}

	private clearWorkspaceTweakPropertiesCollapserTargetClasses(): void {
		for (const el of this.workspaceTweakPropertiesTargetEls) {
			el.classList.remove(WORKSPACE_TWEAK_PROPERTIES_COLLAPSER_TARGET_CLASS);
		}
		this.workspaceTweakPropertiesTargetEls.clear();
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			if (leaf.view instanceof MarkdownView) {
				leaf.view.containerEl.classList.remove(WORKSPACE_TWEAK_PROPERTIES_COLLAPSER_TARGET_CLASS);
			}
		}
	}

	private clearWorkspaceTweakPropertiesCollapseTimers(): void {
		for (const timer of this.workspaceTweakPropertiesCollapseTimers) {
			clearWindowTimeout(timer);
		}
		this.workspaceTweakPropertiesCollapseTimers = [];
	}

	private scheduleWorkspacePropertiesCollapseForActiveView(): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (view) this.scheduleWorkspacePropertiesCollapseForView(view);
	}

	private scheduleWorkspacePropertiesCollapseForAllViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			if (leaf.view instanceof MarkdownView) {
				this.scheduleWorkspacePropertiesCollapseForView(leaf.view);
			}
		}
	}

	private scheduleWorkspacePropertiesCollapseForView(view: MarkdownView): void {
		if (!this.syncWorkspacePropertiesCollapserTargetClassForView(view)) return;
		const cycle: WorkspaceTweakPropertiesCollapseCycle = {
			id: ++this.workspaceTweakPropertiesCollapseCycleId,
			attempted: false,
		};
		this.workspaceTweakPropertiesCollapseCycles.set(view, cycle);
		const win = view.containerEl.ownerDocument.defaultView ?? getActiveWindow();
		for (const delayMs of WORKSPACE_TWEAK_PROPERTIES_COLLAPSE_RETRY_DELAYS_MS) {
			const timer: WindowTimeoutHandle = {
				win,
				id: win.setTimeout(() => {
					this.workspaceTweakPropertiesCollapseTimers = this.workspaceTweakPropertiesCollapseTimers
						.filter(candidate => candidate !== timer);
					this.collapseWorkspacePropertiesForCycle(view, cycle);
				}, delayMs),
			};
			this.workspaceTweakPropertiesCollapseTimers.push(timer);
		}
	}

	private collapseWorkspacePropertiesForCycle(
		view: MarkdownView,
		cycle: WorkspaceTweakPropertiesCollapseCycle,
	): void {
		if (!this.settings.workspaceTweaksCollapseProperties) return;
		if (cycle.attempted || this.workspaceTweakPropertiesCollapseCycles.get(view) !== cycle) return;
		if (!this.syncWorkspacePropertiesCollapserTargetClassForView(view)) return;
		const metadataContainer = this.findWorkspacePropertiesMetadataContainer(view);
		if (!metadataContainer) return;
		const heading = metadataContainer.querySelector<HTMLElement>('.metadata-properties-heading');
		if (!heading) return;
		cycle.attempted = true;
		if (this.isWorkspacePropertiesCollapsed(metadataContainer, heading)) return;
		const target = heading.querySelector<HTMLElement>('.collapse-indicator')
			?? heading.querySelector<HTMLElement>('.metadata-properties-title')
			?? heading;
		target.click();
	}

	private syncWorkspacePropertiesCollapserTargetClassForView(view: MarkdownView): boolean {
		const shouldMark = this.settings.workspaceTweaksCollapseProperties
			&& this.shouldCollapseWorkspacePropertiesForView(view);
		view.containerEl.classList.toggle(WORKSPACE_TWEAK_PROPERTIES_COLLAPSER_TARGET_CLASS, shouldMark);
		if (shouldMark) {
			this.workspaceTweakPropertiesTargetEls.add(view.containerEl);
		} else {
			this.workspaceTweakPropertiesTargetEls.delete(view.containerEl);
		}
		return shouldMark;
	}

	private shouldCollapseWorkspacePropertiesForView(view: MarkdownView): boolean {
		const file = view.file;
		if (!(file instanceof TFile) || file.extension !== 'md') return false;
		if (this.isWorkspaceTweaksPropertiesExcluded(file.path)) return false;
		if (this.settings.workspaceTweaksPropertiesScope === 'all-notes') return true;
		return !!this.indexer.getFileTaskByPath(file.path);
	}

	private isWorkspaceTweaksPropertiesExcluded(filePath: string): boolean {
		const normalizedFilePath = this.normalizeWorkspaceTweakPath(filePath);
		if (!normalizedFilePath) return false;
		for (const folder of this.settings.workspaceTweaksPropertiesExcludedFolders) {
			const normalizedFolder = this.normalizeWorkspaceTweakPath(folder);
			if (!normalizedFolder) continue;
			if (normalizedFilePath === normalizedFolder || normalizedFilePath.startsWith(`${normalizedFolder}/`)) {
				return true;
			}
		}
		return false;
	}

	private findWorkspacePropertiesMetadataContainer(view: MarkdownView): HTMLElement | null {
		return view.containerEl.querySelector<HTMLElement>(
			'.markdown-source-view .metadata-container, .markdown-preview-view .metadata-container, .metadata-container',
		);
	}

	private isWorkspacePropertiesCollapsed(metadataContainer: HTMLElement, heading: HTMLElement): boolean {
		return metadataContainer.classList.contains('is-collapsed') || heading.classList.contains('is-collapsed');
	}

	private normalizeWorkspaceTweakPath(path: string): string {
		return path.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
	}

	private registerYamlPropertyVisibilityWatchers(): void {
		this.registerEvent(
			this.app.workspace.on('file-open', () => {
				this.scheduleYamlPropertyVisibilityRefresh(120);
			}),
		);

		this.registerEvent(
			this.app.workspace.on('active-leaf-change', leaf => {
				void this.refreshTableFilePropertyTypes();
				if (!(leaf?.view instanceof MarkdownView)) return;
				this.scheduleYamlPropertyVisibilityRefresh(120);
			}),
		);

		this.registerEvent(
			this.app.metadataCache.on('changed', file => {
				if (file.extension !== 'md') return;
				invalidateCustomFieldValueCandidateCache(this.app);
				invalidateLocationPlaceIndex(this.app);
				this.tableFilePropertyIndex?.invalidateFile(file.path);
				this.scheduleTableFilePropertyRefresh(120);
				void this.refreshTableFilePropertyTypes();
				this.scheduleLocationPlaceTableRefresh(120);
				this.scheduleYamlPropertyVisibilityRefresh(120);
			}),
		);
	}

	private scheduleYamlPropertyVisibilityRefresh(delayMs = 0): void {
		if (this.yamlPropertyVisibilityRefreshTimer) {
			clearWindowTimeout(this.yamlPropertyVisibilityRefreshTimer);
		}
		this.yamlPropertyVisibilityRefreshTimer = setWindowTimeout(() => {
			this.yamlPropertyVisibilityRefreshTimer = null;
			this.refreshOpenYamlPropertyViews();
		}, delayMs);
	}

	private scheduleLocationPlaceTableRefresh(delayMs = 0): void {
		if (this.locationPlaceTableRefreshTimer) {
			clearWindowTimeout(this.locationPlaceTableRefreshTimer);
		}
		this.locationPlaceTableRefreshTimer = setWindowTimeout(() => {
			this.locationPlaceTableRefreshTimer = null;
			this.refreshLocationPlaceTableSurfaces();
		}, delayMs);
	}

	private refreshLocationPlaceTableSurfaces(): void {
		this.refreshTableLeaves();
		if (this.embedTableDeps) {
			refreshEmbedTables(this.embedTableDeps);
		}
	}

	private scheduleTableFilePropertyRefresh(delayMs = 0): void {
		if (this.tableFilePropertyRefreshTimer) {
			clearWindowTimeout(this.tableFilePropertyRefreshTimer);
		}
		this.tableFilePropertyRefreshTimer = setWindowTimeout(() => {
			this.tableFilePropertyRefreshTimer = null;
			this.refreshViews({ reason: 'file-properties' });
		}, delayMs);
	}

	private async refreshTableFilePropertyTypes(force = false, refreshSurfaces = true): Promise<void> {
		const now = Date.now();
		if (this.tableFilePropertyTypeCheckActive) return;
		if (!force && now - this.tableFilePropertyTypeLastCheckAt < TABLE_FILE_PROPERTY_TYPE_CHECK_THROTTLE_MS) return;
		this.tableFilePropertyTypeCheckActive = true;
		this.tableFilePropertyTypeLastCheckAt = now;
		try {
			const path = `${this.app.vault.configDir}/types.json`;
			const stat = await this.app.vault.adapter.stat(path);
			const fingerprint = stat && stat.type === 'file' ? `${stat.mtime}:${stat.size}` : 'missing';
			if (!force && fingerprint === this.tableFilePropertyTypeFingerprint) return;
			const previousRevision = this.tableFilePropertyTypeResolver.getRevision?.() ?? 0;
			const types = fingerprint === 'missing'
				? {}
				: await loadTableFilePropertyTypesFromConfig(this.app);
			this.tableFilePropertyTypeFingerprint = fingerprint;
			this.tableFilePropertyTypeResolver.replaceTypes(types);
			if ((this.tableFilePropertyTypeResolver.getRevision?.() ?? 0) === previousRevision) return;
			this.tableFilePropertyIndex?.invalidateTypes();
			if (refreshSurfaces) this.scheduleTableFilePropertyRefresh(0);
		} catch {
			// Keep inferred scalar types when Obsidian's registry is temporarily unavailable.
		} finally {
			this.tableFilePropertyTypeCheckActive = false;
		}
	}

	private refreshOpenYamlPropertyViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView)) continue;
			const filePath = view.file?.path ?? '';
			const fileTask = filePath ? this.indexer.getFileTaskByPath(filePath) ?? null : null;
			const roots = new Set<ParentNode>();
			roots.add(view.containerEl);

			const previewContainer = (view.previewMode as { containerEl?: HTMLElement } | undefined)?.containerEl;
			if (previewContainer) roots.add(previewContainer);

			const contentEl = (view as MarkdownView & { contentEl?: HTMLElement }).contentEl;
			if (contentEl) roots.add(contentEl);

			for (const root of roots) {
				applyFileTaskPropertyVisibility(root, fileTask, this.settings.keyMappings);
			}
		}
	}

	private openInlineSubtaskCreatorFromParent(
		request: TaskEditorSubtaskRequest,
		parentTask: ParsedTask,
	): void {
		const draft = buildSubtaskTaskCreatorDraft(
			request.parentOperonId,
			request.parentFieldValues,
			request.parentTags,
			this.settings,
		);
		this.openInlineSubtaskCreator(draft, parentTask, request.onBeforeCreate, request.onCreated);
	}

	private openInlineSubtaskCreator(
		initialDraft: TaskCreatorDraft,
		parentTask: ParsedTask,
		onBeforeCreate?: () => boolean | Promise<boolean>,
		onCreated?: (createdOperonId: string) => void | Promise<void>,
	): void {
		const fallbackFile = this.getParsedTaskMarkdownFile(parentTask);
		this.openTaskCreator(initialDraft, {
			submitMode: 'both',
			initialCreateType: 'inline',
			onSubmitInline: (draft) => this.createInlineSubtaskFromFlexibleCreatorDraft(draft, onBeforeCreate, onCreated),
			onSubmitFile: (draft) => this.createFileSubtaskFromCreatorDraft(draft, fallbackFile, onBeforeCreate, onCreated),
		});
	}

	private getParsedTaskMarkdownFile(task: ParsedTask): TFile | null {
		const filePath = task.filePath.trim();
		if (!filePath) return null;
		const file = this.app.vault.getAbstractFileByPath(filePath);
		return file instanceof TFile && file.extension === 'md' ? file : null;
	}

	private async createInlineSubtaskFromFlexibleCreatorDraft(
		draft: TaskCreatorDraft,
		onBeforeCreate?: () => boolean | Promise<boolean>,
		onCreated?: (createdOperonId: string) => void | Promise<void>,
	): Promise<boolean> {
		if (!await this.prepareSubtaskCreation(onBeforeCreate)) {
			new Notice(t('notifications', 'taskSaveFailed'));
			return false;
		}

		const created = await this.createInlineTaskFromCreatorDraftResult(draft);
		if (!created) return false;
		await this.notifySubtaskCreated(onCreated, created.operonId);
		return true;
	}

	private openFileSubtaskCreatorFromParent(
		request: TaskEditorSubtaskRequest,
		parentTask: ParsedTask,
	): void {
		const parentFile = this.app.vault.getAbstractFileByPath(parentTask.filePath);
		const fallbackFile = parentFile instanceof TFile ? parentFile : null;
		const draft = buildSubtaskTaskCreatorDraft(
			request.parentOperonId,
			request.parentFieldValues,
			request.parentTags,
			this.settings,
		);
		this.openFileSubtaskCreator(draft, fallbackFile, request.onBeforeCreate, request.onCreated);
	}

	private openFileSubtaskCreator(
		initialDraft: TaskCreatorDraft,
		fallbackFile: TFile | null,
		onBeforeCreate?: () => boolean | Promise<boolean>,
		onCreated?: (createdOperonId: string) => void | Promise<void>,
	): void {
		this.openTaskCreator(initialDraft, {
			submitMode: 'both',
			initialCreateType: 'file',
			onSubmitInline: (draft) => this.createInlineSubtaskFromFlexibleCreatorDraft(draft, onBeforeCreate, onCreated),
			onSubmitFile: (draft) => this.createFileSubtaskFromCreatorDraft(draft, fallbackFile, onBeforeCreate, onCreated),
		});
	}

	private async createFileSubtaskFromCreatorDraft(
		draft: TaskCreatorDraft,
		fallbackFile: TFile | null,
		onBeforeCreate?: () => boolean | Promise<boolean>,
		onCreated?: (createdOperonId: string) => void | Promise<void>,
	): Promise<boolean> {
		const preservedDraft = cloneTaskCreatorDraft(draft);
		const selectedTemplate = findFileTaskTemplateOptionById(
			this.getFileTaskTemplateOptions(),
			preservedDraft.fileTemplateId,
		);
		if (!selectedTemplate) {
			new Notice(t('notifications', 'chooseFileTaskTemplateFirst'));
			this.openFileSubtaskCreator(preservedDraft, fallbackFile, onBeforeCreate, onCreated);
			return false;
		}
		if (!await this.prepareSubtaskCreation(onBeforeCreate)) {
			new Notice(t('notifications', 'taskSaveFailed'));
			this.openFileSubtaskCreator(preservedDraft, fallbackFile, onBeforeCreate, onCreated);
			return false;
		}

		try {
			const submitSeed = buildTaskCreatorSubmitFieldSeed(preservedDraft);
			const created = await this.createFileTaskFromTemplateSelection(selectedTemplate, {
				fallbackFile,
				initialDescription: this.normalizeTaskCreatorText(preservedDraft.description),
				seedFieldValues: submitSeed.fieldValues,
				seedFieldPresence: submitSeed.fieldPresence,
				explicitEmptyFieldKeys: submitSeed.explicitEmptyFieldKeys,
				seedTags: [...preservedDraft.tags],
				seedTagsPresent: preservedDraft.tags.length > 0 || preservedDraft.explicitFieldKeys.includes('tags'),
				openEditorOnCreate: false,
			});
			if (!created) {
				this.openFileSubtaskCreator(preservedDraft, fallbackFile, onBeforeCreate, onCreated);
				return false;
			}
			const createdOperonId = (created.fieldValues['operonId'] ?? '').trim();
			await this.indexer.reindexFilePath(created.file.path, { notify: false });
			if (createdOperonId) {
				await this.finalizeTaskCreatorCreatedTask(
					createdOperonId,
					preservedDraft,
					created.fieldValues['parentTask'],
				);
			}
			this.refreshViews();
			if (createdOperonId) {
				await this.notifySubtaskCreated(onCreated, createdOperonId);
			}
			this.showTaskNotice('file-created', {
				description: preservedDraft.description,
				fileBasename: created.file.basename,
				indexedDescription: this.getCreatedFileTaskForFilterDraft(created)?.description,
				operonId: createdOperonId,
			});
			return true;
		} catch (error) {
			console.error('Operon: failed to create file subtask from creator draft', error);
			new Notice(t('notifications', 'fileSubtaskCreateFailed'));
			this.openFileSubtaskCreator(preservedDraft, fallbackFile, onBeforeCreate, onCreated);
			return false;
		}
	}

	private async prepareSubtaskCreation(
		onBeforeCreate: (() => boolean | Promise<boolean>) | undefined,
	): Promise<boolean> {
		if (!onBeforeCreate) return true;
		try {
			return await onBeforeCreate() !== false;
		} catch (error) {
			console.warn('Operon: failed to save task editor before subtask creation', error);
			return false;
		}
	}

	private async notifySubtaskCreated(
		onCreated: ((createdOperonId: string) => void | Promise<void>) | undefined,
		createdOperonId: string,
	): Promise<void> {
		if (!onCreated) return;
		try {
			await onCreated(createdOperonId);
		} catch (error) {
			console.warn('Operon: failed to refresh task editor after subtask creation', error);
		}
	}

	/**
	 * Open the task editor for any task identified by operonId.
	 * Convenience wrapper used by sidebar views and subtask edit buttons.
	 */
	private openEditorForId(operonId: string): void {
		void (async () => {
			if (this.redirectDuplicateOperonIdAction(operonId)) return;
			const task = this.indexer.getTask(operonId);
			if (!task) return;

			const parsed = await this.loadEditableParsedTask(task);

			await this.openTaskEditorFor(parsed, async (request) => {
				const saved = await this.applyEditedTaskFromView(task, request);
				if (saved === false) {
					new Notice(t('notifications', 'taskSaveFailed'));
				}
				return saved;
			});
		})();
	}

	private async openEditorForTaskInstance(instanceKey: string): Promise<void> {
		const task = this.indexer.getTaskInstance(instanceKey);
		if (!task) return;

		const parsed = await this.loadEditableParsedTask(task);
		await this.openTaskEditorFor(parsed, async (request) => {
			const latestTask = this.indexer.getTaskInstance(instanceKey) ?? task;
			const saved = await this.applyEditedTaskInstanceFromView(latestTask, request);
			if (saved === false) {
				new Notice(t('notifications', 'taskSaveFailed'));
			}
			return saved;
		}, {}, () => this.indexer.getTaskInstance(instanceKey) ?? null);
	}

	private async openTaskEditorFor(
		task: ParsedTask | null,
		onSave: OnSaveCallback,
		options: TaskEditorContentOptions = {},
		resolveCanonicalTask?: () => IndexedTask | null,
	): Promise<void> {
		const indexedBeforeSave = task?.operonId ? this.indexer.getTask(task.operonId) : null;
		const fallbackSourceFormat = indexedBeforeSave?.primary.format ?? 'inline';
		let resolvedOptions: TaskEditorContentOptions;
		const wrappedOnSave: OnSaveCallback = async (request) => {
			const saved = await onSave(request);
			if (saved === false || saved === null) return saved;
			const parsed = this.parseInlineTaskLine(request.taskLine, task?.lineNumber ?? 0, task?.filePath ?? '');
			const operonId = parsed?.operonId?.trim();
			if (!operonId) return saved;
			const parsedFilePath = parsed?.filePath?.trim() || task?.filePath?.trim() || '';
			const freshTask = resolveCanonicalTask
				? resolveCanonicalTask()
				: this.indexer.getTask(operonId)
					?? (parsedFilePath ? await this.awaitIndexedTask(parsedFilePath, operonId) : null);
				if (freshTask) {
					if (resolvedOptions.fileBody && freshTask.primary.format === 'yaml') {
						resolvedOptions.fileBody.filePath = freshTask.primary.filePath;
					}
					await this.syncRepeatSeriesEntryIfNeeded(freshTask);
					await this.applyInlineRepeatCompletionModeIfRequested(freshTask, request.inlineCompletionMode);
					return {
						canonicalState: {
							description: freshTask.description,
							checkbox: freshTask.checkbox,
							tags: [...freshTask.tags],
							fieldValues: { ...freshTask.fieldValues },
						},
					};
				}

			const fieldValues = parsed
				? Object.fromEntries(parsed.fields.map(field => [field.key, field.value]))
				: {};
			const seriesId = fieldValues['repeatSeriesId']?.trim();
				if (!seriesId) return saved;
			await this.storage.repeatSeries.ensureSeries({
				seriesId,
				sourceTaskId: operonId,
				sourceFormat: fallbackSourceFormat,
				baseTitle: fallbackSourceFormat === 'yaml'
					? (task?.description?.trim() || parsed?.description?.trim() || null)
					: null,
				now: localNow(),
			});
			await this.updateRepeatSeriesInlineCompletionMode(seriesId, request.inlineCompletionMode, {
				sourceTaskId: operonId,
				sourceFormat: fallbackSourceFormat,
				repeat: fieldValues['repeat'],
				description: parsed?.description ?? task?.description ?? null,
			});
			this.refreshViews();
				return saved;
			};
		const baseOptions = {
			...this.getTaskEditorSubtaskOptions(task),
			onRequestDelete: async (parsedTask: ParsedTask): Promise<boolean> => {
				return await this.deleteTaskFromEditor(parsedTask);
			},
			getRepeatSkipDates: (repeatSeriesId: string) => this.storage.repeatSeries.getSkipDates(repeatSeriesId),
			getRepeatSeriesInlineCompletionMode: (repeatSeriesId: string) => this.getRepeatSeriesInlineCompletionMode(repeatSeriesId),
			onUpdateRepeatSkips: async (request: TaskEditorRepeatSkipUpdateRequest): Promise<TaskEditorRepeatSkipUpdateResult> => {
				return await this.updateTaskRepeatSkips(request.operonId, request.repeatSeriesId, request.skipDates);
			},
			onApplyEstimateReallocation: async (
				request: TaskEditorEstimateReallocationRequest,
			): Promise<TaskEditorEstimateReallocationApplyResult> => {
				return await this.applyEstimateReallocationFromEditor(request);
			},
			pinnedCache: this.storage.pinned,
			getProjectSerialDisplay: (operonId: string) => this.getProjectSerialDisplayForTask(operonId),
			...options,
		};
		resolvedOptions = await this.resolveTaskEditorFileBodyOption(task, baseOptions);
		const modal = new TaskEditorModal(this.app, this.indexer, this.settings, task, wrappedOnSave, this.timeTracker, resolvedOptions);
		modal.onCloseSaveSettled = () => this.refreshAfterTaskEditorClose(task?.filePath);
		modal.open();
	}

	private async deleteTaskFromEditor(task: ParsedTask): Promise<boolean> {
		const indexedTask = task.operonId ? this.indexer.getTask(task.operonId) : null;
		const filePath = indexedTask?.primary.filePath ?? task.filePath;
		const operonId = task.operonId?.trim();
		if (!filePath) return false;
		if (!operonId) return false;

		if (indexedTask?.primary.format === 'yaml') {
			const deleted = await this.deleteYamlTaskByPath(filePath);
			if (!deleted) {
				new Notice(t('notifications', 'taskSaveFailed'));
				return false;
			}
			this.refreshViews();
			return true;
		}

		const deleted = await this.clearInlineTaskById(filePath, operonId, indexedTask?.primary.lineNumber ?? task.lineNumber);
		if (!deleted) {
			new Notice(t('notifications', 'taskSaveFailed'));
			return false;
		}
		this.refreshViews();
		return true;
	}

	private async applyEditedTaskInstanceFromView(
		task: IndexedTaskInstance,
		request: TaskEditorSaveRequest,
	): Promise<boolean | null> {
		const parsed = this.parseInlineTaskLine(request.taskLine, 0, task.primary.filePath);
		if (!parsed?.operonId) return false;

		this.maybeApplyScheduledAutomationToParsedTask(parsed, task.fieldValues);
		const payload = this.buildFieldPayload(parsed);
		if (!this.validateDependencyPayloadChanges(task, payload, 'replace')) return null;
		if (!await this.guardTaskStatusChangeOrShow(task, payload, { mode: 'replace' })) return null;
		const normalizedTaskLine = serializeTask(parsed, this.settings.keyMappings);
		let indexedPath = task.primary.filePath;

		if (task.primary.format === 'inline') {
			if (request.fileBody?.dirty && request.fileBody.format === 'inline') {
				const file = this.app.vault.getAbstractFileByPath(task.primary.filePath);
				if (!(file instanceof TFile)) return false;
				const currentContent = await this.app.vault.cachedRead(file);
				const { frontmatter } = splitFrontmatterDocument(currentContent);
				const mergedBody = this.replaceInlineTaskLineInContent(
					request.fileBody.content,
					task.primary.filePath,
					task.operonId,
					normalizedTaskLine,
					task.primary.lineNumber,
				);
				if (mergedBody == null) return false;
				request.fileBody.content = mergedBody;
				const nextContent = frontmatter == null
					? mergedBody
					: `---\n${frontmatter}\n---\n${mergedBody}`;
				this.markInternalTaskWrite(file.path);
				await this.app.vault.modify(file, nextContent);
			} else {
				const updated = await this.replaceInlineTaskById(
					task.primary.filePath,
					task.operonId,
					normalizedTaskLine,
					task.primary.lineNumber,
				);
				if (!updated) return false;
			}
		} else {
				const nextPath = await this.writeYamlTaskInstanceFromParsedTask(task, parsed, request.fileBody);
				if (!nextPath) return false;
				indexedPath = nextPath;
				if (request.fileBody) {
					request.fileBody.filePath = indexedPath;
				}
		}

		await this.indexer.reindexFilePath(indexedPath, { notify: false });
		const afterTask = this.indexer.hasDuplicateOperonIdConflict(parsed.operonId)
			? null
			: this.indexer.getTask(parsed.operonId) ?? null;
		await this.syncDependencyPayloadChanges(task, payload, 'replace');
		if (afterTask) {
			await this.syncRepeatSeriesEntryIfNeeded(afterTask);
		}
		await this.refreshAggregateTotalsAfterTaskMutation(task, afterTask);
		this.scheduleProjectSerialIndexReconcile();
		this.refreshViews();
		return true;
	}

	/**
	 * Refresh all open Operon views (pinned dock, filter view).
	 */
	private scheduleIndexSideEffects(): void {
		this.scheduleProjectSerialIndexReconcile();
		this.indexSideEffectFollowupRequested = true;
		if (this.indexSideEffectTimer || this.indexSideEffectRunning) return;

		this.indexSideEffectTimer = setWindowTimeout(() => {
			this.indexSideEffectTimer = null;
			void this.runScheduledIndexSideEffects();
		}, 80);
	}

	private scheduleProjectSerialIndexReconcile(): void {
		this.projectSerialIndexReconcilePendingBeforeStartup = true;
		if (!this.startupReady || !this.projectSerialIndexReconcileScheduler) return;
		this.projectSerialIndexReconcilePendingBeforeStartup = false;
		this.projectSerialIndexReconcileScheduler.schedule();
	}

	private async runScheduledIndexSideEffects(): Promise<void> {
		if (this.indexSideEffectRunning) return;

		this.indexSideEffectRunning = true;
		this.indexSideEffectFollowupRequested = false;
		const startedAt = enginePerfNow();
		try {
				const sideEffects: Array<Promise<unknown>> = [
					this.timeTracker.resumeFromIndex(),
					this.recurrenceService.reconcileStoredSeries(),
					this.dependencyManager.reconcileAdditiveInverseLinks(),
				];
			if (this.settings.pinnedDockAutoUnpinFinished) {
				sideEffects.push(this.autoUnpinFinishedTasks());
			}

			const results = await Promise.allSettled(sideEffects);
			for (const result of results) {
				if (result.status === 'rejected') {
					console.warn('Operon: index side effect failed', result.reason);
				}
			}
			this.refreshViews({ fromIndexUpdate: true });
			this.syncDuplicateConflictUi(true);
		} finally {
			this.indexSideEffectRunning = false;
			enginePerfLog('onIndexUpdated.sideEffects', `${Math.round(enginePerfNow() - startedAt)}ms`);
			if (this.indexSideEffectFollowupRequested) {
				this.indexSideEffectFollowupRequested = false;
				this.scheduleIndexSideEffects();
			}
		}
	}

	private async handleIndexedTasksChanged(changes: IndexedTaskDelta[]): Promise<void> {
		this.showRawTaskCreationNotices(changes);
		await this.applyDailyNoteInlineTaskDefaultsForNewTasks(changes);
		const movedInlineTaskIds = this.collectMovedInlineTaskWikilinkOverlayIds(changes);
		if (movedInlineTaskIds.size > 0) {
			try {
				await this.repairTaskWikilinkOverlayLinks({
					operonIds: movedInlineTaskIds,
					showNotice: false,
				});
			} catch (error) {
				console.warn('Operon: failed to repair moved inline Task Wikilink Overlay links', error);
			}
		}

		const aggregateChanges = changes.filter(change => this.shouldRefreshAggregateForIndexedChange(change));
		if (aggregateChanges.length > 0) {
			// One batched refresh: concurrent per-delta refreshes on a shared
			// ancestor chain would compute and write the same parents repeatedly.
			// Archiver scheduling and auto-unpin for these deltas are covered by
			// the all-changes loops below.
			try {
				await this.aggregateCoordinator.refreshAfterTaskMutations(aggregateChanges);
			} catch (error) {
				console.warn('Operon: failed to refresh aggregates after indexed task changes', error);
			}
			this.scheduleIndexSideEffects();
		}

		const autoUnpinResults = await Promise.allSettled(
			changes.map(change => this.tryAutoUnpinTerminalTaskIfNeeded(change.after)),
		);
		for (const result of autoUnpinResults) {
			if (result.status === 'rejected') {
				console.warn('Operon: failed to auto-unpin changed task', result.reason);
			}
		}

		for (const change of changes) {
			this.fileTaskArchiver?.scheduleForIndexedChange(change.before, change.after);
		}
	}

	private collectMovedInlineTaskWikilinkOverlayIds(changes: IndexedTaskDelta[]): Set<string> {
		const movedIds = new Set<string>();
		for (const change of changes) {
			const before = change.before;
			const after = change.after;
			if (!before || !after) continue;
			if (before.primary.format !== 'inline') continue;
			if (after.primary.format !== 'inline') continue;
			if (before.primary.filePath === after.primary.filePath) continue;
			movedIds.add(after.operonId);
		}
		return movedIds;
	}

	private async handleRepairTaskWikilinkOverlayLinksCommand(): Promise<void> {
		try {
			await this.repairTaskWikilinkOverlayLinks({ showNotice: true });
		} catch (error) {
			console.error('Operon: failed to repair Task Wikilink Overlay links', error);
			new Notice(t('notifications', 'taskWikilinkOverlayLinksRepairFailed'));
		}
	}

	private async repairTaskWikilinkOverlayLinks(options: {
		operonIds?: ReadonlySet<string>;
		showNotice: boolean;
	}): Promise<{ updatedFileCount: number; updatedLinkCount: number }> {
		const targetsByOperonId = this.buildTaskWikilinkOverlayRewriteTargets(options.operonIds);
		if (targetsByOperonId.size === 0) {
			if (options.showNotice) {
				new Notice(t('notifications', 'taskWikilinkOverlayLinksRepairNoop'));
			}
			return { updatedFileCount: 0, updatedLinkCount: 0 };
		}

		const touchedFilePaths: string[] = [];
		let updatedLinkCount = 0;
		for (const file of this.app.vault.getMarkdownFiles()) {
			const rewrite = await this.rewriteTaskWikilinkOverlayLinksInFile(file, targetsByOperonId);
			if (!rewrite || rewrite.rewrittenLinkCount === 0) continue;
			touchedFilePaths.push(file.path);
			updatedLinkCount += rewrite.rewrittenLinkCount;
		}

		if (touchedFilePaths.length > 0) {
			await this.indexer.reindexFilesBatch(touchedFilePaths, { notify: false });
			const markdownScope = createScopedMarkdownRefreshScope(touchedFilePaths, 'task-wikilink-overlay-link-repair');
			this.refreshViews({
				reason: 'task-wikilink-overlay-link-repair',
				markdownScope,
			});
			this.scheduleTaskWikilinkOverlayRepairMarkdownRefresh(markdownScope);
		}

		if (options.showNotice) {
			const noticeKey = updatedLinkCount > 0
				? 'taskWikilinkOverlayLinksRepaired'
				: 'taskWikilinkOverlayLinksRepairNoop';
			new Notice(t('notifications', noticeKey, {
				links: String(updatedLinkCount),
				files: String(touchedFilePaths.length),
			}));
		}

		return {
			updatedFileCount: touchedFilePaths.length,
			updatedLinkCount,
		};
	}

	private scheduleTaskWikilinkOverlayRepairMarkdownRefresh(scope: MarkdownRefreshScope): void {
		for (const delayMs of [80, 220]) {
			setWindowTimeout(() => {
				this.refreshMarkdownTaskSurfaces({
					scope,
					forceReadingViewRerender: true,
				});
			}, delayMs);
		}
	}

	private buildTaskWikilinkOverlayRewriteTargets(
		operonIds?: ReadonlySet<string>,
	): Map<string, TaskWikilinkOverlayRewriteTarget> {
		const grouped = new Map<string, IndexedTask[]>();
		for (const task of this.indexer.getAllTasks()) {
			if (task.primary.format !== 'inline') continue;
			if (operonIds && !operonIds.has(task.operonId)) continue;
			const group = grouped.get(task.operonId) ?? [];
			group.push(task);
			grouped.set(task.operonId, group);
		}

		const targets = new Map<string, TaskWikilinkOverlayRewriteTarget>();
		for (const [operonId, tasks] of grouped) {
			if (tasks.length !== 1) continue;
			if (this.indexer.hasDuplicateOperonIdConflict(operonId)) continue;
			const task = tasks[0];
			if (!task) continue;
			const file = this.app.vault.getAbstractFileByPath(task.primary.filePath);
			if (!(file instanceof TFile)) continue;
			targets.set(operonId, {
				operonId,
				filePath: file.path,
				basename: file.basename,
			});
		}
		return targets;
	}

	private async rewriteTaskWikilinkOverlayLinksInFile(
		file: TFile,
		targetsByOperonId: ReadonlyMap<string, TaskWikilinkOverlayRewriteTarget>,
	): Promise<TaskWikilinkOverlayRewriteResult | null> {
		const openView = this.getMarkdownViewForPath(file.path);
		if (openView) {
			return await this.rewriteTaskWikilinkOverlayLinksInOpenEditor(openView, targetsByOperonId);
		}

		const content = await this.app.vault.cachedRead(file);
		const rewrite = rewriteTaskWikilinkOverlayLinksInContent(content, {
			targetsByOperonId,
			escapeTarget: target => this.escapeFileTaskWikilinkTarget(target),
		});
		if (rewrite.rewrittenLinkCount === 0) return null;

		this.markInternalTaskWrite(file.path);
		await this.app.vault.modify(file, rewrite.content);
		return rewrite;
	}

	private async rewriteTaskWikilinkOverlayLinksInOpenEditor(
		view: MarkdownView,
		targetsByOperonId: ReadonlyMap<string, TaskWikilinkOverlayRewriteTarget>,
	): Promise<TaskWikilinkOverlayRewriteResult | null> {
		const filePath = view.file?.path ?? '';
		if (!filePath) return null;

		const editor = view.editor;
		const content = editor.getValue();
		const rewrite = rewriteTaskWikilinkOverlayLinksInContent(content, {
			targetsByOperonId,
			escapeTarget: target => this.escapeFileTaskWikilinkTarget(target),
		});
		if (rewrite.rewrittenLinkCount === 0) return null;

		const changes = this.buildTaskWikilinkOverlayRepairEditorChanges(content, rewrite.replacements);
		try {
			if (editor.getValue() !== content) {
				return null;
			}
			this.markInternalTaskWrite(filePath);
			editor.transaction({ changes }, 'operon-task-wikilink-overlay-repair');
		} catch (error) {
			console.warn('Operon: Task Wikilink Overlay editor repair transaction failed', error);
			return null;
		}

		if (editor.getValue() !== rewrite.content) {
			console.warn('Operon: Task Wikilink Overlay editor repair did not apply all changes');
			return null;
		}

		await this.persistMarkdownViewBuffer(view);
		return rewrite;
	}

	private buildTaskWikilinkOverlayRepairEditorChanges(
		content: string,
		replacements: readonly TaskWikilinkOverlayRewriteReplacement[],
	): BulkSelectionLineChange[] {
		const lineStartOffsets = this.getLineStartOffsets(content);
		return replacements.map(replacement => ({
			from: this.offsetToEditorPosition(replacement.from, lineStartOffsets),
			to: this.offsetToEditorPosition(replacement.to, lineStartOffsets),
			text: replacement.text,
		}));
	}

	private getLineStartOffsets(content: string): number[] {
		const offsets = [0];
		for (let i = 0; i < content.length; i++) {
			if (content[i] === '\n') offsets.push(i + 1);
		}
		return offsets;
	}

	private offsetToEditorPosition(offset: number, lineStartOffsets: readonly number[]): EditorPosition {
		let low = 0;
		let high = lineStartOffsets.length - 1;
		while (low <= high) {
			const mid = Math.floor((low + high) / 2);
			const start = lineStartOffsets[mid] ?? 0;
			const nextStart = lineStartOffsets[mid + 1] ?? Number.POSITIVE_INFINITY;
			if (offset < start) {
				high = mid - 1;
			} else if (offset >= nextStart) {
				low = mid + 1;
			} else {
				return { line: mid, ch: offset - start };
			}
		}
		const lastLine = Math.max(0, lineStartOffsets.length - 1);
		const lastStart = lineStartOffsets[lastLine] ?? 0;
		return { line: lastLine, ch: Math.max(0, offset - lastStart) };
	}

	private async applyDailyNoteInlineTaskDefaultsForNewTasks(changes: IndexedTaskDelta[]): Promise<void> {
		if (!this.settings.inlineTaskDailyNoteAddStartDate && !this.settings.inlineTaskDailyNoteAddScheduledDate) return;

		const dailyNotesConfig = await loadDailyNotesCoreConfig(this.app);
		const plans = buildDailyNoteInlineTaskDefaultWritePlans({
			changes,
			dailyNotesConfig,
			settings: this.settings,
			now: localNow(),
		});
		if (plans.length === 0) return;

		const results = await Promise.allSettled(
			plans.map(plan => this.writer.writeTaskFields(plan.operonId, plan.payload)),
		);
		for (const result of results) {
			if (result.status === 'rejected') {
				console.warn('Operon: failed to apply Daily Note inline task defaults', result.reason);
			}
		}
	}

	private showRawTaskCreationNotices(changes: IndexedTaskDelta[]): void {
		const createdTasks: TaskNoticeCreationInput[] = [];
		for (const change of changes) {
			const task = change.after;
			if (change.before || !task) continue;
			if (this.isRawTaskCreationNoticeSuppressed(task.operonId)) continue;
			createdTasks.push({
				format: task.primary.format,
				nameParts: {
					description: task.description,
					fileBasename: task.primary.format === 'yaml'
						? this.getFileBasenameFromPath(task.primary.filePath)
						: null,
					indexedDescription: task.description,
					operonId: task.operonId,
				},
			});
		}

		for (const notice of buildTaskCreationNotices(createdTasks, RAW_TASK_CREATION_BULK_NOTICE_THRESHOLD)) {
			if (notice.kind === 'single') {
				this.showTaskNotice(notice.taskKind, notice.parts);
			} else {
				new Notice(formatTaskNoticeCount(notice.countKind, notice.count));
			}
		}
	}

	private getFileBasenameFromPath(filePath: string): string {
		const fileName = filePath.split('/').pop() ?? filePath;
		return fileName.replace(/\.md$/iu, '');
	}

	private suppressRawTaskCreationNotice(operonId: string | null | undefined): void {
		const normalized = operonId?.trim() ?? '';
		if (!normalized) return;
		const now = Date.now();
		this.pruneRawTaskCreationNoticeSuppressions(now);
		this.rawTaskCreationNoticeSuppressUntilById.set(
			normalized,
			now + RAW_TASK_CREATION_NOTICE_SUPPRESSION_TTL_MS,
		);
	}

	private isRawTaskCreationNoticeSuppressed(operonId: string): boolean {
		const normalized = operonId.trim();
		if (!normalized) return false;
		const now = Date.now();
		this.pruneRawTaskCreationNoticeSuppressions(now);
		const suppressUntil = this.rawTaskCreationNoticeSuppressUntilById.get(normalized);
		return !!suppressUntil && suppressUntil > now;
	}

	private pruneRawTaskCreationNoticeSuppressions(now = Date.now()): void {
		for (const [operonId, suppressUntil] of this.rawTaskCreationNoticeSuppressUntilById) {
			if (suppressUntil <= now) {
				this.rawTaskCreationNoticeSuppressUntilById.delete(operonId);
			}
		}
	}

	private shouldRefreshAggregateForIndexedChange(change: IndexedTaskDelta): boolean {
		const beforeTask = change.before;
		const afterTask = change.after;
		if (!afterTask) return false;
		if (!beforeTask) {
			return this.hasAggregateRelationship(afterTask);
		}
		if (beforeTask.checkbox !== afterTask.checkbox) return true;
		for (const key of ['parentTask', 'duration', 'estimate'] as const) {
			if ((beforeTask.fieldValues[key] ?? '') !== (afterTask.fieldValues[key] ?? '')) {
				return true;
			}
		}
		return false;
	}

	private hasAggregateRelationship(task: IndexedTask): boolean {
		if ((task.fieldValues['parentTask'] ?? '').trim()) return true;
		return this.indexer.secondary.getChildIds(task.operonId).size > 0;
	}

	private async handleTasksRemovedFromIndex(removedTasks: IndexedTask[]): Promise<void> {
		const tasks: Array<Promise<unknown>> = [
			this.refreshAggregateStateAfterTaskRemoval(removedTasks),
		];
		const results = await Promise.allSettled(tasks);
		for (const result of results) {
			if (result.status === 'rejected') {
				console.warn('Operon: failed to process removed indexed tasks', result.reason);
			}
		}
		this.scheduleIndexSideEffects();
	}

	private refreshViews(options: boolean | RefreshViewsOptions = true): void {
		const resolvedOptions: RefreshViewsOptions = typeof options === 'boolean'
			? { scheduleFollowup: options }
			: options;
		const scheduleFollowup = resolvedOptions.scheduleFollowup ?? true;
		const reason = resolvedOptions.reason ?? 'refresh';
		const requestMarkdownScope = resolvedOptions.markdownScope
			?? createGlobalMarkdownRefreshScope(reason, 'unscoped-request');

		if (scheduleFollowup) {
			this.refreshViewsFollowupRequested = true;
		}
		if (resolvedOptions.fromIndexUpdate !== true) {
			this.refreshViewsPendingNonIndexRequest = true;
		}
		this.refreshViewsPendingRequestCount++;
		this.refreshViewsPendingMarkdownScope = mergeMarkdownRefreshScopes(
			this.refreshViewsPendingMarkdownScope,
			requestMarkdownScope,
		);
		const pendingMarkdownScope = this.refreshViewsPendingMarkdownScope
			?? createGlobalMarkdownRefreshScope(reason, 'missing-pending-scope');
		const surfaceMetadata = resolvedOptions.statusCycleTrace
			? this.getRefreshViewsSurfaceMetadata()
			: [];
		if (this.refreshViewsPendingPerfContext) {
			this.refreshViewsPendingPerfContext.requestCount = this.refreshViewsPendingRequestCount;
			this.refreshViewsPendingPerfContext.markdownScope = pendingMarkdownScope;
		} else if (resolvedOptions.statusCycleTrace) {
			this.refreshViewsPendingPerfContext = {
				trace: resolvedOptions.statusCycleTrace,
				reason,
				requestedAt: enginePerfNow(),
				requestCount: this.refreshViewsPendingRequestCount,
				surfaceMetadata,
				markdownScope: pendingMarkdownScope,
			};
		}
		const requestContext = resolvedOptions.statusCycleTrace
			? {
				trace: resolvedOptions.statusCycleTrace,
				reason,
				requestedAt: enginePerfNow(),
				requestCount: this.refreshViewsPendingRequestCount,
				surfaceMetadata,
				markdownScope: pendingMarkdownScope,
			}
			: null;
		this.logRefreshViewsPerfRequest(requestContext, this.refreshViewsFrame !== null);
		if (this.refreshViewsFrame !== null) return;

		this.refreshViewsFrame = window.requestAnimationFrame(() => {
			this.refreshViewsFrame = null;
			const shouldScheduleFollowup = this.refreshViewsFollowupRequested;
			const perfContext = this.refreshViewsPendingPerfContext;
			const markdownScope = this.refreshViewsPendingMarkdownScope
				?? createGlobalMarkdownRefreshScope('refresh', 'missing-pending-scope');
			// A coalesced pass may only offer the calendar content-skip when
			// every merged request came from an index update.
			const allowCalendarContentSkip = !this.refreshViewsPendingNonIndexRequest;
			this.refreshViewsFollowupRequested = false;
			this.refreshViewsPendingNonIndexRequest = false;
			this.refreshViewsPendingRequestCount = 0;
			this.refreshViewsPendingPerfContext = null;
			this.refreshViewsPendingMarkdownScope = null;
			this.renderViews(shouldScheduleFollowup, perfContext, markdownScope, allowCalendarContentSkip);
		});
	}

	private renderViews(
		scheduleFollowup = true,
		perfContext: RefreshViewsPerfContext | null = null,
		markdownScope: MarkdownRefreshScope = createGlobalMarkdownRefreshScope('refresh', 'render-default'),
		allowCalendarContentSkip = false,
	): void {
		this.refreshViewsCallCount++;
		const startedAt = perfNow();
		const engineStartedAt = perfContext ? enginePerfNow() : 0;
		const isPrimaryPass = scheduleFollowup;
		const stageTimings: RefreshViewsStageTiming[] | null = perfContext ? [] : null;
		this.pruneDisconnectedDynamicFileTaskFilterReadingHosts();

		if (isPrimaryPass) {
			const freezeCalendarRefresh = this.shouldFreezeCalendarRefresh();
			const freezeKanbanRefresh = this.shouldFreezeKanbanRefresh();
				const pinnedStartedAt = perfContext ? enginePerfNow() : 0;
				this.pinnedDock?.render();
				for (const leaf of this.app.workspace.getLeavesOfType(PINNED_TASKS_SIDEBAR_VIEW_TYPE)) {
					callUnknownMethod(leaf.view, 'render');
				}
				this.recordRefreshViewsPerfStage(stageTimings, perfContext, 'pinned', pinnedStartedAt);
			const filtersStartedAt = perfContext ? enginePerfNow() : 0;
			for (const leaf of this.app.workspace.getLeavesOfType(FILTER_VIEW_TYPE)) {
				if (hasUnknownMethod(leaf.view, 'renderIfVisibleOrInvalidate')) {
					callUnknownMethod(leaf.view, 'renderIfVisibleOrInvalidate');
				} else {
					callUnknownMethod(leaf.view, 'render');
				}
			}
			this.recordRefreshViewsPerfStage(stageTimings, perfContext, 'filters', filtersStartedAt);
			const tableStartedAt = perfContext ? enginePerfNow() : 0;
			this.refreshTableLeaves();
			this.recordRefreshViewsPerfStage(stageTimings, perfContext, 'table', tableStartedAt);
			const timeHistoryStartedAt = perfContext ? enginePerfNow() : 0;
			this.refreshTimeSessionHistoryLeaves();
			this.recordRefreshViewsPerfStage(stageTimings, perfContext, 'time-history', timeHistoryStartedAt);
			const flowTimeStartedAt = perfContext ? enginePerfNow() : 0;
			for (const leaf of this.app.workspace.getLeavesOfType(FLOW_TIME_VIEW_TYPE)) {
				callUnknownMethod(leaf.view, 'render');
			}
			this.recordRefreshViewsPerfStage(stageTimings, perfContext, 'flow-time', flowTimeStartedAt);
			const kanbanStartedAt = perfContext ? enginePerfNow() : 0;
			if (freezeKanbanRefresh) {
				this.pendingKanbanRefresh = true;
			} else {
				this.pendingKanbanRefresh = false;
				this.refreshKanbanLeaves();
			}
			this.recordRefreshViewsPerfStage(
				stageTimings,
				perfContext,
				'kanban',
				kanbanStartedAt,
				`frozen=${String(freezeKanbanRefresh)}`,
			);
			const calendarStartedAt = perfContext ? enginePerfNow() : 0;
				if (freezeCalendarRefresh) {
					this.pendingCalendarRefresh = true;
					this.scheduleEditableFocusRefreshFlush();
				} else {
					this.pendingCalendarRefresh = false;
					this.refreshCalendarLeaves(perfContext?.trace ?? null, allowCalendarContentSkip);
				}
			this.recordRefreshViewsPerfStage(
				stageTimings,
				perfContext,
				'calendar',
				calendarStartedAt,
				`frozen=${String(freezeCalendarRefresh)}`,
			);
			const trackerStatusStartedAt = perfContext ? enginePerfNow() : 0;
			this.trackerStatusBar?.render();
			this.recordRefreshViewsPerfStage(stageTimings, perfContext, 'tracker-status', trackerStatusStartedAt);
		}
		const markdownStartedAt = perfContext ? enginePerfNow() : 0;
		const markdownResult = this.refreshMarkdownTaskSurfaces({ scope: markdownScope });
		this.recordRefreshViewsPerfStage(
			stageTimings,
			perfContext,
			'markdown',
			markdownStartedAt,
			...this.getMarkdownRefreshScopePerfMetadata(markdownResult),
		);
		const tableEmbedsStartedAt = perfContext ? enginePerfNow() : 0;
		if (isPrimaryPass && this.embedTableDeps) {
			refreshEmbedTables(this.embedTableDeps);
		}
		if (isPrimaryPass) {
			this.recordRefreshViewsPerfStage(stageTimings, perfContext, 'table-embeds', tableEmbedsStartedAt);
		}
		// Refresh embedded filter code blocks (they don't auto-update)
		const embedsStartedAt = perfContext ? enginePerfNow() : 0;
		if (isPrimaryPass && this.embedFilterDeps) {
			refreshEmbedFilters(this.embedFilterDeps);
		}
		if (isPrimaryPass) {
			this.subtasksFilterModal?.refresh();
		}
		if (isPrimaryPass) {
			this.recordRefreshViewsPerfStage(stageTimings, perfContext, 'embeds', embedsStartedAt);
		}
		const modalsStartedAt = perfContext ? enginePerfNow() : 0;
		if (isPrimaryPass) refreshFilterSetModals();
		if (isPrimaryPass) refreshFilterPreviewModals();
		if (isPrimaryPass) {
			this.recordRefreshViewsPerfStage(stageTimings, perfContext, 'modals', modalsStartedAt);
		}
		const yamlPropsStartedAt = perfContext ? enginePerfNow() : 0;
		this.scheduleYamlPropertyVisibilityRefresh(isPrimaryPass ? 80 : 140);
		this.recordRefreshViewsPerfStage(stageTimings, perfContext, 'yaml-props-schedule', yamlPropsStartedAt);

		perfLog(
			'refreshViews',
			`${Math.round(perfNow() - startedAt)}ms`,
			`primary=${isPrimaryPass}`,
			`filters=${this.app.workspace.getLeavesOfType(FILTER_VIEW_TYPE).length}`,
			`embeds=${this.embedFilterDeps ? 'active' : 'none'}`,
			`tableEmbeds=${this.embedTableDeps ? 'active' : 'none'}`,
		);
		if (perfContext) {
			const rafWaitMs = Math.round(engineStartedAt - perfContext.requestedAt);
			const totalMs = Math.round(enginePerfNow() - engineStartedAt);
			const totalDetails = [
				`rafWaitMs=${rafWaitMs}`,
				`totalMs=${totalMs}`,
			];
			this.logRefreshViewsPerfStage(
				perfContext,
				isPrimaryPass ? 'primary' : 'followup',
				engineStartedAt,
				...totalDetails,
			);
			this.logRefreshViewsPerfSummary(
				perfContext,
				isPrimaryPass ? 'primary' : 'followup',
				totalMs,
				rafWaitMs,
				stageTimings ?? [],
			);
		}

		if (scheduleFollowup) {
			if (this.deferredRefreshTimer) {
				clearWindowTimeout(this.deferredRefreshTimer);
			}
			const followupContext = perfContext
				? {
					...perfContext,
					requestedAt: enginePerfNow(),
				}
				: null;
				this.deferredRefreshTimer = setWindowTimeout(() => {
					this.deferredRefreshTimer = null;
					this.refreshViews({
						scheduleFollowup: false,
						statusCycleTrace: followupContext?.trace ?? null,
					reason: followupContext?.reason ?? markdownScope.reason,
					markdownScope: followupContext?.markdownScope ?? markdownScope,
					});
				}, 180);
			}
			this.scheduleLivePreviewAuthoringCursorRestoreAfterRefresh();
		}

	private refreshTimerStateSurfaces(): void {
		this.pinnedDock?.render();
		for (const leaf of this.app.workspace.getLeavesOfType(PINNED_TASKS_SIDEBAR_VIEW_TYPE)) {
			callUnknownMethod(leaf.view, 'render');
		}
		for (const leaf of this.app.workspace.getLeavesOfType(FILTER_VIEW_TYPE)) {
			if (hasUnknownMethod(leaf.view, 'renderIfVisibleOrInvalidate')) {
				callUnknownMethod(leaf.view, 'renderIfVisibleOrInvalidate');
			} else {
				callUnknownMethod(leaf.view, 'render');
			}
		}
		for (const leaf of this.app.workspace.getLeavesOfType(FLOW_TIME_VIEW_TYPE)) {
			callUnknownMethod(leaf.view, 'render');
		}
		for (const leaf of this.app.workspace.getLeavesOfType(CALENDAR_VIEW_TYPE)) {
			callUnknownMethod(leaf.view, 'markDirty');
		}
		for (const leaf of this.app.workspace.getLeavesOfType(KANBAN_VIEW_TYPE)) {
			callUnknownMethod(leaf.view, 'markDirty');
		}
		this.refreshTableLeaves();
		this.trackerStatusBar?.render();
		this.refreshMarkdownTaskSurfaces();
		if (this.embedTableDeps) {
			refreshEmbedTables(this.embedTableDeps);
		}
		if (this.embedFilterDeps) {
			refreshEmbedFilters(this.embedFilterDeps);
		}
		refreshFilterSetModals();
		refreshFilterPreviewModals();
	}

	private refreshAfterTaskEditorClose(filePath?: string): void {
		const trimmedFilePath = filePath?.trim() ?? '';
		const scope = trimmedFilePath
			? createScopedMarkdownRefreshScope([trimmedFilePath], 'task-editor-close')
			: undefined;
		this.refreshMarkdownTaskSurfaces({
			resetLivePreviewReveal: true,
			scope,
			forceReadingViewRerender: true,
		});
		this.refreshViews();
		const win = getActiveWindow();
		win.setTimeout(() => this.refreshMarkdownTaskSurfaces({
			resetLivePreviewReveal: true,
			scope,
			forceReadingViewRerender: true,
		}), 80);
		win.setTimeout(() => this.refreshMarkdownTaskSurfaces({
			resetLivePreviewReveal: true,
			scope,
			forceReadingViewRerender: true,
		}), 220);
	}

	private refreshMarkdownAfterInlineAuthoring(filePath: string): void {
		const trimmedFilePath = filePath.trim();
		if (!trimmedFilePath) return;
		const scope = createScopedMarkdownRefreshScope([trimmedFilePath], 'inline-authoring');
		const refresh = () => this.refreshMarkdownTaskSurfaces({
			resetLivePreviewReveal: true,
			scope,
			forceReadingViewRerender: true,
		});
		refresh();
		const win = getActiveWindow();
		win.requestAnimationFrame(refresh);
		win.setTimeout(refresh, 80);
	}

	private scheduleInlineToFileTaskMarkdownRefresh(scope: MarkdownRefreshScope, createdFilePath: string): void {
		for (const delayMs of [80, 220]) {
			setWindowTimeout(() => {
				this.refreshMarkdownTaskSurfaces({
					scope,
					forceTaskWikilinkOverlayFilePath: createdFilePath,
				});
			}, delayMs);
		}
	}

	private scheduleInlineToFileTaskMetadataRefresh(scope: MarkdownRefreshScope, createdFilePath: string): void {
		if (!createdFilePath.trim()) return;

		let completed = false;
		let timeout: WindowTimeoutHandle | null = null;
		let onCacheChanged: ReturnType<typeof this.app.metadataCache.on> | null = null;
		const finish = () => {
			if (completed) return;
			completed = true;
			if (onCacheChanged) this.app.metadataCache.offref(onCacheChanged);
			if (timeout) clearWindowTimeout(timeout);
			this.refreshMarkdownTaskSurfaces({
				scope,
				forceTaskWikilinkOverlayFilePath: createdFilePath,
			});
		};

		onCacheChanged = this.app.metadataCache.on('changed', (changedFile: TFile) => {
			if (changedFile.path !== createdFilePath) return;
			finish();
		});
		timeout = setWindowTimeout(finish, 600);
	}

	private refreshMarkdownTaskSurfaces(options: MarkdownTaskSurfaceRefreshOptions = {}): MarkdownTaskSurfaceRefreshResult {
		// Force-refresh CM6 task bar widgets in all open markdown editors
		// so they rebuild with fresh index data (same pattern as FilterView.render()).
		const scope = options.scope ?? createGlobalMarkdownRefreshScope('markdown-refresh', 'unscoped-request');
		const scopedFilePaths = scope.mode === 'scoped' ? new Set(scope.filePaths) : null;
		let refreshedLeaves = 0;
		let skippedLeaves = 0;
		const refreshEffect = options.resetLivePreviewReveal
			? operonEditorCloseRefreshEffect.of()
			: operonIndexRefreshEffect.of();
		const forceTaskWikilinkOverlayFilePath = options.forceTaskWikilinkOverlayFilePath?.trim() ?? '';
		const refreshEffects: StateEffect<unknown>[] = forceTaskWikilinkOverlayFilePath
			? [
				refreshEffect,
				operonTaskWikilinkForceRevealEffect.of({ filePaths: [forceTaskWikilinkOverlayFilePath] }),
			]
			: [refreshEffect];
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView)) continue;
			if (scopedFilePaths && (!view.file || !scopedFilePaths.has(view.file.path))) {
				skippedLeaves++;
				continue;
			}
			refreshedLeaves++;
			if (view.getMode() === 'preview') {
				try {
					view.previewMode.rerender(options.forceReadingViewRerender === true);
				} catch { /* view may be detached */ }
				continue;
			}
			const cm = getEditorViewFromEditor(view.editor);
			if (cm instanceof EditorView) {
				try {
					cm.dispatch({ effects: refreshEffects });
				} catch { /* view may be detached */ }
			}
		}
		const embeddedResult = refreshEmbeddedMarkdownSourceEditors(refreshEffects, scope);
		return {
			scope,
			refreshedLeaves,
			skippedLeaves,
			refreshedEmbeddedEditors: embeddedResult.refreshedEditors,
			skippedEmbeddedEditors: embeddedResult.skippedEditors,
		};
	}

	private registerFilterPerformanceWatchers(): void {
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', leaf => {
				this.flushPendingCalendarRefresh();
				this.flushPendingKanbanRefresh();
				if (!this.startupReady) return;
				if (leaf?.view instanceof FilterView) {
					leaf.view.render();
					return;
				}
				if (leaf?.view instanceof OperonTableView) {
					leaf.view.markDirty();
				}
			})
		);
	}

	private registerNativeFileTaskConversionMenus(): void {
		this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
			this.updateNativeFileTaskConversionMenu(menu, file, 2);
		}));
		this.registerEvent(this.app.workspace.on('editor-menu', (menu, _editor, info) => {
			this.updateNativeFileTaskConversionMenu(menu, info.file, 1);
		}));
	}

	private updateNativeFileTaskConversionMenu(
		menu: Menu,
		file: TAbstractFile | null,
		priority: number,
	): void {
		const existing = this.nativeFileTaskConversionMenus.get(menu);
		if (existing && existing.priority >= priority) return;

		const targetFile = file instanceof TFile && this.isNativeFileTaskConversionMenuEligible(file)
			? file
			: null;
		if (existing) {
			existing.priority = priority;
			existing.targetFile = targetFile;
			if (existing.item) {
				existing.item.setDisabled(!targetFile);
			} else if (targetFile) {
				this.addNativeFileTaskConversionMenuItem(menu, existing);
			}
			return;
		}

		const state: NativeFileTaskConversionMenuState = {
			priority,
			targetFile,
			item: null,
		};
		this.nativeFileTaskConversionMenus.set(menu, state);
		if (!targetFile) return;
		this.addNativeFileTaskConversionMenuItem(menu, state);
	}

	private addNativeFileTaskConversionMenuItem(
		menu: Menu,
		state: NativeFileTaskConversionMenuState,
	): void {
		menu.addItem(item => {
			state.item = item;
			item
				.setTitle(t('contextMenu', 'convertToOperonFileTask'))
				.setIcon('list-chevrons-up-down')
				.setSection('operon')
				.onClick(() => {
					const selectedFile = state.targetFile;
					if (!selectedFile) return;
					void this.openNativeFileTaskConversionPicker(selectedFile).catch(error => {
						console.error('Operon: native file task conversion failed', error);
						new Notice(t('notifications', 'nativeFileTaskConversionUnavailable'));
					});
				});
		});
	}

	private isNativeFileTaskConversionMenuEligible(file: TFile): boolean {
		if (file.extension !== 'md') return false;
		if (isOperonExcludedPath(file.path, this.settings)) return false;
		if (this.indexer.getFileTaskByPath(file.path)) return false;
		if (!this.hasAvailableFileTaskTemplateOption()) return false;
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
		return !hasNonEmptyManagedYamlValue(frontmatter, 'operonId', this.settings.keyMappings);
	}

	private hasAvailableFileTaskTemplateOption(): boolean {
		if (buildPipelineMinimalFileTaskTemplateOptions(this.settings.pipelines).length > 0) return true;
		const folderPath = this.settings.fileTaskTemplateFolder.trim();
		if (!folderPath) return false;
		const folder = this.app.vault.getAbstractFileByPath(folderPath);
		return folder instanceof TFolder && folder.children.some(child =>
			child instanceof TFile && child.extension === 'md'
		);
	}

	private registerFileWatchers(): void {
		// File content changed → incremental reindex
		this.registerEvent(
			this.app.vault.on('modify', (file: TAbstractFile) => {
				if (!(file instanceof TFile) || file.extension !== 'md') return;
				if (this.shouldSuppressInternalTaskWrite(file.path)) return;
				void this.normalizeWorkflowStateAfterRawEdit(file.path);
			})
		);

		// New file created → scan it
		this.registerEvent(
			this.app.vault.on('create', (file: TAbstractFile) => {
				if (file instanceof TFile && file.extension === 'md') {
					invalidateCustomFieldValueCandidateCache(this.app);
					invalidateLocationPlaceIndex(this.app);
					this.tableFilePropertyIndex?.invalidateFile(file.path);
					this.scheduleTableFilePropertyRefresh(120);
					this.markTemplatedFileTaskCreationCandidate(file.path);
					this.indexer.scheduleReindex(file.path);
					getActiveWindow().setTimeout(() => {
						void this.normalizeWorkflowStateAfterRawEdit(file.path);
					}, 0);
				}
			})
		);

		// File deleted → remove from index
		this.registerEvent(
				this.app.vault.on('delete', (file: TAbstractFile) => {
					if (file instanceof TFile && file.extension === 'md') {
						invalidateCustomFieldValueCandidateCache(this.app);
						invalidateLocationPlaceIndex(this.app);
						this.tableFilePropertyIndex?.removeFile(file.path);
						this.scheduleTableFilePropertyRefresh(120);
						this.templatedFileTaskCreationCandidates.delete(file.path);
						this.workflowNormalizationPending.delete(file.path);
						void this.indexer.handleFileDelete(file.path);
					}
				})
			);

		// File renamed/moved → update locations in index, then reindex
		this.registerEvent(
			this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
				if (!(file instanceof TFile) || file.extension !== 'md') return;

				invalidateCustomFieldValueCandidateCache(this.app);
				invalidateLocationPlaceIndex(this.app);
				this.tableFilePropertyIndex?.renameFile(oldPath, file.path);
				this.scheduleTableFilePropertyRefresh(120);
				const movedTemplatedCandidate = this.moveTemplatedFileTaskCreationCandidate(oldPath, file.path);
				if (movedTemplatedCandidate) {
					if (this.workflowNormalizationPending.delete(oldPath)) {
						this.workflowNormalizationPending.add(file.path);
					}
					const normalizationOwner = this.findWorkflowNormalizationOwner(oldPath);
					if (normalizationOwner) {
						this.workflowNormalizationRenameTargets.set(normalizationOwner, file.path);
					} else {
						void this.normalizeWorkflowStateAfterRawEdit(file.path);
					}
				}
				this.indexer.handleFileRename(oldPath, file.path);
			})
		);
	}

	private registerLivePreviewSessionWatchers(): void {
		this.registerEvent(
			this.app.workspace.on('file-open', file => {
				const session = this.livePreviewEphemeralSession.getActive();
				if (!session) return;
				if (!shouldAbandonLivePreviewSessionForWorkspaceFile(session, file?.path ?? null)) return;
				this.abandonLivePreviewSession('file_changed', session, false);
			})
		);

		this.registerEvent(
			this.app.workspace.on('active-leaf-change', leaf => {
				const session = this.livePreviewEphemeralSession.getActive();
				if (!session) return;
				const leafFile = leaf?.view instanceof MarkdownView ? leaf.view.file : null;
				if (!shouldAbandonLivePreviewSessionForWorkspaceFile(session, leafFile?.path ?? null)) return;
				this.abandonLivePreviewSession('file_changed', session, false);
			})
		);

		this.registerEvent(
			this.app.workspace.on('editor-change', (editor, info) => {
				if (this.suppressLivePreviewSessionEditorChange) return;
				const filePath = getWorkspaceEventFilePath(info);
				if (!filePath) return;
				if (!this.isLivePreviewEditor(editor)) return;

				const session = this.livePreviewEphemeralSession.getActive();

				if (!session) return;
				if (this.isLivePreviewPickerPending(session)) return;
				if (filePath !== session.filePath) {
					this.abandonLivePreviewSession('file_changed', session, false);
					return;
				}
				if (session.status === 'picker_open') return;

				this.abandonLivePreviewSession('selection_moved', session, false);
			})
		);
	}

	/**
	 * Unpin tasks that have reached a terminal state.
	 * Called after every index update when pinnedDockAutoUnpinFinished is enabled.
	 * No vault writes — uses PinnedCache to avoid reindex loop.
	 */
	private async autoUnpinFinishedTasks(): Promise<void> {
		if (!this.pinnedCache) return;
		const workflowStatusIdentityIndex = buildWorkflowStatusIdentityIndex(this.settings.pipelines);
		const candidates = this.indexer.getAllTasks().filter(task => {
			if (!this.pinnedCache!.isPinned(task.operonId)) return false;
			return shouldAutoUnpinTerminalTask(task, this.settings.pipelines, workflowStatusIdentityIndex);
		});
		if (candidates.length === 0) return;
		const nextPinnedIds = new Set(this.pinnedCache.getPinnedIds());
		for (const task of candidates) {
			nextPinnedIds.delete(task.operonId);
		}
		await this.pinnedCache.replacePinnedIds(nextPinnedIds);
	}

	private async tryAutoUnpinTerminalTaskIfNeeded(task: IndexedTask | null | undefined): Promise<void> {
		if (!task) return;
		if (!this.settings.pinnedDockAutoUnpinFinished) return;
		if (!this.pinnedCache?.isPinned(task.operonId)) return;
		if (!shouldAutoUnpinTerminalTask(task, this.settings.pipelines)) return;
		try {
			await this.pinnedCache.unpin(task.operonId);
		} catch (error) {
			console.warn('Operon: failed to auto-unpin terminal task', error);
		}
	}

	private createStatusCyclePerfTrace(task: IndexedTask, startedAt: number): StatusCyclePerfTrace | null {
		if (!isOperonEnginePerfDebugEnabled()) return null;
		this.statusCyclePerfTraceCounter = (this.statusCyclePerfTraceCounter + 1) % Number.MAX_SAFE_INTEGER;
		return {
			traceId: `status-${Date.now().toString(36)}-${this.statusCyclePerfTraceCounter.toString(36)}`,
			taskId: task.operonId,
			format: task.primary.format,
			filePath: task.primary.filePath,
			changedKeys: [],
			startedAt,
		};
	}

	private setStatusCyclePerfChangedKeys(trace: StatusCyclePerfTrace | null | undefined, keys: string[]): void {
		if (!trace) return;
		trace.changedKeys = Array.from(new Set(keys)).sort();
	}

	private getStatusCyclePerfMetadata(trace: StatusCyclePerfTrace): string[] {
		return [
			`traceId=${trace.traceId}`,
			`taskId=${trace.taskId}`,
			`format=${trace.format}`,
			`filePath=${trace.filePath}`,
			`changedKeys=${trace.changedKeys.length > 0 ? trace.changedKeys.join(',') : 'none'}`,
		];
	}

	private getEnginePerfTraceMetadata(
		trace: StatusCyclePerfTrace,
		reason: string,
	): EnginePerfTraceMetadata {
		return {
			traceId: trace.traceId,
			taskId: trace.taskId,
			format: trace.format,
			filePath: trace.filePath,
			changedKeys: [...trace.changedKeys],
			reason,
		};
	}

	private createStatusCycleIndexPerfContext(
		trace: StatusCyclePerfTrace | null | undefined,
		source: string,
		reason = 'status-cycle',
	): IndexPerfContext | undefined {
		if (!trace) return undefined;
		return {
			source,
			trace: this.getEnginePerfTraceMetadata(trace, reason),
		};
	}

	private logStatusCyclePerfStage(
		trace: StatusCyclePerfTrace | null | undefined,
		stage: string,
		startedAt: number,
		...details: string[]
	): void {
		if (!trace) return;
		enginePerfLog(
			'status.cycle',
			...this.getStatusCyclePerfMetadata(trace),
			`stage=${stage}`,
			`stageMs=${Math.round(enginePerfNow() - startedAt)}`,
			...details,
		);
	}

	private logStatusCyclePerfTotal(trace: StatusCyclePerfTrace | null | undefined): void {
		if (!trace) return;
		enginePerfLog(
			'status.cycle',
			...this.getStatusCyclePerfMetadata(trace),
			'stage=total',
			`totalMs=${Math.round(enginePerfNow() - trace.startedAt)}`,
		);
	}

	private getRefreshViewsPerfMetadata(context: RefreshViewsPerfContext): string[] {
		return [
			...this.getStatusCyclePerfMetadata(context.trace),
			`reason=${context.reason}`,
			`requestCount=${context.requestCount}`,
			...context.surfaceMetadata,
		];
	}

	private getRefreshViewsSurfaceMetadata(): string[] {
		return [
			`filterLeaves=${this.app.workspace.getLeavesOfType(FILTER_VIEW_TYPE).length}`,
			`markdownLeaves=${this.app.workspace.getLeavesOfType('markdown').length}`,
			`kanbanLeaves=${this.app.workspace.getLeavesOfType(KANBAN_VIEW_TYPE).length}`,
			`calendarLeaves=${this.app.workspace.getLeavesOfType(CALENDAR_VIEW_TYPE).length}`,
			`flowTimeLeaves=${this.app.workspace.getLeavesOfType(FLOW_TIME_VIEW_TYPE).length}`,
			`timeHistoryLeaves=${this.app.workspace.getLeavesOfType(TIME_SESSION_HISTORY_VIEW_TYPE).length}`,
			`embedActive=${String(this.embedFilterDeps !== null)}`,
			`freezeCalendar=${String(this.shouldFreezeCalendarRefresh())}`,
			`freezeKanban=${String(this.shouldFreezeKanbanRefresh())}`,
		];
	}

	private getMarkdownRefreshScopePerfMetadata(result: MarkdownTaskSurfaceRefreshResult): string[] {
		const scope = result.scope;
		return [
			`markdownScope=${scope.mode}`,
			`markdownFiles=${scope.mode === 'scoped' ? scope.filePaths.join('|') : 'all'}`,
			`refreshedMarkdownLeaves=${result.refreshedLeaves}`,
			`skippedMarkdownLeaves=${result.skippedLeaves}`,
			`refreshedEmbeddedEditors=${result.refreshedEmbeddedEditors}`,
			`skippedEmbeddedEditors=${result.skippedEmbeddedEditors}`,
			`fallbackReason=${scope.fallbackReason ?? 'none'}`,
		];
	}

	private recordRefreshViewsPerfStage(
		timings: RefreshViewsStageTiming[] | null,
		context: RefreshViewsPerfContext | null | undefined,
		stage: string,
		startedAt: number,
		...details: string[]
	): void {
		if (!context || !timings) return;
		const stageMs = this.logRefreshViewsPerfStage(context, stage, startedAt, ...details);
		timings.push({ stage, stageMs });
	}

	private logRefreshViewsPerfStage(
		context: RefreshViewsPerfContext | null | undefined,
		stage: string,
		startedAt: number,
		...details: string[]
	): number {
		if (!context) return 0;
		const stageMs = Math.round(enginePerfNow() - startedAt);
		enginePerfLog(
			'refresh.views',
			...this.getRefreshViewsPerfMetadata(context),
			`stage=${stage}`,
			`stageMs=${stageMs}`,
			...details,
		);
		return stageMs;
	}

	private logRefreshViewsPerfSummary(
		context: RefreshViewsPerfContext,
		pass: 'primary' | 'followup',
		totalMs: number,
		rafWaitMs: number,
		stageTimings: RefreshViewsStageTiming[],
	): void {
		const topStage = stageTimings.reduce<RefreshViewsStageTiming | null>((currentTop, timing) => {
			if (!currentTop || timing.stageMs > currentTop.stageMs) return timing;
			return currentTop;
		}, null);
		const topStageName = topStage?.stage ?? 'none';
		const topStageMs = topStage?.stageMs ?? 0;
		const slow = totalMs >= 50 || topStageMs >= 25 || rafWaitMs >= 100;
		enginePerfLog(
			'refresh.views',
			...this.getRefreshViewsPerfMetadata(context),
			'stage=summary',
			`pass=${pass}`,
			`totalMs=${totalMs}`,
			`slow=${String(slow)}`,
			`topStage=${topStageName}`,
			`topStageMs=${topStageMs}`,
			`rafWaitMs=${rafWaitMs}`,
			`stageBreakdown=${this.formatRefreshViewsStageBreakdown(stageTimings)}`,
		);
	}

	private formatRefreshViewsStageBreakdown(stageTimings: RefreshViewsStageTiming[]): string {
		if (stageTimings.length === 0) return 'none';
		return stageTimings
			.map(timing => `${timing.stage}:${timing.stageMs}`)
			.join('|');
	}

	private logRefreshViewsPerfRequest(
		context: RefreshViewsPerfContext | null | undefined,
		framePending: boolean,
	): void {
		if (!context) return;
		enginePerfLog(
			'refresh.views',
			...this.getRefreshViewsPerfMetadata(context),
			'stage=request',
			`framePending=${String(framePending)}`,
		);
	}

	/**
	 * Advance a task's workflow status in pipeline order.
	 * Used by Filter/Reading/View icons and Live Preview status icon/chip.
	 */
	async cycleTaskStatusById(operonId: string): Promise<void> {
		const shouldTraceStatusCycle = isOperonEnginePerfDebugEnabled();
		const statusCycleStartedAt = shouldTraceStatusCycle ? enginePerfNow() : 0;
		if (this.redirectDuplicateOperonIdAction(operonId)) return;
		const indexed = this.indexer.getTask(operonId);
		if (!indexed) return;
		const statusCycleTrace = this.createStatusCyclePerfTrace(indexed, statusCycleStartedAt);

		const currentStatus = indexed.fieldValues['status'];
		const nextWorkflow = getNextWorkflowStatus(this.settings.pipelines, currentStatus);
		if (!nextWorkflow) return;
		const now = localNow();
			const today = now.substring(0, 10);
			const primary = indexed.primary;
			const fieldValues = this.buildStatusCycleFieldPayload(indexed, nextWorkflow, now, today);
			if (!await this.guardTaskStatusChangeOrShow(indexed, fieldValues)) {
				this.logStatusCyclePerfTotal(statusCycleTrace);
				return;
			}

			const buildResolveDetails = (
			stoppedTimer: boolean,
			timerStopMode: 'coalesced' | 'legacy' | 'none',
			timerPayloadKeys: string[],
		): string[] => [
			`nextStatus=${nextWorkflow.value}`,
			`nextCheckbox=${nextWorkflow.checkbox}`,
			`timerStopped=${String(stoppedTimer)}`,
			`timerStopMode=${timerStopMode}`,
			`timerPayloadKeys=${timerPayloadKeys.length > 0 ? timerPayloadKeys.join(',') : 'none'}`,
		];
		const runStatusCycleUpdate = async (
			payload: Record<string, string>,
			resolveDetails: string[],
		): Promise<boolean> => {
			if (primary.format === 'yaml') {
				this.setStatusCyclePerfChangedKeys(statusCycleTrace, Object.keys(payload));
				this.logStatusCyclePerfStage(statusCycleTrace, 'resolve', statusCycleStartedAt, ...resolveDetails);
				const writeUpdateStartedAt = statusCycleTrace ? enginePerfNow() : 0;
				try {
					return await this.updateTaskFieldsAndRefresh(operonId, payload, {
						statusCycleTrace,
						refreshReason: 'status-cycle',
					});
				} finally {
					this.logStatusCyclePerfStage(statusCycleTrace, 'write-update', writeUpdateStartedAt);
				}
			}

			if (primary.lineNumber === undefined) return false;

			const file = this.app.vault.getAbstractFileByPath(primary.filePath);
			if (!(file instanceof TFile)) return false;

			const inlinePrepStartedAt = statusCycleTrace ? enginePerfNow() : 0;
			this.setStatusCyclePerfChangedKeys(statusCycleTrace, Object.keys(payload));
			this.logStatusCyclePerfStage(statusCycleTrace, 'resolve', statusCycleStartedAt, ...resolveDetails);
			this.logStatusCyclePerfStage(statusCycleTrace, 'inline-prep', inlinePrepStartedAt, 'fastPath=indexed-payload');
			const writeUpdateStartedAt = statusCycleTrace ? enginePerfNow() : 0;
			try {
				return await this.updateTaskFieldsAndRefresh(indexed.operonId, payload, {
					statusCycleTrace,
					refreshReason: 'status-cycle',
				});
			} finally {
				this.logStatusCyclePerfStage(statusCycleTrace, 'write-update', writeUpdateStartedAt);
			}
		};
		const assertStatusCycleUpdateSucceeded = (succeeded: boolean, reason: string): void => {
			if (succeeded) return;
			this.logStatusCyclePerfTotal(statusCycleTrace);
			throw new Error(`Operon status cycle failed: ${reason} (${operonId})`);
		};

		if (nextWorkflow.checkbox !== 'open' && this.timeTracker.isTimerRunning(operonId)) {
			let attemptedCoalescedStop = false;
			let coalescedWriteSucceeded = false;
			let coalescedTimerPayloadKeys: string[] = [];
			await this.timeTracker.stopActiveWithExternalTaskMutation(operonId, now, async (timerPayload) => {
				attemptedCoalescedStop = true;
				coalescedTimerPayloadKeys = Object.keys(timerPayload);
				coalescedWriteSucceeded = await runStatusCycleUpdate(
					{ ...timerPayload, ...fieldValues },
					buildResolveDetails(true, 'coalesced', coalescedTimerPayloadKeys),
				);
				return coalescedWriteSucceeded;
			});
			if (attemptedCoalescedStop) {
				assertStatusCycleUpdateSucceeded(coalescedWriteSucceeded, 'coalesced timer status write failed');
				this.logStatusCyclePerfTotal(statusCycleTrace);
				return;
			}

			const stoppedTimer = await this.stopActiveTimer('terminal-status');
			const legacySucceeded = await runStatusCycleUpdate(fieldValues, buildResolveDetails(stoppedTimer, 'legacy', []));
			assertStatusCycleUpdateSucceeded(legacySucceeded, 'legacy timer status write failed');
			this.logStatusCyclePerfTotal(statusCycleTrace);
			return;
		}

		const succeeded = await runStatusCycleUpdate(fieldValues, buildResolveDetails(false, 'none', []));
		assertStatusCycleUpdateSucceeded(succeeded, 'status write failed');
		this.logStatusCyclePerfTotal(statusCycleTrace);
	}

	/**
	 * Toggle the checkbox of a task identified by operonId.
	 * Reads the task's primary file location, modifies the line, and writes it back.
	 * Used by the Filter View where no editor view is active.
	 */
	async toggleTaskById(operonId: string): Promise<void> {
		if (this.redirectDuplicateOperonIdAction(operonId)) return;
		const indexed = this.indexer.getTask(operonId);
		if (!indexed) return;

		const primary = indexed.primary;
		if (!primary) return;

		const now = localNow();
		const today = now.substring(0, 10);

		// ─── YAML file tasks: use TaskWriter (preserves property order) ───
		if (primary.format === 'yaml') {
				const fieldValues: Record<string, string> = {};

					const statusVal = indexed.fieldValues['status'] ?? '';
					const toggleResolution = getCheckboxToggleWorkflowStatus(this.settings.pipelines, statusVal, indexed.checkbox);
				if (statusVal && toggleResolution.workflow) {
					fieldValues['status'] = toggleResolution.workflow.value;
				}
				this.applyCheckboxStateToFieldPayload(fieldValues, toggleResolution.checkbox, today, indexed.fieldValues);

				fieldValues['datetimeModified'] = now;
				if (!await this.guardTaskStatusChangeOrShow(indexed, fieldValues)) return;
				if (toggleResolution.checkbox !== 'open' && this.timeTracker.isTimerRunning(operonId)) {
					await this.stopActiveTimer('terminal-status');
				}
				await this.updateTaskFieldsAndRefresh(operonId, fieldValues);
				return;
			}

		// ─── Inline tasks: parse line, mutate, serialize ───
		if (primary.lineNumber === undefined) return;

		const file = this.app.vault.getAbstractFileByPath(primary.filePath);
		if (!(file instanceof TFile)) return;

		const content = await this.app.vault.read(file);
		const lines = content.split('\n');
		const lineIndex = primary.lineNumber;
		if (lineIndex < 0 || lineIndex >= lines.length) return;

		const line = lines[lineIndex];
		const parsed = this.parseInlineTaskLine(line, lineIndex, primary.filePath);
		if (!parsed) return;

				const statusField = parsed.fields.find(f => f.key === 'status');
				const toggleResolution = getCheckboxToggleWorkflowStatus(this.settings.pipelines, statusField?.value, indexed.checkbox);

			if (statusField && toggleResolution.workflow) {
				statusField.value = toggleResolution.workflow.value;
			statusField.rawValue = toggleResolution.workflow.value;
		}
		this.applyCheckboxStateToParsedTask(parsed, toggleResolution.checkbox, today);

			this.touchParsedTaskModifiedTimestamp(parsed, now);

			if (!parsed.operonId) return;
			const payload = this.buildFieldPayload(parsed);
			if (!await this.guardTaskStatusChangeOrShow(indexed, payload, { mode: 'replace' })) return;
			if (toggleResolution.checkbox !== 'open' && this.timeTracker.isTimerRunning(operonId)) {
				await this.stopActiveTimer('terminal-status');
			}
			await this.updateTaskFieldsAndRefresh(parsed.operonId, payload, { mode: 'replace' });
		}

	private buildFieldPayload(task: ParsedTask): Record<string, string> {
		const payload: Record<string, string> = {};
		for (const field of task.fields) {
			if (field.key === 'pinned') continue;
			payload[field.key] = field.value;
		}
		payload['_description'] = task.description;
		payload['_tags'] = task.tags.join(';');
		payload['_checkbox'] = task.checkbox;
		return payload;
	}

	private buildStatusCycleFieldPayload(
		task: IndexedTask,
		nextWorkflow: WorkflowStatusResolution,
		now: string,
		today: string,
	): Record<string, string> {
		const fieldValues: Record<string, string> = {
			status: nextWorkflow.value,
			datetimeModified: now,
		};
		this.applyCheckboxStateToFieldPayload(fieldValues, nextWorkflow.checkbox, today, task.fieldValues);
		return fieldValues;
	}

	private applyCheckboxStateToFieldPayload(
		fieldValues: Record<string, string>,
		checkbox: 'open' | 'done' | 'cancelled',
		today: string,
		existingValues: Record<string, string>,
	): void {
		fieldValues['_checkbox'] = checkbox;
		if (checkbox === 'done') {
			fieldValues['dateCompleted'] = existingValues['dateCompleted'] || today;
			fieldValues['dateCancelled'] = '';
		} else if (checkbox === 'cancelled') {
			fieldValues['dateCancelled'] = existingValues['dateCancelled'] || today;
			fieldValues['dateCompleted'] = '';
		} else {
			fieldValues['dateCompleted'] = '';
			fieldValues['dateCancelled'] = '';
		}
	}

	private applyCheckboxStateToParsedTask(
		task: ParsedTask,
		checkbox: 'open' | 'done' | 'cancelled',
		today: string,
	): void {
		task.checkbox = checkbox;
		const upsertDate = (key: 'dateCompleted' | 'dateCancelled') => {
			const existing = task.fields.find(f => f.key === key);
			if (existing) {
				if (!existing.value) {
					existing.value = today;
					existing.rawValue = today;
				}
			} else {
				task.fields.push(this.createInlineField(key, today, 'date'));
			}
		};

		if (checkbox === 'done') {
			upsertDate('dateCompleted');
			task.fields = task.fields.filter(f => f.key !== 'dateCancelled');
		} else if (checkbox === 'cancelled') {
			upsertDate('dateCancelled');
			task.fields = task.fields.filter(f => f.key !== 'dateCompleted');
		} else {
			task.fields = task.fields.filter(f => f.key !== 'dateCompleted' && f.key !== 'dateCancelled');
		}
	}

	private maybeApplyScheduledAutomationToFieldPayload(
		task: IndexedTask,
		payload: Record<string, string>,
	): void {
		const nextDateScheduled = payload['dateScheduled'];
		if (!shouldTriggerOneShotAutomation(task.fieldValues['dateScheduled'], nextDateScheduled)) return;
		if (task.checkbox !== 'open') return;

		const workflow = resolveAutomationWorkflowStatus(
			this.settings.pipelines,
			payload['status'] ?? task.fieldValues['status'],
			this.settings.defaultPipelineName,
			'scheduled',
		);
		if (!workflow) return;

		payload['status'] = workflow.value;
	}

	private maybeApplyScheduledAutomationToParsedTask(
		task: ParsedTask,
		previousFieldValues: Record<string, string>,
	): void {
		const nextDateScheduled = task.fields.find(field => field.key === 'dateScheduled')?.value;
		if (!shouldTriggerOneShotAutomation(previousFieldValues['dateScheduled'], nextDateScheduled)) return;
		if (task.checkbox !== 'open') return;

		const currentStatus = task.fields.find(field => field.key === 'status')?.value;
		const workflow = resolveAutomationWorkflowStatus(
			this.settings.pipelines,
			currentStatus,
			this.settings.defaultPipelineName,
			'scheduled',
		);
		if (!workflow) return;

		this.setParsedTaskField(task, 'status', workflow.value, 'text');
		task.checkbox = workflow.checkbox;
	}

	private buildNormalizedTaskFieldUpdate(
		task: IndexedTask,
		key: string,
		value: string,
	): Record<string, string> | null {
		if (key !== 'dateCompleted' && key !== 'dateCancelled') {
			return this.applyFieldRulesToTaskPayload(task, { [key]: value }, [key]);
		}

		const resolution = resolveReverseWorkflowFromTerminalDate(
			this.settings.pipelines,
			task.fieldValues['status'],
			this.settings.defaultPipelineName,
			key,
			value,
		);
		if (!resolution.isValid || !resolution.workflow) {
			new Notice(resolution.errorMessage ?? t('notifications', 'terminalDateWorkflowResolveFailed'));
			return null;
		}

		const payload: Record<string, string> = {
			status: resolution.workflow.value,
			_checkbox: resolution.checkbox,
		};
		payload['dateCompleted'] = key === 'dateCompleted' && value ? value : '';
		payload['dateCancelled'] = key === 'dateCancelled' && value ? value : '';
		return payload;
	}

	private buildTerminalDateRemovalNormalization(
		task: IndexedTask,
		removedKey: 'dateCompleted' | 'dateCancelled',
	): Record<string, string> | null {
		const statusValue = task.fieldValues['status'];
		if (!statusValue) return null;

		const resolution = resolveReverseWorkflowFromTerminalDate(
			this.settings.pipelines,
			statusValue,
			this.settings.defaultPipelineName,
			removedKey,
			'',
		);
		if (!resolution.isValid || !resolution.workflow) {
			new Notice(resolution.errorMessage ?? t('notifications', 'terminalDateReopenFailed'));
			return null;
		}

		return {
			status: resolution.workflow.value,
			_checkbox: resolution.checkbox,
			dateCompleted: '',
			dateCancelled: '',
		};
	}

	private markInternalTaskWrite(filePath: string): void {
		if (!filePath) return;
		this.internalTaskWriteSuppressUntilByPath.set(filePath, Date.now() + INTERNAL_TASK_WRITE_SUPPRESSION_MS);
	}

	private shouldSuppressInternalTaskWrite(filePath: string): boolean {
		const until = this.internalTaskWriteSuppressUntilByPath.get(filePath);
		if (!until) return false;
		if (until < Date.now()) {
			this.internalTaskWriteSuppressUntilByPath.delete(filePath);
			return false;
		}
		return true;
	}

	private applyFieldRulesToTaskPayload(
		task: IndexedTask,
		payload: Record<string, string>,
		changedKeys: string[],
	): Record<string, string> {
		const normalizedPayload = applyFieldRules({
			current: task.fieldValues,
			patch: { ...payload },
			changedKeys,
		}).patch;
		if (Object.prototype.hasOwnProperty.call(normalizedPayload, 'dateScheduled')) {
			this.maybeApplyScheduledAutomationToFieldPayload(task, normalizedPayload);
		}
		return normalizedPayload;
	}

	private applyReverseWorkflowUpdateToParsedTask(
		task: ParsedTask,
		key: 'dateCompleted' | 'dateCancelled',
		value: string,
	): boolean {
		const currentStatus = task.fields.find(field => field.key === 'status')?.value;
		const resolution = resolveReverseWorkflowFromTerminalDate(
			this.settings.pipelines,
			currentStatus,
			this.settings.defaultPipelineName,
			key,
			value,
		);
		if (!resolution.isValid || !resolution.workflow) {
			new Notice(resolution.errorMessage ?? t('notifications', 'terminalDateWorkflowResolveFailed'));
			return false;
		}

		const upsertField = (fieldKey: string, nextValue: string, type: OperonField['type']) => {
			const existing = task.fields.find(field => field.key === fieldKey);
			if (!nextValue) {
				task.fields = task.fields.filter(field => field.key !== fieldKey);
				return;
			}
			if (existing) {
				existing.value = nextValue;
				existing.rawValue = nextValue;
				return;
			}
			task.fields.push(this.createInlineField(fieldKey, nextValue, type));
		};

		upsertField('status', resolution.workflow.value, 'text');
		upsertField('dateCompleted', key === 'dateCompleted' ? value : '', 'date');
		upsertField('dateCancelled', key === 'dateCancelled' ? value : '', 'date');
		task.checkbox = resolution.checkbox;
		return true;
	}

	private async normalizeWorkflowStateAfterRawEdit(filePath: string): Promise<void> {
		if (this.workflowNormalizationInProgress.has(filePath)) {
			this.workflowNormalizationPending.add(filePath);
			return;
		}

		this.workflowNormalizationInProgress.add(filePath);
		try {
			do {
				this.workflowNormalizationPending.delete(filePath);
				await this.normalizeWorkflowStateAfterRawEditPass(filePath);
			} while (this.workflowNormalizationPending.delete(filePath));
		} finally {
			const renamedFilePath = this.workflowNormalizationRenameTargets.get(filePath);
			this.workflowNormalizationRenameTargets.delete(filePath);
			this.indexer.scheduleReindex(renamedFilePath ?? filePath);
			this.workflowNormalizationInProgress.delete(filePath);
			if (renamedFilePath) {
				this.workflowNormalizationPending.delete(filePath);
				void this.normalizeWorkflowStateAfterRawEdit(renamedFilePath);
			} else if (this.workflowNormalizationPending.delete(filePath)) {
				void this.normalizeWorkflowStateAfterRawEdit(filePath);
			}
		}
	}

	private async normalizeWorkflowStateAfterRawEditPass(filePath: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile) || file.extension !== 'md') return;
		if (isOperonExcludedPath(file.path, this.settings)) {
			this.indexer.scheduleReindex(file.path);
			return;
		}

		const rawContent = await this.app.vault.cachedRead(file);
		if (this.workflowNormalizationRenameTargets.has(filePath)) return;
		const resolvesTemplatedFileTask = this.isTemplatedFileTaskCreationCandidate(filePath)
			&& this.hasTemplatedFileTaskIdentity(rawContent);
		const resolvedContent = resolvesTemplatedFileTask
			? this.resolveTemplatedFileTaskContent(rawContent, file.basename, localNow())
			: this.resolveOperonIdPlaceholdersInContent(rawContent, {
				resolveRawDateTime: true,
			});
		if (resolvedContent !== rawContent) {
			const latestContent = await this.app.vault.cachedRead(file);
			if (this.workflowNormalizationRenameTargets.has(filePath)) return;
			if (latestContent !== rawContent) {
				this.workflowNormalizationPending.add(filePath);
				return;
			}
			await this.app.vault.modify(file, resolvedContent);
		}

		const indexedTasks = this.indexer.getAllTasks().filter(task => task.primary.filePath === filePath);
		if (indexedTasks.length === 0) {
			this.indexer.scheduleReindex(filePath);
			return;
		}

		const scan = await scanFileWithMappings(this.app, file, this.settings.keyMappings);
		const currentById = new Map<string, Record<string, string>>();
		for (const inlineTask of scan.inlineTasks) {
			if (!inlineTask.operonId) continue;
			currentById.set(
				inlineTask.operonId,
				Object.fromEntries(inlineTask.fields.map(field => [field.key, field.value])),
			);
		}
		if (scan.yamlTask?.operonId) {
			currentById.set(scan.yamlTask.operonId, { ...scan.yamlTask.fieldValues });
		}

		type NormalizationEntry = {
			task: IndexedTask;
			payload: Record<string, string>;
		};
		const pending: NormalizationEntry[] = [];

		for (const task of indexedTasks) {
				const currentFieldValues = currentById.get(task.operonId);
				if (!currentFieldValues) continue;

				for (const removedKey of ['dateCompleted', 'dateCancelled'] as const) {
					const previousValue = (task.fieldValues[removedKey] ?? '').trim();
					const currentValue = (currentFieldValues[removedKey] ?? '').trim();
					if (!previousValue || currentValue) continue;

					const currentStatus = currentFieldValues['status'] ?? task.fieldValues['status'];
					const resolved = currentStatus
						? resolveReverseWorkflowFromTerminalDate(
							this.settings.pipelines,
							currentStatus,
							this.settings.defaultPipelineName,
							removedKey,
							previousValue,
						)
						: null;
					if (!resolved?.workflow) continue;
					if ((currentFieldValues['status'] ?? task.fieldValues['status']) !== resolved.workflow.value) continue;

					const payload = this.buildTerminalDateRemovalNormalization(task, removedKey);
					if (!payload) continue;
					pending.push({ task, payload });
					break;
				}

				const candidateRepeat = (currentFieldValues['repeat'] ?? task.fieldValues['repeat'] ?? '').trim();
				const rule = parseRepeatRule(candidateRepeat);
				if (!rule || rule.mode !== 'count' || !rule.count) continue;
				const currentScheduled = (currentFieldValues['dateScheduled'] ?? task.fieldValues['dateScheduled'] ?? '').trim();
				if (!currentScheduled) continue;
				const seriesId = (currentFieldValues['repeatSeriesId'] ?? task.fieldValues['repeatSeriesId'] ?? '').trim();
				const nextEndDate = calculateRepeatEndFromCount(
					rule,
					currentScheduled,
					rule.count,
					this.storage.repeatSeries.getSkipDates(seriesId),
				);
				if (!nextEndDate) continue;
				const nextEndValue = `${nextEndDate}T23:59:59`;
				if ((currentFieldValues['datetimeRepeatEnd'] ?? '').trim() === nextEndValue) continue;
				pending.push({
					task,
					payload: {
						datetimeRepeatEnd: nextEndValue,
					},
				});
		}

		if (pending.length > 0) {
			for (const entry of pending) {
				await this.writer.writeTaskFields(entry.task.operonId, entry.payload, { reindex: 'none' });
			}
			this.refreshViews();
		}
	}

	private sanitizeTaskFileName(name: string): string {
		return name
			.replace(/[\\/:*?"<>|]/g, '')
			.replace(/\s+/g, ' ')
			.trim()
			.substring(0, 100);
	}

	private getYamlTaskByFilePath(filePath: string): IndexedTask | null {
		return this.indexer.getAllTasks().find(task =>
			task.primary.format === 'yaml'
			&& task.primary.filePath === filePath
		) ?? null;
	}

	private async loadParsedFrontmatterDocument(file: TFile): Promise<ParsedFrontmatterDocument> {
		const content = await this.app.vault.cachedRead(file);
		return parseFrontmatterDocument(content, this.settings.keyMappings);
	}

	private getFrontmatterLineCount(content: string): number {
		const { frontmatter } = splitFrontmatterDocument(content);
		if (frontmatter == null) return 0;
		return frontmatter.split(/\r?\n/).length + 2;
	}

	private buildYamlTaskEditorFileBodyContext(
		filePath: string,
		document: ParsedFrontmatterDocument,
		content: string,
	): TaskEditorFileBodyContext {
		return {
			filePath,
			initialContent: document.body,
			format: 'yaml',
			targetLine: null,
			cursorOffset: 0,
			lineNumberOffset: this.getFrontmatterLineCount(content),
		};
	}

	private buildInlineTaskEditorFileBodyContext(
		filePath: string,
		content: string,
		lineNumber: number,
	): TaskEditorFileBodyContext {
		const { body } = splitFrontmatterDocument(content);
		const frontmatterLineCount = this.getFrontmatterLineCount(content);
		const bodyLines = body.split('\n');
		let safeLineNumber = Math.max(0, lineNumber - frontmatterLineCount);
		safeLineNumber = Math.min(safeLineNumber, Math.max(bodyLines.length - 1, 0));
		let cursorOffset = 0;
		for (let i = 0; i < safeLineNumber; i++) {
			cursorOffset += (bodyLines[i] ?? '').length + 1;
		}
		if (!Number.isFinite(cursorOffset)) {
			safeLineNumber = 0;
			cursorOffset = 0;
		}

		return {
			filePath,
			initialContent: body,
			format: 'inline',
			targetLine: safeLineNumber,
			cursorOffset,
			lineNumberOffset: frontmatterLineCount,
		};
	}

	private async resolveTaskEditorFileBodyOption(
		task: ParsedTask | null,
		options: TaskEditorContentOptions,
	): Promise<TaskEditorContentOptions> {
		if (options.fileBody !== undefined) {
			return options;
		}

		const operonId = task?.operonId?.trim();
		const indexedTask = operonId ? this.indexer.getTask(operonId) : null;
		let fileBody: TaskEditorFileBodyContext | null = null;
		if (indexedTask?.primary.format === 'yaml') {
			const file = this.app.vault.getAbstractFileByPath(indexedTask.primary.filePath);
			if (!(file instanceof TFile)) {
				return options;
			}
			const content = await this.app.vault.cachedRead(file);
			const document = await this.loadParsedFrontmatterDocument(file);
			fileBody = this.buildYamlTaskEditorFileBodyContext(file.path, document, content);
		} else if (indexedTask?.primary.format === 'inline') {
			const file = this.app.vault.getAbstractFileByPath(indexedTask.primary.filePath);
			if (!(file instanceof TFile)) {
				return options;
			}
			const content = await this.app.vault.cachedRead(file);
			fileBody = this.buildInlineTaskEditorFileBodyContext(
				file.path,
				content,
				indexedTask.primary.lineNumber,
			);
		} else if (task?.filePath?.trim()) {
			const file = this.app.vault.getAbstractFileByPath(task.filePath.trim());
			if (file instanceof TFile) {
				const content = await this.app.vault.cachedRead(file);
				fileBody = this.buildInlineTaskEditorFileBodyContext(
					file.path,
					content,
					task.lineNumber,
				);
			}
		}

		if (!fileBody) {
			return options;
		}

		return {
			...options,
			fileBody,
		};
	}

	private async writeFileTaskBodyIfNeeded(file: TFile, bodyRequest: TaskEditorSaveRequest['fileBody']): Promise<boolean> {
		if (!bodyRequest?.dirty) return true;

		const content = await this.app.vault.cachedRead(file);
		const { frontmatter, body } = splitFrontmatterDocument(content);
		if (body === bodyRequest.content) return true;

		const nextContent = frontmatter == null
			? bodyRequest.content
			: `---\n${frontmatter}\n---\n${bodyRequest.content}`;
		this.markInternalTaskWrite(file.path);
		await this.app.vault.modify(file, nextContent);
		return true;
	}

	private buildParsedTaskFieldValues(task: ParsedTask): Record<string, string> {
		const fieldValues: Record<string, string> = {};
		for (const field of task.fields) {
			if (field.key === 'pinned') continue;
			fieldValues[field.key] = field.value;
		}
		return fieldValues;
	}

	private buildParsedYamlTask(
		filePath: string,
		description: string,
		fieldValues: Record<string, string>,
		tags: string[],
	): ParsedTask {
		const statusValue = fieldValues['status'];
		const workflowState = resolveWorkflowStatus(this.settings.pipelines, statusValue);
		let checkbox: ParsedTask['checkbox'] = 'open';
		if (workflowState?.checkbox === 'done' || workflowState?.checkbox === 'cancelled') {
			checkbox = workflowState.checkbox;
		} else if (fieldValues['dateCancelled']) {
			checkbox = 'cancelled';
		} else if (fieldValues['dateCompleted']) {
			checkbox = 'done';
		}

		const fields: OperonField[] = Object.entries(fieldValues)
			.filter(([key]) => key !== 'pinned')
			.map(([key, value]) => ({
				sourceKey: this.getInlineWriteKeyName(key),
				key,
				value,
				rawValue: value,
				type: this.getInlineFieldTypeForKey(key),
				isCanonical: CANONICAL_KEY_MAP.has(key),
				containerRange: { from: 0, to: 0 },
				valueRange: { from: 0, to: 0 },
			}));

		return {
			lineNumber: 0,
			filePath,
			checkbox,
			checkboxRange: { from: 0, to: 0 },
			timePrefix: null,
			timePrefixRange: null,
			description,
			descriptionRange: { from: 0, to: 0 },
			tags: [...tags],
			tagTokens: [],
			fields,
			metadataTailRange: null,
			operonId: fieldValues['operonId'] ?? null,
			rawLine: '',
		};
	}

	private overlayParsedTaskFields(
		task: ParsedTask,
		fieldValues: Record<string, string>,
		tags: string[],
		description: string,
	): ParsedTask {
		const parsed = {
			...task,
			description,
			tags: task.tags.length > 0 ? [...task.tags] : [...tags],
			fields: [...task.fields],
		};

		for (const [key, value] of Object.entries(fieldValues)) {
			if (key === 'pinned') continue;
			const existing = parsed.fields.find(field => field.key === key);
			if (existing) {
				if (!existing.value && value) {
					existing.value = value;
					existing.rawValue = value;
				}
				continue;
			}
			parsed.fields.push(this.createInlineField(
				key,
				value,
				this.getInlineFieldTypeForKey(key),
			));
		}

		parsed.operonId = fieldValues['operonId'] ?? parsed.operonId;
		return parsed;
	}

	private async openIndexedTaskEditor(task: IndexedTask): Promise<void> {
		const parsed = await this.loadEditableParsedTask(task);
		await this.openTaskEditorFor(parsed, async (request) => {
			const saved = await this.applyEditedTaskFromView(task, request);
			if (saved === false) {
				new Notice(t('notifications', 'taskSaveFailed'));
			}
			return saved;
		});
	}

	private async openInlineTaskEditorFromParsedTask(
		task: ParsedTask,
		editor: Editor,
		filePath: string,
		options: TaskEditorContentOptions = {},
	): Promise<void> {
		await this.openTaskEditorFor(task, async (request) => {
			editor.setLine(task.lineNumber, request.taskLine);
			this.placeCursorAfterInlineTaskDescription(editor, filePath, task.lineNumber, request.taskLine);
			await this.persistInlineEditorBufferAndReindex(filePath);
			return true;
		}, options);
	}

	private async persistInlineEditorBufferAndReindex(filePath: string): Promise<void> {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView?.file?.path === filePath) {
			await this.persistMarkdownViewBuffer(activeView);
		}
		await this.indexer.reindexFilePath(filePath);
	}

	private async persistMarkdownViewBuffer(view: MarkdownView): Promise<void> {
		const savableView = view as MarkdownView & { save?: () => Promise<void> | void };
		if (typeof savableView.save === 'function') {
			await savableView.save();
		}
	}

	private async promptConfirmAction(
		title: string,
		message: string,
		confirmText: string,
		cancelText: string,
	): Promise<boolean> {
		return await new Promise(resolve => {
			new ConfirmActionModal(this.app, {
				title,
				message,
				confirmText,
				cancelText,
			}, resolve).open();
		});
	}

	private async applyEstimateReallocationFromEditor(
		request: TaskEditorEstimateReallocationRequest,
	): Promise<TaskEditorEstimateReallocationApplyResult> {
		const childTask = this.indexer.getTask(request.childOperonId);
		if (!childTask) return { complete: false, committedSubtractSeconds: 0 };

		const writeResult = await applyManualEstimateReallocationWrites({
			childTask,
			...request,
		}, {
			getTaskById: operonId => this.indexer.getTask(operonId) ?? null,
			validateTaskSource: async (currentTask, expectedEstimate) => await this.writer.taskFieldsMatchCurrentSource(
				currentTask.operonId,
				{
					estimate: expectedEstimate,
					parentTask: currentTask.fieldValues['parentTask'] ?? '',
				},
			),
			writeEstimate: async (operonId, expectedEstimate, nextEstimate, expectedParentTask) => await this.writer.writeTaskFieldIfCurrent(
				operonId,
				'estimate',
				expectedEstimate,
				nextEstimate,
				{
					reindex: 'none',
					additionalExpectedValues: { parentTask: expectedParentTask },
				},
			),
			resolveWriteError: async write => await this.writer.taskFieldsMatchCurrentSource(
				write.beforeTask.operonId,
				{
					estimate: write.nextEstimate,
					parentTask: write.beforeTask.fieldValues['parentTask'] ?? '',
				},
			),
		});
		if (writeResult.error) {
			console.warn('Operon: estimate reallocation write failed after a partial commit', writeResult.error);
		}
		const plannedWrites = writeResult.committedWrites;
		let reconciliationComplete = plannedWrites.length === 0;

		if (plannedWrites.length > 0) {
			const touchedPaths = new Set(plannedWrites.map(write => write.beforeTask.primary.filePath));
			try {
				await this.indexer.reindexFilesBatch(Array.from(touchedPaths), { notify: false });
				const retryPaths = new Set(plannedWrites
					.filter(write => !this.estimateReallocationWriteMatchesIndex(
						write,
						this.indexer.getTask(write.beforeTask.operonId),
					))
					.map(write => write.beforeTask.primary.filePath));
				if (retryPaths.size > 0) {
					await this.indexer.reindexFilesBatch(Array.from(retryPaths), { notify: false });
				}
				const unreconciledWrites = plannedWrites.filter(write => !this.estimateReallocationWriteMatchesIndex(
					write,
					this.indexer.getTask(write.beforeTask.operonId),
				));
				if (unreconciledWrites.length > 0) {
					throw new Error(`Estimate reallocation could not reindex ${unreconciledWrites.length} committed writes`);
				}
				const mutations = plannedWrites.map(write => ({
					before: write.beforeTask,
					after: this.indexer.getTask(write.beforeTask.operonId) ?? null,
				}));
				// One batched refresh over all steps; per-step refreshes would
				// recompute and rewrite the same ancestor chain once per step.
				const refreshAggregates = async (): Promise<void> => {
					const result = await this.aggregateCoordinator.refreshAfterTaskMutations(mutations);
					if (result.failedWriteCount > 0) {
						throw new Error(`Estimate reallocation aggregate refresh reported ${result.failedWriteCount} failed writes`);
					}
				};
				let aggregateRefreshComplete = false;
				try {
					await refreshAggregates();
					aggregateRefreshComplete = true;
				} catch (error) {
					console.warn('Operon: estimate reallocation aggregate refresh failed; retrying once', error);
					try {
						await refreshAggregates();
						aggregateRefreshComplete = true;
					} catch (retryError) {
						console.warn('Operon: estimate reallocation aggregate refresh retry failed', retryError);
					}
				}
				// The old per-step helper also ran these mutation side effects. Restore
				// them without repeating the aggregate calculation or reindex pass.
				for (const mutation of mutations) {
					this.fileTaskArchiver?.scheduleForIndexedChange(mutation.before, mutation.after);
					try {
						await this.tryAutoUnpinTerminalTaskIfNeeded(mutation.after);
					} catch (error) {
						console.warn('Operon: estimate reallocation auto-unpin failed', error);
					}
				}
				reconciliationComplete = aggregateRefreshComplete;
			} catch (error) {
				console.warn('Operon: estimate reallocation post-commit reconciliation failed', error);
			} finally {
				// The reindex ran with notify off, so this is the chain's only view refresh.
				this.refreshViews({ reason: 'estimate-reallocation' });
			}
		}

		return {
			complete: writeResult.complete && reconciliationComplete,
			committedSubtractSeconds: writeResult.committedSubtractSeconds,
		};
	}

	private estimateReallocationWriteMatchesIndex(
		write: { beforeTask: IndexedTask; nextEstimate: string },
		indexed: IndexedTask | null | undefined,
	): boolean {
		if (!indexed) return false;
		const parseEstimate = (value: string): number => Math.max(0, parseInt(value || '0', 10) || 0);
		return parseEstimate(indexed.fieldValues['estimate'] ?? '') === parseEstimate(write.nextEstimate)
			&& (indexed.fieldValues['parentTask'] ?? '') === (write.beforeTask.fieldValues['parentTask'] ?? '');
	}

	private applyFieldPayloadToParsedTask(
		task: ParsedTask,
		payload: Record<string, string>,
		currentFieldValues: Record<string, string>,
	): boolean {
		for (const [canonicalKey, normalizedValue] of Object.entries(payload)) {
			if (canonicalKey === 'tags') {
				task.tags = normalizedValue
					.split(';')
					.map(item => item.replace(/^#/, '').trim())
					.filter(Boolean);
				task.tags = Array.from(new Set(task.tags));
				continue;
			}

			if (canonicalKey === 'dateCompleted' || canonicalKey === 'dateCancelled') {
				if (!this.applyReverseWorkflowUpdateToParsedTask(task, canonicalKey, normalizedValue)) {
					return false;
				}
				continue;
			}

			const existing = task.fields.find(field => field.key === canonicalKey);
			if (!normalizedValue.trim()) {
				task.fields = task.fields.filter(field => field.key !== canonicalKey);
			} else if (existing) {
				existing.value = normalizedValue;
				existing.rawValue = normalizedValue;
			} else {
				task.fields.push(this.createInlineField(
					canonicalKey,
					normalizedValue,
					this.getInlineFieldTypeForKey(canonicalKey),
				));
			}
			if (canonicalKey === 'dateScheduled') {
				this.maybeApplyScheduledAutomationToParsedTask(task, currentFieldValues);
			}
		}

		return true;
	}

	private async applyPipelineRenameMigration(preview: PipelineRenamePreview): Promise<void> {
		const oldSnapshot = this.getWorkflowTaxonomySnapshot();
		const renamedPipelineIndex = oldSnapshot.pipelines.findIndex(
			pipeline => pipeline.id === preview.plan.pipelineId,
		);
		if (renamedPipelineIndex < 0) {
			throw new Error('The pipeline changed after the rename preview was created.');
		}

		const newSnapshot: WorkflowFieldRenameTaxonomySnapshot = {
			pipelines: oldSnapshot.pipelines.map(pipeline => clonePipeline(pipeline)),
			defaultPipelineName: oldSnapshot.defaultPipelineName,
		};
		newSnapshot.pipelines[renamedPipelineIndex] = clonePipeline(preview.plan.newPipeline);

		const explicitDefaultMatches = oldSnapshot.pipelines.filter(
			pipeline => pipeline.name === oldSnapshot.defaultPipelineName,
		);
		if (explicitDefaultMatches.length > 1) {
			throw new Error(t('settings', 'pipelineRepairAmbiguousDefaultRequired'));
		}
		if (explicitDefaultMatches[0]?.id === preview.plan.pipelineId) {
			newSnapshot.defaultPipelineName = preview.plan.newPipeline.name;
		}

		await this.applyWorkflowFieldRenameTransaction({
			id: `workflow-${Date.now().toString(36)}-${preview.plan.pipelineId}`,
			oldSnapshot,
			newSnapshot,
			taskMappings: preview.affectedTasks.map(task => ({
				operonId: task.operonId,
				filePath: task.filePath,
				format: task.format,
				oldValue: task.oldStatusValue,
				newValue: task.newStatusValue,
			})),
		});
	}

	private async applyWorkflowFieldRenameTransaction(
		input: PrepareWorkflowFieldRenameInput,
	): Promise<void> {
		const result = await this.workflowFieldRenameCoordinator.prepareAndRun(input);
		this.finishWorkflowFieldRenameRun(result);
	}

	private getWorkflowTaxonomySnapshot(): WorkflowFieldRenameTaxonomySnapshot {
		return {
			pipelines: this.settings.pipelines.map(pipeline => clonePipeline(pipeline)),
			defaultPipelineName: this.settings.defaultPipelineName,
		};
	}

	private async commitWorkflowTaxonomySnapshot(
		snapshot: WorkflowFieldRenameTaxonomySnapshot,
	): Promise<void> {
		await this.storage.updateSettings({
			pipelines: snapshot.pipelines.map(pipeline => clonePipeline(pipeline)),
			defaultPipelineName: snapshot.defaultPipelineName,
		});
	}

	private finishWorkflowFieldRenameRun(result: WorkflowFieldRenameRunResult): void {
		if (result.status === 'idle') return;
		if (result.status === 'taxonomy-conflict') {
			new Notice(t('notifications', 'workflowRenameTaxonomyConflict'));
			this.refreshViews();
			return;
		}

		this.workflowStatusSemanticsSignature = buildWorkflowStatusSemanticsSignature(this.settings.pipelines);
		this.handleSettingsChanged();
		if (result.status === 'needs-retry') {
			new Notice(t('notifications', 'workflowRenameNeedsRetry', {
				failed: String(result.outcomes.failed),
			}));
			return;
		}

		new Notice(t('notifications', 'workflowRenameComplete', {
			updated: String(result.outcomes.updated + result.outcomes['already-updated']),
			conflicts: String(result.outcomes.conflict),
		}));
	}

	private async retryPendingWorkflowRename(): Promise<void> {
		const result = await this.workflowFieldRenameCoordinator.retry();
		if (result.status === 'idle') {
			new Notice(t('notifications', 'workflowRenameNoPending'));
			return;
		}
		this.finishWorkflowFieldRenameRun(result);
	}

	private async resolvePendingWorkflowRenameConflict(): Promise<void> {
		const operation = this.storage.fieldRenameJournal.get();
		if (!operation) {
			new Notice(t('notifications', 'workflowRenameNoPending'));
			return;
		}
		const current = this.getWorkflowTaxonomySnapshot();
		if (
			workflowTaxonomySnapshotsEqual(current, operation.oldSnapshot)
			|| workflowTaxonomySnapshotsEqual(current, operation.newSnapshot)
		) {
			await this.retryPendingWorkflowRename();
			return;
		}
		await this.commitWorkflowTaxonomySnapshot(operation.newSnapshot);
		await this.retryPendingWorkflowRename();
	}

	private async applyPriorityRenameMigration(preview: PriorityRenamePreview): Promise<PriorityRenameExecutionResult> {
		const progressModal = preview.totalTaskCount > 0
			? new FieldRenameProgressModal(this.app, this.createFieldRenameProgressSnapshot(preview), {
				title: t('taskEditor', 'applyingPriorityRenameMigration'),
				intro: t('taskEditor', 'priorityRenameMigrationIntro'),
				stopped: t('taskEditor', 'priorityRenameMigrationStopped'),
				fileTasks: t('taskEditor', 'renameMigrationFileTasks'),
				inlineTasks: t('taskEditor', 'renameMigrationInlineTasks'),
				files: t('taskEditor', 'renameMigrationFiles'),
				reindexing: t('taskEditor', 'priorityRenameMigrationReindexing'),
				finished: t('taskEditor', 'priorityRenameMigrationFinished'),
				finishedIntro: t('taskEditor', 'priorityRenameMigrationFinishedIntro'),
				updating: t('taskEditor', 'priorityRenameMigrationUpdating'),
			})
			: null;
		progressModal?.open();

		let result: PriorityRenameExecutionResult;
		try {
			result = await executePriorityRenamePreview(preview, {
				writer: this.writer,
				indexer: this.indexer,
				onProgress: snapshot => {
					progressModal?.update(snapshot);
				},
			});
		} catch (error) {
			progressModal?.markFatalError('Priority rename migration stopped with an unexpected error. You can close this window.');
			throw error;
		}

		if (preview.totalTaskCount === 0) {
			return result;
		}

		const updatedTotal = result.updatedFileTaskCount + result.updatedInlineTaskCount;
		const failedTotal = result.failedFileTaskCount + result.failedInlineTaskCount;
		if (failedTotal > 0) {
			new Notice(t('notifications', 'priorityRenameMigrationNoticeFailed', {
				fileTasks: String(result.updatedFileTaskCount),
				inlineTasks: String(result.updatedInlineTaskCount),
				failedFileTasks: String(result.failedFileTaskCount),
				failedInlineTasks: String(result.failedInlineTaskCount),
			}));
		} else {
			new Notice(t('notifications', 'priorityRenameMigrationNoticeSuccess', {
				fileTasks: String(result.updatedFileTaskCount),
				inlineTasks: String(result.updatedInlineTaskCount),
			}));
		}
		console.debug(
			'Operon: priority rename migration finished',
			{
				totalPreviewTasks: preview.totalTaskCount,
				updatedTotal,
				failedTotal,
				failedTaskIds: result.failedTaskIds,
				failedFiles: result.failedFiles,
			},
		);

		return result;
	}

	private createFieldRenameProgressSnapshot(preview: PipelineRenamePreview | PriorityRenamePreview): PipelineRenameProgressSnapshot {
		return {
			totalFileTaskCount: preview.fileTaskCount,
			totalInlineTaskCount: preview.inlineTaskCount,
			totalFileCount: preview.touchedFileCount,
			processedFileTaskCount: 0,
			processedInlineTaskCount: 0,
			processedFileCount: 0,
			failedFileTaskCount: 0,
			failedInlineTaskCount: 0,
			phase: 'writing',
		};
	}

	private openFileTaskTemplatePicker(
		onSelect: (selectedTemplate: FileTaskTemplateOption) => void,
		onCancel: () => void = () => {},
	): void {
		new FileTaskTemplatePickerModal(
			this.app,
			this.getFileTaskTemplateOptionsForPicker(),
			(selectedTemplate) => {
				this.settings.lastUsedFileTaskTemplateId = selectedTemplate.id;
				void this.storage.saveSettings();
				onSelect(selectedTemplate);
			},
			onCancel,
		).open();
	}

	private getFileTaskTemplateOptions(): FileTaskTemplateOption[] {
		return buildFileTaskTemplateOptions(
			this.settings.fileTaskTemplateFolder,
			this.app.vault.getMarkdownFiles(),
			this.settings.pipelines,
		);
	}

	private getFileTaskTemplateOptionsForPicker(): FileTaskTemplateOption[] {
		return orderFileTaskTemplateOptionsByLastUsed(
			this.getFileTaskTemplateOptions(),
			normalizeStoredFileTaskTemplateId(
				this.settings.lastUsedFileTaskTemplateId,
				this.settings.pipelines,
				this.settings.defaultPipelineName,
			),
		);
	}

	private getAvailableTaskCreatorDefaultFileTemplateId(): string {
		const templateId = normalizeStoredFileTaskTemplateId(
			this.settings.taskCreatorDefaultFileTemplateId,
			this.settings.pipelines,
			this.settings.defaultPipelineName,
		);
		return findFileTaskTemplateOptionById(
			this.getFileTaskTemplateOptions(),
			templateId,
		)?.id ?? '';
	}

	private applyPipelineMinimalFileTaskTemplateStatus(
		option: FileTaskTemplateOption,
		fieldValues: Record<string, string>,
		fieldPresence: Set<string>,
	): boolean {
		if (option.kind !== 'builtin-pipeline-minimal') return true;
		if ((fieldValues['status'] ?? '').trim()) {
			fieldPresence.add('status');
			return true;
		}
		const status = resolvePipelineMinimalFileTaskTemplateStatus(option, this.settings.pipelines);
		if (!status) {
			new Notice(t('notifications', 'pipelineMinimalFileTaskTemplateUnavailable'));
			return false;
		}
		fieldValues['status'] = status;
		fieldPresence.add('status');
		return true;
	}

	private getTargetFileTaskFolder(
		fallbackFile: TFile | null | undefined,
		targetFolderOverride?: string | null,
	): string {
		if (targetFolderOverride !== undefined && targetFolderOverride !== null) {
			return targetFolderOverride.trim();
		}
		return this.settings.fileTasksFolder.trim() || fallbackFile?.parent?.path || '';
	}

	private async ensureFileTaskFolder(folder: string): Promise<void> {
		if (!folder) return;
		if (folder === this.settings.fileTasksFolder.trim()) {
			await this.formatConverter.ensureFileTasksFolder();
		}
	}

	private async loadFileTaskTemplateDocumentFromOption(
		option: FileTaskTemplateOption | null,
	): Promise<LoadedFileTaskTemplateResult> {
		if (!option || option.kind !== 'folder') {
			return {
				document: null,
				resolvedOperonIdSeed: null,
				resolvedContent: null,
			};
		}

		const templateFile = this.app.vault.getAbstractFileByPath(option.path);
		if (!(templateFile instanceof TFile) || templateFile.extension !== 'md') {
			return {
				document: null,
				resolvedOperonIdSeed: null,
				resolvedContent: null,
			};
		}

		const rawContent = await this.app.vault.cachedRead(templateFile);
		const originalDocument = parseFrontmatterDocument(rawContent, this.settings.keyMappings);
		const resolvedContent = this.resolveOperonIdPlaceholdersInContent(rawContent);
		const resolvedDocument = parseFrontmatterDocument(resolvedContent, this.settings.keyMappings);
		const originalOperonId = (originalDocument.managedFieldValues['operonId'] ?? '').trim();
		const resolvedOperonId = (resolvedDocument.managedFieldValues['operonId'] ?? '').trim();

		return {
			document: resolvedDocument,
			resolvedOperonIdSeed: OPERON_ID_PLACEHOLDER_VALUE_PATTERN.test(originalOperonId)
				? (resolvedOperonId || null)
				: null,
			resolvedContent,
		};
	}

	private buildOperonTemplatePlaceholderContext(
		description: string,
		fieldValues: Record<string, string>,
		now: string,
	): OperonTemplatePlaceholderContext {
		return {
			date: now.slice(0, 10),
			time: now.slice(11, 16),
			datetime: now,
			taskDescription: this.normalizeTaskCreatorText(description),
			note: this.normalizeTaskCreatorText(fieldValues['note'] ?? ''),
			dateStarted: (fieldValues['dateStarted'] ?? '').trim(),
			dateScheduled: (fieldValues['dateScheduled'] ?? '').trim(),
			dateDue: (fieldValues['dateDue'] ?? '').trim(),
			status: (fieldValues['status'] ?? '').trim(),
			priority: (fieldValues['priority'] ?? '').trim(),
		};
	}

	private hasTemplatedFileTaskIdentity(content: string): boolean {
		const document = parseFrontmatterDocument(content, this.settings.keyMappings);
		return OPERON_ID_PLACEHOLDER_VALUE_PATTERN.test(
			(document.managedFieldValues['operonId'] ?? '').trim(),
		);
	}

	private markTemplatedFileTaskCreationCandidate(filePath: string): void {
		const expiresAt = Date.now() + TEMPLATED_FILE_TASK_CREATION_WINDOW_MS;
		this.templatedFileTaskCreationCandidates.set(filePath, expiresAt);
		this.scheduleTemplatedFileTaskCreationCandidateExpiry(filePath, expiresAt);
	}

	private moveTemplatedFileTaskCreationCandidate(oldPath: string, newPath: string): boolean {
		const expiresAt = this.templatedFileTaskCreationCandidates.get(oldPath);
		if (expiresAt === undefined) return false;
		this.templatedFileTaskCreationCandidates.delete(oldPath);
		if (expiresAt < Date.now()) return false;
		this.templatedFileTaskCreationCandidates.set(newPath, expiresAt);
		this.scheduleTemplatedFileTaskCreationCandidateExpiry(newPath, expiresAt);
		return true;
	}

	private findWorkflowNormalizationOwner(filePath: string): string | null {
		if (this.workflowNormalizationInProgress.has(filePath)) return filePath;
		for (const [ownerPath, renamedPath] of this.workflowNormalizationRenameTargets) {
			if (renamedPath === filePath) return ownerPath;
		}
		return null;
	}

	private scheduleTemplatedFileTaskCreationCandidateExpiry(filePath: string, expiresAt: number): void {
		getActiveWindow().setTimeout(() => {
			if (this.templatedFileTaskCreationCandidates.get(filePath) === expiresAt) {
				this.templatedFileTaskCreationCandidates.delete(filePath);
			}
		}, Math.max(0, expiresAt - Date.now()));
	}

	private isTemplatedFileTaskCreationCandidate(filePath: string): boolean {
		const expiresAt = this.templatedFileTaskCreationCandidates.get(filePath);
		if (expiresAt === undefined) return false;
		if (expiresAt >= Date.now()) return true;
		this.templatedFileTaskCreationCandidates.delete(filePath);
		return false;
	}

	private resolveTemplatedFileTaskContent(content: string, title: string, now: string): string {
		const initialContext: OperonTemplatePlaceholderContext = {
			...this.buildOperonTemplatePlaceholderContext(title, {}, now),
			note: '{{note}}',
			dateStarted: '{{dateStarted}}',
			dateScheduled: '{{dateScheduled}}',
			dateDue: '{{dateDue}}',
			status: '{{status}}',
			priority: '{{priority}}',
		};
		const preResolvedContent = this.resolveFileTaskTemplatePlaceholdersInContent(
			content,
			initialContext,
			title,
			{ resolveBodyText: false },
		);
		const document = parseFrontmatterDocument(preResolvedContent, this.settings.keyMappings);
		const draftFieldValues = Object.fromEntries(
			Object.entries(document.managedFieldValues).map(([key, value]) => [
				key,
				value.replace(DEFERRED_FILE_TASK_TEMPLATE_PLACEHOLDER_PATTERN, ''),
			]),
		);
		const draftDocument: ParsedFrontmatterDocument = {
			...document,
			managedFieldValues: draftFieldValues,
		};
		const draft = this.buildFileTaskDraft({
			description: title,
			fieldValues: draftFieldValues,
			fieldPresence: document.managedFieldPresence,
			tags: [...document.tags],
			tagsPresent: document.tagsPresent,
			frontmatterDocument: draftDocument,
		}, null, now, 'preserve-source');
		const frontmatterResolvedContent = this.resolveFileTaskTemplatePlaceholdersInContent(
			draft.content,
			this.buildOperonTemplatePlaceholderContext(title, draft.fieldValues, now),
			title,
			{ resolveBodyText: false },
		);
		const resolvedDocument = parseFrontmatterDocument(frontmatterResolvedContent, this.settings.keyMappings);
		const finalContext = this.buildOperonTemplatePlaceholderContext(title, resolvedDocument.managedFieldValues, now);
		return this.resolveFileTaskTemplatePlaceholdersInContent(
			frontmatterResolvedContent,
			finalContext,
			title,
		);
	}

	private buildRawTaskLinePlaceholderContext(): RawOperonTaskLinePlaceholderContext {
		return {
			status: resolveDefaultFileTaskStatus(this.settings.pipelines, this.settings.defaultPipelineName) ?? '',
			priority: this.settings.defaultPriority.trim(),
		};
	}

	private resolveLoadedFileTaskTemplateDocument(
		templateResult: LoadedFileTaskTemplateResult,
		context: OperonTemplatePlaceholderContext,
	): ParsedFrontmatterDocument | null {
		if (!templateResult.resolvedContent) return null;
		return parseFrontmatterDocument(
			this.resolveOperonTemplatePlaceholdersInContent(templateResult.resolvedContent, context, {
				resolveBodyText: false,
			}),
			this.settings.keyMappings,
		);
	}

	private resolveCreateFileTaskSourceSeed(
		view: MarkdownView | null,
		editor: Editor | null,
	): CreateFileTaskSourceSeed | null {
		const sourceFilePath = view?.file?.path ?? '';
		if (!editor || !sourceFilePath) return null;

		if (editor.somethingSelected()) {
			const selections = editor.listSelections();
			if (selections.length !== 1) {
				new Notice(t('notifications', 'singleLineFileTaskSelectionRequired'));
				return null;
			}

			const selection = selections[0];
			const { from, to } = this.normalizeEditorSelection(selection);
			if (from.line !== to.line) {
				new Notice(t('notifications', 'singleLineFileTaskSelectionRequired'));
				return null;
			}

			const line = editor.getLine(from.line);
			if (this.parseInlineTaskLine(line, from.line, sourceFilePath)) {
				new Notice(t('notifications', 'fileTaskSeedRequiresNonTaskLine'));
				return null;
			}

			const selectedText = editor.getRange(from, to).trim();
			if (!selectedText) return null;

			return {
				description: selectedText,
				replacementMode: 'selection',
				selection,
				sourceFilePath,
			};
		}

		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		if (!line.trim()) return null;
		if (this.parseInlineTaskLine(line, cursor.line, sourceFilePath)) return null;

		return {
			description: line.trim(),
			replacementMode: 'line',
			lineNumber: cursor.line,
			sourceFilePath,
		};
	}

	private getConvertibleInlineTaskAtCursor(
		file: TFile | null,
		editor: Editor | null,
	): ParsedTask | null {
		if (!(file instanceof TFile) || !editor) return null;

		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		const parsed = this.parseInlineTaskLine(line, cursor.line, file.path);
		return parsed?.operonId ? parsed : null;
	}

	private async replaceCreateFileTaskSourceWithLink(
		sourceSeed: CreateFileTaskSourceSeed,
		createdFile: TFile,
	): Promise<boolean> {
		if (!sourceSeed.sourceFilePath || sourceSeed.replacementMode === 'none') {
			return true;
		}

		const sourceFile = this.app.vault.getAbstractFileByPath(sourceSeed.sourceFilePath);
		if (!(sourceFile instanceof TFile)) return false;

		const content = await this.app.vault.cachedRead(sourceFile);
		const lines = content.split('\n');
		const wikilink = this.buildFileTaskWikilink(createdFile);

		if (sourceSeed.replacementMode === 'selection') {
			if (!sourceSeed.selection) return false;
			const { from, to } = this.normalizeEditorSelection(sourceSeed.selection);
			if (from.line !== to.line) return false;
			if (from.line < 0 || from.line >= lines.length) return false;

			const line = lines[from.line] ?? '';
			lines[from.line] = line.slice(0, from.ch) + wikilink + line.slice(to.ch);
			await this.app.vault.modify(sourceFile, lines.join('\n'));
			return true;
		}

		if (sourceSeed.replacementMode === 'line') {
			if (sourceSeed.lineNumber === undefined) return false;
			if (sourceSeed.lineNumber < 0 || sourceSeed.lineNumber >= lines.length) return false;
			lines[sourceSeed.lineNumber] = wikilink;
			await this.app.vault.modify(sourceFile, lines.join('\n'));
			return true;
		}

		return true;
	}

	private getTemplaterEngine(): Record<string, unknown> | null {
		const plugin = getCommunityPlugin(this.app, 'templater-obsidian');
		if (!isRecord(plugin)) return null;
		const templater = plugin.templater;
		return isRecord(templater) ? templater : null;
	}

	private async maybeProcessFileTaskTemplaterContent(
		file: TFile,
		content: string,
		template: ParsedFrontmatterDocument | null,
		templateOption: FileTaskTemplateOption | null,
		options: { runMode?: number } = {},
	): Promise<string> {
		if (!this.fileTaskContentNeedsTemplaterProcessing(template, content)) return content;
		const runMode = options.runMode ?? 2;

		const templater = this.getTemplaterEngine();
		if (!templater) {
			new Notice(t('notifications', 'templaterUnavailable'));
			return content;
		}

		try {
			const parseTemplate = templater['parse_template'];
			const createRunningConfig = templater['create_running_config'];
			const startTask = templater['start_templater_task'];
			const endTask = templater['end_templater_task'];
			const overwrite = templater['overwrite_file_commands'];
			const templateFile = templateOption?.path
				? this.app.vault.getAbstractFileByPath(templateOption.path)
				: null;

			const parseWithRunningConfig = async (
				sourceTemplateFile: TFile,
				targetFile: TFile,
				sourceContent: string,
			): Promise<string | null> => {
				if (typeof parseTemplate !== 'function' || typeof createRunningConfig !== 'function') return null;
				if (typeof startTask === 'function') {
					await startTask.call(templater, targetFile.path);
				}

				try {
					const config = callUnknownMethod(templater, 'create_running_config', sourceTemplateFile, targetFile, runMode);
					const rendered = await callUnknownMethod(templater, 'parse_template', config, sourceContent);
					return typeof rendered === 'string' ? rendered : sourceContent;
				} finally {
					if (typeof endTask === 'function') {
						await endTask.call(templater, targetFile.path);
					}
				}
			};

			const ensureFileContentForTemplater = async (sourceContent: string): Promise<void> => {
				const currentContent = await this.app.vault.read(file);
				if (currentContent !== sourceContent) {
					await this.app.vault.modify(file, sourceContent);
				}
			};

			const runTargetFilePass = async (sourceContent: string): Promise<string | null> => {
				await ensureFileContentForTemplater(sourceContent);
				await delayWithActiveWindow(350);
				const currentContent = await this.app.vault.read(file);
				let targetParsedContent: string | null = null;
				try {
					targetParsedContent = await parseWithRunningConfig(file, file, currentContent);
				} catch (parseError) {
					console.warn('Operon: target-file Templater pass failed; falling back to overwrite pass.', parseError);
				}

				if (targetParsedContent !== null) {
					if (!this.fileTaskContentNeedsTemplaterProcessing(null, targetParsedContent)) return targetParsedContent;
					if (targetParsedContent !== currentContent) {
						await this.app.vault.modify(file, targetParsedContent);
					}
				}

				if (typeof overwrite !== 'function') return targetParsedContent;
				await overwrite.call(templater, file, false);
				await delayWithActiveWindow(50);
				return await this.app.vault.read(file);
			};

			if (
				templateFile instanceof TFile
			) {
				let renderedContent = content;
				try {
					renderedContent = await parseWithRunningConfig(templateFile, file, content) ?? content;
				} catch (parseError) {
					console.warn('Operon: template-file Templater pass failed; falling back to target-file pass.', parseError);
				}

				if (!this.fileTaskContentNeedsTemplaterProcessing(null, renderedContent)) return renderedContent;
				return await runTargetFilePass(renderedContent) ?? renderedContent;
			}

			return await runTargetFilePass(content) ?? content;
		} catch (error) {
			console.error('Operon: failed to process Templater syntax for file task', error);
			new Notice(t('notifications', 'templaterProcessingFailed'));
		}

		return content;
	}

	private fileTaskContentNeedsTemplaterProcessing(
		template: ParsedFrontmatterDocument | null,
		content: string,
	): boolean {
		return templateDocumentContainsTemplaterSyntax(template) || content.includes('<%');
	}

	private resolveOperonIdPlaceholdersInContent(
		content: string,
		options: { resolveRawDateTime?: boolean } = {},
	): string {
		const resolveRawTaskLineValues = options.resolveRawDateTime === true;
		return resolveOperonIdPlaceholders(content, {
			generateOperonId: () => generateOperonId(),
			now: resolveRawTaskLineValues ? localNow() : undefined,
			rawContext: resolveRawTaskLineValues ? this.buildRawTaskLinePlaceholderContext() : undefined,
		});
	}

	private resolveOperonTemplatePlaceholdersInContent(
		content: string,
		context: OperonTemplatePlaceholderContext,
		options: { resolveBodyText?: boolean } = {},
	): string {
		return resolveOperonTemplatePlaceholders(content, {
			generateOperonId: () => generateOperonId(),
			context,
			resolveBodyText: options.resolveBodyText,
		});
	}

	private resolveFileTaskTemplatePlaceholdersInContent(
		content: string,
		context: OperonTemplatePlaceholderContext,
		title: string,
		options: { resolveBodyText?: boolean } = {},
	): string {
		const operonResolved = this.resolveOperonTemplatePlaceholdersInContent(content, context, options);
		const coreContext = {
			title,
			date: context.date,
			now: context.datetime,
		};
		const coreOptions = {
			resolveFencedCodeBlocks: false,
		};
		if (options.resolveBodyText !== false) {
			return resolveCoreTemplateVariables(operonResolved, coreContext, coreOptions);
		}

		const { frontmatter, body } = splitFrontmatterDocument(operonResolved);
		const resolvedFrontmatter = frontmatter === null
			? null
			: resolveCoreTemplateVariables(frontmatter, coreContext, coreOptions);
		let inFencedCodeBlock = false;
		const resolvedBody = body.split('\n').map(line => {
			if (/^\s*```/.test(line) || /^\s*~~~/.test(line)) {
				inFencedCodeBlock = !inFencedCodeBlock;
				return line;
			}
			if (inFencedCodeBlock || !isTaskLineCandidate(line)) return line;
			return resolveCoreTemplateVariables(line, coreContext, coreOptions);
		}).join('\n');
		return resolvedFrontmatter === null
			? resolvedBody
			: `---\n${resolvedFrontmatter}\n---\n${resolvedBody}`;
	}

	private resolveOperonIdPlaceholdersInTaskBlock(
		content: string,
		options: { resolveRawDateTime?: boolean } = { resolveRawDateTime: true },
	): string {
		const resolveRawTaskLineValues = options.resolveRawDateTime === true;
		return resolveOperonIdPlaceholdersInTaskBlock(content, {
			generateOperonId: () => generateOperonId(),
			now: resolveRawTaskLineValues ? localNow() : undefined,
			rawContext: resolveRawTaskLineValues ? this.buildRawTaskLinePlaceholderContext() : undefined,
		});
	}

	private async awaitIndexedTask(filePath: string, operonId: string): Promise<IndexedTask | null> {
		for (let attempt = 0; attempt < 6; attempt++) {
			if (attempt > 0) {
				await delayWithActiveWindow(150);
			}
			await this.indexer.reindexFilePath(filePath);
			const task = this.indexer.getTask(operonId);
			if (task?.primary.filePath === filePath) {
				return task;
			}
		}
		return null;
	}

	private async awaitIndexedYamlTask(filePath: string, operonId: string): Promise<IndexedTask | null> {
		const task = await this.awaitIndexedTask(filePath, operonId);
		if (task?.primary.format === 'yaml' && task.primary.filePath === filePath) {
			return task;
		}
		return null;
	}

	private async openYamlTaskEditorByData(
		file: TFile,
		description: string,
		fieldValues: Record<string, string>,
		tags: string[],
		options: TaskEditorContentOptions = {},
	): Promise<void> {
		const operonId = fieldValues['operonId'];
		if (!operonId) return;

		const indexedTask = await this.awaitIndexedYamlTask(file.path, operonId);
		const baseParsed = indexedTask
			? await this.loadEditableParsedTask(indexedTask)
			: this.buildParsedYamlTask(file.path, file.basename || description, fieldValues, tags);
		const parsed = this.overlayParsedTaskFields(baseParsed, fieldValues, tags, file.basename || description);
		const resolvedOptions = options.fileBody !== undefined
			? options
			: {
				...options,
				fileBody: this.buildYamlTaskEditorFileBodyContext(
					file.path,
					await this.loadParsedFrontmatterDocument(file),
					await this.app.vault.cachedRead(file),
				),
			};

		await this.openTaskEditorFor(parsed, async (request) => {
			const indexed = this.indexer.getTask(operonId);
			const freshTask = indexed?.primary.format === 'yaml'
				? indexed
				: await this.awaitIndexedTask(request.fileBody?.filePath ?? file.path, operonId);
			if (!freshTask || freshTask.primary.format !== 'yaml') {
				new Notice(t('notifications', 'taskSaveFailed'));
				return false;
			}
			const saved = await this.applyEditedTaskFromView(freshTask, request);
			if (saved === false) {
				new Notice(t('notifications', 'taskSaveFailed'));
				return false;
			}
			return true;
		}, resolvedOptions);
	}

	private reinforceTaskEditorDescriptionFocus(selectAll = false): void {
		const focusDescription = () => {
			const input = getActiveDocument().querySelector<HTMLTextAreaElement>(
				'.operon-task-editor-modal .operon-editor-description-textarea',
			);
			if (!input?.isConnected) return;
			input.focus();
			if (selectAll) {
				input.select();
				return;
			}
			const end = input.value.length;
			input.setSelectionRange(end, end);
		};

		for (const delay of [0, 120, 260, 480, 760, 1100, 1500]) {
			getActiveWindow().setTimeout(focusDescription, delay);
		}
	}

	private async deleteInlineTaskById(
		filePath: string,
		operonId: string,
		lineHint: number,
	): Promise<boolean> {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) return false;

		const content = await this.app.vault.cachedRead(file);
		const lines = content.split('\n');

		let targetLine = -1;
		if (lineHint >= 0 && lineHint < lines.length) {
			const hinted = this.parseInlineTaskLine(lines[lineHint], lineHint, filePath);
			if (hinted?.operonId === operonId) {
				targetLine = lineHint;
			}
		}

		if (targetLine === -1) {
			for (let i = 0; i < lines.length; i++) {
				const parsed = this.parseInlineTaskLine(lines[i], i, filePath);
				if (parsed?.operonId === operonId) {
					targetLine = i;
					break;
				}
			}
		}

		if (targetLine === -1) return false;

		lines.splice(targetLine, 1);
		await this.app.vault.modify(file, lines.join('\n'));
		return true;
	}

	private async clearInlineTaskById(
		filePath: string,
		operonId: string,
		lineHint: number,
	): Promise<boolean> {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) return false;

		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView?.file?.path === filePath) {
			const editor = activeView.editor;
			let targetLine = -1;
			if (lineHint >= 0 && lineHint <= editor.lastLine()) {
				const hinted = this.parseInlineTaskLine(editor.getLine(lineHint), lineHint, filePath);
				if (hinted?.operonId === operonId) {
					targetLine = lineHint;
				}
			}
			if (targetLine === -1) {
				for (let i = 0; i <= editor.lastLine(); i++) {
					const parsed = this.parseInlineTaskLine(editor.getLine(i), i, filePath);
					if (parsed?.operonId === operonId) {
						targetLine = i;
						break;
					}
				}
			}
			if (targetLine === -1) return false;
			editor.setLine(targetLine, '');
			await this.persistInlineEditorBufferAndReindex(filePath);
			return true;
		}

		const content = await this.app.vault.cachedRead(file);
		const lines = content.split('\n');
		let targetLine = -1;
		if (lineHint >= 0 && lineHint < lines.length) {
			const hinted = this.parseInlineTaskLine(lines[lineHint], lineHint, filePath);
			if (hinted?.operonId === operonId) {
				targetLine = lineHint;
			}
		}
		if (targetLine === -1) {
			for (let i = 0; i < lines.length; i++) {
				const parsed = this.parseInlineTaskLine(lines[i], i, filePath);
				if (parsed?.operonId === operonId) {
					targetLine = i;
					break;
				}
			}
		}
		if (targetLine === -1) return false;
		lines[targetLine] = '';
		await this.app.vault.modify(file, lines.join('\n'));
		return true;
	}

	private async deleteYamlTaskByPath(filePath: string): Promise<boolean> {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) return false;
		await this.app.fileManager.trashFile(file);
		await this.indexer.handleFileDelete(filePath);
		return true;
	}

	private async confirmAndDeleteTaskInstance(instanceKey: string): Promise<boolean> {
		const task = this.indexer.getTaskInstance(instanceKey);
		if (!task) return false;
		const confirmed = await new Promise<boolean>(resolve => {
			new ConfirmActionModal(this.app, {
				title: t('duplicateOperonId', 'deleteTitle'),
				message: t('duplicateOperonId', 'deleteMessage', {
					label: task.description || task.operonId,
				}),
				confirmText: t('duplicateOperonId', 'deleteCopy'),
				cancelText: t('buttons', 'cancel'),
			}, resolve).open();
		});
		if (!confirmed) return false;
		const deleted = task.primary.format === 'inline'
			? await this.deleteInlineTaskById(task.primary.filePath, task.operonId, task.primary.lineNumber)
			: await this.deleteYamlTaskByPath(task.primary.filePath);
		if (!deleted) {
			new Notice(t('notifications', 'taskSaveFailed'));
			return false;
		}
		if (task.primary.format === 'inline') {
			await this.indexer.reindexFilePath(task.primary.filePath);
		}
		this.refreshViews();
		return true;
	}

	private async regenerateDuplicateTaskInstanceId(instanceKey: string): Promise<boolean> {
		const task = this.indexer.getTaskInstance(instanceKey);
		if (!task) return false;
		const nextOperonId = generateOperonId();
		const updated = task.primary.format === 'inline'
			? await this.updateInlineTaskInstanceOperonId(task, nextOperonId)
			: await this.updateYamlTaskInstanceOperonId(task, nextOperonId);
		if (!updated) {
			new Notice(t('notifications', 'taskSaveFailed'));
			return false;
		}
		this.refreshViews();
		return true;
	}

	private async updateInlineTaskInstanceOperonId(task: IndexedTaskInstance, nextOperonId: string): Promise<boolean> {
		const file = this.app.vault.getAbstractFileByPath(task.primary.filePath);
		if (!(file instanceof TFile)) return false;
		const content = await this.app.vault.cachedRead(file);
		const lines = content.split('\n');
		const lineNumber = task.primary.lineNumber;
		if (lineNumber < 0 || lineNumber >= lines.length) return false;
		const parsed = this.parseInlineTaskLine(lines[lineNumber], lineNumber, task.primary.filePath);
		if (!parsed || parsed.operonId !== task.operonId) return false;
		this.setParsedTaskField(parsed, 'operonId', nextOperonId, 'text');
		this.normalizeParsedTaskCreatedTimestamp(parsed);
		this.touchParsedTaskModifiedTimestamp(parsed, localNow());
		lines[lineNumber] = this.serializeInlineTask(parsed);
		await this.app.vault.modify(file, lines.join('\n'));
		await this.indexer.reindexFilePath(task.primary.filePath);
		return true;
	}

	private async updateYamlTaskInstanceOperonId(task: IndexedTaskInstance, nextOperonId: string): Promise<boolean> {
		const fieldValues = {
			...task.fieldValues,
			operonId: nextOperonId,
			datetimeModified: localNow(),
		};
		const nextPath = await this.writeYamlTaskInstance(task, task.description, fieldValues, task.tags, null);
		if (!nextPath) return false;
		await this.indexer.reindexFilePath(nextPath);
		return true;
	}

	private async writeYamlTaskInstanceFromParsedTask(
		task: IndexedTaskInstance,
		parsed: ParsedTask,
		fileBody: TaskEditorSaveRequest['fileBody'],
	): Promise<string | null> {
		const fieldValues = this.buildParsedTaskFieldValues(parsed);
		if (fieldValues['datetimeCreated']) {
			fieldValues['datetimeCreated'] = normalizeLegacyCreatedDatetime(fieldValues['datetimeCreated']);
		}
		fieldValues['datetimeModified'] = fieldValues['datetimeModified'] || localNow();
		return await this.writeYamlTaskInstance(task, parsed.description, fieldValues, parsed.tags, fileBody);
	}

	private async writeYamlTaskInstance(
		task: IndexedTaskInstance,
		description: string,
		fieldValues: Record<string, string>,
		tags: string[],
		fileBody: TaskEditorSaveRequest['fileBody'],
	): Promise<string | null> {
		const file = this.app.vault.getAbstractFileByPath(task.primary.filePath);
		if (!(file instanceof TFile)) return null;
		const content = await this.app.vault.cachedRead(file);
		const document = parseFrontmatterDocument(content, this.settings.keyMappings);
		const defaults = resolveFileTaskDefaults({
			sourceFieldValues: fieldValues,
			existingOperonId: fieldValues['operonId'],
			seedCreatedAt: fieldValues['datetimeCreated'] ?? null,
			defaultPipelineName: this.settings.defaultPipelineName,
			defaultPriority: this.settings.defaultPriority,
			pipelines: this.settings.pipelines,
			now: fieldValues['datetimeModified'] || localNow(),
			generateOperonId: () => fieldValues['operonId'] || generateOperonId(),
		});
		const draft = buildMergedFileTaskDraft({
			source: {
				description,
				fieldValues,
				fieldPresence: new Set(Object.keys(fieldValues)),
				tags,
				tagsPresent: tags.length > 0 || document.tagsPresent,
				frontmatterDocument: document,
			},
			defaults,
			keyMappings: this.settings.keyMappings,
			bodyStrategy: 'preserve-source',
		});
		const { frontmatter } = splitFrontmatterDocument(draft.content);
		const nextBody = fileBody?.dirty ? fileBody.content : draft.body;
		const nextContent = frontmatter == null
			? nextBody
			: `---\n${frontmatter}\n---\n${nextBody}`;
		this.markInternalTaskWrite(file.path);
		await this.app.vault.modify(file, nextContent);

		let indexedPath = file.path;
		const sanitized = this.sanitizeTaskFileName(description);
		if (sanitized && sanitized !== file.basename) {
			const folder = file.parent?.path ?? '';
			const newPath = folder ? `${folder}/${sanitized}.md` : `${sanitized}.md`;
			if (!this.app.vault.getAbstractFileByPath(newPath)) {
				await this.app.fileManager.renameFile(file, newPath);
				indexedPath = newPath;
			}
		}
		return indexedPath;
	}

	private async rollbackCreatedFileTask(filePath: string): Promise<boolean> {
		try {
			if (!(await this.app.vault.adapter.exists(filePath))) {
				return true;
			}
			await this.app.vault.adapter.remove(filePath);
			await this.indexer.handleFileDelete(filePath);
			return true;
		} catch {
			return false;
		}
	}

	private async withInlineToFileTaskTransitionSafePass<T>(
		operonId: string,
		sourceFilePath: string,
		sourceLineNumber: number,
		createdFilePath: string,
		operation: () => Promise<T>,
	): Promise<T> {
		return await this.withDuplicateConflictAutoOpenSuppressed(async () => {
			const releaseExpectedDuplicate = this.indexer.beginExpectedDuplicateOperonIdTransition(operonId, [
				{ filePath: sourceFilePath, lineNumber: sourceLineNumber, format: 'inline' },
				{ filePath: createdFilePath, lineNumber: 0, format: 'yaml' },
			]);
			try {
				return await operation();
			} finally {
				releaseExpectedDuplicate();
			}
		});
	}

	private async runInlineToFileTaskTransitionSafePass(
		sourceFilePath: string,
		createdFilePath: string,
	): Promise<void> {
		await this.indexer.reindexFilesBatch([...new Set([sourceFilePath, createdFilePath])], { notify: false });
	}

	private async withFileTaskToInlineTransitionSafePass<T>(
		operonId: string,
		sourceFilePath: string,
		targetFilePath: string,
		targetLineNumber: number,
		operation: () => Promise<T>,
	): Promise<T> {
		const releaseExpectedDuplicate = this.indexer.beginExpectedDuplicateOperonIdTransition(operonId, [
			{ filePath: sourceFilePath, lineNumber: 0, format: 'yaml' },
			{ filePath: targetFilePath, lineNumber: targetLineNumber, format: 'inline' },
		]);
		try {
			return await operation();
		} finally {
			releaseExpectedDuplicate();
		}
	}

	private isInlineToFileTaskTransitionContentValid(
		content: string,
		expectedOperonId: string,
	): boolean {
		const document = parseFrontmatterDocument(content, this.settings.keyMappings);
		return (document.managedFieldValues['operonId'] ?? '').trim() === expectedOperonId;
	}

	private buildFileTaskDraft(
		source: {
			description: string;
			fieldValues: Record<string, string>;
			fieldPresence?: Set<string>;
			explicitEmptyFieldKeys?: Set<string>;
			tags?: string[];
			tagsPresent?: boolean;
			frontmatterDocument?: ParsedFrontmatterDocument | null;
		},
		template: ParsedFrontmatterDocument | null,
		now: string,
		bodyStrategy: 'preserve-source' | 'use-template',
	): MergedFileTaskDraft {
		const defaults = resolveFileTaskDefaults({
			sourceFieldValues: source.fieldValues,
			templateFieldValues: template?.managedFieldValues ?? {},
			existingOperonId: source.fieldValues['operonId'] ?? null,
			seedCreatedAt: now,
			defaultPipelineName: this.settings.defaultPipelineName,
			defaultPriority: this.settings.defaultPriority,
			pipelines: this.settings.pipelines,
			now,
			generateOperonId: () => generateOperonId(),
		});

		return buildMergedFileTaskDraft({
			source,
			template,
			defaults,
			keyMappings: this.settings.keyMappings,
			bodyStrategy,
		});
	}

	private getSourceContextFrontmatter(filePath: string | null | undefined): Record<string, unknown> | null {
		if (!filePath) return null;
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) return null;
		return this.app.metadataCache.getFileCache(file)?.frontmatter ?? null;
	}

	private async resolveLinkedFileSubtaskInheritance(
		parentTaskId: string,
		sourceFilePath: string | null | undefined,
	): Promise<SubtaskInitialFields> {
		const indexedParent = this.indexer.getTask(parentTaskId);
		if (indexedParent) {
			return resolveSubtaskInitialFieldsFromParentValues(
				parentTaskId,
				indexedParent.fieldValues,
				this.settings,
				indexedParent.tags,
			);
		}

		if (!sourceFilePath) {
			return resolveSubtaskInitialFieldsFromParentValues(parentTaskId, null, this.settings);
		}

		const sourceFile = this.app.vault.getAbstractFileByPath(sourceFilePath);
		if (!(sourceFile instanceof TFile)) {
			return resolveSubtaskInitialFieldsFromParentValues(parentTaskId, null, this.settings);
		}

		const sourceDocument = await this.loadParsedFrontmatterDocument(sourceFile);
		return resolveSubtaskInitialFieldsFromParentValues(
			parentTaskId,
			sourceDocument.managedFieldValues,
			this.settings,
			sourceDocument.tags,
		);
	}

	private async buildLinkedFileTaskSeed(
		sourceFilePath: string | null | undefined,
		seedFieldValues: Record<string, string>,
		seedFieldPresence: Set<string>,
		existingParentTask?: string | null,
	): Promise<{ fieldValues: Record<string, string>; fieldPresence: Set<string>; tags: string[] }> {
		const linkedSeed = applyLinkedFileTaskAutoParentSeed({
			enabled: this.settings.autoParentLinkedFileSubtasks,
			sourceFilePath,
			tasks: this.indexer.getAllTasks(),
			frontmatter: this.getSourceContextFrontmatter(sourceFilePath),
			keyMappings: this.settings.keyMappings,
			existingParentTask,
			fieldValues: seedFieldValues,
			fieldPresence: seedFieldPresence,
		});

		const parentTaskId = (linkedSeed.fieldValues['parentTask'] ?? '').trim();
		if (!parentTaskId) return { ...linkedSeed, tags: [] };

		const inherited = await this.resolveLinkedFileSubtaskInheritance(parentTaskId, sourceFilePath);
		const nextFieldValues = { ...linkedSeed.fieldValues };
		const nextFieldPresence = new Set(linkedSeed.fieldPresence);

		for (const key of getSubtaskInitialFieldKeys(inherited)) {
			const value = inherited[key];
			const normalizedValue = typeof value === 'string' ? value.trim() : '';
			if (!normalizedValue) continue;
			if ((nextFieldValues[key] ?? '').trim()) continue;
			nextFieldValues[key] = normalizedValue;
			nextFieldPresence.add(key);
		}

		return {
			fieldValues: nextFieldValues,
			fieldPresence: nextFieldPresence,
			tags: [...(inherited.tags ?? [])],
		};
	}

	private async createFileTaskFromTemplateSelection(
		selectedTemplate: FileTaskTemplateOption,
		options: CreateFileTaskOptions = {},
	): Promise<CreatedCalendarFileTask | null> {
		const title = options.initialDescription ?? t('taskEditor', 'newOperonTaskFile');
		const fallbackFile = options.fallbackFile ?? null;
		const now = localNow();

		const folder = this.getTargetFileTaskFolder(fallbackFile, options.targetFolderOverride);

		const templateResult = await this.loadFileTaskTemplateDocumentFromOption(selectedTemplate);
		const sourceContextFilePath = options.sourceContextFilePath ?? options.sourceReplacement?.sourceFilePath ?? null;
		const seedFieldValues = { ...(options.seedFieldValues ?? {}) };
		if (!(seedFieldValues['operonId'] ?? '').trim() && templateResult.resolvedOperonIdSeed) {
			seedFieldValues['operonId'] = templateResult.resolvedOperonIdSeed;
		}
		const seedFieldPresence = new Set(options.seedFieldPresence ?? Object.keys(seedFieldValues));
		const shouldApplyLinkedAutoParent = !!options.sourceReplacement && !!sourceContextFilePath;
		const linkedSeed = shouldApplyLinkedAutoParent
			? await this.buildLinkedFileTaskSeed(
				sourceContextFilePath,
				seedFieldValues,
				seedFieldPresence,
			)
			: { fieldValues: seedFieldValues, fieldPresence: seedFieldPresence, tags: [] };
		if (!this.applyPipelineMinimalFileTaskTemplateStatus(
			selectedTemplate,
			linkedSeed.fieldValues,
			linkedSeed.fieldPresence,
		)) return null;
		const template = this.resolveLoadedFileTaskTemplateDocument(
			templateResult,
			this.buildOperonTemplatePlaceholderContext(title, linkedSeed.fieldValues, now),
		);
		const seedTags = Array.from(new Set([
			...(options.seedTags ?? []).map(tag => tag.replace(/^#/, '').trim()).filter(Boolean),
			...linkedSeed.tags.map(tag => tag.replace(/^#/, '').trim()).filter(Boolean),
		]));
		const draft = this.buildFileTaskDraft({
			description: title,
			fieldValues: linkedSeed.fieldValues,
			fieldPresence: linkedSeed.fieldPresence,
			explicitEmptyFieldKeys: options.explicitEmptyFieldKeys,
			tags: seedTags,
			tagsPresent: options.seedTagsPresent === true || seedTags.length > 0,
		}, template, now, 'use-template');
		const templateContext = this.buildOperonTemplatePlaceholderContext(title, draft.fieldValues, now);
		if (!this.validateDependencyDraftOrShow(draft.operonId, draft.fieldValues)) return null;

		await this.ensureFileTaskFolder(folder);
		const sanitized = this.sanitizeTaskFileName(title) || t('taskEditor', 'untitledTaskFile');
		const filePath = this.formatConverter.getUniqueFilePath(folder, sanitized);
		const needsTemplaterProcessing = this.fileTaskContentNeedsTemplaterProcessing(template, draft.content);
		this.suppressRawTaskCreationNotice(draft.operonId);
		await this.app.vault.create(filePath, needsTemplaterProcessing ? '' : draft.content);

		const created = this.app.vault.getAbstractFileByPath(filePath);
		if (!(created instanceof TFile)) return null;

		const renderedContent = await this.maybeProcessFileTaskTemplaterContent(
			created,
			draft.content,
			template,
			selectedTemplate,
			{ runMode: needsTemplaterProcessing ? 0 : 2 },
		);
		const resolvedContent = this.resolveFileTaskTemplatePlaceholdersInContent(
			renderedContent,
			templateContext,
			created.basename,
		);
		if (resolvedContent !== await this.app.vault.cachedRead(created)) {
			await this.app.vault.modify(created, resolvedContent);
		}

		if (options.sourceReplacement) {
			const replaced = await this.replaceCreateFileTaskSourceWithLink(options.sourceReplacement, created);
			if (!replaced) {
				const rolledBack = await this.rollbackCreatedFileTask(filePath);
				if (!rolledBack) {
					new Notice(t('notifications', 'sourceNoteUpdateRollbackFailed', { path: filePath }));
				} else {
					new Notice(t('notifications', 'sourceNoteWikilinkUpdateFailed'));
				}
				return null;
			}
		}

		const finalDocument = await this.loadParsedFrontmatterDocument(created);
		const result: CreatedCalendarFileTask = {
			file: created,
			description: created.basename,
			fieldValues: { ...finalDocument.managedFieldValues },
			tags: [...finalDocument.tags],
		};

		if (options.openEditorOnCreate === true) {
			await this.app.workspace.getLeaf(false).openFile(created);
			await this.openYamlTaskEditorByData(
				created,
				created.basename,
				{ ...finalDocument.managedFieldValues },
				[...finalDocument.tags],
				{
					focusDescriptionOnMount: options.focusDescriptionOnMount ?? true,
					selectDescriptionOnMount: options.selectDescriptionOnMount ?? true,
				},
			);
			this.reinforceTaskEditorDescriptionFocus(options.selectDescriptionOnMount ?? true);
		}

		return result;
	}

	private getActiveMarkdownFile(): TFile | null {
		const activeFile = this.app.workspace.getActiveFile();
		return activeFile instanceof TFile && activeFile.extension === 'md' ? activeFile : null;
	}

	private openTaskCreator(
		initialDraft: TaskCreatorDraft | null = null,
		options: OpenTaskCreatorOptions = {},
	): void {
		this.taskCreatorModal?.close();
		const shouldApplyGenericDefaults = !initialDraft
			&& options.submitMode === undefined
			&& options.initialCreateType === undefined
			&& !options.onSubmitInline
			&& !options.onSubmitFile;
		const defaultFileTemplateId = shouldApplyGenericDefaults
			? this.getAvailableTaskCreatorDefaultFileTemplateId()
			: '';
		const modal = new TaskCreatorModal(this.app, {
			settings: this.settings,
			allTasks: this.indexer.getAllTasks(),
			initialDraft,
			submitMode: options.submitMode,
			initialCreateType: shouldApplyGenericDefaults && this.settings.taskCreatorDefaultToFileTask
				? 'file'
				: options.initialCreateType,
			defaultFileTemplateId,
			fileTaskTemplateOptions: this.getFileTaskTemplateOptionsForPicker(),
			onFileTemplateSelected: async (template) => {
				this.settings.lastUsedFileTaskTemplateId = template.id;
				await this.storage.saveSettings();
			},
			getAllRepeatSeriesIds: () => this.storage.repeatSeries.getAllSeriesIds(),
			initialOutsidePointerGraceMs: options.initialOutsidePointerGraceMs,
			preventFocusScroll: options.preventFocusScroll === true,
			onSubmitInline: options.onSubmitInline ?? ((draft) => this.createInlineTaskFromCreatorDraft(draft)),
			onSubmitFile: options.onSubmitFile ?? ((draft) => this.startFileTaskCreationFromCreatorDraft(draft)),
			onSubmitFailure: (draft, createType) => {
				if (createType !== 'inline') return;
				if (this.taskCreatorModal) return;
				this.openTaskCreator(draft, options);
			},
		});
		modal.onClose = () => {
			TaskCreatorModal.prototype.onClose.call(modal);
			if (this.taskCreatorModal === modal) {
				this.taskCreatorModal = null;
			}
		};
		this.taskCreatorModal = modal;
		modal.open();
	}

	private normalizeTaskCreatorText(value: string): string {
		return value.replace(/\r?\n+/g, ' ').trim();
	}

	private showTaskNotice(kind: TaskNoticeKind, parts: TaskNoticeNameParts): void {
		if (kind !== 'time-session-edited') {
			this.suppressRawTaskCreationNotice(parts.operonId);
		}
		new Notice(formatTaskNotice(kind, parts));
	}

	private buildTaskCreatorSeedFieldValues(draft: TaskCreatorDraft): Record<string, string> {
		return buildTaskCreatorSubmitFieldSeed(draft).fieldValues;
	}

	private async writeParentToExistingChildTask(childId: string, parentId: string | null): Promise<void> {
		const child = this.indexer.getTask(childId);
		if (!child) return;

		const beforeTask = child;
		const normalizedParentId = parentId?.trim() ?? '';
		const timestamp = localNow();
		const wrote = await this.writer.writeTaskFields(childId, {
			parentTask: normalizedParentId,
			datetimeModified: timestamp,
		}, { reindex: 'none' });
		if (!wrote) return;

		await this.indexer.reindexFilePath(child.primary.filePath, { notify: false });
		try {
			await this.refreshAggregateTotalsAfterTaskMutation(
				beforeTask,
				this.indexer.getTask(childId) ?? null,
				{ modifiedTimestamp: timestamp },
			);
		} finally {
			// The explicit aggregate pass above owns this mutation. Preserve the
			// generic index side effects after it settles without also starting the
			// fire-and-forget onTasksChanged aggregate path.
			this.scheduleIndexSideEffects();
		}
	}

	private async syncExistingSubtasksForParent(parentId: string, nextSubtaskIds: string[]): Promise<void> {
		const normalizedParentId = parentId.trim();
		if (!normalizedParentId) return;

		const nextIds = Array.from(new Set(nextSubtaskIds.map(value => value.trim()).filter(Boolean)))
			.filter(operonId => operonId !== normalizedParentId);
		const currentIds = [...this.indexer.secondary.getChildIds(normalizedParentId)];
		const nextIdSet = new Set(nextIds);
		const currentIdSet = new Set(currentIds);

		for (const childId of currentIds) {
			if (!nextIdSet.has(childId)) {
				await this.writeParentToExistingChildTask(childId, null);
			}
		}

		for (const childId of nextIds) {
			if (!currentIdSet.has(childId)) {
				await this.writeParentToExistingChildTask(childId, normalizedParentId);
			}
		}
	}

	private getDependencyPayloadChanges(
		task: IndexedTask,
		payload: Record<string, string>,
		mode: 'merge' | 'replace',
	): DependencyFieldMutation[] {
		const changes: DependencyFieldMutation[] = [];
		const payloadKeys = new Set(Object.keys(payload));
		for (const field of ['blocking', 'blockedBy'] as const) {
			const oldValue = task.fieldValues[field] ?? '';
			const hasPayloadValue = payloadKeys.has(field);
			if (!hasPayloadValue && mode !== 'replace') continue;
			const newValue = hasPayloadValue ? payload[field] ?? '' : '';
			if (oldValue === newValue) continue;
			changes.push({ operonId: task.operonId, field, oldValue, newValue });
		}
		return changes;
	}

	private getDependencyDraftChanges(
		operonId: string,
		fieldValues: Record<string, string>,
	): DependencyFieldMutation[] {
		const normalizedOperonId = operonId.trim();
		if (!normalizedOperonId) return [];
		const existingTask = this.indexer.getTask(normalizedOperonId);
		const changes: DependencyFieldMutation[] = [];
		for (const field of ['blocking', 'blockedBy'] as const) {
			const oldValue = existingTask?.fieldValues[field] ?? '';
			const newValue = fieldValues[field] ?? '';
			if (oldValue === newValue) continue;
			changes.push({ operonId: normalizedOperonId, field, oldValue, newValue });
		}
		return changes;
	}

	private validateDependencyPayloadChanges(
		task: IndexedTask,
		payload: Record<string, string>,
		mode: 'merge' | 'replace',
	): boolean {
		const validation = this.dependencyManager.validateDependencyChanges(
			this.getDependencyPayloadChanges(task, payload, mode),
		);
		if (!validation.ok) {
			this.showDependencyValidationRejected(validation);
			return false;
		}
		return true;
	}

	private validateDependencyDraftOrShow(
		operonId: string,
		fieldValues: Record<string, string>,
	): boolean {
		const changes = this.getDependencyDraftChanges(operonId, fieldValues);
		if (changes.length === 0) return true;
		const validation = this.dependencyManager.validateDependencyChanges(changes);
		if (validation.ok) return true;
		this.showDependencyValidationRejected(validation);
		return false;
	}

	private async syncDependencyPayloadChanges(
		task: IndexedTask,
		payload: Record<string, string>,
		mode: 'merge' | 'replace',
	): Promise<void> {
		if (this.indexer.hasDuplicateOperonIdConflict(task.operonId)) return;
		for (const change of this.getDependencyPayloadChanges(task, payload, mode)) {
			await this.dependencyManager.processDependencyChange(
				task.operonId,
				change.field,
				change.oldValue,
				change.newValue,
				{ validate: false },
			);
		}
	}

	private showDependencyValidationRejected(validation: Exclude<DependencyEdgeValidationResult, { ok: true }>): void {
		const relation = t('taskEditor', 'dependencyRejectedRelation', {
			from: validation.fromId,
			to: validation.toId,
		});
		const message = validation.reason === 'self'
			? t('taskEditor', 'dependencyRejectedSelfMessage')
			: t('taskEditor', 'dependencyRejectedCycleMessage', {
				cycle: validation.cyclePath.join(' -> '),
			});
		new Notice(t('notifications', 'dependencyLinkRejected'));
		new ConfirmActionModal(this.app, {
			title: t('taskEditor', 'dependencyRejectedTitle'),
			message,
			readOnly: true,
			dismissText: t('taskEditor', 'dependencyClose'),
			detailsTable: [
				{
					label: t('taskEditor', 'dependencyRejectedRelationLabel'),
					before: relation,
					after: '',
				},
			],
		}, () => undefined).open();
	}

	private async guardTaskStatusChangeOrShow(
		task: IndexedTask,
		payload: Record<string, string>,
		options: { mode?: 'merge' | 'replace' } = {},
	): Promise<boolean> {
		const attempt = resolveDependencyStatusChangeAttempt(task, payload, {
			mode: options.mode ?? 'merge',
		});
		if (!attempt) return true;

		const blockers = resolveActiveBlockers(
			task,
			operonId => this.indexer.getTask(operonId),
			this.settings.pipelines,
			() => this.indexer.getAllTasks(),
		);
		if (blockers.length === 0) return true;

		this.blockedStatusWriteSuppressFallbackUntilById.set(task.operonId, Date.now() + 1000);
		this.showBlockedTaskModal(task, attempt, blockers);
		this.refreshViews();
		return false;
	}

	private showBlockedTaskModal(
		task: IndexedTask,
		attempt: DependencyStatusChangeAttempt,
		blockers: ActiveDependencyBlocker[],
	): void {
		new Notice(t('notifications', 'dependencyStatusBlocked'));
		new BlockedTaskModal(this.app, {
			task,
			attempt,
			blockers,
			onOpenTask: operonId => this.openEditorForId(operonId),
			onCopyOperonId: operonId => this.copyOperonIdToClipboard(operonId),
		}).open();
	}

	private async copyOperonIdToClipboard(operonId: string): Promise<void> {
		try {
			await navigator.clipboard.writeText(operonId);
			new Notice(t('notifications', 'operonIdCopied'));
		} catch {
			new Notice(t('notifications', 'clipboardWriteFailed'));
		}
	}

	private shouldSuppressLivePreviewFallbackAfterBlockedStatus(operonId: string): boolean {
		const until = this.blockedStatusWriteSuppressFallbackUntilById.get(operonId);
		if (!until) return false;
		if (until < Date.now()) {
			this.blockedStatusWriteSuppressFallbackUntilById.delete(operonId);
			return false;
		}
		return true;
	}

	private async updateTaskDependencyFieldAndRefresh(
		operonId: string,
		field: DependencyFieldKey,
		value: string,
	): Promise<void> {
		await this.updateTaskFieldAndRefresh(operonId, field, value);
	}

	private async attachCreatorSubtasksToParent(
		parentId: string,
		subtaskIds: string[],
		parentTaskId?: string | null,
	): Promise<void> {
		const normalizedParentId = parentId.trim();
		if (!normalizedParentId) return;
		const parentTask = this.indexer.getTask(normalizedParentId);
		const excludedIds = new Set(buildSubtaskExcludedIds({
			allTasks: this.indexer.getAllTasks(),
			currentTaskId: normalizedParentId,
			parentTaskId: parentTaskId ?? parentTask?.fieldValues['parentTask'],
		}));
		const uniqueSubtaskIds = Array.from(new Set(subtaskIds.map(value => value.trim()).filter(Boolean)))
			.filter(subtaskId => !excludedIds.has(subtaskId));
		for (const subtaskId of uniqueSubtaskIds) {
			await this.writeParentToExistingChildTask(subtaskId, normalizedParentId);
		}
	}

	private async applyCreatorDependencyLinks(parentId: string, draft: TaskCreatorDraft): Promise<void> {
		const normalizedParentId = parentId.trim();
		if (!normalizedParentId) return;
		const blocking = (draft.fieldValues['blocking'] ?? '').trim();
		const blockedBy = (draft.fieldValues['blockedBy'] ?? '').trim();
		if (blocking) {
			await this.dependencyManager.processDependencyChange(normalizedParentId, 'blocking', '', blocking, { validate: false });
		}
		if (blockedBy) {
			await this.dependencyManager.processDependencyChange(normalizedParentId, 'blockedBy', '', blockedBy, { validate: false });
		}
	}

	private async applyCreatorPinnedState(taskId: string, draft: TaskCreatorDraft): Promise<void> {
		const normalizedTaskId = taskId.trim();
		if (!normalizedTaskId || !this.pinnedCache) return;
		const shouldPin = (draft.fieldValues['pinned'] ?? '').trim() === 'true';
		if (!shouldPin) return;
		await this.pinnedCache.pin(normalizedTaskId);
	}

	private async finalizeTaskCreatorCreatedTask(
		createdOperonId: string,
		draft: TaskCreatorDraft,
		parentTaskId?: string | null,
	): Promise<void> {
		const normalizedOperonId = createdOperonId.trim();
		if (!normalizedOperonId) return;
		if (draft.subtaskIds.length > 0) {
			await this.attachCreatorSubtasksToParent(
				normalizedOperonId,
				draft.subtaskIds,
				parentTaskId,
			);
		}
		await this.applyCreatorDependencyLinks(normalizedOperonId, draft);
		await this.applyCreatorPinnedState(normalizedOperonId, draft);
		const createdTask = this.indexer.getTask(normalizedOperonId) ?? null;
		await this.syncRepeatSeriesEntryIfNeeded(createdTask);
		await this.applyInlineRepeatCompletionModeIfRequested(createdTask, draft.inlineCompletionMode);
		const hasParent = !!createdTask?.fieldValues['parentTask']?.trim();
		const hasChildren = this.indexer.secondary.getChildIds(normalizedOperonId).size > 0;
		if (createdTask && (hasParent || hasChildren)) {
			await this.refreshAggregateTotalsAfterTaskMutation(null, createdTask, {
				modifiedTimestamp: (createdTask.fieldValues['datetimeModified'] ?? '').trim() || localNow(),
			});
		}
	}

	private buildTaskCreatorFilterDraft(
		draft: TaskCreatorDraft,
		checkbox: IndexedTask['checkbox'],
	): {
		description: string;
		checkbox: IndexedTask['checkbox'];
		fieldValues: Record<string, string>;
		tags: string[];
	} {
		return {
			description: this.normalizeTaskCreatorText(draft.description),
			checkbox,
			fieldValues: this.buildTaskCreatorSeedFieldValues(draft),
			tags: [...draft.tags],
		};
	}

	private buildFilterDraftFromIndexedTask(task: IndexedTask): {
		description: string;
		checkbox: IndexedTask['checkbox'];
		fieldValues: Record<string, string>;
		tags: string[];
	} {
		return {
			description: task.description,
			checkbox: task.checkbox,
			fieldValues: { ...task.fieldValues },
			tags: [...task.tags],
		};
	}

	private getCreatedInlineTaskFilterDraft(
		operonId: string,
		fallbackDraft: TaskCreatorDraft,
		fallbackCheckbox: IndexedTask['checkbox'],
	): {
		description: string;
		checkbox: IndexedTask['checkbox'];
		fieldValues: Record<string, string>;
		tags: string[];
	} {
		const task = this.indexer.getTask(operonId.trim());
		return task
			? this.buildFilterDraftFromIndexedTask(task)
			: this.buildTaskCreatorFilterDraft(fallbackDraft, fallbackCheckbox);
	}

	private getCreatedFileTaskForFilterDraft(created: CreatedCalendarFileTask): IndexedTask | null {
		const createdOperonId = (created.fieldValues['operonId'] ?? '').trim();
		return (createdOperonId ? this.indexer.getTask(createdOperonId) ?? null : null)
			?? this.indexer.getFileTaskByPath(created.file.path)
			?? null;
	}

	private resolveIndexedTaskSourceFolder(task: IndexedTask): string | null {
		const file = this.app.vault.getAbstractFileByPath(task.primary.filePath);
		if (!(file instanceof TFile) || file.extension !== 'md') return null;
		return resolveIndexedTaskSourceFolderPath(task);
	}

	private resolveTaskCreatorFileTargetFolderOverride(draft: TaskCreatorDraft): string | null {
		return resolveTaskCreatorFileTargetFolderOverrideDecision({
			draft,
			settings: this.settings,
			getTaskById: parentTaskId => this.indexer.getTask(parentTaskId) ?? null,
			resolveSourceFolder: parentTask => this.resolveIndexedTaskSourceFolder(parentTask),
		});
	}

	private async createFileTaskFromCreatorDraft(
		draft: TaskCreatorDraft,
		options: {
			fallbackFile?: TFile | null;
			reopenCreator: (draft: TaskCreatorDraft) => void | Promise<void>;
			seedTagsPresent?: boolean;
			targetFolderOverride?: string | null;
			onCreated?: (created: CreatedCalendarFileTask, draft: TaskCreatorDraft) => void | Promise<void>;
			rollbackOnFinalizeFailure?: boolean;
		},
	): Promise<boolean> {
		const preservedDraft = cloneTaskCreatorDraft(draft);
		const selectedTemplate = findFileTaskTemplateOptionById(
			this.getFileTaskTemplateOptions(),
			preservedDraft.fileTemplateId,
		);
		if (!selectedTemplate) {
			new Notice(t('notifications', 'chooseFileTaskTemplateFirst'));
			await options.reopenCreator(preservedDraft);
			return false;
		}

		try {
			const submitSeed = buildTaskCreatorSubmitFieldSeed(preservedDraft);
			const created = await this.createFileTaskFromTemplateSelection(selectedTemplate, {
				fallbackFile: options.fallbackFile ?? null,
				initialDescription: this.normalizeTaskCreatorText(preservedDraft.description),
				seedFieldValues: submitSeed.fieldValues,
				seedFieldPresence: submitSeed.fieldPresence,
				explicitEmptyFieldKeys: submitSeed.explicitEmptyFieldKeys,
				seedTags: [...preservedDraft.tags],
				seedTagsPresent: options.seedTagsPresent === true ||
					preservedDraft.tags.length > 0 ||
					preservedDraft.explicitFieldKeys.includes('tags'),
				targetFolderOverride: options.targetFolderOverride
					?? this.resolveTaskCreatorFileTargetFolderOverride(preservedDraft),
				openEditorOnCreate: false,
			});
			if (!created) {
				await options.reopenCreator(preservedDraft);
				return false;
			}
			const createdOperonId = (created.fieldValues['operonId'] ?? '').trim();
			try {
				await this.indexer.reindexFilePath(created.file.path, { notify: false });
				await this.finalizeTaskCreatorCreatedTask(
					createdOperonId,
					preservedDraft,
					created.fieldValues['parentTask'],
				);
				await options.onCreated?.(created, preservedDraft);
			} catch (error) {
				console.error('Operon: file task was created but creator follow-up failed', error);
				this.refreshViews();
				if (options.rollbackOnFinalizeFailure) {
					const rolledBack = await this.deleteYamlTaskByPath(created.file.path).catch(() => false);
					if (!rolledBack) {
						console.error('Operon: failed to roll back file task after public creation failure', created.file.path);
					}
					return false;
				}
				new Notice(t('notifications', 'creatorPostCreateFinalizeFailed'));
				return true;
			}
			this.refreshViews();
			this.showTaskNotice('file-created', {
				description: preservedDraft.description,
				fileBasename: created.file.basename,
				indexedDescription: this.getCreatedFileTaskForFilterDraft(created)?.description,
				operonId: createdOperonId,
			});
			return true;
		} catch (error) {
			console.error('Operon: failed to create file task from creator draft', error);
			new Notice(t('notifications', 'creatorFileTaskCreateFailed'));
			await options.reopenCreator(preservedDraft);
			return false;
		}
	}

	private async startFileTaskCreationFromCreatorDraft(draft: TaskCreatorDraft): Promise<boolean> {
		return await this.createFileTaskFromCreatorDraft(draft, {
			fallbackFile: this.getActiveMarkdownFile(),
			reopenCreator: preservedDraft => this.openTaskCreator(preservedDraft),
		});
	}

	private async resolveTaskCreatorInlineTargetFile(options: {
		targetDateKey?: string | null;
		targetPath?: string | null;
		forceDailyNote?: boolean;
		excludedFilePath?: string | null;
	} = {}): Promise<TaskCreatorInlineTargetResolution> {
		const targetDateKey = options.targetDateKey?.trim() || localToday();
		const explicitTargetPath = options.targetPath?.trim();
		if (explicitTargetPath) {
			const explicitTargetFile = await this.resolveOrCreateInlineTaskTargetFile(explicitTargetPath);
			if (!(explicitTargetFile instanceof TFile)) return { kind: 'failed' };
			return {
				kind: 'target',
				file: explicitTargetFile,
				fallbackParentTaskId: null,
				fallbackParentFieldValues: null,
				fallbackParentTags: null,
				dailyDateHeading: null,
			};
		}
		if (options.forceDailyNote === true) {
			const dailyNote = await this.resolveOrCreateCalendarDailyNoteResult(targetDateKey);
			if (!(dailyNote.file instanceof TFile)) {
				new Notice(t('notifications', 'dailyNoteResolveFailed'));
				return { kind: 'failed' };
			}
			return {
				kind: 'target',
				file: dailyNote.file,
				fallbackParentTaskId: dailyNote.wasCreated ? dailyNote.operonParentTaskId : null,
				fallbackParentFieldValues: dailyNote.wasCreated ? dailyNote.operonParentFieldValues : null,
				fallbackParentTags: dailyNote.wasCreated ? dailyNote.operonParentTags : null,
				dailyDateHeading: null,
			};
		}
		const saveMode = this.resolveEffectiveInlineTaskSaveMode();
		if (saveMode === 'daily-notes') {
			const dailyNote = await this.resolveOrCreateCalendarDailyNoteResult(targetDateKey);
			if (!(dailyNote.file instanceof TFile)) {
				new Notice(t('notifications', 'dailyNoteResolveFailed'));
				return { kind: 'failed' };
			}
			return {
				kind: 'target',
				file: dailyNote.file,
				fallbackParentTaskId: dailyNote.wasCreated ? dailyNote.operonParentTaskId : null,
				fallbackParentFieldValues: dailyNote.wasCreated ? dailyNote.operonParentFieldValues : null,
				fallbackParentTags: dailyNote.wasCreated ? dailyNote.operonParentTags : null,
				dailyDateHeading: null,
			};
		}
		if (saveMode === 'active-file') {
			const activeFile = this.getActiveMarkdownFile();
			const excludedFilePath = options.excludedFilePath?.trim() ?? '';
			if (activeFile && activeFile.path !== excludedFilePath) {
				return {
					kind: 'target',
					file: activeFile,
					fallbackParentTaskId: null,
					fallbackParentFieldValues: null,
					fallbackParentTags: null,
					dailyDateHeading: null,
				};
			}
		}
		if (saveMode === 'ask-every-time') {
			const selectedFile = await this.promptInlineTaskTargetFileSelection({
				excludedFilePath: options.excludedFilePath,
			});
			if (!(selectedFile instanceof TFile)) return { kind: 'cancelled' };
			return {
				kind: 'target',
				file: selectedFile,
				fallbackParentTaskId: null,
				fallbackParentFieldValues: null,
				fallbackParentTags: null,
				dailyDateHeading: null,
			};
		}

		const targetPath = this.resolveInlineTaskTargetFilePath();
		const targetFile = await this.resolveOrCreateInlineTaskTargetFile(targetPath);
		if (!(targetFile instanceof TFile)) {
			new Notice(t('notifications', 'inlineTaskTargetInvalid'));
			return { kind: 'failed' };
		}
		return {
			kind: 'target',
			file: targetFile,
			fallbackParentTaskId: null,
			fallbackParentFieldValues: null,
			fallbackParentTags: null,
			dailyDateHeading: await this.resolveInlineTaskSpecificFileHeading(targetDateKey),
		};
	}

	private resolveInlineTaskTargetFilePath(): string {
		return this.settings.inlineTaskTargetFile.trim() || DEFAULT_INLINE_TASK_TARGET_FILE;
	}

	private async resolveOrCreateInlineTaskTargetFile(targetPath: string): Promise<TFile | null> {
		if (!targetPath.endsWith('.md')) return null;

		const targetFile = this.app.vault.getAbstractFileByPath(targetPath);
		if (targetFile instanceof TFile && targetFile.extension === 'md') return targetFile;
		if (targetFile) return null;

		const folderPath = targetPath.split('/').slice(0, -1).join('/');
		await this.ensureFolderPathExists(folderPath);
		await this.app.vault.create(targetPath, '');
		const created = this.app.vault.getAbstractFileByPath(targetPath);
		return created instanceof TFile && created.extension === 'md' ? created : null;
	}

	private async resolveInlineTaskSpecificFileHeading(dateKey: string): Promise<string> {
		if (isDailyNotesCoreAvailable(this.app)) {
			const config = await loadDailyNotesCoreConfig(this.app);
			const formattedTitle = formatDailyNoteTitleFromDateKey(dateKey, config.format);
			if (formattedTitle) return `## [[${formattedTitle}]]`;
		}
		return `## [[${dateKey}]]`;
	}

	private buildTaskCreatorInlineTaskLine(
		draft: TaskCreatorDraft,
		filePath: string,
		lineNumber: number,
		inherited: SubtaskInitialFields,
		now: string,
	): { taskLine: string; operonId: string; fieldValues: Record<string, string> } | null {
		const description = this.normalizeTaskCreatorText(draft.description);
		if (!description) return null;

		const provisionalTaskLine = this.buildNewInlineTaskWithInheritedFields(
			description,
			'open',
			inherited,
			now,
			filePath,
			lineNumber,
		);
		const parsed = this.parseInlineTaskLine(provisionalTaskLine, lineNumber, filePath);
		if (!parsed?.operonId) return null;

		const currentFieldValues = Object.fromEntries(parsed.fields.map(field => [field.key, field.value]));
		const tagsExplicit = draft.explicitFieldKeys.includes('tags');
		const inheritedTags = tagsExplicit
			? []
			: inherited.tags ?? [];
		const submitTags = Array.from(new Set([
			...draft.tags.map(tag => tag.replace(/^#/, '').trim()).filter(Boolean),
			...inheritedTags.map(tag => tag.replace(/^#/, '').trim()).filter(Boolean),
		]));
		const normalizedPayload = normalizeTaskFieldPatch(
			currentFieldValues,
			{
				...this.buildTaskCreatorSeedFieldValues(draft),
				...(submitTags.length > 0 || tagsExplicit ? { tags: submitTags } : {}),
			},
			{
				getAllRepeatSeriesIds: () => this.storage.repeatSeries.getAllSeriesIds(),
				getRepeatSkipDates: (repeatSeriesId) => this.storage.repeatSeries.getSkipDates(repeatSeriesId),
			},
		);
		if (!this.applyFieldPayloadToParsedTask(parsed, normalizedPayload, currentFieldValues)) {
			return null;
		}
		this.touchParsedTaskModifiedTimestamp(parsed, now);

		return {
			taskLine: this.serializeInlineTask(parsed),
			operonId: parsed.operonId,
			fieldValues: this.buildParsedTaskFieldValues(parsed),
		};
	}

	private async insertTaskCreatorInlineTaskIntoFile(
		file: TFile,
		draft: TaskCreatorDraft,
		options: {
			fallbackParentTaskId?: string | null;
			fallbackParentFieldValues?: Record<string, string> | null;
			fallbackParentTags?: string[] | null;
			inlineHeading?: string;
			dailyDateHeading?: string | null;
			autoParentEnabled?: boolean;
		} = {},
	): Promise<{ operonId: string; lineNumber: number } | null> {
		const content = await this.app.vault.cachedRead(file);
		const dailyDateHeading = options.dailyDateHeading?.trim();
		const explicitInlineHeading = options.inlineHeading;
		const inlineHeadingKeyword = normalizeInlineTaskHeadingKeyword(this.settings.inlineTaskHeading);
		const insertTaskLine = (sourceContent: string, taskLine: string) => {
			if (dailyDateHeading) {
				return insertInlineTaskUnderHeading(
					sourceContent,
					dailyDateHeading,
					taskLine,
				);
			}
			if (explicitInlineHeading !== undefined) {
				return insertInlineTaskUnderHeading(
					sourceContent,
					resolveCalendarInlineHeading(explicitInlineHeading),
					taskLine,
				);
			}
			return insertInlineTaskUnderFirstHeadingKeyword(sourceContent, inlineHeadingKeyword, taskLine);
		};
		const insertionPreview = insertTaskLine(content, '- [ ]');
		const now = localNow();
		const autoParentTaskId = resolveFileTaskAutoParentOperonId({
			enabled: options.autoParentEnabled ?? this.settings.autoParentFileTask,
			filePath: file.path,
			tasks: this.indexer.getAllTasks(),
			frontmatter: this.app.metadataCache.getFileCache(file)?.frontmatter ?? null,
			keyMappings: this.settings.keyMappings,
		});
		const inherited = autoParentTaskId
			? resolveSubtaskInitialFields(autoParentTaskId, this.indexer, this.settings)
			: resolveSubtaskInitialFieldsFromParentValues(
				options.fallbackParentTaskId ?? null,
				options.fallbackParentFieldValues ?? null,
				this.settings,
				options.fallbackParentTags ?? null,
			);
		const createdLine = this.buildTaskCreatorInlineTaskLine(
			draft,
			file.path,
			insertionPreview.insertedLineNumber,
			inherited,
			now,
		);
		if (!createdLine) return null;
		if (!this.validateDependencyDraftOrShow(createdLine.operonId, createdLine.fieldValues)) return null;
		const insertion = insertTaskLine(content, createdLine.taskLine);
		this.suppressRawTaskCreationNotice(createdLine.operonId);
		await this.app.vault.modify(file, insertion.content);
		return {
			operonId: createdLine.operonId,
			lineNumber: insertion.insertedLineNumber,
		};
	}

	private async insertTaskCreatorInlineTaskUsingDefaultTarget(
		draft: TaskCreatorDraft,
		options: TaskCreatorInlineCreationOptions = {},
	): Promise<TaskCreatorInlineCreationAttempt> {
		const target = await this.resolveTaskCreatorInlineTargetFile({
			targetDateKey: options.targetDateKey,
			targetPath: options.targetPath,
			forceDailyNote: options.forceDailyNote,
		});
		if (target.kind !== 'target') return target;

		const created = await this.insertTaskCreatorInlineTaskIntoFile(
			target.file,
			draft,
			{
				fallbackParentTaskId: target.fallbackParentTaskId,
				fallbackParentFieldValues: target.fallbackParentFieldValues,
				fallbackParentTags: target.fallbackParentTags,
				dailyDateHeading: target.dailyDateHeading,
			},
		);
		if (!created) return { kind: 'failed' };

		return {
			kind: 'created',
			result: {
				operonId: created.operonId,
				filePath: target.file.path,
				lineNumber: created.lineNumber,
			},
		};
	}

	private async insertTaskCreatorInlineTaskBelowInlineParent(
		draft: TaskCreatorDraft,
		parentTask: IndexedTask,
	): Promise<QuickInlineTaskCreationResult | null> {
		if (parentTask.primary.format !== 'inline') return null;

		const parentPath = parentTask.primary.filePath;
		const parentFile = this.app.vault.getAbstractFileByPath(parentPath);
		if (!(parentFile instanceof TFile) || parentFile.extension !== 'md') return null;

		const content = await this.app.vault.cachedRead(parentFile);
		const insertedLineNumber = resolveInlineParentInsertionLineNumber({
			content,
			parentTask,
			parseInlineTaskLine: (line, lineNumber, filePath) => this.parseInlineTaskLine(line, lineNumber, filePath),
		});
		if (insertedLineNumber === null) return null;

		const lines = content.split('\n');
		const createdLine = this.buildTaskCreatorInlineTaskLine(
			draft,
			parentPath,
			insertedLineNumber,
			{},
			localNow(),
		);
		if (!createdLine) return null;
		if (!this.validateDependencyDraftOrShow(createdLine.operonId, createdLine.fieldValues)) return null;

		lines.splice(insertedLineNumber, 0, createdLine.taskLine);
		this.suppressRawTaskCreationNotice(createdLine.operonId);
		await this.app.vault.modify(parentFile, lines.join('\n'));
		return {
			operonId: createdLine.operonId,
			filePath: parentPath,
			lineNumber: insertedLineNumber,
		};
	}

	private async insertTaskCreatorInlineTaskInsideFileParent(
		draft: TaskCreatorDraft,
		parentTask: IndexedTask,
		headingKeyword: string,
	): Promise<QuickInlineTaskCreationResult | null> {
		if (parentTask.primary.format !== 'yaml') return null;

		const parentPath = parentTask.primary.filePath;
		const parentFile = this.app.vault.getAbstractFileByPath(parentPath);
		if (!(parentFile instanceof TFile) || parentFile.extension !== 'md') return null;

		const content = await this.app.vault.cachedRead(parentFile);
		const insertionPreview = insertInlineTaskUnderFirstHeadingKeyword(content, headingKeyword, '- [ ]');
		const createdLine = this.buildTaskCreatorInlineTaskLine(
			draft,
			parentPath,
			insertionPreview.insertedLineNumber,
			{},
			localNow(),
		);
		if (!createdLine) return null;
		if (!this.validateDependencyDraftOrShow(createdLine.operonId, createdLine.fieldValues)) return null;

		const insertion = insertInlineTaskUnderFirstHeadingKeyword(content, headingKeyword, createdLine.taskLine);
		this.suppressRawTaskCreationNotice(createdLine.operonId);
		await this.app.vault.modify(parentFile, insertion.content);
		return {
			operonId: createdLine.operonId,
			filePath: parentPath,
			lineNumber: insertion.insertedLineNumber,
		};
	}

	private async insertTaskCreatorInlineTaskWithResolvedTarget(
		draft: TaskCreatorDraft,
		options: TaskCreatorInlineCreationOptions = {},
	): Promise<TaskCreatorInlineCreationAttempt> {
		if (options.parentAwarePlacement !== false) {
			const placement = resolveTaskCreatorInlinePlacement({
				draft,
				settings: this.settings,
				getTaskById: parentTaskId => this.indexer.getTask(parentTaskId) ?? null,
			});
			if (placement.kind === 'below-inline-parent') {
				const created = await this.insertTaskCreatorInlineTaskBelowInlineParent(draft, placement.parentTask);
				if (created) return { kind: 'created', result: created };
			}

			if (placement.kind === 'inside-file-parent') {
				const created = await this.insertTaskCreatorInlineTaskInsideFileParent(
					draft,
					placement.parentTask,
					placement.headingKeyword,
				);
				if (created) return { kind: 'created', result: created };
			}
		}

		return await this.insertTaskCreatorInlineTaskUsingDefaultTarget(draft, {
			targetDateKey: options.targetDateKey,
			targetPath: options.targetPath,
			forceDailyNote: options.forceDailyNote,
		});
	}

	private async createInlineTaskFromCreatorDraftResult(
		draft: TaskCreatorDraft,
		options: TaskCreatorInlineCreationOptions = {},
	): Promise<QuickInlineTaskCreationResult | null> {
		const creation = await this.insertTaskCreatorInlineTaskWithResolvedTarget(draft, {
			targetDateKey: options.targetDateKey,
			targetPath: options.targetPath,
			forceDailyNote: options.forceDailyNote,
			parentAwarePlacement: options.parentAwarePlacement,
		});
		if (creation.kind === 'cancelled') return null;
		if (creation.kind !== 'created') {
			new Notice(t('notifications', 'inlineTaskCreateFailed'));
			return null;
		}
		const created = creation.result;
		const createdFilePath = created.filePath;
		const createdLineNumber = created.lineNumber;
		if (!createdFilePath || createdLineNumber === undefined) {
			new Notice(t('notifications', 'inlineTaskCreateFailed'));
			return null;
		}

		this.showTaskNotice('inline-created', {
			description: draft.description,
			operonId: created.operonId,
		});
		await this.indexer.reindexFilePath(createdFilePath);
		const createdTask = this.indexer.getTask(created.operonId);
		await this.finalizeTaskCreatorCreatedTask(
			created.operonId,
			draft,
			createdTask?.fieldValues['parentTask'],
		);
		this.refreshViews();
		this.refreshMarkdownAfterInlineAuthoring(createdFilePath);
		return {
			operonId: created.operonId,
			filePath: createdFilePath,
			lineNumber: createdLineNumber,
		};
	}

	private async createInlineTaskFromCreatorDraft(draft: TaskCreatorDraft): Promise<boolean> {
		return await this.createInlineTaskFromCreatorDraftResult(draft) !== null;
	}

	private async convertInlineTaskToFileTaskById(operonId: string): Promise<void> {
		if (this.redirectDuplicateOperonIdAction(operonId)) return;
		const task = this.indexer.getTask(operonId);
		if (!task || task.primary.format !== 'inline') return;

		const file = this.app.vault.getAbstractFileByPath(task.primary.filePath);
		if (!(file instanceof TFile)) {
			new Notice(t('notifications', 'inlineToFileTaskFailed'));
			return;
		}

		const parsed = await this.loadEditableParsedTask(task);
		if (parsed.operonId !== operonId) {
			new Notice(t('notifications', 'inlineToFileTaskFailed'));
			return;
		}

		this.openFileTaskTemplatePicker((selectedTemplate) => {
			void this.finishInlineTaskToFileTaskConversion(file, parsed, selectedTemplate).catch((error) => {
				console.error('Operon: failed to create a file task from contextual menu', error);
				new Notice(t('notifications', 'inlineToFileTaskFailed'));
			});
		});
	}

	private async handleCreateFileTaskCommand(fallbackFile: TFile | null = null): Promise<void> {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const file = view?.file ?? null;
		const editor = view?.editor ?? null;
		const inlineTask = this.getConvertibleInlineTaskAtCursor(file, editor);
		if (inlineTask && file instanceof TFile) {
			this.openFileTaskTemplatePicker((selectedTemplate) => {
				void this.finishInlineTaskToFileTaskConversion(file, inlineTask, selectedTemplate).catch((error) => {
					console.error('Operon: failed to create a file task from the current inline task', error);
					new Notice(t('notifications', 'inlineToFileTaskFailed'));
				});
			});
			return;
		}

		const sourceSeed = this.resolveCreateFileTaskSourceSeed(view ?? null, editor);
		if (editor?.somethingSelected() && !sourceSeed) return;
		if (!sourceSeed) {
			this.openTaskCreator(null, { submitMode: 'file-only' });
			return;
		}

		this.openFileTaskTemplatePicker((selectedTemplate) => {
			void this.createFileTaskFromTemplateSelection(selectedTemplate, {
				fallbackFile: fallbackFile ?? file,
				initialDescription: sourceSeed.description,
				sourceReplacement: sourceSeed,
				sourceContextFilePath: sourceSeed?.sourceFilePath ?? file?.path ?? null,
				openEditorOnCreate: false,
			}).then(async (created) => {
				if (!created) return;
				await this.indexer.reindexFilePath(created.file.path, { notify: false });
				if (sourceSeed?.sourceFilePath) {
					await this.indexer.reindexFilePath(sourceSeed.sourceFilePath, { notify: false });
				}
				this.refreshViews();
				this.showTaskNotice('file-created', {
					description: sourceSeed?.description,
					fileBasename: created.file.basename,
					indexedDescription: this.getCreatedFileTaskForFilterDraft(created)?.description,
					operonId: created.fieldValues['operonId'],
				});
			}).catch((error) => {
				console.error('Operon: failed to create file task from selected template', error);
				new Notice(t('notifications', 'selectedTemplateFileTaskCreateFailed'));
			});
		});
	}

	private async resolveFreshNoteToFileTaskConversion(
		file: TFile,
		persistOpenEditorBuffer: boolean,
	): Promise<{ file: TFile; document: ParsedFrontmatterDocument } | null> {
		const currentFile = this.app.vault.getAbstractFileByPath(file.path);
		if (!(currentFile instanceof TFile) || currentFile !== file || currentFile.extension !== 'md') return null;
		const openView = this.getMarkdownViewForPath(currentFile.path);
		if (openView && persistOpenEditorBuffer) {
			await this.persistMarkdownViewBuffer(openView);
		}
		const refreshedFile = this.app.vault.getAbstractFileByPath(file.path);
		if (refreshedFile !== file) return null;
		if (isOperonExcludedPath(currentFile.path, this.settings)) return null;
		if (!this.hasAvailableFileTaskTemplateOption()) return null;
		if (this.indexer.getFileTaskByPath(currentFile.path)) return null;

		const document = openView && !persistOpenEditorBuffer
			? parseFrontmatterDocument(openView.editor.getValue(), this.settings.keyMappings)
			: await this.loadParsedFrontmatterDocument(currentFile);
		const existingOperonId = document.managedFieldValues['operonId']?.trim();
		if (document.managedFieldPresence.has('operonId') && existingOperonId) return null;
		return { file: currentFile, document };
	}

	private async openNativeFileTaskConversionPicker(file: TFile): Promise<void> {
		const initialTarget = await this.resolveFreshNoteToFileTaskConversion(file, false);
		if (!initialTarget) {
			new Notice(t('notifications', 'nativeFileTaskConversionUnavailable'));
			return;
		}

		this.openFileTaskTemplatePicker(selectedTemplate => {
			void this.finishNativeFileTaskConversion(file, selectedTemplate).catch(error => {
				console.error('Operon: failed to convert a note from the native context menu', error);
				new Notice(t('notifications', 'noteToFileTaskFailed'));
			});
		});
	}

	private async finishNativeFileTaskConversion(
		file: TFile,
		selectedTemplate: FileTaskTemplateOption,
	): Promise<void> {
		const target = await this.resolveFreshNoteToFileTaskConversion(file, true);
		const currentTemplate = findFileTaskTemplateOptionById(
			this.getFileTaskTemplateOptions(),
			selectedTemplate.id,
		);
		if (!target || !currentTemplate) {
			new Notice(t('notifications', 'nativeFileTaskConversionUnavailable'));
			return;
		}
		await this.finishNoteToFileTaskConversion(target.file, target.document, currentTemplate);
	}

	private async convertNoteToFileTask(file: TFile): Promise<void> {
		const confirmed = await this.promptConfirmAction(
			t('modals', 'convertCurrentNoteTitle'),
			t('modals', 'convertCurrentNoteMessage'),
			t('modals', 'convertWithTemplate'),
			t('buttons', 'cancel'),
		);
		if (!confirmed) return;

		await this.openNativeFileTaskConversionPicker(file);
	}

	private async finishNoteToFileTaskConversion(
		file: TFile,
		document: ParsedFrontmatterDocument,
		selectedTemplate: FileTaskTemplateOption,
	): Promise<void> {
		const now = localNow();
		const templateResult = await this.loadFileTaskTemplateDocumentFromOption(selectedTemplate);
		const seedFieldValues = { ...document.managedFieldValues };
		if (!(seedFieldValues['operonId'] ?? '').trim() && templateResult.resolvedOperonIdSeed) {
			seedFieldValues['operonId'] = templateResult.resolvedOperonIdSeed;
		}
		const seedFieldPresence = new Set(document.managedFieldPresence);
		if ((seedFieldValues['operonId'] ?? '').trim()) {
			seedFieldPresence.add('operonId');
		}
		if (!this.applyPipelineMinimalFileTaskTemplateStatus(
			selectedTemplate,
			seedFieldValues,
			seedFieldPresence,
		)) return;
		const template = this.resolveLoadedFileTaskTemplateDocument(
			templateResult,
			this.buildOperonTemplatePlaceholderContext(file.basename, seedFieldValues, now),
		);
		const draft = this.buildFileTaskDraft({
			description: file.basename,
			fieldValues: seedFieldValues,
			fieldPresence: seedFieldPresence,
			tags: [...document.tags],
			tagsPresent: document.tagsPresent,
			frontmatterDocument: document,
		}, template, now, 'preserve-source');
		const templateContext = this.buildOperonTemplatePlaceholderContext(file.basename, draft.fieldValues, now);
		if (!this.validateDependencyDraftOrShow(draft.operonId, draft.fieldValues)) return;

		const renderedContent = await this.maybeProcessFileTaskTemplaterContent(
			file,
			draft.content,
			template,
			selectedTemplate,
		);
		const resolvedContent = this.resolveFileTaskTemplatePlaceholdersInContent(renderedContent, templateContext, file.basename, {
			resolveBodyText: false,
		});
		await this.app.vault.modify(file, resolvedContent);
		const finalDocument = await this.loadParsedFrontmatterDocument(file);
		await this.indexer.reindexFilePath(file.path, { notify: false });
		this.refreshViews();
		this.showTaskNotice('file-created', {
			fileBasename: file.basename,
			indexedDescription: this.indexer.getFileTaskByPath(file.path)?.description,
			operonId: finalDocument.managedFieldValues['operonId'],
		});
	}

	private async finishInlineTaskToFileTaskConversion(
		file: TFile,
		parsed: ParsedTask,
		selectedTemplate: FileTaskTemplateOption,
		targetFolderOverride?: string | null,
	): Promise<void> {
		const folder = this.getTargetFileTaskFolder(file, targetFolderOverride);

		const initialDescription = parsed.description || t('taskEditor', 'newOperonTaskFile');
		const now = localNow();
		const templateResult = await this.loadFileTaskTemplateDocumentFromOption(selectedTemplate);
		const baseFieldValues = this.buildParsedTaskFieldValues(parsed);
		if (!(baseFieldValues['operonId'] ?? '').trim() && templateResult.resolvedOperonIdSeed) {
			baseFieldValues['operonId'] = templateResult.resolvedOperonIdSeed;
		}
		const baseFieldPresence = new Set(parsed.fields.map(field => field.key));
		const linkedSeed = await this.buildLinkedFileTaskSeed(
			file.path,
			baseFieldValues,
			baseFieldPresence,
			baseFieldValues['parentTask'],
		);
		if (!this.applyPipelineMinimalFileTaskTemplateStatus(
			selectedTemplate,
			linkedSeed.fieldValues,
			linkedSeed.fieldPresence,
		)) return;
		const template = this.resolveLoadedFileTaskTemplateDocument(
			templateResult,
			this.buildOperonTemplatePlaceholderContext(initialDescription, linkedSeed.fieldValues, now),
		);
		const draft = this.buildFileTaskDraft({
			description: initialDescription,
			fieldValues: linkedSeed.fieldValues,
			fieldPresence: linkedSeed.fieldPresence,
			tags: [...parsed.tags],
			tagsPresent: parsed.tags.length > 0,
		}, template, now, 'use-template');
		const templateContext = this.buildOperonTemplatePlaceholderContext(initialDescription, draft.fieldValues, now);
		if (!this.validateDependencyDraftOrShow(draft.operonId, draft.fieldValues)) return;

		await this.ensureFileTaskFolder(folder);
		const sanitized = this.sanitizeTaskFileName(initialDescription) || t('taskEditor', 'untitledTaskFile');
		const filePath = this.formatConverter.getUniqueFilePath(folder, sanitized);
		const needsTemplaterProcessing = this.fileTaskContentNeedsTemplaterProcessing(template, draft.content);
		const rawPlainCheckboxLines = this.settings.inlineToFileTaskMovePlainCheckboxes
			? await this.collectAttachedInlineTaskPlainCheckboxLines(file.path, draft.operonId, parsed.lineNumber)
			: [];
		const movedPlainCheckboxLines = this.normalizeMovedInlineTaskPlainCheckboxLines(
			rawPlainCheckboxLines.map(line => line.rawLine),
		);
		await this.withInlineToFileTaskTransitionSafePass(
			draft.operonId,
			file.path,
			parsed.lineNumber,
			filePath,
			async () => {
				await this.app.vault.create(filePath, needsTemplaterProcessing ? '' : draft.content);
				const created = this.app.vault.getAbstractFileByPath(filePath);
				if (!(created instanceof TFile)) return;

				const renderedContent = await this.maybeProcessFileTaskTemplaterContent(
					created,
					draft.content,
					template,
					selectedTemplate,
					{ runMode: needsTemplaterProcessing ? 0 : 2 },
				);
				const resolvedContent = this.prependMovedPlainCheckboxLinesToFileTaskContent(
					this.resolveFileTaskTemplatePlaceholdersInContent(renderedContent, templateContext, created.basename),
					movedPlainCheckboxLines,
				);
				if (!this.isInlineToFileTaskTransitionContentValid(resolvedContent, draft.operonId)) {
					const rolledBack = await this.rollbackCreatedFileTask(filePath);
					if (!rolledBack) {
						new Notice(t('notifications', 'inlineReplacementRollbackFailed', { path: filePath }));
					} else {
						new Notice(t('notifications', 'inlineToFileTaskFailed'));
					}
					return;
				}
				if (resolvedContent !== await this.app.vault.cachedRead(created)) {
					await this.app.vault.modify(created, resolvedContent);
				}

				const replacedInline = await this.replaceInlineTaskById(
					file.path,
					draft.operonId,
					this.buildFileTaskWikilink(created),
					parsed.lineNumber,
					{ removePlainCheckboxLines: rawPlainCheckboxLines },
				);
				if (!replacedInline) {
					const rolledBack = await this.rollbackCreatedFileTask(filePath);
					if (!rolledBack) {
						new Notice(t('notifications', 'inlineReplacementRollbackFailed', { path: filePath }));
					}
					return;
				}

				await this.runInlineToFileTaskTransitionSafePass(file.path, created.path);
				const markdownScope = createScopedMarkdownRefreshScope([file.path], 'inline-to-file-conversion');
				this.refreshViews({
					reason: 'inline-to-file-conversion',
					markdownScope,
				});
				this.refreshMarkdownTaskSurfaces({
					scope: markdownScope,
					forceTaskWikilinkOverlayFilePath: created.path,
				});
				this.scheduleInlineToFileTaskMarkdownRefresh(markdownScope, created.path);
				this.scheduleInlineToFileTaskMetadataRefresh(markdownScope, created.path);
				this.showTaskNotice('inline-to-file', {
					description: initialDescription,
					fileBasename: created.basename,
					indexedDescription: this.indexer.getFileTaskByPath(created.path)?.description,
					operonId: draft.operonId,
				});
			},
		);
	}

	private async insertInlineTaskLineIntoFile(
		file: TFile,
		taskLine: string,
		options: { dailyDateHeading?: string | null } = {},
	): Promise<{ lineNumber: number } | null> {
		const content = await this.app.vault.cachedRead(file);
		const dailyDateHeading = options.dailyDateHeading?.trim();
		const normalizedTaskBlock = this.resolveOperonIdPlaceholdersInTaskBlock(taskLine);
		const insertion = dailyDateHeading
			? insertInlineTaskUnderHeading(content, dailyDateHeading, normalizedTaskBlock)
			: insertInlineTaskUnderFirstHeadingKeyword(
				content,
				normalizeInlineTaskHeadingKeyword(this.settings.inlineTaskHeading),
				normalizedTaskBlock,
			);
		await this.app.vault.modify(file, insertion.content);
		return {
			lineNumber: insertion.insertedLineNumber,
		};
	}

	private resolveFileTaskToInlineCursorTarget(): FileTaskToInlineCursorTarget | null {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return null;
		const file = view.file;
		if (!(file instanceof TFile)) return null;
		const editor = view.editor;
		if (editor.somethingSelected()) return null;
		const cursor = editor.getCursor();
		if (cursor.line < 0 || cursor.line > editor.lastLine()) return null;
		if (editor.getLine(cursor.line).trim()) return null;
		return {
			file,
			view,
			editor,
			lineNumber: cursor.line,
		};
	}

	private isFileTaskToInlineCursorTargetAvailable(
		target: FileTaskToInlineCursorTarget,
		sourceFilePath: string,
	): boolean {
		if (target.file.path === sourceFilePath) return false;
		if (target.view.file?.path !== target.file.path) return false;
		if (target.lineNumber < 0 || target.lineNumber > target.editor.lastLine()) return false;
		return !target.editor.getLine(target.lineNumber).trim();
	}

	private async insertInlineTaskLineAtCursorTarget(
		target: FileTaskToInlineCursorTarget,
		taskLine: string,
		sourceFilePath: string,
	): Promise<{ file: TFile; lineNumber: number } | null> {
		if (!this.isFileTaskToInlineCursorTargetAvailable(target, sourceFilePath)) return null;
		const normalizedTaskBlock = this.resolveOperonIdPlaceholdersInTaskBlock(taskLine);
		target.editor.setLine(target.lineNumber, normalizedTaskBlock);
		await this.persistMarkdownViewBuffer(target.view);
		return {
			file: target.file,
			lineNumber: target.lineNumber,
		};
	}

	private async handleConvertFileTaskToInlineTaskCommand(): Promise<void> {
		const cursorTarget = this.resolveFileTaskToInlineCursorTarget();
		const selectedTask = await promptTaskFinderSelection(
			this.app,
			this.indexer,
			() => this.settings,
			TASK_FINDER_SCOPE_CONVERT_FILE_TASK_TO_INLINE,
			{
				getProjectSerialDisplay: (operonId: string) => this.getProjectSerialDisplayForTask(operonId),
			},
		);
		if (!selectedTask) return;
		await this.convertFileTaskToInlineTask(selectedTask, cursorTarget);
	}

	private async convertFileTaskToInlineTaskById(operonId: string): Promise<void> {
		if (this.redirectDuplicateOperonIdAction(operonId)) return;
		const selectedTask = this.indexer.getTask(operonId);
		if (!selectedTask || selectedTask.primary.format !== 'yaml') return;
		await this.convertFileTaskToInlineTask(selectedTask, this.resolveFileTaskToInlineCursorTarget());
	}

	private async convertFileTaskToInlineTask(
		selectedTask: IndexedTask,
		cursorTarget: FileTaskToInlineCursorTarget | null,
	): Promise<void> {
		if (selectedTask.primary.format !== 'yaml') {
			new Notice(t('notifications', 'convertFileTaskSelectionRequiresFileTask'));
			return;
		}

		const file = this.app.vault.getAbstractFileByPath(selectedTask.primary.filePath);
		if (!(file instanceof TFile)) {
			new Notice(t('notifications', 'selectedFileTaskUnavailable'));
			return;
		}

		let indexedYamlTask = this.getYamlTaskByFilePath(file.path);
		if (!indexedYamlTask || indexedYamlTask.operonId !== selectedTask.operonId) {
			await this.indexer.reindexFilePath(file.path);
			indexedYamlTask = this.getYamlTaskByFilePath(file.path);
		}
		if (!indexedYamlTask || indexedYamlTask.operonId !== selectedTask.operonId) {
			new Notice(t('notifications', 'selectedFileTaskUnavailable'));
			return;
		}

		const confirmed = await this.promptConfirmAction(
			t('modals', 'convertFileTaskToInlineTitle'),
			t('modals', 'convertFileTaskToInlineMessage'),
			t('modals', 'convertAndMoveToTrash'),
			t('buttons', 'cancel'),
		);
		if (!confirmed) return;

		const inlineTaskLine = this.formatConverter.yamlToInline(indexedYamlTask.operonId);
		if (!inlineTaskLine?.trim()) {
			new Notice(t('notifications', 'fileTaskToInlineFailed'));
			return;
		}

		let suppressInlineInsertFailedNotice = false;
		const inserted = await this.withDuplicateConflictAutoOpenSuppressed(async () => {
			let insertedTarget = cursorTarget
				? await this.insertInlineTaskLineAtCursorTarget(cursorTarget, inlineTaskLine, file.path)
				: null;
			if (!insertedTarget) {
				const target = await this.resolveTaskCreatorInlineTargetFile({
					excludedFilePath: file.path,
				});
				if (target.kind === 'cancelled') {
					suppressInlineInsertFailedNotice = true;
					return null;
				}
				if (target.kind !== 'target') {
					suppressInlineInsertFailedNotice = true;
					return null;
				}
				if (target.file.path === file.path) {
					new Notice(t('notifications', 'sameFileInlineTarget'));
					suppressInlineInsertFailedNotice = true;
					return null;
				}
				const targetInserted = await this.insertInlineTaskLineIntoFile(target.file, inlineTaskLine, {
					dailyDateHeading: target.dailyDateHeading,
				});
				insertedTarget = targetInserted
					? {
						file: target.file,
						lineNumber: targetInserted.lineNumber,
					}
					: null;
			}
			if (!insertedTarget) return null;

			return await this.withFileTaskToInlineTransitionSafePass(
				indexedYamlTask.operonId,
				file.path,
				insertedTarget.file.path,
				insertedTarget.lineNumber,
				async () => {
					await this.indexer.reindexFilePath(insertedTarget.file.path);
					const deleted = await this.deleteYamlTaskByPath(file.path);
					if (!deleted) {
						new Notice(t('notifications', 'inlineCreatedTrashFailed'));
						suppressInlineInsertFailedNotice = true;
						return null;
					}
					return insertedTarget;
				},
			);
		});
		if (!inserted) {
			if (!suppressInlineInsertFailedNotice) {
				new Notice(t('notifications', 'inlineInsertFailed'));
			}
			return;
		}

		this.refreshViews();
		await this.openMarkdownFileAtLine(inserted.file, inserted.lineNumber);
		this.showTaskNotice('file-to-inline', {
			description: indexedYamlTask.description,
			fileBasename: file.basename,
			operonId: indexedYamlTask.operonId,
		});
	}

	private createRepeatSeriesIdFactory(): () => string {
		const usedIds = new Set(this.storage.repeatSeries.getAllSeriesIds());
		return () => {
			const id = generateRepeatSeriesId(usedIds);
			usedIds.add(id);
			return id;
		};
	}

	private async handleConvertTasksEmojiLineToOperonInlineTaskCommand(
		editor: Editor,
		view: MarkdownView,
		targetLineNumber?: number,
	): Promise<void> {
		const lineNumber = targetLineNumber ?? editor.getCursor().line;
		const line = editor.getLine(lineNumber);
		const filePath = view.file?.path ?? '';
		if (!filePath) {
			new Notice(t('notifications', 'openMarkdownForTasksEmojiLine'));
			return;
		}

		const conversion = convertTasksEmojiLineToOperon(line, {
			priorities: this.settings.priorities ?? DEFAULT_PRIORITIES,
		});
		if (conversion.kind === 'already_operon') {
			new Notice(t('notifications', 'currentLineAlreadyOperonInlineTask'));
			return;
		}
		if (conversion.kind === 'hybrid_unsupported') {
			new Notice(t('notifications', 'hybridTasksEmojiUnsupported'));
			return;
		}
		if (conversion.kind === 'not_tasks_emoji') {
			new Notice(t('notifications', 'currentLineNotSupportedTasksEmoji'));
			return;
		}

		const now = localNow();
		const inherited = this.resolveInlineTaskInheritedFields(view.file ?? null);
		const provisionalTaskLine = this.buildNewInlineTaskWithInheritedFields(
			conversion.description,
			conversion.checkbox,
			inherited,
			now,
			filePath,
			lineNumber,
		);
		const parsed = this.parseInlineTaskLine(provisionalTaskLine, lineNumber, filePath);
		if (!parsed?.operonId) {
			new Notice(t('notifications', 'tasksEmojiConversionFailed'));
			return;
		}
		const previousFieldValues = this.getParsedTaskFieldValues(parsed);

		const applied = applyTasksEmojiConversionToParsedTask({
			task: parsed,
			tags: conversion.tags,
			mappedFields: conversion.mappedFields,
			leftovers: conversion.leftovers,
			previousFieldValues,
			pipelines: this.settings.pipelines,
			defaultPipelineName: this.settings.defaultPipelineName,
			defaultPriority: this.settings.defaultPriority,
			repeatSeriesIdFactory: this.createRepeatSeriesIdFactory(),
		});
		if (!applied.ok) {
			new Notice(applied.errorMessage ?? t('notifications', 'terminalDateWorkflowResolveFailed'));
			return;
		}
		this.touchParsedTaskModifiedTimestamp(parsed, now);

		const taskLine = this.serializeInlineTask(parsed);
		editor.setLine(lineNumber, taskLine);
		this.placeCursorAfterInlineTaskDescription(editor, filePath, lineNumber, taskLine);
		this.refreshMarkdownAfterInlineAuthoring(filePath);
		const updatedParsed = this.parseInlineTaskLine(taskLine, lineNumber, filePath);
		if (!updatedParsed) {
			new Notice(t('notifications', 'tasksEmojiOpenEditorFailed'));
			return;
		}

		this.showTaskNotice('inline-created', {
			description: updatedParsed.description,
			operonId: updatedParsed.operonId,
		});
	}

	private async handleConvertSelectionToOperonTasksCommand(
		editor: Editor,
		view: MarkdownView,
	): Promise<void> {
		const filePath = view.file?.path ?? '';
		if (!filePath) {
			new Notice(t('notifications', 'openMarkdownForSelectionConversion'));
			return;
		}

		const selectedRange = this.resolveSelectedLineRangeForTaskConversion(editor);
		if (!selectedRange) return;

		const now = localNow();
		const baseInherited = this.resolveInlineTaskInheritedFields(view.file ?? null);
		const repeatSeriesIdFactory = this.createRepeatSeriesIdFactory();
		const changes: BulkSelectionLineChange[] = [];
		const parentStack: BulkSelectionTaskNode[] = [];
		let convertedCount = 0;
		let linkedCount = 0;
		let skippedCount = 0;
		let inFencedCodeBlock = false;

		for (let lineNumber = 0; lineNumber <= selectedRange.endLine; lineNumber++) {
			const line = editor.getLine(lineNumber);
			const fenceLine = this.isMarkdownFenceLine(line);
			const inSelection = lineNumber >= selectedRange.startLine;

			if (inSelection) {
				if (inFencedCodeBlock || fenceLine) {
					skippedCount++;
				} else {
					const result = this.buildSelectedLineOperonTaskConversion({
						line,
						lineNumber,
						filePath,
						now,
						baseInherited,
						parentStack,
						repeatSeriesIdFactory,
					});

					if (result.kind === 'converted') {
						convertedCount++;
						if (result.linkedToParent) linkedCount++;
						changes.push({
							from: { line: lineNumber, ch: 0 },
							to: { line: lineNumber, ch: line.length },
							text: result.taskLine,
						});
						this.suppressRawTaskCreationNotice(result.operonId);
					} else if (result.kind === 'skipped') {
						skippedCount++;
					}
				}
			}

			if (fenceLine) {
				inFencedCodeBlock = !inFencedCodeBlock;
			}
		}

		if (convertedCount === 0) {
			new Notice(t('notifications', 'convertSelectionToOperonTasksNoItems'));
			return;
		}

		this.applyBulkSelectionLineChanges(editor, changes);
		this.refreshMarkdownAfterInlineAuthoring(filePath);
		new Notice(t('notifications', 'convertSelectionToOperonTasksSummary', {
			converted: String(convertedCount),
			linked: String(linkedCount),
			skipped: String(skippedCount),
		}));
	}

	private applyBulkSelectionLineChanges(editor: Editor, changes: BulkSelectionLineChange[]): void {
		try {
			editor.transaction({ changes }, 'operon-convert-selection-to-tasks');
		} catch (error) {
			console.warn('Operon: bulk selection transaction failed; falling back to line updates.', error);
			for (const change of changes) {
				editor.setLine(change.from.line, change.text);
			}
			return;
		}

		const allChangesApplied = changes.every(change => editor.getLine(change.from.line) === change.text);
		if (allChangesApplied) return;

		console.warn('Operon: bulk selection transaction did not apply every line; falling back to line updates.');
		for (const change of changes) {
			if (editor.getLine(change.from.line) !== change.text) {
				editor.setLine(change.from.line, change.text);
			}
		}
	}

	private resolveSelectedLineRangeForTaskConversion(editor: Editor): { startLine: number; endLine: number } | null {
		if (!editor.somethingSelected()) {
			new Notice(t('notifications', 'convertSelectionToOperonTasksSelectListItems'));
			return null;
		}

		const selections = editor.listSelections();
		if (selections.length !== 1) {
			new Notice(t('notifications', 'convertSelectionToOperonTasksSingleSelection'));
			return null;
		}

		const { from, to } = this.normalizeEditorSelection(selections[0]);
		let endLine = to.line;
		if (to.ch === 0 && endLine > from.line) {
			endLine -= 1;
		}
		if (from.line > endLine) {
			new Notice(t('notifications', 'convertSelectionToOperonTasksSelectListItems'));
			return null;
		}

		return { startLine: from.line, endLine };
	}

	private buildSelectedLineOperonTaskConversion(options: {
		line: string;
		lineNumber: number;
		filePath: string;
		now: string;
		baseInherited: SubtaskInitialFields;
		parentStack: BulkSelectionTaskNode[];
		repeatSeriesIdFactory: () => string;
	}): { kind: 'converted'; taskLine: string; operonId: string; linkedToParent: boolean } | { kind: 'existing' } | { kind: 'skipped' } {
		const existingParsed = this.parseInlineTaskLine(options.line, options.lineNumber, options.filePath);
		const indent = measureMarkdownIndent(options.line);
		this.pruneBulkSelectionParentStack(options.parentStack, indent);
		const parentNode = options.parentStack[options.parentStack.length - 1] ?? null;

		if (existingParsed?.operonId) {
			options.parentStack.push({
				indent,
				operonId: existingParsed.operonId,
				fieldValues: this.getParsedTaskFieldValues(existingParsed),
				tags: [...existingParsed.tags],
			});
			return { kind: 'existing' };
		}

		const lineIndent = options.line.match(/^\s*/)?.[0] ?? '';
		const inherited = parentNode
			? resolveSubtaskInitialFieldsFromParentValues(parentNode.operonId, parentNode.fieldValues, this.settings, parentNode.tags)
			: options.baseInherited;
		const normalizedCheckboxLine = normalizeMarkdownCheckboxMarker(options.line);
		const conversionSourceLine = normalizedCheckboxLine ?? options.line;
		const tasksEmojiConversion = convertTasksEmojiLineToOperon(conversionSourceLine, {
			priorities: this.settings.priorities ?? DEFAULT_PRIORITIES,
		});

		if (tasksEmojiConversion.kind === 'converted') {
			const provisionalTaskLine = `${lineIndent}${this.buildNewInlineTaskWithInheritedFields(
				tasksEmojiConversion.description,
				tasksEmojiConversion.checkbox,
				inherited,
				options.now,
				options.filePath,
				options.lineNumber,
			)}`;
			const parsed = this.parseInlineTaskLine(provisionalTaskLine, options.lineNumber, options.filePath);
			if (!parsed?.operonId) return { kind: 'skipped' };
			const previousFieldValues = this.getParsedTaskFieldValues(parsed);

			const applied = applyTasksEmojiConversionToParsedTask({
				task: parsed,
				tags: tasksEmojiConversion.tags,
				mappedFields: tasksEmojiConversion.mappedFields,
				leftovers: tasksEmojiConversion.leftovers,
				previousFieldValues,
				pipelines: this.settings.pipelines,
				defaultPipelineName: this.settings.defaultPipelineName,
				defaultPriority: this.settings.defaultPriority,
				repeatSeriesIdFactory: options.repeatSeriesIdFactory,
			});
			if (!applied.ok) return { kind: 'skipped' };
			this.touchParsedTaskModifiedTimestamp(parsed, options.now);

			return this.finalizeBulkConvertedTaskNode(parsed, options.parentStack, indent, parentNode !== null);
		}

		const checkboxItem = extractMarkdownCheckboxListItem(options.line);
		if (checkboxItem) {
			if (hasOperonFields(options.line)) return { kind: 'skipped' };
			const taskLine = `${checkboxItem.indent}${this.buildNewInlineTaskWithInheritedFields(
				checkboxItem.description,
				checkboxItem.checkbox,
				inherited,
				options.now,
				options.filePath,
				options.lineNumber,
			)}`;
			const parsed = this.parseInlineTaskLine(taskLine, options.lineNumber, options.filePath);
			if (!parsed?.operonId) return { kind: 'skipped' };
			return this.finalizeBulkConvertedTaskNode(parsed, options.parentStack, indent, parentNode !== null);
		}

		if (normalizedCheckboxLine) return { kind: 'skipped' };

		const listItemDescription = extractMarkdownListItemDescription(options.line);
		if (!listItemDescription) return { kind: 'skipped' };

		const taskLine = `${lineIndent}${this.buildNewInlineTaskWithInheritedFields(
			listItemDescription,
			'open',
			inherited,
			options.now,
			options.filePath,
			options.lineNumber,
		)}`;
		const parsed = this.parseInlineTaskLine(taskLine, options.lineNumber, options.filePath);
		if (!parsed?.operonId) return { kind: 'skipped' };
		return this.finalizeBulkConvertedTaskNode(parsed, options.parentStack, indent, parentNode !== null);
	}

	private finalizeBulkConvertedTaskNode(
		parsed: ParsedTask,
		parentStack: BulkSelectionTaskNode[],
		indent: number,
		linkedToParent: boolean,
	): { kind: 'converted'; taskLine: string; operonId: string; linkedToParent: boolean } | { kind: 'skipped' } {
		if (!parsed.operonId) return { kind: 'skipped' };
		const taskLine = this.serializeInlineTask(parsed);
		parentStack.push({
			indent,
			operonId: parsed.operonId,
			fieldValues: this.getParsedTaskFieldValues(parsed),
			tags: [...parsed.tags],
		});
		return {
			kind: 'converted',
			taskLine,
			operonId: parsed.operonId,
			linkedToParent,
		};
	}

	private getParsedTaskFieldValues(task: ParsedTask): Record<string, string> {
		return Object.fromEntries(task.fields.map(field => [field.key, field.value]));
	}

	private pruneBulkSelectionParentStack(parentStack: BulkSelectionTaskNode[], indent: number): void {
		while (parentStack.length > 0 && parentStack[parentStack.length - 1].indent >= indent) {
			parentStack.pop();
		}
	}

	private async handleConvertOrEditFileTaskCommand(): Promise<void> {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const file = view?.file ?? null;
		if (!(file instanceof TFile)) {
			new Notice(t('notifications', 'openMarkdownOrCreateFileTask'));
			return;
		}

		const document = await this.loadParsedFrontmatterDocument(file);
		const indexedYamlTask = this.getYamlTaskByFilePath(file.path);
		if (indexedYamlTask) {
			await this.openIndexedTaskEditor(indexedYamlTask);
			return;
		}

		const existingOperonId = document.managedFieldValues['operonId']?.trim();
		if (document.managedFieldPresence.has('operonId') && existingOperonId) {
			await this.openYamlTaskEditorByData(
				file,
				file.basename,
				{ ...document.managedFieldValues },
				[...document.tags],
			);
			return;
		}

		await this.convertNoteToFileTask(file);
	}

	private async replaceInlineTaskById(
		filePath: string,
		operonId: string,
		taskLine: string,
		lineHint: number,
		options: { removePlainCheckboxLines?: PlainCheckboxMoveLine[] } = {},
	): Promise<boolean> {
		const openView = this.getMarkdownViewForPath(filePath);
		if (openView) {
			return this.replaceInlineTaskByIdInEditor(
				openView,
				operonId,
				taskLine,
				lineHint,
				options,
			);
		}

		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) return false;

		const content = await this.app.vault.cachedRead(file);
		let lines = content.split('\n');

		const targetLine = this.findInlineTaskLineIndex(lines, filePath, operonId, lineHint);
		if (targetLine === -1) return false;

		const removePlainCheckboxLines = options.removePlainCheckboxLines ?? [];
		if (removePlainCheckboxLines.length > 0) {
			const contentWithoutPlainCheckboxLines = removePlainCheckboxMoveLinesFromContent(
				content,
				targetLine,
				removePlainCheckboxLines,
			);
			if (contentWithoutPlainCheckboxLines === null) return false;
			lines = contentWithoutPlainCheckboxLines.split('\n');
		}

		lines[targetLine] = taskLine;
		this.markInternalTaskWrite(file.path);
		await this.app.vault.modify(file, lines.join('\n'));
		return true;
	}

	private async replaceInlineTaskByIdInEditor(
		view: MarkdownView,
		operonId: string,
		taskLine: string,
		lineHint: number,
		options: { removePlainCheckboxLines?: PlainCheckboxMoveLine[] } = {},
	): Promise<boolean> {
		const filePath = view.file?.path ?? '';
		if (!filePath) return false;

		const editor = view.editor;
		const content = editor.getValue();
		const lines = content.split('\n');
		const targetLine = this.findInlineTaskLineIndex(lines, filePath, operonId, lineHint);
		if (targetLine === -1) return false;

		const removePlainCheckboxLines = options.removePlainCheckboxLines ?? [];
		const changes = this.buildInlineToFileEditorChanges(
			lines,
			targetLine,
			taskLine,
			removePlainCheckboxLines,
		);
		if (!changes) return false;
		const parsedUpdatedTask = this.parseInlineTaskLine(taskLine, targetLine, filePath);
		const selectionCh = parsedUpdatedTask
			? resolveInlineTaskDescriptionCursorCh(parsedUpdatedTask)
			: taskLine.length;

		try {
			this.markInternalTaskWrite(filePath);
			editor.transaction({
				changes,
				selection: {
					from: { line: targetLine, ch: selectionCh },
					to: { line: targetLine, ch: selectionCh },
				},
			}, 'operon-inline-to-file');
		} catch (error) {
			console.warn('Operon: inline-to-file editor transaction failed.', error);
			return false;
		}
		await this.persistMarkdownViewBuffer(view);
		return true;
	}

	private buildInlineToFileEditorChanges(
		lines: string[],
		targetLine: number,
		taskLine: string,
		removePlainCheckboxLines: PlainCheckboxMoveLine[],
	): BulkSelectionLineChange[] | null {
		const content = lines.join('\n');
		const contentWithoutPlainCheckboxLines = removePlainCheckboxLines.length > 0
			? removePlainCheckboxMoveLinesFromContent(content, targetLine, removePlainCheckboxLines)
			: content;
		if (contentWithoutPlainCheckboxLines === null) return null;

		const changes: BulkSelectionLineChange[] = [{
			from: { line: targetLine, ch: 0 },
			to: { line: targetLine, ch: lines[targetLine]?.length ?? 0 },
			text: taskLine,
		}];
		const deletionRanges = this.getLineDeletionRanges(lines, removePlainCheckboxLines.map(line => line.lineNumber));
		if (!deletionRanges) return null;

		changes.push(...deletionRanges.map(range => ({
			...range,
			text: '',
		})));
		return changes.sort((left, right) => {
			if (left.from.line !== right.from.line) return left.from.line - right.from.line;
			return left.from.ch - right.from.ch;
		});
	}

	private getLineDeletionRanges(
		lines: string[],
		lineNumbers: number[],
	): Array<{ from: EditorPosition; to: EditorPosition }> | null {
		const sorted = [...lineNumbers].sort((left, right) => left - right);
		const ranges: Array<{ from: EditorPosition; to: EditorPosition }> = [];
		let index = 0;

		while (index < sorted.length) {
			const start = sorted[index];
			if (start === undefined || start < 0 || start >= lines.length) return null;

			let end = start;
			index += 1;
			while (index < sorted.length && sorted[index] === end + 1) {
				end = sorted[index];
				index += 1;
			}

			if (index < sorted.length && sorted[index] === end) return null;
			const lastLine = lines.length - 1;
			if (end < lastLine) {
				ranges.push({
					from: { line: start, ch: 0 },
					to: { line: end + 1, ch: 0 },
				});
				continue;
			}

			if (start === 0) {
				ranges.push({
					from: { line: 0, ch: 0 },
					to: { line: lastLine, ch: lines[lastLine]?.length ?? 0 },
				});
				continue;
			}

			ranges.push({
				from: { line: start - 1, ch: lines[start - 1]?.length ?? 0 },
				to: { line: end, ch: lines[end]?.length ?? 0 },
			});
		}

		return ranges;
	}

	private findInlineTaskLineIndex(
		lines: string[],
		filePath: string,
		operonId: string,
		lineHint: number,
	): number {
		if (lineHint >= 0 && lineHint < lines.length) {
			const hinted = this.parseInlineTaskLine(lines[lineHint], lineHint, filePath);
			if (hinted?.operonId === operonId) {
				return lineHint;
			}
		}

		for (let i = 0; i < lines.length; i++) {
			const parsed = this.parseInlineTaskLine(lines[i], i, filePath);
			if (parsed?.operonId === operonId) {
				return i;
			}
		}

		return -1;
	}

	private async collectAttachedInlineTaskPlainCheckboxLines(
		filePath: string,
		operonId: string,
		lineHint: number,
	): Promise<PlainCheckboxMoveLine[]> {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) return [];

		const content = await this.app.vault.cachedRead(file);
		const lines = content.split('\n');
		const targetLine = this.findInlineTaskLineIndex(lines, filePath, operonId, lineHint);
		if (targetLine === -1) return [];

		return collectScopedPlainCheckboxMoveLines(
			content,
			file.path,
			this.settings.keyMappings,
			{ kind: 'inline', operonId },
			targetLine,
		);
	}

	private normalizeMovedInlineTaskPlainCheckboxLines(lines: string[]): string[] {
		const commonIndent = this.getCommonLeadingWhitespace(lines);
		if (!commonIndent) return [...lines];
		return lines.map(line => line.startsWith(commonIndent) ? line.slice(commonIndent.length) : line);
	}

	private getCommonLeadingWhitespace(lines: string[]): string {
		let commonIndent: string | null = null;
		for (const line of lines) {
			const match = /^(\s*)/.exec(line);
			const indent = match?.[1] ?? '';
			if (!indent) return '';
			commonIndent = commonIndent === null ? indent : this.getCommonPrefix(commonIndent, indent);
			if (!commonIndent) return '';
		}
		return commonIndent ?? '';
	}

	private getCommonPrefix(left: string, right: string): string {
		let index = 0;
		while (index < left.length && index < right.length && left[index] === right[index]) {
			index += 1;
		}
		return left.slice(0, index);
	}

	private prependMovedPlainCheckboxLinesToFileTaskContent(content: string, lines: string[]): string {
		if (lines.length === 0) return content;
		const checkboxBlock = lines.join('\n');
		const { frontmatter, body } = splitFrontmatterDocument(content);
		const nextBody = body ? `${checkboxBlock}\n${body}` : checkboxBlock;
		if (frontmatter === null) return nextBody;
		return `---\n${frontmatter}\n---\n${nextBody}`;
	}

	private replaceInlineTaskLineInContent(
		content: string,
		filePath: string,
		operonId: string,
		taskLine: string,
		lineHint: number,
	): string | null {
		const lines = content.split('\n');

		let targetLine = -1;
		if (lineHint >= 0 && lineHint < lines.length) {
			const hinted = this.parseInlineTaskLine(lines[lineHint], lineHint, filePath);
			if (hinted?.operonId === operonId) {
				targetLine = lineHint;
			}
		}

		if (targetLine === -1) {
			for (let i = 0; i < lines.length; i++) {
				const parsed = this.parseInlineTaskLine(lines[i], i, filePath);
				if (parsed?.operonId === operonId) {
					targetLine = i;
					break;
				}
			}
		}

		if (targetLine === -1) return null;

		lines[targetLine] = taskLine;
		return lines.join('\n');
	}

	private async applyEditedTaskFromView(
		task: IndexedTask,
		request: TaskEditorSaveRequest,
	): Promise<boolean | null> {
		const parsed = this.parseInlineTaskLine(request.taskLine, 0, task.primary.filePath);
		if (!parsed?.operonId || parsed.operonId !== task.operonId) return false;

		// Always look up the fresh task from the index — the file may have been
		// moved by a pipeline folder rule since the editor was opened.
			const freshTask = this.indexer.getTask(task.operonId) ?? task;
			this.maybeApplyScheduledAutomationToParsedTask(parsed, freshTask.fieldValues);
			const payload = this.buildFieldPayload(parsed);
			this.preserveAuthoritativeRepeatOccurrenceDate(freshTask, parsed, payload);
			if (!this.validateDependencyPayloadChanges(freshTask, payload, 'replace')) return null;
			if (!await this.guardTaskStatusChangeOrShow(freshTask, payload, { mode: 'replace' })) return null;
			const repeatTemporalScope = await this.resolveEditorRepeatTemporalScope(freshTask, payload);
		if (repeatTemporalScope.action === 'cancel') {
			return null;
		}
		if (repeatTemporalScope.action === 'skipAndCancel') {
			await this.updateTaskFieldsAndRefresh(freshTask.operonId, {
				_checkbox: 'cancelled',
				dateCancelled: localToday(),
				dateCompleted: '',
			}, {
				changedKeys: ['dateCancelled'],
			});
			return true;
		}
		const pendingRepeatSeriesId = (freshTask.fieldValues['repeatSeriesId'] ?? '').trim();
		let pendingRepeatSnapshot = repeatTemporalScope.nextSnapshot;
		if (repeatTemporalScope.scope === 'thisAndFollowingTasks' && pendingRepeatSnapshot) {
			pendingRepeatSnapshot = reanchorRepeatTemporalSnapshotToScheduledDate(pendingRepeatSnapshot);
			payload['repeatOccurrenceDate'] = pendingRepeatSnapshot.occurrenceDate;
			this.setParsedTaskField(parsed, 'repeatOccurrenceDate', pendingRepeatSnapshot.occurrenceDate, 'date');
		}
		const realignedParentTaskId = await this.maybeApplyDailyNoteParentRealignmentToPayload(freshTask, payload, { mode: 'replace' });
		if (realignedParentTaskId) {
			this.setParsedTaskField(parsed, 'parentTask', realignedParentTaskId, 'text');
		}
			const normalizedTaskLine = serializeTask(parsed, this.settings.keyMappings);
			const pendingRepeatOverrideNow = localNow();
			const pendingRepeatOverride = repeatTemporalScope.scope === 'thisAndFollowingTasks' && pendingRepeatSeriesId && pendingRepeatSnapshot
				? buildFollowingOverride(pendingRepeatSnapshot, pendingRepeatOverrideNow)
				: null;

		if (freshTask.primary.format === 'inline') {
			if (request.fileBody?.dirty && request.fileBody.format === 'inline') {
				const file = this.app.vault.getAbstractFileByPath(freshTask.primary.filePath);
				if (!(file instanceof TFile)) return false;
				const currentContent = await this.app.vault.cachedRead(file);
				const { frontmatter } = splitFrontmatterDocument(currentContent);
				const mergedBody = this.replaceInlineTaskLineInContent(
					request.fileBody.content,
					freshTask.primary.filePath,
					freshTask.operonId,
					normalizedTaskLine,
					request.fileBody.targetLine ?? freshTask.primary.lineNumber,
				);
				if (mergedBody == null) return false;

				request.fileBody.content = mergedBody;
				const nextContent = frontmatter == null
					? mergedBody
					: `---\n${frontmatter}\n---\n${mergedBody}`;
					const updated = await this.persistTaskMutationWithFollowingOverride(
						pendingRepeatSeriesId,
						pendingRepeatOverride,
						pendingRepeatOverrideNow,
						async () => {
							this.markInternalTaskWrite(file.path);
							await this.app.vault.modify(file, nextContent);
							return true;
						},
					);
					if (!updated) return false;
				} else {
					const updated = await this.persistTaskMutationWithFollowingOverride(
						pendingRepeatSeriesId,
						pendingRepeatOverride,
						pendingRepeatOverrideNow,
						() => this.replaceInlineTaskById(
							freshTask.primary.filePath,
							freshTask.operonId,
							normalizedTaskLine,
							freshTask.primary.lineNumber,
						),
					);
					if (!updated) return false;
			}

				await this.indexer.reindexFilePath(freshTask.primary.filePath, { notify: false });
				const afterTask = this.indexer.getTask(freshTask.operonId);
				if (!this.isPendingRepeatIdentityCommitted(afterTask, pendingRepeatSnapshot, pendingRepeatOverride)) {
					console.error('Operon: recurring task save did not persist the reanchored occurrence identity');
					return false;
				}
				await this.syncDependencyPayloadChanges(freshTask, payload, 'replace');
			const modifiedTimestamp = (payload['datetimeModified'] ?? afterTask?.fieldValues['datetimeModified'] ?? '').trim();
			let recurrenceResult: RecurrenceMaterializationResult | null = null;
			if (afterTask) {
				await this.syncRepeatSeriesEntryIfNeeded(afterTask);
				await this.applyInlineRepeatCompletionModeIfRequested(afterTask, request.inlineCompletionMode);
					recurrenceResult = await this.maybeCreateRecurringOccurrence(task, afterTask, localNow());
			}
			await this.refreshAggregateTotalsAfterTaskMutation(
				freshTask,
				this.resolveAfterTaskForRecurrenceMaterialization(afterTask ?? null, recurrenceResult),
				{ modifiedTimestamp, autoUnpinCandidate: afterTask ?? null },
			);
			this.scheduleProjectSerialIndexReconcile();
			this.refreshViews();
			return true;
		}

		const file = this.app.vault.getAbstractFileByPath(freshTask.primary.filePath);
		if (!(file instanceof TFile)) return false;

		// YAML saves are full-state replacements for Operon-managed fields:
		// omitted keys should be removed, while unknown user frontmatter is preserved.
			const wroteYamlTask = await this.persistTaskMutationWithFollowingOverride(
				pendingRepeatSeriesId,
				pendingRepeatOverride,
				pendingRepeatOverrideNow,
				() => this.writer.writeTaskFields(
					freshTask.operonId,
					payload,
					{ mode: 'replace', reindex: 'none', touchAncestors: false },
				),
			);
		if (!wroteYamlTask) return false;

		let indexedPath = file.path;
		const sanitized = this.sanitizeTaskFileName(parsed.description);
		if (sanitized && sanitized !== file.basename) {
			const folder = file.parent?.path ?? '';
			const newPath = folder ? `${folder}/${sanitized}.md` : `${sanitized}.md`;
			if (!this.app.vault.getAbstractFileByPath(newPath)) {
				await this.app.fileManager.renameFile(file, newPath);
				indexedPath = newPath;
			}
		}
		const indexedFile = this.app.vault.getAbstractFileByPath(indexedPath);
		if (!(indexedFile instanceof TFile)) return false;
		if (request.fileBody) {
			request.fileBody.filePath = indexedPath;
		}
		if (request.fileBody?.dirty) {
			try {
				await this.writeFileTaskBodyIfNeeded(indexedFile, request.fileBody);
			} catch (error) {
				console.error('Operon: failed to write file task body from task editor', error);
				await this.indexer.reindexFilePath(indexedPath);
				return false;
			}
		}

		await this.indexer.reindexFilePath(indexedPath, { notify: false });
		const afterTask = this.indexer.getTask(freshTask.operonId);
		if (!this.isPendingRepeatIdentityCommitted(afterTask, pendingRepeatSnapshot, pendingRepeatOverride)) {
			console.error('Operon: recurring File Task save did not persist the reanchored occurrence identity');
			return false;
		}
		const modifiedTimestamp = (payload['datetimeModified'] ?? afterTask?.fieldValues['datetimeModified'] ?? '').trim();
		await this.syncDependencyPayloadChanges(freshTask, payload, 'replace');
		let recurrenceResult: RecurrenceMaterializationResult | null = null;
		if (afterTask) {
			await this.syncRepeatSeriesEntryIfNeeded(afterTask);
			await this.applyInlineRepeatCompletionModeIfRequested(afterTask, request.inlineCompletionMode);
				recurrenceResult = await this.maybeCreateRecurringOccurrence(task, afterTask, localNow());
		}
		await this.refreshAggregateTotalsAfterTaskMutation(
			freshTask,
			this.resolveAfterTaskForRecurrenceMaterialization(afterTask ?? null, recurrenceResult),
			{ modifiedTimestamp, autoUnpinCandidate: afterTask ?? null },
		);
		this.scheduleProjectSerialIndexReconcile();
		this.refreshViews();
		return true;
	}

	private preserveAuthoritativeRepeatOccurrenceDate(
		task: IndexedTask,
		parsed: ParsedTask,
		payload: Record<string, string>,
	): void {
		const occurrenceDate = resolveAuthoritativeRepeatOccurrenceDate(task.fieldValues, payload);
		if (!occurrenceDate) return;
		payload['repeatOccurrenceDate'] = occurrenceDate;
		this.setParsedTaskField(parsed, 'repeatOccurrenceDate', occurrenceDate, 'date');
	}

	private async persistTaskMutationWithFollowingOverride(
		seriesId: string,
		pendingOverride: ReturnType<typeof buildFollowingOverride> | null,
		now: string,
		persistTask: () => Promise<boolean>,
		isTaskCommitted: () => boolean = () => false,
	): Promise<boolean> {
		if (!pendingOverride) return persistTask();
		if (!seriesId) return false;
		const transaction = await this.storage.repeatSeries.beginFollowingOverrideTransaction(
			seriesId,
			pendingOverride,
			now,
		);
		if (!transaction) return false;

		try {
			const persisted = await persistTask();
			if (persisted || isTaskCommitted()) return true;
		} catch (error) {
			if (isTaskCommitted()) throw error;
			const rolledBack = await this.storage.repeatSeries.rollbackFollowingOverrideTransaction(transaction);
			if (!rolledBack) {
				console.error('Operon: task write failed and tentative following override rollback was rejected', error);
				throw new Error('Operon: could not roll back tentative following override after task write failure');
			}
			throw error;
		}

		const rolledBack = await this.storage.repeatSeries.rollbackFollowingOverrideTransaction(transaction);
		if (!rolledBack) {
			throw new Error('Operon: could not roll back tentative following override after rejected task write');
		}
		return false;
	}

	private isPendingRepeatIdentityCommitted(
		afterTask: IndexedTask | null | undefined,
		pendingSnapshot: RepeatTemporalSnapshot | null,
		pendingOverride: ReturnType<typeof buildFollowingOverride> | null,
	): boolean {
		if (!pendingOverride || !pendingSnapshot) return true;
		return (afterTask?.fieldValues['repeatOccurrenceDate'] ?? '').trim() === pendingSnapshot.occurrenceDate;
	}

	private async handleRepairRecurringFileTaskIdentitiesCommand(): Promise<void> {
		const plan = buildRecurrenceIdentityRepairPlan(
			this.indexer.getAllTasks(),
			this.storage.repeatSeries.getAllEntries(),
		);
		if (plan.candidates.length === 0) {
			new Notice(t('recurrenceIdentityRepair', 'noCandidates'));
			return;
		}

		const previewLimit = 50;
		const previewCandidates = plan.candidates.slice(0, previewLimit);
		const remainingCount = plan.candidates.length - previewCandidates.length;
		const confirmed = await new Promise<boolean>(resolve => {
			new ConfirmActionModal(this.app, {
				title: t('recurrenceIdentityRepair', 'title'),
				message: remainingCount > 0
					? t('recurrenceIdentityRepair', 'previewWithRemaining', {
						count: String(plan.candidates.length),
						remaining: String(remainingCount),
					})
					: t('recurrenceIdentityRepair', 'preview', { count: String(plan.candidates.length) }),
				confirmText: t('recurrenceIdentityRepair', 'confirm'),
				cancelText: t('buttons', 'cancel'),
				detailsTable: previewCandidates.map(candidate => ({
					label: candidate.filePath,
					before: candidate.fromOccurrenceDate,
					after: candidate.toOccurrenceDate,
				})),
			}, resolve).open();
		});
		if (!confirmed) return;

		const outcomes = new Map<string, 'updated' | 'already-updated' | 'conflict' | 'missing' | 'failed'>();
		const reindexCandidates: RecurrenceIdentityRepairCandidate[] = [];
		for (const candidate of plan.candidates) {
			try {
				// The confirmation modal can remain open while tasks or series state change.
				// Rebuild the conservative plan immediately before each write and require
				// the exact previewed candidate to remain eligible.
				const currentPlan = buildRecurrenceIdentityRepairPlan(
					this.indexer.getAllTasks(),
					this.storage.repeatSeries.getAllEntries(),
				);
				const currentCandidate = currentPlan.candidates.find(value => value.operonId === candidate.operonId);
				if (!currentCandidate || !this.isSameRecurrenceIdentityRepairCandidate(candidate, currentCandidate)) {
					outcomes.set(candidate.operonId, 'conflict');
					continue;
				}
				const outcome = await this.writer.writeTaskFieldIfCurrent(
					currentCandidate.operonId,
					'repeatOccurrenceDate',
					currentCandidate.fromOccurrenceDate,
					currentCandidate.toOccurrenceDate,
					{
						reindex: 'none',
						additionalExpectedValues: { ...currentCandidate.additionalExpectedValues },
					},
				);
				outcomes.set(candidate.operonId, outcome);
				if (outcome === 'updated' || outcome === 'already-updated') reindexCandidates.push(currentCandidate);
			} catch (error) {
				console.error(`Operon: failed to repair recurring File Task identity ${candidate.operonId}`, error);
				outcomes.set(candidate.operonId, 'failed');
			}
		}

		if (reindexCandidates.length > 0) {
			await this.indexer.reindexFilesBatch(
				[...new Set(reindexCandidates.map(candidate => candidate.filePath))],
				{ notify: false },
			);
		}

		let repaired = 0;
		let skipped = 0;
		for (const candidate of plan.candidates) {
			const outcome = outcomes.get(candidate.operonId) ?? 'failed';
			const indexedOccurrence = (this.indexer.getTask(candidate.operonId)?.fieldValues['repeatOccurrenceDate'] ?? '').trim();
			if ((outcome === 'updated' || outcome === 'already-updated') && indexedOccurrence === candidate.toOccurrenceDate) {
				repaired += 1;
			} else {
				skipped += 1;
			}
		}
		this.refreshViews();
		new Notice(t('recurrenceIdentityRepair', 'result', {
			repaired: String(repaired),
			skipped: String(skipped),
		}));
	}

	private isSameRecurrenceIdentityRepairCandidate(
		previewed: RecurrenceIdentityRepairCandidate,
		current: RecurrenceIdentityRepairCandidate,
	): boolean {
		return previewed.operonId === current.operonId
			&& previewed.seriesId === current.seriesId
			&& previewed.filePath === current.filePath
			&& previewed.fromOccurrenceDate === current.fromOccurrenceDate
			&& previewed.toOccurrenceDate === current.toOccurrenceDate
			&& previewed.repeat === current.repeat
			&& Object.entries(previewed.additionalExpectedValues).every(([key, value]) => (
				current.additionalExpectedValues[key] === value
			))
			&& Object.keys(previewed.additionalExpectedValues).length
				=== Object.keys(current.additionalExpectedValues).length;
	}

	private async refreshAggregateTotalsAfterTaskMutation(
		beforeTask: IndexedTask | null,
		afterTask: IndexedTask | null,
		options: {
			modifiedTimestamp?: string;
			indexPerfContext?: IndexPerfContext;
			precommittedAggregateIds?: Set<string>;
			autoUnpinCandidate?: IndexedTask | null;
		} = {},
	): Promise<AggregateRefreshResult> {
		const result = await this.aggregateCoordinator.refreshAfterTaskMutation(beforeTask, afterTask, options);
		this.fileTaskArchiver?.scheduleForIndexedChange(beforeTask, afterTask);
		await this.tryAutoUnpinTerminalTaskIfNeeded(options.autoUnpinCandidate ?? afterTask);
		return result;
	}

	private async refreshAggregateStateAfterTaskRemoval(removedTasks: IndexedTask[]): Promise<void> {
		await this.aggregateCoordinator.refreshAfterTaskRemoval(removedTasks);
	}

	private ensureRepeatSeriesIdPayload(task: IndexedTask, payload: Record<string, string>): void {
		const candidateRepeat = ('repeat' in payload ? payload['repeat'] : task.fieldValues['repeat']) ?? '';
		if (!parseRepeatRule(candidateRepeat)) return;
		const existingSeriesId = (payload['repeatSeriesId'] ?? task.fieldValues['repeatSeriesId'] ?? '').trim();
		if (!existingSeriesId) {
			payload['repeatSeriesId'] = generateRepeatSeriesId(this.storage.repeatSeries.getAllSeriesIds());
		}
		const existingOccurrenceDate = (payload['repeatOccurrenceDate'] ?? task.fieldValues['repeatOccurrenceDate'] ?? '').trim();
		const scheduledDate = (payload['dateScheduled'] ?? task.fieldValues['dateScheduled'] ?? '').trim();
		if (!existingOccurrenceDate && /^\d{4}-\d{2}-\d{2}$/u.test(scheduledDate)) {
			payload['repeatOccurrenceDate'] = scheduledDate;
		}
	}

	private deriveCountModeRepeatEnd(fieldValues: Record<string, string>): string {
		const rule = parseRepeatRule(fieldValues['repeat']);
		if (!rule || rule.mode !== 'count' || !rule.count) return '';
		const anchorDate = (fieldValues['dateScheduled'] ?? '').trim();
		if (!anchorDate) return '';
		const endDate = calculateRepeatEndFromCount(
			rule,
			anchorDate,
			rule.count,
			this.storage.repeatSeries.getSkipDates(fieldValues['repeatSeriesId']),
		);
		return endDate ? `${endDate}T23:59:59` : '';
	}

	private async applyDerivedRepeatFieldsToPayload(
		task: IndexedTask,
		payload: Record<string, string>,
	): Promise<void> {
		const merged = {
			...task.fieldValues,
			...payload,
		};
		const rule = parseRepeatRule(merged['repeat']);
		if (!rule || rule.mode !== 'count') return;
		payload['datetimeRepeatEnd'] = this.deriveCountModeRepeatEnd(merged);
	}

	private async syncRepeatSeriesEntryIfNeeded(
		task: IndexedTask | null | undefined,
	): Promise<void> {
		if (!task?.fieldValues['repeatSeriesId']) return;
		if (!parseRepeatRule(task.fieldValues['repeat'])) return;
		await this.recurrenceService.ensureSeriesEntry(task, task.fieldValues['repeatSeriesId']);
	}

	private getRepeatSeriesInlineCompletionMode(repeatSeriesId: string | null | undefined): InlineRepeatCompletionMode {
		return normalizeInlineCompletionMode(this.storage.repeatSeries.getEntry(repeatSeriesId)?.inlineCompletionMode);
	}

	private async updateRepeatSeriesInlineCompletionMode(
		seriesId: string | null | undefined,
		mode: InlineRepeatCompletionMode | null | undefined,
		context: {
			sourceTaskId: string;
			sourceFormat: IndexedTask['primary']['format'];
			repeat: string | null | undefined;
			description: string | null | undefined;
		},
	): Promise<void> {
		const normalizedSeriesId = (seriesId ?? '').trim();
		if (!normalizedSeriesId) return;
		const rule = parseRepeatRule(context.repeat ?? '');
		if (!rule) return;
		const effectiveMode = context.sourceFormat === 'inline' && rule.mode === 'done'
			? normalizeInlineCompletionMode(mode)
			: 'keep-completed';
		await this.storage.repeatSeries.ensureSeries({
			seriesId: normalizedSeriesId,
			sourceTaskId: context.sourceTaskId,
			sourceFormat: context.sourceFormat,
			baseTitle: context.sourceFormat === 'yaml'
				? ((context.description ?? '').trim() || null)
				: null,
			lastMaterializedTitle: (context.description ?? '').trim() || null,
			now: localNow(),
		});
		if (this.getRepeatSeriesInlineCompletionMode(normalizedSeriesId) === effectiveMode) return;
		await this.storage.repeatSeries.updateInlineCompletionMode(normalizedSeriesId, effectiveMode, localNow());
	}

	private async applyInlineRepeatCompletionModeIfRequested(
		task: IndexedTask | null | undefined,
		mode: InlineRepeatCompletionMode | null | undefined,
	): Promise<void> {
		if (!task || mode == null) return;
		await this.updateRepeatSeriesInlineCompletionMode(
			task.fieldValues['repeatSeriesId'],
			mode,
			{
				sourceTaskId: task.operonId,
				sourceFormat: task.primary.format,
				repeat: task.fieldValues['repeat'],
				description: task.description,
			},
		);
	}

	private async updateTaskRepeatSkips(
		operonId: string,
		repeatSeriesId: string,
		skipDates: string[],
	): Promise<TaskEditorRepeatSkipUpdateResult> {
		const task = this.indexer.getTask(operonId);
		if (!task) {
			return {
				skipDates: [...new Set(skipDates)].sort(),
			};
		}

		await this.recurrenceService.ensureSeriesEntry(task, repeatSeriesId);
		await this.storage.repeatSeries.updateSkipDates(repeatSeriesId, skipDates, localNow());

		const rule = parseRepeatRule(task.fieldValues['repeat']);
		if (rule?.mode === 'count') {
			await this.updateTaskFieldsAndRefresh(operonId, {});
			const refreshed = this.indexer.getTask(operonId);
			this.refreshViews();
			return {
				skipDates: this.storage.repeatSeries.getSkipDates(repeatSeriesId),
				datetimeRepeatEnd: refreshed?.fieldValues['datetimeRepeatEnd'] ?? '',
			};
		}

		this.refreshViews();
		return {
			skipDates: this.storage.repeatSeries.getSkipDates(repeatSeriesId),
			datetimeRepeatEnd: task.fieldValues['datetimeRepeatEnd'] ?? '',
		};
	}

	private resolveCompletionTimestamp(task: IndexedTask, fallbackNow: string): string {
		if (task.checkbox === 'cancelled') {
			return fallbackNow;
		}
		const completed = (task.fieldValues['dateCompleted'] ?? '').trim();
		if (/^\d{4}-\d{2}-\d{2}$/.test(completed)) {
			return `${completed}T00:00:00`;
		}
		const cancelled = (task.fieldValues['dateCancelled'] ?? '').trim();
		if (/^\d{4}-\d{2}-\d{2}$/.test(cancelled)) {
			return fallbackNow;
		}
		return fallbackNow;
	}

	private async maybeCreateRecurringOccurrence(
		beforeTask: IndexedTask,
		afterTask: IndexedTask,
		fallbackNow: string,
	): Promise<RecurrenceMaterializationResult | null> {
		if (beforeTask.checkbox === 'done' || beforeTask.checkbox === 'cancelled') return null;
		if (afterTask.checkbox !== 'done' && afterTask.checkbox !== 'cancelled') return null;

		const completionTimestamp = this.resolveCompletionTimestamp(afterTask, fallbackNow);
		const result = await this.recurrenceService.materializeNextOccurrence(beforeTask, afterTask, completionTimestamp);
		if (result.created) {
			const createdTask = result.createdTaskId ? this.indexer.getTask(result.createdTaskId) : null;
			this.showTaskNotice(result.createdFilePath ? 'file-created' : 'inline-created', {
				description: beforeTask.description,
				fileBasename: result.createdFilePath?.split('/').pop()?.replace(/\.md$/iu, ''),
				indexedDescription: createdTask?.description,
				operonId: result.createdTaskId,
			});
			return result;
		}
		if (result.reason === 'ended') {
			const repeatEnd = afterTask.fieldValues['datetimeRepeatEnd'];
			if (repeatEnd) {
				new Notice(t('notifications', 'recurrenceEnded', { date: repeatEnd }));
			}
		}
		return result;
	}

	private resolveAfterTaskForRecurrenceMaterialization(
		afterTask: IndexedTask | null,
		result: RecurrenceMaterializationResult | null,
	): IndexedTask | null {
		if (result?.created && result.materializationMode === 'replaced' && result.createdTaskId) {
			return this.indexer.getTask(result.createdTaskId) ?? afterTask;
		}
		return afterTask;
	}

	private mergeTaskFieldValuesWithPayload(task: IndexedTask, payload: Record<string, string>): Record<string, string> {
		const merged = { ...task.fieldValues };
		for (const key of ['dateScheduled', 'datetimeStart', 'datetimeEnd', 'estimate', 'repeat', 'repeatSeriesId', 'repeatOccurrenceDate']) {
			if (key in payload) {
				merged[key] = payload[key];
			}
		}
		return merged;
	}

	private async resolveEditorRepeatTemporalScope(
		task: IndexedTask,
		payload: Record<string, string>,
	): Promise<{
		action: 'proceed' | 'skipAndCancel' | 'cancel';
		scope: RepeatEditScopeChoice | null;
		nextSnapshot: RepeatTemporalSnapshot | null;
	}> {
		if (!this.isLatestMaterializedRecurringTask(task)) {
			return { action: 'proceed', scope: null, nextSnapshot: null };
		}
		const nextCheckbox = (payload['_checkbox'] ?? task.checkbox).trim();
		if (nextCheckbox === 'done' || nextCheckbox === 'cancelled') {
			return { action: 'proceed', scope: null, nextSnapshot: null };
		}

		await this.ensureSeriesBaseTemporalTemplate(task);
		const occurrenceDate = getTaskRepeatOccurrenceDate(task);
		const currentSnapshot = buildRepeatTemporalSnapshotFromFieldValues(occurrenceDate, task.fieldValues);
		const nextSnapshot = buildRepeatTemporalSnapshotFromFieldValues(
			occurrenceDate,
			this.mergeTaskFieldValuesWithPayload(task, payload),
		);
		if (!currentSnapshot || !nextSnapshot || !hasRepeatTemporalChange(currentSnapshot, nextSnapshot)) {
			return { action: 'proceed', scope: null, nextSnapshot: null };
		}
		const scope = await this.promptRepeatScopeForTemporalChange(
			t('modals', 'editRecurringTaskOccurrence'),
			currentSnapshot,
			nextSnapshot,
		);
		if (!scope) {
			return { action: 'cancel', scope: null, nextSnapshot: null };
		}
		if (scope === 'skipThisTask') {
			return { action: 'skipAndCancel', scope, nextSnapshot };
		}
		const seriesId = (task.fieldValues['repeatSeriesId'] ?? '').trim();
		const rule = seriesId ? this.getRepeatRuleForSeries(seriesId) ?? parseRepeatRule(task.fieldValues['repeat']) : null;
		if (scope === 'thisTask' && seriesId && rule && !this.canMoveRepeatScheduledDate(
			seriesId,
			occurrenceDate,
			nextSnapshot.scheduledDate,
			rule,
		)) {
			this.showRepeatDateMoveLimit(rule);
			return { action: 'cancel', scope: null, nextSnapshot: null };
		}
		return { action: 'proceed', scope, nextSnapshot };
	}

	private async updateTaskFieldsAndRefresh(
		operonId: string,
		payload: Record<string, string>,
		options: TaskFieldsUpdateOptions = {},
	): Promise<boolean> {
		if (this.redirectDuplicateOperonIdAction(operonId)) return false;
		const task = this.indexer.getTask(operonId);
		if (!task) return false;

		const normalizeStartedAt = options.statusCycleTrace ? enginePerfNow() : 0;
		const normalizedPayload = this.applyFieldRulesToTaskPayload(
			task,
			{ ...payload },
			options.changedKeys ?? (options.mode === 'replace' ? [] : Object.keys(payload)),
			);
			normalizeRepeatIdentityPayload(task.fieldValues, normalizedPayload, () => this.storage.repeatSeries.getAllSeriesIds());
			this.ensureRepeatSeriesIdPayload(task, normalizedPayload);
			await this.applyDerivedRepeatFieldsToPayload(task, normalizedPayload);
			const mode = options.mode ?? 'merge';
			if (!this.validateDependencyPayloadChanges(task, normalizedPayload, mode)) {
				return false;
			}
			if (!await this.guardTaskStatusChangeOrShow(task, normalizedPayload, { mode })) {
				this.logStatusCyclePerfStage(options.statusCycleTrace, 'blocked', enginePerfNow());
				return false;
			}
			await this.maybeApplyDailyNoteParentRealignmentToPayload(task, normalizedPayload, { mode });
			if (Object.keys(normalizedPayload).length > 0 && !Object.prototype.hasOwnProperty.call(normalizedPayload, 'datetimeModified')) {
				normalizedPayload['datetimeModified'] = localNow();
			}
			this.setStatusCyclePerfChangedKeys(options.statusCycleTrace, Object.keys(normalizedPayload));
			this.logStatusCyclePerfStage(options.statusCycleTrace, 'normalize', normalizeStartedAt);

			const writerStartedAt = options.statusCycleTrace ? enginePerfNow() : 0;
			const precommittedAggregateIds = new Set<string>();
		let coalescedSameFile = false;
		let coalescedFallbackReason = 'not-attempted';
		let wroteTask = false;
		if (options.refreshReason === 'status-cycle' && mode === 'merge') {
			const plan = this.aggregateCoordinator.planSameFileStatusCycleAggregate(
				task,
				normalizedPayload,
				normalizedPayload['datetimeModified'] ?? '',
			);
			coalescedFallbackReason = plan.fallbackReason;
			if (plan.eligible) {
				const coalescedWrite = await this.writer.writeInlineTaskAndAggregateYamlParent(
					operonId,
					normalizedPayload,
					plan.parentId,
					plan.parentPayload,
					{ mode },
				);
				coalescedFallbackReason = coalescedWrite.fallbackReason;
				if (coalescedWrite.wrote) {
					wroteTask = true;
					coalescedSameFile = true;
					precommittedAggregateIds.add(plan.parentId);
				}
			}
		}
		if (!wroteTask) {
			wroteTask = await this.writer.writeTaskFields(operonId, normalizedPayload, {
				mode,
				reindex: 'none',
				touchAncestors: false,
			});
		}
		this.logStatusCyclePerfStage(
			options.statusCycleTrace,
			'writer',
			writerStartedAt,
			`coalescedSameFile=${String(coalescedSameFile)}`,
			`fallbackReason=${coalescedFallbackReason}`,
		);
		if (!wroteTask) return false;

		const reindexStartedAt = options.statusCycleTrace ? enginePerfNow() : 0;
		const statusCycleReason = options.refreshReason ?? 'refresh';
		await this.indexer.reindexFilePath(task.primary.filePath, {
			notify: false,
			perfContext: this.createStatusCycleIndexPerfContext(
				options.statusCycleTrace,
				'status-cycle-task-reindex',
				statusCycleReason,
			),
		});
		this.logStatusCyclePerfStage(options.statusCycleTrace, 'reindex', reindexStartedAt);

			const freshTask = this.indexer.getTask(operonId);
			if (!freshTask) return false;
			await this.syncDependencyPayloadChanges(task, normalizedPayload, mode);

			const repeatStartedAt = options.statusCycleTrace ? enginePerfNow() : 0;
		await this.syncRepeatSeriesEntryIfNeeded(freshTask);
		await this.applyInlineRepeatCompletionModeIfRequested(freshTask, options.inlineCompletionMode);
		const recurrenceResult = await this.maybeCreateRecurringOccurrence(task, freshTask, localNow());
		const aggregateAfterTask = this.resolveAfterTaskForRecurrenceMaterialization(freshTask, recurrenceResult);
		this.logStatusCyclePerfStage(options.statusCycleTrace, 'repeat', repeatStartedAt);

		const aggregateStartedAt = options.statusCycleTrace ? enginePerfNow() : 0;
		await this.refreshAggregateTotalsAfterTaskMutation(task, aggregateAfterTask, {
			modifiedTimestamp: (normalizedPayload['datetimeModified'] ?? '').trim(),
			indexPerfContext: this.createStatusCycleIndexPerfContext(
				options.statusCycleTrace,
				'status-cycle-aggregate-index-patch',
				statusCycleReason,
			),
			precommittedAggregateIds,
			autoUnpinCandidate: freshTask,
		});
		this.logStatusCyclePerfStage(options.statusCycleTrace, 'aggregate', aggregateStartedAt);

		const refreshStartedAt = options.statusCycleTrace ? enginePerfNow() : 0;
		const isStatusCycleRefresh = options.refreshReason === 'status-cycle';
		const markdownScope = isStatusCycleRefresh
			? resolveStatusMarkdownRefreshScope({
				beforeTask: task,
				afterTask: aggregateAfterTask ?? freshTask,
				getTask: taskId => this.indexer.getTask(taskId),
			})
			: undefined;
		this.scheduleProjectSerialIndexReconcile();
		this.refreshViews(isStatusCycleRefresh || options.statusCycleTrace
			? {
				statusCycleTrace: options.statusCycleTrace,
				reason: options.refreshReason ?? 'refresh',
				markdownScope,
			}
			: true);
		this.logStatusCyclePerfStage(options.statusCycleTrace, 'refresh-schedule', refreshStartedAt);
		return true;
	}

	private async updateTaskFieldAndRefresh(operonId: string, key: string, value: string): Promise<boolean> {
		const task = this.indexer.getTask(operonId);
		if (!task) return false;

		const payload = this.buildNormalizedTaskFieldUpdate(task, key, value);
		if (!payload) return false;

		return this.updateTaskFieldsAndRefresh(operonId, payload, { changedKeys: [key] });
	}

	private async updateTableTaskFieldsAndRefresh(operonId: string, payload: Record<string, string>): Promise<boolean> {
		const guardedUpdate = this.normalizeTableTaskFieldsWritebackPayload(payload);
		if (!guardedUpdate) return false;
		const { payload: guardedPayload, changedKeys } = guardedUpdate;
		const task = this.indexer.getTask(operonId);
		if (!task) return false;

		if (changedKeys.length === 1) {
			const key = changedKeys[0];
			if (key === '_description') {
				return this.updateTableTaskDescriptionAndRefresh(task, guardedPayload['_description'] ?? '');
			}
			if (key === 'dateCompleted' || key === 'dateCancelled') {
				const value = guardedPayload[key] ?? '';
				const normalizedPayload = value.trim()
					? this.buildNormalizedTaskFieldUpdate(task, key, value)
					: this.buildTerminalDateRemovalNormalization(task, key);
				if (!normalizedPayload) return false;
				return this.updateTaskFieldsAndRefresh(operonId, normalizedPayload, { changedKeys: [key] });
			}
		}

		return this.updateTaskFieldsAndRefresh(operonId, guardedPayload, { changedKeys });
	}

	private async updateTableFilePropertyAndRefresh(
		operonId: string,
		request: {
			propertyName: string;
			expected: RawYamlPropertyExpectation;
			mutation: RawYamlPropertyMutation;
		},
	): Promise<RawYamlPropertyWriteOutcome> {
		const task = this.indexer.getTask(operonId);
		if (!task || task.primary.format !== 'yaml') return 'unsupported';
		const result = await this.writer.writeYamlFilePropertyIfCurrent(
			operonId,
			request.propertyName,
			request.expected,
			request.mutation,
			{ reindex: 'none', modifiedTimestamp: localNow() },
		);
		const filePath = result.filePath ?? task.primary.filePath;
		if (result.outcome === 'updated') {
			this.tableFilePropertyIndex?.applyMutation(filePath, request.propertyName, request.mutation);
			await this.indexer.reindexFilePath(filePath, { notify: false });
			this.refreshViews();
		} else if (result.outcome === 'conflict' || result.outcome === 'already-updated') {
			const currentMutation: RawYamlPropertyMutation = result.current.present
				? { kind: 'set', value: result.current.value ?? null }
				: { kind: 'delete' };
			this.tableFilePropertyIndex?.applyMutation(filePath, request.propertyName, currentMutation);
			this.refreshViews();
		}
		return result.outcome;
	}

	private async updateTableTaskDescriptionAndRefresh(task: IndexedTask, description: string): Promise<boolean> {
		const nextDescription = description.trim();
		if (nextDescription === task.description.trim()) return true;
		if (task.primary.format !== 'yaml') {
			return this.updateTaskFieldsAndRefresh(task.operonId, { _description: nextDescription }, { changedKeys: ['_description'] });
		}

		const file = this.app.vault.getAbstractFileByPath(task.primary.filePath);
		if (!(file instanceof TFile)) return false;
		const sanitized = this.sanitizeTaskFileName(nextDescription);
		if (!sanitized || sanitized !== nextDescription) return false;
		const folder = file.parent?.path ?? '';
		const newPath = folder ? `${folder}/${sanitized}.md` : `${sanitized}.md`;
		if (sanitized !== file.basename && this.app.vault.getAbstractFileByPath(newPath)) return false;

		const datetimeModified = localNow();
		const fieldValues = {
			...task.fieldValues,
			datetimeModified,
		};
		const nextPath = await this.writeYamlTaskInstance(task as IndexedTaskInstance, nextDescription, fieldValues, task.tags, null);
		if (!nextPath) return false;
		await this.indexer.reindexFilePath(nextPath, { notify: false });
		const afterTask = this.indexer.getTask(task.operonId);
		if (!afterTask || afterTask.description.trim() !== nextDescription) return false;
		await this.refreshAggregateTotalsAfterTaskMutation(task, afterTask ?? null, {
			modifiedTimestamp: datetimeModified,
			autoUnpinCandidate: afterTask ?? null,
		});
		this.scheduleProjectSerialIndexReconcile();
		this.refreshViews();
		return true;
	}

	private async addTableTaskSessionAndRefresh(operonId: string, start: string, end: string): Promise<boolean> {
		const added = await this.timeTracker.addSession(operonId, start, end);
		if (!added) return false;
		this.refreshTimeSessionHistoryLeaves(true);
		this.refreshViews();
		return true;
	}

	private async editTableTaskSessionAndRefresh(session: TrackerSession, start: string, end: string): Promise<boolean> {
		const updated = await this.timeTracker.updateSessionByRange(
			session.operonId,
			session.start,
			session.end,
			start,
			end,
			session.sessionIndex,
		);
		if (!updated) return false;
		this.refreshTimeSessionHistoryLeaves(true);
		this.refreshViews();
		return true;
	}

	private async deleteTableTaskSessionAndRefresh(session: TrackerSession): Promise<boolean> {
		const deleted = await this.timeTracker.deleteSessionByRange(
			session.operonId,
			session.start,
			session.end,
			session.sessionIndex,
		);
		if (!deleted) return false;
		this.refreshTimeSessionHistoryLeaves(true);
		this.refreshViews();
		return true;
	}

	private normalizeTableTaskFieldsWritebackPayload(payload: Record<string, string>): { payload: Record<string, string>; changedKeys: string[] } | null {
		const guardedPayload: Record<string, string> = {};
		const changedKeys: string[] = [];
		const rejectedKeys: string[] = [];
		const hasRepeatWrite = 'repeat' in payload;

		for (const [key, value] of Object.entries(payload)) {
			if (key === '_description' || key === 'description') {
				if (!isEditableTableTaskFieldKey('description', this.settings)) {
					rejectedKeys.push(key);
					continue;
				}
				guardedPayload['_description'] = value;
				changedKeys.push('_description');
				continue;
			}
			if (TABLE_REPEAT_AUXILIARY_WRITEBACK_KEYS.has(key) && hasRepeatWrite) {
				guardedPayload[key] = value;
				changedKeys.push(key);
				continue;
			}
			const guardKey = key === '_tags' ? 'tags' : normalizeTableTaskFieldKey(key, this.settings);
			if (!guardKey) {
				rejectedKeys.push(key);
				continue;
			}
			const payloadKey = guardKey === 'tags' ? '_tags' : guardKey;
			if (!isEditableTableTaskFieldKey(guardKey, this.settings)) {
				rejectedKeys.push(key);
				continue;
			}
			guardedPayload[payloadKey] = value;
			changedKeys.push(payloadKey);
		}

		if (rejectedKeys.length > 0) {
			console.warn('Operon: ignored unsupported Table task writeback fields', rejectedKeys);
		}
		return changedKeys.length > 0 ? { payload: guardedPayload, changedKeys } : null;
	}

	private async updateLivePreviewInlineFieldsFallback(
		operonId: string,
		payload: Record<string, string>,
		restoreCursor: LivePreviewCursorRestoreRequest,
	): Promise<boolean> {
		if (!restoreCursor.editorView) return false;
		if (this.redirectDuplicateOperonIdAction(operonId)) return false;

		const lineNumber = restoreCursor.lineNumber;
		if (lineNumber < 0 || lineNumber >= restoreCursor.editorView.state.doc.lines) return false;

		const line = restoreCursor.editorView.state.doc.line(lineNumber + 1);
		const parsed = this.parseInlineTaskLine(line.text, lineNumber, restoreCursor.filePath);
		if (!parsed || parsed.operonId !== operonId) return false;

		const currentFieldValues = Object.fromEntries(parsed.fields.map(field => [field.key, field.value]));
		const normalizablePayload: Record<string, string> = {};
		for (const [key, value] of Object.entries(payload)) {
			if (key === '_tags') {
				normalizablePayload['tags'] = value;
			} else if (!key.startsWith('_')) {
				normalizablePayload[key] = value;
			}
		}

		if (payload['_description'] !== undefined) {
			parsed.description = payload['_description'];
		}
		if (payload['_checkbox'] !== undefined) {
			parsed.checkbox = payload['_checkbox'] as ParsedTask['checkbox'];
		}

		const normalizedPayload = Object.keys(normalizablePayload).length > 0
			? normalizeTaskFieldPatch(currentFieldValues, normalizablePayload, {
				getAllRepeatSeriesIds: () => this.storage.repeatSeries.getAllSeriesIds(),
				getRepeatSkipDates: (repeatSeriesId) => this.storage.repeatSeries.getSkipDates(repeatSeriesId),
			})
			: {};
			if (!this.applyFieldPayloadToParsedTask(parsed, normalizedPayload, currentFieldValues)) {
				return false;
			}
			const indexedTask = this.indexer.getTask(operonId);
			if (indexedTask) {
				const fallbackPayload = this.buildFieldPayload(parsed);
				if (!this.validateDependencyPayloadChanges(indexedTask, fallbackPayload, 'replace')) return false;
				if (!await this.guardTaskStatusChangeOrShow(indexedTask, fallbackPayload, { mode: 'replace' })) return false;
			}

			const now = localNow();
		this.normalizeParsedTaskCreatedTimestamp(parsed, now);
		this.touchParsedTaskModifiedTimestamp(parsed, now);
		const serialized = this.serializeInlineTask(parsed);
		this.withSuppressedLivePreviewEditorChange(() => {
			restoreCursor.editorView?.dispatch({
				changes: { from: line.from, to: line.to, insert: serialized },
			});
		});
		this.indexer.scheduleReindex(restoreCursor.filePath);
		this.refreshViews();
		return true;
	}

	private getInlineFieldTypeForKey(key: string): OperonField['type'] {
		return getManagedTaskFieldType(key, this.settings.keyMappings) ?? 'text';
	}

	private isLivePreviewPickerPending(session: EphemeralFieldSession | null): boolean {
		if (!session || session.status !== 'pending') return false;
		return this.livePreviewPendingPickerSessionId === session.id && Date.now() <= this.livePreviewPendingPickerUntil;
	}

	private clearLivePreviewPickerPending(sessionId?: string): void {
		if (sessionId && this.livePreviewPendingPickerSessionId !== sessionId) return;
		this.livePreviewPendingPickerSessionId = null;
		this.livePreviewPendingPickerUntil = 0;
	}

	private setActiveLivePreviewPicker(close: (() => void) | void): void {
		this.closeActiveLivePreviewPicker();
		this.activeLivePreviewPickerClose = close ?? null;
	}

	private clearActiveLivePreviewPicker(close?: (() => void) | null): void {
		if (!close || this.activeLivePreviewPickerClose === close) {
			this.activeLivePreviewPickerClose = null;
		}
	}

	private closeActiveLivePreviewPicker(): void {
		const close = this.activeLivePreviewPickerClose;
		this.activeLivePreviewPickerClose = null;
		close?.();
	}

	private withSuppressedLivePreviewEditorChange<T>(fn: () => T): T {
		this.suppressLivePreviewSessionEditorChange = true;
		try {
			return fn();
		} finally {
			getActiveWindow().setTimeout(() => {
				this.suppressLivePreviewSessionEditorChange = false;
			}, 0);
		}
	}

	private isLivePreviewEditor(editor: Editor): boolean {
		const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!markdownView || markdownView.editor !== editor) return false;
		const cm = getEditorViewFromEditor(markdownView.editor);
		if (!(cm instanceof EditorView)) return false;
		try {
			return cm.state.field(editorLivePreviewField);
		} catch {
			return false;
		}
	}

	private removeLivePreviewSessionTrigger(editor: Editor, start: EditorPosition, end: EditorPosition): void {
		this.withSuppressedLivePreviewEditorChange(() => {
			editor.replaceRange('', start, end);
			editor.setSelection(start, start);
		});
	}

	private restoreLivePreviewAuthoringCursor(
		filePath: string,
		position: { line: number; ch: number },
		clampToDescription = true,
		waitForRefresh = false,
		editorView?: EditorView,
		trackDescriptionEnd = false,
	): void {
		const restore: LivePreviewAuthoringCursorRestoreLease = {
			filePath,
			position,
			clampToDescription,
			editorView,
			trackDescriptionEnd,
			expiresAt: Date.now() + (waitForRefresh ? 1200 : 300),
		};
		if (waitForRefresh) {
			this.livePreviewAuthoringCursorRestoreLease = restore;
			if (this.livePreviewAuthoringCursorRestoreClearTimer) {
				clearWindowTimeout(this.livePreviewAuthoringCursorRestoreClearTimer);
			}
			this.livePreviewAuthoringCursorRestoreClearTimer = setWindowTimeout(() => {
				if (this.livePreviewAuthoringCursorRestoreLease === restore) {
					this.livePreviewAuthoringCursorRestoreLease = null;
				}
				this.livePreviewAuthoringCursorRestoreClearTimer = null;
			}, 1250);
		}

		const win = this.getLivePreviewAuthoringCursorRestoreWindow(restore);
		const apply = () => {
			if (waitForRefresh && this.livePreviewAuthoringCursorRestoreLease !== restore) return;
			this.applyLivePreviewAuthoringCursorRestore(restore);
		};
		win.setTimeout(apply, 0);
		win.setTimeout(apply, 60);
		if (!waitForRefresh) return;
		win.requestAnimationFrame(() => {
			apply();
			win.requestAnimationFrame(apply);
			win.setTimeout(apply, 0);
		});
		win.setTimeout(apply, 140);
		win.setTimeout(apply, 260);
		win.setTimeout(apply, 520);
		win.setTimeout(apply, 900);
	}

	private getLivePreviewAuthoringCursorRestoreWindow(restore: LivePreviewAuthoringCursorRestoreLease): Window {
		return restore.editorView?.dom.isConnected ? getOwnerWindow(restore.editorView.dom) : getActiveWindow();
	}

	private shouldSkipLivePreviewAuthoringCursorRestore(restore: LivePreviewAuthoringCursorRestoreLease): boolean {
		const win = this.getLivePreviewAuthoringCursorRestoreWindow(restore);
		const doc = win.document;
		const activeElement = asHTMLElement(doc.activeElement, doc.body);
		if (!activeElement || activeElement === doc.body) return false;
		if (restore.editorView?.dom.contains(activeElement)) return false;
		return activeElement.matches('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]');
	}

	private applyLivePreviewAuthoringCursorRestore(restore: LivePreviewAuthoringCursorRestoreLease): boolean {
		if (Date.now() > restore.expiresAt) {
			if (this.livePreviewAuthoringCursorRestoreLease === restore) {
				this.livePreviewAuthoringCursorRestoreLease = null;
			}
			return false;
		}
		if (this.shouldSkipLivePreviewAuthoringCursorRestore(restore)) return false;

		const markdownView = this.getMarkdownViewForPath(restore.filePath);
		const editor = markdownView?.editor ?? null;
		const sourceView = restore.editorView?.dom.isConnected ? restore.editorView : null;
		const cm = sourceView ?? (editor ? getEditorViewFromEditor(editor) : null);
		if (!(cm instanceof EditorView) && !editor) return false;

		const lineCount = cm instanceof EditorView ? cm.state.doc.lines : editor?.lineCount() ?? 0;
		if (restore.position.line < 0 || restore.position.line >= lineCount) return false;

		const lineText = cm instanceof EditorView
			? cm.state.doc.line(restore.position.line + 1).text
			: editor?.getLine(restore.position.line) ?? '';
		const filePathForParse = restore.filePath || (markdownView?.file?.path ?? '');
		let targetCh = Math.min(restore.position.ch, lineText.length);
		if (restore.clampToDescription && filePathForParse) {
			const parsed = this.parseInlineTaskLine(lineText, restore.position.line, filePathForParse);
			if (parsed) {
				targetCh = restore.trackDescriptionEnd
					? parsed.descriptionRange.to
					: Math.max(parsed.descriptionRange.from, Math.min(targetCh, parsed.descriptionRange.to));
			}
		}

		if (cm instanceof EditorView) {
			const cmLine = cm.state.doc.line(restore.position.line + 1);
			const anchor = Math.min(cmLine.to, cmLine.from + targetCh);
			cm.dispatch({
				selection: { anchor },
				scrollIntoView: true,
			});
			cm.focus();
			return true;
		}

		if (!editor) return false;
		const target = { line: restore.position.line, ch: targetCh };
		editor.setSelection(target, target);
		editor.focus();
		return true;
	}

	private scheduleLivePreviewAuthoringCursorRestoreAfterRefresh(): void {
		const restore = this.livePreviewAuthoringCursorRestoreLease;
		if (!restore) return;
		const win = this.getLivePreviewAuthoringCursorRestoreWindow(restore);
		const apply = () => {
			if (this.livePreviewAuthoringCursorRestoreLease !== restore) return;
			this.applyLivePreviewAuthoringCursorRestore(restore);
		};
		win.requestAnimationFrame(() => {
			apply();
			win.setTimeout(apply, 0);
			win.setTimeout(apply, 80);
		});
	}

	private resolveLivePreviewDescriptionEndCursor(
		lineText: string,
		lineNumber: number,
		filePath: string,
		fallback: EditorPosition,
	): EditorPosition {
		const parsed = this.parseInlineTaskLine(lineText, lineNumber, filePath);
		if (!parsed) return fallback;
		return { line: lineNumber, ch: parsed.descriptionRange.to };
	}

	private cancelLivePreviewSession(
		reason: EphemeralFieldSessionCancelReason,
		session: EphemeralFieldSession | null = this.livePreviewEphemeralSession.getActive(),
		restoreCursor = true,
	): void {
		if (!session) return;
		this.clearLivePreviewPickerPending(session.id);
		const cancelled = this.livePreviewEphemeralSession.cancel(reason);
		debugTaskFieldSuggestion('live-preview', 'session-cancelled', {
			cancelReason: reason,
			sessionStatus: session.status,
		});
		if (!cancelled || !restoreCursor) return;
		this.restoreLivePreviewAuthoringCursor(cancelled.filePath, cancelled.resumeCursor, true);
	}

	private abandonLivePreviewSession(
		reason: EphemeralFieldSessionCancelReason,
		session: EphemeralFieldSession | null = this.livePreviewEphemeralSession.getActive(),
		restoreCursor = false,
	): void {
		this.closeActiveLivePreviewPicker();
		this.cancelLivePreviewSession(reason, session, restoreCursor);
	}

	private commitLivePreviewSessionField(
		canonicalKey: string,
		value: string | string[],
		sessionId?: string,
	): void {
		this.commitLivePreviewSessionFields({ [canonicalKey]: value }, sessionId);
	}

	private commitLivePreviewSessionFields(
		payload: Record<string, string | string[]>,
		sessionId?: string,
		inlineCompletionMode?: InlineRepeatCompletionMode | null,
	): void {
		const session = this.livePreviewEphemeralSession.getActive();
		if (!session || (sessionId && session.id !== sessionId)) return;
		this.clearLivePreviewPickerPending(session.id);

		const markdownView = this.getMarkdownViewForPath(session.filePath);
		if (!markdownView?.file) {
			this.cancelLivePreviewSession('picker_closed', session);
			return;
		}

		const editor = markdownView.editor;
		const lineText = editor.getLine(session.lineNumber);
		const parsed = this.parseInlineTaskLine(lineText, session.lineNumber, markdownView.file.path);
		if (!parsed) {
			this.cancelLivePreviewSession('picker_closed', session);
			return;
		}

		if (!parsed.operonId) {
			const idField = this.createInlineField('operonId', generateOperonId(), 'text');
			parsed.fields.push(idField);
			parsed.operonId = idField.value;
			const autoParentTaskId = resolveFileTaskAutoParentOperonId({
				enabled: this.settings.autoParentFileTask,
				filePath: markdownView.file.path,
				tasks: this.indexer.getAllTasks(),
				frontmatter: this.app.metadataCache.getFileCache(markdownView.file)?.frontmatter ?? null,
				keyMappings: this.settings.keyMappings,
			});
			const inherited = resolveSubtaskInitialFields(autoParentTaskId, this.indexer, this.settings);
			this.applyInheritedSubtaskFields(parsed, inherited);
		}
		const indexedTask = parsed.operonId ? this.indexer.getTask(parsed.operonId) : null;
		const currentFieldValues = indexedTask?.fieldValues
			?? Object.fromEntries(parsed.fields.map(field => [field.key, field.value]));
		const normalizedPayload = normalizeTaskFieldPatch(currentFieldValues, payload, {
			getAllRepeatSeriesIds: () => this.storage.repeatSeries.getAllSeriesIds(),
			getRepeatSkipDates: (repeatSeriesId) => this.storage.repeatSeries.getSkipDates(repeatSeriesId),
		});
		if (!this.applyFieldPayloadToParsedTask(parsed, normalizedPayload, currentFieldValues)) {
			this.clearActiveLivePreviewPicker();
			this.cancelLivePreviewSession('picker_cancelled', session);
			return;
		}

		const now = localNow();
		if (!parsed.operonId) {
			this.setParsedTaskField(parsed, 'operonId', generateOperonId(), 'text');
		}
		this.normalizeParsedTaskCreatedTimestamp(parsed, now);
		this.touchParsedTaskModifiedTimestamp(parsed, now);

		this.clearActiveLivePreviewPicker();
		this.livePreviewEphemeralSession.commit(session.id);
		const serialized = this.serializeInlineTask(parsed);
		const resumeCursor = this.resolveLivePreviewDescriptionEndCursor(
			serialized,
			session.lineNumber,
			markdownView.file.path,
			session.resumeCursor,
		);
		this.withSuppressedLivePreviewEditorChange(() => {
			editor.setLine(session.lineNumber, serialized);
		});
		if (inlineCompletionMode != null && parsed.operonId) {
			const committedFieldValues = Object.fromEntries(parsed.fields.map(field => [field.key, field.value]));
			runAsyncAction('live preview repeat completion policy update failed', () => this.updateRepeatSeriesInlineCompletionMode(
				committedFieldValues['repeatSeriesId'],
				inlineCompletionMode,
				{
					sourceTaskId: parsed.operonId ?? '',
					sourceFormat: 'inline',
					repeat: committedFieldValues['repeat'],
					description: parsed.description,
				},
			));
		}
		this.indexer.scheduleReindex(markdownView.file.path);
		this.refreshViews();
		this.restoreLivePreviewAuthoringCursor(markdownView.file.path, resumeCursor, true, true);
	}

	private scheduleLivePreviewInsertedFieldPickerRetry(
		canonicalKey: string,
		sessionId: string | undefined,
		retryAttempt: number,
	): boolean {
		if (retryAttempt >= 1) return false;
		getActiveWindow().requestAnimationFrame(() => {
			this.openLivePreviewInsertedFieldPicker(canonicalKey, sessionId, retryAttempt + 1);
		});
		return true;
	}

	private getLivePreviewInsertedFieldManualDatePickerOptions(canonicalKey: string): ManualDatePickerOptions | undefined {
		if (!LIVE_PREVIEW_INSERT_DAY_PICKER_DATE_KEYS.has(canonicalKey)) return undefined;
		return {
			weekStart: this.settings.calendarWeekStart,
			showWeekNumbers: this.settings.calendarSidebarShowWeekNumbers,
		};
	}

	private openLivePreviewInsertedFieldPicker(canonicalKey: string, sessionId?: string, retryAttempt = 0): void {
		const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
		const view = markdownView ? getEditorViewFromEditor(markdownView.editor) : null;
		const session = this.livePreviewEphemeralSession.getActive();
		if (!(view instanceof EditorView)) {
			if (this.scheduleLivePreviewInsertedFieldPickerRetry(canonicalKey, sessionId, retryAttempt)) return;
			this.cancelLivePreviewSession('picker_closed', session);
			return;
		}
		const filePath = markdownView?.file?.path ?? '';
		if (sessionId && (!session || session.id !== sessionId)) return;

		const lineNumber = session?.lineNumber ?? view.state.doc.lineAt(view.state.selection.main.head).number - 1;
		if (lineNumber < 0 || lineNumber >= view.state.doc.lines) {
			if (this.scheduleLivePreviewInsertedFieldPickerRetry(canonicalKey, sessionId, retryAttempt)) return;
			this.cancelLivePreviewSession('picker_closed', session);
			return;
		}
		const line = view.state.doc.line(lineNumber + 1);
		const parsed = this.parseInlineTaskLine(line.text, line.number - 1, filePath);
		if (!parsed) {
			if (this.scheduleLivePreviewInsertedFieldPickerRetry(canonicalKey, sessionId, retryAttempt)) return;
			this.cancelLivePreviewSession('picker_closed', session);
			return;
		}
		if (session && (session.resumeCursor.line < 0 || session.resumeCursor.line >= view.state.doc.lines)) {
			if (this.scheduleLivePreviewInsertedFieldPickerRetry(canonicalKey, sessionId, retryAttempt)) return;
			this.cancelLivePreviewSession('picker_closed', session);
			return;
		}
		const anchorPos = session
			? view.state.doc.line(session.resumeCursor.line + 1).from + session.resumeCursor.ch
			: view.state.selection.main.head;
		const rect = view.coordsAtPos(anchorPos);
		if (!rect) {
			if (this.scheduleLivePreviewInsertedFieldPickerRetry(canonicalKey, sessionId, retryAttempt)) return;
			this.cancelLivePreviewSession('picker_closed', session);
			return;
		}
		if (session) {
			this.livePreviewEphemeralSession.markPickerOpen(session.id);
			this.clearLivePreviewPickerPending(session.id);
		}
		const anchor = new DOMRect(rect.left, rect.top, Math.max(rect.right - rect.left, 1), Math.max(rect.bottom - rect.top, 1));
		const task = parsed.operonId ? this.indexer.getTask(parsed.operonId) : null;
		const currentFieldValues = task?.fieldValues ?? Object.fromEntries(parsed.fields.map(field => [field.key, field.value]));
		const currentTags = task?.tags ?? parsed.tags;
		this.closeActiveLivePreviewPicker();
		const cancelSession = (reason: EphemeralFieldSessionCancelReason = 'picker_closed') => {
			this.clearActiveLivePreviewPicker();
			this.cancelLivePreviewSession(reason, session);
		};
		let closePanel: (() => void) | null = null;
		let pendingInlineCompletionMode: InlineRepeatCompletionMode | null = null;
		const handleClose = () => {
			this.clearActiveLivePreviewPicker(closePanel ?? undefined);
			cancelSession('picker_closed');
		};
		closePanel = openTaskFieldPicker({
			app: this.app,
			settings: this.settings,
			allTasks: this.indexer.getAllTasks(),
			canonicalKey,
			anchor,
			currentFieldValues,
			currentTags,
			closeListPickerOnSelect: true,
			retainInputFocus: true,
			manualDatePicker: this.getLivePreviewInsertedFieldManualDatePickerOptions(canonicalKey),
			taskFormat: 'inline',
			repeatInlineCompletionMode: this.getRepeatSeriesInlineCompletionMode(currentFieldValues['repeatSeriesId']),
			onCommit: payload => { this.commitLivePreviewSessionFields(payload, sessionId, pendingInlineCompletionMode); },
			onRepeatInlineCompletionModeChange: mode => {
				pendingInlineCompletionMode = normalizeInlineCompletionMode(mode);
			},
			onCancel: () => cancelSession('picker_cancelled'),
			onClose: handleClose,
		});
		if (!closePanel) {
			cancelSession('picker_cancelled');
			return;
		}
		this.setActiveLivePreviewPicker(closePanel);
	}

	private resolveReadingViewSectionTasks(
		sectionInfo: MarkdownSectionInformation,
		sourcePath: string,
	): ReadingSectionInlineTaskResolution {
		const resolved = resolveReadingSectionInlineTasks(
			sectionInfo.text,
			sectionInfo.lineStart,
			sourcePath,
			operonId => this.indexer.getTask(operonId),
			this.settings.keyMappings,
			this.settings.pipelines,
		);

		if (resolved.sawTaskLine) {
			return resolved;
		}

		const candidates = this.indexer.getAllTasks().filter(task =>
			task.primary.format === 'inline'
			&& task.primary.filePath === sourcePath
			&& task.primary.lineNumber >= sectionInfo.lineStart
			&& task.primary.lineNumber <= sectionInfo.lineEnd
		).sort((a, b) => a.primary.lineNumber - b.primary.lineNumber);
		const resolvedCandidates = candidates.map(task => createIndexedReadingResolvedTask(task));

		return {
			lineTasks: new Map(resolvedCandidates.map(resolvedTask => [resolvedTask.task.primary.lineNumber, resolvedTask])),
			orderedTasks: resolvedCandidates,
			sawTaskLine: false,
			needsReindex: false,
		};
	}

	private readingListItemMatchesTask(li: HTMLElement, task: IndexedTask): boolean {
		const visibleText = this.getReadingListItemOwnText(li);
		const description = task.description.replace(/\s+/g, ' ').trim();
		if (!description) return false;
		return visibleText.includes(description);
	}

	private getReadingListItemSourceLine(
		li: HTMLElement,
		sectionInfo: MarkdownSectionInformation,
	): number | null {
		for (const candidate of this.getReadingListItemLineCandidates(li)) {
			const lineNumber = this.readReadingDataLine(candidate);
			if (lineNumber === null) continue;
			if (lineNumber < sectionInfo.lineStart || lineNumber > sectionInfo.lineEnd) continue;
			return lineNumber;
		}
		return null;
	}

	private getReadingListItemLineCandidates(li: HTMLElement): HTMLElement[] {
		const candidates: HTMLElement[] = [li];
		for (const child of Array.from(li.children)) {
			const element = asHTMLElement(child);
			if (!element || element.tagName === 'UL' || element.tagName === 'OL') continue;
			if (element.hasAttribute('data-line')) candidates.push(element);
			for (const descendant of Array.from(element.querySelectorAll<HTMLElement>('[data-line]'))) {
				if (descendant.closest('li.task-list-item') !== li) continue;
				candidates.push(descendant);
			}
		}
		return candidates;
	}

	private readReadingDataLine(element: HTMLElement): number | null {
		const raw = element.getAttribute('data-line')?.trim();
		if (!raw || !/^\d+$/u.test(raw)) return null;
		const lineNumber = Number(raw);
		return Number.isSafeInteger(lineNumber) ? lineNumber : null;
	}

	private getReadingListItemOwnText(li: HTMLElement): string {
		const parts: string[] = [];
		const collect = (node: Node): void => {
			if (node.nodeType === 3) {
				parts.push(node.textContent ?? '');
				return;
			}
			const element = asHTMLElement(node);
			if (element && (element.tagName === 'UL' || element.tagName === 'OL')) return;
			for (const child of Array.from(node.childNodes)) {
				collect(child);
			}
		};

		for (const child of Array.from(li.childNodes)) {
			collect(child);
		}
		return parts.join(' ').replace(/\s+/g, ' ').trim();
	}

	private isRenderedCodeElement(el: HTMLElement): boolean {
		return !!el.closest('pre, code');
	}

	private isFencedMarkdownSection(sectionInfo: MarkdownSectionInformation): boolean {
		const firstContentLine = sectionInfo.text
			.split('\n')
			.find(line => line.trim().length > 0);
		return !!firstContentLine && this.isMarkdownFenceLine(firstContentLine);
	}

	private isMarkdownFenceLine(line: string): boolean {
		return /^\s*(?:`{3,}|~{3,})/.test(line);
	}

	private buildKeyMappingSignature(): string {
		return this.settings.keyMappings
			.map(mapping => `${mapping.canonicalKey}|${mapping.visiblePropertyName}`)
			.sort()
			.join('||');
	}

	private scheduleSettingsReindex(reason: SettingsReindexReason): void {
		this.indexer.invalidateV8Coherence();
		this.pendingSettingsReindexReasons.add(reason);
		this.settingsReindexRetryAttempted = false;
		this.armSettingsReindexTimer();
	}

	private armSettingsReindexTimer(): void {
		if (this.settingsReindexTimer) {
			clearWindowTimeout(this.settingsReindexTimer);
		}
		this.settingsReindexTimer = setWindowTimeout(() => {
			this.settingsReindexTimer = null;
			const reasons = new Set(this.pendingSettingsReindexReasons);
			this.pendingSettingsReindexReasons.clear();
			runAsyncAction('settings reindex failed', async () => {
				try {
					await this.indexer.fullReindex();
					if (reasons.has('workflow-semantics')) {
						const completed = await this.runTaskStatsBackfill({ force: true, source: 'workflow-semantics' });
						if (!completed) throw new Error('workflow aggregate reconciliation remains incomplete');
					}
					this.settingsReindexRetryAttempted = false;
					new Notice(t('notifications', 'indexRebuilt', { count: String(this.indexer.taskCount) }));
				} catch (error) {
					for (const reason of reasons) this.pendingSettingsReindexReasons.add(reason);
					if (!this.settingsReindexRetryAttempted) {
						this.settingsReindexRetryAttempted = true;
						this.armSettingsReindexTimer();
					}
					throw error;
				}
			});
		}, 600);
	}

	private async markTaskStatsBackfillPending(): Promise<void> {
		const pendingVersion = Math.max(0, CURRENT_TASK_STATS_BACKFILL_VERSION - 1);
		if (this.settings.taskStatsBackfillVersion <= pendingVersion) return;
		this.settings.taskStatsBackfillVersion = pendingVersion;
		await this.storage.saveSettings();
	}

	private async markTaskStatsBackfillComplete(version: number): Promise<void> {
		if (this.settings.taskStatsBackfillVersion >= version) return;
		const previousVersion = this.settings.taskStatsBackfillVersion;
		this.settings.taskStatsBackfillVersion = version;
		try {
			await this.storage.saveSettings();
		} catch (error) {
			this.settings.taskStatsBackfillVersion = previousVersion;
			throw error;
		}
	}

	private async runStartupTaskStatsBackfill(): Promise<void> {
		try {
			await this.runTaskStatsBackfill({ force: false, source: 'startup' });
		} catch (error) {
			console.error('Operon: startup task stats backfill failed', error);
		}
	}

	private async runTaskStatsBackfill(options: { force: boolean; source: 'startup' | 'command' | 'workflow-semantics' }): Promise<boolean> {
		if (options.source === 'workflow-semantics') {
			await this.markTaskStatsBackfillPending();
		}
		const result = await this.taskStatsBackfillRunner.run({ force: options.force });
		if (result.skipped) return true;
		if (options.source === 'command') {
			if (result.completed) {
				new Notice(t('notifications', 'taskStatsBackfillComplete', {
					parents: String(result.parentTaskCount),
					writes: String(result.writeCount),
				}));
			} else {
				new Notice(t('notifications', 'taskStatsBackfillFailed', {
					failed: String(result.failedWriteCount),
				}));
			}
		}
		if (result.completed && result.writeCount > 0) {
			this.refreshViews();
		}
		return result.completed;
	}

	private openIndexV8Diagnostics(): void {
		new IndexV8DiagnosticsModal(this.app, {
			readSummary: async () => this.buildIndexV8DiagnosticsSummary(),
			validate: async () => {
				const result = await this.indexer.validateIndexV8Now();
				return { status: result.status === 'loaded' ? 'unchanged' : 'failed' };
			},
			rebuild: async () => {
				await this.indexer.fullReindex();
				const validation = await this.indexer.validateIndexV8Now();
				const diagnostics = await this.indexer.getIndexV8Diagnostics();
				return {
					status: validation.status === 'loaded'
						&& diagnostics.health === 'healthy'
						&& diagnostics.runtimePhase === 'idle'
						&& diagnostics.verifiedThisSession
						? 'applied'
						: 'failed',
				};
			},
			repair: async () => {
				const result = await this.indexer.repairIndexV8FromMarkdown();
				return {
					status: result.status,
					affectedFiles: result.shardsWritten,
					affectedBytes: result.bytesWritten,
				};
			},
			cleanup: async () => {
				const result = await this.indexer.runIndexV8CleanupNow();
				return {
					status: this.toIndexV8DiagnosticsResultStatus(result.status),
					affectedFiles: result.deletedCount,
					affectedBytes: result.deletedBytes,
				};
			},
			retire: async () => {
				const result = await this.indexer.retireLegacyIndexV7();
				return {
					status: this.toIndexV8DiagnosticsResultStatus(result.status),
					affectedFiles: result.status === 'applied' ? 1 : 0,
					affectedBytes: result.deletedBytes,
				};
			},
		}).open();
	}

	private async buildIndexV8DiagnosticsSummary(): Promise<IndexV8DiagnosticsSummary> {
		const snapshot = await this.indexer.getIndexV8Diagnostics();
		const codeSet = new Set<IndexV8DiagnosticsSummary['codes'][number]>();
		if (snapshot.manifestStatus === 'missing') codeSet.add('manifest-missing');
		else if (snapshot.manifestStatus === 'incomplete') codeSet.add('manifest-incomplete');
		else if (snapshot.manifestStatus === 'invalid') codeSet.add('manifest-invalid');
		else if (snapshot.manifestStatus === 'unsupported') codeSet.add('manifest-unsupported');
		else if (snapshot.manifestStatus === 'io-error') codeSet.add('io-error');
		if (snapshot.recoveryMarkerPresent) codeSet.add('recovery-marker');
		if (snapshot.codes.includes('CLEANUP_SUPPRESSED')) codeSet.add('cleanup-suppressed');
		if (snapshot.codes.includes('RETIREMENT_BLOCKED')) codeSet.add('retirement-blocked');
		return {
			phase: snapshot.runtimePhase,
			health: snapshot.health,
			codes: [...codeSet],
			manifestStatus: snapshot.manifestStatus === 'loaded' ? 'verified' : snapshot.manifestStatus,
			taskCount: snapshot.taskCount,
			sourceCount: snapshot.sourceCount,
			activeShardCount: snapshot.activeShardCount,
			orphanShardCount: snapshot.maintenanceCounts['orphan-shard'] ?? 0,
			protectedShardCount: snapshot.protectedShardCount,
			ownedTempCount: snapshot.maintenanceCounts['owned-temp'] ?? 0,
			activeBytes: snapshot.activeBytes,
			maxShardBytes: snapshot.maxShardBytes,
			averageShardBytes: snapshot.averageShardBytes,
			cleanupCandidateCount: snapshot.cleanupCandidateCount,
			cleanupCandidateBytes: snapshot.cleanupCandidateBytes,
			dirtySourceCount: snapshot.dirtySourceCount,
			recoveryMarkerPresent: snapshot.recoveryMarkerPresent,
			legacy: {
				present: snapshot.legacyV7.present,
				bytes: snapshot.legacyV7.bytes,
				retirementEligible: snapshot.legacyV7.retirementEligible,
			},
			lastInspectedAt: Date.now(),
			actions: {
				refresh: { enabled: true },
				validate: { enabled: snapshot.manifestStatus === 'loaded', ...(snapshot.manifestStatus !== 'loaded' ? { disabledReason: 'unavailable' as const } : {}) },
				rebuild: { enabled: snapshot.runtimePhase === 'idle', ...(snapshot.runtimePhase !== 'idle' ? { disabledReason: 'busy' as const } : {}) },
				repair: {
					enabled: snapshot.health === 'invalid' || snapshot.health === 'unsupported' || snapshot.health === 'recovery-required',
					...(!(snapshot.health === 'invalid' || snapshot.health === 'unsupported' || snapshot.health === 'recovery-required')
						? { disabledReason: 'not-needed' as const }
						: {}),
				},
				cleanup: {
					enabled: snapshot.cleanupCandidateCount > 0,
					...(snapshot.cleanupCandidateCount === 0 ? { disabledReason: 'not-needed' as const } : {}),
				},
				retire: {
					enabled: snapshot.legacyV7.retirementEligible,
					...(!snapshot.legacyV7.retirementEligible ? { disabledReason: 'unsafe' as const } : {}),
				},
			},
		};
	}

	private toIndexV8DiagnosticsResultStatus(
		status: string,
	): IndexV8DiagnosticsActionResult['status'] {
		if (status === 'applied' || status === 'unchanged' || status === 'suppressed' || status === 'partial') {
			return status;
		}
		return status === 'stale' ? 'suppressed' : 'failed';
	}

	private registerCommands(): void {
		this.addCommand({
			id: 'open-task-creator',
			name: t('commands', 'openTaskCreator'),
			callback: () => {
				this.openTaskCreator();
			},
		});

		this.addCommand({
			id: 'open-task-finder',
			name: t('commands', 'openTaskFinder'),
			callback: () => {
				this.openTaskFinderModal();
			},
		});

		this.addCommand({
			id: 'move-inline-task-here',
			name: t('commands', 'moveInlineTaskHere'),
			editorCallback: (editor: Editor, view: MarkdownView) => {
				openMoveInlineTaskHereFinder(
					{
						app: this.app,
						indexer: this.indexer,
						getSettings: () => this.settings,
						parseInlineTaskLine: (lineText, lineNumber, filePath) => this.parseInlineTaskLine(lineText, lineNumber, filePath),
						withDuplicateConflictAutoOpenSuppressed: operation => this.withDuplicateConflictAutoOpenSuppressed(operation),
						refreshViews: () => this.refreshViews(),
						getProjectSerialDisplay: (operonId: string) => this.getProjectSerialDisplayForTask(operonId),
					},
					editor,
					view,
				);
			},
		});

		this.addCommand({
			id: 'add-task-wikilink-overlay',
			name: t('commands', 'addTaskWikilinkOverlay'),
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.openTaskWikilinkOverlayFinder(editor, view);
			},
		});

		this.addCommand({
			id: 'repair-task-wikilink-overlay-links',
			name: t('commands', 'repairTaskWikilinkOverlayLinks'),
			callback: () => {
				runAsyncAction(
					'repair Task Wikilink Overlay links failed',
					() => this.handleRepairTaskWikilinkOverlayLinksCommand(),
				);
			},
		});

		this.addCommand({
			id: 'repair-recurring-file-task-identities',
			name: t('commands', 'repairRecurringFileTaskIdentities'),
			callback: () => {
				runAsyncAction(
					'repair recurring File Task identities failed',
					() => this.handleRepairRecurringFileTaskIdentitiesCommand(),
				);
			},
		});

		// Smart task editor: create / upgrade / edit at cursor
		this.addCommand({
			id: 'open-task-editor',
			name: t('commands', 'createOrEditInlineTask'),
			editorCallback: (editor: Editor, view: MarkdownView) => {
				const cursor = editor.getCursor();
				const line = editor.getLine(cursor.line);
				const filePath = view.file?.path ?? '';
				const now = localNow();
				const inherited = this.resolveInlineTaskInheritedFields(view.file ?? null);
				const selections = editor.listSelections();
				const hasSelection = editor.somethingSelected();

				if (hasSelection) {
					if (selections.length !== 1) {
						new Notice(t('notifications', 'singleLineFragmentOrCursor'));
						return;
					}
					const created = this.buildTaskFromSelection(editor, view, selections[0], inherited, now);
					if (!created) return;
					const parsedCreated = this.parseInlineTaskLine(editor.getLine(created.lineNumber), created.lineNumber, filePath);
					if (!parsedCreated) {
						new Notice(t('notifications', 'inlineTaskFromSelectionFailed'));
						return;
					}
					this.placeCursorAfterInlineTaskDescription(editor, filePath, created.lineNumber, editor.getLine(created.lineNumber));
					this.showTaskNotice('inline-created', {
						description: parsedCreated.description,
						operonId: parsedCreated.operonId,
					});
					this.refreshMarkdownAfterInlineAuthoring(filePath);
					return;
				}

				const parsed = this.parseInlineTaskLine(line, cursor.line, filePath);

				if (parsed?.operonId) {
					// Case 1: existing Operon task → open editor for it
					this.openInlineTaskEditorForLine(editor, filePath, cursor.line, parsed);
				} else if (parsed) {
					// Case 2: plain checkbox (no operonId) → upgrade to Operon task
					this.upgradePlainCheckboxLineToOperonInlineTask(editor, view, cursor.line);
				} else if (line.trim()) {
					// Case 3: plain text / list item → convert same line into an inline task
					const taskLine = this.buildTaskFromPlainLine(line, cursor.line, filePath, inherited, now);
					editor.setLine(cursor.line, taskLine);
					const newParsed = this.parseInlineTaskLine(taskLine, cursor.line, filePath);
					if (!newParsed) {
						new Notice(t('notifications', 'lineToInlineTaskFailed'));
						return;
					}
					this.placeCursorAfterInlineTaskDescription(editor, filePath, cursor.line, taskLine);
					this.showTaskNotice('inline-created', {
						description: newParsed.description,
						operonId: newParsed.operonId,
					});
					this.refreshMarkdownAfterInlineAuthoring(filePath);
				} else {
					// Case 3: empty / non-checkbox line → create new task
					const taskLine = this.buildNewInlineTaskWithInheritedFields('', 'open', inherited, now, filePath, cursor.line);
					editor.setLine(cursor.line, taskLine);
					const newParsed = this.parseInlineTaskLine(taskLine, cursor.line, filePath);
					if (newParsed) {
						this.placeCursorAfterInlineTaskDescription(editor, filePath, cursor.line, taskLine);
						this.showTaskNotice('inline-created', {
							description: newParsed.description,
							operonId: newParsed.operonId,
						});
						this.refreshMarkdownAfterInlineAuthoring(filePath);
					}
				}
			},
		});

			this.addCommand({
				id: 'convert-tasks-emoji-line-to-inline-task',
				name: t('commands', 'convertTasksEmojiLineToInlineTask'),
				editorCallback: (editor: Editor, view: MarkdownView) => {
					runAsyncAction('convert tasks emoji line command failed', () => this.handleConvertTasksEmojiLineToOperonInlineTaskCommand(editor, view));
				},
			});

			this.addCommand({
				id: 'convert-selection-to-tasks',
				name: t('commands', 'convertSelectionToOperonTasks'),
				editorCallback: (editor: Editor, view: MarkdownView) => {
					runAsyncAction('convert selection to operon tasks command failed', () => this.handleConvertSelectionToOperonTasksCommand(editor, view));
				},
			});

			// Standalone file-task creation with template picker
			this.addCommand({
				id: 'create-file-task',
				name: t('commands', 'createFileTask'),
				callback: () => {
					runAsyncAction('create file task command failed', () => this.handleCreateFileTaskCommand());
				},
			});

			// Convert or edit a file task based on current context
			this.addCommand({
				id: 'convert-or-edit-file-task',
				name: t('commands', 'editOrConvertToFileTask'),
				callback: () => {
					runAsyncAction('convert or edit file task command failed', () => this.handleConvertOrEditFileTaskCommand());
				},
			});

			this.addCommand({
				id: 'convert-file-task-to-inline-task',
				name: t('commands', 'convertFileTaskToInlineTask'),
				callback: () => {
					runAsyncAction('convert file task to inline task command failed', () => this.handleConvertFileTaskToInlineTaskCommand());
				},
			});

		// Toggle task completion
		this.addCommand({
			id: 'toggle-completion',
			name: t('commands', 'toggleCompletion'),
			editorCallback: (editor: Editor, view: MarkdownView) => {
				const cursor = editor.getCursor();
				const line = editor.getLine(cursor.line);
				const filePath = view.file?.path ?? '';

				const parsed = this.parseInlineTaskLine(line, cursor.line, filePath);
				if (!parsed) {
					new Notice(t('notifications', 'noTaskFound'));
					return;
				}

				if (parsed.operonId && this.indexer.getTask(parsed.operonId)) {
					const operonId = parsed.operonId;
					runAsyncAction('toggle completion command failed', () => this.toggleTaskById(operonId));
					return;
				}

				const now = localNow();
				const today = now.substring(0, 10);

				if (parsed.checkbox === 'open') {
					parsed.checkbox = 'done';
					const existing = parsed.fields.find(f => f.key === 'dateCompleted');
					if (existing) {
						existing.value = today;
						existing.rawValue = today;
					} else {
						parsed.fields.push(this.createInlineField('dateCompleted', today, 'date'));
					}
					parsed.fields = parsed.fields.filter(f => f.key !== 'dateCancelled');
				} else {
					parsed.checkbox = 'open';
					parsed.fields = parsed.fields.filter(
						f => f.key !== 'dateCompleted' && f.key !== 'dateCancelled'
					);
				}

				this.normalizeParsedTaskCreatedTimestamp(parsed);
				this.touchParsedTaskModifiedTimestamp(parsed, now);

				editor.setLine(cursor.line, this.serializeInlineTask(parsed));
				this.refreshMarkdownAfterInlineAuthoring(filePath);

			},
		});

		// Start/stop timer
			this.addCommand({
				id: 'toggle-timer',
				name: t('commands', 'toggleTimer'),
				editorCallback: (editor: Editor, view: MarkdownView) => {
					runAsyncAction('toggle timer command failed', async () => {
					const cursor = editor.getCursor();
					const line = editor.getLine(cursor.line);
					const filePath = view.file?.path ?? '';

				const parsed = this.parseInlineTaskLine(line, cursor.line, filePath);
					if (!parsed?.operonId) {
						new Notice(t('notifications', 'noTaskWithId'));
						return;
					}

					if (this.timeTracker.isTimerRunning(parsed.operonId)) {
						const stopped = await this.stopActiveTimer('manual');
						if (stopped) new Notice(t('notifications', 'timerStopped', { operonId: parsed.operonId }));
					} else {
							const started = await this.startTimerForTask(parsed.operonId, 'command');
							if (started) new Notice(t('notifications', 'timerStarted', { operonId: parsed.operonId }));
						}
						});
					},
			});



		// Rebuild full index
		this.addCommand({
			id: 'rebuild-index',
			name: t('commands', 'rebuildIndex'),
			callback: () => {
				runAsyncAction('rebuild index command failed', async () => {
					new Notice(t('notifications', 'indexRebuilding'));
					await this.indexer.fullReindex();
					new Notice(t('notifications', 'indexRebuilt', { count: String(this.indexer.taskCount) }));
				});
			},
		});

		this.addCommand({
			id: 'open-index-diagnostics',
			name: t('indexStats', 'diagnosticsTitle'),
			callback: () => {
				this.openIndexV8Diagnostics();
			},
		});

		this.addCommand({
			id: 'reload-settings-from-storage',
			name: t('commands', 'reloadSettingsFromStorage'),
			callback: () => {
				runAsyncAction('reload settings from storage command failed', () => this.reloadCanonicalSettingsFromStorage('manual'));
			},
		});

		this.addCommand({
			id: 'retry-pending-workflow-rename',
			name: t('commands', 'retryPendingWorkflowRename'),
			callback: () => {
				runAsyncAction('retry pending workflow rename command failed', () => this.retryPendingWorkflowRename());
			},
		});

			// Show index stats
			this.addCommand({
				id: 'show-index-stats',
				name: t('commands', 'showIndexStats'),
				callback: () => {
					const total = this.indexer.taskCount;
					const hot = this.indexer.getHotTasks().length;
					const overdue = this.indexer.secondary.getOverdueTaskIds().length;
				const dueToday = this.indexer.secondary.getTasksDueToday().length;
				new Notice(
					t('indexStats', 'title') + '\n' +
					t('indexStats', 'total', { count: String(total) }) + '\n' +
					t('indexStats', 'open', { count: String(hot) }) + '\n' +
					t('indexStats', 'dueToday', { count: String(dueToday) }) + '\n' +
					t('indexStats', 'overdue', { count: String(overdue) })
				);
			},
		});

			this.addCommand({
				id: 'open-duplicate-id-manager',
			name: t('commands', 'openDuplicateOperonIdManager'),
			callback: () => {
				this.openDuplicateOperonIdModal();
			},
		});

			this.addCommand({
				id: 'open-pinned-tasks',
				name: t('commands', 'openPinnedTasks'),
				callback: () => {
					runAsyncAction('open pinned tasks command failed', () => this.openPinnedTasksSurface());
				},
			});

			// Toggle Pinned Tasks floating dock
			this.addCommand({
				id: 'toggle-pinned-dock',
				name: t('commands', 'togglePinnedDock'),
				callback: () => {
					runAsyncAction('toggle pinned tasks surface command failed', () => this.openPinnedTasksSurface());
				},
		});

		// Open Filter View panel
			this.addCommand({
				id: 'open-filter-view',
				name: t('commands', 'openFilterView'),
				callback: () => {
					runAsyncAction('open filter view command failed', () => this.openFilterViewById(this.settings.leftRailDefaultFilterViewId));
				},
			});

			this.addCommand({
					id: 'open-time-session-history',
					name: t('commands', 'openTimeSessionHistory'),
					callback: () => {
						runAsyncAction('open time session history command failed', () => this.openTimeSessionHistoryView());
					},
				});

			this.addCommand({
					id: 'open-flow-time',
					name: t('commands', 'openFlowTime'),
					callback: () => {
						runAsyncAction('open flow time command failed', () => this.openFlowTimeView());
					},
				});

			this.addCommand({
				id: 'open-calendar-view',
				name: t('commands', 'openCalendar'),
				callback: () => {
					runAsyncAction('open calendar command failed', () => this.openCalendarView());
				},
			});

			this.addCommand({
				id: 'update-external-calendars',
				name: t('commands', 'updateExternalCalendars'),
				callback: () => {
					runAsyncAction('update external calendars command failed', () => this.syncAllExternalCalendarsNow());
				},
			});

			this.addCommand({
				id: 'open-kanban-view',
				name: t('commands', 'openKanban'),
				callback: () => {
					runAsyncAction('open kanban command failed', () => this.openKanbanView());
				},
			});

			this.addCommand({
				id: 'open-table-view',
				name: t('commands', 'openOperonTable'),
				callback: () => {
					runAsyncAction('open operon table command failed', () => this.openOperonTable());
				},
			});

			this.addCommand({
				id: 'insert-table-embed',
				name: t('commands', 'insertOperonTableEmbed'),
				editorCallback: (editor: Editor, view: MarkdownView) => {
					this.insertOperonTableEmbedAtCursor(editor, view);
				},
			});

	}
}
