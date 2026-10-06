import { Notice, TFile, parseYaml, type App } from 'obsidian';
import type { IndexedTask } from '../types/fields';
import type { OperonSettings } from '../types/settings';
import { isRecord } from '../core/unknown-value';
import { iterateMarkdownLinesOutsideFences } from '../core/markdown-fenced-lines';
import { isOperonExcludedPath } from '../core/operon-path-exclusions';
import { scanFileWithMappings } from '../indexer/file-scanner';
import { t } from '../core/i18n';
import { ExcalidrawTaskCardCleanupStore, cloneCleanupValue, type ExcalidrawCleanupCard } from '../storage/excalidraw-task-card-cleanup-store';
import { isExcalidrawTaskLink, readExcalidrawTaskView, type ExcalidrawTaskElement, type ExcalidrawTaskView } from './excalidraw-task-bridge';
import { saveExcalidrawTaskSceneInQueue, serializeExcalidrawSource } from './excalidraw-markdown-source';

export type TaskRemovalEvidence = 'source-scan' | 'file-delete' | 'committed';
export interface ExcalidrawCleanupDeps {
 app: App; getSettings(): OperonSettings;
 taskState(id: string): 'ready' | 'missing' | 'uncertain';
 isSourceTransitionActive(id: string): boolean;
 awaitSettlement(): Promise<unknown>;
}
const marker = 'operonTaskCleanup';
function taskId(element: ExcalidrawTaskElement): string | null { return /#Operon task ([a-z0-9]{7})\]\]$/.exec(element.link ?? '')?.[1] ?? null; }
function owned(element: ExcalidrawTaskElement, token: string): boolean { return isRecord(element.customData) && element.customData[marker] === token; }
/** Compare the user's complete visual state, excluding native bookkeeping and our marker. */
export function cleanupElementSignature(element: ExcalidrawTaskElement): string {
 const copy = cloneCleanupValue(element);
 for (const key of ['isDeleted', 'version', 'versionNonce', 'updated', 'index']) delete copy[key];
 if (isRecord(copy.customData)) { delete copy.customData[marker]; if (!Object.keys(copy.customData).length) delete copy.customData; }
 const sorted = (value: unknown): unknown => Array.isArray(value) ? value.map(sorted) : isRecord(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
 return JSON.stringify(sorted(copy));
}

/** Missing index entries are candidates, never evidence on their own. */
export async function verifyRemovedTask(deps: ExcalidrawCleanupDeps, task: IndexedTask, evidence: TaskRemovalEvidence): Promise<boolean> {
 if (deps.isSourceTransitionActive(task.operonId)) return false;
 await deps.awaitSettlement();
 if (deps.isSourceTransitionActive(task.operonId) || deps.taskState(task.operonId) !== 'missing') return false;
 const path = task.primary.filePath;
 if (isOperonExcludedPath(path, deps.getSettings())) return false;
 const file = deps.app.vault.getAbstractFileByPath(path);
 if (!(file instanceof TFile)) return evidence === 'file-delete' || evidence === 'committed';
 if (evidence === 'file-delete') return false;
 const content = await deps.app.vault.read(file);
 if (deps.app.vault.getAbstractFileByPath(path) !== file) return false;
 const scan = await scanFileWithMappings(deps.app, file, deps.getSettings().keyMappings, content);
 if (scan.yamlTask?.operonId === task.operonId || scan.inlineTasks.some(value => value.operonId === task.operonId)) return false;
 // Parse failures and recognizable damaged identities are not deletions.
 const id = task.operonId;
 if (task.primary.format === 'yaml') {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (content.startsWith('---') && !frontmatter) return false;
  if (frontmatter) {
   try { if (!isRecord(parseYaml(frontmatter[1]))) return false; } catch { return false; }
   if (frontmatter[1].split(/\r?\n/).some(line => new RegExp(`^\\s*[^:#]+:.*\\b${id}\\b`).test(line))) return false;
  }
 }
 if (task.primary.format === 'inline' && [...iterateMarkdownLinesOutsideFences(content)].some(([, line]) => new RegExp(`\\{[^}\\n]*::\\s*${id}\\b`).test(line))) return false;
 return await deps.app.vault.read(file) === content && deps.app.vault.getAbstractFileByPath(path) === file
  && !deps.isSourceTransitionActive(id) && deps.taskState(id) === 'missing';
}

export class ExcalidrawTaskCleanup {
 readonly store: ExcalidrawTaskCardCleanupStore;
 private active = true;
 private loaded: Promise<void>;
 private bindings = new Map<ExcalidrawTaskView, { api: ExcalidrawTaskView['excalidrawAPI']; stop(): void; signature: string }>();
 private busy = false;
 private scheduled = false;
 private dirty = false;
 private warned = false;
 private failed = new Map<ExcalidrawTaskView, TFile>();
 private stops: (() => void)[] = [];
 private pendingDeletes = new Map<string, number>();
 private uncertainDeletes = new Set<string>();
 constructor(private deps: ExcalidrawCleanupDeps) {
  this.store = new ExcalidrawTaskCardCleanupStore(deps.app.vault.adapter, deps.app.vault.configDir);
  this.loaded = this.store.load().catch(error => this.warn(error));
  this.stops.push(() => this.store.destroy());
  const vault = deps.app.vault;
  if (typeof vault.on === 'function') {
   const rename = vault.on('rename', (file, oldPath) => { void this.loaded.then(async () => { if (this.active && this.store.healthy) await this.store.renamePath(oldPath, file.path); this.sync(); }).catch(error => this.warn(error)); });
   const deleted = vault.on('delete', file => { void this.loaded.then(async () => { if (this.active && this.store.healthy) await this.store.deleteDrawing(file.path); this.sync(); }).catch(error => this.warn(error)); });
   this.stops.push(() => vault.offref(rename), () => vault.offref(deleted));
  }
  void this.loaded.then(() => this.sync());
 }
 beginDeletion(tasks: readonly IndexedTask[]): (committed?: boolean) => void {
  const ids = [...new Set(tasks.map(task => task.operonId))];
  for (const id of ids) this.pendingDeletes.set(id, (this.pendingDeletes.get(id) ?? 0) + 1);
  let released = false;
  return (committed = false) => { if (released) return; released = true; for (const id of ids) {
   if (!committed && this.deps.taskState(id) !== 'ready') this.uncertainDeletes.add(id);
   const count = (this.pendingDeletes.get(id) ?? 1) - 1;
   if (count) this.pendingDeletes.set(id, count); else this.pendingDeletes.delete(id);
  } };
 }
 async confirmRemoved(tasks: readonly IndexedTask[], evidence: TaskRemovalEvidence): Promise<void> {
  // Capture transition ownership before any await; its release cannot turn a move into deletion.
  for (const task of tasks) if (this.deps.taskState(task.operonId) === 'ready') this.uncertainDeletes.delete(task.operonId);
  const candidates = tasks.filter(task => !this.pendingDeletes.has(task.operonId) && (evidence === 'committed' || !this.uncertainDeletes.has(task.operonId)) && !this.deps.isSourceTransitionActive(task.operonId)).map(cloneCleanupValue);
  try {
   await this.loaded;
   for (const task of candidates) {
    if (!this.active || !this.store.healthy) return;
    if (!this.pendingDeletes.has(task.operonId) && await verifyRemovedTask(this.deps, task, evidence) && !this.pendingDeletes.has(task.operonId)) await this.store.recordDeletion(task.operonId);
   }
   this.sync();
  } catch (error) { this.warn(error); }
 }
 sync(): void {
  if (!this.active) return;
  const app = this.deps.app, plugin = (app as App & { plugins?: { plugins?: Record<string, unknown> } }).plugins?.plugins?.['obsidian-excalidraw-plugin'];
  const views = new Set(app.workspace.getLeavesOfType('excalidraw').map(leaf => leaf.view as unknown as ExcalidrawTaskView)
   .filter(view => plugin && view.plugin === plugin && view.getViewType?.() === 'excalidraw'));
  for (const [view, binding] of this.bindings) if (!views.has(view) || binding.api !== view.excalidrawAPI) { binding.stop(); this.bindings.delete(view); this.failed.delete(view); }
  for (const view of views) {
   if (this.bindings.has(view) || typeof view.excalidrawAPI?.onChange !== 'function') continue;
   const binding = { api: view.excalidrawAPI, stop: () => {}, signature: '' };
   binding.stop = view.excalidrawAPI.onChange(elements => {
    const native = view as ExcalidrawTaskView & { isSynchronizing?: boolean; isSameFileEditingActive?(): boolean };
    const signature = JSON.stringify([view.file?.path, view.excalidrawAPI.getAppState().viewModeEnabled, native.isSynchronizing, native.isSameFileEditingActive?.(), view.excalidrawAPI.getAppState().activeEmbeddable,
     elements.filter(element => element.type === 'embeddable').map(element => [element.id, element.isDeleted, element.link, element.version, element.customData])]);
    if (signature !== binding.signature) { binding.signature = signature; this.request(); }
   });
   this.bindings.set(view, binding);
  }
  this.request();
 }
 private request(): void {
  if (!this.active) return;
  this.dirty = true;
  if (this.busy || this.scheduled) return;
  this.scheduled = true;
  void Promise.resolve().then(async () => {
   this.scheduled = false; this.busy = true; this.dirty = false;
   try { await this.loaded; if (this.active && this.store.healthy) await this.reconcile(); }
   catch (error) { this.warn(error); }
   finally { this.busy = false; if (this.dirty && this.active) this.request(); }
  });
 }
 private async reconcile(): Promise<void> {
  await this.deps.awaitSettlement();
  if (!this.active || !this.store.healthy) return;
  for (const id of this.uncertainDeletes) if (this.deps.taskState(id) === 'ready') this.uncertainDeletes.delete(id);
  const state = this.store.snapshot();
  const revived = new Set(state.deletions.filter(entry => this.deps.taskState(entry.taskId) === 'ready').map(entry => entry.taskId));
  if (revived.size) await this.store.change(next => { next.deletions = next.deletions.filter(entry => !revived.has(entry.taskId)); });
  const files = new Set<TFile>();
  for (const view of this.bindings.keys()) if (readExcalidrawTaskView(this.deps.app, view) && view.file && view.excalidrawAPI.getAppState().viewModeEnabled === false && !files.has(view.file)) {
   files.add(view.file);
   if (this.failed.get(view) === view.file) continue;
   const file = view.file, path = file.path;
   try { await serializeExcalidrawSource(this.deps.app, file, () => {
    if (view.file !== file || file.path !== path) { this.dirty = true; return Promise.resolve(); }
    return this.reconcileDrawing(view);
   }); }
   catch (error) { if (view.file) this.failed.set(view, view.file); this.warn(error); }
  }
 }
 private canRemove(id: string): boolean { return !this.pendingDeletes.has(id) && !this.uncertainDeletes.has(id) && this.deps.taskState(id) === 'missing'; }
 private current(view: ExcalidrawTaskView, file: TFile): boolean {
  return this.active && this.store.healthy && this.bindings.has(view) && readExcalidrawTaskView(this.deps.app, view) === view
   && view.file === file && this.deps.app.vault.getAbstractFileByPath(file.path) === file && view.excalidrawAPI.getAppState().viewModeEnabled === false;
 }
 private async reconcileDrawing(view: ExcalidrawTaskView): Promise<void> {
  const file = view.file; if (!file || !this.current(view, file)) return;
  const path = file.path, current = () => file.path === path && this.current(view, file);
  const state = this.store.snapshot(), deletions = new Map(state.deletions.map(entry => [entry.taskId, entry.token]));
  const records = state.cards.filter(card => card.drawingPath === file.path);
  const hasRemoval = view.excalidrawAPI.getSceneElements().some(element => !element.isDeleted && deletions.has(taskId(element) ?? '') && this.canRemove(taskId(element) ?? ''));
  if (!hasRemoval && !records.some(record => this.deps.taskState(record.taskId) === 'ready' || record.status !== 'removed')) return;
  // Wait for another pane of this drawing to finish loading; readiness changes
  // reconnect through sync(), rather than permanently failing a healthy drawing.
  if (this.deps.app.workspace.getLeavesOfType('excalidraw').some(leaf => {
   const peer = leaf.view as unknown as ExcalidrawTaskView;
   return peer.file === file && peer.plugin === view.plugin && !readExcalidrawTaskView(this.deps.app, peer);
  })) return;
  if (typeof view.excalidrawAPI.getSceneElementsIncludingDeleted !== 'function') throw new Error('Native deleted-element API unavailable');
  const peers = [...this.bindings.keys()].filter(peer => peer.file === file && this.current(peer, file));
  for (const peer of peers) {
   const native = peer as ExcalidrawTaskView & { isSynchronizing?: boolean; isSameFileEditingActive?(): boolean };
   if (native.isSynchronizing) return;
   const active = peer.excalidrawAPI.getAppState().activeEmbeddable;
   const card = active && peer.excalidrawAPI.getSceneElements().find(element => element.id === active.element.id);
   const readOnlyCard = card && isRecord(card.customData) && isRecord(card.customData.mdProps) && card.customData.mdProps.lockedReadingMode === true
    && isExcalidrawTaskLink(this.deps.app, peer, card.link, taskId(card) ?? '');
   if (native.isSameFileEditingActive?.() && !readOnlyCard) return;
  }
  const scenesAgree = () => {
   const signature = JSON.stringify(view.excalidrawAPI.getSceneElements().map(cleanupElementSignature));
   return peers.every(peer => JSON.stringify(peer.excalidrawAPI.getSceneElements().map(cleanupElementSignature)) === signature);
  };
  // Native peer autosave must settle before we save one view over another's newer scene.
  if (!scenesAgree()) return;
  if (!await saveExcalidrawTaskSceneInQueue(this.deps.app, view, current)) return;
  if (!current()) { this.dirty = true; return; }
  const all = view.excalidrawAPI.getSceneElementsIncludingDeleted(), byId = new Map(all.map(element => [element.id, element]));
  const settled: ExcalidrawCleanupCard[] = [], remove: ExcalidrawCleanupCard[] = [], restore: ExcalidrawCleanupCard[] = [], retire = new Set<string>();
  for (const record of records) {
   const existing = byId.get(record.element.id);
   if (!existing && record.status === 'prepared') throw new Error('Interrupted removal has no native ownership evidence');
   const superseded = peers.map(peer => peer.excalidrawAPI.getSceneElementsIncludingDeleted?.().find(element => element.id === record.element.id))
    .find(element => element && (!owned(element, record.token) || cleanupElementSignature(element) !== cleanupElementSignature(record.element)));
   if (superseded) {
    // A user edit or manual deletion supersedes our snapshot. Never overwrite it on restore.
    if (superseded.isDeleted || this.deps.taskState(record.taskId) === 'ready') retire.add(record.element.id);
    continue;
   }
   if (this.canRemove(record.taskId) && (!existing || existing.isDeleted) && (record.status === 'applied' || existing && owned(existing, record.token))) settled.push(record);
   if (this.deps.taskState(record.taskId) === 'ready' && (record.status !== 'prepared' || existing && owned(existing, record.token))) {
    if (isExcalidrawTaskLink(this.deps.app, view, record.element.link, record.taskId)) restore.push(record);
   }
  }
  for (const element of all) {
   const id = taskId(element), token = id && deletions.get(id);
   if (!id || !token || element.isDeleted || !this.canRemove(id) || !isExcalidrawTaskLink(this.deps.app, view, element.link, id) || element.type !== 'embeddable') continue;
   const snapshot = cloneCleanupValue(element); if (isRecord(snapshot.customData)) delete snapshot.customData[marker];
   const order = all.indexOf(element);
   remove.push({ taskId: id, token, drawingPath: path, element: snapshot, status: 'prepared', order,
    precedingId: all[order - 1]?.id, followingId: all[order + 1]?.id });
  }
  if (settled.length) {
   const ea = view.plugin.ea.getAPI(view);
   let persisted: Awaited<ReturnType<typeof ea.getSceneFromFile>>;
   try { persisted = await ea.getSceneFromFile(file); } finally { ea.destroy(); }
   if (!current()) { this.dirty = true; return; }
   if (!persisted) throw new Error('Interrupted cleanup save unavailable');
   const verified = new Set(settled.filter(record => this.canRemove(record.taskId) && !persisted.elements.some(element => element.id === record.element.id && !element.isDeleted)).map(record => record.element.id));
   if (verified.size) await this.store.change(next => { for (const record of next.cards) if (record.drawingPath === path && verified.has(record.element.id)) record.status = 'removed'; });
  }
  if (retire.size) await this.store.change(next => { next.cards = next.cards.filter(card => card.drawingPath !== file.path || !retire.has(card.element.id)); });
  if (!remove.length && !restore.length) return;
  const changed = [...remove, ...restore], removing = new Set(remove.map(record => record.element.id));
  for (const peer of peers) for (const record of changed) {
   const element = peer.excalidrawAPI.getSceneElements().find(value => value.id === record.element.id);
   if (element && cleanupElementSignature(element) !== cleanupElementSignature(record.element)) return;
  }
  if (remove.length) await this.store.change(next => {
   for (const record of remove) { next.cards = next.cards.filter(card => card.drawingPath !== file.path || card.element.id !== record.element.id); next.cards.push(record); }
  });
  const valid = () => {
   const tokens = new Map(this.store.snapshot().deletions.map(entry => [entry.taskId, entry.token]));
   return current() && remove.every(record => this.canRemove(record.taskId) && tokens.get(record.taskId) === record.token)
    && restore.every(record => this.deps.taskState(record.taskId) === 'ready');
  };
  if (!scenesAgree()) return;
  if (!valid()) { this.dirty = true; return; }
  for (const peer of peers) {
   if (!this.current(peer, file) || !valid()) { this.dirty = true; return; }
   for (const record of changed) {
    const existing = peer.excalidrawAPI.getSceneElementsIncludingDeleted?.().find(element => element.id === record.element.id);
    if (existing && cleanupElementSignature(existing) !== cleanupElementSignature(record.element)) { this.dirty = true; return; }
   }
   if (typeof peer.updateScene !== 'function' || typeof peer.setDirty !== 'function' || typeof peer.excalidrawAPI.getSceneElementsIncludingDeleted !== 'function') throw new Error('Native scene editing API unavailable');
   const scene = [...peer.excalidrawAPI.getSceneElementsIncludingDeleted()];
   for (const record of changed) {
    const at = scene.findIndex(element => element.id === record.element.id), previous = at >= 0 ? scene[at] : undefined;
    const element = cloneCleanupValue(record.element);
    element.version = Math.max(Number(previous?.version) || 0, Number(element.version) || 0) + 1;
    element.versionNonce = Math.floor(Math.random() * 2147483647); element.updated = Date.now();
    element.isDeleted = removing.has(element.id);
    if (element.isDeleted) element.customData = { ...(isRecord(element.customData) ? element.customData : {}), [marker]: record.token };
    if (at >= 0) scene[at] = element;
    else {
     const after = scene.findIndex(value => value.id === record.followingId), before = scene.findIndex(value => value.id === record.precedingId);
     scene.splice(after >= 0 ? after : before >= 0 ? before + 1 : Math.min(record.order ?? scene.length, scene.length), 0, element);
    }
   }
   const active = peer.excalidrawAPI.getAppState().activeEmbeddable;
   peer.updateScene({ elements: scene, captureUpdate: 'NEVER', ...(active && removing.has(active.element.id) ? { appState: { activeEmbeddable: null } } : {}) });
   peer.setDirty();
   // Keep existing arrows; refresh native endpoints after a bound card changes.
   if (changed.some(record => Array.isArray(record.element.boundElements) && record.element.boundElements.length)) peer.excalidrawAPI.refreshAllArrows?.();
  }
  if (!current()) { this.dirty = true; return; }
  if (remove.length) await this.store.change(next => { for (const record of remove) {
   const saved = next.cards.find(card => card.drawingPath === path && card.element.id === record.element.id && card.token === record.token);
   if (saved) saved.status = 'applied';
  } });
  if (!current()) { this.dirty = true; return; }
  if (!await saveExcalidrawTaskSceneInQueue(this.deps.app, view, current)) return;
  if (!current()) { this.dirty = true; return; }
  const ea = view.plugin.ea.getAPI(view);
  let saved: Awaited<ReturnType<typeof ea.getSceneFromFile>>;
  try { saved = await ea.getSceneFromFile(file); } finally { ea.destroy(); }
  if (!current() || !saved) throw new Error('Native cleanup save unavailable');
  for (const record of changed) {
   const persisted = saved.elements.find(element => element.id === record.element.id && !element.isDeleted);
   if (removing.has(record.element.id) ? !!persisted : !persisted || cleanupElementSignature(persisted) !== cleanupElementSignature(record.element)) throw new Error('Native cleanup save not verified');
  }
  await this.store.change(next => {
   for (const record of remove) {
    const savedCard = next.cards.find(card => card.drawingPath === file.path && card.element.id === record.element.id && card.token === record.token);
    if (savedCard) savedCard.status = 'removed';
   }
   const restored = new Set(restore.map(record => record.element.id));
   next.cards = next.cards.filter(card => card.drawingPath !== file.path || !restored.has(card.element.id));
  });
 }
 private warn(error: unknown): void {
  if (!this.active) return;
  console.warn('Operon: Excalidraw card cleanup deferred.', error);
  if (!this.warned) { this.warned = true; new Notice(t('notifications', 'excalidrawTaskCleanupDeferred')); }
 }
 destroy(): void { this.active = false; for (const binding of this.bindings.values()) binding.stop(); this.bindings.clear(); for (const stop of this.stops) stop(); this.stops = []; }
}
