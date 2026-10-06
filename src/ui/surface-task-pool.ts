import { bindCanvasPoolLayer } from './canvas-pool-layer';
import { Component, Notice, setIcon, type App, type TFile } from 'obsidian';
import { getOwnerWindow } from '../core/dom-compat';
import { t } from '../core/i18n';
import { resolveTaskColorSource } from '../core/task-color-source';
import { resolveTaskDisplayIcon } from '../types/settings';
import { normalizeTaskCardSettings } from '../types/task-card';
import type { IndexedTask } from '../types/fields';
import { canvasTaskPoolBatch, CANVAS_TASK_POOL_SEARCH_DELAY, queryCanvasTaskPool, type CanvasTaskPoolMode } from '../systems/canvas-task-pool';
import type { TaskCardEmbeds } from './task-card-embed';
import type { TaskCardSurfaceAccess } from './task-card-excalidraw';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { bindOperonHoverTooltip, cleanupOperonHoverTooltips } from './operon-hover-tooltip';
import { scrollChildIntoView } from './field-pickers/common';
import { TaskCardControls } from './task-card-controls';
import { renderCompactTaskMarkdown } from './compact-task-markdown-renderer';
import { createTaskNoteActionButton, showTaskNotePopover } from './task-note-action';

export interface TaskPoolPoint { x: number; y: number }
export interface TaskPoolTarget { point: TaskPoolPoint; isCurrent(): boolean }
export interface TaskPoolSurface<T extends TaskPoolTarget> {
 app: App; cards: TaskCardEmbeds; contentEl: HTMLElement;
 title(): string; addLabel(): string; unavailable(): string;
 file(): TFile | null; isCurrent(): boolean; readOnly(): boolean;
 capture(): T | null; add(target: T, id: string): Promise<boolean>;
 dropPoint(hit: Element, point: TaskPoolPoint): TaskPoolPoint | null;
 menuSurface?: 'excalidrawTask';
 bindPanelTheme?(panel: HTMLElement, lifetime: Component): void;
}

/** Shared, unscaled planning palette. Native surfaces supply only geometry and insertion. */
export class SurfaceTaskPool<T extends TaskPoolTarget> extends Component {
 private button: HTMLButtonElement | null = null;
 private panel: HTMLElement | null = null;
 private list: HTMLElement | null = null;
 private summary: HTMLElement | null = null;
 private session: Component | null = null;
 private rows: Component | null = null;
 private pinned = false;
 private pinButton: HTMLButtonElement | null = null;
 private panelPoint: { x: number; y: number } | null = null;
 private cancelPanelDrag: (() => void) | null = null;
 private mode: CanvasTaskPoolMode = 'all';
 private query = '';
 private limit = 25;
 private timer: number | null = null;
 private cancelDrag: (() => void) | null = null;
 private active = false;
 private busy = false;
 private signature = '';
 private panelFile: TFile | null = null;
 private panelPath = '';
 private sessionNumber = 0;
 private source: IndexedTask[] | null = null;
 private matches: IndexedTask[] = [];
 private selectedId: string | null = null;
 private queryKey = '';
 private settingsSnapshot: unknown = null;
 private settingsKey = '';
 private readiness = '';
 private readonly closeOnEscape = (): void => { this.close(); this.button?.focus({ preventScroll: true }); };
 constructor(private surface: TaskPoolSurface<T>) { super(); }
 private get cards() { return this.surface.cards; }
 private get win() { return getOwnerWindow(this.surface.contentEl); }
 private readonly canMutate = (): boolean => this.active && !!this.panel?.isConnected && this.surface.isCurrent() && !this.surface.readOnly()
  && this.surface.file() === this.panelFile && this.panelFile?.path === this.panelPath;
 onload(): void {
  this.active = true;
  this.register(this.cards.onRefresh(() => { this.settingsSnapshot = null; this.queryKey = ''; this.refresh(); }));
  this.sync();
 }
 protected get hasButton(): boolean { return !!this.button; }
 protected setButton(button: HTMLButtonElement | null): void {
  if (this.button === button) return;
  if (this.button) { cleanupOperonHoverTooltips(this.button); this.button.onclick = null; }
  this.button = button;
  if (!button) { this.close(); return; }
  setIcon(button, 'list-todo'); setAccessibleLabelWithoutTooltip(button, this.surface.title());
  button.setAttribute('aria-expanded', String(!!this.panel));
  bindOperonHoverTooltip(button, { title: this.surface.title(), taskColor: null, shouldOpen: () => !this.panel });
  button.onclick = event => { event.stopPropagation(); if (this.panel) this.close(); else this.open(); };
 }
 sync(): void { if (this.active) this.refresh(); }
 private captureLease(): () => boolean {
  const session = this.sessionNumber, file = this.panelFile, path = this.panelPath;
  return () => session === this.sessionNumber && this.panelFile === file && this.surface.file() === file
   && file?.path === path && this.canMutate();
 }
 show(): void {
  if (!this.active || !this.surface.isCurrent()) return;
  if (!this.panel) this.open();
  this.panel?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
 }
 private open(): void {
  if (!this.surface.isCurrent() || !this.button) return;
  this.panelFile = this.surface.file(); this.panelPath = this.panelFile?.path ?? ''; this.pinned = false; this.panelPoint = null;
  this.mode = 'all'; this.query = ''; this.selectedId = null; this.limit = 25; this.signature = ''; this.sessionNumber++;
  const session = this.session = new Component(); this.addChild(session);
  const panel = this.panel = this.surface.contentEl.ownerDocument.body.createDiv('operon-canvas-task-pool');
  this.surface.bindPanelTheme?.(panel, session);
  bindCanvasPoolLayer(panel, session);
  panel.setAttribute('role', 'dialog'); setAccessibleLabelWithoutTooltip(panel, this.surface.title());
  this.button.setAttribute('aria-expanded', 'true');
  const header = panel.createDiv('operon-canvas-task-pool-header'); header.createEl('strong', { text: this.surface.title() });
  const pin = this.pinButton = header.createEl('button', { attr: { type: 'button', 'aria-pressed': 'false' } });
  this.updatePin();
  session.registerDomEvent(pin, 'click', () => { if (this.pinned) this.closeOnEscape(); else { this.pinned = true; this.updatePin(); } });
  session.registerDomEvent(header, 'pointerdown', event => this.startPanelDrag(event));
  const modes = panel.createDiv('operon-canvas-task-pool-modes');
  for (const [mode, icon] of [['overdue', 'clock-alert'], ['unscheduled', 'calendar-off'], ['all', 'layers'], ['finished', 'circle-check'], ['pinned', 'pin']] as const) {
   const label = t('calendar', mode);
   const button = modes.createEl('button', { attr: { type: 'button', 'aria-pressed': String(mode === this.mode) } });
   setIcon(button, icon); setAccessibleLabelWithoutTooltip(button, label);
   bindOperonHoverTooltip(button, { title: label, taskColor: null });
   session.registerDomEvent(button, 'click', () => {
    this.mode = mode; this.limit = canvasTaskPoolBatch(this.query); this.signature = '';
    const searchLabel = t('calendar', mode === 'pinned' ? 'searchPinnedTasks' : 'searchAllTasks');
    search.placeholder = searchLabel; setAccessibleLabelWithoutTooltip(search, searchLabel);
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
  session.registerDomEvent(search, 'keydown', event => this.handleSearchKey(event));
  this.list = panel.createDiv('operon-canvas-task-pool-list');
  this.summary = panel.createDiv('operon-canvas-task-pool-summary'); this.summary.setAttribute('role', 'status');
  session.registerDomEvent(this.list, 'scroll', () => {
   const list = this.list;
   if (list && list.scrollTop + list.clientHeight >= list.scrollHeight - 48 && Number(list.dataset.total) > this.limit) { this.limit += canvasTaskPoolBatch(this.query); this.refresh(); }
  });
  session.registerDomEvent(panel, 'pointerdown', event => event.stopPropagation());
  session.registerDomEvent(panel.ownerDocument, 'pointerdown', event => {
   const target = event.target as HTMLElement;
   if (this.pinned || this.cancelPanelDrag || this.cancelDrag || panel.contains(target) || this.button?.contains(target) || this.surface.bindPanelTheme && target.closest?.('.operon-canvas-property-pool, .operon-excalidraw-property-pool-button') || target.closest?.('.operon-contextual-hover-menu, .operon-text-field-popover-panel, .operon-floating-panel, .operon-field-picker')) return;
   this.close();
  });
  session.registerDomEvent(panel.ownerDocument, 'keydown', event => {
   if (event.key === 'Escape' && this.cancelDrag) { event.preventDefault(); event.stopPropagation(); this.cancelDrag(); this.refresh(); return; }
   if (event.key !== 'Escape' || event.defaultPrevented || (event.target as HTMLElement)?.closest?.('.operon-contextual-hover-menu, .operon-text-field-popover-panel, .operon-canvas-property-pool')) return;
   event.preventDefault(); this.closeOnEscape();
  });
  session.registerDomEvent(this.win, 'resize', () => this.position());
  const viewport = this.win.visualViewport;
  if (viewport) {
   const position = () => this.position();
   viewport.addEventListener('resize', position); viewport.addEventListener('scroll', position);
   session.register(() => { viewport.removeEventListener('resize', position); viewport.removeEventListener('scroll', position); });
  }
  const Resize = (this.win as Window & { ResizeObserver: typeof ResizeObserver }).ResizeObserver;
  const observer = new Resize(() => this.position()); observer.observe(this.surface.contentEl); session.register(() => observer.disconnect());
  this.refresh(); search.focus({ preventScroll: true });
 }
 private clearTimer(): void { if (this.timer !== null) this.win.clearTimeout(this.timer); this.timer = null; }
 private flushSearch(): void { this.selectedId = null; this.clearTimer(); if (this.list) this.list.scrollTop = 0; this.signature = ''; this.refresh(); }
 private handleSearchKey(event: KeyboardEvent): void {
  if (event.isComposing || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
  event.preventDefault(); event.stopPropagation();
  if (this.timer !== null) this.flushSearch();
  else this.refresh();
  if (!this.panel || !this.matches.length) return;
  if (event.key === 'Enter') {
   if (event.repeat || !this.canMutate()) return;
   const task = this.matches.find(task => task.operonId === this.selectedId);
   if (!task || this.cards.resolve(task.operonId).state !== 'ready') return;
   const target = this.surface.capture();
   if (target) void this.add(target, task.operonId);
   else new Notice(this.surface.unavailable());
   return;
  }
  const current = Math.max(0, this.matches.findIndex(task => task.operonId === this.selectedId));
  const next = Math.max(0, Math.min(this.matches.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)));
  this.selectedId = this.matches[next].operonId;
  if (next >= this.limit) { this.limit = next + canvasTaskPoolBatch(this.query); this.refresh(); }
  this.syncSelection(true);
 }
 private syncSelection(scroll = false): void {
  if (!this.list) return;
  for (const row of Array.from(this.list.children) as HTMLElement[]) {
   const selected = !!this.selectedId && row.dataset.taskId === this.selectedId;
   row.classList.toggle('is-active', selected);
   if (selected && scroll) scrollChildIntoView(this.list, row);
  }
 }
 private position(): void {
  if (!this.panel || !this.button) return;
  const bounds = this.surface.contentEl.getBoundingClientRect(), anchor = this.button.getBoundingClientRect();
  const settings = normalizeTaskCardSettings(this.cards.deps.getSettings());
  const viewport = this.win.visualViewport;
  const leftEdge = Math.max(bounds.left, viewport?.offsetLeft ?? 0), topEdge = Math.max(bounds.top, viewport?.offsetTop ?? 0);
  const rightEdge = Math.min(bounds.right, (viewport?.offsetLeft ?? 0) + (viewport?.width ?? this.win.innerWidth));
  const bottomEdge = Math.min(bounds.bottom, (viewport?.offsetTop ?? 0) + (viewport?.height ?? this.win.innerHeight));
  const width = Math.max(0, Math.min(settings.canvasTaskPoolWidth, rightEdge - leftEdge - 16));
  this.panel.style.width = `${width}px`;
  this.panel.style.maxHeight = `${Math.max(0, bottomEdge - topEdge - 16)}px`;
  this.panel.style.setProperty('--operon-canvas-task-pool-rows', String(settings.canvasTaskPoolRows));
  const left = Math.max(leftEdge + 8, Math.min(this.panelPoint?.x ?? anchor.left - width - 8, rightEdge - width - 8));
  const top = Math.max(topEdge + 8, Math.min(this.panelPoint?.y ?? anchor.top, bottomEdge - this.panel.offsetHeight - 8));
  this.panel.style.left = `${left}px`; this.panel.style.top = `${top}px`;
 }
 private refresh(): void {
  if (!this.panel || !this.list || !this.summary) return;
  if (!this.surface.isCurrent() || this.surface.file() !== this.panelFile || this.panelFile?.path !== this.panelPath) { this.close(); return; }
  this.position();
  if (this.cancelDrag || this.timer !== null) return;
  const state = this.cards.deps.getIndexState();
  const settings = this.cards.deps.getSettings();
  const source = this.cards.getAllTasks();
  const queryKey = `${this.mode}:${this.query}:${new Date().toDateString()}`;
  if (source !== this.source || queryKey !== this.queryKey || state !== this.readiness) {
   this.source = source; this.queryKey = queryKey; this.readiness = state;
   this.matches = state === 'ready' ? queryCanvasTaskPool(source, this.mode, this.query, undefined, id => this.cards.deps.controls?.chips.isTaskPinned?.(id) === true) : [];
  }
  const matches = this.matches;
  if (!matches.some(task => task.operonId === this.selectedId)) this.selectedId = matches[0]?.operonId ?? null;
  if (settings !== this.settingsSnapshot) { this.settingsSnapshot = settings; this.settingsKey = JSON.stringify(settings); }
  const visible = matches.slice(0, this.limit);
  const signature = JSON.stringify([state, matches.length, visible, this.mode, this.query, this.limit, this.surface.readOnly(), this.settingsKey]);
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
  this.syncSelection();
  this.position();
 }
 private renderRow(task: IndexedTask, list: HTMLElement, lifetime: Component): void {
  const row = list.createDiv('operon-canvas-task-pool-row');
  row.dataset.taskId = task.operonId;
  const settings = this.cards.deps.getSettings(), id = task.operonId, deps = this.cards.deps.controls;
  const color = resolveTaskColorSource(task.fieldValues, 'taskColor', settings);
  if (color) row.style.setProperty('--operon-canvas-task-pool-accent', color);
  const icon = row.createEl('button', { cls: 'operon-canvas-task-pool-status', attr: { type: 'button', 'aria-disabled': String(!this.canMutate()) } });
  setIcon(icon, resolveTaskDisplayIcon(settings, task.fieldValues, task.checkbox));
  setAccessibleLabelWithoutTooltip(icon, t('tooltips', 'cycleTaskStatus'));
  const lease = this.captureLease();
  const allowed = (): boolean => lease() && row.isConnected && this.cards.resolve(id).state === 'ready';
  const access: TaskCardSurfaceAccess = { menuSurface: this.surface.menuSurface, canInteract: () => true,
   canChangeStatus: allowed, canEditFields: allowed, captureWriteGuard: () => allowed };
  if (deps) lifetime.addChild(new TaskCardControls(row, row, row, icon, id, { ...deps, app: this.surface.app, getSettings: this.cards.deps.getSettings,
   canMutate: allowed, surface: () => access, run: (taskId, allowed, action) => this.cards.run(taskId, allowed, action),
   getTask: taskId => this.cards.resolve(taskId).state === 'ready' ? deps.getTask(taskId) : undefined,
  }));
  const title = row.createEl('button', { cls: 'operon-canvas-task-pool-title', attr: { type: 'button' } });
  renderCompactTaskMarkdown(title, { app: this.surface.app, value: task.description || id, mode: 'visual-only' });
  lifetime.registerDomEvent(title, 'click', event => { event.stopPropagation(); if (row.dataset.dragged === 'true') { event.preventDefault(); delete row.dataset.dragged; return; } this.cards.activate(id, event.metaKey || event.ctrlKey); });
  const meta = row.createDiv('operon-canvas-task-pool-meta');
  const indicators = this.mode === 'finished' ? ['duration', 'totalDuration'] : [];
  for (const key of indicators) {
   const value = task.fieldValues[key]; if (!value || value === '0') continue;
   const indicator = meta.createSpan('operon-canvas-task-pool-indicator');
   setIcon(indicator, 'timer');
   bindOperonHoverTooltip(indicator, { title: settings.keyMappings.find(mapping => mapping.canonicalKey === key)?.visiblePropertyName || key,
    content: `${Math.round(Number(value) / 60)} min`, taskColor: null });
  }
  if (task.fieldValues.note && deps) {
   const note = createTaskNoteActionButton({ owner: row, noteValue: task.fieldValues.note, icon: 'notebook-pen', label: t('settings', 'canvasTaskPoolNote'), tooltipTitle: t('settings', 'canvasTaskPoolNote'), taskColor: null, neutral: true,
    onActivate: anchor => {
     if (!allowed()) return;
     const current = deps.getTask(id); if (!current) return;
     showTaskNotePopover({ app: this.surface.app, anchor, operonId: id, sourcePath: current.primary.filePath, lifecycleOwner: row,
      rebindCommitOnReopen: true, initialValue: current.fieldValues.note || '', taskColor: color, onFocusReturn: () => { if (anchor.isConnected) anchor.focus(); },
      onCommit: value => this.cards.run(id, allowed, () => deps.updateSurfaceFields?.(id, { note: value }, current, allowed)),
     });
    },
   }); note.disabled = !this.canMutate(); meta.appendChild(note);
  }
  const add = meta.createEl('button', { attr: { type: 'button' } }); setIcon(add, 'plus'); setAccessibleLabelWithoutTooltip(add, this.surface.addLabel()); add.disabled = !this.canMutate();
  bindOperonHoverTooltip(add, { title: this.surface.addLabel(), taskColor: color });
  lifetime.registerDomEvent(add, 'click', () => { const target = this.surface.capture(); if (target) void this.add(target, id); else new Notice(this.surface.unavailable()); });
  lifetime.registerDomEvent(row, 'pointerdown', event => this.startDrag(event, task, row));
 }
 private async add(target: T, id: string): Promise<void> {
  if (this.busy || !this.canMutate() || this.cards.resolve(id).state !== 'ready') return;
  const lease = this.captureLease(), original = target;
  target = { ...target, isCurrent: () => original.isCurrent() && lease() && this.cards.resolve(id).state === 'ready' };
  this.busy = true; const session = this.sessionNumber;
  try { if (await this.surface.add(target, id)) { if (session === this.sessionNumber && !this.pinned) this.close(); } }
  finally { this.busy = false; }
 }
 private startDrag(event: PointerEvent, task: IndexedTask, row: HTMLElement): void {
  delete row.dataset.dragged;
  if (event.pointerType === 'touch' || event.button !== 0 || !this.canMutate() || this.busy || (event.target as HTMLElement).closest('button:not(.operon-canvas-task-pool-title), a, input')) return;
  const target = this.surface.capture(); if (!target) return;
  event.preventDefault(); event.stopPropagation();
  const doc = row.ownerDocument, x = event.clientX, y = event.clientY;
  const lifetime = new Component(); lifetime.load();
  let ghost: HTMLElement | null = null;
  const move = (next: PointerEvent): void => {
   if (next.pointerId !== event.pointerId) return;
   if ((next.buttons & 1) === 0) { cancel(); return; }
   if (!ghost && Math.hypot(next.clientX - x, next.clientY - y) < 5) return;
   row.dataset.dragged = 'true';
   if (!ghost) {
    ghost = doc.body.createDiv({ cls: 'operon-canvas-task-pool-drag', text: task.description || task.operonId });
    this.surface.bindPanelTheme?.(ghost, lifetime);
   }
   ghost.style.left = `${next.clientX + 12}px`; ghost.style.top = `${next.clientY + 12}px`;
  };
  const cancel = (): void => { doc.removeEventListener('pointermove', move); doc.removeEventListener('pointerup', up); doc.removeEventListener('pointercancel', cancel); doc.removeEventListener('pointerdown', cancel, true); this.win.removeEventListener('blur', cancel); lifetime.unload(); ghost?.remove(); this.cancelDrag = null; };
  const up = (next: PointerEvent): void => {
   if (next.pointerId !== event.pointerId) return;
   const moved = !!ghost; const hit = doc.elementFromPoint(next.clientX, next.clientY);
   cancel();
   if (!moved || !hit || this.panel?.contains(hit) || !target.isCurrent() || !this.canMutate()) { this.refresh(); return; }
   const point = this.surface.dropPoint(hit, { x: next.clientX, y: next.clientY });
   if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
   target.point = { ...point }; void this.add(target, task.operonId);
  };
  this.cancelDrag?.(); this.cancelDrag = cancel;
  doc.addEventListener('pointermove', move); doc.addEventListener('pointerup', up); doc.addEventListener('pointercancel', cancel); doc.addEventListener('pointerdown', cancel, true); this.win.addEventListener('blur', cancel);
 }
 private updatePin(): void {
  if (!this.pinButton) return;
  cleanupOperonHoverTooltips(this.pinButton);
  bindOperonHoverTooltip(this.pinButton, { title: t('settings', this.pinned ? 'canvasTaskPoolUnpin' : 'canvasTaskPoolPin'), taskColor: null });
  this.pinButton.empty();
  setIcon(this.pinButton, this.pinned ? 'pin-off' : 'pin');
  this.pinButton.setAttribute('aria-pressed', String(this.pinned));
  setAccessibleLabelWithoutTooltip(this.pinButton, t('settings', this.pinned ? 'canvasTaskPoolUnpin' : 'canvasTaskPoolPin'));
 }
 private startPanelDrag(event: PointerEvent): void {
  if (!this.panel || event.isPrimary === false || event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
  this.cancelPanelDrag?.();
  const panel = this.panel, doc = panel.ownerDocument, rect = panel.getBoundingClientRect();
  const x = event.clientX, y = event.clientY;
  let moved = false;
  const move = (next: PointerEvent): void => {
   if (next.pointerId !== event.pointerId) return;
   if (!moved && Math.hypot(next.clientX - x, next.clientY - y) < 5) return;
   if (!moved) { moved = true; this.pinned = true; this.updatePin(); }
   this.panelPoint = { x: rect.left + next.clientX - x, y: rect.top + next.clientY - y }; this.position();
  };
  const cancel = (): void => {
   doc.removeEventListener('pointermove', move); doc.removeEventListener('pointerup', up); doc.removeEventListener('pointercancel', up);
   doc.removeEventListener('pointerdown', additionalPointer, true);
   this.win.removeEventListener('blur', cancel); this.cancelPanelDrag = null;
  };
  const up = (next: PointerEvent): void => { if (next.pointerId === event.pointerId) cancel(); };
  const additionalPointer = (next: PointerEvent): void => { if (next.pointerId !== event.pointerId) cancel(); };
  doc.addEventListener('pointerdown', additionalPointer, true);
  this.cancelPanelDrag = cancel;
  event.preventDefault(); event.stopPropagation();
  doc.addEventListener('pointermove', move); doc.addEventListener('pointerup', up); doc.addEventListener('pointercancel', up); this.win.addEventListener('blur', cancel);
 }
 private close(): void {
  this.sessionNumber++; this.cancelPanelDrag?.(); this.cancelDrag?.(); this.clearTimer();
  if (this.rows) this.removeChild(this.rows); this.rows = null;
  if (this.session) this.removeChild(this.session); this.session = null;
  if (this.panel) cleanupOperonHoverTooltips(this.panel);
  this.panel?.remove(); this.panel = this.list = this.summary = null; this.pinButton = null; this.pinned = false; this.panelPoint = null; this.signature = '';
  this.button?.setAttribute('aria-expanded', 'false');
 }
 onunload(): void { this.active = false; this.close(); this.setButton(null); }
}
