import { Component, Notice } from 'obsidian';
import { t } from '../core/i18n';
import type { TaskCanvas, TaskCanvasView } from './canvas-task-adapter';
import { readCanvasTaskReference } from './canvas-task-node';

export type CanvasHistoryDirection = 'undo' | 'redo';
export interface HistoryCanvas extends TaskCanvas {
 history: { data: unknown[]; current: number };
 undo(): void;
 redo(): void;
}
export interface CanvasHistoryStep { current: unknown; next: unknown; direction: CanvasHistoryDirection; native(): void }
type Handler = (step: CanvasHistoryStep) => (() => Promise<void>) | null;
export function isUnrecordedCanvasConversion(a: unknown, b: unknown): boolean {
 const nodes = (value: unknown) => (value as { nodes?: Record<string, unknown>[] } | null)?.nodes ?? [];
 return nodes(a).some(node => {
  const other = nodes(b).find(item => item.id === node.id);
  return !!other && node.type === 'text' && other.type === 'text' && !!readCanvasTaskReference(node) !== !!readCanvasTaskReference(other);
 });
}
/** One owner for native history dispatch; source-writing operations can delay travel. */
export class CanvasTaskHistory extends Component {
 private handlers: Handler[] = [];
 private busy = false;
 private reservations = 0;
 private active = false;
 supported = false;
 readonly canvas: HistoryCanvas;
 constructor(readonly view: TaskCanvasView) { super(); this.canvas = view.canvas as HistoryCanvas; }
 onload(): void {
  const canvas = this.canvas;
  if (typeof canvas.history?.current !== 'number' || typeof canvas.undo !== 'function' || typeof canvas.redo !== 'function') return;
  this.active = this.supported = true;
  for (const direction of ['undo', 'redo'] as const) {
   const original = canvas[direction], descriptor = Object.getOwnPropertyDescriptor(canvas, direction);
   const wrapper = () => {
    if (!this.active) { original.call(canvas); return; }
    if (this.busy || this.reservations) return;
    canvas.requestPushHistory.run();
    const current = canvas.history.data[canvas.history.current], next = canvas.history.data[canvas.history.current + (direction === 'undo' ? -1 : 1)];
    if (!next) return;
    const step: CanvasHistoryStep = { current, next, direction, native: () => { original.call(canvas); } };
    for (const handler of this.handlers) {
     const run = handler(step); if (!run) continue;
     this.busy = true;
     void run().catch(() => { new Notice(t('notifications', 'canvasConversionBlocked')); }).finally(() => { this.busy = false; }); return;
    }
    if (isUnrecordedCanvasConversion(current, next)) { new Notice(t('notifications', 'canvasConversionBlocked')); return; }
    step.native();
   };
   canvas[direction] = wrapper;
   this.register(() => { if (canvas[direction] !== wrapper) return; if (descriptor) Object.defineProperty(canvas, direction, descriptor); else Reflect.deleteProperty(canvas, direction); });
  }
 }
 get isBusy(): boolean { return this.busy || this.reservations > 0; }
 reserve(): () => void { this.reservations++; let released = false; return () => { if (!released) { released = true; this.reservations--; } }; }
 addHandler(handler: Handler): () => void { this.handlers.unshift(handler); return () => { this.handlers = this.handlers.filter(item => item !== handler); }; }
 lockInput(): () => void {
  const root = this.view.contentEl;
  const stop = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
  const names = ['pointerdown', 'pointermove', 'pointerup', 'keydown', 'beforeinput', 'drop', 'paste'] as const;
  for (const name of names) root.addEventListener(name, stop, true);
  let released = false;
  const release = () => { if (released) return; released = true; for (const name of names) root.removeEventListener(name, stop, true); };
  this.register(release); return release;
 }
 onunload(): void { this.active = this.supported = false; this.handlers = []; }
}
