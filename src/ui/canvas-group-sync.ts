import { Component, Notice, getIcon } from 'obsidian';
import { t } from '../core/i18n';
import { getOwnerWindow } from '../core/dom-compat';
import { planCanvasGroupSync, groupSyncRectangle, type GroupSyncPlan } from '../core/canvas-group-sync';
import { operonGroupFields, type GroupTaskState } from '../core/canvas-group-rule';
import { readOperonGroupTracking, withOperonGroupTracking, type OperonGroupTracking } from '../core/canvas-group-tracking';
import { readCanvasTaskReference } from './canvas-task-node';
import { asGroupCanvas } from './canvas-group-save';
import { isCanvasGroupEditing } from './canvas-groups';
import type { CanvasTaskIntegration, TaskCanvasView } from './canvas-task-adapter';
import type { CanvasTaskHistory } from './canvas-task-history';
import { canRemoveSyncGroup, groupCleanupContents } from '../core/canvas-group-cleanup';
import { groupContains } from '../core/canvas-group-layout';

function dataKey(data: unknown): string {
 return JSON.stringify(data, (_key, value: unknown) => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : value);
}
function saved(view: TaskCanvasView): boolean {
 try { return view.lastSavedData !== null && dataKey(JSON.parse(view.lastSavedData)) === dataKey(view.canvas.getData()); }
 catch { return false; }
}
function geometryOnly(before: unknown, after: unknown): boolean {
 const withoutGeometry = (data: unknown) => {
  const value = data as Record<string, unknown>;
  return { ...value, nodes: Array.isArray(value.nodes) ? value.nodes.map((node: Record<string, unknown>) =>
   Object.fromEntries(Object.entries(node).filter(([field]) => !['x', 'y', 'width', 'height'].includes(field)))) : value.nodes };
 };
 return dataKey(withoutGeometry(before)) === dataKey(withoutGeometry(after));
}

/** One writer per file; peer views are never overwritten to force agreement. */
export class CanvasGroupSyncCoordinator {
 private members = new Set<CanvasGroupSync>();
 private locked = new Set<string>();
 private saves = new Map<string, number>();
 private renamed = new Map<string, string>();
 private closed = new Map<string, { promise: Promise<void>; participants: Set<CanvasGroupSync> }>();
 private uncertain = new WeakSet<CanvasGroupSync>();
 private listeners = new Set<() => void>();
 private handoffs = new Map<string, { before: string; after: string; saved?: string }>();
 private accepted = new WeakMap<CanvasGroupSync, object>();
 private openOwners = new Map<string, CanvasGroupSync>();
 private peerWrites = new WeakMap<CanvasGroupSync, { before: string; after: string }>();
 private openPaths: () => ReadonlySet<string> = () => new Set();
 setOpenPaths(read: () => ReadonlySet<string>): void { this.openPaths = read; }
 onWake(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
 add(member: CanvasGroupSync): () => void {
  this.members.add(member);
  for (const [path, operation] of this.closed) if (path === member.view.file?.path || this.renamed.get(path) === member.view.file?.path) operation.participants.add(member);
  return () => { this.members.delete(member); this.wake(); };
 }
 wake(): void { for (const member of this.members) member.schedule(); for (const listener of this.listeners) listener(); }
 tasksChanged(ids?: ReadonlySet<string>): void { for (const member of this.members) member.tasksChanged(ids); }
 isOpen(path: string): boolean { return this.openPaths().has(path) || [...this.members].some(member => member.view.file?.path === path); }
 isLocked(path: string): boolean { return [...this.locked].some(key => key === path || this.renamed.get(key) === path); }
 private saving(path: string): boolean { return [...this.saves.keys()].some(key => key === path || this.renamed.get(key) === path); }
 rename(before: string, after: string): void {
  for (const key of new Set([...this.saves.keys(), ...this.locked])) {
   const path = this.renamed.get(key) ?? key;
   if (path === before || path.startsWith(before + '/')) this.renamed.set(key, after + path.slice(before.length));
  }
 }
 private pruneAliases(): void { for (const key of this.renamed.keys()) if (!this.saves.has(key) && !this.locked.has(key)) this.renamed.delete(key); }
 beginSave(path: string | undefined): () => void {
  if (!path) return () => {};
  this.saves.set(path, (this.saves.get(path) ?? 0) + 1);
  return () => { const count = (this.saves.get(path) ?? 1) - 1; if (count) this.saves.set(path, count); else this.saves.delete(path); this.pruneAliases(); this.wake(); };
 }
 acquireClosed(path: string): (() => void) | null {
  if (this.isLocked(path) || this.saving(path) || this.isOpen(path)) return null;
  this.locked.add(path);
  let settled!: () => void; this.closed.set(path, { promise: new Promise<void>(resolve => { settled = resolve; }), participants: new Set() });
  let released = false;
  return () => { if (!released) { released = true; this.locked.delete(path); this.closed.delete(path); this.pruneAliases(); settled(); this.wake(); } };
 }
 async waitForClosed(path: string | undefined, member: CanvasGroupSync): Promise<void> {
  if (!path) return;
  await Promise.all([...this.closed].filter(([key]) => key === path || this.renamed.get(key) === path).map(([, operation]) => { operation.participants.add(member); return operation.promise; }));
 }
 closedUncertain(path: string): void {
  for (const member of this.members) if (member.view.file?.path === path) this.uncertain.add(member);
  for (const [key, operation] of this.closed) if (key === path || this.renamed.get(key) === path) for (const member of operation.participants) this.uncertain.add(member);
 }
 closedCommitted(path: string, before: string, after: string): void { this.handoffs.set(path, { before, after }); }
 forget(path: string): void { this.handoffs.delete(path); }
 didSave(member: CanvasGroupSync): void {
  const path = member.view.file?.path, pending = path ? this.handoffs.get(path) : undefined;
  const content = member.view.lastSavedData;
  if (pending && content !== null && this.accepted.get(member) === pending && member.current() && !member.view.saving && saved(member.view)) {
   pending.saved = content;
  }
 }
 acknowledgeLoaded(member: CanvasGroupSync): boolean {
  const path = member.view.file?.path, pending = path ? this.handoffs.get(path) : undefined;
  if (!pending || !path || this.uncertain.has(member) || this.peerWrites.has(member) || this.isLocked(path)
   || !member.current() || member.view.saving || member.view.lastSavedData === null || !saved(member.view)) return false;
  const baseline = dataKey(JSON.parse(member.view.lastSavedData));
  if (baseline !== dataKey(JSON.parse(pending.after)) && (!pending.saved || baseline !== dataKey(JSON.parse(pending.saved)))) return false;
  this.accepted.set(member, pending); return true;
 }
 handoff(member: CanvasGroupSync): boolean {
  const path = member.view.file?.path, pending = path ? this.handoffs.get(path) : undefined;
  if (this.uncertain.has(member)) return false;
  if (path && this.isLocked(path) && ![...this.openOwners].some(([key, owner]) => owner === member && (key === path || this.renamed.get(key) === path))) return false;
  const peerWrite = this.peerWrites.get(member);
  if (peerWrite) {
   if (!member.acceptClosed(peerWrite.before, peerWrite.after)) return false;
   this.peerWrites.delete(member);
  }
  if (!pending || !path) return true;
  if (this.accepted.get(member) === pending) return true;
  if (this.isLocked(path)) return false;
  if (this.acknowledgeLoaded(member)) return true;
  if (!member.acceptClosed(pending.before, pending.after)) return false;
  this.accepted.set(member, pending); return true;
 }
 acquire(member: CanvasGroupSync, historyTravel = false): (() => void) | null {
  const path = member.view.file?.path;
  if (!path || this.isLocked(path) || this.saving(path)) return null;
  const peers = [...this.members].filter(peer => peer.view.file?.path === path);
  const shape = dataKey(member.view.canvas.getData());
  if (peers.some(peer => !peer.current() || peer.interacting || peer.view.saving || (!(historyTravel && peer === member) && !saved(peer.view))
   || (peer !== member || !historyTravel) && peer.history.isBusy || dataKey(peer.view.canvas.getData()) !== shape)) return null;
  this.locked.add(path);
  this.openOwners.set(path, member);
  const releases = peers.flatMap(peer => [peer.history.reserve(), peer.history.lockInput()]);
  let released = false;
  return () => {
   if (released) return; released = true;
   const after = dataKey(member.view.canvas.getData()), currentPath = member.view.file?.path;
   if (after !== shape) for (const peer of this.members) if (peer !== member && peer.view.file?.path === currentPath) {
    this.peerWrites.set(peer, { before: this.peerWrites.get(peer)?.before ?? shape, after });
   }
   releases.reverse().forEach(release => release());
   this.openOwners.delete(path); this.locked.delete(path); this.pruneAliases(); this.wake();
  };
 }
}

/** Event-driven reconciliation of open views. There is deliberately no vault/task writer here. */
export class CanvasGroupSync extends Component {
 private active = false;
 private timer = 0;
 private running = false;
 private applying = false;
 private faulted = false;
 private shape = '';
 private settingsKey = '';
 private sourceKeys = new Map<string, string>();
 private manual = new Set<string>();
 private pointerIds = new Set<number>();
 private gesture: Map<string, string> | null = null;
 private gestureEnding = false;
 private gestureHistory: { before: unknown; index: number } | null = null;
 private cleanupSuppressed = new Map<string, string>();
 private warned = new Set<string>();
 private readonly canvas;
 private readonly file;
 private readonly path;
 constructor(readonly view: TaskCanvasView, private owner: CanvasTaskIntegration, readonly history: CanvasTaskHistory, private coordinator: CanvasGroupSyncCoordinator) {
  super(); this.canvas = view.canvas; this.file = view.file; this.path = view.file?.path;
 }
 get interacting(): boolean { return this.pointerIds.size > 0 || !!this.gesture && !this.gestureEnding || [...this.canvas.nodes.values()].some(node => node.isEditing || isCanvasGroupEditing(node)); }
 current(): boolean { return this.active && this.owner.isCurrent(this.view) && this.view.canvas === this.canvas && this.view.file === this.file && this.file?.path === this.path; }
 tasksChanged(ids?: ReadonlySet<string>): void {
  if (!this.current()) return;
  if (!ids || [...this.canvas.nodes.values()].some(node => {
   const ref = readCanvasTaskReference(node.getData()); return ref && ids.has(ref.taskId);
  })) this.schedule();
 }
 private notice(key: string): void { if (!this.warned.has(key)) { this.warned.add(key); new Notice(t('notifications', key)); } }
 onload(): void {
  this.active = true;
  this.register(this.coordinator.add(this));
  // Confirm the clean loaded view before auto-height or user input changes it.
  this.coordinator.acknowledgeLoaded(this);
  this.register(this.owner.deps.cards.onRefresh(() => this.schedule()));
  const canvas = this.canvas, view = this.view;
  const wrap = (target: object, key: string) => {
   const original: unknown = Reflect.get(target, key), descriptor = Object.getOwnPropertyDescriptor(target, key);
   if (typeof original !== 'function') return;
   const wrapper = (...args: unknown[]) => {
    const result: unknown = Reflect.apply(original, target, args);
    if (!this.applying) this.coordinator.wake();
    return result;
   };
   Reflect.set(target, key, wrapper);
   this.register(() => { if (Reflect.get(target, key) !== wrapper) return; if (descriptor) Object.defineProperty(target, key, descriptor); else Reflect.deleteProperty(target, key); });
  };
  wrap(canvas, 'requestSave'); wrap(canvas, 'importData');
  const original = Reflect.get(view, 'save'), descriptor = Object.getOwnPropertyDescriptor(view, 'save');
  const save = async (...args: unknown[]) => {
   const release = this.coordinator.beginSave(this.path);
   try {
    if (!this.applying) {
     await this.coordinator.waitForClosed(this.path, this);
     if (!this.coordinator.handoff(this)) { this.notice('canvasChangedSaveFailed'); throw new Error('Canvas changed during background write'); }
    }
    await Reflect.apply(original, view, args);
    this.coordinator.didSave(this);
   } finally { release(); }
  };
  view.save = save;
  this.register(() => { if (view.save !== save) return; if (descriptor) Object.defineProperty(view, 'save', descriptor); else Reflect.deleteProperty(view, 'save'); });
  const unload: unknown = Reflect.get(view, 'onUnloadFile'), unloadDescriptor = Object.getOwnPropertyDescriptor(view, 'onUnloadFile');
  if (typeof unload === 'function') {
   const wrapper = async (...args: unknown[]) => { const release = this.coordinator.beginSave(this.path); try { const result: unknown = await Reflect.apply(unload, view, args); return result; } finally { release(); } };
   Reflect.set(view, 'onUnloadFile', wrapper);
   this.register(() => { if (Reflect.get(view, 'onUnloadFile') !== wrapper) return; if (unloadDescriptor) Object.defineProperty(view, 'onUnloadFile', unloadDescriptor); else Reflect.deleteProperty(view, 'onUnloadFile'); });
  }
  const doc = view.contentEl.ownerDocument, win = getOwnerWindow(view.contentEl);
  this.registerDomEvent(doc, 'pointerdown', event => {
   if (!view.contentEl.contains(event.target as Node)) return;
   if (!this.pointerIds.size) this.beginGesture();
   this.pointerIds.add(event.pointerId);
  }, true);
  const end = (event: PointerEvent) => { this.pointerIds.delete(event.pointerId); if (!this.pointerIds.size) this.endGesture(); };
  this.registerDomEvent(doc, 'pointerup', end, true); this.registerDomEvent(doc, 'pointercancel', end, true);
  this.registerDomEvent(win, 'blur', () => { this.pointerIds.clear(); this.endGesture(); });
  this.registerDomEvent(doc, 'visibilitychange', () => { if (doc.visibilityState !== 'visible') { this.pointerIds.clear(); this.endGesture(); } });
  this.registerDomEvent(view.contentEl, 'keydown', event => { if (event.key.startsWith('Arrow') && !this.gesture) this.beginGesture(); }, true);
  const endKeyboardGesture = () => { if (this.gesture && !this.pointerIds.size) this.endGesture(); };
  this.registerDomEvent(doc, 'keyup', event => { if (event.key.startsWith('Arrow')) endKeyboardGesture(); }, true);
  this.registerDomEvent(view.contentEl, 'focusout', event => {
   const next = event.relatedTarget;
   if (next && 'nodeType' in next && view.contentEl.contains(next as Node)) return;
   endKeyboardGesture();
  }, true);
  this.schedule();
 }
 private memberships(): Map<string, string> {
  const nodes = [...this.canvas.nodes.values()].map(node => node.getData());
  const groups = nodes.filter(node => node.type === 'group').map(groupSyncRectangle).filter(rect => rect !== null);
  return new Map(nodes.filter(node => readCanvasTaskReference(node)).map(node => {
   const rect = groupSyncRectangle(node);
   const ids = rect ? groups.filter(g => rect.x + rect.width / 2 >= g.x && rect.x + rect.width / 2 < g.x + g.width
    && rect.y + rect.height / 2 >= g.y && rect.y + rect.height / 2 < g.y + g.height).map(g => g.id).sort() : [];
   return [String(node.id), JSON.stringify(ids)];
  }));
 }
 private endGesture(): void {
  this.gestureEnding = true; this.schedule();
 }
 private beginGesture(): void {
  this.gestureHistory = null;
  if (!this.history.isBusy && !this.running && !this.view.saving) {
   this.canvas.requestPushHistory.run();
   const index = this.canvas.history.current ?? -1;
   this.gestureHistory = { index, before: this.canvas.history.data[index] };
  }
  this.gesture = this.memberships(); this.gestureEnding = false;
 }
 private cleanupContext(id: string, data: Record<string, unknown>): string {
  const nodes = data.nodes as Record<string, unknown>[], edges = data.edges as Record<string, unknown>[];
  const group = nodes.find(node => node.id === id);
  return dataKey([group, group ? groupCleanupContents(group, nodes) : null, edges?.filter(edge => edge.fromNode === id || edge.toNode === id)]);
 }
 private finishGesture(): void {
  // Compare only final geometry, after any asynchronous Stage 3 commit or restoration.
  const previous = this.gesture; this.gesture = null; this.gestureEnding = false;
  if (!previous) return;
  const now = this.memberships();
  for (const [id, membership] of previous) if (now.has(id) && now.get(id) !== membership) this.manual.add(id);
 }
 schedule(): void {
  if (!this.current() || this.faulted || this.timer) return;
  this.timer = getOwnerWindow(this.view.contentEl).setTimeout(() => { this.timer = 0; void this.reconcile().catch(error => {
   this.faulted = true; console.error('Operon: Changed reconciliation failed', error); this.notice('canvasChangedSaveFailed');
  }); }, 100);
 }
 private async reconcile(): Promise<void> {
  if (!this.current() || this.faulted || this.running) return;
  if (this.path && this.coordinator.isLocked(this.path)) { this.schedule(); return; }
  if (this.interacting || this.history.isBusy || this.view.saving) { this.schedule(); return; }
  this.running = true;
  try {
   if (!await this.owner.deps.groupSyncReady?.() || !this.current()) return;
   if (!this.coordinator.handoff(this)) return;
   if (this.interacting || this.history.isBusy || this.view.saving) { this.schedule(); return; }
   this.finishGesture();
   const data = structuredClone(this.canvas.getData()), nodes = data.nodes;
   if (!Array.isArray(nodes)) return;
   const settings = this.owner.deps.cards.deps.getSettings();
   const settingsKey = JSON.stringify([settings.keyMappings, settings.pipelines, settings.priorities, settings.colorPalette]);
   const shape = JSON.stringify([nodes, data.edges]);
   for (const [id, context] of this.cleanupSuppressed) if (context !== this.cleanupContext(id, data)) this.cleanupSuppressed.delete(id);
   const fields = operonGroupFields(settings).filter(field => field.type === 'text').map(field => field.key);
   const keys = new Map<string, string>(), tasks = new Map<string, GroupTaskState>(), candidates = new Set<string>();
   for (const node of nodes as Record<string, unknown>[]) {
    const ref = readCanvasTaskReference(node); if (!ref) continue;
    const resolution = this.owner.deps.cards.resolve(ref.taskId);
    const task: GroupTaskState = resolution.state === 'ready' ? { state: 'ready', taskId: ref.taskId, fieldValues: { ...resolution.task.fieldValues }, tags: [...resolution.task.tags] } : { state: resolution.state === 'duplicate' ? 'conflict' : 'missing' };
    tasks.set(ref.taskId, task);
    const key = task.state === 'ready' ? JSON.stringify(fields.map(field => task.fieldValues[field] ?? '')) : task.state;
    keys.set(String(node.id), key);
    if (this.sourceKeys.get(String(node.id)) !== key) candidates.add(String(node.id));
   }
   const full = shape !== this.shape || settingsKey !== this.settingsKey || this.manual.size > 0;
   if (!full && !candidates.size) return;
   const plan = planCanvasGroupSync({ nodes, edges: Array.isArray(data.edges) ? data.edges : undefined, settings, resolve: id => tasks.get(id) ?? { state: 'missing' }, validation: { iconExists: name => !!getIcon(name) }, manual: this.manual, candidates: full ? undefined : candidates, cleanupSuppressed: new Set(this.cleanupSuppressed.keys()) });
   if (!plan.patches.length && !plan.groups.length && !plan.removals.length) { this.accept(shape, settingsKey, keys); return; }
   if (this.canvas.readonly || !this.history.supported || !asGroupCanvas(this.canvas)) { this.notice('canvasChangedUnavailable'); return; }
   const release = this.coordinator.acquire(this); if (!release) return;
   try {
    if (!this.current() || dataKey(this.canvas.getData()) !== dataKey(data)) return;
    // No awaits between the fresh plan, final expected-state check and native mutations.
    this.apply(plan);
    const current = this.canvas.getData();
    this.accept(JSON.stringify([current.nodes, current.edges]), settingsKey, keys);
    try { await this.view.save(); }
    catch { this.faulted = true; this.notice('canvasChangedSaveFailed'); }
    if (plan.unavailable.length) this.notice('canvasChangedValueUnavailable');
   } finally { release(); }
  } finally { this.running = false; }
 }
 /** A file opened during a closed write may still have loaded the unchanged preimage. */
 acceptClosed(before: string, after: string): boolean {
  const canvas = this.canvas, current = dataKey(canvas.getData()), next: unknown = JSON.parse(after), previous: unknown = JSON.parse(before);
  if (current === dataKey(next)) return true;
  if (this.view.lastSavedData === null || this.view.saving) { this.schedule(); return false; }
  // The committed file may already be loaded while rendering or user input has
  // changed the live nodes. Acknowledge that baseline without importing over it.
  try {
   if (this.current() && dataKey(JSON.parse(this.view.lastSavedData)) === dataKey(next)) return true;
  } catch { /* An unreadable baseline must still fail the guarded import below. */ }
  if (!this.current() || this.interacting || this.history.isBusy || !saved(this.view) || current !== dataKey(previous)
   || typeof canvas.importData !== 'function' || canvas.history.data.length > 1) { this.faulted = true; this.notice('canvasChangedSaveFailed'); return false; }
  this.applying = true;
  try {
   canvas.importData(next as Record<string, unknown>, true);
   if (dataKey(canvas.getData()) !== dataKey(next)) throw new Error('Canvas handoff did not retain saved data');
   this.view.lastSavedData = after;
   canvas.history.data.splice(0, canvas.history.data.length, structuredClone(canvas.getData())); canvas.history.current = 0;
   return true;
  } catch { this.faulted = true; this.notice('canvasChangedSaveFailed'); return false; }
  finally { this.applying = false; }
 }
 private accept(shape: string, settings: string, keys: Map<string, string>): void {
  this.shape = shape; this.settingsKey = settings; this.sourceKeys = keys; this.manual.clear(); this.gestureHistory = null;
 }
 private apply(plan: GroupSyncPlan): void {
  const canvas = asGroupCanvas(this.canvas)!;
  this.applying = true;
  try {
   canvas.requestPushHistory.run();
   for (const patch of plan.patches) {
    if (dataKey(canvas.nodes.get(String(patch.before.id))?.getData()) !== dataKey(patch.before)) throw new Error('Changed plan became stale');
   }
   if (!canvas.history.data.length) canvas.pushHistory(canvas.getData());
   let before = canvas.history.data[canvas.history.current ?? -1];
   const gesture = this.gestureHistory;
   const merge = !!gesture && this.manual.size > 0 && plan.removals.length > 0 && !plan.moves.length && !plan.groups.length
    && canvas.history.current === gesture.index + 1 && canvas.history.data[gesture.index] === gesture.before
    && dataKey(before) === dataKey(canvas.getData()) && geometryOnly(gesture.before, before) && !this.history.isManagedStep(gesture.before, before);
   const ids = new Map<string, string>();
   const created: { node: import('./canvas-task-adapter').CanvasTaskNode; data: Record<string, unknown> }[] = [];
   const applied: { node: import('./canvas-task-adapter').CanvasTaskNode; before: Record<string, unknown>; after: Record<string, unknown> }[] = [];
   const removed = new Set<string>();
   if (plan.removals.length) {
    const data = canvas.getData();
    let projected = (data.nodes as Record<string, unknown>[]).map(node => plan.patches.find(patch => patch.before.id === node.id)?.after ?? node).concat(plan.groups);
    if (dataKey(data.edges) !== dataKey(plan.edges)) throw new Error('Changed edges became stale');
    for (const expected of plan.removals) {
     if (dataKey(canvas.nodes.get(String(expected.id))?.getData()) !== dataKey(expected)
      || !canRemoveSyncGroup(expected, projected, data.edges as Record<string, unknown>[])) throw new Error('Changed removal became stale');
     projected = projected.filter(node => node.id !== expected.id);
    }
   }
   const remap = (tracking: OperonGroupTracking): OperonGroupTracking => {
    const next = { ...tracking };
    if (next.changedGroupId) next.changedGroupId = ids.get(next.changedGroupId) ?? next.changedGroupId;
    if (next.groupId) next.groupId = ids.get(next.groupId) ?? next.groupId;
    return next;
   };
   try {
   for (const data of plan.groups) {
    const rect = groupSyncRectangle(data)!;
    const node = canvas.createGroupNode({ pos: { x: rect.x, y: rect.y }, size: { width: rect.width, height: rect.height }, label: String(data.label), save: false, focus: false });
    ids.set(rect.id, node.id);
    created.push({ node, data: node.getData() });
   }
   for (const patch of plan.patches) {
    const node = canvas.nodes.get(String(patch.before.id));
    if (!node || dataKey(node.getData()) !== dataKey(patch.before)) throw new Error('Changed node changed before apply');
    const next = structuredClone(patch.after);
    if (next.operonGroupTracking) next.operonGroupTracking = remap(next.operonGroupTracking as OperonGroupTracking);
    applied.push({ node, before: patch.before, after: next });
    node.setData(next);
    if (dataKey(node.getData()) !== dataKey(next)) throw new Error('Changed metadata was not retained');
   }
   for (const expected of plan.removals) {
    const node = canvas.nodes.get(String(expected.id)), data = canvas.getData();
    if (!node || dataKey(node.getData()) !== dataKey(expected) || dataKey(data.edges) !== dataKey(plan.edges)
     || !canRemoveSyncGroup(expected, data.nodes as Record<string, unknown>[], data.edges as Record<string, unknown>[], new Set([...canvas.nodes.values()].filter(n => n.isEditing || isCanvasGroupEditing(n)).map(n => n.id)))) throw new Error('Changed removal became stale');
    try { canvas.removeNode(node); }
    finally { if (!canvas.nodes.has(node.id)) removed.add(node.id); }
    if (canvas.nodes.has(node.id)) throw new Error('Canvas group removal was not retained');
    const after = canvas.getData();
    if (dataKey(after.edges) !== dataKey(data.edges) || dataKey(after.nodes) !== dataKey((data.nodes as Record<string, unknown>[]).filter(n => n.id !== node.id))) throw new Error('Canvas removal changed unrelated content');
   }
   } catch (error) {
    if (removed.size) {
     // Preserve the verified partial result and its Undo step, without guessing how to recreate native nodes.
     canvas.pushHistory(canvas.getData()); this.recordHistory(before, canvas.history.data[canvas.history.current ?? -1], plan, remap);
     canvas.requestSave(false); throw error;
    }
    // Roll back only unchanged writes owned by this attempt, never import an old Canvas snapshot.
    let restored = true;
    for (const item of applied.reverse()) {
     try {
      const data = item.node.getData();
      if (canvas.nodes.get(item.node.id) !== item.node) { restored = false; continue; }
      const keys = [...new Set([...Object.keys(item.before), ...Object.keys(item.after)])].filter(key => dataKey(item.before[key]) !== dataKey(item.after[key]));
      const next = { ...data };
      for (const key of keys) {
       if (dataKey(data[key]) === dataKey(item.after[key])) {
        if (key in item.before) next[key] = item.before[key]; else delete next[key];
       } else if (dataKey(data[key]) !== dataKey(item.before[key])) restored = false;
      }
      if (dataKey(next) !== dataKey(data)) item.node.setData(next);
      if (keys.some(key => dataKey(item.node.getData()[key]) !== dataKey(item.before[key]))) restored = false;
     } catch { restored = false; }
    }
    for (const item of restored ? created.reverse() : []) {
     try { if (canvas.nodes.get(item.node.id) === item.node && dataKey(item.node.getData()) === dataKey(item.data)) canvas.removeNode(item.node); else restored = false; }
     catch { restored = false; }
    }
    if (!restored) {
     canvas.pushHistory(canvas.getData()); this.recordHistory(before, canvas.history.data[canvas.history.current ?? -1], plan, remap);
     canvas.requestSave(false);
    }
    throw error;
   }
   if (!plan.moves.length && !plan.groups.length && !plan.removals.length && plan.patches.every(patch => patch.before.type !== 'group')) {
    // Tracking follows the native move/entry that owns it, never an extra undoable cleanup step.
    const snapshot = before as { nodes?: Record<string, unknown>[] };
    for (const patch of plan.patches) {
     const node = snapshot.nodes?.find(node => node.id === patch.after.id);
     if (!node) continue;
     delete node.operonGroupTracking;
     if (patch.after.operonGroupTracking) node.operonGroupTracking = structuredClone(patch.after.operonGroupTracking);
    }
   } else {
    if (merge) {
     canvas.history.data.splice(canvas.history.current!, 1); canvas.history.current = canvas.history.current! - 1;
     before = gesture.before;
    }
    canvas.pushHistory(canvas.getData());
    const after = canvas.history.data[canvas.history.current ?? -1];
    this.recordHistory(before, after, plan, remap);
   }
   canvas.requestSave(false);
  } finally { this.applying = false; }
 }
 private recordHistory(before: unknown, after: unknown, plan: GroupSyncPlan, remap: (tracking: OperonGroupTracking) => OperonGroupTracking): void {
  if (before === after) return;
  const remove = this.history.addHandler(step => {
   if (!this.canvas.history.data.includes(after)) { remove(); return null; }
   if (!(step.direction === 'undo' ? step.current === after && step.next === before : step.current === before && step.next === after)) return null;
   return async () => {
    if (!this.current() || this.canvas.readonly) return;
    if (dataKey(this.canvas.getData()) !== dataKey(step.current)) { this.notice('canvasChangedUnavailable'); return; }
    const release = this.coordinator.acquire(this, true);
    if (!release) { this.notice('canvasChangedUnavailable'); return; }
    this.applying = true;
    try {
     if (step.direction === 'undo') {
      const snapshot = step.next as { nodes?: Record<string, unknown>[] };
     for (const move of plan.moves) {
       const index = snapshot.nodes?.findIndex(node => node.id === move.id) ?? -1;
       if (index < 0 || !snapshot.nodes) continue;
       const tracking = { ...remap(move.tracking), suppressedValue: move.value, suppressedRule: move.context };
       const previous = readOperonGroupTracking(snapshot.nodes[index]);
       if (previous.state === 'ready' && previous.value.changedGroupId) tracking.changedGroupId = previous.value.changedGroupId;
       else delete tracking.changedGroupId;
       if (move.previousGroupId) tracking.groupId = move.previousGroupId; else delete tracking.groupId;
       const tracked = withOperonGroupTracking(snapshot.nodes[index], tracking);
      if (tracked) snapshot.nodes[index] = tracked;
     }
     // Restored empty groups must not be re-enrolled by stale links on cards already outside them.
     for (const node of snapshot.nodes ?? []) {
      const read = readOperonGroupTracking(node), rect = groupSyncRectangle(node);
      if (read.state !== 'ready' || !rect) continue;
      for (const key of ['changedGroupId', 'groupId'] as const) {
       const removed = plan.removals.find(group => group.id === read.value[key]);
       if (removed && !groupContains(groupSyncRectangle(removed)!, rect)) delete read.value[key];
      }
      Object.assign(node, withOperonGroupTracking(node, read.value));
     }
     }
     step.native();
     this.manual.clear();
     const data = this.canvas.getData();
     for (const group of plan.removals) {
      const id = String(group.id);
      if (step.direction === 'undo') this.cleanupSuppressed.set(id, this.cleanupContext(id, data));
      else this.cleanupSuppressed.delete(id);
     }
     this.shape = JSON.stringify([data.nodes, data.edges]);
     if (this.current()) { this.canvas.requestSave(false); await this.view.save(); }
    } catch { this.faulted = true; this.notice('canvasChangedSaveFailed'); }
    finally { this.applying = false; release(); }
   };
  });
  this.register(remove);
 }
 onunload(): void { this.active = false; getOwnerWindow(this.view.contentEl).clearTimeout(this.timer); this.timer = 0; this.pointerIds.clear(); this.gesture = null; this.gestureHistory = null; this.cleanupSuppressed.clear(); }
}
