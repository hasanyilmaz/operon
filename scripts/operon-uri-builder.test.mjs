import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Supply only the Obsidian surface used here. Selection, copy, routing and registration run production code.
const mockHost = `
export const notices = [];
export function getIcon() { return new Element(); }
export class Notice { constructor(message) { notices.push(message); } }
export class Element extends EventTarget {
	value = ''; textContent = ''; children = [];
	createEl(type) { const child = new Element(); child.type = type; this.children.push(child); return child; }
	addClass() {} setAttribute() {} prepend() {} select() { this.selected = true; }
	setText(text) { this.textContent = text; }
}
export class Setting {
	settingEl = new Element(); controlEl = new Element(); descEl = new Element();
	constructor(root) { root.children.push(this); }
	setName(name) { this.name = name; return this; }
	addButton(fn) {
		const btn = this.button = { buttonEl: new Element(), setButtonText() { return this; },
			setDisabled(value) { this.disabled = value; return this; }, onClick(callback) { this.click = callback; return this; } };
		fn(btn); return this;
	}
}
export class AbstractInputSuggest {
	constructor(app, input) {
		input.suggest = this;
		this.open = false;
		input.addEventListener('input', () => { this.items = this.getSuggestions(input.value); this.open = !!this.items.length; this.index = 0; });
		input.addEventListener('keydown', e => {
			if (e.key === 'Escape') this.close();
			if (!this.open) return;
			if (e.key === 'ArrowDown') this.index = Math.min(this.index + 1, this.items.length - 1);
			if (e.key === 'Enter') this.selectSuggestion(this.items[this.index]);
		});
	}
	close() { this.open = false; }
}`;
const root = fileURLToPath(new URL('..', import.meta.url));
const { outputFiles } = await build({
	stdin: { contents: "export * from './src/systems/operon-command-links'; export * from './src/ui/settings/uri-builder'; export {Element, notices} from 'obsidian';", resolveDir: root },
	platform: 'node', format: 'esm', write: false, bundle: true,
	plugins: [{ name: 'host', setup(b) {
		b.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'host' }));
		b.onLoad({ filter: /.*/, namespace: 'host' }, () => ({ contents: mockHost }));
	} }],
});
const { OperonCommandLinks, renderUriBuilder, Element, notices } = await import(
	'data:text/javascript;base64,' + Buffer.from(outputFiles[0].contents).toString('base64'));
function fixture() {
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
		kanbanPresets: () => presets, vaultName: () => vault, cursor: () => null,
		openKanban: async id => { calls.push(id); }, unavailable: reason => errors.push(reason),
	});
	links.register({ id: 'open-kanban-view', name: 'Kanban', callback: () => calls.push('default') });
	links.register({ id: 'open-uri-builder', name: 'Open URI Builder', callback: () => calls.push('builder') });
	links.register({ id: 'toggle-global-timer', name: 'Start/stop timer', callback: () => calls.push('timer') });
	links.register({ id: 'toggle-timer', name: 'Start/stop timer for task at cursor', callback: () => calls.push('cursor') });
	links.register({ id: 'guarded', name: 'Editor command', checkCallback: () => false });
	links.refresh();
	const dispatch = uri => links.handleProtocol({ action: 'operon', ...Object.fromEntries(new URL(uri).searchParams) });
	return { links, palette, calls, errors, presets, vault, dispatch };
}
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
	const edit = text => { input.value = text; input.dispatchEvent(new Event('input')); };
	const key = k => { const e = new Event('keydown'); e.key = k; input.dispatchEvent(e); };
	const clip = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
	let copied;
	Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { copied = value; } } });
	try {
		assert.equal(input.value, ''); assert.equal(output.value, ''); assert.ok(copy.disabled);
		palette.get('operon:open-uri-builder').callback();
		edit('kanban'); key('Escape'); assert.equal(input.suggest.open, false);
		edit('kanban'); key('ArrowDown'); key('Enter');
		assert.equal(input.value, 'Open Kanban › Sprint › New Tab');
		edit('sprint kanban'); assert.ok(copy.disabled); assert.equal(output.value, '');
		key('Enter'); assert.equal(input.suggest.open, false); assert.equal(copy.disabled, false);
		await copy.click();
		assert.equal(copied, 'obsidian://operon?vault=Test%20%26%20Work&view=kanban&preset=kp_123');
		assert.deepEqual(calls, ['builder']); assert.equal(notices.at(-1), 'Link copied to clipboard');
		await dispatch(copied); assert.deepEqual(calls, ['builder', 'kp_123']);
		presets[0].name = 'Next sprint'; links.refresh();
		assert.match(input.value, /Next sprint/u); assert.equal(output.value, copied);
		presets.splice(0); links.refresh();
		assert.equal(input.value, ''); assert.ok(copy.disabled);
		edit('nothing matches'); assert.equal(root.children[0].descEl.textContent, 'No matching commands.');
		edit('start/stop timer'); input.suggest.selectSuggestion(input.suggest.items[0]);
		assert.equal(output.value, 'obsidian://operon?vault=Test%20%26%20Work&command=toggle-global-timer');
		navigator.clipboard.writeText = () => Promise.reject(new Error('Clipboard unavailable'));
		await copy.click(); assert.equal(notices.at(-1), 'Clipboard write failed'); assert.ok(output.selected);
		assert.deepEqual(calls, ['builder', 'kp_123']);
	} finally {
		dispose();
		if (clip) Object.defineProperty(navigator, 'clipboard', clip); else delete navigator.clipboard;
	}
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

test('production shortcuts focus the Builder and open the same new Kanban tab via palette and URI', async () => {
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
		['registerCommands', 'addCommand', 'cursorTimerContext', 'openKanbanView'], {
			Base, OperonCommandLinks, t, LIGHTBOX_PERF_ENABLED: false, registerNativeTaskWorkspace: () => () => {},
			MarkdownView: class {}, Notice: class {}, runAsyncAction: (_label, run) => pending.push(run()),
			KANBAN_VIEW_TYPE: 'kanban', getNativePropertyIndex: () => ({}), createKanbanPropertyAccess: () => ({}),
			normalizeKanbanAxisLeafState: (state, settings) => ({ presetId: state?.presetId ?? settings.kanbanDefaultPresetId }),
		});
	const host = new Host();
	const leaf = { async setViewState(state) { calls.push(state.state.presetId); } };
	Object.assign(host, {
		app: { vault: { getName: () => 'Dev' }, workspace: {
			getActiveViewOfType: () => editor, getLeaf: type => { calls.push(type); return leaf; }, revealLeaf: async () => {},
		} },
		settings: { kanbanPresets: presets, kanbanDefaultPresetId: 'kp_next' }, settingsTab: tab,
		storage: { getSettings: () => host.settings, subscribeKanbanPresets: () => () => {} },
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
	builder.input.value = 'sprint'; builder.input.dispatchEvent(new Event('input'));
	builder.input.suggest.selectSuggestion(builder.input.suggest.items[0]);
	const uri = root.children[1].controlEl.children[0].value;
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
