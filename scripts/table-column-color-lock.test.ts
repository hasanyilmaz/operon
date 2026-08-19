import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
	createDefaultTablePreset,
	normalizeTableColumnColorMode,
	normalizeTablePreset,
	type TableColumnColorMode,
} from '../src/types/table';
import {
	isTableColumnColorModeEligible,
	resolveEffectiveTableColumnColorMode,
} from '../src/ui/table/table-column-color';
import {
	replaceTablePresetColumns,
	setTablePresetColumnColorMode,
} from '../src/ui/table/table-preset-model';
import { getTableTaskField, isTablePlainTextField } from '../src/ui/table/table-field-catalog';
import { DEFAULT_SETTINGS } from '../src/types/settings';
import {
	parseOperonTableFile,
	serializeOperonTableFile,
} from '../src/storage/table-file';

let assertions = 0;

function equal<T>(actual: T, expected: T, message?: string): void {
	assert.equal(actual, expected, message);
	assertions += 1;
}

function ok(value: unknown, message?: string): asserts value {
	assert.ok(value, message);
	assertions += 1;
}

function getTaskColorColumn(preset: ReturnType<typeof createDefaultTablePreset>) {
	const column = preset.columns.find(entry => entry.key === 'taskColor');
	ok(column, 'default Table preset must include the Task Color column');
	return column;
}

function getSerializedTaskColorMode(source: string): string | undefined {
	const file = JSON.parse(source) as { columns: Array<{ key: string; colorMode?: string }> };
	return file.columns.find(column => column.key === 'taskColor')?.colorMode;
}

async function run(): Promise<void> {
	for (const key of ['taskType', 'taskImage', 'taskGallery']) {
		equal(DEFAULT_SETTINGS.keyMappings.some(mapping => mapping.canonicalKey === key && mapping.isSystem === true), true);
		equal(getTableTaskField(key, DEFAULT_SETTINGS), null, `${key} must remain unavailable until Stage 5`);
	}

	const modes: readonly TableColumnColorMode[] = [
		'noColor',
		'taskColor',
		'priorityColor',
		'statusColor',
		'randomColors',
	];
	for (const mode of modes) {
		equal(resolveEffectiveTableColumnColorMode({ key: 'taskColor', colorMode: mode }), 'taskColor');
	}
	equal(normalizeTableColumnColorMode('taskColor', 'taskColor'), undefined);
	equal(normalizeTableColumnColorMode('statusColor', 'taskColor'), 'statusColor');

	equal(isTableColumnColorModeEligible({ key: 'taskColor', kind: 'task' }), false);
	equal(isTableColumnColorModeEligible(
		{ key: 'taskIcon', kind: 'task' },
		{ key: 'taskIcon', type: 'text' },
	), true);
	equal(isTableColumnColorModeEligible({ key: 'status', kind: 'task' }), true);
	equal(isTableColumnColorModeEligible({ key: 'file.property:team', kind: 'task' }), true);
	equal(isTableColumnColorModeEligible({ key: 'summary', kind: 'task' }, { key: 'summary', type: 'text' }), false);
	equal(isTableColumnColorModeEligible({ key: 'status', kind: 'task' }, { key: 'status', type: 'text' }), true);
	equal(isTableColumnColorModeEligible({ key: 'priority', kind: 'task' }, { key: 'priority', type: 'text' }), true);
	equal(isTableColumnColorModeEligible({ key: 'parentTask', kind: 'task' }, { key: 'parentTask', type: 'text' }), true);
	equal(isTableColumnColorModeEligible({ key: 'custom.list', kind: 'task' }, { key: 'custom.list', type: 'list' }), true);
	equal(isTableColumnColorModeEligible(
		{ key: 'file.property:summary', kind: 'task' },
		{ key: 'file.property:summary', type: 'text' },
	), false);
	equal(isTableColumnColorModeEligible(
		{ key: 'file.property:missing', kind: 'task' },
		{ key: 'file.property:missing', type: 'text', unavailable: true },
	), true, 'unavailable File Property types must not be treated as proven text');
	equal(isTablePlainTextField({ key: 'summary', type: 'text' }), true);
	equal(isTablePlainTextField({ key: 'status', type: 'text' }), false);
	equal(isTablePlainTextField({ key: 'priority', type: 'text' }), false);
	equal(isTablePlainTextField({ key: 'taskIcon', type: 'text' }), false);
	equal(isTablePlainTextField({ key: 'taskColor', type: 'text' }), false);
	equal(isTablePlainTextField({ key: 'parentTask', type: 'text' }), false);
	equal(isTablePlainTextField({ key: 'contexts', type: 'list' }), false);

	const preset = createDefaultTablePreset();
	const originalTaskColor = getTaskColorColumn(preset);
	originalTaskColor.colorMode = 'statusColor';
	const updated = setTablePresetColumnColorMode(preset, 'taskColor', 'randomColors');
	equal(originalTaskColor.colorMode, 'statusColor', 'setter must not mutate the source preset');
	equal(getTaskColorColumn(updated).colorMode, undefined);

	const replaced = replaceTablePresetColumns(preset, preset.columns);
	equal(getTaskColorColumn(replaced).colorMode, undefined);

	const normalized = normalizeTablePreset(preset, { availableFilterSetIds: [] });
	ok(normalized);
	equal(getTaskColorColumn(normalized).colorMode, 'statusColor');
	equal(getTaskColorColumn(JSON.parse(JSON.stringify(normalized))).colorMode, 'statusColor');

	for (const mode of modes) {
		const historicalPreset = createDefaultTablePreset();
		getTaskColorColumn(historicalPreset).colorMode = mode;
		const historicalSource = serializeOperonTableFile(historicalPreset);
		equal(getSerializedTaskColorMode(historicalSource), mode);
		const parsed = parseOperonTableFile(historicalSource, 'Historical.table');
		equal(parsed.status, 'valid');
		if (parsed.status !== 'valid') continue;
		equal(getTaskColorColumn(parsed.preset).colorMode, undefined);
		equal(getSerializedTaskColorMode(serializeOperonTableFile(parsed.preset)), undefined);
	}

	const nonLockedPreset = createDefaultTablePreset();
	const priorityColumn = nonLockedPreset.columns.find(column => column.key === 'priority');
	ok(priorityColumn);
	priorityColumn.colorMode = 'taskColor';
	const nonLockedParsed = parseOperonTableFile(serializeOperonTableFile(nonLockedPreset));
	equal(nonLockedParsed.status, 'valid');
	if (nonLockedParsed.status === 'valid') {
		equal(nonLockedParsed.preset.columns.find(column => column.key === 'priority')?.colorMode, 'taskColor');
	}

	const invalidFile = JSON.parse(serializeOperonTableFile(createDefaultTablePreset())) as {
		columns: Array<{ key: string; colorMode?: string }>;
	};
	const invalidTaskColor = invalidFile.columns.find(column => column.key === 'taskColor');
	ok(invalidTaskColor);
	invalidTaskColor.colorMode = 'notAColorMode';
	equal(parseOperonTableFile(JSON.stringify(invalidFile)).status, 'invalid');

	const headerSource = await readFile(path.join(process.cwd(), 'src/ui/table/table-header-interactions.ts'), 'utf8');
	ok(headerSource.includes('if (isTableColumnColorModeEligible('));
	ok(headerSource.includes('for (const mode of TABLE_COLUMN_COLOR_MENU_MODES)'));
	ok(headerSource.includes("options.savePreset(setTablePresetColumnColorMode(options.getCurrentPreset(), column.key, mode), 'columns')"));

	console.log(`Table column color lock tests passed: ${assertions} assertions`);
}

declare global {
	var __operonTableColumnColorLockTestRun: Promise<void> | undefined;
}

globalThis.__operonTableColumnColorLockTestRun = run();
