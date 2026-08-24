import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { IndexedTask } from '../src/types/fields';
import type { OperonSettings } from '../src/types/settings';
import type { TableQueryGroup } from '../src/systems/table-query';
import {
	TABLE_TASK_TREE_COLUMN_KEY,
	createDefaultTablePreset,
	normalizeTablePreset,
	resolveTableColumnDisplayMode,
} from '../src/types/table';
import { parseOperonTableFile, serializeOperonTableFile } from '../src/storage/table-file';
import { isTableColumnColorModeEligible } from '../src/ui/table/table-column-color';
import { buildTableTaskFieldCatalog, getTableTaskField } from '../src/ui/table/table-field-catalog';
import { replaceTablePresetColumns, setTablePresetColumnDisplayMode, setTablePresetColumnVisible } from '../src/ui/table/table-preset-model';
import { buildTableRenderItems, buildTableTaskOrdinalMap } from '../src/ui/table/table-surface';
import { formatTableTaskTreePath, projectTableTaskTree } from '../src/ui/table/table-task-tree';

let assertions = 0;
const equal = <T>(actual: T, expected: T, message?: string): void => {
	assert.equal(actual, expected, message);
	assertions += 1;
};
const deepEqual = (actual: unknown, expected: unknown, message?: string): void => {
	message === undefined ? assert.deepEqual(actual, expected) : assert.deepEqual(actual, expected, message);
	assertions += 1;
};

const settings = { keyMappings: [], colorPalette: [], pipelines: [], priorities: [] } as unknown as OperonSettings;

function task(id: string, parent = ''): IndexedTask {
	return {
		operonId: id,
		description: id,
		checkbox: 'open',
		fieldValues: parent ? { parentTask: parent } : {},
		tags: [],
		primary: { filePath: `${id}.md`, lineNumber: 0, format: 'yaml' },
		datetimeModified: '2026-08-24T00:00:00.000Z',
		tier: 'hot',
	};
}

function group(key: string, rows: IndexedTask[]): TableQueryGroup {
	return {
		key,
		fieldKey: 'status',
		value: key,
		label: key,
		isNoValue: false,
		sortValue: key,
		count: rows.length,
		rows,
	};
}

async function run(): Promise<void> {
	const catalog = buildTableTaskFieldCatalog(settings);
	const field = getTableTaskField(TABLE_TASK_TREE_COLUMN_KEY, settings);
	equal(field?.label, 'Task Tree');
	equal(field?.icon, 'list-tree');
	equal(field?.readonly, true);
	equal(catalog.filter(entry => entry.key === TABLE_TASK_TREE_COLUMN_KEY).length, 1);

	const initial = createDefaultTablePreset();
	equal(initial.columns.some(column => column.key === TABLE_TASK_TREE_COLUMN_KEY), false);
	let preset = setTablePresetColumnVisible(initial, TABLE_TASK_TREE_COLUMN_KEY, true, settings, field);
	const column = preset.columns.find(entry => entry.key === TABLE_TASK_TREE_COLUMN_KEY)!;
	equal(resolveTableColumnDisplayMode(column), 'icon');
	equal(column.widthPx, 120);
	equal(isTableColumnColorModeEligible(column, field), true);
	const normalizedPreset = normalizeTablePreset({
		...preset,
		groupBy: TABLE_TASK_TREE_COLUMN_KEY,
		sortRules: [{ key: TABLE_TASK_TREE_COLUMN_KEY, direction: 'asc', empty: 'last' }],
		summaries: [{ key: TABLE_TASK_TREE_COLUMN_KEY, function: 'Count' }],
	}, { availableFilterSetIds: [] });
	equal(normalizedPreset?.columns.some(entry => entry.key === TABLE_TASK_TREE_COLUMN_KEY), true, 'Task Tree must remain a persisted presentation column.');
	equal(normalizedPreset?.groupBy, null);
	deepEqual(normalizedPreset?.sortRules, []);
	deepEqual(normalizedPreset?.summaries, []);
	preset = setTablePresetColumnDisplayMode(preset, TABLE_TASK_TREE_COLUMN_KEY, 'details', settings, field);
	equal(resolveTableColumnDisplayMode(preset.columns.find(entry => entry.key === TABLE_TASK_TREE_COLUMN_KEY)!), 'details');
	preset.expandedTaskTreeIds = ['parent'];
	preset = setTablePresetColumnVisible(preset, TABLE_TASK_TREE_COLUMN_KEY, false);
	deepEqual(preset.expandedTaskTreeIds, [], 'hiding the column must clear expansion state');
	const replaced = replaceTablePresetColumns(
		{ ...setTablePresetColumnVisible(initial, TABLE_TASK_TREE_COLUMN_KEY, true, settings, field), expandedTaskTreeIds: ['parent'] },
		initial.columns,
	);
	deepEqual(replaced.expandedTaskTreeIds, [], 'replacing columns without Task Tree must clear expansion state');

	const parent = task('parent');
	const child1 = task('child-1', 'parent');
	const child2 = task('child-2', 'parent');
	const grandchild = task('grandchild', 'child-2');
	const excluded = task('excluded', 'parent');
	const all = [parent, child1, child2, grandchild, excluded];
	const base = buildTableRenderItems([parent, child1, child2, grandchild], [], [], false);
	const baseOrdinals = buildTableTaskOrdinalMap(base);
	const collapsed = projectTableTaskTree(base, all, [], undefined, baseOrdinals);
	deepEqual(
		collapsed.filter(item => item.kind === 'task').map(item => item.task.operonId),
		['parent', 'child-1', 'child-2', 'grandchild'],
		'adding Task Tree must preserve every base Table row while branches are collapsed',
	);
	const collapsedTasks = collapsed.filter(item => item.kind === 'task');
	const parentExpansionKey = collapsedTasks[0].tree!.expansionKey;
	const parentOnly = projectTableTaskTree(base, all, [parentExpansionKey], undefined, baseOrdinals);
	const projectedChild1ExpansionKey = parentOnly
		.filter(item => item.kind === 'task')
		.find(item => item.task.operonId === 'child-1' && item.tree?.context)?.tree?.expansionKey;
	const projectedChild2 = parentOnly
		.filter(item => item.kind === 'task')
		.find(item => item.task.operonId === 'child-2' && item.tree?.context);
	const projectedChild2ExpansionKey = projectedChild2?.tree?.expansionKey ?? '';
	const expanded = projectTableTaskTree(base, all, [parentExpansionKey, projectedChild2ExpansionKey], undefined, baseOrdinals);
	const taskItems = expanded.filter(item => item.kind === 'task');
	deepEqual(
		taskItems.map(item => item.task.operonId),
		['parent', 'child-1', 'child-2', 'grandchild', 'excluded', 'child-1', 'child-2', 'grandchild'],
	);
	deepEqual(taskItems.map(item => item.tree?.path ?? []), [[1], [1, 1], [1, 2], [1, 2, 1], [1, 3], [], [3], []]);
	equal(taskItems[4]?.tree?.context, true, 'filter-excluded child must be a context projection');
	equal(taskItems[1]?.tree?.context, true, 'a matching child under an expanded parent must be an additional context projection');
	equal(taskItems[5]?.tree?.context, false, 'the matching child must also retain its normal base occurrence');
	equal(taskItems.filter(item => item.task.operonId === 'child-1').length, 2, 'a projected child and its base row may both be visible');
	equal(new Set(taskItems.filter(item => item.tree?.context).map(item => item.ordinalKey)).size, 4, 'each projected occurrence needs a stable unique key');
	equal(taskItems[0].tree?.expanded, true, 'the base parent occurrence must retain its own expansion state');
	equal(taskItems[2].tree?.expanded, true, 'the nested occurrence must be independently expandable');
	equal(taskItems[6].tree?.expanded, false, 'expanding a nested occurrence must not expand the same task at its base row');
	const baseChild2ExpansionKey = collapsedTasks.find(item => item.task.operonId === 'child-2')?.tree?.expansionKey ?? '';
	const baseChildExpanded = projectTableTaskTree(base, all, [parentExpansionKey, baseChild2ExpansionKey], undefined, baseOrdinals)
		.filter(item => item.kind === 'task');
	equal(
		baseChildExpanded.find(item => item.task.operonId === 'child-2' && item.tree?.context)?.tree?.expanded,
		false,
		'expanding the base occurrence must not expand the same task inside another parent branch',
	);
	equal(
		baseChildExpanded.find(item => item.task.operonId === 'child-2' && !item.tree?.context)?.tree?.expanded,
		true,
		'the selected base occurrence must expand independently',
	);
	const reversedProjection = projectTableTaskTree(base, all, [parentExpansionKey], tasks => [...tasks].reverse(), baseOrdinals)
		.filter(item => item.kind === 'task');
	equal(
		reversedProjection.find(item => item.task.operonId === 'child-1' && item.tree?.context)?.tree?.expansionKey,
		projectedChild1ExpansionKey,
		'occurrence expansion keys must remain stable when sibling numbering changes after a sort',
	);
	equal(formatTableTaskTreePath([3, 2, 1]), '3.2.1');
	const groupedBase = buildTableRenderItems([parent, child1], [group('parents', [parent]), group('children', [child1])], [], false);
	const groupedParentKey = groupedBase.filter(item => item.kind === 'task').find(item => item.task.operonId === 'parent')?.ordinalKey ?? '';
	const groupedProjection = projectTableTaskTree(
		groupedBase,
		all,
		[groupedParentKey],
		undefined,
		buildTableTaskOrdinalMap(groupedBase),
	);
	deepEqual(groupedProjection.map(item => item.kind), ['group', 'task', 'task', 'task', 'task', 'group', 'task']);
	const groupedTasks = groupedProjection.filter(item => item.kind === 'task');
	deepEqual(
		groupedTasks.map(item => [item.task.operonId, item.groupKey, item.tree?.context]),
		[
			['parent', 'parents', false],
			['child-1', 'parents', true],
			['child-2', 'parents', true],
			['excluded', 'parents', true],
			['child-1', 'children', false],
		],
		'cross-group children must retain their base row and gain a context projection in the parent group',
	);

	const a = task('a', 'b');
	const b = task('b', 'a');
	const cycleBase = buildTableRenderItems([a, b], [], [], false);
	const cycle = projectTableTaskTree(
		cycleBase,
		[a, b],
		cycleBase.filter(item => item.kind === 'task').map(item => item.ordinalKey),
		undefined,
		buildTableTaskOrdinalMap(cycleBase),
	);
	const cycleTasks = cycle.filter(item => item.kind === 'task');
	deepEqual(cycleTasks.filter(item => !item.tree?.context).map(item => item.task.operonId), ['a', 'b']);
	equal(cycleTasks.filter(item => item.tree?.context).length, 2, 'cycle projections must terminate after one lineage-safe child');
	const cellSource = await readFile('src/ui/table/table-task-tree-cell.ts', 'utf8');
	equal(cellSource.includes('options.onToggle(projection.expansionKey);'), true, 'the chevron must toggle its exact visible occurrence');
	const workspaceSource = await readFile('src/ui/table/operon-table-view.ts', 'utf8');
	equal(workspaceSource.includes('private toggleTaskTreeExpanded(expansionKey: string): void'), true, 'workspace Table must persist occurrence-local expansion');
	const embedSource = await readFile('src/ui/embed-table-processor.ts', 'utf8');
	equal(embedSource.includes('deps: EmbedTableDeps, expansionKey: string'), true, 'embedded Table must persist occurrence-local expansion');
	const styles = await readFile('styles.css', 'utf8');
	equal(
		styles.includes('grid-template-columns: var(--operon-table-admin-control-size) minmax(0, auto);'),
		true,
		'detailed Task Tree must reserve a fixed chevron slot before every hierarchy number',
	);
	equal(
		styles.includes('padding-inline-start: calc(var(--operon-table-task-tree-depth, 0) * 16px);'),
		false,
		'detailed hierarchy depth must not move the chevron or number alignment',
	);
	equal(
		styles.includes('button.operon-table-icon-only-button.operon-table-task-tree-toggle {'),
		true,
		'Task Tree must use a button-specific neutral surface override',
	);

	const v4Preset = createDefaultTablePreset();
	v4Preset.expandedTaskTreeIds = [' child ', 'parent', 'parent'];
	const v4Source = serializeOperonTableFile(v4Preset);
	const v4 = parseOperonTableFile(v4Source);
	equal(v4.status, 'valid');
	if (v4.status === 'valid') deepEqual(v4.preset.expandedTaskTreeIds, ['child', 'parent']);
	const groupedTaskTree = JSON.parse(v4Source) as Record<string, unknown>;
	groupedTaskTree.groupBy = TABLE_TASK_TREE_COLUMN_KEY;
	equal(parseOperonTableFile(JSON.stringify(groupedTaskTree)).status, 'invalid');
	const legacy = JSON.parse(v4Source) as Record<string, unknown>;
	legacy.version = 3;
	delete legacy.expandedTaskTreeIds;
	const v3 = parseOperonTableFile(JSON.stringify(legacy));
	equal(v3.status, 'valid');
	if (v3.status === 'valid') deepEqual(v3.preset.expandedTaskTreeIds, []);
	equal((JSON.parse(serializeOperonTableFile(v3.status === 'valid' ? v3.preset : v4Preset)) as { version: number }).version, 4);

	console.log(`Table task tree tests passed (${assertions} assertions).`);
}

declare global {
	var __operonTableTaskTreeTestRun: Promise<void> | undefined;
}

globalThis.__operonTableTaskTreeTestRun = run();
