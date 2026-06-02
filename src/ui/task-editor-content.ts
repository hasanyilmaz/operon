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
import { CANONICAL_KEY_MAP } from '../types/keys';
import { OperonSettings, TaskEditorMobileCoreToolKey, TaskEditorWorkflowPickerKey } from '../types/settings';
import { generateOperonId, generateRepeatSeriesId } from '../core/id-generator';
import {
	resolveAutomationWorkflowStatus,
	resolveReverseWorkflowFromTerminalDate,
	resolveWorkflowStatus,
	shouldTriggerOneShotAutomation,
} from '../types/pipeline';
import { serializeTask } from '../core/serializer';
import { applyFieldRules } from '../core/field-rules';
import { t } from '../core/i18n';
import { formatTaskNotice } from '../core/task-notice';
import { localNow, localToday } from '../core/local-time';
import {
	calculateRepeatEndFromCount,
	parseRepeatRule,
} from '../core/repeat-rule';
import { formatRepeatRuleSummaryI18n } from '../core/repeat-rule-i18n';
import { formatUiTime } from '../core/ui-time-format';
import { TimeTracker } from '../systems/time-tracker';
import { bindOperonHoverTooltip } from './operon-hover-tooltip';
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
import {
	ConfirmActionComparisonRow,
	ConfirmActionComparisonTable,
	ConfirmActionModal,
} from './confirm-action-modal';
import { TrackerSessionEditModal } from './tracker-session-edit-modal';
import { formatTrackerDayHeader } from './tracker-time-labels';
import { EmbeddedMarkdownSourceEditor } from './embedded-markdown-source-editor';
import { showTagPicker } from './field-pickers/tag-picker';
import { showContextsPicker } from './field-pickers/contexts-picker';
import { showAssigneesPicker } from './field-pickers/assignees-picker';
import { showParentTaskPicker } from './field-pickers/parent-task-picker';
import { showSubtasksPicker } from './field-pickers/subtasks-picker';
import { showDependencyTaskPicker } from './field-pickers/dependency-task-picker';
import { showLinksPicker } from './field-pickers/links-picker';
import { formatExternalLinkDisplay } from './field-pickers/links-utils';
import { splitTaskListValue } from '../core/task-field-patch';
import { splitFrontmatterDocument } from '../core/file-task-template-merge';
import { formatContextDisplay } from './field-pickers/contexts-picker';
import { getConfiguredKeyMappingIcon } from '../core/key-mapping-icons';
import { resolveTaskEditorProgressFromStats } from '../core/task-stats-read-model';
import { resolveSubtaskActionIconForKind, resolveSubtaskActionLabelKeyForKind } from '../core/subtask-action';
import { createInlineTaskCompactChipElement, InlineTaskCompactChipEntry } from './compact-task-layout';
import { INLINE_TASK_COMPACT_FALLBACK_ICONS, InlineTaskCompactChipKey } from '../types/settings';
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
	onApplyEstimateReallocation?: (request: TaskEditorEstimateReallocationRequest) => Promise<boolean>;
	pinnedCache?: PinnedCache;
	fileBody?: TaskEditorFileBodyContext | null;
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
type RelationContextChipKey = Extract<InlineTaskCompactChipKey, 'priority' | 'status' | 'dateScheduled' | 'dateDue' | 'dateCompleted' | 'dateCancelled' | 'duration' | 'totalDuration'>;
type MediaQueryChangeListener = (event: MediaQueryListEvent) => void;
type LegacyMediaQueryMethod = (this: MediaQueryList, listener: MediaQueryChangeListener) => void;

function getLegacyMediaQueryMethod(mediaQuery: MediaQueryList, methodName: 'addListener' | 'removeListener'): LegacyMediaQueryMethod | null {
	const method = (mediaQuery as unknown as Record<string, unknown>)[methodName];
	return typeof method === 'function' ? method as LegacyMediaQueryMethod : null;
}

type EditorProgressSectionState = {
	hasSubtasks: boolean;
	done: number;
	total: number;
	progressPct: number;
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

function formatTaskEditorDate(value: string): string {
	const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (!match) return value;
	return value.trim();
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
	private hasBeenEdited = false;
	private focusDescriptionOnMount = true;
	private subtaskActionKind: 'inline' | 'file' = 'inline';
	private onRequestSubtask: ((context: TaskEditorSubtaskRequest) => void | Promise<void>) | null = null;
	private onRequestDelete: ((task: ParsedTask) => void | Promise<boolean | void>) | null = null;
	private onOpenTask: ((operonId: string) => void) | null = null;
	private onUpdateExistingSubtaskParent: ((childId: string, parentId: string | null) => void | Promise<void>) | null = null;
	private getRepeatSkipDates: ((repeatSeriesId: string) => string[]) | null = null;
	private onUpdateRepeatSkips: ((request: TaskEditorRepeatSkipUpdateRequest) => Promise<TaskEditorRepeatSkipUpdateResult> | TaskEditorRepeatSkipUpdateResult) | null = null;
	private onApplyEstimateReallocation: ((request: TaskEditorEstimateReallocationRequest) => Promise<boolean>) | null = null;
	private pinnedCache: PinnedCache | null = null;
	private taskOperonId: string | null = null;
	private trackerUnsubscribe: (() => void) | null = null;
	private bodyDropdowns: HTMLElement[] = [];
	private refreshCoreTrackerControl: (() => void) | null = null;
	private refreshTrackingSessionsSection: (() => void) | null = null;
	private refreshEstimateReallocationControl: (() => void) | null = null;
	private refreshParentContextSection: (() => void) | null = null;
	private schedulingDraftRefreshers = new Set<() => void>();
	private workflowExpanded = false;
	private persistInFlight: Promise<boolean> | null = null;
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
	private fileBodyContext: TaskEditorFileBodyContext | null = null;
	private fileBodyDraft = '';
	private persistedFileBodyDraft = '';
	private isFileBodyVisible = false;
	private isFileBodyDirty = false;
	private embeddedBodyEditor: EmbeddedMarkdownSourceEditor | null = null;
	private embedPreviewComponent: Component | null = null;
	private fileBodyMediaQuery: MediaQueryList | null = null;
	private fileBodyMediaQueryHandler: ((event: MediaQueryListEvent) => void) | null = null;
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
		this.isFileBodyVisible = visible;
		this.updateFileBodyLayout();
		if (mainPanelScrollTop != null) {
			this.restoreMainPanelScroll(mainPanelScrollTop);
		}
		if (visible && focusEditor) {
			getActiveWindow().setTimeout(() => this.embeddedBodyEditor?.focus(), 0);
		}
	}

	private restoreMainPanelScroll(scrollTop: number): void {
		const mainPanel = this.mainPanelEl;
		if (!mainPanel) return;
		getActiveWindow().requestAnimationFrame(() => {
			mainPanel.scrollTop = scrollTop;
		});
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

	private focusDescriptionField(): void {
		const input = this.descriptionInputEl;
		const root = this.rootEl;
		if (!input || !root) return;
		if (!input.isConnected || !root.isConnected) return;
		if (Platform.isPhone && root.ownerDocument.querySelector('.operon-task-editor-mobile-picker-surface')) return;

		input.focus();
		if (this.selectDescriptionOnMount) {
			input.select();
			return;
		}

		const end = input.value.length;
		input.setSelectionRange(end, end);
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
				this.focusDescriptionField();
			}, delay);
			this.initialDescriptionFocusTimers.push(timer);
		}
	}

	private openFileBodySource(): void {
		const filePath = this.fileBodyContext?.filePath?.trim();
		if (!filePath) return;
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (file instanceof TFile) {
			void this.app.workspace.getLeaf(false).openFile(file);
			this.rootEl?.dispatchEvent(new CustomEvent('operon-editor-close', { bubbles: true }));
			return;
		}
		runAsyncAction('task editor source open failed', () => this.app.workspace.openLinkText(filePath, '', false));
		this.rootEl?.dispatchEvent(new CustomEvent('operon-editor-close', { bubbles: true }));
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
		setIcon(saveButton, 'save');
		setAccessibleLabelWithoutTooltip(saveButton, t('buttons', 'save'));
		this.bindTaskEditorTooltip(saveButton, t('buttons', 'save'));
		saveButton.addEventListener('click', () => {
			void this.persistEditorState('explicit-save');
		});

		const closeButton = headerActions.createEl('button', {
			cls: 'operon-task-editor-file-panel-overlay-close',
			attr: {
				type: 'button',
			},
		});
		setIcon(closeButton, 'x');
		setAccessibleLabelWithoutTooltip(closeButton, t('buttons', 'close'));
		closeButton.addEventListener('click', () => this.setFileBodyVisible(false));

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
			cursorOffset: this.fileBodyContext?.cursorOffset ?? 0,
			lineNumberOffset: this.fileBodyContext?.lineNumberOffset ?? 0,
			showLineNumbers: this.settings.taskEditorShowLineNumbers,
			onChange: (value) => this.handleFileBodyChanged(value),
			onEscape: () => {
				if (!(this.fileBodyMediaQuery?.matches ?? this.isWideFileBodyViewport())) {
					this.setFileBodyVisible(false);
				}
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
		// Title
		const titleRow = container.createDiv('operon-task-editor-title-row');
		const titleLeft = titleRow.createDiv('operon-task-editor-title-side is-left');
		this.renderFileBodyToggle(titleLeft, 'operon-task-editor-title-file-toggle');
		titleRow.createEl('h3', {
			text: this.isNewTask ? t('modals', 'newTask') : t('modals', 'editTask'),
			cls: 'operon-task-editor-title',
		});
		const titleRight = titleRow.createDiv('operon-task-editor-title-side is-right');
		this.renderCopyOperonIdButton(titleRight);

		// Parent task context
		this.renderParentContext(container);

		// Subtask context cards
		this.renderSubtaskCards(container);

		const primaryFields = container.createDiv('operon-task-editor-primary-fields');

		// Primary edit fields should remain in normal document flow when the file body panel toggles.
		this.renderProgressSection(primaryFields);
		this.renderDescription(primaryFields);
		this.renderNote(primaryFields);
		this.renderTimeSummarySection(primaryFields);

		// High-frequency fields directly under description
		this.renderCoreSection(container);
		this.renderWorkflowPickers(container);
		this.renderDetailsSection(container);

		// Actions bar
		this.renderActions(container);
	}

	private renderMobileTaskEditorBody(container: HTMLElement): void {
		const body = container.createDiv('operon-task-editor-mobile-body');
		const primary = body.createDiv('operon-task-editor-mobile-primary');
		this.renderMobileDescription(primary);
		this.renderMobileNote(primary);
		this.renderMobileCoreToolbar(body);

		const workflow = body.createDiv('operon-task-editor-mobile-workflow');
		this.renderWorkflowPickers(workflow);
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

		for (const item of this.settings.taskEditorMobileCoreTools) {
			if (!item.visible) continue;
			this.renderMobileCoreTool(tools, item.key);
		}
	}

	private renderMobileCoreTool(container: HTMLElement, key: TaskEditorMobileCoreToolKey): void {
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
			colorInput.click();
		});
		const colorInput = container.createEl('input', {
			cls: 'operon-task-editor-mobile-color-input',
			attr: { type: 'color' },
		});
		const currentColor = this.getTaskColorHex();
		if (currentColor) colorInput.value = currentColor;

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
		colorInput.addEventListener('input', () => {
			const hex = colorInput.value;
			this.fieldValues['taskColor'] = hex.replace(/^#/, '');
			this.applyThemeColor();
			this.markEdited();
			this.refreshMobileCoreButtons();
		});
		button.addEventListener('contextmenu', event => {
			event.preventDefault();
			delete this.fieldValues['taskColor'];
			colorInput.value = '#000000';
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
					this.fieldValues['status'] = value;
					this.syncCheckboxWithWorkflowStatus();
					resetPickerState();
					this.markEdited();
					this.refreshMobileCoreButtons();
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
			this.setMobileCoreButtonIcon(button, this.getCoreFieldIcon(key));
			this.setMobileCoreButtonState(button, !!value || (key === 'dateCompleted' && this.checkbox === 'done') || (key === 'dateCancelled' && this.checkbox === 'cancelled'), this.getMobileDateTone(key, value));
			this.setMobileCoreButtonLabel(button, value ? `${label}: ${formatTaskEditorDate(value)}` : placeholderText);
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
				settings: { timeFormat: this.settings.timeFormat },
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
					this.applyDraftFieldRules({ estimate: value }, ['estimate']);
					this.markEdited();
					this.refreshMobileCoreButtons();
				},
				onRemove: () => {
					this.applyDraftFieldRules({ estimate: '' }, ['estimate']);
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
				dateScheduled: this.fieldValues['dateScheduled'],
				dateDue: this.fieldValues['dateDue'],
				taskFormat: this.fileBodyContext?.format ?? 'inline',
				inlineCompletionMode: this.inlineCompletionMode,
				onSave: ({ repeat, datetimeRepeatEnd, dateScheduled, inlineCompletionMode }) => {
					this.fieldValues['repeat'] = repeat;
					if (datetimeRepeatEnd) this.fieldValues['datetimeRepeatEnd'] = datetimeRepeatEnd;
					else delete this.fieldValues['datetimeRepeatEnd'];
					if (dateScheduled) {
						this.fieldValues['dateScheduled'] = dateScheduled;
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

	/**
	 * Mount the editor UI into the given container element.
	 * Clears the container first, then renders all sections.
	 */
	mountInto(container: HTMLElement): void {
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
		this.clearMobileCoreToolbarState();
		this.clearInitialDescriptionFocusTimers();
		window.removeEventListener('resize', this.mobileResizeHandler);
		if (Platform.isPhone) {
			window.addEventListener('resize', this.mobileResizeHandler);
		}
		this.trackerUnsubscribe?.();
		this.trackerUnsubscribe = this.timeTracker.subscribe((event) => {
			if (event !== 'tick') {
				const indexed = this.getCurrentIndexedTask();
				if (indexed && this.timeTracker.isTimerRunning(indexed.operonId) && indexed.checkbox !== this.checkbox) {
					this.syncWorkflowFieldsFromIndex();
				}
				this.syncTrackingFieldsFromIndex();
			}
			this.refreshCoreTrackerControl?.();
			this.refreshMobileCoreButtons();
			if (event !== 'tick') {
				this.refreshTrackingSessionsSection?.();
			}
		});

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
			this.renderFileBodyPanel(this.fileBodyPanelEl);
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

		await this.refreshFileBodyDraftFromSource();
		this.syncTrackingFieldsFromIndex();
		this.schedulingDraftRefreshers.clear();
		this.refreshCoreTrackerControl = null;
		this.refreshEstimateReallocationControl = null;
		this.refreshParentContextSection = null;
		this.refreshTrackingSessionsSection = null;
		this.mobileCoreButtonRefreshers.clear();
		this.descriptionInputEl = null;
		this.noteInputEl = null;
		this.fileBodyToggleButtonEl = null;
		for (const el of this.bodyDropdowns) el.remove();
		this.bodyDropdowns = [];
		this.clearMobileCoreToolbarState();
		this.clearInitialDescriptionFocusTimers();

		if (!Platform.isPhone && this.fileBodyPanelEl) {
			this.renderFileBodyPanel(this.fileBodyPanelEl);
		}
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

	beginCloseSave(): Promise<boolean> {
		if (this.persistInFlight) return this.persistInFlight;
		if (this.saveTimer) {
			clearWindowTimeout(this.saveTimer);
			this.saveTimer = null;
		}
		if (!this.description.trim()) return Promise.resolve(false);
		if (!this.hasBeenEdited) return Promise.resolve(true);
		return this.persistEditorState('close-save');
	}

	/**
	 * Cleanup: clear timers. Call when the container is being torn down.
	 */
	destroy(options: { skipCloseSave?: boolean } = {}): void {
		window.removeEventListener('resize', this.mobileResizeHandler);
		this.trackerUnsubscribe?.();
		this.trackerUnsubscribe = null;
		this.unregisterFileBodyViewportListener();
		this.schedulingDraftRefreshers.clear();
		this.mobileCoreButtonRefreshers.clear();
		this.refreshCoreTrackerControl = null;
		this.refreshEstimateReallocationControl = null;
		this.refreshParentContextSection = null;
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

		if (!options.skipCloseSave && this.hasBeenEdited && this.description.trim()) {
			void this.beginCloseSave();
		}

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
		const scheduled = (this.fieldValues['dateScheduled'] ?? '').trim();
		if (!scheduled) {
			delete this.fieldValues['datetimeRepeatEnd'];
			return;
		}
		const endDate = calculateRepeatEndFromCount(rule, scheduled, rule.count ?? 1);
		if (!endDate) {
			delete this.fieldValues['datetimeRepeatEnd'];
			return;
		}
		this.fieldValues['datetimeRepeatEnd'] = `${endDate}T23:59:59`;
	}

	private registerSchedulingDraftRefresher(refresh: () => void): void {
		this.schedulingDraftRefreshers.add(refresh);
	}

	private refreshSchedulingDraftControls(): void {
		for (const refresh of this.schedulingDraftRefreshers) {
			refresh();
		}
	}

	private applyDraftFieldRules(patch: Record<string, string>, changedKeys: string[]): void {
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
		this.refreshEstimateReallocationControl?.();
		this.refreshMobileCoreButtons();
	}

	// --- Renderers ---

	private renderParentContext(container: HTMLElement): void {
		const host = container.createDiv();
		const render = (): void => {
			host.empty();
			const parentId = this.fieldValues['parentTask'];
			if (!parentId) return;

			const parent = this.indexer.getTask(parentId);
			if (!parent) return;

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
			entry.iconTone = this.getRelationDateIconTone(rawValue);
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
			if (def) chip.style.setProperty('--operon-live-chip-color', def.color);
		}
		if (entry.colorRole === 'status') {
			const status = resolveWorkflowStatus(this.settings.pipelines, task.fieldValues['status']);
			chip.style.setProperty('--operon-live-chip-color', status?.definition.color ?? '#6b7280');
		}
		if (entry.iconTone === 'today') {
			chip.setCssProps({ '--operon-inline-chip-icon-color': '#2563eb' });
		} else if (entry.iconTone === 'overdue') {
			chip.setCssProps({ '--operon-inline-chip-icon-color': '#dc2626' });
		}
	}

	private getRelationDateIconTone(value: string): InlineTaskCompactChipEntry['iconTone'] {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'default';
		const today = localToday();
		if (value < today) return 'overdue';
		if (value === today) return 'today';
		return 'default';
	}

	private resolveRelationContextColor(task: IndexedTask, role: 'parent' | 'child'): string {
		const color = (task.fieldValues['taskColor'] ?? '').trim().replace(/^#/, '');
		if (/^([0-9a-fA-F]{6})$/.test(color)) return `#${color}`;
		return role === 'parent'
			? 'var(--color-red)'
			: 'var(--operon-task-editor-accent, var(--interactive-accent))';
	}

	/** Recursively collect all descendant IndexedTasks for a given operonId. */
	private collectAllDescendants(operonId: string): IndexedTask[] {
		const result: IndexedTask[] = [];
		const childIds = this.indexer.secondary.getChildIds(operonId);
		for (const id of childIds) {
			const task = this.indexer.getTask(id);
			if (task) {
				result.push(task);
				result.push(...this.collectAllDescendants(id));
			}
		}
		return result;
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

	private renderDescription(container: HTMLElement): void {
		const setting = new Setting(container)
			.setName(t('taskEditor', 'description'))
			.addTextArea(text => {
				text.setValue(this.description);
				text.setPlaceholder(t('taskEditor', 'descriptionPlaceholder'));
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
				const removeButton = chip.ownerDocument.createElement('button');
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
		const removeButton = chip.ownerDocument.createElement('button');
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

	private renderNote(container: HTMLElement): void {
		const setting = new Setting(container)
			.setName(t('taskEditor', 'notes'))
			.addTextArea(text => {
				text.setValue(this.fieldValues['note'] ?? '');
					text.setPlaceholder(t('taskEditor', 'notesPlaceholder'));
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
		const childIds = statsProgress ? null : this.indexer.secondary.getChildIds(operonId);
		const hasSubtasks = statsProgress?.hasSubtasks ?? (!!childIds && childIds.size > 0);

		const allDesc = statsProgress || !hasSubtasks ? [] : this.collectAllDescendants(operonId);
		const total = statsProgress?.total ?? allDesc.length;
		const done = statsProgress?.done ?? allDesc.filter(c => c.checkbox === 'done').length;
		const progressPct = statsProgress?.progressPct ?? (total > 0 ? Math.round((done / total) * 100) : 0);

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

		if (!hasSubtasks && !hasAnyTimeData) return null;

		return {
			hasSubtasks,
			done,
			total,
			progressPct,
			ownDuration,
			subtaskDuration,
			totalDuration,
			ownEstimate,
			subtaskEstimate,
			totalEstimate,
			hasAnyTimeData,
		};
	}

	private renderTimeSummarySection(container: HTMLElement): void {
		const state = this.getProgressSectionState();
		if (!state?.hasAnyTimeData) return;
		const hasAnyDuration = state.ownDuration > 0 || (state.hasSubtasks && state.subtaskDuration > 0) || state.totalDuration > 0;
		const hasAnyEstimate = state.ownEstimate > 0 || (state.hasSubtasks && state.subtaskEstimate > 0) || state.totalEstimate > 0;
		if (!hasAnyDuration && !hasAnyEstimate) return;

		const summary = container.createDiv('operon-editor-time-summary');
		const table = summary.createDiv('operon-editor-time-summary-table');
		const header = table.createDiv('operon-editor-time-summary-row is-header');
		header.createDiv('operon-editor-time-summary-row-label operon-editor-time-summary-row-corner');
		for (const columnLabel of [
			t('taskEditor', 'timeOwn'),
			t('taskEditor', 'subtasks'),
			t('taskEditor', 'timeTotal'),
		]) {
			header.createDiv({
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

	private renderProgressSection(container: HTMLElement): void {
		const state = this.getProgressSectionState();
		if (!state) return;

		const section = container.createDiv('operon-editor-progress');
		if (state.hasSubtasks) {
			const barTrack = section.createDiv('operon-editor-progress-bar-track');
			const barFill = barTrack.createDiv('operon-editor-progress-bar-fill');
			barFill.style.width = `${state.progressPct}%`;

			const statsRow = section.createDiv('operon-editor-progress-stats');
			const statsLeft = statsRow.createDiv('operon-editor-progress-stats-left');
			statsLeft.createSpan({ text: `${state.done} done`, cls: 'operon-editor-progress-counts' });
			statsLeft.createSpan({ text: ` / ${state.total} subtasks`, cls: 'operon-editor-progress-total' });
			statsRow.createSpan({ text: `${state.progressPct}%`, cls: 'operon-editor-progress-pct' });
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
		renderPin();

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

	private renderWorkflowSection(container: HTMLElement): void {
		this.renderCollapsibleSection(
			container,
			t('taskEditor', 'workflow'),
			this.workflowExpanded,
			next => { this.workflowExpanded = next; },
			body => this.renderWorkflowFields(body),
		);
	}

	private renderWorkflowPickers(container: HTMLElement): void {
		for (const item of this.settings.taskEditorWorkflowPickers) {
			if (!item.visible) continue;
			this.renderWorkflowPicker(container, item.key);
		}
	}

	private shouldCloseWorkflowPickerOnSelect(): boolean {
		return Platform.isPhone;
	}

	private renderWorkflowPicker(container: HTMLElement, key: TaskEditorWorkflowPickerKey): void {
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
		}
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
					this.fieldValues['status'] = value;
					this.syncCheckboxWithWorkflowStatus();
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
				text: value ? formatTaskEditorDate(value) : placeholderText,
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
				settings: { timeFormat: this.settings.timeFormat },
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
			refreshButtonState();
		};
		this.registerSchedulingDraftRefresher(refresh);
		const applyInputValue = (): void => {
			const minutes = parseInt(input.value, 10);
			this.applyDraftFieldRules(
				{ estimate: minutes > 0 ? String(minutes * 60) : '' },
				['estimate'],
			);
		};
		const commitInputValue = (): void => {
			applyInputValue();
			this.markEdited();
			refreshButtonState();
		};
		input.addEventListener('input', () => {
			applyInputValue();
			shell.classList.toggle('has-value', input.value.length > 0);
			this.markEdited();
			refreshButtonState();
		});
		input.addEventListener('change', commitInputValue);
		shell.addEventListener('click', () => input.focus());
		refresh();

		if (!this.onApplyEstimateReallocation) return;

		const actions = control.createDiv('operon-editor-estimate-actions');
		if (this.isEstimateAutoReallocationEnabled()) {
			actions.createDiv({
				cls: 'operon-editor-estimate-auto-hint',
				text: t('taskEditor', 'estimateReallocationAutoHint'),
			});
			return;
		}

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

	private isEstimateAutoReallocationEnabled(): boolean {
		return this.settings.estimateAutoReallocation === true;
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

	private async showEstimateReallocationInfoModal(proposal: ManualEstimateReallocationProposal): Promise<void> {
		const isPartial = proposal.coverage === 'partial';
		await this.promptConfirmAction({
			title: t('modals', 'reallocateEstimate'),
			message: isPartial
				? t('taskEditor', 'estimateReallocationAutoPartialMessage')
				: t('taskEditor', 'estimateReallocationAutoAppliedMessage'),
			dismissText: t('buttons', 'close'),
			readOnly: true,
			comparisonTable: this.buildEstimateReallocationComparisonTable(proposal),
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
			if (!saved) return;

			const applied = await this.onApplyEstimateReallocation({
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
			if (!applied) {
				new Notice(t('taskEditor', 'estimateReallocationUnavailable'));
				this.refreshEstimateReallocationControl?.();
				return;
			}

			this.commitEstimateReallocationBaseline(proposal.childEstimateAfterSeconds);
			this.syncTrackingFieldsFromIndex();
			this.refreshParentContextSection?.();
			this.refreshEstimateReallocationControl?.();
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
				|| ((this.fieldValues['dateScheduled'] ?? '').trim() !== (this.persistedFieldValues['dateScheduled'] ?? '').trim())
				|| ((this.fieldValues['dateDue'] ?? '').trim() !== (this.persistedFieldValues['dateDue'] ?? '').trim())
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
				extractDatePart(this.fieldValues['dateScheduled'])
				|| extractDatePart(this.fieldValues['dateDue'])
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
				dateScheduled: this.fieldValues['dateScheduled'],
				dateDue: this.fieldValues['dateDue'],
				taskFormat: this.fileBodyContext?.format ?? 'inline',
				inlineCompletionMode: this.inlineCompletionMode,
				onSave: ({ repeat, datetimeRepeatEnd, dateScheduled, inlineCompletionMode }) => {
					this.fieldValues['repeat'] = repeat;
					if (datetimeRepeatEnd) this.fieldValues['datetimeRepeatEnd'] = datetimeRepeatEnd;
					else delete this.fieldValues['datetimeRepeatEnd'];
					if (dateScheduled) {
						this.fieldValues['dateScheduled'] = dateScheduled;
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
				dateScheduled: this.fieldValues['dateScheduled'],
				dateDue: this.fieldValues['dateDue'],
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
		const title = header.createEl('h6', { cls: 'operon-editor-tracking-sessions-title' });
		this.appendCanonicalIcon(title, 'trackers', 'operon-editor-tracking-sessions-title-icon');
		title.createSpan({ text: t('taskEditor', 'trackingSessions') });
		const addButton = header.createEl('button', {
			cls: 'operon-editor-core-action-btn operon-editor-tracking-sessions-add',
			text: t('taskEditor', 'addSession'),
			attr: { type: 'button' },
		});

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
				initialStart: session.start,
				initialEnd: session.end,
				onSave: async (start, end) => {
					const updated = await this.timeTracker.updateSession(session.operonId, session.sessionIndex, start, end);
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
					const deleted = await this.timeTracker.deleteSession(session.operonId, session.sessionIndex);
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
					const deleted = await this.timeTracker.deleteSession(session.operonId, session.sessionIndex);
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
		if (!this.existingTask || !this.onRequestDelete) return;
		this.suspendAutoSave();
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
			const result = await this.onRequestDelete(this.existingTask);
			if (result === false) return;
			this.rootEl?.dispatchEvent(new CustomEvent('operon-editor-close', { bubbles: true }));
		} finally {
			this.resumeAutoSave();
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
		const colorInput = swatchWrap.createEl('input', {
			cls: 'operon-color-input-hidden',
			attr: { type: 'color' },
		});

		const currentColor = this.fieldValues['taskColor'] ?? '';
		const currentColorHex = currentColor ? (currentColor.startsWith('#') ? currentColor : `#${currentColor}`) : '';
		if (currentColorHex) colorInput.value = currentColorHex;

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

		swatch.addEventListener('click', () => colorInput.click());
		colorInput.addEventListener('input', () => {
			const hex = colorInput.value;
			this.fieldValues['taskColor'] = hex.replace(/^#/, '');
			refreshSwatch(hex);
			this.applyThemeColor();
			this.markEdited();
		});
		swatch.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			delete this.fieldValues['taskColor'];
			colorInput.value = '#000000';
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

	private renderWorkflowFields(container: HTMLElement): void {
		this.renderWorkflowPickers(container);
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

		let selectedIds: string[] = normalizeListValues(Array.from(this.indexer.secondary.getChildIds(currentTaskId)));

		const render = () => {
			this.renderTaskSelectionChips(selectedWrap, 'subtasks', selectedIds, (operonId) => {
				closeActivePicker();
				selectedIds = selectedIds.filter(existing => existing !== operonId);
				render();
				this.updateExistingSubtaskParent(operonId, null);
			});
		};

		const syncParentLinks = (nextIds: string[]) => {
			const previousIds = selectedIds;
			const normalizedNext = normalizeListValues(nextIds.filter(id => !excludedIds.has(id)));
			if (areStringArraysEqual(previousIds, normalizedNext)) return;
			selectedIds = normalizedNext;
			render();
			const removedIds = previousIds.filter(id => !normalizedNext.includes(id));
			const addedIds = normalizedNext.filter(id => !previousIds.includes(id));
			for (const removedId of removedIds) {
				this.updateExistingSubtaskParent(removedId, null);
			}
			for (const addedId of addedIds) {
				this.updateExistingSubtaskParent(addedId, currentTaskId);
			}
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
		for (const key of ['status', 'dateCompleted', 'dateCancelled']) {
			const value = indexed.fieldValues[key] ?? '';
			if (value) this.fieldValues[key] = value;
			else delete this.fieldValues[key];
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

		if (!this.getCurrentIndexedTask()) {
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
		let saved = await this.persistEditorState('explicit-save');
		while (this.hasBeenEdited && this.description.trim()) {
			saved = await this.persistEditorState('explicit-save') || saved;
		}
		return saved;
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
		this.hasBeenEdited = true;
		this.editVersion += 1;
		this.scheduleSave();
	}

	/** Whether the user has made unsaved changes. */
	get isEdited(): boolean {
		return this.hasBeenEdited;
	}

	private scheduleSave(): void {
		if (this.saveTimer) clearWindowTimeout(this.saveTimer);
		if (this.autoSaveSuspended) return;
		this.saveTimer = setWindowTimeout(() => { void this.persistEditorState('autosave'); }, 60000);
	}

	private suspendAutoSave(): void {
		this.autoSaveSuspended = true;
		if (this.saveTimer) {
			clearWindowTimeout(this.saveTimer);
			this.saveTimer = null;
		}
	}

	private resumeAutoSave(): void {
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
	}

	private commitEstimateReallocationBaseline(seconds: number): void {
		this.estimateReallocationBaseSeconds = Math.max(0, seconds);
	}

	private shouldRunAutomaticEstimateReallocation(reason: PersistReason): boolean {
		return this.isEstimateAutoReallocationEnabled()
			&& this.onApplyEstimateReallocation != null
			&& (reason === 'explicit-save' || reason === 'close-save');
	}

	private async maybeApplyAutomaticEstimateReallocation(
		reason: PersistReason,
	): Promise<{ attempted: boolean; applied: boolean }> {
		if (!this.shouldRunAutomaticEstimateReallocation(reason)) {
			return { attempted: false, applied: false };
		}

		const proposal = this.getEstimateReallocationProposal();
		if (!proposal || !this.onApplyEstimateReallocation) {
			this.commitEstimateReallocationBaseline(this.getDraftEstimateSeconds());
			this.refreshEstimateReallocationControl?.();
			return { attempted: false, applied: false };
		}

		const childOperonId = this.fieldValues['operonId'];
		if (!childOperonId) {
			return { attempted: false, applied: false };
		}

		const applied = await this.onApplyEstimateReallocation({
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
		if (!applied) {
			new Notice(t('taskEditor', 'estimateReallocationUnavailable'));
			this.refreshEstimateReallocationControl?.();
			return { attempted: true, applied: false };
		}

		this.commitEstimateReallocationBaseline(proposal.childEstimateAfterSeconds);
		this.syncTrackingFieldsFromIndex();
		this.refreshParentContextSection?.();
		this.refreshEstimateReallocationControl?.();
		if (reason === 'explicit-save') {
			await this.showEstimateReallocationInfoModal(proposal);
		}

		return { attempted: true, applied: true };
	}

	private syncCheckboxWithWorkflowStatus(): boolean {
		const currentCompleted = (this.fieldValues['dateCompleted'] ?? '').trim();
		const currentCancelled = (this.fieldValues['dateCancelled'] ?? '').trim();
		const previousCompleted = (this.existingTask?.fields.find(field => field.key === 'dateCompleted')?.value ?? '').trim();
		const previousCancelled = (this.existingTask?.fields.find(field => field.key === 'dateCancelled')?.value ?? '').trim();
		const completedChanged = currentCompleted !== previousCompleted;
		const cancelledChanged = currentCancelled !== previousCancelled;

		if (currentCompleted && currentCancelled) {
			new Notice(t('taskEditor', 'terminalDateConflict'));
			return false;
		}

		let reverseKey: 'dateCompleted' | 'dateCancelled' | null = null;
		let reverseValue = '';
		if (cancelledChanged) {
			reverseKey = 'dateCancelled';
			reverseValue = currentCancelled;
		} else if (completedChanged) {
			reverseKey = 'dateCompleted';
			reverseValue = currentCompleted;
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
				return false;
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
			return true;
		}

		const resolved = resolveWorkflowStatus(this.settings.pipelines, this.fieldValues['status']);
		if (!resolved) return true;

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
		return true;
	}

	private async persistEditorState(reason: PersistReason = 'autosave'): Promise<boolean> {
		if (this.persistInFlight) return this.persistInFlight;

		const run = (async () => {
			const versionAtStart = this.editVersion;
			if (this.saveTimer) {
				clearWindowTimeout(this.saveTimer);
				this.saveTimer = null;
			}
			if (!this.description.trim()) return false;

			if (!this.fieldValues['operonId']) {
				this.fieldValues['operonId'] = generateOperonId();
			}
			if (parseRepeatRule(this.fieldValues['repeat']) && !this.fieldValues['repeatSeriesId']) {
				this.fieldValues['repeatSeriesId'] = generateRepeatSeriesId();
			}
			this.syncDerivedRepeatFieldsFromDraft();

			this.maybeApplyScheduledAutomationToEditorState();

			if (!this.syncCheckboxWithWorkflowStatus()) {
				return false;
			}

			if (!this.hasSemanticDraftChanges()) {
				this.commitNoOpSaveBaseline();
				this.refreshEstimateReallocationControl?.();
				return true;
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
				rawLine: '',
			};

			const taskLine = serializeTask(task, this.settings.keyMappings);
			const saveResult = await this.onSave({
				taskLine,
				isNew: this.isNewTask,
				inlineCompletionMode: this.inlineCompletionMode,
				fileBody: this.fileBodyContext
					? {
						filePath: this.fileBodyContext.filePath,
						content: this.fileBodyDraft,
						dirty: this.isFileBodyDirty,
						format: this.fileBodyContext.format,
						targetLine: this.fileBodyContext.targetLine,
					}
					: null,
			});
			if (saveResult === false || saveResult === null) return false;
			this.persistedDescription = this.description;
			this.persistedCheckbox = this.checkbox;
			this.persistedTags = [...this.tags];
			this.persistedFieldValues = { ...this.fieldValues };
			this.persistedFileBodyDraft = this.fileBodyDraft;
			this.persistedInlineCompletionMode = this.inlineCompletionMode;
			this.isFileBodyDirty = false;
			const autoReallocationResult = await this.maybeApplyAutomaticEstimateReallocation(reason);
			if (!autoReallocationResult.attempted && reason === 'explicit-save') {
				this.commitEstimateReallocationBaseline(this.getDraftEstimateSeconds());
			} else if (!autoReallocationResult.attempted && reason === 'close-save') {
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
			return true;
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
