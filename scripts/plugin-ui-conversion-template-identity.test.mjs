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
 'prepareAgentRuntimeSourceTransition', 'agentRuntimeTaskLocator', 'applyMobileUiCanonicalConversion',
 'finishInlineTaskToFileTaskConversion', 'applyUiTemplateConversion', 'maybeProcessFileTaskTemplaterContent',
 'withInlineToFileTaskTransitionSafePass', 'isInlineToFileTaskTransitionContentValid', 'findInlineTaskLineIndex',
 'normalizeMovedInlineTaskPlainCheckboxLines', 'getCommonLeadingWhitespace', 'getCommonPrefix',
 'prependMovedPlainCheckboxLinesToFileTaskContent', 'getFrontmatterLineCount', 'buildInlineToFileTaskSourceReplacement',
 'reindexAgentRuntimeTaskSourceWrite', 'refreshUiConversionViews',
];
const methods = names.map(name => {
 const method = plugin.members.find(n => n.name?.getText(ast) === name);
 assert.ok(method, name);
 return method.getText(ast);
}).join('\n');
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
import {DEFAULT_SETTINGS} from './src/types/settings';
import {parseTaskLine} from './src/core/parser';
import {analyzeTaskSourceRelationshipAuthority} from './src/core/task-source-relationship-authority';
import {executePluginUiConversionTransaction,conversionPreparationFailure} from './src/systems/plugin-ui-conversion-transaction';
${imports}
${constants}
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
 const app={vault:{getAbstractFileByPath:p=>p===''?new TFolder(''):files.get(p)??null,
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
