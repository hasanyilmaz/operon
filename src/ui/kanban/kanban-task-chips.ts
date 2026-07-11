import { App, setIcon } from 'obsidian';
import { createOwnerElement, getOwnerWindow } from '../../core/dom-compat';
import type { ContextualMenuActionHandler, ContextualMenuActionId, ContextualMenuContext } from '../../core/contextual-menu-engine';
import { getLocationPlaceIndex } from '../../core/location-source-resolver';
import { getConfiguredKeyMappingIcon } from '../../core/key-mapping-icons';
import { normalizeTaskFieldColor } from '../../core/task-color-source';
import { t } from '../../core/i18n';
import { localNow } from '../../core/local-time';
import { resolveSubtaskActionIcon, resolveSubtaskActionLabelKey } from '../../core/subtask-action';
import { resolveTaskDateToneColor } from '../../core/task-date-tone';
import { IndexedTask } from '../../types/fields';
import { findStatusDef, Pipeline } from '../../types/pipeline';
import type { PriorityDefinition } from '../../types/priority';
import { OperonSettings } from '../../types/settings';
import type { ProjectSerialDisplay } from '../../core/project-serials';
import type { WorkflowStatusIdentityIndex } from '../../core/workflow-status-identity';
import type { InlineRepeatCompletionMode } from '../../storage/repeat-series-store';
import {
	buildInlineTaskCompactChipEntries,
	createCompactTaskLookup,
	createInlineTaskCompactChipElement,
	type CompactTaskLookupContext,
	InlineTaskCompactChipEntry,
	shouldResolveLocationCompactChips,
} from '../compact-task-layout';
import { bindCompactChipLinkPreview } from '../compact-chip-link-preview';
import { bindExternalLinkContextMenu, openExternalUrl } from '../external-link-actions';
import {
	bindAdaptiveIconOnlyExpansion,
	bindIconOnlyChipPreview,
	closeIconOnlyChipPreview,
	isIconOnlyChipExpansionSuppressed,
	openIconOnlyChipPreview,
	shouldOpenIconOnlyChipPreview,
} from '../icon-only-chip-preview';
import { showLocationMapPreview } from '../location-map-preview';
import { bindOperonHoverTooltip, wrapWithOperonHoverTooltip } from '../operon-hover-tooltip';
import { createProjectSerialChipElement } from '../project-serial-chip';
import { openObsidianTagSearch } from '../tag-search';
import { openTaskFieldPicker } from '../task-field-picker-dispatch';
import { getCustomFieldMapping, isProjectedCustomFieldType } from '../custom-field-surfaces';
import { setAccessibleLabelWithoutTooltip } from '../accessibility-label';

export interface KanbanTaskChipRowCallbacks {
	app: App;
	getSettings: () => OperonSettings;
	onAction?: ContextualMenuActionHandler;
	isTaskPinned?: (operonId: string) => boolean;
	isTaskTracking?: (operonId: string) => boolean;
	toggleTimer?: (operonId: string) => void | Promise<void>;
	getProjectSerialDisplay?: (operonId: string, task?: IndexedTask) => ProjectSerialDisplay | null;
	getRepeatSkipDates?: (repeatSeriesId: string) => string[];
	getRepeatSeriesInlineCompletionMode?: (repeatSeriesId: string) => InlineRepeatCompletionMode;
	updateRepeatSeriesInlineCompletionMode?: (operonId: string, mode: InlineRepeatCompletionMode) => void | Promise<void>;
	updateField?: (operonId: string, key: string, value: string) => void | Promise<void>;
	updateFields?: (operonId: string, payload: Record<string, string>) => void | Promise<void>;
	updateSubtasks?: (operonId: string, subtaskIds: string[]) => void;
	updateDependencyField?: (operonId: string, field: 'blocking' | 'blockedBy', value: string) => void;
	openEditor?: (operonId: string) => void | Promise<void>;
}

export interface KanbanTaskChipRowOptions {
	allTasks: IndexedTask[];
	taskLookup?: CompactTaskLookupContext;
	workflowStatusIdentityIndex?: WorkflowStatusIdentityIndex;
	owner?: Node | null;
	readOnly?: boolean;
}

interface KanbanTaskActionChip {
	actionId: ContextualMenuActionId;
	icon: string;
	label: string;
	active?: boolean;
}

const KANBAN_DIRECT_CHIP_DAY_PICKER_DATE_KEYS = new Set<string>([
	'dateStarted',
	'dateScheduled',
	'dateDue',
	'dateCompleted',
	'dateCancelled',
]);

const KANBAN_PICKER_CHIP_KEYS = new Set<string>([
	'status',
	'priority',
	'dateStarted',
	'dateScheduled',
	'dateDue',
	'dateCompleted',
	'dateCancelled',
	'datetimeStart',
	'datetimeEnd',
	'estimate',
	'repeat',
]);

export function buildKanbanTaskChipRow(
	task: IndexedTask,
	callbacks: KanbanTaskChipRowCallbacks,
	options: KanbanTaskChipRowOptions,
): HTMLElement | null {
	const settings = callbacks.getSettings();
	const locationResolver = shouldResolveLocationCompactChips(settings, settings.kanbanTaskCompactChips)
		? getLocationPlaceIndex(callbacks.app, settings).resolve
		: undefined;
	const taskColor = normalizeTaskColor(task.fieldValues['taskColor']);
	const actionChips = buildKanbanTaskActionChips(task, callbacks, settings);
	const taskLookup = options.taskLookup ?? createCompactTaskLookup(options.allTasks);
	const entries = buildInlineTaskCompactChipEntries(
		task.fieldValues,
		task.tags,
		settings,
		options.allTasks,
		settings.kanbanTaskCompactChips,
		locationResolver,
		{
			repeatSkipDateResolver: callbacks.getRepeatSkipDates,
			taskLookup,
			workflowStatusIdentityIndex: options.workflowStatusIdentityIndex,
		},
	);
	const projectSerialDisplay = callbacks.getProjectSerialDisplay?.(task.operonId, task) ?? null;
	if (entries.length === 0 && !projectSerialDisplay && actionChips.length === 0) return null;

	const row = createOwnerElement(options.owner, 'div');
	row.className = 'operon-kanban-card-chip-row operon-task-chip-surface';
	const readOnly = options.readOnly === true;
	row.classList.toggle('is-read-only', readOnly);
	bindKanbanChipRowDynamicReadOnlyGuard(row);
	if (!readOnly) bindKanbanChipRowDragShield(row);

	const chipStrip = createOwnerElement(row, 'div');
	chipStrip.className = 'operon-kanban-card-chip-strip';
	const actionStrip = createOwnerElement(row, 'div');
	actionStrip.className = 'operon-kanban-card-chip-actions';

	if (projectSerialDisplay) {
		const serialChip = createProjectSerialChipElement(projectSerialDisplay, 'operon-kanban-card-chip operon-task-chip', {
			keyMappings: settings.keyMappings,
			owner: chipStrip,
		});
		bindKanbanAxisActivationBridge(serialChip);
		chipStrip.appendChild(serialChip);
	}

	const statusColor = entries.some(entry => entry.colorRole === 'status')
		? lookupStatusColor(
			task.fieldValues['status'],
			settings.pipelines,
			options.workflowStatusIdentityIndex,
		)
		: null;
	for (const rawEntry of entries) {
		const entry = readOnly ? { ...rawEntry, interactive: false } : rawEntry;
		const chip = createInlineTaskCompactChipElement(entry, 'operon-kanban-card-chip operon-task-chip', { owner: chipStrip });
		applyKanbanChipVisualStyles(chip, entry, task, settings.priorities, statusColor, taskColor);
		bindKanbanAxisActivationBridge(chip);

		if (entry.iconOnly) {
			bindAdaptiveIconOnlyExpansion(chip, entry.label, taskColor ?? null);
			if (!readOnly) attachKanbanChipAction(chip, entry, task, callbacks, options.allTasks, () => closeIconOnlyChipPreview(chip));
			if (!readOnly && entry.externalUrl) bindExternalLinkContextMenu(chip, entry.externalUrl, entry.externalRawValue);
			if (entry.tooltipContent) bindKanbanChipTooltip(chip, entry, taskColor);
			if (!readOnly && !entry.interactive) bindIconOnlyChipPreview(chip);
			if (!readOnly) bindKanbanChipLinkPreview(chip, entry, callbacks, task);
			chipStrip.appendChild(chip);
			continue;
		}

		if (!readOnly && entry.interactive) {
			attachKanbanChipAction(chip, entry, task, callbacks, options.allTasks);
		}
		const node = entry.tooltipContent
			? wrapWithOperonHoverTooltip(chip, {
				title: entry.tooltipTitle ?? t('taskEditor', 'details'),
				content: entry.tooltipContent,
				taskColor,
			})
			: chip;
		if (!readOnly && entry.externalUrl) bindExternalLinkContextMenu(chip, entry.externalUrl, entry.externalRawValue);
		if (!readOnly) bindKanbanChipLinkPreview(chip, entry, callbacks, task);
		chipStrip.appendChild(node);
	}

	for (const action of actionChips) {
		actionStrip.appendChild(createKanbanTaskActionChipElement(action, task, callbacks, actionStrip, taskColor, readOnly));
	}
	if (chipStrip.childElementCount > 0) row.appendChild(chipStrip);
	if (actionStrip.childElementCount > 0) row.appendChild(actionStrip);

	return row;
}

function isKanbanChipRowReadOnly(row: HTMLElement): boolean {
	return row.classList.contains('is-read-only')
		|| row.closest<HTMLElement>('.operon-kanban-board')?.classList.contains('is-mobile-layout') === true;
}

function isKanbanChipActionReadOnly(chip: HTMLElement): boolean {
	const row = chip.closest<HTMLElement>('.operon-kanban-card-chip-row');
	return !!row && isKanbanChipRowReadOnly(row);
}

function bindKanbanChipRowDynamicReadOnlyGuard(row: HTMLElement): void {
	const stopChipSpecificAction = (event: Event): void => {
		if (!isKanbanChipRowReadOnly(row)) return;
		event.preventDefault();
		event.stopImmediatePropagation();
	};
	row.addEventListener('contextmenu', stopChipSpecificAction, { capture: true });
	row.addEventListener('mouseover', stopChipSpecificAction, { capture: true });
	row.addEventListener('mousemove', stopChipSpecificAction, { capture: true });
}

function bindKanbanChipRowDragShield(row: HTMLElement): void {
	let restoreCard: HTMLElement | null = null;
	let restoreDraggable = false;

	const release = (): void => {
		if (restoreCard) {
			restoreCard.draggable = restoreDraggable;
			restoreCard = null;
		}
		const ownerWindow = getOwnerWindow(row);
		ownerWindow.removeEventListener('pointerup', release, true);
		ownerWindow.removeEventListener('pointercancel', release, true);
		ownerWindow.removeEventListener('mouseup', release, true);
		ownerWindow.removeEventListener('dragend', release, true);
		ownerWindow.removeEventListener('blur', release, true);
	};

	const arm = (event: PointerEvent | MouseEvent): void => {
		if (isKanbanChipRowReadOnly(row)) return;
		if (event.button !== 0 || restoreCard) return;
		const card = row.closest<HTMLElement>('.operon-kanban-card');
		if (!card || !card.draggable) return;
		restoreCard = card;
		restoreDraggable = card.draggable;
		card.draggable = false;
		const ownerWindow = getOwnerWindow(row);
		ownerWindow.addEventListener('pointerup', release, true);
		ownerWindow.addEventListener('pointercancel', release, true);
		ownerWindow.addEventListener('mouseup', release, true);
		ownerWindow.addEventListener('dragend', release, true);
		ownerWindow.addEventListener('blur', release, true);
	};

	row.addEventListener('pointerdown', arm, { capture: true });
	row.addEventListener('mousedown', arm, { capture: true });
	row.addEventListener('dragstart', event => {
		if (isKanbanChipRowReadOnly(row)) {
			release();
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		release();
	}, { capture: true });
}

function buildKanbanTaskActionChips(
	task: IndexedTask,
	callbacks: KanbanTaskChipRowCallbacks,
	settings: OperonSettings,
): KanbanTaskActionChip[] {
	const chips: KanbanTaskActionChip[] = [];
	const canRunActions = !!callbacks.onAction;
	const canToggleTimer = !!callbacks.toggleTimer || canRunActions;
	const isTerminal = task.checkbox !== 'open';
	if (canToggleTimer && settings.kanbanTaskShowPlayAction && task.checkbox === 'open') {
		const isTracking = !!callbacks.toggleTimer && callbacks.isTaskTracking?.(task.operonId) === true;
		chips.push({
			actionId: 'startTimer',
			icon: isTracking ? 'square' : 'play',
			label: t('tooltips', isTracking ? 'stopTimer' : 'startTimer'),
			active: isTracking,
		});
	}
	if (canRunActions && settings.kanbanTaskShowPinAction) {
		const pinned = callbacks.isTaskPinned?.(task.operonId) === true;
		chips.push({
			actionId: 'pinToggle',
			icon: pinned ? 'pin-off' : 'pin',
			label: t('contextMenu', pinned ? 'unpinTask' : 'pinTask'),
			active: pinned,
		});
	}
	const noteValue = task.fieldValues['note']?.trim();
	if (settings.kanbanTaskShowNoteAction && noteValue) {
		chips.push({
			actionId: 'openEditor',
			icon: getConfiguredKeyMappingIcon('note', settings.keyMappings) || 'notebook-pen',
			label: t('taskEditor', 'notes'),
		});
	}
	if (canRunActions && settings.kanbanTaskShowSubtaskAction && !isTerminal) {
		chips.push({
			actionId: 'createSubtask',
			icon: resolveSubtaskActionIcon(task),
			label: t('buttons', resolveSubtaskActionLabelKey(task)),
		});
	}
	if (canRunActions && settings.kanbanTaskShowPlainCheckboxAction) {
		chips.push({
			actionId: 'checkboxes',
			icon: 'layout-list',
			label: t('settings', 'kanbanTaskOpenCheckboxAction'),
		});
	}
	return chips;
}

function createKanbanTaskActionChipElement(
	action: KanbanTaskActionChip,
	task: IndexedTask,
	callbacks: KanbanTaskChipRowCallbacks,
	owner: Node,
	taskColor: string | null,
	readOnly: boolean,
): HTMLElement {
	const chip = createOwnerElement(owner, readOnly || action.actionId === 'openEditor' ? 'span' : 'button');
	chip.className = 'operon-kanban-card-action-chip operon-task-chip-action';
	if (action.active) chip.classList.add('is-active');
	chip.classList.toggle('is-read-only', readOnly);
	if (readOnly) chip.setAttribute('aria-disabled', 'true');
	if (taskColor) {
		chip.style.setProperty('--operon-live-hover-border', taskColor);
		chip.style.setProperty('--operon-task-chip-hover-accent', taskColor);
	}
	setIcon(chip, action.icon);
	setAccessibleLabelWithoutTooltip(chip, action.label);
	bindOperonHoverTooltip(chip, {
		title: action.label,
		content: action.actionId === 'openEditor' ? task.fieldValues['note']?.trim() ?? '' : undefined,
		taskColor,
	});
	bindKanbanAxisActivationBridge(chip);
	if (isKanbanActionButtonElement(chip)) {
		chip.type = 'button';
		chip.addEventListener('click', (event) => {
			if (readOnly || isKanbanChipActionReadOnly(chip)) return;
			event.preventDefault();
			event.stopPropagation();
			if (action.actionId === 'startTimer' && callbacks.toggleTimer) {
				void callbacks.toggleTimer(task.operonId);
				return;
			}
			void callbacks.onAction?.(
				task.operonId,
				action.actionId,
				buildKanbanTaskActionContext(task, callbacks),
				{
					actionAnchor: chip,
					actionAnchorRect: chip.getBoundingClientRect(),
				},
			);
		});
	}
	return chip;
}

function isKanbanActionButtonElement(chip: HTMLElement): chip is HTMLButtonElement {
	const chipWithInstanceOf = chip as HTMLElement & {
		instanceOf?: (constructor: typeof HTMLButtonElement) => boolean;
	};
	if (typeof chipWithInstanceOf.instanceOf === 'function') {
		return chipWithInstanceOf.instanceOf(HTMLButtonElement);
	}
	return chip.tagName === 'BUTTON';
}

function buildKanbanTaskActionContext(
	task: IndexedTask,
	callbacks: KanbanTaskChipRowCallbacks,
): ContextualMenuContext {
	return {
		surface: 'kanbanCard',
		taskId: task.operonId,
		task,
		now: localNow(),
		isPinned: callbacks.isTaskPinned?.(task.operonId) === true,
	};
}

export function getKanbanTaskChipLocationSignature(app: App, settings: OperonSettings): string {
	return shouldResolveLocationCompactChips(settings, settings.kanbanTaskCompactChips)
		? getLocationPlaceIndex(app, settings).getSignature()
		: '';
}

function attachKanbanChipAction(
	chip: HTMLElement,
	entry: InlineTaskCompactChipEntry,
	task: IndexedTask,
	callbacks: KanbanTaskChipRowCallbacks,
	allTasks: IndexedTask[],
	onCommit?: () => void,
): void {
	chip.addEventListener('click', (event) => {
		if (isKanbanChipActionReadOnly(chip)) return;
		event.preventDefault();
		event.stopPropagation();
		if (entry.iconOnly && shouldOpenIconOnlyChipPreview(chip)) {
			openIconOnlyChipPreview(chip);
			return;
		}
		if (entry.key === 'location' && entry.locationCoordinate) {
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
			return;
		}
		if (entry.key === 'tags') {
			void openObsidianTagSearch(callbacks.app, entry.label);
			onCommit?.();
			return;
		}
		if (entry.linkTarget) {
			void callbacks.app.workspace.openLinkText(entry.linkTarget, task.primary.filePath, false);
			onCommit?.();
			return;
		}
		if (entry.externalUrl) {
			openExternalUrl(entry.externalUrl);
			onCommit?.();
			return;
		}
		if (shouldOpenKanbanTaskFieldPicker(entry, callbacks.getSettings())) {
			openKanbanTaskFieldPicker(chip, entry, task, callbacks, allTasks, onCommit);
		}
	});
}

function shouldOpenKanbanTaskFieldPicker(entry: InlineTaskCompactChipEntry, settings: OperonSettings): boolean {
	if (KANBAN_PICKER_CHIP_KEYS.has(entry.key)) return true;
	const customMapping = getCustomFieldMapping(settings.keyMappings, entry.key);
	return !!customMapping && isProjectedCustomFieldType(customMapping);
}

function openKanbanTaskFieldPicker(
	chip: HTMLElement,
	entry: InlineTaskCompactChipEntry,
	task: IndexedTask,
	callbacks: KanbanTaskChipRowCallbacks,
	allTasks: IndexedTask[],
	onCommit?: () => void,
): void {
	const settings = callbacks.getSettings();
	openTaskFieldPicker({
		app: callbacks.app,
		settings,
		allTasks,
		canonicalKey: entry.key,
		anchor: chip,
		currentFieldValues: task.fieldValues,
		currentTags: task.tags,
		sourcePath: task.primary.filePath,
		taskFormat: task.primary.format,
		manualDatePicker: getKanbanDirectChipManualDatePickerOptions(entry.key, settings),
		repeatInlineCompletionMode: callbacks.getRepeatSeriesInlineCompletionMode?.(task.fieldValues['repeatSeriesId'] ?? ''),
		onRepeatInlineCompletionModeChange: mode => callbacks.updateRepeatSeriesInlineCompletionMode?.(task.operonId, mode),
		onCommit: payload => {
			commitKanbanChipPayload(task, payload, callbacks);
			onCommit?.();
		},
	});
}

function commitKanbanChipPayload(
	task: IndexedTask,
	payload: Record<string, string | string[]>,
	callbacks: KanbanTaskChipRowCallbacks,
): void {
	const normalizedPayload = Object.fromEntries(
		Object.entries(payload).map(([key, value]) => [
			key === 'tags' ? '_tags' : key,
			Array.isArray(value) ? value.join('; ') : value,
		]),
	);
	const entries = Object.entries(normalizedPayload);
	if (entries.length === 1 && callbacks.updateField) {
		const [key, value] = entries[0];
		void callbacks.updateField(task.operonId, key, value);
		return;
	}
	if (callbacks.updateFields) {
		void callbacks.updateFields(task.operonId, normalizedPayload);
		return;
	}
	for (const [key, value] of entries) {
		void callbacks.updateField?.(task.operonId, key, value);
	}
}

function bindKanbanChipLinkPreview(
	chip: HTMLElement,
	entry: InlineTaskCompactChipEntry,
	callbacks: KanbanTaskChipRowCallbacks,
	task: IndexedTask,
): void {
	const previewLinkTarget = entry.previewLinkTarget ?? entry.linkTarget;
	if (previewLinkTarget) {
		bindCompactChipLinkPreview(callbacks.app, chip, previewLinkTarget, task.primary.filePath);
	}
}

function bindKanbanChipTooltip(
	chip: HTMLElement,
	entry: InlineTaskCompactChipEntry,
	taskColor: string | null,
): void {
	bindOperonHoverTooltip(chip, {
		title: entry.tooltipTitle ?? t('taskEditor', 'details'),
		content: entry.tooltipContent ?? '',
		taskColor,
		shouldOpen: () => isIconOnlyChipExpansionSuppressed(chip),
	});
}

function bindKanbanAxisActivationBridge(target: HTMLElement): void {
	const requestAxisHighlight = (): void => {
		const cell = target.closest<HTMLElement>('.operon-kanban-cell');
		const board = target.closest<HTMLElement>('.operon-kanban-board');
		if (!cell || !board || board.classList.contains('is-mobile-layout')) return;
		getOwnerWindow(target).requestAnimationFrame(() => {
			if (!target.isConnected || !cell.isConnected || !board.isConnected) return;
			if (!target.matches(':hover, :focus-within')) return;
			board.dispatchEvent(new CustomEvent('operon-kanban-axis-activate', {
				bubbles: true,
				detail: { cell },
			}));
		});
	};
	target.addEventListener('mouseenter', requestAxisHighlight);
	target.addEventListener('focusin', requestAxisHighlight);
}

function getKanbanDirectChipManualDatePickerOptions(key: string, settings: OperonSettings) {
	if (!KANBAN_DIRECT_CHIP_DAY_PICKER_DATE_KEYS.has(key)) return undefined;
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

function applyKanbanChipVisualStyles(
	chip: HTMLElement,
	entry: InlineTaskCompactChipEntry,
	task: IndexedTask,
	priorities: PriorityDefinition[],
	statusColor: string | null,
	taskColor: string | null,
): void {
	if (entry.colorRole === 'priority') {
		const def = priorities.find((priority) => priority.label === task.fieldValues['priority']);
		if (def) chip.style.setProperty('--operon-inline-chip-icon-color', def.color);
	}
	if (entry.colorRole === 'status' && statusColor) {
		chip.style.setProperty('--operon-inline-chip-icon-color', statusColor);
	}
	if (entry.key === 'location') {
		const locationIconColor = entry.locationMarkerColor ?? taskColor;
		if (locationIconColor) chip.style.setProperty('--operon-inline-chip-icon-color', locationIconColor);
	}
	const dateToneColor = resolveTaskDateToneColor(entry.iconTone ?? 'default');
	if (dateToneColor) chip.setCssProps({ '--operon-inline-chip-icon-color': dateToneColor });
}

function lookupStatusColor(
	statusValue: string | undefined,
	pipelines: Pipeline[],
	workflowStatusIdentityIndex?: WorkflowStatusIdentityIndex,
): string {
	if (!statusValue) return '#6b7280';
	return findStatusDef(pipelines, statusValue, workflowStatusIdentityIndex)?.color ?? '#6b7280';
}

function normalizeTaskColor(taskColor: string | undefined): string | null {
	return normalizeTaskFieldColor(taskColor);
}
