import { getNativePropertyIndex } from '../indexer/native-property-index';
import { applyDesktopModalBackdrop } from './modal-backdrop';
import { bindCreatorToolbarInteractionState } from './surface-interaction-state';
import { PreparedTaskCreatorDraft, type PreparedTaskCreatorAdapter } from './task-creator-prepared-draft';
import { openTableFilePropertyPicker } from './table/table-file-property-editor';
import { bindPropertyReadOnlyWarning } from './property-readonly-warning';
import { encodeVaultPropertyValue, type VaultPropertyValue } from '../core/vault-property-codec';
import { App, KeymapEventHandler, Menu, Modal, Notice, Platform, getIcon, setIcon } from 'obsidian';
import { getConfiguredKeyMappingIcon } from '../core/key-mapping-icons';
import { getSubtaskInheritedFieldKeys, resolveSubtaskInitialFieldsFromParentValues } from '../core/subtask-inheritance';
import { getAvailableReminderRuleAnchors } from './field-pickers/reminder-picker-model';
import { applyTaskFieldPatchToState, splitTaskListValue } from '../core/task-field-patch';
import { normalizeCompactTaskText } from '../core/compact-task-text';
import { t } from '../core/i18n';
import { resolveReverseWorkflowFromTerminalDate } from '../types/pipeline';
import { FileTaskTemplateOption } from '../core/file-task-templates';
import { IndexedTask } from '../types/fields';
import { OperonSettings, TASK_CREATOR_FALLBACK_FIELD_ICONS } from '../types/settings';
import { ConfirmActionModal } from './confirm-action-modal';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { getTaskCreatorToolbarTooltipCopy } from './key-mapping-descriptions';
import { suppressNativeModalCloseButton } from './modal-close-button';
import { showDependencyTaskPicker } from './field-pickers/dependency-task-picker';
import { showFileTaskTemplatePicker } from './field-pickers/file-task-template-picker';
import type { ManualDatePickerOptions } from './field-pickers/date-picker';
import { showSubtasksPicker } from './field-pickers/subtasks-picker';
import { showColorPicker } from './field-pickers/color-picker';
import { MOBILE_PICKER_CLOSE_EVENT, MOBILE_PICKER_OPEN_EVENT } from './field-pickers/common';
import type { ReminderPickerOperation } from './field-pickers/reminder-picker';
import { bindOperonHoverTooltip, cleanupOperonHoverTooltips } from './operon-hover-tooltip';
import {
	createCompactMarkdownEditorSurface,
	type CompactMarkdownEditorSurface,
} from './compact-markdown-editor-surface';
import { formatReminderDisplayItem } from './reminder-display';
import { openTaskFieldPicker } from './task-field-picker-dispatch';
import { getNativePropertyIcon, getCheckboxPropertyIcon, getCheckboxPropertyTypeIcon, getCustomFieldIcon, getCustomFieldLabel, getCustomFieldMapping, isProjectedCustomFieldType } from './custom-field-surfaces';
import {
	debugTaskFieldSuggestion,
	resolveTaskFieldSuggestions,
	TaskFieldSuggestionItem,
} from './task-field-suggest';
import { buildSubtaskExcludedIds } from '../core/task-hierarchy';
import {
	WindowTimeoutHandle,
	clearWindowTimeout,
	getActiveDocument,
	getActiveWindow,
 getOwnerWindow,
	setWindowTimeout,
} from '../core/dom-compat';
import {
	DEFAULT_INLINE_REPEAT_COMPLETION_MODE,
	type InlineRepeatCompletionMode,
	normalizeInlineCompletionMode,
} from '../storage/repeat-series-store';
import {
	resolveBlockedByAggregateVisualState,
	resolveBlockedByVisualStateColor,
} from '../core/blocked-by-visual-state';
import { formatUiDate } from '../core/ui-date-format';
import { formatUiTaskDatetime } from '../core/ui-time-format';

const TASK_CREATOR_NON_FIELD_SUBMIT_KEYS = new Set(['note', 'pinned', 'subtasks', 'tags']);
const TASK_CREATOR_DAY_PICKER_DATE_KEYS = new Set<string>([
	'dateStarted',
	'dateScheduled',
	'dateDue',
	'dateCompleted',
	'dateCancelled',
]);

type TaskCreatorFieldKey = string;

export type TaskCreatorSubmitMode = 'both' | 'inline-only' | 'file-only';
export type TaskCreatorCreateType = 'inline' | 'file';
export type TaskCreatorEnterAction = 'submit-inline' | 'submit-file' | 'open-template-picker';

export interface TaskCreatorDraft {
	description: string;
	note: string;
	tags: string[];
	inheritedTags: string[];
	subtaskIds: string[];
	fieldValues: Record<string, string>;
	explicitFieldKeys: string[];
	inheritedFieldKeys: string[];
	taskIcon: string;
	taskColor: string;
	noteOpen: boolean;
	fileTemplateId: string;
	inlineCompletionMode: InlineRepeatCompletionMode;
}

export interface TaskCreatorSubmitFieldSeed {
	fieldValues: Record<string, string>;
	fieldPresence: Set<string>;
	explicitEmptyFieldKeys: Set<string>;
}

export interface TaskCreatorModalOptions {
	getInlineParentPreview?: (draft: TaskCreatorDraft) => string | null;
 /** Internal shared draft and submission adapter. */
 preparedAdapter?: PreparedTaskCreatorAdapter;
 /** Keep a detached submission owned until it finishes or its draft is restored. */
 onSubmissionStateChange?: () => void;
	settings: OperonSettings;
	allTasks: IndexedTask[];
	getAllTasks?: () => IndexedTask[];
	subscribeIndexUpdates?: (listener: () => void) => () => void;
	initialDraft?: TaskCreatorDraft | null;
	submitMode?: TaskCreatorSubmitMode;
	initialCreateType?: TaskCreatorCreateType;
	defaultFileTemplateId?: string | null;
	defaultInlineTemplateId?: string | null;
	fileTaskTemplateOptions?: FileTaskTemplateOption[];
	onFileTemplateSelected?: (template: FileTaskTemplateOption) => void | Promise<void>;
	getAllRepeatSeriesIds?: () => Set<string>;
	onSubmitInline: (draft: TaskCreatorDraft) => Promise<boolean> | boolean;
	onSubmitFile: (draft: TaskCreatorDraft) => Promise<boolean> | boolean;
	onSubmitFailure?: (draft: TaskCreatorDraft, createType: TaskCreatorCreateType) => void | Promise<void>;
	onCancel?: () => void;
	initialOutsidePointerGraceMs?: number;
	preventFocusScroll?: boolean;
}

type TaskCreatorSuggestion = TaskFieldSuggestionItem | { action: 'template'; visibleName: string };

interface SuggestionState {
	items: TaskCreatorSuggestion[];
	activeIndex: number;
	range: { start: number; end: number };
}

export function createEmptyTaskCreatorDraft(): TaskCreatorDraft {
	return {
		description: '',
		note: '',
		tags: [],
		inheritedTags: [],
		subtaskIds: [],
		fieldValues: {},
		explicitFieldKeys: [],
		inheritedFieldKeys: [],
		taskIcon: '',
		taskColor: '',
		noteOpen: false,
		fileTemplateId: '',
		inlineCompletionMode: DEFAULT_INLINE_REPEAT_COMPLETION_MODE,
	};
}

export function cloneTaskCreatorDraft(draft: TaskCreatorDraft | null | undefined): TaskCreatorDraft {
	const base = draft ?? createEmptyTaskCreatorDraft();
	return {
		description: base.description ?? '',
		note: base.note ?? '',
		tags: [...(base.tags ?? [])],
		inheritedTags: [...(base.inheritedTags ?? [])],
		subtaskIds: [...(base.subtaskIds ?? [])],
		fieldValues: { ...(base.fieldValues ?? {}) },
		explicitFieldKeys: [...(base.explicitFieldKeys ?? [])],
		inheritedFieldKeys: [...(base.inheritedFieldKeys ?? [])],
		taskIcon: base.taskIcon ?? base.fieldValues?.['taskIcon'] ?? '',
		taskColor: base.taskColor ?? base.fieldValues?.['taskColor'] ?? '',
		noteOpen: base.noteOpen === true || !!(base.note ?? '').trim(),
		fileTemplateId: base.fileTemplateId ?? '',
		inlineCompletionMode: normalizeInlineCompletionMode(base.inlineCompletionMode),
	};
}

export function normalizeTaskCreatorSubmitMode(mode: TaskCreatorSubmitMode | null | undefined): TaskCreatorSubmitMode {
	return mode ?? 'both';
}

function isTaskCreatorCreateTypeAllowed(
	mode: TaskCreatorSubmitMode,
	createType: TaskCreatorCreateType,
): boolean {
	if (mode === 'inline-only') return createType === 'inline';
	if (mode === 'file-only') return createType === 'file';
	return true;
}

export function getInitialTaskCreatorCreateType(
	mode: TaskCreatorSubmitMode,
	requestedCreateType?: TaskCreatorCreateType | null,
	hasFileTemplate = false,
): TaskCreatorCreateType {
	if (requestedCreateType && isTaskCreatorCreateTypeAllowed(mode, requestedCreateType)) {
		return requestedCreateType;
	}
	if (mode === 'file-only') return 'file';
	return mode === 'both' && hasFileTemplate ? 'file' : 'inline';
}

export function isTaskCreatorTemplateControlEnabled(
	mode: TaskCreatorSubmitMode,
	activeCreateType: TaskCreatorCreateType,
): boolean {
	return mode !== 'inline-only' && activeCreateType === 'file';
}

export function resolveTaskCreatorEnterAction(
	activeCreateType: TaskCreatorCreateType,
	hasSelectedFileTemplate: boolean,
): TaskCreatorEnterAction {
	if (activeCreateType === 'file') {
		return hasSelectedFileTemplate ? 'submit-file' : 'open-template-picker';
	}
	return 'submit-inline';
}

export function resolveTaskCreatorFileTemplateIdForMode(
	activeCreateType: TaskCreatorCreateType,
	currentFileTemplateId: string | null | undefined,
	defaultFileTemplateId: string | null | undefined,
): string {
	const current = (currentFileTemplateId ?? '').trim();
	if (current) return current;
	if (activeCreateType !== 'file') return '';
	return (defaultFileTemplateId ?? '').trim();
}

export function canSubmitTaskCreatorFileTask(
	mode: TaskCreatorSubmitMode,
	activeCreateType: TaskCreatorCreateType,
	hasSelectedFileTemplate: boolean,
): boolean {
	return mode !== 'inline-only' && activeCreateType === 'file' && hasSelectedFileTemplate;
}

export function shouldReclaimTaskCreatorDescriptionFocus(
	activeElement: Element | null,
	descriptionElement: Element,
	userInterruptedInitialFocus: boolean,
): boolean {
	return !userInterruptedInitialFocus
		&& activeElement !== descriptionElement
		&& !descriptionElement.contains(activeElement);
}

export function isTaskCreatorControlVisible(candidate: HTMLElement): boolean {
	for (let current: HTMLElement | null = candidate; current; current = current.parentElement) {
		if (current.hidden || current.getAttribute('aria-hidden') === 'true') return false;
		const inlineStyle = current.style;
		if (
			inlineStyle.display === 'none'
			|| inlineStyle.visibility === 'hidden'
			|| inlineStyle.visibility === 'collapse'
		) {
			return false;
		}
		const computedStyle = current.ownerDocument.defaultView?.getComputedStyle(current);
		if (
			computedStyle?.display === 'none'
			|| computedStyle?.visibility === 'hidden'
			|| computedStyle?.visibility === 'collapse'
		) {
			return false;
		}
	}
	return true;
}

export function isTaskCreatorFieldExplicitlyCleared(draft: TaskCreatorDraft, key: string): boolean {
	return draft.explicitFieldKeys.includes(key) && !(draft.fieldValues[key] ?? '').trim();
}

function normalizeTaskCreatorTags(tags: readonly string[] | null | undefined): string[] {
	const normalized: string[] = [];
	const seen = new Set<string>();
	for (const rawTag of tags ?? []) {
		const tag = rawTag.trim().replace(/^#/, '').trim();
		if (!tag || seen.has(tag)) continue;
		seen.add(tag);
		normalized.push(tag);
	}
	return normalized;
}

function removeTags(tags: readonly string[], tagsToRemove: readonly string[]): string[] {
	if (tagsToRemove.length === 0) return normalizeTaskCreatorTags(tags);
	const removalSet = new Set(normalizeTaskCreatorTags(tagsToRemove));
	return normalizeTaskCreatorTags(tags).filter(tag => !removalSet.has(tag));
}

export function applyTaskCreatorInheritedTagsToDraft(
	draft: TaskCreatorDraft,
	inheritedTags: readonly string[] | null | undefined,
): void {
	const baseTags = removeTags(draft.tags, draft.inheritedTags ?? []);
	const baseSet = new Set(baseTags);
	const nextTags = [...baseTags];
	const nextInheritedTags: string[] = [];

	for (const tag of normalizeTaskCreatorTags(inheritedTags)) {
		if (baseSet.has(tag)) continue;
		baseSet.add(tag);
		nextTags.push(tag);
		nextInheritedTags.push(tag);
	}

	draft.tags = nextTags;
	draft.inheritedTags = nextInheritedTags;
}

export function buildTaskCreatorSubmitFieldSeed(draft: TaskCreatorDraft): TaskCreatorSubmitFieldSeed {
	const fieldValues = { ...draft.fieldValues };
	delete fieldValues['pinned'];
	const note = normalizeCompactTaskText(draft.note, 'task-note');
	if (note) {
		fieldValues['note'] = note;
	} else {
		delete fieldValues['note'];
	}

	const fieldPresence = new Set(Object.keys(fieldValues));
	const explicitEmptyFieldKeys = new Set<string>();
	for (const key of draft.explicitFieldKeys) {
		if (TASK_CREATOR_NON_FIELD_SUBMIT_KEYS.has(key)) continue;
		if ((fieldValues[key] ?? '').trim()) continue;
		fieldValues[key] = '';
		fieldPresence.add(key);
		explicitEmptyFieldKeys.add(key);
	}

	return {
		fieldValues,
		fieldPresence,
		explicitEmptyFieldKeys,
	};
}

export function resolveTaskCreatorParentFieldValues(
	parentTaskId: string,
	allTasks: IndexedTask[],
	cachedParentFieldValuesById: Map<string, Record<string, string> | null>,
): Record<string, string> | null {
	const normalizedParentTaskId = parentTaskId.trim();
	if (!normalizedParentTaskId) return null;
	const parentTask = allTasks.find(task => task.operonId === normalizedParentTaskId) ?? null;
	if (parentTask) return parentTask.fieldValues;
	return cachedParentFieldValuesById.get(normalizedParentTaskId) ?? null;
}

export function resolveTaskCreatorParentTags(
	parentTaskId: string,
	allTasks: IndexedTask[],
	cachedParentTagsById: Map<string, string[] | null>,
): string[] | null {
	const normalizedParentTaskId = parentTaskId.trim();
	if (!normalizedParentTaskId) return null;
	const parentTask = allTasks.find(task => task.operonId === normalizedParentTaskId) ?? null;
	if (parentTask) return [...parentTask.tags];
	const cachedTags = cachedParentTagsById.get(normalizedParentTaskId);
	return cachedTags ? [...cachedTags] : null;
}

export function reconcileTaskCreatorParentInheritanceForDraft(
	draft: TaskCreatorDraft,
	parentFieldValues: Record<string, string> | null,
	parentTags: readonly string[] | null | undefined,
	settings: OperonSettings,
): void {
	const parentTaskId = (draft.fieldValues['parentTask'] ?? '').trim();
	const explicit = new Set(draft.explicitFieldKeys);
	const inheritedApplied = new Set(draft.inheritedFieldKeys);
	const nextFieldValues = { ...draft.fieldValues };
	const nextInherited = new Set<string>();

	if (!parentTaskId) {
		for (const key of inheritedApplied) {
			if (!explicit.has(key)) {
				delete nextFieldValues[key];
			}
		}
		draft.fieldValues = nextFieldValues;
		draft.inheritedFieldKeys = [];
		if (!explicit.has('tags')) {
			applyTaskCreatorInheritedTagsToDraft(draft, []);
		}
		draft.taskIcon = nextFieldValues['taskIcon'] ?? '';
		draft.taskColor = nextFieldValues['taskColor'] ?? '';
		return;
	}

	const inherited = resolveSubtaskInitialFieldsFromParentValues(
		parentTaskId,
		parentFieldValues,
		settings,
		parentTags,
	);

	const candidateKeys = new Set([
		...inheritedApplied,
		...getSubtaskInheritedFieldKeys(inherited),
	]);
	for (const key of candidateKeys) {
		if (explicit.has(key)) continue;
		const rawInheritedValue = inherited[key];
		const inheritedValue = typeof rawInheritedValue === 'string' ? rawInheritedValue.trim() : '';
		if (inheritedValue) {
			nextFieldValues[key] = inheritedValue;
			nextInherited.add(key);
			continue;
		}
		if (inheritedApplied.has(key)) {
			delete nextFieldValues[key];
		}
	}

	draft.fieldValues = nextFieldValues;
	draft.inheritedFieldKeys = Array.from(nextInherited);
	if (!explicit.has('tags')) {
		applyTaskCreatorInheritedTagsToDraft(draft, inherited.tags);
	}
	draft.taskIcon = nextFieldValues['taskIcon'] ?? '';
	draft.taskColor = nextFieldValues['taskColor'] ?? '';
}

export function applyTaskCreatorBackgroundParentSeedToDraft(
	draft: TaskCreatorDraft,
	parentTaskId: string,
	parentFieldValues: Record<string, string> | null,
	parentTags: readonly string[] | null | undefined,
	settings: OperonSettings,
): boolean {
	const normalizedParentTaskId = parentTaskId.trim();
	if (!normalizedParentTaskId) return false;
	if ((draft.fieldValues['parentTask'] ?? '').trim()) return false;
	if (isTaskCreatorFieldExplicitlyCleared(draft, 'parentTask')) return false;
	draft.fieldValues = { ...draft.fieldValues, parentTask: normalizedParentTaskId };
	reconcileTaskCreatorParentInheritanceForDraft(draft, parentFieldValues, parentTags, settings);
	return true;
}

export function buildTaskCreatorSnapshot(draft: TaskCreatorDraft): TaskCreatorDraft {
	const description = draft.description.replace(/\r?\n+/g, ' ').trim();
	const note = normalizeCompactTaskText(draft.note, 'task-note');
	return {
		description,
		note,
		tags: [...draft.tags],
		inheritedTags: [...draft.inheritedTags],
		subtaskIds: [...draft.subtaskIds],
		fieldValues: { ...draft.fieldValues },
		explicitFieldKeys: [...draft.explicitFieldKeys],
		inheritedFieldKeys: [...draft.inheritedFieldKeys],
		taskIcon: draft.fieldValues['taskIcon'] ?? draft.taskIcon,
		taskColor: draft.fieldValues['taskColor'] ?? draft.taskColor,
		noteOpen: draft.noteOpen || !!note,
		fileTemplateId: draft.fileTemplateId ?? '',
		inlineCompletionMode: normalizeInlineCompletionMode(draft.inlineCompletionMode),
	};
}

export function buildTaskCreatorSnapshotForCreateType(
	draft: TaskCreatorDraft,
	createType: TaskCreatorCreateType,
): TaskCreatorDraft {
	const snapshot = buildTaskCreatorSnapshot(draft);
	if (createType === 'inline') {
		snapshot.fileTemplateId = '';
	}
	return snapshot;
}

export function buildSubtaskTaskCreatorDraft(
	parentOperonId: string,
	parentFieldValues: Record<string, string> | null | undefined,
	parentTags: readonly string[] | null | undefined,
	settings: OperonSettings,
): TaskCreatorDraft {
	const draft = createEmptyTaskCreatorDraft();
	const inherited = resolveSubtaskInitialFieldsFromParentValues(parentOperonId, parentFieldValues, settings, parentTags);
	const inheritedFieldKeys: string[] = [];

	if (inherited.parentTask) {
		draft.fieldValues['parentTask'] = inherited.parentTask;
	}
	for (const key of getSubtaskInheritedFieldKeys(inherited)) {
		const rawValue = inherited[key];
		const value = typeof rawValue === 'string' ? rawValue.trim() : '';
		if (!value) continue;
		draft.fieldValues[key] = value;
		inheritedFieldKeys.push(key);
	}

	draft.inheritedFieldKeys = inheritedFieldKeys;
	applyTaskCreatorInheritedTagsToDraft(draft, inherited.tags);
	draft.taskIcon = draft.fieldValues['taskIcon'] ?? '';
	draft.taskColor = draft.fieldValues['taskColor'] ?? '';
	return draft;
}

export function purgeTaskCreatorModalArtifacts(root: ParentNode = getActiveDocument()): void {
	const selectors = [
		'.operon-task-creator-modal-container',
		'.operon-task-creator-modal',
		'.operon-task-creator',
		'.operon-task-creator-title',
	];
	const roots = new Set<Element>();
	for (const el of Array.from(root.querySelectorAll<HTMLElement>(selectors.join(', ')))) {
		const modalRoot = el.closest('.modal-container');
		const modalEl = el.closest('.modal');
		roots.add(modalRoot ?? modalEl ?? el);
	}
	for (const node of roots) {
		node.remove();
	}
}

export class TaskCreatorModal extends Modal {
 private viewportWindow: Window | null = null;
 private viewportCloseTimers = new Set<number>();
 private stopViewportMigration: (() => void) | null = null;

	private readonly options: TaskCreatorModalOptions;
 private readonly prepared: PreparedTaskCreatorDraft | null;
 private draftPropertiesCleanup?: () => void;
 private preparedClosed = false;
 private detachedForSubmit = false;
 private submissionClosePending = false;
 private hasOpened = false;
 private templateErrorEl: HTMLElement | null = null;
	private readonly submitMode: TaskCreatorSubmitMode;
	private draft: TaskCreatorDraft;
 private readonly initialDraftSnapshot: TaskCreatorDraft;
 private readonly templateSelectionBaselines = new Map<TaskCreatorCreateType, string>();
 private readonly userTemplateSelections = new Map<TaskCreatorCreateType, string>();
	private activeCreateType: TaskCreatorCreateType;
 private inlineParentPreviewBase: TaskCreatorDraft | null = null;
	private descriptionHostEl!: HTMLElement;
	private noteHostEl: HTMLElement | null = null;
	private descriptionCompactEditor: CompactMarkdownEditorSurface | null = null;
	private noteCompactEditor: CompactMarkdownEditorSurface | null = null;
	private noteWrapEl: HTMLElement | null = null;
	private suggestionsEl: HTMLElement | null = null;
	private reminderStripEl!: HTMLElement;
	private metadataRowEl!: HTMLElement;
	private toolsEl!: HTMLElement;
	private actionRowEl!: HTMLElement;
	private cancelButtonEl!: HTMLButtonElement;
	private inlineButtonEl!: HTMLButtonElement;
	private fileButtonEl!: HTMLButtonElement;
	private templateButtonEl!: HTMLButtonElement;
	private fieldButtonMap = new Map<TaskCreatorFieldKey, HTMLButtonElement>();
	private cleanupInteractionState: (() => void) | null = null;
	private backdropCleanup: (() => void) | null = null;
	private nativeCloseButtonCleanup: (() => void) | null = null;
	private suggestionState: SuggestionState | null = null;
	private creatorPickerClose: (() => void) | null = null;
	private get activePickerClose(): (() => void) | null { return this.creatorPickerClose; }
	private set activePickerClose(close: (() => void) | null) {
		this.creatorPickerClose = close;
		this.contentEl.toggleClass('has-open-creator-picker', close !== null && !this.templateButtonEl?.hasClass('is-picker-open'));
	}
	private escapeScopeHandler: KeymapEventHandler | null = null;
	private keyboardWindow: Window | null = null;
	private seededParentFieldValuesById = new Map<string, Record<string, string> | null>();
	private seededParentTagsById = new Map<string, string[] | null>();
	private allowDirectClose = false;
	private isSubmitting = false;
 private preparedUncertain = false;
	private resolved = false;
	private isOutsideConfirmOpen = false;
	private initialDescriptionFocusTimers: WindowTimeoutHandle[] = [];
	private initialDescriptionFocusInterrupted = false;
	private ignoreOutsidePointerUntil = 0;
	private mobilePickerOpenDepth = 0;
	private indexUpdatesUnsubscribe: (() => void) | null = null;
	private readonly resizeHandler = () => {
		this.updateMobileViewportHeight();
		this.refreshRenderedTextEditors();
	};
	private readonly visualViewportHandler = () => {
		this.updateMobileViewportHeight();
	};
	private readonly mobilePickerOpenHandler = () => {
		this.mobilePickerOpenDepth += 1;
	};
	private readonly mobilePickerCloseHandler = () => {
		this.mobilePickerOpenDepth = Math.max(0, this.mobilePickerOpenDepth - 1);
		const owner = this.viewportWindow ?? getOwnerWindow(this.containerEl);
  const timer = owner.setTimeout(() => { this.viewportCloseTimers.delete(timer); if (!this.preparedClosed) this.updateMobileViewportHeight(); }, 80);
  this.viewportCloseTimers.add(timer);
	};

	constructor(app: App, options: TaskCreatorModalOptions) {
		super(app);
		this.options = options;
		this.draft = cloneTaskCreatorDraft(options.initialDraft);
  this.prepared = options.preparedAdapter ? new PreparedTaskCreatorDraft(options.preparedAdapter, options.settings) : null;
  this.prepared?.syncLegacy(this.draft);
		this.submitMode = normalizeTaskCreatorSubmitMode(options.submitMode);
		this.activeCreateType = getInitialTaskCreatorCreateType(
			this.submitMode,
			options.initialCreateType,
			!!this.draft.fileTemplateId,
		);
		if (this.prepared) {
   this.draft.fileTemplateId ||= this.getModeDefaultTemplateId();
  } else this.applyDefaultFileTemplateForActiveMode();
  this.refreshInlineParentPreview();
  this.initialDraftSnapshot = this.getSnapshot();
  this.templateSelectionBaselines.set('file', options.defaultFileTemplateId?.trim() ?? '');
  this.templateSelectionBaselines.set('inline', options.defaultInlineTemplateId?.trim() ?? '');
  this.templateSelectionBaselines.set(this.activeCreateType, this.draft.fileTemplateId);
	}

	onOpen(): void {
  this.draftPropertiesCleanup?.();
  this.draftPropertiesCleanup = getNativePropertyIndex(this.app).observeDraftProperties(() => [
   ...Object.keys(this.draft.fieldValues),
   ...(this.prepared?.draft.snapshot().fields.filter(field => field.state !== 'missing' && field.state !== 'removed').map(field => field.property.sourceName) ?? []),
  ]);
  const firstOpen = !this.hasOpened; this.hasOpened = true;
		this.cleanupInteractionState?.();
		this.cleanupInteractionState = null;
		this.containerEl.addClass('operon-task-creator-modal-container');
		this.backdropCleanup?.();
		this.backdropCleanup = applyDesktopModalBackdrop(this.containerEl);
		this.modalEl.addClass('operon-task-creator-modal');
		this.nativeCloseButtonCleanup?.();
		this.nativeCloseButtonCleanup = suppressNativeModalCloseButton(this.containerEl, this.modalEl);
		if (Platform.isPhone) {
			this.containerEl.addClass('operon-task-creator-modal-container-mobile');
			this.modalEl.addClass('operon-task-creator-modal-mobile');
		}
		this.titleEl.addClass('operon-task-creator-title');
		this.titleEl.setText(t('modals', 'taskCreatorTitle'));
		cleanupOperonHoverTooltips(this.contentEl);
		this.contentEl.empty();
		this.bindViewportWindow();
		this.updateMobileViewportHeight();
		this.registerMobilePickerListeners();
		this.render();
		this.cleanupInteractionState = bindCreatorToolbarInteractionState(this.contentEl);
		// Seed the caret once; later focus recovery keeps the user’s current position.
		const descriptionEnd = this.getDescriptionDisplayValue().length;
		this.descriptionCompactEditor?.setSelection?.({ anchor: descriptionEnd, head: descriptionEnd });
  if (this.prepared && firstOpen) void this.selectPreparedTemplateId(this.draft.fileTemplateId);
		this.indexUpdatesUnsubscribe?.();
		this.indexUpdatesUnsubscribe = this.options.subscribeIndexUpdates?.(() => {
			this.refreshBlockedByDependencyControl();
   if (this.prepared) { this.prepared.refreshParent(); this.refreshPreparedDraft(); }
   else if (this.options.getInlineParentPreview) { this.refreshInlineParentPreview(); this.renderFieldButtons(); this.applyThemeColor(); }
		}) ?? null;
		this.applyThemeColor();
		this.allowDirectClose = false;
		if (this.options.initialOutsidePointerGraceMs && this.options.initialOutsidePointerGraceMs > 0) {
			this.ignoreOutsidePointerUntil = Date.now() + Math.round(this.options.initialOutsidePointerGraceMs);
		}
		this.escapeScopeHandler = this.scope.register(null, 'Escape', () => {
			this.handleEscapeIntent();
			return false;
		});
		this.keyboardWindow = getOwnerWindow(this.containerEl);
		this.keyboardWindow.addEventListener('keydown', this.handleWindowKeydownCapture, true);
		this.keyboardWindow.addEventListener('keydown', this.handleInitialDescriptionFocusKeydown, true);
		this.containerEl.addEventListener('mousedown', this.handleContainerPointerDown, true);
		this.containerEl.addEventListener('click', this.handleContainerPointerDown, true);
		this.containerEl.addEventListener('mousedown', this.handleInitialDescriptionFocusPointerDown, true);
		this.startInitialDescriptionFocusGuard();
	}

	onClose(): void {
		this.backdropCleanup?.();
		this.backdropCleanup = null;
		this.cleanupInteractionState?.();
		this.cleanupInteractionState = null;
  if (!this.detachedForSubmit) { this.preparedClosed = true; this.prepared?.close(); this.draftPropertiesCleanup?.(); this.draftPropertiesCleanup = undefined; }
		this.nativeCloseButtonCleanup?.();
		this.nativeCloseButtonCleanup = null;
		this.indexUpdatesUnsubscribe?.();
		this.indexUpdatesUnsubscribe = null;
		if (this.escapeScopeHandler) {
			this.scope.unregister(this.escapeScopeHandler);
			this.escapeScopeHandler = null;
		}
		this.stopViewportMigration?.(); this.stopViewportMigration = null;
  for (const timer of this.viewportCloseTimers) this.viewportWindow?.clearTimeout(timer);
  this.viewportCloseTimers.clear();
  this.viewportWindow?.removeEventListener('resize', this.resizeHandler);
		this.unregisterMobileViewportListeners();
  this.viewportWindow = null;
		this.unregisterMobilePickerListeners();
		this.mobilePickerOpenDepth = 0;
		this.keyboardWindow?.removeEventListener('keydown', this.handleWindowKeydownCapture, true);
		this.keyboardWindow?.removeEventListener('keydown', this.handleInitialDescriptionFocusKeydown, true);
		this.keyboardWindow = null;
		this.containerEl.removeEventListener('mousedown', this.handleContainerPointerDown, true);
		this.containerEl.removeEventListener('click', this.handleContainerPointerDown, true);
		this.containerEl.removeEventListener('mousedown', this.handleInitialDescriptionFocusPointerDown, true);
		this.containerEl.style.removeProperty('--operon-task-creator-mobile-viewport-height');
		this.clearInitialDescriptionFocusGuard();
		this.closeActivePicker();
		this.closeSuggestions();
		this.descriptionCompactEditor?.destroy();
		this.descriptionCompactEditor = null;
		this.noteCompactEditor?.destroy();
		this.noteCompactEditor = null;
		cleanupOperonHoverTooltips(this.contentEl);
		this.contentEl.empty();
		if (!this.resolved && !this.detachedForSubmit) {
			this.options.onCancel?.();
		}
  this.submissionClosePending = false;
  if (this.detachedForSubmit && !this.isSubmitting) {
   if (this.options.onSubmissionStateChange) this.options.onSubmissionStateChange();
   else this.restoreSubmittedDraft();
  }
	}

 private bindViewportWindow(): void {
  const next = getOwnerWindow(this.containerEl), old = this.viewportWindow;
  if (old === next) return;
  for (const timer of this.viewportCloseTimers) old?.clearTimeout(timer);
  this.viewportCloseTimers.clear();
  old?.removeEventListener('resize', this.resizeHandler);
  old?.visualViewport?.removeEventListener('resize', this.visualViewportHandler);
  old?.visualViewport?.removeEventListener('scroll', this.visualViewportHandler);
  if (this.keyboardWindow) {
   this.keyboardWindow.removeEventListener('keydown', this.handleWindowKeydownCapture, true);
   next.addEventListener('keydown', this.handleWindowKeydownCapture, true);
   this.keyboardWindow.removeEventListener('keydown', this.handleInitialDescriptionFocusKeydown, true);
   next.addEventListener('keydown', this.handleInitialDescriptionFocusKeydown, true);
   this.keyboardWindow = next;
  }
  this.viewportWindow = next;
  next.addEventListener('resize', this.resizeHandler);
  this.registerMobileViewportListeners();
  if (!this.stopViewportMigration) this.stopViewportMigration = this.containerEl.onWindowMigrated?.(() => { if (this.viewportWindow) this.bindViewportWindow(); }) ?? null;
  if (old) {
   this.backdropCleanup?.(); this.backdropCleanup = applyDesktopModalBackdrop(this.containerEl);
   this.updateMobileViewportHeight();
   this.clearInitialDescriptionFocusGuard();
  }
 }

	private render(): void {
		const shell = this.contentEl.createDiv('operon-task-creator');
		const body = shell.createDiv('operon-task-creator-body');

		const composerWrap = body.createDiv('operon-task-creator-composer-wrap');
		this.descriptionHostEl = composerWrap.createDiv(
			'operon-task-creator-compact-text-host is-description',
		);
		this.descriptionCompactEditor?.destroy();
		this.descriptionCompactEditor = createCompactMarkdownEditorSurface(this.descriptionHostEl, {
			app: this.app,
			sourceValue: this.draft.description,
			placeholder: t('taskEditor', 'creatorDescriptionPlaceholder'),
			ariaLabel: t('taskEditor', 'description'),
			onUserChange: draft => {
     if (this.prepared && this.isSubmitting) return;
				this.draft.description = draft.persistableValue;
    this.refreshPreparedDraft();
				this.syncSuggestions();
			},
			onSelectionChange: () => this.syncSuggestions(),
			onKeyDown: event => this.handleDescriptionEditorKeydown(event),
			onTextareaLayout: textarea => this.autoSizeTextarea(textarea),
			onIntent: intent => this.handleCreatorCompactEditorIntent('description', intent),
		});

		this.suggestionsEl = body.createDiv('operon-task-creator-suggestions');
		this.suggestionsEl.hide();

		this.noteWrapEl = body.createDiv('operon-task-creator-note-wrap');
		this.noteWrapEl.hide();
		this.noteHostEl = this.noteWrapEl.createDiv(
			'operon-task-creator-compact-text-host is-notes',
		);
		this.noteCompactEditor?.destroy();
		this.noteCompactEditor = createCompactMarkdownEditorSurface(this.noteHostEl, {
			app: this.app,
			sourceValue: this.draft.note,
			placeholder: t('taskEditor', 'creatorNotePlaceholder'),
			ariaLabel: t('taskEditor', 'notes'),
			textPolicy: 'task-note',
			onUserChange: draft => {
     if (this.prepared && this.isSubmitting) return;
				this.draft.note = draft.persistableValue;
    this.prepared?.draft.setValue('note', this.draft.note);
    this.refreshPreparedDraft();
				this.draft.noteOpen = this.draft.noteOpen || !!this.draft.note.trim();
				this.syncFieldButtonActiveState('note');
			},
			onTextareaLayout: textarea => this.autoSizeTextarea(textarea),
			onIntent: intent => this.handleCreatorCompactEditorIntent('note', intent),
		});
		if (this.draft.noteOpen) {
			this.noteWrapEl.show();
		}

		this.reminderStripEl = body.createDiv('operon-task-creator-reminder-strip');
		this.metadataRowEl = body.createDiv('operon-task-creator-toolbar');
		this.toolsEl = this.metadataRowEl.createDiv('operon-task-creator-tools');
		for (const key of this.getVisibleToolbarFieldOrder()) {
			const button = this.toolsEl.createEl('button', {
				cls: 'operon-task-creator-tool',
				attr: {
					type: 'button',
					'data-field-key': key,
				},
			});
			setAccessibleLabelWithoutTooltip(button, this.getFieldLabel(key));
			button.addEventListener('click', () => this.handleFieldButtonClick(key));
			this.fieldButtonMap.set(key, button);
   if (this.prepared) this.bindPreparedRemoval(button, key);
		}

		this.actionRowEl = body.createDiv('operon-task-creator-action-row');
		this.cancelButtonEl = this.actionRowEl.createEl('button', {
			cls: 'operon-task-creator-action is-secondary is-cancel',
			text: t('buttons', 'cancel'),
			attr: { type: 'button' },
		});
		this.cancelButtonEl.addEventListener('click', () => this.forceClose());

		const actions = this.actionRowEl.createDiv('operon-task-creator-actions');
		const templateHost = this.prepared ? actions.createDiv('operon-task-creator-template-control') : actions;
		this.templateButtonEl = templateHost.createEl('button', {
			cls: 'operon-task-creator-action operon-task-creator-template-action is-secondary',
			attr: {
				type: 'button',
			},
		});
		this.templateButtonEl.addEventListener('click', () => this.openFileTemplatePicker());

		if (this.prepared) this.templateErrorEl = templateHost.createDiv({ cls: 'operon-task-creator-template-error', attr: { role: 'status' } });

		this.fileButtonEl = actions.createEl('button', {
			cls: 'operon-task-creator-action is-secondary',
			text: t('buttons', 'file'),
			attr: { type: 'button' },
		});
		this.fileButtonEl.addEventListener('click', () => {
			void this.handleFileAction();
		});

		this.inlineButtonEl = actions.createEl('button', {
			cls: 'operon-task-creator-action is-primary',
			text: t('buttons', 'inline'),
			attr: { type: 'button' },
		});
		this.inlineButtonEl.addEventListener('click', () => {
			void this.handleInlineAction();
		});

		this.renderFieldButtons();
		this.renderSubmitControls();
		this.renderNoteVisibility();
	}

	private handleDescriptionEditorKeydown(event: KeyboardEvent): boolean {
		if (event.key === 'ArrowDown' && this.suggestionState) {
			event.preventDefault();
			this.moveSuggestion(1);
			return true;
		}
		if (event.key === 'ArrowUp' && this.suggestionState) {
			event.preventDefault();
			this.moveSuggestion(-1);
			return true;
		}
		if (event.key === 'Enter') {
			if (this.suggestionState) {
				event.preventDefault();
				this.chooseSuggestion(this.suggestionState.items[this.suggestionState.activeIndex] ?? null);
				return true;
			}
		}
		return false;
	}

	private handleCreatorCompactEditorIntent(
		field: 'description' | 'note',
		intent: 'submit' | 'explicit-submit' | 'escape' | 'focus-next' | 'focus-previous',
	): void {
		if (intent === 'submit' || intent === 'explicit-submit') {
			void this.handleEnterSubmit();
			return;
		}
		if (intent === 'escape') {
			this.handleEscapeIntent();
			return;
		}
		this.focusAdjacentTaskCreatorControl(
			field === 'description' ? this.descriptionHostEl : this.noteHostEl,
			intent === 'focus-next' ? 'next' : 'previous',
		);
	}

	private readonly handleContainerPointerDown = (event: MouseEvent): void => {
		if (this.isOutsideConfirmOpen || this.resolved) return;
		if (Date.now() < this.ignoreOutsidePointerUntil) return;
		const target = event.target as Node | null;
		if (!target) return;
		const targetElement = target.nodeType === 1 ? target as Element : target.parentElement;
		if (targetElement?.closest('.operon-floating-panel')) {
			this.suppressOutsidePointerBriefly();
			return;
		}
		if (this.modalEl.contains(target)) return;

		event.preventDefault();
		event.stopPropagation();

		if (!this.hasUnsavedDraft()) {
			this.forceClose();
			return;
		}

		this.promptDiscardDraft();
	};

	private readonly handleWindowKeydownCapture = (event: KeyboardEvent): void => {
		if (event.key !== 'Escape' || this.resolved || this.isOutsideConfirmOpen) return;
		if (!this.modalEl.isConnected) return;
		const target = event.target as Node | null;
		if (!target || !this.containerEl.contains(target)) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		this.handleEscapeIntent();
	};

	private readonly handleInitialDescriptionFocusPointerDown = (event: MouseEvent): void => {
		const target = event.target as Node | null;
		if (!target || this.descriptionHostEl?.contains(target) || !this.modalEl.contains(target)) return;
		this.initialDescriptionFocusInterrupted = true;
	};

	private readonly handleInitialDescriptionFocusKeydown = (event: KeyboardEvent): void => {
		if (event.key === 'Tab') {
			this.initialDescriptionFocusInterrupted = true;
		}
	};

	requestEscapeClose(): void {
		this.handleEscapeIntent();
	}

	private handleEscapeIntent(): void {
		if (this.resolved || this.isOutsideConfirmOpen) return;
		if (this.suggestionState) {
			this.closeSuggestions();
			window.setTimeout(() => this.focusDescription(this.getDescriptionCaret()), 0);
			return;
		}

		if (this.activePickerClose) {
			this.closeActivePicker();
			return;
		}

		if (!this.hasUnsavedDraft()) {
			this.forceClose();
			return;
		}

		this.promptDiscardDraft();
	}

	private focusDescription(caret: number): void {
		this.descriptionCompactEditor?.focus({ preventScroll: this.options.preventFocusScroll === true });
		this.descriptionCompactEditor?.setSelection?.({ anchor: caret, head: caret });
		this.syncSuggestions();
	}

	private getDescriptionDisplayValue(): string {
		return this.descriptionCompactEditor?.getDraft().displayValue ?? this.draft.description;
	}

	private getDescriptionCaret(): number {
		return this.descriptionCompactEditor?.getSelection?.().head ?? this.getDescriptionDisplayValue().length;
	}

	private suppressOutsidePointerBriefly(): void {
		this.ignoreOutsidePointerUntil = Date.now() + 700;
	}

	private startInitialDescriptionFocusGuard(): void {
		this.clearInitialDescriptionFocusGuard();
		this.initialDescriptionFocusInterrupted = false;
		this.scheduleDescriptionFocusReclaims([0, 40, 120, 260, 520, 900]);
	}

	reclaimDescriptionFocusAfterBackgroundMutation(): void {
		this.scheduleDescriptionFocusReclaims([0, 80, 200, 500, 1000, 1800]);
	}

	applyBackgroundParentSeed(parentTaskId: string, parentFieldValues: Record<string, string> | null, parentTags?: readonly string[] | null): void {
		const normalizedParentTaskId = parentTaskId.trim();
  if (this.prepared) {
   if (normalizedParentTaskId) this.prepared.backgroundParent(normalizedParentTaskId, parentFieldValues, parentTags ?? null);
   this.refreshPreparedDraft(); return;
  }
		if (!normalizedParentTaskId) return;
		this.seededParentFieldValuesById.set(
			normalizedParentTaskId,
			parentFieldValues ? { ...parentFieldValues } : null,
		);
		this.seededParentTagsById.set(
			normalizedParentTaskId,
			parentTags ? normalizeTaskCreatorTags(parentTags) : null,
		);
		if ((this.draft.fieldValues['parentTask'] ?? '').trim() || isTaskCreatorFieldExplicitlyCleared(this.draft, 'parentTask')) {
			this.reclaimDescriptionFocusAfterBackgroundMutation();
			return;
		}
		applyTaskCreatorBackgroundParentSeedToDraft(
			this.draft,
			normalizedParentTaskId,
			parentFieldValues,
			parentTags,
			this.options.settings,
		);
		this.pruneDraftSubtasksForParent();
		this.renderFieldButtons();
		this.applyThemeColor();
		this.reclaimDescriptionFocusAfterBackgroundMutation();
	}

	private scheduleDescriptionFocusReclaims(delayMsList: number[]): void {
		for (const delayMs of delayMsList) {
			this.initialDescriptionFocusTimers.push(setWindowTimeout(() => {
				this.reclaimInitialDescriptionFocusIfNeeded();
			}, delayMs));
		}
	}

	private clearInitialDescriptionFocusGuard(): void {
		for (const handle of this.initialDescriptionFocusTimers) {
			clearWindowTimeout(handle);
		}
		this.initialDescriptionFocusTimers = [];
		this.initialDescriptionFocusInterrupted = false;
	}

	private reclaimInitialDescriptionFocusIfNeeded(): void {
		if (this.resolved || this.isSubmitting || this.isOutsideConfirmOpen) return;
		if (this.activePickerClose || this.suggestionState) return;
		if (!this.modalEl.isConnected || !this.descriptionHostEl?.isConnected) return;
		if (!shouldReclaimTaskCreatorDescriptionFocus(
			this.descriptionHostEl.ownerDocument.activeElement,
			this.descriptionHostEl,
			this.initialDescriptionFocusInterrupted,
		)) {
			return;
		}
		this.focusDescription(this.getDescriptionCaret());
	}

	private getFileTemplateOptions(): FileTaskTemplateOption[] {
		return this.options.fileTaskTemplateOptions ?? [];
	}

	private getSelectedFileTemplate(): FileTaskTemplateOption | null {
		const selectedId = this.draft.fileTemplateId.trim();
		if (!selectedId) return null;
		return this.getFileTemplateOptions().find(template => template.id === selectedId) ?? null;
	}

	private hasSelectedFileTemplate(): boolean {
		return !!this.getSelectedFileTemplate();
	}

 private getModeDefaultTemplateId(): string {
  return (this.activeCreateType === 'inline' ? this.options.defaultInlineTemplateId : this.options.defaultFileTemplateId)?.trim() ?? '';
 }

 private async selectPreparedTemplateId(id: string): Promise<void> {
  if (!this.prepared || this.preparedClosed) return;
  const selected = this.prepared.session.selectedOption();
  const state = this.prepared.session.snapshot();
  if (id && selected?.id === id && (state.status === 'ready' || state.status === 'loading')) return;
  const option = id ? this.getFileTemplateOptions().find(item => item.id === id) : null;
  if (id && !option) {
   this.draft.fileTemplateId = id;
   this.prepared.session.selectUnavailable(id);
   this.prepared.refreshParent();
   this.refreshPreparedDraft();
   return;
  }
  await this.selectPreparedTemplate(option ?? null);
 }

	private applyDefaultFileTemplateForActiveMode(): void {
		const nextTemplateId = resolveTaskCreatorFileTemplateIdForMode(
			this.activeCreateType,
			this.draft.fileTemplateId,
			this.options.defaultFileTemplateId,
		);
		if (!nextTemplateId || nextTemplateId === this.draft.fileTemplateId) return;
		if (!this.getFileTemplateOptions().some(template => template.id === nextTemplateId)) return;
		this.draft.fileTemplateId = nextTemplateId;
	}

	private setActiveCreateType(nextType: TaskCreatorCreateType): void {
		if (this.activeCreateType === nextType) return;
		this.activeCreateType = nextType;
  if (this.options.getInlineParentPreview) { this.refreshInlineParentPreview(); this.renderFieldButtons(); this.applyThemeColor(); }
		if (this.prepared) {
   this.closeActivePicker();
   void this.selectPreparedTemplateId(this.getModeDefaultTemplateId());
  }
		if (nextType === 'file' && !this.prepared) {
			this.applyDefaultFileTemplateForActiveMode();
		}
		if (nextType === 'inline') {
			this.closeActivePicker();
		}
		this.renderSubmitControls();
  if (this.prepared) this.renderFieldButtons();
		window.setTimeout(() => this.focusDescription(this.getDescriptionCaret()), 0);
	}

	private openFileTemplatePicker(): void {
		if (!this.prepared && !isTaskCreatorTemplateControlEnabled(this.submitMode, this.activeCreateType)) return;
		const templateOptions = this.getFileTemplateOptions();
		if (templateOptions.length === 0 && !this.prepared) return;
		this.closeSuggestions();
		this.closeActivePicker();
		this.templateButtonEl.addClass('is-picker-open');
		const close = showFileTaskTemplatePicker(this.templateButtonEl, {
			value: this.draft.fileTemplateId,
			options: templateOptions,
   onClear: this.prepared ? () => { this.userTemplateSelections.set(this.activeCreateType, ''); this.closeActivePicker(); void this.selectPreparedTemplate(null); } : undefined,
			onSelect: template => {
    this.userTemplateSelections.set(this.activeCreateType, template.id);
				this.suppressOutsidePointerBriefly();
				this.draft.fileTemplateId = template.id;
				if (this.prepared) void this.selectPreparedTemplate(template);
    else void this.options.onFileTemplateSelected?.(template);
				this.closeActivePicker();
				this.renderSubmitControls();
				window.setTimeout(() => this.focusDescription(this.getDescriptionCaret()), 0);
			},
			onClose: () => {
				this.closeActivePicker();
				window.setTimeout(() => this.focusDescription(this.getDescriptionCaret()), 0);
			},
		});
		this.activePickerClose = close;
	}

	private focusNote(): void {
		const value = this.noteCompactEditor?.getDraft().displayValue ?? this.draft.note;
		this.noteCompactEditor?.focus({ preventScroll: this.options.preventFocusScroll === true });
		this.noteCompactEditor?.setSelection?.({ anchor: value.length, head: value.length });
	}

	private autoSizeTextarea(textarea: HTMLTextAreaElement): void {
		textarea.setCssProps({ height: '0px' });
		const measuredHeight = Math.max(textarea.scrollHeight, 44);
		if (!Platform.isPhone) {
			textarea.style.height = `${measuredHeight}px`;
			return;
		}

		const style = getOwnerWindow(this.containerEl).getComputedStyle(textarea);
		const lineHeight = Number.parseFloat(style.lineHeight || '') || 24.8;
		const paddingTop = Number.parseFloat(style.paddingTop || '') || 0;
		const paddingBottom = Number.parseFloat(style.paddingBottom || '') || 0;
		const borderTop = Number.parseFloat(style.borderTopWidth || '') || 0;
		const borderBottom = Number.parseFloat(style.borderBottomWidth || '') || 0;
		const maxMobileHeight = Math.ceil(lineHeight * 4 + paddingTop + paddingBottom + borderTop + borderBottom);
		const nextHeight = Math.min(measuredHeight, Math.max(44, maxMobileHeight));
		textarea.style.height = `${nextHeight}px`;
	}

	private refreshRenderedTextEditors(): void {
		this.descriptionCompactEditor?.refreshLayout();
		this.noteCompactEditor?.refreshLayout();
	}

	private focusAdjacentTaskCreatorControl(
		origin: HTMLElement | null,
		direction: 'next' | 'previous',
	): void {
		if (!origin) return;
		const selector = [
			'button:not([disabled])',
			'input:not([disabled])',
			'textarea:not([disabled])',
			'[contenteditable="true"]',
			'[tabindex]:not([tabindex="-1"])',
		].join(',');
		const candidates = Array.from(this.modalEl.querySelectorAll<HTMLElement>(selector))
			.filter(candidate => {
				if (!candidate.isConnected || !isTaskCreatorControlVisible(candidate)) return false;
				const compactRoot = candidate.closest('.operon-compact-markdown-editor');
				return !compactRoot || candidate.classList.contains('cm-content');
			});
		const activeElement = this.modalEl.ownerDocument.activeElement;
		let index = candidates.findIndex(candidate => (
			candidate === activeElement || candidate.contains(activeElement)
		));
		if (index < 0) {
			index = candidates.findIndex(candidate => origin.contains(candidate));
		}
		if (index < 0) return;
		candidates[index + (direction === 'next' ? 1 : -1)]?.focus();
	}

	private registerMobileViewportListeners(): void {
		if (!Platform.isPhone) return;
		(this.viewportWindow ?? getOwnerWindow(this.containerEl)).visualViewport?.addEventListener('resize', this.visualViewportHandler);
		(this.viewportWindow ?? getOwnerWindow(this.containerEl)).visualViewport?.addEventListener('scroll', this.visualViewportHandler);
	}

	private unregisterMobileViewportListeners(): void {
		if (!Platform.isPhone) return;
		(this.viewportWindow ?? getOwnerWindow(this.containerEl)).visualViewport?.removeEventListener('resize', this.visualViewportHandler);
		(this.viewportWindow ?? getOwnerWindow(this.containerEl)).visualViewport?.removeEventListener('scroll', this.visualViewportHandler);
	}

	private registerMobilePickerListeners(): void {
		if (!Platform.isPhone) return;
		this.contentEl.addEventListener(MOBILE_PICKER_OPEN_EVENT, this.mobilePickerOpenHandler);
		this.contentEl.addEventListener(MOBILE_PICKER_CLOSE_EVENT, this.mobilePickerCloseHandler);
	}

	private unregisterMobilePickerListeners(): void {
		if (!Platform.isPhone) return;
		this.contentEl.removeEventListener(MOBILE_PICKER_OPEN_EVENT, this.mobilePickerOpenHandler);
		this.contentEl.removeEventListener(MOBILE_PICKER_CLOSE_EVENT, this.mobilePickerCloseHandler);
	}

	private updateMobileViewportHeight(): void {
		if (!Platform.isPhone) return;
		if (this.mobilePickerOpenDepth > 0) return;
		const owner = getOwnerWindow(this.containerEl);
		const height = owner.visualViewport?.height ?? owner.innerHeight;
		if (!Number.isFinite(height) || height <= 0) return;
		this.containerEl.style.setProperty('--operon-task-creator-mobile-viewport-height', `${Math.round(height)}px`);
	}

	private syncSuggestions(): void {
		if (this.activePickerClose) {
			debugTaskFieldSuggestion('task-creator', 'picker-active');
			this.closeSuggestions();
			return;
		}
		const caret = this.getDescriptionCaret();
		const beforeCaret = this.getDescriptionDisplayValue().slice(0, caret);
		const resolution = resolveTaskFieldSuggestions(
			beforeCaret,
			this.options.settings,
			this.draft.fieldValues,
			'creator',
		);
		const items: TaskCreatorSuggestion[] = [...resolution.items];
		if (resolution.trigger && 'template'.startsWith(resolution.token.toLowerCase())
			&& this.templateButtonEl && !this.templateButtonEl.disabled) {
			items.unshift({ action: 'template', visibleName: t('taskEditor', 'pickFileTaskTemplate') });
		}
		if (!resolution.trigger || items.length === 0) {
			if (resolution.suppressionReason) {
				debugTaskFieldSuggestion('task-creator', resolution.suppressionReason, {
					token: resolution.token,
				});
			}
			this.closeSuggestions();
			return;
		}

		this.suggestionState = {
			items,
			activeIndex: Math.min(this.suggestionState?.activeIndex ?? 0, items.length - 1),
			range: {
				start: resolution.trigger.start,
				end: resolution.trigger.end,
			},
		};
		this.renderSuggestions();
	}

	private renderSuggestions(): void {
		if (!this.suggestionsEl || !this.suggestionState) {
			this.closeSuggestions();
			return;
		}

		this.suggestionsEl.empty();
		this.suggestionsEl.show();
		for (const [index, item] of this.suggestionState.items.entries()) {
			const button = this.suggestionsEl.createEl('button', {
				cls: 'operon-task-creator-suggestion',
				text: item.visibleName,
				attr: { type: 'button' },
			});
			if (index === this.suggestionState.activeIndex) {
				button.addClass('is-active');
			}
			button.addEventListener('mouseenter', () => this.setActiveSuggestionIndex(index));
			button.addEventListener('pointerdown', event => {
				event.preventDefault();
				this.chooseSuggestion(item);
			});
			button.addEventListener('touchend', event => {
				event.preventDefault();
				this.chooseSuggestion(item);
			}, { passive: false });
			button.addEventListener('click', event => {
				event.preventDefault();
				this.chooseSuggestion(item);
			});
			button.addEventListener('mousedown', event => {
				event.preventDefault();
				this.chooseSuggestion(item);
			});
		}
	}

	private setActiveSuggestionIndex(nextIndex: number): void {
		const state = this.suggestionState;
		if (!state || state.activeIndex === nextIndex) return;
		const previousButton = this.suggestionsEl?.children[state.activeIndex] as HTMLElement | undefined;
		state.activeIndex = nextIndex;
		previousButton?.classList.remove('is-active');
		(this.suggestionsEl?.children[state.activeIndex] as HTMLElement | undefined)?.classList.add('is-active');
	}

	private closeSuggestions(): void {
		this.suggestionState = null;
		this.suggestionsEl?.empty();
		this.suggestionsEl?.hide();
	}

	private moveSuggestion(delta: number): void {
		if (!this.suggestionState) return;
		const next = this.suggestionState.activeIndex + delta;
		const length = this.suggestionState.items.length;
		this.suggestionState.activeIndex = ((next % length) + length) % length;
		this.renderSuggestions();
	}

	private chooseSuggestion(item: TaskCreatorSuggestion | null): void {
		if (!item || !this.suggestionState) return;
		const nextCaret = this.suggestionState.range.start;
		this.descriptionCompactEditor?.replaceRange?.(
			this.suggestionState.range.start,
			this.suggestionState.range.end,
			'',
		);
		this.closeSuggestions();
		this.focusDescription(nextCaret);
		if ('action' in item) this.openFileTemplatePicker();
		else this.openFieldPicker(item.canonicalKey);
	}

	private openFieldPicker(
		canonicalKey: string,
		reminderOperation?: ReminderPickerOperation,
		anchorOverride?: HTMLElement,
	): void {
		if (this.prepared && this.isSubmitting) return;
		this.closeSuggestions();
  const preparedField = this.prepared?.field(canonicalKey);
  if (preparedField?.readOnlyReason) return;
  if (preparedField?.property.interpretation === 'native') { this.openPreparedPropertyPicker(canonicalKey); return; }
		if (canonicalKey === 'note') {
			this.openNote();
			return;
		}
		if (canonicalKey === 'subtasks') {
			this.openSubtasksPicker();
			return;
		}
		if (canonicalKey === 'blocking' || canonicalKey === 'blockedBy') {
			this.openDependencyPicker(canonicalKey);
			return;
		}
		if (canonicalKey === 'pinned') {
			this.togglePinned();
			return;
		}
		if (canonicalKey === 'taskColor') {
			this.openColorPicker();
			return;
		}

		const anchorButton = this.fieldButtonMap.get(canonicalKey);
		const anchor = anchorOverride ?? anchorButton ?? this.descriptionHostEl;
		const resolvedReminderOperation = reminderOperation ?? (
			canonicalKey === 'reminderDatetimes' || canonicalKey === 'reminderRules'
				? { kind: 'add' as const }
				: undefined
		);
		let focusRestoreScheduled = false;
		const restorePickerFocus = () => {
			if (focusRestoreScheduled) return;
			focusRestoreScheduled = true;
			window.setTimeout(() => {
				let target = anchorOverride?.isConnected ? anchorOverride : null;
				if (!target && reminderOperation?.kind === 'edit') {
					target = this.reminderStripEl.querySelector<HTMLElement>(
						`[data-field-key="${canonicalKey}"][data-reminder-index="${reminderOperation.item.index}"]`,
					);
				}
				if (target) {
					target.focus();
					return;
				}
				this.focusDescription(this.getDescriptionCaret());
			}, 0);
		};
		this.closeActivePicker();

		let pickerBaseline = preparedField;
		let pendingRepeatCompletionMode: InlineRepeatCompletionMode | undefined;
		const close = openTaskFieldPicker({
			app: this.app,
			settings: this.options.settings,
			allTasks: this.options.allTasks,
			canonicalKey,
			anchor,
			currentFieldValues: { ...this.draft.fieldValues },
			getCurrentFieldValues: () => this.draft.fieldValues,
			currentTags: [...this.draft.tags],
   ...(preparedField && (preparedField.property.merge === 'set' || preparedField.property.merge === 'sequence') ? {
    currentListValues: preparedField.members.map(member => String(member.value)),
    onCommitListValues: (key: string, values: string[]) => {
     if (this.isSubmitting || !this.prepared) return;
     this.prepared.applyPayload({ [key]: values }, pickerBaseline);
     const current = this.prepared.field(key);
     pickerBaseline = { ...current, members: current.members.filter(member => values.includes(String(member.value))) };
     this.refreshPreparedDraft();
    },
   } : {}),
			reminderOperation: resolvedReminderOperation,
			closeListPickerOnSelect: canonicalKey === 'assignees' || canonicalKey === 'tags' || canonicalKey === 'contexts' || canonicalKey === 'taskGallery',
			manualDatePicker: this.getManualDatePickerOptions(canonicalKey),
			taskFormat: this.activeCreateType === 'file' ? 'yaml' : 'inline',
			repeatInlineCompletionMode: this.draft.inlineCompletionMode,
			onCommit: payload => {
				this.applyPayloadToDraft(payload);
				if (pendingRepeatCompletionMode !== undefined) this.draft.inlineCompletionMode = pendingRepeatCompletionMode;
				if (canonicalKey === 'assignees' || canonicalKey === 'tags' || canonicalKey === 'contexts' || canonicalKey === 'links' || canonicalKey === 'taskGallery') {
					return;
				}
				this.closeActivePicker();
				restorePickerFocus();
			},
			onRepeatInlineCompletionModeChange: mode => {
				pendingRepeatCompletionMode = normalizeInlineCompletionMode(mode);
			},
			onOpenNote: () => {
				this.openNote();
				window.setTimeout(() => this.focusNote(), 0);
			},
			onCancel: () => {
				this.closeActivePicker();
				restorePickerFocus();
			},
			onClose: () => {
				this.closeActivePicker();
				restorePickerFocus();
			},
		});

		if (close) {
			this.activePickerClose = close;
			anchorButton?.addClass('is-picker-open');
		}
	}

	private closeActivePicker(): void {
		const current = this.activePickerClose;
		this.activePickerClose = null;
		for (const button of this.fieldButtonMap.values()) {
			button.removeClass('is-picker-open');
		}
		this.templateButtonEl?.removeClass('is-picker-open');
		if (current) current();
	}

	private getManualDatePickerOptions(key: string): ManualDatePickerOptions | undefined {
		if (!TASK_CREATOR_DAY_PICKER_DATE_KEYS.has(key)) return undefined;
		return {
			weekStart: this.options.settings.calendarWeekStart,
			showWeekNumbers: this.options.settings.calendarSidebarShowWeekNumbers,
		};
	}

	private openSubtasksPicker(): void {
		const anchorButton = this.fieldButtonMap.get('subtasks');
		const anchor = anchorButton ?? this.descriptionHostEl;
		this.closeSuggestions();
		this.closeActivePicker();
		const close = showSubtasksPicker(anchor, {
			value: this.draft.subtaskIds,
			allTasks: this.options.allTasks,
			excludedIds: Array.from(this.getDraftSubtaskExcludedIds()),
			closeOnSelect: true,
			onChange: operonIds => {
				this.draft.subtaskIds = [...operonIds];
    this.prepared?.draft.setValue('subtasks', operonIds);
				this.renderFieldButtons();
			},
			onClose: () => {
				this.closeActivePicker();
				window.setTimeout(() => this.focusDescription(this.getDescriptionCaret()), 0);
			},
		});
		this.activePickerClose = close;
		anchorButton?.addClass('is-picker-open');
	}

	private getDraftSubtaskExcludedIds(): Set<string> {
		return new Set(buildSubtaskExcludedIds({
			allTasks: this.options.allTasks,
			parentTaskId: this.draft.fieldValues['parentTask'],
		}));
	}

	private pruneDraftSubtasksForParent(): void {
		if (this.draft.subtaskIds.length === 0) return;
		const excludedIds = this.getDraftSubtaskExcludedIds();
		if (excludedIds.size === 0) return;
		this.draft.subtaskIds = this.draft.subtaskIds.filter(operonId => !excludedIds.has(operonId.trim()));
	}

	private openDependencyPicker(fieldKey: 'blocking' | 'blockedBy'): void {
		const anchorButton = this.fieldButtonMap.get(fieldKey);
		const anchor = anchorButton ?? this.descriptionHostEl;
		this.closeSuggestions();
		this.closeActivePicker();
		const oppositeFieldKey = fieldKey === 'blocking' ? 'blockedBy' : 'blocking';
		const close = showDependencyTaskPicker(anchor, {
			fieldKey,
			value: this.draft.fieldValues[fieldKey] ?? '',
			oppositeValue: this.draft.fieldValues[oppositeFieldKey] ?? '',
			allTasks: this.getAllTasks(),
			getAllTasks: () => this.getAllTasks(),
			subscribeIndexUpdates: this.options.subscribeIndexUpdates,
			pipelines: this.options.settings.pipelines,
			keyMappings: this.options.settings.keyMappings,
			closeOnSelect: true,
			onSave: payload => {
				this.applyPayloadToDraft(payload);
			},
			onClose: () => {
				this.closeActivePicker();
				window.setTimeout(() => this.focusDescription(this.getDescriptionCaret()), 0);
			},
		});
		this.activePickerClose = close;
		anchorButton?.addClass('is-picker-open');
	}

	private handleFieldButtonClick(key: TaskCreatorFieldKey): void {
		if (key === 'note') {
			this.toggleNote();
			return;
		}
		if (key === 'pinned') {
			this.togglePinned();
			return;
		}
		this.openFieldPicker(key);
	}

	private togglePinned(): void {
		const isPinned = (this.draft.fieldValues['pinned'] ?? '').trim() === 'true';
		this.applyPayloadToDraft({ pinned: isPinned ? '' : 'true' });
	}

	private toggleNote(): void {
		this.draft.noteOpen = !this.draft.noteOpen;
		this.renderNoteVisibility();
		this.renderFieldButtons();
		if (this.draft.noteOpen) {
			this.focusNote();
			return;
		}
		window.setTimeout(() => this.focusDescription(this.getDescriptionCaret()), 0);
	}

	private openNote(): void {
		this.draft.noteOpen = true;
		this.renderNoteVisibility();
		this.renderFieldButtons();
		window.setTimeout(() => this.focusNote(), 0);
	}

	private renderNoteVisibility(): void {
		if (!this.noteWrapEl) return;
		if (this.draft.noteOpen) {
			this.noteWrapEl.show();
			this.noteCompactEditor?.setSourceValue(this.draft.note);
			return;
		}
		this.noteWrapEl.hide();
	}

	private normalizeTerminalDatePayload(payload: Record<string, string | string[]>): Record<string, string | string[]> | null {
		const hasCompleted = 'dateCompleted' in payload;
		const hasCancelled = 'dateCancelled' in payload;
		if (!hasCompleted && !hasCancelled) return payload;

		const getPayloadString = (key: string): string => {
			const value = payload[key];
			return Array.isArray(value) ? value.join('; ').trim() : (value ?? '').trim();
		};
		const completedValue = getPayloadString('dateCompleted');
		const cancelledValue = getPayloadString('dateCancelled');
		if (completedValue && cancelledValue) {
			new Notice(t('taskEditor', 'terminalDateConflict'));
			return null;
		}

		const terminalDateKey: 'dateCompleted' | 'dateCancelled' = completedValue
			? 'dateCompleted'
			: cancelledValue
				? 'dateCancelled'
				: hasCompleted
					? 'dateCompleted'
					: 'dateCancelled';
		const terminalDateValue = terminalDateKey === 'dateCompleted' ? completedValue : cancelledValue;
		const statusValue = getPayloadString('status') || this.draft.fieldValues['status'];
		const resolution = resolveReverseWorkflowFromTerminalDate(
			this.options.settings.pipelines,
			statusValue,
			this.options.settings.defaultPipelineName,
			terminalDateKey,
			terminalDateValue,
		);
		if (!resolution.isValid || !resolution.workflow) {
			new Notice(resolution.errorMessage ?? t('notifications', 'terminalDateWorkflowResolveFailed'));
			return null;
		}

		return {
			...payload,
			status: resolution.workflow.value,
			dateCompleted: terminalDateKey === 'dateCompleted' && terminalDateValue ? terminalDateValue : '',
			dateCancelled: terminalDateKey === 'dateCancelled' && terminalDateValue ? terminalDateValue : '',
		};
	}

	private applyPayloadToDraft(
		payload: Record<string, string | string[]>,
		source: 'user' | 'inheritance' = 'user',
	): void {
		if (this.prepared && this.isSubmitting) return;
		const normalizedPayload = this.normalizeTerminalDatePayload(payload);
		if (!normalizedPayload) return;
  if (this.prepared) {
   const patched = applyTaskFieldPatchToState({ currentFields: this.draft.fieldValues, currentTags: this.draft.tags, payload: normalizedPayload, getAllRepeatSeriesIds: this.options.getAllRepeatSeriesIds, deferRepeatIdentity: true });
   const finalPayload: Record<string,string | string[]> = { ...normalizedPayload };
   for (const key of new Set([...Object.keys(this.draft.fieldValues), ...Object.keys(patched.fieldValues)])) {
    if (this.draft.fieldValues[key] !== patched.fieldValues[key]) finalPayload[key] = patched.fieldValues[key] ?? '';
   }
   this.prepared.applyPayload(finalPayload);
   this.refreshPreparedDraft();
   if ('parentTask' in normalizedPayload) { this.pruneDraftSubtasksForParent(); this.prepared.draft.setValue('subtasks', this.draft.subtaskIds); }
   return;
  }
		this.removeInlineParentPreview(this.draft);
		const next = applyTaskFieldPatchToState({
			currentFields: this.draft.fieldValues,
			currentTags: this.draft.tags,
			payload: normalizedPayload,
			getAllRepeatSeriesIds: this.options.getAllRepeatSeriesIds,
		});
		this.draft.fieldValues = next.fieldValues;
		this.draft.tags = next.tags;
		if (source === 'user') {
			this.recordExplicitFieldSelection(normalizedPayload);
		}
		this.reconcileParentInheritance();
  this.refreshInlineParentPreview();
		if (Object.prototype.hasOwnProperty.call(normalizedPayload, 'parentTask')) {
			this.pruneDraftSubtasksForParent();
		}
		this.draft.taskIcon = this.draft.fieldValues['taskIcon'] ?? '';
		this.draft.taskColor = this.draft.fieldValues['taskColor'] ?? '';
		this.renderFieldButtons();
		this.applyThemeColor();
	}

	private recordExplicitFieldSelection(payload: Record<string, string | string[]>): void {
		const explicit = new Set(this.draft.explicitFieldKeys);
		const inherited = new Set(this.draft.inheritedFieldKeys);
		for (const key of Object.keys(payload)) {
			explicit.add(key);
			inherited.delete(key);
			if (key === 'tags') {
				this.draft.inheritedTags = [];
			}
		}
		this.draft.explicitFieldKeys = Array.from(explicit);
		this.draft.inheritedFieldKeys = Array.from(inherited);
	}

 /** Preview implicit inheritance without turning it into an explicit routing choice. */
 private removeInlineParentPreview(draft: TaskCreatorDraft): void {
  const base = this.inlineParentPreviewBase;
  if (!base) return;
  const explicit = new Set(draft.explicitFieldKeys);
  for (const key of ['parentTask', ...draft.inheritedFieldKeys]) {
   if (explicit.has(key)) continue;
   if (Object.prototype.hasOwnProperty.call(base.fieldValues, key)) draft.fieldValues[key] = base.fieldValues[key];
   else delete draft.fieldValues[key];
  }
  draft.inheritedFieldKeys = base.inheritedFieldKeys.filter(key => !explicit.has(key));
  if (!explicit.has('tags')) { draft.tags = [...base.tags]; draft.inheritedTags = [...base.inheritedTags]; }
  draft.taskIcon = draft.fieldValues.taskIcon ?? base.taskIcon;
  draft.taskColor = draft.fieldValues.taskColor ?? base.taskColor;
  if (draft === this.draft) this.inlineParentPreviewBase = null;
 }
 private refreshInlineParentPreview(): void {
  if (this.prepared) {
   const context = cloneTaskCreatorDraft(this.draft);
   this.prepared.syncLegacy(context, this.prepared.routingSnapshot());
   const id = this.activeCreateType === 'inline'
    ? this.options.getInlineParentPreview?.(context) ?? null : null;
   this.prepared.setPreviewParent(id);
   this.prepared.syncLegacy(this.draft);
   return;
  }
  this.removeInlineParentPreview(this.draft);
  if (this.activeCreateType !== 'inline' || !this.options.getInlineParentPreview
   || this.draft.fieldValues.parentTask?.trim() || this.draft.explicitFieldKeys.includes('parentTask')) return;
  const id = this.options.getInlineParentPreview(this.draft);
  const parent = id && (this.options.getAllTasks?.() ?? this.options.allTasks).find(task => task.operonId === id);
  if (!parent) return;
  this.inlineParentPreviewBase = cloneTaskCreatorDraft(this.draft);
  applyTaskCreatorBackgroundParentSeedToDraft(this.draft, parent.operonId, parent.fieldValues, parent.tags, this.options.settings);
 }

	private reconcileParentInheritance(): void {
		const parentTaskId = (this.draft.fieldValues['parentTask'] ?? '').trim();
		const parentFieldValues = resolveTaskCreatorParentFieldValues(
			parentTaskId,
			this.options.allTasks,
			this.seededParentFieldValuesById,
		);
		const parentTags = resolveTaskCreatorParentTags(
			parentTaskId,
			this.options.allTasks,
			this.seededParentTagsById,
		);
		reconcileTaskCreatorParentInheritanceForDraft(this.draft, parentFieldValues, parentTags, this.options.settings);
	}

	private getThemeColor(): string {
		const color = (this.draft.fieldValues['taskColor'] ?? this.draft.taskColor ?? '').trim().replace(/^#/, '');
		return /^([0-9a-fA-F]{6})$/.test(color)
			? `#${color}`
			: 'var(--interactive-accent)';
	}

	private applyThemeColor(): void {
		const color = this.getThemeColor();
		this.modalEl.style.setProperty('--operon-task-creator-accent', color);
		this.containerEl.style.setProperty('--operon-task-creator-accent', color);
	}

	private openColorPicker(): void {
		const anchorButton = this.fieldButtonMap.get('taskColor');
		const anchor = anchorButton ?? this.descriptionHostEl;
		this.closeSuggestions();
		this.closeActivePicker();
		const close = showColorPicker(anchor, {
			value: this.draft.fieldValues['taskColor'] ?? this.draft.taskColor,
			palette: this.options.settings.colorPalette,
			onSelect: value => {
				this.applyPayloadToDraft({ taskColor: value });
				this.closeActivePicker();
				window.setTimeout(() => this.focusDescription(this.getDescriptionCaret()), 0);
			},
			onClear: () => {
				this.applyPayloadToDraft({ taskColor: '' });
				this.closeActivePicker();
				window.setTimeout(() => this.focusDescription(this.getDescriptionCaret()), 0);
			},
			onClose: () => {
				this.closeActivePicker();
				window.setTimeout(() => this.focusDescription(this.getDescriptionCaret()), 0);
			},
		});
		this.activePickerClose = close;
		anchorButton?.addClass('is-picker-open');
	}

	private renderFieldButtons(): void {
  if (this.prepared) {
   const keys = this.getVisibleToolbarFieldOrder();
   for (const [key, button] of this.fieldButtonMap) if (!keys.includes(key)) {
    // Keep the floating picker's anchor connected until its own lifecycle closes it.
    if (button.hasClass('is-picker-open')) continue;
    cleanupOperonHoverTooltips(button); button.remove(); this.fieldButtonMap.delete(key);
   }
   for (const key of keys) {
    if (!this.fieldButtonMap.has(key)) {
     const button = this.toolsEl.createEl('button', { cls: 'operon-task-creator-tool', attr: { type: 'button', 'data-field-key': key } });
     button.addEventListener('click', () => this.handleFieldButtonClick(key)); this.fieldButtonMap.set(key, button);
   if (this.prepared) this.bindPreparedRemoval(button, key);
    }
   }
   // insertBefore only when order actually changes: focused controls retain their DOM identity.
   keys.forEach((key,index) => { const button = this.fieldButtonMap.get(key)!; if (this.toolsEl.children[index] !== button) this.toolsEl.insertBefore(button, this.toolsEl.children[index] ?? null); });
  }
		this.renderReminderDraftStrip();
		for (const key of this.getVisibleToolbarFieldOrder()) {
			const button = this.fieldButtonMap.get(key);
			if (!button) continue;
			button.empty();
			this.syncFieldButtonActiveState(key);
   const warning = this.prepared?.field(key).readOnlyReason;
   button.toggleClass('is-property-warning', warning === 'automatic');
   button.setAttribute('aria-readonly', String(!!warning));
			const ruleAddDisabled = key === 'reminderRules'
				&& !getCustomFieldMapping(this.options.settings.keyMappings, key)
				&& getAvailableReminderRuleAnchors(this.draft.fieldValues).length === 0;
			button.disabled = ruleAddDisabled;
			button.setAttribute('aria-disabled', String(ruleAddDisabled));

			const iconWrap = button.createSpan('operon-task-creator-tool-icon');
			if (key === 'taskIcon' && this.draft.taskIcon.trim()) {
				const icon = getIcon(this.draft.taskIcon.trim());
				if (icon) {
					iconWrap.appendChild(icon);
				} else {
					setIcon(iconWrap, this.resolveFieldIcon(key));
				}
			} else {
				setIcon(iconWrap, this.resolveFieldIcon(key));
			}
			if (key === 'blockedBy') this.applyBlockedByAggregateState(button);
			if (warning) bindPropertyReadOnlyWarning(button, this.getFieldLabel(key), warning, () => this.getThemeColor());
   else this.bindFieldButtonTooltip(button, key);
		}
	}

 private clearPreparedField(key: string, clear: boolean): void {
  if (!this.prepared) return;
  // Preserve companion-field rules before recording the explicit removal tombstone.
  if (this.prepared.field(key).property.interpretation !== 'native') this.applyPayloadToDraft({ [key]: '' });
  this.prepared.remove(key, clear);
  this.refreshPreparedDraft();
 }

 private bindPreparedRemoval(button: HTMLButtonElement, key: string): void {
  const open = (event: MouseEvent | KeyboardEvent): void => {
   const prepared = this.prepared;
   if (!prepared || prepared.field(key).readOnlyReason || this.isSubmitting) return;
   event.preventDefault();
   const menu = new Menu();
   menu.addItem(item => item.setTitle(t('buttons', 'clear')).onClick(() => { this.clearPreparedField(key, true); }));
   menu.addItem(item => item.setTitle(t('table', 'filePropertyRemove')).onClick(() => { this.clearPreparedField(key, false); }));
   if (event.type === 'contextmenu') menu.showAtMouseEvent(event as MouseEvent);
   else menu.showAtPosition({ x: button.getBoundingClientRect().left, y: button.getBoundingClientRect().bottom });
  };
  button.addEventListener('contextmenu', open);
  button.addEventListener('keydown', event => { if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') open(event); });
 }

 refreshPreparedSources(): void {
  if (!this.preparedClosed) { this.prepared?.refreshParent(); this.refreshPreparedDraft(); }
 }
 private refreshPreparedDraft(refreshPreview = true): void {
  if (!this.prepared || this.preparedClosed) return;
  if (refreshPreview) this.refreshInlineParentPreview();
  this.prepared.updateInputs(this.draft.description);
  this.prepared.syncLegacy(this.draft);
  if (!this.toolsEl || this.detachedForSubmit) return;
  this.renderFieldButtons(); this.renderSubmitControls(); this.applyThemeColor();
  this.noteCompactEditor?.setSourceValue(this.draft.note);
 }

 private async selectPreparedTemplate(template: FileTaskTemplateOption | null): Promise<void> {
  if (!this.prepared || this.preparedClosed) return;
  this.draft.fileTemplateId = template?.id ?? '';
  const pending = this.prepared.select(template, this.draft.description);
  this.refreshPreparedDraft();
  await pending;
  this.refreshPreparedDraft();
 }

 private openPreparedPropertyPicker(key: string): void {
  const prepared = this.prepared;
  if (!prepared) return;
  const field = prepared.field(key);
  if (field.readOnlyReason || !field.property.type) return;
  const anchor = this.fieldButtonMap.get(key);
  if (!anchor) return;
  this.closeActivePicker();
  let members = field.members;
  this.activePickerClose = openTableFilePropertyPicker({
   app: this.app, anchor, label: this.getFieldLabel(key), settings: this.options.settings, sourcePath: '', lifecycleOwner: this.contentEl,
   field: { key, label: key, type: field.property.type, group: 'fileProperty', icon: this.resolveFieldIcon(key), readonly: false, aliases: [], propertyName: key, sourceType: field.property.type === 'list' ? 'multitext' : field.property.type, sourceFileCount: 0 },
   cellValue: { present: field.state !== 'missing' && field.state !== 'removed', rawValue: field.value ?? null, normalizedValue: field.value == null ? '' : encodeVaultPropertyValue(field.value, field.property.type) },
   candidates: prepared.adapter.candidates(field.property.sourceName), nativeList: true,
   onNativeOperation: operation => {
    if (this.preparedClosed || this.isSubmitting) throw new Error('Creator is not editable');
    if (operation.kind === 'append') for (const value of operation.values) prepared.draft.appendMember(key, value);
    else if (operation.kind === 'clear') prepared.draft.clearValue(key);
    else {
     const member = members[operation.index];
     if (!member) throw new Error('Creator member no longer exists');
     if (operation.kind === 'edit') prepared.draft.editMember(key, member.id, operation.value);
     else prepared.draft.removeMember(key, member.id);
    }
    this.refreshPreparedDraft(); members = prepared.field(key).members;
    return members.map(member => member.value);
   },
   onMutation: mutation => {
    if (this.preparedClosed || this.isSubmitting) return;
    if (mutation.kind === 'delete') prepared.draft.removeField(key);
    else if (mutation.kind === 'set') prepared.draft.setValue(key, mutation.value as VaultPropertyValue);
    this.refreshPreparedDraft();
   },
   onClose: () => { this.closeActivePicker(); if (!this.preparedClosed) this.renderFieldButtons(); },
  });
  anchor.addClass('is-picker-open');
 }

 /** Apply destination inheritance through the shared draft before the first write. */
 acceptPreparedTargetParent(id: string, fields: Record<string,string> | null, tags: readonly string[] | null) {
  if (!this.prepared || this.preparedClosed) throw new Error('Creator is closed');
  this.prepared.backgroundParent(id, fields, tags);
  this.refreshPreparedDraft(false);
  return this.prepared.submission('inline', this.draft.description, this.draft.inlineCompletionMode);
 }
 get isCreatorSessionOpen(): boolean { return !this.preparedClosed; }
 get hasDetachedSubmission(): boolean { return this.detachedForSubmit; }
 get canRestoreSubmittedDraft(): boolean { return this.detachedForSubmit && !this.submissionClosePending && !this.isSubmitting && !this.preparedClosed; }
 restoreSubmittedDraft(): void {
  if (!this.canRestoreSubmittedDraft) return;
  this.detachedForSubmit = false;
  this.containerEl.removeClass('operon-task-creator-force-hidden');
  this.modalEl.removeClass('operon-task-creator-force-hidden');
  this.open();
 }
 private async submitPrepared(mode: TaskCreatorCreateType): Promise<void> {
  const prepared = this.prepared;
  if (!prepared || this.isSubmitting || this.preparedClosed || this.preparedUncertain || !prepared.canSubmit(mode) || !isTaskCreatorCreateTypeAllowed(this.submitMode, mode) || !this.ensureDescription()) return;
  this.closeActivePicker(); this.closeSuggestions();
  const request = prepared.submission(mode, this.draft.description, this.draft.inlineCompletionMode);
  this.isSubmitting = true; this.contentEl.inert = true; this.renderSubmitControls();
  this.detachedForSubmit = true; this.submissionClosePending = true;
  try {
   this.options.onSubmissionStateChange?.();
   this.hideImmediately(); this.forceClose();
   // Let the closed surface paint before starting source/index work.
   await new Promise<void>(resolve => getOwnerWindow(this.containerEl).setTimeout(resolve, 0));
   if (this.preparedClosed) return;
   const result = await prepared.adapter.onSubmit(request);
   if (this.preparedClosed) return;
   if (result === true || typeof result === 'object' && result.outcome === 'committed') {
    this.resolved = true; this.preparedClosed = true; prepared.close(); this.detachedForSubmit = false;
   } else if (typeof result === 'object') {
    if (result.message) new Notice(result.message);
    this.preparedUncertain = result.outcome === 'uncertain';
   }
  } catch (error) { console.error('Operon: prepared Creator submit failed', error); }
  finally {
   if (this.preparedClosed) { this.draftPropertiesCleanup?.(); this.draftPropertiesCleanup = undefined; }
   this.isSubmitting = false; this.contentEl.inert = false;
   if (this.options.onSubmissionStateChange) this.options.onSubmissionStateChange();
   else this.restoreSubmittedDraft();
  }
 }

	private getAllTasks(): IndexedTask[] {
		return this.options.getAllTasks?.() ?? this.options.allTasks;
	}

	private refreshBlockedByDependencyControl(): void {
		const button = this.fieldButtonMap.get('blockedBy');
		if (!button?.isConnected) return;
		this.applyBlockedByAggregateState(button);
	}

	private applyBlockedByAggregateState(button: HTMLButtonElement): void {
		const ids = splitTaskListValue(this.draft.fieldValues['blockedBy']);
		const tasksById = new Map(this.getAllTasks().map(task => [task.operonId, task]));
		const state = resolveBlockedByAggregateVisualState(
			ids,
			id => tasksById.get(id),
			this.options.settings.pipelines,
		);
		const color = resolveBlockedByVisualStateColor(state);
		button.classList.toggle('has-blocked-by-state', !!state);
		if (state) button.dataset.blockedByState = state;
		else delete button.dataset.blockedByState;
		if (color) button.style.setProperty('--operon-blocked-by-state-color', color);
		else button.style.removeProperty('--operon-blocked-by-state-color');
	}

	private renderReminderDraftStrip(): void {
		if (!this.reminderStripEl) return;
		this.reminderStripEl.empty();
		const fieldValues = this.draft.fieldValues;
		for (const fieldKey of ['reminderDatetimes', 'reminderRules'] as const) {
			if (getCustomFieldMapping(this.options.settings.keyMappings, fieldKey)) continue;
			for (const [index, rawValue] of splitTaskListValue(fieldValues[fieldKey]).entries()) {
				const display = formatReminderDisplayItem({
					app: this.app,
					settings: this.options.settings,
					fieldKey,
					rawValue,
					fieldValues,
				});
				const chip = this.reminderStripEl.createEl('button', {
					cls: `operon-task-creator-reminder-chip is-${display.state}`,
					attr: {
						type: 'button',
						'data-field-key': fieldKey,
						'data-reminder-index': String(index),
						'aria-label': display.ariaLabel,
					},
				});
				const icon = chip.createSpan('operon-task-creator-reminder-chip-icon');
				setIcon(icon, getConfiguredKeyMappingIcon(fieldKey, this.options.settings.keyMappings) || 'bell-ring');
				chip.createSpan({ cls: 'operon-task-creator-reminder-chip-text', text: display.text });
				bindOperonHoverTooltip(chip, {
					title: display.tooltipTitle,
					content: display.tooltipContent,
					taskColor: () => this.getThemeColor(),
				});
				chip.addEventListener('click', () => {
					this.openFieldPicker(fieldKey, {
						kind: 'edit',
						item: { index, rawValue },
					}, chip);
				});
			}
		}
		this.reminderStripEl.toggleClass('is-empty', this.reminderStripEl.childElementCount === 0);
	}

	private renderSubmitControls(): void {
		const selectedTemplate = this.prepared || this.activeCreateType === 'file' ? this.getSelectedFileTemplate() : null;
		const templateLabel = selectedTemplate?.name || (this.prepared && this.draft.fileTemplateId ? `${t('settings', 'defaultFileTaskTemplateUnavailable')} (${this.draft.fileTemplateId})` : '') || (Platform.isPhone ? t('taskEditor', 'pickFileTaskTemplateShort') : t('taskEditor', 'pickFileTaskTemplate'));
		const templateAccessibleLabel = selectedTemplate?.name || t('taskEditor', 'pickFileTaskTemplate');
		const templateControlEnabled = !!this.prepared || isTaskCreatorTemplateControlEnabled(this.submitMode, this.activeCreateType);
		this.templateButtonEl.toggleClass('is-active', !!selectedTemplate);
		this.templateButtonEl.toggleClass('is-picker-open', !!this.activePickerClose && this.templateButtonEl.hasClass('is-picker-open'));
		this.templateButtonEl.disabled = this.isSubmitting || !templateControlEnabled || (!this.prepared && this.getFileTemplateOptions().length === 0);
		this.templateButtonEl.empty();
		this.templateButtonEl.removeClass('is-overflowing-label');
		const labelEl = this.templateButtonEl.createSpan({
			cls: 'operon-task-creator-template-label',
			text: templateLabel,
		});
		this.templateButtonEl.removeAttribute('title');
		this.templateButtonEl.removeAttribute('aria-label');
		if (Platform.isPhone) {
			setAccessibleLabelWithoutTooltip(this.templateButtonEl, templateAccessibleLabel);
		}
		if (selectedTemplate) {
			window.requestAnimationFrame(() => {
				if (!labelEl.isConnected) return;
				this.templateButtonEl.toggleClass('is-overflowing-label', labelEl.scrollWidth > labelEl.clientWidth + 1);
			});
		}

  const templateState = this.prepared?.session.snapshot();
  const blocked = this.preparedUncertain || !!this.prepared && !this.prepared.canSubmit(this.activeCreateType);
  if (this.templateErrorEl) {
   this.templateErrorEl.setText(templateState?.status === 'error' ? t('taskEditor', 'creatorTemplatePreparationFailed') : '');
   this.templateErrorEl.toggleClass('is-hidden', templateState?.status !== 'error');
  }
  if (this.prepared) {
   cleanupOperonHoverTooltips(this.templateButtonEl);
   if (this.activeCreateType === 'inline') bindOperonHoverTooltip(this.templateButtonEl, { content: t('taskEditor', 'creatorInlineTemplateProperties'), taskColor: () => this.getThemeColor() });
  }
		const inlineActive = this.activeCreateType === 'inline';
		this.inlineButtonEl.toggleClass('is-primary', inlineActive);
		this.inlineButtonEl.toggleClass('is-secondary', !inlineActive);
		this.inlineButtonEl.disabled = this.isSubmitting || (inlineActive && blocked) || this.submitMode === 'file-only';

		const fileActive = this.activeCreateType === 'file';
		this.fileButtonEl.toggleClass('is-primary', fileActive);
		this.fileButtonEl.toggleClass('is-secondary', !fileActive);
		this.fileButtonEl.disabled = this.isSubmitting || (fileActive && blocked)
			|| this.submitMode === 'inline-only'
			|| (fileActive && !this.hasSelectedFileTemplate());
	}

	private hasValueForField(key: TaskCreatorFieldKey): boolean {
  if (this.prepared) return this.prepared.fields(this.activeCreateType).some(field => this.prepared!.key(field) === key && field.state === 'value' && !field.readOnlyReason);
		if (key === 'tags') return this.draft.tags.length > 0;
		if (key === 'subtasks') return this.draft.subtaskIds.length > 0;
		if (key === 'blocking' || key === 'blockedBy') return splitTaskListValue(this.draft.fieldValues[key]).length > 0;
		if (key === 'note') return this.draft.noteOpen || !!this.draft.note.trim();
		return !!(this.draft.fieldValues[key] ?? '').trim();
	}

	private syncFieldButtonActiveState(key: TaskCreatorFieldKey): void {
		const button = this.fieldButtonMap.get(key);
		if (!button) return;
		button.removeClass('is-active');
		if (this.hasValueForField(key)) {
			button.addClass('is-active');
		}
	}

	private resolveFieldIcon(key: TaskCreatorFieldKey): string {
  const field = this.prepared?.field(key);
  if (field?.readOnlyReason === 'automatic') return 'shield-alert';
  if (field?.property.interpretation === 'native' && field.property.type === 'checkbox') return getCheckboxPropertyIcon(field.value, getCheckboxPropertyTypeIcon(this.options.settings.keyMappings, field.property.sourceName));
  if (field?.property.interpretation === 'native') return getNativePropertyIcon(this.options.settings.keyMappings, field.property.sourceName, ({ text: 'text', list: 'list', number: 'hash', checkbox: 'square-dashed', date: 'calendar', datetime: 'calendar-clock' } as const)[field.property.type ?? 'text']);
		const customMapping = getCustomFieldMapping(this.options.settings.keyMappings, key);
		if (customMapping) return getCustomFieldIcon(customMapping);
		return getConfiguredKeyMappingIcon(key, this.options.settings.keyMappings)
			|| (TASK_CREATOR_FALLBACK_FIELD_ICONS as Record<string, string>)[key]
			|| 'circle-dot';
	}

	private getVisibleToolbarFieldOrder(): TaskCreatorFieldKey[] {
  if (this.prepared) {
   // Orphan toolbar preferences alone must not resurrect a deleted custom key.
   const nativeKeys = new Set(this.prepared.fields(this.activeCreateType)
    .filter(field => field.property.interpretation === 'native')
    .map(field => this.prepared!.key(field)));
   return this.prepared.visibleKeys(this.activeCreateType).filter(key => this.canRenderToolbarField(key) || nativeKeys.has(key));
  }
		return (this.options.settings.taskCreatorToolbar ?? [])
			.filter(item => item.visible)
			.map(item => item.key)
			.filter(key => this.canRenderToolbarField(key));
	}

	private canRenderToolbarField(key: TaskCreatorFieldKey): boolean {
		const customMapping = getCustomFieldMapping(this.options.settings.keyMappings, key);
		if (customMapping) return isProjectedCustomFieldType(customMapping);
		return !!(TASK_CREATOR_FALLBACK_FIELD_ICONS as Record<string, string>)[key]
			|| TASK_CREATOR_NON_FIELD_SUBMIT_KEYS.has(key)
			|| TASK_CREATOR_DAY_PICKER_DATE_KEYS.has(key);
	}

	private getFieldLabel(key: TaskCreatorFieldKey): string {
		if (key === 'note') return t('taskEditor', 'notes');
		if (key === 'subtasks') return t('taskEditor', 'subtasks');
		if (key === 'blocking') return t('taskEditor', 'blocking');
		if (key === 'blockedBy') return t('taskEditor', 'blockedBy');
		if (key === 'pinned') return t('settings', 'taskCreatorToolbarPinned');
		const customMapping = getCustomFieldMapping(this.options.settings.keyMappings, key);
		if (customMapping) return getCustomFieldLabel(customMapping);
		const mapping = this.options.settings.keyMappings.find(candidate => candidate.canonicalKey === key);
		return mapping?.visiblePropertyName?.trim() || key;
	}

	private bindFieldButtonTooltip(button: HTMLButtonElement, key: TaskCreatorFieldKey): void {
  if (this.prepared) {
   const field = this.prepared.field(key); const value = field.value;
   const content = value === undefined || value === null ? '' : field.property.type ? encodeVaultPropertyValue(value, field.property.type) : String(value);
   setAccessibleLabelWithoutTooltip(button, `${this.getFieldLabel(key)}${content ? ': ' + content : ''}`);
   bindOperonHoverTooltip(button, { title: this.getFieldLabel(key), content, taskColor: () => this.getThemeColor() }); return;
  }

		const copy = getTaskCreatorToolbarTooltipCopy(key, this.options.settings.keyMappings);
		if (!copy) return;
		const displayValue = this.getFieldButtonDisplayValue(key);
		setAccessibleLabelWithoutTooltip(button, displayValue ? `${copy.title}: ${displayValue}` : copy.title);
		bindOperonHoverTooltip(button, {
			title: copy.title,
			content: [copy.content, displayValue].filter(Boolean).join('\n') || undefined,
			taskColor: () => this.getThemeColor(),
		});
	}

	private getFieldButtonDisplayValue(key: TaskCreatorFieldKey): string | null {
		const rawValue = (this.draft.fieldValues[key] ?? '').trim();
		if (!rawValue) return null;
		if (TASK_CREATOR_DAY_PICKER_DATE_KEYS.has(key)) {
			return formatUiDate(rawValue, this.options.settings);
		}
		if (key === 'datetimeStart' || key === 'datetimeEnd') {
			return formatUiTaskDatetime(this.app, this.options.settings, rawValue);
		}
		const mapping = getCustomFieldMapping(this.options.settings.keyMappings, key);
		if (mapping?.type === 'date') return formatUiDate(rawValue, this.options.settings);
		if (mapping?.type === 'datetime') return formatUiTaskDatetime(this.app, this.options.settings, rawValue);
		return null;
	}

	private getSnapshot(): TaskCreatorDraft {
		return buildTaskCreatorSnapshot(this.draft);
	}

	private getSnapshotForCreateType(createType: TaskCreatorCreateType): TaskCreatorDraft {
		const snapshot = buildTaskCreatorSnapshotForCreateType(this.draft, createType);
  this.removeInlineParentPreview(snapshot);
  return snapshot;
	}

	private ensureDescription(): boolean {
		if (this.getSnapshot().description) return true;
		new Notice(t('notifications', 'taskDescriptionRequired'));
		this.focusDescription(this.getDescriptionDisplayValue().length);
		return false;
	}

	private async handleInlineAction(): Promise<void> {
		if (this.submitMode === 'file-only') return;
		if (this.activeCreateType !== 'inline') {
			this.setActiveCreateType('inline');
			return;
		}
		await this.handleInlineSubmit();
	}

	private async handleFileAction(): Promise<void> {
		if (this.submitMode === 'inline-only') return;
		if (this.activeCreateType !== 'file') {
			this.setActiveCreateType('file');
			return;
		}
		await this.handleFileSubmit();
	}

	private async handleEnterSubmit(): Promise<void> {
		const action = resolveTaskCreatorEnterAction(this.activeCreateType, this.hasSelectedFileTemplate());
		if (action === 'open-template-picker') {
			this.openFileTemplatePicker();
			return;
		}
		if (action === 'submit-file') {
			await this.handleFileSubmit();
			return;
		}
		await this.handleInlineSubmit();
	}

	private async handleInlineSubmit(): Promise<void> {
  if (this.prepared) { await this.submitPrepared('inline'); return; }
		if (this.isSubmitting) return;
		if (this.submitMode === 'file-only') return;
		if (!this.ensureDescription()) return;
		this.isSubmitting = true;
		const snapshot = this.getSnapshotForCreateType('inline');
		this.runSubmitAfterImmediateClose(
			snapshot,
			'inline',
			draft => this.options.onSubmitInline(draft),
			'inline task creator submit failed',
			true,
		);
	}

	private async handleFileSubmit(): Promise<void> {
  if (this.prepared) { await this.submitPrepared('file'); return; }
		if (this.isSubmitting) return;
		if (!canSubmitTaskCreatorFileTask(this.submitMode, this.activeCreateType, this.hasSelectedFileTemplate())) {
			new Notice(t('notifications', 'chooseFileTaskTemplateFirst'));
			this.openFileTemplatePicker();
			return;
		}
		if (!this.ensureDescription()) return;
		this.isSubmitting = true;
		const snapshot = this.getSnapshot();
		this.runSubmitAfterImmediateClose(
			snapshot,
			'file',
			draft => this.options.onSubmitFile(draft),
			'file task creator submit failed',
			false,
		);
	}

	private runSubmitAfterImmediateClose(
		snapshot: TaskCreatorDraft,
		createType: TaskCreatorCreateType,
		submit: (draft: TaskCreatorDraft) => Promise<boolean> | boolean,
		errorContext: string,
		reopenOnFailure: boolean,
	): void {
		this.resolved = true;
		this.hideImmediately();
		this.forceClose();
		getActiveWindow().setTimeout(() => {
			void Promise.resolve()
				.then(() => submit(snapshot))
				.then((success) => {
					if (!success && reopenOnFailure) {
						void this.options.onSubmitFailure?.(snapshot, createType);
					}
				})
				.catch((error: unknown) => {
					console.error(`Operon: ${errorContext}`, error);
					if (reopenOnFailure) {
						void this.options.onSubmitFailure?.(snapshot, createType);
					}
				});
		}, 0);
	}

	private hasUnsavedDraft(): boolean {
  const snapshot = this.getSnapshotForCreateType(this.activeCreateType);
  if (snapshot.description !== this.initialDraftSnapshot.description) return true;
  if (snapshot.inlineCompletionMode !== this.initialDraftSnapshot.inlineCompletionMode) return true;
  if ([...this.userTemplateSelections].some(([mode, id]) => id !== this.templateSelectionBaselines.get(mode))) return true;
  if (this.prepared) return this.prepared.hasUserChanges();
  const initial = this.initialDraftSnapshot;
  const ownTags = (draft: TaskCreatorDraft): string[] => draft.tags.filter(tag => !draft.inheritedTags.includes(tag));
  return snapshot.note !== initial.note
   || JSON.stringify(ownTags(snapshot)) !== JSON.stringify(ownTags(initial))
   || JSON.stringify(snapshot.subtaskIds) !== JSON.stringify(initial.subtaskIds)
   || [...new Set([...snapshot.explicitFieldKeys, ...initial.explicitFieldKeys])].some(key =>
    (snapshot.fieldValues[key] ?? '') !== (initial.fieldValues[key] ?? ''));
	}

	private promptDiscardDraft(): void {
		this.isOutsideConfirmOpen = true;
		new ConfirmActionModal(this.app, {
			title: t('modals', 'taskCreatorDiscardTitle'),
			message: t('modals', 'taskCreatorDiscardMessage'),
			confirmText: t('buttons', 'discard'),
			cancelText: t('buttons', 'cancel'),
		}, (confirmed) => {
			this.isOutsideConfirmOpen = false;
			if (confirmed) {
				this.resolved = true;
				this.forceClose();
				return;
			}
			window.setTimeout(() => this.focusDescription(this.getDescriptionCaret()), 0);
		}).open();
	}

	close(): void {
		if (this.allowDirectClose || this.resolved) {
			super.close();
			return;
		}
		if (this.isOutsideConfirmOpen) return;
		if (Date.now() < this.ignoreOutsidePointerUntil) return;
		if (!this.hasUnsavedDraft()) {
			this.forceClose();
			return;
		}
		this.promptDiscardDraft();
	}

	completeAndClose(): void {
  this.draftPropertiesCleanup?.(); this.draftPropertiesCleanup = undefined;
		this.resolved = true;
  this.preparedClosed = true; this.prepared?.close();
  if (this.detachedForSubmit) {
   this.detachedForSubmit = false; this.options.onSubmissionStateChange?.(); return;
  }
		this.hideImmediately();
		this.forceClose();
	}

	private hideImmediately(): void {
		this.containerEl.addClass('operon-task-creator-force-hidden');
		this.modalEl.addClass('operon-task-creator-force-hidden');
	}

	private removeCurrentModalArtifacts(): void {
		this.containerEl.remove();
	}

	private forceClose(): void {
		this.allowDirectClose = true;
		try {
			super.close();
		} finally {
			this.allowDirectClose = false;
			getActiveWindow().setTimeout(() => this.removeCurrentModalArtifacts(), 0);
		}
	}
}
