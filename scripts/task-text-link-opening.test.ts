import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { Platform, TFile } from 'obsidian';
import { taskTextLinkAt } from '../src/ui/task-text-link-editor';
import { bindTaskTextOpening, resolveTaskTextLink } from '../src/ui/task-text-link-opening';

for (const raw of ['[[Note#Heading|Alias]]','[[../Note#^block|Alias]]','[Label](../Note.md#Heading)','[Site](https://example.com/a_(b))','https://example.com','<https://example.com/a>','[[Report.pdf#page=2]]']) {
 test(`draft link token preserves original target: ${raw}`,()=>{
  const text=`before ${raw} after`;
  const link=taskTextLinkAt(text,10);
  assert.ok(link);assert.notEqual(link.type==='wikilink'?link.target:link.destination,'Alias');
  assert.equal(taskTextLinkAt(text,2),null);
 });
}
for (const text of ['`[[Note]]`','![[Note]]','![Image](https://example.com)','\\[[Note]]','```md\n[[Note]]\n```','~~~\n[[Note]]\n~~~'])test(`code and embeds do not become task text actions: ${text}`,()=>{
 assert.equal(taskTextLinkAt(text,text.indexOf('Note')>=0?text.indexOf('Note'):text.indexOf('Image')),null);
});
test('current draft and current relative source, not old indexed value, determine target',()=>{
 const calls:any[]=[];const app:any={metadataCache:{getFirstLinkpathDest:(path:string,source:string)=>{calls.push([path,source]);return path==='missing'?null:new (TFile as any)(`${source}/${path}.md`);}}};
 const link:any={type:'wikilink',target:'Note#Heading',label:'Alias'};
 assert.equal(resolveTaskTextLink(app,link,{value:'[[Note#Heading|Alias]]',sourcePath:'New.md'}).kind,'target');
 assert.deepEqual(calls,[['Note','New.md']]);
 assert.equal(resolveTaskTextLink(app,link,{value:'[[Other]]',sourcePath:'New.md'}).kind,'missing');
 assert.equal(resolveTaskTextLink(app,{...link,target:'missing'},{value:'[[missing]]',sourcePath:'New.md'}).kind,'missing');
 assert.equal(resolveTaskTextLink(app,link,null).kind,'missing');
});
test('mobile keeps the native renderer binding and shared resolver never enables non-http schemes',()=>{
 const old=Platform.isDesktopApp;Platform.isDesktopApp=false;
 try {assert.equal(bindTaskTextOpening({} as any,()=>null),undefined);}finally{Platform.isDesktopApp=old;}
 assert.equal(resolveTaskTextLink({} as any,{type:'markdown-link',destination:'javascript:alert(1)',external:true,label:'bad'},{value:'',sourcePath:''},false).kind,'missing');
});
const source=(path:string)=>readFileSync(`src/ui/${path}.ts`,'utf8');
for (const staticPreview of [false, true]) {
 test(`reading row links in ${staticPreview ? 'static approval preview' : 'normal reading view'}`, () => {
  const implementation = source('reading-task-row').match(/^function renderTaskDescription\([\s\S]*?^}/m);
  assert.ok(implementation);
  const boundLink = () => {};
  const indexed = { operonId: 'task', primary: { filePath: 'Inbox.md' } };
  const rendered: { bindLink?: typeof boundLink, mode: string, sourcePath: string }[] = [];
  let overlays = 0;
  const ts: typeof import('typescript') = createRequire(resolve('package.json'))('typescript');
  const compiled = ts.transpile(implementation[0], { target: ts.ScriptTarget.ES2022 });
  const render = runInNewContext(compiled + '\nrenderTaskDescription', {
   getTaskDisplayTitle: () => 'See [[Notes]]',
   taskDescriptionOpening: (_app: unknown, resolve: () => unknown) => {
    assert.equal(resolve(), indexed);
    return boundLink;
   },
   renderCompactTaskMarkdown: (_el: unknown, options: typeof rendered[number]) => {
    rendered.push(options);
    return { hasLinks: true };
   },
   enhanceTaskDescriptionWikilinkOverlays: () => { overlays++; },
  });
  render({}, indexed, { app: {}, getSettings: () => ({}), getAllTasks: () => [indexed] }, staticPreview);
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0].sourcePath, 'Inbox.md');
  assert.equal(rendered[0].bindLink, staticPreview ? undefined : boundLink);
  assert.equal(rendered[0].mode, staticPreview ? 'visual-only' : 'interactive');
  assert.equal(overlays, staticPreview ? 0 : 1);
 });
}
for(const path of ['reading-task-wikilink-overlay','live-preview-task-wikilink-overlay','task-card-embed','calendar/calendar-view','kanban/kanban-view'])test(`${path} explicitly binds current description and retains its surface boundary`,()=>{
 assert.match(source(path),/bindLink: taskDescriptionOpening\(/);
});
test('popover link opt-in is restricted to Note and Description, not generic text or Creator/Editor',()=>{
 for(const path of ['table/operon-table-view','embed-table-processor'])assert.match(source(path),/openLinksInLightbox: key === 'description'/);
 for(const path of ['task-note-action','task-card-controls'])assert.match(source(path),/openLinksInLightbox: true/);
 for(const path of ['task-creator-modal','task-editor-modal']) {
  // Those editors share the component; no opt-in is injected into their own editor.
  let text='';try{text=source(path);}catch{continue;}assert.doesNotMatch(text,/openLinksInLightbox: true/);
 }
 assert.match(source('live-preview-conceal'),/if \(!isLivePreview\(view.state\)\) return null/);
 assert.match(source('live-preview-conceal'),/line.from \+ task.descriptionRange.from/);
 assert.match(source('task-card-embed'),/Platform.isDesktopApp \? 'interactive' : 'visual-only'/);
 assert.match(source('task-card-embed'),/createDiv\(\{cls: 'operon-task-card-title'/);
});

for(const [text,expected] of [['See https://example.com.','https://example.com'],['See (https://example.com).','https://example.com'],['https://example.com, next','https://example.com'],['https://example.com/a_(b).','https://example.com/a_(b)'],['[Site](https://example.com/a.)','https://example.com/a.']])test(`native bare URL punctuation: ${text}`,()=>{
 const link=taskTextLinkAt(text,text.indexOf('https')+3);assert.equal(link?.type==='markdown-link'?link.destination:null,expected);
});
test('matching fence delimiters preserve real task links after nested fence examples',()=>{
 const text='````md\n```\n[[ignored]]\n````\n[[Note]]';
 assert.equal(taskTextLinkAt(text,text.indexOf('ignored')),null);
 assert.equal(taskTextLinkAt(text,text.lastIndexOf('Note'))?.type,'wikilink');
 assert.match(source('live-preview-conceal'),/iterateMarkdownLinesOutsideFences\(view.state.doc.toString\(\), true\)/);
});
