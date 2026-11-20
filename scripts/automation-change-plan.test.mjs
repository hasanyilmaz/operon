import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = await mkdtemp(path.join(tmpdir(), 'operon-automation-plan-'));
after(() => rm(temp, { recursive: true, force: true }));
const outfile = path.join(temp, 'helpers.mjs');
await build({ stdin: { resolveDir: root, contents: `
	export { planAutomationChanges } from './src/core/automation-change-plan';
	export { filterTasksOnly } from './src/core/filter-evaluator';
	export { AggregateCoordinator } from './src/systems/aggregate-coordinator';
	export { FilterFieldCatalog } from './src/ui/filter-condition-editor';
	export { parseTaskLine } from './src/core/parser';
	export { DEFAULT_SETTINGS } from './src/types/settings';
` }, bundle: true, format: 'esm', platform: 'node', outfile,
	alias: { obsidian: path.join(root, 'scripts/test-support/obsidian.ts') } });
const { planAutomationChanges, filterTasksOnly, AggregateCoordinator, DEFAULT_SETTINGS, parseTaskLine, FilterFieldCatalog } = await import(pathToFileURL(outfile).href);
const sharedFields = new Map(new FilterFieldCatalog({ keyMappings: DEFAULT_SETTINGS.keyMappings, getRootGroup: () => undefined })
	.getFieldOptions(true).map(option => [option.field, option.type]));
const asOf = '2026-11-20T10:20:30';
const forbidden = new Proxy({}, { get() { throw Error('Access outside the snapshot'); } });
const aggregates = new AggregateCoordinator(forbidden, forbidden);
const task = (id, fieldValues = {}, extra = {}) => ({ operonId: id, description: id, checkbox: 'open',
	tags: [], fieldValues, primary: { filePath: id + '.md', format: 'inline', lineNumber: 1 }, datetimeModified: '2026-11-19T12:00:00', tier: 'hot', ...extra });
const group = (logic, ...children) => ({ id: 'g', logic, children });
const cond = (field, fieldType, operator, value) => ({ id: field, field, fieldType, operator, value });
const select = id => group('all', cond('description', 'text', 'is', id));
const add = (field, value) => ({ id: '+' + field + JSON.stringify(value), field, value, operation: 'add' });
const del = (field, value) => ({ ...add(field, value), id: '-' + field + JSON.stringify(value), operation: 'remove' });
const rule = (id, actions = [], target = group('all'), scope = group('all')) =>
	({ id, name: id, actions, target, scope, active: false, mode: 'manual' });
const snapshot = (tasks, extra = {}) => ({ tasks, asOf, conditionFields: sharedFields, pins: new Set(), unavailableIds: new Set(), ready: true,
	activeTimerId: null, getFrontmatter: () => null, fileRenameState: () => 'unknown', getRepeatSkipDates: () => [], settings: DEFAULT_SETTINGS,
	projectAggregates: (graph, ids) => aggregates.projectAutomationAggregateFields(graph, ids, true), ...extra });
const plan = (tasks, rules, extra = {}, limit = 'always') => planAutomationChanges(snapshot(tasks, extra), rules, limit);
const field = (result, id, key) => result.changes.find(item => item.taskId === id && item.field === key);
const filter = rootGroup => ({ rootGroup, conditions: [], sorts: [], matchLogic: 'all', id: 'f', name: 'F' });

test('inactive drafts, empty Scope/Target and zero-action limits', () => {
	const p = plan([task('a'), task('b')], [rule('r')]);
	assert.deepEqual(p.rules, [{ ruleId: 'r', scope: 2, target: 2, changed: 0 }]);
	assert.equal(p.changedTaskCount, 0);
	assert.equal(p.needsConfirmation, false);
});
test('nested Filters parity uses one day, complete hierarchy and a scoped target', () => {
	const tasks = [task('root'), task('middle', { parentTask: 'root' }), task('leaf', { parentTask: 'middle', dateDue: asOf.slice(0, 10) })];
	const scope = group('any', cond('dateDue', 'date', 'isToday'), cond('description', 'text', 'is', 'middle'));
	const target = group('all', cond('projectTree', 'projectTree', 'matchesTree', 'root'), group('none', cond('description', 'text', 'is', 'middle')));
	const f = tree => filterTasksOnly(filter(tree), tasks, undefined, undefined, { today: asOf.slice(0, 10) });
	const p = plan(tasks, [rule('r', [], target, scope)]);
	assert.equal(p.rules[0].scope, f(scope).length);
	assert.equal(p.rules[0].target, f(target).filter(t => f(scope).includes(t)).length);
	assert.equal(p.rules[0].target, 1);
});
test('no chains, distinct global totals and identical effects attributed to both rules', () => {
	const p = plan([task('a')], [rule('a', [add('priority', 'High'), add('tags', 'follow')]), rule('b', [add('tags', 'follow')]),
		rule('c', [add('note', 'chain')], group('all', cond('priority', 'text', 'is', 'High')))]);
	assert.deepEqual(p.rules.map(r => r.changed), [1, 1, 0]);
	assert.equal(p.changedTaskCount, 1);
	assert.equal(field(p, 'a', 'tags').origins.length, 2);
});
test('opposite intents within and across rules skip the entire task, even when one intent was a no-op', () => {
	for (const rules of [[rule('a', [add('tags', 'x'), del('tags', 'x'), add('note', 'n')], select('a'))],
		[rule('a', [add('priority', 'High')], select('a')), rule('b', [add('priority', 'Low'), add('note', 'n')], select('a'))]]) {
		const p = plan([task('a', { priority: 'Low' }), task('b')], [...rules, rule('other', [add('tags', 'y')], select('b'))]);
		assert.equal(p.changedTaskCount, 1);
		assert.ok(p.changes.every(c => c.taskId === 'b'));
		assert.equal(p.issues.find(i => i.reason === 'conflict').origins.length, 2);
	}
});
test('lists preserve unrelated members and scalars clear only when equal', () => {
	const p = plan([task('a', { priority: 'Low', note: 'hello' }, { tags: ['one', 'old', 'two'] })],
		[rule('r', [add('tags', ['one', 'new']), del('tags', 'old'), del('priority', 'High'), del('note', 'hello')])]);
	assert.deepEqual(field(p, 'a', 'tags').after, ['one', 'two', 'new']);
	assert.equal(field(p, 'a', 'note').after, null);
	assert.equal(field(p, 'a', 'priority'), undefined);
});
test('reciprocal dependencies count both ends and repair half-links without redundant changes', () => {
	for (const [a, b, ids] of [[{}, {}, ['a', 'b']], [{ blocking: 'b' }, {}, ['b']], [{}, { blockedBy: 'a' }, ['a']]]) {
		const p = plan([task('a', a), task('b', b)], [rule('rel', [add('blocking', 'b')], select('a'))]);
		assert.equal(p.rules[0].target, 1);
		assert.equal(p.rules[0].changed, ids.length);
		assert.deepEqual([...new Set(p.changes.map(c => c.taskId))].sort(), ids);
	}
});
test('a conflict on the peer suppresses both halves, while independent work can continue', () => {
	const p = plan([task('a'), task('b')], [rule('link', [add('blocking', 'b'), add('note', 'ok')], select('a')),
		rule('bad', [add('priority', 'Low'), add('priority', 'High')], select('b'))]);
	assert.deepEqual(p.changes.map(c => c.field).sort(), ['datetimeModified', 'note']);
});
test('a cycle introduced jointly rejects its edges together', () => {
	const tasks = ['a', 'b', 'c'].map(id => task(id));
	const rules = tasks.map((t, i) => rule(t.operonId, [add('blocking', tasks[(i + 1) % 3].operonId)], select(t.operonId)));
	const p = plan(tasks, rules);
	assert.equal(p.changedTaskCount, 0);
	assert.ok(p.issues.some(i => i.reason === 'invalid-relation'));
});
test('blocker protects status, keeps target and other actions, and permits first schedule', () => {
	const tasks = [task('a', { blockedBy: 'b' }), task('b')];
	const p = plan(tasks, [rule('r', [add('status', 'Project.Finished'), add('tags', 'follow')], select('a'))]);
	assert.deepEqual(p.rules[0], { ruleId: 'r', target: 1, scope: 2, changed: 1 });
	assert.equal(field(p, 'a', 'status'), undefined);
	assert.ok(p.issues.some(i => i.reason === 'blocked'));
	const s = plan(tasks, [rule('s', [add('dateScheduled', '2026-11-22')], select('a'))]);
	assert.equal(field(s, 'a', 'status').after, 'Project.Planned');
});
test('a newly proposed dependency protects the same transition', () => {
	const p = plan([task('a'), task('b')], [rule('r', [add('blockedBy', 'b'), add('status', 'Project.Finished')], select('a'))]);
	assert.equal(p.changedTaskCount, 2);
	assert.ok(p.issues.some(i => i.reason === 'blocked'));
	assert.equal(field(p, 'a', 'checkbox'), undefined);
});
test('joint schedule inputs derive duration independent of action order', () => {
	const actions = [add('datetimeStart', '2026-11-20T09:00'), add('datetimeEnd', '2026-11-20T10:00')];
	for (const list of [actions, [...actions].reverse()]) {
		const p = plan([task('a')], [rule('r', list)]);
		assert.equal(field(p, 'a', 'estimate').after, 3600);
		assert.equal(field(p, 'a', 'datetimeEnd').after, '2026-11-20T10:00:00');
	}
});
test('parent aggregates and timestamp count as one indirect task', () => {
	const tasks = [task('parent', { dateDue: '2026-11-20' }), task('child', { parentTask: 'parent' })];
	const p = plan(tasks, [rule('r', [add('dateDue', '2026-11-25'), add('estimate', '120')], select('child'))]);
	assert.equal(p.rules[0].target, 1);
	assert.equal(p.changedTaskCount, 2);
	assert.equal(field(p, 'parent', 'dateDue').after, '2026-11-25');
	assert.equal(field(p, 'parent', 'datetimeModified').after, asOf);
	assert.equal(field(p, 'parent', 'totalEstimate').indirect, true);
});
test('unknown inputs withhold an exact threshold for every confirmation preference', () => {
	for (const limit of ['always', 5, 'none']) {
		const p = plan([task('a')], [rule('r', [add('note', 'x')])], { unavailableIds: new Set(['a']) }, limit);
		assert.equal(p.changedTaskCount, null);
		assert.equal(p.needsConfirmation, null);
	}
});
test('real threshold is strictly greater; no limit never asks on a complete calculation', () => {
	for (const limit of [5, 10, 15, 20, 25, 50, 100]) {
		const tasks = Array.from({ length: limit + 1 }, (_, i) => task('task' + i));
		assert.equal(plan(tasks.slice(1), [rule('r', [add('tags', 'x')])], {}, limit).needsConfirmation, false);
		assert.equal(plan(tasks, [rule('r', [add('tags', 'x')])], {}, limit).needsConfirmation, true);
	}
	assert.equal(plan([task('a')], [rule('r', [add('tags', 'x')])], {}, 'none').needsConfirmation, false);
});
test('actual inline and file row identities select typed native cells; missing is distinct from unavailable', () => {
	const key = 'file.property:Budget';
	const tasks = [task('i'), task('f', {}, { primary: { filePath: 'f.md', format: 'yaml' } })];
	const native = { fields: [{ key, type: 'number' }], getCell: t => ({ nativeState: 'ready', present: t.operonId === 'f', rawValue: t.operonId === 'f' ? 5 : undefined }) };
	const r = rule('r', [add(key, '5.00')]);
	const p = plan(tasks, [r], { native });
	assert.equal(p.changedTaskCount, 1);
	assert.equal(field(p, 'i', key).after, 5);
	const d = plan(tasks, [rule('r', [del(key, '5')])], { native });
	assert.equal(field(d, 'f', key).after, null);
	const unknown = { ...native, getCell: () => ({ readOnlyReason: 'unavailable', nativeState: 'unsupported', present: false }) };
	assert.equal(plan(tasks, [r], { native: unknown }).needsConfirmation, null);
	assert.equal(plan(tasks, [rule('r', [add('note', 'x')], group('none', cond(key, 'number', 'eq', '1')))], { native: unknown }).needsConfirmation, null);
});
test('read-only, invalid and unknown properties return separate explanations', () => {
	const p = plan([task('a')], [rule('r', [add('trackedOn', 'x'), add('estimate', 'oops'), add('file.property:Missing', 'x')])]);
	assert.deepEqual(p.issues.map(i => i.reason), ['read-only', 'invalid-value', 'source-unavailable']);
});
test('two identical calculations preserve frozen task data, files and settings', async () => {
	const original = '- [ ] demo #existing {{operonId:: demo001}}\n';
	const filename = path.join(temp, 'Demo.md');
	await writeFile(filename, original);
	const parsed = parseTaskLine((await readFile(filename, 'utf8')).trim(), 0, filename, DEFAULT_SETTINGS.keyMappings);
	assert.equal(parsed.operonId, 'demo001');
	const t = task(parsed.operonId, Object.freeze(Object.fromEntries(parsed.fields.map(f => [f.key, f.value]))),
		{ description: parsed.description, tags: Object.freeze(parsed.tags), primary: Object.freeze({ filePath: filename, format: 'inline', lineNumber: 0 }) });
	const ctx = snapshot(Object.freeze([Object.freeze(t)]));
	const rules = [rule('r', [add('tags', 'follow'), add('priority', 'High')])];
	const settingsBefore = JSON.stringify(ctx.settings);
	const first = planAutomationChanges(ctx, rules, 'always');
	assert.deepEqual(planAutomationChanges(ctx, rules, 'always'), first);
	assert.equal(first.changedTaskCount, 1);
	assert.equal(await readFile(filename, 'utf8'), original);
	assert.equal(JSON.stringify(ctx.settings), settingsBefore);
});

test('managed custom fields compare typed values and handle empty and malformed sources separately', () => {
	const settings = { ...DEFAULT_SETTINGS, keyMappings: [...DEFAULT_SETTINGS.keyMappings,
		{ canonicalKey: 'points', visiblePropertyName: 'Points', type: 'number', isSystem: false }] };
	const p = plan([task('a', { points: '01' }), task('b'), task('c', { points: 'bad' })], [rule('r', [add('points', '1')])], { settings });
	assert.equal(field(p, 'a', 'points'), undefined);
	assert.equal(field(p, 'b', 'points').after, 1);
	assert.equal(p.changedTaskCount, null);
	assert.ok(p.issues.some(i => i.reason === 'source-unavailable' && i.taskId === 'c'));
});
test('a YAML list with an ambiguous member cannot be planned as two separate values', () => {
	const t = task('file001', { assignees: 'one; two' }, { primary: { format: 'yaml', filePath: 'Task.md' } });
	const r = rule('r', [add('assignees', 'new')]);
	for (const raw of [null, { operonId: 'file001', assignees: ['one; two'] }]) {
		const p = plan([t], [r], { getFrontmatter: () => raw });
		assert.equal(p.changedTaskCount, null);
	}
	const p = plan([t], [r], { getFrontmatter: () => ({ operonId: 'file001', assignees: ['one', 'two'] }) });
	assert.deepEqual(field(p, 'file001', 'assignees').after, ['one', 'two', 'new']);
});
test('parent link inheritance, relocation and aggregate conflicts use the existing policies', () => {
	const settings = { ...DEFAULT_SETTINGS, inheritPropertiesOnParentLink: true, childTaskInheritanceFields: ['priority', 'tags'] };
	const tasks = [task('child'), task('parent', { priority: 'High' }, { tags: ['inherit'] })];
	const actions = [add('parentTask', 'parent')];
	const p = plan(tasks, [rule('r', actions, select('child'))], { settings });
	assert.equal(field(p, 'child', 'priority').after, 'High');
	assert.deepEqual(field(p, 'child', 'tags').after, ['inherit']);
	const move = plan(tasks, [rule('r', actions, select('child'))], { settings: { ...settings, keepInlineTasksWithParent: true } });
	assert.equal(move.changedTaskCount, null);
	const conflict = plan(tasks, [rule('r', [...actions, del('tags', 'inherit')], select('child'))], { settings });
	assert.equal(conflict.changedTaskCount, 0);
	assert.ok(conflict.issues.some(i => i.reason === 'conflict'));
});
test('an explicit unchanged parent due date conflicts with a projected expansion', () => {
	const tasks = [task('child', { parentTask: 'parent' }), task('parent', { dateDue: '2026-11-21' })];
	const p = plan(tasks, [rule('parent-date', [add('dateDue', '2026-11-21')], select('parent')),
		rule('child-date', [add('dateDue', '2026-11-25')], select('child'))]);
	assert.equal(p.changedTaskCount, 0);
	assert.deepEqual(new Set(p.issues.find(i => i.reason === 'conflict').origins.map(o => o.ruleId)), new Set(['child-date', 'parent-date']));
});
test('unknown pin or timer effects cannot supply an exact approval count', () => {
	const r = rule('done', [add('status', 'Project.Finished')]);
	for (const extra of [{ pins: null }, { activeTimerId: undefined }, { activeTimerId: 'a' }]) {
		const p = plan([task('a')], [r], { ...extra, settings: { ...DEFAULT_SETTINGS, pinnedDockAutoUnpinFinished: true } });
		assert.equal(p.needsConfirmation, null);
	}
	const p = plan([task('a')], [r], { pins: new Set(['a']), settings: { ...DEFAULT_SETTINGS, pinnedDockAutoUnpinFinished: true } });
	assert.equal(field(p, 'a', 'pinned').after, false);
});
test('native lists distinguish number and text members; invalid dates and unsupported state are reported', () => {
	const key = 'file.property:Items';
	const native = { fields: [{ key, type: 'list' }], getCell: () => ({ nativeState: 'ready', present: true, rawValue: [1, '1', 'a;b'] }) };
	const p = plan([task('a')], [rule('r', [del(key, '1'), add(key, '"other;member"'), add('dateDue', '2026-02-30')])], { native });
	assert.deepEqual(field(p, 'a', key).after, ['1', 'a;b', 'other;member']);
	assert.ok(p.issues.some(i => i.reason === 'invalid-value' && i.field === 'dateDue'));
});
test('a filename collision skips the rename; unknown link rewrite effects withhold the exact count', () => {
	const tasks = ['a', 'b'].map(id => task(id, {}, { primary: { filePath: id + '.md', format: 'yaml' } }));
	const r = rule('rename', [add('description', 'New')]);
	const p = plan(tasks, [r], { fileRenameState: () => 'available' });
	assert.equal(p.changedTaskCount, 0);
	assert.ok(p.issues.some(i => i.field === 'sourcePath' && i.reason === 'conflict'));
	assert.equal(plan(tasks, [r]).needsConfirmation, null);
});

test('derived first schedule obeys the scheduled-status exception even with a blocker', () => {
	const p = plan([task('a', { blockedBy: 'b' }), task('b')],
		[rule('r', [add('datetimeStart', '2026-11-21T08:00')], select('a'))]);
	assert.equal(field(p, 'a', 'dateScheduled').after, '2026-11-21');
	assert.equal(field(p, 'a', 'status').after, 'Project.Planned');
	assert.equal(p.changedTaskCount, 1);
});
test('tracked time and pinned scopes agree with Filters on the same complete snapshot', () => {
	const tasks = [task('root'), task('child', { parentTask: 'root', trackers: '2026-11-20T08:00:00/2026-11-20T09:00:00' })];
	const pins = new Set(['child']);
	const target = group('all', cond('trackedOn', 'date', 'isToday'), cond('pinned', 'pinned', 'isPinned'));
	const matches = filterTasksOnly(filter(target), tasks, undefined, { isPinned: id => pins.has(id) }, { today: asOf.slice(0, 10) });
	assert.equal(matches.length, 1);
	assert.equal(plan(tasks, [rule('r', [], target)], { pins }).rules[0].target, matches.length);
});
test('unavailable conditions return unknown counters, including in inactive drafts', () => {
	const condition = group('all', cond('file.property:missing', 'number', 'eq', '1'));
	const p = plan([task('a')], [rule('r', [], condition)]);
	assert.deepEqual(p.rules[0], { ruleId: 'r', scope: 1, target: null, changed: 0 });
	assert.equal(p.changedTaskCount, 0);
	assert.equal(plan([task('a')], [rule('r', [add('tags', 'x')], condition)]).changedTaskCount, null);
});
test('a blocker reopened by checkbox or terminal date protects its dependent in the same batch', () => {
	const tasks = [task('b', { status: 'Project.Finished', dateCompleted: '2026-11-19', blocking: 'a' }, { checkbox: 'done' }), task('a')];
	for (const reopen of [add('checkbox', 'open'), del('dateCompleted', '2026-11-19')]) {
		const p = plan(tasks, [rule('finish', [add('status', 'Project.Finished'), add('tags', 'follow')], select('a')),
			rule('reopen', [reopen], select('b'))]);
		assert.ok(p.issues.some(i => i.taskId === 'a' && i.reason === 'blocked'));
		assert.equal(field(p, 'a', 'status'), undefined);
		assert.deepEqual(field(p, 'a', 'tags').after, ['follow']);
		assert.equal(field(p, 'b', 'status').after, 'Project.Brainstorming');
	}
});
