import { Component, Notice, setIcon } from 'obsidian';
import { getOwnerWindow } from '../core/dom-compat';
import { t } from '../core/i18n';
import { resolveTaskColorSource, resolveTaskStatusIconColor } from '../core/task-color-source';
import { formatUiDate } from '../core/ui-date-format';
import { resolveTaskDisplayIcon } from '../types/settings';
import { normalizeTaskCardSettings } from '../types/task-card';
import type { IndexedTask } from '../types/fields';
import { canvasTaskPoolBatch, CANVAS_TASK_POOL_SEARCH_DELAY, queryCanvasTaskPool, type CanvasTaskPoolMode } from '../systems/canvas-task-pool';
import type { CanvasTaskIntegration, CanvasTaskTarget, TaskCanvasView } from './canvas-task-adapter';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { bindOperonHoverTooltip, cleanupOperonHoverTooltips } from './operon-hover-tooltip';
import { TaskCardControls } from './task-card-controls';
import { renderCompactTaskMarkdown } from './compact-task-markdown-renderer';
import { createTaskNoteActionButton, showTaskNotePopover } from './task-note-action';

/** A Canvas-owned, unscaled palette. No Calendar renderer, preset or leaf state is used. */
export class CanvasTaskPool extends Component {
 private button: HTMLButtonElement | null = null;
 private group: HTMLElement | null = null;
 private panel: HTMLElement | null = null;
 private list: HTMLElement | null = null;
 private summary: HTMLElement | null = null;
 private session: Component | null = null;
 private rows: Component | null = null;
 private mode: CanvasTaskPoolMode = 'all';
 private query = '';
 private limit = 25;
 private timer: number | null = null;
 private cancelDrag: (() => void) | null = null;
 private active = false;
 private busy = false;
 private signature = '';
 private panelFile: TaskCanvasView['file'] = null;
 private sessionNumber = 0;
 private source: IndexedTask[] | null = null;
 private matches: IndexedTask[] = [];
 private queryKey = '';
 private settingsSnapshot: unknown = null;
 private settingsKey = '';
 private readiness = '';
 private readonly closeOnEscape = (): void => { this.close(); this.button?.focus({ preventScroll: true }); };
 constructor(private view: TaskCanvasView, private owner: CanvasTaskIntegration) { super(); }
 private get cards() { return this.owner.deps.cards; }
 private get win() { return getOwnerWindow(this.view.contentEl); }
 private readonly canMutate = (): boolean => this.active && !!this.panel?.isConnected && this.owner.isCurrent(this.view) && !this.view.canvas.readonly;
 onload(): void {
  this.active = true;
  this.register(this.cards.onRefresh(() => { this.settingsSnapshot = null; this.refresh(); }));
  this.sync();
 }
 sync(): void {
  if (!this.active) return;
  const controls = this.view.canvas.canvasControlsEl;
  if (!controls?.isConnected || !this.view.canvas.wrapperEl?.isConnected || typeof this.view.canvas.posFromClient !== 'function') { this.close(); this.group?.remove(); return; }
  if (!this.group || !controls.contains(this.group)) {
   if (this.button) cleanupOperonHoverTooltips(this.button);
   this.group?.remove();
   this.group = controls.createDiv('canvas-control-group mod-raised operon-canvas-task-pool-tools');
   this.button = this.group.createEl('button', { cls: 'canvas-control-item', attr: { type: 'button', 'aria-expanded': 'false' } });
   setIcon(this.button, 'list-todo'); setAccessibleLabelWithoutTooltip(this.button, t('calendar', 'taskPool'));
   bindOperonHoverTooltip(this.button, { title: t('calendar', 'taskPool'), taskColor: null, shouldOpen: () => !this.panel });
   this.button.onclick = event => { event.stopPropagation(); if (this.panel) this.close(); else this.open(); };
  }
  this.refresh();
 }
 private open(): void {
  if (!this.owner.isCurrent(this.view) || !this.button) return;
  this.panelFile = this.view.file;
  this.mode = 'all'; this.query = ''; this.limit = 25; this.signature = ''; this.sessionNumber++;
  const session = this.session = new Component(); this.addChild(session);
  const panel = this.panel = this.view.contentEl.ownerDocument.body.createDiv('operon-canvas-task-pool');
  panel.setAttribute('role', 'dialog'); setAccessibleLabelWithoutTooltip(panel, t('calendar', 'taskPool'));
  this.button.setAttribute('aria-expanded', 'true');
  const header = panel.createDiv('operon-canvas-task-pool-header'); header.createEl('strong', { text: t('calendar', 'taskPool') });
  const close = header.createEl('button', { attr: { type: 'button' } }); setIcon(close, 'x'); setAccessibleLabelWithoutTooltip(close, t('settings', 'canvasTaskPoolClose'));
  session.registerDomEvent(close, 'click', this.closeOnEscape);
  const modes = panel.createDiv('operon-canvas-task-pool-modes');
  for (const mode of ['overdue', 'unscheduled', 'all', 'finished'] as const) {
   const button = modes.createEl('button', { text: t('calendar', mode), attr: { type: 'button', 'aria-pressed': String(mode === this.mode) } });
   session.registerDomEvent(button, 'click', () => {
    this.mode = mode; this.limit = canvasTaskPoolBatch(this.query); this.signature = '';
    for (const other of Array.from(modes.children)) other.setAttribute('aria-pressed', String(other === button));
    this.flushSearch();
   });
  }
  const search = panel.createEl('input', { cls: 'operon-canvas-task-pool-search', attr: { type: 'search', placeholder: t('calendar', 'searchAllTasks'), spellcheck: 'false' } });
  setAccessibleLabelWithoutTooltip(search, t('calendar', 'searchAllTasks'));
  session.registerDomEvent(search, 'input', () => {
   this.query = search.value; this.limit = canvasTaskPoolBatch(this.query); this.clearTimer();
   this.timer = this.win.setTimeout(() => { this.timer = null; this.flushSearch(); }, CANVAS_TASK_POOL_SEARCH_DELAY);
  });
  this.list = panel.createDiv('operon-canvas-task-pool-list');
  this.summary = panel.createDiv('operon-canvas-task-pool-summary'); this.summary.setAttribute('role', 'status');
  session.registerDomEvent(this.list, 'scroll', () => {
   const list = this.list;
   if (list && list.scrollTop + list.clientHeight >= list.scrollHeight - 48 && Number(list.dataset.total) > this.limit) { this.limit += canvasTaskPoolBatch(this.query); this.refresh(); }
  });
  session.registerDomEvent(panel, 'pointerdown', event => event.stopPropagation());
  session.registerDomEvent(panel.ownerDocument, 'pointerdown', event => {
   const target = event.target as HTMLElement;
   if (this.cancelDrag || panel.contains(target) || this.group?.contains(target) || target.closest?.('.operon-contextual-hover-menu, .operon-text-field-popover-panel, .operon-floating-panel, .operon-field-picker')) return;
   this.close();
  });
  session.registerDomEvent(panel.ownerDocument, 'keydown', event => {
   if (event.key !== 'Escape' || event.defaultPrevented || (event.target as HTMLElement)?.closest?.('.operon-contextual-hover-menu, .operon-text-field-popover-panel')) return;
   event.preventDefault(); this.closeOnEscape();
  });
  session.registerDomEvent(this.win, 'resize', () => this.position());
  const Resize = (this.win as Window & { ResizeObserver: typeof ResizeObserver }).ResizeObserver;
  const observer = new Resize(() => this.position()); observer.observe(this.view.contentEl); session.register(() => observer.disconnect());
  this.refresh(); search.focus({ preventScroll: true });
 }
 private clearTimer(): void { if (this.timer !== null) this.win.clearTimeout(this.timer); this.timer = null; }
 private flushSearch(): void { this.clearTimer(); if (this.list) this.list.scrollTop = 0; this.signature = ''; this.refresh(); }
 private position(): void {
  if (!this.panel || !this.button) return;
  const bounds = this.view.contentEl.getBoundingClientRect(), anchor = this.button.getBoundingClientRect();
  const settings = normalizeTaskCardSettings(this.cards.deps.getSettings());
  const width = Math.max(0, Math.min(settings.canvasTaskPoolWidth, bounds.width - 16, this.win.innerWidth - 16));
  this.panel.style.width = `${width}px`;
  this.panel.style.maxHeight = `${Math.max(0, Math.min(bounds.height, this.win.innerHeight) - 16)}px`;
  this.panel.style.setProperty('--operon-canvas-task-pool-rows', String(settings.canvasTaskPoolRows));
  const left = Math.max(8, bounds.left + 8, Math.min(anchor.left - width - 8, bounds.right - width - 8));
  const top = Math.max(8, bounds.top + 8, Math.min(anchor.top, bounds.bottom - this.panel.offsetHeight - 8, this.win.innerHeight - this.panel.offsetHeight - 8));
  this.panel.style.left = `${left}px`; this.panel.style.top = `${top}px`;
 }
 private refresh(): void {
  if (!this.panel || !this.list || !this.summary) return;
  if (!this.owner.isCurrent(this.view) || this.view.file !== this.panelFile) { this.close(); return; }
  this.position();
  if (this.cancelDrag || this.timer !== null) return;
  const state = this.cards.deps.getIndexState();
  const settings = this.cards.deps.getSettings();
  const source = this.cards.getAllTasks();
  const queryKey = `${this.mode}:${this.query}:${new Date().toDateString()}`;
  if (source !== this.source || queryKey !== this.queryKey || state !== this.readiness) {
   this.source = source; this.queryKey = queryKey; this.readiness = state;
   this.matches = state === 'ready' ? queryCanvasTaskPool(source, this.mode, this.query) : [];
  }
  const matches = this.matches;
  if (settings !== this.settingsSnapshot) { this.settingsSnapshot = settings; this.settingsKey = JSON.stringify(settings); }
  const visible = matches.slice(0, this.limit);
  const signature = JSON.stringify([state, matches.length, visible, this.mode, this.query, this.limit, this.view.canvas.readonly, this.settingsKey]);
  if (signature === this.signature) return;
  this.signature = signature;
  const scroll = this.list.scrollTop;
  if (this.rows) this.removeChild(this.rows);
  cleanupOperonHoverTooltips(this.list); this.list.empty();
  this.rows = new Component(); this.addChild(this.rows);
  for (const task of visible) this.renderRow(task, this.list, this.rows);
  if (!visible.length) this.list.createDiv({ cls: 'operon-canvas-task-pool-empty', text: state === 'ready' ? t('calendar', 'noSearchMatches') : t('errors', state === 'loading' ? 'taskCard_loading' : 'taskCard_error') });
  this.list.dataset.total = String(matches.length); this.list.scrollTop = scroll;
  this.summary.setText(t('settings', 'canvasTaskPoolSummary', { visible: String(visible.length), total: String(matches.length) }));
  this.position();
 }
 private renderRow(task: IndexedTask, list: HTMLElement, lifetime: Component): void {
  const row = list.createDiv('operon-canvas-task-pool-row');
  const grip = row.createSpan('operon-canvas-task-pool-grip'); setIcon(grip, 'grip-vertical'); grip.setAttribute('aria-hidden', 'true');
  const settings = this.cards.deps.getSettings(), id = task.operonId, deps = this.cards.deps.controls;
  const color = resolveTaskColorSource(task.fieldValues, 'taskColor', settings);
  if (color) row.style.setProperty('--operon-canvas-task-pool-accent', color);
  const icon = row.createEl('button', { cls: 'operon-canvas-task-pool-status', attr: { type: 'button', 'aria-disabled': String(!this.canMutate()) } });
  setIcon(icon, resolveTaskDisplayIcon(settings, task.fieldValues, task.checkbox)); icon.style.color = resolveTaskStatusIconColor(task.fieldValues, settings) ?? '';
  setAccessibleLabelWithoutTooltip(icon, t('tooltips', 'cycleTaskStatus'));
  if (deps) lifetime.addChild(new TaskCardControls(row, row, row, icon, id, { ...deps, app: this.owner.deps.app, getSettings: this.cards.deps.getSettings,
   canMutate: this.canMutate, run: (taskId, allowed, action) => this.cards.run(taskId, allowed, action),
   getTask: taskId => this.cards.resolve(taskId).state === 'ready' ? deps.getTask(taskId) : undefined,
  }));
  const title = row.createEl('button', { cls: 'operon-canvas-task-pool-title', attr: { type: 'button' } });
  renderCompactTaskMarkdown(title, { app: this.owner.deps.app, value: task.description || id, mode: 'visual-only' });
  lifetime.registerDomEvent(title, 'click', event => { event.stopPropagation(); this.cards.activate(id, event.metaKey || event.ctrlKey); });
  const meta = row.createDiv('operon-canvas-task-pool-meta');
  const indicators = this.mode === 'finished' ? ['duration', 'totalDuration'] : ['dateScheduled', 'dateDue'];
  for (const key of indicators) {
   const value = task.fieldValues[key]; if (!value || value === '0') continue;
   const indicator = meta.createSpan('operon-canvas-task-pool-indicator');
   setIcon(indicator, key === 'dateScheduled' ? 'calendar-clock' : key === 'dateDue' ? 'calendar-check' : 'timer');
   bindOperonHoverTooltip(indicator, { title: settings.keyMappings.find(mapping => mapping.canonicalKey === key)?.visiblePropertyName || key,
    content: key.startsWith('date') ? formatUiDate(value, settings) : `${Math.round(Number(value) / 60)} min`, taskColor: color });
  }
  const allowed = (): boolean => this.canMutate() && row.isConnected && this.cards.resolve(id).state === 'ready';
  if (task.fieldValues.note && deps) {
   const note = createTaskNoteActionButton({ owner: row, noteValue: task.fieldValues.note, icon: 'notebook-pen', label: t('settings', 'canvasTaskPoolNote'), tooltipTitle: t('settings', 'canvasTaskPoolNote'), taskColor: color,
    onActivate: anchor => {
     if (!allowed()) return;
     const current = deps.getTask(id); if (!current) return;
     showTaskNotePopover({ app: this.owner.deps.app, anchor, operonId: id, sourcePath: current.primary.filePath, lifecycleOwner: row,
      initialValue: current.fieldValues.note || '', taskColor: color, onFocusReturn: () => { if (anchor.isConnected) anchor.focus(); },
      onCommit: value => this.cards.run(id, allowed, () => deps.chips.updateField?.(id, 'note', value)),
     });
    },
   }); note.disabled = !this.canMutate(); meta.appendChild(note);
  }
  const add = meta.createEl('button', { attr: { type: 'button' } }); setIcon(add, 'plus'); setAccessibleLabelWithoutTooltip(add, t('commands', 'addTaskToCanvas')); add.disabled = !this.canMutate();
  bindOperonHoverTooltip(add, { title: t('commands', 'addTaskToCanvas'), taskColor: color });
  lifetime.registerDomEvent(add, 'click', () => { const target = this.owner.capture(this.view); if (target) void this.add(target, id); else new Notice(t('notifications', 'canvasTaskUnavailable')); });
  lifetime.registerDomEvent(row, 'pointerdown', event => this.startDrag(event, task, row));
 }
 private async add(target: CanvasTaskTarget, id: string): Promise<void> {
  if (this.busy) return;
  this.busy = true; const session = this.sessionNumber;
  try { if (await this.owner.add(target, id)) { if (session === this.sessionNumber && !normalizeTaskCardSettings(this.cards.deps.getSettings()).canvasTaskPoolKeepOpen) this.close(); } }
  finally { this.busy = false; }
 }
 private startDrag(event: PointerEvent, task: IndexedTask, row: HTMLElement): void {
  if (event.pointerType === 'touch' || event.button !== 0 || !this.canMutate() || this.busy || (event.target as HTMLElement).closest('button, a, input')) return;
  const target = this.owner.capture(this.view); if (!target) return;
  event.preventDefault(); event.stopPropagation();
  const doc = row.ownerDocument, x = event.clientX, y = event.clientY;
  let ghost: HTMLElement | null = null;
  const move = (next: PointerEvent): void => {
   if (next.pointerId !== event.pointerId) return;
   if (!ghost && Math.hypot(next.clientX - x, next.clientY - y) < 5) return;
   if (!ghost) ghost = doc.body.createDiv({ cls: 'operon-canvas-task-pool-drag', text: task.description || task.operonId });
   ghost.style.left = `${next.clientX + 12}px`; ghost.style.top = `${next.clientY + 12}px`;
  };
  const cancel = (): void => { doc.removeEventListener('pointermove', move); doc.removeEventListener('pointerup', up); doc.removeEventListener('pointercancel', cancel); this.win.removeEventListener('blur', cancel); ghost?.remove(); this.cancelDrag = null; };
  const up = (next: PointerEvent): void => {
   if (next.pointerId !== event.pointerId) return;
   const moved = !!ghost; const hit = doc.elementFromPoint(next.clientX, next.clientY);
   cancel();
   if (!moved || !hit || this.panel?.contains(hit) || !this.view.canvas.wrapperEl?.contains(hit) || this.view.canvas.canvasControlsEl?.contains(hit) || this.view.canvas.cardMenuEl.contains(hit)) { this.refresh(); return; }
   const point = this.view.canvas.posFromClient?.({ x: next.clientX, y: next.clientY });
   if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
   target.point = { ...point }; void this.add(target, task.operonId);
  };
  this.cancelDrag?.(); this.cancelDrag = cancel;
  doc.addEventListener('pointermove', move); doc.addEventListener('pointerup', up); doc.addEventListener('pointercancel', cancel); this.win.addEventListener('blur', cancel);
 }
 private close(): void {
  this.sessionNumber++; this.cancelDrag?.(); this.clearTimer();
  if (this.rows) this.removeChild(this.rows); this.rows = null;
  if (this.session) this.removeChild(this.session); this.session = null;
  if (this.panel) cleanupOperonHoverTooltips(this.panel);
  this.panel?.remove(); this.panel = this.list = this.summary = null; this.signature = '';
  this.button?.setAttribute('aria-expanded', 'false');
 }
 onunload(): void { this.active = false; this.close(); if (this.button) cleanupOperonHoverTooltips(this.button); this.group?.remove(); }
}
