import { showTextFieldPopover } from './text-field-popover';
import { cleanupTaskMediaChipPreviews } from './compact-chip-link-preview';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { resolveTaskColorSource } from '../core/task-color-source';
import { bindOperonHoverTooltip, cleanupOperonHoverTooltips } from './operon-hover-tooltip';
import { closeIconOnlyChipPreviewsForRoot } from './icon-only-chip-preview';
import { Component, Notice, type App } from 'obsidian';
import type { InlineRepeatCompletionMode } from '../storage/repeat-series-store';
import type { IndexedTask } from '../types/fields';
import type { OperonSettings } from '../types/settings';
import type { ContextualMenuActionHandler } from '../core/contextual-menu-engine';
import { t } from '../core/i18n';
import { buildCompactCardChipRow, type CompactCardChipRowCallbacks } from './compact-card-chips';
import { bindTaskContextualHoverMenu, showTaskContextualHoverMenu, type ContextualHoverMenuBindOptions } from './contextual-hover-menu';
import { buildTaskProgressTracks, renderTaskProgressHorizontalTrack, resolveTaskProgressDescendantSummary, type TaskProgressSource } from './task-progress-tracks';
import { showTaskNotePopover } from './task-note-action';
import { showPlainCheckboxPopover } from './plain-checkbox-popover';
import type { TaskCardSurfaceAccess } from './task-card-excalidraw';
import { isTaskCardCanvasReadOnly } from './task-card-canvas';

export interface TaskCardControlDependencies {
 presentation?: () => { chips?: boolean; progress?: boolean };
 canMutate?: () => boolean;
 surface?: () => TaskCardSurfaceAccess | null;
 app: App;
 getSettings: () => OperonSettings;
 getAllTasks: () => IndexedTask[];
 getTask: (id: string) => IndexedTask | undefined;
 getChildIds: (id: string) => Iterable<string>;
 cycleStatus: (id: string, canCommit?: () => boolean) => Promise<void>;
 onAction: ContextualMenuActionHandler;
 updateSurfaceFields?: (id: string, payload: Record<string, string>, expected: IndexedTask, allowed: () => boolean, repeatMode?: InlineRepeatCompletionMode) => Promise<boolean>;
 chips: CompactCardChipRowCallbacks;
 run: (id: string, allowed: () => boolean, action: () => Promise<boolean | void> | boolean | void) => Promise<boolean>;
}

let nextCardControlInstance = 0;

/** One mount owns interaction leases; a removed card cannot commit an old draft. */
export class TaskCardControls extends Component {
 private active = false;
 private signature = '';
 private renderedLease: (() => boolean) | null = null;
 private parts: HTMLElement[] = [];
 private cleanupHover: (() => void) | null = null;
 constructor(private root: HTMLElement, private card: HTMLElement, private header: HTMLElement,
  private icon: HTMLButtonElement, private id: string, private deps: TaskCardControlDependencies) { super(); }
 readonly canMutate = (): boolean => this.active && this.root.isConnected && this.deps.canMutate?.() !== false
  && (this.deps.surface?.()?.canEditFields() ?? !isTaskCardCanvasReadOnly(this.deps.app, this.root)) && !!this.deps.getTask(this.id);
 readonly canChangeStatus = (): boolean => this.active && this.root.isConnected && this.deps.canMutate?.() !== false
  && (this.deps.surface?.()?.canChangeStatus() ?? !isTaskCardCanvasReadOnly(this.deps.app, this.root)) && !!this.deps.getTask(this.id);
 private captureWriteGuard(): () => boolean {
  const surface = this.deps.surface?.(), lease = surface?.captureWriteGuard?.();
  return () => this.canMutate() && (!surface || this.deps.surface?.() === surface) && lease?.() !== false;
 }
 private canInteract(): boolean { return this.deps.surface?.()?.canInteract() ?? true; }
 private readonly canManageTask = (): boolean => this.canMutate();
 private run(action: () => Promise<boolean | void> | boolean | void): Promise<boolean> {
  const lease = this.deps.surface?.()?.captureWriteGuard?.();
  return this.deps.run(this.id, () => this.canManageTask() && lease?.() !== false, action);
 }
 onload(): void {
  this.active = true;
  const menuSurface = () => this.deps.surface?.()?.menuSurface ?? 'taskCard';
  const hover: ContextualHoverMenuBindOptions = {
   captureWriteGuard: () => this.captureWriteGuard(),
   get surface() { return menuSurface(); }, menuKey: `taskCard:${this.id}:${++nextCardControlInstance}`, taskId: this.id, getTask: () => this.deps.getTask(this.id) ?? null,
   getSettings: () => {
    const settings = this.deps.getSettings();
    return this.canManageTask() ? settings : { ...settings, contextualMenuActionAllowlist: settings.contextualMenuActionAllowlist.filter(action => action === 'openEditor' || action === 'jumpToSource') };
   },
   isPinned: () => this.deps.chips.isTaskPinned?.(this.id) === true,
   hasSubtasks: () => [...this.deps.getChildIds(this.id)].length > 0,
   onAction: (id, action, context, invocation) => {
    if (!this.canInteract()) return;
    if (action === 'openEditor' || action === 'jumpToSource') return this.deps.onAction(id, action, context, invocation);
    return this.run(() => this.deps.onAction(id, action, context, { ...invocation, canMutate: invocation?.canMutate ?? this.captureWriteGuard() })).then(() => undefined);
   },
  };
  this.cleanupHover = bindTaskContextualHoverMenu(this.icon, hover);
  this.registerDomEvent(this.icon, 'click', event => {
   if (event.defaultPrevented || !this.canInteract()) return;
   event.preventDefault(); event.stopPropagation();
   const allowed = this.captureWriteGuard();
   void this.deps.run(this.id, allowed, () => this.deps.cycleStatus(this.id, this.deps.surface?.() ? allowed : undefined));
  });
  this.registerDomEvent(this.icon, 'keydown', event => {
   if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
    event.preventDefault(); event.stopPropagation(); showTaskContextualHoverMenu(this.icon, hover);
   }
  });
  for (const eventName of ['pointerdown', 'mousedown', 'touchstart', 'dragstart'] as const) {
   this.registerDomEvent(this.card, eventName, event => {
    if (!this.canInteract()) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('.operon-task-card-title') && this.root.closest('.operon-task-card-canvas-node')) return;
    if (!target?.closest('button, a, input, .operon-task-chip')) return;
    event.stopPropagation(); if (eventName === 'dragstart') event.preventDefault();
   });
  }
 }
 refresh(task: IndexedTask): void {
  const base = this.deps.getSettings(), visibility = this.deps.presentation?.();
  const settings = { ...base, taskCardShowChips: visibility?.chips ?? base.taskCardShowChips,
   taskCardShowTaskProgress: visibility?.progress === false ? false : base.taskCardShowTaskProgress,
   taskCardShowCheckboxProgress: visibility?.progress === false ? false : base.taskCardShowCheckboxProgress };
  const readOnly = !this.canMutate(), actionsReadOnly = !this.canManageTask();
  const taskColor = resolveTaskColorSource(task.fieldValues, settings.taskCardColorSource, settings);
  this.icon.setAttribute('aria-disabled', String(!this.canChangeStatus() || !this.canInteract()));
  const source: TaskProgressSource = { getTask: this.deps.getTask, getChildIds: this.deps.getChildIds };
  const summary = resolveTaskProgressDescendantSummary(task, source);
  const signature = JSON.stringify([taskColor, settings.keyMappings, settings.pipelines, settings.priorities, settings.timeFormat, task, settings.taskCardCompactChips, settings.taskCardItemOrder,
   settings.taskCardShowTaskProgress, settings.taskCardShowCheckboxProgress, settings.taskCardShowChips,
   settings.taskCardShowPlayAction, settings.taskCardShowPinAction, settings.taskCardShowNoteAction,
   settings.taskCardShowSubtaskAction, settings.taskCardShowPlainCheckboxAction,
   this.deps.chips.isTaskPinned?.(this.id), this.deps.chips.isTaskTracking?.(this.id), readOnly, actionsReadOnly, summary, visibility]);
  if (signature === this.signature && this.renderedLease?.() !== false) return;
  this.signature = signature;
  for (const part of this.parts) { cleanupOperonHoverTooltips(part); cleanupTaskMediaChipPreviews(part); closeIconOnlyChipPreviewsForRoot(part); part.remove(); } this.parts = [];
  const append = (section: 'chips' | 'taskProgress' | 'checkboxProgress'): HTMLElement => {
   const el = this.card.createDiv(`operon-task-card-${section}`);
   el.style.order = String(settings.taskCardItemOrder.indexOf(section)); this.parts.push(el); return el;
  };
  if (summary.total > 0 && visibility?.progress !== false) {
   const counter = this.header.createEl('button', { cls: 'operon-task-card-subtask-count', text: `${summary.open}/${summary.total}`, attr: { type: 'button' } });
   counter.disabled = actionsReadOnly || task.checkbox !== 'open';
   setAccessibleLabelWithoutTooltip(counter, t('tooltips', 'subtasks'));
   counter.addEventListener('click', event => { event.stopPropagation(); void this.run(() => this.deps.onAction(this.id, 'subtasks')); });
   this.parts.push(counter);
  }
  for (const track of buildTaskProgressTracks({ includeSubtasks: settings.taskCardShowTaskProgress,
   includeCheckboxes: settings.taskCardShowCheckboxProgress, descendantSummary: summary, plainCheckboxProgress: task.plainCheckboxProgress })) {
   const el = renderTaskProgressHorizontalTrack(append(track.kind === 'subtasks' ? 'taskProgress' : 'checkboxProgress'), track, { interactive: !actionsReadOnly && (track.kind === 'checkboxes' || task.checkbox === 'open') });
   setAccessibleLabelWithoutTooltip(el, `${track.title}: ${track.tooltip}`);
   bindOperonHoverTooltip(el, { title: track.title, content: track.tooltip, taskColor });
   el.addEventListener('click', event => {
    event.preventDefault(); event.stopPropagation();
    if (track.kind === 'checkboxes') { this.openCheckboxes(el); return; }
    if (this.deps.getTask(this.id)?.checkbox !== 'open') return;
    void this.run(() => this.deps.onAction(this.id, 'subtasks'));
   });
  }
  if (settings.taskCardShowChips) {
   const callbacks = this.deps.chips, surface = this.deps.surface?.();
   const lease = surface?.captureWriteGuard?.();
   this.renderedLease = lease ?? null;
   const allowed = () => this.canMutate() && (!surface || this.deps.surface?.() === surface) && lease?.() !== false;
   let repeatMode: InlineRepeatCompletionMode | undefined;
   const commit = (payload: Record<string, string>) => {
    if (!surface) return this.run(() => Object.keys(payload).length === 1
     ? callbacks.updateField?.(this.id, Object.keys(payload)[0], Object.values(payload)[0]) : callbacks.updateFields?.(this.id, payload));
    const mode = repeatMode; repeatMode = undefined;
    return this.deps.run(this.id, allowed, () => this.deps.updateSurfaceFields?.(this.id, payload, task, allowed, mode) ?? false);
   };
   const row = buildCompactCardChipRow(task, { ...callbacks, surface: surface?.menuSurface ?? 'taskCard', canMutate: allowed,
    updateField: (_id, key, value) => commit({ [key]: value }),
    updateFields: (id, value) => surface ? commit(value) : this.run(() => callbacks.updateFields?.(id, value)),
    updateRepeatSeriesInlineCompletionMode: (id, mode) => { if (surface) repeatMode = mode; else void this.run(() => callbacks.updateRepeatSeriesInlineCompletionMode?.(id, mode)); },
    toggleTimer: id => this.run(() => callbacks.toggleTimer?.(id, allowed)).then(() => undefined),
    onAction: (id, action, context, invocation) => {
     if (action === 'checkboxes') { this.openCheckboxes(invocation?.actionAnchor ?? this.icon); return; }
     return this.run(() => this.deps.onAction(id, action, context, { ...invocation, canMutate: allowed })).then(() => undefined);
    },
    openNotePopover: anchor => {
     if (!allowed() || !this.canInteract()) return;
     const current = this.deps.getTask(this.id); if (!current) return;
     showTaskNotePopover({ app: this.deps.app, anchor, operonId: this.id, sourcePath: current.primary.filePath,
      lifecycleOwner: this.root, rebindCommitOnReopen: true, initialValue: current.fieldValues.note ?? '', taskDescription: current.description,
      taskColor: current.fieldValues.taskColor,
      onCommit: value => commit({ note: value }), onFocusReturn: () => anchor.focus() });
    },
   }, { allTasks: this.deps.getAllTasks(), owner: this.root, readOnly, actionsReadOnly, isTargetReadOnly: () => !this.canInteract(), allowReadOnlyNavigation: true, noteEditable: !readOnly, classPrefix: 'operon-task-card',
    profile: { items: settings.taskCardCompactChips, play: settings.taskCardShowPlayAction, pin: settings.taskCardShowPinAction,
     note: settings.taskCardShowNoteAction, subtask: settings.taskCardShowSubtaskAction, checkbox: settings.taskCardShowPlainCheckboxAction } });
   if (row) append('chips').appendChild(row);
  }
 }
 openDescription(anchor: HTMLElement): void {
  if (!this.canMutate() || !this.canInteract() || !this.deps.chips.updateField) return;
  const surface = this.deps.surface?.(), allowed = this.captureWriteGuard();
  const task = this.deps.getTask(this.id); if (!task) return;
  showTextFieldPopover({ app: this.deps.app, anchor, title: t('taskEditor', 'description'),
   initialValue: task.description, taskColor: task.fieldValues.taskColor,
   sessionKey: `canvas-task-description:${this.id}`, lifecycleOwner: this.root, rebindCommitOnReopen: true,
   editor: { kind: 'compact-markdown', sourcePath: task.primary.filePath },
   onCommit: value => this.deps.run(this.id, allowed, () => surface
    ? this.deps.updateSurfaceFields?.(this.id, { _description: value }, task, allowed) ?? false
    : this.deps.chips.updateField?.(this.id, '_description', value)),
   onFocusReturn: () => anchor.focus() });
 }
 private openCheckboxes(anchor: HTMLElement): void {
  if (!this.canManageTask()) return;
  const task = this.deps.getTask(this.id); if (!task) return;
  void showPlainCheckboxPopover(anchor, { app: this.deps.app, task, keyMappings: this.deps.getSettings().keyMappings,
   taskColor: task.fieldValues.taskColor, centerOnDesktop: false, followAnchor: true, canCommit: this.captureWriteGuard(),
   seedEmptyDraft: !task.plainCheckboxProgress?.total }).catch(() => new Notice(t('notifications', 'taskCardActionUnavailable')));
 }
 onunload(): void { this.active = false; this.cleanupHover?.(); for (const part of this.parts) { cleanupOperonHoverTooltips(part); cleanupTaskMediaChipPreviews(part); closeIconOnlyChipPreviewsForRoot(part); part.remove(); } this.parts = []; }
}
