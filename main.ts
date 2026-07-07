/**
 * Operon is a task management system for humans and agents in Obsidian, built around inline tasks,
 * file tasks, reusable filters, customizable pipelines, pinned task workflows, unique calendar and
 * Kanban views, recurrence, and time tracking.
 *
 * Plugin entry point. Manages lifecycle, commands, and module initialization.
 */

import { Editor, EditorPosition, EditorSelection, MarkdownRenderer, MarkdownRenderChild, MarkdownSectionInformation, MarkdownView, MarkdownPostProcessorContext, Notice, Platform, Plugin, TFile, TAbstractFile, WorkspaceLeaf, editorLivePreviewField, requestUrl, setIcon } from 'obsidian';
import { EditorView } from '@codemirror/view';
import type { StateEffect } from '@codemirror/state';
import { OperonStorage } from './src/storage/operon-storage';
import { OperonIndexer, type IndexedTaskDelta } from './src/indexer/indexer';
import type { ProjectSerialDisplay } from './src/core/project-serials';
import { scanFileWithMappings } from './src/indexer/file-scanner';
import { TaskWriter } from './src/core/task-writer';
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
import { ProgressCalculator } from './src/systems/progress-calculator';
import { TotalDurationCalculator } from './src/systems/total-duration';
import { TotalEstimateCalculator } from './src/systems/total-estimate';
import { AggregateCoordinator } from './src/systems/aggregate-coordinator';
import { TaskStatsBackfillRunner } from './src/systems/task-stats-backfill';
import { TimeTracker } from './src/systems/time-tracker';
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
	RepeatEditScopeChoice,
	RepeatTemporalSnapshot,
} from './src/systems/recurrence-edit-scope';
import { TaskEditorModal } from './src/ui/task-editor-modal';
import {
	TaskCreatorDraft,
	TaskCreatorModal,
	TaskCreatorSubmitMode,
	buildSubtaskTaskCreatorDraft,
	buildTaskCreatorSubmitFieldSeed,
	cloneTaskCreatorDraft,
	isTaskCreatorFieldExplicitlyCleared,
	type TaskCreatorCreateType,
} from './src/ui/task-creator-modal';
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
import { OPERON_COMPACT_CHIP_HOVER_SOURCE } from './src/ui/compact-chip-link-preview';
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
import { resolveTaskColorSourceForTask } from './src/core/task-color-source';
import { asyncHandler, runAsyncAction } from './src/core/async-action';
import { getAppLocale, getCommunityPlugin, isDailyNotesCoreAvailable } from './src/core/obsidian-app';
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
import { syncOperonDocs, type OperonDocsSyncResult } from './src/systems/operon-docs-sync';
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
	applyDynamicFileTaskFilterHostPlacement,
	DYNAMIC_FILE_TASK_FILTER_HOST_CLASS,
	operonDynamicFileTaskFilterLivePreviewExtension,
	renderDynamicFileTaskFilterSurface,
} from './src/ui/dynamic-file-task-filter';
import { SubtasksFilterModal } from './src/ui/subtasks-filter-modal';
import { FilterSetModal, refreshFilterPreviewModals, refreshFilterSetModals, type FilterModalEvalDeps } from './src/ui/filter-set-modal';
import { OperonReleaseNotesModal } from './src/ui/release-notes-modal';
import { OperonSettingsTab } from './src/ui/settings-tab';
import { TimeSessionHistoryView, TIME_SESSION_HISTORY_VIEW_TYPE } from './src/ui/time-session-history-view';
import { FlowTimeView, FLOW_TIME_VIEW_TYPE } from './src/ui/flow-time-view';
import { TimeTrackerStatusBar } from './src/ui/time-tracker-status-bar';
import { FormatConverter } from './src/systems/format-converter';
import { FileTaskArchiver } from './src/systems/file-task-archiver';
import { ExternalCalendarService } from './src/systems/external-calendar-service';
import { buildExternalCalendarItems } from './src/systems/external-calendar-query';
import { formatDurationHuman, parseLocalDatetime } from './src/systems/tracker-utils';
import { hasOperonFields, parseListValue, parseTaskLine, resolveInlineTaskDescriptionCursorCh } from './src/core/parser';
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
import { getReleaseNotesForUpdate } from './src/core/release-notes';
import { isOperonExcludedPath } from './src/core/operon-path-exclusions';
import { normalizeRepeatIdentityPayload } from './src/core/repeat-identity';
import { shouldAutoUnpinTerminalTask } from './src/core/pinned-task-rules';
import { OPERON_DEMO_AGGREGATE_PARENT_IDS, createOrRepairBasicsWorkspace, hasBasicsWorkspaceArtifact } from './src/core/demo-project';
import { DEFAULT_DAILY_NOTE_FORMAT, resolveDailyNotePathFromDateKey } from './src/core/daily-note-path';
import { buildDailyNoteInlineTaskDefaultWritePlans } from './src/core/daily-note-inline-task-defaults';
import { resolveDailyNoteParentRealignmentTargetDate } from './src/core/daily-note-parent-realignment';
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
	FileTaskTemplateOption,
	findFileTaskTemplateOptionById,
	orderFileTaskTemplateOptionsByLastUsed,
	templateDocumentContainsTemplaterSyntax,
} from './src/core/file-task-templates';
import { localNow, localToday } from './src/core/local-time';
import { formatUiTime } from './src/core/ui-time-format';
import {
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
import { cloneFilterSet, DEFAULT_INLINE_TASK_TARGET_FILE, DUPLICATE_ALERT_DELAY_SECONDS_OPTIONS, FilterSet, normalizeInlineTaskHeadingKeyword, OperonSettings } from './src/types/settings';
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
import { initI18n, t } from './src/core/i18n';
import { ConfirmActionModal } from './src/ui/confirm-action-modal';
import { FileTaskTemplatePickerModal } from './src/ui/file-task-template-picker-modal';
import { InlineTaskTargetFilePickerModal } from './src/ui/inline-task-target-file-picker-modal';
import { FieldRenameProgressModal } from './src/ui/field-rename-progress-modal';
import { DuplicateOperonIdModal } from './src/ui/duplicate-operonid-modal';
import { BlockedTaskModal } from './src/ui/blocked-task-modal';
import {
	executePipelineRenamePreview,
	PipelineRenameProgressSnapshot,
	PipelineRenameExecutionResult,
	PipelineRenamePreview,
} from './src/core/pipeline-rename-migration';
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
	OPERON_TABLE_VIEW_TYPE,
	cloneTablePreset,
	createDefaultTablePreset,
	createTablePresetId,
	type TableLeafState,
	type TablePreset,
	type TablePresetPatch,
} from './src/types/table';
import { buildUniqueRelatedPresetName } from './src/ui/related-views';
import type { RelatedViewCreateTarget, RelatedViewOpenTarget } from './src/types/related-views';
import { isEditableTableTaskFieldKey, normalizeTableTaskFieldKey } from './src/ui/table/table-field-catalog';
import { buildTableEmbedCode } from './src/ui/table/table-export';
import { applyTablePresetPatch } from './src/ui/table/table-preset-model';
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

interface DailyNotesPluginConfig {
	folder: string;
	template: string;
	format: string;
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
const RAW_TASK_CREATION_BULK_NOTICE_THRESHOLD = 4;
const RAW_TASK_CREATION_NOTICE_SUPPRESSION_TTL_MS = 30_000;
const DUPLICATE_ALERT_RESOLVED_HIDE_DELAY_MS = 10_000;
const CANONICAL_SETTINGS_RELOAD_THROTTLE_MS = 5_000;
const WORKSPACE_TWEAK_HIDE_SCROLLBARS_CLASS = 'operon-tweak-hide-scrollbars';
const WORKSPACE_TWEAK_PROPERTIES_COLLAPSER_CLASS = 'operon-tweak-properties-collapser';
const WORKSPACE_TWEAK_PROPERTIES_COLLAPSER_TARGET_CLASS = 'operon-tweak-properties-collapser-target';
const WORKSPACE_TWEAK_COMPACT_SIDEBAR_TAB_ICONS_CLASS = 'operon-tweak-compact-sidebar-tab-icons';
const WORKSPACE_TWEAK_PROPERTIES_COLLAPSE_RETRY_DELAYS_MS = [0, 75, 200, 500, 1000] as const;

interface WorkspaceTweakPropertiesCollapseCycle {
	id: number;
	attempted: boolean;
}

export default class OperonPlugin extends Plugin {
	storage!: OperonStorage;
	indexer!: OperonIndexer;
	writer!: TaskWriter;
	dependencyManager!: DependencyManager;
	progressCalculator!: ProgressCalculator;
	totalDurationCalculator!: TotalDurationCalculator;
	totalEstimateCalculator!: TotalEstimateCalculator;
	aggregateCoordinator!: AggregateCoordinator;
	taskStatsBackfillRunner!: TaskStatsBackfillRunner;
	timeTracker!: TimeTracker;
	recurrenceService!: RecurrenceService;
	formatConverter!: FormatConverter;
	settings!: OperonSettings;
	private keyMappingSignature = '';
	private settingsReindexTimer: WindowTimeoutHandle | null = null;
	private canonicalSettingsReloadTimer: WindowTimeoutHandle | null = null;
	private canonicalSettingsReloadRunning = false;
	private canonicalSettingsReloadLastCheckAt = 0;
	private yamlPropertyVisibilityRefreshTimer: WindowTimeoutHandle | null = null;
	private locationPlaceTableRefreshTimer: WindowTimeoutHandle | null = null;
	private workspaceTweakPropertiesCollapseCycleId = 0;
	private workspaceTweakPropertiesCollapseCycles = new WeakMap<MarkdownView, WorkspaceTweakPropertiesCollapseCycle>();
	private workspaceTweakPropertiesCollapseTimers: WindowTimeoutHandle[] = [];
	private workspaceTweakPropertiesTargetEls = new Set<HTMLElement>();
	private workspaceTweakBodyDocuments = new Set<Document>();
	private embedFilterDeps: EmbedFilterDeps | null = null;
	private embedTableDeps: EmbedTableDeps | null = null;
	private readonly tablePresetMutationQueue = new TablePresetMutationQueue();
	private dynamicFileTaskFilterReadingTimers = new Map<string, WindowTimeoutHandle>();
	private dynamicFileTaskFilterReadingHosts = new Set<HTMLElement>();
	private dynamicFileTaskFilterReadingInstances = new WeakMap<HTMLElement, FilterSurfaceInstance>();
	private deferredRefreshTimer: WindowTimeoutHandle | null = null;
	private editableFocusRefreshTimer: WindowTimeoutHandle | null = null;
	private refreshViewsFrame: number | null = null;
	private refreshViewsFollowupRequested = false;
	private refreshViewsPendingRequestCount = 0;
	private refreshViewsPendingPerfContext: RefreshViewsPerfContext | null = null;
	private refreshViewsPendingMarkdownScope: MarkdownRefreshScope | null = null;
	private livePreviewAuthoringCursorRestoreLease: LivePreviewAuthoringCursorRestoreLease | null = null;
	private livePreviewAuthoringCursorRestoreClearTimer: WindowTimeoutHandle | null = null;
	private indexSideEffectTimer: WindowTimeoutHandle | null = null;
	private indexSideEffectRunning = false;
	private indexSideEffectFollowupRequested = false;
	private projectSerialIndexReconcileRunning = false;
	private projectSerialIndexReconcileFollowupRequested = false;
	private fileTaskArchiver: FileTaskArchiver | null = null;
	private livePreviewEphemeralSession = new LivePreviewEphemeralSessionController();
	private activeLivePreviewPickerClose: (() => void) | null = null;
	private suppressLivePreviewSessionEditorChange = false;
	private livePreviewPendingPickerSessionId: string | null = null;
	private livePreviewPendingPickerUntil = 0;
	private workflowNormalizationInProgress = new Set<string>();
	private trackerStatusBar: TimeTrackerStatusBar | null = null;
	private pinnedDock: PinnedTasksDock | null = null;
	private mobileGlobalTaskFab: MobileGlobalTaskFab | null = null;
	private taskCreatorModal: TaskCreatorModal | null = null;
	private subtasksFilterModal: SubtasksFilterModal | null = null;
	private pinnedCache: PinnedCache | null = null;
	private externalCalendarService: ExternalCalendarService | null = null;
	private operonDocsSyncInFlight: Promise<OperonDocsSyncResult> | null = null;
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
		await this.storage.filters.delete(filterSetId);
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
			onClose: async () => {
				if (this.settings.releaseNotesLastShownVersion === currentVersion) return;
				this.settings.releaseNotesLastShownVersion = currentVersion;
				await this.storage.saveSettings();
			},
		}).open();
	}

	private handleSettingsChanged(): void {
		this.writer.updateKeyMappings(this.settings.keyMappings);
		const previousKeyMappingSignature = this.keyMappingSignature;
		this.keyMappingSignature = this.buildKeyMappingSignature();
		if (previousKeyMappingSignature !== this.keyMappingSignature) {
			this.scheduleSettingsReindex();
		}
		void this.externalCalendarService?.applySettings(this.settings.externalCalendars);
		initI18n(getAppLocale(this.app), this.settings.language);
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
		try {
			await this.reconcileProjectSerials();
		} catch (error) {
			console.warn('Operon: failed to reconcile project serials after index mutation', error);
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
			const result = await this.storage.reloadCanonicalSettingsPackage();
			const failed = result.diagnostics.malformedPackage;
			if (failed) {
				console.warn('Operon: canonical settings reload warning', result.diagnostics);
				if (mode === 'manual') {
					new Notice(t('notifications', 'settingsReloadFailed'));
				}
				return;
			}
			if (result.changed) {
				this.handleSettingsChanged();
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

	private refreshCalendarLeaves(statusCycleTrace: StatusCyclePerfTrace | null = null): void {
		for (const leaf of this.app.workspace.getLeavesOfType(CALENDAR_VIEW_TYPE)) {
			if (
				statusCycleTrace
				&& callUnknownMethod(leaf.view, 'markDirtyForStatusCycle', statusCycleTrace) === true
			) {
				continue;
			}
			callUnknownMethod(leaf.view, 'markDirty');
		}
	}

	private refreshKanbanLeaves(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(KANBAN_VIEW_TYPE)) {
			callUnknownMethod(leaf.view, 'markDirty');
		}
	}

	private refreshTableLeaves(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(OPERON_TABLE_VIEW_TYPE)) {
			if (hasUnknownMethod(leaf.view, 'renderIfVisibleOrInvalidate')) {
				callUnknownMethod(leaf.view, 'renderIfVisibleOrInvalidate');
			} else {
				callUnknownMethod(leaf.view, 'render');
			}
		}
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

	private async syncOperonDocsNow(source: 'manual' | 'auto' = 'manual'): Promise<OperonDocsSyncResult | null> {
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
		const started = await this.timeTracker.start(taskId, source, startOverride);
		if (started) this.refreshTimerStateSurfaces();
		return started;
	}

	private async stopActiveTimer(reason: TrackerStopReason = 'manual'): Promise<boolean> {
		const stopped = await this.timeTracker.stop(reason);
		if (stopped) this.refreshTimerStateSurfaces();
		return stopped;
	}

	private async startUnassignedTimer(source: TrackerSource = 'command'): Promise<boolean> {
		const started = await this.timeTracker.startUnassigned(source);
		if (started) this.refreshTimerStateSurfaces();
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
			collapsedGroupKeys: Array.isArray(state?.collapsedGroupKeys)
				? state.collapsedGroupKeys.filter((key): key is string => typeof key === 'string')
				: [],
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

	private async loadPlugin(): Promise<void> {
		registerObsidianIconFallbacks();

		// Initialize storage and settings
		this.storage = new OperonStorage(this.app, {
			pluginId: this.manifest.id,
			loadData: () => this.loadData(),
			saveData: (data: unknown) => this.saveData(data),
		});
		await this.storage.initialize();
		this.settings = this.storage.getSettings();
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

		// Initialize i18n — use language override from settings, or detect Obsidian's locale
		initI18n(getAppLocale(this.app), this.settings.language);
		this.applyWorkspaceTweaks();
		this.registerHoverLinkSource(OPERON_COMPACT_CHIP_HOVER_SOURCE, {
			display: 'Operon',
			defaultMod: true,
		});

		// Initialize indexer, task writer, and core systems
		this.indexer = new OperonIndexer(this.app, this.storage);
		setExistingIdsProvider(() => this.indexer.getAllOperonIds());
		this.writer = new TaskWriter(this.app, this.indexer, this.settings.keyMappings, {
			onBeforeWriteFile: filePath => this.markInternalTaskWrite(filePath),
			onDuplicateConflict: operonId => {
				this.scheduleDuplicateConflictAlert(operonId);
			},
		});
		this.dependencyManager = new DependencyManager(this.indexer, this.writer);
		this.progressCalculator = new ProgressCalculator(this.indexer, this.writer);
		this.totalDurationCalculator = new TotalDurationCalculator(this.indexer, this.writer);
		this.totalEstimateCalculator = new TotalEstimateCalculator(this.indexer, this.writer);
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
			this.totalDurationCalculator,
			this.totalEstimateCalculator,
			() => this.settings,
			(operonId) => {
				this.scheduleDuplicateConflictAlert(operonId);
			},
				async (operonId) => {
					await this.aggregateCoordinator.refreshDurationAfterTaskIds([operonId]);
				},
				(task, payload) => this.guardTaskStatusChangeOrShow(task, payload),
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
		const hasCached = await this.indexer.loadCachedIndex();

		// Refresh sidebar views whenever the index is updated
		// Suppressed during startup — onLayoutReady handles the authoritative render
		this.indexer.onIndexUpdated = () => {
			if (!this.startupReady) return;
			this.scheduleIndexSideEffects();
		};
		this.indexer.onTasksRemoved = (removedTasks) => {
			if (!this.startupReady || removedTasks.length === 0) return;
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
		this.addSettingTab(new OperonSettingsTab(
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
					(operation) => this.enqueueTablePresetMutation(operation),
				));

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

				this.addRibbonIcon('pin', t('commands', 'openPinnedTasks'), () => {
					runAsyncAction('open pinned tasks from ribbon failed', () => this.openPinnedTasksSurface());
				});

			this.scheduleYamlPropertyVisibilityRefresh(150);

			// Startup reindex strategy:
			// - No cache: full reindex immediately (nothing usable yet)
			// - Cache exists: diff reindex (catches agent-written tasks while app was closed),
			//   then optionally follow with a full reindex after 15s for completeness
			if (!hasCached) {
				await this.indexer.fullReindex();
				await this.runStartupTaskStatsBackfill();
			} else {
				await this.indexer.diffReindex();
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

					await this.recurrenceService.reconcileStoredSeries();
					await this.dependencyManager.reconcileAdditiveInverseLinks();
					await this.reconcileProjectSerials({ notifyCapacity: true });

					// Mark startup complete — one authoritative render + resumeFromIndex
				this.startupReady = true;
				await this.timeTracker.resumeFromIndex({ migrateLegacy: true });
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

	onunload(): void {
		runAsyncAction('plugin unload failed', () => this.unloadPlugin());
	}

	private async unloadPlugin(): Promise<void> {
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
		this.pinnedDock = null;
		await this.timeTracker.flushPendingTransitions();
		this.timeTracker.destroy();
		this.closeActiveLivePreviewPicker();
		this.livePreviewEphemeralSession.cancel('plugin_unload');
		hideTaskContextualHoverMenu(true);

		await this.indexer.flushPendingPersist();
		await this.storage.flushPendingWrites();
		this.indexer.destroy();
		this.storage.destroy();
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
						await this.updateTaskFieldAndRefresh(operonId, key, value);
					},
					updateFields: async (operonId, payload) => {
						await this.updateTaskFieldsAndRefresh(operonId, payload);
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
					onOpenTaskEditor: (operonId) => this.openEditorForId(operonId),
					onOpenTaskSource: openTaskSourceInNewTab,
					onOpenPresetSettings: (presetId) => this.openTablePresetSettingsModal(presetId, leaf),
					onOpenRelatedView: (target) => this.openRelatedViewTarget(target),
					onCreateRelatedView: (target) => this.createRelatedViewPresetAndOpen(target),
					onSavePresetPatch: (patch) => this.saveTablePresetPatchAndRefresh(patch),
					onSaveFilterSet: (filterSet) => this.saveFilterSetAndRefresh(filterSet),
					onUpdateTaskFields: (operonId, payload) => this.updateTableTaskFieldsAndRefresh(operonId, payload),
					getTaskSessions: (operonId) => this.timeTracker.getTaskSessions(operonId),
					onAddTaskSession: (operonId, start, end) => this.addTableTaskSessionAndRefresh(operonId, start, end),
					onEditTaskSession: (session, start, end) => this.editTableTaskSessionAndRefresh(session, start, end),
					onDeleteTaskSession: (session) => this.deleteTableTaskSessionAndRefresh(session),
					onStatusIconClick: (taskId) => this.handleCalendarStatusIconClick(taskId),
					onContextualAction: (taskId, actionId, context, invocation) => this.handleContextualMenuAction(taskId, actionId, context, invocation),
					isTaskPinned: (taskId) => this.pinnedCache?.isPinned(taskId) === true,
					hasSubtasks: (taskId) => this.indexer.secondary.getChildIds(taskId).size > 0,
				},
			)
		);
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
			await this.storage.repeatSeries.upsertFollowingOverride(
				projected.seriesId,
				buildFollowingOverride(nextSnapshot, now),
				now,
			);
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

		await this.updateTaskFieldsAndRefresh(task.operonId, persistedPayload, { changedKeys: persistedChangedKeys });
		if (scope === 'thisAndFollowingTasks' && seriesId) {
			await this.storage.repeatSeries.upsertFollowingOverride(
				seriesId,
				buildFollowingOverride(followingSnapshot, now),
				now,
			);
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
		if (indexedTask.checkbox !== 'open') return;

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
		const anchor = document.createElement('span');
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
			const preset = this.createRelatedCalendarPreset(target.variant, target.filterSetId);
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
			const preset = this.createRelatedKanbanPreset(target.filterSetId);
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
		const preset = this.createRelatedTablePreset(target.filterSetId);
		await this.enqueueTablePresetMutation(async () => {
			const snapshot = this.snapshotTablePresetSettings();
			this.settings.tablePresets.push(preset);
			if (!this.settings.tableDefaultPresetId) {
				this.settings.tableDefaultPresetId = this.settings.tablePresets[0]?.id ?? null;
			}
			try {
				await this.storage.saveSettings();
			} catch (error) {
				this.restoreTablePresetSettings(snapshot);
				this.refreshViews();
				throw error;
			}
			this.refreshViews();
		});
		await this.openOperonTable({ presetId: preset.id });
	}

	private createRelatedCalendarPreset(
		variant: Extract<RelatedViewCreateTarget, { type: 'calendar' }>['variant'],
		filterSetId: string | null,
	): CalendarPreset {
		const defaults = cloneDefaultCalendarPresets();
		const template = variant === 'multiWeek'
			? defaults.find(preset => preset.surfaceType === 'multiWeek') ?? defaults[0]
			: defaults.find(preset => preset.surfaceType === 'timeGrid') ?? defaults[0];
		return {
			...template,
			id: createCalendarPresetId(),
			name: buildUniqueRelatedPresetName(this.getRelatedCalendarPresetName(variant), this.settings.calendarPresets),
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

	private createRelatedKanbanPreset(filterSetId: string | null): KanbanPreset {
		const template = cloneDefaultKanbanPresets()[0];
		return {
			...template,
			id: createKanbanPresetId(),
			name: buildUniqueRelatedPresetName(t('table', 'relatedViewsKanbanDefaultPipelinePresetName'), this.settings.kanbanPresets),
			pipelineId: this.resolveDefaultKanbanPipelineId(),
			filterSetId,
			sortRules: template.sortRules.map(rule => ({ ...rule })),
		};
	}

	private resolveDefaultKanbanPipelineId(): string | null {
		return this.settings.pipelines.find(pipeline => pipeline.name === this.settings.defaultPipelineName)?.id
			?? this.settings.pipelines[0]?.id
			?? null;
	}

	private createRelatedTablePreset(filterSetId: string | null): TablePreset {
		const preset = createDefaultTablePreset();
		return {
			...preset,
			id: createTablePresetId(),
			name: buildUniqueRelatedPresetName(t('table', 'relatedViewsTableDefaultPresetName'), this.settings.tablePresets),
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
		if (!this.settings.tablePresets.some(entry => entry.id === this.settings.tableDefaultPresetId)) {
			this.settings.tableDefaultPresetId = this.settings.tablePresets[0]?.id ?? null;
		}
	}

	private enqueueTablePresetMutation<T>(operation: () => Promise<T>): Promise<T> {
		return this.tablePresetMutationQueue.enqueue(operation);
	}

	private snapshotTablePresetSettings(): { tablePresets: TablePreset[]; tableDefaultPresetId: string | null } {
		return {
			tablePresets: this.settings.tablePresets.map(cloneTablePreset),
			tableDefaultPresetId: this.settings.tableDefaultPresetId,
		};
	}

	private restoreTablePresetSettings(snapshot: { tablePresets: TablePreset[]; tableDefaultPresetId: string | null }): void {
		this.settings.tablePresets = snapshot.tablePresets.map(cloneTablePreset);
		this.settings.tableDefaultPresetId = snapshot.tableDefaultPresetId;
	}

	private async saveTablePresetPatchAndRefresh(patch: TablePresetPatch): Promise<void> {
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

	private async addTablePresetAndRefresh(preset: TablePreset, leaf: WorkspaceLeaf): Promise<void> {
		await this.enqueueTablePresetMutation(async () => {
			const snapshot = this.snapshotTablePresetSettings();
			this.settings.tablePresets.push(preset);
			if (!this.settings.tableDefaultPresetId) {
				this.settings.tableDefaultPresetId = preset.id;
			}
			try {
				await this.storage.saveSettings();
			} catch (error) {
				this.restoreTablePresetSettings(snapshot);
				this.refreshViews();
				throw error;
			}
		});
		await this.activateTablePresetInLeaf(leaf, preset.id);
		this.refreshViews();
	}

	private async deleteTablePresetAndRefresh(presetId: string, leaf: WorkspaceLeaf): Promise<void> {
		let fallbackPresetId: string | null = null;
		let deleted = false;
		await this.enqueueTablePresetMutation(async () => {
			if (this.settings.tablePresets.length <= 1) return;
			const snapshot = this.snapshotTablePresetSettings();
			const deletedIndex = this.settings.tablePresets.findIndex(entry => entry.id === presetId);
			if (deletedIndex === -1) return;
			this.settings.tablePresets.splice(deletedIndex, 1);
			deleted = true;
			fallbackPresetId = this.settings.tablePresets[Math.max(0, deletedIndex - 1)]?.id
				?? this.settings.tablePresets[0]?.id
				?? null;
			if (!this.settings.tablePresets.some(entry => entry.id === this.settings.tableDefaultPresetId)) {
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
		if (fallbackPresetId) {
			await this.activateTablePresetInLeaf(leaf, fallbackPresetId);
		}
		this.refreshViews();
	}

	private async setDefaultTablePresetAndRefresh(presetId: string): Promise<void> {
		await this.enqueueTablePresetMutation(async () => {
			if (!this.settings.tablePresets.some(entry => entry.id === presetId)) return;
			const snapshot = this.snapshotTablePresetSettings();
			this.settings.tableDefaultPresetId = presetId;
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

	private openTablePresetSettingsModal(presetId: string, leafOrResolver: WorkspaceLeaf | (() => WorkspaceLeaf)): void {
		const resolveLeaf = () => typeof leafOrResolver === 'function' ? leafOrResolver() : leafOrResolver;
		const preset = this.settings.tablePresets.find(entry => entry.id === presetId) ?? null;
		new TablePresetQuickSettingsModal(this.app, {
			getSettings: () => this.settings,
			preset,
			onSave: (patch) => this.saveTablePresetPatchAndRefresh(patch),
			onCreate: (created) => this.addTablePresetAndRefresh(created, resolveLeaf()),
			onDuplicate: (created) => this.addTablePresetAndRefresh(created, resolveLeaf()),
			onDelete: (deletedPresetId) => this.deleteTablePresetAndRefresh(deletedPresetId, resolveLeaf()),
			onSetDefault: (defaultPresetId) => this.setDefaultTablePresetAndRefresh(defaultPresetId),
			onSaveFilterSet: (filterSet) => this.saveFilterSetAndRefresh(filterSet),
			getFilterModalEvalDeps: () => this.buildFilterModalEvalDeps(),
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
			filterSet,
			tasks: this.indexer.getAllTasks(),
			priorities: this.settings.priorities,
			pinnedCache: this.pinnedCache,
			manualOrder,
			keyMappings: this.settings.keyMappings,
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
		this.refreshViews();
	}

	private isKanbanTaskAtDropTarget(
		task: IndexedTask,
		pipeline: import('./src/types/pipeline').Pipeline,
		presetSwimlaneBy: KanbanDropContext['swimlaneBy'],
		context: KanbanDropContext,
	): boolean {
		const status = resolveTaskStatusDefinition(task, pipeline);
		if (status?.id !== context.targetStatusId) return false;
		const laneKeys = extractLaneKeys(task, context.swimlaneBy ?? presetSwimlaneBy, this.settings.keyMappings);
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

	private async markTaskDoneById(operonId: string): Promise<void> {
		const task = this.indexer.getTask(operonId);
		if (!task || task.checkbox !== 'open') return;
		const now = localNow();
			const today = now.substring(0, 10);
			const statusVal = task.fieldValues['status'] ?? '';
			const toggleResolution = getCheckboxToggleWorkflowStatus(this.settings.pipelines, statusVal, task.checkbox);
			if (toggleResolution.checkbox !== 'done') return;

			const payload: Record<string, string> = {
			datetimeModified: now,
		};
		if (statusVal && toggleResolution.workflow) {
			payload['status'] = toggleResolution.workflow.value;
			}
			this.applyCheckboxStateToFieldPayload(payload, 'done', today, task.fieldValues);
			if (!await this.guardTaskStatusChangeOrShow(task, payload)) return;
			if (this.timeTracker.isTimerRunning(operonId)) {
				await this.stopActiveTimer('terminal-status');
			}

			await this.updateTaskFieldsAndRefresh(operonId, payload, {
			changedKeys: ['_checkbox', 'dateCompleted', 'dateCancelled', 'datetimeModified', ...(payload['status'] ? ['status'] : [])],
		});
	}

	private async cancelTaskById(operonId: string): Promise<void> {
		const task = this.indexer.getTask(operonId);
		if (!task || task.checkbox !== 'open') return;
		const now = localNow();
		const today = now.substring(0, 10);
		const statusVal = task.fieldValues['status'] ?? '';
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
		if (swimlaneBy === 'priority' || swimlaneBy === 'dateDue' || swimlaneBy === 'dateScheduled') {
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
		const config = await this.loadDailyNotesPluginConfig();
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
		if (renderedContent !== template.content) {
			await this.app.vault.modify(created, renderedContent);
		}

		const initializedDocument = await this.maybeInitializeDailyNoteAsOperonTask(created);
		return {
			file: created,
			wasCreated: true,
			operonParentTaskId: initializedDocument?.managedFieldValues['operonId']?.trim() || null,
			operonParentFieldValues: initializedDocument?.managedFieldValues
				? { ...initializedDocument.managedFieldValues }
				: null,
			operonParentTags: initializedDocument ? [...initializedDocument.tags] : null,
		};
	}

	private async maybeInitializeDailyNoteAsOperonTask(file: TFile): Promise<ParsedFrontmatterDocument | null> {
		if (!this.settings.createDailyNotesAsOperonTask) return null;

		const document = await this.loadParsedFrontmatterDocument(file);
		const draft = this.buildFileTaskDraft({
			description: file.basename,
			fieldValues: { ...document.managedFieldValues },
			fieldPresence: document.managedFieldPresence,
			tags: [...document.tags],
			tagsPresent: document.tagsPresent,
			frontmatterDocument: document,
		}, null, localNow(), 'preserve-source');

		const currentContent = await this.app.vault.cachedRead(file);
		const resolvedContent = this.resolveOperonIdPlaceholdersInContent(draft.content);
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

		const config = await this.loadDailyNotesPluginConfig();
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

	private async loadDailyNotesPluginConfig(): Promise<DailyNotesPluginConfig> {
		try {
			const raw = await this.app.vault.adapter.read(`${this.app.vault.configDir}/daily-notes.json`);
			const parsed = JSON.parse(raw) as { folder?: unknown; template?: unknown; format?: unknown };
			return {
				folder: typeof parsed.folder === 'string' ? parsed.folder.trim() : '',
				template: typeof parsed.template === 'string' ? parsed.template.trim() : '',
				format: typeof parsed.format === 'string' && parsed.format.trim()
					? parsed.format.trim()
					: DEFAULT_DAILY_NOTE_FORMAT,
			};
		} catch {
			return {
				folder: '',
				template: '',
				format: DEFAULT_DAILY_NOTE_FORMAT,
			};
		}
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
			updateField: (operonId: string, key: string, value: string) => {
				void this.updateTaskFieldAndRefresh(operonId, key, value);
			},
			updateFields: (operonId: string, payload: Record<string, string>) => {
				void this.updateTaskFieldsAndRefresh(operonId, payload);
			},
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
				updateField: (operonId: string, key: string, value: string) => {
					void this.updateTaskFieldAndRefresh(operonId, key, value);
				},
				updateFields: (operonId: string, payload: Record<string, string>) => {
					void this.updateTaskFieldsAndRefresh(operonId, payload);
				},
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
			getPinnedCache: () => this.pinnedCache,
			openTaskEditor: (operonId: string) => this.openEditorForId(operonId),
			openTaskSource: (operonId: string) => this.openMaterializedTaskSourceInNewTab(operonId),
			allowWrites: true,
			updateTaskFields: (operonId, payload) => this.updateTableTaskFieldsAndRefresh(operonId, payload),
			getTaskSessions: (operonId) => this.timeTracker.getTaskSessions(operonId),
			addTaskSession: (operonId, start, end) => this.addTableTaskSessionAndRefresh(operonId, start, end),
			editTaskSession: (session, start, end) => this.editTableTaskSessionAndRefresh(session, start, end),
			deleteTaskSession: (session) => this.deleteTableTaskSessionAndRefresh(session),
			onStatusIconClick: (taskId) => this.handleCalendarStatusIconClick(taskId),
			onContextualAction: (taskId, actionId, context, invocation) => this.handleContextualMenuAction(taskId, actionId, context, invocation),
			onOpenPresetSettings: (presetId) => this.openTablePresetSettingsModal(presetId, () => this.resolveTablePresetSettingsLeafForEmbed()),
			onSavePresetPatch: (patch) => this.saveTablePresetPatchAndRefresh(patch),
			onSaveFilterSet: (filterSet) => this.saveFilterSetAndRefresh(filterSet),
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
							const wrote = await this.updateTaskFieldAndRefresh(operonId, key, value);
							if (!wrote && restoreCursor && !this.shouldSuppressLivePreviewFallbackAfterBlockedStatus(operonId)) {
								await this.updateLivePreviewInlineFieldsFallback(operonId, { [key]: value }, restoreCursor);
							}
						if (restoreCursor) {
							this.restoreLivePreviewAuthoringCursor(
							restoreCursor.filePath,
							{ line: restoreCursor.lineNumber, ch: restoreCursor.ch },
								true,
								true,
								restoreCursor.editorView,
								restoreCursor.trackDescriptionEnd === true,
							);
						}
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
							const wrote = await this.updateTaskFieldsAndRefresh(operonId, payload);
							if (!wrote && restoreCursor && !this.shouldSuppressLivePreviewFallbackAfterBlockedStatus(operonId)) {
								await this.updateLivePreviewInlineFieldsFallback(operonId, payload, restoreCursor);
							}
						if (restoreCursor) {
							this.restoreLivePreviewAuthoringCursor(
							restoreCursor.filePath,
							{ line: restoreCursor.lineNumber, ch: restoreCursor.ch },
								true,
								true,
								restoreCursor.editorView,
								restoreCursor.trackDescriptionEnd === true,
							);
						}
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
							updateField: async (operonId: string, key: string, value: string) => {
								await this.updateTaskFieldAndRefresh(operonId, key, value);
							},
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
			const host = root.ownerDocument.createElement('div');
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
				if (!(leaf?.view instanceof MarkdownView)) return;
				this.scheduleYamlPropertyVisibilityRefresh(120);
			}),
		);

		this.registerEvent(
			this.app.metadataCache.on('changed', file => {
				if (file.extension !== 'md') return;
				invalidateCustomFieldValueCandidateCache(this.app);
				invalidateLocationPlaceIndex(this.app);
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
		});
	}

	private async openTaskEditorFor(
		task: ParsedTask | null,
		onSave: OnSaveCallback,
		options: TaskEditorContentOptions = {},
	): Promise<void> {
		const indexedBeforeSave = task?.operonId ? this.indexer.getTask(task.operonId) : null;
		const fallbackSourceFormat = indexedBeforeSave?.primary.format ?? 'inline';
		let resolvedOptions: TaskEditorContentOptions;
		const wrappedOnSave: OnSaveCallback = async (request) => {
			const saved = await onSave(request);
			if (saved === false || saved === null) return saved;
			const parsed = this.parseInlineTaskLine(request.taskLine, task?.lineNumber ?? 0, task?.filePath ?? '');
			const operonId = parsed?.operonId?.trim();
			if (!operonId) return;
			const parsedFilePath = parsed?.filePath?.trim() || task?.filePath?.trim() || '';
			const freshTask = this.indexer.getTask(operonId)
				?? (parsedFilePath ? await this.awaitIndexedTask(parsedFilePath, operonId) : null);
				if (freshTask) {
					if (resolvedOptions.fileBody && freshTask.primary.format === 'yaml') {
						resolvedOptions.fileBody.filePath = freshTask.primary.filePath;
					}
					await this.syncRepeatSeriesEntryIfNeeded(freshTask);
					await this.applyInlineRepeatCompletionModeIfRequested(freshTask, request.inlineCompletionMode);
					return true;
				}

			const fieldValues = parsed
				? Object.fromEntries(parsed.fields.map(field => [field.key, field.value]))
				: {};
			const seriesId = fieldValues['repeatSeriesId']?.trim();
			if (!seriesId) return;
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
			return true;
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
			onApplyEstimateReallocation: async (request: TaskEditorEstimateReallocationRequest): Promise<boolean> => {
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
			await delayWithActiveWindow(500);
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
		await this.reconcileProjectSerialsForIndexMutation();
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
		if (!this.startupReady) return;
		this.projectSerialIndexReconcileFollowupRequested = true;
		if (this.projectSerialIndexReconcileRunning) return;
		void this.runProjectSerialIndexReconcile();
	}

	private async runProjectSerialIndexReconcile(): Promise<void> {
		if (this.projectSerialIndexReconcileRunning) return;
		this.projectSerialIndexReconcileRunning = true;
		const startedAt = enginePerfNow();
		try {
			do {
				this.projectSerialIndexReconcileFollowupRequested = false;
				await this.reconcileProjectSerialsForIndexMutation();
			} while (this.projectSerialIndexReconcileFollowupRequested);
			this.refreshViews();
		} finally {
			this.projectSerialIndexReconcileRunning = false;
			enginePerfLog('projectSerials.reconcileFromIndex', `${Math.round(enginePerfNow() - startedAt)}ms`);
			if (this.projectSerialIndexReconcileFollowupRequested) {
				void this.runProjectSerialIndexReconcile();
			}
		}
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
			this.refreshViews();
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
			const results = await Promise.allSettled(
				aggregateChanges.map(change =>
					this.refreshAggregateTotalsAfterTaskMutation(change.before, change.after),
				),
			);
			for (const result of results) {
				if (result.status === 'rejected') {
					console.warn('Operon: failed to refresh aggregates after indexed task change', result.reason);
				}
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

		const dailyNotesConfig = await this.loadDailyNotesPluginConfig();
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
			this.refreshViewsFollowupRequested = false;
			this.refreshViewsPendingRequestCount = 0;
			this.refreshViewsPendingPerfContext = null;
			this.refreshViewsPendingMarkdownScope = null;
			this.renderViews(shouldScheduleFollowup, perfContext, markdownScope);
		});
	}

	private renderViews(
		scheduleFollowup = true,
		perfContext: RefreshViewsPerfContext | null = null,
		markdownScope: MarkdownRefreshScope = createGlobalMarkdownRefreshScope('refresh', 'render-default'),
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
					this.refreshCalendarLeaves(perfContext?.trace ?? null);
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
					leaf.view.render();
				}
			})
		);
	}

	private registerFileWatchers(): void {
		// File content changed → incremental reindex
		this.registerEvent(
			this.app.vault.on('modify', (file: TAbstractFile) => {
				if (!(file instanceof TFile) || file.extension !== 'md') return;
				if (this.shouldSuppressInternalTaskWrite(file.path)) return;
				if (this.workflowNormalizationInProgress.has(file.path)) return;
				void this.normalizeWorkflowStateAfterRawEdit(file.path);
			})
		);

		// New file created → scan it
		this.registerEvent(
			this.app.vault.on('create', (file: TAbstractFile) => {
				if (file instanceof TFile && file.extension === 'md') {
					invalidateCustomFieldValueCandidateCache(this.app);
					invalidateLocationPlaceIndex(this.app);
					this.indexer.scheduleReindex(file.path);
				}
			})
		);

		// File deleted → remove from index
		this.registerEvent(
				this.app.vault.on('delete', (file: TAbstractFile) => {
					if (file instanceof TFile && file.extension === 'md') {
						invalidateCustomFieldValueCandidateCache(this.app);
						invalidateLocationPlaceIndex(this.app);
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
				this.indexer.handleFileRename(oldPath, file.path);

				// Reindex must wait for Obsidian's metadataCache to update — it's async.
				const onCacheChanged = this.app.metadataCache.on('changed', async (changedFile: TFile) => {
					if (changedFile.path !== file.path) return;
					this.app.metadataCache.offref(onCacheChanged);
					await this.indexer.reindexFilePath(file.path);
				});

				// Safety timeout: if cache event never fires, clean up
				setWindowTimeout(() => {
					this.app.metadataCache.offref(onCacheChanged);
				}, 5000);
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
		const candidates = this.indexer.getAllTasks().filter(task => {
			if (!this.pinnedCache!.isPinned(task.operonId)) return false;
			return shouldAutoUnpinTerminalTask(task, this.settings.pipelines);
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
		this.internalTaskWriteSuppressUntilByPath.set(filePath, Date.now() + 1000);
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
		if (this.workflowNormalizationInProgress.has(filePath)) return;

		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile) || file.extension !== 'md') return;
		if (isOperonExcludedPath(file.path, this.settings)) {
			this.indexer.scheduleReindex(file.path);
			return;
		}

		this.workflowNormalizationInProgress.add(filePath);
		try {
			const rawContent = await this.app.vault.cachedRead(file);
			const resolvedContent = this.resolveOperonIdPlaceholdersInContent(rawContent, {
				resolveRawDateTime: true,
			});
			if (resolvedContent !== rawContent) {
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
		} finally {
			this.indexer.scheduleReindex(filePath);
			getActiveWindow().setTimeout(() => this.workflowNormalizationInProgress.delete(filePath), 0);
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
	): Promise<boolean> {
		const childTask = this.indexer.getTask(request.childOperonId);
		if (!childTask) return false;

		const plannedWrites: Array<{
			beforeTask: IndexedTask;
			nextEstimate: string;
		}> = [];
		const touchedPaths = new Set<string>();

		for (const step of request.steps) {
			const ancestorTask = this.indexer.getTask(step.operonId);
			if (!ancestorTask) return false;

			if (step.subtractSeconds <= 0) continue;

			const currentOwnEstimate = Math.max(0, parseInt(ancestorTask.fieldValues['estimate'] ?? '0', 10) || 0);
			if (currentOwnEstimate < step.subtractSeconds) return false;

			plannedWrites.push({
				beforeTask: ancestorTask,
				nextEstimate: currentOwnEstimate > step.subtractSeconds
					? String(currentOwnEstimate - step.subtractSeconds)
					: '',
			});
			touchedPaths.add(ancestorTask.primary.filePath);
		}

		for (const write of plannedWrites) {
			await this.writer.writeTaskFields(write.beforeTask.operonId, {
				estimate: write.nextEstimate,
			}, { reindex: 'none' });
		}

		for (const filePath of touchedPaths) {
			await this.indexer.reindexFilePath(filePath);
		}

		for (const write of plannedWrites) {
			const afterTask = this.indexer.getTask(write.beforeTask.operonId) ?? null;
			await this.refreshAggregateTotalsAfterTaskMutation(write.beforeTask, afterTask);
		}

		return true;
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

	private async applyPipelineRenameMigration(preview: PipelineRenamePreview): Promise<PipelineRenameExecutionResult> {
		const progressModal = preview.totalTaskCount > 0
			? new FieldRenameProgressModal(this.app, this.createFieldRenameProgressSnapshot(preview))
			: null;
		progressModal?.open();

		let result: PipelineRenameExecutionResult;
		try {
			result = await executePipelineRenamePreview(preview, {
				writer: this.writer,
				indexer: this.indexer,
				onProgress: snapshot => {
					progressModal?.update(snapshot);
				},
			});
		} catch (error) {
			progressModal?.markFatalError('Rename migration stopped with an unexpected error. You can close this window.');
			throw error;
		}

		if (preview.totalTaskCount === 0) {
			return result;
		}

		const updatedTotal = result.updatedFileTaskCount + result.updatedInlineTaskCount;
		const failedTotal = result.failedFileTaskCount + result.failedInlineTaskCount;
		if (failedTotal > 0) {
			new Notice(t('notifications', 'pipelineRenameMigrationNoticeFailed', {
				fileTasks: String(result.updatedFileTaskCount),
				inlineTasks: String(result.updatedInlineTaskCount),
				failedFileTasks: String(result.failedFileTaskCount),
				failedInlineTasks: String(result.failedInlineTaskCount),
			}));
		} else {
			new Notice(t('notifications', 'pipelineRenameMigrationNoticeSuccess', {
				fileTasks: String(result.updatedFileTaskCount),
				inlineTasks: String(result.updatedInlineTaskCount),
			}));
		}
		console.debug(
			'Operon: pipeline rename migration finished',
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
		);
	}

	private getFileTaskTemplateOptionsForPicker(): FileTaskTemplateOption[] {
		return orderFileTaskTemplateOptionsByLastUsed(
			this.getFileTaskTemplateOptions(),
			this.settings.lastUsedFileTaskTemplateId,
		);
	}

	private getAvailableTaskCreatorDefaultFileTemplateId(): string {
		return findFileTaskTemplateOptionById(
			this.getFileTaskTemplateOptions(),
			this.settings.taskCreatorDefaultFileTemplateId,
		)?.id ?? '';
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
		if (!option || option.kind === 'builtin-empty' || !option.path) {
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
		await delayWithActiveWindow(500);
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
		const resolvedContent = this.resolveOperonTemplatePlaceholdersInContent(renderedContent, templateContext);
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

		await this.indexer.reindexFilePath(child.primary.filePath);
		await this.refreshAggregateTotalsAfterTaskMutation(
			beforeTask,
			this.indexer.getTask(childId) ?? null,
			{ modifiedTimestamp: timestamp },
		);
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
			onCreated?: (created: CreatedCalendarFileTask, draft: TaskCreatorDraft) => void | Promise<void>;
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
				targetFolderOverride: this.resolveTaskCreatorFileTargetFolderOverride(preservedDraft),
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
		excludedFilePath?: string | null;
	} = {}): Promise<TaskCreatorInlineTargetResolution> {
		const targetDateKey = options.targetDateKey?.trim() || localToday();
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
			dailyDateHeading: targetDateKey,
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

	private formatInlineTaskDailyDateHeading(dateKey: string): string {
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
					this.formatInlineTaskDailyDateHeading(dailyDateHeading),
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
		});
	}

	private async createInlineTaskFromCreatorDraftResult(
		draft: TaskCreatorDraft,
		options: TaskCreatorInlineCreationOptions = {},
	): Promise<QuickInlineTaskCreationResult | null> {
		const creation = await this.insertTaskCreatorInlineTaskWithResolvedTarget(draft, {
			targetDateKey: options.targetDateKey,
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

	private async convertNoteToFileTask(file: TFile, document: ParsedFrontmatterDocument): Promise<void> {
		const confirmed = await this.promptConfirmAction(
			t('modals', 'convertCurrentNoteTitle'),
			t('modals', 'convertCurrentNoteMessage'),
			t('modals', 'convertWithTemplate'),
			t('buttons', 'cancel'),
		);
		if (!confirmed) return;

		this.openFileTaskTemplatePicker((selectedTemplate) => {
			void this.finishNoteToFileTaskConversion(file, document, selectedTemplate).catch((error) => {
				console.error('Operon: failed to convert current note to a file task', error);
				new Notice(t('notifications', 'noteToFileTaskFailed'));
			});
		});
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
		const resolvedContent = this.resolveOperonTemplatePlaceholdersInContent(renderedContent, templateContext, {
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
	): Promise<void> {
		const folder = this.getTargetFileTaskFolder(file);

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
					this.resolveOperonTemplatePlaceholdersInContent(renderedContent, templateContext),
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
			? insertInlineTaskUnderHeading(content, this.formatInlineTaskDailyDateHeading(dailyDateHeading), normalizedTaskBlock)
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

		await this.convertNoteToFileTask(file, document);
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
		const pendingRepeatOverride = repeatTemporalScope.scope === 'thisAndFollowingTasks' && pendingRepeatSeriesId && pendingRepeatSnapshot
			? buildFollowingOverride(pendingRepeatSnapshot, localNow())
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
				this.markInternalTaskWrite(file.path);
				await this.app.vault.modify(file, nextContent);
			} else {
				const updated = await this.replaceInlineTaskById(
					freshTask.primary.filePath,
					freshTask.operonId,
					normalizedTaskLine,
					freshTask.primary.lineNumber,
				);
				if (!updated) return false;
			}

				await this.indexer.reindexFilePath(freshTask.primary.filePath, { notify: false });
				const afterTask = this.indexer.getTask(freshTask.operonId);
				await this.syncDependencyPayloadChanges(freshTask, payload, 'replace');
				const modifiedTimestamp = (payload['datetimeModified'] ?? afterTask?.fieldValues['datetimeModified'] ?? '').trim();
			if (modifiedTimestamp) {
				await this.writer.touchTaskAncestorsModified(freshTask, afterTask ?? null, modifiedTimestamp);
			}
			let recurrenceResult: RecurrenceMaterializationResult | null = null;
			if (afterTask) {
				await this.syncRepeatSeriesEntryIfNeeded(afterTask);
				await this.applyInlineRepeatCompletionModeIfRequested(afterTask, request.inlineCompletionMode);
				if (pendingRepeatOverride) {
					await this.storage.repeatSeries.upsertFollowingOverride(pendingRepeatSeriesId, pendingRepeatOverride, localNow());
				}
				recurrenceResult = await this.maybeCreateRecurringOccurrence(task, afterTask, localNow());
			}
			await this.refreshAggregateTotalsAfterTaskMutation(
				task,
				this.resolveAfterTaskForRecurrenceMaterialization(afterTask ?? null, recurrenceResult),
				{ autoUnpinCandidate: afterTask ?? null },
			);
			await this.reconcileProjectSerialsForIndexMutation();
			this.refreshViews();
			return true;
		}

		const file = this.app.vault.getAbstractFileByPath(freshTask.primary.filePath);
		if (!(file instanceof TFile)) return false;

		// YAML saves are full-state replacements for Operon-managed fields:
		// omitted keys should be removed, while unknown user frontmatter is preserved.
		await this.writer.writeTaskFields(freshTask.operonId, payload, { mode: 'replace', reindex: 'none' });

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
				await delayWithActiveWindow(500);
				await this.indexer.reindexFilePath(indexedPath);
				return false;
			}
		}

		// Delay reindex to let Obsidian's metadata cache update after processFrontMatter.
		await delayWithActiveWindow(500);
			await this.indexer.reindexFilePath(indexedPath, { notify: false });
			const afterTask = this.indexer.getTask(freshTask.operonId);
			await this.syncDependencyPayloadChanges(freshTask, payload, 'replace');
			let recurrenceResult: RecurrenceMaterializationResult | null = null;
		if (afterTask) {
			await this.syncRepeatSeriesEntryIfNeeded(afterTask);
			await this.applyInlineRepeatCompletionModeIfRequested(afterTask, request.inlineCompletionMode);
			if (pendingRepeatOverride) {
				await this.storage.repeatSeries.upsertFollowingOverride(pendingRepeatSeriesId, pendingRepeatOverride, localNow());
			}
			recurrenceResult = await this.maybeCreateRecurringOccurrence(task, afterTask, localNow());
		}
		await this.refreshAggregateTotalsAfterTaskMutation(
			task,
			this.resolveAfterTaskForRecurrenceMaterialization(afterTask ?? null, recurrenceResult),
			{ autoUnpinCandidate: afterTask ?? null },
		);
		await this.reconcileProjectSerialsForIndexMutation();
		this.refreshViews();
		return true;
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
	): Promise<void> {
		await this.aggregateCoordinator.refreshAfterTaskMutation(beforeTask, afterTask, options);
		this.fileTaskArchiver?.scheduleForIndexedChange(beforeTask, afterTask);
		await this.tryAutoUnpinTerminalTaskIfNeeded(options.autoUnpinCandidate ?? afterTask);
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
		await this.reconcileProjectSerialsForIndexMutation();
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
		await delayWithActiveWindow(500);
		await this.indexer.reindexFilePath(nextPath, { notify: false });
		const afterTask = this.indexer.getTask(task.operonId);
		if (!afterTask || afterTask.description.trim() !== nextDescription) return false;
		await this.refreshAggregateTotalsAfterTaskMutation(task, afterTask ?? null, {
			modifiedTimestamp: datetimeModified,
			autoUnpinCandidate: afterTask ?? null,
		});
		await this.reconcileProjectSerialsForIndexMutation();
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

	private scheduleSettingsReindex(): void {
		if (this.settingsReindexTimer) {
			clearWindowTimeout(this.settingsReindexTimer);
		}
		this.settingsReindexTimer = setWindowTimeout(() => {
			this.settingsReindexTimer = null;
			runAsyncAction('settings reindex failed', async () => {
				await this.indexer.fullReindex();
				new Notice(t('notifications', 'indexRebuilt', { count: String(this.indexer.taskCount) }));
			});
		}, 600);
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

	private async runTaskStatsBackfill(options: { force: boolean; source: 'startup' | 'command' }): Promise<void> {
		const result = await this.taskStatsBackfillRunner.run({ force: options.force });
		if (result.skipped) return;
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
			id: 'reload-settings-from-storage',
			name: t('commands', 'reloadSettingsFromStorage'),
			callback: () => {
				runAsyncAction('reload settings from storage command failed', () => this.reloadCanonicalSettingsFromStorage('manual'));
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
