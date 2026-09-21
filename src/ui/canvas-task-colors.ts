import { isCanvasGroupEditing } from './canvas-groups';
import { resolveGroupColor, type GroupSettings } from '../core/canvas-group-rule';
import { workflowColor, workflowColorKey, type WorkflowColorChange } from '../core/workflow-color';
import type { TaskRefreshScope } from '../core/task-refresh-scope';
import { CanvasTaskHistory } from './canvas-task-history';
import { Component, Notice } from 'obsidian';
import { getOwnerWindow, asHTMLElement, createOwnerElement } from '../core/dom-compat';
import { normalizeTaskFieldColor } from '../core/task-color-source';
import { t } from '../core/i18n';
import { readCanvasTaskReference } from './canvas-task-node';
import type { CanvasTaskNode, TaskCanvas, TaskCanvasView } from './canvas-task-adapter';

interface ColorItem extends CanvasTaskNode {
 color?: string;
 getData(): Record<string, unknown>;
 setColor(value: string, immediate?: boolean): void;
 render(): void;
}
interface ColorCanvas extends TaskCanvas {
 selection: Set<ColorItem>;
 history: { data: unknown[]; current: number };
 undo(): void;
 redo(): void;
}
interface ColorChange { id: string; before: string; after: string }
interface ColorJournal { before: unknown; after: unknown; changes: ColorChange[]; groups?: WorkflowColorChange[] }
interface ColorChoice {
 panel: HTMLElement; items: ColorItem[]; tasks: Map<string, string>;
 file: TaskCanvasView['file']; path: string; preview: string | null;
 groups: Map<ColorItem, NonNullable<ReturnType<typeof resolveGroupColor>>>; shapes: Map<ColorItem, string>;
}
interface ColorDependencies {
 read(id: string): string | null;
 write(id: string, expected: string, next: string, allowed: () => boolean): Promise<boolean>;
 subscribe(callback: (scope?: TaskRefreshScope) => void): () => void;
 groupSettings?(): GroupSettings;
 writeGroups?(changes: readonly WorkflowColorChange[], allowed: () => boolean): Promise<boolean>;
 subscribeGroups?(callback: () => void): () => void;
 isCurrent(): boolean;
}

export function normalizeCanvasTaskColor(value: string): string | null {
 if (!value.trim()) return '';
 return normalizeTaskFieldColor(value)?.slice(1).toLowerCase() ?? null;
}

/** Resolve the palette in its owning window; task colors store concrete RGB, never theme slots. */
export function resolveCanvasTaskColor(value: string, anchor: HTMLElement): string | null {
 if (!/^[1-6]$/.test(value)) return normalizeCanvasTaskColor(value);
 const probe = createOwnerElement(anchor, 'span');
 probe.style.color = `var(--canvas-color-${value})`;
 probe.hidden = true;
 anchor.appendChild(probe);
 const color = getOwnerWindow(anchor).getComputedStyle(probe).color;
 probe.remove();
 const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(color);
 return rgb ? rgb.slice(1).map(channel => Number(channel).toString(16).padStart(2, '0')).join('') : normalizeCanvasTaskColor(color);
}

/** Native palette and history hooks belong to one open Canvas, never to its prototype. */
export class CanvasTaskColors extends Component {
 private taskColors = new Map<string, string | null>();
 private active = false;
 private busy = false;
 private choice: ColorChoice | null = null;
 private journal: ColorJournal[] = [];
 private renders = new Map<ColorItem, () => void>();
 private canvas: ColorCanvas | null = null;
 constructor(private view: TaskCanvasView, private deps: ColorDependencies, private history?: CanvasTaskHistory) { super(); }

 onload(): void {
  this.active = true;
  const canvas = this.view.canvas as ColorCanvas;
  if (canvas.selection instanceof Set && typeof canvas.history.current === 'number'
   && typeof canvas.undo === 'function' && typeof canvas.redo === 'function') {
   this.canvas = canvas;
   if (!this.history) { this.history = new CanvasTaskHistory(this.view); this.history.onload(); this.register(() => this.history?.unload()); }
   this.register(this.history.addHandler(step => {
    const entry = this.journal.find(item => step.direction === 'undo'
     ? item.after === step.current && item.before === step.next : item.before === step.current && item.after === step.next);
    return entry ? async () => { if (this.busy) { this.notice(); return; } await this.travel(entry, step.direction, () => step.native()); } : null;
   }));
  }
  const capture = (event: Event) => this.capture(event);
  for (const name of ['click', 'input', 'change', 'focusout']) {
   this.view.contentEl.addEventListener(name, capture, true);
   this.register(() => this.view.contentEl.removeEventListener(name, capture, true));
  }
  const doc = this.view.contentEl.ownerDocument;
  const outside = (event: PointerEvent) => {
   const choice = this.choice, target = asHTMLElement(event.target, this.view.contentEl);
   if (choice && target && this.view.contentEl.contains(target) && !choice.panel.contains(target)) this.commitPreview(choice);
  };
  const escape = (event: KeyboardEvent) => {
   const choice = this.choice;
   if (event.key === 'Escape' && choice?.groups.size && !this.busy) {
    choice.preview = null; this.finishChoice(choice);
   }
  };
  doc.addEventListener('pointerdown', outside, true); doc.addEventListener('keydown', escape, true);
  this.register(() => { doc.removeEventListener('pointerdown', outside, true); doc.removeEventListener('keydown', escape, true); });
  this.register(this.deps.subscribe(scope => this.sync(scope)));
  if (this.deps.subscribeGroups) this.register(this.deps.subscribeGroups(() => this.sync()));
  this.sync();
 }

 private notice(): void { new Notice(t('notifications', 'canvasTaskColorFailed')); }
 private valid(choice?: ColorChoice): boolean {
  return this.active && this.deps.isCurrent() && this.view.canvas === this.canvas && !this.view.canvas.readonly
   && !!this.view.file && (!choice || this.view.file === choice.file && this.view.file.path === choice.path);
 }
 private group(item: ColorItem) {
  const data = item.getData(), settings = this.deps.groupSettings?.();
  return data.type === 'group' && typeof data.label === 'string' && settings ? resolveGroupColor(data.label, settings) : null;
 }
 private reference(item: ColorItem): string | null { return readCanvasTaskReference(item.getData())?.taskId ?? null; }
 private color(item: ColorItem): string | null {
  const id = this.reference(item);
  if (!id) return this.group(item)?.color ?? null;
  if (!this.taskColors.has(id)) this.taskColors.set(id, this.deps.read(id));
  return this.taskColors.get(id) ?? null;
 }
 private project(item: ColorItem): void {
  if (!this.active || !item.nodeEl) return;
  if (this.group(item) && this.renders.has(item)) { item.render(); return; }
  const value = this.choice?.preview !== null && this.choice?.items.includes(item)
   ? this.choice.preview : this.color(item);
  if (value === null || value === undefined) return;
  const color = normalizeTaskFieldColor(value);
  const css = color ?? 'var(--background-modifier-border)';
  if (item.nodeEl.style.getPropertyValue('--canvas-color') !== css) item.nodeEl.style.setProperty('--canvas-color', css);
  item.nodeEl.classList.toggle('is-themed', !!color);
 }

 syncStructure(): void { this.sync({ kind: 'tasks', taskIds: new Set() }); }
 sync(scope: TaskRefreshScope = { kind: 'full', reason: 'colors' }): void {
  if (!this.active) return;
  if (scope.kind === 'full') this.taskColors.clear(); else for (const id of scope.taskIds) this.taskColors.delete(id);
  for (const [item, restore] of this.renders) {
   if (this.view.canvas.nodes.get(item.id) !== item || (!this.reference(item) && !this.group(item))) { restore(); this.renders.delete(item); }
  }
  const referenced = new Set<string>();
  for (const node of this.view.canvas.nodes.values()) {
   const item = node as unknown as ColorItem;
   const id = this.reference(item); if (id) referenced.add(id);
   if ((!this.reference(item) && !this.group(item)) || !item.nodeEl || typeof item.render !== 'function' || typeof item.setColor !== 'function') continue;
   if (!this.renders.has(item)) {
    const original: () => void = Reflect.get(item, 'render');
    const descriptor = Object.getOwnPropertyDescriptor(item, 'render');
    let mounted = true;
    const wrapper = () => {
     if (mounted && this.active && this.group(item)) {
      const value = this.choice?.preview !== null && this.choice?.items.includes(item)
       ? this.choice.preview : this.color(item);
      const descriptor = Object.getOwnPropertyDescriptor(item, 'color');
      // Native group rendering owns both the fill and foreground contrast.
      // Expose the projected color only during that synchronous render.
      try { item.color = normalizeTaskFieldColor(value) ?? undefined; original.call(item); }
      finally {
       if (descriptor) Object.defineProperty(item, 'color', descriptor); else Reflect.deleteProperty(item, 'color');
      }
      return;
     }
     original.call(item); if (mounted) this.project(item);
    };
    item.render = wrapper;
    this.renders.set(item, () => {
     mounted = false;
     if (item.render === wrapper) {
      if (descriptor) Object.defineProperty(item, 'render', descriptor); else Reflect.deleteProperty(item, 'render');
     }
     if (item.nodeEl?.isConnected) original.call(item);
    });
   }
   this.project(item);
  }
  for (const id of this.taskColors.keys()) if (!referenced.has(id)) this.taskColors.delete(id);
  if (this.choice && !this.choice.panel.isConnected) {
   this.choice = null;
   for (const item of this.renders.keys()) this.project(item);
  }
  const panel = this.view.contentEl.querySelector<HTMLElement>('.canvas-submenu:has(.canvas-color-picker-item)');
  if (panel && panel !== this.choice?.panel && this.canvas) {
   const items = [...this.canvas.selection];
   const tasks = new Map<string, string>();
   for (const item of items) {
    const id = this.reference(item);
    if (id) tasks.set(id, this.deps.read(id) ?? '');
   }
   const groups = new Map<ColorItem, NonNullable<ReturnType<typeof resolveGroupColor>>>();
   for (const item of items) { const group = this.group(item); if (group) groups.set(item, group); }
   if (tasks.size || groups.size) {
    this.choice = { panel, items, tasks, groups, shapes: new Map(items.map(item => [item, JSON.stringify(item.getData())])), file: this.view.file, path: this.view.file?.path ?? '', preview: null };
    const colors = [...tasks.values(), ...[...groups.values()].map(group => group.color)].map(normalizeCanvasTaskColor);
    const color = colors[0];
    if (color !== null && colors.every(value => value === color)) {
     for (const el of Array.from(panel.querySelectorAll('.is-active'))) el.classList.remove('is-active');
     if (color === '') panel.querySelector('.canvas-color-picker-item')?.classList.add('is-active');
     else {
      const input = panel.querySelector<HTMLInputElement>('input[type="color"]');
      if (input) { input.value = `#${color}`; input.parentElement?.classList.add('is-active'); input.parentElement?.style.setProperty('--canvas-color', `#${color}`); }
     }
    }
   }
  }
  if (this.canvas) this.journal = this.journal.filter(item => this.canvas?.history.data.includes(item.after));
 }

 private capture(event: Event): void {
  const element = asHTMLElement(event.target, this.view.contentEl);
  const item = element?.closest<HTMLElement>('.canvas-color-picker-item');
  if (!item || !this.view.contentEl.contains(item)) return;
  this.sync();
  const choice = this.choice;
  if (!choice || !choice.panel.contains(item)) return;
  const input = element?.closest<HTMLInputElement>('input[type="color"]');
  if (event.type === 'focusout') {
   if (choice.groups.size) return;
   choice.preview = null; for (const node of choice.items) this.project(node); return;
  }
  if (event.type === 'click' && (input || item.classList.contains('canvas-color-picker-custom'))) return;
  event.preventDefault(); event.stopImmediatePropagation();
  if (this.busy && choice.groups.size) return;
  if (!this.valid(choice) || this.busy || !this.canvas) { this.notice(); return; }
  if (choice.groups.size && (!this.groupChoiceCurrent(choice, !(input && event.type === 'change' && choice.preview !== null)) || this.history?.isInputBusy)) { new Notice(t('notifications', 'canvasGroupColorFailed')); return; }
  const slot = Array.from(item.classList).find(name => /^mod-canvas-color-[1-6]$/.test(name))?.slice(-1) ?? '';
  const value = resolveCanvasTaskColor(input?.value ?? slot, choice.panel);
  if (value === null) { this.notice(); return; }
  if (event.type === 'input') {
   choice.preview = choice.groups.size ? value || '6b7280' : value;
   for (const node of choice.items) if (this.reference(node) || this.group(node)) this.project(node);
  } else {
   const finalizedPreview = !!input && choice.preview !== null;
   choice.preview = null;
   if (choice.groups.size) void this.commitGroups(choice, value ? `#${value}` : '#6b7280', input?.value ?? slot, !finalizedPreview);
   else void this.commit(choice, value, input?.value ?? slot);
  }
 }

 private commitPreview(choice: ColorChoice): void {
  if (!choice.groups.size || choice.preview === null || this.busy) return;
  const value = choice.preview; choice.preview = null;
  if (!this.groupChoiceCurrent(choice, false) || this.history?.isInputBusy) { new Notice(t('notifications', 'canvasGroupColorFailed')); return; }
  void this.commitGroups(choice, `#${value}`, `#${value}`, false);
 }
 private groupChoiceCurrent(choice: ColorChoice, requireSelection = true): boolean {
  const canvas = this.canvas;
  return !!canvas && this.valid(choice) && !this.view.saving && this.view.lastSavedData !== null
   && (!requireSelection || canvas.selection.size === choice.items.length) && choice.items.every(item => (!requireSelection || canvas.selection.has(item))
    && canvas.nodes.get(item.id) === item && item.getData().type === 'group' && !item.isEditing && !isCanvasGroupEditing(item)
    && JSON.stringify(item.getData()) === choice.shapes.get(item)
    && workflowColorKeyOrNull(this.group(item)) === workflowColorKeyOrNull(choice.groups.get(item)));
 }
 private finishChoice(choice: ColorChoice): void {
  if (this.choice === choice) {
   choice.panel.parentElement?.querySelector<HTMLButtonElement>('button.is-active')?.click();
   this.choice = null;
  }
  this.sync();
 }
 private async commitGroups(choice: ColorChoice, color: string, nativeColor: string, requireSelection = true): Promise<void> {
  const canvas = this.canvas;
  if (!canvas || !this.groupChoiceCurrent(choice, requireSelection) || this.busy) return;
  this.busy = true;
  const release = this.history?.reserve();
  let persisted = false;
  try {
   const unique = new Map<string, WorkflowColorChange>();
   for (const group of choice.groups.values()) unique.set(workflowColorKey(group.ref), { ref: group.ref, expected: group.color, next: color });
   const all = [...unique.values()], changes = all.filter(change => change.expected !== change.next);
   const allowed = () => this.groupChoiceCurrent(choice, requireSelection);
   if (!allowed() || all.some(change => !this.deps.groupSettings || workflowColor(this.deps.groupSettings(), change.ref) !== change.expected)) throw new Error('Changed workflow color');
   const nativeItems = choice.items.filter(item => {
    const group = choice.groups.get(item);
    return group ? changes.some(change => workflowColorKey(change.ref) === workflowColorKey(group.ref)) : (item.color ?? '') !== nativeColor;
   });
   if (!changes.length && !nativeItems.length) return;
   canvas.requestPushHistory.run();
   if (!allowed()) throw new Error('Canvas changed');
   const head = canvas.history.data[canvas.history.current], shape = JSON.stringify(canvas.getData());
   const unchanged = () => allowed() && canvas.history.data[canvas.history.current] === head && JSON.stringify(canvas.getData()) === shape;
   if (changes.length) {
    if (!this.deps.writeGroups || !await this.deps.writeGroups(changes, unchanged)) throw new Error('Workflow color unavailable');
    persisted = true;
   }
   if (!unchanged()) throw new Error('Canvas changed after settings save');
   if (!canvas.history.data.length) canvas.pushHistory(canvas.getData());
   const before = canvas.history.data[canvas.history.current];
   for (const item of nativeItems) item.setColor(choice.groups.has(item) ? color : nativeColor);
   canvas.requestSave(false);
   const after = canvas.getData();
   if (changes.length && JSON.stringify(before) === JSON.stringify(after)) {
    if (!this.history?.recordSourceChange(direction => this.travelGroups({ before, after, changes: [], groups: changes }, direction, () => {}, false))) throw new Error('History unavailable');
   } else {
    canvas.pushHistory(after);
    this.journal.push({ before, after: canvas.history.data[canvas.history.current], changes: [], groups: changes });
   }
   await this.view.save();
  } catch { new Notice(t('notifications', persisted ? 'canvasGroupColorPartial' : 'canvasGroupColorFailed')); }
  finally { release?.(); this.busy = false; this.finishChoice(choice); }
 }
 private async travelGroups(entry: ColorJournal, direction: 'undo' | 'redo', native: () => void, saveNative = true): Promise<boolean> {
  const canvas = this.canvas;
  if (!canvas || !this.valid()) return false;
  const changes = entry.groups!.map(change => ({ ref: change.ref, expected: direction === 'undo' ? change.next : change.expected, next: direction === 'undo' ? change.expected : change.next }));
  const file = this.view.file, path = file?.path, head = canvas.history.data[canvas.history.current], shape = JSON.stringify(canvas.getData());
  const allowed = () => this.valid() && this.view.file === file && file?.path === path && !this.view.saving && this.view.lastSavedData !== null
   && canvas.history.data[canvas.history.current] === head && JSON.stringify(canvas.getData()) === shape;
  this.busy = true;
  let persisted = false;
  try {
   if (!allowed() || (changes.length && (!this.deps.writeGroups || !await this.deps.writeGroups(changes, allowed)))) throw new Error('Workflow color history changed');
   persisted = changes.length > 0;
   if (!allowed()) throw new Error('Canvas changed after settings save');
   native(); if (saveNative) await this.view.save();
   return true;
  } catch { new Notice(t('notifications', persisted ? 'canvasGroupColorPartial' : 'canvasGroupColorFailed')); return false; }
  finally { this.busy = false; this.sync(); }
 }

 private liveItems(choice: ColorChoice, id: string): boolean {
  return this.valid(choice) && choice.items.some(item => this.reference(item) === id && this.view.canvas.nodes.get(item.id) === item);
 }
 private async commit(choice: ColorChoice, value: string, nativeValue = value ? `#${value}` : ''): Promise<void> {
  const canvas = this.canvas;
  if (!canvas || !this.valid(choice)) return;
  this.busy = true;
  const releaseHistory = this.history?.reserve();
  const changes: ColorChange[] = [];
  let failed = false;
  try {
   canvas.requestPushHistory.run();
   if (!canvas.history.data.length) canvas.pushHistory(canvas.getData());
   const before = canvas.history.data[canvas.history.current];
   for (const [id, expected] of choice.tasks) {
    if (normalizeCanvasTaskColor(expected) === value) {
     if (this.deps.read(id) !== expected) failed = true;
     continue;
    }
    try {
     if (!this.liveItems(choice, id) || !await this.deps.write(id, expected, value, () => this.liveItems(choice, id))) { failed = true; continue; }
     changes.push({ id, before: expected, after: value });
    } catch { failed = true; }
   }
   if (!this.valid(choice)) { if (changes.length) failed = true; return; }
   let nativeChanged = false;
   for (const item of choice.items) {
    const id = this.reference(item);
    if (id) {
     if (this.view.canvas.nodes.get(item.id) !== item || !changes.some(change => change.id === id)) continue;
    } else if (!canvas.selection.has(item)) continue;
    const next = id ? value ? `#${value}` : '' : nativeValue;
    if ((item.color ?? '') !== next) { item.setColor(next); nativeChanged = true; }
   }
   if (nativeChanged || changes.length) {
    // Keep async source writes separate from any intervening native layout edits.
    canvas.requestPushHistory.run();
    const actualBefore = canvas.history.data[canvas.history.current] ?? before;
    canvas.requestSave(false);
    const after = canvas.getData();
    canvas.pushHistory(after);
    this.journal.push({ before: actualBefore, after, changes });
    try { await this.view.save(); } catch { new Notice(t('notifications', 'canvasTaskColorSaveFailed')); }
   }
  } finally {
   releaseHistory?.();
   this.busy = false;
   if (this.choice === choice) {
    const toggle = choice.panel.parentElement?.querySelector<HTMLButtonElement>('button.is-active');
    toggle?.click();
    this.choice = null;
   }
   this.sync();
   if (failed) this.notice();
  }
 }

 private async travel(entry: ColorJournal, direction: 'undo' | 'redo', native: () => void): Promise<void> {
  if (!this.valid()) { this.notice(); return; }
  if (entry.groups) { await this.travelGroups(entry, direction, native); return; }
  const file = this.view.file, path = file?.path;
  const allowed = () => this.valid() && this.view.file === file && this.view.file?.path === path;
  this.busy = true;
  let failed = false;
  try {
   // Consume the exact native step synchronously, before another layout edit can enter history.
   native();
   for (const change of entry.changes) {
    const expected = direction === 'undo' ? change.after : change.before;
    const next = direction === 'undo' ? change.before : change.after;
    try { if (!allowed() || !await this.deps.write(change.id, expected, next, allowed)) failed = true; }
    catch { failed = true; }
   }
   if (allowed()) {
    try { await this.view.save(); } catch { new Notice(t('notifications', 'canvasTaskColorSaveFailed')); }
   }
  } finally { this.busy = false; this.sync(); if (failed) this.notice(); }
 }

 onunload(): void {
  this.active = false; this.choice = null; this.journal = []; this.taskColors.clear();
  for (const restore of this.renders.values()) restore();
  this.renders.clear();
 }
}

function workflowColorKeyOrNull(group: ReturnType<typeof resolveGroupColor> | undefined): string | null {
 return group ? workflowColorKey(group.ref) : null;
}
