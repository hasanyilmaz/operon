import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { TFile } from 'obsidian';
import { TaskWriter } from '../src/core/task-writer';
import { StartupFileEvents } from '../src/systems/startup-file-events';
import { scanFileWithMappings } from '../src/indexer/file-scanner';
import { DEFAULT_SETTINGS } from '../src/types/settings';
import { isOperonExcludedPath } from '../src/core/operon-path-exclusions';
const ts: typeof import('typescript') = createRequire(`${process.cwd()}/package.json`)('typescript');

function harness(process: ConstructorParameters<typeof StartupFileEvents<ReturnType<typeof setTimeout>>>[0]['process'], enabled = true) {
 const timers = new Set<ReturnType<typeof setTimeout>>();
 const errors: unknown[] = []; let yields = 0;
 const queue = new StartupFileEvents({ enabled, process, onError: (_path, error) => errors.push(error),
  setTimer: (callback, _delay) => { yields++; const timer = setTimeout(() => { timers.delete(timer); callback(); }, 1); timers.add(timer); return timer; },
  clearTimer: timer => { clearTimeout(timer); timers.delete(timer); },
 });
 return { queue, timers, errors, get yields() { return yields; } };
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

test('startup discovery coalesces thousands of events without starting reads before layout', async () => {
 const paths: string[] = []; const h = harness(async path => { paths.push(path); });
 for (let n = 0; n < 8000; n++) { h.queue.capture(`${n}.md`, 'create'); h.queue.capture(`${n}.md`, 'create'); }
 await Promise.resolve(); assert.equal(paths.length, 0); assert.equal(h.timers.size, 0);
 await h.queue.drain(new Set(['3.md', '7999.md']));
 assert.deepEqual(paths, ['3.md', '7999.md']); assert.equal(h.queue.capture('live.md', 'create'), false);
});

test('real modify, post-layout create and delete/recreate bypass unchanged-stat filtering', async () => {
 const paths: string[] = []; const h = harness(async path => { paths.push(path); });
 h.queue.capture('same-stat.md', 'create'); h.queue.capture('same-stat.md', 'modify');
 h.queue.capture('post-layout.md', 'create', true);
 h.queue.capture('replacement.md', 'create'); h.queue.delete('replacement.md'); h.queue.capture('replacement.md', 'create');
 h.queue.capture('unchanged.md', 'create');
 await h.queue.drain(new Set()); assert.deepEqual(paths, ['same-stat.md', 'post-layout.md', 'replacement.md']);
});

test('startup drain is serial, yields between small groups and replays a change during processing', async () => {
 let running = 0, peak = 0; const paths: string[] = [];
 const h = harness(async (path, _event, current) => {
  running++; peak = Math.max(peak, running); paths.push(path);
  if (path === '0.md' && paths.length === 1) { h.queue.capture(path, 'modify'); assert.equal(current(), false); }
  await Promise.resolve(); running--;
 });
 for (let n = 0; n < 70; n++) h.queue.capture(`${n}.md`, 'modify');
 await h.queue.drain(new Set()); assert.equal(peak, 1); assert.equal(paths.length, 71); assert.ok(h.yields >= 2);
});

test('rename, delete and same-path recreation cancel an in-flight incarnation', async () => {
 const started = deferred(), release = deferred(); const processed: string[] = [];
 const h = harness(async (path, _event, current) => {
  if (path === 'old.md') { started.resolve(); await release.promise; assert.equal(current(), false); }
  if (current()) processed.push(path);
 });
 h.queue.capture('old.md', 'modify'); h.queue.capture('deleted.md', 'modify');
 const draining = h.queue.drain(new Set()); await started.promise;
 h.queue.rename('old.md', 'new.md'); h.queue.delete('deleted.md');
 h.queue.capture('deleted.md', 'create'); release.resolve(); await draining;
 assert.deepEqual(processed, ['new.md', 'deleted.md']);
});

test('read failures retry, preserve later events and do not count as completed', async () => {
 let attempts = 0; const processed: string[] = [];
 const h = harness(async path => { if (path === 'bad.md' && ++attempts <= 2) throw Error('read'); processed.push(path); });
 h.queue.capture('bad.md', 'modify'); h.queue.capture('good.md', 'modify');
 await h.queue.drain(new Set()); assert.equal(attempts, 3); assert.deepEqual(processed, ['good.md', 'bad.md']); assert.equal(h.errors.length, 1);
});

test('events arriving during startup indexing are drained before capture is released', async () => {
 const paths: string[] = []; let scans = 0;
 const h = harness(async path => { paths.push(path); }); h.queue.capture('initial.md', 'modify');
 await h.queue.drain(new Set(), async () => { if (++scans === 1) h.queue.capture('late.md', 'modify'); });
 assert.deepEqual(paths, ['initial.md', 'late.md']); assert.equal(scans, 2); assert.equal(h.queue.capture('live.md', 'modify'), false);
});

test('indexing read failure keeps startup active and retries the retained source', async () => {
 let scans = 0; const paths: string[] = []; const h = harness(async path => { paths.push(path); });
 await h.queue.drain(new Set(), async () => {
  if (++scans <= 2) { h.queue.capture('edited.md', 'modify'); throw Error('index read'); }
 });
 assert.equal(scans, 3); assert.deepEqual(paths, ['edited.md', 'edited.md']); assert.equal(h.errors.length, 2);
});

test('unload cancels retry timers and invalidates in-flight writes', async () => {
 const started = deferred(), release = deferred(); let valid = true;
 const h = harness(async (_path, _event, current) => { started.resolve(); await release.promise; valid = current(); });
 h.queue.capture('a.md', 'modify'); const draining = h.queue.drain(new Set()); await started.promise;
 h.queue.destroy(); release.resolve(); await draining; assert.equal(valid, false); assert.equal(h.timers.size, 0);
 const retry = harness(async () => { throw Error('unreadable'); }); retry.queue.capture('b.md', 'modify');
 const retrying = retry.queue.drain(new Set()); await Promise.resolve(); retry.queue.destroy(); await retrying;
 assert.equal(retry.timers.size, 0); assert.equal(retry.queue.capture('b.md', 'create'), false);
});

test('plugin reload with layout already ready uses the normal event route', async () => {
 let processed = 0; const h = harness(async () => { processed++; }, false);
 assert.equal(h.queue.capture('a.md', 'create'), false); assert.equal(h.queue.capture('a.md', 'modify'), false);
 await h.queue.drain(new Set(['a.md'])); assert.equal(processed, 0);
});

// Execute the production normalizer, with only host dependencies substituted.
function normalizationHarness() {
 const ast = ts.createSourceFile('main.ts', readFileSync('main.ts', 'utf8'), ts.ScriptTarget.Latest, true);
 const cls = ast.statements.find(ts.isClassDeclaration)!;
 const names = ['captureStartupFileEvent', 'normalizeWorkflowStateAfterRawEdit', 'normalizeWorkflowStateAfterRawEditPass'];
 const methods = cls.members.filter(node => ts.isMethodDeclaration(node) && names.includes(node.name.getText(ast)));
 assert.equal(methods.length, names.length);
 const code = ts.transpileModule(`class Harness { ${methods.map(node => node.getText(ast)).join('\n')} }; return Harness;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
 const Constructor = new Function('TFile', 'scanFileWithMappings', 'isOperonExcludedPath', 'localNow', 'resolveReverseWorkflowFromTerminalDate', 'parseRepeatRule', code)(
  TFile, scanFileWithMappings, isOperonExcludedPath, () => '2026-01-01T10:00', () => ({ workflow: { value: 'Project.Done' } }), () => null);
 const h = new Constructor(); const file = new (TFile as unknown as new(path: string) => TFile)('Task.md');
 file.stat = { ctime: 1, mtime: 1, size: 1 };
 let content = '- [ ] Example {{operonId:: task001}} {{status:: Project.Done}}'; let reads = 0;
 h.settings = structuredClone(DEFAULT_SETTINGS);
 h.app = { workspace: { layoutReady: true }, vault: { getAbstractFileByPath: () => file,
  cachedRead: async () => { reads++; return content; }, modify: async (_file: TFile, value: string) => { content = value; } } };
 h.tasksConversionOwnedSources = new Map(); h.tasksConversionSettledSources = new Map();
 h.workflowNormalizationInProgress = new Set(); h.workflowNormalizationPending = new Set();
 h.workflowNormalizationWaiters = new Map(); h.workflowNormalizationRenameTargets = new Map(); h.startupPreviousTasks = new Map();
 h.isTemplatedFileTaskCreationCandidate = () => false; h.hasTemplatedFileTaskIdentity = () => false;
 h.resolveOperonIdPlaceholdersInContent = (value: string) => value; h.resolveTemplatedFileTaskContent = (value: string) => value.replace('template-id', 'task001');
 const old = { operonId: 'task001', fieldValues: { status: 'Project.Done', dateCompleted: '2026-01-01' }, primary: { filePath: file.path, format: 'inline', lineNumber: 0 } };
 let indexed = [old]; const scheduled: string[] = [], writes: any[] = [];
 h.indexer = { getAllTasks: () => indexed, hasDuplicateOperonIdConflict: () => false, scheduleReindex: (path: string) => scheduled.push(path) };
 h.buildTerminalDateRemovalNormalization = () => ({ status: 'Project.Inbox', dateCompleted: '' });
 h.writer = { writeTaskFields: async (_id: string, payload: unknown, options: unknown) => { writes.push({ payload, options }); return true; } };
 h.refreshViews = () => {};
 return { h, file, writes, scheduled, old, set indexed(value: any[]) { indexed = value; }, get reads() { return reads; }, get content() { return content; }, set content(value: string) { content = value; } };
}

test('a real edit during index scanning retains old workflow fields for normalization', async () => {
 const f = normalizationHarness(); f.h.startupFileEvents = harness(async () => {}).queue;
 assert.equal(f.h.captureStartupFileEvent('Task.md', 'modify'), true);
 f.indexed = [{ ...f.old, fieldValues: { status: 'Project.Done' } }];
 await f.h.normalizeWorkflowStateAfterRawEdit('Task.md', () => true);
 assert.equal(f.writes.length, 1); assert.equal(f.writes[0].payload.status, 'Project.Inbox');
 assert.equal(f.reads, 1, 'startup parser shares the normalizer content');
 assert.equal(f.writes[0].options.expectedFieldValues.status, 'Project.Done');
 assert.deepEqual(f.scheduled, ['Task.md']);
});

test('normalization passes cancellation into the writer transaction after its own await', async () => {
 const f = normalizationHarness(); let valid = true, committed = false;
 f.h.writer.writeTaskFields = async (_id: string, _payload: unknown, options: {canCommit: () => boolean}) => {
  await Promise.resolve(); valid = false; committed = options.canCommit(); return committed;
 };
 await f.h.normalizeWorkflowStateAfterRawEdit('Task.md', () => valid);
 assert.equal(committed, false); assert.deepEqual(f.scheduled, []);
});

test('startup template identity normalization works for newly created inline and file tasks', async () => {
 for (const source of ['- [ ] Created {{operonId:: template-id}}', '---\noperonId: template-id\n---\nCreated']) {
  const f = normalizationHarness(); f.indexed = []; f.content = source;
  f.h.isTemplatedFileTaskCreationCandidate = () => true; f.h.hasTemplatedFileTaskIdentity = () => true;
  await f.h.normalizeWorkflowStateAfterRawEdit('Task.md', () => true);
  assert.ok(f.content.includes('task001')); assert.ok(!f.content.includes('template-id'));
  assert.deepEqual(f.scheduled, ['Task.md', 'Task.md']);
 }
});


test('rename then recreate the original path is a real event even with unchanged source stats', async () => {
 const paths: string[] = []; const h = harness(async path => { paths.push(path); });
 h.queue.capture('a.md', 'create'); h.queue.rename('a.md', 'b.md'); h.queue.capture('a.md', 'create');
 await h.queue.drain(new Set()); assert.deepEqual(paths, ['b.md', 'a.md']);
});

test('rejected normalization writes retry while existing duplicate conflicts stay protected', async () => {
 const f = normalizationHarness(); f.h.writer.writeTaskFields = async () => false;
 await assert.rejects(f.h.normalizeWorkflowStateAfterRawEdit('Task.md', () => true), /could not commit/u);
 f.h.indexer.hasDuplicateOperonIdConflict = () => true;
 await f.h.normalizeWorkflowStateAfterRawEdit('Task.md', () => true);
 assert.equal(f.writes.length, 0);
});


test('unknown inline properties do not poison startup writer guards, while restored dates reject stale writes', async () => {
 const f = normalizationHarness(); f.content += ' {{customUnmapped:: value}}';
 await f.h.normalizeWorkflowStateAfterRawEdit('Task.md', () => true);
 const write = f.writes[0]; const writer = new TaskWriter(f.h.app, f.h.indexer, f.h.settings.keyMappings);
 assert.equal(write.options.expectedFieldValues.customUnmapped, undefined);
 const update = { operonId: 'task001', format: 'inline' as const, lineNumber: 0,
  fieldValues: write.payload, expectedFieldValues: write.options.expectedFieldValues };
 const accepted = writer.renderGuardedTaskSourceContent('Task.md', f.content, [update]);
 assert.equal(accepted.ok, true); assert.ok(accepted.content.includes('customUnmapped:: value'));
 const changed = writer.renderGuardedTaskSourceContent('Task.md', f.content + ' {{dateCompleted:: 2026-02-01}}', [update]);
 assert.equal(changed.ok, false);
});
