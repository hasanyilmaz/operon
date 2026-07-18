import { parseListValue } from '../core/parser';
import { filterTasksOnly, type FilterEvaluationOptions } from '../core/filter-evaluator';
import { t } from '../core/i18n';
import {
	CalendarFilterFieldChange,
	CalendarFilterMaterializationPlan,
	CalendarUnsupportedFilterCondition,
} from '../types/calendar';
import { IndexedTask } from '../types/fields';
import {
	FilterGroup,
	FilterNode,
	FilterSet,
	FilterSetCondition,
	KeyMapping,
} from '../types/settings';
import { PinnedCache } from '../storage/pinned-cache';
import { isFilePropertyColumnKey } from '../core/raw-yaml-property';

const CALENDAR_OWNED_FILTER_KEYS = new Set([
	'dateScheduled',
	'dateStarted',
	'dateDue',
	'datetimeStart',
	'datetimeEnd',
	'estimate',
]);

const DERIVED_OR_INTERNAL_FILTER_KEYS = new Set([
	'totalEstimate',
	'totalDuration',
	'activeTracker',
]);

interface CalendarMaterializationDraft {
	description: string;
	checkbox: IndexedTask['checkbox'];
	fieldValues: Record<string, string>;
	tags: string[];
}

interface MaterializationPlannerOptions {
	keyMappings?: KeyMapping[];
	priorities?: { label: string }[];
	pinnedCache?: PinnedCache | null;
}

interface ScalarRequirement {
	key: string;
	label: string;
	value: string;
}

interface ListRequirement {
	key: string;
	label: string;
	values: Set<string>;
	enforceAllAre: boolean;
}

interface RequirementCollection {
	scalarRequirements: Map<string, ScalarRequirement>;
	listRequirements: Map<string, ListRequirement>;
	unsupportedConditions: CalendarUnsupportedFilterCondition[];
}

export function filterTasksForCalendar(
	filterSet: FilterSet | null,
	tasks: IndexedTask[],
	priorities?: { label: string }[],
	pinnedCache?: PinnedCache | null,
	evaluationOptions?: FilterEvaluationOptions,
): IndexedTask[] {
	if (!filterSet) return tasks;
	return filterTasksOnly(stripFilterViewOnlyOptions(filterSet), tasks, priorities, pinnedCache, evaluationOptions);
}

export function buildCalendarFilterMaterializationPlan(
	filterSet: FilterSet | null,
	taskOrDraft: CalendarMaterializationDraft,
	options: MaterializationPlannerOptions = {},
): CalendarFilterMaterializationPlan {
	if (!filterSet) {
		return {
			filterSetId: '',
			filterSetName: 'No filter',
			outcome: 'noFilter',
			fieldChanges: [],
			unsupportedConditions: [],
			matchesFilterBefore: true,
			matchesFilterAfterSupportedChanges: true,
		};
	}

	const scopeFilterSet = stripFilterViewOnlyOptions(filterSet);
	const draft = cloneDraft(taskOrDraft);
	const hasProjectSerialScopeCondition = filterContainsProjectSerialScopeCondition(scopeFilterSet.rootGroup);
	const matchesFilterBefore = !hasProjectSerialScopeCondition && matchesFilter(scopeFilterSet, draft, options);
	if (matchesFilterBefore) {
		return {
			filterSetId: filterSet.id,
			filterSetName: filterSet.name,
			outcome: 'alreadyCompatible',
			fieldChanges: [],
			unsupportedConditions: [],
			matchesFilterBefore: true,
			matchesFilterAfterSupportedChanges: true,
		};
	}

	const requirements = collectMaterializationRequirements(scopeFilterSet, options.keyMappings ?? []);
	const fieldChanges = buildFieldChangesFromRequirements(draft, requirements);
	const nextDraft = applyCalendarFilterFieldChanges(draft, fieldChanges);
	const matchesFilterAfterSupportedChanges = !hasProjectSerialScopeCondition && matchesFilter(scopeFilterSet, nextDraft, options);

	let outcome: CalendarFilterMaterializationPlan['outcome'] = 'unsupportedOnly';
	if (fieldChanges.length > 0 && requirements.unsupportedConditions.length === 0 && matchesFilterAfterSupportedChanges) {
		outcome = 'fullyMaterializable';
	} else if (fieldChanges.length > 0) {
		outcome = 'partiallyMaterializable';
	} else if (requirements.unsupportedConditions.length > 0) {
		outcome = 'unsupportedOnly';
	}

	return {
		filterSetId: filterSet.id,
		filterSetName: filterSet.name,
		outcome,
		fieldChanges,
		unsupportedConditions: requirements.unsupportedConditions,
		matchesFilterBefore,
		matchesFilterAfterSupportedChanges,
	};
}

function filterContainsProjectSerialScopeCondition(node: FilterNode): boolean {
	if ('children' in node) return node.children.some(filterContainsProjectSerialScopeCondition);
	return node.fieldType === 'projectSerialScope';
}

export function applyCalendarFilterFieldChanges(
	draft: CalendarMaterializationDraft,
	fieldChanges: CalendarFilterFieldChange[],
): CalendarMaterializationDraft {
	const next = cloneDraft(draft);
	for (const change of fieldChanges) {
		if (change.key === 'tags') {
			next.tags = normalizeTagItems(parseListValue(change.nextValue));
			continue;
		}
		next.fieldValues[change.key] = change.nextValue;
	}
	return next;
}

export function extractCalendarFilterFieldPayload(
	fieldChanges: CalendarFilterFieldChange[],
): Record<string, string> {
	const payload: Record<string, string> = {};
	for (const change of fieldChanges) {
		payload[change.key] = change.nextValue;
	}
	return payload;
}

function cloneDraft(draft: CalendarMaterializationDraft): CalendarMaterializationDraft {
	return {
		description: draft.description,
		checkbox: draft.checkbox,
		fieldValues: { ...draft.fieldValues },
		tags: [...draft.tags],
	};
}

/**
 * When calendar or kanban surfaces apply a FilterSet, they consume it as pure
 * scope — only the match conditions (rootGroup / conditions / matchLogic) are
 * meaningful. Group, subgroup, and sort fields are filter-view presentation
 * concerns and must not leak into calendar / kanban behavior.
 */
export function stripFilterViewOnlyOptions(filterSet: FilterSet): FilterSet {
	return {
		...filterSet,
		sorts: [],
		sortBy: undefined,
		sortOrder: undefined,
		groupBy: undefined,
		groupOrder: undefined,
		subgroupBy: undefined,
		subgroupOrder: undefined,
	};
}

function matchesFilter(
	filterSet: FilterSet,
	draft: CalendarMaterializationDraft,
	options: MaterializationPlannerOptions,
): boolean {
	const syntheticTask: IndexedTask = {
		operonId: draft.fieldValues['operonId'] || 'calendar-filter-draft',
		description: draft.description,
		checkbox: draft.checkbox,
		fieldValues: { ...draft.fieldValues },
		tags: [...draft.tags],
		primary: {
			filePath: 'calendar-filter-draft.md',
			lineNumber: 0,
			format: 'inline',
		},
		datetimeModified: draft.fieldValues['datetimeModified'] || '',
		tier: 'hot',
	};
	return filterTasksOnly(
		filterSet,
		[syntheticTask],
		options.priorities,
		options.pinnedCache ?? null,
	).length > 0;
}

function collectMaterializationRequirements(filterSet: FilterSet, keyMappings: KeyMapping[]): RequirementCollection {
	const scalarRequirements = new Map<string, ScalarRequirement>();
	const listRequirements = new Map<string, ListRequirement>();
	const unsupportedConditions: CalendarUnsupportedFilterCondition[] = [];
	const conflictedScalarKeys = new Set<string>();

	const visitNode = (
		node: FilterNode,
		parentLogic: FilterGroup['logic'],
		materializablePath: boolean,
		blockedReason?: string,
	): void => {
		if ('children' in node) {
			const groupReason = !materializablePath
				? blockedReason
				: node.logic !== 'all'
					? t('calendar', 'materializationUnsupportedLogic', { logic: node.logic })
					: undefined;
			const nextMaterializablePath = materializablePath && node.logic === 'all';
			for (const child of node.children) {
				visitNode(child, node.logic, nextMaterializablePath, groupReason);
			}
			return;
		}

		const summary = formatConditionSummary(node, keyMappings);
		if (!materializablePath || parentLogic !== 'all') {
			unsupportedConditions.push({
				conditionId: node.id,
				summary,
				reason: blockedReason ?? t('calendar', 'materializationPureAllOnly'),
			});
			return;
		}

		const label = getFieldLabel(node.field, keyMappings);
		if (isConditionUnsupportedByField(node)) {
			unsupportedConditions.push({
				conditionId: node.id,
				summary,
				reason: t('calendar', 'materializationUnsafeField'),
			});
			return;
		}

		if ((node.fieldType === 'text' && node.operator === 'is') || (node.fieldType === 'number' && node.operator === 'eq')) {
			const exactValue = (node.value ?? '').trim();
			if (!exactValue) {
				unsupportedConditions.push({
					conditionId: node.id,
					summary,
					reason: t('calendar', 'materializationMissingValue'),
				});
				return;
			}

			const existing = scalarRequirements.get(node.field);
			if (existing && existing.value !== exactValue) {
				scalarRequirements.delete(node.field);
				conflictedScalarKeys.add(node.field);
				unsupportedConditions.push({
					conditionId: `conflict:${node.field}`,
					summary: t('calendar', 'materializationConflictingExact', { label }),
					reason: t('calendar', 'materializationConflictingExactReason'),
				});
				return;
			}
			if (!conflictedScalarKeys.has(node.field)) {
				scalarRequirements.set(node.field, {
					key: node.field,
					label,
					value: exactValue,
				});
			}
			return;
		}

		if ((node.fieldType === 'list' || node.fieldType === 'tags') && (node.operator === 'anyContains' || node.operator === 'allAre')) {
			const rawValue = (node.value ?? '').trim();
			if (!rawValue) {
				unsupportedConditions.push({
					conditionId: node.id,
					summary,
					reason: t('calendar', 'materializationMissingValue'),
				});
				return;
			}

			const normalizedValue = node.field === 'tags' ? normalizeTag(rawValue) : rawValue;
			const existing = listRequirements.get(node.field) ?? {
				key: node.field,
				label,
				values: new Set<string>(),
				enforceAllAre: false,
			};
			existing.values.add(normalizedValue);
			if (node.operator === 'allAre') {
				existing.enforceAllAre = true;
			}
			listRequirements.set(node.field, existing);
			return;
		}

		unsupportedConditions.push({
			conditionId: node.id,
			summary,
			reason: t('calendar', 'materializationExactOrAdditiveOnly'),
		});
	};

	const rootGroup = filterSet.rootGroup;
	for (const child of rootGroup.children) {
		visitNode(child, rootGroup.logic, rootGroup.logic === 'all', rootGroup.logic === 'all'
			? undefined
			: t('calendar', 'materializationUnsupportedLogic', { logic: rootGroup.logic }));
	}

	return {
		scalarRequirements,
		listRequirements,
		unsupportedConditions,
	};
}

function buildFieldChangesFromRequirements(
	draft: CalendarMaterializationDraft,
	requirements: RequirementCollection,
): CalendarFilterFieldChange[] {
	const changes: CalendarFilterFieldChange[] = [];

	for (const requirement of requirements.scalarRequirements.values()) {
		const currentValue = (draft.fieldValues[requirement.key] ?? '').trim();
		if (currentValue === requirement.value) continue;
		changes.push({
			key: requirement.key,
			label: requirement.label,
			changeKind: currentValue ? 'update' : 'add',
			currentValue: currentValue || null,
			nextValue: requirement.value,
		});
	}

	for (const requirement of requirements.listRequirements.values()) {
		const currentItems = requirement.key === 'tags'
			? normalizeTagItems(draft.tags)
			: parseListValue(draft.fieldValues[requirement.key] ?? '').map(item => item.trim()).filter(Boolean);
		const nextItems = [...currentItems];
		let changed = false;
		for (const value of requirement.values) {
			if (currentItems.includes(value)) continue;
			nextItems.push(value);
			changed = true;
		}
		if (!changed && !requirement.enforceAllAre) continue;

		if (requirement.enforceAllAre && currentItems.some(item => !requirement.values.has(item))) {
			requirements.unsupportedConditions.push({
				conditionId: `allAre:${requirement.key}`,
				summary: t('calendar', 'materializationAllAreSummary', {
					label: requirement.label,
					values: [...requirement.values].join(', '),
				}),
				reason: t('calendar', 'materializationAllAreReason'),
			});
		}

		if (!changed) continue;

		changes.push({
			key: requirement.key,
			label: requirement.label,
			changeKind: currentItems.length > 0 ? 'update' : 'add',
			currentValue: currentItems.length > 0 ? currentItems.join('; ') : null,
			nextValue: nextItems.join('; '),
		});
	}

	return changes.sort((left, right) => left.label.localeCompare(right.label) || left.key.localeCompare(right.key));
}

function formatConditionSummary(condition: FilterSetCondition, keyMappings: KeyMapping[]): string {
	const label = getFieldLabel(condition.field, keyMappings);
	const value = (condition.value ?? '').trim();
	return value ? `${label} ${condition.operator} ${value}` : `${label} ${condition.operator}`;
}

function getFieldLabel(key: string, keyMappings: KeyMapping[]): string {
	if (key === 'tags') return t('calendar', 'materializationFieldTags');
	if (key === 'checkbox') return t('calendar', 'materializationFieldCheckbox');
	if (key === 'description') return t('calendar', 'materializationFieldDescription');
	if (key === 'pinned') return t('calendar', 'materializationFieldPinned');
	return keyMappings.find(mapping => mapping.canonicalKey === key)?.visiblePropertyName || key;
}

function isConditionUnsupportedByField(condition: FilterSetCondition): boolean {
	if (isFilePropertyColumnKey(condition.field) || condition.field.startsWith('file.property:')) return true;
	if (condition.field === 'description' || condition.field === 'pinned' || condition.field === 'checkbox' || condition.fieldType === 'projectSerialScope') {
		return true;
	}
	if (CALENDAR_OWNED_FILTER_KEYS.has(condition.field)) return true;
	if (DERIVED_OR_INTERNAL_FILTER_KEYS.has(condition.field)) return true;
	if (condition.field.startsWith('repeat')) return true;
	return false;
}

function normalizeTag(rawTag: string): string {
	return rawTag.replace(/^#/, '').trim();
}

function normalizeTagItems(tags: string[]): string[] {
	return Array.from(new Set(tags.map(tag => normalizeTag(tag)).filter(Boolean)));
}
