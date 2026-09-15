import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { IndexedTask } from '../src/types/fields';
import { createEmptyQueryRanker } from '../src/ui/field-pickers/empty-query-ranking';

const task = (id: string, values: string, modified = '', created = '', checkbox: IndexedTask['checkbox'] = 'open'): IndexedTask => ({
 operonId: id, fieldValues: { value: values, datetimeCreated: created }, datetimeModified: modified, checkbox,
 description: id, tags: [], primary: { filePath: 'Tasks.md', lineNumber: 0, format: 'inline' }, tier: 'hot',
});
const ranker = (tasks: IndexedTask[]) => createEmptyQueryRanker<string>(tasks, t => t.fieldValues.value.split(';'), x => x);

test('created then modified then frequency; every task state contributes', () => {
 const rank = ranker([task('1','a','2026-01-03','2026-01-01'), task('2','b','2026-01-01','2026-01-03'),
 task('3','c'), task('4','c','','','done'), task('5','c','','','cancelled')]);
 assert.deepEqual(rank(['d','c','b','a']), ['b','a','c','d']);
});
test('each recent list contributes one value and modified excludes the created choice', () => {
 const rank = ranker([task('1','a;b','2026-01-03','2026-01-03'), task('2','b'), task('3','c'),task('4','c'),task('5','c')]);
 assert.deepEqual(rank(['a','b','c']), ['b','a','c']);
});
test('counts deduplicate task ids and repeated values; ties retain candidate order', () => {
 const a = task('1','a;a;a');
 assert.deepEqual(ranker([a,a,task('2','b')])(['b','a','unused']), ['b','a','unused']);
});
test('ineligible values are excluded before selecting the recent source task', () => {
 const rank = ranker([task('1','excluded','2026-01-04'),task('2','a;b','2026-01-03'),task('3','b')]);
 assert.deepEqual(rank(['a','b','zero']), ['b','a','zero']);
 assert.deepEqual(rank(['a','zero']), ['a','zero']);
 assert.deepEqual(rank([]), []);
});
test('missing or invalid dates do not promote candidates; tied dates use task id', () => {
 assert.deepEqual(ranker([task('z','a','invalid'),task('b','b','2026-01-01'),task('a','c','2026-01-01')])(['a','b','c']), ['c','a','b']);
 assert.deepEqual(ranker([])(['b','a']), ['b','a']);
});
test('snapshot is independent of later task edits and does not mutate candidate input', () => {
 const source = task('1','a'); const rank = ranker([source]); source.fieldValues.value = 'b';
 const candidates = ['b','a']; assert.deepEqual(rank(candidates), ['a','b']); assert.deepEqual(candidates,['b','a']);
});
test('parent ranks referenced IDs, and separate custom fields do not share counts', () => {
 const t = task('source','x'); t.fieldValues.parentTask = 'parent'; t.fieldValues.other = 'y';
 assert.deepEqual(createEmptyQueryRanker([t], x => [x.fieldValues.parentTask], (x: string) => x)(['source','parent']), ['parent','source']);
 assert.deepEqual(createEmptyQueryRanker([t], x => [x.fieldValues.other], (x: string) => x)(['x','y']), ['y','x']);
});

test('modified skips the created value and finds the next distinct dated value before frequency', () => {
 const rank = ranker([task('1','a','2026-01-04','2026-01-04'), task('2','a','2026-01-03'),
 task('3','b','2026-01-02'), task('4','c'), task('5','c'), task('6','c')]);
 assert.deepEqual(rank(['c','b','a']), ['a','b','c']);
});
test('no distinct dated modified value falls back to usage without duplicating created', () => {
 const rank = ranker([task('1','a','2026-01-04','2026-01-04'), task('2','a','2026-01-03'), task('3','c')]);
 assert.deepEqual(rank(['b','c','a']), ['a','c','b']);
 assert.deepEqual(rank(['a']), ['a']);
});
