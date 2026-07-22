import { App, setIcon } from 'obsidian';
import { IndexedTask } from '../types/fields';
import { showDatePicker, type ManualDatePickerOptions } from './field-pickers/date-picker';
import { showPriorityPicker } from './field-pickers/priority-picker';
import { showEstimatePicker } from './field-pickers/estimate-picker';
import { InlineTaskCompactChipItem, OperonSettings, resolveTaskDisplayIcon } from '../types/settings';
import { findStatusDef, Pipeline, resolveWorkflowStatus } from '../types/pipeline';
import {
	buildWorkflowStatusIdentityIndex,
	type WorkflowStatusIdentityIndex,
} from '../core/workflow-status-identity';
import { PriorityDefinition } from '../types/priority';
import {
	buildInlineTaskCompactChipEntries,
	createInlineTaskCompactChipElement,
	InlineTaskCompactChipEntry,
	shouldResolveLocationCompactChips,
} from './compact-task-layout';
import { bindOperonHoverTooltip, createNonInteractiveMarkdownLinkContent, createOperonHoverIndicator, wrapWithOperonHoverTooltip } from './operon-hover-tooltip';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { bindTaskContextualHoverMenu } from './contextual-hover-menu';
import type { ContextualMenuActionHandler } from '../core/contextual-menu-engine';
import { getConfiguredKeyMappingIcon } from '../core/key-mapping-icons';
import { getLocationPlaceIndex } from '../core/location-source-resolver';
import { openObsidianTagSearch } from './tag-search';
import { bindCompactChipLinkPreview } from './compact-chip-link-preview';
import { bindExternalLinkContextMenu, openExternalUrl } from './external-link-actions';
import { showLocationMapPreview } from './location-map-preview';
import type { ProjectSerialDisplay } from '../core/project-serials';
import { createProjectSerialChipElement } from './project-serial-chip';
import {
	bindAdaptiveIconOnlyExpansion,
	bindIconOnlyChipPreview,
	closeIconOnlyChipPreview,
	isIconOnlyChipExpansionSuppressed,
	openIconOnlyChipPreview,
	shouldOpenIconOnlyChipPreview,
} from './icon-only-chip-preview';
import { t } from '../core/i18n';
import { createOwnerElement, getOwnerWindow } from '../core/dom-compat';
import { resolveSubtaskActionIcon, resolveSubtaskActionLabelKey } from '../core/subtask-action';
import { resolveTaskDateToneColor } from '../core/task-date-tone';
import { resolveTaskStatusIconColor } from '../core/task-color-source';
import type { InlineRepeatCompletionMode } from '../storage/repeat-series-store';
import type { DescendantTaskSummary } from '../indexer/indexer';
import { enhanceReadingTaskFileWikilinks } from './reading-task-wikilink-overlay';
import { isTaskDescriptionWikilinkEventTarget, renderTaskDescriptionWikilinks } from './task-description-wikilinks';
import { openTaskFieldPicker } from './task-field-picker-dispatch';
import { getCustomFieldMapping, isProjectedCustomFieldType } from './custom-field-surfaces';
import { createTaskNoteActionButton, showTaskNotePopover } from './task-note-action';

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
	updateField: (operonId: string, key: string, value: string) => void | boolean | Promise<void | boolean>;
	onContextualAction?: ContextualMenuActionHandler;
	isTaskPinned?: (taskId: string) => boolean;
	isTaskTracking?: (taskId: string) => boolean;
	toggleTimer?: (taskId: string) => void | Promise<void>;
	requestSubtask?: (operonId: string) => void | Promise<void>;
	updateFields?: (operonId: string, payload: Record<string, string>) => void | boolean | Promise<void | boolean>;
	updateSubtasks?: (operonId: string, subtaskIds: string[]) => void;
	updateDependencyField?: (operonId: string, field: 'blocking' | 'blockedBy', value: string) => void;
	getRepeatSeriesInlineCompletionMode?: (repeatSeriesId: string) => InlineRepeatCompletionMode;
	updateRepeatSeriesInlineCompletionMode?: (operonId: string, mode: InlineRepeatCompletionMode) => void | Promise<void>;
	getRepeatSkipDates?: (repeatSeriesId: string) => string[];
	getProjectSerialDisplay?: (operonId: string, task?: IndexedTask) => ProjectSerialDisplay | null;
}

const READING_DIRECT_CHIP_DAY_PICKER_DATE_KEYS = new Set<string>([
	'dateStarted',
	'dateScheduled',
	'dateDue',
	'dateCompleted',
	'dateCancelled',
]);

function getReadingDirectChipManualDatePickerOptions(key: string, settings: OperonSettings): ManualDatePickerOptions | undefined {
	if (!READING_DIRECT_CHIP_DAY_PICKER_DATE_KEYS.has(key)) return undefined;
	return {
		weekStart: settings.calendarWeekStart,
		showWeekNumbers: settings.calendarSidebarShowWeekNumbers,
	};
}

function getMobileStableLocationPreviewAnchor(anchor: HTMLElement): HTMLElement | DOMRect {
	const ownerWindow = getOwnerWindow(anchor);
	const isMobileLike = typeof ownerWindow.matchMedia === 'function'
		? ownerWindow.matchMedia('(max-width: 720px), (hover: none), (pointer: coarse)').matches
		: ownerWindow.innerWidth <= 720;
	if (!isMobileLike) return anchor;

	const rect = anchor.getBoundingClientRect();
	const DOMRectCtor = (ownerWindow as Window & { DOMRect?: typeof DOMRect }).DOMRect ?? DOMRect;
	return new DOMRectCtor(rect.left, rect.top, Math.max(rect.width, 1), Math.max(rect.height, 1));
}

export interface ReadingTaskRowOptions {
	owner?: Node | null;
	workflowStatusIdentityIndex?: WorkflowStatusIdentityIndex;
	chipItems?: InlineTaskCompactChipItem[];
	projectSerialPlacement?: 'head' | 'tail';
	readOnly?: boolean;
	showPlayAction?: boolean;
	showPinAction?: boolean;
	showNoteAction?: boolean;
	showSubtaskAction?: boolean;
	showEditAction?: boolean;
	rowClassName?: string;
	beforeTailContent?: (tail: HTMLElement, context: {
		task: IndexedTask;
		taskColor: string | null;
		isTerminal: boolean;
	}) => void;
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
	const row = el('div', 'operon-reading-task-row operon-task-chip-surface', owner);
	if (options?.rowClassName) row.classList.add(options.rowClassName);
	const readOnly = options?.readOnly === true;
	if (readOnly) row.classList.add('is-read-only');
	const head = el('div', 'operon-reading-task-head', row);
	const tail = el('div', 'operon-reading-task-tail', row);

	const taskColor = normalizeTaskColor(task.fieldValues['taskColor']);
	if (taskColor) row.style.setProperty('--operon-live-hover-border', taskColor);
	if (taskColor) row.style.setProperty('--operon-task-chip-hover-accent', taskColor);
	const pipelines = callbacks.getPipelines();
	const workflowStatusIdentityIndex = options?.workflowStatusIdentityIndex
		?? buildWorkflowStatusIdentityIndex(pipelines);
	const statusColor = lookupStatusColor(task.fieldValues['status'], pipelines, workflowStatusIdentityIndex);
	const terminalVisualState = resolveTerminalVisualState(task, pipelines, workflowStatusIdentityIndex);
	const isTerminal = terminalVisualState !== null;
	if (terminalVisualState === 'done') {
		row.classList.add('operon-filter-row-done');
	} else if (terminalVisualState === 'cancelled') {
		row.classList.add('operon-filter-row-cancelled');
	}

	const iconButton = readOnly
		? el('span', 'operon-live-preview-status-icon operon-reading-task-icon', row)
		: el('button', 'operon-live-preview-status-icon operon-reading-task-icon', row);
	if (!readOnly) (iconButton as HTMLButtonElement).type = 'button';
	else iconButton.setAttribute('aria-hidden', 'true');
	const iconColor = resolveTaskStatusIconColor(
		task.fieldValues,
		callbacks.getSettings(),
		workflowStatusIdentityIndex,
	);
	if (iconColor) iconButton.style.setProperty('--operon-live-icon-color', iconColor);
	else iconButton.style.removeProperty('--operon-live-icon-color');
	renderTaskIcon(iconButton, task, callbacks, workflowStatusIdentityIndex);
	if (!readOnly) {
		iconButton.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			runReadingRowStatusCycle(callbacks, task.operonId);
		});
	}
	if (!readOnly && callbacks.onContextualAction) {
		bindTaskContextualHoverMenu(iconButton, {
			surface: 'readingRow',
			taskId: task.operonId,
			getTask: () => task,
			getSettings: callbacks.getSettings,
			onAction: callbacks.onContextualAction,
			isPinned: callbacks.isTaskPinned ? () => callbacks.isTaskPinned?.(task.operonId) === true : undefined,
			hasSubtasks: callbacks.getDescendantTaskSummary
				? () => callbacks.getDescendantTaskSummary?.(task.operonId).hasDescendants === true
				: undefined,
		});
	}
	head.appendChild(iconButton);
	const projectSerialDisplay = callbacks.getProjectSerialDisplay?.(task.operonId, task) ?? null;
	const projectSerialPlacement = options?.projectSerialPlacement ?? 'tail';
	if (projectSerialDisplay && projectSerialPlacement === 'head') {
		head.appendChild(createProjectSerialChipElement(projectSerialDisplay, 'operon-reading-task-chip operon-task-chip', {
			keyMappings: callbacks.getSettings().keyMappings,
		}));
	}

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

	options?.beforeTailContent?.(tail, {
		task,
		taskColor,
		isTerminal,
	});

	if (projectSerialDisplay && projectSerialPlacement === 'tail') {
		tail.appendChild(createProjectSerialChipElement(projectSerialDisplay, 'operon-reading-task-chip operon-task-chip', {
			keyMappings: callbacks.getSettings().keyMappings,
		}));
	}

	const settings = callbacks.getSettings();
	const locationResolver = shouldResolveLocationCompactChips(settings, options?.chipItems)
		? getLocationPlaceIndex(callbacks.app, settings).resolve
		: undefined;
	const entries = buildInlineTaskCompactChipEntries(
		task.fieldValues,
		task.tags,
		settings,
		callbacks.getAllTasks(),
		options?.chipItems,
		locationResolver,
		{
			app: callbacks.app,
			repeatSkipDateResolver: callbacks.getRepeatSkipDates,
			workflowStatusIdentityIndex,
		},
	);
	for (const entry of entries) {
		const renderEntry = readOnly && entry.interactive ? { ...entry, interactive: false } : entry;
		const chip = createInlineTaskCompactChipElement(renderEntry, 'operon-reading-task-chip operon-task-chip');
		applyCompactChipVisualStyles(chip, renderEntry, task, callbacks, statusColor, taskColor);
		if (renderEntry.iconOnly) {
			bindAdaptiveIconOnlyExpansion(chip, renderEntry.label, taskColor ?? null);
			if (renderEntry.externalUrl) {
				bindExternalLinkContextMenu(chip, renderEntry.externalUrl, renderEntry.externalRawValue);
			}
			if (renderEntry.tooltipContent) {
				bindOperonHoverTooltip(chip, {
					title: renderEntry.tooltipTitle ?? t('taskEditor', 'details'),
					content: renderEntry.tooltipContent,
					taskColor,
					shouldOpen: () => isIconOnlyChipExpansionSuppressed(chip),
				});
			}
			if (renderEntry.interactive) {
				attachReadingChipAction(chip, renderEntry, task, callbacks, () => closeIconOnlyChipPreview(chip), taskColor);
			} else {
				bindIconOnlyChipPreview(chip);
			}
			const previewLinkTarget = renderEntry.previewLinkTarget ?? renderEntry.linkTarget;
			if (previewLinkTarget) {
				bindCompactChipLinkPreview(callbacks.app, chip, previewLinkTarget, task.primary.filePath);
			}
			tail.appendChild(chip);
			continue;
		}
		if (renderEntry.interactive) {
			attachReadingChipAction(chip, renderEntry, task, callbacks, undefined, taskColor);
		}
		const chipNode = renderEntry.tooltipContent
			? wrapWithOperonHoverTooltip(chip, {
				title: renderEntry.tooltipTitle ?? t('taskEditor', 'details'),
				content: renderEntry.tooltipContent,
				taskColor,
			})
			: chip;
		if (renderEntry.externalUrl) {
			bindExternalLinkContextMenu(chip, renderEntry.externalUrl, renderEntry.externalRawValue);
		}
		const previewLinkTarget = renderEntry.previewLinkTarget ?? renderEntry.linkTarget;
		if (previewLinkTarget) {
			bindCompactChipLinkPreview(callbacks.app, chip, previewLinkTarget, task.primary.filePath);
		}
		tail.appendChild(chipNode);
	}

	const actions = el('div', 'operon-reading-task-actions', row);

	const showPlayAction = !readOnly && (options?.showPlayAction ?? callbacks.getSettings().inlineTaskShowPlayAction);
	const showPinAction = !readOnly && (options?.showPinAction ?? callbacks.getSettings().inlineTaskShowPinAction);
	const showNoteAction = options?.showNoteAction ?? callbacks.getSettings().inlineTaskShowNoteAction;
	const showSubtaskAction = !readOnly && (options?.showSubtaskAction ?? callbacks.getSettings().inlineTaskShowSubtaskAction);
	const showEditAction = !readOnly && (options?.showEditAction ?? true);

	if (!isTerminal && callbacks.requestSubtask && showSubtaskAction) {
		const subtaskLabel = t('buttons', resolveSubtaskActionLabelKey(task));
		const subtaskButton = el('button', 'operon-live-preview-edit operon-reading-task-edit operon-live-preview-action operon-task-chip-action', row);
		subtaskButton.type = 'button';
		setIcon(subtaskButton, resolveSubtaskActionIcon(task));
		setAccessibleLabelWithoutTooltip(subtaskButton, subtaskLabel);
		bindOperonHoverTooltip(subtaskButton, {
			content: subtaskLabel,
			taskColor,
		});
		subtaskButton.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			void callbacks.requestSubtask?.(task.operonId);
		});
		if (taskColor) subtaskButton.style.setProperty('--operon-live-hover-border', taskColor);
		actions.appendChild(subtaskButton);
	}

	if (!readOnly) {
		options?.beforeEditAction?.(actions, {
			task,
			taskColor,
			isTerminal,
		});
	}

	if (!isTerminal && callbacks.onContextualAction && showPinAction) {
		const isPinned = callbacks.isTaskPinned?.(task.operonId) === true;
		const pinButton = el('button', 'operon-live-preview-edit operon-reading-task-edit operon-live-preview-action operon-task-chip-action', row);
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

	if (!isTerminal && callbacks.toggleTimer && showPlayAction && task.checkbox === 'open') {
		const isTracking = callbacks.isTaskTracking?.(task.operonId) === true;
		const playButton = el('button', 'operon-live-preview-edit operon-reading-task-edit operon-live-preview-action operon-task-chip-action operon-task-timer-action', row);
		playButton.type = 'button';
		if (isTracking) playButton.classList.add('is-active');
		setIcon(playButton, isTracking ? 'square' : 'play');
		const timerLabel = t('tooltips', isTracking ? 'stopTimer' : 'startTimer');
		setAccessibleLabelWithoutTooltip(playButton, timerLabel);
		bindOperonHoverTooltip(playButton, {
			content: timerLabel,
			taskColor,
		});
		playButton.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			void callbacks.toggleTimer?.(task.operonId);
		});
		if (taskColor) playButton.style.setProperty('--operon-live-hover-border', taskColor);
		actions.appendChild(playButton);
	}

	const noteValue = task.fieldValues['note']?.trim() ?? '';
	if (showNoteAction && readOnly && noteValue) {
		const noteIndicator = createOperonHoverIndicator({
			title: t('taskEditor', 'notes'),
			contentEl: createNonInteractiveMarkdownLinkContent(actions, noteValue),
			icon: getConfiguredKeyMappingIcon('note', callbacks.getSettings().keyMappings) || 'notebook-pen',
			taskColor,
			preferredHorizontal: 'right',
		});
		noteIndicator.querySelector('.operon-hover-trigger')?.classList.add('operon-reading-task-note-neutral', 'operon-task-chip-action');
		actions.appendChild(noteIndicator);
	} else if (showNoteAction && !readOnly && (!isTerminal || noteValue)) {
		const noteButton = createTaskNoteActionButton({
			owner: row,
			noteValue,
			icon: getConfiguredKeyMappingIcon('note', callbacks.getSettings().keyMappings) || 'notebook-pen',
			label: t('taskEditor', noteValue ? 'editNote' : 'addNote'),
			tooltipTitle: t('taskEditor', 'notes'),
			taskColor,
			neutral: true,
			classNames: 'operon-reading-task-edit operon-reading-task-note-action operon-reading-task-note-neutral',
			onActivate: (anchor) => {
				showTaskNotePopover({
					app: callbacks.app,
					anchor,
					operonId: task.operonId,
					initialValue: noteValue,
					taskDescription: task.description,
					taskColor,
					onCommit: value => callbacks.updateField(task.operonId, 'note', value),
					onClose: () => {
						if (noteButton.isConnected) noteButton.focus();
					},
				});
			},
		});
		actions.appendChild(noteButton);
	}

	if (showEditAction) {
		const editButton = el('button', 'operon-live-preview-edit operon-reading-task-edit operon-task-chip-action', row);
		editButton.type = 'button';
		setIcon(editButton, 'settings-2');
		const editLabel = t('tooltips', 'editTask');
		setAccessibleLabelWithoutTooltip(editButton, editLabel);
		bindOperonHoverTooltip(editButton, {
			content: editLabel,
			taskColor,
		});
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
		getProjectSerialDisplay: callbacks.getProjectSerialDisplay,
		getRepeatSkipDates: callbacks.getRepeatSkipDates,
	}, {
		sourceText: task.description,
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
	const hoverColor = taskColor ?? entry.taskColor;
	if (hoverColor) {
		chip.style.setProperty('--operon-live-hover-border', hoverColor);
		chip.style.setProperty('--operon-task-chip-hover-accent', hoverColor);
	}
	if (entry.colorRole === 'priority') {
		const def = callbacks.getPriorities().find((priority) => priority.label === task.fieldValues['priority']);
		if (def) chip.style.setProperty('--operon-inline-chip-icon-color', def.color);
	}
	if (entry.colorRole === 'status') {
		chip.style.setProperty('--operon-inline-chip-icon-color', statusColor);
	}
	if (entry.key === 'location') {
		const locationIconColor = entry.locationMarkerColor ?? taskColor;
		if (locationIconColor) chip.style.setProperty('--operon-inline-chip-icon-color', locationIconColor);
	}
	const dateToneColor = resolveTaskDateToneColor(entry.iconTone ?? 'default');
	if (dateToneColor) chip.setCssProps({ '--operon-inline-chip-icon-color': dateToneColor });
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
		const reminderItem = entry.reminderItem;
		if (reminderItem) {
			openTaskFieldPicker({
				app: callbacks.app,
				settings: callbacks.getSettings(),
				allTasks: callbacks.getAllTasks(),
				canonicalKey: reminderItem.fieldKey,
				anchor: chip,
				currentFieldValues: task.fieldValues,
				getCurrentFieldValues: () => {
					const currentTask = callbacks.getAllTasks().find(candidate => candidate.operonId === task.operonId);
					return currentTask?.fieldValues ?? {
						...task.fieldValues,
						[reminderItem.fieldKey]: '',
					};
				},
				currentTags: task.tags,
				sourcePath: task.primary.filePath,
				taskFormat: task.primary.format,
				reminderOperation: {
					kind: 'edit',
					item: { index: reminderItem.index, rawValue: reminderItem.rawValue },
				},
				onCommit: payload => {
					const value = payload[reminderItem.fieldKey];
					if (typeof value !== 'string') return;
					void callbacks.updateField(task.operonId, reminderItem.fieldKey, value);
					onCommit?.();
				},
			});
			return;
		}
		switch (entry.key) {
			case 'location':
				if (entry.locationCoordinate) {
					showLocationMapPreview(
						callbacks.app,
						getMobileStableLocationPreviewAnchor(chip),
						callbacks.getSettings(),
						entry.locationCoordinate,
						task.primary.filePath,
						entry.taskColor ?? null,
						entry.locationMarkerIcon ?? null,
						entry.locationMarkerColor ?? null,
						entry.linkTarget ?? null,
						task.description,
					);
					onCommit?.();
				}
				break;
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
			case 'dateCompleted':
			case 'dateCancelled':
				showDatePicker(chip, {
					app: callbacks.app,
						fieldKey: entry.key,
						value: task.fieldValues[entry.key],
						manualDatePicker: getReadingDirectChipManualDatePickerOptions(entry.key, callbacks.getSettings()),
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
			case 'repeat': {
				const settings = callbacks.getSettings();
				openTaskFieldPicker({
					app: callbacks.app,
					settings,
					allTasks: callbacks.getAllTasks(),
					canonicalKey: 'repeat',
					anchor: chip,
					currentFieldValues: task.fieldValues,
					currentTags: task.tags,
					sourcePath: task.primary.filePath,
					taskFormat: task.primary.format,
					repeatInlineCompletionMode: callbacks.getRepeatSeriesInlineCompletionMode?.(task.fieldValues['repeatSeriesId'] ?? ''),
					onRepeatInlineCompletionModeChange: mode => callbacks.updateRepeatSeriesInlineCompletionMode?.(task.operonId, mode),
					onCommit: payload => {
						const normalizedPayload = Object.fromEntries(
							Object.entries(payload).map(([key, value]) => [
								key,
								Array.isArray(value) ? value.join('; ') : value,
							]),
						);
						if (callbacks.updateFields) {
							void callbacks.updateFields(task.operonId, normalizedPayload);
						} else {
							for (const [key, value] of Object.entries(normalizedPayload)) {
								void callbacks.updateField(task.operonId, key, value);
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
					void callbacks.app.workspace.openLinkText(entry.linkTarget, task.primary.filePath, false);
					onCommit?.();
					return;
				}
				openTaskFieldPicker({
					app: callbacks.app,
					settings,
					allTasks: callbacks.getAllTasks(),
					canonicalKey: entry.key,
					anchor: chip,
					currentFieldValues: task.fieldValues,
					currentTags: task.tags,
					sourcePath: task.primary.filePath,
					taskFormat: task.primary.format,
					onCommit: payload => {
						const normalizedPayload = Object.fromEntries(
							Object.entries(payload).map(([key, value]) => [
								key,
								Array.isArray(value) ? value.join('; ') : value,
							]),
						);
						if (callbacks.updateFields) {
							void callbacks.updateFields(task.operonId, normalizedPayload);
						} else {
							for (const [key, value] of Object.entries(normalizedPayload)) {
								void callbacks.updateField(task.operonId, key, value);
							}
						}
						onCommit?.();
					},
				});
				break;
			}
		}
	});
	if (taskColor) chip.style.setProperty('--operon-live-hover-border', taskColor);
}

function renderTaskIcon(
	container: HTMLElement,
	task: IndexedTask,
	callbacks: ReadingTaskRowCallbacks,
	workflowStatusIdentityIndex: WorkflowStatusIdentityIndex,
): void {
	setIcon(container, resolveTaskDisplayIcon(
		callbacks.getSettings(),
		task.fieldValues,
		task.checkbox,
		workflowStatusIdentityIndex,
	));
}

function runReadingRowStatusCycle(callbacks: ReadingTaskRowCallbacks, operonId: string): void {
	void Promise.resolve(callbacks.cycleStatus(operonId)).catch(error => {
		console.error('Operon: reading task status cycle failed', error);
	});
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
	task: IndexedTask,
	pipelines: Pipeline[],
	workflowStatusIdentityIndex: WorkflowStatusIdentityIndex,
): 'done' | 'cancelled' | null {
	const workflow = resolveWorkflowStatus(pipelines, task.fieldValues['status'], workflowStatusIdentityIndex);
	if (workflow) {
		if (workflow.checkbox === 'done') return 'done';
		if (workflow.checkbox === 'cancelled') return 'cancelled';
		return null;
	}
	if (task.checkbox === 'cancelled' || !!task.fieldValues['dateCancelled']?.trim()) {
		return 'cancelled';
	}
	if (task.checkbox === 'done' || !!task.fieldValues['dateCompleted']?.trim()) {
		return 'done';
	}
	return null;
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
