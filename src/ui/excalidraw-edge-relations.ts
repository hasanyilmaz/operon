import { Component, Notice, type App, type TFile } from 'obsidian';
import type { TaskCardEmbeds } from './task-card-embed';
import type { IndexedTaskSnapshot } from '../indexer/indexer';
import { bindExcalidrawPoolTheme } from './excalidraw-pool-theme';
import { excalidrawSceneTaskId, readExcalidrawTaskView, type ExcalidrawElementAction, type ExcalidrawTaskAPI,
 type ExcalidrawTaskEA, type ExcalidrawTaskElement, type ExcalidrawTaskState, type ExcalidrawTaskView } from './excalidraw-task-bridge';
import { bindTaskEdgeRelationControl, taskEdgeRelationControls, taskEdgeRelationControlSignature, taskEdgeRelationUnavailable,
 type TaskEdgeRelationControl, type TaskEdgeRelationOperations } from './task-edge-relation-controls';

interface NativeElementMenu {
 menuEl: HTMLElement | null; actionsEl: HTMLElement | null; selectedElementId: string | null;
 update: (elements: readonly ExcalidrawTaskElement[], state: ExcalidrawTaskState) => void;
 renderActions: (actions: readonly ExcalidrawElementAction[]) => void;
}
interface BoundArrow extends ExcalidrawTaskElement {
 startBinding?: { elementId: string } | null; endBinding?: { elementId: string } | null;
}
interface ScenePair { arrow: BoundArrow; start: ExcalidrawTaskElement; end: ExcalidrawTaskElement }
interface TaskPair extends ScenePair { a: IndexedTaskSnapshot; b: IndexedTaskSnapshot }
interface Session {
 active: boolean; file: TFile; path: string; api: ExcalidrawTaskAPI; menu: NativeElementMenu; ea: ExcalidrawTaskEA;
 unregister: (() => void) | null; restore: (() => void) | null; life: Component | null;
 controls: TaskEdgeRelationControl[]; actions: ExcalidrawElementAction[];
 input: string; data: string | null; signature: string; dirty: boolean; busy: boolean;
}
function scenePair(elements: readonly ExcalidrawTaskElement[], state: ExcalidrawTaskState): ScenePair | null {
 const selection = state.selectedElementIds as Record<string, boolean> | undefined;
 const ids = Object.keys(selection ?? {}).filter(id => selection?.[id]);
 if (ids.length !== 1) return null;
 const arrow: BoundArrow | undefined = elements.find(element => element.id === ids[0] && !element.isDeleted);
 if (!arrow || arrow.type !== 'arrow') return null;
 const from = arrow.startBinding?.elementId, to = arrow.endBinding?.elementId;
 if (!from || !to || from === to) return null;
 const start = elements.find(element => element.id === from && !element.isDeleted), end = elements.find(element => element.id === to && !element.isDeleted);
 return start && end ? { arrow, start, end } : null;
}

/** Native selected-element extension; the task relation implementation is shared with Canvas. */
export class ExcalidrawEdgeRelations extends Component {
 private active = false;
 private warned = false;
 private session: Session | null = null;
 private observedAPI: ExcalidrawTaskAPI | null = null;
 private unsupportedMenu: object | null = null;
 private stopScene: (() => void) | null = null;
 constructor(private view: ExcalidrawTaskView, private deps: TaskEdgeRelationOperations & { app: App; cards: TaskCardEmbeds }) { super(); }
 onload(): void {
  this.active = true;
  this.register(this.deps.cards.onRefresh(() => { if (this.session) this.session.dirty = true; this.sync(); }));
  this.sync();
 }
 private warn(): void { if (!this.warned) { this.warned = true; new Notice(taskEdgeRelationUnavailable); } }
 private available(): boolean {
  const { app } = this.deps;
  return this.active && readExcalidrawTaskView(app, this.view) === this.view && !!this.view.file
   && app.vault.getAbstractFileByPath(this.view.file.path) === this.view.file
   && app.workspace.getLeavesOfType('excalidraw').some(leaf => leaf.view === (this.view as unknown));
 }
 sync(): void {
  if (!this.active) return;
  const api = this.view.excalidrawAPI;
  if (api !== this.observedAPI) {
   this.stopScene?.(); this.stopScene = null; this.observedAPI = api; this.unsupportedMenu = null;
   this.release();
   if (typeof api?.onChange === 'function') this.stopScene = api.onChange(() => this.sync());
  }
  if (!this.available()) { this.release(); return; }
  const native = Reflect.get(this.view, 'selectedElementActionsMenu') as Partial<NativeElementMenu> | null;
  const existing = this.session;
  if (existing && (existing.menu !== native || existing.file !== this.view.file || existing.path !== this.view.file?.path)) this.release();
  // The view and scene API precede the React effect which creates the native menu.
  if (!native) {
   if (scenePair(api.getSceneElements(), api.getAppState())) this.warn();
   return;
  }
  if (this.unsupportedMenu === native) return;
  if (typeof native.update !== 'function' || typeof native.renderActions !== 'function' || !('selectedElementId' in native)) { this.release(); this.unsupportedMenu = native; this.warn(); return; }
  if (!this.session) {
   let ea: ExcalidrawTaskEA;
   try { ea = this.view.plugin.ea.getAPI(this.view); } catch { this.unsupportedMenu = native; this.warn(); return; }
   if (typeof ea.registerElementActionProvider !== 'function') { ea.destroy(); this.unsupportedMenu = native; this.warn(); return; }
   const session: Session = { active: true, file: this.view.file!, path: this.view.file!.path, api, menu: native as NativeElementMenu, ea,
    unregister: null, restore: null, life: null, controls: [], actions: [], input: '', data: null, signature: '', dirty: true, busy: false };
   this.session = session;
   try {
    this.bindMenu(session);
    session.unregister = ea.registerElementActionProvider(element => this.current(session) && session.controls.length && element.id === this.selectedPair()?.arrow.id ? session.actions : []);
    if (!session.unregister) { this.release(); this.unsupportedMenu = native; this.warn(); return; }
   } catch { this.release(); this.unsupportedMenu = native; this.warn(); return; }
  }
  if (this.session?.active) this.session.menu.update(api.getSceneElements(), api.getAppState());
 }
 private current(session: Session): boolean {
  return session.active && this.session === session && this.available() && this.view.file === session.file && session.file.path === session.path
   && this.view.excalidrawAPI === session.api && Reflect.get(this.view, 'selectedElementActionsMenu') === session.menu;
 }
 private selectedPair(): ScenePair | null { return scenePair(this.view.excalidrawAPI.getSceneElements(), this.view.excalidrawAPI.getAppState()); }
 private taskPair(pair: ScenePair | null): TaskPair | null {
  if (!pair) return null;
  const from = excalidrawSceneTaskId(this.deps.app, this.view, pair.start), to = excalidrawSceneTaskId(this.deps.app, this.view, pair.end);
  if (!from || !to || from === to) return null;
  const a = this.deps.cards.resolve(from), b = this.deps.cards.resolve(to);
  return a.state === 'ready' && b.state === 'ready' ? { ...pair, a: a.task, b: b.task } : null;
 }
 private prepare(session: Session, elements: readonly ExcalidrawTaskElement[], state: ExcalidrawTaskState): void {
  if (!this.current(session)) return;
  const pair = scenePair(elements, state);
  const input = JSON.stringify([pair?.arrow.id, pair?.arrow.locked, pair?.start.id, pair?.start.link, pair?.start.locked,
   pair?.end.id, pair?.end.link, pair?.end.locked, state.viewModeEnabled, session.busy]);
  if (!session.dirty && session.input === input && session.data === this.view.data) return;
  session.dirty = false; session.input = input; session.data = this.view.data;
  const tasks = this.taskPair(pair);
  const locked = !!pair && [pair.arrow, pair.start, pair.end].some(element => element.locked !== false);
  const controls = tasks ? taskEdgeRelationControls({
   a: tasks.a, b: tasks.b, surface: 'Excalidraw', keyMappings: this.deps.cards.deps.getSettings().keyMappings,
   relationIssue: this.deps.relationIssue, changeRelation: this.deps.changeRelation, readOnly: state.viewModeEnabled !== false, locked,
   parentName: id => { const parent = this.deps.cards.resolve(id); return parent.state === 'ready' ? parent.task.description || id : id; },
   isBusy: () => session.busy,
   setBusy: value => { session.busy = value; if (this.current(session)) { session.dirty = true; this.sync(); } },
   allowed: () => {
    if (!this.current(session) || session.api.getAppState().viewModeEnabled !== false) return false;
    const fresh = this.taskPair(this.selectedPair());
    return !!fresh && fresh.arrow.id === tasks.arrow.id && fresh.start.id === tasks.start.id && fresh.end.id === tasks.end.id
     && fresh.a.operonId === tasks.a.operonId && fresh.b.operonId === tasks.b.operonId
     && [fresh.arrow, fresh.start, fresh.end].every(element => element.locked === false);
   },
  }) : [];
  const signature = JSON.stringify([pair?.arrow.id, pair?.start.id, pair?.end.id, taskEdgeRelationControlSignature(controls)]);
  if (signature === session.signature) return;
  this.clearButtons(session);
  session.signature = signature; session.controls = controls;
  session.actions = controls.map(control => ({ id: control.id, title: control.title, icon: control.icon, action: control.run }));
  // Native caching otherwise misses binding and task changes while the same arrow stays selected.
  session.menu.selectedElementId = null;
 }
 private clearButtons(session: Session): void { if (session.life) this.removeChild(session.life); session.life = null; }
 private bindMenu(session: Session): void {
  const menu = session.menu, originalUpdate = menu.update, originalRender = menu.renderActions;
  const updateDescriptor = Object.getOwnPropertyDescriptor(menu, 'update'), renderDescriptor = Object.getOwnPropertyDescriptor(menu, 'renderActions');
  const update: NativeElementMenu['update'] = (elements, state) => {
   if (this.current(session)) this.prepare(session, elements, state);
   originalUpdate.call(menu, elements, state);
  };
  const render: NativeElementMenu['renderActions'] = actions => {
   const focused = menu.actionsEl?.ownerDocument.activeElement?.getAttribute('data-operon-edge-relation');
   this.clearButtons(session); originalRender.call(menu, actions);
   if (!this.current(session) || !menu.actionsEl || !session.actions.length) return;
   const children = Array.from(menu.actionsEl.children);
   const own = actions.flatMap((action, index) => {
    const model = session.controls.find(control => control.id === action.id && control.run === action.action);
    return model ? [{ model, button: children[index], index }] : [];
   });
   if (!own.length) return;
   // Match the actual native action list, never infer ownership from an icon or a global selector.
   if (children.length !== actions.length || own.length !== session.actions.length || own.some(({ button, index, model }, i) =>
    !button || button.tagName !== 'BUTTON' || button.getAttribute('aria-label') !== model.title || index !== own[0].index + i)) { this.disable(session); return; }
   const life = session.life = new Component(); this.addChild(life);
   const group = menu.actionsEl.createSpan('operon-excalidraw-edge-relations-controls');
   menu.actionsEl.insertBefore(group, own[0].button);
   for (const { button, model } of own) {
    group.appendChild(button);
    bindTaskEdgeRelationControl(button as HTMLButtonElement, model, life, { nativeClick: true,
     bindTheme: tooltip => { const theme = new Component(); theme.load(); bindExcalidrawPoolTheme(this.view.contentEl, tooltip, theme); return () => theme.unload(); },
    });
   }
   bindExcalidrawPoolTheme(this.view.contentEl, group, life);
   if (focused) group.querySelector<HTMLButtonElement>(`[data-operon-edge-relation="${focused}"]`)?.focus({ preventScroll: true });
  };
  try { menu.update = update; menu.renderActions = render; }
  catch {
   if (menu.update === update) { if (updateDescriptor) Object.defineProperty(menu, 'update', updateDescriptor); else Reflect.deleteProperty(menu, 'update'); }
   throw new Error(taskEdgeRelationUnavailable);
  }
  session.restore = () => {
   if (menu.update === update) { if (updateDescriptor) Object.defineProperty(menu, 'update', updateDescriptor); else Reflect.deleteProperty(menu, 'update'); }
   if (menu.renderActions === render) { if (renderDescriptor) Object.defineProperty(menu, 'renderActions', renderDescriptor); else Reflect.deleteProperty(menu, 'renderActions'); }
  };
 }
 private disable(session: Session): void {
  session.active = false; this.unsupportedMenu = session.menu; this.warn();
  // Finish the native render first; stale actions already fail the session guard.
  queueMicrotask(() => { if (this.session === session) this.release(); });
 }
 private release(): void {
  const session = this.session;
  if (!session) return;
  session.active = false; this.session = null; this.clearButtons(session);
  try { session.unregister?.(); }
  finally {
   session.restore?.(); session.ea.destroy();
   if (readExcalidrawTaskView(this.deps.app, this.view) === this.view && this.view.excalidrawAPI === session.api && Reflect.get(this.view, 'selectedElementActionsMenu') === session.menu)
    session.menu.update(session.api.getSceneElements(), session.api.getAppState());
  }
 }
 onunload(): void {
  this.active = false; this.stopScene?.(); this.stopScene = null; this.observedAPI = null; this.unsupportedMenu = null; this.release();
 }
}
