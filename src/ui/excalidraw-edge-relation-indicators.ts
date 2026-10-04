import { Component, setIcon, type App, type TFile } from 'obsidian';
import { getOwnerWindow } from '../core/dom-compat';
import type { TaskRefreshScope } from '../core/task-refresh-scope';
import type { TaskCardEmbeds } from './task-card-embed';
import type { TaskCardResolution } from './task-card-embed-model';
import { bindExcalidrawPoolTheme } from './excalidraw-pool-theme';
import { excalidrawSceneTaskId, type ExcalidrawTaskAPI, type ExcalidrawTaskView } from './excalidraw-task-bridge';
import { taskRelationMarks, type TaskRelationMark } from './task-edge-relation-marks';
import { relationArrowGeometryKey, relationArrowRoute, type RelationArrow, type RelationRoute, type RelationSvgLibrary } from './excalidraw-edge-relation-geometry';

interface Projection {
 arrow: RelationArrow; endpoints: string; taskIds: string[]; marks: TaskRelationMark[];
 elements: Map<string, HTMLElement>; geometry: string; route: RelationRoute | null; pending: string | null;
}
interface LayerSession {
 file: TFile; path: string; api: ExcalidrawTaskAPI; host: HTMLElement; layer: HTMLElement; life: Component;
 library: RelationSvgLibrary | undefined; data: string; full: boolean; dirty: Set<string>;
 projections: Map<string, Projection>; byTask: Map<string, Set<string>>; queue: Set<Projection>; running: number;
}
const prefix = 'operon-excalidraw-edge-relations';

/** Ephemeral projection, driven by the existing bridge's scene and index notifications. */
export class ExcalidrawRelationIndicators extends Component {
 private active = false;
 private frame = 0;
 private session: LayerSession | null = null;
 constructor(private view: ExcalidrawTaskView, private deps: { app: App; cards: TaskCardEmbeds }, private available: () => boolean) { super(); }
 private get win() { return getOwnerWindow(this.view.contentEl); }
 onload(): void { this.active = true; }
 sync(): void {
  if (!this.active) return;
  const host = Reflect.get(this.view, 'excalidrawContainer') as HTMLElement | undefined;
  const library = (this.view as ExcalidrawTaskView & { packages?: { excalidrawLib?: RelationSvgLibrary } }).packages?.excalidrawLib;
  const previous = this.session;
  if (previous && (!this.available() || previous.file !== this.view.file || previous.path !== this.view.file?.path
   || previous.api !== this.view.excalidrawAPI || previous.host !== host || previous.library !== library)) this.clear();
  if (!this.available() || !host?.isConnected || !this.view.file) return;
  if (!this.session) {
   const layer = host.createDiv(prefix), life = this.addChild(new Component());
   layer.setAttribute('aria-hidden', 'true');
   bindExcalidrawPoolTheme(this.view.contentEl, layer, life);
   this.session = { file: this.view.file, path: this.view.file.path, api: this.view.excalidrawAPI, host, layer, life, library,
    data: '', full: true, dirty: new Set(), projections: new Map(), byTask: new Map(), queue: new Set(), running: 0 };
  }
  this.schedule();
 }
 refresh(scope?: TaskRefreshScope): void {
  const session = this.session;
  if (session) {
   if (!scope || scope.kind === 'full') session.full = true;
   else for (const id of scope.taskIds) for (const arrow of session.byTask.get(id) ?? []) session.dirty.add(arrow);
  }
  this.sync();
 }
 private schedule(): void {
  if (!this.active || this.frame) return;
  this.frame = this.win.requestAnimationFrame(() => { this.frame = 0; this.draw(); });
 }
 private current(session: LayerSession): boolean {
  return this.active && this.session === session && this.available() && session.file === this.view.file && session.path === this.view.file?.path
   && session.api === this.view.excalidrawAPI && session.host.isConnected;
 }
 private forget(session: LayerSession, id: string, projection: Projection): void {
  for (const task of projection.taskIds) {
   const ids = session.byTask.get(task); ids?.delete(id); if (!ids?.size) session.byTask.delete(task);
  }
 }
 private draw(): void {
  const session = this.session;
  if (!session || !this.current(session)) { this.clear(); return; }
  const elements = session.api.getSceneElements(), byId = new Map(elements.filter(element => !element.isDeleted).map(element => [element.id, element]));
  const seen = new Set<string>(), resolutions = new Map<string, TaskCardResolution>();
  const resolve = (id: string) => { let result = resolutions.get(id); if (!result) { result = this.deps.cards.resolve(id); resolutions.set(id, result); } return result; };
  const dataChanged = session.data !== this.view.data;
  for (const element of elements) {
   const arrow = element as RelationArrow;
   if (arrow.type !== 'arrow' || arrow.isDeleted) continue;
   const start = byId.get(arrow.startBinding?.elementId ?? ''), end = byId.get(arrow.endBinding?.elementId ?? '');
   if (!start || !end || start === end) continue;
   const endpoints = JSON.stringify([start.id, start.type, start.link, end.id, end.type, end.link]);
   let projection = session.projections.get(arrow.id);
   const changed = !projection || projection.endpoints !== endpoints;
   if (!projection) {
    projection = { arrow, endpoints, taskIds: [], marks: [], elements: new Map(), geometry: '', route: null, pending: null };
    session.projections.set(arrow.id, projection);
   }
   seen.add(arrow.id); projection.arrow = arrow;
   if (changed || dataChanged) {
    const from = excalidrawSceneTaskId(this.deps.app, this.view, start), to = excalidrawSceneTaskId(this.deps.app, this.view, end);
    const ids = from && to && from !== to ? [from, to] : [];
    if (changed || JSON.stringify(ids) !== JSON.stringify(projection.taskIds)) {
     this.forget(session, arrow.id, projection); projection.taskIds = ids; session.dirty.add(arrow.id);
     for (const id of ids) { let arrows = session.byTask.get(id); if (!arrows) session.byTask.set(id, arrows = new Set()); arrows.add(arrow.id); }
    }
    projection.endpoints = endpoints;
   }
   if (session.full || session.dirty.has(arrow.id)) {
    const [from, to] = projection.taskIds, a = from && resolve(from), b = to && resolve(to);
    projection.marks = a && b && a.state === 'ready' && b.state === 'ready' ? taskRelationMarks(a.task, b.task, this.deps.cards.deps.getSettings()) : [];
    const keys = new Set(projection.marks.map(mark => mark.key));
    for (const [key, node] of projection.elements) if (!keys.has(key as TaskRelationMark['key'])) { node.remove(); projection.elements.delete(key); }
    for (const mark of projection.marks) {
     let node = projection.elements.get(mark.key);
     if (!node) { node = session.layer.createSpan(`${prefix}-mark`); node.dataset.arrowId = arrow.id; projection.elements.set(mark.key, node); }
     if (node.dataset.relationIcon !== mark.icon) { setIcon(node, mark.icon); node.dataset.relationIcon = mark.icon; }
     if (node.style.color !== (mark.color ?? '')) node.style.color = mark.color ?? '';
    }
   }
   const geometry = relationArrowGeometryKey(arrow);
   if (geometry !== projection.geometry) { projection.geometry = geometry; projection.route = null; }
   if (projection.marks.length && !projection.route && projection.pending !== geometry) session.queue.add(projection);
   this.position(session, projection);
  }
  for (const [id, projection] of session.projections) if (!seen.has(id)) {
   this.forget(session, id, projection); session.queue.delete(projection);
   for (const node of projection.elements.values()) node.remove(); session.projections.delete(id);
  }
  session.data = this.view.data; session.full = false; session.dirty.clear(); this.drain(session);
 }
 private position(session: LayerSession, projection: Projection): void {
  const state = session.api.getAppState(), zoom = (state.zoom as { value?: number } | undefined)?.value;
  const { scrollX, scrollY } = state;
  const valid = typeof zoom === 'number' && zoom > 0 && typeof scrollX === 'number' && typeof scrollY === 'number' && [zoom, scrollX, scrollY].every(Number.isFinite);
  for (const mark of projection.marks) {
   const node = projection.elements.get(mark.key)!, point = projection.route?.get(mark.fraction);
   node.hidden = !valid || !point;
   if (!valid || !point) continue;
   // The untransformed native host uses pane-local viewport coordinates (as does its selection menu).
   const left = `${(point.x + scrollX) * zoom}px`, top = `${(point.y + scrollY) * zoom}px`;
   if (node.style.left !== left) node.style.left = left;
   if (node.style.top !== top) node.style.top = top;
  }
 }
 private drain(session: LayerSession): void {
  // Bound concurrent native exports; queued projections always read their newest geometry.
  while (this.current(session) && session.running < 4 && session.queue.size) {
   const projection = session.queue.values().next().value; session.queue.delete(projection);
   if (session.projections.get(projection.arrow.id) !== projection || !projection.marks.length || projection.route || projection.pending === projection.geometry) continue;
   const key = projection.geometry, arrow = projection.arrow;
   projection.pending = key; session.running++;
   void relationArrowRoute(arrow, session.library).catch(() => new Map()).then(route => {
    if (!this.current(session) || session.projections.get(arrow.id) !== projection || projection.geometry !== key) return;
    const current = session.api.getSceneElements().find(element => element.id === arrow.id && !element.isDeleted) as RelationArrow | undefined;
    if (current && relationArrowGeometryKey(current) === key) projection.route = route;
   }).finally(() => {
    if (projection.pending === key) projection.pending = null;
    session.running--;
    if (this.current(session)) { this.schedule(); this.drain(session); }
   });
  }
 }
 private clear(): void {
  if (this.frame) this.win.cancelAnimationFrame(this.frame); this.frame = 0;
  const session = this.session; this.session = null;
  if (session) { session.queue.clear(); session.projections.clear(); session.byTask.clear(); session.layer.remove(); this.removeChild(session.life); }
 }
 onunload(): void { this.active = false; this.clear(); }
}
