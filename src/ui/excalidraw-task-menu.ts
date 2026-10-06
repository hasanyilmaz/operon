import { t } from '../core/i18n';
import type { ExcalidrawTaskState, ExcalidrawTaskView } from './excalidraw-task-bridge';

type NativeMenu = (elements: unknown, state: ExcalidrawTaskState, close: (action?: () => void) => void) => unknown;
type MenuView = ExcalidrawTaskView & {
 onContextMenu: NativeMenu;
 packages: { react: { Fragment: unknown; createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): unknown } };
 currentPosition: { x: number; y: number };
};

/** Preserve native menu output and restore only the wrapper that this mount owns. */
export function bindExcalidrawCreationMenu(view: ExcalidrawTaskView, allowed: () => boolean,
 create: (point: { x: number; y: number }) => void, unsupported: () => void = () => {}): (() => void) | null {
 const native = view as Partial<MenuView>;
 const original = native.onContextMenu;
 if (typeof original !== 'function') return null;
 const descriptor = Object.getOwnPropertyDescriptor(view, 'onContextMenu');
 let active = true;
 const wrapper: NativeMenu = function(elements, state, close) {
  const menu: unknown = original.call(view, elements, state, close);
  if (!active || !allowed() || Object.values(state.selectedElementIds as object ?? {}).some(Boolean)) return menu;
  // The view exists before its React package and scene API have finished loading.
  const react = native.packages?.react;
  if (typeof react?.createElement !== 'function' || !react.Fragment) { unsupported(); return menu; }
  const point = native.currentPosition;
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return menu;
  const captured = { ...point }, file = view.file, path = file?.path;
  return react.createElement(react.Fragment, null, menu,
   react.createElement('li', { key: 'operon-create-task', onClick: () => close(() => { if (active && allowed() && view.file === file && file?.path === path) create(captured); }) },
    react.createElement('button', { className: 'context-menu-item' },
     react.createElement('div', { className: 'context-menu-item__label' }, t('contextMenu', 'createAndAddOperonTask')))));
 };
 try { native.onContextMenu = wrapper; } catch { return null; }
 return () => { active = false; if (native.onContextMenu !== wrapper) return;
  if (descriptor) Object.defineProperty(view, 'onContextMenu', descriptor); else Reflect.deleteProperty(view, 'onContextMenu'); };
}
