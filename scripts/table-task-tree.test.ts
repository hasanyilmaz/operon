import assert from 'node:assert/strict';
import type { IndexedTask } from '../src/types/fields';
import type { OperonSettings } from '../src/types/settings';
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
import { buildTableRenderItems } from '../src/ui/table/table-surface';
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
	const collapsed = projectTableTaskTree(base, all, []);
	deepEqual(collapsed.filter(item => item.kind === 'task').map(item => item.task.operonId), ['parent']);
	const expanded = projectTableTaskTree(base, all, ['parent', 'child-2']);
	const taskItems = expanded.filter(item => item.kind === 'task');
	deepEqual(taskItems.map(item => item.task.operonId), ['parent', 'child-1', 'child-2', 'grandchild', 'excluded']);
	deepEqual(taskItems.map(item => item.tree?.path ?? []), [[], [1], [2], [2, 1], [3]]);
	equal(taskItems[4]?.tree?.context, true, 'filter-excluded child must be a context projection');
	equal(taskItems[1]?.tree?.context, false, 'base child must retain its base occurrence');
	equal(formatTableTaskTreePath([3, 2, 1]), '3.2.1');

	const a = task('a', 'b');
	const b = task('b', 'a');
	const cycle = projectTableTaskTree(buildTableRenderItems([a, b], [], [], false), [a, b], ['a', 'b']);
	deepEqual(cycle.filter(item => item.kind === 'task').map(item => item.task.operonId).sort(), ['a', 'b']);

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
