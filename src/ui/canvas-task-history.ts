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
 private pendingTasks = new Map<string, number>();
 private settled = new Set<() => void>();
 private voided = new Set<unknown>();
 supported = false;
 readonly canvas: HistoryCanvas;
 constructor(readonly view: TaskCanvasView) { super(); this.canvas = view.canvas as HistoryCanvas; }
 onload(): void {
  const canvas = this.canvas;
  if (typeof canvas.history?.current !== 'number' || typeof canvas.undo !== 'function' || typeof canvas.redo !== 'function') return;
  this.active = this.supported = true;
  for (const direction of ['undo', 'redo'] as const) {
   const original = canvas[direction], descriptor = Object.getOwnPropertyDescriptor(canvas, direction);
   const travel = async () => {
    if (!this.active) { original.call(canvas); return; }
    if (this.busy || this.reservations) return;
    if (this.pendingTasks.size) {
     const head = canvas.history.data[canvas.history.current], shape = JSON.stringify(canvas.getData());
     await new Promise<void>(resolve => this.settled.add(resolve));
     if (!this.active || this.busy || this.reservations || canvas.history.data[canvas.history.current] !== head || JSON.stringify(canvas.getData()) !== shape) return;
    }
    canvas.requestPushHistory.run();
    for (const value of this.voided) if (!canvas.history.data.includes(value)) this.voided.delete(value);
    // Failed optimistic moves retain snapshot identity for adjacent native/managed steps.
    while (this.voided.has(canvas.history.data[canvas.history.current + (direction === 'undo' ? 0 : 1)])) canvas.history.current += direction === 'undo' ? -1 : 1;
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
   const wrapper = () => { void travel().catch(() => { new Notice(t('notifications', 'canvasConversionBlocked')); }); };
   canvas[direction] = wrapper;
   this.register(() => { if (canvas[direction] !== wrapper) return; if (descriptor) Object.defineProperty(canvas, direction, descriptor); else Reflect.deleteProperty(canvas, direction); });
  }
 }
 get isInputBusy(): boolean { return this.busy || this.reservations > 0; }
 get isBusy(): boolean { return this.isInputBusy || this.pendingTasks.size > 0; }
 isTaskPending(id: string): boolean { return this.pendingTasks.has(id); }
 reserveTask(id: string): () => void {
  this.pendingTasks.set(id, (this.pendingTasks.get(id) ?? 0) + 1);
  let released = false;
  return () => {
   if (released) return; released = true;
   const remaining = (this.pendingTasks.get(id) ?? 1) - 1;
   if (remaining) this.pendingTasks.set(id, remaining); else this.pendingTasks.delete(id);
   if (!this.pendingTasks.size) { for (const resolve of this.settled) resolve(); this.settled.clear(); }
  };
 }
 /** Rebase only the failed move, retaining later edits and snapshot identities. */
 rollbackCanvasMove(before: unknown, after: unknown, id: string, start: { x: number; y: number }, end: { x: number; y: number }): boolean {
  const history = this.canvas.history, index = history.data.indexOf(after);
  if (index < 1 || history.data[index - 1] !== before) return false;
  const data = (after as { nodes?: Record<string, unknown>[] })?.nodes?.find(node => node.id === id);
  const reference = (node: Record<string, unknown>) => JSON.stringify([node.type, node.operonTask, node.text]);
  if (!data) return false;
  const expectedReference = reference(data);
  for (const snapshot of history.data.slice(index)) {
   const node = (snapshot as { nodes?: Record<string, unknown>[] })?.nodes?.find(node => node.id === id);
   if (!node || reference(node) !== expectedReference || node.x !== end.x || node.y !== end.y) break;
   node.x = start.x; node.y = start.y;
  }
  if (JSON.stringify(before) === JSON.stringify(after)) this.voided.add(after);
  return true;
 }
 reserve(): () => void { this.reservations++; let released = false; return () => { if (!released) { released = true; this.reservations--; } }; }
 addHandler(handler: Handler): () => void { this.handlers.unshift(handler); return () => { this.handlers = this.handlers.filter(item => item !== handler); }; }
 /** A native geometry step may be amended only when no source/history owner handles it. */
 isManagedStep(before: unknown, after: unknown): boolean {
  return this.handlers.some(handler => !!handler({ current: after, next: before, direction: 'undo', native: () => {} }));
 }
 /** Source-only steps must survive native JSON deduplication without storing markers in Canvas files. */
 recordSourceChange(travel: (direction: CanvasHistoryDirection) => Promise<boolean>): boolean {
  if (!this.active || !this.supported) return false;
  const canvas = this.canvas;
  canvas.requestPushHistory.run();
  if (!canvas.history.data.length) canvas.pushHistory(canvas.getData());
  const before = canvas.history.data[canvas.history.current];
  const after: unknown = JSON.parse(JSON.stringify(canvas.getData()));
  canvas.history.data.splice(canvas.history.current + 1);
  canvas.history.data.push(after); canvas.history.current = canvas.history.data.length - 1;
  const remove = this.addHandler(step => {
   if (!canvas.history.data.includes(after)) { remove(); return null; }
   const matches = step.direction === 'undo' ? step.current === after && step.next === before : step.current === before && step.next === after;
   if (!matches) return null;
   return async () => {
    const release = this.lockInput(), index = canvas.history.current;
    try {
     if (await travel(step.direction) && this.active && canvas.history.current === index && canvas.history.data[index] === step.current) {
      // Geometry is identical: advance only the history cursor, without reimporting task cards.
      canvas.history.current += step.direction === 'undo' ? -1 : 1;
     }
    } finally { release(); }
   };
  });
  return true;
 }
 /** Couple the completed native move with one guarded source transaction. */
 recordCanvasChange(before: unknown, travel: (direction: CanvasHistoryDirection, allowed: () => boolean) => Promise<boolean>, geometryOnly = false, recordedAfter?: unknown): boolean {
  if (!this.active || !this.supported || (recordedAfter === undefined && this.canvas.history.data[this.canvas.history.current] !== before)) return false;
  const canvas = this.canvas;
  if (recordedAfter === undefined) canvas.pushHistory(canvas.getData());
  const after = recordedAfter ?? canvas.history.data[canvas.history.current];
  if (!canvas.history.data.includes(after)) return false;
  if (geometryOnly) return true;
  let broken = false;
  const remove = this.addHandler(step => {
   if (!canvas.history.data.includes(after)) { remove(); return null; }
   const matches = step.direction === 'undo' ? step.current === after && step.next === before : step.current === before && step.next === after;
   if (!matches) return null;
   return async () => {
    if (broken) { new Notice(t('notifications', 'canvasGroupDropPartial')); return; }
    const release = this.lockInput(), index = canvas.history.current, data = JSON.stringify(canvas.getData());
    const allowed = () => this.active && !canvas.readonly && canvas.history.current === index && canvas.history.data[index] === step.current && JSON.stringify(canvas.getData()) === data;
    try {
     if (!await travel(step.direction, allowed)) return;
     if (!allowed()) { broken = true; new Notice(t('notifications', 'canvasGroupDropPartial')); return; }
     try { step.native(); } catch { broken = true; canvas.history.current = index; new Notice(t('notifications', 'canvasGroupDropPartial')); return; }
     try { await this.view.save(); } catch { new Notice(t('notifications', 'canvasGroupSaveFailed')); }
    } finally { release(); }
   };
  });
  return true;
 }
 lockInput(): () => void {
  const root = this.view.contentEl;
  const stop = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
  const names = ['pointerdown', 'pointermove', 'pointerup', 'keydown', 'beforeinput', 'drop', 'paste'] as const;
  for (const name of names) root.addEventListener(name, stop, true);
  let released = false;
  const release = () => { if (released) return; released = true; for (const name of names) root.removeEventListener(name, stop, true); };
  this.register(release); return release;
 }
 onunload(): void { this.active = this.supported = false; this.handlers = []; this.pendingTasks.clear(); for (const resolve of this.settled) resolve(); this.settled.clear(); this.voided.clear(); }
}
