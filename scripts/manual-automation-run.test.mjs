import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const tmp = await mkdtemp(path.join(tmpdir(), 'operon-manual-rule-'));
after(() => rm(tmp, { recursive: true, force: true }));
const out = path.join(tmp, 'helpers.mjs');
await build({ stdin: { resolveDir: root, contents: `
	export { TFile, parseYaml } from 'obsidian';
	export { deactivateAutomationRules, ManualAutomationRunner } from './src/systems/manual-automation-run';
	export { captureAutomationReadState } from './src/systems/automation-read-state';
	export { prepareAutomationWork } from './src/systems/automation-task-writes';
	export { automationApprovalModal } from './src/ui/manual-automation-feedback';
	export { TaskWriter } from './src/core/task-writer';
	export { PinnedCache } from './src/storage/pinned-cache';
	export { planAutomationChanges } from './src/core/automation-change-plan';
	export { AggregateCoordinator } from './src/systems/aggregate-coordinator';
	export { DEFAULT_SETTINGS } from './src/types/settings';
	export { scanFileWithMappings } from './src/indexer/file-scanner';
` }, outfile: out, banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" }, bundle: true, format: 'esm', platform: 'node',
	plugins: [{ name: 'fixture', setup(builder) {
		builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'fixture' }));
		builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ resolveDir: root,
			contents: "export * from './scripts/test-support/obsidian'; export { parse as parseYaml, stringify as stringifyYaml } from 'yaml';" }));
	} }] });
const { TFile, parseYaml, deactivateAutomationRules, ManualAutomationRunner, captureAutomationReadState, prepareAutomationWork, automationApprovalModal,
	TaskWriter, PinnedCache, planAutomationChanges, AggregateCoordinator, DEFAULT_SETTINGS, scanFileWithMappings } = await import(pathToFileURL(out).href);
const asOf = '2026-11-20T12:45:00';
const ruleId = 'rule-a';
const all = { id: 'root', logic: 'all', children: [] };
const action = (field, value, operation = 'add') => ({ id: field + operation, field, value, operation });
const inline = (id, tail = '') => '- [ ] ' + id + ' {{operonId:: ' + id + '}}' + tail + '\n';
const id = n => 'task' + String(n).padStart(3, '0');
const filesFor = n => Object.fromEntries(Array.from({ length: n }, (_, i) => [id(i) + '.md', inline(id(i))]));
const rootGroup = (field, fieldType, operator, value) => ({ ...all, children: [{ id: field, field, fieldType, operator, value }] });

async function fixture(files, opts = {}) {
	const dir = await mkdtemp(path.join(tmp, 'vault-'));
	const rule = { id: ruleId, name: 'Follow up', mode: 'manual', active: true, actions: [action('tags', 'follow')], scope: all, target: all, ...opts.rule };
	const config = { version: 1, rules: [rule], confirmation: opts.policy ?? 'always' };
	const settings = { ...structuredClone(DEFAULT_SETTINGS), ...opts.settings };
	let permit, pinData = { version: 1, itemsById: {} };
	const records = new Map(), tasks = new Map(), frontmatter = new Map(), listeners = new Map();
	const f = { writes: [], prompts: [], config, rule, tasks, refreshes: 0, known: true };
	const vault = {
		getAbstractFileByPath: name => records.get(name),
		read: file => readFile(path.join(dir, file.path), 'utf8'),
		on: (event, cb) => { const set = listeners.get(event) ?? new Set(); listeners.set(event, set); set.add(cb); return [set, cb]; },
		offref: ([set, cb]) => set.delete(cb),
		process: async (file, update) => {
			await f.beforeProcess?.(file);
			const next = update(await vault.read(file));
			if (f.reject === file.path) throw Error('simulated failed write');
			await writeFile(path.join(dir, file.path), next);
			f.writes.push(file.path);
			for (const notify of listeners.get('modify') ?? []) notify(file);
			if (f.loseAck === file.path) throw Error('simulated lost acknowledgement');
			if (f.unknown === file.path) { await writeFile(path.join(dir, file.path), next + 'another edit'); throw Error('indeterminate'); }
			return next;
		},
	};
	const app = { vault, metadataCache: { resolvedLinks: {} }, fileManager: { renameFile: async (file, name) => {
		await rename(path.join(dir, file.path), path.join(dir, name)); records.delete(file.path); file.path = name; records.set(name, file);
	} } };
	for (const [name, value] of Object.entries(files)) {
		const file = new TFile(name); file.stat = { mtime: 0, ctime: 0, size: Buffer.byteLength(value) }; records.set(name, file);
		await writeFile(path.join(dir, name), value);
		const scan = await scanFileWithMappings(app, file, settings.keyMappings);
		for (const task of scan.inlineTasks) tasks.set(task.operonId, { ...task, tier: 'hot', datetimeModified: '',
			fieldValues: Object.fromEntries(task.fields.map(field => [field.key, field.value])),
			primary: { filePath: name, format: 'inline', lineNumber: task.lineNumber } });
		if (scan.yamlTask) {
			const task = scan.yamlTask;
			tasks.set(task.operonId, { ...task, tier: 'hot', checkbox: 'open', datetimeModified: task.fieldValues.datetimeModified ?? '',
				primary: { filePath: name, format: 'yaml', lineNumber: 0 } });
			frontmatter.set(task.operonId, parseYaml(value.split('---')[1]));
		}
	}
	const pins = new PinnedCache(null, null);
	pins.setPackagePersistence({ canPersist: () => !f.pinStateUnknown, getPackage: () => structuredClone(pinData),
		updatePackage: async (apply, guard) => { if (guard && !guard()) throw Error('expired'); const next = apply(pinData);
			await writeFile(path.join(dir, 'pins.json'), JSON.stringify(next));
			if (f.losePinAuthority) { f.pinStateUnknown = true; throw Error('Unreadable pin acknowledgement'); }
			pinData = next; return structuredClone(next); } });
	await pins.load();
	const idx = { getGeneration: () => 1, getLiveReadAuthoritySnapshot: () => ({ settled: true }), isIndexedSourceCurrent: () => true,
		subscribeIndexReconciliation: () => () => {}, getTask: key => tasks.get(key) };
	const writer = new TaskWriter(app, idx, settings.keyMappings, { getInlinePropertyDefinitions: () => settings.inlinePropertyDefinitions });
	const aggregates = new AggregateCoordinator({}, {});
	const ports = { available: () => true, now: () => asOf, settings: () => structuredClone(config),
		plan: (saved, policy) => planAutomationChanges({ tasks: [...tasks.values()], settings, asOf, ready: f.known,
			conditionFields: new Map([['description', 'text'], ['pinned', 'pinned']]), pins: new Set(pins.getPinnedIds()), activeTimerId: null,
			unavailableIds: new Set(), getFrontmatter: t => frontmatter.get(t.operonId), getRepeatSkipDates: () => [], native: f.native,
			fileRenameState: (_, dest) => records.has(dest) ? 'occupied' : 'available',
			projectAggregates: (graph, ids) => aggregates.projectAutomationAggregateFields(graph, ids, true),
		}, [saved], policy),
		prepare: async plan => {
			const work = await prepareAutomationWork(plan, { app, writer, settings, pins, native: f.native, getTask: idx.getTask, allTasks: [...tasks.values()],
				readState: captureAutomationReadState(vault, idx, pins, [...tasks.values()], () => 'fixture'), indexed: () => true,
				validPath: async () => true, buffersMatch: name => name !== f.dirty, sync: () => true, permit: () => permit,
				withSources: (_, allowed, operation) => operation(allowed),
				refresh: async () => { f.refreshes++; if (f.refreshFails) throw Error('refresh failed'); } });
			await f.onPrepare?.();
			return work;
		},
		confirm: async (plan, rules) => { f.prompts.push([plan, rules]); return f.confirm ? await f.confirm() : 'apply'; },
		deactivate: saved => deactivateAutomationRules({
			getSettings: () => ({ automationRules: config }), saveAutomationRules: async (prior, next) => {
				assert.equal(prior, config); if (f.saveFails) throw Error('save failed');
				config.rules = next.rules;
			} }, saved),
		exclusive: operation => writer.runExclusiveTaskMutation(async owned => { permit = owned; try { return await operation(); } finally { permit = undefined; } }),
	};
	const runner = new ManualAutomationRunner();
	return Object.assign(f, { pins, read: name => readFile(path.join(dir, name), 'utf8'), run: () => runner.run(ruleId, ports) });
}

for (const [n, policy, asks] of [[0,'always',0], [1,'always',1], [5,5,0], [6,5,1], [6,'none',0]]) {
	test('Run ' + n + ' tasks, confirmation ' + policy, async () => {
		const f = await fixture(filesFor(n), { policy });
		const result = await f.run();
		assert.equal(result.applied, n); assert.equal(f.prompts.length, asks); assert.equal(f.writes.length, n);
		for (const name of f.writes) assert.match(await f.read(name), /#follow/u);
	});
}
test('unknown count, hidden modes, cancelled modal and deactivation failure never write', async () => {
	const f = await fixture(filesFor(1)); f.known = false;
	assert.equal((await f.run()).status, 'unavailable'); f.known = true;
	f.rule.mode = 'auto'; assert.equal((await f.run()).status, 'rule-changed'); f.rule.mode = 'manual';
	f.confirm = () => 'dismiss'; assert.equal((await f.run()).status, 'dismissed'); assert.ok(f.rule.active);
	f.confirm = () => 'deactivate'; f.saveFails = true; assert.equal((await f.run()).status, 'save-failed'); assert.ok(f.rule.active);
	f.saveFails = false; assert.equal((await f.run()).status, 'deactivated'); assert.equal(f.config.rules[0].active, false);
	assert.equal((await f.run()).status, 'rule-changed'); assert.deepEqual(f.writes, []);
});
test('same count with different targets requires another confirmation; a second Run is ignored', async () => {
	const f = await fixture(filesFor(2), { rule: { target: rootGroup('description', 'text', 'is', id(0)) } });
	f.confirm = async () => {
		assert.equal((await f.run()).status, 'busy');
		if (f.prompts.length === 1) f.rule.target = rootGroup('description', 'text', 'is', id(1));
		return 'apply';
	};
	assert.equal((await f.run()).applied, 1); assert.equal(f.prompts.length, 2); assert.deepEqual(f.writes, [id(1) + '.md']);
});
test('global confirmation changes during asynchronous preparation', async () => {
	const f = await fixture(filesFor(1), { policy: 'none' });
	let count = 0; f.onPrepare = () => { if (++count === 2) f.config.confirmation = 'always'; };
	assert.equal((await f.run()).applied, 1); assert.equal(f.prompts.length, 1);
});
test('deactivation during confirmation and stale buffers cause zero writes', async () => {
	const f = await fixture(filesFor(1)); f.confirm = () => { f.rule.active = false; return 'apply'; };
	assert.equal((await f.run()).status, 'rule-changed'); f.rule.active = true; f.dirty = id(0) + '.md';
	assert.equal((await f.run()).status, 'unavailable'); assert.deepEqual(f.writes, []);
});
test('one source write changes two inline tasks, multiple actions and related pin storage', async () => {
	const files = { 'Notes.md': '# Keep\r\n' + inline(id(0), ' {{priority:: Low}}').replace(/\n/gu, '\r\n') + inline(id(1)) };
	const f = await fixture(files, { rule: { actions: [action('priority', 'Low', 'remove'), action('tags', ['a','b']), action('pinned', 'true')] } });
	assert.equal((await f.run()).applied, 2); assert.deepEqual(f.writes, ['Notes.md']); assert.equal(f.pins.getPinnedIds().length, 2);
	const content = await f.read('Notes.md'); assert.ok(content.startsWith('# Keep\r\n')); assert.doesNotMatch(content, /Low/u); assert.equal(content.match(/#a #b/gu).length, 2);
});
test('one target changes both ends of a relationship; failed second write restores first', async () => {
	const opts = { rule: { target: rootGroup('description', 'text', 'is', id(0)), actions: [action('blocking', id(1))] } };
	const f = await fixture(filesFor(2), opts);
	assert.equal((await f.run()).applied, 2); assert.equal(f.prompts[0][0].rules[0].target, 1);
	assert.match(await f.read(id(0) + '.md'), /blocking:: task001/u); assert.match(await f.read(id(1) + '.md'), /blockedBy:: task000/u);
	const fail = await fixture(filesFor(2), opts); fail.reject = id(1) + '.md';
	const result = await fail.run(); assert.deepEqual([result.applied,result.uncertain], [0,0]); assert.equal(await fail.read(id(0) + '.md'), inline(id(0)));
});
test('stop at the first independent failure and classify a lost acknowledgement once', async () => {
	for (const [fault, applied, uncertain] of [['reject',1,0], ['unknown',1,1], ['loseAck',3,0]]) {
		const f = await fixture(filesFor(3)); f[fault] = id(1) + '.md';
		const result = await f.run(); assert.deepEqual([result.applied,result.uncertain],[applied,uncertain]);
		assert.equal(f.writes.filter(name => name === id(1) + '.md').length, fault === 'reject' ? 0 : 1);
	}
});
test('loss of pin storage authority keeps the group uncertain without replay or unsafe rollback', async () => {
	const f = await fixture(filesFor(1), { rule: { actions: [action('tags','follow'), action('pinned','true')] } });
	f.losePinAuthority = true;
	const result = await f.run(); assert.deepEqual([result.applied, result.uncertain], [0,1]);
	assert.equal(f.writes.length,1); assert.match(await f.read('pins.json'), /"pinned":true/u);
});
test('read dependencies remain current until the physical mutation', async () => {
	const f = await fixture(filesFor(1), { rule: { scope: rootGroup('pinned', 'pinned', 'isPinned') } });
	await f.pins.toggle(id(0));
	f.beforeProcess = async () => { await f.pins.toggle(id(0)); };
	assert.equal((await f.run()).applied, 0); assert.deepEqual(f.writes, []);
});
test('physical Markdown cannot reinterpret a description as an extra tag', async () => {
	const f = await fixture(filesFor(1), { rule: { actions: [action('description', 'Review #urgent')] } });
	assert.equal((await f.run()).status, 'unavailable'); assert.deepEqual(f.writes, []);
});
test('refresh failure preserves committed counts', async () => {
	const f = await fixture(filesFor(1)); f.refreshFails = true;
	const result = await f.run(); assert.equal(result.applied, 1); assert.equal(result.refreshPending, true);
});
test('native inline and YAML values, multiline YAML comments, and user-owned content survive', async () => {
	const key = 'file.property:Team';
	const f = await fixture({ 'File.md': '---\noperonId: task001\n# keep this comment\nOther: "exact spelling"\n---\nBody\n', 'Inline.md': inline(id(0)) },
		{ rule: { actions: [action(key, 'Alpha'), action('tags','follow')] } });
	f.native = { fields: [{ key, type: 'text', propertyName: 'Team' }], getCell: () => ({
		present: false, sourceName: 'Team', nativeState: 'ready', normalizedValue: '', inlineExpected: { present: false } }) };
	const result = await f.run(); assert.equal(result.applied, 2);
	const file = await f.read('File.md'); assert.match(file, /Team: Alpha/u); assert.match(file, /# keep this comment\nOther: "exact spelling"/u); assert.ok(file.endsWith('Body\n'));
	assert.match(await f.read('Inline.md'), /Team:: Alpha/u);
});
test('file task rename and managed values commit together', async () => {
	const f = await fixture({ 'Original.md': '---\noperonId: task001\n---\nBody\n' }, { rule: { actions: [action('description','Renamed'), action('priority','High')] } });
	assert.equal((await f.run()).applied,1); assert.match(await f.read('Renamed.md'), /priority: High/u); await assert.rejects(f.read('Original.md'), { code: 'ENOENT' });
});
test('the parent timestamp and child multi-action change count as two distinct tasks', async () => {
	const f = await fixture({ 'Parent.md': inline(id(1)), 'Child.md': inline(id(0), ' {{parentTask:: task001}}') },
		{ rule: { target: rootGroup('description','text','is',id(0)), actions: [action('tags','child'), action('note','a note')] } });
	assert.equal((await f.run()).applied, 2); assert.equal(f.prompts[0][0].rules[0].target, 1);
	assert.match(await f.read('Parent.md'), /datetimeModified::/u);
});
test('a blocked transition can still tag the target; transitions relying on another write roll back together', async () => {
	const files = { 'A.md': inline(id(0), ' {{blockedBy:: task001}}'), 'B.md': inline(id(1), ' {{blocking:: task000}}') };
	const f = await fixture(files, { rule: { target: rootGroup('description','text','is',id(0)), actions: [action('checkbox','done'), action('tags','ok')] } });
	const result = await f.run(); assert.equal(result.applied, 1); assert.ok(result.plan.issues.some(i => i.reason === 'blocked'));
	assert.match(await f.read('A.md'), /^- \[ \].*#ok/u);
	const allTasks = await fixture(files, { rule: { actions: [action('checkbox','done')] } });
	allTasks.reject = 'B.md'; const failed = await allTasks.run();
	assert.equal(failed.applied, 0); assert.equal(await allTasks.read('A.md'), files['A.md']);
});
test('opposed writes skip the entire conflicting task', async () => {
	const f = await fixture(filesFor(1), { rule: { actions: [action('tags','same'), action('tags','same','remove'), action('note','skip')] } });
	const result = await f.run(); assert.equal(result.applied,0); assert.ok(result.plan.issues.some(i => i.reason === 'conflict')); assert.deepEqual(f.writes, []);
});
test('deactivation updates only named rule versions and retains independent edits', async () => {
	const f = await fixture(filesFor(1));
	f.config.rules.push({ ...f.rule, id: 'second', name: 'Other' });
	f.confirm = () => { f.config.rules[1].name = 'New name'; return 'deactivate'; };
	assert.equal((await f.run()).status, 'deactivated'); assert.ok(f.config.rules[1].active); assert.equal(f.config.rules[1].name, 'New name');
});
test('custom list and numeric actions use task mappings in both source formats', async () => {
	const mappings = [{ canonicalKey:'participants', visiblePropertyName:'Members', type:'list', isSystem:false },
		{ canonicalKey:'points', visiblePropertyName:'Points', type:'number', isSystem:false }];
	const f = await fixture({ 'A.md': inline(id(0), ' {{Members:: Ana}}'),
		'B.md': '---\noperonId: task001\nMembers:\n  - Ana\n---\n' }, { settings: { keyMappings: [...DEFAULT_SETTINGS.keyMappings, ...mappings] },
		rule: { actions: [action('participants',['Lee']), action('points','3')] } });
	assert.equal((await f.run()).applied,2);
	assert.match(await f.read('A.md'),/Ana; Lee/u);
	const data = parseYaml((await f.read('B.md')).split('---')[1]); assert.deepEqual(data.Members, ['Ana','Lee']); assert.equal(data.Points,3);
});
test('modal distinguishes explicit deactivation, dismissal and repeated Apply clicks', () => {
	for (const [button, expected] of [[0,'deactivate'],[1,'apply'],[null,'dismiss']]) {
		const outcomes = [], clicked = [];
		const modal = automationApprovalModal({}, { changedTaskCount: 3, rules: [{ ruleId, changed: 3 }] }, [{ id: ruleId, name: 'Follow up' }], d => outcomes.push(d));
		const el = { empty() {}, addClass() {}, createDiv() { return this; }, ownerDocument: { defaultView: null },
			createEl(tag) { return { addClass() {}, addEventListener(_, cb) { if (tag === 'button') clicked.push(cb); } }; } };
		modal.contentEl = el; modal.open();
		if (button === null) modal.close(); else { clicked[button](); clicked[button](); }
		assert.deepEqual(outcomes,[expected]);
	}
});
