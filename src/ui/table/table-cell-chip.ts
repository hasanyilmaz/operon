import { setIcon } from 'obsidian';
import { parseListValue } from '../../core/parser';
import type { IndexedTask } from '../../types/fields';
import type { OperonSettings } from '../../types/settings';
import type { TableColumn } from '../../types/table';
import { resolveTaskDateTone, resolveTaskDateToneColor, type TaskDateTone } from '../../core/task-date-tone';
import { normalizeTaskIconValue } from '../../core/task-icon-value';
import { setAccessibleLabelWithoutTooltip } from '../accessibility-label';
import { resolveTableColumnCellAccent } from './table-column-color';
import { PROJECT_SERIAL_TABLE_FIELD_KEY, getTableTaskField } from './table-field-catalog';
import { resolveTableValueCellIcon } from './table-icon-only-cell';
import { resolveTableLocationCellVisual, type TableLocationCellResolver, type TableLocationCellVisual } from './table-location-cell';
import type { WorkflowStatusIdentityIndex } from '../../core/workflow-status-identity';

type TableCellChipSettings = Pick<OperonSettings, 'colorPalette' | 'keyMappings' | 'pipelines' | 'priorities'>;

export interface TableCellChipRenderOptions {
	column?: Pick<TableColumn, 'key' | 'colorMode'>;
	task?: IndexedTask;
	settings?: TableCellChipSettings;
	workflowStatusIdentityIndex?: WorkflowStatusIdentityIndex;
	accentValue?: string;
	locationResolver?: TableLocationCellResolver | null;
	onLocationPreview?: (trigger: HTMLElement, visual: TableLocationCellVisual) => void;
}

export interface TableCellChipGroupRenderOptions extends TableCellChipRenderOptions {
	chipClassName: string;
}

interface TableCellChipItem {
	rawValue: string;
	displayValue: string;
}

export function renderTableCellChips(
	container: HTMLElement,
	key: string,
	value: string,
	options: TableCellChipGroupRenderOptions,
): void {
	const items = getTableCellChipItems(key, value, options);
	const chipParent = items.length > 1
		? container.createSpan('operon-table-cell-chip-list')
		: container;
	for (const item of items) {
		const chip = chipParent.createSpan(options.chipClassName);
		renderTableCellChipContent(chip, key, item.displayValue, {
			...options,
			accentValue: item.rawValue,
		});
	}
}

export function renderTableCellChipContent(
	chip: HTMLElement,
	key: string,
	value: string,
	options: TableCellChipRenderOptions = {},
): void {
	applyTableCellChipAccent(chip, key, value, options);
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
		const field = options.settings ? getTableTaskField(key, options.settings) : null;
		const preserveDateIconSlot = field?.type === 'date' || field?.type === 'datetime';
		renderTableValueIconChipContent(
			chip,
			value,
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
		chip.setText(value);
		return;
	}
	renderTableTaskIconChipContent(chip, value);
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
	return values.map(rawValue => ({
		rawValue,
		displayValue: formatTableCellListChipDisplayValue(rawValue),
	}));
}

function isTableListChipField(key: string, options: TableCellChipRenderOptions): boolean {
	if (!options.settings) return false;
	const field = getTableTaskField(key, options.settings);
	return field?.type === 'list' || field?.type === 'tags';
}

function isTableValueIconField(key: string, options: TableCellChipRenderOptions): boolean {
	if (key === PROJECT_SERIAL_TABLE_FIELD_KEY) return true;
	if (key === 'status' || key === 'priority') return true;
	if (!options.settings) return false;
	const field = getTableTaskField(key, options.settings);
	return field?.type === 'date' || field?.type === 'datetime';
}

function formatTableCellListChipDisplayValue(rawValue: string): string {
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
	const accent = resolveTableCellChipAccent(key, value, options);
	if (accent) {
		applyTableCellAccentVariables(chip, accent);
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

function applyTableCellAccentVariables(chip: HTMLElement, accent: string): void {
	chip.addClass('operon-table-field-accent-chip');
	chip.style.setProperty('--operon-table-field-accent', accent);
	chip.style.setProperty('--operon-inline-chip-icon-color', accent);
	chip.style.setProperty('--operon-task-chip-hover-accent', accent);
	chip.style.setProperty('--operon-live-hover-border', accent);
}
