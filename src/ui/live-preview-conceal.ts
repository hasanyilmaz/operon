import {
	Decoration,
	DecorationSet,
	EditorView,
	ViewPlugin,
	ViewUpdate,
	WidgetType,
} from '@codemirror/view';
import { Extension, RangeSetBuilder, StateEffect } from '@codemirror/state';
import { App, editorLivePreviewField, setIcon } from 'obsidian';
import { createOwnerElement, getOwnerWindow } from '../core/dom-compat';
import { parseTaskLine } from '../core/parser';
import { IndexedTask, ParsedTask } from '../types/fields';
import { OperonSettings, resolveTaskDisplayIcon } from '../types/settings';
import { Pipeline, parseStatusValue, resolveWorkflowStatus } from '../types/pipeline';
import { PriorityDefinition } from '../types/priority';
import { showDatePicker } from './field-pickers/date-picker';
import { showPriorityPicker } from './field-pickers/priority-picker';
import { showEstimatePicker } from './field-pickers/estimate-picker';
import { closeFloatingPanelsForRoot } from './field-pickers/common';
import { showLivePreviewFieldMenu } from './live-preview-field-menu';
import {
	buildInlineTaskCompactChipEntries,
	createInlineTaskCompactChipElement,
	getInlineTaskCompactHiddenCount,
	getInlineTaskCompactVisibleKeys,
	InlineTaskCompactChipEntry,
} from './compact-task-layout';
import { bindOperonHoverTooltip, createOperonHoverIndicator, wrapWithOperonHoverTooltip } from './operon-hover-tooltip';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { bindTaskContextualHoverMenu } from './contextual-hover-menu';
import type { ContextualMenuActionId } from '../core/contextual-menu-engine';
import { getConfiguredKeyMappingIcon } from '../core/key-mapping-icons';
import { openObsidianTagSearch } from './tag-search';
import { bindCompactChipLinkPreview } from './compact-chip-link-preview';
import { bindExternalLinkContextMenu, openExternalUrl } from './external-link-actions';
import {
	bindAdaptiveIconOnlyExpansion,
	bindIconOnlyChipPreview,
	closeIconOnlyChipPreview,
	closeIconOnlyChipPreviewsForRoot,
	openIconOnlyChipPreview,
	shouldOpenIconOnlyChipPreview,
} from './icon-only-chip-preview';
import { t } from '../core/i18n';
import { resolveSubtaskActionIcon, resolveSubtaskActionLabelKey } from '../core/subtask-action';
import type { InlineRepeatCompletionMode } from '../storage/repeat-series-store';

export const operonIndexRefreshEffect = StateEffect.define<void>();
export const operonEditorCloseRefreshEffect = StateEffect.define<void>();

export interface LivePreviewCallbacks {
	app: App;
	getFilePath: (view: EditorView) => string;
	getIndexedTask: (id: string) => IndexedTask | undefined;
	getAllTasks: () => IndexedTask[];
	openEditor: (task: ParsedTask, view: EditorView) => void;
	cycleStatus: (task: ParsedTask, view: EditorView) => void;
	getPipelines: () => Pipeline[];
	getPriorities: () => PriorityDefinition[];
	getSettings: () => OperonSettings;
	updateField: (operonId: string, key: string, value: string, restoreCursor?: LivePreviewCursorRestoreRequest) => void | Promise<void>;
	onContextualAction?: (taskId: string, actionId: ContextualMenuActionId) => void | Promise<void>;
	isTaskPinned?: (taskId: string) => boolean;
	isTaskTracking?: (taskId: string) => boolean;
	toggleTimer?: (taskId: string) => void | Promise<void>;
	requestSubtask?: (operonId: string) => void | Promise<void>;
	updateFields?: (operonId: string, payload: Record<string, string>, restoreCursor?: LivePreviewCursorRestoreRequest) => void | Promise<void>;
	updateSubtasks?: (operonId: string, subtaskIds: string[]) => void;
	updateDependencyField?: (operonId: string, field: 'blocking' | 'blockedBy', value: string) => void;
	getRepeatSeriesInlineCompletionMode?: (repeatSeriesId: string) => InlineRepeatCompletionMode;
	updateRepeatSeriesInlineCompletionMode?: (operonId: string, mode: InlineRepeatCompletionMode) => void | Promise<void>;
}

export interface LivePreviewCursorRestoreRequest {
	filePath: string;
	lineNumber: number;
	ch: number;
	editorView?: EditorView;
	trackDescriptionEnd?: boolean;
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

function snapshotLivePreviewAnchor(anchor: HTMLElement): DOMRect {
	const rect = anchor.getBoundingClientRect();
	const DOMRectCtor = (getOwnerWindow(anchor) as Window & { DOMRect?: typeof DOMRect }).DOMRect ?? DOMRect;
	return new DOMRectCtor(rect.left, rect.top, Math.max(rect.width, 1), Math.max(rect.height, 1));
}

class HiddenCheckboxWidget extends WidgetType {
	toDOM(view: EditorView): HTMLElement {
		const span = createOwnerElement(view.dom, 'span');
		span.className = 'operon-lp-checkbox-hidden';
		span.setAttribute('aria-hidden', 'true');
		return span;
	}

	eq(): boolean {
		return true;
	}
}

class TaskIconWidget extends WidgetType {
	private readonly renderSignature: string;

	constructor(
		private readonly task: ParsedTask,
		private readonly indexedTask: IndexedTask | undefined,
		private readonly callbacks: LivePreviewCallbacks,
	) {
		super();
		this.renderSignature = buildTaskIconRenderSignature(task, indexedTask, callbacks);
	}

	toDOM(view: EditorView): HTMLElement {
		const button = createOwnerElement(view.dom, 'span');
		button.className = 'operon-live-preview-status-icon';
		button.setAttribute('role', 'button');
		button.setAttribute('tabindex', '0');

		const fieldValues = getFieldValues(this.task, this.indexedTask);
		const statusValue = fieldValues['status'];
		button.setCssProps({ '--operon-live-icon-color': lookupStatusColor(statusValue, this.callbacks.getPipelines()) });

		const checkbox = this.indexedTask?.checkbox ?? this.task.checkbox;
		setIcon(button, resolveTaskDisplayIcon(this.callbacks.getSettings(), fieldValues, checkbox));

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
			}
			: this.task.operonId
				? {
					checkbox: this.task.checkbox,
					fieldValues: getFieldValues(this.task, this.indexedTask),
				}
				: null;
		if (this.task.operonId && taskSource && this.callbacks.onContextualAction) {
			bindTaskContextualHoverMenu(button, {
				surface: 'livePreviewTask',
				taskId: this.task.operonId,
				getTask: () => taskSource,
				getSettings: this.callbacks.getSettings,
				onAction: this.callbacks.onContextualAction,
				isPinned: this.callbacks.isTaskPinned ? () => this.callbacks.isTaskPinned?.(this.task.operonId!) === true : undefined,
			});
		}

		return button;
	}

	eq(other: TaskIconWidget): boolean {
		return this.task.rawLine === other.task.rawLine
			&& this.renderSignature === other.renderSignature;
	}
}

class MetadataTailWidget extends WidgetType {
	private readonly pinnedSnapshot: boolean;
	private readonly trackingSnapshot: boolean;
	private readonly renderSignature: string;

	constructor(
		private readonly task: ParsedTask,
		private readonly indexedTask: IndexedTask | undefined,
		private readonly callbacks: LivePreviewCallbacks,
		private readonly revealSource: () => void,
	) {
		super();
		const operonId = task.operonId ?? '';
		this.pinnedSnapshot = operonId ? callbacks.isTaskPinned?.(operonId) === true : false;
		this.trackingSnapshot = operonId ? callbacks.isTaskTracking?.(operonId) === true : false;
		this.renderSignature = buildMetadataTailRenderSignature(
			task,
			indexedTask,
			callbacks,
			this.pinnedSnapshot,
			this.trackingSnapshot,
		);
	}

	get lineBreaks(): number {
		return 1;
	}

	toDOM(view: EditorView): HTMLElement {
		const wrapper = createOwnerElement(view.dom, 'span');
		wrapper.className = 'operon-live-preview-tail';
		const breakEl = createOwnerElement(wrapper, 'br');
		wrapper.appendChild(breakEl);
		const tailWrap = createOwnerElement(wrapper, 'span');
		tailWrap.className = 'operon-live-preview-tail-wrap';
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
		const tasks = this.callbacks.getAllTasks();
		const taskColor = normalizeTaskColor(fieldValues['taskColor']);
		const terminalVisualState = resolveTerminalVisualState(this.task, fieldValues, this.callbacks.getPipelines());
		if (terminalVisualState === 'done') {
			tailWrap.classList.add('is-done');
		} else if (terminalVisualState === 'cancelled') {
			tailWrap.classList.add('is-cancelled');
		}

		const entries = buildInlineTaskCompactChipEntries(
			fieldValues,
			this.indexedTask?.tags ?? this.task.tags,
			this.callbacks.getSettings(),
			tasks,
		);
		for (const entry of entries) {
			const chip = createInlineTaskCompactChipElement(entry, '', { owner: row });
			applyLivePreviewChipVisualStyles(chip, entry, fieldValues, taskColor, this.callbacks);
			if (entry.iconOnly) {
				bindAdaptiveIconOnlyExpansion(chip, entry.label, taskColor ?? null);
				if (entry.externalUrl) {
					bindExternalLinkContextMenu(chip, entry.externalUrl, entry.externalRawValue);
				}
				if (entry.tooltipContent) {
					bindOperonHoverTooltip(chip, {
						title: entry.tooltipTitle ?? t('taskEditor', 'details'),
						content: entry.tooltipContent,
						taskColor,
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
					bindIconOnlyChipPreview(chip);
				}
				if (entry.linkTarget) {
					bindCompactChipLinkPreview(this.callbacks.app, chip, entry.linkTarget, this.callbacks.getFilePath(view));
				}
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

			const chipNode = entry.tooltipContent
				? wrapWithOperonHoverTooltip(chip, {
					title: entry.tooltipTitle ?? t('taskEditor', 'details'),
					content: entry.tooltipContent,
					taskColor,
				})
				: chip;
			if (entry.externalUrl) {
				bindExternalLinkContextMenu(chip, entry.externalUrl, entry.externalRawValue);
			}
			if (entry.linkTarget) {
				bindCompactChipLinkPreview(this.callbacks.app, chip, entry.linkTarget, this.callbacks.getFilePath(view));
			}
			row.appendChild(chipNode);
		}

		const hiddenCount = getInlineTaskCompactHiddenCount(
			fieldValues,
			this.indexedTask?.tags ?? this.task.tags,
			this.callbacks.getSettings(),
			tasks,
		);
		if (hiddenCount > 0 && operonId) {
			const moreButton = createOwnerElement(row, 'button');
			moreButton.type = 'button';
			moreButton.className = 'operon-chip operon-live-preview-chip operon-live-preview-chip-overflow';
			moreButton.textContent = `+${hiddenCount}`;
			if (taskColor) moreButton.setCssProps({ '--operon-live-hover-border': taskColor });
			moreButton.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				showLivePreviewFieldMenu(moreButton, {
					app: this.callbacks.app,
					task: this.indexedTask,
					parsedTask: this.task,
					settings: this.callbacks.getSettings(),
					allTasks: tasks,
					updateField: (key, value, restoreCursor) => this.callbacks.updateField(operonId, key, value, restoreCursor),
					updateFields: this.callbacks.updateFields
						? (payload, restoreCursor) => this.callbacks.updateFields?.(operonId, payload, restoreCursor)
						: undefined,
					updateSubtasks: this.callbacks.updateSubtasks
						? (subtaskIds) => this.callbacks.updateSubtasks?.(operonId, subtaskIds)
						: undefined,
					updateDependencyField: this.callbacks.updateDependencyField
						? (field, value) => this.callbacks.updateDependencyField?.(operonId, field, value)
						: undefined,
					repeatInlineCompletionMode: this.callbacks.getRepeatSeriesInlineCompletionMode?.(fieldValues['repeatSeriesId'] ?? ''),
					onRepeatInlineCompletionModeChange: mode => this.callbacks.updateRepeatSeriesInlineCompletionMode?.(operonId, mode),
					openEditor: () => this.callbacks.openEditor(this.task, view),
					revealSource: this.revealSource,
					visibleKeys: getInlineTaskCompactVisibleKeys(this.callbacks.getSettings()),
					editorView: view,
				});
			});
			row.appendChild(moreButton);
		}

		const isTerminal = terminalVisualState !== null;
		if (!isTerminal && operonId && this.callbacks.toggleTimer && this.callbacks.getSettings().inlineTaskShowPlayAction && (this.indexedTask?.checkbox ?? this.task.checkbox) === 'open') {
			const isTracking = this.trackingSnapshot;
			const playButton = createOwnerElement(actions, 'button');
			playButton.type = 'button';
			playButton.className = 'operon-live-preview-edit operon-live-preview-action';
			if (isTracking) playButton.classList.add('is-active');
			setIcon(playButton, isTracking ? 'square' : 'play');
			setAccessibleLabelWithoutTooltip(playButton, t('tooltips', isTracking ? 'stopTimer' : 'startTimer'));
			if (taskColor) playButton.setCssProps({ '--operon-live-hover-border': taskColor });
			playButton.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				void this.callbacks.toggleTimer?.(operonId);
			});
			actions.appendChild(playButton);
		}

		if (!isTerminal && operonId && this.callbacks.onContextualAction && this.callbacks.getSettings().inlineTaskShowPinAction) {
			const isPinned = this.pinnedSnapshot;
			const pinButton = createOwnerElement(actions, 'button');
			pinButton.type = 'button';
			pinButton.className = 'operon-live-preview-edit operon-live-preview-action';
			if (isPinned) pinButton.classList.add('is-active');
			const pinLabel = t('contextMenu', isPinned ? 'unpinTask' : 'pinTask');
			bindOperonHoverTooltip(pinButton, {
				content: pinLabel,
				taskColor,
			});
			setIcon(pinButton, isPinned ? 'pin-off' : 'pin');
			setAccessibleLabelWithoutTooltip(pinButton, pinLabel);
			if (taskColor) pinButton.setCssProps({ '--operon-live-hover-border': taskColor });
			pinButton.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				void this.callbacks.onContextualAction?.(operonId, 'pinToggle');
			});
			actions.appendChild(pinButton);
		}

		const noteValue = fieldValues['note']?.trim();
		if (noteValue) {
			const noteIndicator = createOperonHoverIndicator({
				title: t('taskEditor', 'notes'),
				content: noteValue,
				icon: getConfiguredKeyMappingIcon('note', this.callbacks.getSettings().keyMappings) || 'notebook-pen',
				taskColor,
				preferredHorizontal: 'right',
				owner: actions,
			});
			actions.appendChild(noteIndicator);
		}

		if (!isTerminal && operonId && this.callbacks.requestSubtask && this.callbacks.getSettings().inlineTaskShowSubtaskAction) {
			const subtaskLabel = t('buttons', resolveSubtaskActionLabelKey(this.indexedTask));
			const subtaskButton = createOwnerElement(actions, 'button');
			subtaskButton.type = 'button';
			subtaskButton.className = 'operon-live-preview-edit operon-live-preview-action';
			setIcon(subtaskButton, resolveSubtaskActionIcon(this.indexedTask));
			setAccessibleLabelWithoutTooltip(subtaskButton, subtaskLabel);
			if (taskColor) subtaskButton.setCssProps({ '--operon-live-hover-border': taskColor });
			subtaskButton.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				void this.callbacks.requestSubtask?.(operonId);
			});
			actions.appendChild(subtaskButton);
		}

		const editButton = createOwnerElement(actions, 'button');
		editButton.type = 'button';
		editButton.className = 'operon-live-preview-edit';
		setIcon(editButton, 'settings-2');
		setAccessibleLabelWithoutTooltip(editButton, t('tooltips', 'editTask'));
		if (taskColor) editButton.setCssProps({ '--operon-live-hover-border': taskColor });
		editButton.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.callbacks.openEditor(this.task, view);
		});
		actions.appendChild(editButton);

		return wrapper;
	}

	destroy(dom: HTMLElement): void {
		closeFloatingPanelsForRoot(dom);
		closeIconOnlyChipPreviewsForRoot(dom);
	}

	eq(other: MetadataTailWidget): boolean {
		return this.task.rawLine === other.task.rawLine
			&& this.renderSignature === other.renderSignature;
	}
}

export function operonLivePreviewConcealExtension(callbacks: LivePreviewCallbacks): Extension {
	const plugin = ViewPlugin.fromClass(
		class {
			decorations: DecorationSet = Decoration.none;
			atomicRanges: DecorationSet = Decoration.none;
			private explicitRevealTaskId: string | null = null;
			private lastLivePreview = false;
			private lastSelectionRevealSignature = '';

			constructor(view: EditorView) {
				this.lastLivePreview = this.isLivePreview(view);
				this.lastSelectionRevealSignature = this.getSelectionRevealSignature(view);
				this.rebuild(view);
			}

			update(update: ViewUpdate) {
				const hasIndexRefresh = update.transactions.some(transaction =>
					transaction.effects.some(effect => effect.is(operonIndexRefreshEffect))
				);
				const hasEditorCloseRefresh = update.transactions.some(transaction =>
					transaction.effects.some(effect => effect.is(operonEditorCloseRefreshEffect))
				);
				const hasRefresh = hasIndexRefresh || hasEditorCloseRefresh;
				const nowLive = this.isLivePreview(update.view);
				const modeChanged = nowLive !== this.lastLivePreview;
				this.lastLivePreview = nowLive;

				let explicitRevealChanged = false;
				if (hasEditorCloseRefresh && this.explicitRevealTaskId) {
					this.explicitRevealTaskId = null;
					explicitRevealChanged = true;
				}
				if (update.selectionSet && this.explicitRevealTaskId) {
					const selectedTask = this.getSelectedTaskId(update.view);
					if (selectedTask !== this.explicitRevealTaskId) {
						this.explicitRevealTaskId = null;
						explicitRevealChanged = true;
					}
				}

				const selectionRevealChanged = update.selectionSet || hasEditorCloseRefresh
					? this.updateSelectionRevealSignature(update.view)
					: false;

				if (modeChanged || hasRefresh || update.docChanged || explicitRevealChanged || selectionRevealChanged) {
					this.rebuild(update.view);
				}
			}

			private rebuild(view: EditorView): void {
				const decorations = new RangeSetBuilder<Decoration>();
				const atomic = new RangeSetBuilder<Decoration>();

				if (!this.isLivePreview(view)) {
					this.decorations = Decoration.none;
					this.atomicRanges = Decoration.none;
					return;
				}

				let inFencedCodeBlock = false;
				for (let lineNumber = 1; lineNumber <= view.state.doc.lines; lineNumber++) {
					const line = view.state.doc.line(lineNumber);
					if (isMarkdownFenceLine(line.text)) {
						inFencedCodeBlock = !inFencedCodeBlock;
						continue;
					}
					if (inFencedCodeBlock) continue;
					if (!line.text.includes('- [')) continue;

					const parsed = parseTaskLine(line.text, lineNumber - 1, callbacks.getFilePath(view), callbacks.getSettings().keyMappings);
					if (!parsed || (!parsed.operonId && parsed.fields.length === 0)) continue;

					const indexed = parsed.operonId ? callbacks.getIndexedTask(parsed.operonId) : undefined;
					const fieldValues = getFieldValues(parsed, indexed);
					const terminalVisualState = resolveTerminalVisualState(
						parsed,
						fieldValues,
						callbacks.getPipelines(),
					);
					const isExplicitReveal = !!parsed.operonId && this.explicitRevealTaskId === parsed.operonId;
					const selectionHead = view.state.selection.main.head - line.from;
					const isEditingTail = !!parsed.metadataTailRange
						&& selectionHead >= parsed.metadataTailRange.from
						&& selectionHead <= parsed.metadataTailRange.to;
					const revealTail = !!parsed.metadataTailRange && (isExplicitReveal || isEditingTail);

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
						const checkboxWidget = Decoration.replace({
							widget: new HiddenCheckboxWidget(),
						});
						decorations.add(line.from + parsed.checkboxRange.from, line.from + parsed.checkboxRange.to, checkboxWidget);
					}

					if (parsed.descriptionRange.from >= parsed.checkboxRange.to) {
						decorations.add(
							line.from + parsed.descriptionRange.from,
							line.from + parsed.descriptionRange.from,
							Decoration.widget({
								widget: new TaskIconWidget(parsed, indexed, callbacks),
								side: -1,
							}),
						);
					}

					if (parsed.metadataTailRange && !revealTail) {
						const tailWidget = new MetadataTailWidget(
							parsed,
							indexed,
							callbacks,
							() => {
								this.explicitRevealTaskId = parsed.operonId ?? null;
								view.dispatch({ effects: operonIndexRefreshEffect.of() });
							},
						);

						decorations.add(
							line.from + parsed.metadataTailRange.from,
							line.from + parsed.metadataTailRange.to,
							Decoration.replace({ widget: tailWidget }),
						);
					}
				}

				this.decorations = decorations.finish();
				this.atomicRanges = atomic.finish();
			}

			private getSelectedTaskId(view: EditorView): string | null {
				const head = view.state.selection.main.head;
				const line = view.state.doc.lineAt(head);
				const parsed = parseTaskLine(line.text, line.number - 1, callbacks.getFilePath(view), callbacks.getSettings().keyMappings);
				return parsed?.operonId ?? null;
			}

			private updateSelectionRevealSignature(view: EditorView): boolean {
				const next = this.getSelectionRevealSignature(view);
				if (next === this.lastSelectionRevealSignature) return false;
				this.lastSelectionRevealSignature = next;
				return true;
			}

			private getSelectionRevealSignature(view: EditorView): string {
				const head = view.state.selection.main.head;
				const line = view.state.doc.lineAt(head);
				const parsed = parseTaskLine(line.text, line.number - 1, callbacks.getFilePath(view), callbacks.getSettings().keyMappings);
				if (!parsed?.metadataTailRange) return '';
				const offset = head - line.from;
				const isEditingTail = offset >= parsed.metadataTailRange.from && offset <= parsed.metadataTailRange.to;
				return isEditingTail ? `${parsed.operonId ?? line.number}:${parsed.metadataTailRange.from}:${parsed.metadataTailRange.to}` : '';
			}

			private isLivePreview(view: EditorView): boolean {
				try {
					return view.state.field(editorLivePreviewField);
				} catch {
					return false;
				}
			}
		},
		{
			decorations: pluginValue => pluginValue.decorations,
			provide: pluginType => EditorView.atomicRanges.of(view => view.plugin(pluginType)?.atomicRanges ?? Decoration.none),
		},
	);

	return plugin;
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
): string {
	const fieldValues = getFieldValues(task, indexedTask);
	const checkbox = indexedTask?.checkbox ?? task.checkbox;
	return stableStringify({
		checkbox,
		iconName: resolveTaskDisplayIcon(callbacks.getSettings(), fieldValues, checkbox),
		status: fieldValues['status'] ?? '',
		statusColor: lookupStatusColor(fieldValues['status'], callbacks.getPipelines()),
	});
}

export function buildMetadataTailRenderSignature(
	task: ParsedTask,
	indexedTask: IndexedTask | undefined,
	callbacks: LivePreviewCallbacks,
	pinnedSnapshot: boolean,
	trackingSnapshot: boolean,
): string {
	const fieldValues = getFieldValues(task, indexedTask);
	const tags = indexedTask?.tags ?? task.tags;
	const settings = callbacks.getSettings();
	const tasks = callbacks.getAllTasks();
	const entries = buildInlineTaskCompactChipEntries(fieldValues, tags, settings, tasks)
		.map(entry => [
			entry.key,
			entry.label,
			entry.icon,
			entry.iconOnly,
			entry.interactive,
			entry.colorRole,
			entry.iconTone ?? '',
			entry.linkTarget ?? '',
			entry.externalUrl ?? '',
			entry.externalRawValue ?? '',
			entry.tooltipTitle ?? '',
			entry.tooltipContent ?? '',
		]);

	return stableStringify({
		fieldValues,
		tags,
		entries,
		hiddenCount: getInlineTaskCompactHiddenCount(fieldValues, tags, settings, tasks),
		pinnedSnapshot,
		trackingSnapshot,
		language: settings.language,
		inlineTaskShowPlayAction: settings.inlineTaskShowPlayAction,
		inlineTaskShowPinAction: settings.inlineTaskShowPinAction,
		inlineTaskShowSubtaskAction: settings.inlineTaskShowSubtaskAction,
		keyMappings: settings.keyMappings,
		pipelines: settings.pipelines,
		priorities: settings.priorities,
		noteIcon: getConfiguredKeyMappingIcon('note', settings.keyMappings) || 'notebook-pen',
	});
}

function stableStringify(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
	const record = value as Record<string, unknown>;
	return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function lookupStatusColor(statusValue: string | undefined, pipelines: Pipeline[]): string {
	if (!statusValue) return '#6b7280';
	const parsed = parseStatusValue(statusValue);
	if (!parsed) return '#6b7280';
	const pipeline = pipelines.find(candidate => candidate.name === parsed.pipeline);
	if (!pipeline) return '#6b7280';
	const status = pipeline.statuses.find(candidate => candidate.label === parsed.status);
	return status?.color ?? '#6b7280';
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
): 'done' | 'cancelled' | null {
	if (task.checkbox === 'cancelled' || !!fieldValues['dateCancelled']?.trim()) {
		return 'cancelled';
	}
	if (task.checkbox === 'done' || !!fieldValues['dateCompleted']?.trim()) {
		return 'done';
	}
	const workflow = resolveWorkflowStatus(pipelines, fieldValues['status']);
	if (workflow?.definition.isFinished === true) return 'done';
	if (workflow?.definition.isCancelled === true) return 'cancelled';
	return null;
}

function applyLivePreviewChipVisualStyles(
	chip: HTMLElement,
	entry: InlineTaskCompactChipEntry,
	fieldValues: Record<string, string>,
	taskColor: string | null,
	callbacks: LivePreviewCallbacks,
): void {
	const cssProps: Record<string, string> = {};
	if (taskColor) cssProps['--operon-live-hover-border'] = taskColor;
	if (entry.colorRole === 'priority') {
		const def = callbacks.getPriorities().find(priority => priority.label === fieldValues['priority']);
		if (def) cssProps['--operon-live-chip-color'] = def.color;
	}
	if (entry.colorRole === 'status') {
		cssProps['--operon-live-chip-color'] = lookupStatusColor(fieldValues['status'], callbacks.getPipelines());
	}
	if (entry.iconTone === 'today') {
		cssProps['--operon-inline-chip-icon-color'] = '#2563eb';
	} else if (entry.iconTone === 'overdue') {
		cssProps['--operon-inline-chip-icon-color'] = '#dc2626';
	}
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
	chip.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		if (entry.iconOnly && shouldOpenIconOnlyChipPreview(chip)) {
			openIconOnlyChipPreview(chip);
			return;
		}
		const operonId = task.operonId;
		if (!operonId) return;
		const restoreCursor = () => getLivePreviewDescriptionEndCursor(task, view, callbacks);
		const pickerAnchor = snapshotLivePreviewAnchor(chip);
		switch (entry.key) {
			case 'status':
				callbacks.cycleStatus(task, view);
				onCommit?.();
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
				showDatePicker(pickerAnchor, {
					app: callbacks.app,
						fieldKey: entry.key,
						value: fieldValues[entry.key],
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
				void openObsidianTagSearch(callbacks.app, entry.label);
				onCommit?.();
				break;
			case 'links':
				openExternalUrl(entry.externalUrl);
				onCommit?.();
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
			case 'duration':
			case 'totalDuration':
			case 'totalEstimate':
				break;
		}
	});
	if (taskColor) chip.setCssProps({ '--operon-live-hover-border': taskColor });
}
