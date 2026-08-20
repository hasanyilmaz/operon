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
import {
	getTableTaskField,
	isEditableTableTaskFieldKey,
	isTablePlainTextField,
} from '../src/ui/table/table-field-catalog';
import { DEFAULT_SETTINGS, migrateSettings } from '../src/types/settings';
import {
	parseOperonTableFile,
	serializeOperonTableFile,
} from '../src/storage/table-file';
import { TablePresetRegistry } from '../src/storage/table-preset-registry';
import { TABLE_TASK_DATA_TYPE_COLUMN_KEY } from '../src/types/table';
import { getTableTaskRawValue, parseTableTaskListValue } from '../src/ui/table/table-value-adapter';
import { queryTableRows } from '../src/systems/table-query';
import {
	collectManagedTaskDataFieldValueCandidates,
	getManagedTaskDataFieldPicker,
} from '../src/ui/task-data-field-picker';
import { normalizeTablePickerPayload } from '../src/ui/table/table-editing';
import { resolveTableIconOnlyCellIcon } from '../src/ui/table/table-icon-only-cell';
import { resolveSubtaskActionIconForKind } from '../src/core/subtask-action';
import {
	prepareCanonicalTableFileRestoreExpectedHash,
	writeCanonicalTableFileWithAcknowledgement,
} from '../src/storage/table-file-write-acknowledgement';
import { renameCanonicalTableFileWithAcknowledgement } from '../src/storage/table-file-rename-acknowledgement';

let assertions = 0;

function equal<T>(actual: T, expected: T, message?: string): void {
	assert.equal(actual, expected, message ?? 'Values must be equal.');
	assertions += 1;
}

function deepEqual(actual: unknown, expected: unknown, message?: string): void {
	assert.deepEqual(actual, expected, message ?? 'Values must be deeply equal.');
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

function buildLegacyTaskDataTypeTableSource(version: 1 | 2): string {
	const legacy = JSON.parse(serializeOperonTableFile(createDefaultTablePreset())) as Record<string, any>;
	legacy.version = version;
	legacy.filterSetId = 'fs-unrelated';
	legacy.columns = [
		{ key: 'taskType', kind: 'task', label: 'Legacy source kind', hidden: true },
		{ key: '__taskType', kind: 'task', label: 'Retired source kind' },
		{ key: TABLE_TASK_DATA_TYPE_COLUMN_KEY, kind: 'task', label: 'Current source kind' },
		{ key: 'status', kind: 'task' },
	];
	legacy.sortRules = [
		{ key: 'taskType', direction: 'asc', empty: 'last' },
		{ key: '__taskType', direction: 'desc', empty: 'first' },
		{ key: TABLE_TASK_DATA_TYPE_COLUMN_KEY, direction: 'desc', empty: 'last' },
		{ key: 'status', direction: 'asc', empty: 'last' },
	];
	legacy.groupBy = 'taskType';
	legacy.subgroupBy = '__taskType';
	legacy.summaries = [
		{ key: 'taskType', function: 'Count' },
		{ key: '__taskType', function: 'Filled' },
		{ key: TABLE_TASK_DATA_TYPE_COLUMN_KEY, function: 'Unique' },
		{ key: 'status', function: 'TopValues' },
	];
	if (version === 1) delete legacy.collapsedGroupKeys;
	else legacy.collapsedGroupKeys = ['inline'];
	return JSON.stringify(legacy);
}

async function run(): Promise<void> {
	const previousTableSource = '{"version":2}';
	const candidateTableSource = '{"version":3}';
	let acknowledgedSource = previousTableSource;
	const beforeCommit = await writeCanonicalTableFileWithAcknowledgement({
		previous: previousTableSource,
		candidate: candidateTableSource,
		writeCandidate: async () => {
			throw new Error('write-before-commit');
		},
		readCurrent: async () => acknowledgedSource,
	});
	equal(beforeCommit.status, 'previous', 'A failed write that retained the old source must not be treated as committed.');

	acknowledgedSource = previousTableSource;
	const resolvedCandidate = await writeCanonicalTableFileWithAcknowledgement({
		previous: previousTableSource,
		candidate: candidateTableSource,
		writeCandidate: async () => {
			acknowledgedSource = candidateTableSource;
		},
		readCurrent: async () => acknowledgedSource,
	});
	equal(resolvedCandidate.status, 'candidate', 'A resolved write must still prove the exact candidate by readback.');

	acknowledgedSource = previousTableSource;
	const committedThenThrew = await writeCanonicalTableFileWithAcknowledgement({
		previous: previousTableSource,
		candidate: candidateTableSource,
		writeCandidate: async () => {
			acknowledgedSource = candidateTableSource;
			throw new Error('write-committed-then-threw');
		},
		readCurrent: async () => acknowledgedSource,
	});
	equal(committedThenThrew.status, 'candidate', 'An exact candidate readback must continue through normal verification and rename handling.');
	let renameContinuationCalls = 0;
	if (committedThenThrew.status === 'candidate') renameContinuationCalls += 1;
	equal(renameContinuationCalls, 1, 'Acknowledged-after-error writes must not bypass the normal rename continuation.');

	acknowledgedSource = '{"version":3,"partial":true}';
	const divergentWrite = await writeCanonicalTableFileWithAcknowledgement({
		previous: previousTableSource,
		candidate: candidateTableSource,
		writeCandidate: async () => {
			throw new Error('write-partial');
		},
		readCurrent: async () => acknowledgedSource,
	});
	equal(divergentWrite.status, 'divergent', 'A partial or third-party document must fail closed without restoration.');

	const unreadableWrite = await writeCanonicalTableFileWithAcknowledgement({
		previous: previousTableSource,
		candidate: candidateTableSource,
		writeCandidate: async () => {
			throw new Error('write-unacknowledged');
		},
		readCurrent: async () => {
			throw new Error('readback-failed');
		},
	});
	equal(unreadableWrite.status, 'unreadable', 'A missing readback must fail closed without assuming the old document remains authoritative.');

	acknowledgedSource = previousTableSource;
	const resolvedButPrevious = await writeCanonicalTableFileWithAcknowledgement({
		previous: previousTableSource,
		candidate: candidateTableSource,
		writeCandidate: async () => {},
		readCurrent: async () => acknowledgedSource,
	});
	equal(resolvedButPrevious.status, 'previous', 'A resolved write that retained the previous source must still fail closed.');

	acknowledgedSource = '{"version":3,"partial":true}';
	const resolvedButDivergent = await writeCanonicalTableFileWithAcknowledgement({
		previous: previousTableSource,
		candidate: candidateTableSource,
		writeCandidate: async () => {},
		readCurrent: async () => acknowledgedSource,
	});
	equal(resolvedButDivergent.status, 'divergent', 'A resolved write with partial content must still fail closed.');

	const resolvedButUnreadable = await writeCanonicalTableFileWithAcknowledgement({
		previous: previousTableSource,
		candidate: candidateTableSource,
		writeCandidate: async () => {},
		readCurrent: async () => {
			throw new Error('resolved-readback-failed');
		},
	});
	equal(resolvedButUnreadable.status, 'unreadable', 'A resolved write without readable evidence must still fail closed.');

	let restoredSource = candidateTableSource;
	const restoreAcknowledgementLoss = await writeCanonicalTableFileWithAcknowledgement({
		previous: candidateTableSource,
		candidate: previousTableSource,
		writeCandidate: async () => {
			restoredSource = previousTableSource;
			throw new Error('restore-committed-then-threw');
		},
		readCurrent: async () => restoredSource,
	});
	equal(restoreAcknowledgementLoss.status, 'candidate', 'A restore acknowledgement loss must be verified by exact previous-source readback.');

	restoredSource = candidateTableSource;
	const restoreFailed = await writeCanonicalTableFileWithAcknowledgement({
		previous: candidateTableSource,
		candidate: previousTableSource,
		writeCandidate: async () => {
			throw new Error('restore-before-commit');
		},
		readCurrent: async () => restoredSource,
	});
	equal(restoreFailed.status, 'previous', 'A restore that retained the candidate must not claim recovery.');

	const restoreTokens = new Map([
		['Tables/Original.table', 'candidate-hash'],
		['Tables/Unrelated.table', 'unrelated-hash'],
	]);
	prepareCanonicalTableFileRestoreExpectedHash(
		restoreTokens,
		'Tables/Original.table',
		'Tables/Renamed.table',
		'previous-hash',
	);
	equal(restoreTokens.has('Tables/Original.table'), false, 'A different-path restore must remove the original candidate token first.');
	equal(restoreTokens.get('Tables/Renamed.table'), 'previous-hash');
	equal(restoreTokens.get('Tables/Unrelated.table'), 'unrelated-hash');

	let renamedPath = 'Tables/Original.table';
	const renameBeforeCommit = await renameCanonicalTableFileWithAcknowledgement({
		previousPath: 'Tables/Original.table',
		candidatePath: 'Tables/Renamed.table',
		renameCandidate: async () => {
			throw new Error('rename-before-commit');
		},
		getCurrentPath: () => renamedPath,
	});
	equal(renameBeforeCommit.status, 'previous', 'A failed forward rename must not retain an event acknowledgement token.');

	renamedPath = 'Tables/Original.table';
	const renameCommittedThenThrew = await renameCanonicalTableFileWithAcknowledgement({
		previousPath: 'Tables/Original.table',
		candidatePath: 'Tables/Renamed.table',
		renameCandidate: async () => {
			renamedPath = 'Tables/Renamed.table';
			throw new Error('rename-committed-then-threw');
		},
		getCurrentPath: () => renamedPath,
	});
	equal(renameCommittedThenThrew.status, 'candidate', 'A commit-then-error forward rename must retain only its verifiable event token.');

	renamedPath = 'Tables/Original.table';
	const renameSucceeded = await renameCanonicalTableFileWithAcknowledgement({
		previousPath: 'Tables/Original.table',
		candidatePath: 'Tables/Renamed.table',
		renameCandidate: async () => {
			renamedPath = 'Tables/Renamed.table';
		},
		getCurrentPath: () => renamedPath,
	});
	equal(renameSucceeded.status, 'candidate', 'A successful forward rename must retain its event acknowledgement token.');

	renamedPath = 'Tables/Renamed.table';
	const rollbackBeforeCommit = await renameCanonicalTableFileWithAcknowledgement({
		previousPath: 'Tables/Renamed.table',
		candidatePath: 'Tables/Original.table',
		renameCandidate: async () => {
			throw new Error('rollback-before-commit');
		},
		getCurrentPath: () => renamedPath,
	});
	equal(rollbackBeforeCommit.status, 'previous', 'A before-commit rollback must not claim recovery.');

	renamedPath = 'Tables/Renamed.table';
	const rollbackCommittedThenThrew = await renameCanonicalTableFileWithAcknowledgement({
		previousPath: 'Tables/Renamed.table',
		candidatePath: 'Tables/Original.table',
		renameCandidate: async () => {
			renamedPath = 'Tables/Original.table';
			throw new Error('rollback-committed-then-threw');
		},
		getCurrentPath: () => renamedPath,
	});
	equal(rollbackCommittedThenThrew.status, 'candidate', 'A commit-then-error rollback must retain only its verifiable acknowledgement token.');

	renamedPath = 'Tables/Renamed.table';
	const rollbackSucceeded = await renameCanonicalTableFileWithAcknowledgement({
		previousPath: 'Tables/Renamed.table',
		candidatePath: 'Tables/Original.table',
		renameCandidate: async () => {
			renamedPath = 'Tables/Original.table';
		},
		getCurrentPath: () => renamedPath,
	});
	equal(rollbackSucceeded.status, 'candidate', 'A successful rollback must retain its own event acknowledgement token.');

	for (const [key, type, icon] of [
		['taskType', 'text', 'shapes'],
		['taskImage', 'text', 'image'],
		['taskGallery', 'list', 'images'],
	] as const) {
		equal(DEFAULT_SETTINGS.keyMappings.some(mapping => mapping.canonicalKey === key && mapping.isSystem === true), true);
		const field = getTableTaskField(key, DEFAULT_SETTINGS);
		ok(field, `${key} must be available in the Stage 5 Table catalog.`);
		equal(field.type, type);
		equal(field.icon, icon);
		equal(field.readonly, false);
		equal(isEditableTableTaskFieldKey(key, DEFAULT_SETTINGS), true);
	}
	const taskDataTypeField = getTableTaskField(TABLE_TASK_DATA_TYPE_COLUMN_KEY, DEFAULT_SETTINGS);
	ok(taskDataTypeField);
	equal(taskDataTypeField.label, 'Task Data Type');
	equal(taskDataTypeField.readonly, true);
	equal(isEditableTableTaskFieldKey(TABLE_TASK_DATA_TYPE_COLUMN_KEY, DEFAULT_SETTINGS), false);
	equal(
		resolveTableIconOnlyCellIcon(TABLE_TASK_DATA_TYPE_COLUMN_KEY, 'inline', 'database'),
		resolveSubtaskActionIconForKind('inline'),
	);
	equal(resolveTableIconOnlyCellIcon('taskImage', 'inline', 'image'), 'image');
	equal(resolveTableIconOnlyCellIcon('taskGallery', 'file', 'images'), 'images');

	for (const [key, type, mediaReference] of [
		['taskType', 'text', false],
		['taskImage', 'text', true],
		['taskGallery', 'list', true],
	] as const) {
		const picker = getManagedTaskDataFieldPicker(key, DEFAULT_SETTINGS.keyMappings);
		ok(picker, `${key} must admit the narrow system-owned picker adapter.`);
		equal(picker.type, type);
		equal(picker.mediaReference, mediaReference);
	}
	const customTaskImage = DEFAULT_SETTINGS.keyMappings.map(mapping => (
		mapping.canonicalKey === 'taskImage' ? { ...mapping, isSystem: false } : mapping
	));
	equal(getManagedTaskDataFieldPicker('taskImage', customTaskImage), null, 'The managed picker must not loosen custom/system admission.');
	const taskGalleryPicker = getManagedTaskDataFieldPicker('taskGallery', DEFAULT_SETTINGS.keyMappings);
	ok(taskGalleryPicker);
	const mediaCandidateApp = {
		vault: {
			getMarkdownFiles: () => [{ path: 'Tasks/Candidates.md' }],
		},
		metadataCache: {
			getFileCache: () => ({
				frontmatter: {
					taskGallery: ['Assets/yaml;detail.png', 'Assets/two.png', 'Assets/yaml;detail.png'],
				},
			}),
		},
	} as unknown as Pick<import('obsidian').App, 'metadataCache' | 'vault'>;
	deepEqual(
		collectManagedTaskDataFieldValueCandidates(mediaCandidateApp, [], taskGalleryPicker),
		['Assets/two.png', 'Assets/yaml;detail.png'],
		'YAML taskGallery array entries must keep literal semicolons as one picker item.',
	);

	const taskGallerySource = 'Assets/one\\;detail.png; Assets/two.png; Assets/two.png';
	deepEqual(parseTableTaskListValue('taskGallery', taskGallerySource), ['Assets/one;detail.png', 'Assets/two.png']);
	const galleryTask = {
		operonId: 'gallery1',
		description: 'Gallery task',
		checkbox: 'open',
		tags: [],
		fieldValues: { taskGallery: taskGallerySource },
		primary: { filePath: 'Tasks/Gallery.md', lineNumber: 0, format: 'inline' },
	} as unknown as import('../src/types/fields').IndexedTask;
	equal(getTableTaskRawValue(galleryTask, 'taskGallery'), 'Assets/one\\;detail.png; Assets/two.png');
	deepEqual(normalizeTablePickerPayload({ taskGallery: ['Assets/one;detail.png', 'Assets/two.png', 'Assets/two.png'] }), {
		taskGallery: 'Assets/one\\;detail.png; Assets/two.png',
	});
	const galleryPreset = createDefaultTablePreset();
	galleryPreset.sortRules = [];
	galleryPreset.groupBy = 'taskGallery';
	galleryPreset.subgroupBy = null;
	galleryPreset.summaries = [{ key: 'taskGallery', function: 'ListItemCount' }];
	const galleryQuery = queryTableRows({
		preset: galleryPreset,
		filterSet: null,
		tasks: [galleryTask],
		priorities: [],
		settings: DEFAULT_SETTINGS,
	});
	deepEqual(galleryQuery.groups.map(group => group.value), ['Assets/one;detail.png', 'Assets/two.png']);
	equal(galleryQuery.summaries.get('taskGallery')?.value, '2');
	const laterGalleryTask = {
		...galleryTask,
		operonId: 'gallery2',
		fieldValues: { taskGallery: 'Zed.png' },
		primary: { ...galleryTask.primary, filePath: 'Tasks/Zed.md' },
	} as import('../src/types/fields').IndexedTask;
	const gallerySortPreset = createDefaultTablePreset();
	gallerySortPreset.sortRules = [{ key: 'taskGallery', direction: 'asc', empty: 'last' }];
	const gallerySortQuery = queryTableRows({
		preset: gallerySortPreset,
		filterSet: null,
		tasks: [laterGalleryTask, galleryTask],
		priorities: [],
		settings: DEFAULT_SETTINGS,
	});
	deepEqual(gallerySortQuery.rows.map(task => task.operonId), ['gallery1', 'gallery2']);

	for (const version of [1, 2] as const) {
		const source = buildLegacyTaskDataTypeTableSource(version);
		const parsed = parseOperonTableFile(source, `Tables/Legacy V${version}.table`);
		equal(parsed.status, 'valid');
		if (parsed.status !== 'valid') continue;
		equal(parsed.file.version, version, 'lazy read must retain the source envelope version.');
		deepEqual(parsed.preset.columns.map(column => column.key), [TABLE_TASK_DATA_TYPE_COLUMN_KEY, 'status']);
		equal(parsed.preset.columns[0]?.label, 'Legacy source kind');
		deepEqual(parsed.preset.sortRules.map(rule => rule.key), [TABLE_TASK_DATA_TYPE_COLUMN_KEY, 'status']);
		deepEqual(parsed.preset.summaries.map(summary => summary.key), [TABLE_TASK_DATA_TYPE_COLUMN_KEY, 'status']);
		equal(parsed.preset.groupBy, TABLE_TASK_DATA_TYPE_COLUMN_KEY);
		equal(parsed.preset.subgroupBy, null, 'dedupe must remove a subgroup that maps to the same synthetic key.');
		equal(parsed.preset.filterSetId, 'fs-unrelated', 'non-migrated preset data must remain exact.');
		deepEqual(parsed.preset.collapsedGroupKeys, version === 1 ? [] : ['inline']);
		equal((JSON.parse(serializeOperonTableFile(parsed.preset)) as { version: number }).version, 3);
	}

	const legacySettingsPreset = createDefaultTablePreset();
	legacySettingsPreset.summaries = [
		{ key: 'taskType', function: 'Count' },
		{ key: '__taskType', function: 'Filled' },
		{ key: TABLE_TASK_DATA_TYPE_COLUMN_KEY, function: 'Unique' },
		{ key: 'status', function: 'TopValues' },
	];
	const migratedLegacySettings = migrateSettings({
		settingsVersion: 114,
		tablePresets: [legacySettingsPreset],
	});
	deepEqual(migratedLegacySettings.tablePresets[0]?.summaries, [
		{ key: TABLE_TASK_DATA_TYPE_COLUMN_KEY, function: 'Count' },
		{ key: 'status', function: 'TopValues' },
	], 'Legacy synthetic summary conflicts must dedupe by effective field key while unrelated summaries remain intact.');

	const v3UserTaskType = JSON.parse(serializeOperonTableFile(createDefaultTablePreset())) as Record<string, any>;
	v3UserTaskType.columns = [{ key: 'taskType', kind: 'task' }];
	v3UserTaskType.sortRules = [{ key: 'taskType', direction: 'asc', empty: 'last' }];
	v3UserTaskType.groupBy = 'taskType';
	v3UserTaskType.subgroupBy = null;
	v3UserTaskType.summaries = [{ key: 'taskType', function: 'Count' }];
	const v3Parsed = parseOperonTableFile(JSON.stringify(v3UserTaskType), 'Tables/User taskType.table');
	equal(v3Parsed.status, 'valid', 'V3 taskType is the writable user field, not a synthetic alias.');
	if (v3Parsed.status === 'valid') {
		equal(v3Parsed.preset.columns[0]?.key, 'taskType');
	}
	const v3RetiredType = structuredClone(v3UserTaskType);
	v3RetiredType.columns = [{ key: '__taskType', kind: 'task' }];
	equal(parseOperonTableFile(JSON.stringify(v3RetiredType), 'Tables/Retired.table').status, 'invalid');
	const futureV4 = structuredClone(v3UserTaskType);
	futureV4.version = 4;
	equal(parseOperonTableFile(JSON.stringify(futureV4), 'Tables/Future.table').status, 'invalid');

	let tableSource = buildLegacyTaskDataTypeTableSource(2);
	const tableDescriptor = { path: 'Tables/Lazy migration.table' };
	const writes: string[] = [];
	let failWrite = false;
	const registry = new TablePresetRegistry({
		loadFileBindings: async () => [{ id: 'table-preset-my-first-table', path: tableDescriptor.path }],
		listTableFiles: async () => [tableDescriptor],
		readTableFile: async () => tableSource,
		writeTableFile: async (_path, contents) => {
			if (failWrite) throw new Error('intentional write failure');
			writes.push(contents);
			tableSource = contents;
		},
		applyPatch: (preset, patch) => ({ ...preset, ...patch }),
		schedulePatch: () => 0,
		cancelScheduledPatch: () => {},
	});
	await registry.refresh();
	deepEqual(writes, [], 'Legacy Table loads must migrate in memory without writes.');
	await registry.refresh();
	deepEqual(writes, [], 'A second legacy load must remain write-free.');
	equal(registry.getPreset('table-preset-my-first-table')?.groupBy, TABLE_TASK_DATA_TYPE_COLUMN_KEY);
	const saved = registry.queuePatch('table-preset-my-first-table', 'stage3-save', {
		id: 'table-preset-my-first-table', name: 'Saved as V3',
	});
	await saved.flush();
	equal(writes.length, 1, 'An existing explicit save path is the only V3 persistence boundary.');
	equal((JSON.parse(tableSource) as { version: number }).version, 3);
	const beforeFailure = tableSource;
	failWrite = true;
	const failed = registry.queuePatch('table-preset-my-first-table', 'stage3-failure', {
		id: 'table-preset-my-first-table', name: 'Must not persist',
	});
	await assert.rejects(failed.flush(), /intentional write failure/u);
	equal(tableSource, beforeFailure, 'A failed explicit Table write must leave the source unchanged.');

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
