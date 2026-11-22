import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const { outputFiles } = await build({
	stdin: {
		contents: "export * from './src/core/operon-uri'; export * from './src/core/operon-command-catalog';",
		resolveDir: fileURLToPath(new URL('..', import.meta.url)),
	},
	bundle: true, write: false, platform: 'node', format: 'esm',
});
const { buildOperonUri, parseOperonUri, buildOperonCommandCatalog, resolveOperonCommand } =
	await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`);

const item = (id, name) => ({ id, name });
const presets = {
	table: [item('tp_a1b2c3d', 'Projects'), item('local', 'Local')],
	kanban: [item('kp_c3d4e5f', 'Sprint')], filter: [item('f_1', 'Today')], calendar: [item('c_1', 'Week')],
};
const rules = ['manual', 'auto'].flatMap(mode => [true, false].map(active => ({
	id: `ar_${mode}_${active}`, name: `${mode} ${active}`, mode, active,
})));
const source = {
	presets, rules, defaultTableId: 'tp_a1b2c3d', desktop: true, fileTableIds: new Set(['tp_a1b2c3d']),
	commands: [item('open-task-creator', 'Create New Operon Task'), item('toggle-global-timer', 'Start/stop timer'),
		item('toggle-timer', 'Start/stop time tracker'), item('open-kanban-view', 'Operon Kanban'),
		item('open-mini-calendar', 'Open mini calendar'), item('open-flow-time', 'Open FlowTime panel')],
};
const catalog = buildOperonCommandCatalog(source);
const base = 'obsidian://operon?vault=Stratejya';
const tab = (view, preset) => ({ kind: 'view', view, ...(preset === undefined ? {} : { preset }), paneType: 'tab' });
const lightbox = preset => ({ ...tab('table', preset), paneType: 'lightbox' });
const readTarget = uri => parseOperonUri(uri).target;

for (const view of Object.keys(presets)) {
	test(`${view} default and named tab routes round trip with stable palette IDs`, () => {
		const { id, name } = presets[view][0];
		const surface = view[0].toUpperCase() + view.slice(1);
		for (const [preset, title] of [[undefined, 'Default'], [id, name]]) {
			const target = tab(view, preset);
			const uri = base + '&view=' + view + (preset ? '&preset=' + preset : '');
			assert.equal(buildOperonUri('Stratejya', target), uri);
			assert.deepEqual(parseOperonUri(uri), { vault: 'Stratejya', target });
			assert.deepEqual(readTarget(uri + '&paneType=tab'), target);
			const { entry } = resolveOperonCommand(target, catalog);
			assert.equal(entry.name, `Open ${surface} › ${title} › New Tab`);
			if (!preset) assert.equal(entry.id, `open-${view}-view`);
		}
	});
}

test('each catalog entry has a unique local ID and resolves from its own URI', () => {
	assert.equal(new Set(catalog.entries.map(entry => entry.id)).size, catalog.entries.length);
	for (const entry of catalog.entries) {
		const target = readTarget(buildOperonUri('Stratejya', entry.target));
		assert.deepEqual(target, entry.target);
		assert.equal(resolveOperonCommand(target, catalog, { inlineTaskId: 'inline', fileTaskId: null }).entry, entry);
	}
	assert.equal(catalog.entries.find(entry => entry.id === 'toggle-timer').name, 'Start/stop timer for task at cursor');
	assert.equal(catalog.entries.find(entry => entry.id === 'toggle-global-timer').name, 'Start/stop timer');
});

test('vault and record IDs survive one encoding and decoding, including a literal plus and percent escape', () => {
	const vault = 'İş & Arşiv + %20';
	const target = tab('filter', 'eski/ç + %2F');
	const uri = buildOperonUri(vault, target);
	assert.ok(uri.includes('vault=%C4%B0%C5%9F%20%26%20Ar%C5%9Fiv%20%2B%20%2520'));
	assert.deepEqual(parseOperonUri(uri), { vault, target });
	assert.equal(parseOperonUri('obsidian://operon?vault=My+Vault&command=open-task-creator').vault, 'My Vault');
});

test('invalid or ambiguous addresses never resolve to a different action', () => {
	for (const uri of [
		'https://operon?vault=V&view=kanban', 'obsidian://other?vault=V&view=table',
		'obsidian://operon/other?vault=V&view=table', 'obsidian://operon?view=calendar', 'obsidian://operon?vault=&view=table',
		...['&view=kanban&paneType=lightbox', '&view=table&paneType=window', '&view=table&preset=',
			'&view=table&run=true', '&view=table&command=open-task-creator', '&view=automation',
			'&view=automation&rule=a&run=yes', '&view=automation&rule=a&run=true&rule=b',
			'&view=automation&rule=a&paneType=tab', '&command=other:exec', '&view=unknown'].map(query => base + query),
	]) assert.equal(parseOperonUri(uri), null, uri);
	assert.throws(() => buildOperonUri('', tab('calendar')));
	assert.throws(() => buildOperonUri('V', tab('filter', ' ')));
});

test('duplicate labels and a named Default get ID suffixes, without changing existing links or hotkeys', () => {
	const shared = { ...presets, table: [item('tp_1', 'Default'), item('tp_2', 'Work'), item('tp_3', 'Work')] };
	const make = table => buildOperonCommandCatalog({ ...source, presets: { ...shared, table } });
	const original = make(shared.table);
	const names = original.entries.filter(e => e.target.view === 'table').map(e => e.name);
	for (const name of ['Default', 'Default [tp_1]', 'Work [tp_2]', 'Work [tp_3]']) {
		assert.ok(names.includes('Open Table › ' + name + ' › New Tab'));
	}
	const target = readTarget(buildOperonUri('Stratejya', tab('table', 'tp_2')));
	const edited = resolveOperonCommand(target, make([item('tp_2', 'Renamed')])).entry;
	assert.equal(edited.id, resolveOperonCommand(target, original).entry.id);
	assert.equal(edited.name, 'Open Table › Renamed › New Tab');
});

test('both actions are listed for each saved rule, including Manual Inactive and Auto Inactive', () => {
	for (const rule of rules) {
		for (const action of ['open', 'run']) {
			const target = { kind: 'automation', rule: rule.id, action };
			const uri = buildOperonUri('Stratejya', target);
			assert.equal(uri, base + '&view=automation&rule=' + rule.id + (action === 'run' ? '&run=true' : ''));
			const { entry } = resolveOperonCommand(readTarget(uri), catalog);
			assert.equal(entry.name, `Automation › ${rule.name} › ${action === 'run' ? 'Run' : 'Open'}`);
			const updated = buildOperonCommandCatalog({ ...source, rules: [{ ...rule, name: 'Renamed', active: !rule.active }] });
			assert.equal(resolveOperonCommand(target, updated).entry.id, entry.id);
			assert.equal(resolveOperonCommand(target, buildOperonCommandCatalog({ ...source, rules: [] })).status, 'rule-not-found');
		}
	}
});

test('desktop Lightbox needs a file-backed table and tracks the current default', () => {
	for (const preset of [undefined, 'tp_a1b2c3d']) {
		const target = lightbox(preset);
		const uri = buildOperonUri('Stratejya', target);
		assert.equal(uri, base + '&view=table' + (preset ? '&preset=' + preset : '') + '&paneType=lightbox');
		assert.equal(resolveOperonCommand(readTarget(uri), catalog).status, 'ready');
		const mobile = buildOperonCommandCatalog({ ...source, desktop: false });
		assert.ok(mobile.entries.every(entry => entry.target.paneType !== 'lightbox'));
		const fallback = resolveOperonCommand(target, mobile);
		assert.equal(fallback.status, 'offer-new-tab');
		assert.deepEqual(fallback.entry.target, tab('table', preset));
	}
	const changedDefault = buildOperonCommandCatalog({ ...source, defaultTableId: 'local' });
	assert.equal(resolveOperonCommand(lightbox(), changedDefault).status, 'offer-new-tab');
	assert.equal(resolveOperonCommand(lightbox('local'), catalog).status, 'offer-new-tab');
});

test('a deleted named preset or missing default table never offers a different table', () => {
	for (const desktop of [true, false]) {
		const updated = buildOperonCommandCatalog({ ...source, desktop, presets: { ...presets, table: [] } });
		for (const target of [lightbox(), lightbox('tp_a1b2c3d'), tab('table', 'tp_a1b2c3d')]) {
			assert.equal(resolveOperonCommand(target, updated).status, 'preset-not-found');
		}
	}
});

test('cursor timer uses the receiving active Markdown editor, with inline before file task', () => {
	const target = readTarget(base + '&command=cursor-timer');
	assert.equal(resolveOperonCommand(target, catalog, { inlineTaskId: 'inline', fileTaskId: 'file' }).taskId, 'inline');
	assert.equal(resolveOperonCommand(target, catalog, { inlineTaskId: null, fileTaskId: 'file' }).taskId, 'file');
	for (const editor of [null, { inlineTaskId: null, fileTaskId: null }]) {
		assert.equal(resolveOperonCommand(target, catalog, editor).status, 'command-unavailable');
		assert.equal(resolveOperonCommand(readTarget(base + '&command=toggle-global-timer'), catalog, editor).status, 'ready');
	}
});

test('generic command routes resolve only registered Operon commands and cannot impersonate preset or rule actions', () => {
	for (const id of ['unknown-action', 'open-kanban-view', 'automation-run-fake', 'toggle-timer']) {
		assert.equal(resolveOperonCommand(readTarget(base + '&command=' + id), catalog).status, 'command-unavailable');
	}
	for (const id of ['open-task-creator', 'open-mini-calendar', 'open-flow-time', 'toggle-global-timer']) {
		assert.equal(resolveOperonCommand(readTarget(base + '&command=' + id), catalog).entry.id, id);
	}
});
