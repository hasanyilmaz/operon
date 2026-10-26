import assert from 'node:assert/strict';
import './creation-index-integration.test';
import './task-creator-template-defaults.test';
import './task-creator-file-opening.test';
import { test } from 'node:test';
import { parseYaml } from 'obsidian';
import { PreparedTaskCreatorDraft } from '../src/ui/task-creator-prepared-draft';
import { DEFAULT_SETTINGS } from '../src/types/settings';
import { prepareCreationCommit } from '../src/core/task-creation-commit';
import { readInlinePropertyProjection } from '../src/core/inline-property-source';
import { splitFrontmatterDocument } from '../src/core/file-task-template-merge';
import type { CreationDraftPropertyContext } from '../src/core/task-creation-draft-properties';
const context: CreationDraftPropertyContext={keyMappings:DEFAULT_SETTINGS.keyMappings,propertyTypes:{Client:'text',Values:'multitext',Count:'number',Checked:'checkbox',Day:'date',Time:'datetime'}};
async function fixture(yaml:string) {
 const ui=new PreparedTaskCreatorDraft({properties:context,readTemplate:async()=>`---\n${yaml}\n---\nBody {{taskDescription}}`,clock:()=>({now:'2026-10-10T12:34:56'}),parent:()=>null,candidates:()=>[],onSubmit:()=>true},DEFAULT_SETTINGS);
 await ui.select({kind:'folder',path:'a.md',id:'a',name:'A'},'Task');
 return ui;
}
for(const [key,type,source,value] of [['Client','text','hello','hello'],['Client','text','',null],['Client','text','""',''],['Count','number','0',0],['Checked','checkbox','false',false],['Day','date','2026-10-10','2026-10-10'],['Time','datetime','2026-10-10T12:34:56','2026-10-10T12:34:56'],['Values','list','[3,"3",Ali,Ali]',[3,'3','Ali','Ali']],['Values','list','[]',[]],['Values','list','[""]',['']]] as const) test(`snapshot serializes ${key} ${source} to both sources`,async()=>{
 const ui=await fixture(`${key}: ${source}`);
 const before=ui.submission('inline','Task','keep-completed');
 for (const mode of ['file','inline'] as const) {
  const output=prepareCreationCommit(ui.submission(mode,'Task','keep-completed'),context,{operonId:'abc1234',now:'2026-10-11T09:00:00'});
  const yaml=parseYaml(splitFrontmatterDocument(output.fileContent()).frontmatter!);
  assert.deepEqual(yaml[key],value);
  const inline=readInlinePropertyProjection(output.inlineLine,'',{[key]:type},[...context.keyMappings],{version:1,entries:output.definitions});
  if (mode === 'inline' && (value === null || value === '' || Array.isArray(value) && value.length === 0)) {
   assert.equal(output.inlineLine.includes(`{{${key}::`),false);
   assert.equal(output.definitions.length,0);
  } else assert.deepEqual(inline?.properties[0].value,value===null && type==='text' ? '' : value);
  assert.equal(output.inlineLine.includes('Body'),false);
  assert.deepEqual(ui.submission('inline','Task','keep-completed'),before);
 }
});
test('frozen date, malicious description and manual changes are authoritative',async()=>{
 const ui=await fixture('Day: "{{date}}"\nClient: "{{taskDescription}}"');
 ui.updateInputs('A: \"x\"\nInjected: true');ui.draft.setValue('Client','manual');
 const result=prepareCreationCommit(ui.submission('file','Task','keep-completed'),context,{operonId:'abc1234',now:'2027-01-01T09:00:00'});
 const yaml=parseYaml(splitFrontmatterDocument(result.fileContent()).frontmatter!);
 assert.equal(yaml.Day,'2026-10-10');assert.equal(yaml.Client,'manual');assert.equal(yaml.Injected,undefined);
 assert.ok(result.fileContent().includes('2027-01-01T09:00:00'));
});
test('removed properties never return from the template or Templater',async()=>{
 const ui=await fixture('Client: original\nValues: [3,"3",Ali,Ali]');ui.draft.removeField('Client');
 const member=ui.field('Values').members[2];ui.draft.removeMember('Values',member.id);
 const result=prepareCreationCommit(ui.submission('file','Task','keep-completed'),context,{operonId:'abc1234',now:'2026-10-11T09:00:00'});
 const yaml=parseYaml(splitFrontmatterDocument(result.fileContent('---\nClient: returned\nValues: [wrong]\nOther: templater\n---\nRendered body')).frontmatter!);
 assert.equal(yaml.Client,undefined);assert.deepEqual(yaml.Values,[3,'3','Ali']);assert.equal(yaml.Other,'templater');
});
test('automatic and unsupported values survive file YAML and are skipped in inline',async()=>{
 const ui=await fixture('Auto: hello\nNested: {a: 3}\naliases: [Alias]\nClient: \'<% x %>\'');
 const result=prepareCreationCommit(ui.submission('inline','Task','keep-completed'),context,{operonId:'abc1234',now:'2026-10-11T09:00:00'});
 assert.ok(result.skipped.some(item=>item.sourceName==='Auto'));assert.equal(result.inlineLine.includes('hello'),false);
 const yaml=parseYaml(splitFrontmatterDocument(result.fileContent()).frontmatter!);assert.deepEqual(yaml.Nested,{a:3});assert.equal(yaml.Auto,'hello');assert.equal(yaml.Client,'<% x %>');
});
test('type changes fail closed before serialization',async()=>{
 const ui=await fixture('Count: 0');const changed={...context,propertyTypes:{Count:'text'}};
 assert.throws(()=>prepareCreationCommit(ui.submission('inline','Task','keep-completed'),changed,{operonId:'abc1234',now:'2026-10-11T09:00:00'}));
});
test('File body independent IDs remain unique and suffixed references bind the root',async()=>{
 const ui=new PreparedTaskCreatorDraft({properties:context,readTemplate:async()=> '---\noperonId: "{{operonIdA}}"\nClient: "{{operonIdA}}"\n---\n- [ ] Child {{operonId:: {{operonId}}}} {{parentTask:: {{operonIdA}}}}\n- [ ] Other {{operonId:: {{operonIdB}}}}\n```\n- [ ] Literal {{operonId:: {{operonId}}}}\n```',clock:()=>({now:'2026-10-10T12:34:56'}),parent:()=>null,candidates:()=>[],onSubmit:()=>true},DEFAULT_SETTINGS);
 await ui.select({kind:'folder',path:'a.md',id:'a',name:'A'},'Task');let counter=0;
 const result=prepareCreationCommit(ui.submission('file','Task','keep-completed'),context,{operonId:'root029',now:'2026-10-11T09:00:00',allocateId:()=>`child0${++counter}`});
 const source=result.fileContent();assert.ok(source.includes('child01'));assert.ok(source.includes('child02'));assert.ok(source.includes('{{parentTask:: root029}}'));assert.ok(source.includes('Literal {{operonId:: {{operonId}}}}'));
 assert.equal(parseYaml(splitFrontmatterDocument(source).frontmatter!).Client,'root029');
 assert.equal(result.fileContent(),source);assert.equal(counter,2);
});
test('Inline never allocates identities for ignored template body',async()=>{
 const ui=await fixture('Client: value');let calls=0;
 const request=ui.submission('inline','Task','keep-completed');if(request.template.status==='ready')request.template.rawContent+='\n- [ ] Body {{operonId:: {{operonId}}}}';
 prepareCreationCommit(request,context,{operonId:'root029',now:'2026-10-11T09:00:00',allocateId:()=>{calls++;return 'child01';}});assert.equal(calls,0);
});
test('Declared conflict diagnostics stop even when the offending field has no contribution',async()=>{
 const ui=await fixture('Client: value');const request=ui.submission('inline','Task','keep-completed');if(request.template.status==='ready')request.template.diagnostics.push({sourceName:'Client',reason:'type-conflict',inline:'unverified'});
 assert.throws(()=>prepareCreationCommit(request,context,{operonId:'root029',now:'2026-10-11T09:00:00'}));
});
test('Native tokens survive workflow checkbox and preserve canonical custom native time order',async()=>{
 const ui=await fixture('Values: [3, "3", "a;b", "a;b"]');
 const result=prepareCreationCommit(ui.submission('inline','Task','keep-completed'),context,{operonId:'root029',now:'2026-10-11T09:00:00',checkbox:'done'});
 assert.ok(result.inlineLine.startsWith('- [x] '));assert.ok(result.inlineLine.indexOf('{{Values::') < result.inlineLine.indexOf('{{datetimeCreated::'));
 const projection=readInlinePropertyProjection(result.inlineLine,'',{Values:'list'},[...context.keyMappings],{version:1,entries:result.definitions});assert.deepEqual(projection?.properties[0].value,[3,'3','a;b','a;b']);
});
test('Template selection metadata is frozen for later File creation',async()=>{
 const ui=await fixture('Client: value');const request=ui.submission('file','Task','keep-completed');assert.equal(request.templateOption?.path,'a.md');
 await ui.select(null,'Task');assert.equal(request.template.status,'ready');assert.equal(request.templateOption?.id,'a');
});
for(const yaml of ['Auto: "{{operonId}}"','aliases: ["{{operonId}}"]','Nested: {value: "{{operonId}}"}'])test(`Deferred identity keeps skip and preserve policy: ${yaml}`,async()=>{
 const ui=await fixture(yaml);
 for(const mode of ['file','inline'] as const){let id=0;const result=prepareCreationCommit(ui.submission(mode,'Task','keep-completed'),context,{operonId:'root029',now:'2026-10-11T09:00:00',allocateId:()=>`child0${++id}`});assert.equal(result.skipped.length,1);assert.ok(result.fileContent().includes('child01'));assert.equal(result.inlineLine.includes('child01'),false);}
});

test('review: scheduling is resolved in the preview with source priority',async()=>{
 const ui=new PreparedTaskCreatorDraft({properties:context,seeds:{surface:[{sourceName:'dateScheduled',value:'2026-10-10'}]},readTemplate:async()=> '---\ndatetimeStart: 2026-11-20T09:00:00\nestimate: 3600\n---\n',clock:()=>({now:'2026-10-10T12:00:00'}),parent:()=>null,candidates:()=>[],onSubmit:()=>true},DEFAULT_SETTINGS);
 await ui.select({id:'A',kind:'folder',path:'A',name:'A'},'Task');
 assert.equal(ui.field('dateScheduled').value,'2026-10-10');
 assert.equal(ui.field('datetimeStart').value,'2026-10-10T09:00:00');
 assert.equal(ui.field('datetimeEnd').value,'2026-10-10T10:00:00');
 for(const mode of ['file','inline'] as const){const output=prepareCreationCommit(ui.submission(mode,'Task','keep-completed'),context,{operonId:'root029',now:'2026-10-11T09:00:00'});for(const key of ['dateScheduled','datetimeStart','datetimeEnd'])assert.equal(output.fieldValues[key],ui.field(key).value);}
 ui.draft.setValue('dateScheduled','2026-12-01');assert.equal(ui.field('datetimeStart').value,'2026-12-01T09:00:00');
 ui.draft.removeField('dateScheduled');assert.equal(ui.field('datetimeStart').value,'');
});
test('review: inline legacy list boundaries survive literal semicolons',async()=>{
 const ui=await fixture('contexts: ["{{taskDescription}}"]');ui.updateInputs('a; b');
 const result=prepareCreationCommit(ui.submission('inline','Task','keep-completed'),context,{operonId:'root029',now:'2026-10-11T09:00:00'});
 const {parseTaskLine,parseListValue}=await import('../src/core/parser');const task=parseTaskLine(result.inlineLine,0,'',[...context.keyMappings]);
 assert.deepEqual(parseListValue(task!.fields.find(f=>f.key==='contexts')!.value),['a; b']);
});
test('review: switching templates preserves deferred identities but respects removals',async()=>{
 const ui=await fixture('Client: first');
 // The session owns its reader, so use its existing fixture with an input-dependent selection.
 const templates:Record<string,string>={A:'Client: first',B:'operonId: "{{operonIdA}}"\nClient: "{{operonIdA}}"'};
 const draft=new PreparedTaskCreatorDraft({...ui.adapter,readTemplate:async path=>`---\n${templates[path]}\n---\n`},DEFAULT_SETTINGS);
 await draft.select({id:'A',kind:'folder',path:'A',name:'A'},'Task');await draft.select({id:'B',kind:'folder',path:'B',name:'B'},'Task');
 const commit=()=>prepareCreationCommit(draft.submission('inline','Task','keep-completed'),context,{operonId:'root029',now:'2026-10-11T09:00:00'});
 assert.ok(commit().inlineLine.includes('{{Client:: root029}}'));
 draft.draft.setValue('Client','manual');assert.ok(commit().inlineLine.includes('{{Client:: manual}}'));
 draft.draft.removeField('Client');assert.ok(!commit().inlineLine.includes('{{Client::'));
});
test('review: file templates cannot supply recurrence system metadata',async()=>{
 for(const repeat of ['', 'repeat: mode=schedule|freq=day|interval=1\n']){
 const ui=await fixture(`${repeat}repeatSeriesId: old-series\nrepeatOccurrenceDate: 2020-01-01\ndateScheduled: 2026-10-11`);
 const output=prepareCreationCommit(ui.submission('file','Task','keep-completed'),context,{operonId:'root029',now:'2026-10-11T09:00:00'});
 for(const content of [output.fileContent(),output.fileContent('---\nrepeatOccurrenceDate: 1999-01-01\nrepeatSeriesId: stale\n---\nBody')]){
 const yaml=parseYaml(splitFrontmatterDocument(content).frontmatter!);assert.equal(yaml.repeatOccurrenceDate,undefined);assert.notEqual(yaml.repeatSeriesId,'old-series');assert.notEqual(yaml.repeatSeriesId,'stale');if(!repeat)assert.equal(yaml.repeatSeriesId,undefined);
 }
 }
});
test('review: Templater finalization does not reinterpret literal placeholder input',async()=>{
 const ui=await fixture('Summary: "{{taskDescription}}"\nOther: "<% tp.date.now() %>"');ui.updateInputs('{{date}}');
 const output=prepareCreationCommit(ui.submission('file','{{date}}','keep-completed'),context,{operonId:'root029',now:'2026-10-11T09:00:00'});
 const first=output.fileContent();const second=output.fileContent(first.replace('<% tp.date.now() %>','2026-10-11'));
 assert.equal(parseYaml(splitFrontmatterDocument(second).frontmatter!).Summary,'{{date}}');
});

for (const reverse of [false,true]) test(`final review: Calendar date wins with user estimate (${reverse})`,async()=>{
 const ui=new PreparedTaskCreatorDraft({properties:context,seeds:{surface:[{sourceName:'dateScheduled',value:'2026-10-10'}]},readTemplate:async()=> '---\ndatetimeStart: 2026-11-20T09:00:00\n---\n',clock:()=>({now:'2026-10-10T12:00:00'}),parent:()=>null,candidates:()=>[],onSubmit:()=>true},DEFAULT_SETTINGS);
 if(!reverse)ui.draft.setValue('estimate',3600);
 await ui.select({id:'A',kind:'folder',path:'A',name:'A'},'Task');
 if(reverse)ui.draft.setValue('estimate',3600);
 assert.equal(ui.field('dateScheduled').value,'2026-10-10');assert.equal(ui.field('datetimeStart').value,'2026-10-10T09:00:00');assert.equal(ui.field('datetimeEnd').value,'2026-10-10T10:00:00');
 for(const mode of ['file','inline'] as const){const output=prepareCreationCommit(ui.submission(mode,'Task','keep-completed'),context,{operonId:'root029',now:'2026-10-11T09:00:00'});assert.equal(output.fieldValues.dateScheduled,'2026-10-10');assert.equal(output.fieldValues.datetimeStart,'2026-10-10T09:00:00');}
});

// Default-template authoring shares the Creator draft and serializer, without changing Runtime defaults.
import { prepareDefaultInlineTemplateTask } from '../src/core/default-inline-template';
import { parseTaskLine } from '../src/core/parser';
async function defaultInline(sourceLine:string, yaml:string, parent: {sourceName:string;value:unknown}[]=[]) {
 const ui=await fixture(yaml),template=ui.session.snapshot();assert.equal(template.status,'ready');if(template.status!=='ready')throw Error('template');
 const source=parseTaskLine(sourceLine,0,'Host.md',[...context.keyMappings])!;
 const task=parseTaskLine(sourceLine+' {{operonId:: abc1234}} {{priority:: Low}} {{datetimeCreated:: 2026-10-11T09:00:00}}',0,'Host.md',[...context.keyMappings])!;
 return prepareDefaultInlineTemplateTask({template,properties:context,task,source,parent,now:'2026-10-11T09:00:00'});
}
test('default inline authoring preserves source scalar, unions lists and retains typed repeated native members',async()=>{
 const result=await defaultInline('- [ ] Source #user {{priority:: High}} {{contexts:: a}} {{Values:: 3; "3"; Ali}}','priority: Medium\ncontexts: [a,d,e]\ntags: [template]\nValues: [3,"3",Ali,Ali]',[{sourceName:'contexts',value:'a; b'},{sourceName:'tags',value:['parent']}]);
 assert.equal(result.fieldValues.priority,'High');assert.equal(result.fieldValues.contexts,'a; b; d; e');assert.deepEqual(result.tags,['user','parent','template']);
 assert.deepEqual(readInlinePropertyProjection(result.inlineLine,'Host.md',{Values:'list'},[...context.keyMappings],{version:1,entries:result.definitions})?.properties[0].value,[3,'3','Ali','Ali',3,'3','Ali']);
});
test('default inline authoring lets template override fallback and omits blanks without losing falsy values',async()=>{
 const result=await defaultInline('- [ ] Source','priority: High\nClient:\nCount: 0\nChecked: false\nValues: [""]');
 assert.equal(result.fieldValues.priority,'High');assert.ok(!result.inlineLine.includes('{{Client::'));
 const row=readInlinePropertyProjection(result.inlineLine,'Host.md',{Count:'number',Checked:'checkbox',Values:'list'},[...context.keyMappings],{version:1,entries:result.definitions});
 assert.deepEqual(row?.properties.map(field=>field.value),[0,false,['']]);
});
test('default inline authoring shares frozen time but resolves each task description independently',async()=>{
 for(const description of ['First','Second: "quoted"']) {
  const result=await defaultInline('- [ ] '+description,'Client: "{{taskDescription}}"\nDay: "{{date}}"');
  assert.deepEqual(readInlinePropertyProjection(result.inlineLine,'Host.md',{Client:'text',Day:'date'},[...context.keyMappings],{version:1,entries:result.definitions})?.properties.map(field=>field.value),[description,'2026-10-10']);
 }
});
test('default inline authoring preserves source Automatic tokens and excludes unsupported template contributions',async()=>{
 const result=await defaultInline('- [ ] Source {{Unknown:: literal}}','Unknown: replacement\nNested: {a: 1}\nClient: "<% expression %>"\naliases: [hidden]\nCount: 0');
 assert.ok(result.inlineLine.includes('{{Unknown:: literal}}'));assert.ok(!result.inlineLine.includes('{{Nested::'));assert.ok(!result.inlineLine.includes('{{aliases::'));assert.ok(!result.inlineLine.includes('{{Client::'));
 assert.ok(result.skipped.some(field=>field.sourceName==='Client'));
});
