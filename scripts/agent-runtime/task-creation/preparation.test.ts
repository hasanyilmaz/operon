import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SETTINGS } from '../../../src/types/settings';
import { buildTaskCreationPolicyV1 } from '../../../src/agent-runtime/extensions/task-creation-v1/policy';
import { prepareRoutedCreationDraftV1, selectRoutedCreationV1, type RoutedCreationDraftInputV1 } from '../../../src/agent-runtime/extensions/task-creation-v1/preparation';

function input(content: string | null = null): RoutedCreationDraftInputV1 {
 return { representation: 'inline', title: 'Review Q3', now: '2026-11-07T12:00:00', properties: { keyMappings: structuredClone(DEFAULT_SETTINGS.keyMappings), propertyTypes: { score: 'number', labels: 'multitext' } },
  template: content === null ? null : { id: 'template-one', content }, templateInputs: { title: 'Review Q3', taskDescription: 'Review Q3', note: '', status: '', priority: '', dateStarted: '', dateScheduled: '', dateDue: '' }, defaults: [], parent: [], surface: [], explicit: [] };
}
test('inline template compiles through shared Creator without copying its body',()=>{
 const request=input('---\nnote: Template note\nscore: 7\n---\nDO NOT COPY BODY');
 const before=structuredClone(request);const prepared=prepareRoutedCreationDraftV1(request);
 const output=prepared.compile({operonId:'abc1234',now:request.now});
 assert.equal(output.fieldValues.note,'Template note');assert.ok(!output.inlineLine.includes('DO NOT COPY BODY'));assert.ok(output.definitions.some(d=>d.sourceName==='score'));assert.deepEqual(request,before);
});
test('explicit values override template/parent/default values and retain shared list merging',()=>{
 const request=input('---\nnote: From template\ncontexts: [template]\n---\n');
 request.defaults=[{sourceName:'note',value:'Default'}];request.parent=[{sourceName:'note',value:'Parent'},{sourceName:'contexts',value:['parent']}];request.explicit=[{sourceName:'note',value:'Explicit'}];
 const output=prepareRoutedCreationDraftV1(request).compile({operonId:'abc1234',now:request.now});
 assert.equal(output.fieldValues.note,'Explicit');assert.ok(output.fieldValues.contexts.includes('parent'));assert.ok(output.fieldValues.contexts.includes('template'));
});
test('unknown/conflicting types block preparation while skipped fields are explained',()=>{
 const request=input('---\nscore: wrong number\n---\n');assert.throws(()=>prepareRoutedCreationDraftV1(request));
 const unsupported=input('---\naliases: [name]\nnote: "<% tp.date.now() %>"\n---\n');
 const output=prepareRoutedCreationDraftV1(unsupported).compile({operonId:'abc1234',now:unsupported.now});assert.ok(output.skipped.some(item=>item.sourceName==='aliases'));assert.ok(output.skipped.some(item=>item.reason==='templater'));
 unsupported.representation='file';assert.throws(()=>prepareRoutedCreationDraftV1(unsupported));
});
test('preparation revision binds template, property types and explicit inputs',()=>{
 const request=input('---\nscore: 7\n---\n');const first=prepareRoutedCreationDraftV1(request);
 assert.equal(first.revision,prepareRoutedCreationDraftV1(request).revision);
 request.template!.content='---\nscore: 8\n---\n';assert.notEqual(first.revision,prepareRoutedCreationDraftV1(request).revision);
});
test('configured unavailable periodic routes never silently fall back, and explicit targets remain exact',()=>{
 const settings=structuredClone(DEFAULT_SETTINGS);settings.inlineTaskSaveMode='daily-notes';
 const policy=buildTaskCreationPolicyV1(settings,[],{available:false,reason:'core-daily-notes-unavailable'},{available:false,reason:'operon-disabled'});
 assert.equal(selectRoutedCreationV1(policy,{mode:'configured-default',representation:'inline'},{mode:'none'}).ok,false);
 for(const mode of ['active-file','ask-every-time'] as const){policy.inline.configuredSaveMode=mode;assert.equal(selectRoutedCreationV1(policy,{mode:'configured-default',representation:'inline'},{mode:'none'}).ok,false);}
 const target={mode:'exact-path' as const,representation:'inline' as const,filePath:'Chosen.md',lineNumber:3};
 const result=selectRoutedCreationV1(policy,target,{mode:'none'});assert.ok(result.ok);if(result.ok)assert.deepEqual(result.target,target);
});
test('template selection respects representation defaults, explicit choice and none',()=>{
 const settings=structuredClone(DEFAULT_SETTINGS);settings.inlineTaskSaveMode='specific-file';settings.defaultInlineTaskTemplateId='inline-default';settings.taskCreatorDefaultFileTemplateId='file-default';
 const policy=buildTaskCreationPolicyV1(settings,[{id:'inline-default',kind:'folder',name:'Inline',path:'Templates/Inline.md'},{id:'file-default',kind:'folder',name:'File',path:'Templates/File.md'}],{available:false,reason:'core-daily-notes-unavailable'},{available:false,reason:'operon-disabled'});
 for(const representation of ['inline','file'] as const){const selected=selectRoutedCreationV1(policy,{mode:'configured-default',representation},{mode:'configured'});assert.ok(selected.ok);if(selected.ok)assert.equal(selected.templateId,`${representation}-default`);}
 assert.equal(selectRoutedCreationV1(policy,{mode:'configured-default'},{mode:'selected',templateId:'missing'}).ok,false);
});
