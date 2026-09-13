import type { IndexedTask } from '../../types/fields';

export interface CalendarRefreshRequest {
 allowContentSkip: boolean;
 reason: string;
}

/** Content refreshes still recalculate membership and placement, but can retain the shell. */
export function isCalendarContentRefresh(request: CalendarRefreshRequest): boolean {
 return request.allowContentSkip || request.reason === 'calendar-task' || request.reason === 'tracker';
}

/** A forced refresh must survive coalescing, focus and drag deferral. */
export function mergeCalendarRefreshRequest(
 pending: CalendarRefreshRequest | null,
 incoming: Partial<CalendarRefreshRequest>,
): CalendarRefreshRequest {
 const next = { allowContentSkip: incoming.allowContentSkip === true, reason: incoming.reason ?? 'refresh' };
 if (!pending) return next;
 if (!isCalendarContentRefresh(pending)) return pending;
 if (!isCalendarContentRefresh(next)) return next;
 if (!pending.allowContentSkip) return pending;
 if (!next.allowContentSkip) return next;
 return pending;
}

/** Calendar display, sorting and interaction data; source offsets and index tier are not rendered. */
export function areCalendarTasksEquivalent(left: IndexedTask, right: IndexedTask): boolean {
 if (left === right) return true;
 if (left.operonId !== right.operonId || left.description !== right.description || left.checkbox !== right.checkbox
  || left.datetimeModified !== right.datetimeModified || left.primary.filePath !== right.primary.filePath
  || left.primary.format !== right.primary.format || left.tags.length !== right.tags.length
  || left.tags.some((tag, index) => tag !== right.tags[index])
  || left.plainCheckboxProgress?.total !== right.plainCheckboxProgress?.total
  || left.plainCheckboxProgress?.completed !== right.plainCheckboxProgress?.completed) return false;
 const keys = Object.keys(left.fieldValues);
 return keys.length === Object.keys(right.fieldValues).length
  && keys.every(key => Object.prototype.hasOwnProperty.call(right.fieldValues, key) && left.fieldValues[key] === right.fieldValues[key]);
}
