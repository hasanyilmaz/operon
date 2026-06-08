/**
 * Inline Task Bar — CodeMirror 6 Live Preview rendering.
 * Replaces raw task lines with styled visual bars in Live Preview mode.
 *
 * Two-line layout:
 * - Line 1: task description
 * - Line 2: chips (filtered by settings) + action buttons
 * - Left icon spans both lines (25x25px, transparent border)
 * - Subtask expand/collapse with recursive rendering
 * - Clickable chips for inline editing (dates, priority)
 *
 * Architecture:
 * - CM6 ViewPlugin scans visible lines for Operon task patterns
 * - Replaces matching line ranges with WidgetType decorations
 * - Widget renders HTML for the visual task bar
 */

import {
	EditorView,
	ViewPlugin,
	ViewUpdate,
	Decoration,
	DecorationSet,
	WidgetType,
} from '@codemirror/view';
import { RangeSetBuilder, Extension, StateEffect } from '@codemirror/state';
import { editorLivePreviewField, setIcon } from 'obsidian';
import { parseTaskLine } from '../core/parser';
import { ParsedTask, IndexedTask } from '../types/fields';
import { Pipeline, parseStatusValue } from '../types/pipeline';
import { PriorityDefinition } from '../types/priority';
import { OperonSettings, resolveTaskDisplayIcon } from '../types/settings';
import { t } from '../core/i18n';
import { localToday } from '../core/local-time';
import { showDatePicker as showSharedDatePicker } from './field-pickers/date-picker';
import { bindTaskContextualHoverMenu } from './contextual-hover-menu';
import type { ContextualMenuActionId } from '../core/contextual-menu-engine';
import { bindOperonHoverTooltip } from './operon-hover-tooltip';
import { createOwnerElement, getOwnerBody, getOwnerDocument, getOwnerWindow } from '../core/dom-compat';

// ============================================================
// Shared full task-card builder — used by filter surfaces only
// ============================================================

export interface TaskBarCallbacks {
	getPipelines: () => Pipeline[];
	getPriorities: () => PriorityDefinition[];
	getIndexedTask: (id: string) => IndexedTask | undefined;
	getChildIds: (parentId: string) => string[];
	openEditor: (operonId: string) => void;
	toggleCheckbox: (operonId: string) => void;
	cycleStatus: (operonId: string) => void;
	navigateToTask: (task: IndexedTask) => void;
	getSettings: () => OperonSettings;
	updateField: (operonId: string, key: string, value: string) => void;
	onContextualAction?: (taskId: string, actionId: ContextualMenuActionId) => void | Promise<void>;
	isTaskPinned?: (taskId: string) => boolean;
}

/**
 * Dispatch this effect on a CM6 EditorView to force task bar decorations
 * to rebuild with fresh index data. Used by refreshViews() after reindex.
 */
export const operonIndexRefreshEffect = StateEffect.define<void>();

/** Track which task subtask lists are expanded (module-level state) */
const expandedTasks = new Set<string>();
let expandedDefaultApplied = false;
const elementOwnerStack: Array<Node | null | undefined> = [];

/**
 * Build a task bar DOM element from an IndexedTask.
 * Returns a wrapper <span> containing the bar and optional subtask list.
 */
export function buildTaskBarElement(
	task: IndexedTask,
	cbs: TaskBarCallbacks,
	context: 'filter' | 'file' = 'filter',
	owner?: Node | null,
): HTMLElement {
	return withElementOwner(owner, () => buildTaskBarElementInner(task, cbs, context));
}

function buildTaskBarElementInner(task: IndexedTask, cbs: TaskBarCallbacks, context: 'filter' | 'file'): HTMLElement {
	const wrapper = el('span', 'operon-task-bar-wrapper');

	const bar = el('span', 'operon-task-bar');

	// Color background with parent inheritance
	const color = resolveInheritedFieldFromIndex(task, 'taskColor', cbs.getIndexedTask);
	if (color) {
		const hex = color.startsWith('#') ? color : `#${color}`;
		bar.style.backgroundColor = `${hex}15`;
	}

	// Icon section: status-cycle icon (spans both lines)
	const iconSection = el('span', 'operon-bar-icon');
	bar.appendChild(iconSection);
	renderIconButtonFromIndex(iconSection, task, cbs);

	// Content section: two lines
	const content = el('span', 'operon-bar-content');
	bar.appendChild(content);

	// Line 1: description only
	const line1 = el('span', 'operon-bar-line1');
	content.appendChild(line1);
	renderDescriptionFromIndex(line1, task);

	// Line 2: chips + actions
	const line2 = el('span', 'operon-bar-line2');
	content.appendChild(line2);

	const chipsSection = el('span', 'operon-bar-chips');
	line2.appendChild(chipsSection);
	renderChipsFiltered(chipsSection, task, cbs);

	// Actions section
	const actionsSection = el('span', 'operon-bar-actions');
	line2.appendChild(actionsSection);

	// Navigation icon
	renderNavigationIcon(actionsSection, task, cbs);

	// Children toggle (only in filter context — file views show single-line bars)
	const childIds = context === 'filter' ? cbs.getChildIds(task.operonId) : [];
	const hasChildren = childIds.length > 0;

	if (hasChildren) {
		// Apply default expanded state on first render
		if (!expandedDefaultApplied) {
			expandedDefaultApplied = true;
		}
		const settings = cbs.getSettings();
		if (settings.taskBarSubtasksDefaultExpanded && !expandedTasks.has(`__init_${task.operonId}`)) {
			expandedTasks.add(task.operonId);
			expandedTasks.add(`__init_${task.operonId}`);
		}

		const childBtn = el('button', 'operon-action-btn operon-children-btn');
		setIcon(childBtn, 'folder');
		bindOperonHoverTooltip(childBtn, { content: t('tooltips', 'expandSubtasks'), taskColor: null });
		if (expandedTasks.has(task.operonId)) {
			childBtn.classList.add('is-expanded');
		}
		childBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			if (expandedTasks.has(task.operonId)) {
				expandedTasks.delete(task.operonId);
				childBtn.classList.remove('is-expanded');
			} else {
				expandedTasks.add(task.operonId);
				childBtn.classList.add('is-expanded');
			}
			const subtaskList = wrapper.querySelector('.operon-subtask-list');
			if (subtaskList) {
				subtaskList.classList.toggle('is-collapsed');
			}
		});
		actionsSection.appendChild(childBtn);
	}

	// Edit button
	const editBtn = el('button', 'operon-action-btn operon-edit-btn');
	setIcon(editBtn, 'pencil');
	bindOperonHoverTooltip(editBtn, { content: t('tooltips', 'editTask'), taskColor: null });
	editBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		cbs.openEditor(task.operonId);
	});
	actionsSection.appendChild(editBtn);

	wrapper.appendChild(bar);

	// Subtask list
	if (hasChildren) {
		const subtaskList = el('span', 'operon-subtask-list');
		if (!expandedTasks.has(task.operonId)) {
			subtaskList.classList.add('is-collapsed');
		}
		renderSubtaskList(subtaskList, childIds, cbs, 0, context);
		wrapper.appendChild(subtaskList);
	}

	return wrapper;
}

function renderSubtaskList(container: HTMLElement, childIds: string[], cbs: TaskBarCallbacks, depth: number, context: 'filter' | 'file' = 'filter'): void {
	if (depth >= 5) return; // Max nesting depth
	for (const childId of childIds) {
		const childTask = cbs.getIndexedTask(childId);
		if (!childTask) continue;
		const childEl = buildTaskBarElement(childTask, cbs, context, container);
		container.appendChild(childEl);
	}
}

function renderIconButtonFromIndex(container: HTMLElement, task: IndexedTask, cbs: TaskBarCallbacks): void {
	const statusValue = task.fieldValues['status'];
	const iconName = resolveInheritedFieldFromIndex(task, 'taskIcon', cbs.getIndexedTask);
	const fieldValues = iconName ? { ...task.fieldValues, taskIcon: iconName } : task.fieldValues;

	const statusColor = lookupStatusColorFromIndex(statusValue, cbs.getPipelines());

	const cb = el('button', `operon-checkbox operon-checkbox-${task.checkbox}`);
	cb.style.color = statusColor;
	setIcon(cb, resolveTaskDisplayIcon(cbs.getSettings(), fieldValues, task.checkbox));

	cb.addEventListener('click', (e) => {
		e.stopPropagation();
		cbs.cycleStatus(task.operonId);
	});
	if (cbs.onContextualAction) {
		bindTaskContextualHoverMenu(cb, {
			surface: 'filterTask',
			taskId: task.operonId,
			getTask: () => task,
			getSettings: cbs.getSettings,
			onAction: cbs.onContextualAction,
			isPinned: cbs.isTaskPinned ? () => cbs.isTaskPinned?.(task.operonId) === true : undefined,
		});
	}
	container.appendChild(cb);
}

function renderDescriptionFromIndex(container: HTMLElement, task: IndexedTask): void {
	const desc = el('span', 'operon-task-description');
	desc.textContent = task.description || t('taskEditor', 'untitledTask');

	if (task.checkbox === 'done') {
		desc.classList.add('operon-task-done');
	} else if (task.checkbox === 'cancelled') {
		desc.classList.add('operon-task-cancelled');
	}
	container.appendChild(desc);
}

function renderChipsFiltered(container: HTMLElement, task: IndexedTask, cbs: TaskBarCallbacks): void {
	const fv = task.fieldValues;
	const chips = cbs.getSettings().inlineExpandedTaskChips;

	// Tags (in line 2 now)
	if (chips.tags) {
		for (const tag of task.tags) {
			const tagEl = el('span', 'operon-tag-chip');
			tagEl.textContent = `#${tag}`;
			container.appendChild(tagEl);
		}
	}

	// Priority chip (clickable)
	const priority = fv['priority'];
	if (chips.priority && priority) {
		const chip = el('span', 'operon-chip operon-chip-priority operon-chip-clickable');
		chip.textContent = priority;
		const priorityDef = cbs.getPriorities().find(p => p.label === priority);
		if (priorityDef) chip.style.backgroundColor = priorityDef.color;
		chip.addEventListener('click', (e) => {
			e.stopPropagation();
			showPriorityDropdown(chip, task.operonId, cbs);
		});
		container.appendChild(chip);
	}

	// Status chip
	const status = fv['status'];
	if (chips.status && status) {
		const statusColor = lookupStatusColorFromIndex(status, cbs.getPipelines());
		const chip = el('span', 'operon-chip operon-chip-date operon-chip-clickable');
		chip.style.backgroundColor = statusColor;
		chip.textContent = status;
		chip.addEventListener('click', (e) => {
			e.stopPropagation();
			cbs.cycleStatus(task.operonId);
		});
		container.appendChild(chip);
	}

	// Due date chip (clickable)
	const due = fv['dateDue'];
	if (chips.dateDue && due) {
		const isOverdue = due < localToday();
		const chip = el('span', `operon-chip operon-chip-date operon-chip-clickable${isOverdue ? ' operon-chip-overdue' : ''}`);
		chip.textContent = `📅 ${due}`;
		chip.addEventListener('click', (e) => {
			e.stopPropagation();
			showInlineDatePicker(chip, task.operonId, 'dateDue', due, cbs);
		});
		container.appendChild(chip);
	}

	// Scheduled date chip (clickable)
	const scheduled = fv['dateScheduled'];
	if (chips.dateScheduled && scheduled) {
		const chip = el('span', 'operon-chip operon-chip-date operon-chip-clickable');
		chip.textContent = `📋 ${scheduled}`;
		chip.addEventListener('click', (e) => {
			e.stopPropagation();
			showInlineDatePicker(chip, task.operonId, 'dateScheduled', scheduled, cbs);
		});
		container.appendChild(chip);
	}

	// Start date chip (clickable)
	const started = fv['dateStarted'];
	if (chips.dateStarted && started) {
		const chip = el('span', 'operon-chip operon-chip-date operon-chip-clickable');
		chip.textContent = `🚀 ${started}`;
		chip.addEventListener('click', (e) => {
			e.stopPropagation();
			showInlineDatePicker(chip, task.operonId, 'dateStarted', started, cbs);
		});
		container.appendChild(chip);
	}

	// Assignees chip
	const assignees = fv['assignees'];
	if (chips.assignees && assignees) {
		const chip = el('span', 'operon-chip operon-chip-assignees');
		chip.textContent = `👤 ${assignees}`;
		container.appendChild(chip);
	}

	// Duration chip
	const duration = fv['duration'];
	if (chips.duration && duration) {
		const seconds = parseInt(duration, 10);
		if (seconds > 0) {
			const chip = el('span', 'operon-chip operon-chip-duration');
			chip.textContent = `⏱ ${formatDuration(seconds)}`;
			container.appendChild(chip);
		}
	}

	// Estimate chip
	const estimate = fv['estimate'];
	if (chips.estimate && estimate) {
		const seconds = parseInt(estimate, 10);
		if (seconds > 0) {
			const chip = el('span', 'operon-chip operon-chip-estimate');
			chip.textContent = t('taskEditor', 'estimateChip', { duration: formatDuration(seconds) });
			container.appendChild(chip);
		}
	}
}

function renderNavigationIcon(container: HTMLElement, task: IndexedTask, cbs: TaskBarCallbacks): void {
	const navBtn = el('button', 'operon-action-btn operon-nav-btn');
	const isFileTask = task.primary.format === 'yaml';
	setIcon(navBtn, isFileTask ? 'file-text' : 'file-code');
	bindOperonHoverTooltip(navBtn, {
		content: isFileTask ? t('tooltips', 'navigateToFile') : t('tooltips', 'navigateToLine'),
		taskColor: null,
	});
	navBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		cbs.navigateToTask(task);
	});
	container.appendChild(navBtn);
}

// ============================================================
// Inline chip editing — date picker and priority dropdown
// ============================================================

type InlineTaskBarDateKey = 'dateDue' | 'dateScheduled' | 'dateStarted';

function showInlineDatePicker(anchor: HTMLElement, operonId: string, fieldKey: InlineTaskBarDateKey, currentValue: string, cbs: TaskBarCallbacks): void {
	const settings = cbs.getSettings();
	showSharedDatePicker(anchor, {
		fieldKey,
		value: currentValue,
		manualDatePicker: {
			weekStart: settings.calendarWeekStart,
			showWeekNumbers: settings.calendarSidebarShowWeekNumbers,
		},
		onSelect: value => cbs.updateField(operonId, fieldKey, value),
		canRemove: !!currentValue,
		onRemove: () => cbs.updateField(operonId, fieldKey, ''),
	});
}

function showPriorityDropdown(anchor: HTMLElement, operonId: string, cbs: TaskBarCallbacks): void {
	const ownerDocument = getOwnerDocument(anchor);
	const ownerWindow = getOwnerWindow(anchor);
	const dropdown = el('div', 'operon-inline-priority-dropdown', anchor);

	const rect = anchor.getBoundingClientRect();
	dropdown.style.left = `${rect.left}px`;
	dropdown.style.top = `${rect.bottom + 2}px`;

	const cleanup = () => {
		dropdown.remove();
		ownerDocument.removeEventListener('click', outsideClick);
	};

	const outsideClick = (e: MouseEvent) => {
		if (!dropdown.contains(e.target as Node)) {
			cleanup();
		}
	};

	// Add "(none)" option
	const noneOption = el('div', 'operon-priority-option', dropdown);
	noneOption.textContent = t('taskEditor', 'priorityNone');
	noneOption.addEventListener('click', (e) => {
		e.stopPropagation();
		cbs.updateField(operonId, 'priority', '');
		cleanup();
	});
	dropdown.appendChild(noneOption);

	// Add priority options
	for (const p of cbs.getPriorities()) {
		const option = el('div', 'operon-priority-option', dropdown);
		const dot = el('span', 'operon-priority-dot', option);
		dot.style.backgroundColor = p.color;
		option.appendChild(dot);
		const label = el('span', '', option);
		label.textContent = p.label;
		option.appendChild(label);
		option.addEventListener('click', (e) => {
			e.stopPropagation();
			cbs.updateField(operonId, 'priority', p.label);
			cleanup();
		});
		dropdown.appendChild(option);
	}

	getOwnerBody(anchor).appendChild(dropdown);
	ownerWindow.requestAnimationFrame(() => {
		ownerDocument.addEventListener('click', outsideClick);
	});
}

// ============================================================
// Utility functions
// ============================================================

function resolveInheritedFieldFromIndex(
	task: IndexedTask,
	key: string,
	getIndexedTask: (id: string) => IndexedTask | undefined,
): string | undefined {
	const own = task.fieldValues[key];
	if (own) return own;
	let currentId = task.fieldValues['parentTask'];
	let depth = 0;
	while (currentId && depth < 20) {
		const ancestor = getIndexedTask(currentId);
		if (!ancestor) break;
		if (ancestor.fieldValues[key]) return ancestor.fieldValues[key];
		currentId = ancestor.fieldValues['parentTask'];
		depth++;
	}
	return undefined;
}

function lookupStatusColorFromIndex(statusValue: string | undefined, pipelines: Pipeline[]): string {
	if (!statusValue) return '#6b7280';
	const parsed = parseStatusValue(statusValue);
	if (!parsed) return '#6b7280';
	const pipeline = pipelines.find(p => p.name === parsed.pipeline);
	if (!pipeline) return '#6b7280';
	const statusDef = pipeline.statuses.find(s => s.label === parsed.status);
	return statusDef?.color ?? '#6b7280';
}

function formatDuration(seconds: number): string {
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	if (h > 0) return `${h}h ${m}m`;
	return `${m}m`;
}

function withElementOwner<T>(owner: Node | null | undefined, callback: () => T): T {
	elementOwnerStack.push(owner);
	try {
		return callback();
	} finally {
		elementOwnerStack.pop();
	}
}

function getCurrentElementOwner(): Node | null | undefined {
	return elementOwnerStack[elementOwnerStack.length - 1];
}

/**
 * Standard DOM helper — creates an element with className in the active render owner.
 */
function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className?: string,
	owner?: Node | null,
): HTMLElementTagNameMap[K] {
	const e = createOwnerElement(owner ?? getCurrentElementOwner(), tag);
	if (className) e.className = className;
	return e;
}

/** Build a ParsedTask from an IndexedTask (for subtask editor/checkbox in CM6 context) */
function parsedTaskFromIndexed(task: IndexedTask): ParsedTask {
	const fields = Object.entries(task.fieldValues).map(([k, v]) => ({
		sourceKey: k,
		key: k, value: v, rawValue: v,
		type: 'text' as const, isCanonical: true,
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

// ============================================================
// CM6 Widget — replaces task lines in Live Preview
// ============================================================

/**
 * Task bar widget that replaces an entire task line in Live Preview.
 */
class TaskBarWidget extends WidgetType {
	private task: ParsedTask;
	private indexedTask: IndexedTask | undefined;
	private subtreeSignature = '';
	private settingsIconSignature = '';
	private getIndexedTask: (id: string) => IndexedTask | undefined;
	private openEditor: (task: ParsedTask) => void;
	private toggleCheckbox: (task: ParsedTask, view: EditorView) => void;
	private getPipelines: () => Pipeline[];
	private getPriorities: () => PriorityDefinition[];
	private getChildIds: (parentId: string) => string[];
	private navigateToTask: (task: IndexedTask) => void;
	private getSettings: () => OperonSettings;
	private updateField: (operonId: string, key: string, value: string) => void;

	constructor(
		task: ParsedTask,
		getIndexedTask: (id: string) => IndexedTask | undefined,
		openEditor: (task: ParsedTask) => void,
		toggleCheckbox: (task: ParsedTask, view: EditorView) => void,
		getPipelines: () => Pipeline[],
		getPriorities: () => PriorityDefinition[],
		getChildIds: (parentId: string) => string[],
		navigateToTask: (task: IndexedTask) => void,
		getSettings: () => OperonSettings,
		updateField: (operonId: string, key: string, value: string) => void,
	) {
		super();
		this.task = task;
		this.getIndexedTask = getIndexedTask;
		this.openEditor = openEditor;
		this.toggleCheckbox = toggleCheckbox;
		this.getPipelines = getPipelines;
		this.getPriorities = getPriorities;
		this.getChildIds = getChildIds;
		this.navigateToTask = navigateToTask;
		this.getSettings = getSettings;
		this.updateField = updateField;
		if (task.operonId) {
			this.indexedTask = getIndexedTask(task.operonId);
		}
		this.subtreeSignature = this.computeSubtreeSignature(this.indexedTask?.operonId ?? task.operonId);
		this.settingsIconSignature = this.computeSettingsIconSignature();
	}

	toDOM(view: EditorView): HTMLElement {
		// If we have an indexed task, use the shared builder
		if (this.indexedTask) {
			const cbs: TaskBarCallbacks = {
				getPipelines: this.getPipelines,
				getPriorities: this.getPriorities,
				getIndexedTask: this.getIndexedTask,
				getChildIds: this.getChildIds,
				openEditor: (operonId) => {
					if (this.task.operonId === operonId) {
						this.openEditor(this.task);
					} else {
						// Subtask: build ParsedTask from IndexedTask
						const indexed = this.getIndexedTask(operonId);
						if (!indexed) return;
						this.openEditor(parsedTaskFromIndexed(indexed));
					}
				},
				toggleCheckbox: (operonId) => {
					if (this.task.operonId === operonId) {
						this.toggleCheckbox(this.task, view);
					} else {
						// Subtask: build ParsedTask from IndexedTask
						const indexed = this.getIndexedTask(operonId);
						if (!indexed) return;
						this.toggleCheckbox(parsedTaskFromIndexed(indexed), view);
					}
				},
				cycleStatus: (operonId) => {
					if (this.task.operonId === operonId) {
						this.toggleCheckbox(this.task, view);
					} else {
						const indexed = this.getIndexedTask(operonId);
						if (!indexed) return;
						this.toggleCheckbox(parsedTaskFromIndexed(indexed), view);
					}
				},
				navigateToTask: this.navigateToTask,
				getSettings: this.getSettings,
				updateField: this.updateField,
			};
			return buildTaskBarElement(this.indexedTask, cbs, 'file', view.dom);
		}

		// Fallback: minimal bar from ParsedTask (no index data)
		return this.buildMinimalBar(view);
	}

	private buildMinimalBar(view: EditorView): HTMLElement {
		return withElementOwner(view.dom, () => this.buildMinimalBarInner(view));
	}

	private buildMinimalBarInner(view: EditorView): HTMLElement {
		const wrapper = el('span', 'operon-task-bar-wrapper');

		const bar = el('span', 'operon-task-bar');

		// Icon
		const iconSection = el('span', 'operon-bar-icon');
		bar.appendChild(iconSection);
		this.renderMinimalCheckbox(iconSection, view);

		// Content
		const content = el('span', 'operon-bar-content');
		bar.appendChild(content);

		const line1 = el('span', 'operon-bar-line1');
		content.appendChild(line1);
		const desc = el('span', 'operon-task-description');
		desc.textContent = this.task.description || t('taskEditor', 'untitledTask');
		if (this.task.checkbox === 'done') desc.classList.add('operon-task-done');
		else if (this.task.checkbox === 'cancelled') desc.classList.add('operon-task-cancelled');
		line1.appendChild(desc);

		const line2 = el('span', 'operon-bar-line2');
		content.appendChild(line2);
		const chipsSection = el('span', 'operon-bar-chips');
		line2.appendChild(chipsSection);

		// Tags in line 2
		for (const tag of this.task.tags) {
			const tagEl = el('span', 'operon-tag-chip');
			tagEl.textContent = `#${tag}`;
			chipsSection.appendChild(tagEl);
		}

		// Minimal chips from parsed fields
		this.renderMinimalChips(chipsSection);

		// Actions
		const actionsSection = el('span', 'operon-bar-actions');
		line2.appendChild(actionsSection);
		const editBtn = el('button', 'operon-action-btn operon-edit-btn');
		setIcon(editBtn, 'pencil');
		bindOperonHoverTooltip(editBtn, { content: t('tooltips', 'editTask'), taskColor: null });
		editBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.openEditor(this.task);
		});
		actionsSection.appendChild(editBtn);

		wrapper.appendChild(bar);
		return wrapper;
	}

	private renderMinimalCheckbox(container: HTMLElement, view: EditorView): void {
		const cb = el('button', `operon-checkbox operon-checkbox-${this.task.checkbox}`);
		const settings = this.getSettings();
		const fieldValues = Object.fromEntries(this.task.fields.map(field => [field.key, field.value]));
		setIcon(cb, resolveTaskDisplayIcon(settings, fieldValues, this.task.checkbox));

		cb.addEventListener('click', (e) => {
			e.stopPropagation();
			this.toggleCheckbox(this.task, view);
		});
		container.appendChild(cb);
	}

	private renderMinimalChips(container: HTMLElement): void {
		const getField = (key: string) => this.task.fields.find(f => f.key === key)?.value;

		const priority = getField('priority');
		if (priority) {
			const chip = el('span', 'operon-chip operon-chip-priority');
			chip.textContent = priority;
			const priorityDef = this.getPriorities().find(p => p.label === priority);
			if (priorityDef) chip.style.backgroundColor = priorityDef.color;
			container.appendChild(chip);
		}

		const due = getField('dateDue');
		if (due) {
			const isOverdue = due < localToday();
			const chip = el('span', `operon-chip operon-chip-date${isOverdue ? ' operon-chip-overdue' : ''}`);
			chip.textContent = `📅 ${due}`;
			container.appendChild(chip);
		}
	}

	private getFieldValue(key: string): string | undefined {
		return this.task.fields.find(f => f.key === key)?.value;
	}

	private computeSubtreeSignature(rootId: string | null | undefined): string {
		if (!rootId) return '';
		const parts: string[] = [];
		const visited = new Set<string>();

		const visit = (id: string, depth: number): void => {
			if (depth > 5) return;
			if (visited.has(id)) return;
			visited.add(id);

			const task = this.getIndexedTask(id);
			if (!task) {
				parts.push(`${id}|missing`);
				return;
			}

			const childIds = this.getChildIds(id).slice().sort();
			parts.push(`${id}|${task.checkbox}|${task.datetimeModified}|${childIds.join(',')}`);
			for (const childId of childIds) {
				visit(childId, depth + 1);
			}
		};

		visit(rootId, 0);
		return parts.join('||');
	}

	private computeSettingsIconSignature(): string {
		const settings = this.getSettings();
		return [
			settings.fallbackTaskIconSource,
			`${settings.fallbackStateIcons.open}:${settings.fallbackStateIcons.done}:${settings.fallbackStateIcons.cancelled}`,
			settings.pipelines.map(pipeline =>
				`${pipeline.name}:${pipeline.statuses.map(status => `${status.label}:${status.pipelineStatusIcon ?? ''}`).join(',')}`
			).join('|'),
			settings.priorities.map(priority => `${priority.label}:${priority.priorityIcon ?? ''}`).join(','),
		].join('§');
	}

	eq(other: TaskBarWidget): boolean {
		if (this.task.rawLine !== other.task.rawLine) return false;
		if (this.settingsIconSignature !== other.settingsIconSignature) return false;
		// Also compare indexed data — index may update after docChanged
		const a = this.indexedTask;
		const b = other.indexedTask;
		if (!a && !b) return true;
		if (!a || !b) return false;
		return a.checkbox === b.checkbox
			&& a.description === b.description
			&& a.datetimeModified === b.datetimeModified
			&& JSON.stringify(a.fieldValues) === JSON.stringify(b.fieldValues)
			&& this.subtreeSignature === other.subtreeSignature;
	}

	get estimatedHeight(): number {
		// Tell CM6 the approximate widget height so viewport calculations
		// don't thrash. Two-line layout ≈ 56px, prevents oscillation where
		// widget height differs from raw text height causing repeated
		// viewport recalculations.
		return 56;
	}
}

// ============================================================
// CM6 Extension factory
// ============================================================

/**
 * Create the Operon inline task bar CM6 extension.
 */
export function operonInlineTaskBarExtension(
	getIndexedTask: (id: string) => IndexedTask | undefined,
	openEditor: (task: ParsedTask) => void,
	toggleCheckbox: (task: ParsedTask, view: EditorView) => void,
	getPipelines: () => Pipeline[],
	getPriorities: () => PriorityDefinition[],
	getChildIds: (parentId: string) => string[],
	navigateToTask: (task: IndexedTask) => void,
	getSettings: () => OperonSettings,
	updateField: (operonId: string, key: string, value: string) => void,
): Extension {
	// Single ViewPlugin — always registered. Returns Decoration.none in Source
	// mode so no replace widgets appear. This avoids the Compartment pattern
	// which destroys/recreates the plugin on mode changes and causes taskbars
	// to disappear when editorLivePreviewField transiently flickers.
	//
	// Rebuild strategy:
	// - operonIndexRefreshEffect: full rebuild (authoritative, fresh index data)
	// - Mode change (Source ↔ Live Preview): full rebuild
	// - docChanged: rebuild when the change touches an existing task bar or
	//   introduces task syntax, otherwise just map decorations forward.
	//   External file sync often rewrites the full task line, and mapping alone
	//   can drop replacement widgets until another editor event happens.
	const plugin = ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			private lastLivePreview = false;

			constructor(view: EditorView) {
				this.lastLivePreview = this.isLivePreview(view);
				this.decorations = this.buildDecorations(view);
			}

			update(update: ViewUpdate) {
				const hasRefresh = update.transactions.some(tr =>
					tr.effects.some(e => e.is(operonIndexRefreshEffect))
				);

				// Check for mode change (Source ↔ Live Preview)
				const nowLive = this.isLivePreview(update.view);
				const modeChanged = nowLive !== this.lastLivePreview;
				this.lastLivePreview = nowLive;

				if (modeChanged || hasRefresh) {
					// Authoritative rebuild: mode switch or fresh index data
					this.decorations = this.buildDecorations(update.view);
					update.view.requestMeasure();
				} else if (update.docChanged) {
					if (this.shouldRebuildAfterDocChange(update)) {
						this.decorations = this.buildDecorations(update.view);
					} else {
						this.decorations = this.decorations.map(update.changes);
					}
					update.view.requestMeasure();
				}
			}

			destroy() {}

			isInFencedCodeBlock(view: EditorView, pos: number): boolean {
				const lineNum = view.state.doc.lineAt(pos).number;
				let insideFence = false;
				for (let i = 1; i < lineNum; i++) {
					const lt = view.state.doc.line(i).text.trimStart();
					if (lt.startsWith('```') || lt.startsWith('~~~')) {
						insideFence = !insideFence;
					}
				}
				return insideFence;
			}

			isLivePreview(view: EditorView): boolean {
				try {
					return view.state.field(editorLivePreviewField);
				} catch {
					return false;
				}
			}

			shouldRebuildAfterDocChange(update: ViewUpdate): boolean {
				let needsRebuild = false;

				update.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
					if (needsRebuild) return;

					this.decorations.between(fromA, toA, () => {
						needsRebuild = true;
					});
					if (needsRebuild) return;

					const changedText = update.view.state.doc.sliceString(fromB, toB);
					if (changedText.includes('- [') || changedText.includes('{{')) {
						needsRebuild = true;
						return;
					}

					const startLine = update.view.state.doc.lineAt(fromB).number;
					const endLine = update.view.state.doc.lineAt(toB).number;
					for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
						const lineText = update.view.state.doc.line(lineNum).text;
						if (lineText.includes('- [') && lineText.includes('{{')) {
							needsRebuild = true;
							break;
						}
					}
				});

				return needsRebuild;
			}

			buildDecorations(view: EditorView): DecorationSet {
				// In Source/Code view, return no decorations
				if (!this.isLivePreview(view)) {
					return Decoration.none;
				}

				const builder = new RangeSetBuilder<Decoration>();
				const totalLines = view.state.doc.lines;

				for (let lineNum = 1; lineNum <= totalLines; lineNum++) {
					const line = view.state.doc.line(lineNum);
					const text = line.text;

					if (!text.includes('- [') || !text.includes('{{')) continue;

					if (this.isInFencedCodeBlock(view, line.from)) continue;

					const parsed = parseTaskLine(text, lineNum - 1, '');
					if (!parsed || !parsed.operonId) continue;

					const widget = new TaskBarWidget(
						parsed,
						getIndexedTask,
						openEditor,
						toggleCheckbox,
						getPipelines,
						getPriorities,
						getChildIds,
						navigateToTask,
						getSettings,
						updateField,
					);

					builder.add(
						line.from,
						line.to,
						Decoration.replace({ widget }),
					);
				}

				return builder.finish();
			}
		},
		{
			decorations: (v) => v.decorations,
			provide: (plugin) => EditorView.atomicRanges.of((view) => {
				return view.plugin(plugin)?.decorations ?? Decoration.none;
			}),
		},
	);

	return plugin;
}
