import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { build } from 'esbuild';

/** Exercise the real Plugin methods and writer with a mobile Vault adapter. */
export async function runMobileConversionTests(rootDir) {
 const source = await readFile(path.join(rootDir, 'main.ts'), 'utf8');
 const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
 const plugin = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'OperonPlugin');
 assert.ok(plugin);
 const names = ['isPluginTaskWritePathContained', 'readAgentRuntimeMutationSource', 'readAgentRuntimeCreationTemplate', 'agentRuntimeTaskLocator', 'prepareAgentRuntimeSourceTransition', 'applyMobileUiCanonicalConversion', 'applyUiCanonicalConversion'];
 const methods = names.map(name => {
  const method = plugin.members.find(member => member.name?.getText(ast) === name);
  assert.ok(method, name);
  return method.getText(ast);
 }).join('\n');
 const importNames = new Set(['validateVaultRelativePathV1', 'canonicalJsonV1', 'toJsonValueV1', 'sha256HexV1', 'sourceRevisionForTaskCreationV1', 'analyzeRuntimeFileToInlineLossV1', 'parseFrontmatterDocument', 'isWritableRawYamlPropertyName', 'buildRuntimeConversionAncestorPredictedEffectsV1', 'compareResourceReferencesCanonicalV1', 'toLocalDatetime', 'resolveWorkflowStatus', 'findFileTaskTemplateOptionById', 'resolvePipelineMinimalFileTaskTemplateStatus', 'collectScopedPlainCheckboxMoveLines', 'removePlainCheckboxMoveLinesFromContent']);
 const selectedImports = ast.statements.filter(ts.isImportDeclaration).flatMap(node => {
  const bindings = node.importClause?.namedBindings;
  if (!bindings || !ts.isNamedImports(bindings)) return [];
  const names = bindings.elements.filter(element => importNames.has(element.name.text)).map(element => element.getText(ast));
  return names.length ? [`import { ${names.join(', ')} } from ${node.moduleSpecifier.getText(ast)};`] : [];
 }).join('\n');
 const dir = await mkdtemp(path.join(tmpdir(), 'operon-mobile-conversion-'));
 try {
  const outfile = path.join(dir, 'repro.mjs');
  await build({
   stdin: { resolveDir: rootDir, loader: 'ts', contents: `
import assert from 'node:assert/strict';
import { TFile,TFolder } from 'obsidian';
import { TaskWriter } from './src/core/task-writer';
import { FormatConverter } from './src/systems/format-converter';
import { DEFAULT_SETTINGS } from './src/types/settings';
import { parseTaskLine } from './src/core/parser';
import { scanFileWithMappings } from './src/indexer/file-scanner';
import { executePluginUiConversionTransaction } from './src/systems/plugin-ui-conversion-transaction';
${selectedImports}
const Platform={isMobile:true,isDesktop:false};
const t=(domain,key)=>key;
const getActiveWindow=()=>({crypto:{randomUUID:()=> 'conversion-test'}});
const createScopedMarkdownRefreshScope=paths=>({paths});
class Probe { ${methods} }
const inline='- [ ] Convert me {{operonId:: convert}} {{status:: task.todo}}';
const yaml='---\\noperonId: convert\\nstatus: task.todo\\ncustom: preserved in trash\\n---\\nBody content\\n';
const root=new TFolder('');
const files=new Map(),contents=new Map(),tasks=new Map();
let writes=0,confirmed=true,confirmCalls=0,confirmMessage='',changeOnConfirm=false,failTrash=false,failModify=false,allow=true,desktopCalls=0;
let selectedTemplate={id:'builtin',kind:'builtin-pipeline-minimal'};
function put(p,c){const f=new TFile(p);f.stat={mtime:0,ctime:0,size:c.length};files.set(p,f);contents.set(p,c);}
async function reindex(){tasks.clear();for(const [p,f] of files){const scan=await scanFileWithMappings(app,f,[],contents.get(p));if(scan.yamlTask)tasks.set(scan.yamlTask.operonId,{...scan.yamlTask,checkbox:'open',primary:{format:'yaml',filePath:p,lineNumber:0}});for(const [n,line] of contents.get(p).split('\\n').entries()){const task=parseTaskLine(line,n,p,[]);if(task)tasks.set(task.operonId,{...task,fieldValues:Object.fromEntries(task.fields.map(f=>[f.key,f.value])),primary:{format:'inline',filePath:p,lineNumber:n}});}}}
const app={vault:{adapter:{},getAbstractFileByPath:p=>p===''?root:files.get(p)??null,read:async f=>contents.get(f.path),
 create:async(p,c)=>{put(p,c);writes++;return files.get(p);},modify:async(f,c)=>{if(failModify)throw Error('Modify failure');contents.set(f.path,c);writes++;},
},fileManager:{trashFile:async f=>{if(failTrash)throw Error('Trash failure');files.delete(f.path);contents.delete(f.path);writes++;}}};
const indexer={getTask:id=>tasks.get(id),getTaskSnapshot:id=>tasks.get(id),hasDuplicateOperonIdConflict:()=>false,isPathIndexable:()=>true,reindexFilesBatch:reindex,forceReindexFilePathAfterMutation:reindex,beginExpectedDuplicateOperonIdTransition:()=>()=>{}};
const probe=new Probe();
Object.assign(probe,{app,indexer,settings:{...DEFAULT_SETTINGS,keyMappings:[]},isAgentRuntimeMutationPathContained:async()=>{desktopCalls++;return false;},persistTaskEditorDeleteOpenSources:async()=>true,
 promptConfirmAction:async(title,message)=>{confirmCalls++;confirmMessage=message;if(changeOnConfirm)contents.set('Source.md',yaml+'Changed');return confirmed;},
 aggregateCoordinator:{planCreationAggregatePatches:()=>[]},taskEditorDeleteOpenViewsMatch:()=>true,syncTaskEditorDeleteOpenViews:()=>true,showPluginUiMutationOutcome:()=>{},refreshViews:()=>{},refreshMarkdownTaskSurfaces:()=>{},getAgentRuntimeSettingsFingerprint:()=> 'settings',
 parseInlineTaskLine:(line,n,p)=>parseTaskLine(line,n,p,[]),getFileTaskTemplateOptions:()=>[selectedTemplate],
 loadFileTaskTemplateDocumentFromOption:async()=>({}),buildParsedTaskFieldValues:task=>Object.fromEntries(task.fields.map(f=>[f.key,f.value])),buildLinkedFileTaskSeed:async(p,fieldValues,fieldPresence)=>({fieldValues,fieldPresence,tags:[]}),
 buildOperonTemplatePlaceholderContext:()=>({}),resolveLoadedFileTaskTemplateDocument:()=>null,
 buildFileTaskDraft:()=>({operonId:'convert',fieldValues:{operonId:'convert',status:'task.todo'},tags:[],content:'---\\noperonId: convert\\nstatus: task.todo\\n---\\n'}),fileTaskContentNeedsTemplaterProcessing:()=>false,getTargetFileTaskFolder:()=>'',sanitizeTaskFileName:s=>s,resolveFileTaskTemplatePlaceholdersInContent:c=>c,normalizeMovedInlineTaskPlainCheckboxLines:x=>x,prependMovedPlainCheckboxLinesToFileTaskContent:c=>c,escapeFileTaskWikilinkTarget:s=>s,
});
probe.formatConverter=new FormatConverter(app,indexer,probe.settings);
probe.writer=new TaskWriter(app,indexer,[],{validateWritePath:()=>false,validatePluginWritePath:(p,a)=>probe.isPluginTaskWritePathContained(p,a)});
async function reset(kind){files.clear();contents.clear();writes=0;confirmCalls=0;confirmed=true;changeOnConfirm=false;failTrash=false;failModify=false;allow=true;put('Source.md',kind==='inline'?inline:yaml);put('Destination.md','---\\nTitle: destination\\n---\\n\\nKeep text');await reindex();}
const fileSpec={operation:'convert',from:'file',to:'inline',target:{mode:'exact-line',filePath:'Destination.md',lineNumber:3}};
const inlineSpec={operation:'convert',from:'inline',to:'file',templateId:'builtin',targetPath:'Converted.md'};
// Use a real folder template so the shared reader and mobile path guard execute.
selectedTemplate={id:'template',kind:'folder',path:'Template.md'};inlineSpec.templateId='template';
await reset('inline');put('Template.md','---\\nstatus: task.todo\\n---\\n');
assert.deepEqual(await probe.applyUiCanonicalConversion(tasks.get('convert'),inlineSpec,()=>allow),{handled:true,success:true});
assert.equal(contents.get('Source.md'),'[[Converted]]');assert.ok(contents.get('Converted.md').includes('operonId: convert'));assert.equal(desktopCalls,0);
await reset('yaml');
assert.deepEqual(await probe.applyUiCanonicalConversion(tasks.get('convert'),fileSpec,()=>allow),{handled:true,success:true});
assert.equal(files.has('Source.md'),false);assert.ok(contents.get('Destination.md').includes('operonId:: convert'));assert.equal(confirmCalls,1);assert.ok(confirmMessage.includes('custom'));
await reset('yaml');confirmed=false;
assert.equal((await probe.applyUiCanonicalConversion(tasks.get('convert'),fileSpec)).success,false);assert.equal(writes,0);
await reset('yaml');changeOnConfirm=true;
assert.equal((await probe.applyUiCanonicalConversion(tasks.get('convert'),fileSpec)).success,false);assert.equal(writes,0);assert.equal(contents.get('Source.md'),yaml+'Changed');
await reset('yaml');failTrash=true;
assert.equal((await probe.applyUiCanonicalConversion(tasks.get('convert'),fileSpec)).success,false);assert.equal(contents.get('Source.md'),yaml);assert.equal(contents.get('Destination.md'),'---\\nTitle: destination\\n---\\n\\nKeep text');
await reset('inline');put('Template.md','---\\nstatus: task.todo\\n---\\n');failModify=true;
assert.equal((await probe.applyUiCanonicalConversion(tasks.get('convert'),inlineSpec)).success,false);assert.equal(contents.get('Source.md'),inline);assert.equal(files.has('Converted.md'),false);
await reset('yaml');allow=false;
assert.equal((await probe.applyUiCanonicalConversion(tasks.get('convert'),fileSpec,()=>allow)).success,false);assert.equal(writes,0);
await assert.rejects(()=>probe.readAgentRuntimeMutationSource('Source.md'),/canonical vault boundary/);
// Ancestor timestamps and repeat-series representation participate in compensation.
let series={seriesId:'series1',sourceTaskId:'convert',sourceFormat:'yaml',updatedAt:'before'}, revision=0;
probe.storage={repeatSeries:{getEntry:()=>structuredClone(series),getRevision:()=>revision,compareAndSetEntry:async(id,before,after)=>{if(JSON.stringify(before)!==JSON.stringify(series))return 'conflict';series=structuredClone(after);revision++;return 'committed';}}};
const parentBefore='- [ ] Parent {{operonId:: parent1}} {{datetimeModified:: 2026-09-01T00:00:00}}';
for(const fail of [false,true]){
 await reset('yaml');series={seriesId:'series1',sourceTaskId:'convert',sourceFormat:'yaml',updatedAt:'before'};
 contents.set('Source.md',yaml.replace('status: task.todo','status: task.todo\\nparentTask: parent1\\nrepeatSeriesId: series1'));put('Parent.md',parentBefore);await reindex();
 probe.aggregateCoordinator.planCreationAggregatePatches=()=>[{filePath:'Parent.md',operonId:'parent1',format:'inline',lineNumber:0,fieldValues:{datetimeModified:'2026-09-11T12:00:00'}}];
 failTrash=fail;
 assert.equal((await probe.applyUiCanonicalConversion(tasks.get('convert'),fileSpec)).success,!fail);
 assert.equal(series.sourceFormat,fail?'yaml':'inline');
 assert.equal(contents.get('Parent.md').includes('2026-09-11T12:00:00'),!fail);
 if(fail)assert.equal(contents.get('Parent.md'),parentBefore);
}
probe.aggregateCoordinator.planCreationAggregatePatches=()=>[];
// A divergent open destination must not be followed by source trash.
await reset('yaml');let bufferDrift=false;
probe.syncTaskEditorDeleteOpenViews=()=>{bufferDrift=true;return false;};
probe.taskEditorDeleteOpenViewsMatch=p=>p!=='Destination.md'||!bufferDrift;
assert.equal((await probe.applyUiCanonicalConversion(tasks.get('convert'),fileSpec)).success,false);
assert.equal(files.has('Source.md'),true);
probe.syncTaskEditorDeleteOpenViews=()=>true;probe.taskEditorDeleteOpenViewsMatch=()=>true;
// Revalidate the converted destination after the final source precondition await.
let destination='before',sourcePresent=true,sourceChecks=0;
const driftResult=await executePluginUiConversionTransaction([
 {isBefore:async()=>destination==='before',isAfter:async()=>destination==='after',apply:async()=>{destination='after';return true},rollback:async()=>{destination='before';return true}},
 {isBefore:async()=>{sourceChecks++;if(sourceChecks===2)destination='external';return sourcePresent},isAfter:async()=>!sourcePresent,apply:async()=>{sourcePresent=false;return true},rollback:async()=>false,irreversible:true},
],()=>true);
assert.equal(driftResult,'outcome-unknown');assert.equal(destination,'external');assert.equal(sourcePresent,true);
console.log('mobile-conversion: real preparation and writes in both directions, loss confirmation, cancel, stale source, rollback and Runtime isolation passed');
` },
   outfile, bundle: true, format: 'esm', platform: 'node', target: ['node18'], logLevel: 'silent',
   alias: { obsidian: path.join(rootDir, 'scripts/test-support/obsidian.ts') },
  });
  await import(pathToFileURL(outfile).href);
 } finally { await rm(dir, {recursive:true, force:true}); }
}
