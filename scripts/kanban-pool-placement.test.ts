import { encodeFilePropertyColumnKey } from '../src/core/raw-yaml-property';
import { collectKanbanScope } from '../src/systems/kanban-grouping';
import { filterTasksForCalendar } from '../src/systems/calendar-filter-materialization';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type * as Typescript from 'typescript';
import { kanbanPoolSourceSignature, KanbanCardOperationRegistry, classifyKanbanDropSettlement } from '../src/systems/kanban-drop-transaction';
import { KanbanOrderStore } from '../src/storage/kanban-order-store';
import { startKanbanPoolDrag } from '../src/ui/kanban/kanban-pool-drag';
import { statusDockDocument } from './test-support/status-dock-dom';
const ts: typeof Typescript = require('typescript');
const source = ts.createSourceFile('main.ts', readFileSync('main.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const declaration = source.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'OperonPlugin') as Typescript.ClassDeclaration;
const names = ['maybeOpenKanbanEditorForFilterMismatch', 'doesCalendarDraftMatchFilter', 'applyKanbanPropertyValue', 'assignTaskToKanbanCell', 'handleKanbanCardDrop', 'placeExistingTaskInKanbanCell', 'getKanbanFilterSetForPool', 'buildKanbanManualDropOrderCells', 'insertKanbanTaskIdBefore'];
const body = names.map(name => declaration.members.find(n => n.name?.getText(source) === name)!.getText(source)).join('\n');
const notices: string[] = [];
const dependencies = {
 collectKanbanScope, filterTasksForCalendar, kanbanPoolSourceSignature, classifyKanbanDropSettlement,
 buildKanbanDropBoardSignature: (preset: any) => JSON.stringify(preset),
 getNativePropertyIndex: () => ({ getTypes: () => ({}) }),
 attachKanbanDropFailureCause: (error: Error) => error,
 isPluginUiMutationCommitted: (outcome: string) => outcome === 'committed' || outcome === 'committed-repair-scheduled',
 buildKanbanCellKey: (column: string, lane: string) => `${column}|${lane}`,
 isSpecialDynamicFilterSet: () => false,
 Notice: class { constructor(value: string) { notices.push(value); } },
 t: (_group: string, key: string) => key,
};
const code = ts.transpileModule(`class Subject {${body}}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const Subject = new Function(...Object.keys(dependencies), `${code};return Subject;`)(...Object.values(dependencies));
function fixture(options: { manual?: boolean; noop?: boolean; format?: string } = {}) {
 notices.length = 0;
 const subject = new Subject();
 let task: any = { operonId: 'abc1234', description: 'Existing', checkbox: 'open', fieldValues: { status: 'Todo', contexts: 'Old' }, tags: [], datetimeModified: 'today', primary: { format: options.format ?? 'inline', filePath: 'Tasks.md', line: 2 } };
 const original = structuredClone(task);
 let preset: any = { id: 'board', pipelineId: 'pipe', swimlaneBy: null, filterSetId: 'filter' };
 let current = true, duplicate = false, outcome = 'committed', writes = 0, orderWrites = 0, refresh = 0, mismatches = 0;
 let order: Record<string, string[]> = { 'Done|lane': ['first', 'last'] };
 const plan: any = { state: options.noop ? 'noop' : 'ready', payload: { status: 'Done' }, changedKeys: ['status'], expectedFieldValues: { status: 'Todo' }, filePropertyDraft: { changes: [] }, inlinePropertyDraft: [] };
 subject.settings = { pipelines: [{ id: 'pipe' }], keyMappings: [], priorities: [], filterSets: [{ id: 'filter' }] };
 subject.app = {}; subject.kanbanCellOperations = new KanbanCardOperationRegistry();
 subject.indexer = { getTask: () => task, hasDuplicateOperonIdConflict: () => duplicate, scheduleReindex() {} };
 subject.getKanbanPresetForLeaf = () => preset;
 subject.resolveKanbanTargetStatus = () => ({ isFinished: false });
 subject.isKanbanTaskAtDropSource = () => { throw Error('Pool must not require a source cell'); };
 subject.isKanbanTaskAtDropTarget = (value: any) => value.fieldValues.status === 'Done';
 subject.prepareLegacyKanbanCellPlan = async () => plan;
 subject.queryKanbanBoardForOrder = () => ({ getSorting: () => ({ sortMode: options.manual ? 'manual' : 'auto' }), getCellTasks: () => (order['Done|lane'] ?? []).map(operonId => ({ operonId })) });
 subject.storage = { kanbanOrder: { getBoard: () => order, replaceCellsIfCurrent: async (_id: string, _expected: unknown, next: typeof order, canCommit?: () => boolean) => { if (canCommit && !canCommit()) return false; orderWrites++; order = next; return true; } } };
 subject.kanbanCellWriteOptions = (_plan: any, _task: any, canCommit: () => boolean) => ({ canCommit });
 subject.guardTaskStatusChangeOrShow = async () => true;
 subject.updatePluginUiTaskStatusAndRefresh = async (_id: string, payload: any, options: any) => {
  if (!options.canCommit()) return 'cancelled'; writes++;
  if (outcome === 'committed') task = { ...task, fieldValues: { ...task.fieldValues, ...payload } };
  return outcome;
 };
 subject.getTaskMutationFieldValue = (value: any, key: string) => value.fieldValues[key];
 subject.writer = { taskFieldsMatchCurrentSource: async () => false };
 subject.refreshViews = () => { refresh++; };
 subject.maybeOpenKanbanEditorForFilterMismatch = async () => { mismatches++; };
 subject.resolveKanbanRecurrenceReplacement = () => null;
 subject.showPluginUiMutationOutcome = () => {};
 subject.openEditorForId = () => {};
 if (options.noop) task.fieldValues.status = 'Done';
 const request = { context: { taskId: task.operonId, presetId: preset.id, boardSignature: JSON.stringify(preset), sourceStatusId: null, sourceLaneKey: '', targetStatusId: 'Done', targetLaneKey: 'lane', targetBeforeTaskId: 'last', swimlaneBy: null }, sourceSignature: kanbanPoolSourceSignature(task), isCurrent: () => current };
 return { subject, request, original, plan, task: () => task, setTask: (value: any) => { task = value; }, invalidate: () => { current = false; }, setDuplicate: () => { duplicate = true; }, changePreset: () => { preset = { ...preset, pipelineId: 'changed' }; }, setOutcome: (value: string) => { outcome = value; }, stats: () => ({ writes, orderWrites, refresh, mismatches, order }), run: () => subject.placeExistingTaskInKanbanCell({}, request) };
}
for (const format of ['inline', 'yaml']) test(`pool applies existing ${format} identity through shared writer and filter flow`, async () => {
 const f = fixture({ format }); assert.equal(await f.run(), true); assert.equal(f.task().operonId, f.original.operonId);
 assert.equal(f.stats().writes, 1); assert.equal(f.stats().orderWrites, 0); assert.equal(f.stats().mismatches, 1);
});
for (const noop of [true, false]) test(`manual pool position works with noop=${noop}`, async () => {
 const f = fixture({ manual: true, noop }); assert.equal(await f.run(), true);
 assert.deepEqual(f.stats().order['Done|lane'], ['first', 'abc1234', 'last']); assert.equal(f.stats().writes, noop ? 0 : 1);
});
test('automatic pool no-op performs no task or order write', async () => {
 const f = fixture({ noop: true }); assert.equal(await f.run(), true); assert.equal(f.stats().writes, 0); assert.equal(f.stats().orderWrites, 0);
});
for (const change of ['close', 'preset', 'source', 'duplicate', 'delete']) test(`pool rejects stale ${change} before write`, async () => {
 const f = fixture();
 if (change === 'close') f.invalidate(); if (change === 'preset') f.changePreset();
 if (change === 'source') f.setTask({ ...f.task(), description: 'Changed' });
 if (change === 'duplicate') f.setDuplicate(); if (change === 'delete') f.setTask(null);
 await f.run().catch(() => false); assert.equal(f.stats().writes, 0); assert.equal(f.stats().orderWrites, 0);
});
test('pool invalidation during preparation and status confirmation is zero-write', async () => {
 for (const phase of ['prepareLegacyKanbanCellPlan', 'guardTaskStatusChangeOrShow']) {
  const f = fixture(); f.subject[phase] = async () => { f.invalidate(); return phase === 'prepareLegacyKanbanCellPlan' ? f.plan : true; };
  assert.equal(await f.run(), false); assert.equal(f.stats().writes, 0);
 }
});
for (const outcome of ['cancelled', 'duplicate-task', 'source-changed', 'outcome-unknown', 'failed']) test(`pool ${outcome} is not retried or ordered`, async () => {
 const f = fixture({ manual: true }); f.setOutcome(outcome); await f.run().catch(() => false);
 assert.equal(f.stats().writes, 1); assert.equal(f.stats().orderWrites, 0); assert.equal(f.stats().mismatches, 0);
});
test('pool order failure preserves a committed task and warns without retry', async () => {
 const f = fixture({ manual: true }); let tries = 0;
 f.subject.storage.kanbanOrder.replaceCellsIfCurrent = async () => { tries++; throw Error('disk failure'); };
 assert.equal(await f.run(), true); assert.equal(f.task().fieldValues.status, 'Done'); assert.equal(tries, 1); assert.ok(notices.includes('kanbanManualOrderSaveFailed'));
});
test('pool close after started write observes commitment without opening editor or writing order', async () => {
 const f = fixture({ manual: true }); const write = f.subject.updatePluginUiTaskStatusAndRefresh;
 f.subject.updatePluginUiTaskStatusAndRefresh = async (...args: any[]) => { const result = await write(...args); f.invalidate(); return result; };
 assert.equal(await f.run(), true); assert.equal(f.task().fieldValues.status, 'Done'); assert.equal(f.stats().orderWrites, 0); assert.equal(f.stats().mismatches, 0);
});
test('pool recurrence replacement skips old task order', async () => {
 const f = fixture({ manual: true }); f.subject.resolveKanbanTargetStatus = () => ({ isFinished: true });
 f.subject.resolveKanbanRecurrenceReplacement = () => ({ operonId: 'next' }); f.subject.isKanbanTaskAtDropTarget = () => false;
 // Existing source verification remains optional for a source-less request.
 f.subject.isKanbanTaskAtDropSource = () => false;
 assert.equal(await f.run(), true); assert.equal(f.stats().orderWrites, 0);
});
test('queued manual order cancellation retains existing cells without persisting', async () => {
 const store = new KanbanOrderStore({} as any, {} as any); store.loadFromPackage({ version: 1, boards: { board: { cell: ['one'] } } });
 let writes = 0, valid = true; store.setPackagePersistence(async () => { writes++; });
 const pending = store.replaceCellsIfCurrent('board', { cell: ['one'] }, { cell: ['two'] }, () => valid); valid = false;
 assert.equal(await pending, false); assert.equal(writes, 0); assert.deepEqual(store.getBoard('board'), { cell: ['one'] });
});
function gesture(touch = false) {
 const f = statusDockDocument(); f.doc.elementFromPoint = () => null; const row = f.doc.body.createDiv(); row.dataset = {}; let valid = true, begins = 0, ends = 0, writes = 0, finishes = 0;
 const target: any = { point: { x: 30, y: 30 }, isCurrent: () => valid };
 const event: any = { pointerId: 1, pointerType: touch ? 'touch' : 'mouse', button: 0, buttons: 1, clientX: 10, clientY: 10, target: row, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} };
 const cancel = startKanbanPoolDrag(event, { operonId: 'id', description: 'Task' } as any, row as any, {
  isCurrent: () => valid, begin: () => { begins++; }, end: () => { ends++; }, finish: () => { finishes++; }, update() {}, target: () => target,
  place: async () => { writes++; },
 });
 return { ...f, row, event, cancel, target, invalidate: () => { valid = false; }, stats: () => ({ begins, ends, writes, finishes }), move: (x = 50) => f.emitWindow('pointermove', { ...event, clientX: x }), up: () => f.emitWindow('pointerup', { ...event, clientX: 50 }) };
}
for (const touch of [true, false]) test(`pool ${touch ? 'touch' : 'mouse'} gesture commits once and cleans up`, async () => {
 const f = gesture(touch); if (touch) f.flush(); else f.move(); f.up(); f.up(); await Promise.resolve(); await Promise.resolve();
 assert.equal(f.stats().begins, 1); assert.equal(f.stats().writes, 1); assert.equal(f.stats().ends, 1); f.flush();
 for (const listeners of f.windowListeners.values()) assert.equal(listeners.size, 0);
 f.cancel();
});
test('touch movement before long press remains scrolling, never starts placement', async () => {
 const f = gesture(true); f.move(40); f.flush(); f.up(); await Promise.resolve(); assert.equal(f.stats().begins, 0); assert.equal(f.stats().writes, 0); f.cancel();
});
for (const reason of ['second-pointer', 'blur', 'pointercancel', 'stale']) test(`active pool gesture ${reason} cancels without write`, () => {
 const f = gesture(true); f.flush();
 if (reason === 'stale') { f.invalidate(); f.flush(); } else f.emitWindow(reason === 'second-pointer' ? 'pointerdown' : reason, { ...f.event, pointerId: 2 });
 f.up(); assert.equal(f.stats().writes, 0); assert.equal(f.stats().ends, 1); f.cancel();
});

test('manual no-op revalidates source at queued order boundary', async () => {
 const f = fixture({ manual: true, noop: true }); let accepted = false;
 f.subject.storage.kanbanOrder.replaceCellsIfCurrent = async (_id: unknown, _before: unknown, _next: unknown, guard: () => boolean) => {
  f.setTask({ ...f.task(), description: 'Changed while queued' }); accepted = guard(); return accepted;
 };
 await assert.rejects(f.run()); assert.equal(accepted, false); assert.equal(f.stats().writes, 0);
});

test('pool manual reorder removes an existing membership once and preserves a self sentinel', () => {
 const f = fixture();
 assert.deepEqual(f.subject.insertKanbanTaskIdBefore(['first', 'abc1234', 'last'], 'abc1234', 'first'), ['abc1234', 'first', 'last']);
 assert.deepEqual(f.subject.insertKanbanTaskIdBefore(['first', 'abc1234', 'last'], 'abc1234', 'abc1234'), ['first', 'abc1234', 'last']);
});

test('existing cell menu retains a matching task position instead of moving it to the end', async () => {
 const f = fixture(); f.subject.promptKanbanTaskSelection = async () => f.task();
 let received: any; f.subject.placeExistingTaskInKanbanCell = async (_leaf: unknown, request: unknown) => { received = request; return true; };
 await f.subject.assignTaskToKanbanCell({}, f.request.context);
 assert.equal(received.context.targetBeforeTaskId, 'abc1234');
});
test('existing cell selection cancels if property definitions change during the picker', async () => {
 const f = fixture(); f.subject.promptKanbanTaskSelection = async () => { f.subject.settings.keyMappings = [{ changed: true }]; return f.task(); };
 await f.subject.assignTaskToKanbanCell({}, f.request.context); assert.equal(f.stats().writes, 0);
});

test('task change after committed update blocks queued order but retains the task result', async () => {
 const f = fixture({ manual: true }); let accepted = false;
 f.subject.storage.kanbanOrder.replaceCellsIfCurrent = async (_id: unknown, _before: unknown, _next: unknown, guard: () => boolean) => {
  f.setTask({ ...f.task(), description: 'Changed after task write' }); accepted = guard(); return accepted;
 };
 assert.equal(await f.run(), true); assert.equal(accepted, false); assert.equal(f.stats().writes, 1); assert.ok(notices.includes('kanbanManualOrderSaveFailed'));
});

for (const format of ['inline', 'yaml']) test(`Kanban property ${format} uses shared property writer without cell rules or manual-order writes`, async () => {
 const f = fixture({ format, manual: true }); let calls = 0;
 f.subject.applyCanvasPropertyValue = async (plan: any, direction: string, allowed: () => boolean) => { assert.equal(direction, 'drop'); assert.equal(allowed(), true); calls++; f.task().fieldValues.priority = plan.after.priority; return { status: 'committed' }; };
 assert.equal((await f.subject.applyKanbanPropertyValue({}, { id: f.task().operonId, after: { priority: 'S' } }, () => true)).status, 'committed');
 assert.equal(calls, 1); assert.equal(f.stats().orderWrites, 0); assert.equal(f.stats().writes, 0); assert.equal(f.stats().mismatches, 1);
});
test('Kanban property callback guards preset changes and concurrent task operations', async () => {
 const f = fixture(); let calls = 0;
 f.subject.applyCanvasPropertyValue = async (_plan: any, _direction: string, allowed: () => boolean) => { calls++; assert.equal(allowed(), true); f.changePreset(); assert.equal(allowed(), false); return { status: 'conflict' }; };
 const plan = { id: f.task().operonId };
 const op = f.subject.kanbanCellOperations.begin(plan.id, 'board', 'drop', 'signature');
 assert.equal((await f.subject.applyKanbanPropertyValue({}, plan, () => true)).status, 'blocked'); assert.equal(calls, 0);
 f.subject.kanbanCellOperations.end(op);
 assert.equal((await f.subject.applyKanbanPropertyValue({}, plan, () => true)).status, 'conflict'); assert.equal(calls, 1);
 assert.equal(f.subject.kanbanCellOperations.isTaskPending(plan.id), false); assert.equal(f.stats().mismatches, 0);
});
test('Kanban property post-commit feedback failure does not relabel the write or retry it', async () => {
 const f = fixture(); let calls = 0;
 f.subject.applyCanvasPropertyValue = async () => { calls++; return { status: 'committed' }; };
 f.subject.maybeOpenKanbanEditorForFilterMismatch = async () => { throw Error('feedback unavailable'); };
 assert.deepEqual(await f.subject.applyKanbanPropertyValue({}, { id: f.task().operonId }, () => true), { status: 'committed', warning: true }); assert.equal(calls, 1);
});

test('joint pool flow retains a committed placement if filter feedback fails', async () => {
 const f = fixture(); f.subject.maybeOpenKanbanEditorForFilterMismatch = async () => { throw Error('editor unavailable'); };
 assert.equal(await f.run(), true); assert.equal(f.stats().writes, 1); assert.equal(f.task().fieldValues.status, 'Done');
 assert.equal(f.subject.kanbanCellOperations.isTaskPending(f.task().operonId), false);
});
for (const first of ['task', 'property', 'native']) test(`joint pool operations serialize same task across views while ${first} is pending`, async () => {
 const f = fixture(); const subject = f.subject; let release!: () => void, propertyWrites = 0;
 const write = subject.updatePluginUiTaskStatusAndRefresh;
 subject.updatePluginUiTaskStatusAndRefresh = async (...args: any[]) => { await new Promise<void>(r => { release = r; }); return write(...args); };
 subject.applyCanvasPropertyValue = async (_plan: any, _direction: string, allowed: () => boolean) => { await new Promise<void>(r => { release = r; }); if (!allowed()) return { status: 'conflict' }; propertyWrites++; return { status: 'committed' }; };
 subject.isKanbanTaskAtDropSource = () => true;
 const plan = { id: f.task().operonId };
 const operation = first === 'property' ? subject.applyKanbanPropertyValue({}, plan, () => true) : first === 'native' ? subject.handleKanbanCardDrop({}, f.request.context) : f.run();
 for (let i = 0; i < 8; i++) await Promise.resolve(); assert.ok(release);
 assert.equal(await subject.placeExistingTaskInKanbanCell({ second: true }, f.request), false);
 assert.equal((await subject.applyKanbanPropertyValue({ second: true }, plan, () => true)).status, 'blocked');
 assert.equal(await subject.handleKanbanCardDrop({ second: true }, f.request.context), 'cancelled');
 assert.equal(f.stats().writes, 0); assert.equal(propertyWrites, 0);
 release(); await operation;
 assert.equal(f.stats().writes + propertyWrites, 1); assert.equal(subject.kanbanCellOperations.isTaskPending(plan.id), false);
});

for (const drift of ['none', 'late-index', 'late-title', 'unrelated-field', 'external-rename']) test(`pool file-name rename retains source guards: ${drift}`, async () => {
 const f = fixture({ format: 'yaml' }); f.plan.payload = { _description: 'Renamed', status: 'Done' }; f.plan.changedKeys = ['_description', 'status'];
 f.subject.updatePluginUiTaskStatusAndRefresh = async (_id: string, payload: any, options: any) => {
  assert.equal(options.canCommit(), true);
  if (drift === 'late-index' || drift === 'late-title') options.onFileSourceRenamed?.('Renamed.md');
  f.setTask({ ...f.task(), ...(drift === 'late-title' ? {description:'Renamed'} : {}), primary: { ...f.task().primary, filePath: 'Renamed.md' } });
  if (drift === 'none' || drift === 'unrelated-field') options.onFileSourceRenamed?.('Renamed.md');
  if (drift === 'unrelated-field') f.task().fieldValues.note = 'external edit';
  assert.equal(options.canCommit(), ['none','late-index','late-title'].includes(drift));
  if (!options.canCommit()) return 'cancelled';
  f.task().description = payload._description; Object.assign(f.task().fieldValues, { status: payload.status }); return 'committed';
 };
 assert.equal(await f.run(), ['none','late-index','late-title'].includes(drift));
});

test('hybrid Task Pool long press refuses ownership acquired after pointerdown without releasing it', () => {
 const f = statusDockDocument(), row = f.doc.body.createDiv(); let occupied = false, acquired = 0, ended = 0, writes = 0;
 const event:any={pointerId:1,pointerType:'touch',isPrimary:true,button:0,buttons:1,clientX:10,clientY:10,target:row,preventDefault(){},stopPropagation(){}};
 const cancel = startKanbanPoolDrag(event, {operonId:'abc1234',description:'Task'} as any, row, {
  isCurrent:()=>true, begin:()=>{if(occupied)return false;occupied=true;acquired++;return true;},end:()=>{occupied=false;ended++;},finish(){},update(){},target:()=>null,place:async()=>{writes++;},
 });
 occupied=true;f.flush(); assert.equal(acquired,0);assert.equal(ended,0);assert.equal(occupied,true);assert.equal(writes,0);
 cancel();for(const callbacks of f.windowListeners.values())assert.equal(callbacks.size,0);assert.equal(f.timers.size,0);
});

// Exercise the real post-save warning path and real Kanban evaluator together.
// Writer boundaries remain observable; feedback must never undo or repeat their result.
for (const pool of ['task', 'property']) for (const format of ['inline', 'yaml']) {
 for (const scenario of ['project-tree', 'folder', 'source-type', 'pinned-identity', 'project-serial', 'file-property', 'no-filter', 'real-mismatch', 'left-tree']) {
  test(`pool filter feedback ${pool} ${format} ${scenario}`, async () => {
   const f = fixture({ format });
   const parent = { ...structuredClone(f.task()), operonId: 'parent1', fieldValues: { parentTask: 'root001' } };
   const root = { ...structuredClone(f.task()), operonId: 'root001', fieldValues: {} };
   f.task().fieldValues.parentTask = parent.operonId;
   f.task().primary.filePath = 'Projects/Tasks.md';
   const propertyKey = encodeFilePropertyColumnKey('Team')!;
   const condition = scenario === 'project-serial'
    ? { field: 'projectSerialScope', fieldType: 'projectSerialScope', operator: 'isAnyOf', values: ['scope'] }
    : scenario === 'file-property'
     ? { field: propertyKey, fieldType: 'text', operator: 'is', value: 'Operon' }
     : scenario === 'folder'
    ? { field: 'folders', fieldType: 'folders', operator: 'isInFolderTree', value: 'Projects' }
    : scenario === 'source-type'
     ? { field: '__taskDataType', fieldType: 'text', operator: 'is', value: format === 'yaml' ? 'file' : 'inline' }
     : scenario === 'pinned-identity'
      ? { field: 'pinned', fieldType: 'pinned', operator: 'isPinned' }
      : scenario === 'real-mismatch'
       ? { field: 'assignees', fieldType: 'list', operator: 'anyContains', value: 'Someone else' }
       : { field: 'projectTree', fieldType: 'projectTree', operator: 'matchesTree', value: root.operonId };
   const filter: any = { id: 'filter', name: 'Pool scope', rootGroup: { id: 'g', logic: 'all', children: [{ id: 'c', ...condition }] }, sorts: [], conditions: [], matchLogic: 'all' };
   f.subject.settings.filterSets = scenario === 'no-filter' ? [] : [filter];
   f.subject.indexer.getAllTasks = () => [root, parent, f.task()];
   f.subject.storage.repeatSeries = { getSkipDates: () => [] };
   const fileProperties: any = {
    signature: 'fixture', fields: [{ key: propertyKey, type: 'text', propertyName: 'Team' }],
    getCell: (task: any) => task.primary.filePath === 'Projects/Tasks.md'
     ? { present: true, rawValue: 'Operon', normalizedValue: 'Operon' }
     : { present: false, rawValue: undefined, normalizedValue: '' },
   };
   f.subject.getTableFilePropertySnapshot = () => fileProperties;
   f.subject.settings.projectSerialScopes = [{ id: 'scope', prefix: 'OPR', parentOperonId: root.operonId, createdAt: '', updatedAt: '' }];
   f.subject.pinnedCache = { isPinned: (id: string) => id === f.task().operonId };
   delete f.subject.maybeOpenKanbanEditorForFilterMismatch;
   let editors = 0, propertyWrites = 0;
   f.subject.openEditorForId = (id: string) => { assert.equal(id, f.task().operonId); editors++; };
   const payload = { assignees: '[[Miro]]', ...(scenario === 'left-tree' ? { parentTask: 'outside' } : {}) };
   Object.assign(f.plan.payload, payload);
   f.request.sourceSignature = kanbanPoolSourceSignature(f.task());
   f.subject.applyCanvasPropertyValue = async (_plan: unknown, _direction: unknown, allowed: () => boolean) => {
    assert.equal(allowed(), true); propertyWrites++; Object.assign(f.task().fieldValues, payload); return { status: 'committed' };
   };
   if (pool === 'task') assert.equal(await f.run(), true);
   else assert.equal((await f.subject.applyKanbanPropertyValue({}, { id: f.task().operonId }, () => true)).status, 'committed');
   assert.equal(f.stats().writes + propertyWrites, 1);
   assert.equal(f.task().fieldValues.assignees, '[[Miro]]');
   const mismatch = scenario === 'real-mismatch' || scenario === 'left-tree';
   assert.equal(collectKanbanScope({ settings: f.subject.settings, tasks: f.subject.indexer.getAllTasks(), filterSet: scenario === 'no-filter' ? null : filter, pinnedCache: f.subject.pinnedCache, filterEvaluationOptions: { filePropertyContext: fileProperties, projectSerialScopes: f.subject.settings.projectSerialScopes } }).scoped.some(t => t.operonId === f.task().operonId), !mismatch);
   assert.equal(notices.filter(key => key === 'kanbanFilterMismatch').length, mismatch ? 1 : 0);
   assert.equal(editors, mismatch ? 1 : 0);
   assert.equal(f.subject.kanbanCellOperations.isTaskPending(f.task().operonId), false);
  });
 }
}


for (const pool of ['task', 'property']) for (const change of ['relaxed', 'tightened', 'removed']) {
 test(`pool filter feedback ${pool} resolves ${change} rules after delayed save`, async () => {
  const f = fixture();
  const filter = (matches: boolean) => ({ id: 'filter', name: 'Current scope', rootGroup: { id: 'g', logic: 'all', children: [{ id: 'c', field: 'description', fieldType: 'text', operator: 'is', value: matches ? 'Existing' : 'Other' }] }, sorts: [], conditions: [], matchLogic: 'all' });
  f.subject.settings.filterSets = [filter(change === 'tightened')];
  f.subject.indexer.getAllTasks = () => [f.task()];
  f.subject.getTableFilePropertySnapshot = () => undefined;
  f.subject.storage.repeatSeries = { getSkipDates: () => [] };
  delete f.subject.maybeOpenKanbanEditorForFilterMismatch;
  let editors = 0, propertyWrites = 0, resume!: () => void;
  f.subject.openEditorForId = () => { editors++; };
  const delayed = new Promise<void>(resolve => { resume = resolve; });
  const write = f.subject.updatePluginUiTaskStatusAndRefresh;
  f.subject.updatePluginUiTaskStatusAndRefresh = async (...args: any[]) => { await delayed; return write(...args); };
  f.subject.applyCanvasPropertyValue = async () => { await delayed; propertyWrites++; f.task().fieldValues.assignees = '[[Miro]]'; return { status: 'committed' }; };
  const pending = pool === 'task' ? f.run() : f.subject.applyKanbanPropertyValue({}, { id: f.task().operonId }, () => true);
  f.subject.settings.filterSets = change === 'removed' ? [] : [filter(change === 'relaxed')];
  resume();
  const result = await pending;
  assert.equal(pool === 'task' ? result : result.status === 'committed', true);
  assert.equal(f.stats().writes + propertyWrites, 1);
  assert.equal(editors, change === 'tightened' ? 1 : 0);
  assert.equal(notices.filter(key => key === 'kanbanFilterMismatch').length, change === 'tightened' ? 1 : 0);
 });
}
