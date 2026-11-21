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
	export { TFile, Notice, parseYaml } from 'obsidian';
	export { countNoteScans } from './scripts/test-support/automation-markdown-scan-probe.mjs';
	export { withSettingsFixture } from './scripts/test-support/settings-preservation-harness';
	export { createAutomationRule, readAutomationRules } from './src/core/automation-rules';
	export { deactivateAutomationRules, AutomationRunner } from './src/systems/manual-automation-run';
	export { filterUsesLocalDay } from './src/core/filter-evaluator';
	export { localToday } from './src/core/local-time';
	export { registerWorkspaceDayRefresh } from './src/core/filter-day-refresh';
	export { AutoAutomationEvents, automationTaskImage } from './src/systems/auto-automation-events';
	export { NativePropertyIndex, getNativePropertyIndex } from './src/indexer/native-property-index';
	export { projectIndexedNativeProperties } from './src/ui/table/table-native-property';
	export { OperonIndexer } from './src/indexer/indexer';
	export { captureAutomationReadState } from './src/systems/automation-read-state';
	export { prepareAutomationWork } from './src/systems/automation-task-writes';
	export { automationApprovalModal, showAutomationResult } from './src/ui/manual-automation-feedback';
	export { expandListAction, validAction } from './src/ui/automation-action-editor';
	export { collectNativeFieldValueCandidates } from './src/ui/custom-field-surfaces';
	export { AutomationRuleModal } from './src/ui/automation-rule-modal';
	export { exportOperonSettingsBackupJsonV1 } from './src/core/settings-backup-export';
	export { preflightOperonSettingsBackupRestoreV1 } from './src/core/settings-backup-preflight';
	export { createOperonSettingsBackupApplyAcknowledgementV1 } from './src/core/settings-backup-apply';
	export { mountAutomationRules } from './src/ui/settings/automation-rules';
	export { statusDockDocument } from './scripts/test-support/status-dock-dom';
	export { t } from './src/core/i18n';
	export { TaskWriter } from './src/core/task-writer';
	export { PinnedCache } from './src/storage/pinned-cache';
	export { planAutomationChanges } from './src/core/automation-change-plan';
	export { AggregateCoordinator } from './src/systems/aggregate-coordinator';
	export { DEFAULT_SETTINGS } from './src/types/settings';
	export { scanFileWithMappings } from './src/indexer/file-scanner';
` }, outfile: out, banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" }, bundle: true, format: 'esm', platform: 'node',
	plugins: [{ name: 'fixture', setup(builder) {
		builder.onResolve({ filter: /\/markdown-fenced-lines$/ }, () => ({ path: path.join(root, 'scripts/test-support/automation-markdown-scan-probe.mjs') }));
		builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'fixture' }));
		builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ resolveDir: root,
			contents: "export * from './scripts/test-support/obsidian'; export { parse as parseYaml, stringify as stringifyYaml } from 'yaml';" }));
	} }] });
const { TFile, Notice, parseYaml, countNoteScans, withSettingsFixture, createAutomationRule, readAutomationRules, deactivateAutomationRules, AutomationRunner, captureAutomationReadState, prepareAutomationWork, automationApprovalModal, showAutomationResult, AutomationRuleModal, mountAutomationRules, statusDockDocument, t,
	exportOperonSettingsBackupJsonV1, preflightOperonSettingsBackupRestoreV1, createOperonSettingsBackupApplyAcknowledgementV1, expandListAction, validAction, collectNativeFieldValueCandidates,
	TaskWriter, PinnedCache, planAutomationChanges, AggregateCoordinator, DEFAULT_SETTINGS, scanFileWithMappings,
	AutoAutomationEvents, automationTaskImage, NativePropertyIndex, getNativePropertyIndex, projectIndexedNativeProperties, OperonIndexer, filterUsesLocalDay, registerWorkspaceDayRefresh, localToday } = await import(pathToFileURL(out).href);
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
	const f = { writes: [], prompts: [], config, rule, tasks, frontmatter, refreshes: 0, known: true,
		editFile: (name, content) => writeFile(path.join(dir, name), content) };
	const duplicates = new Map();
	const indexTask = task => {
		const key = task.operonId;
		if (tasks.has(key)) {
			const copies = duplicates.get(key) ?? [tasks.get(key)];
			copies.push(task);
			duplicates.set(key, copies);
		}
		tasks.set(key, task);
	};
	const vault = {
		getAbstractFileByPath: name => records.get(name),
		getMarkdownFiles: () => [...records.values()],
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
	const app = { vault, metadataCache: { resolvedLinks: {}, getFileCache: () => null }, fileManager: { renameFile: async (file, name) => {
		await rename(path.join(dir, file.path), path.join(dir, name)); records.delete(file.path); file.path = name; records.set(name, file);
	} } };
	const propertyIndex = getNativePropertyIndex(app);
	propertyIndex.configure(settings);
	for (const [name, value] of Object.entries(files)) {
		const file = new TFile(name); file.stat = { mtime: 0, ctime: 0, size: Buffer.byteLength(value) }; records.set(name, file);
		await writeFile(path.join(dir, name), value);
		const scan = await scanFileWithMappings(app, file, settings.keyMappings);
		propertyIndex.accept(name, scan.nativeProperties, false);
		for (const task of scan.inlineTasks) indexTask({ ...task, tier: 'hot', datetimeModified: '',
			fieldValues: Object.fromEntries(task.fields.map(field => [field.key, field.value])),
			primary: { filePath: name, format: 'inline', lineNumber: task.lineNumber } });
		if (scan.yamlTask) {
			const task = scan.yamlTask;
			indexTask({ ...task, tier: 'hot', checkbox: 'open', datetimeModified: task.fieldValues.datetimeModified ?? '',
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
	const indexedStats = new Map([...records].map(([name, file]) => [name, { ...file.stat }]));
	const idx = { getGeneration: () => 1, getLiveReadAuthoritySnapshot: () => ({ settled: true }),
		isIndexedSourceCurrent: file => indexedStats.get(file.path)?.mtime === file.stat.mtime && indexedStats.get(file.path)?.size === file.stat.size,
		getAllDuplicateInstanceSnapshots: () => [...duplicates.values()].flat(),
		subscribeIndexReconciliation: () => () => {}, getTask: key => tasks.get(key) };
	const writer = new TaskWriter(app, idx, settings.keyMappings, { getInlinePropertyDefinitions: () => settings.inlinePropertyDefinitions });
	const aggregates = new AggregateCoordinator({}, {});
	const ports = { vault, available: () => true, now: () => f.now ?? asOf, settings: opts.readRules ?? (() => structuredClone(config)),
		plan: (saved, policy, clock, triggers, getFrontmatter = t => frontmatter.get(t.operonId)) => planAutomationChanges({ tasks: [...tasks.values()], settings, asOf: clock, ready: f.planReady?.() ?? f.known,
			conditionFields: new Map([['taskIcon', 'text'], ['description', 'text'], ['pinned', 'pinned'], ['dateDue', 'date'], ['tags', 'tags'], ['projectSerialScope', 'projectSerialScope']]), pins: new Set(pins.getPinnedIds()), activeTimerId: null,
			unavailableIds: new Set(duplicates.keys()), getDuplicateInstances: idx.getAllDuplicateInstanceSnapshots,
			getInlineList: (task, name) => propertyIndex.readMappedInlineList(task, name), getFrontmatter, getRepeatSkipDates: () => [], native: f.native,
			fileRenameState: (_, dest) => records.has(dest) ? 'occupied' : 'available',
			projectAggregates: (graph, ids) => aggregates.projectAutomationAggregateFields(graph, ids, true),
		}, saved, policy, triggers),
		prepare: async (plan, yamlSources) => {
			const work = await prepareAutomationWork(plan, { app, writer, settings, pins, yamlSources, native: f.native, getTask: idx.getTask, allTasks: [...tasks.values()],
				readState: captureAutomationReadState(vault, idx, pins, [...tasks.values()], plan.changes, () => JSON.stringify(settings.projectSerialScopes)), indexed: () => !f.staleIndex,
				validPath: async () => true, buffersMatch: name => name !== f.dirty, sync: () => { if (f.syncThrows) throw Error('lost editor acknowledgement'); return true; }, permit: () => permit,
				withSources: (_, allowed, operation) => operation(allowed),
				observeSource: f.observeSource, observePin: f.observePin,
				refresh: async () => { f.refreshes++; if (f.refreshFails) throw Error('refresh failed'); } });
			await f.onPrepare?.();
			return work;
		},
		confirm: async (plan, rules) => { f.prompts.push([plan, rules]); return f.confirm ? await f.confirm() : 'apply'; },
		refreshBatch: batch => f.events?.refreshBatch(batch),
		indexSettling: () => !f.known,
		deferIndexRetry: (batch, shown) => f.events?.deferIndexRetry(batch, shown) ?? false,
		deferConfirmation: (batch, shown) => f.events?.deferConfirmation(batch, shown) ?? false,
		deactivate: saved => deactivateAutomationRules({
			getSettings: () => ({ automationRules: config }), saveAutomationRules: async (prior, next) => {
				assert.equal(prior, config); if (f.saveFails) throw Error('save failed');
				config.rules = next.rules;
			} }, saved),
		exclusive: operation => writer.runExclusiveTaskMutation(async owned => { permit = owned; try { return await operation(); } finally { permit = undefined; } }),
	};
	const runner = new AutomationRunner();
	return Object.assign(f, { app, pins, preview: draft => ports.plan([draft], config.confirmation, asOf), reindexInline: async (key, copyPath) => {
		const task = copyPath ? duplicates.get(key).find(copy => copy.primary.filePath === copyPath) : tasks.get(key);
		const file = records.get(task.primary.filePath);
		const scan = await scanFileWithMappings(app, file, settings.keyMappings);
		const current = scan.inlineTasks.find(item => item.operonId === key);
		Object.assign(task, current, { fieldValues: Object.fromEntries(current.fields.map(field => [field.key,field.value])) });
		indexedStats.set(file.path, { ...file.stat });
	}, auto: ids => runner.runAuto(async () => ({rules:ids, confirmAgain:false}), ports), runBatch: take => runner.runAuto(take, ports), read: name => readFile(path.join(dir, name), 'utf8'), run: (id = ruleId) => runner.run(id, ports) });
}

test('a saved inactive rule survives storage reload and applies both tag actions to the selected tasks', async () => {
	await withSettingsFixture({ table: false }, async disk => {
		const settings = disk.createStorage();
		await settings.initialize();
		const draft = createAutomationRule('Review the queue');
		assert.equal(draft.active, false);
		draft.scope = rootGroup('tags', 'tags', 'anyContains', 'project');
		const queue = rootGroup('tags', 'tags', 'anyContains', 'queue');
		draft.target.children.push(queue);
		draft.actions = [action('tags', ['review']), action('tags', ['queue'], 'remove')];
		const initial = settings.getSettings().automationRules;
		await settings.saveAutomationRules(initial, { ...readAutomationRules(initial), rules: [draft] });

		const reopened = disk.createStorage();
		await reopened.initialize();
		const saved = reopened.getSettings().automationRules;
		assert.deepEqual(saved.rules, [draft]);
		assert.equal(saved.confirmation, 'always');
		const sibling = inline(id(2), ' #project');
		const outside = inline(id(3), ' #queue');
		const files = {
			'Inline.md': inline(id(0), ' #project #queue') + sibling,
			'File.md': '---\noperonId: task001\ntags: [project, queue]\n---\nKeep this body.\n',
			'Outside.md': outside,
			'Ordinary.md': '---\ntags: [project, queue]\n---\nOrdinary note.\n',
		};
		const f = await fixture(files, { readRules: () => reopened.getSettings().automationRules });
		assert.equal((await f.run(draft.id)).status, 'rule-changed');
		await reopened.saveAutomationRules(saved, { ...saved, rules: [{ ...draft, active: true }] });
		assert.deepEqual(f.writes, []);
		assert.deepEqual(f.prompts, []);
		const result = await f.run(draft.id);
		assert.equal(result.status, 'finished');
		assert.equal(result.applied, 2);
		assert.equal(f.prompts.length, 1);
		const [plan, listed] = f.prompts[0];
		assert.equal(plan.changedTaskCount, 2);
		assert.deepEqual(plan.rules, [{ ruleId: draft.id, scope: 3, target: 2, changed: 2 }]);
		assert.deepEqual(listed.map(rule => rule.id), [draft.id]);
		assert.deepEqual(f.writes.toSorted(), ['File.md', 'Inline.md']);
		const inlineSource = await f.read('Inline.md');
		assert.match(inlineSource, /#review\b/u);
		assert.doesNotMatch(inlineSource, /#queue\b/u);
		assert.ok(inlineSource.endsWith(sibling));
		const fileSource = await f.read('File.md');
		assert.deepEqual(parseYaml(fileSource.split('---')[1]).tags, ['project', 'review']);
		assert.ok(fileSource.endsWith('Keep this body.\n'));
		assert.equal(await f.read('Outside.md'), outside);
		assert.equal(await f.read('Ordinary.md'), files['Ordinary.md']);
	});
});

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
for (const relation of ['blockedBy', 'blocking']) {
	for (const last of ['open', 'done']) {
		test(`duplicate blocker protects closure and permits tagging with ${relation} and ${last} indexed last`, async () => {
			const open = ['Open.md', inline(id(1), relation === 'blocking' ? ' {{blocking:: task000}}' : '')];
			const done = ['Done.md', inline(id(1), ' {{status:: Project.Finished}}').replace('- [ ]', '- [x]')];
			const files = Object.fromEntries([
				['Dependent.md', inline(id(0), relation === 'blockedBy' ? ' {{blockedBy:: task001}}' : '')],
				...(last === 'open' ? [done, open] : [open, done]),
			]);
			const f = await fixture(files, { rule: { target: rootGroup('description', 'text', 'is', id(0)),
				actions: [action('status', 'Project.Finished'), action('tags', 'follow')] } });
			assert.equal(f.tasks.get(id(1)).checkbox, last);
			const result = await f.run();
			assert.ok(result.plan.issues.some(issue => issue.taskId === id(0) && issue.reason === 'blocked'));
			assert.equal(result.applied, 1);
			const dependent = await f.read('Dependent.md');
			assert.match(dependent, /^- \[ \].*#follow/u);
			assert.doesNotMatch(dependent, /Project\.Finished|dateCompleted::/u);
			assert.deepEqual(f.writes, ['Dependent.md']);
			assert.equal(await f.read(open[0]), open[1]);
			assert.equal(await f.read(done[0]), done[1]);
		});
	}
}
for (const representative of ['Open.md', 'Done.md']) {
	for (const boundary of ['approval', 'write']) {
		test(`pending Auto closure rechecks a duplicate blocker at ${boundary} with ${representative} indexed last`, async () => {
			const open = ['Open.md', inline(id(1))];
			const done = ['Done.md', inline(id(1), ' {{status:: Project.Finished}}').replace('- [ ]', '- [x]')];
			const dependent = inline(id(0));
			const files = Object.fromEntries([['Dependent.md', dependent], ...(representative === open[0] ? [done, open] : [open, done])]);
			const f = await fixture(files, { rule: { mode: 'auto', target: rootGroup('description', 'text', 'is', id(0)),
				actions: [action('status', 'Project.Finished'), action('tags', 'follow')] } });
			assert.equal(f.tasks.get(id(1)).primary.filePath, representative);
			const changed = inline(id(1), ' {{blocking:: ' + id(0) + '}}');
			const changeBlocker = async () => {
				await f.editFile('Open.md', changed);
				const file = f.app.vault.getAbstractFileByPath('Open.md');
				file.stat.mtime++;
				file.stat.size = Buffer.byteLength(changed);
			};
			if (boundary === 'approval') f.confirm = async () => { await changeBlocker(); return 'apply'; };
			else f.beforeProcess = changeBlocker;
			const trigger = new Map([[ruleId, new Set([id(0)])]]);
			const interrupted = await f.auto(trigger);
			if (boundary === 'approval') assert.equal(interrupted.status, 'unavailable');
			else assert.equal(interrupted.applied, 0);
			assert.deepEqual(f.writes, []);
			assert.equal(await f.read('Dependent.md'), dependent);
			await f.reindexInline(id(1), 'Open.md');
			f.confirm = () => 'apply';
			f.beforeProcess = undefined;
			const result = await f.auto(trigger);
			assert.equal(result.applied, 1);
			assert.ok(result.plan.issues.some(issue => issue.reason === 'blocked'));
			assert.match(await f.read('Dependent.md'), /^- \[ \].*#follow/u);
			assert.deepEqual(f.writes, ['Dependent.md']);
			assert.equal(await f.read('Open.md'), changed);
		});
	}
}

test('pending Auto closure accepts its own confirmed write in a file shared with a duplicate', async () => {
	const f = await fixture({ 'First.md': inline(id(0)) + inline('shared'), 'Copy.md': inline('shared'), 'Second.md': inline(id(1)) }, {
		rule: { mode: 'auto', target: rootGroup('description', 'text', 'startsWith', 'task'), actions: [action('checkbox', 'done')] },
	});
	f.app.vault.on('modify', file => { file.stat.mtime++; });
	const result = await f.auto(new Map([[ruleId, new Set([id(0)])]]));
	assert.equal(result.applied, 2);
	assert.match(await f.read('First.md'), /^- \[x\].*\n- \[ \] shared/u);
	assert.match(await f.read('Second.md'), /^- \[x\]/u);
	assert.deepEqual(f.writes, ['First.md', 'Second.md']);
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
const membersSource = value => '---\noperonId: task001\n' + value + '\nKeep: unchanged\n---\nKeep this body.\n';
async function membersFixture(source, cached, operation, value, mode = 'manual') {
	const mapping = { canonicalKey: 'participants', visiblePropertyName: 'Members', type: 'list', isSystem: false };
	const f = await fixture({ 'Members.md': membersSource(source) }, {
		settings: { keyMappings: [...DEFAULT_SETTINGS.keyMappings, mapping] },
		rule: { mode, actions: [action('participants', value, operation)] },
	});
	f.frontmatter.get(id(1)).Members = cached;
	return f;
}

for (const [operation, value, expected] of [['add', 'Lee', ['Ana', 'Bob', 'Lee']], ['remove', 'Ana', ['Bob']]]) {
	test('managed YAML list preserves unobserved members on ' + operation, async () => {
		const f = await membersFixture('Members: [Ana, Bob]', ['Ana'], operation, value);
		const result = await f.run();
		assert.equal(result.status, 'finished');
		assert.equal(result.applied, 1);
		const content = await f.read('Members.md');
		const yaml = parseYaml(content.split('---')[1]);
		assert.deepEqual(yaml.Members, expected);
		assert.equal(yaml.Keep, 'unchanged');
		assert.ok(content.endsWith('Keep this body.\n'));
		const change = f.prompts[0][0].changes.find(item => item.field === 'participants');
		assert.deepEqual(change.before, ['Ana', 'Bob']);
		assert.deepEqual(change.after, expected);
	});
}

test('managed YAML list rechecks the actual source before treating an automatic run as a no-op', async () => {
	const f = await membersFixture('Members: [Ana, Bob]', ['Ana', 'Lee'], 'add', 'Lee', 'auto');
	const trigger = new Map([[ruleId, new Set([id(1)])]]);
	assert.equal((await f.auto(trigger)).applied, 1);
	assert.deepEqual(parseYaml((await f.read('Members.md')).split('---')[1]).Members, ['Ana', 'Bob', 'Lee']);
	assert.equal((await f.auto(trigger)).applied, 0);
	assert.equal(f.prompts.length, 1);
	assert.deepEqual(f.writes, ['Members.md']);
});

test('managed YAML list reopens confirmation on a member edit and preserves the new member', async () => {
	const f = await membersFixture('Members: [Ana]', ['Ana'], 'add', 'Lee');
	f.confirm = async () => {
		assert.deepEqual(f.writes, []);
		if (f.prompts.length === 1) await f.editFile('Members.md', membersSource('Members: [Ana, Bob]'));
		return 'apply';
	};
	assert.equal((await f.run()).applied, 1);
	assert.deepEqual(f.prompts.map(([plan]) => plan.changes.find(c => c.field === 'participants').before), [['Ana'], ['Ana', 'Bob']]);
	assert.deepEqual(f.writes, ['Members.md']);
	assert.deepEqual(parseYaml((await f.read('Members.md')).split('---')[1]).Members, ['Ana', 'Bob', 'Lee']);
});

test('managed YAML list leaves unsupported member types and ambiguous aliases intact', async () => {
	for (const source of ['Members: [Ana, 7]', 'Members: ["Ana; Bob"]', 'Members: [Ana]\nparticipants: [Bob]']) {
		const f = await membersFixture(source, ['Ana'], 'add', 'Lee');
		assert.equal((await f.run()).status, 'unavailable');
		assert.deepEqual(f.writes, []);
		assert.equal(await f.read('Members.md'), membersSource(source));
	}
});

test('managed YAML list reads scalar, missing and null fields from the current document', async () => {
	for (const [source, expected] of [['Members: Bob', ['Bob', 'Lee']], ['', ['Lee']], ['Members:', ['Lee']]]) {
		const f = await membersFixture('Members: [Ana]', ['Ana'], 'add', 'Lee');
		await f.editFile('Members.md', membersSource(source));
		assert.equal((await f.run()).applied, 1);
		assert.deepEqual(parseYaml((await f.read('Members.md')).split('---')[1]).Members, expected);
	}
});

test('managed YAML list preserves a member edit at the final write boundary', async () => {
	const f = await membersFixture('Members: [Ana]', ['Ana'], 'add', 'Lee');
	const edited = membersSource('Members: [Ana, Bob]');
	f.beforeProcess = () => f.editFile('Members.md', edited);
	assert.equal((await f.run()).applied, 0);
	assert.equal(await f.read('Members.md'), edited);
});

test('managed YAML list keeps a gallery member containing a semicolon intact', async () => {
	const f = await fixture({ 'Gallery.md': membersSource('taskGallery: ["old.png"]') }, {
		rule: { actions: [action('taskGallery', 'new.png')] },
	});
	await f.editFile('Gallery.md', membersSource('taskGallery: ["old.png", "album; cover.png"]'));
	assert.equal((await f.run()).applied, 1);
	assert.deepEqual(parseYaml((await f.read('Gallery.md')).split('---')[1]).taskGallery, ['old.png', 'album; cover.png', 'new.png']);
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
const listMapping = { canonicalKey: 'participants', visiblePropertyName: 'Members', type: 'list', isSystem: false };
const typedMembers = { keyMappings: [...DEFAULT_SETTINGS.keyMappings, listMapping], inlinePropertyDefinitions: {
	version: 1, entries: [{ sourceName: 'Members', type: 'list', encoding: 'vault-v1' }],
} };

for (const [operation, literal, expected, legacy = Array.isArray(literal)] of [
	['add', 'Lee', '2; "2"; "A; B"; Lee'],
	['remove', '2', '"2"; "A; B"'],
	['remove', '"2"', '2; "A; B"'],
	['remove', '"A; B"', '2; "2"'],
	['remove', ['2'], '2; "A; B"'],
	['remove', ['A; B'], '2; "2"'],
	['remove', '2', '2; "A; B"', true],
]) {
	test(`typed inline list ${operation} ${JSON.stringify(literal)} (${legacy ? 'legacy' : 'typed'}) preserves member identities on disk`, async () => {
		const f = await fixture({ 'Mixed.md': inline(id(0), ' {{Members:: 2; "2"; "A; B"}}'),
			'Simple.md': inline(id(1), ' {{Members:: Ana}}') }, {
			settings: typedMembers, rule: { actions: [{ ...action('participants', literal, operation), ...(legacy ? {} : { valueEncoding: 'vault-v1' }) }] },
		});
		assert.equal((await f.run()).applied, operation === 'add' ? 2 : 1);
		assert.ok((await f.read('Mixed.md')).includes('{{Members:: ' + expected + '}}'));
		assert.ok((await f.read('Simple.md')).includes(operation === 'add' ? '{{Members:: Ana; Lee}}' : '{{Members:: Ana}}'));
	});
}

test('batched inline custom fields scan each note once per preparation regardless of task count', async t => {
	const bodyPrefix = 'Batch of inline tasks\r\n';
	const prefix = '---\r\nKeep: original\r\n---\r\n' + bodyPrefix;
	const marker = ' {{Members:: 2; "2"; "A; B"}}';
	const untouched = inline('outside', marker) + '~~~md\n' + inline(id(0), marker) + '~~~\nEnd';
	let firstScanCount;
	for (const count of [16, 64, 128]) {
		const rows = Array.from({ length: count }, (_, i) => inline(id(i), marker)).join('');
		const note = prefix + (rows + untouched).replaceAll('\n', '\r\n');
		const f = await fixture({ 'Batch.md': note }, { settings: typedMembers, rule: {
			target: rootGroup('description', 'text', 'startsWith', 'task'),
			actions: [action('participants', ['follow'])],
		} });
		let preparations = 0;
		f.onPrepare = () => { preparations++; };
		const start = performance.now();
		const { result, scans } = await countNoteScans(bodyPrefix, () => f.run());
		t.diagnostic(`${count} tasks, ${scans} note scans, ${preparations} preparations, ${(performance.now() - start).toFixed(1)} ms`);
		assert.equal(result.applied, count);
		assert.deepEqual(f.writes, ['Batch.md']);
		const updated = await f.read('Batch.md');
		assert.ok(updated.startsWith(prefix));
		assert.ok(updated.endsWith(untouched.replaceAll('\n', '\r\n')));
		const changed = updated.slice(prefix.length).split('\r\n').slice(0, count);
		for (const [i, line] of changed.entries()) {
			assert.ok(line.includes('{{operonId:: ' + id(i) + '}}'));
			assert.ok(line.includes('{{Members:: 2; "2"; "A; B"; follow}}'));
		}
		assert.ok(preparations > 0);
		assert.equal(scans, preparations);
		firstScanCount ??= scans;
		assert.equal(scans, firstScanCount);
	}
});

test('batched inline custom fields prepare File Task and inline updates in the same note', async () => {
	const source = '---\noperonId: task900\nMembers: [root]\nKeep: original\n---\nBody\n'
		+ inline(id(0), ' {{Members:: 2; "2"}}') + inline(id(1), ' {{Members:: "A; B"}}');
	const f = await fixture({ 'Shared.md': source }, { settings: typedMembers, rule: { actions: [action('participants', ['follow'])] } });
	assert.equal((await f.run()).applied, 3);
	assert.deepEqual(f.writes, ['Shared.md']);
	const updated = await f.read('Shared.md');
	const data = parseYaml(updated.split('---')[1]);
	assert.deepEqual(data.Members, ['root', 'follow']);
	assert.equal(data.Keep, 'original');
	assert.ok(updated.includes('---\nBody\n'));
	assert.ok(updated.includes('{{Members:: 2; "2"; follow}}'));
	assert.ok(updated.includes('{{Members:: "A; B"; follow}}'));
});

test('batched inline custom fields reject missing or ambiguous source identities before writing any row', async () => {
	const first = inline(id(0), ' {{Members:: Ana}}');
	const last = inline(id(1), ' {{Members:: Lee}}');
	for (const changed of [first, first + last + last, first + inline(id(1), ' {{operonId:: task001}} {{Members:: Lee}}')]) {
		const f = await fixture({ 'Batch.md': first + last }, { settings: typedMembers, rule: { actions: [action('participants', ['follow'])] } });
		await f.editFile('Batch.md', changed);
		assert.equal((await f.run()).status, 'unavailable');
		assert.deepEqual(f.writes, []);
		assert.equal(await f.read('Batch.md'), changed);
	}
});

for (const sourceName of ['Members', 'members', 'PARTICIPANTS']) {
	test('mapped aliases survive a mixed YAML and typed inline batch using ' + sourceName, async () => {
		const settings = {
			keyMappings: typedMembers.keyMappings.map(mapping => {
				if (mapping.canonicalKey === 'taskColor') return { ...mapping, visiblePropertyName: 'Color' };
				if (mapping.canonicalKey === 'taskIcon') return { ...mapping, visiblePropertyName: 'Icon' };
				return mapping;
			}),
			inlinePropertyDefinitions: { version: 1, entries: ['Members', 'participants'].map(name =>
				({ sourceName: name, type: 'list', encoding: 'vault-v1' })) },
		};
		const source = '---\noperonId: task900\nparticipants: [Ana, Bob] # members\ntaskColor: "#112233"\ntaskIcon: lucide-bell\nKeep: original\n---\n'
			+ inline(id(0), ' {{' + sourceName + ':: 2; "2"; "A; B"}}');
		const f = await fixture({ 'Batch.md': source }, { settings, rule: {
			actions: [action('participants', ['Lee']), action('taskColor', '#445566'), action('taskIcon', 'lucide-star')],
		} });
		f.frontmatter.get('task900').participants = ['Ana'];
		const result = await f.run();
		assert.equal(result.applied, 2);
		const updated = await f.read('Batch.md');
		const yaml = parseYaml(updated.split('---')[1]);
		assert.deepEqual(yaml.participants, ['Ana', 'Bob', 'Lee']);
		assert.equal(yaml.taskColor, '#445566');
		assert.equal(yaml.taskIcon, 'star');
		for (const alias of ['Members', 'Color', 'Icon']) assert.ok(!Object.hasOwn(yaml, alias));
		assert.ok(updated.includes('# members'));
		assert.equal(yaml.Keep, 'original');
		assert.ok(updated.includes('{{' + sourceName + ':: 2; "2"; "A; B"; Lee}}'));
		assert.deepEqual(f.writes, ['Batch.md']);
	});
}

test('stale typed inline tokens stop the whole note before writing a sibling task', async () => {
	const sibling = inline(id(0), ' {{Members:: Ana}}');
	const row = inline(id(1), ' {{Members:: 2; "2"; "A; B"}}');
	for (const token of [' {{Members:: 2; "unfinished}}', ' {{Members:: 2}} {{Members:: 3}}']) {
		const f = await fixture({ 'Batch.md': sibling + row }, { settings: typedMembers, rule: { actions: [action('participants', ['Lee'])] } });
		const edited = sibling + inline(id(1), token);
		f.confirm = async () => { await f.editFile('Batch.md', edited); return 'apply'; };
		assert.equal((await f.run()).status, 'unavailable');
		assert.deepEqual(f.writes, []);
		assert.equal(await f.read('Batch.md'), edited);
	}
});

test('native aliases cannot shadow a managed YAML list while an independent native action still applies', async () => {
	const overlap = action('file.property:members', 'Zoe');
	const independent = action('file.property:Team', '"New; member"');
	const f = await fixture({ 'Task.md': membersSource('participants: [Ana, Bob]\nTeam: [2, "2"]') }, {
		settings: typedMembers, rule: { actions: [action('participants', ['Lee']), overlap, independent] },
	});
	getNativePropertyIndex(f.app).setTypes({ members: 'multitext', Team: 'multitext' });
	f.native = projectIndexedNativeProperties(f.app, { fields: [] }, [...f.tasks.values()], typedMembers);
	const ctx = { settings: () => typedMembers, nativeType: key => f.native.fields.find(field => field.key === key)?.type };
	const result = await f.run();
	assert.equal(result.applied, 1);
	assert.ok(result.plan.issues.some(issue => issue.field === overlap.field && issue.reason === 'read-only'));
	assert.equal(validAction(overlap, ctx), false);
	assert.equal(validAction(independent, ctx), true);
	const yaml = parseYaml((await f.read('Task.md')).split('---')[1]);
	assert.deepEqual(yaml.participants, ['Ana', 'Bob', 'Lee']);
	assert.deepEqual(yaml.Team, [2, '2', 'New; member']);
	assert.ok(!Object.hasOwn(yaml, 'members') && !Object.hasOwn(yaml, 'Members'));
	assert.deepEqual(f.writes, ['Task.md']);
});

test('typed inline list selections survive settings reload alongside unmarked legacy actions', async () => {
	await withSettingsFixture({ table: false }, async disk => {
		const storage = disk.createStorage();
		await storage.initialize();
		const initial = storage.getSettings().automationRules;
		const rule = createAutomationRule('List members');
		rule.active = true;
		rule.actions = [
			{ ...action('participants', '2'), id: 'act_12345678' },
			{ ...action('participants', '2'), id: 'act_23456789', valueEncoding: 'vault-v1' },
			{ ...action('participants', '"A; B"'), id: 'act_34567890', valueEncoding: 'vault-v1' },
		];
		await storage.saveAutomationRules(initial, { ...readAutomationRules(initial), rules: [rule] });
		const reopened = disk.createStorage();
		await reopened.initialize();
		const [saved] = reopened.getSettings().automationRules.rules;
		assert.deepEqual(saved, rule);
		const f = await fixture({ 'Task.md': inline(id(0)) }, { settings: typedMembers, rule: saved });
		assert.equal((await f.run(rule.id)).applied, 1);
		assert.ok((await f.read('Task.md')).includes('{{Members:: "2"; 2; "A; B"}}'));
	});
});

test('typed inline list picker keeps encoded suggestions and saved row boundaries', async () => {
	const f = await fixture({ 'Mixed.md': inline(id(0), ' {{Members:: 2; "2"; "A; B"}}') }, { settings: typedMembers });
	const candidates = collectNativeFieldValueCandidates(f.app, [...f.tasks.values()], typedMembers.keyMappings, 'Members', 'list', true);
	assert.deepEqual(new Set(candidates), new Set(['2', '"2"', '"A; B"']));
	const ctx = { settings: () => typedMembers };
	for (const [literal, expected] of [
		['2; text', [['2'], ['text']]],
		[['2', 'A; B'], [['2'], ['A; B']]],
	]) {
		const original = action('participants', literal, 'remove');
		const rows = expandListAction(original, ctx, new Set([original.id]));
		assert.deepEqual(rows.map(row => row.value), expected);
		assert.equal(rows[0].id, original.id);
		assert.ok(rows.every(row => validAction(row, ctx) && expandListAction(row, ctx, new Set()).length === 1));
	}
});

test('typed inline list preserves escaped members from the raw source and rejects a stale removal', async () => {
	const raw = String.raw` {{Members:: "C:\\tmp"; 2; "2"}}`;
	const source = inline(id(0), raw);
	const f = await fixture({ 'Task.md': source }, { settings: typedMembers, rule: { actions: [{ ...action('participants', '2', 'remove'), valueEncoding: 'vault-v1' }] } });
	assert.equal((await f.run()).applied, 1);
	assert.ok((await f.read('Task.md')).includes(raw.replace('; 2;', ';')));
	const stale = await fixture({ 'Task.md': source }, { settings: typedMembers, rule: { actions: [{ ...action('participants', '2', 'remove'), valueEncoding: 'vault-v1' }] } });
	const changed = source.replace(raw, '');
	await stale.editFile('Task.md', changed);
	assert.equal((await stale.run()).status, 'unavailable');
	assert.deepEqual(stale.writes, []);
	assert.equal(await stale.read('Task.md'), changed);
});

for (const [operation, color, icon] of [['add', '#445566', 'lucide-star'], ['remove', '#112233', 'lucide-bell']]) {
	test(`managed YAML color and icon ${operation} matches prefixed source values`, async () => {
		const f = await fixture({ 'Task.md': '---\noperonId: task001\ntaskColor: "#112233"\ntaskIcon: lucide-bell\nKeep: untouched\n---\nBody\n' },
			{ rule: { actions: [action('taskColor', color, operation), action('taskIcon', icon, operation)] } });
		assert.equal((await f.run()).applied, 1);
		const content = await f.read('Task.md');
		const data = parseYaml(content.split('---')[1]);
		assert.equal(data.taskColor, operation === 'add' ? '#445566' : null);
		assert.equal(data.taskIcon, operation === 'add' ? 'star' : null);
		assert.equal(data.Keep, 'untouched');
		assert.ok(content.endsWith('---\nBody\n'));
	});
}
test('managed YAML color and icon guard newer source values', async () => {
	const original = '---\noperonId: task001\ntaskColor: "#112233"\ntaskIcon: lucide-bell\n---\nBody\n';
	for (const [field, from, to, value] of [
		['taskColor', '#112233', '#abcdef', '#445566'], ['taskIcon', 'lucide-bell', 'lucide-house', 'star'],
	]) {
		const f = await fixture({ 'Task.md': original }, { rule: { actions: [action(field, value)] } });
		await f.editFile('Task.md', original.replace(from, to));
		assert.equal((await f.run()).status, 'unavailable');
		assert.deepEqual(f.writes, []);
		assert.equal(await f.read('Task.md'), original.replace(from, to));
	}
});
test('modal distinguishes explicit deactivation, dismissal and repeated Apply clicks', t => {
	const originalObserver = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');
	t.after(() => {
		if (originalObserver) Object.defineProperty(globalThis, 'MutationObserver', originalObserver);
		else delete globalThis.MutationObserver;
	});
	const observed = new Set();
	globalThis.MutationObserver = class {
		observe(root) { observed.add(root); this.root = root; }
		takeRecords() { return []; }
		disconnect() { observed.delete(this.root); }
	};
	for (const [button, expected] of [[0,'deactivate'],[1,'apply'],[null,'dismiss']]) {
		const outcomes = [], clicked = [];
		const modal = automationApprovalModal({}, { changedTaskCount: 3, rules: [{ ruleId, changed: 3 }] }, [{ id: ruleId, name: 'Follow up' }], d => outcomes.push(d));
		const el = { empty() {}, addClass() {}, createDiv() { return this; }, ownerDocument: { defaultView: null },
			createEl(tag) { return { addClass() {}, addEventListener(_, cb) { if (tag === 'button') clicked.push(cb); } }; } };
		modal.modalEl.querySelectorAll = () => [];
		modal.contentEl = el; modal.open();
		assert.ok(observed.has(modal.modalEl));
		if (button === null) modal.close(); else { clicked[button](); clicked[button](); }
		assert.deepEqual(outcomes,[expected]);
		assert.equal(observed.size, 0);
	}
});

const asAuto = (rule, key = rule.id, overrides = {}) => ({ ...rule, id: key, name: key, mode: 'auto', ...overrides });

const serialGroup = { id: 'ps_abc', prefix: 'ABC', parentOperonId: id(0), createdAt: asOf, updatedAt: asOf };
const outsideSerialGroup = { ...all, children: [{ id: 'nested', logic: 'all', children: [
	{ id: 'serial-condition', field: 'projectSerialScope', fieldType: 'projectSerialScope', operator: 'isNoneOf', values: [serialGroup.id] },
] }] };
async function serialFixture(section, mode = 'manual', policy = 'always') {
	const files = filesFor(3);
	files[id(1) + '.md'] = inline(id(1), ' {{parentTask:: ' + id(0) + '}}');
	const scopes = [{ ...serialGroup }];
	const f = await fixture(files, { rule: { mode, [section]: outsideSerialGroup }, settings: { projectSerialScopes: scopes }, policy });
	const execute = () => mode === 'manual' ? f.run() : f.auto(new Map([[ruleId, new Set([id(2)])]]));
	return { f, scopes, execute };
}

for (const mode of ['manual', 'auto']) for (const section of ['scope', 'target']) {
	test('Project Serial reference deletion stops ' + mode + ' writes from ' + section, async () => {
		const { f, scopes, execute } = await serialFixture(section, mode, 'none');
		const valid = await execute();
		assert.equal(valid.applied, 1);
		assert.deepEqual(f.writes, [id(2) + '.md']);
		await f.reindexInline(id(2));
		// A new group can reuse the prefix and parent. A saved selection still names the original ID.
		scopes[0] = { ...serialGroup, id: 'ps_replacement' };
		const result = await execute();
		assert.deepEqual(f.writes, [id(2) + '.md']);
		assert.equal(result.status, 'unavailable');
		assert.equal(result.plan.changedTaskCount, null);
		assert.deepEqual(result.plan.changes, []);
		const issue = result.plan.issues.find(item => item.ruleId === ruleId && item.field === section);
		assert.equal(issue?.conditionId, 'serial-condition');
		assert.equal(issue.projectSerialGroupId, serialGroup.id);
		assert.equal(f.prompts.length, 0);
		assert.equal(f.config.rules[0].active, true);
		assert.deepEqual(f.config.rules[0][section], outsideSerialGroup);
		const repaired = structuredClone(f.rule[section]);
		repaired.children[0].children[0].values = [scopes[0].id];
		f.rule[section] = repaired;
		const resumed = await execute();
		assert.equal(resumed.status, 'finished');
		assert.equal(resumed.plan.rules[0].target, 1);
		assert.deepEqual(resumed.plan.issues, []);
	});
}

test('Project Serial reference deletion during confirmation discards the approved write', async () => {
	const { f, scopes, execute } = await serialFixture('target');
	f.confirm = () => { scopes.length = 0; return 'apply'; };
	const result = await execute();
	assert.equal(result.status, 'unavailable');
	assert.deepEqual(f.prompts.map(([p]) => p.changedTaskCount), [1]);
	assert.deepEqual(f.writes, []);
	const notices = [];
	Notice.onNotice = message => notices.push(message);
	try { showAutomationResult(result, false, new Map([[ruleId, f.rule.name]])); }
	finally { Notice.onNotice = null; }
	assert.equal(notices.length, 1);
	for (const text of [f.rule.name, 'Tasks to Update', 'Project Serial Group', serialGroup.id]) assert.ok(notices[0].includes(text), text);
});

test('Project Serial reference deletion at the final write boundary leaves Markdown intact', async () => {
	const { f, scopes, execute } = await serialFixture('scope', 'manual', 'none');
	const before = await f.read(id(2) + '.md');
	f.beforeProcess = () => { scopes.length = 0; };
	assert.equal((await execute()).applied, 0);
	assert.equal(await f.read(id(2) + '.md'), before);
});

test('a missing Project Serial group stops an Auto YAML list write even after renewed approval', async () => {
	const scopes = [{ ...serialGroup }];
	const f = await fixture({ 'Task.md': membersSource('participants: [Ana]') }, {
		settings: { ...typedMembers, projectSerialScopes: scopes },
		rule: { mode: 'auto', target: outsideSerialGroup, actions: [action('participants', ['Lee'])] },
	});
	const edited = membersSource('participants: [Ana, Bob] # user edit');
	f.confirm = async () => {
		if (f.prompts.length === 1) await f.editFile('Task.md', edited);
		else scopes.length = 0;
		return 'apply';
	};
	const trigger = new Map([[ruleId, new Set([id(1)])]]);
	const stopped = await f.auto(trigger);
	assert.equal(stopped.status, 'unavailable');
	assert.ok(stopped.plan.issues.some(issue => issue.projectSerialGroupId === serialGroup.id));
	assert.equal(f.prompts.length, 2);
	assert.deepEqual(f.writes, []);
	assert.equal(await f.read('Task.md'), edited);
	scopes.push(serialGroup);
	f.confirm = () => 'apply';
	assert.equal((await f.auto(trigger)).applied, 1);
	const updated = await f.read('Task.md');
	assert.ok(updated.includes('# user edit'));
	assert.deepEqual(parseYaml(updated.split('---')[1]).participants, ['Ana', 'Bob', 'Lee']);
	assert.equal((await f.auto(trigger)).applied, 0);
	assert.deepEqual(f.writes, ['Task.md']);
});

test('Project Serial references respect Auto event scope and stop a daily batch with an unresolved count', async () => {
	const { f, scopes } = await serialFixture('scope', 'auto', 'none');
	scopes.length = 0;
	const broken = { ...f.rule, scope: { ...all, children: [
		...rootGroup('description', 'text', 'is', id(0)).children, ...outsideSerialGroup.children,
	] } };
	const good = asAuto(f.rule, 'good', { scope: all, target: rootGroup('description', 'text', 'is', id(2)) });
	f.config.rules = [broken, good];
	const outside = await f.auto(new Map([[broken.id, new Set([id(2)])], [good.id, new Set([id(2)])]]));
	assert.equal(outside.applied, 1);
	assert.deepEqual(outside.plan.rules.map(item => item.ruleId), ['good']);
	await f.reindexInline(id(2));
	good.target = rootGroup('description', 'text', 'is', id(0));
	const daily = await f.auto(new Map([[broken.id, 'day'], [good.id, 'day']]));
	assert.equal(daily.status, 'unavailable');
	assert.equal(daily.plan.rules.find(item => item.ruleId === broken.id).changed, null);
	assert.deepEqual(f.writes, [id(2) + '.md']);
	assert.deepEqual(f.prompts, []);
});

test('Project Serial reference deletion identifies the editor section and allows an inactive draft to be repaired', async () => {
	const { f, scopes } = await serialFixture('scope');
	const editor = new AutomationRuleModal({}, { getSettings: () => ({ ...DEFAULT_SETTINGS, projectSerialScopes: scopes }),
		getTasks: () => [...f.tasks.values()], getNativeSnapshot: () => null, plan: f.preview }, f.rule, async () => assert.fail('invalid active rule saved'));
	editor.loadFields();
	editor.editors.push({}, {});
	let summary;
	editor.summary = { setText: text => { summary = text; } };
	editor.save = { disabled: false };
	editor.updateCounts();
	assert.equal(editor.save.disabled, false);
	scopes.length = 0;
	editor.updateCounts();
	assert.equal(editor.save.disabled, true);
	for (const text of ['Tasks in Scope', 'Project Serial Group', serialGroup.id]) assert.ok(summary.includes(text), text);
	await editor.submit();
	editor.draft.active = false;
	assert.equal(editor.canSave(), true);
	editor.draft.active = true;
	scopes.push({ ...serialGroup, prefix: 'NEW' });
	editor.updateCounts();
	assert.equal(editor.save.disabled, false);
	assert.equal(summary.includes(serialGroup.id), false);
});

test('a change inside scope runs all targets in one batch, counting shared effects only once', async () => {
	const f = await fixture(filesFor(3), { policy: 5 });
	const a = asAuto(f.rule);
	const b = asAuto(a, 'other', { target: rootGroup('description', 'text', 'is', id(0)), actions: [action('priority','High')] });
	const outside = asAuto(a, 'outside', { scope: rootGroup('description','text','is',id(2)), actions: [action('note','wrong')] });
	f.config.rules = [a, b, outside];
	const triggers = new Map(f.config.rules.map(rule => [rule.id, new Set([id(0)])]));
	const result = await f.auto(triggers);
	assert.equal(result.applied, 3); assert.equal(f.prompts.length, 0);
	assert.deepEqual(result.plan.rules.map(r => [r.ruleId, r.changed]), [[a.id,3],[b.id,1]]);
	for (const file of f.writes) assert.doesNotMatch(await f.read(file), /wrong/u);
});

test('only rules listed in the multi-rule confirmation can be deactivated', async () => {
	const f = await fixture(filesFor(2));
	const a = asAuto(f.rule), b = asAuto(a, 'second'), noEffect = asAuto(a, 'no-effect', { actions: [] });
	f.config.rules = [a, b, noEffect]; f.confirm = () => 'deactivate';
	const result = await f.auto(new Map(f.config.rules.map(rule => [rule.id, new Set([id(0)])])));
	assert.equal(f.prompts.length, 1); assert.equal(f.prompts[0][0].changedTaskCount, 2);
	assert.deepEqual(f.prompts[0][1].map(rule => rule.id), [a.id,b.id]);
	assert.deepEqual(result.names, [a.id,b.id]); assert.deepEqual(f.config.rules.map(rule => rule.active), [false,false,true]);
	assert.deepEqual(f.writes, []);
});

test('two Auto rules that oppose each other leave the conflicting task untouched', async () => {
	const f = await fixture(filesFor(2)); const a = asAuto(f.rule);
	const b = asAuto(a, 'opposed', {target: rootGroup('description','text','is', id(1)), actions: [action('tags','follow','remove')]});
	f.config.rules = [a,b];
	const result = await f.auto(new Map([[a.id,new Set([id(0)])],[b.id,new Set([id(0)])]]));
	assert.equal(result.applied,1); assert.ok(result.plan.issues.some(issue => issue.reason === 'conflict'));
	assert.deepEqual(f.writes, [id(0)+'.md']);
});

test('Auto waits behind an open Manual confirmation and checks its current scope', async () => {
	const f = await fixture(filesFor(2)); const a = asAuto(f.rule, 'auto');
	f.config.rules.push(a);
	const entered = Promise.withResolvers(), release = Promise.withResolvers();
	f.confirm = () => { entered.resolve(); return release.promise; };
	const manual = f.run(); await entered.promise;
	const automatic = f.auto(new Map([[a.id, new Set([id(0)])]]));
	assert.equal(f.prompts.length, 1);
	a.scope = rootGroup('description','text','is',id(1)); release.resolve('dismiss');
	assert.equal((await manual).status, 'dismissed'); assert.equal((await automatic).applied, 0);
	assert.deepEqual(f.writes, []); assert.equal(f.prompts.length, 1);
});

test('writer registers an owned source after a lost acknowledgement is recovered by exact readback', async () => {
	const f = await fixture(filesFor(1)); f.syncThrows = true;
	const seen = new Set();
	f.observeSource = async (ids, file, destination, content) => {
		assert.equal(destination, file.path); assert.match(content, /#follow/u);
		return () => { for (const key of ids) seen.add(key); };
	};
	assert.equal((await f.run()).applied, 1); assert.deepEqual([...seen], [id(0)]);
});

function eventFixture(overrides = {}) {
	const tasks = new Map([['a', {core:'a'}], ['b', {core:'b'}]]);
	const pins = new Map(), batches = [], runs = [];
	const events = new AutoAutomationEvents({
		taskIds: () => tasks.keys(), image: key => tasks.get(key),
		pins: () => [...pins].filter(([,p]) => p.pinned).map(([key]) => key), pin: key => pins.get(key) ?? null,
		today: () => asOf.slice(0,10), foreground: () => true,
		settled: () => true, currentPath: key => key, settle: async () => {}, run: take => { runs.push(take); return new Promise(resolve => queueMicrotask(resolve)).then(async () => {
			const { rules } = await take(); if (rules.size) batches.push([...rules].map(([key,ids]) => [key,ids === 'day' ? ids : [...ids]]));
		}); }, error: error => { throw error; }, ...overrides,
	});
	const rule = { id:'r', mode:'auto', active:true, scope:all, target:all }, settle = () => new Promise(resolve => setImmediate(resolve));
	return { tasks, pins, batches, runs, events, rule, settle };
}

test('rule changes reach Auto and open Settings through Restore, Undo, deactivation and Copy', async () => {
	await withSettingsFixture({ table: false }, async disk => {
		const storage = disk.createStorage();
		await storage.initialize();
		const { events, tasks, batches, settle } = eventFixture();
		const rules = () => readAutomationRules(storage.getSettings().automationRules).rules;
		const stopWatching = storage.subscribeAutomationRules(() => events.configure(rules()));
		const { doc, emitWindow, windowListeners } = statusDockDocument();
		const host = doc.body.createDiv();
		const closeList = mountAutomationRules({}, host, storage, {});
		const cards = () => host.querySelectorAll('.operon-filter-set-card');
		const status = card => card.querySelectorAll('.operon-settings-list-card-chip-label').at(-1).textContent;
		const draft = { ...createAutomationRule('Watch queue'), active: true, mode: 'auto' };
		draft.target.children = structuredClone(outsideSerialGroup.children);
		draft.actions = [
			{ ...action('participants', '2'), id: 'act_12345678' },
			{ ...action('participants', '2'), id: 'act_23456789', valueEncoding: 'vault-v1' },
			{ ...action('participants', '"A; B"'), id: 'act_34567890', valueEncoding: 'vault-v1' },
		];
		await storage.saveAutomationRules(undefined, { ...readAutomationRules(undefined), rules: [draft] });
		assert.equal(status(cards()[0]), t('settings', 'automationActive'));
		tasks.set('a', { core: 'first edit' });
		events.reconcile(['a']);
		await settle();
		assert.deepEqual(batches, [[[draft.id, ['a']]]]);

		const imported = { ...createAutomationRule('Restored queue'), active: true, mode: 'auto' };
		imported.actions = [{ ...action('participants', '"A; B"', 'remove'), id: 'act_abcdef12', valueEncoding: 'vault-v1' }];
		const backup = exportOperonSettingsBackupJsonV1({
			settings: { ...storage.getSettings(), automationRules: { ...readAutomationRules(undefined), rules: [imported] } },
			source: { pluginVersion: '4.8.0', obsidianVersion: '1.13.0', dataPackageSchemaVersion: 2 },
			createdAt: '2026-11-20T12:00:00.000Z',
		});
		assert.equal(backup.ok, true);
		const { restorePlan } = preflightOperonSettingsBackupRestoreV1({
			sourceJson: backup.json, targetSnapshot: await storage.captureCommittedSettingsBackupSnapshot(), selectedGroups: ['automations'],
		});
		assert.ok(restorePlan);
		const restored = await storage.applySettingsBackupRestorePlanV1({
			sourceJson: backup.json, restorePlan, acknowledgement: createOperonSettingsBackupApplyAcknowledgementV1(restorePlan),
			appliedAt: '2026-11-20T13:00:00.000Z', refreshedVaultReferenceChecks: restorePlan.vaultReferenceChecks,
		});
		assert.equal(restored.status, 'success');
		const title = () => cards()[0].querySelector('.operon-settings-list-card-title').textContent;
		assert.equal(title(), imported.name);
		assert.deepEqual(rules()[0].actions, imported.actions);
		assert.equal(status(cards()[0]), t('settings', 'automationInactive'));
		tasks.set('a', { core: 'while restored rules are inactive' });
		events.reconcile(['a']);
		await settle();
		assert.equal(batches.length, 1);
		const receipt = restored.receipt;
		const undo = await storage.undoSettingsBackupRestoreV1(receipt.recovery.undoTokenId, receipt.receiptId);
		assert.equal(undo.status, 'success');
		assert.equal(title(), draft.name);
		assert.deepEqual(rules()[0], draft);
		assert.equal(status(cards()[0]), t('settings', 'automationActive'));
		await settle();
		assert.equal(batches.length, 1, 'Undo only establishes a baseline');
		tasks.set('b', { core: 'after Undo' });
		events.reconcile(['b']);
		await settle();
		assert.deepEqual(batches[1], [[draft.id, ['b']]]);

		assert.equal(await deactivateAutomationRules(storage, [draft]), true);
		assert.equal(status(cards()[0]), t('settings', 'automationInactive'));
		tasks.set('a', { core: 'after deactivation' });
		events.reconcile(['a']);
		await settle();
		assert.equal(batches.length, 2);

		const copyLabel = t('table', 'duplicatePreset') + ' · ' + draft.name;
		const copy = cards()[0].querySelectorAll('.operon-settings-list-card-action')
			.find(button => button.querySelector(':scope > [data-operon-accessible-label="true"]').textContent === copyLabel);
		assert.ok(copy, 'the inactive card still offers Copy');
		const copied = new Promise(resolve => {
			const unsubscribe = storage.subscribeAutomationRules(() => { unsubscribe(); resolve(); });
		});
		copy.click();
		await copied;
		const [original, duplicate] = rules();
		assert.equal(original.id, draft.id);
		assert.notEqual(duplicate.id, original.id);
		assert.equal(duplicate.active, false);
		assert.deepEqual(duplicate.target.children, original.target.children);
		assert.deepEqual(duplicate.actions, original.actions);
		assert.equal(cards().length, 2);
		emitWindow('pagehide', {});
		assert.equal(windowListeners.get('pagehide').size, 0);
		await storage.saveAutomationRules(storage.getSettings().automationRules, readAutomationRules(undefined));
		assert.equal(cards().length, 2, 'closing the window removes the subscription even if the host skips cleanup');
		closeList();
		stopWatching();
		events.dispose();
	});
});

test('startup, activation and a full rebuild are silent; real indexed changes coalesce per task', async () => {
	const { tasks, batches, events, rule, settle } = eventFixture();
	events.configure([]); tasks.set('c',{core:'created'}); events.reconcile(['c']);
	events.configure([rule]); tasks.set('admitted',{core:'from previously excluded folder'}); events.rebase();
	events.reconcile(['a','b','c','admitted']); await settle(); assert.deepEqual(batches, []);
	tasks.set('a',{core:'typed in Markdown'}); events.reconcile(['a','b']); events.reconcile(['a']);
	tasks.set('d',{core:'new'}); events.reconcile(['d']); tasks.delete('d'); events.reconcile(['d']);
	tasks.set('e',{core:'new'}); events.reconcile(['e']); await settle();
	assert.deepEqual(batches, [[['r',['a','e']]]]);
});

test('own delayed index/pin/parent writes coalesce, while a newer edit to the same task runs', async () => {
	const { tasks, pins, batches, events, rule, settle } = eventFixture(); events.configure([rule]);
	const since = events.beginSource();
	for (const key of ['a','b']) {
		const after = {core:'automatic '+key}; events.ownSource(key, after, since);
		tasks.set(key, after); events.reconcile([key]);
	}
	events.ownPin('a', true, 'auto'); pins.set('a', {pinned:true,updatedAt:'auto'}); events.pinsChanged();
	tasks.set('b',{core:'a genuine concurrent edit'}); events.reconcile(['b']);
	await settle(); assert.deepEqual(batches, [[['r',['b']]]]);
	events.reconcile(['a','b']); events.pinsChanged(); await settle(); assert.equal(batches.length,1);
	pins.set('a',{pinned:false,updatedAt:'user'}); events.pinsChanged(); await settle();
	assert.deepEqual(batches[1], [['r',['a']]]);
});

test('rule edits, disabling and unloading discard stale queued observations', async () => {
	const { tasks, batches, events, rule, settle } = eventFixture();
	events.configure([rule]); tasks.set('a',{core:'updated'}); events.reconcile(['a']);
	events.configure([{...rule,name:'edited'}]); await settle(); assert.deepEqual(batches, []);
	tasks.set('b',{core:'edited'}); events.reconcile(['b']); events.configure([]); events.configure([rule]); await settle();
	assert.deepEqual(batches, []);
	tasks.set('a',{core:'last'}); events.reconcile(['a']); events.dispose(); await settle(); assert.deepEqual(batches, []);
});

test('activation ignores already queued edits but preserves new edits while the index settles', async () => {
	const waiting = Promise.withResolvers();
	const {tasks,batches,events,rule,settle} = eventFixture({settled:()=>false,settle:()=>waiting.promise});
	events.configure([rule]);
	tasks.set('a',{core:'old edit indexed after activation'}); events.reconcile(['a']);
	events.fileChanged('b'); tasks.set('b',{core:'new edit'}); events.reconcile(['b']);
	waiting.resolve(); await settle(); assert.deepEqual(batches, [[['r',['b']]]]);
});

test('closing an invalidated multi-rule modal rechecks the surviving Auto rule', async () => {
	const f = await fixture(filesFor(2)); const a = asAuto(f.rule), b = asAuto(a,'second');
	f.config.rules = [a,b]; f.confirm = () => {
		if (f.prompts.length === 1) { b.active = false; return 'replan'; }
		return 'apply';
	};
	const result = await f.auto(new Map([[a.id,new Set([id(0)])],[b.id,new Set([id(0)])]]));
	assert.equal(result.applied,2);
	assert.deepEqual(f.prompts.map(([,rules]) => rules.map(rule => rule.id)), [[a.id,b.id],[a.id]]);
});

test('real rescans distinguish a sibling Sync edit from the automation write to the same Markdown file', async () => {
	const file = new TFile('Source.md'); file.stat = {mtime:1,ctime:1,size:1};
	const app = {vault:{getAbstractFileByPath:()=>file,read:async()=>content}, metadataCache:{getFileCache:()=>({})}};
	let content = inline(id(0),' {{Team:: Alpha}}') + inline(id(1),' {{Team:: Alpha}}');
	const native = getNativePropertyIndex(app); native.configure(DEFAULT_SETTINGS); native.setTypes({team:'text'});
	const index = new OperonIndexer(app,{getSettings:()=>DEFAULT_SETTINGS});
	try {
		await index.reindexFilePath(file.path);
		const {events,rule,batches,settle} = eventFixture({
			taskIds:()=>index.getAllTasks().map(task=>task.operonId),
			image:key=>{const task=index.getTask(key); return task && automationTaskImage(task,native);},
			settle:()=>index.awaitRamSettlement(),
		});
		events.configure([rule]);
		const off = index.subscribeIndexReconciliation(event => events.reconcile(event.affectedOperonIds));
		const since = events.beginSource(); const after = content.replace('Alpha','Beta');
		const projected = await index.projectAutomationSource(file,after);
		for (const task of projected.tasks) if (task.operonId === id(0)) events.ownSource(task.operonId,automationTaskImage(task,projected.native),since);
		projected.native.dispose();
		content = after.replace('Alpha','Gamma'); file.stat.mtime++;
		await index.reindexFilePath(file.path); await settle(); off();
		assert.deepEqual(batches, [[['r',[id(1)]]]]);
	} finally {index.destroy();}
});

test('native properties are isolated per inline task; startup hydration of a file task retains real stored dates', () => {
	const file = new TFile('Tasks.md'); file.stat = {mtime:1,size:1,ctime:1};
	const frontmatter = {operonId:id(1),datetimeModified:'2026-01-01T12:00:00'};
	const app = {vault:{getAbstractFileByPath: () => file},metadataCache:{getFileCache: () => ({frontmatter})}};
	const native = new NativePropertyIndex(app); native.configure(DEFAULT_SETTINGS); native.setTypes({team:'text'});
	const a = {operonId:id(0),fieldValues:{},tags:[],description:'a',checkbox:'open',primary:{format:'inline',filePath:file.path,lineNumber:0}};
	const b = {...a,operonId:id(1),description:'b',primary:{...a.primary,lineNumber:1}};
	const yaml = {...a,operonId:id(1),primary:{...a.primary,format:'yaml'}};
	const fields = (task, team) => ({operonId:task.operonId,lineNumber:task.primary.lineNumber,fields:
		[['operonId',task.operonId],['Team',team]].map(([key,value])=>({sourceKey:key,key,value,rawValue:value}))});
	const raw = {frontmatter,order:Object.keys(frontmatter),inline:[fields(a,'X'),fields(b,'Y')]};
	native.restore(file.path, native.persistSource(raw), '1:1');
	const before = automationTaskImage(yaml,native);
	native.accept(file.path,raw,false);
	assert.deepEqual(automationTaskImage(yaml,native), before);
	const imageA = automationTaskImage(a,native), imageB = automationTaskImage(b,native);
	native.accept(file.path,{...raw,frontmatter:{...frontmatter,datetimeModified:'2026-02-02T12:00:00'},inline:[fields(a,'Z'),fields(b,'Y')]},false);
	assert.notEqual(automationTaskImage(a,native).native,imageA.native); assert.deepEqual(automationTaskImage(b,native),imageB);
	assert.notEqual(automationTaskImage(yaml,native).dates,before.dates);
});

const dueToday = rootGroup('dateDue','date','isToday');
const calendarRule = (rule, overrides = {}) => asAuto(rule, 'daily', {target:dueToday, ...overrides});
const dueFiles = (...days) => Object.fromEntries(days.map((day, i) => [id(i)+'.md',inline(id(i),' {{dateDue:: '+day+'}}')]));

function watchCalendar(f) {
	let visible = true, current;
	const results = [];
	const { events } = eventFixture({
		today: () => f.now.slice(0,10), foreground: () => visible,
		pins: () => f.pins.getPinnedIds(), pin: key => f.pins.getCanonicalEntry(key),
		taskIds: () => f.tasks.keys(), image: key => {
			const task = f.tasks.get(key); return task && {core:JSON.stringify(task)};
		},
		run: take => { current = f.runBatch(take).then(result => { results.push(result); }); return current; },
	});
	f.events = events; events.configure(f.config.rules);
	return { events, results, visible: value => { visible=value; events.wake(); },
		idle: async () => {
			let observed;
			do { observed=current; await observed; await new Promise(resolve=>setImmediate(resolve)); } while (observed !== current);
		} };
}

const carRule = { mode: 'auto', target: rootGroup('taskIcon', 'text', 'endsWith', 'car'),
	actions: [action('tags', 'formula1'), action('dateScheduled', '2026-11-21')] };
async function pendingCarRule(settlesDuringPlan) {
	const f = await fixture({ 'Task.md': inline(id(0)) }, { rule: carRule });
	f.now = asOf;
	const watcher = watchCalendar(f);
	await f.editFile('Task.md', inline(id(0), ' {{taskIcon:: car}}'));
	await f.reindexInline(id(0));
	if (settlesDuringPlan) {
		f.known = false;
		f.planReady = () => {
			queueMicrotask(() => { f.known = true; });
			return f.known;
		};
	} else f.staleIndex = true;
	watcher.events.reconcile([id(0)]);
	await watcher.idle();
	assert.deepEqual(watcher.results.map(result => result.status), ['deferred']);
	assert.equal(f.prompts.length, 0);
	assert.deepEqual(f.writes, []);
	return { f, watcher };
}

for (const outcome of ['ready', 'settled during planning', 'icon removed', 'inactive', 'deleted', 'edited', 'dismissed', 'expired']) {
	test('Auto retains one car icon trigger during index lag: ' + outcome, async t => {
		t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date(asOf) });
		t.mock.method(globalThis.activeWindow, 'setTimeout', globalThis.setTimeout);
		t.mock.method(globalThis.activeWindow, 'clearTimeout', globalThis.clearTimeout);
		const { f, watcher } = await pendingCarRule(outcome === 'settled during planning');
		t.after(() => watcher.events.dispose());
		if (outcome === 'icon removed') {
			await f.editFile('Task.md', inline(id(0)));
			await f.reindexInline(id(0));
		}
		if (outcome === 'inactive' || outcome === 'deleted' || outcome === 'edited') {
			if (outcome === 'inactive') f.rule.active = false;
			if (outcome === 'deleted') f.config.rules = [];
			if (outcome === 'edited') f.rule.name = 'Edited rule';
			watcher.events.configure(f.config.rules);
		}
		f.confirm = () => {
			assert.deepEqual(f.writes, []);
			return outcome === 'dismissed' ? 'dismiss' : 'apply';
		};
		f.staleIndex = outcome === 'expired';
		watcher.events.reconcile([id(0)]);
		watcher.events.reconcile([id(0)]);
		t.mock.timers.tick(outcome === 'expired' ? 5001 : 400);
		await watcher.idle();
		const run = watcher.results.at(-1);
		if (outcome === 'ready' || outcome === 'settled during planning') {
			assert.equal(run.applied, 1);
			assert.equal(f.prompts.length, 1);
			assert.deepEqual(f.writes, ['Task.md']);
			const note = await f.read('Task.md');
			assert.match(note, /#formula1/u);
			assert.match(note, /dateScheduled:: 2026-11-21/u);
		} else {
			assert.deepEqual(f.writes, []);
			assert.equal(f.prompts.length, outcome === 'dismissed' ? 1 : 0);
			if (outcome === 'expired') {
				assert.equal(run.status, 'unavailable');
				assert.equal(run.reason, 'index-pending');
			}
		}
		const count = watcher.results.length;
		t.mock.timers.tick(10000);
		await watcher.idle();
		assert.equal(watcher.results.length, count);
	});
}

test('local-day eligibility comes from filter operators on nested scope or target fields', () => {
	for (const [field,type,operator,wanted] of [
		['dateDue','date','afterToday',true],['custom','datetime','exactlyDaysAgo',true],
		['file.property:Trip','date','nextWeek',true],['happensOn','date','lastMonth',true],
		['trackedOn','date','inLastDays',true],['trackedOn','date','between',false],
		['dateDue','date','dateIs',false],['dateDue','date','dayOfWeekIs',false],
		['dateDue','date','monthIs',false],['file.property:Trip','date','propPresent',false],
		['description','text','isToday',false],['custom','date','inLastDays',false],
	]) assert.equal(filterUsesLocalDay({...all, logic:'none', children:[{...all,logic:'any',children:[rootGroup(field,type,operator,'3')]}]}),wanted,operator);
});

test('startup and wake use only the current day; saving and activating do not run until the next day', async () => {
	let day = '2026-12-31';
	const f = eventFixture({today:()=>day});
	const initial = calendarRule(f.rule, {scope:dueToday,target:all});
	f.events.configure([initial, {...initial,id:'manual',mode:'manual'}, {...initial,id:'constant',scope:all,target:all},
		{...initial,id:'inactive',active:false}]);
	f.events.wake(); f.events.wake(); await f.settle(); assert.deepEqual(f.batches,[[['daily','day']]]);
	const later = {...initial,id:'added'}; f.events.configure([initial,later]); f.events.wake();
	await f.settle(); assert.equal(f.batches.length,1);
	day='2027-01-04'; f.events.wake(); f.events.wake(); await f.settle();
	assert.deepEqual(f.batches[1],[['daily','day'],['added','day']]); assert.equal(f.batches.length,2);
	f.events.dispose(); day='2027-01-05'; f.events.wake(); await f.settle(); assert.equal(f.batches.length,2);
});

test('date and task events share one graph, one confirmation and one write per affected task', async () => {
	const f=await fixture(dueFiles('2026-12-31','2026-12-31','2027-01-01')); f.now='2026-12-31T10:00:00';
	const everyday=calendarRule(f.rule), edited=asAuto(f.rule,'on-edit',{actions:[action('priority','High')]});
	f.config.rules=[everyday,edited]; const watched=watchCalendar(f);
	await f.pins.pin(id(0)); watched.events.wake(); watched.events.pinsChanged();
	await watched.idle();
	assert.equal(f.prompts.length,1); assert.equal(f.prompts[0][0].changedTaskCount,3);
	assert.deepEqual(f.prompts[0][0].rules.map(r=>[r.ruleId,r.changed]),[['daily',2],['on-edit',3]]);
	assert.equal(f.writes.length,3); assert.match(await f.read(id(0)+'.md'),/#follow/u);
	assert.doesNotMatch(await f.read(id(2)+'.md'),/#follow/u);
});

test('an opening that needs approval releases the queue in the background and recomputes on return', async () => {
	const f=await fixture(dueFiles('2026-12-31','2027-01-01','2027-01-01')); f.now='2026-12-31T23:50:00';
	f.config.rules=[f.rule,calendarRule(f.rule)]; const watched=watchCalendar(f); watched.visible(false); await watched.idle();
	assert.equal(watched.results.at(-1).status,'deferred'); assert.equal(f.prompts.length,0);
	f.confirm=()=> 'dismiss'; assert.equal((await f.run()).status,'dismissed');
	assert.equal(f.prompts.length,1);
	f.now='2027-01-01T08:00:00'; watched.visible(true); await watched.idle();
	assert.equal(f.prompts.length,2); assert.equal(f.prompts[1][0].changedTaskCount,2);
	watched.visible(false); watched.visible(true); await watched.idle(); assert.equal(f.prompts.length,2);
	assert.deepEqual(f.writes,[]); watched.events.dispose();
	const reopened=watchCalendar(f); reopened.events.wake(); await reopened.idle();
	assert.equal(f.prompts.length,3); assert.equal(f.prompts[2][0].changedTaskCount,2);
});

test('background work below the threshold applies and a later day preserves the previous label', async () => {
	const f=await fixture(dueFiles('2027-01-31'),{policy:5}); f.now='2027-01-31T18:00:00';
	f.config.rules=[calendarRule(f.rule)]; const watched=watchCalendar(f); watched.visible(false); await watched.idle();
	assert.equal(f.prompts.length,0); assert.equal(f.writes.length,1);
	await f.reindexInline(id(0)); f.now='2027-02-01T00:00:00'; watched.events.wake(); await watched.idle();
	assert.match(await f.read(id(0)+'.md'),/#follow/u); assert.equal(f.writes.length,1);
	const remove=calendarRule(f.rule,{id:'remove-old',target:rootGroup('dateDue','date','beforeToday'),actions:[action('tags','follow','remove')]});
	f.config.rules.push(remove); watched.events.configure(f.config.rules); await watched.idle(); assert.equal(f.writes.length,1);
	f.now='2027-02-02T00:00:00'; watched.events.wake(); await watched.idle();
	assert.doesNotMatch(await f.read(id(0)+'.md'),/#follow/u); assert.equal(f.writes.length,2);
});

test('midnight during an approval rechecks current targets even when their count is unchanged', async () => {
	const f=await fixture(dueFiles('2026-12-31','2027-01-01')); f.now='2026-12-31T23:59:58';
	f.config.rules=[calendarRule(f.rule)]; const watched=watchCalendar(f);
	f.confirm=()=>{if(f.prompts.length===1){ f.now='2027-01-01T00:00:01'; } return 'apply';};
	watched.events.wake(); await watched.idle(); assert.equal(f.prompts.length,2);
	assert.deepEqual(f.prompts.map(([p])=>p.changedTaskCount),[1,1]); assert.deepEqual(f.writes,[id(1)+'.md']);
});

test('deactivating or unloading discards a deferred approval without replaying it', async () => {
	for(const stop of ['disable','unload']){
		const f=await fixture(dueFiles('2027-01-01')); f.now='2027-01-01T02:00:00';
		const rule=calendarRule(f.rule); f.config.rules=[rule]; const watched=watchCalendar(f);
		watched.visible(false); await watched.idle(); assert.equal(watched.results.at(-1).status,'deferred');
		if(stop==='disable'){rule.active=false;watched.events.configure(f.config.rules);} else watched.events.dispose();
		watched.visible(true); await watched.idle(); assert.equal(f.prompts.length,0); assert.equal(f.writes.length,0);
	}
});

test('a task edit and a date change during approval resolve opposing actions together', async () => {
	const f = await fixture(dueFiles('2026-12-31','2027-01-01'));
	f.now = '2026-12-31T23:59:58';
	const daily = calendarRule(f.rule);
	const opposite = asAuto(f.rule,'remove-on-edit',{target:rootGroup('description','text','is',id(1)), actions:[action('tags','follow','remove')]});
	f.config.rules = [daily, opposite];
	const watched = watchCalendar(f);
	f.confirm = async () => {
		f.now = '2027-01-01T00:00:01';
		await f.pins.pin(id(1));
		watched.events.pinsChanged();
		return 'apply';
	};
	watched.events.wake();
	await watched.idle();
	assert.equal(f.prompts.length,1);
	assert.deepEqual(f.writes,[]);
	assert.ok(watched.results.some(result => result.plan?.issues.some(issue => issue.reason === 'conflict')));
});

test('a visible calendar approval that loses focus requires confirmation again on return', async () => {
	const f = await fixture(dueFiles('2027-01-01'));
	f.now = '2027-01-01T01:00:00';
	f.config.rules = [calendarRule(f.rule)];
	const watched = watchCalendar(f);
	f.confirm = () => { watched.visible(false); return 'background'; };
	watched.events.wake();
	await watched.idle();
	assert.equal(watched.results.at(-1).status,'deferred');
	f.config.confirmation = 'none';
	f.confirm = () => 'apply';
	watched.visible(true); await watched.idle();
	assert.equal(f.prompts.length,2);
	assert.deepEqual(f.writes,[id(0)+'.md']);
});

test('one workspace clock follows local midnight, both DST transitions and popout wake after sleep', async t => {
	const originalZone = process.env.TZ;
	process.env.TZ = 'America/New_York';
	t.after(() => { if (originalZone === undefined) delete process.env.TZ; else process.env.TZ = originalZone; });
	t.mock.timers.enable({apis:['Date'], now: Date.parse('2027-03-14T04:59:00Z')});
	const setTime = iso => t.mock.timers.setTime(Date.parse(iso));
	const makeWindow = () => {
		const win = new EventTarget();
		win.document = new EventTarget();
		win.document.defaultView = win;
		return win;
	};
	const primary = makeWindow(), popout = makeWindow();
	const listeners = new Map(), cleanup = [];
	const app = { workspace: {
		containerEl: {ownerDocument:primary.document},
		on: (kind, fn) => { listeners.set(kind,fn); return kind; },
	} };
	const owner = { register: fn => cleanup.push(fn), registerEvent: key => cleanup.push(() => listeners.delete(key)) };
	let tick, timers = 0, wakeCount = 0;
	primary.setInterval = (fn, delay) => { assert.equal(delay,30_000); timers++; tick = fn; return 17; };
	primary.clearInterval = token => { assert.equal(token,17); timers--; };
	const f = eventFixture({today:localToday});
	f.events.configure([calendarRule(f.rule)]);
	registerWorkspaceDayRefresh(owner, app, () => { wakeCount++; f.events.wake(); });
	await f.settle();
	assert.equal(timers,1); assert.equal(f.batches.length,1);
	setTime('2027-03-14T05:00:01Z'); tick(); await f.settle();
	assert.equal(f.batches.length,2);
	setTime('2027-03-14T06:59:59Z'); tick();
	setTime('2027-03-14T07:00:01Z'); tick();
	listeners.get('window-open')(null,popout); await f.settle();
	assert.equal(f.batches.length,2);
	setTime('2027-11-07T05:59:59Z'); popout.dispatchEvent(new Event('pageshow'));
	tick(); await f.settle(); assert.equal(f.batches.length,3);
	setTime('2027-11-07T06:00:01Z'); popout.document.dispatchEvent(new Event('visibilitychange'));
	await f.settle(); assert.equal(f.batches.length,3);
	setTime('2028-01-01T10:00:00Z'); primary.dispatchEvent(new Event('focus'));
	popout.dispatchEvent(new Event('focus')); tick(); await f.settle(); assert.equal(f.batches.length,4);
	listeners.get('window-close')(null,popout); const afterClose = wakeCount;
	popout.dispatchEvent(new Event('focus')); assert.equal(wakeCount,afterClose);
	cleanup.reverse().forEach(fn=>fn()); f.events.dispose();
	primary.document.dispatchEvent(new Event('visibilitychange')); assert.equal(wakeCount,afterClose);
	assert.equal(timers,0); assert.equal(listeners.size,0);
});
