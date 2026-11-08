declare module 'operon-creation-plugin-host-fixture' {
 export class Host {
  agentRuntimeIdentityJournalMatchesPlan(journal:unknown,plan:unknown,vaultIdentityHash:string):boolean;
  applyAgentRuntimeIdentityCreation(request:unknown,execution:unknown):Promise<import('../../../src/agent-runtime/extensions/task-creation-v1/contracts').RoutedTaskCreationMutationResultV1>;
  constructor(ports:Record<string,unknown>);
  prepareRoutedRuntimeCreation(request:import('../../../src/agent-runtime/extensions/task-creation-v1/contracts').RoutedTaskCreationPreviewRequestV1,createdAt:string,sealed?:import('../../../src/agent-runtime/extensions/task-creation-v1/contracts').ExecutableRoutedCreationPlanV1):Promise<{preparation:Extract<import('../../../src/agent-runtime/runtime/task-creation-adapter').RuntimeTaskCreationPreparationV1,{ok:true}>;steps:import('../../../src/agent-runtime/runtime/receipts/graph-transaction-journal').GraphTransactionJournalStepV1[];creation:import('../../../src/agent-runtime/extensions/task-creation-v1/contracts').RoutedCreationEvidenceV1;policyRevision:string}>;
  buildRoutedRuntimeCreationPlan(request:unknown,prepared:unknown,revision:unknown,createdAt:string,planId:string):import('../../../src/agent-runtime/extensions/task-creation-v1/contracts').ExecutableRoutedCreationPlanV1;
 }
}
