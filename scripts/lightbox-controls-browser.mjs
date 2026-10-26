import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.OPERON_TEST_PLAYWRIGHT||'playwright');
const css=readFileSync(path.join(root,'styles.css'),'utf8');
const bundle=await build({stdin:{contents:"export * from './src/ui/lightbox';export * from './src/core/lightbox-size';export * from './src/ui/modal-backdrop';export * from './src/ui/field-pickers/common';export {Platform} from 'obsidian';",resolveDir:root},bundle:true,write:false,format:'iife',globalName:'Subject',platform:'browser',logLevel:'silent',alias:{obsidian:path.join(root,'scripts/test-support/obsidian.ts')}});
const browser=await chromium.launch({headless:true,...(process.env.OPERON_TEST_BROWSER?{executablePath:process.env.OPERON_TEST_BROWSER}:{})});
let scenarios=0, mirroredScenarios=0;
try {
 for(const dark of [false,true])for(const width of [420,1440])for(const profile of ['markdown','base','table','web','pdf','image','video','youtube']){
  const page=await browser.newPage({viewport:{width,height:width===420?300:900}});
  try {
   await page.route('https://fixture.invalid/**',route=>route.fulfill({contentType:'text/html',body:'<html><body style="margin:0;height:100vh;background:#aaa"><button>Frame content</button></body></html>'}));
   await page.setContent(`<style>body{margin:0;--background-primary:${dark?'#222':'#fff'};--background-secondary:${dark?'#292929':'#ececec'};--background-secondary-alt:${dark?'#333':'#ddd'};--background-modifier-border:#777;--background-modifier-border-hover:#888;--text-normal:${dark?'#eee':'#222'};--text-faint:#888;--radius-m:12px;--layer-popover:30;--layer-modal:50;--interactive-accent:#d000ff}button{background-image:linear-gradient(red,blue);border:1px solid red;box-shadow:0 0 10px red;filter:saturate(8)}</style><style>${css}</style><button id="anchor">Source</button>`);
   await page.evaluate(()=>{
    document.win=window;window.activeDocument=document;window.activeWindow=window;
    Object.defineProperty(Node.prototype,'doc',{get(){return this.ownerDocument||document;}});Object.defineProperty(Node.prototype,'win',{get(){return this.doc.defaultView;}});
    Element.prototype.createEl=function(tag,o){const el=document.createElement(tag);if(typeof o==='string')el.className=o;else if(o){if(o.cls)el.className=o.cls;if(o.text)el.textContent=o.text;for(const[k,v]of Object.entries(o.attr||{}))el.setAttribute(k,v);}this.appendChild(el);return el;};
    Element.prototype.createDiv=function(o){return this.createEl('div',o);};Element.prototype.createSpan=function(o){return this.createEl('span',o);};Element.prototype.addClass=function(...n){this.classList.add(...n);};Element.prototype.removeClass=function(...n){this.classList.remove(...n);};Element.prototype.toggleClass=function(n,b){this.classList.toggle(n,b);};Element.prototype.setText=function(t){this.textContent=t;};Element.prototype.setCssStyles=function(s){Object.assign(this.style,s);};window.createSpan=o=>document.body.createSpan(o);window.createEl=(t,o)=>document.body.createEl(t,o);
   });
   await page.addScriptTag({content:bundle.outputFiles[0].text});
   await page.evaluate(profile=>{
    Subject.Platform.isDesktopApp=true;window.previewCloses=0;window.writes=0;window.controlPresses=[];window.controlSide='right';window.transfers=[];
    Subject.bindLightboxSizePreference({get:()=>({}),controlsSide:()=>window.controlSide,save:async()=>{writes++;}});
    document.addEventListener('pointerdown',event=>{const control=event.composedPath().find(el=>el instanceof HTMLElement&&el.classList.contains('operon-task-media-lightbox-control'));if(control)controlPresses.push(getComputedStyle(control).opacity);},true);
    Subject.bindDesktopBackdropDimmingPreference({get:()=>50,save:async()=>{writes++;}});
    document.getElementById('anchor').focus();
    window.previewOptions={title:profile,nativeView:true,className:'is-'+profile,onOpenInTab:async()=>{transfers.push('tab');return null;},onOpenToRight:async()=>{transfers.push('right');return null;},onOpenBelow:async()=>{transfers.push('below');return null;},onDispose(){window.previewCloses++;},render(shell){
     const host=profile==='image'?shell.createEl('img',{attr:{src:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"/>')}}):shell.createDiv('operon-task-media-lightbox-content');
     if(['markdown','base','table'].includes(profile))host.addClass('operon-native-lightbox-host');
     host.id='content';host.style.width='min(65vw, calc(100vw - 96px))';host.style.height='min(65vh, calc(100vh - 96px))';
     if(['web','pdf','youtube'].includes(profile))host.createEl('iframe',{attr:{src:'https://fixture.invalid/frame'}});
     else if(profile==='video')host.createEl('video',{attr:{controls:''}});
     else if(profile!=='image')host.createEl('input',{attr:{id:'content-input',value:'Unsaved draft'}});
     return null;
    }};
    window.closePreview=Subject.openLightbox(document.getElementById('anchor'),window.previewOptions);
    // Model the real setIcon SVG path, including a target that is not an HTMLElement.
    for(const control of document.querySelectorAll('.operon-task-media-lightbox-control')){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('width','16');svg.setAttribute('height','16');const rect=document.createElementNS(svg.namespaceURI,'rect');rect.setAttribute('width','16');rect.setAttribute('height','16');svg.appendChild(rect);control.appendChild(svg);}
   },profile);
   const shell=page.locator('.operon-task-media-lightbox:not([hidden]):not([inert])');
   const content=()=>page.locator('#content');
   const opacities=()=>shell.locator('.operon-task-media-lightbox-control').evaluateAll(els=>els.map(e=>getComputedStyle(e).opacity));
   const settleHide=()=>page.waitForFunction(()=>!document.querySelector('.operon-task-media-lightbox:not([hidden]):not([inert])').classList.contains('are-controls-hovered'),null,{timeout:3000});
   const contentPoint=await content().evaluate(el=>{const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};});
   await page.mouse.move(contentPoint.x,contentPoint.y);await settleHide();
   assert.equal(await shell.evaluate(el=>el.classList.contains('are-controls-pending')),true,'native controls wait for content readiness');
   await page.mouse.move(8,8);
   assert.deepEqual(await opacities(),Array(10).fill('0'),'backdrop hover cannot reveal controls before readiness');
   await shell.evaluate(el=>el.focus());await page.keyboard.press('Tab');
   assert.equal(await shell.locator('.operon-task-media-lightbox-close').evaluate(el=>document.activeElement===el&&getComputedStyle(el).opacity==='1'),true,'keyboard access remains immediate while content is pending');
   await shell.evaluate(el=>el.focus());
   // Return from keyboard navigation to physical pointer interaction.
   await page.mouse.move(9,9);await page.mouse.move(8,8);
   await page.evaluate(profile=>{
    const shell=document.querySelector('.operon-task-media-lightbox');const host=document.getElementById('content');
    const before=host.style.cssText;
    if(profile==='markdown')Object.assign(host.style,{position:'fixed',inset:'0',width:'100vw',height:'100vh'});
    const focus=document.activeElement;const realTimeout=window.setTimeout;let timers=0;
    window.setTimeout=function(...args){timers++;return realTimeout.apply(window,args);};
    try{
     Subject.markLightboxControlsReady(shell);
     if(timers!==0||shell.classList.contains('are-controls-pending'))throw new Error('Ready controls must activate synchronously without a timer');
     const visible=shell.classList.contains('are-controls-hovered');
     if(visible!==(profile!=='markdown'))throw new Error('Readiness must recheck the current pointer target: '+JSON.stringify({profile,width:innerWidth,visible,hover:shell.matches(':hover'),child:shell.querySelector(':scope > :hover')?.className,hit:document.elementFromPoint(8,8)?.className,rect:host.getBoundingClientRect().toJSON()}));
     if(document.activeElement!==focus)throw new Error('Readiness must not move focus');
    }finally{window.setTimeout=realTimeout;host.style.cssText=before;}
   },profile);
   await page.mouse.move(contentPoint.x,contentPoint.y);await settleHide();
   assert.deepEqual(await opacities(),Array(10).fill('0'),`${profile}: content hides all groups`);
   assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('operon-task-media-lightbox-control')),false,'content entry never focuses a side control');
   await page.mouse.move(8,8);
   await page.waitForFunction(()=>!document.querySelector('.operon-task-media-lightbox:not([hidden]):not([inert])').classList.contains('are-controls-pending'));
   assert.deepEqual(await opacities(),Array(10).fill('1'));
   const colors=await shell.locator('.operon-task-media-lightbox-close').evaluate(el=>{const s=getComputedStyle(el);return[s.backgroundColor,s.borderTopColor,s.backgroundImage,s.boxShadow,s.filter];});
   assert.deepEqual(colors,[dark?'rgb(41, 41, 41)':'rgb(236, 236, 236)','rgb(119, 119, 119)','none','none','none']);
   const controlBoxes=await shell.locator('.operon-task-media-lightbox-control').evaluateAll(els=>els.map(e=>{const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};}));
   for(const point of controlBoxes){await page.mouse.move(point.x,point.y,{steps:8});assert.deepEqual(await opacities(),Array(10).fill('1'),'SVG and disabled-button hover retain controls');}
   await shell.locator('.operon-lightbox-dimming-decrease').evaluate(el=>el.disabled=true);
   await page.mouse.move(contentPoint.x,contentPoint.y);await settleHide();
   await shell.locator('.operon-lightbox-dimming-decrease').hover();assert.deepEqual(await opacities(),Array(10).fill('1'),'disabled controls remain part of the hover area');
   await shell.locator('.operon-lightbox-dimming-decrease').evaluate(el=>el.disabled=false);
   await page.mouse.move(8,8);await page.mouse.move(-10,-10);assert.deepEqual(await opacities(),Array(10).fill('0'),'leaving the preview hides controls immediately');
   await page.mouse.move(contentPoint.x,contentPoint.y);await settleHide();assert.deepEqual(await opacities(),Array(10).fill('0'));
   // Even after a slow crossing of the inside-edge gap, the button's own area reveals it before activation.
   const closePoint=controlBoxes[0];
   await page.mouse.move(closePoint.x-20,closePoint.y,{steps:8});await page.waitForTimeout(160);
   await page.mouse.move(closePoint.x,closePoint.y,{steps:8});assert.deepEqual(await opacities(),Array(10).fill('1'));
   await page.mouse.move(contentPoint.x,contentPoint.y);await settleHide();
   const contentTarget=await page.evaluate(({x,y})=>Boolean(document.elementFromPoint(x,y)?.closest('.operon-task-media-lightbox-control')),contentPoint);
   assert.equal(contentTarget,false,'ordinary content remains interactive');
   await shell.evaluate(el=>el.focus());await page.keyboard.press('Tab');
   assert.equal(await shell.locator('.operon-task-media-lightbox-close').evaluate(el=>document.activeElement===el&&el.matches(':focus-visible')&&getComputedStyle(el).opacity==='1'&&getComputedStyle(el).outlineStyle==='solid'),true);
   // Opacity/pointer-events must not remove any enabled control from the native Tab order.
   const visited=new Set();
   for(let i=0;i<20;i++){
    const focus=await page.evaluate(()=>{const el=document.activeElement;return el?.classList.contains('operon-task-media-lightbox-control')?{cls:el.className,opacity:getComputedStyle(el).opacity}:null;});
    if(focus){visited.add(focus.cls);assert.equal(focus.opacity,'1');}
    await page.keyboard.press('Tab');
   }
   assert.equal(visited.size,10,'all ten controls remain keyboard reachable');
   if(['web','pdf','youtube'].includes(profile)){
    await content().locator('iframe').waitFor();
    await shell.evaluate(el=>el.focus());await page.mouse.move(8,8);await page.mouse.move(contentPoint.x,contentPoint.y);await settleHide();
    assert.deepEqual(await opacities(),Array(10).fill('0'),'cross-origin frame entry hides controls without accessing its document');
    await page.mouse.move(8,8);assert.deepEqual(await opacities(),Array(10).fill('1'));
   }
   if(profile==='table'){
    await page.locator('#content-input').focus();
    await page.mouse.move(contentPoint.x,contentPoint.y);await settleHide();
    await page.evaluate(()=>{window.picker=Subject.createFloatingPanel(document.getElementById('content-input'),'operon-floating-panel',()=>{});picker.panel.createEl('input',{attr:{id:'picker-input'}});});
    await page.locator('#picker-input').hover();assert.deepEqual(await opacities(),Array(10).fill('0'));await page.evaluate(()=>picker.close());
    await page.evaluate(()=>{window.closeChild=Subject.openLightbox(document.getElementById('content-input'),{title:'Child',render(child){child.createDiv('operon-task-media-lightbox-content').style.cssText='width:50vw;height:50vh';return null;}});});
    await page.mouse.move(8,8);
    await page.waitForFunction(()=>!document.querySelector('.operon-task-media-lightbox:not([hidden]):not([inert])').classList.contains('are-controls-pending'));
    assert.equal(await shell.locator('.operon-task-media-lightbox-close').evaluate(el=>getComputedStyle(el).opacity),'1');
    await page.keyboard.press('Escape');await page.mouse.move(contentPoint.x,contentPoint.y);await settleHide();assert.deepEqual(await opacities(),Array(10).fill('0'));
    assert.equal(await page.locator('#content-input').inputValue(),'Unsaved draft');
   }
   assert.equal(await page.evaluate(()=>writes),0,'hover and focus perform no setting saves');
   const geometry=()=>shell.locator('.operon-task-media-lightbox-control').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return{cls:el.className,x:r.x,y:r.y,width:r.width,height:r.height};}));
   const right=await geometry();
   await page.evaluate(()=>{window.controlSide='left';Subject.refreshLightboxControls(document.querySelector('.operon-task-media-lightbox'));});
   assert.deepEqual(await geometry(),right,'changing the preference does not move an open lightbox');
   await page.mouse.move(8,8);await shell.locator('.operon-task-media-lightbox-close').click();
   assert.deepEqual(await page.evaluate(()=>[window.previewCloses,document.activeElement.id]),[1,'anchor']);
   assert.deepEqual(await page.evaluate(()=>controlPresses),['1'],'the control is visible before pointer activation reaches capture listeners');
   await page.evaluate(async()=>{
    window.closePreview=Subject.openLightbox(document.getElementById('anchor'),window.previewOptions);
    const image=document.querySelector('.operon-task-media-lightbox > img');if(image)await image.decode();
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    Subject.refreshLightboxControls(document.querySelector('.operon-task-media-lightbox'));
   });
   const left=await geometry();
   assert.deepEqual(left.map(box=>box.cls),right.map(box=>box.cls),'mirroring retains control order and icons');
   for(let i=0;i<left.length;i++){
    const a=right[i],b=left[i];
    assert.ok(Math.abs(a.y-b.y)<1,`${profile}: vertical groups keep their order ${JSON.stringify({a,b})}`);
    assert.ok(Math.abs(a.width-b.width)<1&&Math.abs(a.height-b.height)<1,'control size is unchanged');
    // Native image offsetLeft rounds a centered half-pixel to an integer.
    if(!b.cls.includes('operon-lightbox-width-'))assert.ok(Math.abs(b.x-(width-a.x-a.width))<=1.01,`${profile}: ${b.cls} mirrors across the viewport ${JSON.stringify({a,b,width})}`);
    assert.ok(b.x>=0&&b.x+b.width<=width+1&&b.y>=0&&b.y+b.height<=(width===420?300:900)+1,'mirrored control stays inside the viewport');
   }
   const widthButtons=left.filter(box=>box.cls.includes('operon-lightbox-width-'));
   assert.ok(widthButtons[0].x<widthButtons[1].x,'width decrease/increase retain their horizontal order');
   for(const action of ['tab','split','split-below'])await shell.locator(`.operon-task-media-lightbox-${action}`).evaluate(el=>el.click());
   assert.deepEqual(await page.evaluate(()=>transfers),['tab','right','below'],'left placement keeps transfer meanings');
   await page.setViewportSize({width,height:(width===420?300:900)+40});
   await page.evaluate(()=>new Promise(requestAnimationFrame));
   for(const box of await geometry())assert.ok(box.x>=0&&box.x+box.width<=width+1,'viewport changes keep mirrored controls in bounds');
   if(profile==='image'){
    await content().evaluate(el=>{el.style.width='44px';el.style.height='32px';});
    await page.evaluate(()=>new Promise(requestAnimationFrame));
    for(const box of await geometry())assert.ok(box.x>=0&&box.x+box.width<=width+1,'small image collision fallback remains inside the viewport');
   }
   assert.equal(await page.evaluate(()=>writes),0,'reading placement and resizing the viewport never save settings');
   await page.keyboard.press('Escape');
   assert.deepEqual(await page.evaluate(()=>[window.previewCloses,document.activeElement.id]),[2,'anchor']);
   if(profile==='image'){
    await page.evaluate(()=>{
     window.closePreview=Subject.openLightbox(document.getElementById('anchor'),{...window.previewOptions,nativeView:false});
     if(document.querySelector('.operon-task-media-lightbox').classList.contains('are-controls-pending'))throw new Error('Simple media controls must not wait for a readiness timer');
    });
    await page.mouse.move(9,9);await page.mouse.move(8,8);
    assert.deepEqual(await opacities(),Array(10).fill('1'),'simple media retains immediate hover');
    await page.keyboard.press('Escape');
   }
   mirroredScenarios++;
   scenarios++;
  }finally{await page.close();}
 }
 console.log(JSON.stringify({ok:true,scenarios,mirroredScenarios}));
}finally{await browser.close();}
