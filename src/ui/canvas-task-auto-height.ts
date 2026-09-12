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

/** A surface-owned layout pass: render, resize and media all converge here. */
export class CanvasTaskAutoHeight extends Component {
 private entries = new Map<CanvasTaskNode, { id: string; root: HTMLElement; observer: MutationObserver; resize: ResizeObserver; cleanup(): void }>();
 private frame = 0;
 private retry = 0;
 private active = false;
 private interacting = false;
 private failed = false;
 constructor(private view: TaskCanvasView, private current: () => boolean, private busy: () => boolean) { super(); }
 onload(): void {
  this.active = true;
  this.registerDomEvent(this.view.contentEl, 'pointerdown', () => { this.interacting = true; }, true);
  const released = () => { this.interacting = false; this.schedule(); };
  const win = getOwnerWindow(this.view.contentEl);
  this.registerDomEvent(win, 'pointerup', released);
  this.registerDomEvent(win, 'pointercancel', released);
  this.registerDomEvent(win, 'blur', released);
 }
 sync(roots: Map<CanvasTaskNode, HTMLElement>): void {
  if (!this.active) return;
  for (const [node, entry] of this.entries) if (roots.get(node) !== entry.root || taskId(node) !== entry.id) { entry.cleanup(); this.entries.delete(node); }
  const win = getOwnerWindow(this.view.contentEl) as Window & { ResizeObserver: typeof ResizeObserver; MutationObserver: typeof MutationObserver };
  if (typeof win.ResizeObserver !== 'function' || typeof win.MutationObserver !== 'function') return;
  for (const [node, root] of roots) {
   const id = taskId(node); if (!id) continue;
   if (!this.entries.has(node)) {
    const changed = () => this.schedule();
    const resize = new win.ResizeObserver(changed);
    const observeCard = () => { resize.disconnect(); resize.observe(node.nodeEl); resize.observe(root); const card = root.querySelector('.operon-task-card'); if (card) resize.observe(card); };
    const observer = new win.MutationObserver(() => { observeCard(); changed(); });
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-task-card-state'] });
    observeCard(); root.addEventListener('load', changed, true); root.addEventListener('error', changed, true);
    this.entries.set(node, { id, root, observer, resize, cleanup: () => {
     observer.disconnect(); resize.disconnect(); root.removeEventListener('load', changed, true); root.removeEventListener('error', changed, true);
     node.nodeEl.classList.remove('operon-canvas-auto-height');
    } });
   }
   node.nodeEl.classList.toggle('operon-canvas-auto-height', !this.view.canvas.readonly && !this.failed);
  }
  this.schedule();
 }
 private schedule(): void {
  if (!this.active || this.frame || this.retry || this.failed) return;
  this.frame = getOwnerWindow(this.view.contentEl).requestAnimationFrame(() => { this.frame = 0; this.fit(); });
 }
 private fit(): void {
  const { view } = this, canvas = view.canvas;
  if (!this.active || this.failed || !this.current() || canvas.readonly || !view.file || view.lastSavedData === null) return;
  if (view.saving || this.busy() || this.interacting) {
   this.retry = getOwnerWindow(view.contentEl).setTimeout(() => { this.retry = 0; this.schedule(); }, 100);
   return;
  }
  let changed = false;
  try {
   for (const [node, { id, root }] of this.entries) {
    if (canvas.nodes.get(node.id) !== node || taskId(node) !== id || node.isEditing || !node.contentEl?.contains(root)) continue;
    if (!fitCanvasTaskHeight(node, root, canvas.config.minContainerDimension)) continue;
    changed = true;
    // Keep the current native history object's identity for color/conversion Undo.
    const head = typeof canvas.history.current === 'number' ? canvas.history.data[canvas.history.current] : null;
    const snapshot = (head as { nodes?: Record<string, unknown>[] } | null)?.nodes?.find(value => value.id === node.id);
    if (snapshot) { const data = node.getData(); snapshot.height = data.height; snapshot.x = data.x; snapshot.y = data.y; }
   }
   if (changed) { canvas.requestSave(false); void view.save().catch(() => this.fail()); }
  } catch { this.fail(); }
 }
 private fail(): void { if (!this.failed) { this.failed = true; for (const node of this.entries.keys()) node.nodeEl.classList.remove('operon-canvas-auto-height'); new Notice(t('notifications', 'canvasTaskSaveFailed')); } }
 onunload(): void {
  this.active = false;
  const win = getOwnerWindow(this.view.contentEl);
  if (this.frame) win.cancelAnimationFrame(this.frame);
  if (this.retry) win.clearTimeout(this.retry);
  for (const entry of this.entries.values()) entry.cleanup();
  this.entries.clear();
 }
}
