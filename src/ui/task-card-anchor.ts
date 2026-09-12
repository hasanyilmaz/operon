import { getOwnerWindow } from '../core/dom-compat';

/** Track native Canvas transforms without reading or writing the Canvas data model. */
export function observeTaskCardAnchor(anchor: HTMLElement, changed: () => void): () => void {
 const canvas = anchor.closest<HTMLElement>('.canvas-wrapper, .canvas');
 if (!canvas) return () => undefined;
 const win = getOwnerWindow(anchor) as Window & { MutationObserver: typeof MutationObserver; ResizeObserver: typeof ResizeObserver };
 let frame = 0;
 const schedule = (): void => { if (!frame) frame = win.requestAnimationFrame(() => { frame = 0; changed(); }); };
 const observer = new win.MutationObserver(schedule);
 observer.observe(canvas, { attributes: true, attributeFilter: ['style', 'class'], childList: true, subtree: true });
 const resize = new win.ResizeObserver(schedule); resize.observe(anchor);
 return () => { observer.disconnect(); resize.disconnect(); if (frame) win.cancelAnimationFrame(frame); frame = 0; };
}
