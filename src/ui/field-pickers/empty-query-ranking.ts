import type { IndexedTask } from '../../types/fields';
import { parseLocalTimestamp } from '../../core/local-time';

/** Snapshot task usage once; rank only the candidates still eligible in this picker. */
export function createEmptyQueryRanker<T>(
 tasks: readonly IndexedTask[],
 getValues: (task: IndexedTask) => readonly string[],
 getKey: (candidate: T) => string,
): (candidates: readonly T[]) => T[] {
 const counts = new Map<string, number>();
 const seen = new Set<string>();
 const records: Array<{ id: string; values: string[]; modified: number | null; created: number | null }> = [];
 for (const task of tasks) {
  if (seen.has(task.operonId)) continue;
  seen.add(task.operonId);
  const values = [...new Set(getValues(task).filter(Boolean))];
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  records.push({ id: task.operonId, values,
   modified: parseLocalTimestamp(task.datetimeModified || task.fieldValues['datetimeModified'] || ''),
   created: parseLocalTimestamp(task.fieldValues['datetimeCreated'] || ''),
  });
 }
 const byDate = (field: 'modified' | 'created') => records.filter(record => record[field] !== null)
  .sort((a, b) => (b[field]! - a[field]!) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
 const modified = byDate('modified');
 const created = byDate('created');
 return candidates => {
  const positions = new Map(candidates.map((candidate, index) => [getKey(candidate), index]));
  const compare = (a: string, b: string) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0)
   || positions.get(a)! - positions.get(b)!;
  const choose = (ordered: typeof records): string | undefined => {
   for (const record of ordered) {
    const available = record.values.filter(value => positions.has(value));
    if (available.length) return available.sort(compare)[0];
   }
   return undefined;
  };
  const priorities = [...new Set([choose(modified), choose(created)].filter((value): value is string => value !== undefined))];
  return [...candidates].sort((a, b) => {
   const left = getKey(a); const right = getKey(b);
   const li = priorities.indexOf(left); const ri = priorities.indexOf(right);
   if (li >= 0 || ri >= 0) return (li < 0 ? priorities.length : li) - (ri < 0 ? priorities.length : ri);
   return compare(left, right);
  });
 };
}
