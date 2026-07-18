/**
 * TaskEditorContent — shared render/state logic for the task editor.
 * Mounted into any HTMLElement container (Modal, ItemView, etc.).
 *
 * Spec Section 4.2.
 */

import { App, Component, MarkdownRenderer, Setting, Notice, getIcon, setIcon, TFile, Platform } from 'obsidian';
import { OperonIndexer } from '../indexer/indexer';
import { PinnedCache } from '../storage/pinned-cache';

import { IndexedTask, ParsedTask, OperonField } from '../types/fields';
import type { ProjectSerialDisplay } from '../core/project-serials';
import { CANONICAL_KEY_MAP } from '../types/keys';
import { OperonSettings } from '../types/settings';
import { generateOperonId, generateRepeatSeriesId } from '../core/id-generator';
import {
	resolveAutomationWorkflowStatus,
	resolveReverseWorkflowFromTerminalDate,
	resolveWorkflowStatus,
	shouldTriggerOneShotAutomation,
} from '../types/pipeline';
import { serializeTask } from '../core/serializer';
import { applyFieldRules } from '../core/field-rules';
import { deriveCountModeRepeatEndFromFieldValues } from '../core/task-field-patch';
import { t } from '../core/i18n';
import { formatTaskNotice } from '../core/task-notice';
import { localNow, localToday } from '../core/local-time';
import { resolveTaskDateTone, resolveTaskDateToneColor } from '../core/task-date-tone';
import { parseRepeatRule } from '../core/repeat-rule';
import { formatRepeatRuleSummaryI18n } from '../core/repeat-rule-i18n';
import { formatUiTime } from '../core/ui-time-format';
import { formatShortLocationCoordinate, parseLocationCoordinate } from '../core/location-coordinates';
import { getLocationPlaceIndex } from '../core/location-source-resolver';
import { TimeTracker, type TimeTrackerEvent } from '../systems/time-tracker';
import { bindOperonHoverTooltip, cleanupOperonHoverTooltips } from './operon-hover-tooltip';
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
	TASK_EDITOR_MOBILE_PICKER_CLOSE_EVENT,
	TASK_EDITOR_MOBILE_PICKER_OPEN_EVENT,
	positionFloatingElement,
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
import { buildTrackerSessionEditContext, TrackerSessionEditModal } from './tracker-session-edit-modal';
import { formatTrackerDayHeader } from './tracker-time-labels';
import { EmbeddedMarkdownSourceEditor } from './embedded-markdown-source-editor';
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
import { splitFrontmatterDocument } from '../core/file-task-template-merge';
import { formatContextDisplay } from './field-pickers/contexts-picker';
import { getConfiguredKeyMappingIcon } from '../core/key-mapping-icons';
import { resolveTaskEditorProgressFromStats } from '../core/task-stats-read-model';
import { resolveSubtaskActionIconForKind, resolveSubtaskActionLabelKeyForKind } from '../core/subtask-action';
import { createInlineTaskCompactChipElement, InlineTaskCompactChipEntry } from './compact-task-layout';
import { createProjectSerialChipElement } from './project-serial-chip';
import { INLINE_TASK_COMPACT_FALLBACK_ICONS, InlineTaskCompactChipKey, KeyMapping, TASK_CREATOR_FALLBACK_FIELD_ICONS, TaskEditorWorkflowPickerItem } from '../types/settings';
import { openTaskFieldPicker } from './task-field-picker-dispatch';
import { showPlainCheckboxPopover } from './plain-checkbox-popover';
import {
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
	setWindowTimeout,
} from '../core/dom-compat';
import { asyncHandler, runAsyncAction } from '../core/async-action';
import {
	DEFAULT_INLINE_REPEAT_COMPLETION_MODE,
	InlineRepeatCompletionMode,
	normalizeInlineCompletionMode,
} from '../storage/repeat-series-store';

/** Callback to persist editor state. Returning false/null aborts the save. */
export interface TaskEditorSaveRequest {
	taskLine: string;
	isNew: boolean;
	inlineCompletionMode: InlineRepeatCompletionMode;
	fileBody: {
		filePath: string;
		content: string;
		dirty: boolean;
		format: 'yaml' | 'inline';
		targetLine: number | null;
	} | null;
}

export type OnSaveCallback = (request: TaskEditorSaveRequest) => boolean | null | void | Promise<boolean | null | void>;

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

export interface TaskEditorSubtaskRequest {
	parentOperonId: string;
	parentDescription: string;
	parentFieldValues: Record<string, string>;
	parentTags: string[];
	onBeforeCreate?: () => boolean | Promise<boolean>;
	onCreated?: (createdOperonId: string) => void | Promise<void>;
}

export interface TaskEditorContentOptions {
	focusDescriptionOnMount?: boolean;
	selectDescriptionOnMount?: boolean;
	subtaskActionKind?: 'inline' | 'file';
	onRequestSubtask?: (context: TaskEditorSubtaskRequest) => void | Promise<void>;
	onRequestDelete?: (task: ParsedTask) => void | Promise<boolean | void>;
	onOpenTask?: (operonId: string) => void;
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
type RelationContextChipKey = Extract<InlineTaskCompactChipKey, 'priority' | 'status' | 'dateScheduled' | 'dateDue' | 'dateCompleted' | 'dateCancelled' | 'duration' | 'totalDuration'>;
type MediaQueryChangeListener = (event: MediaQueryListEvent) => void;
type LegacyMediaQueryMethod = (this: MediaQueryList, listener: MediaQueryChangeListener) => void;

const TASK_EDITOR_DAY_PICKER_DATE_KEYS = new Set<string>([
	'dateStarted',
	'dateScheduled',
	'dateDue',
	'dateCompleted',
	'dateCancelled',
]);

export const TASK_EDITOR_AUTOSAVE_DELAY_MS = 2_000;

function getLegacyMediaQueryMethod(mediaQuery: MediaQueryList, methodName: 'addListener' | 'removeListener'): LegacyMediaQueryMethod | null {
	const method = (mediaQuery as unknown as Record<string, unknown>)[methodName];
	return typeof method === 'function' ? method as LegacyMediaQueryMethod : null;
}

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
	totalDuration: number;
	ownEstimate: number;
	subtaskEstimate: number;
	totalEstimate: number;
	hasAnyTimeData: boolean;
};

interface TaskEditorSemanticSnapshot {
	description: string;
	checkbox: 'open' | 'done' | 'cancelled';
	tags: string[];
	fieldValues: Record<string, string>;
	fileBodyDraft: string | null;
	inlineCompletionMode: InlineRepeatCompletionMode;
}

function formatDuration(seconds: number): string {
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	if (h > 0) return `${h}h ${m}m`;
	return `${m}m`;
}

function formatTaskEditorDatetime(app: App, settings: OperonSettings, value: string): string {
	return formatUiTime(app, settings, value);
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

export class TaskEditorContent {
	private static readonly FILE_BODY_WIDE_MEDIA_QUERY = '(min-width: 980px)';

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
	private disposed = false;
	private destroyCloseSaveInFlight = false;
	private deleteInProgress = false;
	private hasBeenEdited = false;
	private focusDescriptionOnMount = true;
	private subtaskActionKind: 'inline' | 'file' = 'inline';
	private onRequestSubtask: ((context: TaskEditorSubtaskRequest) => void | Promise<void>) | null = null;
	private onRequestDelete: ((task: ParsedTask) => void | Promise<boolean | void>) | null = null;
	private onOpenTask: ((operonId: string) => void) | null = null;
	private onUpdateExistingSubtaskParent: ((childId: string, parentId: string | null) => void | Promise<void>) | null = null;
	private getRepeatSkipDates: ((repeatSeriesId: string) => string[]) | null = null;
	private onUpdateRepeatSkips: ((request: TaskEditorRepeatSkipUpdateRequest) => Promise<TaskEditorRepeatSkipUpdateResult> | TaskEditorRepeatSkipUpdateResult) | null = null;
	private onApplyEstimateReallocation: ((
		request: TaskEditorEstimateReallocationRequest,
	) => Promise<TaskEditorEstimateReallocationApplyResult>) | null = null;
	private pinnedCache: PinnedCache | null = null;
	private getProjectSerialDisplay: ((operonId: string) => ProjectSerialDisplay | null) | null = null;
	private taskOperonId: string | null = null;
	private pinnedCacheUnsubscribe: (() => void) | null = null;
	private trackerUnsubscribe: (() => void) | null = null;
	private refreshCorePinControl: (() => void) | null = null;
	private bodyDropdowns: HTMLElement[] = [];
	private refreshCoreTrackerControl: (() => void) | null = null;
	private refreshTrackingSessionsSection: (() => void) | null = null;
	private refreshEstimateReallocationControl: (() => void) | null = null;
	private refreshParentContextSection: (() => void) | null = null;
	private schedulingDraftRefreshers = new Set<() => void>();
	private workflowExpanded = false;
	private workflowActionsEl: HTMLElement | null = null;
	private workflowRowsEl: HTMLElement | null = null;
	private workflowActionButtons = new Map<string, HTMLButtonElement>();
	private workflowActionPickerClose: (() => void) | null = null;
	private workflowDraftSubtaskParentId: string | null = null;
	private workflowDraftSubtaskIds: string[] | null = null;
	private persistInFlight: Promise<TaskEditorSaveOutcome> | null = null;
	private editVersion = 0;
	private selectDescriptionOnMount = false;
	private descriptionInputEl: HTMLTextAreaElement | null = null;
	private noteInputEl: HTMLTextAreaElement | null = null;
	private initialDescriptionFocusTimers: WindowTimeoutHandle[] = [];
	private rootEl: HTMLElement | null = null;
	private shellEl: HTMLElement | null = null;
	private mainPanelEl: HTMLElement | null = null;
	private mobileNoteWrapEl: HTMLElement | null = null;
	private mobileNoteOpen = false;
	private mobilePickerOpenDepth = 0;
	private mobileCoreToolbarEl: HTMLElement | null = null;
	private mobileCoreToolsEl: HTMLElement | null = null;
	private mobileCoreOverflowFrame: number | null = null;
	private mobilePickerCloseFrame: number | null = null;
	private mobileCoreButtonRefreshers = new Set<() => void>();
	private fileBodyPanelEl: HTMLElement | null = null;
	private fileBodyBackdropEl: HTMLButtonElement | null = null;
	private fileBodyToggleButtonEl: HTMLButtonElement | null = null;
	private fileBodySaveButtonEl: HTMLButtonElement | null = null;
	private fileBodyContext: TaskEditorFileBodyContext | null = null;
	private fileBodyDraft = '';
	private persistedFileBodyDraft = '';
	private isFileBodyVisible = false;
	private isFileBodyDirty = false;
	private embeddedBodyEditor: EmbeddedMarkdownSourceEditor | null = null;
	private embedPreviewComponent: Component | null = null;
	private fileBodyMediaQuery: MediaQueryList | null = null;
	private fileBodyMediaQueryHandler: ((event: MediaQueryListEvent) => void) | null = null;
	private fileBodyLayoutRefreshGeneration = 0;
	private fileBodyLayoutRefreshEditor: EmbeddedMarkdownSourceEditor | null = null;
	private fileBodyLayoutRefreshFrame: number | null = null;
	private fileBodyLayoutRefreshTimer: WindowTimeoutHandle | null = null;
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
		this.mobilePickerCloseFrame = getActiveWindow().requestAnimationFrame(() => {
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
		this.existingTask = existingTask;
		this.isNewTask = !existingTask;
		this.onSave = onSave;
		this.timeTracker = timeTracker;
		this.focusDescriptionOnMount = options.focusDescriptionOnMount ?? true;
		this.selectDescriptionOnMount = options.selectDescriptionOnMount ?? this.isNewTask;
		this.subtaskActionKind = options.subtaskActionKind ?? 'inline';
		this.onRequestSubtask = options.onRequestSubtask ?? null;
		this.onRequestDelete = options.onRequestDelete ?? null;
		this.onOpenTask = options.onOpenTask ?? null;
		this.onUpdateExistingSubtaskParent = options.onUpdateExistingSubtaskParent ?? null;
		this.getRepeatSkipDates = options.getRepeatSkipDates ?? null;
		this.onUpdateRepeatSkips = options.onUpdateRepeatSkips ?? null;
		this.onApplyEstimateReallocation = options.onApplyEstimateReallocation ?? null;
		this.pinnedCache = options.pinnedCache ?? null;
		this.getProjectSerialDisplay = options.getProjectSerialDisplay ?? null;
		this.fileBodyContext = options.fileBody ?? null;
		this.fileBodyDraft = options.fileBody?.initialContent ?? '';
		this.persistedFileBodyDraft = this.fileBodyDraft;
		this.isFileBodyVisible = this.fileBodyContext?.format === 'yaml';
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

	private isWideFileBodyViewport(): boolean {
		return window.matchMedia(TaskEditorContent.FILE_BODY_WIDE_MEDIA_QUERY).matches;
	}

	private registerFileBodyViewportListener(): void {
		if (!this.hasFileBodyContext()) return;
		this.fileBodyMediaQuery = window.matchMedia(TaskEditorContent.FILE_BODY_WIDE_MEDIA_QUERY);
		this.fileBodyMediaQueryHandler = () => {
			this.updateFileBodyLayout();
		};
		if (typeof this.fileBodyMediaQuery.addEventListener === 'function') {
			this.fileBodyMediaQuery.addEventListener('change', this.fileBodyMediaQueryHandler);
		} else {
			getLegacyMediaQueryMethod(this.fileBodyMediaQuery, 'addListener')?.call(
				this.fileBodyMediaQuery,
				this.fileBodyMediaQueryHandler,
			);
		}
	}

	private unregisterFileBodyViewportListener(): void {
		if (!this.fileBodyMediaQuery || !this.fileBodyMediaQueryHandler) return;
		if (typeof this.fileBodyMediaQuery.removeEventListener === 'function') {
			this.fileBodyMediaQuery.removeEventListener('change', this.fileBodyMediaQueryHandler);
		} else {
			getLegacyMediaQueryMethod(this.fileBodyMediaQuery, 'removeListener')?.call(
				this.fileBodyMediaQuery,
				this.fileBodyMediaQueryHandler,
			);
		}
		this.fileBodyMediaQuery = null;
		this.fileBodyMediaQueryHandler = null;
	}

	private setFileBodyVisible(visible: boolean, focusEditor = false): void {
		if (!this.hasFileBodyContext()) return;
		const mainPanelScrollTop = this.mainPanelEl?.scrollTop ?? null;
		if (this.isFileBodyVisible === visible) {
			if (visible && focusEditor) {
				getActiveWindow().setTimeout(() => this.embeddedBodyEditor?.focus(), 0);
			}
			return;
		}
		if (!visible) {
			this.clearFileBodyPanelRender();
		}
		this.isFileBodyVisible = visible;
		this.updateFileBodyLayout();
		if (mainPanelScrollTop != null) {
			this.restoreMainPanelScroll(mainPanelScrollTop);
		}
		if (visible && focusEditor) {
			getActiveWindow().setTimeout(() => this.embeddedBodyEditor?.focus(), 0);
		}
	}

	private syncFileBodyDraftFromEditor(): void {
		const value = this.embeddedBodyEditor?.value;
		if (value == null || value === this.fileBodyDraft) return;
		this.handleFileBodyChanged(value);
	}

	private clearFileBodyPanelRender(): void {
		this.cancelFileBodyEditorLayoutRefresh();
		this.syncFileBodyDraftFromEditor();
		if (this.fileBodyPanelEl) cleanupOperonHoverTooltips(this.fileBodyPanelEl);
		this.embedPreviewComponent?.unload();
		this.embedPreviewComponent = null;
		this.embeddedBodyEditor?.destroy();
		this.embeddedBodyEditor = null;
		this.fileBodySaveButtonEl = null;
		this.fileBodyPanelEl?.empty();
	}

	private ensureFileBodyPanelRendered(): void {
		if (!this.fileBodyPanelEl || this.embeddedBodyEditor) return;
		this.renderFileBodyPanel(this.fileBodyPanelEl);
	}

	private restoreMainPanelScroll(scrollTop: number): void {
		const mainPanel = this.mainPanelEl;
		if (!mainPanel) return;
		getActiveWindow().requestAnimationFrame(() => {
			mainPanel.scrollTop = scrollTop;
		});
	}

	private scheduleFileBodyEditorLayoutRefresh(): void {
		if (!this.hasFileBodyContext() || !this.isFileBodyVisible || !this.embeddedBodyEditor) return;
		const editor = this.embeddedBodyEditor;
		if (this.fileBodyLayoutRefreshEditor === editor
			&& (this.fileBodyLayoutRefreshFrame != null || this.fileBodyLayoutRefreshTimer != null)) {
			return;
		}

		this.cancelFileBodyEditorLayoutRefresh();
		const ownerWindow = getActiveWindow();
		const generation = this.fileBodyLayoutRefreshGeneration;
		this.fileBodyLayoutRefreshEditor = editor;
		const refresh = () => {
			if (generation !== this.fileBodyLayoutRefreshGeneration) return;
			if (!this.hasFileBodyContext() || !this.isFileBodyVisible || this.embeddedBodyEditor !== editor) return;
			editor.refreshLayout();
		};

		refresh();
		this.fileBodyLayoutRefreshFrame = ownerWindow.requestAnimationFrame(() => {
			this.fileBodyLayoutRefreshFrame = null;
			refresh();
		});
		this.fileBodyLayoutRefreshTimer = setWindowTimeout(() => {
			this.fileBodyLayoutRefreshTimer = null;
			refresh();
		}, 150);
	}

	private cancelFileBodyEditorLayoutRefresh(): void {
		this.fileBodyLayoutRefreshGeneration += 1;
		if (this.fileBodyLayoutRefreshFrame != null) {
			getActiveWindow().cancelAnimationFrame(this.fileBodyLayoutRefreshFrame);
			this.fileBodyLayoutRefreshFrame = null;
		}
		if (this.fileBodyLayoutRefreshTimer != null) {
			clearWindowTimeout(this.fileBodyLayoutRefreshTimer);
			this.fileBodyLayoutRefreshTimer = null;
		}
		this.fileBodyLayoutRefreshEditor = null;
	}

	private updateFileBodyLayout(): void {
		const shell = this.shellEl;
		if (!shell) return;
		const isVisible = this.hasFileBodyContext() && this.isFileBodyVisible;
		const isWide = this.fileBodyMediaQuery?.matches ?? this.isWideFileBodyViewport();
		const modalEl = this.rootEl?.closest('.operon-task-editor-modal');
		shell.classList.toggle('has-file-body', this.hasFileBodyContext());
		shell.classList.toggle('is-file-body-visible', isVisible);
		shell.classList.toggle('is-file-body-overlay-visible', isVisible && !isWide);
		shell.classList.toggle('is-file-body-wide', isWide);
		modalEl?.classList.toggle('operon-task-editor-modal-has-file-body-context', this.hasFileBodyContext());
		modalEl?.classList.toggle('operon-task-editor-modal-has-file-body', isVisible);
		this.fileBodyBackdropEl?.classList.toggle('is-visible', isVisible && !isWide);
		if (this.fileBodyToggleButtonEl) {
			const tooltip = isVisible
				? t('taskEditor', 'hideFileBodyPanel')
				: t('taskEditor', 'showFileBodyPanel');
			this.fileBodyToggleButtonEl.classList.toggle('is-active', isVisible);
			this.fileBodyToggleButtonEl.setAttr('aria-pressed', String(isVisible));
			setAccessibleLabelWithoutTooltip(this.fileBodyToggleButtonEl, tooltip);
			this.bindTaskEditorTooltip(this.fileBodyToggleButtonEl, tooltip);
		}
		if (isVisible) {
			this.ensureFileBodyPanelRendered();
			this.scheduleFileBodyEditorLayoutRefresh();
		}
	}

	private handleFileBodyChanged(nextBody: string): void {
		if (nextBody === this.fileBodyDraft) return;
		this.fileBodyDraft = nextBody;
		this.isFileBodyDirty = this.fileBodyDraft !== this.persistedFileBodyDraft;
		this.markEdited();
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
		if (!this.fileBodyContext || this.isFileBodyDirty) return;
		const file = this.app.vault.getAbstractFileByPath(this.fileBodyContext.filePath);
		if (!(file instanceof TFile)) return;

		const content = await this.app.vault.cachedRead(file);
		const { body } = splitFrontmatterDocument(content);
		const lineNumberOffset = this.getFrontmatterLineCountFromContent(content);

		this.fileBodyDraft = body;
		this.persistedFileBodyDraft = body;
		this.isFileBodyDirty = false;
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

	private bindTaskEditorTooltip(target: HTMLElement, content: string): void {
		bindOperonHoverTooltip(target, {
			content,
			taskColor: this.getThemeColor(),
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
		if (options.isEmpty || options.showIcon === true) {
			const iconId = this.getCoreFieldIcon(options.canonicalKey);
			if (iconId) {
				const iconWrap = button.createSpan('operon-editor-picker-button-leading-icon');
				setIcon(iconWrap, iconId);
			}
		}
		button.createSpan({ text: options.text, cls: 'operon-editor-picker-button-text' });
	}

	private focusDescriptionField(): boolean {
		const input = this.descriptionInputEl;
		const root = this.rootEl;
		if (!input || !root) return false;
		if (!input.isConnected || !root.isConnected) return false;
		if (Platform.isPhone && root.ownerDocument.querySelector('.operon-task-editor-mobile-picker-surface')) return false;

		input.focus();
		if (input.ownerDocument.activeElement !== input) return false;
		if (this.selectDescriptionOnMount) {
			input.select();
			return true;
		}

		const end = input.value.length;
		input.setSelectionRange(end, end);
		return true;
	}

	private scheduleMobileDescriptionRefocus(): void {
		if (!Platform.isPhone) return;
		const ownerWindow = getActiveWindow();
		ownerWindow.requestAnimationFrame(() => {
			const root = this.rootEl;
			if (!root?.isConnected) return;
			if (root.ownerDocument.querySelector('.operon-task-editor-mobile-picker-surface')) return;
			this.focusDescriptionField();
		});
	}

	public applyInitialDescriptionFocus(): void {
		if (!(this.isNewTask || this.focusDescriptionOnMount)) return;
		this.clearInitialDescriptionFocusTimers();
		for (const delay of [0, 80, 180, 320, 520, 820]) {
			const timer = setWindowTimeout(() => {
				const timerIndex = this.initialDescriptionFocusTimers.indexOf(timer);
				if (timerIndex !== -1) this.initialDescriptionFocusTimers.splice(timerIndex, 1);
				if (this.focusDescriptionField()) this.clearInitialDescriptionFocusTimers();
			}, delay);
			this.initialDescriptionFocusTimers.push(timer);
		}
	}

	public focusDescription(): void {
		this.focusDescriptionField();
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

	private renderFileBodyPanel(container: HTMLElement): void {
		container.empty();
		container.addClass('operon-task-editor-file-panel');

		const overlayHeader = container.createDiv('operon-task-editor-file-panel-overlay-header');
		const filePath = this.fileBodyContext?.filePath ?? '';
		const filePathLastSlash = filePath.lastIndexOf('/');
		const filePathDirectory = filePathLastSlash >= 0 ? filePath.slice(0, filePathLastSlash + 1) : '';
		const filePathName = filePathLastSlash >= 0 ? filePath.slice(filePathLastSlash + 1) : filePath;
		const headerLink = overlayHeader.createEl('button', {
			cls: 'operon-task-editor-file-panel-overlay-link',
			attr: {
				type: 'button',
			},
		});
		headerLink.createSpan({
			text: `${t('taskEditor', 'fileBodyPanelFileLabel')}:`,
			cls: 'operon-task-editor-file-panel-overlay-link-label',
		});
		const headerLinkPath = headerLink.createSpan({
			cls: 'operon-task-editor-file-panel-overlay-link-path',
		});
		if (filePathDirectory) {
			headerLinkPath.createSpan({
				text: filePathDirectory,
				cls: 'operon-task-editor-file-panel-overlay-link-path-dir',
			});
		}
		headerLinkPath.createSpan({
			text: filePathName,
			cls: 'operon-task-editor-file-panel-overlay-link-path-file',
		});
		headerLink.addEventListener('click', () => this.openFileBodySource());
		const headerActions = overlayHeader.createDiv('operon-task-editor-file-panel-overlay-actions');
		const saveButton = headerActions.createEl('button', {
			cls: 'operon-task-editor-file-panel-overlay-action',
			attr: {
				type: 'button',
			},
		});
		this.fileBodySaveButtonEl = saveButton;
		setIcon(saveButton, 'save');
		setAccessibleLabelWithoutTooltip(saveButton, t('buttons', 'save'));
		this.bindTaskEditorTooltip(saveButton, t('buttons', 'save'));
		saveButton.addEventListener('click', () => {
			void this.persistEditorState('explicit-save');
		});
		this.refreshFileBodySaveButtonState();

		const editorHost = container.createDiv('operon-task-editor-file-panel-editor');
		this.embeddedBodyEditor?.destroy();
		const sourceFile = filePath
			? this.app.vault.getAbstractFileByPath(filePath)
			: null;
		this.embeddedBodyEditor = new EmbeddedMarkdownSourceEditor(this.app, editorHost, {
			value: this.fileBodyDraft,
			placeholder: t('taskEditor', 'fileBodyPlaceholder'),
			className: 'operon-task-editor-file-source-editor',
			file: sourceFile instanceof TFile ? sourceFile : null,
			cursorOffset: this.fileBodyContext?.format === 'inline'
				? 0
				: this.fileBodyContext?.cursorOffset ?? 0,
			lineNumberOffset: this.fileBodyContext?.lineNumberOffset ?? 0,
			showLineNumbers: this.settings.taskEditorShowLineNumbers,
			onChange: (value) => this.handleFileBodyChanged(value),
			onEscape: () => {
				if (!(this.fileBodyMediaQuery?.matches ?? this.isWideFileBodyViewport())) {
					this.setFileBodyVisible(false);
					return true;
				}
				this.syncFileBodyDraftFromEditor();
				this.rootEl?.dispatchEvent(new CustomEvent(TASK_EDITOR_ESCAPE_INTENT_EVENT, { bubbles: true }));
				return true;
			},
			onSubmit: () => {
				void this.persistEditorState('explicit-save');
			},
		});

		this.embedPreviewComponent?.unload();
		this.embedPreviewComponent = null;

		const baseLines = this.fileBodyDraft
			.split('\n')
			.filter(line => /^!\[\[.+\.base(#[^\]]+)?\]\]$/.test(line.trim()))
			.join('\n');

		if (baseLines) {
			const previewEl = container.createDiv('operon-task-editor-file-bases-preview');
			this.embedPreviewComponent = new Component();
			this.embedPreviewComponent.load();
			void MarkdownRenderer.render(
				this.app,
				baseLines,
				previewEl,
				this.fileBodyContext?.filePath ?? '',
				this.embedPreviewComponent,
			);
		}
	}

	private renderTaskEditorBody(container: HTMLElement): void {
		const progressState = this.getProgressSectionState();
		// Title
		const titleRow = container.createDiv('operon-task-editor-title-row');
		const titleLeft = titleRow.createDiv('operon-task-editor-title-side is-left');
		this.renderFileBodyToggle(titleLeft, 'operon-task-editor-title-file-toggle');
		titleRow.createEl('h3', {
			text: this.isNewTask ? t('modals', 'newTask') : t('modals', 'editTask'),
			cls: 'operon-task-editor-title',
		});
		const titleRight = titleRow.createDiv('operon-task-editor-title-side is-right');
		this.renderProjectSerialTitleChip(titleRight);
		this.renderCopyOperonIdButton(titleRight);

		this.renderTopContextSection(container, progressState);

		const primaryFields = container.createDiv('operon-task-editor-primary-fields');

		// Primary edit fields should remain in normal document flow when the file body panel toggles.
		this.renderDescriptionNoteSection(primaryFields);
		this.renderTimeSummarySection(primaryFields, progressState);

		// High-frequency fields directly under the primary text and time summaries.
		this.renderCoreSection(container);
		this.renderWorkflowSurface(container);
		this.renderDetailsSection(container);

		// Actions bar
		this.renderActions(container);
	}

	private renderProjectSerialTitleChip(container: HTMLElement): void {
		const operonId = this.taskOperonId?.trim();
		if (!operonId) return;
		const display = this.getProjectSerialDisplay?.(operonId) ?? null;
		if (!display) return;
		container.appendChild(createProjectSerialChipElement(
			display,
			'operon-task-editor-project-serial-chip operon-task-chip',
			{ keyMappings: this.settings.keyMappings, owner: container },
		));
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
		resize();
		textarea.addEventListener('input', () => {
			const normalized = this.normalizeInlineTextFieldValue(textarea.value);
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
			this.setMobileCoreButtonState(button, selectedIds.length > 0);
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
			this.setMobileCoreButtonLabel(button, value ? `${label}: ${value}` : placeholderText);
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
				fieldKey: key,
				value: this.fieldValues[key],
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
		setAccessibleLabelWithoutTooltip(button, label);
		button.title = label;
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
		const style = window.getComputedStyle(textarea);
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
		if (!Platform.isPhone) return;
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
		for (const refresh of this.mobileCoreButtonRefreshers) {
			refresh();
		}
	}

	private scheduleMobileCoreToolbarOverflowState(): void {
		if (!Platform.isPhone || !this.mobileCoreToolbarEl || !this.mobileCoreToolsEl) return;
		if (this.mobileCoreOverflowFrame != null) return;
		this.mobileCoreOverflowFrame = getActiveWindow().requestAnimationFrame(() => {
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
			getActiveWindow().cancelAnimationFrame(this.mobileCoreOverflowFrame);
			this.mobileCoreOverflowFrame = null;
		}
		this.mobileCoreToolbarEl = null;
		this.mobileCoreToolsEl = null;
	}

	private clearMobilePickerCloseFrame(): void {
		if (this.mobilePickerCloseFrame == null) return;
		getActiveWindow().cancelAnimationFrame(this.mobilePickerCloseFrame);
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
		if (this.rootEl && this.rootEl !== container) cleanupOperonHoverTooltips(this.rootEl);
		cleanupOperonHoverTooltips(container);
		container.empty();
		container.addClass('operon-task-editor');
		container.toggleClass('operon-task-editor-mobile', Platform.isPhone);
		this.rootEl?.removeEventListener(TASK_EDITOR_MOBILE_PICKER_OPEN_EVENT, this.mobilePickerOpenHandler);
		this.rootEl?.removeEventListener(TASK_EDITOR_MOBILE_PICKER_CLOSE_EVENT, this.mobilePickerCloseHandler);
		this.rootEl = container;
		container.addEventListener(TASK_EDITOR_MOBILE_PICKER_OPEN_EVENT, this.mobilePickerOpenHandler);
		container.addEventListener(TASK_EDITOR_MOBILE_PICKER_CLOSE_EVENT, this.mobilePickerCloseHandler);
		this.schedulingDraftRefreshers.clear();
		this.mobileCoreButtonRefreshers.clear();
		this.refreshCorePinControl = null;
		this.clearMobileCoreToolbarState();
		this.clearInitialDescriptionFocusTimers();
		window.removeEventListener('resize', this.mobileResizeHandler);
		if (Platform.isPhone) {
			window.addEventListener('resize', this.mobileResizeHandler);
		}
		this.trackerUnsubscribe?.();
		this.trackerUnsubscribe = this.timeTracker.subscribe(event => this.handleTimeTrackerEvent(event));
		this.pinnedCacheUnsubscribe?.();
		this.pinnedCacheUnsubscribe = this.pinnedCache?.subscribe(() => {
			this.refreshCorePinControl?.();
		}) ?? null;

		this.shellEl = container.createDiv('operon-task-editor-shell');
		if (!Platform.isPhone && this.hasFileBodyContext()) {
			this.registerFileBodyViewportListener();
			this.fileBodyBackdropEl = this.shellEl.createEl('button', {
				cls: 'operon-task-editor-file-panel-backdrop',
				attr: {
					type: 'button',
				},
			});
			setAccessibleLabelWithoutTooltip(this.fileBodyBackdropEl, t('taskEditor', 'hideFileBodyPanel'));
			this.fileBodyBackdropEl.addEventListener('click', () => this.setFileBodyVisible(false));
			this.fileBodyPanelEl = this.shellEl.createDiv('operon-task-editor-file-panel');
		}

		this.mainPanelEl = this.shellEl.createDiv('operon-task-editor-main-panel');
		if (Platform.isPhone) {
			this.mobileNoteOpen = !!(this.fieldValues['note'] ?? '').trim();
			this.renderMobileTaskEditorBody(this.mainPanelEl);
		} else {
			this.renderTaskEditorBody(this.mainPanelEl);
		}
		this.applyThemeColor();
		if (!Platform.isPhone) {
			this.updateFileBodyLayout();
		}
		this.scheduleMobileCoreToolbarOverflowState();
	}

	async refreshAfterExternalSubtaskCreated(): Promise<void> {
		if (!this.mainPanelEl) return;

		const saved = await this.flushPendingEdits();
		if (!saved) return;

		this.clearFileBodyPanelRender();
		await this.refreshFileBodyDraftFromSource();
		this.syncTrackingFieldsFromIndex();
		this.schedulingDraftRefreshers.clear();
		this.refreshCorePinControl = null;
		this.refreshCoreTrackerControl = null;
		this.refreshEstimateReallocationControl = null;
		this.refreshParentContextSection = null;
		this.refreshTrackingSessionsSection = null;
		this.workflowActionsEl = null;
		this.workflowRowsEl = null;
		this.workflowActionButtons.clear();
		this.closeActiveWorkflowActionPicker();
		this.workflowDraftSubtaskParentId = null;
		this.workflowDraftSubtaskIds = null;
		this.mobileCoreButtonRefreshers.clear();
		this.descriptionInputEl = null;
		this.noteInputEl = null;
		this.fileBodyToggleButtonEl = null;
		for (const el of this.bodyDropdowns) el.remove();
		this.bodyDropdowns = [];
		this.clearMobileCoreToolbarState();
		this.clearInitialDescriptionFocusTimers();

		cleanupOperonHoverTooltips(this.mainPanelEl);
		this.mainPanelEl.empty();
		if (Platform.isPhone) {
			this.renderMobileTaskEditorBody(this.mainPanelEl);
		} else {
			this.renderTaskEditorBody(this.mainPanelEl);
		}
		this.applyThemeColor();
		if (!Platform.isPhone) {
			this.updateFileBodyLayout();
		}
		this.scheduleMobileCoreToolbarOverflowState();
	}

	beginCloseSave(): Promise<TaskEditorSaveOutcome> {
		this.syncFileBodyDraftFromEditor();
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
		this.syncFileBodyDraftFromEditor();
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
		let closeSave: Promise<TaskEditorSaveOutcome> | null = null;
		if (!options.skipCloseSave && this.hasBeenEdited && this.description.trim()) {
			this.destroyCloseSaveInFlight = true;
			closeSave = this.beginCloseSave().finally(() => {
				this.destroyCloseSaveInFlight = false;
			});
		}
		if (this.rootEl) cleanupOperonHoverTooltips(this.rootEl);
		this.disposed = true;
		window.removeEventListener('resize', this.mobileResizeHandler);
		this.pinnedCacheUnsubscribe?.();
		this.pinnedCacheUnsubscribe = null;
		this.trackerUnsubscribe?.();
		this.trackerUnsubscribe = null;
		this.unregisterFileBodyViewportListener();
		this.cancelFileBodyEditorLayoutRefresh();
		this.schedulingDraftRefreshers.clear();
		this.mobileCoreButtonRefreshers.clear();
		this.refreshCorePinControl = null;
		this.refreshCoreTrackerControl = null;
		this.refreshEstimateReallocationControl = null;
		this.refreshParentContextSection = null;
		this.workflowActionsEl = null;
		this.workflowRowsEl = null;
		this.workflowActionButtons.clear();
		this.closeActiveWorkflowActionPicker();
		this.workflowDraftSubtaskParentId = null;
		this.workflowDraftSubtaskIds = null;
		for (const el of this.bodyDropdowns) el.remove();
		this.bodyDropdowns = [];
		this.refreshTrackingSessionsSection = null;
		this.embedPreviewComponent?.unload();
		this.embedPreviewComponent = null;
		this.embeddedBodyEditor?.destroy();
		this.embeddedBodyEditor = null;
		this.fileBodyPanelEl = null;
		this.fileBodyBackdropEl = null;
		this.fileBodyToggleButtonEl = null;
		this.fileBodySaveButtonEl = null;
		this.mobileNoteWrapEl = null;
		this.mobilePickerOpenDepth = 0;
		this.clearMobilePickerCloseFrame();
		this.clearMobileCoreToolbarState();
		this.mainPanelEl = null;
		this.shellEl = null;
		this.rootEl?.removeEventListener(TASK_EDITOR_MOBILE_PICKER_OPEN_EVENT, this.mobilePickerOpenHandler);
		this.rootEl?.removeEventListener(TASK_EDITOR_MOBILE_PICKER_CLOSE_EVENT, this.mobilePickerCloseHandler);
		this.rootEl = null;
		this.descriptionInputEl = null;
		this.noteInputEl = null;
		this.clearInitialDescriptionFocusTimers();

		if (closeSave) void closeSave;

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
		mapping: KeyMapping,
		onRemove: (value: string) => void,
	): void {
		container.replaceChildren();
		const rawValue = normalizeCustomFieldRawValue((this.fieldValues as Record<string, unknown>)[mapping.canonicalKey]);
		const values = mapping.type === 'list'
			? splitTaskListValue(rawValue)
			: rawValue
				? [rawValue]
				: [];
		container.classList.toggle('is-empty', values.length === 0);
		for (const value of values) {
			const chip = createInlineTaskCompactChipElement({
				key: mapping.canonicalKey,
				label: this.formatCustomFieldDisplayValue(mapping, value),
				icon: getCustomFieldIcon(mapping),
				iconOnly: false,
				interactive: false,
				colorRole: 'default',
				linkTarget: null,
			}, 'operon-editor-compact-selection-chip', { forceFull: true });
			const removeButton = chip.ownerDocument.win.createEl('button');
			removeButton.type = 'button';
			removeButton.className = 'operon-editor-compact-selection-chip-remove';
			setIcon(removeButton, 'x');
			setAccessibleLabelWithoutTooltip(removeButton, t('taskEditor', 'removeValue', {
				value: this.formatCustomFieldDisplayValue(mapping, value),
			}));
			removeButton.addEventListener('click', () => onRemove(value));
			chip.appendChild(removeButton);
			container.appendChild(chip);
		}
	}

	private formatCustomFieldDisplayValue(mapping: KeyMapping, value: string): string {
		const trimmed = value.trim();
		if (mapping.type === 'datetime') return formatTaskEditorDatetime(this.app, this.settings, trimmed);
		if (mapping.type === 'date') return trimmed;
		return trimmed;
	}

	// --- Renderers ---

	private renderTopContextSection(container: HTMLElement, progressState: EditorProgressSectionState | null): void {
		const section = container.createDiv('operon-editor-top-context-section');
		const relations = section.createDiv('operon-editor-top-context-relations');
		const updateVisibility = () => {
			const hasRelations = relations.querySelector(
				'.operon-editor-parent-card, .operon-editor-subtask-card, .operon-subtask-show-more',
			) != null;
			const hasProgress = section.querySelector('.operon-editor-progress') != null;
			relations.hidden = !hasRelations;
			section.hidden = !hasRelations && !hasProgress;
		};

		this.renderParentContext(relations, updateVisibility);
		this.renderSubtaskCards(relations);
		this.renderProgressSection(section, progressState);
		updateVisibility();
	}

	private renderParentContext(container: HTMLElement, onRender?: () => void): void {
		const host = container.createDiv('operon-editor-parent-context-host');
		const render = (): void => {
			cleanupOperonHoverTooltips(host);
			host.empty();
			const parentId = this.fieldValues['parentTask'];
			if (!parentId) {
				onRender?.();
				return;
			}

			const parent = this.indexer.getTask(parentId);
			if (!parent) {
				onRender?.();
				return;
			}

			const parentEl = host.createDiv('operon-editor-parent-card');
			parentEl.style.setProperty('--operon-relation-context-color', this.resolveRelationContextColor(parent, 'parent'));
			const line1 = parentEl.createDiv('operon-parent-line-1');
			const iconWrap = line1.createSpan('operon-parent-header-icon');
			const parentIcon = getIcon('arrow-big-up');
			if (parentIcon) {
				iconWrap.appendChild(parentIcon);
			} else {
				iconWrap.setText('↑');
			}
			line1.createSpan({ text: parent.description || parentId, cls: 'operon-parent-inline-title' });

			if (this.onOpenTask) {
				const editBtn = line1.createEl('button', {
					cls: 'operon-parent-edit-btn',
					attr: { type: 'button' },
				});
				setIcon(editBtn, 'settings-2');
				setAccessibleLabelWithoutTooltip(editBtn, t('taskEditor', 'openParentTask'));
				bindOperonHoverTooltip(editBtn, {
					content: t('taskEditor', 'openParentTask'),
					taskColor: this.resolveRelationContextColor(parent, 'parent'),
				});
				editBtn.addEventListener('click', (e) => {
					e.stopPropagation();
					this.onOpenTask?.(parentId);
				});
			}

			const parentChips = this.buildRelationContextChipEntries(parent);
			if (parentChips.length > 0) {
				const line2 = parentEl.createDiv('operon-parent-line-2');
				this.renderRelationContextChips(line2, parent, parentChips, 'operon-parent-chip');
			}
			onRender?.();
		};

		this.refreshParentContextSection = render;
		render();
	}

	private buildRelationContextChipEntries(task: IndexedTask): InlineTaskCompactChipEntry[] {
		const entries: InlineTaskCompactChipEntry[] = [];
		for (const key of this.getRelationContextChipKeys(task)) {
			const entry = this.createRelationContextChipEntry(task, key);
			if (entry) entries.push(entry);
		}
		return entries;
	}

	private getRelationContextChipKeys(task: IndexedTask): RelationContextChipKey[] {
		if (task.fieldValues['dateCancelled']?.trim() || task.checkbox === 'cancelled') {
			return ['priority', 'dateCancelled', 'duration', 'totalDuration'];
		}
		if (task.fieldValues['dateCompleted']?.trim() || task.checkbox === 'done') {
			return ['priority', 'dateCompleted', 'duration', 'totalDuration'];
		}
		return ['priority', 'status', 'dateScheduled', 'dateDue', 'duration', 'totalDuration'];
	}

	private createRelationContextChipEntry(task: IndexedTask, key: RelationContextChipKey): InlineTaskCompactChipEntry | null {
		const rawValue = task.fieldValues[key]?.trim() ?? '';
		let label = rawValue;
		if (key === 'duration' || key === 'totalDuration') {
			const seconds = Number.parseInt(rawValue, 10);
			if (!Number.isFinite(seconds) || seconds <= 0) return null;
			label = formatDuration(seconds);
		} else if (!rawValue) {
			return null;
		}

		const entry: InlineTaskCompactChipEntry = {
			key,
			label,
			icon: this.resolveCompactChipIcon(key),
			iconOnly: false,
			interactive: false,
			colorRole: key === 'priority' ? 'priority' : key === 'status' ? 'status' : 'default',
			linkTarget: null,
		};
		if (key === 'dateScheduled' || key === 'dateDue') {
			entry.iconTone = resolveTaskDateTone(key, rawValue, task.fieldValues);
		}
		return entry;
	}

	private renderRelationContextChips(
		container: HTMLElement,
		task: IndexedTask,
		entries: InlineTaskCompactChipEntry[],
		extraClass: string,
	): void {
		for (const entry of entries) {
			const chip = createInlineTaskCompactChipElement(entry, `operon-relation-context-chip ${extraClass}`, { forceFull: true });
			this.applyRelationContextChipVisualStyles(chip, entry, task);
			container.appendChild(chip);
		}
	}

	private applyRelationContextChipVisualStyles(
		chip: HTMLElement,
		entry: InlineTaskCompactChipEntry,
		task: IndexedTask,
	): void {
		if (entry.colorRole === 'priority') {
			const def = this.settings.priorities.find(priority => priority.label === task.fieldValues['priority']);
			if (def) chip.style.setProperty('--operon-inline-chip-icon-color', def.color);
		}
		if (entry.colorRole === 'status') {
			const status = resolveWorkflowStatus(this.settings.pipelines, task.fieldValues['status']);
			chip.style.setProperty('--operon-inline-chip-icon-color', status?.definition.color ?? '#6b7280');
		}
		const dateToneColor = resolveTaskDateToneColor(entry.iconTone ?? 'default');
		if (dateToneColor) chip.setCssProps({ '--operon-inline-chip-icon-color': dateToneColor });
	}

	private resolveRelationContextColor(task: IndexedTask, role: 'parent' | 'child'): string {
		const color = (task.fieldValues['taskColor'] ?? '').trim().replace(/^#/, '');
		if (/^([0-9a-fA-F]{6})$/.test(color)) return `#${color}`;
		return role === 'parent'
			? 'var(--color-red)'
			: 'var(--operon-task-editor-accent, var(--interactive-accent))';
	}

	private getProgressDescendantTasks(operonId: string): IndexedTask[] {
		const descendants: IndexedTask[] = [];
		for (const descendantId of this.indexer.secondary.getAllDescendantIds(operonId)) {
			if (descendantId === operonId) continue;
			const task = this.indexer.getTask(descendantId);
			if (task) descendants.push(task);
		}
		return descendants;
	}

	private renderSubtaskCards(container: HTMLElement): void {
		const operonId = this.existingTask?.operonId;
		if (!operonId) return;

		const childIds = this.indexer.secondary.getChildIds(operonId);
		if (!childIds || childIds.size === 0) return;

		const SUBTASK_PREVIEW_COUNT = 1;

		const sorted = [...childIds]
			.map(id => this.indexer.getTask(id))
			.filter((c): c is IndexedTask => !!c)
			.sort((a, b) => b.datetimeModified.localeCompare(a.datetimeModified));

		const hiddenCards: HTMLElement[] = [];

		for (let i = 0; i < sorted.length; i++) {
			const child = sorted[i];
			const cardEl = container.createDiv('operon-editor-subtask-card');
			cardEl.style.setProperty('--operon-relation-context-color', this.resolveRelationContextColor(child, 'child'));

			const line1 = cardEl.createDiv('operon-subtask-line-1');
			const iconWrap = line1.createSpan('operon-subtask-header-icon');
			const subtaskIcon = getIcon('arrow-big-down');
			if (subtaskIcon) {
				iconWrap.appendChild(subtaskIcon);
			} else {
				iconWrap.setText('↓');
			}
			line1.createSpan({ text: child.description || child.operonId, cls: 'operon-subtask-inline-title' });

			if (this.onOpenTask) {
				const editBtn = line1.createEl('button', {
					cls: 'operon-subtask-edit-btn',
					attr: { type: 'button' },
				});
				setIcon(editBtn, 'settings-2');
				setAccessibleLabelWithoutTooltip(editBtn, t('taskEditor', 'editSubtask'));
				bindOperonHoverTooltip(editBtn, {
					content: t('taskEditor', 'editSubtask'),
					taskColor: this.resolveRelationContextColor(child, 'child'),
				});
				editBtn.addEventListener('click', (e) => {
					e.stopPropagation();
					this.onOpenTask?.(child.operonId);
				});
			}

			const childChips = this.buildRelationContextChipEntries(child);
			if (childChips.length > 0) {
				const line2 = cardEl.createDiv('operon-subtask-line-2');
				this.renderRelationContextChips(line2, child, childChips, 'operon-subtask-chip');
			}

			if (i >= SUBTASK_PREVIEW_COUNT) {
				cardEl.setAttribute('hidden', '');
				hiddenCards.push(cardEl);
			}
		}

		if (hiddenCards.length > 0) {
			const bar = container.createDiv('operon-subtask-show-more');
			const label = bar.createSpan('operon-subtask-show-more-label');
			const chevron = bar.createSpan('operon-subtask-show-more-chevron');
			let expanded = false;

			const refresh = () => {
				if (expanded) {
					label.textContent = t('taskEditor', 'showLess');
					const icon = getIcon('chevron-up');
					chevron.empty();
					if (icon) chevron.appendChild(icon);
				} else {
					label.textContent = t('taskEditor', hiddenCards.length === 1 ? 'showMoreSubtasksOne' : 'showMoreSubtasksMany', {
						count: String(hiddenCards.length),
					});
					const icon = getIcon('chevron-down');
					chevron.empty();
					if (icon) chevron.appendChild(icon);
				}
			};
			refresh();

			bar.addEventListener('click', () => {
				expanded = !expanded;
				for (const card of hiddenCards) {
					if (expanded) card.removeAttribute('hidden');
					else card.setAttribute('hidden', '');
				}
				refresh();
			});
		}
	}

	private renderDescriptionNoteSection(container: HTMLElement): void {
		const section = container.createDiv('operon-editor-text-fields');

		const descriptionGroup = section.createDiv('operon-editor-text-field-group is-description');
		descriptionGroup.createEl('h6', {
			cls: 'operon-editor-core-title-badge operon-editor-text-field-title',
			text: t('taskEditor', 'description'),
		});
		this.renderDescription(descriptionGroup, false);

		const notesGroup = section.createDiv('operon-editor-text-field-group is-notes');
		notesGroup.createEl('h6', {
			cls: 'operon-editor-core-title-badge operon-editor-text-field-title',
			text: t('taskEditor', 'notes'),
		});
		this.renderNote(notesGroup, false);
	}

	private renderDescription(container: HTMLElement, showLabel = true): void {
		const setting = new Setting(container);
		if (showLabel) setting.setName(t('taskEditor', 'description'));
		setting
			.addTextArea(text => {
				text.setValue(this.description);
				text.setPlaceholder(t('taskEditor', 'descriptionPlaceholder'));
				setAccessibleLabelWithoutTooltip(text.inputEl, t('taskEditor', 'description'));
				this.descriptionInputEl = text.inputEl;
				text.inputEl.addClass('operon-editor-description-textarea');
				text.inputEl.rows = 2;

				const autoResize = () => {
					text.inputEl.setCssProps({ height: 'auto' });
					text.inputEl.style.height = `${Math.max(text.inputEl.scrollHeight, 64)}px`;
				};
				autoResize();

				text.onChange(val => {
					this.description = val;
					autoResize();
					this.markEdited();
					this.refreshCoreTrackerControl?.();
					this.refreshTrackingSessionsSection?.();
				});
				text.inputEl.addEventListener('input', autoResize);
			});
		setting.settingEl.addClass('operon-description-setting');
		if (!showLabel) setting.settingEl.addClass('operon-editor-text-field-setting');
	}

	private normalizeInlineTextFieldValue(value: string): string {
		return value.replace(/\s*\r?\n+\s*/g, ' ');
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
		setIcon(iconWrap, Platform.isPhone ? 'chevron-right' : 'search');
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
			container.appendChild(this.createTaskSelectionChip(
				label,
				icon,
				t('taskEditor', 'removeValue', { value: label }),
				() => onRemove(operonId),
			));
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
		setting
			.addTextArea(text => {
				text.setValue(this.fieldValues['note'] ?? '');
				text.setPlaceholder(t('taskEditor', 'notesPlaceholder'));
				setAccessibleLabelWithoutTooltip(text.inputEl, t('taskEditor', 'notes'));
				text.inputEl.addClass('operon-editor-note-textarea');
				text.inputEl.rows = 2;

				const autoResize = () => {
					text.inputEl.setCssProps({ height: 'auto' });
					text.inputEl.style.height = `${Math.max(text.inputEl.scrollHeight, 52)}px`;
				};
				autoResize();

				text.onChange(val => {
					const normalized = this.normalizeInlineTextFieldValue(val);
					if (normalized !== val) {
						text.inputEl.value = normalized;
					}
					if (normalized.trim()) {
						this.fieldValues['note'] = normalized;
					} else {
						delete this.fieldValues['note'];
					}
					autoResize();
					this.markEdited();
				});
				text.inputEl.addEventListener('input', autoResize);
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
			totalDuration,
			ownEstimate,
			subtaskEstimate,
			totalEstimate,
			hasAnyTimeData,
		};
	}

	private renderTimeSummarySection(container: HTMLElement, state: EditorProgressSectionState | null): void {
		if (!state?.hasAnyTimeData) return;
		const hasAnyDuration = state.ownDuration > 0 || (state.hasSubtasks && state.subtaskDuration > 0) || state.totalDuration > 0;
		const hasAnyEstimate = state.ownEstimate > 0 || (state.hasSubtasks && state.subtaskEstimate > 0) || state.totalEstimate > 0;
		if (!hasAnyDuration && !hasAnyEstimate) return;

		const summary = container.createDiv('operon-editor-time-summary');
		const table = summary.createDiv('operon-editor-time-summary-table');
		const tableHeader = table.createDiv('operon-editor-time-summary-row is-header');
		tableHeader.createDiv('operon-editor-time-summary-row-label operon-editor-time-summary-row-corner');
		for (const columnLabel of [
			t('taskEditor', 'timeOwn'),
			t('taskEditor', 'subtasks'),
			t('taskEditor', 'timeTotal'),
		]) {
			tableHeader.createDiv({
				text: columnLabel,
				cls: 'operon-editor-time-summary-col-label',
			});
		}

		const appendRow = (
			label: string,
			rowClass: string,
			cells: Array<{ label: string; value: string | null; tone?: 'good' | 'bad' }>,
		) => {
			const row = table.createDiv(`operon-editor-time-summary-row ${rowClass}`.trim());
			row.createDiv({ text: label, cls: 'operon-editor-time-summary-row-label' });
			let hasVisibleValue = false;

			for (const cell of cells) {
				const cellEl = row.createDiv('operon-editor-time-summary-cell');
				cellEl.dataset.colLabel = cell.label;
				const valueEl = cellEl.createSpan('operon-editor-time-summary-cell-value');
				if (cell.value == null) {
					cellEl.addClass('is-empty');
					valueEl.setText('\u00a0');
				} else {
					hasVisibleValue = true;
					valueEl.setText(cell.value);
				}
				if (cell.tone) cellEl.addClass(`is-${cell.tone}`);
			}

			if (!hasVisibleValue) row.addClass('is-muted');
		};

		if (hasAnyDuration) {
			appendRow(t('taskEditor', 'timeDuration'), 'is-duration', [
				{
					label: t('taskEditor', 'timeOwn'),
					value: state.ownDuration > 0 ? formatDurationHuman(state.ownDuration) : null,
					tone: state.ownEstimate > 0
						? (state.ownDuration < state.ownEstimate ? 'good' : state.ownDuration > state.ownEstimate ? 'bad' : undefined)
						: undefined,
				},
				{
					label: t('taskEditor', 'subtasks'),
					value: state.hasSubtasks && state.subtaskDuration > 0 ? formatDurationHuman(state.subtaskDuration) : null,
					tone: state.hasSubtasks && state.subtaskEstimate > 0
						? (state.subtaskDuration < state.subtaskEstimate ? 'good' : state.subtaskDuration > state.subtaskEstimate ? 'bad' : undefined)
						: undefined,
				},
				{
					label: t('taskEditor', 'timeTotal'),
					value: state.totalDuration > 0 ? formatDurationHuman(state.totalDuration) : null,
					tone: state.totalEstimate > 0
						? (state.totalDuration < state.totalEstimate ? 'good' : state.totalDuration > state.totalEstimate ? 'bad' : undefined)
						: undefined,
				},
			]);
		}

		if (hasAnyEstimate) {
			appendRow(t('taskEditor', 'timeEstimation'), 'is-estimation', [
				{ label: t('taskEditor', 'timeOwn'), value: state.ownEstimate > 0 ? formatDurationHuman(state.ownEstimate) : null },
				{ label: t('taskEditor', 'subtasks'), value: state.hasSubtasks && state.subtaskEstimate > 0 ? formatDurationHuman(state.subtaskEstimate) : null },
				{ label: t('taskEditor', 'timeTotal'), value: state.totalEstimate > 0 ? formatDurationHuman(state.totalEstimate) : null },
			]);
		}
	}

	private renderProgressSection(container: HTMLElement, state: EditorProgressSectionState | null): void {
		if (!state?.hasSubtasks && !state?.hasPlainCheckboxes) return;

		const section = container.createDiv('operon-editor-progress');
		const renderProgressRow = (done: number, total: number, label: string, percent: number, cls: string) => {
			const row = section.createDiv(`operon-editor-progress-row ${cls}`);
			const barTrack = row.createDiv('operon-editor-progress-bar-track');
			const barFill = barTrack.createDiv('operon-editor-progress-bar-fill');
			barFill.style.width = `${percent}%`;

			const statsRow = row.createDiv('operon-editor-progress-stats');
			const statsLeft = statsRow.createDiv('operon-editor-progress-stats-left');
			statsLeft.createSpan({
				text: t('taskEditor', 'progressDoneCount', { count: String(done) }),
				cls: 'operon-editor-progress-counts',
			});
			statsLeft.createSpan({
				text: ` / ${t('taskEditor', label, { count: String(total) })}`,
				cls: 'operon-editor-progress-total',
			});
			statsRow.createSpan({ text: `${percent}%`, cls: 'operon-editor-progress-pct' });
		};

		if (state.hasSubtasks) {
			renderProgressRow(state.done, state.total, 'progressSubtasksCount', state.progressPct, 'is-subtasks');
		}
		if (state.hasPlainCheckboxes) {
			renderProgressRow(state.checkboxDone, state.checkboxTotal, 'progressCheckboxesCount', state.checkboxProgressPct, 'is-checkboxes');
		}
	}

	private renderCoreSection(container: HTMLElement): void {
		const group = container.createDiv('operon-editor-group operon-editor-core');
		const header = group.createDiv('operon-editor-core-header');
		const headerLeft = header.createDiv('operon-editor-core-header-left');
		headerLeft.createDiv({ text: t('taskEditor', 'core'), cls: 'operon-editor-core-title-badge' });
		this.renderCoreActionButtons(header.createDiv('operon-editor-core-actions'));

		const topRow = group.createDiv('operon-editor-core-row is-top');
		const cluster = topRow.createDiv('operon-editor-quick-cluster operon-editor-core-icon-cluster');
		this.renderIconControl(cluster);
		this.renderColorControl(cluster);

		const topGrid = topRow.createDiv('operon-editor-grid-2 operon-editor-core-main');
		this.renderPriorityControl(topGrid);
		this.renderStatusControl(topGrid);

		const dateRow = group.createDiv('operon-editor-core-row is-dates operon-editor-core-grid-3');
		this.renderDateControl(dateRow, 'dateStarted', t('taskEditor', 'started'), t('taskEditor', 'startDatePlaceholder'));
		this.renderDateControl(dateRow, 'dateScheduled', t('taskEditor', 'scheduled'), t('taskEditor', 'scheduledDatePlaceholder'));
		this.renderDateControl(dateRow, 'dateDue', t('taskEditor', 'dueDate'), t('taskEditor', 'dueDatePlaceholder'));

		const datetimeRow = group.createDiv('operon-editor-core-row operon-editor-core-grid-3');
		this.renderDatetimeControl(datetimeRow, 'datetimeStart', t('taskEditor', 'datetimeStart'));
		this.renderEstimateControl(datetimeRow);
		this.renderDatetimeControl(datetimeRow, 'datetimeEnd', t('taskEditor', 'datetimeEnd'));

		const repeatRow = group.createDiv('operon-editor-core-row');
		this.renderRepeatControl(repeatRow);

		const terminalRow = group.createDiv('operon-editor-core-row operon-editor-grid-2');
		terminalRow.addClass('operon-editor-grid-3');
		this.renderDateControl(terminalRow, 'dateCompleted', t('taskEditor', 'finished'), t('taskEditor', 'finishedDatePlaceholder'));
		this.renderDateControl(terminalRow, 'dateCancelled', t('taskEditor', 'cancelled'), t('taskEditor', 'cancelledDatePlaceholder'));
		this.renderRemoveControl(terminalRow);
	}

	private renderCopyOperonIdButton(container: HTMLElement): void {
		const currentOperonId = this.getCurrentOperonId();
		if (!currentOperonId) return;

		const copyOperonIdButton = container.createEl('button', {
			cls: 'operon-task-editor-title-copy-id',
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
		this.bindTaskEditorTooltip(copyOperonIdButton, t('contextMenu', 'copyOperonId'));
	}

	private renderFileBodyToggle(container: HTMLElement, extraClass = ''): void {
		if (!this.hasFileBodyContext()) return;

		const button = container.createEl('button', {
			cls: ['operon-editor-core-panel-toggle', extraClass].filter(Boolean).join(' '),
			attr: {
				type: 'button',
				'aria-pressed': String(this.isFileBodyVisible),
			},
		});
		setIcon(button, 'file-output');
		setAccessibleLabelWithoutTooltip(button, this.isFileBodyVisible
			? t('taskEditor', 'hideFileBodyPanel')
			: t('taskEditor', 'showFileBodyPanel'));
		this.bindTaskEditorTooltip(button, this.isFileBodyVisible
			? t('taskEditor', 'hideFileBodyPanel')
			: t('taskEditor', 'showFileBodyPanel'));
		button.addEventListener('click', () => {
			this.setFileBodyVisible(!this.isFileBodyVisible);
		});
		this.fileBodyToggleButtonEl = button;
	}

	private renderCoreActionButtons(container: HTMLElement): void {
		const getIsPinned = () => this.pinnedCache && this.taskOperonId
			? this.pinnedCache.isPinned(this.taskOperonId)
			: false;

		this.renderCoreTrackerActionButton(container);

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
			pinBtn.createSpan({ text: isPinned ? t('buttons', 'unpin') : t('buttons', 'pin') });
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
			cls: 'operon-editor-core-action-btn',
			attr: {
				type: 'button',
			},
		});
		const subtaskIcon = getIcon(resolveSubtaskActionIconForKind(this.subtaskActionKind)) ?? getIcon('plus');
		if (subtaskIcon) subtaskBtn.appendChild(subtaskIcon);
		else subtaskBtn.setText('+');
		subtaskBtn.createSpan({ text: subtaskLabel });
		subtaskBtn.addEventListener('click', () => {
			void this.requestSubtask();
		});
	}

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
		return this.settings.taskEditorWorkflowPickers
			.filter(item => item.visible)
			.filter(item => this.canRenderWorkflowPickerKey(item.key));
	}

	private canRenderWorkflowPickerKey(key: string): boolean {
		const customMapping = getCustomFieldMapping(this.settings.keyMappings, key);
		if (customMapping) return isProjectedCustomFieldType(customMapping);
		return key === 'contexts'
			|| key === 'tags'
			|| key === 'assignees'
			|| key === 'location'
			|| key === 'links'
			|| key === 'parentTask'
			|| key === 'subtasks'
			|| key === 'blocking'
			|| key === 'blockedBy'
			|| key === 'related';
	}

	private renderWorkflowPickerActions(container: HTMLElement, items = this.getRenderableWorkflowPickerItems()): void {
		cleanupOperonHoverTooltips(container);
		container.empty();
		this.workflowActionButtons.clear();
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
			const customMapping = getCustomFieldMapping(this.settings.keyMappings, item.key);
			if (customMapping && isProjectedCustomFieldType(customMapping)) {
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

	private syncWorkflowActionButtonState(key: string, button: HTMLButtonElement): void {
		const active = this.hasWorkflowPickerValue(key);
		button.toggleClass('is-active', active);
		button.setAttr('aria-pressed', String(active));
		const locked = key === 'subtasks' && !this.getCurrentOperonId();
		button.toggleClass('is-locked', locked);
		button.setAttr('aria-disabled', String(locked));
	}

	private getWorkflowPickerLabel(key: string): string {
		const customMapping = getCustomFieldMapping(this.settings.keyMappings, key);
		if (customMapping) return getCustomFieldLabel(customMapping);
		if (key === 'tags') return t('taskEditor', 'tags');
		if (key === 'contexts') return t('taskEditor', 'contexts');
		if (key === 'assignees') return t('taskEditor', 'assignees');
		if (key === 'location') return t('location', 'location');
		if (key === 'links') return t('taskEditor', 'links');
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
		const customMapping = getCustomFieldMapping(this.settings.keyMappings, key);
		if (customMapping && isProjectedCustomFieldType(customMapping)) {
			const value = normalizeCustomFieldRawValue((this.fieldValues as Record<string, unknown>)[customMapping.canonicalKey]);
			return customMapping.type === 'list'
				? splitTaskListValue(value).length > 0
				: !!value.trim();
		}
		if (key === 'tags') return this.tags.length > 0;
		if (key === 'contexts' || key === 'links' || key === 'assignees' || key === 'blocking' || key === 'blockedBy' || key === 'related') {
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
		if (button.hasClass('is-locked')) {
			new Notice(t('taskEditor', 'subtasksSaveFirst'));
			return;
		}

		this.closeActiveWorkflowActionPicker();
		button.addClass('is-picker-open');
		let closePicker: (() => void) | null = null;
		const handleClose = () => {
			button.removeClass('is-picker-open');
			if (this.workflowActionPickerClose === closePicker) {
				this.workflowActionPickerClose = null;
			}
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
				anchor: button,
				currentFieldValues: { ...this.fieldValues },
				currentTags: [...this.tags],
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
		for (const button of this.workflowActionButtons.values()) {
			button.removeClass('is-picker-open');
		}
		if (current) current();
	}

	private commitWorkflowActionPayload(payload: Record<string, string | string[]>): void {
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
		return Platform.isPhone;
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
				text: value || placeholderText,
			});
		};
		this.registerSchedulingDraftRefresher(refresh);
		refresh();

		button.addEventListener('click', () => {
			button.classList.add('is-picker-open');
			showDatePicker(button, {
				app: this.app,
				fieldKey: key,
				value: this.fieldValues[key],
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
			bindOperonHoverTooltip(button, {
				content: key === 'datetimeEnd' && !hasStart
					? t('taskEditor', 'datetimeEndRequiresStart')
					: '',
				taskColor: this.getThemeColor(),
			});
			this.setPickerButtonContent(button, {
				canonicalKey: key,
				isEmpty: !value,
				showIcon: true,
				text: value
					? formatTaskEditorDatetime(this.app, this.settings, value)
					: label,
			});
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
				fieldKey: key,
				value: this.fieldValues[key],
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
		let refreshButtonState = (): void => {};
		const refresh = (): void => {
			const seconds = parseInt(this.fieldValues['estimate'] ?? '0', 10);
			input.value = seconds > 0 ? String(Math.round(seconds / 60)) : '';
			shell.classList.toggle('has-value', input.value.length > 0);
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
			this.markEdited();
		});
		input.addEventListener('change', commitInputValue);
		shell.addEventListener('click', () => input.focus());
		refresh();

		if (!this.onApplyEstimateReallocation) return;

		const actions = control.createDiv('operon-editor-estimate-actions');
		const button = actions.createEl('button', {
			cls: 'operon-editor-estimate-reallocate',
			text: t('taskEditor', 'estimateReallocationButton'),
			attr: { type: 'button' },
		});
		refreshButtonState = (): void => {
			const proposal = this.getEstimateReallocationProposal();
			const tooltip = this.getEstimateReallocationTooltip();
			button.disabled = !proposal;
			bindOperonHoverTooltip(button, { content: tooltip, taskColor: this.getThemeColor() });
			bindOperonHoverTooltip(actions, { content: tooltip, taskColor: this.getThemeColor() });
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
			this.refreshParentContextSection?.();
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
			bindOperonHoverTooltip(skipButton, {
				content: t('taskEditor', 'repeatSkipUnavailable'),
				taskColor: this.getThemeColor(),
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
			bindOperonHoverTooltip(skipButton, {
				content: parsed.mode === 'done'
					? t('taskEditor', 'repeatSkipModeDoneHint')
					: canManageFutureSkips
						? ''
						: t('taskEditor', 'repeatSkipUnavailable'),
				taskColor: this.getThemeColor(),
			});
		};

		const openPicker = (event?: Event) => {
			event?.preventDefault();
			event?.stopPropagation();
			showRepeatPicker(trigger, {
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
			showRepeatSkipPicker(skipButton, {
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
			button.createSpan({ text: label });
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
		this.appendCanonicalIcon(title, 'trackers', 'operon-editor-tracking-sessions-title-icon');
		title.createSpan({ text: t('taskEditor', 'trackingSessions') });
		const addButton = header.createEl('button', {
			cls: 'operon-editor-core-action-btn operon-editor-tracking-sessions-add',
			attr: { type: 'button' },
		});
		setIcon(addButton, 'plus');
		addButton.createSpan({ text: t('taskEditor', 'addSession') });

		const list = section.createDiv('operon-editor-tracking-sessions-list');

		const openAddModal = async () => {
			const operonId = await this.ensureTaskReadyForTracking();
			if (!operonId) return;
			new TrackerSessionEditModal(this.app, {
				title: t('taskEditor', 'addSession'),
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
			if (sessions.length === 0) {
				list.createDiv({
					cls: 'operon-editor-tracking-sessions-empty',
					text: t('taskEditor', 'noTrackingSessions'),
				});
				return;
			}

			for (const session of sessions) {
				this.renderTrackingSessionRow(list, session);
			}
		};

		this.refreshTrackingSessionsSection = refresh;
		refresh();
	}

	private renderTrackingSessionRow(container: HTMLElement, session: TrackerSession): void {
		const row = container.createDiv('operon-editor-tracking-session-row');
		const body = row.createDiv('operon-editor-tracking-session-body');
		body.createDiv({
			cls: 'operon-editor-tracking-session-range',
			text: `${this.formatSessionTimestamp(session.start)} - ${this.formatSessionEnd(session.start, session.end)}`,
		});
		body.createDiv({
			cls: 'operon-editor-tracking-session-duration',
			text: formatDurationHuman(session.durationSeconds),
		});

		const actions = row.createDiv('operon-editor-tracking-session-actions');
		const edit = this.createSessionActionButton(actions, 'pencil', t('taskEditor', 'editSession'));
		edit.addEventListener('click', () => {
			new TrackerSessionEditModal(this.app, {
				title: t('taskEditor', 'editSession'),
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
		});

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
		button.createSpan({ text: t('buttons', 'remove') });
		setAccessibleLabelWithoutTooltip(button, t('buttons', 'remove'));

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
			const confirmed = await this.promptConfirmAction({
				title: t('taskEditor', 'removeTaskTitle'),
				message: isYamlTask
					? t('taskEditor', 'removeFileTaskMessage')
					: t('taskEditor', 'removeInlineTaskMessage'),
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
				result = await this.onRequestDelete(this.existingTask);
			} catch (error) {
				console.error('Operon: task editor delete failed', error);
				new Notice(t('notifications', 'taskSaveFailed'));
				return;
			}
			if (result === false) return;
			deleted = true;
			this.disposed = true;
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
		refreshIconPreview();

		const selectItem = (iconId: string) => {
			this.fieldValues['taskIcon'] = iconId;
			refreshIconPreview();
			this.markEdited();
		};

		const openSharedIconPicker = (query: string) => {
			closeIconPicker?.();
			closeIconPicker = showIconPicker(iconButton, {
				value: this.fieldValues['taskIcon'],
				query,
				onSelect: iconId => {
					closeIconPicker = null;
					selectItem(iconId);
				},
				onClear: () => {
					closeIconPicker = null;
					delete this.fieldValues['taskIcon'];
					refreshIconPreview();
					this.markEdited();
				},
				onClose: () => {
					closeIconPicker = null;
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
			if (hex) {
				const swatchDot = swatch.createSpan('operon-color-swatch-dot');
				swatchDot.style.background = hex;
			} else {
				this.appendCanonicalIcon(swatch, 'taskColor', 'operon-color-swatch-icon');
			}
			swatch.classList.toggle('has-color', !!hex);
		};
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
			bindOperonHoverTooltip(anchor, {
				content: t('taskEditor', 'subtasksSaveFirst'),
				taskColor: this.getThemeColor(),
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
			bindOperonHoverTooltip(parentAnchor, {
				content: selectedParentId ? t('taskEditor', 'parentTaskClearFirst') : '',
				taskColor: this.getThemeColor(),
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

	private async requestSubtask(): Promise<void> {
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

		const def = CANONICAL_KEY_MAP.get(key);
		this.existingTask.fields.push({
			sourceKey: key,
			key,
			value,
			rawValue: value,
			type: def?.type ?? 'text',
			isCanonical: !!def,
			containerRange: { from: 0, to: 0 },
			valueRange: { from: 0, to: 0 },
		});
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
			if (!outcome.ok) return outcome;
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
		return `${formatTrackerDayHeader(this.app, dateKey)}, ${formatUiTime(this.app, this.settings, value)}`;
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
		this.hasBeenEdited = true;
		this.editVersion += 1;
		this.refreshFileBodySaveButtonState();
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
			fileBodyDraft: this.fileBodyContext ? this.fileBodyDraft : null,
			inlineCompletionMode: this.inlineCompletionMode,
		};
	}

	private getSemanticPersistedSnapshot(): TaskEditorSemanticSnapshot {
		return {
			description: this.persistedDescription.trim(),
			checkbox: this.persistedCheckbox,
			tags: normalizeListValues(this.persistedTags.map(tag => tag.replace(/^#/, ''))),
			fieldValues: this.normalizeSemanticFieldValues(this.persistedFieldValues),
			fileBodyDraft: this.fileBodyContext ? this.persistedFileBodyDraft : null,
			inlineCompletionMode: this.persistedInlineCompletionMode,
		};
	}

	private hasSemanticDraftChanges(): boolean {
		if (this.isNewTask) return true;
		const draft = this.getSemanticDraftSnapshot();
		const persisted = this.getSemanticPersistedSnapshot();
		if (draft.description !== persisted.description) return true;
		if (draft.checkbox !== persisted.checkbox) return true;
		if (!areStringArraysEqual(draft.tags, persisted.tags)) return true;
		if (draft.fileBodyDraft !== persisted.fileBodyDraft) return true;
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

	private commitNoOpSaveBaseline(): void {
		this.persistedDescription = this.description;
		this.persistedCheckbox = this.checkbox;
		this.persistedTags = [...this.tags];
		this.persistedFieldValues = { ...this.fieldValues };
		this.persistedFileBodyDraft = this.fileBodyDraft;
		this.persistedInlineCompletionMode = this.inlineCompletionMode;
		this.isFileBodyDirty = false;
		this.hasBeenEdited = false;
		this.refreshFileBodySaveButtonState();
	}

	private refreshFileBodySaveButtonState(): void {
		this.fileBodySaveButtonEl?.classList.toggle('is-dirty', this.hasBeenEdited);
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

			if (!this.hasSemanticDraftChanges()) {
				this.commitNoOpSaveBaseline();
				this.refreshEstimateReallocationControl?.();
				return { ok: true, status: 'no-change', clean: true };
			}

			const operonId = this.fieldValues['operonId'];
			if (operonId && this.checkbox !== 'open' && this.timeTracker.isTimerRunning(operonId)) {
				await this.timeTracker.stop('terminal-status');
			}
			this.syncTrackingFieldsFromIndex();

			const now = localNow();
			this.fieldValues['datetimeModified'] = now;

			const fields: OperonField[] = [];
			for (const [key, value] of Object.entries(this.fieldValues)) {
				if (!value) continue;
				if (key === 'pinned') continue;
				const def = CANONICAL_KEY_MAP.get(key);
				const existingField = this.existingTask?.fields.find(f => f.key === key);
				fields.push({
					sourceKey: existingField?.sourceKey || key,
					key,
					value,
					rawValue: value,
					type: def?.type ?? 'text',
					isCanonical: !!def,
					containerRange: { from: 0, to: 0 },
					valueRange: { from: 0, to: 0 },
				});
			}

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
			const savedDescription = this.description;
			const savedCheckbox = this.checkbox;
			const savedTags = [...this.tags];
			const savedFieldValues = { ...this.fieldValues };
			const savedFileBodyDraft = this.fileBodyDraft;
			const savedFileBodyDirty = this.isFileBodyDirty;
			const savedInlineCompletionMode = this.inlineCompletionMode;
			let saveResult: boolean | null | void;
			try {
				saveResult = await this.onSave({
					taskLine,
					isNew: this.isNewTask,
					inlineCompletionMode: savedInlineCompletionMode,
					fileBody: this.fileBodyContext
						? {
							filePath: this.fileBodyContext.filePath,
							content: savedFileBodyDraft,
							dirty: savedFileBodyDirty,
							format: this.fileBodyContext.format,
							targetLine: this.fileBodyContext.targetLine,
						}
						: null,
				});
			} catch (error) {
				console.error('Operon: task editor save failed', error);
				new Notice(t('notifications', 'taskSaveFailed'));
				return { ok: false, reason: 'write-threw' };
			}
			if (saveResult === false || saveResult === null) {
				return { ok: false, reason: 'write-rejected' };
			}
			this.persistedDescription = savedDescription;
			this.persistedCheckbox = savedCheckbox;
			this.persistedTags = savedTags;
			this.persistedFieldValues = savedFieldValues;
			this.persistedFileBodyDraft = savedFileBodyDraft;
			this.persistedInlineCompletionMode = savedInlineCompletionMode;
			this.isFileBodyDirty = this.fileBodyDraft !== this.persistedFileBodyDraft;
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
			this.refreshFileBodySaveButtonState();
			return { ok: true, status: 'saved', clean: !this.hasBeenEdited };
		})();

		this.persistInFlight = run;
		try {
			return await run;
		} finally {
			if (this.persistInFlight === run) {
				this.persistInFlight = null;
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
