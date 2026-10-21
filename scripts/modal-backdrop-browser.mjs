import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.OPERON_TEST_PLAYWRIGHT || 'playwright');
const css = readFileSync(path.join(root, 'styles.css'), 'utf8');
const bundle = await build({ stdin: { contents: "export * from './src/ui/modal-backdrop';export * from './src/ui/field-pickers/common';export * from './src/ui/lightbox';export * from './src/core/lightbox-size';export {openTaskMediaLightbox} from './src/ui/task-media-lightbox';export {Platform} from 'obsidian';", resolveDir: root }, bundle:true, write:false, format:'iife', globalName:'Subject', platform:'browser', logLevel:'silent', alias:{obsidian:path.join(root,'scripts/test-support/obsidian.ts')} });
const browser = await chromium.launch({headless:true, ...(process.env.OPERON_TEST_BROWSER ? {executablePath:process.env.OPERON_TEST_BROWSER} : {})});
let scenarios = 0;
try {
 for (const surface of ['creator','finder','editor','subtasks']) for (const dark of [false,true]) for (const width of [460,1440]) for (const desktop of [false,true]) {
  const page = await browser.newPage({viewport:{width,height:800}});
  try {
   await page.setContent(`<style>
*{box-sizing:border-box}body{margin:0;--layer-modal:50;--layer-popover:30;--layer-menu:65;--radius-m:12px;--background-primary:${dark?'#222':'#fff'};--background-secondary:#777;--text-normal:${dark?'#eee':'#222'};--text-muted:#888;--background-modifier-cover:rgba(30,40,50,.3);--background-modifier-border:#888;--interactive-accent:#a36}
.modal-container{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;z-index:var(--layer-modal)}.modal-bg{position:absolute;inset:0;width:100%;height:100%;background:var(--background-modifier-cover);opacity:.6;backdrop-filter:blur(2px)}.modal{position:relative;background:var(--background-primary);padding:16px}.modal-content{overflow:auto}.modal-close-button{position:absolute;right:4px;top:4px}button,input,textarea{min-height:28px} .rows{height:120px}
</style><style>${css}</style><button id="outside">Open</button><div id="owner" class="modal-container operon-${surface==='subtasks'?'subtasks-filter':'task-'+surface}-modal-container"><div class="modal-bg" style="opacity:0.85"></div><div id="modal" class="modal operon-${surface==='subtasks'?'subtasks-filter':'task-'+surface}-modal"><div class="modal-close-button">Existing control</div><div class="modal-content"><div class="${surface==='editor'?'operon-task-editor-shell':''}"><input id="draft" value="Unsaved draft"><button id="picker-anchor">Property/template</button><div class="rows"></div><textarea id="note">Note draft</textarea><button id="cancel">Existing Cancel</button></div></div></div></div>`);
   await page.evaluate(()=>{
    document.win=window;window.activeDocument=document;window.activeWindow=window;
    Object.defineProperty(Node.prototype,'doc',{get(){return this.ownerDocument||document;}});Object.defineProperty(Node.prototype,'win',{get(){return this.doc.defaultView;}});
    Element.prototype.createEl=function(tag,o){const el=document.createElement(tag);if(typeof o==='string')el.className=o;else if(o){if(o.cls)el.className=o.cls;if(o.text)el.textContent=o.text;for(const[k,v]of Object.entries(o.attr||{}))el.setAttribute(k,v);}this.appendChild(el);return el;};
    Element.prototype.createDiv=function(o){return this.createEl('div',o);};Element.prototype.createSpan=function(o){return this.createEl('span',o);};Element.prototype.addClass=function(...n){this.classList.add(...n);};Element.prototype.removeClass=function(...n){this.classList.remove(...n);};Element.prototype.toggleClass=function(n,b){this.classList.toggle(n,b);};Element.prototype.setText=function(t){this.textContent=t;};Element.prototype.setCssStyles=function(s){Object.assign(this.style,s);};Element.prototype.empty=function(){this.replaceChildren();};window.createSpan=o=>document.body.createSpan(o);window.createEl=(t,o)=>document.body.createEl(t,o);
   });
   await page.addScriptTag({content:bundle.outputFiles[0].text});
   const result = await page.evaluate(({desktop,surface})=>{
    Subject.Platform.isDesktopApp=desktop;
    const owner=document.getElementById('owner'),modal=document.getElementById('modal'),draft=document.getElementById('draft'),note=document.getElementById('note'),rows=document.querySelector('.rows');
    const geometry=()=>[...owner.querySelectorAll('*')].filter(e=>!e.classList.contains('modal-bg')).map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return[r.x,r.y,r.width,r.height,s.borderRadius,s.overflowX,s.overflowY,s.position,s.transform,s.zIndex];});
    const bg=()=>{const s=getComputedStyle(owner.firstElementChild);return[s.backgroundColor,s.opacity,s.backdropFilter];};
    const before=geometry(),original=bg(),controls=owner.querySelectorAll('button,.modal-close-button').length;
    draft.focus();draft.setSelectionRange(2,5);window.release=Subject.applyDesktopModalBackdrop(owner);
    const after=geometry(),effect=bg();let parity=true;const widths=[];
    for(const height of [0,1400,280]){
     rows.style.height=height+'px';note.hidden=height===0;
     widths.push(modal.getBoundingClientRect().width);const active=geometry();release();const without=geometry();parity&&=JSON.stringify(active)===JSON.stringify(without);window.release=Subject.applyDesktopModalBackdrop(owner);
    }
    const child=owner.createDiv('modal-container');const childBg=child.createDiv('modal-bg');const childStyle=getComputedStyle(childBg);const childUnchanged=childStyle.opacity==='0.6'&&childStyle.backdropFilter==='blur(2px)';child.remove();
    const frame=document.createElement('iframe');document.body.appendChild(frame);const foreign=frame.contentDocument.createElement('div');frame.contentDocument.body.append(foreign);foreign.addClass=(c)=>foreign.classList.add(c);foreign.removeClass=(c)=>foreign.classList.remove(c);const cleanForeign=Subject.applyDesktopModalBackdrop(foreign);cleanForeign();const isolated=owner.classList.contains('operon-focus-modal')===desktop;frame.remove();
    return{before,after,original,effect,parity,widths,childUnchanged,isolated,controlsUnchanged:controls===owner.querySelectorAll('button,.modal-close-button').length,noRail:owner.querySelectorAll('.operon-task-media-lightbox-control').length===0,selection:[document.activeElement.id,draft.selectionStart,draft.selectionEnd,draft.value]};
   },{desktop,surface});
   if(surface==='editor'&&width===1440)assert.ok(result.widths.every(value=>value===result.widths[0]),'Editor width stays fixed as content height changes');
   assert.deepEqual(result.before,result.after);assert.ok(result.parity);assert.ok(result.childUnchanged);assert.ok(result.isolated);assert.ok(result.controlsUnchanged);assert.ok(result.noRail);
   assert.deepEqual(result.effect,desktop?['rgba(0, 0, 0, 0.5)','1','none']:result.original);
   assert.deepEqual(result.selection,['draft',2,5,'Unsaved draft']);
   // Real shared picker and lightbox helpers must still use the existing hosts and focus path.
   await page.evaluate(()=>{
    document.querySelector('.rows').style.height='40px';document.getElementById('note').hidden=false;
    const anchor=document.getElementById('picker-anchor');window.picker=Subject.createFloatingPanel(anchor,'operon-floating-panel',()=>{});picker.panel.id='panel';picker.panel.createEl('input',{attr:{id:'picker-input'}}).focus();
   });
   const picker = await page.evaluate(()=>{const p=document.getElementById('panel'),s=getComputedStyle(p),r=p.getBoundingClientRect();return{owner:document.getElementById('owner').contains(p),focus:document.activeElement.id,visible:s.display!=='none'&&r.width>0};});
   assert.deepEqual(picker,{owner:true,focus:'picker-input',visible:true});
   await page.evaluate(()=>picker.close());
   await page.evaluate(()=>{
    window.modalScope={name:'underlying-modal'};window.scopeStack=[modalScope];window.parentCloses=0;
    window.app={scope:{name:'app'},keymap:{pushScope(s){scopeStack.push(s);},popScope(s){scopeStack.splice(scopeStack.indexOf(s),1);}}};
    // Model the native modal's keymap trap, which runs before document bubble handlers.
    document.addEventListener('keydown',e=>{
     if(e.key==='Escape'&&scopeStack.at(-1)===modalScope){window.parentCloses++;}
     for(const handler of scopeStack.at(-1)?.handlers||[]){
      if(handler.key===e.key&&handler.callback(e)===false){e.preventDefault();break;}
     }
    },true);
   });
   await page.locator('#note').focus();
   await page.evaluate(()=>{window.previewClosed=0;window.closePreview=Subject.openLightbox(document.getElementById('note'),{title:'Preview',className:'is-native',nativeView:true,onDispose(){window.previewClosed++;},render(shell){shell.createDiv('operon-task-media-lightbox-content operon-native-lightbox-host').createEl('button',{text:'Content'});return null;}});});
   assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('.operon-task-media-lightbox')).backgroundColor),desktop?'rgba(0, 0, 0, 0.55)':'rgba(0, 0, 0, 0.82)');
   if(desktop){
    assert.equal(await page.evaluate(()=>document.activeElement===document.querySelector('.operon-task-media-lightbox')),true,'opening focuses shell, not management controls');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('operon-task-media-lightbox-close')&&document.activeElement.matches(':focus-visible')),true,'keyboard users can still focus Close');
    await page.locator('#outside').evaluate(el=>el.focus());
    assert.equal(await page.evaluate(()=>document.activeElement===document.querySelector('.operon-task-media-lightbox')),true,'escaped focus returns to shell');
    const layers=await page.evaluate(()=>{
     const shell=document.querySelector('.operon-task-media-lightbox'),button=shell.querySelector('.operon-task-media-lightbox-content button'),r=button.getBoundingClientRect();
     return{top:shell.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),z:getComputedStyle(shell).zIndex,scope:scopeStack.length};
    });
    assert.deepEqual(layers,{top:true,z:'50',scope:2});
    await page.locator('.operon-task-media-lightbox-content button').click();
    await page.evaluate(()=>{const anchor=document.querySelector('.operon-task-media-lightbox-content button');window.previewPicker=Subject.createFloatingPanel(anchor,'operon-floating-panel',()=>{});previewPicker.panel.id='preview-picker';previewPicker.panel.createEl('input',{attr:{id:'preview-picker-input'}}).focus();});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(await page.locator('#preview-picker').evaluate(el=>!!el.closest('.operon-native-lightbox-host')),true);
    await page.evaluate(()=>{
     const anchor=previewPicker.panel.createEl('button',{text:'Nested picker'});
     window.nestedPicker=Subject.createFloatingPanel(anchor,'operon-floating-panel',()=>{});
     nestedPicker.panel.id='nested-picker';nestedPicker.panel.createEl('input',{attr:{id:'nested-picker-input'}}).focus();
    });
    await page.keyboard.press('Escape');
    assert.deepEqual(await page.evaluate(()=>[!!document.getElementById('nested-picker'),!!document.getElementById('preview-picker'),previewClosed]),[false,true,0],'only the top picker consumes Escape');
    await page.keyboard.press('Escape');
    assert.deepEqual(await page.evaluate(()=>[!!document.getElementById('preview-picker'),window.previewClosed,window.parentCloses,scopeStack.length]),[false,0,0,2]);
    // A native dialog opened afterwards is above the preview; closing it keeps the preview.
    await page.evaluate(()=>{window.confirmDialog=document.body.createDiv('modal-container');confirmDialog.createDiv('modal-bg');confirmDialog.createDiv('modal').createEl('button',{text:'Confirm',attr:{id:'confirmation'}});window.confirmScope={};app.keymap.pushScope(confirmScope);document.getElementById('confirmation').focus();});
    assert.equal(await page.locator('#confirmation').evaluate(el=>{const r=el.getBoundingClientRect();return el===document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);}),true);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(()=>window.previewClosed),0);
    await page.evaluate(()=>{app.keymap.popScope(confirmScope);confirmDialog.remove();document.querySelector('.operon-task-media-lightbox-content button').focus();});
    // Child native/web/media previews inherit the modal layer and release only their scope.
    for(const kind of ['is-native','is-web','is-image']){
     await page.evaluate(kind=>{const link=document.querySelector('.operon-task-media-lightbox:not([hidden]):not([inert]) .operon-task-media-lightbox-content button');window.closeChild=Subject.openLightbox(link,{title:'Child',className:kind,render(shell){shell.createDiv('operon-task-media-lightbox-content').createEl('button',{text:'Child',attr:{id:'child-content'}});return null;}});},kind);
     assert.deepEqual(await page.locator('#child-content').evaluate(el=>{const r=el.getBoundingClientRect(),shell=el.closest('.operon-task-media-lightbox');return[getComputedStyle(shell).zIndex,shell.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),scopeStack.length];}),['50',true,3]);
     await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>scopeStack.length),2);
    }
   }
   await page.keyboard.press('Escape');
   if(desktop)assert.deepEqual(await page.evaluate(()=>[window.parentCloses,scopeStack.length]),[0,1]);
   assert.deepEqual(await page.evaluate(()=>[window.previewClosed,document.activeElement.id,document.getElementById('note').value]),[1,'note','Note draft']);
   if(desktop){
    // Standalone sources own Escape even when their editor would consume it.
    await page.evaluate(()=>{
     window.nativeConsumes=0;window.standaloneClosed=0;
     window.standaloneClose=Subject.openLightbox(document.getElementById('outside'),{title:'Source only',nativeView:true,render(shell){
      const host=shell.createDiv('operon-task-media-lightbox-content operon-native-lightbox-host');
      const input=host.createEl('textarea',{attr:{id:'native-source'}});
      input.addEventListener('keydown',e=>{if(e.key==='Escape'){nativeConsumes++;e.preventDefault();e.stopPropagation();}});
      return null;
     },onDispose(){standaloneClosed++;}});
     document.getElementById('native-source').focus();
    });
    await page.locator('#native-source').evaluate(el=>el.classList.add('operon-compact-markdown-editor'));
    await page.keyboard.press('Escape');
    assert.deepEqual(await page.evaluate(()=>[standaloneClosed,nativeConsumes,scopeStack.length]),[0,1,2],'compact editor keeps its own Escape interaction');
    await page.locator('#native-source').evaluate(el=>{
     el.classList.remove('operon-compact-markdown-editor');
     const suggestions=el.parentElement.createDiv('cm-tooltip-autocomplete');suggestions.textContent='Native suggestion';
     el.addEventListener('keydown',()=>suggestions.remove(),{once:true});
    });
    await page.keyboard.press('Escape');
    assert.deepEqual(await page.evaluate(()=>[standaloneClosed,nativeConsumes,scopeStack.length]),[0,2,2],'native autocomplete consumes Escape first');
    await page.keyboard.press('Escape');
    assert.deepEqual(await page.evaluate(()=>[standaloneClosed,nativeConsumes,scopeStack.length,parentCloses]),[1,2,1,0]);
    // Real dimming events keep the existing preference queue without numeric controls.
    await page.evaluate(()=>{
     window.savedDimming=50;window.dimmingWrites=[];window.failDimming=false;
     window.unbindDimming=Subject.bindDesktopBackdropDimmingPreference({get:()=>savedDimming,save:async value=>{if(failDimming)throw Error('save rejected');dimmingWrites.push(value);savedDimming=value;}});
     window.dimClose=Subject.openLightbox(document.getElementById('note'),{title:'Dimming controls',className:'is-native',onOpenInTab:async()=>null,onOpenToRight:async()=>null,onOpenBelow:async()=>null,render(shell){const content=shell.createDiv('operon-task-media-lightbox-content');content.style.cssText='width:220px;height:180px';content.createEl('button',{attr:{id:'dim-child-anchor'}});return null;}});
    });
    const dimValue=()=>page.evaluate(()=>String(Subject.getDesktopBackdropDimming()));
    assert.equal(await page.locator('.operon-lightbox-dimming-value').count(),0);
    assert.equal(await dimValue(),'50');
    // Content without an explicit profile remains local and never touches the dimming preference queue.
    await page.locator('.operon-task-media-lightbox-content').evaluate(el=>{el.style.width='67vw';el.style.height='67vh';});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const dimensions=()=>page.locator('.operon-task-media-lightbox:not([hidden]):not([inert]) > .operon-task-media-lightbox-content').evaluate(el=>{const r=el.getBoundingClientRect();return{width:r.width/innerWidth*100,height:r.height/innerHeight*100};});
    const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<.1,`${actual} vs ${expected}`);
    let dims=await dimensions();near(dims.width,67);near(dims.height,67);
    await page.mouse.move(8,8);
    await page.locator('.operon-lightbox-width-increase').click();near((await dimensions()).width,70);
    await page.mouse.move(8,8);
    await page.locator('.operon-lightbox-width-decrease').click();near((await dimensions()).width,65);
    await page.mouse.move(8,8);
    await page.locator('.operon-lightbox-height-increase').click();near((await dimensions()).height,70);
    await page.mouse.move(8,8);
    await page.locator('.operon-lightbox-height-decrease').click();near((await dimensions()).height,65);
    const positions=await page.evaluate(()=>{
     const rect=el=>{const r=el.getBoundingClientRect();return{left:r.left,top:r.top,right:r.right,bottom:r.bottom};};
     return {frame:rect(document.querySelector('.operon-task-media-lightbox-content')),widthDown:rect(document.querySelector('.operon-lightbox-width-decrease')),widthUp:rect(document.querySelector('.operon-lightbox-width-increase')),heightUp:rect(document.querySelector('.operon-lightbox-height-increase')),heightDown:rect(document.querySelector('.operon-lightbox-height-decrease'))};
    });
    assert.ok(Math.abs((positions.widthDown.left+positions.widthUp.right)/2-(positions.frame.left+positions.frame.right)/2)<1);
    assert.ok(Math.abs((positions.heightUp.top+positions.heightDown.bottom)/2-(positions.frame.top+positions.frame.bottom)/2)<1);
    assert.deepEqual(await page.evaluate(()=>dimmingWrites),[]);
    await page.evaluate(()=>{window.sizeChild=Subject.openLightbox(document.getElementById('dim-child-anchor'),{title:'Independent child',render(shell){const child=shell.createDiv('operon-task-media-lightbox-content');child.style.cssText='width:67vw;height:67vh';return null;}});});
    near((await dimensions()).width,67);
    await page.mouse.move(8,8);
    await page.locator('.operon-task-media-lightbox:not([hidden]):not([inert]) .operon-lightbox-width-increase').click();near((await dimensions()).width,70);
    await page.evaluate(()=>sizeChild());near((await dimensions()).width,65);
    // Unprofiled test shells keep their original content geometry on reopen.
    await page.evaluate(()=>{window.sizeChild=Subject.openLightbox(document.getElementById('dim-child-anchor'),{title:'Reopened child',render(shell){const child=shell.createDiv('operon-task-media-lightbox-content');child.style.cssText='width:67vw;height:67vh';return null;}});});
    near((await dimensions()).width,67);await page.evaluate(()=>sizeChild());
    for(const axis of ['width','height']){
     const increase=page.locator(`.operon-lightbox-${axis}-increase`),decrease=page.locator(`.operon-lightbox-${axis}-decrease`);
     await page.mouse.move(8,8);
     for(let i=0;i<12&&await increase.isEnabled();i++){await page.mouse.move(8,8);await increase.click();}
     assert.equal(await increase.isDisabled(),true);assert.ok((await dimensions())[axis]<=90.1);
     await page.mouse.move(8,8);
     for(let i=0;i<12&&await decrease.isEnabled();i++){await page.mouse.move(8,8);await decrease.click();}
     assert.equal(await decrease.isDisabled(),true);near((await dimensions())[axis],40);
    }
    assert.deepEqual(await page.evaluate(()=>dimmingWrites),[]);
    await page.locator('.operon-task-media-lightbox-content').evaluate(el=>{el.style.width='220px';});
    await page.locator('.operon-task-media-lightbox-content').evaluate(el=>{el.style.height='600px';});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const groups=await page.locator('.operon-task-media-lightbox:not([hidden]):not([inert])').evaluate(shell=>{
     const content=shell.querySelector('.operon-task-media-lightbox-content').getBoundingClientRect();
     const upper=shell.querySelector('.operon-task-media-lightbox-close').getBoundingClientRect();
     const lower=shell.querySelector('.operon-lightbox-dimming-decrease').getBoundingClientRect();
     return {topInset:upper.top-content.top,bottomInset:content.bottom-lower.bottom,leftDelta:Math.abs(upper.left-lower.left)};
    });
    assert.ok(Math.abs(groups.topInset-8)<1&&Math.abs(groups.bottomInset-8)<1&&groups.leftDelta<1,JSON.stringify(groups));
    await page.evaluate(()=>document.activeElement?.blur());
    await page.mouse.move(8,8);
    await page.locator('.operon-lightbox-dimming-increase').hover();assert.equal(await page.locator('.operon-hover-tooltip').count(),0);
    await page.mouse.move(8,8);
    await page.locator('.operon-lightbox-dimming-decrease').hover();assert.equal(await page.locator('.operon-hover-tooltip').count(),0);
    await page.evaluate(()=>{const plus=document.querySelector('.operon-lightbox-dimming-increase');for(let i=0;i<5;i++)plus.click();});
    await page.waitForFunction(()=>savedDimming===80);
    assert.deepEqual(await page.evaluate(()=>dimmingWrites),[55,60,65,70,80]);assert.equal(await dimValue(),'80');
    await page.evaluate(async()=>{await Subject.saveDesktopBackdropDimming(35);});assert.equal(await dimValue(),'35');
    await page.evaluate(()=>{window.dimChild=Subject.openLightbox(document.getElementById('dim-child-anchor'),{title:'Nested dimming',render(shell){shell.createDiv('operon-task-media-lightbox-content').setText('Child');return null;}});});
    assert.equal(await dimValue(),'35');
    assert.equal(await page.locator('.operon-task-media-lightbox:not([hidden]):not([inert])').evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0.45)');
    await page.mouse.move(8,8);
    await page.locator('.operon-task-media-lightbox:not([hidden]):not([inert]) .operon-lightbox-dimming-decrease').click();
    await page.waitForFunction(()=>savedDimming===30);await page.evaluate(()=>dimChild());assert.equal(await dimValue(),'30');
    await page.mouse.move(8,8);
    await page.evaluate(()=>{failDimming=true;document.querySelector('.operon-lightbox-dimming-increase').click();});
    await page.waitForTimeout(20);assert.equal(await dimValue(),'30');assert.equal(await page.evaluate(()=>savedDimming),30);
    await page.evaluate(async()=>{failDimming=false;await Subject.saveDesktopBackdropDimming(10);});
    assert.equal(await page.locator('.operon-lightbox-dimming-decrease').isDisabled(),true);
    await page.locator('.operon-lightbox-dimming-increase').focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>savedDimming===20);
    await page.locator('.operon-lightbox-dimming-decrease').focus();await page.keyboard.press('Space');await page.waitForFunction(()=>savedDimming===10);
    await page.evaluate(async()=>{await Subject.saveDesktopBackdropDimming(90);});
    assert.equal(await page.locator('.operon-lightbox-dimming-increase').isDisabled(),true);
    await page.setViewportSize({width,height:220});
    await page.waitForTimeout(20);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const compactRail=await page.locator('.operon-task-media-lightbox:not([hidden]):not([inert])').evaluate(shell=>[...shell.querySelectorAll('.operon-task-media-lightbox-control')].map(el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,width:r.width,height:innerHeight,cls:el.className};}));
    assert.ok(compactRail.every(r=>r.top>=7&&r.bottom<=r.height-7&&r.width>=24),JSON.stringify(compactRail));
    await page.evaluate(()=>{dimClose();unbindDimming();});await page.setViewportSize({width,height:800});
    // Native Modal.open overwrites opacity after onOpen; the helper must correct it before paint.
    await page.evaluate(()=>document.querySelector('#owner > .modal-bg').style.opacity='0.85');
    assert.equal(await page.locator('#owner > .modal-bg').evaluate(e=>getComputedStyle(e).opacity),'1');
    for(const base of [10,20,30,35,40,45,50,55,60,65,70,80,90]){
     await page.evaluate(base=>Subject.updateDesktopBackdropDimming(base),base);
     const expected=level=>`rgba(0, 0, 0, ${Math.min(90,base+5*(level-1))/100})`;
     assert.equal(await page.locator('#owner > .modal-bg').evaluate(e=>getComputedStyle(e).backgroundColor),expected(1));
     await page.evaluate(()=>{window.chain=[];window.nextAnchor=document.getElementById('note');});
     for(let depth=2;depth<=7;depth++){
      await page.evaluate(()=>{
       let shell;const close=Subject.openLightbox(window.nextAnchor,{title:'Nested',className:'is-native',render(el){shell=el;window.nextAnchor=el.createEl('button',{text:'Next'});return null;}});
       window.chain.push({shell,close});
      });
      assert.equal(await page.evaluate(()=>getComputedStyle(chain.at(-1).shell).backgroundColor),expected(depth));
      assert.equal(await page.locator('#owner > .modal-bg').evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)');
      if(depth===3){
       await page.evaluate(()=>Subject.updateDesktopBackdropDimming(80));
       assert.equal(await page.evaluate(()=>getComputedStyle(chain.at(-1).shell).backgroundColor),'rgba(0, 0, 0, 0.9)');
       await page.evaluate(base=>Subject.updateDesktopBackdropDimming(base),base);
      }

     }
     for(let depth=7;depth>=2;depth--){
      await page.evaluate(async()=>await chain.pop().close());
      assert.equal(await page.evaluate(()=>getComputedStyle(chain.length?chain.at(-1).shell:document.querySelector('#owner > .modal-bg')).backgroundColor),expected(depth-1));
     }
    }
    // Modal above a lightbox shares the chain; owner removal is cleaned even without onClose.
    await page.evaluate(()=>{
     Subject.updateDesktopBackdropDimming(70);
     window.outerClose=Subject.openLightbox(document.getElementById('note'),{title:'Outer',render(el){el.createEl('button',{text:'Next'});return null;}});
     window.extra=document.body.createDiv('modal-container');extra.createDiv('modal-bg');window.releaseExtra=Subject.applyDesktopModalBackdrop(extra);
    });
    assert.equal(await page.evaluate(()=>getComputedStyle(extra.firstElementChild).backgroundColor),'rgba(0, 0, 0, 0.8)');
    await page.evaluate(()=>extra.remove());
    assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('.operon-task-media-lightbox:not([hidden]):not([inert])')).backgroundColor),'rgba(0, 0, 0, 0.75)');
    await page.evaluate(()=>{releaseExtra();outerClose();});
    // Explicit ancestry through a newly opened modal must preserve the outer native preview.
    await page.evaluate(()=>{
     window.outerClose=Subject.openLightbox(document.getElementById('note'),{title:'Outer',render(el){el.createEl('button',{text:'Outer'});return null;}});
     window.extra=document.body.createDiv('modal-container');extra.createDiv('modal-bg');window.extraAnchor=extra.createEl('button',{text:'Modal link'});window.releaseExtra=Subject.applyDesktopModalBackdrop(extra);
     window.modalChild=Subject.openLightbox(extraAnchor,{title:'Modal child',render(el){el.createEl('button',{text:'Child'});return null;}});
    });
    assert.equal(await page.evaluate(()=>document.querySelectorAll('.operon-task-media-lightbox').length),2);
    assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('.operon-task-media-lightbox:not([hidden]):not([inert])')).backgroundColor),'rgba(0, 0, 0, 0.85)');
    await page.evaluate(()=>{modalChild();releaseExtra();extra.remove();outerClose();});
    // A second document starts at depth one, independent from this document's modal.
    const foreign=await page.evaluate(()=>{
     const frame=document.createElement('iframe');document.body.appendChild(frame);
     const shell=frame.contentDocument.createElement('div');frame.contentDocument.body.appendChild(shell);
     const clean=Subject.registerDesktopBackdrop(shell);
     const own=getComputedStyle(document.querySelector('#owner > .modal-bg')).backgroundColor;
     const other=frame.contentWindow.getComputedStyle(shell).getPropertyValue('--operon-focus-backdrop').trim();
     frame.contentWindow.dispatchEvent(new Event('pagehide'));
     clean();frame.remove();return{own,other};
    });
    assert.deepEqual(foreign,{own:'rgba(0, 0, 0, 0.7)',other:'rgba(0, 0, 0, 0.7)'});
    // Retained failed/pending saves keep their layer until actual close succeeds.
    await page.evaluate(()=>{window.saveAllowed=false;window.guarded=Subject.openLightbox(document.getElementById('note'),{title:'Pending',beforeClose:()=>Promise.resolve(saveAllowed),render(el){el.createEl('button',{text:'Save'});return null;}});});
    assert.equal(await page.evaluate(()=>guarded()),false);
    assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('.operon-task-media-lightbox')).backgroundColor),'rgba(0, 0, 0, 0.75)');
    await page.evaluate(async()=>{saveAllowed=true;await guarded();});
    // Unload followed by a new registration must not be invalidated by an old cleanup.
    await page.evaluate(()=>{
     Subject.disposeDesktopBackdrops();window.freshRelease=Subject.applyDesktopModalBackdrop(document.getElementById('owner'));release();window.release=freshRelease;
     Subject.updateDesktopBackdropDimming(60);
    });
    assert.equal(await page.locator('#owner > .modal-bg').evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0.6)');
    await page.evaluate(()=>Subject.updateDesktopBackdropDimming(70));

   }
   if(desktop && surface==='creator' && !dark && width===1440){
    await page.setViewportSize({width:1440,height:1000});
    await page.route('https://example.com/**', ()=>{}); // Hold test-only media loads; aborting video would intentionally close its preview.
    await page.evaluate(()=>{
     window.sizePreferences={};window.sizeWrites=[];window.failSize=false;app.workspace={getMostRecentLeaf:()=>({parent:{},view:{containerEl:document.body}}),iterateAllLeaves(){}};
     window.unbindSize=Subject.bindLightboxSizePreference({get:()=>sizePreferences,save:async(profile,axis,value)=>{
      sizeWrites.push({profile,axis,value});if(failSize)throw Error('rejected');
      sizePreferences={...sizePreferences,[profile]:{...sizePreferences[profile],[axis]:value}};
     }});
     window.openProfile=(profile)=>{
      if(['image','video','youtube','pdf'].includes(profile)){
       Subject.openTaskMediaLightbox(app,document.getElementById('note'),{kind:profile,label:profile,url:profile==='image'?'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"/>'):'https://example.com/'+profile});
       window.closeProfile=()=>Subject.disposeAppLightboxes(app);
      }else window.closeProfile=Subject.openLightbox(document.getElementById('note'),{title:profile,render(shell){
       const host=shell.createDiv('operon-task-media-lightbox-content '+(profile==='web'?'operon-web-lightbox-host':'operon-native-lightbox-host')+' is-'+profile);
       Subject.applyLightboxSizeProfile(shell,profile);return null;
      }});
     };
    });
    const content=()=>page.locator('.operon-task-media-lightbox:not([hidden]):not([inert]) > :is(.operon-task-media-lightbox-content,img)');
    const dims=()=>content().evaluate(el=>({width:el.offsetWidth,height:el.offsetHeight}));
    for(const profile of ['markdown','base','table','web','pdf','image','video','youtube']){
     await page.evaluate(profile=>{sizePreferences[profile]={width:75,height:85};openProfile(profile);},profile);
     const first=await dims();assert.ok(Math.abs(first.width-1080)<1,JSON.stringify({profile,first}));assert.ok(Math.abs(first.height-850)<1,JSON.stringify({profile,first}));
     assert.equal(await page.evaluate(()=>sizeWrites.length),0,'opening never saves');
     await page.mouse.move(8,8);
     await page.locator('.operon-lightbox-width-increase').click();assert.ok(Math.abs((await dims()).width-1152)<1);
     await page.mouse.move(8,8);
     await page.locator('.operon-lightbox-height-decrease').click();assert.ok(Math.abs((await dims()).height-800)<1);
     await page.mouse.move(8,8);
     await page.locator('.operon-lightbox-width-increase').click();assert.ok(Math.abs((await dims()).width-1224)<1);
     assert.deepEqual(await page.evaluate(profile=>sizePreferences[profile],profile),{width:85,height:80});
     assert.equal(await page.evaluate(()=>sizeWrites.length),3);await page.evaluate(()=>closeProfile());
     await page.evaluate(profile=>openProfile(profile),profile);assert.deepEqual(await dims(),{width:1224,height:800});
     await page.setViewportSize({width:420,height:300});
     const clamped=await dims();assert.ok(clamped.width<=324&&clamped.height<=204);
     assert.equal(await page.evaluate(()=>sizeWrites.length),3,'viewport clamp never saves');
     assert.deepEqual(await page.evaluate(profile=>sizePreferences[profile],profile),{width:85,height:80});
     await page.evaluate(()=>closeProfile());await page.setViewportSize({width:1440,height:1000});
     await page.evaluate(()=>{sizeWrites=[];});
    }
    // Single-axis image restoration preserves the untouched natural frame, including a cold image load.
    await page.evaluate(()=>{delete sizePreferences.image;openProfile('image');});
    await page.waitForFunction(()=>document.querySelector('.operon-task-media-lightbox img')?.naturalWidth===40);
    await page.mouse.move(8,8);
    await page.locator('.operon-lightbox-width-increase').click();const imageFrame=await dims();
    assert.deepEqual(imageFrame,{width:576,height:40});
    assert.deepEqual(await page.evaluate(()=>sizePreferences.image),{width:40});
    await page.evaluate(()=>closeProfile());await page.evaluate(()=>openProfile('image'));
    await page.waitForFunction(()=>document.querySelector('.operon-task-media-lightbox img')?.naturalWidth===40);
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    assert.deepEqual(await dims(),imageFrame);await page.evaluate(()=>closeProfile());
    // A failed write keeps the visible frame but reopening uses the last committed preference.
    await page.evaluate(()=>{sizeWrites=[];failSize=true;openProfile('table');});
    await page.mouse.move(8,8);
    await page.locator('.operon-lightbox-width-increase').click();assert.deepEqual(await dims(),{width:1296,height:800});
    assert.deepEqual(await page.evaluate(()=>sizePreferences.table),{width:85,height:80});
    await page.evaluate(()=>closeProfile());await page.evaluate(()=>{failSize=false;openProfile('table');});
    assert.deepEqual(await dims(),{width:1224,height:800});
    // Reapplying the same profile must not reset an in-flight user resize. A successful type switch resets only owned overrides.
    await content().evaluate(el=>{el.style.width='70vw';Subject.applyLightboxSizeProfile(el.parentElement,'table');});
    assert.ok(Math.abs((await dims()).width-1008)<1);
    await content().evaluate(el=>{el.classList.remove('is-table');el.classList.add('is-base');Subject.applyLightboxSizeProfile(el.parentElement,'base');});
    assert.deepEqual(await dims(),{width:1224,height:800});
    await page.evaluate(()=>closeProfile());
    // Mobile ignores even an existing saved desktop profile.
    await page.evaluate(()=>{Subject.Platform.isDesktopApp=false;openProfile('table');});
    assert.equal(await content().evaluate(el=>el.style.width),'');assert.equal(await page.locator('.operon-lightbox-size-control').count(),0);
    await page.evaluate(()=>{closeProfile();Subject.Platform.isDesktopApp=true;unbindSize();});
   }
   for(const height of [320,900]){
    await page.setViewportSize({width,height});
    assert.equal(await page.evaluate(()=>{const r=document.querySelector('#owner > .modal-bg').getBoundingClientRect();return r.left<=0&&r.top<=0&&r.right>=innerWidth&&r.bottom>=innerHeight;}),true);
   }
   await page.evaluate(()=>{release();release();});
   assert.equal(await page.locator('#owner').evaluate(e=>e.classList.contains('operon-focus-modal')),false);
   scenarios++;
  } finally { await page.close(); }
 }
 console.log(JSON.stringify({ok:true,scenarios}));
} finally { await browser.close(); }
