import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=fs.mkdtempSync(path.join(tmpdir(),'operon-note-tooltip-'));
try {
 const outfile=path.join(dir,'test.mjs');
 await build({stdin:{resolveDir:root,loader:'ts',contents:String.raw`
import assert from 'node:assert/strict';
import {createTaskNoteActionButton} from './src/ui/task-note-action';
import {createOperonHoverIndicator,createCompactTaskMarkdownTooltipContent,cleanupOperonHoverTooltips} from './src/ui/operon-hover-tooltip';
let contentBuilds=0;
class Element {
 children=[];parentElement=null;dataset={};attrs=new Map();events=new Map();textContent='';ownerDocument=doc;tagName;style={setProperty(){},getPropertyValue(){return '';}};
 classes=new Set();classList={add:(...xs)=>xs.forEach(x=>this.classes.add(x)),remove:(...xs)=>xs.forEach(x=>this.classes.delete(x)),contains:x=>this.classes.has(x),toggle:(x,on)=>on?this.classes.add(x):this.classes.delete(x)};
 constructor(tag='span'){this.tagName=tag.toUpperCase();}
 set className(v){this.classes=new Set(v.split(' '));}get className(){return [...this.classes].join(' ');}
 addClass(...xs){if(xs.includes('operon-compact-task-markdown--tooltip'))contentBuilds++;this.classList.add(...xs);}
 setAttribute(k,v){this.attrs.set(k,v);}getAttribute(k){return this.attrs.get(k)??null;}removeAttribute(k){this.attrs.delete(k);}
 setCssProps(values){Object.assign(this.style,values);}
 appendChild(e){e.parentElement=this;this.children.push(e);return e;}
 remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(e=>e!==this);this.parentElement=null;}
 querySelectorAll(selector){const all=this.children.flatMap(e=>[e,...e.querySelectorAll('*')]);return selector==='*'?all:all.filter(e=>selector.startsWith('.')?e.classes.has(selector.slice(1)):false);}
 querySelector(s){return this.querySelectorAll(s)[0]??null;}closest(){return null;}
 getBoundingClientRect(){return {left:20,right:40,top:20,bottom:40,width:20,height:20};}
 addEventListener(k,fn){const a=this.events.get(k)??[];a.push(fn);this.events.set(k,a);}removeEventListener(k,fn){this.events.set(k,(this.events.get(k)??[]).filter(x=>x!==fn));}
 keyboardFocus=false;matches(selector){return selector===':focus-visible'&&this.keyboardFocus;}
 emit(type){if(type==='focusin')this.keyboardFocus=true;if(type==='focusout')this.keyboardFocus=false;for(const fn of [...(this.events.get(type)??[])])fn({type});}
}
const documentEvents=new EventTarget();
const doc={body:null,defaultView:null,win:null,getElementById:()=>null,addEventListener:documentEvents.addEventListener.bind(documentEvents),removeEventListener:documentEvents.removeEventListener.bind(documentEvents)};
const win={innerWidth:900,innerHeight:800,createEl:tag=>new Element(tag),createSpan:()=>new Element(),addEventListener(){},removeEventListener(){},requestAnimationFrame:fn=>fn()};
doc.defaultView=win;doc.win=win;doc.body=new Element('body');Object.assign(globalThis,{activeDocument:doc,activeWindow:win});
const options={owner:doc.body,icon:'notebook-pen',label:'Edit note',tooltipTitle:'Note',onActivate(){}};
const text=e=>e.textContent+e.children.map(text).join('');
for(const event of ['mouseenter','focusin']){
 contentBuilds=0;const button=createTaskNoteActionButton({...options,noteValue:'Old **formatted** note'});assert.equal(contentBuilds,0);
 button.emit(event);assert.equal(contentBuilds,1);assert.ok(text(doc.body).includes('Old formatted note'));
 button.emit(event);assert.equal(contentBuilds,1);
 button.emit(event==='focusin'?'focusout':'mouseleave');button.emit(event);assert.equal(contentBuilds,2);
 cleanupOperonHoverTooltips(button);assert.equal(doc.body.children.length,0);button.emit(event);assert.equal(contentBuilds,2);
 const replacement=createTaskNoteActionButton({...options,noteValue:'New note'});assert.equal(contentBuilds,2);replacement.emit(event);assert.ok(text(doc.body).includes('New note'));assert.ok(!text(doc.body).includes('Old formatted note'));cleanupOperonHoverTooltips(replacement);
}
contentBuilds=0;const indicator=createOperonHoverIndicator({owner:doc.body,icon:'notebook-pen',title:'Read only',taskColor:null,contentElFactory:()=>createCompactTaskMarkdownTooltipContent(doc.body,'Read-only **note**')});
assert.equal(contentBuilds,0);assert.equal(indicator.children[0].getAttribute('tabindex'),'0');
const trigger=indicator.children[0];trigger.emit('focusin');assert.equal(contentBuilds,1);assert.ok(text(doc.body).includes('Read-only note'));assert.equal(indicator.querySelector('.operon-hover-tooltip'),null);trigger.emit('mouseenter');assert.equal(contentBuilds,1);
cleanupOperonHoverTooltips(indicator);assert.equal(indicator.querySelector('.operon-hover-tooltip'),null);assert.equal(doc.body.children.length,0);trigger.emit('focusin');assert.equal(contentBuilds,1);
const empty=createTaskNoteActionButton({...options,noteValue:''});empty.emit('focusin');assert.equal(contentBuilds,1);cleanupOperonHoverTooltips(empty);
console.log('Inline note tooltip: lazy content, pointer/keyboard, reopen, replacement, readonly and cleanup passed');
`},outfile,bundle:true,format:'esm',platform:'node',logLevel:'silent',alias:{obsidian:path.join(root,'scripts/test-support/obsidian.ts')}});
 await import(pathToFileURL(outfile).href);
} finally {fs.rmSync(dir,{recursive:true,force:true});}
