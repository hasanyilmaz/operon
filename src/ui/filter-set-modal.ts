/**
 * FilterSetModal — create/edit a named filter set.
 * Opened from the Filters settings tab.
 */

import { App, Modal, Notice, TFolder, setIcon } from 'obsidian';
import { DEFAULT_SETTINGS, FilterSet, FilterSetCondition, FilterFieldType, FilterGroup, FilterGroupLogic, FilterNode, FilterSortSpec, KeyMapping, OperonSettings } from '../types/settings';
import {
	evaluateFilterSet,
	evaluateFilterSetGrouped,
	getFilterSortSpecs,
	getOperatorsForField,
	NO_VALUE_OPERATORS,
	NUMERIC_INPUT_DATE_OPERATORS,
	prepareTaskSortContext,
} from '../core/filter-evaluator';
import { getConfiguredKeyMappingIcon } from '../core/key-mapping-icons';
import { PinnedCache } from '../storage/pinned-cache';
import { buildFilterTaskRowElement, FilterTaskRowCallbacks, shouldAutoExpandFilterTaskSubtasks } from './filter-task-row';
import { t } from '../core/i18n';
import { OperonIndexer } from '../indexer/indexer';
import { createProjectSerialScopeFilterResolver, PROJECT_SERIAL_SCOPE_FILTER_FIELD, type ProjectSerialDisplay } from '../core/project-serials';
import { PriorityDefinition } from '../types/priority';
import { Pipeline } from '../types/pipeline';
import type { ContextualMenuActionHandler } from '../core/contextual-menu-engine';
import { bindOperonHoverTooltip } from './operon-hover-tooltip';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { WindowTimeoutHandle, clearWindowTimeout, createOwnerElement, getActiveWindow, getOwnerBody, getOwnerWindow, setWindowTimeout } from '../core/dom-compat';
import { buildTaskWikilinkOverlaySettingsSignature } from './task-wikilink-overlay-chips';
import { buildTaskStatusIconRenderSettingsSignature } from './task-status-icon-signature';
import { buildWorkflowStatusSemanticsSignature } from '../core/workflow-status-semantics';
import { buildWorkflowStatusOrderSignature } from '../core/workflow-status-order';
import { buildWorkflowStatusIdentityIndex } from '../core/workflow-status-identity';
import { openSettingsIconPickerModal } from './settings/settings-icon-picker-modal';
import { normalizeTaskIconValue } from '../core/task-icon-value';
import {
	DYNAMIC_FILE_TASK_FILTER_DEFAULT_ICON,
	DYNAMIC_SUBTASKS_FILTER_DEFAULT_ICON,
	isDynamicFileTaskFilterSet,
	isDynamicSubtasksFilterSet,
	isSpecialDynamicFilterSet,
} from '../core/dynamic-file-task-filter';
import { showOperonDayPickerPopover } from './field-pickers/day-picker-popover';
import { showDatetimePicker } from './field-pickers/datetime-picker';
import { closeFloatingPanelsForRoot, isFloatingPanelTargetForRoot } from './field-pickers/common';
import { showFilterConditionPicker } from './field-pickers/filter-condition-picker';
import { showSearchableMultiOptionPicker, type SearchableMultiOption } from './field-pickers/list-picker';
import { showSearchableFieldPicker, type SearchableFieldPickerOption } from './field-pickers/searchable-field-picker';
import { getManagedCustomFieldOptions } from '../core/managed-task-fields';
import { CANONICAL_KEY_MAP } from '../types/keys';
import { isPresetFavorite } from '../core/preset-favorites';
import { createPresetFavoriteButton } from './preset-favorite-button';
import { runSettingsAsync } from './settings/async-settings-action';
import { openSettingsMultiOptionPickerModal, openSettingsOptionPickerModal } from './settings/settings-option-picker-modal';
import {
	decodeFilePropertyColumnKey,
	isFilePropertyColumnKey,
} from '../core/raw-yaml-property';
import { parseLocalTimestamp } from '../core/local-time';
import type { IndexedTask } from '../types/fields';
import type { TableFilePropertyField, TableFilePropertySnapshot } from './table/table-file-property';
import { getFilterGroupDisplayLabel } from './filter-group-label';
import { cleanupOperonRenderRoot } from './render-root-cleanup';

function generateConditionId(): string {
	return 'cond_' + Math.random().toString(36).slice(2, 10);
}

function generateGroupId(): string {
	return 'grp_' + Math.random().toString(36).slice(2, 10);
}

let filterValueCandidateListInstanceId = 0;

export function bindSettingsModalPickerTrigger(element: HTMLElement, openPicker: () => void): void {
	element.addEventListener('pointerdown', event => {
		event.preventDefault();
		event.stopPropagation();
		openPicker();
	});
	element.addEventListener('click', event => {
		event.preventDefault();
		event.stopPropagation();
		if (event.detail === 0) openPicker();
	});
}

function isFilterGroupNode(node: FilterNode): node is FilterGroup {
	return 'children' in node;
}

const CANONICAL_FILTER_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

function normalizeFilterDateInput(value: string | null | undefined): string | null {
	const trimmed = value?.trim() ?? '';
	const match = CANONICAL_FILTER_DATE_PATTERN.exec(trimmed);
	if (!match) return null;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const date = new Date(year, month - 1, day);
	if (
		date.getFullYear() !== year
		|| date.getMonth() !== month - 1
		|| date.getDate() !== day
	) {
		return null;
	}
	return trimmed;
}

interface SelectOption {
	value: string;
	label: string;
}

type FilterFieldPickerGroup =
	| 'task'
	| 'workflow'
	| 'scheduling'
	| 'dependencies'
	| 'custom'
	| 'fileProperty'
	| 'source'
	| 'special';

interface FilterFieldPickerOption extends SearchableFieldPickerOption {
	field: string;
	label: string;
	type: FilterFieldType;
	icon?: string | null;
	group: FilterFieldPickerGroup | null;
	groupLabel: string | null;
	groupOrder: number;
	searchText?: string;
	propertyName?: string;
	sourceType?: TableFilePropertyField['sourceType'];
	unavailable?: boolean;
	typeDriftFrom?: FilterFieldType;
}

const FILTER_FIELD_GROUP_ORDER: FilterFieldPickerGroup[] = [
	'task',
	'workflow',
	'scheduling',
	'dependencies',
	'custom',
	'fileProperty',
	'source',
	'special',
];

const FILTER_FIELD_GROUP_ORDER_INDEX = new Map<FilterFieldPickerGroup, number>(
	FILTER_FIELD_GROUP_ORDER.map((group, index) => [group, index]),
);

function buildFilterFieldPickerOption(
	field: string,
	label: string,
	type: FilterFieldType,
	group: FilterFieldPickerGroup,
	icon?: string | null,
): FilterFieldPickerOption {
	return {
		field,
		label,
		type,
		icon,
		group,
		groupLabel: getFilterFieldGroupLabel(group),
		groupOrder: getFilterFieldGroupOrder(group),
	};
}

function compareFilterFieldPickerOptions(left: FilterFieldPickerOption, right: FilterFieldPickerOption): number {
	if (left.groupOrder !== right.groupOrder) return left.groupOrder - right.groupOrder;
	const labelCompare = left.label.localeCompare(right.label, undefined, { sensitivity: 'base' });
	if (labelCompare !== 0) return labelCompare;
	return left.field.localeCompare(right.field, undefined, { sensitivity: 'base' });
}

function resolveFilterFieldGroupForMapping(mapping: KeyMapping): FilterFieldPickerGroup {
	const canonical = CANONICAL_KEY_MAP.get(mapping.canonicalKey);
	if (!canonical) return 'custom';
	switch (canonical.group) {
		case 'workflow':
			return 'workflow';
		case 'scheduling':
			return 'scheduling';
		case 'dependencies':
			return 'dependencies';
		case 'core':
		default:
			return 'task';
	}
}

function getFilterFieldGroupOrder(group: FilterFieldPickerGroup): number {
	return FILTER_FIELD_GROUP_ORDER_INDEX.get(group) ?? Number.MAX_SAFE_INTEGER;
}

function getFilterFieldGroupLabel(group: FilterFieldPickerGroup): string {
	return t('filterSets', `fieldGroup${capitalizeFilterFieldGroup(group)}`);
}

function capitalizeFilterFieldGroup(group: FilterFieldPickerGroup): string {
	return group.charAt(0).toUpperCase() + group.slice(1);
}

function getFilterFieldTypeIcon(type: FilterFieldType): string {
	switch (type) {
		case 'number':
			return 'hash';
		case 'date':
		case 'datetime':
			return 'calendar';
		case 'checkbox':
			return 'square-check-big';
		case 'tags':
			return 'hash';
		case 'pinned':
			return 'pin';
		case 'projectTree':
			return 'git-branch';
		case 'folders':
			return 'folder';
		case 'projectSerialScope':
			return 'git-branch';
		case 'list':
			return 'list';
		case 'text':
		default:
			return 'text';
	}
}

export interface FilterModalEvalDeps {
	indexer: OperonIndexer;
	getFilePropertySnapshot?: (tasks: readonly IndexedTask[]) => TableFilePropertySnapshot | null;
	getPipelines: () => Pipeline[];
	getPriorities: () => PriorityDefinition[];
	openEditor: (operonId: string) => void;
	cycleStatus: (operonId: string) => void;
	getChildIds: (parentId: string) => string[];
	navigateToTask: (task: import('../types/fields').IndexedTask) => void;
	getSettings: () => import('../types/settings').OperonSettings;
	updateField: (operonId: string, key: string, value: string) => void | boolean | Promise<void | boolean>;
	updateFields?: (operonId: string, payload: Record<string, string>) => void | boolean | Promise<void | boolean>;
	updateSubtasks?: (operonId: string, subtaskIds: string[]) => void;
	updateDependencyField?: (operonId: string, field: 'blocking' | 'blockedBy', value: string) => void;
	onContextualAction?: ContextualMenuActionHandler;
	pinnedCache?: PinnedCache;
	isTaskTracking?: (taskId: string) => boolean;
	toggleTimer?: (taskId: string) => void | Promise<void>;
	getTrackingSignature?: () => string;
	getProjectSerialDisplay?: (operonId: string) => ProjectSerialDisplay | null;
	getProjectSerialSignature?: () => string;
}

export interface FilterSetModalOptions {
	title?: string;
	lockName?: boolean;
	lockConditions?: 'dynamicFileTask' | 'dynamicSubtasks';
	hideUsageInfo?: boolean;
	showCountBadge?: boolean;
	quickActions?: FilterSetModalQuickActions;
	getSettings?: () => OperonSettings;
	getProjectSerialScopeTasks?: () => readonly IndexedTask[];
	getFilePropertySnapshot?: (tasks: readonly IndexedTask[]) => TableFilePropertySnapshot | null;
	getFilePropertyDiscoveryTasks?: () => readonly IndexedTask[];
	onToggleFavorite?: (filterSetId: string) => Promise<void>;
	pickerPresentation?: 'floating' | 'modal';
}

export interface FilterSetModalQuickActions {
	copyEmbedCode?: () => void | Promise<void>;
	duplicate?: () => void | Promise<void>;
	remove?: () => void | Promise<void>;
}

export interface FilterSetInlineEditorOptions {
	onCancel: () => void;
	onSave: (updated: FilterSet) => void;
	countTasks?: (filterSet: FilterSet) => number;
	saveTooltip?: {
		title: string;
		content: string;
	};
}

const activeFilterPreviewModals = new Set<FilterPreviewModal>();
const activeFilterSetModals = new Set<FilterSetModal>();

export function refreshFilterPreviewModals(): void {
	for (const modal of activeFilterPreviewModals) {
		if (!modal.modalEl.isConnected) {
			activeFilterPreviewModals.delete(modal);
			continue;
		}
		modal.refresh();
	}
}

export function refreshFilterSetModals(): void {
	for (const modal of activeFilterSetModals) {
		if (!modal.hasConnectedSurface()) {
			activeFilterSetModals.delete(modal);
			continue;
		}
		modal.refreshExternalState();
	}
}

export class FilterSetModal extends Modal {
	private filterSet: FilterSet;
	private keyMappings: KeyMapping[];
	private onSave: (updated: FilterSet) => void;
		private evalDeps: FilterModalEvalDeps | null;
		private options: FilterSetModalOptions;
		private countBadge: HTMLElement | null = null;
		private condObserver: MutationObserver | null = null;
		private refreshCountBadge: (() => void) | null = null;
		private bodyDropdowns: HTMLElement[] = [];
		private inlineEditor: { container: HTMLElement; options: FilterSetInlineEditorOptions } | null = null;
		private collapsedFilterGroupIds = new Set<string>();
		private filePropertySnapshot: TableFilePropertySnapshot | null = null;
		private invalidRawConditionIds = new Set<string>();

	constructor(
		app: App,
		filterSet: FilterSet,
		keyMappings: KeyMapping[],
		onSave: (updated: FilterSet) => void,
		evalDeps?: FilterModalEvalDeps,
		options: FilterSetModalOptions = {},
	) {
		super(app);
		this.filterSet = filterSet;
		this.keyMappings = keyMappings;
		this.onSave = onSave;
		this.evalDeps = evalDeps ?? null;
		this.options = options;
	}

	onOpen(): void {
		this.inlineEditor = null;
		activeFilterSetModals.add(this);
		this.renderModal();
	}

	onClose(): void {
		activeFilterSetModals.delete(this);
		this.condObserver?.disconnect();
		this.refreshCountBadge = null;
		closeFloatingPanelsForRoot(this.modalEl);
		this.cleanupBodyDropdowns();
		this.contentEl.empty();
	}

	renderInlineConditionEditor(container: HTMLElement, options: FilterSetInlineEditorOptions): void {
		this.inlineEditor = { container, options };
		activeFilterSetModals.add(this);
		this.renderInlineConditionEditorSurface();
	}

	destroyInlineConditionEditor(): void {
		if (!this.inlineEditor) return;
		this.condObserver?.disconnect();
		this.refreshCountBadge = null;
		closeFloatingPanelsForRoot(this.inlineEditor.container);
		this.cleanupBodyDropdowns();
		this.inlineEditor = null;
		activeFilterSetModals.delete(this);
	}

	hasConnectedSurface(): boolean {
		return this.inlineEditor?.container.isConnected ?? this.modalEl.isConnected;
	}

	isInlineEditorTarget(target: EventTarget | null): boolean {
		const inlineEditor = this.inlineEditor;
		if (!inlineEditor) return false;
		if (!target || typeof (target as Node).nodeType !== 'number') return false;
		const targetNode = target as Node;
		return inlineEditor.container.contains(targetNode)
			|| isFloatingPanelTargetForRoot(inlineEditor.container, targetNode)
			|| this.bodyDropdowns.some(dropdown => dropdown.contains(targetNode));
	}

	isInlineEditorFloatingTarget(target: EventTarget | null): boolean {
		const inlineEditor = this.inlineEditor;
		if (!inlineEditor) return false;
		if (!target || typeof (target as Node).nodeType !== 'number') return false;
		const targetNode = target as Node;
		return isFloatingPanelTargetForRoot(inlineEditor.container, targetNode)
			|| this.bodyDropdowns.some(dropdown => dropdown.contains(targetNode));
	}

	private renderModal(): void {
		const { contentEl } = this;
		this.condObserver?.disconnect();
		this.refreshCountBadge = null;
		closeFloatingPanelsForRoot(contentEl);
		this.cleanupBodyDropdowns();
		this.modalEl.addClass('operon-filter-set-modal-shell');
		contentEl.empty();
		contentEl.addClass('operon-filter-set-modal');

		contentEl.createEl('h3', { cls: 'operon-filter-modal-title', text: this.options.title ?? t('filterSets', 'editFilter') });

		this.ensureModernSchema();
		this.filePropertySnapshot = this.resolveFilePropertySnapshot();
		this.renderNameField(contentEl);
		this.renderConditions(contentEl);
		this.renderSort(contentEl);
		this.renderUsageInfo(contentEl);
		this.renderButtons(contentEl);
	}

	private renderInlineConditionEditorSurface(): void {
		const inlineEditor = this.inlineEditor;
		if (!inlineEditor) return;
		const { container } = inlineEditor;
		this.condObserver?.disconnect();
		this.refreshCountBadge = null;
		closeFloatingPanelsForRoot(container);
		this.cleanupBodyDropdowns();
		container.empty();
		container.addClass('operon-filter-set-modal');
		container.addClass('operon-filter-inline-editor');

		this.ensureModernSchema();
		this.filePropertySnapshot = this.resolveFilePropertySnapshot();
		this.renderNameField(container);
		this.renderConditions(container);
		this.renderButtons(container);
	}

	private renderCurrentSurface(): void {
		if (this.inlineEditor) {
			this.renderInlineConditionEditorSurface();
			return;
		}
		this.renderModal();
	}

	private ensureModernSchema(): void {
		if (!this.filterSet.rootGroup) {
			this.filterSet.rootGroup = {
				id: generateGroupId(),
				logic: this.filterSet.matchLogic ?? 'all',
				children: (this.filterSet.conditions ?? []).map(condition => ({ ...condition })),
			};
		}
		if (!Array.isArray(this.filterSet.sorts)) {
			this.filterSet.sorts = this.filterSet.sortBy
				? [{ field: this.filterSet.sortBy, order: this.filterSet.sortOrder ?? 'asc' }]
				: [];
		}
		this.syncMirroredFilterFields();
	}

	private syncMirroredFilterFields(): void {
		this.filterSet.matchLogic = this.filterSet.rootGroup.logic;
		this.filterSet.conditions = this.flattenConditions(this.filterSet.rootGroup);
		this.filterSet.subgroupBy = this.filterSet.subgroupBy && this.filterSet.subgroupBy !== this.filterSet.groupBy
			? this.filterSet.subgroupBy
			: undefined;
		this.filterSet.subgroupOrder = this.filterSet.subgroupBy ? (this.filterSet.subgroupOrder ?? 'asc') : undefined;

		const primarySort = this.filterSet.sorts[0];
		this.filterSet.sortBy = primarySort?.field;
		this.filterSet.sortOrder = primarySort?.order;
		this.refreshCountBadge?.();
	}

	private flattenConditions(group: FilterGroup): FilterSetCondition[] {
		const conditions: FilterSetCondition[] = [];
		for (const child of group.children) {
			if (isFilterGroupNode(child)) {
				conditions.push(...this.flattenConditions(child));
			} else {
				conditions.push({ ...child });
			}
		}
		return conditions;
	}

	private countConditions(group: FilterGroup): number {
		return this.flattenConditions(group).length;
	}

	private countDirectConditionChildren(group: FilterGroup): number {
		return group.children.filter(child => !isFilterGroupNode(child)).length;
	}

	private countDirectGroupChildren(group: FilterGroup): number {
		return group.children.filter(isFilterGroupNode).length;
	}

	private buildFilterGroupNumberMap(rootGroup: FilterGroup): WeakMap<FilterGroup, number> {
		const groupNumbers = new WeakMap<FilterGroup, number>();
		let next = 1;
		const visit = (group: FilterGroup): void => {
			for (const child of group.children) {
				if (!isFilterGroupNode(child)) continue;
				groupNumbers.set(child, next++);
				visit(child);
			}
		};
		visit(rootGroup);
		return groupNumbers;
	}

	private addClasses(el: HTMLElement, ...classNames: string[]): void {
		for (const className of classNames) el.addClass(className);
	}

	private createModalSelect(
		container: HTMLElement,
		options: SelectOption[],
		value: string,
		onChange: (value: string) => void,
		variant: 'fluid' | 'order' | 'content' = 'fluid',
	): HTMLSelectElement {
		const wrap = container.createDiv('operon-filter-select-wrap');
		wrap.addClass(variant === 'order' ? 'is-order' : variant === 'content' ? 'is-content' : 'is-fluid');
		const select = wrap.createEl('select', { cls: 'operon-filter-select dropdown' });
		for (const option of options) {
			select.createEl('option', { value: option.value, text: option.label });
		}
		select.value = value;
		const chevron = wrap.createSpan('operon-filter-select-chevron');
		setIcon(chevron, 'chevron-down');
		select.addEventListener('change', () => onChange(select.value));
		if (this.options.pickerPresentation === 'modal') {
			bindSettingsModalPickerTrigger(select, () => {
				const currentOptions = Array.from(select.options).map(option => ({
					value: option.value,
					label: option.text,
				}));
				const selectedLabel = currentOptions.find(option => option.value === select.value)?.label
					?? currentOptions[0]?.label
					?? t('filterSets', 'conditionFieldPickerLabel');
				openSettingsOptionPickerModal(this.app, {
					title: selectedLabel,
					value: select.value,
					options: currentOptions,
					placeholder: t('filterSets', 'conditionFieldSearchPlaceholder'),
					ariaLabel: selectedLabel,
					noMatchesText: t('filterSets', 'conditionFieldNoMatches'),
					onSelect: option => {
						select.value = option.value;
						onChange(option.value);
					},
				});
			});
		}
		return select;
	}

	private createDirectionToggle(
		container: HTMLElement,
		value: FilterSortSpec['order'],
		onChange: (value: FilterSortSpec['order']) => void,
		accessibleLabel: string,
	): HTMLButtonElement {
		const wrap = container.createDiv('operon-filter-select-wrap is-order');
		const button = wrap.createEl('button', {
			cls: 'operon-filter-direction-toggle',
			attr: { type: 'button' },
		});
		let currentValue = value;
		const renderValue = (): void => {
			const valueLabel = currentValue === 'desc'
				? t('filterSets', 'sortDesc')
				: t('filterSets', 'sortAsc');
			button.setText(valueLabel);
			setAccessibleLabelWithoutTooltip(button, `${accessibleLabel}: ${valueLabel}`);
		};
		button.addEventListener('click', event => {
			event.preventDefault();
			currentValue = currentValue === 'asc' ? 'desc' : 'asc';
			renderValue();
			onChange(currentValue);
		});
		renderValue();
		return button;
	}

	private createModalFieldPicker(
		container: HTMLElement,
		fields: readonly FilterFieldPickerOption[],
		value: string,
		onChange: (value: string) => void,
		options: {
			label: string;
			placeholder?: string;
			variant?: 'fluid' | 'content';
		},
	): HTMLButtonElement {
		const wrap = container.createDiv('operon-filter-select-wrap operon-filter-field-picker-wrap');
		wrap.addClass(options.variant === 'content' ? 'is-content' : 'is-fluid');
		const button = wrap.createEl('button', {
			cls: 'operon-filter-select operon-field-picker-trigger operon-filter-field-picker-trigger',
			attr: {
				type: 'button',
				'aria-haspopup': 'listbox',
				'aria-expanded': 'false',
			},
		});
		const labelEl = button.createSpan('operon-field-picker-trigger-label');
		const secondaryEl = button.createSpan('operon-field-picker-trigger-secondary');
		const iconEl = button.createSpan('operon-field-picker-trigger-icon');
		setIcon(iconEl, 'chevron-down');
		let currentValue = value;

		const updateButton = (nextValue: string): void => {
			currentValue = nextValue;
			const selected = fields.find(field => field.field === nextValue);
			const label = selected?.label ?? options.placeholder ?? nextValue;
			labelEl.textContent = label;
			secondaryEl.textContent = selected?.secondaryLabel ?? '';
			secondaryEl.toggleClass('is-hidden', !selected?.secondaryLabel);
			button.dataset.value = nextValue;
			const detail = selected?.secondaryLabel
				? `${label} — ${selected.secondaryLabel}`
				: selected && selected.label !== selected.field
					? `${selected.label} (${selected.field})`
					: label;
			setAccessibleLabelWithoutTooltip(button, `${options.label}: ${detail}`);
			bindOperonHoverTooltip(button, { content: detail, taskColor: null });
		};
		updateButton(value);

		const openPicker = (): void => {
			if (button.disabled) return;
			const pickerFields = this.getPickerFieldOptions(fields, currentValue);
			if (this.options.pickerPresentation === 'modal') {
				openSettingsOptionPickerModal(this.app, {
					title: options.label,
					value: currentValue,
					options: pickerFields.map(field => ({
						...field,
						value: field.field,
						description: field.secondaryLabel,
					})),
					placeholder: t('filterSets', 'conditionFieldSearchPlaceholder'),
					ariaLabel: options.label,
					noMatchesText: t('filterSets', 'conditionFieldNoMatches'),
					getSearchText: option => option.searchText ?? `${option.label} ${option.description ?? ''} ${option.value}`,
					onSelect: option => {
						onChange(option.field);
						updateButton(option.field);
					},
				});
				return;
			}
			button.setAttribute('aria-expanded', 'true');
			showSearchableFieldPicker(button, {
				value: currentValue,
				getValue: () => currentValue,
				fields: pickerFields,
				placeholder: t('filterSets', 'conditionFieldSearchPlaceholder'),
				ariaLabel: options.label,
				noMatchesText: t('filterSets', 'conditionFieldNoMatches'),
				getSearchText: field => field.searchText ?? `${field.label} ${field.secondaryLabel ?? ''} ${field.field}`,
				onSelect: option => {
					onChange(option.field);
					updateButton(option.field);
				},
				onClose: () => {
					if (button.isConnected) button.setAttribute('aria-expanded', 'false');
				},
				variantClassName: 'operon-filter-field-picker',
				matchWidth: Math.max(button.getBoundingClientRect().width, 280),
				repositionOnScroll: true,
				repositionOnWindowResize: true,
			});
		};
		if (this.options.pickerPresentation === 'modal') {
			bindSettingsModalPickerTrigger(button, openPicker);
		} else {
			button.addEventListener('click', event => {
				event.preventDefault();
				openPicker();
			});
		}

		return button;
	}

	private createModalFormRow(
		container: HTMLElement,
		label: string,
		className?: string,
	): { row: HTMLElement; controlEl: HTMLElement; actionEl: HTMLElement } {
		const row = container.createDiv('operon-filter-form-row');
		if (className) row.addClass(className);
		row.createDiv({ cls: 'operon-filter-form-label', text: label });
		const controlEl = row.createDiv('operon-filter-form-control');
		const actionEl = row.createDiv('operon-filter-form-action');
		return { row, controlEl, actionEl };
	}

	private cleanupBodyDropdowns(): void {
		for (const dropdown of this.bodyDropdowns) dropdown.remove();
		this.bodyDropdowns = [];
	}

	private resolveFilePropertySnapshot(): TableFilePropertySnapshot | null {
		const provider = this.evalDeps?.getFilePropertySnapshot ?? this.options.getFilePropertySnapshot;
		if (!provider) return null;
		const tasks = this.options.getFilePropertyDiscoveryTasks?.()
			?? this.evalDeps?.indexer.getAllTasks()
			?? this.options.getProjectSerialScopeTasks?.()
			?? [];
		return provider(tasks);
	}

	private getReferencedFilePropertyTypes(): Map<string, Set<FilterFieldType>> {
		const referenced = new Map<string, Set<FilterFieldType>>();
		const add = (field: string, type?: FilterFieldType): void => {
			if (!isFilePropertyColumnKey(field)) return;
			const types = referenced.get(field) ?? new Set<FilterFieldType>();
			if (type) types.add(type);
			referenced.set(field, types);
		};
		const visit = (node: FilterNode): void => {
			if (isFilterGroupNode(node)) {
				for (const child of node.children) visit(child);
				return;
			}
			add(node.field, node.fieldType);
		};
		visit(this.filterSet.rootGroup);
		for (const sort of this.filterSet.sorts) add(sort.field);
		if (this.filterSet.groupBy) add(this.filterSet.groupBy);
		if (this.filterSet.subgroupBy) add(this.filterSet.subgroupBy);
		return referenced;
	}

	private getFilePropertyFieldOptions(): FilterFieldPickerOption[] {
		const referenced = this.getReferencedFilePropertyTypes();
		const liveFields = this.filePropertySnapshot?.fields ?? [];
		const liveKeys = new Set(liveFields.map(field => field.key));
		const options = liveFields.map(field => {
			const referencedTypes = [...(referenced.get(field.key) ?? [])];
			const typeDriftFrom = referencedTypes.find(type => type !== field.type);
			return this.buildFilePropertyFieldOption(field, typeDriftFrom);
		});

		for (const [key, types] of referenced) {
			if (liveKeys.has(key)) continue;
			const propertyName = decodeFilePropertyColumnKey(key);
			if (!propertyName) continue;
			const savedType = [...types][0] ?? 'text';
			options.push(this.buildUnavailableFilePropertyFieldOption(key, propertyName, savedType));
		}
		return options;
	}

	private buildFilePropertyFieldOption(
		field: TableFilePropertyField,
		typeDriftFrom?: FilterFieldType,
	): FilterFieldPickerOption {
		const typeLabel = this.getFilePropertyTypeLabel(field.type);
		const secondaryLabel = typeDriftFrom
			? t('filterSets', 'filePropertyTypeChanged', {
				type: typeLabel,
				savedType: this.getFilePropertyTypeLabel(typeDriftFrom),
			})
			: t('filterSets', 'filePropertySourceType', { type: typeLabel });
		return {
			field: field.key,
			label: field.propertyName,
			secondaryLabel,
			type: field.type,
			icon: field.icon,
			group: 'fileProperty',
			groupLabel: getFilterFieldGroupLabel('fileProperty'),
			groupOrder: getFilterFieldGroupOrder('fileProperty'),
			propertyName: field.propertyName,
			sourceType: field.sourceType,
			searchText: [
				field.propertyName,
				field.key,
				`note.${field.propertyName}`,
				field.type,
				field.sourceType,
				...field.aliases,
			].join(' '),
			...(typeDriftFrom ? { typeDriftFrom } : {}),
		};
	}

	private buildUnavailableFilePropertyFieldOption(
		key: string,
		propertyName: string,
		type: FilterFieldType,
	): FilterFieldPickerOption {
		const typeLabel = this.getFilePropertyTypeLabel(type);
		return {
			field: key,
			label: propertyName,
			secondaryLabel: t('filterSets', 'filePropertyUnavailable', { type: typeLabel }),
			type,
			icon: getFilterFieldTypeIcon(type),
			group: 'fileProperty',
			groupLabel: getFilterFieldGroupLabel('fileProperty'),
			groupOrder: getFilterFieldGroupOrder('fileProperty'),
			propertyName,
			sourceType: 'unknown',
			searchText: `${propertyName} ${key} note.${propertyName} ${typeLabel}`,
			unavailable: true,
		};
	}

	private getFilePropertyTypeLabel(type: FilterFieldType): string {
		switch (type) {
			case 'text':
				return t('filterSets', 'filePropertyType_text');
			case 'list':
				return t('filterSets', 'filePropertyType_list');
			case 'number':
				return t('filterSets', 'filePropertyType_number');
			case 'checkbox':
				return t('filterSets', 'filePropertyType_checkbox');
			case 'date':
				return t('filterSets', 'filePropertyType_date');
			case 'datetime':
				return t('filterSets', 'filePropertyType_datetime');
			default:
				return type;
		}
	}

	private getFilePropertyCandidates(field: string): readonly string[] {
		if (!isFilePropertyColumnKey(field)) return [];
		return (this.filePropertySnapshot?.getCandidates(field) ?? []).slice(0, 500);
	}

	private attachFilePropertyCandidateList(
		input: HTMLInputElement,
		container: HTMLElement,
		field: string,
	): void {
		const candidates = this.getFilePropertyCandidates(field);
		if (candidates.length === 0) return;
		filterValueCandidateListInstanceId += 1;
		const listId = `operon-filter-file-property-candidates-${filterValueCandidateListInstanceId}`;
		const list = createOwnerElement(input, 'datalist');
		list.id = listId;
		for (const candidate of candidates) {
			const option = createOwnerElement(list, 'option');
			option.value = candidate;
			list.appendChild(option);
		}
		container.appendChild(list);
		input.setAttribute('list', listId);
		input.setAttribute('autocomplete', 'off');
	}

	private getPickerFieldOptions(
		fields: readonly FilterFieldPickerOption[],
		currentValue: string,
	): FilterFieldPickerOption[] {
		return fields.filter(field => !field.unavailable || field.field === currentValue);
	}

	private getFieldOptions(
		includeConditionOnly = false,
		includeHappensOn = false,
	): FilterFieldPickerOption[] {
		const pseudoFields: FilterFieldPickerOption[] = [
			buildFilterFieldPickerOption('checkbox', t('filterSets', 'fieldCheckbox'), 'checkbox', 'workflow', 'square-check-big'),
			buildFilterFieldPickerOption('tags', t('filterSets', 'fieldTags'), 'tags', 'workflow', 'hash'),
			buildFilterFieldPickerOption('description', t('filterSets', 'fieldDescription'), 'text', 'task', 'list-todo'),
			buildFilterFieldPickerOption('pinned', t('filterSets', 'fieldPinned'), 'pinned', 'workflow', 'pin'),
			buildFilterFieldPickerOption(PROJECT_SERIAL_SCOPE_FILTER_FIELD, t('filterSets', 'fieldProjectSerialGroup'), 'projectSerialScope', 'special', 'git-branch'),
		];
		if (includeConditionOnly || includeHappensOn) {
			pseudoFields.push(buildFilterFieldPickerOption('happensOn', t('filterSets', 'fieldHappensOn'), 'date', 'scheduling', 'calendar'));
		}
		if (includeConditionOnly) {
			pseudoFields.push(buildFilterFieldPickerOption('projectTree', t('filterSets', 'fieldProjectTree'), 'projectTree', 'dependencies', 'git-branch'));
			pseudoFields.push(buildFilterFieldPickerOption('folders', t('filterSets', 'fieldFolders'), 'folders', 'source', 'folder'));
		}

		const builtInMappings = this.keyMappings
			.filter(mapping => mapping.isSystem !== false && !mapping.isInternal)
			.map(mapping => buildFilterFieldPickerOption(
				mapping.canonicalKey,
				mapping.visiblePropertyName,
				mapping.type,
				resolveFilterFieldGroupForMapping(mapping),
				getConfiguredKeyMappingIcon(mapping.canonicalKey, this.keyMappings) || getFilterFieldTypeIcon(mapping.type),
			));
		const customMappings = getManagedCustomFieldOptions(this.keyMappings).map(option => buildFilterFieldPickerOption(
			option.field,
			option.label,
			option.type,
			'custom',
			getConfiguredKeyMappingIcon(option.field, this.keyMappings) || getFilterFieldTypeIcon(option.type),
		));
		const filePropertyFields = this.getFilePropertyFieldOptions();

		return [...pseudoFields, ...builtInMappings, ...customMappings, ...filePropertyFields].sort(compareFilterFieldPickerOptions);
	}

	private getProjectSerialScopeOptions(): SearchableMultiOption[] {
		const settings = this.evalDeps?.getSettings() ?? this.options.getSettings?.() ?? null;
		if (!settings) return [];
		const scopeTasks = this.evalDeps?.indexer.getAllTasks() ?? this.options.getProjectSerialScopeTasks?.() ?? [];
		const tasksById = new Map(scopeTasks.map(task => [task.operonId, task]));
		return settings.projectSerialScopes
			.map(scope => {
				const root = tasksById.get(scope.parentOperonId);
				const rootLabel = root?.description.trim() || scope.parentOperonId;
				return {
					value: scope.id,
					label: `${scope.prefix} — ${rootLabel}`,
					searchText: `${scope.prefix} ${rootLabel} ${scope.parentOperonId}`,
				};
			})
			.sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: 'base' }));
	}

	private measureSelectContentWidth(select: HTMLSelectElement): number {
		const selectedText = select.selectedOptions[0]?.text ?? select.value ?? '';
		return this.measureControlContentWidth(select, selectedText);
	}

	private measureControlContentWidth(control: HTMLElement, text: string): number {
		const style = getOwnerWindow(control).getComputedStyle(control);
		const canvas = createOwnerElement(control, 'canvas');
		const context = canvas.getContext('2d');
		if (!context) return 220;
		context.font = [
			style.fontStyle,
			style.fontVariant,
			style.fontWeight,
			style.fontSize,
			style.fontFamily,
		].filter(Boolean).join(' ');
		const textWidth = context.measureText(text).width;
		return Math.ceil(textWidth + 44);
	}

	private prepareBodyDropdown(dropdown: HTMLElement): void {
		getOwnerBody(dropdown).appendChild(dropdown);
		this.bodyDropdowns.push(dropdown);
	}

	private positionBodyDropdown(dropdown: HTMLElement, anchor: HTMLElement): void {
		const rect = anchor.getBoundingClientRect();
		dropdown.style.left = `${rect.left}px`;
		dropdown.style.top = `${rect.bottom + 4}px`;
		dropdown.style.width = `${rect.width}px`;
	}

	private getFolderSuggestions(query: string): TFolder[] {
		const normalizedQuery = query.trim().toLowerCase().replace(/\\/g, '/');
		const folders: TFolder[] = [];
		for (const file of this.app.vault.getAllLoadedFiles()) {
			if (!(file instanceof TFolder) || file.path === '/') continue;
			if (!normalizedQuery || file.path.toLowerCase().includes(normalizedQuery)) {
				folders.push(file);
			}
		}
		folders.sort((a, b) => a.path.localeCompare(b.path));
		return folders.slice(0, 24);
	}

	private attachFolderSuggest(inputEl: HTMLInputElement, cond: FilterSetCondition): void {
		const dropdown = createOwnerElement(inputEl, 'div');
		dropdown.className = 'operon-filter-folder-dropdown';
		this.prepareBodyDropdown(dropdown);

		let matches: TFolder[] = [];
		let activeIndex = 0;

			const selectFolder = (folder: TFolder) => {
				cond.value = folder.path;
				inputEl.value = folder.path;
				dropdown.removeClass('is-open');
				this.syncMirroredFilterFields();
			};

		const renderDropdown = () => {
				dropdown.empty();
				if (matches.length === 0) {
					dropdown.removeClass('is-open');
					return;
				}

				matches.forEach((folder, index) => {
					const item = dropdown.createDiv('operon-filter-folder-dropdown-item');
					item.toggleClass('is-active', index === activeIndex);
					item.toggleClass('is-last', index >= matches.length - 1);
					item.setText(folder.path);
				item.addEventListener('mousemove', () => {
					if (activeIndex === index) return;
					activeIndex = index;
					renderDropdown();
				});
				item.addEventListener('mousedown', (evt) => {
					evt.preventDefault();
					selectFolder(folder);
				});
			});

				this.positionBodyDropdown(dropdown, inputEl);
				dropdown.addClass('is-open');
			};

		const refreshSuggestions = () => {
			matches = this.getFolderSuggestions(inputEl.value);
			activeIndex = 0;
			renderDropdown();
		};

		inputEl.addEventListener('focus', refreshSuggestions);
		inputEl.addEventListener('click', refreshSuggestions);
			inputEl.addEventListener('input', refreshSuggestions);
			inputEl.addEventListener('blur', () => {
				window.setTimeout(() => { dropdown.removeClass('is-open'); }, 150);
			});
			inputEl.addEventListener('keydown', (evt) => {
				const isOpen = dropdown.hasClass('is-open');
				if (evt.key === 'Escape') {
					dropdown.removeClass('is-open');
					return;
				}
			if (!isOpen || matches.length === 0) return;
			if (evt.key === 'ArrowDown') {
				evt.preventDefault();
				activeIndex = Math.min(activeIndex + 1, matches.length - 1);
				renderDropdown();
			} else if (evt.key === 'ArrowUp') {
				evt.preventDefault();
				activeIndex = Math.max(activeIndex - 1, 0);
				renderDropdown();
			} else if (evt.key === 'Enter') {
				evt.preventDefault();
				const folder = matches[activeIndex];
				if (folder) selectFolder(folder);
			}
		});
	}

	private getPickerSettings(): OperonSettings {
		return this.evalDeps?.getSettings() ?? this.options.getSettings?.() ?? DEFAULT_SETTINGS;
	}

	private openDateConditionPopover(inputEl: HTMLInputElement, cond: FilterSetCondition): void {
		if (inputEl.dataset.operonDayPickerState === 'open') return;

		const settings = this.getPickerSettings();
		inputEl.dataset.operonDayPickerState = 'open';
		showOperonDayPickerPopover(inputEl, {
			app: this.app,
			value: normalizeFilterDateInput(cond.value ?? inputEl.value) ?? undefined,
			weekStart: settings.calendarWeekStart,
			showWeekNumbers: settings.calendarSidebarShowWeekNumbers,
			canClear: !!cond.value,
			onSelect: value => {
				cond.value = value;
				inputEl.value = value;
			},
			onClear: () => {
				cond.value = undefined;
				inputEl.value = '';
			},
			onClose: () => {
				delete inputEl.dataset.operonDayPickerState;
			},
		});
	}

	private openDatetimeConditionPopover(inputEl: HTMLInputElement, cond: FilterSetCondition): void {
		if (inputEl.dataset.operonDatetimePickerState === 'open') return;

		const settings = this.getPickerSettings();
		inputEl.dataset.operonDatetimePickerState = 'open';
		showDatetimePicker(inputEl, {
			app: this.app,
			settings: {
				timeFormat: settings.timeFormat,
				calendarWeekStart: settings.calendarWeekStart,
				calendarSidebarShowWeekNumbers: settings.calendarSidebarShowWeekNumbers,
			},
			fieldKey: cond.field,
			value: cond.value ?? inputEl.value,
			canRemove: !!cond.value,
			onSelect: value => {
				cond.value = value;
				inputEl.value = value;
			},
			onRemove: () => {
				cond.value = undefined;
				inputEl.value = '';
			},
			onClose: () => {
				delete inputEl.dataset.operonDatetimePickerState;
			},
		});
	}

	private buildLogicSelector(
		container: HTMLElement,
		value: FilterGroupLogic,
		onChange: (value: FilterGroupLogic) => void,
	): void {
		const options: Array<{ id: FilterGroupLogic; label: string }> = [
			{ id: 'all', label: t('filterSets', 'matchAll') },
			{ id: 'any', label: t('filterSets', 'matchAny') },
			{ id: 'none', label: t('filterSets', 'matchNone') },
		];

		const buttons = new Map<FilterGroupLogic, HTMLButtonElement>();
		const updateButtons = () => {
			for (const [id, button] of buttons) {
				const active = id === value;
				button.toggleClass('is-active', active);
			}
		};

		for (const option of options) {
			const button = container.createEl('button');
			button.type = 'button';
			this.addClasses(button, 'operon-filter-modal-button', 'operon-filter-modal-logic-button');
			button.setText(option.label);
			button.addEventListener('click', () => {
				value = option.id;
				onChange(option.id);
				updateButtons();
			});
			buttons.set(option.id, button);
		}

		updateButtons();
	}

	// --------------------------------------------------------
	// Name field
	// --------------------------------------------------------

	private renderNameField(container: HTMLElement): void {
		const section = container.createDiv('operon-filter-form-section operon-filter-name-section');
		const { controlEl, actionEl } = this.createModalFormRow(section, t('filterSets', 'filterName'), 'operon-filter-name-row');
		const input = controlEl.createEl('input', {
			cls: 'operon-filter-name-input',
			attr: {
				type: 'text',
				placeholder: t('filterSets', 'filterNamePlaceholder'),
			},
		});
		input.value = this.filterSet.name;
		input.disabled = this.options.lockName === true;
		if (!this.options.lockName) {
			input.addEventListener('input', () => { this.filterSet.name = input.value; });
			getActiveWindow().setTimeout(() => input.focus(), 50);
		}

		const iconBtn = actionEl.createEl('button');
		iconBtn.type = 'button';
		iconBtn.addClass('operon-filter-set-icon-trigger');
		bindOperonHoverTooltip(iconBtn, { content: t('filterSets', 'filterIcon'), taskColor: null });
		const getFallbackIcon = (): string => {
			if (isDynamicFileTaskFilterSet(this.filterSet)) return DYNAMIC_FILE_TASK_FILTER_DEFAULT_ICON;
			if (isDynamicSubtasksFilterSet(this.filterSet)) return DYNAMIC_SUBTASKS_FILTER_DEFAULT_ICON;
			return 'filter';
		};
		const refreshIconPreview = (): void => {
			setIcon(iconBtn, normalizeTaskIconValue(this.filterSet.icon) || getFallbackIcon());
		};
		const commitIconValue = (nextValue: string): void => {
			const normalizedIcon = normalizeTaskIconValue(nextValue);
			this.filterSet.icon = normalizedIcon || undefined;
			refreshIconPreview();
		};
		const openPicker = (): void => {
			openSettingsIconPickerModal(this.app, {
				title: t('filterSets', 'filterIcon'),
				value: this.filterSet.icon,
				query: '',
				onSelect: commitIconValue,
				onClear: () => commitIconValue(''),
			});
		};

		let skipNextClickOpen = false;
		refreshIconPreview();
		iconBtn.addEventListener('pointerdown', (event) => {
			event.preventDefault();
			event.stopPropagation();
			skipNextClickOpen = true;
			openPicker();
		});
		iconBtn.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			if (skipNextClickOpen) {
				skipNextClickOpen = false;
				return;
			}
			openPicker();
		});
	}

	// --------------------------------------------------------
	// Conditions list
	// --------------------------------------------------------

	private renderConditions(container: HTMLElement): void {
		if (this.options.lockConditions) {
			this.renderDynamicLockedConditions(container, this.options.lockConditions);
			return;
		}
		const section = container.createDiv();
		section.addClass('operon-filter-section');
		section.addClass('operon-filter-conditions-section');
		const listEl = section.createDiv('operon-conditions-list');
		this.renderGroupEditor(
			listEl,
			this.filterSet.rootGroup,
			null,
			-1,
			true,
			this.buildFilterGroupNumberMap(this.filterSet.rootGroup),
		);
	}

	private renderDynamicLockedConditions(container: HTMLElement, mode: 'dynamicFileTask' | 'dynamicSubtasks'): void {
		const copy = mode === 'dynamicSubtasks'
			? {
				title: t('filterSets', 'dynamicSubtasksFilterLockedConditionTitle'),
				value: t('filterSets', 'dynamicSubtasksFilterCurrentTaskOperonId'),
				desc: t('filterSets', 'dynamicSubtasksFilterLockedConditionDesc'),
			}
			: {
				title: t('filterSets', 'dynamicFileTaskFilterLockedConditionTitle'),
				value: t('filterSets', 'dynamicFileTaskFilterCurrentFileOperonId'),
				desc: t('filterSets', 'dynamicFileTaskFilterLockedConditionDesc'),
			};
		const section = container.createDiv();
		section.addClass('operon-filter-section');
		section.addClass('operon-filter-conditions-section');
		section.addClass('operon-filter-conditions-section--locked');
		section.createEl('h4', {
			cls: 'operon-filter-modal-section-title',
			text: copy.title,
		});
		const row = section.createDiv('operon-condition-row operon-condition-row--locked');
		row.createDiv({ cls: 'operon-filter-locked-condition-token', text: 'operonId' });
		row.createDiv({ cls: 'operon-filter-locked-condition-token', text: t('filterSets', 'operator_is') });
		row.createDiv({
			cls: 'operon-filter-locked-condition-token is-dynamic',
			text: copy.value,
		});
		section.createDiv({
			cls: 'setting-item-description operon-filter-locked-condition-note',
			text: copy.desc,
		});
	}

	private renderGroupEditor(
		container: HTMLElement,
		group: FilterGroup,
		parentGroup: FilterGroup | null,
		groupIndex: number,
		isRoot = false,
		groupNumbers: WeakMap<FilterGroup, number> = new WeakMap(),
	): void {
		const card = container.createDiv('operon-filter-group-card');
		card.addClass(isRoot ? 'is-root' : 'is-nested');
		const collapsed = !isRoot && this.collapsedFilterGroupIds.has(group.id);
		card.toggleClass('is-collapsed', collapsed);

		const header = card.createDiv('operon-filter-group-header');

		const left = header.createDiv('operon-filter-group-heading');
		const groupNumber = groupNumbers.get(group);
		const groupTitle = isRoot
			? t('filterSets', 'logic')
			: groupNumber
				? `${t('filterSets', 'group')} ${groupNumber}`
				: t('filterSets', 'group');
		left.createEl('strong', {
			cls: 'operon-filter-group-title',
			text: groupTitle,
		});
		if (!isRoot) {
			const collapseBtn = left.createEl('button');
			collapseBtn.type = 'button';
			collapseBtn.setAttribute('aria-expanded', String(!collapsed));
			this.addClasses(collapseBtn, 'operon-filter-modal-button', 'is-icon', 'operon-filter-group-collapse-button');
			setIcon(collapseBtn, collapsed ? 'chevron-right' : 'chevron-down');
			bindOperonHoverTooltip(collapseBtn, {
				content: collapsed ? t('filterSets', 'expandGroup') : t('filterSets', 'collapseGroup'),
				taskColor: null,
			});
			collapseBtn.addEventListener('click', () => {
				if (this.collapsedFilterGroupIds.has(group.id)) {
					this.collapsedFilterGroupIds.delete(group.id);
				} else {
					this.collapsedFilterGroupIds.add(group.id);
				}
				this.renderCurrentSurface();
			});
		}

		const logicWrap = left.createDiv();
		logicWrap.addClass('operon-filter-logic-selector');
		this.buildLogicSelector(logicWrap, group.logic, (logic) => {
			group.logic = logic;
			this.syncMirroredFilterFields();
		});

		if (isRoot) {
			const mainCount = this.countDirectConditionChildren(group);
			const groupedCount = this.countDirectGroupChildren(group);
			left.createSpan({
				cls: 'operon-filter-root-logic-summary',
				text: groupedCount > 0
					? t('filterSets', 'rootLogicSummary', {
						main: String(mainCount),
						grouped: String(groupedCount),
					})
					: t('filterSets', 'rootLogicSummaryMainOnly', {
						main: String(mainCount),
					}),
			});
		}

		const actions = header.createDiv('operon-filter-group-actions');

		if (!isRoot && parentGroup) {
			this.renderNodeMoveButtons(actions, parentGroup, groupIndex);
			const deleteBtn = actions.createEl('button');
			deleteBtn.type = 'button';
			this.addClasses(deleteBtn, 'operon-filter-modal-button', 'is-icon');
			setIcon(deleteBtn, 'x');
			bindOperonHoverTooltip(deleteBtn, { content: t('filterSets', 'deleteGroup'), taskColor: null });
			deleteBtn.addEventListener('click', () => {
				parentGroup.children.splice(groupIndex, 1);
				this.syncMirroredFilterFields();
				this.renderCurrentSurface();
			});
		}
		if (collapsed) return;

		const body = card.createDiv();
		body.addClass('operon-filter-group-body');
		body.addClass(isRoot ? 'is-root' : 'is-nested');
		for (let index = 0; index < group.children.length; index++) {
			const child = group.children[index];
			if (isFilterGroupNode(child)) {
				this.renderGroupEditor(body, child, group, index, false, groupNumbers);
			} else {
				this.renderConditionRow(body, group, child, index);
			}
		}

		const footer = card.createDiv();
		footer.addClass('operon-filter-group-footer');

		const addConditionBtn = footer.createEl('button');
		addConditionBtn.type = 'button';
		this.addClasses(addConditionBtn, 'operon-filter-modal-button', 'operon-filter-modal-add-button');
		addConditionBtn.setText(t('filterSets', 'addCondition'));
		addConditionBtn.addEventListener('click', () => {
			group.children.push({
				id: generateConditionId(),
				field: 'checkbox',
				fieldType: 'checkbox',
				operator: 'isOpen',
				value: undefined,
			});
			this.syncMirroredFilterFields();
			this.renderCurrentSurface();
		});

		const addGroupBtn = footer.createEl('button');
		addGroupBtn.type = 'button';
		this.addClasses(addGroupBtn, 'operon-filter-modal-button', 'operon-filter-modal-add-button');
		addGroupBtn.setText(t('filterSets', 'addGroup'));
		addGroupBtn.addEventListener('click', () => {
			group.children.push({
				id: generateGroupId(),
				logic: 'all',
				children: [],
			});
			this.syncMirroredFilterFields();
			this.renderCurrentSurface();
		});
	}

	private renderNodeMoveButtons(
		container: HTMLElement,
		parentGroup: FilterGroup,
		index: number,
	): void {
		const moveUpBtn = container.createEl('button');
		moveUpBtn.type = 'button';
		this.addClasses(moveUpBtn, 'operon-filter-modal-button', 'is-icon');
		setIcon(moveUpBtn, 'chevron-up');
		bindOperonHoverTooltip(moveUpBtn, { content: t('filterSets', 'moveUp'), taskColor: null });
		moveUpBtn.disabled = index === 0;
		moveUpBtn.addEventListener('click', () => {
			if (index === 0) return;
			[parentGroup.children[index - 1], parentGroup.children[index]] = [parentGroup.children[index], parentGroup.children[index - 1]];
			this.renderCurrentSurface();
		});

		const moveDownBtn = container.createEl('button');
		moveDownBtn.type = 'button';
		this.addClasses(moveDownBtn, 'operon-filter-modal-button', 'is-icon');
		setIcon(moveDownBtn, 'chevron-down');
		bindOperonHoverTooltip(moveDownBtn, { content: t('filterSets', 'moveDown'), taskColor: null });
		moveDownBtn.disabled = index >= parentGroup.children.length - 1;
		moveDownBtn.addEventListener('click', () => {
			if (index >= parentGroup.children.length - 1) return;
			[parentGroup.children[index + 1], parentGroup.children[index]] = [parentGroup.children[index], parentGroup.children[index + 1]];
			this.renderCurrentSurface();
		});
	}

	private renderConditionRow(
		listEl: HTMLElement,
		group: FilterGroup,
		cond: FilterSetCondition,
		index: number,
	): void {
		const row = listEl.createDiv('operon-condition-row');

		this.renderNodeMoveButtons(row, group, index);
		const fieldOptions = this.getFieldOptions(true);

		// --- Field picker ---
		const fieldWrap = row.createDiv('operon-filter-select-wrap is-content operon-condition-field-picker-wrap');
		const fieldButton = fieldWrap.createEl('button', {
			cls: 'operon-filter-select operon-field-picker-trigger operon-condition-field-picker-trigger',
		});
		fieldButton.type = 'button';
		fieldButton.setAttribute('aria-haspopup', 'listbox');
		fieldButton.setAttribute('aria-expanded', 'false');
		const fieldButtonLabel = fieldButton.createSpan('operon-field-picker-trigger-label operon-condition-field-picker-trigger-label');
		const fieldButtonSecondary = fieldButton.createSpan('operon-field-picker-trigger-secondary');
		const fieldButtonIcon = fieldButton.createSpan('operon-field-picker-trigger-icon operon-condition-field-picker-trigger-icon');
		setIcon(fieldButtonIcon, 'chevron-down');
		const fieldStatus = fieldWrap.createDiv('operon-filter-file-property-status');

		const getSelectedFieldOption = () => fieldOptions.find(optionDef => optionDef.field === cond.field);
		const getSelectedFieldLabel = () => getSelectedFieldOption()?.label ?? cond.field;
		const updateFieldButton = () => {
			const selectedFieldOption = getSelectedFieldOption();
			const label = selectedFieldOption?.label ?? cond.field;
			fieldButtonLabel.textContent = label;
			fieldButtonSecondary.textContent = selectedFieldOption?.secondaryLabel ?? '';
			fieldButtonSecondary.toggleClass('is-hidden', !selectedFieldOption?.secondaryLabel);
			fieldButton.dataset.value = selectedFieldOption?.field ?? cond.field;
			const detail = selectedFieldOption?.secondaryLabel
				? `${label} — ${selectedFieldOption.secondaryLabel}`
				: selectedFieldOption && selectedFieldOption.label !== selectedFieldOption.field
					? `${selectedFieldOption.label} (${selectedFieldOption.field})`
					: label;
			setAccessibleLabelWithoutTooltip(fieldButton, `${t('filterSets', 'conditionFieldPickerLabel')}: ${detail}`);
			bindOperonHoverTooltip(fieldButton, { content: detail, taskColor: null });
			fieldStatus.empty();
			fieldStatus.removeClass('is-unavailable', 'is-type-drift');
			if (selectedFieldOption?.unavailable) {
				fieldStatus.addClass('is-unavailable');
				fieldStatus.setText(t('filterSets', 'filePropertyUnavailableShort'));
			} else if (selectedFieldOption && cond.fieldType !== selectedFieldOption.type) {
				fieldStatus.addClass('is-type-drift');
				fieldStatus.setText(t('filterSets', 'filePropertyTypeDriftShort', {
					savedType: this.getFilePropertyTypeLabel(cond.fieldType),
					type: this.getFilePropertyTypeLabel(selectedFieldOption.type),
				}));
			}
			fieldStatus.toggleClass('is-hidden', !fieldStatus.textContent);
		};
		updateFieldButton();

		const openConditionFieldPicker = (): void => {
			const pickerFields = this.getPickerFieldOptions(fieldOptions, cond.field);
			if (this.options.pickerPresentation === 'modal') {
				openSettingsOptionPickerModal(this.app, {
					title: t('filterSets', 'conditionFieldPickerLabel'),
					value: cond.field,
					options: pickerFields.map(option => ({
						...option,
						value: option.field,
						description: option.secondaryLabel,
					})),
					placeholder: t('filterSets', 'conditionFieldSearchPlaceholder'),
					ariaLabel: t('filterSets', 'conditionFieldPickerLabel'),
					noMatchesText: t('filterSets', 'conditionFieldNoMatches'),
					getSearchText: option => option.searchText ?? `${option.label} ${option.description ?? ''} ${option.value}`,
					onSelect: option => {
						cond.field = option.field;
						cond.fieldType = option.type;
						cond.operator = '';
						cond.value = undefined;
						cond.values = undefined;
						updateFieldButton();
						rebuildOpSel();
						this.syncMirroredFilterFields();
					},
				});
				return;
			}
			fieldButton.setAttribute('aria-expanded', 'true');
			showFilterConditionPicker(fieldButton, {
				value: cond.field,
				fields: pickerFields,
				onSelect: (option) => {
					cond.field = option.field;
					cond.fieldType = option.type;
					cond.operator = '';
					cond.value = undefined;
					cond.values = undefined;
					updateFieldButton();
					rebuildOpSel();
					this.syncMirroredFilterFields();
				},
				onClose: () => {
					fieldButton.setAttribute('aria-expanded', 'false');
				},
			});
		};
		if (this.options.pickerPresentation === 'modal') {
			bindSettingsModalPickerTrigger(fieldButton, openConditionFieldPicker);
		} else {
			fieldButton.addEventListener('click', openConditionFieldPicker);
		}

		// --- Operator dropdown ---
		const opSel = this.createModalSelect(row, [], cond.operator, (value) => {
			cond.operator = value;
			cond.value = undefined;
			cond.values = undefined;
			updateValueInput();
			this.syncMirroredFilterFields();
			syncCompactSelectWidths();
		}, 'content');
		opSel.parentElement?.addClass('is-operator');

		// --- Value input wrapper ---
		const valueWrapper = row.createDiv();
		valueWrapper.addClass('operon-condition-value-wrap');

		const buildValueInput = () => {
			valueWrapper.empty();
			this.invalidRawConditionIds.delete(cond.id);
			const isProjectSerialScope = cond.fieldType === 'projectSerialScope';
			const isRawFileProperty = isFilePropertyColumnKey(cond.field);
			const usesProjectSerialScopePicker = isProjectSerialScope && (cond.operator === 'isAnyOf' || cond.operator === 'isNoneOf');
			if (usesProjectSerialScopePicker) {
				const scopeOptions = this.getProjectSerialScopeOptions();
				const selectionButton = valueWrapper.createEl('button', {
					cls: 'operon-filter-control operon-filter-project-serial-scope-picker',
					type: 'button',
				});
				const renderSelectionLabel = () => {
					const selected = cond.values ?? [];
					selectionButton.setText(selected.length === 0
						? t('filterSets', 'projectSerialGroupPickerPlaceholder')
						: selected.map(value => scopeOptions.find(option => option.value === value)?.label ?? value).join(', '));
				};
				renderSelectionLabel();
				const openScopePicker = () => {
					const pickerOptions = {
						title: t('filterSets', 'projectSerialGroupPickerTitle'),
						value: cond.values ?? [],
						options: scopeOptions,
						placeholder: t('filterSets', 'projectSerialGroupPickerPlaceholder'),
						allowCustom: false,
						queryActionLabel: (query: string) => t('filterSets', 'projectSerialGroupAllStartingWith', { prefix: query }),
						onQueryAction: (query: string) => {
							cond.operator = 'startsWith';
							cond.value = query;
							cond.values = undefined;
							this.syncMirroredFilterFields();
							this.renderCurrentSurface();
						},
						onSave: (values: string[]) => {
							cond.values = values.length > 0 ? values : undefined;
							cond.value = undefined;
							renderSelectionLabel();
							this.syncMirroredFilterFields();
						},
					};
					if (this.options.pickerPresentation === 'modal') {
						openSettingsMultiOptionPickerModal(this.app, pickerOptions);
						return;
					}
					showSearchableMultiOptionPicker(selectionButton, {
						...pickerOptions,
					});
				};
				if (this.options.pickerPresentation === 'modal') {
					bindSettingsModalPickerTrigger(selectionButton, openScopePicker);
				} else {
					selectionButton.addEventListener('click', openScopePicker);
				}
				return;
			}

			// Determine input type: numeric date operators override date→number
			const isNumericDateOp = NUMERIC_INPUT_DATE_OPERATORS.has(cond.operator);
			const isListCountOp = isRawFileProperty
				&& cond.fieldType === 'list'
				&& ['countIs', 'countNot', 'countLt', 'countGt'].includes(cond.operator);
			const useDatePopover = cond.fieldType === 'date' && !isNumericDateOp;
			const useDatetimePopover = cond.fieldType === 'datetime' && !isNumericDateOp;
			const inputType =
				isNumericDateOp || isListCountOp ? 'number' :
					useDatePopover || useDatetimePopover ? 'text' :
						cond.fieldType === 'number' ? 'number' : 'text';

			const inp = valueWrapper.createEl('input');
			inp.type = inputType;
			inp.value = cond.value ?? '';
			setAccessibleLabelWithoutTooltip(inp, `${getSelectedFieldLabel()} · ${this.getFilterOperatorLabel({ id: cond.operator, label: cond.operator })}`);
			const validationError = isRawFileProperty
				? valueWrapper.createDiv({
					cls: 'operon-filter-value-error is-hidden',
					text: t('filterSets', 'filePropertyInvalidConditionValue'),
				})
				: null;
			if (validationError) validationError.id = `operon-filter-value-error-${cond.id}`;
			const setRawValueValidity = (valid: boolean): void => {
				inp.setAttribute('aria-invalid', valid ? 'false' : 'true');
				validationError?.toggleClass('is-hidden', valid);
				if (valid) {
					this.invalidRawConditionIds.delete(cond.id);
					inp.removeAttribute('aria-describedby');
				} else {
					this.invalidRawConditionIds.add(cond.id);
					if (validationError) inp.setAttribute('aria-describedby', validationError.id);
				}
			};
			if (isRawFileProperty) {
				const initialValue = (cond.value ?? '').trim();
				if (useDatePopover) {
					setRawValueValidity(!initialValue || normalizeFilterDateInput(initialValue) !== null);
				} else if (useDatetimePopover) {
					setRawValueValidity(!initialValue || parseLocalTimestamp(initialValue) !== null);
				} else if (cond.fieldType === 'number' || isListCountOp) {
					const numericValue = Number(initialValue);
					const valid = !initialValue || (Number.isFinite(numericValue)
						&& (!isListCountOp || (Number.isInteger(numericValue) && numericValue >= 0)));
					setRawValueValidity(valid);
				}
			}
			if (useDatePopover) {
				inp.placeholder = t('filterSets', 'datePlaceholder');
				inp.inputMode = 'numeric';
				inp.addClass('operon-filter-date-popover-input');
			}
			if (useDatetimePopover) {
				inp.addClass('operon-filter-datetime-popover-input');
			}
			if (isListCountOp) {
				inp.min = '0';
				inp.step = '1';
				inp.inputMode = 'numeric';
			}
			if (cond.fieldType === 'projectTree') {
				inp.placeholder = t('filterSets', 'projectTreePlaceholder');
			} else if (cond.fieldType === 'folders') {
				inp.placeholder = t('filterSets', 'foldersPlaceholder');
				this.attachFolderSuggest(inp, cond);
			} else if (isProjectSerialScope) {
				inp.placeholder = t('filterSets', 'projectSerialGroupPrefixPlaceholder');
			}

			// Helpful placeholder for numeric date operators
			if (isNumericDateOp) {
				if (cond.operator === 'dayOfWeekIs' || cond.operator === 'dayOfWeekNot') {
					inp.placeholder = t('filterSets', 'dayOfWeekPlaceholder');
					inp.min = '0';
					inp.max = '6';
				} else if (cond.operator === 'monthIs' || cond.operator === 'monthNot') {
					inp.placeholder = t('filterSets', 'monthPlaceholder');
					inp.min = '1';
					inp.max = '12';
				} else {
					inp.placeholder = t('filterSets', 'daysPlaceholder');
					inp.min = '0';
				}
			}

			inp.addClass('operon-filter-control');
			if (isRawFileProperty && (cond.fieldType === 'text' || (cond.fieldType === 'list' && !isListCountOp))) {
				this.attachFilePropertyCandidateList(inp, valueWrapper, cond.field);
			}
			if (useDatePopover) {
				inp.addEventListener('focus', () => this.openDateConditionPopover(inp, cond));
				inp.addEventListener('click', () => this.openDateConditionPopover(inp, cond));
				inp.addEventListener('input', () => {
					const raw = inp.value.trim();
					const normalized = normalizeFilterDateInput(raw);
					if (isRawFileProperty) setRawValueValidity(!raw || normalized !== null);
					cond.value = normalized ?? undefined;
					this.syncMirroredFilterFields();
					this.refreshCountBadge?.();
				});
			} else if (useDatetimePopover) {
				inp.addEventListener('focus', () => this.openDatetimeConditionPopover(inp, cond));
				inp.addEventListener('click', () => this.openDatetimeConditionPopover(inp, cond));
				inp.addEventListener('input', () => {
					const value = inp.value.trim();
					const valid = !isRawFileProperty || !value || parseLocalTimestamp(value) !== null;
					setRawValueValidity(valid);
					cond.value = valid && value ? value : undefined;
					this.syncMirroredFilterFields();
					this.refreshCountBadge?.();
				});
			} else if (isRawFileProperty && (cond.fieldType === 'number' || isListCountOp)) {
				inp.addEventListener('input', () => {
					const raw = inp.value.trim();
					const numericValue = Number(raw);
					const valid = !raw || (Number.isFinite(numericValue) && (!isListCountOp || (Number.isInteger(numericValue) && numericValue >= 0)));
					setRawValueValidity(valid);
					cond.value = valid && raw ? raw : undefined;
					this.syncMirroredFilterFields();
					this.refreshCountBadge?.();
				});
			} else {
				inp.addEventListener('input', () => {
					cond.value = inp.value || undefined;
					this.syncMirroredFilterFields();
					this.refreshCountBadge?.();
				});
			}
		};

		const syncCompactSelectWidths = () => {
			const opWrap = opSel.parentElement;
			if (!opWrap) return;
			const targetWidth = Math.max(
				160,
				Math.min(320, this.measureControlContentWidth(fieldButton, getSelectedFieldLabel())),
				Math.min(320, this.measureSelectContentWidth(opSel)),
			);
			fieldWrap.style.flexBasis = `${targetWidth}px`;
			opWrap.style.flexBasis = `${targetWidth}px`;
		};

		const updateValueInput = () => {
			const needsValue = !NO_VALUE_OPERATORS.has(cond.operator);
			valueWrapper.toggleClass('is-hidden', !needsValue);
			if (needsValue) {
				buildValueInput();
			} else {
				this.invalidRawConditionIds.delete(cond.id);
			}
			syncCompactSelectWidths();
		};

		const rebuildOpSel = () => {
			opSel.empty();
			const ops = getOperatorsForField(cond.field, cond.fieldType);
			for (const op of ops) {
				opSel.createEl('option', { value: op.id, text: this.getFilterOperatorLabel(op) });
			}
			// If current operator isn't valid for new type, reset to first
			const valid = ops.find(o => o.id === cond.operator);
			if (!valid) {
				cond.operator = ops[0]?.id ?? '';
			}
			opSel.value = cond.operator;
			updateValueInput();
		};

		rebuildOpSel();
		syncCompactSelectWidths();

		// --- Delete button ---
		const delBtn = row.createEl('button');
		delBtn.type = 'button';
		this.addClasses(delBtn, 'operon-filter-modal-button', 'is-icon');
		setIcon(delBtn, 'x');
		bindOperonHoverTooltip(delBtn, { content: t('filterSets', 'deleteCondition'), taskColor: null });
		delBtn.addEventListener('click', () => {
			this.invalidRawConditionIds.delete(cond.id);
			group.children.splice(index, 1);
			this.syncMirroredFilterFields();
			this.renderCurrentSurface();
		});
	}

	// --------------------------------------------------------
	// Sort
	// --------------------------------------------------------

	private renderSort(container: HTMLElement): void {
		const sep = container.createDiv('operon-filter-section operon-filter-sort-section');

		const groupFieldOptions = this.getFieldOptions(false, true);
		const sortFieldOptions = this.getFieldOptions(false, true);
		const groupOptions: FilterFieldPickerOption[] = [
			{
				field: '',
				label: `(${t('filterSets', 'groupNone')})`,
				type: 'text',
				icon: 'minus',
				group: null,
				groupLabel: null,
				groupOrder: -1,
			},
			...groupFieldOptions,
		];
		const groupingSection = sep.createDiv('operon-filter-form-section operon-filter-grouping-section');
		const groupRow = this.createModalFormRow(groupingSection, t('filterSets', 'groupBy'), 'operon-filter-groupby-row');
		this.createModalFieldPicker(groupRow.controlEl, groupOptions, this.filterSet.groupBy ?? '', (value) => {
			this.filterSet.groupBy = value || undefined;
			if (this.filterSet.subgroupBy === this.filterSet.groupBy) {
				this.filterSet.subgroupBy = undefined;
			}
			this.syncMirroredFilterFields();
			this.renderCurrentSurface();
		}, {
			label: t('filterSets', 'groupBy'),
			placeholder: `(${t('filterSets', 'groupNone')})`,
		});
		this.createDirectionToggle(groupRow.actionEl, this.filterSet.groupOrder ?? 'asc', value => {
			this.filterSet.groupOrder = value;
			this.syncMirroredFilterFields();
		}, t('filterSets', 'groupBy'));

		const subgroupRow = this.createModalFormRow(groupingSection, t('filterSets', 'subgroupBy'), 'operon-filter-subgroup-row');
		this.createModalFieldPicker(subgroupRow.controlEl, groupOptions, this.filterSet.subgroupBy ?? '', (value) => {
			const nextValue = value || undefined;
			this.filterSet.subgroupBy = nextValue === this.filterSet.groupBy ? undefined : nextValue;
			this.syncMirroredFilterFields();
			this.renderCurrentSurface();
		}, {
			label: t('filterSets', 'subgroupBy'),
			placeholder: `(${t('filterSets', 'groupNone')})`,
		});
		this.createDirectionToggle(subgroupRow.actionEl, this.filterSet.subgroupOrder ?? 'asc', value => {
			this.filterSet.subgroupOrder = value;
			this.syncMirroredFilterFields();
		}, t('filterSets', 'subgroupBy'));

		const sortSection = sep.createDiv('operon-filter-form-section operon-filter-sort-card');
		sortSection.createEl('h4', {
			cls: 'operon-filter-modal-section-title',
			text: t('filterSets', 'sort'),
		});

		const sortsList = sortSection.createDiv('operon-filter-sort-list');
		for (let index = 0; index < this.filterSet.sorts.length; index++) {
			this.renderSortRow(sortsList, this.filterSet.sorts[index], index, sortFieldOptions);
		}

		const addSortBtn = sortSection.createEl('button');
		addSortBtn.type = 'button';
		this.addClasses(addSortBtn, 'operon-filter-modal-button', 'operon-filter-modal-add-button');
		addSortBtn.setText(t('filterSets', 'addSort'));
		addSortBtn.addEventListener('click', () => {
			this.filterSet.sorts.push({
				field: 'checkbox',
				order: 'asc',
			});
			this.syncMirroredFilterFields();
			this.renderCurrentSurface();
		});

	}

	private getFilterOperatorLabel(option: { id: string; label: string }): string {
		const key = `operator_${option.id}`;
		const localized = t('filterSets', key);
		return localized === key ? option.label : localized;
	}

	private renderUsageInfo(container: HTMLElement): void {
		if (this.options.hideUsageInfo) return;
		const settings = this.evalDeps?.getSettings();
		if (!settings) return;

		container.createDiv('operon-filter-section-divider');

		const calendarPresets = settings.calendarPresets
			.filter(preset => preset.filterSetId === this.filterSet.id)
			.map(preset => preset.name.trim() || preset.id);
			const kanbanPresets = settings.kanbanPresets
				.filter(preset => preset.filterSetId === this.filterSet.id)
				.map(preset => preset.name.trim() || preset.id);
			const tablePresets = settings.tablePresets
				.filter(preset => preset.filterSetId === this.filterSet.id)
				.map(preset => preset.name.trim() || preset.id);

			const section = container.createDiv('operon-filter-usage-section');
			section.createEl('h4', {
				cls: 'operon-filter-modal-section-title',
				text: t('filterSets', 'usedByTitle'),
			});

			if (calendarPresets.length === 0 && kanbanPresets.length === 0 && tablePresets.length === 0) {
				section.createDiv({
					cls: 'operon-filter-usage-empty',
					text: t('filterSets', 'usedByNone'),
				});
				return;
		}

			this.renderUsageRow(section, t('filterSets', 'usedByCalendar'), calendarPresets);
			this.renderUsageRow(section, t('filterSets', 'usedByKanban'), kanbanPresets);
			this.renderUsageRow(section, t('filterSets', 'usedByTable'), tablePresets);
		}

	private renderUsageRow(container: HTMLElement, label: string, presetNames: string[]): void {
		const row = container.createDiv('operon-filter-usage-row');
		row.createSpan({ cls: 'operon-filter-usage-label', text: `${label}:` });
		const value = row.createSpan('operon-filter-usage-value');
		if (presetNames.length === 0) {
			value.setText(t('filterSets', 'usedByNoneShort'));
			value.addClass('is-empty');
			return;
		}
		value.setText(presetNames.join(', '));
	}

	private renderSortRow(
		container: HTMLElement,
		sort: FilterSortSpec,
		index: number,
		fieldOptions: readonly FilterFieldPickerOption[],
	): void {
		const row = container.createDiv('operon-filter-sort-row');

		this.createModalFieldPicker(
			row,
			fieldOptions,
			sort.field,
			(value) => {
				sort.field = value;
				this.syncMirroredFilterFields();
			},
			{
				label: t('filterSets', 'sortBy'),
				placeholder: t('filterSets', 'sortNone'),
			},
		);

		this.createDirectionToggle(
			row,
			sort.order,
			value => {
				sort.order = value;
				this.syncMirroredFilterFields();
			},
			`${t('filterSets', 'sort')} ${index + 1}`,
		);

		this.renderSortMoveButtons(row, index);

		const deleteBtn = row.createEl('button');
		deleteBtn.type = 'button';
		this.addClasses(deleteBtn, 'operon-filter-modal-button', 'is-icon');
		setIcon(deleteBtn, 'x');
		bindOperonHoverTooltip(deleteBtn, { content: t('filterSets', 'deleteSort'), taskColor: null });
		deleteBtn.addEventListener('click', () => {
			this.filterSet.sorts.splice(index, 1);
			this.syncMirroredFilterFields();
			this.renderCurrentSurface();
		});
	}

	private renderSortMoveButtons(container: HTMLElement, index: number): void {
		const moveUpBtn = container.createEl('button');
		moveUpBtn.type = 'button';
		this.addClasses(moveUpBtn, 'operon-filter-modal-button', 'is-icon');
		setIcon(moveUpBtn, 'chevron-up');
		bindOperonHoverTooltip(moveUpBtn, { content: t('filterSets', 'moveUp'), taskColor: null });
		moveUpBtn.disabled = index === 0;
		moveUpBtn.addEventListener('click', () => {
			if (index === 0) return;
			[this.filterSet.sorts[index - 1], this.filterSet.sorts[index]] = [this.filterSet.sorts[index], this.filterSet.sorts[index - 1]];
			this.renderCurrentSurface();
		});

		const moveDownBtn = container.createEl('button');
		moveDownBtn.type = 'button';
		this.addClasses(moveDownBtn, 'operon-filter-modal-button', 'is-icon');
		setIcon(moveDownBtn, 'chevron-down');
		bindOperonHoverTooltip(moveDownBtn, { content: t('filterSets', 'moveDown'), taskColor: null });
		moveDownBtn.disabled = index >= this.filterSet.sorts.length - 1;
		moveDownBtn.addEventListener('click', () => {
			if (index >= this.filterSet.sorts.length - 1) return;
			[this.filterSet.sorts[index + 1], this.filterSet.sorts[index]] = [this.filterSet.sorts[index], this.filterSet.sorts[index + 1]];
			this.renderCurrentSurface();
		});
	}

	// --------------------------------------------------------
	// Save / Cancel buttons
	// --------------------------------------------------------

	private renderButtons(container: HTMLElement): void {
		const row = container.createDiv('operon-filter-footer');
		const left = row.createDiv('operon-filter-footer-left');
		const right = row.createDiv('operon-filter-footer-primary-actions');
		const inlineOptions = this.inlineEditor?.options ?? null;

		// Live task count badge — left side
		if ((this.evalDeps || inlineOptions?.countTasks) && this.options.showCountBadge !== false) {
			const deps = this.evalDeps;
			const badge = left.createEl('button', { cls: 'operon-filter-count-badge' });
			this.countBadge = badge;

			let updating = false;
			let debounceTimer: WindowTimeoutHandle | null = null;

			const updateCount = () => {
				if (updating) return;
				updating = true;
				const n = inlineOptions?.countTasks
					? inlineOptions.countTasks(this.filterSet)
					: deps
						? evaluateFilterSet(
							this.filterSet,
							deps.indexer.getAllTasks(),
							deps.getPriorities(),
							deps.pinnedCache,
							deps.getPipelines(),
							{
								projectSerialScopes: deps.getSettings().projectSerialScopes,
								projectSerialScopeTasks: deps.indexer.getAllTasks(),
								filePropertyContext: this.filePropertySnapshot ?? undefined,
							},
						).length
						: 0;
				badge.empty();
				const icon = badge.createSpan({ cls: 'operon-count-badge-icon' });
				setIcon(icon, 'list');
				badge.createSpan({
					text: t('filterSets', n === 1 ? 'taskCountWithLeadingSpaceOne' : 'taskCountWithLeadingSpaceMany', {
						count: String(n),
					}),
				});
				updating = false;
			};
			this.refreshCountBadge = updateCount;
			updateCount();

			// Re-run count when conditions change — debounce + guard prevents re-entrant loop
				const observer = new MutationObserver((mutations) => {
					if (updating) return;
					if (mutations.every(mutation => badge.contains(mutation.target))) return;
					if (debounceTimer) clearWindowTimeout(debounceTimer);
					debounceTimer = setWindowTimeout(() => updateCount(), 150);
				});
			observer.observe(container.closest('.modal-content') ?? container, { childList: true, subtree: true });
			this.condObserver = observer;

			if (deps) {
				badge.addEventListener('click', () => {
					new FilterPreviewModal(
						this.app,
						this.filterSet,
						deps,
					).open();
				});
			}
		}

		this.renderQuickActions(left, right);

		const cancelBtn = right.createEl('button');
		cancelBtn.type = 'button';
		this.addClasses(cancelBtn, 'operon-filter-modal-button', 'operon-filter-footer-button', 'operon-filter-modal-cancel-button');
		cancelBtn.setText(t('buttons', 'cancel'));
		cancelBtn.addEventListener('click', () => {
			if (inlineOptions) {
				inlineOptions.onCancel();
				return;
			}
			this.close();
		});

		const saveBtn = right.createEl('button');
		saveBtn.type = 'button';
		this.addClasses(saveBtn, 'operon-filter-modal-button', 'operon-filter-footer-button', 'is-primary', 'mod-cta');
		saveBtn.setText(t('buttons', 'save'));
		if (inlineOptions?.saveTooltip) {
			bindOperonHoverTooltip(saveBtn, {
				title: inlineOptions.saveTooltip.title,
				content: inlineOptions.saveTooltip.content,
				taskColor: null,
				preferredVertical: 'above',
			});
		}
		saveBtn.addEventListener('click', () => {
			const name = this.filterSet.name.trim();
			if (!name) {
				new Notice(t('filterSets', 'nameRequired'));
				return;
			}
			if (this.invalidRawConditionIds.size > 0) {
				new Notice(t('filterSets', 'filePropertyInvalidConditionValue'));
				return;
			}
			this.syncMirroredFilterFields();
			this.filterSet.name = name;
			if (inlineOptions) {
				inlineOptions.onSave(this.filterSet);
				return;
			}
			this.onSave(this.filterSet);
			this.close();
		});
	}

	private renderQuickActions(left: HTMLElement, right: HTMLElement): void {
		const actions = this.options.quickActions;
		const canRenderFavorite = Boolean(this.options.onToggleFavorite) && !isSpecialDynamicFilterSet(this.filterSet);
		if (!actions && !canRenderFavorite) return;

		if (actions?.copyEmbedCode || actions?.duplicate || canRenderFavorite) {
			const quickGroup = left.createDiv('operon-filter-footer-quick-actions');
			if (actions?.copyEmbedCode) {
				this.createFooterActionButton(quickGroup, {
					label: t('filterSets', 'copyEmbedCode'),
					text: '</>',
					monospace: true,
					onClick: actions.copyEmbedCode,
					errorContext: 'filter modal embed copy failed',
				});
			}
			if (actions?.duplicate) {
				this.createFooterActionButton(quickGroup, {
					label: t('filterSets', 'duplicateFilter'),
					icon: 'copy',
					onClick: actions.duplicate,
					errorContext: 'filter modal duplicate failed',
				});
			}
			if (canRenderFavorite) {
				const settings = this.options.getSettings?.() ?? null;
				const isStoredFilter = settings?.filterSets.some(entry => entry.id === this.filterSet.id) === true;
				const isFavorite = settings !== null && isPresetFavorite(settings.presetFavorites, 'filter', this.filterSet.id);
				createPresetFavoriteButton({
					containerEl: quickGroup,
					className: 'operon-filter-modal-button operon-filter-footer-action-button',
					active: isFavorite,
					disabled: !isStoredFilter,
					onClick: () => {
						void runSettingsAsync('filter favorite failed', async () => {
							await this.options.onToggleFavorite?.(this.filterSet.id);
							this.renderModalPreservingScroll(true);
						});
					},
				});
			}
		}

		if (actions?.remove) {
			this.createFooterActionButton(right, {
				label: t('filterSets', 'deleteFilterConfirm'),
				icon: 'trash-2',
				danger: true,
				onClick: actions.remove,
				errorContext: 'filter modal delete failed',
			});
		}
	}

	private renderModalPreservingScroll(restoreFavoriteFocus = false): void {
		const scrollTop = this.contentEl.scrollTop;
		const scrollLeft = this.contentEl.scrollLeft;
		this.renderModal();
		const restore = (): void => {
			this.contentEl.scrollTop = scrollTop;
			this.contentEl.scrollLeft = scrollLeft;
		};
		restore();
		if (restoreFavoriteFocus) {
			this.contentEl.querySelector<HTMLButtonElement>('.operon-preset-favorite-button')?.focus({ preventScroll: true });
		}
		this.contentEl.ownerDocument.defaultView?.requestAnimationFrame(restore);
	}

	private createFooterActionButton(
		container: HTMLElement,
		options: {
			label: string;
			icon?: string;
			text?: string;
			monospace?: boolean;
			danger?: boolean;
			onClick: () => void | Promise<void>;
			errorContext: string;
		},
	): HTMLButtonElement {
		const button = container.createEl('button');
		button.type = 'button';
		this.addClasses(button, 'operon-filter-modal-button', 'operon-filter-footer-action-button');
		if (options.monospace) button.addClass('is-monospace');
		if (options.danger) button.addClass('is-danger');
		setAccessibleLabelWithoutTooltip(button, options.label);
		bindOperonHoverTooltip(button, { content: options.label, taskColor: null });
		if (options.icon) {
			setIcon(button, options.icon);
		} else {
			button.setText(options.text ?? options.label);
		}
		button.addEventListener('click', () => {
			try {
				const result = options.onClick();
				void Promise.resolve(result).catch(error => {
					console.error(`Operon: ${options.errorContext}`, error);
				});
			} catch (error) {
				console.error(`Operon: ${options.errorContext}`, error);
			}
		});
		return button;
	}

	refreshPinnedState(): void {
		this.refreshCountBadge?.();
	}

	refreshExternalState(): void {
		const previousSignature = this.filePropertySnapshot?.signature ?? '';
		const nextSignature = this.resolveFilePropertySnapshot()?.signature ?? '';
		if (nextSignature !== previousSignature) {
			this.renderCurrentSurface();
			return;
		}
		this.refreshPinnedState();
	}
}

/**
 * Quick preview modal — shows the task list for the current filter state.
 */
class FilterPreviewModal extends Modal {
	private filterSet: FilterSet;
	private deps: FilterModalEvalDeps;
	private lastRenderSignature: string | null = null;
	private expandedTaskIds = new Set<string>();

	constructor(
		app: App,
		filterSet: FilterSet,
		deps: FilterModalEvalDeps,
	) {
		super(app);
		this.filterSet = filterSet;
		this.deps = deps;
	}

	onOpen(): void {
		activeFilterPreviewModals.add(this);
		this.modalEl.addClass('operon-filter-preview-modal-shell');
		this.refresh();
	}

	refresh(): void {
		const allTasks = this.deps.indexer.getAllTasks();
		const filePropertySnapshot = this.deps.getFilePropertySnapshot?.(allTasks) ?? null;
		const renderSignature = [
			this.deps.indexer.getGeneration(),
			this.deps.pinnedCache?.getGeneration() ?? 0,
			this.deps.getTrackingSignature?.() ?? '',
			this.deps.getProjectSerialSignature?.() ?? '',
			filePropertySnapshot?.signature ?? '',
			JSON.stringify(this.filterSet),
			this.deps.getSettings().filterShowSubtasks ? '1' : '0',
			String(this.deps.getSettings().filterSubtaskAutoExpandLimit),
			this.deps.getSettings().filterShowOnlyOpenSubtasks ? '1' : '0',
			String(this.deps.getSettings().dynamicFileTaskFilterSubtaskAutoExpandLimit),
			this.deps.getSettings().dynamicFileTaskFilterShowOnlyOpenSubtasks ? '1' : '0',
			String(this.deps.getSettings().dynamicSubtasksFilterSubtaskAutoExpandLimit),
			this.deps.getSettings().dynamicSubtasksFilterShowOnlyOpenSubtasks ? '1' : '0',
			JSON.stringify(this.deps.getSettings().filterTaskCompactChips),
			JSON.stringify([
				this.deps.getSettings().filterTaskShowPlayAction,
				this.deps.getSettings().filterTaskShowPinAction,
				this.deps.getSettings().filterTaskShowNoteAction,
				this.deps.getSettings().filterTaskShowSubtaskAction,
				this.deps.getSettings().filterTaskShowPlainCheckboxAction,
			]),
			buildTaskWikilinkOverlaySettingsSignature(this.deps.getSettings()),
			buildTaskStatusIconRenderSettingsSignature(this.deps.getSettings()),
			buildWorkflowStatusOrderSignature(this.deps.getPipelines()),
			buildWorkflowStatusSemanticsSignature(this.deps.getPipelines()),
			JSON.stringify(this.deps.getSettings().keyMappings.map(mapping => [
				mapping.canonicalKey,
				mapping.visiblePropertyName,
				mapping.icon ?? '',
			])),
		].join('|');
		if (this.lastRenderSignature === renderSignature) return;
		this.lastRenderSignature = renderSignature;

		const priorities = this.deps.getPriorities();
		const pipelines = this.deps.getPipelines();
		const settings = this.deps.getSettings();
		const dynamicFilePreview = isDynamicFileTaskFilterSet(this.filterSet);
		const dynamicSubtasksPreview = isDynamicSubtasksFilterSet(this.filterSet);
		const showSubtasks = dynamicFilePreview || dynamicSubtasksPreview || settings.filterShowSubtasks === true;
		const showOnlyOpenSubtasks = dynamicFilePreview
			? settings.dynamicFileTaskFilterShowOnlyOpenSubtasks
			: dynamicSubtasksPreview
				? settings.dynamicSubtasksFilterShowOnlyOpenSubtasks
				: settings.filterShowOnlyOpenSubtasks === true;
		const autoExpandLimit = dynamicFilePreview
			? settings.dynamicFileTaskFilterSubtaskAutoExpandLimit
			: dynamicSubtasksPreview
				? settings.dynamicSubtasksFilterSubtaskAutoExpandLimit
				: settings.filterSubtaskAutoExpandLimit;
		if (!showSubtasks) {
			this.expandedTaskIds.clear();
		}
		const filterEvaluationOptions = {
			projectSerialScopes: settings.projectSerialScopes,
			projectSerialScopeTasks: allTasks,
			filePropertyContext: filePropertySnapshot ?? undefined,
		};
		const groupedResult = this.filterSet.groupBy
			? evaluateFilterSetGrouped(this.filterSet, allTasks, priorities, this.deps.pinnedCache, pipelines, filterEvaluationOptions)
			: null;
		const grouped = groupedResult?.groupingSuspended ? null : groupedResult;
		const tasks = groupedResult?.groupingSuspended
			? groupedResult.ungroupedTasks ?? []
			: grouped
				? null
			: evaluateFilterSet(this.filterSet, allTasks, priorities, this.deps.pinnedCache, pipelines, filterEvaluationOptions);
		const callbacks: FilterTaskRowCallbacks = {
			app: this.app,
			getPipelines: this.deps.getPipelines,
			getPriorities: this.deps.getPriorities,
			getIndexedTask: (id) => this.deps.indexer.getTask(id),
			getFileTaskByPath: (filePath) => this.deps.indexer.getFileTaskByPath(filePath),
			getDescendantTaskSummary: (operonId) => this.deps.indexer.getDescendantTaskSummary(operonId),
			getChildIds: this.deps.getChildIds,
			openEditor: this.deps.openEditor,
			cycleStatus: this.deps.cycleStatus,
			navigateToTask: this.deps.navigateToTask,
			getSettings: this.deps.getSettings,
			getAllTasks: () => this.deps.indexer.getAllTasks(),
			updateField: this.deps.updateField,
			updateFields: this.deps.updateFields,
			updateSubtasks: this.deps.updateSubtasks,
			updateDependencyField: this.deps.updateDependencyField,
			onContextualAction: this.deps.onContextualAction,
			isTaskPinned: this.deps.pinnedCache ? (taskId) => this.deps.pinnedCache?.isPinned(taskId) === true : undefined,
			isTaskTracking: this.deps.isTaskTracking,
			toggleTimer: this.deps.toggleTimer,
			getProjectSerialDisplay: this.deps.getProjectSerialDisplay,
		};

		const { contentEl } = this;
		cleanupOperonRenderRoot(contentEl);
		contentEl.empty();
		contentEl.addClass('operon-filter-preview-modal');
		const surface = contentEl.createDiv('operon-embed operon-filter-surface operon-task-chip-surface operon-filter-surface--preview');

		// Header
		const header = surface.createDiv('operon-embed-header operon-filter-preview-header');
		header.createSpan({ cls: 'operon-embed-name', text: this.filterSet.name });
		const count = grouped
			? grouped.totalCount
			: tasks!.length;
		header.createSpan({
			cls: 'operon-embed-count',
			text: t('filterSets', count === 1 ? 'taskCountOne' : 'taskCountMany', { count: String(count) }),
		});
		const configuredSubtaskSorts = getFilterSortSpecs(this.filterSet);
		const subtaskSorts = configuredSubtaskSorts.length > 0 ? configuredSubtaskSorts : undefined;
		const taskRowOptions = {
			allowExpand: showSubtasks,
			defaultExpandAll: (task: import('../types/fields').IndexedTask) => shouldAutoExpandFilterTaskSubtasks(
				task.operonId,
				callbacks,
				showOnlyOpenSubtasks,
				autoExpandLimit,
			),
			showOnlyOpenSubtasks,
			subtaskSorts,
			subtaskSortContext: prepareTaskSortContext(
				subtaskSorts ?? [{ field: 'priority', order: 'asc' }],
				{
					priorities,
					pipelines,
					isTaskPinned: callbacks.isTaskPinned,
					projectSerialScopeResolver: createProjectSerialScopeFilterResolver(
						settings.projectSerialScopes,
						allTasks,
					),
					filePropertyContext: filePropertySnapshot,
				},
			),
			workflowStatusIdentityIndex: buildWorkflowStatusIdentityIndex(pipelines),
		};

		const list = surface.createDiv('operon-embed-list operon-filter-list');

		if (count === 0) {
			list.createDiv({ cls: 'operon-embed-empty', text: t('filters', 'noMatches') });
			return;
		}

		if (grouped) {
			for (const group of grouped.groups) {
				const gh = list.createDiv('operon-group-header');
				gh.createSpan({ cls: 'operon-group-header-label', text: getFilterGroupDisplayLabel(group.key, group.label) });
				gh.createSpan({ cls: 'operon-group-header-count', text: String(group.count) });
				if (group.subgroups?.length) {
					for (const subgroup of group.subgroups) {
						const subgroupHeader = list.createDiv('operon-group-header operon-subgroup-header');
						subgroupHeader.createSpan({
							cls: 'operon-group-header-label',
							text: getFilterGroupDisplayLabel(subgroup.key, subgroup.label),
						});
							subgroupHeader.createSpan({ cls: 'operon-group-header-count', text: String(subgroup.count) });
							for (const task of subgroup.tasks) {
								list.appendChild(buildFilterTaskRowElement(task, callbacks, this.expandedTaskIds, taskRowOptions, list));
							}
						}
					} else {
						for (const task of group.tasks) {
							list.appendChild(buildFilterTaskRowElement(task, callbacks, this.expandedTaskIds, taskRowOptions, list));
						}
					}
				}
			} else {
				for (const task of tasks ?? []) {
					list.appendChild(buildFilterTaskRowElement(task, callbacks, this.expandedTaskIds, taskRowOptions, list));
				}
			}
	}

	onClose(): void {
		activeFilterPreviewModals.delete(this);
		this.lastRenderSignature = null;
		cleanupOperonRenderRoot(this.contentEl);
		this.contentEl.empty();
	}
}
