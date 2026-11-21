import { isSettingsScope, scopeSettingsModal } from './settings/settings-scope';
/**
 * FilterSetModal — create/edit a named filter set.
 * Opened from the Filters settings tab.
 */

import { App, Modal, Notice, setIcon } from 'obsidian';
import { FilterSet, FilterSortSpec, KeyMapping, OperonSettings } from '../types/settings';
import { evaluateFilterSet, evaluateFilterSetGrouped, getFilterSortSpecs, prepareTaskSortContext } from '../core/filter-display';
import { automationPreviewSorts, groupAutomationPreviewTasks, type AutomationTaskPreview } from './automation-task-preview';
import { PinnedCache } from '../storage/pinned-cache';
import { buildFilterTaskRowElement, FilterTaskRowCallbacks, shouldAutoExpandFilterTaskSubtasks } from './filter-task-row';
import { t } from '../core/i18n';
import { OperonIndexer } from '../indexer/indexer';
import { createProjectSerialScopeFilterResolver, type ProjectSerialDisplay } from '../core/project-serials';
import { PriorityDefinition } from '../types/priority';
import { Pipeline } from '../types/pipeline';
import type { ContextualMenuActionHandler } from '../core/contextual-menu-engine';
import { bindOperonHoverTooltip } from './operon-hover-tooltip';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { WindowTimeoutHandle, clearWindowTimeout, getActiveWindow, setWindowTimeout } from '../core/dom-compat';
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
import {
	closeFloatingPanelsForRoot,
	isFloatingPanelTargetForRoot,
	requestFloatingPanelCloseForRoot,
} from './field-pickers/common';
import { showSearchableFieldPicker } from './field-pickers/searchable-field-picker';
import { isPresetFavorite } from '../core/preset-favorites';
import { createPresetFavoriteButton } from './preset-favorite-button';
import { runSettingsAsync } from './settings/async-settings-action';
import { openSettingsOptionPickerModal } from './settings/settings-option-picker-modal';
import type { IndexedTask } from '../types/fields';
import type { TableFilePropertySnapshot } from './table/table-file-property';
import { getFilterGroupDisplayLabel, resolveFilterGroupDateDisplay } from './filter-group-label';
import { cleanupOperonRenderRoot } from './render-root-cleanup';
import { requestCloseTextFieldPopoversForOwner } from './text-field-popover';
import { bindSettingsModalPickerTrigger, FilterConditionEditor, FilterFieldCatalog, flattenConditions, generateGroupId, getPickerFieldOptions, type FilterFieldPickerOption } from './filter-condition-editor';
export { bindSettingsModalPickerTrigger, getFilterSetFieldPickerMappingCandidates, type FilterSetFieldPickerMappingCandidate } from './filter-condition-editor';

export interface FilterModalEvalDeps {
	getRepeatSkipDates?: (seriesId: string) => string[];
	getRepeatSkipSignature?: () => string;
	indexer: OperonIndexer;
	getFilePropertySnapshot?: (tasks: readonly IndexedTask[]) => TableFilePropertySnapshot | null;
	getPipelines: () => Pipeline[];
	getPriorities: () => PriorityDefinition[];
	openEditor: (operonId: string) => void;
	cycleStatus: (operonId: string) => void;
	getChildIds: (parentId: string) => string[];
	navigateToTask: (task: import('../types/fields').IndexedTask) => void;
	activateDescription?: FilterTaskRowCallbacks['activateDescription'];
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
	private onSave: (updated: FilterSet) => void;
	private evalDeps: FilterModalEvalDeps | null;
	private options: FilterSetModalOptions;
	private countBadge: HTMLElement | null = null;
	private condObserver: MutationObserver | null = null;
	private refreshCountBadge: (() => void) | null = null;
	private inlineEditor: { container: HTMLElement; options: FilterSetInlineEditorOptions } | null = null;
	private filePropertySnapshot: TableFilePropertySnapshot | null = null;

	private readonly fields: FilterFieldCatalog;
	private conditionEditor: FilterConditionEditor | null = null;

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
		this.onSave = onSave;
		this.evalDeps = evalDeps ?? null;
		this.options = options;

		this.fields = new FilterFieldCatalog({
			keyMappings,
			getRootGroup: () => this.filterSet.rootGroup,
			getSettings: () => this.evalDeps?.getSettings() ?? this.options.getSettings?.(),
			getFilePropertySnapshot: () => this.filePropertySnapshot,
			getProjectSerialScopeTasks: () => this.evalDeps?.indexer.getAllTasks() ?? this.options.getProjectSerialScopeTasks?.() ?? [],
			getLayoutFields: () => [
				...this.filterSet.sorts.map(sort => sort.field),
				this.filterSet.groupBy ?? '', this.filterSet.subgroupBy ?? '',
			],
		});
	}

	onOpen(): void {
		this.inlineEditor = null;
		activeFilterSetModals.add(this);
		this.renderModal();
	}

	onClose(): void {
		this.conditionEditor?.unmount();
		activeFilterSetModals.delete(this);
		this.condObserver?.disconnect();
		this.refreshCountBadge = null;
		closeFloatingPanelsForRoot(this.modalEl);
		this.contentEl.empty();
	}

	renderInlineConditionEditor(container: HTMLElement, options: FilterSetInlineEditorOptions): void {
		this.inlineEditor = { container, options };
		activeFilterSetModals.add(this);
		this.renderInlineConditionEditorSurface();
	}

	destroyInlineConditionEditor(): void {
		if (!this.inlineEditor) return;
		this.conditionEditor?.unmount();
		this.condObserver?.disconnect();
		this.refreshCountBadge = null;
		closeFloatingPanelsForRoot(this.inlineEditor.container);
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
			|| (this.conditionEditor?.ownsDropdown(targetNode) ?? false);
	}

	isInlineEditorFloatingTarget(target: EventTarget | null): boolean {
		const inlineEditor = this.inlineEditor;
		if (!inlineEditor) return false;
		if (!target || typeof (target as Node).nodeType !== 'number') return false;
		const targetNode = target as Node;
		return isFloatingPanelTargetForRoot(inlineEditor.container, targetNode)
			|| (this.conditionEditor?.ownsDropdown(targetNode) ?? false);
	}

	requestInlineEditorChildEscapeClose(): boolean {
		const inlineEditor = this.inlineEditor;
		if (!inlineEditor) return false;
		if (requestFloatingPanelCloseForRoot(inlineEditor.container, 'escape')) return true;
		return this.conditionEditor?.closeFolderDropdown() ?? false;
	}

	private renderModal(): void {
		this.conditionEditor?.unmount();
		const { contentEl } = this;
		this.condObserver?.disconnect();
		this.refreshCountBadge = null;
		closeFloatingPanelsForRoot(contentEl);
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
		this.conditionEditor?.unmount();
		const { container } = inlineEditor;
		this.condObserver?.disconnect();
		this.refreshCountBadge = null;
		closeFloatingPanelsForRoot(container);
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
		this.filterSet.conditions = flattenConditions(this.filterSet.rootGroup);
		this.filterSet.subgroupBy = this.filterSet.subgroupBy && this.filterSet.subgroupBy !== this.filterSet.groupBy
			? this.filterSet.subgroupBy
			: undefined;
		this.filterSet.subgroupOrder = this.filterSet.subgroupBy ? (this.filterSet.subgroupOrder ?? 'asc') : undefined;

		const primarySort = this.filterSet.sorts[0];
		this.filterSet.sortBy = primarySort?.field;
		this.filterSet.sortOrder = primarySort?.order;
		this.refreshCountBadge?.();
	}

	private addClasses(el: HTMLElement, ...classNames: string[]): void {
		for (const className of classNames) el.addClass(className);
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
			const pickerFields = getPickerFieldOptions(fields, currentValue);
			if (this.options.pickerPresentation === 'modal') {
				openSettingsOptionPickerModal(this.app, {
					settingsScope: isSettingsScope(this.inlineEditor?.container ?? this.modalEl),
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
				...(button.closest('.operon-filter-set-modal-shell') === this.modalEl ? {
					floatingHost: this.modalEl, floatingScrollHost: this.contentEl,
					constrainToFloatingHost: true, fitToHostViewport: true,
				} : {}),
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

	private resolveFilePropertySnapshot(): TableFilePropertySnapshot | null {
		const provider = this.evalDeps?.getFilePropertySnapshot ?? this.options.getFilePropertySnapshot;
		if (!provider) return null;
		const tasks = this.options.getFilePropertyDiscoveryTasks?.()
			?? this.evalDeps?.indexer.getAllTasks()
			?? this.options.getProjectSerialScopeTasks?.()
			?? [];
		return provider(tasks);
	}

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
				settingsScope: isSettingsScope(this.inlineEditor?.container ?? this.modalEl),
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
		this.conditionEditor ??= new FilterConditionEditor({
			app: this.app,
			rootGroup: this.filterSet.rootGroup,
			title: t('filterSets', 'logic'),
			fields: this.fields,
			pickerPresentation: this.options.pickerPresentation,
			onChange: () => this.syncMirroredFilterFields(),
		});
		this.conditionEditor.mount(container);
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

	private renderSort(container: HTMLElement): void {
		const sep = container.createDiv('operon-filter-section operon-filter-sort-section');

		const groupFieldOptions = this.fields.getFieldOptions(false, true);
		const sortFieldOptions = this.fields.getFieldOptions(false, true, true);
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
								getRepeatSkipDates: deps.getRepeatSkipDates,
								projectSerialScopes: deps.getSettings().projectSerialScopes,
								projectSerialScopeTasks: deps.indexer.getAllTasks(),
								dependencyTasks: deps.indexer.getAllTasks(),
								pipelines: deps.getPipelines(),
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
					scopeSettingsModal(new FilterPreviewModal(
						this.app,
						this.filterSet,
						deps,
					), this.inlineEditor?.container ?? this.modalEl).open();
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
			const validationError = this.conditionEditor?.validationError;
			if (validationError) {
				new Notice(t('filterSets', validationError));
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
 * Interactive task list for a filter or the current membership of an automation stage.
 */
export class FilterPreviewModal extends Modal {
	private lastRenderSignature: string | null = null;
	private expandedTaskIds = new Set<string>();

	constructor(
		app: App,
		private readonly source: FilterSet | (() => AutomationTaskPreview),
		private readonly deps: FilterModalEvalDeps,
		private readonly onDismiss?: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		activeFilterPreviewModals.add(this);
		this.modalEl.addClass('operon-filter-preview-modal-shell');
		this.refresh();
	}

	refresh(): void {
		const filterSet = typeof this.source === 'function' ? null : this.source;
		const automation = typeof this.source === 'function' ? this.source() : null;
		const priorities = this.deps.getPriorities();
		const allTasks = this.deps.indexer.getAllTasks();
		const filePropertySnapshot = filterSet ? this.deps.getFilePropertySnapshot?.(allTasks) ?? null : null;
		const renderSignature = [
			this.deps.indexer.getGeneration(),
			this.deps.pinnedCache?.getGeneration() ?? 0,
			this.deps.getTrackingSignature?.() ?? '',
			this.deps.getProjectSerialSignature?.() ?? '',
			this.deps.getRepeatSkipSignature?.() ?? '',
			filePropertySnapshot?.signature ?? '',
			JSON.stringify(filterSet ?? automation),
			automation ? JSON.stringify(priorities.map(priority => priority.label)) : '',
			this.deps.getSettings().filterShowSubtasks ? '1' : '0',
			String(this.deps.getSettings().filterSubtaskAutoExpandLimit),
			this.deps.getSettings().filterShowOnlyOpenSubtasks ? '1' : '0',
			String(this.deps.getSettings().dynamicFileTaskFilterSubtaskAutoExpandLimit),
			this.deps.getSettings().dynamicFileTaskFilterShowOnlyOpenSubtasks ? '1' : '0',
			String(this.deps.getSettings().dynamicSubtasksFilterSubtaskAutoExpandLimit),
			this.deps.getSettings().dynamicSubtasksFilterShowOnlyOpenSubtasks ? '1' : '0',
			this.deps.getSettings().dateDisplayFormat,
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

		const pipelines = this.deps.getPipelines();
		const settings = this.deps.getSettings();
		const dynamicFilePreview = filterSet && isDynamicFileTaskFilterSet(filterSet);
		const dynamicSubtasksPreview = filterSet && isDynamicSubtasksFilterSet(filterSet);
		const showSubtasks = !!automation || dynamicFilePreview || dynamicSubtasksPreview || settings.filterShowSubtasks === true;
		const showOnlyOpenSubtasks = dynamicFilePreview
			? settings.dynamicFileTaskFilterShowOnlyOpenSubtasks
			: dynamicSubtasksPreview
				? settings.dynamicSubtasksFilterShowOnlyOpenSubtasks
				: !automation && settings.filterShowOnlyOpenSubtasks === true;
		const autoExpandLimit = dynamicFilePreview
			? settings.dynamicFileTaskFilterSubtaskAutoExpandLimit
			: dynamicSubtasksPreview
				? settings.dynamicSubtasksFilterSubtaskAutoExpandLimit
				: settings.filterSubtaskAutoExpandLimit;
		if (!showSubtasks) {
			this.expandedTaskIds.clear();
		}
		const filterEvaluationOptions = {
			getRepeatSkipDates: this.deps.getRepeatSkipDates,
			projectSerialScopes: settings.projectSerialScopes,
			projectSerialScopeTasks: allTasks,
			dependencyTasks: allTasks,
			pipelines,
			filePropertyContext: filePropertySnapshot ?? undefined,
		};
		const groupedResult = automation
			? groupAutomationPreviewTasks(automation.taskIds, id => this.deps.indexer.getTask(id), priorities)
			: filterSet?.groupBy
				? evaluateFilterSetGrouped(filterSet, allTasks, priorities, this.deps.pinnedCache, pipelines, filterEvaluationOptions)
				: null;
		const grouped = groupedResult?.groupingSuspended ? null : groupedResult;
		const tasks = groupedResult?.groupingSuspended
			? groupedResult.ungroupedTasks ?? []
			: filterSet && !grouped
				? evaluateFilterSet(filterSet, allTasks, priorities, this.deps.pinnedCache, pipelines, filterEvaluationOptions)
				: null;
		const callbacks: FilterTaskRowCallbacks = {
			getRepeatSkipDates: this.deps.getRepeatSkipDates,
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
			activateDescription: this.deps.activateDescription,
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
		const title = automation
			? `${automation.name.trim() || t('settings', 'automationUnsavedRule')}: ${t('settings', {
				scope: 'automationScope', target: 'automationTarget', changed: 'automationActions',
			}[automation.section])}`
			: filterSet?.name;
		header.createSpan({ cls: 'operon-embed-name', text: title });
		const count = grouped?.totalCount ?? tasks?.length;
		header.createSpan({
			cls: 'operon-embed-count',
			text: automation && automation.taskIds === undefined ? '…'
				: count === undefined ? t('settings', 'automationUnknown')
				: t('filterSets', count === 1 ? 'taskCountOne' : 'taskCountMany', { count: String(count) }),
		});
		if (count === undefined) return;
		const configuredSubtaskSorts = filterSet ? getFilterSortSpecs(filterSet) : automationPreviewSorts;
		const subtaskSorts = configuredSubtaskSorts.length > 0 ? configuredSubtaskSorts : undefined;
		const taskRowOptions = {
			allowExpand: showSubtasks,
			defaultExpandAll: automation ? false : (task: IndexedTask) => shouldAutoExpandFilterTaskSubtasks(
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
					getRepeatSkipDates: this.deps.getRepeatSkipDates,
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
			list.createDiv({ cls: 'operon-embed-empty', text: automation?.section === 'changed'
				? t('settings', 'automationChangedMany', { count: '0' }) : t('filters', 'noMatches') });
			return;
		}

		if (grouped) {
			for (const group of grouped.groups) {
				const gh = list.createDiv('operon-group-header');
				gh.createSpan({
					cls: 'operon-group-header-label',
					text: automation
						? t('settings', 'automationModifiedGroup', { date: group.label || t('filterSets', 'groupEmpty') })
						: resolveFilterGroupDateDisplay(getFilterGroupDisplayLabel(group.key, group.label), settings).displayLabel,
				});
				gh.createSpan({ cls: 'operon-group-header-count', text: String(group.count) });
				if (group.subgroups?.length) {
					for (const subgroup of group.subgroups) {
						const subgroupHeader = list.createDiv('operon-group-header operon-subgroup-header');
						subgroupHeader.createSpan({
							cls: 'operon-group-header-label',
							text: resolveFilterGroupDateDisplay(
								getFilterGroupDisplayLabel(subgroup.key, subgroup.label),
								settings,
							).displayLabel,
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
		this.expandedTaskIds.clear();
		requestCloseTextFieldPopoversForOwner(this.contentEl);
		cleanupOperonRenderRoot(this.contentEl);
		this.contentEl.empty();
		this.onDismiss?.();
	}
}
