import { normalizeStatusDockSections } from '../src/types/status-dock-sections';
import { StatusDockTaskList } from '../src/ui/status-dock-task-list';
import { buildStatusDockTaskScopes } from '../src/ui/status-dock-task-scope';
import { localToday } from '../src/core/local-time';
import { CONTEXTUAL_MENU_SURFACE_GROUPS, isContextualMenuActionSupportedOnSurface } from '../src/core/contextual-menu-engine';
import { showTaskContextualHoverMenu, hideTaskContextualHoverMenu, isTaskContextualHoverMenuActive } from '../src/ui/contextual-hover-menu';
import { TimeTracker } from '../src/systems/time-tracker';
import { StatusDockSessionCard, StatusDockSessionLifetime } from '../src/ui/status-dock-session-card';
import type { TrackerSession } from '../src/types/tracker';
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
import { WorkspaceLeaf } from 'obsidian';
import { FlowTimeView } from '../src/ui/flow-time-view';
import { FlowTimeControls } from '../src/systems/flow-time-controls';
import { FlowTimeBreakController } from '../src/systems/flow-time-break';
import { StatusDockWidget, type StatusDockSnapshot } from '../src/ui/status-dock-widget';
import { OperonStatusDock, isStatusDockLeaf } from '../src/ui/status-dock';
import { NativeLightboxLifecycle } from '../src/ui/native-lightbox-lifecycle';
import { statusDockDocument } from './test-support/status-dock-dom';
import { SettingsPreservationHarness } from './test-support/settings-preservation-harness';
import type { IndexedTask } from '../src/types/fields';
import type { App, WorkspaceContainer } from 'obsidian';

const flowTimeControls = { mode: 'tracktime' as const, minutes: 25, setMode: async () => {}, subscribe: () => () => {}, begin: () => null, editable: false };

function task(id: string, date: string): IndexedTask {
	return { operonId: id, description: 'Upcoming **task** with a long description', checkbox: 'open',
		fieldValues: { datetimeStart: date }, primary: { filePath: 'Synthetic.md', format: 'inline', lineNumber: 0 } } as unknown as IndexedTask;
}
function snapshot(): StatusDockSnapshot {
	const activeTask = task('active', '2026-10-24T10:00:00');
	return { timerSettings: { ...DEFAULT_SETTINGS }, settings: { ...DEFAULT_SETTINGS, trackerShowStatusBarTimer: true, upcomingShowStatusBar: true, upcomingCountdownDisplay: 'seconds' },
		active: { operonId: activeTask.operonId, start: 'start', elapsedSeconds: 2489, task: activeTask, isUnassigned: false },
		breakSnapshot: { breakState: null, pendingTaskId: null, actionPending: false }, breakSeconds: 0, pendingDescription: null,
		upcoming: { task: task('next', '2026-10-24T12:34:57'), countdown: '02:34:57', due: false },
		alert: { state: 'conflict', count: 2 }, actionPending: false };
}
function widget() {
	const f = statusDockDocument(); const calls: string[] = [];
	const dock = new StatusDockWidget(f.doc, { openTracker: () => { calls.push('source-or-finder'); }, toggleTimer: () => { calls.push('timer'); }, toggleTimerMode: () => { calls.push('mode'); },
		startTask: (id: string) => { calls.push(`start:${id}`); }, findTask: () => { calls.push('finder'); }, toggleBreak: () => { calls.push('coffee'); }, createTask: () => { calls.push('create'); }, openCurrentTask: (id: string) => { calls.push(`current:${id}`); }, openNextUpcoming: () => { calls.push('next'); }, openUpcoming: () => { calls.push('upcoming'); }, openConflicts: () => { calls.push('conflicts'); } }, error => { throw error; }, flowTimeControls);
	f.doc.body.appendChild(dock.slot); const state = snapshot(); dock.setWidth(900); dock.update(state);
	return { ...f, dock, state, calls, find: (cls: string): any => dock.root.querySelector(`.${cls}`) };
}

function timeText(element: HTMLElement): string | null {
	const modeText = element.querySelector('.operon-status-dock-mode-text');
	return modeText ? Array.from(modeText.children, child => child.textContent).join('') : element.textContent;
}

test('status dock displays titles when enabled and filename labels when disabled', () => {
	const task: IndexedTask = {
		operonId: 'n000123', description: 'old-file', checkbox: 'open', tags: [],
		fieldValues: { fileTaskDisplayTitle: 'Readable task title with details' },
		primary: { filePath: 'old-file.md', lineNumber: 0, format: 'yaml' }, datetimeModified: '', tier: 'hot',
	};
	const { doc } = statusDockDocument();
	const dock = new StatusDockWidget(doc, {
		findTask() {}, openTracker() {}, toggleTimer() {}, toggleTimerMode() {}, toggleBreak() {}, startTask() {},
		openCurrentTask() {}, openNextUpcoming() {}, openUpcoming() {}, openConflicts() {}, createTask() {},
	}, error => { throw error; }, flowTimeControls);
	doc.body.appendChild(dock.slot);
	const current = { ...task, operonId: 'current', fieldValues: { fileTaskDisplayTitle: 'Current task with a longer title' } };
	const next = { ...task, operonId: 'next', fieldValues: { fileTaskDisplayTitle: 'Next task with a longer title' } };
	const state: StatusDockSnapshot = {
		timerSettings: DEFAULT_SETTINGS,
		settings: { ...DEFAULT_SETTINGS, trackerShowStatusBarTimer: true, upcomingShowStatusBar: true },
		active: { operonId: task.operonId, start: '2026-10-26T10:00:00', elapsedSeconds: 60, task, isUnassigned: false },
		breakSnapshot: { breakState: null, pendingTaskId: null, actionPending: false }, breakSeconds: 0, pendingDescription: null,
		upcoming: { task: current, current: true, due: true, countdown: '00:00:00', ongoing: [current],
			next: { task: next, countdown: '01:00:00' } },
		alert: { state: 'hidden', count: 0 }, actionPending: false,
	};
	try {
		dock.setWidth(900);
		for (const enabled of [true, false, true]) {
			state.settings.fileTaskDisplayTitleEnabled = enabled;
			dock.update(state);
			const labels = dock.root.querySelectorAll('.operon-status-dock-name');
			const text = Array.from(labels, label => label.textContent).join('|');
			for (const title of ['Readable task title with details', 'Current task with a longer title', 'Next task with a longer title']) assert.equal(text.includes(title), enabled);
			assert.equal(text.includes('old-file'), !enabled);
			for (const selector of ['.operon-status-dock-current', '.operon-status-dock-next']) {
				const label = dock.root.querySelector(selector)?.querySelector<HTMLElement>('.operon-status-dock-name');
				assert.ok(label);
				const accessible = doc.getElementById(label.getAttribute('aria-labelledby') ?? '');
				assert.ok(accessible);
				assert.equal(accessible.textContent?.includes('old-file'), !enabled);
				const hints = Reflect.get(dock, 'tooltipKeys') as Map<HTMLElement, string>;
				assert.equal(hints.has(label), false);
			}
		}
	} finally {
		dock.destroy();
	}
});

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
	for (const preferences of [{}, { statusDockCreatorStartsTimer: false, statusDockVisible: false, statusDockMode: 'detailed', statusDockAlignment: 'left', statusDockClickAction: 'editor' }]) {
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
		for (const key of ['statusDockCreatorStartsTimer', 'statusDockVisible', 'statusDockMode', 'statusDockAlignment', 'statusDockClickAction'] as const) {
			assert.equal(restored.restorePlan.candidateSettings[key], settings[key]);
			assert.equal(Object.prototype.hasOwnProperty.call(restored.restorePlan.candidateSettings, key),
				Object.prototype.hasOwnProperty.call(settings, key));
		}
	}
});

test('visibility persists across initialization and serializes command toggles without unrelated writes', async () => {
	const fixture = new SettingsPreservationHarness();
	try {
		const storage = fixture.createStorage(); await storage.initialize();
		const before = JSON.parse(await fixture.adapter.read(fixture.canonicalPath));
		const writes = fixture.canonicalAttempts;
		assert.equal(storage.getSettings().statusDockVisible, undefined);
		await storage.saveStatusDockVisibility(true);
		assert.equal(fixture.canonicalAttempts, writes);
		await storage.saveStatusDockVisibility(false);
		const saved = JSON.parse(await fixture.adapter.read(fixture.canonicalPath));
		assert.deepEqual(saved, { ...before, ui: { ...before.ui, statusDock: { ...before.ui.statusDock, visible: false } } });
		const restarted = fixture.createStorage(); await restarted.initialize();
		assert.equal(restarted.getSettings().statusDockVisible, false);
		const writesAfterRestart = fixture.canonicalAttempts;
		fixture.writeFault = 'throw-before';
		await assert.rejects(restarted.saveStatusDockVisibility());
		assert.equal(restarted.getSettings().statusDockVisible, false);
		assert.deepEqual(JSON.parse(await fixture.adapter.read(fixture.canonicalPath)), saved);
		fixture.writeFault = 'none';
		await Promise.all([restarted.saveStatusDockVisibility(), restarted.saveStatusDockVisibility()]);
		assert.equal(restarted.getSettings().statusDockVisible, false);
		assert.equal(fixture.canonicalAttempts, writesAfterRestart + 3);
		delete saved.ui.statusDock.visible;
		fixture.seed(fixture.canonicalPath, JSON.stringify(saved));
		const externalWrites = fixture.canonicalAttempts;
		await assert.rejects(restarted.saveStatusDockVisibility());
		assert.equal(fixture.canonicalAttempts, externalWrites);
		assert.deepEqual(JSON.parse(await fixture.adapter.read(fixture.canonicalPath)), saved);
		await restarted.reloadCanonicalSettingsPackage();
		assert.equal(restarted.getSettings().statusDockVisible, undefined);
	} finally { await fixture.dispose(); }
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

test('Show seconds defaults off without writes and persists independently through reload and backups', async () => {
	const fixture = new SettingsPreservationHarness();
	try {
		const storage = fixture.createStorage(); await storage.initialize();
		const before = JSON.parse(await fixture.adapter.read(fixture.canonicalPath));
		const writes = fixture.canonicalAttempts;
		const settings = storage.getSettings();
		assert.equal(settings.statusDockShowSeconds, undefined);
		assert.equal(buildOperonSettingsBackupSelectedPatchV1({ selectedGroups: ['general'], candidateSettings: settings }).statusDockShowSeconds, undefined);
		await storage.saveStatusDockTimerPreference('statusDockShowSeconds', false);
		assert.equal(fixture.canonicalAttempts, writes);
		await storage.saveStatusDockTimerPreference('statusDockShowSeconds', true);
		const saved = JSON.parse(await fixture.adapter.read(fixture.canonicalPath));
		assert.deepEqual(saved, { ...before, ui: { ...before.ui, statusDock: { ...before.ui.statusDock, showSeconds: true } } });
		const reopened = fixture.createStorage(); await reopened.initialize();
		assert.equal(fixture.canonicalAttempts, writes + 1);
		assert.equal(reopened.getSettings().statusDockShowSeconds, true);
		const patch = buildOperonSettingsBackupSelectedPatchV1({ selectedGroups: ['general'], candidateSettings: reopened.getSettings() });
		assert.equal(patch.statusDockShowSeconds, true);
		await reopened.saveStatusDockTimerPreference('statusDockShowSeconds', false);
		assert.equal(reopened.getSettings().statusDockShowSeconds, false);
		assert.equal(JSON.parse(await fixture.adapter.read(fixture.canonicalPath)).ui.statusDock.showSeconds, false);
		delete saved.ui.statusDock.showSeconds;
		fixture.seed(fixture.canonicalPath, JSON.stringify(saved));
		await reopened.reloadCanonicalSettingsPackage();
		assert.equal(reopened.getSettings().statusDockShowSeconds, undefined);
	} finally { await fixture.dispose(); }
});

test('dial choices preserve old packages, round-trip independently, and reject invalid sizes', async () => {
	const fixture = new SettingsPreservationHarness();
	try {
		const storage = fixture.createStorage(); await storage.initialize();
		const before = JSON.parse(await fixture.adapter.read(fixture.canonicalPath));
		const writes = fixture.canonicalAttempts;
		assert.equal(storage.getSettings().statusDockShowTimerDial, undefined);
		assert.equal(storage.getSettings().statusDockTimerDialSize, undefined);
		assert.equal(migrateSettings({ statusDockTimerDialSize: 1.2 }).statusDockTimerDialSize, 1.2);
		for (const retiredSize of [1.25, 1.75, 2]) {
			assert.equal(migrateSettings({ statusDockTimerDialSize: retiredSize }).statusDockTimerDialSize, undefined);
		}
		await storage.saveStatusDockTimerPreference('statusDockShowTimerDial', false);
		await storage.saveStatusDockTimerDialSize(1);
		await assert.rejects(storage.saveStatusDockTimerDialSize(3), /invalid/iu);
		assert.equal(fixture.canonicalAttempts, writes);
		await storage.saveStatusDockTimerPreference('statusDockShowTimerDial', true);
		await storage.saveStatusDockTimerDialSize(0.7);
		const saved = JSON.parse(await fixture.adapter.read(fixture.canonicalPath));
		assert.deepEqual(saved, { ...before, ui: { ...before.ui, statusDock: { ...before.ui.statusDock, showTimerDial: true, timerDialSize: 0.7 } } });
		const reopened = fixture.createStorage(); await reopened.initialize();
		assert.equal(fixture.canonicalAttempts, writes + 2);
		const patch = buildOperonSettingsBackupSelectedPatchV1({ selectedGroups: ['general'], candidateSettings: reopened.getSettings() });
		assert.equal(patch.statusDockShowTimerDial, true);
		assert.equal(patch.statusDockTimerDialSize, 0.7);
		fixture.writeFault = 'throw-before';
		await assert.rejects(reopened.saveStatusDockTimerDialSize(1.4));
		assert.equal(reopened.getSettings().statusDockTimerDialSize, 0.7);
		assert.deepEqual(JSON.parse(await fixture.adapter.read(fixture.canonicalPath)), saved);
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
	const f = widget();
	f.state.active!.elapsedSeconds = 5342;
	f.state.settings.statusDockShowSeconds = true;
	f.dock.update(f.state);
	const mode = f.find('operon-status-dock-mode');
	const accessibleId = mode.getAttribute('aria-labelledby');
	assert.equal(mode.children.length, 1);
	assert.equal(mode.children[0].className, 'operon-status-dock-mode-text');
	const children = Array.from(f.dock.root.querySelectorAll('*'));
	const [prefix, seconds] = mode.children[0].children;
	assert.equal(prefix.textContent, '1h 29m ');
	assert.equal(seconds.textContent, '02s');
	const width = mode.dataset.durationWidth;
	f.state.active!.elapsedSeconds += 3;
	f.state.upcoming.countdown = '02:34:56';
	f.dock.update(f.state);
	assert.deepEqual(Array.from(f.dock.root.querySelectorAll('*')), children);
	assert.equal(mode.getAttribute('aria-labelledby'), accessibleId);
	assert.equal(mode.dataset.durationWidth, width);
	assert.equal(prefix.textContent, '1h 29m ');
	assert.equal(seconds.textContent, '05s');
	assert.equal(timeText(mode), '1h 29m 05s'); f.dock.destroy();
});

test('dock layout stays compact independently of the timer mode button', () => {
	const f = widget(); f.state.settings.statusDockMode = 'detailed'; f.state.settings.statusDockAlignment = 'right'; f.dock.update(f.state);
	assert.equal(f.dock.root.classList.contains('is-detailed'), false); assert.equal(f.find('operon-status-dock-mode').tagName, 'BUTTON');
	assert.equal(f.dock.slot.dataset.alignment, undefined); f.dock.setWidth(280);
	assert.equal(f.dock.root.classList.contains('is-detailed'), false); f.dock.destroy();
});

test('optional modules have separators only between visible sections and alert', () => {
 const f = widget(), dividers = (f.dock as any).sectionDividers;
 assert.equal(dividers.get('tracker').hidden, true);
 assert.equal(dividers.get('ongoing').hidden, true);
 assert.equal(dividers.get('upcoming').hidden, false);
 assert.equal((f.dock as any).alertDivider.hidden, false);
 f.state.upcoming.task = null; f.dock.update(f.state);
 assert.equal(dividers.get('upcoming').hidden, true);
 f.state.alert.state = 'hidden'; f.dock.update(f.state);
 assert.equal((f.dock as any).alertDivider.hidden, true);
 assert.equal(f.dock.root.classList.contains('is-empty'), false);
 f.dock.destroy();
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
	const dock = new OperonStatusDock(app, { flowTimeControls, toggleTaskTimer: async () => true, indexer: { getTask: () => null, getAllTasks: () => [], getGeneration: () => 1 } as never,
		timeTracker: { getActiveState: () => null, getTransitionState: () => null, subscribe: () => () => {}, startUnassigned: async () => { starts++; return true; } } as never,
		breakController: { getSnapshot: () => ({ pendingTaskId: null, breakState: null, actionPending: false }), getElapsedSeconds: () => 0, subscribe: () => () => {} } as never,
		getSettings: () => settings, startTimerForTask: async () => false, openTask: async () => {}, createTrackerTask: async () => null, pickTrackerTask: async () => null, openConflicts: () => {} });
	(dock as unknown as { registerEvent(ref: { dispose: () => void }): void }).registerEvent = ref => dock.register(ref.dispose);
	dock.onload();
	assert.equal(main.doc.body.querySelectorAll('.operon-status-dock').length, 1);
	assert.equal(popout.doc.body.querySelectorAll('.operon-status-dock').length, 1);
	const original = main.doc.body.querySelector('.operon-status-dock');
	const slot = main.doc.body.querySelector('.operon-status-dock-slot') as HTMLElement;
	assert.equal(slot.style.width, '1000px'); assert.equal(slot.style.left, '10px'); assert.equal(slot.style.bottom, '42px');
	const popoutSlot = popout.doc.body.querySelector('.operon-status-dock-slot') as HTMLElement;
	Object.assign(settings, { statusDockVisible: false }); dock.refresh();
	assert.ok(slot.hidden && popoutSlot.hidden);
	Object.assign(settings, { statusDockVisible: true }); dock.refresh();
	assert.ok(!slot.hidden && !popoutSlot.hidden);
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
	assert.match(css, /\.operon-status-dock \{[^}]*min-height: 44px; padding: 7px 9px/u);
	assert.match(css, /font-size: var\(--font-ui-small\); font-weight: 500; line-height: 1\.35/u);
	assert.equal(css.includes('.operon-status-dock.is-detailed'), false);
	assert.match(css, /\.operon-status-dock-action svg \{ width: 16px; height: 16px/u);
	assert.match(css, /max-width: calc\(35ch \+ 12px\);[^}]*text-overflow: ellipsis/u);
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
	const dock = new OperonStatusDock({ workspace: { containerEl: f.doc.body } } as unknown as App, { flowTimeControls, toggleTaskTimer: async () => true,
		indexer: { getTask: () => undefined, getAllTasks: () => [], getGeneration: () => 1 }, getSettings: () => settings,
		timeTracker: { getActiveState: () => active, getTransitionState: () => transition } as never,
		breakController: { getSnapshot: () => ({ pendingTaskId: pending, breakState: null, actionPending: false }), getElapsedSeconds: () => 0, selectPendingTask: async (pick: () => Promise<string | null>) => { const before = active, id = await pick(); if (!id || active !== before) return false; starts++; return true; } } as never,
		startTimerForTask: async () => false, openTask: async (id, anchor, behavior) => { opened.push([id, anchor, behavior]); },
		createTrackerTask: async () => null, pickTrackerTask: async () => { picks++; return selected; },
		openConflicts: () => {},
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
	const f = widget(); const times = () => Array.from(f.dock.root.querySelectorAll<HTMLElement>('.operon-status-dock-time')).slice(0, 2).map(timeText);
	for (const width of [900, 280, 900]) {
		f.state.settings.statusDockMode = 'detailed'; f.dock.setWidth(width); f.dock.update(f.state);
		assert.deepEqual(times(), ['41m', '2h 34m']);
	}
	f.dock.destroy();
});

test('Compact displays seconds below one minute for both clocks and minutes from 60 seconds', () => {
	const f = widget(); const times = () => Array.from(f.dock.root.querySelectorAll<HTMLElement>('.operon-status-dock-time')).slice(0, 2).map(timeText);
	for (const seconds of [0, 2, 5, 29, 59, 60, 61, 119]) {
		f.state.active!.elapsedSeconds = seconds;
		f.state.upcoming.countdown = `00:${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
		f.dock.update(f.state);
		const padded = String(seconds).padStart(2, '0');
		const minutes = `${Math.floor(seconds / 60)}m`;
		assert.deepEqual(times(), seconds < 60 ? [`${padded}s`, `${padded}s`] : [minutes, minutes]);
	}
	f.state.active = null; f.state.breakSeconds = 43; f.state.breakSnapshot = { ...f.state.breakSnapshot, breakState: { start: new Date().toISOString() } as never };
	f.dock.update(f.state); assert.equal(times()[0], '43s'); f.dock.destroy();
});

test('timer action replaces the decorative stopwatch and remains separate from source and coffee actions', () => {
	const f = widget(); const tracker = f.find('operon-status-dock-tracker'); const timer = f.find('operon-status-dock-timer-action');
	assert.equal(tracker.children[0], timer); assert.equal(f.find('operon-status-dock-tracker-reading').querySelector('.operon-status-dock-leading-icon'), null);
	assert.equal(f.find('operon-status-dock-timer-controls').children.length, 2);
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
	const dock = new OperonStatusDock({ workspace: { containerEl: f.doc.body } } as unknown as App, { flowTimeControls, toggleTaskTimer: async () => true,
		indexer: { getTask: () => undefined, getAllTasks: () => [], getGeneration: () => 1 }, getSettings: () => settings,
		timeTracker: { getActiveState: () => snapshot().active, getTransitionState: () => null } as never,
		breakController: { getSnapshot: () => snapshot().breakSnapshot, getElapsedSeconds: () => 0 } as never,
		startTimerForTask: async () => false, openTask: async (...args) => { opened.push(args); await gate; }, createTrackerTask: async () => null, pickTrackerTask: async () => null,
		openConflicts: () => {},
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


function feedbackHarness(statusDockVisible?: boolean) {
	const document = statusDockDocument(), settings = { ...DEFAULT_SETTINGS, statusDockVisible };
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
	const timerControls = new FlowTimeControls({
		getSettings: () => settings, timeTracker: tracker as never, breakController: controller,
		saveSettings: async (_expected, values) => { Object.assign(settings, values); },
	});
	const dock = new OperonStatusDock({ workspace: { containerEl: document.doc.body } } as unknown as App, { flowTimeControls: timerControls, toggleTaskTimer: async () => true,
		indexer: { getTask: id => tasks.get(id), getAllTasks: () => [], getGeneration: () => 1 }, timeTracker: tracker as never,
		breakController: controller, getSettings: () => settings,
		startTimerForTask: async () => false, openTask: async () => {}, createTrackerTask: async () => null, pickTrackerTask: async () => null, openConflicts: () => {},
	});
	// Trap any accidental legacy panel-opening call while exercising real timer actions.
	(dock as any).dependencies.openFlowTime = async () => { state.opened++; };
	const views: any[] = [], updates: StatusDockSnapshot[] = [];
	const owners = [document, statusDockDocument()];
	for (const owner of owners) {
		const container = { doc: owner.doc, win: owner.doc.defaultView };
		const context = (dock as any).createWindow(container); owner.doc.body.appendChild(context.widget.slot);
		const update = context.widget.update.bind(context.widget); context.widget.update = (value: StatusDockSnapshot) => { updates.push(value); update(value); };
		(dock as any).windows.set(container, context); views.push(context.widget);
	}
	const refresh = () => (dock as any).renderWidgets();
	const unsubscribeTracker = tracker.subscribe(refresh), unsubscribeBreak = controller.subscribe(refresh);
	const unsubscribeControls = timerControls.subscribe(refresh); refresh();
	const read = () => views.map(widget => { const action = widget.root.querySelector('.operon-status-dock-timer-action'), coffee = widget.root.querySelector('.operon-status-dock-timer-controls').children[0];
		return { glyph: widget.icons.get(action), time: timeText(widget.root.querySelector('.operon-status-dock-time')), coffee: coffee.getAttribute('aria-pressed'), disabled: action.disabled }; });
	return { dock, controller, tracker, timerControls, state, settings, tasks, updates, views, owners, read, reset, resolve: (success: boolean) => finish(success), emit,
		clickCoffee: () => { views[0].root.querySelector('.operon-status-dock-timer-controls').children[0].click(); return (dock as any).action as Promise<void>; },
		close: () => { dock.onunload(); unsubscribeControls(); timerControls.destroy(); controller.destroy(); unsubscribeTracker(); unsubscribeBreak(); } };
}

test('dial uses the tracker center, keeps the dock top clear, and fits each viewport', () => {
	const f = widget();
	try {
		f.state.active = null;
		const tracker = f.find('operon-status-dock-tracker');
		f.dock.root.getBoundingClientRect = () => ({ left: 100, top: 500, width: 400, height: 95 } as DOMRect);
		tracker.getBoundingClientRect = () => ({ left: 230, top: 550, width: 200, height: 28 } as DOMRect);
		f.dock.setViewport(900, 700, 0, 0);
		assert.equal(f.dock.slot.querySelector('.operon-status-dock-dial'), null);
		f.state.settings.statusDockShowTimerDial = true;
		f.dock.update(f.state); f.flush();
		const host = f.dock.slot.querySelector<HTMLElement>('.operon-status-dock-dial')!;
		const bounds = () => ['left', 'top', 'width'].map(key => host.style.getPropertyValue(key));
		assert.deepEqual(bounds(), ['258px', '348px', '144px']);
		for (const [scale, size] of [[0.5, 72], [0.6, 86], [0.7, 100], [0.8, 115], [0.9, 129], [1.1, 158], [1.2, 172], [1.3, 187], [1.4, 201], [1.5, 216]] as const) {
			f.state.settings.statusDockTimerDialSize = scale;
			f.dock.update(f.state); f.flush();
			assert.deepEqual(bounds(), [`${330 - size / 2}px`, `${492 - size}px`, `${size}px`]);
		}
		// Simulate the dock having moved and wrapped in a narrow pop-out viewport.
		f.dock.root.getBoundingClientRect = () => ({ left: 30, top: 125, width: 140, height: 110 } as DOMRect);
		tracker.getBoundingClientRect = () => ({ left: 30, top: 190, width: 30, height: 28 } as DOMRect);
		f.dock.setViewport(160, 240, 20, 30); f.flush();
		assert.deepEqual(bounds(), ['28px', '30px', '87px']);
		f.state.settings.statusDockSections = normalizeStatusDockSections(undefined).map(section =>
			section.id === 'tracker' ? { ...section, enabled: false } : section);
		f.dock.update(f.state); f.flush(); assert.equal(host.hidden, true);
		f.state.settings.statusDockSections = undefined;
		f.dock.update(f.state); f.flush(); assert.equal(host.hidden, false);
		f.dock.setVisible(false); assert.equal(host.hidden, true);
		f.dock.setVisible(true); f.flush(); assert.equal(host.hidden, false);
		f.state.settings.statusDockShowTimerDial = false;
		f.dock.update(f.state); f.flush(); assert.equal(host.hidden, true);
	} finally { f.dock.destroy(); }
});

test('dial centers on the timer button border during work and breaks, and on the tracker when idle', () => {
	const f = widget();
	try {
		f.dock.root.getBoundingClientRect = () => ({ top: 500 } as DOMRect);
		f.find('operon-status-dock-tracker').getBoundingClientRect = () => ({ left: 230, width: 200 } as DOMRect);
		f.find('operon-status-dock-mode').getBoundingClientRect = () => ({ left: 245, width: 64 } as DOMRect);
		f.dock.setViewport(900, 700, 0, 0);
		f.state.settings.statusDockShowTimerDial = true;
		f.state.settings.statusDockShowSeconds = true;
		f.state.active!.elapsedSeconds = 599;
		f.dock.update(f.state); f.flush();
		const dial = f.dock.slot.querySelector<HTMLElement>('.operon-status-dock-dial')!;
		const left = () => dial.style.getPropertyValue('left');
		assert.equal(left(), '205px');
		f.state.active!.elapsedSeconds = 600;
		f.dock.update(f.state); f.flush();
		assert.equal(left(), '205px');
		f.state.active = null;
		f.state.breakSnapshot = { ...f.state.breakSnapshot, breakState: { taskId: 'active', startMs: 0, targetSeconds: 60 } };
		f.dock.update(f.state); f.flush();
		assert.equal(left(), '205px');
		f.state.breakSnapshot = { ...f.state.breakSnapshot, breakState: null };
		f.dock.update(f.state); f.flush();
		assert.equal(left(), '258px');
	} finally { f.dock.destroy(); }
});

function sendDialPointer(surface: ReturnType<typeof statusDockDocument>, dial: any, type: string, degrees: number): void {
	const angle = (degrees - 90) * Math.PI / 180;
	const event = {
		pointerId: 1, pointerType: 'mouse', button: 0,
		clientX: 100 + 80 * Math.cos(angle), clientY: 100 + 80 * Math.sin(angle),
		preventDefault() {},
	};
	if (type === 'pointerdown') for (const callback of dial.handlers.get(type)) callback(event);
	else surface.emitWindow(type, event);
}

test('actual sidebar and two dock dials preview and commit 30 to 45 minutes from either surface', async () => {
	const h = feedbackHarness();
	const panel = statusDockDocument();
	const sidebar = new FlowTimeView(new WorkspaceLeaf(), { getGeneration: () => 1, getTask: (id: string) => h.tasks.get(id) } as never,
		h.tracker as never, { getSettings: () => h.settings } as never, h.controller, h.timerControls);
	sidebar.contentEl = panel.doc.body;
	(sidebar as any).renderTaskBox = () => {};
	const rect = { left: 0, top: 0, width: 200, height: 200 };
	try {
		h.state.active!.elapsedSeconds = 0;
		h.settings.flowTimeMode = 'flowtime';
		h.settings.flowTimeSessionMinutes = 30;
		h.settings.statusDockShowTimerDial = true;
		const firstTimer = h.views[0].root.querySelector('.operon-status-dock-mode');
		for (const view of h.views) {
			view.root.getBoundingClientRect = () => ({ left: 50, top: 500, width: 500, height: 40 });
			view.root.querySelector('.operon-status-dock-mode').getBoundingClientRect = () => ({ left: 150, width: 64 });
			view.setViewport(900, 700, 0, 0);
		}
		h.emit();
		h.owners.forEach(owner => owner.flush());
		await sidebar.onOpen();
		const dockDials = h.views.map(view => view.slot.querySelector('.operon-flow-time-dial'));
		const panelDial = panel.doc.body.querySelector('.operon-flow-time-dial');
		const dials = [panelDial, ...dockDials];
		for (const dial of dials) dial.getBoundingClientRect = () => rect;
		assert.ok(dials.every(dial => dial.classList.contains('is-editable')));
		const readPanel = () => panel.doc.body.querySelector('[data-role="time-text"]').textContent;
		const check = (minutes: number) => {
			assert.equal(readPanel(), `${minutes}:00`);
			assert.deepEqual(h.read().map(view => view.time), [`${minutes}m`, `${minutes}m`]);
			const hands = dials.map(dial => dial.querySelector('.operon-flow-time-hand'));
			const coordinates = hands.map(hand => [hand.getAttribute('x2'), hand.getAttribute('y2')]);
			assert.deepEqual(coordinates[0], coordinates[1]); assert.deepEqual(coordinates[1], coordinates[2]);
		};
		for (const [surface, dial] of [[h.owners[0], dockDials[0]], [panel, panelDial]] as const) {
			h.settings.flowTimeSessionMinutes = 30; h.emit(); check(30);
			sendDialPointer(surface, dial, 'pointerdown', 180);
			sendDialPointer(surface, dial, 'pointermove', 270);
			check(45); assert.equal(h.settings.flowTimeSessionMinutes, 30);
			sendDialPointer(surface, dial, 'pointerup', 270);
			await new Promise(resolve => setImmediate(resolve));
			check(45); assert.equal(h.settings.flowTimeSessionMinutes, 45);
		}
		const host = h.views[0].slot.querySelector('.operon-status-dock-dial');
		h.owners[0].flush();
		const left = host.style.getPropertyValue('left');
		sendDialPointer(h.owners[0], dockDials[0], 'pointerdown', 270);
		sendDialPointer(h.owners[0], dockDials[0], 'pointermove', 180);
		check(30);
		firstTimer.getBoundingClientRect = () => ({ left: 250, width: 64 });
		h.emit(); h.owners[0].flush();
		assert.equal(host.style.getPropertyValue('left'), left);
		h.views[0].setViewport(850, 700, 0, 0); h.owners[0].flush();
		check(45);
		assert.notEqual(host.style.getPropertyValue('left'), left);
		sendDialPointer(h.owners[0], dockDials[0], 'pointerup', 180);
		assert.equal(h.settings.flowTimeSessionMinutes, 45);
		h.resolve(true);
		assert.equal(await h.controller.startBreak(), true);
		assert.ok(dials.every(dial => !dial.classList.contains('is-editable')));
	} finally { await sidebar.onClose(); h.close(); }
});

test('actual dock and sidebar mode controls update all surfaces in both directions', async () => {
	const h = feedbackHarness();
	const sidebar = new FlowTimeView(new WorkspaceLeaf(), {} as never, h.tracker as never, {} as never, h.controller, h.timerControls);
	const panel = statusDockDocument();
	sidebar.contentEl = panel.doc.body;
	const modes: string[] = [];
	sidebar.render = () => { modes.push(h.timerControls.mode); };
	try {
		await sidebar.onOpen();
		const tracker = h.state.active;
		const dockButton = h.views[0].root.querySelector('.operon-status-dock-mode');
		dockButton.click();
		assert.equal(modes.at(-1), 'flowtime');
		assert.deepEqual(h.read().map(view => view.time), ['+16m', '+16m']);
		await new Promise(resolve => setImmediate(resolve));
		assert.equal(h.settings.flowTimeMode, 'flowtime');
		(sidebar as any).createModeButton(panel.doc.body, 'tracktime', false);
		panel.doc.body.querySelector('.operon-flow-time-mode-button').click();
		assert.equal(modes.at(-1), 'tracktime');
		assert.deepEqual(h.read().map(view => view.time), ['41m', '41m']);
		await new Promise(resolve => setImmediate(resolve));
		assert.equal(h.settings.flowTimeMode, 'tracktime');
		assert.equal(h.state.active, tracker);
	} finally { await sidebar.onClose(); h.close(); }
});

test('dock uses elapsed, countdown and overtime with optional seconds only on the tracker', () => {
	const f = widget();
	const clock = f.find('operon-status-dock-mode');
	const upcoming = f.find('operon-status-dock-next').querySelector('.operon-status-dock-time');
	try {
		const upcomingDuration = upcoming.textContent;
		const active = f.state.active!;
		active.elapsedSeconds = 203;
		f.dock.update(f.state); assert.equal(timeText(clock), '3m');
		assert.ok(clock.dataset.durationWidth);
		f.state.settings.statusDockShowSeconds = true;
		f.dock.update(f.state); assert.equal(timeText(clock), '3m 23s');
		active.elapsedSeconds = 185;
		f.dock.update(f.state); assert.equal(timeText(clock), '3m 05s');
		active.elapsedSeconds = 203;
		f.state.timerSettings = { flowTimeMode: 'flowtime', flowTimeSessionMinutes: 7 };
		f.dock.update(f.state); assert.equal(timeText(clock), '3m 37s');
		active.elapsedSeconds = 623;
		f.dock.update(f.state); assert.equal(timeText(clock), '+3m 23s');
		f.state.settings.statusDockShowSeconds = false;
		f.dock.update(f.state); assert.equal(timeText(clock), '+3m');
		f.state.active = null;
		f.state.breakSnapshot = { ...f.state.breakSnapshot, breakState: { taskId: 'waiting', startMs: 0, targetSeconds: 60 } };
		f.state.breakSeconds = 42;
		f.dock.update(f.state); assert.equal(timeText(clock), '18s');
		f.state.breakSeconds = 60;
		f.dock.update(f.state); assert.equal(timeText(clock), '00s');
		f.state.breakSeconds = 83;
		f.dock.update(f.state); assert.equal(timeText(clock), '+23s');
		assert.ok(clock.dataset.durationWidth);
		f.state.breakSnapshot = { ...f.state.breakSnapshot, breakState: null };
		f.dock.update(f.state);
		assert.equal(clock.dataset.durationWidth, undefined);
		assert.equal(upcoming.textContent, upcomingDuration);
	} finally { f.dock.destroy(); }
});

test('tracker reserves space for the displayed duration units and keeps the same digit slots across ticks', () => {
	const f = widget();
	try {
		const clock = f.find('operon-status-dock-mode');
		const active = f.state.active!;
		for (const [seconds, showSeconds, label] of [
			[9, true, '00s'], [10, true, '00s'], [59, false, '00s'],
			[599, true, '00m 00s'], [600, true, '00m 00s'],
			[599, false, '00m'], [600, false, '00m'],
			[3600, false, '00h 00m'], [3600, true, '00h 00m 00s'],
			[360000, true, '000h 00m 00s'],
		] as const) {
			active.elapsedSeconds = seconds;
			f.state.settings.statusDockShowSeconds = showSeconds;
			f.dock.update(f.state);
			assert.equal(clock.dataset.durationWidth, label);
		}
		f.state.timerSettings = { flowTimeMode: 'flowtime', flowTimeSessionMinutes: 30 };
		for (const elapsed of [1799, 1800, 1801]) {
			active.elapsedSeconds = elapsed;
			f.dock.update(f.state);
			assert.equal(clock.dataset.durationWidth, '+00s');
		}
	} finally { f.dock.destroy(); }
});

test('Stop updates every dock before saving and commits without opening FlowTime', async () => {
	const h = feedbackHarness(); try {
		const active = h.state.active; const opening = (h.dock as any).toggleTimer();
		assert.deepEqual(h.read().map(v => [v.glyph, v.time, v.disabled]), [['play', 'TrackTime', true], ['play', 'TrackTime', true]]);
		assert.equal(h.state.active, active); assert.equal(h.state.saved, 0); assert.equal(h.state.opened, 0);
		await Promise.resolve(); await (h.dock as any).toggleTimer(); assert.equal(h.state.stopCalls, 1);
		h.resolve(true); await opening; assert.equal(h.state.saved, 1); assert.equal(h.state.opened, 0);
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
		assert.deepEqual(h.read().map(v => [v.glyph, v.time, v.coffee]), [['play', '00s', 'true'], ['play', '00s', 'true']]);
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

for (const success of [false, true]) test(`Idle Play changes immediately and ${success ? 'keeps tracking without opening FlowTime' : 'returns to idle on rejection'}`, async () => {
	const h = feedbackHarness(); try {
		h.state.active = null; h.emit(); const opening = (h.dock as any).toggleTimer();
		assert.equal(h.read()[0].glyph, 'square'); assert.equal(h.state.active, null);
		h.resolve(success); await opening; assert.equal(h.read()[0].glyph, success ? 'square' : 'play'); assert.equal(h.state.opened, 0); assert.equal(h.tracker.getActiveState()?.isUnassigned ?? false, success);
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


test('idle and waiting dock use the mode label in place of the running number', () => {
	const f = widget(); f.state.active = null; f.dock.update(f.state);
	const clock = f.find('operon-status-dock-time'), secondary = f.find('operon-status-dock-timer-controls').children[0];
	assert.equal(timeText(clock), 'TrackTime'); assert.equal((f.dock as any).icons.get(secondary), 'scan-search'); assert.equal(secondary.disabled, false);
	const hint = JSON.stringify(['Task Finder', 'Track a different task']);
	assert.equal((f.dock as any).tooltipKeys.get(secondary), hint); assert.equal((f.dock as any).tooltipKeys.has(f.find('operon-status-dock-tracker-reading')), false);
	f.state.breakSnapshot = { ...f.state.breakSnapshot, pendingTaskId: 'waiting' }; f.state.pendingDescription = 'Waiting task'; f.dock.update(f.state);
	assert.equal(timeText(clock), 'TrackTime');
	const waiting = f.find('operon-status-dock-tracker-reading').querySelector('.operon-status-dock-name');
	assert.equal(waiting.textContent, 'Waiting task');
	waiting.click(); clock.click(); assert.deepEqual(f.calls, ['source-or-finder', 'mode']);
	f.state.active = snapshot().active; f.dock.update(f.state); assert.equal(timeText(clock), '41m'); assert.equal((f.dock as any).icons.get(secondary), 'coffee');
	f.state.active = null; f.state.breakSnapshot = { ...f.state.breakSnapshot, breakState: { taskId: 'waiting', startMs: Date.now(), targetSeconds: 60 } }; f.dock.update(f.state);
	assert.equal(timeText(clock), '00s'); f.dock.destroy();
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
for (const outcome of ['switch', 'cancel', 'newer-session'] as const) test(`Creator stays available with a running task timer: ${outcome}`, async () => {
 const h = feedbackHarness();
 try {
  const original = h.state.active;
  const newer = { ...snapshot().active!, start: 'newer' };
  const createdTask = task('created', '2026-10-24');
  const buttons = h.views.map(view => view.root.querySelector('.operon-status-dock-creator'));
  assert.ok(buttons.every(button => !button.hidden && !button.disabled));

  const deps = (h.dock as any).dependencies;
  let switches = 0;
  deps.createTrackerTask = async () => {
   assert.equal(h.state.active, original, 'the timer keeps running while Creator is open');
   if (outcome === 'cancel') return null;
   h.tasks.set('created', createdTask);
   if (outcome === 'newer-session') { h.state.active = newer; h.emit(); }
   return 'created';
  };
  deps.startTimerForTask = async (id: string, canCommit: () => boolean) => {
   assert.equal(id, 'created');
   assert.equal(canCommit(), true);
   h.state.active = newer;
   assert.equal(canCommit(), false, 'a newer session must not be replaced');
   h.state.active = null;
   assert.equal(canCommit(), true, 'switching clears the old session before starting the new one');
   h.state.active = { operonId: id, task: createdTask, start: 'new', elapsedSeconds: 0, isUnassigned: false };
   assert.equal(canCommit(), true);
   h.emit(); switches++;
   return true;
  };
  buttons[0].click();
  await (h.dock as any).action;
  assert.equal(switches, outcome === 'switch' ? 1 : 0);
  if (outcome === 'switch') assert.equal(h.state.active?.operonId, 'created');
  else assert.equal(h.state.active, outcome === 'cancel' ? original : newer);
  assert.equal(h.tasks.has('created'), outcome !== 'cancel');
  h.views.forEach((view, index) => {
   assert.equal(view.root.querySelector('.operon-status-dock-creator'), buttons[index]);
   assert.equal(buttons[index].hidden, false);
   assert.equal(buttons[index].disabled, false);
  });
 } finally { h.close(); }
});

for (const initial of ['idle', 'assigned', 'unassigned', 'break'] as const) test(`Creator with automatic tracking off leaves ${initial} unchanged`, async () => {
 const h = feedbackHarness();
 try {
  if (initial === 'break') { h.resolve(true); await h.controller.startBreak(); }
  else if (initial === 'idle') h.state.active = null;
  else if (initial === 'unassigned') h.state.active = { operonId: null, task: null, start: 'unassigned', elapsedSeconds: 40, isUnassigned: true };
  h.settings.statusDockCreatorStartsTimer = false;
  h.settings.statusDockSections = normalizeStatusDockSections([{ id: 'tracker', enabled: false }]);
  h.emit();
  const active = h.state.active;
  const breakState = h.controller.getSnapshot();
  const stopCalls = h.state.stopCalls;
  let created = 0;
  (h.dock as any).dependencies.createTrackerTask = async (canUse: () => boolean) => {
   assert.equal(canUse(), true);
   created++;
   return 'created';
  };
  const widget = h.views[0];
  const button = widget.root.querySelector('.operon-status-dock-creator');
  assert.equal(button.parentElement, widget.root);
  assert.equal(button.hidden, false);
  assert.equal(widget.tooltipKeys.get(button), JSON.stringify(['Task Creator', 'Create a new task']));
  button.click(); await (h.dock as any).action;
  assert.equal(created, 1);
  assert.equal(h.state.active, active);
  assert.deepEqual(h.controller.getSnapshot(), breakState);
  assert.equal(h.state.startCalls, 0);
  assert.equal(h.state.stopCalls, stopCalls);
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
  const opening = (h.dock as any).createDockTask(h.views[0].root);
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
test('Finder and coffee share one tracker group without a divider and keep their own actions', () => {
 const f = widget(); const controls = f.find('operon-status-dock-timer-controls');
 assert.deepEqual(controls.children.map((child: HTMLElement) => child.tagName), ['BUTTON', 'BUTTON']);
 f.state.active = null; f.dock.update(f.state); assert.equal(controls.children[1].hidden, true);
 f.state.breakSnapshot = { pendingTaskId: 'active', actionPending: false, breakState: { taskId: 'active', startMs: 1, targetSeconds: 60 } }; f.dock.update(f.state);
 const finder = f.find('operon-status-dock-break-finder'); assert.equal(finder.hidden, false); finder.click(); f.find('operon-status-dock-timer-controls').children[0].click();
 assert.deepEqual(f.calls, ['finder', 'coffee']); f.dock.destroy();
});

test('hiding break Finder and Creator closes their bound hover panels', () => {
 const f = widget(); f.state.active = null; f.state.breakSnapshot = { pendingTaskId: 'active', actionPending: false, breakState: { taskId: 'active', startMs: 1, targetSeconds: 60 } }; f.dock.update(f.state);
 const finder = f.find('operon-status-dock-break-finder'), creator = f.find('operon-status-dock-creator'); let finderCloses = 0, creatorCloses = 0;
 finder._operonHoverClose = () => { finderCloses++; }; creator._operonHoverClose = () => { creatorCloses++; };
 f.state.breakSnapshot = { pendingTaskId: 'active', actionPending: false, breakState: null }; f.dock.update(f.state); assert.equal(finderCloses, 1);
 f.state.settings.statusDockSections = normalizeStatusDockSections(undefined).map(section => section.id === 'creator' ? { ...section, enabled: false } : section);
 f.dock.update(f.state); assert.equal(creator.hidden, true); assert.equal(creatorCloses, 1); f.dock.destroy();
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
 const next=f.find('operon-status-dock-next'),divider=(f.dock as any).sectionDividers.get('upcoming'),current=f.find('operon-status-dock-upcoming');
 assert.equal(divider.hidden,false); assert.equal(next.hidden,false); assert.equal((f.dock as any).icons.get(current.querySelector('.operon-status-dock-leading-icon')),'alarm-clock'); assert.equal((f.dock as any).icons.get(next.querySelector('.operon-status-dock-leading-icon')),'flag');
 next.querySelector('.operon-status-dock-name').click(); current.querySelector('.operon-status-dock-name').click(); assert.deepEqual(f.calls,['next','upcoming']); let closed=0; next.querySelector('.operon-status-dock-name')._operonHoverClose=()=>{closed++;}; f.dock.closeTooltips(); assert.equal(closed,1);
 f.state.settings.statusDockSections=normalizeStatusDockSections(undefined).map(section => section.id === 'upcoming' ? {...section,enabled:false} : section); f.dock.update(f.state); assert.equal(next.hidden,true); assert.equal(divider.hidden,true); assert.equal(closed,2); f.state.settings.statusDockSections=undefined; f.state.upcoming.next=null; f.dock.update(f.state); assert.equal(divider.hidden,true); f.dock.destroy();
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
 const f=widget();f.state.upcoming.current=true;f.state.upcoming.next={task:task('future','2026-10-24T12:00:00'),countdown:'00:00:25'};f.state.upcoming.due=true;f.dock.update(f.state);
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
 const f=widget();f.state.upcoming.current=true;f.state.upcoming.next={task:task('future','2026-10-25T12:00:00'),countdown:'01:00:00'};f.state.upcoming.task!.fieldValues.taskColor='AABBCC';f.state.upcoming.next!.task.fieldValues.taskColor='#123456';f.dock.update(f.state);
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
 f.state.settings.statusDockSections=normalizeStatusDockSections([{id:'ongoing',enabled:false}]);f.dock.update(f.state);assert.equal(rows.size,0);assert.equal(area.hidden,true);f.dock.destroy();
});
for(const behavior of ['source','editor','source-and-editor']as const)test(`each concurrent task opens its own current task with ${behavior}`,async()=>{
 const h=feedbackHarness();try{h.settings.statusDockClickAction=behavior;const opened:string[]=[];const a=task('a','2026-10-25T09:00:00'),b=task('b','2026-10-25T10:00:00');
 (h.dock as any).dependencies.openTask=async(id:string,_anchor:HTMLElement,action:string)=>{opened.push(`${id}:${action}`);};(h.dock as any).upcoming.getSnapshot=()=>({task:a,current:true,due:true,countdown:'00:00:00',ongoing:[a,b],next:null});h.emit();
 for(const id of ['a','b']){h.views[0].currentReadings.get(id).name.click();await new Promise(resolve=>setImmediate(resolve));}
 assert.deepEqual(opened,[`a:${behavior}`,`b:${behavior}`]);}finally{h.close();}
});

test('stored visibility affects every dock window, including windows opened later', () => {
	const h = feedbackHarness(false);
	try {
		const active = h.state.active, roots = h.views.map(w => w.root);
		assert.ok(h.views.every(w => w.slot.hidden));
		h.state.active!.elapsedSeconds++; h.emit();
		assert.ok(h.views.every(w => w.slot.hidden));
		const f = statusDockDocument(), context = (h.dock as any).createWindow({ doc: f.doc, win: f.doc.defaultView });
		f.doc.body.appendChild(context.widget.slot); context.widget.update(snapshot());
		assert.equal(context.widget.slot.hidden, true); context.dispose();
		h.settings.statusDockVisible = true; (h.dock as any).applyVisibility();
		assert.ok(h.views.every(w => !w.slot.hidden));
		assert.deepEqual(h.views.map(w => w.root), roots);
		assert.equal(h.state.active, active);
		assert.equal(h.state.stopCalls + h.state.startCalls + h.state.saved + h.state.opened, 0);
	} finally { h.close(); }
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
		if (stale === 'disabled') h.settings.statusDockSections = normalizeStatusDockSections([{id:'ongoing',enabled:false},{id:'upcoming',enabled:false}]);
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
	const f = widget(), button = f.find('operon-status-dock-next'), control = (f.dock as any).calendarControls.get(button);
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


test('only the tracker duration switches mode and task names remain separate actions', () => {
	const f = widget();
	for (const cls of ['operon-status-dock-tracker-reading', 'operon-status-dock-upcoming']) {
		const reading = f.find(cls), time = reading.querySelector('.operon-status-dock-time'), name = reading.querySelector('.operon-status-dock-name');
		const tracker = cls === 'operon-status-dock-tracker-reading';
		reading.click(); assert.deepEqual(f.calls, []);
		time.click(); assert.deepEqual(f.calls, tracker ? ['mode'] : []); f.calls.length = 0;
		if (tracker) assert.match(f.doc.getElementById(time.getAttribute('aria-labelledby')).textContent, /Switch to FlowTime/u);
		for (const plain of tracker ? [reading] : [reading, time]) {
			assert.equal(plain.getAttribute('role'), null); assert.equal(plain.getAttribute('aria-labelledby'), null);
			assert.equal((f.dock as any).tooltipKeys.has(plain), false);
			assert.equal(plain.handlers?.get('keydown')?.size ?? 0, 0);
		}
		assert.equal(name.getAttribute('role'), 'button'); assert.equal(name.tabIndex, 0);
		assert.equal((f.dock as any).tooltipKeys.has(name), false); assert.ok(name.getAttribute('aria-labelledby'));
		name.click(); assert.equal(f.calls.length, 1); f.calls.length = 0;
	}
	f.dock.destroy();
});

test('ongoing tasks keep Now in accessible labels without visible text or hover tooltips', () => {
	const f = widget(), a = task('a', '2026-10-25T09:00:00'), b = task('b', '2026-10-25T10:00:00');
	f.state.upcoming = { task: a, ongoing: [a, b], current: true, due: true, countdown: '00:00:00' }; f.dock.update(f.state);
	for (const item of (f.dock as any).currentReadings.values()) {
		assert.equal(item.time.hidden, true); assert.equal(item.time.textContent, '');
		assert.equal((f.dock as any).tooltipKeys.has(item.name), false);
		assert.ok(f.doc.getElementById(item.name.getAttribute('aria-labelledby')).textContent.includes(`Now: ${a.description}`));
	}
	f.state.upcoming = { task: b, current: true, due: true, countdown: '00:00:00' }; f.dock.update(f.state);
	const reading = f.find('operon-status-dock-upcoming'), name = reading.querySelector('.operon-status-dock-name');
	assert.equal(reading.querySelector('.operon-status-dock-time').hidden, true);
	assert.equal((f.dock as any).tooltipKeys.has(name), false); assert.ok(f.doc.getElementById(name.getAttribute('aria-labelledby')).textContent.includes(`Now: ${b.description}`)); f.dock.destroy();
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


test('recent session lifetime consumes ten seconds, pauses, and resumes the remaining budget', () => {
 const lifetime = new StatusDockSessionLifetime(0);
 assert.equal(lifetime.advance(4000, true), true);
 assert.equal(lifetime.advance(64000, true), true);
 assert.equal(lifetime.advance(65000, false), true);
 assert.equal(lifetime.advance(70999, false), true);
 assert.equal(lifetime.advance(71000, false), false);
});

function sessionTrackerHarness() {
 const settings = { ...DEFAULT_SETTINGS, trackerSplitSessionsAtMidnight: false };
 let currentTask = task('recorded', '2026-10-26T10:00:00');
 let fails = false;
 let active: any = null;
 const indexer = { getTask: (id: string) => id === currentTask.operonId ? currentTask : null,
  getAllTasks: () => [currentTask], reindexFilePath: async () => {}, getGeneration: () => 1 };
 const writer = { writeTaskFields: async (_id: string, fields: Record<string, string>, options?: {canCommit?:()=>boolean}) => {
  if (options?.canCommit?.() === false) return false;
  if (fails) return false;
  // Intentionally mutate the same indexed object: notifications must use a sealed preimage.
  Object.assign(currentTask.fieldValues, fields); return true;
 } };
 const store = { getActiveForUser: () => active, clearActiveForUser: async () => { active = null; },
  setActiveForUser: async (record: Record<string, unknown>, guard?: () => boolean) => {
   if (guard && !guard()) throw new Error('Cancelled active tracker write');
   active = { ...record, id: 'active' }; return active;
  } };
 const tracker = new TimeTracker({} as App, indexer as never, writer as never, store as never, () => settings,
  undefined, async () => {});
 const created: TrackerSession[] = []; tracker.subscribeSessionCreated(session => created.push(session));
 return { tracker, created, settings, setFail: () => { fails = true; },
  activate: (taskId: string | null = 'recorded') => { active = { id: 'active', taskId, start: '2026-10-26T10:00:00', source: 'status-bar' }; },
  task: () => currentTask };
}

test('manual additions notify only committed new records; edit and delete do not announce creations', async () => {
 const h = sessionTrackerHarness(); try {
  assert.equal(await h.tracker.addSession('recorded', '2026-10-26T10:00:00', '2026-10-26T10:34:22'), true);
  assert.equal(h.created.length, 1); assert.equal(h.created[0].durationSeconds, 2062);
  await h.tracker.updateSession('recorded', 0, '2026-10-26T10:00:00', '2026-10-26T10:35:00');
  await h.tracker.deleteSession('recorded', 0); assert.equal(h.created.length, 1);
  await h.tracker.addSession('recorded', '2026-10-26T10:00:00', '2026-10-26T10:34:22');
  assert.equal(h.created.length, 2);
 } finally { h.tracker.destroy(); }
});

test('failed or cancelled creation never announces a record', async () => {
 const h = sessionTrackerHarness(); try {
  assert.equal(await h.tracker.addSession('recorded', '2026-10-26T10:00:00', '2026-10-26T11:00:00', () => false), false);
  h.setFail(); assert.equal(await h.tracker.addSession('recorded', '2026-10-26T10:00:00', '2026-10-26T11:00:00'), false);
  assert.equal(h.created.length, 0);
 } finally { h.tracker.destroy(); }
});

test('stops from any source notify and repeated verified acknowledgement does not duplicate a card', async () => {
 const h = sessionTrackerHarness(); try {
  h.activate(); assert.equal(await h.tracker.stop('manual', '2026-10-26T10:34:22'), true);
  assert.equal(h.created.length, 1); assert.equal(h.created[0].durationSeconds, 2062);
  h.tracker.notifyCreatedSessions('recorded', ''); assert.equal(h.created.length, 1);
  assert.equal(await h.tracker.stop(), false); assert.equal(h.created.length, 1);
 } finally { h.tracker.destroy(); }
});

test('midnight records are announced in stored order', async () => {
 const h = sessionTrackerHarness(); try {
  h.settings.trackerSplitSessionsAtMidnight = true;
  await h.tracker.addSession('recorded', '2026-10-25T23:50:00', '2026-10-26T00:10:00');
  assert.equal(h.created.length, 2); assert.equal(h.created.at(-1)?.start, '2026-10-26T00:00:00');
  assert.equal(h.created.at(-1)?.durationSeconds, 600);
 } finally { h.tracker.destroy(); }
});

test('recent session card aligns left and routes duration, description, and icon separately', async () => {
 const f = statusDockDocument(); let now = 0;
 f.doc.defaultView.performance = { now: () => now };
 f.doc.defaultView.queueMicrotask = queueMicrotask;
 const host = f.doc.body.createDiv();
 host.clientLeft = 1; host.getBoundingClientRect = () => ({ left: 100, top: 500, right: 700, bottom: 544, width: 600, height: 44 });
 const h = sessionTrackerHarness();
 await h.tracker.addSession('recorded', '2026-10-26T10:00:00', '2026-10-26T10:34:22');
 h.task().fieldValues['taskColor'] = 'ffc800';
 let opens = 0, tasksOpened = 0, icons = 0;
 const card = new StatusDockSessionCard(host, { getSettings: () => h.settings, getTask: () => h.task(),
  getSessions: id => h.tracker.getTaskSessions(id), isTracking: () => false,
  actions: { openTask: async (id, anchor) => { tasksOpened++; assert.equal(id, 'recorded'); assert.ok(anchor.classList.contains('operon-status-dock-name')); }, openSession: async session => { opens++; assert.equal(session.durationSeconds, 2062); },
   clickIcon: async id => { icons++; assert.equal(id, 'recorded'); }, contextualAction: () => {}, isPinned: () => false, hasSubtasks: () => false } });
 try {
  card.show(h.created[0]); const el = host.querySelector('.operon-status-dock-session-card');
  assert.equal(host.classList.contains('has-session-feedback'), true);
  assert.equal(el.style.left, '-1px');
  const rect = (top: number, height = 44) => ({ left: 100, right: 500, top, bottom: top + height, width: 400, height });
  assert.equal(el.querySelector('.operon-status-dock-name').handlers.get('mouseenter')?.size ?? 0, 0);
  assert.ok(el.querySelector('.operon-status-dock-name').getAttribute('aria-labelledby'));
  for (const selector of ['.operon-status-dock-time']) {
   const target = el.querySelector(selector);
   for (const [dockTop, cardTop, targetTop, above] of [
    [500, 440, 448, true], // Card above Dock: use free space above.
    [100, 160, 168, false], // Card below Dock: use free space below.
    [500, 640, 650, true], // Below is full: crossing toward Dock is allowed.
    [100, 20, 30, false], // Above is full: use the remaining space below.
   ] as const) {
    host.getBoundingClientRect = () => rect(dockTop);
    el.getBoundingClientRect = () => rect(cardTop);
    target.getBoundingClientRect = () => rect(targetTop, 28);
    for (const callback of target.handlers.get('mouseenter')) callback({ type: 'mouseenter' });
    assert.equal(target._operonFloatingTooltip.classList.contains('is-tooltip-above'), above);
    assert.equal(target._operonFloatingTooltip.style.getPropertyValue('--operon-live-hover-border'), '#ffc800');
    const tooltipTop = Number.parseFloat(target._operonFloatingTooltip.style.top);
    assert.ok(above ? tooltipTop < targetTop : tooltipTop >= targetTop + 28);
    for (const callback of target.handlers.get('mouseleave')) callback({ type: 'mouseleave' });
   }
  }
  assert.equal(el.hidden, false); assert.equal(el.querySelector('.operon-status-dock-time').textContent, '34m 22s');
  el.querySelector('.operon-status-dock-name').click(); await new Promise(resolve => setImmediate(resolve)); assert.equal(tasksOpened, 1); assert.equal(opens, 0);
  el.querySelector('.operon-status-dock-time').click(); await new Promise(resolve => setImmediate(resolve)); assert.equal(opens, 1); assert.equal(tasksOpened, 1);
  el.querySelector('.operon-status-dock-session-icon').click(); await new Promise(resolve => setImmediate(resolve)); assert.equal(icons, 1);
  now = 4000; f.flush();
  for (const fn of el.handlers.get('pointerenter')) fn({});
  now = 60000; f.flush(); assert.equal(el.hidden, false);
  for (const fn of el.handlers.get('pointerleave')) fn({});
  now = 65999; f.flush(); assert.equal(el.hidden, false);
  now = 66000; f.flush(); assert.equal(el.hidden, true);
  assert.equal(host.classList.contains('has-session-feedback'), false);
  card.show(h.created[0]); await h.tracker.deleteSession('recorded', 0); card.refresh(); assert.equal(el.hidden, true);
 } finally { card.destroy(); h.tracker.destroy(); assert.equal(f.timers.size, 0); }
});


test('unassigned Stop saves no task session and emits no session card', async () => {
 const h = sessionTrackerHarness(); try {
  h.activate(null); assert.equal(await h.tracker.stop('manual', '2026-10-26T10:34:22'), true);
  assert.equal(h.created.length, 0);
 } finally { h.tracker.destroy(); }
});

test('Coffee uses the same committed notification while keeping the break state independent of FlowTime UI', async () => {
 const h = sessionTrackerHarness(); h.activate();
 const controller = new FlowTimeBreakController({ timeTracker: h.tracker, getTask: () => h.task(), getSettings: () => h.settings,
  saveSettings: async () => {}, stopActiveTimer: guard => h.tracker.stop('manual', '2026-10-26T10:34:22', guard),
  startTimerForTask: async () => false, playReminderSound: async () => {}, scheduleTick: () => () => {} });
 try {
  assert.equal(await controller.startBreak(), true); assert.equal(h.created.length, 1);
  assert.equal(h.created[0].durationSeconds, 2062); assert.ok(controller.getSnapshot().breakState);
  controller.endBreak(); assert.equal(h.created.length, 1);
 } finally { controller.destroy(); h.tracker.destroy(); }
});


test('session card stays while its task menu is open, then resumes the remaining lifetime', async () => {
 const f = statusDockDocument(); let now = 0; f.doc.defaultView.performance = { now: () => now };
 f.doc.defaultView.queueMicrotask = queueMicrotask;
 const host = f.doc.body.createDiv(), h = sessionTrackerHarness();
 await h.tracker.addSession('recorded', '2026-10-26T10:00:00', '2026-10-26T10:34:22');
 const card = new StatusDockSessionCard(host, { getSettings: () => h.settings, getTask: () => h.task(), getSessions: id => h.tracker.getTaskSessions(id), isTracking: () => false,
 actions: { openTask: async () => {}, openSession: async () => {}, clickIcon: async () => {}, contextualAction: () => {}, isPinned: () => false, hasSubtasks: () => false } });
 try {
  card.show(h.created[0]); const el = host.querySelector('.operon-status-dock-session-card');
  const icon = el.querySelector('.operon-status-dock-session-icon');
  now = 3000; f.flush();
  assert.equal(showTaskContextualHoverMenu(icon, { surface: 'flowTimeTask', taskId: 'recorded', getTask: () => h.task(), getSettings: () => h.settings, onAction: () => {} }), true);
  assert.equal(isTaskContextualHoverMenuActive(el), true); f.flush();
  now = 60000; f.flush(); assert.equal(el.hidden, false);
  hideTaskContextualHoverMenu(true, el); f.flush(); assert.equal(isTaskContextualHoverMenuActive(el), false);
  now = 66999; f.flush(); assert.equal(el.hidden, false);
  now = 67000; f.flush(); assert.equal(el.hidden, true);
 } finally { card.destroy(); h.tracker.destroy(); }
});

function scopedTask(id: string, values: Record<string, string>, checkbox: 'open' | 'done' | 'cancelled' = 'open'): IndexedTask {
 return { ...task(id, ''), description: id, checkbox, fieldValues: values };
}
function scopeListFixture(timerAction?: (id: string, guard: () => boolean) => Promise<unknown>, isTracking?: (id: string) => boolean, historyAction?: (id: string, guard: () => boolean) => Promise<unknown>) {
 const f = statusDockDocument(); const host = f.doc.body.createDiv('operon-status-dock');
 host.createDiv('operon-status-dock-tracker');
 host.getBoundingClientRect = () => ({ left: 100, top: 500, right: 600, bottom: 544, width: 500, height: 44 });
 const tasks = [scopedTask('first', { dateDue: localToday() }), scopedTask('second', { dateScheduled: localToday() })];
 const tracking = new Set<string>();
 const calls: string[] = []; let held: TrackerSession | null = null;
 const sessionCard = { show(session: TrackerSession) { calls.push(`session:${session.operonId}`); }, takeSession() { const value = held; held = null; return value; } } as StatusDockSessionCard;
 const settings = structuredClone(DEFAULT_SETTINGS);
 const list = new StatusDockTaskList(host, { getSettings: () => settings, getTask: id => tasks.find(t => t.operonId === id),
 startHistoryTimer: historyAction ?? (async (id, guard) => {if (guard()) calls.push(`replay:${id}`);}),
 isTracking: isTracking ?? (id => tracking.has(id)), toggleTimer: timerAction ?? (async (id, guard) => { if (guard()) { calls.push(`timer:${id}`); if (tracking.has(id)) tracking.delete(id); else tracking.add(id); } }), sessionCard, actions: {
  openTask: async id => { calls.push(`open:${id}`); }, clickIcon: async id => { calls.push(`icon:${id}`); },
  openSession: async session => { calls.push(`edit:${session.operonId}:${session.sessionIndex}`); }, contextualAction: () => {}, isPinned: () => false, hasSubtasks: () => false,
 } });
 const panel = host.querySelector('.operon-status-dock-task-list');
 const controls = host.querySelector('.operon-status-dock-scopes');
 return { ...f, host, list, panel, controls, tasks, calls, settings, tracking, hold: (session: TrackerSession) => { held = session; } };
}

test('dock dial stays hidden during task lists and queued session cards, then returns in place', () => {
 const f = widget();
 const task = scopedTask('card', {});
 const session = historySessions(task)[0];
 const actions = { openTask: async () => {}, openSession: async () => {}, clickIcon: async () => {},
  contextualAction: () => {}, isPinned: () => false, hasSubtasks: () => false };
 let now = 0;
 f.doc.defaultView.performance = { now: () => now };
 f.doc.defaultView.queueMicrotask = queueMicrotask;
 f.dock.root.getBoundingClientRect = () => ({ left: 100, top: 500, right: 600, bottom: 544, width: 500, height: 44 } as DOMRect);
 f.find('operon-status-dock-tracker').getBoundingClientRect = () => ({ left: 180, width: 180 });
 const card = new StatusDockSessionCard(f.dock.root, {
  getSettings: () => f.state.settings, getTask: () => task, getSessions: () => [session], isTracking: () => false,
  actions, onVisibilityChange: visible => f.dock.setDialObscured('session-card', visible),
 });
 const list = new StatusDockTaskList(f.dock.root, {
  getSettings: () => f.state.settings, getTask: () => task, isTracking: () => false, toggleTimer: async () => {},
  sessionCard: card, actions, onVisibilityChange: visible => f.dock.setDialObscured('task-list', visible),
 });
 try {
  f.state.settings.statusDockShowTimerDial = true;
  f.dock.setViewport(900, 700, 0, 0); f.dock.update(f.state); f.flush();
  const dial = f.dock.slot.querySelector<HTMLElement>('.operon-status-dock-dial')!;
  const position = dial.style.getPropertyValue('left');
  assert.equal(dial.hidden, false);
  list.update({ overdue: [], today: [], pinned: [task] }, [session]);
  list.toggle('pinned'); assert.equal(dial.hidden, true);
  list.toggle('history'); f.flush(); assert.equal(dial.hidden, true);
  list.showSession(session); list.close(); f.flush(); assert.equal(dial.hidden, true);
  now = 10_000; f.flush(); f.flush();
  assert.equal(dial.hidden, false);
  assert.equal(dial.style.getPropertyValue('left'), position);
  list.showSession(session); assert.equal(dial.hidden, true);
  f.state.settings.statusDockShowTimerDial = false; f.dock.update(f.state);
  card.clear(); f.flush(); assert.equal(dial.hidden, true);
 } finally { list.destroy(); card.destroy(); f.dock.destroy(); }
});

test('dock scopes reuse Finder dates, exclude terminal tasks, deduplicate and sort closest first', () => {
 const today = localToday(); const now = new Date(`${today}T12:00:00`);
 const tasks = [scopedTask('far', {dateDue: '2000-01-01'}), scopedTask('near', {dateScheduled: '2020-01-01'}),
  scopedTask('timed-far', {dateScheduled: today, datetimeStart: `${today}T23:00:00`}),
  scopedTask('timed-near', {dateScheduled: today, datetimeStart: `${today}T12:05:00`}),
  scopedTask('all-day', {dateStarted: today}), scopedTask('done', {dateDue: today}, 'done'),
  scopedTask('cancelled', {dateDue: '2000-01-01'}, 'cancelled'), scopedTask('future', {dateDue: '2999-01-01'})];
 const result = buildStatusDockTaskScopes([...tasks, tasks[0]], now);
 assert.deepEqual(result.overdue.map(t => t.operonId), ['near', 'far']);
 assert.deepEqual(result.today.map(t => t.operonId), ['all-day', 'timed-near', 'timed-far']);
 assert.equal(result.today[1], tasks[3]);
});

test('dock scope icons and separator appear only for populated scopes; one list opens at a time', () => {
 const f = scopeListFixture();
 try {
  assert.equal(f.controls.hidden, true);
  f.list.update({overdue: [f.tasks[0]], today: []});
  assert.equal(f.controls.hidden, false); assert.equal(f.controls.children[0].hidden, false); assert.equal(f.controls.children[1].hidden, true);
  f.list.toggle('overdue'); assert.equal(f.panel.hidden, false); assert.equal(f.panel.children.length, 1);
  f.list.update({overdue: [f.tasks[0]], today: [f.tasks[1]]}); f.list.toggle('today');
  assert.equal(f.panel.children.length, 1); assert.equal(f.controls.children[0].getAttribute('aria-expanded'), 'false');
  assert.equal(f.controls.children[1].getAttribute('aria-expanded'), 'true');
  f.list.toggle('today'); assert.equal(f.panel.hidden, true);
  f.list.toggle('overdue'); f.list.update({overdue: [], today: []});
  assert.equal(f.panel.hidden, true); assert.equal(f.controls.hidden, true);
 } finally { f.list.destroy(); }
});

test('scope cards omit duration, preserve nodes across refresh, and route name and icon actions', async () => {
 const f = scopeListFixture();
 try {
  f.list.update({overdue: [], today: f.tasks}); f.list.toggle('today');
  const row = f.panel.children[0];
  assert.equal(row.querySelector('.operon-status-dock-time'), null);
  row.querySelector('.operon-status-dock-name').click(); row.querySelector('.operon-status-dock-session-icon').click();
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(f.calls, ['open:first', 'icon:first']); assert.equal(f.panel.hidden, false);
  f.list.update({overdue: [], today: f.tasks}); assert.equal(f.panel.children[0], row);
  f.list.update({overdue: [], today: [...f.tasks].reverse()}); assert.equal(f.panel.children[1], row);
 } finally { f.list.destroy(); }
});

test('dock click closes without consuming the action; scope triggers, cards and portals stay interactive', () => {
 const f = scopeListFixture();
 try {
  const open = () => { f.list.update({overdue: [], today: f.tasks}); f.list.toggle('today'); };
  open();
  for (const target of [f.controls.children[1], f.panel.children[0], f.doc.body.createDiv('operon-calendar-hover-menu'), f.doc.body.createDiv('operon-floating-panel'), f.doc.body.createDiv('modal-container')]) {
   f.emit('click', {target}); assert.equal(f.panel.hidden, false);
  }
  let stopped = false;
  f.emit('click', {target: f.host.querySelector('.operon-status-dock-tracker'), stopPropagation: () => {stopped = true;} });
  assert.equal(f.panel.hidden, true); assert.equal(stopped, false);
  open(); f.emit('click', {target: f.doc.body}); assert.equal(f.panel.hidden, true);
 } finally { f.list.destroy(); }
});

test('latest session waits until scope closes; hiding/destroying discards the queue and listeners', () => {
 const f = scopeListFixture();
 f.list.update({overdue: [], today: f.tasks});
 f.hold({operonId:'previous'} as TrackerSession); f.list.toggle('today');
 f.list.showSession({operonId:'first'} as TrackerSession); f.list.showSession({operonId:'last'} as TrackerSession);
 assert.deepEqual(f.calls, []); f.list.close(); assert.deepEqual(f.calls, ['session:last']);
 f.list.toggle('today'); f.list.showSession({operonId:'hidden'} as TrackerSession); f.list.close(false);
 assert.deepEqual(f.calls, ['session:last']);
 f.list.toggle('today'); f.list.destroy(); f.flush();
 assert.equal(f.panel.isConnected, false);
 for (const key of ['click', 'keydown', 'pointermove']) assert.equal(f.listeners.get(key)?.size ?? 0, 0);
});

test('scope list positions away from dock and reverses stacking only above it', () => {
 const f = scopeListFixture();
 try {
  f.list.update({overdue: [], today: f.tasks}); f.list.toggle('today');
  assert.equal(f.panel.classList.contains('is-below'), false);
  f.host.getBoundingClientRect = () => ({left:100, top:15, right:600, bottom:59, width:500, height:44});
  f.emitWindow('resize', {}); f.flush(); assert.equal(f.panel.classList.contains('is-below'), true);
  assert.equal(f.panel.style.maxHeight, '172px'); // Two complete 80px mock cards, gap and padding.
 } finally {f.list.destroy();}
});

test('Status Dock is its own Task Lists menu surface and retains independently saved visibility', () => {
 assert.ok(CONTEXTUAL_MENU_SURFACE_GROUPS.find(g => g.id === 'taskLists')?.surfaces.includes('statusDock'));
 assert.equal(isContextualMenuActionSupportedOnSurface('statusDock', 'setAsTracked'), true);
 const settings = migrateSettings({...DEFAULT_SETTINGS, contextualMenuSurfaceActionMatrix: {...DEFAULT_SETTINGS.contextualMenuSurfaceActionMatrix, statusDock: ['openEditor']} });
 const data = buildOperonDataPackageFromSettings(settings);
 const restored = composeOperonSettingsFromDataPackage(data, DEFAULT_SETTINGS);
 assert.deepEqual(restored.contextualMenuSurfaceActionMatrix.statusDock, ['openEditor']);
 assert.deepEqual(restored.contextualMenuSurfaceActionMatrix.flowTimeTask, DEFAULT_SETTINGS.contextualMenuSurfaceActionMatrix.flowTimeTask);
});


test('scope Escape dismisses an owned menu before dismissing the list', () => {
 const f = scopeListFixture();
 try {
  f.list.update({overdue: [], today: f.tasks}); f.list.toggle('today');
  const icon = f.panel.children[0].querySelector('.operon-status-dock-session-icon'); icon.focus();
  assert.equal(showTaskContextualHoverMenu(icon, {surface:'statusDock', taskId:'first', getTask:()=>f.tasks[0], getSettings:()=>f.settings, onAction:()=>{}}), true);
  f.emit('keydown', {key:'Escape', target:icon, preventDefault() {}, stopPropagation() {}});
  assert.equal(f.panel.hidden, false);
  hideTaskContextualHoverMenu(true, f.panel);
  f.emit('keydown', {key:'Escape', target:icon, preventDefault() {}, stopPropagation() {}});
  assert.equal(f.panel.hidden, true);
 } finally { f.list.destroy(); }
});

test('separate-window scope lists have independent open state and listener cleanup', () => {
 const first = scopeListFixture(), second = scopeListFixture();
 try {
  for (const f of [first,second]) { f.list.update({overdue: [], today: f.tasks}); f.list.toggle('today'); }
  first.emit('click', {target:first.doc.body});
  assert.equal(first.panel.hidden, true); assert.equal(second.panel.hidden, false);
  first.list.destroy(); second.flush(); assert.equal(second.panel.hidden, false);
 } finally {second.list.destroy();}
});


test('scope hover timer toggles only its task, refreshes without task changes, and keeps list open', async () => {
 const f = scopeListFixture();
 try {
  f.list.update({overdue: f.tasks, today: f.tasks}); f.list.toggle('today');
  const row = f.panel.children[0], timer = row.querySelector('.operon-status-dock-scope-timer');
  assert.ok(timer); assert.equal(timer.classList.contains('is-active'), false);
  timer.click(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(f.calls, ['timer:first']); assert.equal(f.panel.hidden, false);
  assert.equal(timer.classList.contains('is-active'), true);
  f.tracking.clear(); f.list.update({overdue: f.tasks, today: f.tasks});
  assert.equal(timer.classList.contains('is-active'), false);
  assert.equal(f.panel.children[0], row);
  assert.equal(timer.getAttribute('title'), null);
 } finally { f.list.destroy(); }
});

test('scope timer prevents double clicks and invalidates a pending write when the list closes', async () => {
 let release: (() => void) | undefined, allowed: boolean | undefined, count = 0;
 const f = scopeListFixture(async (_id, guard) => { count++; await new Promise<void>(resolve => { release = resolve; }); allowed = guard(); });
 try {
  f.list.update({overdue: [], today: f.tasks}); f.list.toggle('today');
  const timer = f.panel.children[0].querySelector('.operon-status-dock-scope-timer');
  timer.click(); timer.click(); assert.equal(count, 1); assert.equal(timer.disabled, true);
  f.list.close(); release?.(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(allowed, false); assert.equal(timer.disabled, false);
 } finally { f.list.destroy(); }
});


test('scope Play and Stop complete through the real TimeTracker without rejecting their own state change', async () => {
 const h = sessionTrackerHarness(), results: boolean[] = [];
 const f = scopeListFixture(async (id, guard) => {
  results.push(h.tracker.isTimerRunning(id)
   ? await h.tracker.stop('manual', '2026-10-26T10:01:00', guard)
   : await h.tracker.start(id, 'status-bar', '2026-10-26T10:00:00', undefined, guard));
 }, id => h.tracker.isTimerRunning(id));
 try {
  f.tasks[0].operonId = 'recorded';
  f.list.update({overdue: [], today: f.tasks}); f.list.toggle('today');
  const timer = f.panel.children[0].querySelector('.operon-status-dock-scope-timer');
  timer.click(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(results, [true]); assert.equal(h.tracker.isTimerRunning('recorded'), true);
  assert.equal(timer.classList.contains('is-active'), true);
  timer.click(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(results, [true, true]); assert.equal(h.tracker.isTimerRunning('recorded'), false);
  assert.equal(timer.classList.contains('is-active'), false); assert.equal(h.created.length, 1);
  assert.equal(f.panel.hidden, false);
 } finally { f.list.destroy(); h.tracker.destroy(); }
});


test('scope Play/Stop and task refresh replace append-only SVG glyphs without losing labels', async () => {
 const globals = globalThis as typeof globalThis & { __operonTestSetIcon?: (target: HTMLElement, icon: string) => void };
 const previous = globals.__operonTestSetIcon;
 globals.__operonTestSetIcon = (target, icon) => {
  const glyph = target.ownerDocument.createElement('svg'); glyph.dataset.icon = icon; target.appendChild(glyph);
 };
 const f = scopeListFixture();
 try {
  f.list.update({ overdue: f.tasks, today: f.tasks }); f.list.toggle('today');
  const row = f.panel.children[0], timer = row.querySelector('.operon-status-dock-scope-timer');
  const icon = row.querySelector('.operon-status-dock-session-icon');
  for (let cycle = 0; cycle < 6; cycle++) {
   timer.click(); await new Promise(resolve => setTimeout(resolve, 0));
   f.tasks[0].description = `Updated task ${cycle}`;
   f.list.update({ overdue: f.tasks, today: f.tasks });
   for (const button of [timer, icon]) {
    assert.equal(button.children.filter((child: Element) => child.tagName === 'SVG').length, 1);
    assert.ok(button.getAttribute('aria-labelledby'));
    assert.equal(button.getAttribute('title'), null);
   }
   assert.equal(timer.children.find((child: HTMLElement) => child.tagName === 'SVG')?.dataset.icon, cycle % 2 === 0 ? 'square' : 'play');
  }
 } finally { f.list.destroy(); globals.__operonTestSetIcon = previous; }
});

for (const ongoing of [false,true]) for(const upcoming of [false,true]) test('independent calendar sections: ongoing='+ongoing+', upcoming='+upcoming,()=>{
 const f=widget(), now=task('current','2026-10-25T09:00:00'), future=task('future','2026-10-25T12:00:00');
 f.state.settings.upcomingShowStatusBar=false; // Desktop ignores the legacy mobile preference.
 f.state.settings.statusDockSections=normalizeStatusDockSections(undefined).map(s=>s.id==='ongoing'?{...s,enabled:ongoing}:s.id==='upcoming'?{...s,enabled:upcoming}:s);
 f.state.upcoming={task:now,due:true,current:true,ongoing:[now],countdown:null,next:{task:future,countdown:'01:00:00'}};
 const before=JSON.stringify(f.state);f.dock.update(f.state);
 assert.equal((f.dock as any).taskArea.hidden,!ongoing);
 assert.equal((f.dock as any).futureArea.hidden,!upcoming);
 assert.equal((f.dock as any).currentReadings.size,ongoing?1:0);
 assert.equal(JSON.stringify(f.state),before);
 // Retained elapsed task is still controlled only by Ongoing.
 f.state.upcoming.ongoing=[];f.dock.update(f.state);
 assert.equal((f.dock as any).upcoming.hidden,!ongoing);
 assert.equal((f.dock as any).nextUpcoming.hidden,!upcoming);
 f.dock.destroy();
});

test('sections follow physical DOM order without rebuilding on ticks, and all-disabled hides only UI',()=>{
 const f=widget();f.state.alert.state='hidden';
 f.state.settings.statusDockSections=normalizeStatusDockSections([{id:'upcoming',enabled:true},{id:'tracker',enabled:false}]);
 const before=JSON.stringify(f.state.active);f.dock.update(f.state);
 const roots=()=>Array.from(f.dock.root.children).filter((e:any)=>e.dataset.statusDockSection);
 assert.deepEqual(roots().map((e:any)=>e.dataset.statusDockSection),['upcoming','tracker','creator','ongoing']);
 const elements=roots();f.dock.update(f.state);assert.deepEqual(roots(),elements);
 assert.equal((f.dock as any).tracker.hidden,true);
 assert.equal(JSON.stringify(f.state.active),before);
 f.state.settings.statusDockSections=normalizeStatusDockSections(undefined).map(s=>({...s,enabled:false}));
 f.dock.update(f.state);assert.equal(f.dock.root.classList.contains('is-empty'),true);
 f.state.alert.state='conflict';f.dock.update(f.state);
 assert.equal(f.dock.root.classList.contains('is-empty'),false);
 assert.equal(JSON.stringify(f.state.active),before);f.dock.destroy();
});

test('disabling or reordering a section closes its list and invalidates pending timer guards',async()=>{
 let guard:(()=>boolean)|undefined, finish:()=>void=()=>{};
 const f=scopeListFixture(async(_id,canCommit)=>{guard=canCommit;await new Promise<void>(resolve=>{finish=resolve;});});
 try{
  f.list.update({overdue:[],today:f.tasks});f.list.toggle('today');
  f.panel.querySelector('.operon-status-dock-scope-timer').click();
  await Promise.resolve();assert.equal(guard?.(),true);
  f.settings.statusDockSections=normalizeStatusDockSections([{id:'overdueToday',enabled:false}]);
  assert.equal(guard?.(),false,'settings invalidate the write before rendering');
  f.list.update({overdue:[],today:f.tasks});
  assert.equal(f.panel.hidden,true);assert.equal(f.controls.hidden,true);assert.equal(guard?.(),false);
  finish();await Promise.resolve();await Promise.resolve();
  f.settings.statusDockSections=undefined;f.list.update({overdue:[],today:f.tasks});f.list.toggle('today');
  assert.equal(f.panel.hidden,false);
  f.settings.statusDockSections=normalizeStatusDockSections([{id:'tracker',enabled:true}]);
  f.list.update({overdue:[],today:f.tasks});assert.equal(f.panel.hidden,true);
 }finally{finish();f.list.destroy();}
});

test('both calendar sections retain keyboard, wheel scrolling and tooltip dismissal',()=>{
 const f=widget();
 try {
  for(const area of [(f.dock as any).taskArea,(f.dock as any).futureArea]){
   assert.equal(area.tabIndex,0);assert.equal(area.getAttribute('role'),'group');
   assert.ok(area.getAttribute('aria-labelledby'));
   area.scrollWidth=1000;area.clientWidth=100;area.scrollLeft=0;
   let prevented=false;
   const event={ctrlKey:false,metaKey:false,shiftKey:false,deltaX:0,deltaY:20,deltaMode:0,preventDefault(){prevented=true;}};
   for(const handler of area.handlers.get('wheel'))handler(event);
   assert.equal(area.scrollLeft,20);assert.equal(prevented,true);
   assert.equal(area.handlers.get('scroll').size,1);
  }
 }finally{f.dock.destroy();}
});

 test('Pinned and Modified share one list, preserve source order and hide independently', () => {
 const f=scopeListFixture();
 try {
  const scopes={overdue:[],today:[],pinned:f.tasks,modified:[...f.tasks].reverse()};
  f.list.update(scopes);
  const groups=Array.from(f.host.children).filter((el:any)=>['pinned','modified'].includes(el.dataset.statusDockSection)) as any[];
  assert.equal(groups.length,2);assert.ok(groups.every(el=>!el.hidden));
  f.list.toggle('pinned');assert.equal(f.panel.children.length,2);
  assert.equal(f.panel.children[0].querySelector('.operon-status-dock-name').textContent,'first');
  f.list.toggle('modified');assert.equal(f.panel.children.length,2);
  assert.equal(f.panel.children[0].querySelector('.operon-status-dock-name').textContent,'second');
  f.settings.statusDockSections=normalizeStatusDockSections(undefined).map(s=>s.id==='pinned'?{...s,enabled:false}:s);f.list.update(scopes);
  assert.equal(f.panel.hidden,false);assert.equal(groups[0].hidden,true);assert.equal(groups[1].hidden,false);
  f.list.update({...scopes,modified:[]});assert.equal(f.panel.hidden,true);assert.equal(groups[1].hidden,true);
 } finally {f.list.destroy();}
});

test('removed Pinned membership invalidates a pending timer even while another member remains',async()=>{
 let guard:(()=>boolean)|undefined,finish=()=>{};
 const f=scopeListFixture(async(_id,canCommit)=>{guard=canCommit;await new Promise<void>(resolve=>{finish=resolve;});});
 try {
  f.list.update({overdue:[],today:[],pinned:f.tasks});f.list.toggle('pinned');
  f.panel.querySelector('.operon-status-dock-scope-timer').click();await Promise.resolve();assert.equal(guard?.(),true);
  f.list.update({overdue:[],today:[],pinned:[f.tasks[1]]});assert.equal(guard?.(),false);assert.equal(f.panel.children.length,1);
 }finally{finish();await Promise.resolve();f.list.destroy();}
});

import {getRecentModifiedTasks,getTaskSearchBoxRecentModifiedCutoff} from '../src/ui/task-search-box-integration';
import {getPinnedTasksForDisplay} from '../src/core/pinned-task-query';

test('Modified includes terminal and both formats, uses canonical time fallback and deterministic ties',()=>{
 const date='2026-11-04T12:00:00Z',now=Date.parse(date),cutoff=getTaskSearchBoxRecentModifiedCutoff({...DEFAULT_SETTINGS,taskFinderRecentModifiedDays:3},now);
 const a=scopedTask('a',{datetimeModified:date},'done'),b=scopedTask('b',{datetimeModified:date},'cancelled');
 b.primary={...b.primary,format:'yaml'};a.description='same';b.description='same';
 const boundary={...task('boundary',''),datetimeModified:new Date(cutoff).toISOString()};
 const old={...task('old',''),datetimeModified:new Date(cutoff-1).toISOString()};
 assert.deepEqual(getRecentModifiedTasks([b,old,a,task('missing',''),boundary],cutoff).map(t=>t.operonId),['a','b','boundary']);
 assert.equal(getRecentModifiedTasks([boundary],cutoff+1).length,0);
});

test('Dock uses the real pinned query and invalidates only on relevant source changes',async()=>{
 const h=new SettingsPreservationHarness();const f=statusDockDocument();
 const storage=h.createStorage();await storage.initialize();
 const tasks=[scopedTask('a',{priority:'A'}),scopedTask('b',{priority:'B'})];
 let generation=1,reads=0;
 const indexer={getAllTasks:()=>{reads++;return tasks;},getTask:(id:string)=>tasks.find(t=>t.operonId===id),getGeneration:()=>generation};
 const settings=storage.getSettings();
 const dock=new OperonStatusDock({workspace:{containerEl:f.doc.body}} as unknown as App,{
 flowTimeControls,indexer,getSettings:()=>settings,getPinnedTasks:()=>getPinnedTasksForDisplay(indexer as never,storage.pinned,settings.priorities,settings.pinnedTaskSortMode),getPinnedGeneration:()=>storage.pinned.getGeneration(),
 timeTracker:{} as never,breakController:{} as never,toggleTaskTimer:async()=>true,startTimerForTask:async()=>true,openTask:async()=>{},createTrackerTask:async()=>null,pickTrackerTask:async()=>null,openConflicts:()=>{}});
 const scopes=()=> (dock as any).getTaskScopes();
 try {
  await storage.pinned.pin('a');await storage.pinned.pin('b');
  for(const mode of ['priority','lastModified','manual'] as const){settings.pinnedTaskSortMode=mode;assert.deepEqual(scopes().pinned,getPinnedTasksForDisplay(indexer as never,storage.pinned,settings.priorities,mode));}
  scopes();const before=reads;scopes();scopes();assert.equal(reads,before);
  await storage.pinned.unpin('a');assert.deepEqual(scopes().pinned.map((t:IndexedTask)=>t.operonId),['b']);
  await storage.pinned.replacePinnedIds(['a']);assert.deepEqual(scopes().pinned.map((t:IndexedTask)=>t.operonId),['a']);
  generation++;scopes();assert.ok(reads>before);
 }finally {dock.onunload();await h.dispose();}
});


function historySessions(task: IndexedTask): TrackerSession[] {
 return [1, 0, 2].map((sessionIndex, i) => ({task, operonId:task.operonId, sessionIndex,
 start:`${localToday()}T${i === 2 ? '09' : '10'}:00:00`, end:`${localToday()}T${i === 2 ? '09' : '10'}:01:00`, durationSeconds:60}));
}

test('History keeps repeated and equal-time sessions distinct, routes exact edits and replays without stopping',async()=>{
 const f=scopeListFixture(); const sessions=historySessions(f.tasks[0]);
 try {
  f.tracking.add('first'); f.list.update({overdue:[],today:[]},sessions); f.list.toggle('history');
  assert.equal(f.panel.children.length,3);
  const rows=Array.from(f.panel.children) as any[];
  assert.deepEqual(rows.map(row=>row.querySelector('.operon-status-dock-time').textContent),['1m 00s','1m 00s','1m 00s']);
  for(const row of rows){
   assert.ok(row.querySelector('.operon-status-dock-time').handlers.get('mouseenter')?.size);
   assert.equal(row.querySelector('.operon-status-dock-name').handlers.get('mouseenter')?.size ?? 0,0);
   assert.ok(row.querySelector('.operon-status-dock-name').getAttribute('aria-labelledby'));
   row.querySelector('.operon-status-dock-time').click();await new Promise(resolve=>setImmediate(resolve));
  }
  assert.deepEqual(f.calls,['edit:first:1','edit:first:0','edit:first:2']);f.calls.length=0;
  rows[0].querySelector('.operon-status-dock-scope-timer').click();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(f.calls,['replay:first']);assert.equal(f.tracking.has('first'),true);
  f.panel.scrollTop=42;f.list.update({overdue:[],today:[]},sessions.map(s=>({...s})));
  assert.equal(f.panel.children[0],rows[0]);assert.equal(f.panel.scrollTop,42);
  f.list.update({overdue:[],today:[]},[sessions[2],sessions[0],sessions[1]]);
  assert.equal(f.panel.children[0],rows[2]);
 }finally{f.list.destroy();}
});

for(const change of ['remove','index','disable','reorder','close','window','destroy','source'] as const) test(`History pending replay cancels on ${change}`,async()=>{
 let guard:(()=>boolean)|undefined,finish=()=>{};
 const f=scopeListFixture(undefined,undefined,async(_id,canCommit)=>{guard=canCommit;await new Promise<void>(resolve=>{finish=resolve;});if(canCommit())f.calls.push('written');});
 const sessions=historySessions(f.tasks[0]);
 try{
  f.list.update({overdue:[],today:[]},sessions);f.list.toggle('history');
  const old=f.panel.children[0];old.querySelector('.operon-status-dock-scope-timer').click();await Promise.resolve();assert.equal(guard?.(),true);
  if(change==='remove')f.list.update({overdue:[],today:[]},sessions.slice(1));
  if(change==='index')f.list.update({overdue:[],today:[]},sessions.map(s=>({...s,sessionIndex:s.sessionIndex+10})));
  if(change==='disable')f.settings.statusDockSections=normalizeStatusDockSections([{id:'history',enabled:false}]);
  if(change==='reorder')f.settings.statusDockSections=normalizeStatusDockSections([{id:'history',enabled:true}]);
  if(change==='close')f.list.close();
  if(change==='window')f.doc.defaultView.closed=true;
  if(change==='destroy')f.list.destroy();
  if(change==='source')f.tasks[0].fieldValues.trackers='changed session source';
  assert.equal(guard?.(),false);finish();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls.includes('written'),false);
 }finally{finish();f.list.destroy();}
});

test('History empty or disabled closes its list but preserves queued ten-second feedback',()=>{
 const f=scopeListFixture();const sessions=historySessions(f.tasks[0]);
 try{
  const group=Array.from(f.host.children).find((el:any)=>el.dataset.statusDockSection==='history') as any;
  assert.equal(group.hidden,true);f.list.update({overdue:[],today:[]},sessions);assert.equal(group.hidden,false);
  f.list.toggle('history');f.list.showSession(sessions[0]);assert.deepEqual(f.calls,[]);
  f.settings.statusDockSections=normalizeStatusDockSections([{id:'history',enabled:false}]);
  f.list.update({overdue:[],today:[]},sessions);assert.equal(group.hidden,true);assert.equal(f.panel.hidden,true);
  assert.deepEqual(f.calls,['session:first']);f.list.showSession(sessions[1]);assert.equal(f.calls.length,2);
 }finally{f.list.destroy();}
});

test('History cache expires at the local day boundary and preserves canonical source ordering',async(context)=>{
 const timers = (context as unknown as {mock:{timers:{enable(options:unknown):void;setTime(time:number):void;tick(time:number):void;reset():void}}}).mock.timers;
 timers.enable({apis:['Date'],now:new Date('2026-11-04T12:00:00').getTime()});
 const h=sessionTrackerHarness();try{
  await h.tracker.addSession('recorded','2026-11-04T10:00:00','2026-11-04T10:02:00');
  await h.tracker.addSession('recorded','2026-11-03T10:00:00','2026-11-03T10:01:00');
  const first=h.tracker.getHistory(2);assert.deepEqual(first.map(g=>g.date),['2026-11-04','2026-11-03']);
  assert.equal(h.tracker.getHistory(2),first);assert.equal(h.tracker.getHistory(1).length,1);
  timers.setTime(new Date('2026-11-05T12:00:00').getTime());
  assert.equal(h.tracker.getHistory(1).length,0);assert.deepEqual(h.tracker.getHistory(2).map(g=>g.date),['2026-11-04']);
 }finally{h.tracker.destroy();timers.reset();}
});

test('Dock History shares tracker order and caches across second ticks while invalidating source/settings/day',context=>{
 const timers = (context as unknown as {mock:{timers:{enable(options:unknown):void;setTime(time:number):void;tick(time:number):void;reset():void}}}).mock.timers;
 timers.enable({apis:['Date'],now:new Date('2026-11-04T12:00:00').getTime()});
 const f=statusDockDocument(),settings=structuredClone(DEFAULT_SETTINGS);let generation=1,reads=0;
 const sessions=historySessions(scopedTask('same',{}));
 const dock=new OperonStatusDock({workspace:{containerEl:f.doc.body}} as unknown as App,{
 flowTimeControls,indexer:{getAllTasks:()=>[],getTask:()=>undefined,getGeneration:()=>generation},getSettings:()=>settings,
 timeTracker:{getHistory:()=>{reads++;return [{sessions:sessions.slice(0,2)},{sessions:sessions.slice(2)}];}} as never,
 breakController:{} as never,toggleTaskTimer:async()=>true,startTimerForTask:async()=>true,openTask:async()=>{},createTrackerTask:async()=>null,pickTrackerTask:async()=>null,openConflicts:()=>{}});
 try{
  const read=()=> (dock as any).getHistorySnapshot();assert.deepEqual(read(),sessions);
  for(let i=0;i<60;i++){timers.tick(1000);read();}assert.equal(reads,1);
  generation++;read();assert.equal(reads,2);settings.trackerHistoryDays=365;read();assert.equal(reads,3);
  (dock as any).historyRevision++;read();assert.equal(reads,4);
  timers.setTime(new Date('2026-11-05T12:00:00').getTime());read();assert.equal(reads,5);
 }finally{dock.onunload();timers.reset();}
});


for(const format of ['inline','yaml'] as const) test(`History session edit/delete guard reaches the queued writer for ${format}`,async()=>{
 const h=sessionTrackerHarness();h.task().primary.format=format;
 let release=()=>{};
 try{
  await h.tracker.addSession('recorded','2026-11-04T10:00:00','2026-11-04T10:01:00');
  const session=h.tracker.getTaskSessions('recorded')[0],before=h.task().fieldValues.trackers;
  let valid=true;
  const blocked=h.tracker.runSerializedSessionMutation(()=>new Promise<void>(resolve=>{release=resolve;}));
  await Promise.resolve();
  const edit=h.tracker.updateSessionByRange('recorded',session.start,session.end,session.start,'2026-11-04T10:02:00',0,()=>valid);
  const deletion=h.tracker.deleteSessionByRange('recorded',session.start,session.end,0,()=>valid);
  valid=false;release();await blocked;assert.equal(await edit,false);assert.equal(await deletion,false);assert.equal(h.task().fieldValues.trackers,before);
  let checks=0;
  const denied=await h.tracker.updateSessionByRange('recorded',session.start,session.end,session.start,'2026-11-04T10:03:00',0,()=>++checks===1);
  assert.equal(denied,false);assert.equal(checks,2);assert.equal(h.task().fieldValues.trackers,before);
  assert.equal(await h.tracker.updateSessionByRange('recorded',session.start,session.end,session.start,'2026-11-04T10:02:00',0,()=>true),true);
  const changed=h.tracker.getTaskSessions('recorded')[0];assert.equal(changed.durationSeconds,120);
  assert.equal(await h.tracker.deleteSessionByRange('recorded',session.start,session.end,0,()=>true),false);
  assert.equal(h.tracker.getTaskSessions('recorded').length,1);
  assert.equal(await h.tracker.deleteSessionByRange('recorded',changed.start,changed.end,0,()=>true),true);assert.equal(h.tracker.getTaskSessions('recorded').length,0);
 }finally{release();h.tracker.destroy();}
});

test('History stale detached duration/name/icon callbacks cannot act after session removal',async()=>{
 const f=scopeListFixture();const sessions=historySessions(f.tasks[0]);
 try{
  f.list.update({overdue:[],today:[]},sessions);f.list.toggle('history');const row=f.panel.children[0];
  f.list.update({overdue:[],today:[]},sessions.slice(1));
  for(const selector of ['.operon-status-dock-time','.operon-status-dock-name','.operon-status-dock-session-icon'])row.querySelector(selector).click();
  await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(f.calls,[]);
 }finally{f.list.destroy();}
});

test('History editor keeps a source/lifecycle guard even if another identical range survives',async()=>{
 const f=scopeListFixture();const sessions=historySessions(f.tasks[0]);let guard:(()=>boolean)|undefined;
 (f.list as any).options.actions.openSession=async(_session:TrackerSession,canCommit:()=>boolean)=>{guard=canCommit;};
 try{
  f.tasks[0].fieldValues.trackers='two identical stored ranges';
  f.list.update({overdue:[],today:[]},sessions);f.list.toggle('history');f.panel.querySelector('.operon-status-dock-time').click();
  await new Promise(resolve=>setImmediate(resolve));assert.equal(guard?.(),true);
  f.tasks[0].fieldValues.trackers='one identical stored range';assert.equal(guard?.(),false);
  f.list.close();assert.equal(guard?.(),false);
 }finally{f.list.destroy();}
});


for (const distance of [0,3,4,20]) test(`Dock drag click classification at ${distance}px preserves subsequent clicks`,()=>{
 const f=widget(),grip=f.find('operon-status-dock-grip');
 const pointer={pointerId:7,button:0,isPrimary:true,clientX:30,clientY:30,preventDefault(){},stopPropagation(){}};
 let blocked=0;
 const click={pointerId:7,detail:1,preventDefault(){blocked++;},stopImmediatePropagation(){}};
 try{
  for(const handler of grip.handlers.get('pointerdown'))handler(pointer);
  f.emitWindow('pointermove',{...pointer,clientX:30+distance});
  f.emitWindow('pointerup',{...pointer,type:'pointerup'});
  f.emitWindow('click',click);assert.equal(blocked,distance>=4?1:0);
  f.emitWindow('pointerdown',pointer);f.emitWindow('click',click);assert.equal(blocked,distance>=4?1:0);
 }finally{f.dock.destroy();}
 for(const event of ['click','pointerdown','pointermove','pointerup','pointercancel','blur','keydown'])assert.equal(f.windowListeners.get(event)?.size??0,0);
});

for(const end of ['pointercancel','blur','hide','destroy','escape','new-pointer'] as const) test(`Dock drag suppression cleanup: ${end}`,()=>{
 const f=widget(),other=widget(),grip=f.find('operon-status-dock-grip');let blocked=0;
 const pointer={pointerId:7,button:0,isPrimary:true,clientX:30,clientY:30,preventDefault(){},stopPropagation(){}};
 try{
  for(const handler of grip.handlers.get('pointerdown'))handler(pointer);
  f.emitWindow('pointermove',{...pointer,clientX:40});
  const click={pointerId:7,detail:1,preventDefault(){blocked++;},stopImmediatePropagation(){}};
  other.emitWindow('click',click);assert.equal(blocked,0);
  if(end==='escape'){
   f.emitWindow('keydown',{key:'Escape',preventDefault(){},stopPropagation(){}});
   assert.equal((f.dock as any).position,null);f.emitWindow('click',click);assert.equal(blocked,1);
  }else{
   if(end==='pointercancel')f.emitWindow('pointercancel',{...pointer,type:'pointercancel'});
   if(end==='blur')f.emitWindow('blur',{});
   if(end==='hide')f.dock.setVisible(false);
   if(end==='destroy')f.dock.destroy();
   if(end==='new-pointer'){f.emitWindow('pointerup',{...pointer,type:'pointerup'});f.emitWindow('pointerdown',{...pointer,pointerId:8});}
   f.emitWindow('click',click);assert.equal(blocked,0);
  }
 }finally{f.dock.destroy();other.dock.destroy();}
});


for(const distance of [0,3]) test(`Escape at ${distance}px preserves the list instead of generating a normal click`,()=>{
 const f=widget(),grip=f.find('operon-status-dock-grip');let blocked=0;
 const pointer={pointerId:9,button:0,isPrimary:true,clientX:20,clientY:20,preventDefault(){},stopPropagation(){}};
 try{
  for(const handler of grip.handlers.get('pointerdown'))handler(pointer);
  f.emitWindow('pointermove',{...pointer,clientX:20+distance});
  f.emitWindow('keydown',{key:'Escape',preventDefault(){},stopPropagation(){}});
  f.emitWindow('pointerup',{...pointer,type:'pointerup'});
  f.emitWindow('click',{pointerId:9,detail:1,preventDefault(){blocked++;},stopImmediatePropagation(){}});
  assert.equal(blocked,1);assert.equal((f.dock as any).position,null);
  f.emitWindow('pointerdown',pointer);f.emitWindow('click',{pointerId:9,detail:1,preventDefault(){blocked++;},stopImmediatePropagation(){}});assert.equal(blocked,1);
 }finally{f.dock.destroy();}
});
