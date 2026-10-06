import type { CanvasTaskIntegration, CanvasTaskTarget, TaskCanvasView } from './canvas-task-adapter';
import { SurfaceTaskPool } from './surface-task-pool';
import { t } from '../core/i18n';

/** Canvas keeps its existing native control placement and insertion path. */
export class CanvasTaskPool extends SurfaceTaskPool<CanvasTaskTarget> {
 private group: HTMLElement | null = null;
 constructor(private view: TaskCanvasView, owner: CanvasTaskIntegration) {
  super({ app: owner.deps.app, cards: owner.deps.cards, contentEl: view.contentEl,
   title: () => t('settings', 'canvasTaskPool'), addLabel: () => t('commands', 'addTaskToCanvas'),
   unavailable: () => t('notifications', 'canvasTaskUnavailable'), file: () => view.file,
   isCurrent: () => owner.isCurrent(view), readOnly: () => view.canvas.readonly,
   capture: () => owner.capture(view), add: (target, id) => owner.add(target, id),
   dropPoint: (hit, point) => !view.canvas.wrapperEl?.contains(hit) || view.canvas.canvasControlsEl?.contains(hit) || view.canvas.cardMenuEl.contains(hit)
    ? null : view.canvas.posFromClient?.(point) ?? null,
  });
 }
 sync(): void {
  const controls = this.view.canvas.canvasControlsEl;
  if (!controls?.isConnected || !this.view.canvas.wrapperEl?.isConnected || typeof this.view.canvas.posFromClient !== 'function') {
   this.setButton(null); this.group?.remove(); return;
  }
  if (!this.group || !controls.contains(this.group)) {
   this.group?.remove();
   this.group = controls.createDiv('canvas-control-group mod-raised operon-canvas-task-pool-tools');
   this.setButton(this.group.createEl('button', { cls: 'canvas-control-item', attr: { type: 'button' } }));
  }
  super.sync();
 }
 onunload(): void { super.onunload(); this.group?.remove(); }
}
