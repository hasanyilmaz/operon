import { Component, Menu } from 'obsidian';
import { t } from '../core/i18n';
import { getOwnerWindow } from '../core/dom-compat';
import { bindExcalidrawPoolTheme } from './excalidraw-pool-theme';
import { excalidrawSceneTaskId, type ExcalidrawTaskAPI, type ExcalidrawTaskView } from './excalidraw-task-bridge';
import { captureExcalidrawDropConnection, currentExcalidrawDropArrow, type ExcalidrawDropConnection } from './excalidraw-task-drop-connection';
import type { RelationArrow } from './excalidraw-edge-relation-geometry';
import type { TaskCardEmbeds } from './task-card-embed';

type PointerView = ExcalidrawTaskView & { onPointerUpdate(event: { button?: string }): void };
/** Watches only native arrow creation gestures; opening or importing a scene never offers creation. */
export class ExcalidrawTaskDropMenu extends Component {
 private active = false;
 private api: ExcalidrawTaskAPI | null = null;
 private stop: (() => void) | null = null;
 private frame = 0;
 private menu: Menu | null = null;
 private menuCurrent: (() => boolean) | null = null;
 private theme: Component | null = null;
 private gesture: { ids: Set<string>; file: ExcalidrawTaskView['file']; path: string; api: ExcalidrawTaskAPI; arrowId?: string; released: boolean } | null = null;
 constructor(private view: ExcalidrawTaskView, private cards: TaskCardEmbeds, private allowed: () => boolean,
  private create: (connection: ExcalidrawDropConnection) => void) { super(); }
 onload(): void {
  const view = this.view as Partial<PointerView>, original = view.onPointerUpdate;
  if (typeof original !== 'function') return;
  this.active = true;
  const descriptor = Object.getOwnPropertyDescriptor(view, 'onPointerUpdate');
  const wrapper: PointerView['onPointerUpdate'] = event => { original.call(view, event); if (event.button === 'up' && this.gesture) this.gesture.released = true; this.schedule(); };
  view.onPointerUpdate = wrapper;
  this.register(() => { if (view.onPointerUpdate === wrapper) { if (descriptor) Object.defineProperty(view, 'onPointerUpdate', descriptor); else Reflect.deleteProperty(view, 'onPointerUpdate'); } });
  this.registerDomEvent(this.view.contentEl, 'pointerdown', event => {
   if (event.button !== 0 || !event.isPrimary || !(event.target as Element)?.closest?.('canvas')) return;
   this.closeMenu(); this.sync();
   if (!this.allowed() || !this.api) return;
   const state = this.api.getAppState(), tool = state.activeTool as { type?: string } | undefined;
   if (tool?.type !== 'arrow') return;
   if (!this.gesture) this.gesture = { ids: new Set(this.api.getSceneElements().map(value => value.id)), file: this.view.file, path: this.view.file!.path, api: this.api, released: false };
   else this.gesture.released = false;
  }, true);
  const win = getOwnerWindow(this.view.contentEl);
  this.registerDomEvent(win, 'pointerup', () => { if (this.gesture) this.gesture.released = true; this.schedule(); });
  this.registerDomEvent(win, 'pointercancel', () => this.cancel());
  this.registerDomEvent(win, 'blur', () => this.cancel());
  this.registerDomEvent(this.view.contentEl, 'keydown', event => { if (event.key === 'Escape') this.cancel(); });
  this.sync();
 }
 sync(): void {
  if (!this.active) return;
  const api = this.view.excalidrawAPI;
  if (api !== this.api) { this.cancel(); this.stop?.(); this.api = api; this.stop = typeof api?.onChange === 'function' ? api.onChange(() => this.observe()) : null; }
  if (!this.allowed()) this.cancel();
  this.observe();
 }
 private observe(): void {
  if (this.menuCurrent && !this.menuCurrent()) this.closeMenu();
  const gesture = this.gesture;
  if (!gesture) return;
  if (!this.allowed() || gesture.file !== this.view.file || gesture.path !== this.view.file?.path || gesture.api !== this.view.excalidrawAPI) { this.cancel(); return; }
  const state = gesture.api.getAppState();
  const creating = (state.newElement ?? state.draggingElement ?? state.multiElement) as RelationArrow | null;
  if (creating?.type === 'arrow' && !gesture.ids.has(creating.id)) gesture.arrowId = creating.id;
  this.schedule();
 }
 private schedule(): void {
  if (!this.active || this.frame || !this.gesture) return;
  this.frame = getOwnerWindow(this.view.contentEl).requestAnimationFrame(() => { this.frame = 0; this.finish(); });
 }
 private finish(): void {
  const gesture = this.gesture; if (!gesture || !gesture.released) return;
  if (!this.allowed() || gesture.file !== this.view.file || gesture.path !== this.view.file?.path || gesture.api !== this.view.excalidrawAPI) { this.cancel(); return; }
  const state = gesture.api.getAppState();
  if (state.newElement || state.draggingElement || state.multiElement) return;
  this.gesture = null;
  const elements = gesture.api.getSceneElements();
  const arrow: RelationArrow | undefined = elements.find(value => value.id === gesture.arrowId);
  const source = arrow && elements.find(value => value.id === arrow.startBinding?.elementId);
  if (!arrow || !source) return;
  const id = excalidrawSceneTaskId(this.cards.deps.app, this.view, source);
  if (!id || this.cards.resolve(id).state !== 'ready') return;
  const connection = captureExcalidrawDropConnection(arrow, source, id); if (!connection || !currentExcalidrawDropArrow(this.view, connection)) return;
  const zoom = (state.zoom as { value?: number })?.value, { offsetLeft, offsetTop, scrollX, scrollY } = state;
  if (![zoom, offsetLeft, offsetTop, scrollX, scrollY].every(value => typeof value === 'number' && Number.isFinite(value)) || !zoom || zoom <= 0) return;
  const current = () => this.allowed() && gesture.file === this.view.file && gesture.path === this.view.file?.path && gesture.api === this.view.excalidrawAPI
   && !!currentExcalidrawDropArrow(this.view, connection) && this.cards.resolve(id).state === 'ready'
   && excalidrawSceneTaskId(this.cards.deps.app, this.view, gesture.api.getSceneElements().find(value => value.id === source.id) ?? { id: '', type: '' }) === id;
  let chosen = false;
  this.menuCurrent = current;
  const menu = this.menu = new Menu();
  menu.addItem(item => item.setTitle(t('commands', 'addOperonTask')).setIcon('id-card').onClick(() => {
   if (!chosen && current()) { chosen = true; this.create(connection); }
  }));
  menu.onHide(() => { if (this.menu === menu) { this.menu = null; this.menuCurrent = null; this.clearTheme(); } });
  menu.showAtPosition({ x: (connection.point.x + Number(scrollX)) * zoom + Number(offsetLeft), y: (connection.point.y + Number(scrollY)) * zoom + Number(offsetTop) }, this.view.contentEl.ownerDocument);
  const dom = Reflect.get(menu, 'dom') as HTMLElement | undefined;
  if (dom?.style) { this.theme = new Component(); this.addChild(this.theme); bindExcalidrawPoolTheme(this.view.contentEl, dom, this.theme); }
 }
 private clearTheme(): void { if (this.theme) this.removeChild(this.theme); this.theme = null; }
 private closeMenu(): void { this.menu?.hide(); this.menu = null; this.menuCurrent = null; this.clearTheme(); }
 private cancel(): void { this.gesture = null; this.closeMenu(); }
 onunload(): void { this.active = false; this.cancel(); this.stop?.(); this.stop = null; if (this.frame) getOwnerWindow(this.view.contentEl).cancelAnimationFrame(this.frame); this.frame = 0; }
}
