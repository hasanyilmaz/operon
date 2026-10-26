import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { DEFAULT_SETTINGS, migrateSettings, resolveStatusDockAlignment, resolveStatusDockMode, resolveStatusDockClickAction } from '../src/types/settings';
import { buildOperonDataPackageFromSettings, composeOperonSettingsFromDataPackage, mergeOperonDataPackage } from '../src/storage/operon-data-package';
import { assertSettingsBackupCompatibilityRegistryExhaustive } from '../src/core/settings-backup-compatibility';
import { buildOperonSettingsBackupSelectedPatchV1 } from '../src/core/settings-backup-apply';
import { exportOperonSettingsBackupJsonV1 } from '../src/core/settings-backup-export';
import { preflightOperonSettingsBackupRestoreV1 } from '../src/core/settings-backup-preflight';
import { humanizeUpcomingCountdown, UpcomingTaskStatusModel } from '../src/core/upcoming-task-status';
import { FlowTimeBreakController } from '../src/systems/flow-time-break';
import { StatusDockWidget, type StatusDockSnapshot } from '../src/ui/status-dock-widget';
import { OperonStatusDock, isStatusDockLeaf } from '../src/ui/status-dock';
import { NativeLightboxLifecycle } from '../src/ui/native-lightbox-lifecycle';
import { statusDockDocument } from './test-support/status-dock-dom';
import { SettingsPreservationHarness } from './test-support/settings-preservation-harness';
import type { IndexedTask } from '../src/types/fields';
import type { App, WorkspaceContainer, WorkspaceLeaf } from 'obsidian';

function task(id: string, date: string): IndexedTask {
	return { operonId: id, description: 'Upcoming **task** with a long description', checkbox: 'open',
		fieldValues: { datetimeStart: date }, primary: { filePath: 'Synthetic.md', format: 'inline', lineNumber: 0 } } as unknown as IndexedTask;
}
function snapshot(): StatusDockSnapshot {
	const activeTask = task('active', '2026-10-24T10:00:00');
	return { settings: { ...DEFAULT_SETTINGS, trackerShowStatusBarTimer: true, upcomingShowStatusBar: true, upcomingCountdownDisplay: 'seconds' },
		active: { operonId: activeTask.operonId, start: 'start', elapsedSeconds: 2489, task: activeTask, isUnassigned: false },
		breakSnapshot: { breakState: null, pendingTaskId: null, actionPending: false }, breakSeconds: 0, pendingDescription: null,
		upcoming: { task: task('next', '2026-10-24T12:34:57'), countdown: '02:34:57', due: false },
		alert: { state: 'conflict', count: 2 }, actionPending: false };
}
function widget() {
	const f = statusDockDocument(); const calls: string[] = [];
	const dock = new StatusDockWidget(f.doc, { openTracker: () => { calls.push('source-or-finder'); }, toggleTimer: () => { calls.push('timer'); },
		startTask: (id: string) => { calls.push(`start:${id}`); }, findTask: () => { calls.push('finder'); }, toggleBreak: () => { calls.push('coffee'); }, createTask: () => { calls.push('create'); }, openCurrentTask: (id: string) => { calls.push(`current:${id}`); }, openNextUpcoming: () => { calls.push('next'); }, openUpcoming: () => { calls.push('upcoming'); }, openConflicts: () => { calls.push('conflicts'); } }, error => { throw error; });
	f.doc.body.appendChild(dock.slot); const state = snapshot(); dock.setWidth(900); dock.update(state);
	return { ...f, dock, state, calls, find: (cls: string): any => dock.root.querySelector(`.${cls}`) };
}

test('missing and invalid preferences use memory defaults without changing the package', () => {
	const settings = migrateSettings({});
	assertSettingsBackupCompatibilityRegistryExhaustive(DEFAULT_SETTINGS);
	assertSettingsBackupCompatibilityRegistryExhaustive(settings);
	assert.equal(Object.prototype.hasOwnProperty.call(settings, 'statusDockMode'), false);
	assert.equal(resolveStatusDockMode(settings.statusDockMode), 'compact');
	assert.equal(resolveStatusDockAlignment(settings.statusDockAlignment), 'center');
	const data = buildOperonDataPackageFromSettings(settings);
	assert.equal(Object.prototype.hasOwnProperty.call(data.ui, 'statusDock'), false);
	const before = JSON.stringify(data); const merged = mergeOperonDataPackage(data, data);
	assert.equal(Object.prototype.hasOwnProperty.call(merged.ui, 'statusDock'), false); assert.equal(JSON.stringify(data), before);
	const restored = composeOperonSettingsFromDataPackage(data, DEFAULT_SETTINGS);
	assert.equal(Object.prototype.hasOwnProperty.call(restored, 'statusDockMode'), false);
	assert.equal(migrateSettings({ statusDockMode: 'broken', statusDockAlignment: 'bad' }).statusDockMode, undefined);
});

test('explicit mode and alignment round trip in UI and stay out of general settings', () => {
	const settings = migrateSettings({ statusDockMode: 'detailed', statusDockAlignment: 'right' });
	assertSettingsBackupCompatibilityRegistryExhaustive(settings);
	const data = buildOperonDataPackageFromSettings(settings);
	assert.deepEqual(data.ui.statusDock, { mode: 'detailed', alignment: 'right' });
	assert.equal(Object.prototype.hasOwnProperty.call(data.settings, 'statusDockMode'), false);
	const restored = composeOperonSettingsFromDataPackage(data, DEFAULT_SETTINGS);
	assert.equal(restored.statusDockMode, 'detailed'); assert.equal(restored.statusDockAlignment, 'right');
	assert.deepEqual(mergeOperonDataPackage(data, data).ui.statusDock, data.ui.statusDock);
});

test('old/default backup selections omit absent dock preferences and retain explicit choices', () => {
	const defaults = buildOperonSettingsBackupSelectedPatchV1({ selectedGroups: ['general'], candidateSettings: DEFAULT_SETTINGS });
	assert.equal(Object.prototype.hasOwnProperty.call(defaults, 'statusDockMode'), false);
	const explicit = buildOperonSettingsBackupSelectedPatchV1({ selectedGroups: ['general'], candidateSettings: migrateSettings({ statusDockMode: 'detailed', statusDockAlignment: 'left' }) });
	assert.equal(explicit.statusDockMode, 'detailed'); assert.equal(explicit.statusDockAlignment, 'left');
});

test('backup restore preflight handles absent and explicit dock preferences without inventing defaults', () => {
	for (const preferences of [{}, { statusDockMode: 'detailed', statusDockAlignment: 'left', statusDockClickAction: 'editor' }]) {
		const settings = migrateSettings({ ...DEFAULT_SETTINGS, ...preferences, dateDisplayFormat: 'DD/MM/YYYY' });
		const exported = exportOperonSettingsBackupJsonV1({ settings,
			source: { pluginVersion: '4.2.0', obsidianVersion: '1.13.0', dataPackageSchemaVersion: 2 },
			createdAt: '2026-10-24T12:00:00.000Z' });
		assert.equal(exported.ok, true);
		if (!exported.ok) continue;
		const target = migrateSettings({ ...DEFAULT_SETTINGS, dateDisplayFormat: 'MM/DD/YYYY' });
		const restored = preflightOperonSettingsBackupRestoreV1({ sourceJson: exported.json,
			targetSnapshot: { settings: target, dataPackageSchemaVersion: 2, settingsVersion: target.settingsVersion,
				canonicalWritesSuspended: false, canonicalWriteSuspensionReason: null }, selectedGroups: ['general'] });
		assert.equal(restored.ok, true, JSON.stringify(restored.diagnostics));
		assert.ok(restored.restorePlan);
		assert.equal(restored.restorePlan.candidateSettings.dateDisplayFormat, 'DD/MM/YYYY');
		for (const key of ['statusDockMode', 'statusDockAlignment', 'statusDockClickAction'] as const) {
			assert.equal(restored.restorePlan.candidateSettings[key], settings[key]);
			assert.equal(Object.prototype.hasOwnProperty.call(restored.restorePlan.candidateSettings, key),
				Object.prototype.hasOwnProperty.call(settings, key));
		}
	}
});

test('canonical reload clears removed choices before the next explicit save', async () => {
	const fixture = new SettingsPreservationHarness();
	try {
		const storage = fixture.createStorage(); await storage.initialize();
		await storage.saveStatusDockPreference('statusDockMode', 'detailed');
		await storage.saveStatusDockPreference('statusDockAlignment', 'right');
		const data = JSON.parse(await fixture.adapter.read(fixture.canonicalPath)); delete data.ui.statusDock;
		fixture.seed(fixture.canonicalPath, JSON.stringify(data)); await storage.reloadCanonicalSettingsPackage();
		assert.equal(storage.getSettings().statusDockMode, undefined);
		assert.equal(storage.getSettings().statusDockAlignment, undefined);
		await storage.saveStatusDockPreference('statusDockMode', 'compact');
		assert.equal(storage.getSettings().statusDockMode, 'compact');
	} finally { await fixture.dispose(); }
});

test('real storage writes only explicit preferences and preserves notes and unrelated package fields', async () => {
	const fixture = new SettingsPreservationHarness();
	try {
		const storage = fixture.createStorage(); await storage.initialize();
		const settings = storage.getSettings(); const writes = fixture.canonicalAttempts;
		assert.equal(settings.statusDockMode, undefined);
		const before = JSON.parse(await fixture.adapter.read(fixture.canonicalPath));
		assert.equal(fixture.canonicalAttempts, writes);
		await storage.saveStatusDockPreference('statusDockMode', 'detailed');
		await storage.saveStatusDockPreference('statusDockAlignment', 'left');
		const after = JSON.parse(await fixture.adapter.read(fixture.canonicalPath));
		assert.deepEqual(after.ui.statusDock, { mode: 'detailed', alignment: 'left' });
		delete after.ui.statusDock; assert.deepEqual(after, before);
		assert.equal(settings.statusDockMode, 'detailed'); assert.equal(settings.statusDockAlignment, 'left');
	} finally { await fixture.dispose(); }
});

test('failed preference save leaves the visible mode and disk unchanged', async () => {
	const fixture = new SettingsPreservationHarness();
	try {
		const storage = fixture.createStorage(); await storage.initialize(); const before = await fixture.adapter.read(fixture.canonicalPath);
		fixture.writeFault = 'throw-before'; await assert.rejects(storage.saveStatusDockPreference('statusDockMode', 'detailed'));
		assert.equal(storage.getSettings().statusDockMode, undefined); assert.equal(await fixture.adapter.read(fixture.canonicalPath), before);
		fixture.writeFault = 'none';
	} finally { await fixture.dispose(); }
});

test('reload of a current canonical package without dock choices performs zero writes', async () => {
	const first = new SettingsPreservationHarness(); let raw: string;
	try {
		const storage = first.createStorage(); await storage.initialize(); await storage.saveSettings();
		raw = await first.adapter.read(first.canonicalPath);
		assert.equal(Object.prototype.hasOwnProperty.call(JSON.parse(raw).ui, 'statusDock'), false);
	} finally { await first.dispose(); }
	const reloaded = new SettingsPreservationHarness({ initialRaw: raw });
	try {
		const before = reloaded.canonicalAttempts; const storage = reloaded.createStorage(); await storage.initialize();
		assert.equal(reloaded.canonicalAttempts, before);
		assert.equal(await reloaded.adapter.read(reloaded.canonicalPath), raw);
		assert.equal(storage.getSettings().statusDockMode, undefined);
		assert.equal(storage.getSettings().statusDockAlignment, undefined);
		assert.equal(storage.getSettings().statusDockClickAction, undefined);
	} finally { await reloaded.dispose(); }
});

test('stale concurrent saves cannot overwrite a newer preference', async () => {
	const fixture = new SettingsPreservationHarness();
	try {
		const storage = fixture.createStorage(); await storage.initialize();
		const results = await Promise.allSettled([storage.saveStatusDockPreference('statusDockMode', 'detailed'), storage.saveStatusDockPreference('statusDockMode', 'compact')]);
		assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected');
		assert.equal(storage.getSettings().statusDockMode, 'detailed');
	} finally { await fixture.dispose(); }
});

test('countdowns retain null and display precision with consistent human units', () => {
	assert.equal(humanizeUpcomingCountdown('02:34:57', true), '2h 34m 57s');
	assert.equal(humanizeUpcomingCountdown('02:34', false), '2h 34m');
	assert.equal(humanizeUpcomingCountdown('00:00:00', true), '0s');
	assert.equal(humanizeUpcomingCountdown(null, true), null);
});

test('one model shares selection, one timer and serialized click actions across consumers', async () => {
	const settings = { ...DEFAULT_SETTINGS, upcomingShowStatusBar: true, upcomingStatusBarExpiryAction: 'next' as const, upcomingCountdownDisplay: 'seconds' as const };
	let now = new Date(2026, 9, 24, 10); let scans = 0; let clicks = 0;
	const tasks = [task('first', '2026-10-24T10:00:02'), task('second', '2026-10-24T10:00:10')];
	const timers = new Set<() => void>();
	let finish!: () => void; const gate = new Promise<void>(resolve => { finish = resolve; });
	const model = new UpcomingTaskStatusModel({ getAllTasks: () => { scans++; return tasks; }, getGeneration: () => 1 }, () => settings,
		async () => { clicks++; await gate; }, callback => { timers.add(callback); return () => { timers.delete(callback); }; }, () => now);
	let updates = 0; model.subscribe(() => { updates++; }); model.subscribe(() => { updates++; });
	model.refresh(); assert.equal(model.getSnapshot().task?.operonId, 'first'); assert.equal(scans, 1);
	now = new Date(2026, 9, 24, 10, 0, 1); model.refresh(); assert.equal(scans, 1); assert.equal(timers.size, 1);
	const one = model.openSelected(); const two = model.openSelected(); finish(); await Promise.all([one, two]); assert.equal(clicks, 1);
	now = new Date(2026, 9, 24, 10, 0, 2); model.refresh(); assert.equal(model.getSnapshot().task?.operonId, 'second');
	assert.equal(updates, 6); model.destroy(); assert.equal(timers.size, 0);
});

test('keep-zero and countdown limits are preserved; hiding the setting cancels the timer', () => {
	const settings = { ...DEFAULT_SETTINGS, upcomingShowStatusBar: true };
	let now = new Date(2026, 9, 24, 10); const timers = new Set<() => void>();
	const model = new UpcomingTaskStatusModel({ getAllTasks: () => [task('one', '2026-10-24T10:00:01')] }, () => settings,
		() => {}, callback => { timers.add(callback); return () => { timers.delete(callback); }; }, () => now);
	model.refresh(); now = new Date(2026, 9, 24, 10, 0, 2); model.refresh();
	assert.equal(model.getSnapshot().due, true); assert.equal(model.getSnapshot().task?.operonId, 'one');
	settings.upcomingShowStatusBar = false; model.refresh(); assert.equal(model.getSnapshot().task, null); assert.equal(timers.size, 0); model.destroy();
});

test('ticks retain the complete dock DOM and update only the elapsed/countdown values', () => {
	const f = widget(); f.state.active!.elapsedSeconds = 29; f.dock.update(f.state);
	const children = Array.from(f.dock.root.querySelectorAll('*'));
	f.state.active!.elapsedSeconds++; f.state.upcoming.countdown = '02:34:56'; f.dock.update(f.state);
	assert.deepEqual(Array.from(f.dock.root.querySelectorAll('*')), children);
	assert.equal(f.find('operon-status-dock-time').textContent, '30s'); f.dock.destroy();
});

test('one compact mode ignores legacy mode and alignment without exposing a mode button', () => {
	const f = widget(); f.state.settings.statusDockMode = 'detailed'; f.state.settings.statusDockAlignment = 'right'; f.dock.update(f.state);
	assert.equal(f.dock.root.classList.contains('is-detailed'), false); assert.equal(f.find('operon-status-dock-mode'), null);
	assert.equal(f.dock.slot.dataset.alignment, undefined); f.dock.setWidth(280);
	assert.equal(f.dock.root.classList.contains('is-detailed'), false); f.dock.destroy();
});

test('optional modules control dividers while the tracker always keeps the dock visible', () => {
	const f = widget(); const dividers = Array.from(f.dock.root.querySelectorAll<HTMLElement>('.operon-status-dock-divider')).filter((el: HTMLElement) => !el.classList.contains('operon-status-dock-selection-divider') && !el.classList.contains('operon-status-dock-next-divider'));
	assert.equal(dividers[0].hidden, false); assert.equal(dividers[1].hidden, false);
	f.state.upcoming.task = null; f.dock.update(f.state); assert.equal(dividers[0].hidden, true); assert.equal(dividers[1].hidden, false);
	f.state.settings.trackerShowStatusBarTimer = false; f.dock.update(f.state); assert.equal(dividers[1].hidden, false); assert.equal(f.dock.slot.hidden, false);
	f.state.alert.state = 'hidden'; f.dock.update(f.state); assert.equal(f.dock.slot.hidden, false); assert.equal(dividers[1].hidden, true); f.dock.destroy();
});

test('mola controls, action locks and all click routes remain distinct', () => {
	const f = widget(); const controls = [f.find('operon-status-dock-timer-controls').children[0], f.find('operon-status-dock-timer-action')];
	controls[0].click(); controls[1].click(); f.find('operon-status-dock-upcoming').querySelector('.operon-status-dock-name').click(); f.find('operon-status-dock-alert').click();
	assert.deepEqual(f.calls, ['coffee', 'timer', 'upcoming', 'conflicts']);
	f.state.actionPending = true; f.dock.update(f.state); assert.equal(controls[0].disabled, true); assert.equal(controls[1].disabled, true);
	f.state.actionPending = false; f.state.active = null; f.dock.update(f.state); assert.equal(controls[0].disabled, false); assert.equal(controls[1].disabled, false); f.dock.destroy();
});

test('lightbox and sidebar leaves are excluded while ordinary Markdown tabs remain eligible', () => {
	const f = statusDockDocument(); const container = { doc: f.doc, win: f.doc.defaultView } as WorkspaceContainer;
	const app = {} as App; const host = f.doc.body.createDiv();
	const leaf = { view: { containerEl: host }, getRoot: () => container, getContainer: () => container } as unknown as WorkspaceLeaf;
	assert.equal(isStatusDockLeaf(app, leaf), true);
	const sidebar = { ...leaf, getRoot: () => ({}) } as unknown as WorkspaceLeaf; assert.equal(isStatusDockLeaf(app, sidebar), false);
	new NativeLightboxLifecycle(app, leaf); assert.equal(isStatusDockLeaf(app, leaf), false);
});

test('each window retains one dock across tab changes, lightboxes, moves and window close', async () => {
	const main = statusDockDocument(); const popout = statusDockDocument();
	const viewportEvents = new Map<string, () => void>();
	const viewport = { width: 1000, height: 650, offsetLeft: 10, offsetTop: 20, addEventListener: (key: string, callback: () => void) => viewportEvents.set(key, callback), removeEventListener: (key: string) => viewportEvents.delete(key) };
	main.doc.defaultView.visualViewport = viewport;
	popout.doc.defaultView.innerWidth = 380;
	const first = { doc: main.doc, win: main.doc.defaultView } as WorkspaceContainer;
	const second = { doc: popout.doc, win: popout.doc.defaultView } as WorkspaceContainer;
	const createLeaf = (owner: WorkspaceContainer) => {
		const state = { owner }; const host = owner.doc.body.createDiv();
		const leaf = { view: { containerEl: host }, getRoot: () => state.owner, getContainer: () => state.owner } as unknown as WorkspaceLeaf;
		return { leaf, state, host };
	};
	const a = createLeaf(first); const b = createLeaf(first); const c = createLeaf(second);
	const leaves = [a.leaf, b.leaf, c.leaf]; const recent = new Map([[first, a.leaf], [second, c.leaf]]);
	const events = new Map<string, (...args: unknown[]) => void>();
	const workspace = { containerEl: main.doc.body, iterateAllLeaves: (visit: (leaf: WorkspaceLeaf) => void) => leaves.forEach(visit),
		getMostRecentLeaf: (owner: WorkspaceContainer) => recent.get(owner) ?? null,
		on: (name: string, callback: (...args: unknown[]) => void) => { events.set(name, callback); return { dispose: () => events.delete(name) }; },
		onLayoutReady: (callback: () => void) => callback() };
	const app = { workspace } as unknown as App; const settings = { ...DEFAULT_SETTINGS, statusDockMode: 'detailed' as const, upcomingShowStatusBar: false }; let starts = 0;
	const dock = new OperonStatusDock(app, { indexer: { getTask: () => null, getAllTasks: () => [], getGeneration: () => 1 } as never,
		timeTracker: { getActiveState: () => null, getTransitionState: () => null, subscribe: () => () => {}, startUnassigned: async () => { starts++; return true; } } as never,
		breakController: { getSnapshot: () => ({ pendingTaskId: null, breakState: null, actionPending: false }), getElapsedSeconds: () => 0, subscribe: () => () => {} } as never,
		getSettings: () => settings, openFlowTime: async () => {}, startTimerForTask: async () => false, openTask: async () => {}, createTrackerTask: async () => null, pickTrackerTask: async () => null, openConflicts: () => {} });
	(dock as unknown as { registerEvent(ref: { dispose: () => void }): void }).registerEvent = ref => dock.register(ref.dispose);
	dock.onload();
	assert.equal(main.doc.body.querySelectorAll('.operon-status-dock').length, 1);
	assert.equal(popout.doc.body.querySelectorAll('.operon-status-dock').length, 1);
	const original = main.doc.body.querySelector('.operon-status-dock');
	const slot = main.doc.body.querySelector('.operon-status-dock-slot') as HTMLElement;
	assert.equal(slot.style.width, '1000px'); assert.equal(slot.style.left, '10px'); assert.equal(slot.style.bottom, '42px');
	Object.defineProperty(a.host, 'clientWidth', { value: 100 }); dock.refresh(); assert.equal(slot.style.width, '1000px');
	viewport.width = 280; viewportEvents.get('resize')?.(); assert.equal(original?.classList.contains('is-detailed'), false);
	assert.equal(settings.statusDockMode, 'detailed'); viewport.width = 1000; viewportEvents.get('resize')?.();
	assert.equal(original?.classList.contains('is-detailed'), false);
	const board = b.host.createDiv(); recent.set(first, b.leaf); events.get('active-leaf-change')?.(b.leaf); main.flush();
	assert.equal(main.doc.body.querySelector('.operon-status-dock'), original); assert.equal(board.parentElement, b.host);
	const lightbox = createLeaf(first); new NativeLightboxLifecycle(app, lightbox.leaf); leaves.push(lightbox.leaf);
	recent.set(first, lightbox.leaf); events.get('active-leaf-change')?.(lightbox.leaf); main.flush();
	assert.equal(main.doc.body.querySelector('.operon-status-dock'), original); assert.equal(lightbox.host.querySelectorAll('.operon-status-dock').length, 0);
	popout.doc.body.appendChild(b.host); b.state.owner = second; recent.set(first, a.leaf); recent.set(second, b.leaf); dock.refresh();
	assert.equal(main.doc.body.querySelectorAll('.operon-status-dock').length, 1);
	assert.equal(popout.doc.body.querySelectorAll('.operon-status-dock').length, 1);
	assert.equal(main.doc.body.querySelector('.operon-status-dock'), original);
	assert.equal(popout.doc.body.querySelector('.operon-status-dock')?.ownerDocument, popout.doc);
	// Reverse movement processes the destination before the source; cleanup must
	// not strip the destination host class after its new dock is attached.
	main.doc.body.appendChild(b.host); b.state.owner = first; recent.set(first, b.leaf); recent.set(second, c.leaf); dock.refresh();
	assert.equal(main.doc.body.querySelector('.operon-status-dock-slot')?.parentElement, main.doc.body);
	assert.equal(popout.doc.body.querySelector('.operon-status-dock-slot')?.parentElement, popout.doc.body);
	assert.equal(main.doc.body.querySelectorAll('.operon-status-dock').length, 1);
	assert.equal(popout.doc.body.querySelectorAll('.operon-status-dock').length, 1);
	popout.doc.defaultView.closed = true; events.get('window-close')?.(second); main.flush();
	assert.equal(popout.doc.body.querySelectorAll('.operon-status-dock').length, 0);
	const timerAction = main.doc.body.querySelector('.operon-status-dock-timer-action');
	assert.ok(timerAction); (timerAction as HTMLButtonElement).click();
	dock.onunload(); dock.unload(); await Promise.resolve(); await Promise.resolve();
	assert.equal(starts, 0, 'a queued click cannot start a timer after plugin unload');
	assert.equal(main.doc.body.querySelectorAll('.operon-status-dock').length, 0);
	assert.equal(main.timers.size, 0); assert.equal(viewportEvents.size, 0);
});

test('geometry matches pinned rows and uses 16px glyphs with bounded single-line names', () => {
	const css = readFileSync('styles.css', 'utf8');
	assert.match(css, /\.operon-status-dock \{[^}]*min-height: 44px; height: 44px; padding: 7px 9px/u);
	assert.match(css, /font-size: var\(--font-ui-small\); font-weight: 500; line-height: 1\.35/u);
	assert.equal(css.includes('.operon-status-dock.is-detailed'), false);
	assert.match(css, /\.operon-status-dock-action svg \{ width: 16px; height: 16px/u);
	assert.match(css, /max-width: calc\(24ch \+ 12px\);[^}]*text-overflow: ellipsis/u);
	const source = readFileSync('main.ts', 'utf8');
	assert.match(source, /if \(Platform.isDesktopApp\) \{\s*this.statusDock =/u);
	assert.match(source, /this.statusDock\?\.setDuplicateAlert\(state, duplicateCount\)/u);
	assert.match(source, /this.statusDock\?\.setDuplicateAlert\('hidden'\)/u);
});


test('native tooltip attributes stay absent and append-only icon updates never accumulate glyphs', () => {
	const globals = globalThis as typeof globalThis & { __operonTestSetIcon?: (target: HTMLElement, icon: string) => void };
	const previous = globals.__operonTestSetIcon;
	globals.__operonTestSetIcon = (target, icon) => { const glyph = target.ownerDocument.createElement('svg'); glyph.dataset.icon = icon; target.appendChild(glyph); };
	try {
		const f = widget(); const coffee = f.find('operon-status-dock-timer-controls').children[0];
		const timer = f.find('operon-status-dock-timer-action');
		for (const active of [false, true, false, true]) {
			f.state.settings.statusDockMode = active ? 'detailed' : 'compact';
			f.state.active = active ? snapshot().active : null; f.dock.update(f.state);
			for (const element of [coffee, timer]) assert.equal(element.children.filter((child: Element) => child.tagName === 'SVG').length, 1);
			assert.equal(timer.children.find((child: HTMLElement) => child.tagName === 'SVG')?.dataset.icon, active ? 'square' : 'play');
		}
		for (const element of [f.dock.root, ...Array.from(f.dock.root.querySelectorAll('*'))]) {
			assert.equal(element.getAttribute('aria-label'), null); assert.equal(element.getAttribute('title'), null);
		}
		assert.ok(f.dock.root.getAttribute('aria-labelledby')); f.dock.destroy();
	} finally { globals.__operonTestSetIcon = previous; }
});

test('dock source clicks retain the clicked owner anchor and idle selection starts only a current task', async () => {
	const f = statusDockDocument(); const settings = { ...DEFAULT_SETTINGS }; let active: StatusDockSnapshot['active'] = snapshot().active;
	let pending: string | null = null; let transition: any = null; let selected: string | null = 'chosen'; let picks = 0, starts = 0; const opened: Array<[string, HTMLElement, string]> = [];
	const dock = new OperonStatusDock({ workspace: { containerEl: f.doc.body } } as unknown as App, {
		indexer: { getTask: () => undefined, getAllTasks: () => [], getGeneration: () => 1 }, getSettings: () => settings,
		timeTracker: { getActiveState: () => active, getTransitionState: () => transition } as never,
		breakController: { getSnapshot: () => ({ pendingTaskId: pending, breakState: null, actionPending: false }), getElapsedSeconds: () => 0, selectPendingTask: async (pick: () => Promise<string | null>) => { const before = active, id = await pick(); if (!id || active !== before) return false; starts++; return true; } } as never,
		startTimerForTask: async () => false, openTask: async (id, anchor, behavior) => { opened.push([id, anchor, behavior]); },
		createTrackerTask: async () => null, pickTrackerTask: async () => { picks++; return selected; },
		openFlowTime: async () => {}, openConflicts: () => {},
	});
	const anchor = f.doc.body.createEl('button');
	await (dock as any).openTracker(anchor); assert.deepEqual(opened, [['active', anchor, 'source-and-editor']]); assert.equal(picks, 0);
	active = null; pending = 'paused'; await (dock as any).openTracker(anchor); assert.deepEqual(opened[1], ['paused', anchor, 'source-and-editor']);
	pending = null; active = { ...snapshot().active!, operonId: null, task: null, isUnassigned: true }; selected = null; await (dock as any).openTracker(anchor); assert.equal(starts, 0);
	selected = 'chosen'; await (dock as any).openTracker(anchor); assert.equal(starts, 0);
	active = { ...snapshot().active!, operonId: null, task: null, isUnassigned: true }; (dock as any).dependencies.pickTrackerTask = async () => { active = snapshot().active; return 'late'; };
	await (dock as any).openTracker(anchor); assert.equal(starts, 0, 'a stale finder result cannot replace work started elsewhere');
	(dock as any).upcoming.getSnapshot = () => snapshot().upcoming;
	const context = (dock as any).createWindow({ doc: f.doc, win: f.doc.defaultView });
	context.widget.update(snapshot());
	const upcoming = context.widget.root.querySelector('.operon-status-dock-upcoming');
	upcoming.querySelector('.operon-status-dock-name').click(); await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(opened.at(-1), ['next', upcoming.querySelector('.operon-status-dock-name'), 'source-and-editor']);
	context.dispose();
	dock.onunload();
});

test('single compact precision stays the same across window sizes and legacy mode settings', () => {
	const f = widget(); const times = () => Array.from(f.dock.root.querySelectorAll('.operon-status-dock-time')).slice(0, 2).map(el => el.textContent);
	for (const width of [900, 280, 900]) {
		f.state.settings.statusDockMode = 'detailed'; f.dock.setWidth(width); f.dock.update(f.state);
		assert.deepEqual(times(), ['41m', '2h 34m']);
	}
	f.dock.destroy();
});

test('Compact displays seconds below one minute for both clocks and minutes from 60 seconds', () => {
	const f = widget(); const times = () => Array.from(f.dock.root.querySelectorAll('.operon-status-dock-time')).slice(0, 2).map(el => el.textContent);
	for (const seconds of [0, 1, 29, 59, 60, 61, 119]) {
		f.state.active!.elapsedSeconds = seconds;
		f.state.upcoming.countdown = `00:${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
		f.dock.update(f.state); const expected = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m`;
		assert.deepEqual(times(), [expected, expected]);
	}
	f.state.active = null; f.state.breakSeconds = 43; f.state.breakSnapshot = { ...f.state.breakSnapshot, breakState: { start: new Date().toISOString() } as never };
	f.dock.update(f.state); assert.equal(times()[0], '43s'); f.dock.destroy();
});

test('timer action replaces the decorative stopwatch and remains separate from source and coffee actions', () => {
	const f = widget(); const tracker = f.find('operon-status-dock-tracker'); const timer = f.find('operon-status-dock-timer-action');
	assert.equal(tracker.children[0], timer); assert.equal(f.find('operon-status-dock-tracker-reading').querySelector('.operon-status-dock-leading-icon'), null);
	assert.equal(f.find('operon-status-dock-timer-controls').children.length, 4);
	assert.equal(timer.classList.contains('is-running'), true); timer.click(); f.find('operon-status-dock-tracker-reading').querySelector('.operon-status-dock-name').click();
	assert.deepEqual(f.calls, ['timer', 'source-or-finder']); f.state.active = null; f.dock.update(f.state);
	assert.equal(timer.classList.contains('is-running'), false); f.dock.destroy();
});

test('drag is window-local, bounded, cancellable and cleared on a new dock lifetime', () => {
	const f = widget(); f.dock.setViewport(900, 700, 0, 0);
	const grip = f.find('operon-status-dock-grip');
	const emit = (key: string, event: object) => grip.handlers.get(key)?.forEach((callback: (event: unknown) => void) => callback({ preventDefault() {}, stopPropagation() {}, ...event }));
	const pointer = { pointerId: 1, button: 0, isPrimary: true, clientX: 30, clientY: 30 };
	emit('pointerdown', { ...pointer, button: 2 }); assert.equal(f.dock.root.classList.contains('is-dragging'), false);
	emit('pointerdown', pointer); assert.equal(f.dock.root.classList.contains('is-dragging'), true);
	f.emitWindow('pointermove', { pointerId: 2, clientX: 1000, clientY: 1000 }); assert.equal(f.dock.root.style.transform, undefined);
	f.emitWindow('pointermove', { pointerId: 1, clientX: 1000, clientY: 1000 });
	assert.equal(f.dock.root.style.transform, 'translate(388px, 0px)');
	f.emitWindow('pointerup', { pointerId: 1 }); assert.equal(f.dock.root.classList.contains('is-dragging'), false);
	assert.equal(f.calls.length, 0); assert.equal(f.windowListeners.get('pointermove')?.size, 0);
	f.dock.setViewport(300, 200, 0, 0); assert.equal(f.dock.root.style.transform, 'translate(88px, 0px)');
	emit('keydown', { key: 'Home' }); assert.equal((f.dock as any).position, null);
	emit('pointerdown', pointer); f.emitWindow('pointermove', { pointerId: 1, clientX: 100, clientY: 100 });
	f.emitWindow('keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {} });
	assert.equal((f.dock as any).position, null); assert.equal(f.dock.root.classList.contains('is-dragging'), false);
	emit('keydown', { key: 'ArrowRight', shiftKey: true }); assert.notEqual((f.dock as any).position, null);
	const fresh = widget(); assert.equal((fresh.dock as any).position, null); fresh.dock.destroy();
	emit('pointerdown', pointer); f.dock.destroy();
	for (const key of ['pointermove', 'pointerup', 'pointercancel', 'blur', 'keydown']) assert.equal(f.windowListeners.get(key)?.size, 0);
});

test('alignment is absent from both Settings renderers and Settings Search', () => {
	const registry = readFileSync('src/ui/settings/settings-search-registry.ts', 'utf8');
	const settings = readFileSync('src/ui/settings-tab.ts', 'utf8');
	assert.equal(registry.includes("'statusDockAlignment'"), false); assert.equal(settings.includes("'statusDockAlignment'"), false);
	assert.equal(registry.includes("'statusDockMode'"), false);
	assert.ok(registry.includes("'statusDockClickAction'"));
});


test('click behavior defaults in memory, round trips in UI only and stays optional in backups', () => {
	const missing = migrateSettings({}); assert.equal(missing.statusDockClickAction, undefined);
	assert.equal(resolveStatusDockClickAction(missing.statusDockClickAction), 'source-and-editor');
	assert.equal(migrateSettings({ statusDockClickAction: 'broken' }).statusDockClickAction, undefined);
	for (const clickAction of ['source', 'source-and-editor', 'editor'] as const) {
		const settings = migrateSettings({ statusDockClickAction: clickAction }); assertSettingsBackupCompatibilityRegistryExhaustive(settings);
		const data = buildOperonDataPackageFromSettings(settings); assert.deepEqual(data.ui.statusDock, { clickAction });
		assert.equal('statusDockClickAction' in data.settings, false);
		assert.equal(composeOperonSettingsFromDataPackage(data, DEFAULT_SETTINGS).statusDockClickAction, clickAction);
		const patch = buildOperonSettingsBackupSelectedPatchV1({ selectedGroups: ['general'], candidateSettings: settings });
		assert.equal(patch.statusDockClickAction, clickAction);
	}
	assert.equal('statusDockClickAction' in buildOperonSettingsBackupSelectedPatchV1({ selectedGroups: ['general'], candidateSettings: missing }), false);
});

test('real click preference saves preserve unrelated data; failures and stale saves cannot change it', async () => {
	const fixture = new SettingsPreservationHarness();
	try {
		const storage = fixture.createStorage(); await storage.initialize(); const before = JSON.parse(await fixture.adapter.read(fixture.canonicalPath));
		assert.equal(resolveStatusDockClickAction(storage.getSettings().statusDockClickAction), 'source-and-editor');
		for (const value of ['source', 'editor', 'source-and-editor']) await storage.saveStatusDockPreference('statusDockClickAction', value);
		const after = JSON.parse(await fixture.adapter.read(fixture.canonicalPath)); assert.deepEqual(after.ui.statusDock, { clickAction: 'source-and-editor' });
		delete after.ui.statusDock; assert.deepEqual(after, before);
		fixture.writeFault = 'throw-before'; await assert.rejects(storage.saveStatusDockPreference('statusDockClickAction', 'source'));
		assert.equal(storage.getSettings().statusDockClickAction, 'source-and-editor'); fixture.writeFault = 'none';
		const results = await Promise.allSettled([storage.saveStatusDockPreference('statusDockClickAction', 'editor'), storage.saveStatusDockPreference('statusDockClickAction', 'source')]);
		assert.deepEqual(results.map(result => result.status), ['fulfilled', 'rejected']); assert.equal(storage.getSettings().statusDockClickAction, 'editor');
		const raw = JSON.parse(await fixture.adapter.read(fixture.canonicalPath)); delete raw.ui.statusDock.clickAction; fixture.seed(fixture.canonicalPath, JSON.stringify(raw));
		await storage.reloadCanonicalSettingsPackage(); assert.equal(storage.getSettings().statusDockClickAction, undefined);
		await assert.rejects(storage.saveStatusDockPreference('statusDockClickAction', 'invalid'));
	} finally { await fixture.dispose(); }
});

test('tracking and upcoming route all three click choices with their owner anchor and hold the action lock', async () => {
	const f = statusDockDocument(), settings = { ...DEFAULT_SETTINGS }; const opened: unknown[] = [];
	let release!: () => void, gate = Promise.resolve();
	const dock = new OperonStatusDock({ workspace: { containerEl: f.doc.body } } as unknown as App, {
		indexer: { getTask: () => undefined, getAllTasks: () => [], getGeneration: () => 1 }, getSettings: () => settings,
		timeTracker: { getActiveState: () => snapshot().active, getTransitionState: () => null } as never,
		breakController: { getSnapshot: () => snapshot().breakSnapshot, getElapsedSeconds: () => 0 } as never,
		startTimerForTask: async () => false, openTask: async (...args) => { opened.push(args); await gate; }, createTrackerTask: async () => null, pickTrackerTask: async () => null,
		openFlowTime: async () => {}, openConflicts: () => {},
	});
	(dock as any).upcoming.getSnapshot = () => snapshot().upcoming;
	const context = (dock as any).createWindow({ doc: f.doc, win: f.doc.defaultView }); context.widget.update(snapshot());
	const anchor = f.doc.body.createEl('button'), upcoming = context.widget.root.querySelector('.operon-status-dock-upcoming');
	for (const behavior of ['source', 'editor', 'source-and-editor'] as const) {
		settings.statusDockClickAction = behavior; await (dock as any).openTracker(anchor);
		assert.deepEqual(opened.at(-1), ['active', anchor, behavior]);
		upcoming.querySelector('.operon-status-dock-name').click(); await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(opened.at(-1), ['next', upcoming.querySelector('.operon-status-dock-name'), behavior]);
	}
	gate = new Promise<void>(resolve => { release = resolve; }); const before = opened.length;
	const first = (dock as any).openTracker(anchor); await new Promise(resolve => setImmediate(resolve));
	await (dock as any).openTracker(anchor); assert.equal(opened.length, before + 1); release(); await first;
	context.dispose(); dock.onunload();
});

test('drag grip has an accessible name with no hover tooltip bindings', () => {
	const f = widget(), grip = f.find('operon-status-dock-grip');
	assert.ok(grip.getAttribute('aria-labelledby')); assert.equal(grip.getAttribute('title'), null); assert.equal(grip.getAttribute('aria-label'), null);
	assert.equal(grip.handlers.get('mouseenter')?.size ?? 0, 0); assert.equal(grip.handlers.get('pointerenter')?.size ?? 0, 0); f.dock.destroy();
});


function feedbackHarness() {
	const document = statusDockDocument(), settings = { ...DEFAULT_SETTINGS };
	const tasks = new Map([['active', snapshot().active!.task!]]);
	const state = { active: snapshot().active, transition: null as any, stopCalls: 0, startCalls: 0, saved: 0, opened: 0, failWithError: false };
	const listeners = new Set<(event: any) => void>();
	let finish!: (success: boolean) => void, gate: Promise<boolean>;
	const reset = () => { gate = new Promise<boolean>(resolve => { finish = resolve; }); }; reset();
	const emit = (event: 'state' | 'transition' = 'state') => listeners.forEach(listener => listener(event));
	const tracker = {
		getActiveState: () => state.active, getTransitionState: () => state.transition,
		subscribe: (listener: (event: any) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
		stop: async (_reason: unknown, _end: unknown, guard: () => boolean) => {
			state.stopCalls++; const before = state.active;
			state.transition = { kind: 'stopping', taskId: before?.operonId ?? null, start: before?.start }; emit('transition');
			const success = await gate; state.transition = null;
			if (state.failWithError) { emit(); throw new Error('save failed'); }
			if (!success || !guard()) { emit(); return false; }
			state.saved++; state.active = null; emit(); return true;
		},
		startUnassigned: async () => { state.startCalls++; const success = await gate; if (success) { state.active = { operonId: null, task: null, start: 'unassigned', elapsedSeconds: 0, isUnassigned: true }; emit(); } return success; },
	};
	const controller = new FlowTimeBreakController({ timeTracker: tracker as never, getTask: id => tasks.get(id), getSettings: () => settings,
		saveSettings: async () => {}, stopActiveTimer: guard => tracker.stop('manual', undefined, guard),
		startTimerForTask: async (id, _source, guard) => {
			state.startCalls++; const previousActive = state.active;
			state.active = { operonId: id, task: tasks.get(id) ?? null, start: 'resume', elapsedSeconds: 0, isUnassigned: false };
			state.transition = { kind: 'starting', taskId: id, start: 'resume', previousActive }; emit();
			const success = await gate;
			if (!success || !guard()) { state.active = previousActive; state.transition = null; emit(); return false; }
			state.transition = null; emit(); return true;
		}, playReminderSound: async () => {}, scheduleTick: () => () => {},
	});
	const dock = new OperonStatusDock({ workspace: { containerEl: document.doc.body } } as unknown as App, {
		indexer: { getTask: id => tasks.get(id), getAllTasks: () => [], getGeneration: () => 1 }, timeTracker: tracker as never,
		breakController: controller, getSettings: () => settings, openFlowTime: async () => { state.opened++; },
		startTimerForTask: async () => false, openTask: async () => {}, createTrackerTask: async () => null, pickTrackerTask: async () => null, openConflicts: () => {},
	});
	const views: any[] = [], updates: StatusDockSnapshot[] = [];
	for (const owner of [document, statusDockDocument()]) {
		const container = { doc: owner.doc, win: owner.doc.defaultView };
		const context = (dock as any).createWindow(container); owner.doc.body.appendChild(context.widget.slot);
		const update = context.widget.update.bind(context.widget); context.widget.update = (value: StatusDockSnapshot) => { updates.push(value); update(value); };
		(dock as any).windows.set(container, context); views.push(context.widget);
	}
	const refresh = () => (dock as any).renderWidgets();
	const unsubscribeTracker = tracker.subscribe(refresh), unsubscribeBreak = controller.subscribe(refresh); refresh();
	const read = () => views.map(widget => { const action = widget.root.querySelector('.operon-status-dock-timer-action'), coffee = widget.root.querySelector('.operon-status-dock-timer-controls').children[0];
		return { glyph: widget.icons.get(action), time: widget.root.querySelector('.operon-status-dock-time').textContent, coffee: coffee.getAttribute('aria-pressed'), disabled: action.disabled }; });
	return { dock, controller, tracker, state, settings, tasks, updates, views, read, reset, resolve: (success: boolean) => finish(success), emit,
		clickCoffee: () => { views[0].root.querySelector('.operon-status-dock-timer-controls').children[0].click(); return (dock as any).action as Promise<void>; },
		close: () => { dock.onunload(); controller.destroy(); unsubscribeTracker(); unsubscribeBreak(); } };
}

test('Stop updates every dock before saving and commits through the existing stop/FlowTime path', async () => {
	const h = feedbackHarness(); try {
		const active = h.state.active; const opening = (h.dock as any).toggleTimer();
		assert.deepEqual(h.read().map(v => [v.glyph, v.time, v.disabled]), [['play', '0s', true], ['play', '0s', true]]);
		assert.equal(h.state.active, active); assert.equal(h.state.saved, 0); assert.equal(h.state.opened, 0);
		await Promise.resolve(); await (h.dock as any).toggleTimer(); assert.equal(h.state.stopCalls, 1);
		h.resolve(true); await opening; assert.equal(h.state.saved, 1); assert.equal(h.state.opened, 1);
		assert.equal(h.read()[0].disabled, false);
	} finally { h.close(); }
});

for (const rejection of [false, true]) test(`Stop restores the authoritative running view after ${rejection ? 'save rejection' : 'false save result'}`, async () => {
	const h = feedbackHarness(); try {
		h.state.failWithError = rejection; const opening = (h.dock as any).toggleTimer();
		assert.equal(h.read()[0].glyph, 'play'); h.resolve(false);
		if (rejection) await assert.rejects(opening, /save failed/); else await opening;
		assert.equal(h.read()[0].glyph, 'square'); assert.equal(h.read()[0].time, '41m');
		assert.equal(h.read()[0].disabled, false); assert.equal(h.state.saved, 0); assert.equal(h.state.opened, 0);
	} finally { h.close(); }
});

test('Coffee previews a break immediately without mutating it and never flashes idle during the saved stop', async () => {
	const h = feedbackHarness(); try {
		h.updates.length = 0; const opening = h.clickCoffee();
		assert.deepEqual(h.read().map(v => [v.glyph, v.time, v.coffee]), [['play', '0s', 'true'], ['play', '0s', 'true']]);
		assert.equal(h.controller.getSnapshot().breakState, null); assert.ok(h.state.active);
		await Promise.resolve(); h.views[1].root.querySelector('.operon-status-dock-timer-controls').children[0].click();
		h.resolve(true); await opening; assert.equal(h.state.stopCalls, 1); assert.ok(h.controller.getSnapshot().breakState);
		assert.ok(h.updates.every(value => value.breakSnapshot.breakState !== null)); assert.equal(h.state.opened, 0);
	} finally { h.close(); }
});

test('Coffee failure removes the visual break and restores the real active timer', async () => {
	const h = feedbackHarness(); try {
		const opening = h.clickCoffee(); assert.equal(h.read()[0].coffee, 'true'); h.resolve(false); await opening;
		assert.equal(h.read()[0].glyph, 'square'); assert.equal(h.read()[0].coffee, 'false');
		assert.equal(h.controller.getSnapshot().pendingTaskId, null); assert.equal(h.controller.getSnapshot().breakState, null); assert.equal(h.state.saved, 0);
	} finally { h.close(); }
});

test('Play previews resume through provisional allocation and restores the original break on a failed start', async () => {
	const h = feedbackHarness(); try {
		h.resolve(true); await h.controller.startBreak(); h.reset(); const before = h.controller.getSnapshot().breakState;
		const opening = (h.dock as any).toggleTimer();
		assert.equal(h.read()[0].glyph, 'square'); assert.equal(h.read()[0].coffee, 'false'); assert.deepEqual(h.controller.getSnapshot().breakState, before);
		await new Promise(resolve => setImmediate(resolve)); assert.equal(h.state.transition.kind, 'starting');
		assert.equal(h.read()[0].glyph, 'square'); assert.equal(h.read()[0].coffee, 'false');
		h.resolve(false); await opening; assert.equal(h.read()[0].glyph, 'play'); assert.equal(h.read()[0].coffee, 'true');
		assert.deepEqual(h.controller.getSnapshot().breakState, before);
	} finally { h.close(); }
});

for (const success of [false, true]) test(`Idle Play changes immediately and ${success ? 'opens FlowTime after commit' : 'returns to idle on rejection'}`, async () => {
	const h = feedbackHarness(); try {
		h.state.active = null; h.emit(); const opening = (h.dock as any).toggleTimer();
		assert.equal(h.read()[0].glyph, 'square'); assert.equal(h.state.active, null);
		h.resolve(success); await opening; assert.equal(h.read()[0].glyph, success ? 'square' : 'play'); assert.equal(h.state.opened, success ? 1 : 0);
	} finally { h.close(); }
});

for (const sameTask of [false, true]) test(`A newer ${sameTask ? 'session for the same task' : 'task'} permanently supersedes a pending Coffee preview`, async () => {
	const h = feedbackHarness(); try {
		const opening = h.clickCoffee(); await new Promise(resolve => setImmediate(resolve));
		h.state.active = { ...snapshot().active!, operonId: sameTask ? 'active' : 'other', start: 'newer' }; h.emit();
		assert.equal(h.read()[0].glyph, 'square'); assert.equal(h.read()[0].coffee, 'false');
		h.state.active = null; h.emit(); assert.equal(h.read()[0].coffee, null);
		h.resolve(true); await opening; assert.equal(h.read()[0].coffee, null); assert.equal(h.state.saved, 0);
	} finally { h.close(); }
});

test('unload discards pending presentation and cannot open FlowTime after completion', async () => {
	const h = feedbackHarness(); const opening = (h.dock as any).toggleTimer();
	h.dock.onunload(); assert.equal((h.dock as any).presentation, null); h.resolve(true); await opening;
	assert.equal(h.state.opened, 0); assert.equal((h.dock as any).windows.size, 0); h.controller.destroy();
});


test('ending a break previews the waiting task and Play resumes it without opening FlowTime', async () => {
	const h = feedbackHarness(); try {
		h.resolve(true); await h.controller.startBreak(); h.reset();
		const ending = h.clickCoffee(); assert.equal(h.read()[0].coffee, null); assert.equal(h.read()[0].glyph, 'play');
		assert.ok(h.controller.getSnapshot().breakState); await ending;
		assert.equal(h.controller.getSnapshot().breakState, null); assert.equal(h.controller.getSnapshot().pendingTaskId, 'active');
		const starting = (h.dock as any).toggleTimer(); assert.equal(h.read()[0].glyph, 'square'); assert.equal(h.state.active, null);
		h.resolve(true); await starting; assert.equal(h.tracker.getActiveState()?.operonId, 'active');
		assert.equal(h.read()[0].glyph, 'square'); assert.equal(h.controller.getSnapshot().pendingTaskId, null); assert.equal(h.state.opened, 0);
	} finally { h.close(); }
});


test('dock preserves coffee during work and breaks and offers Finder when waiting', async () => {
	const h = feedbackHarness(); const icon = () => { const button = h.views[0].root.querySelector('.operon-status-dock-timer-controls').children[0]; return { icon: h.views[0].icons.get(button), disabled: button.disabled }; };
	try {
		assert.equal(icon().icon, 'coffee'); h.resolve(true); await h.controller.startBreak(); assert.equal(icon().icon, 'coffee');
		h.controller.endBreak(); assert.deepEqual(icon(), { icon: 'scan-search', disabled: false });
		assert.equal(h.views[0].root.querySelector('.operon-status-dock-timer-controls').children[0].getAttribute('aria-pressed'), null);
		(h.dock as any).dependencies.pickTrackerTask = async () => null; const canceled = h.clickCoffee(); await canceled;
		assert.equal(h.controller.getSnapshot().pendingTaskId, 'active'); assert.equal(icon().icon, 'scan-search');
		h.reset(); h.tasks.set('other', { ...snapshot().active!.task!, operonId: 'other' });
		(h.dock as any).dependencies.pickTrackerTask = async () => 'other'; const selecting = h.clickCoffee();
		await new Promise(resolve => setImmediate(resolve)); assert.equal(h.state.transition.taskId, 'other');
		h.resolve(true); await selecting; assert.equal(h.state.active?.operonId, 'other'); assert.equal(h.controller.getSnapshot().pendingTaskId, null);
		assert.equal(icon().icon, 'coffee'); assert.equal(h.state.startCalls, 1); assert.equal(h.state.opened, 0);
	} finally { h.close(); }
});

test('a failed Finder start restores the old waiting task and Finder control', async () => {
	const h = feedbackHarness(); try {
		h.resolve(true); await h.controller.startBreak(); h.controller.endBreak(); h.reset();
		h.tasks.set('other', { ...snapshot().active!.task!, operonId: 'other' }); (h.dock as any).dependencies.pickTrackerTask = async () => 'other';
		const selecting = h.clickCoffee(); await new Promise(resolve => setImmediate(resolve)); h.resolve(false); await selecting;
		assert.equal(h.state.active, null); assert.equal(h.controller.getSnapshot().pendingTaskId, 'active');
		const button = h.views[0].root.querySelector('.operon-status-dock-timer-controls').children[0];
		assert.equal(h.views[0].icons.get(button), 'scan-search'); assert.equal(button.disabled, false);
	} finally { h.close(); }
});


test('stopped dock hides elapsed time and idle Finder uses the same description as the idle reading', () => {
	const f = widget(); f.state.active = null; f.dock.update(f.state);
	const clock = f.find('operon-status-dock-time'), secondary = f.find('operon-status-dock-timer-controls').children[0];
	assert.equal(clock.hidden, true); assert.equal((f.dock as any).icons.get(secondary), 'scan-search'); assert.equal(secondary.disabled, false);
	const hint = JSON.stringify(['Task Finder', 'Track a different task']);
	assert.equal((f.dock as any).tooltipKeys.get(secondary), hint); assert.equal((f.dock as any).tooltipKeys.has(f.find('operon-status-dock-tracker-reading')), false);
	f.state.breakSnapshot = { ...f.state.breakSnapshot, pendingTaskId: 'waiting' }; f.dock.update(f.state); assert.equal(clock.hidden, true);
	f.state.active = snapshot().active; f.dock.update(f.state); assert.equal(clock.hidden, false); assert.equal((f.dock as any).icons.get(secondary), 'coffee');
	f.state.active = null; f.state.breakSnapshot = { ...f.state.breakSnapshot, breakState: { taskId: 'waiting', startMs: Date.now(), targetSeconds: 60 } }; f.dock.update(f.state);
	assert.equal(clock.hidden, false); f.dock.destroy();
});

for (const control of ['icon']) test(`idle Finder ${control} uses the common guarded selection and Cancel preserves idle`, async () => {
	const h = feedbackHarness(); try {
		h.state.active = null; h.emit(); let picked: string | null = null;
		(h.dock as any).dependencies.pickTrackerTask = async () => picked;
		const choose = () => control === 'icon' ? h.clickCoffee() : (h.dock as any).openTracker(h.views[0].root.querySelector('.operon-status-dock-tracker-reading'));
		await choose(); assert.equal(h.state.active, null); assert.equal(h.state.startCalls, 0);
		picked = 'active'; const selecting = choose(); await new Promise(resolve => setImmediate(resolve)); h.resolve(true); await selecting;
		assert.equal(h.tracker.getActiveState()?.operonId, 'active'); assert.equal(h.state.startCalls, 1); assert.equal(h.state.opened, 0);
	} finally { h.close(); }
});

for (const initial of ['idle', 'waiting', 'unassigned'] as const) test(`Creator uses shared selection from ${initial} and never opens FlowTime`, async () => {
 const h = feedbackHarness(); try {
  h.state.active = initial === 'unassigned' ? { operonId: null, task: null, start: 'original', elapsedSeconds: 2460, isUnassigned: true } : null;
  if (initial === 'waiting') (h.controller as any).pendingTaskId = 'active';
  h.tasks.set('created', task('created', '2026-10-24')); let creates = 0;
  (h.dock as any).dependencies.createTrackerTask = async (canUse: () => boolean) => { assert.equal(canUse(), true); creates++; return 'created'; };
  h.emit(); const button = h.views[0].root.querySelector('.operon-status-dock-creator');
  assert.equal(button.hidden, false); assert.equal(h.views[0].icons.get(button), 'list-plus');
  button.click(); await new Promise(resolve => setImmediate(resolve)); h.resolve(true); await (h.dock as any).action;
  assert.equal(creates, 1); assert.equal(h.state.active?.operonId, 'created'); assert.equal(h.state.opened, 0);
 } finally { h.close(); }
});
test('running unassigned timer offers Finder and Creator; Cancel retains its elapsed work', async () => {
 const h = feedbackHarness(); try {
  const original = { operonId: null, task: null, start: 'original', elapsedSeconds: 2460, isUnassigned: true };
  h.state.active = original; h.emit(); const button = h.views[0].root.querySelector('.operon-status-dock-timer-controls').children[0];
  assert.equal(h.views[0].icons.get(button), 'scan-search'); assert.equal(button.disabled, false);
  await h.clickCoffee(); assert.equal(h.state.active, original); assert.equal(h.state.stopCalls, 0);
  assert.equal(h.views[0].root.querySelector('.operon-status-dock-creator').hidden, false);
 } finally { h.close(); }
});

for (const outcome of ['cancel', 'failed-start', 'superseded'] as const) test(`Creator ${outcome} retains saved tasks and authoritative timer state`, async () => {
 const h = feedbackHarness(); try {
  const original = { operonId: null, task: null, start: 'original', elapsedSeconds: 2460, isUnassigned: true }; h.state.active = original;
  (h.dock as any).dependencies.createTrackerTask = async () => {
   if (outcome === 'cancel') return null;
   h.tasks.set('created', task('created', '2026-10-24'));
   if (outcome === 'superseded') { h.state.active = snapshot().active; h.emit(); }
   return 'created';
  };
  const opening = (h.dock as any).createTaskForTimer(h.views[0].root);
  await new Promise(resolve => setImmediate(resolve)); h.resolve(false); await opening;
  if (outcome !== 'superseded') assert.equal(h.state.active, original); else assert.equal(h.state.active?.operonId, 'active');
  assert.equal(h.tasks.has('created'), outcome !== 'cancel'); assert.equal(h.state.saved, 0); assert.equal(h.state.stopCalls, 0);
 } finally { h.close(); }
});

for (const action of ['finder', 'creator'] as const) for (const outcome of ['success', 'cancel', 'failure'] as const) test(`break ${action} ${outcome} preserves coffee and commits the new task only after start`, async () => {
 const h = feedbackHarness(); try {
  h.resolve(true); await h.controller.startBreak(); h.reset(); const before = h.controller.getSnapshot().breakState;
  h.tasks.set('other', task('other', '2026-10-25'));
  (h.dock as any).dependencies.pickTrackerTask = (h.dock as any).dependencies.createTrackerTask = async () => outcome === 'cancel' ? null : 'other';
  const selector = action === 'finder' ? '.operon-status-dock-break-finder' : '.operon-status-dock-creator';
  const button = h.views[0].root.querySelector(selector), coffee = h.views[0].root.querySelector('.operon-status-dock-timer-controls').children[0];
  assert.equal(button.hidden, false); assert.equal(h.views[0].icons.get(coffee), 'coffee'); assert.equal(coffee.getAttribute('aria-pressed'), 'true');
  button.click(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.controller.getSnapshot().breakState, before); h.resolve(outcome === 'success'); await (h.dock as any).action;
  assert.equal(h.state.active?.operonId ?? null, outcome === 'success' ? 'other' : null);
  assert.deepEqual(h.controller.getSnapshot().breakState, outcome === 'success' ? null : before);
  assert.equal(h.state.saved, 1); assert.equal(h.state.opened, 0);
 } finally { h.close(); }
});
test('selection divider is visible only with Finder/Creator and coffee keeps its break action', async () => {
 const f = widget(); const divider = f.find('operon-status-dock-selection-divider');
 assert.equal(divider.hidden, true); f.state.active = null; f.dock.update(f.state); assert.equal(divider.hidden, false);
 f.state.breakSnapshot = { pendingTaskId: 'active', actionPending: false, breakState: { taskId: 'active', startMs: 1, targetSeconds: 60 } }; f.dock.update(f.state);
 const finder = f.find('operon-status-dock-break-finder'); assert.equal(finder.hidden, false); finder.click(); f.find('operon-status-dock-timer-controls').children[0].click();
 assert.deepEqual(f.calls, ['finder', 'coffee']); f.dock.destroy();
});

test('hiding break Finder and Creator closes their bound hover panels', () => {
 const f = widget(); f.state.active = null; f.state.breakSnapshot = { pendingTaskId: 'active', actionPending: false, breakState: { taskId: 'active', startMs: 1, targetSeconds: 60 } }; f.dock.update(f.state);
 const finder = f.find('operon-status-dock-break-finder'), creator = f.find('operon-status-dock-creator'); let finderCloses = 0, creatorCloses = 0;
 finder._operonHoverClose = () => { finderCloses++; }; creator._operonHoverClose = () => { creatorCloses++; };
 f.state.breakSnapshot = { pendingTaskId: 'active', actionPending: false, breakState: null }; f.dock.update(f.state); assert.equal(finderCloses, 1);
 f.state.active = snapshot().active; f.dock.update(f.state); assert.equal(creatorCloses, 1); f.dock.destroy();
});

for (const expiry of ['keep', 'next'] as const) test(`desktop keeps expired current and advances next regardless of legacy expiry=${expiry}`, () => {
 const settings = { ...DEFAULT_SETTINGS, upcomingStatusBarExpiryAction: expiry, upcomingShowStatusBar: true }; const stored = JSON.stringify(settings);
 let now = new Date(2026, 9, 24, 10), generation = 1;
 let tasks = [task('a','2026-10-24T10:00:02'),task('b','2026-10-24T10:00:04'),task('c','2026-10-24T10:00:06')];
 const timers = new Set<() => void>();
 const model = new UpcomingTaskStatusModel({ getAllTasks: () => tasks, getGeneration: () => generation }, () => settings, () => {}, callback => { timers.add(callback); return () => { timers.delete(callback); }; }, () => now, true);
 const read = () => [model.getSnapshot().task?.operonId, model.getSnapshot().next?.task.operonId];
 model.refresh(); assert.deepEqual(read(), ['a',undefined]);
 now = new Date(2026,9,24,10,0,2); model.refresh(); assert.deepEqual(read(), ['a','b']); assert.equal(model.getSnapshot().due,true);
 now = new Date(2026,9,24,10,0,4); model.refresh(); assert.deepEqual(read(), ['a','c']); assert.equal(timers.size,1);
 tasks = tasks.filter(t => t.operonId !== 'a'); generation++; model.refresh(); assert.deepEqual(read(), ['c',undefined]);
 assert.equal(JSON.stringify(settings),stored); settings.upcomingShowStatusBar = false; model.refresh(); assert.equal(model.getSnapshot().task,null); assert.equal(model.getSnapshot().next,undefined); assert.equal(timers.size,0); model.destroy();
});
for (const change of ['reschedule','complete','delete'] as const) test(`desktop revalidates retained task after ${change} in the same minute`, () => {
 const settings = { ...DEFAULT_SETTINGS }; let now = new Date(2026,9,24,10), generation = 1;
 const a = task('a','2026-10-24T10:00:01'), b = task('b','2026-10-24T10:00:10'); let tasks = [a,b];
 const model = new UpcomingTaskStatusModel({getAllTasks:()=>tasks,getGeneration:()=>generation},()=>settings,()=>{},()=>()=>{},()=>now,true);
 model.refresh(); now = new Date(2026,9,24,10,0,2); model.refresh(); assert.equal(model.getSnapshot().next?.task.operonId,'b');
 if(change==='delete')tasks=[b]; else if(change==='reschedule')a.fieldValues.datetimeStart='2026-10-24T10:00:20'; else a.checkbox='done';
 generation++; model.refresh(); assert.equal(model.getSnapshot().task?.operonId,'b'); assert.equal(model.getSnapshot().next,null); model.destroy();
});
test('taskless reading is plain, while assigned tasks retain keyboard and source interaction', async () => {
 const f = widget(), reading=f.find('operon-status-dock-tracker-reading').querySelector('.operon-status-dock-name');
 for(const active of [null,{operonId:null,task:null,start:'s',elapsedSeconds:12,isUnassigned:true}]) {
  f.state.active=active; f.dock.update(f.state); assert.equal(reading.tagName,'SPAN'); assert.equal(reading.getAttribute('role'),null); assert.equal(reading.getAttribute('aria-labelledby'),null); assert.equal((f.dock as any).tooltipKeys.has(reading),false);
  reading.click(); assert.equal(f.calls.length,0);
 }
 assert.equal(f.find('operon-status-dock-name').textContent,'Select or create a new task');
 f.state.active=snapshot().active; f.dock.update(f.state); assert.equal(reading.getAttribute('role'),'button'); reading.click(); assert.deepEqual(f.calls,['source-or-finder']);
 for(const key of ['Enter',' ']) reading.handlers.get('keydown').forEach((handler:any)=>handler({key,preventDefault(){},stopPropagation(){}}));
 assert.equal(f.calls.length,3); f.dock.destroy();
});
test('dual upcoming fields use configured Scheduled/Due icons, separate actions and hide empty separators', () => {
 const f=widget(); f.state.settings.keyMappings=f.state.settings.keyMappings.map(m=>({...m,icon:m.canonicalKey==='dateScheduled'?'alarm-clock':m.canonicalKey==='dateDue'?'flag':m.icon}));
 f.state.upcoming={...f.state.upcoming,due:true,countdown:'00:00:00',next:{task:task('future','2026-10-24T12:00:00'),countdown:'01:00:00'}}; f.dock.update(f.state);
 const next=f.find('operon-status-dock-next'),divider=f.find('operon-status-dock-next-divider'),current=f.find('operon-status-dock-upcoming');
 assert.equal(divider.hidden,false); assert.equal(next.hidden,false); assert.equal((f.dock as any).icons.get(current.querySelector('.operon-status-dock-leading-icon')),'alarm-clock'); assert.equal((f.dock as any).icons.get(next.querySelector('.operon-status-dock-leading-icon')),'flag');
 next.querySelector('.operon-status-dock-name').click(); current.querySelector('.operon-status-dock-name').click(); assert.deepEqual(f.calls,['next','upcoming']); let closed=0; next.querySelector('.operon-status-dock-name')._operonHoverClose=()=>{closed++;}; f.dock.closeTooltips(); assert.equal(closed,1);
 f.state.settings.upcomingShowStatusBar=false; f.dock.update(f.state); assert.equal(next.hidden,true); assert.equal(divider.hidden,true); assert.equal(closed,2); f.state.settings.upcomingShowStatusBar=true; f.state.upcoming.next=null; f.dock.update(f.state); assert.equal(divider.hidden,true); f.dock.destroy();
});

for(const behavior of ['source','editor','source-and-editor'] as const)test(`retained and next task open their own task using ${behavior}`,async()=>{
 const h=feedbackHarness();try{
  const opened:string[]=[];h.settings.statusDockClickAction=behavior;
  (h.dock as any).dependencies.openTask=async(id:string,_anchor:HTMLElement,action:string)=>{opened.push(`${id}:${action}`);};
  (h.dock as any).upcoming.getSnapshot=()=>({...snapshot().upcoming,task:task('retained','2026-10-24T10:00:00'),due:true,countdown:'00:00:00',next:{task:task('future','2026-10-24T12:00:00'),countdown:'02:00:00'}});h.emit();
  for(const selector of ['.operon-status-dock-upcoming','.operon-status-dock-next']){h.views[0].root.querySelector(selector).querySelector('.operon-status-dock-name').click();await new Promise(resolve=>setImmediate(resolve));}
  assert.deepEqual(opened,[`retained:${behavior}`,`future:${behavior}`]);
 }finally{h.close();}
});

test('dual upcoming second ticks retain both task and clock nodes',()=>{
 const f=widget();f.state.upcoming.next={task:task('future','2026-10-24T12:00:00'),countdown:'00:00:25'};f.state.upcoming.due=true;f.dock.update(f.state);
 const next=f.find('operon-status-dock-next'),current=f.find('operon-status-dock-upcoming'),name=next.querySelector('.operon-status-dock-name'),clock=next.querySelector('.operon-status-dock-time');
 f.state.upcoming.next.countdown='00:00:24';f.dock.update(f.state);assert.equal(f.find('operon-status-dock-next'),next);assert.equal(f.find('operon-status-dock-upcoming'),current);assert.equal(next.querySelector('.operon-status-dock-name'),name);assert.equal(next.querySelector('.operon-status-dock-time'),clock);assert.equal(clock.textContent,'24s');f.dock.destroy();
});

for(const kind of ['explicit','estimate','midnight'] as const)test(`cold dock finds ongoing calendar block (${kind}) before the future task`,()=>{
 const settings={...DEFAULT_SETTINGS};const now=new Date(2026,9,25,10,0,0), current=task('current',kind==='midnight'?'2026-10-24T23:00:00':'2026-10-25T09:00:00'),next=task('future','2026-10-25T11:00:00');
 if(kind==='estimate')current.fieldValues.estimate='7200';else current.fieldValues.datetimeEnd='2026-10-25T10:30:00';
 const tasks=[next,current],read=(desktop:boolean)=>{const model=new UpcomingTaskStatusModel({getAllTasks:()=>tasks,getGeneration:()=>1},()=>settings,()=>{},()=>()=>{},()=>now,desktop);model.refresh();const value=model.getSnapshot();model.destroy();return value;};
 const value=read(true);assert.equal(value.task?.operonId,'current');assert.equal(value.current,true);assert.equal(value.next?.task.operonId,'future');assert.equal(value.countdown,'00:00:00');
 assert.equal(read(false).task?.operonId,'future','mobile keeps its existing future selection');
});
test('ongoing end boundary refreshes within the same minute and terminal blocks are excluded',()=>{
 let now=new Date(2026,9,25,10,0,0),scans=0;const a=task('long','2026-10-25T09:00:00'),b=task('short','2026-10-25T09:30:00'),done=task('done','2026-10-25T09:59:00');a.fieldValues.datetimeEnd='2026-10-25T11:00:00';b.fieldValues.datetimeEnd='2026-10-25T10:00:02';done.fieldValues.datetimeEnd='2026-10-25T12:00:00';done.checkbox='done';
 const model=new UpcomingTaskStatusModel({getAllTasks:()=>{scans++;return [done,b,a];},getGeneration:()=>1},()=>DEFAULT_SETTINGS,()=>{},()=>()=>{},()=>now,true);
 model.refresh();assert.equal(model.getSnapshot().task?.operonId,'long');assert.equal(model.getSnapshot().next,null);now=new Date(2026,9,25,10,0,1);model.refresh();assert.equal(scans,1);
 now=new Date(2026,9,25,10,0,2);model.refresh();assert.equal(scans,2);assert.equal(model.getSnapshot().task?.operonId,'long');model.destroy();
});
test('task icons override mapping fallbacks for both current and upcoming fields',()=>{
 const f=widget();f.state.upcoming={...f.state.upcoming,current:true,due:true,next:{task:task('future','2026-10-25T12:00:00'),countdown:'02:00:00'}};
 f.state.upcoming.task!.fieldValues.taskIcon='lucide-flask-conical';f.state.upcoming.next!.task.fieldValues.taskIcon='book-open';f.dock.update(f.state);
 const icon=(cls:string)=>(f.dock as any).icons.get(f.find(cls).querySelector('.operon-status-dock-leading-icon'));
 assert.equal(icon('operon-status-dock-upcoming'),'flask-conical');assert.equal(icon('operon-status-dock-next'),'book-open');
 f.state.upcoming.task!.fieldValues.taskIcon='';f.state.upcoming.next!.task.fieldValues.taskIcon='';f.dock.update(f.state);
 assert.equal(icon('operon-status-dock-upcoming'),f.state.settings.keyMappings.find(m=>m.canonicalKey==='dateScheduled')?.icon||'calendar-clock');assert.equal(icon('operon-status-dock-next'),f.state.settings.keyMappings.find(m=>m.canonicalKey==='dateDue')?.icon||'calendar');
 f.state.upcoming.current=false;f.state.upcoming.due=false;f.state.upcoming.next=null;f.dock.update(f.state);assert.equal(icon('operon-status-dock-upcoming'),f.state.settings.keyMappings.find(m=>m.canonicalKey==='dateDue')?.icon||'calendar');f.dock.destroy();
});

test('ongoing calendar end is a scheduled wake boundary even with minute precision',()=>{
 let now=new Date(2026,9,25,10),delay=0;const a=task('long','2026-10-25T09:00:00'),b=task('short','2026-10-25T09:30:00');a.fieldValues.datetimeEnd='2026-10-25T11:00:00';b.fieldValues.datetimeEnd='2026-10-25T10:00:02';
 const model=new UpcomingTaskStatusModel({getAllTasks:()=>[a,b],getGeneration:()=>1},()=>({...DEFAULT_SETTINGS,upcomingCountdownDisplay:'minutes'}),()=>{},(_callback,ms)=>{delay=ms;return()=>{};},()=>now,true);
 model.refresh();assert.equal(model.getSnapshot().task?.operonId,'long');assert.equal(delay,2000);now=new Date(2026,9,25,10,0,2);model.refresh();assert.equal(model.getSnapshot().task?.operonId,'long');model.destroy();
});

test('current task moves Now into its name tooltip while future countdowns remain unchanged',()=>{
 const f=widget();f.state.upcoming.current=true;f.state.upcoming.due=true;f.state.upcoming.countdown='00:00:00';f.state.upcoming.next={task:task('future','2026-10-25T12:00:00'),countdown:'02:34:57'};f.dock.update(f.state);
 const current=f.find('operon-status-dock-upcoming'),next=f.find('operon-status-dock-next');assert.equal(current.querySelector('.operon-status-dock-time').textContent,'');assert.equal(current.classList.contains('is-current'),true);assert.equal(next.querySelector('.operon-status-dock-time').textContent,'2h 34m');
 f.state.upcoming.current=false;f.state.upcoming.due=false;f.state.upcoming.countdown='00:00:25';f.dock.update(f.state);assert.equal(current.classList.contains('is-current'),false);assert.equal(current.querySelector('.operon-status-dock-time').textContent,'25s');f.dock.destroy();
});
test('both task icons use normalized task color and clear it when color is absent or invalid',()=>{
 const f=widget();f.state.upcoming.next={task:task('future','2026-10-25T12:00:00'),countdown:'01:00:00'};f.state.upcoming.task!.fieldValues.taskColor='AABBCC';f.state.upcoming.next!.task.fieldValues.taskColor='#123456';f.dock.update(f.state);
 const current=f.find('operon-status-dock-upcoming').querySelector('.operon-status-dock-leading-icon'),next=f.find('operon-status-dock-next').querySelector('.operon-status-dock-leading-icon');assert.equal(current.style.color,'#AABBCC');assert.equal(next.style.color,'#123456');
 f.state.upcoming.task!.fieldValues.taskColor='';f.state.upcoming.next!.task.fieldValues.taskColor='invalid';f.dock.update(f.state);assert.equal(current.style.color,'');assert.equal(next.style.color,'');f.dock.destroy();
});

for(const active of [false,true])test(`legacy disabled timer preference cannot hide desktop tracker: active=${active}`,()=>{
 const f=widget();f.state.settings.trackerShowStatusBarTimer=false;f.state.settings.upcomingShowStatusBar=false;f.state.alert.state='hidden';if(!active)f.state.active=null;
 const before=JSON.stringify(f.state.settings);f.dock.update(f.state);assert.equal(f.dock.slot.hidden,false);assert.equal(f.find('operon-status-dock-tracker').hidden,false);assert.equal(f.find('operon-status-dock-timer-action').disabled,false);assert.equal(JSON.stringify(f.state.settings),before);f.dock.destroy();
});

test('all ongoing blocks are ordered by start then ID with deduplication and one index scan per boundary',()=>{
 let now=new Date(2026,9,25,10),generation=1,scans=0,delay=0;const a=task('a','2026-10-25T09:00:00'),b=task('b','2026-10-25T09:30:00'),c=task('c','2026-10-25T09:30:00'),future=task('future','2026-10-25T12:00:00');
 a.fieldValues.datetimeEnd='2026-10-25T11:00:00';b.fieldValues.datetimeEnd='2026-10-25T10:00:02';c.fieldValues.datetimeEnd='2026-10-25T11:00:00';
 const model=new UpcomingTaskStatusModel({getAllTasks:()=>{scans++;return[c,b,a,b,future];},getGeneration:()=>generation},()=>({...DEFAULT_SETTINGS,upcomingCountdownDisplay:'minutes'}),()=>{},(_cb,ms)=>{delay=ms;return()=>{};},()=>now,true);
 const ids=()=>model.getSnapshot().ongoing?.map(t=>t.operonId);
 model.refresh();assert.deepEqual(ids(),['a','b','c']);assert.equal(model.getSnapshot().task?.operonId,'a');assert.equal(model.getSnapshot().next?.task.operonId,'future');assert.equal(delay,2000);
 (model.getSnapshot().ongoing as IndexedTask[]).reverse();assert.deepEqual(ids(),['a','b','c']);
 now=new Date(2026,9,25,10,0,1);model.refresh();assert.equal(scans,1);
 now=new Date(2026,9,25,10,0,2);model.refresh();assert.deepEqual(ids(),['a','c']);assert.equal(scans,2);
 a.fieldValues.datetimeStart='2026-10-25T13:00:00';a.fieldValues.datetimeEnd='2026-10-25T14:00:00';c.checkbox='done';generation++;model.refresh();assert.deepEqual(ids(),[]);assert.equal(model.getSnapshot().task?.operonId,'future');model.destroy();
});
test('multi-current rows keep nodes, colors, actions and scroll position across ticks and membership changes',()=>{
 const f=widget(),a=task('a','2026-10-25T09:00:00'),b=task('b','2026-10-25T10:00:00');a.fieldValues.taskIcon='flask-conical';a.fieldValues.taskColor='#123456';b.fieldValues.taskIcon='book';
 f.state.upcoming={task:a,current:true,due:true,countdown:'00:00:00',ongoing:[a,b],next:{task:task('future','2026-10-25T12:00:00'),countdown:'01:00:00'}};f.dock.update(f.state);
 const rows=(f.dock as any).currentReadings,first=rows.get('a'),second=rows.get('b'),area=f.find('operon-status-dock-task-area');
 assert.equal(f.find('operon-status-dock-upcoming').hidden,true);assert.equal(rows.size,2);assert.equal(first.divider.hidden,true);assert.equal(second.divider.hidden,false);assert.equal(first.time.textContent,'');assert.equal(first.icon.style.color,'#123456');assert.equal((f.dock as any).icons.get(second.icon),'book');
 first.name.click();second.name.click();assert.deepEqual(f.calls,['current:a','current:b']);area.scrollLeft=50;second.name.focus();
 f.state.active!.elapsedSeconds++;f.state.upcoming.next!.countdown='00:59:59';f.dock.update(f.state);assert.equal(rows.get('b').button,second.button);assert.equal(area.scrollLeft,50);
 f.state.upcoming={...f.state.upcoming,task:b,ongoing:[b]};f.dock.update(f.state);assert.equal(rows.size,1);assert.equal(rows.get('b').button,second.button);assert.equal(second.divider.hidden,true);assert.equal(f.doc.activeElement,second.name);assert.equal(first.name._operonHoverCleanup,undefined);assert.equal((f.dock as any).tooltipKeys.has(first.name),false);
 let closes=0;second.name._operonHoverClose=()=>{closes++;};f.dock.closeTooltips();assert.equal(closes,1);
 f.state.settings.upcomingShowStatusBar=false;f.dock.update(f.state);assert.equal(rows.size,0);assert.equal(area.hidden,true);f.dock.destroy();
});
for(const behavior of ['source','editor','source-and-editor']as const)test(`each concurrent task opens its own current task with ${behavior}`,async()=>{
 const h=feedbackHarness();try{h.settings.statusDockClickAction=behavior;const opened:string[]=[];const a=task('a','2026-10-25T09:00:00'),b=task('b','2026-10-25T10:00:00');
 (h.dock as any).dependencies.openTask=async(id:string,_anchor:HTMLElement,action:string)=>{opened.push(`${id}:${action}`);};(h.dock as any).upcoming.getSnapshot=()=>({task:a,current:true,due:true,countdown:'00:00:00',ongoing:[a,b],next:null});h.emit();
 for(const id of ['a','b']){h.views[0].currentReadings.get(id).name.click();await new Promise(resolve=>setImmediate(resolve));}
 assert.deepEqual(opened,[`a:${behavior}`,`b:${behavior}`]);}finally{h.close();}
});

test('dock toggle affects every window and new windows without touching timer, settings or task data',()=>{
 const h=feedbackHarness();try{
 const settings=JSON.stringify(h.settings),active=h.state.active,roots=h.views.map(w=>w.root);assert.ok(h.views.every(w=>!w.slot.hidden));
 h.dock.toggleVisibility();assert.ok(h.views.every(w=>w.slot.hidden));h.state.active!.elapsedSeconds++;h.emit();assert.ok(h.views.every(w=>w.slot.hidden));
 const f=statusDockDocument(),context=(h.dock as any).createWindow({doc:f.doc,win:f.doc.defaultView});f.doc.body.appendChild(context.widget.slot);context.widget.update(snapshot());assert.equal(context.widget.slot.hidden,true);context.dispose();
 h.dock.toggleVisibility();assert.ok(h.views.every(w=>!w.slot.hidden));assert.deepEqual(h.views.map(w=>w.root),roots);assert.equal(h.state.active,active);assert.equal(h.state.stopCalls,0);assert.equal(h.state.startCalls,0);assert.equal(h.state.saved,0);assert.equal(h.state.opened,0);assert.equal(JSON.stringify(h.settings),settings);
 const fresh=feedbackHarness();try{assert.ok(fresh.views.every(w=>!w.slot.hidden));}finally{fresh.close();}
 }finally{h.close();}
});
test('hiding a widget closes dock tooltips and cancels dragging while keeping its DOM',()=>{
 const f=widget(),root=f.dock.root;let closed=0,dragStopped=0;f.find('operon-status-dock-tracker-reading').querySelector('.operon-status-dock-name')._operonHoverClose=()=>{closed++;};(f.dock as any).stopDrag=()=>{dragStopped++;(f.dock as any).stopDrag=null;};
 f.dock.setVisible(false);assert.equal(f.dock.slot.hidden,true);assert.equal(closed,1);assert.equal(dragStopped,1);f.dock.update(f.state);assert.equal(f.dock.slot.hidden,true);f.dock.setVisible(true);assert.equal(f.dock.slot.hidden,false);assert.equal(f.dock.root,root);f.dock.destroy();
});


test('calendar Play replaces each leading icon without changing source clicks', () => {
	const f = widget(), a = task('a', '2026-10-25T09:00:00'), b = task('b', '2026-10-25T10:00:00');
	f.state.upcoming = { task: a, ongoing: [a, b], current: true, due: true, countdown: '00:00:00', next: { task: task('future', '2026-10-25T12:00:00'), countdown: '01:00:00' } };
	f.dock.update(f.state);
	const controls = (f.dock as any).calendarControls;
	for (const [button, control] of controls as Map<any, any>) {
		assert.equal(control.play.parentElement, button.parentElement);
		assert.equal(button.querySelector('button'), null);
		if (control.shell.hidden) continue;
		control.play.click(); button.querySelector('.operon-status-dock-name').click();
	}
	assert.deepEqual(f.calls, ['start:future', 'next', 'start:a', 'current:a', 'start:b', 'current:b']);
	const aButton = (f.dock as any).currentReadings.get('a').button, first = controls.get(aButton);
	f.state.active = { ...f.state.active!, operonId: 'a', task: a }; f.dock.update(f.state);
	assert.equal(first.play.hidden, true); assert.equal(first.shell.classList.contains('has-task-play'), false); first.play.click(); assert.equal(f.calls.length, 6);
	f.state.active = null; f.state.actionPending = true; f.dock.update(f.state); assert.equal(first.play.disabled, true); assert.equal(first.shell.classList.contains('has-task-play'), false);
	first.play.click(); assert.equal(f.calls.length, 6);
	f.state.actionPending = false; f.state.upcoming.ongoing = [b]; f.dock.update(f.state);
	assert.equal(controls.has(aButton), false); assert.equal((f.dock as any).icons.has(first.play), false);
	assert.equal((f.dock as any).tooltipKeys.has(first.play), false); assert.equal(first.play._operonHoverCleanup, undefined);
	f.dock.destroy();
});

for (const target of ['current-a', 'current-b', 'future', 'single-future']) test(`calendar Play starts exact ${target} once across windows and never opens a source`, async () => {
	const h = feedbackHarness(); try {
		const a = task('current-a', '2026-10-25T09:00:00'), b = task('current-b', '2026-10-25T10:00:00'), future = task('future', '2026-10-25T12:00:00');
		const chosen = target === 'single-future' ? future : target === a.operonId ? a : target === b.operonId ? b : future;
		h.tasks.set(chosen.operonId, chosen);
		(h.dock as any).upcoming.getSnapshot = () => target === 'single-future' ? { task: future, due: false, countdown: '01:00:00' }
			: { task: a, ongoing: [a, b], current: true, due: true, countdown: '00:00:00', next: { task: future, countdown: '01:00:00' } };
		(h.dock as any).dependencies.startTimerForTask = (id: string, guard: () => boolean) => (h.controller as any).dependencies.startTimerForTask(id, 'status-bar', guard);
		let sourceCalls = 0; (h.dock as any).dependencies.openTask = async () => { sourceCalls++; }; h.emit();
		const play = (view: any) => [...view.calendarControls.values()].find((c: any) => !c.shell.hidden && c.taskId === chosen.operonId) as any;
		play(h.views[0]).play.click(); const action = (h.dock as any).action;
		await Promise.resolve(); play(h.views[1]).play.click(); assert.equal(h.state.startCalls, 1);
		h.resolve(true); await action;
		assert.equal(h.state.active?.operonId, chosen.operonId); assert.equal(h.state.stopCalls, 0); assert.equal(sourceCalls, 0);
		assert.ok(h.views.every(view => play(view).play.hidden));
	} finally { h.close(); }
});

for (const stale of ['removed', 'detached', 'closed', 'disabled', 'already-running', 'disposed']) test(`calendar Play rejects ${stale} before starting`, async () => {
	const h = feedbackHarness(); try {
		const selected = task('chosen', '2026-10-25T09:00:00'); let shown = true;
		(h.dock as any).upcoming.getSnapshot = () => ({ task: shown ? selected : null, due: false, countdown: null }); h.emit();
		const view = h.views[0], control = view.calendarControls.get(view.upcoming);
		let starts = 0; (h.dock as any).dependencies.startTimerForTask = async () => { starts++; return true; };
		const action = (h.dock as any).startCalendarTask(selected.operonId, control.play);
		if (stale === 'removed') shown = false;
		if (stale === 'detached') control.play.remove();
		if (stale === 'closed') control.play.ownerDocument.defaultView.closed = true;
		if (stale === 'disabled') h.settings.upcomingShowStatusBar = false;
		if (stale === 'already-running') h.state.active = { ...h.state.active!, operonId: selected.operonId };
		if (stale === 'disposed') h.dock.onunload();
		await action; assert.equal(starts, 0);
	} finally { h.close(); }
});

for (const failure of ['false', 'throw']) test(`calendar start ${failure} preserves running presentation and releases the action lock`, async () => {
	const h = feedbackHarness(); try {
		(h.dock as any).upcoming.getSnapshot = () => snapshot().upcoming; h.emit();
		const control = h.views[0].calendarControls.get(h.views[0].upcoming), before = h.state.active;
		(h.dock as any).dependencies.startTimerForTask = async () => { if (failure === 'throw') throw new Error('start failed'); return false; };
		const action = (h.dock as any).startCalendarTask('next', control.play);
		if (failure === 'throw') await assert.rejects(action, /start failed/); else await action;
		assert.equal(h.state.active, before); assert.equal((h.dock as any).action, null); assert.equal(control.play.disabled, false);
	} finally { h.close(); }
});

for (const success of [false, true]) test(`calendar Play uses shared break selection and preserves it on failed save: success=${success}`, async () => {
	const h = feedbackHarness(); try {
		const selected = task('chosen', '2026-10-25T09:00:00'); h.tasks.set(selected.operonId, selected);
		const breaking = h.controller.startBreak(); await Promise.resolve(); h.resolve(true); assert.equal(await breaking, true);
		const before = h.controller.getSnapshot(); h.reset();
		(h.dock as any).upcoming.getSnapshot = () => ({ task: selected, due: false, countdown: '01:00:00' }); h.emit();
		const control = h.views[0].calendarControls.get(h.views[0].upcoming);
		const action = (h.dock as any).startCalendarTask(selected.operonId, control.play);
		for (let i = 0; i < 10 && !h.state.transition; i++) await Promise.resolve();
		assert.equal(h.state.transition?.taskId, selected.operonId); (h.controller as any).tick();
		assert.deepEqual(h.controller.getSnapshot().breakState, before.breakState);
		h.resolve(success); await action;
		if (success) { assert.equal(h.state.active?.operonId, selected.operonId); assert.equal(h.controller.getSnapshot().breakState, null); }
		else { assert.equal(h.state.active, null); assert.deepEqual(h.controller.getSnapshot(), before); }
	} finally { h.close(); }
});

test('hover Play retains task color and clears it to the accent fallback', () => {
	const f = widget(), button = f.find('operon-status-dock-upcoming'), control = (f.dock as any).calendarControls.get(button);
	f.state.upcoming.task!.fieldValues.taskColor = '#123456'; f.dock.update(f.state);
	assert.equal(control.play.style.color, '#123456'); assert.equal(control.shell.classList.contains('has-task-play'), true);
	assert.equal(button.querySelector('.operon-status-dock-leading-icon').style.color, '#123456');
	f.state.upcoming.task!.fieldValues.taskColor = 'invalid'; f.dock.update(f.state);
	assert.equal(control.play.style.color, ''); assert.equal(button.querySelector('.operon-status-dock-leading-icon').style.color, '');
	f.dock.destroy();
});


test('dock Task Creator tooltip explains creation plus tracking without changing its action', () => {
	const f = widget(); f.state.active = null; f.dock.update(f.state);
	const creator = f.find('operon-status-dock-creator');
	assert.equal((f.dock as any).tooltipKeys.get(creator), JSON.stringify(['Task Creator', 'Create a new task and start tracking']));
	creator.click(); assert.deepEqual(f.calls, ['create']); f.dock.destroy();
});


test('durations and reading wrappers are passive; only bordered names open tasks and own tooltips', () => {
	const f = widget();
	for (const cls of ['operon-status-dock-tracker-reading', 'operon-status-dock-upcoming']) {
		const reading = f.find(cls), time = reading.querySelector('.operon-status-dock-time'), name = reading.querySelector('.operon-status-dock-name');
		reading.click(); time.click(); assert.equal(f.calls.length, 0);
		for (const plain of [reading, time]) {
			assert.equal(plain.getAttribute('role'), null); assert.equal(plain.getAttribute('aria-labelledby'), null);
			assert.equal((f.dock as any).tooltipKeys.has(plain), false);
			assert.equal(plain.handlers?.get('keydown')?.size ?? 0, 0);
		}
		assert.equal(name.getAttribute('role'), 'button'); assert.equal(name.tabIndex, 0);
		assert.equal((f.dock as any).tooltipKeys.has(name), true);
		name.click(); assert.equal(f.calls.length, 1); f.calls.length = 0;
	}
	f.dock.destroy();
});

test('every ongoing task puts localized Now before the full tooltip description and never in the visible dock', () => {
	const f = widget(), a = task('a', '2026-10-25T09:00:00'), b = task('b', '2026-10-25T10:00:00');
	f.state.upcoming = { task: a, ongoing: [a, b], current: true, due: true, countdown: '00:00:00' }; f.dock.update(f.state);
	for (const item of (f.dock as any).currentReadings.values()) {
		assert.equal(item.time.hidden, true); assert.equal(item.time.textContent, '');
		const [title, content] = JSON.parse((f.dock as any).tooltipKeys.get(item.name));
		assert.ok(title); assert.equal(content, `Now: ${a.description}`);
	}
	f.state.upcoming = { task: b, current: true, due: true, countdown: '00:00:00' }; f.dock.update(f.state);
	const reading = f.find('operon-status-dock-upcoming'), name = reading.querySelector('.operon-status-dock-name');
	assert.equal(reading.querySelector('.operon-status-dock-time').hidden, true);
	assert.equal(JSON.parse((f.dock as any).tooltipKeys.get(name))[1], `Now: ${b.description}`); f.dock.destroy();
});

test('calendar keyboard-focus scopes distinguish mouse focus and clean up when rows and dock close', () => {
	const f = widget(), a = task('a', '2026-10-25T09:00:00');
	f.state.upcoming = { task: a, ongoing: [a], current: true, due: true, countdown: '00:00:00' }; f.dock.update(f.state);
	const item = (f.dock as any).currentReadings.get('a'), scope = (f.dock as any).calendarControls.get(item.button).shell;
	let visible = true; const matches = item.name.matches.bind(item.name);
	item.name.matches = (selector: string) => selector === ':focus-visible' ? visible : matches(selector);
	item.name.focus(); f.emit('keydown', {}); f.flush();
	assert.equal(scope.classList.contains('has-descendant-focus-visible'), true);
	visible = false; f.emit('pointerdown', {}); f.flush();
	assert.equal(scope.classList.contains('has-descendant-focus-visible'), false);
	f.state.upcoming = { task: null, ongoing: [], due: false, countdown: null }; f.dock.update(f.state);
	assert.equal(scope.classList.contains('operon-focus-visible-scope'), false);
	f.dock.destroy(); assert.equal(f.listeners.get('keydown')?.size ?? 0, 0); assert.equal(f.timers.size, 0);
});
