import { setIcon } from 'obsidian';
import { t } from '../../core/i18n';
import type { OperonSettings } from '../../types/settings';
import { type TablePreset, type TableSortDirection, type TableSortRule } from '../../types/table';
import { setAccessibleLabelWithoutTooltip } from '../accessibility-label';
import { createFloatingPanel, requestFloatingInputFocus } from '../field-pickers/common';
import { showSearchableFieldPicker } from '../field-pickers/searchable-field-picker';
import { bindOperonHoverTooltip, cleanupOperonHoverTooltips } from '../operon-hover-tooltip';
import { buildTableGroupSortFieldCatalog } from './table-field-catalog';
import { buildTableFieldPickerOptions, getTableFieldPickerLabel } from './table-field-picker-options';
import {
	type TableGroupSortPresetPatchScope,
	normalizeTablePresetForEditing,
	replaceTablePresetSortRules,
	setTablePresetGroupBy,
	setTablePresetGroupOrder,
	setTablePresetSubgroupBy,
	setTablePresetSubgroupOrder,
} from './table-preset-model';

interface TableGroupSortPopoverOptions {
	anchor: HTMLElement | DOMRect;
	floatingHost?: HTMLElement;
	floatingScrollHost?: HTMLElement | Window;
	preset: TablePreset;
	settings: OperonSettings;
	onChange: (preset: TablePreset, scope: TableGroupSortPresetPatchScope) => void;
	onClose?: () => void;
}

export function showTableGroupSortPopover(options: TableGroupSortPopoverOptions): () => void {
	const catalog = buildTableGroupSortFieldCatalog(options.settings);
	const supportedKeys = new Set(catalog.map(field => field.key));
	let draft = normalizeTablePresetForEditing(options.preset);
	const { panel, close: closePanel } = createFloatingPanel(
		options.anchor,
		'operon-floating-panel operon-table-group-sort-popover',
		() => {
			cleanupOperonHoverTooltips(panel);
			options.onClose?.();
		},
		{
			focusInputSelector: '.operon-table-group-sort-field-select',
			floatingHost: options.floatingHost,
			floatingScrollHost: options.floatingScrollHost,
			repositionOnScroll: true,
			repositionOnWindowResize: true,
			shouldClose: reason => reason !== 'window-blur',
		},
	);

	panel.setAttribute('role', 'dialog');
	setAccessibleLabelWithoutTooltip(panel, t('table', 'groupSort'));

	let render = (_focusKey?: string): void => undefined;
	const commit = (
		updatedPreset: TablePreset,
		scope: TableGroupSortPresetPatchScope,
		focusKey?: string,
	): void => {
		draft = normalizeTablePresetForEditing(updatedPreset);
		render(focusKey);
		options.onChange(draft, scope);
	};

	render = (focusKey?: string): void => {
		cleanupOperonHoverTooltips(panel);
		panel.empty();
		renderGroupingSection(panel, draft, catalog, supportedKeys, commit);
		renderSortSection(panel, draft, catalog, supportedKeys, commit);
		const requestedFocusTarget = focusKey
			? panel.querySelector<HTMLElement>(`[data-operon-table-group-sort-focus="${focusKey}"]`)
			: null;
		const focusTarget = requestedFocusTarget
			?? panel.querySelector<HTMLElement>('.operon-table-group-sort-field-select:not(:disabled)');
		if (focusTarget) requestFloatingInputFocus(focusTarget);
	};

	render();
	return () => {
		cleanupOperonHoverTooltips(panel);
		closePanel();
	};
}

function renderGroupingSection(
	panel: HTMLElement,
	preset: TablePreset,
	catalog: ReturnType<typeof buildTableGroupSortFieldCatalog>,
	supportedKeys: ReadonlySet<string>,
	commit: (preset: TablePreset, scope: TableGroupSortPresetPatchScope, focusKey?: string) => void,
): void {
	const section = panel.createDiv('operon-table-group-sort-section');
	section.createDiv({ cls: 'operon-table-group-sort-section-title', text: t('table', 'groupBy') });
	renderGroupingRow(section, {
		label: t('table', 'groupBy'),
		fieldValue: preset.groupBy ?? '',
		orderValue: preset.groupOrder,
		fieldPlaceholder: t('table', 'noGrouping'),
		catalog,
		floatingHost: panel,
		focusFieldKey: 'group-field',
		focusOrderKey: 'group-order',
		focusClearKey: 'group-clear',
		clearLabel: t('table', 'removeGroup'),
		onFieldChange: value => commit(setTablePresetGroupBy(preset, value || null, supportedKeys), 'grouping', 'group-field'),
		onOrderChange: direction => commit(setTablePresetGroupOrder(preset, direction), 'grouping', 'group-order'),
		onClear: () => commit(setTablePresetGroupBy(preset, null, supportedKeys), 'grouping', 'group-field'),
	});
	renderGroupingRow(section, {
		label: t('table', 'subgroupBy'),
		fieldValue: preset.subgroupBy ?? '',
		orderValue: preset.subgroupOrder,
		fieldPlaceholder: t('table', 'noSubgrouping'),
		catalog,
		floatingHost: panel,
		excludedFieldKey: preset.groupBy,
		disabled: !preset.groupBy,
		focusFieldKey: 'subgroup-field',
		focusOrderKey: 'subgroup-order',
		focusClearKey: 'subgroup-clear',
		clearLabel: t('table', 'removeSubgroup'),
		onFieldChange: value => commit(setTablePresetSubgroupBy(preset, value || null, supportedKeys), 'grouping', 'subgroup-field'),
		onOrderChange: direction => commit(setTablePresetSubgroupOrder(preset, direction), 'grouping', 'subgroup-order'),
		onClear: () => commit(setTablePresetSubgroupBy(preset, null, supportedKeys), 'grouping', 'subgroup-field'),
	});
}

function renderGroupingRow(
	container: HTMLElement,
	options: {
		label: string;
		fieldValue: string;
		orderValue: TableSortDirection;
		fieldPlaceholder: string;
		catalog: ReturnType<typeof buildTableGroupSortFieldCatalog>;
		floatingHost: HTMLElement;
		excludedFieldKey?: string | null;
		disabled?: boolean;
		focusFieldKey: string;
		focusOrderKey: string;
		focusClearKey: string;
		clearLabel: string;
		onFieldChange: (value: string) => void;
		onOrderChange: (direction: TableSortDirection) => void;
		onClear: () => void;
	},
): void {
	const row = container.createDiv('operon-table-group-sort-row');
	row.toggleClass('is-disabled', options.disabled === true);
	row.createDiv({ cls: 'operon-table-group-sort-row-label', text: options.label });
	const controls = row.createDiv('operon-table-group-sort-row-controls');
	renderTableFieldPickerButton(controls, {
		value: options.fieldValue,
		label: options.label,
		placeholder: options.fieldPlaceholder,
		catalog: options.catalog,
		floatingHost: options.floatingHost,
		excludedFieldKeys: options.excludedFieldKey ? new Set([options.excludedFieldKey]) : undefined,
		disabled: options.disabled === true,
		focusKey: options.focusFieldKey,
		onFieldChange: options.onFieldChange,
	});

	renderDirectionToggle(controls, {
		direction: options.orderValue,
		label: t('table', 'groupOrder'),
		disabled: options.disabled === true || !options.fieldValue,
		focusKey: options.focusOrderKey,
		onToggle: () => options.onOrderChange(toggleSortDirection(options.orderValue)),
	});

	renderIconButton(
		controls,
		'trash-2',
		options.clearLabel,
		options.disabled === true || !options.fieldValue,
		options.onClear,
		options.focusClearKey,
	);
}

function renderSortSection(
	panel: HTMLElement,
	preset: TablePreset,
	catalog: ReturnType<typeof buildTableGroupSortFieldCatalog>,
	supportedKeys: ReadonlySet<string>,
	commit: (preset: TablePreset, scope: TableGroupSortPresetPatchScope, focusKey?: string) => void,
): void {
	const section = panel.createDiv('operon-table-group-sort-section');
	section.createDiv({ cls: 'operon-table-group-sort-section-title', text: t('table', 'sortBy') });
	if (preset.sortRules.length === 0) {
		section.createDiv({ cls: 'operon-table-group-sort-empty', text: t('table', 'sortEmptyState') });
	}
	preset.sortRules.forEach((rule, index) => {
		renderSortRow(section, {
			preset,
			rule,
			index,
			catalog,
			floatingHost: panel,
			supportedKeys,
			commit,
		});
	});
	const addButton = section.createEl('button', {
		cls: 'operon-table-group-sort-add-button',
		attr: { type: 'button' },
	});
	setIcon(addButton.createSpan('operon-table-group-sort-button-icon'), 'plus');
	addButton.createSpan({ text: t('table', 'addSort') });
	const nextFieldKey = catalog.find(field => !preset.sortRules.some(rule => rule.key === field.key))?.key ?? null;
	addButton.disabled = !nextFieldKey;
	addButton.addEventListener('click', event => {
		event.preventDefault();
		if (!nextFieldKey) return;
			commit(replaceTablePresetSortRules(
				preset,
				[...preset.sortRules, { key: nextFieldKey, direction: 'asc', empty: 'last' }],
				supportedKeys,
			), 'sortRules', `sort-field-${preset.sortRules.length}`);
		});
}

function renderSortRow(
	container: HTMLElement,
	options: {
		preset: TablePreset;
		rule: TableSortRule;
		index: number;
		catalog: ReturnType<typeof buildTableGroupSortFieldCatalog>;
		floatingHost: HTMLElement;
		supportedKeys: ReadonlySet<string>;
			commit: (preset: TablePreset, scope: TableGroupSortPresetPatchScope, focusKey?: string) => void;
	},
): void {
	const { preset, rule, index, catalog, supportedKeys, commit } = options;
	const row = container.createDiv('operon-table-group-sort-sort-row');
	const handle = row.createSpan('operon-table-group-sort-sort-handle');
	setIcon(handle, 'grip-vertical');
	const usedByOtherRules = new Set(preset.sortRules
		.filter((_, ruleIndex) => ruleIndex !== index)
		.map(sortRule => sortRule.key));
	renderTableFieldPickerButton(row, {
		value: rule.key,
		label: t('table', 'sortBy'),
		placeholder: t('table', 'fieldPlaceholder'),
		catalog,
		floatingHost: options.floatingHost,
		excludedFieldKeys: usedByOtherRules,
		focusKey: `sort-field-${index}`,
		onFieldChange: value => {
			const nextRules = preset.sortRules.map((sortRule, ruleIndex) => ruleIndex === index
				? { ...sortRule, key: value }
				: sortRule);
				commit(replaceTablePresetSortRules(preset, nextRules, supportedKeys), 'sortRules', `sort-field-${index}`);
			},
	});

	renderDirectionToggle(row, {
		direction: rule.direction,
		label: t('table', 'sortBy'),
		focusKey: `sort-direction-${index}`,
		onToggle: () => {
			const nextRules = preset.sortRules.map((sortRule, ruleIndex) => ruleIndex === index
				? { ...sortRule, direction: toggleSortDirection(rule.direction) }
				: sortRule);
			commit(replaceTablePresetSortRules(preset, nextRules, supportedKeys), 'sortRules', `sort-direction-${index}`);
		},
	});

	renderIconButton(row, 'arrow-up', t('table', 'moveSortUp'), index === 0, () => {
		const nextRules = [...preset.sortRules];
		[nextRules[index - 1], nextRules[index]] = [nextRules[index], nextRules[index - 1]];
			commit(replaceTablePresetSortRules(preset, nextRules, supportedKeys), 'sortRules', `sort-field-${Math.max(0, index - 1)}`);
		}, `sort-up-${index}`);
	renderIconButton(row, 'arrow-down', t('table', 'moveSortDown'), index === preset.sortRules.length - 1, () => {
		const nextRules = [...preset.sortRules];
		[nextRules[index], nextRules[index + 1]] = [nextRules[index + 1], nextRules[index]];
			commit(replaceTablePresetSortRules(preset, nextRules, supportedKeys), 'sortRules', `sort-field-${index + 1}`);
		}, `sort-down-${index}`);
	renderIconButton(row, 'trash-2', t('table', 'removeSort'), false, () => {
			commit(replaceTablePresetSortRules(
				preset,
				preset.sortRules.filter((_, ruleIndex) => ruleIndex !== index),
				supportedKeys,
			), 'sortRules', `sort-field-${Math.max(0, index - 1)}`);
		}, `sort-remove-${index}`);
}

function renderTableFieldPickerButton(
	container: HTMLElement,
	options: {
		value: string;
		label: string;
		placeholder: string;
		catalog: ReturnType<typeof buildTableGroupSortFieldCatalog>;
		floatingHost: HTMLElement;
		excludedFieldKeys?: ReadonlySet<string>;
		disabled?: boolean;
		focusKey: string;
		onFieldChange: (value: string) => void;
	},
): void {
	const button = container.createEl('button', {
		cls: 'operon-table-group-sort-field-select operon-field-picker-trigger operon-table-field-picker-trigger',
		attr: {
			type: 'button',
			'aria-haspopup': 'listbox',
			'aria-expanded': 'false',
			'data-operon-table-group-sort-focus': options.focusKey,
		},
	});
	setAccessibleLabelWithoutTooltip(button, options.label);
	button.disabled = options.disabled === true;
	const label = getTableFieldPickerLabel(options.catalog, options.value, options.placeholder);
	button.createSpan({ cls: 'operon-field-picker-trigger-label', text: label });
	const iconEl = button.createSpan('operon-field-picker-trigger-icon');
	setIcon(iconEl, 'chevron-down');
	button.addEventListener('click', event => {
		event.preventDefault();
		if (button.disabled) return;
		button.setAttribute('aria-expanded', 'true');
		showSearchableFieldPicker(button, {
			value: options.value,
			fields: buildTableFieldPickerOptions(options.catalog, {
				excludedFieldKeys: options.excludedFieldKeys,
			}),
			placeholder: t('table', 'fieldPickerSearchPlaceholder'),
			ariaLabel: options.label,
			noMatchesText: t('table', 'fieldPickerNoMatches'),
			onSelect: option => options.onFieldChange(option.field),
			onClose: () => {
				if (button.isConnected) button.setAttribute('aria-expanded', 'false');
			},
			variantClassName: 'operon-table-field-picker',
			floatingHost: options.floatingHost,
			floatingScrollHost: options.floatingHost,
			matchWidth: Math.max(button.getBoundingClientRect().width, 280),
			repositionOnScroll: true,
			repositionOnWindowResize: true,
		});
	});
}

function renderDirectionToggle(
	container: HTMLElement,
options: {
		direction: TableSortDirection;
		label: string;
		disabled?: boolean;
		focusKey: string;
		onToggle: () => void;
	},
): void {
	const directionLabel = getTableSortDirectionLabel(options.direction);
	const button = container.createEl('button', {
		cls: 'operon-table-group-sort-icon-button operon-table-group-sort-direction-toggle',
		attr: { type: 'button' },
	});
	button.dataset.operonTableGroupSortFocus = options.focusKey;
	button.disabled = options.disabled === true;
	setAccessibleLabelWithoutTooltip(button, `${options.label}: ${directionLabel}`);
	setIcon(button, options.direction === 'asc' ? 'arrow-down-a-z' : 'arrow-down-z-a');
	bindOperonHoverTooltip(button, { content: directionLabel, taskColor: null });
	button.addEventListener('click', event => {
		event.preventDefault();
		if (button.disabled) return;
		options.onToggle();
	});
}

function renderIconButton(
	container: HTMLElement,
	icon: string,
	label: string,
	disabled: boolean,
	onClick: () => void,
	focusKey?: string,
): void {
	const button = container.createEl('button', {
		cls: 'operon-table-group-sort-icon-button',
		attr: {
			type: 'button',
		},
	});
	setAccessibleLabelWithoutTooltip(button, label);
	if (focusKey) button.dataset.operonTableGroupSortFocus = focusKey;
	button.disabled = disabled;
	setIcon(button, icon);
	button.addEventListener('click', event => {
		event.preventDefault();
		if (button.disabled) return;
		onClick();
	});
}

function toggleSortDirection(direction: TableSortDirection): TableSortDirection {
	return direction === 'asc' ? 'desc' : 'asc';
}

function getTableSortDirectionLabel(direction: TableSortDirection): string {
	return direction === 'desc' ? t('table', 'sortDirectionZA') : t('table', 'sortDirectionAZ');
}
