import type { App } from 'obsidian';
import { getOwnerWindow } from '../core/dom-compat';
import { parseTaskCardEmbed } from './task-card-embed-model';
import type { TaskCardLayoutOptions } from './task-card-layout-model';

export interface TaskCardCanvasBinding { view: object; nodeId: string; taskId: string; element: HTMLElement }
interface CanvasNodeReader { nodeEl?: HTMLElement; getData?: () => unknown }
interface CanvasViewReader { canvas?: { nodes?: Map<unknown, CanvasNodeReader> } }
/** Only a complete, single card fence may take over a text node's presentation. */
export function readCanvasTaskId(text: string, defaults?: TaskCardLayoutOptions): string | null {
 const lines = text.trim().split(/\r?\n/);
 const opening = /^(`{3,}|~{3,})operon\s*$/.exec(lines[0] ?? '');
 if (!opening || lines.length < 3 || !new RegExp(`^ {0,3}${opening[1][0]}{${opening[1].length},}\\s*$`).test(lines[lines.length - 1] ?? '')) return null;
 const parsed = parseTaskCardEmbed(lines.slice(1, -1).join('\n'), defaults);
 return 'options' in parsed ? parsed.options.taskId : null;
}
/** Feature-detected read access only; no Canvas methods or prototypes are patched. */
export function resolveTaskCardCanvasBinding(app: App, root: HTMLElement, taskId: string, defaults: TaskCardLayoutOptions): TaskCardCanvasBinding | null {
 const element = root.closest<HTMLElement>('.canvas-node');
 if (!element || element.classList.contains('is-editing')) return null;
 try {
  for (const leaf of app.workspace.getLeavesOfType('canvas')) {
   const view = leaf.view as unknown as CanvasViewReader;
   if (!(view.canvas?.nodes instanceof Map)) continue;
   for (const node of view.canvas.nodes.values()) {
    if (node?.nodeEl !== element || typeof node.getData !== 'function') continue;
    const data = node.getData() as { id?: unknown; type?: unknown; text?: unknown } | null;
    if (data?.type === 'text' && typeof data.id === 'string' && typeof data.text === 'string' && readCanvasTaskId(data.text, defaults) === taskId)
     return { view, element, nodeId: data.id, taskId };
   }
  }
 } catch { /* Unknown Canvas versions retain the ordinary Markdown embed. */ }
 return null;
}
const owners = new WeakMap<HTMLElement, Set<object>>();
export class TaskCardCanvasHost {
 binding: TaskCardCanvasBinding | null = null;
 private observer: MutationObserver | null = null;
 private element: HTMLElement | null = null;
 private frame = 0;
 private frameWindow: Window | null = null;
 private active = true;
 private resizeObserver: ResizeObserver | null = null;
 constructor(private app: App, private root: HTMLElement, private changed: () => void) {
  const owner = getOwnerWindow(root) as Window & { ResizeObserver: typeof ResizeObserver };
  this.resizeObserver = new owner.ResizeObserver(() => this.schedule());
  this.resizeObserver.observe(root);
 }
 private schedule(): void {
  if (this.frame || !this.active) return;
  const owner = getOwnerWindow(this.root);
  this.frameWindow = owner;
  this.frame = owner.requestAnimationFrame(() => {
   this.frame = 0; this.frameWindow = null;
   if (this.active) this.changed();
  });
 }
 refresh(taskId: string, defaults: TaskCardLayoutOptions): boolean {
  const element = this.root.closest<HTMLElement>('.canvas-node');
  if (element !== this.element) {
   this.observer?.disconnect(); this.element = element;
   if (element) {
    const owner = getOwnerWindow(element) as Window & { MutationObserver: typeof MutationObserver };
    this.observer = new owner.MutationObserver(() => this.schedule());
    this.observer.observe(element, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
   }
  }
  const next = resolveTaskCardCanvasBinding(this.app, this.root, taskId, defaults);
  if (this.binding?.element !== next?.element) {
   this.release();
   if (next) {
    const set = owners.get(next.element) ?? new Set<object>(); set.add(this); owners.set(next.element, set);

   }
  }
  if (next && !next.element.classList.contains('operon-task-card-canvas-node')) next.element.classList.add('operon-task-card-canvas-node');
  this.binding = next;
  return next !== null;
 }
 private release(): void {
  const element = this.binding?.element;
  if (!element) return;
  const set = owners.get(element); set?.delete(this);
  if (!set?.size) { element.classList.remove('operon-task-card-canvas-node'); owners.delete(element); }
  this.binding = null;
 }
 destroy(): void {
  this.active = false; this.observer?.disconnect(); this.resizeObserver?.disconnect();
  if (this.frame) this.frameWindow?.cancelAnimationFrame(this.frame);
  this.frame = 0; this.frameWindow = null;
  this.release();
 }
}

/** Fail closed for a Canvas root whose native read-only state cannot be resolved. */
export function isTaskCardCanvasReadOnly(app: App, root: HTMLElement): boolean {
 const element = root.closest<HTMLElement>('.canvas-node');
 if (!element) return false;
 for (const leaf of app.workspace.getLeavesOfType('canvas')) {
  const view = leaf.view as unknown as { canvas?: { readonly?: boolean; nodes?: Map<unknown, CanvasNodeReader> } };
  if (!(view.canvas?.nodes instanceof Map)) continue;
  for (const node of view.canvas.nodes.values()) if (node.nodeEl === element) return view.canvas.readonly !== false;
 }
 return true;
}
