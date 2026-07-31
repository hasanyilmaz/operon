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

type TableCellChipSettings = Pick<OperonSettings, 'colorPalette' | 'keyMappings' | 'pipelines' | 'priorities'>;
const TABLE_DEPENDENCY_DESCRIPTION_MAX_LENGTH = 37;

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

interface TableCellChipItem {
	rawValue: string;
	displayValue: string;
	tooltipContent?: string;
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
		if (item.tooltipContent) {
			bindOperonHoverTooltip(chip, {
				content: item.tooltipContent,
				taskColor: null,
				preferredHorizontal: 'center',
			});
		}
	}
}

export function renderTableCellChipContent(
	chip: HTMLElement,
	key: string,
	value: string,
	options: TableCellChipRenderOptions = {},
): void {
	applyTableCellChipAccent(chip, key, value, options);
	const externalLink = resolveTableExternalLink(key, value, options);
	if (externalLink) {
		renderTableExternalLinkChip(chip, externalLink, options.onExternalLinkModifierActivate!);
		return;
	}
	const displayValue = formatTableDetailedDatetimeValue(key, value);
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

export function formatTableDetailedDatetimeValue(key: string, value: string): string {
	if (key !== 'datetimeStart' && key !== 'datetimeEnd') return value;
	return value.replace(/^(\d{4}-\d{2}-\d{2})T/u, '$1 ');
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
				displayValue: truncateTableDependencyDescription(description),
				tooltipContent: description,
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

function truncateTableDependencyDescription(value: string): string {
	if (value.length <= TABLE_DEPENDENCY_DESCRIPTION_MAX_LENGTH) return value;
	return `${value.slice(0, TABLE_DEPENDENCY_DESCRIPTION_MAX_LENGTH - 3).trimEnd()}...`;
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
