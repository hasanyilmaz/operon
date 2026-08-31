import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { JsonValue } from '../src/agent-runtime/contracts/v1/primitives';
import { evaluateFilterSet, getOperatorsForField } from '../src/core/filter-evaluator';
import {
	decodeFilterGroupClipboard,
	encodeFilterGroupClipboard,
} from '../src/core/filter-group-clipboard';
import {
	evaluatePlainCheckboxesCondition,
	PLAIN_CHECKBOXES_FILTER_FIELD_KEY,
} from '../src/core/plain-checkbox-filter';
import { validateOperonSettingsBackupGroupsV1 } from '../src/core/settings-backup-group-validation';
import type { IndexedTask, PlainCheckboxProgress } from '../src/types/fields';
import {
	cloneFilterSet,
	normalizeFilterSet,
	type FilterGroup,
	type FilterSet,
	type FilterSetCondition,
} from '../src/types/settings';

let assertions = 0;

function equal<T>(actual: T, expected: T, message: string): void {
	assert.equal(actual, expected, message);
	assertions += 1;
}

function task(
	operonId: string,
	progress?: PlainCheckboxProgress,
	format: IndexedTask['primary']['format'] = 'inline',
): IndexedTask {
	return {
		operonId,
		description: operonId,
		checkbox: 'open',
		fieldValues: {},
		tags: [],
		primary: { filePath: `${operonId}.md`, lineNumber: 0, format },
		datetimeModified: '2026-08-31T12:00:00',
		tier: 'hot',
		...(progress ? { plainCheckboxProgress: progress } : {}),
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

function matchedIds(operator: string, tasks: IndexedTask[], fieldType: FilterSetCondition['fieldType'] = 'checkbox'): string[] {
	return evaluateFilterSet(filter({
		id: `plain-checkboxes-${operator}`,
		field: PLAIN_CHECKBOXES_FILTER_FIELD_KEY,
		fieldType,
		operator,
	}), tasks).map(candidate => candidate.operonId);
}

const absent = task('absent');
const open = task('open', { total: 2, completed: 0 });
const mixed = task('mixed', { total: 3, completed: 2 });
const closed = task('closed', { total: 2, completed: 2 });
const fileClosed = task('file-closed', { total: 3, completed: 3 }, 'yaml');
const tasks = [absent, open, mixed, closed];

assert.deepEqual(
	getOperatorsForField(PLAIN_CHECKBOXES_FILTER_FIELD_KEY, 'checkbox').map(operator => operator.id),
	['hasOpen', 'allClosed', 'exists'],
	'Plain Checkboxes exposes only its three aggregate operators.',
);
assertions += 1;

equal(evaluatePlainCheckboxesCondition(absent, 'exists'), false, 'Missing progress does not exist.');
equal(evaluatePlainCheckboxesCondition(open, 'hasOpen'), true, 'An all-open group has open checkboxes.');
equal(evaluatePlainCheckboxesCondition(mixed, 'hasOpen'), true, 'A mixed group has open checkboxes.');
equal(evaluatePlainCheckboxesCondition(closed, 'hasOpen'), false, 'An all-closed group has no open checkboxes.');
equal(evaluatePlainCheckboxesCondition(closed, 'allClosed'), true, 'An all-closed group is closed.');
equal(evaluatePlainCheckboxesCondition(mixed, 'allClosed'), false, 'A mixed group is not all closed.');
equal(evaluatePlainCheckboxesCondition(open, 'exists'), true, 'A non-empty group exists.');
equal(evaluatePlainCheckboxesCondition(open, 'unknown'), false, 'Unknown operators fail closed.');

equal(matchedIds('hasOpen', tasks).join(','), 'open,mixed', 'FilterSet hasOpen matches open groups.');
equal(matchedIds('allClosed', tasks).join(','), 'closed', 'FilterSet allClosed matches only complete groups.');
equal(matchedIds('exists', tasks).join(','), 'open,mixed,closed', 'FilterSet exists matches every non-empty group.');
equal(matchedIds('allClosed', [open, fileClosed]).join(','), 'file-closed', 'File Task body progress uses the same allClosed condition.');
equal(matchedIds('hasOpen', [open, fileClosed]).join(','), 'open', 'Inline task pop-over progress uses the same hasOpen condition.');
equal(matchedIds('unknown', tasks).length, 0, 'Unknown FilterSet operators fail closed.');
equal(matchedIds('exists', tasks, 'text').length, 0, 'Wrong field types fail closed.');

for (const progress of [
	{ total: 0, completed: 0 },
	{ total: 1, completed: -1 },
	{ total: 1, completed: 2 },
	{ total: 1.5, completed: 1 },
]) {
	equal(
		evaluatePlainCheckboxesCondition(task('invalid', progress), 'exists'),
		false,
		`Incoherent progress ${JSON.stringify(progress)} fails closed.`,
	);
}

const condition: FilterSetCondition = {
	id: 'plain-checkboxes-condition',
	field: PLAIN_CHECKBOXES_FILTER_FIELD_KEY,
	fieldType: 'checkbox',
	operator: 'hasOpen',
};
const normalized = normalizeFilterSet(filter({
	...condition,
	fieldType: 'text',
	value: 'ignored',
	values: ['ignored'],
}));
equal(normalized?.conditions[0]?.field, PLAIN_CHECKBOXES_FILTER_FIELD_KEY, 'Normalization preserves the synthetic field key.');
equal(normalized?.conditions[0]?.fieldType, 'checkbox', 'Normalization restores the canonical checkbox type.');
equal(normalized?.conditions[0]?.operator, 'hasOpen', 'Normalization preserves the supported operator.');
equal(normalized?.conditions[0]?.value, undefined, 'Normalization removes a scalar value.');
equal(normalized?.conditions[0]?.values, undefined, 'Normalization removes multiple values.');
const clonedCondition = cloneFilterSet(filter(condition)).conditions[0];
equal(clonedCondition?.field, PLAIN_CHECKBOXES_FILTER_FIELD_KEY, 'Cloning preserves the synthetic field key.');
equal(clonedCondition?.operator, 'hasOpen', 'Cloning preserves the supported operator.');
equal(clonedCondition?.value, undefined, 'Cloning keeps the condition valueless.');

const clipboardGroup: FilterGroup = { id: 'clipboard-root', logic: 'all', children: [condition] };
let clipboardId = 0;
const decodeOptions = {
	createGroupId: () => `group-${clipboardId += 1}`,
	createConditionId: () => `condition-${clipboardId += 1}`,
	isOperatorAllowed: (field: string, fieldType: FilterSetCondition['fieldType'], operator: string) => (
		getOperatorsForField(field, fieldType).some(candidate => candidate.id === operator)
	),
};
const clipboardEncoded = encodeFilterGroupClipboard(clipboardGroup);
const clipboardDecoded = decodeFilterGroupClipboard(clipboardEncoded, decodeOptions);
equal(clipboardDecoded.ok, true, 'Clipboard round-trip accepts a valid Plain Checkboxes condition.');
if (clipboardDecoded.ok) {
	const decodedCondition = clipboardDecoded.group.children[0] as FilterSetCondition;
	equal(decodedCondition.field, PLAIN_CHECKBOXES_FILTER_FIELD_KEY, 'Clipboard preserves the synthetic field key.');
	equal(decodedCondition.fieldType, 'checkbox', 'Clipboard preserves the checkbox field type.');
	equal(decodedCondition.operator, 'hasOpen', 'Clipboard preserves the supported operator.');
	equal(decodedCondition.value, undefined, 'Clipboard preserves the valueless contract.');
}

function mutateClipboardCondition(mutator: (target: Record<string, unknown>) => void): string {
	const payload = JSON.parse(clipboardEncoded) as { group: { children: Record<string, unknown>[] } };
	mutator(payload.group.children[0]!);
	return JSON.stringify(payload);
}

equal(
	decodeFilterGroupClipboard(mutateClipboardCondition(target => { target.fieldType = 'text'; }), decodeOptions).ok,
	false,
	'Clipboard rejects a non-checkbox field type.',
);
equal(
	decodeFilterGroupClipboard(mutateClipboardCondition(target => { target.operator = 'isOpen'; }), decodeOptions).ok,
	false,
	'Clipboard rejects unsupported operators.',
);
equal(
	decodeFilterGroupClipboard(mutateClipboardCondition(target => { target.value = 'open'; }), decodeOptions).ok,
	false,
	'Clipboard rejects scalar values.',
);
equal(
	decodeFilterGroupClipboard(mutateClipboardCondition(target => { target.values = ['open']; }), decodeOptions).ok,
	false,
	'Clipboard rejects multiple values.',
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
	'Backup validation accepts a valid Plain Checkboxes condition.',
);
for (const [label, invalidCondition] of [
	['field type', { ...condition, fieldType: 'text' }],
	['operator', { ...condition, operator: 'isOpen' }],
	['scalar value', { ...condition, value: 'open' }],
	['multiple values', { ...condition, values: ['open'] }],
] as Array<[string, FilterSetCondition]>) {
	equal(
		validateOperonSettingsBackupGroupsV1(backupGroups(filter(invalidCondition))).ok,
		false,
		`Backup validation rejects an invalid Plain Checkboxes ${label}.`,
	);
}
for (const presentation of ['sort', 'group', 'subgroup'] as const) {
	const invalidFilter = filter(condition);
	if (presentation === 'sort') invalidFilter.sorts = [{ field: PLAIN_CHECKBOXES_FILTER_FIELD_KEY, order: 'asc' }];
	if (presentation === 'group') invalidFilter.groupBy = PLAIN_CHECKBOXES_FILTER_FIELD_KEY;
	if (presentation === 'subgroup') invalidFilter.subgroupBy = PLAIN_CHECKBOXES_FILTER_FIELD_KEY;
	const result = validateOperonSettingsBackupGroupsV1(backupGroups(invalidFilter));
	equal(result.ok, false, `Backup validation rejects Plain Checkboxes ${presentation} references.`);
	equal(
		result.diagnostics.some(diagnostic => diagnostic.message.includes('supported only in Filter conditions')),
		true,
		`Backup validation explains the condition-only boundary for ${presentation}.`,
	);
}

const englishLocale = JSON.parse(readFileSync('i18n/locales/en.json', 'utf8')) as {
	filterSets: Record<string, string>;
};
equal(englishLocale.filterSets.fieldCheckbox, 'Operon Task', 'The existing Checkbox condition is labeled Operon Task.');
equal(englishLocale.filterSets.fieldPlainCheckboxes, 'Plain Checkboxes', 'The new field is labeled Plain Checkboxes.');
equal(englishLocale.filterSets.operator_hasOpen, 'has open', 'The open operator uses the approved label.');
equal(englishLocale.filterSets.operator_allClosed, 'are all closed', 'The closed operator uses the approved label.');
equal(englishLocale.filterSets.operator_exists, 'exist', 'The existence operator uses the approved label.');

const filterModalSource = readFileSync('src/ui/filter-set-modal.ts', 'utf8');
const conditionOnlyStart = filterModalSource.indexOf('if (includeConditionOnly) {');
const conditionOnlyEnd = filterModalSource.indexOf('\n\n\t\tconst mappingCandidates', conditionOnlyStart);
const conditionOnlyBlock = filterModalSource.slice(conditionOnlyStart, conditionOnlyEnd);
equal(conditionOnlyBlock.includes('PLAIN_CHECKBOXES_FILTER_FIELD_KEY'), true, 'Condition-only picker options include Plain Checkboxes.');
equal(filterModalSource.includes('this.getFieldOptions(false, true)'), true, 'Sort and group continue using non-condition field options.');
equal(filterModalSource.includes("t('filterSets', 'fieldCheckbox')"), true, 'The existing Operon Task condition keeps its field translation key.');

const tableFieldCatalogSource = readFileSync('src/ui/table/table-field-catalog.ts', 'utf8');
const taskProgressTracksSource = readFileSync('src/ui/task-progress-tracks.ts', 'utf8');
equal(taskProgressTracksSource.includes("CHECKBOX_PROGRESS_COLUMN_KEY = 'checkboxProgress'"), true, 'Table Checkbox Progress keeps its technical field key.');
equal(tableFieldCatalogSource.includes("label: 'Checkbox Progress'"), true, 'Table Checkbox Progress keeps its label.');
assert.deepEqual(
	getOperatorsForField('checkbox', 'checkbox').map(operator => operator.id),
	['isOpen', 'isDone', 'isCancelled'],
	'The existing Operon Task condition keeps its operators.',
);
assertions += 1;
equal(PLAIN_CHECKBOXES_FILTER_FIELD_KEY === '__plainCheckboxes', true, 'Plain Checkboxes keeps its distinct technical field key.');

console.log(`Plain Checkboxes filter condition: ${assertions}/${assertions} assertions passed`);
