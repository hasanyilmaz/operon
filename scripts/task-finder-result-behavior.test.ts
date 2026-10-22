import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { TFile } from 'obsidian';
import { DEFAULT_SETTINGS, migrateSettings, normalizeTaskFinderResultBehavior } from '../src/types/settings';
import { buildOperonDataPackageFromSettings, composeOperonSettingsFromDataPackage } from '../src/storage/operon-data-package';
import { TaskUiPreferenceStore } from '../src/storage/task-ui-preference-store';
import { WriteQueue } from '../src/storage/write-queue';
import { OPERON_SETTINGS_SEARCH_REGISTRY } from '../src/ui/settings/settings-search-registry';
import { assertSettingsBackupCompatibilityRegistryExhaustive, getSettingsBackupCompatibilityForKey } from '../src/core/settings-backup-compatibility';
import { exportOperonSettingsBackupJsonV1 } from '../src/core/settings-backup-export';
import { parseOperonSettingsBackupV1 } from '../src/core/settings-backup-format';
import { withSettingsFixture } from './test-support/settings-preservation-harness';

const behaviors = ['source', 'source-and-editor', 'editor'] as const;
const keys = ['taskFinderFileResultBehavior', 'taskFinderInlineResultBehavior'] as const;
function methods(file: string, names: string[], deps: Record<string, unknown> = {}) {
 const source = readFileSync(file, 'utf8'), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
 const klass = ast.statements.find(n => ts.isClassDeclaration(n) && names.every(name => n.members.some(m => m.name?.getText(ast) === name))) as ts.ClassDeclaration;
 assert.ok(klass, file);
 const selected = names.map(name => klass.members.find(m => m.name?.getText(ast) === name)!.getText(ast)).join('\n');
 const code = ts.transpileModule(`class Fixture { ${selected} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
 return new Function(...Object.keys(deps), `${code}; return Fixture;`)(...Object.values(deps));
}
const task = (format: 'yaml' | 'inline') => ({ operonId: 'task001', primary: { filePath: 'Source.md', lineNumber: 17, format } });
for (const format of ['yaml', 'inline'] as const) for (const behavior of behaviors) test(`${format} Finder result routes ${behavior} without changing global editor preferences`, async () => {
 const Host = methods('main.ts', ['openTaskFinderResult'], { Platform: { isDesktopApp: true } });
 const host = new Host(), calls: unknown[] = [];
 Object.assign(host, { settings: { ...DEFAULT_SETTINGS, taskEditorFileShowSource: false, taskEditorInlineShowSource: true,
  [format === 'yaml' ? keys[0] : keys[1]]: behavior }, indexer: { getTask: () => task(format) },
  openEditorForId: (...args: unknown[]) => calls.push(['editor', ...args]), openTaskSourcePreview: async (...args: unknown[]) => { calls.push(['source', ...args]); } });
 const before = JSON.stringify(host.settings);
 await host.openTaskFinderResult('task001');
 assert.deepEqual(calls, [behavior === 'source' ? ['source', 'task001'] : ['editor', 'task001', behavior === 'source-and-editor']]);
 assert.equal(JSON.stringify(host.settings), before);
});
for (const desktop of [false, true]) test(`missing task and non-desktop routing preserve existing boundaries: desktop=${desktop}`, async () => {
 let selected: unknown = null; const calls: unknown[] = [];
 const Host = methods('main.ts', ['openTaskFinderResult'], { Platform: { isDesktopApp: desktop } });
 const host = Object.assign(new Host(), { settings: { ...DEFAULT_SETTINGS, taskFinderFileResultBehavior: 'source' }, indexer: { getTask: () => selected },
  openEditorForId: (...args: unknown[]) => calls.push(args), openTaskSourcePreview: () => { throw Error('unexpected source'); } });
 await host.openTaskFinderResult('task001'); assert.deepEqual(calls, []);
 if (!desktop) { selected = task('yaml'); await host.openTaskFinderResult('task001'); assert.deepEqual(calls, [['task001']]); }
});
for (const format of ['yaml', 'inline'] as const) for (const side of ['left', 'right'] as const) for (const showSource of [true, false, undefined]) test(`native opening uses Finder override with ${format}/${side}/source=${showSource}`, async () => {
 const file = Object.assign(Object.create(TFile.prototype), { path: 'Source.md', extension: 'md' });
 const document = { body: { closest: () => null } }, indexed = task(format), opens: any[] = [];
 const Host = methods('main.ts', ['openTaskEditorFor'], { Platform: { isDesktopApp: true }, LIGHTBOX_PERF_ENABLED: false, TFile,
  getActiveDocument: () => document, asHTMLElement: () => null, getActiveLightboxShell: () => null,
  resolveInlineTaskDescriptionCursorCh: () => 8, openTaskWorkspace: async (...args: unknown[]) => { opens.push(args); return {}; } });
 const host = Object.assign(new Host(), { settings: { ...DEFAULT_SETTINGS, taskEditorPosition: side,
  taskEditorFileShowSource: !showSource, taskEditorInlineShowSource: !showSource }, taskEditorOpeningRequests: new WeakMap(),
  indexer: { getTask: () => indexed }, app: { vault: { getAbstractFileByPath: () => file } }, isExcalidrawTaskSource: () => false,
  createTaskEditorContentFor: async () => ({ destroy() {} }), readTaskEditorSource: async () => ({ file, format, lineNumber: 17, parsed: {} }) });
 await host.openTaskEditorFor(indexed, () => {}, {}, undefined, undefined, false, showSource);
 assert.equal(opens.length, 1); assert.equal(opens[0][3].markdown, showSource ?? true); assert.equal(opens[0][3].position, side);
 assert.equal(opens[0][2].operonId, 'task001');
 if (format === 'inline') assert.deepEqual([opens[0][2].line, opens[0][2].caretCh], [17, 8]);
});
test('editor-ID entry forwards only the explicit opening override and preserves duplicate guard/save callback', async () => {
 let duplicate = false; const calls: any[] = [], saved: any[] = [];
 const Host = methods('main.ts', ['openEditorForId']);
 const host = Object.assign(new Host(), { redirectDuplicateOperonIdAction: () => duplicate, indexer: { getTask: () => task('inline') },
  loadEditableParsedTask: (t: unknown) => t, openTaskEditorFor: async (...args: unknown[]) => { calls.push(args); },
  applyEditedTaskFromView: async (...args: unknown[]) => { saved.push(args); return true; } });
 host.openEditorForId('task001', false); await Promise.resolve(); assert.equal(calls[0][6], false);
 assert.equal(await calls[0][1]('request'), true); assert.deepEqual(saved, [[task('inline'), 'request']]);
 duplicate = true; host.openEditorForId('task001', true); await Promise.resolve(); assert.equal(calls.length, 1);
});
test('source-only reuses the normal source resolver and an owning lightbox anchor', async () => {
 const anchor = {}, document = { body: {}, activeElement: null }, selected = task('inline'); let opening: any;
 const Host = methods('main.ts', ['openTaskSourcePreview'], { Platform: { isDesktopApp: true }, getActiveDocument: () => document,
  asHTMLElement: () => null, getActiveLightboxShell: () => anchor,
  resolveChipOpening: (entry: any, context: any) => ({ entry, current: context.getTask(), settings: context.getSettings() }),
  activateResolvedOpening: async (...args: unknown[]) => { opening = args; } });
 const host = Object.assign(new Host(), { settings: DEFAULT_SETTINGS, indexer: { getTask: () => selected, getAllTasks: () => [selected] }, app: {} });
 await host.openTaskSourcePreview('task001'); assert.equal(opening[0], anchor);
 assert.deepEqual(opening[1].resolve(), { entry: { key: 'taskInfo.source' }, current: selected, settings: DEFAULT_SETTINGS });
 const explicitAnchor = {}; await host.openTaskSourcePreview('task001', explicitAnchor); assert.equal(opening[0], explicitAnchor);
});
for (const fileBehavior of behaviors) for (const inlineBehavior of behaviors) test(`settings package/store/backup preserve independent ${fileBehavior}/${inlineBehavior} choices`, async () => {
 const settings = migrateSettings({ ...DEFAULT_SETTINGS, taskFinderFileResultBehavior: fileBehavior, taskFinderInlineResultBehavior: inlineBehavior });
 const pkg = buildOperonDataPackageFromSettings(settings), before = JSON.stringify(pkg);
 const restored = composeOperonSettingsFromDataPackage(pkg, DEFAULT_SETTINGS);
 let writes = 0; const store = new TaskUiPreferenceStore({} as never, new WriteQueue(), DEFAULT_SETTINGS);
 store.setPackagePersistence(async () => { writes++; }); store.loadFromPackage(pkg.ui.taskUiPreferences);
 for (const [key, value] of [[keys[0], fileBehavior], [keys[1], inlineBehavior]] as const) {
  assert.equal(restored[key], value); assert.equal(store.getAll()[key], value); assert.equal((pkg.settings as any)[key], undefined);
  assert.ok(getSettingsBackupCompatibilityForKey(key));
 }
 assert.equal(writes, 0); assert.equal(JSON.stringify(pkg), before);
 const exported = await exportOperonSettingsBackupJsonV1({ settings, source: { pluginVersion: '4.1.0', obsidianVersion: '1.13.0', dataPackageSchemaVersion: 2 }, createdAt: '2026-10-22T12:00:00.000Z' });
 assert.equal(exported.ok, true); if (!exported.ok) return;
 assert.equal(parseOperonSettingsBackupV1(exported.json).ok, true);
 for (const key of keys) assert.ok(exported.json.includes(`"${key}"`));
});
test('missing/malformed preferences use approved defaults and reading a legacy package does not backfill', () => {
 for (const value of [undefined, null, false, 12, '', 'invalid', {}, []]) {
  const normalized = migrateSettings({ taskFinderFileResultBehavior: value, taskFinderInlineResultBehavior: value });
  assert.deepEqual(keys.map(key => normalized[key]), ['source-and-editor', 'editor']);
 }
 const pkg = buildOperonDataPackageFromSettings(DEFAULT_SETTINGS), before = JSON.stringify(pkg);
 for (const key of keys) assert.equal(Object.prototype.hasOwnProperty.call(pkg.ui.taskUiPreferences, key), false);
 const restored = composeOperonSettingsFromDataPackage(pkg, { ...DEFAULT_SETTINGS, taskEditorFileShowSource: false, taskEditorInlineShowSource: true });
 assert.deepEqual(keys.map(key => restored[key]), ['source-and-editor', 'editor']); assert.equal(JSON.stringify(pkg), before);
 assertSettingsBackupCompatibilityRegistryExhaustive(DEFAULT_SETTINGS);
});
test('actual storage save and second startup keep explicit result preferences without startup writes', async () => {
 await withSettingsFixture({}, async fixture => {
  const storage = fixture.createStorage(); await storage.initialize(); const before = fixture.raw();
  assert.deepEqual(keys.map(key => storage.getSettings()[key]), ['source-and-editor', 'editor']); assert.equal(fixture.raw(), before);
  Object.assign(storage.getSettings(), { taskFinderFileResultBehavior: 'editor', taskFinderInlineResultBehavior: 'source' });
  await storage.saveSettings();
  assert.equal(fixture.package().ui.taskUiPreferences.taskFinderFileResultBehavior, 'editor');
  assert.equal(fixture.package().ui.taskUiPreferences.taskFinderInlineResultBehavior, 'source');
  const committed = fixture.raw(), next = fixture.createStorage(); await next.initialize();
  assert.deepEqual(keys.map(key => next.getSettings()[key]), ['editor', 'source']); assert.equal(fixture.raw(), committed);
 });
});
test('native Settings and fallback expose the same localized options and valid defaults', () => {
 const Host = methods('src/ui/settings-tab.ts', ['buildTaskFinderSettingsItems', 'renderInterfaceTaskFinderTab', 'getSettingsSearchDropdownOptions', 'normalizeSettingsSearchDropdownValue'], {
  t: (_namespace: string, key: string) => key, DEFAULT_SETTINGS, normalizeTaskFinderResultBehavior, isTaskCardSetting: () => false,
  TASK_FINDER_DEFAULT_SCOPE_ORDER: [],
  renderNativeSettingsGroupedSection: (_el: unknown, heading: string) => ({ heading, createEl() {} }),
 });
 const calls: any[] = [], host = Object.assign(new Host(), { settings: DEFAULT_SETTINGS,
  buildSettingsSearchSettingDefinition: (_entries: unknown, key: string) => ({ key }), compactSettingsSearchDefinitions: (items: any[]) => items,
  isCalendarSidebarDefaultStateSettingKey: () => false, renderTaskFinderBehaviorSettingsSection() {}, renderTaskFinderShortcutSettings() {}, renderBoundDropdownSetting: (...args: unknown[]) => calls.push(args),
 });
 const entries = OPERON_SETTINGS_SEARCH_REGISTRY.filter(e => e.tabId === 'interfaceTaskFinder');
 const page = host.buildTaskFinderSettingsItems(entries), group = page.find((g: any) => g.heading === 'taskFinderResultBehaviorSection');
 assert.deepEqual(group.items.slice(1).map((i: any) => i.key), keys);
 host.renderInterfaceTaskFinderTab({}); assert.equal(calls.length, 2);
 for (const [i, key] of keys.entries()) {
  assert.equal(entries.find(e => e.key === key)?.control, 'dropdown'); assert.equal(calls[i][3], key);
  assert.deepEqual(Object.keys(host.getSettingsSearchDropdownOptions(key)), behaviors);
  assert.equal(calls[i][4].value, DEFAULT_SETTINGS[key]); assert.equal(calls[i][4].normalize('wrong'), DEFAULT_SETTINGS[key]);
 }
});
test('click and Enter invoke the same callback; project selection stays inside Finder', () => {
 const Host = methods('src/ui/task-finder-modal.ts', ['handleKeydown', 'handleResultClick', 'chooseResult']);
 const calls: unknown[] = [], selected = task('inline'), host = Object.assign(new Host(), { currentResults: [{ kind: 'task', task: selected }], activeIndex: 0,
  flushSearchRender() {}, close() { calls.push('close'); }, onOpenTask: (...args: unknown[]) => calls.push(args), renderImmediately() {}, focusInput() {}, inputEl: { value: 'query' } });
 host.handleKeydown({ key: 'Enter', preventDefault() {} }); host.handleResultClick({ preventDefault() {} }, host.currentResults[0]);
 assert.deepEqual(calls, ['close', ['task001', selected], 'close', ['task001', selected]]);
 calls.length = 0; host.chooseResult({ kind: 'project', candidate: { task: selected } }); assert.equal(host.selectedProject, selected); assert.deepEqual(calls, []);
});
test('selection integrations retain caller-supplied callbacks rather than the normal result-opening settings', () => {
 const source = readFileSync('main.ts', 'utf8');
 for (const name of ['openTaskWikilinkOverlayFinder']) {
  const Host = methods('main.ts', [name], { openTaskFinder: (...args: any[]) => { assert.notEqual(args[3], undefined); }, Notice: class {} });
  assert.ok(Host.prototype[name]);
 }
 const integrations = readFileSync('src/ui/task-finder-integrations.ts', 'utf8');
 assert.equal(integrations.includes('taskFinderFileResultBehavior'), false); assert.equal(integrations.includes('taskFinderInlineResultBehavior'), false);
 assert.equal(source.match(/this\.openTaskFinderResult\(operonId\)/g)?.length, 1);
});
