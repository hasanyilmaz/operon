import type { CanvasPoint, CanvasTaskNode } from './canvas-task-adapter';

export function canvasRelationAnchor(node: CanvasTaskNode, side: string | undefined): CanvasPoint | null {
 const { x, y, width, height } = node.getData();
 if (![x, y, width, height].every(value => typeof value === 'number' && Number.isFinite(value)) || Number(width) <= 0 || Number(height) <= 0) return null;
 if (!side || !['left', 'right', 'top', 'bottom'].includes(side)) return null;
 return { x: Number(x) + (side === 'left' ? 0 : side === 'right' ? Number(width) : Number(width) / 2),
  y: Number(y) + (side === 'top' ? 0 : side === 'bottom' ? Number(height) : Number(height) / 2) };
}

/** Slots are fractions of the full card-to-card route, independent of its label. */
export function canvasRelationSlot(atSource: boolean, paired: boolean, index: number): number {
 if (!paired) return atSource ? .25 : .75;
 return atSource ? (index === 0 ? .35 : .2) : (index === 0 ? .65 : .8);
}

/** Include native arrowhead gaps when measuring the complete card-to-card route. */
export function canvasRelationPoint(length: number, pointAt: (distance: number) => CanvasPoint, from: CanvasPoint, to: CanvasPoint, fraction: number): CanvasPoint {
 const first = pointAt(0), last = pointAt(length);
 const startGap = Math.hypot(first.x - from.x, first.y - from.y), endGap = Math.hypot(to.x - last.x, to.y - last.y);
 const total = startGap + length + endGap;
 const distance = total * Math.max(0, Math.min(1, fraction));
 const interpolate = (a: CanvasPoint, b: CanvasPoint, ratio: number) => ({ x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio });
 if (distance < startGap) return interpolate(from, first, distance / startGap);
 if (distance > startGap + length) return interpolate(last, to, (distance - startGap - length) / endGap);
 return pointAt(Math.max(0, Math.min(length, distance - startGap)));
}
