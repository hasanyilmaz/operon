import type { IndexedTask } from '../types/fields';
import { localToday } from '../core/local-time';
import { getTaskHappensTodayPriority, getTaskOverdueDate } from './task-search-box-integration';

export type StatusDockTaskScope = 'overdue' | 'today';
export type StatusDockTaskScopes = Record<StatusDockTaskScope, readonly IndexedTask[]>;

/** Task Finder membership, ordered nearest first (the UI places this end next to the dock). */
export function buildStatusDockTaskScopes(tasks: Iterable<IndexedTask>, now = new Date()): StatusDockTaskScopes {
 const today = localToday();
 const groups: Record<StatusDockTaskScope, { task: IndexedTask; distance: number }[]> = { overdue: [], today: [] };
 const seen = new Set<string>();
 for (const task of tasks) {
  if (task.checkbox !== 'open' || seen.has(task.operonId)) continue;
  seen.add(task.operonId);
  for (const scope of ['overdue', 'today'] as const) {
   if (scope === 'overdue' ? !getTaskOverdueDate(task) : !getTaskHappensTodayPriority(task)) continue;
   const dates = (scope === 'overdue' ? ['dateScheduled', 'dateDue'] : ['dateDue', 'dateScheduled', 'dateStarted'])
    .map(key => task.fieldValues[key]?.trim() ?? '')
    .filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date) && (scope === 'overdue' ? date < today : date === today));
   const start = task.fieldValues['datetimeStart']?.trim() ?? '';
   const distances = dates.map(date => {
    // Timed calendar tasks keep their actual time; date-only tasks represent the entire day.
    const time = start.startsWith(`${date}T`) ? Date.parse(start) : date === today ? now.getTime() : Date.parse(`${date}T23:59:59`);
    return Number.isFinite(time) ? Math.abs(now.getTime() - time) : Number.POSITIVE_INFINITY;
   });
   groups[scope].push({ task, distance: Math.min(...distances) });
  }
 }
 const sorted = (scope: StatusDockTaskScope) => groups[scope]
  .sort((a, b) => a.distance - b.distance || a.task.operonId.localeCompare(b.task.operonId))
  .map(entry => entry.task);
 return { overdue: sorted('overdue'), today: sorted('today') };
}
