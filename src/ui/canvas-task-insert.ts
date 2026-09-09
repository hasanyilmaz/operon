import { canvasTaskData } from './canvas-task-node';
import type { CanvasTaskTarget } from './canvas-task-adapter';

export class CanvasTaskSaveError extends Error {}

/** Complete the binding before entering native history or scheduling any save. */
export async function insertCanvasTask(target: CanvasTaskTarget, taskId: string, width: number): Promise<void> {
	const { view, canvas, file, path, point } = target;
	if (!target.isCurrent() || view.canvas !== canvas || view.file !== file || file.path !== path || canvas.readonly || view.saving || view.lastSavedData === null) throw new Error('Canvas target unavailable');
	if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('Invalid Canvas position');
	const binding = canvasTaskData(taskId);
	const minimum = canvas.config.minContainerDimension;
	if (!Number.isFinite(minimum) || minimum <= 0 || !Number.isFinite(width) || width <= 0) throw new Error('Unsupported Canvas dimensions');
	canvas.requestPushHistory.run();
	// Empty native canvases may have no initial history entry. Never duplicate an existing one.
	if (canvas.history.data.length === 0) canvas.pushHistory(canvas.getData());
	const node = canvas.createTextNode({ pos: point, size: { width: Math.max(minimum, width), height: Math.max(minimum, 400) }, text: binding.text, save: false, focus: false });
	try {
		node.setData({ ...node.getData(), ...binding });
	} catch (error) {
		// Construction has not entered history or the save queue yet.
		if (canvas.nodes.get(node.id) === node) canvas.removeNode(node);
		throw error;
	}
	target.fitNode?.(node);
	canvas.requestSave(false);
	const after = canvas.getData();
	canvas.pushHistory(after);
	canvas.selectOnly(node);
	// A failed disk save retains the complete, undoable node, like native Canvas edits.
	// Never roll back another user's edits or retry insertion after an uncertain save.
	try { await view.save(); }
	catch { throw new CanvasTaskSaveError('Canvas save failed'); }
	target.finishNodeSize?.(node, after);
}
