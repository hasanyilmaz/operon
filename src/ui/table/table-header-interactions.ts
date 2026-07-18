import { Menu, setIcon } from 'obsidian';
import type { IndexedTask } from '../../types/fields';
import type { OperonSettings } from '../../types/settings';
import {
	TABLE_LINE_NUMBER_COLUMN_KEY,
	TABLE_TASK_ICON_COLUMN_KEY,
	TABLE_TASK_TYPE_COLUMN_KEY,
	resolveTableColumnDisplayMode,
	resolveTableDurationDisplayMode,
	type TableColumn,
	type TableColumnAlignment,
	type TableColumnColorMode,
	type TableColumnDisplayMode,
	type TableDurationDisplayMode,
	type TablePreset,
	type TableSummaryFunction,
} from '../../types/table';
import { t } from '../../core/i18n';
import { getOwnerDocument, isHTMLElement } from '../../core/dom-compat';
import { setAccessibleLabelWithoutTooltip } from '../accessibility-label';
import {
	applyTableColumnAlignmentClass,
	applyTableColumnGeometryClass,
	buildTableColumnGeometry,
	isTableAdminColumn,
	resolveTableColumnWidth,
	type TableColumnGeometry,
} from './table-surface';
import {
	TABLE_COLUMN_COLOR_MENU_MODES,
	isTableColumnColorModeEligible,
	resolveEffectiveTableColumnColorMode,
} from './table-column-color';
import {
	applyTablePresetFieldAliases,
	buildEffectiveTableTaskFieldCatalog,
	getEffectiveTableTaskField,
	getTableTaskField,
	getTableColumnLabel,
	type TableTaskField,
} from './table-field-catalog';
import {
	clearTablePresetSummary,
	cycleTablePresetPrimarySort,
	insertTablePresetColumnNear,
	moveTablePresetColumn,
	normalizeTableColumnWidth,
	normalizeTablePresetForColumnUi,
	resizeTablePresetColumn,
	setTablePresetColumnAlignment,
	setTablePresetColumnColorMode,
	setTablePresetColumnDisplayMode,
	setTablePresetColumnDurationDisplayMode,
	setTablePresetColumnLabel,
	setTablePresetColumnPinned,
	setTablePresetColumnVisible,
	setTablePresetSummary,
} from './table-preset-model';
import { getTableSummaryFunctionsForField, type TableSummaryCell, type TableSummaryValueResolver } from './table-summary';
import { showTableSummaryPicker } from './table-summary-picker';
import { showSearchableFieldPicker } from '../field-pickers/searchable-field-picker';
import type { FloatingHostOptions } from '../field-pickers/common';
import { buildTableFieldPickerOptions } from './table-field-picker-options';
import { bindOperonHoverTooltip } from '../operon-hover-tooltip';
import { showTableColumnRenamePopover } from './table-column-rename-popover';
import { isTableFilePropertyColumnKey } from './table-file-property';

const TABLE_COLUMN_RESIZE_DRAG_THRESHOLD_PX = 4;

export interface TableHeaderRenderState {
	preset: TablePreset;
	columns: TableColumn[];
	taskColumns: TableColumn[];
	rows: readonly IndexedTask[];
	summaries: Map<string, TableSummaryCell>;
	settings: OperonSettings;
	allTasks: readonly IndexedTask[];
	additionalFields?: readonly TableTaskField[];
	valueResolver?: TableSummaryValueResolver;
	columnGeometry: TableColumnGeometry;
	scrollbarGutterPx: number;
}

export interface TableHeaderInteractionState {
	draggedColumnKey: string | null;
	suppressNextHeaderClick: boolean;
	activeResizeCleanup: (() => void) | null;
}

export type TableHeaderPresetPatchScope = 'columns' | 'sortRules' | 'summaries';

export interface TableHeaderInteractionOptions {
	root: HTMLElement;
	state: TableHeaderInteractionState;
	getRenderState: () => TableHeaderRenderState | null;
	getCurrentPreset: () => TablePreset;
	savePreset: (updatedPreset: TablePreset, scope: TableHeaderPresetPatchScope) => void;
	applyColumnTemplate: (columns: readonly TableColumn[]) => void;
	closeActivePicker: () => void;
	getActivePickerClose: () => (() => void) | null;
	setActivePickerClose: (close: (() => void) | null) => void;
	onOpenPresetSettings?: (presetId: string) => void;
	readOnly?: boolean;
	floatingHostOptions?: FloatingHostOptions;
}

export function createTableHeaderInteractionState(): TableHeaderInteractionState {
	return {
		draggedColumnKey: null,
		suppressNextHeaderClick: false,
		activeResizeCleanup: null,
	};
}

export function cleanupTableHeaderActiveResize(state: TableHeaderInteractionState): void {
	state.activeResizeCleanup?.();
	state.activeResizeCleanup = null;
}

export function canUseTableIconOnlyColumn(column: TableColumn, settings: Pick<OperonSettings, 'keyMappings'>): boolean {
	return canUseIconOnlyColumn(column, settings);
}

export function shouldUseTableIconOnlyColumn(column: TableColumn, settings: Pick<OperonSettings, 'keyMappings'>): boolean {
	return shouldUseIconOnlyColumn(column, settings);
}

export function renderInteractiveTableHeaderCell(
	header: HTMLElement,
	column: TableColumn,
	columnIndex: number,
	options: TableHeaderInteractionOptions,
): void {
	const renderState = options.getRenderState();
	const settings = renderState?.settings;
	const columnGeometry = renderState?.columnGeometry;
	const cell = header.createDiv('operon-table-header-cell');
	cell.setAttribute('role', 'columnheader');
	cell.setAttribute('aria-colindex', String(columnIndex + 1));
	cell.dataset.columnKey = column.key;
	if (columnGeometry) {
		applyTableColumnGeometryClass(cell, columnGeometry.entries[columnIndex]);
	}
	if (isTableAdminColumn(column)) {
		cell.addClass('operon-table-admin-header-cell');
		cell.addClass('operon-table-header-cell-readonly');
		cell.setAttribute('aria-sort', 'none');
		renderTableAdminHeaderCell(cell, column, settings ?? null);
		return;
	}
	if (!renderState || !settings) {
		cell.addClass('operon-table-header-cell-readonly');
		renderTableHeaderLabel(cell, column, null, null, []);
		return;
	}
	if (options.readOnly) {
		cell.addClass('operon-table-header-cell-readonly');
		applyTableColumnAlignmentClass(cell, column);
		cell.setAttribute('aria-sort', 'none');
		renderTableHeaderLabel(cell, column, settings, null, renderState.additionalFields ?? []);
		return;
	}
	applyTableColumnAlignmentClass(cell, column);
	cell.tabIndex = 0;
	const sortableField = getEffectiveTableTaskField(
		column.key,
		renderState.settings,
		renderState.additionalFields ?? [],
	);
	const canSortColumn = !!sortableField && sortableField.unavailable !== true;
	const activeSort = canSortColumn ? renderState.preset.sortRules.find(rule => rule.key === column.key) : undefined;
	const sortDirection = activeSort?.key === column.key ? activeSort.direction : null;
	cell.setAttribute('aria-sort', sortDirection === 'asc' ? 'ascending' : sortDirection === 'desc' ? 'descending' : 'none');
	if (sortDirection) {
		cell.addClass('is-sorted');
	}
	cell.draggable = true;
	cell.addEventListener('click', event => {
		if (!canSortColumn) return;
		if (options.state.suppressNextHeaderClick) {
			event.preventDefault();
			return;
		}
		if (isHTMLElement(event.target, options.root) && event.target.closest('.operon-table-header-resize-handle')) return;
		cycleHeaderSort(column.key, options);
	});
	cell.addEventListener('contextmenu', event => {
		showTableColumnHeaderMenu(event, column, cell, options);
	});
	cell.addEventListener('keydown', event => {
		if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
			event.preventDefault();
			event.stopPropagation();
			showTableColumnHeaderKeyboardMenu(event, column, cell, options);
			return;
		}
		if (!canSortColumn || (event.key !== 'Enter' && event.key !== ' ')) return;
		event.preventDefault();
		cycleHeaderSort(column.key, options);
	});
	cell.addEventListener('dragstart', event => {
		options.state.draggedColumnKey = column.key;
		options.state.suppressNextHeaderClick = true;
		event.dataTransfer?.setData('text/plain', column.key);
		event.dataTransfer?.setDragImage(cell, 12, 12);
		cell.addClass('is-dragging');
	});
	cell.addEventListener('dragover', event => {
		if (!options.state.draggedColumnKey || options.state.draggedColumnKey === column.key) return;
		event.preventDefault();
		cell.addClass('is-drag-target');
	});
	cell.addEventListener('dragleave', () => {
		cell.removeClass('is-drag-target');
	});
	cell.addEventListener('drop', event => {
		event.preventDefault();
		cell.removeClass('is-drag-target');
		const fromKey = event.dataTransfer?.getData('text/plain') || options.state.draggedColumnKey;
		options.state.draggedColumnKey = null;
		if (!fromKey || fromKey === column.key) return;
		options.state.suppressNextHeaderClick = true;
		options.savePreset(moveTablePresetColumn(options.getCurrentPreset(), fromKey, column.key), 'columns');
	});
	cell.addEventListener('dragend', () => {
		options.state.draggedColumnKey = null;
		cell.removeClass('is-dragging');
		cell.removeClass('is-drag-target');
		const ownerWindow = cell.ownerDocument.defaultView ?? window;
		ownerWindow.setTimeout(() => {
			options.state.suppressNextHeaderClick = false;
		}, 0);
	});
	const iconOnly = shouldUseIconOnlyColumn(column, settings, renderState.additionalFields);
	cell.classList.toggle('is-icon-only', iconOnly);
	renderTableHeaderLabel(cell, column, settings, sortDirection, renderState.additionalFields ?? []);
	const resizeHandle = cell.createSpan('operon-table-header-resize-handle');
	resizeHandle.setAttribute('aria-hidden', 'true');
	resizeHandle.addEventListener('click', event => {
		event.preventDefault();
		event.stopPropagation();
	});
	resizeHandle.addEventListener('dblclick', event => {
		event.preventDefault();
		event.stopPropagation();
		toggleTableColumnDisplayMode(column.key, options);
	});
	resizeHandle.addEventListener('pointerdown', event => {
		if (event.button !== 0) return;
		startTableColumnResize(event, column.key, options);
	});
}

export function applyInteractiveTableColumnTemplate(
	root: HTMLElement,
	currentRenderState: TableHeaderRenderState | null,
	columns: readonly TableColumn[],
): TableColumnGeometry {
	const columnGeometry = buildTableColumnGeometry(columns);
	const template = columnGeometry.columnTemplate;
	const tableWidthPx = columnGeometry.tableWidthPx;
	const tableWidth = `${tableWidthPx}px`;
	const surfaceWidth = `${tableWidthPx + (currentRenderState?.scrollbarGutterPx ?? 0)}px`;
	for (const node of Array.from(root.querySelectorAll('.operon-table-header, .operon-table-row, .operon-table-summary-row, .operon-table-group-row'))) {
		if (!isHTMLElement(node, root)) continue;
		const element = node;
		if (element.classList.contains('operon-table-header')) {
			element.style.gridTemplateColumns = template;
			element.style.width = surfaceWidth;
			element.style.minWidth = surfaceWidth;
		} else {
			if (!element.classList.contains('operon-table-group-row')) {
				element.style.gridTemplateColumns = template;
			} else {
				element.style.setProperty('--operon-table-group-leading-offset', `${columnGeometry.pinnedBoundaryPx}px`);
			}
			element.style.width = tableWidth;
		}
	}
	for (const node of Array.from(root.querySelectorAll('.operon-table-body-scroller'))) {
		if (!isHTMLElement(node, root)) continue;
		node.style.removeProperty('width');
		node.style.removeProperty('min-width');
	}
	for (const node of Array.from(root.querySelectorAll('.operon-table-body-canvas'))) {
		if (!isHTMLElement(node, root)) continue;
		node.style.width = tableWidth;
		node.style.minWidth = tableWidth;
	}
	applyRenderedColumnGeometry(root, columnGeometry);
	return columnGeometry;
}

function renderTableAdminHeaderCell(cell: HTMLElement, column: TableColumn, settings: OperonSettings | null): void {
	const iconEl = cell.createSpan('operon-table-header-icon');
	if (column.key === TABLE_LINE_NUMBER_COLUMN_KEY) {
		setIcon(iconEl, 'list-ordered');
		cell.createSpan({ cls: 'operon-table-header-label', text: t('settings', 'tableShowLineNumbers') });
		return;
	}
	if (column.key === TABLE_TASK_ICON_COLUMN_KEY) {
		setIcon(iconEl, settings ? getTableTaskField('taskIcon', settings)?.icon ?? 'icons' : 'icons');
		cell.createSpan({ cls: 'operon-table-header-label', text: t('settings', 'tableShowTaskIcon') });
		return;
	}
	if (column.key === TABLE_TASK_TYPE_COLUMN_KEY) {
		cell.addClass('operon-table-task-type-header-cell');
		setAccessibleLabelWithoutTooltip(cell, t('settings', 'tableTaskTypeColumn'));
		setIcon(iconEl, 'database');
		return;
	}
	cell.createSpan({ cls: 'operon-table-header-label', text: column.label?.trim() || column.key });
}

function renderTableHeaderLabel(
	cell: HTMLElement,
	column: TableColumn,
	settings: OperonSettings | null,
	sortDirection: 'asc' | 'desc' | null,
	additionalFields: readonly TableTaskField[],
): void {
	const field = settings ? getEffectiveTableTaskField(column.key, settings, additionalFields) : null;
	const fieldLabel = settings ? getTableColumnLabel(column, settings, additionalFields) : column.label?.trim() || column.key;
	const iconOnly = settings ? shouldUseIconOnlyColumn(column, settings, additionalFields) : false;
	setAccessibleLabelWithoutTooltip(cell, fieldLabel);
	if (iconOnly) {
		bindOperonHoverTooltip(cell, {
			content: fieldLabel,
			taskColor: null,
			preferredVertical: 'below',
		});
	}
	if (field?.icon) {
		const iconEl = cell.createSpan('operon-table-header-icon');
		setIcon(iconEl, field.icon);
	}
	if (!iconOnly) {
		cell.createSpan({
			cls: 'operon-table-header-label',
			text: fieldLabel,
		});
	}
	if (sortDirection) {
		const sortIcon = cell.createSpan('operon-table-header-sort-icon');
		setIcon(sortIcon, sortDirection === 'asc' ? 'arrow-up' : 'arrow-down');
	}
}

function showTableColumnHeaderMenu(
	event: MouseEvent,
	column: TableColumn,
	anchor: HTMLElement,
	options: TableHeaderInteractionOptions,
): void {
	if (isTableAdminColumn(column)) return;
	event.preventDefault();
	event.stopPropagation();
	const menu = buildTableColumnHeaderMenu(column, anchor, { x: event.clientX, y: event.clientY }, options);
	if (!menu) return;
	menu.showAtMouseEvent(event);
}

function showTableColumnHeaderKeyboardMenu(
	event: KeyboardEvent,
	column: TableColumn,
	anchor: HTMLElement,
	options: TableHeaderInteractionOptions,
): void {
	if (isTableAdminColumn(column)) return;
	const rect = anchor.getBoundingClientRect();
	const position = {
		x: Math.round(rect.left),
		y: Math.round(rect.bottom),
	};
	const menu = buildTableColumnHeaderMenu(column, anchor, position, options);
	if (!menu) return;
	menu.showAtPosition(position, getOwnerDocument(event.currentTarget as Node | null));
}

function buildTableColumnHeaderMenu(
	column: TableColumn,
	anchor: HTMLElement,
	position: { x: number; y: number },
	options: TableHeaderInteractionOptions,
): Menu | null {
	if (isTableAdminColumn(column)) return null;
	options.closeActivePicker();
	const renderState = options.getRenderState();
	if (!renderState) return null;
	const menu = new Menu();
	menu.addItem(item => item
		.setTitle(t('table', 'renameColumn'))
		.setIcon('text-cursor-input')
		.onClick(() => {
			deferTableHeaderMenuAction(anchor, () => openTableColumnRenamePopover(anchor, column, options));
		}));
	menu.addSeparator();
	addTableAlignmentMenuItem(menu, column, 'left', t('table', 'alignColumnLeft'), 'align-left', options);
	addTableAlignmentMenuItem(menu, column, 'center', t('table', 'alignColumnCenter'), 'align-center', options);
	addTableAlignmentMenuItem(menu, column, 'right', t('table', 'alignColumnRight'), 'align-right', options);
	menu.addItem(item => item
		.setTitle(t('table', column.pinned === true ? 'unpinColumn' : 'pinColumn'))
		.setIcon(column.pinned === true ? 'pin-off' : 'pin')
		.onClick(() => {
			options.savePreset(setTablePresetColumnPinned(
				options.getCurrentPreset(),
				column.key,
				column.pinned !== true,
			), 'columns');
		}));
	if (column.key === 'duration') {
		addTableDurationDisplayMenuItem(menu, column, options);
	}
	if (canUseIconOnlyColumn(column, renderState.settings, renderState.additionalFields)) {
		addTableColumnDisplayMenuItem(menu, column, renderState, options);
	}
	menu.addSeparator();
	menu.addItem(item => item
		.setTitle(t('table', 'addColumnLeft'))
		.setIcon('panel-left-open')
		.onClick(event => {
			const submenuPosition = resolveHeaderSubmenuPosition(event, position, options.root);
			deferTableHeaderMenuAction(anchor, () => showTableAddColumnPicker(submenuPosition, column, 'left', options));
		}));
	menu.addItem(item => item
		.setTitle(t('table', 'addColumnRight'))
		.setIcon('panel-right-open')
		.onClick(event => {
			const submenuPosition = resolveHeaderSubmenuPosition(event, position, options.root);
			deferTableHeaderMenuAction(anchor, () => showTableAddColumnPicker(submenuPosition, column, 'right', options));
		}));
	menu.addSeparator();
	if (isTableColumnColorModeEligible(column)) {
		addTableColumnColorMenuItems(menu, column, options);
		menu.addSeparator();
	}
	if (getTableSummaryFunctionsForField(
		column.key,
		renderState.settings,
		renderState.additionalFields ?? [],
	).length > 0) {
		const currentSummary = getConfiguredSummaryFunction(column.key, renderState);
		menu.addItem(item => item
			.setTitle(t('table', currentSummary ? 'editSummary' : 'summarizeColumn'))
			.setIcon('sigma')
			.onClick(() => {
				deferTableHeaderMenuAction(anchor, () => openHeaderSummaryPicker(anchor, column, options));
			}));
	}
	menu.addItem(item => item
		.setTitle(t('table', 'editPreset'))
		.setIcon('settings-2')
		.setDisabled(!options.onOpenPresetSettings)
		.onClick(() => {
			options.onOpenPresetSettings?.(options.getRenderState()?.preset.id ?? renderState.preset.id);
		}));
	menu.addItem(item => item
		.setTitle(t('table', 'hideColumn'))
		.setIcon('eye-off')
		.setDisabled(!canHideTableColumn(column.key, renderState))
		.onClick(() => {
			if (!canHideTableColumn(column.key, options.getRenderState())) return;
			options.savePreset(setTablePresetColumnVisible(options.getCurrentPreset(), column.key, false), 'columns');
		}));
	return menu;
}

function openTableColumnRenamePopover(
	anchor: HTMLElement,
	column: TableColumn,
	options: TableHeaderInteractionOptions,
): void {
	const renderState = options.getRenderState();
	if (!renderState || isTableAdminColumn(column)) return;
	options.closeActivePicker();
	const presetId = renderState.preset.id;
	const originalLabel = getTableColumnLabel(
		{ key: column.key },
		renderState.settings,
		renderState.additionalFields ?? [],
	);
	let closePopover: (() => void) | null = null;
	closePopover = showTableColumnRenamePopover({
		anchor,
		...options.floatingHostOptions,
		initialValue: column.label?.trim() ?? '',
		placeholder: originalLabel,
		onSubmit: label => {
			const currentPreset = options.getCurrentPreset();
			if (currentPreset.id !== presetId) return;
			options.savePreset(setTablePresetColumnLabel(
				currentPreset,
				column.key,
				label,
			), 'columns');
		},
		onClose: () => {
			if (closePopover && options.getActivePickerClose() === closePopover) {
				options.setActivePickerClose(null);
			}
			const ownerDocument = anchor.ownerDocument;
			const ownerWindow = ownerDocument.defaultView ?? window;
			ownerWindow.requestAnimationFrame(() => {
				if (anchor.isConnected && ownerDocument.activeElement === ownerDocument.body) {
					anchor.focus({ preventScroll: true });
				}
			});
		},
	});
	options.setActivePickerClose(closePopover);
}

function deferTableHeaderMenuAction(anchor: HTMLElement, callback: () => void): void {
	const ownerWindow = anchor.ownerDocument.defaultView ?? window;
	ownerWindow.setTimeout(callback, 0);
}

function resolveHeaderSubmenuPosition(
	event: MouseEvent | KeyboardEvent,
	fallback: { x: number; y: number },
	root: HTMLElement,
): { x: number; y: number } {
	if (isHTMLElement(event.currentTarget, root)) {
		const rect = event.currentTarget.getBoundingClientRect();
		return {
			x: Math.round(rect.right),
			y: Math.round(rect.top),
		};
	}
	if ('clientX' in event && 'clientY' in event && (event.clientX !== 0 || event.clientY !== 0)) {
		return {
			x: Math.round(event.clientX),
			y: Math.round(event.clientY),
		};
	}
	return fallback;
}

function openHeaderSummaryPicker(anchor: HTMLElement, column: TableColumn, options: TableHeaderInteractionOptions): void {
	const renderState = options.getRenderState();
	const additionalFields = renderState
		? applyTablePresetFieldAliases(renderState.additionalFields ?? [], renderState.preset.columns)
		: [];
	if (!renderState || getTableSummaryFunctionsForField(
		column.key,
		renderState.settings,
		additionalFields,
	).length === 0) return;
	options.closeActivePicker();
	const supportedKeys = new Set(buildEffectiveTableTaskFieldCatalog(
		renderState.settings,
		additionalFields,
	).map(field => field.key));
	let closePicker: (() => void) | null = null;
	closePicker = showTableSummaryPicker({
		anchor,
		fieldKey: column.key,
		rows: renderState.rows,
		allTasks: renderState.allTasks,
		settings: renderState.settings,
		additionalFields,
		...(renderState.valueResolver ? { valueResolver: renderState.valueResolver } : {}),
		currentFunction: getConfiguredSummaryFunction(column.key, renderState),
		...options.floatingHostOptions,
		onSelect: summaryFunction => {
			options.savePreset(setTablePresetSummary(options.getCurrentPreset(), column.key, summaryFunction, supportedKeys), 'summaries');
		},
		onClear: () => {
			options.savePreset(clearTablePresetSummary(options.getCurrentPreset(), column.key), 'summaries');
		},
		onClose: () => {
			if (closePicker && options.getActivePickerClose() === closePicker) {
				options.setActivePickerClose(null);
			}
		},
	});
	options.setActivePickerClose(closePicker);
}

function addTableAlignmentMenuItem(
	menu: Menu,
	column: TableColumn,
	align: TableColumnAlignment,
	title: string,
	icon: string,
	options: TableHeaderInteractionOptions,
): void {
	const currentAlign = column.align ?? 'left';
	menu.addItem(item => item
		.setTitle(title)
		.setIcon(icon)
		.setChecked(currentAlign === align)
		.onClick(() => {
			options.savePreset(setTablePresetColumnAlignment(options.getCurrentPreset(), column.key, align), 'columns');
		}));
}

function addTableDurationDisplayMenuItem(menu: Menu, column: TableColumn, options: TableHeaderInteractionOptions): void {
	const currentMode = resolveTableDurationDisplayMode(column);
	const nextMode: TableDurationDisplayMode = currentMode === 'total' ? 'sessions' : 'total';
	menu.addItem(item => item
		.setTitle(t('table', nextMode === 'total' ? 'showDurationTotal' : 'showDurationSessions'))
		.setIcon(nextMode === 'total' ? 'calculator' : 'list')
		.onClick(() => {
			options.savePreset(setTablePresetColumnDurationDisplayMode(
				options.getCurrentPreset(),
				column.key,
				nextMode,
			), 'columns');
		}));
}

function addTableColumnDisplayMenuItem(
	menu: Menu,
	column: TableColumn,
	renderState: TableHeaderRenderState,
	options: TableHeaderInteractionOptions,
): void {
	const currentMode = resolveTableColumnDisplayMode(column);
	const nextMode: TableColumnDisplayMode = currentMode === 'icon' ? 'details' : 'icon';
	menu.addItem(item => item
		.setTitle(t('table', nextMode === 'icon' ? 'showCompactCell' : 'showDetailedCell'))
		.setIcon(nextMode === 'icon'
			? getEffectiveTableTaskField(column.key, renderState.settings, renderState.additionalFields)?.icon ?? 'text'
			: 'text')
		.onClick(() => {
			options.savePreset(setTablePresetColumnDisplayMode(
				options.getCurrentPreset(),
				column.key,
				nextMode,
				renderState.settings,
				getEffectiveTableTaskField(column.key, renderState.settings, renderState.additionalFields),
			), 'columns');
		}));
}

function canUseIconOnlyColumn(
	column: TableColumn,
	settings: Pick<OperonSettings, 'keyMappings'>,
	additionalFields: readonly TableTaskField[] = [],
): boolean {
	return column.kind === 'task' && !!getEffectiveTableTaskField(column.key, settings, additionalFields)?.icon;
}

function shouldUseIconOnlyColumn(
	column: TableColumn,
	settings: Pick<OperonSettings, 'keyMappings'>,
	additionalFields: readonly TableTaskField[] = [],
): boolean {
	return canUseIconOnlyColumn(column, settings, additionalFields) && resolveTableColumnDisplayMode(column) === 'icon';
}

function toggleTableColumnDisplayMode(columnKey: string, options: TableHeaderInteractionOptions): void {
	const renderState = options.getRenderState();
	if (!renderState) return;
	const column = renderState.columns.find(entry => entry.key === columnKey);
	if (!column || !canUseIconOnlyColumn(column, renderState.settings, renderState.additionalFields)) return;
	const nextMode: TableColumnDisplayMode = resolveTableColumnDisplayMode(column) === 'icon' ? 'details' : 'icon';
	options.closeActivePicker();
	options.savePreset(setTablePresetColumnDisplayMode(
		options.getCurrentPreset(),
		column.key,
		nextMode,
		renderState.settings,
		getEffectiveTableTaskField(column.key, renderState.settings, renderState.additionalFields),
	), 'columns');
}

function addTableColumnColorMenuItems(
	menu: Menu,
	column: TableColumn,
	options: TableHeaderInteractionOptions,
): void {
	const renderState = options.getRenderState();
	if (!renderState || !isTableColumnColorModeEligible(column)) return;
	const currentMode = resolveEffectiveTableColumnColorMode(column);
	for (const mode of TABLE_COLUMN_COLOR_MENU_MODES) {
		menu.addItem(item => item
			.setTitle(getTableColumnColorModeLabel(mode))
			.setIcon(getTableColumnColorModeIcon(mode))
			.setChecked(currentMode === mode)
			.onClick(() => {
				options.savePreset(setTablePresetColumnColorMode(options.getCurrentPreset(), column.key, mode), 'columns');
			}));
	}
}

function getTableColumnColorModeLabel(mode: TableColumnColorMode): string {
	switch (mode) {
		case 'noColor':
			return t('table', 'colorModeNoColor');
		case 'taskColor':
			return t('table', 'colorModeTaskColor');
		case 'priorityColor':
			return t('table', 'colorModePriorityColor');
		case 'statusColor':
			return t('table', 'colorModeStatusColor');
		case 'randomColors':
			return t('table', 'colorModeRandomColors');
	}
}

function getTableColumnColorModeIcon(mode: TableColumnColorMode): string {
	switch (mode) {
		case 'noColor':
			return 'ban';
		case 'taskColor':
			return 'palette';
		case 'priorityColor':
			return 'flag';
		case 'statusColor':
			return 'workflow';
		case 'randomColors':
			return 'shuffle';
	}
}

function showTableAddColumnPicker(
	position: { x: number; y: number },
	anchorColumn: TableColumn,
	side: 'left' | 'right',
	options: TableHeaderInteractionOptions,
): void {
	const renderState = options.getRenderState();
	if (!renderState) return;
	const fields = getAvailableTableColumnAddFields(renderState);
	options.closeActivePicker();
	const anchor = createHeaderPositionAnchor(position, options.root);
	let closePicker: (() => void) | null = null;
	closePicker = showSearchableFieldPicker(anchor, {
		value: null,
		fields: buildTableFieldPickerOptions(fields),
		placeholder: t('table', 'fieldPickerSearchPlaceholder'),
		ariaLabel: t('table', side === 'left' ? 'addColumnLeft' : 'addColumnRight'),
		noMatchesText: fields.length === 0 ? t('table', 'noColumnsAvailable') : t('table', 'fieldPickerNoMatches'),
		onSelect: option => {
			if (!option.field) return;
			options.savePreset(insertTablePresetColumnNear(
				options.getCurrentPreset(),
				option.field,
				anchorColumn.key,
				side,
				renderState.settings,
				option.tableField,
			), 'columns');
		},
		onClose: () => {
			if (closePicker && options.getActivePickerClose() === closePicker) {
				options.setActivePickerClose(null);
			}
		},
		variantClassName: 'operon-table-field-picker',
		getSearchText: option => `${option.label} ${option.field} ${option.type} ${option.tableField?.aliases.join(' ') ?? ''}`,
		...options.floatingHostOptions,
		matchWidth: 320,
		repositionOnWindowResize: true,
		repositionOnScroll: true,
	});
	options.setActivePickerClose(closePicker);
}

function createHeaderPositionAnchor(position: { x: number; y: number }, root: HTMLElement): DOMRect {
	const DOMRectCtor = root.ownerDocument.defaultView?.DOMRect ?? DOMRect;
	return new DOMRectCtor(position.x, position.y, 1, 1);
}

function getAvailableTableColumnAddFields(renderState: TableHeaderRenderState): TableTaskField[] {
	const excludedKeys = new Set(renderState.preset.columns
		.filter(column => !column.hidden || isTableFilePropertyColumnKey(column.key))
		.map(column => column.key));
	const normalizedPreset = normalizeTablePresetForColumnUi(renderState.preset);
	const allowSource = normalizedPreset.display.showSource !== false;
	return buildEffectiveTableTaskFieldCatalog(renderState.settings, renderState.additionalFields ?? [])
		.filter(field => !excludedKeys.has(field.key) && (allowSource || field.key !== 'source'));
}

function canHideTableColumn(key: string, renderState: TableHeaderRenderState | null): boolean {
	if (!renderState) return false;
	return renderState.taskColumns.length > 1 && renderState.taskColumns.some(column => column.key === key);
}

function getConfiguredSummaryFunction(
	columnKey: string,
	renderState: TableHeaderRenderState,
): TableSummaryFunction | null {
	return renderState.preset.summaries.find(rule => rule.key === columnKey)?.function ?? null;
}

function cycleHeaderSort(columnKey: string, options: TableHeaderInteractionOptions): void {
	options.savePreset(cycleTablePresetPrimarySort(options.getCurrentPreset(), columnKey), 'sortRules');
}

function startTableColumnResize(event: PointerEvent, columnKey: string, options: TableHeaderInteractionOptions): void {
	event.preventDefault();
	event.stopPropagation();
	options.closeActivePicker();
	cleanupTableHeaderActiveResize(options.state);
	const renderState = options.getRenderState();
	if (!renderState) return;
	const column = renderState.columns.find(entry => entry.key === columnKey);
	if (!column) return;
	if (shouldUseIconOnlyColumn(column, renderState.settings, renderState.additionalFields)) return;
	const ownerDocument = getOwnerDocument(event.currentTarget as Node | null);
	const startX = event.clientX;
	const pointerId = event.pointerId;
	const startWidth = resolveTableColumnWidth(column);
	const configuredStartWidth = column.widthPx;
	let latestWidth = startWidth;
	let dragging = false;
	const applyWidth = (widthPx: number): void => {
		latestWidth = normalizeTableColumnWidth(widthPx);
		column.widthPx = latestWidth;
		options.applyColumnTemplate(renderState.columns);
	};
	let cleanup = (): void => {};
	const handlePointerMove = (moveEvent: PointerEvent): void => {
		if (moveEvent.pointerId !== pointerId) return;
		const deltaX = moveEvent.clientX - startX;
		if (!dragging && Math.abs(deltaX) < TABLE_COLUMN_RESIZE_DRAG_THRESHOLD_PX) return;
		dragging = true;
		applyWidth(startWidth + deltaX);
	};
	const handlePointerUp = (upEvent: PointerEvent): void => {
		if (upEvent.pointerId !== pointerId) return;
		cleanup();
		if (dragging && latestWidth !== startWidth) {
			options.savePreset(resizeTablePresetColumn(options.getCurrentPreset(), columnKey, latestWidth), 'columns');
		}
	};
	const handlePointerCancel = (cancelEvent: PointerEvent): void => {
		if (cancelEvent.pointerId !== pointerId) return;
		if (dragging) {
			if (configuredStartWidth === undefined) {
				delete column.widthPx;
			} else {
				column.widthPx = configuredStartWidth;
			}
			options.applyColumnTemplate(renderState.columns);
		}
		cleanup();
	};
	cleanup = (): void => {
		ownerDocument.removeEventListener('pointermove', handlePointerMove);
		ownerDocument.removeEventListener('pointerup', handlePointerUp);
		ownerDocument.removeEventListener('pointercancel', handlePointerCancel);
		if (options.state.activeResizeCleanup === cleanup) {
			options.state.activeResizeCleanup = null;
		}
	};
	ownerDocument.addEventListener('pointermove', handlePointerMove);
	ownerDocument.addEventListener('pointerup', handlePointerUp);
	ownerDocument.addEventListener('pointercancel', handlePointerCancel);
	options.state.activeResizeCleanup = cleanup;
}

function applyRenderedColumnGeometry(root: HTMLElement, columnGeometry: TableColumnGeometry): void {
	for (const node of Array.from(root.querySelectorAll('.operon-table-header, .operon-table-row, .operon-table-summary-row'))) {
		if (!isHTMLElement(node, root)) continue;
		for (const [index, child] of Array.from(node.children).entries()) {
			if (!isHTMLElement(child, root)) continue;
			applyTableColumnGeometryClass(child, columnGeometry.entries[index]);
		}
	}
}
