import { Component, Notice } from 'obsidian';
import { getOwnerWindow } from '../core/dom-compat';
import { t } from '../core/i18n';
import type { CanvasTaskNode, TaskCanvasView } from './canvas-task-adapter';
import { fitCanvasTaskHeight } from './canvas-task-size';
import { readCanvasTaskReference } from './canvas-task-node';
import { readCanvasTaskId } from './task-card-canvas';

function taskId(node: CanvasTaskNode): string | null {
 const data = node.getData();
 return readCanvasTaskReference(data)?.taskId ?? (data.type === 'text' && typeof data.text === 'string' ? readCanvasTaskId(data.text) : null);
}

interface BoxSize { width: number; height: number }
interface HeightEntry {
 id: string;
 root: HTMLElement;
 width: unknown;
 height: unknown;
 connected: boolean;
 editing: boolean;
 sizes: Map<Element, BoxSize>;
 expected: Map<Element, BoxSize>;
 cleanup(): void;
}

/** A surface-owned layout pass: only invalidated cards enter the measurement queue. */
export class CanvasTaskAutoHeight extends Component {
 private entries = new Map<CanvasTaskNode, HeightEntry>();
 private dirty = new Set<CanvasTaskNode>();
 private waiting = new Set<CanvasTaskNode>();
 private frame = 0;
 private retry = 0;
 private active = false;
 private interacting = false;
 private failed = false;
 private readonlyState: boolean | undefined;
 private minimum: number | undefined;
 constructor(private view: TaskCanvasView, private current: () => boolean, private busy: () => boolean) { super(); }
 onload(): void {
  this.active = true;
  this.registerDomEvent(this.view.contentEl, 'pointerdown', () => { this.interacting = true; }, true);
  const released = () => { this.interacting = false; this.resume(); };
  const win = getOwnerWindow(this.view.contentEl), doc = this.view.contentEl.ownerDocument;
  this.registerDomEvent(win, 'pointerup', released);
  this.registerDomEvent(win, 'pointercancel', released);
  this.registerDomEvent(win, 'blur', released);
  this.registerDomEvent(win, 'focus', () => this.resume());
  this.registerDomEvent(win, 'resize', () => this.resume());
  if (typeof doc.addEventListener === 'function') this.registerDomEvent(doc, 'visibilitychange', () => this.resume());
  const fonts = doc.fonts;
  if (fonts) {
   const changed = () => this.invalidate();
   fonts.addEventListener('loadingdone', changed); fonts.addEventListener('loadingerror', changed);
   this.register(() => { fonts.removeEventListener('loadingdone', changed); fonts.removeEventListener('loadingerror', changed); });
   void fonts.ready.then(() => { if (this.active) this.invalidate(); });
  }
  const Resize = (win as Window & { ResizeObserver: typeof ResizeObserver }).ResizeObserver;
  if (typeof Resize === 'function') {
   let previous: BoxSize | undefined;
   const resize = new Resize((records = []) => {
    const rect = records[0]?.contentRect;
    if (rect && (rect.width !== previous?.width || rect.height !== previous?.height)) { previous = { width: rect.width, height: rect.height }; this.resume(); }
   });
   resize.observe(this.view.contentEl); this.register(() => resize.disconnect());
  }
  const canvas = this.view.canvas, original = Reflect.get(canvas, 'importData'), descriptor = Object.getOwnPropertyDescriptor(canvas, 'importData');
  if (typeof original === 'function') {
   const wrapper: NonNullable<typeof canvas.importData> = (...args) => { const result: unknown = Reflect.apply(original, canvas, args); this.invalidate(); return result; };
   canvas.importData = wrapper;
   this.register(() => { if (canvas.importData === wrapper) { if (descriptor) Object.defineProperty(canvas, 'importData', descriptor); else Reflect.deleteProperty(canvas, 'importData'); } });
  }
 }
 /** Full layout invalidation is reserved for settings, CSS/fonts and imports. */
 invalidate(): void {
  if (!this.active || this.failed) return;
  for (const node of this.entries.keys()) this.mark(node);
 }
 private mark(node: CanvasTaskNode): void {
  if (!this.active || this.failed || !this.entries.has(node)) return;
  this.entries.get(node)!.expected.clear(); this.waiting.delete(node); this.dirty.add(node); this.schedule();
 }
 private resume(): void {
  if (!this.active) return;
  for (const node of this.waiting) this.dirty.add(node);
  this.waiting.clear(); this.schedule();
 }
 sync(roots: Map<CanvasTaskNode, HTMLElement>): void {
  if (!this.active) return;
  for (const [node, entry] of this.entries) if (roots.get(node) !== entry.root || taskId(node) !== entry.id) {
   entry.cleanup(); this.entries.delete(node); this.dirty.delete(node); this.waiting.delete(node);
  }
  const win = getOwnerWindow(this.view.contentEl) as Window & { ResizeObserver: typeof ResizeObserver; MutationObserver: typeof MutationObserver };
  if (typeof win.ResizeObserver !== 'function' || typeof win.MutationObserver !== 'function') return;
  const changedState = this.readonlyState !== this.view.canvas.readonly || this.minimum !== this.view.canvas.config.minContainerDimension;
  this.readonlyState = this.view.canvas.readonly; this.minimum = this.view.canvas.config.minContainerDimension;
  for (const [node, root] of roots) {
   const id = taskId(node); if (!id) continue;
   const data = node.getData();
   let entry = this.entries.get(node);
   if (!entry) {
    const sizes = new Map<Element, BoxSize>(), expected = new Map<Element, BoxSize>();
    let card: Element | null = null;
    const alive = () => this.active && this.entries.get(node) === entry;
    const changed = () => { if (alive()) this.mark(node); };
    const resize = new win.ResizeObserver((records = []) => {
     if (!alive()) return;
     let needsMeasure = records.length === 0;
     for (const record of records) {
      const before = sizes.get(record.target), next = { width: record.contentRect.width, height: record.contentRect.height };
      sizes.set(record.target, next);
      if (before?.width === next.width && before.height === next.height) continue;
      const own = expected.get(record.target); expected.delete(record.target);
      if (own?.width === next.width && own.height === next.height) continue;
      needsMeasure = true;
     }
     if (needsMeasure) changed();
    });
    const observeCard = () => {
     const next = root.querySelector('.operon-task-card'); if (next === card) return;
     if (card) { resize.unobserve?.(card); sizes.delete(card); expected.delete(card); }
     card = next; if (card) resize.observe(card);
    };
    const observer = new win.MutationObserver(() => { if (alive()) { observeCard(); changed(); } });
    entry = { id, root, width: data.width, height: data.height, connected: root.isConnected, editing: !!node.isEditing, sizes, expected, cleanup: () => {
     observer.disconnect(); resize.disconnect(); root.removeEventListener('load', changed, true); root.removeEventListener('error', changed, true);
     node.nodeEl.classList.remove('operon-canvas-auto-height');
    } };
    this.entries.set(node, entry);
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-task-card-state'] });
    resize.observe(node.nodeEl); resize.observe(root); observeCard();
    root.addEventListener('load', changed, true); root.addEventListener('error', changed, true); this.mark(node);
   } else if (entry.width !== data.width || entry.height !== data.height || entry.connected !== root.isConnected || entry.editing !== !!node.isEditing || changedState) {
    entry.width = data.width; entry.height = data.height; entry.connected = root.isConnected; entry.editing = !!node.isEditing; this.mark(node);
   }
   node.nodeEl.classList.toggle('operon-canvas-auto-height', !this.view.canvas.readonly && !this.failed);
  }
  this.schedule();
 }
 private schedule(): void {
  if (!this.active || !this.dirty.size || this.frame || this.retry || this.failed) return;
  this.frame = getOwnerWindow(this.view.contentEl).requestAnimationFrame(() => { this.frame = 0; this.fit(); });
 }
 private fit(): void {
  const { view } = this, canvas = view.canvas;
  if (!this.active || this.failed || !this.current() || canvas.readonly || !view.file || view.lastSavedData === null) return;
  if (view.saving || this.busy() || this.interacting) {
   this.retry = getOwnerWindow(view.contentEl).setTimeout(() => { this.retry = 0; this.schedule(); }, 100); return;
  }
  let changed = false;
  try {
   for (const node of [...this.dirty]) {
    this.dirty.delete(node);
    const entry = this.entries.get(node); if (!entry) continue;
    const { id, root } = entry;
    if (canvas.nodes.get(node.id) !== node || taskId(node) !== id || !node.contentEl?.contains(root)) continue;
    if (node.isEditing) { entry.editing = true; this.waiting.add(node); continue; }
    const { width: beforeWidth, height: beforeHeight } = node.getData(); let measured = false;
    const fitted = fitCanvasTaskHeight(node, root, canvas.config.minContainerDimension, () => { measured = true; });
    if (!measured) { this.waiting.add(node); continue; }
    this.waiting.delete(node);
    const data = node.getData(); entry.width = data.width; entry.height = data.height;
    if (!fitted) continue;
    changed = true;
    if (typeof beforeHeight === 'number' && typeof data.height === 'number' && beforeWidth === data.width) {
     for (const target of [node.nodeEl, root]) {
      const size = entry.sizes.get(target);
      if (size) entry.expected.set(target, { width: size.width, height: size.height + data.height - beforeHeight });
     }
    }
    // Keep the current native history object's identity for color/conversion Undo.
    const head = typeof canvas.history.current === 'number' ? canvas.history.data[canvas.history.current] : null;
    const snapshot = (head as { nodes?: Record<string, unknown>[] } | null)?.nodes?.find(value => value.id === node.id);
    if (snapshot) { snapshot.height = data.height; snapshot.x = data.x; snapshot.y = data.y; }
   }
   if (changed) { canvas.requestSave(false); void view.save().catch(() => { if (this.active) this.fail(); }); }
  } catch { this.fail(); }
 }
 private fail(): void {
  if (!this.failed) { this.failed = true; this.dirty.clear(); this.waiting.clear(); for (const node of this.entries.keys()) node.nodeEl.classList.remove('operon-canvas-auto-height'); new Notice(t('notifications', 'canvasTaskSaveFailed')); }
 }
 onunload(): void {
  this.active = false;
  const win = getOwnerWindow(this.view.contentEl);
  if (this.frame) win.cancelAnimationFrame(this.frame);
  if (this.retry) win.clearTimeout(this.retry);
  for (const entry of this.entries.values()) entry.cleanup();
  this.entries.clear(); this.dirty.clear(); this.waiting.clear();
 }
}
