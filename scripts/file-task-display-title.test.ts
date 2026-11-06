import { FormatConverter } from '../src/systems/format-converter';
import { parseTaskLine } from '../src/core/parser';
import type { OperonIndexer } from '../src/indexer/indexer';
import { RecurrenceService, buildRecurringFileFieldPresence } from '../src/systems/recurrence-service';
import { parseRepeatRule } from '../src/core/repeat-rule';
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import ts from 'typescript';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { Notice, TFile, type App } from 'obsidian';
import { activeWindow } from './test-support/obsidian';
import { getTaskDisplayTitle, newFileTaskTitleFields } from '../src/core/task-display-title';
import { isWritableRawYamlPropertyName } from '../src/core/raw-yaml-property';
import { applyYamlTaskFieldValues } from '../src/core/task-writer-yaml';
import { readYamlFields } from '../src/core/yaml-fields';
import { CreationDraftProperties } from '../src/core/task-creation-draft-properties';
import { TaskWriter, type TaskWriterIndexerPort } from '../src/core/task-writer';
import { buildMergedFileTaskDraft, parseFrontmatterDocument, splitFrontmatterDocument } from '../src/core/file-task-template-merge';
import { resolveFileTaskDefaults } from '../src/core/file-task-defaults';
import { exportOperonSettingsBackupJsonV1 } from '../src/core/settings-backup-export';
import { parseOperonSettingsBackupV1 } from '../src/core/settings-backup-format';
import { validateOperonSettingsBackupGroupsV1 } from '../src/core/settings-backup-group-validation';
import {
	DEFAULT_FILENAME_RULE, deriveTaskFilename, filenameSuggestionAfterTitleEdit, normalizeFilenameRule,
	sanitizeTaskFilename,
} from '../src/core/filename-rule';
import { t } from '../src/core/i18n';
import { scanFileWithMappings } from '../src/indexer/file-scanner';
import type { IndexReconciliationEvent } from '../src/indexer/indexer';
import type { IndexedTask } from '../src/types/fields';
import { DEFAULT_SETTINGS, buildKeyMappingVisiblePropertyNameUpdate, getMissingDefaultKeyMappingCollisions, isChildTaskInheritanceEligibleFieldKey, migrateSettings } from '../src/types/settings';
import { buildLivePropertyCatalogV1 } from '../src/agent-runtime/runtime/catalog-builder';
import { buildTaskPoolSearchText } from '../src/systems/task-pool-search';
import { rankTaskSearchResults } from '../src/systems/task-search';
import { FileTaskTitleRenamer, FILE_TASK_TITLE_RENAME_DELAY_MS } from '../src/systems/file-task-title-renamer';
import { getTableTaskRawValue } from '../src/ui/table/table-value-adapter';
import { createTableValueResolver } from '../src/ui/table/table-value-cache';
import { buildTableTaskSearchMatcher } from '../src/ui/table/table-search';
import { renderFileTaskRenameControls } from '../src/ui/file-task-rename-callout';

const file = Object.assign(Object.create(TFile.prototype) as TFile, {
	path: 'old-file.md', name: 'old-file.md', basename: 'old-file', extension: 'md', parent: { path: '' },
	stat: { mtime: 1, ctime: 1, size: 1 },
});
const task: IndexedTask = {
	operonId: 'n000123', description: 'old-file', checkbox: 'open', tags: [],
	fieldValues: { fileTaskDisplayTitle: 'Readable task title' },
	primary: { filePath: file.path, lineNumber: 0, format: 'yaml' }, datetimeModified: '', tier: 'hot',
};
function mappingsFor(name: string) {
	const result = buildKeyMappingVisiblePropertyNameUpdate(DEFAULT_SETTINGS.keyMappings, 'fileTaskDisplayTitle', name);
	assert.equal(result.status, 'updated');
	if (result.status !== 'updated') throw new Error('Expected title mapping');
	return result.keyMappings;
}

test('canonical title hydration follows the mapping and preserves filename identity', async () => {
	const source = '---\noperonId: n000123\ntitle: Readable task title\nlabel: Alternate label\n---\nBody';
	const app = { vault: { read: async () => source } } as unknown as App;
	for (const [mappings, expected] of [[DEFAULT_SETTINGS.keyMappings, 'Readable task title'], [mappingsFor('label'), 'Alternate label']] as const) {
		const scanned = (await scanFileWithMappings(app, file, mappings, source)).yamlTask!;
		assert.equal(scanned.description, 'old-file');
		assert.equal(scanned.fieldValues.title, undefined);
		assert.equal(scanned.fieldValues.fileTaskDisplayTitle, expected);
	}
	assert.equal(isChildTaskInheritanceEligibleFieldKey('fileTaskDisplayTitle', DEFAULT_SETTINGS.keyMappings), false);
});

test('invalid native YAML titles fall back to the filename without rewriting the source', async () => {
	for (const literal of ['123', 'true', '[First, Second]', '{text: title}', 'null', '""']) {
		const source = `---\noperonId: n000123\ntitle: ${literal}\n---\nBody`;
		const scanned = (await scanFileWithMappings({} as App, file, DEFAULT_SETTINGS.keyMappings, source)).yamlTask!;
		assert.equal(getTaskDisplayTitle({ ...task, fieldValues: scanned.fieldValues }, true), 'old-file');
		const parsed = parseFrontmatterDocument(source, DEFAULT_SETTINGS.keyMappings);
		assert.equal(parsed.managedFieldValues.fileTaskDisplayTitle ?? '', '');
	}
	const fields = { note: 'Keep me' };
	assert.deepEqual(newFileTaskTitleFields('Review Q3 Plan', fields, DEFAULT_SETTINGS), fields);
	assert.deepEqual(newFileTaskTitleFields('Review Q3 Plan', fields, {
		...DEFAULT_SETTINGS, fileTaskDisplayTitleEnabled: true,
	}), { note: 'Keep me', fileTaskDisplayTitle: 'Review Q3 Plan' });
	assert.deepEqual(fields, { note: 'Keep me' });
	assert.throws(() => newFileTaskTitleFields('Title', {}, {
		...DEFAULT_SETTINGS, fileTaskDisplayTitleEnabled: true, keyMappings: [],
	}), /mapping/);
});

test('labels use the opt-in title while Table raw identity stays the filename', () => {
	assert.equal(getTaskDisplayTitle(task, false), 'old-file');
	assert.equal(getTaskDisplayTitle(task, true), 'Readable task title');
	assert.equal(getTaskDisplayTitle({ ...task, fieldValues: {} }, true), 'old-file');
	assert.equal(getTaskDisplayTitle({ ...task, primary: { ...task.primary, format: 'inline' } }, true), 'old-file');
	assert.equal(getTableTaskRawValue(task, 'description'), 'old-file');
	for (const enabled of [false, true]) {
		const resolver = createTableValueResolver([task], { keyMappings: DEFAULT_SETTINGS.keyMappings, fileTaskDisplayTitleEnabled: enabled });
		assert.equal(resolver.getDisplayValue(task, 'description'), enabled ? 'Readable task title' : 'old-file');
	}
});

test('Finder, Table and task-pool search use the enabled display title', () => {
	for (const enabled of [false, true]) {
		const results = rankTaskSearchResults({
			tasks: [task, { ...task, operonId: 'n000124', fieldValues: {} }], query: 'readable task',
			includeAllTasks: true, keyMappings: [], displayTitleEnabled: enabled,
		});
		assert.deepEqual(results.map(result => result.task.operonId), enabled ? ['n000123'] : []);
		assert.equal(buildTaskPoolSearchText(task, enabled).includes('Readable task title'), enabled);
	}
	const match = buildTableTaskSearchMatcher([task], { ...DEFAULT_SETTINGS, fileTaskDisplayTitleEnabled: true }, [{ key: 'description', kind: 'task' }]);
	assert.equal(match(task, 'readable task'), true);
});

test('migration preserves custom mappings that collide with the title default', () => {
	for (const [canonicalKey, visiblePropertyName] of [['customDocumentTitle', 'title'], ['fileTaskDisplayTitle', 'customTitle']]) {
		const custom = { canonicalKey, visiblePropertyName, type: 'text' as const, sync: 'yes' as const, enabled: true, isSystem: false };
		const settings = migrateSettings({ ...DEFAULT_SETTINGS, keyMappings: [...DEFAULT_SETTINGS.keyMappings.filter(m => m.canonicalKey !== 'fileTaskDisplayTitle'), custom] });
		const preserved = settings.keyMappings.filter(m => m.canonicalKey === canonicalKey);
		assert.equal(preserved.length, 1);
		assert.equal(preserved[0].visiblePropertyName, visiblePropertyName);
		assert.equal(preserved[0].isSystem, false);
		assert.deepEqual(getMissingDefaultKeyMappingCollisions(settings.keyMappings), ['fileTaskDisplayTitle']);
		if (canonicalKey === 'customDocumentTitle') {
			const catalog = buildLivePropertyCatalogV1(settings);
			assert.ok(catalog.ok);
			assert.equal(catalog.value.fields.find(f => f.canonicalKey === 'fileTaskDisplayTitle')?.mappingStatus, 'unmapped');
		}
	}
});

test('title write permission applies only to the mapped system property', () => {
	for (const [name, mappings] of [['title', DEFAULT_SETTINGS.keyMappings], ['label', mappingsFor('label')]] as const) {
		assert.equal(isWritableRawYamlPropertyName(name, mappings), false);
		assert.equal(isWritableRawYamlPropertyName(name, mappings, 'fileTaskDisplayTitle'), true);
		for (const forbidden of ['notTheMappedTitle', '_title', 'operonId', name === 'label' ? 'title' : 'label']) {
			assert.equal(isWritableRawYamlPropertyName(forbidden, mappings, 'fileTaskDisplayTitle'), false);
		}
	}
	assert.equal(isWritableRawYamlPropertyName('title', [], 'fileTaskDisplayTitle'), false);
});

test('explicit title edits repair invalid native types as text', () => {
	for (const previous of [123, false, ['list'], { text: 'object' }]) {
		for (const value of ['456', 'true', 'line one\nline two']) {
			const frontmatter: Record<string, unknown> = { operonId: 'n000123', title: previous };
			applyYamlTaskFieldValues(frontmatter, { fileTaskDisplayTitle: value }, 'merge', DEFAULT_SETTINGS.keyMappings);
			assert.equal(frontmatter.title, value);
			assert.equal(readYamlFields(frontmatter, DEFAULT_SETTINGS.keyMappings).fileTaskDisplayTitle, value);
		}
	}
});

test('a colliding custom canonical title field retains its type, edits and inheritance', () => {
	const custom = { canonicalKey: 'fileTaskDisplayTitle', visiblePropertyName: 'customTitle',
		type: 'number' as const, sync: 'yes' as const, enabled: true, isSystem: false };
	const settings = migrateSettings({ ...DEFAULT_SETTINGS, fileTaskDisplayTitleEnabled: true,
		childTaskInheritanceFields: ['fileTaskDisplayTitle'],
		keyMappings: [...DEFAULT_SETTINGS.keyMappings.filter(mapping => mapping.canonicalKey !== custom.canonicalKey), custom] });
	assert.equal(settings.fileTaskDisplayTitleEnabled, false);
	assert.ok(settings.childTaskInheritanceFields.includes('fileTaskDisplayTitle'));
	const frontmatter: Record<string, unknown> = { operonId: 'n000123', customTitle: 12 };
	assert.equal(readYamlFields(frontmatter, settings.keyMappings).fileTaskDisplayTitle, '12');
	applyYamlTaskFieldValues(frontmatter, { fileTaskDisplayTitle: '34' }, 'merge', settings.keyMappings);
	assert.equal(frontmatter.customTitle, 34);
	assert.equal(frontmatter.title, undefined);
	const catalog = new CreationDraftProperties({ keyMappings: settings.keyMappings, propertyTypes: { customTitle: 'number' } });
	const property = catalog.resolve('customTitle');
	assert.equal(property.type, 'number');
	assert.equal(property.readOnlyReason, undefined);
	assert.deepEqual(catalog.read(property, 34), { value: 34 });
});

test('mapped title writes and clears preserve identity; unrelated replace writes preserve the title', () => {
	for (const [name, mappings] of [['title', DEFAULT_SETTINGS.keyMappings], ['label', mappingsFor('label')]] as const) {
		const frontmatter: Record<string, unknown> = { operonId: 'n000123', description: 'old-file', [name]: 'Before' };
		for (const mode of ['merge', 'replace'] as const) {
			applyYamlTaskFieldValues(frontmatter, { operonId: 'n000123', fileTaskDisplayTitle: 'Updated' }, mode, mappings);
			assert.equal(frontmatter[name], 'Updated');
			assert.equal(frontmatter.operonId, 'n000123');
			assert.equal(frontmatter.description, 'old-file');
		}
		applyYamlTaskFieldValues(frontmatter, { operonId: 'n000123', status: 'Task.Doing' }, 'replace', mappings);
		assert.equal(frontmatter[name], 'Updated');
		assert.equal(frontmatter.operonId, 'n000123');
		applyYamlTaskFieldValues(frontmatter, { operonId: 'n000123', fileTaskDisplayTitle: '' }, 'merge', mappings);
		assert.equal(Object.prototype.hasOwnProperty.call(frontmatter, name), false);
		assert.equal(frontmatter.operonId, 'n000123');
		assert.equal(frontmatter.description, 'old-file');
	}
});

test('three filename presets preserve Unicode and default to same as title', () => {
	assert.deepEqual(DEFAULT_FILENAME_RULE, { preset: 'same' });
	for (const [title, preset, expected] of [
		['Review Q3 Plan', 'same', 'Review Q3 Plan'], ['Review Q3 Plan', 'kebab', 'review-q3-plan'],
		['Review Q3 Plan', 'snake', 'review_q3_plan'], ['Quarterly: Review!', 'same', 'Quarterly Review!'],
		['日本語 計画 １２３', 'kebab', '日本語-計画-１２３'], ['خطة العمل ١٢٣', 'snake', 'خطة_العمل_١٢٣'],
		['İş Planı', 'kebab', 'i̇ş-planı'], ['Café Plan', 'snake', 'café_plan'],
	] as const) assert.equal(deriveTaskFilename(title, { preset }), expected);
	assert.equal(sanitizeTaskFilename(' A:B/C*D?E"F<G>H|I '), 'ABCDEFGHI');
});

test('Ask alone suggests a changed filename and never suggests clearing a title', async () => {
	for (const [title, basename, mode, expected] of [
		['New task', 'old-name', 'keep', null], ['New task', 'old-name', 'auto', null],
		['New task', 'old-name', 'ask', { filename: 'New task' }], ['New task', 'New task', 'ask', null],
		['  \t ', 'old-name', 'ask', null],
	] as const) assert.deepEqual(await filenameSuggestionAfterTitleEdit(title, basename, mode, DEFAULT_FILENAME_RULE), expected);
	const empty = await filenameSuggestionAfterTitleEdit('!!!', 'current-name', 'ask', { preset: 'kebab' });
	assert.equal(empty?.filename, 'current-name');
	assert.match(empty?.error ?? '', /empty filename.*current-name/i);
});

test('filename rule settings normalize and survive a backup round trip', () => {
	assert.deepEqual(normalizeFilenameRule({ preset: 'snake', lowercase: false, rules: [] }), { preset: 'snake' });
	for (const value of [undefined, null, { preset: 'unknown' }, { preset: 'custom', rules: [{}] }]) {
		assert.deepEqual(normalizeFilenameRule(value), { preset: 'same' });
	}
	const rule = { preset: 'snake' as const };
	const settings = migrateSettings({ ...DEFAULT_SETTINGS, fileTaskDisplayTitleEnabled: true, fileTaskFilenameRule: rule });
	assert.equal(settings.fileTaskDisplayTitleEnabled, true);
	assert.deepEqual(settings.fileTaskFilenameRule, rule);
	const backup = exportOperonSettingsBackupJsonV1({ settings, source: { pluginVersion: '4.3.0', obsidianVersion: '1.14.5', dataPackageSchemaVersion: 2 }, createdAt: '2026-10-25T00:00:00.000Z' });
	assert.ok(backup.ok);
	const parsed = parseOperonSettingsBackupV1(backup.json);
	assert.ok(parsed.ok);
	const decoded = validateOperonSettingsBackupGroupsV1(parsed.value.body.groups);
	assert.ok(decoded.ok);
	assert.deepEqual(migrateSettings({ ...DEFAULT_SETTINGS, ...decoded.payloads.general }).fileTaskFilenameRule, rule);
});

// Match the existing source-sync suite: execute selected production methods with bounded collaborators.
function methods(filename: string, names: string[], dependencies: Record<string, unknown> = {}) {
	const source = readFileSync(filename, 'utf8'), ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
	const klass = ast.statements.find(node => ts.isClassDeclaration(node) && names.every(name => node.members.some(member => member.name?.getText(ast) === name))) as ts.ClassDeclaration;
	assert.ok(klass, `class containing ${names}`);
	const selected = names.map(name => klass.members.find(member => member.name?.getText(ast) === name)!.getText(ast)).join('\n');
	const code = ts.transpileModule(`class Fixture { ${selected} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
	return new Function(...Object.keys(dependencies), `${code}; return Fixture;`)(...Object.values(dependencies));
}
const RenameHost = methods('main.ts', [
	'updateTableTaskFieldsAndRefresh', 'commitTableTaskFieldsAndRefresh', 'renameFileTaskFromTitle', 'handleFileTaskTitleChanged',
	'updateTableTaskDescriptionAndRefresh', 'commitTableTaskDescriptionAndRefresh', 'writeYamlTaskInstance',
], { TFile, buildMergedFileTaskDraft, filenameSuggestionAfterTitleEdit, parseFrontmatterDocument, splitFrontmatterDocument,
	resolveFileTaskDefaults, localNow: () => '2026-10-25T02:00:00', generateOperonId: () => 'n000999', t });

// The repository's Node declarations predate the Node 24 test APIs used by this lane.
type TestScope = TestContext & {
	after(cleanup: () => void): void;
	mock: {
		timers: { enable(options: { apis: string[] }): void; tick(milliseconds: number): void };
		method(target: unknown, name: string, implementation: unknown): void;
	};
};
async function vaultFixture(context: TestContext) {
	const currentFile = Object.assign(Object.create(TFile.prototype) as TFile, file, { stat: { ...file.stat } });
	let source = '---\noperonId: n000123\ntitle: Original title\nstatus: Task.Todo\n---\nBody content.';
	let current: IndexedTask = { ...task, fieldValues: { operonId: 'n000123', fileTaskDisplayTitle: 'Original title', status: 'Task.Todo' } };
	const settings = migrateSettings({ ...DEFAULT_SETTINGS, fileTaskDisplayTitleEnabled: true, fileTaskDisplayTitleChangeMode: 'ask', fileTaskFilenameRule: { preset: 'kebab' } });
	const notices: string[] = [], destinations: string[] = [];
	const occupied = new Map<string, string>();
	const state = { ready: true, fullScanAt: '2026-10-26T00:00:00Z', settlement: Promise.resolve(), beforeRename: async () => {} };
	const listeners = new Set<(event: IndexReconciliationEvent) => void>();
	const app = { vault: {
		getAbstractFileByPath: (name: string) => name === currentFile.path ? currentFile : occupied.has(name) ? Object.create(TFile.prototype) : null,
		read: async () => source, cachedRead: async () => source,
		modify: async (_file: TFile, content: string) => { source = content; },
		process: async (_file: TFile, transform: (content: string) => string) => { source = transform(source); },
	}, fileManager: {
		processFrontMatter: async (_file: TFile, mutate: (value: Record<string, unknown>) => void) => {
			const document = splitFrontmatterDocument(source), value = parseYaml(document.frontmatter!);
			mutate(value);
			source = `---\n${stringifyYaml(value).trimEnd()}\n---\n${document.body}`;
		},
		renameFile: async (_file: TFile, destination: string) => {
			await state.beforeRename();
			destinations.push(destination);
			Object.assign(currentFile, { path: destination, name: destination, basename: destination.slice(0, -3) });
		},
	} } as unknown as App;
	const emit = (event: IndexReconciliationEvent) => { for (const listener of listeners) listener(event); };
	const indexer = {
		getTask: () => current, getAllTasks: () => [current], hasDuplicateOperonIdConflict: () => false,
		isTaskSourceTransitionActive: () => false, isPathIndexable: () => true,
		subscribeIndexReconciliation: (listener: (event: IndexReconciliationEvent) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
		awaitRamSettlement: async () => { await state.settlement; return { state: 'settled' as const, ramGeneration: 1 }; },
		getLiveReadAuthoritySnapshot: () => ({
			state: 'verified' as const, settled: true, ramGeneration: 1, coherenceBasis: 'verified-full-scan' as const,
			lastFullScanAt: state.fullScanAt, durable: { status: 'unavailable' as const },
		}),
		reindexFilePath: async () => {}, reindexFilesBatch: async () => {}, scheduleReindex() {},
		reindexCommittedMutationSources: async () => {
			const before = current, scanned = (await scanFileWithMappings(app, currentFile, settings.keyMappings, source)).yamlTask!;
			assert.ok(scanned);
			current = { ...current, description: scanned.description, fieldValues: scanned.fieldValues, primary: { ...current.primary, filePath: currentFile.path } };
			emit({ kind: 'incremental', generation: 1, affectedOperonIds: [current.operonId], changes: [{ before, after: current }] });
		},
	};
	const main = new RenameHost();
	Object.assign(main, { app, indexer, settings, writer: new TaskWriter(app, indexer as unknown as TaskWriterIndexerPort, settings.keyMappings),
		withTableMutationRefresh: (operation: () => Promise<unknown>) => operation(), sanitizeTaskFileName: sanitizeTaskFilename,
		markInternalTaskWrite() {}, getParentLinkExpectedFields: () => null, parentLinkSourceMatches: () => true,
		refreshViews() {}, scheduleProjectSerialIndexReconcile() {}, consumeTableMutationRefresh() {}, refreshAggregateTotalsAfterTaskMutation: async () => {},
	});
	const renamer = new FileTaskTitleRenamer(indexer, () => settings, () => state.ready, () => currentFile.basename,
		(id, name) => main.renameFileTaskFromTitle(id, name), message => notices.push(message));
	(context as TestScope).after(() => renamer.destroy());
	return { app, file: currentFile, settings, state, main, indexer, renamer, notices, destinations, occupied,
		task: () => current, source: () => source, frontmatter: () => parseYaml(splitFrontmatterDocument(source).frontmatter!) as Record<string, unknown>,
		full: () => emit({ kind: 'full', generation: 1 }),
		edit: async (title: string) => { await app.fileManager.processFrontMatter(currentFile, value => { value.title = title; }); await indexer.reindexCommittedMutationSources(); },
	};
}
function renameClock(context: TestContext) {
	const scope = context as TestScope;
	scope.mock.timers.enable({ apis: ['setTimeout'] });
	scope.mock.method(activeWindow, 'setTimeout', globalThis.setTimeout);
	scope.mock.method(activeWindow, 'clearTimeout', globalThis.clearTimeout);
	return async () => { scope.mock.timers.tick(FILE_TASK_TITLE_RENAME_DELAY_MS + 1); await setImmediate(); };
}

test('title persistence precedes Ask and explicit rename preserves source and task identity', async context => {
	const f = await vaultFixture(context);
	assert.equal(await f.main.updateTableTaskFieldsAndRefresh(task.operonId, { fileTaskDisplayTitle: 'Saved: title' }), true);
	assert.equal(f.frontmatter().title, 'Saved: title');
	assert.equal(f.frontmatter().description, undefined);
	assert.equal(f.file.path, 'old-file.md');
	assert.equal(f.task().description, 'old-file');
	assert.deepEqual(await f.main.handleFileTaskTitleChanged(task.operonId, 'Saved: title'), { filename: 'saved-title' });
	assert.deepEqual(f.destinations, []);
	const saved = f.source();
	await assert.rejects(f.main.renameFileTaskFromTitle(task.operonId, 'invalid/name'), { message: t('taskEditor', 'fileTaskRenameInvalid') });
	await f.main.renameFileTaskFromTitle(task.operonId, 'saved-title');
	assert.equal(f.source(), saved);
	assert.equal(f.task().operonId, task.operonId);
	assert.equal(f.task().description, 'saved-title');
	for (const mode of ['keep', 'auto'] as const) {
		f.settings.fileTaskDisplayTitleChangeMode = mode;
		assert.equal(await f.main.handleFileTaskTitleChanged(task.operonId, 'Other title'), null);
	}
	assert.deepEqual(f.destinations, ['saved-title.md']);
});

test('disabled display titles retain filename editing and shared collision validation', async context => {
	const f = await vaultFixture(context);
	f.settings.fileTaskDisplayTitleEnabled = false;
	assert.equal(await f.main.handleFileTaskTitleChanged(task.operonId, 'No suggestion'), null);
	f.occupied.set('taken.md', 'Other file');
	assert.equal(await f.main.commitTableTaskDescriptionAndRefresh(f.task(), 'taken'), false);
	assert.equal(await f.main.commitTableTaskDescriptionAndRefresh(f.task(), 'legacy-rename'), true);
	assert.equal(f.file.path, 'legacy-rename.md');
	assert.equal(f.task().description, 'legacy-rename');
	assert.equal(f.frontmatter().title, 'Original title');
	assert.equal(f.task().operonId, task.operonId);
});

test('automatic title changes rename once and ignore write/rename echoes', async context => {
	const advance = renameClock(context), f = await vaultFixture(context);
	f.settings.fileTaskDisplayTitleChangeMode = 'auto';
	await f.edit('External title'); await advance();
	await f.indexer.reindexCommittedMutationSources(); await advance();
	assert.deepEqual(f.destinations, ['external-title.md']);
	assert.equal(f.task().description, 'external-title');
	assert.equal(f.task().operonId, task.operonId);
	assert.equal(f.frontmatter().title, 'External title');
	assert.deepEqual(f.notices, []);
});

test('rapid title edits select the latest value for external and Operon writes', async context => {
	const advance = renameClock(context), f = await vaultFixture(context);
	f.settings.fileTaskDisplayTitleChangeMode = 'auto';
	await f.edit('First title'); await f.edit('Latest title'); await advance();
	assert.deepEqual(f.destinations, ['latest-title.md']);
	assert.equal(f.frontmatter().title, 'Latest title');
	await f.main.updateTableTaskFieldsAndRefresh(task.operonId, { fileTaskDisplayTitle: 'Automatic table title' });
	assert.equal(await f.main.handleFileTaskTitleChanged(task.operonId, 'Automatic table title'), null);
	await advance();
	assert.deepEqual(f.destinations, ['latest-title.md', 'automatic-table-title.md']);
});

test('manual moves cancel pending work with and without index path publication', async context => {
	const advance = renameClock(context);
	for (const publish of [false, true]) {
		const f = await vaultFixture(context); f.settings.fileTaskDisplayTitleChangeMode = 'auto';
		await f.edit('Pending title'); await f.app.fileManager.renameFile(f.file, 'manual-choice.md');
		if (publish) await f.indexer.reindexCommittedMutationSources();
		await advance();
		assert.deepEqual(f.destinations, ['manual-choice.md']);
		assert.equal(f.frontmatter().title, 'Pending title');
		assert.deepEqual(f.notices, []);
		await f.edit('Next title'); await advance();
		assert.deepEqual(f.destinations, ['manual-choice.md', 'next-title.md']);
	}
});

test('new title and managed values survive already-issued native rename I/O', async context => {
	const advance = renameClock(context), f = await vaultFixture(context);
	f.settings.fileTaskDisplayTitleChangeMode = 'auto';
	let release!: () => void;
	const gate = new Promise<void>(resolve => { release = resolve; });
	let entered = false;
	f.state.beforeRename = async () => { if (!entered) { entered = true; await gate; } };
	await f.edit('Already issued'); await advance();
	assert.equal(entered, true);
	await f.edit('Newest during I/O');
	await f.app.fileManager.processFrontMatter(f.file, value => { value.note = 'Newer managed value'; });
	release(); await advance();
	assert.deepEqual(f.destinations, ['already-issued.md', 'newest-during-i-o.md']);
	assert.equal(f.frontmatter().title, 'Newest during I/O');
	assert.equal(f.frontmatter().note, 'Newer managed value');
	assert.deepEqual(f.notices, []);
});

test('keep, ask, disabled titles and mode changes never trigger automatic renames', async context => {
	const advance = renameClock(context), f = await vaultFixture(context);
	for (const mode of ['keep', 'ask'] as const) { f.settings.fileTaskDisplayTitleChangeMode = mode; await f.edit(`External ${mode}`); await advance(); }
	f.settings.fileTaskDisplayTitleChangeMode = 'auto'; f.settings.fileTaskDisplayTitleEnabled = false;
	await f.edit('Disabled title'); f.settings.fileTaskDisplayTitleEnabled = true; await advance();
	await f.edit('Enabled title'); f.settings.fileTaskDisplayTitleChangeMode = 'keep'; await advance();
	assert.deepEqual(f.destinations, []);
	assert.deepEqual(f.notices, []);
});

test('startup and full rebuild cancel drift, including the RAM settlement interval', async context => {
	const advance = renameClock(context), f = await vaultFixture(context);
	f.settings.fileTaskDisplayTitleChangeMode = 'auto'; f.state.ready = false;
	await f.edit('Initial build'); f.full(); f.state.ready = true; await advance();
	assert.deepEqual(f.destinations, []);
	await f.edit('Pending before rebuild'); f.full(); await advance();
	assert.deepEqual(f.destinations, []);
	let release!: () => void;
	f.state.settlement = new Promise<void>(resolve => { release = resolve; });
	await f.edit('Before settlement'); await advance();
	f.state.fullScanAt = '2026-10-26T00:01:00Z'; release(); await advance();
	assert.deepEqual(f.destinations, []);
	assert.deepEqual(f.notices, []);
	await f.edit('Next incremental'); await advance();
	assert.deepEqual(f.destinations, ['next-incremental.md']);
});

test('automatic collisions and invalid or empty names preserve source and notify once', async context => {
	const advance = renameClock(context);
	for (const title of ['Collision title', '..', '!!!', '']) {
		const f = await vaultFixture(context); f.settings.fileTaskDisplayTitleChangeMode = 'auto';
		f.occupied.set('collision-title.md', 'Existing file');
		if (title === '..') f.settings.fileTaskFilenameRule.preset = 'same';
		await f.edit(title); await advance();
		await f.indexer.reindexCommittedMutationSources(); await advance();
		assert.equal(f.file.path, 'old-file.md');
		assert.equal(f.frontmatter().title, title);
		assert.deepEqual(f.destinations, []);
		assert.equal(f.notices.length, title ? 1 : 0);
		assert.equal(f.occupied.get('collision-title.md'), 'Existing file');
	}
	const equal = await vaultFixture(context); equal.settings.fileTaskDisplayTitleChangeMode = 'auto';
	await equal.edit('Old file'); await advance();
	assert.deepEqual(equal.destinations, []);
	assert.deepEqual(equal.notices, []);
});

// Only the DOM operations used by native rename controls; assertions target actions, not layout.
class Control {
	children: Control[] = [];
	parentElement: Control | null = null;
	textContent = '';
	value = '';
	disabled = false;
	validity = '';
	listeners = new Map<string, () => void>();
	constructor(readonly tag = 'div') {}
	createEl(tag: string, value?: string | { text?: string; value?: string }) {
		const child = new Control(tag);
		if (typeof value === 'object') { child.textContent = value.text ?? ''; child.value = value.value ?? ''; }
		child.parentElement = this; this.children.push(child); return child;
	}
	createDiv(value?: string | { text?: string }) { return this.createEl('div', value); }
	createSpan(value?: string | { text?: string }) { return this.createEl('span', value); }
	empty() { for (const child of this.children) child.parentElement = null; this.children = []; }
	addEventListener(name: string, action: () => void) { this.listeners.set(name, action); }
	click() { if (!this.disabled) this.listeners.get('click')?.(); }
	setAttribute() {}
	removeAttribute() {}
	toggleAttribute(_name: string, disabled: boolean) { this.disabled = disabled; }
	setCustomValidity(message: string) { this.validity = message; }
	reportValidity() { return !this.validity; }
	focus() {}
	select() {}
	find(tag: string, text?: string): Control {
		const all = this.children.flatMap(child => [child, ...child.descendants()]);
		const found = all.find(child => child.tag === tag && (text === undefined || child.textContent === text));
		assert.ok(found, `${tag} ${text ?? ''}`); return found;
	}
	descendants(): Control[] { return this.children.flatMap(child => [child, ...child.descendants()]); }
}
function renameControls(host: Control, filename: string, rename: (value: string) => Promise<void>, dismiss = () => host.empty()) {
	renderFileTaskRenameControls(host as unknown as HTMLElement, { filename }, { variant: 'editor-row', currentFilename: 'old-file.md', rename, dismiss });
	return { rename: host.find('button', t('taskEditor', 'fileTaskRenameAction')), keep: host.find('button', t('taskEditor', 'fileTaskKeep')) };
}

test('Keep preserves the saved title and repeated Rename commits an edited suggestion once', async context => {
	const f = await vaultFixture(context), host = new Control();
	await f.main.updateTableTaskFieldsAndRefresh(task.operonId, { fileTaskDisplayTitle: 'New name 123' });
	const rename = (name: string) => f.main.renameFileTaskFromTitle(task.operonId, name);
	renameControls(host, 'new-name-123', rename).keep.click();
	assert.deepEqual(f.destinations, []);
	assert.equal(f.frontmatter().title, 'New name 123');
	const actions = renameControls(host, 'new-name-123', rename);
	host.find('button', 'new-name-123').click();
	host.find('input').value = '01-new-name-123';
	actions.rename.click(); actions.rename.click(); await setImmediate();
	assert.deepEqual(f.destinations, ['01-new-name-123.md']);
	assert.equal(f.task().description, '01-new-name-123');
	assert.equal(f.frontmatter().title, 'New name 123');
	assert.equal(f.frontmatter().operonId, task.operonId);
	assert.equal(host.children.length, 0, 'successful Rename dismisses the controls');
});

test('failed rename retains the saved title and controls for correction', async context => {
	const f = await vaultFixture(context), host = new Control(), notices: string[] = [];
	const notice = Notice as unknown as { onNotice: ((message: string) => void) | null };
	const previous = notice.onNotice; notice.onNotice = message => notices.push(message);
	(context as TestScope).after(() => { notice.onNotice = previous; });
	await f.main.updateTableTaskFieldsAndRefresh(task.operonId, { fileTaskDisplayTitle: 'Saved before rename' });
	f.state.beforeRename = async () => { throw new Error('Rename failed'); };
	const actions = renameControls(host, 'saved-before-rename', name => f.main.renameFileTaskFromTitle(task.operonId, name));
	actions.rename.click(); await setImmediate();
	assert.deepEqual(notices, ['Rename failed']);
	assert.equal(actions.rename.disabled, false);
	assert.equal(f.file.path, 'old-file.md');
	assert.equal(f.frontmatter().title, 'Saved before rename');
	assert.equal(f.frontmatter().operonId, task.operonId);
	actions.keep.click(); assert.equal(host.children.length, 0);
});

test('completion and Keep from replaced controls cannot dismiss the current suggestion', async () => {
	const host = new Control(); let release!: () => void, dismissed = 0;
	const gate = new Promise<void>(resolve => { release = resolve; });
	const old = renameControls(host, 'title-a', async () => gate, () => { dismissed++; });
	old.rename.click();
	renameControls(host, 'title-b', async () => {});
	release(); await setImmediate(); old.keep.click();
	assert.equal(dismissed, 0);
	assert.ok(host.find('button', 'title-b'));
});

test('mapped titles round-trip unsafe text through the scanner', async () => {
	for (const value of ['Rule: Non-title', '@leading', '*alias', '&anchor', '- item', 'true', '123', 'line one\nline two', 'C:\\path\\file']) {
		const draft = buildMergedFileTaskDraft({
			source: {
				description: 'old-file', fieldValues: { operonId: 'n000123', fileTaskDisplayTitle: value },
				frontmatterDocument: parseFrontmatterDocument('---\noperonId: n000123\n---\nbody', DEFAULT_SETTINGS.keyMappings),
			},
			defaults: { operonId: 'n000123', datetimeModified: '2026-10-25T02:00:00' }, keyMappings: DEFAULT_SETTINGS.keyMappings, bodyStrategy: 'preserve-source',
		});
		const app = { vault: { read: async () => draft.content } } as unknown as App;
		const scanned = (await scanFileWithMappings(app, file, DEFAULT_SETTINGS.keyMappings, draft.content)).yamlTask!;
		assert.equal(scanned.fieldValues.fileTaskDisplayTitle, value);
	}
	const draft = buildMergedFileTaskDraft({
		source: { description: 'old-file', fieldValues: {
			operonId: 'n000123', fileTaskDisplayTitle: 'Title: subtitle',
		} },
		defaults: { operonId: 'n000123', datetimeModified: '2026-10-25T02:00:00' }, keyMappings: DEFAULT_SETTINGS.keyMappings, bodyStrategy: 'preserve-source',
	});
	assert.match(draft.content, /title: "Title: subtitle"/u);
});

test('filename format remains available in Keep mode through the shared settings control', () => {
 const rendered: Array<{ key: string; options: string[] }> = [];
 const Settings = methods('src/ui/settings-tab.ts', ['renderFileTaskDisplaySettings'], { t });
 const renderer = new Settings();
 Object.assign(renderer, {
  settings: { ...DEFAULT_SETTINGS, fileTaskDisplayTitleEnabled: true, fileTaskDisplayTitleChangeMode: 'keep' },
  renderBoundToggleSetting() {},
  renderBoundDropdownSetting(_el: unknown, _name: string, _desc: string, key: string, config: { dropdownOptions: Array<{ value: string }> }) {
   rendered.push({ key, options: config.dropdownOptions.map(option => option.value) });
  },
 });
 renderer.renderFileTaskDisplaySettings({ addClass() {} });
 assert.deepEqual(rendered, [
  { key: 'fileTaskDisplayTitleChangeMode', options: ['keep', 'ask', 'auto'] },
  { key: 'fileTaskFilenameRule', options: ['same', 'kebab', 'snake'] },
 ]);
});

// Additional approved rendering coverage.
import contextFixtures from './agent-runtime/contracts/fixtures/cases.json';
import { decodeTaskContextV1 } from '../src/agent-runtime/contracts/v1/decode';

test('Runtime TaskContext displayTitle is optional and bounded in UTF-8 bytes', () => {
	const fixture = contextFixtures.cases.find(item => item.schemaId === 'task-context' && item.expected);
	assert.ok(fixture);
	const value = structuredClone(fixture.value);
	const entity = value;
	assert.ok('description' in entity);
	for (const [displayTitle, accepted] of [
		[undefined, true], ['Readable title', true], ['a'.repeat(8192), true], ['a'.repeat(8193), false],
		['é'.repeat(4096), true], ['é'.repeat(4096) + 'a', false], [42, false],
	] as const) {
		if (displayTitle === undefined) Reflect.deleteProperty(entity, 'displayTitle');
		else Reflect.set(entity, 'displayTitle', displayTitle);
		const decoded = decodeTaskContextV1(value);
		assert.equal(decoded.ok, accepted);
		if (decoded.ok) {
			assert.equal(decoded.value.displayTitle, displayTitle);
			assert.equal(Object.prototype.hasOwnProperty.call(decoded.value, 'displayTitle'), displayTitle !== undefined);
			assert.equal(decoded.value.description, entity.description);
		}
	}
});


test('Runtime title-only edits suppress Auto and later external edits still rename', async context => {
 const tick = renameClock(context), f = await vaultFixture(context);
 f.settings.fileTaskDisplayTitleChangeMode = 'auto';
 await f.renamer.preservingFilename(task.operonId, 'API title', async () => { await f.edit('API title'); return { mutationMayHaveApplied: true }; });
 await tick(); assert.deepEqual(f.destinations, []); assert.equal(f.frontmatter().title, 'API title');
 await f.edit('User title'); await tick(); assert.deepEqual(f.destinations, ['user-title.md']);
});

test('a delayed write echo after an uncertain Runtime outcome cannot rename', async context => {
 const tick = renameClock(context), f = await vaultFixture(context);
 f.settings.fileTaskDisplayTitleChangeMode = 'auto';
 await f.renamer.preservingFilename(task.operonId, 'Delayed API title', async () => ({ mutationMayHaveApplied: true }));
 await f.edit('Delayed API title'); await tick(); assert.deepEqual(f.destinations, []);
 await f.edit('Later user title'); await tick(); assert.deepEqual(f.destinations, ['later-user-title.md']);
});

test('a refused Runtime title mutation does not consume a later user edit', async context => {
 const tick = renameClock(context), f = await vaultFixture(context);
 f.settings.fileTaskDisplayTitleChangeMode = 'auto';
 await f.renamer.preservingFilename(task.operonId, 'Same title', async () => ({ mutationMayHaveApplied: false }));
 await f.edit('Same title'); await tick(); assert.deepEqual(f.destinations, ['same-title.md']);
});


test('a concurrent human edit is deferred and renamed after a refused Runtime write', async context => {
 const tick = renameClock(context), f = await vaultFixture(context);
 f.settings.fileTaskDisplayTitleChangeMode = 'auto';
 await f.renamer.preservingFilename(task.operonId, 'API title', async () => { await f.edit('Human title'); await tick(); assert.deepEqual(f.destinations, []); return { mutationMayHaveApplied: false }; });
 await tick(); assert.deepEqual(f.destinations, ['human-title.md']);
});


test('settings changes and full scans cancel deferred preexisting rename work', async context => {
 const tick = renameClock(context);
 for (const cancel of ['settings', 'full'] as const) {
  const f = await vaultFixture(context); f.settings.fileTaskDisplayTitleChangeMode = 'auto';
  await f.renamer.preservingFilename(task.operonId, 'API title', async () => {
   await f.edit('Human title');
   if (cancel === 'full') f.full(); else f.renamer.cancelPending();
   return { mutationMayHaveApplied: false };
  });
  await tick(); assert.deepEqual(f.destinations, []);
 }
});


test('a compensated Runtime title write never renames the restored title', async context => {
 const tick = renameClock(context), f = await vaultFixture(context);
 f.settings.fileTaskDisplayTitleChangeMode = 'auto';
 const beforeTitle = f.task().fieldValues.fileTaskDisplayTitle;
 await f.renamer.preservingFilename(task.operonId, 'API title', async () => {
  await f.edit('API title'); await f.edit(beforeTitle);
  return { mutationMayHaveApplied: false };
 });
 await tick(); assert.deepEqual(f.destinations, []); assert.equal(f.frontmatter().title, beforeTitle);
});


test('a later recovery uses journal title preimages to suppress compensation rename', async context => {
 const tick = renameClock(context), f = await vaultFixture(context);
 f.settings.fileTaskDisplayTitleChangeMode = 'auto';
 const original = f.task().fieldValues.fileTaskDisplayTitle;
 await f.renamer.preservingFilename(task.operonId, 'API title', async () => { await f.edit('API title'); return { mutationMayHaveApplied: true }; });
 await f.renamer.preservingFilename(task.operonId, 'API title', async () => {
  f.renamer.preserveJournalTitleEchoes(task.operonId, [original, 'API title']);
  await f.edit(original); return { mutationMayHaveApplied: false };
 });
 await tick(); assert.deepEqual(f.destinations, []);
});


test('recurring File Tasks preserve their exact native human title and body', () => {
 const title = ' Human: title \n第二行 ', now = '2026-11-06T12:00:00';
 const content = `---\noperonId: n000123\ntitle: ${JSON.stringify(title)}\nrepeat: mode=schedule|freq=day|interval=1\n---\nBody`;
 for (const enabled of [false, true]) {
  const settings = { ...DEFAULT_SETTINGS, fileTaskDisplayTitleEnabled: enabled };
  const document = parseFrontmatterDocument(content, settings.keyMappings);
  const sourceTask: IndexedTask = { ...task, fieldValues: document.managedFieldValues };
  const service = Object.create(RecurrenceService.prototype) as RecurrenceService;
  Reflect.set(service, 'getSettings', () => settings);
  const planned = Reflect.apply(Reflect.get(service, 'buildNextOccurrenceFieldValues'), service, [sourceTask, sourceTask, parseRepeatRule('mode=schedule|freq=day|interval=1'), { seriesId: 'series1', skipDates: [] }, '2026-11-07', '2026-11-07', {}, now, 'n000124']) as Record<string, string>;
  const draft = buildMergedFileTaskDraft({ source: { description: 'next-physical-name', fieldValues: planned, fieldPresence: buildRecurringFileFieldPresence(planned, document), frontmatterDocument: document }, defaults: { operonId: 'n000124', datetimeModified: now }, keyMappings: settings.keyMappings, bodyStrategy: 'preserve-source', preserveSourceKeyChoices: true });
  const split = splitFrontmatterDocument(draft.content);
  assert.equal(planned.fileTaskDisplayTitle, title); assert.equal(parseYaml(split.frontmatter!).title, title); assert.equal(split.body, 'Body');
 }
});


test('File to Inline to File preserves the native human title', async () => {
 const title = ' Human: title \n第二行 ', now = '2026-11-06T12:00:00';
 const ConversionHost = methods('main.ts', ['finishInlineTaskToFileTaskConversionInSource'], { newFileTaskTitleFields, localNow: () => now, t });
 for (const enabled of [false, true]) {
  const settings = { ...DEFAULT_SETTINGS, fileTaskDisplayTitleEnabled: enabled };
  const sourceTask: IndexedTask = { ...task, fieldValues: { operonId: task.operonId, fileTaskDisplayTitle: title } };
  const converter = new FormatConverter({} as App, { getTask: () => sourceTask } as unknown as OperonIndexer, settings);
  const line = converter.yamlToInline(task.operonId)!;
  const parsed = parseTaskLine(line, 0, 'Inbox.md', settings.keyMappings)!;
  assert.equal(parsed.fields.find(field => field.key === 'fileTaskDisplayTitle')?.value, title);
  let draft: ReturnType<typeof buildMergedFileTaskDraft> | undefined;
  const host = new ConversionHost();
  Object.assign(host, { settings,
   indexer: { reindexFilesBatch: async () => {}, hasDuplicateOperonIdConflict: () => false, getTask: () => null },
   persistTaskEditorDeleteOpenSources: async () => true,
   readAgentRuntimeMutationSource: async () => ({ content: line }), findInlineTaskLineIndex: () => 0,
   parseInlineTaskLine: (text: string, number: number, path: string) => parseTaskLine(text, number, path, settings.keyMappings),
   loadFileTaskTemplateDocumentFromOption: async () => ({}),
   buildParsedTaskFieldValues: (value: NonNullable<ReturnType<typeof parseTaskLine>>) => Object.fromEntries(value.fields.map(field => [field.key, field.value])),
   buildLinkedFileTaskSeed: async (_path: string, fieldValues: Record<string, string>, fieldPresence: Set<string>) => ({ fieldValues, fieldPresence }),
   applyPipelineMinimalFileTaskTemplateStatus: () => true, resolveLoadedFileTaskTemplateDocument: () => null,
   buildOperonTemplatePlaceholderContext: () => ({}),
   buildFileTaskDraft: (source: Parameters<typeof buildMergedFileTaskDraft>[0]['source']) => (draft = buildMergedFileTaskDraft({ source, defaults: { operonId: task.operonId, datetimeModified: now }, keyMappings: settings.keyMappings, bodyStrategy: 'use-template' })),
   validateDependencyDraftOrShow: () => false,
   showUiConversionResult: (result: unknown) => { throw new Error(JSON.stringify(result)); },
  });
  await host.finishInlineTaskToFileTaskConversionInSource({ path: 'Inbox.md' }, parsed, {});
  assert.ok(draft); assert.equal(parseYaml(splitFrontmatterDocument(draft.content).frontmatter!).title, title);
 }
});
