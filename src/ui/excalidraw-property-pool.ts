import type { App } from 'obsidian';
import { t } from '../core/i18n';
import type { TaskCardEmbeds } from './task-card-embed';
import { bindExcalidrawPoolTheme } from './excalidraw-pool-theme';
import { excalidrawPoolScenePoint } from './excalidraw-task-pool';
import { readExcalidrawCardReference, type ExcalidrawTaskElement, type ExcalidrawTaskView } from './excalidraw-task-bridge';
import { SurfacePropertyValuePool, type CanvasPropertyValuePoolPreferences } from './surface-property-value-pool';
import { SurfacePropertyValueDrop, type PropertyDropTarget } from './surface-property-value-drop';

/** Conservative bounds: shapes above a card block drops even across their unfilled interior. */
export function excalidrawPropertyContains(element: ExcalidrawTaskElement, point: { x: number; y: number }): boolean {
 const { x, y, width, height } = element, angle = element.angle ?? 0;
 if (![x, y, width, height, angle].every(value => typeof value === 'number' && Number.isFinite(value))) return false;
 const w = width as number, h = height as number;
 const dx = point.x - ((x as number) + w / 2), dy = point.y - ((y as number) + h / 2);
 const localX = dx * Math.cos(angle) + dy * Math.sin(angle), localY = -dx * Math.sin(angle) + dy * Math.cos(angle);
 return Math.abs(localX) <= Math.max(Math.abs(w) / 2, 2) && Math.abs(localY) <= Math.max(Math.abs(h) / 2, 2);
}
export function excalidrawPropertyTarget(app: App, view: ExcalidrawTaskView, x: number, y: number): PropertyDropTarget | null {
 const hit = view.contentEl.ownerDocument.elementFromPoint(x, y);
 if (!hit || !view.contentEl.contains(hit) || !hit.closest('.excalidraw')
  || hit.closest('.Island, .App-menu, .App-toolbar, .layer-ui__wrapper, .context-menu, .embeddable-menu, .operon-canvas-task-pool, .operon-canvas-property-pool, .operon-floating-panel, .menu')) return null;
 const point = excalidrawPoolScenePoint(view.excalidrawAPI.getAppState(), { x, y });
 if (!point) return null;
 const hits = view.excalidrawAPI.getSceneElements().filter(element => !element.isDeleted && excalidrawPropertyContains(element, point));
 const element = hits[hits.length - 1];
 if (!element || hits.filter(candidate => candidate.type === 'embeddable').length !== 1) return null;
 const reference = readExcalidrawCardReference(app, view, element);
 if (!reference) return null;
 const control = hit.closest('button, input, textarea, select, a');
 if (control && !reference.node.contains(control)) return null;
 const file = view.file, path = file?.path;
 const read = () => view.excalidrawAPI.getSceneElements().find(candidate => candidate.id === element.id);
 return { id: element.id, taskId: reference.taskId, nodeEl: reference.node,
  readOnly: () => read()?.locked !== false,
  current: () => {
   const current = read();
   if (view.file !== file || file?.path !== path || !current) return false;
   const next = readExcalidrawCardReference(app, view, current, reference.taskId);
   return next?.node === reference.node && next.container === reference.container;
  },
 };
}

export class ExcalidrawPropertyPool extends SurfacePropertyValuePool {
 private pendingShow: (() => boolean) | null = null;
 constructor(view: ExcalidrawTaskView, app: App, cards: TaskCardEmbeds, preferences: CanvasPropertyValuePoolPreferences, isCurrent: () => boolean) {
  const theme = (element: HTMLElement, lifetime: import('obsidian').Component) => bindExcalidrawPoolTheme(view.contentEl, element, lifetime);
  super({ app, cards, contentEl: view.contentEl, file: () => view.file, identity: () => view.excalidrawAPI,
   isCurrent, title: () => t('settings', 'excalidrawPropertyPool'), bindTheme: theme,
   createDrop: preferences.tasks ? alive => new SurfacePropertyValueDrop({
    contentEl: view.contentEl, file: () => view.file, identity: () => view.excalidrawAPI,
    isCurrent: () => alive() && isCurrent(), readOnly: () => view.excalidrawAPI.getAppState().viewModeEnabled !== false,
    supported: () => true, unavailable: () => t('settings', 'excalidrawPropertyTargetRequired'), busy: () => false, bindTheme: theme,
    targetAt: (x, y) => excalidrawPropertyTarget(app, view, x, y),
    apply: async (plan, allowed) => {
     let result: import('../core/property-pool-task-operation').PropertyPoolTaskResult = { status: 'blocked' };
     await cards.run(plan.id, allowed, async () => { result = await preferences.tasks!.apply(plan, 'drop', allowed); });
     return result;
    },
   }, preferences.tasks!) : undefined,
  }, preferences);
 }
 requestOpen(): void {
  const file = this.surface.file(), path = file?.path;
  this.pendingShow = this.hasButton ? null : () => this.surface.isCurrent() && this.surface.file() === file && file?.path === path;
  this.show();
 }
 setButton(button: HTMLButtonElement | null): void {
  super.setButton(button);
  if (button && this.pendingShow) { const allowed = this.pendingShow; this.pendingShow = null; if (allowed()) this.show(); }
 }
 onunload(): void { this.pendingShow = null; super.onunload(); }
}
