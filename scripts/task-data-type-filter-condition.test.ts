import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { JsonValue } from '../src/agent-runtime/contracts/v1/primitives';
import { evaluateFilterSet, getOperatorsForField } from '../src/core/filter-evaluator';
import {
	decodeFilterGroupClipboard,
	encodeFilterGroupClipboard,
} from '../src/core/filter-group-clipboard';
import { validateOperonSettingsBackupGroupsV1 } from '../src/core/settings-backup-group-validation';
import {
	evaluateTaskDataTypeCondition,
	resolveTaskDataType,
	TASK_DATA_TYPE_FIELD_KEY,
} from '../src/core/task-data-type';
import type { IndexedTask } from '../src/types/fields';
import {
	cloneFilterSet,
	normalizeFilterSet,
	type FilterGroup,
	type FilterSet,
	type FilterSetCondition,
} from '../src/types/settings';
import { getTableTaskDataTypeValue } from '../src/ui/table/table-value-adapter';

let assertions = 0;

function equal<T>(actual: T, expected: T, message: string): void {
	assert.equal(actual, expected, message);
	assertions += 1;
}

function task(operonId: string, format: IndexedTask['primary']['format']): IndexedTask {
	return {
		operonId,
		description: operonId,
		checkbox: 'open',
		fieldValues: {},
		tags: [],
		primary: {
			filePath: `${operonId}.md`,
			lineNumber: format === 'inline' ? 4 : 0,
			format,
		},
		datetimeModified: '2026-08-30T20:00:00',
		tier: 'hot',
	};
}

function filter(condition: FilterSetCondition): FilterSet {
	return {
		id: `filter-${condition.id}`,
		name: condition.id,
		rootGroup: { id: 'root', logic: 'all', children: [condition] },
		sorts: [],
		matchLogic: 'all',
		conditions: [condition],
	};
}

function matchedIds(condition: FilterSetCondition, tasks: IndexedTask[]): string[] {
	return evaluateFilterSet(filter(condition), tasks).map(candidate => candidate.operonId);
}

const inlineTask = task('inline-task', 'inline');
const fileTask = task('file-task', 'yaml');
const tasks = [inlineTask, fileTask];

equal(resolveTaskDataType(inlineTask), 'inline', 'Inline source resolves to inline.');
equal(resolveTaskDataType(fileTask), 'file', 'YAML source resolves to file.');
equal(getTableTaskDataTypeValue(inlineTask), 'inline', 'Table keeps the shared inline value.');
equal(getTableTaskDataTypeValue(fileTask), 'file', 'Table keeps the shared file value.');
assert.deepEqual(
	getOperatorsForField(TASK_DATA_TYPE_FIELD_KEY, 'text').map(operator => operator.id),
	['is', 'isNot'],
	'Task Data Type exposes only is and isNot.',
);
assertions += 1;

equal(evaluateTaskDataTypeCondition(inlineTask, 'is', 'inline'), true, 'Inline is inline.');
equal(evaluateTaskDataTypeCondition(fileTask, 'is', 'inline'), false, 'File is not inline.');
equal(evaluateTaskDataTypeCondition(fileTask, 'isNot', 'inline'), true, 'File isNot inline.');
equal(evaluateTaskDataTypeCondition(inlineTask, 'isNot', 'inline'), false, 'Inline is not isNot inline.');
equal(evaluateTaskDataTypeCondition(inlineTask, 'contains', 'inline'), false, 'Unsupported operators fail closed.');
equal(evaluateTaskDataTypeCondition(inlineTask, 'is', 'yaml'), false, 'Unsupported values fail closed.');

equal(
	matchedIds({ id: 'inline-is', field: TASK_DATA_TYPE_FIELD_KEY, fieldType: 'text', operator: 'is', value: 'inline' }, tasks).join(','),
	'inline-task',
	'FilterSet is inline matches only inline tasks.',
);
equal(
	matchedIds({ id: 'file-is', field: TASK_DATA_TYPE_FIELD_KEY, fieldType: 'text', operator: 'is', value: 'file' }, tasks).join(','),
	'file-task',
	'FilterSet is file matches only file tasks.',
);
equal(
	matchedIds({ id: 'inline-is-not', field: TASK_DATA_TYPE_FIELD_KEY, fieldType: 'text', operator: 'isNot', value: 'inline' }, tasks).join(','),
	'file-task',
	'FilterSet isNot inline matches only file tasks.',
);
equal(
	matchedIds({ id: 'invalid-operator', field: TASK_DATA_TYPE_FIELD_KEY, fieldType: 'text', operator: 'contains', value: 'inline' }, tasks).length,
	0,
	'Invalid FilterSet operators fail closed.',
);
equal(
	matchedIds({ id: 'invalid-value', field: TASK_DATA_TYPE_FIELD_KEY, fieldType: 'text', operator: 'is', value: 'yaml' }, tasks).length,
	0,
	'Invalid FilterSet values fail closed.',
);
equal(
	matchedIds({ id: 'invalid-type', field: TASK_DATA_TYPE_FIELD_KEY, fieldType: 'number', operator: 'is', value: 'inline' }, tasks).length,
	0,
	'Non-text Task Data Type conditions fail closed.',
);

const condition: FilterSetCondition = {
	id: 'task-data-type-condition',
	field: TASK_DATA_TYPE_FIELD_KEY,
	fieldType: 'text',
	operator: 'is',
	value: 'inline',
};
const normalized = normalizeFilterSet(filter(condition));
equal(normalized?.conditions[0]?.field, TASK_DATA_TYPE_FIELD_KEY, 'Normalization preserves the synthetic field key.');
equal(normalized?.conditions[0]?.fieldType, 'text', 'Normalization preserves the text field type.');
equal(normalized?.conditions[0]?.operator, 'is', 'Normalization preserves the supported operator.');
equal(normalized?.conditions[0]?.value, 'inline', 'Normalization preserves the supported value.');
equal(cloneFilterSet(filter(condition)).conditions[0]?.value, 'inline', 'Cloning preserves the supported value.');

const normalizedInvalidValue = normalizeFilterSet(filter({ ...condition, value: 'yaml' }));
equal(normalizedInvalidValue?.conditions[0]?.value, undefined, 'Normalization removes unsupported values.');
const normalizedInvalidType = normalizeFilterSet(filter({ ...condition, fieldType: 'number' }));
equal(normalizedInvalidType?.conditions[0]?.fieldType, 'text', 'Normalization restores the canonical text type.');

const clipboardGroup: FilterGroup = { id: 'clipboard-root', logic: 'all', children: [condition] };
let clipboardId = 0;
const decodeOptions = {
	createGroupId: () => `group-${clipboardId += 1}`,
	createConditionId: () => `condition-${clipboardId += 1}`,
	isOperatorAllowed: (field: string, fieldType: FilterSetCondition['fieldType'], operator: string) => (
		getOperatorsForField(field, fieldType).some(candidate => candidate.id === operator)
	),
};
const clipboardDecoded = decodeFilterGroupClipboard(encodeFilterGroupClipboard(clipboardGroup), decodeOptions);
equal(clipboardDecoded.ok, true, 'Clipboard round-trip accepts a valid Task Data Type condition.');
if (clipboardDecoded.ok) {
	const decodedCondition = clipboardDecoded.group.children[0] as FilterSetCondition;
	equal(decodedCondition.field, TASK_DATA_TYPE_FIELD_KEY, 'Clipboard preserves the synthetic field key.');
	equal(decodedCondition.value, 'inline', 'Clipboard preserves the supported value.');
}
const invalidClipboardPayload = JSON.parse(encodeFilterGroupClipboard(clipboardGroup)) as {
	group: { children: Array<{ value?: string }> };
};
invalidClipboardPayload.group.children[0]!.value = 'yaml';
equal(
	decodeFilterGroupClipboard(JSON.stringify(invalidClipboardPayload), decodeOptions).ok,
	false,
	'Clipboard rejects unsupported Task Data Type values.',
);

function backupGroups(filterSet: FilterSet): Parameters<typeof validateOperonSettingsBackupGroupsV1>[0] {
	return {
		filters: {
			codecVersion: 1,
			data: JSON.parse(JSON.stringify({ filterSets: [filterSet] })) as JsonValue,
		},
	};
}

equal(
	validateOperonSettingsBackupGroupsV1(backupGroups(filter(condition))).ok,
	true,
	'Backup validation accepts Task Data Type conditions.',
);
const sortFilter = filter(condition);
sortFilter.sorts = [{ field: TASK_DATA_TYPE_FIELD_KEY, order: 'asc' }];
const invalidSortBackup = validateOperonSettingsBackupGroupsV1(backupGroups(sortFilter));
equal(invalidSortBackup.ok, false, 'Backup validation rejects Task Data Type sort references.');
equal(
	invalidSortBackup.diagnostics.some(diagnostic => diagnostic.message.includes('supported only in Filter conditions')),
	true,
	'Backup validation explains the condition-only boundary.',
);

const filterModalSource = readFileSync('src/ui/filter-set-modal.ts', 'utf8');
const conditionOnlyStart = filterModalSource.indexOf('if (includeConditionOnly) {');
const conditionOnlyEnd = filterModalSource.indexOf('\n\n\t\tconst mappingCandidates', conditionOnlyStart);
const conditionOnlyBlock = filterModalSource.slice(conditionOnlyStart, conditionOnlyEnd);
equal(conditionOnlyBlock.includes('TASK_DATA_TYPE_FIELD_KEY'), true, 'Condition-only picker options include Task Data Type.');
equal(filterModalSource.includes("this.getFieldOptions(false, true)"), true, 'Sort and group continue using non-condition field options.');
equal(filterModalSource.includes("{ value: 'inline', label: 'inline' }"), true, 'The value picker includes inline.');
equal(filterModalSource.includes("{ value: 'file', label: 'file' }"), true, 'The value picker includes file.');
equal(filterModalSource.includes('operon-task-data-type-value-select'), true, 'The value picker has a dedicated stable selector.');

console.log(`Task Data Type filter condition: ${assertions}/${assertions} assertions passed`);
