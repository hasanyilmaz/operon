import type { CanvasTaskNode } from './canvas-task-adapter';

/** Measure unscaled layout pixels, including the card's own bottom padding. */
export function fitCanvasTaskHeight(node: CanvasTaskNode, root: HTMLElement, minimum: number): boolean {
 const content = node.contentEl;
 const card = root.querySelector<HTMLElement>('.operon-task-card');
 if (!content || !card || !root.isConnected || root.dataset.taskCardState !== 'ready' || !Number.isFinite(minimum) || minimum <= 0) return false;
 const measuringClass = 'operon-canvas-height-measuring';
 const alreadyMeasuring = content.classList.contains(measuringClass);
 let height: number;
 try {
  // Measure at the full existing width, not at a width narrowed by the old scrollbar.
  content.classList.add(measuringClass);
  if (card.offsetHeight <= 0 || content.clientHeight <= 0 || node.nodeEl.offsetHeight <= 0) return false;
  const frame = Math.max(0, node.nodeEl.offsetHeight - content.clientHeight);
  height = Math.max(minimum, Math.ceil(Math.max(card.offsetHeight, card.scrollHeight) + frame) + 1);
 } finally {
  if (!alreadyMeasuring) content.classList.remove(measuringClass);
 }
 const data = node.getData();
 if (!Number.isFinite(height) || data.height === height) return false;
 node.setData({ ...data, height });
 return true;
}

/** Finish only this initial fit when the cover loads; never become a live autoresizer. */
export function finishCanvasTaskHeight(
 node: CanvasTaskNode, root: HTMLElement, minimum: number, allowed: () => boolean, resized: () => void,
): () => void {
 const image = root.querySelector<HTMLImageElement>('.operon-task-card-image > img');
 let active = true;
 const cleanup = () => {
  active = false;
  image?.removeEventListener('load', finish);
  image?.removeEventListener('error', finish);
 };
 const finish = () => {
  if (!active) return;
  cleanup();
  if (image && !image.isConnected || !allowed()) return;
  if (fitCanvasTaskHeight(node, root, minimum)) resized();
 };
 if (!image || image.complete) finish();
 else {
  image.addEventListener('load', finish, { once: true });
  image.addEventListener('error', finish, { once: true });
 }
 return cleanup;
}
