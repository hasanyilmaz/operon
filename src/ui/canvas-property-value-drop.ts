import { canvasRelationTaskId } from '../systems/canvas-task-relations';
import type { PropertyPoolTaskBridge } from '../core/property-pool-task-operation';
import type { TaskCanvasView } from './canvas-task-adapter';
import type { CanvasTaskHistory } from './canvas-task-history';
import { SurfacePropertyValueDrop, type PrepareGroup } from './surface-property-value-drop';

export class CanvasPropertyValueDrop extends SurfacePropertyValueDrop {
 constructor(view: TaskCanvasView, history: CanvasTaskHistory, bridge: PropertyPoolTaskBridge, isCurrent: () => boolean, prepareGroup?: PrepareGroup) {
  super({ contentEl: view.contentEl, file: () => view.file, identity: () => view.canvas, isCurrent,
   readOnly: () => view.canvas.readonly, supported: () => history.supported, busy: () => history.isInputBusy,
   targetAt: (x, y) => {
    const hit = view.contentEl.ownerDocument.elementFromPoint(x, y);
    if (!hit || !view.contentEl.contains(hit)) return null;
    for (const node of view.canvas.nodes.values()) {
     const taskId = canvasRelationTaskId(node);
     if (node.getData().type === 'text' && node.nodeEl.contains(hit) && taskId) return {
      id: node.id, taskId, nodeEl: node.nodeEl,
      current: () => view.canvas.nodes.get(node.id) === node && canvasRelationTaskId(node) === taskId,
     };
    }
    return null;
   },
   groups: prepareGroup ? { canvas: () => view.canvas, prepare: prepareGroup } : undefined,
   apply: async (plan, allowed, notice) => {
    if (history.isInputBusy || history.isTaskPending(plan.id)) return { status: 'blocked' };
    const file = view.file, path = file?.path;
    const release = history.reserve(), unlock = history.lockInput();
    try {
     const result = await bridge.apply(plan, 'drop', allowed);
     if (result.status === 'committed') {
      const recorded = history.recordSourceChange(async direction => {
       const valid = () => isCurrent() && !view.canvas.readonly && history.supported && view.file === file && file?.path === path;
       const outcome = await bridge.apply(plan, direction, valid); notice(outcome); return outcome.status === 'committed';
      });
      if (!recorded) result.warning = true;
     }
     return result;
    } finally { unlock(); release(); }
   },
  }, bridge);
 }
}
