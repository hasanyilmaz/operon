import { App, Menu, Notice, setIcon } from 'obsidian';
import type { IndexedTask } from '../../types/fields';
import type { OperonSettings } from '../../types/settings';
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
}): void {
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
		return;
	}
	if (!options.editable) return;
	button.addEventListener('click', event => {
		event.preventDefault();
		event.stopPropagation();
		options.onToggle({ kind: 'set', value: validBoolean ? !rawValue : true });
	});
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
