import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.OPERON_TEST_PLAYWRIGHT || 'playwright');
const bundle = await build({ stdin: { contents: `export * from './src/ui/lightbox-opening-perf'; export * from './src/ui/native-task-workspace'; export * from './src/ui/web-lightbox'; export * from './src/ui/lightbox'; export * from './src/core/lightbox-size'; export * from './src/ui/modal-backdrop'; export { Platform } from 'obsidian'; export { DEFAULT_SETTINGS } from './src/types/settings'; export { getNativePropertyIndex } from './src/indexer/native-property-index'; export { readPropertyEditorDocument } from './src/core/property-editor-document'; export { NativePropertyEditor } from './src/ui/native-property-editor';
 export { TaskEditorContent } from './src/ui/task-editor-content';
 export { createEditorSectionHosts } from './src/ui/editor-sections-layout';
 export { changeTaskEditorLayout, resolveTaskEditorLayout } from './src/core/task-editor-layout';
 export { normalizeTaskEditorSections } from './src/types/task-editor-sections';
 export { renderTaskEditorSectionsSettings } from './src/ui/settings/task-editor-section-settings';
 export { openPropertyIconPicker } from './src/ui/settings/property-icon-picker';
 export { propertyIconEditMatches } from './src/core/property-icons';
 export { refreshMountedPropertyIcons } from './src/ui/property-icon-presentation';
 `, resolveDir: root }, define: { OPERON_LIGHTBOX_PERF_ENABLED: 'true' }, bundle: true, write: false, format: 'iife', globalName: 'Subject', platform: 'browser', logLevel: 'silent', plugins: [{
 name: 'editor-fixture-host',
 setup(builder) {
  builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'host', namespace: 'editor-fixture' }));
  builder.onLoad({ filter: /.*/, namespace: 'editor-fixture' }, () => ({
   resolveDir: root,
   contents: `
    export * from './scripts/test-support/obsidian-native-yaml.ts';
    export function getIcon(name) {
     const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
     svg.setAttribute('data-test-icon', name);
     return svg;
    }
    export function getIconIds() { return ['book-open', 'compass', 'hash', 'link-2', 'star']; }
    export class Modal {
     constructor(app) {
      this.app = app;
      this.containerEl = document.body.createDiv('modal-container');
      this.modalEl = this.containerEl.createDiv('modal');
      this.titleEl = this.modalEl.createDiv('modal-title');
      this.contentEl = this.modalEl.createDiv('modal-content');
      this.onEscape = event => { if (event.key === 'Escape') this.close(); };
     }
     open() { document.addEventListener('keydown', this.onEscape); this.onOpen?.(); }
     close() {
      document.removeEventListener('keydown', this.onEscape);
      this.containerEl.remove();
      this.onClose?.();
     }
    }
    export class Setting {
     constructor(parent) {
      this.settingEl = parent.createDiv('setting-item');
      this.infoEl = this.settingEl.createDiv('setting-item-info');
      this.controlEl = this.settingEl.createDiv('setting-item-control');
     }
     setName(name) { this.infoEl.setText(name); return this; }
     addText(callback) {
      const inputEl = this.controlEl.createEl('input', { attr: { type: 'text' } });
      const control = { inputEl, getValue: () => inputEl.value,
       setValue: value => { inputEl.value = value; return control; },
       setPlaceholder: value => { inputEl.placeholder = value; return control; } };
      callback(control);
      return this;
     }
     addToggle(callback) {
      const toggleEl = this.controlEl.createEl('input', { attr: { type: 'checkbox' } });
      const control = { toggleEl,
       setValue: value => { toggleEl.checked = value; return control; },
       onChange: listener => { toggleEl.addEventListener('change', () => { void listener(toggleEl.checked); }); return control; } };
      callback(control);
      return this;
     }
    }
   `,
  }));
 },
}] });
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
  Element.prototype.hasClass = function(name) {return this.classList.contains(name);};
  Element.prototype.setAttr = function(name,value) {this.setAttribute(name,value);};
  Element.prototype.setCssProps = function(entries) {for (const [name,value] of Object.entries(entries)) this.style.setProperty(name,value);};

  Element.prototype.setText = function(text) {this.textContent=text;};
  Element.prototype.setCssStyles = function(styles) {Object.assign(this.style,styles);};
  Element.prototype.empty = function() {this.replaceChildren();};
  window.createEl = (tag,options) => { const el = document.body.createEl(tag,options); el.remove(); return el; };
  window.createDiv = o => window.createEl('div',o);
  window.createSpan = o => window.createEl('span',o);
 });
 await page.addScriptTag({content:bundle.outputFiles[0].text});
 await page.evaluate(() => {
  window.activeDocument = document; window.activeWindow = window;
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
 // Exercise the real Property Editor in the same shell as the native Task Editor.
 await page.evaluate(() => {
  const S = Subject;
  const settings = {
   ...S.DEFAULT_SETTINGS,
   keyMappings: S.DEFAULT_SETTINGS.keyMappings.map(mapping => mapping.canonicalKey === 'contexts'
    ? { ...mapping, visiblePropertyName: 'Up' } : mapping),
   taskEditorSections: [{ id: 'connections', name: 'References' }, { id: 'description', name: '' }, { id: 'additional', name: '' }],
  };
  window.propertySettings = settings;
  const source = '---\nCount: 3\nUp: "[[2026-W46]]"\nnote: Summary\n_private: protected\n---\nBody';
  stored.set(files.Normal.path, source);
  app.vault.getMarkdownFiles = () => [];
  app.metadataCache = { getFileCache: () => null };
  S.getNativePropertyIndex(app).setTypes({ Up: 'multitext', Count: 'number', Extra: 'text' });
  provider.readProperties = async file => S.readPropertyEditorDocument(stored.get(file.path), settings.keyMappings);
  provider.canConvert = () => true;
  provider.convert = async () => null;
  window.propertyWrites = 0;
  provider.createProperties = (host, file, props, convert) => new S.NativePropertyEditor(host, props, {
   app, file, settings: () => settings, tasks: () => [], canConvert: () => true, convert,
   save: async () => { window.propertyWrites++; return { status: 'failed' }; },
  });
  window.openProperties = async (source = true) => {
   const anchor = document.getElementById('anchor');
   anchor.focus();
   const file = files.Normal, data = source ? await provider.readProperties(file) : { order: [], frontmatter: {} };
   await S.openPreparedPropertyWorkspace(app, anchor, { file, subpath: '' }, data, () => true);
  };
 });
 for (const [mode, width] of [['desktop',1600],['tablet',900],['phone',390],['compact',390]]) {
  await page.setViewportSize({ width, height: 800 });
  await page.evaluate(async mode => {
   Object.assign(Subject.Platform, { isDesktopApp: mode === 'desktop', isTablet: mode === 'tablet', isPhone: mode === 'phone' || mode === 'compact', isMobile: mode !== 'desktop', isMobileApp: mode !== 'desktop' });
   propertySettings.taskEditorUseMobileLayout = mode === 'compact';
   window.leafCountBeforeProperties = leaves.length;
   await openProperties();
  },mode);
  await ready();
  const property = page.locator('.operon-property-editor');
  await check(() => [leaves.length===leafCountBeforeProperties, visibleShell().querySelector('.is-markdown').hidden,
   visibleShell().querySelector('.operon-property-editor .operon-task-editor-title').textContent],
   [true,true,'Property Editor'],mode+' opens only the shared editor without creating a native leaf');
  await check(() => ({ compact: !!visibleShell().querySelector('.operon-task-editor-mobile-body'), touch: visibleShell().querySelector('.operon-property-editor').dataset.editorInput ?? '' }),
   { compact: mode==='compact', touch: mode==='phone'||mode==='tablet'?'touch':'' },mode+' uses the configured editor layout');
  if (mode !== 'compact') {
   await check(() => Array.from(visibleShell().querySelectorAll('[data-editor-section]:not([hidden])'), host => host.dataset.editorSection),
    ['connections','description','additional','notes'],mode+' uses the configured group order and skips empty groups');
   await check(() => visibleShell().querySelector('[data-editor-section="connections"] .operon-editor-desktop-group-title').textContent,'References');
   await check(() => visibleShell().querySelector('[data-editor-section="notes"] [data-property-name="note"]') !== null,true);
  }
  await check(() => !!visibleShell().querySelector('[data-property-name="_private"] .is-readonly'),true,'protected property stays read-only');
  const contextSelector = mode === 'compact' ? '.operon-editor-picker-anchor' : '.operon-editor-desktop-property-label';
  const context = property.locator(`[data-property-name="Up"] ${contextSelector}`).first();
  if (mode === 'compact') {
   await context.dispatchEvent('pointerdown', { pointerType: 'touch' });
   await context.dispatchEvent('pointerup', { pointerType: 'touch' });
   await context.evaluate(el => el.click());
  } else await context.press('Enter');
  const picker = page.locator('.operon-contexts-picker-panel');
  await picker.waitFor({ state: 'visible', timeout: 3000 });
  assert.deepEqual(await picker.locator('.operon-parent-selected-chip-label').allTextContents(), ['2026-W46'], mode+' opens the selected Up link');
  checks++;
  if (mode !== 'desktop') {
   await page.setViewportSize({ width, height: 460 });
   await page.waitForFunction(() => {
    const panel = visibleShell().querySelector('.operon-native-task-panel').getBoundingClientRect();
    return panel.bottom <= visualViewport.height && panel.top >= 0 && panel.right <= visualViewport.width;
   });
   await check(() => !!visibleShell().querySelector('.operon-contexts-picker-panel.operon-mobile-picker-surface'),true,mode+' preserves the mobile picker when the viewport shrinks');
  }
  await page.keyboard.press('Escape');
  await picker.waitFor({ state: 'detached', timeout: 3000 });
  await check(() => [!!visibleShell(),propertyWrites],[true,0],mode+' closes the picker without writing or closing the editor');
  if (mode==='desktop') {
   await page.evaluate(()=>clickLabel('Show source'));
   await page.waitForFunction(()=>!visibleShell().querySelector('.is-markdown').hidden);
   await check(()=>[currentLeaf().view.file.path,!!visibleShell().querySelector('.operon-property-editor')],['Normal.md',true],'desktop may reveal its source without losing the editor');
  } else {
   await check(()=>visibleControls().length,1,'mobile editor uses its close control');
  }
  await page.evaluate(()=>closeAll());
  await check(()=>document.activeElement.id,'anchor',mode+' restores focus on closing');
 }
 await page.evaluate(async () => {
  Object.assign(Subject.Platform, { isDesktopApp: true, isTablet: false, isPhone: false, isMobile: false, isMobileApp: false });
  await openProperties(false);
 });
 await ready();
 await check(()=>Array.from(visibleShell().querySelectorAll('[data-editor-section]:not([hidden])'), host=>host.dataset.editorSection),['description','additional'],'empty note shows conversion and Add property without adding blank fields');
 await page.locator('.operon-property-editor .operon-editor-file-property-add').evaluate(el=>el.click());
 await page.getByRole('combobox', { name: 'Add Property' }).waitFor({ state: 'attached', timeout: 3000 });
 await page.keyboard.press('Escape');
 await check(()=>[!!visibleShell(),propertyWrites],[true,0],'closing Add property creates no field');
 await page.evaluate(()=>closeAll());
 await page.evaluate(async () => {
  provider.locate = async id => tasks.get(files.Normal) === id ? { file: files.Normal, operonId: id } : null;
  provider.convert = async (file, prepare) => {
   if (await prepare(stored.get(file.path)) === null) return null;
   tasks.set(file, 'convertedNote');
   return 'convertedNote';
  };
  await openProperties();
  window.conversionShell = visibleShell();
 });
 await page.getByRole('button', { name: 'Convert to Operon File Task' }).click();
 await page.waitForFunction(()=>currentEditor()?.id==='convertedNote');
 await check(() => [visibleShell()===conversionShell,!!visibleShell().querySelector('.operon-property-editor'),
  visibleShell().querySelector('.is-markdown').hidden,currentEditor().input.closest('[inert]')===null],
  [true,false,true,true],'conversion activates the Task Editor inside the same editor-only Lightbox');
 await page.evaluate(()=>closeAll());
 // Exercise the same card renderer used by Settings Search and the fallback Settings page.
 await page.setViewportSize({ width: 1040, height: 900 });
 await page.evaluate(() => {
  const host = document.body.createDiv('vertical-tab-content');
  host.style.cssText = 'position:relative;max-height:800px;overflow:auto;padding:12px;';
  window.sectionsHost = host.createDiv({ attr: { id: 'sections-settings' } });
  window.sectionWrites = 0;
  window.iconAttempts = 0;
  window.iconWrites = 0;
  window.failIconWrite = false;
  window.allowSectionRemoval = false;
  window.failSectionWrite = false;
  window.sectionConfirmations = [];
  window.disposeSections = Subject.renderTaskEditorSectionsSettings(sectionsHost, {
   app,
   settings: () => propertySettings,
   async change(action) {
    if (failSectionWrite) throw new Error('fixture settings failure');
    const current = Subject.normalizeTaskEditorSections(propertySettings.taskEditorSections);
    propertySettings.taskEditorSections = Subject.normalizeTaskEditorSections(Subject.changeTaskEditorLayout(current, propertySettings.keyMappings, action));
    sectionWrites++;
   },
   openIconPicker(anchor, field, label, fallback, onClose) {
    return Subject.openPropertyIconPicker(app, {
     anchor, field, label, fallback, onClose, settings: () => propertySettings,
     async save(edit, icon) {
      iconAttempts++;
      await new Promise(resolve => setTimeout(resolve, 60));
      if (failIconWrite || !Subject.propertyIconEditMatches(propertySettings, edit)) throw new Error('fixture icon write rejected');
      if (edit.ref.kind === 'mapped') {
       propertySettings.keyMappings = propertySettings.keyMappings.map(mapping => mapping.canonicalKey === edit.ref.key
        ? { ...mapping, icon: icon || edit.defaultIcon } : mapping);
      } else {
       const next = { ...propertySettings.vaultPropertyIcons };
       if (icon) next[edit.ref.name] = icon; else delete next[edit.ref.name];
       propertySettings.vaultPropertyIcons = next;
      }
      iconWrites++;
      return true;
     },
    });
   },
   async confirmRemove(name) { sectionConfirmations.push(name); return allowSectionRemoval; },
  });
 });
 const sections = page.locator('#sections-settings');
 const card = id => sections.locator(`[data-editor-settings-section="${id}"]`);
 const upIcon = card('connections').getByRole('button', { name: 'Change icon for Up', exact: true });
 const iconModal = page.locator('.operon-settings-icon-picker-modal');
 await upIcon.press('Enter');
 await iconModal.waitFor();
 await page.keyboard.press('Escape');
 await iconModal.waitFor({ state: 'detached' });
 await check(() => [iconAttempts, document.activeElement?.querySelector('[data-test-icon]')?.getAttribute('data-test-icon')], [0, 'compass'], 'Escape returns focus to the icon button without saving');
 await upIcon.press('Space');
 await iconModal.getByRole('button', { name: 'Cancel', exact: true }).click();
 await check(() => iconAttempts, 0, 'Cancel performs zero writes');
 await upIcon.click();
 await iconModal.getByRole('button', { name: 'star', exact: true }).evaluate(button => { button.click(); button.click(); });
 await iconModal.waitFor({ state: 'detached' });
 await check(() => [iconAttempts, iconWrites, propertySettings.keyMappings.find(mapping => mapping.canonicalKey === 'contexts').icon],
  [1, 1, 'star'], 'double activation saves one canonical preference');
 assert.equal(await upIcon.locator('[data-test-icon]').getAttribute('data-test-icon'), 'star', 'icon update preserves the accessible name');
 checks++;
 await upIcon.click();
 assert.match(await iconModal.locator('.operon-settings-icon-picker-current-label').textContent(), /star/);
 checks++;
 await iconModal.getByRole('button', { name: 'Clear', exact: true }).click();
 await iconModal.waitFor({ state: 'detached' });
 assert.equal(await upIcon.locator('[data-test-icon]').getAttribute('data-test-icon'), 'compass');
 checks++;

 const countIcon = card('additional').getByRole('button', { name: 'Change icon for Count', exact: true });
 const touch = await page.context().newCDPSession(page);
 await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
 for (const width of [900, 390]) {
  await page.setViewportSize({ width, height: 760 });
  await countIcon.scrollIntoViewIfNeeded();
  const box = await countIcon.boundingBox();
  assert.ok(box && box.height >= 44, 'coarse pointer icon target is at least 44 px tall');
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await iconModal.waitFor();
  if (width === 900) await iconModal.getByRole('button', { name: 'Cancel', exact: true }).click();
  else await iconModal.getByRole('button', { name: 'book-open', exact: true }).click();
  await iconModal.waitFor({ state: 'detached' });
  checks++;
 }
 await touch.send('Emulation.setTouchEmulationEnabled', { enabled: false });
 await touch.detach();
 await page.setViewportSize({ width: 1040, height: 900 });
 await check(() => [iconAttempts, iconWrites, propertySettings.vaultPropertyIcons.count], [3, 3, 'book-open'], 'touch edits the case-insensitive vault icon');
 await page.evaluate(() => { window.failIconWrite = true; });
 await countIcon.click();
 await iconModal.getByRole('button', { name: 'star', exact: true }).click();
 await page.waitForFunction(() => iconAttempts === 4 && !document.querySelector('.operon-settings-icon-picker-modal .modal-content')?.hasAttribute('aria-busy'));
 await check(() => [iconWrites, propertySettings.vaultPropertyIcons.count], [3,'book-open'], 'a failed icon write retains the saved glyph');
 await iconModal.getByRole('button', { name: 'Cancel', exact: true }).click();
 const addSection = sections.locator('[data-editor-settings-focus="add-section"]');
 await addSection.fill('Research');
 await addSection.press('Enter');
 const research = sections.locator('[data-editor-settings-section^="custom:"]');
 await research.waitFor({ state: 'visible' });
 const assign = async (target, name) => {
  await target.getByRole('button', { name: 'Add Property' }).click();
  const search = page.getByRole('combobox', { name: 'Add Property' });
  await search.fill(name);
  await search.press('Enter');
  await search.waitFor({ state: 'detached' });
  await target.getByText(name, { exact: true }).waitFor();
 };
 await assign(research, 'Up');
 await assign(research, 'Count');
 await research.getByRole('button', { name: 'Move up · Count' }).click();
 assert.deepEqual(await research.locator('.operon-editor-section-item-name').allTextContents(), ['Count','Up']); checks++;
 assert.equal(await card('connections').getByText('Up', { exact: true }).count(), 0); checks++;
 await research.getByRole('button', { name: 'Remove property from section · Up' }).click();
 assert.equal(await card('additional').locator('.is-automatic').getByText('Up', { exact: true }).count(), 1); checks++;
 await assign(research, 'Up');
 const overview = card('overview');
 await overview.getByRole('button', { name: 'Remove section · Overview' }).click();
 await check(()=>[sectionConfirmations.at(-1),!!sectionsHost.querySelector('[data-editor-settings-section="overview"]')],['Overview',true]);
 await page.evaluate(()=>{window.allowSectionRemoval=true;});
 await overview.getByRole('button', { name: 'Remove section · Overview' }).click();
 await overview.waitFor({ state: 'detached' });
 await card('commands').getByRole('button', { name: 'Move up · Pin' }).click();
 await check(()=>Subject.resolveTaskEditorLayout(propertySettings.taskEditorSections,propertySettings.keyMappings).commandOrder.slice(0,3),['tracker','pin','scrollbars']);
 assert.equal(await card('commands').getByRole('button', { name: /Remove section/u }).count(),0); checks++;
 await page.evaluate(()=>{window.failSectionWrite=true;});
 await research.locator('input[type="checkbox"]').click();
 await check(()=>sectionsHost.querySelector('[data-editor-settings-section^="custom:"] input[type="checkbox"]').checked,true,'a failed save restores the committed visibility');
 await check(()=>[sectionWrites,propertyWrites],[8,0],'layout settings do not write note content');
 await page.evaluate(()=>{disposeSections(); sectionsHost.parentElement.remove();});

 // The layout applies to a real Property Editor on each platform and freezes an open picker.
 for (const [mode,width] of [['desktop',1040],['tablet',800],['phone',390],['compact',390]]) {
  await page.setViewportSize({ width, height: 760 });
  await page.evaluate(async mode => {
   Object.assign(Subject.Platform, { isDesktopApp: mode==='desktop', isTablet: mode==='tablet', isPhone: mode==='phone'||mode==='compact', isMobileApp: mode!=='desktop', isMobile: mode!=='desktop' });
   propertySettings.taskEditorUseMobileLayout = mode==='compact';
   await openProperties();
  },mode);
  await ready();
  await check(()=>Array.from(visibleShell().querySelectorAll('[data-property-group^="custom:"] [data-property-name]'), row=>row.dataset.propertyName),
   mode==='compact'?[]:['Count','Up'],mode+' uses the saved mixed order in the section layout');
  if (mode !== 'compact') {
   await check(()=>!!visibleShell().querySelector('[data-editor-section="overview"]'),false);
   await check(()=>!!visibleShell().querySelector('[data-editor-section="additional"] [data-property-name="_private"] .is-readonly'),true);
  }
  if(mode==='desktop') {
   await page.locator('[data-property-name="Up"] .operon-editor-desktop-property-label').press('Enter');
   const picker = page.locator('.operon-contexts-picker-panel');
   await picker.waitFor({state:'visible'});
   await page.evaluate(() => {
    window.activeUpLabel = visibleShell().querySelector('[data-property-name="Up"] .operon-editor-desktop-property-label');
    window.activeUpPicker = visibleShell().querySelector('.operon-contexts-picker-panel');
    propertySettings.keyMappings = propertySettings.keyMappings.map(mapping => mapping.canonicalKey === 'contexts'
     ? { ...mapping, icon: 'link-2' } : mapping);
    Subject.refreshMountedPropertyIcons(app);
   });
   await check(() => [
    activeUpLabel === visibleShell().querySelector('[data-property-name="Up"] .operon-editor-desktop-property-label'),
    activeUpPicker === visibleShell().querySelector('.operon-contexts-picker-panel'),
    activeUpLabel.querySelector('[data-test-icon]')?.getAttribute('data-test-icon'),
    visibleShell().querySelector('[data-property-name="Count"] .operon-editor-desktop-property-label [data-test-icon]')?.getAttribute('data-test-icon'),
    propertyWrites,
   ], [true,true,'link-2','book-open',0], 'live glyph updates preserve the open editor, active picker and note');
   await page.evaluate(()=>{
    const id = propertySettings.taskEditorSections.find(section=>section.id.startsWith('custom:')).id;
    const before = propertySettings.taskEditorSections;
    propertySettings.taskEditorSections = Subject.changeTaskEditorLayout(before,propertySettings.keyMappings,{type:'visibility',id,enabled:false});
    window.reinstateSettings = before;
   });
   await check(()=>!!visibleShell().querySelector('.operon-contexts-picker-panel'),true,'layout editing leaves an active picker mounted');
   await page.keyboard.press('Escape');
   await picker.waitFor({state:'detached'});
   await page.evaluate(()=>closeAll());
   await page.evaluate(()=>openProperties());
   await ready();
   await check(()=>getComputedStyle(visibleShell().querySelector('[data-editor-section^="custom:"]')).display,'none','saved visibility is applied on reopening');
   await page.evaluate(()=>{propertySettings.taskEditorSections=reinstateSettings;});
  }
  await page.evaluate(()=>closeAll());
 }

 // Use TaskEditorContent's desktop grouping and native row renderer for both task representations.
 await page.setViewportSize({ width: 1040, height: 760 });
 await page.evaluate(()=>{
  window.layoutTask = format => {
   const S = Subject;
   document.querySelector('#task-sections-fixture')?.remove();
   const root = document.body.createDiv({ cls: 'operon-task-editor', attr: { id: 'task-sections-fixture' } });
   const editor = Object.create(S.TaskEditorContent.prototype);
   const desktopLayout = S.resolveTaskEditorLayout(propertySettings.taskEditorSections,propertySettings.keyMappings);
   Object.assign(editor,{
    app, settings: propertySettings, desktopLayout, desktopPropertyGroups:new Map(), desktopPropertyRows:new Map(), filePropertyRows:new Map(),
    workflowActionButtons:new Map(), fieldValues:{contexts:'[[2026-W46]]'}, tags:[], description:'Fixture task', isNewTask:false, isPhone:false,
    usesMobileLayout:false, subtaskActionKind:'file', existingTask:{}, taskOperonId:'fixture1', fileBodyContext:{filePath:'A.md',format},
    timeTracker:{isTimerRunning:()=>false}, getCurrentOperonId:()=>null, onSetHideScrollbars:async()=>{}, onRequestDelete:async()=>false,
    getThemeColor:()=>null, bindTaskEditorTooltip(){}, syncWorkflowActionButtonState(){}, renderDesktopCoreProperty(){}, addDesktopCoreClear(){},
    refreshDesktopPropertyRows(){}, getRenderableWorkflowPickerItems:()=>[{key:'contexts',visible:true},{key:'related',visible:true}],
    mountDesktopFileProperties(group){
     const fileRoot=group.createDiv('operon-editor-desktop-file-properties');
     const count = this.nativePropertyField('Count','number');
     this.fileProperties = new Map([['Count',{field:count,value:3,baseline:{present:true,value:3},
      ...(format==='inline'?{inline:{sourceName:'Count',present:true,type:'number'}}:{})}]]);
     this.renderDesktopFileProperties(fileRoot);
    },
   });
   const { host } = S.createEditorSectionHosts(root,desktopLayout.sections);
   editor.renderDesktopPropertyGroups(host,desktopLayout);
   editor.scrollbarsObserver?.disconnect();
  };
 });
 for (const [format,expected] of [['yaml',['tracker','pin','scrollbars','checkboxes','subtask','inlineSubtask','remove']],['inline',['tracker','pin','scrollbars','checkboxes','subtask','remove']]]) {
  await page.evaluate(format=>layoutTask(format),format);
  await check(()=>Array.from(document.querySelectorAll('#task-sections-fixture [data-property-group^="custom:"] .operon-editor-desktop-property-name'),row=>row.textContent),['Count','Up'],format+' interleaves native and mapped rows');
  await check(()=>Array.from(document.querySelectorAll('#task-sections-fixture [data-editor-command]'),node=>node.dataset.editorCommand),expected,format+' uses the saved command order');
  await check(()=>document.querySelector('#task-sections-fixture [data-property-key="contexts"] .operon-editor-desktop-property-icon [data-test-icon]')?.getAttribute('data-test-icon'),
   'link-2',format+' uses the same mapped icon as the open Property Editor');
  await check(()=>!!document.querySelector('#task-sections-fixture [data-editor-section="overview"]'),false,'deleted default leaves no empty host');
 }
 await page.evaluate(()=>document.querySelector('#task-sections-fixture').remove());
 assert.deepEqual(errors,[]);checks++;

 console.log(JSON.stringify({ok:true,checks}));
} finally {await browser.close();}
