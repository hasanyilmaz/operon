import { setIcon } from 'obsidian';
import type { IndexedTask } from '../types/fields';
import type { TrackerSession } from '../types/tracker';
import { resolveStatusDockClickAction, resolveTaskDisplayIcon, type OperonSettings } from '../types/settings';
import { resolveTaskStatusIconColorForTask } from '../core/task-color-source';
import { getTaskIconActionLabel } from '../core/task-icon-action';
import type { ContextualMenuActionHandler } from '../core/contextual-menu-engine';
import { formatDurationHuman } from '../systems/tracker-utils';
import { getOwnerWindow } from '../core/dom-compat';
import { t } from '../core/i18n';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { bindOperonHoverTooltip, cleanupOperonHoverTooltips } from './operon-hover-tooltip';
import { renderCompactTaskMarkdown } from './compact-task-markdown-renderer';
import { bindTaskContextualHoverMenu, cleanupTaskContextualHoverMenus, hideTaskContextualHoverMenu, isTaskContextualHoverMenuActive } from './contextual-hover-menu';

export interface StatusDockSessionActions {
 openSession: (session: TrackerSession) => Promise<void>;
 openTask: (taskId: string, anchor: HTMLElement) => Promise<void>;
 clickIcon: (taskId: string) => Promise<void>;
 contextualAction: ContextualMenuActionHandler;
 isPinned: (taskId: string) => boolean;
 hasSubtasks: (taskId: string) => boolean;
}

/** Counts only unpaused time; callers can use a deterministic monotonic clock. */
export class StatusDockSessionLifetime {
 private remaining = 10_000;
 private previous: number;
 private paused = false;
 constructor(now: number) { this.previous = now; }
 advance(now: number, paused: boolean): boolean {
  if (!this.paused) this.remaining -= Math.max(0, now - this.previous);
  this.previous = now; this.paused = paused;
  return this.remaining > 0;
 }
}

/** A window-owned transient record. It never stores settings or timer state. */
export class StatusDockSessionCard {
 private readonly el: HTMLElement;
 private session: TrackerSession | null = null;
 private lifetime: StatusDockSessionLifetime | null = null;
 private timer: number | null = null;
 private hover = false;
 private busy = 0;
 private revision = 0;
 private signature = '';
 private disposed = false;
 private readonly owner: Window;
 constructor(private readonly host: HTMLElement, private readonly options: {
  getSettings: () => OperonSettings;
  getTask: (id: string) => IndexedTask | null | undefined;
  getSessions: (id: string) => TrackerSession[];
  isTracking: (id: string) => boolean;
  actions: StatusDockSessionActions;
 }) {
  this.owner = getOwnerWindow(host);
  this.el = host.createDiv('operon-status-dock-session-card'); this.el.hidden = true;
  this.el.setAttribute('role', 'group');
  this.el.addEventListener('pointerenter', () => { this.hover = true; this.tick(); });
  this.el.addEventListener('pointerleave', () => { this.hover = false; this.tick(); });
  this.el.addEventListener('focusin', () => this.tick());
  this.el.addEventListener('focusout', () => this.owner.queueMicrotask(() => this.tick()));
 }
 show(session: TrackerSession): void {
  this.clear(); if (this.disposed) return;
  this.session = session; this.lifetime = new StatusDockSessionLifetime(this.owner.performance.now());
  this.el.hidden = false; this.refresh(); this.position(); this.tick();
 }
 refresh(): void {
  if (!this.session || this.disposed) return;
  const matches = this.options.getSessions(this.session.operonId).filter(s => s.start === this.session!.start && s.end === this.session!.end);
  const current = matches.find(s => s.sessionIndex === this.session!.sessionIndex) ?? (matches.length === 1 ? matches[0] : null);
  const task = this.options.getTask(this.session.operonId);
  if (!current || !task) { this.clear(); return; }
  this.session = { ...current, task };
  const settings = this.options.getSettings();
  const signature = JSON.stringify([current.start, current.end, task.description, task.checkbox, task.fieldValues['status'], task.fieldValues['priority'], task.fieldValues['taskIcon'], task.fieldValues['taskColor'], settings.language, settings.statusDockClickAction, settings.taskIconClickAction, settings.fallbackTaskIconSource, settings.taskStatusIconColorSource, settings.fallbackStateIcons, settings.pipelines, settings.priorities, settings.contextualMenuActionAllowlist, settings.contextualMenuSurfaceActionMatrix]);
  if (signature === this.signature) return;
  this.signature = signature;
  // Retain the icon/menu trigger across ticks and task updates.
  let icon = this.el.querySelector<HTMLButtonElement>('.operon-status-dock-session-icon');
  if (!icon) {
   icon = this.el.createEl('button', { cls: 'operon-status-dock-session-icon', attr: { type: 'button' } });
   icon.addEventListener('click', event => { event.preventDefault(); event.stopPropagation();
    if (this.session) void this.run(() => this.options.actions.clickIcon(this.session!.operonId)); });
   const duration = this.el.createEl('button', { cls: 'operon-status-dock-time', attr: { type: 'button' } });
   duration.addEventListener('click', event => { event.stopPropagation(); const session = this.session;
    if (session) void this.run(() => this.options.actions.openSession(session)); });
   const name = this.el.createEl('button', { cls: 'operon-status-dock-name', attr: { type: 'button' } });
   name.addEventListener('click', event => { event.stopPropagation(); const session = this.session;
    if (session) void this.run(() => this.options.actions.openTask(session.operonId, name)); });
  }
  setIcon(icon, resolveTaskDisplayIcon(settings, task.fieldValues, task.checkbox));
  icon.style.color = resolveTaskStatusIconColorForTask(task, settings) ?? '';
  setAccessibleLabelWithoutTooltip(icon, getTaskIconActionLabel(settings, task.checkbox));
  const duration = this.el.querySelector<HTMLElement>('.operon-status-dock-time')!;
  duration.setText(formatDurationHuman(current.durationSeconds, 'seconds'));
  setAccessibleLabelWithoutTooltip(duration, `${t('taskEditor', 'editSession')}: ${formatDurationHuman(current.durationSeconds, 'seconds')}`);
  cleanupOperonHoverTooltips(duration);
  bindOperonHoverTooltip(duration, { title: t('taskEditor', 'editSession'), content: task.description, taskColor: task.fieldValues['taskColor'] ?? null });
  const name = this.el.querySelector<HTMLElement>('.operon-status-dock-name')!;
  name.empty(); renderCompactTaskMarkdown(name, { value: task.description || task.operonId, mode: 'visual-only', maxCharacters: 40 });
  const behavior = resolveStatusDockClickAction(settings.statusDockClickAction);
  const openLabel = t('settings', behavior === 'source' ? 'taskFinderResultSourceOnly' : behavior === 'editor' ? 'taskFinderResultEditorOnly' : 'taskFinderResultSourceAndEditor');
  setAccessibleLabelWithoutTooltip(name, `${openLabel}: ${task.description}`);
  cleanupOperonHoverTooltips(name);
  bindOperonHoverTooltip(name, { title: openLabel, content: task.description, taskColor: task.fieldValues['taskColor'] ?? null });
  bindTaskContextualHoverMenu(icon, {
   followAnchor: true, surface: 'flowTimeTask', menuKey: `status-dock-session:${task.operonId}:${current.start}:${current.end}`,
   captureWriteGuard: () => { const revision = this.revision; return () => !this.disposed && revision === this.revision && !!this.session; },
   taskId: task.operonId, getTask: () => this.options.getTask(task.operonId) ?? null,
   getSettings: this.options.getSettings,
   onAction: async (...args) => { await this.run(async () => { await this.options.actions.contextualAction(...args); }); },
   isPinned: () => this.options.actions.isPinned(task.operonId),
   hasSubtasks: () => this.options.actions.hasSubtasks(task.operonId),
   isTracking: () => this.options.isTracking(task.operonId),
  });
 }
 private async run(action: () => Promise<void>): Promise<void> {
  const revision = this.revision;
  this.busy++; this.tick();
  try { await action(); } catch (error) { console.warn('Operon: recent session action failed', error); }
  finally { if (revision === this.revision) { this.busy--; this.refresh(); this.tick(); } }
 }
 private position(): void {
  const host = this.host.getBoundingClientRect(), card = this.el.getBoundingClientRect();
  const viewport = this.owner.visualViewport;
  const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
  const width = viewport?.width ?? this.owner.innerWidth, height = viewport?.height ?? this.owner.innerHeight;
  const border = this.host.clientLeft || 0;
  this.el.style.left = `${Math.max(left + 12 - host.left - border, Math.min(-border, left + width - 12 - card.width - host.left - border))}px`;
  const preferred = host.top - card.height - 8;
  const y = preferred >= top + 12 ? preferred : Math.min(host.bottom + 8, top + height - card.height - 12);
  this.el.style.top = `${Math.max(top + 12, y) - host.top}px`;
 }
 private tick(): void {
  if (this.timer !== null) this.owner.clearTimeout(this.timer);
  this.timer = null;
  if (!this.lifetime || this.disposed) return;
  this.position();
  const paused = this.hover || this.el.matches(':hover') || this.busy > 0 || this.el.contains(this.el.ownerDocument.activeElement)
   || isTaskContextualHoverMenuActive(this.el) || this.el.ownerDocument.hidden;
  if (!this.lifetime.advance(this.owner.performance.now(), paused)) { this.clear(); return; }
  this.timer = this.owner.setTimeout(() => { this.refresh(); this.tick(); }, 100);
 }
 clear(): void {
  this.revision++; this.session = null; this.lifetime = null; this.signature = ''; this.busy = 0; this.hover = false;
  if (this.timer !== null) this.owner.clearTimeout(this.timer); this.timer = null;
  hideTaskContextualHoverMenu(true, this.el); cleanupTaskContextualHoverMenus(this.el);
  cleanupOperonHoverTooltips(this.el); this.el.empty(); this.el.hidden = true;
 }
 destroy(): void { this.disposed = true; this.clear(); this.el.remove(); }
}
