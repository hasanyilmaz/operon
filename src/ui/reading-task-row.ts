import { App, setIcon } from 'obsidian';
import { IndexedTask, ParsedTask } from '../types/fields';
import { showDatePicker } from './field-pickers/date-picker';
import { showPriorityPicker } from './field-pickers/priority-picker';
import { showEstimatePicker } from './field-pickers/estimate-picker';
import { showLivePreviewFieldMenu } from './live-preview-field-menu';
import { InlineTaskCompactChipItem, OperonSettings, resolveTaskDisplayIcon } from '../types/settings';
import { Pipeline, parseStatusValue, resolveWorkflowStatus } from '../types/pipeline';
import { PriorityDefinition } from '../types/priority';
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
	openIconOnlyChipPreview,
	shouldOpenIconOnlyChipPreview,
} from './icon-only-chip-preview';
import { t } from '../core/i18n';
import { createOwnerElement } from '../core/dom-compat';
import { resolveSubtaskActionIcon, resolveSubtaskActionLabelKey } from '../core/subtask-action';
import type { InlineRepeatCompletionMode } from '../storage/repeat-series-store';
import type { DescendantTaskSummary } from '../indexer/indexer';
import { enhanceReadingTaskFileWikilinks } from './reading-task-wikilink-overlay';
import { isTaskDescriptionWikilinkEventTarget, renderTaskDescriptionWikilinks } from './task-description-wikilinks';

export interface ReadingTaskRowCallbacks {
	app: App;
	getPipelines: () => Pipeline[];
	getPriorities: () => PriorityDefinition[];
	getSettings: () => OperonSettings;
	getAllTasks: () => IndexedTask[];
	getFileTaskByPath?: (filePath: string) => IndexedTask | undefined;
	getDescendantTaskSummary?: (operonId: string) => DescendantTaskSummary;
	openEditor: (operonId: string) => void;
	cycleStatus: (operonId: string) => void | Promise<void>;
	navigateToTask: (task: IndexedTask) => void;
	updateField: (operonId: string, key: string, value: string) => void | Promise<void>;
	onContextualAction?: (taskId: string, actionId: ContextualMenuActionId) => void | Promise<void>;
	isTaskPinned?: (taskId: string) => boolean;
	isTaskTracking?: (taskId: string) => boolean;
	toggleTimer?: (taskId: string) => void | Promise<void>;
	requestSubtask?: (operonId: string) => void | Promise<void>;
	updateFields?: (operonId: string, payload: Record<string, string>) => void | Promise<void>;
	updateSubtasks?: (operonId: string, subtaskIds: string[]) => void;
	updateDependencyField?: (operonId: string, field: 'blocking' | 'blockedBy', value: string) => void;
	getRepeatSeriesInlineCompletionMode?: (repeatSeriesId: string) => InlineRepeatCompletionMode;
	updateRepeatSeriesInlineCompletionMode?: (operonId: string, mode: InlineRepeatCompletionMode) => void | Promise<void>;
}

export interface ReadingTaskRowOptions {
	owner?: Node | null;
	chipItems?: InlineTaskCompactChipItem[];
	showPlayAction?: boolean;
	showPinAction?: boolean;
	showSubtaskAction?: boolean;
	showEditAction?: boolean;
	rowClassName?: string;
	beforeEditAction?: (actions: HTMLElement, context: {
		task: IndexedTask;
		taskColor: string | null;
		isTerminal: boolean;
	}) => void;
}

export function buildReadingTaskRowElement(
	task: IndexedTask,
	callbacks: ReadingTaskRowCallbacks,
	renderedDescription?: HTMLElement,
	options?: ReadingTaskRowOptions,
): HTMLElement {
	const owner = renderedDescription ?? options?.owner ?? null;
	const row = el('div', 'operon-reading-task-row', owner);
	if (options?.rowClassName) row.classList.add(options.rowClassName);
	const head = el('div', 'operon-reading-task-head', row);
	const tail = el('div', 'operon-reading-task-tail', row);

	const taskColor = normalizeTaskColor(task.fieldValues['taskColor']);
	const statusColor = lookupStatusColor(task.fieldValues['status'], callbacks.getPipelines());
	const terminalVisualState = resolveTerminalVisualState(task, callbacks.getPipelines());
	if (terminalVisualState === 'done') {
		row.classList.add('operon-filter-row-done');
	} else if (terminalVisualState === 'cancelled') {
		row.classList.add('operon-filter-row-cancelled');
	}

	const iconButton = el('button', 'operon-live-preview-status-icon operon-reading-task-icon', row);
	iconButton.type = 'button';
	iconButton.style.setProperty('--operon-live-icon-color', statusColor);
	renderTaskIcon(iconButton, task, callbacks);
	iconButton.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		runReadingRowStatusCycle(callbacks, task.operonId);
	});
	if (callbacks.onContextualAction) {
		bindTaskContextualHoverMenu(iconButton, {
			surface: 'readingRow',
			taskId: task.operonId,
			getTask: () => task,
			getSettings: callbacks.getSettings,
			onAction: callbacks.onContextualAction,
			isPinned: callbacks.isTaskPinned ? () => callbacks.isTaskPinned?.(task.operonId) === true : undefined,
		});
	}
	head.appendChild(iconButton);

	const description = el('div', 'operon-reading-task-description operon-task-description', row);
	description.setAttribute('role', 'button');
	description.setAttribute('tabindex', '0');
	if (renderedDescription) {
		description.appendChild(renderedDescription);
	} else {
		renderTaskDescription(description, task, callbacks);
	}
	if (options?.rowClassName !== 'operon-filter-task-row') {
		bindOperonHoverTooltip(description, {
			content: t('tooltips', 'goToTask'),
			taskColor,
		});
	}
	if (terminalVisualState === 'done') {
		description.classList.add('operon-task-done');
	} else if (terminalVisualState === 'cancelled') {
		description.classList.add('operon-task-cancelled');
	}
	description.addEventListener('click', (event) => {
		if (isTaskDescriptionWikilinkEventTarget(event.target, description)) return;
		event.preventDefault();
		callbacks.navigateToTask(task);
	});
	description.addEventListener('keydown', (event) => {
		if (event.target !== description) return;
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		callbacks.navigateToTask(task);
	});
	head.appendChild(description);

	const entries = buildInlineTaskCompactChipEntries(
		task.fieldValues,
		task.tags,
		callbacks.getSettings(),
		callbacks.getAllTasks(),
		options?.chipItems,
	);
	for (const entry of entries) {
		const chip = createInlineTaskCompactChipElement(entry, 'operon-reading-task-chip');
		applyCompactChipVisualStyles(chip, entry, task, callbacks, statusColor, taskColor);
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
				attachReadingChipAction(chip, entry, task, callbacks, () => closeIconOnlyChipPreview(chip), taskColor);
			} else {
				bindIconOnlyChipPreview(chip);
			}
			if (entry.linkTarget) {
				bindCompactChipLinkPreview(callbacks.app, chip, entry.linkTarget, task.primary.filePath);
			}
			tail.appendChild(chip);
			continue;
		}
		if (entry.interactive) {
			attachReadingChipAction(chip, entry, task, callbacks, undefined, taskColor);
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
			bindCompactChipLinkPreview(callbacks.app, chip, entry.linkTarget, task.primary.filePath);
		}
		tail.appendChild(chipNode);
	}

	const hiddenCount = getInlineTaskCompactHiddenCount(
		task.fieldValues,
		task.tags,
		callbacks.getSettings(),
		callbacks.getAllTasks(),
		options?.chipItems,
	);
	if (hiddenCount > 0) {
		const overflow = el('button', 'operon-live-preview-chip operon-reading-task-overflow', row);
		overflow.type = 'button';
		overflow.textContent = `+${hiddenCount}`;
		if (taskColor) overflow.style.setProperty('--operon-live-hover-border', taskColor);
		overflow.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			showLivePreviewFieldMenu(overflow, {
				app: callbacks.app,
				task,
				parsedTask: parsedTaskFromIndexed(task),
				settings: callbacks.getSettings(),
				allTasks: callbacks.getAllTasks(),
				updateField: (key, value) => callbacks.updateField(task.operonId, key, value),
				updateFields: callbacks.updateFields
					? (payload) => callbacks.updateFields?.(task.operonId, payload)
					: undefined,
				updateSubtasks: callbacks.updateSubtasks
					? (subtaskIds) => callbacks.updateSubtasks?.(task.operonId, subtaskIds)
					: undefined,
				updateDependencyField: callbacks.updateDependencyField
					? (field, value) => callbacks.updateDependencyField?.(task.operonId, field, value)
					: undefined,
				repeatInlineCompletionMode: callbacks.getRepeatSeriesInlineCompletionMode?.(task.fieldValues['repeatSeriesId'] ?? ''),
				onRepeatInlineCompletionModeChange: mode => callbacks.updateRepeatSeriesInlineCompletionMode?.(task.operonId, mode),
				openEditor: () => callbacks.openEditor(task.operonId),
				visibleKeys: getInlineTaskCompactVisibleKeys(callbacks.getSettings(), options?.chipItems),
			});
		});
		tail.appendChild(overflow);
	}

	const actions = el('div', 'operon-reading-task-actions', row);

	const isTerminal = terminalVisualState !== null;
	const showPlayAction = options?.showPlayAction ?? callbacks.getSettings().inlineTaskShowPlayAction;
	const showPinAction = options?.showPinAction ?? callbacks.getSettings().inlineTaskShowPinAction;
	const showSubtaskAction = options?.showSubtaskAction ?? callbacks.getSettings().inlineTaskShowSubtaskAction;
	const showEditAction = options?.showEditAction ?? true;

	if (!isTerminal && callbacks.toggleTimer && showPlayAction && task.checkbox === 'open') {
		const isTracking = callbacks.isTaskTracking?.(task.operonId) === true;
		const playButton = el('button', 'operon-live-preview-edit operon-reading-task-edit operon-live-preview-action', row);
		playButton.type = 'button';
		if (isTracking) playButton.classList.add('is-active');
		setIcon(playButton, isTracking ? 'square' : 'play');
		setAccessibleLabelWithoutTooltip(playButton, t('tooltips', isTracking ? 'stopTimer' : 'startTimer'));
		playButton.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			void callbacks.toggleTimer?.(task.operonId);
		});
		if (taskColor) playButton.style.setProperty('--operon-live-hover-border', taskColor);
		actions.appendChild(playButton);
	}

	if (!isTerminal && callbacks.onContextualAction && showPinAction) {
		const isPinned = callbacks.isTaskPinned?.(task.operonId) === true;
		const pinButton = el('button', 'operon-live-preview-edit operon-reading-task-edit operon-live-preview-action', row);
		pinButton.type = 'button';
		if (isPinned) pinButton.classList.add('is-active');
		bindOperonHoverTooltip(pinButton, {
			content: t('contextMenu', isPinned ? 'unpinTask' : 'pinTask'),
			taskColor,
		});
		setIcon(pinButton, isPinned ? 'pin-off' : 'pin');
		setAccessibleLabelWithoutTooltip(pinButton, t('contextMenu', isPinned ? 'unpinTask' : 'pinTask'));
		pinButton.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			void callbacks.onContextualAction?.(task.operonId, 'pinToggle');
		});
		if (taskColor) pinButton.style.setProperty('--operon-live-hover-border', taskColor);
		actions.appendChild(pinButton);
	}

	const noteValue = task.fieldValues['note']?.trim();
	if (noteValue) {
		const noteIndicator = createOperonHoverIndicator({
			title: t('taskEditor', 'notes'),
			content: noteValue,
			icon: getConfiguredKeyMappingIcon('note', callbacks.getSettings().keyMappings) || 'notebook-pen',
			taskColor,
			preferredHorizontal: 'right',
		});
		actions.appendChild(noteIndicator);
	}

	options?.beforeEditAction?.(actions, {
		task,
		taskColor,
		isTerminal,
	});

	if (!isTerminal && callbacks.requestSubtask && showSubtaskAction) {
		const subtaskLabel = t('buttons', resolveSubtaskActionLabelKey(task));
		const subtaskButton = el('button', 'operon-live-preview-edit operon-reading-task-edit operon-live-preview-action', row);
		subtaskButton.type = 'button';
		setIcon(subtaskButton, resolveSubtaskActionIcon(task));
		setAccessibleLabelWithoutTooltip(subtaskButton, subtaskLabel);
		subtaskButton.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			void callbacks.requestSubtask?.(task.operonId);
		});
		if (taskColor) subtaskButton.style.setProperty('--operon-live-hover-border', taskColor);
		actions.appendChild(subtaskButton);
	}

	if (showEditAction) {
		const editButton = el('button', 'operon-live-preview-edit operon-reading-task-edit', row);
		editButton.type = 'button';
		setIcon(editButton, 'settings-2');
		setAccessibleLabelWithoutTooltip(editButton, t('tooltips', 'editTask'));
		editButton.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			callbacks.openEditor(task.operonId);
		});
		if (taskColor) editButton.style.setProperty('--operon-live-hover-border', taskColor);
		actions.appendChild(editButton);
	}

	row.appendChild(head);
	if (tail.children.length > 0 || actions.children.length > 0) {
		const tailWrap = el('div', 'operon-reading-task-tail-wrap', row);
		tailWrap.appendChild(tail);
		tailWrap.appendChild(actions);
		row.appendChild(tailWrap);
	}

	return row;
}

function renderTaskDescription(
	descriptionEl: HTMLElement,
	task: IndexedTask,
	callbacks: ReadingTaskRowCallbacks,
): void {
	const description = task.description || t('taskEditor', 'untitledTask');
	const rendered = renderTaskDescriptionWikilinks(descriptionEl, {
		app: callbacks.app,
		description,
		sourcePath: task.primary.filePath,
		containerClassName: 'operon-reading-task-description-markdown',
		linkClassName: 'operon-reading-task-description-wikilink',
	});
	if (!rendered) {
		descriptionEl.textContent = description;
		return;
	}
	enhanceTaskDescriptionWikilinkOverlays(descriptionEl, task, callbacks);
}

function enhanceTaskDescriptionWikilinkOverlays(
	descriptionEl: HTMLElement,
	task: IndexedTask,
	callbacks: ReadingTaskRowCallbacks,
): void {
	if (!callbacks.getFileTaskByPath || !callbacks.getDescendantTaskSummary) return;
	enhanceReadingTaskFileWikilinks(descriptionEl, task.primary.filePath, {
		app: callbacks.app,
		getSettings: callbacks.getSettings,
		getPipelines: callbacks.getPipelines,
		getAllTasks: callbacks.getAllTasks,
		getFileTaskByPath: callbacks.getFileTaskByPath,
		getDescendantTaskSummary: callbacks.getDescendantTaskSummary,
		openTaskEditor: callbacks.openEditor,
		cycleStatus: (operonId) => { void callbacks.cycleStatus(operonId); },
		onContextualAction: callbacks.onContextualAction,
		isTaskPinned: callbacks.isTaskPinned,
		isTaskTracking: callbacks.isTaskTracking,
		toggleTimer: callbacks.toggleTimer,
		requestSubtask: callbacks.requestSubtask,
	});
}

function applyCompactChipVisualStyles(
	chip: HTMLElement,
	entry: InlineTaskCompactChipEntry,
	task: IndexedTask,
	callbacks: ReadingTaskRowCallbacks,
	statusColor: string,
	taskColor: string | null,
): void {
	if (taskColor) chip.style.setProperty('--operon-live-hover-border', taskColor);
	if (entry.colorRole === 'priority') {
		const def = callbacks.getPriorities().find((priority) => priority.label === task.fieldValues['priority']);
		if (def) chip.style.setProperty('--operon-live-chip-color', def.color);
	}
	if (entry.colorRole === 'status') {
		chip.style.setProperty('--operon-live-chip-color', statusColor);
	}
	if (entry.iconTone === 'today') {
		chip.setCssProps({ '--operon-inline-chip-icon-color': '#2563eb' });
	} else if (entry.iconTone === 'overdue') {
		chip.setCssProps({ '--operon-inline-chip-icon-color': '#dc2626' });
	}
}

function attachReadingChipAction(
	chip: HTMLElement,
	entry: InlineTaskCompactChipEntry,
	task: IndexedTask,
	callbacks: ReadingTaskRowCallbacks,
	onCommit?: () => void,
	taskColor?: string | null,
): void {
	chip.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		if (entry.iconOnly && shouldOpenIconOnlyChipPreview(chip)) {
			openIconOnlyChipPreview(chip);
			return;
		}
		switch (entry.key) {
			case 'status':
				runReadingRowStatusCycle(callbacks, task.operonId);
				onCommit?.();
				break;
			case 'priority':
					showPriorityPicker(chip, {
						priorities: callbacks.getPriorities(),
						value: task.fieldValues['priority'],
						onSelect: (next) => {
							void callbacks.updateField(task.operonId, 'priority', next);
							onCommit?.();
						},
						onClear: () => {
							void callbacks.updateField(task.operonId, 'priority', '');
							onCommit?.();
						},
				});
				break;
			case 'dateStarted':
			case 'dateDue':
			case 'dateScheduled':
				showDatePicker(chip, {
					app: callbacks.app,
						fieldKey: entry.key,
						value: task.fieldValues[entry.key],
						onSelect: (next) => {
							void callbacks.updateField(task.operonId, entry.key, next);
							onCommit?.();
						},
						canRemove: !!task.fieldValues[entry.key],
						onRemove: () => {
							void callbacks.updateField(task.operonId, entry.key, '');
							onCommit?.();
						},
				});
				break;
			case 'assignees':
			case 'contexts':
			case 'parentTask':
			case 'blocking':
			case 'blockedBy':
				if (entry.linkTarget) {
					void callbacks.app.workspace.openLinkText(entry.linkTarget, task.primary.filePath, false);
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
					showEstimatePicker(chip, {
						value: task.fieldValues['estimate'],
						onSelect: (next) => {
							void callbacks.updateField(task.operonId, 'estimate', next);
							onCommit?.();
						},
						canRemove: !!task.fieldValues['estimate'],
						onRemove: () => {
							void callbacks.updateField(task.operonId, 'estimate', '');
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
	if (taskColor) chip.style.setProperty('--operon-live-hover-border', taskColor);
}

function renderTaskIcon(
	container: HTMLElement,
	task: IndexedTask,
	callbacks: ReadingTaskRowCallbacks,
): void {
	setIcon(container, resolveTaskDisplayIcon(callbacks.getSettings(), task.fieldValues, task.checkbox));
}

function runReadingRowStatusCycle(callbacks: ReadingTaskRowCallbacks, operonId: string): void {
	void Promise.resolve(callbacks.cycleStatus(operonId)).catch(error => {
		console.error('Operon: reading task status cycle failed', error);
	});
}

function lookupStatusColor(statusValue: string | undefined, pipelines: Pipeline[]): string {
	if (!statusValue) return '#6b7280';
	const parsed = parseStatusValue(statusValue);
	if (!parsed) return '#6b7280';
	const pipeline = pipelines.find((candidate) => candidate.name === parsed.pipeline);
	if (!pipeline) return '#6b7280';
	const status = pipeline.statuses.find((candidate) => candidate.label === parsed.status);
	return status?.color ?? '#6b7280';
}

function normalizeTaskColor(taskColor: string | undefined): string | null {
	if (!taskColor) return null;
	const trimmed = taskColor.trim();
	if (!trimmed) return null;
	return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
}

function resolveTerminalVisualState(
	task: IndexedTask,
	pipelines: Pipeline[],
): 'done' | 'cancelled' | null {
	if (task.checkbox === 'cancelled' || !!task.fieldValues['dateCancelled']?.trim()) {
		return 'cancelled';
	}
	if (task.checkbox === 'done' || !!task.fieldValues['dateCompleted']?.trim()) {
		return 'done';
	}
	const workflow = resolveWorkflowStatus(pipelines, task.fieldValues['status']);
	if (workflow?.definition.isFinished === true) return 'done';
	if (workflow?.definition.isCancelled === true) return 'cancelled';
	return null;
}

function parsedTaskFromIndexed(task: IndexedTask): ParsedTask {
	const fields = Object.entries(task.fieldValues).map(([key, value]) => ({
		sourceKey: key,
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
		description: task.description,
		descriptionRange: { from: 0, to: 0 },
		fields,
		tags: task.tags,
		tagTokens: [],
		metadataTailRange: null,
		operonId: task.operonId,
		rawLine: '',
		timePrefix: null,
		timePrefixRange: null,
	};
}

function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className?: string,
	owner?: Node | null,
): HTMLElementTagNameMap[K] {
	const element = createOwnerElement(owner, tag);
	if (className) element.className = className;
	return element;
}
