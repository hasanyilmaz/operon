import type { ExcalidrawTaskElement, ExcalidrawTaskView } from './excalidraw-task-bridge';
import { relationArrowGeometryKey, relationArrowPoint, type RelationArrow, type RelationPoint } from './excalidraw-edge-relation-geometry';

export interface ExcalidrawDropConnection {
 arrowId: string; sourceId: string; taskId: string; signature: string; point: RelationPoint; side: 'left' | 'right' | 'top' | 'bottom';
}
const signature = (arrow: RelationArrow) => JSON.stringify([relationArrowGeometryKey(arrow), arrow.startBinding, arrow.endBinding]);
export function captureExcalidrawDropConnection(arrow: RelationArrow, source: ExcalidrawTaskElement, taskId: string): ExcalidrawDropConnection | null {
 if (arrow.type !== 'arrow' || arrow.isDeleted || arrow.locked || source.isDeleted || source.locked || arrow.startBinding?.elementId !== source.id || arrow.endBinding) return null;
 const point = relationArrowPoint(arrow, 1), before = relationArrowPoint(arrow, .99);
 if (!point || !before || Math.hypot(point.x - before.x, point.y - before.y) < .001) return null;
 const dx = point.x - before.x, dy = point.y - before.y;
 return { arrowId: arrow.id, sourceId: source.id, taskId, signature: signature(arrow), point,
  side: Math.abs(dx) > Math.abs(dy) ? dx > 0 ? 'left' : 'right' : dy > 0 ? 'top' : 'bottom' };
}
export function currentExcalidrawDropArrow(view: ExcalidrawTaskView, connection: ExcalidrawDropConnection): RelationArrow | null {
 const elements = view.excalidrawAPI.getSceneElements();
 const arrow: RelationArrow | undefined = elements.find(value => value.id === connection.arrowId);
 const source = elements.find(value => value.id === connection.sourceId);
 return arrow && source && !arrow.isDeleted && !arrow.locked && !source.isDeleted && !source.locked && signature(arrow) === connection.signature && isExcalidrawDropPointEmpty(elements, connection) ? arrow : null;
}
export function excalidrawDropCardPosition(connection: ExcalidrawDropConnection, width: number, height: number): RelationPoint {
 return { x: connection.point.x - (connection.side === 'left' ? 0 : connection.side === 'right' ? width : width / 2),
  y: connection.point.y - (connection.side === 'top' ? 0 : connection.side === 'bottom' ? height : height / 2) };
}
const anchors = new WeakMap<ExcalidrawTaskView, Map<string, { connection: ExcalidrawDropConnection; x: number; y: number; width: number }>>();
export function rememberExcalidrawDropAnchor(view: ExcalidrawTaskView, element: ExcalidrawTaskElement, connection: ExcalidrawDropConnection): void {
 let entries = anchors.get(view); if (!entries) { entries = new Map(); anchors.set(view, entries); }
 entries.set(element.id, { connection, x: element.x!, y: element.y!, width: element.width! });
}
export function consumeExcalidrawDropHeight(view: ExcalidrawTaskView, element: ExcalidrawTaskElement, height: number): RelationPoint | null {
 const entries = anchors.get(view), anchor = entries?.get(element.id); if (!anchor) return null;
 entries!.delete(element.id);
 return anchor.x === element.x && anchor.y === element.y && anchor.width === element.width && !element.angle
  ? excalidrawDropCardPosition(anchor.connection, anchor.width, height) : null;
}

/** Frames are containers; other visible elements make this an occupied drop target. */
export function isExcalidrawDropPointEmpty(elements: readonly ExcalidrawTaskElement[], connection: ExcalidrawDropConnection): boolean {
 return !elements.some(element => {
  if (element.id === connection.arrowId || element.isDeleted || element.type === 'frame' || element.type === 'magicframe' || element.containerId === connection.arrowId) return false;
  const { x, y, width, height } = element, angle = element.angle ?? 0;
  if (![x, y, width, height, angle].every(value => typeof value === 'number' && Number.isFinite(value))) return false;
  const dx = connection.point.x - (x! + width! / 2), dy = connection.point.y - (y! + height! / 2);
  const px = dx * Math.cos(angle) + dy * Math.sin(angle) + width! / 2;
  const py = -dx * Math.sin(angle) + dy * Math.cos(angle) + height! / 2;
  if (['arrow', 'line', 'freedraw'].includes(element.type)) {
   const points = (element as RelationArrow).points;
   return points?.slice(1).some((b, i) => {
    const a = points[i], vx = b[0] - a[0], vy = b[1] - a[1], length = vx * vx + vy * vy;
    const ratio = length ? Math.max(0, Math.min(1, ((px - a[0]) * vx + (py - a[1]) * vy) / length)) : 0;
    return Math.hypot(px - a[0] - ratio * vx, py - a[1] - ratio * vy) <= 4;
   }) ?? false;
  }
  if (width! <= 0 || height! <= 0 || px < 0 || py < 0 || px > width! || py > height!) return false;
  if (element.type === 'ellipse') return ((px - width! / 2) / (width! / 2)) ** 2 + ((py - height! / 2) / (height! / 2)) ** 2 <= 1;
  if (element.type === 'diamond') return Math.abs((px - width! / 2) / (width! / 2)) + Math.abs((py - height! / 2) / (height! / 2)) <= 1;
  return true;
 });
}
