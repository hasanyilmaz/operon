import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const ts: typeof import('typescript') = createRequire(path.join(process.cwd(), 'package.json'))('typescript');
import { App, TFile, Setting } from 'obsidian';
import { fixture, wiredFixture, DiskAdapter } from './tasks-conversion-service.test';
import { parseTaskLine } from '../src/core/parser';
import { TasksConversionController, tasksConversionCounts } from '../src/ui/tasks-conversion-controller';
import { TasksConversionSettings } from '../src/ui/tasks-conversion-settings';
import { createTasksConversionReferenceInventory, tasksConversionCanvasReferences, tasksConversionCardReferences, tasksConversionTableReferences } from '../src/systems/tasks-conversion-references';
import { createExcalidrawMarkdownSource, withExcalidrawMarkdownSources } from '../src/ui/excalidraw-markdown-source';
import { OPERON_SETTINGS_SEARCH_REGISTRY } from '../src/ui/settings/settings-search-registry';

function controller(f = fixture(), settle: (paths: readonly string[]) => Promise<void> = async () => {}) {
 return { f, c: new TasksConversionController({ service: f.service, available: () => true, coordinate: (_paths, _ids, operation) => operation(), settle }) };
}
test('UI scope starts empty with subfolders on; dedupe and scope changes invalidate preview', async () => {
 const { c } = controller(); assert.deepEqual(c.scope, { files: [], folders: [], includeSubfolders: true });
 await c.initialize(); c.updateScope({ files: ['A.md', 'A.md'], folders: [], includeSubfolders: false });
 await c.scan(); assert.equal(c.preview?.selectedKeys.length, 1);
 const id = c.preview!.rows[0].operonId;
 c.select([]); c.select([c.preview!.rows[0].key]); assert.equal(c.preview!.rows[0].operonId, id);
 c.updateScope({ files: ['B.md'], folders: [], includeSubfolders: true }); assert.equal(c.preview, null);
});
test('UI applies exact preview and automatically completes, reporting only selected tasks', async () => {
 const { f, c } = controller(); await c.initialize(); c.updateScope(f.scope); await c.scan();
 c.select([c.preview!.rows[0].key]); const preview = c.preview!;
 await c.apply(); assert.equal(c.result?.status, 'committed'); assert.equal(c.blocked, false);
 assert.equal(c.counts.converted, 1); assert.equal(c.counts.skipped, 1);
 for (const change of preview.changes) assert.equal(await f.adapter.read(change.path), change.after);
 c.reset(); assert.equal(c.result, null);
});
test('changed source rejects apply without settling or altering unrelated user task', async () => {
 let settlements = 0; const { f, c } = controller(fixture(), async () => { settlements++; });
 await c.initialize(); c.updateScope(f.scope); await c.scan();
 const saved = '- [ ] User {{operonId:: user001}}'; f.adapter.files.set('A.md', saved);
 await c.apply(); assert.equal(c.result?.status, 'not-applied'); assert.equal(settlements, 0);
 assert.equal(c.counts.converted, 0); assert.equal(await f.adapter.read('A.md'), saved);
 assert.deepEqual(f.adapter.writes, []);
});
test('double apply invokes service once while transaction is busy', async () => {
 const { f, c } = controller(); await c.initialize(); c.updateScope(f.scope); await c.scan();
 const apply = c.apply(); await c.apply(); await apply;
 assert.equal(f.adapter.writes.filter(name => name.endsWith('.md')).length, 2);
});
test('index failure exposes retry; read-only retry never calls apply again', async () => {
 let fails = true; const { f, c } = controller(fixture(), async () => { if (fails) throw new Error('Index failed'); });
 await c.initialize(); c.updateScope(f.scope); await c.scan(); await c.apply();
 assert.equal(c.result?.sourcesCommitted, true); assert.equal(c.settlementPending.length, 2);
 const writes = f.adapter.writes.length; fails = false; await c.retrySettlement();
 assert.equal(c.settlementPending.length, 0); assert.equal(f.adapter.writes.length, writes);
});
test('inspection failure after commit still settles and blocks new work until read-only retry', async () => {
 let calls = 0, settlements = 0; const f = fixture(); const inspect = f.service.inspect.bind(f.service);
 f.service.inspect = async () => { if (++calls === 2) throw new Error('Read failed'); return inspect(); };
 const { c } = controller(f, async () => { settlements++; }); await c.initialize(); c.updateScope(f.scope); await c.scan(); await c.apply();
 assert.equal(c.result?.sourcesCommitted, true); assert.equal(settlements, 1); assert.equal(c.inspection, null);
 assert.equal(c.blocked, true); assert.equal(c.counts.converted, 2);
 await c.initialize(); assert.equal(c.blocked, false);
});
test('cleanup retry preserves successful in-session counts after active copy is removed', async () => {
 const { f, c } = controller(); await c.initialize(); c.updateScope(f.scope); await c.scan();
 f.adapter.beforeRemove = name => { if (name.endsWith('/resolved.json')) throw new Error('Remove failed'); };
 await c.apply(); assert.equal(c.result?.status, 'cleanup-pending'); assert.equal(c.counts.converted, 2);
 f.adapter.beforeRemove = undefined; await c.resolve('cleanup'); assert.equal(c.blocked, false); assert.equal(c.counts.converted, 2);
 const absent = tasksConversionCounts({ status: 'kept', taskCount: 0, paths: [] }, null, { state: { kind: 'empty' }, files: [], canKeep: false, canUndo: false, canRestore: false });
 assert.equal(absent.available, false);
});
test('new runs clear old progress before inspecting or applying', async () => {
 const { c } = controller(); c.progress = { completedFiles: 10, totalFiles: 10, path: 'old.md' };
 const observed: unknown[] = []; c.subscribe(() => { if (c.busy) observed.push(c.progress); });
 await c.initialize(); assert.equal(observed[0], null);
});
test('controller cancellation during apply verifies rollback rather than claiming converted count', async () => {
 const { f, c } = controller(); await c.initialize(); c.updateScope(f.scope); await c.scan();
 c.subscribe(() => { if (c.phase === 'apply' && c.progress?.completedFiles === 1) c.cancel(); });
 await c.apply(); assert.equal(c.result?.status, 'rolled-back'); assert.equal(c.counts.converted, 0);
 assert.equal((await f.store.load()).kind, 'empty');
});
test('disposed controller prevents further writes, scan and selection', async () => {
 const { f, c } = controller(); await c.initialize(); c.updateScope(f.scope); c.dispose(); await c.scan(); await c.apply();
 assert.deepEqual(f.adapter.writes, []); assert.equal(c.preview, null);
});
test('reference collectors parse real task cards and Canvas markers without touching arbitrary IDs or nested examples', () => {
 const card = '```operon\nview: card\ntaskId: task001\n```';
 assert.deepEqual(tasksConversionCardReferences(card), ['task001']);
 assert.deepEqual(tasksConversionCardReferences('````example\n'+card+'\n````'), []);
 assert.deepEqual(tasksConversionCanvasReferences(JSON.stringify({ nodes: [
  { type: 'text', id: 'random1', text: 'taskId: ignore1' },
  { type: 'text', id: 'random2', operonTask: { version: 1, taskId: 'task002' }, text: card },
 ] })), ['task002', 'task001']);
 assert.throws(() => tasksConversionCanvasReferences(JSON.stringify({ nodes: [{ type: 'text', operonTask: { version: 2, taskId: 'task001' } }] })));
});
test('reference inventory is read-only, detects pending sources and includes workflow identities', async () => {
 const files = [new (TFile as unknown as new (name: string) => TFile)('Ref.canvas')];
 let content = JSON.stringify({ nodes: [{ type: 'text', operonTask: { version: 1, taskId: 'task001' } }] });
 let clean = true, revision = 0;
 const app = { vault: { getFiles: () => files, getAbstractFileByPath: () => files[0], read: async () => content } } as unknown as App;
 const inventory = createTasksConversionReferenceInventory(app, {
  workflow: () => { const current = revision; return { externalReferences: ['pin0001'], reservedSeriesIds: ['rs00001'], isCurrent: () => revision === current }; },
  nativeSnapshot: () => ({ references: ['draw001'], isCurrent: () => true }), matches: () => clean, projectTable: (_path, preset) => preset,
 });
 const before = content, first = await inventory(); assert.equal(content, before);
 assert.deepEqual(first.externalReferences, ['pin0001', 'draw001', 'task001']); assert.deepEqual(first.unavailablePaths, []);
 revision++; assert.equal(first.isCurrent(), false);
 clean = false; assert.deepEqual((await inventory()).unavailablePaths, ['Ref.canvas']);
 content = '{invalid'; clean = true; assert.deepEqual((await inventory()).unavailablePaths, ['Ref.canvas']);
});
test('Table references include explicit parent and expanded tasks only', () => {
 const preset = { expandedTaskTreeIds: ['task001'], search: { parent: { parentId: 'task002' } } } as never;
 assert.deepEqual(tasksConversionTableReferences(preset), ['task001', 'task002']);
});
test('Settings entry is searchable render action without a persisted settings key', () => {
 const entry = OPERON_SETTINGS_SEARCH_REGISTRY.find(entry => entry.id === 'automation.tasksEmojiBulkConversion');
 assert.equal(entry?.tabId, 'tasksInlineTasks'); assert.equal(entry?.control, 'render'); assert.equal(entry?.key, undefined);
 assert.ok(entry?.aliases?.includes('tasks emoji'));
});

class TestElement {
 parentElement: TestElement | null = null;
 tagName: string; children: TestElement[] = []; dataset: Record<string, string> = {}; textContent = ''; disabled = false;
 checked = false; open = false; scrollTop = 0; scrollLeft = 0; offsetHeight = 0; scrollHeight = 0; clientHeight = 0; focusVisible = true; cssProps: Record<string, string> = {}; attrs: Record<string, string> = {}; listeners = new Map<string, Array<() => void>>();
 constructor(tag: string, readonly ownerDocument: { activeElement: TestElement | null }) { this.tagName = tag.toUpperCase(); }
 createEl(tag: string, options: any = {}): any {
  const child = new TestElement(tag, this.ownerDocument); child.textContent = options.text ?? '';
  for (const [key, value] of Object.entries(options.attr ?? {})) child.setAttribute(key, String(value));
  child.parentElement = this; this.children.push(child); return child;
 }
 createSpan(options: any): any { return this.createEl('span', options); }
 createDiv(options: any = {}): any { return this.createEl('div', options); }
 matches(selector: string): boolean { return selector === ':focus-visible' && this.focusVisible; }
 setCssProps(props: Record<string, string>): void { Object.assign(this.cssProps, props); }
 setText(text: string): void { this.textContent = text; }
 setAttribute(key: string, value: string): void { this.attrs[key] = value; if (key === 'data-focus-key') this.dataset.focusKey = value; }
 addClass(): void {} removeClass(): void {} addEventListener(key: string, fn: () => void): void { this.listeners.set(key, [...(this.listeners.get(key) ?? []), fn]); }
 contains(el: unknown): boolean { return el === this || this.children.some(child => child.contains(el)); }
 empty(): void { this.children = []; }
 querySelectorAll(): any[] { return this.children.flatMap(child => [child, ...child.querySelectorAll()]).filter(child => child.dataset.focusKey); }
 focus(): void { if (!this.disabled) this.ownerDocument.activeElement = this; }
 fire(key: string): void { for (const fn of this.listeners.get(key) ?? []) fn(); }
 get allText(): string { return [this.textContent, ...this.children.map(child => child.allText)].join(' '); }
}
function settingsFixture(c: TasksConversionController, app = new App()) {
 const doc = { activeElement: null as TestElement | null }, root = new TestElement('div', doc);
 const view = new TasksConversionSettings(app, root as unknown as HTMLElement, c);
 return { view, root, doc, button: (key: string) => root.querySelectorAll().find(el => el.dataset.focusKey === key) as TestElement };
}
test('Settings keeps keyboard focus through scan, inline confirmation and result', async () => {
 const { f, c } = controller(); await c.initialize(); c.updateScope(f.scope);
 const { root, doc, button } = settingsFixture(c);
 button('Scan').focus(); const scan = c.scan(); assert.equal(doc.activeElement?.dataset.focusKey, 'Cancel'); await scan;
 assert.equal(c.preview?.selectedKeys.length, 2);
 button('Apply').focus(); button('Apply').fire('click'); await Promise.resolve();
 assert.equal(doc.activeElement?.dataset.focusKey, 'Dismiss'); assert.ok(button('ConfirmApply'));
 assert.deepEqual(f.adapter.writes, []);
 button('ConfirmApply').focus(); const apply = c.confirm(c.preview!); assert.equal(doc.activeElement?.dataset.focusKey, 'Cancel'); await apply;
 assert.equal(doc.activeElement?.dataset.focusKey, 'Scan'); assert.ok(root.allText.includes('Converted: 2'));
 assert.equal(root.allText.includes('Undo'), false); assert.equal(root.allText.includes('Keep result'), false);
});
test('Settings shows a count instead of source previews or task selection', async () => {
 const f = fixture({ 'A.md': '- [ ] <img onerror="alert(1)"> 📅 2026-10-10\n- [ ] Plain\n```md\n- [ ] Hidden 📅 2026-10-10\n```' }), { c } = controller(f);
 await c.initialize(); c.updateScope(f.scope); await c.scan(); const { root, button } = settingsFixture(c);
 assert.ok(root.allText.includes('1 convertible tasks found in 1 files.'));
 assert.equal(root.allText.includes('<img'), false); assert.equal(root.allText.includes('Full file preview'), false);
 assert.equal(button('SelectAll'), undefined); assert.equal(button('SelectNone'), undefined);
 assert.equal(button('issues'), undefined); assert.equal(root.querySelectorAll().filter(el => el.tagName === 'INPUT').length, 1);
});
test('closing a Settings view dismisses only pending confirmation and keeps the controller available', async () => {
 const { f, c } = controller(); await c.initialize(); c.updateScope(f.scope); await c.scan();
 const { view } = settingsFixture(c); c.requestConfirmation(c.preview!); view.dispose();
 assert.equal(c.available, true); assert.equal(c.confirmation, null); assert.deepEqual(f.adapter.writes, []);
 const reopened = settingsFixture(c); assert.ok(reopened.button('Apply')); assert.equal(reopened.button('ConfirmApply'), undefined);
});

test('inline confirmation cancel and changed scope cannot apply a stale preview', async () => {
 const { f, c } = controller(); await c.initialize(); c.updateScope(f.scope); await c.scan(); const preview = c.preview!;
 c.requestConfirmation(preview); c.dismissConfirmation(); await c.confirm(preview); assert.deepEqual(f.adapter.writes, []);
 c.requestConfirmation(preview); c.updateScope({ files: ['A.md'], folders: [], includeSubfolders: false });
 assert.equal(c.confirmation, null); assert.equal(c.preview, null); await c.confirm(preview); assert.deepEqual(f.adapter.writes, []);
 await c.scan(); c.requestConfirmation(c.preview!); await c.confirm(preview); assert.deepEqual(f.adapter.writes, []);
});
test('multiple Settings views cannot duplicate a confirmed apply or steal each other’s focus', async () => {
 const { f, c } = controller(); await c.initialize(); c.updateScope(f.scope); await c.scan();
 const doc = { activeElement: null as TestElement | null }, roots = [new TestElement('div', doc), new TestElement('div', doc)];
 const views = roots.map(root => new TasksConversionSettings(f.app, root as unknown as HTMLElement, c));
 roots[0].querySelectorAll().find(el => el.dataset.focusKey === 'Apply')!.focus();
 const preview = c.preview!; c.requestConfirmation(preview);
 assert.equal(roots[0].contains(doc.activeElement), true); assert.equal(roots[1].contains(doc.activeElement), false);
 const first = c.confirm(preview); await c.confirm(preview); await first;
 assert.equal(f.adapter.writes.filter(name => name.endsWith('.md')).length, 2);
 assert.ok(roots.every(root => root.allText.includes('Converted: 2'))); for (const view of views) view.dispose();
});
test('Settings closing and remounting keeps an already confirmed operation alive', async () => {
 const { f, c } = controller(); await c.initialize(); c.updateScope(f.scope); await c.scan();
 const { view } = settingsFixture(c), original = f.service.apply.bind(f.service);
 let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
 f.service.apply = async (...args) => { await gate; return original(...args); };
 const preview = c.preview!; c.requestConfirmation(preview); const apply = c.confirm(preview);
 assert.equal(c.busy, true); view.dispose(); assert.equal(c.available, true);
 const reopened = settingsFixture(c); assert.ok(reopened.button('Cancel')); release(); await apply;
 assert.equal(c.result?.status, 'committed'); assert.ok(reopened.root.allText.includes('Converted: 2'));
 for (const change of preview.changes) assert.equal(await f.adapter.read(change.path), change.after);
});
test('Settings warning summary omits protected/plain tasks and exposes only relevant reasons', async () => {
 const { f, c } = controller(fixture({ 'A.md': '- [ ] Normal\n```md\n- [ ] Code 📅 2026-10-10\n```\n- [ ] Hybrid {{operonId:: hybrid1}} 📅 2026-10-10\n- [ ] Repeat 🔁 nonsense 📅 2026-10-10' }));
 await c.initialize(); c.updateScope(f.scope); await c.scan(); const { root, button } = settingsFixture(c);
 assert.ok(button('issues')); assert.ok(root.allText.includes('Unsupported mixed metadata'));
 assert.equal(root.allText.includes('Normal'), false); assert.equal(root.allText.includes('Protected Markdown'), false);
});
test('observer failure cannot interrupt conversion after confirmation', async () => {
 const { c } = controller(); await c.initialize(); c.updateScope({ files: ['A.md'], folders: [], includeSubfolders: false }); await c.scan();
 c.subscribe(() => { throw new Error('Detached UI observer'); }); const preview = c.preview!; c.requestConfirmation(preview); await c.confirm(preview);
 assert.equal(c.result?.status, 'committed');
});

test('production adapter UI flow in synthetic private tmp preserves sealed unrelated content and completes cleanup', async () => {
 const root = await mkdtemp(path.join(process.platform === 'darwin' ? '/private/tmp' : tmpdir(), 'operon-stage3-fixture-')), sealed = await mkdtemp(path.join(process.platform === 'darwin' ? '/private/tmp' : tmpdir(), 'operon-stage3-sealed-'));
 try {
  const adapter = new DiskAdapter(root);
  const notes = { 'A.md': '---\nTitle: synthetic\n---\n- [ ] A 📅 2026-10-10\n', 'Unrelated.md': 'Sealed unrelated content\r\n', 'Ref.canvas': JSON.stringify({ nodes: [{ type: 'text', text: 'not a task' }] }) };
  for (const [file, value] of Object.entries(notes)) { await adapter.write(file, value); await writeFile(path.join(sealed, file), value); }
  adapter.writes = []; const f = wiredFixture(adapter), { c } = controller(f);
  await c.initialize(); c.updateScope({ files: ['A.md'], folders: [], includeSubfolders: true }); await c.scan(); const approved = c.preview!.changes[0].after;
  const mounted = settingsFixture(c), preview = c.preview!;
  c.requestConfirmation(preview); c.dismissConfirmation(); assert.equal(adapter.writes.length, 0);
  const original = f.service.apply.bind(f.service);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  f.service.apply = async (...args) => { await gate; return original(...args); };
  c.requestConfirmation(preview); const applying = c.confirm(preview); mounted.view.dispose();
  const reopened = settingsFixture(c); assert.ok(reopened.button('Cancel')); release(); await applying;
  assert.equal(c.result?.status, 'committed'); assert.equal(await adapter.read('A.md'), approved);
  assert.ok(reopened.root.allText.includes('Converted: 1')); reopened.view.dispose();
  for (const file of ['Unrelated.md', 'Ref.canvas']) assert.equal(await adapter.read(file), await readFile(path.join(sealed, file), 'utf8'));
  assert.ok(adapter.writes.every(file => file === 'A.md' || file.startsWith('.test-config/plugins/operon/state/tasks-conversion/')));
  assert.equal((await f.fresh().inspect()).state.kind, 'empty');
 } finally { await rm(root, { recursive: true, force: true }); await rm(sealed, { recursive: true, force: true }); }
});

async function mainHarness(names: string[]) {
 const source = await readFile(path.join(process.cwd(), 'main.ts'), 'utf8');
 const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
 let cls: import('typescript').ClassDeclaration | undefined;
 ast.forEachChild(node => { if (ts.isClassDeclaration(node)) cls = node; });
 assert.ok(cls);
 const methods = cls!.members.filter(member => ts.isMethodDeclaration(member) && names.includes(member.name.getText(ast)));
 assert.equal(methods.length, names.length);
 const script = ts.transpileModule('class Harness { '+methods.map(method => method.getText(ast)).join('\n')+' }; return Harness;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
 const Harness = new Function('TFile', 'readExcalidrawTaskView', script)(TFile, (_app: unknown, view: unknown) => view);
 const h = new Harness();
 h.tasksConversionOwnedSources = new Map(); h.tasksConversionSettledSources = new Map(); h.tasksConversionNativePaths = new Set(); h.tasksConversionDrawingScenes = new Map();
 return { h, ast, cls: cls! };
}
test('real main normalization guard skips only owned exact contents; external user edits still normalize', async () => {
 const { h } = await mainHarness(['normalizeWorkflowStateAfterRawEdit']);
 const file = new (TFile as unknown as new (name: string) => TFile)('A.md'); let content = 'after', calls = 0;
 h.app = { vault: { getAbstractFileByPath: () => file, read: async () => content } };
 h.workflowNormalizationInProgress = new Set(); h.workflowNormalizationPending = new Set(); h.workflowNormalizationWaiters = new Map(); h.workflowNormalizationRenameTargets = new Map(); h.indexer = { scheduleReindex: () => {} };
 h.normalizeWorkflowStateAfterRawEditPass = async () => { calls++; };
 h.tasksConversionOwnedSources.set('A.md', { before: 'before', after: 'after', written: true });
 await h.normalizeWorkflowStateAfterRawEdit('A.md'); assert.equal(calls, 0);
 content = 'user edited'; await h.normalizeWorkflowStateAfterRawEdit('A.md'); assert.equal(calls, 1);
 h.tasksConversionOwnedSources.clear(); h.tasksConversionSettledSources.set('A.md', 'after'); content = 'after';
 await h.normalizeWorkflowStateAfterRawEdit('A.md'); assert.equal(calls, 1);
 content = 'later user edit'; await h.normalizeWorkflowStateAfterRawEdit('A.md'); assert.equal(calls, 2);
 assert.equal(h.tasksConversionSettledSources.has('A.md'), false);
});
test('real main raw-edit reconciliation does not suppress unrelated changed contents', async () => {
 const { h } = await mainHarness(['reconcileTaskSourceModify']);
 const file = new (TFile as unknown as new (name: string) => TFile)('A.md'); let content = 'after', normalizations = 0;
 const options: unknown[] = []; h.app = { vault: { getAbstractFileByPath: () => file, read: async () => content } };
 h.indexer = { forceReindexFilePathAfterMutation: async (_path: string, opt: unknown) => options.push(opt) };
 h.normalizeWorkflowStateAfterRawEdit = async () => { normalizations++; };
 h.tasksConversionOwnedSources.set('A.md', { before: 'before', after: 'after', written: true });
 await h.reconcileTaskSourceModify('A.md', 'deferred'); assert.deepEqual(options[0], { notify: false }); assert.equal(normalizations, 0);
 content = 'external'; await h.reconcileTaskSourceModify('A.md', 'deferred'); assert.equal(normalizations, 1); assert.equal(options[1], undefined);
});
test('real main native buffer guard rejects dirty scene/header but admits its own synchronization lease', async () => {
 const { h } = await mainHarness(['tasksConversionBuffersMatch', 'tasksConversionSceneSignature', 'captureTasksConversionDrawingScenes']);
 const file = new (TFile as unknown as new (name: string) => TFile)('D.excalidraw.md');
 let elements: unknown[] = [{ id: 'one', type: 'text', text: 'saved' }], saved = elements;
 const view: any = { file, data: 'disk', lastSavedData: 'disk', preparedSaveText: 'disk', isSynchronizing: false,
  saveCoordinator: { isSaveInProgress: false }, excalidrawAPI: { getSceneElements: () => elements },
  plugin: { ea: { getAPI: () => ({ getSceneFromFile: async () => ({ elements: saved }), destroy: () => {} }) } } };
 h.app = { workspace: { getLeavesOfType: (kind: string) => kind === 'excalidraw' ? [{ view }] : [] } }; h.taskEditorDeleteOpenViewsMatch = () => true;
 assert.deepEqual(await h.captureTasksConversionDrawingScenes(), []); assert.equal(h.tasksConversionBuffersMatch(file.path, 'disk'), true);
 view.isSynchronizing = true; assert.equal(h.tasksConversionBuffersMatch(file.path, 'disk'), false);
 h.tasksConversionNativePaths.add(file.path); assert.equal(h.tasksConversionBuffersMatch(file.path, 'disk'), true);
 view.data = 'dirty header'; assert.equal(h.tasksConversionBuffersMatch(file.path, 'disk'), false); view.data = 'disk';
 elements = [{ id: 'one', type: 'text', text: 'unsaved' }];
 assert.deepEqual(await h.captureTasksConversionDrawingScenes(), [file.path]); assert.equal(h.tasksConversionBuffersMatch(file.path, 'disk'), false);
 assert.equal(view.data, 'disk'); assert.equal(view.preparedSaveText, 'disk');
});
test('selected conversion does not read an unrelated open drawing scene', async () => {
 const { h } = await mainHarness(['captureTasksConversionDrawingScenes']);
 const file = new (TFile as unknown as new (name: string) => TFile)('Unrelated.excalidraw.md');
 let reads = 0;
 const view = { file, plugin: { ea: { getAPI: () => { reads++; throw new Error('Unrelated scene'); } } } };
 h.app = { workspace: { getLeavesOfType: () => [{ view }] } };
 assert.deepEqual(await h.captureTasksConversionDrawingScenes(['Selected.md']), []); assert.equal(reads, 0);
});
test('legacy filter fences without task cards never make identity inventory unavailable', () => {
 assert.deepEqual(tasksConversionCardReferences('```operon\nfilter: My tasks\nview: table\n```'), []);
 assert.throws(() => tasksConversionCardReferences('```operon\nview: card\ntaskId: invalid!\n```'));
});

for (const failure of ['settlement', 'inspection'] as const) test(`Settings focuses enabled retry after ${failure} failure`, async () => {
 let inspections = 0; const f = fixture(), inspect = f.service.inspect.bind(f.service);
 f.service.inspect = async () => { if (failure === 'inspection' && ++inspections === 2) throw new Error('Read failed'); return inspect(); };
 const { c } = controller(f, async () => { if (failure === 'settlement') throw new Error('Index failed'); });
 await c.initialize(); c.updateScope(f.scope); await c.scan();
 const { doc, button } = settingsFixture(c);
 button('Apply').focus(); await c.apply();
 assert.equal(doc.activeElement?.disabled, false);
 assert.equal(doc.activeElement?.dataset.focusKey, failure === 'settlement' ? 'RetryRefresh' : 'RetryInspect');
});
test('verified restore with cleanup failure still settles once and never repeats notes on cleanup retry', async () => {
 const f = fixture(), preview = await f.preview(); await f.service.apply(preview);
 let settlements = 0; const { c } = controller(f, async () => { settlements++; }); await c.initialize();
 f.adapter.beforeRemove = file => { if (file.endsWith('/active.json')) throw new Error('Cleanup failed'); };
 await c.resolve('restore'); assert.equal(c.result?.status, 'cleanup-pending'); assert.equal(settlements, 1);
 for (const change of preview.changes) assert.equal(await f.adapter.read(change.path), change.before);
 const writes = f.adapter.writes.length; f.adapter.beforeRemove = undefined; await c.resolve('cleanup');
 assert.equal(f.adapter.writes.length, writes); assert.equal(settlements, 1);
});
test('real main delta guard preserves unrelated checkbox and source edits while suppressing conversion-only progress', async () => {
 const { h } = await mainHarness(['filterTasksConversionIndexedChanges']);
 const file = new (TFile as unknown as new (name: string) => TFile)('A.md'); let content = 'after';
 h.app = { vault: { getAbstractFileByPath: () => file, read: async () => content } };
 h.tasksConversionGeneratedIds = new Set(['new0001']); h.tasksConversionOwnedSources.set(file.path, { before: 'before', after: 'after', written: true });
 const parent: any = { operonId: 'parent1', fieldValues: {}, description: 'Parent', tags: [], checkbox: 'open', primary: { filePath: file.path }, progress: 0 };
 const derived = { before: parent, after: { ...parent, progress: 1 } };
 const child = { before: { ...parent, operonId: 'child01' }, after: { ...parent, operonId: 'child01', checkbox: 'done' } };
 const generated = { before: null, after: { ...parent, operonId: 'new0001' } };
 assert.deepEqual(await h.filterTasksConversionIndexedChanges([derived, child, generated]), [child]);
 content = 'independent user edit'; assert.deepEqual(await h.filterTasksConversionIndexedChanges([derived, child]), [derived, child]);
});
for (const boundary of ['lease', 'read'] as const) test(`native ${boundary} wait cannot adopt a late dirty Markdown buffer`, async () => {
 const file = new (TFile as unknown as new (name: string) => TFile)('D.excalidraw.md');
 const disk = '- [ ] Task 🆔 A\n%%\n# Excalidraw Data\nopaque\n%%';
 let release!: () => void, entered!: () => void, writes = 0;
 const held = new Promise<void>(resolve => { release = resolve; }), waiting = new Promise<void>(resolve => { entered = resolve; });
 const view: any = { file, data: disk, preparedSaveText: disk, lastSavedData: disk, isSynchronizing: false, plugin: {},
  isSameFileEditingActive: () => false, saveCoordinator: { isSaveInProgress: false }, excalidrawAPI: { getAppState: () => ({ viewModeEnabled: false }) },
  acquireSynchronization: async () => { if (boundary === 'lease') { entered(); await held; } view.isSynchronizing = true; return true; },
  withPersistenceWriteLease: async (_path: string, operation: () => Promise<unknown>) => operation() };
 const app = { workspace: { getLeavesOfType: () => [{ view }] }, vault: { getAbstractFileByPath: () => file,
  read: async () => { if (boundary === 'read') { entered(); await held; } return disk; } } } as unknown as App;
 const writer = { hasMarkdownSource: () => false, isMarkdownSourceOwner: () => false, withMarkdownSources: async (_sources: unknown, operation: () => Promise<unknown>) => operation() } as any;
 const operation = withExcalidrawMarkdownSources(app, writer, [file.path], () => true, () => true, async () => { writes++; }, [], (_path, source) => {
  if (view.data !== source || view.preparedSaveText !== source || view.lastSavedData !== source) throw new Error('Unsaved source');
 });
 await waiting; view.data = 'late edit'; view.preparedSaveText = 'late prepared edit'; release();
 await assert.rejects(operation, /Unsaved source/); assert.equal(writes, 0); assert.equal(view.data, 'late edit');
 assert.equal(view.preparedSaveText, 'late prepared edit'); assert.equal(view.isSynchronizing, false);
});

for (const uncertain of [false, true]) test(`native ${uncertain ? 'uncertain' : 'acknowledged'} write preserves late dirty buffers through reconciliation`, async () => {
 const file = new (TFile as unknown as new (name: string) => TFile)('D.excalidraw.md');
 const before = '- [ ] A 🆔 A\n%%\n# Excalidraw Data\nopaque\n%%', after = before.replace('A 🆔 A', 'A {{operonId:: task001}}');
 let disk = before, release!: () => void, entered!: () => void, writes = 0;
 const held = new Promise<void>(resolve => { release = resolve; }), waiting = new Promise<void>(resolve => { entered = resolve; });
 const view: any = { file, data: before, preparedSaveText: before, lastSavedData: before, isSynchronizing: false, plugin: {},
  isSameFileEditingActive: () => false, saveCoordinator: { isSaveInProgress: false }, excalidrawAPI: { getAppState: () => ({ viewModeEnabled: false }) },
  acquireSynchronization: async () => { view.isSynchronizing = true; return true; }, withPersistenceWriteLease: async (_path: string, operation: () => Promise<unknown>) => operation() };
 const app = { workspace: { getLeavesOfType: () => [{ view }] }, vault: { getAbstractFileByPath: () => file, read: async () => disk,
  process: async (_file: unknown, update: (content: string) => string) => { disk = update(disk); writes++; entered(); await held; if (uncertain) throw new Error('Unknown acknowledgement'); return disk; } } } as unknown as App;
 const source = createExcalidrawMarkdownSource(app, view, () => true, { beforeAdopt: (expected, content) => {
  if (![expected, content].includes(view.data) || ![expected, content].includes(view.preparedSaveText)) throw new Error('Unsaved source');
 } });
 const operation = source.runExclusive(async () => { await source.read(); await source.write(before, after); });
 await waiting; view.data = 'late edit'; view.preparedSaveText = 'late prepared edit'; release();
 await assert.rejects(operation); assert.equal(disk, after); assert.equal(writes, 1);
 assert.equal(view.data, 'late edit'); assert.equal(view.preparedSaveText, 'late prepared edit');
 await assert.rejects(view.withPersistenceWriteLease(file.path, async () => { writes++; }));
 assert.equal(writes, 1); assert.equal(view.data, 'late edit'); assert.equal(view.preparedSaveText, 'late prepared edit'); source.dispose();
});

test('retained native recovery adoption guard never leaks synchronization ownership', async () => {
 const { h } = await mainHarness(['assertTasksConversionAdoption']);
 let matches = false, checks = 0;
 h.tasksConversionBuffersMatch = (path: string) => { checks++; assert.equal(h.tasksConversionNativePaths.has(path), true); return matches; };
 assert.throws(() => h.assertTasksConversionAdoption('D.md', 'before', 'after'), /Unsaved source/);
 assert.equal(h.tasksConversionNativePaths.size, 0); assert.equal(checks, 2);
 matches = true; h.assertTasksConversionAdoption('D.md', 'before', 'after'); assert.equal(h.tasksConversionNativePaths.size, 0);
 h.tasksConversionNativePaths.add('D.md'); h.assertTasksConversionAdoption('D.md', 'before', 'after'); assert.equal(h.tasksConversionNativePaths.has('D.md'), true);
});

for (const scenario of ['scan-cancel', 'dirty-buffer', 'changed-source', 'concurrent-write', 'external-reference', 'write-failure', 'reload-recovery', 'marker-failure', 'cleanup-failure'] as const) {
 test(`real adapter UI safety: ${scenario}`, async () => {
  const root = await mkdtemp(path.join(process.platform === 'darwin' ? '/private/tmp' : tmpdir(), 'operon-stage3-boundary-')), sealed = await mkdtemp(path.join(process.platform === 'darwin' ? '/private/tmp' : tmpdir(), 'operon-stage3-preimage-'));
  try {
   const adapter = new DiskAdapter(root), originals = { 'A.md': '- [ ] A 🆔 A\r\n', 'B.md': '- [ ] B ⛔ A\n', 'Unrelated.md': '---\nType: Note\n---\nSealed bytes\r\n' };
   for (const [file, content] of Object.entries(originals)) { await adapter.write(file, content); await writeFile(path.join(sealed, file), content); }
   const f = wiredFixture(adapter), { c } = controller(f); adapter.writes = []; await c.initialize(); c.updateScope(f.scope);
   if (scenario === 'scan-cancel') {
    c.subscribe(() => { if (c.phase === 'scan' && c.progress) c.cancel(); }); await c.scan(); assert.equal(c.preview, null); assert.deepEqual(adapter.writes, []);
   } else {
    await c.scan(); const preview = c.preview!;
    if (scenario === 'dirty-buffer') f.buffers.set('A.md', 'Unsaved user edit');
    if (scenario === 'changed-source') { await adapter.write('A.md', 'Saved user edit'); adapter.writes = []; }
    if (scenario === 'external-reference') { await adapter.write('Outside.md', `- [ ] Outside {{operonId:: other01}} {{blockedBy:: ${preview.operonIds[0]}}}`); adapter.writes = []; }
    if (scenario === 'write-failure' || scenario === 'reload-recovery') adapter.beforeWrite = (file, value) => {
     if (file === 'B.md' || scenario === 'reload-recovery' && file === 'A.md' && value === originals['A.md']) throw new Error('Injected note failure');
    };
    if (scenario === 'marker-failure') adapter.beforeWrite = file => { if (file.endsWith('/resolved.json')) throw new Error('Marker failure'); };
    if (scenario === 'cleanup-failure') adapter.beforeRemove = file => { if (file.endsWith('/resolved.json')) throw new Error('Cleanup failure'); };
    if (scenario === 'concurrent-write') {
     const mutation = f.writer.applyExactMarkdownSourceMutation('A.md', originals['A.md'], 'Concurrent user edit', undefined, undefined, 'plugin');
     await c.apply(); assert.equal((await mutation).outcome, 'committed'); assert.equal(await adapter.read('A.md'), 'Concurrent user edit');
    } else await c.apply();
    if (['dirty-buffer', 'changed-source', 'external-reference', 'concurrent-write'].includes(scenario)) {
     assert.equal(c.result?.status, 'not-applied'); assert.equal(c.counts.converted, 0);
     if (scenario !== 'concurrent-write') assert.deepEqual(adapter.writes, []);
     if (scenario === 'dirty-buffer') assert.equal(f.buffers.get('A.md'), 'Unsaved user edit');
     if (scenario === 'changed-source') assert.equal(await adapter.read('A.md'), 'Saved user edit');
    } else if (scenario === 'write-failure') {
     assert.equal(c.result?.status, 'rolled-back'); assert.equal(c.counts.converted, 0);
     for (const file of ['A.md', 'B.md']) assert.equal(await adapter.read(file), await readFile(path.join(sealed, file), 'utf8'));
    } else {
     assert.equal(c.result?.status, scenario === 'reload-recovery' || scenario === 'marker-failure' ? 'recovery-required' : 'cleanup-pending');
     adapter.beforeWrite = undefined; adapter.beforeRemove = undefined;
     const reloaded = new TasksConversionController({ service: f.fresh(), available: () => true, coordinate: (_paths, _ids, operation) => operation(), settle: async () => {} });
     const writes = adapter.writes.length; await reloaded.initialize(); assert.equal(adapter.writes.length, writes);
     if (scenario === 'reload-recovery') {
      assert.equal(reloaded.inspection?.canRestore, true); await reloaded.resolve('restore'); assert.equal(reloaded.counts.converted, 0);
      for (const file of ['A.md', 'B.md']) assert.equal(await adapter.read(file), await readFile(path.join(sealed, file), 'utf8'));
     } else {
      const noteWrites = adapter.writes.filter(file => file.endsWith('.md')).length;
      await reloaded.resolve(scenario === 'marker-failure' ? 'keep' : 'cleanup');
      assert.equal(adapter.writes.filter(file => file.endsWith('.md')).length, noteWrites);
      for (const change of preview.changes) assert.equal(await adapter.read(change.path), change.after);
     }
     assert.equal(reloaded.blocked, false);
    }
   }
   assert.equal(await adapter.read('Unrelated.md'), await readFile(path.join(sealed, 'Unrelated.md'), 'utf8'));
   assert.ok(adapter.writes.every(file => ['A.md', 'B.md'].includes(file) || file.startsWith('.test-config/plugins/operon/state/tasks-conversion/')));
  } finally { await rm(root, { recursive: true, force: true }); await rm(sealed, { recursive: true, force: true }); }
 });
}

test('known committed marker failure offers only close-record retry and never restore', async () => {
 const { f, c } = controller(); await c.initialize(); c.updateScope(f.scope); await c.scan();
 f.adapter.beforeWrite = file => { if (file.endsWith('/resolved.json')) throw new Error('Close marker failed'); };
 await c.apply(); assert.equal(c.result?.sourcesCommitted, true); assert.equal(c.inspection?.state.kind, 'active');
 const { button } = settingsFixture(c, f.app);
 assert.ok(button('RetryCleanup')); assert.equal(button('Restore'), undefined); assert.equal(button('FinishRecovery'), undefined);
 const writes = f.adapter.writes.filter(file => file.endsWith('.md')).length;
 await c.resolve('restore'); assert.equal(f.adapter.writes.filter(file => file.endsWith('.md')).length, writes);
 await c.resolve('keep'); assert.equal(c.result?.sourcesCommitted, true); assert.ok(button('RetryCleanup')); assert.equal(button('Restore'), undefined);
 await c.resolve('keep'); assert.equal(c.result?.sourcesCommitted, true); assert.ok(button('RetryCleanup')); assert.equal(button('Restore'), undefined);
 f.adapter.beforeWrite = undefined;
 await c.resolve('keep'); assert.equal(c.blocked, false); assert.equal(f.adapter.writes.filter(file => file.endsWith('.md')).length, writes);
});

test('verified success is not inherited by a different recovery record inspected in the same UI session', async () => {
 const { f, c } = controller(); await c.initialize(); c.updateScope(f.scope); await c.scan();
 f.adapter.beforeWrite = file => { if (file.endsWith('/resolved.json')) throw new Error('Close failed'); };
 await c.apply(); const original = await f.store.load(); assert.equal(original.kind, 'active');
 if (original.kind !== 'active') throw new Error('Missing fixture record');
 f.adapter.beforeWrite = undefined; await f.store.resolve(original, 'kept'); await f.store.cleanup();
 await f.store.create({ ...structuredClone(original.record), id: crypto.randomUUID() });
 await c.initialize(); assert.equal(c.result, null); assert.equal(c.preview, null);
 const { button } = settingsFixture(c, f.app);
 assert.ok(button('Restore')); assert.equal(button('RetryCleanup'), undefined);
});


test('large mixed-file selection retains independent defaults, stable identity, focus and exact apply snapshots', async () => {
 const notes = Object.fromEntries(Array.from({ length: 24 }, (_, file) => {
  const end = file % 2 ? '\r\n' : '\n';
  const lines = ['---', 'Title: Synthetic fixture', '---', '- [ ] Existing {{operonId:: zzzzzzz}} {{priority:: Low}}',
   ...Array.from({ length: 12 }, (_, row) => `  - [ ] Task ${file}-${row} 📅 2026-10-10${row % 2 ? ' ⏬' : ''}`),
   '```md', '- [ ] Protected 📅 2026-10-10', '```', '- [ ] Ordinary checkbox'];
  return [`Folder/File-${String(file).padStart(2, '0')}.md`, lines.join(end) + end];
 }));
 const { f, c } = controller(fixture(notes)); f.settings.defaultPriority = 'High';
 await c.initialize(); c.updateScope(f.scope); await c.scan();
 const all = c.preview!;
 const { button, doc } = settingsFixture(c);
 button('Apply').focus(); const approved = c.preview!;
 c.requestConfirmation(approved); assert.equal(doc.activeElement?.dataset.focusKey, 'Dismiss');
 assert.equal(approved.operonIds.length, 288); assert.equal(approved.scan.timestamp, all.scan.timestamp);
 for (const row of approved.rows.filter(row => row.selected)) {
  assert.equal(row.operonId, all.rows.find(original => original.key === row.key)!.operonId);
  const task = parseTaskLine(row.after!, row.lineNumber, row.path, f.settings.keyMappings)!;
  assert.equal(task.fields.some(field => field.key === 'parentTask'), false);
  if (row.lineNumber % 2 === 0) assert.equal(task.fields.find(field => field.key === 'priority')?.value, 'High');
 }
 assert.deepEqual(c.preview!.changes, approved.changes);
 await c.confirm(approved); assert.equal(c.result?.status, 'committed'); assert.equal(c.counts.converted, 288);
 for (const change of approved.changes) assert.equal(await f.adapter.read(change.path), change.after);
 assert.equal(doc.activeElement?.dataset.focusKey, 'Scan'); assert.equal((await f.store.load()).kind, 'empty');
});


test('Settings renderer lifecycle keeps separate detached surfaces and cleans only the requested page', async () => {
 const source = await readFile(path.join(process.cwd(), 'src/ui/settings-tab.ts'), 'utf8');
 const ast = ts.createSourceFile('settings-tab.ts', source, ts.ScriptTarget.Latest, true);
 const cls = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'OperonSettingsTab') as import('typescript').ClassDeclaration;
 const names = ['renderTasksBulkConversion', 'clearNativeSettingsPage'];
 const methods = cls.members.filter(member => ts.isMethodDeclaration(member) && names.includes(member.name.getText(ast)));
 assert.equal(methods.length, names.length);
 const script = ts.transpileModule('class Harness { '+methods.map(method => method.getText(ast)).join('\n')+' }; return Harness;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
 const Harness = new Function('Setting', 't', 'setSettingsScope', 'closeFloatingPanelsForRoot', script)(Setting, (_domain: string, key: string) => key, () => {}, () => {});
 const h = new Harness(), { f, c } = controller(); await c.initialize(); c.updateScope(f.scope); await c.scan();
 const views: TasksConversionSettings[] = [];
 h.tasksConversionSettings = new Map(); h.disposeReminderSoundPreview = () => {};
 h.tasksConversionUi = { available: () => true, mount: (host: HTMLElement) => {
  const view = new TasksConversionSettings(new App(), host, c); views.push(view); return () => view.dispose();
 } };
 const doc = { activeElement: null as TestElement | null }, first = new TestElement('div', doc), second = new TestElement('div', doc);
 const cleanupFirst = h.renderTasksBulkConversion(first); h.renderTasksBulkConversion(second);
 assert.equal(h.tasksConversionSettings.size, 2); assert.ok(first.allText.includes('2 convertible tasks')); assert.ok(second.allText.includes('2 convertible tasks'));
 c.requestConfirmation(c.preview!); h.clearNativeSettingsPage(first);
 assert.equal(h.tasksConversionSettings.size, 1); assert.equal(first.children.length, 0); assert.equal(c.confirmation, null);
 assert.equal(c.available, true); assert.ok(second.allText.includes('2 convertible tasks'));
 cleanupFirst(); assert.equal(h.tasksConversionSettings.size, 1);
 h.clearNativeSettingsPage(second); assert.equal(h.tasksConversionSettings.size, 0); assert.equal(c.available, true);
});

test('plugin reuses its conversion session and refuses access while unloading', async () => {
 const { h } = await mainHarness(['getTasksBulkConversion']); const { c } = controller();
 h.startupReady = true; h.agentRuntimeLifecycle = { getPhase: () => 'ready' }; h.tasksConversionController = c;
 assert.equal(h.getTasksBulkConversion(), c); assert.equal(h.getTasksBulkConversion(), c);
 h.agentRuntimeLifecycle.getPhase = () => 'unloading'; assert.equal(h.getTasksBulkConversion(), null);
});


test('pointer scan does not transfer focus and preserves the outer Settings scroll through progress and completion', async () => {
 const { f, c } = controller(); await c.initialize(); c.updateScope(f.scope);
 const { root, doc, button } = settingsFixture(c);
 const page = new TestElement('div', doc); page.children.push(root); root.parentElement = page;
 page.scrollTop = 500; page.scrollLeft = 12; page.scrollHeight = 700; page.clientHeight = 400; root.offsetHeight = 140;
 const empty = root.empty.bind(root);
 root.empty = () => { empty(); page.scrollTop = 0; page.scrollLeft = 0; doc.activeElement = null; };
 const scanButton = button('Scan'); scanButton.focusVisible = false; scanButton.focus();
 await c.scan(); assert.equal(doc.activeElement, null); assert.equal(page.scrollTop, 500); assert.equal(page.scrollLeft, 12);
 assert.equal(root.cssProps['--operon-conversion-min-height'], '340px');
 page.scrollTop = 0; c.dismissConfirmation(); c.requestConfirmation(c.preview!);
 assert.equal(root.cssProps['--operon-conversion-min-height'], '0px'); c.dismissConfirmation(); page.scrollTop = 500;
 const apply = button('Apply'); apply.focusVisible = false; apply.focus(); c.requestConfirmation(c.preview!);
 assert.equal(doc.activeElement, null); assert.equal(page.scrollTop, 500);
});


test('source conflict offers a fresh confirmation for unchanged files and replans cross-file dependencies', async () => {
 const { f, c } = controller(fixture({ 'A.md': '- [ ] A 🆔 A', 'B.md': '- [ ] B ⛔ A', 'C.md': '- [ ] C 🆔 C' }));
 await c.initialize(); c.updateScope(f.scope); await c.scan(); const original = c.preview!;
 f.adapter.files.set('A.md', '- [ ] Changed A 🆔 A');
 c.requestConfirmation(original); await c.confirm(original);
 assert.deepEqual(f.adapter.writes, []); assert.deepEqual(c.result?.sourceConflicts, ['A.md']);
 assert.ok(c.result?.message?.includes('A.md:1'));
 const { button, root } = settingsFixture(c); assert.ok(button('ReviewUnchanged'));
 c.reviewUnchangedSources(); const revised = c.preview!;
 assert.equal(c.confirmation, revised); assert.equal(revised.selectedKeys.length, 2);
 assert.deepEqual(revised.operonIds, original.operonIds.slice(1));
 assert.equal(revised.scan.timestamp, original.scan.timestamp);
 assert.ok(!revised.changes.find(file => file.path === 'B.md')!.after.includes('{{blockedBy::'));
 assert.ok(root.allText.includes('Skipped because')); assert.deepEqual(f.adapter.writes, []);
 await c.confirm(original); assert.deepEqual(f.adapter.writes, []);
 await c.confirm(revised); assert.equal(c.result?.status, 'committed'); assert.equal(c.counts.converted, 2);
 assert.equal(await f.adapter.read('A.md'), '- [ ] Changed A 🆔 A');
 assert.equal(f.adapter.writes.filter(path => path === 'A.md').length, 0);
 for (const change of revised.changes) assert.equal(await f.adapter.read(change.path), change.after);
});
test('fresh scans of an unchanged dependency source with frontmatter and punctuation apply without a false conflict', async () => {
 const content = '---\nType: Test\n---\n,\n# Dependencies\n- [ ] First 🆔 example1\n- [ ] Next ⛔ example1, absent 📅 2026-10-12\n';
 const { f, c } = controller(fixture({ 'Dependencies.md': content }));
 await c.initialize(); c.updateScope(f.scope); await c.scan(); await c.scan();
 c.requestConfirmation(c.preview!); await c.confirm(c.preview!);
 assert.equal(c.result?.status, 'committed'); assert.equal(c.counts.converted, 2);
});
test('all changed files yield an empty revised scope and no write or stale confirmation', async () => {
 const { f, c } = controller(); await c.initialize(); c.updateScope(f.scope); await c.scan();
 for (const { path } of c.preview!.changes) f.adapter.files.set(path, 'User edit');
 await c.apply(); assert.equal(c.result?.sourceConflicts?.length, 2); c.reviewUnchangedSources();
 assert.equal(c.preview?.selectedKeys.length, 0); assert.equal(c.confirmation, null); assert.deepEqual(f.adapter.writes, []);
});


test('real adapter skips a conflicted source only after renewed confirmation and keeps unrelated bytes', async () => {
 const root = await mkdtemp(path.join(process.platform === 'darwin' ? '/private/tmp' : tmpdir(), 'operon-conflict-continuation-'));
 try {
  const adapter = new DiskAdapter(root);
  const originals = { 'A.md': '- [ ] A 🆔 A\r\n', 'B.md': '- [ ] B ⛔ A\r\n', 'Unrelated.txt': 'Preserve these bytes\r\n' };
  for (const [file, content] of Object.entries(originals)) await adapter.write(file, content);
  const { c } = controller(wiredFixture(adapter)); await c.initialize();
  c.updateScope({ files: ['A.md', 'B.md'], folders: [], includeSubfolders: false }); await c.scan();
  const changed = '- [ ] A edited 🆔 A\r\n'; await adapter.write('A.md', changed); adapter.writes = [];
  c.requestConfirmation(c.preview!); await c.confirm(c.preview!); assert.equal(adapter.writes.length, 0);
  assert.deepEqual(c.result?.sourceConflicts, ['A.md']); c.reviewUnchangedSources();
  const revised = c.preview!; assert.equal(revised.changes.length, 1); assert.equal(adapter.writes.length, 0);
  c.dismissConfirmation(); await c.confirm(revised); assert.equal(adapter.writes.length, 0);
  c.requestConfirmation(revised); await c.confirm(revised); assert.equal(c.result?.status, 'committed');
  assert.equal(await adapter.read('A.md'), changed); assert.equal(await adapter.read('B.md'), revised.changes[0].after);
  assert.equal(await adapter.read('Unrelated.txt'), originals['Unrelated.txt']);
  assert.ok(adapter.writes.every(file => file === 'B.md' || file.startsWith('.test-config/plugins/operon/state/tasks-conversion/')));
 } finally { await rm(root, { recursive: true, force: true }); }
});


test('completed Settings result releases preview height and offers scope and scan without a restart step', async () => {
 const { f, c } = controller(); await c.initialize(); c.updateScope(f.scope); await c.scan();
 const { root, button } = settingsFixture(c);
 const page = new TestElement('div', root.ownerDocument); page.children.push(root); root.parentElement = page;
 page.scrollTop = 500; page.scrollHeight = 700; page.clientHeight = 400; root.offsetHeight = 140;
 c.requestConfirmation(c.preview!);
 assert.equal(root.cssProps['--operon-conversion-min-height'], '340px');
 await c.confirm(c.preview!);
 assert.equal(root.cssProps['--operon-conversion-min-height'], '0px');
 assert.ok(root.allText.includes('Conversion completed.'));
 assert.ok(root.allText.includes('Converted: 2'));
 assert.equal(button('New'), undefined);
 assert.ok(button('AddFiles')); assert.ok(button('AddFolders')); assert.ok(button('Scan'));
 assert.equal(button('Apply'), undefined); assert.equal(button('ConfirmApply'), undefined);
 const writes = [...f.adapter.writes];
 await c.scan();
 assert.equal(c.result, null); assert.equal(c.preview?.selectedKeys.length, 0);
 assert.deepEqual(f.adapter.writes, writes);
});

for (const content of ['---\noperonId: other01\nblockedBy: task001\n---\nBody', '---\nblockedBy : task001\n---', '---\n  blockedBy: task001\n---', '---\n{blockedBy: task001}\n---', '``` operon\nview: card\ntaskId: task001\n```', '```\toperon\nview: card\ntaskId: task001\n```']) {
 test('targeted rollback inventory includes saved and dirty references: '+content.split('\n')[0], async () => {
  const file = new (TFile as unknown as new (name: string) => TFile)('Other.md');
  const app = { vault: { getAbstractFileByPath: () => file, read: async () => content } } as unknown as App;
  let buffer = content;
  const inventory = createTasksConversionReferenceInventory(app, {
   workflow: () => ({ externalReferences: [], reservedSeriesIds: [], isCurrent: () => true }),
   nativeSnapshot: () => ({ references: [], isCurrent: () => true }), matches: () => false,
   projectTable: (_path, preset) => preset, markdownBuffers: () => [{ path: 'Dirty.md', content: buffer }],
  });
  const dirty = await inventory(undefined, { paths: [], ids: ['task001'] });
  assert.deepEqual(dirty.externalReferences, ['task001']); assert.deepEqual(dirty.unavailablePaths, []);
  buffer = ''; assert.equal(dirty.isCurrent(), false);
  const saved = await inventory(undefined, { paths: ['Other.md'], ids: ['task001'] });
  assert.deepEqual(saved.externalReferences, ['task001']); assert.deepEqual(saved.unavailablePaths, []);
 });
}
test('targeted rollback ignores unrelated malformed frontmatter mentioning an ID in prose', async () => {
 const inventory = createTasksConversionReferenceInventory({ vault: {} } as App, {
  workflow: () => ({ externalReferences: [], reservedSeriesIds: [], isCurrent: () => true }),
  nativeSnapshot: () => ({ references: [], isCurrent: () => true }), matches: () => true,
  projectTable: (_path, preset) => preset,
  markdownBuffers: () => [{ path: 'Template.md', content: '---\nTitle: %invalid\n---\nAn ordinary mention task001' }],
 });
 const result = await inventory(undefined, { paths: [], ids: ['task001'] });
 assert.deepEqual(result.externalReferences, []); assert.deepEqual(result.unavailablePaths, []);
});

test('targeted native and compressed drawing references stay read-only and invalidate before restore', async () => {
 const file = new (TFile as unknown as new (name: string) => TFile)('Drawing.md');
 let nativeIds = ['task001'], reads = 0, drawingReads = 0;
 const app = { vault: { getAbstractFileByPath: () => file, read: async () => { reads++; return '---\nexcalidraw-plugin: parsed\n---\ncompressed scene'; } } } as unknown as App;
 const inventory = createTasksConversionReferenceInventory(app, {
  workflow: () => ({ externalReferences: [], reservedSeriesIds: [], isCurrent: () => true }), matches: () => false,
  nativeSnapshot: ids => { assert.deepEqual(ids, ['task001']); const snapshot = [...nativeIds]; return { references: snapshot, isCurrent: () => JSON.stringify(snapshot) === JSON.stringify(nativeIds) }; },
  projectTable: (_path, preset) => preset,
  drawingReferences: async () => { drawingReads++; return ['task001']; },
 });
 const result = await inventory(undefined, { paths: ['Drawing.md'], ids: ['task001'] });
 assert.deepEqual(result.externalReferences, ['task001']); assert.deepEqual(result.unavailablePaths, []);
 assert.equal(reads, 1); assert.equal(drawingReads, 1); assert.equal(result.isCurrent(), true);
 nativeIds = []; assert.equal(result.isCurrent(), false);
});
test('targeted saved Canvas references are checked without enumerating the vault', async () => {
 const file = new (TFile as unknown as new (name: string) => TFile)('Board.canvas');
 const app = { vault: { getAbstractFileByPath: () => file, read: async () => JSON.stringify({ nodes: [{ type: 'text', operonTask: { version: 1, taskId: 'task001' } }] }) } } as unknown as App;
 const inventory = createTasksConversionReferenceInventory(app, {
  workflow: () => ({ externalReferences: [], reservedSeriesIds: [], isCurrent: () => true }), matches: () => true,
  nativeSnapshot: () => ({ references: [], isCurrent: () => true }), projectTable: (_path, preset) => preset,
 });
 const result = await inventory(undefined, { paths: ['Board.canvas'], ids: ['task001'] });
 assert.deepEqual(result.externalReferences, ['task001']); assert.deepEqual(result.unavailablePaths, []);
});


test('vault scan summarizes normal exclusions without warning rows', async () => {
 const f = fixture({ 'Templates/A.md': '- [ ] A 🆔 A', 'Skip/B.md': '- [ ] B 🆔 B', 'Live.md': '- [ ] Live 🆔 L' });
 f.settings.fileTaskTemplateFolder = 'Templates'; f.settings.excludedFolders = ['Skip'];
 const { c } = controller(f); await c.initialize(); c.updateScope(f.scope); await c.scan();
 const { root, button, view } = settingsFixture(c);
 assert.ok(root.allText.includes('Files not scanned in template or excluded folders: 2.'));
 assert.equal(root.allText.includes('Templates/A.md'), false); assert.equal(root.allText.includes('Skip/B.md'), false);
 assert.equal(button('issues'), undefined); assert.equal(button('Apply').disabled, false);
 view.dispose();
});

test('explicit excluded selections get inline reasons while actual source errors remain warnings', async () => {
 const f = fixture({ 'Templates/A.md': '- [ ] A 🆔 A', 'Live.md': '- [ ] Live 🆔 L' });
 f.settings.fileTaskTemplateFolder = 'Templates'; f.settings.excludedFolders = ['Empty'];
 const { c } = controller(f); await c.initialize();
 c.updateScope({ files: ['Templates/A.md', 'Missing.md'], folders: ['Templates', 'Empty'], includeSubfolders: true }); await c.scan();
 const { root, button, view } = settingsFixture(c);
 for (const key of ['files:Templates/A.md', 'folders:Templates', 'folders:Empty']) assert.ok(button(key).parentElement!.allText.includes('Excluded folder or template'));
 assert.ok(root.allText.includes('Warnings (1)')); assert.ok(root.allText.includes('Missing.md'));
 c.updateScope({ files: [], folders: ['/'], includeSubfolders: true });
 assert.equal(root.allText.includes('Excluded folder or template'), false); assert.equal(button('issues'), undefined);
 view.dispose();
});

test('Settings separates note information from skipped warnings before and after conversion', async () => {
 const f = fixture({ 'A.md': '- [u] Custom ⏰ 06:00 📅 2026-10-10\n- [ ] Hybrid {{operonId:: hybrid1}} 📅 2026-10-10' });
 const { c } = controller(f); await c.initialize();
 c.updateScope({ files: ['A.md', 'Missing.md'], folders: [], includeSubfolders: false }); await c.scan();
 const { root, button, view } = settingsFixture(c);
 assert.equal(button('issues-notes').textContent, 'Information to be added to the task’s note field (2)');
 const notes = button('issues-notes').parentElement!;
 assert.ok(notes.allText.includes('custom checkbox symbol: u')); assert.ok(notes.allText.includes('⏰ 06:00'));
 assert.equal(button('issues').textContent, 'Warnings (2)');
 const warnings = button('issues').parentElement!;
 assert.ok(warnings.allText.includes('Unsupported mixed metadata')); assert.ok(warnings.allText.includes('Missing.md'));
 assert.equal(warnings.allText.includes('⏰'), false); assert.equal(button('issues-errors'), undefined);
 assert.equal(button('Apply').disabled, false); assert.deepEqual(f.adapter.writes, []);
 notes.open = true; notes.fire('toggle'); button('issues-notes').focus();
 c.requestConfirmation(c.preview!);
 assert.equal(button('issues-notes').parentElement!.open, true);
 assert.equal(root.ownerDocument.activeElement?.dataset.focusKey, 'issues-notes');
 await c.confirm(c.preview!);
 assert.equal(c.result?.status, 'committed'); assert.ok(root.allText.includes('Converted: 1'));
 assert.equal(button('result-issues-notes').textContent, 'Information to be added to the task’s note field (2)');
 assert.equal(button('result-issues').textContent, 'Warnings (2)');
 const converted = parseTaskLine((await f.adapter.read('A.md')).split('\n')[0], 0, 'A.md')!;
 const note = converted.fields.find(field => field.key === 'note')!.value;
 assert.ok(note.includes('⏰ 06:00')); assert.ok(note.includes('custom checkbox symbol: u'));
 assert.equal(converted.fields.some(field => field.key === 'datetimeStart'), false);
 view.dispose();
});

test('note-only information does not create a warning heading or block conversion', async () => {
 const { f, c } = controller(fixture({ 'A.md': '- [>] Task ⏳ 2026-10-10' }));
 await c.initialize(); c.updateScope(f.scope); await c.scan();
 const { root, button, view } = settingsFixture(c);
 assert.ok(button('issues-notes')); assert.equal(button('issues'), undefined);
 assert.equal(root.allText.includes('Warnings'), false); assert.equal(button('Apply').disabled, false);
 view.dispose();
});

test('blocking preview errors stay separate from note information without duplicate row keys', async () => {
 const { f, c } = controller(); await c.initialize(); c.updateScope(f.scope); await c.scan();
 const row = c.preview!.rows[0];
 c.preview = { ...c.preview!, rows: c.preview!.rows.map(item => item === row
  ? { ...item, error: 'Workflow resolution failed', warnings: ['Not applied to notes'] } : item), errors: [row.key] };
 const { root, button, view } = settingsFixture(c);
 assert.equal(button('issues-errors').textContent, 'Errors (1)');
 assert.ok(root.allText.includes('A.md:1 · Workflow resolution failed'));
 assert.equal(root.allText.includes('Not applied to notes'), false);
 assert.equal(button('issues'), undefined); assert.equal(button('Apply').disabled, true);
 assert.deepEqual(f.adapter.writes, []); view.dispose();
});

test('source changes remain visible operation errors with zero writes', async () => {
 const { f, c } = controller(); await c.initialize(); c.updateScope(f.scope); await c.scan();
 const { root, view } = settingsFixture(c);
 f.adapter.files.set('A.md', '- [ ] User edit 🆔 A');
 c.requestConfirmation(c.preview!); await c.confirm(c.preview!);
 assert.equal(c.result?.status, 'not-applied');
 assert.ok(root.allText.includes('Error: Source differs from scan:'));
 assert.equal(root.allText.includes('Conversion completed.'), false); assert.deepEqual(f.adapter.writes, []);
 view.dispose();
});
