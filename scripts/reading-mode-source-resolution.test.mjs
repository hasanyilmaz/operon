import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { build } from 'esbuild';

// Run the production post-processor against Obsidian-shaped sections. Presentation
// is stubbed; task parsing and the complete source/DOM selection path are real.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(tmpdir(), 'operon-reading-source-'));
const source = fs.readFileSync(path.join(root, 'main.ts'), 'utf8');
const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
const plugin = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'OperonPlugin');
assert.ok(plugin);
const names = ['registerReadingModeProcessor', 'resolveReadingViewSectionTasks', 'readingListItemMatchesTask', 'getReadingListItemSourceLine', 'getReadingListItemLineCandidates', 'readReadingDataLine', 'getReadingListItemOwnText', 'isRenderedCodeElement', 'isFencedMarkdownSection', 'isMarkdownFenceLine'];
const methods = names.map(name => {
 const method = plugin.members.find(member => member.name?.getText(ast) === name);
 assert.ok(method, name);
 return method.getText(ast);
});
const prelude=`
import assert from 'node:assert/strict';
import {parseTaskLine} from ${JSON.stringify(path.join(root, 'src/core/parser'))};
import {extractReadingTaskOperonId,resolveReadingSectionInlineTasks,resolveReadingInlineTaskFromText,createIndexedReadingResolvedTask,buildReadingParsedTaskSnapshot} from ${JSON.stringify(path.join(root, 'src/ui/reading-task-operon-id'))};
class Element {
 nodeType=1; children=[]; parentElement=null; attrs={}; classes=new Set(); row=null; _text='';
 constructor(public tagName='DIV',text=''){this._text=text;}
 get childNodes(){return [...(this._text?[{nodeType:3,textContent:this._text}]:[]),...this.children];}
 get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
 set textContent(t){this._text=t;this.children=[];}
 appendChild(c){c.remove();this.children.push(c);c.parentElement=this;return c;}
 remove(){if(this.parentElement){const a=this.parentElement.children;a.splice(a.indexOf(this),1);this.parentElement=null;}}
 empty(){this._text='';for(const c of this.children)c.parentElement=null;this.children=[];}
 addClass(c){this.classes.add(c);}
 hasAttribute(n){return this.attrs[n]!==undefined;}
 getAttribute(n){return this.attrs[n]??null;}
 matches(s){return s==='li.task-list-item'?this.tagName==='LI'&&this.classes.has('task-list-item'):s==='[data-line]'?this.hasAttribute('data-line'):s==='pre, code'?['PRE','CODE'].includes(this.tagName):false;}
 closest(s){for(let p=this;p;p=p.parentElement)if(p.matches(s))return p;return null;}
 querySelectorAll(s){const a=[];for(const c of this.children){if(c.matches(s))a.push(c);a.push(...c.querySelectorAll(s));}return a;}
}
const asHTMLElement=n=>n instanceof Element?n:null;
const createDiv=()=>new Element();
const cleanupOperonRenderRoot=()=>{};
class MarkdownRenderChild {constructor(public containerEl){}}
const buildWorkflowStatusIdentityIndex=()=>({});
const enhanceReadingTaskFileWikilinks=()=>{};
const applyFileTaskPropertyVisibility=()=>{};
const renderCompactTaskMarkdown=(el,o)=>{el.textContent=o.value;};
const buildReadingTaskRowElement=(task,callbacks,description,options)=>{const el=new Element();el.row={id:task.operonId,description:task.description,readOnly:options.readOnly,line:task.primary.lineNumber};el.appendChild(description);return el;};
const DEFAULT_PRIORITIES=[];
class Harness {
 settings={pipelines:[],keyMappings:[]};app={};processor;reindexes=[]; mounts=0;tasks=new Map();
 indexer={getTask:id=>this.tasks.get(id),getAllTasks:()=>[...this.tasks.values()],getFileTaskByPath:()=>null,hasDuplicateOperonIdConflict:()=>false,scheduleReindex:p=>this.reindexes.push(p)};
 registerMarkdownPostProcessor(fn){this.processor=fn;}
 scheduleDynamicFileTaskFilterReadingMount(){this.mounts++;}
`;
const tests=String.raw`
}
const records=[];
function test(name,fn){fn();records.push({name,status:'PASS'});console.log('PASS',name);}
const sourcePath='Repro.md';
const task=(text,line)=>buildReadingParsedTaskSnapshot(parseTaskLine(text,line,sourcePath));
function render(text,start,end,rows,tasks=[],sectionAvailable=true){const h=new Harness();tasks.forEach(t=>h.tasks.set(t.operonId,t));h.registerReadingModeProcessor();const root=new Element();const ul=root.appendChild(new Element('UL'));const lis=rows.map(({text,line})=>{const li=ul.appendChild(new Element('LI',text));li.addClass('task-list-item');const input=li.appendChild(new Element('INPUT'));input.attrs['data-line']=String(line);return li;});h.processor(root,{sourcePath,getSectionInfo:()=>sectionAvailable?{text,lineStart:start,lineEnd:end}:null,addChild:()=>{}});return {h,lis,rows:lis.map(li=>li.children.find(c=>c.row)?.row??null)};}
const a='- [ ] Alpha {{operonId:: alpha01}}'; const b='- [ ] Beta {{operonId:: beta001}}';

test('task at document start renders normally',()=>{const r=render(a,0,0,[{text:a,line:0}],[task(a,0)]);assert.equal(r.rows[0].id,'alpha01');assert.equal(r.rows[0].readOnly,false);});
test('full note is restricted to the current section without double offset',()=>{const text=[a,'','# Section','',b,'','# Later',a].join('\n');const h=new Harness();const resolved=h.resolveReadingViewSectionTasks({text,lineStart:4,lineEnd:4},sourcePath);assert.deepEqual([...resolved.lineTasks.keys()],[4]);assert.deepEqual(resolved.orderedTasks.map(r=>r.task.operonId),['beta001']);});
test('native relative data-line resolves to the absolute source line',()=>{const r=render(['Heading','',a].join('\n'),2,2,[{text:a,line:0}],[task(a,2)]);const li=new Element('LI');li.addClass('task-list-item');li.appendChild(new Element('INPUT')).attrs['data-line']='0';assert.equal(r.h.getReadingListItemSourceLine(li,{lineStart:2,lineEnd:2}),2);assert.equal(r.rows[0].readOnly,false);});
for(const warm of [false,true])test('second section renders correct task with '+(warm?'warm':'cold')+' index',()=>{const text=[a,'','# Section','',b].join('\n');const r=render(text,4,4,[{text:'Beta {{operonId:: beta001}}',line:0}],warm?[task(a,0),task(b,4)]:[]);assert.equal(r.rows[0].id,'beta001');assert.equal(r.rows[0].line,4);assert.equal(r.rows[0].readOnly,!warm);assert.equal(r.h.reindexes.length,warm?0:1);});
for(const first of [a,'- [ ] ordinary checkbox'])test('long list is isolated from earlier '+(first===a?'Operon':'plain')+' task',()=>{const text=[first,'','# Section','','- [ ] one','- [ ] two','- [ ] three','- [ ] four',b].join('\n');const r=render(text,4,8,[{text:'one',line:0},{text:'two',line:1},{text:'three',line:2},{text:'four',line:3},{text:'Beta {{operonId:: beta001}}',line:4}],[task(b,8),...(first===a?[task(a,0)]:[])]);assert.deepEqual(r.rows.slice(0,4),[null,null,null,null]);assert.equal(r.rows[4].id,'beta001');assert.equal(r.rows[4].readOnly,false);assert.equal(r.h.reindexes.length,0);});
test('visible ID wins over conflicting DOM coordinates',()=>{const text=[a,b].join('\n');const r=render(text,0,1,[{text:'Beta {{operonId:: beta001}}',line:0}],[task(a,0),task(b,1)]);assert.equal(r.rows[0].id,'beta001');});
test('cursor fallback cannot substitute same-description task with a different ID',()=>{const other=a.replace('alpha01','beta001');const r=render([a,other].join('\n'),0,1,[{text:'Alpha {{operonId:: beta001}}',line:99}]);assert.equal(r.rows[0],null);});
test('out-of-range and malformed line metadata is not accepted',()=>{const r=render(['Heading','',a].join('\n'),2,2,[{text:a,line:0}],[task(a,2)]);for(const raw of ['1','-1','bad','9007199254740991']){const li=new Element('LI');li.attrs['data-line']=raw;assert.equal(r.h.getReadingListItemSourceLine(li,{lineStart:2,lineEnd:2}),null);}});
test('nested list child identity does not contaminate the parent',()=>{const parent='- [ ] Parent {{operonId:: parent1}}',child='  - [ ] Child {{operonId:: child01}}';const text=['# Section','',parent,child].join('\n');const h=new Harness();[task(parent,2),task(child,3)].forEach(t=>h.tasks.set(t.operonId,t));h.registerReadingModeProcessor();const root=new Element();const ul=root.appendChild(new Element('UL'));const p=ul.appendChild(new Element('LI','Parent {{operonId:: parent1}}'));p.addClass('task-list-item');p.appendChild(new Element('INPUT')).attrs['data-line']='0';const nested=p.appendChild(new Element('UL'));const c=nested.appendChild(new Element('LI','Child {{operonId:: child01}}'));c.addClass('task-list-item');c.appendChild(new Element('INPUT')).attrs['data-line']='1';h.processor(root,{sourcePath,getSectionInfo:()=>({text,lineStart:2,lineEnd:3}),addChild:()=>{}});assert.equal(p.children.find(e=>e.row).row.id,'parent1');assert.equal(c.children.find(e=>e.row).row.id,'child01');assert.equal(nested.parentElement,p);});
test('null section keeps the existing indexed ID fallback',()=>{const r=render(a,0,0,[{text:a,line:0}],[task(a,0)],false);assert.equal(r.rows[0].id,'alpha01');});

test('rendered identity remains consistent with the shared parser for code-wrapped fields',()=>{const tick=String.fromCharCode(96);const text='- [ ] Document '+tick+'{{operonId:: fake123}}'+tick+' {{operonId:: alpha01}}';const h=new Harness();const parsedTask=task(text,0);h.tasks.set(parsedTask.operonId,parsedTask);h.registerReadingModeProcessor();const root=new Element();const li=root.appendChild(new Element('LI','Document '));li.addClass('task-list-item');li.appendChild(new Element('CODE','{{operonId:: fake123}}'));li.appendChild(new Element('SPAN',' {{operonId:: alpha01}}'));li.appendChild(new Element('INPUT')).attrs['data-line']='0';h.processor(root,{sourcePath,getSectionInfo:()=>({text,lineStart:0,lineEnd:0}),addChild:()=>{}});assert.equal(li.children.find(e=>e.row).row.id,parsedTask.operonId);assert.equal(li.children.find(e=>e.row).row.readOnly,false);});
console.log('Reading source resolution: '+records.length+'/'+records.length+' passed');
`;

try {
 const outfile = path.join(dir, 'test.mjs');
 await build({
  stdin: { contents: prelude + methods.join('\n') + tests, resolveDir: root, loader: 'ts' },
  outfile, bundle: true, format: 'esm', platform: 'node', target: ['node18'], logLevel: 'silent',
  alias: { obsidian: path.join(root, 'scripts/test-support/obsidian.ts') },
 });
 await import(pathToFileURL(outfile).href);
} finally {
 fs.rmSync(dir, { recursive: true, force: true });
}
