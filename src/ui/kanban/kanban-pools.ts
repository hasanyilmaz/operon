import { Component, type App } from 'obsidian';
import { t } from '../../core/i18n';
import { getOwnerWindow } from '../../core/dom-compat';
import type { TaskCardEmbeds } from '../task-card-embed';
import { SurfaceTaskPool, type TaskPoolSurface, type TaskPoolTarget } from '../surface-task-pool';
import { SurfacePropertyValuePool, type CanvasPropertyValuePoolPreferences, type PropertyPoolSurface, type PropertyPoolPanelState } from '../surface-property-value-pool';

export interface KanbanPoolServices {
 cards: TaskCardEmbeds;
 preferences: CanvasPropertyValuePoolPreferences;
}

/** One board generation owns its controls, body-mounted panels and mutation leases. */
export class KanbanPools extends Component {
 private active = false;
 private controls: HTMLElement | null = null;
 private properties: SurfacePropertyValuePool | null = null;
 capturePropertyState(): PropertyPoolPanelState | null { return this.properties?.capturePanelState() ?? null; }
 restorePropertyState(state: PropertyPoolPanelState): void { this.properties?.restorePanelState(state); }
 constructor(private app: App, private board: HTMLElement, private services: KanbanPoolServices, private currentPreset: () => boolean, private placement?: Pick<TaskPoolSurface<TaskPoolTarget>, 'startPlacementDrag' | 'add'>, private createPropertyDrop?: PropertyPoolSurface['createDrop']) { super(); }
 private readonly isCurrent = (): boolean => this.active && this.board.isConnected && this.currentPreset();
 onload(): void {
  this.active = true;
  const controls = this.controls = this.board.createDiv('operon-kanban-pool-controls');
  const button = () => controls.createEl('button', {
   cls: 'operon-kanban-toolbar-settings-button operon-kanban-cell-size-button', attr: { type: 'button' },
  });
  const surface = {
   app: this.app, cards: this.services.cards, contentEl: this.board,
   file: () => null, identity: () => this, isCurrent: this.isCurrent,
  };
  const tasks = this.addChild(new SurfaceTaskPool<TaskPoolTarget>({
   ...surface, title: () => t('settings', 'kanbanTaskPool'), readOnly: () => false,
   capabilities: { editTasks: true, directPlacement: false, dragPlacement: !!this.placement },
   ...this.placement,
  }));
  tasks.setButton(button());
  const properties = this.properties = this.addChild(new SurfacePropertyValuePool({
   ...surface, title: () => t('settings', 'kanbanPropertyPool'), createDrop: this.createPropertyDrop,
  }, this.services.preferences));
  properties.setButton(button());
  const win = getOwnerWindow(this.board);
  const syncLayout = () => {
   const height = controls.getBoundingClientRect().height;
   // At short heights, keep the pools centered and place one size button on each side.
   const sizeButtons = this.board.querySelectorAll<HTMLElement>('.operon-kanban-cell-height-button');
   const sizes = Array.from(sizeButtons).reduce((sum, button) => sum + button.getBoundingClientRect().height, 0);
   this.board.style.setProperty('--operon-kanban-pool-clearance', `${height + 16}px`);
   this.board.toggleClass('has-separated-pool-size-controls', this.board.clientHeight < height + 2 * (83 + sizes + 16));
  };
  const Resize = (win as Window & { ResizeObserver: typeof ResizeObserver }).ResizeObserver;
  const observer = new Resize(syncLayout);
  observer.observe(this.board); observer.observe(controls);
  this.register(() => observer.disconnect());
  this.registerDomEvent(win, 'resize', syncLayout);
  syncLayout();
 }
 onunload(): void {
  this.active = false; this.controls?.remove(); this.controls = null;
  this.board.removeClass('has-separated-pool-size-controls');
  this.board.style.removeProperty('--operon-kanban-pool-clearance');
 }
}
