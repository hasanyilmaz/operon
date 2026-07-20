import { CANONICAL_KEY_MAP } from '../types/keys';
import type { IndexedTask } from '../types/fields';
import type { KanbanPreset } from '../types/kanban';
import {
	isRetiredKeyMapping,
	type FilterGroup,
	type FilterNode,
	type FilterSet,
	type InlineTaskCompactChipItem,
	type KeyMapping,
	type TaskCreatorToolbarItem,
	type TaskEditorMobileCoreToolItem,
	type TaskEditorWorkflowPickerItem,
} from '../types/settings';

const MANAGED_CUSTOM_FIELD_TYPES = new Set<KeyMapping['type']>(['text', 'number', 'date', 'datetime', 'list', 'checkbox']);

export interface ManagedCustomFieldOption {
	field: string;
	label: string;
	type: KeyMapping['type'];
	mapping: KeyMapping;
}

export interface CustomFieldUsageSummary {
	canonicalKey: string;
	taskValueCount: number | null;
	filterNames: string[];
	kanbanPresetNames: string[];
	activeSurfaceKeys: CustomFieldUsageSurfaceKey[];
}

export type CustomFieldUsageSurfaceKey = 'editor' | 'creator' | 'chips' | 'kanbanSwimlane';

function matchesManagedCustomCanonicalKey(mappingKey: string, requestedKey: string): boolean {
	if (mappingKey === requestedKey) return true;
	const mappingComparable = mappingKey.trim().toLowerCase();
	const requestedComparable = requestedKey.trim().toLowerCase();
	return (mappingComparable === 'reminderdatetimes' || mappingComparable === 'reminderrules')
		&& mappingComparable === requestedComparable;
}

interface CustomFieldUsageSurfaceOptions {
	taskCreatorToolbar?: readonly TaskCreatorToolbarItem[];
	taskEditorWorkflowPickers?: readonly TaskEditorWorkflowPickerItem[];
	taskEditorMobileCoreTools?: readonly TaskEditorMobileCoreToolItem[];
	inlineTaskCompactChips?: readonly InlineTaskCompactChipItem[];
	taskFinderCompactChips?: readonly InlineTaskCompactChipItem[];
	filterTaskCompactChips?: readonly InlineTaskCompactChipItem[];
	kanbanTaskCompactChips?: readonly InlineTaskCompactChipItem[];
	taskWikilinkOverlayCompactChips?: readonly InlineTaskCompactChipItem[];
}

export function getManagedCustomKeyMapping(
	canonicalKey: string,
	keyMappings: readonly KeyMapping[] | null | undefined,
): KeyMapping | null {
	for (const mapping of getSafeKeyMappings(keyMappings)) {
		if (!matchesManagedCustomCanonicalKey(mapping.canonicalKey, canonicalKey)) continue;
		if (isRetiredKeyMapping(mapping.canonicalKey)) continue;
		if (mapping.isSystem !== false && CANONICAL_KEY_MAP.has(canonicalKey)) return null;
		return mapping;
	}
	if (CANONICAL_KEY_MAP.has(canonicalKey)) return null;
	return null;
}

export function isManagedCustomFieldMapping(mapping: KeyMapping | null | undefined): mapping is KeyMapping {
	if (!isSafeKeyMapping(mapping)) return false;
	return mapping.isSystem === false
		&& mapping.isInternal !== true
		&& !isRetiredKeyMapping(mapping.canonicalKey);
}

export function isManagedCustomFieldOptionType(mapping: KeyMapping | null | undefined): mapping is KeyMapping {
	if (!isSafeKeyMapping(mapping)) return false;
	return mapping.type !== 'checkbox';
}

export function getManagedCustomFieldMappings(
	keyMappings: readonly KeyMapping[] | null | undefined,
	options: { includeCheckbox?: boolean } = {},
): KeyMapping[] {
	return getSafeKeyMappings(keyMappings)
		.filter(mapping => isManagedCustomFieldMapping(mapping))
		.filter(mapping => options.includeCheckbox === true || isManagedCustomFieldOptionType(mapping))
		.sort(compareManagedCustomFieldMappings);
}

export function getManagedCustomFieldOptions(
	keyMappings: readonly KeyMapping[] | null | undefined,
	options: { includeCheckbox?: boolean } = {},
): ManagedCustomFieldOption[] {
	return getManagedCustomFieldMappings(keyMappings, options).map(toManagedCustomFieldOption);
}

export function getKanbanSwimlaneCustomFieldOptions(
	keyMappings: readonly KeyMapping[] | null | undefined,
): ManagedCustomFieldOption[] {
	return getManagedCustomFieldMappings(keyMappings)
		.filter(mapping => mapping.showInKanbanSwimlane === true)
		.map(toManagedCustomFieldOption);
}

function toManagedCustomFieldOption(mapping: KeyMapping): ManagedCustomFieldOption {
	return {
		field: mapping.canonicalKey,
		label: mapping.visiblePropertyName?.trim() || mapping.canonicalKey,
		type: mapping.type,
		mapping,
	};
}

export function getManagedCustomFieldOptionMapping(
	canonicalKey: string | null | undefined,
	keyMappings: readonly KeyMapping[] | null | undefined,
	options: { includeCheckbox?: boolean } = {},
): KeyMapping | null {
	if (!canonicalKey) return null;
	const mapping = getManagedCustomKeyMapping(canonicalKey, keyMappings);
	if (!mapping || !isManagedCustomFieldMapping(mapping)) return null;
	if (options.includeCheckbox !== true && !isManagedCustomFieldOptionType(mapping)) return null;
	return mapping;
}

export function isManagedTaskFieldCanonicalKey(
	canonicalKey: string,
	keyMappings: readonly KeyMapping[] | null | undefined,
): boolean {
	if (isRetiredKeyMapping(canonicalKey)) return false;
	if (CANONICAL_KEY_MAP.has(canonicalKey)) return true;
	return getManagedCustomKeyMapping(canonicalKey, keyMappings) !== null;
}

export function getManagedTaskFieldType(
	canonicalKey: string,
	keyMappings: readonly KeyMapping[] | null | undefined,
): KeyMapping['type'] | null {
	if (isRetiredKeyMapping(canonicalKey)) return null;
	const customMapping = getManagedCustomKeyMapping(canonicalKey, keyMappings);
	if (customMapping?.isSystem === false) return customMapping.type;
	const canonicalDef = CANONICAL_KEY_MAP.get(canonicalKey);
	if (canonicalDef) return canonicalDef.type;
	return customMapping?.type ?? null;
}

export function getManagedCustomKeyOrder(
	canonicalKey: string,
	keyMappings: readonly KeyMapping[] | null | undefined,
): number | null {
	const mappings = getSafeKeyMappings(keyMappings);
	for (let index = 0; index < mappings.length; index += 1) {
		const mapping = mappings[index];
		if (!mapping || !matchesManagedCustomCanonicalKey(mapping.canonicalKey, canonicalKey)) continue;
		if (isRetiredKeyMapping(mapping.canonicalKey)) return null;
		if (mapping.isSystem !== false && CANONICAL_KEY_MAP.has(mapping.canonicalKey)) return null;
		if (typeof mapping.customOrder === 'number' && Number.isFinite(mapping.customOrder)) {
			return Math.max(0, Math.floor(mapping.customOrder));
		}
		return index;
	}
	return null;
}

export function compareManagedCustomFieldMappings(left: KeyMapping, right: KeyMapping): number {
	const leftOrder = typeof left.customOrder === 'number' && Number.isFinite(left.customOrder)
		? left.customOrder
		: Number.MAX_SAFE_INTEGER;
	const rightOrder = typeof right.customOrder === 'number' && Number.isFinite(right.customOrder)
		? right.customOrder
		: Number.MAX_SAFE_INTEGER;
	if (leftOrder !== rightOrder) return leftOrder - rightOrder;
	return left.canonicalKey.localeCompare(right.canonicalKey);
}

export function buildCustomFieldUsageSummaries(options: {
	keyMappings: readonly KeyMapping[];
	filterSets: readonly FilterSet[];
	kanbanPresets: readonly KanbanPreset[];
	tasks?: readonly Pick<IndexedTask, 'fieldValues'>[] | null;
	surfaces?: CustomFieldUsageSurfaceOptions;
}): CustomFieldUsageSummary[] {
	return getManagedCustomFieldMappings(options.keyMappings, { includeCheckbox: true }).map(mapping => ({
		canonicalKey: mapping.canonicalKey,
		taskValueCount: options.tasks ? countTasksWithCustomFieldValue(options.tasks, mapping.canonicalKey) : null,
		filterNames: collectFilterSetNamesReferencingField(options.filterSets, mapping.canonicalKey),
		kanbanPresetNames: collectKanbanPresetNamesReferencingField(options.kanbanPresets, mapping.canonicalKey),
		activeSurfaceKeys: getActiveCustomFieldSurfaceKeys(mapping, options.surfaces),
	}));
}

export function moveCustomKeyMappingOrder(
	keyMappings: readonly KeyMapping[] | null | undefined,
	canonicalKey: string,
	direction: -1 | 1,
): KeyMapping[] {
	const safeMappings = getSafeKeyMappings(keyMappings);
	const customMappings = getManagedCustomFieldMappings(keyMappings, { includeCheckbox: true });
	const currentIndex = customMappings.findIndex(mapping => mapping.canonicalKey === canonicalKey);
	const targetIndex = currentIndex + direction;
	if (currentIndex < 0 || targetIndex < 0 || targetIndex >= customMappings.length) {
		return compactCustomKeyMappingOrders(safeMappings);
	}
	const nextCustomMappings = [...customMappings];
	const [moved] = nextCustomMappings.splice(currentIndex, 1);
	if (!moved) return compactCustomKeyMappingOrders(safeMappings);
	nextCustomMappings.splice(targetIndex, 0, moved);
	const nextOrder = new Map(nextCustomMappings.map((mapping, index) => [mapping.canonicalKey, index] as const));
	return safeMappings.map(mapping => {
		const order = nextOrder.get(mapping.canonicalKey);
		return order === undefined ? mapping : { ...mapping, customOrder: order };
	});
}

export function compactCustomKeyMappingOrders(keyMappings: readonly KeyMapping[] | null | undefined): KeyMapping[] {
	const safeMappings = getSafeKeyMappings(keyMappings);
	const customMappings = getManagedCustomFieldMappings(keyMappings, { includeCheckbox: true });
	const nextOrder = new Map(customMappings.map((mapping, index) => [mapping.canonicalKey, index] as const));
	return safeMappings.map(mapping => {
		const order = nextOrder.get(mapping.canonicalKey);
		return order === undefined ? mapping : { ...mapping, customOrder: order };
	});
}

export function normalizeManagedFieldValue(value: unknown): string {
	if (typeof value === 'string') return value.trim();
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	if (Array.isArray(value)) {
		return value
			.map(item => normalizeManagedFieldValue(item))
			.filter(Boolean)
			.join('; ');
	}
	return '';
}

function getSafeKeyMappings(keyMappings: readonly KeyMapping[] | null | undefined): KeyMapping[] {
	if (!Array.isArray(keyMappings)) return [];
	return keyMappings.filter(isSafeKeyMapping);
}

function isSafeKeyMapping(mapping: KeyMapping | null | undefined): mapping is KeyMapping {
	return !!mapping
		&& typeof mapping === 'object'
		&& typeof mapping.canonicalKey === 'string'
		&& mapping.canonicalKey.trim().length > 0
		&& typeof mapping.visiblePropertyName === 'string'
		&& MANAGED_CUSTOM_FIELD_TYPES.has(mapping.type);
}

function countTasksWithCustomFieldValue(
	tasks: readonly Pick<IndexedTask, 'fieldValues'>[],
	canonicalKey: string,
): number {
	return tasks.filter(task => (task.fieldValues[canonicalKey] ?? '').trim().length > 0).length;
}

function collectFilterSetNamesReferencingField(
	filterSets: readonly FilterSet[],
	canonicalKey: string,
): string[] {
	const names: string[] = [];
	for (const filterSet of filterSets) {
		if (!filterSetReferencesField(filterSet, canonicalKey)) continue;
		names.push(filterSet.name.trim() || filterSet.id);
	}
	return names;
}

function filterSetReferencesField(filterSet: FilterSet, canonicalKey: string): boolean {
	if (filterSet.rootGroup && filterNodeReferencesField(filterSet.rootGroup, canonicalKey)) return true;
	if (filterSet.conditions.some(node => filterNodeReferencesField(node, canonicalKey))) return true;
	if (filterSet.sorts.some(sort => sort.field === canonicalKey)) return true;
	if (filterSet.sortBy === canonicalKey) return true;
	if (filterSet.groupBy === canonicalKey) return true;
	return filterSet.subgroupBy === canonicalKey;
}

function filterNodeReferencesField(node: FilterNode, canonicalKey: string): boolean {
	if (isFilterGroupNode(node)) {
		return node.children.some(child => filterNodeReferencesField(child, canonicalKey));
	}
	return node.field === canonicalKey;
}

function isFilterGroupNode(node: FilterNode): node is FilterGroup {
	return Array.isArray((node as FilterGroup).children);
}

function collectKanbanPresetNamesReferencingField(
	kanbanPresets: readonly KanbanPreset[],
	canonicalKey: string,
): string[] {
	const names: string[] = [];
	for (const preset of kanbanPresets) {
		if (preset.swimlaneBy !== canonicalKey && !preset.sortRules.some(rule => rule.field === canonicalKey)) {
			continue;
		}
		names.push(preset.name.trim() || preset.id);
	}
	return names;
}

function getActiveCustomFieldSurfaceKeys(
	mapping: KeyMapping,
	surfaces: CustomFieldUsageSurfaceOptions | undefined,
): CustomFieldUsageSurfaceKey[] {
	if (!isManagedCustomFieldOptionType(mapping)) return [];
	const activeSurfaces: CustomFieldUsageSurfaceKey[] = [];
	if (isSurfaceVisible(
		mapping,
		[surfaces?.taskEditorWorkflowPickers, surfaces?.taskEditorMobileCoreTools],
		mapping.showInEditor !== false,
	)) activeSurfaces.push('editor');
	if (isSurfaceVisible(
		mapping,
		[surfaces?.taskCreatorToolbar],
		mapping.showInCreator !== false,
	)) activeSurfaces.push('creator');
	if (isSurfaceVisible(
		mapping,
		[
			surfaces?.inlineTaskCompactChips,
			surfaces?.taskFinderCompactChips,
			surfaces?.filterTaskCompactChips,
			surfaces?.kanbanTaskCompactChips,
			surfaces?.taskWikilinkOverlayCompactChips,
		],
		mapping.showInChips === true,
	)) activeSurfaces.push('chips');
	if (mapping.showInKanbanSwimlane === true) activeSurfaces.push('kanbanSwimlane');
	return activeSurfaces;
}

function isSurfaceVisible(
	mapping: KeyMapping,
	surfaceGroups: Array<readonly { key: string; visible: boolean }[] | undefined>,
	fallback: boolean,
): boolean {
	const providedGroups = surfaceGroups.filter((group): group is readonly { key: string; visible: boolean }[] => Array.isArray(group));
	if (providedGroups.length === 0) return fallback;
	const matches = providedGroups.flatMap(group => group.filter(item => item.key === mapping.canonicalKey));
	return matches.length > 0 ? matches.some(item => item.visible) : fallback;
}
