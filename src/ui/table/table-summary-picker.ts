import { setIcon } from 'obsidian';
import type { IndexedTask } from '../../types/fields';
import type { OperonSettings } from '../../types/settings';
import type { TableSummaryFunction } from '../../types/table';
import { t } from '../../core/i18n';
import { setAccessibleLabelWithoutTooltip } from '../accessibility-label';
import { createFloatingPanel, requestFloatingInputFocus, type FloatingHostOptions } from '../field-pickers/common';
import { getEffectiveTableTaskField, getTableTaskFieldLabel, type TableTaskField } from './table-field-catalog';
import {
	createTableSummaryPickerValueCache,
	getTablePresetSummaryFunction,
	getTableSummaryFunctionGroup,
	getTableSummaryFunctionsForField,
	type TableSummaryCell,
	type TableSummaryValueResolver,
} from './table-summary';

type TableSummaryPickerSettings = Pick<OperonSettings, 'keyMappings' | 'pipelines'>;

// Budget per evaluation slice: enough for every function on typical vaults in the
// first synchronous pass, short enough to keep huge vaults responsive via chunking.
const TABLE_SUMMARY_PICKER_EVAL_BUDGET_MS = 8;

export interface TableSummaryPickerOptions extends FloatingHostOptions {
	anchor: HTMLElement;
	fieldKey: string;
	rows: readonly IndexedTask[];
	allTasks: readonly IndexedTask[];
	settings: TableSummaryPickerSettings;
	additionalFields?: readonly TableTaskField[];
	valueResolver?: TableSummaryValueResolver;
	currentFunction: TableSummaryFunction | null;
	onSelect: (summaryFunction: TableSummaryFunction) => void;
	onClear: () => void;
	onClose?: () => void;
}

export function showTableSummaryPicker(options: TableSummaryPickerOptions): () => void {
	const additionalFields = options.additionalFields ?? [];
	const functions = getTableSummaryFunctionsForField(options.fieldKey, options.settings, additionalFields);
	if (functions.length === 0) {
		options.onClose?.();
		return () => undefined;
	}
	const fieldLabel = getEffectiveTableTaskField(options.fieldKey, options.settings, additionalFields)?.label
		?? getTableTaskFieldLabel(options.fieldKey, options.settings);
	const valueCache = createTableSummaryPickerValueCache({
		fieldKey: options.fieldKey,
		functions,
		rows: options.rows,
		allTasks: options.allTasks,
		settings: options.settings,
		...(options.valueResolver ? { valueResolver: options.valueResolver } : {}),
	});
	const ownerWindow = options.anchor.ownerDocument.defaultView ?? window;
	let evaluateTimer: number | null = null;
	const cancelPendingEvaluation = (): void => {
		if (evaluateTimer !== null) {
			ownerWindow.clearTimeout(evaluateTimer);
			evaluateTimer = null;
		}
	};
	const { panel, close } = createFloatingPanel(
		options.anchor,
		'operon-floating-panel operon-table-summary-picker-panel',
		() => {
			cancelPendingEvaluation();
			options.onClose?.();
		},
		{
			focusInputSelector: '.operon-table-summary-picker-input',
			floatingHost: options.floatingHost,
			floatingScrollHost: options.floatingScrollHost,
			constrainToFloatingHost: options.constrainToFloatingHost,
			repositionOnScroll: true,
			repositionOnWindowResize: true,
		},
	);
	setAccessibleLabelWithoutTooltip(panel, t('table', 'summaryPickerAria', { field: fieldLabel }));

	const searchWrap = panel.createDiv('operon-table-summary-picker-search');
	const searchIcon = searchWrap.createSpan('operon-table-summary-picker-search-icon');
	setIcon(searchIcon, 'search');
	const input = searchWrap.createEl('input', {
		cls: 'operon-floating-input operon-table-summary-picker-input',
		attr: {
			type: 'search',
			placeholder: t('table', 'summaryPickerPlaceholder'),
			autocomplete: 'off',
		},
	});
	const list = panel.createDiv('operon-table-summary-picker-list');
	// Filter keystrokes re-render rows from the memoized values only; aggregation work
	// happens once per function inside budgeted slices below.
	const valueSpans = new Map<TableSummaryFunction, HTMLElement>();
	const renderList = (): void => {
		const query = input.value.trim().toLocaleLowerCase();
		list.empty();
		valueSpans.clear();
		for (const summaryFunction of functions) {
			const label = getSummaryPickerFunctionLabel(summaryFunction);
			if (query && !label.toLocaleLowerCase().includes(query)) continue;
			const valueSpan = renderSummaryFunctionRow(
				list,
				summaryFunction,
				label,
				formatSummaryPickerValue(valueCache.get(summaryFunction)),
				options,
				close,
			);
			valueSpans.set(summaryFunction, valueSpan);
		}
		if (list.childElementCount === 0) {
			list.createDiv({ cls: 'operon-table-summary-picker-empty', text: t('table', 'summaryPickerNoMatches') });
		}
	};
	const evaluateChunk = (): void => {
		evaluateTimer = null;
		if (!panel.isConnected) return;
		for (const summaryFunction of valueCache.evaluatePending(TABLE_SUMMARY_PICKER_EVAL_BUDGET_MS)) {
			const valueSpan = valueSpans.get(summaryFunction);
			if (valueSpan?.isConnected) {
				valueSpan.textContent = formatSummaryPickerValue(valueCache.get(summaryFunction));
			}
		}
		if (valueCache.hasPending()) {
			evaluateTimer = ownerWindow.setTimeout(evaluateChunk, 0);
		}
	};
	input.addEventListener('input', renderList);
	valueCache.evaluatePending(TABLE_SUMMARY_PICKER_EVAL_BUDGET_MS);
	renderList();
	if (valueCache.hasPending()) {
		evaluateTimer = ownerWindow.setTimeout(evaluateChunk, 0);
	}

	const actions = panel.createDiv('operon-table-summary-picker-actions');
	if (options.currentFunction) {
		const hideButton = actions.createEl('button', {
			cls: 'operon-table-summary-picker-action',
			attr: { type: 'button' },
		});
		setIcon(hideButton.createSpan('operon-table-summary-picker-action-icon'), 'trash-2');
		hideButton.createSpan({ text: t('table', 'summaryPickerHide') });
		hideButton.addEventListener('click', event => {
			event.preventDefault();
			options.onClear();
			close();
		});
	} else {
		const addButton = actions.createEl('button', {
			cls: 'operon-table-summary-picker-action',
			attr: { type: 'button' },
		});
		setIcon(addButton.createSpan('operon-table-summary-picker-action-icon'), 'plus');
		addButton.createSpan({ text: t('table', 'summaryPickerAdd') });
		addButton.addEventListener('click', event => {
			event.preventDefault();
			const defaultFunction = getTablePresetSummaryFunction({ key: options.fieldKey, kind: 'task' }, options.settings)
				?? functions[0];
			if (!defaultFunction) return;
			options.onSelect(defaultFunction);
			close();
		});
	}

	requestFloatingInputFocus(input);
	return close;
}

function formatSummaryPickerValue(cell: TableSummaryCell | null | undefined): string {
	if (cell === undefined) return '…';
	return cell?.value.trim() || '--';
}

function renderSummaryFunctionRow(
	list: HTMLElement,
	summaryFunction: TableSummaryFunction,
	label: string,
	valueText: string,
	options: TableSummaryPickerOptions,
	close: () => void,
): HTMLElement {
	const row = list.createEl('button', {
		cls: 'operon-table-summary-picker-row',
		attr: { type: 'button' },
	});
	if (summaryFunction === options.currentFunction) {
		row.addClass('is-active');
	}
	const icon = row.createSpan('operon-table-summary-picker-row-icon');
	setIcon(icon, getSummaryPickerIcon(summaryFunction));
	row.createSpan({ cls: 'operon-table-summary-picker-row-label', text: label });
	const valueSpan = row.createSpan({
		cls: 'operon-table-summary-picker-row-value',
		text: valueText,
	});
	const chevron = row.createSpan('operon-table-summary-picker-row-chevron');
	setIcon(chevron, summaryFunction === options.currentFunction ? 'check' : 'chevron-right');
	row.addEventListener('click', event => {
		event.preventDefault();
		options.onSelect(summaryFunction);
		close();
	});
	return valueSpan;
}

function getSummaryPickerFunctionLabel(summaryFunction: TableSummaryFunction): string {
	return t('table', `summary${summaryFunction}`);
}

function getSummaryPickerIcon(summaryFunction: TableSummaryFunction): string {
	const group = getTableSummaryFunctionGroup(summaryFunction);
	if (group === 'basic') return 'binary';
	if (group === 'task-state') return 'circle-check';
	if (group === 'distribution') return 'list-filter';
	return 'sigma';
}
