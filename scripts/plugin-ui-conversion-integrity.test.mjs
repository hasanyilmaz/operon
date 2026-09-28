import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import ts from 'typescript';
import {build} from 'esbuild';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=await readFile(path.join(root,'main.ts'),'utf8');
const ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
const plugin=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='OperonPlugin');
const names=['convertInlineTaskToFileTaskById','applyUiCanonicalConversion','showUiConversionResult','refreshUiConversionViews','applyUiTemplateConversion','maybeProcessFileTaskTemplaterContent','withInlineToFileTaskTransitionSafePass','isInlineToFileTaskTransitionContentValid','findInlineTaskLineIndex','normalizeMovedInlineTaskPlainCheckboxLines','getCommonLeadingWhitespace','getCommonPrefix','prependMovedPlainCheckboxLinesToFileTaskContent','getFrontmatterLineCount','buildInlineToFileTaskSourceReplacement','reindexAgentRuntimeTaskSourceWrite'];
const methods=names.map(name=>{const m=plugin.members.find(n=>n.name?.getText(ast)===name);assert.ok(m,name);return m.getText(ast)}).join('\n');
const imports=new Set(['splitFrontmatterDocument','parseFrontmatterDocument','sourceRevisionForTaskCreationV1','reindexCommittedRuntimeTaskSourceWriteV1','collectScopedPlainCheckboxMoveLines','removePlainCheckboxMoveLinesFromContent']);
const selected=ast.statements.filter(ts.isImportDeclaration).flatMap(n=>{const b=n.importClause?.namedBindings;if(!b||!ts.isNamedImports(b))return [];const names=b.elements.filter(e=>imports.has(e.name.text)).map(e=>e.getText(ast));return names.length?[`import {${names.join(',')}} from ${n.moduleSpecifier.getText(ast)};`]:[]}).join('\n');
const dir=await mkdtemp(path.join(tmpdir(),'operon-conversion-ui-'));
try {
const outfile=path.join(dir,'test.mjs');
await build({stdin:{resolveDir:root,loader:'ts',contents:`
import assert from 'node:assert/strict';
import test from 'node:test';
import {TFile,TFolder} from 'obsidian';
import {TaskWriter} from './src/core/task-writer';
import {OperonIndexer} from './src/indexer/indexer';
import {DEFAULT_SETTINGS} from './src/types/settings';
import {parseTaskLine} from './src/core/parser';
import {executePluginUiConversionTransaction,conversionPreparationFailure} from './src/systems/plugin-ui-conversion-transaction';
${selected}
const notices=[];class Notice{constructor(text){notices.push(text)}}
const t=(_domain,key,vars)=>key+':'+JSON.stringify(vars??{});
const Platform={isMobile:false};
const getActiveWindow=()=>({crypto:{randomUUID:()=> 'test-request'}});
const createScopedMarkdownRefreshScope=paths=>({paths});
const delayWithActiveWindow=async()=>{};
const callUnknownMethod=(value,name,...args)=>value[name](...args);
class Probe{${methods}}
`+String.raw`
const inline='- [ ] Parent {{operonId:: parent1}}';
const before=inline+'\n    - [ ] Own\n        - [x] Nested\n\n- [ ] Outside\n- [ ] Child {{operonId:: child01}} {{parentTask:: parent1}}\n- [ ] Child checkbox';
const yaml='---\noperonId: parent1\n---\nBody';
async function fixture({templater=false,disposition='keep-link',carry=true}={}){
 const files=new Map(),contents=new Map(),buffers=new Map(),writes=[];
 let onRead=null,onModify=null,onCreate=null,engine=null;
 const put=(p,c)=>{const f=files.get(p)??new TFile(p);f.stat={mtime:1,ctime:1,size:c.length};files.set(p,f);contents.set(p,c);return f};
 const sourceFile=put('Source.md',before);
 const app={vault:{getAbstractFileByPath:p=>p===''?new TFolder(''):files.get(p)??null,
  read:async f=>{await onRead?.(f.path);return contents.get(f.path)},cachedRead:async f=>contents.get(f.path),
  create:async(p,c)=>{const f=put(p,c);writes.push(['create',p]);await onCreate?.(p);return f},
  modify:async(f,c)=>{await onModify?.(f.path,c);put(f.path,c);writes.push(['modify',f.path])},
  process:async(f,cb)=>{const c=cb(contents.get(f.path));put(f.path,c);writes.push(['process',f.path]);return c},
 },fileManager:{trashFile:async f=>{files.delete(f.path);contents.delete(f.path);writes.push(['trash',f.path])}}};
 const settings={...DEFAULT_SETTINGS,keyMappings:[],inlineToFileTaskSourceDisposition:disposition,inlineToFileTaskMovePlainCheckboxes:carry};
 const indexer=new OperonIndexer(app,{getSettings:()=>settings});
 const reindex=async paths=>{for(const p of paths){const f=files.get(p);if(f)await indexer.forceReindexKnownFileAfterMutation(f,{notify:false},contents.get(p));else await indexer.forceRemoveFilePathAfterMutation(p,{notify:false})}};
 indexer.reindexFilesBatch=reindex;indexer.forceReindexFilePathAfterMutation=async p=>reindex([p]);
 await reindex(['Source.md']);
 const probe=new Probe();Object.assign(probe,{app,indexer,settings,writer:new TaskWriter(app,indexer,[]),
 readAgentRuntimeMutationSource:async p=>({content:contents.get(p)??null}),
 parseInlineTaskLine:(l,n,p)=>parseTaskLine(l,n,p,[]),withDuplicateConflictAutoOpenSuppressed:async fn=>fn(),
 taskEditorDeleteOpenViewsMatch:(p,c)=>!buffers.has(p)||buffers.get(p)===c,
 syncTaskEditorDeleteOpenViews:(p,b,a)=>{if(!buffers.has(p))return true;if(buffers.get(p)===a)return true;if(buffers.get(p)!==b)return false;buffers.set(p,a);return true},
 persistTaskEditorDeleteOpenSources:async()=>true,
 fileTaskContentNeedsTemplaterProcessing:(_t,c)=>c.includes('<%'),getTemplaterEngine:()=>engine,
 resolveFileTaskTemplatePlaceholdersInContent:c=>c,buildFileTaskWikilink:()=> '[[Target]]',
 refreshViews:()=>{},refreshMarkdownTaskSurfaces:()=>{},scheduleInlineToFileTaskMarkdownRefresh:()=>{},scheduleInlineToFileTaskMetadataRefresh:()=>{},agentRuntimeTaskLocator:t=>({filePath:t.primary.filePath,representation:'inline',lineNumber:t.primary.lineNumber}),promptConfirmAction:async()=>true,
 });
 const draft={operonId:'parent1',content:yaml+(templater?'\n<% text %>':''),fieldValues:{operonId:'parent1'}};
 const run=(snapshot=before,allowed=()=>true)=>probe.applyUiTemplateConversion(sourceFile,{operonId:'parent1',lineNumber:99},'Target.md',draft,null,{id:'test'}, {},snapshot,allowed);
 return {probe,app,indexer,contents,files,buffers,writes,put,run,draft,reindex,setEngine:x=>engine=x,setRead:x=>onRead=x,setModify:x=>onModify=x,setCreate:x=>onCreate=x};
}
for(const disposition of ['keep-link','remove-inline-task'])for(const carry of [false,true])test('fallback preserves ownership and children '+disposition+' '+carry,async()=>{
 const f=await fixture({disposition,carry});f.buffers.set('Source.md',before);
 const r=await f.run();assert.equal(r.status,'committed');
 assert.equal(f.contents.get('Target.md').includes('Own'),carry);
 assert.equal(f.contents.get('Target.md').includes('Outside'),false);assert.equal(f.contents.get('Target.md').includes('Child checkbox'),false);
 assert.equal(f.contents.get('Source.md').includes('Own'),!carry);assert.ok(f.contents.get('Source.md').includes('Child checkbox'));
 assert.ok(f.contents.get('Source.md').startsWith(disposition==='keep-link'?'[[Target]]':''));
 assert.equal(f.buffers.get('Source.md'),f.contents.get('Source.md'));assert.equal(f.indexer.getTask('parent1').primary.format,'yaml');assert.equal(f.indexer.hasDuplicateOperonIdConflict('parent1'),false);
});
test('stale source and cancellation cause zero conversion writes',async()=>{
 const f=await fixture();assert.equal((await f.run(before,()=>false)).status,'cancelled');assert.equal(f.writes.length,0);
 f.put('Source.md',before+'\nnew');assert.equal((await f.run()).status,'not-applied');assert.equal(f.writes.length,0);
});
for(const mode of ['unavailable','throw','unfinished','nonstring'])test('Templater '+mode+' retains source and removes only owned target',async()=>{
 const f=await fixture({templater:true});
 if(mode!=='unavailable')f.setEngine({create_running_config:()=>({}),parse_template:async()=>{if(mode==='throw')throw Error('secret template detail');return mode==='nonstring'?null:f.draft.content}});
 const n=notices.length,r=await f.run();assert.equal(r.status,mode==='unavailable'?'not-applied':'rolled-back');assert.equal(f.contents.get('Source.md'),before);assert.equal(f.files.has('Target.md'),false);assert.equal(notices.length,n);
 f.probe.showUiConversionResult(r);assert.equal(notices.length,n+1);assert.ok(!notices.at(-1).includes('secret template detail'));
});
test('Templater successful parse preserves task ID and checkbox block',async()=>{
 const f=await fixture({templater:true});f.setEngine({create_running_config:()=>({}),parse_template:async()=>yaml+'\nRendered'});
 assert.equal((await f.run()).status,'committed');assert.ok(f.contents.get('Target.md').includes('Rendered'));assert.ok(f.contents.get('Target.md').includes('Own'));
});
test('third-party target changes are never overwritten or deleted',async()=>{
 const f=await fixture({templater:true});f.setEngine({create_running_config:()=>({}),parse_template:async()=>{f.put('Target.md','User target');return yaml}});
 assert.equal((await f.run()).status,'outcome-unknown');assert.equal(f.contents.get('Source.md'),before);assert.equal(f.contents.get('Target.md'),'User target');
});
test('failed source write rolls back destination and reports verified rollback',async()=>{
 const f=await fixture();f.setModify(async p=>{if(p==='Source.md')throw Error('source failure')});
 assert.equal((await f.run()).status,'rolled-back');assert.equal(f.contents.get('Source.md'),before);assert.equal(f.files.has('Target.md'),false);
});
for(const drift of ['disk','buffer'])test('target '+drift+' change during source write restores exact source and preserves edit',async()=>{
 const f=await fixture();let injected=false;
 f.setRead(async p=>{if(p==='Source.md'&&f.contents.get('Target.md')?.includes('Own')&&!injected){injected=true;if(drift==='disk')f.put('Target.md','External');else f.buffers.set('Target.md','External')}});
 assert.equal((await f.run()).status,'outcome-unknown');assert.equal(f.contents.get('Source.md'),before);
 assert.equal(drift==='disk'?f.contents.get('Target.md'):f.buffers.get('Target.md'),'External');
});
test('create acknowledgement loss is not retried or claimed rolled back',async()=>{
 const f=await fixture();f.setCreate(async()=>{throw Error('lost ack')});
 assert.equal((await f.run()).status,'outcome-unknown');assert.equal(f.writes.filter(([k])=>k==='create').length,1);assert.equal(f.contents.get('Source.md'),before);assert.equal(f.files.has('Target.md'),true);
});
test('source acknowledgement loss is inspected without replay',async()=>{
 const f=await fixture();f.app.vault.modify=async(file,c)=>{f.put(file.path,c);f.writes.push(['modify',file.path]);throw Error('lost ack')};
 assert.equal((await f.run()).status,'committed');assert.equal(f.writes.filter(([k])=>k==='modify').length,1);
});
test('successful inline conversion preserves forced overlay and metadata reveal hooks',async()=>{
 const f=await fixture(),calls=[];
 f.probe.refreshMarkdownTaskSurfaces=options=>calls.push(['immediate',options.forceTaskWikilinkOverlayFilePath]);
 f.probe.scheduleInlineToFileTaskMarkdownRefresh=(_scope,target)=>calls.push(['markdown',target]);
 f.probe.scheduleInlineToFileTaskMetadataRefresh=(_scope,target)=>calls.push(['metadata',target]);
 assert.equal((await f.run()).status,'committed');assert.deepEqual(calls,[['immediate','Target.md'],['markdown','Target.md'],['metadata','Target.md']]);
});
test('post-write view failure reports committed refresh pending',async()=>{
 const f=await fixture();f.probe.refreshViews=()=>{throw Error('view failure')};
 assert.equal((await f.run()).status,'committed-refresh-pending');assert.equal(f.contents.get('Source.md').includes('operonId:: parent1'),false);
});
test('ordinary file creation retains its existing Templater overwrite fallback',async()=>{
 const f=await fixture({templater:true});const target=f.put('Target.md',f.draft.content);let overwritten=false;
 f.setEngine({overwrite_file_commands:async()=>{overwritten=true;f.put('Target.md',yaml)}});
 assert.equal(await f.probe.maybeProcessFileTaskTemplaterContent(target,f.draft.content,null,null),yaml);assert.equal(overwritten,true);
});
function desktop(f,{confirm=false}={}){
 const beforeTask=f.indexer.getTask('parent1');
 const plan={requiresConfirmation:confirm,requiredAcknowledgements:[],affectedResources:[{resourceKind:'task-source',resourceKey:'Source.md',revision:sourceRevisionForTaskCreationV1('Source.md',before)},{resourceKind:'task-source',resourceKey:'Target.md',revision:sourceRevisionForTaskCreationV1('Target.md',null)}],targets:[{}],conversionEffect:{afterLocator:{filePath:'Target.md',representation:'file'},lossManifest:[]}};
 f.probe.previewAgentRuntimeMutation=async()=>({ok:true,plan});
 return {plan,run:()=>f.probe.applyUiCanonicalConversion(beforeTask,{operation:'convert',from:'inline',to:'file',targetPath:'Target.md'})};
}
test('desktop confirmation cancellation is silent and never applies',async()=>{
 const f=await fixture(),d=desktop(f,{confirm:true});let applies=0;f.probe.applyAgentRuntimeMutation=async()=>{applies++};f.probe.promptConfirmAction=async()=>false;
 const n=notices.length,r=await d.run();assert.equal(r.status,'cancelled');f.probe.showUiConversionResult(r);assert.equal(applies,0);assert.equal(notices.length,n);
});
test('desktop private callbacks synchronize matching buffers and reject later edits',async()=>{
 const f=await fixture(),d=desktop(f);f.buffers.set('Source.md',before);
 f.probe.applyAgentRuntimeMutation=async(_r,policy)=>{
 const c=policy.conversionSources;assert.equal(c.canWrite('Source.md',before),true);assert.equal(c.didWrite('Source.md',before,'[[Target]]'),true);assert.equal(f.buffers.get('Source.md'),'[[Target]]');
 f.buffers.set('Source.md','User edit');assert.equal(c.canWrite('Target.md',null),false);assert.equal(c.didWrite('Source.md','[[Target]]','after'),false);assert.equal(f.buffers.get('Source.md'),'User edit');return {status:'failed',mutationMayHaveApplied:true};};
 assert.equal((await d.run()).status,'outcome-unknown');
});
test('a trashed source view does not block remaining sealed ancestor writes',async()=>{
 const f=await fixture(),d=desktop(f);f.buffers.set('Source.md',before);
 f.probe.applyAgentRuntimeMutation=async(_r,policy)=>{
 const c=policy.conversionSources;assert.equal(c.canWrite('Source.md',before),true);assert.equal(c.didWrite('Source.md',before,null),true);
 // Obsidian may keep the trashed note's old view until its delete event settles.
 assert.equal(f.buffers.get('Source.md'),before);assert.equal(c.canWrite('Target.md',null),true);return {status:'failed',mutationMayHaveApplied:true};};
 assert.equal((await d.run()).status,'outcome-unknown');
});
test('desktop distinguishes observed partial writes from unknown outcomes',async()=>{
 for(const observed of [true,false]){const f=await fixture(),d=desktop(f);
 f.probe.applyAgentRuntimeMutation=async(_r,policy)=>{if(observed){f.put('Target.md',yaml);policy.conversionSources.didWrite('Target.md',null,yaml)}return {status:'failed',mutationMayHaveApplied:true}};
 assert.equal((await d.run()).status,observed?'partial':'outcome-unknown');}
});
test('context menu synchronizes and reacquires current editor source before choosing template',async()=>{
 const f=await fixture();const latest=before.replace('Parent','Edited parent');let picked=false;
 f.probe.redirectDuplicateOperonIdAction=()=>false;
 f.probe.persistTaskEditorDeleteOpenSources=async()=>{f.put('Source.md',latest);return true};
 f.probe.loadEditableParsedTask=async task=>{assert.equal(task.description,'Edited parent');return parseTaskLine(latest.split('\n')[0],0,'Source.md',[])};
 f.probe.openFileTaskTemplatePicker=()=>{picked=true};
 await f.probe.convertInlineTaskToFileTaskById('parent1');assert.equal(picked,true);assert.equal(f.writes.length,0);
});
test('rollback failure reports a verified partial destination with unchanged source',async()=>{
 const f=await fixture();f.setModify(async()=>{throw Error('source failure')});f.app.fileManager.trashFile=async()=>{throw Error('trash failure')};
 const result=await f.run();assert.equal(result.status,'partial');assert.equal(result.sourcePath,'Source.md');assert.equal(result.targetPath,'Target.md');assert.equal(f.contents.get('Source.md'),before);
});
test('desktop preparation errors do not launch fallback and each report once',async()=>{
 for(const [code,status,reason] of [['duplicate-operon-id','not-applied','duplicate'],['stale-source','not-applied','source'],['template-processing-required','template-required',undefined],['invalid-target','not-applied','target']]){
 const f=await fixture(),d=desktop(f);f.probe.previewAgentRuntimeMutation=async()=>({ok:false,error:{code}});f.probe.applyAgentRuntimeMutation=async()=>assert.fail('must not apply');const r=await d.run();assert.equal(r.status,status);assert.equal(r.reason,reason);const n=notices.length;f.probe.showUiConversionResult(r);assert.equal(notices.length-n,status==='template-required'?0:1);}
});
`},outfile,bundle:true,format:'esm',platform:'node',target:['node18'],logLevel:'silent',alias:{obsidian:path.join(root,'scripts/test-support/obsidian.ts')}});
await import(pathToFileURL(outfile).href);
} finally {await rm(dir,{recursive:true,force:true})}
