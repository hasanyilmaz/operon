import { parseDependencyIdList } from '../core/dependency-graph';
import type { IndexedTaskSnapshot } from '../indexer/indexer';

export type EdgeRelationKind = 'parentTask' | 'blocking';
export function edgeRelationship(a: IndexedTaskSnapshot, b: IndexedTaskSnapshot, kind: EdgeRelationKind): boolean {
 return kind === 'parentTask' ? (b.fieldValues.parentTask ?? '').trim() === a.operonId
  : parseDependencyIdList(a.fieldValues.blocking).includes(b.operonId) || parseDependencyIdList(b.fieldValues.blockedBy).includes(a.operonId);
}
export function edgeRelationSnapshot(a: IndexedTaskSnapshot, b: IndexedTaskSnapshot): string {
 return JSON.stringify([a, b].map(task => [task.operonId, task.primary.filePath, ...['parentTask', 'blocking', 'blockedBy'].map(key => task.fieldValues[key] ?? '')]));
}
export function edgeRelationDirection(fromEnd: string | undefined, toEnd: string | undefined): 'forward' | 'reverse' | null {
 const from = fromEnd === 'arrow', to = toEnd === 'arrow';
 return from === to ? null : from ? 'reverse' : 'forward';
}
