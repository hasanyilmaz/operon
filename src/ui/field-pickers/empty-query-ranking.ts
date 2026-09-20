import type { IndexedTask } from '../../types/fields';
import { parseLocalTimestamp } from '../../core/local-time';

type Usage = { id: string; values: string[]; modified: number | null; created: number | null };
type DateField = 'modified' | 'created';
/** Keeps usage contributions separate from candidates so a task delta need not rescan sources. */
export class EmptyQueryRankIndex<T> {
 private counts = new Map<string, number>();
 private records = new Map<string, Usage>();
 private ordered: Record<DateField, Usage[]> = { modified: [], created: [] };
 constructor(tasks: readonly IndexedTask[], private getValues: (task: IndexedTask) => readonly string[], private getKey: (candidate: T) => string) {
  const seen = new Set<string>();
  for (const task of tasks) if (!seen.has(task.operonId)) { seen.add(task.operonId); const record = this.record(task); if (record.values.length) this.add(record); }
  for (const field of ['modified', 'created'] as const) this.ordered[field] = [...this.records.values()].filter(record => record[field] !== null).sort((a, b) => this.compare(a, b, field));
 }
 private record(task: IndexedTask): Usage {
  return { id: task.operonId, values: [...new Set(this.getValues(task).filter(Boolean))],
   modified: parseLocalTimestamp(task.datetimeModified || task.fieldValues.datetimeModified || ''), created: parseLocalTimestamp(task.fieldValues.datetimeCreated || '') };
 }
 private compare(a: Usage, b: Usage, field: DateField): number { return b[field]! - a[field]! || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); }
 private position(record: Usage, field: DateField): number {
  const ordered = this.ordered[field]; let low = 0, high = ordered.length;
  while (low < high) { const mid = (low + high) >>> 1; if (this.compare(ordered[mid], record, field) < 0) low = mid + 1; else high = mid; }
  return low;
 }
 private add(record: Usage): void { this.records.set(record.id, record); for (const value of record.values) this.counts.set(value, (this.counts.get(value) ?? 0) + 1); }
 update(id: string, task?: IndexedTask): void {
  const old = this.records.get(id);
  if (old) {
   for (const value of old.values) { const count = this.counts.get(value)! - 1; if (count) this.counts.set(value, count); else this.counts.delete(value); }
   for (const field of ['modified', 'created'] as const) if (old[field] !== null) this.ordered[field].splice(this.position(old, field), 1);
   this.records.delete(id);
  }
  if (task) { const record = this.record(task); if (!record.values.length) return; this.add(record); for (const field of ['modified', 'created'] as const) if (record[field] !== null) this.ordered[field].splice(this.position(record, field), 0, record); }
 }
 rank(candidates: readonly T[]): T[] {
  const positions = new Map(candidates.map((candidate, index) => [this.getKey(candidate), index]));
  const compare = (a: string, b: string) => (this.counts.get(b) ?? 0) - (this.counts.get(a) ?? 0) || positions.get(a)! - positions.get(b)!;
  const choose = (ordered: Usage[], excluded?: string): string | undefined => {
   for (const record of ordered) { const available = record.values.filter(value => positions.has(value) && value !== excluded); if (available.length) return available.sort(compare)[0]; }
   return undefined;
  };
  const created = choose(this.ordered.created), priorities = [created, choose(this.ordered.modified, created)].filter((value): value is string => value !== undefined);
  return [...candidates].sort((a, b) => {
   const left = this.getKey(a), right = this.getKey(b), li = priorities.indexOf(left), ri = priorities.indexOf(right);
   return li >= 0 || ri >= 0 ? (li < 0 ? priorities.length : li) - (ri < 0 ? priorities.length : ri) : compare(left, right);
  });
 }
}
/** Snapshot task usage once; ordinary pickers retain their existing immutable ranking function. */
export function createEmptyQueryRanker<T>(tasks: readonly IndexedTask[], getValues: (task: IndexedTask) => readonly string[], getKey: (candidate: T) => string): (candidates: readonly T[]) => T[] {
 const index = new EmptyQueryRankIndex(tasks, getValues, getKey);
 return candidates => index.rank(candidates);
}
