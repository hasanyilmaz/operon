import { App, Menu, Notice, setIcon } from 'obsidian';
import type { IndexedTask } from '../../types/fields';
import type { OperonSettings } from '../../types/settings';
import type { TableColumn } from '../../types/table';
import type { WorkflowStatusIdentityIndex } from '../../core/workflow-status-identity';
import { t } from '../../core/i18n';
import {
	isSupportedRawYamlPropertyValue,
	type RawYamlPropertyExpectation,
	type RawYamlPropertyMutation,
} from '../../core/raw-yaml-property';
import { setAccessibleLabelWithoutTooltip } from '../accessibility-label';
import {
	showCustomDateFieldPicker,
	showCustomDatetimeFieldPicker,
	showCustomListFieldPicker,
	showCustomNumberFieldPicker,
	showCustomTextFieldPicker,
} from '../field-pickers/custom';
import type { TableFilePropertyCellValue, TableFilePropertyField } from './table-file-property';
import {
	applyTableColumnCellAccent,
	decorateTableListValueChip,
	formatTableCellListChipDisplayValue,
	formatTableListIconOnlyTooltipContent,
} from './table-cell-chip';
import { resolveTableColumnCellAccent } from './table-column-color';
import { renderTableTextValueDisplay } from './table-description-cell';
import { formatTableIconOnlyTooltipContent, renderTableIconOnlyCell } from './table-icon-only-cell';
import { createCompactTaskMarkdownTooltipContent } from '../operon-hover-tooltip';
import { showTextFieldPopover } from '../text-field-popover';
import { buildTableFilePropertyTextMutation, resolveTableTextEditRoute } from './table-text-edit-route';

export interface TableFilePropertyUpdateRequest {
	propertyName: string;
	expected: RawYamlPropertyExpectation;
	mutation: RawYamlPropertyMutation;
}

export type TableFilePropertyUpdateResult = 'updated' | 'already-updated' | 'conflict' | 'missing' | 'unsupported';

export function toRawYamlPropertyExpectation(cellValue: TableFilePropertyCellValue): RawYamlPropertyExpectation | null {
	if (!cellValue.present) return { present: false, value: undefined };
	return isSupportedRawYamlPropertyValue(cellValue.rawValue)
		? { present: true, value: cellValue.rawValue }
		: null;
}

export function canEditTableFilePropertyCell(
	task: IndexedTask,
	field: TableFilePropertyField | null,
	cellValue: TableFilePropertyCellValue,
	canWrite: boolean,
): boolean {
	if (!canWrite || task.primary.format !== 'yaml' || !field || field.readonly) return false;
	if (!cellValue.present || cellValue.rawValue === null || cellValue.rawValue === '') return true;
	if (field.type === 'list' && Array.isArray(cellValue.rawValue)) {
		if (!cellValue.rawValue.every(value => typeof value === 'string')) return false;
		if (new Set(cellValue.rawValue).size !== cellValue.rawValue.length) return false;
		return true;
	}
	if (field.type === 'list') return false;
	if (field.type === 'number') return typeof cellValue.rawValue === 'number';
	if (field.type === 'date' || field.type === 'datetime' || field.type === 'text') return typeof cellValue.rawValue === 'string';
	if (field.type === 'checkbox') return isSupportedRawYamlPropertyValue(cellValue.rawValue);
	return toRawYamlPropertyExpectation(cellValue) !== null;
}

export function openTableFilePropertyPicker(options: {
	app: App;
	anchor: HTMLElement | DOMRect;
	field: TableFilePropertyField;
	label: string;
	cellValue: TableFilePropertyCellValue;
	candidates: readonly string[];
	settings: Pick<OperonSettings, 'timeFormat' | 'calendarWeekStart' | 'calendarSidebarShowWeekNumbers'>;
	sourcePath: string;
	lifecycleOwner?: Node;
	sessionKey?: string;
	onFocusReturn?: () => void;
	onMutation: (mutation: RawYamlPropertyMutation) => void;
	onClose?: () => void;
}): (() => void) | null {
	const expected = toRawYamlPropertyExpectation(options.cellValue);
	if (!expected) return null;
	const remove = (): void => options.onMutation({ kind: 'delete' });
	const common = {
		canonicalKey: options.field.key,
		label: options.label,
		canRemove: options.cellValue.present,
		onRemove: remove,
		onClose: options.onClose,
	};
	const normalizedValue = options.cellValue.normalizedValue;
	switch (options.field.type) {
		case 'list': {
			const current = Array.isArray(options.cellValue.rawValue)
				&& options.cellValue.rawValue.every(value => typeof value === 'string')
				? options.cellValue.rawValue
				: [];
			return showCustomListFieldPicker(options.anchor, {
				...common,
				app: options.app,
				type: 'list',
				sourcePath: options.sourcePath,
				value: current,
				candidates: [...options.candidates],
				onCommit: () => undefined,
				onCommitValues: (_key, values) => options.onMutation({ kind: 'set', value: values }),
			});
		}
		case 'number':
			return showCustomNumberFieldPicker(options.anchor, {
				...common,
				type: 'number',
				value: normalizedValue,
				onCommit: (_key, value) => {
					const numberValue = Number(value);
					if (Number.isFinite(numberValue)) options.onMutation({ kind: 'set', value: numberValue });
				},
			});
		case 'date':
			return showCustomDateFieldPicker(options.anchor, {
				...common,
				app: options.app,
				type: 'date',
				value: normalizedValue,
				onCommit: (_key, value) => options.onMutation({ kind: 'set', value }),
			});
		case 'datetime':
			return showCustomDatetimeFieldPicker(options.anchor, {
				...common,
				app: options.app,
				settings: options.settings,
				type: 'datetime',
				value: normalizedValue,
				onCommit: (_key, value) => options.onMutation({ kind: 'set', value }),
			});
		case 'text':
		default:
			if (resolveTableTextEditRoute(normalizedValue, true) === 'popover') {
				return showTextFieldPopover({
					app: options.app,
					anchor: options.anchor,
					title: options.label,
					initialValue: normalizedValue,
					allowEmptyCommit: true,
					sessionKey: options.sessionKey,
					lifecycleOwner: options.lifecycleOwner,
					onFocusReturn: options.onFocusReturn,
					editor: {
						kind: 'compact-markdown',
						sourcePath: options.sourcePath,
					},
					onCommit: value => {
						options.onMutation(buildTableFilePropertyTextMutation(value));
					},
					onClose: options.onClose,
				});
			}
			return showCustomTextFieldPicker(options.anchor, {
				...common,
				type: 'text',
				value: normalizedValue,
				candidates: [...options.candidates],
				onCommit: (_key, value) => options.onMutation({ kind: 'set', value }),
			});
	}
}

export function renderTableFilePropertyCheckbox(options: {
	cell: HTMLElement;
	field: TableFilePropertyField;
	label: string;
	cellValue: TableFilePropertyCellValue;
	compact: boolean;
	editable: boolean;
	onToggle: (mutation: RawYamlPropertyMutation) => void;
}): HTMLButtonElement {
	const { cell, cellValue } = options;
	const rawValue = cellValue.rawValue;
	const validBoolean = typeof rawValue === 'boolean';
	const empty = cellValue.present && (rawValue === null || rawValue === '');
	const invalid = cellValue.present && !validBoolean && !empty;
	const stateText = validBoolean
		? String(rawValue)
		: invalid
			? t('filterSets', 'filePropertyUnsupportedValue')
			: t('table', empty ? 'filePropertyEmpty' : 'filePropertyNotSet');
	const button = cell.createEl('button', {
		cls: `operon-table-file-property-checkbox operon-table-cell-chip operon-chip operon-live-preview-chip operon-inline-compact-chip operon-task-chip ${options.compact ? 'is-compact is-icon-only' : 'is-detailed'} ${options.editable ? 'operon-table-editable-chip' : 'operon-chip-readonly'}`,
		attr: { type: 'button', role: 'checkbox' },
	});
	button.setAttribute('aria-checked', validBoolean ? String(rawValue) : 'mixed');
	button.disabled = !options.editable;
	if (invalid) button.setAttribute('aria-invalid', 'true');
	setAccessibleLabelWithoutTooltip(button, `${options.label}: ${stateText}`);
	const icon = button.createSpan('operon-table-file-property-checkbox-icon operon-inline-compact-chip-icon operon-table-cell-chip-icon');
	setIcon(icon, validBoolean ? (rawValue ? 'square-check-big' : 'square') : 'square-dashed');
	if (!options.compact) button.createSpan({
		cls: 'operon-table-file-property-checkbox-label operon-inline-compact-chip-label operon-table-cell-chip-label',
		text: validBoolean ? String(rawValue) : '--',
	});
	if (invalid) {
		button.addEventListener('click', () => new Notice(t('table', 'filePropertyInvalidBoolean', { property: options.field.propertyName })));
		return button;
	}
	if (!options.editable) return button;
	button.addEventListener('click', event => {
		event.preventDefault();
		event.stopPropagation();
		options.onToggle({ kind: 'set', value: validBoolean ? !rawValue : true });
	});
	return button;
}

export function renderTableFilePropertyValue(options: {
	cell: HTMLElement;
	field: TableFilePropertyField | null;
	label: string;
	cellValue: TableFilePropertyCellValue;
	column: TableColumn;
	task: IndexedTask;
	settings: Pick<OperonSettings, 'colorPalette' | 'pipelines' | 'priorities'>;
	workflowStatusIdentityIndex?: WorkflowStatusIdentityIndex;
	app?: App;
	sourcePath?: string;
	editable: boolean;
	onToggle: (mutation: RawYamlPropertyMutation) => void;
}): boolean {
	const isTextField = options.field?.type === 'text' && options.field.unavailable !== true;
	const accentOptions = {
		task: options.task,
		settings: options.settings,
		workflowStatusIdentityIndex: options.workflowStatusIdentityIndex,
	};
	if (options.field?.type === 'checkbox') {
		const checkbox = renderTableFilePropertyCheckbox({
			cell: options.cell,
			field: options.field,
			label: options.label,
			cellValue: options.cellValue,
			compact: options.column.displayMode === 'icon',
			editable: options.editable,
			onToggle: options.onToggle,
		});
		applyTableColumnCellAccent(checkbox, options.column, options.cellValue.normalizedValue, accentOptions);
		return true;
	}
	const renderValues = Array.isArray(options.cellValue.rawValue)
		? options.cellValue.rawValue.filter(value => value !== null).map(String)
		: (options.cellValue.normalizedValue.trim() ? [options.cellValue.normalizedValue] : []);
	const listValue = options.field?.type === 'list' || Array.isArray(options.cellValue.rawValue);
	if (isTextField && options.column.displayMode !== 'icon') {
		renderTableTextValueDisplay(options.cell, {
			value: options.cellValue.normalizedValue,
			...(options.app && options.sourcePath
				? { wikilinks: { app: options.app, sourcePath: options.sourcePath } }
				: {}),
		});
	} else if (isTextField && options.column.displayMode === 'icon') {
		if (!options.cellValue.normalizedValue.trim()) return false;
		const content = formatTableIconOnlyTooltipContent(options.cellValue.normalizedValue);
		renderTableIconOnlyCell(options.cell, {
			icon: options.field?.icon ?? 'text',
			color: null,
			title: options.label,
			content,
			...(options.app
				? { contentEl: createCompactTaskMarkdownTooltipContent(options.cell, options.cellValue.normalizedValue) }
				: {}),
			ariaLabel: `${options.label}: ${content}`,
			focusable: !options.editable,
		});
	} else if (listValue && options.column.displayMode === 'icon') {
		const content = formatTableListIconOnlyTooltipContent(renderValues);
		if (!content) return false;
		renderTableIconOnlyCell(options.cell, {
			icon: options.field?.icon ?? 'text',
			color: resolveTableColumnCellAccent(
				options.column,
				options.cellValue.normalizedValue,
				accentOptions,
			),
			title: options.label,
			content,
			ariaLabel: `${options.label}: ${content}`,
			focusable: !options.editable,
		});
	} else if (options.column.displayMode === 'icon') {
		const icon = options.cell.createSpan('operon-table-file-property-icon');
		setIcon(icon, options.field?.icon ?? 'text');
		applyTableColumnCellAccent(icon, options.column, options.cellValue.normalizedValue, {
			...accentOptions,
			decorateAsChip: false,
		});
		setAccessibleLabelWithoutTooltip(
			options.cell,
			`${options.label}: ${options.cellValue.normalizedValue || t('table', 'filePropertyNotSet')}`,
		);
	} else if (renderValues.length === 0) {
		options.cell.createSpan({ cls: 'operon-table-empty-value', text: '--' });
	} else {
		const chipParent = listValue
			? options.cell.createSpan('operon-table-cell-chip-list')
			: options.cell;
		for (const value of renderValues) {
			const displayValue = listValue ? formatTableCellListChipDisplayValue(value) : value;
			const chip = chipParent.createSpan({
				cls: `operon-table-cell-chip operon-chip operon-live-preview-chip operon-inline-compact-chip operon-task-chip${options.editable ? ' operon-table-editable-chip' : ' operon-chip-readonly'}`,
			});
			if (listValue) {
				chip.createSpan({ cls: 'operon-table-cell-chip-label', text: displayValue });
			} else {
				chip.setText(displayValue);
			}
			applyTableColumnCellAccent(chip, options.column, value, accentOptions);
			if (listValue) decorateTableListValueChip(chip, displayValue);
		}
	}
	return false;
}

export function bindTableFilePropertyRemovalMenu(options: {
	cell: HTMLElement;
	field: TableFilePropertyField;
	cellValue: TableFilePropertyCellValue;
	editable: boolean;
	onRemove: () => void;
}): void {
	if (!options.editable || !options.cellValue.present) return;
	const open = (event: MouseEvent | KeyboardEvent): void => {
		event.preventDefault();
		event.stopPropagation();
		const menu = new Menu();
		menu.addItem(item => item
			.setTitle(t('table', 'filePropertyRemove'))
			.setIcon('trash-2')
			.onClick(options.onRemove));
		if (event.type === 'contextmenu') menu.showAtMouseEvent(event as MouseEvent);
		else menu.showAtPosition({ x: options.cell.getBoundingClientRect().left, y: options.cell.getBoundingClientRect().bottom });
	};
	options.cell.addEventListener('contextmenu', open);
	options.cell.addEventListener('keydown', event => {
		if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) open(event);
	});
}
