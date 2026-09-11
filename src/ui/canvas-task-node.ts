import { isValidOperonId } from '../core/id-generator';

export interface CanvasTaskReference { version: 1; taskId: string }

/** Metadata is authoritative; fallback text never resolves a task. */
export function readCanvasTaskReference(data: unknown): CanvasTaskReference | null {
	if (!data || typeof data !== 'object') return null;
	const node = data as Record<string, unknown>;
	if (node.type !== 'text' || !node.operonTask || typeof node.operonTask !== 'object') return null;
	const reference = node.operonTask as Record<string, unknown>;
	return reference.version === 1 && typeof reference.taskId === 'string' && isValidOperonId(reference.taskId)
		? { version: 1, taskId: reference.taskId } : null;
}

export function canvasTaskData(taskId: string): { text: string; operonTask: CanvasTaskReference } {
	if (!isValidOperonId(taskId)) throw new Error('Invalid Operon task ID');
	return { text: `Operon task: ${taskId}`, operonTask: { version: 1, taskId } };
}
