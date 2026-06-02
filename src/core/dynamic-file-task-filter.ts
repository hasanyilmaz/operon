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

const LOCKED_CONDITION_ID = 'cond_dynamic_file_task_operon_id';
const LOCKED_GROUP_ID = 'fg_dynamic_file_task_root';

export function isDynamicFileTaskFilterSetId(filterSetId: string | null | undefined): boolean {
	return filterSetId === DYNAMIC_FILE_TASK_FILTER_ID;
}

export function isDynamicFileTaskFilterSet(filterSet: Pick<FilterSet, 'id'> | null | undefined): boolean {
	return isDynamicFileTaskFilterSetId(filterSet?.id);
}

export function getNormalFilterSets(filterSets: FilterSet[]): FilterSet[] {
	return filterSets.filter(filterSet => !isDynamicFileTaskFilterSet(filterSet));
}

export function createDefaultDynamicFileTaskFilterSet(): FilterSet {
	return {
		id: DYNAMIC_FILE_TASK_FILTER_ID,
		name: DYNAMIC_FILE_TASK_FILTER_NAME,
		icon: DYNAMIC_FILE_TASK_FILTER_DEFAULT_ICON,
		rootGroup: createLockedRootGroup(DYNAMIC_FILE_TASK_FILTER_OPERON_ID_PLACEHOLDER),
		sorts: cloneSorts(DYNAMIC_FILE_TASK_FILTER_DEFAULT_SORTS),
		matchLogic: 'all',
		conditions: [createLockedCondition(DYNAMIC_FILE_TASK_FILTER_OPERON_ID_PLACEHOLDER)],
	};
}

export function seedDynamicFileTaskFilterDefaultSorts(filterSet: FilterSet): FilterSet {
	const clone = cloneFilterSet(filterSet);
	clone.sorts = cloneSorts(DYNAMIC_FILE_TASK_FILTER_DEFAULT_SORTS);
	clone.sortBy = clone.sorts[0]?.field;
	clone.sortOrder = clone.sorts[0]?.order;
	return clone;
}

export function normalizeDynamicFileTaskFilterSet(filterSet: FilterSet | null | undefined): FilterSet {
	const base = filterSet ? cloneFilterSet(filterSet) : createDefaultDynamicFileTaskFilterSet();
	const firstSort = cloneSorts(base.sorts)[0];
	const name = base.name.trim() || DYNAMIC_FILE_TASK_FILTER_NAME;
	return {
		...base,
		id: DYNAMIC_FILE_TASK_FILTER_ID,
		name,
		icon: base.icon || DYNAMIC_FILE_TASK_FILTER_DEFAULT_ICON,
		rootGroup: createLockedRootGroup(DYNAMIC_FILE_TASK_FILTER_OPERON_ID_PLACEHOLDER),
		conditions: [createLockedCondition(DYNAMIC_FILE_TASK_FILTER_OPERON_ID_PLACEHOLDER)],
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
