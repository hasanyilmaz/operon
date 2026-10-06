import { ExcalidrawTaskDropMenu } from './excalidraw-task-drop-menu';
import { currentExcalidrawDropArrow, type ExcalidrawDropConnection } from './excalidraw-task-drop-connection';
import { normalizeTaskCardSettings } from '../types/task-card';
import { ExcalidrawEdgeRelations } from './excalidraw-edge-relations';
import type { TaskEdgeRelationOperations } from './task-edge-relation-controls';
import { ExcalidrawTaskCleanup, type ExcalidrawCleanupDeps, type TaskRemovalEvidence } from './excalidraw-task-cleanup';
import type { IndexedTask } from '../types/fields';
import { ExcalidrawPropertyPool } from './excalidraw-property-pool';
import type { CanvasPropertyValuePoolPreferences } from './surface-property-value-pool';
import { bindExcalidrawPoolTheme } from './excalidraw-pool-theme';
import { ExcalidrawTaskPool, excalidrawPoolScenePoint, type ExcalidrawFileAction } from './excalidraw-task-pool';
import type { TaskPoolTarget } from './surface-task-pool';
import { bindExcalidrawCreationMenu } from './excalidraw-task-menu';
import type { ExcalidrawTaskView, ExcalidrawTaskElement, ExcalidrawTextReplacement } from './excalidraw-task-bridge';
import { Component, ItemView, Notice, type App, type TFile } from 'obsidian';
import { t } from '../core/i18n';
import type { TaskCardEmbeds } from './task-card-embed';
import { ExcalidrawTaskSaveError, excalidrawSceneTaskId, excalidrawConvertibleText, insertExcalidrawTask, readExcalidrawTaskView } from './excalidraw-task-bridge';

export class ExcalidrawTaskIntegration extends Component {
 private dropMenus = new Map<ExcalidrawTaskView, ExcalidrawTaskDropMenu>();
 private cleanup: ExcalidrawTaskCleanup | null = null;
 private active = false;
 private pending = false;
 private relations = new Map<ExcalidrawTaskView, ExcalidrawEdgeRelations>();
 private pools = new Map<ExcalidrawTaskView, ExcalidrawTaskPool<TaskPoolTarget>>();
 private menus = new Map<ExcalidrawTaskView, () => void>();
 private unsupported = new WeakSet<ExcalidrawTaskView>();
 constructor(private deps: TaskEdgeRelationOperations & { cleanup?: ExcalidrawCleanupDeps; app: App; cards: TaskCardEmbeds; openFinder(select: (id: string) => void | Promise<void>): void;
  fileAction?(file: TFile, readOnly: boolean): ExcalidrawFileAction | null;
  propertyValuePool?: CanvasPropertyValuePoolPreferences;
  openCreator?(allowed: () => boolean, created: (id: string) => Promise<void>, view?: ExcalidrawTaskView, text?: string, parentId?: string): void }) { super(); }
 onload(): void {
  this.active = true;
  if (this.deps.cleanup) this.cleanup = new ExcalidrawTaskCleanup(this.deps.cleanup);
  this.register(this.deps.cards.onRefresh(() => { for (const pool of this.pools.values()) pool.refreshFileAction(); this.cleanup?.sync(); }));
  const workspace = this.deps.app.workspace;
  if (typeof workspace.on === 'function') {
   this.registerEvent(workspace.on('layout-change', () => this.sync()));
   this.registerEvent(workspace.on('file-open', () => this.sync()));
   this.registerEvent(workspace.on('active-leaf-change', () => this.sync()));
   workspace.onLayoutReady(() => { if (this.active) this.sync(); });
  }
 }
 onunload(): void { this.active = false; for (const menu of this.dropMenus.values()) this.removeChild(menu); this.dropMenus.clear(); this.cleanup?.destroy(); this.cleanup = null; for (const relations of this.relations.values()) this.removeChild(relations); this.relations.clear(); for (const cleanup of this.menus.values()) cleanup(); this.menus.clear(); for (const pool of this.pools.values()) this.removeChild(pool); this.pools.clear(); }
 beginDeletion(tasks: readonly IndexedTask[]): (committed?: boolean) => void { return this.cleanup?.beginDeletion(tasks) ?? (() => {}); }
 confirmDeleted(tasks: readonly IndexedTask[], evidence: TaskRemovalEvidence): void { void this.cleanup?.confirmRemoved(tasks, evidence); }
 private sync(): void {
  if (!this.active) return;
  // File/layout events can precede scene initialization. Bind the native view method
  // now; the callback checks full drawing readiness only when the menu opens.
  this.cleanup?.sync();
  const app = this.deps.app;
  const plugin = (app as App & { plugins?: { plugins?: Record<string, unknown> } }).plugins?.plugins?.['obsidian-excalidraw-plugin'];
  const views = new Set(app.workspace.getLeavesOfType('excalidraw').map(leaf => leaf.view as unknown as ExcalidrawTaskView)
   .filter(view => !!plugin && view.plugin === plugin && view.getViewType?.() === 'excalidraw'));
  for (const [view, menu] of this.dropMenus) if (!views.has(view)) { this.removeChild(menu); this.dropMenus.delete(view); }
  for (const [view, relations] of this.relations) if (!views.has(view)) { this.removeChild(relations); this.relations.delete(view); }
  for (const [view, cleanup] of this.menus) if (!views.has(view)) { cleanup(); this.menus.delete(view); }
  for (const [view, pool] of this.pools) if (!views.has(view)) { this.removeChild(pool); this.pools.delete(view); }
  for (const view of views) {
   if (this.deps.openCreator && !this.dropMenus.has(view)) {
    const menu = new ExcalidrawTaskDropMenu(view, this.deps.cards, () => this.isCurrent(view), connection => this.createFromArrow(view, connection));
    this.dropMenus.set(view, menu); this.addChild(menu);
   } else this.dropMenus.get(view)?.sync();
   if (!this.relations.has(view)) {
    const relations = new ExcalidrawEdgeRelations(view, { ...this.deps, convertText: this.deps.openCreator ? element => this.convertText(view, element) : undefined }); this.relations.set(view, relations); this.addChild(relations);
   } else this.relations.get(view)?.sync();
   if (!this.pools.has(view) && typeof Reflect.get(view, 'renderTopRightUI') === 'function') this.mountPool(view);
   else this.pools.get(view)?.sync();
   if (this.menus.has(view)) continue;
   const unsupported = () => { if (!this.unsupported.has(view)) { this.unsupported.add(view); new Notice(t('notifications', 'excalidrawMenuUnavailable')); } };
   const cleanup = bindExcalidrawCreationMenu(view, () => this.isCurrent(view), point => { this.create(false, view, point); }, unsupported);
   if (cleanup) this.menus.set(view, cleanup);
   else unsupported();
  }
 }
 private mountPool(view: ExcalidrawTaskView): void {
  const pool = new ExcalidrawTaskPool<TaskPoolTarget>(view, {
   app: this.deps.app, cards: this.deps.cards, contentEl: view.contentEl, menuSurface: 'excalidrawTask',
   bindPanelTheme: (panel, lifetime) => bindExcalidrawPoolTheme(view.contentEl, panel, lifetime),
   title: () => t('settings', 'excalidrawTaskPool'), addLabel: () => t('commands', 'addExistingTaskToExcalidraw'),
   unavailable: () => t('notifications', 'excalidrawTaskUnavailable'), file: () => view.file,
   isCurrent: () => this.isAvailable(view), readOnly: () => !this.isCurrent(view),
   capture: () => {
    if (!this.isCurrent(view) || !view.file) return null;
    const file = view.file, path = file.path;
    let point;
    try { const ea = view.plugin.ea.getAPI(view); try { point = ea.getViewCenterPosition(); } finally { ea?.destroy?.(); } } catch { return null; }
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    return { point: { ...point }, isCurrent: () => this.isCurrent(view) && view.file === file && file.path === path };
   },
   add: (target, id) => this.add(view, id, () => target.isCurrent(), target.point),
   dropPoint: (hit, point) => {
    if (!view.contentEl.contains(hit) || !hit.closest('.excalidraw')
     || hit.closest('button, input, textarea, select, a, .Island, .App-menu, .App-toolbar, .layer-ui__wrapper, .context-menu, .embeddable-menu, .operon-canvas-task-pool, .operon-canvas-property-pool, .operon-floating-panel')) return null;
    return excalidrawPoolScenePoint(view.excalidrawAPI.getAppState(), point);
   },
  }, this.deps.propertyValuePool ? new ExcalidrawPropertyPool(view, this.deps.app, this.deps.cards, this.deps.propertyValuePool, () => this.isAvailable(view)) : undefined, this.deps.fileAction ? () => view.file && this.isAvailable(view) ? this.deps.fileAction!(view.file, !this.isCurrent(view)) : null : undefined, () => { this.cleanup?.sync(); this.relations.get(view)?.sync(); this.dropMenus.get(view)?.sync(); }, this.deps.openCreator ? () => { this.create(false, view); } : undefined);
  this.pools.set(view, pool); this.addChild(pool);
 }
 openPool(checking: boolean, kind: 'task' | 'property' = 'task'): boolean {
  const view = readExcalidrawTaskView(this.deps.app, this.deps.app.workspace.getActiveViewOfType(ItemView));
  if (!view || !this.isAvailable(view)) return false;
  if (checking) return true;
  this.sync();
  const pool = this.pools.get(view);
  if (pool) { if (kind === 'property') pool.requestPropertyOpen(); else pool.requestOpen(); } else new Notice(t('notifications', 'excalidrawPoolUnavailable'));
  return true;
 }
 private async add(view: ExcalidrawTaskView, id: string, allowed: () => boolean, point?: { x: number; y: number }): Promise<boolean> {
  if (this.pending || !this.isCurrent(view) || !allowed() || this.deps.cards.resolve(id).state !== 'ready') { new Notice(t('notifications', 'excalidrawTaskUnavailable')); return false; }
  this.pending = true;
  try { await insertExcalidrawTask(this.deps.app, view, id, () => this.isCurrent(view) && allowed() && this.deps.cards.resolve(id).state === 'ready', point, normalizeTaskCardSettings(this.deps.cards.deps.getSettings()).excalidrawTaskCardWidth); return true; }
  catch (error) { new Notice(t('notifications', error instanceof ExcalidrawTaskSaveError ? 'excalidrawTaskSaveFailed' : 'excalidrawTaskUnavailable')); return false; }
  finally { this.pending = false; }
 }
 private isCurrent(view: ExcalidrawTaskView): boolean {
  return this.isAvailable(view) && view.excalidrawAPI.getAppState().viewModeEnabled === false;
 }
 private isAvailable(view: ExcalidrawTaskView): boolean {
  const { app } = this.deps;
  return this.active && readExcalidrawTaskView(app, view) === view && !!view.file
   && app.vault.getAbstractFileByPath(view.file.path) === view.file
   && app.workspace.getLeavesOfType('excalidraw').some(leaf => leaf.view === (view as unknown));
 }
 create(checking: boolean, target?: ExcalidrawTaskView, position?: { x: number; y: number }): boolean {
  const view = target ?? readExcalidrawTaskView(this.deps.app, this.deps.app.workspace.getActiveViewOfType(ItemView));
  if (!view || !this.isCurrent(view) || view.excalidrawAPI.getAppState().viewModeEnabled !== false || this.pending || !this.deps.openCreator) return false;
  if (checking) return true;
  const context = this.captureCreation(view, position, true);
  if (!context) return false;
  this.deps.openCreator(context.allowed, context.created, view);
  return true;
 }
 private createFromArrow(view: ExcalidrawTaskView, connection: ExcalidrawDropConnection): void {
  if (!this.deps.openCreator) return;
  const context = this.captureCreation(view, connection.point, true, undefined, connection);
  if (context) this.deps.openCreator(context.allowed, context.created, view, '', connection.taskId);
 }
 private convertText(view: ExcalidrawTaskView, element: ExcalidrawTaskElement): void {
  const text = excalidrawConvertibleText(element);
  if (text === null || !this.deps.openCreator) return;
  const context = this.captureCreation(view, { x: element.x ?? NaN, y: element.y ?? NaN }, true, { elementId: element.id, text });
  if (context) this.deps.openCreator(context.allowed, context.created, view, text);
 }
 captureCreation(target?: ExcalidrawTaskView, position?: { x: number; y: number }, notify = false, replacement?: ExcalidrawTextReplacement, connection?: ExcalidrawDropConnection): { view: ExcalidrawTaskView; file: NonNullable<ExcalidrawTaskView['file']>; allowed: () => boolean; created: (id: string) => Promise<void> } | null {
  const view = target ?? readExcalidrawTaskView(this.deps.app, this.deps.app.workspace.getActiveViewOfType(ItemView));
  if (!view || !this.isCurrent(view) || this.pending) return null;
  const file = view.file!, path = file.path, api = view.excalidrawAPI;
  let point = position;
  if (!point) {
   try { const ea = view.plugin.ea.getAPI(view); try { point = ea.getViewCenterPosition() ?? undefined; } finally { ea?.destroy?.(); } }
   catch { if (notify) new Notice(t('notifications', 'excalidrawTaskUnavailable')); return null; }
  }
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) { if (notify) new Notice(t('notifications', 'excalidrawTaskUnavailable')); return null; }
  const captured = { ...point }, current = () => this.isCurrent(view) && view.file === file && file.path === path && view.excalidrawAPI === api;
  const allowed = () => {
   if (!current()) return false;
   if (connection) {
    const source = api.getSceneElements().find(value => value.id === connection.sourceId);
    if (!source || excalidrawSceneTaskId(this.deps.app, view, source) !== connection.taskId || this.deps.cards.resolve(connection.taskId).state !== 'ready' || !currentExcalidrawDropArrow(view, connection)) return false;
   }
   if (!replacement) return true;
   const element = api.getSceneElements().find(value => value.id === replacement.elementId);
   return !!element && excalidrawConvertibleText(element) === replacement.text;
  };
  let consumed = false;
  const created = async (id: string) => {
   if (consumed) return; consumed = true;
   if (this.pending || !this.isCurrent(view) || !allowed() || this.deps.cards.resolve(id).state !== 'ready') { new Notice(t('notifications', 'excalidrawTaskCreatedUnbound')); return; }
   this.pending = true;
   try { await insertExcalidrawTask(this.deps.app, view, id, () => current() && this.deps.cards.resolve(id).state === 'ready', captured, normalizeTaskCardSettings(this.deps.cards.deps.getSettings()).excalidrawTaskCardWidth, replacement, connection); }
   catch { new Notice(t('notifications', 'excalidrawTaskCreatedUnbound')); }
   finally { this.pending = false; }
  };
  return { view, file, allowed, created };
 }
 open(checking: boolean): boolean {
  const { app, cards } = this.deps;
  const view = readExcalidrawTaskView(app, app.workspace.getActiveViewOfType(ItemView));
  if (!this.active || this.pending || !view?.file || view.excalidrawAPI.getAppState().viewModeEnabled !== false) return false;
  if (checking) return true;
  const file = view.file, path = file.path;
  const allowed = () => this.active && readExcalidrawTaskView(app, view) === view && view.file === file && file.path === path
   && app.vault.getAbstractFileByPath(path) === file && app.workspace.getLeavesOfType('excalidraw').some(leaf => leaf.view === (view as unknown));
  let consumed = false;
  this.deps.openFinder(async id => {
   if (consumed || this.pending) return;
   consumed = true;
   if (!allowed() || cards.resolve(id).state !== 'ready') { new Notice(t('notifications', 'excalidrawTaskUnavailable')); return; }
   await this.add(view, id, allowed);
  });
  return true;
 }
}
