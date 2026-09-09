import { getOwnerWindow } from '../core/dom-compat';
import type { CanvasTaskNode } from './canvas-task-adapter';

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
 if (!Number.isFinite(height) || data.height === height) return false;
 node.setData({ ...data, height });
 return true;
}
