import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { areCalendarTasksEquivalent, mergeCalendarRefreshRequest } from '../src/ui/calendar/calendar-refresh-decision';
import type { IndexedTask } from '../src/types/fields';

const task: IndexedTask = {
 operonId: 'abc1234', description: 'Calendar task', checkbox: 'open',
 fieldValues: { dateScheduled: '2026-09-13', note: 'Note' }, tags: ['work'],
 primary: { filePath: 'tasks.md', lineNumber: 2, format: 'inline' },
 datetimeModified: '2026-09-13T10:00:00', tier: 'hot',
};
test('identical reindexed data and field key order retain calendar content', () => {
 assert.equal(areCalendarTasksEquivalent(task, structuredClone(task)), true);
 assert.equal(areCalendarTasksEquivalent(task, { ...task, fieldValues: { note: 'Note', dateScheduled: '2026-09-13' } }), true);
 assert.equal(areCalendarTasksEquivalent(task, { ...task, tier: 'warm', primary: { ...task.primary, lineNumber: 20 } }), true);
});
test('render, ordering and interaction changes invalidate calendar content', () => {
 for (const changed of [
  { description: 'Changed' }, { checkbox: 'done' }, { operonId: 'def1234' },
  { tags: ['other'] }, { fieldValues: { ...task.fieldValues, note: 'Changed' } },
  { fieldValues: { dateScheduled: '2026-09-13' } },
  { datetimeModified: '2026-09-13T11:00:00' },
  { primary: { ...task.primary, filePath: 'moved.md' } },
  { primary: { ...task.primary, format: 'yaml' } },
  { plainCheckboxProgress: { total: 2, completed: 1 } },
 ] as Partial<IndexedTask>[]) assert.equal(areCalendarTasksEquivalent(task, { ...task, ...changed }), false);
});
test('coalescing and deferral preserve force-refresh dominance in both orders', () => {
 const passive = { allowContentSkip: true, reason: 'index' };
 const forced = { allowContentSkip: false, reason: 'settings' };
 assert.equal(mergeCalendarRefreshRequest(null, passive).allowContentSkip, true);
 assert.equal(mergeCalendarRefreshRequest(passive, passive).allowContentSkip, true);
 for (const [first, second] of [[passive, forced], [forced, passive]]) {
  const merged = mergeCalendarRefreshRequest(first, second);
  assert.equal(merged.allowContentSkip, false);
  assert.equal(merged.reason, 'settings');
  assert.equal(mergeCalendarRefreshRequest(merged, passive).allowContentSkip, false);
 }
 assert.equal(mergeCalendarRefreshRequest(null, {}).allowContentSkip, false);
});

test('structural refresh dominates desktop content refresh in either order', () => {
 for (const reason of ['calendar-task', 'tracker']) {
  const content = { allowContentSkip: false, reason };
  const structural = { allowContentSkip: false, reason: 'settings' };
  assert.deepEqual(mergeCalendarRefreshRequest(content, structural), structural);
  assert.deepEqual(mergeCalendarRefreshRequest(structural, content), structural);
  assert.deepEqual(mergeCalendarRefreshRequest({ allowContentSkip: true, reason: 'index' }, content), content);
 }
});
