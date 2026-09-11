import { getOwnerWindow } from '../core/dom-compat';
import type { CanvasSide } from './canvas-task-drop-connection';
import type { CanvasTaskNode } from './canvas-task-adapter';

const dropAnchors = new WeakMap<CanvasTaskNode, { x: number; y: number; side: CanvasSide; initialX: unknown; initialY: unknown }>();
export function anchorCanvasTaskAtDrop(node: CanvasTaskNode, point: { x: number; y: number }, side: CanvasSide): void {
 const data = node.getData(); dropAnchors.set(node, { ...point, side, initialX: data.x, initialY: data.y });
}

/** Measure intrinsic content, never the empty space left inside the previous node size. */
export function fitCanvasTaskHeight(node: CanvasTaskNode, root: HTMLElement, minimum: number): boolean {
 const card = root.querySelector<HTMLElement>('.operon-task-card');
 const container = node.nodeEl.querySelector<HTMLElement>('.canvas-node-container');
 if (!card || !container || !root.isConnected || root.dataset.taskCardState !== 'ready'
  || card.offsetWidth <= 0 || card.offsetHeight <= 0 || !Number.isFinite(minimum) || minimum <= 0) return false;
 const style = getOwnerWindow(container).getComputedStyle(container);
 const frame = ['borderTopWidth', 'borderBottomWidth', 'paddingTop', 'paddingBottom'] as const;
 const inset = frame.reduce((total, key) => total + (Number.parseFloat(style[key]) || 0), 0);
 const height = Math.max(minimum, Math.ceil(Math.max(card.offsetHeight, card.scrollHeight) + inset) + 1);
 const data = node.getData();
 if (!Number.isFinite(height)) return false;
 const anchor = dropAnchors.get(node);
 const next: Record<string, unknown> = { ...data, height };
 if (anchor) {
  dropAnchors.delete(node);
  // A user move before the first render wins over the initial drop anchor.
  if (data.x === anchor.initialX && data.y === anchor.initialY && typeof data.width === 'number') {
   next.x = anchor.x - (anchor.side === 'left' ? 0 : anchor.side === 'right' ? data.width : data.width / 2);
   next.y = anchor.y - (anchor.side === 'top' ? 0 : anchor.side === 'bottom' ? height : height / 2);
  }
 }
 if (data.height === height && data.x === next.x && data.y === next.y) return false;
 node.setData(next);
 return true;
}
