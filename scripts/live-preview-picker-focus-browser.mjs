import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require=createRequire(path.join(root,'package.json'));
const {build}=require('esbuild');
const {chromium}=require(process.env.OPERON_TEST_PLAYWRIGHT || 'playwright');
// Real renderer and CodeMirror; only the Obsidian host API is stubbed.
const entry = String.raw`import {EditorState} from '@codemirror/state';
import {EditorView, Decoration} from '@codemirror/view';
import {editorInfoField, editorLivePreviewField, Platform} from 'obsidian';
import {operonLivePreviewConcealExtension} from './src/ui/live-preview-conceal';
import {DEFAULT_SETTINGS} from './src/types/settings';
import {parseTaskLine} from './src/core/parser';
window.make = doc => {
 window.view?.destroy();
 document.querySelector('#host').textContent = '';
 const settings = structuredClone(DEFAULT_SETTINGS);
 Platform.isDesktopApp = true;
 const tasks = doc.split('\n').map((line, i) => parseTaskLine(line, i, 'Example.md', settings.keyMappings))
  .filter(Boolean).map(p => ({operonId:p.operonId, description:p.description, checkbox:p.checkbox,
   fieldValues:Object.fromEntries(p.fields.map(f => [f.key,f.value])), tags:p.tags,
   primary:{filePath:'Example.md', lineNumber:p.lineNumber, format:'inline'}, datetimeModified:'', tier:'hot'}));
 const callbacks = {
  app:{workspace:{on(){return {};}, offref(){}, getActiveViewOfType(){return null;}},
   metadataCache:{getFirstLinkpathDest(){return null;}}},
  getFilePath:() => 'Example.md', getSettings:() => settings,
  getPipelines:() => settings.pipelines, getPriorities:() => settings.priorities,
  getIndexedTask:id => tasks.find(t => t.operonId === id), getAllTasks:() => tasks,
  openEditor(){}, cycleStatus(){}, updateField(){window.taskWrites++;},
 };
 window.taskWrites = 0;
 const decoration = Decoration.line({class:'HyperMD-list-line HyperMD-task-line HyperMD-list-line-1'}).range(0);
 window.view = new EditorView({parent:document.querySelector('#host'),state:EditorState.create({
  doc, selection:{anchor:doc.length}, extensions:[editorInfoField, editorLivePreviewField,
   EditorView.lineWrapping, operonLivePreviewConcealExtension(callbacks),
   EditorView.decorations.of(Decoration.set([decoration]))],
 })});
};
`;
const bundle=await build({stdin:{resolveDir:root,loader:'ts',contents:entry},bundle:true,format:'iife',write:false,alias:{obsidian:path.join(root,'scripts/test-support/obsidian.ts')},logLevel:'silent'});
const browser=await chromium.launch({headless:true,...(process.env.OPERON_TEST_BROWSER ? {executablePath:process.env.OPERON_TEST_BROWSER} : {})});
let clicks=0;
try {
 const page=await browser.newPage({viewport:{width:1100,height:1600}});
 await page.setContent('<body class="theme-light"><div class="markdown-source-view mod-cm6 is-live-preview cm-s-obsidian"><div id="host"></div></div></body>');
await page.addStyleTag({path:path.join(root,'styles.css')});
 await page.addStyleTag({content:'body{overflow:auto}#host{margin:40px}.cm-content{font:16px/1.5 sans-serif}.cm-line{position:relative}.svg-icon{width:16px;height:16px}'});
 await page.addScriptTag({content:"window.activeWindow=window;window.activeDocument=document;Object.defineProperty(Document.prototype,'win',{get(){return this.defaultView}});function decorate(el,opts){if(typeof opts==='string')el.className=opts;else if(opts){if(opts.cls)el.className=opts.cls;if(opts.text)el.textContent=opts.text;for(const[k,v]of Object.entries(opts.attr||{}))el.setAttribute(k,v)}return el}window.createEl=(tag,opts)=>decorate(document.createElement(tag),opts);window.createSpan=opts=>window.createEl('span',opts);window.createDiv=opts=>window.createEl('div',opts);HTMLElement.prototype.createEl=function(tag,opts){const e=window.createEl(tag,opts);this.append(e);return e};HTMLElement.prototype.createSpan=function(o){return this.createEl('span',o)};HTMLElement.prototype.createDiv=function(o){return this.createEl('div',o)};HTMLElement.prototype.addClass=function(...c){this.classList.add(...c)};HTMLElement.prototype.removeClass=function(...c){this.classList.remove(...c)};HTMLElement.prototype.setCssProps=function(o){for(const[k,v]of Object.entries(o))this.style.setProperty(k,v)};HTMLElement.prototype.empty=function(){this.replaceChildren()};HTMLElement.prototype.setText=function(t){this.textContent=t};window.__operonTestSetIcon=(target)=>{target.innerHTML='<svg class=\"svg-icon\" width=\"16\" height=\"16\"><circle cx=\"8\" cy=\"8\" r=\"6\"/></svg>'};"});
 await page.addScriptTag({content:bundle.outputFiles[0].text});
 await page.evaluate(()=>{window.activeDocument=document;window.activeWindow=window;});


 page.setDefaultTimeout(5000);
 const errors=[];page.on('pageerror',e=>errors.push(e.stack));
 const cases=[
  ['empty note','', '.operon-live-preview-note-action','.operon-text-field-popover-panel'],
  ['existing note',' {{note:: Existing note}}','.operon-live-preview-note-action','.operon-text-field-popover-panel'],
  ['priority','','.operon-chip-priority','.operon-priority-picker-panel'],
  ['scheduled date',' {{dateScheduled:: 2026-10-29}}','.operon-chip-date','.operon-date-picker-panel'],
 ];
 for(const width of [420,1000])for(const dark of [false,true])for(const [name,metadata,selector,panel] of cases){
  await page.evaluate(({width,dark})=>{document.body.className=dark?'theme-dark':'theme-light';document.querySelector('#host').style.width=width+'px';},{width,dark});
  const doc='- [ ] Example task {{operonId:: ab00001}} {{priority:: A}}'+metadata+'\nOther line';
  await page.evaluate(doc=>make(doc),doc);
  await page.evaluate(()=>{
   view.focus();window.editorMouseEvents=0;window.controlMouseEvent=null;
   // Observe the control boundary, including nested SVG targets, with real mouse events.
   view.dom.addEventListener('mousedown',()=>window.editorMouseEvents++);
   document.addEventListener('mousedown',event=>{
    if(event.target.closest?.('.operon-task-chip,.operon-live-preview-note-action')){
     window.controlMouseEvent=event;
    }
   },{capture:true,once:true});
  });
  await page.locator('.operon-live-preview-tail-row').hover();
  await page.waitForTimeout(150);
  const head=await page.evaluate(()=>view.state.selection.main.head);
  await page.locator(selector).click();
  if(await page.locator(selector).evaluate(el=>el.classList.contains('is-peek-open'))) await page.locator(selector).click();
  await page.locator(panel).waitFor({state:'visible'}).catch(async error=>{console.error({name,errors,html:await page.locator('.operon-floating-panel').evaluateAll(es=>es.map(e=>e.outerHTML.slice(0,200)))});throw error;});
  await page.waitForTimeout(50);
  const result=await page.evaluate(()=>({head:view.state.selection.main.head,doc:view.state.doc.toString(),writes:taskWrites,tails:document.querySelectorAll('.operon-live-preview-tail').length,propagated:editorMouseEvents,prevented:controlMouseEvent?.defaultPrevented}));
  assert.equal(result.prevented,true,name+' consumes native caret movement');
  assert.equal(result.propagated,0,name+' does not reach host editor mouse handlers');
  assert.equal(result.head,head,name+' keeps the document selection');
  assert.equal(result.tails,1,name+' keeps metadata rendered while picker is open');
  assert.equal(result.doc,doc,name+' opening does not write the document');
  assert.equal(result.writes,0,name+' opening does not call the task writer');
  await page.keyboard.press('Escape');
  await page.locator(panel).waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>view.state.doc.toString()),doc,name+' Escape does not write');
  if(name.includes('note')) {
   await page.locator(selector).focus();
   await page.keyboard.press('Enter');
   await page.locator(panel).waitFor({state:'visible'});
   await page.waitForTimeout(50);
   assert.equal(await page.locator('.operon-live-preview-tail').count(),1,'keyboard activation preserves the rendered task');
   await page.keyboard.press('Escape');
   await page.locator(panel).waitFor({state:'detached'});
   assert.equal(await page.evaluate(()=>taskWrites),0,'keyboard open/close does not write');
   clicks++;
  }
  // Explicit keyboard navigation into metadata must still reveal the editable source.
  await page.evaluate(()=>{view.focus();view.dispatch({selection:{anchor:view.state.doc.toString().indexOf('{{operonId')}}); });
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('.operon-live-preview-tail').count(),0,name+' deliberate raw editing remains available');
  await page.keyboard.type('x');
  assert.notEqual(await page.evaluate(()=>view.state.doc.toString()),doc,'raw source remains editable');
  clicks++;
 }
 assert.deepEqual(errors,[],'no browser errors');
 console.log(JSON.stringify({ok:true,scenarios:clicks,coverage:'Notes empty/existing, priority/date pickers, mouse boundary, no-write Escape and deliberate raw editing; narrow/wide and light/dark'}));
} finally {await browser.close();}
