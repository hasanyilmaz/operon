import {
	Decoration,
	DecorationSet,
	EditorView,
	ViewPlugin,
	ViewUpdate,
	WidgetType,
} from '@codemirror/view';
import { Extension, RangeSetBuilder } from '@codemirror/state';
import { App, editorLivePreviewField, setIcon } from 'obsidian';
import { createOwnerElement } from '../core/dom-compat';
import { t } from '../core/i18n';
import { normalizeTaskColorValue } from '../core/task-color-value';
import { DescendantTaskSummary } from '../indexer/indexer';
import { IndexedTask } from '../types/fields';
import { OperonSettings } from '../types/settings';
import { Pipeline } from '../types/pipeline';
import { operonIndexRefreshEffect } from './live-preview-conceal';
import { bindTaskContextualHoverMenu } from './contextual-hover-menu';
import type { ContextualMenuActionId } from '../core/contextual-menu-engine';
import { getConfiguredKeyMappingIcon } from '../core/key-mapping-icons';
import {
	computeTaskFileLinkVisuals,
	computeTaskFileLinkProgressIndicator,
	FileTaskLookup,
	resolveTaskFileLink,
	TaskFileLinkProgressIndicator,
	TaskFileLinkVisuals,
} from './task-file-wikilink-shared';
import { bindOperonHoverTooltip } from './operon-hover-tooltip';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { buildTaskFileOverlayChipContainer, getTaskFileOverlayChipSignature } from './task-file-overlay-chips';
import { resolveSubtaskActionIcon, resolveSubtaskActionLabelKey } from '../core/subtask-action';
import { scanTaskWikiLinksInLine } from './task-wikilink-scanner';

export interface LivePreviewTaskWikilinkCallbacks {
	app: App;
	getFilePath: (view: EditorView) => string;
	getSettings: () => OperonSettings;
	getPipelines: () => Pipeline[];
	getAllTasks: () => IndexedTask[];
	getFileTaskByPath: FileTaskLookup;
	getDescendantTaskSummary: (operonId: string) => DescendantTaskSummary;
	openTaskEditor: (operonId: string) => void;
	cycleStatus: (operonId: string) => void;
	onContextualAction?: (taskId: string, actionId: ContextualMenuActionId) => void | Promise<void>;
	isTaskPinned?: (taskId: string) => boolean;
	isTaskTracking?: (taskId: string) => boolean;
	toggleTimer?: (taskId: string) => void | Promise<void>;
	requestSubtask?: (operonId: string) => void | Promise<void>;
}

class TaskWikilinkLeftWidget extends WidgetType {
	private readonly renderSignature: string;

	constructor(
		private readonly task: IndexedTask,
		private readonly visuals: TaskFileLinkVisuals,
		private readonly callbacks: LivePreviewTaskWikilinkCallbacks,
	) {
		super();
		this.renderSignature = buildTaskWikilinkLeftRenderSignature(task, visuals, callbacks);
	}

	toDOM(view: EditorView): HTMLElement {
		const button = createOwnerElement(view.dom, 'button');
		button.type = 'button';
		button.className = 'operon-task-wikilink-action operon-task-wikilink-left';
		button.setCssProps({
			'--operon-task-wikilink-hover': this.visuals.hoverColor,
			'--operon-task-wikilink-status-color': this.visuals.statusColor,
		});
		setIcon(button, this.visuals.iconName);
		setAccessibleLabelWithoutTooltip(button, t('tooltips', 'cycleTaskStatus'));

		button.addEventListener('mousedown', stopEvent);
		button.addEventListener('click', (event) => {
			stopEvent(event);
			this.callbacks.cycleStatus(this.task.operonId);
		});
		button.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			stopEvent(event);
			this.callbacks.cycleStatus(this.task.operonId);
		});
		if (this.callbacks.onContextualAction) {
			bindTaskContextualHoverMenu(button, {
				surface: 'taskWikilinkOverlay',
				taskId: this.task.operonId,
				getTask: () => this.task,
				getSettings: this.callbacks.getSettings,
				onAction: this.callbacks.onContextualAction,
				isPinned: this.callbacks.isTaskPinned ? () => this.callbacks.isTaskPinned?.(this.task.operonId) === true : undefined,
			});
		}

		return button;
	}

	eq(other: TaskWikilinkLeftWidget): boolean {
		return this.task.operonId === other.task.operonId
			&& this.renderSignature === other.renderSignature;
	}
}

class TaskWikilinkTrailingWidget extends WidgetType {
	private readonly chipSignature: string;
	private readonly pinnedSnapshot: boolean;
	private readonly trackingSnapshot: boolean;
	private readonly renderSignature: string;

	constructor(
		private readonly task: IndexedTask,
		private readonly visuals: TaskFileLinkVisuals,
		private readonly progress: TaskFileLinkProgressIndicator,
		private readonly callbacks: LivePreviewTaskWikilinkCallbacks,
	) {
		super();
		this.pinnedSnapshot = callbacks.isTaskPinned?.(task.operonId) === true;
		this.trackingSnapshot = callbacks.isTaskTracking?.(task.operonId) === true;
		this.chipSignature = getTaskFileOverlayChipSignature(
			task,
			callbacks.getSettings(),
			callbacks.getAllTasks(),
		);
		this.renderSignature = buildTaskWikilinkTrailingRenderSignature(
			task,
			visuals,
			progress,
			callbacks,
			this.chipSignature,
			this.pinnedSnapshot,
			this.trackingSnapshot,
		);
	}

	toDOM(view: EditorView): HTMLElement {
		const wrap = createOwnerElement(view.dom, 'span');
		wrap.className = 'operon-task-wikilink-trailing';
		wrap.setCssProps({ '--operon-task-wikilink-hover': this.visuals.hoverColor });

		const progressEl = createProgressElement(this.progress, wrap);
		if (progressEl) {
			wrap.appendChild(progressEl);
		}

		const chipRow = buildTaskFileOverlayChipContainer(this.task, {
			app: this.callbacks.app,
			getSettings: this.callbacks.getSettings,
			getAllTasks: this.callbacks.getAllTasks,
			sourcePath: this.callbacks.getFilePath(view),
			owner: wrap,
		});
		if (chipRow) {
			wrap.appendChild(chipRow);
		}

		const settings = this.callbacks.getSettings();
		const isTerminal = this.visuals.labelState !== 'default';
		if (!isTerminal && settings.overlayTaskShowPlayAction && this.callbacks.toggleTimer && this.task.checkbox === 'open') {
			const playButton = createOwnerElement(wrap, 'button');
			playButton.type = 'button';
			playButton.className = 'operon-live-preview-edit operon-live-preview-action operon-task-wikilink-overlay-action';
			if (this.trackingSnapshot) playButton.classList.add('is-active');
			playButton.setCssProps({ '--operon-live-hover-border': this.visuals.hoverColor });
			setIcon(playButton, this.trackingSnapshot ? 'square' : 'play');
			playButton.addEventListener('mousedown', stopEvent);
			playButton.addEventListener('click', (event) => {
				stopEvent(event);
				void this.callbacks.toggleTimer?.(this.task.operonId);
			});
			wrap.appendChild(playButton);
		}

		if (!isTerminal && settings.overlayTaskShowPinAction && this.callbacks.onContextualAction) {
			const pinButton = createOwnerElement(wrap, 'button');
			pinButton.type = 'button';
			pinButton.className = 'operon-live-preview-edit operon-live-preview-action operon-task-wikilink-overlay-action';
			if (this.pinnedSnapshot) pinButton.classList.add('is-active');
			pinButton.setCssProps({ '--operon-live-hover-border': this.visuals.hoverColor });
			setIcon(pinButton, this.pinnedSnapshot ? 'pin-off' : 'pin');
			pinButton.addEventListener('mousedown', stopEvent);
			pinButton.addEventListener('click', (event) => {
				stopEvent(event);
				void this.callbacks.onContextualAction?.(this.task.operonId, 'pinToggle');
			});
			wrap.appendChild(pinButton);
		}

		const noteValue = this.task.fieldValues['note']?.trim();
		if (settings.overlayTaskShowNoteAction && noteValue) {
			const noteIndicator = createOwnerElement(wrap, 'span');
			noteIndicator.className = 'operon-live-preview-edit operon-live-preview-action operon-task-wikilink-overlay-action is-active';
			noteIndicator.setAttribute('role', 'img');
			noteIndicator.setCssProps({ '--operon-live-hover-border': this.visuals.hoverColor });
			setIcon(noteIndicator, getConfiguredKeyMappingIcon('note', settings.keyMappings) || 'notebook-pen');
			setAccessibleLabelWithoutTooltip(noteIndicator, t('taskEditor', 'notes'));
			bindOperonHoverTooltip(noteIndicator, {
				title: t('taskEditor', 'notes'),
				content: noteValue,
				taskColor: this.visuals.hoverColor,
				preferredHorizontal: 'right',
			});
			wrap.appendChild(noteIndicator);
		}

		if (!isTerminal && settings.overlayTaskShowSubtaskAction && this.callbacks.requestSubtask) {
			const subtaskLabel = t('buttons', resolveSubtaskActionLabelKey(this.task));
			const subtaskButton = createOwnerElement(wrap, 'button');
			subtaskButton.type = 'button';
			subtaskButton.className = 'operon-live-preview-edit operon-live-preview-action operon-task-wikilink-overlay-action';
			subtaskButton.setCssProps({ '--operon-live-hover-border': this.visuals.hoverColor });
			setIcon(subtaskButton, resolveSubtaskActionIcon(this.task));
			setAccessibleLabelWithoutTooltip(subtaskButton, subtaskLabel);
			subtaskButton.addEventListener('mousedown', stopEvent);
			subtaskButton.addEventListener('click', (event) => {
				stopEvent(event);
				void this.callbacks.requestSubtask?.(this.task.operonId);
			});
			wrap.appendChild(subtaskButton);
		}

		const button = createOwnerElement(wrap, 'button');
		button.type = 'button';
		button.className = 'operon-task-wikilink-action operon-task-wikilink-right';
		button.setCssProps({ '--operon-task-wikilink-hover': this.visuals.hoverColor });
		setIcon(button, 'settings-2');
		setAccessibleLabelWithoutTooltip(button, t('tooltips', 'editTask'));

		button.addEventListener('mousedown', stopEvent);
		button.addEventListener('click', (event) => {
			stopEvent(event);
			this.callbacks.openTaskEditor(this.task.operonId);
		});
		button.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			stopEvent(event);
			this.callbacks.openTaskEditor(this.task.operonId);
		});

		wrap.appendChild(button);
		return wrap;
	}

	eq(other: TaskWikilinkTrailingWidget): boolean {
		return this.task.operonId === other.task.operonId
			&& this.renderSignature === other.renderSignature;
	}
}

export function operonLivePreviewTaskWikilinkOverlayExtension(
	callbacks: LivePreviewTaskWikilinkCallbacks,
): Extension {
	const plugin = ViewPlugin.fromClass(class {
		decorations: DecorationSet = Decoration.none;
		private lastLivePreview = false;
		private lastSelectionOverlaySignature = '';

		constructor(view: EditorView) {
			this.lastLivePreview = this.isLivePreview(view);
			this.lastSelectionOverlaySignature = this.getSelectionOverlaySignature(view);
			this.rebuild(view);
		}

		update(update: ViewUpdate): void {
			const hasRefresh = update.transactions.some((transaction) =>
				transaction.effects.some((effect) => effect.is(operonIndexRefreshEffect))
			);
			const nowLive = this.isLivePreview(update.view);
			const modeChanged = nowLive !== this.lastLivePreview;
			this.lastLivePreview = nowLive;

			const selectionOverlayChanged = update.selectionSet
				? this.updateSelectionOverlaySignature(update.view)
				: false;

			if (modeChanged || hasRefresh || update.docChanged || selectionOverlayChanged) {
				this.rebuild(update.view);
			}
		}

		private rebuild(view: EditorView): void {
			if (!this.isLivePreview(view)) {
				this.decorations = Decoration.none;
				return;
			}

			const sourcePath = callbacks.getFilePath(view);
			const selection = view.state.selection.main;
			const decorations = new RangeSetBuilder<Decoration>();
			const descendantCache = new Map<string, DescendantTaskSummary>();
			let inFrontmatter = false;
			let frontmatterResolved = false;
			let inFence = false;

			for (let lineNumber = 1; lineNumber <= view.state.doc.lines; lineNumber++) {
				const line = view.state.doc.line(lineNumber);
				const trimmed = line.text.trim();

				if (!frontmatterResolved) {
					if (lineNumber === 1 && trimmed === '---') {
						inFrontmatter = true;
						continue;
					}
					frontmatterResolved = true;
				}

				if (inFrontmatter) {
					if (lineNumber > 1 && (trimmed === '---' || trimmed === '...')) {
						inFrontmatter = false;
						frontmatterResolved = true;
					}
					continue;
				}

				if (/^\s*```/.test(line.text) || /^\s*~~~/.test(line.text)) {
					inFence = !inFence;
					continue;
				}
				if (inFence) continue;
				if (!line.text.includes('[[')) continue;

				const matches = scanTaskWikiLinksInLine(line.text, { includeEmbeds: true });
				if (matches.length === 0) continue;

				for (const match of matches) {
					const from = line.from + match.from;
					const to = line.from + match.to;
					if (selection.from < to && selection.to > from) continue;

					const resolved = resolveTaskFileLink(
						callbacks.app,
						sourcePath,
						match.linktext,
						callbacks.getFileTaskByPath,
						match.alias,
					);
					if (!resolved) continue;

					const visuals = computeTaskFileLinkVisuals(
						resolved.task,
						callbacks.getSettings(),
						callbacks.getPipelines(),
					);
					const summary = getCachedDescendantSummary(
						resolved.task.operonId,
						descendantCache,
						callbacks,
					);
					const progress = computeTaskFileLinkProgressIndicator(summary);
					const markClasses = ['operon-task-wikilink-live-mark'];
					if (visuals.labelState === 'done') {
						markClasses.push('operon-task-done');
					} else if (visuals.labelState === 'cancelled') {
						markClasses.push('operon-task-cancelled');
					}

					decorations.add(
						from,
						from,
						Decoration.widget({
							widget: new TaskWikilinkLeftWidget(resolved.task, visuals, callbacks),
							side: -1,
						}),
					);
					decorations.add(
						from,
						to,
						Decoration.mark({
							class: markClasses.join(' '),
							attributes: {
								style: `--operon-task-wikilink-hover: ${visuals.hoverColor};`,
							},
						}),
					);
					decorations.add(
						to,
						to,
						Decoration.widget({
							widget: new TaskWikilinkTrailingWidget(resolved.task, visuals, progress, callbacks),
							side: 1,
						}),
					);
				}
			}

			this.decorations = decorations.finish();
		}

		private isLivePreview(view: EditorView): boolean {
			try {
				return view.state.field(editorLivePreviewField);
			} catch {
				return false;
			}
		}

		private updateSelectionOverlaySignature(view: EditorView): boolean {
			const next = this.getSelectionOverlaySignature(view);
			if (next === this.lastSelectionOverlaySignature) return false;
			this.lastSelectionOverlaySignature = next;
			return true;
		}

		private getSelectionOverlaySignature(view: EditorView): string {
			const selection = view.state.selection.main;
			if (selection.from === selection.to) return '';
			const fromLine = view.state.doc.lineAt(selection.from);
			const toLine = view.state.doc.lineAt(selection.to);
			const signatures: string[] = [];
			for (let lineNumber = fromLine.number; lineNumber <= toLine.number; lineNumber++) {
				const line = view.state.doc.line(lineNumber);
				for (const match of scanTaskWikiLinksInLine(line.text, { includeEmbeds: true })) {
					const from = line.from + match.from;
					const to = line.from + match.to;
					if (selection.from < to && selection.to > from) {
						signatures.push(`${from}:${to}:${match.linktext}:${match.alias ?? ''}`);
					}
				}
			}
			return signatures.join('|');
		}
	}, {
		decorations: (value) => value.decorations,
	});

	return plugin;
}

export function buildTaskWikilinkLeftRenderSignature(
	task: IndexedTask,
	visuals: TaskFileLinkVisuals,
	callbacks: LivePreviewTaskWikilinkCallbacks,
): string {
	return stableStringify({
		checkbox: task.checkbox,
		language: callbacks.getSettings().language,
		status: task.fieldValues['status'] ?? '',
		taskIcon: task.fieldValues['taskIcon'] ?? '',
		taskColor: normalizeTaskColorValue(task.fieldValues['taskColor']),
		iconName: visuals.iconName,
		hoverColor: visuals.hoverColor,
		statusColor: visuals.statusColor,
		labelState: visuals.labelState,
	});
}

export function buildTaskWikilinkTrailingRenderSignature(
	task: IndexedTask,
	visuals: TaskFileLinkVisuals,
	progress: TaskFileLinkProgressIndicator,
	callbacks: LivePreviewTaskWikilinkCallbacks,
	chipSignature: string,
	pinnedSnapshot: boolean,
	trackingSnapshot: boolean,
): string {
	const settings = callbacks.getSettings();
	return stableStringify({
		fieldValues: task.fieldValues,
		checkbox: task.checkbox,
		language: settings.language,
		overlayTaskShowPlayAction: settings.overlayTaskShowPlayAction,
		overlayTaskShowPinAction: settings.overlayTaskShowPinAction,
		overlayTaskShowNoteAction: settings.overlayTaskShowNoteAction,
		overlayTaskShowSubtaskAction: settings.overlayTaskShowSubtaskAction,
		keyMappings: settings.keyMappings,
		overlayTaskCompactChips: settings.overlayTaskCompactChips,
		visuals,
		progress,
		chipSignature,
		pinnedSnapshot,
		trackingSnapshot,
		noteIcon: getConfiguredKeyMappingIcon('note', settings.keyMappings) || 'notebook-pen',
	});
}

function stableStringify(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
	const record = value as Record<string, unknown>;
	return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function getCachedDescendantSummary(
	operonId: string,
	cache: Map<string, DescendantTaskSummary>,
	callbacks: LivePreviewTaskWikilinkCallbacks,
): DescendantTaskSummary {
	const cached = cache.get(operonId);
	if (cached) return cached;
	const summary = callbacks.getDescendantTaskSummary(operonId);
	cache.set(operonId, summary);
	return summary;
}

function createProgressElement(progress: TaskFileLinkProgressIndicator, owner?: Node | null): HTMLElement | null {
	if (progress.kind === 'none') return null;

	const el = createOwnerElement(owner, 'span');
	el.className = 'operon-task-wikilink-progress';

	if (progress.kind === 'count') {
		el.classList.add('operon-task-wikilink-progress-count');
		el.textContent = progress.text;
		setAccessibleLabelWithoutTooltip(el, progress.text);
		bindOperonHoverTooltip(el, {
			content: progress.text,
			taskColor: null,
		});
		return el;
	}

	el.classList.add('operon-task-wikilink-progress-complete');
	bindOperonHoverTooltip(el, {
		content: t('tooltips', 'allDescendantsDone'),
		taskColor: null,
	});
	setIcon(el, progress.icon);
	setAccessibleLabelWithoutTooltip(el, t('tooltips', 'allDescendantsDone'));
	return el;
}

function stopEvent(event: Event): void {
	event.preventDefault();
	event.stopPropagation();
}
