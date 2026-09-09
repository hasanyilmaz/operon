import type { CanvasTaskNode, TaskCanvas } from './canvas-task-adapter';

export type CanvasSide = 'top' | 'bottom' | 'left' | 'right';
export interface CanvasDropConnection { source: CanvasTaskNode; fromSide: CanvasSide; toSide: CanvasSide; previewId: string }
const opposite: Record<CanvasSide, CanvasSide> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
export function captureCanvasDropConnection(canvas: TaskCanvas, source: CanvasTaskNode, value: unknown): CanvasDropConnection | null {
 if (!value || typeof value !== 'object') return null;
 const edge = value as { id?: unknown; from?: { node?: unknown; side?: unknown }; to?: { node?: { id?: string } } };
 const side = edge.from?.side;
 if (typeof edge.id !== 'string' || edge.from?.node !== source || typeof side !== 'string' || !Object.prototype.hasOwnProperty.call(opposite, side)
  || !edge.to?.node || (edge.to.node.id && canvas.nodes.has(edge.to.node.id))) return null;
 const connection = { source, fromSide: side as CanvasSide, toSide: opposite[side as CanvasSide], previewId: edge.id };
 return isCanvasDropConnectionCurrent(canvas, connection) ? connection : null;
}
export function isCanvasDropConnectionCurrent(canvas: TaskCanvas, connection: CanvasDropConnection): boolean {
 return canvas.nodes.get(connection.source.id) === connection.source && canvas.edges instanceof Map
  && typeof canvas.importData === 'function' && typeof canvas.removeEdge === 'function';
}
/** A fresh edge ID avoids native delayed cleanup of the temporary dropped arrow. */
export function attachCanvasDropConnection(canvas: TaskCanvas, connection: CanvasDropConnection, node: CanvasTaskNode): void {
 if (!isCanvasDropConnectionCurrent(canvas, connection)) throw new Error('Canvas connection source unavailable');
 const id = crypto.randomUUID();
 if (canvas.edges!.has(id)) throw new Error('Canvas edge ID conflict');
 canvas.importData!({ nodes: [], edges: [{ id, fromNode: connection.source.id, fromSide: connection.fromSide,
  fromEnd: 'none', toNode: node.id, toSide: connection.toSide, toEnd: 'arrow' }] }, false);
 if (!canvas.edges!.has(id)) throw new Error('Canvas connection was not created');
}
