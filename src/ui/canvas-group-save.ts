import type { CanvasTaskNode, CanvasTaskTarget, TaskCanvas } from './canvas-task-adapter';
import { CanvasTaskSaveError } from './canvas-task-insert';

export interface CanvasGroupNode extends CanvasTaskNode {
 labelEl?: HTMLElement;
 focusLabel(): void;
 setLabel(label: string): void;
}
export interface GroupCanvas extends TaskCanvas {
 config: TaskCanvas['config'] & { defaultFileNodeDimensions: { width: number; height: number } };
 createGroupNode(options: { pos: { x: number; y: number }; size: { width: number; height: number }; label: string; save: false; focus: false }): CanvasGroupNode;
}
export function asGroupCanvas(canvas: TaskCanvas): GroupCanvas | null {
 const group = canvas as GroupCanvas, size = group.config.defaultFileNodeDimensions;
 return typeof group.createGroupNode === 'function' && typeof group.posFromClient === 'function' && group.canvasEl
  && size && [size.width, size.height].every(value => Number.isFinite(value) && value > 0) ? group : null;
}
export function asGroupNode(node: CanvasTaskNode): CanvasGroupNode | null {
 const group = node as CanvasGroupNode;
 return node.getData().type === 'group' && typeof group.focusLabel === 'function' && typeof group.setLabel === 'function' ? group : null;
}

/** Commit against the current node; never restore an entire Canvas snapshot over later edits. */
export async function saveCanvasGroup(target: CanvasTaskTarget, title: string, existing?: { node: CanvasGroupNode; label: string }): Promise<void> {
 const { canvas, view } = target;
 const group = asGroupCanvas(canvas);
 const current = () => target.isCurrent() && view.canvas === canvas && view.file === target.file && target.file.path === target.path
  && !canvas.readonly && !view.saving && view.lastSavedData !== null;
 if (!group || !current() || ![target.point.x, target.point.y].every(Number.isFinite)) throw new Error('Canvas group unavailable');
 const matches = () => !existing || (canvas.nodes.get(existing.node.id) === existing.node && existing.node.getData().type === 'group'
  && (existing.node.getData().label ?? '') === existing.label);
 if (!matches()) throw new Error('Canvas group changed');
 if (existing && existing.label === title) return;
 canvas.requestPushHistory.run();
 if (!current() || !matches()) throw new Error('Canvas group changed');
 if (!canvas.history.data.length) canvas.pushHistory(canvas.getData());
 if (existing) existing.node.setLabel(title);
 else {
  const node = group.createGroupNode({ pos: target.point, size: { ...group.config.defaultFileNodeDimensions }, label: title, save: false, focus: false });
  if (!asGroupNode(node)) {
   if (canvas.nodes.get(node.id) === node) canvas.removeNode(node);
   throw new Error('Unsupported Canvas group');
  }
  canvas.selectOnly(node);
 }
 canvas.requestSave(false);
 canvas.pushHistory(canvas.getData());
 try { await view.save(); } catch { throw new CanvasTaskSaveError('Canvas group save failed'); }
}
