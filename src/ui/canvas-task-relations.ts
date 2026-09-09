import { Component, setIcon } from 'obsidian';
import { t } from '../core/i18n';
import { getOwnerWindow } from '../core/dom-compat';
import { resolveTaskDisplayIcon } from '../types/settings';
import { buildCanvasTaskRelations, canvasRelationPresence, canvasRelationTaskId, type RelationRow, type RelationSection } from '../systems/canvas-task-relations';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { renderCompactTaskMarkdown } from './compact-task-markdown-renderer';
import { startRelationsGesture } from './canvas-relations-gesture';
import { canvasConnectionAtPoint } from './canvas-task-drop-connection';
import type { CanvasPoint, CanvasTaskIntegration, CanvasTaskNode, CanvasTaskTarget, TaskCanvasView } from './canvas-task-adapter';

const prefix = 'operon-canvas-task-relations';
const label = (key: string) => t('settings', `taskRelations${key}`);
interface DragTask { target: CanvasTaskTarget; source: CanvasTaskNode; id: string; name: string }

/** Read-only relation palette. Only an explicit drop enters the existing Canvas insertion transaction. */
export class CanvasTaskRelations extends Component {
 private active = false;
 private supported = false;
 private panel: HTMLElement | null = null;
 private selected: HTMLElement | null = null;
 private body: HTMLElement | null = null;
 private pin: HTMLButtonElement | null = null;
 private session: Component | null = null;
 private rows: Component | null = null;
 private source: CanvasTaskNode | null = null;
 private sourceId = '';
 private dismissed: CanvasTaskNode | null = null;
 private pinned = false;
 private point: CanvasPoint | null = null;
 private cancelGesture: (() => void) | null = null;
 private ghost: HTMLElement | null = null;
 private limits = new Map<RelationSection, number>();
 private signature = '';
 private frame = 0;
 private busy = false;
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
  this.active = true;
  const canvas = this.canvas;
  this.supported = canvas.selection instanceof Set && canvas.edges instanceof Map && !!canvas.wrapperEl
   && typeof canvas.posFromClient === 'function' && typeof canvas.updateSelection === 'function' && typeof canvas.importData === 'function';
  if (!this.supported) return;
  const host = canvas as unknown as Record<string, unknown>;
  for (const name of ['updateSelection', 'addNode', 'removeNode', 'addEdge', 'removeEdge', 'importData']) {
   const original = host[name]; if (typeof original !== 'function') continue;
   const descriptor = Object.getOwnPropertyDescriptor(host, name), schedule = () => this.schedule();
   const wrapper = function(this: unknown, ...args: unknown[]) { const result: unknown = Reflect.apply(original, this, args); schedule(); return result; };
   host[name] = wrapper;
   this.register(() => { if (host[name] === wrapper) { if (descriptor) Object.defineProperty(host, name, descriptor); else Reflect.deleteProperty(host, name); } });
  }
  this.register(this.cards.onRefresh(() => this.schedule()));
  this.registerDomEvent(this.win, 'resize', () => this.schedule());
  const Resize = (this.win as Window & { ResizeObserver: typeof ResizeObserver }).ResizeObserver;
  const observer = new Resize(() => this.schedule()); observer.observe(this.view.contentEl); this.register(() => observer.disconnect());
  let pressed: { id: number; x: number; y: number } | null = null;
  this.registerDomEvent(this.view.contentEl, 'pointerdown', event => { pressed = event.isPrimary === false ? null : { id: event.pointerId, x: event.clientX, y: event.clientY }; }, { capture: true });
  this.registerDomEvent(this.view.contentEl, 'pointercancel', () => { pressed = null; });
  this.registerDomEvent(this.view.contentEl, 'pointerup', event => {
   const start = pressed; pressed = null;
   if (!start || start.id !== event.pointerId || Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 6) return;
   const target = event.target as HTMLElement;
   if (this.isEmptyPoint({ x: event.clientX, y: event.clientY })) { this.close(true); return; }
   const layer = canvas.nodeInteractionLayer;
   const overlay = layer?.interactionEl, overlayNode = layer?.target;
   const clicked = [...canvas.nodes.values()].find(node => node.nodeEl.contains(target))
    ?? (overlay?.ownerDocument === this.view.contentEl.ownerDocument && canvas.wrapperEl?.contains(overlay) && overlay.contains(target)
     && overlayNode && canvas.nodes.get(overlayNode.id) === overlayNode ? overlayNode : null);
   if (clicked && canvasRelationTaskId(clicked) && canvas.selection?.size === 1 && canvas.selection.has(clicked)) { this.dismissed = null; this.schedule(); }
  });
  this.sync();
 }
 private schedule(): void {
  if (!this.active || this.frame) return;
  this.frame = this.win.requestAnimationFrame(() => { this.frame = 0; this.sync(); });
 }
 sync(): void {
  const bounds = this.view.contentEl.getBoundingClientRect();
  if (!this.supported || !this.current() || bounds.width <= 0 || bounds.height <= 0) { this.close(false); return; }
  if (this.file !== this.view.file || this.path !== this.view.file?.path) {
   this.close(false); this.source = null; this.sourceId = ''; this.dismissed = null; this.file = this.view.file; this.path = this.view.file?.path;
  }
  const values = [...this.canvas.selection!];
  const source = values.length === 1 ? [...this.canvas.nodes.values()].find(node => node === values[0]) ?? null : null;
  const id = source && canvasRelationTaskId(source);
  if (!source || !id) { this.close(false); this.source = null; this.sourceId = ''; this.dismissed = null; return; }
  if (source !== this.source || id !== this.sourceId) {
   this.cancel(); this.dismissed = null; this.source = source; this.sourceId = id; this.limits.clear(); this.signature = '';
   if (this.body) this.body.scrollTop = 0;
  }
  if (this.canvas.readonly || this.cards.resolve(id).state !== 'ready') this.cancel();
  if (this.dismissed === source) return;
  if (!this.panel) this.open();
  if (!this.cancelGesture) this.render();
 }
 private open(): void {
  const session = this.session = new Component(); this.addChild(session);
  const panel = this.panel = this.view.contentEl.ownerDocument.body.createDiv(prefix);
  panel.setAttribute('role', 'dialog'); setAccessibleLabelWithoutTooltip(panel, label('Title'));
  const header = panel.createDiv(`${prefix}-header`); header.createEl('strong', { text: label('Title') });
  const pin = this.pin = header.createEl('button', { cls: `${prefix}-pin`, attr: { type: 'button' } }); this.updatePin();
  session.registerDomEvent(pin, 'click', () => { if (this.pinned) this.close(true); else { this.pinned = true; this.updatePin(); } });
  session.registerDomEvent(header, 'pointerdown', event => {
   if (pin.contains(event.target as Node) || event.button !== 0 || event.isPrimary === false) return;
   this.cancel(); const rect = panel.getBoundingClientRect();
   this.cancelGesture = startRelationsGesture(event, header, point => {
    if (!this.pinned) { this.pinned = true; this.updatePin(); } this.point = { x: rect.left + point.x - event.clientX, y: rect.top + point.y - event.clientY }; this.position();
   }, () => {}, () => { this.cancelGesture = null; this.schedule(); });
  });
  this.selected = panel.createDiv(`${prefix}-selected`);
  this.body = panel.createDiv(`${prefix}-body`);
  session.registerDomEvent(panel, 'pointerdown', event => event.stopPropagation());
  session.registerDomEvent(panel.ownerDocument, 'keydown', event => {
   if (event.key !== 'Escape' || event.defaultPrevented || this.cancelGesture) return;
   const target = event.target as HTMLElement;
   if (target.closest?.('.modal-container, .operon-floating-panel, .operon-field-picker')) return;
   event.preventDefault(); this.close(true);
  });
 }
 private updatePin(): void {
  if (!this.pin) return;
  this.pin.empty(); setIcon(this.pin, this.pinned ? 'pin-off' : 'pin'); this.pin.setAttribute('aria-pressed', String(this.pinned));
  setAccessibleLabelWithoutTooltip(this.pin, label(this.pinned ? 'Unpin' : 'Pin'));
 }
 private position(): void {
  if (!this.panel) return;
  const bounds = this.view.contentEl.getBoundingClientRect();
  const left = Math.max(8, bounds.left + 8), top = Math.max(8, bounds.top + 8);
  const right = Math.min(this.win.innerWidth - 8, bounds.right - 8), bottom = Math.min(this.win.innerHeight - 8, bounds.bottom - 8);
  const width = Math.max(0, Math.min(360, right - left));
  this.panel.style.width = `${width}px`; this.panel.style.maxHeight = `${Math.max(0, bottom - top)}px`;
  const x = Math.max(left, Math.min(this.point?.x ?? right - width - 48, right - width));
  const y = Math.max(top, Math.min(this.point?.y ?? top, bottom - this.panel.getBoundingClientRect().height));
  this.panel.style.left = `${x}px`; this.panel.style.top = `${y}px`;
 }
 private render(): void {
  if (!this.source || !this.selected || !this.body) return;
  const source = this.cards.resolve(this.sourceId), presence = canvasRelationPresence(this.canvas, this.source);
  const groups = buildCanvasTaskRelations(this.sourceId, id => this.cards.resolve(id), [...this.cards.deps.controls?.getChildIds(this.sourceId) ?? []], presence.present, presence.connected);
  const settings = this.cards.deps.getSettings();
  const signature = JSON.stringify([source.state === 'ready' ? source.task.description : source.state, this.canvas.readonly,
   groups.map(group => [group.key, this.limits.get(group.key) ?? 25, group.rows.map(row => [row.id, row.name, row.rank, row.resolution.state,
    row.resolution.state === 'ready' ? resolveTaskDisplayIcon(settings, row.resolution.task.fieldValues, row.resolution.task.checkbox) : 'help-circle'])])]);
  if (signature === this.signature) { this.position(); return; } this.signature = signature;
  const scroll = new Map(Array.from(this.body.querySelectorAll<HTMLElement>(`.${prefix}-list`)).map(el => [el.dataset.section, el.scrollTop]));
  const bodyScroll = this.body.scrollTop;
  if (this.rows) this.removeChild(this.rows); const lifetime = this.rows = new Component(); this.addChild(lifetime);
  this.body.empty(); this.selected.empty();
  if (source.state === 'ready') {
   const title = this.selected.createEl('button', { cls: `${prefix}-name`, attr: { type: 'button' } });
   renderCompactTaskMarkdown(title, { app: this.owner.deps.app, value: source.task.description || this.sourceId, mode: 'visual-only' });
   lifetime.registerDomEvent(title, 'click', event => this.cards.activate(this.sourceId, event.metaKey || event.ctrlKey));
  } else this.selected.setText(this.sourceId);
  if (!groups.length) this.body.createDiv({ cls: `${prefix}-empty`, text: source.state === 'ready' ? label('Empty') : t('errors', `taskCard_${source.state}`, { id: this.sourceId }) });
  for (const group of groups) {
   const section = this.body.createDiv(`${prefix}-section`);
   section.createEl('strong', { cls: `${prefix}-section-title`, text: `${label(group.key)} · ${group.rows.length}` });
   const list = section.createDiv(`${prefix}-list`); list.dataset.section = group.key;
   const limit = this.limits.get(group.key) ?? 25; let rank = -1;
   for (const row of group.rows.slice(0, limit)) {
    if (row.rank !== rank && group.key !== 'connections') { rank = row.rank; list.createDiv({ cls: `${prefix}-group`, text: label(['Connected', 'Here', 'Elsewhere'][rank]) }); }
    this.renderRow(row, list, lifetime);
   }
   list.scrollTop = scroll.get(group.key) ?? 0;
   lifetime.registerDomEvent(list, 'scroll', () => {
    if (this.cancelGesture || limit >= group.rows.length || list.scrollTop + list.clientHeight < list.scrollHeight - 48) return;
    this.limits.set(group.key, limit + 25); this.render();
   });
  }
  this.body.scrollTop = bodyScroll; this.position();
 }
 private renderRow(value: RelationRow, list: HTMLElement, lifetime: Component): void {
  const row = list.createDiv(`${prefix}-row`), resolution = value.resolution;
  const icon = row.createSpan(`${prefix}-icon`); icon.setAttribute('aria-hidden', 'true');
  setIcon(icon, resolution.state === 'ready' ? resolveTaskDisplayIcon(this.cards.deps.getSettings(), resolution.task.fieldValues, resolution.task.checkbox) : 'help-circle');
  const title = row.createEl('button', { cls: `${prefix}-name`, attr: { type: 'button' } });
  renderCompactTaskMarkdown(title, { app: this.owner.deps.app, value: value.name, mode: 'visual-only' });
  title.disabled = resolution.state !== 'ready';
  if (resolution.state !== 'ready') {
   row.classList.add('is-unavailable'); row.createSpan({ cls: `${prefix}-unavailable`, text: label('Unavailable') });
   setAccessibleLabelWithoutTooltip(title, t('errors', `taskCard_${resolution.state}`, { id: value.id }));
  }
  lifetime.registerDomEvent(title, 'click', event => this.cards.activate(value.id, event.metaKey || event.ctrlKey));
  const grip = row.createEl('button', { cls: `${prefix}-grip`, attr: { type: 'button' } }); setIcon(grip, 'grip-vertical');
  setAccessibleLabelWithoutTooltip(grip, `${label('Drag')}: ${value.name}. ${label('Keyboard')}`);
  grip.disabled = this.canvas.readonly || resolution.state !== 'ready';
  lifetime.registerDomEvent(grip, 'pointerdown', event => {
   if (event.button !== 0 || event.isPrimary === false) return;
   const drag = this.capture(value); if (!drag) return;
   this.cancel(); this.cancelGesture = startRelationsGesture(event, grip, point => this.preview(point, value.name), point => { void this.drop(drag, point); }, () => { this.cancelGesture = null; this.clearGhost(); this.schedule(); });
  });
  lifetime.registerDomEvent(grip, 'keydown', event => {
   if (event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return;
   event.preventDefault(); event.stopPropagation(); const drag = this.capture(value); if (drag) this.keyboardDrag(drag, grip);
  });
 }
 private capture(value: RelationRow): DragTask | null {
  const source = this.source, sourceId = this.sourceId, target = this.owner.capture(this.view);
  if (!this.current() || !this.panel?.isConnected || this.view.file !== this.file || this.view.file?.path !== this.path
   || !source || !target || this.busy || this.cards.resolve(sourceId).state !== 'ready' || this.cards.resolve(value.id).state !== 'ready') return null;
  const current = target.isCurrent.bind(target) as () => boolean;
  target.isCurrent = () => this.current() && current() && this.canvas.nodes.get(source.id) === source && canvasRelationTaskId(source) === sourceId
   && this.cards.resolve(sourceId).state === 'ready' && this.cards.resolve(value.id).state === 'ready';
  return { target, source, id: value.id, name: value.name };
 }
 private isEmptyPoint(point: CanvasPoint): boolean {
  const bounds = this.view.contentEl.getBoundingClientRect();
  if (point.x < bounds.left || point.x > bounds.right || point.y < bounds.top || point.y > bounds.bottom) return false;
  const target = this.view.contentEl.ownerDocument.elementFromPoint(point.x, point.y);
  return !!target && !!this.canvas.wrapperEl?.contains(target) && !target.closest('.canvas-node, .canvas-edge, .canvas-interaction-path, .canvas-display-path, .canvas-path-end, .canvas-path-label-wrapper, .canvas-path-label, .canvas-node-interaction-layer, .canvas-selection, .canvas-controls, .canvas-control-group, .canvas-card-menu, .canvas-menu, button, input, textarea');
 }
 private preview(point: CanvasPoint, name: string): void {
  if (!this.ghost) this.ghost = this.view.contentEl.ownerDocument.body.createDiv({ cls: `${prefix}-preview`, text: name });
  this.ghost.classList.toggle('is-invalid', !this.isEmptyPoint(point));
  this.ghost.style.left = `${point.x + 12}px`; this.ghost.style.top = `${point.y + 12}px`;
 }
 private async drop(drag: DragTask, point: CanvasPoint): Promise<void> {
  if (!this.isEmptyPoint(point) || !drag.target.isCurrent() || this.canvas.readonly || this.busy) return;
  const canvasPoint = this.canvas.posFromClient!(point), connection = canvasConnectionAtPoint(drag.source, canvasPoint);
  if (!connection) return;
  drag.target.point = canvasPoint; drag.target.connection = connection; this.busy = true;
  try { await this.owner.add(drag.target, drag.id); } finally { this.busy = false; this.schedule(); }
 }
 private keyboardDrag(drag: DragTask, grip: HTMLElement): void {
  this.cancel(); const doc = grip.ownerDocument, bounds = this.view.contentEl.getBoundingClientRect();
  const point = { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 };
  const cancel = () => { doc.removeEventListener('keydown', key, true); doc.removeEventListener('pointerdown', cancel, true); this.win.removeEventListener('blur', cancel); this.cancelGesture = null; this.clearGhost(); this.schedule(); };
  const key = (event: KeyboardEvent) => {
   if (!['Enter', ' ', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab'].includes(event.key)) return;
   event.preventDefault(); event.stopImmediatePropagation();
   if (event.key === 'Escape' || event.key === 'Tab') { cancel(); grip.focus({ preventScroll: true }); return; }
   if (event.key === 'Enter' && !event.repeat) { cancel(); void this.drop(drag, point); return; }
   const step = event.shiftKey ? 80 : 24;
   point.x += event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
   point.y += event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
   point.x = Math.max(bounds.left + 1, Math.min(bounds.right - 1, point.x)); point.y = Math.max(bounds.top + 1, Math.min(bounds.bottom - 1, point.y));
   this.preview(point, drag.name);
  };
  this.cancelGesture = cancel; doc.addEventListener('keydown', key, true); doc.addEventListener('pointerdown', cancel, true); this.win.addEventListener('blur', cancel); this.preview(point, drag.name);
 }
 private clearGhost(): void { this.ghost?.remove(); this.ghost = null; }
 private cancel(): void { this.cancelGesture?.(); this.cancelGesture = null; this.clearGhost(); }
 private close(suppress: boolean): void {
  if (suppress) this.dismissed = this.source;
  this.cancel(); if (this.rows) this.removeChild(this.rows); this.rows = null;
  if (this.session) this.removeChild(this.session); this.session = null;
  this.panel?.remove(); this.panel = null; this.selected = null; this.body = null; this.pin = null;
  this.pinned = false; this.point = null; this.signature = '';
 }
 onunload(): void { this.active = false; this.close(false); if (this.frame) this.win.cancelAnimationFrame(this.frame); this.frame = 0; }
}
