import assert from 'node:assert/strict';
import { createTableVirtualRowCache, reconcileTableVirtualRows } from '../src/ui/table/table-virtual-row-reconciler';

/** Operation-count guards: independent of machine speed and timer precision. */
export function testTableRenderWork(): void {
	for (const columnCount of [10, 20, 30]) {
		let tasks = Array.from({ length: 10_000 }, (_, id) => ({ id: String(id), source: `task-${id}.md`, revision: 0 }));
		type Task = typeof tasks[number];
		type Row = { task: Task; cells: number };
		const cache = createTableVirtualRowCache<Row>();
		const host = {};
		let identity = {};
		let rowBuilds = 0;
		let cellBuilds = 0;
		let removed = 0;
		const render = (start: number, forceReset = false) => reconcileTableVirtualRows({
			cache, host, renderIdentity: identity, items: tasks,
			startIndex: start, endIndex: start + 40, forceReset,
			resolveKey: task => task.id,
			createRow: ({ item }) => {
				rowBuilds += 1;
				cellBuilds += columnCount;
				return { task: item, cells: columnCount };
			},
			removeRow: () => { removed += 1; },
		});
		const initial = render(0);
		assert.equal(rowBuilds, 40);
		assert.equal(cellBuilds, 40 * columnCount);
		assert.equal(initial.stats.created, rowBuilds, 'row factory calls match logical additions');
		const scroll = render(20);
		assert.equal(rowBuilds, 60, 'only twenty entering rows are built');
		assert.equal(cellBuilds, 60 * columnCount);
		assert.equal(removed, 20);
		for (let i = 0; i < 20; i++) assert.equal(scroll.entries[i]?.row, initial.entries[i + 20]?.row);
		const unchanged = render(20);
		assert.equal(rowBuilds, 60, 'an unchanged scroll window does no construction');
		assert.equal(unchanged.stats.created, 0);
		assert.equal(unchanged.stats.reused, 40);
		const jump = render(400);
		assert.equal(rowBuilds, 100);
		assert.equal(jump.stats.created, 40);
		assert.equal(jump.stats.removed, 40);
		assert.equal(cache.rows.size, 40, 'the cache stays bounded to the visible range');

		// A save/reindex uses the historical rebuild path, with current source objects.
		tasks = tasks.map(task => ({ ...task, revision: task.revision + 1, source: `new-${task.id}.md` }));
		identity = {};
		const saved = render(400);
		assert.equal(rowBuilds, 140, 'refresh builds one row per displayed task, with no comparison rows');
		assert.equal(cellBuilds, 140 * columnCount);
		assert.equal(saved.stats.reused, 0);
		for (let i = 0; i < 40; i++) {
			assert.equal(saved.entries[i]?.row.task, tasks[i + 400], 'rebuilt rows receive the latest indexed task');
			assert.notEqual(saved.entries[i]?.row, jump.entries[i]?.row);
		}
		const forced = render(400, true);
		assert.equal(rowBuilds, 180);
		assert.equal(forced.stats.created, 40);
		assert.equal(forced.stats.removed, 40);
	}
}
