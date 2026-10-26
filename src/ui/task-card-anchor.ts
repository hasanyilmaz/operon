import { getOwnerWindow } from '../core/dom-compat';

/** Track native board transforms without reading or writing their data models. */
export function observeTaskCardAnchor(anchor: HTMLElement, changed: () => void): () => void {
 const canvas = anchor.closest<HTMLElement>('.canvas-wrapper, .canvas, .excalidraw');
 if (!canvas) return () => undefined;
 let win = getOwnerWindow(anchor) as Window & { MutationObserver: typeof MutationObserver; ResizeObserver: typeof ResizeObserver };
 let frame = 0, closed = false;
 let observer: MutationObserver, resize: ResizeObserver;
 const schedule = (): void => { if (!closed && !frame) frame = win.requestAnimationFrame(() => { frame = 0; if (!closed) changed(); }); };
 const bind = (): void => {
  observer = new win.MutationObserver(schedule);
  observer.observe(canvas, { attributes: true, attributeFilter: ['style', 'class'], childList: true, subtree: true });
  resize = new win.ResizeObserver(schedule); resize.observe(anchor);
 };
 bind();
 const stopMigration = anchor.onWindowMigrated?.(() => {
  const next = getOwnerWindow(anchor) as typeof win;
  if (closed || next === win) return;
  const pending = !!frame;
  observer.disconnect(); resize.disconnect();
  if (frame) win.cancelAnimationFrame(frame);
  frame = 0; win = next; bind();
  if (pending) schedule();
 });
 return () => { if (closed) return; closed = true; stopMigration?.(); observer.disconnect(); resize.disconnect(); if (frame) win.cancelAnimationFrame(frame); frame = 0; };
}
