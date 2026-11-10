import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const bundle = await build({
	stdin: {
		contents: `
			export { CoreQuickSwitcherIntegration, resolveCoreQuickSwitcherFileOpening } from './src/ui/core-quick-switcher';
			export { OperonIndexer } from './src/indexer/indexer';
			export { TFile, Platform, setTestApiVersion } from './scripts/test-support/obsidian';
			export { SettingsPreservationHarness } from './scripts/test-support/settings-preservation-harness';
			export { buildOperonSettingsBackupSelectedPatchV1 } from './src/core/settings-backup-apply';
		`,
		resolveDir: root,
	},
	alias: { obsidian: fileURLToPath(new URL('./test-support/obsidian.ts', import.meta.url)) },
	bundle: true, write: false, platform: 'node', format: 'esm',
});
const {
	CoreQuickSwitcherIntegration, resolveCoreQuickSwitcherFileOpening, OperonIndexer, TFile, Platform, setTestApiVersion,
	SettingsPreservationHarness, buildOperonSettingsBackupSelectedPatchV1,
} = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

const click = { type: 'click', button: 0, defaultPrevented: true };
const enter = { type: 'keydown', key: 'Enter' };
const preference = 'workspaceTweaksCoreQuickSwitcherOpenBehavior';

function fixture(behavior = 'source') {
	setTestApiVersion('1.15.1');
	Platform.isDesktopApp = true;
	const file = new TFile('folder/Task.md');
	const calls = [];
	const errors = [];
	class Element {
		constructor(doc) { this.ownerDocument = doc; }
	}
	const doc = { defaultView: { HTMLElement: Element, closed: false } };
	doc.body = new Element(doc);
	const app = { vault: { getAbstractFileByPath: path => path === file.path ? file : null } };
	class CoreModal {
		app = app;
		modalEl = new Element(doc);
		onChooseSuggestion(result, event) {
			calls.push({ kind: 'native', result, event, receiver: this });
			return 'core-result';
		}
	}
	const core = { enabled: true, instance: { QuickSwitcherModal: CoreModal } };
	app.internalPlugins = { plugins: { switcher: core } };
	const state = { behavior, prepare: (file, mode, anchor) => () => calls.push({ kind: 'operon', file, mode, anchor }) };
	const integration = new CoreQuickSwitcherIntegration(app, {
		behavior: () => state.behavior,
		prepareOpening: (...args) => state.prepare(...args),
		onOpenError: error => errors.push(error),
	});
	return { integration, CoreModal, core, app, doc, calls, errors, state, file,
		result: { type: 'file', file }, original: CoreModal.prototype.onChooseSuggestion };
}

test('passive mode adds no hook, active changes apply immediately and passive/unload restore Core', () => {
	const f = fixture();
	const modal = new f.CoreModal();
	for (const value of [undefined, 'default']) {
		f.state.behavior = value; f.integration.sync();
		assert.equal(f.CoreModal.prototype.onChooseSuggestion, f.original);
	}
	for (const mode of ['source', 'source-and-editor', 'editor']) {
		f.state.behavior = mode; f.integration.sync();
		for (const [result, event] of [[f.result, click], [{ type: 'alias', file: f.file }, enter]]) modal.onChooseSuggestion(result, event);
		assert.deepEqual(f.calls.splice(0), [1, 2].map(() => ({ kind: 'operon', file: f.file, mode, anchor: f.doc.body })));
	}
	f.state.behavior = 'default'; f.integration.sync();
	assert.equal(f.CoreModal.prototype.onChooseSuggestion, f.original);
	f.state.behavior = 'source'; f.integration.sync(); f.integration.dispose();
	assert.equal(f.CoreModal.prototype.onChooseSuggestion, f.original);
});

test('modified gestures, new notes, bookmarks, stale files and foreign modal owners delegate once', () => {
	const f = fixture(); f.integration.sync();
	const modal = new f.CoreModal();
	const delegated = [
		[f.result, { ...click, metaKey: true }], [f.result, { ...click, ctrlKey: true }],
		[f.result, { ...enter, shiftKey: true }], [f.result, { ...enter, altKey: true }],
		[f.result, { ...click, button: 1 }], [f.result, { ...enter, isComposing: true }],
		[null, enter], [{ type: 'bookmark', file: f.file }, click],
		[{ type: 'unresolved', linktext: 'New' }, enter],
		[{ type: 'file', file: new TFile(f.file.path) }, click],
	];
	for (const [result, event] of delegated) assert.equal(modal.onChooseSuggestion(result, event), 'core-result');
	assert.equal(f.calls.length, delegated.length);
	assert.ok(f.calls.every(call => call.kind === 'native' && call.receiver === modal));
	f.calls.length = 0;
	modal.app = {};
	assert.equal(modal.onChooseSuggestion(f.result, enter), 'core-result');
	modal.app = f.app;
	f.core.enabled = false;
	assert.equal(modal.onChooseSuggestion(f.result, enter), 'core-result');
	f.core.enabled = true; f.doc.defaultView.closed = true;
	assert.equal(modal.onChooseSuggestion(f.result, enter), 'core-result');
	assert.equal(f.calls.length, 3);
	f.integration.dispose();
});

test('mobile, unverified version, and incompatible Core expose no hook', () => {
	const f = fixture();
	for (const version of ['1.15.0', '1.15.2', '1.16.0']) {
		setTestApiVersion(version); f.integration.sync();
		assert.equal(f.CoreModal.prototype.onChooseSuggestion, f.original);
	}
	setTestApiVersion('1.15.1'); Platform.isDesktopApp = false; f.integration.sync();
	assert.equal(f.CoreModal.prototype.onChooseSuggestion, f.original);
	Platform.isDesktopApp = true; f.core.instance.QuickSwitcherModal = class {};
	f.integration.sync();
	assert.equal(f.core.instance.QuickSwitcherModal.prototype.onChooseSuggestion, undefined);
});

test('unavailable preflight delegates; a failed claimed opening never opens a second file', async () => {
	const f = fixture(); f.integration.sync();
	const modal = new f.CoreModal();
	f.state.prepare = () => null;
	assert.equal(modal.onChooseSuggestion(f.result, enter), 'core-result');
	f.state.prepare = () => { throw new Error('no owner'); };
	assert.equal(modal.onChooseSuggestion(f.result, enter), 'core-result');
	const error = new Error('Lightbox opening failed');
	f.state.prepare = () => async () => { throw error; };
	modal.onChooseSuggestion(f.result, enter);
	await Promise.resolve();
	assert.deepEqual(f.errors, [error]);
	assert.equal(f.calls.length, 2);
	f.integration.dispose();
});

test('a newer wrapper survives disposal and the old Operon wrapper only delegates', () => {
	const f = fixture(); f.integration.sync();
	const operon = f.CoreModal.prototype.onChooseSuggestion;
	const foreign = function (...args) { return operon.apply(this, args); };
	f.CoreModal.prototype.onChooseSuggestion = foreign;
	f.integration.dispose();
	assert.equal(f.CoreModal.prototype.onChooseSuggestion, foreign);
	assert.equal(new f.CoreModal().onChooseSuggestion(f.result, enter), 'core-result');
	assert.equal(f.calls.length, 1);
});

test('file routing handles real File Tasks, normal notes, supported native files and exclusions', () => {
	const routes = new Map([['Task.md', 'task-id'], ['Conflict.md', undefined]]);
	const context = {
		isExcalidraw: file => file.path === 'Drawing.md' || file.path.endsWith('.excalidraw.md'),
		basesEnabled: () => true,
		fileTaskId: file => routes.has(file.path) ? routes.get(file.path) : null,
	};
	const route = (path, mode) => resolveCoreQuickSwitcherFileOpening(new TFile(path), mode, context);
	assert.deepEqual(route('Task.md', 'source'), { kind: 'source' });
	assert.deepEqual(route('Task.md', 'source-and-editor'), { kind: 'editor', id: 'task-id', showSource: true });
	assert.deepEqual(route('Task.md', 'editor'), { kind: 'editor', id: 'task-id', showSource: false });
	for (const mode of ['source', 'source-and-editor', 'editor']) {
		assert.deepEqual(route('Note with inline tasks.md', mode), mode === 'source' ? { kind: 'source' } : { kind: 'properties', showSource: mode === 'source-and-editor' });
		for (const path of ['List.table', 'List.base']) assert.deepEqual(route(path, mode), { kind: 'source' });
		for (const path of ['Board.canvas', 'Drawing.md', 'Sketch.excalidraw.md', 'manual.pdf']) assert.equal(route(path, mode), null);
	}
	assert.equal(route('Conflict.md', 'editor'), null);
	context.fileTaskId = () => undefined;
	assert.equal(route('Note.md', 'source-and-editor'), null);
	assert.deepEqual(route('Note.md', 'source'), { kind: 'source' });
	context.basesEnabled = () => false;
	assert.equal(route('List.base', 'editor'), null);
});

test('a noncanonical copy of a duplicate File Task delegates just like the canonical copy', () => {
	const indexer = Object.create(OperonIndexer.prototype);
	const canonical = { operonId: 'duplicate', primary: { filePath: 'Task.md', lineNumber: 0, format: 'yaml' } };
	const copy = { ...canonical, primary: { ...canonical.primary, filePath: 'Copy.md' } };
	indexer.taskInstances = new Map([['yaml:Task.md:0', canonical], ['yaml:Copy.md:0', copy]]);
	indexer.tasks = new Map([['duplicate', canonical]]);
	indexer.duplicateConflicts = new Map([['duplicate', {}]]);
	indexer.expectedDuplicateTransitionInstances = new Map();
	assert.equal(indexer.resolveFileTaskIdForOpening('Task.md'), undefined);
	assert.equal(indexer.resolveFileTaskIdForOpening('Copy.md'), undefined);
	assert.equal(indexer.resolveFileTaskIdForOpening('Note.md'), null);
	indexer.duplicateConflicts.clear();
	indexer.expectedDuplicateTransitionInstances.set('duplicate', new Map());
	assert.equal(indexer.resolveFileTaskIdForOpening('Copy.md'), undefined);
	indexer.expectedDuplicateTransitionInstances.clear();
	assert.equal(indexer.resolveFileTaskIdForOpening('Task.md'), 'duplicate');
	assert.equal(indexer.resolveFileTaskIdForOpening('Copy.md'), undefined);
});

test('preference round trips in Workspace Tweaks, missing stays absent, and reload handles invalid values', async () => {
	const fixture = new SettingsPreservationHarness();
	try {
		const storage = fixture.createStorage(); await storage.initialize();
		const read = async () => JSON.parse(await fixture.adapter.read(fixture.canonicalPath));
		const before = await read();
		const writes = fixture.canonicalAttempts;
		assert.equal(storage.getSettings()[preference], undefined);
		assert.equal(Object.hasOwn(before.ui.workspaceTweaks, preference), false);
		const restarted = fixture.createStorage(); await restarted.initialize();
		assert.equal(fixture.canonicalAttempts, writes);
		for (const value of ['source', 'source-and-editor', 'editor', 'default']) {
			await storage.updateSettings({ [preference]: value });
			const saved = await read();
			assert.equal(saved.ui.workspaceTweaks[preference], value);
			assert.equal(Object.hasOwn(saved.settings, preference), false);
			await restarted.reloadCanonicalSettingsPackage();
			assert.equal(restarted.getSettings()[preference], value);
			assert.equal(buildOperonSettingsBackupSelectedPatchV1({ selectedGroups: ['general'], candidateSettings: restarted.getSettings() })[preference], value);
		}
		const malformed = await read();
		malformed.ui.workspaceTweaks[preference] = 'unsupported';
		fixture.seed(fixture.canonicalPath, JSON.stringify(malformed));
		await restarted.reloadCanonicalSettingsPackage();
		assert.equal(restarted.getSettings()[preference], undefined);
		assert.equal(Object.hasOwn(buildOperonSettingsBackupSelectedPatchV1({ selectedGroups: ['general'], candidateSettings: restarted.getSettings() }), preference), false);
	} finally { await fixture.dispose(); }
});
