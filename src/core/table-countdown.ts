import type { IndexedTask } from '../types/fields';
import type { TableCountdownTarget } from '../types/table';
import { validUpcomingTimestamp } from './upcoming-task-query';
import { toLocalDate } from './local-time';

export interface TableCountdownDate {
 timestamp: number;
 date: string;
 timed: boolean;
 source: 'scheduled' | 'due' | 'both';
}

export function resolveTableCountdownDate(task: IndexedTask, target: TableCountdownTarget = 'earlier'): TableCountdownDate | null {
 const fields = task.fieldValues;
 const start = validUpcomingTimestamp(fields['datetimeStart'] ?? '', true);
 const scheduledTime = start ?? validUpcomingTimestamp(fields['dateScheduled'] ?? '', false);
 const dueTime = validUpcomingTimestamp(fields['dateDue'] ?? '', false);
 const scheduled: TableCountdownDate | null = scheduledTime === null ? null : {
  timestamp: scheduledTime, date: toLocalDate(new Date(scheduledTime)), timed: start !== null, source: 'scheduled',
 };
 const due: TableCountdownDate | null = dueTime === null ? null : {
  timestamp: dueTime, date: toLocalDate(new Date(dueTime)), timed: false, source: 'due',
 };
 if (target === 'scheduled') return scheduled;
 if (target === 'due') return due;
 if (!scheduled) return due;
 if (!due) return scheduled;
 if (scheduled.date === due.date) return scheduled.timed ? scheduled : { ...scheduled, source: 'both' };
 return scheduled.date < due.date ? scheduled : due;
}

function calendarDayNumber(date: Date): number {
 return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
}

function anniversary(date: Date, years: number): Date {
 const result = new Date(date);
 // Clamp Feb 29 to the last day of February in a non-leap target year.
 result.setDate(1);
 result.setFullYear(date.getFullYear() + years);
 result.setMonth(date.getMonth());
 const last = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
 result.setDate(Math.min(date.getDate(), last));
 return result;
}

export function formatTableCountdown(target: TableCountdownDate, now: Date, mode: 'compact' | 'details' | 'tooltip'): string {
 const end = new Date(target.timestamp);
 const begin = new Date(now);
 if (!target.timed) begin.setHours(0, 0, 0, 0);
 if (end.getTime() <= begin.getTime()) return target.timed ? (mode === 'tooltip' ? '0s' : '0m') : '0d';
 let years = Math.max(0, end.getFullYear() - begin.getFullYear());
 if (anniversary(begin, years).getTime() > end.getTime()) years--;
 const afterYears = anniversary(begin, years);
 let days = Math.max(0, calendarDayNumber(end) - calendarDayNumber(afterYears));
 const afterDays = new Date(afterYears);
 afterDays.setDate(afterDays.getDate() + days);
 if (afterDays.getTime() > end.getTime()) {
  days--;
  afterDays.setDate(afterDays.getDate() - 1);
 }
 const seconds = Math.max(0, Math.ceil((end.getTime() - afterDays.getTime()) / 1000));
 const values: [number, string][] = [[years, 'y'], [days, 'd']];
 if (target.timed) values.push([Math.floor(seconds / 3600), 'h'], [Math.floor(seconds / 60) % 60, 'm']);
 if (mode === 'compact') {
  const first = values.find(([value]) => value > 0);
  return first ? `${first[0]}${first[1]}` : target.timed ? '<1m' : '0d';
 }
 if (target.timed && mode === 'tooltip') values.push([seconds % 60, 's']);
 const first = values.findIndex(([value]) => value > 0);
 if (first < 0) return target.timed ? (mode === 'tooltip' ? '0s' : '<1m') : '0d';
 return values.slice(first).map(([value, unit]) => `${value}${unit}`).join(' ');
}
