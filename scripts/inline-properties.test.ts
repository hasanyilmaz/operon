import path from 'node:path';
import { tmpdir } from 'node:os';
import { getNativePropertyIndex } from '../src/indexer/native-property-index';
import { scanFileWithMappings } from '../src/indexer/file-scanner';
import type { ObsidianPropertyTypeId } from '../src/core/property-type-registry';
import { planTaskIdRepairSources } from '../src/core/task-id-repair-sources';
import { stringifyYaml } from 'obsidian';
import { queryTableRows } from '../src/systems/table-query';
import { createDefaultTablePreset } from '../src/types/table';
import { createTableTaskSearchMatcherCache } from '../src/ui/table/table-search';
import { loadTableNativePropertySnapshot, getTableNativePropertySnapshot, writeTableNativeProperty } from '../src/ui/table/table-native-property';
import { getTableFilePropertyIndex, encodeTableFilePropertyColumnKey, type TableFilePropertySnapshot } from '../src/ui/table/table-file-property';
import type { IndexedTask } from '../src/types/fields';
import { nativeEditorPropertyTypes, nativePropertyReadOnlyReason } from '../src/core/task-editor-native-properties';
import { applyYamlTaskFieldValues } from '../src/core/task-writer-yaml';
import { readYamlFields } from '../src/core/yaml-fields';
import { prepareRuntimeTaskFieldMutationV1, type RuntimeExactTaskMutationSnapshotV1 } from '../src/agent-runtime/runtime/task-mutation-adapter';
import { buildLivePropertyCatalogV1 } from '../src/agent-runtime/runtime/catalog-builder';
import { exportOperonSettingsBackupJsonV1 } from '../src/core/settings-backup-export';
import { preflightOperonSettingsBackupRestoreV1 } from '../src/core/settings-backup-preflight';
import { createOperonSettingsBackupApplyAcknowledgementV1, projectOperonSettingsBackupApplyDataPackageV1 } from '../src/core/settings-backup-apply';
import test from 'node:test';
import assert from 'node:assert/strict';
import { TFile, type App } from 'obsidian';
import { parseTaskLine } from '../src/core/parser';
import { serializeTask } from '../src/core/serializer';
import { TaskWriter, tryPatchYamlTaskContent, tryDetachYamlTaskPropertiesContent, type TaskWriterIndexerPort } from '../src/core/task-writer';
import { mutateInlineListMember, findInlinePropertyTask, mergeInlineEditorSource, prepareMappedInlineProperties, readInlinePropertyProjection, patchInlineProperties, mergeInlinePropertyDraft, type InlinePropertyChange } from '../src/core/inline-property-source';
import { decodeVaultPropertyValue, encodeVaultPropertyValue, type VaultPropertyValue } from '../src/core/vault-property-codec';
import { retainInlinePropertyDefinition, reconcileInlinePropertyDefinitions, resolveInlinePropertyDefinition, mergeImportedInlinePropertyDefinitions, type InlinePropertyDefinitions, type InlinePropertyType } from '../src/core/inline-property-definitions';
import { canApplyFileTaskPropertyChanges, readFileTaskPropertyDocument } from '../src/core/file-task-property-draft';
import { DEFAULT_SETTINGS, migrateSettings, type KeyMapping } from '../src/types/settings';
import { buildOperonDataPackageFromSettings, isStructurallyCompleteOperonDataPackageV1 } from '../src/storage/operon-data-package';
import { withSettingsFixture } from './test-support/settings-preservation-harness';
import { prepareInlinePropertyUpgradeBackup } from '../src/storage/inline-property-upgrade';

const samples: [InlinePropertyType, VaultPropertyValue][] = [
 ['text', ''], ['text', '3'], ['text', 'a; "x" \\ \\u000A {{end}} [[Link|x]]\nnext\r\nlast'],
 ['list', []], ['list', ['']], ['list', [3, '3', 'Ali', 'Ali', 0, '0']],
 ['list', ['semi;colon', '"quoted"', '\\', '{{x}}', '[[Note|Alias; x]]', '\n', '\r\n']],
 ['number', 0], ['number', -0], ['number', 3.5], ['number', null],
 ['checkbox', false], ['checkbox', true], ['checkbox', null],
 ['date', '2024-02-29'], ['date', null], ['datetime', '2026-10-08T13:24:59+02:00'], ['datetime', null],
];
for (const [index, [type, value]] of samples.entries()) test('native codec / parser / serializer round trip ' + index, () => {
 const raw = encodeVaultPropertyValue(value, type);
 assert.deepEqual(decodeVaultPropertyValue(raw, type), value);
 const line = '- [ ] Fixture {{operonId:: ABC1234}} {{Value:: ' + raw + '}}';
 const parsed = parseTaskLine(line, 0, 'Notes.md', [])!;
 assert.ok(parsed);
 assert.deepEqual(readInlinePropertyProjection(serializeTask(parsed), 'Notes.md', {Value: type}, [])!.properties[0].value, value);
});
test('legacy quotes, ordering, duplicate members and source token spacing survive unrelated save', () => {
 const mapping: KeyMapping = { canonicalKey:'Scores', visiblePropertyName:'Scores', type:'list', enabled:true, sync:'auto', isSystem:false };
 const source = '- [ ] A {{datetimeModified:: 2026-10-08T12:00:00}} {{ Raw :: 3; "3"; Ali; Ali}} {{Scores:: "3"; "3"}} {{priority:: A}} {{datetimeCreated:: 2026-10-08T10:00:00}} {{operonId:: ABC1234}}';
 const parsed = parseTaskLine(source, 0, 'Notes.md', [mapping])!;
 const output = serializeTask(parsed, [mapping]);
 assert.ok(output.includes('{{ Raw :: 3; "3"; Ali; Ali}}'));
 assert.ok(output.indexOf('{{priority') < output.indexOf('{{Scores'));
 assert.ok(output.indexOf('{{Scores') < output.indexOf('{{ Raw'));
 assert.ok(output.indexOf('{{ Raw') < output.indexOf('{{datetimeCreated'));
 assert.ok(output.indexOf('{{datetimeCreated') < output.indexOf('{{datetimeModified'));
 assert.deepEqual(readInlinePropertyProjection(output, 'Notes.md', {Scores:'list'}, [mapping])!.properties[0].value, ['"3"','"3"']);
});
test('identity, raw CAS, duplicate aliases, unsupported values and position edits', () => {
 const defs = retainInlinePropertyDefinition(undefined, {sourceName:'Values',type:'list',encoding:'vault-v1'});
 const line = '  - [ ] A {{operonId:: ABC1234}} {{Values:: 3; "3"; Ali; Ali}}';
 const change: InlinePropertyChange = {sourceName:'Values',type:'list',expected:{present:true,rawValue:'3; "3"; Ali; Ali'},mutation:{kind:'set',value:[3,'3','Ali']}};
 const content = '---\nValues: host\n---\nneighbor\n'+line+'\n- [ ] Neighbor {{operonId:: XYZ1234}} {{Values:: 999}}\n';
 const updated = patchInlineProperties(content, 'Notes.md', 'ABC1234', [change], [], defs);
 assert.ok(updated.startsWith('---\nValues: host\n---\nneighbor\n  - [ ]'));
 assert.ok(updated.endsWith('\n- [ ] Neighbor {{operonId:: XYZ1234}} {{Values:: 999}}\n'));
 assert.deepEqual(readInlinePropertyProjection(updated.split('\n')[4], 'Notes.md', {Values:'list'}, [], defs)!.properties[0].value,[3,'3','Ali']);
 assert.throws(()=>patchInlineProperties(updated, 'Notes.md', 'ABC1234', [change], [], defs), /source conflict/);
 assert.throws(()=>patchInlineProperties(content+'\n'+line, 'Notes.md', 'ABC1234', [change], [], defs), /identity conflict/);
 assert.throws(()=>patchInlineProperties(content.replace('ABC1234','removed'), 'Notes.md', 'ABC1234', [change], [], defs), /identity conflict/);
 assert.throws(()=>patchInlineProperties(line+' {{Values:: 5}}', 'Notes.md', 'ABC1234', [change], [], defs), /alias conflict/);
 assert.throws(()=>decodeVaultPropertyValue('9007199254740993','number'));
 assert.throws(()=>decodeVaultPropertyValue('2026-02-30','date'));
 assert.throws(()=>decodeVaultPropertyValue('3; ; 5','list'));
 assert.equal(canApplyFileTaskPropertyChanges({Values:[3,'3','Ali','Ali']}, [{propertyName:'Values',expected:{present:true,value:[3,'3','Ali','Ali']},value:[3,'3','Ali']}], []),true);
 assert.equal(canApplyFileTaskPropertyChanges({Values:{nested:3}}, [{propertyName:'Values',expected:{present:true,value:[]},value:[]}], []),false);
});
test('mapping promotion, removal, rename, alias collision and reset retain interpretation', () => {
 const base = {canonicalKey:'Values',visiblePropertyName:'Values',type:'list',enabled:true,sync:'auto',isSystem:false} as KeyMapping;
 let defs = retainInlinePropertyDefinition(undefined,{sourceName:'Values',type:'list',encoding:'vault-v1'});
 defs = reconcileInlinePropertyDefinitions([], [base], defs)!;
 assert.equal(resolveInlinePropertyDefinition('Values','list',[base],defs).encoding,'vault-v1');
 defs = reconcileInlinePropertyDefinitions([base], [], defs)!;
 assert.equal(resolveInlinePropertyDefinition('Values','list',[],defs).encoding,'vault-v1');
 const renamed={...base,visiblePropertyName:'Renamed'};
 defs = reconcileInlinePropertyDefinitions([base],[renamed],defs)!;
 assert.equal(resolveInlinePropertyDefinition('Renamed','list',[renamed],defs).encoding,'vault-v1');
 assert.throws(()=>reconcileInlinePropertyDefinitions([base],[{...base,type:'number'}],defs));
 assert.throws(()=>reconcileInlinePropertyDefinitions([], [base,{...base,canonicalKey:'Other'}], defs));
 const legacy = mergeImportedInlinePropertyDefinitions([base],[],undefined,undefined,[]);
 assert.equal(resolveInlinePropertyDefinition('Values','list',[],legacy).encoding,'legacy');
});
test('new local edits survive source reconciliation',()=>{
 const submitted=[{sourceName:'Value',type:'text' as const,present:true,value:'old',rawValue:'old',state:'valid' as const}];
 const current=[{...submitted[0],value:'new local'}];
 assert.deepEqual(mergeInlinePropertyDraft(current,submitted,[{...submitted[0],value:'committed'}]),current);
});

test('fences and frontmatter cannot supply task identity, but moved executable tasks remain writable', () => {
 const line='- [ ] Task {{operonId:: ABC1234}} {{Values:: 3}}';
 for (const source of ['---\nExample: |\n  '+line+'\n---\nbody', '\x60\x60\x60md\n'+line+'\n\x60\x60\x60', '~~~md\n'+line+'\n~~~']) {
  assert.equal(findInlinePropertyTask(source,'Note.md','ABC1234',[]),null);
  assert.throws(()=>patchInlineProperties(source,'Note.md','ABC1234',[],[]),/identity/);
 }
 const moved='header\n\x60\x60\x60md\n'+line+'\n\x60\x60\x60\nnew heading\n'+line;
 assert.equal(findInlinePropertyTask(moved,'Note.md','ABC1234',[])?.index,5);
});
test('editor rebases current raw tokens, duplicates and empty mapped values, without losing local managed edits',()=>{
 const mappings:KeyMapping[]=[{canonicalKey:'Values',visiblePropertyName:'Values',type:'list',enabled:true,isSystem:false,sync:'auto'}];
 const before='- [ ] Before {{operonId:: ABC1234}} {{Values:: }} {{Other:: one}} {{Other:: two}}';
 const submitted='- [ ] Edited {{operonId:: ABC1234}} {{Values:: }} {{Other:: two}} {{priority:: A}}';
 const fresh=before.replace('Other:: one','Other:: new');
 const result=mergeInlineEditorSource(fresh,submitted,parseTaskLine(before,0,'',mappings)!.fields,mappings)!;
 assert.ok(result.includes('Edited'));
 assert.ok(result.includes('{{Other:: new}} {{Other:: two}}'));
 assert.ok(result.includes('{{Values:: }}'));
 assert.ok(result.includes('{{priority:: A}}'));
 assert.equal(mergeInlineEditorSource(before.replace('Values:: ','Values:: 9'),submitted.replace('Values:: ','Values:: 4'),parseTaskLine(before,0,'',mappings)!.fields,mappings),null);
});
test('mapped native preparation and real guarded writer keep public string list members as strings',()=>{
 const mapping:KeyMapping={canonicalKey:'Values',visiblePropertyName:'Values',type:'list',enabled:true,isSystem:false,sync:'auto'};
 const definitions=retainInlinePropertyDefinition(undefined,{sourceName:'Values',type:'list',encoding:'vault-v1'});
 const source='- [ ] A {{operonId:: ABC1234}} {{Values:: 3; "3"; Ali}}';
 const prepared=prepareMappedInlineProperties(source,'Notes.md','ABC1234',[{field:'Values',value:['3','a;b','Ali','Ali','\\','\n']}],[mapping],definitions);
 const writer=new TaskWriter({} as App,{} as TaskWriterIndexerPort,[mapping],{getInlinePropertyDefinitions:()=>definitions});
 const rendered=writer.renderGuardedTaskSourceContent('Notes.md',source,[{operonId:'ABC1234',format:'inline',fieldValues:prepared.fieldValues,inlinePropertyDraft:prepared.changes}]);
 assert.equal(rendered.ok,true);
 assert.deepEqual(readInlinePropertyProjection(rendered.content,'Notes.md',{Values:'list'},[mapping],definitions)!.properties[0].value,['3','a;b','Ali','Ali','\\','\n']);
 const clear=prepareMappedInlineProperties(rendered.content,'Notes.md','ABC1234',[{field:'Values',value:[]}],[mapping],definitions);
 const emptied=writer.renderGuardedTaskSourceContent('Notes.md',rendered.content,[{operonId:'ABC1234',format:'inline',fieldValues:clear.fieldValues,inlinePropertyDraft:clear.changes}]);
 assert.equal(emptied.ok,true);
 assert.deepEqual(readInlinePropertyProjection(emptied.content,'Notes.md',{Values:'list'},[mapping],definitions)!.properties[0].value,[]);
 const remove=prepareMappedInlineProperties(emptied.content,'Notes.md','ABC1234',[{field:'Values'}],[mapping],definitions);
 const removed=writer.renderGuardedTaskSourceContent('Notes.md',emptied.content,[{operonId:'ABC1234',format:'inline',fieldValues:remove.fieldValues,inlinePropertyDraft:remove.changes}]);
 assert.equal(readInlinePropertyProjection(removed.content,'Notes.md',{Values:'list'},[mapping],definitions)!.properties[0].present,false);
});
test('native no-op empty list survives another guarded change and moved target ignores fenced copy',()=>{
 const mapping:KeyMapping={canonicalKey:'Values',visiblePropertyName:'Values',type:'list',enabled:true,isSystem:false,sync:'auto'};
 const definitions=retainInlinePropertyDefinition(undefined,{sourceName:'Values',type:'list',encoding:'vault-v1'});
 const source='\x60\x60\x60md\n- [ ] Example {{operonId:: ABC1234}}\n\x60\x60\x60\nspacer\n- [ ] Real {{operonId:: ABC1234}} {{Values:: }}';
 const prepared=prepareMappedInlineProperties(source,'Notes.md','ABC1234',[{field:'Values',value:[]}],[mapping],definitions);
 const writer=new TaskWriter({} as App,{} as TaskWriterIndexerPort,[mapping],{getInlinePropertyDefinitions:()=>definitions});
 const result=writer.renderGuardedTaskSourceContent('Notes.md',source,[{operonId:'ABC1234',format:'inline',lineNumber:0,fieldValues:{...prepared.fieldValues,priority:'A'},inlinePropertyDraft:prepared.changes}]);
 assert.equal(result.ok,true);
 assert.equal(result.content.split('\n')[1],source.split('\n')[1]);
 assert.deepEqual(readInlinePropertyProjection(result.content.split('\n')[4],'Notes.md',{Values:'list'},[mapping],definitions)!.properties[0].value,[]);
 assert.ok(result.content.split('\n')[4].includes('{{priority:: A}}'));
 const ambiguous=writer.renderGuardedTaskSourceContent('Notes.md',source,[{operonId:'ABC1234',format:'inline',fieldValues:{Values:'3; x'}}]);
 assert.equal(ambiguous.ok,false); assert.equal(ambiguous.content,source);
});
test('member removal changes only the selected duplicate position',()=>{
 const property=readInlinePropertyProjection('- [ ] A {{operonId:: ABC1234}} {{Values:: Ali; 3; Ali; "3"}}','N.md',{Values:'list'},[])!.properties[0];
 assert.deepEqual(mutateInlineListMember(property,0,{kind:'remove'}).mutation,{kind:'set',value:[3,'Ali','3']});
 assert.deepEqual(mutateInlineListMember(property,2,{kind:'set',value:0}).mutation,{kind:'set',value:['Ali',3,0,'3']});
 assert.throws(()=>mutateInlineListMember(property,-1,{kind:'remove'}));
});
test('first install retains schema 2 and explicit save is required for interpretation metadata',async()=>{
 await withSettingsFixture({initialRaw:null,table:false,inlinePropertyBackups:true},async fixture=>{
  const storage=fixture.createStorage();await storage.initialize();
  assert.equal(fixture.package().schemaVersion,2);
  assert.equal(storage.getCommittedInlinePropertyDefinitions(),undefined);
 });
});
test('external downgrade cannot trigger schema upgrade or lose definitions during reload',async()=>{
 await withSettingsFixture({initialRaw:defaultPackage(),table:false,inlinePropertyBackups:true},async fixture=>{
  const storage=fixture.createStorage();await storage.initialize();
  await storage.ensureInlinePropertyDefinitions([{sourceName:'Values',type:'list',encoding:'vault-v1'}]);
  fixture.seed(fixture.canonicalPath,defaultPackage());
  const before=fixture.raw(), attempts=fixture.canonicalAttempts;
  await assert.rejects(storage.reloadCanonicalSettingsPackage(),/interpretation metadata/);
  assert.equal(fixture.raw(),before); assert.equal(fixture.canonicalAttempts,attempts);
  assert.equal(storage.getCommittedInlinePropertyDefinitions()!.entries[0].encoding,'vault-v1');
 });
});
test('cancellation after verified backup never upgrades or publishes definitions',async()=>{
 await withSettingsFixture({initialRaw:defaultPackage(),table:false,inlinePropertyBackups:true},async fixture=>{
  const storage=fixture.createStorage();await storage.initialize();
  const before=fixture.raw();let allowed=true;
  const write=fixture.adapter.write;
  fixture.adapter.write=async(path,contents)=>{await write(path,contents);if(path.includes('/inline-properties/'))allowed=false;};
  await assert.rejects(storage.ensureInlinePropertyDefinitions([{sourceName:'Values',type:'list',encoding:'vault-v1'}],()=>allowed),/cancelled/);
  assert.equal(fixture.raw(),before);assert.equal(storage.getCommittedInlinePropertyDefinitions(),undefined);
 });
});
test('actual Runtime adapter retains public string[] through native source preparation and guarded render',()=>{
 const mapping:KeyMapping={canonicalKey:'Values',visiblePropertyName:'Values',type:'list',enabled:true,isSystem:false,sync:'auto'};
 const definitions=retainInlinePropertyDefinition(undefined,{sourceName:'Values',type:'list',encoding:'vault-v1'});
 const settings=migrateSettings({...DEFAULT_SETTINGS,keyMappings:[...DEFAULT_SETTINGS.keyMappings,mapping],inlinePropertyDefinitions:definitions});
 const catalog=buildLivePropertyCatalogV1(settings);assert.equal(catalog.ok,true);if(!catalog.ok)throw new Error('catalog');
 const task:RuntimeExactTaskMutationSnapshotV1={operonId:'ABC1234',locator:{representation:'inline',filePath:'Notes.md',lineNumber:0},description:'A',checkbox:'open',tags:[],fieldValues:{Values:''},sourceContent:'- [ ] A {{operonId:: ABC1234}} {{Values:: }}',duplicate:false};
 const writer=new TaskWriter({} as App,{} as TaskWriterIndexerPort,settings.keyMappings,{getInlinePropertyDefinitions:()=>definitions});
 for(const values of [[],['3','a;b','Ali','Ali']] ){
  const result=prepareRuntimeTaskFieldMutationV1({
   contractVersion:1,requestId:'native',kind:'mutation-preview',clientInstanceId:'test',idempotencyKey:'native',capability:'tasks.update.preview',mutationKind:'task.update',
   target:{operonId:task.operonId,locator:task.locator},authorization:{basis:'user-explicit-request'},
   spec:{operation:'update',changes:[{field:'Values',valueType:'list',value:values},{field:'description',valueType:'text',value:'Changed'}]},
  },'2026-10-08T12:00:00.000Z',{catalog:catalog.value,getTask:()=>task,
   prepareInlineProperties:(current,changes)=>prepareMappedInlineProperties(current.sourceContent,current.locator.filePath,current.operonId,changes,settings.keyMappings,definitions)});
  assert.equal(result.ok,true);
  const rendered=writer.renderGuardedTaskSourceContent('Notes.md',task.sourceContent,[{operonId:task.operonId,format:'inline',fieldValues:{...result.value.fieldValues},inlinePropertyDraft:result.value.inlinePropertyDraft}]);
  assert.equal(rendered.ok,true);
  assert.deepEqual(readInlinePropertyProjection(rendered.content,'Notes.md',{Values:'list'},settings.keyMappings,definitions)!.properties[0].value,values);
 }
});
test('file custom promotion preserves mixed lists, empty and nested values on unrelated full save',()=>{
 const mappings:KeyMapping[]=[{canonicalKey:'Values',visiblePropertyName:'Values',type:'list',enabled:true,isSystem:false,sync:'auto'}];
 for(const value of [[3,'3','Ali','Ali'],[],[''],{nested:['keep']},null]){
  const fm={operonId:'ABC1234',Values:value,priority:'B'};
  const projection=readYamlFields(fm,mappings);
  applyYamlTaskFieldValues(fm,{...projection,priority:'A'},'replace',mappings);
  assert.deepEqual(fm.Values,value);
 }
 const fm={Values:[3,'3','Ali']};
 applyYamlTaskFieldValues(fm,{priority:'A'},'merge',mappings);
 assert.deepEqual(fm.Values,[3,'3','Ali']);
 assert.throws(()=>applyYamlTaskFieldValues(fm,{Values:'4; Ali'},'replace',mappings),/typed property/);
});
for (const format of ['inline', 'yaml'] as const) for (const failure of ['none', 'before', 'after'] as const) test(`native ${format} draft uses the guarded source (${failure})`, async () => {
 const file = new TFile(...(['Drawing.md'] as unknown as []));
 Object.assign(file, { path: 'Drawing.md', stat: { ctime: 1, mtime: 1, size: 0 } });
 const disk = format === 'inline' ? '- [ ] Old {{operonId:: ABC1234}}' : '---\noperonId: ABC1234\nValues: old\n---\nOld body';
 const before = disk.replace('Old', 'Unsaved');
 let native = before, writes = 0;
 let definitions: InlinePropertyDefinitions | undefined;
 const source = { file, read: async () => native, write: async (expected: string, next: string) => {
  assert.equal(native, expected);
  if (failure === 'before') throw new Error('Source rejected');
  native = next; writes++;
  if (failure === 'after') throw new Error('Acknowledgment lost');
  return native;
 } };
 const app = { vault: { getAbstractFileByPath: () => file, read: async () => disk,
  process: async () => assert.fail('Guarded source must own every write'),
 } } as unknown as App;
 const indexer = { getTask: () => ({ operonId: 'ABC1234', primary: { format, filePath: file.path, lineNumber: 0 }, fieldValues: {} }),
  hasDuplicateOperonIdConflict: () => false, isPathIndexable: () => true, scheduleReindex: () => {},
 } as unknown as TaskWriterIndexerPort;
 const writer = new TaskWriter(app, indexer, [], {
  withMarkdownSource: async (_file, operation) => operation(source),
  getInlinePropertyDefinitions: () => definitions,
  prepareInlineProperties: async entries => { for (const entry of entries) definitions = retainInlinePropertyDefinition(definitions, entry); return definitions!; },
 });
 const operation = () => writer.writeTaskFields('ABC1234', {}, format === 'inline'
  ? { inlinePropertyDraft: [{ sourceName: 'Values', type: 'text', expected: { present: false }, mutation: { kind: 'set', value: 'new' } }] }
  : { filePropertyDraft: { changes: [{ propertyName: 'Values', nativeType: 'text', expected: { present: true, value: 'old' }, value: 'new' }] } });
 if (failure === 'before') { await assert.rejects(operation, /Source rejected/); assert.equal(native, before); assert.equal(writes, 0); }
 else { assert.equal(await operation(), true); assert.equal(writes, 1); assert.ok(native.includes('Unsaved')); assert.ok(native.includes('new')); }
});
test('inline native preflight and projection respect an already bound source', async () => {
 const f = writerFixture();
 // The source binding is keyed by the vault TFile identity.
 const boundFile = (f.writer as unknown as { app: App }).app.vault.getAbstractFileByPath('Notes.md') as TFile;
 let native = f.get().replace('Target {{operonId:: ABC1234}}', 'Target {{operonId:: ABC1234}} {{Values:: native}}');
 const disk = f.get();
 await f.writer.withMarkdownSource({ file: boundFile, read: async () => native, write: async (expected, next) => { assert.equal(native, expected); native = next; return next; } }, async () => {
  const projection = await f.writer.readInlineProperties('ABC1234', { Values: 'text' });
  const property = projection!.properties.find(item => item.sourceName === 'Values')!;
  assert.equal(property.value, 'native');
  assert.equal(await f.writer.writeTaskFields('ABC1234', {}, { inlinePropertyDraft: [{ sourceName: 'Values', type: 'text', expected: { present: true, rawValue: property.rawValue }, mutation: { kind: 'set', value: 'changed' } }] }), true);
 });
 assert.ok(native.includes('changed'));
 assert.equal(f.get(), disk);
});
function writerFixture() {
 let content='---\nValues: host\n---\n  - [ ] Target {{operonId:: ABC1234}}\n- [ ] Other {{operonId:: XYZ1234}} {{Values:: untouched}}';
 const file = new TFile(...(['Notes.md'] as unknown as []));
 Object.assign(file,{path:'Notes.md',stat:{ctime:1,mtime:1,size:0}});
 let definitions: InlinePropertyDefinitions | undefined;
 let duplicate=false, missing=false;
 let beforeProcess: (() => void) | undefined;
 const app={vault:{getAbstractFileByPath:()=>file, read:async()=>content, modify:async(_file:TFile,next:string)=>{content=next;},
  process:async(_file: TFile,callback:(source:string)=>string)=>{const pending=beforeProcess;beforeProcess=undefined;pending?.();content=callback(content);return content;}}} as unknown as App;
 const indexer={getTask:(id:string)=>missing||id!=='ABC1234'?null:{operonId:id,primary:{format:'inline',filePath:file.path,lineNumber:0},fieldValues:{}},
  hasDuplicateOperonIdConflict:()=>duplicate,isPathIndexable:()=>true,reindexFilePath:async()=>{},reindexFilesBatch:async()=>{},scheduleReindex:()=>{}} as unknown as TaskWriterIndexerPort;
 const writer = new TaskWriter(app,indexer,[],{
  getInlinePropertyDefinitions:()=>definitions,
  prepareInlineProperties:async entries=>{for(const entry of entries)definitions=retainInlinePropertyDefinition(definitions,entry);return definitions!;}
 });
 return {writer,beforeProcess:(callback:()=>void)=>{beforeProcess=callback;},get:()=>content,set:(value:string)=>{content=value;},duplicate:()=>{duplicate=true;},missing:()=>{missing=true;}};
}
test('real TaskWriter: 24 cycles preserve types, host YAML, neighbors and raw on canonical saves',async()=>{
 const fixture=writerFixture();
 for(let iteration=0;iteration<24;iteration++){
  const snapshot=await fixture.writer.readInlineProperties('ABC1234',{Values:'list'});
  const property=snapshot!.properties[0];
  const value: (string|number)[]=[iteration,'3','Ali','Ali','a;b','[[Link|x]]','\\','\n'];
  assert.equal(await fixture.writer.writeTaskFields('ABC1234',{priority:'A'},{
   inlinePropertyDraft:[{sourceName:'Values',type:'list',expected:{present:property.present,rawValue:property.rawValue},mutation:{kind:'set',value}}],
   reindex:'scheduled'}),true);
  assert.deepEqual((await fixture.writer.readInlineProperties('ABC1234',{Values:'list'}))!.properties[0].value,value);
  assert.equal(await fixture.writer.writeTaskFields('ABC1234',{priority:'B'}),true);
  assert.deepEqual((await fixture.writer.readInlineProperties('ABC1234',{Values:'list'}))!.properties[0].value,value);
  assert.ok(fixture.get().startsWith('---\nValues: host\n---\n  - [ ]'));
  assert.ok(fixture.get().endsWith('\n- [ ] Other {{operonId:: XYZ1234}} {{Values:: untouched}}'));
 }
 const before=fixture.get();fixture.duplicate();
 assert.equal(await fixture.writer.writeTaskFields('ABC1234',{}, {inlinePropertyDraft:[{sourceName:'Values',type:'list',expected:{present:false},mutation:{kind:'set',value:[]}}]}),false);
 assert.equal(fixture.get(),before);
});

test('regular TaskWriter uses atomic fresh source after an external edit',async()=>{
 const fixture=writerFixture();
 fixture.beforeProcess(()=>fixture.set('Inserted heading\n'+fixture.get().replace('Values:: untouched','Values:: newer')));
 assert.equal(await fixture.writer.writeTaskFields('ABC1234',{priority:'A'}),true);
 assert.ok(fixture.get().startsWith('Inserted heading\n'));
 assert.ok(fixture.get().endsWith('{{Values:: newer}}'));
 assert.ok(fixture.get().includes('{{priority:: A}}'));
});
test('editor preserves fresh Vault source ordering and interleaved duplicate tokens',()=>{
 const before='- [ ] A {{operonId:: ABC1234}} {{First:: one}} {{Second:: two}} {{First:: three}}';
 const fresh='- [ ] A {{operonId:: ABC1234}} {{Second:: two}} {{First:: one}} {{First:: three}}';
 const result=mergeInlineEditorSource(fresh,before.replace('] A ','] Edited '),parseTaskLine(before,0,'',[])!.fields,[])!;
 assert.ok(result.includes('{{Second:: two}} {{First:: one}} {{First:: three}}'));
});
test('index settings use committed mappings until the complete settings save succeeds',async()=>{
 await withSettingsFixture({initialRaw:defaultPackage(),table:false,inlinePropertyBackups:true},async fixture=>{
  const storage=fixture.createStorage();await storage.initialize();
  const before=storage.getSettings({committedMappings:true}).keyMappings;
  storage.getSettings().keyMappings.push({canonicalKey:'NewValue',visiblePropertyName:'NewValue',type:'list',isSystem:false,enabled:true,sync:'auto'});
  assert.deepEqual(storage.getSettings({committedMappings:true}).keyMappings,before);
  await storage.saveSettings();
  assert.equal(storage.getSettings({committedMappings:true}).keyMappings.at(-1)!.canonicalKey,'NewValue');
  assert.equal(storage.getSettings({committedMappings:true}).inlinePropertyDefinitions!.entries.at(-1)!.encoding,'vault-v1');
 });
});
test('external schema downgrade is rejected even when the schema 3 registry is empty',async()=>{
 const initial=JSON.parse(defaultPackage());initial.schemaVersion=3;initial.taxonomy.inlinePropertyDefinitions={version:1,entries:[]};
 await withSettingsFixture({initialRaw:JSON.stringify(initial),table:false,inlinePropertyBackups:true},async fixture=>{
  const storage=fixture.createStorage();await storage.initialize();
  fixture.seed(fixture.canonicalPath,defaultPackage());const attempts=fixture.canonicalAttempts;
  await assert.rejects(storage.reloadCanonicalSettingsPackage(),/interpretation metadata/);
  assert.equal(fixture.canonicalAttempts,attempts);
 });
});

test('file TaskWriter preserves mixed member types, duplicates, nested neighbors and inline source',async()=>{
 let content='---\noperonId: ABC1234\nValues: [3, "3", Ali, Ali]\nNested:\n  keep: yes\n---\n- [ ] Inline {{operonId:: XYZ1234}} {{Values:: 9}}\n';
 const file=new TFile(...(['File.md'] as unknown as []));Object.assign(file,{path:'File.md',stat:{ctime:1}});
 const app={vault:{getAbstractFileByPath:()=>file,read:async()=>content,process:async(_file:TFile,fn:(s:string)=>string)=>{content=fn(content);return content;}}} as unknown as App;
 const indexer={getTask:(id:string)=>id==='ABC1234'?{operonId:id,primary:{format:'yaml',filePath:file.path,lineNumber:0},fieldValues:{}}:null,
 hasDuplicateOperonIdConflict:()=>false,isPathIndexable:()=>true,reindexFilePath:async()=>{},reindexFilesBatch:async()=>{},scheduleReindex:()=>{}} as unknown as TaskWriterIndexerPort;
 const writer=new TaskWriter(app,indexer,[]);
 for(let index=0;index<20;index++){
  const document=readFileTaskPropertyDocument(content)!;
  assert.equal(await writer.writeTaskFields('ABC1234',{}, {mode:'merge',filePropertyDraft:{changes:[{propertyName:'Values',expected:{present:true,value:document.frontmatter.Values as (string|number)[]},value:[index,'3','Ali','Ali']}]}}),true);
  const fresh=readFileTaskPropertyDocument(content)!;
  assert.deepEqual(fresh.frontmatter.Values,[index,'3','Ali','Ali']);
  assert.deepEqual(fresh.frontmatter.Nested,{keep:'yes'});
  assert.equal(fresh.body,'- [ ] Inline {{operonId:: XYZ1234}} {{Values:: 9}}\n');
 }
});
test('mapping save failure never publishes pending aliases; success and reset retain them',async()=>{
 await withSettingsFixture({initialRaw:defaultPackage(),table:false,inlinePropertyBackups:true},async fixture=>{
  const storage=fixture.createStorage();await storage.initialize();
  const before=storage.keyMappings.getAll();
  const mapping:KeyMapping={canonicalKey:'Scores',visiblePropertyName:'Scores',type:'list',enabled:true,isSystem:false,sync:'auto'};
  let publications=0;storage.setMappingMutationCoordinator(operation=>operation(),()=>{publications++;});
  fixture.writeFault='throw-before';
  await assert.rejects(()=>storage.keyMappings.replaceAll([...before,mapping]));
  assert.deepEqual(storage.keyMappings.getAll(),before);
  assert.deepEqual(storage.getSettings().keyMappings,before);
  assert.equal(publications,0);assert.equal(storage.getCommittedInlinePropertyDefinitions(),undefined);
  await storage.keyMappings.replaceAll([...before,mapping]);
  assert.equal(publications,1);
  assert.equal(storage.getCommittedInlinePropertyDefinitions()!.entries.find(entry=>entry.sourceName==='Scores')!.encoding,'vault-v1');
  await storage.keyMappings.replaceAll(before);
  assert.equal(storage.getCommittedInlinePropertyDefinitions()!.entries.find(entry=>entry.sourceName==='Scores')!.encoding,'vault-v1');
 });
});
test('export / actual preflight / apply / restart keep registry, including reset-style removal',async()=>{
 await withSettingsFixture({initialRaw:defaultPackage(),table:false,inlinePropertyBackups:true},async fixture=>{
  const storage=fixture.createStorage();await storage.initialize();
  const source=migrateSettings({...storage.getSettings(),
   inlinePropertyDefinitions:retainInlinePropertyDefinition(undefined,{sourceName:'Scores',type:'list',encoding:'vault-v1'})});
  const exported=exportOperonSettingsBackupJsonV1({settings:source,source:{pluginVersion:'3.12.0',obsidianVersion:'1.12.0',dataPackageSchemaVersion:3},createdAt:'2026-10-08T12:00:00.000Z'});
  assert.ok(exported.ok,JSON.stringify(exported.diagnostics));
  const preflight=preflightOperonSettingsBackupRestoreV1({sourceJson:exported.json,targetSnapshot:await storage.captureCommittedSettingsBackupSnapshot(),selectedGroups:['custom-keys']});
  assert.ok(preflight.ok&&preflight.restorePlan,JSON.stringify(preflight));
  if(!preflight.ok||!preflight.restorePlan)throw new Error('Missing plan');
  const plan=preflight.restorePlan;
  assert.deepEqual(plan.candidateSettings.inlinePropertyDefinitions,source.inlinePropertyDefinitions);
  const applied=await storage.applySettingsBackupRestorePlanV1({sourceJson:exported.json,restorePlan:plan,acknowledgement:createOperonSettingsBackupApplyAcknowledgementV1(plan),appliedAt:'2026-10-08T12:01:00.000Z',refreshedVaultReferenceChecks:plan.vaultReferenceChecks});
  assert.ok(applied.status==='success'||applied.status==='success-with-migrations',JSON.stringify(applied));
  const reopened=fixture.createStorage();await reopened.initialize();
  assert.deepEqual(reopened.getCommittedInlinePropertyDefinitions(),source.inlinePropertyDefinitions);
  const reset=projectOperonSettingsBackupApplyDataPackageV1(fixture.package(),DEFAULT_SETTINGS);
  assert.deepEqual(reset.taxonomy.inlinePropertyDefinitions,source.inlinePropertyDefinitions);
 });
});
test('backup failure prevents canonical save and external CAS conflict does not overwrite newer settings',async()=>{
 await withSettingsFixture({initialRaw:defaultPackage(),table:false,inlinePropertyBackups:true},async fixture=>{
  const storage=fixture.createStorage();await storage.initialize();
  const before=fixture.raw(),count=fixture.canonicalAttempts;
  const write=fixture.adapter.write;
  fixture.adapter.write=async(path,contents)=>{if(path.includes('/inline-properties/'))throw new Error('backup rejected');await write(path,contents);};
  await assert.rejects(()=>storage.ensureInlinePropertyDefinitions([{sourceName:'Scores',type:'list',encoding:'vault-v1'}]));
  assert.equal(fixture.raw(),before);assert.equal(fixture.canonicalAttempts,count);
  fixture.adapter.write=write;
  const external=JSON.stringify({...fixture.package(),settings:{...fixture.package().settings,editorFontSize:29}});
  fixture.seed(fixture.canonicalPath,external);
  await assert.rejects(()=>storage.ensureInlinePropertyDefinitions([{sourceName:'Scores',type:'list',encoding:'vault-v1'}]));
  assert.equal(fixture.raw(),external);assert.equal(storage.getCommittedInlinePropertyDefinitions(),undefined);
 });
});
test('mapping transaction waits for writer and typed saves wait for mappings without deadlock',async()=>{
 await withSettingsFixture({initialRaw:defaultPackage(),table:false,inlinePropertyBackups:true},async fixture=>{
  const storage=fixture.createStorage();await storage.initialize();
  const target=writerFixture();
  storage.setMappingMutationCoordinator(operation=>target.writer.runExclusiveTaskMutation(operation),mappings=>target.writer.updateKeyMappings(mappings));
  let release!:()=>void, entered!:()=>void;
  const started=new Promise<void>(resolve=>{entered=resolve;});
  const hold=target.writer.runExclusiveTaskMutation(async()=>{entered();await new Promise<void>(resolve=>{release=resolve;});});
  await started;
  const mapping:KeyMapping={canonicalKey:'Scores',visiblePropertyName:'Scores',type:'list',enabled:true,isSystem:false,sync:'auto'};
  const save=storage.keyMappings.replaceAll([...storage.keyMappings.getAll(),mapping]);
  await Promise.resolve();assert.equal(storage.keyMappings.getAll().some(item=>item.canonicalKey==='Scores'),false);
  release();await hold;await save;
  assert.equal(storage.keyMappings.getAll().some(item=>item.canonicalKey==='Scores'),true);
 });
});

const defaultPackage=()=>JSON.stringify(buildOperonDataPackageFromSettings(DEFAULT_SETTINGS));
test('schema 2 explicit Save upgrades once with verified backup; schema 3 restart and no-op are stable',async()=>{
 await withSettingsFixture({initialRaw:defaultPackage(),table:false,inlinePropertyBackups:true},async fixture=>{
  const storage=fixture.createStorage(undefined,'3.12.0'); await storage.initialize();
  assert.equal(fixture.package().schemaVersion,2);
  const before=fixture.raw()!, count=fixture.canonicalAttempts;
  const reader=fixture.createStorage(undefined,'3.12.0');await reader.initialize();
  assert.equal(fixture.canonicalAttempts,count);
  const defs=await storage.ensureInlinePropertyDefinitions([{sourceName:'Scores',type:'list',encoding:'vault-v1'}]);
  assert.equal(fixture.package().schemaVersion,3);
  assert.deepEqual(fixture.package().taxonomy.inlinePropertyDefinitions,defs);
  const backup=fixture.operations.find(operation=>operation.kind==='write'&&operation.path.includes('/inline-properties/'));
  assert.ok(backup);assert.equal(await fixture.adapter.read(backup.path),before);
  const after=fixture.raw(), attempts=fixture.canonicalAttempts;
  const reopened=fixture.createStorage(undefined,'3.12.0');await reopened.initialize();
  await reopened.ensureInlinePropertyDefinitions(defs.entries);
  assert.equal(fixture.raw(),after);assert.equal(fixture.canonicalAttempts,attempts);
  fixture.seed(fixture.canonicalPath,before);
  const restored=fixture.createStorage(undefined,'3.12.0');await restored.initialize();
  assert.equal(fixture.package().schemaVersion,2);
  assert.equal(restored.getCommittedInlinePropertyDefinitions(),undefined);
 });
});
for(const fault of ['throw-before','partial-throw','commit-throw'] as const)test('schema upgrade write fault '+fault,async()=>{
 await withSettingsFixture({initialRaw:defaultPackage(),table:false,inlinePropertyBackups:true},async fixture=>{
  const storage=fixture.createStorage();await storage.initialize();
  const before=fixture.raw();fixture.writeFault=fault;
  const save=storage.ensureInlinePropertyDefinitions([{sourceName:'Scores',type:'list',encoding:'vault-v1'}]);
  if(fault==='commit-throw'){await save;assert.equal(fixture.package().schemaVersion,3);}
  else{await assert.rejects(save);assert.equal(storage.getCommittedInlinePropertyDefinitions(),undefined);
   assert.equal(storage.getSettings().inlinePropertyDefinitions,undefined);
   if(fault==='throw-before')assert.equal(fixture.raw(),before);
  }
 });
});
test('backup rejection is zero canonical writes; acknowledgement loss verifies without replay',async()=>{
 let writes=0;const files=new Map<string,string>();
 const adapter={exists:async(path:string)=>files.has(path),mkdir:async(path:string)=>{files.set(path,'dir');},read:async(path:string)=>files.get(path)!,
  write:async()=>{writes++;throw new Error('disk');}};
 await assert.rejects(()=>prepareInlinePropertyUpgradeBackup(adapter,'plugin','original'));
 assert.equal(writes,1);
 const path=await prepareInlinePropertyUpgradeBackup({...adapter,write:async(path:string,value:string)=>{files.set(path,value);throw new Error('ack');}},'plugin','original');
 assert.equal(files.get(path),'original');
});
for(const malformed of [{schemaVersion:4}, {schemaVersion:3,taxonomy:{inlinePropertyDefinitions:{version:2,entries:[]}}}])test('unknown registry/package versions remain untouched '+JSON.stringify(malformed),async()=>{
 const base=JSON.parse(defaultPackage());
 Object.assign(base,malformed);
 const raw=JSON.stringify(base);
 assert.equal(isStructurallyCompleteOperonDataPackageV1(base),false);
 await withSettingsFixture({initialRaw:raw,table:false,inlinePropertyBackups:true},async fixture=>{
  const storage=fixture.createStorage();await storage.initialize().catch(()=>{});
  await assert.rejects(()=>storage.ensureInlinePropertyDefinitions([{sourceName:'Scores',type:'list',encoding:'vault-v1'}]));
  assert.equal(fixture.raw(),raw);
 });
});


test('desktop native catalog only admits declared compatible noncanonical fields',()=>{
 const mapping:KeyMapping={canonicalKey:'customValues',visiblePropertyName:'Values',type:'list',isSystem:false,enabled:true,sync:'auto'};
 const definitions:InlinePropertyDefinitions={version:1,entries:[{sourceName:'Values',type:'list',encoding:'vault-v1'},{sourceName:'customValues',type:'list',encoding:'vault-v1'}]};
 assert.deepEqual(nativeEditorPropertyTypes({Values:'multitext',Amount:'number',Flag:'checkbox',Date:'date',When:'datetime',Text:'text',tags:'tags',Status:'text'},[...DEFAULT_SETTINGS.keyMappings,mapping],definitions),{Values:'list',Amount:'number',Flag:'checkbox',Date:'date',When:'datetime',Text:'text'});
 assert.deepEqual(nativeEditorPropertyTypes({Values:'multitext'},[mapping]),{});
 assert.deepEqual(nativeEditorPropertyTypes({Values:'text'},[mapping],definitions),{});
 assert.deepEqual(nativeEditorPropertyTypes({Values:'multitext',customValues:'text'},[mapping],definitions),{});
 assert.deepEqual(nativeEditorPropertyTypes({Amount:'number',amount:'number'},[]),{});
});
for(const [type,value] of samples) test(`desktop typed source merge ${type} ${JSON.stringify(value)}`,()=>{
 const source='- [ ] Before {{operonId:: ABC1234}} {{Other:: untouched}}';
 const baseline=parseTaskLine(source,0,'Note.md',[])!;
 const changed='- [ ] After {{operonId:: ABC1234}} {{Other:: untouched}}';
 const merged=mergeInlineEditorSource(source.replace('untouched','external'),changed,baseline.fields,[],undefined,[{sourceName:'Value',type,expected:{present:false},mutation:{kind:'set',value}}]);
 assert.ok(merged);
 assert.equal(parseTaskLine(merged!,0,'Note.md',[])!.description,'After');
 assert.equal(readInlinePropertyProjection(merged!,'Note.md',{Value:type},[])!.properties[0].state,'valid');
 assert.deepEqual(readInlinePropertyProjection(merged!,'Note.md',{Value:type},[])!.properties[0].value,value);
 assert.ok(merged!.includes('{{Other:: external}}'));
});
test('desktop typed merge rejects a conflicting field and edits a promoted field once',()=>{
 const mappings:KeyMapping[]=[{canonicalKey:'customValues',visiblePropertyName:'Values',type:'list',isSystem:false,enabled:true,sync:'auto'}];
 const definitions:InlinePropertyDefinitions={version:1,entries:[{sourceName:'Values',type:'list',encoding:'vault-v1'},{sourceName:'customValues',type:'list',encoding:'vault-v1'}]};
 const source='- [ ] Task {{operonId:: ABC1234}} {{Values:: 3; "3"; Ali; Ali}}';
 const baseline=parseTaskLine(source,0,'',mappings)!;
 const changes:InlinePropertyChange[]=[{sourceName:'Values',type:'list',expected:{present:true,rawValue:'3; "3"; Ali; Ali'},mutation:{kind:'set',value:[3,'3','Ali']}}];
 assert.equal(mergeInlineEditorSource(source.replace('3;','4;'),source,baseline.fields,mappings,definitions,changes),null);
 const merged=mergeInlineEditorSource(source,source,baseline.fields,mappings,definitions,changes)!;
 assert.equal(parseTaskLine(merged,0,'',mappings)!.fields.filter(field=>field.key==='customValues').length,1);
 assert.deepEqual(readInlinePropertyProjection(merged,'',{Values:'list'},mappings,definitions)!.properties[0].value,[3,'3','Ali']);
});
test('desktop file writer edits a promoted native list at its original alias',async()=>{
 let content='---\noperonId: ABC1234\ncustomValues: [3, "3", Ali, Ali]\n---\nBody\n';
 const mapping:KeyMapping={canonicalKey:'customValues',visiblePropertyName:'Values',type:'list',isSystem:false,enabled:true,sync:'auto'};
 const definitions:InlinePropertyDefinitions={version:1,entries:[{sourceName:'Values',type:'list',encoding:'vault-v1'},{sourceName:'customValues',type:'list',encoding:'vault-v1'}]};
 const file=new TFile(...(['File.md'] as unknown as []));Object.assign(file,{path:'File.md',stat:{ctime:1}});
 const app={vault:{getAbstractFileByPath:()=>file,read:async()=>content,process:async(_file:TFile,fn:(s:string)=>string)=>{content=fn(content);return content;}}} as unknown as App;
 const indexer={getTask:(id:string)=>id==='ABC1234'?{operonId:id,primary:{format:'yaml',filePath:file.path,lineNumber:0},fieldValues:{customValues:'3; 3; Ali; Ali'}}:null,hasDuplicateOperonIdConflict:()=>false,isPathIndexable:()=>true,reindexFilePath:async()=>{},reindexFilesBatch:async()=>{},scheduleReindex:()=>{}} as unknown as TaskWriterIndexerPort;
 const writer=new TaskWriter(app,indexer,[mapping],{getInlinePropertyDefinitions:()=>definitions});
 assert.equal(await writer.writeTaskFields('ABC1234',{customValues:'3; 3; Ali; Ali'}, {mode:'replace',filePropertyDraft:{changes:[{propertyName:'customValues',nativeType:'list',expected:{present:true,value:[3,'3','Ali','Ali']},value:[3,'3','Ali']}]}}),true);
 const document=readFileTaskPropertyDocument(content)!;
 assert.deepEqual(document.frontmatter.customValues,[3,'3','Ali']);assert.equal('Values' in document.frontmatter,false);assert.equal(document.body,'Body\n');
});

function nativeTableFixture() {
 const contents = new Map<string,string>([
  ['F.md','---\noperonId: fil0001\npriority: A\ndateDue: 2026-12-01\nClient: file\nValues: [3, "3", Ali, Ali]\nAmount: 0\nDone: false\nExtra: keep\n---\nFile body\n'],
  ['H.md','---\nClient: host\n---\n- [ ] Inline {{operonId:: abc1234}} {{priority:: A}} {{Client:: inline}} {{Values:: 3; "3"; Ali; Ali}}\n- [ ] Neighbor {{operonId:: xyz1234}} {{Client:: neighbor}}\n'],
 ]);
 const files = new Map([...contents.keys()].map(path => { const file=new TFile(...([path] as unknown as []));Object.assign(file,{path,stat:{mtime:1,ctime:1,size:0}});return [path,file];}));
 const tasks = [ ['fil0001','F.md','yaml'],['abc1234','H.md','inline'],['xyz1234','H.md','inline'] ].map(([operonId,filePath,format])=>({operonId,primary:{filePath,format,lineNumber:0},fieldValues:{},description:'Task',tags:[],checkbox:'open',datetimeModified:'',tier:'hot'} as IndexedTask));
 const settings={keyMappings:[] as KeyMapping[],inlinePropertyDefinitions:undefined as InlinePropertyDefinitions|undefined};
 let declarations: Record<string,string>={Client:'text',Values:'multitext',Amount:'number',Done:'checkbox',Day:'date',Meeting:'datetime'};
 let reads=0,writes=0,prepareFails=false;
 const app={metadataCache:{getFileCache:(file:TFile)=>({frontmatter:readFileTaskPropertyDocument(contents.get(file.path)??'')?.frontmatter})},vault:{configDir:'.obsidian',getMarkdownFiles:()=>[...files.values()],adapter:{read:async()=>JSON.stringify({types:declarations})},getAbstractFileByPath:(path:string)=>files.get(path),
  read:async(file:TFile)=>{reads++;return contents.get(file.path)!;},process:async(file:TFile,fn:(text:string)=>string)=>{const next=fn(contents.get(file.path)!);writes++;contents.set(file.path,next);file.stat.mtime++;return next;}}} as unknown as App;
 const put=contents.set.bind(contents);
 contents.set=(path,content)=>{if(contents.get(path)!==content){const file=files.get(path);if(file)file.stat.mtime++;}return put(path,content);};
 declarations=new Proxy(declarations,{set(target,name,value){Reflect.set(target,name,value);getNativePropertyIndex(app).setTypes({...target} as Record<string,ObsidianPropertyTypeId>);return true;},deleteProperty(target,name){Reflect.deleteProperty(target,name);getNativePropertyIndex(app).setTypes({...target} as Record<string,ObsidianPropertyTypeId>);return true;}});
 const indexer={getTask:(id:string)=>tasks.find(task=>task.operonId===id),hasDuplicateOperonIdConflict:()=>false,isPathIndexable:()=>true,reindexFilePath:async()=>{},reindexFilesBatch:async()=>{},scheduleReindex:()=>{}} as unknown as TaskWriterIndexerPort;
 const writer=new TaskWriter(app,indexer,[],{getInlinePropertyDefinitions:()=>settings.inlinePropertyDefinitions,prepareInlineProperties:async entries=>{
  if(prepareFails)throw new Error('backup failed');
  for(const entry of entries)settings.inlinePropertyDefinitions=retainInlinePropertyDefinition(settings.inlinePropertyDefinitions,entry);return settings.inlinePropertyDefinitions!;
 }});
 const base:TableFilePropertySnapshot={signature:'base',revision:1,fields:[],getCell:()=>({present:false,rawValue:undefined,normalizedValue:''}),getCandidates:()=>[]};
 const snapshot=()=>loadTableNativePropertySnapshot(app,base,tasks,settings);
 const cell=(snapshot:TableFilePropertySnapshot,task:IndexedTask,name:string)=>snapshot.getCell(task,encodeTableFilePropertyColumnKey(name)!);
 const save=async(task:IndexedTask,name:string,value:VaultPropertyValue|undefined,previous?:TableFilePropertySnapshot)=>{
  const snap=previous??await snapshot(), before=cell(snap,task,name),field=snap.fields.find(field=>field.propertyName===name)!;
  return writeTableNativeProperty(app,writer,task,{propertyName:before.sourceName??name,sourceFormat:task.primary.format,nativeType:field.type as InlinePropertyType,
   expected:{present:before.present,value:before.rawValue as VaultPropertyValue|undefined},inlineExpected:before.inlineExpected,
   mutation:value===undefined?{kind:'delete'}:{kind:'set',value}},settings,'2026-10-08T15:00:00');
 };
 return {contents,files,tasks,settings,declarations,app,base,snapshot,cell,save,reads:()=>reads,writes:()=>writes,failPreparation:()=>{prepareFails=true;}};
}
test('Stage4 table reads file and inline independently, batches each source once, and keeps native types',async()=>{
 const f=nativeTableFixture(),s=await f.snapshot();assert.equal(f.reads(),2);assert.equal(f.writes(),0);
 assert.equal(f.cell(s,f.tasks[0],'Client').rawValue,'file');assert.equal(f.cell(s,f.tasks[1],'Client').rawValue,'inline');
 assert.equal(f.cell(s,f.tasks[2],'Amount').present,false);assert.equal(f.cell(s,f.tasks[0],'Amount').rawValue,0);assert.equal(f.cell(s,f.tasks[0],'Done').rawValue,false);
 assert.deepEqual(f.cell(s,f.tasks[1],'Values').rawValue,[3,'3','Ali','Ali']);
 assert.deepEqual([...s.getCandidates(encodeTableFilePropertyColumnKey('Values')!)].sort(),['"3"','3','Ali']);
});
for(const format of ['yaml','inline'] as const) for(const [type,value] of samples) test(`Stage4 ${format} table saves ${type} ${JSON.stringify(value)}`,async()=>{
 const f=nativeTableFixture(),task=f.tasks.find(task=>task.primary.format===format)!;
 const name={text:'Client',list:'Values',number:'Amount',checkbox:'Done',date:'Day',datetime:'Meeting'}[type];
 assert.equal(await f.save(task,name,value),'updated');const s=await f.snapshot();assert.deepEqual(f.cell(s,task,name).rawValue,value);
 assert.equal(await f.save(task,name,undefined,s),'updated');assert.equal(f.cell(await f.snapshot(),task,name).present,false);
});
test('Stage4 native file mutation preserves managed fields, inline source and unrelated YAML',async()=>{
 const f=nativeTableFixture(),host=f.contents.get('H.md');assert.equal(await f.save(f.tasks[0],'Values',[8,'8','Ali','Ali']),'updated');
 const doc=readFileTaskPropertyDocument(f.contents.get('F.md')!)!;
 assert.equal(doc.frontmatter.priority,'A');assert.equal(doc.frontmatter.dateDue,'2026-12-01');assert.equal(doc.frontmatter.Extra,'keep');assert.equal(doc.body,'File body\n');assert.equal(f.contents.get('H.md'),host);
});
test('Stage4 inline first save records interpretation and preserves host and neighbor; stale writes fail',async()=>{
 const f=nativeTableFixture(),before=await f.snapshot();assert.equal(f.settings.inlinePropertyDefinitions,undefined);
 assert.equal(await f.save(f.tasks[1],'Amount',3,before),'updated');assert.ok((f.settings.inlinePropertyDefinitions as InlinePropertyDefinitions | undefined)?.entries.some(entry=>entry.sourceName==='Amount'));
 assert.ok(f.contents.get('H.md')!.startsWith('---\nClient: host\n---\n'));assert.ok(f.contents.get('H.md')!.endsWith('{{Client:: neighbor}}\n'));
 const source=f.contents.get('H.md');assert.equal(await f.save(f.tasks[1],'Amount',4,before),'conflict');assert.equal(f.contents.get('H.md'),source);
});
test('Stage4 backup failure, removed task source, ambiguous aliases and conflicting types never write',async()=>{
 const f=nativeTableFixture();f.failPreparation();await assert.rejects(f.save(f.tasks[1],'Amount',3));assert.equal(f.writes(),0);
 const g=nativeTableFixture();g.contents.set('H.md',g.contents.get('H.md')!.replace('{{Client:: inline}}','{{Client:: inline}} {{client:: duplicate}}'));
 assert.equal(g.cell(await g.snapshot(),g.tasks[1],'Client').nativeState,'unsupported');
 g.declarations.Values='number';assert.equal(g.cell(await g.snapshot(),g.tasks[1],'Values').nativeState,'unsupported');
 g.contents.set('H.md','no tasks');assert.equal(g.cell(await g.snapshot(),g.tasks[1],'Amount').nativeState,'unsupported');assert.equal(g.writes(),0);
});
test('Stage4 shared projection reads changed sources once and warm second surfaces synchronously',async()=>{
 const f=nativeTableFixture(),owner={};let ready=0;
 const get=()=>getTableNativePropertySnapshot(owner,f.app,f.base,f.tasks,1,f.settings,()=>{ready++;});
 assert.equal(get().loading,true);await settleNativeTable();assert.equal(ready,1);assert.equal(f.reads(),2);
 assert.equal(get().loading,undefined);
 const other=getTableNativePropertySnapshot({},f.app,f.base,f.tasks,1,f.settings,()=>{ready++;});
 assert.equal(f.cell(other,f.tasks[1],'Client').rawValue,'inline');assert.equal(f.reads(),2);assert.equal(ready,1);
 f.contents.set('H.md',f.contents.get('H.md')!.replace('Client:: inline','Client:: fresh'));
 assert.equal(get().loading,true);await settleNativeTable();assert.equal(f.reads(),3);
 assert.equal(f.cell(get(),f.tasks[1],'Client').rawValue,'fresh');assert.equal(ready,2);
});

test('Stage4 unused property catalog reads types without reading note bodies',async()=>{
 const f=nativeTableFixture();const snapshot=await loadTableNativePropertySnapshot(f.app,f.base,f.tasks,f.settings,undefined,false);
 assert.ok(snapshot.fields.some(field=>field.propertyName==='Values'));assert.equal(f.reads(),0);assert.equal(f.writes(),0);
});
test('Stage4 moved inline task ignores stale line numbers and duplicate identity refuses mutation',async()=>{
 const f=nativeTableFixture(),before=await f.snapshot();f.contents.set('H.md','Extra heading\n'+f.contents.get('H.md'));
 assert.equal(await f.save(f.tasks[1],'Amount',9,before),'updated');
 const fresh=await f.snapshot();f.contents.set('H.md',f.contents.get('H.md')+'- [ ] Duplicate {{operonId:: abc1234}}\n');
 const source=f.contents.get('H.md');assert.equal(await f.save(f.tasks[1],'Amount',10,fresh),'conflict');assert.equal(f.contents.get('H.md'),source);
});

test('Stage4 query sorting and text search use refreshed native values while filter context stays separate',async()=>{
 const f=nativeTableFixture(),key=encodeTableFilePropertyColumnKey('Amount')!,client=encodeTableFilePropertyColumnKey('Client')!;
 await f.save(f.tasks[1],'Amount',9);await f.save(f.tasks[2],'Amount',3);
 const preset=createDefaultTablePreset();preset.columns=[{key,kind:'task'},{key:client,kind:'task'}];preset.sortRules=[{key,direction:'asc',empty:'last'}];
 const query=(snapshot:TableFilePropertySnapshot)=>queryTableRows({preset,filterSet:null,tasks:f.tasks,settings:DEFAULT_SETTINGS,priorities:DEFAULT_SETTINGS.priorities,filePropertyContext:f.base,valueResolverOptions:{filePropertyContext:snapshot,getFilePropertyValue:(task,column)=>snapshot.getCell(task,column).normalizedValue}});
 let snapshot=await f.snapshot();assert.deepEqual(query(snapshot).rows.map(row=>row.operonId),['fil0001','xyz1234','abc1234']);
 await f.save(f.tasks[1],'Amount',-1);await f.save(f.tasks[1],'Client','changed client');snapshot=await f.snapshot();
 assert.deepEqual(query(snapshot).rows.map(row=>row.operonId),['abc1234','fil0001','xyz1234']);
 const matcher=createTableTaskSearchMatcherCache().getMatcher({tasks:f.tasks,settings:DEFAULT_SETTINGS,generation:2,columns:preset.columns,filePropertyContext:snapshot,valueResolverSignature:snapshot.signature});
 assert.equal(matcher(f.tasks[1],'changed client'),true);assert.equal(matcher(f.tasks[0],'changed client'),false);
 assert.equal(f.base.getCell(f.tasks[1],client).present,false);
});

// Stage 5 joins the disk-backed settings transaction and real source writer with
// the native editor draft contract and table snapshot/mutation path.
async function withIntegratedNative(run: (f: Awaited<ReturnType<typeof integratedNative>>) => Promise<void>) {
 await withSettingsFixture({initialRaw:defaultPackage(),table:false,inlinePropertyBackups:true},async storageFixture=>{
  const f=await integratedNative(storageFixture);
  try {await run(f);} finally {await f.cleanup();}
 });
}
async function integratedNative(sf: Parameters<Parameters<typeof withSettingsFixture>[1]>[0]) {
 const fs=await import('node:fs/promises');
 const root=await fs.mkdtemp(path.join(process.platform === 'darwin' ? '/private/tmp' : tmpdir(), 'operon-native-stage5-'));
 const f=nativeTableFixture();
 for(const [name,source] of f.contents)await fs.writeFile(`${root}/${name}`,source);
 let storage=sf.createStorage();await storage.initialize();
 let taskWrites=0,failTask=false;
 f.app.vault.read=async file=>fs.readFile(`${root}/${file.path}`,'utf8');
 f.app.vault.process=async(file,transform)=>{
  const source=await f.app.vault.read(file),next=transform(source);
  if(failTask)throw new Error('Stage5 task write failed');
  if(next!==source){await fs.writeFile(`${root}/${file.path}`,next);taskWrites++;file.stat.mtime++;}
  return next;
 };
 const settings=()=>storage.getSettings({committedMappings:true});
 const makeWriter=()=>new TaskWriter(f.app,{getTask:(id:string)=>f.tasks.find(task=>task.operonId===id),hasDuplicateOperonIdConflict:()=>false,isPathIndexable:()=>true,reindexFilePath:async()=>{},reindexFilesBatch:async()=>{},scheduleReindex:()=>{}} as unknown as TaskWriterIndexerPort,settings().keyMappings,{
  getInlinePropertyDefinitions:()=>storage.getCommittedInlinePropertyDefinitions(),prepareInlineProperties:entries=>storage.ensureInlinePropertyDefinitions(entries)
 });
 let writer=makeWriter();
 const snapshot=()=>loadTableNativePropertySnapshot(f.app,f.base,f.tasks,settings());
 const editorRead=async(task:IndexedTask,name:string,type:InlinePropertyType)=>{
  if(task.primary.format==='inline')return (await writer.readInlineProperties(task.operonId,{[name]:type}))!.properties[0];
  const fm=readFileTaskPropertyDocument(await f.app.vault.read(f.files.get(task.primary.filePath)!))!.frontmatter;
  return {present:Object.prototype.hasOwnProperty.call(fm,name),value:fm[name],rawValue:undefined};
 };
 const editorSave=async(task:IndexedTask,name:string,type:InlinePropertyType,value:VaultPropertyValue,baseline?:Awaited<ReturnType<typeof editorRead>>)=>{
  const previous=baseline??await editorRead(task,name,type);
  return writer.writeTaskFields(task.operonId,{priority:'A'},{mode:'merge',reindex:'none',...(task.primary.format==='inline'?{
   inlinePropertyDraft:[{sourceName:name,type,expected:{present:previous.present,rawValue:previous.rawValue},mutation:{kind:'set' as const,value}}]
  }:{filePropertyDraft:{changes:[{propertyName:name,nativeType:type,expected:{present:previous.present,value:previous.value as VaultPropertyValue},value}]}})});
 };
 const tableSave=async(task:IndexedTask,name:string,type:InlinePropertyType,value:VaultPropertyValue,previous?:TableFilePropertySnapshot)=>{
  const cell=f.cell(previous??await snapshot(),task,name);
  return writeTableNativeProperty(f.app,writer,task,{propertyName:name,sourceFormat:task.primary.format,nativeType:type,expected:{present:cell.present,value:cell.rawValue as VaultPropertyValue},inlineExpected:cell.inlineExpected,mutation:{kind:'set',value}},settings(),'2026-10-09T12:00:00');
 };
 return {...f,snapshot,editorRead,editorSave,tableSave,sf,taskWrites:()=>taskWrites,failTask:(value:boolean)=>{failTask=value;},
  read:(name:string)=>fs.readFile(`${root}/${name}`,'utf8'),external:(name:string,value:string)=>fs.writeFile(`${root}/${name}`,value),
  restart:async()=>{storage=sf.createStorage();await storage.initialize();writer=makeWriter();},
  cleanup:()=>fs.rm(root,{recursive:true,force:true})};
}
for(const format of ['yaml','inline'] as const)test(`Stage5 disk editor-table-editor six types and 20 cycles ${format}`,async()=>withIntegratedNative(async f=>{
 const task=f.tasks.find(task=>task.primary.format===format)!,other=f.tasks.find(task=>task.primary.format!==format)!;
 const untouched=await f.read(other.primary.filePath);
 const beforeSettings=f.sf.canonicalAttempts;
 await f.snapshot();await f.editorRead(task,'Values','list');assert.equal(f.taskWrites(),0);assert.equal(f.sf.canonicalAttempts,beforeSettings);
 for(let i=0;i<20;i++){
  const list:(string|number)[]=[i,'3','Ali','Ali','a;b','[[Link|x]]','\\','\n'];
  assert.equal(await f.editorSave(task,'Values','list',list),true);
  assert.deepEqual(f.cell(await f.snapshot(),task,'Values').rawValue,list);
  const changed=[...list];changed.splice(3,1);changed[2]='changed';
  assert.equal(await f.tableSave(task,'Values','list',changed),'updated');
  await f.restart();assert.deepEqual((await f.editorRead(task,'Values','list')).value,changed);
 }
 for(const [type,value] of samples){
  const name={text:'Client',list:'Values',number:'Amount',checkbox:'Done',date:'Day',datetime:'Meeting'}[type];
  assert.equal(await f.editorSave(task,name,type,value),true);
  assert.deepEqual(f.cell(await f.snapshot(),task,name).rawValue,value);
  assert.equal(await f.tableSave(task,name,type,value),'updated');
  await f.restart();assert.deepEqual((await f.editorRead(task,name,type)).value,value);
 }
 assert.equal(await f.read(other.primary.filePath),untouched);
 if(format==='inline'){
  assert.equal(f.sf.package().schemaVersion,3);
  assert.ok((await f.read('H.md')).startsWith('---\nClient: host\n---\n'));
  assert.ok((await f.read('H.md')).endsWith('{{Client:: neighbor}}\n'));
 }else assert.equal(f.sf.package().schemaVersion,2);
 const attempts=f.sf.canonicalAttempts;await f.restart();await f.snapshot();assert.equal(f.sf.canonicalAttempts,attempts);
}));
test('Stage5 disk editor/table same-field conflict rejects stale draft; unrelated external body survives',async()=>withIntegratedNative(async f=>{
 for(const task of f.tasks.slice(0,2)){
  const baseline=await f.editorRead(task,'Client','text'),table=await f.snapshot();
  assert.equal(await f.editorSave(task,'Client','text','editor'),true);
  assert.equal(await f.tableSave(task,'Client','text','stale table',table),'conflict');
  assert.equal(await f.editorSave(task,'Client','text','stale editor',baseline),false);
  const content=await f.read(task.primary.filePath);await f.external(task.primary.filePath,content+'\nExternal body\n');
  assert.equal(await f.tableSave(task,'Client','text','fresh'),'updated');
  assert.ok((await f.read(task.primary.filePath)).endsWith('\nExternal body\n'));
 }
}));
test('Stage5 real storage precedes task write; failed source keeps definition and explicit retry works',async()=>withIntegratedNative(async f=>{
 const task=f.tasks[1],before=await f.read('H.md');f.failTask(true);
 await assert.rejects(f.editorSave(task,'Amount','number',7));
 assert.equal(f.sf.package().schemaVersion,3);assert.equal(await f.read('H.md'),before);assert.equal(f.taskWrites(),0);
 const attempts=f.sf.canonicalAttempts;await f.restart();f.failTask(false);
 assert.equal(await f.editorSave(task,'Amount','number',7),true);assert.equal(f.sf.canonicalAttempts,attempts);
 assert.equal(f.cell(await f.snapshot(),task,'Amount').rawValue,7);
}));
for(const fault of ['throw-before','partial-throw','commit-throw'] as const)test(`Stage5 disk storage fault ${fault} never replays source`,async()=>withIntegratedNative(async f=>{
 f.sf.writeFault=fault;const before=await f.read('H.md'),task=f.tasks[1];
 if(fault==='commit-throw'){
  assert.equal(await f.tableSave(task,'Amount','number',9),'updated');assert.equal(f.taskWrites(),1);
  await f.restart();assert.equal((await f.editorRead(task,'Amount','number')).value,9);assert.equal(f.taskWrites(),1);
 }else{
  await assert.rejects(f.tableSave(task,'Amount','number',9));assert.equal(await f.read('H.md'),before);assert.equal(f.taskWrites(),0);
 }
}));
for(const value of ['\n','tail\n\n',['x','\n'],['x','tail\n\n']])test('Stage5 canonical patch/detach/identity repair preserve final YAML block '+JSON.stringify(value),()=>{
 const source='---\n'+stringifyYaml({operonId:'abc1234',priority:'A',datetimeModified:'2026-10-09T10:00:00',Tail:value})+'---\nBody\n';
 const patched=tryPatchYamlTaskContent(source,'abc1234',{priority:'B'},'merge',[]);assert.equal(patched.ok,true);
 assert.deepEqual(readFileTaskPropertyDocument(patched.content)!.frontmatter.Tail,value);
 const detached=tryDetachYamlTaskPropertiesContent(source,'abc1234',['operonId','priority'],[]);assert.equal(detached.ok,true,JSON.stringify(detached));
 assert.deepEqual(readFileTaskPropertyDocument(detached.content)!.frontmatter.Tail,value);
 const invalid=source.replace('abc1234','legacy-id');
 const repair=planTaskIdRepairSources([{filePath:'F.md',content:invalid}],{format:'yaml',filePath:'F.md',expectedContent:invalid,operonId:'legacy-id'},'def5678','2026-10-09T12:00:00',[]);
 assert.equal(repair.ok,true,JSON.stringify(repair));if(repair.ok)assert.deepEqual(readFileTaskPropertyDocument(repair.changes[0].after)!.frontmatter.Tail,value);
});


test('native table candidates include ordinary vault notes, typed members and fresh metadata without source reads',async()=>{
 const f=nativeTableFixture();
 const note=new TFile(...(['Reference.md'] as unknown as []));Object.assign(note,{path:'Reference.md',stat:{mtime:1,size:1}});
 let values:(string|number)[]=['Text','Image','Code',3,'3','a;b'];
 const readCache=f.app.metadataCache.getFileCache.bind(f.app.metadataCache);
 f.app.vault.getMarkdownFiles=()=>[...f.files.values(),note];
 f.app.metadataCache.getFileCache=file=>file===note?{frontmatter:{Values:values,Client:'cached note'}}:readCache(file);
 const s=await f.snapshot(),count=f.reads();
 const key=encodeTableFilePropertyColumnKey('Values')!;
 assert.deepEqual(new Set(s.getCandidates(key)),new Set(['Text','Image','Code','3','"3"','"a;b"','Ali']));
 assert.ok(s.getCandidates(encodeTableFilePropertyColumnKey('Client')!).includes('cached note'));
 assert.ok(s.getCandidates(encodeTableFilePropertyColumnKey('Client')!).includes('inline'));
 values=['Updated'];assert.ok(s.getCandidates(key).includes('Updated'));assert.equal(s.getCandidates(key).includes('Text'),false);
 assert.equal(f.reads(),count);assert.equal(f.writes(),0);
 // Candidate reuse must not make inline cells inherit host YAML.
 assert.equal(f.cell(s,f.tasks[1],'Client').rawValue,'inline');
});

const settleNativeTable = () => new Promise(resolve => setTimeout(resolve, 20));
test('main and embedded shared snapshots publish one order change and reject equal notifications',async()=>{
 const f=nativeTableFixture();f.declarations.Output='multitext';
 f.contents.set('F.md','---\noperonId: fil0001\nOutput: [Bravo]\n---\nBody\n');
 f.contents.set('H.md','- [ ] I1 {{operonId:: abc1234}} {{Output:: Alpha}}\n- [ ] I2 {{operonId:: xyz1234}} {{Output:: Charlie}}\n');
 const native=getNativePropertyIndex(f.app);native.configure(f.settings);await native.ensure(f.tasks);
 const key=encodeTableFilePropertyColumnKey('Output')!,preset=createDefaultTablePreset();preset.columns=[{key,kind:'task'}];preset.sortRules=[{key,direction:'asc',empty:'last'}];
 const surfaces=[{},{}];
 const snapshot=(owner:object)=>getTableNativePropertySnapshot(owner,f.app,f.base,f.tasks,1,f.settings,()=>{});
 const query=(owner:object)=>{const data=snapshot(owner);assert.ok(!data.loading);return queryTableRows({preset,filterSet:null,tasks:f.tasks,sortCacheOwner:owner,settings:DEFAULT_SETTINGS,priorities:DEFAULT_SETTINGS.priorities,filePropertyContext:f.base,valueResolverOptions:{filePropertyContext:data,getFilePropertyValue:(task,column)=>data.getCell(task,column).normalizedValue}}).rows.map(row=>row.operonId);};
 for(const owner of surfaces)assert.deepEqual(query(owner),['abc1234','fil0001','xyz1234']);
 let publications=0;const off=native.subscribe(()=>{publications++;});await settleNativeTable();publications=0;
 const reads=f.reads(),projections=native.counters.projections;
 f.contents.set('H.md',f.contents.get('H.md')!.replace('Output:: Alpha','Output:: Echo'));
 native.accept('H.md',(await scanFileWithMappings(f.app,f.files.get('H.md')!,[])).nativeProperties);await settleNativeTable();
 for(const owner of surfaces)assert.deepEqual(query(owner),['fil0001','xyz1234','abc1234']);
 assert.equal(publications,1);assert.equal(f.reads()-reads,1);assert.equal(native.counters.projections-projections,2);
 const previous=snapshot(surfaces[0]);
 native.accept('H.md',(await scanFileWithMappings(f.app,f.files.get('H.md')!,[])).nativeProperties);await settleNativeTable();
 assert.equal(publications,1);assert.equal(snapshot(surfaces[0]),previous);off();
});
test('shared publication compares raw tokens and member types and preserves untouched records',async()=>{
 const f=nativeTableFixture(),before=await f.snapshot(),native=getNativePropertyIndex(f.app);
 const unchanged=f.cell(before,f.tasks[0],'Values'),reads=f.reads();
 f.contents.set('H.md',f.contents.get('H.md')!.replace('Values:: 3; "3"; Ali; Ali','Values:: 3; "3"; "Ali"; Ali'));
 native.accept('H.md',(await scanFileWithMappings(f.app,f.files.get('H.md')!,[])).nativeProperties);
 const after=await f.snapshot();assert.notEqual(after.signature,before.signature);
 assert.deepEqual(f.cell(after,f.tasks[1],'Values').rawValue,f.cell(before,f.tasks[1],'Values').rawValue);
 assert.notEqual(f.cell(after,f.tasks[1],'Values').inlineExpected?.rawValue,f.cell(before,f.tasks[1],'Values').inlineExpected?.rawValue);
 assert.equal(f.cell(after,f.tasks[0],'Values'),unchanged);assert.equal(f.reads()-reads,1);
 f.contents.set('H.md',f.contents.get('H.md')!.replace('Values:: 3;','Values:: "3";'));
 assert.deepEqual(f.cell(await f.snapshot(),f.tasks[1],'Values').rawValue,['3','3','Ali','Ali']);
});
test('shared snapshots validate duplicate membership, missing sources and removal without global generation',async()=>{
 const f=nativeTableFixture(),before=await f.snapshot();f.tasks.push({...f.tasks[1]});
 assert.equal(f.cell(await f.snapshot(),f.tasks[1],'Client').nativeState,'unsupported');
 f.tasks.pop();assert.equal(f.cell(await f.snapshot(),f.tasks[1],'Client'),f.cell(before,f.tasks[1],'Client'));
 const removed=f.tasks.pop()!;assert.equal(f.cell(await f.snapshot(),removed,'Client').nativeState,'unsupported');
 f.tasks.push(removed);f.tasks[1]={...f.tasks[1],primary:{...f.tasks[1].primary,filePath:'Missing.md'}};
 assert.equal(f.cell(await f.snapshot(),f.tasks[1],'Client').nativeState,'unsupported');assert.equal(f.writes(),0);
});
test('type and mapping changes reinterpret shared raw data without source reads',async()=>{
 const f=nativeTableFixture();await f.snapshot();const reads=f.reads();
 f.declarations.Values='number';assert.equal(f.cell(await f.snapshot(),f.tasks[1],'Values').nativeState,'unsupported');
 f.declarations.Values='multitext';assert.deepEqual(f.cell(await f.snapshot(),f.tasks[1],'Values').rawValue,[3,'3','Ali','Ali']);
 f.settings.inlinePropertyDefinitions={version:1,entries:[{sourceName:'Values',type:'list',encoding:'legacy'}]};
 assert.deepEqual(f.cell(await f.snapshot(),f.tasks[1],'Values').rawValue,['3','"3"','Ali','Ali']);
 f.settings.keyMappings=[{canonicalKey:'customValues',visiblePropertyName:'Values',type:'list',isSystem:false,enabled:true,sync:'auto'}];
 assert.equal((await f.snapshot()).fields.some(field=>field.propertyName==='Values'),false);assert.equal(f.reads(),reads);assert.equal(f.writes(),0);
});
test('source read failure preserves last verified values as unavailable and later index commit recovers',async()=>{
 const f=nativeTableFixture(),before=await f.snapshot(),original=f.app.vault.read;
 f.contents.set('H.md',f.contents.get('H.md')!.replace('Client:: inline','Client:: outside'));
 f.app.vault.read=async()=>{throw new Error('source unavailable');};
 const failed=await f.snapshot();assert.equal(f.cell(failed,f.tasks[1],'Client').rawValue,'inline');assert.equal(f.cell(failed,f.tasks[1],'Client').readOnlyReason,'unavailable');
 f.app.vault.read=original;assert.equal(await f.save(f.tasks[1],'Client','overwrite',before),'conflict');assert.equal(f.writes(),0);
 const native=getNativePropertyIndex(f.app);native.accept('H.md',(await scanFileWithMappings(f.app,f.files.get('H.md')!,[])).nativeProperties);
 assert.equal(f.cell(await f.snapshot(),f.tasks[1],'Client').rawValue,'outside');
});
test('surface sort cache matches uncached ordering across canonical, native, membership and source changes',async()=>{
 const f=nativeTableFixture(),owner={};let snapshot=await f.snapshot();
 const preset=createDefaultTablePreset();preset.summaries=[];
 let members=f.tasks;
 const check=()=>{
  const options={preset,filterSet:null,tasks:members,settings:DEFAULT_SETTINGS,priorities:DEFAULT_SETTINGS.priorities,
   valueResolverOptions:{filePropertyContext:snapshot,getFilePropertyValue:(task:IndexedTask,column:string)=>snapshot.getCell(task,column).normalizedValue}};
  const cached=queryTableRows({...options,sortCacheOwner:owner}).rows,uncached=queryTableRows(options).rows;
  assert.deepEqual(cached.map(task=>task.operonId),uncached.map(task=>task.operonId));
  for(const task of cached)assert.ok(members.includes(task),'cached permutation must return current task objects');
 };
 const values={Client:'changed',Values:[3,'3','Ali','Ali'],Amount:0,Done:false,Day:'2026-10-09',Meeting:'2026-10-09T12:00:00'};
 for(const key of ['Client','Values','Amount','Done','Day','Meeting']){
  preset.sortRules=[{key:encodeTableFilePropertyColumnKey(key)!,direction:'asc',empty:'last'}];check();
  const name=key as keyof typeof values;
  await f.save(f.tasks[1],name,values[name]);snapshot=await f.snapshot();check();
  preset.sortRules[0].direction='desc';check();preset.sortRules[0].empty='first';check();
 }
 for(const key of ['description','priority','status','datetimeModified']){
  preset.sortRules=[{key,direction:'asc',empty:'last'}];check();
  members=members.map((task,index)=>({...task,description:'new '+index,fieldValues:{...task.fieldValues,[key]:String(3-index)}}));check();
 }
 preset.sortRules=[{key:encodeTableFilePropertyColumnKey('Client')!,direction:'asc',empty:'last'},{key:'priority',direction:'desc',empty:'first'}];check();
 members=[...members].reverse();check();members=members.slice(0,2);check();members.push({...members[0],description:'duplicate identity'});check();
 members=members.map((task,index)=>({...task,primary:{...task.primary,filePath:'Source'+(3-index)+'.md',lineNumber:index}}));check();
 preset.sortRules=[];check();
});

test('preset changes preserve shared data and warm surfaces do not read sources or registry',async()=>{
 const f=nativeTableFixture(),owner={};let typeReads=0;
 const readTypes=f.app.vault.adapter.read;f.app.vault.adapter.read=async path=>{typeReads++;return readTypes(path);};
 await f.snapshot();const reads=f.reads(),registry=typeReads;
 const get=(target:object,needed=true)=>getTableNativePropertySnapshot(target,f.app,f.base,f.tasks,1,f.settings,()=>{assert.fail('warm snapshot must be synchronous');},needed);
 assert.equal(f.cell(get(owner),f.tasks[1],'Client').rawValue,'inline');get(owner,false);
 assert.equal(f.cell(get(owner),f.tasks[1],'Client').rawValue,'inline');get({});
 const native=getNativePropertyIndex(f.app);await native.ensure([f.tasks[1]]);assert.equal(native.getTask(f.tasks[1]).available,true);
 assert.equal(f.reads(),reads);assert.equal(typeReads,registry);
});
test('pending indexing coalesces editor/table demand and stale hydration cannot overwrite a committed source',async()=>{
 const f=nativeTableFixture(),native=getNativePropertyIndex(f.app);native.configure(f.settings);await native.ensure(f.tasks);
 const before=f.reads(),old=f.contents.get('H.md')!,original=f.app.vault.read;
 f.contents.set('H.md',old.replace('Client:: inline','Client:: delayed'));
 let release=()=>{};f.app.vault.read=async file=>file.path==='H.md'?new Promise<string>(resolve=>{release=()=>resolve(old);}):original(file);
 const pending=native.ensure([f.tasks[1]]);await settleNativeTable();
 f.app.vault.read=original;native.markPending('H.md');
 f.contents.set('H.md',old.replace('Client:: inline','Client:: latest'));
 const joined=native.ensure([f.tasks[1],f.tasks[2]]);
 native.accept('H.md',(await scanFileWithMappings(f.app,f.files.get('H.md')!,[])).nativeProperties,false);native.finishPending('H.md');native.publish();await joined;
 assert.equal(native.getTask(f.tasks[1]).properties.get('client')?.value,'latest');
 release();await pending;assert.equal(native.getTask(f.tasks[1]).properties.get('client')?.value,'latest');
 assert.equal(f.reads()-before,1,'only the canonical scan reaches the counted reader');
});

for (const value of ['long text', ['Drama', 'Action'], 0, false, null, undefined]) test(`Automatic warning classifies missing assignments without mutating ${JSON.stringify(value)}`, () => {
 assert.equal(nativePropertyReadOnlyReason('Value', value, {}, [], {}), 'automatic');
});
test('Automatic warnings distinguish explicit type and alias conflicts from unsupported data', () => {
 const declarations={Value:'text', Number:'number', Future:'future', List:'multitext'};
 const types=nativeEditorPropertyTypes(declarations,[]);
 assert.equal(nativePropertyReadOnlyReason('value','text',declarations,[],types),undefined);
 assert.equal(nativePropertyReadOnlyReason('Number',false,declarations,[],types),'type-conflict');
 assert.equal(nativePropertyReadOnlyReason('Future','text',declarations,[],types),'unsupported');
 assert.equal(nativePropertyReadOnlyReason('Nested',{x:1},declarations,[],types),'unsupported');
 assert.equal(nativePropertyReadOnlyReason('Value','text',{Value:'text',value:'text'},[],{}),'type-conflict');
 assert.equal(nativePropertyReadOnlyReason('List',[3,'3','Ali','Ali'],declarations,[],types),undefined);
 const mapped={canonicalKey:'client',visiblePropertyName:'Value',type:'text',isSystem:false,enabled:true,sync:'auto'} as KeyMapping;
 assert.equal(nativePropertyReadOnlyReason('client','text',declarations,[mapped],{}),'type-conflict');
 assert.equal(nativePropertyReadOnlyReason('Value','text',{},[mapped,{...mapped,canonicalKey:'other'}],{}),'type-conflict');
});
test('Automatic table warnings cover empty and populated file and inline cells, preserving source isolation',async()=>{
 const f=nativeTableFixture();delete f.declarations.Client;delete f.declarations.Values;delete f.declarations.Amount;delete f.declarations.Done;
 const base={...f.base,fields:['Client','Values','Amount','Done'].map(name=>({key:encodeTableFilePropertyColumnKey(name)!,propertyName:name,label:name,group:'fileProperty' as const,type:'text' as const,sourceType:'text' as const,icon:'text',readonly:false,aliases:[],sourceFileCount:1}))};
 const s=await loadTableNativePropertySnapshot(f.app,base,f.tasks,f.settings);
 for (const field of s.fields.filter(field=>base.fields.some(original=>original.propertyName===field.propertyName))) {
  assert.equal(field.icon,'shield-alert');assert.equal(field.readOnlyReason,'automatic');assert.equal(field.readonly,true);
  for (const task of f.tasks) assert.equal(s.getCell(task,field.key).readOnlyReason,'automatic');
 }
 assert.equal(f.cell(s,f.tasks[0],'Amount').rawValue,0);assert.equal(f.cell(s,f.tasks[0],'Done').rawValue,false);
 assert.equal(f.cell(s,f.tasks[1],'Client').rawValue,'inline','shared raw snapshots preserve Automatic inline values read-only');assert.equal(f.writes(),0);
 f.declarations.Client='text';const explicit=await loadTableNativePropertySnapshot(f.app,base,f.tasks,f.settings);
 assert.equal(explicit.fields.find(field=>field.propertyName==='Client')!.readOnlyReason,undefined);
 assert.equal(f.cell(explicit,f.tasks[1],'Client').nativeState,'ready');assert.equal(f.writes(),0);
});
test('Automatic table warnings retain special per-cell causes and never label nested data automatic',async()=>{
 const f=nativeTableFixture();delete f.declarations.Client;
 f.contents.set('F.md',f.contents.get('F.md')!.replace('Client: file','Client: {nested: keep}'));
 const base={...f.base,fields:[{key:encodeTableFilePropertyColumnKey('Client')!,propertyName:'Client',label:'Client',group:'fileProperty' as const,type:'text' as const,sourceType:'text' as const,icon:'text',readonly:false,aliases:[],sourceFileCount:1}]};
 const s=await loadTableNativePropertySnapshot(f.app,base,f.tasks,f.settings);
 assert.equal(f.cell(s,f.tasks[0],'Client').readOnlyReason,'unsupported');assert.equal(f.cell(s,f.tasks[1],'Client').readOnlyReason,'automatic');
 assert.deepEqual(f.cell(s,f.tasks[0],'Client').rawValue,{nested:'keep'});assert.equal(f.writes(),0);
});

test('Automatic warning changes invalidate cached reasons even when the field remains readonly',async()=>{
 const f=nativeTableFixture(),owner={};delete f.declarations.Client;
 let base={...f.base,fields:[{key:encodeTableFilePropertyColumnKey('Client')!,propertyName:'Client',label:'Client',group:'fileProperty' as const,type:'text' as const,sourceType:'text' as const,icon:'text',readonly:false,aliases:[],sourceFileCount:1}]};
 let ready=0;const get=()=>getTableNativePropertySnapshot(owner,f.app,base,f.tasks,1,f.settings,()=>{ready++;});
 get();await settleNativeTable();assert.equal(f.cell(get(),f.tasks[0],'Client').readOnlyReason,'automatic');
 f.declarations.Client='future';base={...base,signature:'unsupported-type'};get();await settleNativeTable();
 assert.equal(f.cell(get(),f.tasks[0],'Client').readOnlyReason,'unsupported');assert.equal(get().fields.find(field=>field.propertyName==='Client')!.icon,'text');
 assert.equal(f.writes(),0);assert.equal(ready,1);
 for(const value of [[false],[null],NaN,Infinity]) assert.equal(nativePropertyReadOnlyReason('Value',value,{},[],{}),'unsupported');
});

test('registry-only failure and identical recovery refresh native warnings without task invalidation',async()=>{
 const f=nativeTableFixture(),owner={},index=getTableFilePropertyIndex(f.app);let ready=0;
 const get=()=>getTableNativePropertySnapshot(owner,f.app,index.getSnapshot(f.tasks,1,{keyMappings:[]}),f.tasks,1,f.settings,()=>{ready++;});
 get();await settleNativeTable();const original=f.app.vault.adapter.read;
 assert.equal(f.cell(get(),f.tasks[0],'Client').nativeState,'ready');
 f.app.vault.adapter.read=async()=>{throw new Error('registry unavailable');};getNativePropertyIndex(f.app).setTypes(null);index.invalidateTypes();get();await settleNativeTable();
 assert.equal(f.cell(get(),f.tasks[0],'Client').readOnlyReason,'unavailable');
 f.app.vault.adapter.read=original;getNativePropertyIndex(f.app).setTypes(f.declarations as Record<string,ObsidianPropertyTypeId>);index.invalidateTypes();get();await settleNativeTable();
 assert.equal(f.cell(get(),f.tasks[0],'Client').nativeState,'ready');assert.equal(f.cell(get(),f.tasks[0],'Client').readOnlyReason,undefined);
 assert.equal(ready,1);assert.equal(f.writes(),0);
});

import "./native-property-index.test";

// Explicit custom-key type sync uses Obsidian's native writer, never inferred property types.
import { syncCustomPropertyType } from '../src/core/custom-property-type-sync';
function customTypeSyncFixture(initial: Record<string, string> = {}) {
 let disk = { ...initial }, memory = { ...initial }, writes = 0;
 let failure: 'read' | 'before' | 'after' | 'verify' | undefined;
 const mapping: KeyMapping = { canonicalKey: 'customValue', visiblePropertyName: 'Custom Value', type: 'text', isSystem: false, enabled: true, sync: 'yes' };
 const manager = {
  getAssignedWidget: (name: string) => Object.entries(memory).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] ?? null,
  async setType(name: string, type: string) {
   writes++;
   if (failure === 'before') throw new Error('write failed');
   memory[name] = type;
   if (failure === 'after') throw new Error('uncertain write');
   if (failure !== 'verify') disk = { ...memory };
  },
 };
 const app = { metadataTypeManager: manager, vault: { configDir: '.settings', adapter: {
  exists: async () => true,
  read: async (name: string) => { assert.equal(name, '.settings/types.json'); if (failure === 'read') throw new Error('read failed'); return JSON.stringify({ types: disk }); },
 } } } as unknown as App;
 return { app, mapping, manager, writes: () => writes, disk: () => disk,
  fail: (value: typeof failure) => { failure = value; },
  memory: (value: Record<string, string>) => { memory = value; },
 };
}
for (const type of ['text', 'list', 'number', 'checkbox', 'date', 'datetime'] as const) {
 test(`custom type sync assigns explicit ${type} once and preserves unrelated types`, async () => {
  const f = customTypeSyncFixture({ Existing: 'number' }); f.mapping.type = type;
  const result = await syncCustomPropertyType(f.app, f.mapping, () => true);
  assert.equal(result.status, 'updated');
  assert.deepEqual(f.disk(), { Existing: 'number', 'Custom Value': type === 'list' ? 'multitext' : type });
  assert.equal((await syncCustomPropertyType(f.app, f.mapping, () => true)).status, 'unchanged');
  assert.equal(f.writes(), 1);
 });
}
test('custom type sync preserves explicit conflicts through either alias and case', async () => {
 for (const alias of ['Custom Value','CUSTOMVALUE','custom value']) {
  const f=customTypeSyncFixture({[alias]:'number'});
  assert.equal((await syncCustomPropertyType(f.app,f.mapping,()=>true)).status,'conflict');assert.equal(f.writes(),0);
 }
});
test('custom type sync serializes repeated user requests without duplicate writes', async () => {
 const f=customTypeSyncFixture();
 const results=await Promise.all([syncCustomPropertyType(f.app,f.mapping,()=>true),syncCustomPropertyType(f.app,f.mapping,()=>true)]);
 assert.deepEqual(results.map(result=>result.status),['updated','unchanged']);assert.equal(f.writes(),1);
});
test('custom type sync refuses stale manager, unavailable API and cancelled mapping', async () => {
 const f=customTypeSyncFixture({Other:'number'});f.memory({});
 assert.equal((await syncCustomPropertyType(f.app,f.mapping,()=>true)).status,'failed');assert.equal(f.writes(),0);
 assert.equal((await syncCustomPropertyType({vault:f.app.vault} as App,f.mapping,()=>true)).status,'failed');
 assert.equal((await syncCustomPropertyType(f.app,f.mapping,()=>false)).status,'cancelled');
});
for (const failure of ['read','before','after','verify'] as const) test(`custom type sync never retries uncertain ${failure} failure`,async()=>{
 const f=customTypeSyncFixture({Other:'number'});f.fail(failure);
 assert.equal((await syncCustomPropertyType(f.app,f.mapping,()=>true)).status,'failed');
 assert.equal(f.writes(),failure==='read'?0:1);assert.deepEqual(f.disk(),{Other:'number'});
 if(failure!=='read'){f.fail(undefined);const other={...f.mapping,canonicalKey:'another',visiblePropertyName:'Another'};assert.equal((await syncCustomPropertyType(f.app,other,()=>true)).status,'failed');assert.equal(f.writes(),1,'later saves cannot flush an uncertain assignment');}
});
test('custom type sync cancels a mapping changed during registry read',async()=>{
 const f=customTypeSyncFixture();let current=true;const read=f.app.vault.adapter.read.bind(f.app.vault.adapter);
 f.app.vault.adapter.read=async name=>{const result=await read(name);current=false;return result;};
 assert.equal((await syncCustomPropertyType(f.app,f.mapping,()=>current)).status,'cancelled');assert.equal(f.writes(),0);
});
