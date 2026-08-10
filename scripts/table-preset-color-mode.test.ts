import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createDefaultTablePreset, type TableColumn, type TablePreset } from '../src/types/table';
import {
	applyTablePresetColorMode,
	deriveTablePresetColorMode,
	hasTablePresetColorModeColumns,
	TABLE_PRESET_COLOR_MODES,
	type TablePresetColorMode,
} from '../src/ui/table/table-preset-model';
import { buildTablePresetDirtyPatch } from '../src/ui/table/table-preset-quick-settings-modal';

let assertions = 0;
function equal<T>(actual: T, expected: T, message?: string): void { assert.equal(actual, expected, message); assertions += 1; }
function deepEqual(actual: unknown, expected: unknown, message?: string): void { assert.deepEqual(actual, expected, message); assertions += 1; }
function ok(value: unknown, message?: string): asserts value { assert.ok(value, message); assertions += 1; }

function createPreset(columns: TableColumn[]): TablePreset {
	return { ...createDefaultTablePreset(), columns: columns.map(entry => ({ ...entry })) };
}

function column(preset: TablePreset, key: string): TableColumn {
	const result = preset.columns.find(entry => entry.key === key);
	ok(result, `column ${key} must exist`);
	return result;
}

async function run(): Promise<void> {
	deepEqual(TABLE_PRESET_COLOR_MODES, ['customColors', 'noColor', 'taskColor', 'priorityColor', 'statusColor']);
	equal(deriveTablePresetColorMode(createDefaultTablePreset()), 'customColors');

	const zeroCandidatePreset = createPreset([
		{ key: 'taskColor', kind: 'task' },
		{ key: 'description', kind: 'task' },
		{ key: 'hidden', kind: 'task', hidden: true },
		{ key: 'admin', kind: 'admin' },
	]);
	equal(hasTablePresetColorModeColumns(zeroCandidatePreset), false);
	equal(deriveTablePresetColorMode(zeroCandidatePreset), 'customColors');
	deepEqual(applyTablePresetColorMode(zeroCandidatePreset, 'taskColor'), zeroCandidatePreset);

	const oneFileProperty = createPreset([{ key: 'file.property:team', kind: 'task' }]);
	equal(hasTablePresetColorModeColumns(oneFileProperty), true);
	equal(deriveTablePresetColorMode(oneFileProperty), 'noColor');

	for (const [mode, columns] of [
		['noColor', [{ key: 'note', kind: 'task' }, { key: 'file.property:team', kind: 'task' }]],
		['taskColor', [{ key: 'note', kind: 'task', colorMode: 'taskColor' }, { key: 'progress', kind: 'task' }]],
		['priorityColor', [{ key: 'note', kind: 'task', colorMode: 'priorityColor' }, { key: 'priority', kind: 'task' }]],
		['statusColor', [{ key: 'note', kind: 'task', colorMode: 'statusColor' }, { key: 'status', kind: 'task' }]],
	] as const) {
		equal(deriveTablePresetColorMode(createPreset(columns.map(entry => ({ ...entry })))), mode);
	}
	equal(deriveTablePresetColorMode(createPreset([
		{ key: 'note', kind: 'task', colorMode: 'randomColors' },
		{ key: 'file.property:team', kind: 'task', colorMode: 'randomColors' },
	])), 'customColors');
	equal(deriveTablePresetColorMode(createPreset([
		{ key: 'note', kind: 'task', colorMode: 'taskColor' },
		{ key: 'file.property:team', kind: 'task', colorMode: 'statusColor' },
	])), 'customColors');

	const source = createPreset([
		{ key: 'note', kind: 'task', colorMode: 'randomColors', widthPx: 222 },
		{ key: 'status', kind: 'task', colorMode: 'randomColors' },
		{ key: 'priority', kind: 'task', colorMode: 'randomColors' },
		{ key: 'progress', kind: 'task', colorMode: 'randomColors' },
		{ key: 'file.property:team', kind: 'task', colorMode: 'randomColors' },
		{ key: 'hidden', kind: 'task', hidden: true, colorMode: 'randomColors' },
		{ key: 'taskColor', kind: 'task', colorMode: 'statusColor' },
		{ key: 'description', kind: 'task', colorMode: 'statusColor' },
		{ key: 'source', kind: 'task', colorMode: 'priorityColor' },
		{ key: 'duration', kind: 'task', colorMode: 'taskColor' },
		{ key: 'admin', kind: 'admin', colorMode: 'randomColors' },
		{ key: 'unsupported', kind: 'task', colorMode: 'randomColors' },
	]);
	const supportedKeys = new Set(['note', 'status', 'priority', 'progress', 'file.property:team', 'hidden', 'taskColor', 'description', 'source', 'duration', 'admin']);
	const sourceSnapshot = structuredClone(source);
	const expectedStoredModes: Record<Exclude<TablePresetColorMode, 'customColors'>, Record<string, string | undefined>> = {
		noColor: { note: undefined, status: 'noColor', priority: 'noColor', progress: 'noColor', 'file.property:team': undefined },
		taskColor: { note: 'taskColor', status: 'taskColor', priority: 'taskColor', progress: undefined, 'file.property:team': 'taskColor' },
		priorityColor: { note: 'priorityColor', status: 'priorityColor', priority: undefined, progress: 'priorityColor', 'file.property:team': 'priorityColor' },
		statusColor: { note: 'statusColor', status: undefined, priority: 'statusColor', progress: 'statusColor', 'file.property:team': 'statusColor' },
	};
	for (const mode of ['noColor', 'taskColor', 'priorityColor', 'statusColor'] as const) {
		const updated = applyTablePresetColorMode(source, mode, supportedKeys);
		deepEqual(source, sourceSnapshot, `${mode} must not mutate its source preset`);
		equal(deriveTablePresetColorMode(updated, supportedKeys), mode);
		for (const [key, expected] of Object.entries(expectedStoredModes[mode])) {
			equal(column(updated, key).colorMode, expected, `${mode} storage for ${key}`);
		}
		equal(column(updated, 'note').widthPx, 222);
		for (const key of ['hidden', 'taskColor', 'description', 'source', 'duration', 'admin', 'unsupported']) {
			deepEqual(column(updated, key), column(source, key), `${mode} must preserve excluded column ${key}`);
		}
		deepEqual(applyTablePresetColorMode(updated, mode, supportedKeys), updated, `${mode} must be idempotent`);
	}

	const customClone = applyTablePresetColorMode(source, 'customColors', supportedKeys);
	deepEqual(customClone, source);
	equal(customClone === source, false);
	equal(customClone.columns === source.columns, false);

	const taskUpdated = applyTablePresetColorMode(source, 'taskColor', supportedKeys);
	const dirtyPatch = buildTablePresetDirtyPatch(taskUpdated, new Set(['columns']), source);
	ok(dirtyPatch.columns);
	equal(dirtyPatch.display, undefined);
	deepEqual(buildTablePresetDirtyPatch(source, new Set(), source), { id: source.id });

	const modalSource = await readFile(path.join(process.cwd(), 'src/ui/table/table-preset-quick-settings-modal.ts'), 'utf8');
	const displayStart = modalSource.indexOf('private renderDisplaySection(');
	const buttonsStart = modalSource.indexOf('private renderButtons(', displayStart);
	ok(displayStart >= 0 && buttonsStart > displayStart);
	const displaySource = modalSource.slice(displayStart, buttonsStart);
	ok(displaySource.indexOf(".setName(t('table', 'colorMode'))") < displaySource.indexOf(".setName(t('table', 'density'))"));
	ok(displaySource.includes('customOption.disabled = true'));
	ok(displaySource.includes('dropdown.selectEl.disabled = !hasTablePresetColorModeColumns'));
	ok(displaySource.includes('this.updateColumns(applyTablePresetColorMode'));
	equal(displaySource.includes('onSave('), false, 'Display changes must not write directly');

	console.log(`Table preset color mode tests passed: ${assertions} assertions`);
}

declare global { var __operonTablePresetColorModeTestRun: Promise<void> | undefined; }
globalThis.__operonTablePresetColorModeTestRun = run();
