import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Supply only the Obsidian surface used here. Selection, copy, routing and registration run production code.
const mockHost = `
export const notices = [];
globalThis.MutationObserver ??= class {
	constructor(callback) { this.callback = callback; }
	observe(list) { this.list = list; list.observer = this; }
	disconnect() { if (this.list) this.list.observer = null; this.list = null; }
};
export function getIcon() { return new Element(); }
export class Notice { constructor(message) { notices.push(message); } }
export class Element extends EventTarget {
	textContent = ''; children = []; attrs = {};
	ownerDocument = { getSelection: () => ({ selectAllChildren: el => { el.selected = true; } }) };
	createDiv(opts = {}) { const child = new Element(); child.parentElement = this; child.attrs = opts.attr ?? {}; this.children.push(child); return child; }
	querySelector(selector) {
		return selector === '[role="option"].is-selected' ? this.children.find(el => el.attrs.role === 'option' && el.highlighted) ?? null : null;
	}
	removeAttribute(key) { delete this.attrs[key]; }
	addClass() {} setAttribute(key, val) { this.attrs[key] = val; } prepend() {} focus() { this.dispatchEvent(new Event('focus')); }
	empty() { this.textContent = ''; }
	setText(text) { this.textContent = text; }
}
export class Setting {
	settingEl = new Element(); controlEl = new Element(); descEl = new Element();
	constructor(root) { root.children.push(this); }
	setName(name) { this.name = name; return this; }
	addButton(fn) {
		const btn = this.button = { buttonEl: new Element(), setIcon(icon) { this.icon = icon; return this; },
			setDisabled(value) { this.disabled = value; return this; }, onClick(callback) { this.click = callback; return this; } };
		fn(btn); return this;
	}
}
export class AbstractInputSuggest {
	constructor(app, input) {
		input.suggest = this;
		this.listEl = new Element();
		this.isOpen = false;
		const update = () => {
			const matches = this.getSuggestions(input.textContent);
			this.items = this.limit === 0 ? matches : matches.slice(0, 100);
			this.listEl.children = [];
			if (!this.items.length) { this.close(); return; }
			for (const entry of this.items) this.renderSuggestion(entry, this.listEl.createDiv());
			this.highlight(0);
			this.open();
		};
		input.addEventListener('input', update);
		input.addEventListener('focus', update);
		input.addEventListener('blur', () => this.close());
		input.addEventListener('keydown', e => {
			if (e.key === 'Escape') this.close();
			if (!this.isOpen) return;
			if (e.key === 'ArrowDown') this.highlight((this.index + 1) % this.items.length);
			if (e.key === 'ArrowUp') this.highlight((this.index + this.items.length - 1) % this.items.length);
			if (e.key === 'Enter') this.selectSuggestion(this.items[this.index]);
		});
	}
	highlight(index) {
		for (const [i, el] of this.listEl.children.entries()) el.highlighted = i === index;
		this.index = index;
		const observer = this.listEl.observer;
		queueMicrotask(() => { if (observer?.list === this.listEl) observer.callback(); });
	}
	open() { this.isOpen = true; }
	close() { this.isOpen = false; this.listEl.children = []; }
}`;
const root = fileURLToPath(new URL('..', import.meta.url));
const { outputFiles } = await build({
	stdin: { contents: "export * from './src/systems/operon-command-links'; export * from './src/ui/settings/uri-builder'; export {getNormalFilterSets} from './src/core/dynamic-file-task-filter'; export {mergeTablePresetRegistryOrder,resolveTablePresetDefaultAfterRegistrySync} from './src/storage/table-preset-manifest'; export {installI18nLocale, activateI18nLocale, resetI18nToEnglish} from './src/core/i18n'; export {Element, notices} from 'obsidian';", resolveDir: root },
	platform: 'node', format: 'esm', write: false, bundle: true,
	plugins: [{ name: 'host', setup(b) {
		b.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'host' }));
		b.onLoad({ filter: /.*/, namespace: 'host' }, () => ({ contents: mockHost }));
	} }],
});
const { installI18nLocale, activateI18nLocale, resetI18nToEnglish, OperonCommandLinks, renderUriBuilder, getNormalFilterSets, mergeTablePresetRegistryOrder, resolveTablePresetDefaultAfterRegistrySync, Element, notices } = await import(
	'data:text/javascript;base64,' + Buffer.from(outputFiles[0].contents).toString('base64'));
function fixture(overrides = {}) {
	const palette = new Map();
	const calls = [], errors = [], presets = [{ id: 'kp_123', name: 'Sprint' }];
	const vault = 'Test & Work';
	const links = new OperonCommandLinks({
		register: command => {
			command.id = 'operon:' + command.id;
			command.name = 'Operon: ' + command.name;
			assert.ok(!palette.has(command.id));
			palette.set(command.id, command);
			return command;
		}, remove: id => palette.delete('operon:' + id),
		rules: () => [],
		viewSources: () => ({presets: {kanban: presets, filter: [], calendar: [], table: []}, defaultTableId: null, fileTableIds: new Set(), desktop: true}), vaultName: () => vault, cursor: () => null,
		openPresetTab: async (_view, id) => { calls.push(id); }, unavailable: reason => errors.push(reason),
		...overrides,
	});
	links.register({ id: 'open-kanban-view', name: 'Kanban', callback: () => calls.push('default') });
	links.register({ id: 'open-uri-builder', name: 'Open URI Finder', callback: () => calls.push('builder') });
	links.register({ id: 'toggle-global-timer', name: 'Start/stop timer', callback: () => calls.push('timer') });
	links.register({ id: 'toggle-timer', name: 'Start/stop timer for task at cursor', callback: () => calls.push('cursor') });
	links.register({ id: 'guarded', name: 'Editor command', checkCallback: () => false });
	links.refresh();
	const dispatch = uri => links.handleProtocol({ action: 'operon', ...Object.fromEntries(new URL(uri).searchParams) });
	return { links, palette, calls, errors, presets, vault, dispatch };
}
test('locale changes update existing palette objects and Turkish Finder searches without changing the selected URI', () => {
	const calendar = [{ id: 'cp_one', name: 'Varsayılan' }, { id: 'cp_two', name: 'Varsayılan [cp_one]' }];
	const { links, palette, vault } = fixture({ viewSources: () => ({
		presets: { table: [], filter: [], kanban: [], calendar }, defaultTableId: null, fileTableIds: new Set(), desktop: true,
	}) });
	const defaultCommand = links.register({ id: 'open-calendar-view', name: 'Calendar', callback() {} });
	const namedCommand = palette.get('operon:open-calendar-preset-cp_one-tab');
	const root = new Element();
	const { input, dispose } = renderUriBuilder({ vault: { getName: () => vault } }, root, links);
	const output = root.children[1].controlEl.children[0];
	try {
		input.suggest.selectSuggestion(links.entries.find(entry => entry.target.preset === 'cp_one'));
		const initialUri = output.textContent;
		installI18nLocale('tr', JSON.parse(readFileSync(new URL('../i18n/locales/tr.json', import.meta.url), 'utf8')));
		assert.ok(activateI18nLocale('tr'));
		links.refresh();
		assert.equal(input.textContent, 'Takvim aç › Varsayılan [cp_one] (2) › Yeni Sekme');
		assert.equal(defaultCommand.name, 'Operon: Takvim aç › Varsayılan › Yeni Sekme');
		assert.equal(namedCommand.name, 'Operon: ' + input.textContent);
		assert.equal(output.textContent, initialUri);
		for (let i = 0; i < 20; i++) {
			calendar[0].name = 'İş ' + i;
			links.refresh();
			assert.equal(palette.get(namedCommand.id), namedCommand);
			assert.equal(namedCommand.name, 'Operon: Takvim aç › İş ' + i + ' › Yeni Sekme');
			assert.equal(output.textContent, initialUri);
		}
		input.textContent = 'TAKVİM';
		input.dispatchEvent(new Event('input'));
		assert.equal(input.suggest.items.length, 3);
		assert.ok(input.suggest.items.every(entry => entry.target.view === 'calendar'));
	} finally { dispose(); resetI18nToEnglish(); }
});

test('failed preset and default tab openings give one notice and log the cause from either entry point', async ctx => {
	const failure = new Error('Cannot open tab');
	const log = ctx.mock.method(console, 'error', () => {});
	const rejectOpen = async () => { throw failure; };
	const { links, palette, errors, dispatch } = fixture({ openPresetTab: rejectOpen });
	// Register the default once, as Obsidian does when the plugin loads.
	const defaultCommand = links.register({ id: 'open-calendar-view', name: 'Calendar', callback: rejectOpen });
	for (const [callback, query] of [
		[palette.get('operon:open-kanban-preset-kp_123-tab').callback, 'view=kanban&preset=kp_123'],
		[defaultCommand.callback, 'view=calendar'],
	]) {
		for (const run of [callback, () => dispatch('obsidian://operon?vault=Test%20%26%20Work&' + query)]) {
			await run();
			assert.deepEqual(errors.splice(0), ['command']);
			assert.equal(log.mock.callCount(), 1);
			assert.equal(log.mock.calls[0].arguments[1], failure);
			log.mock.resetCalls();
		}
	}
});

test('default hotkey ID and each named palette action resolve directly, including duplicate labels and Default', async () => {
	const { links, palette, calls, errors, presets, vault, dispatch } = fixture();
	const named = 'operon:open-kanban-preset-kp_123-tab';
	const route = 'obsidian://operon?vault=Test%20%26%20Work&view=kanban&preset=kp_123';
	const defaultCmd = palette.get('operon:open-kanban-view');
	assert.equal(defaultCmd.name, 'Operon: Open Kanban › Default › New Tab');
	defaultCmd.callback(); await palette.get(named).callback(); await dispatch(route);
	assert.deepEqual(calls, ['default', 'kp_123', 'kp_123']);
	presets[0].name = 'Renamed';
	presets.push({ id: 'kp_copy', name: 'Renamed' }, { id: 'legacy', name: 'Default' });
	links.refresh(); links.refresh();
	assert.equal(palette.get(named).name, 'Operon: Open Kanban › Renamed [kp_123] › New Tab');
	assert.match(palette.get('operon:open-kanban-preset-legacy-tab').name, /Default \[legacy\]/u);
	assert.match(palette.get('operon:open-kanban-preset-kp_copy-tab').name, /Renamed \[kp_copy\]/u);
	await dispatch(route);
	presets.splice(0, 1); links.refresh();
	assert.ok(!palette.has(named));
	await dispatch(route);
	assert.equal(errors.at(-1), 'preset');
	assert.deepEqual(calls, ['default', 'kp_123', 'kp_123', 'kp_123']);
	assert.equal(palette.get('operon:open-kanban-view'), defaultCmd);
	for (const command of ['guarded', 'cursor-timer', 'unregistered']) await links.handleProtocol({ action: 'operon', vault, command });
	await links.handleProtocol({ action: 'operon', vault: 'Another', command: 'toggle-global-timer' });
	assert.deepEqual(errors, ['preset', 'command', 'command', 'command', 'invalid']);
	assert.equal(calls.length, 4);
});
test('routed commands use the receiving vault and validate explicit vaults and target parameters', async () => {
	const { links, vault, calls, errors } = fixture();
	for (const data of [
		{ action: 'operon', command: 'toggle-global-timer' },
		{ action: 'operon', vault, command: 'toggle-global-timer' },
		{ action: 'operon', vault: '', command: 'toggle-global-timer' },
		{ action: 'operon', vault: 'Other', command: 'toggle-global-timer' },
		{ action: 'operon', view: 'kanban', preset: 'missing' },
		{ action: 'operon', view: 'kanban', command: 'toggle-global-timer' },
		{ action: 'foreign', command: 'toggle-global-timer' },
	]) await links.handleProtocol(data);
	assert.deepEqual(calls, ['timer', 'timer']);
	assert.deepEqual(errors, ['invalid', 'invalid', 'preset', 'invalid', 'invalid']);
});

test('Builder selects without executing, copies a routable vault URI, and clears or refreshes stale selections', async () => {
	const { links, calls, presets, vault, dispatch, palette } = fixture();
	const root = new Element();
	const { input, dispose } = renderUriBuilder({ vault: { getName: () => vault } }, root, links);
	const output = root.children[1].controlEl.children[0], copy = root.children[1].button;
	const edit = text => { input.textContent = text; input.dispatchEvent(new Event('input')); };
	const key = k => { const e = new Event('keydown'); e.key = k; input.dispatchEvent(e); };
	const clip = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
	let copied;
	Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { copied = value; } } });
	try {
		assert.equal(input.textContent, ''); assert.equal(output.textContent, ''); assert.ok(copy.disabled);
		palette.get('operon:open-uri-builder').callback();
		edit('kanban'); key('Escape'); assert.equal(input.suggest.isOpen, false);
		edit('kanban'); key('ArrowDown'); key('Enter');
		assert.equal(input.textContent, 'Open Kanban › Sprint › New Tab');
		edit('sprint kanban'); assert.ok(copy.disabled); assert.equal(output.textContent, '');
		key('Enter'); assert.equal(input.suggest.isOpen, false); assert.equal(copy.disabled, false);
		await copy.click();
		assert.equal(copied, 'obsidian://operon?vault=Test%20%26%20Work&view=kanban&preset=kp_123');
		assert.deepEqual(calls, ['builder']); assert.equal(notices.at(-1), 'Link copied to clipboard');
		await dispatch(copied); assert.deepEqual(calls, ['builder', 'kp_123']);
		presets[0].name = 'Next sprint'; links.refresh();
		assert.match(input.textContent, /Next sprint/u); assert.equal(output.textContent, copied);
		presets.splice(0); links.refresh();
		assert.equal(input.textContent, ''); assert.ok(copy.disabled);
		edit('nothing matches'); assert.equal(root.children[0].descEl.textContent, 'No matching commands.');
		edit('start/stop timer'); input.suggest.selectSuggestion(input.suggest.items[0]);
		assert.equal(output.textContent, 'obsidian://operon?vault=Test%20%26%20Work&command=toggle-global-timer');
		navigator.clipboard.writeText = () => Promise.reject(new Error('Clipboard unavailable'));
		await copy.click(); assert.equal(notices.at(-1), 'Clipboard write failed'); assert.ok(output.selected);
		assert.deepEqual(calls, ['builder', 'kp_123']);
	} finally {
		dispose();
		if (clip) Object.defineProperty(navigator, 'clipboard', clip); else delete navigator.clipboard;
	}
});

test('an empty Builder browses the full catalog and reopens after Escape without running a command', () => {
	const { links, presets, calls, vault } = fixture();
	for (let i = 0; i < 120; i++) presets.push({ id: 'kp_' + i, name: 'Board ' + i });
	links.refresh();
	const root = new Element();
	const { input, dispose } = renderUriBuilder({ vault: { getName: () => vault } }, root, links);
	const output = root.children[1].controlEl.children[0], copy = root.children[1].button;
	assert.equal(copy.icon, 'copy');
	assert.equal(copy.buttonEl.attrs['aria-label'], 'Copy');
	assert.equal(copy.buttonEl.textContent, '');
	assert.equal(output.attrs['aria-readonly'], 'true');
	input.focus();
	assert.deepEqual(input.suggest.items, links.entries);
	input.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
	assert.equal(input.suggest.isOpen, false);
	input.dispatchEvent(new Event('click'));
	assert.equal(input.suggest.isOpen, true);
	assert.deepEqual(input.suggest.items, links.entries);
	const lastBoard = input.suggest.items.find(entry => entry.name.includes('Board 119'));
	assert.ok(lastBoard);
	input.suggest.selectSuggestion(lastBoard);
	assert.equal(input.textContent, lastBoard.name);
	assert.equal(new URL(output.textContent).searchParams.get('preset'), 'kp_119');
	assert.deepEqual(calls, []);
	dispose();
});

test('Finder exposes the host-highlighted option until selection, dismissal or refresh', async () => {
	const { links, presets, calls, vault } = fixture();
	const app = { vault: { getName: () => vault } };
	const root = new Element();
	const { input, dispose } = renderUriBuilder(app, root, links);
	const other = renderUriBuilder(app, new Element(), links);
	const key = value => input.dispatchEvent(Object.assign(new Event('keydown'), { key: value }));
	const search = query => { input.textContent = query; input.dispatchEvent(new Event('input')); };
	const collapsed = () => {
		assert.equal(input.attrs['aria-expanded'], 'false');
		assert.equal(input.attrs['aria-controls'], undefined);
		assert.equal(input.attrs['aria-activedescendant'], undefined);
	};
	const active = () => {
		const list = input.suggest.listEl;
		assert.equal(input.attrs['aria-expanded'], 'true');
		assert.equal(input.attrs['aria-controls'], list.id);
		assert.equal(list.attrs.role, 'listbox');
		const selected = list.children.filter(row => row.attrs['aria-selected'] === 'true');
		assert.equal(selected.length, 1);
		const row = selected[0];
		assert.equal(row.attrs.role, 'option');
		assert.equal(row.id, input.attrs['aria-activedescendant']);
		assert.equal(row.textContent, input.suggest.items[input.suggest.index].name);
		return row.textContent;
	};
	assert.equal(input.attrs.role, 'combobox');
	collapsed();
	input.focus();
	other.input.focus();
	assert.notEqual(input.attrs['aria-controls'], other.input.attrs['aria-controls']);
	assert.notEqual(input.attrs['aria-activedescendant'], other.input.attrs['aria-activedescendant']);
	other.dispose();
	search('kanban');
	assert.equal(active(), 'Open Kanban › Default › New Tab');
	key('ArrowDown'); await Promise.resolve();
	assert.equal(active(), 'Open Kanban › Sprint › New Tab');
	key('ArrowUp'); await Promise.resolve();
	assert.equal(active(), 'Open Kanban › Default › New Tab');
	key('ArrowDown'); await Promise.resolve();
	const announced = active();
	key('Enter');
	collapsed();
	assert.equal(input.textContent, announced);
	assert.equal(root.children[1].controlEl.children[0].textContent, 'obsidian://operon?vault=Test%20%26%20Work&view=kanban&preset=kp_123');
	assert.deepEqual(calls, []);
	search('unknown_x'); collapsed();
	search(''); active(); key('Escape'); collapsed();
	input.dispatchEvent(new Event('click')); active();
	input.dispatchEvent(new Event('blur')); collapsed();
	input.focus(); presets[0].name = 'New name'; links.refresh(); collapsed();
	input.focus(); key('ArrowDown'); dispose(); await Promise.resolve(); collapsed();
	assert.equal(input.suggest.listEl.observer, null);
});

test('saved view shortcuts track renames, copies, deletions and Table eligibility while Finder stays open', async () => {
	const sources = {presets: {table:[], calendar:[], filter:[], kanban:[]}, desktop:true, fileTableIds:new Set(), defaultTableId:null};
	const { links, palette, vault, errors } = fixture({viewSources: () => sources});
	const root = new Element();
	const { input, dispose } = renderUriBuilder({ vault: { getName: () => vault } }, root, links);
	const output = root.children[1].controlEl.children[0];
	for (const view of ['calendar','filter','table']) {
		const preset = {id:'original', name:'Work'};
		sources.presets[view].push(preset);
		links.refresh();
		const id = 'open-' + view + '-preset-original-tab';
		const select = () => input.suggest.selectSuggestion(links.entries.find(entry => entry.id === id));
		select();
		const uri = output.textContent;
		const stale = palette.get('operon:' + id);
		sources.presets[view].push({id:'copy', name:'Work'});
		links.refresh();
		assert.match(input.textContent, /Work \[original\]/u);
		assert.ok(palette.has('operon:open-' + view + '-preset-copy-tab'));
		preset.name = 'Renamed';
		links.refresh();
		assert.match(input.textContent, /Renamed/u);
		assert.equal(output.textContent, uri);
		if (view === 'table') {
			sources.defaultTableId = preset.id;
			sources.fileTableIds.add(preset.id);
			links.refresh();
			assert.ok(palette.has('operon:open-table-view-lightbox'));
			input.suggest.selectSuggestion(links.entries.find(entry => entry.id === 'open-table-preset-original-lightbox'));
			sources.defaultTableId = 'copy';
			sources.fileTableIds.delete(preset.id);
			links.refresh();
			assert.equal(palette.has('operon:open-table-view-lightbox'), false);
			assert.equal(output.textContent, '');
			select();
		}
		sources.presets[view].splice(0);
		await stale.callback(); // Even a stale command checks the live source before navigating.
		assert.equal(errors.at(-1), 'preset');
		links.refresh();
		assert.ok(!palette.has('operon:' + id));
		assert.equal(input.textContent, '');
		assert.equal(output.textContent, '');
		assert.ok(root.children[1].button.disabled);
	}
	dispose();
});

test('Finder and palette keep stable per-rule links, disambiguate copies and discard deleted targets', async () => {
	const rule = {id: 'ar_1234567', name: 'Inbox'};
	const rules = [rule];
	const opened = [], ran = [];
	const { links, palette, vault, dispatch, errors } = fixture({
		rules: () => rules, openRule: id => opened.push(id), runRule: async id => { ran.push(id); },
	});
	const root = new Element();
	const finder = renderUriBuilder({ vault: {getName: () => vault} }, root, links);
	const output = root.children[1].controlEl.children[0];
	const commands = [];
	for (const action of ['open', 'run']) {
		const entry = links.entries.find(row => row.target.action === action);
		finder.input.suggest.selectSuggestion(entry);
		const command = palette.get('operon:' + entry.id);
		assert.equal(command.name, 'Operon: ' + (action === 'run' ? 'Run' : 'Open') + ' automation › Inbox');
		commands.push({command, uri: output.textContent, action});
	}
	assert.deepEqual([opened,ran], [[],[]]);
	rule.name = 'Queue';
	rules.push({...rule, id:'ar_7654321'});
	links.refresh();
	assert.equal(finder.input.textContent, 'Run automation › Queue [ar_1234567]');
	assert.equal(output.textContent, commands[1].uri);
	for (const {command, uri, action} of commands) {
		assert.ok(palette.has('operon:automation-' + action + '-ar_7654321'));
		assert.equal(palette.get(command.id), command);
		await command.callback();
		await dispatch(uri);
	}
	assert.deepEqual(opened, [rule.id,rule.id]);
	assert.deepEqual(ran, [rule.id,rule.id]);
	rules.shift();
	for (const {command,uri} of commands) { await command.callback(); await dispatch(uri); }
	assert.deepEqual(errors, ['rule','rule','rule','rule']);
	links.refresh();
	assert.equal(output.textContent, '');
	assert.equal(palette.has('operon:automation-run-' + rule.id), false);
	finder.dispose();
});

test('mobile Lightbox links open only the confirmed table and recheck its ID after the prompt', async () => {
	const sources = {presets:{table:[{id:'books',name:'Books'},{id:'other',name:'Other'}], calendar:[], filter:[], kanban:[]},
		defaultTableId:'books', desktop:false, fileTableIds:new Set(['books','other'])};
	let confirm = () => false;
	let prompts = 0;
	const {dispatch, calls, errors, palette} = fixture({viewSources: () => sources, confirmTableTab: async () => {prompts++; return confirm();}});
	const base = 'obsidian://operon?vault=Test%20%26%20Work&view=table&paneType=lightbox';
	assert.ok([...palette.keys()].every(id => !id.endsWith('-lightbox')));
	await dispatch(base + '&preset=books');
	assert.deepEqual(calls, []);
	confirm = () => { sources.defaultTableId = 'other'; return true; };
	await dispatch(base);
	assert.deepEqual(calls, ['books']);
	confirm = () => { sources.presets.table.shift(); return true; };
	await dispatch(base + '&preset=books');
	await dispatch(base + '&preset=books');
	assert.equal(prompts, 3);
	assert.deepEqual(errors, ['preset','preset']);
	assert.deepEqual(calls, ['books']);
});

// Exercise the actual plugin registrations and Settings navigation with an isolated host.
function productionMethods(file, className, methods, bindings) {
	const ast = ts.createSourceFile(file, readFileSync(new URL('../' + file, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
	const cls = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === className);
	const members = cls.members.filter(member => ts.isMethodDeclaration(member) && methods.includes(member.name.getText(ast)));
	assert.equal(members.length, methods.length);
	const { outputText } = ts.transpileModule('class Host extends Base {' + members.map(member => member.getText(ast)).join('\n') + '}', {
		compilerOptions: { target: ts.ScriptTarget.ES2022 },
	});
	return new Function(...Object.keys(bindings), outputText + '\nreturn Host;')(...Object.values(bindings));
}

test('saved command admission waits for startup and RAM settlement, and stops on failed startup or unload', async () => {
	const Host = productionMethods('main.ts', 'OperonPlugin', ['runAutomation'], {
		Base: class {}, localNow: () => '', showAutomationResult() {},
	});
	for (const outcome of ['ready', 'failed', 'unload-before-ready', 'unload-during-settlement']) {
		const host = new Host();
		const startup = Promise.withResolvers(), settling = Promise.withResolvers(), settled = Promise.withResolvers();
		const admissions = [];
		let unloading = false, waits = 0;
		Object.assign(host, {
			app: { vault: {} }, automationStartup: startup.promise,
			agentRuntimeLifecycle: { getPhase: () => unloading ? 'unloading' : 'ready' },
			indexer: { awaitRamSettlement() { waits++; settling.resolve(); return settled.promise; } },
			automationRunner: { async run(_request, ports) {
				admissions.push(await ports.waitForSavedRun());
				return { status: 'dismissed' };
			} },
		});
		const run = host.runAutomation({ savedRuleId: 'saved' });
		assert.equal(waits, 0);
		unloading = outcome === 'unload-before-ready';
		startup.resolve(outcome !== 'failed' && !unloading);
		if (outcome === 'ready' || outcome === 'unload-during-settlement') {
			await settling.promise;
			assert.deepEqual(admissions, []);
			unloading = outcome === 'unload-during-settlement';
			settled.resolve();
		}
		await run;
		assert.deepEqual(admissions, [unloading ? 'dismissed' : outcome === 'failed' ? 'index-unavailable' : 'ready']);
		assert.equal(waits, outcome === 'ready' || outcome === 'unload-during-settlement' ? 1 : 0);
	}
});

test('production Finder, registered shortcuts and URIs open the same tab or Table file lightbox', async () => {
	const palette = new Map(), calls = [], pending = [];
	const t = (_ns, key) => key === 'tabGeneral' ? 'General' : key;
	const Settings = productionMethods('src/ui/settings-tab.ts', 'OperonSettingsTab', ['openUriBuilder'], { Base: class {}, t });
	const tab = new Settings();
	const setting = { open() { calls.push('settings'); }, openPagePath(id, path) { calls.push([id, path]); } };
	const presets = [{ id: 'kp_sprint', name: 'Sprint' }, { id: 'kp_next', name: 'Next' }];
	let editor = null;
	const Base = class {
		addCommand(command) { command.id = 'operon:' + command.id; palette.set(command.id, command); return command; }
		register() {}
	};
	const Host = productionMethods('main.ts', 'OperonPlugin',
		['registerCommands', 'addCommand', 'cursorTimerContext', 'getCommandViewSources', 'openCommandTableLightbox',
			'openRelatedViewTarget', 'openKanbanView', 'openCalendarView', 'openOperonTable', 'openFilterViewById', 'resolvePreferredFilterSetId'], {
			Base, OperonCommandLinks, t, LIGHTBOX_PERF_ENABLED: false, registerNativeTaskWorkspace: () => () => {},
			MarkdownView: class {}, Notice: class {}, runAsyncAction: (_label, run) => pending.push(run()),
			isAutomationRulesSettings: value => !!value?.rules, Platform: {isDesktopApp: true}, getNormalFilterSets, localToday: () => '2026-11-22',
			normalizeCalendarSidebarTaskPoolMode: () => 'open', getActiveDocument: () => ({body: {}}),
			openFileLightboxAsync: async (_app, _anchor, target) => calls.push(['lightbox', target.file.path, target.expectedTablePresetId]),
			FILTER_VIEW_TYPE: 'filter', OPERON_TABLE_VIEW_TYPE: 'table', CALENDAR_VIEW_TYPE: 'calendar', KANBAN_VIEW_TYPE: 'kanban', getNativePropertyIndex: () => ({}), createKanbanPropertyAccess: () => ({}),
			normalizeKanbanAxisLeafState: (state, settings) => ({ presetId: state?.presetId ?? settings.kanbanDefaultPresetId }),
		});
	const host = new Host();
	let rulesChanged;
	const leaf = { async setViewState(state) {
		calls.push(state.type === 'kanban' ? state.state.presetId :
			[state.type, state.state.presetId ?? state.state.filterSetId, !!state.state.useNamedPresetOnMobile]);
	} };
	const booksFile = {path: 'Books.table'};
	const source = {kind: 'table-file', path: booksFile.path};
	Object.assign(host, {
		app: { vault: { getName: () => 'Dev', getFileByPath: path => path === booksFile.path ? booksFile : null }, workspace: {
			getActiveViewOfType: () => editor, getLeaf: type => { calls.push(type); return leaf; }, revealLeaf: async () => {},
		} },
		settings: { kanbanPresets: presets, kanbanDefaultPresetId: 'kp_next',
			tablePresets: [{id:'tp_books',name:'Books'}], tableDefaultPresetId:'tp_books',
			filterSets: [{id:'fs_today',name:'Today'},{id:'fs_dynamic_subtasks_filter',name:'Special'}], leftRailDefaultFilterViewId:'fs_today',
			calendarPresets: [{id:'cp_plan',name:'Planning'}], calendarDefaultPresetId:'cp_plan' }, settingsTab: tab,
		tablePresetRegistry: {getSource: () => source, getPath: () => source.path},
		storage: { getSettings: () => host.settings, subscribeViewPresets: () => () => {}, subscribeAutomationRules: callback => { rulesChanged = callback; return () => {}; } },
		indexer: { getFileTaskByPath: () => ({ operonId: 'file' }) },
		parseInlineTaskLine: line => line === 'inline' ? { operonId: 'inline' } : null,
		timeTracker: { isTimerRunning: () => false }, startTimerForTask: async id => { calls.push(id); return true; },
	});
	Object.assign(tab, { app: { setting }, containerEl: { ownerDocument: { defaultView: { requestAnimationFrame: fn => fn() } } },
		uriBuilderInput: { scrollIntoView() {}, focus() { calls.push('focus'); } } });
	host.registerCommands();
	palette.get('operon:open-uri-builder').callback();
	assert.deepEqual(calls.splice(0), ['settings', ['operon', ['General']], 'focus']);
	const root = new Element();
	const builder = renderUriBuilder(host.app, root, host.commandLinks);
	builder.input.textContent = 'sprint'; builder.input.dispatchEvent(new Event('input'));
	builder.input.suggest.selectSuggestion(builder.input.suggest.items[0]);
	const uri = root.children[1].controlEl.children[0].textContent;
	const routed = new URL(uri).searchParams;
	assert.equal(routed.get('vault'), host.app.vault.getName());
	routed.delete('vault'); // Desktop consumes the vault parameter before dispatch to the plugin.
	await host.commandLinks.handleProtocol({ action: 'operon', ...Object.fromEntries(routed) });
	await palette.get('operon:open-kanban-preset-kp_sprint-tab').callback();
	palette.get('operon:open-kanban-view').callback();
	host.settings.kanbanDefaultPresetId = 'kp_sprint';
	palette.get('operon:open-kanban-view').callback();
	await Promise.all(pending);
	assert.deepEqual(calls.splice(0), ['tab', 'kp_sprint', 'tab', 'kp_sprint', 'tab', 'kp_next', 'tab', 'kp_sprint']);
	for (const [label, view, id, mode] of [
		['Books','table','tp_books','tab'], ['Books','table','tp_books','lightbox'],
		['Default','table',null,'tab'], ['Default','table',null,'lightbox'],
		['Planning','calendar','cp_plan','tab'], ['Default','calendar',null,'tab'],
		['Today','filter','fs_today','tab'], ['Default','filter',null,'tab'],
	]) {
		const name = 'Open ' + view[0].toUpperCase() + view.slice(1) + ' › ' + label + ' › ' + (mode === 'tab' ? 'New Tab' : 'Lightbox');
		builder.input.textContent = name;
		builder.input.dispatchEvent(new Event('input'));
		assert.equal(builder.input.suggest.items.length, 1, name);
		const entry = builder.input.suggest.items[0];
		builder.input.suggest.selectSuggestion(entry);
		const command = palette.get('operon:' + entry.id);
		assert.equal(command.name, name);
		const params = new URL(root.children[1].controlEl.children[0].textContent).searchParams;
		assert.equal(params.get('view'), view);
		assert.equal(params.get('preset'), id);
		assert.equal(params.get('paneType'), mode === 'tab' ? null : 'lightbox');
		assert.deepEqual(calls, []);
		const expected = mode === 'lightbox' ? [['lightbox', booksFile.path, 'tp_books']] : ['tab',
			[view, id ?? {table:'tp_books', calendar:'cp_plan', filter:'fs_today'}[view], view === 'calendar' && !!id]];
		await command.callback();
		await Promise.all(pending);
		assert.deepEqual(calls.splice(0), expected);
		await host.commandLinks.handleProtocol({action:'operon', ...Object.fromEntries(params)});
		await Promise.all(pending);
		assert.deepEqual(calls.splice(0), expected);
	}
	assert.ok(!host.commandLinks.entries.some(entry => entry.target.preset === 'fs_dynamic_subtasks_filter'));
	const finder = host.commandLinks.entries.find(entry => entry.id === 'open-uri-builder');
	builder.input.suggest.selectSuggestion(finder);
	assert.equal(new URL(root.children[1].controlEl.children[0].textContent).searchParams.get('command'), 'open-uri-finder');
	for (const command of ['open-uri-finder','open-uri-builder']) {
		await host.commandLinks.handleProtocol({action:'operon',command});
		assert.deepEqual(calls.splice(0), ['settings', ['operon', ['General']], 'focus']);
	}
	host.settings.automationRules = {rules: []};
	tab.openAutomationRule = id => calls.push(['open', id]);
	host.runAutomation = async request => calls.push(['run', request.savedRuleId]);
	for (const mode of ['manual', 'auto']) for (const active of [false,true]) {
		const rule = {id:'ar_abcdefg', name:'Review', mode, active};
		host.settings.automationRules.rules = [rule];
		rulesChanged();
		for (const action of ['open','run']) {
			const entry = host.commandLinks.entries.find(item => item.target.action === action);
			builder.input.suggest.selectSuggestion(entry);
			const params = new URL(root.children[1].controlEl.children[0].textContent).searchParams;
			assert.equal(params.get('rule'), rule.id);
			assert.equal(params.get('run'), action === 'run' ? 'true' : null);
			assert.deepEqual(calls, []);
			await palette.get('operon:' + entry.id).callback();
			await host.commandLinks.handleProtocol({action:'operon', ...Object.fromEntries(params)});
			assert.deepEqual(calls.splice(0), [[action,rule.id],[action,rule.id]]);
		}
	}
	const timerData = { action: 'operon', vault: 'Dev', command: 'cursor-timer' };
	assert.equal(palette.get('operon:toggle-timer').checkCallback(true), false);
	await host.commandLinks.handleProtocol(timerData);
	assert.deepEqual(calls, []);
	let line = 'inline';
	editor = { file: { path: 'Task.md' }, getMode: () => 'source', editor: { getCursor: () => ({ line: 0 }), getLine: () => line } };
	await host.commandLinks.handleProtocol(timerData);
	line = 'other line'; await host.commandLinks.handleProtocol(timerData);
	host.indexer.getFileTaskByPath = () => null;
	assert.equal(palette.get('operon:toggle-timer').checkCallback(true), false);
	await Promise.all(pending);
	assert.deepEqual(calls, ['inline', 'file']);
	builder.dispose();
});

test('a mobile Calendar picker selection supersedes a named opening and preserves per-mode preferences', () => {
	const View = productionMethods('src/ui/calendar/calendar-view.ts', 'CalendarView',
		['resolveMobileCalendarSourcePreset', 'renderMobileCalendarSourcePresetButton'], {
			Base: class {}, setIcon() {}, setAccessibleLabelWithoutTooltip() {}, t: () => '',
			CALENDAR_MOBILE_SOURCE_PRESET_SETTING_BY_VIEW_MODE: { agenda: 'agendaSource', week: 'weekSource' },
		});
	const settings = { calendarPresets: ['project', 'inbox', 'work', 'family'].map(id => ({ id, name: id })),
		agendaSource: 'inbox', weekSource: 'family' };
	const named = new View(), ordinary = new View(), otherNamed = new View();
	ordinary.state = { presetId: 'project', mobileSourcePresetId: 'inbox' };
	named.state = { ...ordinary.state, useNamedPresetOnMobile: true };
	otherNamed.state = { ...named.state };
	const current = (view, mode = 'agenda') => view.resolveMobileCalendarSourcePreset(settings, mode, view.state).id;
	assert.equal(current(named), 'project');
	assert.equal(current(ordinary), 'inbox');

	let savedLayout;
	const select = new EventTarget();
	select.createEl = () => ({});
	const container = { createDiv: () => ({ createDiv: () => ({}), createEl: () => select }) };
	const refreshes = [];
	named.app = { workspace: { requestSaveLayout() { savedLayout = structuredClone(named.state); } } };
	named.callbacks = { onMobileCalendarSettingsChange(patch) {
		Object.assign(settings, patch);
		refreshes.push(current(named));
	} };
	named.renderMobileCalendarSourcePresetButton(container, settings.calendarPresets[0], settings, 'agenda');
	select.value = 'work';
	select.dispatchEvent(new Event('change'));

	assert.deepEqual(refreshes, ['work']);
	assert.ok(savedLayout);
	const restored = new View();
	restored.state = savedLayout;
	assert.equal(current(restored), 'work');
	assert.equal(current(named, 'week'), 'family');
	assert.equal(current(ordinary), 'work');
	assert.equal(current(otherNamed), 'project');
	assert.equal(savedLayout.presetId, 'project'); // Desktop still owns its original preset.
});

test('Table registry updates named shortcuts and reserves a missing default until its file returns', () => {
	const Host = productionMethods('main.ts', 'OperonPlugin', ['syncTablePresetProjectionFromRegistry', 'getCommandViewSources'], {
		Base: class {}, getNormalFilterSets, Platform: {isDesktopApp: true}, cloneTablePreset: structuredClone,
		mergeTablePresetRegistryOrder, resolveTablePresetDefaultAfterRegistrySync,
	});
	const host = new Host();
	const entries = new Map();
	const files = new Map();
	function put(id, name) {
		const path = name + '.table';
		files.set(path, {path});
		entries.set(id, {id, preset: {id, name}, status:'available', source:{kind:'table-file', path}});
	}
	put('books', 'Books');
	put('films', 'Films');
	host.tablePresetRegistry = {
		getSource: id => entries.get(id)?.source, getSnapshot: () => ({entries}),
		getPath: id => entries.get(id)?.source.path,
	};
	host.app = {vault: {getFileByPath: path => files.get(path)}};
	host.settings = {tableDefaultPresetId:'books', tablePresetOrderIds:['books'], tablePresets:[],
		filterSets:[], kanbanPresets:[], calendarPresets:[]};
	const {links, palette} = fixture({viewSources: () => host.getCommandViewSources()});
	host.commandLinks = links;
	const defaultBox = 'operon:open-table-view-lightbox';
	const booksBox = 'operon:open-table-preset-books-lightbox';
	host.syncTablePresetProjectionFromRegistry();
	assert.ok(palette.has(defaultBox));
	assert.ok(palette.has(booksBox));
	files.delete('Books.table');
	entries.set('books', {id:'books', status:'missing', preset:null, source:{kind:'missing-bound-file',path:null}});
	host.syncTablePresetProjectionFromRegistry();
	assert.equal(host.settings.tableDefaultPresetId, 'books');
	assert.ok(!palette.has(defaultBox));
	assert.ok(!palette.has(booksBox));
	assert.ok(palette.has('operon:open-table-preset-films-lightbox'));
	put('books', 'Reading list');
	host.syncTablePresetProjectionFromRegistry();
	assert.ok(palette.has(defaultBox));
	assert.equal(palette.get(booksBox).name, 'Operon: Open Table › Reading list › Lightbox');
});
