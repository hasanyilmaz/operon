import { Component, Notice, getIcon } from 'obsidian';
import { t } from '../core/i18n';
import { getOwnerWindow } from '../core/dom-compat';
import { planCanvasGroupSyncAsync, groupSyncRectangle, type GroupSyncPlan } from '../core/canvas-group-sync';
import { operonGroupFields, type GroupTaskState } from '../core/canvas-group-rule';
import { readOperonGroupTracking, withOperonGroupTracking, type OperonGroupTracking } from '../core/canvas-group-tracking';
import { readCanvasTaskReference } from './canvas-task-node';
import { asGroupCanvas, CanvasSavePreflightError } from './canvas-group-save';
import { isCanvasGroupEditing } from './canvas-groups';
import type { CanvasTaskIntegration, TaskCanvasView } from './canvas-task-adapter';
import type { CanvasTaskHistory } from './canvas-task-history';
import { canRemoveSyncGroup, groupCleanupContents } from '../core/canvas-group-cleanup';
import { groupContains } from '../core/canvas-group-layout';

// Reattaching to the same view must not queue a wrapped save behind itself.
type SaveBinding = { native: TaskCanvasView['save']; previous: TaskCanvasView['save']; descriptor?: PropertyDescriptor; active: boolean };
const nativeSaves = new WeakMap<TaskCanvasView['save'], SaveBinding>();

type SyncHistory = Pick<GroupSyncPlan, 'moves' | 'removals'>;
type OpenSyncLease = (() => void) & { publish(history?: SyncHistory): void };

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
 private peerWrites = new WeakMap<CanvasGroupSync, { before: string; after: string; history?: SyncHistory; cleanup: [string, string][] }>();
 private openSettlements = new Map<string, { owner: CanvasGroupSync; promise: Promise<void> }>();
 private saveTails = new WeakMap<NonNullable<TaskCanvasView['file']>, Promise<void>>();
 private freshBaselines = new WeakSet<CanvasGroupSync>();
 private lastWriters = new WeakMap<NonNullable<TaskCanvasView['file']>, CanvasGroupSync>();
 private savedBaselines = new WeakMap<NonNullable<TaskCanvasView['file']>, string>();
 private openPaths: () => ReadonlySet<string> = () => new Set();
 setOpenPaths(read: () => ReadonlySet<string>): void { this.openPaths = read; }
 onWake(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
 add(member: CanvasGroupSync): () => void {
  const file = member.view.file;
  if (file && !this.isLocked(file.path) && !this.saving(file.path) && ![...this.members].some(peer => peer.view.file === file)) this.freshBaselines.add(member);
  this.members.add(member);
  for (const [path, operation] of this.closed) if (path === member.view.file?.path || this.renamed.get(path) === member.view.file?.path) operation.participants.add(member);
  return () => { this.members.delete(member); if (file && this.lastWriters.get(file) === member) this.lastWriters.delete(file); this.wake(); };
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
  await Promise.all([
   ...[...this.closed].filter(([key]) => key === path || this.renamed.get(key) === path).map(([, operation]) => { operation.participants.add(member); return operation.promise; }),
   ...[...this.openSettlements].filter(([key, operation]) => operation.owner !== member && (key === path || this.renamed.get(key) === path)).map(([, operation]) => operation.promise),
  ]);
 }
 closedUncertain(path: string): void {
  for (const member of this.members) if (member.view.file?.path === path) this.uncertain.add(member);
  for (const [key, operation] of this.closed) if (key === path || this.renamed.get(key) === path) for (const member of operation.participants) this.uncertain.add(member);
 }
 closedCommitted(path: string, before: string, after: string): void { this.handoffs.set(path, { before, after }); }
 forget(path: string): void { this.handoffs.delete(path); }
 async serializeSave(file: NonNullable<TaskCanvasView['file']>): Promise<() => void> {
  const previous = this.saveTails.get(file) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>(resolve => { release = resolve; });
  this.saveTails.set(file, next);
  await previous;
  return () => { if (this.saveTails.get(file) === next) this.saveTails.delete(file); release(); };
 }
 acceptBaseline(member: CanvasGroupSync, content: string): void {
  if (member.view.file) this.savedBaselines.set(member.view.file, dataKey(JSON.parse(content)));
  for (const peer of this.members) if (peer.view.file === member.view.file) this.freshBaselines.delete(peer);
 }
 prepareSave(member: CanvasGroupSync): boolean {
  if (this.uncertain.has(member)) return false;
  if (this.freshBaselines.has(member) && member.view.lastSavedData !== null) this.acceptBaseline(member, member.view.lastSavedData);
  const file = member.view.file, baseline = file && this.savedBaselines.get(file);
  if (!baseline) return true;
  const own = member.view.lastSavedData;
  if (own === null) return false;
  try {
   const previous = dataKey(JSON.parse(own));
   if (previous === baseline || file && this.lastWriters.get(file) === member) return true;
   if (dataKey(member.view.canvas.getData()) === baseline) { member.view.lastSavedData = baseline; return true; }
   return member.acceptPeer(previous, baseline);
  } catch { return false; }
 }
 saveFailed(member: CanvasGroupSync, file = member.view.file): void {
  for (const peer of this.members) if (peer.view.file === file) this.uncertain.add(peer);
 }
 didSave(member: CanvasGroupSync): void {
  const path = member.view.file?.path, pending = path ? this.handoffs.get(path) : undefined;
  const content = member.view.lastSavedData;
  if (member.view.file && content !== null) {
   try { this.acceptBaseline(member, content); if (member.current() && this.members.has(member)) this.lastWriters.set(member.view.file, member); } catch { this.saveFailed(member); }
  }
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
  this.acceptBaseline(member, member.view.lastSavedData);
  this.accepted.set(member, pending); return true;
 }
 handoff(member: CanvasGroupSync): boolean {
  const path = member.view.file?.path, pending = path ? this.handoffs.get(path) : undefined;
  if (this.uncertain.has(member)) return false;
  if (path && this.isLocked(path) && ![...this.openOwners].some(([key, owner]) => owner === member && (key === path || this.renamed.get(key) === path))) return false;
  const peerWrite = this.peerWrites.get(member);
  if (peerWrite) {
   if (!member.acceptPeer(peerWrite.before, peerWrite.after, peerWrite.history, peerWrite.cleanup)) return false;
   this.peerWrites.delete(member);
  }
  if (!pending || !path) return true;
  if (this.accepted.get(member) === pending) return true;
  if (this.isLocked(path)) return false;
  if (this.acknowledgeLoaded(member)) return true;
  if (!member.acceptClosed(pending.before, pending.after)) return false;
  this.accepted.set(member, pending); return true;
 }
 acquire(member: CanvasGroupSync, historyTravel = false): OpenSyncLease | null {
  const path = member.view.file?.path;
  if (!path || this.isLocked(path) || this.saving(path)) return null;
  const peers = [...this.members].filter(peer => peer.view.file?.path === path);
  const shape = dataKey(member.view.canvas.getData());
  if (peers.some(peer => peers.length > 1 && typeof peer.view.canvas.importData !== 'function' || !peer.current() || peer.interacting || peer.view.saving || (!(historyTravel && peer === member) && !saved(peer.view))
   || (peer !== member || !historyTravel) && peer.history.isBusy || dataKey(peer.view.canvas.getData()) !== shape)) return null;
  this.locked.add(path);
  this.openOwners.set(path, member);
  const releases = peers.map(peer => peer.history.reserve());
  let settled!: () => void;
  this.openSettlements.set(path, { owner: member, promise: new Promise<void>(resolve => { settled = resolve; }) });
  let released = false, published = false;
  const publish = (history?: SyncHistory) => {
   if (published || released) return; published = true;
   const after = dataKey(member.view.canvas.getData());
   releases.reverse().forEach(release => release());
   // Publish the synchronous native change before yielding to storage. Later user
   // edits must not be absorbed into this automation's history or peer snapshot.
   if (after !== shape) for (const peer of peers) if (peer !== member && peer.current() && peer.view.file === member.view.file) {
    const cleanup = member.cleanupState();
    this.peerWrites.set(peer, { before: shape, after, history, cleanup });
    if (peer.acceptPeer(shape, after, history, cleanup)) this.peerWrites.delete(peer);
   }
  };
  return Object.assign(() => {
   if (released) return;
   publish(); released = true;
   this.openOwners.delete(path); this.locked.delete(path);
   this.openSettlements.delete(path); settled(); this.pruneAliases(); this.wake();
  }, { publish });
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
 private taskNodes = new Map<string, Set<string>>();
 private taskStates = new Map<string, GroupTaskState>();
 private pendingTasks: Set<string> | null = null;
 private sourceRevision = 0;
 private finishPlanningPause: (() => void) | null = null;
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
  if (!ids) this.pendingTasks = null;
  else {
   const relevant = [...ids].filter(id => !this.shape || this.taskNodes.has(id));
   if (!relevant.length) return;
   if (this.pendingTasks) for (const id of relevant) this.pendingTasks.add(id);
  }
  this.sourceRevision++; this.schedule();
 }
 private notice(key: string): void { if (!this.warned.has(key)) { this.warned.add(key); new Notice(t('notifications', key)); } }
 onload(): void {
  this.active = true;
  this.register(this.coordinator.add(this));
  // Confirm the clean loaded view before auto-height or user input changes it.
  this.coordinator.acknowledgeLoaded(this);
  this.register(this.owner.deps.cards.onRefresh(scope => this.tasksChanged(scope?.kind === 'tasks' ? scope.taskIds : undefined)));
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
  const nativeSave = nativeSaves.get(original)?.native ?? original;
  const save = async (...args: unknown[]) => {
   const file = view.file, path = this.path;
   const release = this.coordinator.beginSave(path);
   let releaseWriter: (() => void) | undefined;
   try {
    await this.coordinator.waitForClosed(path, this);
    if (!file || !this.current() || view.file !== file || this.path !== path) throw new CanvasSavePreflightError('Canvas save owner changed');
    releaseWriter = await this.coordinator.serializeSave(file);
    if (!this.current() || view.file !== file || this.path !== path) throw new CanvasSavePreflightError('Canvas save owner changed');
    if (!this.coordinator.handoff(this) || !this.coordinator.prepareSave(this)) {
     this.notice('canvasChangedSaveFailed'); throw new CanvasSavePreflightError('Canvas changed before serialized save');
    }
    try { await Reflect.apply(nativeSave, view, args); }
    catch (error) { this.coordinator.saveFailed(this, file); throw error; }
    // A completed native write remains the file baseline even after this component unloads.
    if (view.file === file) this.coordinator.didSave(this); else this.coordinator.saveFailed(this, file);
   } finally { releaseWriter?.(); release(); }
  };
  const binding: SaveBinding = { native: nativeSave, previous: original, descriptor, active: true };
  nativeSaves.set(save, binding);
  view.save = save;
  this.register(() => {
   binding.active = false;
   if (view.save !== save) return;
   let previous = binding.previous, restore = binding.descriptor;
   for (let prior = nativeSaves.get(previous); prior && !prior.active; prior = nativeSaves.get(previous)) { previous = prior.previous; restore = prior.descriptor; }
   if (restore) Object.defineProperty(view, 'save', restore); else Reflect.deleteProperty(view, 'save');
  });
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
   const structural = shape !== this.shape || settingsKey !== this.settingsKey || this.manual.size > 0;
   const full = this.pendingTasks === null || structural;
   if (full) {
    this.taskNodes.clear(); this.taskStates.clear();
    for (const node of nodes as Record<string, unknown>[]) {
     const ref = readCanvasTaskReference(node); if (!ref) continue;
     const ids = this.taskNodes.get(ref.taskId) ?? new Set<string>(); ids.add(String(node.id)); this.taskNodes.set(ref.taskId, ids);
    }
   }
   const fields = operonGroupFields(settings).filter(field => field.type === 'text').map(field => field.key);
   const keys = full ? new Map<string, string>() : new Map(this.sourceKeys), candidates = new Set<string>();
   const requested = full ? this.taskNodes.keys() : this.pendingTasks ?? [];
   for (const id of requested) {
    if (!this.taskNodes.has(id)) continue;
    const resolution = this.owner.deps.cards.resolve(id);
    const task: GroupTaskState = resolution.state === 'ready' ? { state: 'ready', taskId: id, fieldValues: { ...resolution.task.fieldValues }, tags: [...resolution.task.tags] } : { state: resolution.state === 'duplicate' ? 'conflict' : 'missing' };
    this.taskStates.set(id, task);
    const key = task.state === 'ready' ? JSON.stringify(fields.map(field => task.fieldValues[field] ?? '')) : task.state;
    for (const nodeId of this.taskNodes.get(id)!) { keys.set(nodeId, key); if (this.sourceKeys.get(nodeId) !== key) candidates.add(nodeId); }
   }
   const tasks = new Map(this.taskStates), revision = this.sourceRevision, expectedData = dataKey(data);
   const currentPlan = () => this.current() && !this.interacting && !this.history.isBusy && !this.view.saving
    && this.sourceRevision === revision && (!this.path || !this.coordinator.isLocked(this.path))
    && settingsKey === JSON.stringify([this.owner.deps.cards.deps.getSettings().keyMappings, this.owner.deps.cards.deps.getSettings().pipelines, this.owner.deps.cards.deps.getSettings().priorities, this.owner.deps.cards.deps.getSettings().colorPalette])
    && dataKey(this.canvas.getData()) === expectedData;
   const pause = () => new Promise<void>(resolve => {
    const win = getOwnerWindow(this.view.contentEl), timer = win.setTimeout(() => finish(), 0);
    const finish = () => { win.clearTimeout(timer); this.finishPlanningPause = null; resolve(); };
    this.finishPlanningPause = finish;
   });
   if (!structural && !candidates.size) { this.accept(shape, settingsKey, keys); return; }
   let plan = await planCanvasGroupSyncAsync({ nodes, edges: Array.isArray(data.edges) ? data.edges : undefined, settings, resolve: id => tasks.get(id) ?? { state: 'missing' }, validation: { iconExists: name => !!getIcon(name) }, manual: this.manual, candidates: structural ? undefined : candidates, cleanupSuppressed: new Set(this.cleanupSuppressed.keys()) }, currentPlan, pause);
   if (!plan || !currentPlan()) { this.pendingTasks = null; this.schedule(); return; }
   if (!structural && (plan.moves.length || plan.groups.length || plan.removals.length)) plan = await planCanvasGroupSyncAsync({ nodes, edges: Array.isArray(data.edges) ? data.edges : undefined, settings, resolve: id => tasks.get(id) ?? { state: 'missing' }, validation: { iconExists: name => !!getIcon(name) }, manual: this.manual, cleanupSuppressed: new Set(this.cleanupSuppressed.keys()) }, currentPlan, pause);
   if (!plan || !currentPlan()) { this.pendingTasks = null; this.schedule(); return; }
   if (!plan.patches.length && !plan.groups.length && !plan.removals.length) { this.accept(shape, settingsKey, keys); return; }
   if (this.canvas.readonly || !this.history.supported || !asGroupCanvas(this.canvas)) { this.notice('canvasChangedUnavailable'); return; }
   const release = this.coordinator.acquire(this); if (!release) return;
   try {
    if (!this.current() || this.sourceRevision !== revision || dataKey(this.canvas.getData()) !== expectedData) return;
    // No awaits between the final expected-state check and native mutations.
    const history = this.apply(plan);
    release.publish(history);
    const current = this.canvas.getData();
    this.accept(JSON.stringify([current.nodes, current.edges]), settingsKey, keys);
    try { await this.view.save(); }
    catch { this.faulted = true; this.notice('canvasChangedSaveFailed'); }
    if (plan.unavailable.length) this.notice('canvasChangedValueUnavailable');
   } finally { release(); }
  } finally { this.running = false; }
 }
 /** Apply an identical saved peer's layout without discarding its existing source/history handlers. */
 cleanupState(): [string, string][] { return [...this.cleanupSuppressed]; }
 acceptPeer(before: string, after: string, history?: SyncHistory, cleanup?: [string, string][]): boolean {
  const canvas = this.canvas, current = dataKey(canvas.getData());
  if (current === after) return true;
  if (!this.current() || this.interacting || this.history.isBusy || this.view.saving || !saved(this.view)
   || current !== before || typeof canvas.importData !== 'function') return false;
  this.applying = true;
  try {
   canvas.requestPushHistory.run();
   if (!canvas.history.data.length) canvas.pushHistory(canvas.getData());
   const previous = canvas.history.data[canvas.history.current ?? -1], previousCleanup = this.cleanupState();
   canvas.importData(JSON.parse(after) as Record<string, unknown>, true);
   if (dataKey(canvas.getData()) !== after) throw new Error('Canvas peer did not retain synchronized data');
   canvas.pushHistory(canvas.getData());
   if (cleanup) this.cleanupSuppressed = new Map(cleanup);
   this.recordHistory(previous, canvas.history.data[canvas.history.current ?? -1], history ?? { moves: [], removals: [] }, tracking => ({ ...tracking }), { before: previousCleanup, after: this.cleanupState() });
   this.view.lastSavedData = after;
   this.shape = ''; this.schedule();
   return true;
  } catch { this.faulted = true; this.notice('canvasChangedSaveFailed'); return false; }
  finally { this.applying = false; }
 }
 /** A file opened during a closed write may still have loaded the unchanged preimage. */
 acceptClosed(before: string, after: string): boolean {
  const canvas = this.canvas, current = dataKey(canvas.getData()), next: unknown = JSON.parse(after), previous: unknown = JSON.parse(before);
  if (current === dataKey(next)) { this.coordinator.acceptBaseline(this, after); return true; }
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
   this.coordinator.acceptBaseline(this, after);
   canvas.history.data.splice(0, canvas.history.data.length, structuredClone(canvas.getData())); canvas.history.current = 0;
   return true;
  } catch { this.faulted = true; this.notice('canvasChangedSaveFailed'); return false; }
  finally { this.applying = false; }
 }
 private accept(shape: string, settings: string, keys: Map<string, string>): void {
  this.shape = shape; this.settingsKey = settings; this.sourceKeys = keys; this.pendingTasks = new Set(); this.manual.clear(); this.gestureHistory = null;
 }
 private apply(plan: GroupSyncPlan): SyncHistory {
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
   return { moves: plan.moves.map(move => ({ ...move, tracking: remap(move.tracking) })), removals: plan.removals };
  } finally { this.applying = false; }
 }
 private recordHistory(before: unknown, after: unknown, plan: SyncHistory, remap: (tracking: OperonGroupTracking) => OperonGroupTracking, cleanup?: { before: [string, string][]; after: [string, string][] }): void {
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
     if (cleanup) this.cleanupSuppressed = new Map(step.direction === 'undo' ? cleanup.before : cleanup.after);
     for (const group of plan.removals) {
      const id = String(group.id);
      if (step.direction === 'undo') this.cleanupSuppressed.set(id, this.cleanupContext(id, data));
      else this.cleanupSuppressed.delete(id);
     }
     this.shape = JSON.stringify([data.nodes, data.edges]);
     release.publish();
     if (this.current()) { this.canvas.requestSave(false); await this.view.save(); }
    } catch { this.faulted = true; this.notice('canvasChangedSaveFailed'); }
    finally { this.applying = false; release(); }
   };
  });
  this.register(remove);
 }
 onunload(): void { this.active = false; this.finishPlanningPause?.(); getOwnerWindow(this.view.contentEl).clearTimeout(this.timer); this.timer = 0; this.pointerIds.clear(); this.gesture = null; this.gestureHistory = null; this.cleanupSuppressed.clear(); this.taskNodes.clear(); this.taskStates.clear(); this.pendingTasks = null; }
}
