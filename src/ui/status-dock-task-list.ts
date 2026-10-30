import { Notice, setIcon } from 'obsidian';
import type { IndexedTask } from '../types/fields';
import type { TrackerSession } from '../types/tracker';
import { resolveStatusDockClickAction, resolveTaskDisplayIcon, type OperonSettings } from '../types/settings';
import { asHTMLElement, getOwnerWindow } from '../core/dom-compat';
import { t } from '../core/i18n';
import { getTaskIconActionLabel } from '../core/task-icon-action';
import { normalizeTaskFieldColor, resolveTaskStatusIconColorForTask } from '../core/task-color-source';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { bindOperonHoverTooltip, cleanupOperonHoverTooltips } from './operon-hover-tooltip';
import { bindTaskContextualHoverMenu, cleanupTaskContextualHoverMenus, hideTaskContextualHoverMenu, isTaskContextualHoverMenuActive } from './contextual-hover-menu';
import { isFloatingPanelTargetForRoot, closeFloatingPanelsForRoot, hasFloatingPanelForRoot } from './field-pickers/common';
import { renderCompactTaskMarkdown } from './compact-task-markdown-renderer';
import type { StatusDockSessionActions, StatusDockSessionCard } from './status-dock-session-card';
import type { StatusDockTaskScope, StatusDockTaskScopes } from './status-dock-task-scope';

type DockOwnerWindow = Window & { Node: typeof Node; ResizeObserver: typeof ResizeObserver };

type Row = { el: HTMLElement; icon: HTMLButtonElement; name: HTMLButtonElement; timer: HTMLButtonElement; signature: string };

/** One owner-window list, with no expiry or persisted UI state. */
export class StatusDockTaskList {
 private readonly owner: DockOwnerWindow;
 private readonly panel: HTMLElement;
 private readonly controls: HTMLElement;
 private readonly divider: HTMLElement;
 private readonly buttons = new Map<StatusDockTaskScope, HTMLButtonElement>();
 private readonly rows = new Map<string, Row>();
 private scopes: StatusDockTaskScopes = { overdue: [], today: [] };
 private active: StatusDockTaskScope | null = null;
 private queuedSession: TrackerSession | null = null;
 private disposed = false;
 private busy = 0;
 private revision = 0;
 private frame: number | null = null;
 private below = false;
 private readonly observer: ResizeObserver;
 constructor(private readonly host: HTMLElement, private readonly options: {
  getSettings: () => OperonSettings;
  getTask: (id: string) => IndexedTask | null | undefined;
  isTracking: (id: string) => boolean;
  toggleTimer: (id: string, canCommit: () => boolean) => Promise<unknown>;
  actions: StatusDockSessionActions;
  sessionCard: StatusDockSessionCard;
 }) {
  this.owner = getOwnerWindow(host) as DockOwnerWindow;
  this.controls = host.createDiv('operon-status-dock-scopes');
  host.insertBefore(this.controls, host.querySelector('.operon-status-dock-tracker'));
  for (const [scope, icon] of [['overdue', 'calendar-search'], ['today', 'zap']] as const) {
   const button = this.controls.createEl('button', { cls: 'operon-status-dock-action', attr: { type: 'button', 'aria-expanded': 'false' } });
   setIcon(button, icon);
   button.addEventListener('click', event => { event.stopPropagation(); this.toggle(scope); });
   this.buttons.set(scope, button);
  }
  this.divider = this.controls.createSpan('operon-status-dock-divider');
  this.divider.setAttribute('aria-hidden', 'true');
  this.panel = host.createDiv('operon-status-dock-task-list'); this.panel.hidden = true;
  this.panel.setAttribute('role', 'group');
  this.owner.document.addEventListener('click', this.onClick, true);
  this.owner.document.addEventListener('keydown', this.onKeyDown, true);
  this.owner.document.addEventListener('pointermove', this.onMove);
  this.owner.addEventListener('resize', this.schedulePosition);
  this.owner.visualViewport?.addEventListener('resize', this.schedulePosition);
  this.owner.visualViewport?.addEventListener('scroll', this.schedulePosition);
  this.observer = new this.owner.ResizeObserver(this.schedulePosition);
  this.observer.observe(host); this.observer.observe(this.panel);
  this.update(this.scopes);
 }
 private label(scope: StatusDockTaskScope): string {
  return t('modals', scope === 'overdue' ? 'taskFinderOverdue' : 'taskFinderHappensToday');
 }
 update(scopes: StatusDockTaskScopes): void {
  if (this.disposed) return;
  this.scopes = scopes;
  for (const [scope, button] of this.buttons) {
   button.hidden = scopes[scope].length === 0;
   button.setAttribute('aria-expanded', String(this.active === scope));
   button.classList.toggle('is-active', this.active === scope);
   const label = this.label(scope);
   if (button.dataset.scopeLabel !== label) {
    button.dataset.scopeLabel = label;
    setAccessibleLabelWithoutTooltip(button, label); cleanupOperonHoverTooltips(button);
    bindOperonHoverTooltip(button, { title: label, taskColor: null });
   }
  }
  this.controls.hidden = this.divider.hidden = !scopes.overdue.length && !scopes.today.length;
  if (!this.active || this.busy) return;
  if (!scopes[this.active].length) { this.close(); return; }
  this.panel.setAttribute('aria-labelledby', this.buttons.get(this.active)?.getAttribute('aria-labelledby') ?? '');
  const tasks = scopes[this.active];
  const ids = new Set(tasks.map(task => task.operonId));
  for (const [id, row] of this.rows) if (!ids.has(id)) { this.disposeRow(row); this.rows.delete(id); }
  const settings = this.options.getSettings();
  const settingsKey = JSON.stringify([settings.language, settings.statusDockClickAction, settings.taskIconClickAction,
   settings.fallbackTaskIconSource, settings.taskStatusIconColorSource, settings.fallbackStateIcons,
   settings.pipelines, settings.priorities, settings.contextualMenuActionAllowlist, settings.contextualMenuSurfaceActionMatrix]);
  tasks.forEach((task, index) => {
   let row = this.rows.get(task.operonId);
   if (!row) { row = this.createRow(task.operonId); this.rows.set(task.operonId, row); }
   this.renderTimer(row, task.operonId);
   const signature = JSON.stringify([task.description, task.checkbox, task.fieldValues, settingsKey]);
   if (row.signature !== signature) { row.signature = signature; this.renderRow(row, task, settings); }
   // Move only when order actually changed; retain focus, hover menu anchors and popup ownership.
   const child = this.panel.children[index] ?? null;
   if (child !== row.el) {
    const focused = asHTMLElement(this.owner.document.activeElement);
    this.panel.insertBefore(row.el, child);
    if (focused && row.el.contains(focused) && this.owner.document.activeElement !== focused) focused.focus({ preventScroll: true });
   }
  });
  this.schedulePosition();
 }
 toggle(scope: StatusDockTaskScope): void {
  if (this.disposed) return;
  if (this.active === scope) { this.close(); return; }
  if (!this.scopes[scope].length) return;
  if (!this.active) this.queuedSession = this.options.sessionCard.takeSession() ?? this.queuedSession;
  this.revision++; this.clearRows(); this.active = scope; this.panel.hidden = false;
  this.panel.scrollTop = 0; this.update(this.scopes); this.position();
 }
 showSession(session: TrackerSession): void {
  if (this.active) this.queuedSession = session;
  else { this.syncCardGutter(); this.options.sessionCard.show(session); }
 }
 close(showSession = true): void {
  this.revision++; this.active = null; this.panel.hidden = true; this.clearRows();
  if (this.frame !== null) this.owner.cancelAnimationFrame(this.frame); this.frame = null;
  for (const button of this.buttons.values()) { button.setAttribute('aria-expanded', 'false'); button.classList.remove('is-active'); }
  const session = this.queuedSession; this.queuedSession = null;
  if (showSession && session && !this.disposed) this.options.sessionCard.show(session);
 }
 private readonly onClick = (event: MouseEvent): void => {
  if (!this.active || !(event.target instanceof this.owner.Node)) return;
  const target = event.target;
  if (this.panel.contains(target) || this.controls.contains(target)) return;
  if (this.host.contains(target)) { this.close(); return; }
  // Menus/pickers and editors live in window-owned portals outside their originating card.
  const element = asHTMLElement(target) ?? target.parentElement;
  if (isFloatingPanelTargetForRoot(this.panel, target) || element?.closest('.operon-calendar-hover-menu, .operon-floating-panel, .modal-container, .menu, .popover')) return;
  this.close();
 };
 private readonly onKeyDown = (event: KeyboardEvent): void => {
  if (event.key !== 'Escape' || !this.active) return;
  if (isTaskContextualHoverMenuActive(this.panel) || hasFloatingPanelForRoot(this.panel)) return;
  const target = event.target;
  if (!(target instanceof this.owner.Node) || !this.panel.contains(target) && !this.host.contains(target)) return;
  event.preventDefault(); event.stopPropagation();
  const button = this.buttons.get(this.active); this.close(); button?.focus();
 };
 private readonly onMove = (): void => { if (this.host.classList.contains('is-dragging')) this.schedulePosition(); };
 private readonly schedulePosition = (): void => {
  if (!this.active || this.disposed || this.frame !== null) return;
  this.frame = this.owner.requestAnimationFrame(() => { this.frame = null; if (!this.disposed && this.active) this.position(); });
 };
 private syncCardGutter(): void {
  // Measure even before the first list opens; this also sizes a session shown first.
  const hidden = this.panel.hidden;
  this.panel.hidden = false;
  const gutter = Math.max(0, (this.panel.offsetWidth || 0) - (this.panel.clientWidth || 0));
  this.host.style.setProperty('--operon-status-dock-card-gutter', `${gutter}px`);
  this.panel.hidden = hidden;
 }
 private position(): void {
  const rect = this.host.getBoundingClientRect(), viewport = this.owner.visualViewport;
  const top = viewport?.offsetTop ?? 0, left = viewport?.offsetLeft ?? 0;
  const width = viewport?.width ?? this.owner.innerWidth, height = viewport?.height ?? this.owner.innerHeight;
  const above = Math.max(0, rect.top - top - 20), below = Math.max(0, top + height - rect.bottom - 20);
  this.below = above < Math.min(220, this.rows.size * 52) && below > above;
  this.panel.classList.toggle('is-below', this.below);
  // Match the actual session-card geometry, including theme/font scaling.
  const rowHeight = this.panel.children[0]?.getBoundingClientRect().height ?? 44;
  const style = this.owner.getComputedStyle(this.panel);
  const gap = Number.parseFloat(style.rowGap) || 8;
  const padding = (Number.parseFloat(style.paddingTop) || 2) + (Number.parseFloat(style.paddingBottom) || 2);
  const available = this.below ? below : above;
  const count = Math.max(0, Math.min(10, this.rows.size, Math.floor((available - padding + gap) / (rowHeight + gap))));
  this.panel.style.visibility = count ? '' : 'hidden';
  this.panel.style.maxHeight = `${count ? count * rowHeight + (count - 1) * gap + padding : 0}px`;
  this.panel.style.maxWidth = `${Math.max(0, width - 24)}px`;
  // Reserve native scrollbar space outside the shared card width (including short lists).
  this.syncCardGutter();
  const panel = this.panel.getBoundingClientRect();
  const border = this.host.clientLeft || 0;
  this.panel.style.left = `${Math.max(left + 12 - rect.left - border, Math.min(-border, left + width - 12 - panel.width - rect.left - border))}px`;
  this.panel.style.top = this.below ? `${rect.height + 8}px` : `${-panel.height - 8}px`;
 }
 private createRow(id: string): Row {
  const el = this.panel.createDiv('operon-status-dock-session-card operon-status-dock-scope-card');
  const icon = el.createEl('button', { cls: 'operon-status-dock-session-icon', attr: { type: 'button' } });
  const name = el.createEl('button', { cls: 'operon-status-dock-name', attr: { type: 'button' } });
  icon.addEventListener('click', event => { event.stopPropagation(); void this.run(() => this.options.actions.clickIcon(id)); });
  name.addEventListener('click', event => { event.stopPropagation(); void this.run(() => this.options.actions.openTask(id, name)); });
  const timer = el.createEl('button', { cls: 'operon-status-dock-scope-timer', attr: { type: 'button' } });
  timer.addEventListener('click', event => {
   event.stopPropagation();
   if (timer.disabled || this.busy) return;
   const revision = this.revision, wasTracking = this.options.isTracking(id);
   const canCommit = () => !this.disposed && revision === this.revision && el.isConnected
    && !!this.options.getTask(id);
   timer.disabled = true;
   void this.run(async () => {
    try { if (this.options.isTracking(id) === wasTracking) await this.options.toggleTimer(id, canCommit); }
    finally { timer.disabled = false; }
   });
  });
  return { el, icon, name, timer, signature: '' };
 }
 private replaceIcon(element: HTMLElement, icon: string): void {
  // Obsidian appends SVGs; retain accessible labels while replacing the old glyph.
  for (const child of Array.from(element.children)) if (child.tagName.toLowerCase() === 'svg') child.remove();
  setIcon(element, icon);
 }
 private renderTimer(row: Row, id: string): void {
  const tracking = this.options.isTracking(id);
  const label = t('tooltips', tracking ? 'stopTimer' : 'startTimer');
  if (row.timer.dataset.timerLabel === label) return;
  row.timer.dataset.timerLabel = label;
  this.replaceIcon(row.timer, tracking ? 'square' : 'play');
  row.timer.classList.toggle('is-active', tracking);
  setAccessibleLabelWithoutTooltip(row.timer, label);
  cleanupOperonHoverTooltips(row.timer);
  bindOperonHoverTooltip(row.timer, { title: label, taskColor: null });
 }
 private renderRow(row: Row, task: IndexedTask, settings: OperonSettings): void {
  this.replaceIcon(row.icon, resolveTaskDisplayIcon(settings, task.fieldValues, task.checkbox));
  row.icon.style.color = resolveTaskStatusIconColorForTask(task, settings) ?? '';
  setAccessibleLabelWithoutTooltip(row.icon, getTaskIconActionLabel(settings, task.checkbox));
  row.name.empty(); renderCompactTaskMarkdown(row.name, { value: task.description || task.operonId, mode: 'visual-only' });
  const behavior = resolveStatusDockClickAction(settings.statusDockClickAction);
  const openLabel = t('settings', behavior === 'source' ? 'taskFinderResultSourceOnly' : behavior === 'editor' ? 'taskFinderResultEditorOnly' : 'taskFinderResultSourceAndEditor');
  setAccessibleLabelWithoutTooltip(row.name, `${openLabel}: ${task.description}`);
  cleanupOperonHoverTooltips(row.name);
  const preference = (): 'auto' | 'above' => this.below ? 'auto' : 'above';
  bindOperonHoverTooltip(row.name, { get preferredVertical() { return preference(); }, title: openLabel, content: task.description, taskColor: normalizeTaskFieldColor(task.fieldValues['taskColor']) });
  bindTaskContextualHoverMenu(row.icon, {
   followAnchor: true, surface: 'statusDock', menuKey: `status-dock-scope:${task.operonId}`,
   captureWriteGuard: () => { const revision = this.revision; return () => !this.disposed && revision === this.revision && row.el.isConnected; },
   taskId: task.operonId, getTask: () => this.options.getTask(task.operonId) ?? null, getSettings: this.options.getSettings,
   onAction: async (...args) => { await this.run(async () => { await this.options.actions.contextualAction(...args); }); },
   isPinned: () => this.options.actions.isPinned(task.operonId), hasSubtasks: () => this.options.actions.hasSubtasks(task.operonId),
   isTracking: () => this.options.isTracking(task.operonId),
  });
 }
 private async run(action: () => Promise<void>): Promise<void> {
  this.busy++;
  try { await action(); } catch (error) { console.warn('Operon: dock task action failed', error); new Notice(t('notifications', 'taskSaveFailed')); }
  finally { this.busy--; if (!this.disposed) this.update(this.scopes); }
 }
 private disposeRow(row: Row): void {
  closeFloatingPanelsForRoot(row.el); hideTaskContextualHoverMenu(true, row.el); cleanupTaskContextualHoverMenus(row.el); cleanupOperonHoverTooltips(row.el); row.el.remove();
 }
 private clearRows(): void { for (const row of this.rows.values()) this.disposeRow(row); this.rows.clear(); }
 destroy(): void {
  this.disposed = true; this.close(false); this.observer.disconnect();
  this.owner.document.removeEventListener('click', this.onClick, true);
  this.owner.document.removeEventListener('keydown', this.onKeyDown, true);
  this.owner.document.removeEventListener('pointermove', this.onMove);
  this.owner.removeEventListener('resize', this.schedulePosition);
  this.owner.visualViewport?.removeEventListener('resize', this.schedulePosition);
  this.owner.visualViewport?.removeEventListener('scroll', this.schedulePosition);
  cleanupOperonHoverTooltips(this.controls); this.controls.remove(); this.panel.remove();
 }
}
