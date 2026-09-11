import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { build } from 'esbuild';

/** Exercise the real Plugin methods and writer with a mobile Vault adapter. */
export async function runMobileFileRecurrenceTests(rootDir) {
 const source = await readFile(path.join(rootDir, 'main.ts'), 'utf8');
 const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
 const plugin = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'OperonPlugin');
 assert.ok(plugin);
 const names = ['isPluginTaskWritePathContained', 'commitFileTerminalRecurrenceMutation'];
 const methods = names.map(name => {
  const method = plugin.members.find(member => member.name?.getText(ast) === name);
  assert.ok(method, name);
  return method.getText(ast);
 }).join('\n');
 const dir = await mkdtemp(path.join(tmpdir(), 'operon-mobile-file-recurrence-'));
 try {
  const outfile = path.join(dir, 'repro.mjs');
  await build({
   stdin: { resolveDir: rootDir, loader: 'ts', contents: `
import assert from 'node:assert/strict';
import { TFile, TFolder } from 'obsidian';
import { TaskWriter } from './src/core/task-writer';
import { validateVaultRelativePathV1 } from './src/agent-runtime/contracts/v1/identity';
import { scanFileWithMappings } from './src/indexer/file-scanner';
import { parseFrontmatterDocument } from './src/core/file-task-template-merge';
import { executeFileRecurrenceTerminalTransaction } from './src/systems/file-recurrence-terminal-transaction';
const Platform = {isDesktop:false,isMobile:true};
const localNow = () => '2026-09-11T12:00:00';
const generateOperonId = () => 'next001';
class Probe { ${methods} }
const original = '---\\noperonId: recur01\\nstatus: task.todo\\nrepeat: mode=done|freq=day|interval=1\\nrepeatSeriesId: series1\\nrepeatOccurrenceDate: 2026-09-10\\n---\\n';
const file = new TFile('Tasks/Repro.md');
file.stat = {mtime:0,ctime:0,size:original.length};
const folder = new TFolder('Tasks'), root = new TFolder('');
const files = new Map(), contents = new Map();
let writes = 0, createConflict = false, sourceConflict = false, ended = false, archived = false, desktopCalls = 0;
function reset() {files.clear(); contents.clear(); files.set(file.path,file); contents.set(file.path,original); writes=0; createConflict=false; sourceConflict=false;}
reset();
const app = {vault:{adapter:{},getAbstractFileByPath:p=>p==='Tasks'?folder:p===''?root:files.get(p)??null,
 read:async f=>contents.get(f.path),
 create:async(p,c)=>{if(createConflict)throw Error('Injected create failure'); const f=new TFile(p);files.set(p,f);contents.set(p,c);writes++;if(sourceConflict)contents.set(file.path,original+'External edit');return f;},
 modify:async(f,c)=>{contents.set(f.path,c);writes++;},
},fileManager:{trashFile:async f=>{files.delete(f.path);contents.delete(f.path);writes++;}}};
const scanned = (await scanFileWithMappings(app,file,[],original)).yamlTask;
assert.ok(scanned);
const task = {...scanned,checkbox:'open',primary:{format:'yaml',filePath:file.path,lineNumber:0}};
const indexer={getTask:id=>id==='recur01'?task:undefined,hasDuplicateOperonIdConflict:()=>false,isPathIndexable:()=>true,handleFileDelete:async()=>{},scheduleReindex:()=>{}};
const probe=new Probe();
Object.assign(probe,{app,indexer,settings:{keyMappings:[]},resolveCompletionTimestamp:localNow,suppressRawTaskCreationNotice:()=>{},isAgentRuntimeMutationPathContained:async()=>{desktopCalls++;return false;}});
probe.writer=new TaskWriter(app,indexer,[],{validateWritePath:(p,a)=>probe.isAgentRuntimeMutationPathContained(p,a),validatePluginWritePath:(p,a)=>probe.isPluginTaskWritePathContained(p,a)});
probe.recurrenceService={ensureFileRecurrenceTargetFolder:async()=>true,planTerminalRecurrenceTransition:()=>ended?{disposition:'series-ended',preview:{seriesId:'series1'}}:{disposition:'materialize-file',preview:{seriesId:'series1',nextOperonId:'next001',nextFilePath:'Tasks/Next.md',plannedSourceContent:original.replace('recur01','next001').replace('2026-09-10','2026-09-11'),coalescedWithPrimarySource:archived,...(archived?{archiveFilePath:'Tasks/Archive.md',archiveSourceContent:original.replace('task.todo','task.done'),nextFilePath:file.path}: {})}}};
const payload={status:'task.done',_checkbox:'done',dateCompleted:'2026-09-11',datetimeModified:localNow()};
for(const p of ['../Escape.md','/Escape.md','Tasks//Next.md','Missing/Next.md','Tasks/Next.txt','Tasks']) assert.equal(await probe.isPluginTaskWritePathContained(p,true),false,p);
assert.equal(await probe.isPluginTaskWritePathContained('Tasks/Next.md',true),true);
assert.equal(await probe.isPluginTaskWritePathContained('Next.md',true),true);
assert.equal(await probe.isPluginTaskWritePathContained('Tasks/Next.md'),false);
assert.equal(desktopCalls,0);
assert.equal(await probe.writer.taskFieldsMatchCurrentSource('recur01',{status:'task.todo',_checkbox:'open'}),true);
for(const suffix of ['dateCompleted: 2026-09-11','dateCancelled: 2026-09-11']) {
 contents.set(file.path,original.replace('status: task.todo','status: task.todo\\n'+suffix));
 assert.equal(await probe.writer.taskFieldsMatchCurrentSource('recur01',{_checkbox:'open'}),false);
}
reset();
assert.equal(await probe.writer.taskFieldsMatchCurrentSource('recur01',{_checkbox:'done'}),false);
assert.equal((await probe.writer.applyTaskSourceMutation({kind:'modify',filePath:file.path,expectedContent:original,nextContent:original+'changed'})).outcome,'invalid-target');
assert.equal(writes,0);
for(const finish of [false,true]) for(const terminal of ['done','cancelled']){
 reset();ended=finish;
 const result=await probe.commitFileTerminalRecurrenceMutation(task,{...payload,status:'task.'+terminal,_checkbox:terminal});
 assert.equal(result.outcome,'committed');
 assert.ok(contents.get(file.path).includes('task.'+terminal));
 assert.equal(files.has('Tasks/Next.md'),!finish);
 assert.equal(writes,finish?1:2);
}
reset();ended=false;archived=true;
assert.equal((await probe.commitFileTerminalRecurrenceMutation(task,payload)).outcome,'committed');
assert.ok(contents.get(file.path).includes('next001'));
assert.ok(contents.get('Tasks/Archive.md').includes('recur01'));
archived=false;
reset();ended=false;sourceConflict=true;
assert.equal((await probe.commitFileTerminalRecurrenceMutation(task,payload)).outcome,'failed');
assert.equal(contents.get(file.path),original+'External edit');
assert.equal(files.has('Tasks/Next.md'),false,'Successor is rolled back without overwriting external edits');
reset();createConflict=true;
await assert.rejects(()=>probe.commitFileTerminalRecurrenceMutation(task,payload),/Injected create failure/);
assert.equal(contents.get(file.path),original);assert.equal(writes,0);
Platform.isDesktop=true;Platform.isMobile=false;
assert.equal(await probe.isPluginTaskWritePathContained('Tasks/Next.md',true),false,'Desktop guard still authoritative');
console.log('mobile-file-recurrence: ended and successor commits, source conflict rollback, create failure, feedback and Runtime isolation passed');
` },
   outfile, bundle: true, format: 'esm', platform: 'node', target: ['node18'], logLevel: 'silent',
   alias: { obsidian: path.join(rootDir, 'scripts/test-support/obsidian.ts') },
  });
  await import(pathToFileURL(outfile).href);
 } finally { await rm(dir, {recursive:true, force:true}); }
}
