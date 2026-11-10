import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('src/ui/field-pickers/priority-picker.ts', root), 'utf8');
const normalizeSource = readFileSync(new URL('src/core/task-icon-value.ts', root), 'utf8');
class El {
 constructor(tag='div') { this.tag=tag;this.children=[];this.events={};this.attrs={};this.classes=new Set();this.style={setProperty(){}};this.classList={add:v=>this.classes.add(v),remove:v=>this.classes.delete(v)}; }
 createEl(tag,opts) { const el=new El(tag);if(typeof opts==='string')el.className=opts;this.children.push(el);return el; }
 createSpan(opts) { return this.createEl('span',opts); }
 createDiv(opts) { return this.createEl('div',opts); }
 appendChild(el) { this.children=this.children.filter(x=>x!==el);this.children.push(el); }
 replaceChildren() { this.children=[]; }
 remove() {}
 getBoundingClientRect() { return {width:20}; }
 setAttribute(k,v) { this.attrs[k]=v; }
 addEventListener(k,fn) { this.events[k]=fn; }
 fire(k,event={}) { this.events[k]?.({preventDefault(){},...event}); }
}
function setup() {
 const panel=new El();const writes=[];let cancelled=0,closed=0;
 const close=()=>{closed++;onClose();};let onClose;
 const deps={getIcon:name=>['flag','star'].includes(name)?new El('svg'):null,t:(_s,k)=>k,
  createFloatingPanel:(_anchor,_cls,callback)=>{onClose=callback;return {panel,close};},
  createButton:(label,_cls,parent)=>{const el=parent.createEl('button');el.textContent=label;return el;},
  focusFloatingInput:()=>{},getComputedStyle:()=>({font:'14px sans-serif'}),window:{requestAnimationFrame:fn=>fn()}};
 const js=ts.transpileModule(normalizeSource+'\n'+source.replace(/^import.*\n/gm,''),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports={};new Function('exports',...Object.keys(deps),js)(exports,...Object.values(deps));
 const priorities=[{label:'S',color:'#ff0000',priorityIcon:' lucide-star '},{label:'A',color:'#ff8800'},{label:'B',color:'#00ff00',priorityIcon:'unknown'},{label:'C',color:'#0088ff',priorityIcon:'flag'}];
 exports.showPriorityPicker({}, {priorities,value:'C',onSelect:v=>writes.push(v),onClear:()=>writes.push(''),onClose:()=>cancelled++});
 const input=panel.children.find(x=>x.tag==='input'),list=panel.children.find(x=>x.className==='operon-priority-picker-list');
 return {panel,input,list,writes,close,state:()=>({cancelled,closed}),search(value){input.value=value;input.fire('input');}};
}
test('configured icons use priority color and decorative semantics; absent and unknown icons keep dots',()=>{
 const f=setup();const marks=f.list.children.map(x=>x.children[0]);
 assert.equal(marks[0].tag,'svg');assert.equal(marks[0].style.color,'#ff0000');assert.equal(marks[0].attrs['aria-hidden'],'true');assert.ok(marks[0].classes.has('operon-priority-picker-icon'));
 for(const [i,color]of [[1,'#ff8800'],[2,'#00ff00']]){assert.equal(marks[i].className,'operon-priority-dot');assert.equal(marks[i].style.backgroundColor,color);}
 assert.equal(marks[3].style.color,'#0088ff');assert.ok(f.list.children[3].classes.has('is-active'));assert.deepEqual(f.writes,[]);
});
test('pointer selection keeps label, closes once, and does not cancel',()=>{const f=setup();f.list.children[0].fire('mousedown');assert.deepEqual(f.writes,['S']);assert.deepEqual(f.state(),{closed:1,cancelled:0});});
test('search redraw keeps icons and Enter selection',()=>{const f=setup();f.search('s');assert.equal(f.list.children.length,1);assert.equal(f.list.children[0].children[0].tag,'svg');f.input.fire('keydown',{key:'Enter'});assert.deepEqual(f.writes,['S']);});
test('arrow navigation and Enter preserve existing selection behavior',()=>{const f=setup();f.input.fire('keydown',{key:'ArrowUp'});f.input.fire('keydown',{key:'Enter'});assert.deepEqual(f.writes,['B']);});
test('Clear preserves empty write and normal close',()=>{const f=setup();f.panel.children.find(x=>x.textContent==='repeatClear').fire('click');assert.deepEqual(f.writes,['']);assert.deepEqual(f.state(),{closed:1,cancelled:0});});
test('Escape and external close never write',()=>{for(const external of [false,true]){const f=setup();if(external)f.close();else f.input.fire('keydown',{key:'Escape'});assert.deepEqual(f.writes,[]);assert.deepEqual(f.state(),{closed:1,cancelled:1});}});
test('shared dispatcher and direct editor routes forward complete priority definitions',()=>{
 for(const file of ['src/ui/task-field-picker-dispatch.ts','src/ui/task-editor-content.ts','src/ui/editor-property-fields.ts']) {
  const text=readFileSync(new URL(file,root),'utf8');const calls=[...text.matchAll(/showPriorityPicker\([^]*?priorities:\s*([^,]+),/g)];
  assert.ok(calls.length>0,file);for(const call of calls)assert.match(call[1],/(?:options|this)\.settings\.priorities/);
 }
});
test('shared priority dispatch preserves definitions, current value and commit callbacks',()=>{
 const text=readFileSync(new URL('src/ui/task-field-picker-dispatch.ts',root),'utf8');
 const ast=ts.createSourceFile('dispatch.ts',text,ts.ScriptTarget.Latest,true);
 const node=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='openTaskFieldPicker');
 const js=ts.transpileModule(node.getText(ast).replace(/^export /,''),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 let captured;const close=()=>{};const writes=[];const priorities=[{label:'S',color:'#ff0000',priorityIcon:'star'}];
 const open=new Function('showPriorityPicker',js+';return openTaskFieldPicker;')((_anchor,opts)=>{captured=opts;return close;});
 assert.equal(open({canonicalKey:'priority',currentFieldValues:{priority:'S'},settings:{priorities},onCommit:v=>writes.push(v)}),close);
 assert.equal(captured.priorities,priorities);assert.equal(captured.value,'S');captured.onSelect('S');captured.onClear();assert.deepEqual(writes,[{priority:'S'},{priority:''}]);
 for(const file of ['task-creator-modal','editor-property-fields','compact-card-chips','live-preview-conceal','reading-task-row','embed-table-processor','table/operon-table-view'])assert.match(readFileSync(new URL('src/ui/'+file+'.ts',root),'utf8'),/openTaskFieldPicker\(\{/);
});
