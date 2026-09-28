import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import ts from 'typescript';
const root = process.cwd();
const dir = await mkdtemp(path.join(tmpdir(), 'operon-location-map-'));
try {
 const storage = ts.createSourceFile('storage.ts',await readFile('src/storage/operon-storage.ts','utf8'),ts.ScriptTarget.Latest,true);
 const cls = storage.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='OperonStorage');
 const method = name=>cls.members.find(n=>n.name?.getText(storage)===name).getText(storage);
 const picker = ts.createSourceFile('picker.ts',await readFile('src/ui/field-pickers/location-picker.ts','utf8'),ts.ScriptTarget.Latest,true);
 const pickerFn = name=>picker.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).getText(picker).replace(/^export /,'');
 const common = ts.createSourceFile('common.ts',await readFile('src/ui/field-pickers/common.ts','utf8'),ts.ScriptTarget.Latest,true);
 const panelFn = common.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='createFloatingPanel');
 const panelHandler = name=>panelFn.body.statements.flatMap(n=>ts.isVariableStatement(n)?[...n.declarationList.declarations]:[]).find(n=>n.name.getText(common)===name).initializer.getText(common);
 const settingsSource = ts.createSourceFile('settings.ts',await readFile('src/ui/settings-tab.ts','utf8'),ts.ScriptTarget.Latest,true);
 const settingsClass = settingsSource.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='OperonSettingsTab');
 const settingsMethod = name=>settingsClass.members.find(n=>n.name?.getText(settingsSource)===name).getText(settingsSource);
 const stub = path.join(dir,'obsidian.ts');
 await writeFile(stub, `
export const menus: any[] = [], notices: string[] = [], renderCalls: any[] = [];
export class Component {
 _children: any[]=[]; loaded=false; unloadCount=0;
 load(){this.loaded=true;for(const c of this._children)c.load?.();}
 unload(){if(!this.loaded)return;this.unloadCount++;this.loaded=false;for(const c of this._children)c.unload?.();this._children=[];}
 addChild(c:any){this._children.push(c);if(this.loaded)c.load?.();return c;}
}
export class Notice {constructor(s:string){notices.push(s);}}
export class Menu {
 items:any[]=[];dom:any;parent:any;native=true;hideCallbacks:any[]=[];
 constructor(){menus.push(this);}
 setUseNativeMenu(value:boolean){this.native=value;return this;}
 setParentElement(parent:any){this.parent=parent;this.dom=parent.ownerDocument.body.createDiv();return this;}
 addItem(cb:any){const item:any={setTitle(v:any){this.title=v;return this;},setIcon(v:any){this.icon=v;return this;},onClick(v:any){this.click=v;return this;}};cb(item);this.items.push(item);return this;}
 onHide(cb:any){this.hideCallbacks.push(cb);return this;}
 showAtMouseEvent(){}
 hide(){this.dom?.remove();for(const cb of this.hideCallbacks.splice(0))cb();}
}
export const MarkdownRenderer={render(...args:any[]){let resolve:any,reject:any;const promise=new Promise((a,b)=>{resolve=a;reject=b;});renderCalls.push({args,resolve,reject});return promise;}};
export function setIcon(){}
`);
 const outfile=path.join(dir,'test.cjs');
 const code=String.raw`
import assert from 'node:assert/strict';
import test from 'node:test';
import {Component,Menu,Notice,MarkdownRenderer,setIcon,menus,notices,renderCalls} from 'obsidian';
import {attachLocationPickerMapMenu,findLocationPickerMap} from './src/ui/field-pickers/location-picker-map';
import {bindLocationPickerDefaults,getLocationPickerDefaults,saveLocationPickerDefault,normalizeLocationPickerDefault} from './src/core/location-picker-defaults';
import {parseLocationCoordinate} from './src/core/location-coordinates';
import {buildLocationPickerBaseMarkdown} from './src/core/location-base-map';
import {DEFAULT_SETTINGS} from './src/types/settings';
import {t} from './src/core/i18n';
class Store {
 settings={...DEFAULT_SETTINGS}; settingsSaveQueue=Promise.resolve(); writes=0; notifications=0; persisted:any=null;
 async persistSettings(){this.writes++;this.persisted={...this.settings};}
 notifyPropertyPoolChange(){this.notifications++;}
 ${method('enqueueSettingsTransaction')}
 ${method('saveLocationPickerDefault')}
 ${method('saveSettings')}
}
const tick=()=>new Promise(r=>setTimeout(r,0));
class El {
 children:any[]=[];parent:any=null;events=new Map();isConnected=true;nodeType=1;style={setProperty(){}};value='';textContent='';placeholder='';
 classList={toggle(){},add(){},remove(){}};
 constructor(public ownerDocument:any){}
 createEl(tag:string,options:any={}){const el=new El(this.ownerDocument);el.textContent=options.text??'';return this.appendChild(el);}
 createDiv(options:any={}){return this.createEl('div',options);}
 createSpan(options:any={}){return this.createEl('span',options);}
 appendChild(el:any){if(el.parent)el.parent.children=el.parent.children.filter((x:any)=>x!==el);el.parent=this;this.children.push(el);return el;}
 contains(el:any):boolean{return el===this||this.children.some(x=>x.contains(el));}
 addEventListener(key:string,fn:any){this.events.set(key,fn);}
 removeEventListener(key:string,fn:any){if(this.events.get(key)===fn)this.events.delete(key);}
 get parentElement(){return this.parent;}
 getBoundingClientRect(){return {left:100,top:200};}
 remove(){this.isConnected=false;if(this.parent)this.parent.children=this.parent.children.filter((x:any)=>x!==this);}
 replaceChildren(){for(const child of [...this.children])child.remove();this.children=[];}
 emit(key:string,event:any={}){this.events.get(key)?.(event);}
}
function fixture(){
 menus.length=0;notices.length=0;
 const clipboard:string[]=[];const doc:any={};doc.defaultView={HTMLElement:El,setTimeout,clearTimeout,getComputedStyle:()=>({zIndex:'1000'}),navigator:{clipboard:{writeText:async(v:string)=>{clipboard.push(v);}}}};
 doc.body=new El(doc);const panel=doc.body.createDiv(),host=panel.createDiv(),mapEl=host.createDiv();const app:any={workspace:{getActiveFile:()=>null}};
 const owner=new Component();owner.load();let coordinates:any;const notes:any[]=[];
 const original=()=>{throw Error('native fallback called');};
 const view:any={type:'map',mapEl,map:{getZoom:()=>8.5,unproject:(p:any)=>{coordinates=p;return {lat:41.12345678,lng:29.5};}},config:{getAsPropertyId:()=> 'note.Custom location'},createFileForView:async(_name:any,update:any)=>{const props={};update(props);notes.push(props);},showMapContextMenu:original};
 owner._children=[{_children:[view]}];
 const connection=attachLocationPickerMapMenu(app,panel as any,host as any,owner);
 const event={clientX:120,clientY:230,preventDefault(){},stopPropagation(){}};
 const open=()=>{host.emit('contextmenu',event);view.showMapContextMenu(event);return menus.at(-1);};
 return {app,doc,panel,host,mapEl,owner,view,original,connection,open,clipboard,notes,point:()=>coordinates};
}
test('four owned menu actions preserve note/clipboard paths and persist only explicit defaults',async()=>{
 const f=fixture(),store=new Store();const unbind=bindLocationPickerDefaults(f.app,{get:()=>store.settings,save:c=>store.saveLocationPickerDefault(c)});
 const menu=f.open();assert.equal(menu.native,false);assert.equal(menu.parent,f.panel);assert.equal(menu.dom.style.zIndex,'1002');assert.equal(f.panel.contains(menu.dom),false);assert.deepEqual(f.connection.elements(),[menu.dom]);
 assert.deepEqual(menu.items.map((i:any)=>i.icon),['square-pen','copy','map-pin','crosshair']);assert.equal(menu.items.length,4);
 assert.deepEqual(f.point(),[20,30]);assert.equal(store.writes,0);
 menu.items[0].click();await tick();assert.deepEqual(f.notes,[{'Custom location':['41.12346','29.5']}]);
 menu.items[1].click();await tick();assert.deepEqual(f.clipboard,['41.12346, 29.5']);assert.equal(store.writes,0);
 menu.items[2].click();await tick();assert.equal(store.settings.locationPickerMapDefaultCenter,'41.12346, 29.5');
 menu.items[3].click();await tick();assert.equal(store.settings.locationPickerMapDefaultZoom,9);assert.equal(store.writes,2);
 assert.ok(f.panel.isConnected);assert.ok(notices.includes(t('location','mapDefaultsSaved')));
 const markdown=buildLocationPickerBaseMarkdown({settings:{...DEFAULT_SETTINGS,...getLocationPickerDefaults(f.app)}});
 assert.match(markdown,/center: "\[41.12346, 29.5\]"/);assert.match(markdown,/defaultZoom: 9/);
 f.connection.close();assert.equal(f.view.showMapContextMenu,f.original);unbind();
});
test('failed save rolls back only its field, preserving concurrent settings changes',async()=>{
 const s=new Store();s.settings.locationPickerMapDefaultCenter='1, 2';
 s.persistSettings=async()=>{s.settings.locationPickerMapDefaultZoom=15;throw Error('disk');};
 await assert.rejects(s.saveLocationPickerDefault({kind:'center',value:'3, 4'}));
 assert.equal(s.settings.locationPickerMapDefaultCenter,'1, 2');assert.equal(s.settings.locationPickerMapDefaultZoom,15);
 s.persistSettings=async()=>{s.settings.locationPickerMapDefaultCenter='5, 6';throw Error('disk');};
 await assert.rejects(s.saveLocationPickerDefault({kind:'center',value:'3, 4'}));assert.equal(s.settings.locationPickerMapDefaultCenter,'5, 6');
});
test('storage serializes selections and resumes after failure without a full-settings rollback',async()=>{
 const s=new Store();const seen:any[]=[];s.persistSettings=async()=>{seen.push([s.settings.locationPickerMapDefaultCenter,s.settings.locationPickerMapDefaultZoom]);await tick();};
 await Promise.all([s.saveLocationPickerDefault({kind:'center',value:'8, 9'}),s.saveLocationPickerDefault(normalizeLocationPickerDefault({kind:'zoom',value:4.7}))]);
 assert.deepEqual(seen,[['8, 9',7],['8, 9',5]]);
});
test('invalid values and duplicate defaults do not write; zoom uses existing bounds',async()=>{
 const s=new Store();await s.saveLocationPickerDefault({kind:'zoom',value:7});assert.equal(s.writes,0);
 assert.throws(()=>normalizeLocationPickerDefault({kind:'center',value:'92, 30'}));assert.throws(()=>normalizeLocationPickerDefault({kind:'zoom',value:NaN}));assert.equal(s.writes,0);
 assert.equal(normalizeLocationPickerDefault({kind:'zoom',value:0}).value,1);assert.equal(normalizeLocationPickerDefault({kind:'zoom',value:24}).value,18);
});
test('a pending write cannot show success early or execute a duplicate action',async()=>{
 const f=fixture();let resolve:any;let writes=0;const unbind=bindLocationPickerDefaults(f.app,{get:()=>DEFAULT_SETTINGS,save:()=>{writes++;return new Promise(r=>resolve=r);}});
 const m=f.open();m.items[2].click();m.items[2].click();await tick();assert.equal(writes,1);assert.equal(notices.length,0);
 resolve();await tick();assert.deepEqual(notices,[t('location','mapDefaultsSaved')]);f.connection.close();unbind();
});
test('clipboard and save failures report errors without closing the picker',async()=>{
 const f=fixture();f.doc.defaultView.navigator.clipboard.writeText=()=>{throw Error('denied');};
 const m=f.open();const warn=console.warn;console.warn=()=>{};
 try{m.items[1].click();await tick();m.items[2].click();await tick();}finally{console.warn=warn;}
 assert.deepEqual(notices,[t('location','mapActionFailed'),t('location','mapActionFailed')]);assert.ok(f.panel.isConnected);f.connection.close();
});
test('menu hide retains Escape ownership for the current event only',async()=>{
 const f=fixture(),m=f.open();assert.equal(f.connection.isOpen(),true);assert.deepEqual(f.connection.elements(),[m.dom]);
 m.hide();assert.equal(f.connection.isOpen(),true);assert.deepEqual(f.connection.elements(),[m.dom]);await tick();assert.equal(f.connection.isOpen(),false);assert.deepEqual(f.connection.elements(),[]);f.connection.close();
});
test('actual panel handlers preserve menu clicks and first Escape, but close on outside or second Escape',async()=>{
 const f=fixture(),m=f.open(),closed:string[]=[];
 const panel=f.panel,options={outsideClickExclusions:()=>f.connection.elements(),shouldHandleEscape:()=>!f.connection.isOpen()};
 const record={},isTopMostFloatingPanel=()=>true,requestClose=(reason:string)=>closed.push(reason);
 const onOutside=${panelHandler('onOutside')};
 const onKeyDown=${panelHandler('onKeyDown')};
 const item=m.dom.createDiv();onOutside({target:item} as any);assert.deepEqual(closed,[]);
 m.hide();onOutside({target:item} as any);onKeyDown({key:'Escape'} as any);assert.deepEqual(closed,[]);
 await tick();onKeyDown({key:'Escape'} as any);assert.deepEqual(closed,['escape']);
 onOutside({target:f.doc.body.createDiv()} as any);assert.deepEqual(closed,['escape','outside']);f.connection.close();
});
test('detached, unrelated, incomplete and cyclic renderer trees fail closed',()=>{
 const f=fixture();const original=f.view.showMapContextMenu;
 f.owner._children=[{_children:[f.owner]}];assert.equal(findLocationPickerMap(f.owner,f.host as any),null);
 f.host.emit('contextmenu',{preventDefault(){},stopPropagation(){}});assert.deepEqual(notices,[t('location','mapMenuUnavailable')]);assert.equal(f.view.showMapContextMenu,original);
 f.owner._children=[{...f.view,mapEl:new El(f.doc)}];assert.equal(findLocationPickerMap(f.owner,f.host as any),null);
 f.owner._children=[{...f.view,map:null}];assert.equal(findLocationPickerMap(f.owner,f.host as any),null);f.connection.close();
});
test('readonly host internals are rejected without calling the original menu',()=>{
 const f=fixture();Object.defineProperty(f.view,'showMapContextMenu',{value:f.original,writable:false});
 let stopped=false;const warn=console.warn;console.warn=()=>{};
 try{f.host.emit('contextmenu',{preventDefault(){},stopPropagation(){stopped=true;}});}finally{console.warn=warn;}
 assert.equal(stopped,true);assert.deepEqual(notices,[t('location','mapMenuUnavailable')]);assert.equal(menus.length,0);f.connection.close();
});
test('an inherited Maps method is restored without leaving an instance override',()=>{
 const f=fixture();delete f.view.showMapContextMenu;Object.setPrototypeOf(f.view,{showMapContextMenu:f.original});
 f.open();assert.equal(Object.hasOwn(f.view,'showMapContextMenu'),true);f.connection.close();assert.equal(Object.hasOwn(f.view,'showMapContextMenu'),false);assert.equal(f.view.showMapContextMenu,f.original);
});
test('closed tab restores only its own hook and suppresses late feedback/actions',async()=>{
 const f=fixture();let done:any;const unbind=bindLocationPickerDefaults(f.app,{get:()=>DEFAULT_SETTINGS,save:()=>new Promise(r=>done=r)});
 const m=f.open();m.items[2].click();await tick();f.connection.close();done();await tick();assert.equal(notices.length,0);assert.equal(f.view.showMapContextMenu,f.original);
 m.items[1].click();await tick();assert.deepEqual(f.clipboard,[]);assert.equal(f.host.events.has('contextmenu'),false);unbind();
});
test('coordinates and fractional zoom are captured when the menu opens, including wrapped longitude',async()=>{
 const f=fixture(),saved:any[]=[];
 f.view.map.unproject=()=>({lat:-12.123456,lng:390});f.view.map.getZoom=()=>17.6;
 const unbind=bindLocationPickerDefaults(f.app,{get:()=>DEFAULT_SETTINGS,save:async c=>{saved.push(c);}});
 const m=f.open();f.view.map.unproject=()=>({lat:0,lng:0});f.view.map.getZoom=()=>2;
 m.items[1].click();await tick();m.items[2].click();await tick();m.items[3].click();await tick();
 assert.deepEqual(f.clipboard,['-12.12346, 30']);assert.deepEqual(saved,[{kind:'center',value:'-12.12346, 30'},{kind:'zoom',value:18}]);
 f.connection.close();unbind();
});
test('popout menus use the owner clipboard and accept an adopted DOM from a different realm',async()=>{
 const f=fixture();const old=Menu.prototype.setParentElement;
 class PopoutElement extends El {}
 f.doc.defaultView.HTMLElement=PopoutElement;for(const element of [f.panel,f.host,f.mapEl])Object.setPrototypeOf(element,PopoutElement.prototype);
 const foreignDoc:any={defaultView:{HTMLElement:class OtherEl extends El {}}};
 Menu.prototype.setParentElement=function(parent:any){this.parent=parent;this.dom=new El(foreignDoc);parent.ownerDocument.body.appendChild(this.dom);this.dom.ownerDocument=parent.ownerDocument;return this;};
 try {
  const m=f.open();assert.equal(m.dom instanceof PopoutElement,false);assert.equal(m.parent.ownerDocument,f.doc);m.items[1].click();await tick();assert.deepEqual(f.clipboard,['41.12346, 29.5']);
  assert.deepEqual(f.connection.elements(),[m.dom]);assert.equal(notices.at(-1),t('location','mapCoordinatesCopied'));
 }finally{f.connection.close();Menu.prototype.setParentElement=old;}
});
test('map capture does not consume marker events or patch an independent map instance',()=>{
 const f=fixture(),other={...f.view};let prevented=0,stopped=0;
 f.host.emit('contextmenu',{preventDefault(){prevented++;},stopPropagation(){stopped++;}});
 assert.equal(prevented,0);assert.equal(stopped,0);assert.equal(menus.length,0);assert.equal(other.showMapContextMenu,f.original);
 f.connection.close();assert.equal(f.view.showMapContextMenu,f.original);
});
test('late rejected action after close gives no notice and a replacement binding survives old cleanup',async()=>{
 const f=fixture();let reject:any;const older=bindLocationPickerDefaults(f.app,{get:()=>DEFAULT_SETTINGS,save:()=>new Promise((_,r)=>reject=r)});
 const m=f.open();m.items[2].click();await tick();f.connection.close();
 const newer=bindLocationPickerDefaults(f.app,{get:()=>({...DEFAULT_SETTINGS,locationPickerMapDefaultZoom:12}),save:async()=>{}});older();
 const warn=console.warn;console.warn=()=>{};try{reject(Error('disk'));await tick();}finally{console.warn=warn;}
 assert.equal(notices.length,0);assert.equal(getLocationPickerDefaults(f.app)?.locationPickerMapDefaultZoom,12);newer();
});
test('failed queued Settings center write preserves a later unrelated setting and accepts cleared center',async()=>{
 const s=new Store();let reject:any;let calls=0;const written:any[]=[];
 s.persistSettings=async()=>{if(++calls===1)await new Promise((_,r)=>reject=r);written.push({...s.settings});};
 const failed=assert.rejects(s.saveLocationPickerDefault({kind:'center',value:'8, 9'}));await tick();
 s.settings.locationMapsAlwaysLightMode=true;const later=s.saveSettings();reject(Error('disk'));await failed;await later;
 assert.equal(s.settings.locationMapsAlwaysLightMode,true);assert.equal(written.at(-1).locationMapsAlwaysLightMode,true);
 assert.equal(s.settings.locationPickerMapDefaultCenter,'');await s.saveLocationPickerDefault({kind:'center',value:'Unfinished input'});await s.saveLocationPickerDefault({kind:'center',value:''});assert.equal(s.settings.locationPickerMapDefaultCenter,'');
});
// Execute actual Settings handlers so equal-value user intent stays queued through a failed map save.
const renderTextSetting=(options:any)=>options,isTaskCardSetting=()=>false;
function runSettingsAsync(_message:string,action:any){return action();}
class Setting {
 text:any;
 constructor(_container:any){}
 setName(){return this;}setDesc(){return this;}
 addText(callback:any){const events:any={};const inputEl:any={value:'',addEventListener:(name:string,cb:any)=>events[name]=cb};this.text={inputEl,events,setValue(value:string){inputEl.value=value;return this;}};callback(this.text);return this;}
}
class SettingsHarness {
 constructor(public storage:any){}
 get settings(){return this.storage.settings;}
 notifySettingsChanged(){}updateNativeSettingsDefinitions(){}
 markSettingsSearchTarget(value:any){return value;}
 findSettingsSearchEntryByKey(key:string){return {key};}
 normalizeSettingsSearchControlValue(_entry:any,value:any){return value;}
 parseCalendarPresetNumber(value:string,fallback:number,min:number,max:number){return Math.min(max,Math.max(min,Number(value)||fallback));}
 async saveSettings(){throw Error('Location settings must enqueue an explicit patch');}
 ${settingsMethod('renderBoundTextSetting')}
 ${settingsMethod('renderBoundClampedNumericSetting')}
 ${settingsMethod('setControlValue')}
}
for(const kind of ['center','zoom'] as const)for(const surface of ['settings','search'])test('later equal-value '+kind+' edit via '+surface+' survives a failed map write',async()=>{
 const store=new Store(),ui=new SettingsHarness(store);let reject:any;let calls=0;const persisted:any[]=[];
 store.persistSettings=async()=>{calls++;if(calls===1)await new Promise((_,r)=>reject=r);persisted.push({...store.settings});};
 const field=kind==='center'?'locationPickerMapDefaultCenter':'locationPickerMapDefaultZoom',value=kind==='center'?'8, 9':8;
 // Controls are opened before the menu writes, matching the stale displayed value race.
 const control=kind==='center'?ui.renderBoundTextSetting(null,'','',field):ui.renderBoundClampedNumericSetting(null,'','',field,{min:1,max:18,fallback:7});
 const failed=assert.rejects(store.saveLocationPickerDefault({kind,value} as any));await tick();
 let later:Promise<any>;
 if(surface==='search')later=ui.setControlValue(field,value);
 else if(kind==='center')later=control.onChange(value);
 else{control.text.inputEl.value=String(value);later=control.text.events.blur();}
 reject(Error('disk'));await failed;await later;
 assert.equal(store.settings[field],value);assert.equal(persisted.at(-1)[field],value);assert.equal(calls,2);
});
// Exercise the actual picker functions with host services replaced, not their control flow.
let panelOptions:any,activePanel:any;
function createFloatingPanel(anchor:any,_class:any,onClose:any,options:any){activePanel=anchor;panelOptions=options;return {panel:anchor,close:()=>{onClose();anchor.remove();}};}
const isMapsPluginEnabled=()=>true;
function createButton(text:string,_class:any,host:any){return host.createEl('button',{text});}
function renderPlacesTab(){} function renderManualTab(){} function requestFloatingInputFocus(){} function setAccessibleLabelWithoutTooltip(){}
const resolveLocationPropertyName=()=> 'location';
async function readClipboardCoordinates(input:any,select:any){select(input.value);}
${pickerFn('showLocationPicker')}
${pickerFn('renderMapTab')}
test('tab changes and panel close unload only the matching render and ignore late completion',async()=>{
 const f=fixture();f.connection.close();renderCalls.length=0;
 const close=showLocationPicker(f.panel as any,{app:f.app,settings:DEFAULT_SETTINGS,onSelect:()=>{}} as any);
 const choose=(label:string)=>{const tabs=f.panel.children[1];tabs.children.find((x:any)=>x.textContent===label).emit('click');};
 choose(t('location','tab_map'));const first=renderCalls.at(-1);const firstOwner=first.args[4];assert.equal(firstOwner.loaded,true);
 choose(t('location','tab_manual'));assert.equal(firstOwner.loaded,false);
 choose(t('location','tab_map'));const second=renderCalls.at(-1);assert.notEqual(second.args[4],firstOwner);
 first.resolve();await tick();assert.equal(second.args[4].loaded,true);assert.equal(second.args[2].isConnected,true);
 close();assert.equal(second.args[4].loaded,false);second.resolve();await tick();assert.equal(second.args[2].isConnected,false);
 assert.equal(panelOptions.shouldHandleEscape(),true);
});
test('a rejected render reports only while open and another Map visit gets a fresh owner',async()=>{
 const f=fixture();f.connection.close();renderCalls.length=0;
 const close=showLocationPicker(f.panel as any,{app:f.app,settings:DEFAULT_SETTINGS,onSelect:()=>{}} as any);
 const choose=(label:string)=>f.panel.children[1].children.find((x:any)=>x.textContent===label).emit('click');
 choose(t('location','tab_map'));const first=renderCalls.at(-1);const warn=console.warn;console.warn=()=>{};
 try{first.reject(Error('render'));await tick();assert.equal(first.args[4].loaded,false);assert.deepEqual(notices,[t('location','mapMenuUnavailable')]);
 choose(t('location','tab_manual'));choose(t('location','tab_map'));const second=renderCalls.at(-1);close();notices.length=0;second.reject(Error('late'));await tick();assert.equal(notices.length,0);
 }finally{console.warn=warn;}
});
`;
 await build({stdin:{contents:code,loader:'ts',resolveDir:root},outfile,bundle:true,format:'cjs',platform:'node',target:['node18'],logLevel:'silent',alias:{obsidian:stub}});
 const result=await new Promise((resolve,reject)=>{const p=spawn(process.execPath,['--test',outfile],{stdio:'inherit'});p.on('error',reject);p.on('exit',resolve);});
 if(result!==0)process.exitCode=1;
} finally {await rm(dir,{recursive:true,force:true});}
