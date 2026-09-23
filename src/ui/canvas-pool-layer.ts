import type { Component } from 'obsidian';

/** Keep the active Pool at the existing popover level without moving focused DOM. */
export function bindCanvasPoolLayer(panel: HTMLElement, lifetime: Component): void {
 const activate = () => {
  for (const other of Array.from(panel.ownerDocument.querySelectorAll<HTMLElement>('.operon-canvas-task-pool, .operon-canvas-property-pool'))) {
   other.classList.toggle('operon-canvas-pool-background', other !== panel);
  }
 };
 lifetime.registerDomEvent(panel, 'pointerdown', activate, { capture: true });
 lifetime.registerDomEvent(panel, 'focusin', activate);
 activate();
}
