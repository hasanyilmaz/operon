import { App, KeymapEventHandler, Modal, Notice, Platform, getIcon, setIcon } from 'obsidian';
import { getConfiguredKeyMappingIcon } from '../core/key-mapping-icons';
import { getSubtaskInheritedFieldKeys, resolveSubtaskInitialFieldsFromParentValues } from '../core/subtask-inheritance';
import { applyTaskFieldPatchToState, splitTaskListValue } from '../core/task-field-patch';
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
import { bindOperonHoverTooltip } from './operon-hover-tooltip';
import { openTaskFieldPicker } from './task-field-picker-dispatch';
import { getCustomFieldIcon, getCustomFieldLabel, getCustomFieldMapping, isProjectedCustomFieldType } from './custom-field-surfaces';
import {
	debugTaskFieldSuggestion,
	resolveTaskFieldSuggestions,
	TaskFieldSuggestionItem,
} from './task-field-suggest';
import { buildSubtaskExcludedIds } from '../core/task-hierarchy';
import {
	WindowIntervalHandle,
	WindowTimeoutHandle,
	clearWindowInterval,
	clearWindowTimeout,
	getActiveDocument,
	getActiveWindow,
	setWindowInterval,
	setWindowTimeout,
} from '../core/dom-compat';
import {
	DEFAULT_INLINE_REPEAT_COMPLETION_MODE,
	type InlineRepeatCompletionMode,
	normalizeInlineCompletionMode,
} from '../storage/repeat-series-store';

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
	settings: OperonSettings;
	allTasks: IndexedTask[];
	initialDraft?: TaskCreatorDraft | null;
	submitMode?: TaskCreatorSubmitMode;
	initialCreateType?: TaskCreatorCreateType;
	fileTaskTemplateOptions?: FileTaskTemplateOption[];
	onFileTemplateSelected?: (template: FileTaskTemplateOption) => void | Promise<void>;
	getAllRepeatSeriesIds?: () => Set<string>;
	onSubmitInline: (draft: TaskCreatorDraft) => Promise<boolean> | boolean;
	onSubmitFile: (draft: TaskCreatorDraft) => Promise<boolean> | boolean;
	onSubmitFailure?: (draft: TaskCreatorDraft, createType: TaskCreatorCreateType) => void | Promise<void>;
	onCancel?: () => void;
	initialOutsidePointerGraceMs?: number;
}

interface SuggestionState {
	items: TaskFieldSuggestionItem[];
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
	return !userInterruptedInitialFocus && activeElement !== descriptionElement;
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
	const note = draft.note.replace(/\r?\n+/g, ' ').trim();
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
	const note = draft.note.replace(/\r?\n+/g, ' ').trim();
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

let activeTaskCreatorArtifactObserver: MutationObserver | null = null;
let activeTaskCreatorArtifactInterval: WindowIntervalHandle | null = null;

export function watchForTaskCreatorModalArtifacts(durationMs = 2000): void {
	const artifactDocument = getActiveDocument();
	purgeTaskCreatorModalArtifacts(artifactDocument);
	activeTaskCreatorArtifactObserver?.disconnect();
	if (activeTaskCreatorArtifactInterval !== null) {
		clearWindowInterval(activeTaskCreatorArtifactInterval);
		activeTaskCreatorArtifactInterval = null;
	}

	const observer = new MutationObserver(() => {
		purgeTaskCreatorModalArtifacts(artifactDocument);
	});
	activeTaskCreatorArtifactObserver = observer;
	observer.observe(artifactDocument.body, {
		childList: true,
		subtree: true,
	});

	activeTaskCreatorArtifactInterval = setWindowInterval(() => {
		purgeTaskCreatorModalArtifacts(artifactDocument);
	}, 120);

	getActiveWindow().setTimeout(() => {
		if (activeTaskCreatorArtifactObserver === observer) {
			activeTaskCreatorArtifactObserver.disconnect();
			activeTaskCreatorArtifactObserver = null;
		}
		if (activeTaskCreatorArtifactInterval !== null) {
			clearWindowInterval(activeTaskCreatorArtifactInterval);
			activeTaskCreatorArtifactInterval = null;
		}
	}, durationMs);
}

export class TaskCreatorModal extends Modal {
	private readonly options: TaskCreatorModalOptions;
	private readonly submitMode: TaskCreatorSubmitMode;
	private draft: TaskCreatorDraft;
	private activeCreateType: TaskCreatorCreateType;
	private descriptionEl!: HTMLTextAreaElement;
	private noteEl: HTMLTextAreaElement | null = null;
	private noteWrapEl: HTMLElement | null = null;
	private suggestionsEl: HTMLElement | null = null;
	private metadataRowEl!: HTMLElement;
	private toolsEl!: HTMLElement;
	private actionRowEl!: HTMLElement;
	private cancelButtonEl!: HTMLButtonElement;
	private inlineButtonEl!: HTMLButtonElement;
	private fileButtonEl!: HTMLButtonElement;
	private templateButtonEl!: HTMLButtonElement;
	private fieldButtonMap = new Map<TaskCreatorFieldKey, HTMLButtonElement>();
	private nativeCloseButtonCleanup: (() => void) | null = null;
	private suggestionState: SuggestionState | null = null;
	private activePickerClose: (() => void) | null = null;
	private escapeScopeHandler: KeymapEventHandler | null = null;
	private seededParentFieldValuesById = new Map<string, Record<string, string> | null>();
	private seededParentTagsById = new Map<string, string[] | null>();
	private allowDirectClose = false;
	private isSubmitting = false;
	private resolved = false;
	private isOutsideConfirmOpen = false;
	private initialDescriptionFocusTimers: WindowTimeoutHandle[] = [];
	private initialDescriptionFocusInterrupted = false;
	private isDescriptionComposing = false;
	private ignoreOutsidePointerUntil = 0;
	private toolbarOverflowFrame: number | null = null;
	private mobilePickerOpenDepth = 0;
	private readonly resizeHandler = () => {
		this.updateMobileViewportHeight();
		this.autoSizeRenderedTextareas();
		this.scheduleToolbarOverflowState();
	};
	private readonly visualViewportHandler = () => {
		this.updateMobileViewportHeight();
		this.scheduleToolbarOverflowState();
	};
	private readonly mobilePickerOpenHandler = () => {
		this.mobilePickerOpenDepth += 1;
	};
	private readonly mobilePickerCloseHandler = () => {
		this.mobilePickerOpenDepth = Math.max(0, this.mobilePickerOpenDepth - 1);
		window.setTimeout(() => this.updateMobileViewportHeight(), 80);
	};
	private readonly toolbarScrollHandler = () => this.scheduleToolbarOverflowState();

	constructor(app: App, options: TaskCreatorModalOptions) {
		super(app);
		this.options = options;
		this.draft = cloneTaskCreatorDraft(options.initialDraft);
		this.submitMode = normalizeTaskCreatorSubmitMode(options.submitMode);
		this.activeCreateType = getInitialTaskCreatorCreateType(
			this.submitMode,
			options.initialCreateType,
			!!this.draft.fileTemplateId,
		);
	}

	onOpen(): void {
		this.containerEl.addClass('operon-task-creator-modal-container');
		this.modalEl.addClass('operon-task-creator-modal');
		this.nativeCloseButtonCleanup?.();
		this.nativeCloseButtonCleanup = suppressNativeModalCloseButton(this.containerEl, this.modalEl);
		if (Platform.isPhone) {
			this.containerEl.addClass('operon-task-creator-modal-container-mobile');
			this.modalEl.addClass('operon-task-creator-modal-mobile');
		}
		this.titleEl.addClass('operon-task-creator-title');
		this.titleEl.setText(t('modals', 'taskCreatorTitle'));
		this.contentEl.empty();
		window.addEventListener('resize', this.resizeHandler);
		this.registerMobileViewportListeners();
		this.updateMobileViewportHeight();
		this.registerMobilePickerListeners();
		this.render();
		this.applyThemeColor();
		this.allowDirectClose = false;
		if (this.options.initialOutsidePointerGraceMs && this.options.initialOutsidePointerGraceMs > 0) {
			this.ignoreOutsidePointerUntil = Date.now() + Math.round(this.options.initialOutsidePointerGraceMs);
		}
		this.escapeScopeHandler = this.scope.register(null, 'Escape', () => {
			this.handleEscapeIntent();
			return false;
		});
		window.addEventListener('keydown', this.handleWindowKeydownCapture, true);
		window.addEventListener('keydown', this.handleInitialDescriptionFocusKeydown, true);
		this.containerEl.addEventListener('mousedown', this.handleContainerPointerDown, true);
		this.containerEl.addEventListener('click', this.handleContainerPointerDown, true);
		this.containerEl.addEventListener('mousedown', this.handleInitialDescriptionFocusPointerDown, true);
		this.startInitialDescriptionFocusGuard();
	}

	onClose(): void {
		this.nativeCloseButtonCleanup?.();
		this.nativeCloseButtonCleanup = null;
		if (this.escapeScopeHandler) {
			this.scope.unregister(this.escapeScopeHandler);
			this.escapeScopeHandler = null;
		}
		window.removeEventListener('resize', this.resizeHandler);
		this.unregisterMobileViewportListeners();
		this.unregisterMobilePickerListeners();
		this.mobilePickerOpenDepth = 0;
		window.removeEventListener('keydown', this.handleWindowKeydownCapture, true);
		window.removeEventListener('keydown', this.handleInitialDescriptionFocusKeydown, true);
		this.containerEl.removeEventListener('mousedown', this.handleContainerPointerDown, true);
		this.containerEl.removeEventListener('click', this.handleContainerPointerDown, true);
		this.containerEl.removeEventListener('mousedown', this.handleInitialDescriptionFocusPointerDown, true);
		this.toolsEl?.removeEventListener('scroll', this.toolbarScrollHandler);
		if (this.toolbarOverflowFrame !== null) {
			window.cancelAnimationFrame(this.toolbarOverflowFrame);
			this.toolbarOverflowFrame = null;
		}
		this.containerEl.style.removeProperty('--operon-task-creator-mobile-viewport-height');
		this.clearInitialDescriptionFocusGuard();
		this.closeActivePicker();
		this.closeSuggestions();
		this.contentEl.empty();
		if (!this.resolved) {
			this.options.onCancel?.();
		}
	}

	private render(): void {
		const shell = this.contentEl.createDiv('operon-task-creator');
		const body = shell.createDiv('operon-task-creator-body');

		const composerWrap = body.createDiv('operon-task-creator-composer-wrap');
		this.descriptionEl = composerWrap.createEl('textarea', {
			cls: 'operon-task-creator-description',
			attr: {
				placeholder: t('taskEditor', 'creatorDescriptionPlaceholder'),
				rows: '1',
			},
		});
			this.descriptionEl.value = this.draft.description;
			this.descriptionEl.addEventListener('input', this.handleDescriptionInput);
			this.descriptionEl.addEventListener('focus', this.handleDescriptionSelectionChange);
			this.descriptionEl.addEventListener('click', this.handleDescriptionSelectionChange);
			this.descriptionEl.addEventListener('mouseup', this.handleDescriptionSelectionChange);
			this.descriptionEl.addEventListener('select', this.handleDescriptionSelectionChange);
			this.descriptionEl.addEventListener('keyup', this.handleDescriptionSelectionChange);
			this.descriptionEl.addEventListener('keydown', this.handleDescriptionKeydown);
			this.descriptionEl.addEventListener('compositionstart', this.handleDescriptionCompositionStart);
			this.descriptionEl.addEventListener('compositionend', this.handleDescriptionCompositionEnd);
			this.autoSizeTextarea(this.descriptionEl);

		this.suggestionsEl = body.createDiv('operon-task-creator-suggestions');
		this.suggestionsEl.hide();

		this.noteWrapEl = body.createDiv('operon-task-creator-note-wrap');
		this.noteWrapEl.hide();
		this.noteEl = this.noteWrapEl.createEl('textarea', {
			cls: 'operon-task-creator-note',
			attr: {
				placeholder: t('taskEditor', 'creatorNotePlaceholder'),
				rows: '1',
			},
		});
		this.noteEl.value = this.draft.note;
		this.noteEl.addEventListener('input', this.handleNoteInput);
		this.noteEl.addEventListener('keydown', this.handleNoteKeydown);
		this.autoSizeTextarea(this.noteEl);
		if (this.draft.noteOpen) {
			this.noteWrapEl.show();
		}

		this.metadataRowEl = body.createDiv('operon-task-creator-toolbar');
		this.toolsEl = this.metadataRowEl.createDiv('operon-task-creator-tools');
		this.toolsEl.addEventListener('scroll', this.toolbarScrollHandler, { passive: true });
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
		}

		this.actionRowEl = body.createDiv('operon-task-creator-action-row');
		this.cancelButtonEl = this.actionRowEl.createEl('button', {
			cls: 'operon-task-creator-action is-secondary is-cancel',
			text: t('buttons', 'cancel'),
			attr: { type: 'button' },
		});
		this.cancelButtonEl.addEventListener('click', () => this.forceClose());

		const actions = this.actionRowEl.createDiv('operon-task-creator-actions');
		this.templateButtonEl = actions.createEl('button', {
			cls: 'operon-task-creator-action operon-task-creator-template-action is-secondary',
			attr: {
				type: 'button',
			},
		});
		this.templateButtonEl.addEventListener('click', () => this.openFileTemplatePicker());

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
		this.scheduleToolbarOverflowState();
	}

	private readonly handleDescriptionInput = (): void => {
		this.draft.description = this.descriptionEl.value;
		this.autoSizeTextarea(this.descriptionEl);
		this.syncSuggestions();
	};

	private readonly handleDescriptionSelectionChange = (): void => {
		this.syncSuggestions();
	};

	private readonly handleDescriptionCompositionStart = (): void => {
		this.isDescriptionComposing = true;
	};

	private readonly handleDescriptionCompositionEnd = (): void => {
		this.isDescriptionComposing = false;
		this.draft.description = this.descriptionEl.value;
		this.autoSizeTextarea(this.descriptionEl);
		this.syncSuggestions();
	};

	private readonly handleDescriptionKeydown = (event: KeyboardEvent): void => {
		if (event.key === 'ArrowDown' && this.suggestionState) {
			event.preventDefault();
			this.moveSuggestion(1);
			return;
		}
		if (event.key === 'ArrowUp' && this.suggestionState) {
			event.preventDefault();
			this.moveSuggestion(-1);
			return;
		}
		if (event.key === 'Enter') {
			event.preventDefault();
			if (this.suggestionState) {
				this.chooseSuggestion(this.suggestionState.items[this.suggestionState.activeIndex] ?? null);
				return;
			}
			void this.handleEnterSubmit();
			return;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			this.handleEscapeIntent();
			return;
		}
	};

	private readonly handleNoteInput = (): void => {
		if (!this.noteEl) return;
		this.draft.note = this.noteEl.value;
		this.draft.noteOpen = this.draft.noteOpen || !!this.draft.note.trim();
		this.autoSizeTextarea(this.noteEl);
		this.renderFieldButtons();
	};

	private readonly handleNoteKeydown = (event: KeyboardEvent): void => {
		if (event.key === 'Enter') {
			event.preventDefault();
			void this.handleEnterSubmit();
			return;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			this.handleEscapeIntent();
			return;
		}
	};

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
		if (!target || target === this.descriptionEl || !this.modalEl.contains(target)) return;
		this.initialDescriptionFocusInterrupted = true;
	};

	private readonly handleInitialDescriptionFocusKeydown = (event: KeyboardEvent): void => {
		if (event.key === 'Tab') {
			this.initialDescriptionFocusInterrupted = true;
		}
	};

	private handleEscapeIntent(): void {
		if (this.resolved || this.isOutsideConfirmOpen) return;
		if (this.suggestionState) {
			this.closeSuggestions();
			window.setTimeout(() => this.focusDescription(this.descriptionEl.selectionStart ?? this.descriptionEl.value.length), 0);
			return;
		}

		if (this.activePickerClose) {
			this.closeActivePicker();
			window.setTimeout(() => this.focusDescription(this.descriptionEl.selectionStart ?? this.descriptionEl.value.length), 0);
			return;
		}

		if (!this.hasUnsavedDraft()) {
			this.forceClose();
			return;
		}

		this.promptDiscardDraft();
	}

	private focusDescription(caret: number): void {
		this.descriptionEl.focus();
		this.descriptionEl.setSelectionRange(caret, caret);
		this.syncSuggestions();
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
		if (!this.modalEl.isConnected || !this.descriptionEl.isConnected) return;
		if (!shouldReclaimTaskCreatorDescriptionFocus(
			this.descriptionEl.ownerDocument.activeElement,
			this.descriptionEl,
			this.initialDescriptionFocusInterrupted,
		)) {
			return;
		}
		this.focusDescription(this.descriptionEl.selectionStart ?? this.descriptionEl.value.length);
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

	private setActiveCreateType(nextType: TaskCreatorCreateType): void {
		if (this.activeCreateType === nextType) return;
		this.activeCreateType = nextType;
		if (nextType === 'inline') {
			this.closeActivePicker();
		}
		this.renderSubmitControls();
		window.setTimeout(() => this.focusDescription(this.descriptionEl.selectionStart ?? this.descriptionEl.value.length), 0);
	}

	private openFileTemplatePicker(): void {
		if (!isTaskCreatorTemplateControlEnabled(this.submitMode, this.activeCreateType)) return;
		const templateOptions = this.getFileTemplateOptions();
		if (templateOptions.length === 0) return;
		this.closeSuggestions();
		this.closeActivePicker();
		this.templateButtonEl.addClass('is-picker-open');
		const close = showFileTaskTemplatePicker(this.templateButtonEl, {
			value: this.draft.fileTemplateId,
			options: templateOptions,
			onSelect: template => {
				this.suppressOutsidePointerBriefly();
				this.draft.fileTemplateId = template.id;
				void this.options.onFileTemplateSelected?.(template);
				this.closeActivePicker();
				this.renderSubmitControls();
				window.setTimeout(() => this.focusDescription(this.descriptionEl.selectionStart ?? this.descriptionEl.value.length), 0);
			},
			onClose: () => {
				this.closeActivePicker();
				window.setTimeout(() => this.focusDescription(this.descriptionEl.selectionStart ?? this.descriptionEl.value.length), 0);
			},
		});
		this.activePickerClose = close;
	}

	private focusNote(): void {
		if (!this.noteEl) return;
		this.noteEl.focus();
		const caret = this.noteEl.value.length;
		this.noteEl.setSelectionRange(caret, caret);
	}

	private autoSizeTextarea(textarea: HTMLTextAreaElement): void {
		textarea.setCssProps({ height: '0px' });
		const measuredHeight = Math.max(textarea.scrollHeight, 44);
		if (!Platform.isPhone) {
			textarea.style.height = `${measuredHeight}px`;
			return;
		}

		const style = window.getComputedStyle(textarea);
		const lineHeight = Number.parseFloat(style.lineHeight || '') || 24.8;
		const paddingTop = Number.parseFloat(style.paddingTop || '') || 0;
		const paddingBottom = Number.parseFloat(style.paddingBottom || '') || 0;
		const borderTop = Number.parseFloat(style.borderTopWidth || '') || 0;
		const borderBottom = Number.parseFloat(style.borderBottomWidth || '') || 0;
		const maxMobileHeight = Math.ceil(lineHeight * 4 + paddingTop + paddingBottom + borderTop + borderBottom);
		const nextHeight = Math.min(measuredHeight, Math.max(44, maxMobileHeight));
		textarea.style.height = `${nextHeight}px`;
	}

	private autoSizeRenderedTextareas(): void {
		if (!Platform.isPhone || !this.descriptionEl?.isConnected) return;
		this.autoSizeTextarea(this.descriptionEl);
		if (this.noteEl?.isConnected) {
			this.autoSizeTextarea(this.noteEl);
		}
	}

	private registerMobileViewportListeners(): void {
		if (!Platform.isPhone) return;
		window.visualViewport?.addEventListener('resize', this.visualViewportHandler);
		window.visualViewport?.addEventListener('scroll', this.visualViewportHandler);
	}

	private unregisterMobileViewportListeners(): void {
		if (!Platform.isPhone) return;
		window.visualViewport?.removeEventListener('resize', this.visualViewportHandler);
		window.visualViewport?.removeEventListener('scroll', this.visualViewportHandler);
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
		const height = window.visualViewport?.height ?? window.innerHeight;
		if (!Number.isFinite(height) || height <= 0) return;
		this.containerEl.style.setProperty('--operon-task-creator-mobile-viewport-height', `${Math.round(height)}px`);
	}

	private scheduleToolbarOverflowState(): void {
		if (!Platform.isPhone || !this.metadataRowEl?.isConnected || !this.toolsEl?.isConnected) return;
		if (this.toolbarOverflowFrame !== null) {
			window.cancelAnimationFrame(this.toolbarOverflowFrame);
		}
		this.toolbarOverflowFrame = window.requestAnimationFrame(() => {
			this.toolbarOverflowFrame = null;
			this.updateToolbarOverflowState();
		});
	}

	private updateToolbarOverflowState(): void {
		if (!this.metadataRowEl?.isConnected || !this.toolsEl?.isConnected) return;
		const maxScrollLeft = Math.max(0, this.toolsEl.scrollWidth - this.toolsEl.clientWidth);
		const scrollLeft = this.toolsEl.scrollLeft;
		this.metadataRowEl.toggleClass('is-scrollable-left', scrollLeft > 1);
		this.metadataRowEl.toggleClass('is-scrollable-right', scrollLeft < maxScrollLeft - 1);
	}

	private syncSuggestions(): void {
		if (this.activePickerClose) {
			debugTaskFieldSuggestion('task-creator', 'picker-active');
			this.closeSuggestions();
			return;
		}
		if (this.isDescriptionComposing) {
			debugTaskFieldSuggestion('task-creator', 'composition-active');
			return;
		}
		const caret = this.descriptionEl.selectionStart ?? this.descriptionEl.value.length;
		const beforeCaret = this.descriptionEl.value.slice(0, caret);
		const resolution = resolveTaskFieldSuggestions(
			beforeCaret,
			this.options.settings,
			this.draft.fieldValues,
			'creator',
		);
		if (!resolution.trigger || resolution.items.length === 0) {
			if (resolution.suppressionReason) {
				debugTaskFieldSuggestion('task-creator', resolution.suppressionReason, {
					token: resolution.token,
				});
			}
			this.closeSuggestions();
			return;
		}

		this.suggestionState = {
			items: resolution.items,
			activeIndex: Math.min(this.suggestionState?.activeIndex ?? 0, resolution.items.length - 1),
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
			button.addEventListener('mouseenter', () => {
				if (!this.suggestionState) return;
				this.suggestionState.activeIndex = index;
				this.renderSuggestions();
			});
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

	private chooseSuggestion(item: TaskFieldSuggestionItem | null): void {
		if (!item || !this.suggestionState) return;
		const current = this.descriptionEl.value;
		const before = current.slice(0, this.suggestionState.range.start);
		const after = current.slice(this.suggestionState.range.end);
		const nextValue = `${before}${after}`;
		const nextCaret = this.suggestionState.range.start;
		this.draft.description = nextValue;
		this.descriptionEl.value = nextValue;
		this.autoSizeTextarea(this.descriptionEl);
		this.closeSuggestions();
		this.focusDescription(nextCaret);
		this.openFieldPicker(item.canonicalKey);
	}

	private openFieldPicker(canonicalKey: string): void {
		this.closeSuggestions();
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
		const anchor = anchorButton ?? this.descriptionEl;
		this.closeActivePicker();

		const close = openTaskFieldPicker({
			app: this.app,
			settings: this.options.settings,
			allTasks: this.options.allTasks,
			canonicalKey,
			anchor,
			currentFieldValues: { ...this.draft.fieldValues },
			currentTags: [...this.draft.tags],
			closeListPickerOnSelect: canonicalKey === 'assignees' || canonicalKey === 'tags' || canonicalKey === 'contexts',
			manualDatePicker: this.getManualDatePickerOptions(canonicalKey),
			taskFormat: this.activeCreateType === 'file' ? 'yaml' : 'inline',
			repeatInlineCompletionMode: this.draft.inlineCompletionMode,
			onCommit: payload => {
				this.applyPayloadToDraft(payload);
				if (canonicalKey === 'assignees' || canonicalKey === 'tags' || canonicalKey === 'contexts' || canonicalKey === 'links') {
					return;
				}
				this.closeActivePicker();
				window.setTimeout(() => this.focusDescription(this.descriptionEl.selectionStart ?? this.descriptionEl.value.length), 0);
			},
			onRepeatInlineCompletionModeChange: mode => {
				this.draft.inlineCompletionMode = normalizeInlineCompletionMode(mode);
			},
			onOpenNote: () => {
				this.openNote();
				window.setTimeout(() => this.focusNote(), 0);
			},
			onCancel: () => {
				this.closeActivePicker();
				window.setTimeout(() => this.focusDescription(this.descriptionEl.selectionStart ?? this.descriptionEl.value.length), 0);
			},
			onClose: () => {
				this.closeActivePicker();
				window.setTimeout(() => this.focusDescription(this.descriptionEl.selectionStart ?? this.descriptionEl.value.length), 0);
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
		const anchor = anchorButton ?? this.descriptionEl;
		this.closeSuggestions();
		this.closeActivePicker();
		const close = showSubtasksPicker(anchor, {
			value: this.draft.subtaskIds,
			allTasks: this.options.allTasks,
			excludedIds: Array.from(this.getDraftSubtaskExcludedIds()),
			closeOnSelect: true,
			onChange: operonIds => {
				this.draft.subtaskIds = [...operonIds];
				this.renderFieldButtons();
			},
			onClose: () => {
				this.closeActivePicker();
				window.setTimeout(() => this.focusDescription(this.descriptionEl.selectionStart ?? this.descriptionEl.value.length), 0);
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
		const anchor = anchorButton ?? this.descriptionEl;
		this.closeSuggestions();
		this.closeActivePicker();
		const oppositeFieldKey = fieldKey === 'blocking' ? 'blockedBy' : 'blocking';
		const close = showDependencyTaskPicker(anchor, {
			fieldKey,
			value: this.draft.fieldValues[fieldKey] ?? '',
			oppositeValue: this.draft.fieldValues[oppositeFieldKey] ?? '',
			allTasks: this.options.allTasks,
			closeOnSelect: true,
			onSave: payload => {
				this.applyPayloadToDraft(payload);
			},
			onClose: () => {
				this.closeActivePicker();
				window.setTimeout(() => this.focusDescription(this.descriptionEl.selectionStart ?? this.descriptionEl.value.length), 0);
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
		window.setTimeout(() => this.focusDescription(this.descriptionEl.selectionStart ?? this.descriptionEl.value.length), 0);
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
			if (this.noteEl) {
				this.noteEl.value = this.draft.note;
				this.autoSizeTextarea(this.noteEl);
			}
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
		const normalizedPayload = this.normalizeTerminalDatePayload(payload);
		if (!normalizedPayload) return;
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
		const anchor = anchorButton ?? this.descriptionEl;
		this.closeSuggestions();
		this.closeActivePicker();
		const close = showColorPicker(anchor, {
			value: this.draft.fieldValues['taskColor'] ?? this.draft.taskColor,
			palette: this.options.settings.colorPalette,
			onSelect: value => {
				this.applyPayloadToDraft({ taskColor: value });
				this.closeActivePicker();
				window.setTimeout(() => this.focusDescription(this.descriptionEl.selectionStart ?? this.descriptionEl.value.length), 0);
			},
			onClear: () => {
				this.applyPayloadToDraft({ taskColor: '' });
				this.closeActivePicker();
				window.setTimeout(() => this.focusDescription(this.descriptionEl.selectionStart ?? this.descriptionEl.value.length), 0);
			},
			onClose: () => {
				this.closeActivePicker();
				window.setTimeout(() => this.focusDescription(this.descriptionEl.selectionStart ?? this.descriptionEl.value.length), 0);
			},
		});
		this.activePickerClose = close;
		anchorButton?.addClass('is-picker-open');
	}

	private renderFieldButtons(): void {
		for (const key of this.getVisibleToolbarFieldOrder()) {
			const button = this.fieldButtonMap.get(key);
			if (!button) continue;
			button.empty();
			button.removeClass('is-active');
			if (this.hasValueForField(key)) {
				button.addClass('is-active');
			}

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
			this.bindFieldButtonTooltip(button, key);
		}
	}

	private renderSubmitControls(): void {
		const selectedTemplate = this.getSelectedFileTemplate();
		const templateLabel = selectedTemplate?.name || (Platform.isPhone ? t('taskEditor', 'pickFileTaskTemplateShort') : t('taskEditor', 'pickFileTaskTemplate'));
		const templateAccessibleLabel = selectedTemplate?.name || t('taskEditor', 'pickFileTaskTemplate');
		const templateControlEnabled = isTaskCreatorTemplateControlEnabled(this.submitMode, this.activeCreateType);
		this.templateButtonEl.toggleClass('is-active', !!selectedTemplate);
		this.templateButtonEl.toggleClass('is-picker-open', !!this.activePickerClose && this.templateButtonEl.hasClass('is-picker-open'));
		this.templateButtonEl.disabled = this.isSubmitting || !templateControlEnabled || this.getFileTemplateOptions().length === 0;
		this.templateButtonEl.empty();
		this.templateButtonEl.removeClass('is-overflowing-label');
		const labelEl = this.templateButtonEl.createSpan({
			cls: 'operon-task-creator-template-label',
			text: templateLabel,
		});
		this.templateButtonEl.removeAttribute('title');
		this.templateButtonEl.removeAttribute('aria-label');
		if (Platform.isPhone) {
			this.templateButtonEl.setAttribute('aria-label', templateAccessibleLabel);
			if (selectedTemplate) {
				this.templateButtonEl.setAttribute('title', selectedTemplate.name);
			}
		}
		if (selectedTemplate) {
			window.requestAnimationFrame(() => {
				if (!labelEl.isConnected) return;
				this.templateButtonEl.toggleClass('is-overflowing-label', labelEl.scrollWidth > labelEl.clientWidth + 1);
			});
		}

		const inlineActive = this.activeCreateType === 'inline';
		this.inlineButtonEl.toggleClass('is-primary', inlineActive);
		this.inlineButtonEl.toggleClass('is-secondary', !inlineActive);
		this.inlineButtonEl.disabled = this.isSubmitting || this.submitMode === 'file-only';

		const fileActive = this.activeCreateType === 'file';
		this.fileButtonEl.toggleClass('is-primary', fileActive);
		this.fileButtonEl.toggleClass('is-secondary', !fileActive);
		this.fileButtonEl.disabled = this.isSubmitting
			|| this.submitMode === 'inline-only'
			|| (fileActive && !this.hasSelectedFileTemplate());
	}

	private hasValueForField(key: TaskCreatorFieldKey): boolean {
		if (key === 'tags') return this.draft.tags.length > 0;
		if (key === 'subtasks') return this.draft.subtaskIds.length > 0;
		if (key === 'blocking' || key === 'blockedBy') return splitTaskListValue(this.draft.fieldValues[key]).length > 0;
		if (key === 'note') return this.draft.noteOpen || !!this.draft.note.trim();
		return !!(this.draft.fieldValues[key] ?? '').trim();
	}

	private resolveFieldIcon(key: TaskCreatorFieldKey): string {
		const customMapping = getCustomFieldMapping(this.options.settings.keyMappings, key);
		if (customMapping) return getCustomFieldIcon(customMapping);
		return getConfiguredKeyMappingIcon(key, this.options.settings.keyMappings)
			|| (TASK_CREATOR_FALLBACK_FIELD_ICONS as Record<string, string>)[key]
			|| 'circle-dot';
	}

	private getVisibleToolbarFieldOrder(): TaskCreatorFieldKey[] {
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
		const copy = getTaskCreatorToolbarTooltipCopy(key, this.options.settings.keyMappings);
		if (!copy) return;
		bindOperonHoverTooltip(button, {
			title: copy.title,
			content: copy.content,
			taskColor: this.getThemeColor(),
		});
	}

	private getSnapshot(): TaskCreatorDraft {
		return buildTaskCreatorSnapshot(this.draft);
	}

	private ensureDescription(): boolean {
		if (this.getSnapshot().description) return true;
		new Notice(t('notifications', 'taskDescriptionRequired'));
		this.focusDescription(this.descriptionEl.value.length);
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
		if (this.isSubmitting) return;
		if (this.submitMode === 'file-only') return;
		if (!this.ensureDescription()) return;
		this.isSubmitting = true;
		const snapshot = this.getSnapshot();
		this.runSubmitAfterImmediateClose(
			snapshot,
			'inline',
			draft => this.options.onSubmitInline(draft),
			'inline task creator submit failed',
			true,
		);
	}

	private async handleFileSubmit(): Promise<void> {
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
		const snapshot = this.getSnapshot();
		return (
			!!snapshot.description
			|| !!snapshot.note
			|| snapshot.tags.length > 0
			|| snapshot.subtaskIds.length > 0
			|| Object.values(snapshot.fieldValues).some(value => !!value.trim())
			|| snapshot.noteOpen
			|| !!snapshot.fileTemplateId
		);
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
			window.setTimeout(() => this.focusDescription(this.descriptionEl?.selectionStart ?? this.descriptionEl?.value.length ?? 0), 0);
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
		this.resolved = true;
		this.hideImmediately();
		this.forceClose();
	}

	private hideImmediately(): void {
		this.containerEl.addClass('operon-task-creator-force-hidden');
		this.modalEl.addClass('operon-task-creator-force-hidden');
		for (const el of Array.from(this.containerEl.ownerDocument.querySelectorAll<HTMLElement>('.operon-task-creator-modal-container, .operon-task-creator-modal'))) {
			el.addClass('operon-task-creator-force-hidden');
		}
	}

	private removeCurrentModalArtifacts(): void {
		purgeTaskCreatorModalArtifacts(this.containerEl.ownerDocument);
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
