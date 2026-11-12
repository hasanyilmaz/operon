import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const paths = ['src/ui/task-editor-content.ts', 'src/ui/editor-property-fields.ts'];
const methods = new Map();
for (const path of paths) {
 const url = new URL(`../${path}`, import.meta.url);
 if (!existsSync(url)) continue;
 const source = ts.createSourceFile(path, readFileSync(url, 'utf8'), ts.ScriptTarget.Latest, true);
 for (const statement of source.statements) if (ts.isClassDeclaration(statement)) {
  for (const member of statement.members) if (ts.isMethodDeclaration(member) && member.body) {
   const name = member.name.getText(source);
   assert.ok(!methods.has(name), `Only one implementation of ${name}`);
   methods.set(name, member.getText(source).replace(/^(private|protected) /u, ''));
  }
 }
}
function subject(names, globals = {}) {
 const source = `class Subject { ${names.map(name => { assert.ok(methods.has(name), name); return methods.get(name); }).join('\n')} }; return new Subject();`;
 const js = ts.transpile(source, { target: ts.ScriptTarget.ES2022 });
 return new Function(...Object.keys(globals), js)(...Object.values(globals));
}
for (const [value, expected] of [['138F41', '#138F41'], ['#138F41', '#138F41'], ['invalid', 'var(--interactive-accent)'], ['', 'var(--interactive-accent)']]) {
 test(`Editor accent uses configured color: ${value || 'empty'}`, () => {
  const editor = subject(['getThemeColor', 'applyThemeColor']);
  editor.fieldValues = { taskColor: value };
  const assigned = [];
  for (const name of ['rootEl', 'shellEl', 'mainPanelEl']) editor[name] = {style: {setProperty: (key, color) => assigned.push([key, color])}};
  editor.applyThemeColor();
  assert.deepEqual(assigned, Array.from({length:3}, () => ['--operon-task-editor-accent', expected]));
 });
}
for (const [value, expected] of [['[[Folder/Note|Label]]', 'Label'], ['[[Note]]', 'Note'], [' plain ', 'plain']]) {
 test(`Reference label preserves display semantics: ${value}`, () => {
  assert.equal(subject(['formatInlineReferenceLabel']).formatInlineReferenceLabel(value), expected);
 });
}
test('Notes preserve the shared multiline editor, source context and user edit boundary', () => {
 let options; let destroyed = 0; let edited = 0;
 const host = {createDiv: () => host, addClass() {}};
 const editor = subject(['renderNote'], {Setting: class { constructor(){this.controlEl=host;this.settingEl=host;}setName(){return this;}}, t: (_s,key)=>key, createCompactMarkdownEditorSurface: (_host,opts)=>{options=opts;return {};}});
 Object.assign(editor, {fieldValues:{note:'previous'}, noteCompactEditor:{destroy(){destroyed++;}}, getCompactTextSourcePath:()=> 'Note.md', markEdited:()=>edited++});
 editor.renderNote(host, false);
 assert.equal(destroyed,1); assert.equal(options.sourcePath,'Note.md'); assert.equal(options.textPolicy,'task-note');
 options.onUserChange({persistableValue:'first\nsecond'});
 assert.equal(editor.fieldValues.note,'first\nsecond'); assert.equal(edited,1);
 options.onUserChange({persistableValue:'first\nsecond'}); assert.equal(edited,1);
 options.onUserChange({persistableValue:''}); assert.equal(editor.fieldValues.note,undefined); assert.equal(edited,2);
});
test('Related is a dedicated reference picker with per-item chip removal', () => {
 const method = methods.get('renderRelatedPicker');
 assert.match(method, /showRelatedPicker/); assert.match(method, /formatInlineReferenceLabel/);
 assert.match(method, /operon-editor-compact-selection-chip-remove/);
});
test('Field renderers retain specialized selection paths', () => {
 for (const [name, picker] of [['renderContextsPicker','showContextsPicker'],['renderLinksPicker','showLinksPicker'],['renderAssigneesPicker','showAssigneesPicker'],['renderLocationPicker','showLocationPicker'],['renderIconControl','showIconPicker'],['renderColorControl','showColorPicker'],['renderStatusControl','showStatusPicker'],['renderPriorityControl','showPriorityPicker']]) assert.ok(methods.get(name).includes(picker), name);
 assert.match(methods.get('renderManagedTaskDataWorkflowPicker'), /openTaskFieldPicker/);
 assert.match(methods.get('renderCustomWorkflowPicker'), /openTaskFieldPicker/);
});

// Execute the real rule engine with fixed inputs rather than duplicating its logic.
async function moduleFrom(path) {
 const {build} = await import('esbuild');
 const result = await build({entryPoints:[new URL(`../${path}`,import.meta.url).pathname], bundle:true, write:false, format:'esm', platform:'node',logLevel:'silent'});
 return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const {applyFieldRules} = await moduleFrom('src/core/field-rules.ts');
const {resolveWorkflowStatus, resolveReverseWorkflowFromTerminalDate} = await moduleFrom('src/types/pipeline.ts');
function ruleEditor(values = {}) {
 const editor = subject(['applyDraftFieldRules','applyTaskFieldPickerPayload','applyStatusDraftChange','applyTerminalDateDraftChange','applyDateDraftChange'], {
  applyFieldRules, resolveWorkflowStatus, resolveReverseWorkflowFromTerminalDate,
  REMINDER_RULE_ANCHORS:['dateScheduled','datetimeStart','datetimeEnd','dateDue','dateStarted'],
  localToday:()=> '2026-11-10', Notice:class {}, t:(_s,key)=>key,
 });
 const states = [['Open',false,false],['Done',true,false],['Cancelled',false,true]];
 Object.assign(editor,{fieldValues:{...values},checkbox:'open',settings:{defaultPipelineName:'Task',pipelines:[{name:'Task', statuses:states.map(([label,isFinished,isCancelled])=>({id:label,label,isFinished,isCancelled,isScheduledTarget:false,isTrackingTarget:false,color:'#000000'}))}]}});
 for(const hook of ['syncDerivedRepeatFieldsFromDraft','refreshSchedulingDraftControls','refreshMobileCoreButtons','refreshWorkflowPickerSurfaceValues']) editor[hook]=()=>{};
 return editor;
}
test('Scheduled moves start and end while preserving their times', () => {
 const e=ruleEditor({dateScheduled:'2026-11-10',datetimeStart:'2026-11-10T09:00:00',datetimeEnd:'2026-11-10T10:00:00',estimate:'3600'});
 e.applyDateDraftChange('dateScheduled','2026-11-12');
 assert.equal(e.fieldValues.datetimeStart,'2026-11-12T09:00:00');assert.equal(e.fieldValues.datetimeEnd,'2026-11-12T10:00:00');
});
test('Estimate derives end; clearing start clears end',()=>{
 const e=ruleEditor({datetimeStart:'2026-11-10T09:00:00'});
 e.applyDraftFieldRules({estimate:'5400'},['estimate']); assert.equal(e.fieldValues.datetimeEnd,'2026-11-10T10:30:00');
 e.applyDraftFieldRules({datetimeStart:''},['datetimeStart']); assert.equal(e.fieldValues.datetimeEnd,undefined);
});
test('Status and terminal dates share their reverse rule without assigning identity',()=>{
 const e=ruleEditor({status:'Task.Open'});
 assert.equal(e.applyStatusDraftChange('Task.Done'),true);assert.equal(e.fieldValues.dateCompleted,'2026-11-10');assert.equal(e.checkbox,'done');
 assert.equal(e.applyTerminalDateDraftChange('dateCancelled','2026-11-09'),true);assert.equal(e.fieldValues.dateCompleted,undefined);assert.equal(e.fieldValues.status,'Task.Cancelled');
 assert.equal(e.fieldValues.operonId,undefined);assert.equal(e.fieldValues.datetimeModified,undefined);
});
test('Invalid status leaves the draft and checkbox unchanged',()=>{
 const e=ruleEditor({status:'Task.Open',dateDue:'2026-12-01'});const before={...e.fieldValues};
 assert.equal(e.applyStatusDraftChange('Unknown.Unknown'),false);assert.deepEqual(e.fieldValues,before);assert.equal(e.checkbox,'open');
});
class Element {
 constructor(){this.children=[];this.classes=new Set();this.handlers={};this.style={setProperty:(key,value)=>{this[key]=value;}};this.dataset={};this.classList={toggle:(c,on)=>this.toggleClass(c,on)};}
 createEl(tag,options={}){const child=new Element();child.tag=tag;child.textContent=options.text??'';child.options=options;child.parentElement=this;this.children.push(child);return child;}
 createSpan(options){return this.createEl('span',typeof options==='object'?options:{cls:options});}
 createDiv(options){return this.createEl('div',typeof options==='object'?options:{cls:options});}
 empty(){this.children=[];}setText(text){this.textContent=text;} addClass(...c){c.forEach(x=>this.classes.add(x));}removeClass(c){this.classes.delete(c);}hasClass(c){return this.classes.has(c);}toggleClass(c,on){on?this.classes.add(c):this.classes.delete(c);}addEventListener(name,cb){this.handlers[name]=cb;}appendChild(el){this.children.push(el);}setAttribute(){}
}
test('Color picker changes accent immediately and clear restores theme accent',()=>{
 let picker;let edits=0;const container=new Element();
 const e=subject(['renderColorControl','getThemeColor','applyThemeColor','appendCanonicalIcon','getCoreFieldIcon'],{t:(_s,key)=>key,setIcon:()=>{},setAccessibleLabelWithoutTooltip:()=>{},showColorPicker:(_anchor,opts)=>picker=opts,getConfiguredKeyMappingIcon:()=> 'palette'});
 Object.assign(e,{fieldValues:{taskColor:'138F41'},settings:{colorPalette:[],keyMappings:[]},createInlineField:()=>container,rootEl:container,shellEl:container,mainPanelEl:container,usesMobileLayout:false,registerSchedulingDraftRefresher:()=>{},markEdited:()=>edits++});
 e.renderColorControl(container);
 const nodes=[];function visit(n){nodes.push(n);n.children.forEach(visit)}visit(container);const swatch=nodes.find(n=>n.handlers.click);swatch.handlers.click();
 picker.onSelect('112233');assert.equal(e.fieldValues.taskColor,'112233');assert.equal(container['--operon-task-editor-accent'],'#112233');assert.equal(edits,1);
 picker.onClear();assert.equal(e.fieldValues.taskColor,undefined);assert.equal(container['--operon-task-editor-accent'],'var(--interactive-accent)');assert.equal(edits,2);
});

const {encodeVaultPropertyValue} = await moduleFrom('src/core/vault-property-codec.ts');
const {isEmptyFilePropertyValue} = await moduleFrom('src/core/raw-yaml-property.ts');
test('Native field eligibility preserves false, zero and typed list items; rejects conflicting values',()=>{
 const e=subject(['canEditFileProperty'], {isEmptyFilePropertyValue,encodeVaultPropertyValue});
 e.filePropertyUnavailable=false;
 for(const [type,value] of [['checkbox',false],['number',0],['list',['02',2,'[[Note]]']],['text',''],['date',null]]) {
  assert.equal(e.canEditFileProperty({field:{type},value,baseline:{present:true,value}}),true,`${type}: ${JSON.stringify(value)}`);
 }
 assert.equal(e.canEditFileProperty({field:{type:'number'},value:'not a number',baseline:{present:true}}),false);
 assert.equal(e.canEditFileProperty({field:{type:'text'},value:'x',baseline:{present:true},readonly:true}),false);
});
function nativePickerFixture() {
 let options;const mutations=[];let focused=0;
 const action=new Element();const row=new Element();row.querySelectorAll=()=>[];row.hidden=false;
 const anchor=new Element();anchor.isConnected=true;anchor.focus=()=>focused++;
 const entry={field:{type:'list'},value:['02',2,'[[Note]]'],baseline:{present:true}};
 const e=subject(['openFilePropertyPicker', 'getFilePropertyPickerOwner', 'confirmNewFileProperty'], {isEmptyFilePropertyValue,collectNativeFieldValueCandidates:()=>[],openTableFilePropertyPicker: opts=>{options=opts;return ()=>opts.onClose();}});
 Object.assign(e,{fileProperties:new Map([['Related',entry]]),filePropertyRows:new Map([['Related',{row,action,value:anchor}]]),canEditFileProperty:()=>true,propertyInteractionEpoch:0,indexer:{getAllTasks:()=>[]},settings:{keyMappings:[]},fileBodyContext:{filePath:'Note.md'},setFilePropertyValue:(...v)=>mutations.push(v),refreshFilePropertyValue:()=>{},refreshDesktopFileProperties:async()=>{},disposed:false});
 e.openFilePropertyPicker('Related','02','popover',anchor,0);
 return {e,entry,options,mutations,focused:()=>focused};
}
test('Native item edit uses the same typed picker and source context without coercing other items',()=>{
 const f=nativePickerFixture();
 assert.deepEqual(f.options.cellValue.rawValue,['02',2,'[[Note]]']);assert.equal(f.options.editListIndex,0);
 assert.equal(f.options.preserveListValues,true);assert.equal(f.options.nativeList,true);assert.equal(f.options.sourcePath,'Note.md');
 f.options.onMutation({kind:'set',value:['03',2,'[[Note]]']});
 assert.deepEqual(f.mutations,[['Related',['03',2,'[[Note]]']]]);
});
test('Native picker close/cancel produces no mutation and restores focus',()=>{
 const f=nativePickerFixture();f.e.closeFilePropertyPicker();
 assert.deepEqual(f.mutations,[]);assert.equal(f.focused(),1);assert.equal(f.e.closeFilePropertyPicker,null);
});
test('Content notification follows refreshed fields and ignores disposed editors',()=>{
 const order=[];const e=subject(['markEdited','notifyPropertyContentChanged']);
 Object.assign(e,{disposed:false,editVersion:0,desktopPropertyRows:new Map([['color',{}]]),refreshDesktopPropertyRows:()=>order.push('refresh'),onPropertyContentChanged:()=>order.push('notify'),scheduleSave:()=>order.push('save')});
 e.markEdited();assert.deepEqual(order,['refresh','notify','save']);
 order.length=0;e.disposed=true;e.markEdited();assert.deepEqual(order,[]);
});
test('Shared fields do not own task identity, persistence, automation or section layout',()=>{
 const source=readFileSync(new URL('../src/ui/editor-property-fields.ts',import.meta.url),'utf8');
 assert.doesNotMatch(source,/generateOperonId\(|persistEditorState\(|scheduleSave\(|maybeApplyScheduledAutomationToEditorState\(|TASK_EDITOR_DESKTOP_GROUPS|desktopSectionLabel\(/);
 assert.match(source,/this\.ensureRepeatSeriesIdentity\(\)/);
 assert.match(source,/this\.prepareRepeatIdentityPatch\(remaining\)/);
});

test('typed native list rendering preserves chip boundaries, item index and removal types', () => {
 const element=()=>{const e=new Element();e.querySelector=()=>null;e.replaceChildren=()=>e.empty();e.setAttr=()=>{};e.focus=()=>{};e.ownerDocument={win:{createEl:element}};return e;};
 const value=element(),action=element(),row=element();const opened=[],changed=[];
 const entry={field:{key:'Custom',type:'list',icon:'list'},value:['02',2,'a; b'],baseline:{present:true,value:['02',2,'a; b']}};
 const e=subject(['refreshFilePropertyValue','renderCustomFieldSelection','formatCustomFieldDisplayValue','canEditFileProperty'],{
  isEmptyFilePropertyValue,encodeVaultPropertyValue,setIcon:()=>{},cleanupOperonHoverTooltips:()=>{},setAccessibleLabelWithoutTooltip:()=>{},t:()=>'',
  normalizeCustomFieldRawValue:v=>v??'',getCustomFieldIcon:()=> 'list',
  splitTaskListValue:()=>{throw Error('Typed YAML members must not be split as legacy strings');},
  createInlineTaskCompactChipElement:options=>{const chip=element();chip.textContent=options.label;return chip;},
 });
 Object.assign(e,{fieldValues:{Custom:'"02"; 2; "a; b"'},fileProperties:new Map([['Custom',entry]]),filePropertyRows:new Map([['Custom',{row,action,value}]]),
  syncFilePropertyRowVisibility:()=>{},bindEditorHoverTooltip:()=>{},bindTruncatedTextTooltip:()=>{},
  setFilePropertyValue:(name,next)=>changed.push({name,next}),openFilePropertyPicker:(...args)=>opened.push(args)});
 e.refreshFilePropertyValue('Custom');
 assert.deepEqual(value.children.map(chip=>chip.textContent),['"02"','2','"a; b"']);
 const second=value.children[1];second.handlers.click({target:{closest:()=>null}});
 assert.equal(opened[0][0],'Custom');assert.equal(opened[0][4],1);
 second.children[0].handlers.click();assert.deepEqual(changed,[{name:'Custom',next:['02','a; b']}]);
});
