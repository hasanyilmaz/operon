import './task-creator-submit-lifecycle.test';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PreparedTaskCreatorDraft, type PreparedTaskCreatorAdapter } from '../src/ui/task-creator-prepared-draft';
import { DEFAULT_SETTINGS, migrateSettings, buildDefaultTaskChipSettings } from '../src/types/settings';
import { createEmptyTaskCreatorDraft, TaskCreatorModal } from '../src/ui/task-creator-modal';
import { App, Platform } from 'obsidian';
import { applyTaskFieldPatchToState } from '../src/core/task-field-patch';
import type { FileTaskTemplateOption } from '../src/core/file-task-templates';
const option = (id='A'): FileTaskTemplateOption => ({id,name:id,path:id,kind:'folder'});
const yaml = (body:string) => `---\n${body}\n---\nBody`;
for (const empty of ['null', '""']) test(`empty template parent ${empty} does not turn preview into routing`, async () => {
 const f = fixture(yaml(`parentTask: ${empty}`), {
  parent: id => ({ fields: { contexts: id }, tags: [], nativeValues: new Map() }),
 });
 await f.ui.select(option(), 'Task');
 f.ui.setPreviewParent('drawing');
 const request = f.ui.submission('inline', 'Task', createEmptyTaskCreatorDraft().inlineCompletionMode);
 assert.equal(f.ui.field('parentTask').value, 'drawing');
 assert.ok(request.routingSnapshot);
 assert.notEqual(request.routingSnapshot.fields.find(field => field.property.canonicalKey === 'parentTask')?.value, 'drawing');
 f.ui.backgroundParent('actual', null, null);
 assert.equal(f.ui.field('parentTask').value, 'actual');
});
test('implicit parent preview stays typed without becoming an explicit routing choice', async () => {
 const f = fixture(yaml('contexts: [template]\npriority: Medium'), {
  parent: id => ({ fields: { contexts: id, priority: 'High' }, tags: [id], nativeValues: new Map() }),
 });
 await f.ui.select(option(), 'Task');
 f.ui.setPreviewParent('drawing');
 assert.equal(f.ui.field('parentTask').value, 'drawing');
 assert.deepEqual(f.ui.field('contexts').value, ['drawing', 'template']);
 const request = f.ui.submission('inline', 'Task', createEmptyTaskCreatorDraft().inlineCompletionMode);
 assert.equal(request.snapshot.fields.find(field => field.property.canonicalKey === 'parentTask')?.value, 'drawing');
 assert.equal(request.routingSnapshot?.fields.find(field => field.property.canonicalKey === 'parentTask')?.state, 'missing');
 assert.deepEqual(request.routingSnapshot?.fields.find(field => field.property.canonicalKey === 'contexts')?.value, ['template']);
 f.ui.backgroundParent('actual', null, null);
 assert.equal(f.ui.field('parentTask').value, 'actual');
 assert.deepEqual(f.ui.field('contexts').value, ['actual', 'template']);
 assert.equal(f.ui.submission('inline', 'Task', createEmptyTaskCreatorDraft().inlineCompletionMode).routingSnapshot, undefined);
});
test('clearing a destination preview removes only preview inheritance and retains user changes', async () => {
 const f = fixture(yaml('contexts: [template]'), {
  parent: id => ({ fields: { contexts: id }, tags: [id], nativeValues: new Map() }),
 });
 await f.ui.select(option(), 'Task');
 f.ui.setPreviewParent('drawing');
 f.ui.applyPayload({ priority: 'High' });
 f.ui.backgroundParent('', null, null);
 assert.equal(f.ui.field('parentTask').state, 'missing');
 assert.deepEqual(f.ui.field('contexts').value, ['template']);
 assert.equal(f.ui.field('priority').value, 'High');
 f.ui.setPreviewParent('drawing');
 f.ui.setPreviewParent(null);
 assert.equal(f.ui.field('parentTask').state, 'missing');
 assert.deepEqual(f.ui.field('contexts').value, ['template']);
});
test('explicit parent selection or removal wins over drawing preview and target inheritance', () => {
 for (const selected of ['manual', 'drawing', '']) {
  const f = fixture('', { parent: id => ({ fields: { contexts: id }, tags: [], nativeValues: new Map() }) });
  f.ui.setPreviewParent('drawing');
  f.ui.applyPayload({ parentTask: selected });
  f.ui.setPreviewParent('other-preview');
  f.ui.backgroundParent('actual', null, null);
  assert.equal(f.ui.field('parentTask').value, selected);
  assert.equal(f.ui.submission('inline', 'Task', createEmptyTaskCreatorDraft().inlineCompletionMode).routingSnapshot, undefined);
 }
});
function fixture(content:string, overrides:Partial<PreparedTaskCreatorAdapter>={}) {
 let reads=0;
 const adapter:PreparedTaskCreatorAdapter={properties:{keyMappings:DEFAULT_SETTINGS.keyMappings,propertyTypes:{Client:'text',Values:'multitext',Count:'number',Checked:'checkbox',Day:'date',Time:'datetime'}},readTemplate:async()=>{reads++;return content;},clock:()=>({now:'2026-10-10T12:34:56'}),parent:()=>null,candidates:()=>[],onSubmit:()=>true,...overrides};
 const settings=structuredClone(DEFAULT_SETTINGS);settings.childTaskInheritanceFields.push('contexts','tags');const ui=new PreparedTaskCreatorDraft(adapter,settings);return {ui,adapter,reads:()=>reads};
}
for(const [key,source,value] of [['Client','hello','hello'],['Client','',null],['Count','0',0],['Checked','false',false],['Day','2026-10-10','2026-10-10'],['Time','2026-10-10T12:34:56','2026-10-10T12:34:56'],['Values','[3,"3",Ali,Ali]',[3,'3','Ali','Ali']],['Values','[]',[]],['Values','[""]',['']]] as const) test(`prepared Creator retains ${key} ${source}`,async()=>{
 const f=fixture(yaml(`${key}: ${source}`));await f.ui.select(option(),'Task');assert.deepEqual(f.ui.field(key).value,value);const legacy=createEmptyTaskCreatorDraft();f.ui.syncLegacy(legacy);assert.equal(key in legacy.fieldValues,false);assert.ok(f.ui.visibleKeys('inline').includes(key));
 const request=f.ui.submission('inline','Task',legacy.inlineCompletionMode);assert.deepEqual(request.snapshot.fields.find(f=>f.property.sourceName===key)?.value,value);
});
test('sources remain independent, tag/context removals and explicit empties survive replacement',async()=>{
 const f=fixture(yaml('contexts: [d,e]\npriority: Low'),{seeds:{surface:[{sourceName:'priority',value:'High'}],user:[{sourceName:'contexts',value:['a']}]}});
 // Incremental UI user additions, not an authoritative whole-field initial replacement.
 let parentContexts='a; b';const g=fixture(yaml('contexts: [d,e]'),{parent:()=>({fields:{contexts:parentContexts},tags:[],nativeValues:new Map()})});g.ui.applyPayload({parentTask:'P'});g.ui.draft.appendMember('contexts','a');await g.ui.select(option(),'Task');assert.deepEqual(g.ui.field('contexts').value,['a','b','d','e']);g.ui.applyPayload({contexts:['a','d','e']});parentContexts='a; b; c';g.ui.refreshParent();assert.deepEqual(g.ui.field('contexts').value,['a','c','d','e']);
 await f.ui.select(option(),'Task');assert.equal(f.ui.field('priority').value,'High');f.ui.applyPayload({priority:''});await f.ui.select(option('B'),'Task');assert.equal(f.ui.field('priority').value,'');
});
test('template inputs exclude template output even when default also exists',async()=>{
 const f=fixture(yaml('note: "{{note}} / suffix"'),{seeds:{defaults:[{sourceName:'note',value:'base'}]}});await f.ui.select(option(),'Task');assert.equal(f.ui.field('note').value,'base / suffix');f.ui.updateInputs('new title');assert.equal(f.ui.field('note').value,'base / suffix');assert.equal(f.reads(),1);
});
test('frozen clock, user field and member changes survive input recalculation and template replacement',async()=>{
 const f=fixture(yaml('Day: "{{date}}"\nClient: "{{taskDescription}}"\nValues: ["{{taskDescription}}", Ali, Ali]'));await f.ui.select(option(),'first');const members=f.ui.field('Values').members;f.ui.draft.editMember('Values',members[1].id,'Changed');f.ui.draft.removeMember('Values',members[2].id);f.ui.draft.setValue('Client','manual');f.ui.updateInputs('second');assert.deepEqual(f.ui.field('Values').value,['second','Changed']);assert.equal(f.ui.field('Client').value,'manual');assert.equal(f.ui.field('Day').value,'2026-10-10');assert.equal(f.reads(),1);await f.ui.select(option('B'),'third');assert.ok((f.ui.field('Values').value as string[]).includes('Changed'));
});
test('native icons reorder with current template; empty/removal and aliases differ',async()=>{
 const f=fixture('',{readTemplate:async path=>yaml(path==='A'?'Client: first\nCount: 0':'Count: 0\nClient: second')});await f.ui.select(option(),'Task');assert.deepEqual(f.ui.visibleKeys('inline').slice(-2),['Client','Count']);await f.ui.select(option('B'),'Task');assert.deepEqual(f.ui.visibleKeys('inline').slice(-2),['Count','Client']);f.ui.draft.clearValue('Client');assert.ok(f.ui.visibleKeys('inline').includes('Client'));f.ui.draft.removeField('Client');assert.ok(!f.ui.visibleKeys('inline').includes('Client'));
});
test('Automatic and conflicting values stay readonly, skipped/deferred values are not usable inline',async()=>{
 const f=fixture(yaml('Unknown: text\nCount: wrong\nNested: {a: 1}\nDynamic: "<% tp.date.now() %>"\nId: "{{operonId}}"'));await f.ui.select(option(),'Task');assert.equal(f.ui.field('Unknown').readOnlyReason,'automatic');assert.equal(f.ui.field('Count').readOnlyReason,'type-conflict');assert.throws(()=>f.ui.draft.setValue('Unknown','edit'));for(const key of ['Nested','Dynamic','Id'])assert.ok(!f.ui.fields('inline').some(field=>field.property.sourceName===key));
});
test('loading/error/clear/close gate submit and ignore late results without writes',async()=>{
 let resolve!:(value:string)=>void;const f=fixture('',{readTemplate:()=>new Promise(r=>resolve=r)});const loading=f.ui.select(option(),'Task');assert.equal(f.ui.canSubmit('inline'),false);assert.throws(()=>f.ui.submission('inline','Task',createEmptyTaskCreatorDraft().inlineCompletionMode));await f.ui.select(null,'Task');resolve(yaml('Client: late'));await loading;assert.equal(f.ui.field('Client').state,'missing');assert.equal(f.ui.canSubmit('inline'),true);assert.equal(f.ui.canSubmit('file'),false);f.ui.close();assert.equal(f.ui.canSubmit('inline'),false);
 const broken=fixture('---\nClient: [broken\n---');await broken.ui.select(option(),'Task');assert.equal(broken.ui.session.snapshot().status,'error');assert.equal(broken.ui.canSubmit('inline'),false);
});
test('submit is isolated from future edits and File/Inline retain selection',async()=>{
 const f=fixture(yaml('Client: initial'));await f.ui.select(option(),'Task');const mode=createEmptyTaskCreatorDraft().inlineCompletionMode;const a=f.ui.submission('inline','Task',mode);const b=f.ui.submission('file','Task',mode);assert.deepEqual(a.snapshot,b.snapshot);assert.deepEqual(a.template,b.template);f.ui.draft.setValue('Client','later');assert.equal(a.snapshot.fields.find(f=>f.property.sourceName==='Client')?.value,'initial');
});
test('preview recurrence applies rules without generating a repeat identity',()=>{
 const result=applyTaskFieldPatchToState({currentFields:{},currentTags:[],payload:{repeat:'every day'},deferRepeatIdentity:true});assert.equal(result.fieldValues.repeatSeriesId,undefined);
});
test('initial user contexts merge with parent/template instead of masking them',async()=>{
 const f=fixture(yaml('contexts: [d,e]'),{seeds:{surface:[{sourceName:'parentTask',value:'P'}],user:[{sourceName:'contexts',value:['a']}]},parent:()=>({fields:{contexts:'a; b'},tags:[],nativeValues:new Map()})});await f.ui.select(option(),'Task');assert.deepEqual(f.ui.field('contexts').value,['a','b','d','e']);
});
test('removing and clearing the parent retires its contributions',()=>{
 const f=fixture('',{parent:()=>({fields:{priority:'High',contexts:'b'},tags:['parent'],nativeValues:new Map()})});f.ui.applyPayload({parentTask:'parent'});assert.ok(f.ui.draft.snapshot().fields.some(field=>field.contributions.some(c=>c.source==='parent')));f.ui.remove('parentTask',false);assert.ok(!f.ui.draft.snapshot().fields.some(field=>field.contributions.some(c=>c.source==='parent')));assert.equal(f.ui.field('parentTask').state,'removed');
});
test('template parent replacement reconciles immediately without parent self-lock',async()=>{
 const f=fixture('',{readTemplate:async id=>yaml(`parentTask: ${id}`),parent:id=>({fields:{priority:id==='A'?'High':'Low'},tags:[],nativeValues:new Map()})});await f.ui.select(option(),'Task');assert.equal(f.ui.field('parentTask').value,'A');assert.equal(f.ui.field('priority').value,'High');await f.ui.select(option('B'),'Task');assert.equal(f.ui.field('parentTask').value,'B');assert.equal(f.ui.field('priority').value,'Low');await f.ui.select(null,'Task');assert.equal(f.ui.field('priority').state,'missing');
});
test('repeat preview cleanup retains companion-field rules while deferring identities',()=>{
 const result=applyTaskFieldPatchToState({currentFields:{repeat:'every day',datetimeRepeatEnd:'2026-10-10T12:00:00'},currentTags:[],payload:{repeat:''},deferRepeatIdentity:true});assert.equal(result.fieldValues.datetimeRepeatEnd,undefined);assert.equal(result.fieldValues.repeatSeriesId,undefined);
});
test('background parent seed participates in common model and respects explicit removal',()=>{
 const f=fixture('');f.ui.backgroundParent('P',{priority:'High'},[]);assert.equal(f.ui.field('parentTask').value,'P');assert.equal(f.ui.field('priority').value,'High');f.ui.updateInputs('Changed');assert.equal(f.ui.field('priority').value,'High');f.ui.remove('parentTask',false);f.ui.backgroundParent('Other',{priority:'Low'},[]);assert.equal(f.ui.field('parentTask').state,'removed');assert.equal(f.ui.field('priority').state,'missing');
});
test('eligible native parent values use typed ready-index data even without a managed string value',async()=>{
 const mapping={canonicalKey:'scores',visiblePropertyName:'Scores',yamlKey:'Scores',type:'list' as const,isSystem:false,sync:'yes' as const,enabled:true,aliases:[],icon:'list'};
 const settings=structuredClone(DEFAULT_SETTINGS);settings.keyMappings.push(mapping);settings.childTaskInheritanceFields=['scores'];
 const f=fixture('',{properties:{keyMappings:settings.keyMappings,propertyTypes:{Scores:'multitext'}},parent:()=>({fields:{},tags:[],nativeValues:new Map([['scores',[3,'3','Ali','Ali']]])})});
 const ui=new PreparedTaskCreatorDraft(f.adapter,settings);ui.applyPayload({parentTask:'P'});assert.deepEqual(ui.field('scores').value,[3,'3','Ali','Ali']);
});

test('review: stale set picker preserves unseen parent values and applies only its own removals',()=>{
 let contexts='a';const f=fixture('',{seeds:{surface:[{sourceName:'parentTask',value:'P'}]},parent:()=>({fields:{contexts},tags:[],nativeValues:new Map()})});
 const baseline=f.ui.field('contexts');contexts='a; b';f.ui.refreshParent();
 f.ui.applyPayload({contexts:['a','c']},baseline);assert.deepEqual(f.ui.field('contexts').value,['c','a','b']);
 f.ui.refreshParent();assert.deepEqual(f.ui.field('contexts').value,['c','a','b']);
 f.ui.applyPayload({contexts:[]},baseline);assert.deepEqual(f.ui.field('contexts').value,['c','b']);
 f.ui.draft.clearValue('contexts');f.ui.refreshParent();assert.deepEqual(f.ui.field('contexts').value,[]);
});

test('inline default settings preserve unavailable IDs, roundtrip in schema 2/3, and default to None', async()=>{
 const {buildOperonDataPackageFromSettings,composeOperonSettingsFromDataPackage}=await import('../src/storage/operon-data-package');
 const {ALL_OPERON_SETTINGS_BACKUP_KEYS,SETTINGS_BACKUP_COMPATIBILITY_BY_KEY}=await import('../src/core/settings-backup-compatibility');
 assert.equal(migrateSettings({}).defaultInlineTaskTemplateId,null);
 assert.equal(migrateSettings({defaultInlineTaskTemplateId:'  '}).defaultInlineTaskTemplateId,null);
 const id='builtin-minimal-file-task-template:unavailable';
 const settings=migrateSettings({...DEFAULT_SETTINGS,defaultInlineTaskTemplateId:id});assert.equal(settings.defaultInlineTaskTemplateId,id);
 const pkg=buildOperonDataPackageFromSettings(settings);assert.equal(pkg.ui.taskCreationProfile.defaultInlineTaskTemplateId,id);
 for(const schemaVersion of [2,3] as const){const loaded=composeOperonSettingsFromDataPackage({...pkg,schemaVersion},DEFAULT_SETTINGS);assert.equal(loaded.defaultInlineTaskTemplateId,id);}
 assert.ok(ALL_OPERON_SETTINGS_BACKUP_KEYS.includes('defaultInlineTaskTemplateId'));
 assert.ok(SETTINGS_BACKUP_COMPATIBILITY_BY_KEY.defaultInlineTaskTemplateId);
});
test('unavailable template invalidates old read and preserves user fields',async()=>{
 let finish!:(text:string)=>void;const f=fixture('',{readTemplate:()=>new Promise(r=>finish=r)});
 f.ui.draft.setValue('Client','manual');const pending=f.ui.select(option(),'Task');f.ui.session.selectUnavailable('missing');finish(yaml('Count: 3'));await pending;
 assert.equal(f.ui.session.snapshot().status,'error');assert.equal(f.ui.canSubmit('inline'),false);assert.equal(f.ui.field('Client').value,'manual');assert.equal(f.ui.field('Count').state,'missing');
 await f.ui.select(null,'Task');assert.equal(f.ui.canSubmit('inline'),true);
});

test('Creator user-change check ignores defaults, template loading and parent refresh', async () => {
 const f = fixture(yaml('Client: template\npriority: Medium\nnote: Template note'), {
  seeds: { defaults: [{sourceName:'status',value:'Todo'},{sourceName:'priority',value:'Low'}] },
  parent: () => ({ fields:{contexts:'Work'},tags:['inherited'],nativeValues:new Map() }),
 });
 assert.equal(f.ui.hasUserChanges(),false);
 await f.ui.select(option(),'');
 f.ui.setPreviewParent('P'); f.ui.updateInputs(''); f.ui.refreshParent();
 assert.equal(f.ui.hasUserChanges(),false);
 await f.ui.select(option('B'),'');
 assert.equal(f.ui.hasUserChanges(),false);
 await f.ui.select(null,'');
 assert.equal(f.ui.hasUserChanges(),false);
});

test('Creator detects native scalar/list edits, clears and removals, with value restoration', async () => {
 for (const action of ['scalar','list','clear','remove'] as const) {
  const f=fixture(yaml('Client: initial\nValues: [first, second]'));await f.ui.select(option(),'');
  if(action==='scalar')f.ui.draft.setValue('Client','changed');
  if(action==='list')f.ui.draft.editMember('Values',f.ui.field('Values').members[0].id,'changed');
  if(action==='clear')f.ui.draft.clearValue('Client');
  if(action==='remove')f.ui.draft.removeField('Client');
  assert.equal(f.ui.hasUserChanges(),true,action);
  if(action==='list')f.ui.draft.setValue('Values',['first','second']);
  else f.ui.draft.setValue('Client','initial');
  assert.equal(f.ui.hasUserChanges(),false,`${action} restored`);
 }
});

test('Creator opening user seeds are clean and source refresh does not mask later edits', async () => {
 const f=fixture(yaml('Client: automatic\ncontexts: [template]'),{seeds:{user:[{sourceName:'note',value:'Opening note'},{sourceName:'contexts',value:['opening']}]}});
 await f.ui.select(option(),'');assert.equal(f.ui.hasUserChanges(),false);
 f.ui.draft.setValue('note','Edited note');assert.equal(f.ui.hasUserChanges(),true);
 await f.ui.select(option('B'),'');assert.equal(f.ui.hasUserChanges(),true);
 f.ui.draft.setValue('note','Opening note');assert.equal(f.ui.hasUserChanges(),false);
 f.ui.draft.appendMember('contexts','extra');assert.equal(f.ui.hasUserChanges(),true);
 f.ui.draft.removeMember('contexts',f.ui.field('contexts').members.find(member=>member.value==='extra')!.id);
 assert.equal(f.ui.hasUserChanges(),false);
});

test('late automatic template completion never becomes a user change',async()=>{
 let finish!:(content:string)=>void;const f=fixture('',{readTemplate:()=>new Promise(resolve=>{finish=resolve;})});
 const loading=f.ui.select(option(),'');assert.equal(f.ui.hasUserChanges(),false);
 finish(yaml('Client: late\nnote: Automatic note'));await loading;assert.equal(f.ui.hasUserChanges(),false);
 f.ui.applyPayload({note:'User note'});await f.ui.select(null,'');assert.equal(f.ui.hasUserChanges(),true);
});

function closeProbe(prepared=true, initialDraft=createEmptyTaskCreatorDraft()) {
 const f=fixture(yaml('Client: template\nstatus: Todo\npriority: Medium\nnote: Automatic note'),{seeds:{defaults:[{sourceName:'priority',value:'Low'}]}});
 const modal:any=new TaskCreatorModal(new App(),{
  settings:structuredClone(DEFAULT_SETTINGS),allTasks:[],initialDraft,initialCreateType:'inline',
  defaultInlineTemplateId:'A',defaultFileTemplateId:'B',fileTaskTemplateOptions:[option('A'),option('B'),option('C')],
  ...(prepared?{preparedAdapter:f.adapter}:{}),onSubmitInline:()=>true,onSubmitFile:()=>true,
 });
 modal.renderSubmitControls=()=>{};modal.renderFieldButtons=()=>{};modal.applyThemeColor=()=>{};
 modal.closeActivePicker=()=>{};modal.focusDescription=()=>{};
 return modal;
}

test('real Creator close check ignores automatic fields and empty note visibility',async()=>{
 const modal=closeProbe();assert.equal(modal.hasUnsavedDraft(),false);
 await modal.selectPreparedTemplateId('A');assert.equal(modal.hasUnsavedDraft(),false);
 modal.draft.noteOpen=true;assert.equal(modal.hasUnsavedDraft(),false);
 modal.prepared.draft.setValue('Client','User value');modal.refreshPreparedDraft();
 assert.equal(modal.hasUnsavedDraft(),true,'native-only edit');
});

test('File/Inline mode changes stay clean and preserve actual user edits',async()=>{
 const savedWindow=globalThis.window;
 Object.assign(globalThis,{window:{setTimeout:()=>0}});
 try {
  const modal=closeProbe();await modal.selectPreparedTemplateId('A');
  for(const mode of ['file','inline','file','inline']) {
   modal.setActiveCreateType(mode);await modal.selectPreparedTemplateId(mode==='file'?'B':'A');
   assert.equal(modal.hasUnsavedDraft(),false,mode);
  }
  modal.prepared.draft.setValue('Client','Manual');modal.refreshPreparedDraft();
  modal.setActiveCreateType('file');await modal.selectPreparedTemplateId('B');
  assert.equal(modal.hasUnsavedDraft(),true);assert.equal(modal.prepared.field('Client').value,'Manual');
 } finally {Object.assign(globalThis,{window:savedWindow});}
});

test('Creator description/note changes warn and restoring opening values stays clean',()=>{
 const opening=createEmptyTaskCreatorDraft();opening.description='Opening description';opening.note='Opening note';
 const modal=closeProbe(false,opening);assert.equal(modal.hasUnsavedDraft(),false);
 modal.draft.description='Edited';assert.equal(modal.hasUnsavedDraft(),true);
 modal.draft.description=opening.description;assert.equal(modal.hasUnsavedDraft(),false);
 modal.draft.note='Edited note';assert.equal(modal.hasUnsavedDraft(),true);
 modal.draft.note=opening.note;modal.draft.noteOpen=true;assert.equal(modal.hasUnsavedDraft(),false);
});

test('manual template changes and clearing warn independently of automatic mode selection',async()=>{
 const modal=closeProbe();await modal.selectPreparedTemplateId('A');
 modal.userTemplateSelections.set('inline','A');assert.equal(modal.hasUnsavedDraft(),false);
 modal.userTemplateSelections.set('inline','C');await modal.selectPreparedTemplateId('C');assert.equal(modal.hasUnsavedDraft(),true);
 await modal.selectPreparedTemplateId('B');assert.equal(modal.hasUnsavedDraft(),true,'automatic switch cannot clear explicit template change');
 modal.userTemplateSelections.set('inline','A');await modal.selectPreparedTemplateId('A');assert.equal(modal.hasUnsavedDraft(),false);
 modal.userTemplateSelections.set('inline','');await modal.selectPreparedTemplateId('');assert.equal(modal.hasUnsavedDraft(),true);
});

test('Escape, outside click and close share the corrected discard decision',async()=>{
 for(const route of ['escape','outside','close']) {
  const modal=closeProbe();await modal.selectPreparedTemplateId('A');let closed=0,prompted=0;
  modal.forceClose=()=>{closed++;};modal.promptDiscardDraft=()=>{prompted++;};modal.modalEl.contains=()=>false;
  const invoke=()=>route==='escape'?modal.handleEscapeIntent():route==='close'?modal.close():modal.handleContainerPointerDown({target:{nodeType:1,closest:()=>null},preventDefault(){},stopPropagation(){}});
  invoke();assert.equal(closed,1,route);assert.equal(prompted,0,route);
  modal.draft.description='User task';invoke();assert.equal(closed,1,route);assert.equal(prompted,1,route);
 }
});

test('legacy Creator defaults are clean but explicit field and list changes warn',()=>{
 const opening=createEmptyTaskCreatorDraft();opening.fieldValues.priority='Medium';
 const modal=closeProbe(false,opening);assert.equal(modal.hasUnsavedDraft(),false);
 modal.draft.fieldValues.priority='High';modal.draft.explicitFieldKeys=['priority'];assert.equal(modal.hasUnsavedDraft(),true);
 modal.draft.fieldValues.priority='Medium';assert.equal(modal.hasUnsavedDraft(),false);
 modal.draft.tags=['User'];assert.equal(modal.hasUnsavedDraft(),true);modal.draft.tags=[];
 modal.draft.subtaskIds=['Child'];assert.equal(modal.hasUnsavedDraft(),true);
});


test('repeat completion choice is a real picker change in prepared and legacy Creator',()=>{
 for(const prepared of [true,false]) {
  const modal=closeProbe(prepared);assert.equal(modal.hasUnsavedDraft(),false);
  const initial=modal.draft.inlineCompletionMode;
  modal.draft.inlineCompletionMode=initial==='replace-completed'?'keep-completed':'replace-completed';
  assert.equal(modal.hasUnsavedDraft(),true);
  modal.draft.inlineCompletionMode=initial;assert.equal(modal.hasUnsavedDraft(),false);
 }
});

test('empty opening note and tags become clean when user content is fully removed',()=>{
 const f=fixture('');f.ui.applyPayload({note:'Typed note'});assert.equal(f.ui.hasUserChanges(),true);
 f.ui.applyPayload({note:''});assert.equal(f.ui.hasUserChanges(),false);
 f.ui.draft.appendMember('tags','first');assert.equal(f.ui.hasUserChanges(),true);
 f.ui.draft.removeMember('tags',f.ui.field('tags').members[0].id);assert.equal(f.ui.hasUserChanges(),false);
 f.ui.draft.setValue('Client',null);assert.equal(f.ui.hasUserChanges(),true,'native explicit empty remains meaningful');
});

test('checkbox property icons distinguish booleans, missing values and configured type icons', async () => {
 const { getCheckboxPropertyIcon, getCheckboxPropertyTypeIcon, getCustomFieldTypeFallbackIcon, isProjectedCustomFieldType } = await import('../src/ui/custom-field-surfaces');
 const { getTableFilePropertyTypeIcon } = await import('../src/ui/table/table-file-property');
 const mapping = { canonicalKey: 'watched', visiblePropertyName: 'Watched', type: 'checkbox', icon: 'star', isSystem: false, enabled: true } as any;
 assert.equal(getCustomFieldTypeFallbackIcon('checkbox'), 'square-dashed');
 assert.equal(getTableFilePropertyTypeIcon('checkbox'), 'square-dashed');
 assert.equal(getCheckboxPropertyTypeIcon([mapping], 'Watched'), 'star');
 assert.equal(getCheckboxPropertyTypeIcon([], 'Watched'), 'square-dashed');
 for (const value of [undefined, null, '', 'false', 0]) assert.equal(getCheckboxPropertyIcon(value, 'star'), 'star');
 assert.equal(getCheckboxPropertyIcon(true, 'star'), 'square-check-big');
 assert.equal(getCheckboxPropertyIcon(false, 'star'), 'square');
 assert.equal(getCheckboxPropertyIcon(null), 'square-dashed');
 assert.equal(isProjectedCustomFieldType(mapping), false);
});

test('Creator checkbox state icons override configured icons but preserve automatic warnings', () => {
 const field = { property: { interpretation: 'native', type: 'checkbox', sourceName: 'Watched' }, value: null as unknown, readOnlyReason: undefined as string | undefined };
 const context = { prepared: { field: () => field }, options: { settings: { keyMappings: [{ canonicalKey: 'watched', visiblePropertyName: 'Watched', type: 'checkbox', icon: 'star', isSystem: false, enabled: true }] } } };
 const resolve = () => (TaskCreatorModal.prototype as any).resolveFieldIcon.call(context, 'watched');
 assert.equal(resolve(), 'star');
 field.value = true; assert.equal(resolve(), 'square-check-big');
 field.value = false; assert.equal(resolve(), 'square');
 field.value = null; assert.equal(resolve(), 'star');
 field.readOnlyReason = 'automatic'; assert.equal(resolve(), 'shield-alert');
});


test('default chip profile shows six Creator tools and still reveals template fields', async () => {
 const f = fixture(yaml('contexts: [work]'));
 const ui = new PreparedTaskCreatorDraft(f.adapter, buildDefaultTaskChipSettings(structuredClone(DEFAULT_SETTINGS)));
 const expected = ['taskIcon', 'taskColor', 'taskType', 'priority', 'status', 'note'];
 for (const mode of ['file', 'inline'] as const) assert.deepEqual(ui.visibleKeys(mode).sort(), [...expected].sort());
 await ui.select(option(), 'Task');
 for (const mode of ['file', 'inline'] as const) assert.deepEqual(ui.visibleKeys(mode).sort(), [...expected, 'contexts'].sort());
});


for (const mode of ['inline', 'file'] as const) test(`mobile ${mode} Creator previews template fields and preserves edits before creation`, async () => {
 const previous = { isPhone: Platform.isPhone, isMobile: Platform.isMobile };
 Object.assign(Platform, { isPhone: true, isMobile: true });
 try {
  let commits = 0;
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.taskCreatorToolbar = [{ key: 'taskIcon', visible: true }];
  const modal = new TaskCreatorModal(new App(), {
   settings, allTasks: [], initialDraft: createEmptyTaskCreatorDraft(), initialCreateType: mode,
   defaultInlineTemplateId: 'A', defaultFileTemplateId: 'B', fileTaskTemplateOptions: [option('A'), option('B')],
   preparedAdapter: {
    properties: { keyMappings: settings.keyMappings, propertyTypes: { Client: 'text' } },
    readTemplate: async id => yaml(`taskIcon: ${id === 'A' ? 'star' : 'heart'}\ncontexts: [Home]\nClient: ${id}`),
    clock: () => ({ now: '2026-10-18T12:00:00' }), parent: () => null, candidates: () => [],
    onSubmit: () => { commits++; return true; },
   },
   onSubmitInline: () => { commits++; return true; }, onSubmitFile: () => { commits++; return true; },
  }) as any;
  const initial = mode === 'inline' ? 'A' : 'B';
  assert.equal(modal.getModeDefaultTemplateId(), initial);
  await modal.selectPreparedTemplateId(initial);
  assert.equal(modal.draft.taskIcon, initial === 'A' ? 'star' : 'heart');
  for (const key of ['taskIcon', 'contexts', 'Client']) {
   assert.ok(modal.getVisibleToolbarFieldOrder().includes(key));
   assert.equal(modal.hasValueForField(key), true);
  }
  modal.prepared.applyPayload({ contexts: ['User'] });
  await modal.selectPreparedTemplateId(initial === 'A' ? 'B' : 'A');
  assert.deepEqual(modal.prepared.field('contexts').value, ['User'], 'explicit picker replacement keeps the removed template member removed');
  await modal.selectPreparedTemplate(null);
  assert.equal(modal.draft.taskIcon, '');
  assert.ok(!modal.getVisibleToolbarFieldOrder().includes('Client'));
  assert.deepEqual(modal.prepared.field('contexts').value, ['User']);
  modal.prepared.close();
  assert.equal(commits, 0, 'preview, template replacement, clear and cancellation never create a task');
 } finally { Object.assign(Platform, previous); }
});
