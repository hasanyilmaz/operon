/** Pointer-owned gesture: only the dedicated handle disables browser panning. */
export function startRelationsGesture(event: PointerEvent, handle: HTMLElement, move: (point: { x: number; y: number }) => void, end: (point: { x: number; y: number }) => void, done: () => void): () => void {
 if (event.button !== 0 || event.isPrimary === false) return () => {};
 event.preventDefault(); event.stopPropagation();
 const doc = handle.ownerDocument, win = doc.defaultView!;
 let active = true, moved = false;
 const cancel = () => {
  if (!active) return; active = false;
  doc.removeEventListener('pointermove', onMove, true); doc.removeEventListener('pointerup', onUp, true);
  doc.removeEventListener('pointercancel', onCancel, true); doc.removeEventListener('pointerdown', additional, true);
  doc.removeEventListener('keydown', key, true); win.removeEventListener('blur', cancel);
  handle.removeEventListener('lostpointercapture', cancel);
  if (handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  done();
 };
 const onMove = (next: PointerEvent) => {
  if (next.pointerId !== event.pointerId) return;
  next.preventDefault(); next.stopPropagation();
  if (!moved && Math.hypot(next.clientX - event.clientX, next.clientY - event.clientY) < 6) return;
  moved = true; move({ x: next.clientX, y: next.clientY });
 };
 const onUp = (next: PointerEvent) => {
  if (next.pointerId !== event.pointerId) return;
  next.preventDefault(); next.stopPropagation();
  const commit = moved; cancel(); if (commit) end({ x: next.clientX, y: next.clientY });
 };
 const onCancel = (next: PointerEvent) => { if (next.pointerId === event.pointerId) cancel(); };
 const additional = (next: PointerEvent) => { if (next.pointerId !== event.pointerId) { next.preventDefault(); next.stopImmediatePropagation(); cancel(); } };
 const key = (next: KeyboardEvent) => { if (next.key === 'Escape') { next.preventDefault(); next.stopPropagation(); cancel(); } };
 doc.addEventListener('pointermove', onMove, { capture: true, passive: false }); doc.addEventListener('pointerup', onUp, true);
 doc.addEventListener('pointercancel', onCancel, true); doc.addEventListener('pointerdown', additional, true); doc.addEventListener('keydown', key, true);
 win.addEventListener('blur', cancel); handle.addEventListener('lostpointercapture', cancel);
 try { handle.setPointerCapture?.(event.pointerId); } catch { /* Document listeners also cover hosts without pointer capture. */ }
 return cancel;
}
