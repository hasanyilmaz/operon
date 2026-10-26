import assert from 'node:assert/strict';
import { FlowTimeBreakController, canSelectFlowTimeTask } from '../src/systems/flow-time-break';
import { TimeTracker } from '../src/systems/time-tracker';
import type { ActiveTrackerStoreLike } from '../src/storage/active-tracker-store';
import type { ActiveTrackerRecord } from '../src/types/tracker';
import { localNow } from '../src/core/local-time';
import { parseTrackerList } from '../src/systems/tracker-utils';
import type { TimeTrackerEvent } from '../src/systems/time-tracker';
import type { ActiveTrackerState, TimeTrackerTransitionState } from '../src/types/tracker';
import type { IndexedTask } from '../src/types/fields';
import { DEFAULT_SETTINGS } from '../src/types/settings';
import type { FlowTimeRenderedState } from '../src/systems/flow-time-optimistic';
import { FlowTimeView } from '../src/ui/flow-time-view';
import { WorkspaceLeaf } from 'obsidian';
import { statusDockDocument } from './test-support/status-dock-dom';

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>(done => { resolve = done; });
	return { promise, resolve };
}

function harness() {
	const task = { operonId: 'task-a', description: 'Focus task', fieldValues: {}, checkbox: 'open' } as IndexedTask;
	const tasks = new Map([[task.operonId, task]]);
	const state: { active: ActiveTrackerState | null; transition: TimeTrackerTransitionState | null } = {
		active: { operonId: task.operonId, start: '2026-10-24T10:00:00', task, elapsedSeconds: 90, isUnassigned: false },
		transition: null,
	};
	const settings = { ...DEFAULT_SETTINGS, flowTimeMode: 'flowtime' as typeof DEFAULT_SETTINGS.flowTimeMode, flowTimePauseMinutes: 1, flowTimeSessionMinutes: 25,
		flowTimeDefaultSessionMinutes: 25, flowTimeUseLastSelectedDuration: false,
		flowTimePlayReminderSoundOnTargetReached: true };
	const listeners = new Set<(event: TimeTrackerEvent) => void>();
	const emit = (event: TimeTrackerEvent) => { for (const listener of listeners) listener(event); };
	const timers = new Set<() => void>();
	const calls = { stop: 0, start: 0, save: 0, sound: 0, sessions: [] as string[] };
	const behavior = { stopOk: true, startOk: true, stopError: false, startError: false, saveError: false,
		stopGate: null as ReturnType<typeof deferred> | null, startGate: null as ReturnType<typeof deferred> | null };
	let now = 1000;
	const timeTracker = {
		getActiveState: () => state.active,
		getTransitionState: () => state.transition,
		subscribe: (listener: (event: TimeTrackerEvent) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
	};
	const dependencies: ConstructorParameters<typeof FlowTimeBreakController>[0] = {
		timeTracker,
		getTask: id => tasks.get(id),
		getSettings: () => settings,
		saveSettings: async () => { calls.save += 1; if (behavior.saveError) throw new Error('settings failed'); },
		stopActiveTimer: async canCommit => {
			calls.stop += 1;
			const active = state.active;
			if (!active || !canCommit()) return false;
			state.transition = { kind: 'stopping', taskId: active.operonId, start: active.start, source: 'flowtime', startedAtMs: now };
			emit('transition');
			try {
				if (behavior.stopGate) await behavior.stopGate.promise;
				if (behavior.stopError) throw new Error('session failed');
				if (!behavior.stopOk || !canCommit()) return false;
				calls.sessions.push(active.operonId ?? 'unassigned');
				state.active = null;
				state.transition = null;
				emit('state');
				return true;
			} finally { state.transition = null; emit('transition'); }
		},
		startTimerForTask: async (taskId, source, canCommit) => {
			calls.start += 1;
			if (behavior.startGate) await behavior.startGate.promise;
			if (behavior.startError) throw new Error('start failed');
			if (!behavior.startOk || !canCommit() || !tasks.has(taskId)) return false;
			const previousActive = state.active;
			state.active = { operonId: taskId, start: previousActive?.operonId === null ? previousActive.start : `new-${now}`, task: tasks.get(taskId)!, elapsedSeconds: 0, isUnassigned: false };
			state.transition = { kind: 'starting', taskId, start: state.active.start, source, startedAtMs: now, previousActive };
			emit('transition');
			// TimeTracker checks the same guard again after allocating its active record.
			if (!canCommit()) { state.active = previousActive; state.transition = null; emit('state'); return false; }
			state.transition = null;
			emit('state');
			return true;
		},
		playReminderSound: async () => { calls.sound += 1; },
		scheduleTick: callback => { timers.add(callback); return () => { timers.delete(callback); }; },
		now: () => now,
	};
	const controller = new FlowTimeBreakController(dependencies);
	const advance = (seconds: number) => { now += seconds * 1000; for (const tick of [...timers]) tick(); };
	return { controller, dependencies, task, tasks, state, settings, timeTracker, calls, behavior, timers, listeners, emit, advance };
}

const cases: Array<[string, () => Promise<void> | void]> = [];
function test(name: string, run: () => Promise<void> | void): void { cases.push([name, run]); }

test('coffee records the session before creating a shared break without opening a view', async () => {
	const h = harness();
	assert.equal(await h.controller.startBreak(), true);
	assert.deepEqual(h.calls.sessions, [h.task.operonId]);
	assert.equal(h.state.active, null);
	assert.equal(h.controller.getSnapshot().pendingTaskId, h.task.operonId);
	assert.equal(h.controller.getSnapshot().breakState?.targetSeconds, 60);
	assert.equal(h.timers.size, 1);
	h.advance(12);
	assert.equal(h.controller.getElapsedSeconds(), 12);
	h.controller.destroy();
});

test('false stop and throwing stop preserve active work and create no break', async () => {
	for (const throws of [false, true]) {
		const h = harness(); h.behavior.stopOk = false; h.behavior.stopError = throws;
		if (throws) await assert.rejects(h.controller.startBreak(), /session failed/);
		else assert.equal(await h.controller.startBreak(), false);
		assert.equal(h.state.active?.operonId, h.task.operonId);
		assert.equal(h.controller.getSnapshot().breakState, null);
		assert.equal(h.controller.getSnapshot().pendingTaskId, null);
		assert.equal(h.controller.getSnapshot().actionPending, false);
		assert.deepEqual(h.calls.sessions, []);
		assert.equal(h.timers.size, 0); h.controller.destroy();
	}
});

test('double coffee from two windows is one action and cannot immediately end the break', async () => {
	const h = harness(); const gate = deferred(); h.behavior.stopGate = gate;
	const first = h.controller.toggleBreak(); const second = h.controller.toggleBreak();
	assert.equal(first, second); await Promise.resolve();
	assert.equal(h.calls.stop, 1);
	assert.equal(await h.controller.resumePending(), false);
	assert.equal(h.controller.endBreak(), false);
	gate.resolve(); assert.equal(await first, true);
	assert.equal(h.calls.sessions.length, 1);
	assert.ok(h.controller.getSnapshot().breakState); h.controller.destroy();
});

test('ending a break retains its task; Play starts a new session for that task', async () => {
	const h = harness(); await h.controller.startBreak();
	assert.equal(await h.controller.toggleBreak(), true);
	assert.equal(h.controller.getSnapshot().breakState, null);
	assert.equal(h.controller.getSnapshot().pendingTaskId, h.task.operonId);
	assert.equal(h.timers.size, 0);
	assert.equal(h.calls.start, 0);
	assert.equal(await h.controller.resumePending('status-bar'), true);
	assert.equal(h.state.active?.operonId, h.task.operonId);
	assert.equal(h.state.active?.elapsedSeconds, 0);
	assert.equal(h.controller.getSnapshot().pendingTaskId, null);
	assert.equal(h.calls.sessions.length, 1); h.controller.destroy();
});

test('Play resumes directly from a live break and duplicate Play cannot create two sessions', async () => {
	const h = harness(); await h.controller.startBreak();
	const gate = deferred(); h.behavior.startGate = gate;
	const first = h.controller.resumePending(); const second = h.controller.resumePending();
	assert.equal(first, second); await Promise.resolve();
	assert.equal(h.calls.start, 1);
	assert.equal(await h.controller.toggleBreak(), false);
	gate.resolve(); assert.equal(await first, true);
	assert.equal(h.controller.getSnapshot().breakState, null);
	assert.equal(h.timers.size, 0); h.controller.destroy();
});

test('failed or throwing resume retains the original break and waiting task for retry', async () => {
	for (const throws of [false, true]) {
		const h = harness(); await h.controller.startBreak(); const snapshot = h.controller.getSnapshot();
		h.behavior.startOk = false; h.behavior.startError = throws;
		if (throws) await assert.rejects(h.controller.resumePending(), /start failed/);
		else assert.equal(await h.controller.resumePending(), false);
		assert.deepEqual(h.controller.getSnapshot(), snapshot);
		h.behavior.startOk = true; h.behavior.startError = false;
		assert.equal(await h.controller.resumePending(), true); h.controller.destroy();
	}
});

test('idle, unassigned and already-transitioning trackers cannot start a break', async () => {
	const h = harness(); const active = h.state.active!;
	h.state.active = null; assert.equal(await h.controller.startBreak(), false);
	h.state.active = { ...active, operonId: null, task: null, isUnassigned: true };
	assert.equal(await h.controller.startBreak(), false);
	h.state.active = active; h.state.transition = { kind: 'starting', taskId: active.operonId, start: active.start, source: 'flowtime', startedAtMs: 1 };
	assert.equal(await h.controller.startBreak(), false);
	assert.equal(h.calls.stop, 0); h.controller.destroy();
});

test('a task switched before the action runs is never stopped by a stale coffee click', async () => {
	const h = harness(); const pending = h.controller.startBreak();
	h.state.active = { ...h.state.active!, operonId: 'task-b' }; h.emit('state');
	assert.equal(await pending, false); assert.equal(h.calls.stop, 0); h.controller.destroy();
});

test('an external start during stop cannot be replaced with a stale break', async () => {
	const h = harness(); const gate = deferred(); h.behavior.stopGate = gate;
	const pending = h.controller.startBreak(); await Promise.resolve();
	h.state.active = { ...h.state.active!, operonId: 'task-b' }; h.emit('state');
	gate.resolve(); assert.equal(await pending, false);
	assert.equal(h.state.active?.operonId, 'task-b');
	assert.equal(h.controller.getSnapshot().breakState, null); h.controller.destroy();
});

test('another surface starting work clears the shared break and stops its ticker', async () => {
	const h = harness(); await h.controller.startBreak();
	h.state.active = { operonId: 'task-b', start: 'external', task: null, elapsedSeconds: 0, isUnassigned: false };
	h.emit('state');
	assert.equal(h.controller.getSnapshot().pendingTaskId, null);
	assert.equal(h.controller.getSnapshot().breakState, null);
	assert.equal(h.timers.size, 0); h.controller.destroy();
});

test('external work during a pending resume wins without being stopped or replaced', async () => {
	const h = harness(); await h.controller.startBreak(); const gate = deferred(); h.behavior.startGate = gate;
	const pending = h.controller.resumePending(); await Promise.resolve();
	h.state.active = { operonId: 'task-b', start: 'external', task: null, elapsedSeconds: 0, isUnassigned: false }; h.emit('state');
	gate.resolve(); assert.equal(await pending, false);
	assert.equal(h.state.active?.operonId, 'task-b'); h.controller.destroy();
});

test('missing pending tasks clear safely without falling back to an unassigned timer', async () => {
	const h = harness(); await h.controller.startBreak(); h.tasks.clear();
	assert.equal(await h.controller.resumePending(), false);
	assert.equal(h.controller.getSnapshot().pendingTaskId, null);
	assert.equal(h.calls.start, 0); assert.equal(h.timers.size, 0); h.controller.destroy();
});

test('task deletion during a break clears its task and ticker on the next tick', async () => {
	const h = harness(); await h.controller.startBreak(); h.tasks.clear(); h.advance(1);
	assert.equal(h.controller.getSnapshot().breakState, null);
	assert.equal(h.controller.getSnapshot().pendingTaskId, null); assert.equal(h.timers.size, 0); h.controller.destroy();
});

test('sound is delivered once with multiple subscribers and without any open view', async () => {
	const h = harness(); let firstTicks = 0; let secondTicks = 0;
	const closeFirst = h.controller.subscribe(event => { if (event === 'tick') firstTicks++; });
	h.controller.subscribe(event => { if (event === 'tick') secondTicks++; });
	await h.controller.startBreak(); h.advance(59); assert.equal(h.calls.sound, 0);
	closeFirst(); h.advance(1); h.advance(10);
	assert.equal(firstTicks, 1); assert.equal(secondTicks, 3); assert.equal(h.calls.sound, 1); h.controller.destroy();
});

test('enabling sound or changing mode after zero never replays a missed boundary', async () => {
	const h = harness(); h.settings.flowTimePlayReminderSoundOnTargetReached = false;
	await h.controller.startBreak(); h.advance(60); h.settings.flowTimePlayReminderSoundOnTargetReached = true;
	h.advance(1); h.settings.flowTimeMode = 'tracktime'; h.advance(1);
	assert.equal(h.calls.sound, 0); h.controller.destroy();
});

test('resume applies the existing default-duration rule only on user action', async () => {
	const h = harness(); h.settings.flowTimeSessionMinutes = 12;
	assert.equal(h.calls.save, 0); await h.controller.startBreak(); assert.equal(h.calls.save, 0);
	assert.equal(await h.controller.resumePending(), true);
	assert.equal(h.settings.flowTimeSessionMinutes, 25); assert.equal(h.calls.save, 1); h.controller.destroy();
});

test('failed duration save leaves the break retryable and restores the prior preference', async () => {
	const h = harness(); h.settings.flowTimeSessionMinutes = 12; await h.controller.startBreak();
	h.behavior.saveError = true; await assert.rejects(h.controller.resumePending(), /settings failed/);
	assert.equal(h.settings.flowTimeSessionMinutes, 12); assert.ok(h.controller.getSnapshot().breakState);
	assert.equal(h.calls.start, 0); h.controller.destroy();
});

test('use-last-selected and TrackTime preserve the selected duration', async () => {
	for (const useLast of [false, true]) {
		const h = harness(); h.settings.flowTimeSessionMinutes = 12;
		h.settings.flowTimeUseLastSelectedDuration = useLast;
		if (!useLast) h.settings.flowTimeMode = 'tracktime';
		await h.controller.startBreak(); assert.equal(await h.controller.resumePending(), true);
		assert.equal(h.settings.flowTimeSessionMinutes, 12); assert.equal(h.calls.save, 0); h.controller.destroy();
	}
});

test('destroy and reload clear only ephemeral state, preserving the recorded session', async () => {
	const h = harness(); await h.controller.startBreak(); h.controller.destroy();
	assert.equal(h.listeners.size, 0); assert.equal(h.timers.size, 0);
	assert.deepEqual(h.calls.sessions, [h.task.operonId]);
	const reloaded = new FlowTimeBreakController(h.dependencies);
	assert.deepEqual(reloaded.getSnapshot(), { breakState: null, pendingTaskId: null, actionPending: false });
	assert.equal(await h.controller.startBreak(), false); reloaded.destroy();
});

test('destroy during a pending stop cannot resurrect a break or schedule a ticker', async () => {
	const h = harness(); const gate = deferred(); h.behavior.stopGate = gate;
	const pending = h.controller.startBreak(); await Promise.resolve(); h.controller.destroy(); gate.resolve();
	assert.equal(await pending, false); assert.equal(h.timers.size, 0); assert.equal(h.controller.getSnapshot().breakState, null);
});

test('FlowTime views share a controller and closing a view does not end its break', async () => {
	const h = harness(); let renders = 0;
	const createView = () => {
		const view = new FlowTimeView(new WorkspaceLeaf(), { getGeneration: () => 0, getTask: (id: string) => h.tasks.get(id) } as never,
			h.timeTracker as never, {} as never, h.controller);
		view.contentEl = statusDockDocument().doc.body;
		view.render = () => { renders++; };
		return view;
	};
	const first = createView(); const second = createView(); await first.onOpen(); await second.onOpen();
	await h.controller.startBreak(); assert.ok(renders >= 4);
	const readState = (view: FlowTimeView) => (view as unknown as { getRenderedState(): FlowTimeRenderedState }).getRenderedState();
	assert.equal(readState(first).task?.operonId, h.task.operonId);
	assert.equal(readState(second).task?.operonId, h.task.operonId);
	await first.onClose(); assert.ok(h.controller.getSnapshot().breakState);
	assert.equal(h.timers.size, 1); await second.onClose();
	assert.ok(h.controller.getSnapshot().breakState); h.advance(60); assert.equal(h.calls.sound, 1);
	const reopened = createView(); await reopened.onOpen();
	assert.equal(readState(reopened).task?.operonId, h.task.operonId); await reopened.onClose();
	assert.equal(await h.controller.resumePending(), true); h.controller.destroy();
});

test('shared break wins over another view local selection and pending quick-create draft', async () => {
	const h = harness();
	const other = { ...h.task, operonId: 'local-selection' }; h.tasks.set(other.operonId, other);
	const view = new FlowTimeView(new WorkspaceLeaf(), { getTask: (id: string) => h.tasks.get(id) } as never,
		h.timeTracker as never, {} as never, h.controller);
	const local = view as unknown as { pendingTaskId: string; pendingDraft: { description: string; start: string; startedAtMs: number }; getRenderedState(): FlowTimeRenderedState };
	local.pendingTaskId = other.operonId;
	local.pendingDraft = { description: 'Unfinished local draft', start: localNow(), startedAtMs: Date.now() };
	await h.controller.startBreak();
	assert.equal(local.getRenderedState().task?.operonId, h.task.operonId);
	assert.equal(local.getRenderedState().active, null);
	assert.equal(local.pendingDraft.description, 'Unfinished local draft');
	h.controller.endBreak();
	assert.equal(local.getRenderedState().task?.operonId, h.task.operonId);
	assert.equal(local.getRenderedState().active, null); h.controller.destroy();
});

for (const route of ['resume', 'selection', 'unassigned', 'duplicate'] as const) test(`real TimeTracker preserves original start and repeated guards: ${route}`, async () => {
	const unassigned = route === 'unassigned' || route === 'duplicate';
	const h = harness(); h.controller.destroy();
	h.task.primary = { filePath: 'Focus.md', format: 'yaml', lineNumber: 0 };
	let record: ActiveTrackerRecord | null = { id: 'original', userId: '', userName: '', taskId: unassigned ? null : h.task.operonId,
		start: localNow(), source: 'flowtime', createdAt: localNow(), updatedAt: localNow() };
	const store: ActiveTrackerStoreLike = {
		load: async () => {}, getActiveForUser: () => record, getAll: () => record ? [record] : [],
		setActiveForUser: async (next, canCommit) => {
			if (canCommit && !canCommit()) throw new Error('stale start');
			record = { id: 'resumed', userId: '', userName: '', createdAt: next.start, updatedAt: next.start, ...next };
			return record;
		},
		clearActiveForUser: async (_user, canCommit) => { if (canCommit && !canCommit()) throw new Error('stale stop'); record = null; },
		getGeneration: () => 0, drain: async () => {}, subscribe: () => () => {},
	};
	const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'activeWindow');
	Object.defineProperty(globalThis, 'activeWindow', { configurable: true, value: { setInterval: () => 1, clearInterval: () => {} } });
	const writes: Array<Record<string, string>> = [];
	const tracker = new TimeTracker({} as never,
		{ getTask: (id: string) => h.tasks.get(id), hasDuplicateOperonIdConflict: () => route === 'duplicate', reindexFilePath: async () => {} } as never,
		{ writeTaskFields: async (_id: string, payload: Record<string, string>, options: { canCommit?: () => boolean }) => {
			if (options.canCommit && !options.canCommit()) return false;
			writes.push(payload); Object.assign(h.task.fieldValues, payload); return true;
		} } as never, store, () => h.settings, undefined, async () => {});
	const controller = new FlowTimeBreakController({ ...h.dependencies, timeTracker: tracker,
		stopActiveTimer: canCommit => tracker.stop('manual', undefined, canCommit),
		startTimerForTask: (id, source, canCommit) => tracker.start(id, source, undefined, undefined, canCommit),
	});
	try {
		if (unassigned) {
			const original = tracker.getActiveState()!.start;
			assert.equal(await controller.selectPendingTask(async () => h.task.operonId, 'flowtime'), route !== 'duplicate');
			assert.equal(tracker.getActiveState()?.operonId, route === 'duplicate' ? null : h.task.operonId);
			assert.equal(tracker.getActiveState()?.start, original);
			if (route === 'duplicate') assert.equal(writes.length, 0);
			assert.equal(writes.filter(payload => 'trackers' in payload).length, 0);
			return;
		}
		assert.equal(await controller.startBreak(), true);
		assert.equal(tracker.getActiveState(), null);
		assert.equal(writes.filter(payload => 'trackers' in payload).length, 1);
		assert.equal(parseTrackerList(h.task.fieldValues.trackers).length, 1);
		assert.equal(await (route === 'selection' ? controller.selectPendingTask(async () => h.task.operonId, 'flowtime') : controller.resumePending()), true);
		assert.equal(tracker.getActiveState()?.operonId, h.task.operonId);
		assert.equal(controller.getSnapshot().pendingTaskId, null);
		assert.equal(writes.filter(payload => 'trackers' in payload).length, 1);
	} finally {
		controller.destroy(); tracker.destroy();
		if (previousWindow) Object.defineProperty(globalThis, 'activeWindow', previousWindow);
		else Reflect.deleteProperty(globalThis, 'activeWindow');
	}
});


test('stopped-timer predicate and FlowTime icon distinguish selection from work and breaks', async () => {
	const h = harness(), f = statusDockDocument();
	const view = new FlowTimeView(new WorkspaceLeaf(), {} as never, h.timeTracker as never, {} as never, h.controller);
	const globals = globalThis as typeof globalThis & { __operonTestSetIcon?: (target: HTMLElement, icon: string) => void };
	const previous = globals.__operonTestSetIcon; globals.__operonTestSetIcon = (target, icon) => { target.dataset.icon = icon; };
	let choices = 0; (view as any).selectWaitingTask = async () => { choices++; };
	const button = () => { const host = f.doc.body.createDiv(); (view as any).renderBreakButton(host, h.state.active); return host.children[0].children[0] as any; };
	try {
		assert.equal(button().dataset.icon, 'coffee'); await h.controller.startBreak(); assert.equal(button().dataset.icon, 'coffee');
		h.controller.endBreak(); const waiting = button(); assert.equal(waiting.dataset.icon, 'scan-search'); assert.equal(waiting.disabled, false);
		waiting.click(); await Promise.resolve(); assert.equal(choices, 1);
		assert.equal(canSelectFlowTimeTask(h.state.active, h.controller.getSnapshot()), true);
		await h.controller.resumePending(); assert.equal(button().dataset.icon, 'coffee');
		h.state.active = null; const idle = button(); assert.equal(idle.dataset.icon, 'scan-search'); assert.equal(idle.disabled, false);
		const host = f.doc.body.createDiv(); h.state.active = { operonId: null, task: null, start: 'original', elapsedSeconds: 10, isUnassigned: true };
		(view as any).renderBreakButton(host, h.state.active);
		assert.deepEqual(host.children[0].children.filter((el: any) => el.tagName === 'BUTTON').map((el: any) => el.dataset.icon), ['scan-search', 'list-plus']);
		let create = false; (view as any).selectWaitingTask = async (value: boolean) => { create = value; };
		host.children[0].children[2].click(); await Promise.resolve(); assert.equal(create, true);
	} finally { globals.__operonTestSetIcon = previous; h.controller.destroy(); }
});

test('Cancel and picker errors perform zero writes and retain the waiting task', async () => {
	const h = harness(); await h.controller.startBreak(); h.controller.endBreak(); const before = h.controller.getSnapshot();
	assert.equal(await h.controller.selectPendingTask(async () => null, 'flowtime'), false);
	await assert.rejects(h.controller.selectPendingTask(async () => { throw new Error('finder failed'); }, 'status-bar'), /finder failed/);
	assert.deepEqual(h.controller.getSnapshot(), before); assert.equal(h.calls.start, 0); assert.equal(h.calls.save, 0); h.controller.destroy();
});

test('selection starts a different task through the existing guarded provisional start', async () => {
	const h = harness(); const other = { ...h.task, operonId: 'task-b' }; h.tasks.set(other.operonId, other);
	await h.controller.startBreak(); h.controller.endBreak();
	assert.equal(await h.controller.selectPendingTask(async () => other.operonId, 'status-bar'), true);
	assert.equal(h.state.active?.operonId, other.operonId); assert.equal(h.controller.getSnapshot().pendingTaskId, null);
	assert.equal(h.calls.start, 1); assert.deepEqual(h.calls.sessions, [h.task.operonId]); h.controller.destroy();
});

for (const failure of ['false', 'throw', 'missing'] as const) test(`selection ${failure} preserves the original waiting task`, async () => {
	const h = harness(); h.tasks.set('task-b', { ...h.task, operonId: 'task-b' });
	await h.controller.startBreak(); h.controller.endBreak();
	if (failure === 'false') h.behavior.startOk = false;
	if (failure === 'throw') h.behavior.startError = true;
	if (failure === 'missing') h.tasks.delete('task-b');
	const result = h.controller.selectPendingTask(async () => 'task-b', 'flowtime');
	if (failure === 'throw') await assert.rejects(result, /start failed/); else assert.equal(await result, false);
	assert.equal(h.controller.getSnapshot().pendingTaskId, h.task.operonId); assert.equal(h.controller.getSnapshot().breakState, null);
	assert.equal(h.state.active, null); assert.equal(h.controller.getSnapshot().actionPending, false); h.controller.destroy();
});

for (const activeBreak of [false, true]) test(`one shared picker blocks a second surface and rejects results after external work starts: break=${activeBreak}`, async () => {
	const h = harness(), gate = deferred(); let picks = 0;
	await h.controller.startBreak(); if (!activeBreak) h.controller.endBreak();
	const choose = () => { picks++; return gate.promise.then(() => h.task.operonId); };
	const first = h.controller.selectPendingTask(choose, 'flowtime'), second = h.controller.selectPendingTask(choose, 'status-bar');
	assert.equal(await h.controller.resumePending(), false); await Promise.resolve(); assert.equal(picks, 1);
	const external = { operonId: 'external', start: 'newer', task: h.task, elapsedSeconds: 0, isUnassigned: false };
	h.state.active = external; h.emit('state'); gate.resolve();
	assert.deepEqual(await Promise.all([first, second]), [false, false]); assert.equal(h.state.active, external); assert.equal(h.calls.start, 0); h.controller.destroy();
});

test('Cancel and closed owner preserve an active break', async () => {
	const h = harness(); await h.controller.startBreak(); let picks = 0;
	assert.equal(await h.controller.selectPendingTask(async () => { picks++; return null; }, 'flowtime'), false); assert.equal(picks, 1);
	h.controller.endBreak(); const gate = deferred(); let alive = true;
	const selecting = h.controller.selectPendingTask(async () => { await gate.promise; return h.task.operonId; }, 'flowtime', () => alive);
	await Promise.resolve(); alive = false; gate.resolve(); assert.equal(await selecting, false);
	assert.equal(h.calls.start, 0); assert.equal(h.controller.getSnapshot().pendingTaskId, h.task.operonId); h.controller.destroy();
});

test('FlowTime waiting selection guards close/reopen and preserves local state on Cancel', async () => {
	const h = harness(); await h.controller.startBreak(); h.controller.endBreak();
	const view = new FlowTimeView(new WorkspaceLeaf(), {} as never, h.timeTracker as never, {} as never, h.controller) as any;
	view.unsubscribeBreak = () => {}; view.contentEl = { isConnected: true }; view.pendingTaskId = 'local'; view.pendingDraft = { description: 'draft' };
	const original = h.controller.selectPendingTask.bind(h.controller); let guard!: () => boolean;
	h.controller.selectPendingTask = async (_pick, source, canUse) => { assert.equal(source, 'flowtime'); guard = canUse!; assert.equal(guard(), true); return false; };
	await view.selectWaitingTask(); assert.equal(view.pendingTaskId, 'local'); assert.equal(view.pendingDraft.description, 'draft');
	view.unsubscribeBreak = null; assert.equal(guard(), false); view.unsubscribeBreak = () => {}; assert.equal(guard(), false);
	h.controller.selectPendingTask = original; h.controller.destroy();
});


test('existing FlowTime task tile shares the waiting-task selection route and cannot bypass its lock', async () => {
	const h = harness(); await h.controller.startBreak(); h.controller.endBreak();
	const view = new FlowTimeView(new WorkspaceLeaf(), {} as never, h.timeTracker as never, {} as never, h.controller) as any;
	let picks = 0; view.selectWaitingTask = async () => { picks++; };
	await view.selectTask(); assert.equal(picks, 1);
	const gate = deferred(), selecting = h.controller.selectPendingTask(async () => { await gate.promise; return null; }, 'flowtime');
	await view.selectTask(); assert.equal(picks, 1); gate.resolve(); await selecting; h.controller.destroy();
});


test('idle selection supports Cancel then a guarded task start without a previous break', async () => {
	const h = harness(); h.state.active = null;
	assert.equal(await h.controller.selectPendingTask(async () => null, 'flowtime'), false);
	assert.equal(h.calls.start, 0); assert.equal(h.calls.save, 0); assert.equal(h.controller.getSnapshot().pendingTaskId, null);
	assert.equal(await h.controller.selectPendingTask(async () => h.task.operonId, 'flowtime'), true);
	assert.equal(h.timeTracker.getActiveState()?.operonId, h.task.operonId); assert.equal(h.calls.start, 1); assert.deepEqual(h.calls.sessions, []);
	h.controller.destroy();
});


test('closing FlowTime cleans up Finder tooltip bindings', async () => {
	const h = harness(), f = statusDockDocument(); h.state.active = null;
	const view = new FlowTimeView(new WorkspaceLeaf(), {} as never, h.timeTracker as never, {} as never, h.controller) as any;
	view.contentEl = f.doc.body.createDiv(); view.renderBreakButton(view.contentEl, null);
	const button = view.contentEl.children[0].children[0]; assert.equal(typeof button._operonHoverCleanup, 'function');
	await view.onClose(); assert.equal(button._operonHoverCleanup, undefined);
	assert.equal(button.handlers.get('mouseenter')?.size ?? 0, 0); h.controller.destroy();
});


for (const outcome of ['success', 'cancel', 'false', 'throw', 'stop', 'replace'] as const) test(`unassigned selection ${outcome} preserves the original session or rejects stale results`, async () => {
 const h = harness(); const original = { operonId: null, task: null, start: 'original', elapsedSeconds: 2460, isUnassigned: true };
 h.state.active = original;
 try {
  const selected = await h.controller.selectPendingTask(async () => {
   if (outcome === 'stop') { h.state.active = null; h.emit('state'); }
   if (outcome === 'replace') { h.state.active = { ...original, start: 'different' }; h.emit('state'); }
   if (outcome === 'false') h.behavior.startOk = false;
   if (outcome === 'throw') h.behavior.startError = true;
   return outcome === 'cancel' ? null : h.task.operonId;
  }, 'flowtime').catch(error => { if (outcome !== 'throw') throw error; return false; });
  assert.equal(selected, outcome === 'success'); assert.equal(h.calls.stop, 0); assert.equal(h.calls.sessions.length, 0);
  if (outcome === 'success') { assert.equal(h.state.active?.operonId, h.task.operonId); assert.equal(h.state.active?.start, original.start); }
  else if (!['stop', 'replace'].includes(outcome)) assert.equal(h.state.active, original);
 } finally { h.controller.destroy(); }
});


for (const outcome of ['success', 'cancel', 'pick-error', 'start-false', 'start-error', 'missing', 'settings-error', 'closed', 'external'] as const) test(`active break selection ${outcome} is transactional`, async () => {
 const h = harness(); const other = { ...h.task, operonId: 'other' }; h.tasks.set(other.operonId, other);
 await h.controller.startBreak(); const before = h.controller.getSnapshot().breakState; let alive = true;
 try {
  const result = await h.controller.selectPendingTask(async () => {
   if (outcome === 'pick-error') throw new Error('picker failed');
   if (outcome === 'start-false') h.behavior.startOk = false;
   if (outcome === 'start-error') h.behavior.startError = true;
   if (outcome === 'settings-error') { h.settings.flowTimeSessionMinutes = 5; h.behavior.saveError = true; }
   if (outcome === 'closed') alive = false;
   if (outcome === 'external') { h.state.active = { operonId: 'external', task: null, start: 'new', elapsedSeconds: 0, isUnassigned: false }; h.emit('state'); }
   return outcome === 'cancel' ? null : outcome === 'missing' ? 'missing' : other.operonId;
  }, 'flowtime', () => alive).catch(error => { assert.match(error.message, /failed/); return false; });
  assert.equal(result, outcome === 'success'); assert.equal(h.calls.stop, 1); assert.equal(h.calls.sessions.length, 1);
  if (outcome === 'success') { assert.equal(h.controller.getSnapshot().breakState, null); assert.equal(h.state.active?.operonId, other.operonId); }
  else if (outcome !== 'external') { assert.deepEqual(h.controller.getSnapshot().breakState, before); assert.equal(h.controller.getSnapshot().pendingTaskId, h.task.operonId); assert.equal(h.state.active, null); }
  else assert.equal(h.state.active?.operonId, 'external');
 } finally { h.controller.destroy(); }
});
test('FlowTime break keeps coffee and exposes separated Finder and Creator with distinct callbacks', async () => {
 const h = harness(), f = statusDockDocument(); await h.controller.startBreak();
 const view = new FlowTimeView(new WorkspaceLeaf(), {} as never, h.timeTracker as never, {} as never, h.controller) as any;
 const globals = globalThis as typeof globalThis & { __operonTestSetIcon?: (target: HTMLElement, icon: string) => void }, previous = globals.__operonTestSetIcon;
 globals.__operonTestSetIcon = (target, icon) => { target.dataset.icon = icon; };
 try {
  let selected: boolean | undefined;
  view.selectWaitingTask = async (create = false) => { selected = create; };
  const host = f.doc.body.createDiv(); view.renderBreakButton(host, null); const slot = host.children[0];
  const buttons = slot.children.filter((el: any) => el.tagName === 'BUTTON');
  assert.deepEqual(buttons.map((el: any) => el.dataset.icon), ['coffee', 'scan-search', 'list-plus']);
  assert.equal(slot.children[1].className, 'operon-flow-time-selection-divider');
  buttons[1].click(); await Promise.resolve(); assert.equal(selected, false); assert.ok(h.controller.getSnapshot().breakState);
  buttons[2].click(); await Promise.resolve(); assert.equal(selected, true); assert.ok(h.controller.getSnapshot().breakState);
  buttons[0].click(); await new Promise(resolve => setImmediate(resolve)); assert.equal(h.controller.getSnapshot().breakState, null);
 } finally { globals.__operonTestSetIcon = previous; h.controller.destroy(); }
});

export async function runFlowTimeBreakTests(): Promise<void> {
	for (const [name, run] of cases) {
		try { await run(); } catch (error) { console.error(`Shared break: ${name}`); throw error; }
	}
	console.log(`FlowTime shared break tests passed: ${cases.length} cases`);
}
