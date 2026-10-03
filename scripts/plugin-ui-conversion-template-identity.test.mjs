import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(path.join(root, 'main.ts'), 'utf8');
const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
const plugin = ast.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'OperonPlugin');
const names = [
 'loadFileTaskTemplateDocumentFromOption', 'buildOperonTemplatePlaceholderContext', 'normalizeTaskCreatorText',
 'resolveLoadedFileTaskTemplateDocument', 'fileTaskContentNeedsTemplaterProcessing', 'resolveOperonIdPlaceholdersInContent',
 'resolveOperonTemplatePlaceholdersInContent', 'resolveFileTaskTemplatePlaceholdersInContent', 'buildFileTaskDraft',
 'verifyAgentRuntimeTaskMutation', 'prepareAgentRuntimeSourceTransition', 'planSourceTransitionAggregatePatches', 'agentRuntimeTaskLocator', 'applyMobileUiCanonicalConversion',
 'finishInlineTaskToFileTaskConversion', 'finishInlineTaskToFileTaskConversionInSource', 'withInlineTaskConversionSource', 'isExcalidrawTaskSource', 'applyUiTemplateConversion', 'maybeProcessFileTaskTemplaterContent',
 'withInlineToFileTaskTransitionSafePass', 'isInlineToFileTaskTransitionContentValid', 'findInlineTaskLineIndex',
 'normalizeMovedInlineTaskPlainCheckboxLines', 'getCommonLeadingWhitespace', 'getCommonPrefix',
 'prependMovedPlainCheckboxLinesToFileTaskContent', 'getFrontmatterLineCount', 'buildInlineToFileTaskSourceReplacement',
 'reindexAgentRuntimeTaskSourceWrite', 'refreshUiConversionViews',
];
let transactionCallback, graphState;
function collect(node) {
 if(ts.isPropertyAssignment(node)&&node.name.getText(ast)==='prepareMutationTransaction')transactionCallback=node.initializer.getText(ast);
 if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='graphResourceState')graphState='const '+node.getText(ast)+';';
 ts.forEachChild(node,collect);
}
collect(plugin);assert.ok(transactionCallback);assert.ok(graphState);
const methods = names.map(name => {
 const method = plugin.members.find(n => n.name?.getText(ast) === name);
 assert.ok(method, name);
 return method.getText(ast);
}).join('\n')+'\nprepareMutationTransaction = '+transactionCallback+';';
const imports = ast.statements.filter(ts.isImportDeclaration).flatMap(n => {
 const bindings = n.importClause?.namedBindings;
 if (!bindings || !ts.isNamedImports(bindings)) return [];
 const matches = bindings.elements.filter(e => new RegExp('\\b' + e.name.text + '\\b').test(methods)).map(e => e.getText(ast));
 return matches.length ? [`import {${matches.join(',')}} from ${n.moduleSpecifier.getText(ast)};`] : [];
}).join('\n');
const constants = ast.statements.filter(ts.isVariableStatement).filter(n => n.declarationList.declarations.some(
 d => d.name.getText(ast) === 'OPERON_ID_PLACEHOLDER_VALUE_PATTERN',
)).map(n => n.getText(ast)).join('\n');
const dir = await mkdtemp(path.join(tmpdir(), 'operon-template-conversion-'));
try {
 const outfile = path.join(dir, 'test.mjs');
 await build({stdin: {resolveDir: root, loader: 'ts', contents: `
import assert from 'node:assert/strict';
import test from 'node:test';
import {TFile,TFolder} from 'obsidian';
import {TaskWriter} from './src/core/task-writer';
import {OperonIndexer} from './src/indexer/indexer';
import {AggregateCoordinator} from './src/systems/aggregate-coordinator';
import {DEFAULT_SETTINGS} from './src/types/settings';
import {parseTaskLine} from './src/core/parser';
import {analyzeTaskSourceRelationshipAuthority} from './src/core/task-source-relationship-authority';
import {executePluginUiConversionTransaction,conversionPreparationFailure} from './src/systems/plugin-ui-conversion-transaction';
${imports}
${constants}
${graphState}
const Platform={isMobile:true};
const t=(_domain,key)=>key;
const localNow=()=> '2026-09-28T12:00:00';
const createScopedMarkdownRefreshScope=paths=>({paths});
const callUnknownMethod=(value,name,...args)=>value[name](...args);
class Probe {${methods}}
` + String.raw`
const taskId='source1', now='2026-09-28T12:00:00.000Z';
const sourceBefore='- [ ] Convert me {{operonId:: source1}}\n- [ ] Own checkbox\n\n- [ ] Outside checkbox\n- [ ] Existing child {{operonId:: child01}} {{parentTask:: source1}}';
function template(suffix='1',idKey='operonId') {
 return '---\n'+idKey+': {{operonId'+suffix+'}}\ndatetimeCreated: {{datetime}}\n---\n## {{title}}\n- [ ] New child {{operonId:: {{operonId}}}} {{parentTask:: {{operonId'+suffix+'}}}}\n';
}
async function fixture(raw=template(),{keyMappings=[],disposition='keep-link'}={}) {
 const contents=new Map(),files=new Map(),writes=[],results=[],notices=[];
 const put=(p,c)=>{const f=files.get(p)??new TFile(p);f.stat={mtime:1,ctime:1,size:c.length};files.set(p,f);contents.set(p,c);return f;};
 const sourceFile=put('Source.md',sourceBefore);put('Template.md',raw);
 const selected={id:'template',kind:'folder',path:'Template.md'};
 const settings={...DEFAULT_SETTINGS,keyMappings,inlineToFileTaskSourceDisposition:disposition,inlineToFileTaskMovePlainCheckboxes:true};
 const app={metadataCache:{getFileCache:()=>({})},workspace:{getLeavesOfType:()=>[]},vault:{getAbstractFileByPath:p=>p===''?new TFolder(''):files.get(p)??null,
  read:async f=>contents.get(f.path),cachedRead:async f=>contents.get(f.path),
  process:async(f,cb)=>{const c=cb(contents.get(f.path));writes.push(['process',f.path]);put(f.path,c);return c;},
  create:async(p,c)=>{writes.push(['create',p]);return put(p,c);},modify:async(f,c)=>{writes.push(['modify',f.path]);put(f.path,c);},
 },fileManager:{trashFile:async f=>{writes.push(['trash',f.path]);files.delete(f.path);contents.delete(f.path);}}};
 const indexer=new OperonIndexer(app,{getSettings:()=>settings});
 const reindex=async paths=>{for(const p of paths){const f=files.get(p);if(f)await indexer.forceReindexKnownFileAfterMutation(f,{notify:false},contents.get(p));else await indexer.forceRemoveFilePathAfterMutation(p,{notify:false});}};
 indexer.reindexFilesBatch=reindex;indexer.forceReindexFilePathAfterMutation=async p=>reindex([p]);await reindex(['Source.md']);
 const probe=new Probe();Object.assign(probe,{app,indexer,settings,writer:new TaskWriter(app,indexer,keyMappings),
  readAgentRuntimeMutationSource:async p=>({content:contents.get(p)??null}),
  readAgentRuntimeCreationTemplate:async()=>({revision:{algorithm:'sha256',contentDigest:sha256HexV1(contents.get('Template.md'))}}),
  getFileTaskTemplateOptions:()=>[selected],getAgentRuntimeSettingsFingerprint:()=> 'settings',
  parseInlineTaskLine:(l,n,p)=>parseTaskLine(l,n,p,keyMappings),buildParsedTaskFieldValues:t=>Object.fromEntries(t.fields.map(f=>[f.key,f.value])),
  buildLinkedFileTaskSeed:async(p,fieldValues,fieldPresence)=>({fieldValues,fieldPresence,tags:[]}),
  getTargetFileTaskFolder:()=>'',sanitizeTaskFileName:s=>s,escapeFileTaskWikilinkTarget:s=>s,
  persistTaskEditorDeleteOpenSources:async()=>true,taskEditorDeleteOpenViewsMatch:()=>true,syncTaskEditorDeleteOpenViews:()=>true,
  aggregateCoordinator:{planCreationAggregatePatches:()=>[]},withDuplicateConflictAutoOpenSuppressed:async fn=>fn(),
  refreshViews:()=>{},refreshMarkdownTaskSurfaces:()=>{},scheduleInlineToFileTaskMarkdownRefresh:()=>{},scheduleInlineToFileTaskMetadataRefresh:()=>{},
  applyPipelineMinimalFileTaskTemplateStatus:()=>true,validateDependencyDraftOrShow:()=>true,ensureFileTaskFolder:async()=>{},
  formatConverter:{getUniqueFilePath:()=> 'Target.md'},buildFileTaskWikilink:()=> '[[Target]]',getTemplaterEngine:()=>null,
  showUiConversionResult:r=>{results.push(r);return r.status==='committed';},showTaskNotice:kind=>notices.push(kind),
 });
 const request={target:{operonId:taskId,locator:probe.agentRuntimeTaskLocator(indexer.getTaskSnapshot(taskId))},spec:{operation:'convert',from:'inline',to:'file',templateId:'template',targetPath:'Target.md'}};
 const children=c=>c.split('\n').flatMap((l,n)=>{const p=parseTaskLine(l,n,'Target.md',keyMappings);return p?.operonId?[{id:p.operonId,parent:p.fields.find(f=>f.key==='parentTask')?.value}]:[];});
 const valid=c=>analyzeTaskSourceRelationshipAuthority({content:c,filePath:'Target.md',keyMappings,pathIndexable:true,indexedTargetExists:id=>!!indexer.getTask(id)}).valid;
 return {probe,contents,files,writes,results,notices,selected,sourceFile,request,children,valid,put,settings};
}
for(const suffix of ['1','A','z'])test('canonical preparation binds root suffix '+suffix+' before deterministic child allocation',async()=>{
 const f=await fixture(template(suffix));
 for(const policy of [undefined,{checkboxOwnership:'contiguous'}]){
  const first=await f.probe.prepareAgentRuntimeSourceTransition(f.request,now,policy);
  const again=await f.probe.prepareAgentRuntimeSourceTransition(f.request,now,policy);
  assert.equal(first.ok,true);assert.deepEqual(again,first);
  const target=first.value.token.groups.find(g=>g.action==='create').nextContent;
  const [child]=f.children(target);assert.equal(child.parent,taskId);assert.notEqual(child.id,taskId);
  assert.equal(f.valid(target),true);assert.match(target,/operonId: source1/);assert.doesNotMatch(target,/\{\{(?:operonId[\dA-Za-z]?|datetime|title)\}\}/);
  assert.equal(target.includes('Outside checkbox'),policy===undefined);
 }
 assert.equal(f.writes.length,0);
});
test('mobile transaction creates template child and removes only owned source checkboxes',async()=>{
 const f=await fixture();const result=await f.probe.applyMobileUiCanonicalConversion(f.request);
 assert.equal(result.status,'committed');assert.equal(f.probe.indexer.getTask(taskId).primary.format,'yaml');
 const target=f.contents.get('Target.md');assert.equal(f.children(target)[0].parent,taskId);assert.equal(f.valid(target),true);
 assert.ok(target.includes('Own checkbox'));assert.ok(!target.includes('Outside checkbox'));
 assert.ok(!f.contents.get('Source.md').includes('Own checkbox'));assert.ok(f.contents.get('Source.md').includes('Existing child'));
 assert.equal(f.probe.indexer.hasDuplicateOperonIdConflict(taskId),false);assert.equal(f.writes.filter(([kind])=>kind==='create').length,1);
});
for(const disposition of ['keep-link','remove-inline-task'])test('UI entry and alternative transaction bind template children: '+disposition,async()=>{
 const f=await fixture(template(),{disposition});
 // This result selects the existing alternative branch without stubbing template preparation or writing.
 f.probe.applyUiCanonicalConversion=async()=>({status:'template-required'});
 await f.probe.finishInlineTaskToFileTaskConversion(f.sourceFile,f.probe.parseInlineTaskLine(sourceBefore.split('\n')[0],0,'Source.md'),f.selected);
 assert.equal(f.results.at(-1)?.status,'committed');assert.deepEqual(f.notices,['inline-to-file']);
 assert.equal(f.children(f.contents.get('Target.md'))[0].parent,taskId);assert.equal(f.valid(f.contents.get('Target.md')),true);
 assert.ok(f.contents.get('Source.md').startsWith(disposition==='keep-link'?'[[Target]]':'\n'));
 assert.ok(!f.contents.get('Source.md').includes('Own checkbox'));assert.ok(f.contents.get('Source.md').includes('Existing child'));
});
for(const route of ['template','canonical-mobile','active-template','active-canonical-mobile','native-save-canonical-mobile'])test('open Excalidraw inline conversion synchronizes native buffers: '+route,async()=>{
 const f=await fixture();
 const suffix='\n\n# Operon task source1\n\n'+String.fromCharCode(96).repeat(3)+'operon\nview: card\ntaskId: source1\n'+String.fromCharCode(96).repeat(3)+'\n\n%%\n# Excalidraw Data\n\n## Drawing\n'+String.fromCharCode(96).repeat(3)+'compressed-json\nopaque\n'+String.fromCharCode(96).repeat(3)+'\n%%';
 const before='---\nexcalidraw-plugin: parsed\n---\n\n## Backlog\n'+sourceBefore+suffix;
 f.put('Source.md',before);await f.probe.indexer.reindexFilesBatch(['Source.md']);
 f.request.target.locator=f.probe.agentRuntimeTaskLocator(f.probe.indexer.getTaskSnapshot(taskId));
 const scene=[{id:'card',x:100,y:200,width:400,height:180,link:'[[Source#Operon task source1]]'}];
 const view={file:f.sourceFile,data:before,preparedSaveText:before,lastSavedData:before,plugin:{},isSynchronizing:false,
  isSameFileEditingActive:()=>false,saveCoordinator:{isSaveInProgress:false},
  acquireSynchronization:async()=>{view.isSynchronizing=true;return true;},withPersistenceWriteLease:async(_,fn)=>fn(),
  excalidrawAPI:{getAppState:()=>({viewModeEnabled:false}),getSceneElements:()=>scene}};
 const peer={...view,acquireSynchronization:async()=>{peer.isSynchronizing=true;return true;}};
 f.probe.app.workspace.getLeavesOfType=type=>type==='excalidraw'?[{view},{view:peer}]:[];
 f.probe.app.metadataCache.getFileCache=()=>({frontmatter:{'excalidraw-plugin':'parsed'}});
 f.probe.applyUiCanonicalConversion=route.endsWith('template')?async()=>({status:'template-required'}):async()=>f.probe.applyMobileUiCanonicalConversion(f.request);
 let deactivations=0;
 if(route.startsWith('active-')){
  Object.assign(scene[0],{type:'embeddable',customData:{mdProps:{lockedReadingMode:true}}});
  const node={isConnected:true},container={closest:()=>node};
  Object.assign(view,{contentEl:{contains:n=>n===node},getEmbeddableLeafElementById:()=>({node:{file:f.sourceFile,containerEl:container}})});
  f.probe.app.metadataCache.getFirstLinkpathDest=()=>f.sourceFile;
  const state={viewModeEnabled:false,activeEmbeddable:{element:{id:'card'},state:'active'}};
  let blocked=true;view.isSameFileEditingActive=()=>blocked;
  view.excalidrawAPI.getAppState=()=>state;
  view.excalidrawAPI.updateScene=update=>{assert.equal(update.captureUpdate,'NEVER');state.activeEmbeddable=null;deactivations++;setTimeout(()=>{blocked=false;},100);};
 }
 let nativeSaveAttempts=0,nativeSaveWrites=0;
 if(route==='native-save-canonical-mobile'){
  const create=f.probe.app.vault.create;
  f.probe.app.vault.create=async(p,c)=>{
   const file=await create(p,c);nativeSaveAttempts++;
   // Native autosave may wake between the target create and source replacement.
   if(!view.isSynchronizing){nativeSaveWrites++;const saved=view.data.replace('opaque','scene-updated');f.put('Source.md',saved);view.data=saved;peer.data=saved;}
   return file;
  };
 }
 const geometryBefore=JSON.stringify(scene);
 const parsed=f.probe.parseInlineTaskLine(sourceBefore.split('\n')[0],5,'Source.md');
 await f.probe.finishInlineTaskToFileTaskConversion(f.sourceFile,parsed,f.selected);
 assert.equal(f.results.at(-1)?.status,'committed');
 if(route==='native-save-canonical-mobile'){assert.equal(nativeSaveAttempts,1);assert.equal(nativeSaveWrites,0);}
 const after=f.contents.get('Source.md');assert.ok(after.includes('[[Target]]'));assert.ok(!after.includes('Convert me {{operonId:: source1}}'));
 assert.ok(after.endsWith(suffix));assert.equal(f.probe.indexer.hasDuplicateOperonIdConflict(taskId),false);
 assert.equal(f.probe.indexer.getTask(taskId).primary.format,'yaml');
 for(const v of [view,peer]){assert.equal(v.data,after);assert.equal(v.preparedSaveText,after);assert.equal(v.lastSavedData,after);assert.equal(v.isSynchronizing,false);}
 // A later native save must preserve the replacement, not resurrect the old inline source.
 await view.withPersistenceWriteLease('Source.md',()=>f.probe.app.vault.modify(f.sourceFile,view.data));
 assert.equal(f.contents.get('Source.md'),after);assert.equal(view.excalidrawAPI.getSceneElements(),scene);
 assert.equal(JSON.stringify(scene),geometryBefore);assert.equal(deactivations,route.startsWith('active-')?1:0);
});
test('canonical conversion counts existing and new template children with a parent in the source',async()=>{
 const f=await fixture();
 const before='---\noperonId: parent1\n---\n'+sourceBefore.replace('{{operonId:: source1}}','{{operonId:: source1}} {{parentTask:: parent1}} {{directSubtaskCount:: 1}}');
 f.put('Source.md',before);await f.probe.indexer.reindexFilesBatch(['Source.md']);
 f.request.target.locator=f.probe.agentRuntimeTaskLocator(f.probe.indexer.getTaskSnapshot(taskId));
 f.probe.aggregateCoordinator=new AggregateCoordinator(f.probe.indexer,f.probe.writer);
 let prepared,effectiveAt;const prepare=f.probe.prepareAgentRuntimeSourceTransition.bind(f.probe);
 f.probe.prepareAgentRuntimeSourceTransition=async(request,at,...rest)=>{effectiveAt=at;prepared=await prepare(request,at,...rest);return prepared;};
 const result=await f.probe.applyMobileUiCanonicalConversion(f.request);
 assert.equal(result.status,'committed');
 const commit={status:'committed',groupResults:[{resourceRevisions:[...f.contents].filter(([p])=>p!=='Template.md').map(([p,c])=>({resourceKind:'task-source',resourceKey:p,revision:sourceRevisionForTaskCreationV1(p,c)}))}]};
 assert.equal(await f.probe.verifyAgentRuntimeTaskMutation(effectiveAt,prepared.value,commit),true,'desktop postflight accepts corrected aggregates');
 assert.equal(f.probe.indexer.getTaskSnapshot(taskId).fieldValues.directSubtaskCount,'2');
 assert.equal(f.probe.indexer.getTaskSnapshot('parent1').fieldValues.treeDescendantCount,'3');
 assert.deepEqual(f.probe.aggregateCoordinator.verifyExactTaskAggregateState([taskId,'parent1']),new Set([taskId,'parent1']));
 assert.equal(f.probe.indexer.hasDuplicateOperonIdConflict(taskId),false);
});
test('desktop sealed conversion commits and verifies parent plus template descendants',async()=>{
 const f=await fixture();
 const before='---\noperonId: parent1\n---\n'+sourceBefore.replace('{{operonId:: source1}}','{{operonId:: source1}} {{parentTask:: parent1}} {{directSubtaskCount:: 1}}');
 f.put('Source.md',before);await f.probe.indexer.reindexFilesBatch(['Source.md']);
 f.request.target.locator=f.probe.agentRuntimeTaskLocator(f.probe.indexer.getTaskSnapshot(taskId));
 f.probe.aggregateCoordinator=new AggregateCoordinator(f.probe.indexer,f.probe.writer);
 const prepared=await f.probe.prepareAgentRuntimeSourceTransition(f.request,now,{checkboxOwnership:'contiguous'},'plugin');assert.equal(prepared.ok,true);
 const request={plan:{spec:f.request.spec,mutationKind:'task.convert',atomicGroups:[{groupId:'conversion',resources:prepared.value.affectedResources}]}};
 const sealed=await f.probe.prepareMutationTransaction(request,prepared.value,now);assert.equal(sealed.ok,true,sealed.reason);
 const revisions=[];
 for(const step of sealed.steps){
  const result=await f.probe.writer.applyTaskSourceMutation(step.operation==='create'
   ?{kind:'create',filePath:step.resourceKey,nextContent:step.after.content}
   :{kind:'modify',filePath:step.resourceKey,expectedContent:step.before.content,nextContent:step.after.content});
  assert.equal(result.outcome,'committed');
  await f.probe.reindexAgentRuntimeTaskSourceWrite(result,step.resourceKey);
  revisions.push({resourceKind:'task-source',resourceKey:step.resourceKey,revision:sourceRevisionForTaskCreationV1(step.resourceKey,step.after.content)});
 }
 const commit={status:'committed',groupResults:[{resourceRevisions:revisions}]};
 assert.equal(await f.probe.verifyAgentRuntimeTaskMutation(now,prepared.value,commit),true);
 assert.equal(f.probe.indexer.getTaskSnapshot(taskId).fieldValues.directSubtaskCount,'2');
 assert.equal(f.probe.indexer.getTaskSnapshot('parent1').fieldValues.treeDescendantCount,'3');
 assert.ok(f.contents.get('Source.md').includes('[[Target]]'));assert.equal(f.probe.indexer.hasDuplicateOperonIdConflict(taskId),false);
 // A real unexpected field change must still fail verification.
 f.put('Target.md',f.contents.get('Target.md').replace('operonId: source1','operonId: source1\npriority: A'));
 assert.equal(await f.probe.verifyAgentRuntimeTaskMutation(now,prepared.value,commit),false);
});
test('conversion leaves an unrelated source task and its external parent untouched',async()=>{
 const f=await fixture();
 const otherParent='---\noperonId: otherp1\n---\nOther parent';f.put('Other.md',otherParent);
 const unrelated='- [ ] Unrelated {{operonId:: other01}} {{parentTask:: otherp1}}';
 f.put('Source.md',sourceBefore+'\n'+unrelated);await f.probe.indexer.reindexFilesBatch(['Source.md','Other.md']);
 f.request.target.locator=f.probe.agentRuntimeTaskLocator(f.probe.indexer.getTaskSnapshot(taskId));
 f.probe.aggregateCoordinator=new AggregateCoordinator(f.probe.indexer,f.probe.writer);
 const result=await f.probe.applyMobileUiCanonicalConversion(f.request);
 assert.equal(result.status,'committed');assert.equal(f.contents.get('Other.md'),otherParent);
 assert.ok(f.contents.get('Source.md').includes(unrelated));
 assert.equal(f.probe.indexer.getTaskSnapshot(taskId).fieldValues.directSubtaskCount,'2');
});
for(const targetKind of ['markdown','drawing','drawing-autosave'])test('file to inline projects remaining children and preserves cards: '+targetKind,async()=>{
 const f=await fixture();f.probe.aggregateCoordinator=new AggregateCoordinator(f.probe.indexer,f.probe.writer);
 assert.equal((await f.probe.applyMobileUiCanonicalConversion(f.request)).status,'committed');
 const createdChild=f.children(f.contents.get('Target.md'))[0].id;
 assert.equal(f.probe.indexer.getTask(taskId).fieldValues.directSubtaskCount,'2');
 const suffix='\n%%\n# Excalidraw Data\n\n## Drawing\n~~~compressed-json\nopaque\n~~~\n%%';
 const drawing=targetKind!=='markdown';
 if(drawing)f.put('Source.md','---\nexcalidraw-plugin: parsed\n---\n\n## Backlog\n'+f.contents.get('Source.md')+suffix);
 else f.put('Source.md',f.contents.get('Source.md')+'\n\n');
 await f.probe.indexer.reindexFilesBatch(['Source.md']);
 const elements=[{id:'same-card',x:75,y:34,width:460,height:142,angle:0.4,strokeColor:'#feaaaa',link:'[[Source#Operon task source1]]'},
  {id:'arrow',startBinding:{elementId:'same-card'}}];const beforeGeometry=JSON.stringify(elements);
 const native={file:f.sourceFile,data:f.contents.get('Source.md'),preparedSaveText:f.contents.get('Source.md'),lastSavedData:f.contents.get('Source.md'),isSynchronizing:false,plugin:{},
  isSameFileEditingActive:()=>false,saveCoordinator:{isSaveInProgress:false},excalidrawAPI:{getAppState:()=>({viewModeEnabled:false}),getSceneElements:()=>elements},
  acquireSynchronization:async()=>{native.isSynchronizing=true;return true;},withPersistenceWriteLease:async(_,fn)=>fn()};
 const peer={...native,acquireSynchronization:async()=>{peer.isSynchronizing=true;return true;}};
 if(drawing){f.probe.app.workspace.getLeavesOfType=()=>[{view:native},{view:peer}];f.probe.app.metadataCache.getFileCache=file=>file===f.sourceFile?{frontmatter:{'excalidraw-plugin':'parsed'}}:{};}
 f.probe.formatConverter.yamlToInline=()=>'- [ ] Convert me {{operonId:: source1}} {{directSubtaskCount:: 2}}';
 f.probe.promptConfirmAction=async()=>{if(targetKind==='drawing-autosave'){const live=native.data.replace('opaque','saved-scene');f.put('Source.md',live);for(const v of [native,peer])v.data=v.preparedSaveText=v.lastSavedData=live;}return true;};
 const request={target:{operonId:taskId,locator:f.probe.agentRuntimeTaskLocator(f.probe.indexer.getTaskSnapshot(taskId))},spec:{operation:'convert',from:'file',to:'inline',target:{mode:'configured-target',filePath:'Source.md'}}};
 const result=await f.probe.applyMobileUiCanonicalConversion(request,undefined,drawing?'Source.md':undefined);
 assert.equal(result.status,'committed');assert.equal(f.files.has('Target.md'),false);assert.equal(f.probe.indexer.getTask(createdChild),undefined);
 assert.equal(f.probe.indexer.getTask(taskId).primary.format,'inline');assert.equal(f.probe.indexer.getTask(taskId).fieldValues.directSubtaskCount,'1');
 assert.equal(f.probe.indexer.getTask('child01').fieldValues.parentTask,taskId);
 assert.equal(f.probe.indexer.hasDuplicateOperonIdConflict(taskId),false);assert.equal(JSON.stringify(elements),beforeGeometry);
 assert.deepEqual(f.probe.aggregateCoordinator.verifyExactTaskAggregateState([taskId]),new Set([taskId]));
 if(drawing){const after=f.contents.get('Source.md');assert.ok(after.indexOf('{{operonId:: source1}}')<after.indexOf('%%'));assert.ok(after.includes('## Backlog'));
  assert.ok(after.endsWith(targetKind==='drawing-autosave'?suffix.replace('opaque','saved-scene'):suffix));
  for(const v of [native,peer]){assert.equal(v.data,after);assert.equal(v.preparedSaveText,after);assert.equal(v.isSynchronizing,false);}}
});
test('custom YAML identity mapping and CRLF retain root references',async()=>{
 const mappings=[{canonicalKey:'operonId',visiblePropertyName:'TaskID',type:'text',sync:'yes',enabled:true,isSystem:true}];
 const f=await fixture(template('2','TaskID').replaceAll('\n','\r\n'),{keyMappings:mappings});
 const loaded=await f.probe.loadFileTaskTemplateDocumentFromOption(f.selected,()=> 'fresh01',taskId);
 assert.equal(loaded.document.managedFieldValues.operonId,taskId);assert.equal(f.children(loaded.resolvedContent)[0].parent,taskId);
});
test('other suffix trees retain distinct identities',async()=>{
 const f=await fixture(template()+'- [ ] Other root {{operonId:: {{operonId2}}}}\n- [ ] Other child {{operonId:: {{operonId}}}} {{parentTask:: {{operonId2}}}}');
 let n=0;const r=await f.probe.loadFileTaskTemplateDocumentFromOption(f.selected,()=> 'new'+String(++n).padStart(4,'0'),taskId);
 const [child,other,grandchild]=f.children(r.resolvedContent);
 assert.equal(child.parent,taskId);assert.equal(grandchild.parent,other.id);assert.notEqual(other.id,taskId);
 assert.equal(new Set([taskId,child.id,other.id,grandchild.id]).size,4);
});
test('ordinary template creation keeps fresh root allocation when no existing identity is supplied',async()=>{
 const f=await fixture();let n=0;const loaded=await f.probe.loadFileTaskTemplateDocumentFromOption(f.selected,()=> 'new'+String(++n).padStart(4,'0'));
 assert.equal(loaded.resolvedOperonIdSeed,'new0001');assert.equal(f.children(loaded.resolvedContent)[0].parent,'new0001');assert.equal(n,2);
});
test('unnumbered independent placeholders and explicit root values are not rebound',async()=>{
 for(const rootValue of ['{{operonId}}','literal','']){
  const f=await fixture('---\noperonId: '+rootValue+'\n---\n- [ ] Independent {{operonId:: {{operonId}}}}');let n=0;
  const loaded=await f.probe.loadFileTaskTemplateDocumentFromOption(f.selected,()=> 'new'+String(++n).padStart(4,'0'),taskId);
  assert.notEqual(f.children(loaded.resolvedContent)[0].id,taskId);
  if(rootValue==='literal')assert.equal(loaded.document.managedFieldValues.operonId,'literal');
 }
});
test('unrelated missing parent is still rejected without writing',async()=>{
 const f=await fixture(template()+'- [ ] Invalid child {{operonId:: {{operonId}}}} {{parentTask:: missing}}');
 const prepared=await f.probe.prepareAgentRuntimeSourceTransition(f.request,now);assert.equal(prepared.ok,true);
 const target=prepared.value.token.groups.find(g=>g.action==='create').nextContent;
 const result=await f.probe.writer.applyTaskSourceMutation({kind:'create',filePath:'Target.md',nextContent:target});
 assert.equal(result.outcome,'conflict');assert.equal(f.writes.length,0);assert.equal(f.contents.get('Source.md'),sourceBefore);
});
`}, outfile, bundle: true, format: 'esm', platform: 'node', target: ['node18'], logLevel: 'silent',
 alias: {obsidian: path.join(root, 'scripts/test-support/obsidian.ts')},
 });
 await import(pathToFileURL(outfile));
} finally { await rm(dir, {recursive: true, force: true}); }
