import type { TaskRefreshScope } from '../core/task-refresh-scope';
import type { TaskCardResolution } from './task-card-embed-model';
import { CONTEXTUAL_MENU_ACTIONS, getContextualMenuActionIcon, getContextualMenuActionLabel } from '../core/contextual-menu-engine';
import { canvasRelationAnchor, canvasRelationPoint, canvasRelationSlot } from './canvas-edge-relation-geometry';
import { Component, Notice, setIcon } from 'obsidian';
import { t } from '../core/i18n';
import { createOwnerElement, getOwnerWindow } from '../core/dom-compat';
import { getConfiguredKeyMappingIcon } from '../core/key-mapping-icons';
import { resolveBlockedByVisualState, resolveBlockedByVisualStateColor } from '../core/blocked-by-visual-state';
import { INLINE_TASK_COMPACT_FALLBACK_ICONS, TASK_CREATOR_FALLBACK_FIELD_ICONS } from '../types/settings';
import { edgeRelationship, edgeRelationSnapshot, type EdgeRelationKind } from '../systems/canvas-edge-relations';
import { canvasRelationTaskId } from '../systems/canvas-task-relations';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { bindOperonHoverTooltip, cleanupOperonHoverTooltips } from './operon-hover-tooltip';
import type { CanvasTaskIntegration, CanvasTaskNode, TaskCanvasView } from './canvas-task-adapter';

interface NativeEdge {
 label?: string;
 labelElement?: { wrapperEl: HTMLElement; textareaEl: HTMLElement } | null;
 id: string;
 from: { node: CanvasTaskNode; end?: string; side?: string };
 to: { node: CanvasTaskNode; end?: string; side?: string };
 path?: { display: SVGPathElement };
 updatePath(): void;
}
interface NativeMenu { menuEl: HTMLElement; render(force?: boolean): void }
const prefix = 'operon-canvas-edge-relations';
const text = (key: string) => t('settings', `edgeRelations${key}`);

interface RelationMark { key: EdgeRelationKind | 'blockedBy'; atSource: boolean; color: string | null }
interface EdgeProjection {
 taskIds: string[];
 endpoints?: [CanvasTaskNode, CanvasTaskNode];
 marks: RelationMark[];
 elements: Map<string, HTMLElement>;
 geometry: string;
 path: SVGPathElement | undefined;
}
/** Decoration never changes which task roots are mounted on the Canvas. */
export function isCanvasRelationDecoration(record: MutationRecord): boolean {
 const owned = (node: Node): boolean => {
  const element = node.nodeType === 1 ? node as Element : node.parentElement;
  return !!element?.closest('.operon-canvas-edge-relations, .operon-canvas-edge-relations-controls, .operon-canvas-task-toolbar');
 };
 if (owned(record.target)) return true;
 const children = [...Array.from(record.addedNodes ?? []), ...Array.from(record.removedNodes ?? [])];
 return record.type === 'childList' && children.length > 0 && children.every(owned);
}

/** Instance-owned visual projection. Only a toolbar click may write task fields. */
export class CanvasEdgeRelations extends Component {
 private active = false;
 private frame = 0;
 private layer: HTMLElement | null = null;
 private menu: NativeMenu | null = null;
 private controls: HTMLElement | null = null;
 private controlLife: Component | null = null;
 private signature = '';
 private controlNode: CanvasTaskNode | null = null;
 private nodeToolbar: HTMLElement | null = null;
 private busy = false;
 private hooks = new Map<NativeEdge, () => void>();
 private emptyLabels = new Set<HTMLElement>();
 private projections = new Map<NativeEdge, EdgeProjection>();
 private targets = new WeakMap<Node, NativeEdge>();
 private dirtyGeometry = new Set<NativeEdge>();
 private dirtyData = new Set<NativeEdge>();
 private full = true;
 private controlsDirty = true;
 private labelsDirty = true;
 private lastSelection: unknown = null;
 private lastReadonly: boolean | undefined;
 private lastMenu: HTMLElement | undefined;
 private menuConnected = false;
 private zoom = 0;
 private resolutions: Map<string, TaskCardResolution> | null = null;
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
  const host = this.canvas.canvasEl;
  if (!host) return;
  this.active = true; this.menu = menu;
  this.layer = host.createDiv(prefix); this.layer.setAttribute('aria-hidden', 'true');
  const render = Reflect.get(menu, 'render'), descriptor = Object.getOwnPropertyDescriptor(menu, 'render'), schedule = () => this.schedule('viewport');
  const wrapper = function(this: NativeMenu, force?: boolean) { render.call(this, force); schedule(); };
  menu.render = wrapper;
  this.register(() => { if (menu.render === wrapper) { if (descriptor) Object.defineProperty(menu, 'render', descriptor); else Reflect.deleteProperty(menu, 'render'); } });
  const Observer = (this.win as Window & { MutationObserver: typeof MutationObserver }).MutationObserver;
  const observer = new Observer(records => this.mutations(records));
  observer.observe(this.canvas.canvasEl, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['d', 'transform', 'style'] });
  this.register(() => observer.disconnect());
  const Resize = (this.win as Window & { ResizeObserver: typeof ResizeObserver }).ResizeObserver;
  const resize = new Resize(schedule); resize.observe(this.view.contentEl); this.register(() => resize.disconnect());
  for (const event of ['input', 'focusin', 'focusout'] as const) this.registerDomEvent(this.view.contentEl, event, () => this.schedule('labels'));
  this.register(this.cards.onRefresh(scope => this.refresh(scope)));
  this.registerDomEvent(this.win, 'resize', schedule);
  this.registerDomEvent(this.view.contentEl, 'pointerup', schedule);
  this.registerDomEvent(this.view.contentEl, 'wheel', schedule, { passive: true });
  const originalImport = Reflect.get(this.canvas, 'importData');
  if (originalImport) {
   const canvas = this.canvas, descriptor = Object.getOwnPropertyDescriptor(canvas, 'importData');
   const importData: NonNullable<typeof canvas.importData> = (...args) => {
    const result: unknown = Reflect.apply(originalImport, canvas, args); this.schedule(); return result;
   };
   canvas.importData = importData;
   this.register(() => { if (canvas.importData === importData) { if (descriptor) Object.defineProperty(canvas, 'importData', descriptor); else Reflect.deleteProperty(canvas, 'importData'); } });
  }
  this.schedule();
 }
 private schedule(kind: 'full' | 'viewport' | 'labels' | 'partial' = 'full'): void {
  if (!this.active) return;
  if (kind === 'full') this.full = true;
  if (kind === 'labels') { this.labelsDirty = true; this.controlsDirty = true; }
  if (this.frame) return;
  this.frame = this.win.requestAnimationFrame(() => { this.frame = 0; this.sync(false); });
 }
 private refresh(scope?: TaskRefreshScope): void {
  if (!scope || scope.kind === 'full') { this.schedule(); return; }
  for (const [edge, projection] of this.projections) if (projection.taskIds.some(id => scope.taskIds.has(id))) this.dirtyData.add(edge);
  const selected = this.canvas.selection?.size === 1 ? [...this.canvas.selection][0] : null;
  const edge = selected as NativeEdge;
  const node = selected && this.canvas.nodes.get((selected as CanvasTaskNode).id) === selected ? selected as CanvasTaskNode : null;
  if (this.dirtyData.has(edge) || (node && scope.taskIds.has(canvasRelationTaskId(node) ?? ''))) this.controlsDirty = true;
  this.schedule('partial');
 }
 private mutations(records: MutationRecord[]): void {
  for (const record of records) {
   if (isCanvasRelationDecoration(record)) continue;
   let target: Node | null = record.target, edge: NativeEdge | undefined;
   while (target && target !== this.canvas.canvasEl) { edge = this.targets.get(target); if (edge) break; target = target.parentNode; }
   if (edge) {
    if (record.type === 'attributes' && record.attributeName === 'd') this.dirtyGeometry.add(edge);
    else if (edge.labelElement?.wrapperEl?.contains(record.target)) { this.labelsDirty = true; this.controlsDirty = true; }
    else this.dirtyGeometry.add(edge);
    this.schedule('partial');
   } else if (record.type === 'attributes' && (record.target === this.canvas.canvasEl || (record.target as Element).contains?.(this.canvas.canvasEl!))) this.schedule('viewport');
   else this.schedule();
  }
 }
 private resolve(id: string): TaskCardResolution {
  const cached = this.resolutions?.get(id); if (cached) return cached;
  const value = this.cards.resolve(id); this.resolutions?.set(id, value); return value;
 }
 private taskIds(edge: NativeEdge): string[] {
  return [edge.from?.node, edge.to?.node].flatMap(node => { const id = node && canvasRelationTaskId(node); return id ? [id] : []; });
 }
 private read(edge: NativeEdge) {
  if (this.canvas.edges?.get(edge.id) !== edge || !edge.from?.node || !edge.to?.node) return null;
  const from = edge.from.node, to = edge.to.node;
  if (this.canvas.nodes.get(from.id) !== from || this.canvas.nodes.get(to.id) !== to) return null;
  const aId = canvasRelationTaskId(from), bId = canvasRelationTaskId(to);
  if (!aId || !bId || aId === bId) return null;
  const a = this.resolve(aId), b = this.resolve(bId);
  return a.state === 'ready' && b.state === 'ready' ? { a: a.task, b: b.task } : null;
 }
 private icon(key: EdgeRelationKind | 'blockedBy'): string {
  const canonicalKey = key;
  return getConfiguredKeyMappingIcon(canonicalKey, this.cards.deps.getSettings().keyMappings)
   || (key === 'parentTask' ? TASK_CREATOR_FALLBACK_FIELD_ICONS.parentTask : INLINE_TASK_COMPACT_FALLBACK_ICONS[key]);
 }
 private sync(force = true): void {
  if (!this.layer || !this.active) return;
  if (force) this.full = true;
  if (this.file !== this.view.file || this.path !== this.view.file?.path) {
   this.clearProjection(); this.clearControls(); this.full = true;
   this.file = this.view.file; this.path = this.view.file?.path;
  }
  const viewBounds = this.view.contentEl.getBoundingClientRect(), host = this.layer.parentElement;
  if (!host || !this.current() || viewBounds.width <= 0 || viewBounds.height <= 0) {
   this.clearProjection(); this.clearControls(); this.full = true; return;
  }
  const bounds = host.getBoundingClientRect();
  for (const [key, value] of Object.entries({ left: '0px', top: '0px', width: `${bounds.width}px`, height: `${bounds.height}px` })) {
   if (this.layer.style.getPropertyValue(key) !== value) this.layer.style.setProperty(key, value);
  }
  this.resolutions = new Map();
  try {
   if (this.full) {
    const edges = new Set<NativeEdge>(); this.targets = new WeakMap();
    for (const value of this.canvas.edges?.values() ?? []) {
     const edge = value as NativeEdge;
     if (typeof edge.updatePath !== 'function' || !edge.path?.display?.getPointAtLength) continue;
     edges.add(edge);
     this.targets.set(edge.path.display, edge);
     if (edge.labelElement?.wrapperEl) this.targets.set(edge.labelElement.wrapperEl, edge);
     if (!this.projections.has(edge)) this.projections.set(edge, { taskIds: [], marks: [], elements: new Map(), geometry: '', path: undefined });
     if (!this.hooks.has(edge)) {
      const original = Reflect.get(edge, 'updatePath'), descriptor = Object.getOwnPropertyDescriptor(edge, 'updatePath');
      const changed = () => { if (this.active) { this.dirtyGeometry.add(edge); this.schedule('partial'); } };
      const wrapper = function(this: NativeEdge) { original.call(this); changed(); }; edge.updatePath = wrapper;
      this.hooks.set(edge, () => { if (edge.updatePath === wrapper) { if (descriptor) Object.defineProperty(edge, 'updatePath', descriptor); else Reflect.deleteProperty(edge, 'updatePath'); } });
     }
     this.dirtyData.add(edge); this.dirtyGeometry.add(edge);
    }
    for (const [edge, projection] of this.projections) if (!edges.has(edge)) {
     for (const element of projection.elements.values()) element.remove();
     this.projections.delete(edge); this.hooks.get(edge)?.(); this.hooks.delete(edge);
    }
    this.labelsDirty = true; this.controlsDirty = true; this.full = false;
   }
   for (const edge of this.dirtyGeometry) {
    const projection = this.projections.get(edge); if (!projection) continue;
    const ids = this.taskIds(edge);
    if (JSON.stringify(ids) !== JSON.stringify(projection.taskIds) || projection.endpoints?.[0] !== edge.from?.node || projection.endpoints?.[1] !== edge.to?.node) {
     this.dirtyData.add(edge); this.controlsDirty = true;
    }
   }
   for (const edge of this.dirtyData) {
    const projection = this.projections.get(edge); if (!projection) continue;
    projection.taskIds = this.taskIds(edge);
    projection.endpoints = edge.from?.node && edge.to?.node ? [edge.from.node, edge.to.node] : undefined;
    const pair = this.read(edge), marks: RelationMark[] = [];
    if (pair) {
     if (edgeRelationship(pair.a, pair.b, 'parentTask')) marks.push({ key: 'parentTask', atSource: true, color: null });
     else if (edgeRelationship(pair.b, pair.a, 'parentTask')) marks.push({ key: 'parentTask', atSource: false, color: null });
     const forward = edgeRelationship(pair.a, pair.b, 'blocking'), reverse = edgeRelationship(pair.b, pair.a, 'blocking');
     if (forward || reverse) {
      const task = forward ? pair.a : pair.b;
      const state = resolveBlockedByVisualState({ ...task, tags: [...task.tags] }, this.cards.deps.getSettings().pipelines);
      marks.push({ key: state === 'resolved' ? 'blockedBy' : 'blocking', atSource: forward, color: resolveBlockedByVisualStateColor(state) });
     }
    }
    if (JSON.stringify(marks) !== JSON.stringify(projection.marks)) projection.geometry = '';
    projection.marks = marks;
    const keys = new Set(marks.map(mark => mark.key));
    for (const [key, element] of projection.elements) if (!keys.has(key as RelationMark['key'])) { element.remove(); projection.elements.delete(key); }
    for (const mark of marks) {
     let element = projection.elements.get(mark.key);
     if (!element) { element = this.layer.createSpan(`${prefix}-mark`); projection.elements.set(mark.key, element); projection.geometry = '';
      if (this.zoom > 0) element.style.transform = `translate(-50%, -50%) scale(${1 / this.zoom})`; }
     const icon = this.icon(mark.key);
     if (element.dataset.relationIcon !== icon) { setIcon(element, icon); element.dataset.relationIcon = icon; }
     if (element.style.color !== (mark.color ?? '')) element.style.color = mark.color ?? '';
    }
    this.dirtyGeometry.add(edge);
   }
   this.dirtyData.clear();
   for (const edge of this.dirtyGeometry) {
    const projection = this.projections.get(edge); if (!projection) continue;
    const path = edge.path?.display;
    if (path) this.targets.set(path, edge);
    try {
     const from = canvasRelationAnchor(edge.from.node, edge.from.side), to = canvasRelationAnchor(edge.to.node, edge.to.side);
     const geometry = JSON.stringify([path?.getAttribute('d'), from, to]);
     if (!path?.isConnected || !from || !to) { for (const element of projection.elements.values()) element.hidden = true; projection.geometry = ''; continue; }
     if (path === projection.path && geometry === projection.geometry) continue;
     projection.path = path;
     if (projection.marks.length) {
      const length = path.getTotalLength();
      if (!Number.isFinite(length) || length <= 0) { for (const element of projection.elements.values()) element.hidden = true; projection.geometry = ''; continue; }
      projection.marks.forEach((mark, index) => {
       const paired = projection.marks.length === 2 && projection.marks[0].atSource === projection.marks[1].atSource;
       const point = canvasRelationPoint(length, distance => path.getPointAtLength(distance), from, to, canvasRelationSlot(mark.atSource, paired, index));
       const element = projection.elements.get(mark.key)!; element.hidden = false;
       element.style.left = `${point.x}px`; element.style.top = `${point.y}px`;
      });
     }
     projection.geometry = geometry;
    } catch { for (const element of projection.elements.values()) element.hidden = true; projection.geometry = ''; }
   }
   this.dirtyGeometry.clear();
   let zoom = 0;
   for (const edge of this.projections.keys()) {
    if (!edge.path?.display?.isConnected) continue;
    try {
     const matrix = edge.path.display.getScreenCTM();
     if (matrix) { zoom = Math.hypot(matrix.a, matrix.b); if (Number.isFinite(zoom) && zoom > 0) break; }
    } catch { /* A native path can detach between the connectivity check and measurement. */ }
   }
   if (Number.isFinite(zoom) && zoom > 0 && zoom !== this.zoom) {
    const transform = `translate(-50%, -50%) scale(${1 / zoom})`;
    for (const projection of this.projections.values()) for (const element of projection.elements.values()) if (element.style.transform !== transform) element.style.transform = transform;
    this.zoom = zoom;
   }
   if (this.labelsDirty) this.syncLabels();
   const selection = [...this.canvas.selection ?? []], selected = selection.length === 1 ? selection[0] : null;
   const menu = this.menu?.menuEl, connected = menu?.isConnected === true;
   if (menu !== this.lastMenu || connected !== this.menuConnected) this.controlsDirty = true;
   this.lastMenu = menu; this.menuConnected = connected;
   if (this.controlsDirty || selected !== this.lastSelection || this.canvas.readonly !== this.lastReadonly || (this.controls && !this.controls.isConnected)) {
    const edge = this.projections.has(selected as NativeEdge) ? selected as NativeEdge : null;
    const node = selected && this.canvas.nodes.get((selected as CanvasTaskNode).id) === selected ? selected as CanvasTaskNode : null;
    if (node) this.renderNodeControls(node); else this.renderControls(edge);
    this.lastSelection = selected; this.lastReadonly = this.canvas.readonly; this.controlsDirty = false;
   } else if (this.controlNode) this.positionNodeToolbar(this.controlNode);
  } finally { this.resolutions = null; }
 }
 private syncLabels(): void {
  const labels = new Set<HTMLElement>();
  for (const edge of this.projections.keys()) {
   const label = edge.labelElement;
   if (!label?.wrapperEl?.isConnected || !label.textareaEl) continue;
   const empty = !(edge.label ?? '').trim() && !(label.textareaEl.textContent ?? '').trim();
   const editing = label.textareaEl.contains(label.textareaEl.ownerDocument.activeElement);
   label.wrapperEl.classList.toggle('operon-canvas-empty-edge-label', empty && !editing);
   if (empty && !editing) labels.add(label.wrapperEl);
  }
  for (const label of this.emptyLabels) if (!labels.has(label)) label.classList.remove('operon-canvas-empty-edge-label');
  this.emptyLabels = labels; this.labelsDirty = false;
 }
 private clearProjection(): void {
  for (const projection of this.projections.values()) for (const element of projection.elements.values()) element.remove();
  for (const restore of this.hooks.values()) restore();
  for (const label of this.emptyLabels) label.classList.remove('operon-canvas-empty-edge-label');
  this.emptyLabels.clear(); this.hooks.clear(); this.projections.clear(); this.dirtyData.clear(); this.dirtyGeometry.clear(); this.targets = new WeakMap();
 }
 private clearControls(): void {
  this.nodeToolbar?.remove(); this.nodeToolbar = null;
  if (this.controls) { cleanupOperonHoverTooltips(this.controls); this.controls.remove(); }
  if (this.controlLife) this.removeChild(this.controlLife);
  this.controlLife = null; this.controls = null; this.controlNode = null; this.signature = '';
 }
 private renderNodeControls(node: CanvasTaskNode): void {
  const id = canvasRelationTaskId(node), menu = this.menu?.menuEl;
  if (!id || this.resolve(id).state !== 'ready' || !menu?.isConnected) { this.clearControls(); return; }
  const deps = this.cards.deps.controls;
  const tracking = deps?.chips.isTaskTracking?.(id) === true, pinned = deps?.chips.isTaskPinned?.(id) === true;
  const signature = `node:${node.id}:${id}:${tracking}:${pinned}:${this.canvas.readonly}:${this.busy}:${deps?.getTask(id)?.checkbox}`;
  if (this.signature === signature && this.controlNode === node && this.controls?.parentElement === this.nodeToolbar && this.nodeToolbar?.isConnected) { this.positionNodeToolbar(node); return; }
  this.clearControls(); this.signature = signature; this.controlNode = node;
  const file = this.view.file, path = file?.path;
  const life = this.controlLife = new Component(); this.addChild(life);
  this.nodeToolbar = this.view.contentEl.ownerDocument.body.createDiv('canvas-menu operon-canvas-task-toolbar');
  const controls = this.controls = this.nodeToolbar.createSpan(prefix + '-controls');
  if (deps) for (const kind of ['timer', 'pin'] as const) {
   const active = kind === 'timer' ? tracking : pinned;
   const label = kind === 'timer' ? t('tooltips', active ? 'stopTimer' : 'startTimer') : t('contextMenu', active ? 'unpinTask' : 'pinTask');
   const button = controls.createEl('button', { cls: 'clickable-icon', attr: { type: 'button', 'aria-pressed': String(active) } });
   setIcon(button, kind === 'timer' ? active ? 'square' : 'play' : active ? 'pin-off' : 'pin');
   button.classList.toggle('is-active', active);
   const allowed = () => this.current() && this.view.file === file && file?.path === path && !this.canvas.readonly
    && this.canvas.nodes.get(node.id) === node && this.canvas.selection?.size === 1 && this.canvas.selection.has(node)
    && canvasRelationTaskId(node) === id && this.resolve(id).state === 'ready'
    && (kind !== 'timer' || deps.chips.isTaskTracking?.(id) === true || deps.getTask(id)?.checkbox === 'open');
   button.disabled = this.busy || !allowed();
   setAccessibleLabelWithoutTooltip(button, label); bindOperonHoverTooltip(button, { title: label, taskColor: null });
   life.registerDomEvent(button, 'pointerdown', event => event.stopPropagation());
   life.registerDomEvent(button, 'keydown', event => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); });
   life.registerDomEvent(button, 'click', event => {
    event.preventDefault(); event.stopPropagation();
    if (this.busy || !allowed()) return;
    this.busy = true; this.schedule();
    void this.cards.run(id, allowed, async () => {
     if (kind === 'timer' && deps.chips.toggleTimer) await deps.chips.toggleTimer(id);
     else await deps.onAction(id, kind === 'pin' ? 'pinToggle' : 'startTimer', undefined, { canMutate: allowed });
    }).catch(() => { new Notice(t('notifications', 'taskCardActionUnavailable')); }).finally(() => { this.busy = false; this.schedule(); });
   });
  }
  for (const actionId of ['openEditor', 'jumpToSource'] as const) {
   const action = CONTEXTUAL_MENU_ACTIONS.find(item => item.id === actionId)!;
   const label = getContextualMenuActionLabel(action);
   const button = controls.createEl('button', { cls: 'clickable-icon', attr: { type: 'button' } });
   setIcon(button, actionId === 'openEditor' ? 'settings-2' : getContextualMenuActionIcon(action, this.cards.deps.getSettings().keyMappings));
   setAccessibleLabelWithoutTooltip(button, label);
   bindOperonHoverTooltip(button, { title: label, taskColor: null });
   life.registerDomEvent(button, 'pointerdown', event => event.stopPropagation());
   life.registerDomEvent(button, 'keydown', event => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); });
   life.registerDomEvent(button, 'click', event => {
    event.preventDefault(); event.stopPropagation();
    if (!this.current() || this.view.file !== file || file?.path !== path || this.canvas.nodes.get(node.id) !== node
     || this.canvas.selection?.size !== 1 || !this.canvas.selection.has(node) || canvasRelationTaskId(node) !== id) return;
    this.cards.activate(id, actionId === 'jumpToSource');
   });
  }
  this.positionNodeToolbar(node);
 }
 private positionNodeToolbar(node: CanvasTaskNode): void {
  if (!this.nodeToolbar) return;
  const card = node.nodeEl.getBoundingClientRect(), view = this.view.contentEl.getBoundingClientRect();
  const width = this.nodeToolbar.offsetWidth, height = this.nodeToolbar.offsetHeight;
  const left = Math.max(view.left, Math.min(card.left + card.width / 2 - width / 2, view.right - width));
  const top = Math.max(view.top, Math.min(card.bottom + 12, view.bottom - height));
  this.nodeToolbar.style.left = `${left}px`; this.nodeToolbar.style.top = `${top}px`;
 }

 private renderControls(edge: NativeEdge | null): void {
  const pair = edge && this.read(edge), menu = this.menu?.menuEl;
  if (!edge || !pair || !menu?.isConnected || !edge.path?.display?.getScreenCTM()) { this.clearControls(); return; }
  const { a, b } = pair;
  const file = this.view.file, filePath = this.view.file?.path;
  const snapshot = edgeRelationSnapshot(a, b), fromNode = edge.from.node, toNode = edge.to.node;
  const signature = JSON.stringify([edge.id, snapshot, a.description, b.description, this.busy, this.canvas.readonly, this.icon('parentTask'), this.icon('blocking'), this.icon('blockedBy'), getConfiguredKeyMappingIcon('subtasks', this.cards.deps.getSettings().keyMappings)]);
  if (signature === this.signature && this.controls?.parentElement === menu) return;
  this.clearControls(); this.signature = signature;
  const life = this.controlLife = new Component(); this.addChild(life);
  const controls = this.controls = menu.createSpan(prefix + '-controls');
  for (const [kind, reverse] of [['parentTask', false], ['parentTask', true], ['blocking', false], ['blocking', true]] as const) {
   const source = reverse ? b : a, target = reverse ? a : b;
   const relationSnapshot = edgeRelationSnapshot(source, target);
   const has = edgeRelationship(source, target, kind), reversed = edgeRelationship(target, source, kind);
   const title = has ? 'Current Relation' : 'Add Relation';
   const roles = kind === 'parentTask' ? ['Parent', 'Child'] : ['Blocked by', 'Blocking'];
   const lines = [`${roles[0]}: ${source.description || source.operonId}`, `${roles[1]}: ${target.description || target.operonId}`];
   const reason = reversed ? `${text('Remove')}: ${roles[0]}: ${target.description || target.operonId}; ${roles[1]}: ${source.description || source.operonId}` : '';
   const button = controls.createEl('button', { cls: 'clickable-icon', attr: { type: 'button', 'aria-pressed': String(has) } });
   const icon = kind === 'parentTask' && reverse
    ? getConfiguredKeyMappingIcon('subtasks', this.cards.deps.getSettings().keyMappings) || TASK_CREATOR_FALLBACK_FIELD_ICONS.subtasks
    : this.icon(kind === 'blocking' && reverse ? 'blockedBy' : kind);
   setIcon(button, icon); button.classList.toggle('is-active', has);
   button.disabled = this.busy || this.canvas.readonly || !this.owner.deps.changeRelation;
   button.setAttribute('aria-disabled', String(button.disabled || !!reason));
   setAccessibleLabelWithoutTooltip(button, `${title}. ${lines.join('. ')}`);
   bindOperonHoverTooltip(button, {
    title, taskColor: null,
    contentElFactory: () => {
     const content = createOwnerElement(button, 'div');
     for (const line of lines) {
      const row = content.createDiv();
      row.textContent = line;
     }
     return content;
    },
   });
   life.registerDomEvent(button, 'pointerdown', event => event.stopPropagation());
   life.registerDomEvent(button, 'keydown', event => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); });
   life.registerDomEvent(button, 'click', event => {
    event.stopPropagation(); if (reason) { new Notice(reason); return; }
    if (this.busy || button.disabled) return;
    const allowed = () => {
     if (!this.current() || this.view.file !== file || this.view.file?.path !== filePath || edge.from.node !== fromNode || edge.to.node !== toNode || this.canvas.readonly || this.canvas.selection?.size !== 1 || !this.canvas.selection.has(edge)) return false;
     const fresh = this.read(edge); if (!fresh) return false;
     return fresh.a.operonId === a.operonId && fresh.b.operonId === b.operonId;
    };
    this.busy = true; this.schedule();
    void (async () => {
     try { if (!allowed() || !await this.owner.deps.changeRelation!(source.operonId, target.operonId, kind, relationSnapshot, allowed)) new Notice(text('Failed')); }
     catch { new Notice(text('Failed')); }
     finally { this.busy = false; this.schedule(); }
    })();
   });
  }
 }
 onunload(): void {
  this.clearProjection();
  this.active = false; if (this.frame) this.win.cancelAnimationFrame(this.frame);
  this.clearControls(); for (const restore of this.hooks.values()) restore(); this.hooks.clear(); this.layer?.remove(); this.layer = null;
 }
}
