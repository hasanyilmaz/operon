import { bindExcalidrawTaskColor } from './excalidraw-task-colors';
import type { IndexedTask } from '../types/fields';
import type { App } from 'obsidian';
import { ExcalidrawTaskAutoHeight } from './excalidraw-task-auto-height';
import { isExcalidrawTaskLink, readExcalidrawCardReference, readExcalidrawTaskView, type ExcalidrawTaskView, type ExcalidrawTaskElement, type ExcalidrawTaskState } from './excalidraw-task-bridge';

export interface TaskCardSurfaceAccess {
 readonly menuSurface?: 'excalidrawTask';
 canInteract(): boolean;
 canChangeStatus(): boolean;
 canEditFields(): boolean;
 captureWriteGuard?(): () => boolean;
}
interface Binding { view: ExcalidrawTaskView; file: object; path: string; id: string; node: HTMLElement; container: HTMLElement; taskId: string }
const owners = new WeakMap<HTMLElement, Set<object>>();
/** Verified ownership, not a CSS class, grants access to a foreign embedded Canvas node. */
export class TaskCardExcalidrawHost implements TaskCardSurfaceAccess {
 readonly menuSurface = 'excalidrawTask' as const;
 private binding: Binding | null = null;
 private height: ExcalidrawTaskAutoHeight | null = null;
 private stopColor: (() => void) | null = null;
 private unsubscribe: (() => void) | null = null;
 private signature = '';
 private active = true;
 private queued = false;
 constructor(private app: App, private root: HTMLElement, private changed: () => void,
  private colors?: { read(id: string): IndexedTask | undefined; write(task: IndexedTask, color: string, allowed: () => boolean): Promise<boolean> }) {}
 refresh(taskId: string): boolean {
  if (!this.active) return false;
  const node = this.root.closest<HTMLElement>('.canvas-node');
  let next: Binding | null = null;
  if (node) for (const leaf of this.app.workspace.getLeavesOfType('excalidraw')) {
   const view = readExcalidrawTaskView(this.app, leaf.view);
   if (!view?.file || !view.contentEl.contains(node)) continue;
   for (const element of view.excalidrawAPI.getSceneElements()) {
    const reference = readExcalidrawCardReference(this.app, view, element, taskId);
    if (reference?.node === node && reference.container.contains(this.root)) {
     next = { view, file: view.file, path: view.file.path, id: element.id, node, container: reference.container, taskId }; break;
    }
   }
   if (next) break;
  }
  if (this.binding?.view !== next?.view || this.binding?.file !== next?.file || this.binding?.path !== next?.path
   || this.binding?.node !== next?.node || this.binding?.container !== next?.container || this.binding?.id !== next?.id || this.binding?.taskId !== next?.taskId) {
   this.release(); this.binding = next;
   if (next) {
    const set = owners.get(next.node) ?? new Set<object>(); set.add(this); owners.set(next.node, set);
    // Native React rewrites className on theme changes; its data attributes are stable.
    next.node.setAttribute('data-operon-task-card-excalidraw', '');
    const binding = next;
    if (this.colors) this.stopColor = bindExcalidrawTaskColor(next.view, { id: next.id,
     allowed: () => this.binding === binding && this.canChangeStatus(), read: () => this.colors?.read(binding.taskId),
     write: (task, color, allowed) => this.colors!.write(task, color, allowed), refresh: () => this.changed() });
    this.height = new ExcalidrawTaskAutoHeight(this.root, next.container, next.view, next.id, () => this.binding === binding && this.canChangeStatus(), this.app);
    const signatureFor = (element: ExcalidrawTaskElement | undefined, state: ExcalidrawTaskState) => JSON.stringify([element?.link, element?.locked, element?.isDeleted,
     state.viewModeEnabled, state.activeEmbeddable?.element.id, state.activeEmbeddable?.state, binding.view.file?.path]);
    this.signature = signatureFor(next.view.excalidrawAPI.getSceneElements().find(element => element.id === next.id), next.view.excalidrawAPI.getAppState());
    this.unsubscribe = next.view.excalidrawAPI.onChange((elements, state) => {
     const element = elements.find(value => value.id === binding.id);
     this.height?.sceneChanged(element, state.viewModeEnabled, state.theme);
     // Pan, zoom and geometry updates do not repaint task content or parse Markdown.
     const signature = signatureFor(element, state);
     if (this.signature === signature) return;
     this.signature = signature;
     if (this.queued) return;
     this.queued = true;
     queueMicrotask(() => { this.queued = false; if (this.active) this.changed(); });
    });
   }
  }
  this.height?.schedule();
  return !!next;
 }
 private valid(): boolean {
  const b = this.binding;
  if (!this.active || !b || !this.root.isConnected || !b.node.contains(this.root) || this.root.closest('.canvas-node') !== b.node
   || readExcalidrawTaskView(this.app, b.view) !== b.view || b.view.file !== b.file || b.view.file?.path !== b.path
   || !this.app.workspace.getLeavesOfType('excalidraw').some(leaf => leaf.view === (b.view as unknown))) return false;
  const element = b.view.excalidrawAPI.getSceneElements().find(value => value.id === b.id);
  const ref = b.view.getEmbeddableLeafElementById(b.id)?.node;
  return !!element && !element.isDeleted && element.type === 'embeddable'
   && ref?.containerEl === b.container && ref.file === b.file
   && b.container.closest('.canvas-node') === b.node && b.container.contains(this.root)
   && isExcalidrawTaskLink(this.app, b.view, element.link, b.taskId);
 }
 canInteract(): boolean {
  if (!this.valid() || !this.binding) return false;
  const active = this.binding.view.excalidrawAPI.getAppState().activeEmbeddable;
  return active?.element.id === this.binding.id && active.state === 'active';
 }
 canChangeStatus(): boolean {
  if (!this.valid() || !this.binding) return false;
  const { view, id } = this.binding;
  return view.excalidrawAPI.getAppState().viewModeEnabled === false
   && view.excalidrawAPI.getSceneElements().find(element => element.id === id)?.locked === false;
 }
 canEditFields(): boolean { return this.canChangeStatus(); }
 captureWriteGuard(): () => boolean {
  const binding = this.binding;
  return () => this.binding === binding && this.canChangeStatus();
 }
 get attached(): boolean { return this.binding !== null; }
 private release(): void {
  this.height?.destroy(); this.height = null;
  this.stopColor?.(); this.stopColor = null;
  this.unsubscribe?.(); this.unsubscribe = null; this.signature = '';
  if (this.binding) {
   const { node } = this.binding, set = owners.get(node); set?.delete(this);
   if (!set?.size) { node.removeAttribute('data-operon-task-card-excalidraw'); owners.delete(node); }
  }
  this.binding = null;
 }
 destroy(): void { this.active = false; this.release(); }
}
