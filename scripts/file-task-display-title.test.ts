import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import ts from 'typescript';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { Notice, TFile, type App } from 'obsidian';
import { activeWindow } from './test-support/obsidian';
import { getTaskDisplayTitle } from '../src/core/task-display-title';
import { isWritableRawYamlPropertyName } from '../src/core/raw-yaml-property';
import { applyYamlTaskFieldValues } from '../src/core/task-writer-yaml';
import { TaskWriter, type TaskWriterIndexerPort } from '../src/core/task-writer';
import { buildMergedFileTaskDraft, parseFrontmatterDocument, splitFrontmatterDocument } from '../src/core/file-task-template-merge';
import { resolveFileTaskDefaults } from '../src/core/file-task-defaults';
import { exportOperonSettingsBackupJsonV1 } from '../src/core/settings-backup-export';
import { parseOperonSettingsBackupV1 } from '../src/core/settings-backup-format';
import { validateOperonSettingsBackupGroupsV1 } from '../src/core/settings-backup-group-validation';
import {
	DEFAULT_FILENAME_RULE, deriveTaskFilename, filenameSuggestionAfterTitleEdit, normalizeFilenameRule,
	sanitizeTaskFilename, validateFilenameRule, type FilenameRule,
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

const customRule = (pattern: string, replacement = ''): FilenameRule => ({ preset: 'custom', lowercase: false, rules: [{ pattern, replacement }] });
test('filename presets preserve Unicode and custom rules apply in order', () => {
	for (const [title, preset, expected] of [
		['Quarterly: Review!', 'same', 'Quarterly Review!'], ['Quarterly: Review!', 'kebab', 'quarterly-review'],
		['Quarterly: Review!', 'snake', 'quarterly_review'], ['日本語 計画 １２３', 'kebab', '日本語-計画-１２３'],
		['خطة العمل ١٢٣', 'snake', 'خطة_العمل_١٢٣'],
	] as const) assert.equal(deriveTaskFilename(title, { preset, lowercase: preset === 'same', rules: [] }), expected);
	assert.equal(deriveTaskFilename('Alpha Beta', customRule('(\\w+) (\\w+)', '$2-$1')), 'Beta-Alpha');
	assert.equal(deriveTaskFilename('AB item', { preset: 'custom', lowercase: true, rules: [
		{ pattern: 'a', replacement: 'b' }, { pattern: 'b', replacement: 'c' }, { pattern: '\\s+', replacement: '_' },
	] }), 'cc_item');
	assert.equal(sanitizeTaskFilename(' A:B/C\\D*E?F"G<H>I|J \n K '), 'ABCDEFGHIJ K');
});

test('custom filename rules reject unsupported syntax and enforce execution limits', () => {
	for (const pattern of ['[', '(a)\\1', '(?=a)']) assert.throws(() => validateFilenameRule(customRule(pattern)), /invalid|unsupported/i);
	for (const rule of [
		{ ...customRule('a'), rules: Array.from({ length: 17 }, () => ({ pattern: 'a', replacement: '' })) },
		customRule('a'.repeat(257)), customRule('a', 'b'.repeat(257)),
	]) assert.throws(() => validateFilenameRule(rule), /safety limits/i);
	assert.throws(() => deriveTaskFilename('a'.repeat(1025), customRule('a')), /safety limits/i);
	assert.throws(() => deriveTaskFilename('a'.repeat(1024), customRule('a', 'bb')), /safety limits/i);
	assert.equal(deriveTaskFilename('a'.repeat(1024), customRule('a', 'b')), 'b'.repeat(1024));
});

test('Ask alone suggests a changed filename and retains a fallback for invalid rules', async () => {
	for (const [title, basename, mode, expected] of [
		['New task', 'old-name', 'keep', null], ['New task', 'old-name', 'auto', null],
		['New task', 'old-name', 'ask', { filename: 'new-task' }], ['New task', 'new-task', 'ask', null],
		['  \t ', 'old-name', 'ask', null],
	] as const) assert.deepEqual(await filenameSuggestionAfterTitleEdit(title, basename, mode, DEFAULT_FILENAME_RULE), expected);
	assert.deepEqual(await filenameSuggestionAfterTitleEdit(' Name ', 'old', 'ask', customRule('^\\s+', 'unsaved-')), { filename: 'Name' });
	const empty = await filenameSuggestionAfterTitleEdit('!!!', 'current-name', 'ask', DEFAULT_FILENAME_RULE);
	assert.equal(empty?.filename, 'current-name');
	assert.match(empty?.error ?? '', /empty filename.*current-name/i);
	const invalid = await filenameSuggestionAfterTitleEdit('Bad [ pattern', 'old', 'ask', customRule('['));
	assert.equal(invalid?.filename, 'Bad [ pattern');
	assert.ok(invalid?.error);
});

test('filename rule settings normalize and survive a backup round trip', () => {
	assert.deepEqual(normalizeFilenameRule({
		preset: 'snake', lowercase: false,
		rules: [{ pattern: 'a', replacement: 'b' }, { pattern: 3, replacement: 'c' }, null],
	}), { preset: 'snake', lowercase: false, rules: [{ pattern: 'a', replacement: 'b' }] });
	assert.deepEqual(normalizeFilenameRule({ preset: 'unknown', lowercase: 'false', rules: 'invalid' }), { preset: 'kebab', lowercase: false, rules: [] });
	const rule = customRule('\\s+', '_');
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
	const settings = migrateSettings({ ...DEFAULT_SETTINGS, fileTaskDisplayTitleEnabled: true, fileTaskDisplayTitleChangeMode: 'ask' });
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
	return { app, file: currentFile, settings, state, main, indexer, notices, destinations, occupied,
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
		assert.equal(f.notices.length, 1);
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

test('settings reject invalid regex drafts before persistence and retain draft errors across edits', async () => {
 const inputs: Array<{ change: (value: string) => Promise<void> }> = [];
 let message = '', saves = 0;
 const preview = { setAttribute() {}, setText(value: string) { message = value; }, addClass() {}, removeClass() {} };
 class SettingsElement {
  value = '';
  disabled = false;
  createDiv(): SettingsElement { return new SettingsElement(); }
  createSpan(): void {}
  createEl(): SettingsElement { return new SettingsElement(); }
  addEventListener(event: string, handler: () => Promise<void>): void {
   if (event === 'input') inputs.push({ change: async value => { this.value = value; await handler(); } });
  }
 }
 const Settings = methods('src/ui/settings-tab.ts', ['renderFileTaskDisplaySettings'], {
  t, deriveTaskFilename, validateFilenameRule,
  setIcon() {}, setTooltip() {},
  settingsAsyncHandler: (_label: string, action: unknown) => action,
  Setting: class {
   settingEl = preview;
   setName() { return this; } setDesc(value: string) { message = value; return this; }
   addDropdown(build: (control: object) => void) {
    const control = { addOptions() { return control; }, setValue() { return control; }, onChange() { return control; } };
    build(control); return this;
   }
   addText(build: (control: object) => void) {
    const entry = { change: async (_value: string) => {} };
    const control = { setValue() { return control; }, setPlaceholder() { return control; },
     onChange(change: typeof entry.change) { entry.change = change; return control; } };
    inputs.push(entry); build(control); return this;
   }
   addToggle() { return this; } addExtraButton() { return this; } addButton() { return this; }
  },
 });
 const renderer = new Settings();
 Object.assign(renderer, {
  settings: { ...DEFAULT_SETTINGS, fileTaskDisplayTitleEnabled: true,
   fileTaskDisplayTitleChangeMode: 'ask',
   fileTaskFilenameRule: { preset: 'custom', lowercase: false, rules: [{ pattern: '\\s+', replacement: '-' }] } },
  app: { workspace: { getActiveFile: () => null } },
  saveSettings: async () => { saves++; }, redisplayPreservingScroll() {},
 });
 renderer.renderFileTaskDisplaySettings(new SettingsElement(), 'fileTaskFilenameRule');
 await inputs[1].change('[');
 assert.equal(saves, 0); assert.equal(renderer.settings.fileTaskFilenameRule.rules[0].pattern, '\\s+');
 assert.ok(message.startsWith(t('settings', 'fileTaskFilenameRuleInvalid', { error: '' })));
 await inputs[2].change('_');
 assert.equal(saves, 0, 'another input must not accidentally persist the rejected pattern');
 await inputs[1].change('(a)\\1');
 assert.equal(saves, 0); assert.ok(message.startsWith(t('settings', 'fileTaskFilenameRuleInvalid', { error: '' })));
 await inputs[1].change('\\s+');
 assert.equal(saves, 1); assert.equal(renderer.settings.fileTaskFilenameRule.rules[0].replacement, '_');
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
