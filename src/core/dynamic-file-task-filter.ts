import {
	cloneFilterSet,
	DYNAMIC_FILE_TASK_FILTER_DEFAULT_SORTS,
	FilterGroup,
	FilterSet,
	FilterSetCondition,
	FilterSortSpec,
} from '../types/settings';

export const DYNAMIC_FILE_TASK_FILTER_ID = 'fs_dynamic_file_task';
export const DYNAMIC_FILE_TASK_FILTER_NAME = 'Dynamic File Task Filter';
export const DYNAMIC_FILE_TASK_FILTER_DEFAULT_ICON = 'bow-arrow';
export const DYNAMIC_FILE_TASK_FILTER_OPERON_ID_PLACEHOLDER = '{{currentFile.operonId}}';
export const DYNAMIC_SUBTASKS_FILTER_ID = 'fs_dynamic_subtasks_filter';
export const DYNAMIC_SUBTASKS_FILTER_NAME = 'Dynamic Subtasks Filter';
export const DYNAMIC_SUBTASKS_FILTER_DEFAULT_ICON = 'list-tree';
export const DYNAMIC_SUBTASKS_FILTER_OPERON_ID_PLACEHOLDER = '{{currentTask.operonId}}';

const LOCKED_CONDITION_ID = 'cond_dynamic_file_task_operon_id';
const LOCKED_GROUP_ID = 'fg_dynamic_file_task_root';
const SPECIAL_DYNAMIC_FILTER_IDS = new Set<string>([
	DYNAMIC_FILE_TASK_FILTER_ID,
	DYNAMIC_SUBTASKS_FILTER_ID,
]);

interface DynamicFilterTemplateConfig {
	id: string;
	name: string;
	icon: string;
	placeholder: string;
}

export interface DynamicFilterTemplatePreferences {
	name: string;
	icon: string;
	sorts: FilterSortSpec[];
	groupBy?: string;
	groupOrder?: 'asc' | 'desc';
	subgroupBy?: string;
	subgroupOrder?: 'asc' | 'desc';
}

export interface DynamicFilterTemplatePreferencesProjection {
	fileTask: DynamicFilterTemplatePreferences;
	subtasks: DynamicFilterTemplatePreferences;
}

const DYNAMIC_FILE_TASK_FILTER_CONFIG: DynamicFilterTemplateConfig = {
	id: DYNAMIC_FILE_TASK_FILTER_ID,
	name: DYNAMIC_FILE_TASK_FILTER_NAME,
	icon: DYNAMIC_FILE_TASK_FILTER_DEFAULT_ICON,
	placeholder: DYNAMIC_FILE_TASK_FILTER_OPERON_ID_PLACEHOLDER,
};

const DYNAMIC_SUBTASKS_FILTER_CONFIG: DynamicFilterTemplateConfig = {
	id: DYNAMIC_SUBTASKS_FILTER_ID,
	name: DYNAMIC_SUBTASKS_FILTER_NAME,
	icon: DYNAMIC_SUBTASKS_FILTER_DEFAULT_ICON,
	placeholder: DYNAMIC_SUBTASKS_FILTER_OPERON_ID_PLACEHOLDER,
};

export function isDynamicFileTaskFilterSetId(filterSetId: string | null | undefined): boolean {
	return filterSetId === DYNAMIC_FILE_TASK_FILTER_ID;
}

export function isDynamicSubtasksFilterSetId(filterSetId: string | null | undefined): boolean {
	return filterSetId === DYNAMIC_SUBTASKS_FILTER_ID;
}

export function isSpecialDynamicFilterSetId(filterSetId: string | null | undefined): boolean {
	return typeof filterSetId === 'string' && SPECIAL_DYNAMIC_FILTER_IDS.has(filterSetId);
}

export function isDynamicFileTaskFilterSet(filterSet: Pick<FilterSet, 'id'> | null | undefined): boolean {
	return isDynamicFileTaskFilterSetId(filterSet?.id);
}

export function isDynamicSubtasksFilterSet(filterSet: Pick<FilterSet, 'id'> | null | undefined): boolean {
	return isDynamicSubtasksFilterSetId(filterSet?.id);
}

export function isSpecialDynamicFilterSet(filterSet: Pick<FilterSet, 'id'> | null | undefined): boolean {
	return isSpecialDynamicFilterSetId(filterSet?.id);
}

export function getNormalFilterSets(filterSets: FilterSet[]): FilterSet[] {
	return filterSets.filter(filterSet => !isSpecialDynamicFilterSet(filterSet));
}

export function projectDynamicFilterTemplatePreferences(
	filterSets: FilterSet[],
): DynamicFilterTemplatePreferencesProjection {
	return {
		fileTask: pickDynamicFilterTemplatePreferences(normalizeDynamicFileTaskFilterSet(
			filterSets.find(isDynamicFileTaskFilterSet),
		)),
		subtasks: pickDynamicFilterTemplatePreferences(normalizeDynamicSubtasksFilterSet(
			filterSets.find(isDynamicSubtasksFilterSet),
		)),
	};
}

export function applyDynamicFilterTemplatePreferences(
	filterSets: FilterSet[],
	preferences: DynamicFilterTemplatePreferencesProjection,
): FilterSet[] {
	const fileTask = normalizeDynamicFileTaskFilterSet({
		...(filterSets.find(isDynamicFileTaskFilterSet) ?? createDefaultDynamicFileTaskFilterSet()),
		name: preferences.fileTask.name,
		icon: preferences.fileTask.icon,
		sorts: cloneSorts(preferences.fileTask.sorts),
		groupBy: preferences.fileTask.groupBy,
		groupOrder: preferences.fileTask.groupOrder,
		subgroupBy: preferences.fileTask.subgroupBy,
		subgroupOrder: preferences.fileTask.subgroupOrder,
	});
	const subtasks = normalizeDynamicSubtasksFilterSet({
		...(filterSets.find(isDynamicSubtasksFilterSet) ?? createDefaultDynamicSubtasksFilterSet()),
		name: preferences.subtasks.name,
		icon: preferences.subtasks.icon,
		sorts: cloneSorts(preferences.subtasks.sorts),
		groupBy: preferences.subtasks.groupBy,
		groupOrder: preferences.subtasks.groupOrder,
		subgroupBy: preferences.subtasks.subgroupBy,
		subgroupOrder: preferences.subtasks.subgroupOrder,
	});
	return [...getNormalFilterSets(filterSets).map(cloneFilterSet), fileTask, subtasks];
}

function pickDynamicFilterTemplatePreferences(filterSet: FilterSet): DynamicFilterTemplatePreferences {
	return {
		name: filterSet.name,
		icon: filterSet.icon ?? '',
		sorts: cloneSorts(filterSet.sorts),
		...(filterSet.groupBy !== undefined ? { groupBy: filterSet.groupBy } : {}),
		...(filterSet.groupOrder !== undefined ? { groupOrder: filterSet.groupOrder } : {}),
		...(filterSet.subgroupBy !== undefined ? { subgroupBy: filterSet.subgroupBy } : {}),
		...(filterSet.subgroupOrder !== undefined ? { subgroupOrder: filterSet.subgroupOrder } : {}),
	};
}

export function createDefaultDynamicFileTaskFilterSet(): FilterSet {
	return createDefaultDynamicFilterSet(DYNAMIC_FILE_TASK_FILTER_CONFIG);
}

export function createDefaultDynamicSubtasksFilterSet(): FilterSet {
	return createDefaultDynamicFilterSet(DYNAMIC_SUBTASKS_FILTER_CONFIG);
}

function createDefaultDynamicFilterSet(config: DynamicFilterTemplateConfig): FilterSet {
	return {
		id: config.id,
		name: config.name,
		icon: config.icon,
		rootGroup: createLockedRootGroup(config.placeholder),
		sorts: cloneSorts(DYNAMIC_FILE_TASK_FILTER_DEFAULT_SORTS),
		matchLogic: 'all',
		conditions: [createLockedCondition(config.placeholder)],
	};
}

export function seedDynamicFileTaskFilterDefaultSorts(filterSet: FilterSet): FilterSet {
	return seedDynamicFilterDefaultSorts(filterSet);
}

export function seedDynamicSubtasksFilterDefaultSorts(filterSet: FilterSet): FilterSet {
	return seedDynamicFilterDefaultSorts(filterSet);
}

function seedDynamicFilterDefaultSorts(filterSet: FilterSet): FilterSet {
	const clone = cloneFilterSet(filterSet);
	clone.sorts = cloneSorts(DYNAMIC_FILE_TASK_FILTER_DEFAULT_SORTS);
	clone.sortBy = clone.sorts[0]?.field;
	clone.sortOrder = clone.sorts[0]?.order;
	return clone;
}

export function normalizeDynamicFileTaskFilterSet(filterSet: FilterSet | null | undefined): FilterSet {
	return normalizeDynamicFilterSet(filterSet, DYNAMIC_FILE_TASK_FILTER_CONFIG);
}

export function normalizeDynamicSubtasksFilterSet(filterSet: FilterSet | null | undefined): FilterSet {
	return normalizeDynamicFilterSet(filterSet, DYNAMIC_SUBTASKS_FILTER_CONFIG);
}

export function normalizeSpecialDynamicFilterSet(filterSet: FilterSet): FilterSet {
	if (isDynamicSubtasksFilterSet(filterSet)) return normalizeDynamicSubtasksFilterSet(filterSet);
	return normalizeDynamicFileTaskFilterSet(filterSet);
}

export function createDynamicSubtasksFilterSetFromDynamicFileTaskFilter(filterSet: FilterSet | null | undefined): FilterSet {
	const source = normalizeDynamicFileTaskFilterSet(filterSet);
	return normalizeDynamicSubtasksFilterSet({
		...source,
		id: DYNAMIC_SUBTASKS_FILTER_ID,
		name: DYNAMIC_SUBTASKS_FILTER_NAME,
		icon: DYNAMIC_SUBTASKS_FILTER_DEFAULT_ICON,
	});
}

function normalizeDynamicFilterSet(
	filterSet: FilterSet | null | undefined,
	config: DynamicFilterTemplateConfig,
): FilterSet {
	const base = filterSet ? cloneFilterSet(filterSet) : createDefaultDynamicFilterSet(config);
	const firstSort = cloneSorts(base.sorts)[0];
	const name = base.name.trim() || config.name;
	return {
		...base,
		id: config.id,
		name,
		icon: base.icon || config.icon,
		rootGroup: createLockedRootGroup(config.placeholder),
		conditions: [createLockedCondition(config.placeholder)],
		matchLogic: 'all',
		sorts: cloneSorts(base.sorts),
		sortBy: firstSort?.field,
		sortOrder: firstSort?.order,
		groupBy: base.groupBy,
		groupOrder: base.groupOrder ?? (base.groupBy ? 'asc' : undefined),
		subgroupBy: base.subgroupBy && base.subgroupBy !== base.groupBy ? base.subgroupBy : undefined,
		subgroupOrder: base.subgroupBy && base.subgroupBy !== base.groupBy
			? base.subgroupOrder ?? 'asc'
			: undefined,
	};
}

export function materializeDynamicFileTaskFilterSet(template: FilterSet, operonId: string): FilterSet {
	const normalized = normalizeDynamicFileTaskFilterSet(template);
	return materializeDynamicFilterSet(normalized, operonId);
}

export function materializeDynamicSubtasksFilterSet(template: FilterSet, operonId: string): FilterSet {
	const normalized = normalizeDynamicSubtasksFilterSet(template);
	return materializeDynamicFilterSet(normalized, operonId);
}

function materializeDynamicFilterSet(template: FilterSet, operonId: string): FilterSet {
	const normalized = cloneFilterSet(template);
	const materialized = cloneFilterSet(normalized);
	materialized.rootGroup = createLockedRootGroup(operonId);
	materialized.conditions = [createLockedCondition(operonId)];
	return materialized;
}

function createLockedCondition(value: string): FilterSetCondition {
	return {
		id: LOCKED_CONDITION_ID,
		field: 'operonId',
		fieldType: 'text',
		operator: 'is',
		value,
	};
}

function createLockedRootGroup(value: string): FilterGroup {
	return {
		id: LOCKED_GROUP_ID,
		logic: 'all',
		children: [createLockedCondition(value)],
	};
}

function cloneSorts(sorts: FilterSortSpec[] | undefined): FilterSortSpec[] {
	return Array.isArray(sorts)
		? sorts.map(sort => ({ ...sort }))
		: [];
}
