import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { build } from 'esbuild';

const root = process.cwd();
const source = await readFile(path.join(root, 'main.ts'), 'utf8');
const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
const plugin = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'OperonPlugin');
function member(name) {
 const node = plugin.members.find(item => item.name?.getText(ast) === name);
 assert.ok(node, name);
 return node.getText(ast);
}
const members = ['ribbonActionsReady', 'localePackManager', 'onload', 'prepareRibbonIcons', 'initializeCachedLanguage'];
const temporary = await mkdtemp(path.join(tmpdir(), 'operon-ribbon-startup-'));
let createStartupClass;
try {
 const result = await build({
  stdin: { contents: `
   import { isSupportedLanguage, migrateLegacyLanguageSettings } from './src/types/settings';
   import { isUnrecognizableCanonicalDataPackage } from './src/storage/operon-data-package-store';
   import { isRecord } from './src/core/unknown-value';
   import { resetI18nToEnglish, removeI18nLocale, installI18nLocale, initI18n, t } from './src/core/i18n';
   import { runAsyncAction } from './src/core/async-action';
   export function createStartupClass(dependencies) {
    removeI18nLocale('ru'); resetI18nToEnglish();
    const { LocalePackManager, registerObsidianIconFallbacks, getAppLocale, console } = dependencies;
    const OPERON_AGENT_RUNTIME_PROBE_ENABLED = false, OPERON_AGENT_RUNTIME_PERSISTENT_READ_ENABLED = false;
    return class { ${members.map(member).join('\n')} };
   }`, resolveDir: root, loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', target: 'node18', logLevel: 'silent',
  alias: { obsidian: path.join(root, 'scripts/test-support/obsidian-native-yaml.ts') },
 });
 const file = path.join(temporary, 'production.mjs');
 await writeFile(file, result.outputFiles[0].text);
 ({ createStartupClass } = await import(pathToFileURL(file).href));
} finally { await rm(temporary, { recursive: true, force: true }); }
const english = JSON.parse(await readFile(path.join(root, 'i18n/locales/en.json'), 'utf8'));
const russian = JSON.parse(await readFile(path.join(root, 'i18n/locales/ru.json'), 'utf8'));
const actions = [
 ['list-plus', 'openTaskCreator'], ['funnel-plus', 'openFilterView'], ['scan-search', 'openTaskFinder'],
 ['calendar', 'openCalendar'], ['square-kanban', 'openKanban'], ['table-2', 'openOperonTable'], ['pin', 'openPinnedTasks'],
];
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

// Model the public registration/lifecycle boundary: restoring a layout applies
// saved visibility to existing ribbon IDs; a newly registered ID starts visible.
function ribbon() {
 const items = new Map();
 return {
  items,
  add(icon, title, callback) {
   const id = `operon:${title}`;
   items.set(id, { ...items.get(id), hidden: items.get(id)?.hidden ?? false, icon, title, callback });
  },
  restore(hiddenItems) { for (const [id, item] of items) item.hidden = hiddenItems[id] ?? false; },
  save() { return Object.fromEntries([...items].map(([id, item]) => [id, item.hidden])); },
 };
}
function fixture({ raw = { schemaVersion: 2, settings: { language: 'ru' } }, locale = 'en', cached = true, read, cacheGate, sharedRibbon = ribbon() } = {}) {
 const calls = [], warnings = [], background = deferred();
 let phase = 'starting';
 const Startup = createStartupClass({
  console: { warn: (...args) => warnings.push(args) },
  getAppLocale: app => app.locale,
  registerObsidianIconFallbacks: () => calls.push('icons'),
  LocalePackManager: class {
   async initialize() { calls.push('locale-manifest'); }
   async loadCachedLocale(language) {
    calls.push(`cache:${language}`);
    if (cacheGate) await cacheGate.promise;
    return cached ? { translations: russian } : null;
   }
  },
 });
 const host = new Startup();
 Object.assign(host, {
  app: { locale, vault: { adapter: {}, configDir: '.config' } }, manifest: { id: 'operon' },
  settings: { leftRailDefaultFilterViewId: 'chosen-filter' },
  agentRuntimeLifecycle: { getPhase: () => phase, recordError: error => calls.push(error) },
  initializeAgentRuntime() { calls.push('runtime'); },
  registerAgentRuntimeCliTransport() { calls.push('transport'); },
  async loadData() { calls.push('read-settings'); return read ? read() : raw; },
  async loadPlugin() { calls.push('background'); await background.promise; },
  addRibbonIcon: (...args) => sharedRibbon.add(...args),
  openTaskCreator() { calls.push('creator'); }, openTaskFinderModal() { calls.push('finder'); },
  async openFilterViewById(id) { calls.push(`filter:${id}`); },
  async openCalendarView() { calls.push('calendar'); }, async openKanbanView() { calls.push('kanban'); },
  async openOperonTable() { calls.push('table'); }, async openPinnedTasksSurface() { calls.push('pinned'); },
 });
 return { host, calls, warnings, ribbon: sharedRibbon, background, unload() { phase = 'unloading'; host.ribbonActionsReady = false; } };
}
function hiddenExceptKanban(strings) {
 return Object.fromEntries(actions.map(([, key]) => [`operon:${strings.commands[key]}`, key !== 'openKanban']));
}

for (const [language, strings] of [['en', english], ['ru', russian]]) {
 test(`${language}: full startup restores six hidden buttons before returning onload`, async () => {
  let saved = hiddenExceptKanban(strings);
  for (let restart = 0; restart < 2; restart++) {
   const f = fixture({ raw: { schemaVersion: 2, settings: { language } } });
   await f.host.onload(); // Heavy startup deliberately never resolves.
   assert.deepEqual(f.calls.slice(0, 3), ['runtime', 'transport', 'read-settings']);
   assert.equal(f.calls.at(-1), 'background');
   assert.equal(f.ribbon.items.size, 7);
   assert.deepEqual([...f.ribbon.items.values()].map(item => item.icon), actions.map(([icon]) => icon));
   f.ribbon.restore(saved);
   assert.deepEqual(f.ribbon.save(), saved);
   assert.equal([...f.ribbon.items.values()].filter(item => !item.hidden).length, 1);
   saved = f.ribbon.save();
  }
 });
}
test('onload waits for cached Russian labels, not storage, index, layout or downloads', async () => {
 const gate = deferred(), f = fixture({ cacheGate: gate });
 let finished = false;
 const loading = f.host.onload().then(() => { finished = true; });
 await new Promise(resolve => setImmediate(resolve));
 assert.equal(finished, false);
 assert.equal(f.ribbon.items.size, 0);
 assert.equal(f.calls.includes('background'), false);
 gate.resolve(); await loading;
 assert.equal(finished, true);
 assert.equal(f.ribbon.items.size, 7);
 assert.ok(f.calls.includes('cache:ru'));
});
test('early clicks cannot invoke uninitialized services; all seven existing actions remain', async () => {
 const f = fixture(); await f.host.onload();
 const before = [...f.calls];
 for (const item of f.ribbon.items.values()) item.callback();
 assert.deepEqual(f.calls, before);
 f.host.ribbonActionsReady = true;
 for (const item of f.ribbon.items.values()) item.callback();
 assert.deepEqual(f.calls.slice(before.length), ['creator', 'filter:chosen-filter', 'finder', 'calendar', 'kanban', 'table', 'pinned']);
 f.unload();
 const after = [...f.calls];
 for (const item of f.ribbon.items.values()) item.callback();
 assert.deepEqual(f.calls, after);
});
test('same-session plugin reload preserves existing hidden IDs without duplicating buttons', async () => {
 const sharedRibbon = ribbon(), saved = hiddenExceptKanban(russian);
 const first = fixture({ sharedRibbon }); await first.host.onload(); sharedRibbon.restore(saved); first.unload();
 const second = fixture({ sharedRibbon }); await second.host.onload();
 assert.deepEqual(sharedRibbon.save(), saved); assert.equal(sharedRibbon.items.size, 7);
});
for (const raw of [null, {}, { settings: {} }, { schemaVersion: 999, settings: { language: 'ru' } }, { settings: { language: 'invalid' } }]) {
 test(`invalid or absent package uses the existing English fallback: ${JSON.stringify(raw)}`, async () => {
  const f = fixture({ raw }); await f.host.onload();
  assert.deepEqual([...f.ribbon.items.keys()], Object.keys(hiddenExceptKanban(english)));
 });
}
test('legacy auto language follows the existing language migration without writing settings', async () => {
 const raw = { settings: { language: 'auto' } }, before = structuredClone(raw);
 const f = fixture({ raw, locale: 'ru-RU' }); await f.host.onload();
 assert.deepEqual([...f.ribbon.items.keys()], Object.keys(hiddenExceptKanban(russian)));
 assert.deepEqual(raw, before);
});
test('missing or invalid cached pack uses English labels without downloading', async () => {
 const f = fixture({ cached: false }); await f.host.onload();
 assert.deepEqual([...f.ribbon.items.keys()], Object.keys(hiddenExceptKanban(english)));
});
test('settings read error falls back without preventing ordinary storage startup', async () => {
 const f = fixture({ read: () => { throw new Error('unreadable'); } }); await f.host.onload();
 assert.equal(f.warnings.length, 1); assert.ok(f.calls.includes('background'));
 assert.deepEqual([...f.ribbon.items.keys()], Object.keys(hiddenExceptKanban(english)));
});
for (const boundary of ['settings', 'locale']) {
 test(`unload during ${boundary} read does not register buttons or continue startup`, async () => {
  const gate = deferred();
  const f = fixture(boundary === 'settings' ? { read: () => gate.promise } : { cacheGate: gate });
  const loading = f.host.onload(); await new Promise(resolve => setImmediate(resolve));
  f.unload(); gate.resolve({ settings: { language: 'ru' } }); await loading;
  assert.equal(f.ribbon.items.size, 0); assert.equal(f.calls.includes('background'), false);
 });
}
test('layout maintenance enables existing actions but never registers or rewrites ribbon state', () => {
 const loadPlugin = member('loadPlugin'), unload = member('onunload');
 assert.ok(loadPlugin.includes("this.ribbonActionsReady = this.agentRuntimeLifecycle.getPhase() !== 'unloading';"));
 assert.equal(loadPlugin.includes('addRibbonIcon'), false);
 assert.ok(unload.indexOf('this.ribbonActionsReady = false') > unload.indexOf('beginUnloading()'));
 const prepare = member('prepareRibbonIcons');
 assert.doesNotMatch(prepare, /saveData|storage\.initialize|workspace|ensureLocale/);
});
