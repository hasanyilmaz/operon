import { parseCompactWikiLinkValue } from '../compact-task-layout';
import type { NativeListPickerOperation } from '../field-pickers/custom/custom-list-field-picker';
import { formatUiDate } from '../../core/ui-date-format';
import { formatUiTaskDatetime } from '../../core/ui-time-format';
import { encodeVaultPropertyValue } from '../../core/vault-property-codec';
import type { InlinePropertyType } from '../../core/inline-property-definitions';
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
	decorateTableDateValueChip,
	decorateTableListValueChip,
	formatTableCellListChipDisplayValue,
	formatTableListIconOnlyTooltipContent,
} from './table-cell-chip';
import { resolveTableColumnCellAccent } from './table-column-color';
import { renderTableTextValueDisplay } from './table-description-cell';
import { formatTableIconOnlyTooltipContent, renderTableIconOnlyCell } from './table-icon-only-cell';
import { bindPropertyReadOnlyWarning } from '../property-readonly-warning';
import { bindOperonHoverTooltip, createCompactTaskMarkdownTooltipContent } from '../operon-hover-tooltip';
import { showSearchableOptionPicker } from '../field-pickers/searchable-option-picker';
import { resolveSurfaceFloatingHostOptions } from '../field-pickers/common';
import { showTextFieldPopover } from '../text-field-popover';
import { buildTableFilePropertyTextMutation } from './table-text-edit-route';

export interface TableFilePropertyUpdateRequest {
 sourceFormat?: 'yaml' | 'inline';
 nativeType?: InlinePropertyType;
 inlineExpected?: { present: boolean; rawValue?: string };
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
	if (!canWrite || !field || field.readonly || cellValue.nativeState === 'unsupported') return false;
 if (cellValue.nativeState === 'ready') return true;
 if (task.primary.format !== 'yaml') return false;
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
	settings: Pick<OperonSettings, 'timeFormat' | 'calendarWeekStart' | 'calendarSidebarShowWeekNumbers'> & Partial<Pick<OperonSettings, 'dateDisplayFormat'>>;
	sourcePath: string;
	lifecycleOwner?: Node;
	sessionKey?: string;
 preserveListValues?: boolean;
 nativeList?: boolean;
 confirmList?: boolean;
 editListIndex?: number;
 onNativeOperation?: (operation: NativeListPickerOperation) => readonly (string | number)[];
 textEditRoute?: 'picker' | 'popover';
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
	const normalizedValue = options.field.type === 'text' && typeof options.cellValue.rawValue === 'string'
		? options.cellValue.rawValue : options.cellValue.normalizedValue;
	switch (options.field.type) {
		case 'checkbox':
			return showSearchableOptionPicker(options.anchor, {
				...('ownerDocument' in options.anchor ? resolveSurfaceFloatingHostOptions(options.anchor) : {}),
				value: normalizedValue, options: [{value: 'true', label: 'true'}, {value: 'false', label: 'false'}],
				placeholder: options.label, ariaLabel: options.label, noMatchesText: t('taskEditor', 'noAvailableFileProperties'),
				onSelect: option => options.onMutation({kind: 'set', value: option.value === 'true'}), onClose: options.onClose,
			});
		case 'list': {
			const current = Array.isArray(options.cellValue.rawValue)
				&& options.cellValue.rawValue.every(value => typeof value === 'string')
				? options.cellValue.rawValue
				: [];
			return showCustomListFieldPicker(options.anchor, {
				confirmValues: options.confirmList,
    onNativeOperation: options.onNativeOperation,
				...common,
				app: options.app,
				type: 'list',
				sourcePath: options.sourcePath,
				value: current,
    ...(options.nativeList ? {
     nativeValues: Array.isArray(options.cellValue.rawValue) ? options.cellValue.rawValue as (string | number)[] : [],
     editIndex: options.editListIndex,
     onCommitNativeValues: (values: (string | number)[]) => options.onMutation({ kind: 'set', value: values }),
    } : {}),
                preserveValues: options.preserveListValues,
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
				dateDisplayFormat: options.settings.dateDisplayFormat,
				value: normalizedValue,
				onCommit: (_key, value) => options.onMutation({ kind: 'set', value }),
			});
		case 'datetime':
			return showCustomDatetimeFieldPicker(options.anchor, {
				...common,
				app: options.app,
				settings: options.settings,
				type: 'datetime',
				dateDisplayFormat: options.settings.dateDisplayFormat,
				value: normalizedValue,
				onCommit: (_key, value) => options.onMutation({ kind: 'set', value }),
			});
		case 'text':
		default:
			return showCustomTextFieldPicker(options.anchor, {
				...common,
				type: 'text',
				value: normalizedValue,
				separateCurrentValue: true,
				editMultilineValue: onClose => {
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
							textPolicy: 'task-note',
						},
						onCommit: value => {
							options.onMutation(buildTableFilePropertyTextMutation(value));
						},
						onClose,
					});
				},
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
	if (!options.compact && validBoolean) button.createSpan({
		cls: 'operon-table-file-property-checkbox-label operon-inline-compact-chip-label operon-table-cell-chip-label',
		text: String(rawValue),
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
	settings: Pick<OperonSettings, 'colorPalette' | 'pipelines' | 'priorities'> & Partial<Pick<OperonSettings, 'dateDisplayFormat' | 'timeFormat'>>;
	workflowStatusIdentityIndex?: WorkflowStatusIdentityIndex;
	app?: App;
	sourcePath?: string;
	editable: boolean;
	onToggle: (mutation: RawYamlPropertyMutation) => void;
 bindOpening?: (chip: HTMLElement, member?: unknown, memberIndex?: number) => boolean;
 onEditListMember?: (index: number) => void;
}): boolean {
 const warning = !options.editable ? options.cellValue.readOnlyReason ?? options.field?.readOnlyReason : undefined;
 if (warning) {
  options.cell.tabIndex = 0; options.cell.setAttribute('aria-readonly', 'true');
  bindPropertyReadOnlyWarning(options.cell, options.field?.propertyName ?? options.label, warning);
 }
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
	const openingMembers = Array.isArray(options.cellValue.rawValue) ? options.cellValue.rawValue.map((value: unknown, index) => ({ value, index })).filter(member => member.value !== null) : [];
	const listValue = options.field?.type === 'list' || Array.isArray(options.cellValue.rawValue);
 if (warning && options.column.displayMode === 'icon') {
  const icon = options.cell.createSpan('operon-table-file-property-icon');
  setIcon(icon, options.field?.icon ?? 'text');
  applyTableColumnCellAccent(icon, options.column, options.cellValue.normalizedValue, { ...accentOptions, decorateAsChip: false });
  return false;
 }
	if (isTextField && options.column.displayMode !== 'icon') {
  if (options.bindOpening && parseCompactWikiLinkValue(options.cellValue.normalizedValue)) {
   const chip = options.cell.createSpan('operon-table-cell-chip operon-chip operon-inline-compact-chip operon-task-chip');
   chip.createSpan({ cls: 'operon-table-cell-chip-label', text: parseCompactWikiLinkValue(options.cellValue.normalizedValue)!.displayValue });
   bindOperonHoverTooltip(chip, { content: options.cellValue.normalizedValue, taskColor: null });
   options.bindOpening(chip);
   return false;
  }
		renderTableTextValueDisplay(options.cell, {
			value: options.cellValue.normalizedValue,
   suppressValueTooltip: !!warning, visualOnlyLinks: !!options.bindOpening,
			...(options.app && options.sourcePath
				? { wikilinks: { app: options.app, sourcePath: options.sourcePath } }
				: {}),
		});
	} else if (isTextField && options.column.displayMode === 'icon') {
		if (!options.cellValue.normalizedValue.trim()) return false;
		const content = formatTableIconOnlyTooltipContent(options.cellValue.normalizedValue);
		const icon = renderTableIconOnlyCell(options.cell, {
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
  options.bindOpening?.(icon);
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
	} else if (renderValues.length > 0) {
		const chipParent = listValue
			? options.cell.createSpan('operon-table-cell-chip-list')
			: options.cell;
		for (const [index, value] of renderValues.entries()) {
			const nativeMember: unknown = Array.isArray(options.cellValue.rawValue) ? options.cellValue.rawValue[index] : undefined;
   const displayValue = !listValue && options.field?.type === 'date' ? formatUiDate(value, { dateDisplayFormat: options.settings.dateDisplayFormat ?? 'YYYY-MM-DD' })
    : !listValue && options.field?.type === 'datetime' && options.app ? formatUiTaskDatetime(options.app, { dateDisplayFormat: options.settings.dateDisplayFormat ?? 'YYYY-MM-DD', timeFormat: options.settings.timeFormat ?? '24h' }, value)
    : listValue && options.cellValue.nativeState === 'ready' && (typeof nativeMember === 'string' || typeof nativeMember === 'number')
    ? encodeVaultPropertyValue([nativeMember], 'list') : listValue ? formatTableCellListChipDisplayValue(value) : value;
			const chip = chipParent.createSpan({
				cls: `operon-table-cell-chip operon-chip operon-live-preview-chip operon-inline-compact-chip operon-task-chip${options.editable ? ' operon-table-editable-chip' : ' operon-chip-readonly'}`,
			});
			decorateTableDateValueChip(chip, options.field?.type);
			if (listValue) {
				chip.createSpan({ cls: 'operon-table-cell-chip-label', text: displayValue });
			} else {
				chip.setText(displayValue);
			}
			applyTableColumnCellAccent(chip, options.column, value, accentOptions);
			if (listValue) decorateTableListValueChip(chip, displayValue, { tooltipMode: warning ? 'none' : 'overflow' });
   const openingMember = openingMembers[index];
   if (listValue && typeof openingMember?.value === 'string' && options.bindOpening?.(chip, openingMember.value, openingMember.index)) continue;
   if (listValue && options.editable && options.onEditListMember) {
    chip.tabIndex = 0; chip.setAttribute('role', 'button');
    chip.addEventListener('click', event => { event.stopPropagation(); options.onEditListMember?.(index); });
    chip.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); options.onEditListMember?.(index); } });
   }
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
			.onClick(() => {
				// A body-owned menu may outlive the table snapshot that opened it.
				if (!options.cell.isConnected || options.cell.closest('[inert]')) return;
				options.onRemove();
			}));
		if (event.type === 'contextmenu') menu.showAtMouseEvent(event as MouseEvent);
		else menu.showAtPosition({ x: options.cell.getBoundingClientRect().left, y: options.cell.getBoundingClientRect().bottom });
	};
	options.cell.addEventListener('contextmenu', open);
	options.cell.addEventListener('keydown', event => {
		if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) open(event);
	});
}

const failedDrafts = new WeakMap<object, Map<string, RawYamlPropertyMutation>>();
export function retainTablePropertyDraft(owner: object, key: string, mutation?: RawYamlPropertyMutation): void {
 let drafts = failedDrafts.get(owner);
 if (!drafts) { drafts = new Map(); failedDrafts.set(owner, drafts); }
 if (mutation) drafts.set(key, mutation); else drafts.delete(key);
}
export function tablePropertyPickerDraft(owner: object, key: string, cell: TableFilePropertyCellValue): TableFilePropertyCellValue {
 const draft = failedDrafts.get(owner)?.get(key);
 if (!draft || draft.kind === 'delete') return cell;
 const value = draft.kind === 'set' ? draft.value : undefined;
 return { ...cell, rawValue: value, normalizedValue: value === undefined || value === null ? '' : String(value) };
}
export function tablePropertyUpdateRequest(task: IndexedTask, field: TableFilePropertyField, cell: TableFilePropertyCellValue, mutation: RawYamlPropertyMutation): TableFilePropertyUpdateRequest | null {
 const expected = toRawYamlPropertyExpectation(cell);
 if (!expected) return null;
 return { propertyName: cell.sourceName ?? field.propertyName, expected, mutation,
  ...(cell.nativeState === 'ready' ? { sourceFormat: task.primary.format, nativeType: field.type as InlinePropertyType, inlineExpected: cell.inlineExpected } : {}) };
}
