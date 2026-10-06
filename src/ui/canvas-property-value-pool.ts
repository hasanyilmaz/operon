import { t } from '../core/i18n';
import type { CanvasTaskIntegration, TaskCanvasView } from './canvas-task-adapter';
import { CanvasPropertyValueDrop } from './canvas-property-value-drop';
import type { CanvasGroups } from './canvas-groups';
import type { CanvasTaskHistory } from './canvas-task-history';
import { SurfacePropertyValuePool, type CanvasPropertyValuePoolPreferences } from './surface-property-value-pool';
export type { CanvasPropertyValuePoolPreferences, PoolGroupSelection } from './surface-property-value-pool';

export class CanvasPropertyValuePool extends SurfacePropertyValuePool {
 private group: HTMLElement | null = null;
 constructor(private view: TaskCanvasView, private owner: CanvasTaskIntegration, preferences: CanvasPropertyValuePoolPreferences, history?: CanvasTaskHistory, groups?: CanvasGroups) {
  super({ app: owner.deps.app, cards: owner.deps.cards, contentEl: view.contentEl,
   file: () => view.file, identity: () => view.canvas, isCurrent: () => owner.isCurrent(view), title: () => t('settings', 'propertyPoolTitle'),
   createDrop: preferences.tasks && history ? (alive, resolve) => new CanvasPropertyValueDrop(view, history, preferences.tasks!, alive,
    (value, point) => groups?.preparePoolDrop(resolve(value) ?? value, point, () => !!resolve(value)) ?? null) : undefined,
  }, preferences);
 }
 sync(): void {
  if (!this.active) return;
  const controls = this.view.canvas.canvasControlsEl;
  if (!controls?.isConnected || !this.view.canvas.wrapperEl?.isConnected) { this.setButton(null); this.group?.remove(); return; }
  if (!this.group || !controls.contains(this.group)) {
   this.group?.remove();
   this.group = controls.createDiv('canvas-control-group mod-raised operon-canvas-property-pool-tools');
   this.setButton(this.group.createEl('button', { cls: 'canvas-control-item', attr: { type: 'button' } }));
  }
  const taskPool = controls.querySelector('.operon-canvas-task-pool-tools');
  if (taskPool && taskPool.nextElementSibling !== this.group) controls.insertBefore(this.group, taskPool.nextSibling);
  super.sync();
 }
 onunload(): void { super.onunload(); this.group?.remove(); }
}
