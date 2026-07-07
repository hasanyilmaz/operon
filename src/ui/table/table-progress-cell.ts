import type { IndexedTask } from '../../types/fields';
import type { OperonSettings } from '../../types/settings';
import type { TableColumn } from '../../types/table';
import { asyncHandler } from '../../core/async-action';
import { bindOperonHoverTooltip } from '../operon-hover-tooltip';
import {
	CHECKBOX_PROGRESS_COLUMN_KEY,
	renderTaskProgressHorizontalTrack,
	renderTaskProgressIconRing,
	type TaskProgressTrack,
	type TaskProgressTrackKind,
} from '../task-progress-tracks';
import { resolveTableColumnCellAccent } from './table-column-color';
import { getTableTaskFieldLabel } from './table-field-catalog';
import type { TableValueResolver } from './table-value-cache';

type TableProgressCellSettings = Pick<OperonSettings, 'colorPalette' | 'keyMappings' | 'pipelines' | 'priorities'>;

export interface TableProgressCellActionInvocation {
	task: IndexedTask;
	track: TaskProgressTrack;
	trigger: HTMLElement;
	actionAnchorRect: DOMRect;
}

type TableProgressCellActionHandler = (invocation: TableProgressCellActionInvocation) => void | Promise<void>;

export function isTableProgressColumnKey(key: string): boolean {
	return key === 'progress' || key === CHECKBOX_PROGRESS_COLUMN_KEY;
}

export function getTableProgressTrackKindForColumn(key: string): TaskProgressTrackKind {
	return key === CHECKBOX_PROGRESS_COLUMN_KEY ? 'checkboxes' : 'subtasks';
}

export function renderTableProgressCell(
	cell: HTMLElement,
	options: {
		task: IndexedTask;
		column: TableColumn;
		settings: TableProgressCellSettings;
		valueResolver: Pick<TableValueResolver, 'getProgressTrack'>;
		iconOnly: boolean;
		onActivate?: TableProgressCellActionHandler;
	},
): void {
	const track = options.valueResolver.getProgressTrack(
		options.task,
		getTableProgressTrackKindForColumn(options.column.key),
	);
	cell.addClass('operon-table-progress-cell');
	cell.addClass(options.iconOnly ? 'is-icon-mode' : 'is-details-mode');
	const fieldLabel = getTableTaskFieldLabel(options.column.key, options.settings);
	if (!track) {
		if (!options.iconOnly) {
			cell.setAttribute('aria-label', `${fieldLabel}: --`);
			cell.createSpan({ cls: 'operon-table-empty-value', text: '--' });
		}
		return;
	}

	const color = resolveTableProgressCellColor(options.column, track, options.task, options.settings);
	const ariaLabel = `${fieldLabel}: ${track.tooltip}`;
	const actionHandler = options.task.checkbox === 'open' ? options.onActivate : undefined;
	cell.setAttribute('aria-label', ariaLabel);
	if (options.iconOnly) {
		const actionShell = actionHandler
			? createTableProgressActionShell(cell, 'icon')
			: null;
		const ringHost = actionShell ?? cell;
		if (actionShell) applyTableProgressColor(actionShell, color);
		const ring = renderTaskProgressIconRing(ringHost, track, { className: 'operon-table-progress-ring' });
		applyTableProgressColor(ring, color);
		applyTableProgressAccessibility(ring, track, ariaLabel);
		const tooltipTarget = actionShell && actionHandler
			? createTableProgressActionButton(actionShell, options.task, track, ariaLabel, ring, actionHandler)
			: ring;
		bindOperonHoverTooltip(tooltipTarget, {
			title: fieldLabel,
			content: track.tooltip,
			taskColor: color,
			preferredHorizontal: 'center',
		});
		return;
	}

	const actionShell = actionHandler
		? createTableProgressActionShell(cell, 'details')
		: null;
	const barHost = actionShell ?? cell;
	if (actionShell) applyTableProgressColor(actionShell, color);
	const wrap = barHost.createSpan('operon-table-progress-wrap');
	applyTableProgressColor(wrap, color);
	const trackEl = renderTaskProgressHorizontalTrack(wrap, track, {
		className: 'operon-table-progress-track',
	});
	applyTableProgressAccessibility(trackEl, track, ariaLabel);
	const tooltipTarget = actionShell && actionHandler
		? createTableProgressActionButton(actionShell, options.task, track, ariaLabel, trackEl, actionHandler)
		: trackEl;
	bindOperonHoverTooltip(tooltipTarget, {
		title: fieldLabel,
		content: track.tooltip,
		taskColor: color,
		preferredHorizontal: 'center',
	});
}

function createTableProgressActionShell(
	cell: HTMLElement,
	mode: 'details' | 'icon',
): HTMLElement {
	return cell.createSpan(`operon-table-progress-action-shell is-${mode}-mode`);
}

function createTableProgressActionButton(
	shell: HTMLElement,
	task: IndexedTask,
	track: TaskProgressTrack,
	ariaLabel: string,
	progressEl: HTMLElement,
	onActivate: TableProgressCellActionHandler,
): HTMLButtonElement {
	const button = shell.createEl('button', {
		cls: 'operon-table-progress-action',
		attr: { type: 'button' },
	});
	button.setAttribute('aria-label', ariaLabel);
	button.setAttribute('aria-describedby', ensureTableProgressElementId(progressEl));
	button.addEventListener('pointerdown', stopTableProgressActionEvent);
	button.addEventListener('dblclick', stopTableProgressActionEvent);
	button.addEventListener('click', asyncHandler('table progress action failed', async event => {
		event.preventDefault();
		event.stopPropagation();
		await onActivate({
			task,
			track,
			trigger: button,
			actionAnchorRect: button.getBoundingClientRect(),
		});
	}));
	return button;
}

function stopTableProgressActionEvent(event: Event): void {
	event.preventDefault();
	event.stopPropagation();
}

let tableProgressElementId = 0;

function ensureTableProgressElementId(element: HTMLElement): string {
	if (!element.id) {
		tableProgressElementId += 1;
		element.setAttribute('id', `operon-table-progress-${tableProgressElementId}`);
	}
	return element.id;
}

function resolveTableProgressCellColor(
	column: TableColumn,
	track: TaskProgressTrack,
	task: IndexedTask,
	settings: TableProgressCellSettings,
): string | null {
	return resolveTableColumnCellAccent(column, String(track.percent), { task, settings });
}

function applyTableProgressColor(element: HTMLElement, color: string | null): void {
	if (!color) return;
	element.style.setProperty('--operon-task-progress-color', color);
	element.style.setProperty('--operon-task-chip-hover-accent', color);
	element.style.setProperty('--operon-live-hover-border', color);
}

function applyTableProgressAccessibility(element: HTMLElement, track: TaskProgressTrack, ariaLabel: string): void {
	element.setAttribute('role', 'progressbar');
	element.setAttribute('aria-label', ariaLabel);
	element.setAttribute('aria-valuemin', '0');
	element.setAttribute('aria-valuemax', '100');
	element.setAttribute('aria-valuenow', String(track.percent));
	element.setAttribute('aria-valuetext', track.tooltip);
}
