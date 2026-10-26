import type { LightboxOpeningTrace } from './lightbox-opening-perf';
import { mergeTaskEditorSource, taskEditorChangedKeys, type TaskEditorSourceIntent, type TaskEditorSourceSnapshot, type TaskEditorSourceState } from './task-editor-source-sync';
import type { TaskMarkdownSource } from '../core/task-markdown-source';
import { bindEditorInteractionState } from './editor-interaction-state';
import { bindDescendantFocusVisible } from './descendant-focus-visible';
import { getNativePropertyIndex } from '../indexer/native-property-index';
import { nativeEditorPropertyTypes, nativePropertyReadOnlyReason, type NativePropertyReadOnlyReason } from '../core/task-editor-native-properties';
import { encodeVaultPropertyValue, type VaultPropertyValue } from '../core/vault-property-codec';
import { resolveInlinePropertyDefinition, type InlinePropertyType } from '../core/inline-property-definitions';
import { type InlinePropertyChange, type InlinePropertySnapshot } from '../core/inline-property-source';
import { normalizeTaskEditorSections, type TaskEditorSectionId } from '../types/task-editor-sections';
import { taskEditorSectionDefaultLabel } from './task-editor-section-label';
import { buildTaskWikilinkOverlayLink } from './task-wikilink-overlay-insertion';
import { bindAssigneeChipImage } from './assignee-chip-image';
import { normalizeTaskCardSettings } from '../types/task-card';
/**
 * TaskEditorContent — shared render/state logic for the task editor.
 * Mounted into any HTMLElement container (Modal, ItemView, etc.).
 *
 * Spec Section 4.2.
 */

import { type FileTaskPropertyChange } from '../core/file-task-property-draft';
import { encodeFilePropertyColumnKey, isEmptyFilePropertyValue, isSupportedRawYamlPropertyValue, rawYamlPropertyExpectationsEqual, type RawYamlPropertyExpectation, type RawYamlPropertyValue } from '../core/raw-yaml-property';
import { createVaultFilePropertySnapshot, createCachedTableFilePropertyTypeResolver, getTableFilePropertyTypeIcon, type TableFilePropertyField } from './table/table-file-property';
import { bindPropertyReadOnlyWarning, propertyReadOnlyWarningText } from './property-readonly-warning';
import { openTableFilePropertyPicker } from './table/table-file-property-editor';
import { showSearchableFieldPicker } from './field-pickers/searchable-field-picker';
import { App, Setting, Notice, getIcon, setIcon, stringifyYaml, TFile, Platform } from 'obsidian';
import { OperonIndexer } from '../indexer/indexer';
import { PinnedCache } from '../storage/pinned-cache';

import { IndexedTask, ParsedTask, OperonField } from '../types/fields';
import type { ProjectSerialDisplay } from '../core/project-serials';
import { getFallbackStateIcon, OperonSettings, type KeyMapping } from '../types/settings';
import { generateOperonId, generateRepeatSeriesId, isValidOperonId } from '../core/id-generator';
import {
	resolveAutomationWorkflowStatus,
	resolveReverseWorkflowFromTerminalDate,
	resolveWorkflowStatus,
	shouldTriggerOneShotAutomation,
} from '../types/pipeline';
import { serializeTask } from '../core/serializer';
import {
	getManagedTaskFieldType,
	isManagedTaskFieldCanonicalKey,
} from '../core/managed-task-fields';
import {
	projectCompactTaskTextForEditing,
	projectCompactTaskTextSingleLineBreakInsertion,
} from '../core/compact-task-text';
import { applyFieldRules } from '../core/field-rules';
import { deriveCountModeRepeatEndFromFieldValues } from '../core/task-field-patch';
import { t } from '../core/i18n';
import { formatTaskNotice } from '../core/task-notice';
import { localNow, localToday } from '../core/local-time';
import {
	resolveBlockedByAggregateVisualState,
	resolveBlockedByVisualStateColor,
	resolveBlockedByVisualStateForId,
} from '../core/blocked-by-visual-state';
import { parseRepeatRule } from '../core/repeat-rule';
import { REMINDER_RULE_ANCHORS } from '../core/reminder-rules';
import { applyReminderListMutation } from '../core/reminder-list-mutation';
import { formatRepeatRuleSummaryI18n } from '../core/repeat-rule-i18n';
import { getAvailableReminderRuleAnchors } from './field-pickers/reminder-picker-model';
import { formatUiTaskDatetime, formatUiTime } from '../core/ui-time-format';
import { formatUiDate } from '../core/ui-date-format';
import { getAppLocale } from '../core/obsidian-app';
import { formatShortLocationCoordinate, parseLocationCoordinate } from '../core/location-coordinates';
import { getLocationPlaceIndex } from '../core/location-source-resolver';
import { TimeTracker, type TimeTrackerEvent } from '../systems/time-tracker';
import { bindOperonHoverTooltip, closeBoundOperonHoverTooltip, cleanupOperonHoverTooltips } from './operon-hover-tooltip';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import {
	formatDurationHuman,
	parseLocalDatetime,
} from '../systems/tracker-utils';
import {
	buildManualEstimateReallocationProposal,
	EstimateReallocationPreviewRow,
	ManualEstimateReallocationProposal,
} from '../systems/estimate-reallocation';
import { TrackerSession } from '../types/tracker';
import {
	closeFloatingPanelsForRoot,
	TASK_EDITOR_MOBILE_PICKER_CLOSE_EVENT,
	TASK_EDITOR_MOBILE_PICKER_OPEN_EVENT,
	positionFloatingElement,
	resolveSurfaceFloatingHostOptions,
} from './field-pickers/common';
import { showDatePicker } from './field-pickers/date-picker';
import { showDatetimePicker } from './field-pickers/datetime-picker';
import { showIconPicker } from './field-pickers/icon-picker';
import { showPriorityPicker } from './field-pickers/priority-picker';
import { showRepeatPicker } from './field-pickers/repeat-picker';
import { showRepeatSkipPicker } from './field-pickers/repeat-skip-picker';
import { showStatusPicker } from './field-pickers/status-picker';
import { showEstimatePicker } from './field-pickers/estimate-picker';
import { showColorPicker } from './field-pickers/color-picker';
import {
	ConfirmActionComparisonRow,
	ConfirmActionComparisonTable,
	ConfirmActionModal,
} from './confirm-action-modal';
import {
	buildTrackerSessionEditContext,
	TrackerSessionEditModal,
	type TrackerSessionTaskNoteOptions,
} from './tracker-session-edit-modal';
import { formatTrackerDayHeader } from './tracker-time-labels';
import {
	createCompactMarkdownEditorSurface,
	type CompactMarkdownEditorSurface,
} from './compact-markdown-editor-surface';
import type { CompactEditorKeyIntent } from './compact-editor-key-intent';
import { showTagPicker } from './field-pickers/tag-picker';
import { showContextsPicker } from './field-pickers/contexts-picker';
import { showAssigneesPicker } from './field-pickers/assignees-picker';
import { showParentTaskPicker } from './field-pickers/parent-task-picker';
import { showSubtasksPicker } from './field-pickers/subtasks-picker';
import { showDependencyTaskPicker } from './field-pickers/dependency-task-picker';
import { showLinksPicker } from './field-pickers/links-picker';
import { showLocationPicker } from './field-pickers/location-picker';
import { showRelatedPicker } from './field-pickers/related-picker';
import { formatExternalLinkDisplay } from './field-pickers/links-utils';
import { splitTaskListValue } from '../core/task-field-patch';
import { parseTaskMediaReferenceList, serializeTaskMediaReferenceList } from '../core/task-media-reference';
import { splitFrontmatterDocument } from '../core/file-task-template-merge';
import { formatContextDisplay } from './field-pickers/contexts-picker';
import { getConfiguredKeyMappingIcon } from '../core/key-mapping-icons';
import { getVisiblePropertyName } from '../core/yaml-fields';
import { resolveTaskEditorProgressFromStats } from '../core/task-stats-read-model';
import { resolveSubtaskActionIconForKind, resolveSubtaskActionLabelKeyForKind } from '../core/subtask-action';
import { createInlineTaskCompactChipElement } from './compact-task-layout';
import { normalizeTaskEditorWorkflowPickers, INLINE_TASK_COMPACT_FALLBACK_ICONS, InlineTaskCompactChipKey, TASK_CREATOR_FALLBACK_FIELD_ICONS, TaskEditorWorkflowPickerItem } from '../types/settings';
import { openTaskFieldPicker } from './task-field-picker-dispatch';
import { CANONICAL_KEY_MAP } from '../types/keys';
import { getManagedTaskDataFieldPicker, type ManagedTaskDataFieldPicker } from './task-data-field-picker';
import { formatReminderDisplayItem } from './reminder-display';
import type { ReminderPickerFieldKey } from '../core/reminder-list-mutation';
import { showPlainCheckboxPopover } from './plain-checkbox-popover';
import {
	getNativePropertyIcon,
	getCheckboxPropertyIcon,
	getCheckboxPropertyTypeIcon,
	getCustomFieldIcon,
	getCustomFieldLabel,
	getCustomFieldMapping,
	isProjectedCustomFieldType,
	normalizeCustomFieldRawValue,
} from './custom-field-surfaces';
import {
	WindowTimeoutHandle,
	clearWindowTimeout,
	delayWithActiveWindow,
	getActiveWindow,
	getOwnerWindow,
	setWindowTimeout,
} from '../core/dom-compat';
import { asyncHandler, runAsyncAction } from '../core/async-action';
import {
	DEFAULT_INLINE_REPEAT_COMPLETION_MODE,
	InlineRepeatCompletionMode,
	normalizeInlineCompletionMode,
} from '../storage/repeat-series-store';

/** Callback to persist editor state. Returning false/null aborts the save; a commit returns authoritative saved state. */
export interface TaskEditorSaveRequest {
 sourceSync?: TaskEditorSourceIntent;
 markdownSource?: TaskMarkdownSource;
 inlineProperties?: InlinePropertyChange[];
 inlineSourceFields?: readonly OperonField[];
 fileProperties?: FileTaskPropertyChange[];
	taskLine: string;
	isNew: boolean;
	/** Distinguishes a deliberate clear from an omitted serialized field. */
	parentTaskIntent?: 'unchanged' | 'explicitly-set' | 'explicitly-cleared';
	/** Distinguishes a deliberate scheduled-date clear from an omitted field. */
	dateScheduledIntent?: 'unchanged' | 'explicitly-set' | 'explicitly-cleared';
	inlineCompletionMode: InlineRepeatCompletionMode;
	fileBody: {
		filePath: string;
		content: string;
		expectedContent?: string;
		dirty: boolean;
		format: 'yaml' | 'inline';
		targetLine: number | null;
	} | null;
}

export interface TaskEditorCanonicalState {
	/** Fresh source fields, separate from the managed index projection. */
	sourceFields?: readonly OperonField[];
	description: string;
	checkbox: ParsedTask['checkbox'];
	tags: string[];
	fieldValues: Record<string, string>;
}

/** Rebuilds editor fields using the same managed-field admission as the parser. */
export function buildTaskEditorOperonField(
	key: string,
	value: string,
	keyMappings: readonly KeyMapping[],
	existingField?: Pick<OperonField, 'sourceKey' | 'sourceValue' | 'sourceToken'>,
): OperonField {
	return {
		sourceKey: existingField?.sourceKey || key,
		sourceValue: existingField?.sourceValue,
		sourceToken: existingField?.sourceToken,
		key,
		value,
		rawValue: value,
		type: getManagedTaskFieldType(key, keyMappings) ?? 'text',
		isCanonical: isManagedTaskFieldCanonicalKey(key, keyMappings),
		containerRange: { from: 0, to: 0 },
		valueRange: { from: 0, to: 0 },
	};
}

export interface TaskEditorSaveCommit {
 inlineProperties?: readonly InlinePropertySnapshot[];
 fileProperties?: FileTaskPropertyChange[];
 filePropertySnapshots?: { propertyName: string; expectation: RawYamlPropertyExpectation }[];
	fileBody?: TaskEditorFileBodyContext;
	canonicalState: TaskEditorCanonicalState;
}

export type TaskEditorSaveCallbackResult = boolean | null | void | TaskEditorSaveCommit;

export type OnSaveCallback = (
	request: TaskEditorSaveRequest,
) => TaskEditorSaveCallbackResult | Promise<TaskEditorSaveCallbackResult>;

export const TASK_EDITOR_ESCAPE_INTENT_EVENT = 'operon-editor-escape-intent';
export const TASK_EDITOR_CLOSE_REQUEST_EVENT = 'operon-editor-close';

export type TaskEditorSaveFailureReason =
	| 'description-required'
	| 'terminal-conflict'
	| 'workflow-resolution-failed'
	| 'write-rejected'
	| 'write-threw'
	| 'edit-raced';

export type TaskEditorSaveOutcome =
	| {
		ok: true;
		status: 'saved' | 'no-change';
		clean: boolean;
	}
	| {
		ok: false;
		reason: TaskEditorSaveFailureReason;
	};

export interface TaskEditorCloseRequestDetail {
	mode?: 'save' | 'force-after-delete';
}

export function scheduleTaskEditorReminderFocus(options: {
	ownerWindow: Window;
	fieldKey: ReminderPickerFieldKey;
	focusIndex: number;
	getWorkflowRows: () => HTMLElement | null;
	getActionButton: () => HTMLButtonElement | undefined;
	shouldFocus?: () => boolean;
}): void {
	options.ownerWindow.requestAnimationFrame(() => {
		if (options.shouldFocus && !options.shouldFocus()) return;
		const chip = options.focusIndex >= 0
			? Array.from(
				options.getWorkflowRows()?.querySelectorAll<HTMLElement>('.operon-editor-reminder-chip') ?? [],
			).find(candidate => (
				candidate.dataset.fieldKey === options.fieldKey
				&& candidate.dataset.reminderIndex === String(options.focusIndex)
			))
			: undefined;
		const target = chip?.isConnected ? chip : options.getActionButton();
		if (target?.isConnected) target.focus({ preventScroll: true });
	});
}

export interface TaskEditorSubtaskRequest {
 acceptFile?: (file: import('obsidian').TFile) => boolean;
	requestedKind?: 'inline';
	canCommit?: () => boolean;
	parentOperonId: string;
	parentDescription: string;
	parentFieldValues: Record<string, string>;
	parentTags: string[];
	onBeforeCreate?: () => boolean | Promise<boolean>;
	onCreated?: (createdOperonId: string) => void | Promise<void>;
}

export interface TaskEditorContentOptions {
 openingTrace?: LightboxOpeningTrace;
 readSource?: (operonId: string) => Promise<TaskEditorSourceSnapshot>;
	onSetHideScrollbars?: (hidden: boolean) => Promise<void>;
	focusDescriptionOnMount?: boolean;
 canFocusInitialDescription?: () => boolean;
	selectDescriptionOnMount?: boolean;
	subtaskActionKind?: 'inline' | 'file';
	onRequestSubtask?: (context: TaskEditorSubtaskRequest) => void | Promise<void>;
	onRequestDelete?: (task: ParsedTask, expectedDirectChildCount: number) => void | Promise<boolean | void>;
	getDeleteDirectChildCount?: (task: ParsedTask) => number;
	onOpenSubtasksStats?: (operonId: string, anchor: HTMLElement) => (() => void) | null;
	onUpdateExistingSubtaskParent?: (childId: string, parentId: string | null) => void | Promise<void>;
	getRepeatSkipDates?: (repeatSeriesId: string) => string[];
	onUpdateRepeatSkips?: (request: TaskEditorRepeatSkipUpdateRequest) => Promise<TaskEditorRepeatSkipUpdateResult> | TaskEditorRepeatSkipUpdateResult;
	getRepeatSeriesInlineCompletionMode?: (repeatSeriesId: string) => InlineRepeatCompletionMode;
	onApplyEstimateReallocation?: (
		request: TaskEditorEstimateReallocationRequest,
	) => Promise<TaskEditorEstimateReallocationApplyResult>;
	pinnedCache?: PinnedCache;
	fileBody?: TaskEditorFileBodyContext | null;
	getProjectSerialDisplay?: (operonId: string) => ProjectSerialDisplay | null;
}

export interface TaskEditorFileBodyContext {
	filePath: string;
	initialContent: string;
	format: 'yaml' | 'inline';
	targetLine: number | null;
	cursorOffset: number | null;
	lineNumberOffset: number;
}

export interface TaskEditorEstimateReallocationRequest {
	childOperonId: string;
	deltaSeconds: number;
	childEstimateBeforeSeconds: number;
	childEstimateAfterSeconds: number;
	appliedSeconds: number;
	uncoveredSeconds: number;
	steps: Array<{
		operonId: string;
		subtractSeconds: number;
		estimateBeforeSeconds: number;
		estimateAfterSeconds: number;
	}>;
}

export interface TaskEditorEstimateReallocationApplyResult {
	complete: boolean;
	committedSubtractSeconds: number;
}

export interface TaskEditorRepeatSkipUpdateRequest {
	operonId: string;
	repeatSeriesId: string;
	skipDates: string[];
}

export interface TaskEditorRepeatSkipUpdateResult {
	skipDates: string[];
	datetimeRepeatEnd?: string;
}

type PersistReason = 'autosave' | 'explicit-save' | 'estimate-reallocation' | 'close-save';
type TaskEditorWorkflowSyncResult =
	| { ok: true }
	| { ok: false; reason: 'terminal-conflict' | 'workflow-resolution-failed' };

const TASK_EDITOR_DAY_PICKER_DATE_KEYS = new Set<string>([
	'dateStarted',
	'dateScheduled',
	'dateDue',
	'dateCompleted',
	'dateCancelled',
]);

export const TASK_EDITOR_AUTOSAVE_DELAY_MS = 2_000;

type EditorProgressSectionState = {
	hasSubtasks: boolean;
	done: number;
	total: number;
	progressPct: number;
	hasPlainCheckboxes: boolean;
	checkboxDone: number;
	checkboxTotal: number;
	checkboxProgressPct: number;
	ownDuration: number;
	subtaskDuration: number;
	trackedSubtaskCount: number;
	totalDuration: number;
	ownEstimate: number;
	subtaskEstimate: number;
	estimatedSubtaskCount: number;
	totalEstimate: number;
	hasAnyTimeData: boolean;
};

interface TaskEditorSemanticSnapshot {
	description: string;
	checkbox: 'open' | 'done' | 'cancelled';
	tags: string[];
	fieldValues: Record<string, string>;
	inlineCompletionMode: InlineRepeatCompletionMode;
}

function formatTaskEditorDatetime(app: App, settings: OperonSettings, value: string): string {
	return formatUiTaskDatetime(app, settings, value);
}

function normalizeListValues(values: string[]): string[] {
	return Array.from(new Set(values.map(value => value.trim()).filter(Boolean)));
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
	if (left.length !== right.length) return false;
	for (let index = 0; index < left.length; index += 1) {
		if (left[index] !== right[index]) return false;
	}
	return true;
}

function hasMatchingRecordEntry(
	left: Record<string, string>,
	right: Record<string, string>,
	key: string,
): boolean {
	const leftHasKey = left[key] !== undefined;
	const rightHasKey = right[key] !== undefined;
	return leftHasKey === rightHasKey && (!leftHasKey || left[key] === right[key]);
}

function mergeCanonicalFieldValuesIntoDraft(
	current: Record<string, string>,
	submitted: Record<string, string>,
	canonical: Record<string, string>,
): Record<string, string> {
	const merged = { ...current };
	const committedKeys = new Set([...Object.keys(submitted), ...Object.keys(canonical)]);
	for (const key of committedKeys) {
		if (!hasMatchingRecordEntry(current, submitted, key)) continue;
		if (Object.prototype.hasOwnProperty.call(canonical, key)) {
			merged[key] = canonical[key];
		} else {
			delete merged[key];
		}
	}
	return merged;
}

function isTaskEditorSaveCommit(value: TaskEditorSaveCallbackResult): value is TaskEditorSaveCommit {
	if (!value || typeof value !== 'object') return false;
	const state = value.canonicalState;
	return !!state
		&& typeof state === 'object'
		&& typeof state.description === 'string'
		&& (state.checkbox === 'open' || state.checkbox === 'done' || state.checkbox === 'cancelled')
		&& Array.isArray(state.tags)
		&& state.tags.every(tag => typeof tag === 'string')
		&& !!state.fieldValues
		&& typeof state.fieldValues === 'object'
		&& !Array.isArray(state.fieldValues)
		&& Object.values(state.fieldValues).every(fieldValue => typeof fieldValue === 'string');
}

export const TASK_EDITOR_DESKTOP_GROUPS = [
	{ key: 'overview', fields: ['taskType', 'taskIcon', 'taskColor', 'status', 'priority', 'taskImage', 'taskGallery'] },
	{ key: 'planning', fields: ['dateStarted', 'dateDue', 'repeat', 'reminderDatetimes', 'reminderRules'] },
	{ key: 'activity', fields: ['assignees', 'location', 'dateScheduled', 'datetimeStart', 'estimate', 'datetimeEnd', 'dateCompleted', 'dateCancelled'] },
	{ key: 'connections', fields: ['contexts', 'tags', 'links', 'parentTask', 'subtasks', 'blockedBy', 'blocking'] },
] as const;

const DESKTOP_CORE_FIELDS = new Set([
	'taskIcon', 'taskColor', 'status', 'priority', 'dateStarted', 'dateDue', 'repeat',
	'dateScheduled', 'datetimeStart', 'estimate', 'datetimeEnd', 'dateCompleted', 'dateCancelled',
]);

type EditorFieldDisplay = Pick<KeyMapping, 'canonicalKey' | 'visiblePropertyName' | 'type' | 'icon'>;
type EditorFileProperty = { field: TableFilePropertyField; baseline: RawYamlPropertyExpectation | null; value: unknown; inline?: InlinePropertySnapshot; readonly?: boolean; readOnlyReason?: NativePropertyReadOnlyReason; headerSelected?: boolean; pending?: boolean };

export class TaskEditorContent {
 private readonly openingTrace?: LightboxOpeningTrace;

	private app: App;
	private indexer: OperonIndexer;

	private settings: OperonSettings;
	private onSave: OnSaveCallback;
	private timeTracker: TimeTracker;

	/** The task being edited (null for new task) */
	existingTask: ParsedTask | null;
	private isNewTask: boolean;

	/** Draft field values */
	private description = '';
	private persistedDescription = '';
	private checkbox: 'open' | 'done' | 'cancelled' = 'open';
	private persistedCheckbox: 'open' | 'done' | 'cancelled' = 'open';
	fieldValues: Record<string, string> = {};
	private persistedFieldValues: Record<string, string> = {};
	private inlineCompletionMode: InlineRepeatCompletionMode = DEFAULT_INLINE_REPEAT_COMPLETION_MODE;
	private persistedInlineCompletionMode: InlineRepeatCompletionMode = DEFAULT_INLINE_REPEAT_COMPLETION_MODE;
	private estimateReallocationBaseSeconds = 0;
	private tags: string[] = [];
	private persistedTags: string[] = [];

	/** Auto-save debounce */
	private saveTimer: WindowTimeoutHandle | null = null;
	private autoSaveSuspended = false;
	private quickFinishInProgress = false;
	private refreshQuickFinishControl: (() => void) | null = null;
	private disposed = false;
	private destroyCloseSaveInFlight = false;
	private deleteInProgress = false;
	private hasBeenEdited = false;
	private focusDescriptionOnMount = true;
 private canFocusInitialDescription?: () => boolean;
	private subtaskActionKind: 'inline' | 'file' = 'inline';
	private onRequestSubtask: ((context: TaskEditorSubtaskRequest) => void | Promise<void>) | null = null;
	private onRequestDelete: ((task: ParsedTask, expectedDirectChildCount: number) => void | Promise<boolean | void>) | null = null;
	private getDeleteDirectChildCount: ((task: ParsedTask) => number) | null = null;
	private refreshStatsCounters: (() => void) | null = null;
	private closeStatsSubtasks: (() => void) | null = null;
	private onOpenSubtasksStats: TaskEditorContentOptions['onOpenSubtasksStats'] = undefined;
	private onUpdateExistingSubtaskParent: ((childId: string, parentId: string | null) => void | Promise<void>) | null = null;
	private getRepeatSkipDates: ((repeatSeriesId: string) => string[]) | null = null;
	private onUpdateRepeatSkips: ((request: TaskEditorRepeatSkipUpdateRequest) => Promise<TaskEditorRepeatSkipUpdateResult> | TaskEditorRepeatSkipUpdateResult) | null = null;
	private onApplyEstimateReallocation: ((
		request: TaskEditorEstimateReallocationRequest,
	) => Promise<TaskEditorEstimateReallocationApplyResult>) | null = null;
	private pinnedCache: PinnedCache | null = null;
	private getProjectSerialDisplay: ((operonId: string) => ProjectSerialDisplay | null) | null = null;
	private taskOperonId: string | null = null;
	private readSource: TaskEditorContentOptions['readSource'];
	private sourceRefreshGeneration = 0;
	private sourceComposing = false;
	private readonly sourceCompositionStart = (): void => { this.sourceComposing = true; };
	private readonly sourceCompositionEnd = (): void => {
		this.sourceComposing = false;
		this.sourceInteractionEnd();
	};
	private readonly sourceInteractionEnd = (): void => {
		queueMicrotask(() => { if (this.readSource) void this.refreshTaskSource(); });
	};
	private pinnedCacheUnsubscribe: (() => void) | null = null;
	private trackerUnsubscribe: (() => void) | null = null;
	private indexUpdatesUnsubscribe: (() => void) | null = null;
	private refreshCorePinControl: (() => void) | null = null;
	private onSetHideScrollbars: TaskEditorContentOptions['onSetHideScrollbars'];
	private scrollbarsSavePending = false;
	private scrollbarsObserver: MutationObserver | null = null;
	private bodyDropdowns: HTMLElement[] = [];
	private refreshCoreTrackerControl: (() => void) | null = null;
	private refreshTrackingSessionsSection: (() => void) | null = null;
	private refreshEstimateReallocationControl: (() => void) | null = null;
	private schedulingDraftRefreshers = new Set<() => void>();
	private workflowExpanded = false;
	private workflowActionsEl: HTMLElement | null = null;
	private workflowRowsEl: HTMLElement | null = null;
	private desktopPropertyRows = new Map<string, { row: HTMLElement; value: HTMLElement; core: boolean; signature: string }>();
	private desktopSubtasksExpanded = false;
	private desktopSessionsExpanded = false;
 private draftPropertiesCleanup?: () => void;
 private fileProperties = new Map<string, EditorFileProperty>();
 private nativePropertyTypes: Record<string, InlinePropertyType> = {};
 private filePropertyRows = new Map<string, { row: HTMLElement; value: HTMLElement; action: HTMLButtonElement }>();
 private filePropertyRoot: HTMLElement | null = null;
 private filePropertyActions: HTMLElement | null = null;
 private additionalPropertyAdd: HTMLButtonElement | null = null;
 private additionalPropertyKeys: readonly string[] = [];
 private filePropertyGeneration = 0;
 private filePropertyUnavailable = false;
 private filePropertyCleanup: (() => void) | null = null;
 private closeFilePropertyPicker: (() => void) | null = null;
 private closeFilePropertyAddPicker: (() => void) | null = null;
 private filePropertyTypeResolver = createCachedTableFilePropertyTypeResolver();
 private filePropertyPickerName: string | null = null;
 private filePropertyPickerValue: string | null = null;
 private propertyInteractionEpoch = 0;
 private submittedFileProperties = new Set<string>();
	private desktopSubtaskLayoutCleanup: (() => void) | null = null;
	private desktopSubtaskToggleNeedsFocus = false;
	private workflowActionButtons = new Map<string, HTMLButtonElement>();
	private workflowActionPickerClose: (() => void) | null = null;
	private workflowDraftSubtaskParentId: string | null = null;
	private workflowDraftSubtaskIds: string[] | null = null;
	private persistInFlight: Promise<TaskEditorSaveOutcome> | null = null;
	private editVersion = 0;
	private selectDescriptionOnMount = false;
	private descriptionInputEl: HTMLTextAreaElement | null = null;
	private noteInputEl: HTMLTextAreaElement | null = null;
	private descriptionCompactEditor: CompactMarkdownEditorSurface | null = null;
	private noteCompactEditor: CompactMarkdownEditorSurface | null = null;
	private descriptionCompactHostEl: HTMLElement | null = null;
	private compactTextResizeObserver: ResizeObserver | null = null;
	private noteCompactHostEl: HTMLElement | null = null;
	private initialDescriptionFocusTimers: WindowTimeoutHandle[] = [];
	private rootEl: HTMLElement | null = null;
	private initialSourceRefresh: Promise<void> = Promise.resolve();
	private initialFileProperties: Promise<void> = Promise.resolve();
	private cleanupInteractionState: (() => void) | null = null;
	private shellEl: HTMLElement | null = null;
	private mainPanelEl: HTMLElement | null = null;
	private mobileNoteWrapEl: HTMLElement | null = null;
	private mobileNoteOpen = false;
	readonly isPhone = Platform.isPhone;
	readonly isTablet = Platform.isTablet;
	readonly usesTouchDesktopLayout: boolean;
	readonly usesMobileLayout: boolean;
	private mobilePickerOpenDepth = 0;
	private mobileCoreToolbarEl: HTMLElement | null = null;
	private mobileCoreToolsEl: HTMLElement | null = null;
	private mobileCoreOverflowFrame: number | null = null;
 private mobileCoreFrameWindow: Window | null = null;
 private mobilePickerFrameWindow: Window | null = null;
 private layoutWindow: Window | null = null;
 private stopLayoutMigration: (() => void) | null = null;
	private mobilePickerCloseFrame: number | null = null;
	private mobileCoreButtonRefreshers = new Set<() => void>();
	private fileBodyContext: TaskEditorFileBodyContext | null = null;
	// Source snapshots support checkbox refresh and save acknowledgements; no body editor writes them.
	private fileBodyDraft = '';
	private persistedFileBodyDraft = '';
	private readonly checkboxSaveListenerController = new AbortController();
	private checkboxBodyRevision = 0;
	private sourceContextWide: boolean | null = null;
	private sourceContextResizeWindow: Window | null = null;
	private sourceContextResizeObserver: ResizeObserver | null = null;
	private sourceContextResizeHandler: (() => void) | null = null;
	private readonly mobileCoreScrollHandler = () => this.scheduleMobileCoreToolbarOverflowState();
	private readonly mobileResizeHandler = () => {
		if (this.mobilePickerOpenDepth > 0) return;
		this.autoSizeMobileTextareas();
		this.scheduleMobileCoreToolbarOverflowState();
	};
	private readonly mobilePickerOpenHandler = () => {
		this.mobilePickerOpenDepth += 1;
		this.clearMobilePickerCloseFrame();
		this.clearInitialDescriptionFocusTimers();
	};
	private readonly mobilePickerCloseHandler = () => {
		this.mobilePickerOpenDepth = Math.max(0, this.mobilePickerOpenDepth - 1);
		if (this.mobilePickerOpenDepth > 0) return;
		this.clearMobilePickerCloseFrame();
		this.mobilePickerFrameWindow = getOwnerWindow(this.rootEl);
		this.mobilePickerCloseFrame = this.mobilePickerFrameWindow.requestAnimationFrame(() => {
			this.mobilePickerCloseFrame = null;
			if (this.mobilePickerOpenDepth > 0) return;
			this.autoSizeMobileTextareas();
			this.scheduleMobileCoreToolbarOverflowState();
			this.scheduleMobileDescriptionRefocus();
		});
	};

	constructor(
		app: App,
		indexer: OperonIndexer,
		settings: OperonSettings,
		existingTask: ParsedTask | null,
		onSave: OnSaveCallback,
		timeTracker: TimeTracker,
		options: TaskEditorContentOptions = {},
	) {
		this.app = app;
		this.indexer = indexer;
		this.settings = settings;
		this.usesMobileLayout = this.isPhone && settings.taskEditorUseMobileLayout === true;
		this.usesTouchDesktopLayout = !this.usesMobileLayout && (this.isPhone || this.isTablet);
		this.existingTask = existingTask;
		this.isNewTask = !existingTask;
		this.openingTrace = options.openingTrace;
		this.readSource = !this.isPhone && existingTask ? options.readSource : undefined;
		this.onSave = onSave;
		this.timeTracker = timeTracker;
		this.focusDescriptionOnMount = options.focusDescriptionOnMount ?? true;
  this.canFocusInitialDescription = options.canFocusInitialDescription;
		this.selectDescriptionOnMount = options.selectDescriptionOnMount ?? this.isNewTask;
		this.subtaskActionKind = options.subtaskActionKind ?? 'inline';
		this.onRequestSubtask = options.onRequestSubtask ?? null;
		this.onRequestDelete = options.onRequestDelete ?? null;
		this.getDeleteDirectChildCount = options.getDeleteDirectChildCount ?? null;
		this.onOpenSubtasksStats = options.onOpenSubtasksStats;
		this.onSetHideScrollbars = options.onSetHideScrollbars;
		this.onUpdateExistingSubtaskParent = options.onUpdateExistingSubtaskParent ?? null;
		this.getRepeatSkipDates = options.getRepeatSkipDates ?? null;
		this.onUpdateRepeatSkips = options.onUpdateRepeatSkips ?? null;
		this.onApplyEstimateReallocation = options.onApplyEstimateReallocation ?? null;
		this.pinnedCache = options.pinnedCache ?? null;
		this.getProjectSerialDisplay = options.getProjectSerialDisplay ?? null;
		this.fileBodyContext = options.fileBody ?? null;
		this.fileBodyDraft = options.fileBody?.initialContent ?? '';
		this.persistedFileBodyDraft = this.fileBodyDraft;
		this.taskOperonId = existingTask?.operonId ?? null;

		// Load existing values
		if (existingTask) {
			this.description = existingTask.description;
			this.persistedDescription = existingTask.description;
			this.checkbox = existingTask.checkbox;
			this.persistedCheckbox = existingTask.checkbox;
			this.tags = [...existingTask.tags];
			this.persistedTags = [...existingTask.tags];
			for (const f of existingTask.fields) {
				if (f.key === 'pinned') continue;
				this.fieldValues[f.key] = f.value;
				this.persistedFieldValues[f.key] = f.value;
			}
			this.estimateReallocationBaseSeconds = Math.max(0, parseInt(this.persistedFieldValues['estimate'] ?? '0', 10) || 0);
		} else if (settings.defaultPriority) {
			// Pre-populate priority for new tasks
			this.fieldValues['priority'] = settings.defaultPriority;
		}

		const repeatSeriesId = (this.fieldValues['repeatSeriesId'] ?? '').trim();
		this.inlineCompletionMode = normalizeInlineCompletionMode(
			repeatSeriesId ? options.getRepeatSeriesInlineCompletionMode?.(repeatSeriesId) : null,
		);
		this.persistedInlineCompletionMode = this.inlineCompletionMode;
	}

	private hasFileBodyContext(): boolean {
		return this.fileBodyContext != null;
	}

	private isWideSourceContextViewport(): boolean {
		const modal = this.rootEl?.closest<HTMLElement>('.operon-task-editor-modal');
		const container = modal?.parentElement;
		if (!modal || !container || !this.rootEl) return false;
		const owner = modal.ownerDocument.defaultView ?? getActiveWindow();
		const modalStyle = owner.getComputedStyle(modal);
		const containerStyle = owner.getComputedStyle(container);
		const rootStyle = owner.getComputedStyle(this.rootEl);
		const px = (value: string): number => Number.parseFloat(value) || 0;
		const mainWidth = px(modalStyle.getPropertyValue('--operon-task-editor-main-column-width'));
		const bodyMin = px(modalStyle.getPropertyValue('--operon-task-editor-file-column-min-width'));
		const gap = px(modalStyle.getPropertyValue('--operon-task-editor-split-gap'));
		const padding = px(rootStyle.paddingLeft) + px(rootStyle.paddingRight)
			+ px(modalStyle.paddingLeft) + px(modalStyle.paddingRight);
		const borders = px(modalStyle.borderLeftWidth) + px(modalStyle.borderRightWidth);
		const available = container.clientWidth - px(containerStyle.paddingLeft) - px(containerStyle.paddingRight);
		const maxValue = modalStyle.maxWidth;
		// Preserve the established compact editor width threshold under theme constraints.
		if (maxValue !== 'none' && !maxValue.endsWith('px') && !maxValue.endsWith('%')) return false;
		const maxWidth = maxValue.endsWith('px') ? px(maxValue)
			: maxValue.endsWith('%') ? available * px(maxValue) / 100 : Infinity;
		const preferredWidth = mainWidth + gap
			+ px(modalStyle.getPropertyValue('--operon-task-editor-file-column-width'))
			+ px(modalStyle.getPropertyValue('--operon-task-editor-horizontal-padding'));
		// Use the original capacity threshold without depending on the rendered editor width.
		const expandedWidth = Math.min(owner.innerWidth * 0.94, available, maxWidth, preferredWidth);
		return mainWidth > 0 && bodyMin > 0 && expandedWidth - padding - borders - mainWidth - gap >= bodyMin;
	}

	private registerSourceContextViewportListener(): void {
		if (this.isPhone) return;
		if (!this.hasFileBodyContext()) return;
		this.unregisterSourceContextViewportListener();
		const modal = this.rootEl?.closest<HTMLElement>('.operon-task-editor-modal');
		this.sourceContextResizeWindow = this.rootEl?.ownerDocument.defaultView ?? getActiveWindow();
		this.sourceContextResizeHandler = () => {
			const wide = this.isWideSourceContextViewport();
			this.sourceContextWide = wide;
			this.updateSourceContextLayout();
		};
		this.sourceContextResizeWindow.addEventListener('resize', this.sourceContextResizeHandler);
		const Resize = (this.sourceContextResizeWindow as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
		if (modal?.parentElement && typeof Resize !== 'undefined') {
			this.sourceContextResizeObserver = new Resize(this.sourceContextResizeHandler);
			this.sourceContextResizeObserver.observe(modal.parentElement);
		}
		this.sourceContextResizeHandler();
	}

	private unregisterSourceContextViewportListener(): void {
		if (this.sourceContextResizeHandler) this.sourceContextResizeWindow?.removeEventListener('resize', this.sourceContextResizeHandler);
		this.sourceContextResizeObserver?.disconnect();
		this.sourceContextResizeObserver = null;
		this.sourceContextResizeWindow = null;
		this.sourceContextResizeHandler = null;
	}

	private updateSourceContextLayout(): void {
		if (this.isPhone || !this.shellEl) return;
		const isWide = this.sourceContextWide ?? this.isWideSourceContextViewport();
		const modal = this.rootEl?.closest('.operon-task-editor-modal');
		this.shellEl.classList.toggle('has-source-context', this.hasFileBodyContext());
		modal?.classList.toggle('operon-task-editor-modal-source-wide', isWide);
		modal?.classList.toggle('operon-task-editor-modal-has-source-context', this.hasFileBodyContext());
	}

	private getFrontmatterLineCountFromContent(content: string): number {
		const { frontmatter } = splitFrontmatterDocument(content);
		if (frontmatter == null) return 0;
		return frontmatter.split(/\r?\n/).length + 2;
	}

	private getBodyCursorOffset(body: string, targetLine: number | null): number {
		if (targetLine == null || targetLine <= 0) return 0;
		const lines = body.split('\n');
		const safeLine = Math.min(targetLine, Math.max(lines.length - 1, 0));
		let cursorOffset = 0;
		for (let index = 0; index < safeLine; index += 1) {
			cursorOffset += (lines[index] ?? '').length + 1;
		}
		return cursorOffset;
	}

	private async refreshFileBodyDraftFromSource(): Promise<void> {
		if (!this.fileBodyContext) return;
		const file = this.app.vault.getAbstractFileByPath(this.fileBodyContext.filePath);
		if (!(file instanceof TFile)) return;

		const content = await this.app.vault.cachedRead(file);
		const { body } = splitFrontmatterDocument(content);
		const lineNumberOffset = this.getFrontmatterLineCountFromContent(content);

		this.fileBodyDraft = body;
		this.persistedFileBodyDraft = body;
		this.fileBodyContext.lineNumberOffset = lineNumberOffset;

		if (this.fileBodyContext.format === 'inline') {
			const indexed = this.getCurrentIndexedTask();
			if (indexed?.primary.filePath === this.fileBodyContext.filePath) {
				const targetLine = Math.max(0, indexed.primary.lineNumber - lineNumberOffset);
				this.fileBodyContext.targetLine = targetLine;
				this.fileBodyContext.cursorOffset = this.getBodyCursorOffset(body, targetLine);
			}
		}
	}

	private clearInitialDescriptionFocusTimers(): void {
		for (const timer of this.initialDescriptionFocusTimers) {
			clearWindowTimeout(timer);
		}
		this.initialDescriptionFocusTimers = [];
	}

	private getThemeColor(): string {
		const color = (this.fieldValues['taskColor'] ?? '').trim().replace(/^#/, '');
		return /^([0-9a-fA-F]{6})$/.test(color)
			? `#${color}`
			: 'var(--interactive-accent)';
	}

	private applyThemeColor(): void {
		const color = this.getThemeColor();
		this.rootEl?.style.setProperty('--operon-task-editor-accent', color);
		this.shellEl?.style.setProperty('--operon-task-editor-accent', color);
		this.mainPanelEl?.style.setProperty('--operon-task-editor-accent', color);
	}

	private readonly touchPointerHandler = (event: PointerEvent): void => {
		if (!this.usesTouchDesktopLayout || !this.rootEl) return;
		const mode = event.pointerType === 'mouse' ? 'mouse' : 'touch';
		if (this.rootEl.dataset.editorInput === mode) return;
		this.rootEl.dataset.editorInput = mode;
		if (mode === 'touch') {
			for (const target of [this.rootEl, ...Array.from(this.rootEl.querySelectorAll<HTMLElement>('*'))]) closeBoundOperonHoverTooltip(target);
		}
	};
	private readonly touchKeyboardHandler = (event: KeyboardEvent): void => {
		if (this.usesTouchDesktopLayout && this.rootEl && ['Tab', 'Enter', ' '].includes(event.key)) this.rootEl.dataset.editorInput = 'keyboard';
	};
	private bindEditorHoverTooltip(target: HTMLElement, options: Parameters<typeof bindOperonHoverTooltip>[1]): void {
		bindOperonHoverTooltip(target, {
			...options,
			shouldOpen: () => (!this.usesTouchDesktopLayout || this.rootEl?.dataset.editorInput !== 'touch') && (options.shouldOpen?.() ?? true),
		});
	}

	private bindTaskEditorTooltip(target: HTMLElement, content: string): void {
		this.bindEditorHoverTooltip(target, {
			content,
			taskColor: () => this.getThemeColor(),
		});
	}

	private appendCanonicalIcon(target: HTMLElement, canonicalKey: string, className: string): void {
		const iconId = this.getCoreFieldIcon(canonicalKey);
		if (!iconId) return;
		const iconWrap = target.createSpan(className);
		setIcon(iconWrap, iconId);
	}

	private getCoreFieldIcon(canonicalKey: string): string {
		return getConfiguredKeyMappingIcon(canonicalKey, this.settings.keyMappings);
	}

	private setPickerButtonContent(
		button: HTMLButtonElement,
		options: {
			canonicalKey: string;
			text: string;
			isEmpty: boolean;
			showIcon?: boolean;
		},
	): void {
		button.empty();
		button.removeClass('has-weekday');
		if (options.isEmpty || options.showIcon === true) {
			const iconId = this.getCoreFieldIcon(options.canonicalKey);
			if (iconId) {
				const iconWrap = button.createSpan('operon-editor-picker-button-leading-icon');
				setIcon(iconWrap, iconId);
			}
		}
		button.createSpan({ text: options.text, cls: 'operon-editor-picker-button-text' });
	}

	private bindTruncatedTextTooltip(target: HTMLElement | null): void {
		if (!target || this.isPhone) return;
		this.bindEditorHoverTooltip(target, {
			content: target.textContent ?? '',
			taskColor: () => this.getThemeColor(),
			shouldOpen: () => target.clientWidth > 0 && target.scrollWidth > target.clientWidth + 1,
		});
	}

	private appendWeekdayHint(target: HTMLElement, value: string): void {
		target.toggleClass('has-weekday', Array.from(target.children).some(child => child.classList.contains('operon-editor-weekday')));
		if (this.usesMobileLayout || !value) return;
		const canonical = value.length === 10 ? `${value}T12:00:00`
			: value.length === 16 ? `${value}:00` : value;
		const date = parseLocalDatetime(canonical);
		if (!date) return;
		const weekday = new Intl.DateTimeFormat(getAppLocale(this.app), { weekday: 'long' }).format(date);
		target.createSpan({ cls: 'operon-editor-weekday', text: ` - ${weekday}` });
		target.addClass('has-weekday');
	}

	private focusDescriptionField(selectAll = this.selectDescriptionOnMount): boolean {
		if (this.isPhone && this.mobilePickerOpenDepth > 0) return false;
		if (this.descriptionCompactEditor) {
			if (selectAll) {
				this.descriptionCompactEditor.selectAll();
			} else {
				this.descriptionCompactEditor.focusEnd();
			}
			return true;
		}
		const input = this.descriptionInputEl;
		const root = this.rootEl;
		if (!input || !root) return false;
		if (!input.isConnected || !root.isConnected) return false;
		if (this.isPhone && root.ownerDocument.querySelector('.operon-task-editor-mobile-picker-surface')) return false;

		input.focus();
		if (input.ownerDocument.activeElement !== input) return false;
		if (selectAll) {
			input.select();
			return true;
		}

		const end = input.value.length;
		input.setSelectionRange(end, end);
		return true;
	}

	private scheduleMobileDescriptionRefocus(): void {
		if (!this.usesMobileLayout) return;
		const ownerWindow = getActiveWindow();
		ownerWindow.requestAnimationFrame(() => {
			const root = this.rootEl;
			if (!root?.isConnected) return;
			if (root.ownerDocument.querySelector('.operon-task-editor-mobile-picker-surface')) return;
			this.focusDescriptionField();
		});
	}

	public applyInitialDescriptionFocus(canFocus = this.canFocusInitialDescription): void {
		if (!(this.isNewTask || this.focusDescriptionOnMount)) return;
		this.clearInitialDescriptionFocusTimers();
  if (canFocus?.() === false) return;
		for (const delay of [0, 80, 180, 320, 520, 820]) {
			const timer = setWindowTimeout(() => {
				const timerIndex = this.initialDescriptionFocusTimers.indexOf(timer);
				if (timerIndex !== -1) this.initialDescriptionFocusTimers.splice(timerIndex, 1);
				if (canFocus?.() === false) { this.clearInitialDescriptionFocusTimers(); return; }
				if (this.focusDescriptionField()) this.clearInitialDescriptionFocusTimers();
			}, delay);
			this.initialDescriptionFocusTimers.push(timer);
		}
	}

	public focusDescription(selectAll = this.selectDescriptionOnMount): void {
		this.focusDescriptionField(selectAll);
	}

	private getCompactTextSourcePath(): string {
		return this.fileBodyContext?.filePath?.trim()
			|| this.existingTask?.filePath?.trim()
			|| '';
	}

	private destroyCompactTextEditors(): void {
		this.compactTextResizeObserver?.disconnect();
		this.compactTextResizeObserver = null;
		this.descriptionCompactEditor?.destroy();
		this.noteCompactEditor?.destroy();
		this.descriptionCompactEditor = null;
		this.noteCompactEditor = null;
		this.descriptionCompactHostEl = null;
		this.noteCompactHostEl = null;
	}

	private autoSizeCompactTextarea(textarea: HTMLTextAreaElement): void {
		const owner = textarea.ownerDocument.defaultView;
		if (!owner) return;
		const style = owner.getComputedStyle(textarea);
		const borders = (Number.parseFloat(style.borderTopWidth) || 0)
			+ (Number.parseFloat(style.borderBottomWidth) || 0);
		textarea.setCssProps({ height: '0px' });
		textarea.style.height = `${Math.ceil(textarea.scrollHeight + borders)}px`;
	}

	private observeCompactTextEditorWidths(): void {
		this.compactTextResizeObserver?.disconnect();
		const owner = this.descriptionCompactHostEl?.ownerDocument.defaultView;
		const Observer = (owner as (Window & { ResizeObserver?: typeof ResizeObserver }) | null)?.ResizeObserver;
		if (!Observer) return;
		const widths = new WeakMap<Element, number>();
		this.compactTextResizeObserver = new Observer(entries => {
			if (this.disposed) return;
			let changed = false;
			for (const entry of entries) {
				if (widths.get(entry.target) === entry.contentRect.width) continue;
				widths.set(entry.target, entry.contentRect.width);
				changed = true;
			}
			if (changed) this.refreshCompactTextEditorLayouts();
		});
		for (const host of [this.descriptionCompactHostEl, this.noteCompactHostEl]) {
			if (host) this.compactTextResizeObserver.observe(host);
		}
	}

	private refreshCompactTextEditorLayouts(): void {
		this.descriptionCompactEditor?.refreshLayout();
		this.noteCompactEditor?.refreshLayout();
		getActiveWindow().requestAnimationFrame(() => {
			if (this.disposed) return;
			this.descriptionCompactEditor?.refreshLayout();
			this.noteCompactEditor?.refreshLayout();
		});
	}

	private focusAdjacentTaskEditorControl(
		origin: HTMLElement | null,
		direction: 'next' | 'previous',
	): void {
		const root = this.rootEl;
		if (!origin || !root) return;
		const selector = [
			'button:not([disabled])',
			'input:not([disabled])',
			'textarea:not([disabled])',
			'select:not([disabled])',
			'[contenteditable="true"]',
			'.cm-content',
			'[tabindex]:not([tabindex="-1"])',
		].join(',');
		const candidates = Array.from(root.querySelectorAll<HTMLElement>(selector))
			.filter(candidate => {
				if (!candidate.isConnected) return false;
				if (candidate.closest('[hidden], .is-hidden')) return false;
				const compactRoot = candidate.closest('.operon-compact-markdown-editor');
				if (!compactRoot) return true;
				return candidate.matches('textarea, .cm-content');
			});
		const activeElement = root.ownerDocument.activeElement;
		let index = candidates.findIndex(candidate => (
			candidate === activeElement
			|| candidate.contains(activeElement)
		));
		if (index < 0) {
			index = candidates.findIndex(candidate => origin.contains(candidate));
		}
		if (index < 0) return;
		const targetIndex = direction === 'next' ? index + 1 : index - 1;
		candidates[targetIndex]?.focus();
	}

	private handleCompactTextEditorIntent(
		field: 'description' | 'note',
		intent: Exclude<CompactEditorKeyIntent, 'none'>,
	): void {
		const origin = field === 'description'
			? this.descriptionCompactHostEl
			: this.noteCompactHostEl;
		switch (intent) {
			case 'submit':
			case 'focus-next':
				this.focusAdjacentTaskEditorControl(origin, 'next');
				break;
			case 'focus-previous':
				this.focusAdjacentTaskEditorControl(origin, 'previous');
				break;
			case 'explicit-submit':
				void this.persistEditorState('explicit-save');
				break;
			case 'escape':
				this.rootEl?.dispatchEvent(new CustomEvent(TASK_EDITOR_ESCAPE_INTENT_EVENT, {
					bubbles: true,
				}));
				break;
		}
	}

	private openFileBodySource(): void {
		const filePath = this.fileBodyContext?.filePath?.trim();
		if (!filePath) return;
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (file instanceof TFile) {
			void this.app.workspace.getLeaf(false).openFile(file);
			this.requestEditorClose('save');
			return;
		}
		runAsyncAction('task editor source open failed', () => this.app.workspace.openLinkText(filePath, '', false));
		this.requestEditorClose('save');
	}

	private requestEditorClose(mode: TaskEditorCloseRequestDetail['mode'] = 'save'): void {
		this.rootEl?.dispatchEvent(new CustomEvent<TaskEditorCloseRequestDetail>(TASK_EDITOR_CLOSE_REQUEST_EVENT, {
			bubbles: true,
			detail: { mode },
		}));
	}

	private async copyCurrentTaskCardEmbed(anchor: HTMLElement): Promise<void> {
		const operonId = this.getCurrentOperonId();
		if (!operonId || !isValidOperonId(operonId) || this.indexer.hasDuplicateOperonIdConflict(operonId) || !this.indexer.getTask(operonId)) {
			new Notice(t('notifications', 'taskCardCopyUnavailable'));
			return;
		}
		try {
			const options = normalizeTaskCardSettings(this.settings);
			// Code keys and comments deliberately stay English in every UI language.
			const code = [
				'```operon', 'view: card', `taskId: ${operonId}`, `width: ${options.taskCardWidth}`,
				`align: ${options.taskCardAlign}     # left, center, right`,
				`wrap: ${options.taskCardWrap}     # true, false; false with center`,
				`image: ${options.taskCardImageSource !== 'none'}     # true, false`,
				`chips: ${options.taskCardShowChips}     # true, false`,
				`progress: ${options.taskCardShowTaskProgress || options.taskCardShowCheckboxProgress}  # true, false`,
				'```',
			].join('\n');
			await getOwnerWindow(anchor).navigator.clipboard.writeText(code);
			new Notice(t('notifications', 'taskCardEmbedCopied'));
		} catch {
			new Notice(t('notifications', 'clipboardWriteFailed'));
		}
	}

	private async copyCurrentTaskWikilink(anchor: HTMLElement): Promise<void> {
		const task = this.getCurrentIndexedTask();
		if (!task) return;
		const file = this.app.vault.getAbstractFileByPath(task.primary.filePath);
		if (!(file instanceof TFile)) return;
		const link = buildTaskWikilinkOverlayLink(task, file.basename, target => target
			.replace(/%/gu, '%25').replace(/\[/gu, '%5B').replace(/\]/gu, '%5D')
			.replace(/#/gu, '%23').replace(/\^/gu, '%5E'));
		if (!link) return;
		try {
			await getOwnerWindow(anchor).navigator.clipboard.writeText(link);
			new Notice(t('notifications', 'linkCopied'));
		} catch {
			new Notice(t('notifications', 'clipboardWriteFailed'));
		}
	}

	private async copyCurrentOperonId(): Promise<void> {
		const operonId = this.getCurrentOperonId();
		if (!operonId) return;
		try {
			await navigator.clipboard.writeText(operonId);
			new Notice(t('notifications', 'operonIdCopied'));
		} catch (error) {
			console.error('Operon: Clipboard write failed', error);
			new Notice(t('notifications', 'clipboardWriteFailed'));
		}
	}

	private desktopSectionLabel(id: TaskEditorSectionId): string {
		return this.settings.taskEditorSections?.find(section => section.id === id)?.name.trim() || taskEditorSectionDefaultLabel(id);
	}

	private renderTaskEditorBody(container: HTMLElement): void {
		const progressState = this.getProgressSectionState();
		// Title
		const titleRow = container.createDiv('operon-task-editor-title-row');
		titleRow.createDiv('operon-task-editor-title-side is-left');
		titleRow.createEl('h3', {
			text: this.isNewTask ? t('modals', 'newTask') : t('modals', 'editTask'),
			cls: 'operon-task-editor-title',
		});
		titleRow.createDiv('operon-task-editor-title-side is-right');

		const sections = container.createDiv('operon-task-editor-section-layout');
		this.workflowRowsEl = sections;
		const hosts = new Map<TaskEditorSectionId, HTMLElement>();
		for (const section of normalizeTaskEditorSections(this.settings.taskEditorSections)) {
			const host = sections.createDiv('operon-task-editor-section-host');
			host.dataset.editorSection = section.id;
			host.toggleClass('is-section-disabled', section.enabled === false);
			hosts.set(section.id, host);
		}
		// Create hosts in display/tab order, then initialize dependent controls in their existing order.
		const host = (id: TaskEditorSectionId): HTMLElement => hosts.get(id)!;
		for (const id of ['description', 'notes'] as const) {
			host(id).addClass('operon-task-editor-primary-fields');
			this.renderDescriptionNoteSection(host(id), id);
		}
		this.observeCompactTextEditorWidths();
		host('stats').addClass('operon-task-editor-primary-fields');
		this.renderTimeSummarySection(host('stats'), progressState);
		this.renderDesktopPropertyGroups(host);
		this.renderDetailsSection(host('sessions'));

		// Actions bar
		this.renderActions(container);
	}

	private renderProjectSerialControl(container: HTMLElement): void {
		const operonId = this.taskOperonId?.trim();
		if (!operonId) return;
		const display = this.getProjectSerialDisplay?.(operonId) ?? null;
		if (!display) return;
		const serial = container.createSpan('operon-task-editor-workflow-action-button operon-editor-project-serial');
		const icon = serial.createSpan({ attr: { 'aria-hidden': 'true' } });
		setIcon(icon, getConfiguredKeyMappingIcon('operonId', this.settings.keyMappings) || 'fingerprint');
		serial.createSpan({ cls: 'operon-editor-project-serial-label', text: display.label });
		this.bindTaskEditorTooltip(serial, display.label);
	}

	private renderMobileTaskEditorBody(container: HTMLElement): void {
		const body = container.createDiv('operon-task-editor-mobile-body');
		const primary = body.createDiv('operon-task-editor-mobile-primary');
		this.renderMobileDescription(primary);
		this.renderMobileNote(primary);
		this.renderMobileCoreToolbar(body);

		const workflow = body.createDiv('operon-task-editor-mobile-workflow');
		this.renderWorkflowSurface(workflow);
	}

	private renderMobileDescription(container: HTMLElement): void {
		const textarea = container.createEl('textarea', {
			cls: 'operon-editor-description-textarea operon-task-editor-mobile-description',
			attr: {
				placeholder: t('taskEditor', 'descriptionPlaceholder'),
				rows: '1',
			},
		});
		setAccessibleLabelWithoutTooltip(textarea, t('taskEditor', 'description'));
		textarea.value = this.description;
		this.descriptionInputEl = textarea;
		const resize = () => this.autoSizeMobileTextarea(textarea, 44);
		resize();
		textarea.addEventListener('input', () => {
			this.description = textarea.value;
			resize();
			this.markEdited();
			this.refreshCoreTrackerControl?.();
			this.refreshTrackingSessionsSection?.();
			this.refreshMobileCoreButtons();
		});
	}

	private renderMobileNote(container: HTMLElement): void {
		const wrap = container.createDiv('operon-task-editor-mobile-note-wrap');
		this.mobileNoteWrapEl = wrap;
		const textarea = wrap.createEl('textarea', {
			cls: 'operon-editor-note-textarea operon-task-editor-mobile-note',
			attr: {
				placeholder: t('taskEditor', 'notesPlaceholder'),
				rows: '1',
			},
		});
		setAccessibleLabelWithoutTooltip(textarea, t('taskEditor', 'notes'));
		textarea.value = this.fieldValues['note'] ?? '';
		this.noteInputEl = textarea;
		const resize = () => this.autoSizeMobileTextarea(textarea, 44);
		const applyInput = () => {
			const normalized = projectCompactTaskTextForEditing(textarea.value, 'task-note');
			if (normalized !== textarea.value) {
				textarea.value = normalized;
			}
			if (normalized.trim()) {
				this.fieldValues['note'] = normalized;
			} else {
				delete this.fieldValues['note'];
			}
			resize();
			this.markEdited();
			this.refreshMobileCoreButtons();
		};
		resize();
		textarea.addEventListener('input', applyInput);
		textarea.addEventListener('keydown', event => {
			const legacyKeyCode = (event as unknown as { keyCode?: number }).keyCode;
			if (event.isComposing || legacyKeyCode === 229) return;
			if (event.key !== 'Enter' || event.shiftKey) return;
			event.preventDefault();
			const start = textarea.selectionStart ?? textarea.value.length;
			const end = textarea.selectionEnd ?? start;
			const projected = projectCompactTaskTextSingleLineBreakInsertion(
				textarea.value,
				start,
				end,
			);
			textarea.value = projected.displayValue;
			textarea.setSelectionRange(projected.selectionOffset, projected.selectionOffset);
			applyInput();
		});
		this.updateMobileNoteVisibility();
	}

	private renderMobileCoreToolbar(container: HTMLElement): void {
		const toolbar = container.createDiv('operon-task-editor-mobile-core-toolbar');
		const tools = toolbar.createDiv('operon-task-editor-mobile-core-tools');
		this.mobileCoreToolbarEl = toolbar;
		this.mobileCoreToolsEl = tools;
		tools.addEventListener('scroll', this.mobileCoreScrollHandler, { passive: true });

		let checkboxButtonRendered = false;
		const renderCheckboxButton = () => {
			if (checkboxButtonRendered) return;
			checkboxButtonRendered = true;
			this.renderMobileCheckboxPopoverButton(tools);
		};

		for (const item of this.settings.taskEditorMobileCoreTools) {
			const renderAfterItem = item.key === 'play';
			if (!item.visible) {
				if (renderAfterItem) renderCheckboxButton();
				continue;
			}
			const customMapping = getCustomFieldMapping(this.settings.keyMappings, item.key);
			if (customMapping && isProjectedCustomFieldType(customMapping)) {
				this.renderMobileCustomFieldButton(tools, customMapping);
				if (renderAfterItem) renderCheckboxButton();
				continue;
			}
			this.renderMobileCoreTool(tools, item.key);
			if (renderAfterItem) renderCheckboxButton();
		}
		renderCheckboxButton();
	}

	private renderMobileCoreTool(container: HTMLElement, key: string): void {
		switch (key) {
			case 'goToSource':
				if (this.hasFileBodyContext()) this.renderMobileGoToSourceButton(container);
				break;
			case 'play':
				this.renderMobileTrackerButton(container);
				break;
			case 'note':
				this.renderMobileNoteButton(container);
				break;
			case 'taskIcon':
				this.renderMobileIconButton(container);
				break;
			case 'taskColor':
				this.renderMobileColorButton(container);
				break;
			case 'priority':
				this.renderMobilePriorityButton(container);
				break;
			case 'status':
				this.renderMobileStatusButton(container);
				break;
			case 'blocking':
				this.renderMobileDependencyButton(container, 'blocking');
				break;
			case 'blockedBy':
				this.renderMobileDependencyButton(container, 'blockedBy');
				break;
			case 'dateStarted':
				this.renderMobileDateButton(container, 'dateStarted', t('taskEditor', 'started'), t('taskEditor', 'startDatePlaceholder'));
				break;
			case 'dateScheduled':
				this.renderMobileDateButton(container, 'dateScheduled', t('taskEditor', 'scheduled'), t('taskEditor', 'scheduledDatePlaceholder'));
				break;
			case 'dateDue':
				this.renderMobileDateButton(container, 'dateDue', t('taskEditor', 'dueDate'), t('taskEditor', 'dueDatePlaceholder'));
				break;
			case 'datetimeStart':
				this.renderMobileDatetimeButton(container, 'datetimeStart', t('taskEditor', 'datetimeStart'));
				break;
			case 'estimate':
				this.renderMobileEstimateButton(container);
				break;
			case 'datetimeEnd':
				this.renderMobileDatetimeButton(container, 'datetimeEnd', t('taskEditor', 'datetimeEnd'));
				break;
			case 'repeat':
				this.renderMobileRepeatButton(container);
				break;
			case 'dateCompleted':
				this.renderMobileDateButton(container, 'dateCompleted', t('taskEditor', 'finished'), t('taskEditor', 'finishedDatePlaceholder'));
				break;
			case 'dateCancelled':
				this.renderMobileDateButton(container, 'dateCancelled', t('taskEditor', 'cancelled'), t('taskEditor', 'cancelledDatePlaceholder'));
				break;
			case 'remove':
				this.renderMobileRemoveButton(container);
				break;
		}
	}

	private renderMobileGoToSourceButton(container: HTMLElement): void {
		const label = t('taskEditor', 'goToSource');
		const button = this.createMobileCoreButton(container, label, 'goToSource', () => this.openFileBodySource());
		this.setMobileCoreButtonIcon(button, 'external-link');
	}

	private renderMobileTrackerButton(container: HTMLElement): void {
		const button = this.createMobileCoreButton(container, t('taskEditor', 'trackerStartButton'), 'play', () => {
			runAsyncAction('task editor tracker toggle failed', async () => {
				const currentId = this.getCurrentOperonId();
				if (currentId && this.timeTracker.isTimerRunning(currentId)) {
					await this.timeTracker.stop('manual');
					this.syncTrackingFieldsFromIndex();
					this.refreshMobileCoreButtons();
					return;
				}

				const operonId = await this.ensureTaskReadyForTracking();
				if (!operonId) return;
				const started = await this.timeTracker.start(operonId, 'editor');
				if (!started) return;
				this.syncWorkflowFieldsFromIndex();
				this.syncTrackingFieldsFromIndex();
				this.refreshMobileCoreButtons();
			});
		});

		const refresh = () => {
			const operonId = this.getCurrentOperonId();
			const isRunning = !!operonId && this.timeTracker.isTimerRunning(operonId);
			const canStart = !!this.description.trim();
			const label = isRunning ? t('taskEditor', 'trackerStopButton') : t('taskEditor', 'trackerStartButton');
			this.setMobileCoreButtonIcon(button, isRunning ? 'square' : 'play');
			this.setMobileCoreButtonState(button, isRunning, isRunning ? 'var(--color-red)' : null);
			button.disabled = !isRunning && !canStart;
			button.classList.toggle('is-running', isRunning);
			this.setMobileCoreButtonLabel(button, label);
		};
		this.refreshCoreTrackerControl = refresh;
		this.mobileCoreButtonRefreshers.add(refresh);
		refresh();
	}

	private renderMobileNoteButton(container: HTMLElement): void {
		const button = this.createMobileCoreButton(container, t('taskEditor', 'notes'), 'note', () => {
			this.setMobileNoteOpen(true, true);
			this.refreshMobileCoreButtons();
		});
		const refresh = () => {
			this.setMobileCoreButtonIcon(button, this.getCoreFieldIcon('note'));
			this.setMobileCoreButtonState(button, this.mobileNoteOpen || !!(this.fieldValues['note'] ?? '').trim());
		};
		this.mobileCoreButtonRefreshers.add(refresh);
		refresh();
	}

	private renderMobileIconButton(container: HTMLElement): void {
		const button = this.createMobileCoreButton(container, t('taskEditor', 'taskIcon'), 'taskIcon', () => {
			button.addClass('is-picker-open');
			showIconPicker(button, {
				value: this.fieldValues['taskIcon'],
				query: '',
				onSelect: iconId => {
					this.fieldValues['taskIcon'] = iconId;
					this.markEdited();
					this.refreshMobileCoreButtons();
				},
				onClear: () => {
					delete this.fieldValues['taskIcon'];
					this.markEdited();
					this.refreshMobileCoreButtons();
				},
				onClose: () => {
					button.removeClass('is-picker-open');
				},
			});
		});
		const refresh = () => {
			const value = (this.fieldValues['taskIcon'] ?? '').trim();
			this.setMobileCoreButtonIcon(button, value || this.getCoreFieldIcon('taskIcon'));
			this.setMobileCoreButtonState(button, !!value);
		};
		this.mobileCoreButtonRefreshers.add(refresh);
		refresh();
	}

	private renderMobileColorButton(container: HTMLElement): void {
		const button = this.createMobileCoreButton(container, t('taskEditor', 'taskColor'), 'taskColor', () => {
			button.addClass('is-picker-open');
			showColorPicker(button, {
				value: this.fieldValues['taskColor'],
				palette: this.settings.colorPalette,
				onSelect: value => {
					button.removeClass('is-picker-open');
					this.fieldValues['taskColor'] = value;
					this.applyThemeColor();
					this.markEdited();
					this.refreshMobileCoreButtons();
				},
				onClear: () => {
					button.removeClass('is-picker-open');
					delete this.fieldValues['taskColor'];
					this.applyThemeColor();
					this.markEdited();
					this.refreshMobileCoreButtons();
				},
				onClose: () => {
					button.removeClass('is-picker-open');
				},
			});
		});

		const refresh = () => {
			const hex = this.getTaskColorHex();
			button.empty();
			if (hex) {
				const dot = button.createSpan('operon-task-editor-mobile-color-dot');
				dot.style.background = hex;
			} else {
				this.setMobileCoreButtonIcon(button, this.getCoreFieldIcon('taskColor'));
			}
			this.setMobileCoreButtonState(button, !!hex, hex || null);
		};
		button.addEventListener('contextmenu', event => {
			event.preventDefault();
			delete this.fieldValues['taskColor'];
			this.applyThemeColor();
			this.markEdited();
			this.refreshMobileCoreButtons();
		});
		this.mobileCoreButtonRefreshers.add(refresh);
		refresh();
	}

	private renderMobilePriorityButton(container: HTMLElement): void {
		const button = this.createMobileCoreButton(container, t('taskEditor', 'priority'), 'priority', () => {
			button.addClass('is-picker-open');
			showPriorityPicker(button, {
				priorities: this.settings.priorities,
				value: this.fieldValues['priority'],
				onSelect: value => {
					if (value) this.fieldValues['priority'] = value;
					else delete this.fieldValues['priority'];
					this.markEdited();
					this.refreshMobileCoreButtons();
				},
				onClear: () => {
					delete this.fieldValues['priority'];
					this.markEdited();
					this.refreshMobileCoreButtons();
				},
				onClose: () => {
					button.removeClass('is-picker-open');
				},
			});
		});
		const refresh = () => {
			const value = (this.fieldValues['priority'] ?? '').trim();
			this.setMobileCoreButtonIcon(button, this.getCoreFieldIcon('priority'));
			this.setMobileCoreButtonState(button, !!value, this.getPriorityColor(value));
			this.setMobileCoreButtonLabel(button, value ? `${t('taskEditor', 'priority')}: ${value}` : t('taskEditor', 'priority'));
		};
		this.mobileCoreButtonRefreshers.add(refresh);
		refresh();
	}

	private renderMobileStatusButton(container: HTMLElement): void {
		const button = this.createMobileCoreButton(container, t('taskEditor', 'status'), 'status', () => {
			const resetPickerState = () => {
				button.removeClass('is-picker-open');
			};
			button.addClass('is-picker-open');
			showStatusPicker(button, {
				pipelines: this.settings.pipelines,
				value: this.fieldValues['status'],
				onSelect: value => {
					if (!this.applyStatusDraftChange(value)) return;
					resetPickerState();
					this.markEdited();
				},
				onClear: () => {
					delete this.fieldValues['status'];
					resetPickerState();
					this.markEdited();
					this.refreshMobileCoreButtons();
				},
				onClose: resetPickerState,
			});
		});
		const refresh = () => {
			const value = (this.fieldValues['status'] ?? '').trim();
			this.setMobileCoreButtonIcon(button, this.getCoreFieldIcon('status'));
			this.setMobileCoreButtonState(button, !!value, this.getStatusColor(value));
			this.setMobileCoreButtonLabel(button, value ? `${t('taskEditor', 'status')}: ${value}` : t('taskEditor', 'status'));
		};
		this.mobileCoreButtonRefreshers.add(refresh);
		refresh();
	}

	private renderMobileDependencyButton(container: HTMLElement, fieldKey: 'blocking' | 'blockedBy'): void {
		const label = t('taskEditor', fieldKey);
		const button = this.createMobileCoreButton(container, label, fieldKey, () => {
			const currentTaskId = this.fieldValues['operonId'] ?? this.existingTask?.operonId ?? '';
			const oppositeFieldKey = fieldKey === 'blocking' ? 'blockedBy' : 'blocking';
			let selectedIds = normalizeListValues(
				splitTaskListValue(this.fieldValues[fieldKey]).filter(id => id !== currentTaskId),
			);
			button.addClass('is-picker-open');
			showDependencyTaskPicker(button, {
				fieldKey,
				value: selectedIds.join('; '),
				oppositeValue: this.fieldValues[oppositeFieldKey] ?? '',
				allTasks: this.indexer.getAllTasks(),
				getAllTasks: () => this.indexer.getAllTasks(),
				subscribeIndexUpdates: listener => this.indexer.subscribeIndexUpdates(listener),
				pipelines: this.settings.pipelines,
				keyMappings: this.settings.keyMappings,
				excludedIds: currentTaskId ? [currentTaskId] : [],
				closeOnSelect: this.shouldCloseWorkflowPickerOnSelect(),
				onSave: (payload) => {
					const nextIds = normalizeListValues(splitTaskListValue(payload[fieldKey]).filter(id => id !== currentTaskId));
					const nextValue = (payload[fieldKey] ?? '').trim();
					const nextOppositeValue = (payload[oppositeFieldKey] ?? '').trim();
					if (areStringArraysEqual(selectedIds, nextIds)
						&& nextValue === (this.fieldValues[fieldKey] ?? '').trim()
						&& nextOppositeValue === (this.fieldValues[oppositeFieldKey] ?? '').trim()) {
						return;
					}
					selectedIds = nextIds;
					this.setDelimitedFieldValue(fieldKey, nextIds);
					if (nextOppositeValue) this.fieldValues[oppositeFieldKey] = nextOppositeValue;
					else delete this.fieldValues[oppositeFieldKey];
					this.markEdited();
					this.refreshMobileCoreButtons();
				},
				onClose: () => {
					button.removeClass('is-picker-open');
				},
			});
		});
		const refresh = () => {
			const currentTaskId = this.fieldValues['operonId'] ?? this.existingTask?.operonId ?? '';
			const selectedIds = normalizeListValues(
				splitTaskListValue(this.fieldValues[fieldKey]).filter(id => id !== currentTaskId),
			);
			this.setMobileCoreButtonIcon(button, this.resolveTaskSelectionIcon(fieldKey));
			const state = fieldKey === 'blockedBy'
				? resolveBlockedByAggregateVisualState(selectedIds, id => this.indexer.getTask(id), this.settings.pipelines)
				: null;
			this.setMobileCoreButtonState(
				button,
				selectedIds.length > 0,
				fieldKey === 'blockedBy' ? resolveBlockedByVisualStateColor(state) : null,
			);
			this.setMobileCoreButtonLabel(button, selectedIds.length > 0 ? `${label}: ${selectedIds.length}` : label);
		};
		this.mobileCoreButtonRefreshers.add(refresh);
		refresh();
	}

	private renderMobileDateButton(container: HTMLElement, key: string, label: string, placeholderText = label): void {
		const button = this.createMobileCoreButton(container, label, key, () => {
			button.addClass('is-picker-open');
			showDatePicker(button, {
				app: this.app,
				fieldKey: key,
				value: this.fieldValues[key],
				dateDisplayFormat: this.settings.dateDisplayFormat,
				manualDatePicker: this.getManualDatePickerOptions(key),
				canRemove: !!this.fieldValues[key],
				onSelect: value => {
					if (!this.applyDateDraftChange(key, value)) return;
					this.markEdited();
				},
				onRemove: () => {
					if (!this.applyDateDraftChange(key, '')) return;
					this.markEdited();
				},
				onClose: () => {
					button.removeClass('is-picker-open');
				},
			});
		});
		const refresh = () => {
			const value = (this.fieldValues[key] ?? '').trim();
			this.setMobileCoreButtonIcon(button, this.getCoreFieldIcon(key));
			this.setMobileCoreButtonState(button, !!value || (key === 'dateCompleted' && this.checkbox === 'done') || (key === 'dateCancelled' && this.checkbox === 'cancelled'), this.getMobileDateTone(key, value));
			this.setMobileCoreButtonLabel(button, value ? `${label}: ${formatUiDate(value, this.settings)}` : placeholderText);
		};
		this.registerSchedulingDraftRefresher(refresh);
		this.mobileCoreButtonRefreshers.add(refresh);
		refresh();
	}

	private renderMobileDatetimeButton(container: HTMLElement, key: 'datetimeStart' | 'datetimeEnd', label: string): void {
		const button = this.createMobileCoreButton(container, label, key, () => {
			if (key === 'datetimeEnd' && !(this.fieldValues['datetimeStart'] ?? '').trim()) {
				new Notice(t('taskEditor', 'datetimeEndRequiresStart'));
				return;
			}
			button.addClass('is-picker-open');
			showDatetimePicker(button, {
				app: this.app,
				settings: {
					timeFormat: this.settings.timeFormat,
					calendarWeekStart: this.settings.calendarWeekStart,
					calendarSidebarShowWeekNumbers: this.settings.calendarSidebarShowWeekNumbers,
				},
				dateDisplayFormat: this.settings.dateDisplayFormat,
				fieldKey: key,
				value: this.fieldValues[key],
				initialDate: key === 'datetimeStart' ? this.fieldValues['dateScheduled'] : undefined,
				canRemove: !!this.fieldValues[key],
				onSelect: value => {
					this.applyDraftFieldRules({ [key]: value }, [key]);
					this.markEdited();
					this.refreshMobileCoreButtons();
				},
				onRemove: () => {
					this.applyDraftFieldRules({ [key]: '' }, [key]);
					this.markEdited();
					this.refreshMobileCoreButtons();
				},
				onClose: () => {
					button.removeClass('is-picker-open');
				},
			});
		});
		const refresh = () => {
			const value = (this.fieldValues[key] ?? '').trim();
			const hasStart = !!(this.fieldValues['datetimeStart'] ?? '').trim();
			button.disabled = key === 'datetimeEnd' && !hasStart;
			this.setMobileCoreButtonIcon(button, this.getCoreFieldIcon(key));
			this.setMobileCoreButtonState(button, !!value);
			this.setMobileCoreButtonLabel(button, value ? `${label}: ${formatTaskEditorDatetime(this.app, this.settings, value)}` : label);
		};
		this.registerSchedulingDraftRefresher(refresh);
		this.mobileCoreButtonRefreshers.add(refresh);
		refresh();
	}

	private renderMobileEstimateButton(container: HTMLElement): void {
		const button = this.createMobileCoreButton(container, t('taskEditor', 'estimateMinutesShort'), 'estimate', () => {
			button.addClass('is-picker-open');
			showEstimatePicker(button, {
				value: this.fieldValues['estimate'],
				canRemove: !!(this.fieldValues['estimate'] ?? '').trim(),
				onSelect: value => {
					this.applyDraftFieldRules({ estimate: value }, ['estimate'], { refreshEstimateReallocation: true });
					this.markEdited();
					this.refreshMobileCoreButtons();
				},
				onRemove: () => {
					this.applyDraftFieldRules({ estimate: '' }, ['estimate'], { refreshEstimateReallocation: true });
					this.markEdited();
					this.refreshMobileCoreButtons();
				},
				onClose: () => {
					button.removeClass('is-picker-open');
				},
			});
		});
		const refresh = () => {
			const seconds = Number.parseInt(this.fieldValues['estimate'] ?? '0', 10);
			const hasValue = Number.isFinite(seconds) && seconds > 0;
			this.setMobileCoreButtonIcon(button, this.getCoreFieldIcon('estimate'));
			this.setMobileCoreButtonState(button, hasValue);
			this.setMobileCoreButtonLabel(button, hasValue ? t('taskEditor', 'estimateChip', { duration: formatDurationHuman(seconds) }) : t('taskEditor', 'estimateMinutesShort'));
		};
		this.registerSchedulingDraftRefresher(refresh);
		this.mobileCoreButtonRefreshers.add(refresh);
		refresh();
	}

	private renderMobileRepeatButton(container: HTMLElement): void {
		const button = this.createMobileCoreButton(container, t('taskEditor', 'repeat'), 'repeat', event => {
			event.preventDefault();
			event.stopPropagation();
			button.addClass('is-picker-open');
			showRepeatPicker(button, {
				value: this.fieldValues['repeat'],
				repeatEnd: this.fieldValues['datetimeRepeatEnd'],
				repeatSeriesId: this.fieldValues['repeatSeriesId'],
				taskColor: this.fieldValues['taskColor'],
				repeatOccurrenceDate: this.fieldValues['repeatOccurrenceDate'],
				dateScheduled: this.fieldValues['dateScheduled'],
				dateDue: this.fieldValues['dateDue'],
				dateStarted: this.fieldValues['dateStarted'],
				datetimeStart: this.fieldValues['datetimeStart'],
				datetimeEnd: this.fieldValues['datetimeEnd'],
				taskFormat: this.fileBodyContext?.format ?? 'inline',
				inlineCompletionMode: this.inlineCompletionMode,
				dayPickerPopover: this.getRepeatDayPickerPopoverOptions(),
				onSave: ({ repeat, datetimeRepeatEnd, repeatOccurrenceDate, inlineCompletionMode }) => {
					this.fieldValues['repeat'] = repeat;
					if (datetimeRepeatEnd) this.fieldValues['datetimeRepeatEnd'] = datetimeRepeatEnd;
					else delete this.fieldValues['datetimeRepeatEnd'];
					if (repeatOccurrenceDate) {
						this.fieldValues['repeatOccurrenceDate'] = repeatOccurrenceDate;
					}
					if (parseRepeatRule(repeat) && !this.fieldValues['repeatSeriesId']) {
						this.fieldValues['repeatSeriesId'] = generateRepeatSeriesId();
					}
					this.inlineCompletionMode = inlineCompletionMode;
					this.syncDerivedRepeatFieldsFromDraft();
					this.markEdited();
					this.refreshMobileCoreButtons();
					this.refreshSchedulingDraftControls();
				},
				onClear: () => {
					delete this.fieldValues['repeat'];
					delete this.fieldValues['datetimeRepeatEnd'];
					delete this.fieldValues['repeatSeriesId'];
					delete this.fieldValues['repeatOccurrenceDate'];
					this.inlineCompletionMode = DEFAULT_INLINE_REPEAT_COMPLETION_MODE;
					this.markEdited();
					this.refreshMobileCoreButtons();
					this.refreshSchedulingDraftControls();
				},
				onClose: () => {
					button.removeClass('is-picker-open');
				},
			});
		});
		const refresh = () => {
			const value = (this.fieldValues['repeat'] ?? '').trim();
			this.setMobileCoreButtonIcon(button, this.getCoreFieldIcon('repeat'));
			this.setMobileCoreButtonState(button, !!value);
			this.setMobileCoreButtonLabel(button, value ? `${t('taskEditor', 'repeat')}: ${value}` : t('taskEditor', 'repeat'));
		};
		this.mobileCoreButtonRefreshers.add(refresh);
		refresh();
	}

	private renderMobileRemoveButton(container: HTMLElement): void {
		if (!this.existingTask || !this.onRequestDelete) return;
		const button = this.createMobileCoreButton(container, t('buttons', 'remove'), 'remove', () => {
			void this.handleRemoveTaskClick();
		});
		button.addClass('is-danger');
		this.setMobileCoreButtonIcon(button, 'trash-2');
		this.setMobileCoreButtonState(button, true, 'var(--color-red)');
	}

	private renderMobileCustomFieldButton(container: HTMLElement, mapping: KeyMapping): void {
		const label = getCustomFieldLabel(mapping);
		const button = this.createMobileCoreButton(container, label, mapping.canonicalKey, () => {
			button.addClass('is-picker-open');
			const close = openTaskFieldPicker({
				app: this.app,
				settings: this.settings,
				allTasks: this.indexer.getAllTasks(),
				canonicalKey: mapping.canonicalKey,
				anchor: button,
				currentFieldValues: { ...this.fieldValues },
				currentTags: [...this.tags],
				sourcePath: this.existingTask?.filePath ?? this.fileBodyContext?.filePath ?? '',
				closeListPickerOnSelect: this.shouldCloseWorkflowPickerOnSelect(),
				taskFormat: this.fileBodyContext?.format ?? 'inline',
				repeatInlineCompletionMode: this.inlineCompletionMode,
				onCommit: payload => {
					this.applyTaskFieldPickerPayload(payload);
					this.markEdited();
					this.refreshMobileCoreButtons();
				},
				onRepeatInlineCompletionModeChange: mode => {
					this.inlineCompletionMode = normalizeInlineCompletionMode(mode);
				},
				onClose: () => {
					button.removeClass('is-picker-open');
				},
				onCancel: () => {
					button.removeClass('is-picker-open');
				},
			});
			if (!close) button.removeClass('is-picker-open');
		});
		const refresh = () => {
			const value = normalizeCustomFieldRawValue((this.fieldValues as Record<string, unknown>)[mapping.canonicalKey]);
			this.setMobileCoreButtonIcon(button, getCustomFieldIcon(mapping));
			this.setMobileCoreButtonState(button, !!value);
			this.setMobileCoreButtonLabel(button, value ? `${label}: ${this.formatCustomFieldDisplayValue(mapping, value)}` : label);
		};
		this.mobileCoreButtonRefreshers.add(refresh);
		refresh();
	}

	private renderMobileCheckboxPopoverButton(container: HTMLElement): void {
		const label = t('taskEditor', 'showCheckboxes');
		const button = this.createMobileCoreButton(container, label, 'plainCheckboxes', event => {
			const anchor = event.currentTarget as HTMLElement;
			runAsyncAction('task editor checkbox popover open failed', async () => {
				await this.openTaskEditorCheckboxPopover(anchor);
			});
		});
		this.setMobileCoreButtonIcon(button, 'layout-list');
	}

	private createMobileCoreButton(
		container: HTMLElement,
		label: string,
		key: string,
		onClick: (event: MouseEvent) => void,
	): HTMLButtonElement {
		const button = container.createEl('button', {
			cls: 'operon-task-editor-mobile-core-button',
			attr: {
				type: 'button',
				'data-core-key': key,
			},
		});
		this.setMobileCoreButtonLabel(button, label);
		button.addEventListener('click', event => {
			event.preventDefault();
			onClick(event);
		});
		return button;
	}

	private setMobileCoreButtonLabel(button: HTMLButtonElement, label: string): void {
		setAccessibleLabelWithoutTooltip(button, label, button.parentElement ?? undefined);
	}

	private setMobileCoreButtonIcon(button: HTMLButtonElement, iconId: string): void {
		button.empty();
		if (iconId) {
			setIcon(button, iconId);
			return;
		}
		button.createSpan('operon-task-editor-mobile-core-icon-placeholder');
	}

	private setMobileCoreButtonState(button: HTMLButtonElement, active: boolean, color: string | null = null): void {
		button.classList.toggle('is-active', active);
		button.setAttr('aria-pressed', String(active));
		if (color) {
			button.style.setProperty('--operon-task-editor-mobile-tool-color', color);
		} else {
			button.style.removeProperty('--operon-task-editor-mobile-tool-color');
		}
	}

	private getTaskColorHex(): string | null {
		const value = (this.fieldValues['taskColor'] ?? '').trim().replace(/^#/, '');
		if (!/^([0-9a-fA-F]{6})$/.test(value)) return null;
		return `#${value}`;
	}

	private getPriorityColor(value: string): string | null {
		if (!value) return null;
		return this.settings.priorities.find(priority => priority.label === value)?.color ?? null;
	}

	private getStatusColor(value: string): string | null {
		if (!value) return null;
		return resolveWorkflowStatus(this.settings.pipelines, value)?.definition.color ?? null;
	}

	private getMobileDateTone(key: string, value: string): string | null {
		if (key === 'dateCompleted') return value || this.checkbox === 'done' ? 'var(--color-green)' : null;
		if (key === 'dateCancelled') return value || this.checkbox === 'cancelled' ? 'var(--color-red)' : null;
		if (key !== 'dateDue' && key !== 'dateScheduled') return null;
		if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
		const today = localToday();
		if (value < today) return 'var(--color-red)';
		if (value === today) return 'var(--color-blue)';
		return null;
	}

	private autoSizeMobileTextarea(textarea: HTMLTextAreaElement, minHeightPx: number): void {
		const style = getOwnerWindow(textarea).getComputedStyle(textarea);
		const fontSize = Number.parseFloat(style.fontSize) || 15;
		const lineHeight = Number.parseFloat(style.lineHeight) || fontSize * 1.35;
		const verticalChrome = [
			style.paddingTop,
			style.paddingBottom,
			style.borderTopWidth,
			style.borderBottomWidth,
		].reduce((total, value) => total + (Number.parseFloat(value) || 0), 0);
		const maxHeight = Math.ceil(verticalChrome + (lineHeight * 4));
		const minHeight = Math.min(maxHeight, Math.max(minHeightPx, Math.ceil(verticalChrome + lineHeight)));
		textarea.setCssProps({ height: '0px' });
		const nextHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight);
		textarea.style.height = `${Math.ceil(nextHeight)}px`;
	}

	private autoSizeMobileTextareas(): void {
		if (!this.isPhone) return;
		if (!this.usesMobileLayout) {
			this.refreshCompactTextEditorLayouts();
			return;
		}
		if (this.descriptionInputEl) {
			this.autoSizeMobileTextarea(this.descriptionInputEl, 44);
		}
		if (this.noteInputEl) {
			this.autoSizeMobileTextarea(this.noteInputEl, 44);
		}
	}

	private updateMobileNoteVisibility(): void {
		const wrap = this.mobileNoteWrapEl;
		if (!wrap) return;
		const hasNote = !!(this.fieldValues['note'] ?? '').trim();
		wrap.toggleClass('is-hidden', !this.mobileNoteOpen && !hasNote);
	}

	private setMobileNoteOpen(open: boolean, focus = false): void {
		this.mobileNoteOpen = open;
		this.updateMobileNoteVisibility();
		if (!open) return;
		if (this.noteInputEl) {
			this.autoSizeMobileTextarea(this.noteInputEl, 44);
		}
		if (!focus) return;
		getActiveWindow().requestAnimationFrame(() => {
			const input = this.noteInputEl;
			if (!input || !input.isConnected) return;
			input.focus();
			const end = input.value.length;
			input.setSelectionRange(end, end);
		});
	}

	private refreshMobileCoreButtons(): void {
		this.refreshQuickFinishControl?.();
		for (const refresh of this.mobileCoreButtonRefreshers) {
			refresh();
		}
	}

	private scheduleMobileCoreToolbarOverflowState(): void {
		if (!this.isPhone || !this.mobileCoreToolbarEl || !this.mobileCoreToolsEl) return;
		if (this.mobileCoreOverflowFrame != null) return;
		this.mobileCoreFrameWindow = getOwnerWindow(this.rootEl);
		this.mobileCoreOverflowFrame = this.mobileCoreFrameWindow.requestAnimationFrame(() => {
			this.mobileCoreOverflowFrame = null;
			this.updateMobileCoreToolbarOverflowState();
		});
	}

	private updateMobileCoreToolbarOverflowState(): void {
		const toolbar = this.mobileCoreToolbarEl;
		const tools = this.mobileCoreToolsEl;
		if (!toolbar || !tools || !toolbar.isConnected || !tools.isConnected) return;
		const maxScrollLeft = Math.max(0, tools.scrollWidth - tools.clientWidth);
		const scrollLeft = Math.max(0, tools.scrollLeft);
		const isScrollable = maxScrollLeft > 1;
		toolbar.toggleClass('is-scrollable-left', isScrollable && scrollLeft > 1);
		toolbar.toggleClass('is-scrollable-right', isScrollable && scrollLeft < maxScrollLeft - 1);
	}

	private clearMobileCoreToolbarState(): void {
		this.mobileCoreToolsEl?.removeEventListener('scroll', this.mobileCoreScrollHandler);
		if (this.mobileCoreOverflowFrame != null) {
			this.mobileCoreFrameWindow?.cancelAnimationFrame(this.mobileCoreOverflowFrame);
			this.mobileCoreOverflowFrame = null;
		}
		this.mobileCoreToolbarEl = null;
		this.mobileCoreToolsEl = null;
	}

	private clearMobilePickerCloseFrame(): void {
		if (this.mobilePickerCloseFrame == null) return;
		this.mobilePickerFrameWindow?.cancelAnimationFrame(this.mobilePickerCloseFrame);
		this.mobilePickerCloseFrame = null;
	}

	private handleTimeTrackerEvent(event: TimeTrackerEvent): void {
		if (event === 'tick') return;

		const indexed = this.getCurrentIndexedTask();
		if (indexed && this.timeTracker.isTimerRunning(indexed.operonId) && indexed.checkbox !== this.checkbox) {
			this.syncWorkflowFieldsFromIndex();
		}
		this.syncTrackingFieldsFromIndex();
		this.refreshCoreTrackerControl?.();
		this.refreshMobileCoreButtons();
		this.refreshTrackingSessionsSection?.();
	}

	/**
	 * Mount the editor UI into the given container element.
	 * Clears the container first, then renders all sections.
	 */
	mountInto(container: HTMLElement): void {
  this.draftPropertiesCleanup?.();
  this.draftPropertiesCleanup = getNativePropertyIndex(this.app).observeDraftProperties(() => [
   ...Object.keys(this.fieldValues), ...this.fileProperties.keys(),
  ]);
  const endMount = this.openingTrace?.span('editor-mount');
		this.cleanupInteractionState?.();
		this.closeStatsSubtasks?.();
		this.closeStatsSubtasks = null;
		this.refreshStatsCounters = null;
		if (this.rootEl && this.rootEl !== container) cleanupOperonHoverTooltips(this.rootEl);
		cleanupOperonHoverTooltips(container);
		this.destroyCompactTextEditors();
		container.empty();
		this.initialFileProperties = Promise.resolve();
		container.addClass('operon-task-editor');
		container.toggleClass('operon-task-editor-mobile', this.usesMobileLayout);
		container.toggleClass('operon-task-editor-phone-desktop', this.isPhone && !this.usesMobileLayout);
		container.toggleClass('operon-task-editor-touch-desktop', this.usesTouchDesktopLayout);
		if (this.usesTouchDesktopLayout) container.dataset.editorInput = 'touch';
		this.rootEl?.removeEventListener('pointerdown', this.touchPointerHandler, true);
		this.rootEl?.removeEventListener('pointermove', this.touchPointerHandler, true);
		this.rootEl?.removeEventListener('keydown', this.touchKeyboardHandler, true);
		this.rootEl?.removeEventListener(TASK_EDITOR_MOBILE_PICKER_OPEN_EVENT, this.mobilePickerOpenHandler);
		this.rootEl?.removeEventListener(TASK_EDITOR_MOBILE_PICKER_CLOSE_EVENT, this.mobilePickerCloseHandler);
		this.rootEl?.removeEventListener('compositionstart', this.sourceCompositionStart, true);
		this.rootEl?.removeEventListener('compositionend', this.sourceCompositionEnd);
		this.rootEl?.removeEventListener('focusout', this.sourceInteractionEnd);
		this.rootEl?.removeEventListener(TASK_EDITOR_MOBILE_PICKER_CLOSE_EVENT, this.sourceInteractionEnd);
		this.rootEl = container;
		if (this.readSource) {
			container.addEventListener('compositionstart', this.sourceCompositionStart, true);
			container.addEventListener('compositionend', this.sourceCompositionEnd);
			container.addEventListener('focusout', this.sourceInteractionEnd);
			container.addEventListener(TASK_EDITOR_MOBILE_PICKER_CLOSE_EVENT, this.sourceInteractionEnd);
		}
		this.cleanupInteractionState = bindEditorInteractionState(container);
		if (this.usesTouchDesktopLayout) {
			container.addEventListener('pointerdown', this.touchPointerHandler, true);
			container.addEventListener('pointermove', this.touchPointerHandler, true);
			container.addEventListener('keydown', this.touchKeyboardHandler, true);
		}
		container.addEventListener(TASK_EDITOR_MOBILE_PICKER_OPEN_EVENT, this.mobilePickerOpenHandler);
		container.addEventListener(TASK_EDITOR_MOBILE_PICKER_CLOSE_EVENT, this.mobilePickerCloseHandler);
		this.schedulingDraftRefreshers.clear();
		this.mobileCoreButtonRefreshers.clear();
		this.refreshCorePinControl = null;
		this.scrollbarsObserver?.disconnect();
		this.scrollbarsObserver = null;
		this.clearMobileCoreToolbarState();
		this.clearInitialDescriptionFocusTimers();
  this.stopLayoutMigration?.();
  this.layoutWindow?.removeEventListener('resize', this.mobileResizeHandler);
  this.layoutWindow = getOwnerWindow(container);
  if (this.isPhone) this.layoutWindow.addEventListener('resize', this.mobileResizeHandler);
  this.stopLayoutMigration = container.onWindowMigrated?.(() => {
   const next = getOwnerWindow(container);
   if (next === this.layoutWindow) return;
   const toolbarPending = this.mobileCoreOverflowFrame !== null;
   const pickerPending = this.mobilePickerCloseFrame !== null;
   this.layoutWindow?.removeEventListener('resize', this.mobileResizeHandler);
   if (this.mobileCoreOverflowFrame !== null) this.mobileCoreFrameWindow?.cancelAnimationFrame(this.mobileCoreOverflowFrame);
   this.mobileCoreOverflowFrame = null; this.clearMobilePickerCloseFrame();
   this.unregisterSourceContextViewportListener();
   this.layoutWindow = next;
   if (this.isPhone) next.addEventListener('resize', this.mobileResizeHandler);
   this.registerSourceContextViewportListener();
   if (toolbarPending) this.scheduleMobileCoreToolbarOverflowState();
   if (pickerPending) { this.autoSizeMobileTextareas(); this.scheduleMobileCoreToolbarOverflowState(); }
  }) ?? null;
		this.trackerUnsubscribe?.();
		this.trackerUnsubscribe = this.timeTracker.subscribe(event => this.handleTimeTrackerEvent(event));
		this.indexUpdatesUnsubscribe?.();
		this.indexUpdatesUnsubscribe = this.indexer.subscribeIndexUpdates(() => {
			if (this.readSource) void this.refreshTaskSource();
			this.refreshMobileCoreButtons();
			this.refreshRenderedBlockedBySelectionStates();
			this.refreshStatsCounters?.();
   void this.refreshDesktopFileProperties();
		});
		this.pinnedCacheUnsubscribe?.();
		this.pinnedCacheUnsubscribe = this.pinnedCache?.subscribe(() => {
			this.refreshCorePinControl?.();
		}) ?? null;

		this.shellEl = container.createDiv('operon-task-editor-shell');
		if (!this.isPhone && this.hasFileBodyContext()) {
			this.registerSourceContextViewportListener();
		}

		this.mainPanelEl = this.shellEl.createDiv('operon-task-editor-main-panel');
		if (this.usesMobileLayout) {
			this.mobileNoteOpen = !!(this.fieldValues['note'] ?? '').trim();
			this.renderMobileTaskEditorBody(this.mainPanelEl);
		} else {
			this.renderTaskEditorBody(this.mainPanelEl);
		}
		this.applyThemeColor();
		if (!this.isPhone) this.updateSourceContextLayout();
		if (!this.usesMobileLayout) this.refreshCompactTextEditorLayouts();
		this.scheduleMobileCoreToolbarOverflowState();
		this.initialSourceRefresh = this.readSource ? this.refreshTaskSource() : Promise.resolve();
  endMount?.();
	}

	/** Reuse the initial reads; a native host can reveal the complete editor together. */
	async whenInitialRenderReady(): Promise<void> {
		await this.initialSourceRefresh;
		let properties: Promise<void>;
		do {
			properties = this.initialFileProperties;
			await properties;
		} while (!this.disposed && properties !== this.initialFileProperties);
	}

	private taskSourceState(persisted = false): TaskEditorSourceState {
		return {
			description: persisted ? this.persistedDescription : this.description,
			checkbox: persisted ? this.persistedCheckbox : this.checkbox,
			tags: [...(persisted ? this.persistedTags : this.tags)],
			fieldValues: { ...(persisted ? this.persistedFieldValues : this.fieldValues) },
		};
	}

	private async refreshTaskSource(): Promise<void> {
		const id = this.taskOperonId;
		if (!this.readSource || !id || this.disposed || this.persistInFlight || this.sourceComposing) return;
		const generation = ++this.sourceRefreshGeneration;
		try {
			const snapshot = await this.readSource(id);
			if (this.disposed || this.persistInFlight || this.sourceComposing || generation !== this.sourceRefreshGeneration || id !== this.taskOperonId) return;
			// Picker callbacks still own their input. Re-evaluate on interaction end.
			if (this.workflowActionPickerClose || this.closeFilePropertyPicker || this.closeFilePropertyAddPicker || this.mobilePickerOpenDepth) return;
			const baseline = this.taskSourceState(true), draft = this.taskSourceState();
			const changed = taskEditorChangedKeys(baseline, draft);
			const next = mergeTaskEditorSource(snapshot.state, draft, changed);
			const path = this.getCompactTextSourcePath();
			// A compact surface may be composing even before its draft callback fires.
			if (!changed.includes('_description') && this.descriptionCompactEditor?.setSourceValue(next.description, path) === 'conflict') return;
			if (!changed.includes('note') && this.noteCompactEditor?.setSourceValue(next.fieldValues['note'] ?? '', path) === 'conflict') return;
			this.description = next.description;
			this.checkbox = next.checkbox;
			this.tags = next.tags;
			this.fieldValues = next.fieldValues;
			this.persistedDescription = snapshot.state.description;
			this.persistedCheckbox = snapshot.state.checkbox;
			this.persistedTags = [...snapshot.state.tags];
			this.persistedFieldValues = { ...snapshot.state.fieldValues };
			const previousSourcePath = this.existingTask?.filePath ?? this.fileBodyContext?.filePath;
			this.syncExistingTaskCanonicalState(snapshot.state);
			if (this.existingTask) {
				this.existingTask.filePath = snapshot.filePath;
				this.existingTask.lineNumber = snapshot.lineNumber;
			}
			if (this.fileBodyContext) {
				this.fileBodyContext.filePath = snapshot.filePath;
				this.fileBodyContext.targetLine = Math.max(0, snapshot.lineNumber - this.fileBodyContext.lineNumberOffset);
			}
			this.refreshDesktopPropertyRows();
			this.refreshSchedulingDraftControls();
			this.refreshMobileCoreButtons();
			this.refreshStatsCounters?.();
   if (previousSourcePath !== snapshot.filePath) this.rootEl?.dispatchEvent(new CustomEvent('operon-editor-source-location', { bubbles: true, detail: { operonId: this.taskOperonId, filePath: snapshot.filePath } }));
		} catch {
			// Keep the draft. The existing save path reports missing/ambiguous sources.
		}
	}

	async refreshAfterExternalSubtaskCreated(): Promise<void> {
		await this.refreshAfterExternalTaskMutation(true);
	}

	private async refreshAfterExternalTaskMutation(flushBeforeRefresh: boolean): Promise<void> {
		if (!this.mainPanelEl) return;

		if (flushBeforeRefresh) {
			const saved = await this.flushPendingEdits();
			if (!saved) return;
		}

		this.destroyCompactTextEditors();
		await this.refreshFileBodyDraftFromSource();
		this.destroyCompactTextEditors();
		this.syncTrackingFieldsFromIndex();
		this.schedulingDraftRefreshers.clear();
		this.refreshCorePinControl = null;
		this.scrollbarsObserver?.disconnect();
		this.scrollbarsObserver = null;
		this.refreshCoreTrackerControl = null;
		this.refreshEstimateReallocationControl = null;
		this.refreshTrackingSessionsSection = null;
		this.workflowActionsEl = null;
		this.workflowRowsEl = null;
		this.clearDesktopSubtaskLayout();
		this.closeFilePropertyPicker?.();
  this.closeFilePropertyAddPicker?.();
  this.filePropertyRows.clear();
  this.desktopPropertyRows.clear();
		this.workflowActionButtons.clear();
		this.closeActiveWorkflowActionPicker();
		this.workflowDraftSubtaskParentId = null;
		this.workflowDraftSubtaskIds = null;
		this.mobileCoreButtonRefreshers.clear();
		this.descriptionInputEl = null;
		this.noteInputEl = null;
		for (const el of this.bodyDropdowns) el.remove();
		this.bodyDropdowns = [];
		this.clearMobileCoreToolbarState();
		this.clearInitialDescriptionFocusTimers();

		this.closeStatsSubtasks?.();
		this.closeStatsSubtasks = null;
		this.refreshStatsCounters = null;
		cleanupOperonHoverTooltips(this.mainPanelEl);
		this.mainPanelEl.empty();
		if (this.usesMobileLayout) {
			this.renderMobileTaskEditorBody(this.mainPanelEl);
		} else {
			this.renderTaskEditorBody(this.mainPanelEl);
		}
		this.applyThemeColor();
		if (!this.isPhone) this.updateSourceContextLayout();
		if (!this.usesMobileLayout) this.refreshCompactTextEditorLayouts();
		this.scheduleMobileCoreToolbarOverflowState();
	}

	beginCloseSave(): Promise<TaskEditorSaveOutcome> {
		if (this.saveTimer) {
			clearWindowTimeout(this.saveTimer);
			this.saveTimer = null;
		}
		if (!this.description.trim()) {
			return Promise.resolve({ ok: false, reason: 'description-required' });
		}
		if (!this.hasBeenEdited && !this.persistInFlight) {
			return Promise.resolve({ ok: true, status: 'no-change', clean: true });
		}
		return this.flushPendingEditsOutcome('close-save');
	}

	async prepareCloseSave(): Promise<TaskEditorSaveOutcome> {
		if (this.isNewTask && !this.hasBeenEdited && !this.description.trim()) {
			return { ok: true, status: 'no-change', clean: true };
		}
		const outcome = await this.beginCloseSave();
		if (!outcome.ok && outcome.reason === 'description-required') {
			new Notice(t('notifications', 'taskDescriptionRequired'));
			this.focusDescriptionField();
		}
		return outcome;
	}

	/**
	 * Cleanup: clear timers. Call when the container is being torn down.
	 */
	destroy(options: { skipCloseSave?: boolean } = {}): void {
		this.sourceRefreshGeneration++;
		this.rootEl?.removeEventListener('compositionstart', this.sourceCompositionStart, true);
		this.rootEl?.removeEventListener('compositionend', this.sourceCompositionEnd);
		this.rootEl?.removeEventListener('focusout', this.sourceInteractionEnd);
		this.rootEl?.removeEventListener(TASK_EDITOR_MOBILE_PICKER_CLOSE_EVENT, this.sourceInteractionEnd);
		this.cleanupInteractionState?.();
		this.cleanupInteractionState = null;
		let closeSave: Promise<TaskEditorSaveOutcome> | null = null;
		if (!options.skipCloseSave && this.hasBeenEdited && this.description.trim()) {
			this.destroyCloseSaveInFlight = true;
			closeSave = this.beginCloseSave().finally(() => {
				this.destroyCloseSaveInFlight = false;
			});
		}
		this.closeStatsSubtasks?.();
		this.closeStatsSubtasks = null;
		this.refreshStatsCounters = null;
		if (this.rootEl) {
			closeFloatingPanelsForRoot(this.rootEl);
			cleanupOperonHoverTooltips(this.rootEl);
		}
		this.closeFilePropertyPicker?.();
  this.closeFilePropertyAddPicker?.();
  this.filePropertyCleanup?.();
  this.filePropertyCleanup = null;
  this.filePropertyRoot = null;
  this.filePropertyActions = null;
  this.additionalPropertyAdd = null;
  this.additionalPropertyKeys = [];
  this.filePropertyGeneration++;
  this.disposed = true;
  this.refreshQuickFinishControl = null;
		this.checkboxSaveListenerController.abort();
		this.stopLayoutMigration?.(); this.stopLayoutMigration = null;
  this.layoutWindow?.removeEventListener('resize', this.mobileResizeHandler);
		this.pinnedCacheUnsubscribe?.();
		this.pinnedCacheUnsubscribe = null;
		this.trackerUnsubscribe?.();
		this.trackerUnsubscribe = null;
		this.indexUpdatesUnsubscribe?.();
		this.indexUpdatesUnsubscribe = null;
		this.unregisterSourceContextViewportListener();
		this.schedulingDraftRefreshers.clear();
		this.mobileCoreButtonRefreshers.clear();
		this.refreshCorePinControl = null;
		this.scrollbarsObserver?.disconnect();
		this.scrollbarsObserver = null;
		this.refreshCoreTrackerControl = null;
		this.refreshEstimateReallocationControl = null;
		this.workflowActionsEl = null;
		this.workflowRowsEl = null;
		this.clearDesktopSubtaskLayout();
		this.closeFilePropertyPicker?.();
  this.closeFilePropertyAddPicker?.();
  this.filePropertyRows.clear();
  this.desktopPropertyRows.clear();
		this.workflowActionButtons.clear();
		this.closeActiveWorkflowActionPicker();
		this.workflowDraftSubtaskParentId = null;
		this.workflowDraftSubtaskIds = null;
		for (const el of this.bodyDropdowns) el.remove();
		this.bodyDropdowns = [];
		this.refreshTrackingSessionsSection = null;
		this.destroyCompactTextEditors();
		this.mobileNoteWrapEl = null;
		this.mobilePickerOpenDepth = 0;
		this.clearMobilePickerCloseFrame();
		this.clearMobileCoreToolbarState();
		this.mainPanelEl = null;
		this.shellEl = null;
		this.rootEl?.removeEventListener('pointerdown', this.touchPointerHandler, true);
		this.rootEl?.removeEventListener('pointermove', this.touchPointerHandler, true);
		this.rootEl?.removeEventListener('keydown', this.touchKeyboardHandler, true);
		this.rootEl?.removeEventListener(TASK_EDITOR_MOBILE_PICKER_OPEN_EVENT, this.mobilePickerOpenHandler);
		this.rootEl?.removeEventListener(TASK_EDITOR_MOBILE_PICKER_CLOSE_EVENT, this.mobilePickerCloseHandler);
		this.rootEl = null;
		this.descriptionInputEl = null;
		this.noteInputEl = null;
		this.clearInitialDescriptionFocusTimers();

  const cleanupDraft = this.draftPropertiesCleanup; this.draftPropertiesCleanup = undefined;
  if (closeSave) void closeSave.then(cleanupDraft, cleanupDraft);
  else cleanupDraft?.();

		if (this.saveTimer) {
			clearWindowTimeout(this.saveTimer);
			this.saveTimer = null;
		}
	}

	private prepareBodyDropdown(dropdown: HTMLElement): void {
		dropdown.addClass('operon-task-editor-body-dropdown');
		dropdown.ownerDocument.body.appendChild(dropdown);
		this.bodyDropdowns.push(dropdown);
	}

	private positionBodyDropdown(dropdown: HTMLElement, anchor: HTMLElement, gap = 4): void {
		const rect = anchor.getBoundingClientRect();
		positionFloatingElement(dropdown, rect, {
			gap,
			matchWidth: rect.width,
		});
	}

	private syncDerivedRepeatFieldsFromDraft(): void {
		const rule = parseRepeatRule(this.fieldValues['repeat']);
		if (!rule || rule.mode !== 'count') return;
		const repeatEnd = deriveCountModeRepeatEndFromFieldValues(
			this.fieldValues,
			seriesId => this.getRepeatSkipDates?.(seriesId) ?? [],
		);
		if (!repeatEnd) {
			delete this.fieldValues['datetimeRepeatEnd'];
			return;
		}
		this.fieldValues['datetimeRepeatEnd'] = repeatEnd;
	}

	private registerSchedulingDraftRefresher(refresh: () => void): void {
		this.schedulingDraftRefreshers.add(refresh);
	}

	private refreshSchedulingDraftControls(): void {
		for (const refresh of this.schedulingDraftRefreshers) {
			refresh();
		}
	}

	private applyDraftFieldRules(
		patch: Record<string, string>,
		changedKeys: string[],
		options: { refreshEstimateReallocation?: boolean } = {},
	): void {
		const normalizedPatch = applyFieldRules({
			current: this.fieldValues,
			patch,
			changedKeys,
		}).patch;
		for (const [key, value] of Object.entries(normalizedPatch)) {
			if (value.trim()) {
				this.fieldValues[key] = value;
			} else {
				delete this.fieldValues[key];
			}
		}
		this.syncDerivedRepeatFieldsFromDraft();
		this.refreshSchedulingDraftControls();
		if (REMINDER_RULE_ANCHORS.some(anchor => anchor in normalizedPatch)) {
			this.refreshWorkflowPickerSurfaceValues();
		}
		if (options.refreshEstimateReallocation === true) {
			this.refreshEstimateReallocationControl?.();
		}
		this.refreshMobileCoreButtons();
	}

	private applyTerminalDateDraftChange(
		key: 'dateCompleted' | 'dateCancelled',
		value: string,
	): boolean {
		const normalizedValue = value.trim();
		const resolution = resolveReverseWorkflowFromTerminalDate(
			this.settings.pipelines,
			this.fieldValues['status'],
			this.settings.defaultPipelineName,
			key,
			normalizedValue,
		);
		if (!resolution.isValid || !resolution.workflow) {
			new Notice(resolution.errorMessage ?? t('taskEditor', 'terminalDateWorkflowResolveFailed'));
			return false;
		}

		this.fieldValues['status'] = resolution.workflow.value;
		this.checkbox = resolution.checkbox;
		if (normalizedValue) {
			this.fieldValues[key] = normalizedValue;
			delete this.fieldValues[key === 'dateCompleted' ? 'dateCancelled' : 'dateCompleted'];
		} else {
			delete this.fieldValues['dateCompleted'];
			delete this.fieldValues['dateCancelled'];
		}
		this.refreshSchedulingDraftControls();
		this.refreshEstimateReallocationControl?.();
		this.refreshMobileCoreButtons();
		return true;
	}

	private applyDateDraftChange(key: string, value: string): boolean {
		if (key === 'dateCompleted' || key === 'dateCancelled') {
			return this.applyTerminalDateDraftChange(key, value);
		}
		this.applyDraftFieldRules({ [key]: value }, [key]);
		return true;
	}

	private applyStatusDraftChange(value: string): boolean {
		const previousFieldValues = { ...this.fieldValues };
		const previousCheckbox = this.checkbox;
		this.fieldValues['status'] = value;
		const resolved = resolveWorkflowStatus(this.settings.pipelines, value);
		if (!resolved) {
			new Notice(t('taskEditor', 'terminalDateWorkflowResolveFailed'));
			this.fieldValues = previousFieldValues;
			this.checkbox = previousCheckbox;
			this.refreshSchedulingDraftControls();
			this.refreshMobileCoreButtons();
			return false;
		}

		this.checkbox = resolved.checkbox;
		const today = localToday();
		if (resolved.terminalDateKey === 'dateCompleted') {
			this.fieldValues['dateCompleted'] = this.fieldValues['dateCompleted'] || today;
			delete this.fieldValues['dateCancelled'];
		} else if (resolved.terminalDateKey === 'dateCancelled') {
			this.fieldValues['dateCancelled'] = this.fieldValues['dateCancelled'] || today;
			delete this.fieldValues['dateCompleted'];
		} else {
			delete this.fieldValues['dateCompleted'];
			delete this.fieldValues['dateCancelled'];
		}
		this.refreshSchedulingDraftControls();
		this.refreshMobileCoreButtons();
		return true;
	}

	private applyTaskFieldPickerPayload(payload: Record<string, string | string[]>): void {
		const patch: Record<string, string> = {};
		for (const [key, value] of Object.entries(payload)) {
			patch[key] = Array.isArray(value) ? value.join('; ') : value;
		}
		const changedKeys = Object.keys(patch);
		this.applyDraftFieldRules(patch, changedKeys, {
			refreshEstimateReallocation: changedKeys.includes('parentTask'),
		});
	}

	private renderCustomFieldSelection(
		container: HTMLElement,
		mapping: EditorFieldDisplay,
		onRemove: ((value: string, index: number) => void) | null,
  options: { values?: readonly string[]; suppressValueTooltip?: boolean; onActivate?: (chip: HTMLElement, value: string, index: number) => void } = {},
	): void {
		container.replaceChildren();
		const rawValue = normalizeCustomFieldRawValue((this.fieldValues as Record<string, unknown>)[mapping.canonicalKey]);
		const values = options.values ?? (mapping.type === 'list'
			? splitTaskListValue(rawValue)
			: rawValue
				? [rawValue]
				: []);
		container.classList.toggle('is-empty', values.length === 0);
		for (const [index, value] of values.entries()) {
			const chip = createInlineTaskCompactChipElement({
				key: mapping.canonicalKey,
				label: this.formatCustomFieldDisplayValue(mapping, value),
				icon: mapping.type === 'checkbox'
					? getCheckboxPropertyIcon(value === 'true' ? true : value === 'false' ? false : undefined, getCustomFieldIcon(mapping))
					: getCustomFieldIcon(mapping),
				iconOnly: false,
				interactive: false,
				colorRole: 'default',
				linkTarget: null,
			}, 'operon-editor-compact-selection-chip', { forceFull: true });
			if (!options.suppressValueTooltip) this.bindTruncatedTextTooltip(chip.querySelector<HTMLElement>('.operon-inline-compact-chip-label'));
			if (mapping.type === 'date' || mapping.type === 'datetime') this.appendWeekdayHint(chip, value);
			options.onActivate?.(chip, value, index);
   if (!onRemove) { container.appendChild(chip); continue; }
			const removeButton = chip.ownerDocument.win.createEl('button');
			removeButton.type = 'button';
			removeButton.className = 'operon-editor-compact-selection-chip-remove';
			setIcon(removeButton, 'x');
			setAccessibleLabelWithoutTooltip(removeButton, t('taskEditor', 'removeValue', {
				value: this.formatCustomFieldDisplayValue(mapping, value),
			}));
			removeButton.addEventListener('click', () => onRemove(value, index));
			chip.appendChild(removeButton);
			chip.addClass('has-remove-action');
			container.appendChild(chip);
		}
	}

	private formatCustomFieldDisplayValue(mapping: EditorFieldDisplay, value: string): string {
		const trimmed = value.trim();
		if (mapping.type === 'datetime') return formatTaskEditorDatetime(this.app, this.settings, trimmed);
		if (mapping.type === 'date') return formatUiDate(trimmed, this.settings);
		return trimmed;
	}

	// --- Renderers ---

	private getProgressDescendantTasks(operonId: string): IndexedTask[] {
		const descendants: IndexedTask[] = [];
		for (const descendantId of this.indexer.secondary.getAllDescendantIds(operonId)) {
			if (descendantId === operonId) continue;
			const task = this.indexer.getTask(descendantId);
			if (task) descendants.push(task);
		}
		return descendants;
	}

	private renderDescriptionNoteSection(container: HTMLElement, id: 'description' | 'notes'): void {
		const section = container.createDiv('operon-editor-text-fields');

		if (id === 'description') {
			const descriptionGroup = section.createDiv('operon-editor-text-field-group is-description');
			const descriptionHeader = descriptionGroup.createDiv('operon-editor-desktop-group-header');
			descriptionHeader.createEl('h6', {
				cls: 'operon-editor-core-title-badge operon-editor-text-field-title operon-editor-desktop-group-title',
				text: this.desktopSectionLabel('description'),
			});
			const descriptionActions = descriptionHeader.createDiv('operon-task-editor-workflow-actions operon-editor-description-actions');
			this.renderQuickFinishButton(descriptionActions);
			this.renderProjectSerialControl(descriptionActions);
			this.renderCopyOperonIdButton(descriptionActions);
			this.renderDescription(descriptionGroup, false);

		} else {
			const notesGroup = section.createDiv('operon-editor-text-field-group is-notes');
			const notesHeader = notesGroup.createDiv('operon-editor-desktop-group-header');
			notesHeader.createEl('h6', {
				cls: 'operon-editor-core-title-badge operon-editor-text-field-title operon-editor-desktop-group-title',
				text: this.desktopSectionLabel('notes'),
			});
			this.renderNote(notesGroup, false);
		}
	}

	private renderDescription(container: HTMLElement, showLabel = true): void {
		const setting = new Setting(container);
		if (showLabel) setting.setName(t('taskEditor', 'description'));
		const host = setting.controlEl.createDiv(
			'operon-task-editor-compact-text-host is-description',
		);
		this.descriptionCompactHostEl = host;
		this.descriptionCompactEditor?.destroy();
		this.descriptionCompactEditor = createCompactMarkdownEditorSurface(host, {
			onCompositionSettled: this.sourceCompositionEnd,
			app: this.app,
			sourceValue: this.description,
			sourcePath: this.getCompactTextSourcePath(),
			placeholder: t('taskEditor', 'descriptionPlaceholder'),
			ariaLabel: t('taskEditor', 'description'),
			onTextareaLayout: textarea => this.autoSizeCompactTextarea(textarea),
			onUserChange: draft => {
				const value = draft.persistableValue;
				if (value === this.description) return;
				this.description = value;
				this.markEdited();
				this.refreshCoreTrackerControl?.();
				this.refreshTrackingSessionsSection?.();
			},
			onIntent: intent => this.handleCompactTextEditorIntent('description', intent),
		});
		setting.settingEl.addClass('operon-description-setting');
		if (!showLabel) setting.settingEl.addClass('operon-editor-text-field-setting');
	}

	private setDelimitedFieldValue(fieldKey: string, values: string[]): void {
		const normalized = normalizeListValues(values);
		if (normalized.length > 0) {
			this.fieldValues[fieldKey] = normalized.join('; ');
			return;
		}
		delete this.fieldValues[fieldKey];
	}

	private formatInlineReferenceLabel(value: string): string {
		const trimmed = value.trim();
		const wikiMatch = trimmed.match(/^\[\[([^|\]]+)(?:\|([^\]]+))?\]\]$/);
		if (!wikiMatch) return trimmed;
		const target = (wikiMatch[2] ?? wikiMatch[1] ?? '').trim();
		return target;
	}

	private resolveCompactChipIcon(canonicalKey: InlineTaskCompactChipKey): string {
		return getConfiguredKeyMappingIcon(canonicalKey, this.settings.keyMappings)
			|| INLINE_TASK_COMPACT_FALLBACK_ICONS[canonicalKey];
	}

	private createPickerAnchor(
		container: HTMLElement,
		placeholder: string,
		options?: { leadingIcon?: string },
	): HTMLButtonElement {
		const button = container.createEl('button', {
			cls: 'operon-editor-picker-anchor',
			attr: {
				type: 'button',
			},
		});
		const main = button.createSpan('operon-editor-picker-anchor-main');
		if (options?.leadingIcon) {
			const leadingIconWrap = main.createSpan('operon-editor-picker-anchor-leading-icon');
			setIcon(leadingIconWrap, options.leadingIcon);
		}
		const text = main.createSpan({
			text: placeholder,
			cls: 'operon-editor-picker-anchor-text',
		});
		const iconWrap = button.createSpan('operon-editor-picker-anchor-icon');
		setIcon(iconWrap, this.usesMobileLayout ? 'chevron-right' : 'search');
		button.dataset.placeholder = placeholder;
		button.dataset.placeholderTarget = text.className;
		return button;
	}

	private renderValueChips(
		container: HTMLElement,
		values: string[],
		variant: 'contexts' | 'tags' | 'assignees',
		onRemove: (value: string) => void,
		formatValue?: (value: string) => string,
	): void {
		container.replaceChildren();
		container.classList.toggle('is-empty', values.length === 0);
		for (const value of values) {
			const chip = container.createDiv(`operon-editor-picker-chip is-${variant}`);
			chip.createSpan({
				text: formatValue ? formatValue(value) : value,
				cls: 'operon-editor-picker-chip-label',
			});
			const removeButton = chip.createEl('button', {
				cls: 'operon-editor-picker-chip-remove',
				text: '×',
				attr: { type: 'button' },
			});
			setAccessibleLabelWithoutTooltip(removeButton, t('taskEditor', 'removeValue', { value }));
			removeButton.addEventListener('click', () => onRemove(value));
		}
	}

	private renderCompactSelectionChips(
		container: HTMLElement,
		canonicalKey: InlineTaskCompactChipKey,
		values: string[],
		onRemove: (value: string) => void,
		formatLabel: (value: string) => string,
	): void {
		container.replaceChildren();
		container.classList.toggle('is-empty', values.length === 0);
		const icon = this.resolveCompactChipIcon(canonicalKey);
		for (const value of values) {
			const chip = createInlineTaskCompactChipElement({
				key: canonicalKey,
				label: formatLabel(value),
				icon,
				iconOnly: false,
				interactive: false,
				colorRole: 'default',
				linkTarget: null,
			}, 'operon-editor-compact-selection-chip', { forceFull: true });
			this.bindTruncatedTextTooltip(chip.querySelector<HTMLElement>('.operon-inline-compact-chip-label'));
			if (canonicalKey === 'assignees' && value.trim().startsWith('[[') && value.trim().endsWith(']]')) {
				const target = value.trim().slice(2, -2).split('|')[0];
				bindAssigneeChipImage(chip, { key: canonicalKey, linkTarget: target }, this.app, this.getCompactTextSourcePath(), this.settings.assigneeImageProperty);
			}
			const removeButton = chip.ownerDocument.win.createEl('button');
			removeButton.type = 'button';
			removeButton.className = 'operon-editor-compact-selection-chip-remove';
			setIcon(removeButton, 'x');
			setAccessibleLabelWithoutTooltip(removeButton, t('taskEditor', 'removeValue', { value: formatLabel(value) }));
			removeButton.addEventListener('click', () => onRemove(value));
			chip.appendChild(removeButton);
			container.appendChild(chip);
		}
	}

	private resolveTaskSelectionIcon(fieldKey: 'parentTask' | 'subtasks' | 'blocking' | 'blockedBy'): string {
		const configured = getConfiguredKeyMappingIcon(fieldKey, this.settings.keyMappings);
		if (configured) return configured;
		switch (fieldKey) {
			case 'parentTask':
			case 'blocking':
			case 'blockedBy':
				return this.resolveCompactChipIcon(fieldKey);
			case 'subtasks':
				return 'list-tree';
		}
	}

	private createTaskSelectionChip(
		label: string,
		icon: string,
		removeLabel: string,
		onRemove: () => void,
	): HTMLElement {
		const chip = createInlineTaskCompactChipElement({
			key: 'contexts',
			label,
			icon,
			iconOnly: false,
			interactive: false,
			colorRole: 'default',
			linkTarget: null,
		}, 'operon-editor-compact-selection-chip', { forceFull: true });
		this.bindTruncatedTextTooltip(chip.querySelector<HTMLElement>('.operon-inline-compact-chip-label'));
		const removeButton = chip.ownerDocument.win.createEl('button');
		removeButton.type = 'button';
		removeButton.className = 'operon-editor-compact-selection-chip-remove';
		setIcon(removeButton, 'x');
		setAccessibleLabelWithoutTooltip(removeButton, removeLabel);
		removeButton.addEventListener('click', onRemove);
		chip.appendChild(removeButton);
		return chip;
	}

	private renderTaskSelectionChips(
		container: HTMLElement,
		fieldKey: 'parentTask' | 'subtasks' | 'blocking' | 'blockedBy',
		operonIds: string[],
		onRemove: (operonId: string) => void,
	): void {
		container.replaceChildren();
		container.classList.toggle('is-empty', operonIds.length === 0);
		const icon = this.resolveTaskSelectionIcon(fieldKey);
		for (const operonId of operonIds) {
			const task = this.indexer.getTask(operonId);
			const label = task?.description?.trim() || operonId;
			const chip = this.createTaskSelectionChip(
				label,
				icon,
				t('taskEditor', 'removeValue', { value: label }),
				() => onRemove(operonId),
			);
			if (fieldKey === 'blockedBy') {
				chip.dataset.blockedById = operonId;
				this.applyBlockedBySelectionState(chip, operonId);
			}
			container.appendChild(chip);
		}
	}

	private applyBlockedBySelectionState(chip: HTMLElement, operonId: string): void {
		const state = resolveBlockedByVisualStateForId(
			operonId,
			id => this.indexer.getTask(id),
			this.settings.pipelines,
		);
		const color = resolveBlockedByVisualStateColor(state);
		chip.dataset.blockedByState = state;
		if (color) chip.style.setProperty('--operon-blocked-by-state-color', color);
	}

	private refreshRenderedBlockedBySelectionStates(): void {
		for (const chip of Array.from(this.rootEl?.querySelectorAll<HTMLElement>('[data-blocked-by-id]') ?? [])) {
			const operonId = chip.dataset.blockedById?.trim();
			if (operonId) this.applyBlockedBySelectionState(chip, operonId);
		}
	}

	private collectAncestorIds(operonId: string): string[] {
		const ancestorIds: string[] = [];
		let currentId = operonId.trim();
		let depth = 0;
		while (currentId && depth < 20) {
			const task = this.indexer.getTask(currentId);
			const parentId = task?.fieldValues['parentTask']?.trim() ?? '';
			if (!parentId) break;
			ancestorIds.push(parentId);
			currentId = parentId;
			depth += 1;
		}
		return ancestorIds;
	}

	private renderNote(container: HTMLElement, showLabel = true): void {
		const setting = new Setting(container);
		if (showLabel) setting.setName(t('taskEditor', 'notes'));
		const host = setting.controlEl.createDiv(
			'operon-task-editor-compact-text-host is-notes',
		);
		this.noteCompactHostEl = host;
		this.noteCompactEditor?.destroy();
		this.noteCompactEditor = createCompactMarkdownEditorSurface(host, {
			onCompositionSettled: this.sourceCompositionEnd,
			app: this.app,
			sourceValue: this.fieldValues['note'] ?? '',
			sourcePath: this.getCompactTextSourcePath(),
			placeholder: t('taskEditor', 'notesPlaceholder'),
			ariaLabel: t('taskEditor', 'notes'),
			textPolicy: 'task-note',
			onTextareaLayout: textarea => this.autoSizeCompactTextarea(textarea),
			onUserChange: draft => {
				const value = draft.persistableValue;
				const previous = this.fieldValues['note'] ?? '';
				if (value.trim()) {
					this.fieldValues['note'] = value;
				} else {
					delete this.fieldValues['note'];
				}
				if (value === previous) return;
				this.markEdited();
			},
			onIntent: intent => this.handleCompactTextEditorIntent('note', intent),
		});
		setting.settingEl.addClass('operon-note-setting');
		if (!showLabel) setting.settingEl.addClass('operon-editor-text-field-setting');
	}

	private renderTags(container: HTMLElement): void {
		const setting = new Setting(container);
		setting.settingEl.addClass('operon-tags-setting', 'operon-editor-tags-setting');
		const stack = setting.controlEl.createDiv('operon-editor-picker-stack operon-editor-tags-stack');
		const anchor = this.createPickerAnchor(stack, t('taskEditor', 'tags'), {
			leadingIcon: this.resolveCompactChipIcon('tags'),
		});
		const selectedWrap = stack.createDiv('operon-editor-picker-selected operon-editor-tag-selection-row');

		let selectedValues = normalizeListValues(this.tags.map(tag => tag.replace(/^#/, '')));
		let closePicker: (() => void) | null = null;

		const closeActivePicker = () => {
			if (!closePicker) return;
			const current = closePicker;
			closePicker = null;
			anchor.removeClass('is-picker-open');
			current();
		};

		const render = () => {
			this.renderCompactSelectionChips(selectedWrap, 'tags', selectedValues, (tag) => {
				closeActivePicker();
				selectedValues = selectedValues.filter(existing => existing !== tag);
				this.tags = [...selectedValues];
				render();
				this.markEdited();
				this.refreshWorkflowPickerSurfaceValues();
			}, (tag) => tag);
		};

		const openPicker = () => {
			if (closePicker) return;
			closePicker = showTagPicker(anchor, {
				app: this.app,
				allTasks: this.indexer.getAllTasks(),
				value: selectedValues,
				closeOnSelect: this.shouldCloseWorkflowPickerOnSelect(),
				onSave: (values) => {
					const nextValues = normalizeListValues(values.map(value => value.replace(/^#/, '')));
					if (areStringArraysEqual(selectedValues, nextValues)) return;
					selectedValues = nextValues;
					this.tags = [...nextValues];
					render();
					this.markEdited();
					if (selectedValues.length > 0) {
						this.refreshWorkflowActionButtonStates();
					} else {
						closeActivePicker();
						this.refreshWorkflowPickerSurfaceValues();
					}
				},
				onClose: () => {
					closePicker = null;
					anchor.removeClass('is-picker-open');
				},
			});
			anchor.addClass('is-picker-open');
		};

		anchor.addEventListener('click', (event) => {
			event.preventDefault();
			openPicker();
		});
		anchor.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			openPicker();
		});

		render();
	}

	private getProgressSectionState(): EditorProgressSectionState | null {
		const operonId = this.existingTask?.operonId;
		if (!operonId) return null;

		const indexedTask = this.indexer.getTask(operonId);
		const statsProgress = indexedTask ? resolveTaskEditorProgressFromStats(indexedTask.fieldValues) : null;
		const hasDirectChildren = !statsProgress && this.indexer.secondary.getChildIds(operonId).size > 0;
		const allDesc = statsProgress || !hasDirectChildren ? [] : this.getProgressDescendantTasks(operonId);
		const hasSubtasks = statsProgress?.hasSubtasks ?? allDesc.length > 0;
		const total = statsProgress?.total ?? allDesc.length;
		const done = statsProgress?.done ?? allDesc.filter(c => c.checkbox === 'done').length;
		const progressPct = statsProgress?.progressPct ?? (total > 0 ? Math.round((done / total) * 100) : 0);
		const checkboxTotal = Math.max(0, indexedTask?.plainCheckboxProgress?.total ?? 0);
		const checkboxDone = Math.min(Math.max(0, indexedTask?.plainCheckboxProgress?.completed ?? 0), checkboxTotal);
		const checkboxProgressPct = checkboxTotal > 0 ? Math.round((checkboxDone / checkboxTotal) * 100) : 0;
		const hasPlainCheckboxes = checkboxTotal > 0;

		const ownDuration = Math.max(0, parseInt(indexedTask?.fieldValues['duration'] ?? this.fieldValues['duration'] ?? '0', 10) || 0);
		const indexedTotalDuration = Math.max(0, parseInt(indexedTask?.fieldValues['totalDuration'] ?? '0', 10) || 0);
		const subtaskDuration = hasSubtasks ? Math.max(0, indexedTotalDuration - ownDuration) : 0;
		const totalDuration = Math.max(indexedTotalDuration, ownDuration + subtaskDuration, ownDuration);
		const ownEstimate = Math.max(0, parseInt(indexedTask?.fieldValues['estimate'] ?? this.fieldValues['estimate'] ?? '0', 10) || 0);
		const indexedTotalEstimate = Math.max(0, parseInt(indexedTask?.fieldValues['totalEstimate'] ?? '0', 10) || 0);
		const subtaskEstimate = hasSubtasks ? Math.max(0, indexedTotalEstimate - ownEstimate) : 0;
		const totalEstimate = Math.max(indexedTotalEstimate, ownEstimate + subtaskEstimate, ownEstimate);
		const hasAnyTimeData = [
			ownDuration,
			subtaskDuration,
			totalDuration,
			ownEstimate,
			subtaskEstimate,
			totalEstimate,
		].some(value => value > 0);

		// Count each descendant's own contribution, never its rolled-up child totals.
		const timeDescendants = hasSubtasks && hasAnyTimeData
			? (statsProgress ? this.getProgressDescendantTasks(operonId) : allDesc)
			: [];
		let trackedSubtaskCount = 0;
		let estimatedSubtaskCount = 0;
		for (const descendant of timeDescendants) {
			if (parseInt(descendant.fieldValues['duration'] ?? '0', 10) > 0) trackedSubtaskCount++;
			if (parseInt(descendant.fieldValues['estimate'] ?? '0', 10) > 0) estimatedSubtaskCount++;
		}

		if (!hasSubtasks && !hasAnyTimeData && !hasPlainCheckboxes) return null;

		return {
			hasSubtasks,
			done,
			total,
			progressPct,
			hasPlainCheckboxes,
			checkboxDone,
			checkboxTotal,
			checkboxProgressPct,
			ownDuration,
			subtaskDuration,
			trackedSubtaskCount,
			totalDuration,
			ownEstimate,
			subtaskEstimate,
			estimatedSubtaskCount,
			totalEstimate,
			hasAnyTimeData,
		};
	}

	private renderTimeSummarySection(container: HTMLElement, state: EditorProgressSectionState | null): void {
		const summary = container.createDiv('operon-editor-time-summary');
		this.renderStatsHeader(summary, state);
	}

	private renderTimeSummaryCards(summary: HTMLElement, state: EditorProgressSectionState | null): void {
		summary.querySelector('.operon-editor-time-summary-cards')?.remove();
		if (!state) return;
		const cards = summary.createDiv('operon-editor-time-summary-cards');
		for (const [kind, label, own, subtasks, total, contributorCount] of [
			['duration', t('filterSets', 'fieldTrackedOn'), state.ownDuration, state.subtaskDuration, state.totalDuration, state.trackedSubtaskCount],
			['estimate', t('settings', 'chipEstimate'), state.ownEstimate, state.subtaskEstimate, state.totalEstimate, state.estimatedSubtaskCount],
		] as const) {
			if (total <= 0) continue;
			const card = cards.createDiv(`operon-editor-time-card is-${kind}`);
			const heading = card.createDiv('operon-editor-time-card-heading');
			heading.createSpan({ cls: 'operon-editor-time-card-label', text: label });
			heading.createSpan({ cls: 'operon-editor-time-card-total', text: formatDurationHuman(total, 'minutes') });
			const breakdown = card.createDiv('operon-editor-time-card-breakdown');
			for (const [scope, name, seconds] of [
				['own', t('taskEditor', 'timeOwn'), own],
				['subtasks', t('taskEditor', 'progressSubtasksCount', { count: String(contributorCount) }), subtasks],
			] as const) {
				const item = breakdown.createSpan(`operon-editor-time-card-scope is-${scope}`);
				item.createSpan({ text: name });
				item.createSpan({ cls: 'operon-editor-time-card-value', text: kind === 'estimate' && seconds === 0 ? '—' : formatDurationHuman(seconds, 'minutes') });
			}
			// Each bar shows its own composition, never a remaining-estimate segment.
			const bar = card.createDiv({ cls: 'operon-editor-time-card-bar', attr: { 'aria-hidden': 'true' } });
			const sum = own + subtasks;
			const ownPercent = sum > 0 ? Math.max(0, Math.min(100, own / sum * 100)) : 0;
			bar.setCssProps({ '--operon-stats-own-share': `${ownPercent}%` });
			bar.createSpan('operon-editor-time-card-bar-own');
			bar.createSpan('operon-editor-time-card-bar-subtasks');
			bar.hidden = sum === 0;
		}
		if (!cards.childElementCount) cards.remove();
	}

	private renderStatsHeader(summary: HTMLElement, state: EditorProgressSectionState | null): void {
		const header = summary.createDiv('operon-editor-desktop-group-header operon-editor-stats-header');
		const title = header.createEl('h6', { text: this.desktopSectionLabel('stats'), cls: 'operon-editor-core-title-badge operon-editor-desktop-group-title', attr: { tabindex: '0' } });
		const actions = header.createDiv('operon-editor-stats-actions');
		const makeCounter = (kind: 'subtasks' | 'checkboxes', name: string, label: string, open: (anchor: HTMLElement) => void) => {
			const button = actions.createEl('button', { cls: `operon-editor-stats-counter is-${kind}`, attr: { type: 'button' } });
			const ring = button.createSpan({ cls: 'operon-editor-stats-counter-ring', attr: { 'aria-hidden': 'true' } });
			const text = button.createSpan('operon-editor-stats-counter-value');
			button.addEventListener('click', () => { if (!this.disposed) open(button); });
			return { button, ring, text, name, label, tooltip: '' };
		};
		const subtasks = makeCounter('subtasks', t('taskEditor', 'subtasks'), t('filterSets', 'dynamicSubtasksFilterTitle'), anchor => {
			runAsyncAction('task editor stats subtasks open failed', async () => {
				const id = this.getCurrentOperonId();
				if (!id) return;
				this.closeStatsSubtasks?.();
				this.closeStatsSubtasks = this.onOpenSubtasksStats?.(id, anchor) ?? null;
			});
		});
		const checkboxes = makeCounter('checkboxes', t('settings', 'contextualMenuActionCheckboxes'), t('taskEditor', 'showCheckboxes'), anchor => {
			runAsyncAction('task editor stats checkboxes open failed', () => this.openTaskEditorCheckboxPopover(anchor));
		});
		let timeSignature: string | null = null;
		const render = (next: EditorProgressSectionState | null) => {
			const focused = summary.ownerDocument.activeElement;
			summary.hidden = !next || !(next.hasSubtasks || next.hasPlainCheckboxes || next.totalDuration > 0 || next.totalEstimate > 0);
			if (summary.parentElement?.hasClass('operon-task-editor-section-host')) summary.parentElement.hidden = summary.hidden;
			const nextTimeSignature = JSON.stringify(next && [next.trackedSubtaskCount, next.estimatedSubtaskCount, next.ownDuration, next.subtaskDuration, next.totalDuration, next.ownEstimate, next.subtaskEstimate, next.totalEstimate]);
			if (timeSignature !== nextTimeSignature) {
				timeSignature = nextTimeSignature;
				this.renderTimeSummaryCards(summary, next);
			}
			for (const [control, available, done, total, percent, labelKey] of [
				[subtasks, next?.hasSubtasks, next?.done ?? 0, next?.total ?? 0, next?.progressPct ?? 0, 'progressSubtasksCount'],
				[checkboxes, next?.hasPlainCheckboxes, next?.checkboxDone ?? 0, next?.checkboxTotal ?? 0, next?.checkboxProgressPct ?? 0, 'progressCheckboxesCount'],
			] as const) {
				control.button.hidden = !available;
				control.text.setText(`${percent}% ${control.name}`);
				control.ring.setCssProps({ '--operon-stats-progress': `${Math.max(0, Math.min(100, percent))}%` });
				const counts = `${t('taskEditor', 'progressDoneCount', { count: String(done) })} / ${t('taskEditor', labelKey, { count: String(total) })}`;
				const tooltip = `${control.label}\n${counts}`;
				if (control.tooltip !== tooltip) {
					this.bindTaskEditorTooltip(control.button, tooltip);
					control.tooltip = tooltip;
				}
				setAccessibleLabelWithoutTooltip(control.button, `${counts} · ${percent}%`);
			}
			subtasks.button.disabled = !this.onOpenSubtasksStats;
			if (!next?.hasSubtasks) {
				this.closeStatsSubtasks?.();
				this.closeStatsSubtasks = null;
			}
			if ((summary.hidden && focused && summary.contains(focused)) || [subtasks.button, checkboxes.button].some(button => button === focused && button.hidden)) {
				const target = [subtasks.button, checkboxes.button].find(button => !button.hidden && !button.disabled);
				if (target) target.focus({ preventScroll: true });
				else if (!summary.hidden) title.focus({ preventScroll: true });
				else this.focusDescriptionField(false);
			}
		};
		render(state);
		this.refreshStatsCounters = () => { if (!this.disposed && summary.isConnected) render(this.getProgressSectionState()); };
	}

	private renderDesktopPropertyGroups(host: (id: TaskEditorSectionId) => HTMLElement): void {
		const container = host('commands');
		const commands = container.createDiv('operon-editor-group operon-editor-desktop-commands');
		const header = commands.createDiv('operon-editor-desktop-group-header');
		header.createDiv({ text: this.desktopSectionLabel('commands'), cls: 'operon-editor-core-title-badge operon-editor-desktop-group-title' });
		const actions = header.createDiv('operon-editor-core-actions operon-task-editor-workflow-actions');
		this.renderCoreActionButtons(actions);
		this.renderRemoveControl(actions);

		const propertyHost = (id: TaskEditorSectionId): HTMLElement => {
			const root = host(id);
			root.addClass('operon-editor-desktop-properties', 'operon-task-editor-workflow-values');
			return root;
		};
		const items = this.getRenderableWorkflowPickerItems().filter(item => !this.isNativeCustomProperty(item.key));
		const available = new Set(items.map(item => item.key));
		const assigned = new Set<string>();
		for (const group of TASK_EDITOR_DESKTOP_GROUPS) {
			const keys = group.fields.filter(key => {
				assigned.add(key);
				return DESKTOP_CORE_FIELDS.has(key) || available.has(key);
			});
			this.renderDesktopPropertyGroup(propertyHost(group.key), group.key, keys);
		}
		this.additionalPropertyKeys = items.filter(item => !assigned.has(item.key)).map(item => item.key);
		const additional = this.renderDesktopPropertyGroup(propertyHost('additional'), 'additional', this.additionalPropertyKeys);
  this.mountDesktopFileProperties(additional);
		this.refreshDesktopPropertyRows();
	}

 private isNativeCustomProperty(key: string): boolean {
  const mapping = this.settings.keyMappings.find(item => item.canonicalKey === key && item.isSystem === false);
  if (!mapping) return false;
  try { return resolveInlinePropertyDefinition(mapping.visiblePropertyName, mapping.type, this.settings.keyMappings, this.settings.inlinePropertyDefinitions).encoding === 'vault-v1'; }
  catch { return false; }
 }

 private getInlinePropertyChanges(): InlinePropertyChange[] {
  return Array.from(this.fileProperties, ([sourceName, entry]): InlinePropertyChange | null => {
   if (!entry.inline || entry.pending || !entry.baseline || !isSupportedRawYamlPropertyValue(entry.value)
    || rawYamlPropertyExpectationsEqual(entry.baseline, { present: true, value: entry.value })) return null;
   return { sourceName, type: entry.inline.type, expected: { present: entry.inline.present, rawValue: entry.inline.rawValue },
    mutation: { kind: 'set', value: (Array.isArray(entry.value) ? [...entry.value] : entry.value) as VaultPropertyValue } };
  }).filter((change): change is InlinePropertyChange => change !== null);
 }

 private getFilePropertyChanges(): FileTaskPropertyChange[] {
  return Array.from(this.fileProperties, ([propertyName, entry]) => {
   if (entry.inline || entry.pending || !entry.baseline || !isSupportedRawYamlPropertyValue(entry.value) || rawYamlPropertyExpectationsEqual(entry.baseline, { present: true, value: entry.value })) return null;
   return { propertyName, expected: { ...entry.baseline, value: Array.isArray(entry.baseline.value) ? [...entry.baseline.value] : entry.baseline.value }, value: Array.isArray(entry.value) ? [...entry.value] : entry.value, ...(this.isNativeCustomProperty(this.settings.keyMappings.find(mapping => [mapping.visiblePropertyName, mapping.canonicalKey].some(alias => alias.toLowerCase() === propertyName.toLowerCase()))?.canonicalKey ?? '') ? { nativeType: entry.field.type as InlinePropertyType } : {}) };
  }).filter((change): change is FileTaskPropertyChange => change !== null);
 }

 private mountDesktopFileProperties(root: HTMLElement): void {
  if (this.usesMobileLayout || this.isNewTask || !this.fileBodyContext) return;
  this.filePropertyRoot = root.createDiv('operon-editor-desktop-file-properties');
  if (!this.filePropertyCleanup) {
   this.filePropertyCleanup = getNativePropertyIndex(this.app).subscribe(() => {
    if (!this.disposed) void this.refreshDesktopFileProperties();
   });
  }
  void this.refreshDesktopFileProperties();
 }

 private refreshDesktopFileProperties(): Promise<void> {
  const endProperties = this.openingTrace?.span('properties');
  this.initialFileProperties = this.loadDesktopFileProperties();
  if (endProperties) void this.initialFileProperties.then(endProperties, endProperties);
  return this.initialFileProperties;
 }

 private async loadDesktopFileProperties(): Promise<void> {
  const root = this.filePropertyRoot;
  if (!root || this.disposed) return;
  const generation = ++this.filePropertyGeneration;
  const task = this.getCurrentIndexedTask();
  try {
   if (!task || this.indexer.hasDuplicateOperonIdConflict(task.operonId)) throw new Error('invalid-file-task');
   const index = getNativePropertyIndex(this.app);
   index.configure(this.settings);
   root.setAttribute('aria-busy', String(!index.isReady([task])));
   if (!index.isReady([task]) && !root.children.length) root.createDiv({ text: t('errors', 'taskCard_loading'), cls: 'operon-editor-desktop-file-loading' });
   await index.ensure([task]);
   if (generation !== this.filePropertyGeneration || this.disposed || root !== this.filePropertyRoot) return;
   root.removeAttribute('aria-busy');
   this.nativePropertyTypes = { ...index.getNativeTypes() };
   this.filePropertyTypeResolver.replaceTypes(index.getTypes());
   const snapshot = index.getTask(task);
   if (!snapshot.available) throw new Error('unverified-task-properties');
   root.querySelector('.operon-editor-desktop-file-loading')?.remove();
   const next = new Map<string, EditorFileProperty>();
   for (const property of snapshot.properties.values()) {
    const name = property.sourceName;
    const type = property.type ?? this.filePropertyTypeResolver.resolve(name, [property.value]).tableType;
    next.set(name, { field: this.nativePropertyField(name, type as InlinePropertyType),
     ...(property.inline ? { inline: property.inline } : {}),
     baseline: isSupportedRawYamlPropertyValue(property.value) ? { present: property.present, value: property.value } : null, value: property.value,
     readonly: !!property.reason, readOnlyReason: property.reason });
   }
   // Preserve dirty baselines, active input, and submitted versions across source refreshes.
   for (const [name, previous] of this.fileProperties) {
    if (previous.pending && previous.headerSelected && !next.has(name)) {
     const reason = nativePropertyReadOnlyReason(name, previous.value, index.getTypes(), this.settings.keyMappings, this.nativePropertyTypes);
     const type = Object.entries(this.nativePropertyTypes).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
     next.set(name, { ...previous, readonly: !!reason, readOnlyReason: reason,
      ...(type ? { field: this.nativePropertyField(name, type), ...(previous.inline ? { inline: { ...previous.inline, type } } : {}) } : {}) });
     continue;
    }
    const dirty = previous.pending || this.filePropertyPickerName === name || this.submittedFileProperties.has(name)
     || previous.baseline && isSupportedRawYamlPropertyValue(previous.value)
      && !rawYamlPropertyExpectationsEqual(previous.baseline, { present: true, value: previous.value });
    if (dirty) next.set(name, { ...previous, ...(next.has(name) ? { readonly: next.get(name)!.readonly, readOnlyReason: next.get(name)!.readOnlyReason, field: next.get(name)!.field } : {}) });
   }
   const same = !this.filePropertyUnavailable && next.size === this.fileProperties.size && Array.from(next).every(([name, entry], index) => {
    const previous = this.fileProperties.get(name);
    return name === Array.from(this.fileProperties.keys())[index] && previous !== undefined
     && JSON.stringify(entry.field) === JSON.stringify(previous.field)
     && entry.readonly === previous.readonly && entry.readOnlyReason === previous.readOnlyReason && JSON.stringify(entry.inline) === JSON.stringify(previous.inline)
     && (entry.baseline === previous.baseline || (!!entry.baseline && !!previous.baseline && rawYamlPropertyExpectationsEqual(entry.baseline, previous.baseline)))
     && (Object.is(entry.value, previous.value) || (isSupportedRawYamlPropertyValue(entry.value) && isSupportedRawYamlPropertyValue(previous.value)
      && rawYamlPropertyExpectationsEqual({ present: true, value: entry.value }, { present: true, value: previous.value })));
   });
   this.fileProperties = next;
   this.filePropertyUnavailable = false;
   if (this.fileBodyContext) this.fileBodyContext.filePath = task.primary.filePath;
   if (!same || root.children.length === 0 || JSON.stringify([...this.filePropertyRows.keys()]) !== JSON.stringify([...next.keys()])) {
    if (this.closeFilePropertyAddPicker || (this.filePropertyPickerName && next.has(this.filePropertyPickerName))) {
     // Keep the active picker and its uncommitted input. Structural changes wait for close.
     for (const [name, surface] of this.filePropertyRows) {
      if (name === this.filePropertyPickerName) continue;
      if (next.has(name)) this.refreshFilePropertyValue(name);
      else { surface.row.hidden = true; surface.action.disabled = true; }
     }
    } else this.renderDesktopFileProperties(root);
   }
  } catch {
   if (generation !== this.filePropertyGeneration || this.disposed || root !== this.filePropertyRoot) return;
   root.removeAttribute('aria-busy');
   this.filePropertyUnavailable = true;
   this.renderDesktopFileProperties(root);
  }
  this.refreshDesktopPropertyGroupState(root);
 }

 private nativePropertyType(name: string): InlinePropertyType | undefined {
  const mapping = this.settings.keyMappings.find(item => [item.canonicalKey, item.visiblePropertyName].some(alias => alias.toLowerCase() === name.toLowerCase()));
  const aliases = [name, ...(mapping ? [mapping.canonicalKey, mapping.visiblePropertyName] : [])].map(alias => alias.toLowerCase());
  const known = Object.keys(this.nativePropertyTypes).find(key => aliases.includes(key.toLowerCase()));
  return known ? this.nativePropertyTypes[known] : undefined;
 }

 private nativePropertyField(name: string, type: InlinePropertyType): TableFilePropertyField {
  return { key: encodeFilePropertyColumnKey(name)!, label: name, propertyName: name, type, sourceType: type === 'list' ? 'multitext' : type,
   group: 'fileProperty', icon: type === 'checkbox' ? getCheckboxPropertyTypeIcon(this.settings.keyMappings, name) : getNativePropertyIcon(this.settings.keyMappings, name, getTableFilePropertyTypeIcon(type)), readonly: false, aliases: [], sourceFileCount: 1 };
 }

 private canEditFileProperty(entry: EditorFileProperty): boolean {
  if (!entry || this.filePropertyUnavailable || entry.readonly || !entry.baseline) return false;
  if (isEmptyFilePropertyValue(entry.value)) return true;
  try { encodeVaultPropertyValue(entry.value as VaultPropertyValue, entry.field.type as InlinePropertyType); return true; }
  catch { return false; }
 }

 private renderDesktopFileProperties(root: HTMLElement): void {
  const activeElement = root.ownerDocument.activeElement;

  const focusedEntry = Array.from(this.filePropertyRows).find(([, entry]) => entry.row.contains(activeElement) || entry.action === activeElement);
  const focusedName = focusedEntry?.[0];
  const focusedValue = focusedEntry?.[1].value.contains(activeElement) ?? false;
  this.closeFilePropertyPicker?.();
  this.closeFilePropertyAddPicker?.();
  cleanupOperonHoverTooltips(root); root.empty();
  for (const { action } of this.filePropertyRows.values()) { cleanupOperonHoverTooltips(action); action.remove(); }
  this.filePropertyRows.clear();
  this.refreshDesktopPropertyGroupState(root);
  const actions = this.filePropertyActions;
  if (!actions) return;
  const group = root;
  if (this.filePropertyUnavailable) group.createDiv({ text: t('taskEditor', 'filePropertiesUnavailable'), cls: 'operon-editor-desktop-file-warning' });
  for (const [name, entry] of this.fileProperties) {
   const action = actions.createEl('button', { cls: 'operon-task-editor-workflow-action-button', attr: { type: 'button' } });
   if (this.additionalPropertyAdd) actions.insertBefore(action, this.additionalPropertyAdd);
   setIcon(action, entry.field.icon); setAccessibleLabelWithoutTooltip(action, name);
   action.disabled = !this.canEditFileProperty(entry);
   this.bindEditorHoverTooltip(action, { content: name, taskColor: () => this.getThemeColor() });
   action.addEventListener('click', () => this.openFilePropertyPicker(name));
   const row = group.createDiv('operon-editor-desktop-property-row'); row.dataset.propertyKey = entry.field.key;
   row.toggleClass('is-list-property', entry.field.type === 'list');
   const label = row.createEl('button', { cls: 'operon-editor-desktop-property-label', attr: { type: 'button' } });
   setIcon(label.createSpan('operon-editor-desktop-property-icon'), entry.field.icon); label.createSpan({ text: name, cls: 'operon-editor-desktop-property-name' });
   const value = row.createDiv('operon-editor-desktop-property-value operon-editor-picker-selected operon-editor-custom-field-selection-row');
   this.filePropertyRows.set(name, { row, value, action });
   this.bindDesktopPropertyInteraction(row, label, value, () => this.openFilePropertyPicker(name, undefined, 'picker', label), () => this.openFilePropertyPicker(name, undefined, 'popover', value), () => { const current = this.fileProperties.get(name); return !!current && this.canEditFileProperty(current); });
   this.refreshFilePropertyValue(name);
  }
  if (focusedName) {
   const restored = this.filePropertyRows.get(focusedName);
   const valueTarget = restored?.row.hidden ? null : restored?.value.querySelector<HTMLElement>('[tabindex="0"]') ?? restored?.value;
   const target = (focusedValue ? valueTarget : null) ?? (restored && !restored.action.disabled && !restored.action.hidden ? restored.action : valueTarget)
    ?? Array.from(this.filePropertyRows.values()).map(surface => !surface.action.disabled && !surface.action.hidden ? surface.action : surface.row.hidden ? null : surface.value.querySelector<HTMLElement>('[tabindex="0"]') ?? surface.value).find(surface => surface !== null) ?? this.additionalPropertyAdd;
   target?.focus({ preventScroll: true });
  }
 }

 private refreshFilePropertyValue(name: string): void {
  const entry = this.fileProperties.get(name), surface = this.filePropertyRows.get(name);
  if (!entry || !surface) return;
  const populated = !isEmptyFilePropertyValue(entry.value);
  surface.row.hidden = !populated;
  this.refreshDesktopPropertyGroupState(surface.row);
  surface.action.hidden = !populated && !entry.baseline?.present && !entry.inline?.present && !entry.headerSelected;
  surface.action.toggleClass('is-active', populated);
  surface.action.disabled = !this.canEditFileProperty(entry);
  const label = surface.row.querySelector<HTMLButtonElement>('.operon-editor-desktop-property-label');
  if (label) { label.disabled = false; label.setAttribute('aria-disabled', String(surface.action.disabled)); }
  surface.value.toggleClass('is-readonly', surface.action.disabled);
  surface.row.querySelector<HTMLElement>('.operon-editor-desktop-property-icon')?.toggleClass('has-value', populated);
  const editable = this.canEditFileProperty(entry);
  const reason = this.filePropertyUnavailable ? 'unavailable' : !editable ? entry.readOnlyReason ?? 'type-conflict' : undefined;
  const automatic = reason === 'automatic';
  surface.row.toggleClass('is-automatic-property', automatic);
  surface.action.toggleClass('is-automatic-property', automatic);
  surface.action.empty();
  const valueIcon = entry.field.type === 'checkbox' ? getCheckboxPropertyIcon(entry.value, entry.field.icon) : entry.field.icon;
  setIcon(surface.action, automatic ? 'shield-alert' : valueIcon);
  const icon = surface.row.querySelector<HTMLElement>('.operon-editor-desktop-property-icon');
  if (icon) { icon.empty(); setIcon(icon, automatic ? 'shield-alert' : valueIcon); }
  if (reason) bindPropertyReadOnlyWarning(surface.action, name, reason, () => this.getThemeColor());
  else this.bindEditorHoverTooltip(surface.action, { content: name, taskColor: () => this.getThemeColor() });
  const labelName = label?.querySelector<HTMLElement>('.operon-editor-desktop-property-name') ?? null;
  if (label) {
   cleanupOperonHoverTooltips(label);
   if (reason) bindPropertyReadOnlyWarning(label, name, reason, () => this.getThemeColor());
   else this.bindTruncatedTextTooltip(labelName);
  }
  cleanupOperonHoverTooltips(surface.value);
  const values = !populated ? [] : Array.isArray(entry.value) && editable ? entry.value.map(item => encodeVaultPropertyValue([item], 'list')) : [this.formatFilePropertyValue(entry.value)];
  const display: EditorFieldDisplay = { canonicalKey: entry.field.key, visiblePropertyName: name, type: entry.field.type as KeyMapping['type'], icon: entry.field.icon };
  this.renderCustomFieldSelection(surface.value, display, editable ? (_value, index) => {
   const next = entry.field.type === 'list' ? (entry.value as (string | number)[]).filter((_item, position) => position !== index) : entry.field.type === 'text' ? '' : null;
   this.setFilePropertyValue(name, next);
   (surface.action.hidden ? this.additionalPropertyAdd : surface.action)?.focus({ preventScroll: true });
  } : null, { values, suppressValueTooltip: !!reason, onActivate: (chip, value, index) => {
   if (reason) { setAccessibleLabelWithoutTooltip(chip, propertyReadOnlyWarningText(name, reason)); return; }
   chip.setAttr('tabindex', '0'); chip.setAttr('role', 'button'); setAccessibleLabelWithoutTooltip(chip, `${name}: ${this.formatCustomFieldDisplayValue(display, value)}`);
   const open = () => this.openFilePropertyPicker(name, value, 'popover', chip, entry.field.type === 'list' ? index : undefined);
   chip.addEventListener('click', event => { if (!(event.target as HTMLElement).closest('button')) open(); });
   chip.addEventListener('keydown', event => { if (event.target === chip && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); open(); } });
   if (this.filePropertyPickerName === name && this.filePropertyPickerValue === value) chip.addClass('is-picker-open');
  } });
  if (reason) bindPropertyReadOnlyWarning(surface.value, name, reason, () => this.getThemeColor());
 }

 private formatFilePropertyValue(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  try { return isSupportedRawYamlPropertyValue(value) ? JSON.stringify(value) : stringifyYaml(value).trim(); }
  catch { return t('taskEditor', 'filePropertyReadOnly', { name: '' }); }
 }

 private setFilePropertyValue(name: string, value: RawYamlPropertyValue): void {
  const entry = this.fileProperties.get(name);
  if (!entry || !this.canEditFileProperty(entry) || !isSupportedRawYamlPropertyValue(entry.value) || !entry.pending && rawYamlPropertyExpectationsEqual({ present: true, value: entry.value }, { present: true, value })) return;
  entry.pending = false;
  entry.value = Array.isArray(value) ? [...value] : value;
  this.refreshFilePropertyValue(name); this.markEdited();
 }

 private getVaultFilePropertySnapshot() {
  const snapshot = createVaultFilePropertySnapshot(this.app, this.filePropertyTypeResolver, { keyMappings: this.settings.keyMappings, nativeListCandidates: true });
  const fields = new Map<string, TableFilePropertyField>();
  const used = new Set([...getNativePropertyIndex(this.app).usedPropertyNames(), ...snapshot.fields.map(field => field.propertyName.toLowerCase()), ...[...this.fileProperties.keys()].map(name => name.toLowerCase())]);
  for (const [name, type] of Object.entries(nativeEditorPropertyTypes(this.nativePropertyTypes, this.settings.keyMappings, this.settings.inlinePropertyDefinitions))) {
   const mapping = this.settings.keyMappings.find(item => [item.canonicalKey, item.visiblePropertyName].some(alias => alias.toLowerCase() === name.toLowerCase()));
   const aliases = [name, ...(mapping ? [mapping.canonicalKey, mapping.visiblePropertyName] : [])].map(alias => alias.toLowerCase());
   if (!mapping && !aliases.some(alias => used.has(alias))) continue;
   const sourceName = [...this.fileProperties.keys()].find(key => aliases.includes(key.toLowerCase())) ?? name;
   fields.set((mapping?.canonicalKey ?? sourceName).toLowerCase(), this.nativePropertyField(sourceName, type));
  }
  const index = getNativePropertyIndex(this.app);
  // Newly defined custom properties may not occur in any note or the Obsidian type registry yet.
  if (index.typesAvailable()) for (const mapping of this.settings.keyMappings) {
   if (mapping.showInEditor === false || !this.isNativeCustomProperty(mapping.canonicalKey)) continue;
   const identity = mapping.canonicalKey.toLowerCase();
   if (fields.has(identity)) continue;
   const name = mapping.visiblePropertyName || mapping.canonicalKey;
   if (nativePropertyReadOnlyReason(name, undefined, index.getTypes(), this.settings.keyMappings, this.nativePropertyTypes) !== 'automatic') continue;
   fields.set(identity, { ...this.nativePropertyField(name, mapping.type), readonly: true, readOnlyReason: 'automatic', icon: 'shield-alert' });
  }
  if (index.typesAvailable()) for (const field of snapshot.fields) {
   const name = field.propertyName;
   const mapping = this.settings.keyMappings.find(item => [item.canonicalKey, item.visiblePropertyName].some(alias => alias.toLowerCase() === name.toLowerCase()));
   const identity = (mapping?.canonicalKey ?? name).toLowerCase();
   if (fields.has(identity) || snapshot.fields.filter(candidate => candidate.propertyName.toLowerCase() === name.toLowerCase()).length !== 1) continue;
   if (nativePropertyReadOnlyReason(name, undefined, index.getTypes(), this.settings.keyMappings, this.nativePropertyTypes) !== 'automatic') continue;
   fields.set(identity, { ...field, readonly: true, readOnlyReason: 'automatic', icon: 'shield-alert' });
  }
  return { ...snapshot, fields: [...fields.values()] };
 }

 private addFileProperty(name: string): boolean {
  if (this.disposed || this.filePropertyUnavailable || !this.filePropertyRoot || this.fileProperties.has(name)) return false;
  const field = this.getVaultFilePropertySnapshot().fields.find(candidate => candidate.propertyName === name);
  if (!field) return false;
  const value = field.readOnlyReason === 'automatic' ? null : field.type === 'checkbox' ? false : field.type === 'list' ? [] : field.type === 'text' ? '' : null;
  this.closeFilePropertyAddPicker?.();
  this.fileProperties.set(name, { field, baseline: { present: false, value: undefined }, value, pending: true, readonly: field.readonly, readOnlyReason: field.readOnlyReason, headerSelected: field.readOnlyReason === 'automatic',
   ...(this.fileBodyContext?.format === 'inline' ? { inline: { sourceName: name, type: field.type as InlinePropertyType, present: false, state: 'missing' as const } } : {}) });
  this.renderDesktopFileProperties(this.filePropertyRoot);
  return true;
 }

 private openFilePropertyAddPicker(anchor: HTMLButtonElement): void {
  if (this.disposed || this.closeFilePropertyAddPicker) return;
  this.closeActiveWorkflowActionPicker();
  this.closeFilePropertyPicker?.();
  const epoch = ++this.propertyInteractionEpoch;
  const fields = this.additionalPropertyKeys.filter(key => !this.hasWorkflowPickerValue(key))
   .map(key => ({ field: key, label: this.getWorkflowPickerLabel(key), icon: this.resolveWorkflowPickerIcon(key), source: 'workflow' as const }));
  const fileFields = this.filePropertyRoot && !this.filePropertyUnavailable
   ? this.getVaultFilePropertySnapshot().fields
    .filter(field => !Array.from(this.fileProperties).some(([name, entry]) => name.toLowerCase() === field.propertyName.toLowerCase() && !isEmptyFilePropertyValue(entry.value)))
    .map(field => ({ field: field.propertyName, label: field.propertyName, icon: field.icon, iconColor: field.readOnlyReason === 'automatic' ? 'var(--text-error)' : undefined, source: 'file' as const })) : [];
  // Include empty task-local properties even if the vault pool has no candidate for them.
  if (this.filePropertyRoot && !this.filePropertyUnavailable) for (const [name, entry] of this.fileProperties) {
   if (isEmptyFilePropertyValue(entry.value) && this.canEditFileProperty(entry) && !fileFields.some(field => field.field === name)) {
    fileFields.push({ field: name, label: name, icon: entry.field.icon, iconColor: undefined, source: 'file' });
   }
  }
  let selected: { field: string; source: 'workflow' | 'file' } | null = null;
  anchor.addClass('is-picker-open');
  this.closeFilePropertyAddPicker = showSearchableFieldPicker(anchor, {
   ...resolveSurfaceFloatingHostOptions(anchor), value: null, fields: [...fields, ...fileFields],
   placeholder: t('taskEditor', 'searchFileProperties'), ariaLabel: t('taskEditor', 'addFileProperty'),
   noMatchesText: t('taskEditor', 'noAvailableFileProperties'),
   onSelect: option => { selected = option; },
   onClose: () => {
    this.closeFilePropertyAddPicker = null; anchor.removeClass('is-picker-open');
    getOwnerWindow(anchor).requestAnimationFrame(() => {
     if (this.disposed || !anchor.isConnected || this.propertyInteractionEpoch !== epoch) return;
     if (selected?.source === 'workflow') this.openWorkflowPickerFromAction(selected.field, anchor);
     else if (selected?.source === 'file') {
      if (this.fileProperties.has(selected.field) || this.addFileProperty(selected.field)) this.openFilePropertyPicker(selected.field, undefined, 'picker', anchor);
     } else { anchor.focus({ preventScroll: true }); void this.refreshDesktopFileProperties(); }
    });
   },
  });
 }

 private openFilePropertyPicker(name: string, value?: string, textEditRoute: 'picker' | 'popover' = 'picker', anchor?: HTMLElement, editListIndex?: number): void {
  const entry = this.fileProperties.get(name), surface = this.filePropertyRows.get(name);
  if (!entry || !surface || !this.canEditFileProperty(entry)) return;
  const epoch = ++this.propertyInteractionEpoch;
  for (const prior of this.filePropertyRows.values()) {
   prior.action.removeClass('is-picker-open');
   for (const element of Array.from(prior.row.querySelectorAll('.is-picker-open'))) element.removeClass('is-picker-open');
  }
  this.closeFilePropertyPicker?.();
  const pickerAnchor = anchor ?? (surface.action.hidden ? this.additionalPropertyAdd : surface.action);
  if (!pickerAnchor) return;
  this.filePropertyPickerName = name; this.filePropertyPickerValue = value ?? null; pickerAnchor.addClass('is-picker-open'); surface.action.addClass('is-picker-open');
  let closePicker: (() => void) | null = null;
  const close = () => {
   if (this.closeFilePropertyPicker !== closePicker) return;
   this.closeFilePropertyPicker = null; this.filePropertyPickerName = null; this.filePropertyPickerValue = null;
   if (this.readSource) void this.refreshTaskSource();
   surface.action.removeClass('is-picker-open'); pickerAnchor.removeClass('is-picker-open'); this.refreshFilePropertyValue(name);
   if (this.fileProperties.get(name)?.pending) this.fileProperties.delete(name);
   if (!this.disposed) void this.refreshDesktopFileProperties();
   if (!this.disposed && this.propertyInteractionEpoch === epoch) (surface.row.hidden ? this.additionalPropertyAdd : pickerAnchor.isConnected ? pickerAnchor : surface.value)?.focus({ preventScroll: true });
  };
  closePicker = openTableFilePropertyPicker({
   app: this.app, anchor: pickerAnchor, field: entry.field, label: name, textEditRoute,
   cellValue: { present: entry.baseline?.present ?? true, rawValue: entry.value, normalizedValue: isEmptyFilePropertyValue(entry.value) ? '' : String(entry.value) },
   candidates: this.getVaultFilePropertySnapshot().getCandidates(entry.field.key), settings: this.settings, sourcePath: this.fileBodyContext?.filePath ?? '', lifecycleOwner: surface.action, preserveListValues: true, nativeList: true, editListIndex,
   onMutation: mutation => { this.setFilePropertyValue(name, mutation.kind === 'delete' ? entry.field.type === 'text' ? '' : entry.field.type === 'list' ? [] : null : mutation.value); },
   onClose: close,
  });
  this.closeFilePropertyPicker = closePicker;
 }

	private renderDesktopPropertyGroup(root: HTMLElement, key: TaskEditorSectionId, keys: readonly string[]): HTMLElement {
		const group = root.createDiv('operon-editor-group operon-task-editor-workflow-surface operon-editor-desktop-property-group');
		group.dataset.propertyGroup = key;
		const header = group.createDiv('operon-editor-desktop-group-header');
		header.createDiv({ text: this.desktopSectionLabel(key), cls: 'operon-editor-core-title-badge operon-editor-desktop-group-title' });
		const actions = header.createDiv('operon-task-editor-workflow-actions');
		this.renderWorkflowPickerActions(actions, keys.map(field => ({ key: field, visible: true })), false);
		if (key === 'additional') {
			this.filePropertyActions = actions;
			const add = actions.createEl('button', { cls: 'operon-task-editor-workflow-action-button operon-editor-file-property-add', attr: { type: 'button' } });
			setIcon(add, 'plus');
			setAccessibleLabelWithoutTooltip(add, t('taskEditor', 'addFileProperty'));
			this.bindTaskEditorTooltip(add, t('taskEditor', 'addFileProperty'));
			this.additionalPropertyAdd = add;
			add.addEventListener('click', () => this.openFilePropertyAddPicker(add));
		}

		for (const field of keys) {
			const row = group.createDiv('operon-editor-desktop-property-row');
			row.dataset.propertyKey = field;
			const listField = ['contexts', 'tags', 'links', 'assignees', 'subtasks', 'blocking', 'blockedBy', 'related', 'reminderDatetimes', 'reminderRules'].includes(field)
				|| getCustomFieldMapping(this.settings.keyMappings, field)?.type === 'list'
				|| getManagedTaskDataFieldPicker(field, this.settings.keyMappings)?.type === 'list';
			row.toggleClass('is-list-property', listField);
			const label = row.createEl('button', { cls: 'operon-editor-desktop-property-label', attr: { type: 'button' } });
			setIcon(label.createSpan('operon-editor-desktop-property-icon'), this.resolveWorkflowPickerIcon(field));
			label.createSpan({ text: this.getWorkflowPickerLabel(field), cls: 'operon-editor-desktop-property-name' });
			const value = row.createDiv('operon-editor-desktop-property-value');
			const core = DESKTOP_CORE_FIELDS.has(field);
			this.desktopPropertyRows.set(field, { row, value, core, signature: '' });
			this.bindDesktopPropertyInteraction(row, label, value, () => this.openWorkflowPickerFromAction(field, label), () => this.openDesktopPropertyValue(field, value, label), () => field !== 'datetimeEnd' || !!this.fieldValues['datetimeStart']);
			if (core) {
				row.addClass('operon-editor-desktop-core-property');
				this.renderDesktopCoreProperty(value, field);
				this.addDesktopCoreClear(value, field);
				for (const input of Array.from(value.querySelectorAll('input'))) setAccessibleLabelWithoutTooltip(input, this.getWorkflowPickerLabel(field));
				row.addEventListener('focusout', () => {
					getOwnerWindow(row).requestAnimationFrame(() => {
						if (row.isConnected && !this.disposed) this.refreshDesktopPropertyRows();
					});
				});
			}
		}
		this.refreshDesktopPropertyGroupState(group);
		return group;
	}

	private refreshDesktopPropertyGroupState(container: HTMLElement): void {
		const group = container.closest<HTMLElement>('.operon-editor-desktop-property-group');
		if (!group) return;
		group.toggleClass('is-empty-property-group', Array.from(group.querySelectorAll<HTMLElement>('.operon-editor-desktop-property-row')).every(row => row.hidden));
	}

	private bindDesktopPropertyInteraction(
		row: HTMLElement, label: HTMLButtonElement, value: HTMLElement,
		openLabel: () => void, openValue: () => void, canEdit: () => boolean,
	): void {
		setAccessibleLabelWithoutTooltip(label, label.textContent ?? '');
		this.bindTruncatedTextTooltip(label.querySelector<HTMLElement>('.operon-editor-desktop-property-name'));
		label.addEventListener('click', () => { if (!this.disposed && canEdit()) openLabel(); });
		value.addEventListener('click', () => { if (canEdit()) this.propertyInteractionEpoch += 1; }, true);
		value.tabIndex = 0;
		value.setAttribute('role', 'group');
		setAccessibleLabelWithoutTooltip(value, label.textContent ?? '');
		value.addEventListener('click', event => {
			if (this.disposed || !canEdit() || event.defaultPrevented) return;
			const target = event.target as HTMLElement;
			if (target.closest('button, input, select, textarea, a, [contenteditable="true"], [role="button"]')) return;
			openValue();
		});
		value.addEventListener('keydown', event => {
			if (event.target !== value || (event.key !== 'Enter' && event.key !== ' ')) return;
			event.preventDefault();
			if (!this.disposed && canEdit()) openValue();
		});
		row.addClass('operon-editor-interactive-property-row');
	}

	private openDesktopPropertyValue(key: string, value: HTMLElement, label: HTMLButtonElement): void {
		const custom = getCustomFieldMapping(this.settings.keyMappings, key);
		if (custom?.type === 'text') {
			this.closeActiveWorkflowActionPicker();
			const epoch = ++this.propertyInteractionEpoch;
			value.addClass('is-picker-open');
			let closePicker: (() => void) | null = null;
			closePicker = openTaskFieldPicker({
				app: this.app, anchor: value, settings: this.settings, allTasks: this.indexer.getAllTasks(),
				canonicalKey: key, currentFieldValues: { ...this.fieldValues }, currentTags: [...this.tags],
				sourcePath: this.existingTask?.filePath ?? '', multilineEditorOwner: value,
				onCommit: payload => this.commitWorkflowActionPayload(payload),
				onClose: () => {
					if (this.workflowActionPickerClose !== closePicker) return;
					this.workflowActionPickerClose = null; value.removeClass('is-picker-open');
					if (this.readSource) void this.refreshTaskSource();
					if (!this.disposed && this.propertyInteractionEpoch === epoch) {
						const target = value.closest<HTMLElement>('.operon-editor-desktop-property-row')?.hidden ? this.getWorkflowActionFocusTarget(key) : value.isConnected ? value : label;
						target?.focus({ preventScroll: true });
					}
				},
			});
			this.workflowActionPickerClose = closePicker;
			return;
		}
		const control = value.querySelector<HTMLButtonElement>('.operon-icon-trigger, .operon-color-swatch, .operon-editor-repeat-trigger, .operon-editor-picker-button');
		if (DESKTOP_CORE_FIELDS.has(key) && control && !control.disabled) control.click();
		else this.openWorkflowPickerFromAction(key, label);
	}

	private addDesktopCoreClear(value: HTMLElement, key: string): void {
		const control = value.querySelector<HTMLElement>('.operon-icon-trigger, .operon-color-swatch, .operon-editor-repeat-trigger, .operon-editor-estimate-input-shell, .operon-editor-picker-button');
		if (!control?.parentElement) return;
		const token = control.ownerDocument.win.createDiv('operon-editor-value-token');
		control.parentElement.insertBefore(token, control); token.appendChild(control);
		const clear = token.createEl('button', { cls: 'operon-editor-value-clear', attr: { type: 'button' } });
		token.addClass('has-visible-clear');
		setIcon(clear, 'x'); setAccessibleLabelWithoutTooltip(clear, t('taskEditor', 'removeValue', { value: this.getWorkflowPickerLabel(key) }));
		clear.addEventListener('click', event => {
			event.preventDefault(); event.stopPropagation();
			if (!this.hasWorkflowPickerValue(key)) return;
			const patch: Record<string, string> = { [key]: '' };
			if (key === 'repeat') {
				Object.assign(patch, { datetimeRepeatEnd: '', repeatSeriesId: '', repeatOccurrenceDate: '' });
				this.inlineCompletionMode = DEFAULT_INLINE_REPEAT_COMPLETION_MODE;
			}
			this.commitWorkflowActionPayload(patch);
			this.workflowActionButtons.get(key)?.focus({ preventScroll: true });
		});
	}

	private renderDesktopCoreProperty(value: HTMLElement, key: string): void {
		switch (key) {
			case 'taskIcon': this.renderIconControl(value); break;
			case 'taskColor': this.renderColorControl(value); break;
			case 'status': this.renderStatusControl(value); break;
			case 'priority': this.renderPriorityControl(value); break;
			case 'repeat': this.renderRepeatControl(value); break;
			case 'estimate': this.renderEstimateControl(value); break;
			case 'datetimeStart':
			case 'datetimeEnd': this.renderDatetimeControl(value, key, this.getWorkflowPickerLabel(key)); break;
			default: this.renderDateControl(value, key, this.getWorkflowPickerLabel(key));
		}
	}

	private refreshDesktopPropertyRows(): void {
		const groups = new Set<HTMLElement>();
		for (const [key, entry] of this.desktopPropertyRows) {
			if (this.readSource && entry.value.contains(entry.value.ownerDocument.activeElement)) continue;
			if (entry.row.parentElement) groups.add(entry.row.parentElement);
			const hasValue = this.hasWorkflowPickerValue(key);
			this.refreshDesktopPropertyIcon(key, entry.row, hasValue);
			entry.row.hidden = !hasValue && !(entry.core && entry.row.contains(entry.row.ownerDocument.activeElement));
			const label = entry.row.querySelector<HTMLButtonElement>('.operon-editor-desktop-property-label');
			if (label) label.disabled = (key === 'datetimeEnd' && !this.fieldValues['datetimeStart']) || (key === 'subtasks' && !this.getCurrentOperonId());
			entry.value.toggleClass('is-readonly', label?.disabled ?? false);
			const clear = entry.value.querySelector<HTMLButtonElement>('.operon-editor-value-clear');
			if (clear) {
				clear.hidden = !hasValue;
				clear.parentElement?.toggleClass('has-visible-clear', hasValue);
			}
			if (entry.core) continue;
			const signature = JSON.stringify([
				key === 'subtasks' ? this.getWorkflowSubtaskIds() : key === 'tags' ? this.tags : this.fieldValues[key],
				this.isSystemReminderWorkflowKey(key) ? REMINDER_RULE_ANCHORS.map(anchor => this.fieldValues[anchor]) : null,
			]);
			if (entry.signature === signature) continue;
			entry.signature = signature;
			if (key === 'subtasks') {
				this.desktopSubtaskToggleNeedsFocus = entry.value.querySelector('.operon-editor-subtasks-more') === entry.value.ownerDocument.activeElement;
				this.clearDesktopSubtaskLayout();
			}
			cleanupOperonHoverTooltips(entry.value);
			entry.value.empty();
			if (!hasValue) {
				if (key === 'subtasks' && this.desktopSubtaskToggleNeedsFocus) {
					this.desktopSubtaskToggleNeedsFocus = false;
					this.workflowActionButtons.get(key)?.focus();
				}
				continue;
			}
			const managed = getManagedTaskDataFieldPicker(key, this.settings.keyMappings);
			const custom = getCustomFieldMapping(this.settings.keyMappings, key);
			if (managed) this.renderManagedTaskDataWorkflowPicker(entry.value, managed);
			else if (custom && isProjectedCustomFieldType(custom)) this.renderCustomWorkflowPicker(entry.value, custom);
			else this.renderWorkflowPicker(entry.value, key);
		}
		for (const group of groups) this.refreshDesktopPropertyGroupState(group);
		this.refreshWorkflowActionButtonStates();
	}

	private refreshDesktopPropertyIcon(key: string, row: HTMLElement, hasValue: boolean): void {
		const icon = row.querySelector<HTMLElement>('.operon-editor-desktop-property-icon');
		if (!icon) return;
		const selected = key === 'taskIcon' ? this.fieldValues['taskIcon']?.trim() : '';
		const iconId = selected && getIcon(selected) ? selected : this.resolveWorkflowPickerIcon(key);
		if (icon.dataset.iconId !== iconId) {
			setIcon(icon, iconId);
			icon.dataset.iconId = iconId;
		}
		icon.toggleClass('has-value', hasValue);
		const color = key === 'taskColor' ? this.fieldValues['taskColor']?.trim().replace(/^#/, '') : '';
		if (color && /^[0-9a-f]{6}$/i.test(color)) icon.style.color = `#${color}`;
		else icon.style.removeProperty('color');
	}

	private clearDesktopSubtaskLayout(): void {
		this.desktopSubtaskLayoutCleanup?.();
		this.desktopSubtaskLayoutCleanup = null;
	}

	private setupDesktopSubtaskLayout(selectedWrap: HTMLElement): void {
		this.clearDesktopSubtaskLayout();
		const owner = getOwnerWindow(selectedWrap);
		const button = selectedWrap.parentElement!.createEl('button', {
			cls: 'operon-editor-subtasks-more',
			attr: { type: 'button', 'aria-expanded': String(this.desktopSubtasksExpanded) },
		});
		const buttonLabel = button.createSpan();
		const buttonIcon = button.createSpan('operon-editor-subtasks-more-icon');
		button.hidden = true;
		let frame: number | null = null;
		let stopped = false;
		const layout = () => {
			frame = null;
			if (stopped || !selectedWrap.isConnected || this.disposed) return;
			const chips = Array.from(selectedWrap.children) as HTMLElement[];
			const focusedChip = chips.findIndex(chip => chip.contains(selectedWrap.ownerDocument.activeElement));
			for (const chip of chips) chip.hidden = false;
			const tops: number[] = [];
			let visibleCount = chips.length;
			for (let index = 0; index < chips.length; index += 1) {
				const top = chips[index].getBoundingClientRect().top;
				if (!tops.some(rowTop => Math.abs(rowTop - top) < 1)) tops.push(top);
				if (tops.length > 3) { visibleCount = index; break; }
			}
			const hiddenCount = chips.length - visibleCount;
			for (let index = visibleCount; index < chips.length; index += 1) chips[index].hidden = !this.desktopSubtasksExpanded;
			button.hidden = hiddenCount === 0;
			buttonLabel.setText(this.desktopSubtasksExpanded ? t('taskEditor', 'showLess') : t('taskEditor', 'moreValues', { count: String(hiddenCount) }));
			setIcon(buttonIcon, this.desktopSubtasksExpanded ? 'chevron-up' : 'chevron-down');
			button.setAttr('aria-expanded', String(this.desktopSubtasksExpanded));
			setAccessibleLabelWithoutTooltip(button, this.desktopSubtasksExpanded ? t('taskEditor', 'showLess') : t('taskEditor', hiddenCount === 1 ? 'showMoreSubtasksOne' : 'showMoreSubtasksMany', { count: String(hiddenCount) }));
			if (this.desktopSubtaskToggleNeedsFocus || (button.hidden && button.ownerDocument.activeElement === button) || (!this.desktopSubtasksExpanded && focusedChip >= visibleCount)) {
				this.desktopSubtaskToggleNeedsFocus = false;
				if (button.hidden) this.workflowActionButtons.get('subtasks')?.focus();
				else button.focus();
			}
		};
		const schedule = () => {
			if (!stopped && frame === null) frame = owner.requestAnimationFrame(layout);
		};
		button.addEventListener('click', () => {
			this.desktopSubtasksExpanded = !this.desktopSubtasksExpanded;
			schedule();
		});
		const Observer = (owner as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
		const observer = Observer ? new Observer(schedule) : null;
		observer?.observe(selectedWrap);
		for (const chip of Array.from(selectedWrap.children)) observer?.observe(chip);
		owner.addEventListener('resize', schedule);
		selectedWrap.ownerDocument.fonts?.addEventListener('loadingdone', schedule);
		void selectedWrap.ownerDocument.fonts?.ready.then(schedule);
		this.desktopSubtaskLayoutCleanup = () => {
			stopped = true;
			if (frame !== null) owner.cancelAnimationFrame(frame);
			observer?.disconnect();
			owner.removeEventListener('resize', schedule);
			selectedWrap.ownerDocument.fonts?.removeEventListener('loadingdone', schedule);
			button.remove();
		};
		schedule();
	}

	private renderQuickFinishButton(container: HTMLElement): void {
		if (this.isNewTask) return;
		const button = container.createEl('button', {
			cls: 'operon-task-editor-workflow-action-button operon-editor-quick-finish',
			attr: { type: 'button' },
		});
		this.refreshQuickFinishControl = () => {
			const status = resolveWorkflowStatus(this.settings.pipelines, this.fieldValues['status']);
			const done = this.isTaskFinished();
			const label = t('taskEditor', done ? 'finished' : 'clickToFinish');
			const configuredIcon = status?.definition.pipelineStatusIcon?.trim();
			button.empty();
			setIcon(button, configuredIcon && getIcon(configuredIcon) ? configuredIcon : getFallbackStateIcon(this.settings, done ? 'done' : this.checkbox) || 'square');
			button.setAttribute('aria-disabled', String(done || this.quickFinishInProgress));
			setAccessibleLabelWithoutTooltip(button, label);
			this.bindTaskEditorTooltip(button, label);
		};
		button.addEventListener('click', () => { runAsyncAction('task editor quick finish failed', () => this.finishFromHeader()); });
		this.refreshQuickFinishControl();
	}

	private isTaskFinished(): boolean {
		return this.checkbox === 'done' || resolveWorkflowStatus(this.settings.pipelines, this.fieldValues['status'])?.checkbox === 'done';
	}

	private async finishFromHeader(): Promise<void> {
		if (this.isNewTask || this.disposed || this.deleteInProgress || this.quickFinishInProgress || this.isTaskFinished()) return;
		this.quickFinishInProgress = true;
		this.refreshQuickFinishControl?.();
		try {
			if (this.persistInFlight) await this.persistInFlight;
			if (this.disposed || this.deleteInProgress || this.isTaskFinished()) return;
			const previous = { status: this.fieldValues['status'], dateCompleted: this.fieldValues['dateCompleted'], dateCancelled: this.fieldValues['dateCancelled'] };
			const previousCheckbox = this.checkbox;
			const wasEdited = this.hasBeenEdited;
			if (!this.applyTerminalDateDraftChange('dateCompleted', localToday())) return;
			this.refreshWorkflowPickerSurfaceValues();
			this.markEdited();
			const version = this.editVersion;
			const outcome = await this.persistEditorState('explicit-save');
			if (!outcome.ok && this.editVersion === version) {
				for (const [key, value] of Object.entries(previous)) {
					if (value === undefined) delete this.fieldValues[key]; else this.fieldValues[key] = value;
				}
				this.checkbox = previousCheckbox;
				this.hasBeenEdited = wasEdited;
				this.refreshWorkflowPickerSurfaceValues();
				this.refreshSchedulingDraftControls();
				this.refreshMobileCoreButtons();
			}
		} finally {
			this.quickFinishInProgress = false;
			this.refreshQuickFinishControl?.();
		}
	}

	private renderCopyOperonIdButton(container: HTMLElement): void {
		const currentOperonId = this.getCurrentOperonId();
		if (!currentOperonId) return;

		const copyLinkButton = container.createEl('button', {
			cls: 'operon-task-editor-title-copy-id operon-task-editor-workflow-action-button',
			attr: { type: 'button' },
		});
		setIcon(copyLinkButton, 'file-box');
		const copyLinkLabel = 'Copy task wikilink';
		setAccessibleLabelWithoutTooltip(copyLinkButton, copyLinkLabel);
		this.bindTaskEditorTooltip(copyLinkButton, copyLinkLabel);
		copyLinkButton.addEventListener('click', () => { void this.copyCurrentTaskWikilink(copyLinkButton); });

		const copyCardButton = container.createEl('button', {
			cls: 'operon-task-editor-title-copy-id operon-task-editor-workflow-action-button operon-task-editor-copy-card',
			attr: { type: 'button' },
		});
		setIcon(copyCardButton, 'id-card');
		const copyCardLabel = t('taskEditor', 'copyTaskCardEmbed');
		setAccessibleLabelWithoutTooltip(copyCardButton, copyCardLabel);
		this.bindTaskEditorTooltip(copyCardButton, copyCardLabel);
		copyCardButton.addEventListener('click', () => { void this.copyCurrentTaskCardEmbed(copyCardButton); });

		const copyOperonIdButton = container.createEl('button', {
			cls: 'operon-task-editor-title-copy-id operon-task-editor-workflow-action-button',
			attr: {
				type: 'button',
			},
		});
		setAccessibleLabelWithoutTooltip(copyOperonIdButton, t('contextMenu', 'copyOperonId'));
		const copyIcon = getIcon('fingerprint-pattern') ?? getIcon('fingerprint');
		if (copyIcon) {
			copyOperonIdButton.appendChild(copyIcon);
		}
		copyOperonIdButton.addEventListener('click', () => {
			void this.copyCurrentOperonId();
		});
		this.bindTaskEditorTooltip(copyOperonIdButton, `${t('contextMenu', 'copyOperonId')}\n${currentOperonId}`);
	}

	private renderCoreActionButtons(container: HTMLElement): void {
		const getIsPinned = () => this.pinnedCache && this.taskOperonId
			? this.pinnedCache.isPinned(this.taskOperonId)
			: false;

		this.renderCoreTrackerActionButton(container);


		if (!this.isPhone && this.onSetHideScrollbars) {
			const button = container.createEl('button', {
				cls: 'operon-editor-core-action-btn operon-editor-core-scrollbars-action',
				attr: { type: 'button' },
			});
			setIcon(button, 'mouse');
			let tooltip = '';
			const refresh = () => {
				if (this.disposed) return;
				const hidden = this.settings.workspaceTweaksHideScrollbars;
				button.classList.toggle('is-active', hidden);
				button.setAttr('aria-pressed', String(hidden));
				button.setAttr('aria-disabled', String(this.scrollbarsSavePending));
				const label = hidden ? t('settings', 'workspaceTweaksShowScrollbars') : t('settings', 'workspaceTweaksHideScrollbars');
				setAccessibleLabelWithoutTooltip(button, label);
				if (tooltip !== label) {
					tooltip = label;
					this.bindTaskEditorTooltip(button, label);
				}
			};
			button.addEventListener('focus', refresh);
			button.addEventListener('mouseenter', refresh);
			button.addEventListener('click', () => {
				runAsyncAction('task editor scrollbars setting save failed', async () => {
					if (this.disposed || this.scrollbarsSavePending || !this.onSetHideScrollbars) return;
					this.scrollbarsSavePending = true;
					refresh();
					try {
						await this.onSetHideScrollbars(!this.settings.workspaceTweaksHideScrollbars);
					} catch (error) {
						new Notice(t('settings', 'settingsWriteProtected'));
						throw error;
					} finally {
						this.scrollbarsSavePending = false;
						refresh();
					}
				});
			});
			// Tweaks applies its shared setting to the document body, including external changes.
			const Observer = button.ownerDocument.defaultView?.MutationObserver;
			this.scrollbarsObserver?.disconnect();
			if (Observer) {
				this.scrollbarsObserver = new Observer(refresh);
				this.scrollbarsObserver.observe(button.ownerDocument.body, { attributes: true, attributeFilter: ['class'] });
			}
			refresh();
		}

		const pinBtn = container.createEl('button', {
			cls: 'operon-editor-core-action-btn',
			attr: { type: 'button' },
		});

		const renderPin = () => {
			pinBtn.empty();
			const icon = getIcon('pin');
			if (icon) pinBtn.appendChild(icon);
			else pinBtn.setText('📌');
			const isPinned = getIsPinned();
			const isAvailable = !!this.pinnedCache && !!this.taskOperonId;
			const label = isPinned ? t('buttons', 'unpin') : t('buttons', 'pin');
			setAccessibleLabelWithoutTooltip(pinBtn, label);
			this.bindTaskEditorTooltip(pinBtn, label);
			pinBtn.classList.toggle('is-active', isPinned);
			pinBtn.disabled = !isAvailable;
			pinBtn.setAttr('aria-pressed', String(isPinned));
		};

		pinBtn.addEventListener('click', () => {
			if (!this.pinnedCache || !this.taskOperonId) return;
			void this.pinnedCache.toggle(this.taskOperonId).then(() => renderPin());
		});
		this.refreshCorePinControl = renderPin;
		renderPin();

		const checkboxLabel = t('taskEditor', 'showCheckboxes');
		const checkboxBtn = container.createEl('button', {
			cls: 'operon-editor-core-action-btn operon-editor-core-checkbox-popover-action',
			attr: { type: 'button' },
		});
		setIcon(checkboxBtn, 'layout-list');
		setAccessibleLabelWithoutTooltip(checkboxBtn, checkboxLabel);
		this.bindTaskEditorTooltip(checkboxBtn, checkboxLabel);
		checkboxBtn.addEventListener('click', () => {
			runAsyncAction('task editor checkbox popover open failed', async () => {
				await this.openTaskEditorCheckboxPopover(checkboxBtn);
			});
		});

		const subtaskLabel = t('buttons', resolveSubtaskActionLabelKeyForKind(this.subtaskActionKind));
		const subtaskBtn = container.createEl('button', {
			cls: 'operon-editor-core-action-btn operon-editor-core-subtask-action',
			attr: {
				type: 'button',
			},
		});
		const subtaskIcon = getIcon(resolveSubtaskActionIconForKind(this.subtaskActionKind)) ?? getIcon('plus');
		if (subtaskIcon) subtaskBtn.appendChild(subtaskIcon);
		else subtaskBtn.setText('+');
		setAccessibleLabelWithoutTooltip(subtaskBtn, subtaskLabel);
		this.bindTaskEditorTooltip(subtaskBtn, subtaskLabel);
		subtaskBtn.addEventListener('click', () => {
			void this.requestSubtask();
		});

		if (!this.usesMobileLayout && !this.isNewTask && this.fileBodyContext?.format === 'yaml') {
			const inlineLabel = t('buttons', 'addInlineSubtask');
			const inlineButton = container.createEl('button', {
				cls: 'operon-editor-core-action-btn operon-editor-core-inline-subtask-action',
				attr: { type: 'button' },
			});
			setIcon(inlineButton, resolveSubtaskActionIconForKind('inline'));
			setAccessibleLabelWithoutTooltip(inlineButton, inlineLabel);
			this.bindTaskEditorTooltip(inlineButton, inlineLabel);
			inlineButton.addEventListener('click', () => { void this.requestSubtask('inline'); });
		}
	}

	private readonly handleCheckboxSourceSaved = (filePath: string, content: string): void => {
		if (this.disposed || this.fileBodyContext?.filePath !== filePath) return;
		const { body } = splitFrontmatterDocument(content);
		if (body === this.persistedFileBodyDraft) {
			return;
		}
		this.checkboxBodyRevision++;
		this.fileBodyDraft = body;
		this.persistedFileBodyDraft = body;
		this.fileBodyContext.lineNumberOffset = this.getFrontmatterLineCountFromContent(content);
	};

	private async openTaskEditorCheckboxPopover(anchor: HTMLElement): Promise<void> {
		if (!this.description.trim()) {
			new Notice(t('notifications', 'taskSaveFailed'));
			return;
		}
		if (!this.fieldValues['operonId']) {
			this.fieldValues['operonId'] = generateOperonId();
		}
		const operonId = this.fieldValues['operonId'];
		if (!operonId) return;

		const saved = await this.flushPendingEdits();
		if (!saved) return;

		const indexed = await this.waitForIndexedTask(operonId);
		if (!indexed) {
			new Notice(t('notifications', 'taskNotInIndex'));
			return;
		}

		await showPlainCheckboxPopover(anchor, {
			app: this.app,
			task: indexed,
			keyMappings: this.settings.keyMappings,
			taskColor: this.getThemeColor(),
			seedEmptyDraft: (indexed.plainCheckboxProgress?.total ?? 0) <= 0,
			onSaved: this.handleCheckboxSourceSaved,
			saveListenerSignal: this.checkboxSaveListenerController.signal,
		});
	}

	private renderWorkflowSection(container: HTMLElement): void {
		this.renderCollapsibleSection(
			container,
			t('taskEditor', 'workflow'),
			this.workflowExpanded,
			next => { this.workflowExpanded = next; },
			body => this.renderWorkflowFields(body),
		);
	}

	private renderWorkflowSurface(container: HTMLElement): void {
		const items = this.getRenderableWorkflowPickerItems();
		if (items.length === 0) return;

		const section = container.createDiv('operon-editor-group operon-task-editor-workflow-surface');
		const header = section.createDiv('operon-task-editor-workflow-header');
		header.createDiv({
			text: t('settings', 'taskEditorWorkflowPickers'),
			cls: 'operon-editor-core-title-badge operon-task-editor-workflow-title',
		});

		this.workflowActionsEl = section.createDiv('operon-task-editor-workflow-actions');
		this.workflowRowsEl = section.createDiv('operon-task-editor-workflow-values');
		this.renderWorkflowPickerActions(this.workflowActionsEl, items);
		this.renderFilledWorkflowPickers(this.workflowRowsEl, items);
	}

	private getRenderableWorkflowPickerItems(): TaskEditorWorkflowPickerItem[] {
		const items = this.usesMobileLayout
			? this.settings.taskEditorWorkflowPickers
			: normalizeTaskEditorWorkflowPickers(undefined, undefined, this.settings.keyMappings);
		return items
			.filter(item => item.visible)
			.filter(item => this.canRenderWorkflowPickerKey(item.key));
	}

	private canRenderWorkflowPickerKey(key: string): boolean {
		if (getManagedTaskDataFieldPicker(key, this.settings.keyMappings)) return true;
		const customMapping = getCustomFieldMapping(this.settings.keyMappings, key);
		if (customMapping) return isProjectedCustomFieldType(customMapping);
		return key === 'contexts'
			|| key === 'tags'
			|| key === 'assignees'
			|| key === 'location'
			|| key === 'links'
			|| key === 'reminderDatetimes'
			|| key === 'reminderRules'
			|| key === 'parentTask'
			|| key === 'subtasks'
			|| key === 'blocking'
			|| key === 'blockedBy'
			|| key === 'related';
	}

	private renderWorkflowPickerActions(container: HTMLElement, items = this.getRenderableWorkflowPickerItems(), reset = true): void {
		cleanupOperonHoverTooltips(container);
		container.empty();
		if (reset) this.workflowActionButtons.clear();
		for (const item of items) {
			const label = this.getWorkflowPickerLabel(item.key);
			const button = container.createEl('button', {
				cls: 'operon-task-editor-workflow-action-button',
				attr: {
					type: 'button',
				},
			});
			button.dataset.workflowPickerKey = item.key;
			this.setWorkflowActionButtonIcon(button, item.key);
			setAccessibleLabelWithoutTooltip(button, label);
			button.title = label;
			this.bindTaskEditorTooltip(button, label);
			this.workflowActionButtons.set(item.key, button);
			this.syncWorkflowActionButtonState(item.key, button);
			button.addEventListener('click', event => {
				event.preventDefault();
				this.openWorkflowPickerFromAction(item.key, button);
			});
		}
	}

	private renderFilledWorkflowPickers(container: HTMLElement, items = this.getRenderableWorkflowPickerItems()): void {
		cleanupOperonHoverTooltips(container);
		container.empty();
		let renderedCount = 0;
		for (const item of items) {
			if (!this.hasWorkflowPickerValue(item.key)) continue;
			const managedTaskDataField = getManagedTaskDataFieldPicker(item.key, this.settings.keyMappings);
			const customMapping = getCustomFieldMapping(this.settings.keyMappings, item.key);
			if (managedTaskDataField) {
				this.renderManagedTaskDataWorkflowPicker(container, managedTaskDataField);
			} else if (customMapping && isProjectedCustomFieldType(customMapping)) {
				this.renderCustomWorkflowPicker(container, customMapping);
			} else {
				this.renderWorkflowPicker(container, item.key);
			}
			renderedCount += 1;
		}
		container.toggleClass('is-empty', renderedCount === 0);
	}

	private refreshWorkflowPickerSurfaceValues(): void {
		this.refreshWorkflowActionButtonStates();
		if (this.workflowRowsEl?.hasClass('operon-task-editor-section-layout')) {
			this.refreshDesktopPropertyRows();
			return;
		}
		if (!this.workflowRowsEl) return;
		this.renderFilledWorkflowPickers(this.workflowRowsEl);
	}

	private refreshWorkflowActionButtonStates(): void {
		for (const [key, button] of this.workflowActionButtons) {
			this.syncWorkflowActionButtonState(key, button);
		}
	}

	private setWorkflowActionButtonIcon(button: HTMLButtonElement, key: string): void {
		button.empty();
		const iconWrap = button.createSpan('operon-task-editor-workflow-action-icon');
		const icon = this.resolveWorkflowPickerIcon(key);
		if (icon) {
			setIcon(iconWrap, icon);
			return;
		}
		iconWrap.addClass('operon-task-editor-workflow-action-icon-placeholder');
	}

	private getWorkflowActionFocusTarget(key: string): HTMLButtonElement | null | undefined {
		const button = this.workflowActionButtons.get(key);
		return button?.hidden
			? button.closest('.operon-editor-desktop-property-group')?.querySelector<HTMLButtonElement>('.operon-editor-file-property-add')
			: button;
	}

	private syncWorkflowActionButtonState(key: string, button: HTMLButtonElement): void {
		const active = this.hasWorkflowPickerValue(key);
		const additionalGroup = button.closest<HTMLElement>('.operon-editor-desktop-property-group')?.dataset.propertyGroup === 'additional';
		button.hidden = additionalGroup && !active;
		button.toggleClass('is-active', active);
		button.setAttr('aria-pressed', String(active));
		const locked = key === 'subtasks' && !this.getCurrentOperonId();
		const ruleAddDisabled = key === 'reminderRules'
			&& this.isSystemReminderWorkflowKey(key)
			&& getAvailableReminderRuleAnchors(this.fieldValues).length === 0;
		button.toggleClass('is-locked', locked);
		button.disabled = ruleAddDisabled || (key === 'datetimeEnd' && !(this.fieldValues['datetimeStart'] ?? '').trim());
		button.setAttr('aria-disabled', String(locked || button.disabled));
	}

	private getWorkflowPickerLabel(key: string): string {
		if (key === 'estimate') return t('settings', 'chipEstimate');
		const coreLabels: Record<string, string> = {
			taskIcon: 'taskIcon', taskColor: 'taskColor', status: 'status', priority: 'priority',
			dateStarted: 'started', dateDue: 'dueDate', dateScheduled: 'scheduled',
			datetimeStart: 'datetimeStart', datetimeEnd: 'datetimeEnd',
			repeat: 'repeat', dateCompleted: 'finished', dateCancelled: 'cancelled',
		};
		if (coreLabels[key]) return t('taskEditor', coreLabels[key]);
		const managedTaskDataField = getManagedTaskDataFieldPicker(key, this.settings.keyMappings);
		if (managedTaskDataField) return managedTaskDataField.label;
		const customMapping = getCustomFieldMapping(this.settings.keyMappings, key);
		if (customMapping) return getCustomFieldLabel(customMapping);
		if (key === 'tags') return t('taskEditor', 'tags');
		if (key === 'contexts') return t('taskEditor', 'contexts');
		if (key === 'assignees') return t('taskEditor', 'assignees');
		if (key === 'location') return t('location', 'location');
		if (key === 'links') return t('taskEditor', 'links');
		if (key === 'reminderDatetimes' || key === 'reminderRules') {
			return getVisiblePropertyName(key, this.settings.keyMappings);
		}
		if (key === 'parentTask') return t('taskEditor', 'parentTask');
		if (key === 'subtasks') return t('taskEditor', 'subtasks');
		if (key === 'blocking') return t('taskEditor', 'blocking');
		if (key === 'blockedBy') return t('taskEditor', 'blockedBy');
		if (key === 'related') return t('taskEditor', 'related');
		return key;
	}

	private resolveWorkflowPickerIcon(key: string): string {
		const customMapping = getCustomFieldMapping(this.settings.keyMappings, key);
		if (customMapping) return getCustomFieldIcon(customMapping);
		return getConfiguredKeyMappingIcon(key, this.settings.keyMappings)
			|| (TASK_CREATOR_FALLBACK_FIELD_ICONS as Record<string, string>)[key]
			|| (INLINE_TASK_COMPACT_FALLBACK_ICONS as Record<string, string>)[key]
			|| (key === 'related' ? 'link-2' : '')
			|| 'circle-dot';
	}

	private hasWorkflowPickerValue(key: string): boolean {
		const managedTaskDataField = getManagedTaskDataFieldPicker(key, this.settings.keyMappings);
		if (managedTaskDataField) {
			return this.getManagedTaskDataWorkflowValues(managedTaskDataField).length > 0;
		}
		const customMapping = getCustomFieldMapping(this.settings.keyMappings, key);
		if (customMapping && isProjectedCustomFieldType(customMapping)) {
			const value = normalizeCustomFieldRawValue((this.fieldValues as Record<string, unknown>)[customMapping.canonicalKey]);
			return customMapping.type === 'list'
				? splitTaskListValue(value).length > 0
				: !!value.trim();
		}
		if (key === 'tags') return this.tags.length > 0;
		if (key === 'contexts' || key === 'links' || key === 'assignees' || key === 'reminderDatetimes' || key === 'reminderRules' || key === 'blocking' || key === 'blockedBy' || key === 'related') {
			return splitTaskListValue(this.fieldValues[key]).length > 0;
		}
		if (key === 'parentTask' || key === 'location') return !!(this.fieldValues[key] ?? '').trim();
		if (key === 'subtasks') return this.getWorkflowSubtaskIds().length > 0;
		return !!(this.fieldValues[key] ?? '').trim();
	}

	private getWorkflowSubtaskIds(parentId = this.getCurrentOperonId()): string[] {
		const normalizedParentId = parentId?.trim() ?? '';
		if (!normalizedParentId) return [];
		if (this.workflowDraftSubtaskParentId === normalizedParentId && this.workflowDraftSubtaskIds) {
			return [...this.workflowDraftSubtaskIds];
		}
		return normalizeListValues(Array.from(this.indexer.secondary.getChildIds(normalizedParentId)));
	}

	private openWorkflowPickerFromAction(key: string, button: HTMLButtonElement): void {
		this.propertyInteractionEpoch += 1;
		if (button.hasClass('is-locked')) {
			new Notice(t('taskEditor', 'subtasksSaveFirst'));
			return;
		}

		this.closeActiveWorkflowActionPicker();
		button.addClass('is-picker-open');
		let closePicker: (() => void) | null = null;
		let focusRestoreScheduled = false;
		const restoreReminderActionFocus = () => {
			if (!this.isSystemReminderWorkflowKey(key) || focusRestoreScheduled) return;
			focusRestoreScheduled = true;
			const ownerWindow = button.ownerDocument.defaultView ?? getActiveWindow();
			scheduleTaskEditorReminderFocus({
				ownerWindow,
				fieldKey: key,
				focusIndex: -1,
				getWorkflowRows: () => this.workflowRowsEl,
				getActionButton: () => this.workflowActionButtons.get(key),
				shouldFocus: () => !this.workflowActionPickerClose,
			});
		};
		const handleClose = () => {
			button.removeClass('is-picker-open');
			if (this.workflowActionPickerClose === closePicker) {
				this.workflowActionPickerClose = null;
				if (this.readSource) void this.refreshTaskSource();
			}
			if (!this.disposed && button.hidden) this.getWorkflowActionFocusTarget(key)?.focus({ preventScroll: true });
			restoreReminderActionFocus();
		};

		if (key === 'parentTask') {
			closePicker = this.openParentTaskWorkflowAction(button, handleClose);
		} else if (key === 'subtasks') {
			closePicker = this.openSubtasksWorkflowAction(button, handleClose);
		} else if (key === 'blocking' || key === 'blockedBy') {
			closePicker = this.openDependencyWorkflowAction(button, key, handleClose);
		} else {
			closePicker = openTaskFieldPicker({
				app: this.app,
				settings: this.settings,
				allTasks: this.indexer.getAllTasks(),
				canonicalKey: key,
				manualDatePicker: (this.desktopPropertyRows?.size ?? 0) > 0 ? this.getManualDatePickerOptions(key) : undefined,
				anchor: button,
				currentFieldValues: { ...this.fieldValues },
				getCurrentFieldValues: () => this.fieldValues,
				currentTags: [...this.tags],
				...(this.isSystemReminderWorkflowKey(key) ? {
					reminderOperation: {
						kind: 'add' as const,
					},
				} : {}),
				sourcePath: this.existingTask?.filePath ?? this.fileBodyContext?.filePath ?? '',
				closeListPickerOnSelect: this.shouldCloseWorkflowPickerOnSelect(),
				taskFormat: this.fileBodyContext?.format ?? 'inline',
				repeatInlineCompletionMode: this.inlineCompletionMode,
				onCommit: payload => this.commitWorkflowActionPayload(payload),
				onRepeatInlineCompletionModeChange: mode => {
					this.inlineCompletionMode = normalizeInlineCompletionMode(mode);
				},
				onClose: handleClose,
				onCancel: handleClose,
			});
		}

		if (closePicker) {
			this.workflowActionPickerClose = closePicker;
			return;
		}
		button.removeClass('is-picker-open');
	}

	private closeActiveWorkflowActionPicker(): void {
		const current = this.workflowActionPickerClose;
		this.workflowActionPickerClose = null;
		for (const entry of this.desktopPropertyRows.values()) {
			entry.value.removeClass('is-picker-open');
			entry.row.querySelector('.operon-editor-desktop-property-label')?.removeClass('is-picker-open');
		}
		for (const button of this.workflowActionButtons.values()) {
			button.removeClass('is-picker-open');
		}
		if (current) current();
	}

	private commitWorkflowActionPayload(payload: Record<string, string | string[]>): void {
		if ((this.desktopPropertyRows?.size ?? 0) > 0) {
			const remaining = { ...payload };
			if (typeof remaining.status === 'string') {
				if (remaining.status) {
					if (!this.applyStatusDraftChange(remaining.status)) return;
				} else delete this.fieldValues['status'];
				delete remaining.status;
			}
			for (const key of ['dateCompleted', 'dateCancelled']) {
				const value = remaining[key];
				if (typeof value !== 'string') continue;
				if (!this.applyDateDraftChange(key, value)) return;
				delete remaining[key];
			}
			if (typeof remaining.repeat === 'string' && parseRepeatRule(remaining.repeat) && !this.fieldValues['repeatSeriesId']) {
				remaining.repeatSeriesId = generateRepeatSeriesId();
			}
			payload = remaining;
		}
		const fieldPayload: Record<string, string | string[]> = {};
		for (const [key, value] of Object.entries(payload)) {
			if (key === 'tags') {
				const values = Array.isArray(value) ? value : splitTaskListValue(value);
				this.tags = normalizeListValues(values.map(tag => tag.replace(/^#/, '')));
			} else {
				fieldPayload[key] = value;
			}
		}
		if (Object.keys(fieldPayload).length > 0) {
			this.applyTaskFieldPickerPayload(fieldPayload);
		}
		this.refreshSchedulingDraftControls();
		this.applyThemeColor();
		this.markEdited();
		this.refreshWorkflowPickerSurfaceValues();
	}

	private openParentTaskWorkflowAction(anchor: HTMLElement, onClose: () => void): (() => void) | null {
		const currentTaskId = this.fieldValues['operonId'] ?? this.existingTask?.operonId ?? '';
		const excludedParentIds = new Set<string>();
		if (currentTaskId) {
			excludedParentIds.add(currentTaskId);
			for (const descendantId of this.indexer.secondary.getAllDescendantIds(currentTaskId)) {
				excludedParentIds.add(descendantId);
			}
		}
		return showParentTaskPicker(anchor, {
			rankingTasks: this.indexer.getAllTasks(),
			value: this.fieldValues['parentTask'] ?? '',
			allTasks: this.indexer.getAllTasks().filter(task => !excludedParentIds.has(task.operonId)),
			onSelect: operonId => this.commitWorkflowActionPayload({ parentTask: operonId }),
			onClear: () => this.commitWorkflowActionPayload({ parentTask: '' }),
			onClose,
		});
	}

	private openDependencyWorkflowAction(anchor: HTMLElement, fieldKey: 'blocking' | 'blockedBy', onClose: () => void): (() => void) | null {
		const currentTaskId = this.fieldValues['operonId'] ?? this.existingTask?.operonId ?? '';
		const oppositeFieldKey = fieldKey === 'blocking' ? 'blockedBy' : 'blocking';
		return showDependencyTaskPicker(anchor, {
			fieldKey,
			value: normalizeListValues(splitTaskListValue(this.fieldValues[fieldKey]).filter(id => id !== currentTaskId)).join('; '),
			oppositeValue: this.fieldValues[oppositeFieldKey] ?? '',
			allTasks: this.indexer.getAllTasks(),
			getAllTasks: () => this.indexer.getAllTasks(),
			subscribeIndexUpdates: listener => this.indexer.subscribeIndexUpdates(listener),
			pipelines: this.settings.pipelines,
			keyMappings: this.settings.keyMappings,
			excludedIds: currentTaskId ? [currentTaskId] : [],
			closeOnSelect: this.shouldCloseWorkflowPickerOnSelect(),
			onSave: payload => this.commitWorkflowActionPayload(payload),
			onClose,
		});
	}

	private openSubtasksWorkflowAction(anchor: HTMLElement, onClose: () => void): (() => void) | null {
		const currentTaskId = this.fieldValues['operonId'] ?? this.existingTask?.operonId ?? '';
		if (!currentTaskId) {
			new Notice(t('taskEditor', 'subtasksSaveFirst'));
			return null;
		}

		const excludedIds = new Set<string>([currentTaskId, ...this.collectAncestorIds(currentTaskId)]);
		let selectedIds = this.getWorkflowSubtaskIds(currentTaskId);
		const syncParentLinks = (nextIds: string[]) => {
			const previousIds = selectedIds;
			const normalizedNext = normalizeListValues(nextIds.filter(id => !excludedIds.has(id)));
			if (areStringArraysEqual(previousIds, normalizedNext)) return;
			selectedIds = normalizedNext;
			this.workflowDraftSubtaskParentId = currentTaskId;
			this.workflowDraftSubtaskIds = [...selectedIds];
			const removedIds = previousIds.filter(id => !normalizedNext.includes(id));
			const addedIds = normalizedNext.filter(id => !previousIds.includes(id));
			for (const removedId of removedIds) {
				this.updateExistingSubtaskParent(removedId, null);
			}
			for (const addedId of addedIds) {
				this.updateExistingSubtaskParent(addedId, currentTaskId);
			}
			this.refreshWorkflowPickerSurfaceValues();
		};

		return showSubtasksPicker(anchor, {
			value: selectedIds,
			allTasks: this.indexer.getAllTasks(),
			excludedIds: Array.from(excludedIds),
			closeOnSelect: this.shouldCloseWorkflowPickerOnSelect(),
			onChange: operonIds => syncParentLinks(operonIds),
			onClose,
		});
	}

	private shouldCloseWorkflowPickerOnSelect(): boolean {
		return this.isPhone;
	}

	private renderWorkflowPicker(container: HTMLElement, key: string): void {
		switch (key) {
			case 'contexts':
				this.renderContextsPicker(container);
				break;
			case 'tags':
				this.renderTags(container);
				break;
			case 'assignees':
				this.renderAssigneesPicker(container);
				break;
			case 'location':
				this.renderLocationPicker(container);
				break;
			case 'links':
				this.renderLinksPicker(container);
				break;
			case 'reminderDatetimes':
			case 'reminderRules':
				this.renderReminderWorkflowPicker(container, key);
				break;
			case 'parentTask':
				this.renderParentTaskPicker(container);
				break;
			case 'subtasks':
				this.renderSubtaskPicker(container);
				break;
			case 'blocking':
				this.renderTaskListPicker(container, 'blocking', t('taskEditor', 'blocking'));
				break;
			case 'blockedBy':
				this.renderTaskListPicker(container, 'blockedBy', t('taskEditor', 'blockedBy'));
				break;
			case 'related':
				this.renderRelatedPicker(container);
				break;
		}
	}

	private isSystemReminderWorkflowKey(key: string): key is ReminderPickerFieldKey {
		return (key === 'reminderDatetimes' || key === 'reminderRules')
			&& !getCustomFieldMapping(this.settings.keyMappings, key);
	}

	private renderReminderWorkflowPicker(group: HTMLElement, fieldKey: ReminderPickerFieldKey): void {
		const setting = new Setting(group);
		setting.settingEl.addClass('operon-editor-inline-picker-setting', 'operon-editor-reminder-setting');
		setting.setName(this.getWorkflowPickerLabel(fieldKey));
		const selectedWrap = setting.controlEl.createDiv(
			'operon-editor-picker-selected operon-editor-reminder-selection-row',
		);
		let closePicker: (() => void) | null = null;

		const render = () => {
			selectedWrap.replaceChildren();
			const values = splitTaskListValue(this.fieldValues[fieldKey]);
			selectedWrap.classList.toggle('is-empty', values.length === 0);
			for (const [index, rawValue] of values.entries()) {
				const display = formatReminderDisplayItem({
					app: this.app,
					settings: {
						timeFormat: this.settings.timeFormat,
						dateDisplayFormat: this.settings.dateDisplayFormat,
						keyMappings: this.settings.keyMappings,
					},
					fieldKey,
					rawValue,
					fieldValues: this.fieldValues,
				});
				const chip = createInlineTaskCompactChipElement({
					key: fieldKey,
					label: display.text,
					icon: this.resolveWorkflowPickerIcon(fieldKey),
					iconOnly: false,
					interactive: !group.hasClass('operon-editor-desktop-property-value'),
					colorRole: 'default',
					linkTarget: null,
				}, `operon-editor-compact-selection-chip operon-editor-reminder-chip is-${display.state}`, {
					forceFull: true,
				});
				if (fieldKey === 'reminderDatetimes' && display.state !== 'invalid') this.appendWeekdayHint(chip, rawValue);
				setAccessibleLabelWithoutTooltip(chip, display.ariaLabel);
				chip.dataset.fieldKey = fieldKey;
				chip.dataset.reminderIndex = String(index);
				if (fieldKey === 'reminderRules') this.bindEditorHoverTooltip(chip, {
					title: display.tooltipTitle,
					content: display.tooltipContent,
					taskColor: () => this.getThemeColor(),
				});
				chip.addEventListener('click', event => {
					event.preventDefault();
					openEditPicker(chip, index, rawValue);
				});
				if (group.hasClass('operon-editor-desktop-property-value')) {
					chip.setAttr('role', 'button'); chip.tabIndex = 0;
					chip.addEventListener('keydown', event => {
						if (event.target !== chip || (event.key !== 'Enter' && event.key !== ' ')) return;
						event.preventDefault(); openEditPicker(chip, index, rawValue);
					});
					const remove = chip.createEl('button', { cls: 'operon-editor-compact-selection-chip-remove', attr: { type: 'button' } });
					chip.addClass('has-remove-action');
					setIcon(remove, 'x'); setAccessibleLabelWithoutTooltip(remove, t('taskEditor', 'removeValue', { value: display.text }));
					remove.addEventListener('click', event => {
						event.preventDefault(); event.stopPropagation();
						closePicker?.();
						const result = applyReminderListMutation({ fieldKey, currentValue: this.fieldValues[fieldKey], mutation: { action: 'remove', current: { index, rawValue } } });
						if (!result.ok) { new Notice(t('reminders', 'staleItem')); return; }
						if (result.changed) this.commitWorkflowActionPayload({ [fieldKey]: result.fieldValue });
						this.workflowActionButtons.get(fieldKey)?.focus({ preventScroll: true });
					});
				}
				selectedWrap.appendChild(chip);
			}
		};

		const openEditPicker = (anchor: HTMLElement, index: number, rawValue: string) => {
			if (closePicker) return;
			if (group.hasClass('operon-editor-desktop-property-value')) anchor.addClass('is-picker-open');
			const ownerWindow = anchor.ownerDocument.defaultView ?? getActiveWindow();
			let committed = false;
			let closeHandled = false;
			let focusIndex = index;
			const handleClose = () => {
				if (closeHandled) return;
				closeHandled = true;
				closePicker = null;
				anchor.removeClass('is-picker-open');
				if (committed) this.refreshWorkflowPickerSurfaceValues();
				scheduleTaskEditorReminderFocus({
					ownerWindow,
					fieldKey,
					focusIndex,
					getWorkflowRows: () => this.workflowRowsEl,
					getActionButton: () => this.workflowActionButtons.get(fieldKey),
				});
			};
			closePicker = openTaskFieldPicker({
				app: this.app,
				settings: this.settings,
				allTasks: this.indexer.getAllTasks(),
				canonicalKey: fieldKey,
				anchor,
				currentFieldValues: { ...this.fieldValues },
				getCurrentFieldValues: () => this.fieldValues,
				currentTags: [...this.tags],
				reminderOperation: {
					kind: 'edit',
					item: { index, rawValue },
				},
				onCommit: payload => {
					this.applyTaskFieldPickerPayload(payload);
					this.markEdited();
					committed = true;
					const remaining = splitTaskListValue(this.fieldValues[fieldKey]).length;
					focusIndex = remaining > 0 ? Math.min(index, remaining - 1) : -1;
				},
				onClose: handleClose,
				onCancel: handleClose,
			});
		};

		render();
	}

	private getManagedTaskDataWorkflowValues(field: ManagedTaskDataFieldPicker): string[] {
		const rawValue = (this.fieldValues[field.canonicalKey] ?? '').trim();
		if (!rawValue) return [];
		return field.type === 'list' ? parseTaskMediaReferenceList(rawValue) : [rawValue];
	}

	private renderManagedTaskDataWorkflowPicker(group: HTMLElement, field: ManagedTaskDataFieldPicker): void {
		const setting = new Setting(group);
		setting.settingEl.addClass('operon-editor-inline-picker-setting', 'operon-editor-managed-task-data-setting');
		const stack = setting.controlEl.createDiv('operon-editor-picker-stack');
		const anchor = this.createPickerAnchor(stack, field.label, {
			leadingIcon: getConfiguredKeyMappingIcon(field.canonicalKey, this.settings.keyMappings) || 'circle-dot',
		});
		const selectedWrap = stack.createDiv('operon-editor-picker-selected operon-editor-managed-task-data-selection-row');
		let closePicker: (() => void) | null = null;

		const closeActivePicker = () => {
			if (!closePicker) return;
			const current = closePicker;
			closePicker = null;
			anchor.removeClass('is-picker-open');
			current();
		};

		const render = () => {
			selectedWrap.replaceChildren();
			const values = this.getManagedTaskDataWorkflowValues(field);
			selectedWrap.classList.toggle('is-empty', values.length === 0);
			for (const value of values) {
				const chip = createInlineTaskCompactChipElement({
					key: field.canonicalKey,
					label: value,
					icon: getConfiguredKeyMappingIcon(field.canonicalKey, this.settings.keyMappings) || 'circle-dot',
					iconOnly: false,
					interactive: false,
					colorRole: 'default',
					linkTarget: null,
				}, 'operon-editor-compact-selection-chip operon-editor-managed-task-data-chip', { forceFull: true });
				this.bindTruncatedTextTooltip(chip.querySelector<HTMLElement>('.operon-inline-compact-chip-label'));
				const removeButton = chip.ownerDocument.win.createEl('button');
				removeButton.type = 'button';
				removeButton.className = 'operon-editor-compact-selection-chip-remove';
				setIcon(removeButton, 'x');
				setAccessibleLabelWithoutTooltip(removeButton, t('taskEditor', 'removeValue', { value }));
				removeButton.addEventListener('click', () => {
					closeActivePicker();
					const nextValue = field.type === 'list'
						? serializeTaskMediaReferenceList(values.filter(existing => existing !== value))
						: '';
					this.applyDraftFieldRules({ [field.canonicalKey]: nextValue }, [field.canonicalKey]);
					render();
					this.markEdited();
					this.refreshWorkflowPickerSurfaceValues();
				});
				chip.appendChild(removeButton);
				selectedWrap.appendChild(chip);
			}
		};

		const openPicker = () => {
			if (closePicker) return;
			closePicker = openTaskFieldPicker({
				app: this.app,
				settings: this.settings,
				allTasks: this.indexer.getAllTasks(),
				canonicalKey: field.canonicalKey,
				anchor,
				currentFieldValues: { ...this.fieldValues },
				getCurrentFieldValues: () => this.fieldValues,
				currentTags: [...this.tags],
				sourcePath: this.existingTask?.filePath ?? this.fileBodyContext?.filePath ?? '',
				taskFormat: this.fileBodyContext?.format ?? 'inline',
				onCommit: payload => {
					this.applyTaskFieldPickerPayload(payload);
					render();
					this.markEdited();
					if (this.hasWorkflowPickerValue(field.canonicalKey)) {
						this.refreshWorkflowActionButtonStates();
					} else {
						closeActivePicker();
						this.refreshWorkflowPickerSurfaceValues();
					}
				},
				onClose: () => {
					closePicker = null;
					anchor.removeClass('is-picker-open');
				},
				onCancel: () => {
					closePicker = null;
					anchor.removeClass('is-picker-open');
				},
			});
			if (closePicker) anchor.addClass('is-picker-open');
		};

		anchor.addEventListener('click', event => {
			event.preventDefault();
			openPicker();
		});
		anchor.addEventListener('keydown', event => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			openPicker();
		});

		render();
	}

	private renderCustomWorkflowPicker(group: HTMLElement, mapping: KeyMapping): void {
		const label = getCustomFieldLabel(mapping);
		const setting = new Setting(group);
		setting.settingEl.addClass('operon-editor-inline-picker-setting', 'operon-editor-custom-field-setting');
		const stack = setting.controlEl.createDiv('operon-editor-picker-stack');
		const anchor = this.createPickerAnchor(stack, label, {
			leadingIcon: getCustomFieldIcon(mapping),
		});
		const selectedWrap = stack.createDiv('operon-editor-picker-selected operon-editor-custom-field-selection-row');
		let closePicker: (() => void) | null = null;

		const closeActivePicker = () => {
			if (!closePicker) return;
			const current = closePicker;
			closePicker = null;
			anchor.removeClass('is-picker-open');
			current();
		};

		const render = () => {
			this.renderCustomFieldSelection(selectedWrap, mapping, (value) => {
				closeActivePicker();
				if (mapping.type === 'list') {
					const currentValue = normalizeCustomFieldRawValue((this.fieldValues as Record<string, unknown>)[mapping.canonicalKey]);
					const nextValues = splitTaskListValue(currentValue).filter(existing => existing !== value);
					this.setDelimitedFieldValue(mapping.canonicalKey, nextValues);
				} else {
					this.applyDraftFieldRules({ [mapping.canonicalKey]: '' }, [mapping.canonicalKey]);
				}
				render();
				this.markEdited();
				this.refreshWorkflowPickerSurfaceValues();
			});
		};

		const openPicker = () => {
			if (closePicker) return;
			closePicker = openTaskFieldPicker({
				app: this.app,
				settings: this.settings,
				allTasks: this.indexer.getAllTasks(),
				canonicalKey: mapping.canonicalKey,
				anchor,
				currentFieldValues: { ...this.fieldValues },
				currentTags: [...this.tags],
				sourcePath: this.existingTask?.filePath ?? this.fileBodyContext?.filePath ?? '',
				closeListPickerOnSelect: this.shouldCloseWorkflowPickerOnSelect(),
				taskFormat: this.fileBodyContext?.format ?? 'inline',
				repeatInlineCompletionMode: this.inlineCompletionMode,
				onCommit: payload => {
					this.applyTaskFieldPickerPayload(payload);
					render();
					this.markEdited();
					if (this.hasWorkflowPickerValue(mapping.canonicalKey)) {
						this.refreshWorkflowActionButtonStates();
					} else {
						closeActivePicker();
						this.refreshWorkflowPickerSurfaceValues();
					}
				},
				onRepeatInlineCompletionModeChange: mode => {
					this.inlineCompletionMode = normalizeInlineCompletionMode(mode);
				},
				onClose: () => {
					closePicker = null;
					anchor.removeClass('is-picker-open');
				},
				onCancel: () => {
					closePicker = null;
					anchor.removeClass('is-picker-open');
				},
			});
			if (closePicker) anchor.addClass('is-picker-open');
		};

		anchor.addEventListener('click', event => {
			event.preventDefault();
			openPicker();
		});
		anchor.addEventListener('keydown', event => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			openPicker();
		});

		render();
	}

	private renderDetailsSection(container: HTMLElement): void {
		this.renderTrackingSessionsSection(container);
	}

	private renderRepeatRow(container: HTMLElement): void {
		const row = container.createDiv('operon-editor-repeat-row');
		this.renderRepeatControl(row);
	}

	private renderCollapsibleSection(
		container: HTMLElement,
		title: string,
		expanded: boolean,
		onToggle: (next: boolean) => void,
		renderBody: (body: HTMLElement) => void,
	): void {
		const group = container.createDiv('operon-editor-group operon-editor-collapsible');
		const header = group.createEl('button', {
			cls: 'operon-editor-collapsible-header',
			attr: { type: 'button', 'aria-expanded': String(expanded) },
		});
		header.createSpan({ text: title, cls: 'operon-editor-collapsible-title' });
		const chevron = header.createSpan('operon-editor-collapsible-chevron');
		const body = group.createDiv('operon-editor-collapsible-body');
		renderBody(body);

		const refresh = (isExpanded: boolean) => {
			group.classList.toggle('is-expanded', isExpanded);
			group.classList.toggle('is-collapsed', !isExpanded);
			header.setAttr('aria-expanded', String(isExpanded));
			chevron.empty();
			const icon = getIcon(isExpanded ? 'chevron-down' : 'chevron-right');
			if (icon) chevron.appendChild(icon);
			else chevron.setText(isExpanded ? '▾' : '▸');
		};

		header.addEventListener('click', () => {
			const next = !group.classList.contains('is-expanded');
			onToggle(next);
			refresh(next);
		});

		refresh(expanded);
	}

	private createInlineField(container: HTMLElement, label: string): HTMLElement {
		const wrap = container.createDiv('operon-editor-inline-control operon-editor-manual-field');
		wrap.createEl('label', { text: label, cls: 'operon-editor-inline-label' });
		return wrap.createDiv('operon-editor-inline-input');
	}

	private renderPriorityControl(container: HTMLElement): void {
		const control = this.createInlineField(container, t('taskEditor', 'priority'));
		const button = control.createEl('button', {
			cls: 'operon-editor-picker-button',
			attr: { type: 'button' },
		});

		const refreshButton = () => {
			const value = (this.fieldValues['priority'] ?? '').trim();
			button.classList.toggle('is-empty', !value);
			this.setPickerButtonContent(button, {
				canonicalKey: 'priority',
				isEmpty: !value,
				text: value
					? value.charAt(0).toUpperCase() + value.slice(1)
					: t('taskEditor', 'priority'),
			});
		};

		button.addEventListener('click', () => {
			button.classList.add('is-picker-open');
			showPriorityPicker(button, {
				priorities: this.settings.priorities,
				value: this.fieldValues['priority'],
				onSelect: value => {
					if (value) this.fieldValues['priority'] = value;
					else delete this.fieldValues['priority'];
					refreshButton();
					this.markEdited();
				},
				onClear: () => {
					delete this.fieldValues['priority'];
					refreshButton();
					this.markEdited();
				},
				onClose: () => {
					button.classList.remove('is-picker-open');
				},
			});
		});

		this.registerSchedulingDraftRefresher(refreshButton);
		refreshButton();
	}

	private renderStatusControl(container: HTMLElement): void {
		const statusControlEl = this.createInlineField(container, t('taskEditor', 'status'));
		const button = statusControlEl.createEl('button', {
			cls: 'operon-editor-picker-button',
			attr: { type: 'button' },
		});
		let closePicker: (() => void) | null = null;

		const refresh = () => {
			const value = (this.fieldValues['status'] ?? '').trim();
			button.classList.toggle('is-empty', !value);
			this.setPickerButtonContent(button, {
				canonicalKey: 'status',
				isEmpty: !value,
				text: value || t('taskEditor', 'statusPlaceholder'),
			});
		};

		const openPicker = () => {
			if (closePicker) return;
			const resetPickerState = () => {
				closePicker = null;
				button.removeClass('is-picker-open');
			};
			closePicker = showStatusPicker(button, {
				pipelines: this.settings.pipelines,
				value: this.fieldValues['status'],
				onSelect: value => {
					if (!this.applyStatusDraftChange(value)) return;
					refresh();
					resetPickerState();
					this.markEdited();
				},
				onClear: () => {
					delete this.fieldValues['status'];
					refresh();
					resetPickerState();
					this.markEdited();
				},
				onClose: resetPickerState,
			});
			button.addClass('is-picker-open');
		};

		button.addEventListener('click', event => {
			event.preventDefault();
			openPicker();
		});
		button.addEventListener('keydown', event => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			openPicker();
		});

		this.registerSchedulingDraftRefresher(refresh);
		refresh();
	}

	private renderDateControl(container: HTMLElement, key: string, label: string, placeholderText = label): void {
		const control = this.createInlineField(container, label);
		const button = control.createEl('button', {
			cls: 'operon-editor-picker-button',
			attr: { type: 'button' },
		});
		const refresh = () => {
			const value = (this.fieldValues[key] ?? '').trim();
			button.classList.toggle('is-empty', !value);
			this.setPickerButtonContent(button, {
				canonicalKey: key,
				isEmpty: !value,
				showIcon: true,
				text: value ? formatUiDate(value, this.settings) : placeholderText,
			});
			this.appendWeekdayHint(button, value);
		};
		this.registerSchedulingDraftRefresher(refresh);
		refresh();

		button.addEventListener('click', () => {
			button.classList.add('is-picker-open');
			showDatePicker(button, {
				app: this.app,
				fieldKey: key,
				value: this.fieldValues[key],
				dateDisplayFormat: this.settings.dateDisplayFormat,
				manualDatePicker: this.getManualDatePickerOptions(key),
				canRemove: !!this.fieldValues[key],
				onSelect: value => {
					if (!this.applyDateDraftChange(key, value)) return;
					this.markEdited();
				},
				onRemove: () => {
					if (!this.applyDateDraftChange(key, '')) return;
					this.markEdited();
				},
				onClose: () => {
					button.classList.remove('is-picker-open');
				},
			});
		});
	}

	private getManualDatePickerOptions(key: string): { weekStart: 'monday' | 'sunday'; showWeekNumbers: boolean } | undefined {
		if (!TASK_EDITOR_DAY_PICKER_DATE_KEYS.has(key)) return undefined;
		return {
			weekStart: this.settings.calendarWeekStart,
			showWeekNumbers: this.settings.calendarSidebarShowWeekNumbers,
		};
	}

	private getRepeatDayPickerPopoverOptions(): { weekStart: 'monday' | 'sunday'; showWeekNumbers: boolean } {
		return {
			weekStart: this.settings.calendarWeekStart,
			showWeekNumbers: this.settings.calendarSidebarShowWeekNumbers,
		};
	}

	private renderDatetimeControl(container: HTMLElement, key: 'datetimeStart' | 'datetimeEnd', label: string): void {
		const control = this.createInlineField(container, label);
		const button = control.createEl('button', {
			cls: 'operon-editor-picker-button',
			attr: { type: 'button' },
		});

		const refresh = () => {
			const value = (this.fieldValues[key] ?? '').trim();
			const hasStart = !!(this.fieldValues['datetimeStart'] ?? '').trim();
			button.classList.toggle('is-empty', !value);
			button.disabled = key === 'datetimeEnd' && !hasStart;
			this.bindEditorHoverTooltip(button, {
				content: key === 'datetimeEnd' && !hasStart
					? t('taskEditor', 'datetimeEndRequiresStart')
					: '',
				taskColor: () => this.getThemeColor(),
			});
			this.setPickerButtonContent(button, {
				canonicalKey: key,
				isEmpty: !value,
				showIcon: true,
				text: value
					? formatUiTime(this.app, this.settings, value)
					: label,
			});
			this.appendWeekdayHint(button, value);
		};
		this.registerSchedulingDraftRefresher(refresh);

		button.addEventListener('click', () => {
			if (key === 'datetimeEnd' && !(this.fieldValues['datetimeStart'] ?? '').trim()) {
				new Notice(t('taskEditor', 'datetimeEndRequiresStart'));
				return;
			}
			button.classList.add('is-picker-open');
			showDatetimePicker(button, {
				app: this.app,
				settings: {
					timeFormat: this.settings.timeFormat,
					calendarWeekStart: this.settings.calendarWeekStart,
					calendarSidebarShowWeekNumbers: this.settings.calendarSidebarShowWeekNumbers,
				},
				dateDisplayFormat: this.settings.dateDisplayFormat,
				fieldKey: key,
				value: this.fieldValues[key],
				initialDate: key === 'datetimeStart' ? this.fieldValues['dateScheduled'] : undefined,
				canRemove: !!this.fieldValues[key],
				onSelect: value => {
					this.applyDraftFieldRules({ [key]: value }, [key]);
					this.markEdited();
				},
				onRemove: () => {
					this.applyDraftFieldRules({ [key]: '' }, [key]);
					this.markEdited();
				},
				onClose: () => {
					button.classList.remove('is-picker-open');
				},
			});
		});

		refresh();
	}

	private renderEstimateControl(container: HTMLElement): void {
		this.refreshEstimateReallocationControl = null;
		const control = this.createInlineField(container, t('taskEditor', 'estimateMinutesShort'));
		control.parentElement?.addClass('operon-editor-estimate-field');
		control.addClass('operon-editor-estimate-input-row');
		const shell = control.createDiv('operon-editor-estimate-input-shell');
		const placeholder = shell.createDiv('operon-editor-estimate-placeholder');
		this.appendCanonicalIcon(placeholder, 'estimate', 'operon-editor-estimate-placeholder-icon');
		placeholder.createSpan({
			cls: 'operon-editor-estimate-placeholder-text',
			text: t('taskEditor', 'estimateMinutesShort'),
		});
		const input = shell.createEl('input', {
			attr: { type: 'number', placeholder: '' },
		});
		const sizeInput = () => {
			if (container.hasClass('operon-editor-desktop-property-value')) input.style.width = `calc(${Math.max(2, input.value.length + 1)}ch + 20px)`;
		};
		let refreshButtonState = (): void => {};
		const refresh = (): void => {
			const seconds = parseInt(this.fieldValues['estimate'] ?? '0', 10);
			input.value = seconds > 0 ? String(Math.round(seconds / 60)) : '';
			shell.classList.toggle('has-value', input.value.length > 0);
			sizeInput();
		};
		this.registerSchedulingDraftRefresher(refresh);
		const applyInputValue = (refreshEstimateReallocation = false): void => {
			const minutes = parseInt(input.value, 10);
			this.applyDraftFieldRules(
				{ estimate: minutes > 0 ? String(minutes * 60) : '' },
				['estimate'],
				{ refreshEstimateReallocation },
			);
		};
		const commitInputValue = (): void => {
			applyInputValue(true);
			this.markEdited();
		};
		input.addEventListener('input', () => {
			applyInputValue();
			shell.classList.toggle('has-value', input.value.length > 0);
			sizeInput();
			this.markEdited();
		});
		input.addEventListener('change', commitInputValue);
		shell.addEventListener('click', () => input.focus());
		refresh();

		if (!this.onApplyEstimateReallocation) return;

		const actions = control.createDiv('operon-editor-estimate-actions');
		const button = actions.createEl('button', {
			cls: 'operon-editor-estimate-reallocate is-compact',
			text: 'Δ',
			attr: { type: 'button', 'aria-label': t('taskEditor', 'estimateReallocationButton') },
		});
		// Measure the former action width so only its saved space goes to the time fields.
		const measure = actions.createEl('button', {
			cls: 'operon-editor-estimate-reallocate operon-editor-estimate-width-probe',
			text: t('taskEditor', 'estimateReallocationButton'),
			attr: { type: 'button', 'aria-hidden': 'true', tabindex: '-1' },
		});
		getActiveWindow().requestAnimationFrame(() => {
			if (button.isConnected) {
				const savedWidth = Math.max(0, measure.getBoundingClientRect().width - button.getBoundingClientRect().width);
				container.style.setProperty('--operon-editor-estimate-action-savings', `${savedWidth}px`);
			}
			measure.remove();
		});
		refreshButtonState = (): void => {
			const proposal = this.getEstimateReallocationProposal();
			const tooltip = this.getEstimateReallocationTooltip();
			button.disabled = !proposal;
			this.bindEditorHoverTooltip(button, { content: tooltip, taskColor: () => this.getThemeColor() });
			this.bindEditorHoverTooltip(actions, { content: tooltip, taskColor: () => this.getThemeColor() });
		};
		button.addEventListener('click', () => {
			void this.handleEstimateReallocationClick();
		});
		this.refreshEstimateReallocationControl = refreshButtonState;
		refreshButtonState();
	}

	private getDraftEstimateSeconds(): number {
		return Math.max(0, parseInt(this.fieldValues['estimate'] ?? '0', 10) || 0);
	}

	private getPersistedEstimateSeconds(): number {
		return this.estimateReallocationBaseSeconds;
	}

	private getDirectParentOperonId(): string {
		return (this.fieldValues['parentTask'] ?? '').trim();
	}

	private getDirectParentTask(): IndexedTask | null {
		const parentOperonId = this.getDirectParentOperonId();
		return parentOperonId ? this.indexer.getTask(parentOperonId) ?? null : null;
	}

	private getEstimateReallocationProposal(): ManualEstimateReallocationProposal | null {
		return buildManualEstimateReallocationProposal({
			childOperonId: this.fieldValues['operonId'] ?? '',
			childLabel: this.description.trim(),
			persistedChildEstimateSeconds: this.getPersistedEstimateSeconds(),
			draftChildEstimateSeconds: this.getDraftEstimateSeconds(),
			directParentOperonId: this.getDirectParentOperonId(),
			getTaskById: (operonId: string) => this.indexer.getTask(operonId) ?? null,
			getChildIds: (operonId: string) => this.indexer.secondary.getChildIds(operonId),
		});
	}

	private getEstimateReallocationTooltip(): string {
		const parentOperonId = this.getDirectParentOperonId();
		if (!parentOperonId) return t('taskEditor', 'estimateReallocationNoParent');
		const proposal = this.getEstimateReallocationProposal();
		if (proposal) {
			return proposal.coverage === 'full'
				? t('taskEditor', 'estimateReallocationTooltip')
				: t('taskEditor', 'estimateReallocationPartialTooltip');
		}
		if (this.getDraftEstimateSeconds() <= this.getPersistedEstimateSeconds()) {
			return t('taskEditor', 'estimateReallocationNeedsIncrease');
		}
		if (!this.getDirectParentTask()) return t('taskEditor', 'estimateReallocationNoParent');
		return t('taskEditor', 'estimateReallocationNoBudget');
	}

	private async promptConfirmAction(options: ConstructorParameters<typeof ConfirmActionModal>[1]): Promise<boolean> {
		return await new Promise<boolean>(resolve => {
			new ConfirmActionModal(this.app, options, resolve).open();
		});
	}

	private async handleEstimateReallocationClick(): Promise<void> {
		const proposal = this.getEstimateReallocationProposal();
		if (!proposal || !this.onApplyEstimateReallocation) return;

		const comparisonTable = this.buildEstimateReallocationComparisonTable(proposal);
		const isPartial = proposal.coverage === 'partial';
		this.suspendAutoSave();
		try {
			const confirmed = await this.promptConfirmAction({
				title: t('modals', 'reallocateEstimate'),
				message: isPartial
					? t('taskEditor', 'estimateReallocationPartialConfirmMessage')
					: t('taskEditor', 'estimateReallocationConfirmMessage'),
				confirmText: isPartial
					? t('buttons', 'partiallySubtract')
					: t('buttons', 'subtractFromParents'),
				cancelText: t('buttons', 'keepAsIs'),
				comparisonTable,
			});
			if (!confirmed) return;

			if (!this.fieldValues['operonId']) {
				this.fieldValues['operonId'] = generateOperonId();
			}
			const childOperonId = this.fieldValues['operonId'];
			if (!childOperonId) return;

			const saved = await this.persistEditorState('estimate-reallocation');
			if (!saved.ok || !saved.clean) return;

			const applyResult = await this.onApplyEstimateReallocation({
				childOperonId,
				deltaSeconds: proposal.deltaSeconds,
				childEstimateBeforeSeconds: proposal.childEstimateBeforeSeconds,
				childEstimateAfterSeconds: proposal.childEstimateAfterSeconds,
				appliedSeconds: proposal.appliedSeconds,
				uncoveredSeconds: proposal.uncoveredSeconds,
				steps: proposal.steps.map(step => ({
					operonId: step.operonId,
					subtractSeconds: step.subtractSeconds,
					estimateBeforeSeconds: step.estimateBeforeSeconds,
					estimateAfterSeconds: step.estimateAfterSeconds,
				})),
			});
			if (applyResult.complete) {
				this.commitEstimateReallocationBaseline(proposal.childEstimateAfterSeconds);
			} else if (applyResult.committedSubtractSeconds > 0) {
				this.commitEstimateReallocationBaseline(Math.min(
					proposal.childEstimateAfterSeconds,
					proposal.childEstimateBeforeSeconds + applyResult.committedSubtractSeconds,
				));
			}

			this.syncTrackingFieldsFromIndex();
			this.refreshEstimateReallocationControl?.();
			if (!applyResult.complete) {
				new Notice(t('taskEditor', 'estimateReallocationUnavailable'));
				return;
			}
		} finally {
			this.resumeAutoSave();
		}
	}

	private buildEstimateReallocationComparisonTable(
		proposal: ManualEstimateReallocationProposal,
	): ConfirmActionComparisonTable {
		const rows: ConfirmActionComparisonRow[] = proposal.previewRows.map(row =>
			this.buildEstimateReallocationComparisonRow(row));
		return {
			requestedDeltaLabel: t('taskEditor', 'estimateReallocationRequestedDeltaLabel'),
			requestedDeltaValue: formatDurationHuman(proposal.deltaSeconds),
			headers: {
				label: t('taskEditor', 'estimateReallocationTableTask'),
				currentValue: t('taskEditor', 'estimateReallocationTableCurrentEstimate'),
				newValue: t('taskEditor', 'estimateReallocationTableNewEstimate'),
				currentTotal: t('taskEditor', 'estimateReallocationTableCurrentTotal'),
				newTotal: t('taskEditor', 'estimateReallocationTableNewTotal'),
			},
			rows,
		};
	}

	private buildEstimateReallocationComparisonRow(
		row: EstimateReallocationPreviewRow,
	): ConfirmActionComparisonRow {
		return {
			label: row.label,
			currentValue: formatDurationHuman(row.currentEstimateSeconds),
			newValue: formatDurationHuman(row.newEstimateSeconds),
			currentTotal: row.currentTotalEstimateSeconds == null
				? ''
				: formatDurationHuman(row.currentTotalEstimateSeconds),
			newTotal: row.newTotalEstimateSeconds == null
				? ''
				: formatDurationHuman(row.newTotalEstimateSeconds),
		};
	}

	private renderRepeatControl(container: HTMLElement): void {
		const control = this.createInlineField(container, t('taskEditor', 'repeat'));
		control.parentElement?.addClass('operon-editor-repeat-row');
		const actions = control.createDiv('operon-editor-repeat-actions');
		const main = actions.createDiv('operon-editor-repeat-main');
		const trigger = main.createEl('button', {
			cls: 'operon-editor-repeat-trigger',
			attr: { type: 'button' },
		});
		const skipButton = actions.createEl('button', {
			cls: 'operon-editor-repeat-skip',
			attr: { type: 'button' },
			text: t('taskEditor', 'repeatSkip'),
		});

		const refresh = () => {
			const extractDatePart = (value: string | undefined): string => {
				const trimmed = (value ?? '').trim();
				if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
				if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return trimmed.slice(0, 10);
				return '';
			};

			const raw = (this.fieldValues['repeat'] ?? '').trim();
			const parsed = parseRepeatRule(raw);
			const repeatSeriesId = (this.fieldValues['repeatSeriesId'] ?? '').trim();
			const persistedRepeat = (this.persistedFieldValues['repeat'] ?? '').trim();
			const persistedSeriesId = (this.persistedFieldValues['repeatSeriesId'] ?? '').trim();
			const repeatContextDirty = (
				raw !== persistedRepeat
				|| repeatSeriesId !== persistedSeriesId
				|| ((this.fieldValues['repeatOccurrenceDate'] ?? '').trim() !== (this.persistedFieldValues['repeatOccurrenceDate'] ?? '').trim())
				|| ((this.fieldValues['dateScheduled'] ?? '').trim() !== (this.persistedFieldValues['dateScheduled'] ?? '').trim())
				|| ((this.fieldValues['dateDue'] ?? '').trim() !== (this.persistedFieldValues['dateDue'] ?? '').trim())
				|| ((this.fieldValues['dateStarted'] ?? '').trim() !== (this.persistedFieldValues['dateStarted'] ?? '').trim())
				|| ((this.fieldValues['datetimeStart'] ?? '').trim() !== (this.persistedFieldValues['datetimeStart'] ?? '').trim())
				|| ((this.fieldValues['datetimeEnd'] ?? '').trim() !== (this.persistedFieldValues['datetimeEnd'] ?? '').trim())
				|| ((this.fieldValues['datetimeRepeatEnd'] ?? '').trim() !== (this.persistedFieldValues['datetimeRepeatEnd'] ?? '').trim())
			);
			skipButton.disabled = true;
			this.bindEditorHoverTooltip(skipButton, {
				content: t('taskEditor', 'repeatSkipUnavailable'),
				taskColor: () => this.getThemeColor(),
			});
			if (!raw) {
				trigger.empty();
				this.appendCanonicalIcon(trigger, 'repeat', 'operon-editor-picker-button-leading-icon');
				trigger.createSpan({
					cls: 'operon-editor-picker-button-text',
					text: t('taskEditor', 'repeatAdd'),
				});
				return;
			}

			trigger.textContent = parsed ? formatRepeatRuleSummaryI18n(parsed) : raw;
			if (!parsed) {
				return;
			}

			const hasAnchor = !!(
				extractDatePart(this.fieldValues['repeatOccurrenceDate'])
				|| extractDatePart(this.fieldValues['dateScheduled'])
				|| extractDatePart(this.fieldValues['dateDue'])
				|| extractDatePart(this.fieldValues['dateStarted'])
				|| extractDatePart(this.fieldValues['datetimeStart'])
				|| extractDatePart(this.fieldValues['datetimeEnd'])
			);
			const canManageFutureSkips = !!(
				this.taskOperonId
				&& this.getRepeatSkipDates
				&& this.onUpdateRepeatSkips
				&& repeatSeriesId
				&& !repeatContextDirty
				&& hasAnchor
				&& (parsed.mode === 'schedule' || parsed.mode === 'count')
			);
			skipButton.disabled = !canManageFutureSkips;
			this.bindEditorHoverTooltip(skipButton, {
				content: parsed.mode === 'done'
					? t('taskEditor', 'repeatSkipModeDoneHint')
					: canManageFutureSkips
						? ''
						: t('taskEditor', 'repeatSkipUnavailable'),
				taskColor: () => this.getThemeColor(),
			});
		};

		const openPicker = (event?: Event) => {
			event?.preventDefault();
			event?.stopPropagation();
			if (container.hasClass('operon-editor-desktop-property-value')) trigger.addClass('is-picker-open');
			showRepeatPicker(trigger, {
				onClose: () => trigger.removeClass('is-picker-open'),
				value: this.fieldValues['repeat'],
				repeatEnd: this.fieldValues['datetimeRepeatEnd'],
				repeatSeriesId: this.fieldValues['repeatSeriesId'],
				taskColor: this.fieldValues['taskColor'],
				repeatOccurrenceDate: this.fieldValues['repeatOccurrenceDate'],
				dateScheduled: this.fieldValues['dateScheduled'],
				dateDue: this.fieldValues['dateDue'],
				dateStarted: this.fieldValues['dateStarted'],
				datetimeStart: this.fieldValues['datetimeStart'],
				datetimeEnd: this.fieldValues['datetimeEnd'],
				taskFormat: this.fileBodyContext?.format ?? 'inline',
				inlineCompletionMode: this.inlineCompletionMode,
				dayPickerPopover: this.getRepeatDayPickerPopoverOptions(),
				onSave: ({ repeat, datetimeRepeatEnd, repeatOccurrenceDate, inlineCompletionMode }) => {
					this.fieldValues['repeat'] = repeat;
					if (datetimeRepeatEnd) this.fieldValues['datetimeRepeatEnd'] = datetimeRepeatEnd;
					else delete this.fieldValues['datetimeRepeatEnd'];
					if (repeatOccurrenceDate) {
						this.fieldValues['repeatOccurrenceDate'] = repeatOccurrenceDate;
					}
					if (parseRepeatRule(repeat) && !this.fieldValues['repeatSeriesId']) {
						this.fieldValues['repeatSeriesId'] = generateRepeatSeriesId();
					}
					this.inlineCompletionMode = inlineCompletionMode;
					this.syncDerivedRepeatFieldsFromDraft();
					this.markEdited();
					refresh();
				},
				onClear: () => {
					delete this.fieldValues['repeat'];
					delete this.fieldValues['datetimeRepeatEnd'];
					delete this.fieldValues['repeatSeriesId'];
					delete this.fieldValues['repeatOccurrenceDate'];
					this.inlineCompletionMode = DEFAULT_INLINE_REPEAT_COMPLETION_MODE;
					this.markEdited();
					refresh();
				},
			});
		};
		const openSkipPicker = async (event?: Event) => {
			event?.preventDefault();
			event?.stopPropagation();
			const rawRepeat = (this.fieldValues['repeat'] ?? '').trim();
			const parsed = parseRepeatRule(rawRepeat);
			const repeatSeriesId = (this.fieldValues['repeatSeriesId'] ?? '').trim();
			if (!parsed || !repeatSeriesId || !this.taskOperonId || !this.getRepeatSkipDates || !this.onUpdateRepeatSkips) return;
			if (parsed.mode !== 'schedule' && parsed.mode !== 'count') return;
			if (container.hasClass('operon-editor-desktop-property-value')) skipButton.addClass('is-picker-open');
			showRepeatSkipPicker(skipButton, {
				onClose: () => skipButton.removeClass('is-picker-open'),
				taskId: this.taskOperonId,
				repeat: rawRepeat,
				repeatSeriesId,
				repeatOccurrenceDate: this.fieldValues['repeatOccurrenceDate'],
				dateScheduled: this.fieldValues['dateScheduled'],
				dateDue: this.fieldValues['dateDue'],
				dateStarted: this.fieldValues['dateStarted'],
				datetimeStart: this.fieldValues['datetimeStart'],
				datetimeEnd: this.fieldValues['datetimeEnd'],
				datetimeRepeatEnd: this.fieldValues['datetimeRepeatEnd'],
				taskColor: this.fieldValues['taskColor'],
				existingSkipDates: this.getRepeatSkipDates(repeatSeriesId),
				onSave: async ({ skipDates }) => {
					const result = await this.onUpdateRepeatSkips?.({
						operonId: this.taskOperonId!,
						repeatSeriesId,
						skipDates,
					});
					if (result && 'datetimeRepeatEnd' in result) {
						const nextEnd = (result.datetimeRepeatEnd ?? '').trim();
						if (nextEnd) {
							this.fieldValues['datetimeRepeatEnd'] = nextEnd;
							this.persistedFieldValues['datetimeRepeatEnd'] = nextEnd;
						} else {
							delete this.fieldValues['datetimeRepeatEnd'];
							delete this.persistedFieldValues['datetimeRepeatEnd'];
						}
					}
					refresh();
				},
			});
		};
		const stopRepeatPress = (event: Event) => {
			event.preventDefault();
			event.stopPropagation();
		};

		trigger.addEventListener('mousedown', stopRepeatPress);
		trigger.addEventListener('click', openPicker);
		skipButton.addEventListener('mousedown', stopRepeatPress);
		skipButton.addEventListener('click', event => { void openSkipPicker(event); });
		control.addEventListener('mousedown', stopRepeatPress);
		control.addEventListener('click', event => {
			if (event.target === trigger || event.target === skipButton) return;
			if (skipButton.contains(event.target as Node)) return;
			openPicker(event);
		});
		this.registerSchedulingDraftRefresher(refresh);
		refresh();
	}

	private renderCoreTrackerActionButton(container: HTMLElement): void {
		const button = container.createEl('button', {
			cls: 'operon-editor-core-action-btn operon-editor-core-tracker-action',
			attr: { type: 'button' },
		});

		const refresh = () => {
			const operonId = this.getCurrentOperonId();
			const isRunning = !!operonId && this.timeTracker.isTimerRunning(operonId);
			const canStart = !!this.description.trim();
			const label = isRunning ? t('taskEditor', 'trackerStopButton') : t('taskEditor', 'trackerStartButton');
			button.disabled = !isRunning && !canStart;
			button.empty();
			const icon = getIcon(isRunning ? 'square' : 'play');
			if (icon) button.appendChild(icon);
			setAccessibleLabelWithoutTooltip(button, label);
			this.bindTaskEditorTooltip(button, label);
			button.classList.toggle('is-running', isRunning);
		};

		this.refreshCoreTrackerControl = refresh;
		refresh();

		button.addEventListener('click', asyncHandler('task editor tracker toggle failed', async () => {
			const currentId = this.getCurrentOperonId();
			if (currentId && this.timeTracker.isTimerRunning(currentId)) {
				await this.timeTracker.stop('manual');
				this.syncTrackingFieldsFromIndex();
				refresh();
				return;
			}

			const operonId = await this.ensureTaskReadyForTracking();
			if (!operonId) return;
			const started = await this.timeTracker.start(operonId, 'editor');
			if (!started) return;
			this.syncWorkflowFieldsFromIndex();
			this.syncTrackingFieldsFromIndex();
			refresh();
			this.refreshTrackingSessionsSection?.();
		}));
	}

	private renderTrackingSessionsSection(container: HTMLElement): void {
		const section = container.createDiv('operon-editor-tracking-sessions');
		const header = section.createDiv('operon-editor-tracking-sessions-header');
		const title = header.createEl('h6', { cls: 'operon-editor-core-title-badge operon-editor-tracking-sessions-title' });
		if (this.usesMobileLayout) this.appendCanonicalIcon(title, 'trackers', 'operon-editor-tracking-sessions-title-icon');
		title.createSpan({ text: this.usesMobileLayout ? t('taskEditor', 'trackingSessions') : this.desktopSectionLabel('sessions') });
		const addButton = header.createEl('button', {
			cls: 'operon-editor-core-action-btn operon-editor-tracking-sessions-add',
			attr: { type: 'button' },
		});
		const addSessionLabel = t('taskEditor', 'addSession');
		if (this.usesMobileLayout) {
			setIcon(addButton, 'plus');
			addButton.createSpan({ text: addSessionLabel });
		} else {
			setIcon(addButton, 'clock-plus');
			setAccessibleLabelWithoutTooltip(addButton, addSessionLabel);
			this.bindTaskEditorTooltip(addButton, addSessionLabel);
		}

		const list = section.createDiv('operon-editor-tracking-sessions-list');
		const more = this.usesMobileLayout ? null : section.createEl('button', {
			cls: 'operon-editor-tracking-sessions-more',
			attr: { type: 'button', 'aria-expanded': 'false' },
		});
		const moreLabel = more?.createSpan();
		const moreIcon = more?.createSpan();

		const openAddModal = async () => {
			const operonId = await this.ensureTaskReadyForTracking();
			if (!operonId) return;
			new TrackerSessionEditModal(this.app, {
				title: t('taskEditor', 'addSession'),
				contextTitle: this.description,
				taskNote: this.buildTrackerSessionTaskNoteOptions(operonId),
				onSave: async (start, end) => {
					const added = await this.timeTracker.addSession(operonId, start, end);
					if (!added) {
						new Notice(t('notifications', 'taskSaveFailed'));
						return false;
					}
					this.syncTrackingFieldsFromIndex();
					this.refreshCoreTrackerControl?.();
					this.refreshTrackingSessionsSection?.();
				},
			}).open();
		};

		addButton.addEventListener('click', () => {
			runAsyncAction('task editor add tracker session failed', openAddModal);
		});

		const refresh = () => {
			addButton.disabled = !this.description.trim();
			cleanupOperonHoverTooltips(list);
			list.empty();

			const sessions = this.getCurrentTaskSessions();
			if (sessions.length <= 3) this.desktopSessionsExpanded = false;
			if (more) {
				const hadFocus = more.ownerDocument.activeElement === more;
				more.hidden = sessions.length <= 3;
				const label = this.desktopSessionsExpanded ? t('taskEditor', 'showLess') : t('taskEditor', 'moreValues', { count: String(Math.max(0, sessions.length - 3)) });
				moreLabel?.setText(label);
				if (moreIcon) setIcon(moreIcon, this.desktopSessionsExpanded ? 'chevron-up' : 'chevron-down');
				more.setAttr('aria-expanded', String(this.desktopSessionsExpanded));
				setAccessibleLabelWithoutTooltip(more, `${t('taskEditor', 'trackingSessions')}: ${label}`);
				if (hadFocus && more.hidden) {
					if (addButton.disabled) this.focusDescriptionField(false);
					else addButton.focus({ preventScroll: true });
				}
			}
			list.hidden = !this.usesMobileLayout && sessions.length === 0;
			if (sessions.length === 0) {
				if (!this.usesMobileLayout) return;
				list.createDiv({
					cls: 'operon-editor-tracking-sessions-empty',
					text: t('taskEditor', 'noTrackingSessions'),
				});
				return;
			}

			for (const session of !more || this.desktopSessionsExpanded ? sessions : sessions.slice(0, 3)) {
				this.renderTrackingSessionRow(list, session);
			}
		};

		more?.addEventListener('click', () => {
			if (this.disposed) return;
			this.desktopSessionsExpanded = !this.desktopSessionsExpanded;
			refresh();
		});
		this.refreshTrackingSessionsSection = refresh;
		refresh();
	}

	private renderTrackingSessionRow(container: HTMLElement, session: TrackerSession): void {
		const desktop = !this.usesMobileLayout;
		const row = container.createDiv('operon-editor-tracking-session-row');
		bindDescendantFocusVisible(row);
		if (desktop) row.addClass('operon-editor-desktop-property-row');
		const duration = desktop ? row.createDiv('operon-editor-desktop-property-label operon-editor-session-duration') : null;
		if (duration) {
			this.appendCanonicalIcon(duration, 'duration', 'operon-editor-desktop-property-icon has-value');
			duration.createSpan({ cls: 'operon-editor-session-duration-text', text: formatDurationHuman(session.durationSeconds) });
			duration.setAttribute('role', 'button');
			duration.setAttribute('tabindex', '0');
			setAccessibleLabelWithoutTooltip(duration, t('taskEditor', 'editSession'));
			this.bindTaskEditorTooltip(duration, t('taskEditor', 'editSession'));
		}
		const body = row.createDiv('operon-editor-tracking-session-body');
		const range = body.createDiv({
			cls: 'operon-editor-tracking-session-range',
			text: `${this.formatSessionTimestamp(session.start)} - ${this.formatSessionEnd(session.start, session.end)}`,
		});
		this.appendWeekdayHint(range, session.start);
		if (!desktop) body.createDiv({
			cls: 'operon-editor-tracking-session-duration',
			text: formatDurationHuman(session.durationSeconds),
		});

		const actions = (desktop ? body : row).createDiv('operon-editor-tracking-session-actions');
		const edit = this.createSessionActionButton(actions, 'pencil', t('taskEditor', 'editSession'));
		const openSession = () => {
			new TrackerSessionEditModal(this.app, {
				title: t('taskEditor', 'editSession'),
				taskNote: this.buildTrackerSessionTaskNoteOptions(session.operonId),
				...buildTrackerSessionEditContext({
					taskLabel: session.task.description || this.description || session.operonId,
					start: session.start,
					end: session.end,
				}),
				initialStart: session.start,
				initialEnd: session.end,
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
						new Notice(t('notifications', 'taskSaveFailed'));
						return false;
					}
					this.syncTrackingFieldsFromIndex();
					this.refreshCoreTrackerControl?.();
					this.refreshTrackingSessionsSection?.();
					new Notice(formatTaskNotice('time-session-edited', {
						description: this.description,
						indexedDescription: session.task.description,
						operonId: session.operonId,
					}));
				},
				onDelete: async () => {
					const deleted = await this.timeTracker.deleteSessionByRange(
						session.operonId,
						session.start,
						session.end,
						session.sessionIndex,
					);
					if (!deleted) {
						new Notice(t('notifications', 'taskSaveFailed'));
						return false;
					}
					this.syncTrackingFieldsFromIndex();
					this.refreshCoreTrackerControl?.();
					this.refreshTrackingSessionsSection?.();
				},
			}).open();
		};
		edit.addEventListener('click', openSession);
		duration?.addEventListener('click', openSession);
		duration?.addEventListener('keydown', event => {
			if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openSession(); }
		});

		if (desktop) return;

		const del = this.createSessionActionButton(actions, 'trash-2', t('taskEditor', 'removeSession'));
		del.addClass('is-danger');
		del.addEventListener('click', () => {
			new ConfirmActionModal(this.app, {
				title: t('taskEditor', 'deleteSessionTitle'),
				message: t('taskEditor', 'deleteSessionMessage', {
					range: `${this.formatSessionTimestamp(session.start)} - ${this.formatSessionEnd(session.start, session.end)}`,
				}),
				confirmText: t('taskEditor', 'deleteSessionConfirm'),
				cancelText: t('buttons', 'cancel'),
			}, asyncHandler('task editor tracker session delete failed', async confirmed => {
				if (!confirmed) return;
				const deleted = await this.timeTracker.deleteSessionByRange(
					session.operonId,
					session.start,
					session.end,
					session.sessionIndex,
				);
				if (!deleted) {
					new Notice(t('notifications', 'taskSaveFailed'));
					return;
				}
				this.syncTrackingFieldsFromIndex();
				this.refreshCoreTrackerControl?.();
				this.refreshTrackingSessionsSection?.();
			})).open();
		});
	}

	private buildTrackerSessionTaskNoteOptions(operonId: string): TrackerSessionTaskNoteOptions {
		return {
			operonId,
			sourcePath: this.getCompactTextSourcePath(),
			initialValue: this.fieldValues['note'] ?? '',
			taskDescription: this.description,
			taskColor: this.fieldValues['taskColor'] ?? null,
			icon: getConfiguredKeyMappingIcon('note', this.settings.keyMappings) || 'notebook-pen',
			onCommit: async value => {
				const previous = this.fieldValues['note'] ?? '';
				if (value !== previous) {
					if (value.trim()) {
						this.fieldValues['note'] = value;
					} else {
						delete this.fieldValues['note'];
					}
					this.noteCompactEditor?.setSourceValue(value, this.getCompactTextSourcePath());
					if (this.noteInputEl) {
						this.noteInputEl.value = value;
						this.autoSizeMobileTextarea(this.noteInputEl, 44);
					}
					this.updateMobileNoteVisibility();
					this.refreshMobileCoreButtons();
					this.markEdited();
				}
				const outcome = await this.flushPendingEditsOutcome('explicit-save');
				return outcome.ok && outcome.clean;
			},
		};
	}

	private renderRemoveControl(container: HTMLElement): void {
		if (!this.existingTask || !this.onRequestDelete) return;

		const control = this.createInlineField(container, '');
		control.parentElement?.addClass('operon-editor-remove-field');

		const button = control.createEl('button', {
			cls: 'operon-editor-core-action-btn operon-editor-core-danger-btn operon-editor-picker-button',
			attr: {
				type: 'button',
			},
		});
		const icon = getIcon('trash-2') ?? getIcon('trash');
		if (icon) button.appendChild(icon);
		setAccessibleLabelWithoutTooltip(button, t('buttons', 'remove'));
		this.bindTaskEditorTooltip(button, t('buttons', 'remove'));

		button.addEventListener('click', () => {
			void this.handleRemoveTaskClick();
		});
	}

	private async handleRemoveTaskClick(): Promise<void> {
		if (!this.existingTask || !this.onRequestDelete || this.deleteInProgress) return;
		this.deleteInProgress = true;
		this.suspendAutoSave();
		let deleted = false;
		try {
			const isYamlTask = this.fileBodyContext?.format === 'yaml';
			const expectedDirectChildCount = Math.max(
				0,
				this.getDeleteDirectChildCount?.(this.existingTask) ?? 0,
			);
			const baseMessage = isYamlTask
				? t('taskEditor', 'removeFileTaskMessage')
				: t('taskEditor', 'removeInlineTaskMessage');
			const childMessage = expectedDirectChildCount > 0
				? `\n\n${t('taskEditor', 'convertToPlainBlockerChildren', {
					count: String(expectedDirectChildCount),
				})}: ${t('taskEditor', 'clearParentTask')}.`
				: '';
			const confirmed = await this.promptConfirmAction({
				title: t('taskEditor', 'removeTaskTitle'),
				message: `${baseMessage}${childMessage}`,
				confirmText: t('buttons', 'confirm'),
				cancelText: t('buttons', 'cancel'),
			});
			if (!confirmed) return;
			const inFlight = this.persistInFlight;
			if (inFlight) {
				try {
					await inFlight;
				} catch (error) {
					console.error('Operon: task editor save failed before delete', error);
				}
			}
			let result: boolean | void;
			try {
				result = await this.onRequestDelete(
					this.existingTask,
					expectedDirectChildCount,
				);
			} catch (error) {
				console.error('Operon: task editor delete failed', error);
				new Notice(t('notifications', 'taskSaveFailed'));
				return;
			}
			if (result === false) return;
			deleted = true;
			this.disposed = true;
			this.refreshQuickFinishControl = null;
			this.checkboxSaveListenerController.abort();
			this.requestEditorClose('force-after-delete');
		} finally {
			if (!deleted) {
				this.deleteInProgress = false;
				this.resumeAutoSave();
			}
		}
	}

	private renderIconControl(container: HTMLElement): void {
		const iconWrap = container.createDiv('operon-appearance-icon-wrap');
		const iconLabel = iconWrap.createEl('label', { text: t('taskEditor', 'taskIcon'), cls: 'operon-appearance-label' });
		const iconInputWrap = iconWrap.createDiv('operon-icon-button-wrap');
		const iconButton = iconInputWrap.createEl('button', {
			cls: 'operon-icon-trigger',
			attr: { type: 'button' },
		});
		let closeIconPicker: (() => void) | null = null;

		const refreshIconPreview = () => {
			iconButton.empty();
			const name = this.fieldValues['taskIcon'] ?? '';
			if (container.hasClass('operon-editor-desktop-property-value')) {
				iconButton.setText(name);
				iconButton.toggleClass('has-icon', !!name);
				setAccessibleLabelWithoutTooltip(iconButton, this.getWorkflowPickerLabel('taskIcon'));
				return;
			}
			const fallbackIds = name
				? [name]
				: ['obsidian-new', 'obsidian-logo', 'gem', 'hexagon'];
			for (const iconId of fallbackIds) {
				const svg = getIcon(iconId);
				if (!svg) continue;
				iconButton.appendChild(svg);
				setAccessibleLabelWithoutTooltip(iconButton, t('taskEditor', 'taskIcon'));
				iconButton.classList.toggle('has-icon', !!name);
				return;
			}
			setAccessibleLabelWithoutTooltip(iconButton, t('taskEditor', 'taskIcon'));
			iconButton.classList.remove('has-icon');
		};
		this.registerSchedulingDraftRefresher(refreshIconPreview);
		refreshIconPreview();

		const selectItem = (iconId: string) => {
			this.fieldValues['taskIcon'] = iconId;
			refreshIconPreview();
			this.markEdited();
		};

		const openSharedIconPicker = (query: string) => {
			closeIconPicker?.();
			if (container.hasClass('operon-editor-desktop-property-value')) iconButton.addClass('is-picker-open');
			closeIconPicker = showIconPicker(iconButton, {
				value: this.fieldValues['taskIcon'],
				query,
				onSelect: iconId => {
					closeIconPicker = null;
					iconButton.removeClass('is-picker-open');
					selectItem(iconId);
				},
				onClear: () => {
					closeIconPicker = null;
					iconButton.removeClass('is-picker-open');
					delete this.fieldValues['taskIcon'];
					refreshIconPreview();
					this.markEdited();
				},
				onClose: () => {
					closeIconPicker = null;
					iconButton.removeClass('is-picker-open');
				},
			});
		};

		iconButton.addEventListener('mousedown', event => {
			event.preventDefault();
		});
		iconButton.addEventListener('click', event => {
			event.preventDefault();
			event.stopPropagation();
			openSharedIconPicker('');
		});
		iconLabel.removeAttribute('for');
	}

	private renderColorControl(container: HTMLElement): void {
		const colorWrap = container.createDiv('operon-appearance-color-wrap');
		colorWrap.createEl('label', { text: t('taskEditor', 'taskColor'), cls: 'operon-appearance-label' });

		const swatchWrap = colorWrap.createDiv('operon-color-swatch-wrap');
		const swatch = swatchWrap.createEl('button', {
			cls: 'operon-color-swatch',
			attr: { type: 'button' },
		});
		setAccessibleLabelWithoutTooltip(swatch, t('taskEditor', 'taskColor'));

		const currentColor = this.fieldValues['taskColor'] ?? '';
		const currentColorHex = currentColor ? (currentColor.startsWith('#') ? currentColor : `#${currentColor}`) : '';

		const refreshSwatch = (hex: string) => {
			swatch.empty();
			if (container.hasClass('operon-editor-desktop-property-value')) {
				swatch.setText(hex.toUpperCase());
				swatch.toggleClass('has-color', !!hex);
				return;
			}
			if (hex) {
				const swatchDot = swatch.createSpan('operon-color-swatch-dot');
				swatchDot.style.background = hex;
			} else {
				this.appendCanonicalIcon(swatch, 'taskColor', 'operon-color-swatch-icon');
			}
			swatch.classList.toggle('has-color', !!hex);
		};
		this.registerSchedulingDraftRefresher(() => {
			const color = this.fieldValues['taskColor'] ?? '';
			refreshSwatch(color ? `#${color.replace(/^#/, '')}` : '');
		});
		refreshSwatch(currentColorHex);

		swatch.addEventListener('click', () => {
			swatch.addClass('is-picker-open');
			showColorPicker(swatch, {
				value: this.fieldValues['taskColor'],
				palette: this.settings.colorPalette,
				onSelect: value => {
					swatch.removeClass('is-picker-open');
					const hex = value ? `#${value.replace(/^#/, '')}` : '';
					this.fieldValues['taskColor'] = value.replace(/^#/, '');
					refreshSwatch(hex);
					this.applyThemeColor();
					this.markEdited();
				},
				onClear: () => {
					swatch.removeClass('is-picker-open');
					delete this.fieldValues['taskColor'];
					refreshSwatch('');
					this.applyThemeColor();
					this.markEdited();
				},
				onClose: () => {
					swatch.removeClass('is-picker-open');
				},
			});
		});
		swatch.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			delete this.fieldValues['taskColor'];
			refreshSwatch('');
			this.applyThemeColor();
			this.markEdited();
		});
	}

	private renderAssigneesPicker(group: HTMLElement): void {
		const setting = new Setting(group);
		setting.settingEl.addClass('operon-assignees-setting', 'operon-editor-assignees-setting');
		const stack = setting.controlEl.createDiv('operon-editor-picker-stack');
		const anchor = this.createPickerAnchor(stack, t('taskEditor', 'assignees'), {
			leadingIcon: this.resolveCompactChipIcon('assignees'),
		});
		const selectedWrap = stack.createDiv('operon-editor-picker-selected operon-editor-assignee-selection-row');

		let selectedValues = normalizeListValues(splitTaskListValue(this.fieldValues['assignees']));
		let closePicker: (() => void) | null = null;

		const closeActivePicker = () => {
			if (!closePicker) return;
			const current = closePicker;
			closePicker = null;
			anchor.removeClass('is-picker-open');
			current();
		};

		const render = () => {
			this.renderCompactSelectionChips(selectedWrap, 'assignees', selectedValues, (value) => {
				closeActivePicker();
				selectedValues = selectedValues.filter(existing => existing !== value);
				this.setDelimitedFieldValue('assignees', selectedValues);
				render();
				this.markEdited();
				this.refreshWorkflowPickerSurfaceValues();
			}, value => this.formatInlineReferenceLabel(value));
		};

		const openPicker = () => {
			if (closePicker) return;
			closePicker = showAssigneesPicker(anchor, {
				app: this.app,
				settingsKeyMappings: this.settings.keyMappings,
				allTasks: this.indexer.getAllTasks(),
				value: selectedValues,
				closeOnSelect: this.shouldCloseWorkflowPickerOnSelect(),
				onSave: (values) => {
					const nextValues = normalizeListValues(values);
					if (areStringArraysEqual(selectedValues, nextValues)) return;
					selectedValues = nextValues;
					this.setDelimitedFieldValue('assignees', nextValues);
					render();
					this.markEdited();
					if (selectedValues.length > 0) {
						this.refreshWorkflowActionButtonStates();
					} else {
						closeActivePicker();
						this.refreshWorkflowPickerSurfaceValues();
					}
				},
				onClose: () => {
					closePicker = null;
					anchor.removeClass('is-picker-open');
				},
			});
			anchor.addClass('is-picker-open');
		};

		anchor.addEventListener('click', (event) => {
			event.preventDefault();
			openPicker();
		});
		anchor.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			openPicker();
		});

		this.setDelimitedFieldValue('assignees', selectedValues);
		render();
	}

	private renderLocationPicker(group: HTMLElement): void {
		const setting = new Setting(group);
		setting.settingEl.addClass('operon-location-setting', 'operon-editor-location-setting');
		const stack = setting.controlEl.createDiv('operon-editor-picker-stack operon-editor-location-stack');
		const anchor = this.createPickerAnchor(stack, t('location', 'location'), {
			leadingIcon: this.resolveCompactChipIcon('location'),
		});
		const selectedWrap = stack.createDiv('operon-editor-picker-selected operon-editor-location-selection-row');
		const locationResolver = getLocationPlaceIndex(this.app, this.settings).resolve;
		let selectedValue = parseLocationCoordinate(this.fieldValues['location'])?.canonical
			?? (this.fieldValues['location'] ?? '').trim();
		let closePicker: (() => void) | null = null;

		const closeActivePicker = () => {
			if (!closePicker) return;
			const current = closePicker;
			closePicker = null;
			anchor.removeClass('is-picker-open');
			current();
		};

		const commitValue = (value: string): void => {
			const parsed = parseLocationCoordinate(value);
			if (parsed) {
				selectedValue = parsed.canonical;
				this.fieldValues['location'] = parsed.canonical;
			} else {
				selectedValue = '';
				delete this.fieldValues['location'];
			}
			render();
			this.markEdited();
			this.refreshWorkflowPickerSurfaceValues();
		};

		const render = () => {
			selectedWrap.replaceChildren();
			const parsed = parseLocationCoordinate(selectedValue);
			selectedWrap.classList.toggle('is-empty', !selectedValue);
			if (!selectedValue) return;
			const match = parsed ? locationResolver(parsed.canonical) : null;
			const label = match?.label ?? (parsed ? formatShortLocationCoordinate(parsed) : selectedValue);
			const chip = createInlineTaskCompactChipElement({
				key: 'location',
				label,
				icon: match?.taskIcon ?? this.resolveCompactChipIcon('location'),
				iconOnly: false,
				interactive: false,
				colorRole: 'default',
				linkTarget: null,
				locationCoordinate: parsed?.canonical ?? null,
				locationMarkerIcon: match?.taskIcon ?? null,
				locationMarkerColor: match?.taskColor ?? null,
			}, 'operon-editor-compact-selection-chip', { forceFull: true });
			this.bindTruncatedTextTooltip(chip.querySelector<HTMLElement>('.operon-inline-compact-chip-label'));
			chip.style.setProperty('--operon-inline-chip-icon-color', match?.taskColor ?? this.getThemeColor());
			const removeButton = chip.ownerDocument.win.createEl('button');
			removeButton.type = 'button';
			removeButton.className = 'operon-editor-compact-selection-chip-remove';
			setIcon(removeButton, 'x');
			setAccessibleLabelWithoutTooltip(removeButton, t('taskEditor', 'removeValue', { value: label }));
			removeButton.addEventListener('click', () => {
				closeActivePicker();
				commitValue('');
			});
			chip.appendChild(removeButton);
			selectedWrap.appendChild(chip);
		};

		const openPicker = () => {
			if (closePicker) return;
			closePicker = showLocationPicker(anchor, {
				app: this.app,
				settings: this.settings,
				value: selectedValue,
				onSelect: (value) => {
					commitValue(value);
					closeActivePicker();
				},
				onClear: () => {
					commitValue('');
					closeActivePicker();
				},
				onClose: () => {
					closePicker = null;
					anchor.removeClass('is-picker-open');
				},
			});
			anchor.addClass('is-picker-open');
		};

		anchor.addEventListener('click', (event) => {
			event.preventDefault();
			openPicker();
		});
		anchor.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			openPicker();
		});

		const initialParsed = parseLocationCoordinate(selectedValue);
		if (initialParsed) {
			this.fieldValues['location'] = initialParsed.canonical;
		}
		render();
	}

	private renderLinksPicker(group: HTMLElement): void {
		const setting = new Setting(group);
		setting.settingEl.addClass('operon-links-setting', 'operon-editor-links-setting');
		const stack = setting.controlEl.createDiv('operon-editor-picker-stack');
		const anchor = this.createPickerAnchor(stack, t('taskEditor', 'links'), {
			leadingIcon: this.resolveCompactChipIcon('links'),
		});
		const selectedWrap = stack.createDiv('operon-editor-picker-selected operon-editor-link-selection-row');

		let selectedValues = normalizeListValues(splitTaskListValue(this.fieldValues['links']));
		let closePicker: (() => void) | null = null;

		const closeActivePicker = () => {
			if (!closePicker) return;
			const current = closePicker;
			closePicker = null;
			anchor.removeClass('is-picker-open');
			current();
		};

		const render = () => {
			this.renderCompactSelectionChips(selectedWrap, 'links', selectedValues, (value) => {
				closeActivePicker();
				selectedValues = selectedValues.filter(existing => existing !== value);
				this.setDelimitedFieldValue('links', selectedValues);
				render();
				this.markEdited();
				this.refreshWorkflowPickerSurfaceValues();
			}, formatExternalLinkDisplay);
		};

		const openPicker = () => {
			if (closePicker) return;
			closePicker = showLinksPicker(anchor, {
				app: this.app,
				settingsKeyMappings: this.settings.keyMappings,
				allTasks: this.indexer.getAllTasks(),
				value: selectedValues,
				closeOnSelect: this.shouldCloseWorkflowPickerOnSelect(),
				onSave: (values) => {
					const nextValues = normalizeListValues(values);
					if (areStringArraysEqual(selectedValues, nextValues)) return;
					selectedValues = nextValues;
					this.setDelimitedFieldValue('links', nextValues);
					render();
					this.markEdited();
					if (selectedValues.length > 0) {
						this.refreshWorkflowActionButtonStates();
					} else {
						closeActivePicker();
						this.refreshWorkflowPickerSurfaceValues();
					}
				},
				onClose: () => {
					closePicker = null;
					anchor.removeClass('is-picker-open');
				},
			});
			anchor.addClass('is-picker-open');
		};

		anchor.addEventListener('click', (event) => {
			event.preventDefault();
			openPicker();
		});
		anchor.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			openPicker();
		});

		this.setDelimitedFieldValue('links', selectedValues);
		render();
	}

	private renderRelatedPicker(group: HTMLElement): void {
		const setting = new Setting(group);
		setting.settingEl.addClass('operon-related-setting', 'operon-editor-inline-picker-setting');
		const stack = setting.controlEl.createDiv('operon-editor-picker-stack');
		const anchor = this.createPickerAnchor(stack, t('taskEditor', 'related'), {
			leadingIcon: this.resolveWorkflowPickerIcon('related'),
		});
		const selectedWrap = stack.createDiv('operon-editor-picker-selected operon-editor-related-selection-row');

		let selectedValues = normalizeListValues(splitTaskListValue(this.fieldValues['related']));
		let closePicker: (() => void) | null = null;

		const closeActivePicker = () => {
			if (!closePicker) return;
			const current = closePicker;
			closePicker = null;
			anchor.removeClass('is-picker-open');
			current();
		};

		const render = () => {
			selectedWrap.replaceChildren();
			selectedWrap.classList.toggle('is-empty', selectedValues.length === 0);
			for (const value of selectedValues) {
				const label = this.formatInlineReferenceLabel(value);
				const chip = createInlineTaskCompactChipElement({
					key: 'links',
					label,
					icon: this.resolveWorkflowPickerIcon('related'),
					iconOnly: false,
					interactive: false,
					colorRole: 'default',
					linkTarget: null,
				}, 'operon-editor-compact-selection-chip', { forceFull: true });
				this.bindTruncatedTextTooltip(chip.querySelector<HTMLElement>('.operon-inline-compact-chip-label'));
				const removeButton = chip.ownerDocument.win.createEl('button');
				removeButton.type = 'button';
				removeButton.className = 'operon-editor-compact-selection-chip-remove';
				setIcon(removeButton, 'x');
				setAccessibleLabelWithoutTooltip(removeButton, t('taskEditor', 'removeValue', { value: label }));
				removeButton.addEventListener('click', () => {
					closeActivePicker();
					selectedValues = selectedValues.filter(existing => existing !== value);
					this.setDelimitedFieldValue('related', selectedValues);
					render();
					this.markEdited();
					this.refreshWorkflowPickerSurfaceValues();
				});
				chip.appendChild(removeButton);
				selectedWrap.appendChild(chip);
			}
		};

		const openPicker = () => {
			if (closePicker) return;
			closePicker = showRelatedPicker(anchor, {
				app: this.app,
				allTasks: this.indexer.getAllTasks(),
				value: selectedValues,
				onSave: (values) => {
					const nextValues = normalizeListValues(values);
					if (areStringArraysEqual(selectedValues, nextValues)) return;
					selectedValues = nextValues;
					this.setDelimitedFieldValue('related', nextValues);
					render();
					this.markEdited();
					if (selectedValues.length > 0) {
						this.refreshWorkflowActionButtonStates();
					} else {
						closeActivePicker();
						this.refreshWorkflowPickerSurfaceValues();
					}
				},
				onClose: () => {
					closePicker = null;
					anchor.removeClass('is-picker-open');
				},
			});
			anchor.addClass('is-picker-open');
		};

		anchor.addEventListener('click', (event) => {
			event.preventDefault();
			openPicker();
		});
		anchor.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			openPicker();
		});

		this.setDelimitedFieldValue('related', selectedValues);
		render();
	}

	private renderWorkflowFields(container: HTMLElement): void {
		this.renderWorkflowSurface(container);
	}

	private renderContextsPicker(group: HTMLElement): void {
		const setting = new Setting(group);
		setting.settingEl.addClass('operon-contexts-setting', 'operon-editor-contexts-setting');
		const stack = setting.controlEl.createDiv('operon-editor-picker-stack operon-editor-contexts-stack');
		const anchor = this.createPickerAnchor(stack, t('taskEditor', 'contexts'), {
			leadingIcon: this.resolveCompactChipIcon('contexts'),
		});
		const selectedWrap = stack.createDiv('operon-editor-picker-selected operon-editor-context-selection-row');

		let selectedValues = normalizeListValues(splitTaskListValue(this.fieldValues['contexts']));
		let closePicker: (() => void) | null = null;

		const closeActivePicker = () => {
			if (!closePicker) return;
			const current = closePicker;
			closePicker = null;
			anchor.removeClass('is-picker-open');
			current();
		};

		const render = () => {
			this.renderCompactSelectionChips(selectedWrap, 'contexts', selectedValues, (value) => {
				closeActivePicker();
				selectedValues = selectedValues.filter(existing => existing !== value);
				this.setDelimitedFieldValue('contexts', selectedValues);
				render();
				this.markEdited();
				this.refreshWorkflowPickerSurfaceValues();
			}, formatContextDisplay);
		};

		const openPicker = () => {
			if (closePicker) return;
			closePicker = showContextsPicker(anchor, {
				app: this.app,
				settingsKeyMappings: this.settings.keyMappings,
				allTasks: this.indexer.getAllTasks(),
				value: selectedValues,
				closeOnSelect: this.shouldCloseWorkflowPickerOnSelect(),
				onSave: (values) => {
					const nextValues = normalizeListValues(values);
					if (areStringArraysEqual(selectedValues, nextValues)) return;
					selectedValues = nextValues;
					this.setDelimitedFieldValue('contexts', nextValues);
					render();
					this.markEdited();
					if (selectedValues.length > 0) {
						this.refreshWorkflowActionButtonStates();
					} else {
						closeActivePicker();
						this.refreshWorkflowPickerSurfaceValues();
					}
				},
				onClose: () => {
					closePicker = null;
					anchor.removeClass('is-picker-open');
				},
			});
			anchor.addClass('is-picker-open');
		};

		anchor.addEventListener('click', (event) => {
			event.preventDefault();
			openPicker();
		});
		anchor.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			openPicker();
		});

		this.setDelimitedFieldValue('contexts', selectedValues);
		render();
	}

	private renderTaskListPicker(group: HTMLElement, fieldKey: 'blocking' | 'blockedBy', label: string): void {
		const setting = new Setting(group);
		setting.settingEl.addClass('operon-dependency-setting', 'operon-editor-inline-picker-setting');
		const stack = setting.controlEl.createDiv('operon-editor-picker-stack');
		const anchor = this.createPickerAnchor(stack, label, {
			leadingIcon: this.resolveTaskSelectionIcon(fieldKey),
		});
		const selectedWrap = stack.createDiv('operon-editor-picker-selected operon-editor-task-selection-row');
		const currentTaskId = this.fieldValues['operonId'] ?? this.existingTask?.operonId ?? '';
		const oppositeFieldKey = fieldKey === 'blocking' ? 'blockedBy' : 'blocking';

		let selectedIds = normalizeListValues(
			splitTaskListValue(this.fieldValues[fieldKey]).filter(id => id !== currentTaskId),
		);
		let closePicker: (() => void) | null = null;

		const closeActivePicker = () => {
			if (!closePicker) return;
			const current = closePicker;
			closePicker = null;
			anchor.removeClass('is-picker-open');
			current();
		};

		const render = () => {
			this.renderTaskSelectionChips(selectedWrap, fieldKey, selectedIds, (operonId) => {
				closeActivePicker();
				selectedIds = selectedIds.filter(existing => existing !== operonId);
				this.setDelimitedFieldValue(fieldKey, selectedIds);
				render();
				this.markEdited();
				this.refreshWorkflowPickerSurfaceValues();
			});
		};

		const openPicker = () => {
			if (closePicker) return;
			closePicker = showDependencyTaskPicker(anchor, {
				fieldKey,
				value: selectedIds.join('; '),
				oppositeValue: this.fieldValues[oppositeFieldKey] ?? '',
				allTasks: this.indexer.getAllTasks(),
				getAllTasks: () => this.indexer.getAllTasks(),
				subscribeIndexUpdates: listener => this.indexer.subscribeIndexUpdates(listener),
				pipelines: this.settings.pipelines,
				keyMappings: this.settings.keyMappings,
				excludedIds: currentTaskId ? [currentTaskId] : [],
				closeOnSelect: this.shouldCloseWorkflowPickerOnSelect(),
				onSave: (payload) => {
					const nextIds = normalizeListValues(splitTaskListValue(payload[fieldKey]).filter(id => id !== currentTaskId));
					const nextValue = (payload[fieldKey] ?? '').trim();
					const nextOppositeValue = (payload[oppositeFieldKey] ?? '').trim();
					if (areStringArraysEqual(selectedIds, nextIds)
						&& nextValue === (this.fieldValues[fieldKey] ?? '').trim()
						&& nextOppositeValue === (this.fieldValues[oppositeFieldKey] ?? '').trim()) {
						return;
					}
					selectedIds = nextIds;
					this.setDelimitedFieldValue(fieldKey, nextIds);
					if (nextOppositeValue) this.fieldValues[oppositeFieldKey] = nextOppositeValue;
					else delete this.fieldValues[oppositeFieldKey];
					render();
					this.markEdited();
					if (selectedIds.length > 0) {
						this.refreshWorkflowActionButtonStates();
					} else {
						closeActivePicker();
						this.refreshWorkflowPickerSurfaceValues();
					}
				},
				onClose: () => {
					closePicker = null;
					anchor.removeClass('is-picker-open');
				},
			});
			anchor.addClass('is-picker-open');
		};

		anchor.addEventListener('click', (event) => {
			event.preventDefault();
			openPicker();
		});
		anchor.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			openPicker();
		});

		this.setDelimitedFieldValue(fieldKey, selectedIds);
		render();
	}

	private renderSubtaskPicker(group: HTMLElement): void {
		const currentTaskId = this.fieldValues['operonId'] ?? this.existingTask?.operonId ?? '';

		const setting = new Setting(group);
		setting.settingEl.addClass('operon-dependency-setting', 'operon-editor-inline-picker-setting');
		const stack = setting.controlEl.createDiv('operon-editor-picker-stack');
		const anchor = this.createPickerAnchor(stack, t('taskEditor', 'subtasks'), {
			leadingIcon: this.resolveTaskSelectionIcon('subtasks'),
		});
		const selectedWrap = stack.createDiv('operon-editor-picker-selected operon-editor-task-selection-row');

		let closePicker: (() => void) | null = null;

		const closeActivePicker = () => {
			if (!closePicker) return;
			const current = closePicker;
			closePicker = null;
			anchor.removeClass('is-picker-open');
			current();
		};

		// If no operonId yet, keep the same surface but block interaction.
		if (!currentTaskId) {
			anchor.addClass('is-locked');
			this.bindEditorHoverTooltip(anchor, {
				content: t('taskEditor', 'subtasksSaveFirst'),
				taskColor: () => this.getThemeColor(),
			});
			anchor.addEventListener('click', event => {
				event.preventDefault();
			});
			anchor.addEventListener('keydown', event => {
				if (event.key !== 'Enter' && event.key !== ' ') return;
				event.preventDefault();
			});
			return;
		}

		const excludedIds = new Set<string>([currentTaskId, ...this.collectAncestorIds(currentTaskId)]);

		let selectedIds: string[] = this.getWorkflowSubtaskIds(currentTaskId);

		const render = () => {
			this.renderTaskSelectionChips(selectedWrap, 'subtasks', selectedIds, (operonId) => {
				closeActivePicker();
				selectedIds = selectedIds.filter(existing => existing !== operonId);
				this.workflowDraftSubtaskParentId = currentTaskId;
				this.workflowDraftSubtaskIds = [...selectedIds];
				render();
				this.updateExistingSubtaskParent(operonId, null);
				this.refreshWorkflowPickerSurfaceValues();
			});
			if (group.hasClass('operon-editor-desktop-property-value')) this.setupDesktopSubtaskLayout(selectedWrap);
		};

		const syncParentLinks = (nextIds: string[]) => {
			const previousIds = selectedIds;
			const normalizedNext = normalizeListValues(nextIds.filter(id => !excludedIds.has(id)));
			if (areStringArraysEqual(previousIds, normalizedNext)) return;
			selectedIds = normalizedNext;
			this.workflowDraftSubtaskParentId = currentTaskId;
			this.workflowDraftSubtaskIds = [...selectedIds];
			render();
			const removedIds = previousIds.filter(id => !normalizedNext.includes(id));
			const addedIds = normalizedNext.filter(id => !previousIds.includes(id));
			for (const removedId of removedIds) {
				this.updateExistingSubtaskParent(removedId, null);
			}
			for (const addedId of addedIds) {
				this.updateExistingSubtaskParent(addedId, currentTaskId);
			}
			this.refreshWorkflowPickerSurfaceValues();
		};

		const openPicker = () => {
			if (closePicker) return;
			closePicker = showSubtasksPicker(anchor, {
				value: selectedIds,
				allTasks: this.indexer.getAllTasks(),
				excludedIds: Array.from(excludedIds),
				closeOnSelect: this.shouldCloseWorkflowPickerOnSelect(),
				onChange: (operonIds) => syncParentLinks(operonIds),
				onClose: () => {
					closePicker = null;
					anchor.removeClass('is-picker-open');
				},
			});
			anchor.addClass('is-picker-open');
		};

		anchor.addEventListener('click', (event) => {
			event.preventDefault();
			openPicker();
		});
		anchor.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			openPicker();
		});

		render();
	}

	private renderParentTaskPicker(group: HTMLElement): void {
		const setting = new Setting(group);
		setting.settingEl.addClass('operon-editor-parent-setting', 'operon-editor-inline-picker-setting');
		const parentStack = setting.controlEl.createDiv('operon-editor-picker-stack operon-editor-picker-stack--single');
		const parentAnchor = this.createPickerAnchor(parentStack, t('taskEditor', 'parentTask'), {
			leadingIcon: this.resolveTaskSelectionIcon('parentTask'),
		});
		const parentSelectedWrap = parentStack.createDiv('operon-editor-picker-selected operon-editor-task-selection-row');
		const currentTaskId = this.fieldValues['operonId'] ?? this.existingTask?.operonId ?? '';
		const excludedParentIds = new Set<string>();
		if (currentTaskId) {
			excludedParentIds.add(currentTaskId);
			for (const descendantId of this.indexer.secondary.getAllDescendantIds(currentTaskId)) {
				excludedParentIds.add(descendantId);
			}
		}
		let selectedParentId = (this.fieldValues['parentTask'] ?? '').trim();
		let closePicker: (() => void) | null = null;

		const closeActivePicker = () => {
			if (!closePicker) return;
			const current = closePicker;
			closePicker = null;
			parentAnchor.removeClass('is-picker-open');
			current();
		};

		const render = () => {
			parentSelectedWrap.replaceChildren();
			parentSelectedWrap.classList.toggle('is-empty', !selectedParentId);
			parentAnchor.classList.toggle('is-locked', !!selectedParentId);
			this.bindEditorHoverTooltip(parentAnchor, {
				content: selectedParentId ? t('taskEditor', 'parentTaskClearFirst') : '',
				taskColor: () => this.getThemeColor(),
			});
			if (!selectedParentId) return;
			const task = this.indexer.getTask(selectedParentId);
			const label = task?.description?.trim() || selectedParentId;
			parentSelectedWrap.appendChild(this.createTaskSelectionChip(
				label,
				this.resolveTaskSelectionIcon('parentTask'),
				t('taskEditor', 'parentTaskClearCurrent'),
				() => {
					closeActivePicker();
					selectedParentId = '';
					delete this.fieldValues['parentTask'];
					render();
					this.markEdited();
					this.refreshEstimateReallocationControl?.();
					this.refreshWorkflowPickerSurfaceValues();
					window.requestAnimationFrame(() => parentAnchor.focus());
				},
			));
		};

		const openPicker = () => {
			if (closePicker || selectedParentId) return;
			const filteredTasks = this.indexer
				.getAllTasks()
				.filter(task => !excludedParentIds.has(task.operonId));
			closePicker = showParentTaskPicker(parentAnchor, {
				rankingTasks: this.indexer.getAllTasks(),
				value: selectedParentId,
				allTasks: filteredTasks,
				onSelect: (operonId) => {
					selectedParentId = operonId.trim();
					if (selectedParentId) this.fieldValues['parentTask'] = selectedParentId;
					else delete this.fieldValues['parentTask'];
					render();
					this.markEdited();
					this.refreshEstimateReallocationControl?.();
					this.refreshWorkflowActionButtonStates();
				},
				onClose: () => {
					closePicker = null;
					parentAnchor.removeClass('is-picker-open');
				},
			});
			parentAnchor.addClass('is-picker-open');
		};

		parentAnchor.addEventListener('click', (event) => {
			event.preventDefault();
			if (selectedParentId) return;
			openPicker();
		});
		parentAnchor.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			if (selectedParentId) return;
			openPicker();
		});

		render();
	}

	private renderActions(_container: HTMLElement): void {
		return;
	}

	private async requestSubtask(requestedKind?: 'inline'): Promise<void> {
		if (!this.description.trim()) {
			new Notice(t('notifications', 'taskSaveFailed'));
			return;
		}

		if (!this.fieldValues['operonId']) {
			this.fieldValues['operonId'] = generateOperonId();
		}
		const saved = await this.flushPendingEdits();

		if (!saved || !this.onRequestSubtask || !this.fieldValues['operonId']) {
			new Notice(t('notifications', 'taskSaveFailed'));
			return;
		}

		try {
			await this.onRequestSubtask({
				requestedKind,
				parentOperonId: this.fieldValues['operonId'],
				parentDescription: this.description,
				parentFieldValues: { ...this.fieldValues },
				parentTags: [...this.tags],
				onBeforeCreate: () => this.flushPendingEdits(),
				onCreated: () => this.refreshAfterExternalSubtaskCreated(),
			});
		} catch {
			new Notice(t('notifications', 'taskSaveFailed'));
		}
	}

	private getCurrentOperonId(): string | null {
		return this.fieldValues['operonId'] ?? this.existingTask?.operonId ?? null;
	}

	private getCurrentIndexedTask(): IndexedTask | null {
		const operonId = this.getCurrentOperonId();
		return operonId ? this.indexer.getTask(operonId) ?? null : null;
	}

	private getCurrentTaskSessions(): TrackerSession[] {
		const operonId = this.getCurrentOperonId();
		return operonId ? this.timeTracker.getTaskSessions(operonId) : [];
	}

	private syncTrackingFieldsFromIndex(): void {
		const indexed = this.getCurrentIndexedTask();
		if (!indexed) return;

		for (const key of ['trackers', 'duration', 'activeTracker', 'totalEstimate', 'totalDuration', 'datetimeModified']) {
			const value = indexed.fieldValues[key] ?? (key === 'datetimeModified' ? indexed.datetimeModified : '');
			if (value) this.fieldValues[key] = value;
			else delete this.fieldValues[key];
			this.syncExistingTaskFieldSnapshot(key, value);
		}
		this.refreshMobileCoreButtons();
	}

	private syncWorkflowFieldsFromIndex(): void {
		const indexed = this.getCurrentIndexedTask();
		if (!indexed) return;

		this.checkbox = indexed.checkbox;
		this.persistedCheckbox = indexed.checkbox;
		for (const key of ['status', 'dateCompleted', 'dateCancelled']) {
			const value = indexed.fieldValues[key] ?? '';
			if (value) {
				this.fieldValues[key] = value;
				this.persistedFieldValues[key] = value;
			} else {
				delete this.fieldValues[key];
				delete this.persistedFieldValues[key];
			}
			this.syncExistingTaskFieldSnapshot(key, value);
		}
		if (this.existingTask) {
			this.existingTask.checkbox = indexed.checkbox;
		}
		this.refreshMobileCoreButtons();
	}

	private syncExistingTaskFieldSnapshot(key: string, value: string): void {
		if (!this.existingTask) return;

		const existingField = this.existingTask.fields.find(field => field.key === key);
		if (!value) {
			if (!existingField) return;
			this.existingTask.fields = this.existingTask.fields.filter(field => field.key !== key);
			return;
		}

		if (existingField) {
			existingField.value = value;
			existingField.rawValue = value;
			return;
		}

		this.existingTask.fields.push(buildTaskEditorOperonField(key, value, this.settings.keyMappings));
	}

	private syncExistingTaskCanonicalState(state: TaskEditorCanonicalState): void {
		if (!this.existingTask) return;

		this.existingTask.description = state.description;
		this.existingTask.checkbox = state.checkbox;
		this.existingTask.tags = [...state.tags];
		if (state.sourceFields) this.existingTask.fields = state.sourceFields.map(field => ({ ...field }));
		const existingKeys = new Set(this.existingTask.fields.map(field => field.key));
		for (const key of existingKeys) {
			if (isManagedTaskFieldCanonicalKey(key, this.settings.keyMappings)
				&& !state.sourceFields?.some(field => field.key === key)
				&& !Object.prototype.hasOwnProperty.call(state.fieldValues, key)) {
				this.syncExistingTaskFieldSnapshot(key, '');
			}
		}
		for (const [key, value] of Object.entries(state.fieldValues)) {
            if (state.sourceFields?.some(field => field.key === key) && !CANONICAL_KEY_MAP.has(key)) continue;
			this.syncExistingTaskFieldSnapshot(key, value);
		}
		this.existingTask.operonId = state.fieldValues['operonId'] ?? this.existingTask.operonId;
	}

	private applyCanonicalSaveCommit(
		state: TaskEditorCanonicalState,
		submitted: {
			description: string;
			checkbox: ParsedTask['checkbox'];
			tags: string[];
			fieldValues: Record<string, string>;
		},
	): void {
		if (this.description === submitted.description) {
			this.description = state.description;
		}
		if (this.checkbox === submitted.checkbox) {
			this.checkbox = state.checkbox;
		}
		if (areStringArraysEqual(this.tags, submitted.tags)) {
			this.tags = [...state.tags];
		}
		this.fieldValues = mergeCanonicalFieldValuesIntoDraft(
			this.fieldValues,
			submitted.fieldValues,
			{ ...Object.fromEntries((state.sourceFields ?? []).map(field => [field.key, field.value])), ...state.fieldValues },
		);

		this.persistedDescription = state.description;
		this.persistedCheckbox = state.checkbox;
		this.persistedTags = [...state.tags];
		this.persistedFieldValues = { ...Object.fromEntries((state.sourceFields ?? []).map(field => [field.key, field.value])), ...state.fieldValues };
		this.syncExistingTaskCanonicalState(state);
	}

	private async ensureTaskReadyForTracking(): Promise<string | null> {
		if (!this.description.trim()) return null;

		if (!this.fieldValues['operonId']) {
			this.fieldValues['operonId'] = generateOperonId();
		}

		const operonId = this.fieldValues['operonId'];
		if (!operonId) return null;

		if (this.hasBeenEdited || this.persistInFlight || !this.getCurrentIndexedTask()) {
			const saved = await this.flushPendingEdits();
			if (!saved) return null;
		}

		const indexed = await this.waitForIndexedTask(operonId);
		if (!indexed) {
			new Notice(t('notifications', 'taskNotInIndex'));
			return null;
		}
		return operonId;
	}

	private async waitForIndexedTask(operonId: string, attempts = 24, delayMs = 60): Promise<IndexedTask | null> {
		for (let attempt = 0; attempt < attempts; attempt++) {
			const task = this.indexer.getTask(operonId);
			if (task) return task;
			await delayWithActiveWindow(delayMs);
		}
		return null;
	}

	private async flushPendingEdits(): Promise<boolean> {
		const outcome = await this.flushPendingEditsOutcome('explicit-save');
		return outcome.ok && outcome.clean;
	}

	private async flushPendingEditsOutcome(reason: PersistReason): Promise<TaskEditorSaveOutcome> {
		for (let attempt = 0; attempt < 2; attempt += 1) {
			const outcome = await this.persistEditorState(reason);
			if (!outcome.ok || this.readSource && this.disposed) return outcome;
			if (!this.hasBeenEdited) {
				return { ...outcome, clean: true };
			}
			if (!this.description.trim()) {
				return { ok: false, reason: 'description-required' };
			}
		}
		return { ok: false, reason: 'edit-raced' };
	}

	private createSessionActionButton(container: HTMLElement, iconName: string, label: string): HTMLButtonElement {
		const button = container.createEl('button', {
			cls: 'operon-editor-core-action-btn operon-editor-tracking-session-action',
			attr: { type: 'button' },
		});
		setIcon(button, iconName);
		setAccessibleLabelWithoutTooltip(button, label);
		this.bindTaskEditorTooltip(button, label);
		return button;
	}

	private formatSessionTimestamp(value: string): string {
		const date = parseLocalDatetime(value);
		if (!date) return value;
		const dateKey = value.substring(0, 10);
		const dateLabel = this.usesMobileLayout ? formatTrackerDayHeader(this.app, dateKey) : formatUiDate(dateKey, this.settings);
		return `${dateLabel}, ${formatUiTime(this.app, this.settings, value)}`;
	}

	private formatSessionEnd(start: string, end: string): string {
		const startDate = parseLocalDatetime(start);
		const endDate = parseLocalDatetime(end);
		if (!startDate || !endDate) return end;

		const sameDay = startDate.getFullYear() === endDate.getFullYear()
			&& startDate.getMonth() === endDate.getMonth()
			&& startDate.getDate() === endDate.getDate();
		if (!sameDay) return this.formatSessionTimestamp(end);

		return formatUiTime(this.app, this.settings, end);
	}

	// --- Child Task Writer ---

	private updateExistingSubtaskParent(childId: string, parentId: string | null): void {
		const update = this.onUpdateExistingSubtaskParent;
		if (!update) return;
		runAsyncAction('task editor subtask parent update failed', async () => {
			await update(childId, parentId);
		});
	}

	// --- Save Logic ---

	markEdited(): void {
		if (this.disposed) return;
		this.refreshQuickFinishControl?.();
		this.hasBeenEdited = true;
		this.editVersion += 1;
		if ((this.desktopPropertyRows?.size ?? 0) > 0) this.refreshDesktopPropertyRows();
		this.scheduleSave();
	}

	/** Whether the user has made unsaved changes. */
	get isEdited(): boolean {
		return this.hasBeenEdited;
	}

	private scheduleSave(): void {
		if (this.disposed) return;
		if (this.saveTimer) clearWindowTimeout(this.saveTimer);
		if (this.autoSaveSuspended) return;
		this.saveTimer = setWindowTimeout(
			() => { void this.persistEditorState('autosave'); },
			TASK_EDITOR_AUTOSAVE_DELAY_MS,
		);
	}

	private suspendAutoSave(): void {
		this.autoSaveSuspended = true;
		if (this.saveTimer) {
			clearWindowTimeout(this.saveTimer);
			this.saveTimer = null;
		}
	}

	private resumeAutoSave(): void {
		if (this.disposed) return;
		this.autoSaveSuspended = false;
		if (this.hasBeenEdited) {
			this.scheduleSave();
		}
	}

	private normalizeSemanticFieldValues(values: Record<string, string>): Record<string, string> {
		const normalized: Record<string, string> = {};
		for (const [key, value] of Object.entries(values)) {
			if (key === 'pinned' || key === 'datetimeModified') continue;
			const normalizedValue = String(value ?? '').trim();
			if (!normalizedValue) continue;
			normalized[key] = normalizedValue;
		}
		return normalized;
	}

	private getSemanticDraftSnapshot(): TaskEditorSemanticSnapshot {
		return {
			description: this.description.trim(),
			checkbox: this.checkbox,
			tags: normalizeListValues(this.tags.map(tag => tag.replace(/^#/, ''))),
			fieldValues: this.normalizeSemanticFieldValues(this.fieldValues),
			inlineCompletionMode: this.inlineCompletionMode,
		};
	}

	private getSemanticPersistedSnapshot(): TaskEditorSemanticSnapshot {
		return {
			description: this.persistedDescription.trim(),
			checkbox: this.persistedCheckbox,
			tags: normalizeListValues(this.persistedTags.map(tag => tag.replace(/^#/, ''))),
			fieldValues: this.normalizeSemanticFieldValues(this.persistedFieldValues),
			inlineCompletionMode: this.persistedInlineCompletionMode,
		};
	}

	private hasSemanticDraftChanges(): boolean {
		if (this.isNewTask || this.getFilePropertyChanges().length > 0 || this.getInlinePropertyChanges().length > 0) return true;
		const draft = this.getSemanticDraftSnapshot();
		const persisted = this.getSemanticPersistedSnapshot();
		if (draft.description !== persisted.description) return true;
		if (draft.checkbox !== persisted.checkbox) return true;
		if (!areStringArraysEqual(draft.tags, persisted.tags)) return true;
		if (draft.inlineCompletionMode !== persisted.inlineCompletionMode) return true;

		const draftEntries = Object.entries(draft.fieldValues).sort(([left], [right]) => left.localeCompare(right));
		const persistedEntries = Object.entries(persisted.fieldValues).sort(([left], [right]) => left.localeCompare(right));
		if (draftEntries.length !== persistedEntries.length) return true;
		for (let index = 0; index < draftEntries.length; index += 1) {
			const [draftKey, draftValue] = draftEntries[index];
			const [persistedKey, persistedValue] = persistedEntries[index];
			if (draftKey !== persistedKey || draftValue !== persistedValue) return true;
		}

		return false;
	}

	private hasCompactTextCommitIntent(): boolean {
		return (
			this.descriptionCompactEditor?.getCommit().shouldCommit === true
			|| this.noteCompactEditor?.getCommit().shouldCommit === true
		);
	}

	private commitNoOpSaveBaseline(): void {
		this.persistedDescription = this.description;
		this.persistedCheckbox = this.checkbox;
		this.persistedTags = [...this.tags];
		this.persistedFieldValues = { ...this.fieldValues };
		this.persistedFileBodyDraft = this.fileBodyDraft;
		this.persistedInlineCompletionMode = this.inlineCompletionMode;
		this.hasBeenEdited = false;
	}

	private commitEstimateReallocationBaseline(seconds: number): void {
		this.estimateReallocationBaseSeconds = Math.max(0, seconds);
	}

	private syncCheckboxWithWorkflowStatus(): TaskEditorWorkflowSyncResult {
		const currentCompleted = (this.fieldValues['dateCompleted'] ?? '').trim();
		const currentCancelled = (this.fieldValues['dateCancelled'] ?? '').trim();
		const previousCompleted = (this.persistedFieldValues['dateCompleted'] ?? '').trim();
		const previousCancelled = (this.persistedFieldValues['dateCancelled'] ?? '').trim();
		const completedChanged = currentCompleted !== previousCompleted;
		const cancelledChanged = currentCancelled !== previousCancelled;

		if (currentCompleted && currentCancelled) {
			new Notice(t('taskEditor', 'terminalDateConflict'));
			return { ok: false, reason: 'terminal-conflict' };
		}

		let reverseKey: 'dateCompleted' | 'dateCancelled' | null = null;
		let reverseValue = '';
		if (completedChanged && currentCompleted) {
			reverseKey = 'dateCompleted';
			reverseValue = currentCompleted;
		} else if (cancelledChanged && currentCancelled) {
			reverseKey = 'dateCancelled';
			reverseValue = currentCancelled;
		} else if (cancelledChanged) {
			reverseKey = 'dateCancelled';
		} else if (completedChanged) {
			reverseKey = 'dateCompleted';
		}

		if (reverseKey) {
			const resolution = resolveReverseWorkflowFromTerminalDate(
				this.settings.pipelines,
				this.fieldValues['status'],
				this.settings.defaultPipelineName,
				reverseKey,
				reverseValue,
			);
			if (!resolution.isValid || !resolution.workflow) {
				new Notice(resolution.errorMessage ?? t('taskEditor', 'terminalDateWorkflowResolveFailed'));
				return { ok: false, reason: 'workflow-resolution-failed' };
			}

			this.fieldValues['status'] = resolution.workflow.value;
			this.checkbox = resolution.checkbox;
			if (reverseKey === 'dateCompleted' && reverseValue) {
				this.fieldValues['dateCompleted'] = reverseValue;
				delete this.fieldValues['dateCancelled'];
			} else if (reverseKey === 'dateCancelled' && reverseValue) {
				this.fieldValues['dateCancelled'] = reverseValue;
				delete this.fieldValues['dateCompleted'];
			} else {
				delete this.fieldValues['dateCompleted'];
				delete this.fieldValues['dateCancelled'];
			}
			return { ok: true };
		}

		const resolved = resolveWorkflowStatus(this.settings.pipelines, this.fieldValues['status']);
		if (!resolved) return { ok: true };

		const today = localNow().substring(0, 10);
		this.checkbox = resolved.checkbox;

		if (resolved.terminalDateKey === 'dateCompleted') {
			if (!this.fieldValues['dateCompleted']) {
				this.fieldValues['dateCompleted'] = today;
			}
			delete this.fieldValues['dateCancelled'];
		} else if (resolved.terminalDateKey === 'dateCancelled') {
			if (!this.fieldValues['dateCancelled']) {
				this.fieldValues['dateCancelled'] = today;
			}
			delete this.fieldValues['dateCompleted'];
		} else {
			delete this.fieldValues['dateCompleted'];
			delete this.fieldValues['dateCancelled'];
		}
		return { ok: true };
	}

	private async persistEditorState(reason: PersistReason = 'autosave'): Promise<TaskEditorSaveOutcome> {
		const allowedDestroyCloseSave = reason === 'close-save' && this.destroyCloseSaveInFlight;
		if ((this.disposed && !allowedDestroyCloseSave) || this.deleteInProgress) {
			return { ok: false, reason: 'write-rejected' };
		}
		if (this.persistInFlight) return this.persistInFlight;

		const run: Promise<TaskEditorSaveOutcome> = (async (): Promise<TaskEditorSaveOutcome> => {
			this.sourceRefreshGeneration++;
			const versionAtStart = this.editVersion;
			if (this.saveTimer) {
				clearWindowTimeout(this.saveTimer);
				this.saveTimer = null;
			}
			if (!this.description.trim()) return { ok: false, reason: 'description-required' };

			if (!this.fieldValues['operonId']) {
				this.fieldValues['operonId'] = generateOperonId();
			}
			if (parseRepeatRule(this.fieldValues['repeat']) && !this.fieldValues['repeatSeriesId']) {
				this.fieldValues['repeatSeriesId'] = generateRepeatSeriesId();
			}
			this.syncDerivedRepeatFieldsFromDraft();

			this.maybeApplyScheduledAutomationToEditorState();

			const workflowSync = this.syncCheckboxWithWorkflowStatus();
			if (!workflowSync.ok) {
				return workflowSync;
			}

			if (!this.hasSemanticDraftChanges() && !this.hasCompactTextCommitIntent()) {
				this.commitNoOpSaveBaseline();
				this.refreshEstimateReallocationControl?.();
				return { ok: true, status: 'no-change', clean: true };
			}

			this.syncTrackingFieldsFromIndex();

			const now = localNow();
			this.fieldValues['datetimeModified'] = now;

			const fields = Object.entries(this.fieldValues)
				.filter(([key, value]) => key !== 'pinned' && (!!value || !isManagedTaskFieldCanonicalKey(key, this.settings.keyMappings) || this.existingTask?.fields.some(field => field.key === key && field.value === value)))
				.map(([key, value]) => buildTaskEditorOperonField(
					key,
					value,
					this.settings.keyMappings,
					this.existingTask?.fields.find(field => field.key === key),
				));

			const task: ParsedTask = {
				lineNumber: this.existingTask?.lineNumber ?? 0,
				filePath: this.existingTask?.filePath ?? '',
				checkbox: this.checkbox,
				checkboxRange: this.existingTask?.checkboxRange ?? { from: 0, to: 0 },
				timePrefix: this.existingTask?.timePrefix ?? null,
				timePrefixRange: this.existingTask?.timePrefixRange ?? null,
				description: this.description,
				descriptionRange: this.existingTask?.descriptionRange ?? { from: 0, to: 0 },
				fields,
				tags: this.tags,
				tagTokens: this.existingTask?.tagTokens ?? [],
				metadataTailRange: this.existingTask?.metadataTailRange ?? null,
				operonId: this.fieldValues['operonId'],
				rawLine: this.existingTask?.rawLine ?? '',
			};

			const taskLine = serializeTask(task, this.settings.keyMappings);
			const existingParentTaskId = (
				this.existingTask?.fields.find(field => field.key === 'parentTask')?.value ?? ''
			).trim();
			const nextParentTaskId = (this.fieldValues['parentTask'] ?? '').trim();
			const existingScheduledDate = (
				this.existingTask?.fields.find(field => field.key === 'dateScheduled')?.value ?? ''
			).trim();
			const nextScheduledDate = (this.fieldValues['dateScheduled'] ?? '').trim();
			const resolveIntent = (before: string, after: string): 'unchanged' | 'explicitly-set' | 'explicitly-cleared' => {
				if (before === after) return 'unchanged';
				return after ? 'explicitly-set' : 'explicitly-cleared';
			};
			const savedFileProperties = this.getFilePropertyChanges();
   const savedInlineProperties = this.getInlinePropertyChanges();
   if (savedInlineProperties.some(change => !this.canEditFileProperty(this.fileProperties.get(change.sourceName)!))) return { ok: false, reason: 'write-rejected' };
   if (savedFileProperties.length && (this.filePropertyUnavailable || savedFileProperties.some(change => !this.canEditFileProperty(this.fileProperties.get(change.propertyName)!)))) return { ok: false, reason: 'write-rejected' };
			const savedDescription = this.description;
			const savedCheckbox = this.checkbox;
			const savedTags = [...this.tags];
			const savedFieldValues = { ...this.fieldValues };
			const savedCheckboxBodyRevision = this.checkboxBodyRevision;
			const savedFileBodyDraft = this.fileBodyDraft;
			const savedInlineCompletionMode = this.inlineCompletionMode;
			const descriptionSurface = this.descriptionCompactEditor;
			const noteSurface = this.noteCompactEditor;
			const savedDescriptionSurfaceDraft = descriptionSurface?.getDraft() ?? null;
			const savedNoteSurfaceDraft = noteSurface?.getDraft() ?? null;
			const descriptionSurfaceShouldCommit =
				descriptionSurface?.getCommit().shouldCommit ?? false;
			const noteSurfaceShouldCommit =
				noteSurface?.getCommit().shouldCommit ?? false;
			let saveResult: TaskEditorSaveCallbackResult;
   this.submittedFileProperties = new Set([...savedFileProperties.map(change => change.propertyName), ...savedInlineProperties.map(change => change.sourceName)]);
			try {
				saveResult = await this.onSave({
					taskLine,
					...(this.readSource && this.taskOperonId ? { sourceSync: {
						operonId: this.taskOperonId,
						baseline: this.taskSourceState(true),
						changedKeys: taskEditorChangedKeys(this.taskSourceState(true), this.taskSourceState()),
					} } : {}),
                    inlineSourceFields: this.existingTask?.fields.map(field => ({ ...field })),
					isNew: this.isNewTask,
     ...(savedFileProperties.length ? { fileProperties: savedFileProperties } : {}),
     ...(savedInlineProperties.length ? { inlineProperties: savedInlineProperties } : {}),
					parentTaskIntent: resolveIntent(existingParentTaskId, nextParentTaskId),
					dateScheduledIntent: resolveIntent(existingScheduledDate, nextScheduledDate),
					inlineCompletionMode: savedInlineCompletionMode,
					fileBody: this.fileBodyContext
						? {
							filePath: this.fileBodyContext.filePath,
							content: savedFileBodyDraft,
							expectedContent: this.persistedFileBodyDraft,
							dirty: false,
							format: this.fileBodyContext.format,
							targetLine: this.fileBodyContext.targetLine,
						}
						: null,
				});
			} catch (error) {
				console.error('Operon: task editor save failed', error);
				new Notice(t('notifications', 'taskSaveFailed'));
				return { ok: false, reason: 'write-threw' };
			} finally { this.submittedFileProperties.clear(); }
			if (this.readSource && this.disposed) return saveResult === false || saveResult === null
				? { ok: false, reason: 'write-rejected' }
				: { ok: true, status: 'saved', clean: versionAtStart === this.editVersion };
			if (saveResult === false || saveResult === null) {
				return { ok: false, reason: 'write-rejected' };
			}
   for (const change of savedFileProperties) {
    const entry = this.fileProperties.get(change.propertyName);
    const result = isTaskEditorSaveCommit(saveResult) ? saveResult.fileProperties?.find(item => item.propertyName === change.propertyName) : undefined;
    const snapshot = isTaskEditorSaveCommit(saveResult) ? saveResult.filePropertySnapshots?.find(item => item.propertyName === change.propertyName)?.expectation : undefined;
    const committed = snapshot ?? { present: true, value: result ? result.value : change.value };
    if (entry) {
     if (rawYamlPropertyExpectationsEqual({ present: true, value: entry.value as RawYamlPropertyValue }, { present: true, value: change.value })) {
      if (!committed.present) this.fileProperties.delete(change.propertyName);
      else entry.value = Array.isArray(committed.value) ? [...committed.value] : committed.value;
     }
     entry.baseline = committed;
    }
   }
   for (const change of savedInlineProperties) {
    const entry = this.fileProperties.get(change.sourceName);
    const committed = isTaskEditorSaveCommit(saveResult) ? saveResult.inlineProperties?.find(item => item.sourceName.toLowerCase() === change.sourceName.toLowerCase()) : undefined;
    if (!entry || !committed) continue;
    const acknowledged = committed.state === 'valid' ? committed.value : committed.rawValue ?? null;
    if (change.mutation.kind === 'set' && rawYamlPropertyExpectationsEqual({ present: true, value: entry.value as RawYamlPropertyValue }, { present: true, value: change.mutation.value })) {
     if (!committed.present) this.fileProperties.delete(change.sourceName);
     else entry.value = Array.isArray(acknowledged) ? [...acknowledged] : acknowledged;
    }
    entry.inline = committed; entry.baseline = { present: committed.present, value: acknowledged };
    entry.readonly = committed.state !== 'valid' && committed.state !== 'missing';
   }
   if (savedFileProperties.length || savedInlineProperties.length) {
    // A source read captured before this commit cannot replace its acknowledged baseline.
    this.filePropertyGeneration++;
    void this.refreshDesktopFileProperties();
   }

			const descriptionUnchangedSinceSubmit = this.description === savedDescription;
			const noteUnchangedSinceSubmit =
				(this.fieldValues['note'] ?? '') === (savedFieldValues['note'] ?? '');
			const descriptionSurfaceUnchangedSinceSubmit =
				this.descriptionCompactEditor === descriptionSurface
				&& descriptionSurface?.getDraft() === savedDescriptionSurfaceDraft;
			const noteSurfaceUnchangedSinceSubmit =
				this.noteCompactEditor === noteSurface
				&& noteSurface?.getDraft() === savedNoteSurfaceDraft;
			if (isTaskEditorSaveCommit(saveResult)) {
				this.applyCanonicalSaveCommit(saveResult.canonicalState, {
					description: savedDescription,
					checkbox: savedCheckbox,
					tags: savedTags,
					fieldValues: savedFieldValues,
				});
			} else {
				if (saveResult && typeof saveResult === 'object') {
					console.warn('Operon: task editor save returned an invalid canonical state; using submitted state');
				}
				this.persistedDescription = savedDescription;
				this.persistedCheckbox = savedCheckbox;
				this.persistedTags = savedTags;
				this.persistedFieldValues = savedFieldValues;
			}
			if (this.checkboxBodyRevision === savedCheckboxBodyRevision && this.fileBodyDraft === savedFileBodyDraft
				&& isTaskEditorSaveCommit(saveResult) && saveResult.fileBody) {
				const previousSourcePath = this.existingTask?.filePath ?? this.fileBodyContext?.filePath;
				this.fileBodyContext = saveResult.fileBody;
				this.fileBodyDraft = saveResult.fileBody.initialContent;
				this.persistedFileBodyDraft = this.fileBodyDraft;
				if (this.existingTask) {
					this.existingTask.filePath = saveResult.fileBody.filePath;
					this.existingTask.lineNumber = (saveResult.fileBody.targetLine ?? 0) + (saveResult.fileBody.lineNumberOffset ?? 0);
				}
				this.updateSourceContextLayout();
    if (previousSourcePath !== saveResult.fileBody.filePath) this.rootEl?.dispatchEvent(new CustomEvent('operon-editor-source-location', { bubbles: true, detail: { operonId: this.taskOperonId, filePath: saveResult.fileBody.filePath } }));
			} else if (this.checkboxBodyRevision === savedCheckboxBodyRevision) this.persistedFileBodyDraft = savedFileBodyDraft;
			this.persistedInlineCompletionMode = savedInlineCompletionMode;
			const compactTextSourcePath = this.getCompactTextSourcePath();
			if (
				descriptionSurfaceShouldCommit
				&& descriptionUnchangedSinceSubmit
				&& descriptionSurfaceUnchangedSinceSubmit
			) {
				this.descriptionCompactEditor?.acceptCommittedValue(
					this.persistedDescription,
					compactTextSourcePath,
				);
			} else if (!descriptionSurfaceShouldCommit && descriptionSurfaceUnchangedSinceSubmit) {
				this.descriptionCompactEditor?.setSourceValue(
					this.description,
					compactTextSourcePath,
				);
			}
			if (
				noteSurfaceShouldCommit
				&& noteUnchangedSinceSubmit
				&& noteSurfaceUnchangedSinceSubmit
			) {
				this.noteCompactEditor?.acceptCommittedValue(
					this.persistedFieldValues['note'] ?? '',
					compactTextSourcePath,
				);
			} else if (!noteSurfaceShouldCommit && noteSurfaceUnchangedSinceSubmit) {
				this.noteCompactEditor?.setSourceValue(
					this.fieldValues['note'] ?? '',
					compactTextSourcePath,
				);
			}
			if (reason === 'explicit-save' || reason === 'close-save') {
				this.commitEstimateReallocationBaseline(this.getDraftEstimateSeconds());
			}
			this.refreshEstimateReallocationControl?.();

			this.isNewTask = false;
			if (versionAtStart === this.editVersion) {
				this.hasBeenEdited = false;
			} else {
				this.hasBeenEdited = true;
				this.scheduleSave();
			}
			return { ok: true, status: 'saved', clean: !this.hasBeenEdited };
		})();

		this.persistInFlight = run;
		try {
			return await run;
		} finally {
			if (this.persistInFlight === run) {
				this.persistInFlight = null;
				if (this.readSource) void this.refreshTaskSource();
			}
		}
	}

	save(): void {
		void this.persistEditorState('explicit-save');
	}

	private maybeApplyScheduledAutomationToEditorState(): void {
		if (!shouldTriggerOneShotAutomation(this.persistedFieldValues['dateScheduled'], this.fieldValues['dateScheduled'])) {
			return;
		}
		if (this.checkbox !== 'open') return;

		const workflow = resolveAutomationWorkflowStatus(
			this.settings.pipelines,
			this.fieldValues['status'],
			this.settings.defaultPipelineName,
			'scheduled',
		);
		if (!workflow) return;

		this.fieldValues['status'] = workflow.value;
	}
}
