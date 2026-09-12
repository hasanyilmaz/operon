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
interface ColorJournal { before: unknown; after: unknown; changes: ColorChange[] }
interface ColorChoice {
 panel: HTMLElement; items: ColorItem[]; tasks: Map<string, string>;
 file: TaskCanvasView['file']; path: string; preview: string | null;
}
interface ColorDependencies {
 read(id: string): string | null;
 write(id: string, expected: string, next: string, allowed: () => boolean): Promise<boolean>;
 subscribe(callback: () => void): () => void;
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
  this.register(this.deps.subscribe(() => this.sync()));
  this.sync();
 }

 private notice(): void { new Notice(t('notifications', 'canvasTaskColorFailed')); }
 private valid(choice?: ColorChoice): boolean {
  return this.active && this.deps.isCurrent() && this.view.canvas === this.canvas && !this.view.canvas.readonly
   && !!this.view.file && (!choice || this.view.file === choice.file && this.view.file.path === choice.path);
 }
 private reference(item: ColorItem): string | null { return readCanvasTaskReference(item.getData())?.taskId ?? null; }
 private color(item: ColorItem): string | null {
  const id = this.reference(item);
  return id ? this.deps.read(id) : null;
 }
 private project(item: ColorItem): void {
  if (!this.active || !item.nodeEl) return;
  const value = this.choice?.preview !== null && this.choice?.items.includes(item)
   ? this.choice.preview : this.color(item);
  if (value === null || value === undefined) return;
  const color = normalizeTaskFieldColor(value);
  const css = color ?? 'var(--background-modifier-border)';
  if (item.nodeEl.style.getPropertyValue('--canvas-color') !== css) item.nodeEl.style.setProperty('--canvas-color', css);
  item.nodeEl.classList.toggle('is-themed', !!color);
 }

 sync(): void {
  if (!this.active) return;
  for (const [item, restore] of this.renders) {
   if (this.view.canvas.nodes.get(item.id) !== item || !this.reference(item)) { restore(); this.renders.delete(item); }
  }
  for (const node of this.view.canvas.nodes.values()) {
   const item = node as unknown as ColorItem;
   if (!this.reference(item) || !item.nodeEl || typeof item.render !== 'function' || typeof item.setColor !== 'function') continue;
   if (!this.renders.has(item)) {
    const original: () => void = Reflect.get(item, 'render');
    const descriptor = Object.getOwnPropertyDescriptor(item, 'render');
    let mounted = true;
    const wrapper = () => { original.call(item); if (mounted) this.project(item); };
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
   if (tasks.size) {
    this.choice = { panel, items, tasks, file: this.view.file, path: this.view.file?.path ?? '', preview: null };
    const colors = [...tasks.values()].map(normalizeCanvasTaskColor);
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
  if (event.type === 'focusout') { choice.preview = null; for (const node of choice.items) this.project(node); return; }
  if (event.type === 'click' && (input || item.classList.contains('canvas-color-picker-custom'))) return;
  event.preventDefault(); event.stopImmediatePropagation();
  if (!this.valid(choice) || this.busy || !this.canvas) { this.notice(); return; }
  const slot = Array.from(item.classList).find(name => /^mod-canvas-color-[1-6]$/.test(name))?.slice(-1) ?? '';
  const value = resolveCanvasTaskColor(input?.value ?? slot, choice.panel);
  if (value === null) { this.notice(); return; }
  if (event.type === 'input') {
   choice.preview = value;
   for (const node of choice.items) if (this.reference(node)) this.project(node);
  } else {
   choice.preview = null;
   void this.commit(choice, value, input?.value ?? slot);
  }
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
  this.active = false; this.choice = null; this.journal = [];
  for (const restore of this.renders.values()) restore();
  this.renders.clear();
 }
}
