import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const dir = fs.mkdtempSync(path.join(tmpdir(), 'operon-id-source-repair-'));
try {
 const outfile=path.join(dir,'test.mjs');
 const stub=path.join(dir,'obsidian.ts');
 // Use a real YAML parser for duplicate keys, sequences and nested data. The
 // existing host stub supplies only unrelated Obsidian APIs needed by imports.
 fs.writeFileSync(stub, `export * from ${JSON.stringify(path.join(root,'scripts/test-support/obsidian.ts'))}; export {load as parseYaml,dump as stringifyYaml} from ${JSON.stringify(require.resolve('js-yaml'))};`);
 const modules=[['planTaskIdRepairSources','src/core/task-id-repair-sources'],['parseTaskLine','src/core/parser']];
 await build({stdin:{contents:modules.map(([name,file])=>`export {${name}} from ${JSON.stringify(path.join(root,file))};`).join('\n'),resolveDir:root,loader:'ts'},outfile,bundle:true,format:'esm',platform:'node',target:['node18'],logLevel:'silent',alias:{obsidian:stub}});
 const {planTaskIdRepairSources:plan,parseTaskLine:parse}=await import(pathToFileURL(outfile).href);
 const old='m2r-body',next='new1234',now='2026-09-11T15:00:00';
 const line=`- [ ] A {{operonId:: ${old}}}`;
 const target=(raw=line,path='Tasks.md',number=0,mappings=[])=>({...parse(raw,number,path,mappings),format:'inline'});
 const sources=(files)=>Object.entries(files).map(([filePath,content])=>({filePath,content}));
 const run=(files,t=target(),mappings=[])=>{const set=sources(files),before=structuredClone(set);const result=plan(set,t,next,now,mappings);assert.deepEqual(set,before);return result;};
 const content=(result,path)=>result.changes.find(change=>change.filePath===path)?.after;
 const idLine=(id,name=id)=>`- [ ] ${name} {{operonId:: ${id}}}`;
 let count=0;const test=(name,fn)=>{fn();count++;console.log('PASS',name);};
 test('owner, references and parent timestamps are prepared together',()=>{
  const raw=line+' {{parentTask:: parent1}} {{note:: m2r-body}}';
  const files={'Tasks.md':raw,'Parent.md':idLine('parent1'),'Children.md':idLine('child01')+' {{parentTask:: m2r-body}}','Deps.md':idLine('depend1')+' {{blocking:: other01; m2r-body}} {{related:: [[m2r-body]];m2r-body}}','Unrelated.md':'Description m2r-body'};
  const r=run(files,target(raw));assert.equal(r.ok,true,r.reason);assert.equal(r.changes.length,4);
  assert.match(content(r,'Tasks.md'),/operonId:: new1234/);assert.match(content(r,'Tasks.md'),/note:: m2r-body/);
  assert.match(content(r,'Children.md'),/parentTask:: new1234/);assert.match(content(r,'Deps.md'),/blocking:: other01; new1234/);
  assert.match(content(r,'Deps.md'),/related:: \[\[m2r-body\]\];new1234/);assert.match(content(r,'Parent.md'),/datetimeModified::/);
  assert.equal(content(r,'Unrelated.md'),undefined);assert.deepEqual(r.readSet,sources(files));
 });
 test('escaped identity values are matched semantically without changing unrelated raw list text',()=>{
  for(const encoded of ['bad\\}id','bad\\\\id']){
   const raw=`- [ ] A {{operonId:: ${encoded}}}`;
   const child=idLine('child01')+` {{blocking:: ${encoded};[[${encoded}]];path-folder}} {{parentTask:: ${encoded}}}`;
   const r=run({'Tasks.md':raw,'Child.md':child},target(raw));assert.equal(r.ok,true,r.reason);
   assert.ok(content(r,'Child.md').includes(`{{blocking:: ${next};[[${encoded}]];path-folder}}`));
   assert.ok(content(r,'Child.md').includes(`{{parentTask:: ${next}}}`));
  }
 });
 test('YAML reference arrays retain literal semicolons, booleans and numbers',()=>{
  const yaml='---\noperonId: child01\nrelated:\n - "literal; text"\n - 12\n - true\n - m2r-body\n---\nBody';
  const r=run({'Tasks.md':line,'Child.md':yaml});assert.equal(r.ok,true,r.reason);
  const fields=require('js-yaml').load(content(r,'Child.md').split('---')[1]);
  assert.deepEqual(fields.related,['literal; text',12,true,next]);
 });
 test('unrelated numeric and boolean YAML reference fields do not cause writes or type coercion',()=>{
  for(const value of ['12','true']){
   const r=run({'Tasks.md':line,'Other.md':`---\noperonId: other01\nrelated: ${value}\n---\n`});
   assert.equal(r.ok,true,r.reason);assert.equal(content(r,'Other.md'),undefined);
  }
 });
 test('source plan also repairs real card references in a separate Markdown note',()=>{
  const embed=['```operon','view: card','taskId: m2r-body','```'].join('\n');
  const r=run({'Tasks.md':line,'Dashboard.md':embed});assert.equal(r.ok,true,r.reason);
  assert.equal(content(r,'Dashboard.md'),embed.replace(old,next));
 });
 test('duplicate raw inline owners block repair',()=>assert.equal(run({'Tasks.md':line,'Other.md':line}).ok,false));
 test('invalid YAML owner omitted by normal index still blocks duplicate repair',()=>assert.equal(run({'Tasks.md':line,'Other.md':'---\noperonId: m2r-body\n---\n'}).ok,false));
 test('replacement ID collision is found in raw YAML and case folded owner IDs',()=>{
  for(const id of [next,next.toUpperCase()])assert.equal(run({'Tasks.md':line,'Other.md':`---\noperonId: ${id}\n---\n`}).ok,false);
 });
 test('duplicate task examples in matching code fences are not owners',()=>{
  const example=['````md','```',line,'````'].join('\n');
  assert.equal(run({'Tasks.md':line,'Example.md':example}).ok,true);
 });
 test('YAML and mapped inline relationship fields are rewritten',()=>{
  const mappings=[{canonicalKey:'operonId',visiblePropertyName:'TaskID'},{canonicalKey:'parentTask',visiblePropertyName:'Parent'}];
  const r=run({'Tasks.md':line,'Child.md':'---\nTaskID: child01\nParent: m2r-body\nblocking:\n  - m2r-body\n  - other01\nnote: m2r-body\ncustom:\n  nested: keep\n---\nUnchanged body'},target(),mappings);
  assert.equal(r.ok,true,r.reason);const yaml=require('js-yaml').load(content(r,'Child.md').split('---')[1]);
  assert.equal(yaml.Parent,next);assert.deepEqual(yaml.blocking,[next,'other01']);assert.equal(yaml.note,old);assert.deepEqual(yaml.custom,{nested:'keep'});assert.ok(content(r,'Child.md').endsWith('Unchanged body'));
 });
 test('changed or moved target source is rejected',()=>{
  assert.equal(run({'Tasks.md':line.replace('A','Changed')}).ok,false);
  assert.equal(run({'Tasks.md':'\n'+line}).ok,false);
 });
 test('missing-ID metadata task receives identity without rewriting empty references elsewhere',()=>{
  const raw='- [ ] A {{status:: task.todo}}';const r=run({'Tasks.md':raw,'Child.md':idLine('child01')+' {{parentTask:: }}'},target(raw));
  assert.equal(r.ok,true,r.reason);assert.equal(r.previousId,null);assert.equal(r.changes.length,1);assert.match(content(r,'Tasks.md'),/operonId:: new1234/);
 });
 test('all source ancestors reflect the child change',()=>{
  const raw=line+' {{parentTask:: parent1}}';
  const r=run({'Tasks.md':raw,'Parent.md':idLine('parent1')+' {{parentTask:: grand01}}','Grand.md':idLine('grand01')},target(raw));
  assert.equal(r.ok,true,r.reason);assert.match(content(r,'Grand.md'),/datetimeModified::/);
 });
 test('ambiguous parent source blocks the whole preparation',()=>{
  const raw=line+' {{parentTask:: parent1}}';assert.equal(run({'Tasks.md':raw,'P1.md':idLine('parent1'),'P2.md':idLine('parent1')},target(raw)).ok,false);
 });
 test('YAML owner can be repaired with inline references in its body',()=>{
  const raw='---\noperonId: m2r-body\nnote: keep\n---\n'+idLine('child01')+' {{parentTask:: m2r-body}}';
  const r=run({'Task.md':raw},{format:'yaml',filePath:'Task.md',expectedContent:raw,operonId:old});
  assert.equal(r.ok,true,r.reason);assert.match(content(r,'Task.md'),/operonId: new1234/);assert.match(content(r,'Task.md'),/parentTask:: new1234/);
 });
 test('YAML source snapshot is a strict precondition',()=>{
  const raw='---\noperonId: m2r-body\n---\n';assert.equal(run({'Task.md':raw+'changed'},{format:'yaml',filePath:'Task.md',expectedContent:raw,operonId:old}).ok,false);
 });
 test('CRLF outside changed inline fields stays intact',()=>{
  const raw=line+'\r';const r=run({'Tasks.md':raw+'\nText\r\n'},target(raw));assert.equal(r.ok,true,r.reason);assert.equal(content(r,'Tasks.md'),line.replace(old,next)+` {{datetimeModified:: ${now}}}\r\nText\r\n`);
 });
 test('duplicate metadata aliases and duplicate YAML keys fail closed',()=>{
  assert.equal(run({'Tasks.md':line+' {{operonId:: another}}'},target(line+' {{operonId:: another}}')).ok,false);
  assert.equal(run({'Tasks.md':line,'Other.md':'---\noperonId: child01\noperonId: m2r-body\n---\n'}).ok,false);
 });
 test('duplicate read-set paths are rejected',()=>assert.equal(plan([{filePath:'Tasks.md',content:line},{filePath:'Tasks.md',content:line}],target(),next,now).ok,false));
 test('case-folded sibling identities mark filter ownership ambiguous without merging task IDs',()=>{
  const r=run({'Tasks.md':line,'Other.md':idLine(old.toUpperCase())});assert.equal(r.ok,true,r.reason);assert.equal(r.ambiguousFilterIdentity,true);assert.equal(content(r,'Other.md'),undefined);
 });
 test('unclosed YAML and code target cannot be repaired',()=>{
  assert.equal(run({'Tasks.md':'---\n'+line},target(line,'Tasks.md',1)).ok,false);
  assert.equal(run({'Tasks.md':'```\n'+line+'\n```'},target(line,'Tasks.md',1)).ok,false);
 });
 test('empty read set or compatible source ID is rejected',()=>{
  assert.equal(run({}).ok,false);const raw=idLine('valid01');assert.equal(run({'Tasks.md':raw},target(raw)).ok,false);
 });
 console.log(`Task ID source inventory repair: ${count}/${count} passed`);
}finally{fs.rmSync(dir,{recursive:true,force:true});}
