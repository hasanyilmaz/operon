import { Component, Notice, setIcon } from 'obsidian';
import { t } from '../core/i18n';
import { getOwnerWindow } from '../core/dom-compat';
import { getConfiguredKeyMappingIcon } from '../core/key-mapping-icons';
import { resolveBlockedByVisualState, resolveBlockedByVisualStateColor } from '../core/blocked-by-visual-state';
import { INLINE_TASK_COMPACT_FALLBACK_ICONS, TASK_CREATOR_FALLBACK_FIELD_ICONS } from '../types/settings';
import { edgeRelationship, edgeRelationDirection, edgeRelationSnapshot, type EdgeRelationKind } from '../systems/canvas-edge-relations';
import { canvasRelationTaskId } from '../systems/canvas-task-relations';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { bindOperonHoverTooltip, cleanupOperonHoverTooltips } from './operon-hover-tooltip';
import type { CanvasTaskIntegration, CanvasTaskNode, TaskCanvasView } from './canvas-task-adapter';

interface NativeEdge {
 id: string;
 from: { node: CanvasTaskNode; end?: string };
 to: { node: CanvasTaskNode; end?: string };
 path?: { display: SVGPathElement };
 labelElement?: { wrapperEl: HTMLElement };
 updatePath(): void;
}
interface NativeMenu { menuEl: HTMLElement; render(force?: boolean): void }
const prefix = 'operon-canvas-edge-relations';
const text = (key: string) => t('settings', `edgeRelations${key}`);

/** Instance-owned visual projection. Only a toolbar click may write task fields. */
export class CanvasEdgeRelations extends Component {
 private active = false;
 private frame = 0;
 private layer: HTMLElement | null = null;
 private menu: NativeMenu | null = null;
 private controls: HTMLElement | null = null;
 private controlLife: Component | null = null;
 private signature = '';
 private busy = false;
 private hooks = new Map<NativeEdge, () => void>();
 private readonly canvas;
 private file;
 private path;
 constructor(private view: TaskCanvasView, private owner: CanvasTaskIntegration) {
  super(); this.canvas = view.canvas; this.file = view.file; this.path = view.file?.path;
 }
 private get cards() { return this.owner.deps.cards; }
 private get win() { return getOwnerWindow(this.view.contentEl); }
 private current(): boolean { return this.active && this.owner.isCurrent(this.view) && this.view.canvas === this.canvas; }
 onload(): void {
  const menu = Reflect.get(this.canvas, 'menu') as NativeMenu | undefined;
  if (!menu?.menuEl || typeof menu.render !== 'function' || !(this.canvas.edges instanceof Map) || !this.canvas.canvasEl) return;
  this.active = true; this.menu = menu;
  this.layer = this.view.contentEl.ownerDocument.body.createDiv(prefix); this.layer.setAttribute('aria-hidden', 'true');
  const render = Reflect.get(menu, 'render'), descriptor = Object.getOwnPropertyDescriptor(menu, 'render'), schedule = () => this.schedule();
  const wrapper = function(this: NativeMenu, force?: boolean) { render.call(this, force); schedule(); };
  menu.render = wrapper;
  this.register(() => { if (menu.render === wrapper) { if (descriptor) Object.defineProperty(menu, 'render', descriptor); else Reflect.deleteProperty(menu, 'render'); } });
  const Observer = (this.win as Window & { MutationObserver: typeof MutationObserver }).MutationObserver;
  const observer = new Observer(schedule); observer.observe(this.canvas.canvasEl, { childList: true, subtree: true, attributes: true, attributeFilter: ['d', 'transform', 'style'] });
  this.register(() => observer.disconnect());
  const Resize = (this.win as Window & { ResizeObserver: typeof ResizeObserver }).ResizeObserver;
  const resize = new Resize(schedule); resize.observe(this.view.contentEl); this.register(() => resize.disconnect());
  this.register(this.cards.onRefresh(schedule)); this.registerDomEvent(this.win, 'resize', schedule);
  this.registerDomEvent(this.view.contentEl, 'pointerup', schedule); this.registerDomEvent(this.view.contentEl, 'wheel', schedule, { passive: true });
  this.schedule();
 }
 private schedule(): void {
  if (!this.active || this.frame) return;
  this.frame = this.win.requestAnimationFrame(() => { this.frame = 0; this.sync(); });
 }
 private read(edge: NativeEdge) {
  if (this.canvas.edges?.get(edge.id) !== edge || !edge.from?.node || !edge.to?.node) return null;
  const from = edge.from.node, to = edge.to.node;
  if (this.canvas.nodes.get(from.id) !== from || this.canvas.nodes.get(to.id) !== to) return null;
  const aId = canvasRelationTaskId(from), bId = canvasRelationTaskId(to);
  if (!aId || !bId || aId === bId) return null;
  const a = this.cards.resolve(aId), b = this.cards.resolve(bId);
  return a.state === 'ready' && b.state === 'ready' ? { a: a.task, b: b.task } : null;
 }
 private icon(key: EdgeRelationKind | 'blockedBy'): string {
  const canonicalKey = key === 'parentTask' ? 'subtasks' : key;
  return getConfiguredKeyMappingIcon(canonicalKey, this.cards.deps.getSettings().keyMappings)
   || (key === 'parentTask' ? TASK_CREATOR_FALLBACK_FIELD_ICONS.subtasks : INLINE_TASK_COMPACT_FALLBACK_ICONS[key]);
 }
 private sync(): void {
  if (!this.layer) return;
  if (this.file !== this.view.file || this.path !== this.view.file?.path) {
   this.clearControls(); for (const restore of this.hooks.values()) restore(); this.hooks.clear();
   this.file = this.view.file; this.path = this.view.file?.path;
  }
  const bounds = this.view.contentEl.getBoundingClientRect();
  this.layer.empty();
  if (!this.current() || bounds.width <= 0 || bounds.height <= 0) { this.clearControls(); return; }
  Object.assign(this.layer.style, { left: `${bounds.left}px`, top: `${bounds.top}px`, width: `${bounds.width}px`, height: `${bounds.height}px` });
  const edges = new Set<NativeEdge>();
  for (const value of this.canvas.edges?.values() ?? []) {
   const edge = value as NativeEdge;
   if (typeof edge.updatePath !== 'function' || !edge.path?.display?.getPointAtLength) continue;
   edges.add(edge);
   if (!this.hooks.has(edge)) {
    const original = Reflect.get(edge, 'updatePath'), descriptor = Object.getOwnPropertyDescriptor(edge, 'updatePath'), schedule = () => this.schedule();
    const wrapper = function(this: NativeEdge) { original.call(this); schedule(); }; edge.updatePath = wrapper;
    this.hooks.set(edge, () => { if (edge.updatePath === wrapper) { if (descriptor) Object.defineProperty(edge, 'updatePath', descriptor); else Reflect.deleteProperty(edge, 'updatePath'); } });
   }
   const pair = this.read(edge); if (!pair || !edge.path.display.isConnected) continue;
   const marks: Array<{ key: EdgeRelationKind | 'blockedBy'; fraction: number; color: string | null }> = [];
   if (edgeRelationship(pair.a, pair.b, 'parentTask')) marks.push({ key: 'parentTask', fraction: .75, color: null });
   else if (edgeRelationship(pair.b, pair.a, 'parentTask')) marks.push({ key: 'parentTask', fraction: .25, color: null });
   const forward = edgeRelationship(pair.a, pair.b, 'blocking'), reverse = edgeRelationship(pair.b, pair.a, 'blocking');
   if (forward || reverse) {
    const state = resolveBlockedByVisualState({ ...(forward ? pair.a : pair.b), tags: [...(forward ? pair.a : pair.b).tags] }, this.cards.deps.getSettings().pipelines);
    const resolved = state === 'resolved';
    marks.push({ key: resolved ? 'blockedBy' : 'blocking', fraction: (forward !== resolved) ? .25 : .75, color: resolveBlockedByVisualStateColor(state) });
   }
   try {
    const path = edge.path.display, length = path.getTotalLength(), matrix = path.getScreenCTM();
    if (!matrix || !Number.isFinite(length) || length <= 0) continue;
    let center = .5;
    const label = edge.labelElement?.wrapperEl;
    if (label?.isConnected) {
     const rect = label.getBoundingClientRect(), x = (rect.left + rect.right) / 2, y = (rect.top + rect.bottom) / 2;
     let distance = Infinity;
     for (let i = 1; i < 64; i++) {
      const point = path.getPointAtLength(length * i / 64);
      const candidate = Math.hypot(matrix.a * point.x + matrix.c * point.y + matrix.e - x, matrix.b * point.x + matrix.d * point.y + matrix.f - y);
      if (candidate < distance) { center = i / 64; distance = candidate; }
     }
    }
    marks.forEach((mark, index) => {
     const point = path.getPointAtLength(length * (mark.fraction < .5 ? center * .2 : 1 - (1 - center) * .2));
     const x = matrix.a * point.x + matrix.c * point.y + matrix.e - bounds.left;
     const y = matrix.b * point.x + matrix.d * point.y + matrix.f - bounds.top;
     const shared = marks.length === 2 && marks[0].fraction === marks[1].fraction;
     const el = this.layer!.createSpan(`${prefix}-mark`); setIcon(el, this.icon(mark.key));
     el.style.left = `${x + (shared ? (index === 0 ? -13 : 13) : 0)}px`; el.style.top = `${y}px`;
     if (mark.color) el.style.color = mark.color;
    });
   } catch { /* A detached native path has no usable geometry. */ }
  }
  for (const [edge, restore] of this.hooks) if (!edges.has(edge)) { restore(); this.hooks.delete(edge); }
  const selection = [...this.canvas.selection ?? []];
  const edge = selection.length === 1 && edges.has(selection[0] as NativeEdge) ? selection[0] as NativeEdge : null;
  this.renderControls(edge);
 }
 private clearControls(): void {
  if (this.controls) { cleanupOperonHoverTooltips(this.controls); this.controls.remove(); }
  if (this.controlLife) this.removeChild(this.controlLife);
  this.controlLife = null; this.controls = null; this.signature = '';
 }
 private renderControls(edge: NativeEdge | null): void {
  const pair = edge && this.read(edge), menu = this.menu?.menuEl;
  if (!edge || !pair || !menu?.isConnected || !edge.path?.display?.getScreenCTM()) { this.clearControls(); return; }
  const direction = edgeRelationDirection(edge.from.end, edge.to.end);
  const a = direction === 'reverse' ? pair.b : pair.a, b = direction === 'reverse' ? pair.a : pair.b;
  const file = this.view.file, filePath = this.view.file?.path;
  const snapshot = edgeRelationSnapshot(a, b), fromNode = edge.from.node, toNode = edge.to.node;
  const signature = JSON.stringify([edge.id, direction, snapshot, this.busy, this.canvas.readonly, this.icon('parentTask'), this.icon('blocking')]);
  if (signature === this.signature && this.controls?.parentElement === menu) return;
  this.clearControls(); this.signature = signature;
  const life = this.controlLife = new Component(); this.addChild(life);
  const controls = this.controls = menu.createSpan(prefix + '-controls');
  for (const kind of ['parentTask', 'blocking'] as const) {
   const has = edgeRelationship(a, b, kind), reversed = edgeRelationship(b, a, kind);
   const reason = !direction ? text('Direction') : reversed ? text('Reverse') : '';
   const label = text(kind === 'parentTask' ? 'Child' : 'Blocking');
   const button = controls.createEl('button', { cls: 'clickable-icon', attr: { type: 'button', 'aria-pressed': String(has || reversed) } });
   setIcon(button, this.icon(kind)); button.classList.toggle('is-active', has || reversed);
   button.disabled = this.busy || this.canvas.readonly || !this.owner.deps.changeRelation;
   button.setAttribute('aria-disabled', String(button.disabled || !!reason));
   setAccessibleLabelWithoutTooltip(button, reason || `${label}: ${text(has ? 'Remove' : 'Add')}`);
   bindOperonHoverTooltip(button, { title: reason || label, taskColor: null });
   life.registerDomEvent(button, 'pointerdown', event => event.stopPropagation());
   life.registerDomEvent(button, 'keydown', event => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); });
   life.registerDomEvent(button, 'click', event => {
    event.stopPropagation(); if (reason) { new Notice(reason); return; }
    if (this.busy || button.disabled) return;
    const allowed = () => {
     if (!this.current() || this.view.file !== file || this.view.file?.path !== filePath || edge.from.node !== fromNode || edge.to.node !== toNode || this.canvas.readonly || this.canvas.selection?.size !== 1 || !this.canvas.selection.has(edge)
      || edgeRelationDirection(edge.from.end, edge.to.end) !== direction) return false;
     const fresh = this.read(edge); if (!fresh) return false;
     return (direction === 'reverse' ? fresh.b : fresh.a).operonId === a.operonId && (direction === 'reverse' ? fresh.a : fresh.b).operonId === b.operonId;
    };
    this.busy = true; this.schedule();
    void (async () => {
     try { if (!allowed() || !await this.owner.deps.changeRelation!(a.operonId, b.operonId, kind, snapshot, allowed)) new Notice(text('Failed')); }
     catch { new Notice(text('Failed')); }
     finally { this.busy = false; this.schedule(); }
    })();
   });
  }
 }
 onunload(): void {
  this.active = false; if (this.frame) this.win.cancelAnimationFrame(this.frame);
  this.clearControls(); for (const restore of this.hooks.values()) restore(); this.hooks.clear(); this.layer?.remove(); this.layer = null;
 }
}
