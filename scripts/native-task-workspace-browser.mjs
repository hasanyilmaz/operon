import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.OPERON_TEST_PLAYWRIGHT || 'playwright');
const bundle = await build({ stdin: { contents: `export * from './src/ui/lightbox-opening-perf'; export * from './src/ui/native-task-workspace'; export * from './src/ui/web-lightbox'; export * from './src/ui/lightbox'; export * from './src/core/lightbox-size'; export * from './src/ui/modal-backdrop'; export {Platform} from 'obsidian';`, resolveDir: root }, define: { OPERON_LIGHTBOX_PERF_ENABLED: 'true' }, bundle: true, write: false, format: 'iife', globalName: 'Subject', platform: 'browser', logLevel: 'silent', alias: { obsidian: path.join(root, 'scripts/test-support/obsidian.ts') } });
const browser = await chromium.launch({ headless: true, ...(process.env.OPERON_TEST_BROWSER ? { executablePath: process.env.OPERON_TEST_BROWSER } : {}) });
let checks = 0;
try {
 const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
 const errors = []; page.on('pageerror', error => errors.push(error.message));
 await page.setContent(`<style>body{margin:0;--background-primary:#222;--background-secondary:#292929;--background-modifier-border:#777;--text-normal:#eee;--layer-modal:50}button{box-sizing:border-box}</style><style>${readFileSync(path.join(root, 'styles.css'), 'utf8')}</style><button id="anchor">Source</button>`);
 await page.evaluate(() => {
  document.win = window; window.activeDocument = document; window.activeWindow = window;
  Object.defineProperty(Node.prototype, 'doc', {get() { return this.ownerDocument || document; }});
  Object.defineProperty(Node.prototype, 'win', {get() { return this.doc.defaultView; }});
  Object.defineProperty(Object.prototype, 'instanceOf', {value(cls) {return this instanceof cls;}, configurable:true});
  Element.prototype.createEl = function(tag, options) { const el = document.createElement(tag); if (typeof options === 'string') el.className = options; else if (options) {if (options.cls) el.className = options.cls; if (options.text) el.textContent = options.text; for (const [k,v] of Object.entries(options.attr || {})) el.setAttribute(k,v);} this.appendChild(el); return el; };
  Element.prototype.createDiv = function(options) { return this.createEl('div',options); };
  Element.prototype.createSpan = function(options) { return this.createEl('span',options); };
  Element.prototype.addClass = function(...names) {this.classList.add(...names);};
  Element.prototype.removeClass = function(...names) {this.classList.remove(...names);};
  Element.prototype.toggleClass = function(name,on) {this.classList.toggle(name,on);};
  Element.prototype.setText = function(text) {this.textContent=text;};
  Element.prototype.setCssStyles = function(styles) {Object.assign(this.style,styles);};
  Element.prototype.empty = function() {this.replaceChildren();};
  window.createSpan = o => document.body.createSpan(o); window.createEl = (t,o) => document.body.createEl(t,o);
 });
 await page.addScriptTag({content:bundle.outputFiles[0].text});
 await page.evaluate(() => {
  const S=Subject; S.Platform.isDesktopApp=true;
  window.writes=[]; window.editors=[]; window.leaves=[]; window.closed=0; window.confirmations=0; window.closedHistory=[];
  S.bindLightboxSizePreference({get:()=>({markdown:{width:70,height:90}}),save:async(...args)=>writes.push(args)});
  window.files = Object.fromEntries(['A','B','Normal','Inline'].map(name=>[name,{path:name+'.md',name:name+'.md',extension:'md'}]));
  window.tasks = new Map([[files.A,'taskA'],[files.B,'taskB']]);
  window.stored = new Map(Object.values(files).map(file=>[file.path,'---\nid: '+file.path+'\n---\nBody']));
  const group={children:[],currentTab:0,containerEl:document.body.createDiv(),selectTabIndex(i){this.currentTab=i;},recomputeChildrenDimensions(){for(const leaf of this.children)this.containerEl.appendChild(leaf.containerEl);}};
  const originRoot=group.containerEl.createDiv('workspace-leaf');
  const origin={id:'origin',parent:group,containerEl:originRoot,getRoot:()=>group,getContainer:()=>document.body,view:{containerEl:originRoot.createDiv(),getViewType:()=> 'markdown'}}; group.children.push(origin);
  window.makeEditor = (id,height=260) => {
   const editor={id,isEdited:false,fail:false,destroyed:0,saves:0,input:null,
    mountInto(host){
     this.mountWidth=host.parentElement.getBoundingClientRect().width; this.initialRender=window.editorRenderWait||Promise.resolve();
     host.addClass('operon-task-editor'); const shell=host.createDiv('operon-task-editor-shell'); const main=shell.createDiv('operon-task-editor-main-panel');
     // Match the primary section classes: their explicit visibility can escape a hidden ancestor.
     for(const name of ['description','notes','stats']){
      const section=main.createDiv('operon-task-editor-section-host operon-task-editor-primary-fields'); section.dataset.editorSection=name;
      if(name==='description')this.input=section.createEl('input',{attr:{value:id}});
      else section.createSpan({text:name});
     }
     main.createDiv().style.height=height+'px';
    },
    whenInitialRenderReady(){return this.initialRender;},
    applyInitialDescriptionFocus(){this.input?.focus();}, focusDescription(){this.input?.focus();},
    async prepareCloseSave(){this.saves++; if(this.wait)await this.wait; if(this.fail)return {ok:false,reason:'write-rejected'}; this.isEdited=false; return {ok:true,clean:true,status:'saved'};},
    destroy(){this.destroyed++;}};
   editors.push(editor); return editor;
  };
  window.app={vault:{read:async file=>stored.get(file.path)},workspace:{containerEl:document.body,activeLeaf:origin,getMostRecentLeaf(){return this.activeLeaf||origin;},getLeafById:id=>id==='origin'?origin:leaves.find(leaf=>leaf.id===id&&leaf.view.containerEl.isConnected),getLeavesOfType:()=>[origin],iterateAllLeaves(fn){fn(origin);},getLayout:()=>({active:'origin'}),setActiveLeaf(leaf){this.activeLeaf=leaf;},createLeafInParent(parent){
   const host=parent.tabsContainerEl||parent.containerEl||document.body;
   const root=host.createDiv('workspace-leaf');
   const view={containerEl:root.createDiv('workspace-leaf-content'),file:null,data:'',lastSavedData:'',type:'markdown',getViewType(){return this.type;},getViewData(){return this.data;},setViewData(text,clear){this.data=text;this.cleared=clear;},getMode(){return 'source';},editor:{setCursor(position){view.cursor=position;}},currentMode:{applyScroll(position){view.scroll=position;}},onResize(){},getEphemeralState:()=>({}),setEphemeralState(state){this.ephemeral=state;},async save(){stored.set(this.file.path,this.data);this.lastSavedData=this.data;}};
   const leaf={id:'leaf-'+leaves.length,parent,containerEl:root,view,getRoot:()=>group,getContainer:()=>document.body,getViewState:()=>({type:view.type,state:{file:view.file?.path}}),async setViewState(state){if(window.failNative)throw Error('native open failed');if(window.navigationWait)await window.navigationWait;view.type=state.type;view.file=Object.values(files).find(f=>f.path===state.state?.file)||null;view.data=view.file?stored.get(view.file.path):'';view.lastSavedData=view.data;},async openFile(file,options){await this.setViewState({type:'markdown',state:{file:file.path}});view.setEphemeralState(options.eState);},async loadIfDeferred(){},detach(){if(this.getViewState().type!=='empty')closedHistory.push(this.getViewState());root.remove();}};
   parent.children.push(leaf);leaves.push(leaf);return leaf;
  }}};
  window.position='right';window.provider={position:()=>window.position,async locate(id){const file=id==='inline1'?files.Inline:Array.from(tasks).find(([,key])=>key===id)?.[0];return file?{file,operonId:id}:null;},async resolve(file,id){if(window.resolveWait)await window.resolveWait;const key=id||(tasks.get(file));return key?{file,operonId:key}:null;},async create(task){if(window.createWait)await window.createWait;return makeEditor(task.operonId);},async confirmDiscard(){confirmations++;return window.discard===true;},closed(){closed++;}};
  S.registerNativeTaskWorkspace(app,provider);
  window.open = async(mode='file') => {const file=(mode==='inline'||mode==='sourceInline')?files.Inline:files.A;document.getElementById('anchor').focus();if(mode==='source'||mode==='sourceInline')S.openFileLightbox(app,document.getElementById('anchor'),{file,subpath:'',operonId:mode==='sourceInline'?'inline1':undefined});else await S.openTaskWorkspace(app,document.getElementById('anchor'),{file,subpath:'',operonId:mode==='inline'?'inline1':'taskA'}, {task:{file,operonId:mode==='inline'?'inline1':'taskA'},content:makeEditor(mode==='inline'?'inline1':'taskA'),markdown:mode==='file'});};
  window.currentEditor=()=>editors.filter(editor=>!editor.destroyed).at(-1);
  window.currentLeaf=()=>leaves.filter(leaf=>leaf.view.containerEl.isConnected).at(-1);
  window.visibleShell=()=>S.getActiveLightboxShell(document);
  window.visibleControls=()=>Array.from(visibleShell().querySelectorAll(':scope > button')).filter(button=>getComputedStyle(button).display!=='none');
  window.controlLayoutErrors=()=>{
   const shell=visibleShell();shell.classList.add('are-controls-hovered');
   const side=shell.dataset.testSide||'right';
   const errors=[],near=(a,b)=>Math.abs(a-b)<1,rect=el=>el.getBoundingClientRect();
   const all=Array.from(shell.querySelectorAll(':scope > button'));
   for(const button of all)if(button.hidden&&(getComputedStyle(button).display!=='none'||button.getClientRects().length))errors.push('hidden control is rendered: '+button.className);
   const buttons=visibleControls(),rects=buttons.map(rect);
   for(const [i,a] of rects.entries()){
    if(a.width<=0||a.height<=0||a.left<0||a.top<0||a.right>innerWidth+1||a.bottom>innerHeight+1)errors.push('outside viewport: '+buttons[i].className);
    for(let j=i+1;j<rects.length;j++){const b=rects[j];if(a.left<b.right-.1&&b.left<a.right-.1&&a.top<b.bottom-.1&&b.top<a.bottom-.1)errors.push('overlapping controls');}
   }
   const md=shell.querySelector('.is-markdown'),editor=shell.querySelector('.operon-native-task-panel');
   const mdVisible=md&&getComputedStyle(md).display!=='none',editorVisible=editor&&getComputedStyle(editor).display!=='none';
   const frame=rect(mdVisible?md:editor),main=buttons.filter(b=>!b.classList.contains('operon-lightbox-size-control'));
   const top=main.filter(b=>!b.matches('.operon-lightbox-dimming-control'));
   const toggles=top.filter(b=>b.matches('.operon-workspace-toggle'));
   const middle=['increase','decrease'].map(action=>shell.querySelector('.operon-lightbox-height-'+action)).filter(b=>b&&!b.hidden),bottom=main.filter(b=>b.matches('.operon-lightbox-dimming-control'));
   const expectedTop=[shell.querySelector('.operon-task-media-lightbox-close'),...shell.querySelectorAll('.operon-workspace-toggle'),...['tab','split','split-below'].map(action=>shell.querySelector('.operon-task-media-lightbox-'+action))].filter(b=>b&&!b.hidden);
   if(top.some((button,index)=>button!==expectedTop[index])||top.length!==expectedTop.length)errors.push('close, toggles, file actions order');
   for(let i=1;i<top.length;i++)if(rect(top[i-1]).bottom>rect(top[i]).top)errors.push('top group ordering');
   const first=rect(top[0]);
   if(!near(first.top,frame.top+8))errors.push('top anchor');
   if(bottom.length&&!near(rect(bottom.at(-1)).bottom,frame.bottom-8))errors.push('bottom anchor');
   if(middle.length&&!near((rect(middle[0]).top+rect(middle.at(-1)).bottom)/2,(frame.top+frame.bottom)/2))errors.push('middle anchor');
   for(const b of [...main,...middle])if(!near(rect(b).left+rect(b).width/2,first.left+first.width/2))errors.push('main rail column');
   if(mdVisible&&editorVisible&&!(side==='right'?near(first.left-frame.right,rect(editor).left-first.right):near(frame.left-first.right,first.left-rect(editor).right)))errors.push('unequal gutter');
   if(!mdVisible){
    if(bottom.length!==0)errors.push('dimming in editor-only state');
    if(top.length!==2||buttons.some(b=>b.matches('.operon-lightbox-size-control')))errors.push('source controls in editor-only state');
   }else{
    const high=rect(shell.querySelector('.operon-lightbox-height-increase')),low=rect(shell.querySelector('.operon-lightbox-height-decrease'));
    if(!near(high.left,first.left)||!near(low.left,high.left)||high.bottom>low.top||!near((high.top+low.bottom)/2,(frame.top+frame.bottom)/2))errors.push('shared middle height controls');
    const narrow=rect(shell.querySelector('.operon-lightbox-width-decrease')),wide=rect(shell.querySelector('.operon-lightbox-width-increase'));
    const pairWidth=wide.right-narrow.left,expectedLeft=Math.max(8,Math.min(innerWidth-pairWidth-8,(frame.left+frame.right-pairWidth)/2));
    if(narrow.top<frame.bottom||!near(narrow.top,wide.top)||narrow.right>wide.left||!near(narrow.left,expectedLeft))errors.push('source width controls');
   }
   for(const pane of [mdVisible?md:null,editorVisible?editor:null].filter(Boolean)){
    const b=rect(pane);if(rects.some(a=>a.left<b.right-.1&&b.left<a.right-.1&&a.top<b.bottom-.1&&b.top<a.bottom-.1))errors.push('control overlaps pane');
   }
   for(const b of buttons)if(getComputedStyle(b).borderTopRightRadius!=='6px')errors.push('control radius');
   if(mdVisible&&getComputedStyle(md).borderTopRightRadius!=='6px')errors.push('source radius');
   for(const b of toggles)if(b.hasAttribute('title')||b.hasAttribute('aria-label')||!b.getAttribute('aria-labelledby')||!b._operonHoverCleanup)errors.push('toggle tooltip ownership');
   return errors;
  };

  window.findLabel=label=>[...visibleShell().querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===label||b.querySelector('[data-operon-accessible-label]')?.textContent===label);
  window.clickLabel=label=>findLabel(label).click();
  window.closeAll=async()=>{S.disposeWebLightboxes(app);await new Promise(resolve=>setTimeout(resolve,0));};
 });
 const check=async(fn,expected,message)=>{assert.deepEqual(await page.evaluate(fn),expected,message ?? String(fn));checks++;};
 const layout=async label=>{await page.waitForTimeout(60);await check(()=>controlLayoutErrors(),[],label);};
 const ready=()=>page.waitForFunction(()=>window.visibleShell()&&!visibleShell().classList.contains('is-workspace-loading'));
 await page.evaluate(()=>open()); await ready();
 await check(()=>{const s=visibleShell(),m=s.querySelector('.is-markdown').getBoundingClientRect(),e=s.querySelector('.operon-native-task-panel').getBoundingClientRect();return [m.top===e.top,m.right<e.left,e.right<innerWidth,e.height<m.height,editors.length,document.activeElement===editors[0].input];},[true,true,true,true,1,true],'paired geometry, compact editor and initial focus');
 await check(()=>visibleShell().classList.contains('are-controls-pending'),false,'initial ready panel enables hover immediately');
 await page.mouse.move(8,8);
 await check(()=>Array.from(visibleShell().querySelectorAll('.operon-task-media-lightbox-control')).every(b=>getComputedStyle(b).opacity==='1'),true,'backdrop hover reveals ready controls immediately');
 await page.evaluate(()=>visibleShell().focus());await page.keyboard.press('Tab');
 await check(()=>document.activeElement.matches('.operon-task-media-lightbox-control:focus-visible')&&getComputedStyle(document.activeElement).opacity==='1',true,'keyboard focus reveals controls without waiting');
 await page.evaluate(()=>editors[0].input.focus());
 await page.waitForFunction(()=>!visibleShell().classList.contains('are-controls-pending'));
 await check(()=>writes.length,0,'mount writes no size preference');
 await layout('paired controls use top toggles, equal gutter and shared middle height controls');
 await check(()=>visibleControls().length,12);
 await page.evaluate(()=>{window.tall=visibleShell().querySelector('.operon-task-editor-main-panel').createDiv();tall.style.height='2000px';});await page.waitForTimeout(60);
 await check(()=>{const s=visibleShell(),m=s.querySelector('.is-markdown').getBoundingClientRect(),e=s.querySelector('.operon-native-task-panel').getBoundingClientRect(),main=s.querySelector('.operon-task-editor-main-panel');return [e.height<=m.height,main.scrollHeight>main.clientHeight,main.getBoundingClientRect().bottom<=e.bottom+1];},[true,true,true],'long editor content scrolls within the shared height');
 await page.evaluate(()=>tall.remove());await page.waitForTimeout(60);
 await check(()=>{const s=visibleShell();return s.querySelector('.operon-native-task-panel').getBoundingClientRect().height<s.querySelector('.is-markdown').getBoundingClientRect().height;},true,'shortened editor contracts to its content');
 await page.evaluate(()=>{editors[0].input.value='draft';clickLabel('Hide source');});
 await check(()=>[visibleShell().querySelector('.is-markdown').hidden,editors[0].destroyed,editors[0].input.value],[true,0,'draft']);
 await layout('editor-only controls omit transfers and both sizing pairs');
 await check(()=>visibleControls().length,2);
 await check(()=>{const hidden=Array.from(visibleShell().querySelectorAll(':scope > button[hidden]'));currentEditor().input.focus();return hidden.every(b=>{b.focus();return document.activeElement!==b;});},true,'hidden buttons cannot receive focus');
 await page.evaluate(()=>clickLabel('Show source'));await page.waitForTimeout(30);
 await check(()=>visibleShell().classList.contains('are-controls-pending'),false,'panel toggle leaves hover ready');
 await page.evaluate(()=>clickLabel('Hide task editor'));
 await check(()=>{const s=visibleShell(),m=s.querySelector('.is-markdown').getBoundingClientRect();return [s.querySelector('.operon-native-task-panel').hidden,Math.abs(m.left-(innerWidth-m.width)/2)<1,editors.length];},[true,true,1]);
 await layout('source-only controls do not render the hidden source toggle');
 await check(()=>visibleControls().length,11);
 await page.evaluate(()=>clickLabel('Show task editor'));
 await check(()=>[editors.length,editors[0].input.value],[1,'draft']);
 await page.setViewportSize({width:500,height:700}); await page.waitForTimeout(60);
 await check(()=>{const s=visibleShell(),e=s.querySelector('.operon-native-task-panel').getBoundingClientRect();return [s.querySelector('.is-markdown').hidden,e.right<=innerWidth,writes.length,Array.from(s.querySelectorAll(':scope > button')).filter(b=>getComputedStyle(b).display!=='none').every(b=>b.getBoundingClientRect().right<=e.left)];},[true,true,0,true],'extreme width reserves the rail outside the editor');
 await layout('extreme-width editor-only gutter');
 await page.setViewportSize({width:1600,height:1000});await page.waitForTimeout(60);
 await check(()=>visibleShell().querySelector('.is-markdown').hidden,false);
 await layout('restored width returns controls to the correct zones');
 await page.evaluate(()=>visibleShell().querySelector('.operon-lightbox-width-decrease').click());
 await check(()=>writes,[['markdown','width',65]]);
 await page.evaluate(()=>{editors[0].fail=true;editors[0].isEdited=true;});
 await page.evaluate(()=>leaves[0].setViewState({type:'markdown',state:{file:files.B.path}}));
 await check(()=>[leaves[0].view.file.path,editors[0].destroyed,confirmations],['A.md',0,0],'failed transition keeps draft without new dialog');
 await page.evaluate(()=>{editors[0].fail=false;return leaves[0].setViewState({type:'markdown',state:{file:files.B.path}});});
 await check(()=>[leaves[0].view.file.path,editors[0].destroyed,currentEditor().id],['B.md',1,'taskB']);
 await page.evaluate(()=>leaves[0].setViewState({type:'markdown',state:{file:files.Normal.path}}));
 await check(()=>[visibleShell().querySelector('.operon-native-task-panel').hidden,findLabel('Show task editor')?.hidden ?? true],[true,true]);
 await layout('normal note has no stray panel toggle');
 await page.evaluate(()=>leaves[0].setViewState({type:'markdown',state:{file:files.A.path}}));
 await check(()=>[currentEditor().id,visibleShell().querySelector('.operon-native-task-panel').hidden],['taskA',false]);
 await page.evaluate(()=>{clickLabel('Hide task editor');return leaves[0].setViewState({type:'markdown',state:{file:files.B.path}});});
 await check(()=>visibleShell().querySelector('.operon-native-task-panel').hidden,true,'manual hiding survives navigation');
 await page.evaluate(()=>clickLabel('Show task editor'));await page.waitForTimeout(30);
 await check(()=>currentEditor().id,'taskB');
 await page.evaluate(()=>closeAll());
 await check(()=>[document.querySelectorAll('.operon-task-media-lightbox').length,closedHistory.length],[0,0],'owned leaf never enters closed tabs');
 await page.evaluate(()=>open('source'));await ready();
 await check(()=>visibleShell().querySelector('.operon-native-task-panel').hidden,true);
 await page.evaluate(()=>currentLeaf().setViewState({type:'markdown',state:{file:files.B.path}}));
 await check(()=>visibleShell().querySelector('.operon-native-task-panel').hidden,true,'source-only persists on navigation');
 await page.evaluate(()=>clickLabel('Show task editor'));await page.waitForTimeout(30);
 await check(()=>currentEditor().id,'taskB');
 await page.evaluate(()=>closeAll());
 await page.evaluate(()=>open('inline'));await ready();
 await check(()=>[visibleShell().querySelector('.is-markdown').hidden,currentEditor().id],[true,'inline1']);
 await page.evaluate(()=>clickLabel('Show source'));await page.waitForTimeout(30);
 await page.evaluate(()=>currentLeaf().setViewState({type:'markdown',state:{file:files.Inline.path,mode:'preview'}}));
 await check(()=>[currentEditor().id,visibleShell().querySelector('.operon-native-task-panel').hidden],['inline1',false],'same-file mode keeps inline identity');
 // Keep every working level painted while only the top accepts interaction.
 await page.evaluate(()=>{
  window.parentShell=visibleShell();window.parentEditor=currentEditor();
  parentEditor.input.value='parent draft';parentEditor.input.focus();
  window.navigationWait=new Promise(resolve=>window.releaseChild=resolve);
  window.childOpening=Subject.openTaskWorkspace(app,parentEditor.input,{file:files.B,subpath:''},{task:{file:files.B,operonId:'taskB'},content:makeEditor('taskB'),markdown:true});
 });
 await check(()=>{
  const child=visibleShell(), md=parentShell.querySelector('.is-markdown'),editor=parentShell.querySelector('.operon-native-task-panel');
  return [parentShell.hidden,parentShell.inert,getComputedStyle(parentShell).visibility,
   md.getBoundingClientRect().width>0,editor.getBoundingClientRect().width>0,
   child.classList.contains('is-workspace-loading'),getComputedStyle(child).visibility,
   getComputedStyle(child).backgroundColor,getComputedStyle(child.querySelector('.operon-native-task-panel')).visibility];
 },[false,true,'visible',true,true,true,'visible','rgba(0, 0, 0, 0.55)','hidden'],'parent stays painted behind the child backdrop during native loading');
 await page.evaluate(async()=>{navigationWait=null;releaseChild();await childOpening;});await ready();
 await check(()=>[document.querySelectorAll('.operon-task-media-lightbox').length,document.querySelectorAll('.operon-task-media-lightbox[hidden]').length,parentEditor.destroyed],[2,0,0]);
 await check(()=>{const active=document.activeElement;parentEditor.input.focus();return document.activeElement===active&&parentShell.inert;},true,'background editor cannot take focus');
 await page.evaluate(async()=>{
  window.childShell=visibleShell();window.childEditor=currentEditor();childEditor.input.focus();
  await Subject.openTaskWorkspace(app,childEditor.input,{file:files.Inline,subpath:''},{task:{file:files.Inline,operonId:'inline1'},content:makeEditor('inline1'),markdown:false});
 });await ready();
 await check(()=>[parentShell.inert,childShell.inert,visibleShell().inert,
  document.querySelectorAll('.operon-task-media-lightbox[hidden]').length,
  getComputedStyle(visibleShell()).backgroundColor,
  visibleShell().querySelector('.is-markdown').hidden],[true,true,false,0,'rgba(0, 0, 0, 0.6)',true],'inline child adds one layer above the retained pair');
 await page.keyboard.press('Escape');await page.waitForTimeout(30);
 await check(()=>[visibleShell()===childShell,childShell.inert,parentShell.inert,getComputedStyle(childShell).backgroundColor,document.activeElement===childEditor.input],[true,false,true,'rgba(0, 0, 0, 0.55)',true],'Escape removes only the top layer');
 await page.evaluate(()=>visibleShell().querySelector('.operon-task-media-lightbox-close').click());await page.waitForTimeout(30);
 await check(()=>[document.querySelectorAll('.operon-task-media-lightbox').length,parentEditor.input.value,document.activeElement===parentEditor.input],[1,'parent draft',true]);
 await check(()=>[parentShell.inert,getComputedStyle(parentShell).backgroundColor],[false,'rgba(0, 0, 0, 0.5)'],'parent interaction and base dimming restored');
 await page.setViewportSize({width:1000,height:350});await page.waitForTimeout(60);
 await check(()=>{const controls=Array.from(visibleShell().querySelectorAll(':scope > button')).filter(e=>getComputedStyle(e).display!=='none');const rects=controls.map(e=>e.getBoundingClientRect());return rects.every(r=>r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1)&&rects.every((a,i)=>rects.every((b,j)=>i===j||a.right<=b.left+.1||b.right<=a.left+.1||a.bottom<=b.top+.1||b.bottom<=a.top+.1));},true,'short window controls remain inside viewport without overlap');
 await layout('short window preserves all region anchors without overlap');
 await page.setViewportSize({width:1600,height:1000});await page.waitForTimeout(40);
 // Existing close failure/discard behavior is retained, without losing the source.
 await page.evaluate(()=>{currentEditor().fail=true;currentEditor().isEdited=true;visibleShell().querySelector('.operon-task-media-lightbox-close').click();});await page.waitForTimeout(30);
 await check(()=>[!!visibleShell(),confirmations],[true,1]);
 await page.evaluate(()=>{currentEditor().fail=false;});
 // Renaming keeps the same native file object and editor instance.
 await page.evaluate(()=>{files.Inline.path='Renamed.md';stored.set(files.Inline.path,currentLeaf().view.data);return currentLeaf().setViewState({type:'markdown',state:{file:files.Inline.path}});});
 await check(()=>[currentEditor()===parentEditor,currentLeaf().view.file.path],[true,'Renamed.md']);
 // A move to another file follows the identity, not the old line or path.
 await page.evaluate(()=>{files.Moved={path:'Moved.md',name:'Moved.md',extension:'md'};stored.set('Moved.md','moved body');provider.locate=async id=>({file:files.Moved,operonId:id,line:0,caretCh:0});parentEditor.input.dispatchEvent(new CustomEvent('operon-editor-source-location',{bubbles:true,detail:{operonId:'inline1',filePath:'Moved.md'}}));});
 await page.waitForFunction(()=>currentLeaf().view.file===files.Moved);
 await check(()=>[currentEditor()===parentEditor,currentLeaf().view.file.path],[true,'Moved.md']);
 // Other native view types retain their own size controls after Markdown navigation.
 await page.evaluate(()=>currentLeaf().setViewState({type:'bases',state:{file:files.A.path}}));
 await check(()=>[visibleShell().querySelector('.operon-native-task-panel').hidden,visibleShell().querySelector('.is-base').style.left],[true,'']);
 await page.evaluate(()=>visibleShell().querySelector('.operon-lightbox-width-decrease').click());
 await check(()=>writes.at(-1).slice(0,2),['base','width']);
 await page.evaluate(()=>currentLeaf().setViewState({type:'markdown',state:{file:files.A.path}}));
 await layout('native view round trip restores paired rail placement');
 await page.evaluate(()=>closeAll());
 // Both save paths participate in a transfer; a failed draft never creates a destination.
 await page.evaluate(()=>open());await ready();
 await page.evaluate(()=>{window.transferEditor=currentEditor();transferEditor.fail=true;transferEditor.isEdited=true;window.leafCount=leaves.length;visibleShell().querySelector('.operon-task-media-lightbox-tab').click();});await page.waitForTimeout(30);
 await check(()=>[!!visibleShell(),leaves.length===leafCount,confirmations],[true,true,1]);
 await page.evaluate(()=>{transferEditor.fail=false;currentLeaf().view.data='native pending edit';visibleShell().querySelector('.operon-task-media-lightbox-tab').click();});
 await page.waitForFunction(()=>!visibleShell());
 await check(()=>[transferEditor.destroyed,stored.get(files.A.path),app.workspace.activeLeaf.view.data,closedHistory.length],[1,'native pending edit','native pending edit',0]);
 await page.evaluate(()=>open('sourceInline'));await ready();
 await page.evaluate(()=>clickLabel('Show task editor'));await page.waitForTimeout(30);
 await check(()=>currentEditor().id,'inline1','source opening retains the explicit inline identity in a normal note');
 await page.evaluate(()=>closeAll());
 // Repeat visibility transitions and size steps with the actual stylesheet.
 await page.setViewportSize({width:1600,height:1000});
 await page.evaluate(()=>open());await ready();
 for(let i=0;i<2;i++){
  await page.evaluate(()=>clickLabel('Hide source'));await layout('repeat editor-only');
  await page.evaluate(()=>clickLabel('Show source'));await layout('repeat paired');
  await page.evaluate(()=>clickLabel('Hide task editor'));await layout('repeat source-only');
  await page.evaluate(()=>clickLabel('Show task editor'));await layout('repeat paired again');
 }
 await page.evaluate(()=>{visibleShell().querySelector('.operon-lightbox-height-decrease').click();visibleShell().querySelector('.operon-lightbox-width-decrease').click();});
 await layout('user size changes keep height controls in the shared rail and width controls below source');
 await check(()=>writes.slice(-2).map(write=>write.slice(0,2)),[['markdown','height'],['markdown','width']]);
 const savedCount=await page.evaluate(()=>writes.length);
 for(const width of [850,800,762,761,760,700,400,1600]){await page.setViewportSize({width,height:800});await layout('responsive rail at '+width);}
 await check(()=>writes.length,savedCount,'resizing never writes size preferences');
 await page.evaluate(()=>closeAll());
 // Source-only opening must not wait for task/index metadata.
 await page.evaluate(()=>{window.resolveWait=new Promise(resolve=>window.releaseResolve=resolve);return open('source');});
 await ready();
 await check(()=>[visibleShell().querySelector('.is-markdown').hidden,visibleShell().querySelector('.operon-native-task-panel').hidden],[false,true],'native Source is visible while optional task resolution is still pending');
 await page.evaluate(()=>{resolveWait=null;releaseResolve();});
 await page.waitForFunction(()=>!findLabel('Show task editor').hidden);
 await page.evaluate(()=>closeAll());
 // Slow initial metadata stays behind the same backdrop, then reveals complete panels.
 for(const mode of ['file','inline','nested-inline']){
  if(mode==='nested-inline'){await page.evaluate(()=>open());await ready();}
  await page.evaluate(mode=>{
   window.editorRenderWait=new Promise(resolve=>window.releaseEditorRender=resolve);
   if(mode==='nested-inline'){
    window.loadingParent=visibleShell(); const anchor=currentEditor().input; anchor.focus();
    window.firstOpen=Subject.openTaskWorkspace(app,anchor,{file:files.Inline,subpath:'',operonId:'inline1'},
     {task:{file:files.Inline,operonId:'inline1'},content:makeEditor('inline1'),markdown:false});
   }else window.firstOpen=open(mode);
  },mode);
  await page.waitForFunction(()=>currentEditor()?.input?.isConnected&&currentLeaf()?.view.file);
  await check(()=>[visibleShell().classList.contains('is-workspace-loading'),getComputedStyle(visibleShell().querySelector('.operon-native-task-panel')).visibility],[true,'hidden'],'initial editor never exposes incomplete sections');
  await check(()=>visibleShell().classList.contains('are-controls-pending'),true,'loading content retains the hover readiness guard');
  await check(()=>Array.from(visibleShell().querySelectorAll('.operon-task-editor-primary-fields'),section=>section.checkVisibility({visibilityProperty:true,opacityProperty:true})),[false,false,false],'Description, Notes and Stats stay unpainted with the frame');
  if(mode==='nested-inline')await check(()=>[loadingParent.checkVisibility({visibilityProperty:true,opacityProperty:true}),loadingParent.inert,getComputedStyle(visibleShell()).backgroundColor],[true,true,'rgba(0, 0, 0, 0.55)'],'loading child preserves the painted parent and one dimming increment');
  await check(()=>currentEditor().mountWidth>0&&Math.abs(currentEditor().mountWidth-visibleShell().querySelector('.operon-native-task-panel').getBoundingClientRect().width)<1,true,'compact editors are mounted at the final panel width');
  await page.evaluate(async()=>{editorRenderWait=null;releaseEditorRender();await firstOpen;});await ready();
  await check(()=>getComputedStyle(visibleShell().querySelector('.operon-native-task-panel')).visibility,'visible','complete editor revealed after initial reads and native measurement');
  await check(()=>Array.from(visibleShell().querySelectorAll('.operon-task-editor-primary-fields'),section=>section.checkVisibility({visibilityProperty:true,opacityProperty:true})),[true,true,true],'all primary sections reveal with the frame');
  await page.evaluate(()=>closeAll());
 }
 // Closing while initial reads are pending cannot reveal or focus a disposed surface.
 await page.evaluate(()=>{window.editorRenderWait=new Promise(resolve=>window.releaseEditorRender=resolve);window.cancelledOpen=open();});
 await page.waitForFunction(()=>currentEditor()?.input?.isConnected&&currentLeaf()?.view.file);
 await page.evaluate(()=>closeAll());
 await page.evaluate(async()=>{editorRenderWait=null;releaseEditorRender();await cancelledOpen;});
 await check(()=>[!!visibleShell(),document.activeElement.id],[false,'anchor'],'late render completion cannot resurrect a closed opening');

 // An ownerless opening releases its prepared editor without leaking an overlay.
 await page.evaluate(async()=>{window.orphan=makeEditor('orphan');const recent=app.workspace.getMostRecentLeaf,iterate=app.workspace.iterateAllLeaves;app.workspace.getMostRecentLeaf=()=>null;app.workspace.iterateAllLeaves=()=>{};try{window.orphanResult=await Subject.openTaskWorkspace(app,document.getElementById('anchor'),{file:files.A,subpath:''},{task:{file:files.A,operonId:'taskA'},content:orphan,markdown:true});}finally{app.workspace.getMostRecentLeaf=recent;app.workspace.iterateAllLeaves=iterate;}});
 await check(()=>[orphanResult,orphan.destroyed,!!visibleShell()],[null,1,false]);
 // Exercise enabled diagnostics through the real native opening path as well.
 await page.evaluate(()=>{window.disposeProbe=Subject.installLightboxOpeningProbe(window);operonLightboxPerf.start();});
 await page.evaluate(()=>open('source'));
 await page.waitForFunction(()=>JSON.parse(operonLightboxPerf.report()).samples[0]?.outcome==='ready');
 await check(()=>JSON.parse(operonLightboxPerf.report()).samples.map(s=>[s.kind,s.outcome,s.leaves]),[['source','ready',1]],'source opening records one native leaf');
 await page.evaluate(()=>closeAll());
 await page.evaluate(async()=>{
  const trace=Subject.beginLightboxOpeningTrace(document,'editor');
  await Subject.openTaskWorkspace(app,document.getElementById('anchor'),{file:files.Inline,subpath:'',operonId:'inline1'},
   {task:{file:files.Inline,operonId:'inline1'},content:makeEditor('inline1'),markdown:false,openingTrace:trace});
 });
 await check(()=>JSON.parse(operonLightboxPerf.report()).samples.map(s=>[s.kind,s.outcome,s.leaves]),[['source','ready',1],['editor','ready',0]],'editor-only opening creates no native leaf');
 await page.evaluate(()=>closeAll());
 await page.evaluate(()=>{operonLightboxPerf.stop();disposeProbe();});
 await check(()=>typeof window.operonLightboxPerf,'undefined','probe unload removes development API');

 await page.evaluate(()=>{window.beforeLazy=leaves.length;return open('inline');});await ready();
 await check(()=>leaves.length,await page.evaluate(()=>beforeLazy),'editor-only has no native allocation');
 await page.evaluate(()=>{currentEditor().fail=true;currentEditor().isEdited=true;visibleShell().querySelector('.operon-task-media-lightbox-close').click();});await page.waitForTimeout(30);
 await check(()=>!!visibleShell(),true,'editor-only failed close retains draft without a leaf');
 await page.evaluate(()=>{currentEditor().fail=false;visibleShell().querySelector('.operon-task-media-lightbox-close').click();});await page.waitForFunction(()=>!visibleShell());
 // A fresh app identity exercises the pool after the earlier unload tests.
 await page.evaluate(()=>{window.app={...app};app.vault.getAbstractFileByPath=path=>Object.values(files).find(f=>f.path===path);Subject.registerNativeTaskWorkspace(app,provider);return open('source');});await ready();
 await page.evaluate(()=>{window.cachedLeaf=currentLeaf();window.cachedCount=leaves.length;visibleShell().querySelector('.operon-task-media-lightbox-close').click();});await page.waitForFunction(()=>!visibleShell());
 await page.evaluate(()=>open('source'));await ready();
 await check(()=>[currentLeaf()===cachedLeaf,leaves.length===cachedCount,cachedLeaf.view.cleared,cachedLeaf.view.scroll],[true,true,true,0],'warm checkout reuses a clean native view with reset history and scroll');
 await page.evaluate(()=>closeAll());

 await page.evaluate(()=>open('inline'));await ready();
 await page.evaluate(()=>{window.retained=currentEditor();window.failNative=true;clickLabel('Show source');});await page.waitForTimeout(30);
 await check(()=>[currentEditor()===retained,visibleShell().querySelector('.is-markdown').hidden,visibleShell().classList.contains('is-workspace-loading')],[true,true,false],'failed lazy source keeps the existing editor usable');
 await page.evaluate(()=>{window.failNative=false;return closeAll();});
 await page.evaluate(async()=>{const original=provider.resolve;provider.resolve=async()=>{throw Error('missing identity');};try{await open('file');}finally{provider.resolve=original;}});
 await page.waitForFunction(()=>!visibleShell());
 await check(()=>!!visibleShell(),false,'failed initial context closes instead of retaining an invisible shell');

 // Direction is captured once; subsequent openings and pooled native views use current preferences.
 for(const side of ['left','right'])for(const mode of ['file','inline','source']){
  await page.setViewportSize({width:1600,height:1000});
  await page.evaluate(({side,mode})=>{position=side;return open(mode);},{side,mode});await ready();
  await page.evaluate(side=>{visibleShell().dataset.testSide=side;},side);
  await check(()=>controlLayoutErrors(),[],`${side} ${mode}: mirrored rails`);
  if(mode!=='source'){
   await check(()=>Math.abs(visibleShell().querySelector('.operon-native-task-panel').getBoundingClientRect().top-50)<1,true,`${side} ${mode}: initial editor top uses the saved source height`);
  }
  if(mode==='file'){
   await page.evaluate(()=>{window.sourceTop=visibleShell().querySelector('.is-markdown').getBoundingClientRect().top;clickLabel('Hide source');});
   await layout(`${side}: editor-only top controls`);
   await check(()=>visibleShell().querySelector('.operon-native-task-panel').getBoundingClientRect().top,await page.evaluate(()=>sourceTop),`${side}: hiding source preserves the editor top`);
   await page.evaluate(()=>clickLabel('Show source'));await ready();await page.waitForTimeout(60);
   await page.evaluate(()=>{visibleShell().querySelector('.operon-lightbox-height-decrease').click();window.sourceTop=visibleShell().querySelector('.is-markdown').getBoundingClientRect().top;clickLabel('Hide source');});
   await check(()=>visibleShell().querySelector('.operon-native-task-panel').getBoundingClientRect().top,await page.evaluate(()=>sourceTop),`${side}: editor-only top follows the resized source height`);
   await page.evaluate(()=>clickLabel('Show source'));await ready();await page.waitForTimeout(60);
  }

  await check(()=>{const shell=visibleShell(),ed=shell.querySelector('.operon-native-task-panel'),md=shell.querySelector('.is-markdown');const e=ed.getBoundingClientRect(),m=md.getBoundingClientRect(),x=shell.querySelector('.operon-task-media-lightbox-close').getBoundingClientRect();return [ed.hidden?true:(shell.dataset.testSide==='left'?e.left<40:e.right>innerWidth-40), md.hidden?true:(shell.dataset.testSide==='left'?x.right<=m.left:x.left>=m.right)];},[true,true]);
  await page.evaluate(()=>{position=position==='left'?'right':'left';window.dispatchEvent(new Event('resize'));});
  await check(()=>controlLayoutErrors(),[],`${side}: settings change preserves open geometry`);
  if(mode==='file'){
   await page.evaluate(()=>clickLabel('Hide task editor'));
   await check(()=>controlLayoutErrors(),[],`${side}: source only keeps preferred rails`);
   await page.evaluate(()=>clickLabel('Show task editor'));
   await page.setViewportSize({width:600,height:600});
   await layout(`${side}: compact editor`);
   await page.setViewportSize({width:1600,height:1000});
   await layout(`${side}: paired return`);
  }
  await page.evaluate(()=>closeAll());
 }
 // Native Obsidian modals add padding and borders outside the scrollable editor.
 // Include the real title/section hierarchy so a short last section needs no scroll.
 await page.addStyleTag({content: '.operon-native-task-panel{box-sizing:border-box;display:flex;flex-direction:column;padding:24px 16px;border:2px solid transparent}.operon-native-task-panel>.modal-content{margin-block:5px}.operon-native-task-panel .operon-task-editor-main-panel{border-block:1px solid transparent}'});
 for(const side of ['left','right'])for(const mode of ['file','inline']){
  await page.setViewportSize({width:1600,height:1000});
  await page.evaluate(({side,mode})=>{position=side;return open(mode);},{side,mode});await ready();
  await page.evaluate(()=>{
   const main=visibleShell().querySelector('.operon-task-editor-main-panel');
   const sections=document.createElement('div');sections.className='operon-task-editor-section-layout';while(main.firstChild)sections.appendChild(main.firstChild);main.appendChild(sections);
   const title=document.createElement('div');title.className='operon-task-editor-title-row';title.innerHTML='<h3 class="operon-task-editor-title">Task Editor</h3>';main.prepend(title);
   const last=sections.createDiv('operon-task-editor-section-host');last.dataset.heightTest='last';last.style.height='44px';last.textContent='Sessions';
   window.dispatchEvent(new Event('resize'));
  });await page.waitForTimeout(80);
  const shortGeometry=()=>{
   const shell=visibleShell(),main=shell.querySelector('.operon-task-editor-main-panel'),last=main.querySelector('[data-height-test]'),panel=shell.querySelector('.operon-native-task-panel');
   return [main.scrollHeight<=main.clientHeight+1,main.scrollTop===0,last.getBoundingClientRect().bottom<=main.getBoundingClientRect().bottom+1,panel.getBoundingClientRect().height<innerHeight*.8];
  };
  await check(shortGeometry,[true,true,true,true],`${side} ${mode}: title and last section fit without scrolling`);
  const tightBottom=()=>{
   const shell=visibleShell(),last=shell.querySelector('[data-height-test]'),panel=shell.querySelector('.operon-native-task-panel');
   const gap=panel.getBoundingClientRect().bottom-last.getBoundingClientRect().bottom;
   // Fixture chrome: modal padding 24 + border 2 + body margin 5 + content border 1.
   return gap>=31&&gap<=33;
  };
  await check(tightBottom,true,`${side} ${mode}: no unused space below the last section`);
  await page.evaluate(()=>{visibleShell().querySelector('.operon-task-editor-main-panel').style.height='600px';window.dispatchEvent(new Event('resize'));});await page.waitForTimeout(80);
  await check(tightBottom,true,`${side} ${mode}: allocated scrollport height is not content height`);
  await page.evaluate(()=>{const main=visibleShell().querySelector('.operon-task-editor-main-panel');window.heightGrowth=main.querySelector('.operon-task-editor-section-layout').createDiv();heightGrowth.style.height='2000px';window.dispatchEvent(new Event('resize'));});await page.waitForTimeout(80);
  await check(()=>{const s=visibleShell(),p=s.querySelector('.operon-native-task-panel'),m=s.querySelector('.operon-task-editor-main-panel'),md=s.querySelector('.is-markdown');return [m.scrollHeight>m.clientHeight,p.getBoundingClientRect().height<=(md.hidden?innerHeight*.8:md.getBoundingClientRect().height)+1,m.getBoundingClientRect().bottom<=p.getBoundingClientRect().bottom];},[true,true,true],`${side} ${mode}: long content retains bounded scrolling`);
  await page.evaluate(()=>{visibleShell().querySelector('.operon-task-editor-main-panel').scrollTop=200;window.dispatchEvent(new Event('resize'));});await page.waitForTimeout(80);
  await check(()=>visibleShell().querySelector('.operon-task-editor-main-panel').scrollTop,200,`${side} ${mode}: measuring does not move the scroll position`);
  await page.evaluate(()=>{heightGrowth.remove();window.dispatchEvent(new Event('resize'));});await page.waitForTimeout(80);
  await check(shortGeometry,[true,true,true,true],`${side} ${mode}: editor contracts after content shrinks`);
  await check(tightBottom,true,`${side} ${mode}: shrinking content leaves only normal bottom padding`);
  await page.evaluate(()=>closeAll());
 }
 assert.deepEqual(errors,[]);checks++;

 console.log(JSON.stringify({ok:true,checks}));
} finally {await browser.close();}
