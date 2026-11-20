import { PLAIN_CHECKBOXES_FILTER_FIELD_KEY } from '../core/plain-checkbox-filter';
import { bindFilterGroupInteractionState } from './surface-interaction-state';
import { isSettingsScope } from './settings/settings-scope';
import { isValidTrackedOnCondition } from '../core/tracked-on-filter';

import { App, Notice, TFolder, setIcon } from 'obsidian';
import { DEFAULT_SETTINGS, FilterSetCondition, FilterFieldType, FilterGroup, FilterGroupLogic, FilterNode, KeyMapping, OperonSettings } from '../types/settings';
import { DATE_OPERATORS, getOperatorsForField, NO_VALUE_OPERATORS, NUMERIC_INPUT_DATE_OPERATORS } from '../core/filter-display';
import { getConfiguredKeyMappingIcon } from '../core/key-mapping-icons';
import { getSourcePropertyIcon, type PropertyIconSettings } from '../core/property-icons';
import { t } from '../core/i18n';
import { PROJECT_SERIAL_SCOPE_FILTER_FIELD } from '../core/project-serials';
import { bindOperonHoverTooltip } from './operon-hover-tooltip';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { createOwnerElement, getOwnerBody, getOwnerWindow } from '../core/dom-compat';
import { showOperonDayPickerPopover } from './field-pickers/day-picker-popover';
import { showDatetimePicker } from './field-pickers/datetime-picker';
import { closeFloatingPanelsForRoot } from './field-pickers/common';
import { createFilterPickerTrigger, showFilterConditionPicker } from './field-pickers/filter-condition-picker';
import { showSearchableMultiOptionPicker, type SearchableMultiOption } from './field-pickers/list-picker';
import type { SearchableFieldPickerOption } from './field-pickers/searchable-field-picker';
import { getManagedCustomFieldOptions } from '../core/managed-task-fields';
import { CANONICAL_KEY_MAP } from '../types/keys';
import { openSettingsMultiOptionPickerModal, openSettingsOptionPickerModal } from './settings/settings-option-picker-modal';
import {
	decodeFilePropertyColumnKey,
	isFilePropertyColumnKey,
} from '../core/raw-yaml-property';
import { parseLocalTimestamp } from '../core/local-time';
import type { IndexedTask } from '../types/fields';
import { getTableFilePropertyTypeIcon, type TableFilePropertyField, type TableFilePropertySnapshot } from './table/table-file-property';
import {
	decodeFilterGroupClipboard,
	encodeFilterGroupClipboard,
	findFilterGroupPasteCompatibilityIssue,
	resolveFilterGroupPasteTarget,
} from '../core/filter-group-clipboard';
import {
	isTaskDataType,
	TASK_DATA_TYPE_FIELD_KEY,
} from '../core/task-data-type';

function generateConditionId(): string {
	return 'cond_' + Math.random().toString(36).slice(2, 10);
}

export function generateGroupId(): string {
	return 'grp_' + Math.random().toString(36).slice(2, 10);
}

let filterValueCandidateListInstanceId = 0;
let conditionEditorId = 0;

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

export interface FilterFieldPickerOption extends SearchableFieldPickerOption {
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

export interface FilterSetFieldPickerMappingCandidate {
	kind: 'builtIn' | 'custom';
	mapping: KeyMapping;
}

/** The mapping-backed portion of the FilterSet field picker. */
export function getFilterSetFieldPickerMappingCandidates(
	keyMappings: readonly KeyMapping[], includeCustomCheckbox = false,
): FilterSetFieldPickerMappingCandidate[] {
	const builtIn = keyMappings
		.filter(mapping => (
			mapping.isSystem !== false
			&& !mapping.isInternal
		))
		.map(mapping => ({ kind: 'builtIn' as const, mapping }));
	const custom = getManagedCustomFieldOptions(keyMappings, { includeCheckbox: includeCustomCheckbox })
		.map(option => ({ kind: 'custom' as const, mapping: option.mapping }));
	return [...builtIn, ...custom];
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

export function flattenConditions(group: FilterGroup): FilterSetCondition[] {
	const conditions: FilterSetCondition[] = [];
	for (const child of group.children) {
		if (isFilterGroupNode(child)) {
			conditions.push(...flattenConditions(child));
		} else {
			conditions.push({ ...child });
		}
	}
	return conditions;
}

export function getPickerFieldOptions(
	fields: readonly FilterFieldPickerOption[],
	currentValue: string,
): FilterFieldPickerOption[] {
	return fields.filter(field => !field.unavailable || field.field === currentValue);
}

export interface FilterFieldContext {
	keyMappings: KeyMapping[];
	getRootGroup: () => FilterGroup | undefined;
	getSettings?: () => OperonSettings | undefined;
	getFilePropertySnapshot?: () => TableFilePropertySnapshot | null;
	getLayoutFields?: () => string[];
	getProjectSerialScopeTasks?: () => readonly IndexedTask[];
}

export class FilterFieldCatalog {
	constructor(readonly context: FilterFieldContext) {}

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
		const root = this.context.getRootGroup();
		if (root) visit(root);
		for (const field of this.context.getLayoutFields?.() ?? []) add(field);
		return referenced;
	}

	private getFilePropertyFieldOptions(): FilterFieldPickerOption[] {
		const referenced = this.getReferencedFilePropertyTypes();
		const liveFields = this.context.getFilePropertySnapshot?.()?.fields ?? [];
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

	private getPropertyIconSettings(): PropertyIconSettings {
		return this.context.getSettings?.() ?? { keyMappings: this.context.keyMappings };
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
		const resolveIcon = () => field.readOnlyReason === 'automatic' ? 'shield-alert'
			: getSourcePropertyIcon(this.getPropertyIconSettings(), field.propertyName, getTableFilePropertyTypeIcon(field.type));
		return {
			field: field.key,
			label: field.propertyName,
			secondaryLabel,
			type: field.type,
			icon: resolveIcon(),
			resolveIcon,
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
		const resolveIcon = () => getSourcePropertyIcon(this.getPropertyIconSettings(), propertyName, getTableFilePropertyTypeIcon(type));
		return {
			field: key,
			label: propertyName,
			secondaryLabel: t('filterSets', 'filePropertyUnavailable', { type: typeLabel }),
			type,
			icon: resolveIcon(),
			resolveIcon,
			group: 'fileProperty',
			groupLabel: getFilterFieldGroupLabel('fileProperty'),
			groupOrder: getFilterFieldGroupOrder('fileProperty'),
			propertyName,
			sourceType: 'unknown',
			searchText: `${propertyName} ${key} note.${propertyName} ${typeLabel}`,
			unavailable: true,
		};
	}

	getFilePropertyTypeLabel(type: FilterFieldType): string {
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

	getFieldOptions(
		includeConditionOnly = false,
		includeHappensOn = false,
		includeSortOnly = false,
		includeCustomCheckbox = false,
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
		if (includeConditionOnly || includeSortOnly) {
			pseudoFields.push(buildFilterFieldPickerOption('repeatOccurrenceDate', t('taskEditor', 'repeatReferenceDateField'), 'date', 'scheduling', 'calendars'));
			pseudoFields.push(buildFilterFieldPickerOption('taskOccurrenceDate', t('filterSets', 'fieldTaskOccurrenceDate'), 'date', 'scheduling', 'calendar-clock'));
		}
		if (includeConditionOnly) {
			pseudoFields.push(buildFilterFieldPickerOption('trackedOn', t('filterSets', 'fieldTrackedOn'), 'date', 'scheduling', 'timer'));
			pseudoFields.push(buildFilterFieldPickerOption('projectTree', t('filterSets', 'fieldProjectTree'), 'projectTree', 'dependencies', 'git-branch'));
			pseudoFields.push(buildFilterFieldPickerOption('folders', t('filterSets', 'fieldFolders'), 'folders', 'source', 'folder'));
			pseudoFields.push(buildFilterFieldPickerOption(TASK_DATA_TYPE_FIELD_KEY, t('settings', 'tableTaskDataTypeColumn'), 'text', 'source', 'database'));
			pseudoFields.push(buildFilterFieldPickerOption(PLAIN_CHECKBOXES_FILTER_FIELD_KEY, t('filterSets', 'fieldPlainCheckboxes'), 'checkbox', 'workflow', 'list-checks'));
		}

		const mappings = getFilterSetFieldPickerMappingCandidates(this.getPropertyIconSettings().keyMappings, includeCustomCheckbox)
			.map(({ kind, mapping }) => {
				const resolveIcon = () => getConfiguredKeyMappingIcon(mapping.canonicalKey, this.getPropertyIconSettings().keyMappings)
					|| getFilterFieldTypeIcon(mapping.type);
				return {
					...buildFilterFieldPickerOption(
						mapping.canonicalKey, mapping.visiblePropertyName, mapping.type,
						kind === 'custom' ? 'custom' : resolveFilterFieldGroupForMapping(mapping), resolveIcon(),
					),
					resolveIcon,
				};
			});
		const filePropertyFields = this.getFilePropertyFieldOptions();

		return [...pseudoFields, ...mappings, ...filePropertyFields].sort(compareFilterFieldPickerOptions);
	}

	getProjectSerialScopeOptions(): SearchableMultiOption[] {
		const settings = this.context.getSettings?.() ?? null;
		if (!settings) return [];
		const scopeTasks = this.context.getProjectSerialScopeTasks?.() ?? [];
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

}

export interface FilterConditionEditorOptions {
	app: App;
	rootGroup: FilterGroup;
	title: string;
	fields: FilterFieldCatalog;
	rootFooterStatus?: HTMLElement;
	preserveUnknownValues?: boolean;
	pickerPresentation?: 'floating' | 'modal';
	onChange: () => void;
}

export class FilterConditionEditor {
	private readonly id = ++conditionEditorId;
	private section: HTMLElement | null = null;
	private cleanupInteractionState: (() => void) | null = null;
	private readonly bodyDropdowns: HTMLElement[] = [];
	private readonly collapsedFilterGroupIds = new Set<string>();
	private readonly invalidRawValues = new Map<string, string>();
	private settingsPicker: { modalEl: HTMLElement; close(): void } | null = null;
	private filterGroupPasteInProgress = false;

	constructor(private readonly options: FilterConditionEditorOptions) {}

	mount(container: HTMLElement): void {
		this.unmount();
		this.section = container.createDiv('operon-filter-section operon-filter-conditions-section');
		this.render();
		this.cleanupInteractionState = bindFilterGroupInteractionState(this.section);
	}

	unmount(): void {
		this.cleanupInteractionState?.();
		this.cleanupInteractionState = null;
		if (this.section) this.closePickers(this.section);
		this.cleanupBodyDropdowns();
		this.section?.remove();
		this.section = null;
	}

	private closePickers(section: HTMLElement): void {
		if (this.settingsPicker?.modalEl.isConnected) this.settingsPicker.close();
		this.settingsPicker = null;
		closeFloatingPanelsForRoot(section);
	}

	ownsDropdown(target: Node): boolean {
		return this.bodyDropdowns.some(dropdown => dropdown.contains(target));
	}

	closeFolderDropdown(): boolean {
		const dropdown = this.bodyDropdowns.find(element => element.hasClass('is-open'));
		if (!dropdown) return false;
		dropdown.removeClass('is-open');
		return true;
	}

	get hasInvalidRawValues(): boolean { return this.invalidRawValues.size > 0; }

	get validationError(): 'trackedOnInvalid' | 'filePropertyInvalidConditionValue' | null {
		if (this.hasInvalidTrackedOnCondition()) return 'trackedOnInvalid';
		return this.hasInvalidRawValues ? 'filePropertyInvalidConditionValue' : null;
	}

	private render(): void {
		const section = this.section;
		if (!section) return;
		this.closePickers(section);
		this.cleanupBodyDropdowns();
		section.empty();
		const root = this.options.rootGroup;
		const listEl = section.createDiv('operon-conditions-list');
		this.renderGroupEditor(listEl, root, null, -1, true, this.buildFilterGroupNumberMap(root));
	}

	private countDirectConditionChildren(group: FilterGroup): number {
		return group.children.filter(child => !isFilterGroupNode(child)).length;
	}

	private countDirectGroupChildren(group: FilterGroup): number {
		return group.children.filter(isFilterGroupNode).length;
	}

	private buildFilterGroupNumberMap(rootGroup: FilterGroup): WeakMap<FilterGroup, string> {
		const groupNumbers = new WeakMap<FilterGroup, string>();
		const visit = (group: FilterGroup, prefix: string): void => {
			let next = 1;
			for (const child of group.children) {
				if (!isFilterGroupNode(child)) continue;
				const number = prefix ? `${prefix}.${next++}` : String(next++);
				groupNumbers.set(child, number);
				visit(child, number);
			}
		};
		visit(rootGroup, '');
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
				const currentOptions = Array.from(select.options).filter(option => !option.disabled).map(option => ({
					value: option.value,
					label: option.text,
				}));
				const selectedLabel = select.selectedOptions[0]?.text
					?? currentOptions[0]?.label
					?? t('filterSets', 'conditionFieldPickerLabel');
				this.settingsPicker = openSettingsOptionPickerModal(this.options.app, {
					settingsScope: isSettingsScope(container),
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

	private cleanupBodyDropdowns(): void {
		for (const dropdown of this.bodyDropdowns) dropdown.remove();
		this.bodyDropdowns.length = 0;
	}

	private getFilePropertyCandidates(field: string): readonly string[] {
		if (!isFilePropertyColumnKey(field)) return [];
		return (this.options.fields.context.getFilePropertySnapshot?.()?.getCandidates(field) ?? []).slice(0, 500);
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
		for (const file of this.options.app.vault.getAllLoadedFiles()) {
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
				this.options.onChange();
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
		return this.options.fields.context.getSettings?.() ?? DEFAULT_SETTINGS;
	}

	private openDateConditionPopover(inputEl: HTMLInputElement, cond: FilterSetCondition): void {
		if (inputEl.dataset.operonDayPickerState === 'open') return;

		const settings = this.getPickerSettings();
		inputEl.dataset.operonDayPickerState = 'open';
		showOperonDayPickerPopover(inputEl, {
			app: this.options.app,
			value: normalizeFilterDateInput(cond.value ?? inputEl.value) ?? undefined,
			weekStart: settings.calendarWeekStart,
			showWeekNumbers: settings.calendarSidebarShowWeekNumbers,
			canClear: !!cond.value,
			onSelect: value => {
				cond.value = value;
				inputEl.value = value;
				inputEl.trigger('input');
			},
			onClear: () => {
				cond.value = undefined;
				inputEl.value = '';
				inputEl.trigger('input');
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
			app: this.options.app,
			settings: {
				timeFormat: settings.timeFormat,
				calendarWeekStart: settings.calendarWeekStart,
				calendarSidebarShowWeekNumbers: settings.calendarSidebarShowWeekNumbers,
			},
			dateDisplayFormat: settings.dateDisplayFormat,
			fieldKey: cond.field,
			value: cond.value ?? inputEl.value,
			canRemove: !!cond.value,
			onSelect: value => {
				cond.value = value;
				inputEl.value = value;
				inputEl.trigger('input');
			},
			onRemove: () => {
				cond.value = undefined;
				inputEl.value = '';
				inputEl.trigger('input');
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

	private renderGroupEditor(
		container: HTMLElement,
		group: FilterGroup,
		parentGroup: FilterGroup | null,
		groupIndex: number,
		isRoot = false,
		groupNumbers: WeakMap<FilterGroup, string> = new WeakMap(),
	): void {
		const card = container.createDiv('operon-filter-group-card');
		card.addClass(isRoot ? 'is-root' : 'is-nested');
		const collapsed = !isRoot && this.collapsedFilterGroupIds.has(group.id);
		card.toggleClass('is-collapsed', collapsed);

		const header = card.createDiv('operon-filter-group-header');

		const left = header.createDiv('operon-filter-group-heading');
		const groupNumber = groupNumbers.get(group);
		const groupTitle = isRoot
			? this.options.title
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
				this.render();
			});
		}

		const logicWrap = left.createDiv();
		logicWrap.addClass('operon-filter-logic-selector');
		this.buildLogicSelector(logicWrap, group.logic, (logic) => {
			group.logic = logic;
			this.options.onChange();
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
				for (const condition of flattenConditions(group)) this.invalidRawValues.delete(condition.id);
				this.options.onChange();
				this.render();
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
			this.options.onChange();
			this.render();
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
			this.options.onChange();
			this.render();
		});

		const clipboardActions = footer.createDiv('operon-filter-group-clipboard-actions');
		if (isRoot && this.options.rootFooterStatus) clipboardActions.appendChild(this.options.rootFooterStatus);
		if (!isRoot) {
			const copyBtn = clipboardActions.createEl('button');
			copyBtn.type = 'button';
			this.addClasses(
				copyBtn,
				'operon-filter-modal-button',
				'operon-filter-modal-add-button',
				'operon-filter-group-clipboard-button',
				'operon-filter-group-copy-button',
			);
			setIcon(copyBtn, 'copy');
			setAccessibleLabelWithoutTooltip(copyBtn, t('filterSets', 'copyGroup'));
			bindOperonHoverTooltip(copyBtn, { content: t('filterSets', 'copyGroup'), taskColor: null });
			copyBtn.addEventListener('click', () => {
				void this.copyFilterGroupToClipboard(group);
			});
		}

		const pasteGroupBtn = clipboardActions.createEl('button');
		pasteGroupBtn.type = 'button';
		this.addClasses(
			pasteGroupBtn,
			'operon-filter-modal-button',
			'operon-filter-modal-add-button',
			'operon-filter-group-clipboard-button',
			'operon-filter-group-paste-button',
		);
		setIcon(pasteGroupBtn, 'clipboard-paste');
		setAccessibleLabelWithoutTooltip(pasteGroupBtn, t('filterSets', 'pasteGroup'));
		bindOperonHoverTooltip(pasteGroupBtn, { content: t('filterSets', 'pasteGroup'), taskColor: null });
		pasteGroupBtn.addEventListener('click', () => {
			pasteGroupBtn.disabled = true;
			void this.pasteFilterGroupFromClipboard(group.id).finally(() => {
				if (pasteGroupBtn.isConnected) pasteGroupBtn.disabled = false;
			});
		});
	}

	private async copyFilterGroupToClipboard(group: FilterGroup): Promise<void> {
		try {
			await navigator.clipboard.writeText(encodeFilterGroupClipboard(group));
			new Notice(t('filterSets', 'groupCopied'));
		} catch (error) {
			console.warn('Operon: failed to copy filter group', error);
			new Notice(t('filterSets', 'copyGroupFailed'));
		}
	}

	private async pasteFilterGroupFromClipboard(targetGroupId: string): Promise<void> {
		if (this.filterGroupPasteInProgress) return;
		this.filterGroupPasteInProgress = true;
		const section = this.section;
		try {
			let clipboardText: string;
			try {
				clipboardText = await navigator.clipboard.readText();
			} catch (error) {
				console.warn('Operon: failed to read filter group from clipboard', error);
				new Notice(t('filterSets', 'readGroupClipboardFailed'));
				return;
			}
			if (!section?.isConnected || section !== this.section) return;
			const decoded = decodeFilterGroupClipboard(clipboardText, {
				createGroupId: generateGroupId,
				createConditionId: generateConditionId,
				isOperatorAllowed: (field, fieldType, operator) => (
					getOperatorsForField(field, fieldType, true).some(option => option.id === operator)
				),
			});
			if (!decoded.ok) {
				new Notice(t('filterSets', 'clipboardDoesNotContainGroup'));
				return;
			}
			const compatibilityIssue = this.getFilterGroupPasteCompatibilityIssue(decoded.group);
			if (compatibilityIssue?.kind === 'field') {
				new Notice(t('filterSets', 'pasteGroupMissingField', { field: compatibilityIssue.value }));
				return;
			}
			if (compatibilityIssue?.kind === 'projectScope') {
				new Notice(t('filterSets', 'pasteGroupMissingProjectScope', { scope: compatibilityIssue.value }));
				return;
			}
			if (!section?.isConnected || section !== this.section) return;
			const pasteTarget = resolveFilterGroupPasteTarget(
				this.options.rootGroup,
				targetGroupId,
				decoded.group,
			);
			if (!pasteTarget.ok) {
				if (pasteTarget.reason === 'limit') {
					new Notice(t('filterSets', 'pasteGroupLimitExceeded'));
				}
				return;
			}
			pasteTarget.target.children.push(decoded.group);
			this.options.onChange();
			this.render();
		} finally {
			this.filterGroupPasteInProgress = false;
		}
	}

	private getFilterGroupPasteCompatibilityIssue(
		group: FilterGroup,
	): { kind: 'field' | 'projectScope'; value: string } | null {
		const availableFields = new Map(this.options.fields.getFieldOptions(true).map(option => [option.field, option.type]));
		const availableProjectScopes = new Set(this.options.fields.getProjectSerialScopeOptions().map(option => option.value));
		return findFilterGroupPasteCompatibilityIssue(group, {
			getFieldType: field => availableFields.get(field) ?? null,
			isRawFileProperty: isFilePropertyColumnKey,
			isProjectScopeAvailable: scope => availableProjectScopes.has(scope),
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
			this.options.onChange();
			this.render();
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
			this.options.onChange();
			this.render();
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
		let fieldOptions = this.options.fields.getFieldOptions(true);

		// --- Field picker ---
		const fieldWrap = row.createDiv('operon-filter-select-wrap is-content operon-condition-field-picker-wrap');
		const { button: fieldButton, label: fieldButtonLabel, secondary: fieldButtonSecondary, icon } = createFilterPickerTrigger(fieldWrap);
		fieldButton.addClass('operon-condition-field-picker-trigger');
		fieldButtonLabel.addClass('operon-condition-field-picker-trigger-label');
		icon.addClass('operon-condition-field-picker-trigger-icon');
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
					savedType: this.options.fields.getFilePropertyTypeLabel(cond.fieldType),
					type: this.options.fields.getFilePropertyTypeLabel(selectedFieldOption.type),
				}));
			}
			fieldStatus.toggleClass('is-hidden', !fieldStatus.textContent);
		};
		updateFieldButton();

		const openConditionFieldPicker = (): void => {
			fieldOptions = this.options.fields.getFieldOptions(true);
			const pickerFields = getPickerFieldOptions(fieldOptions, cond.field);
			if (this.options.pickerPresentation === 'modal') {
				this.settingsPicker = openSettingsOptionPickerModal(this.options.app, {
					settingsScope: isSettingsScope(fieldButton),
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
						this.invalidRawValues.delete(cond.id);
						cond.field = option.field;
						cond.fieldType = option.type;
						cond.operator = '';
						cond.value = undefined;
						cond.values = undefined;
						updateFieldButton();
						rebuildOpSel();
						this.options.onChange();
					},
				});
				return;
			}
			fieldButton.setAttribute('aria-expanded', 'true');
			showFilterConditionPicker(fieldButton, {
				value: cond.field,
				fields: pickerFields,
				onSelect: (option) => {
					this.invalidRawValues.delete(cond.id);
					cond.field = option.field;
					cond.fieldType = option.type;
					cond.operator = '';
					cond.value = undefined;
					cond.values = undefined;
					updateFieldButton();
					rebuildOpSel();
					this.options.onChange();
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
			this.invalidRawValues.delete(cond.id);
			cond.operator = value;
			cond.value = undefined;
			cond.values = undefined;
			updateValueInput();
			this.options.onChange();
			syncCompactSelectWidths();
		}, 'content');
		opSel.parentElement?.addClass('is-operator');

		// --- Value input wrapper ---
		const valueWrapper = row.createDiv();
		valueWrapper.addClass('operon-condition-value-wrap');

		const buildValueInput = () => {
			valueWrapper.empty();
			if (cond.field === 'trackedOn') {
				this.renderTrackedOnValue(valueWrapper, cond);
				return;
			}
			if (cond.field === TASK_DATA_TYPE_FIELD_KEY) {
				const selectedValue = this.options.preserveUnknownValues && cond.value !== undefined ? cond.value : isTaskDataType(cond.value) ? cond.value : 'inline';
				cond.value = selectedValue;
				const valueSelect = this.createModalSelect(valueWrapper, [
					{ value: 'inline', label: 'inline' },
					{ value: 'file', label: 'file' },
					...(!isTaskDataType(selectedValue) ? [{ value: selectedValue, label: selectedValue }] : []),
				], selectedValue, (value) => {
					cond.value = isTaskDataType(value) ? value : undefined;
					this.options.onChange();
				}, 'content');
				valueSelect.addClass('operon-filter-control', 'operon-task-data-type-value-select');
				setAccessibleLabelWithoutTooltip(valueSelect, getSelectedFieldLabel());
				return;
			}
			const isProjectSerialScope = cond.fieldType === 'projectSerialScope';
			const isRawFileProperty = isFilePropertyColumnKey(cond.field);
			const usesProjectSerialScopePicker = isProjectSerialScope && (cond.operator === 'isAnyOf' || cond.operator === 'isNoneOf');
			if (usesProjectSerialScopePicker) {
				const scopeOptions = this.options.fields.getProjectSerialScopeOptions();
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
							this.options.onChange();
							this.render();
						},
						onSave: (values: string[]) => {
							cond.values = values.length > 0 ? values : undefined;
							cond.value = undefined;
							renderSelectionLabel();
							this.options.onChange();
						},
					};
					if (this.options.pickerPresentation === 'modal') {
						this.settingsPicker = openSettingsMultiOptionPickerModal(this.options.app, { ...pickerOptions, settingsScope: isSettingsScope(selectionButton) });
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
			inp.value = this.invalidRawValues.get(cond.id) ?? cond.value ?? '';
			setAccessibleLabelWithoutTooltip(inp, `${getSelectedFieldLabel()} · ${this.getFilterOperatorLabel({ id: cond.operator, label: cond.operator })}`);
			const validationError = isRawFileProperty
				? valueWrapper.createDiv({
					cls: 'operon-filter-value-error is-hidden',
					text: t('filterSets', 'filePropertyInvalidConditionValue'),
				})
				: null;
			if (validationError) validationError.id = `operon-filter-value-error-${this.id}-${cond.id}`;
			const setRawValueValidity = (valid: boolean): void => {
				inp.setAttribute('aria-invalid', valid ? 'false' : 'true');
				validationError?.toggleClass('is-hidden', valid);
				if (valid) {
					this.invalidRawValues.delete(cond.id);
					inp.removeAttribute('aria-describedby');
				} else {
					this.invalidRawValues.set(cond.id, inp.value);
					if (validationError) inp.setAttribute('aria-describedby', validationError.id);
				}
			};
			if (isRawFileProperty) {
				const initialValue = inp.value.trim();
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
					this.options.onChange();
				});
			} else if (useDatetimePopover) {
				inp.addEventListener('focus', () => this.openDatetimeConditionPopover(inp, cond));
				inp.addEventListener('click', () => this.openDatetimeConditionPopover(inp, cond));
				inp.addEventListener('input', () => {
					const value = inp.value.trim();
					const valid = !isRawFileProperty || !value || parseLocalTimestamp(value) !== null;
					setRawValueValidity(valid);
					cond.value = valid && value ? value : undefined;
					this.options.onChange();
				});
			} else if (isRawFileProperty && (cond.fieldType === 'number' || isListCountOp)) {
				inp.addEventListener('input', () => {
					const raw = inp.value.trim();
					const numericValue = Number(raw);
					const valid = !raw || (Number.isFinite(numericValue) && (!isListCountOp || (Number.isInteger(numericValue) && numericValue >= 0)));
					setRawValueValidity(valid);
					cond.value = valid && raw ? raw : undefined;
					this.options.onChange();
				});
			} else {
				inp.addEventListener('input', () => {
					cond.value = inp.value || undefined;
					this.options.onChange();
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
				this.invalidRawValues.delete(cond.id);
			}
			syncCompactSelectWidths();
		};

		const rebuildOpSel = () => {
			opSel.empty();
			const ops = getOperatorsForField(cond.field, cond.fieldType);
			for (const op of ops) {
				opSel.createEl('option', { value: op.id, text: this.getFilterOperatorLabel(op) });
			}
			// Preserve saved retired operators until the user explicitly replaces them.
			const valid = ops.find(o => o.id === cond.operator);
			if (!valid) {
				const legacy = cond.field === 'trackedOn' || cond.field === 'trackers'
					? getOperatorsForField(cond.field, cond.fieldType, true).find(op => op.id === cond.operator)
					: undefined;
				if (legacy) {
					opSel.createEl('option', { value: legacy.id, text: this.getFilterOperatorLabel(legacy) }).disabled = true;
				} else if (cond.operator && this.options.preserveUnknownValues) {
					opSel.createEl('option', { value: cond.operator, text: cond.operator }).disabled = true;
				} else cond.operator = ops[0]?.id ?? '';
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
			this.invalidRawValues.delete(cond.id);
			group.children.splice(index, 1);
			this.options.onChange();
			this.render();
		});
	}

	private renderTrackedOnValue(container: HTMLElement, cond: FilterSetCondition): void {
		const input = container.createEl('input', { cls: 'operon-filter-control' });
		const validate = () => {
			input.setAttribute('aria-invalid', String(!isValidTrackedOnCondition(cond, DATE_OPERATORS.map(op => op.id))));
		};
		setAccessibleLabelWithoutTooltip(input, this.getFilterOperatorLabel({ id: cond.operator, label: cond.operator }));
		if (cond.operator === 'between') {
			// Existing ranges remain intact; new ranges use separate before/after conditions.
			input.type = 'text';
			input.readOnly = true;
			setAccessibleLabelWithoutTooltip(input, `${t('filterSets', 'trackedOnFrom')} – ${t('filterSets', 'trackedOnTo')}`);
			input.value = (cond.values ?? []).join(' – ');
			validate();
			return;
		}
		const dateInput = ['dateIs', 'before', 'after'].includes(cond.operator);
		input.type = dateInput ? 'text' : 'number';
		input.value = cond.value ?? '';
		const update = (value: string) => {
			input.value = value;
			cond.value = value;
			validate();
			this.options.onChange();
		};
		input.addEventListener('input', () => update(input.value));
		if (dateInput) {
			input.placeholder = t('filterSets', 'datePlaceholder');
			input.addClass('operon-filter-date-popover-input');
			const open = () => {
				if (input.dataset.operonDayPickerState === 'open') return;
				input.dataset.operonDayPickerState = 'open';
				const settings = this.getPickerSettings();
				showOperonDayPickerPopover(input, {
					app: this.options.app, value: normalizeFilterDateInput(input.value) ?? undefined,
					weekStart: settings.calendarWeekStart, showWeekNumbers: settings.calendarSidebarShowWeekNumbers,
					canClear: !!input.value, onSelect: update, onClear: () => update(''),
					onClose: () => { delete input.dataset.operonDayPickerState; },
				});
			};
			input.addEventListener('focus', open);
			input.addEventListener('click', open);
		} else {
			input.step = '1';
			input.min = cond.operator === 'inLastDays' || cond.operator.startsWith('month') ? '1' : '0';
		}
		validate();
	}

	private hasInvalidTrackedOnCondition(): boolean {
		return flattenConditions(this.options.rootGroup).some(condition =>
			condition.field === 'trackedOn' && !isValidTrackedOnCondition(condition, DATE_OPERATORS.map(op => op.id)),
		);
	}

	private getFilterOperatorLabel(option: { id: string; label: string }): string {
		const key = `operator_${option.id}`;
		const localized = t('filterSets', key);
		return localized === key ? option.label : localized;
	}

}
