import { Platform } from 'obsidian';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openLightbox, registerLightboxSource, transferLightboxOpening, openAppLightbox, disposeAppLightboxes, getLightboxOrigin, getLightboxSizeStep } from '../src/ui/lightbox';

import { lightboxFixture as fixture } from './test-support/lightbox-dom';

test('shell closes once, removes listeners and restores owner-document focus', () => {
 const f = fixture(); let cleaned = 0; let root: HTMLElement;
 const close = openLightbox(f.anchor, { title: 'Image', render: el => { root = el; return () => cleaned++; } });
 assert.equal(root!.getAttribute?.('role') ?? (root! as any).attrs.role, 'dialog');
 f.emit('keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {} }); close();
 assert.equal(cleaned, 1); assert.equal(root!.isConnected, false); assert.equal(f.doc.activeElement, f.anchor);
 assert.equal(f.listeners.get('keydown')!.size, 0); assert.equal(f.listeners.get('focusin')!.size, 0);
});
test('one lightbox per document, independent windows and outside click', () => {
 const a = fixture(), b = fixture(); let cleaned = 0; let root: any;
 openLightbox(a.anchor, { title: 'First', render: () => () => cleaned++ });
 const closeB = openLightbox(b.anchor, { title: 'Other window', render: () => null });
 const closeA = openLightbox(a.anchor, { title: 'Next', render: el => { root = el; return null; } });
 assert.equal(cleaned, 1); assert.equal(b.listeners.get('keydown')!.size, 1);
 root.events.get('click')({target:root.children[0]}); assert.equal(root.isConnected, true);
 root.events.get('click')({target:root}); assert.equal(root.isConnected, false); closeA(); closeB();
});
test('focus stays inside, disconnected original focus falls back to anchor', () => {
 const f = fixture(); const original = f.doc.body.createDiv(); original.focus(); let root: any;
 const close = openLightbox(f.anchor, { title: 'PDF', render: el => { root = el; return null; } });
 f.emit('focusin', {target:f.anchor}); assert.equal(f.doc.activeElement, root.children[1]);
 original.remove(); close(); assert.equal(f.doc.activeElement, f.anchor);
});
test('synchronous close during render cleans returned content without resurrecting shell', () => {
 const f = fixture(); let cleaned = 0;
 openLightbox(f.anchor, { title: 'Error', render: (_el, close) => { close(); return () => cleaned++; } });
 assert.equal(cleaned, 1); assert.equal(f.listeners.get('keydown')!.size, 0);
});
test('render and cleanup exceptions still remove dialog and listeners', () => {
 const f = fixture();
 assert.throws(() => openLightbox(f.anchor, { title: 'Error', render: () => { throw Error('render'); } }), /render/);
 const close = openLightbox(f.anchor, { title: 'Error', render: () => () => { throw Error('cleanup'); } });
 assert.throws(close, /cleanup/); close(); assert.equal(f.listeners.get('keydown')!.size, 0); assert.equal(f.doc.activeElement, f.anchor);
});

const tick = () => new Promise(resolve => setImmediate(resolve));
function desktopFixture() {
 const f=fixture(), previous=Platform.isDesktopApp;Platform.isDesktopApp=true;
 return {...f, cleanup:()=>{Platform.isDesktopApp=previous;}};
}
test('nested preview retains parent and restores focus without replacing or saving it',async()=>{
 const f=desktopFixture();let parent:any, child:any,saves=0,disposed=0;
 try {
  const closeParent=openLightbox(f.anchor,{title:'Parent',beforeClose:()=>{saves++;return true;},render:el=>{parent=el;return()=>disposed++;}});
  const link=parent.createDiv();link.focus();
  const closeChild=openLightbox(link,{title:'Child',render:el=>{child=el;return null;}});
  assert.equal(Boolean(parent.hidden),false);assert.equal(parent.inert,true);assert.equal(saves,0);assert.equal(closeParent(),false);
  f.emit('keydown',{key:'Escape',preventDefault(){},stopPropagation(){}});
  assert.equal(child.isConnected,false);assert.equal(parent.isConnected,true);assert.equal(Boolean(parent.hidden),false);assert.equal(f.doc.activeElement,link);
  await closeChild();await closeParent();assert.equal(disposed,1);assert.equal(saves,1);
 }finally{f.cleanup();}
});
test('failed child mounting restores the existing view and draft owner',()=>{
 const f=desktopFixture();let parent:any;
 try {
  const close=openLightbox(f.anchor,{title:'Parent',render:el=>{parent=el;return null;}});
  const panel=f.doc.body.createDiv(),link=panel.createDiv();let focused=0;
  const source=registerLightboxSource(panel,parent,{blocked:()=>true,focus:()=>focused++,closeClean:()=>assert.fail('no commit')});
  assert.throws(()=>openLightbox(link,{title:'Child',render:()=>{throw Error('mount');}}));
  assert.equal(source.suspended(),false);assert.equal(panel.hidden,false);assert.equal(Boolean(parent.hidden),false);assert.equal(focused,1);
  source.dispose();close();
 }finally{f.cleanup();}
});
test('source popover is suspended until child closes; dirty chain blocks all three transfers before save',async()=>{
 const f=desktopFixture();let parent:any,child:any,prepared=0,commits=0,nativeSaves=0,dirty=true;
 try {
  const closeParent=openLightbox(f.anchor,{title:'Parent',beforeClose:()=>{nativeSaves++;return true;},render:el=>{parent=el;return null;}});
  const panel=f.doc.body.createDiv(), link=panel.createDiv();
  const source=registerLightboxSource(panel,parent,{blocked:()=>dirty,focus:()=>link.focus(),closeClean:()=>{commits++;source.dispose();panel.remove();}});
  const prepare=async()=>{prepared++;return()=>f.anchor.focus();};
  const closeChild=openLightbox(link,{title:'Child',onOpenInTab:prepare,onOpenToRight:prepare,onOpenBelow:prepare,render:el=>{child=el;return null;}});
  assert.equal(source.suspended(),true);assert.equal(panel.hidden,true);
  for(const name of ['tab','split','split-below']){child.children.find((el:any)=>el.classes.has(`operon-task-media-lightbox-${name}`)).events.get('click')();await tick();}
  assert.equal(prepared,0);assert.equal(nativeSaves,0);assert.equal(commits,0);assert.equal(child.isConnected,true);
  await closeChild();assert.equal(f.doc.activeElement,link);assert.equal(panel.hidden,false);
  dirty=false;source.dispose();await closeParent();
 }finally{f.cleanup();}
});
test('clean chain prepares top to bottom, closes once and focuses destination after source cleanup',async()=>{
 const f=desktopFixture();let parent:any,child:any;const calls:string[]=[];
 try {
  openLightbox(f.anchor,{title:'Parent',beforeClose:()=>{calls.push('save-parent');return true;},render:el=>{parent=el;return()=>calls.push('close-parent');}});
  const panel=f.doc.body.createDiv(),link=panel.createDiv();
  const source=registerLightboxSource(panel,parent,{blocked:()=>false,focus:()=>calls.push('focus-source'),closeClean:()=>{calls.push('close-source');source.dispose();panel.remove();}});
  const close=openLightbox(link,{title:'Child',beforeClose:()=>{calls.push('save-child');return true;},render:el=>{child=el;return()=>calls.push('close-child');}});
  assert.equal(await transferLightboxOpening(child,async()=>{calls.push('prepare-target');return()=>calls.push('focus-target');}),true);
  assert.deepEqual(calls,['save-child','save-parent','prepare-target','close-source','close-child','close-parent','focus-target']);
  assert.equal(parent.isConnected,false);assert.equal(child.isConnected,false);await close();assert.equal(calls.length,7);
 }finally{f.cleanup();}
});
test('failed ancestor save or target preparation leaves chain and source draft intact',async()=>{
 const f=desktopFixture();let parent:any,child:any,allowed=false,prepared=0;
 try {
  const a=openLightbox(f.anchor,{title:'Parent',beforeClose:()=>allowed,render:el=>{parent=el;return null;}});
  const b=openLightbox(parent.createDiv(),{title:'Child',render:el=>{child=el;return null;}});
  assert.equal(await transferLightboxOpening(child,async()=>{prepared++;return null;}),false);assert.equal(prepared,0);
  allowed=true;assert.equal(await transferLightboxOpening(child,async()=>{prepared++;throw Error('load');}),false);
  assert.equal(child.isConnected,true);assert.equal(child.inert,false);assert.equal(Boolean(parent.hidden),false);
  await b();await a();
 }finally{f.cleanup();}
});
test('standalone popover modifier transfer obeys dirty guard and never steals destination focus',async()=>{
 const f=desktopFixture();let dirty=true,prepared=0,focused=0;
 try {
  const panel=f.doc.body.createDiv(),link=panel.createDiv();
  const source=registerLightboxSource(panel,null,{blocked:()=>dirty,focus:()=>assert.fail('no focus return'),closeClean:()=>{source.dispose();panel.remove();}});
  const prepare=async()=>{prepared++;return()=>focused++;};
  assert.equal(await transferLightboxOpening(link,prepare),false);assert.equal(prepared,0);
  dirty=false;assert.equal(await transferLightboxOpening(link,prepare),true);assert.equal(focused,1);assert.equal(panel.isConnected,false);
 }finally{f.cleanup();}
});
test('application disposal closes nested owned shells in reverse order and keeps other windows independent',async()=>{
 const f=desktopFixture(),other=fixture(),app={} as any;let parent:any;const order:string[]=[];
 try {
  openAppLightbox(app,f.anchor,{title:'Parent',beforeClose:async()=>true,render:el=>{parent=el;return()=>order.push('parent');}});
  openAppLightbox(app,parent.createDiv(),{title:'Child',beforeClose:async()=>true,render:()=>()=>order.push('child')});
  const unrelated=openLightbox(other.anchor,{title:'Other',render:()=>()=>order.push('other')});
  disposeAppLightboxes(app);await tick();assert.deepEqual(order,['child','parent']);unrelated();
 }finally{f.cleanup();}
});

test('nested preview and owned popover inherit the first source leaf',()=>{
 const f=desktopFixture();let parent:any,child:any;const origin={} as any,other={} as any;
 try{
  const a=openLightbox(f.anchor,{title:'A',originLeaf:origin,render:el=>{parent=el;return null;}});
  const panel=f.doc.body.createDiv(),link=panel.createDiv();
  const source=registerLightboxSource(panel,parent,{blocked:()=>false,focus:()=>{},closeClean:()=>{}});
  assert.equal(getLightboxOrigin(link),origin);
  const b=openLightbox(link,{title:'B',originLeaf:other,render:el=>{child=el;return null;}});
  assert.equal(getLightboxOrigin(child.createDiv()),origin);b();source.dispose();a();
 }finally{f.cleanup();}
});
test('pagehide drains all nested shells for that document',async()=>{
 const f=desktopFixture(),listeners=new Set<()=>void>(),order:string[]=[];let parent:any;
 f.doc.defaultView.addEventListener=(name:string,fn:()=>void)=>{if(name==='pagehide')listeners.add(fn);};
 f.doc.defaultView.removeEventListener=(name:string,fn:()=>void)=>{if(name==='pagehide')listeners.delete(fn);};
 try{
  openLightbox(f.anchor,{title:'A',beforeClose:async()=>true,render:el=>{parent=el;return()=>order.push('parent');}});
  openLightbox(parent.createDiv(),{title:'B',beforeClose:async()=>true,render:()=>()=>order.push('child')});
  for(const fn of [...listeners])fn();await tick();assert.deepEqual(order,['child','parent']);assert.equal(listeners.size,0);
 }finally{f.cleanup();}
});

test('modal preview owns a keyboard scope through pending/failed saves and nested cleanup', async () => {
 const f=desktopFixture(), modal=f.doc.body.createDiv(), scopes:unknown[]=[], appScope={};
 (f.anchor as any).closest=()=>modal;
 f.doc.defaultView.app={scope:appScope,keymap:{pushScope:(s:unknown)=>scopes.push(s),popScope:(s:unknown)=>scopes.splice(scopes.indexOf(s),1)}};
 let root:any,resolveSave!:(ok:boolean)=>void;
 try {
  const close=openLightbox(f.anchor,{title:'Parent',nativeView:true,beforeClose:()=>new Promise<boolean>(r=>resolveSave=r),render:el=>{root=el;return null;}});
  assert.equal(scopes.length,1);assert.equal(root.classes.has('is-modal-owned'),true);
  const pending=close();assert.equal(scopes.length,1);resolveSave(false);assert.equal(await pending,false);assert.equal(scopes.length,1);
  const closeChild=openLightbox(root.createDiv(),{title:'Child',render:el=>{assert.equal((el as any).classes.has('is-modal-owned'),true);return null;}});
  assert.equal(scopes.length,2);closeChild();closeChild();assert.equal(scopes.length,1);
  const accepted=close();resolveSave(true);assert.equal(await accepted,true);assert.equal(scopes.length,0);assert.equal(f.doc.activeElement,f.anchor);
 } finally {f.cleanup();}
});
test('modal preview render failure releases only its owner window keyboard scope', () => {
 const a=desktopFixture(),b=fixture(),scopesA:unknown[]=[],scopesB:unknown[]=[];
 for(const [f,scopes]of [[a,scopesA],[b,scopesB]] as const){
  (f.anchor as any).closest=()=>f.doc.body;
  f.doc.defaultView.app={scope:{},keymap:{pushScope:(s:unknown)=>scopes.push(s),popScope:(s:unknown)=>scopes.splice(scopes.indexOf(s),1)}};
 }
 try{
  const closeB=openLightbox(b.anchor,{title:'B',render:()=>null});
  assert.throws(()=>openLightbox(a.anchor,{title:'A',render:()=>{throw Error('mount');}}),/mount/);
  assert.equal(scopesA.length,0);assert.equal(scopesB.length,1);closeB();assert.equal(scopesB.length,0);
 }finally{a.cleanup();}
});

for (const contentFocused of [false, true]) test(`desktop shell preserves content focus=${contentFocused} without selecting management controls`, () => {
 const f=desktopFixture();let root:any,editor:any;
 try {
  const close=openLightbox(f.anchor,{title:'Preview',render:el=>{
   root=el;editor=el.createDiv();if(contentFocused)editor.focus();return null;
  }});
  assert.equal(f.doc.activeElement,contentFocused?editor:root);
  f.anchor.focus();f.emit('focusin',{target:f.anchor});
  assert.equal(f.doc.activeElement,root);
  close();assert.equal(f.doc.activeElement,f.anchor);
 }finally{f.cleanup();}
});
test('mobile retains its existing Close focus on opening and focus recovery',()=>{
 const f=fixture(),previous=Platform.isDesktopApp;Platform.isDesktopApp=false;let root:any;
 try {
  const close=openLightbox(f.anchor,{title:'Mobile',render:el=>{root=el;return null;}});
  assert.equal(f.doc.activeElement,root.children[1]);
  f.emit('focusin',{target:f.anchor});assert.equal(f.doc.activeElement,root.children[1]);close();
 }finally{Platform.isDesktopApp=previous;}
});

test('size steps choose the strict neighbouring viewport percentage, including intermediate values',()=>{
 for(const [current,down,up] of [[67,65,70],[85,80,90],[75,70,80],[80,75,85],[70,65,75],[65,60,70],[40,null,45],[90,85,null],[12,null,40],[95,90,null],[64.999,60,70]]){
  assert.equal(getLightboxSizeStep(current!,-1),down);assert.equal(getLightboxSizeStep(current!,1),up);
 }
});
test('desktop dimming keeps moon/sun controls without an output indicator; mobile has neither',()=>{
 const previous=Platform.isDesktopApp;const icons=new Map<any,string>();
 (globalThis as any).__operonTestSetIcon=(el:any,name:string)=>icons.set(el,name);
 try{
  for(const desktop of [true,false]){
   Platform.isDesktopApp=desktop;const f=fixture();
   const close=openLightbox(f.anchor,{title:'Controls',render:()=>null});const nodes=f.doc.body.querySelectorAll();
   assert.equal(nodes.some((el:any)=>el.classes.has('operon-lightbox-dimming-value')),false);
   for(const [name,icon] of [['increase','moon'],['decrease','sun']]){
    const button=nodes.find((el:any)=>el.classes.has(`operon-lightbox-dimming-${name}`));
    assert.equal(!!button,desktop);if(button)assert.equal(icons.get(button),icon);
   }
   close();
  }
 }finally{Platform.isDesktopApp=previous;delete (globalThis as any).__operonTestSetIcon;}
});

test('desktop control hover distinguishes backdrop, content and SVG descendants without moving focus',()=>{
 const f=desktopFixture();let root:any;
 try {
  const close=openLightbox(f.anchor,{title:'Hover',render:el=>{root=el;return null;}});
  const control=root.children.find((el:any)=>el.classes.has('operon-task-media-lightbox-close'));
  Object.defineProperty(control,'parentElement',{value:root});
  control.classList={contains:(name:string)=>control.classes.has(name)};
  const content=root.createDiv(),svg={};
  const over=(target:unknown,path:unknown[])=>root.events.get('pointerover')({target,composedPath:()=>path});
  assert.equal(root.classes.has('are-controls-hovered'),false);
  over(root,[root]);assert.equal(root.classes.has('are-controls-hovered'),true);
  over(content,[content,root]);assert.equal(root.classes.has('are-controls-hovered'),false);
  over(svg,[svg,control,root]);assert.equal(root.classes.has('are-controls-hovered'),true);
  over(content,[content,root]);over(svg,[svg,control,root]);
  assert.equal(root.classes.has('are-controls-hovered'),true,'entering the control reveals it again without a pointer-speed deadline');
  assert.equal(f.doc.activeElement,root,'hover never changes focus');
  root.events.get('pointerleave')();assert.equal(root.classes.has('are-controls-hovered'),false);
  over(root,[root]);close();
  assert.equal(root.events.has('pointerover'),false);assert.equal(root.events.has('pointerleave'),false);
  assert.equal(root.classes.has('are-controls-hovered'),false);
 }finally{f.cleanup();}
});
test('control hover belongs to its owner document and cleanup does not affect another window',()=>{
 const a=desktopFixture(),b=fixture();let rootA:any,rootB:any;
 try {
  const closeA=openLightbox(a.anchor,{title:'A',render:el=>{rootA=el;return null;}});
  const closeB=openLightbox(b.anchor,{title:'B',render:el=>{rootB=el;return null;}});
  rootA.events.get('pointerover')({target:rootA,composedPath:()=>[rootA]});
  assert.equal(rootA.classes.has('are-controls-hovered'),true);assert.equal(rootB.classes.has('are-controls-hovered'),false);
  closeB();assert.equal(rootA.classes.has('are-controls-hovered'),true);closeA();
 }finally{a.cleanup();}
});
test('mobile installs no control-hover listeners and retains the existing opening focus',()=>{
 const f=fixture(),previous=Platform.isDesktopApp;Platform.isDesktopApp=false;let root:any;
 try {
  const close=openLightbox(f.anchor,{title:'Mobile',render:el=>{root=el;return null;}});
  assert.equal(root.events.has('pointerover'),false);assert.equal(root.events.has('pointerleave'),false);
  assert.equal(f.doc.activeElement,root.children[1]);close();
 }finally{Platform.isDesktopApp=previous;}
});
