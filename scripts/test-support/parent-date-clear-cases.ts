import assert from 'node:assert/strict';
import { AggregateCoordinator } from '../../src/systems/aggregate-coordinator';
import type { IndexedTask } from '../../src/types/fields';
import type { OperonIndexer } from '../../src/indexer/indexer';
import type { TaskWriter } from '../../src/core/task-writer';
export const parentDateClearCases: Array<{ name: string; run: () => Promise<void> }> = [];
async function scenario(enabled: boolean, hasChild: boolean, format: 'yaml'|'inline', checkbox: 'open'|'done'|'cancelled', cleared: string[], laterChildMutation = false) {
 const before: IndexedTask = {operonId:'parent',description:'Synthetic parent',checkbox,fieldValues:{status:'In Progress',dateStarted:'2026-09-01',dateDue:'2026-09-30'},tags:[],primary:{filePath:'Parent.md',format,lineNumber:0},datetimeModified:'',tier:'hot'};
 const parent = structuredClone(before);
 for (const key of cleared) parent.fieldValues[key] = '';
 const child: IndexedTask = { ...structuredClone(before),operonId:'child',description:'Synthetic child',checkbox:'open',fieldValues:{parentTask:'parent',dateStarted:'2026-09-10',dateDue:'2026-09-20'},primary:{filePath:'Child.md',format,lineNumber:0} };
 const tasks = new Map((hasChild ? [parent,child] : [parent]).map(t=>[t.operonId,t]));
 const children = (id:string) => id==='parent' && hasChild ? new Set(['child']) : new Set<string>();
 const writes: unknown[]=[];
 const indexer = {getAllTasks:()=>[...tasks.values()],getTask:(id:string)=>tasks.get(id),secondary:{getChildIds:children,getAllDescendantIds:children},commitAggregateFieldPatches:async()=>true,reindexFilesBatch:async()=>undefined} as unknown as OperonIndexer;
 const writer = {writeTaskFields:async(id:string,payload:Record<string,string>)=>{writes.push({id,payload});Object.assign(tasks.get(id)!.fieldValues,payload);return true;}} as unknown as TaskWriter;
 const coordinator = new AggregateCoordinator(indexer,writer,()=>enabled);
 if (laterChildMutation) await coordinator.refreshAfterTaskMutation(child,{...child,description:'Changed child'});
 else await coordinator.refreshAfterTaskMutation(before,parent);
 for (const key of cleared) assert.equal(parent.fieldValues[key], '', 'Explicitly cleared parent boundary was restored');
 await new AggregateCoordinator(indexer,writer,()=>enabled).refreshAllParents();
 for (const key of cleared) assert.equal(parent.fieldValues[key], '', 'Reconciliation restored an empty boundary');
 for (const write of writes as Array<{payload: Record<string,string>}>) {
  for (const key of cleared) assert.equal(write.payload[key], undefined, 'An aggregate write included an empty boundary');
 }

}
for(const enabled of [false,true]) for(const hasChild of [false,true]) for(const format of ['yaml','inline'] as const) for(const checkbox of ['open','done','cancelled'] as const) for(const keys of [['dateStarted'],['dateDue'],['dateStarted','dateDue']]) {
 parentDateClearCases.push({ name: `Parent clear survives refresh: ${enabled}/${hasChild}/${format}/${checkbox}/${keys.join('+')}`, run: async()=>scenario(enabled,hasChild,format,checkbox,keys) });
}
parentDateClearCases.push({name:'Cleared parent boundaries survive later child mutation and fresh reconciliation',run:async()=>scenario(true,true,'yaml','open',['dateStarted','dateDue'],true)});
