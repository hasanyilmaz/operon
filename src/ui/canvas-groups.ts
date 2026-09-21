import { Component, Notice, getIcon, setIcon } from 'obsidian';
import { t } from '../core/i18n';
import { getOwnerWindow } from '../core/dom-compat';
import { parseOperonGroupRule, operonGroupFields } from '../core/canvas-group-rule';
import { conflictingScalarGroups } from '../core/canvas-group-overlap';
import { groupEditSlot, groupTitleFromPool, replaceGroupEditSlot, suggestGroupFields } from '../core/canvas-group-edit';
import { openTaskFieldPicker, type TaskFieldPickerDispatchOptions } from './task-field-picker-dispatch';
import { bindPickerListItemActivation, scrollChildIntoView, repositionFloatingPanelsForAnchor } from './field-pickers/common';
import type { CanvasTaskIntegration, CanvasTaskNode, TaskCanvasView, CanvasPoint } from './canvas-task-adapter';
import type { CanvasTaskHistory } from './canvas-task-history';
import { asGroupCanvas, asGroupNode, saveCanvasGroup, type CanvasGroupNode } from './canvas-group-save';
import { CanvasTaskSaveError } from './canvas-task-insert';
import { bindOperonHoverTooltip, cleanupOperonHoverTooltips } from './operon-hover-tooltip';

import type { CanvasPropertyValuePool, PoolGroupSelection } from './canvas-property-value-pool';

function groupLabel(node: CanvasTaskNode): string { const value = node.getData().label; return typeof value === 'string' ? value : ''; }
const editingNodes = new WeakSet<CanvasTaskNode>();
export function isCanvasGroupEditing(node: CanvasTaskNode): boolean { return editingNodes.has(node); }
type Picker = (options: TaskFieldPickerDispatchOptions) => (() => void) | null;

/** A view-owned editor; provisional groups are DOM-only and cannot leak into native autosaves. */
export class CanvasGroups extends Component {
 private active = false;
 private mounted = new Map<CanvasTaskNode, () => void>();
 private closeEditor: (() => void) | null = null;
 constructor(private view: TaskCanvasView, private owner: CanvasTaskIntegration, private history: CanvasTaskHistory, private picker: Picker = openTaskFieldPicker) { super(); }
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
     if (!canvas.readonly) this.open(undefined, group);
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
   select: async value => {
    if (saving || !context.current()) return 'closed';
    if (size.width !== canvas.config.defaultFileNodeDimensions.width || size.height !== canvas.config.defaultFileNodeDimensions.height) {
     new Notice(t('taskEditor', 'canvasGroupChanged')); return 'closed';
    }
    if (this.history.isInputBusy || this.view.saving || this.view.lastSavedData === null) {
     new Notice(t('taskEditor', 'canvasGroupChanged')); return 'retry';
    }
    const title = groupTitleFromPool(value, this.settings, validation);
    if (!title) { new Notice(t('taskEditor', 'canvasGroupInvalid')); return 'retry'; }
    let id = 'operon-group-draft'; while (canvas.nodes.has(id)) id += '-';
    if (this.overlaps({ id, type: 'group', ...target.point, ...size, label: title })) {
     new Notice(t('notifications', 'canvasGroupOverlap')); return 'retry';
    }
    saving = true;
    const release = this.history.reserve();
    try { await saveCanvasGroup(target, title); return 'created'; }
    catch (cause) { new Notice(t('notifications', cause instanceof CanvasTaskSaveError ? 'canvasGroupSaveFailed' : 'canvasGroupUnavailable')); return 'closed'; }
    finally { release(); }
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
 open(point?: CanvasPoint, node?: CanvasGroupNode): void {
  if (!this.supported || this.history.isInputBusy) return;
  const target = this.owner.capture(this.view, point);
  const canvas = asGroupCanvas(this.view.canvas);
  if (!target || !canvas || !canvas.canvasEl) return;
  this.closeEditor?.();
  const baseline = node ? groupLabel(node) : '';
  const size = canvas.config.defaultFileNodeDimensions;
  const doc = this.view.contentEl.ownerDocument, win = getOwnerWindow(this.view.contentEl);
  const layer = doc.body.createDiv('operon-canvas-group-layer');
  const editor = layer.createDiv('operon-canvas-group-editor');
  editor.setAttribute('role', 'dialog'); editor.setAttribute('aria-label', t('commands', 'addOperonGroup'));
  bindOperonHoverTooltip(editor, { title: t('commands', 'addOperonGroup'), taskColor: null, constrainToVisualViewport: true });
  const input = editor.createEl('input', { attr: { type: 'text', 'aria-label': t('taskEditor', 'canvasGroupTitle'), autocomplete: 'off' } });
  input.value = node ? baseline : '{{}}';
  const error = editor.createDiv('operon-canvas-group-error'); error.setAttribute('role', 'status');
  const suggestions = editor.createDiv('operon-canvas-group-fields');
  const draft = node ? null : canvas.canvasEl.createDiv('operon-canvas-group-draft');
  if (draft) { draft.style.left = target.point.x + 'px'; draft.style.top = target.point.y + 'px'; draft.style.width = size.width + 'px'; draft.style.height = size.height + 'px'; }
  if (node) editingNodes.add(node);
  let closed = false, saving = false, frame = 0, pickerClose: (() => void) | null = null, generation = 0;
  let selected = 0, fields = suggestGroupFields('', this.settings), positionKey = '';
  const disposers: (() => void)[] = [];
  const listen = (host: EventTarget, name: string, listener: EventListener, capture = false) => {
   host.addEventListener(name, listener, capture); disposers.push(() => host.removeEventListener(name, listener, capture));
  };
  const current = () => !closed && this.active && target.isCurrent() && !canvas.readonly
   && (!node || (canvas.nodes.get(node.id) === node && groupLabel(node) === baseline));
  const stopPicker = () => { generation++; const close = pickerClose; pickerClose = null; close?.(); };
  const close = () => {
   if (closed) return; closed = true; stopPicker(); win.cancelAnimationFrame(frame);
   for (const dispose of disposers) dispose();
   if (node) editingNodes.delete(node);
   cleanupOperonHoverTooltips(editor); layer.remove(); draft?.remove();
   if (this.closeEditor === close) this.closeEditor = null;
  };
  this.closeEditor = close;
  const focus = (caret = input.value.lastIndexOf('}}')) => {
   if (!current()) return;
   input.focus(); input.setSelectionRange(Math.max(0, caret), Math.max(0, caret));
  };
  const settingsKey = () => JSON.stringify([this.settings.keyMappings, this.settings.pipelines, this.settings.priorities, this.settings.colorPalette]);
  const initialSettings = settingsKey();
  const fail = () => { error.textContent = t('taskEditor', 'canvasGroupInvalid'); };
  const commit = async (outside = false) => {
   if (saving || closed) return;
   if (!current()) { close(); return; }
   if (this.history.isInputBusy || settingsKey() !== initialSettings) { error.textContent = t('taskEditor', 'canvasGroupChanged'); return; }
   const title = input.value;
   if (!node && parseOperonGroupRule(title, this.settings, { iconExists: name => !!getIcon(name) }).state !== 'valid') {
    if (outside) close(); else fail(); return;
   }
   let draftId = 'operon-group-draft'; while (canvas.nodes.has(draftId)) draftId += '-';
   if (this.overlaps(node ? { ...node.getData(), label: title } : { id: draftId, type: 'group', ...target.point, ...size, label: title })) {
    error.textContent = t('notifications', 'canvasGroupOverlap'); new Notice(error.textContent);
    if (outside) close(); return;
   }
   saving = true; stopPicker(); input.disabled = true;
   const release = this.history.reserve();
   try { await saveCanvasGroup(target, title, node ? { node, label: baseline } : undefined); }
   catch (cause) { new Notice(t('notifications', cause instanceof CanvasTaskSaveError ? 'canvasGroupSaveFailed' : 'canvasGroupUnavailable')); }
   finally { release(); close(); }
  };
  const renderSuggestions = () => {
   suggestions.replaceChildren(); selected = 0;
   const match = /^\s*\{\{([^:{}]*)\}\}\s*$/.exec(input.value);
   fields = match ? suggestGroupFields(match[1], this.settings) : [];
   suggestions.hidden = !match;
   fields.forEach((field, index) => {
    const button = suggestions.createEl('button', { cls: 'operon-canvas-group-field', attr: { type: 'button' } });
    setIcon(button.createSpan('operon-canvas-group-field-icon'), field.icon);
    button.createSpan({ cls: 'operon-canvas-group-field-label', text: field.label });
    if (field.label !== field.key) button.createEl('small', { text: field.key });
    button.classList.toggle('is-active', index === selected);
    bindPickerListItemActivation(button, () => selectField(index), { stopPropagation: true });
   });
  };
  const openPicker = () => {
   if (!current() || saving || pickerClose) return;
   const caret = input.selectionStart ?? input.value.lastIndexOf('}}'), title = input.value;
   const slot = groupEditSlot(title, caret, this.settings);
   if (!slot) return;
   const id = ++generation, signature = settingsKey();
   const finish = () => {
    if (generation !== id || closed) return;
    pickerClose = null; focus(caret);
   };
   const applyValues = (values: readonly string[]) => {
     if (generation !== id || !current() || input.value !== title || signature !== settingsKey()) { stopPicker(); if (current()) fail(); return; }
     const next = replaceGroupEditSlot(title, caret, values, this.settings, { iconExists: name => !!getIcon(name) });
     stopPicker();
     if (!next) { fail(); focus(caret); return; }
     input.value = next.title; error.textContent = ''; renderSuggestions(); focus(next.caret);
     if (slot.field.type === 'text' && parseOperonGroupRule(next.title, this.settings, { iconExists: name => !!getIcon(name) }).state === 'valid') void commit();

   };
   const returned = this.picker({
    app: this.owner.deps.app, settings: this.settings, allTasks: this.owner.deps.cards.getAllTasks(),
    canonicalKey: slot.field.key, anchor: input, currentFieldValues: { [slot.field.key]: slot.value },
    currentTags: slot.field.key === 'tags' && slot.value ? [slot.value.replace(/^#+/, '')] : [], sourcePath: target.path,
    closeListPickerOnSelect: true,
    onCommit: payload => { const value = payload[slot.field.key]; applyValues(Array.isArray(value) ? value : typeof value === 'string' ? [value] : []); },
    currentListValues: slot.field.type === 'list' ? (slot.value ? [slot.value] : []) : undefined,
    onCommitListValues: (_key, values) => applyValues(values),
    onCancel: finish, onClose: finish,
   });
   if (generation === id && !closed) pickerClose = returned; else returned?.();
  };
  const selectField = (index: number) => {
   const field = fields[index]; if (!field || !current()) return;
   input.value = '{{' + field.key + ':: }}'; error.textContent = ''; renderSuggestions(); focus(); openPicker();
  };
  const keydown = (event: KeyboardEvent) => {
   if (!layer.contains(event.target as Node) || event.isComposing || Reflect.get(event, 'keyCode') === 229) return;
   if (event.key === 'Escape') {
    event.preventDefault(); event.stopImmediatePropagation();
    if (pickerClose) { stopPicker(); focus(); } else close();
    return;
   }
   if (event.target !== input || pickerClose) return;
   if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault(); event.stopImmediatePropagation();
    if (!fields.length) { openPicker(); return; }
    selected = Math.max(0, Math.min(fields.length - 1, selected + (event.key === 'ArrowDown' ? 1 : -1)));
    Array.from(suggestions.children).forEach((child, index) => child.classList.toggle('is-active', index === selected));
    scrollChildIntoView(suggestions, suggestions.querySelectorAll<HTMLElement>('button')[selected]); return;
   }
   if (event.key === 'Enter') { event.preventDefault(); event.stopImmediatePropagation(); if (fields.length) selectField(selected); else void commit(); }
  };
  listen(doc, 'keydown', keydown, true);
  listen(layer, 'keydown', event => event.stopPropagation());
  listen(doc, 'pointerdown', event => { if (!layer.contains(event.target as Node)) void commit(true); }, true);
  listen(input, 'input', event => {
   if ((event as InputEvent).isComposing) return;
   error.textContent = ''; renderSuggestions();
   const caret = input.selectionStart ?? 0;
   const slot = groupEditSlot(input.value, caret, this.settings);
   if (input.value.slice(0, caret).trimEnd().endsWith(';') && slot?.field.type === 'list' && !slot.value) openPicker();
  });
  listen(input, 'compositionend', () => renderSuggestions());
  listen(input, 'dblclick', () => openPicker());
  listen(win, 'blur', () => { if (!saving) close(); });
  const position = () => {
   if (!saving && !current()) { close(); return; }
   if (closed) return;
   const viewport = win.visualViewport;
   const x = viewport?.offsetLeft ?? 0, y = viewport?.offsetTop ?? 0, width = viewport?.width ?? win.innerWidth, height = viewport?.height ?? win.innerHeight;
   const rect = node?.labelEl?.getBoundingClientRect() ?? draft?.getBoundingClientRect();
   if (!rect || (node && !node.nodeEl.isConnected)) { close(); return; }
   const editorWidth = Math.min(300, Math.max(1, width - 16));
   const left = Math.max(8, Math.min(rect.left - x, width - editorWidth - 8));
   const top = Math.max(8, Math.min(rect.top - y, height - Math.min(editor.offsetHeight || 48, height - 16) - 8));
   const key = [x,y,width,height,left,top,editorWidth].join(':');
   if (key !== positionKey) {
    positionKey = key; layer.style.left = x + 'px'; layer.style.top = y + 'px'; layer.style.width = width + 'px'; layer.style.height = height + 'px';
    editor.style.left = left + 'px'; editor.style.top = top + 'px'; editor.style.width = editorWidth + 'px';
    repositionFloatingPanelsForAnchor(input);
   }
   frame = win.requestAnimationFrame(position);
  };
  renderSuggestions(); focus(); position();
 }
 onunload(): void { this.active = false; this.closeEditor?.(); for (const restore of this.mounted.values()) restore(); this.mounted.clear(); }
}
