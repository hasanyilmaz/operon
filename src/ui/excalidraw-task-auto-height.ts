import { isExcalidrawTaskStrokeEditing } from './excalidraw-task-colors';
import { Notice } from 'obsidian';
import { createOwnerElement, getOwnerWindow } from '../core/dom-compat';
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

/** Resolve CSS names and modern theme expressions without adding nodes to the observed card. */
export function resolveExcalidrawTaskStroke(card: HTMLElement): string | null {
 const style = getOwnerWindow(card).getComputedStyle(card);
 const token = style.getPropertyValue?.('--operon-excalidraw-task-stroke').trim();
 if (!token) return null;
 if (token.toLowerCase() === 'transparent') return 'transparent';
 if (/^#[a-f0-9]{6}$/i.test(token)) return token.toLowerCase();
 const canvas = createOwnerElement(card, 'canvas'); canvas.width = 1; canvas.height = 1;
 const context = canvas.getContext('2d'); if (!context) return null;
 const color = token.replace(/\bcurrentcolor\b/gi, style.color);
 // Invalid assignments retain the previous fill. Two different seeds distinguish them from valid black/white.
 context.fillStyle = '#000000'; context.fillStyle = color; const parsed = context.fillStyle;
 context.fillStyle = '#ffffff'; context.fillStyle = color;
 if (context.fillStyle !== parsed) return null;
 if (/^#[a-f0-9]{6}$/i.test(parsed)) return parsed.toLowerCase();
 const rgba = /^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/.exec(parsed);
 if (rgba) {
  const alpha = Math.round(Number(rgba[4] ?? 1) * 255); if (!alpha) return 'transparent';
  const channels = rgba.slice(1, 4).map(Number); if (alpha !== 255) channels.push(alpha);
  return '#' + channels.map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('');
 }
 context.fillRect(0, 0, 1, 1);
 const pixel = context.getImageData(0, 0, 1, 1).data;
 if (!pixel[3]) return 'transparent';
 return '#' + Array.from(pixel.slice(0, pixel[3] === 255 ? 3 : 4), channel => channel.toString(16).padStart(2, '0')).join('');
}

/** Per-card observation; height and frame color share one native write queue, never polled. */
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
  win.addEventListener('pointerup', up, true); win.addEventListener('pointercancel', up, true); win.addEventListener('blur', blur);
  this.cleanup.push(() => { view.contentEl.removeEventListener('pointerdown', down, true);
   win.removeEventListener('pointerup', up, true); win.removeEventListener('pointercancel', up, true); win.removeEventListener('blur', blur); });
  this.sceneChanged(view.excalidrawAPI.getSceneElements().find(element => element.id === id), view.excalidrawAPI.getAppState().viewModeEnabled, view.excalidrawAPI.getAppState().theme);
 }
 sceneChanged(element: ExcalidrawTaskElement | undefined, readonly: boolean | undefined, theme?: unknown): void {
  const signature = JSON.stringify([element?.width, element?.height, element?.scale, element?.locked, element?.isDeleted, element?.strokeColor, readonly, theme]);
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
  // Store the configured Task Card color; Excalidraw retains its native dark-mode stroke rendering.
  const card = this.root.querySelector<HTMLElement>('.operon-task-card');
  const stroke = card ? resolveExcalidrawTaskStroke(card) : null;
  const strokeColor = !isExcalidrawTaskStrokeEditing(this.view, this.id) && stroke && stroke !== element.strokeColor?.toLowerCase() ? stroke : null;
  if (!plan && !strokeColor) return;
  const patch = { ...plan, ...(strokeColor ? { strokeColor } : {}) };
  const matches = (value: ExcalidrawTaskElement) => value.width === element.width
   && Object.entries(patch).every(([key, expected]) => value[key as keyof ExcalidrawTaskElement] === expected);
  const ea = this.view.plugin.ea.getAPI(this.view);
  try {
   if (typeof ea.copyViewElementsToEAforEditing !== 'function' || typeof ea.getElement !== 'function') return;
   ea.copyViewElementsToEAforEditing([element]);
   const copy = ea.getElement(this.id); if (!copy || copy === element || !current()) return;
   Object.assign(copy, patch);
   if (!await ea.addElementsToView(false, false, false, false, 'NEVER')) throw new Error('Card presentation update failed');
   if (!current()) return;
   await this.view.forceSave(true, true);
   if (!current()) return;
   const saved = await ea.getSceneFromFile(file);
   if (!current()) return;
   const live = this.view.excalidrawAPI.getSceneElements().find(value => value.id === this.id);
   // A subsequent native user edit wins; never retry or restore an older measurement.
   if (!live || !matches(live)) return;
   if (!saved?.elements.some(value => value.id === this.id && !value.isDeleted && matches(value)))
    throw new Error('Card presentation save could not be verified');
  } finally { ea.destroy(); }
 }
 destroy(): void {
  this.active = false; this.observer?.disconnect();
  if (this.frame) getOwnerWindow(this.root).cancelAnimationFrame(this.frame);
  this.frame = 0; for (const cleanup of this.cleanup) cleanup(); this.cleanup = [];
 }
}
