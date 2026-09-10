import { readCanvasTaskReference } from '../ui/canvas-task-node';
import { readCanvasTaskId } from '../ui/task-card-canvas';
import type { CanvasTaskNode } from '../ui/canvas-task-adapter';

export function canvasRelationTaskId(node: CanvasTaskNode): string | null {
 const data = node.getData();
 if ('operonTask' in data) return readCanvasTaskReference(data)?.taskId ?? null;
 return data.type === 'text' && typeof data.text === 'string' ? readCanvasTaskId(data.text) : null;
}
