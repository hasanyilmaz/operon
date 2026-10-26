import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { Platform, WorkspaceTabs } from 'obsidian';
import { lightboxFixture } from './test-support/lightbox-dom';
import { openLightbox } from '../src/ui/lightbox';
import { disposeWebLightboxes, openWebLightbox } from '../src/ui/web-lightbox';
import { bindDesktopChipOpening } from '../src/ui/links-chip-action';
import { openLightboxTarget } from '../src/ui/lightbox-opening';

function fixture(options: { enabled?: boolean; delay?: boolean; fail?: boolean; wrongDocument?: boolean } = {}) {
 const dom = lightboxFixture();
 const savedDesktop = (Platform as any).isDesktopApp;
 (Platform as any).isDesktopApp = true;
 const savedObserver = globalThis.ResizeObserver;
 let disconnected = 0;
 globalThis.ResizeObserver = class { observe() {} disconnect() { disconnected++; } } as any;
 let release: () => void = () => {};
 let created = 0, detached = 0, restored = 0, tabOpens = 0, url = '';
 const group:any = new (WorkspaceTabs as any)({containerEl:dom.doc.body} as any);
 const previous = { parent: group, containerEl:dom.anchor, getRoot:()=>({}), getContainer:()=>({}), view: { containerEl: dom.doc.body.createDiv(), getViewType: () => 'markdown' } };
 group.children.push(previous);
 const root = dom.doc.body.createDiv();
 const view = { containerEl: root.createDiv(), getViewType: () => 'webviewer', onResize() {} };
 const owned = { parent: null as any, containerEl: root, getViewState:()=>({type:'webviewer',state:{url}}), view, async setViewState(state: any) { url = state.state.url; if (owned.parent === group) tabOpens++; if (options.delay) await new Promise<void>(r => release = r); if (options.fail) throw Error('open failed'); if (options.wrongDocument) view.containerEl.ownerDocument = {}; }, async loadIfDeferred() {}, detach() { detached++; } };
 const plugin = { enabled: options.enabled !== false, instance: { openUrl() { tabOpens++; } } };
 const app: any = { internalPlugins: { plugins: { webviewer: plugin }, getEnabledPluginById: () => options.enabled === false ? null : plugin.instance }, workspace: {
  containerEl: dom.doc.body, getLayout:()=>({}), getLeafById:()=>previous, getMostRecentLeaf: () => previous, createLeafInParent: (parent:any) => { created++; owned.parent = parent; parent.insertChild?.(-1,owned); return owned; }, iterateAllLeaves() {}, getLeaf: () => { throw Error('must not reuse user tab'); }, getLeavesOfType: () => [previous], setActiveLeaf() { restored++; },
 } };
 return { ...dom, app, view, owned, release: () => release(), stats: () => ({created, detached, restored, disconnected, tabOpens, url}), cleanup() { disposeWebLightboxes(app); (Platform as any).isDesktopApp = savedDesktop; globalThis.ResizeObserver = savedObserver; } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('web content opens directly, uses the shared shell and unload closes only its owned leaf', async () => {
 const f = fixture();
 try {
  openWebLightbox(f.app, f.anchor, 'https://example.com'); await tick();
  assert.equal(f.stats().created, 1); assert.equal(f.stats().url, 'https://example.com');
  assert.equal(f.doc.body.children.at(-1).children[0].hidden, true);
  assert.notEqual(f.view.containerEl.parent, f.doc.body);
  disposeWebLightboxes(f.app); disposeWebLightboxes(f.app); await tick();
  assert.equal(f.stats().detached, 1); assert.equal(f.stats().restored, 0); assert.equal(f.stats().disconnected, 1);
  assert.equal(f.listeners.get('keydown')!.size, 0);
 } finally { f.cleanup(); }
});
test('closing before a delayed open completes cannot attach the late view', async () => {
 const f = fixture({delay:true});
 try {
  openWebLightbox(f.app, f.anchor, 'https://example.com'); disposeWebLightboxes(f.app); f.release(); await tick();
  assert.notEqual(f.view.containerEl.parent, f.doc.body); assert.ok(f.stats().detached >= 1); assert.equal(f.stats().restored, 0);
 } finally { f.cleanup(); }
});
test('failed opening and wrong-window attachment close the shell and clean the owned leaf', async () => {
 for (const options of [{fail:true}, {wrongDocument:true}]) {
  const f = fixture(options);
  try { openWebLightbox(f.app, f.anchor, 'https://example.com'); await tick(); assert.equal(f.stats().detached, 1); assert.equal(f.listeners.get('keydown')!.size, 0); } finally { f.cleanup(); }
 }
});
function bind(f:any, chip:any=f.anchor, key='links',url='https://example.com') {
 const task={operonId:'abcdefg',fieldValues:{links:url},primary:{filePath:'A.md',format:'yaml'},tags:[]};
 return bindDesktopChipOpening(chip,{key,externalRawValue:url,label:'Example'} as any,{
  app:f.app,getTask:()=>task,getTaskById:()=>task,getAllTasks:()=>[task],getSettings:()=>({keyMappings:[]}),picker:()=>null,
 } as any);
}
const mouse=(extra:any={})=>({button:0,detail:1,metaKey:false,ctrlKey:false,preventDefault(){},stopPropagation(){},...extra});
test('desktop click, modifier and keyboard routes stay separate; special fields and mobile fall through',async()=>{
 const f=fixture();const wasMac=Platform.isMacOS;
 try{
  assert.equal(bind(f,f.anchor,'priority'),false);Platform.isDesktopApp=false;assert.equal(bind(f),false);Platform.isDesktopApp=true;assert.equal(bind(f),true);
  const click=(event:any)=>(f.anchor as any).events.get('click')(event);
  for(const mac of [true,false]){Platform.isMacOS=mac;click(mouse({metaKey:mac,ctrlKey:!mac}));await tick();}
  assert.equal(f.stats().tabOpens,2);assert.equal(f.stats().created,2);assert.equal(f.stats().restored,2);
  click(mouse({detail:2}));await tick();assert.equal(f.stats().created,2);
  click(mouse({detail:0,metaKey:true,ctrlKey:true}));await tick();assert.equal(f.stats().created,3);assert.equal(f.stats().tabOpens,2);
 }finally{Platform.isMacOS=wasMac;f.cleanup();}
});
test('disabled viewer and invalid protocols never create a leaf',async()=>{
 const f=fixture({enabled:false});try{
  bind(f);(f.anchor as any).events.get('click')(mouse());await tick();
  await openLightboxTarget(f.app,f.anchor,{kind:'web',url:'javascript:alert(1)'});
  assert.equal(f.stats().created,0);assert.equal(f.stats().tabOpens,0);
 }finally{f.cleanup();}
});
test('span keyboard activation fires once and native buttons keep their native behavior',()=>{
 const f=fixture();try{
  const chip=f.anchor as any;let clicks=0;chip.click=()=>clicks++;bind(f);
  const handler=chip.events.get('keydown');handler(mouse({key:'Enter',repeat:false}));handler(mouse({key:' ',repeat:true}));assert.equal(clicks,1);
  const button=f.doc.body.createEl('button');bind(f,button);let stopped=0,prevented=0;button.events.get('keydown')(mouse({key:'Enter',repeat:false,stopPropagation(){stopped++;},preventDefault(){prevented++;}}));assert.equal(stopped,1);assert.equal(prevented,0);
 }finally{f.cleanup();}
});
test('all four chip paths opt in while the prototype and Table integration remain separate', () => {
 for (const file of ['compact-card-chips','reading-task-row','live-preview-conceal','task-wikilink-overlay-chips']) {
  const source = readFileSync(`src/ui/${file}.ts`, 'utf8');
  assert.match(source, /bindDesktopChipOpening\(chip, entry/);
  assert.match(source, /bindExternalLinkContextMenu/);
 }
 const source = readFileSync('src/ui/web-lightbox.ts','utf8');
 assert.doesNotMatch(source, /createEl\('(?:input|form)'/);
 assert.doesNotMatch(readFileSync('main.ts','utf8'), /registerWebLightboxPrototype/);
});

test('media lightbox replaces a pending web view and late completion cannot close the replacement', async () => {
 const f = fixture({delay:true}); let media: HTMLElement | null = null;
 try {
  openWebLightbox(f.app, f.anchor, 'https://example.com');
  const closeMedia = openLightbox(f.anchor, {title:'Media',render: root => {media = root; return null;}});
  assert.equal(f.stats().detached, 0);
  f.release(); await tick();
  assert.equal((media as unknown as HTMLElement).isConnected, true);
  disposeWebLightboxes(f.app);
  assert.equal((media as unknown as HTMLElement).isConnected, true);
  closeMedia();
 } finally { f.cleanup(); }
});

for(const [url,youtube,start] of [
 ['https://www.youtube.com/watch?v=v_USOf1fSYM&t=1s',true,'1'],
 ['https://youtu.be/v_USOf1fSYM?t=45',true,'45'],
 ['https://www.youtube.com/shorts/v_USOf1fSYM',true,null],
 ['https://www.youtube-nocookie.com/embed/v_USOf1fSYM',true,null],
 ['https://example.com/watch?v=v_USOf1fSYM',false,null],
 ['https://youtube.com.evil.example/watch?v=v_USOf1fSYM',false,null],
 ['https://www.youtube.com/',false,null],
] as const) test(`Links chip selects player or Web Viewer for ${url}`,async()=>{
 const f=fixture({delay:true});
 try{
  assert.equal(bind(f,f.anchor,'links',url),true);
  (f.anchor as any).events.get('click')(mouse());await tick();
  const nodes=f.doc.body.querySelectorAll();
  const player=nodes.find((node:any)=>node.classes.has('operon-task-media-lightbox-content')&&node.classes.has('is-youtube'));
  if(youtube){
   assert.ok(player);assert.equal(f.stats().created,0,'player must not create a Web Viewer leaf');
   const frame=player.children.find((node:any)=>node.tagName==='IFRAME');assert.ok(frame);
   const embed=new URL(frame.src);assert.equal(embed.hostname,'www.youtube-nocookie.com');assert.equal(embed.pathname,'/embed/v_USOf1fSYM');
   assert.equal(embed.searchParams.get('start'),start);assert.equal(embed.searchParams.get('autoplay'),'0');
   assert.equal(nodes.some((node:any)=>node.classes.has('operon-web-lightbox-host')),false);
   const shell=player.parent;assert.equal(f.doc.activeElement,shell);
  }else{
   assert.equal(player,undefined);
   const host=nodes.find((node:any)=>node.classes.has('operon-web-lightbox-host'));
   assert.ok(host);assert.equal(host.inert,true);f.release();await tick();assert.equal(host.inert,false);assert.equal(f.stats().url,url);
  }
  assert.equal(f.stats().tabOpens,0);
 }finally{f.release();f.cleanup();await tick();}
});
test('YouTube Links modifiers, middle click and player tab control retain the original watch URL',async()=>{
 const url='https://www.youtube.com/watch?v=v_USOf1fSYM&t=1s',f=fixture();const mac=Platform.isMacOS;
 const external:string[]=[];f.doc.defaultView.open=(value:string)=>external.push(value);
 try{
  bind(f,f.anchor,'links',url);Platform.isMacOS=true;
  (f.anchor as any).events.get('click')(mouse({metaKey:true}));await tick();assert.equal(f.stats().url,url);assert.equal(f.stats().tabOpens,1);
  Platform.isMacOS=false;(f.anchor as any).events.get('click')(mouse({ctrlKey:true}));await tick();assert.equal(f.stats().tabOpens,2);assert.equal(f.stats().url,url);
  (f.anchor as any).events.get('auxclick')(mouse({type:'auxclick',button:1}));await tick();assert.deepEqual(external,[url]);assert.equal(f.stats().tabOpens,2);
  (f.anchor as any).events.get('click')(mouse());await tick();
  const nodes=f.doc.body.querySelectorAll(),button=nodes.find((node:any)=>node.classes.has('operon-task-media-lightbox-tab'));
  assert.ok(button);button.events.get('click')();await tick();assert.equal(f.stats().url,url);assert.equal(f.stats().tabOpens,3);
  assert.equal(f.doc.body.querySelectorAll().some((node:any)=>node.isConnected&&node.classes.has('is-youtube')),false);
 }finally{Platform.isMacOS=mac;f.cleanup();await tick();}
});
