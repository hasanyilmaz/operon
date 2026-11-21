import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = await mkdtemp(path.join(tmpdir(), 'operon-automation-plan-'));
after(() => rm(temp, { recursive: true, force: true }));
const outfile = path.join(temp, 'helpers.mjs');
// Run the production saved-filter entry point without starting Obsidian.
const source = ts.createSourceFile('main.ts', await readFile(path.join(root, 'main.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
const plugin = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'OperonPlugin');
const savedFilterMethods = ['evaluateAgentRuntimeSavedFilter', 'getTableFilePropertySnapshot'].map(name =>
	plugin.members.find(member => member.name?.getText(source) === name).getText(source)).join('\n');

await build({ stdin: { resolveDir: root, loader: 'ts', contents: `
	import { TFile, TFolder } from 'obsidian';
	import { structuredErrorV1 } from './src/agent-runtime/contracts/v1/primitives';
	import { evaluateFilterSet } from './src/core/filter-evaluator';
	import { savedFilterQueryDigestV1 } from './src/agent-runtime/runtime/settings-fingerprint';
	import { sha256HexV1 } from './src/agent-runtime/contracts/v1/canonical';
	export class SavedFilterHost { ${savedFilterMethods} }
	export { TFile };
	export { createTableFilePropertyIndex, createCachedTableFilePropertyTypeResolver } from './src/ui/table/table-file-property';
	export { projectIndexedNativeProperties } from './src/ui/table/table-native-property';
	export { getNativePropertyIndex } from './src/indexer/native-property-index';
	export { planAutomationChanges } from './src/core/automation-change-plan';
	export { filterTasksOnly } from './src/core/filter-evaluator';
	export { AggregateCoordinator } from './src/systems/aggregate-coordinator';
	export { FilterFieldCatalog } from './src/ui/filter-condition-editor';
	export { parseTaskLine } from './src/core/parser';
	export { DEFAULT_SETTINGS } from './src/types/settings';
` }, bundle: true, format: 'esm', platform: 'node', outfile,
	alias: { obsidian: path.join(root, 'scripts/test-support/obsidian.ts') } });
const { SavedFilterHost, TFile, createTableFilePropertyIndex, createCachedTableFilePropertyTypeResolver, projectIndexedNativeProperties, getNativePropertyIndex,
	planAutomationChanges, filterTasksOnly, AggregateCoordinator, DEFAULT_SETTINGS, parseTaskLine, FilterFieldCatalog } = await import(pathToFileURL(outfile).href);
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
const snapshot = (tasks, extra = {}) => ({ tasks, asOf, conditionFields: sharedFields, pins: new Set(), unavailableIds: new Set(), getDuplicateInstances: () => [], ready: true,
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
test('editor preview returns exact scope, target and changed task IDs from one plan', () => {
	const tasks = Array.from({ length: 281 }, (_, index) => task(String(index), {}, {
		tags: [...(index < 280 ? ['daily'] : []), ...(index < 7 || index === 280 ? ['queue'] : [])],
	}));
	const tags = value => group('all', cond('tags', 'tags', 'anyContains', value));
	const draft = rule('review', [], tags('queue'), tags('daily'));
	const p = plan(tasks, [draft], { includePreviewTaskIds: true });
	const count = p.rules[0];
	assert.deepEqual([count.scope, count.target, count.changed], [280, 7, 0]);
	assert.deepEqual(count.taskIds, { scope: tasks.slice(0, 280).map(t => t.operonId),
		target: tasks.slice(0, 7).map(t => t.operonId), changed: [] });
	assert.equal(p.changedTaskCount, count.taskIds.changed.length);
	assert.ok(!('taskIds' in plan(tasks, [draft]).rules[0]));
});

test('preview deduplicates multiple actions and attributes indirect changes to the owning rule', () => {
	const tasks = [task('parent'), task('child', { parentTask: 'parent' }), task('other')];
	const child = rule('child-rule', [add('estimate', '120'), add('priority', 'High'), add('tags', 'review')], select('child'));
	const other = rule('other-rule', [add('tags', 'review')], select('other'));
	const p = plan(tasks, [child, other], { includePreviewTaskIds: true });
	assert.deepEqual(p.rules[0].taskIds.target, ['child']);
	assert.deepEqual([...p.rules[0].taskIds.changed].sort(), ['child', 'parent']);
	assert.deepEqual(p.rules[1].taskIds.changed, ['other']);
	assert.equal(p.changedTaskCount, 3);
	for (const r of p.rules) for (const key of ['scope', 'target', 'changed']) assert.equal(r[key], r.taskIds[key].length);
});

test('unavailable preview memberships are null, while the known scope remains accessible', () => {
	const tasks = [task('a'), task('b')];
	const unresolved = group('all', cond('missing-field', 'text', 'is', 'value'));
	const draft = rule('review', [add('tags', 'review')], unresolved);
	const ids = ready => plan(tasks, [draft], { includePreviewTaskIds: true, ready }).rules[0].taskIds;
	assert.deepEqual(ids(true), { scope: ['a', 'b'], target: null, changed: null });
	assert.deepEqual(ids(false), { scope: null, target: null, changed: null });
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
test('Project Serial references invalidate nested Any and None branches even when a sibling decides the match', () => {
	const serial = { id: 'ps_live', prefix: 'LIVE', parentOperonId: 'root', createdAt: asOf, updatedAt: asOf };
	const extra = { settings: { ...DEFAULT_SETTINGS, projectSerialScopes: [serial] } };
	for (const tasks of [[], [task('a')]]) for (const section of ['scope', 'target']) {
		for (const [logic, text] of [['any', 'a'], ['none', 'other']]) for (const operator of ['isAnyOf', 'isNoneOf']) {
			const selected = { ...cond('projectSerialScope', 'projectSerialScope', operator), values: ['ps_live', 'ps_deleted'] };
			const predicate = group(logic, cond('description', 'text', 'is', text), group('all', selected));
			const r = { ...rule('r', [add('tags', 'changed')]), [section]: predicate };
			const p = plan(tasks, [r], extra, 'none');
			assert.equal(p.changedTaskCount, null);
			assert.equal(p.rules[0].scope, section === 'scope' ? null : tasks.length);
			assert.equal(p.rules[0].target, null);
			assert.deepEqual(p.changes, []);
			assert.equal(p.issues.filter(i => i.ruleId === 'r' && i.field === section && i.projectSerialGroupId === 'ps_deleted').length, 1);
		}
	}
});

test('Project Serial references leave prefix and membership operators independent of deleted IDs', () => {
	const tasks = [task('a')];
	for (const [operator, count] of [['startsWith', 0], ['doesNotStartWith', 1], ['hasProjectSerialGroup', 0], ['hasNoProjectSerialGroup', 1]]) {
		const condition = { ...cond('projectSerialScope', 'projectSerialScope', operator, 'ABC'), values: ['ps_deleted'] };
		const p = plan(tasks, [rule('r', [add('tags', 'ok')], group('all', condition))]);
		assert.equal(p.changedTaskCount, count);
		assert.deepEqual(p.issues, []);
	}
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

test('managed datetime calendar operators compare the local day while selected timestamps retain time precision', () => {
	const match = (operator, at, value) => {
		const conditions = group('all', cond('datetimeModified', 'datetime', operator, value));
		return filterTasksOnly(filter(conditions), [task('a', { datetimeModified: at })], undefined, undefined,
			{ today: '2026-11-20' }).length === 1;
	};
	for (const time of ['00:00:00', '09:15:00', '23:59:00']) {
		const at = '2026-11-20T' + time;
		for (const [operator, value, expected] of [
			['isToday', '', true], ['notToday', '', false], ['beforeToday', '', false], ['afterToday', '', false],
			['dayOfWeekIs', '5', true], ['dayOfWeekNot', '5', false], ['monthIs', '11', true], ['monthNot', '11', false],
			['dayOfWeekIs', '6', false], ['dayOfWeekNot', '6', true], ['monthIs', '12', false], ['monthNot', '12', true],
		]) assert.equal(match(operator, at, value), expected, [operator, at].join(' '));
	}
	for (const [operator, value, day, expected] of [
		['beforeToday', '', 19, true], ['afterToday', '', 21, true], ['notToday', '', 19, true],
		['exactlyDaysAgo', '2', 18, true], ['exactlyDaysAgo', '2', 19, false],
		['exactlyDaysAway', '2', 22, true], ['exactlyDaysAway', '2', 21, false],
		['underDaysAgo', '2', 18, true], ['underDaysAgo', '2', 17, false], ['underDaysAgo', '2', 20, false],
		['underDaysAway', '2', 22, true], ['underDaysAway', '2', 23, false], ['underDaysAway', '2', 20, false],
		['overDaysAgo', '2', 17, true], ['overDaysAgo', '2', 18, false],
		['overDaysAway', '2', 23, true], ['overDaysAway', '2', 22, false],
		['thisWeek', '', 22, true], ['nextWeek', '', 23, true], ['lastWeek', '', 15, true],
	]) assert.equal(match(operator, '2026-11-' + day + 'T23:59:59', value), expected, [operator, day].join(' '));

	const at = '2026-11-20T09:15:00';
	for (const [operator, target, expected] of [
		['dateIs', at, true], ['dateIs', '2026-11-20T09:16:00', false],
		['before', '2026-11-20T09:16:00', true], ['after', '2026-11-20T09:14:00', true],
		['before', at, false], ['after', at, false],
	]) assert.equal(match(operator, at, target), expected, operator);
	for (const operator of ['isToday', 'notToday', 'dayOfWeekNot', 'monthNot', 'hasAnyValue']) {
		assert.equal(match(operator, '', '1'), false, operator);
	}
	assert.equal(match('hasNoValue', ''), true);
	for (const invalid of ['2026-10-51T09:15:00', '2026-11-19T33:15:00', '2026-10-51T09:15:00Z', '0']) {
		assert.equal(match('isToday', invalid), false, invalid);
		assert.equal(match('notToday', invalid), false, invalid);
	}
});

test('Filters, Runtime saved queries and automation scope and target select identical local calendar dates', t => {
	const previousTZ = process.env.TZ;
	process.env.TZ = 'America/New_York';
	t.after(() => { if (previousTZ === undefined) delete process.env.TZ; else process.env.TZ = previousTZ; });
	t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2027-01-31T12:00:00-05:00') });
	const nativeKey = 'file.property:Review';
	const fields = ['datetimeModified', 'datetimeCreated', 'reviewAt', nativeKey];
	const dates = ['2027-02-01T04:59:00Z', '2027-01-31T20:30:00-10:00', '2027-02-28T23:59:00', ''];
	const tasks = dates.map((at, i) => task('task' + i, { datetimeModified: at, datetimeCreated: at, reviewAt: at },
		{ primary: { filePath: i + '.md', format: 'yaml', lineNumber: 0 } }));
	const files = new Map(tasks.map(item => [item.primary.filePath,
		Object.assign(new TFile(item.primary.filePath), { stat: { mtime: 1, size: 100 } })]));
	const metadata = new Map(tasks.map(item => [item.primary.filePath, { operonId: item.operonId, Review: item.fieldValues.reviewAt }]));
	const app = {
		vault: { getAbstractFileByPath: name => files.get(name), getMarkdownFiles: () => [...files.values()] },
		metadataCache: { getFileCache: file => ({ frontmatter: metadata.get(file.path) }) },
	};
	const settings = { ...DEFAULT_SETTINGS, keyMappings: [...DEFAULT_SETTINGS.keyMappings,
		{ canonicalKey: 'reviewAt', visiblePropertyName: 'Review at', type: 'datetime', isSystem: false }] };
	const registry = { Review: 'datetime' };
	const host = Object.assign(new SavedFilterHost(), {
		settings, indexer: { getAllTasks: () => tasks, getGeneration: () => 1 },
		tableFilePropertyIndex: createTableFilePropertyIndex(app, { typeResolver: createCachedTableFilePropertyTypeResolver(registry) }),
	});
	const base = host.getTableFilePropertySnapshot(tasks);
	const index = getNativePropertyIndex(app);
	t.after(() => index.dispose());
	index.configure(settings);
	index.setTypes(registry);
	for (const [filePath, frontmatter] of metadata) {
		index.accept(filePath, { frontmatter, order: Object.keys(frontmatter), inline: [] }, false);
	}
	const native = projectIndexedNativeProperties(app, base, tasks, settings);
	const clock = '2027-01-31T12:00:00';
	for (const key of fields) {
		for (const [operator, value, expected] of [
			['isToday', '', ['task0']], ['thisWeek', '', ['task0']], ['nextWeek', '', ['task1']],
			['thisMonth', '', ['task0']], ['nextMonth', '', ['task1', 'task2']], ['monthIs', '2', ['task1', 'task2']],
		]) {
			const tree = group('all', cond(key, 'datetime', operator, value));
			const saved = filter(tree);
			const context = [key, operator].join(' ');
			const visible = filterTasksOnly(saved, tasks, undefined, undefined, { today: clock.slice(0, 10), filePropertyContext: base });
			assert.deepEqual(visible.map(item => item.operonId), expected, context);
			host.settings.filterSets = [saved];
			for (const contiguous of [false, true]) {
				const result = host.evaluateAgentRuntimeSavedFilter({ filterSetId: saved.id }, contiguous);
				assert.equal(result.ok, true, context);
				assert.deepEqual(result.tasks.map(item => item.operonId).sort(), expected, context);
			}
			for (const [target, scope] of [[tree, group('all')], [group('all'), tree]]) {
				const result = plan(tasks, [rule('calendar', [add('tags', 'review')], target, scope)], { asOf: clock, settings, native });
				assert.deepEqual(result.changes.filter(change => change.field === 'tags').map(change => change.taskId).sort(), expected, context);
				assert.equal(result.changedTaskCount, expected.length, context);
			}
		}
	}
});
