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
import { createOwnerElement } from '../core/dom-compat';
import { t } from '../core/i18n';
import { normalizeTaskColorValue } from '../core/task-color-value';
import { DescendantTaskSummary } from '../indexer/indexer';
import { IndexedTask } from '../types/fields';
import { OperonSettings } from '../types/settings';
import { Pipeline } from '../types/pipeline';
import { operonIndexRefreshEffect } from './live-preview-conceal';
import { bindTaskContextualHoverMenu } from './contextual-hover-menu';
import type { ContextualMenuActionHandler } from '../core/contextual-menu-engine';
import type { ProjectSerialDisplay } from '../core/project-serials';
import { getConfiguredKeyMappingIcon } from '../core/key-mapping-icons';
import {
	computeTaskFileLinkPlainCheckboxIndicator,
	computeTaskFileLinkVisuals,
	computeTaskFileLinkProgressIndicator,
	createTaskFileLinkPlainCheckboxProgressElement,
	FileTaskLookup,
	resolveTaskWikilinkOverlayLink,
	ResolvedTaskWikilinkOverlayLink,
	TaskFileLinkProgressIndicator,
	TaskFileLinkVisuals,
	buildTaskFileLinkProgressTooltip,
	appendTaskFileLinkProgressCountContent,
} from './task-file-wikilink-shared';
import { bindOperonHoverTooltip, createNonInteractiveMarkdownLinkContent } from './operon-hover-tooltip';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { buildTaskWikilinkOverlayChipContainer, getTaskWikilinkOverlayChipSignature } from './task-wikilink-overlay-chips';
import { resolveSubtaskActionIcon, resolveSubtaskActionLabelKey } from '../core/subtask-action';
import { scanTaskWikiLinksInLine, type TaskWikiLinkMatch } from './task-wikilink-scanner';
import { bindTaskTitleLinkPreview } from './compact-chip-link-preview';
import { isTaskDescriptionWikilinkEventTarget, renderTaskDescriptionWikilinks } from './task-description-wikilinks';
import { cleanupOperonRenderRoot } from './render-root-cleanup';

export interface LivePreviewTaskWikilinkCallbacks {
	app: App;
	getFilePath: (view: EditorView) => string;
	getSettings: () => OperonSettings;
	getPipelines: () => Pipeline[];
	getAllTasks: () => IndexedTask[];
	getFileTaskByPath: FileTaskLookup;
	hasDuplicateOperonIdConflict?: (operonId: string) => boolean;
	getDescendantTaskSummary: (operonId: string) => DescendantTaskSummary;
	openTaskEditor: (operonId: string) => void;
	cycleStatus: (operonId: string) => void;
	onContextualAction?: ContextualMenuActionHandler;
	isTaskPinned?: (taskId: string) => boolean;
	hasSubtasks?: (taskId: string) => boolean;
	isTaskTracking?: (taskId: string) => boolean;
	toggleTimer?: (taskId: string) => void | Promise<void>;
	requestSubtask?: (operonId: string) => void | Promise<void>;
	getRepeatSkipDates?: (repeatSeriesId: string) => string[];
	getProjectSerialDisplay?: (operonId: string, task?: IndexedTask) => ProjectSerialDisplay | null;
}

export const operonTaskWikilinkForceRevealEffect = StateEffect.define<{ filePaths: string[] }>();

class TaskWikilinkLeftWidget extends WidgetType {
	private readonly renderSignature: string;

	constructor(
		private readonly task: IndexedTask,
		private readonly visuals: TaskFileLinkVisuals,
		private readonly callbacks: LivePreviewTaskWikilinkCallbacks,
		private readonly remountKey: number,
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
		});
		if (this.visuals.statusColor) {
			button.style.setProperty('--operon-task-wikilink-status-color', this.visuals.statusColor);
		} else {
			button.style.removeProperty('--operon-task-wikilink-status-color');
		}
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
				hasSubtasks: this.callbacks.hasSubtasks ? () => this.callbacks.hasSubtasks?.(this.task.operonId) === true : undefined,
			});
		}

		return button;
	}

	destroy(dom: HTMLElement): void {
		cleanupOperonRenderRoot(dom);
	}

	eq(other: TaskWikilinkLeftWidget): boolean {
		return this.task.operonId === other.task.operonId
			&& this.remountKey === other.remountKey
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
		private readonly remountKey: number,
	) {
		super();
		this.pinnedSnapshot = callbacks.isTaskPinned?.(task.operonId) === true;
		this.trackingSnapshot = callbacks.isTaskTracking?.(task.operonId) === true;
		this.chipSignature = getTaskWikilinkOverlayChipSignature(
			task,
			callbacks.app,
			callbacks.getSettings(),
			callbacks.getAllTasks(),
			callbacks.getProjectSerialDisplay,
			callbacks.getRepeatSkipDates,
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
		wrap.className = 'operon-task-wikilink-trailing operon-task-chip-surface';
		wrap.setCssProps({
			'--operon-live-hover-border': this.visuals.hoverColor,
			'--operon-task-chip-hover-accent': this.visuals.hoverColor,
			'--operon-task-wikilink-hover': this.visuals.hoverColor,
		});

		const progressEl = createProgressElement(this.progress, wrap, this.visuals.hoverColor);
		if (progressEl) {
			wrap.appendChild(progressEl);
		}

		const settings = this.callbacks.getSettings();
		if (settings.taskWikilinkOverlayShowPlainCheckboxAction) {
			const plainCheckboxProgressEl = createTaskFileLinkPlainCheckboxProgressElement(
				computeTaskFileLinkPlainCheckboxIndicator(this.task),
				wrap,
				{
					app: this.callbacks.app,
					task: this.task,
					keyMappings: settings.keyMappings,
					taskColor: this.visuals.hoverColor,
					showEmptyAction: true,
				},
			);
			if (plainCheckboxProgressEl) {
				wrap.appendChild(plainCheckboxProgressEl);
			}
		}

		const chipRow = buildTaskWikilinkOverlayChipContainer(this.task, {
			app: this.callbacks.app,
			getSettings: this.callbacks.getSettings,
			getAllTasks: this.callbacks.getAllTasks,
			sourcePath: this.callbacks.getFilePath(view),
			owner: wrap,
			getProjectSerialDisplay: this.callbacks.getProjectSerialDisplay,
			getRepeatSkipDates: this.callbacks.getRepeatSkipDates,
		});
		if (chipRow) {
			wrap.appendChild(chipRow);
		}

		const isTerminal = this.visuals.labelState !== 'default';
		if (!isTerminal && settings.taskWikilinkOverlayShowPlayAction && this.callbacks.toggleTimer && this.task.checkbox === 'open') {
			const playButton = createOwnerElement(wrap, 'button');
			playButton.type = 'button';
			playButton.className = 'operon-live-preview-edit operon-live-preview-action operon-task-wikilink-overlay-action operon-task-chip-action';
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

		if (!isTerminal && settings.taskWikilinkOverlayShowPinAction && this.callbacks.onContextualAction) {
			const pinButton = createOwnerElement(wrap, 'button');
			pinButton.type = 'button';
			pinButton.className = 'operon-live-preview-edit operon-live-preview-action operon-task-wikilink-overlay-action operon-task-chip-action';
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
		if (settings.taskWikilinkOverlayShowNoteAction && noteValue) {
			const noteIndicator = createOwnerElement(wrap, 'span');
			noteIndicator.className = 'operon-live-preview-edit operon-live-preview-action operon-task-wikilink-overlay-action operon-task-wikilink-overlay-standard-action operon-task-wikilink-note-neutral operon-task-chip-action';
			noteIndicator.setCssProps({
				'--operon-live-hover-border': this.visuals.hoverColor,
				'--operon-task-chip-hover-accent': this.visuals.hoverColor,
			});
			setIcon(noteIndicator, getConfiguredKeyMappingIcon('note', settings.keyMappings) || 'notebook-pen');
			setAccessibleLabelWithoutTooltip(noteIndicator, t('taskEditor', 'notes'));
			bindOperonHoverTooltip(noteIndicator, {
				title: t('taskEditor', 'notes'),
				contentEl: createNonInteractiveMarkdownLinkContent(noteIndicator, noteValue),
				taskColor: this.visuals.hoverColor,
				preferredHorizontal: 'right',
			});
			wrap.appendChild(noteIndicator);
		}

		if (!isTerminal && settings.taskWikilinkOverlayShowSubtaskAction && this.callbacks.requestSubtask) {
			const subtaskLabel = t('buttons', resolveSubtaskActionLabelKey(this.task));
			const subtaskButton = createOwnerElement(wrap, 'button');
			subtaskButton.type = 'button';
			subtaskButton.className = 'operon-live-preview-edit operon-live-preview-action operon-task-wikilink-overlay-action operon-task-chip-action';
			subtaskButton.setCssProps({ '--operon-live-hover-border': this.visuals.hoverColor });
			setIcon(subtaskButton, resolveSubtaskActionIcon(this.task));
			setAccessibleLabelWithoutTooltip(subtaskButton, subtaskLabel);
			bindOperonHoverTooltip(subtaskButton, {
				content: subtaskLabel,
				taskColor: this.visuals.hoverColor,
				preferredHorizontal: 'right',
			});
			subtaskButton.addEventListener('mousedown', stopEvent);
			subtaskButton.addEventListener('click', (event) => {
				stopEvent(event);
				void this.callbacks.requestSubtask?.(this.task.operonId);
			});
			wrap.appendChild(subtaskButton);
		}

		const button = createOwnerElement(wrap, 'button');
		button.type = 'button';
		button.className = 'operon-live-preview-edit operon-live-preview-action operon-task-wikilink-overlay-action operon-task-wikilink-overlay-standard-action operon-task-wikilink-settings-action operon-task-chip-action';
		button.setCssProps({
			'--operon-live-hover-border': this.visuals.hoverColor,
			'--operon-task-chip-hover-accent': this.visuals.hoverColor,
			'--operon-task-wikilink-hover': this.visuals.hoverColor,
		});
		setIcon(button, 'settings-2');
		setAccessibleLabelWithoutTooltip(button, t('tooltips', 'editTask'));
		bindOperonHoverTooltip(button, {
			content: t('tooltips', 'editTask'),
			taskColor: this.visuals.hoverColor,
			preferredHorizontal: 'right',
		});

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

	destroy(dom: HTMLElement): void {
		cleanupOperonRenderRoot(dom);
	}

	eq(other: TaskWikilinkTrailingWidget): boolean {
		return this.task.operonId === other.task.operonId
			&& this.remountKey === other.remountKey
			&& this.renderSignature === other.renderSignature;
	}
}

class TaskWikilinkLabelWidget extends WidgetType {
	private readonly renderSignature: string;

	constructor(
		private readonly resolved: ResolvedTaskWikilinkOverlayLink,
		private readonly visuals: TaskFileLinkVisuals,
		private readonly callbacks: LivePreviewTaskWikilinkCallbacks,
		private readonly remountKey: number,
	) {
		super();
		this.renderSignature = buildTaskWikilinkLabelRenderSignature(resolved, visuals, callbacks);
	}

	toDOM(view: EditorView): HTMLElement {
		const sourcePath = this.callbacks.getFilePath(view);
		const label = createOwnerElement(view.dom, 'span');
		label.classList.add('internal-link', 'operon-task-wikilink-anchor', 'operon-task-wikilink-label', 'operon-task-wikilink-live-label');
		label.dataset.operonTaskWikilinkEnhanced = 'true';
		label.setAttribute('data-href', this.resolved.rawLinktext);
		label.setAttribute('role', 'link');
		label.setAttribute('tabindex', '0');
		label.setCssProps({ '--operon-task-wikilink-hover': this.visuals.hoverColor });
		applyTaskFileLinkLabelState(label, this.visuals);

		const alias = this.resolved.alias?.trim();
		const description = this.resolved.task.description.trim();
		const fallbackText = alias || description || this.resolved.rawLinktext;
		const rendered = !alias && description
			? renderTaskDescriptionWikilinks(label, {
				app: this.callbacks.app,
				description,
				sourcePath: this.resolved.task.primary.filePath,
				containerClassName: 'operon-task-wikilink-label-markdown',
				linkClassName: 'operon-task-wikilink-label-description-link',
			})
			: false;
		if (!rendered) label.textContent = fallbackText;
		scheduleTaskWikilinkLabelTextFallback(label, fallbackText);

		bindTaskTitleLinkPreview(this.callbacks.app, label, this.resolved.resolvedFile.path, sourcePath);
		label.addEventListener('mousedown', (event) => {
			event.stopPropagation();
		});
		label.addEventListener('click', (event) => {
			if (isTaskDescriptionWikilinkEventTarget(event.target, label)) return;
			event.preventDefault();
			event.stopPropagation();
			void this.callbacks.app.workspace.openLinkText(this.resolved.resolvedFile.path, sourcePath, false);
		});
		label.addEventListener('keydown', (event) => {
			if (event.target !== label) return;
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			event.stopPropagation();
			void this.callbacks.app.workspace.openLinkText(this.resolved.resolvedFile.path, sourcePath, false);
		});

		return label;
	}

	destroy(dom: HTMLElement): void {
		cleanupOperonRenderRoot(dom);
	}

	eq(other: TaskWikilinkLabelWidget): boolean {
		return this.resolved.task.operonId === other.resolved.task.operonId
			&& this.remountKey === other.remountKey
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
		private forceRevealFilePaths = new Set<string>();
		private remountKey = 0;

		constructor(view: EditorView) {
			this.lastLivePreview = this.isLivePreview(view);
			this.lastSelectionOverlaySignature = this.getSelectionOverlaySignature(view);
			this.rebuild(view);
		}

		update(update: ViewUpdate): void {
			const hasRefresh = update.transactions.some((transaction) =>
				transaction.effects.some((effect) => effect.is(operonIndexRefreshEffect))
			);
			const forceRevealFilePaths = collectTaskWikilinkForceRevealFilePaths(update);
			const hasForceReveal = forceRevealFilePaths.length > 0;
			if (update.selectionSet && !hasForceReveal) {
				this.forceRevealFilePaths.clear();
			}
			for (const filePath of forceRevealFilePaths) {
				this.forceRevealFilePaths.add(filePath);
			}
			const nowLive = this.isLivePreview(update.view);
			const modeChanged = nowLive !== this.lastLivePreview;
			this.lastLivePreview = nowLive;

			const selectionOverlayChanged = update.selectionSet
				? this.updateSelectionOverlaySignature(update.view)
				: false;

			if (modeChanged || hasRefresh || hasForceReveal || update.docChanged) {
				this.remountKey++;
			}
			if (modeChanged || hasRefresh || hasForceReveal || update.docChanged || selectionOverlayChanged) {
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
					const from = getTaskWikilinkOverlaySourceFrom(line.from, line.text, match);
					const to = line.from + match.to;
					const resolved = resolveTaskWikilinkOverlayLink(
						callbacks.app,
						sourcePath,
						match.linktext,
						{
							getFileTaskByPath: callbacks.getFileTaskByPath,
							getAllTasks: callbacks.getAllTasks,
							hasDuplicateOperonIdConflict: callbacks.hasDuplicateOperonIdConflict,
						},
						match.alias,
					);
					if (!resolved) continue;
					if (shouldRevealRawTaskWikilinkForSelection(
						selection.from,
						selection.to,
						from,
						to,
						resolved.resolvedFile.path,
						this.forceRevealFilePaths,
					)) continue;

					const visuals = computeTaskFileLinkVisuals(
						resolved.task,
						callbacks.getSettings(),
					);
					const summary = getCachedDescendantSummary(
						resolved.task.operonId,
						descendantCache,
						callbacks,
					);
					const progress = computeTaskFileLinkProgressIndicator(resolved.task, summary);

					decorations.add(
						from,
						from,
						Decoration.widget({
							widget: new TaskWikilinkLeftWidget(resolved.task, visuals, callbacks, this.remountKey),
							side: -2,
						}),
					);
					decorations.add(
						from,
						to,
						Decoration.replace({}),
					);
					decorations.add(
						to,
						to,
						Decoration.widget({
							widget: new TaskWikilinkLabelWidget(resolved, visuals, callbacks, this.remountKey),
							side: -1,
						}),
					);
					decorations.add(
						to,
						to,
						Decoration.widget({
							widget: new TaskWikilinkTrailingWidget(resolved.task, visuals, progress, callbacks, this.remountKey),
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
			const fromLine = view.state.doc.lineAt(selection.from);
			const toLine = view.state.doc.lineAt(selection.to);
			const signatures: string[] = [];
			for (let lineNumber = fromLine.number; lineNumber <= toLine.number; lineNumber++) {
				const line = view.state.doc.line(lineNumber);
				for (const match of scanTaskWikiLinksInLine(line.text, { includeEmbeds: true })) {
					const from = getTaskWikilinkOverlaySourceFrom(line.from, line.text, match);
					const to = line.from + match.to;
					const overlaps = selection.from === selection.to
						? selection.from > from && selection.from < to
						: selection.from < to && selection.to > from;
					if (overlaps) {
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

export function getTaskWikilinkOverlaySourceFrom(
	lineFrom: number,
	lineText: string,
	match: Pick<TaskWikiLinkMatch, 'from'>,
): number {
	return lineFrom + (match.from > 0 && lineText[match.from - 1] === '!' ? match.from - 1 : match.from);
}

function collectTaskWikilinkForceRevealFilePaths(update: ViewUpdate): string[] {
	const filePaths: string[] = [];
	for (const transaction of update.transactions) {
		for (const effect of transaction.effects) {
			if (!effect.is(operonTaskWikilinkForceRevealEffect)) continue;
			for (const filePath of effect.value.filePaths) {
				const normalized = normalizeTaskWikilinkForceRevealPath(filePath);
				if (normalized) filePaths.push(normalized);
			}
		}
	}
	return filePaths;
}

export function shouldRevealRawTaskWikilinkForSelection(
	selectionFrom: number,
	selectionTo: number,
	linkFrom: number,
	linkTo: number,
	resolvedFilePath = '',
	forceRevealFilePaths?: ReadonlySet<string>,
): boolean {
	const overlaps = selectionFrom < linkTo && selectionTo > linkFrom;
	if (!overlaps) return false;
	const normalizedPath = normalizeTaskWikilinkForceRevealPath(resolvedFilePath);
	return !normalizedPath || forceRevealFilePaths?.has(normalizedPath) !== true;
}

function normalizeTaskWikilinkForceRevealPath(filePath: string): string {
	return filePath.trim();
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
		statusColor: visuals.statusColor ?? '',
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
		taskWikilinkOverlayShowPlayAction: settings.taskWikilinkOverlayShowPlayAction,
		taskWikilinkOverlayShowPinAction: settings.taskWikilinkOverlayShowPinAction,
		taskWikilinkOverlayShowNoteAction: settings.taskWikilinkOverlayShowNoteAction,
		taskWikilinkOverlayShowSubtaskAction: settings.taskWikilinkOverlayShowSubtaskAction,
		taskWikilinkOverlayShowPlainCheckboxAction: settings.taskWikilinkOverlayShowPlainCheckboxAction,
		keyMappings: settings.keyMappings,
		taskWikilinkOverlayCompactChips: settings.taskWikilinkOverlayCompactChips,
		visuals,
		progress,
		plainCheckboxProgress: computeTaskFileLinkPlainCheckboxIndicator(task),
		chipSignature,
		pinnedSnapshot,
		trackingSnapshot,
		noteIcon: getConfiguredKeyMappingIcon('note', settings.keyMappings) || 'notebook-pen',
	});
}

export function buildTaskWikilinkLabelRenderSignature(
	resolved: ResolvedTaskWikilinkOverlayLink,
	visuals: TaskFileLinkVisuals,
	callbacks: LivePreviewTaskWikilinkCallbacks,
): string {
	const settings = callbacks.getSettings();
	return stableStringify({
		alias: resolved.alias ?? '',
		checkbox: resolved.task.checkbox,
		description: resolved.task.description,
		language: settings.language,
		labelState: visuals.labelState,
		rawLinktext: resolved.rawLinktext,
		resolvedFilePath: resolved.resolvedFile.path,
		hoverColor: visuals.hoverColor,
	});
}

function applyTaskFileLinkLabelState(label: HTMLElement, visuals: TaskFileLinkVisuals): void {
	if (visuals.labelState === 'done') {
		label.classList.add('operon-task-done');
	} else if (visuals.labelState === 'cancelled') {
		label.classList.add('operon-task-cancelled');
	}
}

function scheduleTaskWikilinkLabelTextFallback(label: HTMLElement, fallbackText: string): void {
	ensureTaskWikilinkLabelText(label, fallbackText);
	const win = label.ownerDocument.defaultView;
	if (!win) return;
	win.requestAnimationFrame(() => ensureTaskWikilinkLabelText(label, fallbackText));
	win.setTimeout(() => ensureTaskWikilinkLabelText(label, fallbackText), 80);
}

function ensureTaskWikilinkLabelText(label: HTMLElement, fallbackText: string): void {
	const fallback = fallbackText.trim();
	if (!fallback) return;
	if ((label.textContent ?? '').trim()) return;
	label.textContent = fallback;
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

function createProgressElement(progress: TaskFileLinkProgressIndicator, owner: Node | null | undefined, taskColor: string | null): HTMLElement | null {
	if (progress.kind === 'none') return null;

	const el = createOwnerElement(owner, 'span');
	el.className = 'operon-task-wikilink-progress operon-task-chip operon-task-chip-progress';

	if (progress.kind === 'count') {
		el.classList.add('operon-task-wikilink-progress-count');
		appendTaskFileLinkProgressCountContent(el, 'list-tree', progress.text);
		const tooltip = buildTaskFileLinkProgressTooltip(progress);
		setAccessibleLabelWithoutTooltip(el, tooltip?.accessibleLabel ?? progress.text);
		bindOperonHoverTooltip(el, {
			title: tooltip?.title,
			content: tooltip?.content ?? progress.text,
			taskColor,
		});
		return el;
	}

	const tooltip = buildTaskFileLinkProgressTooltip(progress);
	el.classList.add('operon-task-wikilink-progress-complete');
	bindOperonHoverTooltip(el, {
		title: tooltip?.title,
		content: tooltip?.content ?? t('tooltips', 'allDescendantsDone'),
		taskColor,
	});
	setIcon(el, progress.icon);
	setAccessibleLabelWithoutTooltip(el, tooltip?.accessibleLabel ?? t('tooltips', 'allDescendantsDone'));
	return el;
}

function stopEvent(event: Event): void {
	event.preventDefault();
	event.stopPropagation();
}
