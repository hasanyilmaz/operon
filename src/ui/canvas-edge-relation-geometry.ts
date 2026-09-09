import type { CanvasPoint, CanvasTaskNode } from './canvas-task-adapter';

export function canvasRelationAnchor(node: CanvasTaskNode, side: string | undefined): CanvasPoint | null {
 const { x, y, width, height } = node.getData();
 if (![x, y, width, height].every(value => typeof value === 'number' && Number.isFinite(value)) || Number(width) <= 0 || Number(height) <= 0) return null;
 if (!side || !['left', 'right', 'top', 'bottom'].includes(side)) return null;
 return { x: Number(x) + (side === 'left' ? 0 : side === 'right' ? Number(width) : Number(width) / 2),
  y: Number(y) + (side === 'top' ? 0 : side === 'bottom' ? Number(height) : Number(height) / 2) };
}

/** Extend the native visible stroke to its actual card anchors before measuring twenty percent. */
export function canvasRelationPoint(length: number, pointAt: (distance: number) => CanvasPoint, from: CanvasPoint, to: CanvasPoint, atSource: boolean, labelDistance?: number): CanvasPoint {
 const first = pointAt(0), last = pointAt(length);
 const startGap = Math.hypot(first.x - from.x, first.y - from.y), endGap = Math.hypot(to.x - last.x, to.y - last.y);
 const total = startGap + length + endGap;
 const center = labelDistance === undefined ? total / 2 : startGap + Math.max(0, Math.min(length, labelDistance));
 const distance = atSource ? center * .2 : total - (total - center) * .2;
 const interpolate = (a: CanvasPoint, b: CanvasPoint, ratio: number) => ({ x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio });
 if (distance < startGap) return interpolate(from, first, distance / startGap);
 if (distance > startGap + length) return interpolate(last, to, (distance - startGap - length) / endGap);
 return pointAt(Math.max(0, Math.min(length, distance - startGap)));
}
