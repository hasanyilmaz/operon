import { App, Modal, Notice, Setting, setIcon } from 'obsidian';
import { getNormalFilterSets } from '../../core/dynamic-file-task-filter';
import { t } from '../../core/i18n';
import type { FilterSet, OperonSettings } from '../../types/settings';
import { cloneTablePreset, type TablePreset, type TablePresetPatch, type TableSortDirection, type TableSortRule, type TableSummaryFunction, type TableSummaryRule } from '../../types/table';
import type { FilterModalEvalDeps } from '../filter-set-modal';
import { setAccessibleLabelWithoutTooltip } from '../accessibility-label';
import { showSearchableFieldPicker } from '../field-pickers/searchable-field-picker';
import { bindOperonHoverTooltip } from '../operon-hover-tooltip';
import { createPresetFavoriteButton } from '../preset-favorite-button';
import { renderPresetFilterActions } from '../preset-filter-actions';
import { isPresetFavorite } from '../../core/preset-favorites';
import {
	applyTablePresetFieldAliases,
	buildTableGroupSortFieldCatalog,
	buildEffectiveTableTaskFieldCatalog,
	buildTableTaskFieldCatalog,
	getTableColumnLabel,
	type TableTaskField,
	TABLE_WORKFLOW_PIPELINE_FIELD_KEY,
} from './table-field-catalog';
import { buildTableFieldPickerOptions, getTableFieldPickerLabel } from './table-field-picker-options';
import { isTableFilePropertyColumnKey, type TableFilePropertyField } from './table-file-property';
import {
	filterCompatibleTableSummaryRules,
	getTableSummaryFunctionsForField,
} from './table-summary';
import {
	createTablePresetFromSource,
	filterTablePresetColumnsBySupportedKeys,
	filterTablePresetGroupByBySupportedKeys,
	filterTablePresetSortRulesBySupportedKeys,
	getTablePresetColumnMoveTargetKey,
	moveTablePresetColumnByDelta,
	normalizeTablePresetForColumnUi,
	replaceTablePresetSortRules,
	setTablePresetGroupBy,
	setTablePresetGroupOrder,
	setTablePresetSubgroupBy,
	setTablePresetSubgroupOrder,
	setTablePresetColumnVisible,
} from './table-preset-model';

interface TablePresetQuickSettingsModalOptions {
	getSettings: () => OperonSettings;
	preset: TablePreset | null;
	onSave: (patch: TablePresetPatch, preset: TablePreset) => Promise<void>;
	onCreate: (preset: TablePreset) => Promise<void>;
	onDuplicate: (preset: TablePreset) => Promise<void>;
	onDelete?: (presetId: string) => Promise<void>;
	onToggleFavorite: (presetId: string) => Promise<void>;
	onSaveFilterSet: (filterSet: FilterSet) => Promise<void>;
	onToggleFilterFavorite?: (filterSetId: string) => Promise<void>;
	getFilterModalEvalDeps?: () => FilterModalEvalDeps | null;
	getAdditionalColumnFields?: (preset: TablePreset) => readonly TableFilePropertyField[];
	saveWhenClean?: boolean;
	managementMode?: 'full' | 'current-only';
}

export type TablePresetDirtyField = 'name' | 'filterSetId' | 'columns' | 'sortRules' | 'grouping' | 'summaries' | 'display';

export function buildTablePresetDirtyPatch(
	preset: TablePreset,
	dirtyFields: ReadonlySet<TablePresetDirtyField>,
	sourcePreset?: TablePreset | null,
): TablePresetPatch {
	const patch: TablePresetPatch = { id: preset.id };
	if (dirtyFields.has('name')) {
		patch.name = preset.name.trim();
	}
	if (dirtyFields.has('filterSetId')) {
		patch.filterSetId = preset.filterSetId;
	}
	if (dirtyFields.has('columns')) {
		patch.columns = preset.columns.map(column => ({ ...column }));
	}
	if (dirtyFields.has('sortRules')) {
		patch.sortRules = preset.sortRules.map(rule => ({ ...rule }));
	}
	if (dirtyFields.has('grouping')) {
		patch.groupBy = preset.groupBy;
		patch.groupOrder = preset.groupOrder;
		patch.subgroupBy = preset.subgroupBy;
		patch.subgroupOrder = preset.subgroupOrder;
	}
	if (dirtyFields.has('summaries')) {
		patch.summaries = preset.summaries.map(summary => ({ ...summary }));
	}
	if (dirtyFields.has('display')) {
		patch.display = {
			showSource: sourcePreset?.display.showSource ?? preset.display.showSource,
			density: preset.display.density,
		};
	}
	return patch;
}

export class TablePresetQuickSettingsModal extends Modal {
	private readonly options: TablePresetQuickSettingsModalOptions;
	private readonly draftPreset: TablePreset | null;
	private readonly dirtyFields = new Set<TablePresetDirtyField>();

	constructor(app: App, options: TablePresetQuickSettingsModalOptions) {
		super(app);
		this.options = options;
		this.draftPreset = options.preset ? normalizeTablePresetForColumnUi(options.preset) : null;
	}

	onOpen(): void {
		this.modalEl.addClass('operon-table-preset-settings-modal');
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		const preset = this.draftPreset;
		contentEl.empty();
		this.titleEl.setText(preset
			? t('table', 'presetSettingsTitleForName', { name: preset.name || t('table', 'untitledPreset') })
			: t('table', 'presetSettingsTitle'));

		if (!preset) {
			contentEl.createEl('p', { text: t('table', 'activePresetMissing') });
			return;
		}

		const presetCard = this.createSection(contentEl, t('table', 'presetSectionPreset'));
		new Setting(presetCard)
			.setName(t('table', 'presetName'))
			.addText(text => {
				text.setValue(preset.name);
				text.inputEl.addClass('operon-table-preset-name-input');
				text.inputEl.addEventListener('input', () => {
					preset.name = text.inputEl.value;
					this.markDirty('name');
					this.titleEl.setText(t('table', 'presetSettingsTitleForName', {
						name: preset.name.trim() || t('table', 'untitledPreset'),
					}));
				});
				text.inputEl.addEventListener('keydown', event => {
					if (event.key !== 'Enter') return;
					event.preventDefault();
					text.inputEl.blur();
				});
			});

		const settings = this.options.getSettings();
		const filterSets = getNormalFilterSets(settings.filterSets);
		const currentFilter = filterSets.find(entry => entry.id === preset.filterSetId) ?? null;
		const filteringCard = this.createSection(contentEl, t('table', 'presetSectionFiltering'));
		renderPresetFilterActions({
			app: this.app,
			setting: new Setting(filteringCard)
				.setName(t('table', 'presetFilter')),
			getSettings: this.options.getSettings,
			filterSets,
			currentFilter,
			selectedFilterSetId: preset.filterSetId,
			onSelectFilter: async (filterSetId) => {
				preset.filterSetId = filterSetId;
				this.markDirty('filterSetId');
			},
			onSaveFilterSet: this.options.onSaveFilterSet,
			onToggleFilterFavorite: this.options.onToggleFilterFavorite,
			getFilterModalEvalDeps: this.options.getFilterModalEvalDeps,
			onRefresh: () => this.renderPreservingScroll(),
			errorContextPrefix: 'table preset',
		});

		this.renderGroupingSection(contentEl, preset, settings);
		this.renderSortSection(contentEl, preset, settings);
		this.renderSummariesSection(contentEl, preset, settings);
		this.renderDisplaySection(contentEl, preset);
		this.renderColumnsSection(contentEl, preset, settings);
		this.renderButtons(contentEl, preset);
	}

	private renderGroupingSection(container: HTMLElement, preset: TablePreset, settings: OperonSettings): void {
		const card = this.createSection(container, t('table', 'presetSectionGrouping'));
		const catalog = this.buildGroupSortCatalog(preset, settings);
		const supportedKeys = new Set(catalog.map(field => field.key));
		const normalizedPreset = filterTablePresetGroupByBySupportedKeys(preset, supportedKeys);
		const rows = card.createDiv('operon-table-preset-grouping-list');
		this.renderGroupingRuleRow({
			container: rows,
			label: t('table', 'groupBy'),
			description: t('table', 'groupByDesc'),
			fieldValue: normalizedPreset.groupBy ?? '',
			orderValue: normalizedPreset.groupOrder,
			fieldPlaceholder: t('table', 'noGrouping'),
			catalog,
			excludedFieldKey: null,
			disabled: false,
			focusFieldKey: 'group-field',
			focusOrderKey: 'group-order',
			onFieldChange: value => this.updateGrouping(setTablePresetGroupBy(preset, value || null, supportedKeys), 'group-field'),
			onOrderChange: value => this.updateGrouping(setTablePresetGroupOrder(preset, value), 'group-order'),
		});
		this.renderGroupingRuleRow({
			container: rows,
			label: t('table', 'subgroupBy'),
			description: t('table', 'subgroupByDesc'),
			fieldValue: normalizedPreset.subgroupBy ?? '',
			orderValue: normalizedPreset.subgroupOrder,
			fieldPlaceholder: t('table', 'noSubgrouping'),
			catalog,
			excludedFieldKey: normalizedPreset.groupBy,
			disabled: !normalizedPreset.groupBy,
			focusFieldKey: 'subgroup-field',
			focusOrderKey: 'subgroup-order',
			onFieldChange: value => this.updateGrouping(setTablePresetSubgroupBy(preset, value || null, supportedKeys), 'subgroup-field'),
			onOrderChange: value => this.updateGrouping(setTablePresetSubgroupOrder(preset, value), 'subgroup-order'),
		});
	}

	private renderGroupingRuleRow(options: {
		container: HTMLElement;
		label: string;
		description: string;
		fieldValue: string;
		orderValue: TableSortDirection;
		fieldPlaceholder: string;
		catalog: ReturnType<typeof buildTableTaskFieldCatalog>;
		excludedFieldKey: string | null;
		disabled: boolean;
		focusFieldKey: string;
		focusOrderKey: string;
		onFieldChange: (value: string) => void;
		onOrderChange: (value: TableSortDirection) => void;
	}): void {
		const row = options.container.createDiv('operon-table-preset-grouping-row');
		row.classList.toggle('is-disabled', options.disabled);
		const textWrap = row.createDiv('operon-table-preset-grouping-label-wrap');
		textWrap.createDiv({ cls: 'operon-table-preset-grouping-label', text: options.label });
		textWrap.createDiv({ cls: 'operon-table-preset-grouping-desc', text: options.description });
		this.createTableFieldPickerButton(row, {
			className: 'operon-table-preset-grouping-select',
			value: options.fieldValue,
			label: options.label,
			placeholder: options.fieldPlaceholder,
			catalog: options.catalog,
			excludedFieldKeys: options.excludedFieldKey ? new Set([options.excludedFieldKey]) : undefined,
			noneLabel: options.fieldPlaceholder,
			disabled: options.disabled,
			focusAttribute: 'data-operon-table-grouping-focus',
			focusKey: options.focusFieldKey,
			onFieldChange: options.onFieldChange,
		});

		const orderSelect = row.createEl('select', {
			cls: 'operon-table-preset-grouping-order',
			attr: {
				'data-operon-table-grouping-focus': options.focusOrderKey,
			},
		});
		setAccessibleLabelWithoutTooltip(orderSelect, t('table', 'groupOrder'));
		orderSelect.createEl('option', { value: 'asc', text: getTableSortDirectionLabel('asc', options.fieldValue) });
		orderSelect.createEl('option', { value: 'desc', text: getTableSortDirectionLabel('desc', options.fieldValue) });
		orderSelect.value = options.orderValue;
		orderSelect.disabled = options.disabled || !options.fieldValue;
		orderSelect.addEventListener('change', () => {
			options.onOrderChange(orderSelect.value === 'desc' ? 'desc' : 'asc');
		});
	}

	private renderColumnsSection(container: HTMLElement, preset: TablePreset, settings: OperonSettings): void {
		const card = this.createSection(container, t('table', 'presetSectionColumns'));
		const additionalFields = this.options.getAdditionalColumnFields?.(preset) ?? [];
		const catalog = applyTablePresetFieldAliases(
			buildEffectiveTableTaskFieldCatalog(
				settings,
				additionalFields,
				preset.columns.map(column => column.key),
			),
			preset.columns,
		);
		const supportedKeys = new Set(catalog.map(field => field.key));
		for (const column of preset.columns) {
			if (isTableFilePropertyColumnKey(column.key)) supportedKeys.add(column.key);
		}
		const columnPreset = filterTablePresetColumnsBySupportedKeys(preset, supportedKeys);
		const visibleColumns = columnPreset.columns.filter(column => !column.hidden);
		const visibleKeys = new Set(visibleColumns.map(column => column.key));
		const listEl = card.createDiv('operon-table-preset-column-list');

		for (const column of visibleColumns) {
			const row = listEl.createDiv('operon-table-preset-column-row');
			const iconEl = row.createSpan('operon-table-preset-column-icon');
			const field = catalog.find(entry => entry.key === column.key);
			setIcon(iconEl, field?.icon ?? 'columns-3');
			row.createSpan({
				cls: 'operon-table-preset-column-label',
				text: getTableColumnLabel(column, settings, additionalFields),
			});
			const canMoveUp = getTablePresetColumnMoveTargetKey(columnPreset, column.key, -1) !== null;
			const canMoveDown = getTablePresetColumnMoveTargetKey(columnPreset, column.key, 1) !== null;
			this.createColumnAction(row, 'arrow-up', t('table', 'moveColumnUp'), !canMoveUp, () => {
				this.updateColumns(moveTablePresetColumnByDelta(columnPreset, column.key, -1));
			});
			this.createColumnAction(row, 'arrow-down', t('table', 'moveColumnDown'), !canMoveDown, () => {
				this.updateColumns(moveTablePresetColumnByDelta(columnPreset, column.key, 1));
			});
			this.createColumnAction(row, 'x', t('table', 'removeColumn'), visibleColumns.length <= 1, () => {
				this.updateColumns(setTablePresetColumnVisible(columnPreset, column.key, false));
			});
		}

		const hiddenOptions = catalog.filter(field => !visibleKeys.has(field.key));
		new Setting(card)
			.setName(t('table', 'addColumn'))
			.addDropdown(dropdown => {
				dropdown.addOption('', t('table', 'addColumnPlaceholder'));
				for (const field of hiddenOptions) {
					dropdown.addOption(field.key, getFieldOptionLabel(field));
				}
				dropdown.setValue('');
				dropdown.onChange(value => {
					if (!value) return;
					this.updateColumns(setTablePresetColumnVisible(
						columnPreset,
						value,
						true,
						settings,
						catalog.find(field => field.key === value),
					));
				});
			});
	}

	private renderSortSection(container: HTMLElement, preset: TablePreset, settings: OperonSettings): void {
		const card = this.createSection(container, t('table', 'presetSectionSort'));
		const catalog = this.buildGroupSortCatalog(preset, settings);
		const supportedKeys = new Set(catalog.map(field => field.key));
		const normalizedPreset = filterTablePresetSortRulesBySupportedKeys(preset, supportedKeys);
		const sortRules = normalizedPreset.sortRules;
		const listEl = card.createDiv('operon-table-preset-sort-list');

		if (sortRules.length === 0) {
			listEl.createDiv({ cls: 'operon-table-preset-sort-empty', text: t('table', 'sortEmptyState') });
		}

		for (const [index, rule] of sortRules.entries()) {
			const row = listEl.createDiv('operon-table-preset-sort-row');
			row.createSpan({ cls: 'operon-table-preset-sort-label', text: t('table', 'sortBy') });
			const usedByOtherRules = new Set(sortRules
				.filter((_, entryIndex) => entryIndex !== index)
				.map(entry => entry.key));
			this.createTableFieldPickerButton(row, {
				className: 'operon-table-preset-sort-select',
				value: rule.key,
				label: t('table', 'sortBy'),
				placeholder: t('table', 'fieldPlaceholder'),
				catalog,
				excludedFieldKeys: usedByOtherRules,
				focusAttribute: 'data-operon-table-preset-sort-focus',
				focusKey: `sort-field-${index}`,
				onFieldChange: value => {
					this.updateSortRules(preset, sortRules.map((entry, entryIndex) => entryIndex === index
						? { ...entry, key: value }
						: entry), `sort-field-${index}`);
				},
			});

			const directionLabel = getTableSortDirectionLabel(rule.direction, rule.key);
			const directionButton = row.createEl('button', {
				cls: 'operon-table-preset-sort-toggle',
				text: directionLabel,
				attr: {
					type: 'button',
					'data-operon-table-preset-sort-focus': `sort-direction-${index}`,
				},
			});
			const fieldLabel = getTableFieldPickerLabel(catalog, rule.key, rule.key);
			setAccessibleLabelWithoutTooltip(
				directionButton,
				`${t('table', 'sortBy')}: ${fieldLabel}, ${directionLabel}`,
			);
			directionButton.addEventListener('click', event => {
				event.preventDefault();
				this.updateSortRules(preset, sortRules.map((entry, entryIndex) => entryIndex === index
					? { ...entry, direction: entry.direction === 'asc' ? 'desc' : 'asc' }
					: entry), `sort-direction-${index}`);
			});

			const emptyButton = row.createEl('button', {
				cls: 'operon-table-preset-sort-toggle',
				text: rule.empty === 'first' ? t('table', 'sortEmptyFirst') : t('table', 'sortEmptyLast'),
				attr: {
					type: 'button',
					'data-operon-table-preset-sort-focus': `sort-empty-${index}`,
				},
			});
			setAccessibleLabelWithoutTooltip(emptyButton, rule.empty === 'first' ? t('table', 'sortEmptyFirst') : t('table', 'sortEmptyLast'));
			emptyButton.addEventListener('click', event => {
				event.preventDefault();
				this.updateSortRules(preset, sortRules.map((entry, entryIndex) => entryIndex === index
					? { ...entry, empty: entry.empty === 'last' ? 'first' : 'last' }
					: entry), `sort-empty-${index}`);
			});

			this.createColumnAction(row, 'arrow-up', t('table', 'moveSortUp'), index === 0, () => {
				const nextRules = [...sortRules];
				const [moved] = nextRules.splice(index, 1);
				if (!moved) return;
				nextRules.splice(index - 1, 0, moved);
				this.updateSortRules(preset, nextRules, `sort-field-${Math.max(0, index - 1)}`);
			}, `sort-up-${index}`);
			this.createColumnAction(row, 'arrow-down', t('table', 'moveSortDown'), index >= sortRules.length - 1, () => {
				const nextRules = [...sortRules];
				const [moved] = nextRules.splice(index, 1);
				if (!moved) return;
				nextRules.splice(index + 1, 0, moved);
				this.updateSortRules(preset, nextRules, `sort-field-${index + 1}`);
			}, `sort-down-${index}`);
			this.createColumnAction(row, 'x', t('table', 'removeSort'), false, () => {
				const nextFocusIndex = Math.max(0, Math.min(index, sortRules.length - 2));
				this.updateSortRules(
					preset,
					sortRules.filter((_, entryIndex) => entryIndex !== index),
					sortRules.length > 1 ? `sort-field-${nextFocusIndex}` : 'sort-add',
				);
			}, `sort-remove-${index}`);
		}

		const usedSortKeys = new Set(sortRules.map(rule => rule.key));
		const nextField = catalog.find(field => !field.unavailable && !usedSortKeys.has(field.key)) ?? null;
		const addRow = card.createDiv('operon-table-preset-sort-add-row');
		const addButton = addRow.createEl('button', {
			text: t('table', 'addSort'),
			attr: {
				type: 'button',
				'data-operon-table-preset-sort-focus': 'sort-add',
			},
		});
		addButton.disabled = !nextField;
		addButton.addEventListener('click', event => {
			event.preventDefault();
			if (!nextField) return;
			this.updateSortRules(preset, [...sortRules, { key: nextField.key, direction: 'asc', empty: 'last' }], `sort-field-${sortRules.length}`);
		});
	}

	private createTableFieldPickerButton(
		container: HTMLElement,
		options: {
			className: string;
			value: string;
			label: string;
			placeholder: string;
			catalog: ReturnType<typeof buildTableTaskFieldCatalog>;
			excludedFieldKeys?: ReadonlySet<string>;
			noneLabel?: string;
			disabled?: boolean;
			focusAttribute: string;
			focusKey: string;
			onFieldChange: (value: string) => void;
		},
	): void {
		const button = container.createEl('button', {
			cls: `${options.className} operon-field-picker-trigger operon-table-field-picker-trigger`,
			attr: {
				type: 'button',
				'aria-haspopup': 'listbox',
				'aria-expanded': 'false',
			},
		});
		button.setAttribute(options.focusAttribute, options.focusKey);
		button.disabled = options.disabled === true;
		const label = getTableFieldPickerLabel(options.catalog, options.value, options.placeholder);
		button.createSpan({ cls: 'operon-field-picker-trigger-label', text: label });
		const selectedField = options.catalog.find(field => field.key === options.value);
		const secondaryLabel = selectedField?.unavailable
			? t('table', 'fieldUnavailableInCurrentScope')
			: selectedField?.sourceLabel && selectedField.sourceLabel !== selectedField.label
				? selectedField.sourceLabel
				: null;
		setAccessibleLabelWithoutTooltip(
			button,
			`${options.label}: ${label}${secondaryLabel ? `, ${secondaryLabel}` : ''}`,
		);
		if (selectedField?.unavailable) {
			button.createSpan({
				cls: 'operon-field-picker-trigger-secondary',
				text: t('table', 'fieldUnavailableInCurrentScope'),
			});
		} else if (selectedField?.sourceLabel && selectedField.sourceLabel !== selectedField.label) {
			button.createSpan({ cls: 'operon-field-picker-trigger-secondary', text: selectedField.sourceLabel });
		}
		const iconEl = button.createSpan('operon-field-picker-trigger-icon');
		setIcon(iconEl, 'chevron-down');
		button.addEventListener('click', event => {
			event.preventDefault();
			if (button.disabled) return;
			button.setAttribute('aria-expanded', 'true');
			showSearchableFieldPicker(button, {
				value: options.value,
				fields: buildTableFieldPickerOptions(
					options.catalog.filter(field => !field.unavailable || field.key === options.value), {
					excludedFieldKeys: options.excludedFieldKeys,
					noneLabel: options.noneLabel,
				}),
				placeholder: t('table', 'fieldPickerSearchPlaceholder'),
				ariaLabel: options.label,
				noMatchesText: t('table', 'fieldPickerNoMatches'),
				onSelect: option => options.onFieldChange(option.field),
				onClose: () => {
					if (button.isConnected) button.setAttribute('aria-expanded', 'false');
				},
				variantClassName: 'operon-table-field-picker',
				getSearchText: option => [
					option.label,
					option.field,
					option.type,
					option.tableField?.sourceLabel,
					...(option.tableField?.aliases ?? []),
				].filter(Boolean).join(' '),
				matchWidth: Math.max(button.getBoundingClientRect().width, 280),
				repositionOnScroll: true,
				repositionOnWindowResize: true,
			});
		});
	}

	private renderSummariesSection(container: HTMLElement, preset: TablePreset, settings: OperonSettings): void {
		const card = this.createSection(container, t('table', 'presetSectionSummaries'));
		const additionalFields = this.options.getAdditionalColumnFields?.(preset) ?? [];
		const presetColumnKeys = new Set(preset.columns.map(column => column.key));
		const catalog = applyTablePresetFieldAliases(
			buildEffectiveTableTaskFieldCatalog(
				settings,
				additionalFields.filter(field => field.group !== 'fileProperty' || presetColumnKeys.has(field.key)),
				preset.summaries.map(rule => rule.key),
			),
			preset.columns,
		);
		const summaryRules = retainTableSummaryRules(preset.summaries, settings);
		const listEl = card.createDiv('operon-table-preset-summary-list');

		if (summaryRules.length === 0) {
			listEl.createDiv({ cls: 'operon-table-preset-summary-empty', text: t('table', 'summaryEmptyState') });
		}

		for (const [index, rule] of summaryRules.entries()) {
			const row = listEl.createDiv('operon-table-preset-summary-row');
			row.createSpan({ cls: 'operon-table-preset-summary-label', text: t('table', 'summarize') });
			const usedByOtherRules = new Set(summaryRules
				.filter((_, entryIndex) => entryIndex !== index)
				.map(entry => entry.key));
			const fieldSelect = row.createEl('select', {
				cls: 'operon-table-preset-summary-select',
			});
			setAccessibleLabelWithoutTooltip(fieldSelect, t('table', 'summaryFieldSelectAria'));
			for (const field of catalog) {
				if (usedByOtherRules.has(field.key)) continue;
				const option = fieldSelect.createEl('option', { value: field.key, text: getFieldOptionLabel(field) });
				option.disabled = field.unavailable === true && field.key !== rule.key;
			}
			fieldSelect.value = rule.key;
			fieldSelect.addEventListener('change', () => {
				const nextFunction = resolveCompatibleSummaryFunction(fieldSelect.value, rule.function, settings, additionalFields);
				this.updateSummaries(summaryRules.map((entry, entryIndex) => entryIndex === index
					? { key: fieldSelect.value, function: nextFunction }
					: entry));
			});

			const functionSelect = row.createEl('select', {
				cls: 'operon-table-preset-summary-select',
			});
			setAccessibleLabelWithoutTooltip(functionSelect, t('table', 'summaryFunctionSelectAria'));
			const compatibleFunctions = getTableSummaryFunctionsForField(rule.key, settings, additionalFields);
			const ruleUnavailable = compatibleFunctions.length === 0 || !compatibleFunctions.includes(rule.function);
			for (const summaryFunction of ruleUnavailable ? [rule.function] : compatibleFunctions) {
				functionSelect.createEl('option', {
					value: summaryFunction,
					text: getTableSummaryFunctionLabel(summaryFunction),
				});
			}
			functionSelect.value = rule.function;
			functionSelect.disabled = ruleUnavailable;
			if (ruleUnavailable) {
				row.createSpan({
					cls: 'operon-table-preset-summary-unavailable',
					text: t('table', 'fieldUnavailableInCurrentScope'),
				});
			}
			functionSelect.addEventListener('change', () => {
				this.updateSummaries(summaryRules.map((entry, entryIndex) => entryIndex === index
					? { ...entry, function: functionSelect.value as TableSummaryFunction }
					: entry));
			});

			this.createColumnAction(row, 'x', t('table', 'removeSummary'), false, () => {
				this.updateSummaries(summaryRules.filter((_, entryIndex) => entryIndex !== index));
			});
		}

		const usedSummaryKeys = new Set(summaryRules.map(rule => rule.key));
		const nextField = catalog.find(field => !field.unavailable
			&& !usedSummaryKeys.has(field.key)
			&& getTableSummaryFunctionsForField(field.key, settings, additionalFields).length > 0) ?? null;
		const actionRow = card.createDiv('operon-table-preset-summary-add-row');
		const addButton = actionRow.createEl('button', {
			text: t('table', 'addSummary'),
			attr: { type: 'button' },
		});
		addButton.disabled = !nextField;
		addButton.addEventListener('click', event => {
			event.preventDefault();
			if (!nextField) return;
			const summaryFunction = getTableSummaryFunctionsForField(nextField.key, settings, additionalFields)[0];
			if (!summaryFunction) return;
			this.updateSummaries([...summaryRules, { key: nextField.key, function: summaryFunction }]);
		});
		const clearButton = actionRow.createEl('button', {
			text: t('table', 'clearAllSummaries'),
			attr: { type: 'button' },
		});
		clearButton.disabled = summaryRules.length === 0;
		clearButton.addEventListener('click', event => {
			event.preventDefault();
			this.updateSummaries([]);
		});
	}

	private renderDisplaySection(container: HTMLElement, preset: TablePreset): void {
		const card = this.createSection(container, t('table', 'presetSectionDisplay'));
		new Setting(card)
			.setName(t('table', 'density'))
			.addDropdown(dropdown => {
				dropdown.addOption('compact', t('table', 'densityCompact'));
				dropdown.addOption('comfortable', t('table', 'densityComfortable'));
				dropdown.setValue(preset.display.density);
				dropdown.onChange(value => {
					preset.display.density = value === 'comfortable' ? 'comfortable' : 'compact';
					this.markDirty('display');
				});
			});
	}

	private renderButtons(container: HTMLElement, preset: TablePreset): void {
		const settings = this.options.getSettings();
		const isStoredPreset = settings.tablePresets.some(entry => entry.id === preset.id);
		const isFavorite = isPresetFavorite(settings.presetFavorites, 'table', preset.id);
		const buttons = container.createDiv('operon-table-preset-settings-buttons');
		const fullManagement = this.options.managementMode !== 'current-only';
		const dangerButtons = fullManagement
			? buttons.createDiv('operon-table-preset-settings-danger-actions')
			: null;
		const managementButtons = buttons.createDiv('operon-table-preset-settings-management-actions');
		const primaryButtons = buttons.createDiv('operon-table-preset-settings-primary-actions');

		if (dangerButtons) {
			const deleteButton = dangerButtons.createEl('button', {
				cls: 'operon-table-preset-settings-footer-button mod-warning',
				text: t('table', 'deletePreset'),
				attr: { type: 'button' },
			});
			deleteButton.disabled = settings.tablePresets.length <= 1 || !this.options.onDelete;
			deleteButton.addEventListener('click', () => {
				const onDelete = this.options.onDelete;
				if (!onDelete) return;
				void this.runAndClose(() => onDelete(preset.id));
			});
		}

		if (fullManagement) {
			this.createFooterIconButton(managementButtons, {
					label: t('table', 'newPreset'),
				icon: 'plus',
				onClick: () => {
					const next = this.sanitizePresetForSave(createTablePresetFromSource(null, this.buildPresetName(t('table', 'newPresetName'))));
					void this.runAndClose(() => this.options.onCreate(next));
				},
				});

			this.createFooterIconButton(managementButtons, {
				label: t('table', 'duplicatePreset'),
				icon: 'copy',
				onClick: () => {
					const next = this.sanitizePresetForSave(createTablePresetFromSource(preset, this.buildPresetName(t('table', 'duplicatePresetName', { name: preset.name }))));
					void this.runAndClose(() => this.options.onDuplicate(next));
				},
			});
		}

		this.createFooterIconButton(managementButtons, {
			label: t('table', 'copyEmbedCode'),
			text: '</>',
			monospace: true,
			disabled: !settings.tablePresets.some(entry => entry.id === preset.id),
			onClick: () => {
				void this.copyEmbedCode(preset);
			},
		});

		createPresetFavoriteButton({
			containerEl: managementButtons,
			className: 'operon-table-preset-settings-footer-button operon-table-preset-settings-icon-button',
			active: isFavorite,
			disabled: !isStoredPreset,
			onClick: () => {
				void this.runAction(async () => {
					await this.options.onToggleFavorite(preset.id);
					this.renderPreservingScroll();
				});
			},
		});

		const saveButton = primaryButtons.createEl('button', {
			cls: 'operon-table-preset-settings-footer-button mod-cta',
			text: t('table', 'savePreset'),
			attr: { type: 'button' },
		});
		saveButton.addEventListener('click', () => {
			void this.savePreset(preset);
		});
	}

	private createFooterIconButton(
		container: HTMLElement,
		options: {
			label: string;
			icon?: string;
			text?: string;
			monospace?: boolean;
			danger?: boolean;
			className?: string;
			active?: boolean;
			disabled?: boolean;
			onClick: () => void;
		},
	): HTMLButtonElement {
		const button = container.createEl('button', {
			cls: `operon-table-preset-settings-footer-button operon-table-preset-settings-icon-button ${options.className ?? ''}`.trim(),
			attr: { type: 'button' },
		});
		setAccessibleLabelWithoutTooltip(button, options.label);
		if (options.danger) button.addClass('mod-warning');
		if (options.active) button.addClass('is-active');
		if (typeof options.active === 'boolean') {
			button.setAttribute('aria-pressed', String(options.active));
		}
		if (options.monospace) button.addClass('is-monospace');
		if (options.icon) {
			setIcon(button, options.icon);
		} else {
			button.setText(options.text ?? options.label);
		}
		button.disabled = options.disabled === true;
		bindOperonHoverTooltip(button, { content: options.label, taskColor: null });
		button.addEventListener('click', event => {
			event.preventDefault();
			if (button.disabled) return;
			options.onClick();
		});
		return button;
	}

	private createSection(container: HTMLElement, title: string): HTMLElement {
		const section = container.createDiv('operon-table-preset-settings-section');
		section.createEl('h4', {
			cls: 'operon-table-preset-settings-section-title',
			text: title,
		});
		return section.createDiv('operon-table-preset-settings-card');
	}

	private renderPreservingScroll(): void {
		const scrollTop = this.contentEl.scrollTop;
		const scrollLeft = this.contentEl.scrollLeft;
		this.render();
		this.restoreContentScroll(scrollTop, scrollLeft);
	}

	private restoreContentScroll(scrollTop: number, scrollLeft: number): void {
		const scrollHost = this.contentEl;
		const restore = (): void => {
			const maxScrollTop = Math.max(0, scrollHost.scrollHeight - scrollHost.clientHeight);
			const maxScrollLeft = Math.max(0, scrollHost.scrollWidth - scrollHost.clientWidth);
			scrollHost.scrollTop = Math.min(scrollTop, maxScrollTop);
			scrollHost.scrollLeft = Math.min(scrollLeft, maxScrollLeft);
		};
		restore();
		scrollHost.ownerDocument.defaultView?.requestAnimationFrame(restore);
	}

	private createColumnAction(
		row: HTMLElement,
		icon: string,
		label: string,
		disabled: boolean,
		onClick: () => void,
		focusKey?: string,
	): void {
		const button = row.createEl('button', {
			cls: 'operon-table-preset-column-action',
			attr: { type: 'button' },
		});
		setAccessibleLabelWithoutTooltip(button, label);
		if (focusKey) button.dataset.operonTablePresetSortFocus = focusKey;
		setIcon(button, icon);
		button.disabled = disabled;
		button.addEventListener('click', event => {
			event.preventDefault();
			onClick();
		});
	}

	private updateColumns(updatedPreset: TablePreset): void {
		if (!this.draftPreset) return;
		this.draftPreset.columns = updatedPreset.columns;
		this.markDirty('columns');
		this.renderPreservingScroll();
	}

	private updateSortRules(preset: TablePreset, sortRules: readonly TableSortRule[], focusKey?: string): void {
		if (!this.draftPreset) return;
		const supportedKeys = new Set(this.buildGroupSortCatalog(preset, this.options.getSettings()).map(field => field.key));
		this.draftPreset.sortRules = replaceTablePresetSortRules(preset, sortRules, supportedKeys).sortRules;
		this.markDirty('sortRules');
		this.renderPreservingScroll();
		if (!focusKey) return;
		this.contentEl.ownerDocument.defaultView?.requestAnimationFrame(() => {
			const requestedFocusTarget = this.contentEl.querySelector<HTMLElement>(`[data-operon-table-preset-sort-focus="${focusKey}"]`);
			const focusTarget = requestedFocusTarget
				?? this.contentEl.querySelector<HTMLElement>('.operon-table-preset-sort-select')
				?? this.contentEl.querySelector<HTMLElement>('[data-operon-table-preset-sort-focus="sort-add"]');
			focusTarget?.focus({ preventScroll: true });
		});
	}

	private updateSummaries(summaries: readonly TableSummaryRule[]): void {
		if (!this.draftPreset) return;
		this.draftPreset.summaries = retainTableSummaryRules(
			summaries,
			this.options.getSettings(),
		);
		this.markDirty('summaries');
		this.renderPreservingScroll();
	}

	private updateGrouping(updatedPreset: TablePreset, focusKey?: string): void {
		if (!this.draftPreset) return;
		this.draftPreset.groupBy = updatedPreset.groupBy;
		this.draftPreset.groupOrder = updatedPreset.groupOrder;
		this.draftPreset.subgroupBy = updatedPreset.subgroupBy;
		this.draftPreset.subgroupOrder = updatedPreset.subgroupOrder;
		this.markDirty('grouping');
		this.renderPreservingScroll();
		if (!focusKey) return;
		this.contentEl.ownerDocument.defaultView?.requestAnimationFrame(() => {
			this.contentEl.querySelector<HTMLElement>(`[data-operon-table-grouping-focus="${focusKey}"]`)?.focus({ preventScroll: true });
		});
	}

	private markDirty(field: TablePresetDirtyField): void {
		this.dirtyFields.add(field);
	}

	private buildGroupSortCatalog(preset: TablePreset, settings: OperonSettings): TableTaskField[] {
		const preservedKeys = [
			preset.groupBy,
			preset.subgroupBy,
			...preset.sortRules.map(rule => rule.key),
		].filter((key): key is string => !!key?.trim());
		return applyTablePresetFieldAliases(
			buildTableGroupSortFieldCatalog(
				settings,
				this.options.getAdditionalColumnFields?.(preset) ?? [],
				preservedKeys,
			),
			preset.columns,
		);
	}

	private buildDirtyPatch(preset: TablePreset): TablePresetPatch {
		return buildTablePresetDirtyPatch(preset, this.dirtyFields, this.options.preset);
	}

	private hasDirtyPatch(patch: TablePresetPatch): boolean {
		return Object.keys(patch).length > 1;
	}

	private buildPresetName(fallback: string): string {
		const existing = new Set(this.options.getSettings().tablePresets.map(preset => preset.name.trim().toLocaleLowerCase()));
		let candidate = fallback.trim() || t('table', 'newPresetName');
		let counter = 2;
		while (existing.has(candidate.toLocaleLowerCase())) {
			candidate = `${fallback} ${counter}`;
			counter++;
		}
		return candidate;
	}

	private async savePreset(preset: TablePreset): Promise<void> {
		if (!preset.name.trim()) {
			new Notice(t('table', 'presetNameRequired'));
			return;
		}
		const sanitized = this.sanitizePresetForSave({
			...preset,
			name: preset.name.trim(),
		});
		const patch = this.buildDirtyPatch(sanitized);
		if (!this.hasDirtyPatch(patch) && this.options.saveWhenClean !== true) {
			this.close();
			return;
		}
		await this.runAndClose(() => this.options.onSave(patch, sanitized));
	}

	private async copyEmbedCode(preset: TablePreset): Promise<void> {
		try {
			const code = '```operon-table\npresetId: "' + preset.id + '"\n```';
			await navigator.clipboard.writeText(code);
			new Notice(t('table', 'embedCodeCopied'));
		} catch (error) {
			console.error('Operon: table preset embed copy failed', error);
			new Notice(t('table', 'presetActionFailed'));
		}
	}

	private async runAndClose(action: () => Promise<void>): Promise<void> {
		const succeeded = await this.runAction(action);
		if (succeeded) {
			this.close();
		}
	}

	private async runAction(action: () => Promise<void>): Promise<boolean> {
		try {
			await action();
			return true;
		} catch (error) {
			console.error('Operon: table preset action failed', error);
			new Notice(t('table', 'presetActionFailed'));
			return false;
		}
	}

	private sanitizePresetForSave(preset: TablePreset): TablePreset {
		const settings = this.options.getSettings();
		const columnSupportedKeys = new Set(buildEffectiveTableTaskFieldCatalog(
			settings,
			this.options.getAdditionalColumnFields?.(preset) ?? [],
		).map(field => field.key));
		for (const column of preset.columns) {
			if (isTableFilePropertyColumnKey(column.key)) columnSupportedKeys.add(column.key);
		}
		const groupSortSupportedKeys = new Set(this.buildGroupSortCatalog(preset, settings).map(field => field.key));
		const sanitized = filterTablePresetSortRulesBySupportedKeys(
			filterTablePresetGroupByBySupportedKeys(
				filterTablePresetColumnsBySupportedKeys(normalizeTablePresetForColumnUi(cloneTablePreset(preset)), columnSupportedKeys),
				groupSortSupportedKeys,
			),
			groupSortSupportedKeys,
		);
		sanitized.summaries = retainTableSummaryRules(sanitized.summaries, settings);
		return sanitized;
	}
}

function resolveCompatibleSummaryFunction(
	key: string,
	currentFunction: TableSummaryFunction,
	settings: OperonSettings,
	additionalFields: readonly TableTaskField[] = [],
): TableSummaryFunction {
	const functions = getTableSummaryFunctionsForField(key, settings, additionalFields);
	return functions.includes(currentFunction) ? currentFunction : functions[0] ?? 'Count';
}

function retainTableSummaryRules(
	rules: readonly TableSummaryRule[],
	settings: OperonSettings,
): TableSummaryRule[] {
	const retained: TableSummaryRule[] = [];
	const seen = new Set<string>();
	for (const rule of rules) {
		const key = rule.key.trim();
		if (!key || seen.has(key)) continue;
		if (isTableFilePropertyColumnKey(key)) {
			seen.add(key);
			retained.push({ key, function: rule.function });
			continue;
		}
		const compatible = filterCompatibleTableSummaryRules([rule], settings)[0];
		if (!compatible) continue;
		if (seen.has(compatible.key)) continue;
		seen.add(compatible.key);
		retained.push(compatible);
	}
	return retained;
}

function getFieldOptionLabel(field: TableTaskField): string {
	if (field.unavailable) return `${field.label} — ${t('table', 'fieldUnavailableInCurrentScope')}`;
	if (field.sourceLabel && field.sourceLabel !== field.label) return `${field.label} — ${field.sourceLabel}`;
	return field.label;
}

function getTableSummaryFunctionLabel(summaryFunction: TableSummaryFunction): string {
	return t('table', `summary${summaryFunction}`);
}

function getTableSortDirectionLabel(direction: TableSortDirection, fieldKey: string | null): string {
	if (fieldKey === 'status' || fieldKey === TABLE_WORKFLOW_PIPELINE_FIELD_KEY) {
		return direction === 'desc'
			? t('table', 'sortDirectionWorkflowReverse')
			: t('table', 'sortDirectionWorkflow');
	}
	return direction === 'desc' ? t('table', 'sortDirectionZA') : t('table', 'sortDirectionAZ');
}
