import { getIcon, getIconIds, setIcon } from 'obsidian';
import { resolveSubtaskActionIconForKind } from '../../core/subtask-action';
import { normalizeTaskIconValue } from '../../core/task-icon-value';
import { findStatusDef } from '../../types/pipeline';
import type { OperonSettings } from '../../types/settings';
import { bindOperonHoverTooltip } from '../operon-hover-tooltip';
import { setAccessibleLabelWithoutTooltip } from '../accessibility-label';
import type { WorkflowStatusIdentityIndex } from '../../core/workflow-status-identity';
import { formatTableCompactDatetimeValue } from './table-datetime-format';

export { formatTableCompactDatetimeValue } from './table-datetime-format';

type TableValueIconSettings = Pick<OperonSettings, 'pipelines' | 'priorities'>;

let tableValueIconIds: Set<string> | null = null;

export interface TableIconOnlyCellOptions {
	icon: string;
	title: string;
	content: string;
	contentEl?: HTMLElement;
	ariaLabel: string;
	color: string | null;
	focusable?: boolean;
	showTooltip?: boolean;
}

export type TableCompactDatetimeCellOptions = Omit<TableIconOnlyCellOptions, 'icon'> & {
	value: string;
	timeFormat: Pick<OperonSettings, 'timeFormat'>['timeFormat'];
};

export function renderTableCompactDatetimeCell(
	cell: HTMLElement,
	options: TableCompactDatetimeCellOptions,
): HTMLElement {
	cell.addClass('operon-table-icon-only-cell');
	const control = cell.createSpan('operon-table-icon-only-button operon-table-compact-datetime');
	control.tabIndex = options.focusable === false ? -1 : 0;
	setAccessibleLabelWithoutTooltip(control, options.ariaLabel);
	if (options.color) {
		control.style.setProperty('--operon-table-icon-only-color', options.color);
		control.style.setProperty('--operon-live-hover-border', options.color);
		control.style.setProperty('--operon-task-chip-hover-accent', options.color);
	}
	control.setText(formatTableCompactDatetimeValue(options.value, options.timeFormat));
	if (options.showTooltip !== false) {
		bindOperonHoverTooltip(control, {
			title: options.title,
			content: options.content,
			taskColor: options.color,
			preferredHorizontal: 'center',
		});
	}
	return control;
}

export function formatTableIconOnlyTooltipContent(value: string): string {
	return value.trim() || '--';
}

export function resolveTableValueCellIcon(
	key: string,
	value: string,
	settings: TableValueIconSettings | null | undefined,
	fallbackIcon: string,
	workflowStatusIdentityIndex?: WorkflowStatusIdentityIndex,
): string {
	const normalizedFallback = normalizeTaskIconValue(fallbackIcon) || 'text';
	const candidate = resolveTableValueCellCustomIcon(key, value, settings, workflowStatusIdentityIndex);
	if (!candidate) return normalizedFallback;
	return isValidTableValueIcon(candidate) ? candidate : normalizedFallback;
}

export function resolveTableIconOnlyCellIcon(key: string, value: string, fallbackIcon: string): string {
	if (key === 'taskType') {
		const taskType = value.trim();
		if (taskType === 'inline' || taskType === 'file') {
			return resolveSubtaskActionIconForKind(taskType);
		}
		return fallbackIcon;
	}
	if (key !== 'taskIcon') return fallbackIcon;
	const iconName = normalizeTaskIconValue(value);
	if (!iconName) return fallbackIcon;
	return getIcon(iconName) ? iconName : fallbackIcon;
}

function resolveTableValueCellCustomIcon(
	key: string,
	value: string,
	settings: TableValueIconSettings | null | undefined,
	workflowStatusIdentityIndex?: WorkflowStatusIdentityIndex,
): string {
	if (!settings) return '';
	if (key === 'status') {
		return normalizeTaskIconValue(
			findStatusDef(settings.pipelines, value, workflowStatusIdentityIndex)?.pipelineStatusIcon,
		);
	}
	if (key === 'priority') {
		return normalizeTaskIconValue(
			settings.priorities.find(priority => priority.label === value)?.priorityIcon,
		);
	}
	return '';
}

function isValidTableValueIcon(iconName: string): boolean {
	if (!tableValueIconIds) {
		tableValueIconIds = new Set(getIconIds().map(iconId => normalizeTaskIconValue(iconId)));
	}
	return tableValueIconIds.has(iconName);
}

export function renderTableIconOnlyCell(cell: HTMLElement, options: TableIconOnlyCellOptions): HTMLElement {
	cell.addClass('operon-table-icon-only-cell');
	const icon = cell.createSpan('operon-table-icon-only-button');
	icon.tabIndex = options.focusable === false ? -1 : 0;
	icon.setAttribute('role', 'img');
	setAccessibleLabelWithoutTooltip(icon, options.ariaLabel);
	if (options.color) {
		icon.style.setProperty('--operon-table-icon-only-color', options.color);
		icon.style.setProperty('--operon-live-hover-border', options.color);
		icon.style.setProperty('--operon-task-chip-hover-accent', options.color);
	}
	setIcon(icon, options.icon);
	if (!icon.querySelector('svg')) {
		setIcon(icon, 'text');
	}
	if (options.showTooltip !== false) {
		bindOperonHoverTooltip(icon, {
			title: options.title,
			content: options.content,
			contentEl: options.contentEl,
			taskColor: options.color,
			preferredHorizontal: 'center',
		});
	}
	return icon;
}
