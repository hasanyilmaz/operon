import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';
const root = path.resolve(import.meta.dirname, '..');
const directory = await mkdtemp(path.join(tmpdir(), 'operon-mini-notes-'));
after(() => rm(directory, { recursive: true, force: true }));
const main = readFileSync(path.join(root, 'main.ts'), 'utf8');
const mainAst = ts.createSourceFile('main.ts', main, ts.ScriptTarget.Latest, true);
const method = mainAst.statements.filter(ts.isClassDeclaration).flatMap(node => [...node.members])
 .find(member => member.name?.getText(mainAst) === 'openMiniCalendarNote').getText(mainAst);
const settingsSource = ts.createSourceFile('settings.ts', readFileSync(path.join(root, 'src/ui/settings-tab.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
const settingsClass = settingsSource.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'OperonSettingsTab');
const settingsMethods = ['isCalendarSidebarDefaultStateSettingKey', 'getDefaultSettingsSearchValue', 'getSettingsSearchDropdownOptions', 'buildCalendarSettingsItems', 'setControlValue'].map(name => settingsClass.members.find(member => member.name?.getText(settingsSource) === name).getText(settingsSource)).join('\n');
await build({
 stdin: { contents: `
 import { TFile, Platform, Notice } from './scripts/test-support/obsidian';
 import { resolveFileLightboxOpening } from './src/ui/file-lightbox-opening';
 const t = (section, key) => key;
 const isTaskCardSetting = () => false;
 const readTaskEditorMarkdown = async (app, file) => file.content;
 const scanFileWithMappings = async (app, file) => ({ yamlTask: file.yamlTask });
 const openFileLightboxAsync = async (...args) => globalThis.__miniLightboxOpen(...args);
 export class Subject { ${method} }
 export class SettingsSubject { ${settingsMethods} }
 export { OPERON_SETTINGS_SEARCH_REGISTRY } from './src/ui/settings/settings-search-registry';
 export { t } from './src/core/i18n';
 export { TFile, Platform, Notice, moment } from './scripts/test-support/obsidian';
 export { miniCalendarWeek, MiniCalendarNoteOpener } from './src/ui/calendar/mini-calendar-notes';
 export { SettingsPreservationHarness } from './scripts/test-support/settings-preservation-harness';
 export { buildOperonSettingsBackupSelectedPatchV1 } from './src/core/settings-backup-apply';
 export { migrateSettings, DEFAULT_SETTINGS } from './src/types/settings';
 `, resolveDir: root, loader: 'ts' },
 outfile: path.join(directory, 'subject.mjs'), bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
 alias: { obsidian: path.join(root, 'scripts/test-support/obsidian.ts') },
});
const { Subject, SettingsSubject, OPERON_SETTINGS_SEARCH_REGISTRY, t: translate, TFile, Platform, Notice, moment, miniCalendarWeek, MiniCalendarNoteOpener, SettingsPreservationHarness,
 buildOperonSettingsBackupSelectedPatchV1, migrateSettings, DEFAULT_SETTINGS } = await import(pathToFileURL(path.join(directory, 'subject.mjs')).href);
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function anchor() { return { isConnected: true, ownerDocument: { defaultView: { closed: false } } }; }

function fixture(kind, task, mode, mobile = false) {
 Platform.isDesktopApp = !mobile;
 const file = new TFile(`${kind}/Note.md`); file.content = 'Existing content'; file.yamlTask = task ? { operonId: 'file-id' } : null;
 const events = []; const subject = new Subject();
 subject.settings = { miniCalendarClickAction: mode, keyMappings: [] };
 subject.app = { vault: { getAbstractFileByPath: () => file }, workspace: { getLeaf: () => ({ openFile: async candidate => events.push(['native', candidate]) }) } };
 subject.resolveOrCreatePeriodicNoteResult = async (requestedKind, date, prepared, canCommit) => {
  events.push(['resolve', requestedKind, date, canCommit()]); return { file, wasCreated: true, noticeShown: false };
 };
 subject.indexer = { getLiveReadAuthoritySnapshot: () => ({ state: 'verified' }), reindexFilePath: async () => { events.push(['indexed']); } };
 subject.getMarkdownViewsForPath = () => [];
 subject.getQuickSwitcherFileTaskId = () => task ? 'file-id' : null;
 subject.isExcalidrawTaskSource = () => false;
 subject.openEditorForId = async (id, showSource, el, canOpen) => { if (canOpen()) events.push(['task', id, showSource]); };
 globalThis.__miniLightboxOpen = async (app, el, target, canOpen, properties) => { if (canOpen()) events.push([properties ? 'properties' : 'source', properties?.showSource]); };
 const request = { kind, dateKey: '2026-11-13', anchor: anchor(), isCurrent: () => true };
 return { subject, request, file, events };
}
for (const kind of ['daily', 'weekly']) for (const task of [false, true]) for (const mode of ['source', 'source-and-editor', 'editor']) {
 test(`${kind} ${task ? 'File Task' : 'normal note'} opens ${mode}`, async () => {
  const f = fixture(kind, task, mode); await f.subject.openMiniCalendarNote(f.request);
  assert.equal(f.events[0][0], 'resolve');
  if (mode === 'source') assert.deepEqual(f.events.at(-1), ['source', undefined]);
  else if (task) assert.deepEqual(f.events.at(-1), ['task', 'file-id', mode === 'source-and-editor']);
  else assert.deepEqual(f.events.at(-1), ['properties', mode === 'source-and-editor']);
  assert.equal(f.file.content, 'Existing content');
 });
 test(`${kind} ${task ? 'task' : 'note'} ${mode} opens native on mobile`, async () => {
  const f = fixture(kind, task, mode, true); await f.subject.openMiniCalendarNote(f.request);
  assert.equal(f.events.at(-1)[0], 'native'); assert.equal(f.events.some(e => e[0] === 'indexed'), false);
 });
}
for (const kind of ['daily', 'weekly']) for (const task of [false, true]) {
 test(`new ${kind} ${task ? 'File Task' : 'note'} opens its editor without a notice while creation indexing settles`, async () => {
  const f = fixture(kind, task, 'source-and-editor'), gate = deferred(), notices = [];
  let settling = true;
  f.subject.indexer.getLiveReadAuthoritySnapshot = () => ({ state: settling ? 'settling' : 'verified' });
  f.subject.indexer.awaitRamSettlement = async () => { await gate.promise; settling = false; };
  f.subject.getQuickSwitcherFileTaskId = () => settling ? undefined : task ? 'file-id' : null;
  Notice.onNotice = message => notices.push(message);
  try {
   const opening = f.subject.openMiniCalendarNote(f.request);
   await tick();
   assert.deepEqual(f.events.map(event => event[0]), ['resolve', 'indexed']);
   gate.resolve();
   await opening;
   assert.deepEqual(f.events.at(-1), task ? ['task', 'file-id', true] : ['properties', true]);
   assert.deepEqual(notices, []);
  } finally { gate.resolve(); Notice.onNotice = null; }
 });
}
test('new task waits for indexing; source identity prevents stale or excluded tasks becoming Properties', async () => {
 const f = fixture('daily', true, 'editor'); const gate = deferred(); let indexed = false;
 f.subject.indexer.reindexFilePath = async () => { await gate.promise; indexed = true; };
 f.subject.getQuickSwitcherFileTaskId = () => indexed ? 'file-id' : null;
 const opening = f.subject.openMiniCalendarNote(f.request); await tick(); assert.equal(f.events.length, 1);
 gate.resolve(); await opening; assert.equal(f.events.at(-1)[0], 'task');
 for (const identity of [undefined, null, 'other-id']) {
  const g = fixture('weekly', true, 'editor'); g.subject.getQuickSwitcherFileTaskId = () => identity;
  await g.subject.openMiniCalendarNote(g.request); assert.equal(g.events.at(-1)[0], 'source');
 }
});
test('late indexing, closed views and moved files cannot open an obsolete result', async () => {
 const f = fixture('daily', true, 'editor'); const gate = deferred(); let current = true;
 f.request.isCurrent = () => current;
 f.subject.indexer.reindexFilePath = async () => gate.promise;
 const opening = f.subject.openMiniCalendarNote(f.request); await tick(); current = false; gate.resolve(); await opening;
 assert.equal(f.events.length, 1);
 const g = fixture('daily', false, 'source'); g.subject.app.vault.getAbstractFileByPath = () => null;
 await g.subject.openMiniCalendarNote(g.request); assert.equal(g.events.length, 1);
});
test('unavailable resolver does not open or duplicate its error notification', async () => {
 const f = fixture('weekly', false, 'editor');
 f.subject.resolveOrCreatePeriodicNoteResult = async () => ({ file: null, noticeShown: true });
 const before = Notice.messages?.length;
 await f.subject.openMiniCalendarNote(f.request); assert.deepEqual(f.events, []);
 assert.equal(Notice.messages?.length, before);
});
test('note opener coalesces repeats, serializes creation and retains a successful opening guard', async () => {
 const gate = deferred(), requests = [], errors = [];
 const opener = new MiniCalendarNoteOpener(async request => { requests.push(request); await gate.promise; }, error => errors.push(error));
 const el = anchor(); opener.request('daily', '2026-11-13', el); opener.request('daily', '2026-11-13', el);
 assert.equal(requests.length, 1); gate.resolve(); await tick(); assert.equal(requests[0].isCurrent(), true);
 opener.request('daily', '2026-11-13', el); await tick(); assert.equal(requests.length, 2); assert.deepEqual(errors, []);
 opener.invalidate(); assert.equal(requests[1].isCurrent(), false);
});
test('only the newest queued request runs; closing or migration invalidates work without deleting created notes', async () => {
 const gate = deferred(), requests = [], created = [];
 const opener = new MiniCalendarNoteOpener(async request => { requests.push(request); created.push(request.dateKey); await gate.promise; }, () => {});
 const el = anchor(); opener.request('daily', '2026-11-13', el);
 opener.request('daily', '2026-11-14', el); opener.request('weekly', '2026-11-16', el);
 assert.equal(requests[0].isCurrent(), false); gate.resolve(); await tick();
 assert.deepEqual(created, ['2026-11-13', '2026-11-16']);
 el.ownerDocument = { defaultView: {} }; assert.equal(requests[1].isCurrent(), false);
 opener.invalidate(); assert.equal(created.length, 2);
});
test('ISO, local and custom formats label the exact Monday, including week-year boundaries', () => {
 moment.locale('en');
 assert.equal(miniCalendarWeek('2025-12-29', 'GGGG-[W]WW').label, '1');
 assert.match(miniCalendarWeek('2025-12-29', 'GGGG-[W]WW').description, /2026-W01/);
 assert.equal(miniCalendarWeek('2026-12-28', 'GGGG-[W]WW').label, '53');
 assert.equal(miniCalendarWeek('2026-12-28', 'gggg-[W]ww').label, moment('2026-12-28').format('w'));
 assert.match(miniCalendarWeek('2026-12-28', 'YYYY-MM-DD').description, /2026-12-28/);
 assert.equal(miniCalendarWeek('2026-12-28', '[ww] YYYY-MM-DD').label, '53');
});
test('optional setting round trips, preserves other data, reloads absence and survives failed saves', async () => {
 const f = new SettingsPreservationHarness();
 try {
  const storage = f.createStorage(); await storage.initialize();
  const read = async () => JSON.parse(await f.adapter.read(f.canonicalPath));
  const initial = await read(), attempts = f.canonicalAttempts;
  const restarted = f.createStorage(); await restarted.initialize();
  assert.equal(f.canonicalAttempts, attempts); assert.equal(storage.getSettings().miniCalendarClickAction, undefined);
  assert.equal(Object.hasOwn(initial.settings, 'miniCalendarClickAction'), false);
  for (const value of ['source', 'source-and-editor', 'editor']) {
   await storage.saveMiniCalendarClickAction(value); const saved = await read();
   assert.equal(saved.settings.miniCalendarClickAction, value);
   const unchanged = structuredClone(saved); delete unchanged.settings.miniCalendarClickAction;
   assert.deepEqual(unchanged, initial);
   await restarted.reloadCanonicalSettingsPackage(); assert.equal(restarted.getSettings().miniCalendarClickAction, value);
   assert.equal(buildOperonSettingsBackupSelectedPatchV1({ selectedGroups: ['general'], candidateSettings: restarted.getSettings() }).miniCalendarClickAction, value);
  }
  f.writeFault = 'throw-before';
  await assert.rejects(storage.saveMiniCalendarClickAction('source'));
  assert.equal(storage.getSettings().miniCalendarClickAction, 'editor'); assert.equal((await read()).settings.miniCalendarClickAction, 'editor');
  f.writeFault = 'none'; const missing = await read(); delete missing.settings.miniCalendarClickAction;
  f.seed(f.canonicalPath, JSON.stringify(missing)); await restarted.reloadCanonicalSettingsPackage();
  assert.equal(restarted.getSettings().miniCalendarClickAction, undefined);
  assert.equal(Object.hasOwn(buildOperonSettingsBackupSelectedPatchV1({ selectedGroups: ['general'], candidateSettings: restarted.getSettings() }), 'miniCalendarClickAction'), false);
  assert.equal(migrateSettings({ ...DEFAULT_SETTINGS, miniCalendarClickAction: 'invalid' }).miniCalendarClickAction, undefined);
 } finally { await f.dispose(); }
});


test('Settings Search exposes the Mini Calendar group, default, and three editor-aware options', () => {
 const ui = new SettingsSubject();
 const entry = OPERON_SETTINGS_SEARCH_REGISTRY.find(entry => entry.key === 'miniCalendarClickAction');
 assert.equal(entry.tabId, 'viewsCalendar'); assert.equal(entry.control, 'dropdown');
 ui.buildTaskSettingsGroups = sections => sections;
 const groups = ui.buildCalendarSettingsItems([entry]);
 assert.deepEqual(groups.find(group => group[0] === 'miniCalendarTitle')[1], ['miniCalendarViewMode', 'miniCalendarClickAction']);
 assert.equal(ui.getDefaultSettingsSearchValue('miniCalendarClickAction'), 'source-and-editor');
 const choices = ui.getSettingsSearchDropdownOptions('miniCalendarClickAction');
 assert.deepEqual(Object.keys(choices), ['source', 'source-and-editor', 'editor']);
 assert.equal(translate('settings', choices.editor), 'Task / Property Editor Only');
 assert.equal(translate('settings', choices['source-and-editor']), 'Source File + Task / Property Editor');
});
test('declarative setting writes use the storage transaction and refresh controls even on failure', async () => {
 const ui = new SettingsSubject(), calls = [];
 ui.storage = { saveMiniCalendarClickAction: async value => calls.push(value) };
 ui.notifySettingsChanged = () => calls.push('changed'); ui.updateNativeSettingsDefinitions = () => calls.push('refresh');
 await ui.setControlValue('miniCalendarClickAction', 'editor');
 assert.deepEqual(calls, ['editor', 'changed', 'refresh']); calls.length = 0;
 ui.storage.saveMiniCalendarClickAction = async () => { throw new Error('write failed'); };
 await assert.rejects(ui.setControlValue('miniCalendarClickAction', 'source'));
 assert.deepEqual(calls, ['refresh']);
});


test('a ready editor retains its source-toggle guard after a rejected replacement, but pending opens cancel', async () => {
 for (const mode of ['source', 'source-and-editor', 'editor']) {
  const f = fixture('daily', true, mode); let current = true, guard;
  f.request.isCurrent = () => current;
  f.subject.openEditorForId = async (id, source, anchor, canOpen) => { guard = canOpen; };
  globalThis.__miniLightboxOpen = async (app, anchor, target, canOpen) => { guard = canOpen; };
  await f.subject.openMiniCalendarNote(f.request);
  // B requests replacement, but the native close coordinator retains A's draft.
  current = false; assert.equal(guard(), true);
  f.subject.app.vault.getAbstractFileByPath = () => null; assert.equal(guard(), false);
 }
 const f = fixture('daily', true, 'editor'); let current = true, guard; const gate = deferred();
 f.request.isCurrent = () => current;
 f.subject.openEditorForId = async (id, source, anchor, canOpen) => { guard = canOpen; await gate.promise; };
 const pending = f.subject.openMiniCalendarNote(f.request); await tick();
 current = false; gate.resolve(); await pending; assert.equal(guard(), false);
});

test('view mode defaults stay in memory; mode and click behavior save independently and roll back failures', async () => {
 const f = new SettingsPreservationHarness();
 try {
  const storage = f.createStorage(); await storage.initialize();
  const read = async () => JSON.parse(await f.adapter.read(f.canonicalPath));
  const initial = await read(), attempts = f.canonicalAttempts;
  const restarted = f.createStorage(); await restarted.initialize();
  assert.equal(f.canonicalAttempts, attempts);
  assert.equal(Object.hasOwn(initial.settings, 'miniCalendarViewMode'), false);
  assert.equal(migrateSettings({ ...DEFAULT_SETTINGS, miniCalendarViewMode: 'invalid' }).miniCalendarViewMode, undefined);
  await assert.rejects(storage.saveMiniCalendarViewMode('invalid'));
  assert.equal(f.canonicalAttempts, attempts);
  await Promise.all([storage.saveMiniCalendarViewMode('month'), storage.saveMiniCalendarClickAction('editor')]);
  const saved = await read();
  assert.equal(saved.settings.miniCalendarViewMode, 'month'); assert.equal(saved.settings.miniCalendarClickAction, 'editor');
  const unchanged = structuredClone(saved); delete unchanged.settings.miniCalendarViewMode; delete unchanged.settings.miniCalendarClickAction;
  assert.deepEqual(unchanged, initial);
  await restarted.reloadCanonicalSettingsPackage(); assert.equal(restarted.getSettings().miniCalendarViewMode, 'month');
  f.writeFault = 'throw-before'; await assert.rejects(storage.saveMiniCalendarViewMode('continuous'));
  assert.equal(storage.getSettings().miniCalendarViewMode, 'month'); assert.equal((await read()).settings.miniCalendarViewMode, 'month');
  f.writeFault = 'none'; await storage.saveMiniCalendarViewMode('continuous');
  assert.equal((await read()).settings.miniCalendarViewMode, 'continuous');
  const missing = await read(); delete missing.settings.miniCalendarViewMode;
  f.seed(f.canonicalPath, JSON.stringify(missing)); await restarted.reloadCanonicalSettingsPackage();
  assert.equal(restarted.getSettings().miniCalendarViewMode, undefined);
 } finally { await f.dispose(); }
});
test('view mode Settings Search shares the default, options and failure-safe storage route', async () => {
 const ui = new SettingsSubject();
 assert.equal(ui.getDefaultSettingsSearchValue('miniCalendarViewMode'), 'continuous');
 assert.deepEqual(Object.keys(ui.getSettingsSearchDropdownOptions('miniCalendarViewMode')), ['continuous', 'month']);
 assert.equal(OPERON_SETTINGS_SEARCH_REGISTRY.find(entry => entry.key === 'miniCalendarViewMode').control, 'dropdown');
 const calls = [];
 ui.storage = { saveMiniCalendarViewMode: async value => { calls.push(value); throw new Error('save failed'); } };
 ui.notifySettingsChanged = () => calls.push('refresh'); ui.updateNativeSettingsDefinitions = () => calls.push('definitions');
 await assert.rejects(ui.setControlValue('miniCalendarViewMode', 'month'));
 assert.deepEqual(calls, ['month', 'definitions']);
});
