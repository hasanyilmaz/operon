import type { Component } from 'obsidian';
import { getOwnerWindow } from '../core/dom-compat';

/** Shared by Excalidraw planning panels; keeps the native palette outside the zoomed scene. */
export function bindExcalidrawPoolTheme(content: HTMLElement, panel: HTMLElement, lifetime: Component): void {
 const native = content.querySelector<HTMLElement>('.excalidraw');
 if (!native) return;
 const win = getOwnerWindow(native);
 const properties: Record<string, string> = {
  '--background-primary': '--color-surface-lowest',
  '--background-secondary': '--color-surface-mid',
  '--background-secondary-alt': '--color-surface-low',
  '--background-modifier-border': '--color-border-outline-variant',
  '--background-modifier-hover': '--color-surface-high',
  '--text-normal': '--color-on-surface',
  '--text-muted': '--color-border-outline',
  '--text-faint': '--color-border-outline',
  '--interactive-accent': '--color-primary',
  '--text-accent': '--color-primary',
  '--link-color': '--color-primary',
  '--code-background': '--color-surface-low',
  '--code-normal': '--color-on-surface',
  '--text-highlight-bg': '--color-surface-primary-container',
 };
 let active = true;
 const update = () => {
  if (!active) return;
  const dark = native.classList.contains('theme--dark');
  panel.classList.toggle('theme-dark', dark); panel.classList.toggle('theme-light', !dark);
  const style = win.getComputedStyle(native);
  for (const [key, source] of Object.entries(properties)) {
   const value = style.getPropertyValue(source).trim();
   if (value) panel.style.setProperty(key, value); else panel.style.removeProperty(key);
  }
 };
 panel.setAttribute('data-operon-excalidraw-pool', '');
 update();
 const Observer = (win as Window & { MutationObserver: typeof MutationObserver }).MutationObserver;
 const observer = new Observer(update);
 observer.observe(native, { attributes: true, attributeFilter: ['class', 'style'] });
 lifetime.register(() => { active = false; observer.disconnect(); });
}
