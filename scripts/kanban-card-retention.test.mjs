import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const viewSource = readFileSync(new URL('../src/ui/kanban/kanban-view.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('kanban-view.ts', viewSource, ts.ScriptTarget.Latest, true);
const viewClass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'KanbanView');
assert.ok(viewClass);
function method(name) {
 const node = viewClass.members.find(member => member.name?.getText(ast) === name);
 assert.ok(node, `Production method ${name} exists`);
 return node.getText(ast);
}
function productionFunction(file, name) {
 const source = readFileSync(new URL(`../src/systems/${file}.ts`, import.meta.url), 'utf8');
 const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
 const node = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
 assert.ok(node);
 const js = ts.transpileModule(node.getText(tree).replace(/^export /u, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
 return new Function(`${js}; return ${name};`)();
}
const compiled = await build({
 stdin: { contents: "export { buildKanbanTaskComparator } from './src/systems/kanban-query'; export { buildKanbanWritebackPlan } from './src/systems/kanban-writeback'; export { resolveKanbanEffectiveSorting } from './src/types/kanban'; export { buildOptimisticMovedTask, createKanbanDropOptimisticMove, KANBAN_OPTIMISTIC_MOVE_TTL_MS } from './src/systems/kanban-optimistic-move';", resolveDir: fileURLToPath(new URL('../', import.meta.url)) },
 bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent',
 alias: { obsidian: fileURLToPath(new URL('./test-support/obsidian.ts', import.meta.url)) },
});
const compiledModule = { exports: {} };
new Function('module', 'exports', 'require', compiled.outputFiles[0].text)(compiledModule, compiledModule.exports, createRequire(import.meta.url));
const cleanups = [];
const dependencies = {
 shouldApplyImmediateKanbanCardDrop: productionFunction('kanban-optimistic-move', 'shouldApplyImmediateKanbanCardDrop'),
 classifyKanbanDropCallbackSettlement: productionFunction('kanban-drag-interaction', 'classifyKanbanDropCallbackSettlement'),
 ...compiledModule.exports,
 splitTaskListValue: productionFunction('../core/task-field-patch', 'splitTaskListValue'),
 localNow: () => '2026-10-24T18:00:00',
 collectKanbanInPlaceChangedCellKeys: productionFunction('kanban-drop-transaction', 'collectKanbanInPlaceChangedCellKeys'),
 resolveKanbanCellInitialRenderLimit: productionFunction('kanban-cell-materialization', 'resolveKanbanCellInitialRenderLimit'),
 buildKanbanCellKey: (status, lane) => `${status}::${lane}`,
 buildKanbanDropBoardSignature: () => 'board-sig',
 buildKanbanTaskStableSignature: task => task.signature,
 buildKanbanTaskVolatileSignature: () => '',
 stripFilterViewOnlyOptions: value => value,
 createCompactTaskLookup: () => ({}),
 buildWorkflowStatusIdentityIndex: () => ({}),
 cleanupOperonHoverTooltips: node => cleanups.push(node),
 estimateKanbanCellPlaceholderHeightPx: () => 200,
 KANBAN_CARD_RENDER_BATCH_SIZE: 32,
 KANBAN_ESTIMATED_CARD_HEIGHT_PX: 100,
 KANBAN_ESTIMATED_CARD_GAP_PX: 8,
};
const methodNames = ['applyKanbanBoardPatchInPlace', 'createKanbanCellMaterializer', 'renderInitialCellTasks', 'renderTaskCardBatch', 'areStringArraysEqual', 'refreshKanbanTasksInPlace', 'settleKanbanDropDomInPlace', 'buildKanbanBoardTaskSignatures', 'resolveImmediateKanbanDropBeforeTaskId', 'applyImmediateCardDrop', 'completeKanbanCardDrop', 'renderCornerSummary'];
const code = ts.transpileModule(`class Subject { ${methodNames.filter(name => viewClass.members.some(member => member.name?.getText(ast) === name)).map(method).join('\n')} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const Subject = new Function(...Object.keys(dependencies), `${code}; return Subject;`)(...Object.values(dependencies));

// A small DOM model records removals and moves; assertions exercise production
// reconciliation methods rather than a second implementation of retention.
class Node {
 constructor(kind, dataset = {}, ownerDocument = {}) {
  this.kind = kind; this.dataset = { ...dataset }; this.ownerDocument = ownerDocument;
  this.children = []; this.parentElement = null; this.removals = 0; this.moves = 0; this.scrollTop = 25;
  this.classes = new Set();
  this.classList = { contains: name => this.classes.has(name), toggle: (name, active) => active ? this.classes.add(name) : this.classes.delete(name) };
  this.style = { removeProperty() {} };
 }
 get isConnected() { return this.parentElement !== null || this.kind === 'board'; }
 get nextElementSibling() { const siblings = this.parentElement?.children ?? []; return siblings[siblings.indexOf(this) + 1] ?? null; }
 appendChild(child) { return this.insertBefore(child, null); }
 insertBefore(child, before) {
  if (child === before) return child;
  if (child.parentElement) {
   const siblings = child.parentElement.children;
   siblings.splice(siblings.indexOf(child), 1); child.moves++;
  }
  const index = before ? this.children.indexOf(before) : this.children.length;
  assert.ok(index >= 0); this.children.splice(index, 0, child); child.parentElement = this; return child;
 }
 remove() {
  if (this.parentElement) { const siblings = this.parentElement.children; siblings.splice(siblings.indexOf(this), 1); this.removals++; this.parentElement = null; }
 }
 empty() { for (const child of [...this.children]) child.remove(); }
 closest(selector) {
  if (selector === '.operon-kanban-row') return this.row ?? null;
  for (let node = this; node; node = node.parentElement) if (selector === `.operon-kanban-${node.kind}`) return node;
  return null;
 }
 addClass(...names) { for (const name of names) this.classes.add(name); }
 removeClass(...names) { for (const name of names) this.classes.delete(name); }
 setAttr(key, value) { this[key] = value; }
 removeAttribute(key) { delete this[key]; }
 querySelectorAll(selector) {
  if (selector === ':scope > .operon-kanban-card') return this.children.filter(child => child.kind === 'card');
  if (selector === '.operon-kanban-cell') return this.children.filter(child => child.kind === 'cell');
  return [];
 }
 querySelector(selector) {
  if (selector === '.operon-kanban-grid-viewport') return this.viewport;
  if (selector === ':scope > .operon-kanban-lane-label') return this.label;
  return this.querySelectorAll(selector)[0] ?? null;
 }
}
const task = (id, signature = id) => ({ operonId: id, signature, description: id, datetimeModified: '', tags: [], checkbox: 'open', fieldValues: {} });
const ids = cell => cell.querySelectorAll(':scope > .operon-kanban-card').map(card => card.dataset.operonTaskId);
const cardById = (cell, id) => cell.querySelectorAll(':scope > .operon-kanban-card').find(card => card.dataset.operonTaskId === id);
function fixture(sourceIds = ['a', 'b', 'c'], targetIds = ['d'], windowName = 'main') {
 cleanups.length = 0;
 const doc = { windowName };
 const boardEl = new Node('board', {}, doc), viewport = new Node('viewport', {}, doc), row = new Node('row', {}, doc);
 boardEl.viewport = viewport; boardEl.appendChild(viewport); viewport.appendChild(row); row.label = new Node('label', {}, doc);
 const cells = new Map();
 for (const [status, entries] of [['source', sourceIds], ['target', targetIds]]) {
  const cell = new Node('cell', { kanbanStatusId: status, kanbanLaneKey: 'lane', kanbanVisibleCount: String(entries.length) }, doc);
  cell.row = row; row.appendChild(cell); cells.set(status, cell);
  for (const id of entries) cell.appendChild(new Node('card', { operonTaskId: id, kanbanStatusId: status, kanbanLaneKey: 'lane', kanbanPreview: 'false' }, doc));
 }
 function board(source, target) {
  return { get relevantTasks() { return [...this.cellMap.values()].flat(); }, columns: [{ statusId: 'source' }, { statusId: 'target' }], lanes: [{ key: 'lane' }], pipeline: {}, preset: {},
   cellMap: new Map([['source::lane', source.map(id => typeof id === 'string' ? task(id) : id)], ['target::lane', target.map(id => typeof id === 'string' ? task(id) : id)]]),
   cellCountMap: new Map([['source::lane', source.length], ['target::lane', target.length]]) };
 }
 const subject = new Subject(); const renders = [], measurements = [], lazy = [], scrollRestores = [];
 const settings = { kanbanMaxVisibleTasksPerCell: 5, pipelines: [] };
 Object.assign(subject, {
  ensureState: () => ({ expandedPreviewParentIds: [] }), buildDescendantSummary: () => ({ done: 0, open: 1, total: 1 }),
  pendingCellMaterializers: new Map(), optimisticMoves: new Map(), indexer: { getAllTasks: () => [], secondary: { getChildIds: () => new Set(), getAllDescendantIds: () => new Set() } }, getSettings: () => settings,
  captureCellScrollStates() {}, resolveCollapsedStatusIds: () => new Set(), resolveCollapsedLaneKeys: () => new Set(),
  findKanbanCell: (_board, status) => cells.get(status), findKanbanRow: () => row,
  unobserveKanbanCellContent(cell) { for (const child of [...cell.children]) if (child.kind === 'sentinel') child.remove(); },
  clearCellQuickAdd(cell) { for (const child of [...cell.children]) if (child.kind === 'overlay') child.remove(); },
  bindCellQuickAdd(cell) { cell.appendChild(new Node('overlay', {}, doc)); },
  renderCollapsedCellSummary(cell) { cell.empty(); cell.appendChild(new Node('summary', {}, doc)); },
  getPendingCellScrollTop: () => 0,
  renderTaskCard(cell, entry, _pipeline, _preset, status, lane) {
   renders.push(entry.operonId);
   return cell.appendChild(new Node('card', { operonTaskId: entry.operonId, kanbanStatusId: status, kanbanLaneKey: lane, kanbanPreview: 'false' }, doc));
  },
  measureCellHeightLimitPx(cell) { measurements.push(`measure:${cell.dataset.kanbanStatusId}`); return 500; },
  commitCellHeightLimit(cell) { measurements.push(`commit:${cell.dataset.kanbanStatusId}`); },
  attachCellLazySentinel(cell, entries) { lazy.push({ cell, entries, start: Number(cell.dataset.kanbanVisibleCount) }); cell.appendChild(new Node('sentinel', {}, doc)); },
  restoreCellScrollIfPending(cell) { scrollRestores.push(cell); },
  updateKanbanBoardCounts() {}, syncRowCellHeights() {}, syncLaneHeights() {},
 });
 const previous = board(sourceIds, targetIds);
 function signatures(data) { return subject.buildKanbanBoardTaskSignatures({ ...data, relevantTasks: [...data.cellMap.values()].flat() }); }
 function patch(next, context = { taskId: 'a', sourceStatusId: 'source', targetStatusId: 'target', sourceLaneKey: 'lane', targetLaneKey: 'lane' }, before = previous) {
  const result = subject.applyKanbanBoardPatchInPlace(boardEl, before, next, signatures(before), signatures(next), context, {}, settings, false);
  assert.equal(result, true); return result;
 }
 function immediateMove(id = 'a', beforeId = null) {
  const card = cardById(cells.get('source'), id); card.dataset.kanbanStatusId = 'target';
  cells.get('target').insertBefore(card, beforeId ? cardById(cells.get('target'), beforeId) : null); return card;
 }
 return { subject, settings, signatures, cells, boardEl, previous, board, patch, immediateMove, renders, measurements, lazy, scrollRestores };
}

for (const owner of ['main', 'pop-out']) test(`drop retains untouched source and target cards in ${owner}`, () => {
 const f = fixture(undefined, undefined, owner), source = f.cells.get('source'), target = f.cells.get('target');
 const b = cardById(source, 'b'), c = cardById(source, 'c'), d = cardById(target, 'd');
 const moved = f.immediateMove();
 f.patch(f.board(['b', 'c'], [task('a', 'new-status'), 'd']));
 assert.equal(cardById(source, 'b'), b); assert.equal(cardById(source, 'c'), c); assert.equal(cardById(target, 'd'), d);
 assert.equal(b.removals + c.removals + d.removals, 0); assert.equal(b.moves + c.moves + d.moves, 0);
 assert.notEqual(cardById(target, 'a'), moved); assert.deepEqual(ids(source), ['b', 'c']); assert.deepEqual(ids(target), ['a', 'd']);
 assert.deepEqual(f.renders, ['a']); assert.equal(cleanups.includes(b), false);
 assert.equal(b.ownerDocument.windowName, owner);
 assert.deepEqual(f.measurements, ['measure:target', 'measure:source', 'commit:target', 'commit:source']);
 assert.equal(f.scrollRestores.length, 2);
});

test('a concurrently changed remaining card refreshes while its untouched neighbor survives', () => {
 const f = fixture(), source = f.cells.get('source'), b = cardById(source, 'b'), c = cardById(source, 'c');
 f.immediateMove(); f.patch(f.board([task('b', 'edited'), 'c'], [task('a', 'new-status'), 'd']));
 assert.notEqual(cardById(source, 'b'), b); assert.equal(cardById(source, 'c'), c);
 assert.equal(b.removals, 1); assert.ok(cleanups.includes(b)); assert.equal(c.removals, 0);
});

for (const result of ['cancelled', 'failed']) test(`${result} drop restores membership without replacing neighbors`, () => {
 const f = fixture(), source = f.cells.get('source'), target = f.cells.get('target');
 const b = cardById(source, 'b'), d = cardById(target, 'd'); f.immediateMove(); f.patch(f.previous);
 assert.deepEqual(ids(source), ['a', 'b', 'c']); assert.deepEqual(ids(target), ['d']);
 assert.equal(cardById(source, 'b'), b); assert.equal(cardById(target, 'd'), d);
 assert.equal(ids(source).filter(id => id === 'a').length, 1);
});

test('same-cell manual sorting keeps untouched DOM cards and updates order', () => {
 const f = fixture(), source = f.cells.get('source'), b = cardById(source, 'b'), c = cardById(source, 'c');
 f.patch(f.board(['b', 'c', 'a'], ['d']), { taskId: 'a', sourceStatusId: 'source', targetStatusId: 'source', sourceLaneKey: 'lane', targetLaneKey: 'lane' });
 assert.deepEqual(ids(source), ['b', 'c', 'a']); assert.equal(cardById(source, 'b'), b); assert.equal(cardById(source, 'c'), c);
});

test('recurrence replacement removes the old task and renders its successor once', () => {
 const f = fixture(), b = cardById(f.cells.get('source'), 'b'); f.immediateMove();
 f.patch(f.board(['b', 'c', 'successor'], ['d']));
 assert.equal(cardById(f.cells.get('source'), 'b'), b);
 assert.deepEqual(ids(f.cells.get('source')), ['b', 'c', 'successor']); assert.deepEqual(ids(f.cells.get('target')), ['d']);
});

for (const position of ['head', 'middle', 'tail']) test(`lazy target ${position} insertion retains loaded cards and next batch stays unique`, () => {
 const targetIds = Array.from({ length: 100 }, (_, index) => `t${index}`), f = fixture(['a', 'b'], targetIds);
 const target = f.cells.get('target');
 for (const card of [...target.children].slice(64)) card.remove(); target.dataset.kanbanVisibleCount = '64';
 const retained = [...target.children];
 const insertion = position === 'head' ? 0 : position === 'middle' ? 20 : 64;
 f.immediateMove('a', targetIds[insertion]); const nextIds = [...targetIds]; nextIds.splice(insertion, 0, 'a');
 f.patch(f.board(['b'], nextIds.map(id => id === 'a' ? task(id, 'moved') : id)));
 for (const card of retained) assert.equal(cardById(target, card.dataset.operonTaskId), card);
 const count = Number(target.dataset.kanbanVisibleCount);
 assert.equal(count, ids(target).length); assert.equal(count, 65);
 assert.deepEqual(ids(target), nextIds.slice(0, count));
 const pending = f.lazy.find(entry => entry.cell === target); assert.ok(pending);
 const sentinel = target.children.find(child => child.kind === 'sentinel');
 f.subject.renderTaskCardBatch(target, pending.entries, count, Math.min(count + 32, nextIds.length), {}, {}, 'target', 'lane', [], {}, {}, false, sentinel);
 const renderedIds = ids(target); assert.equal(new Set(renderedIds).size, renderedIds.length);
 assert.deepEqual(renderedIds, nextIds.slice(0, count + 32));
});

test('lazy source settlement keeps the materialized depth and does not resurrect the moved task', () => {
 const sourceIds = ['a', ...Array.from({ length: 99 }, (_, index) => `s${index}`)], f = fixture(sourceIds, ['d']);
 const source = f.cells.get('source'); for (const card of [...source.children].slice(64)) card.remove(); source.dataset.kanbanVisibleCount = '64';
 const retained = source.children.slice(1); f.immediateMove(); f.patch(f.board(sourceIds.slice(1), [task('a', 'moved'), 'd']));
 for (const card of retained) assert.equal(cardById(source, card.dataset.operonTaskId), card);
 assert.equal(ids(source).length, Number(source.dataset.kanbanVisibleCount)); assert.equal(cardById(source, 'a'), undefined);
});

test('collapsed cells retain their summary behavior', () => {
 const f = fixture(); f.subject.resolveCollapsedStatusIds = () => new Set(['source']); f.immediateMove();
 f.patch(f.board(['b', 'c'], [task('a', 'moved'), 'd']));
 assert.deepEqual(ids(f.cells.get('source')), []); assert.equal(f.cells.get('source').children[0].kind, 'summary');
});

test('unmaterialized cells stay deferred and use the latest tasks on reveal', () => {
 const f = fixture(), source = f.cells.get('source'); source.empty(); f.subject.pendingCellMaterializers.set(source, () => {});
 f.patch(f.board(['b', 'c'], ['d'])); assert.equal(f.renders.length, 0); assert.deepEqual(ids(source), []);
 const finalizer = f.subject.pendingCellMaterializers.get(source)(); finalizer.measure(); finalizer.commit(); assert.deepEqual(ids(source), ['b', 'c']);
});

test('ordinary late saves preserve unchanged cards instead of rebuilding the board', () => {
 const f = fixture(), source = f.cells.get('source'), b = cardById(source, 'b');
 f.patch(f.previous, null); assert.equal(cardById(source, 'b'), b); assert.equal(b.removals, 0); assert.deepEqual(f.renders, []); assert.deepEqual(f.measurements, []);
});

for (const relation of ['blocking', 'blockedBy', 'parentTask', 'subtasks', 'children']) test(`${relation} cards refresh outside the moved cells without replacing their unrelated neighbor`, () => {
 const f = fixture(), source = f.cells.get('source'), other = new Node('cell', { kanbanStatusId: 'other', kanbanLaneKey: 'lane', kanbanVisibleCount: '2' });
 other.row = source.row; source.row.appendChild(other); f.cells.set('other', other);
 const dependent = task('related'); if (relation !== 'children') dependent.fieldValues[relation] = 'a';
 if (relation === 'children' || relation === 'subtasks') { f.subject.indexer.secondary.getAllDescendantIds = id => new Set(id === 'related' ? ['a'] : []); f.subject.ensureState = () => ({ expandedPreviewParentIds: ['related'] }); }
 const old = new Node('card', { operonTaskId: 'related', kanbanStatusId: 'other', kanbanLaneKey: 'lane', kanbanPreview: 'false' });
 const neighbor = new Node('card', { operonTaskId: 'unchanged', kanbanStatusId: 'other', kanbanLaneKey: 'lane', kanbanPreview: 'false' });
 other.appendChild(old); other.appendChild(neighbor);
 const renamed = task('a', 'moved'); renamed.description = 'Renamed A';
 const next = f.board(['b', 'c'], [renamed, 'd']);
 for (const board of [f.previous, next]) {
  board.columns.push({ statusId: 'other' }); board.cellMap.set('other::lane', [dependent, task('unchanged')]); board.cellCountMap.set('other::lane', 2);
 }
 f.immediateMove(); f.patch(next);
 assert.notEqual(cardById(other, 'related'), old); assert.equal(old.removals, 1); assert.equal(cardById(other, 'unchanged'), neighbor);
});

function pendingRefreshFixture() {
 const f = fixture(); f.subject.lastRenderedBoard = f.previous; f.subject.lastRenderedBoardScope = 'scope';
 f.subject.lastRenderSignature = JSON.stringify({ tasks: 'before', controls: 'same' });
 f.subject.buildDropScrollAnchorScope = () => 'scope';
 f.subject.optimisticMoves = new Map([['a', { kind: 'drop', operationId: 'pending-a', taskId: 'a' }]]);
 f.subject.cardOperations = { isTaskPending: () => true };
 f.subject.contentEl = f.boardEl;
 f.subject.contentEl.querySelector = selector => selector === '.operon-kanban-board' ? f.boardEl : selector === '.operon-kanban-grid-viewport' ? f.boardEl.viewport : null;
 f.subject.queryKanbanBoardData = () => { throw new Error('pending drop must defer the task query'); };
 return f;
}

test('task-only notifications during pending desktop persistence retain the old DOM until settlement', () => {
 const f = pendingRefreshFixture(), b = cardById(f.cells.get('source'), 'b'); f.immediateMove();
 const baseline = f.subject.lastRenderSignature;
 for (let notification = 0; notification < 3; notification++) {
  assert.equal(f.subject.refreshKanbanTasksInPlace(JSON.stringify({ tasks: `new-${notification}`, controls: 'same' }), {}, {}, {}, null, {}, null), true);
  assert.equal(cardById(f.cells.get('source'), 'b'), b); assert.equal(f.subject.lastRenderSignature, baseline);
 }
 f.patch(f.board(['b', 'c'], [task('a', 'moved'), 'd'])); assert.equal(cardById(f.cells.get('source'), 'b'), b);
});

test('pending drops do not defer changed settings or controls', () => {
 const f = pendingRefreshFixture();
 assert.equal(f.subject.refreshKanbanTasksInPlace(JSON.stringify({ tasks: 'new', controls: 'changed' }), {}, {}, {}, null, {}, null), false);
});

test('settled operations and status-click operations do not defer ordinary saves', () => {
 for (const state of ['settled', 'status']) {
  const f = pendingRefreshFixture();
  if (state === 'settled') f.subject.cardOperations.isTaskPending = () => false;
  else f.subject.optimisticMoves.get('a').kind = 'status';
  let queries = 0; f.subject.queryKanbanBoardData = () => { queries++; return { board: { columns: [], lanes: [] } }; };
  assert.equal(f.subject.refreshKanbanTasksInPlace(JSON.stringify({ tasks: 'new', controls: 'same' }), {}, {}, {}, null, {}, null), false);
  assert.equal(queries, 1);
 }
});

for (const axis of ['status', 'lane']) test(`drop settlement falls back to the full render when auto-collapse changes ${axis} geometry`, () => {
 const f = pendingRefreshFixture(), next = f.board(['b', 'c'], ['a', 'd']);
 const preset = { id: 'preset', pipelineId: 'pipeline' }, pipeline = { id: 'pipeline' };
 f.subject.ensureState = () => ({ presetId: 'preset', searchQuery: '' });
 f.subject.getSettings = () => ({ kanbanPresets: [preset], pipelines: [pipeline] });
 f.subject.deleteOptimisticMove = () => true;
 f.subject.resolveEditableKanbanFilter = () => null;
 f.subject.buildParentSearchUiState = () => null;
 f.subject.queryKanbanBoardData = () => ({ board: next, searchActive: false });
 f.subject.resolveCollapsedStatusIds = board => new Set(axis === 'status' && board === next ? ['source'] : []);
 f.subject.resolveCollapsedLaneKeys = board => new Set(axis === 'lane' && board === next ? ['lane'] : []);
 f.boardEl.dataset.kanbanDropBoardSignature = 'board-sig';
 assert.equal(f.subject.settleKanbanDropDomInPlace(f.previous, 'scope', new Map(), { taskId: 'a', presetId: 'preset', boardSignature: 'board-sig' }, 'operation'), false);
});

for (const [change, beforeProgress, afterProgress] of [
 ['added', undefined, { total: 2, completed: 0 }],
 ['updated', { total: 2, completed: 0 }, { total: 2, completed: 1 }],
 ['removed', { total: 2, completed: 1 }, undefined],
]) test(`plain checkbox progress ${change} refreshes its card and preserves its unchanged neighbor`, () => {
 const f = fixture(), source = f.cells.get('source'), old = cardById(source, 'b'), neighbor = cardById(source, 'c');
 f.previous.cellMap.get('source::lane').find(task => task.operonId === 'b').plainCheckboxProgress = beforeProgress;
 const updated = task('b'); updated.plainCheckboxProgress = afterProgress;
 const next = f.board([updated, 'c'], [task('a', 'moved'), 'd']);
 f.immediateMove(); f.patch(next);
 assert.notEqual(cardById(source, 'b'), old); assert.equal(cardById(source, 'c'), neighbor);
});

test('unchanged checkbox progress does not rebuild an otherwise unchanged card', () => {
 const f = fixture(), source = f.cells.get('source'), old = cardById(source, 'b');
 f.previous.cellMap.get('source::lane').find(task => task.operonId === 'b').plainCheckboxProgress = { total: 2, completed: 1 };
 const unchanged = task('b'); unchanged.plainCheckboxProgress = { total: 2, completed: 1 };
 f.immediateMove(); f.patch(f.board([unchanged, 'c'], [task('a', 'moved'), 'd']));
 assert.equal(cardById(source, 'b'), old);
});

function sortedFixture(field = 'alphabetical', direction = 'asc', override = null) {
 const f = fixture(['moved', 'source-keep'], ['first', 'last']);
 const pipeline = { id: 'pipeline', name: 'Work', statuses: [{ id: 'source', label: 'Source' }, { id: 'target', label: 'Target' }] };
 const preset = { id: 'preset', pipelineId: 'pipeline', sortMode: 'automatic', sortRules: [{ field, direction, empty: 'last' }], columnSortOverrides: override ? [override] : [] };
 f.settings.pipelines = [pipeline]; f.settings.priorities = [{ label: 'High' }, { label: 'Normal' }, { label: 'Low' }]; f.settings.keyMappings = [];
 const tasks = new Map(['moved', 'source-keep', 'first', 'last'].map(id => [id, { ...task(id), fieldValues: { status: 'Work > Source' } }]));
 tasks.get('moved').description = 'Middle'; tasks.get('first').description = direction === 'asc' ? 'Alpha' : 'Zulu'; tasks.get('last').description = direction === 'asc' ? 'Zulu' : 'Alpha';
 f.subject.indexer.getTask = id => tasks.get(id); f.subject.indexer.getAllTasks = () => [...tasks.values()]; f.subject.callbacks = {};
 const context = { taskId: 'moved', presetId: 'preset', boardSignature: 'board-sig', sourceStatusId: 'source', targetStatusId: 'target', sourceLaneKey: 'lane', targetLaneKey: 'lane', swimlaneBy: null, targetBeforeTaskId: null };
 f.subject.lastRenderedBoard = { ...f.previous, pipeline, preset, columns: [{ statusId: 'source', statusValue: 'Work > Source' }, { statusId: 'target', statusValue: 'Work > Target' }] };
 return { ...f, tasks, pipeline, preset, context };
}

for (const direction of ['asc', 'desc']) test(`automatic alphabetical ${direction} resolves the target slot synchronously`, () => {
 const f = sortedFixture('alphabetical', direction);
 assert.equal(f.subject.resolveImmediateKanbanDropBeforeTaskId(f.cells.get('target'), f.context, f.preset), 'last');
});

test('numeric sorting and a target-column override use the same comparator as the board', () => {
 const f = sortedFixture('alphabetical', 'desc', { statusId: 'target', sortMode: 'automatic', sortRules: [{ field: 'estimate', direction: 'asc', empty: 'last' }] });
 for (const [id, value] of [['first', '1'], ['moved', '5'], ['last', '9']]) f.tasks.get(id).fieldValues.estimate = value;
 assert.equal(f.subject.resolveImmediateKanbanDropBeforeTaskId(f.cells.get('target'), f.context, f.preset), 'last');
});

test('date-lane changes are projected before the target slot is chosen, without changing indexed data', () => {
 const f = sortedFixture('dateDue'); f.context.swimlaneBy = 'dateDue'; f.context.sourceLaneKey = '2026-10-01'; f.context.targetLaneKey = '2026-10-25';
 for (const [id, date] of [['first', '2026-10-20'], ['moved', '2026-10-01'], ['last', '2026-10-30']]) f.tasks.get(id).fieldValues.dateDue = date;
 assert.equal(f.subject.resolveImmediateKanbanDropBeforeTaskId(f.cells.get('target'), f.context, f.preset), 'last');
 assert.equal(f.tasks.get('moved').fieldValues.dateDue, '2026-10-01');
});

test('modified-time sorting projects the pending save time immediately', () => {
 const f = sortedFixture('datetimeModified', 'desc');
 f.tasks.get('first').datetimeModified = '2025-01-01T00:00:00'; f.tasks.get('last').datetimeModified = '2020-01-01T00:00:00'; f.tasks.get('moved').datetimeModified = '2019-01-01T00:00:00';
 assert.equal(f.subject.resolveImmediateKanbanDropBeforeTaskId(f.cells.get('target'), f.context, f.preset), 'first');
 assert.equal(f.tasks.get('moved').datetimeModified, '2019-01-01T00:00:00');
});

test('manual target ordering keeps the explicit user-selected insertion point', () => {
 const f = sortedFixture(); f.preset.columnSortOverrides = [{ statusId: 'target', sortMode: 'manual', sortRules: [] }]; f.context.targetBeforeTaskId = 'last';
 assert.equal(f.subject.resolveImmediateKanbanDropBeforeTaskId(f.cells.get('target'), f.context, f.preset), 'last');
});

test('project-serial sorting uses the configured display callback at drop time', () => {
 const f = sortedFixture('projectSerial'); const ranks = { first: 1, moved: 2, last: 3 };
 f.subject.callbacks.getProjectSerialDisplay = id => ({ scopePrefix: 'PROJ', number: ranks[id] });
 assert.equal(f.subject.resolveImmediateKanbanDropBeforeTaskId(f.cells.get('target'), f.context, f.preset), 'last');
});

test('drop orders the target before persistence resolves and preserves both neighbors', async () => {
 const f = sortedFixture(), target = f.cells.get('target'), first = cardById(target, 'first'), last = cardById(target, 'last');
 let finish, callbackStarted = false, ended = false, settled = false;
 const persistence = new Promise(resolve => { finish = resolve; });
 Object.assign(f.subject, {
  lastRenderedBoard: f.subject.lastRenderedBoard, lastRenderedBoardScope: 'scope', lastRenderedBoardTaskSignatures: f.signatures(f.previous),
  containerEl: f.boardEl,
  callbacks: { onCardDrop() { callbackStarted = true; return persistence; } },
  cardOperations: { begin: () => ({ id: 'operation', boardSignature: 'board-sig' }), owns: () => true, isUiCurrent: () => true, end: () => { ended = true; return true; } },
  beginDropScrollAnchor: () => ({}), materializeKanbanCellIfPending() {}, clearManualDropIndicator() {},
  registerOptimisticMove() {}, applyCellHeightLimit() {}, scheduleBoardViewportAnchorRestore() {},
  resolveCurrentPreset: () => f.preset, resolveKanbanDropBoardSignature: () => 'board-sig',
  settleKanbanDropDomInPlace() { settled = true; return true; },
  settleDropViewportAnchor() {}, clearDropPendingCardState() {}, endKanbanDragInteraction() {},
 });
 const moving = cardById(f.cells.get('source'), 'moved');
 f.subject.completeKanbanCardDrop(target, { cardEl: moving }, f.context, null, f.preset);
 assert.deepEqual(ids(target), ['first', 'moved', 'last']); assert.equal(callbackStarted, false); assert.equal(settled, false);
 assert.equal(cardById(target, 'first'), first); assert.equal(cardById(target, 'last'), last); assert.equal(first.removals + last.removals, 0);
 await Promise.resolve(); assert.equal(callbackStarted, true); assert.equal(settled, false);
 finish('committed'); await new Promise(resolve => setImmediate(resolve)); assert.equal(settled, true); assert.equal(ended, true);
});

test('unrelated dependency cards and cells are not patched by a normal drop', () => {
 const f = fixture(), other = new Node('cell', { kanbanStatusId: 'other', kanbanLaneKey: 'lane', kanbanVisibleCount: '1' });
 other.row = f.cells.get('source').row; other.row.appendChild(other); f.cells.set('other', other);
 const unrelated = task('unrelated'); unrelated.fieldValues.blockedBy = 'd';
 const node = new Node('card', { operonTaskId: 'unrelated', kanbanStatusId: 'other', kanbanLaneKey: 'lane', kanbanPreview: 'false' }); other.appendChild(node);
 const next = f.board(['b', 'c'], [task('a', 'moved'), 'd']);
 for (const data of [f.previous, next]) { data.columns.push({ statusId: 'other' }); data.cellMap.set('other::lane', [unrelated]); data.cellCountMap.set('other::lane', 1); }
 f.immediateMove(); f.patch(next);
 assert.equal(cardById(other, 'unrelated'), node); assert.equal(node.moves + node.removals, 0);
 assert.equal(f.measurements.some(entry => entry.endsWith(':other')), false);
});

test('late save notification after settlement is a DOM no-op when the board content is unchanged', () => {
 const f = pendingRefreshFixture(), next = f.board(['b', 'c'], [task('a', 'moved'), 'd']); f.immediateMove(); f.patch(next);
 const renders = f.renders.length, measured = f.measurements.length;
 Object.assign(f.subject, {
  optimisticMoves: new Map(), lastRenderedBoard: next, lastRenderedBoardTaskSignatures: f.signatures(next),
  queryKanbanBoardData: () => ({ board: next, searchActive: false }),
  buildRenderSignature: () => JSON.stringify({ tasks: 'saved', controls: 'same' }), restoreBoardViewportAnchor() {},
 });
 assert.equal(f.subject.refreshKanbanTasksInPlace(JSON.stringify({ tasks: 'late-notification', controls: 'same' }), {}, {}, {}, null, f.settings, null), true);
 assert.equal(f.renders.length, renders); assert.equal(f.measurements.length, measured);
});

for (const change of ['renamed', 'removed', 'added']) test(`an off-board dependency ${change} updates only the dependent card`, () => {
 const f = fixture(), source = f.cells.get('source'), old = cardById(source, 'b'), neighbor = cardById(source, 'c');
 const dependent = f.previous.cellMap.get('source::lane').find(task => task.operonId === 'b'); dependent.fieldValues.blockedBy = 'outside';
 let external = change === 'added' ? [] : [task('outside', 'before')];
 f.subject.indexer.getAllTasks = () => external;
 const beforeSignatures = f.signatures(f.previous);
 external = change === 'removed' ? [] : [{ ...task('outside', 'after'), description: 'Renamed outside' }];
 const result = f.subject.applyKanbanBoardPatchInPlace(f.boardEl, f.previous, f.previous, beforeSignatures, f.signatures(f.previous), null, {}, f.settings, false);
 assert.equal(result, true); assert.notEqual(cardById(source, 'b'), old); assert.equal(cardById(source, 'c'), neighbor);
 assert.deepEqual(f.renders, ['b']);
});


test('the board total keeps its existing DOM when a move does not change the count', () => {
 const f = fixture(); let clears = 0, created = 0;
 const total = { textContent: '4' };
 const corner = { querySelector: () => total, empty() { clears++; }, createDiv(options) { created++; total.textContent = options.text; } };
 f.subject.renderCornerSummary(corner, 4); assert.equal(clears, 0); assert.equal(created, 0);
 f.subject.renderCornerSummary(corner, 3); assert.equal(clears, 1); assert.equal(created, 1); assert.equal(total.textContent, '3');
});


test('a second pending drop compares against the first card projected completion date', () => {
 const f = sortedFixture('dateCompleted', 'desc'); f.pipeline.statuses.find(status => status.id === 'target').isFinished = true;
 f.tasks.get('first').description = 'Alpha'; f.tasks.get('moved').description = 'Middle'; f.tasks.get('last').fieldValues.dateCompleted = '2020-01-01';
 f.subject.optimisticMoves.set('first', compiledModule.exports.createKanbanDropOptimisticMove({ ...f.context, taskId: 'first' }, { task: f.tasks.get('first') }));
 assert.equal(f.subject.resolveImmediateKanbanDropBeforeTaskId(f.cells.get('target'), f.context, f.preset), 'last');
 assert.equal(f.tasks.get('first').fieldValues.dateCompleted, undefined);
});

test('pending modified-time sorting retains the original gesture time for the earlier card', () => {
 const f = sortedFixture('datetimeModified', 'desc'); f.tasks.get('first').description = 'Alpha'; f.tasks.get('moved').description = 'Middle';
 f.tasks.get('first').datetimeModified = '2019-01-01T00:00:00'; f.tasks.get('last').datetimeModified = '2018-01-01T00:00:00';
 const before = compiledModule.exports.createKanbanDropOptimisticMove({ ...f.context, taskId: 'first' }, { task: f.tasks.get('first') });
 before.expiresAt = new Date('2026-01-01T10:00:00').getTime() + compiledModule.exports.KANBAN_OPTIMISTIC_MOVE_TTL_MS;
 const current = compiledModule.exports.createKanbanDropOptimisticMove(f.context, { task: f.tasks.get('moved') });
 current.expiresAt = new Date('2026-01-01T10:00:01').getTime() + compiledModule.exports.KANBAN_OPTIMISTIC_MOVE_TTL_MS;
 f.subject.optimisticMoves.set('first', before); f.subject.optimisticMoves.set('moved', current);
 assert.equal(f.subject.resolveImmediateKanbanDropBeforeTaskId(f.cells.get('target'), f.context, f.preset), 'first');
 const board = f.subject.lastRenderedBoard;
 const projected = compiledModule.exports.buildOptimisticMovedTask(f.tasks.get('first'), before, board, []);
 assert.equal(projected.datetimeModified, '2026-01-01T10:00:00');
});


test('touching only a shared parent timestamp does not redraw its children', () => {
 const f = fixture(); const source = f.cells.get('source'), child = cardById(source, 'b'), neighbor = cardById(source, 'c');
 f.previous.cellMap.get('source::lane').find(task => task.operonId === 'b').fieldValues.parentTask = 'parent';
 let parent = { ...task('parent', 'before-time'), description: 'Parent title' }; f.subject.indexer.getAllTasks = () => [parent];
 const before = f.signatures(f.previous); parent = { ...parent, signature: 'after-time', datetimeModified: '2026-10-24T18:00:00' };
 const result = f.subject.applyKanbanBoardPatchInPlace(f.boardEl, f.previous, f.previous, before, f.signatures(f.previous), null, {}, f.settings, false);
 assert.equal(result, true); assert.equal(cardById(source, 'b'), child); assert.equal(cardById(source, 'c'), neighbor);
 assert.deepEqual(f.renders, []); assert.deepEqual(f.measurements, []);
});

test('a changed descendant progress summary updates only its owning parent card', () => {
 const f = fixture(), source = f.cells.get('source'), parent = cardById(source, 'b'), neighbor = cardById(source, 'c');
 f.subject.indexer.secondary.getChildIds = id => new Set(id === 'b' ? ['outside-child'] : []);
 let summary = { done: 0, open: 1, total: 1 }; f.subject.buildDescendantSummary = () => summary;
 const before = f.signatures(f.previous); summary = { done: 1, open: 0, total: 1 };
 assert.equal(f.subject.applyKanbanBoardPatchInPlace(f.boardEl, f.previous, f.previous, before, f.signatures(f.previous), null, {}, f.settings, false), true);
 assert.notEqual(cardById(source, 'b'), parent); assert.equal(cardById(source, 'c'), neighbor); assert.deepEqual(f.renders, ['b']);
});
