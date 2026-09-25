import { formatTableCompactDuration } from '../src/ui/table/table-display';
import { evaluateFilterSet as displayFilter } from '../src/core/filter-display';
import { getTimeScopedFieldValues, getScopedTrackerSessions, inheritTaskTimeScope, replaceTaskTimeScope } from '../src/core/time-scope-values';
import { createTableValueResolver } from '../src/ui/table/table-value-cache';
import { queryTableRows } from '../src/systems/table-query';
import { createDefaultTablePreset } from '../src/types/table';
import { DEFAULT_SETTINGS } from '../src/types/settings';
import { serializeTableExportCsv, serializeTableExportMarkdown } from '../src/ui/table/table-export';
import { buildTableRenderItems } from '../src/ui/table/table-surface';
import { projectTableTaskTree } from '../src/ui/table/table-task-tree';
import { parseTrackerList } from '../src/systems/tracker-utils';
import { buildInlineTaskCompactChipEntries } from '../src/ui/compact-task-layout';
import { TrackedOnFilterEvaluation } from '../src/core/tracked-on-filter';
import { normalizeFilterSet, cloneFilterSet } from '../src/types/settings';
import { encodeFilterGroupClipboard, decodeFilterGroupClipboard } from '../src/core/filter-group-clipboard';
import { getOperatorsForField } from '../src/core/filter-evaluator';
import assert from 'node:assert/strict';
import { evaluateFilterSet, evaluateFilterSetWithTimeScope, filterTasksOnly, evaluateFilterSetGrouped, DATE_OPERATORS } from '../src/core/filter-evaluator';
import { isValidTrackedOnCondition } from '../src/core/tracked-on-filter';
import type { IndexedTask } from '../src/types/fields';
import type { FilterGroup, FilterNode, FilterSet, FilterSetCondition } from '../src/types/settings';

const today = '2026-09-24';
function task(id: string, trackers = '', fields: Record<string, string> = {}): IndexedTask {
	return { operonId: id, description: id, checkbox: 'open', fieldValues: { trackers, duration: '999999', totalDuration: '999999', ...fields }, tags: [], primary: { filePath: `${id}.md`, lineNumber: 0, format: 'inline' }, datetimeModified: '', tier: 'hot' };
}
function session(date: string, hours = 1): string { return `${date}T10:00:00/${date}T${String(10 + hours).padStart(2, '0')}:00:00`; }
function tracked(operator = 'inLastDays', value = '7', values?: string[]): FilterSetCondition { return { id: operator, field: 'trackedOn', fieldType: 'date', operator, value, ...(values ? { values } : {}) }; }
function condition(field: string, value: string, operator = 'is'): FilterSetCondition { return { id: field, field, fieldType: field.endsWith('Duration') || field === 'duration' ? 'number' : 'text', operator, value }; }
function group(logic: FilterGroup['logic'], ...children: FilterNode[]): FilterGroup { return { id: logic, logic, children }; }
function filter(rootGroup: FilterGroup): FilterSet { return { id: 'test', name: 'Test', rootGroup, matchLogic: 'all', conditions: [], sorts: [], groupBy: 'priority' }; }
function evaluate(root: FilterGroup, tasks: IndexedTask[], allTasks = tasks, day = today) { return evaluateFilterSetWithTimeScope(filter(root), tasks, undefined, undefined, undefined, { today: day, timeScopeTasks: allTasks }); }
function ids(result: ReturnType<typeof evaluate>): string[] { return result.tasks.map(task => task.operonId); }
function seconds(result: ReturnType<typeof evaluate>, id: string): number | undefined { return result.timeScope?.get(id)?.durationSeconds; }

export function registerTrackedOnFilterTests(test: (name: string, run: () => void) => void): void {
	test('Table compact durations: four built-in fields share largest-unit labels', () => {
		for (const key of ['duration', 'totalDuration', 'estimate', 'totalEstimate']) {
			for (const [seconds, label] of [[0, '0s'], [45, '45s'], [59, '59s'], [60, '1m'], [3599, '59m'], [3600, '1h'], [12310, '3h'], [86399, '23h'], [86400, '1d'], [172800, '2d'], [31536000, '1y']] as const) {
				assert.equal(formatTableCompactDuration(key, String(seconds)), label);
			}
			for (const invalid of ['', ' ', '-1', 'NaN', 'Infinity', '4h']) assert.equal(formatTableCompactDuration(key, invalid), null);
		}
		assert.equal(formatTableCompactDuration('trackers', '3600'), null);
		assert.equal(formatTableCompactDuration('customDuration', '3600'), null);
	});
	test('Table compact duration: filtered records sum while detailed display stays precise', () => {
		const t = task('t', `${session('2026-08-01', 8)}; ${session(today)}; ${session(today, 2)}`);
		const [view] = displayFilter(filter(group('all', tracked())), [t], undefined, undefined, undefined, { today });
		const resolver = createTableValueResolver([t], DEFAULT_SETTINGS);
		assert.equal(formatTableCompactDuration('duration', resolver.getRawValue(view, 'duration')), '3h');
		assert.equal(resolver.getDisplayValue(view, 'duration'), '3h 0m 0s');
		assert.equal(getScopedTrackerSessions(view, parseTrackerList(t.fieldValues.trackers).map((s, sessionIndex) => ({ ...s, sessionIndex, operonId: t.operonId, task: t }))).length, 2);
	});
	test('Tracked on: month boundaries do not overflow at day 31', () => {
		const t = task('t', `${session('2026-02-28')}; ${session('2026-03-01')}; ${session('2026-04-30')}`);
		for (const [operator, expected] of [['lastMonth', '2026-02-28'], ['nextMonth', '2026-04-30']]) {
			assert.deepEqual(evaluate(group('all', tracked(operator)), [t], [t], '2026-03-31').timeScope?.get('t')?.sessions.map(s => s.start.slice(0, 10)), [expected]);
		}
	});
	test('Tracked on: None ordinary duration excludes against its enclosing period', () => {
		const t = task('t', session('2026-08-01', 3));
		assert.deepEqual(ids(evaluate(group('none', tracked(), condition('duration', '7200', 'gt')), [t])), []);
		const child = task('child', session('2026-08-01', 3), { parentTask: 't' });
		assert.deepEqual(ids(evaluate(group('none', tracked(), condition('totalDuration', '7200', 'gt')), [t], [t, child])), []);
		child.fieldValues.trackers = 'bad';
		assert.deepEqual(ids(evaluate(group('none', tracked(), condition('totalDuration', '7200', 'gt')), [t], [t, child])), []);
	});
	test('Tracked on: equivalent Any branches are deduplicated before products expand', () => {
		let calls = 0;
		const t = task('t', session(today));
		const root = group('all', ...Array.from({ length: 16 }, (_, i) => group('any', { ...tracked('isToday'), id: `a${i}` }, { ...tracked('isToday'), id: `b${i}` })));
		const engine = new TrackedOnFilterEvaluation(root, [t], today, DATE_OPERATORS.map(op => op.id), (_op, date) => { calls++; return date === today; }, () => 'true');
		assert.equal(engine.evaluate(t).time.durationSeconds, 3600);
		assert.ok(calls < 2000, `unexpected predicate expansion: ${calls}`);
	});
	test('Tracked on: distinct overlapping date alternatives do not expand exponentially', () => {
		let calls = 0;
		const t = task('t', session(today));
		const root = group('all', ...Array.from({ length: 16 }, (_, i) => group('any', tracked('underDaysAway', String(2 * i + 1)), tracked('underDaysAway', String(2 * i + 2)))));
		const engine = new TrackedOnFilterEvaluation(root, [t], today, DATE_OPERATORS.map(op => op.id), () => { calls++; return true; }, () => 'true');
		assert.equal(engine.evaluate(t).time.durationSeconds, 3600);
		assert.ok(calls < 2000, `unexpected distinct predicate expansion: ${calls}`);
	});
	test('Tracked on: only successful Any branches scope descendant totals', () => {
		const parent = task('p', session(today)); const child = task('c', session('2026-09-23'), { parentTask: 'p' });
		const alternatives = group('any', tracked('dateIs', today), tracked('dateIs', '2026-09-23'));
		assert.equal(evaluate(alternatives, [parent], [parent, child]).timeScope?.get('p')?.totalDurationSeconds, 3600);
		const both = task('both', `${session(today)}; ${session('2026-09-23')}`);
		assert.deepEqual(ids(evaluate(group('all', alternatives, condition('duration', '3600', 'gt')), [both])), []);
	});
	test('Tracked on: grouped and flat duration order is numeric and canonical', () => {
		const a = task('a', session(today, 2), { duration: '999999' });
		const b = task('b', session(today, 10), { duration: '1' });
		const f = filter(group('all', tracked())); f.sorts = [{ field: 'duration', order: 'desc' }];
		const flat = evaluateFilterSet(f, [a, b], undefined, undefined, undefined, { today });
		const grouped = evaluateFilterSetGrouped(f, [a, b], undefined, undefined, undefined, { today });
		assert.deepEqual(flat, [b, a]); assert.equal(flat[0], b);
		assert.deepEqual(grouped.groups.flatMap(g => g.tasks), flat);
	});
	test('Tracked on: view context preserves raw JSON and fresh optimistic fields', () => {
		const t = task('t', `${session('2026-08-01')}; ${session(today)}`, { status: 'Old' });
		const before = JSON.stringify(t);
		const [view] = displayFilter(filter(group('all', tracked())), [t], undefined, undefined, undefined, { today });
		assert.equal(JSON.stringify(view), before);
		assert.equal(getTimeScopedFieldValues(view.fieldValues).duration, '3600');
		const optimistic = { ...view.fieldValues, status: 'New' };
		assert.equal(getTimeScopedFieldValues(optimistic).status, 'New');
		assert.equal(getTimeScopedFieldValues(optimistic).duration, '3600');
		replaceTaskTimeScope(optimistic, t.fieldValues);
		assert.equal(getTimeScopedFieldValues(optimistic).duration, '999999');
		assert.equal(JSON.stringify(t), before);
	});
	test('Tracked on: detailed sessions retain original edit index and reject stale records', () => {
		const t = task('t', `${session('2026-08-01')}; ${session(today)}; ${session(today)}`);
		const [view] = displayFilter(filter(group('all', tracked())), [t], undefined, undefined, undefined, { today });
		const sessions = parseTrackerList(t.fieldValues.trackers).map((s, sessionIndex) => ({ ...s, sessionIndex, operonId: t.operonId, task: t }));
		const selected = getScopedTrackerSessions(view, sessions);
		assert.deepEqual(selected.map(s => s.sessionIndex), [1, 2]);
		assert.equal(selected[0], sessions[1]);
		assert.equal(getScopedTrackerSessions(view, [{ ...sessions[1], start: 'changed' }]).length, 0);
	});
	test('Tracked on: table sums exports and compact chips use one selected period', () => {
		const t = task('t', `${session('2026-08-01', 10)}; ${session(today)}`);
		const f = filter(group('all', tracked('dateIs', today)));
		const preset = createDefaultTablePreset(); preset.columns = [{ key: 'duration', kind: 'task', widthPx: 120 }]; preset.summaries = [{ key: 'duration', function: 'Sum' }];
		const result = queryTableRows({ preset, filterSet: f, tasks: [t], priorities: [], settings: DEFAULT_SETTINGS });
		const row = result.rows[0];
		assert.equal(result.valueResolver.getRawValue(row, 'duration'), '3600');
		assert.equal(result.valueResolver.getRawValue(t, 'duration'), '999999');
		const source = { columns: preset.columns, rows: result.rows, settings: DEFAULT_SETTINGS, valueResolver: result.valueResolver };
		const label = result.valueResolver.getDisplayValue(row, 'duration');
		assert.ok(serializeTableExportCsv(source).includes(label));
		assert.ok(serializeTableExportMarkdown(source).includes(label));
		const chips = buildInlineTaskCompactChipEntries(row.fieldValues, [], DEFAULT_SETTINGS, [t], [{ key: 'duration', visible: true, iconOnly: false }]);
		assert.equal(chips.length, 1);
		assert.ok(JSON.stringify(chips).includes('1h'));
		assert.equal(result.summaries.get('duration')?.value, label);
	});
	test('Tracked on: expanded table descendants inherit period and keep original fields', () => {
		const parent = task('p', session(today));
		const child = task('c', `${session('2026-08-01')}; ${session(today, 2)}`, { parentTask: 'p' });
		const [view] = displayFilter(filter(group('all', tracked())), [parent], undefined, undefined, undefined, { today, timeScopeTasks: [parent, child] });
		const items = buildTableRenderItems([view], [], [], false);
		const first = items[0]; assert.equal(first.kind, 'task'); if (first.kind !== 'task') return;
		const projected = projectTableTaskTree(items, [parent, child], [first.ordinalKey]);
		const childRow = projected.find(item => item.kind === 'task' && item.task.operonId === 'c');
		assert.ok(childRow?.kind === 'task'); if (childRow?.kind !== 'task') return;
		assert.equal(getTimeScopedFieldValues(childRow.task.fieldValues).duration, '7200');
		assert.equal(childRow.task.fieldValues.trackers, child.fieldValues.trackers);
		assert.equal(getTimeScopedFieldValues(inheritTaskTimeScope(view, child).fieldValues).duration, '7200');
		const resolver = createTableValueResolver([parent, child]);
		assert.equal(resolver.getRawValue(child, 'duration'), '999999');
		assert.equal(resolver.getRawValue(childRow.task, 'duration'), '7200');
	});
	test('Tracked on: collapsed child groups cannot replace independent branch periods', () => {
		const parent = task('p', session(today), { priority: 'High' });
		const child = task('c', `${session('2026-09-02')}; ${session(today)}`, { priority: 'Low', parentTask: 'p' });
		const f = filter(group('any', group('all', condition('priority', 'High'), tracked()), group('all', condition('priority', 'Low'), tracked('inLastDays', '30'))));
		const views = displayFilter(f, [parent, child], undefined, undefined, undefined, { today });
		const items = buildTableRenderItems([views[0]], [], [], false);
		const first = items[0]; if (first.kind !== 'task') throw new Error('missing task row');
		const projected = projectTableTaskTree(items, [parent, child], [first.ordinalKey]);
		const row = projected.find(item => item.kind === 'task' && item.task.operonId === 'c');
		if (row?.kind !== 'task') throw new Error('missing child');
		assert.equal(getTimeScopedFieldValues(row.task.fieldValues).duration, '7200');
	});
	test('Tracked on: same-day range survives save/load and cloning without deduplicating bounds', () => {
		const original = filter(group('all', tracked('between', '', [today, today])));
		const normalized = normalizeFilterSet(JSON.parse(JSON.stringify(original)))!;
		const copied = cloneFilterSet(normalized);
		const range = copied.rootGroup.children[0] as FilterSetCondition;
		assert.deepEqual(range.values, [today, today]);
		assert.equal(range.value, undefined);
		range.values![0] = '2026-09-01';
		assert.deepEqual((normalized.rootGroup.children[0] as FilterSetCondition).values, [today, today]);
	});
	test('Tracked on: clipboard round trip preserves two range boundaries', () => {
		const root = group('all', { ...tracked('between', '', [today, today]), value: undefined });
		const result = decodeFilterGroupClipboard(encodeFilterGroupClipboard(root), {
			createGroupId: () => 'group', createConditionId: () => 'condition',
			isOperatorAllowed: (field, type, op) => getOperatorsForField(field, type, true).some(operator => operator.id === op),
		});
		assert.ok(result.ok);
		if (result.ok) assert.deepEqual((result.group.children[0] as FilterSetCondition).values, [today, today]);
	});
	test('Tracked on: new operators are exclusive to the new condition', () => {
		for (const op of ['inLastDays']) {
			assert.ok(getOperatorsForField('trackedOn', 'date').some(operator => operator.id === op));
			assert.ok(!getOperatorsForField('datetimeModified', 'datetime').some(operator => operator.id === op));
		}
	});
	test('Tracked on: 50 tasks yield exactly the 15 with recent records', () => {
		const tasks = Array.from({ length: 50 }, (_, i) => task(String(i), session(i < 15 ? today : '2026-08-01')));
		const result = evaluate(group('all', tracked()), tasks);
		assert.equal(result.tasks.length, 15);
		assert.equal([...result.timeScope!.values()].reduce((sum, time) => sum + time.durationSeconds, 0), 15 * 3600);
	});
	test('Tracked on: last seven days includes today and six preceding calendar days', () => {
		const t = task('t', ['2026-09-17', '2026-09-18', today, '2026-09-25'].map(day => session(day)).join('; '));
		const result = evaluate(group('all', tracked()), [t]);
		assert.deepEqual(result.timeScope?.get('t')?.sessions.map(s => s.rawIndex), [1, 2]);
		assert.equal(seconds(result, 't'), 7200);
	});
	test('Tracked on: one day is today only', () => {
		const t = task('t', `${session('2026-09-23')}; ${session(today)}`);
		assert.equal(seconds(evaluate(group('all', tracked('inLastDays', '1')), [t]), 't'), 3600);
	});
	test('Tracked on: between is inclusive and supports the same boundary day', () => {
		const t = task('t', ['2026-09-09', '2026-09-10', '2026-09-20', '2026-09-21'].map(day => session(day)).join('; '));
		assert.equal(seconds(evaluate(group('all', tracked('between', '', ['2026-09-10', '2026-09-20'])), [t]), 't'), 7200);
		assert.equal(seconds(evaluate(group('all', tracked('between', '', ['2026-09-10', '2026-09-10'])), [t]), 't'), 3600);
	});
	test('Tracked on: All cannot satisfy range boundaries with different records', () => {
		const t = task('t', `${session('2026-09-01')}; ${session('2026-09-30')}`);
		assert.deepEqual(ids(evaluate(group('all', tracked('after', '2026-09-10'), tracked('before', '2026-09-20')), [t])), []);
	});
	test('Tracked on: nested All inherits the same-record intersection', () => {
		const t = task('t', `${session('2026-09-01')}; ${session('2026-09-30')}`);
		assert.deepEqual(ids(evaluate(group('all', tracked('after', '2026-09-10'), group('all', tracked('before', '2026-09-20'))), [t])), []);
	});
	test('Tracked on: Any keeps priority branches and their periods separate', () => {
		const history = `${session('2026-09-01')}; ${session(today)}`;
		const high = task('high', history, { priority: 'High' });
		const low = task('low', history, { priority: 'Low' });
		const result = evaluate(group('any', group('all', condition('priority', 'High'), tracked()), group('all', condition('priority', 'Low'), tracked('inLastDays', '30'))), [high, low]);
		assert.equal(seconds(result, 'high'), 3600);
		assert.equal(seconds(result, 'low'), 7200);
	});
	test('Tracked on: duration conditions use branch time, regardless of condition order', () => {
		const t = task('t', `${session('2026-08-01', 5)}; ${session(today)}`);
		for (const children of [[tracked(), condition('duration', '7200', 'gt')], [condition('duration', '7200', 'gt'), tracked()]]) assert.deepEqual(ids(evaluate(group('all', ...children), [t])), []);
		assert.deepEqual(ids(evaluate(group('all', tracked(), condition('duration', '7200', 'lt')), [t])), ['t']);
	});
	test('Tracked on: failed duration branch contributes no records to a successful Any', () => {
		const t = task('t', `${session('2026-09-01', 3)}; ${session(today)}`);
		const result = evaluate(group('any', group('all', tracked('inLastDays', '30'), condition('duration', '3600', 'lt')), tracked()), [t]);
		assert.equal(seconds(result, 't'), 3600);
	});
	test('Tracked on: overlapping Any periods deduplicate identity, not equal timestamps', () => {
		const t = task('t', `${session(today)}; ${session(today)}`);
		const result = evaluate(group('any', tracked(), tracked('isToday')), [t]);
		assert.equal(seconds(result, 't'), 7200);
		assert.deepEqual(result.timeScope?.get('t')?.sessions.map(s => s.sessionIndex), [0, 1]);
	});
	test('Tracked on: ordinary Any branch admits tasks without restoring history', () => {
		const t = task('t', session('2026-08-01'), { priority: 'High' });
		const result = evaluate(group('any', tracked(), condition('priority', 'High')), [t]);
		assert.deepEqual(ids(result), ['t']);
		assert.equal(seconds(result, 't'), 0);
	});
	test('Tracked on: None excludes tasks with any matching child, not individual records', () => {
		const mixed = task('mixed', `${session('2026-08-01')}; ${session(today)}`);
		const old = task('old', session('2026-08-01'));
		const result = evaluate(group('none', tracked()), [mixed, old]);
		assert.deepEqual(ids(result), ['old']);
		assert.equal(seconds(result, 'old'), 3600);
	});
	test('Tracked on: not today selects older records on a mixed task', () => {
		const t = task('t', `${session('2026-09-23')}; ${session(today)}`);
		assert.equal(seconds(evaluate(group('all', tracked('notToday')), [t]), 't'), 3600);
	});
	test('Tracked on: empty history, hasNoValue and hasAnyValue', () => {
		const empty = task('empty'); const recorded = task('recorded', session(today));
		assert.deepEqual(ids(evaluate(group('all', tracked('hasNoValue')), [empty, recorded])), ['empty']);
		assert.deepEqual(ids(evaluate(group('all', tracked('hasAnyValue')), [empty, recorded])), ['recorded']);
		assert.deepEqual(ids(evaluate(group('none', tracked('hasNoValue')), [empty, recorded])), ['recorded']);
	});
	for (const bad of ['garbage', `${session(today)}; garbage`, `${session(today)}/extra`, `${today}T10:00:00/${today}T09:00:00`, `${today}T10:00:00/${today}T10:00:00`]) {
		test(`Tracked on: invalid history stays unknown under None (${bad})`, () => {
			assert.deepEqual(ids(evaluate(group('none', tracked()), [task('bad', bad)])), []);
		});
	}
	test('Tracked on: invalid conditions never turn into match-all or match under None', () => {
		const t = task('t', session(today));
		for (const bad of [tracked('between', '', ['2026-09-25', today]), tracked('between', '', [today]), tracked('between', '', ['2026-02-30', today]), tracked('dateIs', '2026-02-30'), tracked('inLastDays', '0'), tracked('inLastDays', '1.5'), tracked('unknown'), { ...tracked(), fieldType: 'text' as const }]) {
			assert.deepEqual(ids(evaluate(group('all', bad), [t])), []);
			assert.deepEqual(ids(evaluate(group('none', bad), [t])), []);
		}
	});
	test('Tracked on: invalid time branch does not suppress a true ordinary Any branch', () => {
		const t = task('t', 'garbage', { priority: 'High' });
		const result = evaluate(group('any', tracked(), condition('priority', 'High')), [t]);
		assert.deepEqual(ids(result), ['t']);
		assert.equal(seconds(result, 't'), 0);
	});
	test('Tracked on: parent includes nonmatching descendants in its own period', () => {
		const parent = task('parent', session(today), { priority: 'High' });
		const child = task('child', `${session('2026-08-01')}; ${session(today, 2)}`, { parentTask: 'parent', priority: 'Low' });
		const grandchild = task('grandchild', session(today, 3), { parentTask: 'child' });
		const root = group('all', tracked(), condition('priority', 'High'), condition('totalDuration', '20000', 'gt'));
		const result = evaluate(root, [parent], [parent, child, grandchild]);
		assert.deepEqual(ids(result), ['parent']);
		assert.equal(result.timeScope?.get('parent')?.totalDurationSeconds, 21600);
	});
	test('Tracked on: descendants use the parent period, not their own qualifying priority branch', () => {
		const parent = task('parent', session(today), { priority: 'High' });
		const child = task('child', `${session('2026-09-01')}; ${session(today)}`, { parentTask: 'parent', priority: 'Low' });
		const root = group('any', group('all', condition('priority', 'High'), tracked()), group('all', condition('priority', 'Low'), tracked('inLastDays', '30')));
		assert.equal(evaluate(root, [parent, child]).timeScope?.get('parent')?.totalDurationSeconds, 7200);
	});
	test('Tracked on: invalid descendant totals remain unknown under None', () => {
		const p = task('p', session(today)); const c = task('c', 'garbage', { parentTask: 'p' });
		const root = group('all', tracked(), group('none', condition('totalDuration', '7200', 'gt')));
		assert.deepEqual(ids(evaluate(root, [p], [p, c])), []);
	});
	test('Tracked on: malformed descendant never produces a plausible partial aggregate', () => {
		const p = task('p', session(today)); const c = task('c', 'garbage', { parentTask: 'p' });
		assert.equal(evaluate(group('all', tracked()), [p], [p, c]).timeScope?.get('p')?.totalDurationSeconds, null);
		const root = group('all', tracked(), group('any', condition('description', 'p'), condition('totalDuration', '7200', 'gt')));
		assert.deepEqual(ids(evaluate(root, [p], [p, c])), ['p']);
	});
	test('Tracked on: hierarchy cycle does not duplicate duration or recurse forever', () => {
		const a = task('a', session(today), { parentTask: 'b' });
		const b = task('b', session(today), { parentTask: 'a' });
		assert.equal(evaluate(group('all', tracked()), [a, b]).timeScope?.get('a')?.totalDurationSeconds, 7200);
	});
	test('Tracked on: partial input hierarchy still uses scoped descendants once', () => {
		const p = task('p', session(today)); const c = task('c', session(today), { parentTask: 'p' });
		const result = evaluate(group('any', tracked(), tracked('isToday')), [p], [p, c, c]);
		assert.equal(result.timeScope?.get('p')?.totalDurationSeconds, 7200);
	});
	test('Tracked on: full cross-midnight duration belongs to start date', () => {
		const t = task('t', '2026-09-23T23:00:00/2026-09-24T01:00:00');
		assert.deepEqual(ids(evaluate(group('all', tracked('isToday')), [t])), []);
		assert.equal(seconds(evaluate(group('all', tracked('dateIs', '2026-09-23')), [t]), 't'), 7200);
	});
	test('Tracked on: midnight-split records select their own start day', () => {
		const t = task('t', '2026-09-23T23:00:00/2026-09-24T00:00:00; 2026-09-24T00:00:00/2026-09-24T01:00:00');
		assert.equal(seconds(evaluate(group('all', tracked('isToday')), [t]), 't'), 3600);
	});
	test('Tracked on: unsorted history preserves original edit references', () => {
		const t = task('t', `${session(today)}; ${session('2026-08-01')}; ${session('2026-09-20')}`);
		assert.deepEqual(evaluate(group('all', tracked()), [t]).timeScope?.get('t')?.sessions.map(s => [s.rawIndex, s.sessionIndex]), [[0, 0], [2, 2]]);
	});
	test('Tracked on: active tracker alone does not match', () => {
		assert.deepEqual(ids(evaluate(group('all', tracked()), [task('t', '', { activeTracker: `${today}T10:00:00` })])), []);
	});
	test('Tracked on: snapshots isolate filters, today and record changes without writes', () => {
		const t = task('t', `${session('2026-09-18')}; ${session(today)}`);
		const before = JSON.stringify(t);
		Object.freeze(t.fieldValues); Object.freeze(t);
		const a = evaluate(group('all', tracked()), [t]);
		const b = evaluate(group('all', tracked('isToday')), [t]);
		const tomorrow = evaluate(group('all', tracked()), [t], [t], '2026-09-25');
		assert.equal(seconds(a, 't'), 7200); assert.equal(seconds(b, 't'), 3600); assert.equal(seconds(tomorrow, 't'), 3600);
		assert.equal(a.tasks[0], t); assert.equal(JSON.stringify(t), before);
		assert.equal(seconds(a, 't'), 7200);
	});
	test('Tracked on: fresh evaluations reflect add, edit and delete without stale history', () => {
		const t = task('t', session('2026-08-01')); const root = group('all', tracked());
		assert.deepEqual(ids(evaluate(root, [t])), []);
		t.fieldValues.trackers += `; ${session(today)}`;
		const beforeEdit = evaluate(root, [t]);
		assert.equal(seconds(beforeEdit, 't'), 3600);
		t.fieldValues.trackers = `${session('2026-08-01')}; ${session(today, 2)}`;
		assert.equal(seconds(evaluate(root, [t]), 't'), 7200);
		t.fieldValues.trackers = session('2026-08-01');
		assert.deepEqual(ids(evaluate(root, [t])), []);
		assert.equal(seconds(beforeEdit, 't'), 3600);
	});
	test('Tracked on: inherited period reaches Any duration branches', () => {
		const t = task('t', `${session('2026-09-01', 4)}; ${session(today)}`);
		const root = group('all', tracked(), group('any', group('all', tracked('inLastDays', '30'), condition('duration', '7200', 'lt')), tracked('dateIs', '2026-08-01')));
		assert.equal(seconds(evaluate(root, [t]), 't'), 3600);
	});
	test('Tracked on: DST retains local start day and actual elapsed duration', () => {
		const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
		const spring = task('spring', '2026-03-29T00:30:00/2026-03-29T04:30:00');
		const fall = task('fall', '2026-10-25T00:30:00/2026-10-25T04:30:00');
		if (zone === 'Europe/Berlin' || zone === 'UTC') {
			assert.equal(seconds(evaluate(group('all', tracked('isToday')), [spring], [spring], '2026-03-29'), 'spring'), zone === 'Europe/Berlin' ? 10800 : 14400);
			assert.equal(seconds(evaluate(group('all', tracked('isToday')), [fall], [fall], '2026-10-25'), 'fall'), zone === 'Europe/Berlin' ? 18000 : 14400);
		}
	});
	test('Tracked on: relative dates cross year and leap day boundaries', () => {
		for (const [day, previous] of [['2026-01-01', '2025-12-31'], ['2024-03-01', '2024-02-29']]) {
			const t = task('t', `${session(previous)}; ${session(day)}`);
			assert.equal(seconds(evaluate(group('all', tracked('inLastDays', '2')), [t], [t], day), 't'), 7200);
		}
	});
	test('Tracked on: this week uses Monday through Sunday', () => {
		const t = task('t', ['2026-09-20', '2026-09-21', '2026-09-27', '2026-09-28'].map(day => session(day)).join('; '));
		assert.equal(seconds(evaluate(group('all', tracked('thisWeek')), [t]), 't'), 7200);
	});
	test('Tracked on: shared date operators keep their existing semantics', () => {
		const t = task('t', session('2026-09-23'));
		for (const c of [tracked('exactlyDaysAgo', '1'), tracked('underDaysAgo', '2'), tracked('thisMonth'), tracked('dayOfWeekIs', '3'), tracked('monthIs', '9')]) assert.deepEqual(ids(evaluate(group('all', c), [t])), ['t']);
		assert.deepEqual(ids(evaluate(group('all', tracked('underDaysAgo', '2')), [task('today', session(today))])), []);
		assert.equal(isValidTrackedOnCondition(tracked('dayOfWeekIs', '7'), DATE_OPERATORS.map(op => op.id)), false);
	});
	test('Tracked on: duration sort uses scoped values and returns canonical tasks', () => {
		const a = task('a', session(today), { duration: '90000' }); const b = task('b', session(today, 2), { duration: '1' });
		const f = filter(group('all', tracked())); f.sorts = [{ field: 'duration', order: 'desc' }];
		const result = evaluateFilterSetWithTimeScope(f, [a, b], undefined, undefined, undefined, { today });
		assert.deepEqual(result.tasks, [b, a]); assert.equal(result.tasks[0], b);
	});
	test('Tracked on: legacy entrypoints agree on membership and canonical identities', () => {
		const yes = task('yes', session(today)); const no = task('no', session('2026-08-01')); const f = filter(group('all', tracked()));
		assert.deepEqual(evaluateFilterSet(f, [yes, no], undefined, undefined, undefined, { today }), [yes]);
		assert.deepEqual(filterTasksOnly(f, [yes, no], undefined, undefined, { today }), [yes]);
		assert.deepEqual(evaluateFilterSetGrouped(f, [yes, no], undefined, undefined, undefined, { today }).matchedTasks, [yes]);
	});
	test('Tracked on: filters without the condition retain stored duration and identities', () => {
		const t = task('t', session(today), { duration: '12345' });
		const result = evaluate(group('all', condition('duration', '10000', 'gt')), [t]);
		assert.deepEqual(ids(result), ['t']); assert.equal(result.tasks[0], t); assert.equal(result.timeScope, null);
	});
	test('Tracked on: large histories are parsed once per evaluation, not per branch', () => {
		let reads = 0;
		const history = Array.from({ length: 2000 }, () => session(today)).join('; ');
		const t = task('t'); Object.defineProperty(t.fieldValues, 'trackers', { enumerable: false, get: () => { reads++; return history; } });
		const result = evaluate(group('any', ...Array.from({ length: 20 }, () => tracked())), [t]);
		assert.equal(seconds(result, 't'), 2000 * 3600); assert.equal(reads, 1);
	});
}
