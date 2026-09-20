import { Component, Notice, getIcon } from 'obsidian';
import { t } from '../core/i18n';
import { conflictingScalarGroups } from '../core/canvas-group-overlap';
import type { CanvasTaskIntegration, CanvasTaskNode, TaskCanvasView } from './canvas-task-adapter';
import type { NativeGroupDrag } from './canvas-group-drop';

const geometry = ['x', 'y', 'width', 'height'] as const;

/** Native drag-with-pan is shared by group movement, node resize and selection resize. */
export class CanvasGroupOverlapGuard extends Component {
 private active = false;
 private cancelGesture: (() => void) | null = null;
 constructor(private view: TaskCanvasView, private owner: CanvasTaskIntegration) { super(); }
 onload(): void {
  const canvas = this.view.canvas;
  const original: unknown = Reflect.get(canvas, 'handleDragWithPan');
  if (typeof original !== 'function') return;
  this.active = true;
  const descriptor = Object.getOwnPropertyDescriptor(canvas, 'handleDragWithPan');
  const protect = (native: NativeGroupDrag): NativeGroupDrag => {
   if (!this.active || canvas.readonly) return native;
   const moving = [...canvas.nodes.values()].filter(node => canvas.selection?.has(node) || node.nodeEl.classList.contains('is-dragging'));
   if (!moving.some(node => node.getData().type === 'group')) return native;
   this.cancelGesture?.();
   const groups = () => [...canvas.nodes.values()].map(node => node.getData()).filter(data => data.type === 'group');
   const before = groups(), file = this.view.file;
   const owned = new Map(moving.map(node => [node, { before: node.getData(), last: node.getData(), changed: new Set<typeof geometry[number]>() }]));
   let finished = false;
   const current = () => this.active && this.view.canvas === canvas && this.view.file === file && this.owner.isCurrent(this.view);
   const restore = () => {
    for (const [node, state] of owned) {
     if (canvas.nodes.get(node.id) !== node) continue;
     const data = node.getData(), next = { ...data };
     for (const key of state.changed) if (data[key] === state.last[key]) next[key] = state.before[key];
     if (geometry.some(key => next[key] !== data[key])) node.setData(next);
    }
   };
   const finish = () => { finished = true; if (this.cancelGesture === cancel) this.cancelGesture = null; };
   const cancel = () => { if (finished) return; finish(); if (current()) native.cancel?.(); };
   this.cancelGesture = cancel;
   const observe = (run: () => void) => {
    if (finished || !current()) return;
    const preceding = new Map<CanvasTaskNode, Record<string, unknown>>(moving.map(node => [node, node.getData()]));
    try { run(); } finally {
     for (const [node, state] of owned) {
      const data = node.getData();
      for (const key of geometry) if (data[key] !== preceding.get(node)?.[key]) { state.changed.add(key); state.last[key] = data[key]; }
     }
    }
   };
   const guarded: NativeGroupDrag = {
    ...native,
    move: e => observe(() => native.move?.(e)),
    keydown: e => observe(() => native.keydown?.(e)),
    keyup: e => observe(() => native.keyup?.(e)),
    end: e => {
     if (finished) return;
     if (!current()) { cancel(); return; }
     const touched = [...owned].some(([node, state]) => node.getData().type === 'group' && state.changed.size);
     const conflict = touched && conflictingScalarGroups(before, groups(), this.owner.deps.cards.deps.getSettings(), { iconExists: name => !!getIcon(name) });
     finish();
     let rejected = !!conflict;
     if (conflict) restore();
     // Native copy-drag creates its real nodes only in end, through importData.
     const importer: unknown = Reflect.get(canvas, 'importData'), importDescriptor = Object.getOwnPropertyDescriptor(canvas, 'importData');
     const guardedImport = (data: unknown, ...args: unknown[]): unknown => {
      const incoming: unknown = data && typeof data === 'object' ? Reflect.get(data, 'nodes') : null;
      if (Array.isArray(incoming)) {
       const existing = groups();
       const ids = new Set(existing.map(node => node.id));
       let serial = 0;
       const candidates = incoming.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object').map(item => {
        let id: string; do { id = 'operon-overlap-copy-' + ++serial; } while (ids.has(id)); ids.add(id);
        return { ...item, id };
       });
       if (conflictingScalarGroups(existing, [...existing, ...candidates], this.owner.deps.cards.deps.getSettings(), { iconExists: name => !!getIcon(name) })) { rejected = true; return []; }
      }
      return Reflect.apply(importer as (...args: unknown[]) => unknown, canvas, [data, ...args]);
     };
     if (typeof importer === 'function') Reflect.set(canvas, 'importData', guardedImport);
     // Native finalization saves the restored geometry, not the rejected layout.
     try { native.end?.(e); } finally {
      if (Reflect.get(canvas, 'importData') === guardedImport) {
       if (importDescriptor) Object.defineProperty(canvas, 'importData', importDescriptor); else Reflect.deleteProperty(canvas, 'importData');
      }
      if (rejected) new Notice(t('notifications', 'canvasGroupOverlap'));
     }
    },
    cancel,
    // Mouse cleanup can precede end in the same event; do not cancel that commit.
    cleanup: () => { native.cleanup?.(); queueMicrotask(() => { if (!finished) cancel(); }); },
   };
   return guarded;
  };
  const wrapper = (event: PointerEvent, native: NativeGroupDrag): unknown => Reflect.apply(original, canvas, [event, protect(native)]);
  Reflect.set(canvas, 'handleDragWithPan', wrapper);
  const nudge: unknown = Reflect.get(canvas, 'nudgeSelection');
  if (typeof nudge === 'function') {
   const nudgeDescriptor = Object.getOwnPropertyDescriptor(canvas, 'nudgeSelection');
   const guardedNudge = (event: KeyboardEvent, direction: string) => {
    const save: unknown = Reflect.get(canvas, 'requestSave');
    if (typeof save !== 'function') return;
    const saveDescriptor = Object.getOwnPropertyDescriptor(canvas, 'requestSave');
    let saveArgs: Parameters<typeof canvas.requestSave> | null = null;
    const defer = (...args: Parameters<typeof canvas.requestSave>) => { saveArgs = args; };
    const gesture = protect({ keydown: () => {
     canvas.requestSave = defer;
     try { Reflect.apply(nudge, canvas, [event, direction]); } finally {
      if (canvas.requestSave === defer) {
       if (saveDescriptor) Object.defineProperty(canvas, 'requestSave', saveDescriptor); else Reflect.deleteProperty(canvas, 'requestSave');
      }
     }
    }, end: () => { if (saveArgs) Reflect.apply(save, canvas, saveArgs); } });
    gesture.keydown?.(event); gesture.end?.(event as unknown as PointerEvent);
   };
   Reflect.set(canvas, 'nudgeSelection', guardedNudge);
   this.register(() => {
    if (Reflect.get(canvas, 'nudgeSelection') !== guardedNudge) return;
    if (nudgeDescriptor) Object.defineProperty(canvas, 'nudgeSelection', nudgeDescriptor); else Reflect.deleteProperty(canvas, 'nudgeSelection');
   });
  }
  this.register(() => {
   if (Reflect.get(canvas, 'handleDragWithPan') !== wrapper) return;
   if (descriptor) Object.defineProperty(canvas, 'handleDragWithPan', descriptor); else Reflect.deleteProperty(canvas, 'handleDragWithPan');
  });
 }
 onunload(): void { this.cancelGesture?.(); this.active = false; }
}
