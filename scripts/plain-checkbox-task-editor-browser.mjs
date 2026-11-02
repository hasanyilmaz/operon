import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.OPERON_TEST_PLAYWRIGHT || 'playwright');
const entry=String.raw`import {TFile,Platform} from 'obsidian';
import {DEFAULT_SETTINGS} from './src/types/settings';
import {openLightbox} from './src/ui/lightbox';
import {showPlainCheckboxPopover} from './src/ui/plain-checkbox-popover';
import {createFloatingPanel,closeFloatingPanelsForRoot,requestFloatingPanelCloseForRoot} from './src/ui/field-pickers/common';
window.mountNativeTaskEditor=()=>{
 Platform.isDesktopApp=true;
 const container=document.querySelector('.modal-container');
 const editor=container.querySelector('.modal');
 window.closeNativeHost=openLightbox(document.querySelector('#outside'),{title:'Task workspace',className:'is-native',nativeView:true,
  render:shell=>{shell.classList.add('operon-native-workspace','operon-task-workspace');shell.append(editor);window.scopeRoot=shell;return null;},
 });
 container.remove();
};
window.openCheckboxes=async (representation,initial,followAnchor,outside=false)=>{
 const file=new TFile('Example.md');
 window.content=representation==='inline'?'- [ ] Demo task {{operonId:: ab00001}}\n'+initial:initial;
 window.writes=0;
 const app={vault:{getAbstractFileByPath:()=>file,read:async()=>window.content,modify:async(_,value)=>{window.content=value;window.writes++;}},workspace:{on(){return {};},offref(){}}};
 Platform.isDesktopApp=true;
 await showPlainCheckboxPopover(document.querySelector(outside?'#outside':'#anchor'),{
  app,task:{operonId:'ab00001',description:'Demo task',checkbox:'open',fieldValues:{},tags:[],primary:{filePath:file.path,format:representation,lineNumber:0}},
  keyMappings:DEFAULT_SETTINGS.keyMappings,seedEmptyDraft:true,followAnchor,
 });
};
window.cleanupOwnedCheckboxes=()=>closeFloatingPanelsForRoot(document.querySelector('.operon-task-editor-shell'));
window.unrelatedPanel=()=>createFloatingPanel(document.querySelector('#outside'),'unrelated-panel',()=>{});
window.closeOwnedCheckboxes=()=>requestFloatingPanelCloseForRoot(document.querySelector('.operon-task-editor-shell'),'escape');
`;
const editorFixture=String.raw`import {EditorView} from '@codemirror/view';
import {EditorState} from '@codemirror/state';
// The production popover/host lifecycle is real; emulate only Obsidian's private editor factory.
export class EmbeddedMarkdownSourceEditor {
 constructor(app,host,options){
  if(window.editorMode==='textarea')throw new Error('exercise supported fallback');
  this.cm=new EditorView({parent:host,state:EditorState.create({doc:options.value,extensions:[...(options.additionalExtensions??[]),EditorView.updateListener.of(update=>{if(update.docChanged)options.onChange();})]})});
 }
 get value(){return this.cm.state.doc.toString();}
 setValue(value){this.cm.dispatch({changes:{from:0,to:this.cm.state.doc.length,insert:value}});}
 focusEnd(){this.cm.dispatch({selection:{anchor:this.cm.state.doc.length}});this.cm.focus();}
 indentCurrentLine(){this.cm.dispatch(this.cm.state.replaceSelection(' '));}
 destroy(){this.cm.destroy();}
}
`;
const bundle=await build({stdin:{contents:entry,resolveDir:root,loader:'ts'},plugins:[{name:'private-editor-fixture',setup(b){b.onLoad({filter:/embedded-markdown-source-editor\.ts$/},()=>({contents:editorFixture,loader:'ts',resolveDir:root+'/src/ui'}));}}],bundle:true,write:false,format:'iife',alias:{obsidian:root+'/scripts/test-support/obsidian.ts'},logLevel:'silent'});
const browser=await chromium.launch({headless:true,...(process.env.OPERON_TEST_BROWSER?{executablePath:process.env.OPERON_TEST_BROWSER}:{})});
let scenarios=0;
try{
 for(const surface of ['native','modal'])for(const mode of ['codemirror','textarea'])for(const representation of ['inline','file'])for(const width of [560,1200])for(const initial of ['', '- [ ] Existing checkbox']){
  const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.setContent('<button id="outside">Outside</button><div class="modal-container operon-task-editor-modal-container"><div class="modal operon-task-editor-modal"><div class="modal-content"><div class="operon-task-editor-shell"><input id="modal-input"><button id="anchor">Checkboxes</button></div></div></div></div>');
   await page.addStyleTag({content:readFileSync(root+'/styles.css','utf8')});
   await page.addStyleTag({content:'body{margin:0;--background-primary:#222;--background-modifier-border:#777;--text-normal:#ddd;--text-muted:#999;--interactive-accent:#48f}.modal-container{position:fixed;inset:0;box-sizing:border-box;display:flex}.modal{position:absolute;right:24px;bottom:40px;transform:translate3d(0,0,0);width:calc(100% - 48px);height:75vh;overflow:hidden}.modal-content{height:100%;overflow:auto}.operon-plain-checkbox-popover-panel{box-sizing:border-box}.cm-content{font:16px sans-serif}.operon-plain-checkbox-popover-editor-host{min-height:180px}#anchor{margin-top:80px;width:100px;height:32px}'});
 await page.addScriptTag({content:"window.activeWindow=window;window.activeDocument=document;Object.defineProperty(Document.prototype,'win',{get(){return this.defaultView}});function decorate(el,opts){if(typeof opts==='string')el.className=opts;else if(opts){if(opts.cls)el.className=opts.cls;if(opts.text)el.textContent=opts.text;for(const[k,v]of Object.entries(opts.attr||{}))el.setAttribute(k,v)}return el}window.createEl=(tag,opts)=>decorate(document.createElement(tag),opts);window.createSpan=opts=>window.createEl('span',opts);window.createDiv=opts=>window.createEl('div',opts);HTMLElement.prototype.createEl=function(tag,opts){const e=window.createEl(tag,opts);this.append(e);return e};HTMLElement.prototype.createSpan=function(o){return this.createEl('span',o)};HTMLElement.prototype.createDiv=function(o){return this.createEl('div',o)};HTMLElement.prototype.addClass=function(...c){this.classList.add(...c)};HTMLElement.prototype.removeClass=function(...c){this.classList.remove(...c)};HTMLElement.prototype.setCssProps=function(o){for(const[k,v]of Object.entries(o))this.style.setProperty(k,v)};HTMLElement.prototype.empty=function(){this.replaceChildren()};HTMLElement.prototype.setText=function(t){this.textContent=t};window.__operonTestSetIcon=(target)=>{target.innerHTML='<svg class=\"svg-icon\" width=\"16\" height=\"16\"><circle cx=\"8\" cy=\"8\" r=\"6\"/></svg>'};"});
   await page.evaluate(()=>{Element.prototype.toggleClass=function(name,on){this.classList.toggle(name,on);};});
   await page.addScriptTag({content:bundle.outputFiles[0].text});
   await page.evaluate(({mode,surface})=>{
    window.activeWindow=window;window.activeDocument=document;window.editorMode=mode;window.modalFocusActive=true;
    window.scopeRoot=document.querySelector('.modal-container');
    const root=window.scopeRoot;
    // Modal focus containment: an external floating editor loses focus to the modal.
    document.addEventListener('focusin',event=>{if(surface==='modal'&&window.modalFocusActive&&event.target!==document.body&&!root.contains(event.target))setTimeout(()=>document.querySelector('#modal-input').focus(),0);});
    if(surface==='native')mountNativeTaskEditor();
   },{mode,surface});
   await page.evaluate(({representation,initial})=>openCheckboxes(representation,initial,false),{representation,initial});
   const panel=page.locator('.operon-plain-checkbox-popover-panel');await panel.waitFor({state:'visible'});await page.waitForTimeout(80);
   assert.equal(await panel.evaluate(el=>window.scopeRoot.contains(el)),true,'popover belongs to the modal focus scope');
   assert.equal(await panel.evaluate(el=>el.parentElement===window.scopeRoot),true,'popover escapes transformed/clipped modal content');
   const editor=page.locator(mode==='codemirror'?'.operon-plain-checkbox-popover-cm-host .cm-content':'textarea.operon-plain-checkbox-popover-editor');
   assert.equal(await page.locator('.operon-plain-checkbox-popover-cm-host .cm-content').count(),mode==='codemirror'?1:0,'fixture uses the requested editor');
   if(initial)assert.ok(await editor.evaluate(el=>(el.value??el.textContent).includes('Existing checkbox')),'existing checkbox is loaded');
   await editor.click();await page.keyboard.press('End');await page.waitForTimeout(25);await page.keyboard.type(' Typed text');
   assert.ok(await editor.evaluate(el=>(el.value??el.textContent).includes('Typed text')),'typing reaches the popover');
   assert.equal(await page.locator('#modal-input').inputValue(),'','modal does not steal input');
   assert.equal(await page.evaluate(()=>writes),0,'typing is draft-only');
   const before=await panel.boundingBox();assert.ok(before.x>=0&&before.y>=0&&before.x+before.width<=width+1&&before.y+before.height<=901,'initial placement stays visible');const handle=page.locator('.operon-plain-checkbox-popover-drag-handle');const h=await handle.boundingBox();
   await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();await page.mouse.move(h.x+h.width/2+35,h.y+h.height/2-35,{steps:5});await page.mouse.up();
   const moved=await panel.boundingBox();assert.ok(Math.abs(moved.y-before.y)>15,'drag changes position');assert.ok(Math.abs(moved.x-before.x)<=36,'no coordinate-system jump');
   assert.equal(await panel.evaluate(el=>el.classList.contains('is-pinned')),true,'drag auto-pins');
   await page.mouse.move(moved.x+20,moved.y+25); // Use the actual handle again for an extreme drag.
   const next=await handle.boundingBox();await page.mouse.move(next.x+next.width/2,next.y+next.height/2);await page.mouse.down();await page.mouse.move(width+1000,1900,{steps:8});await page.mouse.up();
   const edge=await panel.boundingBox();assert.ok(edge.x>=10&&edge.y>=10&&edge.x+edge.width<=width-10&&edge.y+edge.height<=890,'drag clamps to viewport');
   await page.locator('.operon-plain-checkbox-popover-cancel').click();await panel.waitFor({state:'detached'});assert.equal(await page.evaluate(()=>writes),0,'Cancel discards draft with no write');
   // Reopening creates a fresh editor; ownership also supports the modal's Escape routing.
   await page.evaluate(({representation,initial})=>openCheckboxes(representation,initial,true),{representation,initial});await panel.waitFor({state:'visible'});await page.waitForTimeout(50);
   assert.equal(await page.evaluate(()=>closeOwnedCheckboxes()),true,'parent modal finds its own floating panel');await panel.waitFor({state:'detached'});
   if(surface==='modal'){
   // A pinned draft opened elsewhere must be adopted rather than recreated or lost.
   await page.evaluate(()=>{window.modalFocusActive=false;});
   await page.evaluate(({representation,initial})=>openCheckboxes(representation,initial,false,true),{representation,initial});await panel.waitFor({state:'visible'});await page.waitForTimeout(60);
   await editor.click();await page.keyboard.press('End');await page.keyboard.type(' Preserved draft');
   const outsideHandle=await handle.boundingBox();await page.mouse.move(outsideHandle.x+10,outsideHandle.y+10);await page.mouse.down();await page.mouse.move(outsideHandle.x+30,outsideHandle.y+30,{steps:3});await page.mouse.up();
   assert.equal(await panel.evaluate(el=>el.classList.contains('is-pinned')),true);
   await page.evaluate(()=>{window.oldPanel=document.querySelector('.operon-plain-checkbox-popover-panel');window.modalFocusActive=true;});
   await page.evaluate(({representation,initial})=>openCheckboxes(representation,initial,false),{representation,initial});await page.waitForTimeout(60);
   assert.equal(await panel.evaluate(el=>el===window.oldPanel&&window.scopeRoot.contains(el)),true,'same pinned panel adopted by Task Editor');
   assert.ok(await editor.evaluate(el=>(el.value??el.textContent).includes('Preserved draft')),'adoption preserves the unsaved draft');
   await editor.click();await page.waitForTimeout(25);await page.keyboard.type(' More');
   assert.ok(await editor.evaluate(el=>(el.value??el.textContent).includes('More')),'adopted panel accepts typing');
   await page.evaluate(()=>{window.other=unrelatedPanel();});await page.waitForTimeout(40);
   assert.equal(await page.evaluate(()=>cleanupOwnedCheckboxes()),true,'inner TaskEditorContent cleanup finds snapshot anchor');await panel.waitFor({state:'detached'});
   assert.equal(await page.locator('.unrelated-panel').count(),1,'unrelated panel survives cleanup');
   assert.equal(await page.evaluate(()=>writes),0,'adoption and cleanup do not write the task');
   await page.evaluate(()=>other.close());
   }
   assert.deepEqual(errors,[]);scenarios++;
  }finally{await page.close();}
 }
 console.log(JSON.stringify({ok:true,scenarios,coverage:'Production native-lightbox focus guard and standard modal; CodeMirror/textarea, inline/file, empty/existing, typing, draft-only Cancel, drag/pin/clamp, modal ownership and reopen'}));
}finally{await browser.close();}
