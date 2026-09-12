import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=fs.mkdtempSync(path.join(tmpdir(),'operon-id-embed-repair-'));
try {
 const outfile=path.join(dir,'test.mjs');
 await build({stdin:{contents:`export * from ${JSON.stringify(path.join(root,'src/core/task-id-repair-embeds'))}; export {TaskIdReferenceRepair} from ${JSON.stringify(path.join(root,'src/core/task-id-repair-references'))};`,resolveDir:root,loader:'ts'},outfile,bundle:true,format:'esm',platform:'node',target:['node18'],logLevel:'silent',alias:{obsidian:path.join(root,'scripts/test-support/obsidian.ts')}});
 const {repairMarkdownTaskCardReferences:markdown,repairCanvasTaskReferences:canvas,TaskIdReferenceRepair}=await import(pathToFileURL(outfile).href);
 const old='m2r-body',next='new1234',repair=new TaskIdReferenceRepair(old,next);
 const card=['```operon','view: card',`taskId: ${old}`,'```'].join('\n');
 let count=0;const test=(name,fn)=>{fn();count++;console.log('PASS',name);};
 test('actual card task ID changes while surrounding markdown remains exact',()=>{
  const text=`Description ${old}\n${card}\n[[${old}]]`;
  assert.equal(markdown(text,repair),text.replace('taskId: '+old,'taskId: '+next));
 });
 test('quoted IDs, comments and CRLF are preserved',()=>{
  const text=['~~~operon','view: card',`  taskId: '${old}'  # ${old}`,'~~~'].join('\r\n');
  assert.equal(markdown(text,repair),text.replace(`'${old}'`,`'${next}'`));
 });
 test('a task card example nested in a longer code fence remains untouched',()=>{
  const text='````markdown\n'+card+'\n````';assert.equal(markdown(text,repair),text);
 });
 test('mixed and short delimiters cannot expose a nested example',()=>{
  for(const text of ['````markdown\n```\n'+card+'\n````','```markdown\n~~~\n'+card+'\n```'])assert.equal(markdown(text,repair),text);
 });
 test('top-level indented code examples are never modified',()=>{
  for(const prefix of ['    ','\t']){const text=card.split('\n').map(line=>prefix+line).join('\n');assert.equal(markdown(text,repair),text);}
 });
 test('real callout and nested blockquote cards preserve container prefixes',()=>{
  for(const prefix of ['> ','>> ','> > ']){
   const text=prefix+'[!note]\n'+card.split('\n').map(line=>prefix+line).join('\n');
   assert.equal(markdown(text,repair),text.replace('taskId: '+old,'taskId: '+next));
  }
 });
 test('ending a blockquote ends its unclosed fence without swallowing later cards',()=>{
  const text='> ```operon\n> view: card\n> taskId: m2r-body\n\n'+card;
  assert.equal(markdown(text,repair),text.replaceAll('taskId: '+old,'taskId: '+next));
 });
 test('actual list cards retain marker, indentation and quote combinations',()=>{
  const forms=[
   '- ```operon\n  view: card\n  taskId: m2r-body\n  ```',
   '- Item\n\n    ```operon\n    view: card\n    taskId: m2r-body\n    ```',
   '> - ```operon\n>   view: card\n>   taskId: m2r-body\n>   ```',
   '- > ```operon\n  > view: card\n  > taskId: m2r-body\n  > ```',
   '1. Item\n   - ```operon\n     view: card\n     taskId: m2r-body\n     ```',
  ];
  for(const text of forms)assert.equal(markdown(text,repair),text.replace('taskId: '+old,'taskId: '+next));
 });
 test('thematic breaks do not turn indented examples into list cards',()=>{
  const text='- - -\n\n'+card.split('\n').map(line=>'    '+line).join('\n');
  assert.equal(markdown(text,repair),text);
 });
 test('frontmatter and ordinary filter fences are unchanged',()=>{
  const text=`---\nexample: |\n  ${card.replaceAll('\n','\n  ')}\n---\n\u0060\u0060\u0060operon\nfilter: ${old}\n\u0060\u0060\u0060`;
  assert.equal(markdown(text,repair),text);
 });
 test('unclosed actual card fence extends to EOF',()=>{
  const text=card.slice(0,-3);assert.equal(markdown(text,repair),text.replace('taskId: '+old,'taskId: '+next));
 });
 test('duplicate task ID options or malformed affected card are rejected',()=>{
  assert.throws(()=>markdown(card.replace('view: card','view: card\ntaskId: m2r-body'),repair));
  assert.throws(()=>markdown(card.replace('view: card','view: invalid'),repair));
 });
 test('existing replacement card references are collisions',()=>assert.throws(()=>markdown(card.replace(old,next),repair)));
 test('native Canvas metadata and legacy text cards update without changing node/edge identities',()=>{
  const source={nodes:[{id:old,type:'text',text:`Operon task: ${old}`,x:1,operonTask:{version:1,taskId:old,future:old}},{id:'embed',type:'text',text:card},{id:'free',type:'text',text:old},{id:'file',type:'file',file:old}],edges:[{id:old,fromNode:old,toNode:'embed'}],future:old};
  const expected=structuredClone(source);expected.nodes[0].text=`Operon task: ${next}`;expected.nodes[0].operonTask.taskId=next;expected.nodes[1].text=card.replace('taskId: '+old,'taskId: '+next);
  const before=JSON.stringify(source,null,2)+'\n';assert.deepEqual(JSON.parse(canvas(before,repair)),expected);assert.ok(canvas(before,repair).endsWith('\n'));
 });
 test('unrelated Canvas has zero textual changes',()=>{
  const text='{ "nodes": [{"id":"m2r-body","type":"text","text":"m2r-body"}], "edges": [] }';assert.equal(canvas(text,repair),text);
 });
 test('unknown affected Canvas reference versions fail closed',()=>{
  assert.throws(()=>canvas(JSON.stringify({nodes:[{type:'text',text:old,operonTask:{version:2,taskId:old}}]}),repair));
 });
 test('custom native-node text is preserved',()=>{
  const source={nodes:[{type:'text',text:'Description '+old,operonTask:{version:1,taskId:old}}]};
  assert.equal(JSON.parse(canvas(JSON.stringify(source),repair)).nodes[0].text,'Description '+old);
 });
 console.log(`Task ID embed reference repair: ${count}/${count} passed`);
}finally{fs.rmSync(dir,{recursive:true,force:true});}
