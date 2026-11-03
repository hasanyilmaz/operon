import { kanbanCellPlanPreview } from '../src/ui/kanban/kanban-axis-labels';
import { KanbanDragInteractionGate, KanbanDropPersistenceGate } from '../src/systems/kanban-drag-interaction';
import { beginLongPressTouchGesture, scrollTouchSurface } from '../src/ui/touch-drag-session';
import { KanbanCardOperationRegistry } from '../src/systems/kanban-drop-transaction';
import './kanban-pool-placement.test';
import { kanbanPoolSourceSignature } from '../src/systems/kanban-drop-transaction';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import type * as Typescript from 'typescript';
import { statusDockDocument } from './test-support/status-dock-dom';
import { DEFAULT_SETTINGS } from '../src/types/settings';
import { normalizeTaskCardSettings } from '../src/types/task-card';
import { queryCanvasTaskPool, canvasTaskPoolBatch } from '../src/systems/canvas-task-pool';
import { readPropertyPoolPreferences } from '../src/core/property-value-pool';
import { SettingsPreservationHarness } from './test-support/settings-preservation-harness';
const ts: typeof Typescript = require('typescript');

// Execute production class bodies with only host/renderer boundaries replaced.
function productionClass(file: string, name: string, dependencies: Record<string, unknown>, names?: string[]) {
 const text = readFileSync(file, 'utf8'), source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
 const declaration = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === name) as Typescript.ClassDeclaration;
 assert.ok(declaration, name);
 const body = names ? `class ${name} extends Component { ${names.map(key => {
  const member = declaration.members.find(member => member.name?.getText(source) === key); assert.ok(member, key); return member.getText(source);
 }).join('\n')} }` : declaration.getText(source).replace(/^export /u, '');
 const code = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
 return new Function(...Object.keys(dependencies), `${code}; return ${name};`)(...Object.values(dependencies));
}
class Lifetime {
 children: any[] = []; cleanups: Array<() => void> = []; loaded = false;
 load() { this.loaded = true; (this as any).onload?.(); }
 unload() { this.loaded = false; (this as any).onunload?.(); for (const child of this.children.splice(0)) child.unload?.(); for (const cleanup of this.cleanups.splice(0)) cleanup(); }
 addChild(child: any) { this.children.push(child); if (this.loaded) child.load?.(); return child; }
 removeChild(child: any) { this.children = this.children.filter(other => other !== child); child.unload?.(); }
 register(callback: () => void) { this.cleanups.push(callback); }
 registerDomEvent(el: any, name: string, callback: any) { el.addEventListener(name, callback); this.register(() => el.removeEventListener(name, callback)); }
}
const event = (key = '', extra = {}) => ({ key, button: 0, pointerId: 1, pointerType: 'mouse', clientX: 20, clientY: 20, target: { closest: () => null }, preventDefault() {}, stopPropagation() {}, ...extra });
const common = {
 Component: Lifetime, t: (_group: string, key: string) => key, normalizeTaskCardSettings,
 getOwnerWindow: (el: any) => el.ownerDocument.defaultView,
 setIcon: (el: any, icon: string) => { el.icon = icon; }, setAccessibleLabelWithoutTooltip: (el: any, label: string) => { el.label = label; },
 bindOperonHoverTooltip() {}, cleanupOperonHoverTooltips() {}, bindCanvasPoolLayer() {},
 Notice: class {}, scrollChildIntoView() {},
};
const controls: any[] = [], notes: any[] = [];
const TaskPool = productionClass('src/ui/surface-task-pool.ts', 'SurfaceTaskPool', {
 ...common, canvasTaskPoolBatch, queryCanvasTaskPool, CANVAS_TASK_POOL_SEARCH_DELAY: 120,
 resolveTaskColorSource: () => null, resolveTaskDisplayIcon: () => 'circle',
 TaskCardControls: class { constructor(...args: any[]) { controls.push(args.at(-1)); } },
 renderCompactTaskMarkdown: (el: any, options: any) => { el.textContent = options.value; },
 createTaskNoteActionButton: (options: any) => { const button = options.owner.createEl('button'); button.note = true; button.onclick = () => options.onActivate(button); return button; },
 showTaskNotePopover: (options: any) => notes.push(options),
});
const PropertyPool = productionClass('src/ui/surface-property-value-pool.ts', 'SurfacePropertyValuePool', {
 ...common, readPropertyPoolPreferences, propertyPoolDateViewContext: () => 'today',
 acquirePropertyPoolSources: () => ({ release() {} }),
});
const propertyNotices: string[] = [];
const PropertyDrop = productionClass('src/ui/surface-property-value-drop.ts', 'SurfacePropertyValueDrop', {
 ...common, beginLongPressTouchGesture, scrollTouchSurface,
 Notice: class { constructor(message: string) { propertyNotices.push(message); } },
 renderPropertyPoolValueVisual() {}, resolvePropertyPoolDate: () => '',
 showOperonPointerTooltip: () => ({ close() {}, position() {} }),
});
const Owner = productionClass('src/ui/kanban/kanban-pools.ts', 'KanbanPools', {
 ...common, SurfaceTaskPool: TaskPool, SurfacePropertyValuePool: PropertyPool,
});
const taskPreviews: { anchor: any; content: string; closed: boolean; positions: number }[] = [];
const taskPreview = (anchor: any, options: any) => {
 const entry = { anchor, content: options.content, closed: false, positions: 0 }; taskPreviews.push(entry);
 return { close: () => { entry.closed = true; }, position: () => { entry.positions++; } };
};
let dragHost: any = null;
const View = productionClass('src/ui/kanban/kanban-view.ts', 'KanbanView', { ...common, KanbanPools: Owner, SurfacePropertyValueDrop: PropertyDrop, KanbanDragInteractionGate, KanbanDropPersistenceGate,
 kanbanCellPlanPreview, showOperonPointerTooltip: taskPreview, kanbanPoolSourceSignature, getNativePropertyIndex: () => ({ getTypes: () => ({}) }), kanbanAxisReason: (reason: string) => reason,
 startKanbanPoolDrag: (_event: unknown, _task: unknown, _row: unknown, host: unknown) => { dragHost = host; return () => {}; },
 },
 ['dragInteractionGate', 'mobileDropPersistenceGate', 'hasActiveKanbanDragInteraction', 'beginKanbanDragInteraction', 'endKanbanDragInteraction', 'pools', 'poolMount', 'propertyPoolRefreshMount', 'propertyPoolRestore', 'propertyDropCell', 'syncPools', 'clearPools', 'mountPools']);
function fixture() {
 const dom = statusDockDocument(), doc = dom.doc;
 const proto = doc.defaultView.HTMLElement.prototype;
 proto.empty = function () { for (const child of this.children) child.connected = false; this.children = []; };
 proto.querySelector = function (selector: string) { return this.querySelectorAll().find((node: any) => selector === 'input' ? node.tagName === 'INPUT' : selector.startsWith('.') ? node.classes.has(selector.slice(1)) : node.tagName === selector.toUpperCase()) ?? null; };
 proto.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 700, width: 1000, height: 700 });
 const tasks = [0, 1].map(i => ({ operonId: `abc123${i}`, description: `Task ${i}`, checkbox: 'open', fieldValues: { note: 'Existing note' }, tags: [], primary: { filePath: 'Tasks.md' } }));
 const callbacks = new Set<() => void>(), favorites = new Set<() => void>(), writes: any[] = [], opened: string[] = [];
 const settings = structuredClone(DEFAULT_SETTINGS);
 const services = { cards: {
  onRefresh: (cb: () => void) => { callbacks.add(cb); return () => callbacks.delete(cb); },
  getAllTasks: () => tasks, resolve: (id: string) => ({ state: 'ready', task: tasks.find(t => t.operonId === id) }),
  activate: (id: string) => opened.push(id), run: async (_id: string, allowed: () => boolean, action: () => unknown) => allowed() && await action(),
  deps: { getSettings: () => settings, getIndexState: () => 'ready', controls: { getTask: (id: string) => tasks.find(t => t.operonId === id),
   updateSurfaceFields: async (_id: string, value: unknown, _expected: unknown, allowed: () => boolean) => { if (allowed()) writes.push(value); },
  } },
 }, preferences: { edit: async (value: unknown, _expected: unknown, allowed: () => boolean) => { if (allowed()) writes.push(value); }, subscribe: (cb: () => void) => { favorites.add(cb); return () => favorites.delete(cb); } } };
 const view = new View(); view.load(); view.app = {}; let preset = 'board-a', ready = true;
 view.getSettings = () => ({ kanbanPresets: [{ id: 'board-a' }, { id: 'board-b' }] }); view.ensureState = () => ({ presetId: preset });
 view.getPoolServices = () => ready ? services : null;
 const board = doc.body.createDiv();
 return { ...dom, doc, tasks, callbacks, favorites, writes, opened, services, view, board, setPreset: (id: string) => { preset = id; }, setReady: (value: boolean) => { ready = value; },
  mount: () => { view.mountPools(board, preset); return view.pools; }, close: () => view.clearPools(),
 };
}
function openTasks(f: ReturnType<typeof fixture>) { const owner = f.mount(); const pool = owner.children[0]; pool.show(); return pool; }
function openProperties(f: ReturnType<typeof fixture>) {
 const pool = f.view.pools.children[1];
 // Value enumeration has its own suite; retain the actual panel/session/event lifecycle here.
 pool.refresh = () => {}; pool.position = () => {}; pool.show(); return pool;
}

test('Kanban fileless panels open with independent edit and placement capabilities', () => {
 const f = fixture(); try {
  const pool = openTasks(f), properties = openProperties(f);
  assert.ok(pool.panel?.isConnected); assert.ok(properties.panel?.isConnected);
  assert.equal(pool.canMutate(), true); assert.equal(properties.current(), true);
  assert.equal(pool.surface.file(), null); assert.equal(pool.panelIdentity, f.view.pools);
  assert.equal(pool.panel.label, 'kanbanTaskPool'); assert.equal(properties.panel.label, 'kanbanPropertyPool');
  assert.equal(properties.drop, null); assert.equal(properties.groupSelection, null);
  assert.equal(f.view.pools.controls.children.length, 2);
 } finally { f.close(); }
});
test('Kanban keeps plus and Enter disabled while delegating only drag placement', async () => {
 const f = fixture(); try {
  const pool = openTasks(f); let captures = 0, additions = 0, drags = 0;
  pool.surface.capture = () => { captures++; return { isCurrent: () => true, point: { x: 0, y: 0 } }; };
  pool.surface.add = async () => { additions++; return true; };
  pool.surface.startPlacementDrag = (_event: unknown, _task: unknown, _row: unknown, _place: unknown, finish: () => void) => { drags++; finish(); return () => {}; };
  for (const row of pool.list.children) {
   assert.equal(row.querySelectorAll().some((el: any) => el.icon === 'plus'), false);
   assert.equal(row.handlers?.has('pointerdown'), true);
   for (const pointerType of ['mouse', 'touch', 'pen']) pool.startDrag(event('', { pointerType }), f.tasks[0], row);
  }
  pool.handleSearchKey(event('Enter')); await pool.add({ isCurrent: () => true }, 'abc1230');
  assert.equal(captures, 0); assert.equal(additions, 0); assert.equal(drags, 6); assert.equal(pool.cancelDrag, null);
  pool.handleSearchKey(event('ArrowDown')); assert.equal(pool.selectedId, 'abc1231');
  pool.handleSearchKey(event('ArrowUp')); assert.equal(pool.selectedId, 'abc1230');
 } finally { f.close(); }
});
for (const pinned of [true, false]) for (const succeeds of [true, false]) test(`Kanban drag settlement success=${succeeds} pin=${pinned} preserves the correct panel`, async () => {
 const f = fixture(); try {
  const pool = openTasks(f); pool.pinned = pinned;
  pool.surface.add = async () => succeeds;
  await pool.add({ isCurrent: () => true }, 'abc1230', 'dragPlacement');
  assert.equal(!!pool.panel, pinned || !succeeds);
 } finally { f.close(); }
});
test('task status/menu guards, note editing and title opening remain active until session closes', async () => {
 const f = fixture(); try {
  const pool = openTasks(f), control = controls.at(-1), row = pool.list.children[0];
  assert.equal(control.canMutate(), true); assert.equal(control.surface().canChangeStatus(), true); assert.equal(control.surface().canEditFields(), true);
  const title = row.querySelectorAll().find((el: any) => el.classes.has('operon-canvas-task-pool-title')); title.click(); assert.deepEqual(f.opened, ['abc1230']);
  const note = row.querySelectorAll().find((el: any) => el.note); note.onclick(); await notes.at(-1).onCommit('Updated'); assert.deepEqual(f.writes, [{ note: 'Updated' }]);
  f.close(); assert.equal(control.canMutate(), false); assert.equal(control.surface().canInteract(), false); await notes.at(-1).onCommit('Stale'); title.click();
  assert.equal(f.writes.length, 1); assert.equal(f.opened.length, 1);
 } finally { f.close(); }
});
test('late service readiness mounts once; in-place refresh retains pinned search and listeners', () => {
 const f = fixture(); try {
  f.setReady(false); assert.equal(f.mount(), null); f.setReady(true); f.view.syncPools();
  const owner = f.view.pools, pool = owner.children[0]; pool.show(); pool.query = 'Task'; pool.pinned = true;
  f.view.syncPools(); f.callbacks.forEach(cb => cb());
  assert.equal(f.view.pools, owner); assert.equal(pool.query, 'Task'); assert.equal(pool.pinned, true);
  assert.equal(f.callbacks.size, 1); assert.equal(f.favorites.size, 1);
 } finally { f.close(); }
 assert.equal(f.callbacks.size, 0); assert.equal(f.favorites.size, 0); assert.equal(f.timers.size, 0);
 for (const callbacks of f.listeners.values()) assert.equal(callbacks.size, 0);
 for (const callbacks of f.windowListeners.values()) assert.equal(callbacks.size, 0);
});
test('preset switch invalidates pending leases before render and new board cannot revive them', () => {
 const f = fixture(); try {
  const pool = openTasks(f), lease = pool.captureLease(), owner = f.view.pools;
  f.setPreset('board-b'); assert.equal(lease(), false); pool.sync(); assert.equal(pool.panel, null);
  f.view.mountPools(f.doc.body.createDiv(), 'board-b'); f.setPreset('board-a'); assert.equal(lease(), false); assert.notEqual(f.view.pools, owner);
 } finally { f.close(); }
});
test('two Kanban views own separate sessions; detached board rejects old writes', () => {
 const a = fixture(), b = fixture(); try {
  const first = openTasks(a), second = openTasks(b), lease = first.captureLease();
  assert.notEqual(first.panelIdentity, second.panelIdentity); a.close(); assert.equal(lease(), false); assert.equal(second.canMutate(), true);
  b.board.remove(); assert.equal(second.canMutate(), false);
 } finally { a.close(); b.close(); }
});
for (const kind of ['canvas', 'excalidraw']) test(`${kind} default direct/drag insertion and file rename guards remain intact`, async () => {
 const f = fixture(); try {
  const file = { path: `A.${kind}` }; let currentFile: any = file, writes = 0;
  const pool = new TaskPool({ ...f.services, app: {}, cards: f.services.cards, contentEl: f.board,
   title: () => kind, addLabel: () => '+', unavailable: () => 'unavailable', file: () => currentFile, isCurrent: () => true, readOnly: () => false,
   capture: () => ({ isCurrent: () => true, point: { x: 0, y: 0 } }), add: async (target: any) => { if (target.isCurrent()) writes++; return false; }, dropPoint: () => ({ x: 1, y: 2 }),
  }); pool.load(); pool.setButton(f.board.createEl('button')); pool.show();
  assert.equal(pool.canPlace('directPlacement'), true); assert.equal(pool.canPlace('dragPlacement'), true);
  assert.ok(pool.list.children[0].querySelectorAll().some((el: any) => el.icon === 'plus'));
  assert.ok(pool.list.children[0].handlers.has('pointerdown'));
  pool.handleSearchKey(event('Enter')); await Promise.resolve(); await Promise.resolve(); assert.equal(writes, 1);
  const lease = pool.captureLease(); file.path = `B.${kind}`; assert.equal(lease(), false);
  file.path = `A.${kind}`; currentFile = { path: file.path }; assert.equal(lease(), false);
  pool.sync(); assert.equal(pool.panel, null); pool.unload();
 } finally { f.close(); }
});
test('editing permission can be disabled without disabling direct placement', () => {
 const f = fixture(); try {
  const pool = openTasks(f); pool.surface.capabilities = { editTasks: false, directPlacement: true, dragPlacement: false };
  pool.surface.capture = () => null; pool.surface.add = async () => false;
  assert.equal(pool.canMutate(), false); assert.equal(pool.canPlace('directPlacement'), true); assert.equal(pool.canPlace('dragPlacement'), false);
 } finally { f.close(); }
});
test('favorite edits carry the panel generation through asynchronous persistence', async () => {
 const f = fixture(); try {
  openTasks(f); const pool = openProperties(f); let allowed: (() => boolean) | undefined, finish!: () => void;
  pool.preferences.edit = async (_edit: unknown, _expected: unknown, guard: () => boolean) => { allowed = guard; await new Promise<void>(resolve => { finish = resolve; }); };
  const save = pool.toggleFavorite({ key: 'priority', type: 'text', value: 'B' }, false);
  assert.equal(allowed?.(), true); f.close(); assert.equal(allowed?.(), false); finish(); await save;
 } finally { f.close(); }
});
test('cancelled favorite write retains canonical preferences and performs zero writes', async () => {
 const f = new SettingsPreservationHarness({ table: false }); try {
  const storage = f.createStorage(); await storage.initialize(); const raw = storage.getSettings().propertyValuePool;
  const before = f.canonicalCommits; let allowed = true; let release!: () => void;
  const queue = (storage as any).enqueueSettingsTransaction(() => new Promise<void>(resolve => { release = resolve; }));
  await Promise.resolve(); await Promise.resolve();
  const pending = storage.editPropertyValuePool({ kind: 'favorite', favorite: { key: 'priority', type: 'text', value: 'B', label: 'B' }, saved: false }, raw, () => allowed);
  allowed = false; release(); await queue; await pending;
  assert.equal(f.canonicalCommits, before); assert.deepEqual(storage.getSettings().propertyValuePool, raw);
 } finally { await f.dispose(); }
});
test('valid empty and single-axis boards mount controls outside the scrolling grid; error boards do not', () => {
 const view = readFileSync('src/ui/kanban/kanban-view.ts', 'utf8');
 const body = view.slice(view.indexOf('private renderBoardContent('), view.indexOf('private nativePreparation:'));
 assert.ok(body.indexOf('if (!board)') < body.indexOf('this.mountPools(emptyBoard'));
 assert.match(body, /board.columns.length === 0 \|\| board.lanes.length === 0/);
 const render = view.slice(view.indexOf('private renderBoard(container:'), view.indexOf('private renderBoard(container:') + 2200);
 assert.ok(render.indexOf('this.mountPools(boardEl') < render.indexOf('if (hasSwimlanes)'));
 assert.ok(render.indexOf('this.mountPools(boardEl') < render.indexOf("createDiv('operon-kanban-grid-viewport')"));
 const css = readFileSync('styles.css', 'utf8'); const rule = css.split('.operon-kanban-pool-controls {')[1].split('}')[0];
 for (const value of ['position: absolute', 'top: 50%', 'right: 15px', 'translateY(-50%)', 'flex-direction: column']) assert.ok(rule.includes(value));
 assert.match(css.split('.operon-kanban-cell-height-controls {')[1].split('}')[0], /right: 15px/);
});
test('Kanban closes pools for preset changes, full renders, search DOM rebuilds and close; retains in-place refresh', () => {
 const view = readFileSync('src/ui/kanban/kanban-view.ts', 'utf8');
 assert.match(view, /async onClose\(\): Promise<void> \{\s*this.clearPools\(\)/);
 assert.equal((view.match(/if \(presetChanged\) \{ this.clearPools\(\);/g) ?? []).length, 2);
 assert.match(view, /this.clearPools\(\);\s*this.propertyPoolRestore = restorePropertyPool;\s*container.empty\(\)/);
 assert.match(view, /this.clearPools\(\);\s*content.empty\(\)/);
 const render = view.slice(view.indexOf('private render(): void'), view.indexOf('private refreshKanbanTasksInPlace('));
 assert.ok(render.indexOf('this.refreshKanbanTasksInPlace(') < render.indexOf('this.clearPools()'));
});
for (const locale of readdirSync('i18n/locales')) test(`Kanban labels and shared setting descriptions cover ${locale}`, () => {
 const settings = JSON.parse(readFileSync(`i18n/locales/${locale}`, 'utf8')).settings;
 for (const key of ['kanbanTaskPoolNoFieldChanges', 'kanbanTaskPoolManualPosition']) assert.ok(typeof settings[key] === 'string' && settings[key].length > 0, key);
 for (const key of ['kanbanTaskPool', 'kanbanPropertyPool', 'visualTaskPool', 'visualPropertyPool', 'canvasTaskPoolWidthDesc', 'canvasTaskPoolRowsDesc', 'canvasPropertyPoolWidthDesc', 'canvasPropertyPoolRowsDesc']) assert.match(settings[key], /Kanban/, key);
});

 test('board constructed before attachment mounts once and only permits edits after attachment', () => {
 const f = fixture(); try {
  f.board.connected = false; const owner = f.mount(); assert.ok(owner);
  const pool = owner.children[0]; pool.show(); assert.equal(pool.panel, null);
  f.board.connected = true; pool.show(); assert.equal(pool.canMutate(), true);
  f.view.syncPools(); assert.equal(f.view.pools, owner);
 } finally { f.close(); }
});
for (const height of [240, 400, 700]) test(`task panel resize clamps to available viewport height ${height}`, () => {
 const f = fixture(); try {
  const pool = openTasks(f); pool.panel.offsetHeight = 150;
  f.doc.defaultView.visualViewport = { offsetLeft: 0, offsetTop: 0, width: 500, height };
  pool.position();
  assert.ok(parseFloat(pool.panel.style.top) >= 8); assert.ok(parseFloat(pool.panel.style.top) + 150 <= height - 8);
  assert.ok(parseFloat(pool.panel.style.left) + parseFloat(pool.panel.style.width) <= 500 - 8);
 } finally { f.close(); }
});

test('favorite cancellation also reaches the queued data-package transaction', async () => {
 const f = new SettingsPreservationHarness({ table: false }); try {
  const storage = f.createStorage(); await storage.initialize(); const raw = storage.getSettings().propertyValuePool;
  const before = f.canonicalCommits; let allowed = true, release!: () => void;
  const queue = (storage as any).dataPackageStore.enqueueMutation(() => new Promise<void>(resolve => { release = resolve; }));
  await Promise.resolve(); await Promise.resolve();
  const pending = storage.editPropertyValuePool({ kind: 'favorite', favorite: { key: 'priority', type: 'text', value: 'B', label: 'B' }, saved: false }, raw, () => allowed);
  await Promise.resolve(); await Promise.resolve(); allowed = false; release(); await queue;
  await assert.rejects(pending, /cancelled/);
  assert.equal(f.canonicalCommits, before); assert.deepEqual(storage.getSettings().propertyValuePool, raw);
 } finally { await f.dispose(); }
});
test('fileless task sessions require explicit identity and read-only still forbids all writes', () => {
 const f = fixture(); try {
  const pool = openTasks(f); pool.surface.readOnly = () => true; assert.equal(pool.canMutate(), false);
  pool.surface.readOnly = () => false; pool.surface.identity = undefined; assert.equal(pool.canMutate(), false);
  pool.sync(); assert.equal(pool.panel, null);
 } finally { f.close(); }
});

test('missing presets and stale board mounts never expose inoperative pool controls', () => {
 const f = fixture(); try {
  f.setPreset('deleted'); assert.equal(f.mount(), null); assert.equal(f.callbacks.size, 0);
  f.setPreset('board-b'); f.view.mountPools(f.board, 'board-a'); assert.equal(f.view.pools, null);
  f.mount(); assert.ok(f.view.pools); f.view.getSettings = () => ({ kanbanPresets: [] });
  f.view.syncPools(); assert.equal(f.view.pools, null); assert.equal(f.callbacks.size, 0);
 } finally { f.close(); }
});

for (const queueName of ['settings', 'package']) test(`pool manual order cancellation reaches ${queueName} persistence queue without speculative memory`, async () => {
 const f = new SettingsPreservationHarness({ table: false }); try {
  const storage = f.createStorage(); await storage.initialize();
  const before = f.canonicalCommits, previous = storage.kanbanOrder.toPackage(); let allowed = true, release!: () => void;
  const barrier = () => new Promise<void>(resolve => { release = resolve; });
  const queue = queueName === 'settings' ? (storage as any).enqueueSettingsTransaction(barrier) : (storage as any).dataPackageStore.enqueueMutation(barrier);
  await Promise.resolve(); await Promise.resolve();
  const pending = storage.kanbanOrder.replaceCellsIfCurrent('test-board', { cell: [] }, { cell: ['abc1234'] }, () => allowed);
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.deepEqual(storage.kanbanOrder.toPackage(), previous); allowed = false; release(); await queue;
  await assert.rejects(pending, /cancelled/); assert.equal(f.canonicalCommits, before); assert.deepEqual(storage.kanbanOrder.toPackage(), previous);
 } finally { await f.dispose(); }
});
test('pool manual order commits once and survives following unrelated settings save', async () => {
 const f = new SettingsPreservationHarness({ table: false }); try {
  const storage = f.createStorage(); await storage.initialize(); const before = f.canonicalCommits;
  assert.equal(await storage.kanbanOrder.replaceCellsIfCurrent('test-board', { cell: [] }, { cell: ['abc1234'] }, () => true), true);
  assert.equal(f.canonicalCommits, before + 1); assert.deepEqual(storage.kanbanOrder.getBoard('test-board'), { cell: ['abc1234'] });
  await storage.saveSettings(); assert.deepEqual((storage as any).dataPackageStore.getDataPackage().views.kanbanOrder.boards['test-board'], { cell: ['abc1234'] });
 } finally { await f.dispose(); }
});

test('queued unrelated save cannot overwrite a just-committed pool order', async () => {
 const f = new SettingsPreservationHarness({ table: false }); try {
  const storage = f.createStorage(); await storage.initialize(); let release!: () => void;
  const barrier = (storage as any).dataPackageStore.enqueueMutation(() => new Promise<void>(resolve => { release = resolve; }));
  await Promise.resolve(); await Promise.resolve();
  const pending = storage.kanbanOrder.replaceCellsIfCurrent('test-board', { cell: [] }, { cell: ['abc1234'] }, () => true);
  for (let i = 0; i < 5; i++) await Promise.resolve();
  const save = storage.saveSettings(); release(); await barrier; await pending; await save;
  assert.deepEqual((storage as any).dataPackageStore.getDataPackage().views.kanbanOrder.boards['test-board'], { cell: ['abc1234'] });
  assert.deepEqual(storage.kanbanOrder.getBoard('test-board'), { cell: ['abc1234'] });
 } finally { await f.dispose(); }
});

test('pool adapter resolves only owned live cells including nested cards and materializes virtual targets', () => {
 const f = fixture(); try {
  const pool = openTasks(f), view = f.view, board = f.board; board.addClass('operon-kanban-board');
  view.hasActiveKanbanDragInteraction = () => false;
  view.resolveCurrentPreset = () => ({ id: 'board-a' }); view.resolveKanbanDropBoardSignature = () => 'signature';
  view.indexer = { getTask: () => f.tasks[0] }; let materialized = 0, indicator = 0, clears = 0;
  view.clearManualDropIndicators = () => { clears++; }; view.materializeKanbanCellIfPending = () => { materialized++; }; view.hideCellQuickAdd = () => {};
  view.getColumnSorting = () => ({ sortMode: 'manual' });
  view.resolveManualDropBeforeTaskIdAt = (_cell: unknown, y: number, _preset: unknown, exclude: string) => { indicator++; assert.equal(y, 25); assert.equal(exclude, 'abc1230'); return 'next-task'; };
  view.lastRenderedBoard = { getTarget: () => ({ columns: { value: 'B' } }), getActionPlan: () => ({ state: 'ready', requirements: [], payload: {}, expectedFieldValues: {} }) };
  pool.surface.startPlacementDrag(event(), f.tasks[0], pool.list.children[0], async () => {}, () => {});
  const host = dragHost, cell = board.createDiv('operon-kanban-cell'); cell.dataset.kanbanStatusId = 'column'; cell.dataset.kanbanLaneKey = 'lane';
  let hit = cell.createDiv('operon-kanban-card').createSpan(); f.doc.elementFromPoint = () => hit;
  const target = host.target({ x: 20, y: 25 }, false);
  assert.equal(target.context.targetStatusId, 'column'); assert.equal(target.context.targetLaneKey, 'lane'); assert.equal(target.context.targetBeforeTaskId, 'next-task');
  assert.equal(target.context.sourceStatusId, null); assert.equal(materialized, 1); assert.equal(indicator, 1);
  for (const invalid of [board.createDiv('operon-kanban-column-header'), f.doc.body.createDiv('operon-canvas-task-pool'), f.doc.body.createDiv('operon-kanban-board').createDiv('operon-kanban-cell'), cell.createDiv('operon-kanban-cell-add-overlay')]) {
   hit = invalid; assert.equal(host.target({ x: 20, y: 25 }, false), null);
  }
  hit = cell; cell.addClass('is-collapsed'); assert.equal(host.target({ x: 20, y: 25 }, false), null); cell.removeClass('is-collapsed');
  view.lastRenderedBoard.getActionPlan = () => ({ state: 'blocked', reason: 'conflicting-axis-targets' }); assert.equal(host.target({ x: 20, y: 25 }, true), null);
  view.lastRenderedBoard.getActionPlan = () => ({ state: 'noop' }); assert.ok(host.target({ x: 20, y: 25 }, false));
  assert.ok(clears >= 7); assert.equal(host.isCurrent(), true);
  f.tasks[0].description = 'Changed while dragging'; assert.equal(host.isCurrent(), false);
 } finally { f.close(); }
});

function propertyFixture() {
 const f = fixture(), view = f.view; let writes = 0, dirty = 0, signature = 'board-a', hit: any;
 const bridge: any = { prepare: () => ({ id: 'abc1230', reason: null, label: 'A → B' }) };
 (f.services.preferences as any).tasks = bridge;
 view.callbacks = { onPropertyPoolApply: async (_plan: any, allowed: () => boolean) => { if (!allowed()) return { status: 'blocked' }; writes++; return { status: 'committed' }; } };
 view.cardOperations = new KanbanCardOperationRegistry();
 view.scheduleRender = () => {};
 view.requestActiveTaskNotePopoverClose = () => {}; view.markDirty = () => dirty++;
 view.resolveCurrentPreset = () => ({ id: 'board-a' }); view.resolveKanbanDropBoardSignature = () => signature;
 f.board.addClass('operon-kanban-board'); f.mount(); const pool = openProperties(f), drop = pool.drop;
 const cell = f.board.createDiv('operon-kanban-cell'), card = cell.createDiv('operon-kanban-card'); card.dataset.operonTaskId = 'abc1230';
 hit = card.createSpan(); f.doc.elementFromPoint = () => hit;
 const row = pool.list.createDiv('operon-canvas-property-pool-drag-surface');
 const pointer = (extra = {}) => event('', { target: row, currentTarget: row, buttons: 1, stopImmediatePropagation() {}, ...extra });
 const start = (extra = {}) => drop.start(pointer(extra), { key: 'priority', type: 'text', value: 'B', label: 'B' }, () => !!pool.panel && pool.current());
 const move = (extra = {}) => f.emit('pointermove', pointer({ clientX: 40, clientY: 40, ...extra }));
 const up = (extra = {}) => f.emit('pointerup', pointer({ clientX: 40, clientY: 40, ...extra }));
 return { ...f, pool, drop, bridge, card, cell, row, pointer, start, move, up,
  hit: (el: any) => { hit = el; }, changeSignature: () => { signature = 'changed'; }, stats: () => ({ active: Number(view.dragInteractionGate.isActive()), pending: Number(view.mobileDropPersistenceGate.isActive()), writes, dirty }) };
}
const settleProperty = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
for (const pinned of [false, true]) test(`property drop changes only the shown card and keeps pool state, pinned=${pinned}`, async () => {
 const f = propertyFixture(); try {
  f.pool.pinned = pinned; f.pool.query = f.pool.search.value = 'B'; f.pool.scope = 'priority'; f.pool.list.scrollTop = 93;
  const before = f.pool.capturePanelState(); f.start(); f.move(); assert.equal(f.card.classList.contains('is-property-drop-target'), true);
  f.up(); await settleProperty(); assert.equal(f.stats().writes, 1); assert.equal(f.stats().active, 0); assert.equal(f.stats().pending, 0);
  assert.deepEqual(f.pool.capturePanelState(), before); assert.equal(f.card.classList.contains('is-property-drop-target'), false);
 } finally { f.close(); }
});
test('property target accepts title/body children, rejects cell/background/other board/pool and duplicate IDs', () => {
 const f = propertyFixture(); try {
  const surface = f.drop.surface;
  for (const el of [f.card, f.card.createDiv(), f.card.createSpan()]) { f.hit(el); assert.equal(surface.targetAt(1, 1)?.taskId, 'abc1230'); }
  const other = f.doc.body.createDiv('operon-kanban-board').createDiv('operon-kanban-cell').createDiv('operon-kanban-card'); other.dataset.operonTaskId = 'abc1230';
  for (const el of [f.cell, f.board, f.pool.panel, other, f.board.createDiv('operon-kanban-column-header')]) { f.hit(el); assert.equal(surface.targetAt(1, 1), null); }
  f.hit(f.card); f.services.cards.resolve = () => ({ state: 'duplicate' }) as any; assert.equal(surface.targetAt(1, 1), null);
 } finally { f.close(); }
});
for (const invalid of ['cell', 'preset', 'board', 'card-recycled', 'source', 'Escape', 'second-pointer', 'panel']) test(`property gesture cancels without a write: ${invalid}`, async () => {
 const f = propertyFixture(); try {
  f.start(); f.move();
  if (invalid === 'cell') f.hit(f.cell);
  if (invalid === 'preset') f.changeSignature();
  if (invalid === 'board') f.setPreset('board-b');
  if (invalid === 'card-recycled') f.card.dataset.operonTaskId = 'abc1231';
  if (invalid === 'source') f.drop.invalidateSources();
  if (invalid === 'Escape') [...f.listeners.get('keydown')!].at(-1)!(f.pointer({ key: 'Escape' }));
  if (invalid === 'second-pointer') f.emit('pointerdown', f.pointer({ pointerId: 2 }));
  if (invalid === 'panel') f.pool.close();
  f.up(); await settleProperty(); assert.equal(f.stats().writes, 0); assert.equal(f.stats().active, 0);
  if (invalid !== 'panel' && invalid !== 'board') assert.ok(f.pool.panel);
 } finally { f.close(); }
});
test('property release never prepares an unseen card or awaits a late hover preview', async () => {
 const f = propertyFixture(); try {
  let resolve!: (value: any) => void, calls = 0;
  f.bridge.prepare = () => { calls++; return new Promise(r => { resolve = r; }); };
  f.start(); f.move(); f.up(); resolve({ id: 'abc1230', reason: null }); await settleProperty();
  assert.equal(calls, 1); assert.equal(f.stats().writes, 0); assert.equal(f.stats().active, 0);
 } finally { f.close(); }
});
for (const reason of ['already-present', 'workflow', 'reminder-past', 'unavailable']) test(`property preview reason ${reason} prevents persistence`, async () => {
 const f = propertyFixture(); try {
  f.bridge.prepare = () => ({ id: 'abc1230', reason }); f.start(); f.move(); f.up(); await settleProperty();
  assert.equal(f.stats().writes, 0); assert.ok(f.pool.panel); assert.equal(f.stats().active, 0);
 } finally { f.close(); }
});
test('property persistence holds the shared gesture gate until settlement, without retry', async () => {
 const f = propertyFixture(); try {
  let release!: (result: any) => void, calls = 0;
  f.view.callbacks.onPropertyPoolApply = () => { calls++; return new Promise(r => { release = r; }); };
  f.start(); f.move(); f.up(); assert.equal(f.stats().active, 1); assert.equal(f.stats().pending, 1);
  f.start(); assert.equal(calls, 1); release({ status: 'failed', uncertain: true }); await settleProperty();
  assert.equal(calls, 1); assert.equal(f.stats().active, 0); assert.equal(f.stats().pending, 0); assert.ok(f.pool.panel);
 } finally { f.close(); }
});
test('property panel snapshots preserve scope/query/selection/scroll/pin across a self-caused remount only', () => {
 const f = propertyFixture(); try {
  f.pool.query = f.pool.search.value = 'B'; f.pool.scope = 'priority'; f.pool.pinned = true; f.pool.list.scrollTop = 80;
  f.pool.selectedProperty = 'priority'; f.pool.selectedValue = { key: 'priority', value: 'B', label: 'B', type: 'text' };
  const state = f.view.pools.capturePropertyState(); f.view.clearPools();
  f.view.propertyPoolRestore = state;
  // Retain actual panel lifecycle but isolate value enumeration from this host fixture.
  const refresh = PropertyPool.prototype.refresh, position = PropertyPool.prototype.position;
  PropertyPool.prototype.refresh = () => {}; PropertyPool.prototype.position = () => {};
  try { const editor = f.doc.body.createDiv(); editor.focus(); f.view.mountPools(f.board, 'board-a'); assert.deepEqual(f.view.pools.capturePropertyState(), state); assert.equal(f.doc.activeElement, editor); }
  finally { PropertyPool.prototype.refresh = refresh; PropertyPool.prototype.position = position; }
  f.setPreset('board-b'); f.view.clearPools(); f.view.mountPools(f.board, 'board-b'); assert.equal(f.view.pools.capturePropertyState(), null);
 } finally { f.close(); }
});
test('property touch scroll does not activate; long press uses shared gesture and releases once', async () => {
 const f = propertyFixture(); try {
  f.start({ pointerType: 'touch' }); f.emitWindow('pointermove', f.pointer({ pointerType: 'touch', clientY: 100 })); f.emitWindow('pointerup', f.pointer({ pointerType: 'touch', clientY: 100 }));
  assert.equal(f.stats().active, 0); assert.equal(f.stats().writes, 0);
  f.start({ pointerType: 'touch' }); f.flush(); f.move({ pointerType: 'touch' }); f.up({ pointerType: 'touch' }); await settleProperty();
  assert.equal(f.stats().writes, 1); assert.equal(f.stats().active, 0);
 } finally { f.close(); }
});
test('property successful commit with refresh warning stays committed and releases ownership', async () => {
 const f = propertyFixture(); try {
  f.view.callbacks.onPropertyPoolApply = async () => ({ status: 'committed', warning: true });
  propertyNotices.length = 0; f.start(); f.move(); f.up(); await settleProperty();
  assert.deepEqual(propertyNotices, ['propertyPoolRefreshWarning']); assert.equal(f.stats().active, 0); assert.ok(f.pool.panel);
 } finally { f.close(); }
});

test('joint pools retain independent pinned state and prevent overlapping gesture admission', async () => {
 const f = propertyFixture(); try {
  const tasks = f.view.pools.children[0]; tasks.show(); tasks.pinned = true; tasks.query = 'Task'; tasks.list.scrollTop = 42;
  f.pool.pinned = true; f.pool.query = f.pool.search.value = 'B'; const propertyState = f.pool.capturePanelState();
  f.view.beginKanbanDragInteraction(); f.start(); assert.equal(f.drop.dragging, false); f.view.endKanbanDragInteraction();
  f.start(); f.move(); assert.equal(f.view.hasActiveKanbanDragInteraction(), true);
  let rejected = 0; dragHost = null;
  tasks.surface.startPlacementDrag(event(), f.tasks[0], tasks.list.children[0], async () => {}, () => rejected++);
  assert.equal(rejected, 1); assert.equal(dragHost, null);
  f.up(); await settleProperty(); assert.equal(f.view.hasActiveKanbanDragInteraction(), false);
  assert.ok(tasks.panel); assert.equal(tasks.query, 'Task'); assert.equal(tasks.list.scrollTop, 42); assert.deepEqual(f.pool.capturePanelState(), propertyState);
  // Task insertion uses the same gate, then leaves Property Pool available.
  let release!: (result: boolean) => void; f.view.callbacks.onPoolDrop = () => new Promise<boolean>(r => { release = r; });
  const placement = tasks.add({ isCurrent: () => true }, f.tasks[0].operonId, 'dragPlacement');
  f.start(); assert.equal(f.drop.dragging, false); release(true); await placement;
  assert.equal(f.view.hasActiveKanbanDragInteraction(), false); assert.ok(tasks.panel); assert.ok(f.pool.panel);
 } finally { f.close(); }
});
test('joint repeated panel/remount/gesture cleanup leaves no listener, timer, ghost or lease', async () => {
 const f = propertyFixture();
 for (let i = 0; i < 20; i++) {
  f.pool.show(); f.start(); f.move();
  if (i % 2) { f.up(); await settleProperty(); } else f.drop.cancel();
  f.pool.close(); f.flush();
  assert.equal(f.view.hasActiveKanbanDragInteraction(), false);
  assert.equal(f.doc.body.querySelectorAll('.operon-canvas-property-pool-drag').length, 0);
  assert.equal(f.card.classList.contains('is-property-drop-target'), false);
 }
 f.close(); f.flush();
 for (const callbacks of [...f.listeners.values(), ...f.windowListeners.values()]) assert.equal(callbacks.size, 0);
 assert.equal(f.timers.size, 0); assert.equal(f.favorites.size, 0); assert.equal(f.callbacks.size, 0);
 assert.equal(f.view.hasActiveKanbanDragInteraction(), false);
});

// Execute both native closures together, so a pending native gesture cannot release a pool's lease.
for (const mode of ['pending','scrolling','dragging']) test(`native ${mode} cleanup respects the actual gesture owner`, () => {
 const file='src/ui/kanban/kanban-view.ts', source=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
 const names=['cleanupMobileCardGesture','startMobileCardDrag'], bodies:string[]=[];
 const visit=(node:Typescript.Node)=>{if(ts.isVariableDeclaration(node)&&names.includes(node.name.getText(source)))bodies.push(`const ${node.getText(source)};`);ts.forEachChild(node,visit);};visit(source);assert.equal(bodies.length,2);
 const dom=statusDockDocument(), board=dom.doc.body.createDiv(), card=board.createDiv();let ended=0;
 const owner={draggedCardContext:{pool:true},hasActiveKanbanDragInteraction:()=>true,clearManualDropIndicators(){},endKanbanDragInteraction(){ended++;}};
 const gesture={mode,cardEl:card,ownerWindow:dom.doc.defaultView,pointerId:1,leaseGeneration:1,timerId:null,previewEl:null};
 const noop=()=>{};const deps:any={gridViewport:board,boardEl:board,getOwnerDocument:()=>dom.doc,clearMobileGestureTimer:noop,onMobileCardPointerMove:noop,onMobileCardPointerUp:noop,onMobileCardPointerCancel:noop,onMobileWindowBlur:noop,onMobileWindowScroll:noop,onMobileVisibilityChange:noop,onMobileCardLostPointerCapture:noop,stopMobileDragLoop:noop,stopVerticalDragAutoScroll:noop,clearMobileTouchDragActiveClass:noop,clearMobileDropTarget:noop,mobileTouchSessionFence:{cancel:noop},clearMobileCardHorizontalSettle:noop};
 const code=ts.transpileModule(`let mobileGesture=gesture;${bodies.join('\n')} return {cancel:()=>cleanupMobileCardGesture(true),activate:()=>startMobileCardDrag(gesture),current:()=>mobileGesture};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const closures=new Function('gesture',...Object.keys(deps),code).call(owner,gesture,...Object.values(deps));
 if(mode==='pending')closures.activate();else closures.cancel();
 assert.equal(closures.current(),null);assert.equal(ended,mode==='dragging'?1:0);assert.equal(owner.draggedCardContext===null,mode==='dragging');
});


test('Task Pool tooltip follows the actual cell plan and cleans up without writing', () => {
 const f = fixture(); taskPreviews.length = 0;
 try {
  const pool = openTasks(f), view = f.view, board = f.board; board.addClass('operon-kanban-board');
  view.getSettings = () => ({ ...f.services.cards.deps.getSettings(), kanbanPresets: [{ id: 'board-a' }] });
  view.hasActiveKanbanDragInteraction = () => false;
  view.resolveCurrentPreset = () => ({ id: 'board-a' }); view.resolveKanbanDropBoardSignature = () => 'signature';
  view.indexer = { getTask: () => f.tasks[0] };
  view.clearManualDropIndicators = () => {}; view.materializeKanbanCellIfPending = () => {}; view.hideCellQuickAdd = () => {};
  view.getColumnSorting = () => ({ sortMode: 'automatic' });
  let plan: any = { state: 'ready', requirements: [{ field: { label: 'Tier', reference: { source: 'managed', key: 'priority', type: 'text' }, encoding: 'legacy' }, target: { expected: { value: 'B' } }, value: 'A' }], payload: { priority: 'A' }, expectedFieldValues: { priority: 'B' } };
  view.lastRenderedBoard = { getTarget: () => ({}), getActionPlan: () => plan };
  pool.surface.startPlacementDrag(event(), f.tasks[0], pool.list.children[0], async () => {}, () => {});
  const host = dragHost, cell = board.createDiv('operon-kanban-cell'), anchor = f.doc.body.createDiv();
  cell.dataset.kanbanStatusId = 'column'; cell.dataset.kanbanLaneKey = 'lane'; let hit = cell;
  f.doc.elementFromPoint = () => hit;
  const point = { x: 20, y: 25 };
  assert.ok(host.target(point, false, anchor)); assert.equal(taskPreviews.at(-1)!.content, 'Tier: B → A');
  assert.equal(taskPreviews.at(-1)!.anchor, anchor);
  host.target(point, false, anchor); assert.equal(taskPreviews.length, 1); assert.equal(taskPreviews[0].positions, 1);
  plan = { state: 'blocked', reason: 'conflicting-axis-targets' };
  assert.equal(host.target(point, false, anchor), null); assert.equal(taskPreviews[0].closed, true);
  assert.equal(taskPreviews.at(-1)!.content, 'conflicting-axis-targets');
  hit = board; host.target(point, false, anchor); assert.equal(taskPreviews.at(-1)!.closed, true);
  hit = cell; plan = { state: 'noop' }; host.target(point, false, anchor);
  assert.ok(taskPreviews.at(-1)!.content.includes('No field changes'));
  host.finish(); assert.ok(taskPreviews.every(entry => entry.closed)); assert.equal(f.writes.length, 0);
 } finally { f.close(); }
});
