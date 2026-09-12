import { prepareFuzzySearch } from 'obsidian';
import { localToday } from '../core/local-time';
import type { IndexedTask } from '../types/fields';
import { buildTaskPoolSearchText } from './task-pool-search';

export type CanvasTaskPoolMode = 'overdue' | 'unscheduled' | 'all' | 'finished';
export const CANVAS_TASK_POOL_SEARCH_DELAY = 120;
export const canvasTaskPoolBatch = (query: string): number => query.trim() ? 50 : 25;

/** Canvas policy is deliberately independent of the selected Calendar date and preset. */
export function queryCanvasTaskPool(tasks: IndexedTask[], mode: CanvasTaskPoolMode, query: string, today = localToday()): IndexedTask[] {
 const date = (value: string | undefined): string => /^\d{4}-\d{2}-\d{2}$/.test(value?.trim() ?? '') ? value!.trim() : '';
 const modified = (task: IndexedTask): number => Date.parse(task.datetimeModified || task.fieldValues.datetimeModified || '') || 0;
 const candidates = tasks.filter(task => {
  if (mode === 'finished') return task.checkbox === 'done';
  if (task.checkbox !== 'open') return false;
  if (mode === 'all') return true;
  if (mode === 'unscheduled') return !task.fieldValues.dateScheduled?.trim();
  return [date(task.fieldValues.dateScheduled), date(task.fieldValues.dateDue)].some(value => value !== '' && value < today);
 }).map(task => ({ task, modified: modified(task), completed: date(task.fieldValues.dateCompleted) }))
  .sort((a, b) => (mode === 'finished' ? b.completed.localeCompare(a.completed) : 0) || b.modified - a.modified || a.task.operonId.localeCompare(b.task.operonId))
  .map(entry => entry.task);
 const needle = query.trim().toLowerCase();
 if (!needle) return candidates;
 const fuzzy = prepareFuzzySearch(query.trim());
 return candidates.map((task, index) => {
  const description = (task.description || '').toLowerCase();
  const tier = description.startsWith(needle) ? 0 : description.includes(needle) ? 1
   : [task.tags.join(' '), task.fieldValues.contexts, task.fieldValues.related, task.fieldValues.note].some(value => value?.toLowerCase().includes(needle)) ? 2 : 100;
  const direct = fuzzy(task.description || '');
  const global = direct ? null : fuzzy(buildTaskPoolSearchText(task));
  return { task, index, tier, direct: direct?.score ?? Infinity, global: global?.score ?? Infinity, matches: tier < 100 || !!direct || !!global };
 }).filter(entry => entry.matches).sort((a, b) => a.tier - b.tier || a.direct - b.direct || a.global - b.global || a.index - b.index).map(entry => entry.task);
}
