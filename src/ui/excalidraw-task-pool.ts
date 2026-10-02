import type { ExcalidrawPropertyPool } from './excalidraw-property-pool';
import { Notice } from 'obsidian';
import { t } from '../core/i18n';
import { SurfaceTaskPool, type TaskPoolPoint, type TaskPoolSurface, type TaskPoolTarget } from './surface-task-pool';
import type { ExcalidrawTaskAPI, ExcalidrawTaskState, ExcalidrawTaskView } from './excalidraw-task-bridge';

type ToolbarRenderer = (...args: unknown[]) => unknown;
type ToolbarView = ExcalidrawTaskView & {
 renderTopRightUI: ToolbarRenderer;
 packages?: { react?: { Fragment: unknown; createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): unknown } };
};

/** Excalidraw's viewport-to-scene transform, using current pane offsets and zoom. */
export function excalidrawPoolScenePoint(state: ExcalidrawTaskState, point: TaskPoolPoint): TaskPoolPoint | null {
 const zoom = (state.zoom as { value?: unknown } | undefined)?.value;
 const { offsetLeft, offsetTop, scrollX, scrollY } = state;
 if (![zoom, offsetLeft, offsetTop, scrollX, scrollY, point.x, point.y].every(value => typeof value === 'number' && Number.isFinite(value)) || (zoom as number) <= 0) return null;
 return { x: (point.x - (offsetLeft as number)) / (zoom as number) - (scrollX as number),
  y: (point.y - (offsetTop as number)) / (zoom as number) - (scrollY as number) };
}

/** Keep native controls and React ownership intact, including wrappers added after ours. */
export function bindExcalidrawPoolToolbar(view: ExcalidrawTaskView, ready: () => boolean,
 mount: (button: HTMLButtonElement | null) => void, unsupported: () => void, mountProperty?: (button: HTMLButtonElement | null) => void): (() => void) | null {
 const native = view as Partial<ToolbarView>, original = native.renderTopRightUI;
 if (typeof original !== 'function') return null;
 const descriptor = Object.getOwnPropertyDescriptor(view, 'renderTopRightUI');
 let active = true;
 const ref = (button: HTMLButtonElement | null) => { if (active) mount(button); };
 const propertyRef = (button: HTMLButtonElement | null) => { if (active) mountProperty?.(button); };
 const wrapper: ToolbarRenderer = function(...args) {
  const output: unknown = original.apply(view, args);
  if (!active || !ready()) return output;
  const react = native.packages?.react;
  if (typeof react?.createElement !== 'function' || !react.Fragment) { unsupported(); return output; }
  return react.createElement(react.Fragment, null, output,
   react.createElement('button', { key: 'operon-task-pool', ref, type: 'button', className: 'operon-excalidraw-task-pool-button' }),
   ...(mountProperty ? [react.createElement('button', { key: 'operon-property-pool', ref: propertyRef, type: 'button', className: 'operon-excalidraw-task-pool-button operon-excalidraw-property-pool-button' })] : []));
 };
 try { native.renderTopRightUI = wrapper; } catch { return null; }
 return () => { active = false; mount(null); mountProperty?.(null);
  if (native.renderTopRightUI === wrapper) {
   if (descriptor) Object.defineProperty(view, 'renderTopRightUI', descriptor); else Reflect.deleteProperty(view, 'renderTopRightUI');
  }
 };
}

export class ExcalidrawTaskPool<T extends TaskPoolTarget> extends SurfaceTaskPool<T> {
 private toolbar: (() => void) | null = null;
 private stopScene: (() => void) | null = null;
 private api: ExcalidrawTaskAPI | null = null;
 private pendingShow: (() => boolean) | null = null;
 private live = false;
 private warned = false;
 private readonly warn = () => { if (!this.warned) { this.warned = true; new Notice(t('notifications', 'excalidrawPoolUnavailable')); } };
 constructor(private view: ExcalidrawTaskView, private adapter: TaskPoolSurface<T>, private propertyPool?: ExcalidrawPropertyPool) { super(adapter); }
 onload(): void {
  this.live = true; if (this.propertyPool) this.addChild(this.propertyPool); super.onload();
  this.toolbar = bindExcalidrawPoolToolbar(this.view, () => this.adapter.isCurrent(), button => {
   this.setButton(button);
   if (button) { this.sync(); if (this.pendingShow) { const allowed = this.pendingShow; this.pendingShow = null; if (allowed()) super.show(); } }
  }, this.warn, this.propertyPool ? button => this.propertyPool!.setButton(button) : undefined);
  if (!this.toolbar) this.warn();
  else this.view.excalidrawAPI?.refresh?.();
 }
 requestPropertyOpen(): void {
  if (!this.toolbar) { this.warn(); return; }
  this.propertyPool?.requestOpen(); this.view.excalidrawAPI?.refresh?.();
 }
 requestOpen(): void {
  if (!this.toolbar) { this.warn(); return; }
  const file = this.adapter.file(), path = file?.path;
  this.pendingShow = !this.hasButton ? () => this.adapter.file() === file && file?.path === path : null;
  this.sync(); super.show();
  // A refresh mounts the button when the plugin is enabled on an already-open drawing.
  this.view.excalidrawAPI?.refresh?.();
 }
 sync(): void {
  if (!this.live) return;
  const api = this.view.excalidrawAPI;
  if (api !== this.api) {
   this.stopScene?.(); this.stopScene = null; this.api = api;
   if (typeof api?.onChange === 'function') {
    let mode: unknown;
    this.stopScene = api.onChange((_elements, state) => {
     if (mode !== state.viewModeEnabled || !this.adapter.isCurrent()) { mode = state.viewModeEnabled; super.sync(); this.propertyPool?.sync(); }
    });
   }
  }
  super.sync(); this.propertyPool?.sync();
 }
 onunload(): void {
  this.live = false; this.pendingShow = null; this.stopScene?.(); this.stopScene = null; this.api = null;
  this.toolbar?.(); this.toolbar = null; super.onunload();
  if (this.view._loaded) this.view.excalidrawAPI?.refresh?.();
 }
}
