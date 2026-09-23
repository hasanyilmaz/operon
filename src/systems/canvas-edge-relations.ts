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

export type EdgeRelationIssue = 'missing' | 'duplicate' | 'reverse' | 'parent' | 'parent-cycle' | 'parent-missing' | 'dependency-cycle';
/** Read-only preflight; commit-time guards remain authoritative. */
export function edgeRelationIssue(
 from: string, to: string, kind: EdgeRelationKind,
 getTask: (id: string) => IndexedTaskSnapshot | null | undefined,
 duplicate: (id: string) => boolean,
 dependencyAllowed: (id: string, field: 'blocking' | 'blockedBy', before: string, after: string) => boolean,
): EdgeRelationIssue | null {
 const a = getTask(from), b = getTask(to);
 if (!a || !b) return 'missing';
 if (duplicate(from) || duplicate(to)) return 'duplicate';
 const removing = edgeRelationship(a, b, kind);
 if (edgeRelationship(b, a, kind)) return 'reverse';
 if (kind === 'parentTask') {
  if (removing) return null;
  if (b.fieldValues.parentTask?.trim()) return 'parent';
  const visited = new Set([to]); let id = from;
  while (id) {
   if (visited.has(id)) return 'parent-cycle';
   if (duplicate(id)) return 'duplicate';
   visited.add(id); const ancestor = getTask(id);
   if (!ancestor) return 'parent-missing';
   id = ancestor.fieldValues.parentTask?.trim() ?? '';
  }
  return null;
 }
 const inverseOnly = removing && !parseDependencyIdList(a.fieldValues.blocking).includes(to);
 const task = inverseOnly ? b : a, other = inverseOnly ? from : to;
 const field = inverseOnly ? 'blockedBy' : 'blocking';
 const before = task.fieldValues[field] ?? '';
 const after = [...new Set([...parseDependencyIdList(before).filter(id => id !== other), ...(removing ? [] : [other])])].join('; ');
 return dependencyAllowed(task.operonId, field, before, after) ? null : 'dependency-cycle';
}
