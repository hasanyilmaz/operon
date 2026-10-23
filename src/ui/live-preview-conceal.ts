import { bindDescendantFocusVisible } from './descendant-focus-visible';
import { iterateMarkdownLinesOutsideFences } from '../core/markdown-fenced-lines';
import { taskTextLinkEditorExtension } from './task-text-link-editor';
import { isTaskInfoChipKey } from '../core/task-info-chips';
import { bindTaskInfoSourceAction, createTaskSourceActionButton } from './task-info-chip-action';
import { bindDesktopChipOpening } from './links-chip-action';
import { identifyInlineTaskPart, rememberInlineTaskDom, reconcileInlineTaskDom } from './inline-retained-dom';
import { bindAssigneeChipImage } from './assignee-chip-image';
import { isValidOperonId } from '../core/id-generator';
import { getTaskIconActionLabel } from '../core/task-icon-action';
import {
	Decoration,
	DecorationSet,
	EditorView,
	ViewPlugin,
	WidgetType,
} from '@codemirror/view';
import { EditorState, Extension, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import { App, Platform, editorInfoField, editorLivePreviewField, setIcon } from 'obsidian';
import { createOwnerElement, getOwnerWindow } from '../core/dom-compat';
import { parseTaskLine } from '../core/parser';
import { IndexedTask, ParsedTask } from '../types/fields';
import { OperonSettings, resolveTaskDisplayIcon } from '../types/settings';
import { findStatusDef, Pipeline, resolveWorkflowStatus } from '../types/pipeline';
import {
	buildWorkflowStatusIdentityIndex,
	type WorkflowStatusIdentityIndex,
} from '../core/workflow-status-identity';
import { PriorityDefinition } from '../types/priority';
import { showDatePicker, type ManualDatePickerOptions } from './field-pickers/date-picker';
import { showPriorityPicker } from './field-pickers/priority-picker';
import { showEstimatePicker } from './field-pickers/estimate-picker';
import {
	buildInlineTaskCompactChipEntries,
	createCompactTaskRenderContext,
	type CompactTaskRenderContext,
	createInlineTaskCompactChipElement,
	InlineTaskCompactChipEntry,
	isCompactTaskMediaChipKey,
	resolveCompactBlockedByIconColor,
	shouldResolveLocationCompactChips,
} from './compact-task-layout';
import { bindOperonHoverTooltip, cleanupOperonHoverTooltips } from './operon-hover-tooltip';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { bindTaskContextualHoverMenu } from './contextual-hover-menu';
import type { ContextualMenuActionHandler } from '../core/contextual-menu-engine';
import type { ProjectSerialDisplay } from '../core/project-serials';
import { getConfiguredKeyMappingIcon } from '../core/key-mapping-icons';
import { resolveTaskDateToneColor } from '../core/task-date-tone';
import { getLocationPlaceIndex } from '../core/location-source-resolver';
import { bindCompactChipLinkPreview, bindTaskMediaChipPreview } from './compact-chip-link-preview';
import { bindExternalLinkContextMenu, openExternalUrl } from './external-link-actions';
import { showLocationMapPreview } from './location-map-preview';
import { resolveTaskStatusIconColor } from '../core/task-color-source';
import { operonEditorSurfaceScopeFacet } from './editor-augmentation-scope';
import {
	bindAdaptiveIconOnlyExpansion,
	bindIconOnlyChipPreview,
	closeIconOnlyChipPreview,
	isIconOnlyChipExpansionSuppressed,
	openIconOnlyChipPreview,
	shouldOpenIconOnlyChipPreview,
} from './icon-only-chip-preview';
import { t } from '../core/i18n';
import { resolveSubtaskChipKinds, resolveSubtaskActionIconForKind, resolveSubtaskActionLabelKeyForKind } from '../core/subtask-action';
import type { InlineRepeatCompletionMode } from '../storage/repeat-series-store';
import { openTaskFieldPicker } from './task-field-picker-dispatch';
import { getCustomFieldMapping, isProjectedCustomFieldType } from './custom-field-surfaces';
import { cleanupOperonRenderRoot } from './render-root-cleanup';
import { createTaskNoteActionButton, showTaskNotePopover } from './task-note-action';
import {
	findCompactMarkdownUnderlineTokens,
	isCompactMarkdownUnderlineTokenActive,
} from './compact-markdown-underline-extension';

export const operonIndexRefreshEffect = StateEffect.define<void>();
export const operonEditorCloseRefreshEffect = StateEffect.define<void>();

export interface LivePreviewCallbacks {
	app: App;
	getFilePath: (view: EditorView) => string;
	getIndexedTask: (id: string) => IndexedTask | undefined;
	getAllTasks: () => IndexedTask[];
	openEditor: (task: ParsedTask, view: EditorView) => void;
	onBlockedTaskAction?: (task: ParsedTask) => void;
	cycleStatus: (task: ParsedTask, view: EditorView) => void;
	getPipelines: () => Pipeline[];
	getPriorities: () => PriorityDefinition[];
	getSettings: () => OperonSettings;
	updateField: (operonId: string, key: string, value: string, restoreCursor?: LivePreviewCursorRestoreRequest) => void | boolean | Promise<void | boolean>;
	onContextualAction?: ContextualMenuActionHandler;
	isTaskPinned?: (taskId: string) => boolean;
	hasSubtasks?: (taskId: string) => boolean;
	isTaskTracking?: (taskId: string) => boolean;
	toggleTimer?: (taskId: string) => void | Promise<void>;
	requestSubtask?: (operonId: string, requestedKind?: 'inline') => void | Promise<void>;
	updateFields?: (operonId: string, payload: Record<string, string>, restoreCursor?: LivePreviewCursorRestoreRequest) => void | boolean | Promise<void | boolean>;
	updateSubtasks?: (operonId: string, subtaskIds: string[]) => void;
	updateDependencyField?: (operonId: string, field: 'blocking' | 'blockedBy', value: string) => void;
	getRepeatSeriesInlineCompletionMode?: (repeatSeriesId: string) => InlineRepeatCompletionMode;
	updateRepeatSeriesInlineCompletionMode?: (operonId: string, mode: InlineRepeatCompletionMode) => void | Promise<void>;
	getRepeatSkipDates?: (repeatSeriesId: string) => string[];
	getProjectSerialDisplay?: (operonId: string, task?: IndexedTask) => ProjectSerialDisplay | null;
}

export function blockInvalidLivePreviewTaskAction(
	task: ParsedTask,
	callbacks: Pick<LivePreviewCallbacks, 'onBlockedTaskAction'>,
): boolean {
	if (isValidOperonId(task.operonId ?? '')) return false;
	callbacks.onBlockedTaskAction?.(task);
	return true;
}

export function bindInvalidLivePreviewTaskActions(
	root: HTMLElement,
	task: ParsedTask,
	callbacks: Pick<LivePreviewCallbacks, 'onBlockedTaskAction'>,
): void {
	if (isValidOperonId(task.operonId ?? '')) return;
	const block = (event: Event) => {
		if (event.type === 'keydown') {
			const key = (event as KeyboardEvent).key;
			if (key !== 'Enter' && key !== ' ') return;
		}
		event.preventDefault();
		event.stopImmediatePropagation();
		blockInvalidLivePreviewTaskAction(task, callbacks);
	};
	for (const event of ['click', 'auxclick', 'contextmenu', 'dragstart', 'keydown']) {
		root.addEventListener(event, block, true);
	}
}

export interface LivePreviewCursorRestoreRequest {
	filePath: string;
	lineNumber: number;
	ch: number;
	editorView?: EditorView;
	trackDescriptionEnd?: boolean;
}

const LIVE_PREVIEW_DIRECT_CHIP_DAY_PICKER_DATE_KEYS = new Set<string>([
	'dateStarted',
	'dateScheduled',
	'dateDue',
	'dateCompleted',
	'dateCancelled',
]);
const LIVE_PREVIEW_CHIP_HOVER_CLASS = 'is-operon-chip-hovered';

function getLivePreviewDirectChipManualDatePickerOptions(key: string, settings: OperonSettings): ManualDatePickerOptions | undefined {
	if (!LIVE_PREVIEW_DIRECT_CHIP_DAY_PICKER_DATE_KEYS.has(key)) return undefined;
	return {
		weekStart: settings.calendarWeekStart,
		showWeekNumbers: settings.calendarSidebarShowWeekNumbers,
	};
}

function getLivePreviewDescriptionEndCursor(
	task: ParsedTask,
	view: EditorView,
	callbacks: Pick<LivePreviewCallbacks, 'getFilePath'>,
): LivePreviewCursorRestoreRequest {
	return {
		filePath: callbacks.getFilePath(view) || task.filePath,
		lineNumber: task.lineNumber,
		ch: task.descriptionRange.to,
		editorView: view,
		trackDescriptionEnd: true,
	};
}

export function getLivePreviewCurrentFieldValues(
	task: ParsedTask,
	view: EditorView,
	callbacks: LivePreviewCallbacks,
): Readonly<Record<string, string | undefined>> {
	const operonId = task.operonId;
	if (operonId) {
		const hintedLineNumber = task.lineNumber + 1;
		if (hintedLineNumber >= 1 && hintedLineNumber <= view.state.doc.lines) {
			const hintedLine = view.state.doc.line(hintedLineNumber);
			const parsed = parseTaskLine(
				hintedLine.text,
				hintedLine.number - 1,
				callbacks.getFilePath(view),
				callbacks.getSettings().keyMappings,
			);
			if (parsed?.operonId === operonId) {
				return Object.fromEntries(parsed.fields.map(field => [field.key, field.value]));
			}
		}

		for (let lineNumber = 1; lineNumber <= view.state.doc.lines; lineNumber++) {
			if (lineNumber === hintedLineNumber) continue;
			const line = view.state.doc.line(lineNumber);
			if (!line.text.includes(operonId)) continue;
			const parsed = parseTaskLine(
				line.text,
				line.number - 1,
				callbacks.getFilePath(view),
				callbacks.getSettings().keyMappings,
			);
			if (parsed?.operonId === operonId) {
				return Object.fromEntries(parsed.fields.map(field => [field.key, field.value]));
			}
		}

		// Reminder mutations must be authorized by the current editor document.
		// Falling back to the index here can resurrect a stale item after the
		// inline task (or its operonId) changed without an index refresh.
		return {
			...Object.fromEntries(task.fields.map(field => [field.key, field.value])),
			reminderDatetimes: '',
			reminderRules: '',
		};
	}
	return Object.fromEntries(task.fields.map(field => [field.key, field.value]));
}

function snapshotLivePreviewAnchor(anchor: HTMLElement): DOMRect {
	const rect = anchor.getBoundingClientRect();
	const DOMRectCtor = (getOwnerWindow(anchor) as Window & { DOMRect?: typeof DOMRect }).DOMRect ?? DOMRect;
	return new DOMRectCtor(rect.left, rect.top, Math.max(rect.width, 1), Math.max(rect.height, 1));
}

function bindLivePreviewChipHoverState(element: HTMLElement): void {
	const addHover = () => element.classList.add(LIVE_PREVIEW_CHIP_HOVER_CLASS);
	const removeHover = () => element.classList.remove(LIVE_PREVIEW_CHIP_HOVER_CLASS);
	element.addEventListener('pointerenter', addHover);
	element.addEventListener('pointerleave', removeHover);
	element.addEventListener('mouseenter', addHover);
	element.addEventListener('mouseleave', removeHover);
	// Keyboard focus is styled by :focus-visible; pointer focus is not hover.
}

export class TaskIconWidget extends WidgetType {
	private readonly renderSignature: string;
	private static readonly owners = new WeakMap<HTMLElement, TaskIconWidget>();

	constructor(
		private readonly task: ParsedTask,
		private readonly indexedTask: IndexedTask | undefined,
		private readonly callbacks: LivePreviewCallbacks,
		private readonly workflowStatusIdentityIndex: WorkflowStatusIdentityIndex,
	) {
		super();
		this.task = { ...task, fields: task.fields.map(field => ({ ...field })) };
		this.indexedTask = indexedTask ? { ...indexedTask, fieldValues: { ...indexedTask.fieldValues } } : undefined;
		this.renderSignature = buildTaskIconRenderSignature(
			task,
			indexedTask,
			callbacks,
			workflowStatusIdentityIndex,
		);
	}

	toDOM(view: EditorView): HTMLElement {
		const button = createOwnerElement(view.dom, 'span');
		button.className = 'operon-live-preview-status-icon';
		TaskIconWidget.owners.set(button, this);
		bindInvalidLivePreviewTaskActions(button, this.task, this.callbacks);
		button.setAttribute('role', 'button');
		button.setAttribute('tabindex', '0');

		const fieldValues = getFieldValues(this.task, this.indexedTask);
		const iconColor = resolveTaskStatusIconColor(
			fieldValues,
			this.callbacks.getSettings(),
			this.workflowStatusIdentityIndex,
		);
		if (iconColor) {
			button.style.setProperty('--operon-live-icon-color', iconColor);
		} else {
			button.style.removeProperty('--operon-live-icon-color');
		}

		const checkbox = this.indexedTask?.checkbox ?? this.task.checkbox;
		setAccessibleLabelWithoutTooltip(button, getTaskIconActionLabel(this.callbacks.getSettings(), checkbox));
		setIcon(button, resolveTaskDisplayIcon(
			this.callbacks.getSettings(),
			fieldValues,
			checkbox,
			this.workflowStatusIdentityIndex,
		));

		button.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.callbacks.cycleStatus(this.task, view);
		});
		button.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			event.stopPropagation();
			this.callbacks.cycleStatus(this.task, view);
		});
		const taskSource = this.indexedTask
			? {
				checkbox: this.indexedTask.checkbox,
				fieldValues: getFieldValues(this.task, this.indexedTask),
				sourceFormat: this.indexedTask.primary.format,
			}
			: this.task.operonId
				? {
					checkbox: this.task.checkbox,
					fieldValues: getFieldValues(this.task, this.indexedTask),
					sourceFormat: 'inline' as const,
				}
				: null;
		if (this.task.operonId && taskSource && this.callbacks.onContextualAction) {
			bindTaskContextualHoverMenu(button, {
				surface: 'livePreviewTask',
				taskId: this.task.operonId,
				getTask: () => ({ checkbox: this.indexedTask?.checkbox ?? this.task.checkbox, fieldValues: getFieldValues(this.task, this.indexedTask), sourceFormat: this.indexedTask?.primary.format ?? 'inline' }),
				getSettings: this.callbacks.getSettings,
				onAction: (...args) => {
					if (blockInvalidLivePreviewTaskAction(this.task, this.callbacks)) return;
					return this.callbacks.onContextualAction?.(...args);
				},
				isPinned: this.callbacks.isTaskPinned ? () => this.callbacks.isTaskPinned?.(this.task.operonId!) === true : undefined,
				isTracking: () => this.callbacks.isTaskTracking?.(this.task.operonId!) === true,
				hasSubtasks: this.callbacks.hasSubtasks ? () => this.callbacks.hasSubtasks?.(this.task.operonId!) === true : undefined,
			});
		}

		return button;
	}

	destroy(dom: HTMLElement): void {
		cleanupOperonRenderRoot(dom);
	}

	updateDOM(dom: HTMLElement): boolean {
		const previous = TaskIconWidget.owners.get(dom);
		if (!previous || !this.task.operonId || previous.task.operonId !== this.task.operonId
			|| previous.task.filePath !== this.task.filePath || Boolean(previous.indexedTask) !== Boolean(this.indexedTask)) return false;
		Object.assign(previous.task, this.task);
		if (previous.indexedTask && this.indexedTask) Object.assign(previous.indexedTask, this.indexedTask);
		Object.assign(this, { task: previous.task, indexedTask: previous.indexedTask });
		if (previous.renderSignature !== this.renderSignature) {
			const fields = getFieldValues(this.task, this.indexedTask);
			const checkbox = this.indexedTask?.checkbox ?? this.task.checkbox;
			const color = resolveTaskStatusIconColor(fields, this.callbacks.getSettings(), this.workflowStatusIdentityIndex);
			if (color) dom.style.setProperty('--operon-live-icon-color', color);
			else dom.style.removeProperty('--operon-live-icon-color');
			dom.replaceChildren();
			setIcon(dom, resolveTaskDisplayIcon(this.callbacks.getSettings(), fields, checkbox, this.workflowStatusIdentityIndex));
			setAccessibleLabelWithoutTooltip(dom, getTaskIconActionLabel(this.callbacks.getSettings(), checkbox));
		}
		TaskIconWidget.owners.set(dom, this);
		return true;
	}

	eq(_other: TaskIconWidget): boolean { return false; }
}

export class MetadataTailWidget extends WidgetType {
	private readonly pinnedSnapshot: boolean;
	private readonly trackingSnapshot: boolean;
	private readonly renderSignature: string;
	private static readonly owners = new WeakMap<HTMLElement, MetadataTailWidget>();

	constructor(
		private readonly task: ParsedTask,
		private readonly indexedTask: IndexedTask | undefined,
		private readonly callbacks: LivePreviewCallbacks,
		private readonly pipelines: Pipeline[],
		private readonly workflowStatusIdentityIndex: WorkflowStatusIdentityIndex,
		private readonly revealSource: () => void,
		private renderContext: CompactTaskRenderContext | undefined = createCompactTaskRenderContext(callbacks.getAllTasks),
		settingsSignature = buildMetadataTailSettingsSignature(callbacks.getSettings()),
	) {
		super();
		this.task = { ...task, fields: task.fields.map(field => ({ ...field })) };
		this.indexedTask = indexedTask ? { ...indexedTask, fieldValues: { ...indexedTask.fieldValues } } : undefined;
		const operonId = task.operonId ?? '';
		this.pinnedSnapshot = operonId ? callbacks.isTaskPinned?.(operonId) === true : false;
		this.trackingSnapshot = operonId ? callbacks.isTaskTracking?.(operonId) === true : false;
		this.renderSignature = buildMetadataTailRenderSignature(
			task,
			indexedTask,
			callbacks,
			false,
			false,
			workflowStatusIdentityIndex,
			this.renderContext,
			settingsSignature,
		);
	}

	get lineBreaks(): number {
		return 1;
	}

	toDOM(view: EditorView): HTMLElement {
		const wrapper = createOwnerElement(view.dom, 'span');
		wrapper.className = 'operon-live-preview-tail';
		MetadataTailWidget.owners.set(wrapper, this);
		bindInvalidLivePreviewTaskActions(wrapper, this.task, this.callbacks);
		const breakEl = createOwnerElement(wrapper, 'br');
		wrapper.appendChild(breakEl);
		const tailWrap = createOwnerElement(wrapper, 'span');
		tailWrap.className = 'operon-live-preview-tail-wrap operon-task-chip-surface';
		if (Platform.isDesktopApp) bindDescendantFocusVisible(tailWrap);
		const row = createOwnerElement(tailWrap, 'span');
		row.className = 'operon-live-preview-tail-row';
		const actions = createOwnerElement(tailWrap, 'span');
		actions.className = 'operon-live-preview-tail-actions';
		tailWrap.appendChild(row);
		tailWrap.appendChild(actions);
		wrapper.appendChild(tailWrap);
		const moveCaretToDescriptionEnd = () => {
			const line = view.state.doc.line(this.task.lineNumber + 1);
			const anchor = line.from + this.task.descriptionRange.to;
			view.dispatch({
				selection: { anchor },
				scrollIntoView: true,
			});
			view.focus();
		};

		const redirectIfBlank = (event: MouseEvent) => {
			if (event.target !== wrapper && event.target !== tailWrap && event.target !== row && event.target !== actions) return;
			event.preventDefault();
			event.stopPropagation();
			moveCaretToDescriptionEnd();
		};
		wrapper.addEventListener('mousedown', redirectIfBlank);
		tailWrap.addEventListener('mousedown', redirectIfBlank);
		row.addEventListener('mousedown', redirectIfBlank);
		actions.addEventListener('mousedown', redirectIfBlank);

		const fieldValues = getFieldValues(this.task, this.indexedTask);
		const operonId = this.task.operonId;
		const renderContext = this.renderContext ??= createCompactTaskRenderContext(this.callbacks.getAllTasks);
		const tasks = renderContext.tasks;
		const taskColor = normalizeTaskColor(fieldValues['taskColor']);
		if (taskColor) tailWrap.setCssProps({
			'--operon-live-hover-border': taskColor,
			'--operon-task-chip-hover-accent': taskColor,
		});
		const terminalVisualState = resolveTerminalVisualState(
			this.task,
			fieldValues,
			this.pipelines,
			this.workflowStatusIdentityIndex,
		);
		if (terminalVisualState === 'done') {
			tailWrap.classList.add('is-done');
		} else if (terminalVisualState === 'cancelled') {
			tailWrap.classList.add('is-cancelled');
		}

		const settings = this.callbacks.getSettings();
		const projectSerialDisplay = operonId ? this.callbacks.getProjectSerialDisplay?.(operonId) ?? null : null;

		const locationResolver = shouldResolveLocationCompactChips(settings)
			? getLocationPlaceIndex(this.callbacks.app, settings).resolve
			: undefined;
		const entries = buildInlineTaskCompactChipEntries(
			fieldValues,
			this.indexedTask?.tags ?? this.task.tags,
			settings,
			tasks,
			undefined,
			locationResolver,
			{
				app: this.callbacks.app,
				task: this.indexedTask, projectSerialDisplay,
				repeatSkipDateResolver: this.callbacks.getRepeatSkipDates,
				workflowStatusIdentityIndex: this.workflowStatusIdentityIndex,
				taskLookup: renderContext.taskLookup,
			},
		);
		for (const entry of entries) {
			const chip = createInlineTaskCompactChipElement(entry, 'operon-task-chip', { owner: row });
		bindAssigneeChipImage(chip, entry, this.callbacks.app, this.callbacks.getFilePath(view) || this.task.filePath, settings.assigneeImageProperty);
			applyLivePreviewChipVisualStyles(
				chip,
				entry,
				fieldValues,
				taskColor,
				this.callbacks,
				this.pipelines,
				this.workflowStatusIdentityIndex,
			);
			bindLivePreviewChipHoverState(chip);
			if (entry.iconOnly) {
				bindAdaptiveIconOnlyExpansion(chip, entry.label, taskColor ?? null, {
					showTooltip: !isCompactTaskMediaChipKey(entry.key),
				});
				if (entry.externalUrl) {
					bindExternalLinkContextMenu(chip, entry.externalUrl, entry.externalRawValue);
				}
				if (entry.tooltipContent) {
					bindOperonHoverTooltip(chip, {
						title: entry.tooltipTitle ?? t('taskEditor', 'details'),
						content: entry.tooltipContent,
						taskColor,
						shouldOpen: () => isIconOnlyChipExpansionSuppressed(chip),
					});
				}
				if (entry.interactive) {
					attachLivePreviewChipAction(
						chip,
						entry,
						view,
						fieldValues,
						taskColor,
						this.callbacks,
						this.indexedTask?.tags ?? this.task.tags,
						this.task,
						() => closeIconOnlyChipPreview(chip),
					);
				} else {
					if (entry.key !== 'taskInfo.projectSerial') bindIconOnlyChipPreview(chip);
				}
				const previewLinkTarget = entry.previewLinkTarget ?? entry.linkTarget;
				if (isCompactTaskMediaChipKey(entry.key)) {
					bindTaskMediaChipPreview(this.callbacks.app, chip, {
						localLinkTarget: previewLinkTarget,
						externalUrl: entry.externalUrl,
						label: entry.ariaLabel ?? entry.label,
						sourcePath: this.callbacks.getFilePath(view),
					});
				} else if (previewLinkTarget) {
					bindCompactChipLinkPreview(this.callbacks.app, chip, previewLinkTarget, this.callbacks.getFilePath(view));
				}
				identifyInlineTaskPart(chip, `${entry.key}:${entry.linkTarget ?? entry.label}`, JSON.stringify([entry, taskColor, chip.style.cssText]));
				row.appendChild(chip);
				continue;
			}
			if (entry.interactive) {
				attachLivePreviewChipAction(
					chip,
					entry,
					view,
					fieldValues,
					taskColor,
					this.callbacks,
					this.indexedTask?.tags ?? this.task.tags,
					this.task,
				);
			}

			if (isTaskInfoChipKey(entry.key) || entry.tooltipContent) {
				bindOperonHoverTooltip(chip, {
					title: isTaskInfoChipKey(entry.key) ? entry.tooltipTitle : entry.tooltipTitle ?? t('taskEditor', 'details'),
					content: entry.tooltipContent,
					taskColor,
				});
			}
			const chipNode = chip;
			if (entry.externalUrl) {
				bindExternalLinkContextMenu(chip, entry.externalUrl, entry.externalRawValue);
			}
			const previewLinkTarget = entry.previewLinkTarget ?? entry.linkTarget;
			if (isCompactTaskMediaChipKey(entry.key)) {
				bindTaskMediaChipPreview(this.callbacks.app, chip, {
					localLinkTarget: previewLinkTarget,
					externalUrl: entry.externalUrl,
					label: entry.ariaLabel ?? entry.label,
					sourcePath: this.callbacks.getFilePath(view),
				});
			} else if (previewLinkTarget) {
				bindCompactChipLinkPreview(this.callbacks.app, chip, previewLinkTarget, this.callbacks.getFilePath(view));
			}
			identifyInlineTaskPart(chipNode, `${entry.key}:${entry.linkTarget ?? entry.label}`, JSON.stringify([entry, taskColor, chip.style.cssText]));
			row.appendChild(chipNode);
		}

		const isTerminal = terminalVisualState !== null;
		if (!isTerminal && operonId && this.callbacks.requestSubtask && this.callbacks.getSettings().inlineTaskShowSubtaskAction) {
			for (const kind of resolveSubtaskChipKinds(this.indexedTask)) {
				const subtaskLabel = t('buttons', resolveSubtaskActionLabelKeyForKind(kind));
				const subtaskButton = createOwnerElement(actions, 'button');
				subtaskButton.type = 'button';
				subtaskButton.className = 'operon-live-preview-edit operon-live-preview-action operon-task-chip-action';
				setIcon(subtaskButton, resolveSubtaskActionIconForKind(kind));
				setAccessibleLabelWithoutTooltip(subtaskButton, subtaskLabel);
				bindOperonHoverTooltip(subtaskButton, {
					content: subtaskLabel,
					taskColor,
				});
				if (taskColor) subtaskButton.setCssProps({
					'--operon-live-hover-border': taskColor,
					'--operon-task-chip-hover-accent': taskColor,
				});
				bindLivePreviewChipHoverState(subtaskButton);
				subtaskButton.addEventListener('mousedown', event => { event.preventDefault(); event.stopPropagation(); });
				subtaskButton.addEventListener('click', (event) => {
					event.preventDefault();
					event.stopPropagation();
					void this.callbacks.requestSubtask?.(operonId, kind === 'inline' ? 'inline' : undefined);
				});
				identifyInlineTaskPart(subtaskButton, kind === resolveSubtaskChipKinds(this.indexedTask)[0] ? 'subtask' : 'subtask-inline', subtaskButton.outerHTML.replace(/operon-accessible-label-\d+/g, 'operon-accessible-label'));
				actions.appendChild(subtaskButton);
			}
		}

		if (!isTerminal && operonId && this.callbacks.onContextualAction && this.callbacks.getSettings().inlineTaskShowPinAction) {
			const isPinned = this.pinnedSnapshot;
			const pinButton = createOwnerElement(actions, 'button');
			pinButton.type = 'button';
			pinButton.dataset.inlineAction = 'pin';
			pinButton.className = 'operon-live-preview-edit operon-live-preview-action operon-task-chip-action';
			if (isPinned) pinButton.classList.add('is-active');
			const pinLabel = t('contextMenu', isPinned ? 'unpinTask' : 'pinTask');
			bindOperonHoverTooltip(pinButton, {
				content: pinLabel,
				taskColor,
			});
			setIcon(pinButton, isPinned ? 'pin-off' : 'pin');
			setAccessibleLabelWithoutTooltip(pinButton, pinLabel);
			if (taskColor) pinButton.setCssProps({
				'--operon-live-hover-border': taskColor,
				'--operon-task-chip-hover-accent': taskColor,
			});
			bindLivePreviewChipHoverState(pinButton);
			pinButton.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				void this.callbacks.onContextualAction?.(operonId, 'pinToggle');
			});
			identifyInlineTaskPart(pinButton, 'pin', pinButton.outerHTML.replace(/operon-accessible-label-\d+/g, 'operon-accessible-label'));
		actions.appendChild(pinButton);
		}

		if (!isTerminal && operonId && this.callbacks.toggleTimer && this.callbacks.getSettings().inlineTaskShowPlayAction && (this.indexedTask?.checkbox ?? this.task.checkbox) === 'open') {
			const isTracking = this.trackingSnapshot;
			const playButton = createOwnerElement(actions, 'button');
			playButton.type = 'button';
			playButton.className = 'operon-live-preview-edit operon-live-preview-action operon-task-chip-action operon-task-timer-action';
			if (isTracking) playButton.classList.add('is-active');
			setIcon(playButton, isTracking ? 'square' : 'play');
			const timerLabel = t('tooltips', isTracking ? 'stopTimer' : 'startTimer');
			setAccessibleLabelWithoutTooltip(playButton, timerLabel);
			bindOperonHoverTooltip(playButton, {
				content: timerLabel,
				taskColor,
			});
			if (taskColor) playButton.setCssProps({
				'--operon-live-hover-border': taskColor,
				'--operon-task-chip-hover-accent': taskColor,
			});
			bindLivePreviewChipHoverState(playButton);
			playButton.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				void this.callbacks.toggleTimer?.(operonId);
			});
			identifyInlineTaskPart(playButton, 'timer', playButton.outerHTML.replace(/operon-accessible-label-\d+/g, 'operon-accessible-label'));
		actions.appendChild(playButton);
		}

		let noteAction: HTMLElement | null = null;
		const rawNoteValue = fieldValues['note'] ?? '';
		const noteValue = rawNoteValue.trim();
		if (operonId && settings.inlineTaskShowNoteAction && (!isTerminal || noteValue)) {
			const restoreCursor = () => getLivePreviewDescriptionEndCursor(this.task, view, this.callbacks);
			const noteButton = createTaskNoteActionButton({
				owner: actions,
				noteValue,
				icon: getConfiguredKeyMappingIcon('note', settings.keyMappings) || 'notebook-pen',
				label: t('taskEditor', noteValue ? 'editNote' : 'addNote'),
				tooltipTitle: t('taskEditor', 'notes'),
				taskColor,
				classNames: 'operon-live-preview-note-action',
				onActivate: (anchor) => {
					showTaskNotePopover({
						app: this.callbacks.app,
						anchor,
						operonId,
						sourcePath: this.callbacks.getFilePath(view) || this.task.filePath,
						lifecycleOwner: view.dom,
						initialValue: rawNoteValue,
						taskDescription: this.indexedTask?.description ?? this.task.description,
						taskColor,
						onCommit: value => this.callbacks.updateField(operonId, 'note', value, restoreCursor()),
						onFocusReturn: () => view.focus(),
					});
				},
			});
			bindLivePreviewChipHoverState(noteButton);
			identifyInlineTaskPart(noteButton, 'note', JSON.stringify([rawNoteValue, taskColor, settings.language, noteButton.outerHTML.replace(/operon-accessible-label-\d+/g, 'operon-accessible-label')]));
			noteAction = noteButton;
			actions.appendChild(noteButton);
		}

		if (Platform.isDesktopApp && operonId && settings.inlineTaskShowSourceAction) {
   const sourceButton = createTaskSourceActionButton({ app: this.callbacks.app, owner: actions,
    getSettings: this.callbacks.getSettings, getTask: () => this.callbacks.getIndexedTask(operonId),
    taskColor, className: 'operon-live-preview-edit operon-live-preview-action operon-task-chip-action',
   });
   bindLivePreviewChipHoverState(sourceButton);
   identifyInlineTaskPart(sourceButton, 'source', sourceButton.outerHTML.replace(/operon-accessible-label-\d+/g, 'operon-accessible-label'));
   actions.insertBefore(sourceButton, noteAction);
  }

		const editButton = createOwnerElement(actions, 'button');
		editButton.type = 'button';
		editButton.className = 'operon-live-preview-edit operon-task-chip-action';
		setIcon(editButton, 'settings-2');
		const editLabel = t('tooltips', 'editTask');
		setAccessibleLabelWithoutTooltip(editButton, editLabel);
		bindOperonHoverTooltip(editButton, {
			content: editLabel,
			taskColor,
		});
		if (taskColor) editButton.setCssProps({
			'--operon-live-hover-border': taskColor,
			'--operon-task-chip-hover-accent': taskColor,
		});
		bindLivePreviewChipHoverState(editButton);
		editButton.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.callbacks.openEditor(this.task, view);
		});
		identifyInlineTaskPart(editButton, 'edit', editButton.outerHTML.replace(/operon-accessible-label-\d+/g, 'operon-accessible-label'));
		actions.appendChild(editButton);

		rememberInlineTaskDom(wrapper);
		return wrapper;
	}

	destroy(dom: HTMLElement): void {
		this.renderContext = undefined;
		const owner = MetadataTailWidget.owners.get(dom);
		if (owner) owner.renderContext = undefined;
		cleanupOperonRenderRoot(dom);
	}

	updateDOM(dom: HTMLElement, view: EditorView): boolean {
		const previous = MetadataTailWidget.owners.get(dom);
		if (!previous || !this.task.operonId || previous.task.operonId !== this.task.operonId
			|| previous.task.filePath !== this.task.filePath
			|| Boolean(previous.indexedTask) !== Boolean(this.indexedTask)) return false;
		Object.assign(previous.task, this.task);
		if (previous.indexedTask && this.indexedTask) {
			const values = previous.indexedTask.fieldValues;
			for (const key of Object.keys(values)) delete values[key];
			Object.assign(values, this.indexedTask.fieldValues);
			Object.assign(previous.indexedTask, this.indexedTask, { fieldValues: values });
		}
		if (previous.renderSignature !== this.renderSignature) {
			Object.assign(this, { task: previous.task, indexedTask: previous.indexedTask });
			const fresh = this.toDOM(view);
			reconcileInlineTaskDom(dom, fresh);
			MetadataTailWidget.owners.set(dom, this);
			if (previous !== this) previous.renderContext = undefined;
			return true;
		}
		const updateAction = (selector: string, active: boolean, icon: string, label: string): void => {
			const button = dom.querySelector<HTMLElement>(selector);
			if (!button || button.classList.contains('is-active') === active) return;
			button.classList.toggle('is-active', active);
			setIcon(button, icon);
			setAccessibleLabelWithoutTooltip(button, label);
			cleanupOperonHoverTooltips(button);
			bindOperonHoverTooltip(button, { content: label, taskColor: normalizeTaskColor(getFieldValues(this.task, this.indexedTask)['taskColor']) });
			identifyInlineTaskPart(button, selector === '.operon-task-timer-action' ? 'timer' : 'pin', button.outerHTML.replace(/operon-accessible-label-\d+/g, 'operon-accessible-label'));
		};
		updateAction('.operon-task-timer-action', this.trackingSnapshot, this.trackingSnapshot ? 'square' : 'play', t('tooltips', this.trackingSnapshot ? 'stopTimer' : 'startTimer'));
		updateAction('[data-inline-action="pin"]', this.pinnedSnapshot, this.pinnedSnapshot ? 'pin-off' : 'pin', t('contextMenu', this.pinnedSnapshot ? 'unpinTask' : 'pinTask'));
		// Retained handlers may own old widgets; only current decorations need the full render snapshot.
		if (previous !== this) previous.renderContext = undefined;
		return true;
	}

	eq(_other: MetadataTailWidget): boolean {
		// Always let updateDOM refresh the model used by retained event handlers.
		return false;
	}
}

export function operonLivePreviewConcealExtension(callbacks: LivePreviewCallbacks): Extension {
	const underlineMark = Decoration.mark({ class: 'operon-compact-markdown-underline' });
	const hiddenUnderlineMarker = Decoration.replace({});
	const sourceContextEffect = StateEffect.define<string>();

	function stateFilePath(state: EditorState): string | undefined {
		return state.field(editorInfoField, false)?.file?.path;
	}

	function isLivePreview(state: EditorState): boolean {
		return state.facet(operonEditorSurfaceScopeFacet) === 'document'
			&& state.field(editorLivePreviewField, false) === true;
	}

	function buildDecorations(state: EditorState, filePath: string, suppressSelectionReveal: boolean): DecorationSet {
		if (!isLivePreview(state)) return Decoration.none;
		const decorations = new RangeSetBuilder<Decoration>();
		const pipelines = callbacks.getPipelines();
		const workflowStatusIdentityIndex = buildWorkflowStatusIdentityIndex(pipelines);
		const renderContext = createCompactTaskRenderContext(callbacks.getAllTasks);
		let settingsSignature: string | undefined;

		let inFencedCodeBlock = false;
		for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber++) {
			const line = state.doc.line(lineNumber);
			if (isMarkdownFenceLine(line.text)) {
				inFencedCodeBlock = !inFencedCodeBlock;
				continue;
			}
			if (inFencedCodeBlock) continue;
			if (!line.text.includes('- [')) continue;

			const parsed = parseTaskLine(line.text, lineNumber - 1, filePath, callbacks.getSettings().keyMappings);
			if (!parsed || (!parsed.operonId && parsed.fields.length === 0)) continue;

			const indexed = parsed.operonId ? callbacks.getIndexedTask(parsed.operonId) : undefined;
			const fieldValues = getFieldValues(parsed, indexed);
			const terminalVisualState = resolveTerminalVisualState(
				parsed,
				fieldValues,
				pipelines,
				workflowStatusIdentityIndex,
			);
			const selectionHead = state.selection.main.head - line.from;
			const isEditingTail = !!parsed.metadataTailRange
				&& selectionHead >= parsed.metadataTailRange.from
				&& selectionHead <= parsed.metadataTailRange.to;
			const revealTail = !!parsed.metadataTailRange && isEditingTail && !suppressSelectionReveal;

			if (terminalVisualState) {
				decorations.add(
					line.from,
					line.from,
					Decoration.line({
						class: terminalVisualState === 'done'
							? 'operon-inline-row-done'
							: 'operon-inline-row-cancelled',
					}),
				);
			}

			if (parsed.checkboxRange.to > parsed.checkboxRange.from) {
				// Keep the native empty replacement: a zero-height widget breaks
				// coordinate lookup beside Obsidian list indent/fold decorations.
				const checkboxWidget = Decoration.replace({});
				decorations.add(line.from + parsed.checkboxRange.from, line.from + parsed.checkboxRange.to, checkboxWidget);
			}

			if (parsed.descriptionRange.from >= parsed.checkboxRange.to) {
				decorations.add(
					line.from + parsed.descriptionRange.from,
					line.from + parsed.descriptionRange.from,
					Decoration.widget({
						widget: new TaskIconWidget(
							parsed,
							indexed,
							callbacks,
							workflowStatusIdentityIndex,
						),
						side: -1,
					}),
				);
			}

			const description = line.text.slice(
				parsed.descriptionRange.from,
				parsed.descriptionRange.to,
			);
			for (const token of findCompactMarkdownUnderlineTokens(description)) {
				const absoluteToken = {
					from: line.from + parsed.descriptionRange.from + token.from,
					contentFrom: line.from + parsed.descriptionRange.from + token.contentFrom,
					contentTo: line.from + parsed.descriptionRange.from + token.contentTo,
					to: line.from + parsed.descriptionRange.from + token.to,
				};
				const active = isCompactMarkdownUnderlineTokenActive(
					absoluteToken,
					state.selection.ranges,
				);
				if (!active) {
					decorations.add(
						absoluteToken.from,
						absoluteToken.contentFrom,
						hiddenUnderlineMarker,
					);
				}
				decorations.add(
					absoluteToken.contentFrom,
					absoluteToken.contentTo,
					underlineMark,
				);
				if (!active) {
					decorations.add(
						absoluteToken.contentTo,
						absoluteToken.to,
						hiddenUnderlineMarker,
					);
				}
			}

			if (parsed.metadataTailRange && !revealTail) {
				const tailWidget = new MetadataTailWidget(
					parsed,
					indexed,
					callbacks,
					pipelines,
					workflowStatusIdentityIndex,
					() => {},
					renderContext,
					settingsSignature ??= buildMetadataTailSettingsSignature(callbacks.getSettings()),
				);

				decorations.add(
					line.from + parsed.metadataTailRange.from,
					line.from + parsed.metadataTailRange.to,
					Decoration.replace({ widget: tailWidget }),
				);
			}
		}
		return decorations.finish();
	}

	function getSelectionRevealSignature(state: EditorState, filePath: string): string {
		const head = state.selection.main.head;
		const line = state.doc.lineAt(head);
		const parsed = parseTaskLine(line.text, line.number - 1, filePath, callbacks.getSettings().keyMappings);
		const offset = head - line.from;
		const tailSignature = parsed?.metadataTailRange
			&& offset >= parsed.metadataTailRange.from
			&& offset <= parsed.metadataTailRange.to
			? `${parsed.operonId ?? line.number}:${parsed.metadataTailRange.from}:${parsed.metadataTailRange.to}`
			: '';
		return `${tailSignature}|${getUnderlineSelectionSignature(state, filePath)}`;
	}

	function getUnderlineSelectionSignature(state: EditorState, filePath: string): string {
		const signatures: string[] = [];
		for (const range of state.selection.ranges) {
			const firstLine = state.doc.lineAt(range.from).number;
			const lastLine = state.doc.lineAt(range.to).number;
			for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber++) {
				const line = state.doc.line(lineNumber);
				if (!line.text.includes('- [')) continue;
				const parsed = parseTaskLine(
					line.text,
					lineNumber - 1,
					filePath,
					callbacks.getSettings().keyMappings,
				);
				if (!parsed || (!parsed.operonId && parsed.fields.length === 0)) continue;
				const description = line.text.slice(
					parsed.descriptionRange.from,
					parsed.descriptionRange.to,
				);
				for (const token of findCompactMarkdownUnderlineTokens(description)) {
					const from = line.from + parsed.descriptionRange.from + token.from;
					const to = line.from + parsed.descriptionRange.from + token.to;
					const intersects = range.from === range.to
						? range.from >= from && range.from < to
						: range.from < to && range.to > from;
					if (intersects) signatures.push(`${lineNumber}:${token.from}:${token.to}`);
				}
			}
		}
		return signatures.join(',');
	}

	const field = StateField.define<{
		decorations: DecorationSet;
		filePath: string;
		fallbackPath: string;
		livePreview: boolean;
		selectionSignature: string;
	}>({
		create(state) {
			const filePath = stateFilePath(state) ?? '';
			return {
				decorations: buildDecorations(state, filePath, false),
				filePath,
				fallbackPath: '',
				livePreview: isLivePreview(state),
				selectionSignature: getSelectionRevealSignature(state, filePath),
			};
		},
		update(value, transaction) {
			let fallbackPath = value.fallbackPath;
			let refresh = false;
			let suppressSelectionReveal = false;
			for (const effect of transaction.effects) {
				if (effect.is(sourceContextEffect)) fallbackPath = effect.value;
				if (effect.is(operonIndexRefreshEffect)) refresh = true;
				if (effect.is(operonEditorCloseRefreshEffect)) suppressSelectionReveal = true;
			}
			const state = transaction.state;
			const filePath = stateFilePath(state) ?? fallbackPath;
			const livePreview = isLivePreview(state);
			const contextChanged = filePath !== value.filePath || livePreview !== value.livePreview;
			const selectionSignature = transaction.selection || transaction.docChanged || contextChanged || suppressSelectionReveal
				? getSelectionRevealSignature(state, filePath)
				: value.selectionSignature;
			if (!transaction.docChanged && !refresh && !suppressSelectionReveal && !contextChanged
				&& selectionSignature === value.selectionSignature && fallbackPath === value.fallbackPath) return value;
			return {
				decorations: buildDecorations(state, filePath, suppressSelectionReveal),
				filePath,
				fallbackPath,
				livePreview,
				selectionSignature,
			};
		},
		provide: field => EditorView.decorations.from(field, value => value.decorations),
	});

	// Legacy/embedded editors may expose their source only through the view registry.
	// Resolve the current view at delivery time, never replay a captured file or document.
	const contextBridge = ViewPlugin.fromClass(class {
		private pending = false;
		private destroyed = false;

		constructor(private readonly view: EditorView) {
			this.syncContext();
		}

		update(update: { state: EditorState; startState: EditorState }): void {
			if (update.state !== update.startState) this.syncContext();
		}

		private syncContext(): void {
			if (this.pending || stateFilePath(this.view.state) !== undefined
				|| this.view.state.facet(operonEditorSurfaceScopeFacet) !== 'document') return;
			this.pending = true;
			queueMicrotask(() => {
				this.pending = false;
				if (this.destroyed || stateFilePath(this.view.state) !== undefined) return;
				const value = this.view.state.field(field, false);
				if (!value || this.view.state.facet(operonEditorSurfaceScopeFacet) !== 'document') return;
				const path = callbacks.getFilePath(this.view);
				if (path !== value.fallbackPath) this.view.dispatch({ effects: sourceContextEffect.of(path) });
			});
		}

		destroy(): void {
			this.destroyed = true;
		}
	});
	const descriptionLinks = taskTextLinkEditorExtension(callbacks.app, (view, position) => {
  if (!isLivePreview(view.state)) return null;
  const line = view.state.doc.lineAt(position);
  const outsideFences = iterateMarkdownLinesOutsideFences(view.state.doc.toString(), true);
  let executable = false;
  for (const [number] of outsideFences) {if (number === line.number - 1) {executable = true; break;} if (number >= line.number) break;}
  if (!executable) return null;
  const path = callbacks.getFilePath(view);
  const task = parseTaskLine(line.text, line.number - 1, path, callbacks.getSettings().keyMappings);
  if (!task || (!task.operonId && task.fields.length === 0)) return null;
  return {from: line.from + task.descriptionRange.from, to: line.from + task.descriptionRange.to, sourcePath: path};
 });
 return [field, contextBridge, descriptionLinks];
}

function isMarkdownFenceLine(line: string): boolean {
	return /^\s*(?:`{3,}|~{3,})/.test(line);
}

function getFieldValues(task: ParsedTask, indexedTask: IndexedTask | undefined): Record<string, string> {
	if (indexedTask) return indexedTask.fieldValues;
	return Object.fromEntries(task.fields.map(field => [field.key, field.value]));
}

export function buildTaskIconRenderSignature(
	task: ParsedTask,
	indexedTask: IndexedTask | undefined,
	callbacks: LivePreviewCallbacks,
	workflowStatusIdentityIndex?: WorkflowStatusIdentityIndex,
): string {
	const fieldValues = getFieldValues(task, indexedTask);
	const checkbox = indexedTask?.checkbox ?? task.checkbox;
	return stableStringify({
		checkbox,
		actionLabel: getTaskIconActionLabel(callbacks.getSettings(), checkbox),
		iconName: resolveTaskDisplayIcon(
			callbacks.getSettings(),
			fieldValues,
			checkbox,
			workflowStatusIdentityIndex,
		),
		status: fieldValues['status'] ?? '',
		iconColor: resolveTaskStatusIconColor(
			fieldValues,
			callbacks.getSettings(),
			workflowStatusIdentityIndex,
		),
	});
}

export function buildMetadataTailRenderSignature(
	task: ParsedTask,
	indexedTask: IndexedTask | undefined,
	callbacks: LivePreviewCallbacks,
	pinnedSnapshot: boolean,
	trackingSnapshot: boolean,
	workflowStatusIdentityIndex?: WorkflowStatusIdentityIndex,
	renderContext?: CompactTaskRenderContext,
	settingsSignature = buildMetadataTailSettingsSignature(callbacks.getSettings()),
): string {
	const fieldValues = getFieldValues(task, indexedTask);
	const tags = indexedTask?.tags ?? task.tags;
	const settings = callbacks.getSettings();
	const tasks = renderContext?.tasks ?? callbacks.getAllTasks();
	const projectSerialDisplay = task.operonId ? callbacks.getProjectSerialDisplay?.(task.operonId) ?? null : null;
	const locationIndex = shouldResolveLocationCompactChips(settings)
		? getLocationPlaceIndex(callbacks.app, settings)
		: null;
	const locationResolver = locationIndex?.resolve;
	const entries = buildInlineTaskCompactChipEntries(fieldValues, tags, settings, tasks, undefined, locationResolver, {
		task: indexedTask, projectSerialDisplay,
		app: callbacks.app,
		repeatSkipDateResolver: callbacks.getRepeatSkipDates,
		workflowStatusIdentityIndex,
		taskLookup: renderContext?.taskLookup,
	})
		.map(entry => [
			entry.key,
			entry.label,
			entry.rawValue ?? '',
			entry.icon,
			entry.iconOnly,
			entry.interactive,
			entry.colorRole,
			entry.iconTone ?? '',
			entry.blockedByVisualState ?? '',
			entry.linkTarget ?? '',
			entry.previewLinkTarget ?? '',
			entry.externalUrl ?? '',
			entry.externalRawValue ?? '',
			entry.locationCoordinate ?? '',
			entry.locationMarkerIcon ?? '',
			entry.reminderItem?.fieldKey ?? '',
			entry.reminderItem?.index ?? '',
			entry.reminderItem?.rawValue ?? '',
			entry.reminderState ?? '',
			entry.ariaLabel ?? '',
			entry.locationMarkerColor ?? '',
			entry.taskColor ?? '',
			entry.tooltipTitle ?? '',
			entry.tooltipContent ?? '',
		]);

	return settingsSignature + stableStringify({
		checkbox: indexedTask?.checkbox ?? task.checkbox,
		fieldValues: Object.fromEntries(Object.entries(fieldValues).filter(([key]) => key !== 'datetimeModified' && key !== 'dateModified')),
		tags,
		entries,
		projectSerial: projectSerialDisplay ? {
			scopeId: projectSerialDisplay.scopeId,
			label: projectSerialDisplay.label,
			number: projectSerialDisplay.number,
		} : null,
		locationIndexSignature: locationIndex?.getSignature() ?? '',
		pinnedSnapshot,
		trackingSnapshot,
		language: settings.language,
		inlineTaskShowPlayAction: settings.inlineTaskShowPlayAction,
		inlineTaskShowPinAction: settings.inlineTaskShowPinAction,
		inlineTaskShowNoteAction: settings.inlineTaskShowNoteAction,
		inlineTaskShowSourceAction: settings.inlineTaskShowSourceAction,
		inlineTaskShowSubtaskAction: settings.inlineTaskShowSubtaskAction,
		noteIcon: getConfiguredKeyMappingIcon('note', settings.keyMappings) || 'notebook-pen',
	});
}

function buildMetadataTailSettingsSignature(settings: OperonSettings): string {
	return stableStringify({
		keyMappings: settings.keyMappings,
		pipelines: settings.pipelines,
		priorities: settings.priorities,
	});
}

function stableStringify(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
	const record = value as Record<string, unknown>;
	return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function lookupStatusColor(
	statusValue: string | undefined,
	pipelines: Pipeline[],
	workflowStatusIdentityIndex: WorkflowStatusIdentityIndex,
): string {
	if (!statusValue) return '#6b7280';
	return findStatusDef(pipelines, statusValue, workflowStatusIdentityIndex)?.color ?? '#6b7280';
}

function normalizeTaskColor(taskColor: string | undefined): string | null {
	if (!taskColor) return null;
	const trimmed = taskColor.trim();
	if (!trimmed) return null;
	return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
}

function resolveTerminalVisualState(
	task: ParsedTask,
	fieldValues: Record<string, string>,
	pipelines: Pipeline[],
	workflowStatusIdentityIndex: WorkflowStatusIdentityIndex,
): 'done' | 'cancelled' | null {
	const workflow = resolveWorkflowStatus(pipelines, fieldValues['status'], workflowStatusIdentityIndex);
	if (workflow) {
		if (workflow.checkbox === 'done') return 'done';
		if (workflow.checkbox === 'cancelled') return 'cancelled';
		return null;
	}
	if (task.checkbox === 'cancelled' || !!fieldValues['dateCancelled']?.trim()) {
		return 'cancelled';
	}
	if (task.checkbox === 'done' || !!fieldValues['dateCompleted']?.trim()) {
		return 'done';
	}
	return null;
}

function applyLivePreviewChipVisualStyles(
	chip: HTMLElement,
	entry: InlineTaskCompactChipEntry,
	fieldValues: Record<string, string>,
	taskColor: string | null,
	callbacks: LivePreviewCallbacks,
	pipelines: Pipeline[],
	workflowStatusIdentityIndex: WorkflowStatusIdentityIndex,
): void {
	const cssProps: Record<string, string> = {};
	const hoverColor = taskColor ?? entry.taskColor;
	if (hoverColor) {
		cssProps['--operon-live-hover-border'] = hoverColor;
		cssProps['--operon-task-chip-hover-accent'] = hoverColor;
	}
	if (entry.colorRole === 'priority') {
		const def = callbacks.getPriorities().find(priority => priority.label === fieldValues['priority']);
		if (def) cssProps['--operon-inline-chip-icon-color'] = def.color;
	}
	if (entry.colorRole === 'status') {
		cssProps['--operon-inline-chip-icon-color'] = lookupStatusColor(
			fieldValues['status'],
			pipelines,
			workflowStatusIdentityIndex,
		);
	}
	if (entry.key === 'location') {
		const locationIconColor = entry.locationMarkerColor ?? taskColor;
		if (locationIconColor) cssProps['--operon-inline-chip-icon-color'] = locationIconColor;
	}
	const dateToneColor = resolveTaskDateToneColor(entry.iconTone ?? 'default');
	if (dateToneColor) cssProps['--operon-inline-chip-icon-color'] = dateToneColor;
	const blockedByColor = resolveCompactBlockedByIconColor(entry);
	if (blockedByColor) cssProps['--operon-inline-chip-icon-color'] = blockedByColor;
	if (Object.keys(cssProps).length > 0) {
		chip.setCssProps(cssProps);
	}
}

function attachLivePreviewChipAction(
	chip: HTMLElement,
	entry: InlineTaskCompactChipEntry,
	view: EditorView,
	fieldValues: Record<string, string>,
	taskColor: string | null,
	callbacks: LivePreviewCallbacks,
	_tags: string[],
	task: ParsedTask,
	onCommit?: () => void,
): void {

 if (bindDesktopChipOpening(chip, entry, {
  app: callbacks.app, getSettings: callbacks.getSettings, getAllTasks: callbacks.getAllTasks,
  getTask: () => {
   const current = callbacks.getAllTasks().find(candidate => candidate.operonId === task.operonId);
   return current ? { ...current, fieldValues: Object.fromEntries(Object.entries(getLivePreviewCurrentFieldValues(task, view, callbacks)).filter((item): item is [string, string] => typeof item[1] === 'string')) } : null;
  },
  getTaskById: id => callbacks.getAllTasks().find(candidate => candidate.operonId === id),
  picker: current => ({ anchor: snapshotLivePreviewAnchor(chip), retainInputFocus: true,
   onCommit: payload => {
    const normalized = Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, Array.isArray(value) ? value.join('; ') : value]));
    const cursor = getLivePreviewDescriptionEndCursor(task, view, callbacks);
    if (callbacks.updateFields) void callbacks.updateFields(current.operonId, normalized, cursor);
    else for (const [key, value] of Object.entries(normalized)) void callbacks.updateField(current.operonId, key, value, cursor);
    onCommit?.();
   },
  }),
 })) return;
	if (entry.key === 'taskInfo.projectSerial') return;
	if (entry.key === 'taskInfo.source') {
		bindTaskInfoSourceAction(chip, () => { if (task.operonId) void callbacks.onContextualAction?.(task.operonId, 'jumpToSource'); }, callbacks.app, () => callbacks.getAllTasks().find(current => current.operonId === task.operonId));
		return;
	}

	let tagPickerOpen = false;
	let statusPickerOpen = false;
	if (entry.key === 'status') {
		chip.addEventListener('mousedown', event => {
			event.preventDefault();
			event.stopPropagation();
		});
	}
	chip.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		if (entry.key !== 'tags' && entry.key !== 'status' && entry.iconOnly && shouldOpenIconOnlyChipPreview(chip)) {
			openIconOnlyChipPreview(chip);
			return;
		}
		const operonId = task.operonId;
		if (!operonId) return;
		fieldValues = Object.fromEntries(Object.entries(getLivePreviewCurrentFieldValues(task, view, callbacks)).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
		const restoreCursor = () => getLivePreviewDescriptionEndCursor(task, view, callbacks);
		const pickerAnchor = snapshotLivePreviewAnchor(chip);
		const reminderItem = entry.reminderItem;
		if (reminderItem) {
			openTaskFieldPicker({
				app: callbacks.app,
				settings: callbacks.getSettings(),
				allTasks: callbacks.getAllTasks(),
				canonicalKey: reminderItem.fieldKey,
				anchor: pickerAnchor,
				currentFieldValues: fieldValues,
				getCurrentFieldValues: () => getLivePreviewCurrentFieldValues(task, view, callbacks),
				currentTags: task.tags,
				sourcePath: task.filePath,
				retainInputFocus: true,
				taskFormat: 'inline',
				reminderOperation: {
					kind: 'edit',
					item: { index: reminderItem.index, rawValue: reminderItem.rawValue },
				},
				onCommit: payload => {
					const value = payload[reminderItem.fieldKey];
					if (typeof value !== 'string') return;
					void callbacks.updateField(operonId, reminderItem.fieldKey, value, restoreCursor());
					onCommit?.();
				},
			});
			return;
		}
		switch (entry.key) {
			case 'status':
			case 'taskType':
				if (entry.key === 'status' && statusPickerOpen) return;
				if (entry.key === 'status') statusPickerOpen = true;
				openTaskFieldPicker({
					app: callbacks.app,
					settings: callbacks.getSettings(),
					allTasks: callbacks.getAllTasks(),
					canonicalKey: entry.key,
					onClose: () => { statusPickerOpen = false; },
					anchor: pickerAnchor,
					currentFieldValues: fieldValues,
					getCurrentFieldValues: () => getLivePreviewCurrentFieldValues(task, view, callbacks),
					currentTags: task.tags,
					sourcePath: task.filePath,
					retainInputFocus: true,
					taskFormat: 'inline',
					onCommit: payload => {
						const value = payload[entry.key];
						statusPickerOpen = false;
						if (typeof value !== 'string') return;
						void callbacks.updateField(operonId, entry.key, value, restoreCursor());
						onCommit?.();
					},
				});
				break;
			case 'location':
				if (entry.locationCoordinate) {
					showLocationMapPreview(
						callbacks.app,
						pickerAnchor,
						callbacks.getSettings(),
						entry.locationCoordinate,
						callbacks.getFilePath(view),
						entry.taskColor ?? null,
						entry.locationMarkerIcon ?? null,
						entry.locationMarkerColor ?? null,
						entry.linkTarget ?? null,
						task.description,
					);
					onCommit?.();
				}
				break;
			case 'priority':
				showPriorityPicker(pickerAnchor, {
					priorities: callbacks.getPriorities(),
						value: fieldValues['priority'],
						retainInputFocus: true,
						onSelect: next => {
							void callbacks.updateField(operonId, 'priority', next, restoreCursor());
							onCommit?.();
						},
						onClear: () => {
							void callbacks.updateField(operonId, 'priority', '', restoreCursor());
							onCommit?.();
						},
				});
				break;
			case 'dateStarted':
			case 'dateDue':
			case 'dateScheduled':
			case 'dateCompleted':
			case 'dateCancelled':
				showDatePicker(pickerAnchor, {
					app: callbacks.app,
						fieldKey: entry.key,
						value: fieldValues[entry.key],
						dateDisplayFormat: callbacks.getSettings().dateDisplayFormat,
						manualDatePicker: getLivePreviewDirectChipManualDatePickerOptions(entry.key, callbacks.getSettings()),
						onSelect: next => {
							void callbacks.updateField(operonId, entry.key, next, restoreCursor());
							onCommit?.();
						},
						canRemove: !!fieldValues[entry.key],
						onRemove: () => {
							void callbacks.updateField(operonId, entry.key, '', restoreCursor());
							onCommit?.();
						},
					retainInputFocus: true,
				});
				break;
			case 'assignees':
			case 'contexts':
			case 'parentTask':
			case 'blocking':
			case 'blockedBy':
				if (entry.linkTarget) {
					void callbacks.app.workspace.openLinkText(entry.linkTarget, callbacks.getFilePath(view), false);
					onCommit?.();
				}
				break;
			case 'tags':
				if (tagPickerOpen) return;
				tagPickerOpen = true;
				openTaskFieldPicker({
					app: callbacks.app,
					settings: callbacks.getSettings(),
					allTasks: callbacks.getAllTasks(),
					canonicalKey: 'tags',
					anchor: pickerAnchor,
					currentFieldValues: fieldValues,
					currentTags: callbacks.getAllTasks().find(candidate => candidate.operonId === operonId)?.tags ?? _tags,
					sourcePath: task.filePath,
					taskFormat: 'inline',
					closeListPickerOnSelect: true,
					retainInputFocus: true,
					onClose: () => { tagPickerOpen = false; },
					onCommit: payload => {
						if (!Array.isArray(payload.tags)) return;
						void callbacks.updateField(operonId, '_tags', payload.tags.join('; '), restoreCursor());
						onCommit?.();
					},
				});
				break;
			case 'links':
				openExternalUrl(entry.externalUrl);
				onCommit?.();
				break;
			case 'taskImage':
			case 'taskGallery':
				if (entry.linkTarget) {
					void callbacks.app.workspace.openLinkText(entry.linkTarget, callbacks.getFilePath(view), false);
					onCommit?.();
				} else if (entry.externalUrl) {
					openExternalUrl(entry.externalUrl);
					onCommit?.();
				}
				break;
			case 'estimate':
					showEstimatePicker(pickerAnchor, {
						value: fieldValues['estimate'],
						onSelect: next => {
							void callbacks.updateField(operonId, 'estimate', next, restoreCursor());
							onCommit?.();
						},
						canRemove: !!fieldValues['estimate'],
						onRemove: () => {
							void callbacks.updateField(operonId, 'estimate', '', restoreCursor());
							onCommit?.();
						},
				});
				break;
			case 'repeat': {
				const settings = callbacks.getSettings();
				openTaskFieldPicker({
					app: callbacks.app,
					settings,
					allTasks: callbacks.getAllTasks(),
					canonicalKey: 'repeat',
					anchor: pickerAnchor,
					currentFieldValues: fieldValues,
					currentTags: task.tags,
					sourcePath: task.filePath,
					retainInputFocus: true,
					taskFormat: 'inline',
					repeatInlineCompletionMode: callbacks.getRepeatSeriesInlineCompletionMode?.(fieldValues['repeatSeriesId'] ?? ''),
					onRepeatInlineCompletionModeChange: mode => {
						void callbacks.updateRepeatSeriesInlineCompletionMode?.(operonId, mode);
					},
					onCommit: payload => {
						const normalizedPayload = Object.fromEntries(
							Object.entries(payload).map(([key, value]) => [
								key,
								Array.isArray(value) ? value.join('; ') : value,
							]),
						);
						if (callbacks.updateFields) {
							void callbacks.updateFields(operonId, normalizedPayload, restoreCursor());
						} else {
							for (const [key, value] of Object.entries(normalizedPayload)) {
								void callbacks.updateField(operonId, key, value, restoreCursor());
							}
						}
						onCommit?.();
					},
				});
				break;
			}
			case 'duration':
			case 'totalDuration':
			case 'totalEstimate':
				break;
			default: {
				const settings = callbacks.getSettings();
				const customMapping = getCustomFieldMapping(settings.keyMappings, entry.key);
				if (!customMapping || !isProjectedCustomFieldType(customMapping)) return;
				if (entry.linkTarget) {
					void callbacks.app.workspace.openLinkText(entry.linkTarget, callbacks.getFilePath(view), false);
					onCommit?.();
					return;
				}
				openTaskFieldPicker({
					app: callbacks.app,
					settings,
					allTasks: callbacks.getAllTasks(),
					canonicalKey: entry.key,
					anchor: pickerAnchor,
					currentFieldValues: fieldValues,
					currentTags: task.tags,
					sourcePath: task.filePath,
					retainInputFocus: true,
					taskFormat: 'inline',
					onCommit: payload => {
						const normalizedPayload = Object.fromEntries(
							Object.entries(payload).map(([key, value]) => [
								key,
								Array.isArray(value) ? value.join('; ') : value,
							]),
						);
						if (callbacks.updateFields) {
							void callbacks.updateFields(operonId, normalizedPayload, restoreCursor());
						} else {
							for (const [key, value] of Object.entries(normalizedPayload)) {
								void callbacks.updateField(operonId, key, value, restoreCursor());
							}
						}
						onCommit?.();
					},
				});
				break;
			}
		}
	});
	if (taskColor) chip.setCssProps({ '--operon-live-hover-border': taskColor });
}
