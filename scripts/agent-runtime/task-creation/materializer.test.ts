import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SETTINGS } from '../../../src/types/settings';
import { createRoutedCreationMaterializerV1 } from '../../../src/agent-runtime/extensions/task-creation-v1/materializer';
import { prepareCanonicalTaskCreation, type CanonicalTaskCreationItem } from '../../../src/core/task-creation-domain';

const now='2026-11-07T12:00:00';
function fixture(content:string) {
 const settings=structuredClone(DEFAULT_SETTINGS);
 const material=createRoutedCreationMaterializerV1({properties:{keyMappings:settings.keyMappings,propertyTypes:{score:'number',ref:'text'}},template:{id:'test',content},templateInputs:{title:'Review Q3',taskDescription:'Review Q3',note:'',status:'',priority:'',dateStarted:'',dateScheduled:'',dateDue:''},explicitFields:[{kind:'text',field:'note',value:'Explicit'}],explicitStatus:false,explicitPriority:false,explicitTags:false,nativeProperties:[],displayTitleEnabled:false,generateId:()=> 'n000002',existingIds:new Set()});
 const item:CanonicalTaskCreationItem={itemKey:'one',description:'Review Q3',fields:{note:'Explicit'},target:{representation:'inline',source:{filePath:'Tasks.md',content:'# Tasks\n',revision:'before'},placement:{kind:'append'},allowCreateFile:false}};
 const prepare=()=>prepareCanonicalTaskCreation({requestId:'test',items:[item]},{settings,now,existingOperonIds:new Set(),existingTasks:new Map(),generateOperonId:()=> 'n000001',allowedFieldKeys:['note'],prepareMaterial:material.prepareMaterial});
 return {material,prepare,item};
}
test('canonical placement uses shared native serialization and preserves explicit managed values',()=>{
 const f=fixture('---\nnote: Template\nscore: 7\n---\nNever copy this');
 const result=f.prepare();assert.ok(result.ok);if(!result.ok)return;
 assert.equal(result.plan.tasks[0].fieldValues.note,'Explicit');assert.ok(result.plan.sourceGroups[0].resultingContent.startsWith('# Tasks\n'));
 assert.match(result.plan.sourceGroups[0].resultingContent,/score::/u);assert.ok(!result.plan.sourceGroups[0].resultingContent.includes('Never copy this'));
 assert.equal(f.material.evidence().definitions[0].sourceName,'score');assert.deepEqual(f.prepare(),result);
});
test('shared template material cannot silently introduce graph relationships',()=>{
 const f=fixture('---\nparentTask: n000003\nrelated: n000004\n---\n');const result=f.prepare();assert.ok(result.ok);if(!result.ok)return;
 assert.equal(result.plan.tasks[0].parentOperonId,undefined);assert.equal(result.plan.tasks[0].fieldValues.parentTask,undefined);
});
test('native template type mismatch stops canonical planning before source groups are produced',()=>{
 const f=fixture('---\nscore: invalid\n---\n');assert.throws(()=>f.prepare());
});

test('File native references and body share one placeholder allocation authority',()=>{
 const f=fixture('---\noperonId: "{{operonId}}"\nscore: 7\nref: "{{operonIdA}}"\n---\n- [ ] Child {{operonId:: {{operonIdA}} }}');
 f.item.target={representation:'file',source:{filePath:'Review Q3.md',content:null,revision:'absent'},identityPlaceholderPolicy:'resolve-operon-id-v1'};
 const result=f.prepare();assert.ok(result.ok);if(!result.ok)return;
 const content=result.plan.sourceGroups[0].resultingContent;
 assert.match(content,/operonId:: n000002/u);assert.deepEqual(f.prepare(),result);
 assert.equal(result.plan.tasks[0].templateIdentityAllocations?.filter(a=>a.suffix==='A').every(a=>a.operonId==='n000002'),true);
});

test('File template graph fields cannot bypass explicit relationship planning',()=>{
 const f=fixture('---\nparentTask: n000003\nrelated: n000004\nblocking: n000005\n---\nBody');
 f.item.target={representation:'file',source:{filePath:'Review Q3.md',content:null,revision:'absent'},identityPlaceholderPolicy:'resolve-operon-id-v1'};
 const result=f.prepare();assert.ok(result.ok);if(!result.ok)return;
 const content=result.plan.sourceGroups[0].resultingContent;
 assert.ok(!content.includes('n000003')&&!content.includes('n000004')&&!content.includes('n000005'),content);
});
