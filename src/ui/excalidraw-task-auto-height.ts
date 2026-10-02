import { Notice } from 'obsidian';
import { getOwnerWindow } from '../core/dom-compat';
import { t } from '../core/i18n';
import { measureTaskCardHeight } from './canvas-task-size';
import type { ExcalidrawTaskElement, ExcalidrawTaskView } from './excalidraw-task-bridge';

const queues = new WeakMap<ExcalidrawTaskView, Promise<void>>();
const failed = new WeakSet<ExcalidrawTaskView>();

/** Keep the rotated top edge fixed while preserving the user's width and native scale. */
export function planExcalidrawTaskHeight(element: ExcalidrawTaskElement, measuredHeight: number): { x: number; y: number; height: number } | null {
 const { x, y, width, height } = element, angle = element.angle ?? 0, scaleY = Math.abs(element.scale?.[1] ?? 1);
 if (![x, y, width, height, angle, scaleY, measuredHeight].every(value => typeof value === 'number' && Number.isFinite(value))
  || !width || width <= 0 || !height || height <= 0 || scaleY <= 0 || measuredHeight <= 0 || x === undefined || y === undefined) return null;
 const next = Math.round(measuredHeight * scaleY * 1000) / 1000, delta = next - height;
 if (Math.abs(delta) < 0.5) return null;
 return { x: x - Math.sin(angle) * delta / 2, y: y + (Math.cos(angle) - 1) * delta / 2, height: next };
}

/** Per-card observation; native scene writes are serialized per drawing, never polled. */
export class ExcalidrawTaskAutoHeight {
 private active = true;
 private frame = 0;
 private busy = false;
 private dirty = false;
 private pointers = new Set<number>();
 private geometry = '';
 private observer: ResizeObserver | null = null;
 private cleanup: (() => void)[] = [];
 constructor(private root: HTMLElement, private container: HTMLElement, private view: ExcalidrawTaskView,
  private id: string, private allowed: () => boolean) {
  const win = getOwnerWindow(root) as Window & { ResizeObserver: typeof ResizeObserver };
  const card = root.querySelector('.operon-task-card');
  if (typeof win.ResizeObserver === 'function' && card) {
   this.observer = new win.ResizeObserver(() => this.schedule());
   this.observer.observe(card); this.observer.observe(root);
  }
  const down = (event: PointerEvent) => { this.pointers.add(event.pointerId); };
  const up = (event: PointerEvent) => { if (this.pointers.delete(event.pointerId)) this.schedule(); };
  const blur = () => { const pending = this.pointers.size > 0; this.pointers.clear(); if (pending) this.schedule(); };
  view.contentEl.addEventListener('pointerdown', down, true);
  win.addEventListener('pointerup', up); win.addEventListener('pointercancel', up); win.addEventListener('blur', blur);
  this.cleanup.push(() => { view.contentEl.removeEventListener('pointerdown', down, true);
   win.removeEventListener('pointerup', up); win.removeEventListener('pointercancel', up); win.removeEventListener('blur', blur); });
  this.sceneChanged(view.excalidrawAPI.getSceneElements().find(element => element.id === id), view.excalidrawAPI.getAppState().viewModeEnabled);
 }
 sceneChanged(element: ExcalidrawTaskElement | undefined, readonly: boolean | undefined): void {
  const signature = JSON.stringify([element?.width, element?.height, element?.scale, element?.locked, element?.isDeleted, readonly]);
  if (signature === this.geometry) return;
  this.geometry = signature; this.schedule();
 }
 schedule(): void {
  if (!this.active || failed.has(this.view)) return;
  this.dirty = true;
  if (this.frame || this.busy || this.pointers.size > 0) return;
  this.frame = getOwnerWindow(this.root).requestAnimationFrame(() => {
   this.frame = 0;
   if (!this.active || this.pointers.size > 0) return;
   this.dirty = false; this.busy = true;
   const previous = queues.get(this.view) ?? Promise.resolve();
   const job = previous.then(() => this.fit()).catch(() => {
    if (this.active && !failed.has(this.view)) { failed.add(this.view); new Notice(t('notifications', 'excalidrawTaskSaveFailed')); }
   }).finally(() => { this.busy = false; if (this.dirty) this.schedule(); });
   queues.set(this.view, job);
  });
 }
 private async fit(): Promise<void> {
  const file = this.view.file, path = file?.path;
  const current = () => this.active && this.pointers.size === 0 && !failed.has(this.view) && this.view.file === file && file?.path === path && this.allowed();
  if (!file || !current()) return;
  const element = this.view.excalidrawAPI.getSceneElements().find(value => value.id === this.id);
  if (!element || element.locked || element.isDeleted) return;
  const measured = measureTaskCardHeight(this.root, this.container, 40);
  if (measured === null) return;
  const outer = this.container.closest<HTMLElement>('.excalidraw__embeddable__outer');
  const style = outer ? getOwnerWindow(outer).getComputedStyle(outer) : null;
  const inset = style ? (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0) : 0;
  const plan = planExcalidrawTaskHeight(element, measured + inset);
  if (!plan) return;
  const ea = this.view.plugin.ea.getAPI(this.view);
  try {
   if (typeof ea.copyViewElementsToEAforEditing !== 'function' || typeof ea.getElement !== 'function') return;
   ea.copyViewElementsToEAforEditing([element]);
   const copy = ea.getElement(this.id); if (!copy || copy === element || !current()) return;
   Object.assign(copy, plan);
   if (!await ea.addElementsToView(false, false, false, false, 'NEVER')) throw new Error('Height update failed');
   if (!current()) return;
   await this.view.forceSave(true, true);
   if (!current()) return;
   const saved = await ea.getSceneFromFile(file);
   if (!current()) return;
   const live = this.view.excalidrawAPI.getSceneElements().find(value => value.id === this.id);
   // A subsequent native user edit wins; never retry or restore an older measurement.
   if (!live || live.height !== plan.height || live.width !== element.width || live.x !== plan.x || live.y !== plan.y) return;
   if (!saved?.elements.some(value => value.id === this.id && !value.isDeleted && value.height === plan.height && value.width === element.width && value.x === plan.x && value.y === plan.y))
    throw new Error('Height save could not be verified');
  } finally { ea.destroy(); }
 }
 destroy(): void {
  this.active = false; this.observer?.disconnect();
  if (this.frame) getOwnerWindow(this.root).cancelAnimationFrame(this.frame);
  this.frame = 0; for (const cleanup of this.cleanup) cleanup(); this.cleanup = [];
 }
}
