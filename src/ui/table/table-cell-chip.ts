import { setIcon } from 'obsidian';
import { parseListValue } from '../../core/parser';
import type { IndexedTask } from '../../types/fields';
import type { OperonSettings } from '../../types/settings';
import type { TableColumn } from '../../types/table';
import { resolveTaskDateTone, resolveTaskDateToneColor, type TaskDateTone } from '../../core/task-date-tone';
import { normalizeTaskIconValue } from '../../core/task-icon-value';
import { t } from '../../core/i18n';
import { setAccessibleLabelWithoutTooltip } from '../accessibility-label';
import { parseExternalLinkValue, type ExternalLinkValue } from '../field-pickers/links-utils';
import { bindOperonHoverTooltip } from '../operon-hover-tooltip';
import { getTaskSourceOpenModifierLabel, isTaskSourceOpenModifierClick } from '../task-source-open-modifier';
import { resolveTableColumnCellAccent } from './table-column-color';
import { PROJECT_SERIAL_TABLE_FIELD_KEY, getTableTaskField } from './table-field-catalog';
import { resolveTableValueCellIcon } from './table-icon-only-cell';
import { resolveTableLocationCellVisual, type TableLocationCellResolver, type TableLocationCellVisual } from './table-location-cell';
import type { WorkflowStatusIdentityIndex } from '../../core/workflow-status-identity';
import {
	resolveBlockedByVisualStateColor,
	resolveBlockedByVisualStateForId,
} from '../../core/blocked-by-visual-state';
import type { TableTaskLookup } from './table-value-adapter';
import { formatTableDetailedDatetimeValue } from './table-datetime-format';
import { isTableDurationLikeTaskField } from './table-display';
import { bindTableParentTaskTooltip } from './table-parent-task-tooltip';

export { formatTableDetailedDatetimeValue } from './table-datetime-format';

type TableCellChipSettings = Pick<OperonSettings, 'colorPalette' | 'keyMappings' | 'pipelines' | 'priorities' | 'timeFormat'>;

export interface TableCellChipRenderOptions {
	column?: Pick<TableColumn, 'key' | 'colorMode'>;
	task?: IndexedTask;
	settings?: TableCellChipSettings;
	taskLookup?: TableTaskLookup;
	workflowStatusIdentityIndex?: WorkflowStatusIdentityIndex;
	accentValue?: string;
	locationResolver?: TableLocationCellResolver | null;
	onLocationPreview?: (trigger: HTMLElement, visual: TableLocationCellVisual) => void;
	onExternalLinkModifierActivate?: (trigger: HTMLElement, link: ExternalLinkValue) => void;
}

export interface TableCellChipGroupRenderOptions extends TableCellChipRenderOptions {
	chipClassName: string;
}

export function isTableDateLikeFieldType(type: string | null | undefined): boolean {
	return type === 'date' || type === 'datetime';
}

export function decorateTableDateValueChip(chip: HTMLElement, type: string | null | undefined): void {
	if (isTableDateLikeFieldType(type)) chip.addClass('operon-table-date-value-chip');
}

interface TableCellChipItem {
	rawValue: string;
	displayValue: string;
}

interface TableListValueChipOptions {
	tooltipMode?: 'overflow' | 'none';
}

export function renderTableCellChips(
	container: HTMLElement,
	key: string,
	value: string,
	options: TableCellChipGroupRenderOptions,
): void {
	const listField = isTableListChipField(key, options);
	const items = getTableCellChipItems(key, value, options);
	const chipParent = listField
		? container.createSpan('operon-table-cell-chip-list')
		: container;
	for (const item of items) {
		const chip = chipParent.createSpan(options.chipClassName);
		renderTableCellChipContent(chip, key, item.displayValue, {
			...options,
			accentValue: item.rawValue,
		});
		if (listField) {
			decorateTableListValueChip(chip, item.displayValue, {
				tooltipMode: key === 'links' && options.onExternalLinkModifierActivate
					? 'none'
					: 'overflow',
			});
		}
	}
}

export function decorateTableListValueChip(
	chip: HTMLElement,
	displayValue: string,
	options: TableListValueChipOptions = {},
): void {
	chip.addClass('operon-table-list-value-chip');
	const tooltipMode = options.tooltipMode ?? 'overflow';
	if (tooltipMode === 'none' || !displayValue) return;
	bindOperonHoverTooltip(chip, {
		content: displayValue,
		taskColor: null,
		preferredHorizontal: 'center',
		shouldOpen: () => isTableListValueChipOverflowing(chip),
	});
}

export function isTableListValueChipOverflowing(chip: HTMLElement): boolean {
	const overflowTarget = chip.querySelector<HTMLElement>('.operon-table-cell-chip-label') ?? chip;
	if (overflowTarget.scrollWidth > overflowTarget.clientWidth + 1) return true;
	const clippingParent = chip.closest<HTMLElement>('.operon-table-cell-chip-list');
	if (!clippingParent) return false;
	const chipRect = chip.getBoundingClientRect();
	const parentRect = clippingParent.getBoundingClientRect();
	return chipRect.left < parentRect.left - 1 || chipRect.right > parentRect.right + 1;
}

export function renderTableCellChipContent(
	chip: HTMLElement,
	key: string,
	value: string,
	options: TableCellChipRenderOptions = {},
): void {
	const field = options.settings ? getTableTaskField(key, options.settings) : null;
	if (key === 'parentTask') chip.addClass('operon-table-parent-task-chip');
	if (options.settings && isTableDurationLikeTaskField(key, options.settings)) {
		chip.addClass('operon-table-duration-like-chip');
	}
	decorateTableDateValueChip(chip, field?.type);
	applyTableCellChipAccent(chip, key, value, options);
	const externalLink = resolveTableExternalLink(key, value, options);
	if (externalLink) {
		renderTableExternalLinkChip(chip, externalLink, options.onExternalLinkModifierActivate!);
		return;
	}
	const displayValue = formatTableDetailedDatetimeValue(key, value, options.settings);
	if (isTableListChipField(key, options) && !isTableDependencyField(key)) {
		chip.createSpan({
			cls: 'operon-table-cell-chip-label',
			text: displayValue,
		});
		return;
	}
	const locationVisual = resolveTableLocationCellVisual(key, value, options);
	if (locationVisual) {
		renderTableLocationChipContent(
			chip,
			locationVisual,
			resolveTableCellChipAccent(key, value, options),
			options.onLocationPreview,
		);
		return;
	}
	if (isTableValueIconField(key, options)) {
		const preserveDateIconSlot = field?.type === 'date' || field?.type === 'datetime';
		renderTableValueIconChipContent(
			chip,
			displayValue,
			resolveTableValueCellIcon(
				key,
				value,
				options.settings,
				field?.icon ?? 'text',
				options.workflowStatusIdentityIndex,
			),
			preserveDateIconSlot ? 'calendar' : 'text',
			preserveDateIconSlot,
		);
		return;
	}
	if (key !== 'taskIcon') {
		chip.setText(displayValue);
		const parentTaskId = key === 'parentTask' ? (options.accentValue ?? value).trim() : '';
		if (parentTaskId && options.taskLookup?.getTask(parentTaskId)) {
			bindTableParentTaskTooltip(
				chip,
				displayValue,
				parentTaskId,
				resolveTableCellChipAccent(key, value, options),
			);
		}
		return;
	}
	renderTableTaskIconChipContent(chip, value);
}

function resolveTableExternalLink(
	key: string,
	value: string,
	options: TableCellChipRenderOptions,
): ExternalLinkValue | null {
	if (key !== 'links' || !options.onExternalLinkModifierActivate) return null;
	return parseExternalLinkValue(options.accentValue ?? value);
}

function renderTableExternalLinkChip(
	chip: HTMLElement,
	link: ExternalLinkValue,
	onActivate: (trigger: HTMLElement, link: ExternalLinkValue) => void,
): void {
	chip.addClass('operon-table-external-link-chip');
	chip.setText(link.displayValue);
	bindOperonHoverTooltip(chip, {
		title: link.displayValue,
		content: `${link.url}\n${t('table', 'externalLinkWebViewerHint', {
			modifier: getTaskSourceOpenModifierLabel(),
		})}`,
		taskColor: null,
		preferredHorizontal: 'center',
	});

	chip.addEventListener('pointerdown', event => {
		if (event.button !== 0 || !isTaskSourceOpenModifierClick(event)) return;
		event.preventDefault();
		event.stopPropagation();
	});
	chip.addEventListener('click', event => {
		if (event.button !== 0 || event.detail !== 1 || !isTaskSourceOpenModifierClick(event)) return;
		event.preventDefault();
		event.stopPropagation();
		onActivate(chip, link);
	});
	chip.addEventListener('dblclick', event => {
		if (event.button !== 0 || !isTaskSourceOpenModifierClick(event)) return;
		event.preventDefault();
		event.stopPropagation();
	});
}

function getTableCellChipItems(
	key: string,
	value: string,
	options: TableCellChipRenderOptions,
): TableCellChipItem[] {
	if (!isTableListChipField(key, options)) {
		return [{ rawValue: value, displayValue: value }];
	}
	const listItems = parseListValue(value);
	const values = listItems.length > 0 ? listItems : [value.trim()];
	const taskLookup = options.taskLookup;
	if (isTableDependencyField(key) && taskLookup) {
		return values.map(rawValue => {
			const operonId = rawValue.trim();
			const description = resolveTableDependencyDescription(operonId, taskLookup);
			return {
				rawValue,
				displayValue: description,
			};
		});
	}
	return values.map(rawValue => ({
		rawValue,
		displayValue: formatTableCellListChipDisplayValue(rawValue),
	}));
}

export function formatTableDependencyTooltipContent(
	key: string,
	value: string,
	taskLookup: TableTaskLookup | null | undefined,
): string | null {
	if (!isTableDependencyField(key) || !taskLookup) return null;
	const dependencyIds = parseListValue(value)
		.map(operonId => operonId.trim())
		.filter(Boolean);
	if (dependencyIds.length === 0) return null;
	return dependencyIds
		.map(operonId => resolveTableDependencyDescription(operonId, taskLookup))
		.join('\n');
}

function isTableDependencyField(key: string): boolean {
	return key === 'blocking' || key === 'blockedBy';
}

function resolveTableDependencyDescription(operonId: string, taskLookup: TableTaskLookup): string {
	return taskLookup.getTask(operonId)?.description.trim() || operonId;
}

function isTableListChipField(key: string, options: TableCellChipRenderOptions): boolean {
	if (!options.settings) return false;
	const field = getTableTaskField(key, options.settings);
	return field?.type === 'list' || field?.type === 'tags';
}

function isTableValueIconField(key: string, options: TableCellChipRenderOptions): boolean {
	if (key === PROJECT_SERIAL_TABLE_FIELD_KEY) return true;
	if (key === 'status' || key === 'priority' || key === 'blocking' || key === 'blockedBy') return true;
	if (!options.settings) return false;
	const field = getTableTaskField(key, options.settings);
	return field?.type === 'date' || field?.type === 'datetime';
}

export function formatTableCellListChipDisplayValue(rawValue: string): string {
	const trimmed = rawValue.trim();
	const match = /^!?\[\[([^\]]+)\]\]$/u.exec(trimmed);
	if (!match) return rawValue;
	const body = match[1]?.trim() ?? '';
	if (!body) return rawValue;
	const pipeIndex = body.indexOf('|');
	if (pipeIndex >= 0) {
		const alias = body.slice(pipeIndex + 1).trim();
		if (alias) return alias;
	}
	const linkTarget = (pipeIndex >= 0 ? body.slice(0, pipeIndex) : body).trim();
	if (!linkTarget) return rawValue;
	return formatTableCellWikiLinkTargetLabel(linkTarget) || rawValue;
}

export function formatTableListIconOnlyTooltipContent(values: readonly string[]): string {
	return values
		.map(formatTableCellListChipDisplayValue)
		.map(value => value.trim())
		.filter(Boolean)
		.join('\n');
}

function formatTableCellWikiLinkTargetLabel(linkTarget: string): string {
	const lastSegment = linkTarget.split('/').pop()?.trim() ?? linkTarget.trim();
	return lastSegment.replace(/\.md(?=($|[#^]))/i, '');
}

function renderTableTaskIconChipContent(chip: HTMLElement, value: string): void {
	const label = value.trim();
	const iconName = normalizeTaskIconValue(label);
	if (iconName) {
		const iconEl = chip.createSpan('operon-inline-compact-chip-icon operon-table-cell-chip-icon');
		iconEl.setAttribute('aria-hidden', 'true');
		setIcon(iconEl, iconName);
		if (!iconEl.querySelector('svg')) {
			iconEl.remove();
		}
	}
	chip.createSpan({
		cls: 'operon-inline-compact-chip-label operon-table-cell-chip-label',
		text: label,
	});
}

function renderTableValueIconChipContent(
	chip: HTMLElement,
	value: string,
	iconName: string,
	fallbackIconName = 'text',
	preserveIconSlot = false,
): void {
	const iconEl = chip.createSpan('operon-inline-compact-chip-icon operon-table-cell-chip-icon');
	iconEl.setAttribute('aria-hidden', 'true');
	setIcon(iconEl, iconName);
	if (!iconEl.querySelector('svg') && fallbackIconName !== iconName) {
		setIcon(iconEl, fallbackIconName);
	}
	if (!preserveIconSlot && !iconEl.querySelector('svg')) {
		iconEl.remove();
	}
	chip.createSpan({
		cls: 'operon-inline-compact-chip-label operon-table-cell-chip-label',
		text: value.trim(),
	});
}

function renderTableLocationChipContent(
	chip: HTMLElement,
	visual: TableLocationCellVisual,
	iconColor: string | null,
	onLocationPreview: ((trigger: HTMLElement, visual: TableLocationCellVisual) => void) | undefined,
): void {
	chip.addClass('is-location');
	if (iconColor) {
		chip.style.setProperty('--operon-inline-chip-icon-color', iconColor);
		chip.style.setProperty('--operon-live-hover-border', iconColor);
		chip.style.setProperty('--operon-task-chip-hover-accent', iconColor);
	}
	const iconEl = chip.createSpan('operon-inline-compact-chip-icon operon-table-cell-chip-icon');
	iconEl.setAttribute('aria-hidden', 'true');
	setIcon(iconEl, visual.icon);
	if (!iconEl.querySelector('svg')) {
		setIcon(iconEl, 'map-pin');
	}
	if (!iconEl.querySelector('svg')) {
		iconEl.remove();
	}
	chip.createSpan({
		cls: 'operon-inline-compact-chip-label operon-table-cell-chip-label',
		text: visual.label,
	});
	if (!onLocationPreview) return;
	chip.addClass('operon-chip-clickable');
	chip.tabIndex = 0;
	chip.setAttribute('role', 'button');
	setAccessibleLabelWithoutTooltip(chip, visual.label);
	chip.addEventListener('click', event => {
		event.preventDefault();
		event.stopPropagation();
		onLocationPreview(chip, visual);
	});
	chip.addEventListener('keydown', event => {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		event.stopPropagation();
		onLocationPreview(chip, visual);
	});
}

function applyTableCellChipAccent(
	chip: HTMLElement,
	key: string,
	value: string,
	options: TableCellChipRenderOptions,
): void {
	applyTableColumnCellAccent(chip, options.column ?? { key }, options.accentValue ?? value, options);
	const blockedByStateAccent = resolveTableCellBlockedByStateAccent(key, value, options);
	if (blockedByStateAccent) {
		chip.addClass('operon-table-blocked-by-state-chip');
		applyTableCellAccentVariables(chip, blockedByStateAccent);
	}
	const dateStateAccent = resolveTableCellDateStateAccent(key, value, options);
	if (!dateStateAccent) return;
	chip.addClass('operon-table-field-accent-chip');
	chip.addClass('operon-table-date-state-chip');
	chip.addClass(dateStateAccent.tone === 'today' ? 'is-today' : 'is-overdue');
	applyTableCellAccentVariables(chip, dateStateAccent.color);
}

function resolveTableCellChipAccent(
	key: string,
	value: string,
	options: TableCellChipRenderOptions,
): string | null {
	return resolveTableColumnCellAccent(options.column ?? { key }, options.accentValue ?? value, options);
}

function resolveTableCellBlockedByStateAccent(
	key: string,
	value: string,
	options: TableCellChipRenderOptions,
): string | null {
	if (key !== 'blockedBy' || !options.settings || !options.taskLookup) return null;
	const operonId = (options.accentValue ?? value).trim();
	if (!operonId) return null;
	const state = resolveBlockedByVisualStateForId(
		operonId,
		id => options.taskLookup?.getTask(id) ?? undefined,
		options.settings.pipelines,
		options.workflowStatusIdentityIndex,
	);
	return resolveBlockedByVisualStateColor(state);
}

function resolveTableCellDateStateAccent(
	key: string,
	value: string,
	options: TableCellChipRenderOptions,
): { tone: Exclude<TaskDateTone, 'default'>; color: string } | null {
	const tone = resolveTaskDateTone(key, options.accentValue ?? value, options.task?.fieldValues ?? {});
	const color = resolveTaskDateToneColor(tone);
	if (!color || tone === 'default') return null;
	return { tone, color };
}

function applyTableCellAccentVariables(target: HTMLElement, accent: string, decorateAsChip = true): void {
	if (decorateAsChip) target.addClass('operon-table-field-accent-chip');
	target.style.setProperty('--operon-table-field-accent', accent);
	target.style.setProperty('--operon-inline-chip-icon-color', accent);
	target.style.setProperty('--operon-task-chip-hover-accent', accent);
	target.style.setProperty('--operon-live-hover-border', accent);
}

export function applyTableColumnCellAccent(
	target: HTMLElement,
	column: Pick<TableColumn, 'key' | 'colorMode'>,
	value: string,
	options: {
		task?: IndexedTask;
		settings?: Pick<OperonSettings, 'colorPalette' | 'pipelines' | 'priorities'>;
		workflowStatusIdentityIndex?: WorkflowStatusIdentityIndex;
		decorateAsChip?: boolean;
	} = {},
): string | null {
	const accent = resolveTableColumnCellAccent(column, value, options);
	if (accent) applyTableCellAccentVariables(target, accent, options.decorateAsChip);
	return accent;
}
