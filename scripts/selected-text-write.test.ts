import { NativeLightboxLifecycle, trackLightboxTableCallbacks } from '../src/ui/native-lightbox-lifecycle';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const ts = createRequire(process.cwd() + '/package.json')('typescript') as typeof import('typescript');
import { TFile } from 'obsidian';
import { compactNativeInline, persistNativePropertySource, restoreNativePropertySource } from '../src/indexer/native-property-persistence';
import { OperonIndexer } from '../src/indexer/indexer';
import { TaskWriter } from '../src/core/task-writer';
import { DEFAULT_SETTINGS, migrateSettings } from '../src/types/settings';
import { findInlinePropertyTask, patchInlineProperties, prepareMappedInlineProperties, readParsedInlinePropertyProjection } from '../src/core/inline-property-source';
import { resolveInlinePropertyDefinition } from '../src/core/inline-property-definitions';
import { isEditableTableTaskFieldKey, normalizeTableTaskFieldKey } from '../src/ui/table/table-field-catalog';
import { readFileTaskPropertyDocument } from '../src/core/file-task-property-draft';

// Exercise the actual UI bridge, with the same typed writer used by production.
export function registerSelectedTextWriteTests(test: (name: string, run: () => Promise<void>) => void,
 withYaml: (run: () => Promise<void>) => Promise<void>): void {
 const source = readFileSync('main.ts', 'utf8');
 const start = source.indexOf('// UI Text edits use the existing typed transaction');
 const end = source.indexOf('const writerStartedAt', start);
 const body = ts.transpileModule(`async function prepare(task: any, normalizedPayload: any, options: any) { const operonId = task.operonId; ${source.slice(start,end)} return options; }`, {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const prepare = new Function('TFile','findInlinePropertyTask','prepareMappedInlineProperties','readParsedInlinePropertyProjection','resolveInlinePropertyDefinition','patchInlineProperties',body+';return prepare;')(TFile,findInlinePropertyTask,prepareMappedInlineProperties,readParsedInlinePropertyProjection,resolveInlinePropertyDefinition,patchInlineProperties);
 test('W034 native Text rescan cache reads only marked source and rejects concurrent changes',async()=>{
  const indexSource=readFileSync('src/indexer/indexer.ts','utf8');
  const begin=indexSource.indexOf('const cachedInlineSources =');
  const finish=indexSource.indexOf('const hydrateText =',begin);
  const js=ts.transpileModule(`async function hydrate(loaded:any, settings:any, decision:any) { const expectedSignature='same'; ${indexSource.slice(begin,finish)} return cachedInlineSources; }`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  for(const changed of [false,true]) {
   let reads=0;const file=Object.assign(new TFile(...(['Text.md'] as unknown as [])),{stat:{mtime:1,size:20}});
   const raw={frontmatter:null,order:[],inline:[]};
   const hydrate=new Function('restoreNativePropertySource','TFile','scanFileWithMappings','buildIndexV8SemanticsSignature',js+';return hydrate;')(restoreNativePropertySource,TFile,async()=>{reads++;if(changed)file.stat.mtime++;return {nativeProperties:raw};},()=> 'same');
   const result=await hydrate.call({app:{vault:{getAbstractFileByPath:()=>file}},storage:{getSettings:()=>({})}},
    {status:'loaded',validatedSnapshot:{shards:[{sources:[{path:'Text.md',mtimeMs:1,sizeBytes:20,native:{rescan:true}}]}]}},
    {keyMappings:[{isSystem:false,type:'text'}]}, {manifest:{indexSemanticsSignature:'same'}});
   assert.equal(reads,1);if(changed)assert.equal(result.status,'incompatible');else assert.deepEqual(result.get('Text.md'),[]);
  }
 });
 // Run the real normalizer and committed-settings publication, not an identity-preserving hook.
 const storageSource = readFileSync('src/storage/operon-storage.ts','utf8');
 const publicationStart = storageSource.indexOf('for (const key of Object.keys(normalized)');
 const publicationEnd = storageSource.indexOf('this.hydratePackageBackedSettingStores()',publicationStart);
 const publicationJs = ts.transpileModule(`function publishNormalized() { const submitted={...this.settings}; const normalized=migrateSettings(submitted); ${storageSource.slice(publicationStart,publicationEnd)} }`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const publishNormalized = new Function('migrateSettings',publicationJs+';return publishNormalized;')(migrateSettings);
 function extract(path:string,name:string,scope:Record<string,unknown>={}) {
  const text=readFileSync(path,'utf8');const ast=ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true);let found:import('typescript').Node|undefined;
  function visit(node:import('typescript').Node) { if((ts.isMethodDeclaration(node)||ts.isFunctionDeclaration(node))&&node.name?.getText(ast)===name)found=node;ts.forEachChild(node,visit); }visit(ast);
  assert.ok(found,name);const raw=found.getText(ast).replace(/^private /,'');
  const wrapped=ts.isMethodDeclaration(found)?`return ({${raw}}).${name};`:`${raw};return ${name};`;
  const js=ts.transpileModule(`function load(){${wrapped}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  return new Function(...Object.keys(scope),js+';return load();')(...Object.values(scope));
 }
 const normalizeTable=extract('main.ts','normalizeTableTaskFieldsWritebackPayload',{isEditableTableTaskFieldKey,normalizeTableTaskFieldKey,TABLE_REPEAT_AUXILIARY_WRITEBACK_KEYS:new Set()});
 const commitTable=extract('main.ts','commitTableTaskFieldsAndRefresh');
 const updateTable=extract('main.ts','updateTableTaskFieldsAndRefresh');
 const updateDirect=extract('main.ts','updateDirectTaskFieldsAndRefresh');
 const canWriteEmbedTable=extract('src/ui/embed-table-processor.ts','canWriteEmbedTable');
 const notices:string[]=[];
 const uiScope={Notice:class {constructor(message:string){notices.push(message);}},t:(_group:string,key:string)=>key};
 const standaloneCommit=extract('src/ui/table/operon-table-view.ts','commitTaskCellUpdate',uiScope);
 const embeddedCommit=extract('src/ui/embed-table-processor.ts','commitEmbedTableCellUpdate',{...uiScope,canWriteEmbedTable,
  syncEmbedTablePendingCellState:()=>{},closeEmbedTableActivePicker:()=>{},clearRenderedEmbedTablePendingCellState:()=>{},queueEmbedTablePendingCellFocusRestore:()=>{}});
 const mappings = migrateSettings({...DEFAULT_SETTINGS,keyMappings:[...DEFAULT_SETTINGS.keyMappings, {canonicalKey:'customText',visiblePropertyName:'Custom Text',type:'text' as const,sync:'yes' as const,isSystem:false,enabled:true}]}).keyMappings;
 const definitions = {version:1 as const,entries:['Custom Text'].map(sourceName=>({sourceName,type:'text' as const,encoding:'vault-v1' as const}))};
 function fixture(format: 'inline'|'yaml', normalize = false) {
  let content = format === 'inline' ? '- [ ] Task {{operonId:: text034}} {{Custom Text:: old}}\n' : '---\noperonId: text034\nCustom Text: old\n---\nBody\n';
  let writes=0;
  const file = Object.assign(new TFile(...(['Text.md'] as unknown as [])),{path:'Text.md',basename:'Text',extension:'md',stat:{ctime:1,mtime:1,size:content.length}});
  const task:any={operonId:'text034',description:'Task',checkbox:'open',tags:[],fieldValues:{customText:'old'},primary:{filePath:file.path,lineNumber:0,format}};
  const app:any={metadataCache:{getFileCache:()=>({listItems:[{task:' '}]} )},vault:{modify:async(_file:unknown,next:string)=>{content=next;writes++;},getAbstractFileByPath:()=>file,read:async()=>content,process:async(_file:unknown,transform:(s:string)=>string)=>{const next=transform(content);if(next!==content){content=next;writes++;}return content;}},fileManager:{processFrontMatter:async(_file:unknown,transform:(fm:any)=>void)=>{const yaml=await import('yaml');const doc=readFileTaskPropertyDocument(content)!;transform(doc.frontmatter);content='---\n'+yaml.stringify(doc.frontmatter)+'---\n'+doc.body;writes++;}}};
  const host:any={settings:{...DEFAULT_SETTINGS,keyMappings:mappings},storage:{getCommittedInlinePropertyDefinitions:()=>definitions,
   ensureInlinePropertyDefinitions:async(requested:unknown,canCommit?:()=>boolean)=>{assert.notEqual(canCommit?.(),false);assert.deepEqual(requested,definitions.entries);return definitions;}},app};
  const writer=new TaskWriter(app,{getTask:()=>task,hasDuplicateOperonIdConflict:()=>false,scheduleReindex:()=>{}} as any,mappings,{getInlinePropertyDefinitions:()=>definitions,prepareInlineProperties:async()=>{if(normalize) publishNormalized.call(host);return definitions;}});
  const read=()=>format==='yaml'?readFileTaskPropertyDocument(content)!.frontmatter['Custom Text']:readParsedInlinePropertyProjection(findInlinePropertyTask(content,file.path,task.operonId,mappings)!.parsed!,{'Custom Text':'text'},mappings,definitions).properties[0].value;
  const reindex=async()=>{const settings={...DEFAULT_SETTINGS,keyMappings:mappings,inlinePropertyDefinitions:definitions};const indexer=new OperonIndexer(app,{getSettings:()=>settings} as any);await (indexer as any).indexFile(file,undefined,undefined,undefined,mappings,settings,content);task.fieldValues={...indexer.getTask(task.operonId)!.fieldValues};};
  return {task,host,writer,read,reindex,getContent:()=>content,setContent:(v:string)=>{content=v;},getWrites:()=>writes,
   save:async(value:string,options:any={})=>{const payload={customText:value};const prepared=await prepare.call(host,task,payload,options);if(prepared===false)return false;return writer.writeTaskFields(task.operonId,payload,{mode:'merge',reindex:'none',touchAncestors:false,...prepared});}};
 }
 for(const surface of ['standalone','embedded','lightbox'])for(const format of ['inline','yaml'] as const)for(const [kind,value] of Object.entries({short:'hello',long:'long text '.repeat(1500),multiline:'first\r\nsecond\n[[Note|Alias]]'})) {
  test(`W034 normalized Table ${surface} ${format} ${kind} records native Text`,()=>withYaml(async()=>{
   const f=fixture(format,true);const originalMappings=f.host.settings.keyMappings;notices.length=0;
   const bridge={settings:f.host.settings,indexer:{getTask:()=>f.task},normalizeTableTaskFieldsWritebackPayload:normalizeTable,
    commitTableTaskFieldsAndRefresh:commitTable,withTableMutationRefresh:async(run:()=>Promise<boolean>)=>run(),
    updateDirectTaskFieldsAndRefresh:updateDirect,
    updateTaskFieldsAndRefresh:async(id:string,payload:Record<string,string>,options:any)=>{assert.equal(id,f.task.operonId);assert.equal(options.tableCommittedSource,true);assert.equal(options.directEdit.targetId,id);return f.save(payload.customText,{expectedFieldValues:{customText:'old'}});}};
   const directUpdate=(id:string,payload:Record<string,string>)=>updateTable.call(bridge,id,payload);
   const leaf:any={view:{getViewType:()=> 'operon-table-file-view'}};const lifecycle=surface==='lightbox'?new NativeLightboxLifecycle(f.host.app,leaf):null;
   const update=trackLightboxTableCallbacks(leaf,{onUpdateTaskFields:directUpdate}).onUpdateTaskFields!;
   const state:any={pendingCellKey:null,callbacks:{onUpdateTaskFields:update},syncPendingCellState:()=>{},closeActivePicker:()=>{},clearRenderedPendingCellState:()=>{},queuePendingCellFocusRestore:()=>{}};
   const cell={dataset:{editFocusKey:'text'}};
   const result=surface!=='embedded'?await standaloneCommit.call(state,cell,f.task,'customText','text',{customText:value}):await embeddedCommit(state,{updateTaskFields:update},cell,f.task,'customText','text',{customText:value});
   assert.equal(result,true);if(lifecycle){assert.equal(await lifecycle.prepare(),true);lifecycle.dispose();}assert.deepEqual(notices,[]);assert.equal(state.pendingCellKey,null);assert.equal(f.read(),value);assert.equal(f.getWrites(),1);
   if(format==='inline'){assert.notEqual(f.host.settings.keyMappings,originalMappings);assert.deepEqual(f.host.settings.keyMappings,originalMappings);}
   await f.reindex();assert.equal(f.task.fieldValues.customText,value);
  }));
 }
 test('W034 normalized Text retains cancellation and in-place mapping guards',()=>withYaml(async()=>{
  for(const mutation of ['cancel','mapping']) {
   const f=fixture('inline',true);f.host.settings.keyMappings=structuredClone(mappings);let active=true;
   const payload={customText:'new'};const options=await prepare.call(f.host,f.task,payload,{canCommit:()=>active});
   publishNormalized.call(f.host);
   if(mutation==='cancel')active=false;else f.host.settings.keyMappings.find((mapping:any)=>mapping.canonicalKey==='customText').visiblePropertyName='Changed';
   assert.equal(await f.writer.writeTaskFields(f.task.operonId,payload,{mode:'merge',reindex:'none',touchAncestors:false,...options}),false);assert.equal(f.getWrites(),0);
  }
 }));
 for(const format of ['inline','yaml'] as const)for(const [name,value] of Object.entries({short:'hello',long:'long text '.repeat(1500),multiline:'first\nsecond',crlf:'first\r\nsecond',syntax:'[[Folder/Note|Alias]] {{literal}} \\ path'})) {
  test(`W034 Text ${format} ${name} saves and reopens without loss`,()=>withYaml(async()=>{
   const f=fixture(format);assert.equal(await f.save(value),true);assert.equal(f.read(),value);
   await f.reindex();assert.equal(f.task.fieldValues.customText,value);
   if(format==='inline') {
    const parsed=findInlinePropertyTask(f.getContent(),'Text.md','text034',mappings)!.parsed!;
    const cached=restoreNativePropertySource(persistNativePropertySource({frontmatter:null,order:[],inline:[compactNativeInline(parsed)]}))!;
    const fields={customText:parsed.fields.find(field=>field.key==='customText')!.value};
    (OperonIndexer.prototype as any).applyNativeTextProjection(fields,cached.inline[0],mappings,{inlinePropertyDefinitions:definitions});
    assert.equal(fields.customText,value);
   }
   assert.equal(await f.save(f.task.fieldValues.customText,{expectedFieldValues:{customText:value}}),true);assert.equal(f.read(),value);
   if(format==='inline')assert.equal(f.getContent().trimEnd().split('\n').length,1);
  }));
 }
 for(const format of ['inline','yaml'] as const)test(`W034 Text ${format} Clear and cancelled lease`,()=>withYaml(async()=>{
  const f=fixture(format);assert.equal(await f.save('blocked',{canCommit:()=>false,expectedFieldValues:{customText:'old'}}),false);assert.equal(f.getWrites(),0);
  assert.equal(await f.save(''),true);assert.ok(f.read()==null||f.read()==='');
 }));
 test('W034 native Text stale source and duplicate aliases reject without writes',()=>withYaml(async()=>{
  for(const content of ['- [ ] Task {{operonId:: text034}} {{Custom Text:: changed}}','- [ ] Task {{operonId:: text034}} {{Custom Text:: old}} {{customText:: old}}']) {
   const f=fixture('inline');f.setContent(content);assert.equal(await f.save('new'),false);assert.equal(f.getWrites(),0);
  }
 }));
 test('W034 native Text raw preimage and mapping lease remain guarded',()=>withYaml(async()=>{
  for(const change of ['source','mapping']) {
   const f=fixture('inline'),payload={customText:'new'};const options=await prepare.call(f.host,f.task,payload,{});
   if(change==='source')f.setContent(f.getContent().replace(':: old',':: changed'));else f.host.settings.keyMappings=mappings.map(mapping=>mapping.canonicalKey==='customText'?{...mapping,visiblePropertyName:'Changed'}:mapping);
   assert.equal(await f.writer.writeTaskFields(f.task.operonId,payload,{mode:'merge',reindex:'none',touchAncestors:false,...options}),false);assert.equal(f.getWrites(),0);
  }
 }));
 test('W034 legacy native guard remains closed and both direct renderers forward typed drafts',()=>withYaml(async()=>{
  const f=fixture('inline');assert.equal(await f.writer.writeTaskFields(f.task.operonId,{customText:'new'},{mode:'merge',reindex:'none',touchAncestors:false}),false);assert.equal(f.getWrites(),0);
  const payload={customText:'first\r\n[[Note]]'};
  const prepared=await prepare.call(f.host,f.task,payload,{});
  const rendered=f.writer.renderGuardedTaskSourceContent('Text.md',f.getContent(),[{operonId:f.task.operonId,format:'inline',fieldValues:payload,inlinePropertyDraft:prepared.inlinePropertyDraft,expectedFieldValues:{customText:'old'}}]);
  assert.equal(rendered.ok,true);
  if(rendered.ok) {
   f.setContent(rendered.content);await f.reindex();assert.equal(f.task.fieldValues.customText,payload.customText);
  }
  for(const name of ['private async commitInlineTerminalRecurrenceMutation(', 'private renderDirectInlineFieldEdit(']) {
   const start=source.indexOf(name);assert.ok(start>=0,name);assert.match(source.slice(start,start+6500),/inlinePropertyDraft: options.inlinePropertyDraft/);
  }
 }));
}
