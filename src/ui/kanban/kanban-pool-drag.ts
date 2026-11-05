import type { IndexedTask } from '../../types/fields';
import type { KanbanPoolDropRequest } from '../../types/kanban';
import type { TaskPoolPoint, TaskPoolTarget } from '../surface-task-pool';
import { beginLongPressTouchGesture, isTouchLikePointer, scrollTouchSurface } from '../touch-drag-session';

export interface KanbanPoolTarget extends TaskPoolTarget, KanbanPoolDropRequest {}
export interface KanbanPoolDragHost {
 isCurrent(): boolean;
 finish(): void;
 begin(): boolean | void;
 end(): void;
 update(point: TaskPoolPoint): void;
 target(point: TaskPoolPoint, notify: boolean, previewAnchor?: HTMLElement): KanbanPoolTarget | null;
 place(target: KanbanPoolTarget): Promise<void>;
}

/** A pointer gesture only. Target validation and persistence belong to the owning board. */
export function startKanbanPoolDrag(event: PointerEvent, task: IndexedTask, row: HTMLElement, host: KanbanPoolDragHost): () => void {
 const doc = row.ownerDocument, win = doc.defaultView!;
 const touch = isTouchLikePointer(event);
 let point = { x: event.clientX, y: event.clientY };
 let active = false, finished = false, committing = false;
 let frame: number | null = null, ghost: HTMLElement | null = null;
 let pending: (() => void) | null = null;
 let releasedHit: Element | null = null, tapped = false;
 const suppress = (next: Event) => {
  const target = next.target as Node | null;
  if (!(active || tapped) || !target || !(row.contains(target) || target === releasedHit || releasedHit?.contains(target))) return;
  next.preventDefault(); next.stopImmediatePropagation();
  if (next.type === 'click') clearSuppression();
 };
 let suppressionTimer: number | null = null;
 const clearSuppression = () => {
  doc.removeEventListener('click', suppress, true); doc.removeEventListener('contextmenu', suppress, true); doc.removeEventListener('pointerdown', clearSuppression, true);
  if (suppressionTimer !== null) win.clearTimeout(suppressionTimer);
  suppressionTimer = null;
 };
 const suppressClick = () => {
  doc.addEventListener('click', suppress, true); doc.addEventListener('contextmenu', suppress, true);
  doc.addEventListener('pointerdown', clearSuppression, true);
  suppressionTimer = win.setTimeout(clearSuppression, 400);
 };
 const release = () => {
  pending?.(); pending = null;
  if (frame !== null) win.cancelAnimationFrame(frame); frame = null;
  ghost?.remove(); ghost = null;
  win.removeEventListener('pointermove', move, true); win.removeEventListener('pointerup', up, true);
  win.removeEventListener('pointercancel', cancel, true); win.removeEventListener('pointerdown', additional, true);
  win.removeEventListener('blur', cancel, true); doc.removeEventListener('visibilitychange', visibility, true);
  doc.removeEventListener('keydown', key, true); doc.removeEventListener('contextmenu', suppress, true);
  host.finish();
 };
 const cancel = () => {
  if (finished) return;
  finished = true; release();
  if (active) { suppressClick(); host.end(); }
 };
 const tick = () => {
  frame = null;
  if (finished || !host.isCurrent()) { cancel(); return; }
  host.update(point);
  if (ghost) { ghost.style.left = `${point.x + 12}px`; ghost.style.top = `${point.y + 12}px`; }
  host.target(point, false, ghost ?? undefined);
  frame = win.requestAnimationFrame(tick);
 };
 const activate = () => {
  if (finished || !row.isConnected || !host.isCurrent()) { cancel(); return; }
  if (host.begin() === false) { cancel(); return; }
  active = true; row.dataset.dragged = 'true';
  ghost = doc.body.createDiv({ cls: 'operon-canvas-task-pool-drag', text: task.description || task.operonId });
  tick();
 };
 const move = (next: PointerEvent) => {
  if (next.pointerId !== event.pointerId || finished) return;
  if (!touch && !(next.buttons & 1)) { cancel(); return; }
  next.preventDefault(); next.stopPropagation(); point = { x: next.clientX, y: next.clientY };
  if (!active && Math.hypot(point.x - event.clientX, point.y - event.clientY) >= 5) activate();
 };
 const up = (next: PointerEvent) => {
  if (next.pointerId !== event.pointerId || finished) return;
  point = { x: next.clientX, y: next.clientY };
  releasedHit = doc.elementFromPoint(next.clientX, next.clientY);
  const target = active && host.isCurrent() ? host.target(point, true, ghost ?? undefined) : null;
  if (!target) { cancel(); return; }
  next.preventDefault(); next.stopPropagation(); finished = true; committing = true; release(); suppressClick();
  // No automatic retry: the owner observes an already-started write to completion.
  void host.place(target).finally(() => { committing = false; host.end(); });
 };
 const additional = (next: PointerEvent) => { if (next.pointerId !== event.pointerId) cancel(); };
 const visibility = () => { if (doc.visibilityState !== 'visible') cancel(); };
 const key = (next: KeyboardEvent) => { if (next.key === 'Escape') { next.preventDefault(); next.stopImmediatePropagation(); cancel(); } };
 const listen = () => {
  win.addEventListener('pointermove', move, { capture: true, passive: false }); win.addEventListener('pointerup', up, true);
  win.addEventListener('pointercancel', cancel, true); win.addEventListener('pointerdown', additional, true);
  win.addEventListener('blur', cancel, true); doc.addEventListener('visibilitychange', visibility, true);
  doc.addEventListener('contextmenu', suppress, true);
 };
 if (!host.isCurrent()) { host.finish(); return () => {}; }
 doc.addEventListener('keydown', key, true);
 if (touch) {
  pending = beginLongPressTouchGesture({ target: row, event, longPressMs: 260, cancelDistancePx: 10,
   onFinish: () => queueMicrotask(() => { if (!active && !finished) cancel(); }),
   onScroll: (_x, y) => scrollTouchSurface(row, '.operon-canvas-task-pool-list', y),
   onTap: tap => {
    if (!finished && host.isCurrent()) {
     // The pool owns title activation, including modifier semantics.
     const title = (event.target as Element).closest<HTMLElement>('.operon-canvas-task-pool-title');
     title?.dispatchEvent(new win.MouseEvent('click', { bubbles: true, ctrlKey: tap.ctrlKey, metaKey: tap.metaKey }));
     tapped = true; cancel(); suppressClick();
    }
    cancel();
   },
   onActivate: (_id, x, y) => { pending = null; point = { x, y }; listen(); activate(); },
  });
 } else { event.preventDefault(); event.stopPropagation(); listen(); }
 return () => { cancel(); if (!committing) clearSuppression(); };
}
