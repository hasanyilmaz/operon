import { Component, Notice, Platform, TFile, getIcon, type App } from 'obsidian';
import { t } from '../core/i18n';
import { planCanvasGroupSync } from '../core/canvas-group-sync';
import { groupCanvasTaskIds, readGroupCanvasDocument, writeGroupCanvasDocument, type GroupCanvasDocument } from '../core/canvas-group-document';
import type { GroupSettings, GroupTaskState } from '../core/canvas-group-rule';
import type { IndexReconciliationEvent } from '../indexer/indexer';
import type { CanvasGroupSyncCoordinator } from '../ui/canvas-group-sync';
import { loadAgentRuntimeDesktopNodeApiV1 } from '../agent-runtime/transport/desktop-node-api';
import { isCanonicalPathWithinRootV1 } from '../agent-runtime/transport/vault-path-identity';

/** Canvas admission is plugin-internal; Runtime task mutation remains Markdown-only. */
export async function canWriteGroupCanvas(app: App, path: string, validatePath: (path: string) => unknown, load = loadAgentRuntimeDesktopNodeApiV1): Promise<boolean> {
 try {
  if (validatePath(path) || !path.endsWith('.canvas')) return false;
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile) || file.path !== path || file.extension !== 'canvas') return false;
  if (!Platform.isDesktop) return Platform.isMobile;
  const adapter = app.vault.adapter as unknown as { getFullPath?(path: string): string };
  if (!adapter.getFullPath) return false;
  const api = await load(), root = await api.realpath(adapter.getFullPath('')), target = await api.realpath(adapter.getFullPath(path));
  return isCanonicalPathWithinRootV1(root, target, api.platform);
 } catch { return false; }
}

export interface CanvasGroupBackgroundDependencies {
 ready(): Promise<boolean>;
 revision(): number | null;
 subscribe(listener: (event: IndexReconciliationEvent) => void): () => void;
 canWrite(path: string): Promise<boolean>;
 settings(): GroupSettings;
 resolve(id: string): GroupTaskState;
}
interface Source { file: TFile; content: string; data: GroupCanvasDocument; ids: Set<string> }
const STALE = new Error('Stale closed Canvas');
const settingsKey = (settings: GroupSettings) => JSON.stringify([settings.keyMappings, settings.pipelines, settings.priorities, settings.colorPalette]);

/** Memory-only reverse references. Closed files share the same routing planner as live views. */
export class CanvasGroupBackground extends Component {
 private active = false;
 private timer: number | null = null;
 private running: Promise<void> | null = null;
 private sources = new Map<string, Source>();
 private references = new Map<string, Set<string>>();
 private dirty = new Set<string>();
 private reload = new Set<string>();
 private waiting = new Set<string>();
 private failed = new Set<string>();
 private notified = new Set<string>();
 private writing = new Set<string>();
 private configuration = '';
 private open = new Set<string>();
 readonly counts = { reads: 0, writes: 0, evaluated: 0 };
 constructor(private app: App, private deps: CanvasGroupBackgroundDependencies, private coordinator: CanvasGroupSyncCoordinator, private clock: Pick<Window, 'setTimeout' | 'clearTimeout'> = window) { super(); }
 onload(): void {
  this.active = true; this.configuration = settingsKey(this.deps.settings());
  for (const file of this.app.vault.getFiles()) if (file.extension === 'canvas') this.enqueue(file.path, true);
  this.register(this.deps.subscribe(event => {
   // Open views own their native mutations, but need the same committed-index
   // signal even when no visible card renderer or general UI refresh runs.
   this.coordinator.tasksChanged(event.kind === 'full' ? undefined : new Set(event.affectedOperonIds));
   const paths = event.kind === 'full' ? this.sources.keys() : new Set(event.affectedOperonIds.flatMap(id => [...this.references.get(id) ?? []]));
   for (const path of paths) this.enqueue(path);
  }));
  this.register(this.coordinator.onWake(() => {
   this.refresh();
   for (const path of this.waiting) this.dirty.add(path);
   this.waiting.clear(); this.schedule();
  }));
  this.registerEvent(this.app.vault.on('create', file => { if (file instanceof TFile && file.extension === 'canvas') this.enqueue(file.path, true); }));
  this.registerEvent(this.app.vault.on('modify', file => {
   if (file instanceof TFile && file.extension === 'canvas' && !this.writing.has(file.path)) this.enqueue(file.path, true);
  }));
  this.registerEvent(this.app.vault.on('delete', file => this.remove(file.path)));
  this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
   this.coordinator.rename(oldPath, file.path);
   this.remove(oldPath);
   if (file instanceof TFile && file.extension === 'canvas') this.enqueue(file.path, true);
   else for (const item of this.app.vault.getFiles()) if (item.extension === 'canvas' && item.path.startsWith(file.path + '/')) this.enqueue(item.path, true);
  }));
  this.schedule();
 }
 /** Settings notifications and workspace changes do not require a vault rescan. */
 refresh(): void {
  if (!this.active) return;
  const key = settingsKey(this.deps.settings());
  if (key !== this.configuration) { this.configuration = key; for (const path of this.sources.keys()) this.enqueue(path); }
  const open = new Set([...this.sources.keys()].filter(path => this.coordinator.isOpen(path)));
  for (const path of this.open) if (!open.has(path)) this.enqueue(path, true);
  this.open = open;
 }
 private enqueue(path: string, reload = false): void {
  if (!this.active || !path.endsWith('.canvas')) return;
  this.dirty.add(path); if (reload) this.reload.add(path); this.schedule();
 }
 private schedule(): void {
  if (!this.active || this.timer !== null || this.running || !this.dirty.size) return;
  this.timer = this.clock.setTimeout(() => { this.timer = null; void this.flush(); }, 100);
 }
 /** Also used by deterministic persistence fixtures; one bounded batch owns the queue. */
 async flush(): Promise<void> {
  if (this.running) return this.running;
  this.running = this.drain();
  try { await this.running; } finally { this.running = null; this.schedule(); }
 }
 private async drain(): Promise<void> {
  if (!this.active || !await this.deps.ready() || !this.active) return;
  let count = 0;
  while (this.active && this.dirty.size) {
   const path = this.dirty.values().next().value as string;
   this.dirty.delete(path);
   try { await this.reconcile(path); } catch (error) { this.failed.add(path); this.report(path, error); }
   if (++count % 4 === 0) await new Promise<void>(resolve => this.clock.setTimeout(resolve, 0));
  }
 }
 private report(path: string, error?: unknown): void {
  if (this.notified.has(path) || !this.active) return;
  this.notified.add(path);
  new Notice(t('notifications', 'canvasChangedSaveFailed') + '\n' + path);
  if (error) console.error('Operon: closed Canvas reconciliation failed', path, error);
 }
 private remove(path: string): void {
  for (const key of new Set([...this.sources.keys(), ...this.dirty])) if (key === path || key.startsWith(path + '/')) {
   this.unindex(key); this.dirty.delete(key); this.reload.delete(key); this.failed.delete(key); this.waiting.delete(key); this.open.delete(key); this.coordinator.forget(key);
  }
 }
 private unindex(path: string): void {
  for (const id of this.sources.get(path)?.ids ?? []) {
   const paths = this.references.get(id); paths?.delete(path); if (!paths?.size) this.references.delete(id);
  }
  this.sources.delete(path);
 }
 private remember(path: string, file: TFile, content: string, data: GroupCanvasDocument): Source {
  this.unindex(path);
  const source = { file, content, data, ids: groupCanvasTaskIds(data) }; this.sources.set(path, source);
  for (const id of source.ids) { let paths = this.references.get(id); if (!paths) this.references.set(id, paths = new Set()); paths.add(path); }
  return source;
 }
 private async read(file: TFile): Promise<string> { this.counts.reads++; return this.app.vault.read(file); }
 private async reconcile(path: string): Promise<void> {
  const file = this.app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile) || file.extension !== 'canvas') { this.remove(path); return; }
  const current = () => this.active && file.path === path && this.app.vault.getAbstractFileByPath(path) === file;
  let source = this.sources.get(path);
  if (this.reload.delete(path) || !source || source.file !== file) {
   const content = await this.read(file); if (!current()) return;
   if (!source || content !== source.content) {
    const data = readGroupCanvasDocument(content);
    this.coordinator.forget(path);
    if (!data) { this.unindex(path); this.report(path); return; }
    source = this.remember(path, file, content, data);
   }
  }
  if (!source || this.failed.has(path)) return;
  if (this.coordinator.isOpen(path)) { this.open.add(path); return; }
  const release = this.coordinator.acquireClosed(path);
  if (!release) { this.waiting.add(path); return; }
  try {
   if (!await this.deps.ready() || !current() || this.coordinator.isOpen(path)) return;
   const revision = this.deps.revision(); if (revision === null) return;
   const settings = this.deps.settings(), configuration = settingsKey(settings);
   const tasks = new Map([...source.ids].map(id => [id, this.deps.resolve(id)]));
   const taskKey = JSON.stringify([...tasks]);
   this.counts.evaluated++;
   const plan = planCanvasGroupSync({ nodes: source.data.nodes, edges: source.data.edges, settings, resolve: id => tasks.get(id) ?? { state: 'missing' }, validation: { iconExists: name => !!getIcon(name) } });
   if (!plan.patches.length && !plan.groups.length && !plan.removals.length) return;
   const before = source.content, after = writeGroupCanvasDocument(before, source.data, plan, () => crypto.randomUUID());
   if (!await this.deps.canWrite(path)) throw new Error('Canvas write access unavailable');
   if (!current()) return;
   const allowed = () => current() && !this.coordinator.isOpen(path) && this.deps.revision() === revision
    && settingsKey(this.deps.settings()) === configuration && JSON.stringify([...source.ids].map(id => [id, this.deps.resolve(id)])) === taskKey;
   if (!allowed()) { if (current()) this.enqueue(path); return; }
   let attempted = false;
   const committed = () => {
    if (!this.active || this.app.vault.getAbstractFileByPath(file.path) !== file) return;
    // A rename after the atomic callback changes the handoff path, not its verified result.
    this.remember(file.path, file, after, readGroupCanvasDocument(after)!);
    this.coordinator.closedCommitted(file.path, before, after);
   };
   this.writing.add(path);
   try {
    await this.app.vault.process(file, content => {
     if (content !== before || !allowed()) throw STALE;
     attempted = true; this.counts.writes++; return after;
    });
    const observed = await this.read(file);
    if (observed !== after) throw new Error('Canvas changed after write');
    committed();
    if (this.active) {
     if (plan.unavailable.length && !this.notified.has(path)) { this.notified.add(path); new Notice(t('notifications', 'canvasChangedValueUnavailable') + '\n' + path); }
    }
   } catch (error) {
    if (error === STALE && !attempted) { if (current()) this.enqueue(path, true); return; }
    // Never replay a write with an uncertain transport result. Observe the source once.
    let observed: string | undefined;
    try { observed = await this.read(file); } catch { /* Uncertain: leave the file untouched. */ }
    if (observed === after) {
     committed();
    } else { this.failed.add(path); if (observed !== before) this.coordinator.closedUncertain(file.path); this.report(path, error); }
   } finally { this.writing.delete(path); }
  } finally { release(); }
 }
 onunload(): void {
  this.active = false; if (this.timer !== null) this.clock.clearTimeout(this.timer); this.timer = null;
  this.dirty.clear(); this.waiting.clear(); this.reload.clear(); this.sources.clear(); this.references.clear();
 }
}
