import { Component, Notice, getIcon } from 'obsidian';
import { t } from '../core/i18n';
import { getOwnerWindow } from '../core/dom-compat';
import { operonGroupFields } from '../core/canvas-group-rule';
import { conflictingScalarGroups } from '../core/canvas-group-overlap';
import { appendGroupValue, groupTitleFromPool } from '../core/canvas-group-edit';
import type { CanvasTaskIntegration, CanvasTaskNode, TaskCanvasView, CanvasPoint, CanvasTaskTarget } from './canvas-task-adapter';
import type { CanvasTaskHistory } from './canvas-task-history';
import { asGroupCanvas, asGroupNode, saveCanvasGroup, type CanvasGroupNode } from './canvas-group-save';
import { CanvasTaskSaveError } from './canvas-task-insert';
import { bindOperonHoverTooltip, cleanupOperonHoverTooltips } from './operon-hover-tooltip';

import { groupSyncRectangle } from '../core/canvas-group-layout';
import type { PropertyPoolFavorite } from '../core/property-value-pool';
import type { CanvasPropertyValuePool, PoolGroupSelection } from './canvas-property-value-pool';

function groupLabel(node: CanvasTaskNode): string { const value = node.getData().label; return typeof value === 'string' ? value : ''; }
const editingNodes = new WeakSet<CanvasTaskNode>();
export function isCanvasGroupEditing(node: CanvasTaskNode): boolean { return editingNodes.has(node); }

/** A view-owned editor; provisional groups are DOM-only and cannot leak into native autosaves. */
export class CanvasGroups extends Component {
 private active = false;
 private mounted = new Map<CanvasTaskNode, () => void>();
 private closeEditor: (() => void) | null = null;
 constructor(private view: TaskCanvasView, private owner: CanvasTaskIntegration, private history: CanvasTaskHistory) { super(); }
 private get settings() { return this.owner.deps.cards.deps.getSettings(); }
 get supported(): boolean { return this.active && this.history.supported && !!asGroupCanvas(this.view.canvas); }
 onload(): void { this.active = true; this.sync(); }
 sync(): void {
  if (!this.active) return;
  const canvas = this.view.canvas;
  for (const [node, restore] of this.mounted) if (canvas.nodes.get(node.id) !== node) { restore(); this.mounted.delete(node); }
  if (!this.supported) return;
  for (const node of canvas.nodes.values()) {
   const group = asGroupNode(node);
   if (!group || this.mounted.has(node)) continue;
   const original = Reflect.get(group, 'focusLabel'), descriptor = Object.getOwnPropertyDescriptor(group, 'focusLabel');
   const wrapper = () => {
    if (this.active && groupLabel(group).includes('{{')) {
     if (!canvas.readonly) this.open(group);
    } else Reflect.apply(original, group, []);
   };
   group.focusLabel = wrapper;
   const blurLabel: unknown = Reflect.get(group, 'blurLabel'), labelDescriptor = Object.getOwnPropertyDescriptor(group, 'blurLabel');
   const guardedBlur = () => {
    const label = group.labelEl?.textContent ?? groupLabel(group);
    if (this.active && label !== groupLabel(group) && this.overlaps({ ...group.getData(), label })) {
     if (group.labelEl) group.labelEl.textContent = groupLabel(group);
     new Notice(t('notifications', 'canvasGroupOverlap'));
    }
    if (typeof blurLabel === 'function') Reflect.apply(blurLabel, group, []);
   };
   if (typeof blurLabel === 'function') Reflect.set(group, 'blurLabel', guardedBlur);
   this.mounted.set(node, () => {
    if (group.focusLabel === wrapper) {
     if (descriptor) Object.defineProperty(group, 'focusLabel', descriptor); else Reflect.deleteProperty(group, 'focusLabel');
    }
    if (Reflect.get(group, 'blurLabel') === guardedBlur) {
     if (labelDescriptor) Object.defineProperty(group, 'blurLabel', labelDescriptor); else Reflect.deleteProperty(group, 'blurLabel');
    }
   });
  }
 }
 private overlaps(candidate: Record<string, unknown>): boolean {
  const before = [...this.view.canvas.nodes.values()].map(node => node.getData()).filter(data => data.type === 'group');
  return !!conflictingScalarGroups(before, [...before.filter(data => data.id !== candidate.id), candidate], this.settings, { iconExists: name => !!getIcon(name) });
 }
 private creating = false;
 private groupAt(point: CanvasPoint) {
  return [...this.view.canvas.nodes.values()].flatMap(node => {
   const data = node.getData(), rect = data.type === 'group' ? groupSyncRectangle(data) : null;
   return rect && point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height ? [{ node, rect }] : [];
  }).sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height || (a.node.id < b.node.id ? -1 : a.node.id > b.node.id ? 1 : 0))[0] ?? null;
 }
 private groupCurrent(target: CanvasTaskTarget, sourceCurrent: () => boolean, reserved: boolean): boolean {
  return sourceCurrent() && target.isCurrent() && this.view.canvas === target.canvas && this.view.file === target.file && target.file.path === target.path
   && this.supported && !target.canvas.readonly && (reserved || !this.history.isInputBusy) && !this.view.saving && this.view.lastSavedData !== null;
 }
 preparePoolDrop(value: PropertyPoolFavorite, point: CanvasPoint, sourceCurrent: () => boolean) {
  const found = this.groupAt(point);
  if (!found) { const created = this.prepareCreate(value, point, sourceCurrent, true); return created ? { ...created, node: null } : null; }
  const { node, rect } = found, target = this.owner.capture(this.view, point);
  if (!target) return null;
  const label = groupLabel(node), validation = { iconExists: (name: string) => !!getIcon(name) };
  const appended = appendGroupValue(label, value, this.settings, validation), editable = asGroupNode(node);
  const current = (reserved = false) => {
   const fresh = groupSyncRectangle(node.getData()), smallest = this.groupAt(point);
   return this.groupCurrent(target, sourceCurrent, reserved) && target.canvas.nodes.get(node.id) === node && groupLabel(node) === label
    && !!fresh && fresh.x === rect.x && fresh.y === rect.y && fresh.width === rect.width && fresh.height === rect.height
    && smallest?.node === node && !node.isEditing && !isCanvasGroupEditing(node) && !editable?.labelEl?.isContentEditable;
  };
  const reason = (reserved = false) => {
   if (!current(reserved)) return t('notifications', 'canvasGroupUnavailable');
   const freshAppend = appendGroupValue(label, value, this.settings, validation);
   if (!editable || !appended || !freshAppend || freshAppend.title !== appended.title || freshAppend.added !== appended.added) return t('settings', 'propertyPoolGroupListOnly');
   return appended.added ? null : t('settings', 'propertyPoolAlreadyPresent');
  };
  return { node, point: { ...point }, size: { width: rect.width, height: rect.height }, title: appended?.title ?? label, reason, current,
   commit: () => this.commitGroup(target, appended?.title ?? null, reason, editable ? { node: editable, label } : undefined) };
 }
 prepareCreate(value: PropertyPoolFavorite, point: CanvasPoint, sourceCurrent: () => boolean, empty = false) {
  const target = this.owner.capture(this.view, point), canvas = asGroupCanvas(this.view.canvas);
  if (!target || !canvas || !this.supported) return null;
  const size = { ...canvas.config.defaultFileNodeDimensions };
  const title = groupTitleFromPool(value, this.settings, { iconExists: name => !!getIcon(name) });
  const reason = (reserved = false) => {
   if (!this.groupCurrent(target, sourceCurrent, reserved)
    || size.width !== canvas.config.defaultFileNodeDimensions.width || size.height !== canvas.config.defaultFileNodeDimensions.height) return t('taskEditor', 'canvasGroupChanged');
   if (!title || groupTitleFromPool(value, this.settings, { iconExists: name => !!getIcon(name) }) !== title) return t('taskEditor', 'canvasGroupInvalid');
   if (empty && [...canvas.nodes.values()].some(node => {
    const data = node.getData();
    const x = Number(data.x), y = Number(data.y), width = Number(data.width), height = Number(data.height);
    return ![x, y, width, height].every(Number.isFinite) || width < 0 || height < 0
     || (point.x < x + width && point.x + size.width > x && point.y < y + height && point.y + size.height > y);
   })) return t('settings', 'propertyPoolGroupAreaOccupied');
   let id = 'operon-group-draft'; while (canvas.nodes.has(id)) id += '-';
   return this.overlaps({ id, type: 'group', ...point, ...size, label: title }) ? t('notifications', 'canvasGroupOverlap') : null;
  };
  return { point: { ...point }, size, title, reason, commit: () => this.commitGroup(target, title, reason) };
 }
 private async commitGroup(target: CanvasTaskTarget, title: string | null, reason: (reserved?: boolean) => string | null, existing?: { node: CanvasGroupNode; label: string }): Promise<'created' | 'retry' | 'closed'> {
  const blocked = reason();
  if (blocked || this.creating || title === null) { if (blocked) new Notice(blocked); return 'retry'; }
  this.creating = true;
  const release = this.history.reserve();
  try {
   await saveCanvasGroup(target, title, existing, () => !reason(true));
   if (existing && target.isCurrent() && target.canvas.nodes.get(existing.node.id) === existing.node) target.canvas.selectOnly(existing.node);
   return 'created';
  }
  catch (cause) { new Notice(t('notifications', cause instanceof CanvasTaskSaveError ? 'canvasGroupSaveFailed' : 'canvasGroupUnavailable')); return 'closed'; }
  finally { release(); this.creating = false; }
 }
 openCreate(pool: CanvasPropertyValuePool, point?: CanvasPoint): void {
  if (!this.supported || this.history.isInputBusy) return;
  const target = this.owner.capture(this.view, point), canvas = asGroupCanvas(this.view.canvas);
  if (!target || !canvas || !canvas.canvasEl) return;
  this.closeEditor?.();
  const size = { ...canvas.config.defaultFileNodeDimensions };
  const validation = { iconExists: (name: string) => !!getIcon(name) };
  const draft = canvas.canvasEl.createDiv('operon-canvas-group-draft');
  Object.assign(draft.style, { left: target.point.x + 'px', top: target.point.y + 'px', width: size.width + 'px', height: size.height + 'px' });
  const win = getOwnerWindow(this.view.contentEl);
  let closed = false, saving = false, frame = 0;
  const context: PoolGroupSelection = {
   current: () => !closed && this.active && target.isCurrent() && !canvas.readonly,
   supports: key => operonGroupFields(this.settings).some(field => field.key === key),
   accepts: value => !!groupTitleFromPool(value, this.settings, validation),
   select: async (value, sourceCurrent) => {
    if (saving || !context.current()) return 'closed';
    if (size.width !== canvas.config.defaultFileNodeDimensions.width || size.height !== canvas.config.defaultFileNodeDimensions.height) {
     new Notice(t('taskEditor', 'canvasGroupChanged')); return 'closed';
    }
    if (this.history.isInputBusy || this.view.saving || this.view.lastSavedData === null) {
     new Notice(t('taskEditor', 'canvasGroupChanged')); return 'retry';
    }
    const prepared = this.prepareCreate(value, target.point, () => context.current() && sourceCurrent());
    if (!prepared) return 'closed';
    saving = true;
    try { return await prepared.commit(); } finally { saving = false; }
   },
   close: () => { closed = true; win.cancelAnimationFrame(frame); draft.remove(); if (this.closeEditor === close) this.closeEditor = null; },
  };
  const close = () => { pool.cancelGroup(context); context.close(); };
  this.closeEditor = close;
  const tick = () => {
   if (!context.current()) { close(); return; }
   frame = win.requestAnimationFrame(tick);
  };
  if (!pool.openForGroup(context)) { close(); return; }
  tick();
 }
 open(node: CanvasGroupNode): void {
  if (!this.supported || this.history.isInputBusy || this.creating) return;
  const target = this.owner.capture(this.view), canvas = asGroupCanvas(this.view.canvas);
  const rect = groupSyncRectangle(node.getData());
  if (!target || !canvas || !rect || canvas.nodes.get(node.id) !== node) return;
  this.closeEditor?.();
  const baseline = groupLabel(node);
  const doc = this.view.contentEl.ownerDocument, win = getOwnerWindow(this.view.contentEl);
  const layer = doc.body.createDiv('operon-canvas-group-layer');
  const editor = layer.createDiv('operon-canvas-group-editor');
  editor.setAttribute('role', 'dialog'); editor.setAttribute('aria-label', t('taskEditor', 'canvasGroupTitle'));
  bindOperonHoverTooltip(editor, { title: t('taskEditor', 'canvasGroupTitle'), taskColor: null, constrainToVisualViewport: true });
  const input = editor.createEl('input', { attr: { type: 'text', 'aria-label': t('taskEditor', 'canvasGroupTitle'), autocomplete: 'off' } });
  input.value = baseline;
  const error = editor.createDiv('operon-canvas-group-error'); error.setAttribute('role', 'status');
  editingNodes.add(node);
  let closed = false, saving = false, frame = 0, positionKey = '';
  const disposers: (() => void)[] = [];
  const listen = (host: EventTarget, name: string, listener: EventListener, capture = false) => {
   host.addEventListener(name, listener, capture); disposers.push(() => host.removeEventListener(name, listener, capture));
  };
  const settingsKey = () => JSON.stringify([this.settings.keyMappings, this.settings.pipelines, this.settings.priorities, this.settings.colorPalette]);
  const initialSettings = settingsKey();
  const current = () => {
   const fresh = groupSyncRectangle(node.getData());
   return !closed && this.active && target.isCurrent() && this.view.canvas === canvas && this.view.file === target.file && target.file.path === target.path
    && !canvas.readonly && canvas.nodes.get(node.id) === node && node.getData().type === 'group' && groupLabel(node) === baseline
    && !!fresh && fresh.x === rect.x && fresh.y === rect.y && fresh.width === rect.width && fresh.height === rect.height;
  };
  const close = () => {
   if (closed) return; closed = true; win.cancelAnimationFrame(frame);
   for (const dispose of disposers) dispose();
   editingNodes.delete(node);
   cleanupOperonHoverTooltips(editor); layer.remove();
   if (this.closeEditor === close) this.closeEditor = null;
  };
  this.closeEditor = close;
  const commit = async (outside = false) => {
   if (saving || closed) return;
   if (!current()) { close(); return; }
   const title = input.value;
   if (title === baseline) { close(); return; }
   const reason = (reserved = false) => {
    if (!this.groupCurrent(target, current, reserved) || settingsKey() !== initialSettings) return t('taskEditor', 'canvasGroupChanged');
    return this.overlaps({ ...node.getData(), label: title }) ? t('notifications', 'canvasGroupOverlap') : null;
   };
   const blocked = reason();
   if (blocked) { error.textContent = blocked; if (outside) { new Notice(blocked); close(); } return; }
   saving = true; input.disabled = true;
   try {
    const result = await this.commitGroup(target, title, reason, { node, label: baseline });
    if (result !== 'retry' || outside) close();
   } finally { saving = false; input.disabled = false; }
  };
  listen(doc, 'keydown', event => {
   const key = event as KeyboardEvent;
   if (saving || !layer.contains(key.target as Node) || key.isComposing || Reflect.get(key, 'keyCode') === 229) return;
   if (key.key === 'Escape') { key.preventDefault(); key.stopImmediatePropagation(); close(); }
   else if (key.target === input && key.key === 'Enter') { key.preventDefault(); key.stopImmediatePropagation(); void commit(); }
  }, true);
  listen(layer, 'keydown', event => event.stopPropagation());
  listen(doc, 'pointerdown', event => { if (!layer.contains(event.target as Node)) void commit(true); }, true);
  listen(input, 'input', () => { error.textContent = ''; });
  listen(win, 'blur', () => { if (!saving) close(); });
  const position = () => {
   if (!saving && !current()) { close(); return; }
   if (closed) return;
   const viewport = win.visualViewport;
   const x = viewport?.offsetLeft ?? 0, y = viewport?.offsetTop ?? 0, width = viewport?.width ?? win.innerWidth, height = viewport?.height ?? win.innerHeight;
   const rect = node.labelEl?.getBoundingClientRect();
   if (!rect || !node.nodeEl.isConnected) { close(); return; }
   const editorWidth = Math.min(300, Math.max(1, width - 16));
   const left = Math.max(8, Math.min(rect.left - x, width - editorWidth - 8));
   const top = Math.max(8, Math.min(rect.top - y, height - Math.min(editor.offsetHeight || 48, height - 16) - 8));
   const key = [x,y,width,height,left,top,editorWidth].join(':');
   if (key !== positionKey) {
    positionKey = key; layer.style.left = x + 'px'; layer.style.top = y + 'px'; layer.style.width = width + 'px'; layer.style.height = height + 'px';
    editor.style.left = left + 'px'; editor.style.top = top + 'px'; editor.style.width = editorWidth + 'px';
   }
   frame = win.requestAnimationFrame(position);
  };
  input.focus();
  const caret = Math.max(0, input.value.lastIndexOf('}}')); input.setSelectionRange(caret, caret);
  position();
 }
 onunload(): void { this.active = false; this.closeEditor?.(); for (const restore of this.mounted.values()) restore(); this.mounted.clear(); }
}
