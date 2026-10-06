import { Notice } from 'obsidian';
import { asHTMLElement, getOwnerWindow } from '../core/dom-compat';
import { normalizeTaskFieldColor } from '../core/task-color-source';
import { t } from '../core/i18n';
import type { IndexedTask } from '../types/fields';
import type { ExcalidrawTaskView } from './excalidraw-task-bridge';

interface StrokeBinding {
 id: string;
 allowed(): boolean;
 read(): IndexedTask | undefined;
 write(task: IndexedTask, color: string, allowed: () => boolean): Promise<boolean>;
 refresh(): void;
}
interface StrokeChoice {
 binding: StrokeBinding; task: IndexedTask; seen: string; next?: string;
 elements: Set<string>; observing: boolean; deferred: boolean; writing: boolean; revision: number;
}
const owners = new WeakMap<ExcalidrawTaskView, ExcalidrawTaskColors>();
export function isExcalidrawTaskStrokeEditing(view: ExcalidrawTaskView, id: string): boolean { return owners.get(view)?.pending.has(id) === true; }

/** One listener set per drawing; only explicit native Stroke controls may change a task. */
export function bindExcalidrawTaskColor(view: ExcalidrawTaskView, binding: StrokeBinding): () => void {
 let owner = owners.get(view);
 if (!owner) { owner = new ExcalidrawTaskColors(view); owners.set(view, owner); }
 owner.bindings.set(binding.id, binding);
 return () => {
  if (owner.bindings.get(binding.id) === binding) owner.bindings.delete(binding.id);
  for (const choice of owner.choices.values()) if (choice.binding === binding) owner.finish(choice);
  if (!owner.bindings.size) { owner.destroy(); if (owners.get(view) === owner) owners.delete(view); }
 };
}
class ExcalidrawTaskColors {
 readonly bindings = new Map<string, StrokeBinding>();
 readonly choices = new Map<string, StrokeChoice>();
 readonly pending = new Set<string>();
 private frame = 0;
 private active = true;
 private cleanup: (() => void)[] = [];
 constructor(private view: ExcalidrawTaskView) {
  const win = getOwnerWindow(view.contentEl);
  const capture = (event: Event) => this.capture(event);
  for (const name of ['click', 'input', 'change', 'focusout', 'keydown', 'pointerdown', 'pointerup', 'pointercancel']) {
   view.contentEl.addEventListener(name, capture, true);
   this.cleanup.push(() => view.contentEl.removeEventListener(name, capture, true));
  }
  const cancel = () => { for (const choice of this.choices.values()) this.finish(choice); };
  win.addEventListener('blur', cancel); this.cleanup.push(() => win.removeEventListener('blur', cancel));
  this.cleanup.push(view.excalidrawAPI.onChange(() => this.observe()));
 }
 private capture(event: Event): void {
  const key = event as KeyboardEvent;
  if (event.type === 'pointercancel') { for (const choice of this.choices.values()) this.finish(choice); return; }
  if (event.type === 'keydown' && (key.key === 'Escape' || ((key.ctrlKey || key.metaKey) && /^(z|y)$/i.test(key.key)))) {
   for (const choice of this.choices.values()) this.finish(choice); return;
  }
  let node = event.target as Node | null;
  while (node && !asHTMLElement(node, this.view.contentEl)) node = node.parentElement;
  const target = asHTMLElement(node, this.view.contentEl), panel = target?.closest('.color-picker-container, .color-picker-content');
  if (target?.closest('.excalidraw-eye-dropper-backdrop') && this.view.contentEl.contains(target)) {
   for (const choice of this.choices.values()) {
    if (event.type === 'pointerdown') choice.deferred = true;
    if (event.type === 'pointerup') { choice.deferred = false; choice.revision++; }
   }
   this.observe(); return;
  }
  if (event.type === 'pointerdown' || event.type === 'pointerup') return;
  const state = this.view.excalidrawAPI.getAppState();
  const trigger = panel?.querySelector('[data-openpopup]');
  const strokePanel = trigger ? trigger.getAttribute('data-openpopup') === 'elementStroke' : panel && state.openPopup === 'elementStroke';
  if (!target || !this.view.contentEl.contains(target) || !strokePanel) {
   if (event.type === 'click') { for (const choice of this.choices.values()) { if (choice.next === undefined) this.finish(choice); else { choice.deferred = false; choice.observing = false; } } this.schedule(); }
   return;
  }
  if (target.closest('[data-openpopup]') || (event.type === 'keydown' && (key.ctrlKey || key.metaKey || (key.altKey && key.key !== 'Alt')))) return;
  if (!target.closest('button, input') && event.type !== 'keydown') return;
  const selected = state.selectedElementIds as Record<string, boolean> | undefined;
  for (const [id, binding] of this.bindings) {
   if (!selected?.[id] || !binding.allowed()) continue;
   const task = binding.read(), element = this.view.excalidrawAPI.getSceneElements().find(value => value.id === id);
   if (!task || !element) continue;
   let choice = this.choices.get(task.operonId);
   if (!choice) {
    choice = { binding, task: { ...task, fieldValues: { ...task.fieldValues } }, seen: element.strokeColor ?? '',
     elements: new Set(), observing: true, deferred: false, writing: false, revision: 0 };
    this.choices.set(task.operonId, choice);
   }
   choice.observing = true; choice.elements.add(id); this.pending.add(id); choice.revision++;
   choice.deferred = !!target.closest('.excalidraw-eye-dropper-trigger') || (event.type === 'keydown' && (key.key === 'Alt' || key.key.toLowerCase() === 'i')) || event.type === 'input' || (event.type === 'click' && target.tagName === 'INPUT') || (event.type === 'keydown' && target.tagName === 'INPUT' && key.key !== 'Enter');
  }
  this.observe();
 }
 private observe(): void {
  for (const choice of this.choices.values()) {
   const element = this.view.excalidrawAPI.getSceneElements().find(value => value.id === choice.binding.id);
   if (!choice.binding.allowed() || !element) { this.finish(choice); continue; }
   if (!choice.observing) continue;
   const color = element.strokeColor ?? '';
   if (color === choice.seen) continue;
   choice.seen = color;
   const next = !color || color === 'transparent' || /^#[a-f0-9]{6}00$/i.test(color) ? '' : normalizeTaskFieldColor(color)?.slice(1).toLowerCase();
   if (next === undefined) { this.finish(choice); continue; }
   choice.next = next;
  }
  this.schedule();
 }
 private schedule(): void {
  if (!this.active || this.frame || ![...this.choices.values()].some(choice => !choice.deferred && !choice.writing)) return;
  this.frame = getOwnerWindow(this.view.contentEl).requestAnimationFrame(() => {
   this.frame = 0;
   for (const choice of this.choices.values()) if (!choice.deferred && !choice.writing) {
    if (choice.next === undefined) this.finish(choice); else void this.commit(choice);
   }
  });
 }
 private async commit(choice: StrokeChoice): Promise<void> {
  const color = choice.next!, revision = choice.revision;
  const allowed = () => this.active && this.choices.get(choice.task.operonId) === choice && choice.binding.allowed() && choice.binding.read()?.operonId === choice.task.operonId;
  if (!allowed()) { this.finish(choice); return; }
  choice.writing = true;
  try {
   if ((normalizeTaskFieldColor(choice.task.fieldValues.taskColor)?.slice(1).toLowerCase() ?? '') !== color
    && !await choice.binding.write(choice.task, color, allowed)) throw new Error('Task color write failed');
   if (!allowed()) { this.finish(choice); return; }
   // Later explicit picker actions may follow a successful write; uncertain writes are never replayed.
   const task = choice.binding.read();
   if (!task || (normalizeTaskFieldColor(task.fieldValues.taskColor)?.slice(1).toLowerCase() ?? '') !== color) throw new Error('Task color changed');
   if (choice.revision !== revision && choice.next !== color) {
    choice.task = { ...task, fieldValues: { ...task.fieldValues } }; choice.writing = false; this.schedule(); return;
   }
   this.finish(choice);
  } catch { if (allowed()) new Notice(t('notifications', 'canvasTaskColorFailed')); this.finish(choice); }
 }
 finish(choice: StrokeChoice): void {
  if (this.choices.get(choice.task.operonId) !== choice) return;
  this.choices.delete(choice.task.operonId);
  for (const id of choice.elements) { this.pending.delete(id); this.bindings.get(id)?.refresh(); }
 }
 destroy(): void {
  this.active = false;
  for (const choice of this.choices.values()) this.finish(choice);
  if (this.frame) getOwnerWindow(this.view.contentEl).cancelAnimationFrame(this.frame);
  this.frame = 0; for (const cleanup of this.cleanup) cleanup(); this.cleanup = [];
 }
}
