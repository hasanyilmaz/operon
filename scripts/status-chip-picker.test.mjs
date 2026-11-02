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
function fixture(surface,{iconOnly=false,format='inline',blocked=false,noWriter=false,key='status'}={}) {
 const opened=[],writes=[];let preview=0,commits=0,mutable=!blocked;
 const task={operonId:'task-a',filePath:'Tasks/a.md',primary:{filePath:'Tasks/a.md',format},tags:['old'],fieldValues:{status:'Project.Active'}};
 const latest={...task,tags:['work','project/nested']};
 const chip={listeners:{},addEventListener(k,fn){this.listeners[k]=fn;},click(){this.listeners.click({preventDefault(){},stopPropagation(){}});}};
 const callbacks={app:{},getSettings:()=>({}),getAllTasks:()=>[latest],getTaskById:()=>latest,canMutate:()=>mutable,updateField:(...args)=>writes.push(args)};
 if(noWriter)delete callbacks.updateField;
 const deps={bindDesktopChipOpening:()=>false,shouldOpenIconOnlyChipPreview:()=>true,openIconOnlyChipPreview:()=>preview++,openTaskFieldPicker:o=>{opened.push(o);return()=>o.onClose?.();},getLivePreviewCurrentFieldValues:()=>task.fieldValues,getLivePreviewDescriptionEndCursor:()=>17,snapshotLivePreviewAnchor:()=>({left:1,top:2,width:10,height:10}),getKanbanDirectChipManualDatePickerOptions:()=>undefined};
 if(surface==='live')deps.bindLivePreviewControlMouseGuard=extract('live-preview-conceal','bindLivePreviewControlMouseGuard');
 deps.commitKanbanChipPayload=extract('compact-card-chips','commitKanbanChipPayload');
 deps.openKanbanTaskFieldPicker=extract('compact-card-chips','openKanbanTaskFieldPicker',deps);
 const entry={key,label:'Project.Active',iconOnly};const committed=()=>commits++;
 if(surface==='live')extract('live-preview-conceal','attachLivePreviewChipAction',deps)(chip,entry,{},task.fieldValues,null,callbacks,task.tags,task,committed);
 if(surface==='reading')extract('reading-task-row','attachReadingChipAction',deps)(chip,entry,task,callbacks,committed);
 if(surface==='card')extract('compact-card-chips','attachKanbanChipAction',deps)(chip,entry,task,callbacks,[latest],()=>blocked,committed);
 if(surface==='overlay')extract('task-wikilink-overlay-chips','attachOverlayChipAction',deps)(chip,entry,callbacks,task,committed);
 return {chip,opened,writes,callbacks,get commits(){return commits;},get preview(){return preview;},setMutable:v=>mutable=v};
}

for(const surface of ['live','reading','card','overlay'])for(const iconOnly of [false,true])test(`${surface} ${iconOnly?'icon':'detailed'}: status picker opens once without cycling or writing`,()=>{
 const f=fixture(surface,{iconOnly});f.chip.click();f.chip.click();assert.equal(f.opened.length,1);assert.equal(f.preview,0);assert.deepEqual(f.writes,[]);assert.equal(f.commits,0);
 const p=f.opened[0];assert.equal(p.canonicalKey,'status');assert.equal(p.currentFieldValues.status,'Project.Active');p.onClose();assert.deepEqual(f.writes,[]);
 f.chip.click();f.opened[1].onCommit({status:'Project.Finished'});assert.deepEqual(f.writes[0].slice(0,3),['task-a','status','Project.Finished']);
 if(surface==='live')assert.equal(f.writes[0][3],17);
 f.chip.click();assert.equal(f.opened.length,3);f.opened[2].onCommit({status:''});assert.deepEqual(f.writes[1].slice(0,3),['task-a','status','']);
});
test('Live Preview status mousedown prevents primary editor caret placement before click',()=>{
 const f=fixture('live');
 for(const button of [0,1,2]){
  let prevented=0,stopped=0;
  f.chip.listeners.mousedown({button,preventDefault(){prevented++;},stopPropagation(){stopped++;}});
  assert.equal(prevented,button===0?1:0);assert.equal(stopped,button===0?1:0);
 }
 assert.deepEqual(f.writes,[]);assert.equal(f.opened.length,0);
});
for(const surface of ['reading','card','overlay'])test(`${surface}: file task context survives status selection`,()=>{const f=fixture(surface,{format:'yaml'});f.chip.click();assert.equal(f.opened[0].taskFormat,'yaml');});
test('card read-only, mutation locks and missing writers stay protected',()=>{
 for(const options of [{blocked:true},{noWriter:true}]){const f=fixture('card',options);f.chip.click();assert.equal(f.opened.length,0);}
 const f=fixture('card');f.setMutable(false);f.chip.click();assert.equal(f.opened.length,0);f.setMutable(true);f.chip.click();f.setMutable(false);f.opened[0].onCommit({status:'Project.Finished'});assert.deepEqual(f.writes,[]);
});
test('overlay without writer stays inert',()=>{const f=fixture('overlay',{noWriter:true});f.chip.click();assert.equal(f.opened.length,0);});
test('reading guard rejects status writes',()=>{let blocked=0;const f=fixture('reading');const guarded=extract('reading-task-row','guardReadingTaskRowActions')(f.callbacks,()=>blocked++);f.callbacks.updateField=guarded.updateField;f.chip.click();f.opened[0].onCommit({status:'Project.Finished'});assert.deepEqual(f.writes,[]);assert.equal(blocked,1);});
test('inline cursor restoration targets description rather than property markup',()=>{const task={filePath:'note.md',lineNumber:8,descriptionRange:{to:19}};const view={};const request=extract('live-preview-conceal','getLivePreviewDescriptionEndCursor')(task,view,{getFilePath:()=> 'note.md'});assert.deepEqual(request,{filePath:'note.md',lineNumber:8,ch:19,editorView:view,trackDescriptionEnd:true});});

class El {
 constructor(tag='div') { this.tag=tag;this.dataset={};this.children=[];this.events={};this.attrs={};this.classes=new Set();this.style={setProperty(){}};this.classList={add:v=>this.classes.add(v),remove:v=>this.classes.delete(v),toggle:(v,on)=>on?this.classes.add(v):this.classes.delete(v)}; }
 createEl(tag,opts) { const el=new El(tag);if(typeof opts==='string')el.className=opts;this.children.push(el);return el; }
 createSpan(opts) { return this.createEl('span',opts); }
 createDiv(opts) { return this.createEl('div',opts); }
 appendChild(el) { this.children=this.children.filter(x=>x!==el);this.children.push(el); }
 replaceChildren() { this.children=[]; }
 querySelectorAll() { return this.children; }
 querySelector() { return this.children[0]; }
 select() { this.selected=this.value; }
 remove() {}
 getBoundingClientRect() { return {width:20}; }
 setAttribute(k,v) { this.attrs[k]=v; }
 addEventListener(k,fn) { this.events[k]=fn; }
 fire(k,event={}) { this.events[k]?.({preventDefault(){},...event}); }
}

function pickerFixture(value='Project.Active') {
 const panel=new El(),writes=[];let cancelled=0,closeCallback;const focusQueue=[];
 const pipelines=[{id:'p',name:'Project',statuses:[{id:'a',label:'Active',color:'#ff0000',pipelineStatusIcon:' lucide-star '},{id:'b',label:'Finished',color:'#00ff00'},{id:'c',label:'Cancelled',color:'#888888',pipelineStatusIcon:'unknown'}]},{id:'other',name:'Daily',statuses:[{id:'a',label:'Active',color:'#0000ff',pipelineStatusIcon:'flag'}]}];
 const deps={getIcon:name=>['star','flag'].includes(name)?new El('svg'):null,t:(_s,k)=>k,composeStatusValue:(p,s)=>p+'.'+s,scrollChildIntoView(){},
 createFloatingPanel:(_a,_c,callback)=>{closeCallback=callback;return {panel,close:()=>callback()};},
 createButton:(label,_c,parent)=>{const b=parent.createEl('button');b.textContent=label;return b;},requestFloatingInputFocus:input=>focusQueue.push(()=>input.fire('focus'))};
 const files=['core/task-icon-value','ui/field-pickers/status-picker-shared','ui/field-pickers/status-picker'];
 const source=files.map(file=>readFileSync(new URL('../src/'+file+'.ts',import.meta.url),'utf8').replace(/^import[\s\S]*?from ['"][^'"]+['"];\n/gm,'')).join('\n');
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports={};new Function('exports',...Object.keys(deps),js)(exports,...Object.values(deps));
 exports.showStatusPicker({}, {pipelines,value,onSelect:v=>writes.push(v),onClear:()=>writes.push(''),onClose:()=>cancelled++});
 const input=panel.children[0],list=panel.children[1],clear=panel.children[2].children[0];
 return {input,list,clear,writes,close:()=>closeCallback(),get cancelled(){return cancelled;},focus:()=>focusQueue.forEach(fn=>fn()),search(v){input.value=v;input.fire('input');}};
}
test('status opening selects full current text after focus and shows current pipeline without writes',()=>{const f=pickerFixture();assert.equal(f.input.selected,undefined);f.focus();assert.equal(f.input.selected,'Project.Active');assert.equal(f.list.children.length,3);assert.ok(f.list.children[0].classes.has('is-active'));assert.deepEqual(f.writes,[]);});
test('status icons retain exact pipeline color, missing/invalid icons retain dots',()=>{const f=pickerFixture();const marks=f.list.children.map(x=>x.children[0]);assert.equal(marks[0].tag,'svg');assert.equal(marks[0].style.color,'#ff0000');assert.equal(marks[0].attrs['aria-hidden'],'true');for(const i of [1,2])assert.equal(marks[i].className,'operon-status-dot');assert.equal(marks[1].style.background,'#00ff00');f.search('Daily');assert.equal(f.list.children[0].children[0].style.color,'#0000ff');});
test('status typing, keyboard and pointer preserve canonical selected value',()=>{const f=pickerFixture();f.focus();f.search('Daily');f.input.fire('keydown',{key:'Enter'});assert.deepEqual(f.writes,['Daily.Active']);const g=pickerFixture();g.input.fire('keydown',{key:'ArrowDown'});g.input.fire('keydown',{key:'Enter'});assert.deepEqual(g.writes,['Project.Finished']);const h=pickerFixture();h.list.children[2].fire('mousedown');assert.deepEqual(h.writes,['Project.Cancelled']);});
test('status Clear writes empty; dismiss does not write',()=>{const f=pickerFixture();f.clear.fire('click');assert.deepEqual(f.writes,['']);assert.equal(f.cancelled,0);const g=pickerFixture();g.close();assert.deepEqual(g.writes,[]);assert.equal(g.cancelled,1);});
test('empty status stays empty and shows all pipelines',()=>{const f=pickerFixture('');f.focus();assert.equal(f.input.selected,'');assert.equal(f.list.children.length,4);assert.deepEqual(f.writes,[]);});

for(const surface of ['live','reading','overlay'])test(`${surface}: shared branch preserves TaskType picker and writes`,()=>{const f=fixture(surface,{key:'taskType'});f.chip.click();assert.equal(f.opened[0].canonicalKey,'taskType');f.opened[0].onCommit({taskType:'Project'});assert.deepEqual(f.writes[0].slice(0,3),['task-a','taskType','Project']);});

test('pointer hover does not replace keyboard selection or remain active on exit',()=>{const f=pickerFixture();f.list.children[1].fire('mouseenter');f.list.children[1].fire('mouseleave');assert.equal(f.list.children[1].classes.has('is-active'),false);assert.equal(f.list.children[0].classes.has('is-active'),true);f.input.fire('keydown',{key:'ArrowDown'});assert.equal(f.list.children[1].classes.has('is-active'),true);f.list.children[2].fire('mouseenter');f.list.children[2].fire('mouseleave');f.input.fire('keydown',{key:'Enter'});assert.deepEqual(f.writes,['Project.Finished']);});
test('status list reserves room for hover ring and strengthens only transient hover',()=>{const css=readFileSync(new URL('../styles.css',import.meta.url),'utf8');assert.match(css,/\.operon-status-picker-list \{\s*padding: 3px;\s*margin: -3px;/);assert.match(css,/\.operon-status-picker-panel \.operon-status-dropdown-item:hover,\s*\.operon-status-picker-panel \.operon-status-dropdown-item:focus-visible \{\s*border-color: color-mix\(in srgb, var\(--operon-status-picker-accent\) 60%/);});
