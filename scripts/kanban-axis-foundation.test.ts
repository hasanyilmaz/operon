import { buildKanbanDropBoardSignature } from '../src/systems/kanban-drop-transaction';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TFile, type App } from 'obsidian';
import { DEFAULT_SETTINGS, migrateSettings, type KeyMapping } from '../src/types/settings';
import { cloneDefaultKanbanPresets, normalizeBuiltInKanbanPreset } from '../src/types/kanban';
import { decodeKanbanAxes, resolveKanbanAxes, projectKanbanLegacyAxes, updateKanbanLegacyAxes, kanbanAxisValueKey, normalizeKanbanAxisValue, assertKanbanAxesWritable, type KanbanAxes, type KanbanPropertyReference } from '../src/core/kanban-axis-model';
import { createKanbanPropertyAccess } from '../src/core/kanban-axis-properties';
import { buildCustomFieldUsageSummaries } from '../src/core/managed-task-fields';
import { NativePropertyIndex } from '../src/indexer/native-property-index';
import { scanFileWithMappings } from '../src/indexer/file-scanner';
import { buildOperonDataPackageFromSettings, composeOperonSettingsFromDataPackage, type OperonDataPackageV1 } from '../src/storage/operon-data-package';
import { OperonDataPackageStore } from '../src/storage/operon-data-package-store';
import { buildOperonStoragePaths } from '../src/storage/operon-storage-paths';
import { KanbanPresetStore } from '../src/storage/kanban-preset-store';
import { WriteQueue } from '../src/storage/write-queue';
import { exportOperonSettingsBackupJsonV1 } from '../src/core/settings-backup-export';
import { parseOperonSettingsBackupV1 } from '../src/core/settings-backup-format';
import { validateOperonSettingsBackupGroupsV1 } from '../src/core/settings-backup-group-validation';

import { queryKanbanBoard } from './test-support/kanban-legacy-query';
import type { IndexedTask } from '../src/types/fields';

const settings = () => migrateSettings(structuredClone(DEFAULT_SETTINGS));
const preset = () => cloneDefaultKanbanPresets()[0];
const ref = (type: KanbanPropertyReference['type'], key = 'Effort', source: 'managed' | 'native' = 'native'): KanbanPropertyReference => ({ source, key, type });
const axes = (property = ref('number'), values: unknown[] = []): KanbanAxes => ({ version: 1,
 columns: { kind: 'property', property, values: values as never[] }, swimlanes: null });
const mapping = (canonicalKey = 'effort', visiblePropertyName = 'Effort', type: KeyMapping['type'] = 'number'): KeyMapping =>
 ({ canonicalKey, visiblePropertyName, type, isSystem: false, showInKanbanSwimlane: false } as KeyMapping);
const task = (fieldValues: Record<string, string> = {}, id = 'task001'): IndexedTask => ({ operonId: id,
 primary: { filePath: 'Task.md', format: 'inline', lineNumber: 0 }, description: 'Task', tags: ['book'], fieldValues,
 checkbox: 'open', tier: 'hot', datetimeModified: '' });
function fakeIndex(types: Record<string, string> = {}) {
 return { getTypes: () => types as ReturnType<NativePropertyIndex['getTypes']>, getRevision: () => 1,
 isReady: () => true, getTask: () => ({ properties: new Map(), available: true, revision: '1' }) };
}

test('legacy adaptation is in-memory, retains null pipeline and disabled swimlanes', () => {
 const p = { ...preset(), pipelineId: null, swimlaneBy: null };
 const before = JSON.stringify(p);
 assert.deepEqual(resolveKanbanAxes(p), { ok: true, axes: { version: 1, columns: { kind: 'status', pipelineId: null }, swimlanes: null } });
 assert.equal(JSON.stringify(p), before);
 assert.equal(migrateSettings({ ...settings(), kanbanPresets: [p] }).kanbanPresets[0].axes, undefined);
});
test('same property and value can occupy both axes; duplicates only collapse inside one axis', () => {
 const value = { kind: 'value', value: 5 };
 const a = axes(ref('number'), [value, value]); a.swimlanes = structuredClone(a.columns);
 const parsed = decodeKanbanAxes(a); assert.ok(parsed.ok);
 assert.equal(parsed.axes.columns.kind, 'property');
 if (parsed.axes.columns.kind !== 'property' || parsed.axes.swimlanes?.kind !== 'property') assert.fail();
 assert.deepEqual(parsed.axes.columns.values, [value]);
 parsed.axes.columns.values.push({ kind: 'value', value: 20 });
 assert.deepEqual(parsed.axes.swimlanes.values, [value]);
});
for (const [type, input, expected] of [
 ['text', 'Unused', 'Unused'], ['number', '01', 1], ['number', '1.0', 1], ['number', 0, 0],
 ['checkbox', false, false], ['date', '2028-02-29', '2028-02-29'], ['datetime', '2026-10-27T14:30:22+02:00', '2026-10-27T14:30:22+02:00'],
 ['list', 'a; b [[note]] "quoted"', 'a; b [[note]] "quoted"'], ['list', '0', '0'], ['list', 0, 0],
] as const) test(`typed value ${type}: ${JSON.stringify(input)}`, () => {
 assert.deepEqual(normalizeKanbanAxisValue({ kind: 'value', value: input }, ref(type)), { kind: 'value', value: expected });
});
test('invalid types, dates, nonfinite numbers and ambiguous empty scalars are rejected', () => {
 for (const [type, value] of [['number', Infinity], ['number', '9007199254740993'], ['checkbox', 'false'], ['date', '2026-02-29'], ['datetime', '2026-10-27T25:00'], ['text', '']] as const)
  assert.equal(normalizeKanbanAxisValue({ kind: 'value', value }, ref(type)), null);
 assert.equal(new Set([{ kind: 'empty' }, { kind: 'value', value: 0 }, { kind: 'value', value: false }].map(v => kanbanAxisValueKey(v as never))).size, 3);
});
test('property catalog includes checkbox custom keys independently of legacy visibility; excludes automatic fields', () => {
 const s = settings(); s.keyMappings.push(mapping('flag', 'Flag', 'checkbox'));
 const access = createKanbanPropertyAccess(s, fakeIndex());
 assert.ok(access.fields.some(f => f.reference.key === 'flag'));
 for (const key of ['duration', 'progress', 'totalDuration', 'totalEstimate', 'operonId', 'datetimeModified', 'repeatOccurrenceDate'])
  assert.ok(!access.fields.some(f => f.reference.key === key), key);
 assert.equal(access.read(task({ flag: 'false' }), ref('checkbox', 'flag', 'managed')).state, 'ready');
});
test('canonical, custom and native aliases share one identity, labels do not become persistent keys', () => {
 const s = settings(); s.keyMappings.push(mapping());
 const access = createKanbanPropertyAccess(s, fakeIndex({ Effort: 'number' }));
 const a = access.resolve(ref('number', 'effort', 'managed')), b = access.resolve(ref('number', 'Effort'));
 assert.ok(a.ok && b.ok); assert.equal(a.field.identity, b.field.identity); assert.equal(b.field.reference.key, 'effort');
 const value = access.read(task({ effort: '01' }), ref('number', 'Effort')); assert.equal(value.state, 'ready');
 if (value.state !== 'ready') assert.fail(); assert.deepEqual(value.values, [{ kind: 'value', value: 1 }]);
});
test('alias collision, deleted field and type reuse do not read as empty', () => {
 const s = settings(); s.keyMappings.push(mapping(), mapping('other', 'Effort'));
 assert.equal(createKanbanPropertyAccess(s, fakeIndex()).resolve(ref('number', 'Effort')).ok, false);
 s.keyMappings.pop();
 assert.equal(createKanbanPropertyAccess(s, fakeIndex({ Effort: 'text' })).read(task({ effort: '5' }), ref('number', 'effort', 'managed')).state, 'unavailable');
 s.inlinePropertyDefinitions = { version: 1, entries: [{ sourceName: 'Effort', type: 'text', encoding: 'vault-v1' }] };
 assert.equal(createKanbanPropertyAccess(s, fakeIndex()).resolve(ref('number', 'effort', 'managed')).ok, false);
 assert.equal(createKanbanPropertyAccess(settings(), fakeIndex()).read(task(), ref('number', 'deleted', 'managed')).state, 'unavailable');
});
test('priority and status reads use taxonomy IDs; tags retain their existing memberships', () => {
 const s = settings(), access = createKanbanPropertyAccess(s, fakeIndex());
 const p = s.priorities[0], pipeline = s.pipelines[0], status = pipeline.statuses[0];
 const row = task({ priority: p.label.toLowerCase(), status: `${pipeline.name}.${status.label}` });
 const priority = access.read(row, ref('text', 'priority', 'managed')); assert.equal(priority.state, 'ready');
 if (priority.state === 'ready') assert.deepEqual(priority.values, [{ kind: 'priority', id: p.id }]);
 const state = access.read(row, ref('text', 'status', 'managed')); assert.equal(state.state, 'ready');
 if (state.state === 'ready') assert.deepEqual(state.values, [{ kind: 'status', pipelineId: pipeline.id, id: status.id }]);
 const tags = access.read(row, ref('list', 'tags', 'managed')); assert.equal(tags.state, 'ready');
 if (tags.state === 'ready') assert.deepEqual(tags.values, [{ kind: 'value', value: 'book' }]);
});

async function nativeFixture() {
 const s = settings(); s.keyMappings = s.keyMappings.map(m => ({ ...m, visiblePropertyName: m.canonicalKey }));
 const contents = new Map([
  ['File.md', '---\noperonId: file001\nEffort: 0\nFlag: false\nItems: ["a; b", 0, "0"]\n---\n'],
  ['Inline.md', '---\nEffort: 99\n---\n- [ ] First {{operonId:: line001}} {{Effort:: 5}} {{Flag:: false}}\n- [ ] Second {{operonId:: line002}} {{Effort:: 20}}\n'],
 ]);
 const files = new Map([...contents.keys()].map(path => { const f = new TFile(...([path] as unknown as [])); Object.assign(f, { path, basename: path.slice(0,-3), extension: 'md', stat: { mtime: 1, ctime: 1, size: 1 } }); return [path,f]; }));
 let reads = 0;
 const app = { vault: { configDir: '.obsidian', getAbstractFileByPath: (p: string) => files.get(p),
 read: async (f: TFile) => { reads++; return contents.get(f.path)!; } }, metadataCache: { getFileCache: () => ({}) } } as unknown as App;
 const native = new NativePropertyIndex(app); native.configure(s); native.setTypes({ Effort: 'number', Flag: 'checkbox', Items: 'multitext', Missing: 'text' });
 const tasks: IndexedTask[] = [];
 for (const [path, file] of files) {
  const scan = await scanFileWithMappings(app, file, s.keyMappings);
  native.accept(path, scan.nativeProperties);
  if (scan.yamlTask) tasks.push({ ...task(scan.yamlTask.fieldValues, scan.yamlTask.operonId), primary: { filePath:path, format:'yaml', lineNumber:0 } });
  for (const parsed of scan.inlineTasks) tasks.push({ ...task(parsed.fields.reduce((a,f) => ({ ...a, [f.key]: f.value }), {}), parsed.operonId!),
   primary: { filePath: path, format: 'inline', lineNumber: parsed.lineNumber } });
 }
 native.reconcile(tasks, new Set());
 return { s, native, tasks, reads: () => reads };
}
test('shared native source projection separates file, inline and neighboring task values without extra reads', async () => {
 const f = await nativeFixture(); const access = createKanbanPropertyAccess(f.s, f.native);
 const expected = new Map([['file001',0],['line001',5],['line002',20]]);
 assert.equal(f.tasks.length, 3);
 const reads = f.reads(), projections = f.native.counters.projections;
 for (let i=0;i<100;i++) for (const task of f.tasks) {
  const result = access.read(task, ref('number')); assert.equal(result.state, 'ready', task.operonId);
  if (result.state === 'ready') assert.deepEqual(result.values, [{ kind: 'value', value: expected.get(task.operonId) }]);
 }
 assert.equal(f.reads(), reads); assert.ok(f.native.counters.projections - projections <= f.tasks.length);
 const missing = access.read(f.tasks[0], ref('text', 'Missing')); assert.equal(missing.state, 'empty');
 f.native.markPending(f.tasks[0].primary.filePath); assert.equal(access.read(f.tasks[0], ref('number')).state, 'pending');
 f.native.finishPending(f.tasks[0].primary.filePath);
 f.native.reconcile(f.tasks, new Set([f.tasks[0].operonId])); assert.equal(access.read(f.tasks[0], ref('number')).state, 'unavailable');
});

test('new axes survive settings/package round trips and normalization is idempotent', () => {
 const s = settings(); s.kanbanPresets[0].axes = axes(ref('number'), [{kind:'value',value:'01'},{kind:'value',value:1},{kind:'empty'}]);
 const normalized = migrateSettings(s), again = migrateSettings(normalized);
 assert.deepEqual(again, normalized);
 const pkg = buildOperonDataPackageFromSettings(normalized);
 const roundtrip = composeOperonSettingsFromDataPackage(pkg, DEFAULT_SETTINGS);
 assert.deepEqual(roundtrip.kanbanPresets, normalized.kanbanPresets);
 assert.equal(pkg.schemaVersion, buildOperonDataPackageFromSettings(settings()).schemaVersion);
 assert.deepEqual(decodeKanbanAxes(roundtrip.kanbanPresets[0].axes), decodeKanbanAxes(s.kanbanPresets[0].axes));
});
test('legacy projection is authoritative only when lossless and updates both representations', () => {
 const s = settings(), p = preset(); p.axes = { version:1, columns: {kind:'status',pipelineId:null}, swimlanes:null };
 const next = migrateSettings({ ...s, kanbanPresets:[p] }).kanbanPresets[0];
 assert.equal(next.pipelineId, null); assert.equal(next.swimlaneBy, null);
 updateKanbanLegacyAxes(next, { pipelineId:s.pipelines[0].id, swimlaneBy:'tags' }, s.keyMappings);
 assert.equal(resolveKanbanAxes(next).ok, true); assert.equal(projectKanbanLegacyAxes(next, s.keyMappings).ok, true);
 next.axes = axes(); assert.equal(projectKanbanLegacyAxes(next, s.keyMappings).ok, false);
 assert.throws(() => updateKanbanLegacyAxes(next, {swimlaneBy:null}, s.keyMappings));
 const board = queryKanbanBoard({preset:next,pipeline:s.pipelines[0],filterSet:null,tasks:[task()],priorities:s.priorities});
 assert.equal(board.cellMap.size,0); assert.equal(board.columns.length,0);
});
test('deep clones, malformed/future envelopes and default-preset migration preserve original content', () => {
 const p = preset(); p.axes = axes(ref('text'), [{kind:'value',value:'Unused'}]);
 const clone = normalizeBuiltInKanbanPreset(p); (clone.axes as KanbanAxes).columns = {kind:'status',pipelineId:null};
 assert.equal((p.axes as KanbanAxes).columns.kind,'property');
 for (const raw of [{version:99, future:{values:['keep']}}, {version:1,columns:null,swimlanes:null}, null, 'broken']) {
  const s = settings(); s.kanbanPresets[0].axes = raw;
  assert.deepEqual(migrateSettings(s).kanbanPresets[0].axes,raw);
  assert.throws(() => assertKanbanAxesWritable(s.kanbanPresets));
 }
});
test('custom field usage includes both axes, including hidden legacy swimlane fields', () => {
 const m = mapping(); const p = preset(); p.axes = axes(ref('number','effort','managed'));
 const summary=buildCustomFieldUsageSummaries({keyMappings:[m],filterSets:[],kanbanPresets:[p]});
 assert.deepEqual(summary[0].kanbanPresetNames,[p.name]);
});
test('backup export/import validation retains native axes and rejects invalid/future or missing managed references', () => {
 const s=settings(); s.kanbanPresets[0].axes=axes(ref('list','Topics'),[{kind:'value',value:'unused'},{kind:'empty'}]);
 const exported=exportOperonSettingsBackupJsonV1({settings:s,source:{pluginVersion:'4.3.0',obsidianVersion:'1.13.0',dataPackageSchemaVersion:2},createdAt:'2026-10-27T12:00:00.000Z'});
 assert.ok(exported.ok, JSON.stringify(exported.diagnostics));
 const parsed=parseOperonSettingsBackupV1(exported.json); assert.ok(parsed.ok);
 const decoded=validateOperonSettingsBackupGroupsV1(parsed.value.body.groups); assert.ok(decoded.ok,JSON.stringify(decoded.diagnostics));
 assert.deepEqual(decoded.payloads.kanban?.kanbanPresets[0].axes,s.kanbanPresets[0].axes);
 for (const raw of [{version:99}, axes(ref('number','deleted','managed'))]) {
  const groups: typeof parsed.value.body.groups=structuredClone(parsed.value.body.groups);
  (groups.kanban!.data as unknown as {kanbanPresets: typeof s.kanbanPresets}).kanbanPresets[0].axes=raw;
  assert.equal(validateOperonSettingsBackupGroupsV1(groups).ok,false);
 }
});

test('inactive swimlanes survive portable backups, validate references and remain separate from active lanes', () => {
 const s=settings(); const a=axes(ref('list','tags','managed')); a.inactiveSwimlanes={kind:'property',property:ref('list','tags','managed'),values:[{kind:'value',value:'book'},{kind:'empty'}]}; a.swimlanes=null;s.kanbanPresets[0].axes=a;
 const exported=exportOperonSettingsBackupJsonV1({settings:s,source:{pluginVersion:'4.3.0',obsidianVersion:'1.13.0',dataPackageSchemaVersion:2},createdAt:'2026-10-27T12:00:00.000Z'});assert.ok(exported.ok,JSON.stringify(exported.diagnostics));
 const parsed=parseOperonSettingsBackupV1(exported.json);assert.ok(parsed.ok);const decoded=validateOperonSettingsBackupGroupsV1(parsed.value.body.groups);assert.ok(decoded.ok,JSON.stringify(decoded.diagnostics));assert.deepEqual(decoded.payloads.kanban?.kanbanPresets[0].axes,a);
 assert.equal(decodeKanbanAxes({...a,swimlanes:a.inactiveSwimlanes}).ok,false);assert.equal(decodeKanbanAxes({...a,inactiveSwimlanes:{kind:'invalid'}}).ok,false);
 const invalid=structuredClone(parsed.value.body.groups);(invalid.kanban!.data as unknown as {kanbanPresets: typeof s.kanbanPresets}).kanbanPresets[0].axes={...a,inactiveSwimlanes:{kind:'status',pipelineId:'missing'}};assert.equal(validateOperonSettingsBackupGroupsV1(invalid).ok,false);
});

test('preset store clones callers, serializes saves and does not advance after rejection', async () => {
 const s=settings(), initial={kanbanPresets:s.kanbanPresets,kanbanDefaultPresetId:s.kanbanDefaultPresetId};
 const app={vault:{configDir:'.test',adapter:{exists:async()=>true}}} as unknown as App;
 const store=new KanbanPresetStore(app,new WriteQueue(),initial);
 const next=store.getAll(); next.kanbanPresets[0].axes=axes();
 store.setPackagePersistence(async()=>{throw new Error('injected rejection');});
 await assert.rejects(store.replaceAll(next),/injected/); assert.deepEqual(store.getAll(),initial);
 const writes: unknown[]=[]; store.setPackagePersistence(async value=>{writes.push(structuredClone(value));});
 await store.replaceAll(next);
 (next.kanbanPresets[0].axes as KanbanAxes).swimlanes={kind:'status',pipelineId:null};
 assert.equal((store.getAll().kanbanPresets[0].axes as KanbanAxes).swimlanes,null);
 const read=store.getAll(); (read.kanbanPresets[0].axes as KanbanAxes).columns={kind:'status',pipelineId:null};
 assert.equal((store.getAll().kanbanPresets[0].axes as KanbanAxes).columns.kind,'property');
 await store.replaceAll(store.getAll()); assert.equal(writes.length,1);
});

function packageHarness(initial: OperonDataPackageV1) {
 const paths=buildOperonStoragePaths('.test'); const disk=new Map<string,string>([[paths.dataPackagePath,JSON.stringify(initial,null,'\t')]]);
 let fail=false; const writes:string[]=[];
 const adapter={exists:async(p:string)=>disk.has(p),read:async(p:string)=>{if(!disk.has(p))throw new Error('missing');return disk.get(p)!;},
  write:async(p:string,s:string)=>{if(fail)throw new Error('injected');writes.push(p);disk.set(p,s);},remove:async(p:string)=>{disk.delete(p);},
  process:async(p:string,update:(s:string)=>string)=>{const next=update(disk.get(p)!);if(next!==disk.get(p)){if(fail)throw new Error('injected');writes.push(p);disk.set(p,next);}return next;}};
 const data={loadData:async()=>JSON.parse(disk.get(paths.dataPackagePath)!),saveData:async()=>assert.fail('unexpected Plugin.saveData')};
 const create=()=>new OperonDataPackageStore(adapter,paths,data);
 return {create,disk,writes,paths,setFail:(value:boolean)=>{fail=value;}};
}
test('real package initialize/reopen performs no axes migration writes; failed save preserves preimage',async()=>{
 const s=settings(); s.kanbanPresets[0].axes=axes(); const initial=buildOperonDataPackageFromSettings(s);
 const h=packageHarness(initial),before=h.disk.get(h.paths.dataPackagePath);
 const store=h.create();await store.initialize(DEFAULT_SETTINGS);assert.deepEqual(h.writes,[]);
 await h.create().initialize(DEFAULT_SETTINGS);assert.deepEqual(h.writes,[]);assert.equal(h.disk.get(h.paths.dataPackagePath),before);
 h.setFail(true);await assert.rejects(store.updateDataPackage(p=>({...p,views:{...p.views,kanbanPresets:{...p.views.kanbanPresets,kanbanPresets:[{...p.views.kanbanPresets.kanbanPresets[0],name:'Changed'}]}}})));
 assert.equal(h.disk.get(h.paths.dataPackagePath),before);
 h.setFail(false);await store.updateDataPackage(p=>({...p,views:{...p.views,kanbanPresets:{...p.views.kanbanPresets,kanbanPresets:[{...p.views.kanbanPresets.kanbanPresets[0],name:'Changed'}]}}}));
 assert.deepEqual(JSON.parse(h.disk.get(h.paths.dataPackagePath)!).views.kanbanPresets.kanbanPresets[0].axes,s.kanbanPresets[0].axes);
});
test('future axes survive initialization and unrelated saves cannot erase them',async()=>{
 const s=settings();s.kanbanPresets[0].axes={version:99,privateFuture:['retain']};const h=packageHarness(buildOperonDataPackageFromSettings(s));
 const before=h.disk.get(h.paths.dataPackagePath),store=h.create();await store.initialize(DEFAULT_SETTINGS);
 await assert.rejects(store.updateDataPackage(p=>({...p,views:{...p.views,kanbanPresets:{...p.views.kanbanPresets,kanbanPresets:[preset()]}}})),/Kanban axes/);
 assert.equal(h.disk.get(h.paths.dataPackagePath),before);assert.deepEqual(h.writes,[]);
});
test('existing modal draft and duplicate paths deep-clone axes; renderer has a compatibility guard',()=>{
 for(const file of ['src/ui/settings-tab.ts','src/ui/kanban/kanban-preset-quick-settings-modal.ts']) assert.match(readFileSync(file,'utf8'),/axes: cloneKanbanAxesPayload\(preset.axes\)/);
 assert.match(readFileSync('src/ui/kanban/kanban-view.ts','utf8'),/kanbanAxisReason\(reason \?\? 'unavailable'\)/);
});

test('deleted managed identity is not rebound to another field label', () => {
 const s=settings();s.keyMappings.push(mapping('replacement','deleted','text'));
 const access=createKanbanPropertyAccess(s,fakeIndex());
 assert.equal(access.resolve(ref('text','deleted','managed')).ok,false);
 assert.equal(access.resolve(ref('text','deleted','native')).ok,true);
});
test('legacy custom names do not collide with Object prototype fields', () => {
 for(const key of ['constructor','toString','hasOwnProperty']) {
  const p={...preset(),swimlaneBy:key};
  assert.equal(resolveKanbanAxes(p).ok,false);
  const result=resolveKanbanAxes(p,[mapping(key,key,'text')]);assert.ok(result.ok);
  assert.equal(result.axes.swimlanes?.kind,'property');
  if(result.axes.swimlanes?.kind==='property')assert.equal(result.axes.swimlanes.property.type,'text');
 }
});
test('standard Obsidian tags declaration does not hide managed Tags', () => {
 const access=createKanbanPropertyAccess(settings(),fakeIndex({tags:'tags'}));
 assert.ok(access.resolve(ref('list','tags','managed')).ok);
});
test('description axes survive portable backup validation', () => {
 const s=settings();s.kanbanPresets[0].axes=axes(ref('text','description','managed'));
 const result=exportOperonSettingsBackupJsonV1({settings:s,source:{pluginVersion:'4.3.0',obsidianVersion:'1.13.0',dataPackageSchemaVersion:2},createdAt:'2026-10-27T12:00:00.000Z'});
 assert.ok(result.ok,JSON.stringify(result.diagnostics));
});

test('axis changes invalidate an in-flight legacy drop signature', () => {
 const p=preset(), pipeline=settings().pipelines[0];
 const legacy=buildKanbanDropBoardSignature(p,pipeline);
 assert.equal(legacy,buildKanbanDropBoardSignature({...p,axes:undefined},pipeline));
 const modern={...p,axes:{version:1,columns:{kind:'status',pipelineId:p.pipelineId},swimlanes:null}};
 assert.notEqual(legacy,buildKanbanDropBoardSignature(modern,pipeline));
 assert.notEqual(buildKanbanDropBoardSignature(modern,pipeline),buildKanbanDropBoardSignature({...p,axes:axes()},pipeline));
 const main=readFileSync('main.ts','utf8');
 assert.match(main,/kanbanAxesCanCommit/);
});

 test('authoritative axes do not depend on stale legacy axis references during backup', () => {
 const s=settings(); s.kanbanPresets[0].axes=axes(ref('text','Topics'));
 s.kanbanPresets[0].pipelineId='removed-legacy-pipeline'; s.kanbanPresets[0].swimlaneBy='removed-legacy-field';
 const result=exportOperonSettingsBackupJsonV1({settings:s,source:{pluginVersion:'4.3.0',obsidianVersion:'1.13.0',dataPackageSchemaVersion:2},createdAt:'2026-10-27T12:00:00.000Z'});
 assert.ok(result.ok,JSON.stringify(result.diagnostics));
 });
