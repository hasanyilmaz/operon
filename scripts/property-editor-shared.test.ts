import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { PropertyEditorAdapter } from '../src/core/property-editor-adapter';
import { PropertyEditorDraft } from '../src/core/property-editor-draft';
import { readPropertyEditorDocument, planPropertyEditorWrite } from '../src/core/property-editor-document';
import { DEFAULT_SETTINGS, type KeyMapping } from '../src/types/settings';
import { applyFieldRules } from '../src/core/field-rules';
import { resolveReverseWorkflowFromTerminalDate, resolveWorkflowStatus } from '../src/types/pipeline';
import { parseRepeatRule } from '../src/core/repeat-rule';
import { deriveCountModeRepeatEndFromFieldValues, splitTaskListValue } from '../src/core/task-field-patch';
import { localToday } from '../src/core/local-time';

const mappings = DEFAULT_SETTINGS.keyMappings;
const name = (key: string) => mappings.find(item => item.canonicalKey === key)?.visiblePropertyName ?? key;
const document = (frontmatter: Record<string, unknown>) => ({ frontmatter, order: Object.keys(frontmatter) });
function adapter(frontmatter: Record<string, unknown>, extra: KeyMapping[] = [], types: Record<string, string> = {}) {
 return new PropertyEditorAdapter(document(frontmatter), [...mappings, ...extra], types);
}
function methods(path: string, names: string[]): string {
 const source = readFileSync(path, 'utf8'), ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
 const members = ast.statements.filter(ts.isClassDeclaration).flatMap(node => [...node.members]);
 return names.map(name => {
  const member = members.find(member => member.name?.getText(ast) === name); assert.ok(member, name);
  return member.getText(ast).replace(/^(private|protected) /u, '');
 }).join('\n');
}
// Execute the real shared rule methods and the real Property Editor commit boundary together.
const shared = methods('src/ui/editor-property-fields.ts', ['applyDraftFieldRules', 'applyStatusDraftChange', 'applyDateDraftChange', 'applyTerminalDateDraftChange', 'syncDerivedRepeatFieldsFromDraft', 'applyTaskFieldPickerPayload', 'commitWorkflowActionPayload']);
const host = methods('src/ui/native-property-editor.ts', ['markEdited', 'setFilePropertyValue', 'hydrate', 'hasDesktopPropertyRules', 'prepareRepeatIdentityPatch', 'destroy']);
const globals = { applyFieldRules, resolveReverseWorkflowFromTerminalDate, resolveWorkflowStatus, parseRepeatRule, deriveCountModeRepeatEndFromFieldValues,
 localToday, splitTaskListValue, REMINDER_RULE_ANCHORS: ['dateScheduled','dateDue','datetimeStart'], normalizeListValues: (values: string[]) => [...new Set(values)],
 cleanupOperonHoverTooltips: () => {}, Notice: class {}, t: (_group: string, key: string) => key,
};
// Add the exact helper imports needed by the host without importing the entire Obsidian UI graph.
import { readRawYamlPropertyExpectation, isEmptyFilePropertyValue } from '../src/core/raw-yaml-property';
Object.assign(globals, { readRawYamlPropertyExpectation, isEmptyFilePropertyValue });
const Host = new Function(...Object.keys(globals), ts.transpile(`class Host { ${shared}\n${host} }; return Host;`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(globals));
function fixture(frontmatter: Record<string, unknown>, types: Record<string, string> = {}) {
 const initial = document(frontmatter), draft = new PropertyEditorDraft(initial), editor = new Host();
 let scheduled = 0;
 Object.assign(editor, {
  draft, settings: DEFAULT_SETTINGS, submitted: new Set(), disposed: false, rendering: false, adding: null,
  fieldValues: {}, tags: [], checkbox: 'open', surfaces: new Map(), add: { focus() {} },
  makeAdapter: () => new PropertyEditorAdapter(draft.properties, mappings, types), field: (key: string) => editor.adapter.fields.get(key) ?? editor.adapter.resolve(key),
  refreshSchedulingDraftControls() {}, refreshMobileCoreButtons() {}, refreshWorkflowPickerSurfaceValues() {}, applyThemeColor() {}, render() {}, closePicker() {},
  scheduleEdited: () => scheduled++,
 });
 editor.hydrate(); return { editor, draft, initial, scheduled: () => scheduled };
}

test('Property adapter keeps YAML order, empty values, false, zero and mixed list member types', () => {
 const extras = [{canonicalKey:'custom:count',visiblePropertyName:'Count',type:'number',isSystem:false}, {canonicalKey:'custom:flag',visiblePropertyName:'Flag',type:'checkbox',isSystem:false}, {canonicalKey:'custom:list',visiblePropertyName:'Mixed',type:'list',isSystem:false}] as KeyMapping[];
 const source = { Count: 0, Flag: false, Mixed: ['02',2,'a; b','[[Note]]'], Empty: null };
 const a = adapter(source, extras, { Empty:'text' });
 assert.deepEqual(a.document.order, ['Count','Flag','Mixed','Empty']);
 assert.equal(a.values['custom:count'],'0'); assert.equal(a.values['custom:flag'],'false');
 assert.deepEqual(a.changes(a.values,a.tags),[]);
 const changes = a.changes({...a.values,'custom:list': '"02"; 3; "a; b"; [[Note]]'},a.tags);
 assert.deepEqual(changes, [{name:'Mixed',value:['02',3,'a; b','[[Note]]']}]);
});
test('Related is a mapped reference field even when internal; identity and task mutations remain unavailable', () => {
 const a = adapter({[name('related')]:['[[Twitter]]','[[Tesla]]'], [name('operonId')]:'secret', [name('activeTracker')]:'2026-11-10T10:00'});
 assert.equal(a.fields.get(name('related'))?.reason,undefined);
 assert.equal(a.fields.get(name('operonId'))?.reason,'unavailable');
 assert.equal(a.fields.get(name('activeTracker'))?.reason,'unavailable');
 assert.equal(a.changes({...a.values,operonId:'new'},[]),null);
});
test('one conflicting dependent field rejects the complete shared scheduling edit', () => {
 const f=fixture({[name('dateScheduled')]:'2026-11-10',[name('datetimeStart')]:'2026-11-10T10:00',[name('datetimeEnd')]:'2026-11-10T11:00'}, {[name('datetimeEnd')]:'number'});
 f.editor.commitWorkflowActionPayload({ dateScheduled:'2026-11-11' });
 assert.deepEqual(f.draft.snapshot(),[]); assert.equal(f.scheduled(),0);
});
test('Scheduled moves Start and End in the same draft while YAML names and order remain unchanged', () => {
 const source = {[name('datetimeEnd')]:'2026-11-10T11:00', X: false,[name('dateScheduled')]:'2026-11-10',[name('datetimeStart')]:'2026-11-10T10:00',[name('estimate')]:3600};
 const f=fixture(source); f.editor.commitWorkflowActionPayload({dateScheduled:'2026-11-11'});
 assert.equal(f.draft.properties.frontmatter[name('datetimeStart')],'2026-11-11T10:00:00');
 assert.equal(f.draft.properties.frontmatter[name('datetimeEnd')],'2026-11-11T11:00:00');
 assert.deepEqual(f.draft.properties.order,Object.keys(source)); assert.equal(f.scheduled(),1);
 assert.equal(f.draft.properties.frontmatter.X,false);
});
test('new direct field precedes dependent additions and Estimate remains a YAML number', () => {
 const f=fixture({[name('datetimeStart')]:'2026-11-10T10:00'}); f.editor.adding=name('estimate');
 f.editor.commitWorkflowActionPayload({estimate:'3600'});
 const keys=f.draft.properties.order;
 assert.ok(keys.indexOf(name('estimate')) < keys.indexOf(name('datetimeEnd')));
 assert.equal(f.draft.properties.frontmatter[name('estimate')],3600);
 assert.equal(f.draft.properties.frontmatter[name('datetimeEnd')],'2026-11-10T11:00:00');
});
test('Color and Icon use the common draft without automatic Updated or task identity', () => {
 const f=fixture({[name('taskColor')]:'#138F41',[name('datetimeModified')]:'2026-11-01T12:00'});
 f.editor.commitWorkflowActionPayload({taskColor:'abcdef',taskIcon:'star'});
 assert.equal(f.draft.properties.frontmatter[name('taskColor')],'#abcdef');
 assert.equal(f.draft.properties.frontmatter[name('taskIcon')],'star');
 assert.equal(f.draft.properties.frontmatter[name('datetimeModified')],'2026-11-01T12:00');
 assert.ok(!f.draft.properties.order.includes(name('operonId')));
});
test('Status and terminal dates apply the exact shared workflow resolution', () => {
 const pipeline=DEFAULT_SETTINGS.pipelines[0];
 const terminal=pipeline.statuses.find(item=>item.isFinished);
 assert.ok(terminal);
 const status=pipeline.name+'.'+terminal.label;
 const f=fixture({}); f.editor.adding=name('status'); f.editor.commitWorkflowActionPayload({status});
 assert.equal(f.draft.properties.frontmatter[name('status')],status);
 assert.equal(f.draft.properties.frontmatter[name('dateCompleted')],localToday());
 assert.equal(f.draft.properties.order[0],name('status'));
});
test('Repeat anchor and derived end survive unrelated edits and a fresh adapter, without a series ID', () => {
 const f=fixture({}); f.editor.adding=name('repeat');
 // Use the existing parser grammar rather than a new Property Editor rule.
 const rule='mode=count|freq=day|interval=1|count=3';
 assert.ok(parseRepeatRule(rule));
 f.editor.commitWorkflowActionPayload({repeat:rule,repeatOccurrenceDate:'2026-11-10'});
 assert.equal(f.draft.properties.frontmatter[name('repeatOccurrenceDate')],'2026-11-10');
 const end=f.draft.properties.frontmatter[name('datetimeRepeatEnd')]; assert.ok(end);
 const reopened=fixture(f.draft.properties.frontmatter);
 reopened.editor.commitWorkflowActionPayload({taskType:'Note'});
 assert.equal(reopened.draft.properties.frontmatter[name('datetimeRepeatEnd')],end);
 assert.ok(!reopened.draft.properties.order.includes(name('repeatSeriesId')));
});
test('an untouched Add Property picker is zero-write; confirming false adds a typed property', () => {
 const f=fixture({}, {Flag:'checkbox'}); f.editor.adding='Flag';
 assert.deepEqual(f.draft.snapshot(),[]);assert.equal(f.scheduled(),0);
 f.editor.setFilePropertyValue('Flag',false);
 assert.deepEqual(f.draft.properties.order,['Flag']);assert.equal(f.draft.properties.frontmatter.Flag,false);
});
test('a late field commit retains the picker baseline after source refresh and conflicts instead of overwriting', () => {
 const f=fixture({[name('taskColor')]:'#111111'});
 f.draft.refresh(document({[name('taskColor')]:'#222222'}));
 f.editor.fieldValues.taskColor='333333';f.editor.markEdited();
 const result=planPropertyEditorWrite(`---\n${name('taskColor')}: '#222222'\n---\nBody`,mappings,f.draft.snapshot());
 assert.equal(result.status,'conflict');assert.equal(f.draft.edited,true);
});
test('safe writer receives all dependent fields together and preserves comments and body', () => {
 const source=`---\n${name('datetimeStart')}: 2026-11-10T10:00 # start\n---\n# Body\n`;
 const doc=readPropertyEditorDocument(source,mappings)!; const f=fixture(doc.frontmatter);
 f.editor.adding=name('estimate');f.editor.commitWorkflowActionPayload({estimate:'120'});
 const result=planPropertyEditorWrite(source,mappings,f.draft.snapshot());
 assert.equal(result.status,'ready');if(result.status==='ready') { assert.ok(result.text.includes('# start'));assert.ok(result.text.endsWith('# Body\n'));assert.equal(result.properties.frontmatter[name('estimate')],120); }
});

test('closing a Property Editor releases listeners and preserves its reusable modal-content host', () => {
 const f=fixture({}), removed: [string, unknown, boolean | undefined][]=[];
 const focus=()=>{}, click=()=>{};
 let emptied=false, disconnected=false;
 Object.assign(f.editor, {
  sourceFocusout:focus, clearAddingOnRowClick:click,
  interactionObserver:{disconnect(){disconnected=true;}}, cancelTimer(){}, noteCompactEditor:null,
  root:{
   removeEventListener(type:string, callback:unknown, capture?:boolean){removed.push([type,callback,capture]);},
   closest(){return null;},empty(){emptied=true;},removeClass(){},removeAttribute(){},style:{removeProperty(){}},
  },
 });
 f.editor.destroy();
 assert.equal(disconnected,true);assert.equal(emptied,true);assert.equal(f.editor.disposed,true);
 assert.deepEqual(removed,[['focusout',focus,undefined],['click',click,true]]);
});
