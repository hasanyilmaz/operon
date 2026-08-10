import assert from 'node:assert/strict';
import type { IndexedTask } from '../src/types/fields';
import { createTableGroupPathKey, type TableQueryGroup, type TableQuerySubgroup } from '../src/systems/table-query';
import { buildTableRenderItems, buildTableTaskOrdinalMap, type TableRenderItem } from '../src/ui/table/table-surface';
import { createTableTaskLookup } from '../src/ui/table/table-value-adapter';

let assertions = 0;
function equal<T>(actual: T, expected: T, message?: string): void {
	message === undefined ? assert.equal(actual, expected) : assert.equal(actual, expected, message);
	assertions += 1;
}
function deepEqual(actual: unknown, expected: unknown, message?: string): void {
	message === undefined ? assert.deepEqual(actual, expected) : assert.deepEqual(actual, expected, message);
	assertions += 1;
}
function ok(value: unknown, message?: string): asserts value {
	message === undefined ? assert.ok(value) : assert.ok(value, message);
	assertions += 1;
}

function task(operonId: string, parentTask = ''): IndexedTask {
	return {
		operonId,
		description: operonId,
		checkbox: 'open',
		fieldValues: parentTask ? { parentTask } : {},
		tags: [],
		primary: { filePath: `${operonId}.md`, lineNumber: 0, format: 'yaml' },
		datetimeModified: '2026-08-10T00:00:00.000Z',
		tier: 'hot',
	};
}

function subgroup(options: Partial<TableQuerySubgroup> & Pick<TableQuerySubgroup, 'key' | 'fieldKey' | 'value'>): TableQuerySubgroup {
	return {
		label: options.value,
		isNoValue: false,
		sortValue: options.value,
		count: options.rows?.length ?? 0,
		rows: [],
		...options,
	};
}

function group(options: Partial<TableQueryGroup> & Pick<TableQueryGroup, 'key' | 'fieldKey' | 'value'>): TableQueryGroup {
	return { ...subgroup(options), ...options };
}

function kinds(items: readonly TableRenderItem[]): string[] {
	return items.map(item => item.kind);
}

function parentContexts(items: readonly TableRenderItem[]): Extract<TableRenderItem, { kind: 'parentContext' }>[] {
	return items.filter((item): item is Extract<TableRenderItem, { kind: 'parentContext' }> => item.kind === 'parentContext');
}

async function run(): Promise<void> {
	const parent = task('parent-1');
	const child1 = task('child-1', parent.operonId);
	const child2 = task('child-2', parent.operonId);
	const lookup = createTableTaskLookup([parent, child1, child2]);
	const parentGroup = group({
		key: 'parent-group', fieldKey: 'parentTask', value: parent.operonId,
		label: parent.description, count: 2, rows: [child1, child2],
	});

	const expanded = buildTableRenderItems([child1, child2], [parentGroup], [], true, lookup);
	deepEqual(kinds(expanded), ['group', 'parentContext', 'task', 'task', 'groupSummary', 'summary']);
	const expandedParent = parentContexts(expanded)[0];
	ok(expandedParent);
	equal(expandedParent.task, parent);
	equal(expandedParent.groupKey, parentGroup.key);
	equal(expandedParent.occurrenceKey, `${parentGroup.key}\u0000parentContext\u0000${parent.operonId}`);
	deepEqual([...buildTableTaskOrdinalMap(expanded).values()], [1, 2], 'context parent must not consume a normal row ordinal');
	equal(parentGroup.count, 2);
	deepEqual(parentGroup.rows, [child1, child2], 'render composition must not mutate query group rows');

	deepEqual(
		kinds(buildTableRenderItems([child1, child2], [parentGroup], [parentGroup.key], true, lookup)),
		['group', 'summary'],
	);

	const childSubgroup = subgroup({
		key: 'parent-subgroup', fieldKey: 'parentTask', value: parent.operonId,
		label: parent.description, count: 2, rows: [child1, child2],
	});
	const outerGroup = group({
		key: 'outer', fieldKey: 'status', value: 'Series.Active',
		rows: [child1, child2], count: 2, subgroups: [childSubgroup],
	});
	const subgroupExpanded = buildTableRenderItems([child1, child2], [outerGroup], [], true, lookup);
	deepEqual(kinds(subgroupExpanded), ['group', 'group', 'parentContext', 'task', 'task', 'groupSummary', 'summary']);
	const subgroupParent = parentContexts(subgroupExpanded)[0];
	ok(subgroupParent);
	const subgroupKey = createTableGroupPathKey(outerGroup.key, childSubgroup.key);
	equal(subgroupParent.groupKey, subgroupKey);
	deepEqual([...buildTableTaskOrdinalMap(subgroupExpanded).values()], [1, 2]);

	deepEqual(
		kinds(buildTableRenderItems([child1, child2], [outerGroup], [subgroupKey], true, lookup)),
		['group', 'group', 'summary'],
	);

	const nestedParentGroup = group({ ...parentGroup, subgroups: [subgroup({
		key: 'nested-status', fieldKey: 'status', value: 'Series.Active', rows: [child1, child2], count: 2,
	})] });
	deepEqual(
		kinds(buildTableRenderItems([child1, child2], [nestedParentGroup], [], false, lookup)),
		['group', 'parentContext', 'group', 'task', 'task'],
		'top-level parent must precede subgroup content',
	);

	for (const invalidGroup of [
		group({ key: 'missing', fieldKey: 'parentTask', value: 'missing-parent', rows: [child1] }),
		group({ key: 'empty', fieldKey: 'parentTask', value: '', isNoValue: true, rows: [child1] }),
		group({ key: 'unsupported', fieldKey: 'parentTask', value: parent.operonId, isUnsupportedValue: true, rows: [child1] }),
		group({ key: 'other-field', fieldKey: 'status', value: parent.operonId, rows: [child1] }),
		group({ key: 'case-mismatch', fieldKey: 'parentTask', value: 'PARENT-1', rows: [child1] }),
	]) {
		equal(parentContexts(buildTableRenderItems([child1], [invalidGroup], [], false, lookup)).length, 0);
	}

	const selfParent = task('self-parent', 'self-parent');
	const selfGroup = group({ key: 'self', fieldKey: 'parentTask', value: selfParent.operonId, rows: [selfParent] });
	equal(parentContexts(buildTableRenderItems([selfParent], [selfGroup], [], false, createTableTaskLookup([selfParent]))).length, 0);

	const repeatedSubgroupKey = 'parentTask:parent-1';
	const repeatedOuterGroups = [
		group({
			key: 'status:active', fieldKey: 'status', value: 'Series.Active', rows: [child1], count: 1,
			subgroups: [subgroup({ key: repeatedSubgroupKey, fieldKey: 'parentTask', value: parent.operonId, rows: [child1] })],
		}),
		group({
			key: 'status:waiting', fieldKey: 'status', value: 'Series.Waiting', rows: [child2], count: 1,
			subgroups: [subgroup({ key: repeatedSubgroupKey, fieldKey: 'parentTask', value: parent.operonId, rows: [child2] })],
		}),
	];
	const repeatedParents = parentContexts(buildTableRenderItems([child1, child2], repeatedOuterGroups, [], false, lookup));
	equal(repeatedParents.length, 2);
	equal(repeatedParents[0]?.task, parent);
	equal(repeatedParents[1]?.task, parent);
	equal(repeatedParents[0]?.groupKey, createTableGroupPathKey(repeatedOuterGroups[0]!.key, repeatedSubgroupKey));
	equal(repeatedParents[1]?.groupKey, createTableGroupPathKey(repeatedOuterGroups[1]!.key, repeatedSubgroupKey));
	assert.notEqual(repeatedParents[0]?.occurrenceKey, repeatedParents[1]?.occurrenceKey);
	assertions += 1;

	deepEqual(
		kinds(buildTableRenderItems([child1, child2], [parentGroup], [], false)),
		['group', 'task', 'task'],
		'omitting the optional lookup must preserve existing rendering behavior',
	);

	console.log(`Table parent context tests passed (${assertions} assertions).`);
}

declare global {
	var __operonTableParentContextTestRun: Promise<void> | undefined;
}

globalThis.__operonTableParentContextTestRun = run();
