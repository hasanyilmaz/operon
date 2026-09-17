import assert from 'node:assert/strict';
import type { IndexedTask } from '../src/types/fields';
import { DEFAULT_SETTINGS } from '../src/types/settings';
import { createDefaultTablePreset, type TableSortDirection } from '../src/types/table';
import { queryTableRows, sortTableTaskTreeSiblings } from '../src/systems/table-query';
import { createTableValueResolver } from '../src/ui/table/table-value-cache';
import { compareTableSourceOrder } from '../src/ui/table/table-value-adapter';
import { evaluateTableSummaryCell } from '../src/ui/table/table-summary';
import { buildTableNoSearchResultCacheKey } from '../src/ui/table/table-search';
import { buildTableGanttTimelineLayout } from '../src/ui/table/table-gantt-renderer';
import { beginTableLoadPerformance } from '../src/ui/table/table-load-performance';

function task(id: string, fields: Record<string, string> = {}, checkbox: IndexedTask['checkbox'] = 'open'): IndexedTask {
	return {
		operonId: id, description: id, checkbox, fieldValues: fields, tags: [],
		primary: { filePath: 'Table fixtures.md', lineNumber: Number(id.replace(/\D/g, '')) || 0, format: 'inline' },
		datetimeModified: '2026-09-17T12:00:00', tier: 'hot',
	};
}

/** Deterministic work and semantics checks; no wall-clock acceptance thresholds. */
export function testTableSwitchWork(): void {
	const settings = structuredClone(DEFAULT_SETTINGS);
	const values = ['Task 10', 'Task 2', 'task 2', 'Ä', 'a', 'İ', 'ı', 'ß', 'ss', 'É', '', 'Z'];
	const tasks = Array.from({ length: 200 }, (_, i) => ({ ...task(`task-${i}`), description: values[(i * 7) % values.length]! }));
	for (const direction of ['asc', 'desc'] as TableSortDirection[]) {
		for (const empty of ['first', 'last'] as const) {
			const preset = createDefaultTablePreset();
			preset.sortRules = [{ key: 'description', direction, empty }];
			const expected = [...tasks].sort((a, b) => {
				if (!a.description || !b.description) {
					if (!a.description && !b.description) return compareTableSourceOrder(a, b);
					return (!a.description ? -1 : 1) * (empty === 'first' ? 1 : -1);
				}
				const result = a.description.localeCompare(b.description, undefined, { numeric: true, sensitivity: 'base' });
				return (direction === 'desc' ? -result : result) || compareTableSourceOrder(a, b);
			});
			let mappingReads = 0;
			const querySettings = { get keyMappings() { mappingReads++; return settings.keyMappings; }, pipelines: settings.pipelines };
			const result = queryTableRows({ preset, filterSet: null, tasks, priorities: settings.priorities, settings: querySettings });
			assert.deepEqual(result.rows.map(row => row.operonId), expected.map(row => row.operonId));
			assert.equal(result.valueResolver.getStats().sortHits, 0, 'sort values are resolved once per accessed task and rule');
			assert.ok(result.valueResolver.getStats().sortMisses <= tasks.length);
			assert.ok(mappingReads < 30, 'field type resolution does not scale with comparator calls');
		}
	}

	let singletonMappingReads = 0;
	const singletonSettings = { get keyMappings() { singletonMappingReads++; return settings.keyMappings; }, pipelines: settings.pipelines };
	const singletonResolver = createTableValueResolver(tasks, settings);
	const singletonRules = ['description', 'estimate', 'note', 'links', 'assignees', 'tags', 'dateDue', 'parentTask', 'priority'].map(key => ({ key, direction: 'asc' as const, empty: 'last' as const }));
	for (const siblings of [[], [tasks[0]!]]) {
		assert.deepEqual(sortTableTaskTreeSiblings(siblings, singletonRules, singletonResolver, settings.priorities, singletonSettings), siblings);
	}
	assert.equal(singletonMappingReads, 0, 'singleton tree groups prepare no field comparators');
	assert.equal(singletonResolver.getStats().sortMisses, 0);

	const rows = [task('open', { estimate: '10' }), task('done', { estimate: '20' }, 'done'), task('cancelled', {}, 'cancelled')];
	let rawReads = 0;
	const valueResolver = { getRawValue: () => { rawReads++; throw new Error('unnecessary field read'); } };
	assert.equal(evaluateTableSummaryCell({ rows, allTasks: rows, settings, valueResolver, rule: { key: 'description', function: 'Count' } })?.value, '3');
	assert.equal(evaluateTableSummaryCell({ rows, allTasks: rows, settings, valueResolver, rule: { key: 'status', function: 'CompletionRate' } })?.value, '50%');
	assert.equal(rawReads, 0);
	const preset = createDefaultTablePreset();
	preset.groupBy = 'checkbox';
	preset.summaries = [{ key: 'description', function: 'Count' }, { key: 'estimate', function: 'Sum' }];
	const options = { preset, filterSet: null, tasks: rows, priorities: settings.priorities, settings };
	const visible = queryTableRows({ ...options, summaryKeys: new Set(['description']) });
	assert.ok(!visible.summaries.has('estimate'));
	assert.equal(visible.summaries.get('description')?.value, '3');
	for (const summaries of visible.groupSummaries.values()) assert.ok(!summaries.has('estimate'));
	assert.deepEqual(visible.preset.summaries, preset.summaries, 'hidden summary configuration is preserved');
	const revealed = queryTableRows({ ...options, summaryKeys: new Set(['description', 'estimate']) });
	assert.equal(revealed.summaries.get('estimate')?.value, '30s');
	assert.equal(queryTableRows(options).summaries.get('estimate')?.value, '30s', 'omitted selection preserves query defaults');
	assert.equal(queryTableRows({ ...options, summaryKeys: new Set() }).summaries.size, 0);
	const edited = rows.map(row => ({ ...row, fieldValues: { ...row.fieldValues, estimate: '40' } }));
	assert.equal(queryTableRows({ ...options, tasks: edited }).summaries.get('estimate')?.value, '2m 0s');
	const columns = [{ key: 'description', kind: 'task' as const }, { key: 'estimate', kind: 'task' as const, hidden: true }];
	assert.notEqual(buildTableNoSearchResultCacheKey('scope', columns, preset), buildTableNoSearchResultCacheKey('scope', columns.map(column => ({ ...column, hidden: false })), preset));

	let parentReads = 0;
	const parent = task('parent');
	const child = task('child', {}, 'done');
	Object.defineProperty(child.fieldValues, 'parentTask', { enumerable: true, get: () => { parentReads++; return 'parent'; } });
	const resolver = createTableValueResolver([parent, child], settings);
	assert.equal(parentReads, 0, 'creating a value resolver does not construct the progress graph');
	assert.equal(resolver.getRawValue(child, 'description'), 'child');
	assert.equal(parentReads, 0, 'unrelated columns do not construct the progress graph');
	assert.equal(resolver.getProgressTrack(parent, 'subtasks')?.percent, 100);
	assert.equal(parentReads, 1);
	assert.equal(resolver.getProgressTrack(parent, 'subtasks')?.percent, 100);
	assert.equal(parentReads, 1, 'progress graph is reused within this resolver');

	const dateTasks = [task('date-1', { dateScheduled: '2024-02-29', dateDue: '2024-03-02' }), task('date-2', { dateScheduled: '2026-12-31' })];
	const item = (value: IndexedTask) => ({ kind: 'task' as const, task: value, groupKey: null, ordinalKey: value.operonId });
	for (const scale of ['day', 'week'] as const) {
		for (const calendarWeekStart of ['monday', 'sunday'] as const) {
			const layoutOptions = { gantt: { ...preset.gantt, scale }, calendarWeekStart, viewportWidth: 800, today: '2026-09-17', anchorDate: '2023-01-01' };
			const unique = buildTableGanttTimelineLayout({ ...layoutOptions, items: dateTasks.map(item) });
			const repeated = buildTableGanttTimelineLayout({ ...layoutOptions, items: Array.from({ length: 1000 }, (_, i) => item({ ...dateTasks[i % 2]!, operonId: `repeated-${i}` })) });
			assert.deepEqual(repeated.axis, unique.axis, 'repeated dates preserve full axis, week boundaries and anchors');
			assert.equal(repeated.earliestTaskDate, unique.earliestTaskDate);
		}
	}

	let now = 0;
	let frames = 0;
	const logs: Array<Record<string, number | string>> = [];
	const trace = beginTableLoadPerformance('table.render.detail', {} as Window, {
		isEnabled: () => true, now: () => now, scheduleFrame: () => { frames++; }, emit: (_label, data) => logs.push(data),
	})!;
	trace.setContext({ presetId: 'test-preset', rows: 200 });
	now = 3; trace.mark('query');
	now = 7; trace.mark('visibleRows');
	trace.finish('loaded', () => true);
	assert.equal(logs[0]?.traceId, trace.id);
	assert.equal(logs[0]?.presetId, 'test-preset');
	assert.equal(logs[0]?.queryMs, 3);
	assert.equal(logs[0]?.visibleRowsMs, 4);
	assert.equal(frames, 0, 'render diagnostics do not schedule extra animation frames');
}
