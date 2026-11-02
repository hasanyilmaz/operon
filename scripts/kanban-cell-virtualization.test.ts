import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKanbanVirtualAxis, getKanbanVirtualRange, kanbanVirtualCellKey } from '../src/systems/kanban-virtual-geometry';
import { KanbanCellViewport } from '../src/ui/kanban/kanban-cell-viewport';
import { statusDockDocument } from './test-support/status-dock-dom';

const tracks = (count: number, size: number) => Array.from({ length: count }, (_, i) => ({ key: String(i), size }));
for (const size of [54,350,400,450,500,550]) test(`range boundaries and buffer at ${size}px`, () => {
 const axis = buildKanbanVirtualAxis(tracks(200,size),10);
 for (const offset of [0,size,size+5,size+10,1000,axis.extent-700]) {
  const viewport=700, range=getKanbanVirtualRange(axis,offset,viewport,0);
  const actual=axis.tracks.map((t,i)=>({i,start:axis.starts[i],end:axis.starts[i]+t.size})).filter(t=>t.end>offset&&t.start<offset+viewport).map(t=>t.i);
  assert.deepEqual(Array.from({length:range.end-range.start},(_,i)=>i+range.start),actual);
  const buffered=getKanbanVirtualRange(axis,offset,viewport);
  assert.equal(buffered.start,Math.max(0,range.start-1));assert.equal(buffered.end,Math.min(200,range.end+1));
 }
});
test('mixed geometry, keys, gaps, frozen input and empty viewport',()=>{
 const input=Object.freeze([{key:'false',size:54},{key:'0',size:450},{key:'none::value',size:54}].map(value => Object.freeze(value)));
 const axis=buildKanbanVirtualAxis(input,10);
 assert.deepEqual(axis.starts,[0,64,524]);assert.equal(axis.extent,578);assert.equal(axis.indices.get('0'),1);
 assert.deepEqual(getKanbanVirtualRange(axis,0,0),{start:0,end:0});assert.equal(buildKanbanVirtualAxis([],10).extent,0);
 assert.notEqual(kanbanVirtualCellKey('a::b','c'),kanbanVirtualCellKey('a','b::c'));
});

function fixture(rowCount=200,columnCount=300,options:{classic?:boolean;empty?:boolean;labels?:boolean;hidden?:boolean;initialScroll?:{top:number;left:number}}={}) {
 const f=statusDockDocument();const doc=f.doc,win=doc.defaultView,proto=win.HTMLElement.prototype;
 Object.defineProperty(proto,'nextElementSibling',{get(){return this.parent?.children[this.parent.children.indexOf(this)+1]??null;}});
 Object.defineProperty(proto,'tabIndex',{get(){return this.tabValue??(['BUTTON','INPUT','A'].includes(this.tagName)?0:-1);},set(value:number){this.tabValue=value;}});
 const basicMatches=proto.matches;
 proto.matches=function(selector:string):boolean { if(selector.includes(','))return selector.split(',').some(s=>this.matches(s.trim()));if(selector==='[inert]')return this.attrs.inert!==undefined;return basicMatches.call(this,selector); };
 proto.querySelectorAll=function(selector='*'):any[] {const all=this.children.flatMap((n:any)=>[n,...n.querySelectorAll('*')]);return selector.includes('button:not')?all.filter((n:any)=>['BUTTON','INPUT','A'].includes(n.tagName)||n.tabIndex===0):all.filter((n:any)=>n.matches(selector));};
 proto.querySelector=function(selector:string):any{return this.querySelectorAll(selector)[0]??null;};
 win.getComputedStyle=(el:any)=>({visibility:el.attrs.visibility??'visible'});
 let observers=0;let resize:()=>void=()=>{};
 win.ResizeObserver=class{constructor(callback:()=>void){resize=callback;observers++;}observe(){}disconnect(){observers--;}};
 const viewport=doc.body.createDiv('operon-kanban-grid-viewport');viewport.clientWidth=options.hidden?0:1100;viewport.clientHeight=options.hidden?0:800;viewport.scrollTop=0;viewport.scrollLeft=0;
 const content=viewport.createDiv(),header=content.createDiv();
 const mounted=new Set<HTMLElement>(),pinned=new Set<HTMLElement>();let created=0,removed=0,headersCreated=0,queries=0;let revision=1;
 const model={rows:tracks(rowCount,450),columns:tracks(columnCount,320),gap:10,railWidth:options.labels===false?0:100,headerHeight:54,classic:!!options.classic};
 const instance=new KanbanCellViewport({viewport,content,header,
  createHeader:i=>{headersCreated++;const h=header.createDiv('operon-kanban-column-header');h.dataset.kanbanStatusId=String(i);h.createEl('button');return h;},
  createRow:i=>{const row=content.createDiv('operon-kanban-row');row.dataset.kanbanLaneKey=String(i);if(model.railWidth){const label=row.createDiv('operon-kanban-lane-label');label.dataset.kanbanLaneKey=String(i);label.createEl('button');}return row;},
  createCell:(row:any,r,c)=>{queries++;created++;const cell=row.createDiv('operon-kanban-cell');Object.assign(cell.dataset,{kanbanLaneKey:String(r),kanbanStatusId:String(c),revision:String(revision)});if(!options.empty){const hidden=cell.createEl('button');hidden.attrs.visibility='hidden';hidden.dataset.hidden='true';cell.createEl('button');}mounted.add(cell);return cell;},
  removeCell:cell=>{removed++;mounted.delete(cell);},removeHeader:()=>{},removeRow:()=>{},keepCell:cell=>pinned.has(cell)||cell.contains(doc.activeElement),beforeFirstMount:()=>{if(options.initialScroll){viewport.scrollTop=options.initialScroll.top;viewport.scrollLeft=options.initialScroll.left;}},afterMount:()=>{},onResize:()=>{}
 });
 instance.update(model);
 const tab=(backwards=false)=>{let prevented=false;(instance as any).onKeyDown({key:'Tab',shiftKey:backwards,preventDefault(){prevented=true;}});return prevented;};
 return { ...f,doc,win,instance,viewport,content,header,model,mounted,pinned,tab,resize:()=>resize(),setRevision(v:number){revision=v;},stats:()=>({created,removed,headersCreated,queries,observers}) };
}

test('200 x 300 uses a bounded window and a direct jump does not create intermediate cells',()=>{
 const f=fixture();assert.ok(f.mounted.size<=20);const initial=f.stats().created;
 f.viewport.scrollTop=199*460;f.viewport.scrollLeft=299*330;f.instance.refresh();
 assert.ok(f.instance.getCell('199','299'));assert.ok(f.mounted.size<=20);assert.ok(f.stats().created-initial<=20);
 assert.equal(f.content.style.width,'99100px');assert.equal(f.instance.rowAxis.extent,91990);f.instance.dispose();assert.equal(f.stats().observers,0);
});
test('scrolling the complete board releases cells rather than accumulating DOM',()=>{
 const f=fixture();let max=0;
 for(let row=0;row<200;row+=7)for(let column=0;column<300;column+=13){f.viewport.scrollTop=row*460;f.viewport.scrollLeft=column*330;f.instance.refresh();max=Math.max(max,f.mounted.size);assert.ok(f.mounted.size<=30);}
 assert.ok(f.stats().created>10000);assert.equal(f.stats().created-f.stats().removed,f.mounted.size);assert.ok(max<=30);f.instance.dispose();assert.equal(f.mounted.size,0);
});
test('unchanged range retains cells and does not query the data provider again',()=>{
 const f=fixture();const before=f.stats(),cell=f.instance.getCell('0','0');for(let i=0;i<100;i++)f.instance.refresh();assert.deepEqual(f.stats(),before);assert.equal(f.instance.getCell('0','0'),cell);f.instance.dispose();
});
test('distant interaction pins add individual cells, not a large rectangle',()=>{
 const f=fixture();const source=f.instance.getCell('0','0')!;f.pinned.add(source);f.viewport.scrollTop=199*460;f.viewport.scrollLeft=299*330;f.instance.refresh();assert.equal(f.instance.getCell('0','0'),source);assert.ok(f.mounted.size<=21);f.pinned.clear();f.instance.refresh();assert.equal(f.instance.getCell('0','0'),null);f.instance.dispose();
});
test('newly visible cells consult the latest provider revision without repainting retained cells',()=>{
 const f=fixture();const retained=f.instance.getCell('0','0');f.setRevision(2);f.instance.refresh();assert.equal(f.instance.getCell('0','0'),retained);f.viewport.scrollTop=46000;f.instance.refresh();assert.equal(f.instance.getCell('100','0')?.dataset.revision,'2');f.instance.dispose();
});
test('row removal releases cells and recomputes offsets with no stale row',()=>{
 const f=fixture();f.instance.update({...f.model,rows:f.model.rows.filter(r=>r.key!=='0')});assert.equal(f.instance.getRow('0'),null);assert.equal(f.instance.getCell('0','0'),null);assert.equal(f.instance.getRowOffsets().get('1'),64);f.instance.dispose();
});
test('classic board fills remaining viewport height and reacts to resize',()=>{
 const f=fixture(1,300,{classic:true,labels:false});assert.equal(f.instance.rowAxis.tracks[0].size,736);f.viewport.clientHeight=600;f.resize();assert.equal(f.instance.rowAxis.tracks[0].size,536);f.instance.dispose();
});
test('hidden pane creates no cells, then materializes only its visible window',()=>{
 const f=fixture();f.viewport.clientHeight=0;f.viewport.clientWidth=0;f.instance.refresh();assert.equal(f.mounted.size,0);f.viewport.clientWidth=1100;f.viewport.clientHeight=800;f.resize();assert.ok(f.mounted.size>0&&f.mounted.size<=20);f.instance.dispose();
});
test('RAF is coalesced, belongs to owner window and cannot render after disposal',()=>{
 const f=fixture();f.instance.schedule();f.instance.schedule();assert.equal(f.timers.size,1);f.viewport.scrollLeft=50000;const before=f.stats().created;f.instance.dispose();f.flush();assert.equal(f.stats().created,before);assert.equal(f.timers.size,0);assert.equal(f.stats().observers,0);
});
test('keyboard traverses virtual headers before moving to row labels',()=>{
 const f=fixture(2,20);let h=f.header.querySelector('.operon-kanban-column-header');h.children[0].focus();
 for(let i=1;i<20;i++){assert.equal(f.tab(),true);assert.equal(f.doc.activeElement.parent.dataset.kanbanStatusId,String(i));}
 assert.equal(f.tab(),true);assert.equal(f.doc.activeElement.parent.dataset.kanbanLaneKey,'0');assert.ok(f.doc.activeElement.parent.matches('.operon-kanban-lane-label'));assert.equal(f.tab(true),true);assert.equal(f.doc.activeElement.parent.dataset.kanbanStatusId,'19');f.instance.dispose();
});
test('Tab skips hidden add controls and reaches real controls in both directions',()=>{
 const f=fixture(1,30,{labels:false});const first=f.instance.getCell('0','0') as any;first.children[1].focus();for(let i=1;i<20;i++){assert.equal(f.tab(),true);assert.equal(f.doc.activeElement.parent.dataset.kanbanStatusId,String(i));assert.notEqual(f.doc.activeElement.dataset.hidden,'true');}
 for(let i=18;i>=0;i--){assert.equal(f.tab(true),true);assert.equal(f.doc.activeElement.parent.dataset.kanbanStatusId,String(i));}f.instance.dispose();
});
test('empty and collapsed cells remain traversable across window edges',()=>{
 const f=fixture(3,20,{empty:true,labels:false});f.instance.getCell('0','0')!.focus();
 for(let i=1;i<45;i++){assert.equal(f.tab(),true);assert.equal(f.doc.activeElement.dataset.kanbanLaneKey,String(Math.floor(i/20)));assert.equal(f.doc.activeElement.dataset.kanbanStatusId,String(i%20));}
 for(let i=43;i>=0;i--){assert.equal(f.tab(true),true);assert.equal(f.doc.activeElement.dataset.kanbanStatusId,String(i%20));}f.instance.dispose();
});
test('independent windows own their observers and scheduled work',()=>{
 const a=fixture(),b=fixture();a.instance.schedule();b.instance.schedule();a.instance.dispose();assert.equal(a.timers.size,0);assert.equal(b.timers.size,1);b.flush();assert.ok(b.mounted.size>0);b.instance.dispose();
});

test('restored viewport mounts only its destination after geometry exists',()=>{
 const f=fixture(200,300,{initialScroll:{top:199*460,left:299*330}});
 assert.ok(f.instance.getCell('199','299'));assert.equal(f.instance.getCell('0','0'),null);assert.equal(f.stats().created,f.mounted.size);
 f.viewport.scrollTop=0;f.viewport.scrollLeft=0;f.instance.update(f.model);assert.ok(f.instance.getCell('0','0'));f.instance.dispose();
});
test('initial scroll restoration waits for a hidden pane to become measurable',()=>{
 const f=fixture(200,300,{hidden:true,initialScroll:{top:199*460,left:299*330}});assert.equal(f.stats().created,0);
 f.viewport.clientWidth=1100;f.viewport.clientHeight=800;f.resize();assert.ok(f.instance.getCell('199','299'));assert.equal(f.stats().created,f.mounted.size);f.instance.dispose();
});
