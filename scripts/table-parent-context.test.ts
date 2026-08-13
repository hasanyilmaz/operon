import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { IndexedTask } from '../src/types/fields';
import type { TableColumn } from '../src/types/table';
import { createTableGroupPathKey, type TableQueryGroup, type TableQuerySubgroup } from '../src/systems/table-query';
import type { TableTaskField } from '../src/ui/table/table-field-catalog';
import type { TableFilePropertyCellValue, TableFilePropertySnapshot } from '../src/ui/table/table-file-property';
import {
	buildTableEditableCellFocusKey,
	buildTableRenderItems,
	buildTableTaskOrdinalMap,
	collectTableParentContextTasks,
	createTableFilePropertyRenderProjection,
	formatTableRowOrdinal,
	findTableEditableCellByFocusKey,
	mergeTableContextAdditionalFields,
	mergeTableFilePropertyCandidates,
	type TableRenderItem,
} from '../src/ui/table/table-surface';
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
	deepEqual(collectTableParentContextTasks(buildTableRenderItems([child1, child2], repeatedOuterGroups, [], false, lookup)), [parent]);

	equal(formatTableRowOrdinal(null), '');
	equal(formatTableRowOrdinal(3), '3');
	equal(formatTableRowOrdinal('P'), 'P');
	const mutationCellKey = 'parent-1:description';
	equal(buildTableEditableCellFocusKey(mutationCellKey, null), mutationCellKey);
	const firstFocusKey = buildTableEditableCellFocusKey(mutationCellKey, repeatedParents[0]!.occurrenceKey);
	const secondFocusKey = buildTableEditableCellFocusKey(mutationCellKey, repeatedParents[1]!.occurrenceKey);
	assert.notEqual(firstFocusKey, secondFocusKey);
	assertions += 1;
	const firstCell = { dataset: { editCellKey: mutationCellKey, editFocusKey: firstFocusKey } as DOMStringMap };
	const secondCell = { dataset: { editCellKey: mutationCellKey, editFocusKey: secondFocusKey } as DOMStringMap };
	equal(findTableEditableCellByFocusKey([firstCell, secondCell], secondFocusKey), secondCell);

	const field = (key: string, label: string): TableTaskField => ({
		key, label, type: 'text', group: 'fileProperty', icon: 'text', readonly: false, aliases: [label],
	});
	const scopedTeam = field('file.property:team', 'Scoped team');
	const contextTeam = field('file.property:team', 'Context team');
	const contextSeason = field('file.property:season', 'Season');
	const hiddenContext = field('file.property:hidden', 'Hidden');
	const visibleColumns: TableColumn[] = [
		{ key: 'file.property:team', kind: 'task' },
		{ key: 'file.property:season', kind: 'task' },
		{ key: 'file.property:hidden', kind: 'task', hidden: true },
	];
	deepEqual(
		mergeTableContextAdditionalFields(
			[scopedTeam],
			[contextTeam, contextSeason, hiddenContext],
			visibleColumns,
		),
		[scopedTeam, contextSeason],
		'scoped field metadata must win and supplemental fields must stay limited to visible preset columns',
	);
	deepEqual(
		mergeTableFilePropertyCandidates(['Drama', 'Sci-Fi'], ['Sci-Fi', 'Mystery']),
		['Drama', 'Sci-Fi', 'Mystery'],
		'context pickers must preserve scoped candidates and add parent-only values once',
	);

	const emptyCell: TableFilePropertyCellValue = { present: false, rawValue: null, normalizedValue: '' };
	const contextCells = new Map<string, TableFilePropertyCellValue>([
		['file.property:scalar', { present: true, rawValue: 'Season 2', normalizedValue: 'Season 2' }],
		['file.property:list', { present: true, rawValue: ['A', 'B'], normalizedValue: 'A; B' }],
		['file.property:checkbox', { present: true, rawValue: true, normalizedValue: 'true' }],
		['file.property:icon', { present: true, rawValue: 'star', normalizedValue: 'star' }],
		['file.property:empty', emptyCell],
	]);
	const snapshot = (
		signature: string,
		fields: readonly TableTaskField[],
		cells: ReadonlyMap<string, TableFilePropertyCellValue>,
		candidates: ReadonlyMap<string, readonly string[]>,
	): TableFilePropertySnapshot => ({
		revision: 1,
		signature,
		fields: fields as TableFilePropertySnapshot['fields'],
		getCell: (_task, key) => cells.get(key) ?? emptyCell,
		getCandidates: key => candidates.get(key) ?? [],
	});
	const projectionColumns: TableColumn[] = [
		{ key: 'file.property:scalar', kind: 'task' },
		{ key: 'file.property:list', kind: 'task' },
		{ key: 'file.property:checkbox', kind: 'task' },
		{ key: 'file.property:icon', kind: 'task', displayMode: 'icon' },
		{ key: 'file.property:empty', kind: 'task' },
	];
	const contextProjectionFields = projectionColumns.map(column => field(column.key, column.key));
	const primarySnapshot = snapshot('scoped', [], new Map(), new Map([
		['file.property:scalar', ['Season 1']],
	]));
	const contextSnapshot = snapshot('context', contextProjectionFields, contextCells, new Map([
		['file.property:scalar', ['Season 2']],
	]));
	const projection = createTableFilePropertyRenderProjection(primarySnapshot, contextSnapshot, projectionColumns);
	equal(projection.signature, 'scoped|context=context');
	deepEqual(projection.fields, contextProjectionFields);
	for (const [key, expected] of contextCells) {
		deepEqual(projection.getCell(parent, key, true), expected, `context projection must select parent cell for ${key}`);
		deepEqual(projection.getCell(parent, key, false), emptyCell, `normal row projection must stay scoped for ${key}`);
	}
	const parentCandidates = projection.getCandidates('file.property:scalar', true);
	deepEqual(parentCandidates, ['Season 1', 'Season 2']);
	equal(projection.getCandidates('file.property:scalar', true), parentCandidates, 'context candidates must be memoized per key');
	deepEqual(projection.getCandidates('file.property:scalar', false), ['Season 1']);

	deepEqual(
		kinds(buildTableRenderItems([child1, child2], [parentGroup], [], false)),
		['group', 'task', 'task'],
		'omitting the optional lookup must preserve existing rendering behavior',
	);

	const workspaceSource = await readFile(path.join(process.cwd(), 'src/ui/table/operon-table-view.ts'), 'utf8');
	const embedSource = await readFile(path.join(process.cwd(), 'src/ui/embed-table-processor.ts'), 'utf8');
	for (const [surface, source] of [['workspace', workspaceSource], ['embed', embedSource]] as const) {
		ok(source.includes('operon-table-parent-context-row'), `${surface} must mark contextual parent rows semantically`);
		ok(source.includes("'P', item.occurrenceKey"), `${surface} must route parent rows through the normal task renderer with P`);
		ok(source.includes('getContextFilePropertyCell'), `${surface} must use the context-only file-property snapshot`);
		ok(source.includes('dataset.editFocusKey'), `${surface} must preserve occurrence-aware focus identity`);
		ok((source.match(/valueResolver\.taskLookup/g) ?? []).length >= 4, `${surface} must wire lookup into initial and collapse compositions`);
	}
	ok(embedSource.includes('parentContext:${item.occurrenceKey}:${item.task.operonId}:${item.task.datetimeModified}'), 'embed signature must include parent occurrence and change identity');

	console.log(`Table parent context tests passed (${assertions} assertions).`);
}

declare global {
	var __operonTableParentContextTestRun: Promise<void> | undefined;
}

globalThis.__operonTableParentContextTestRun = run();
