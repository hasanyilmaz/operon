import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const sources={};
function extract(file,name,deps={}) {
 const source=sources[file]??=readFileSync(new URL(`../src/ui/${file}.ts`,import.meta.url),'utf8');
 const ast=ts.createSourceFile('subject.ts',source,ts.ScriptTarget.Latest,true);
 const node=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert.ok(node,name);
 const js=ts.transpileModule(node.getText(ast).replace(/^export /,''),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 return new Function(...Object.keys(deps),`${js}; return ${name};`)(...Object.values(deps));
}
function fixture(surface,{iconOnly=false,format='inline',blocked=false,noWriter=false}={}) {
 const opened=[],writes=[];let preview=0,commits=0,mutable=!blocked;
 const task={operonId:'task-a',filePath:'Tasks/a.md',primary:{filePath:'Tasks/a.md',format},tags:['old'],fieldValues:{priority:'A'}};
 const latest={...task,tags:['work','project/nested']};
 const chip={listeners:{},addEventListener(k,fn){this.listeners[k]=fn;},click(){this.listeners.click({preventDefault(){},stopPropagation(){}});}};
 const callbacks={app:{},getSettings:()=>({}),getAllTasks:()=>[latest],getTaskById:()=>latest,canMutate:()=>mutable,updateField:(...args)=>writes.push(args)};
 if(noWriter)delete callbacks.updateField;
 const deps={bindDesktopChipOpening:()=>false,shouldOpenIconOnlyChipPreview:()=>true,openIconOnlyChipPreview:()=>preview++,openTaskFieldPicker:o=>{opened.push(o);return()=>o.onClose?.();},getLivePreviewCurrentFieldValues:()=>task.fieldValues,getLivePreviewDescriptionEndCursor:()=>17,snapshotLivePreviewAnchor:()=>({left:1,top:2,width:10,height:10}),getKanbanDirectChipManualDatePickerOptions:()=>undefined};
 if(surface==='live')deps.bindLivePreviewControlMouseGuard=extract('live-preview-conceal','bindLivePreviewControlMouseGuard');
 deps.commitKanbanChipPayload=extract('compact-card-chips','commitKanbanChipPayload');
 deps.openKanbanTaskFieldPicker=extract('compact-card-chips','openKanbanTaskFieldPicker',deps);
 const entry={key:'tags',label:'old',iconOnly};const committed=()=>commits++;
 if(surface==='live')extract('live-preview-conceal','attachLivePreviewChipAction',deps)(chip,entry,{},task.fieldValues,null,callbacks,task.tags,task,committed);
 if(surface==='reading')extract('reading-task-row','attachReadingChipAction',deps)(chip,entry,task,callbacks,committed);
 if(surface==='card')extract('compact-card-chips','attachKanbanChipAction',deps)(chip,entry,task,callbacks,[latest],()=>blocked,committed);
 if(surface==='overlay')extract('task-wikilink-overlay-chips','attachOverlayChipAction',deps)(chip,entry,callbacks,task,committed);
 return {chip,opened,writes,callbacks,get commits(){return commits;},get preview(){return preview;},setMutable:v=>mutable=v};
}
for(const surface of ['live','reading','card','overlay'])for(const iconOnly of [false,true])test(`${surface} ${iconOnly?'icon':'detailed'}: correct task, no-write close, duplicate guard and tags writes`,()=>{
 const f=fixture(surface,{iconOnly});
 if(surface==='live'){
  for(const button of [0,1,2]){
   let prevented=0,stopped=0;
   f.chip.listeners.mousedown({button,preventDefault(){prevented++;},stopPropagation(){stopped++;}});
   assert.equal(prevented,button===0?1:0);assert.equal(stopped,button===0?1:0);
  }
  assert.deepEqual(f.writes,[]);assert.equal(f.opened.length,0);
 }
 f.chip.click();f.chip.click();assert.equal(f.opened.length,1);assert.equal(f.preview,0);
 const p=f.opened[0];assert.equal(p.canonicalKey,'tags');assert.deepEqual(p.currentTags,['work','project/nested']);assert.equal(p.sourcePath,'Tasks/a.md');assert.deepEqual(f.writes,[]);assert.equal(f.commits,0);
 p.onClose();assert.deepEqual(f.writes,[]);f.chip.click();assert.equal(f.opened.length,2);
 f.opened[1].onCommit({tags:['work','new']});assert.deepEqual(f.writes[0].slice(0,3),['task-a','_tags','work; new']);
 f.opened[1].onCommit({tags:[]});assert.deepEqual(f.writes[1].slice(0,3),['task-a','_tags','']);assert.equal(f.commits,2);
 if(surface==='live')assert.equal(f.writes[0][3],17);
});
for(const surface of ['reading','card','overlay'])test(`${surface}: file task context is preserved`,()=>{const f=fixture(surface,{format:'yaml'});f.chip.click();assert.equal(f.opened[0].taskFormat,'yaml');});
test('card denies read-only targets, mutation locks and missing writers',()=>{
 for(const options of [{blocked:true},{noWriter:true}]){const f=fixture('card',options);f.chip.click();assert.equal(f.opened.length,0);}
 const f=fixture('card');f.setMutable(false);f.chip.click();assert.equal(f.opened.length,0);f.setMutable(true);f.chip.click();f.setMutable(false);f.opened[0].onCommit({tags:['denied']});assert.deepEqual(f.writes,[]);
});
test('overlay without a writer cannot open the tag picker',()=>{const f=fixture('overlay',{noWriter:true});f.chip.click();assert.equal(f.opened.length,0);});
test('reading blocked callback still rejects picker writes',()=>{
 let blocked=0;const f=fixture('reading');const guarded=extract('reading-task-row','guardReadingTaskRowActions')(f.callbacks,()=>blocked++);
 f.callbacks.updateField=guarded.updateField;f.chip.click();f.opened[0].onCommit({tags:['denied']});assert.deepEqual(f.writes,[]);assert.equal(blocked,1);
});
test('tag dispatcher reuses existing picker and list persistence without opening search',()=>{
 let picker;const open=extract('task-field-picker-dispatch','openTaskFieldPicker',{showTagPicker:(_anchor,options)=>{picker=options;return()=>{};}});
 const writes=[];open({canonicalKey:'tags',currentFieldValues:{},currentTags:['a'],onCommit:p=>writes.push(p),settings:{},allTasks:[],app:{},anchor:{}});
 assert.deepEqual(picker.value,['a']);picker.onSave(['a','b']);assert.deepEqual(writes,[{tags:['a','b']}]);
});
