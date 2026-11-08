import ts from 'typescript';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
/** Execute the actual Plugin methods against synthetic ports; never import/start Obsidian. */
export async function pluginHostFixture() {
 const source=await readFile('main.ts','utf8');
 const ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
 const declaration=ast.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text==='OperonPlugin');
 const names=['prepareRoutedRuntimeCreation','buildRoutedRuntimeCreationPlan','buildAgentRuntimeIdentityPlanCandidate','computeTaskWorkflowPlanHash','agentRuntimeIdentityJournalMatchesPlan','prepareAgentRuntimePeriodicCreation','applyAgentRuntimeIdentityCreation','agentRuntimeTaskWorkflowApplyFailure','taskWorkflowIdentityReceipt','agentRuntimeIdentityOutcomeUnknown','creationDefinitionJournalPorts','readAgentRuntimeIdentityGraphState','agentRuntimeIdentityGraphState','agentRuntimeIdentityGraphStatesMatch','verifyAgentRuntimeIdentityGraphSteps'];
 const methods=names.map(name=>{const method=declaration?.members.find(member=>member.name?.getText(ast)===name);if(!method)throw new Error(`Missing Plugin method ${name}`);return method.getText(ast);});
 const importEntries=[
  ['prepareRoutedCreationDraftV1,selectRoutedCreationV1','src/agent-runtime/extensions/task-creation-v1/preparation.ts'],
  ['createRoutedCreationMaterializerV1','src/agent-runtime/extensions/task-creation-v1/materializer.ts'],
  ['prepareCreationDefinitionStepV1','src/agent-runtime/extensions/task-creation-v1/definition-journal.ts'],
  ['resolveStatusValue,resolvePriorityValue,buildIdentityPlaceholderCreateEffectsV1','src/agent-runtime/runtime/task-creation-adapter.ts'],
  ['toLocalDatetime,localToday,localNow','src/core/local-time.ts'],
  ['prepareRuntimeTaskCreationV1,sourceRevisionForTaskCreationV1','src/agent-runtime/runtime/task-creation-adapter.ts'],
  ['resolvePeriodicNoteCreateRouteV1','src/agent-runtime/runtime/periodic-note-create-route.ts'],
  ['parseFrontmatterDocument','src/core/file-task-template-merge.ts'],
  ['normalizeInlineTaskHeadingKeyword','src/types/settings.ts'],
  ['resolveAutomationWorkflowStatus','src/types/pipeline.ts'],
  ['resolveCoreTemplateVariables','src/core/core-template-variables.ts'],
  ['canonicalJsonV1,sha256HexV1,toJsonValueV1,computeReceiptTargetDigestV1','src/agent-runtime/contracts/v1/canonical.ts'],
  ['compareResourceReferencesCanonicalV1','src/agent-runtime/contracts/v1/identity.ts'],
  ['boundRuntimeTransactionIdV1','src/agent-runtime/runtime/transaction-identifiers.ts'],
 ];
 const imports=importEntries.map(([names,file])=>`import {${names}} from ${JSON.stringify(path.resolve(file))};`).join('\n');
 const bound=new Set(importEntries.flatMap(([names])=>names.split(',')));for(const name of ['generateOperonId','getNativePropertyIndex','getActiveWindow'])bound.add(name);
 const text=methods.join('\n');
 const additional=ast.statements.filter(ts.isImportDeclaration).flatMap(declaration=>{
  const bindings=declaration.importClause?.namedBindings;if(!bindings||!ts.isNamedImports(bindings))return [];
  const names=bindings.elements.filter(spec=>!bound.has(spec.name.text)&&new RegExp('\\b'+spec.name.text+'\\b').test(text));
  if(!names.length)return [];
  const module=declaration.moduleSpecifier.text;
  return [`import ${declaration.importClause.isTypeOnly?'type ':''}{${names.map(spec=>spec.getText(ast)).join(',')}} from ${JSON.stringify(module.startsWith('.')?path.resolve(module):module)};`];
 }).join('\n');
 const contents=imports+'\n'+additional+`\nconst getActiveWindow=()=>({crypto:globalThis.crypto});let sequence=100;const generateOperonId=()=>('x'+String(++sequence).padStart(6,'0'));const getNativePropertyIndex=app=>app.native;export class Host {constructor(ports){Object.assign(this,ports);} ${methods.join('\n')} }`;
 return {name:'plugin-host-fixture',setup(build){build.onResolve({filter:/^operon-creation-plugin-host-fixture$/},()=>({path:'host',namespace:'creation-fixture'}));build.onLoad({filter:/.*/,namespace:'creation-fixture'},()=>({contents,loader:'ts',resolveDir:process.cwd()}));}};
}
