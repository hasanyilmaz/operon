import { Component, Notice, setIcon } from 'obsidian';
import { t } from '../core/i18n';
import { CONTEXTUAL_MENU_ACTIONS, getContextualMenuActionIcon, getContextualMenuActionLabel } from '../core/contextual-menu-engine';
import type { TaskCardEmbeds } from './task-card-embed';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { bindOperonHoverTooltip, cleanupOperonHoverTooltips } from './operon-hover-tooltip';

export interface TaskSelectionControl {
 id: string; icon: string; title: string; active?: boolean; unavailable: boolean; run(): void;
}
interface Context {
 cards: TaskCardEmbeds; taskId: string;
 current(): boolean;
 writable(): boolean;
 isBusy(): boolean;
 setBusy(value: boolean): void;
}
/** Shared Canvas/Excalidraw order, labels and task actions; only selection ownership differs. */
export function taskSelectionControls(context: Context): TaskSelectionControl[] {
 const { cards, taskId } = context, deps = cards.deps.controls;
 const controls: TaskSelectionControl[] = [];
 if (deps) for (const kind of ['timer', 'pin'] as const) {
  const active = kind === 'timer' ? deps.chips.isTaskTracking?.(taskId) === true : deps.chips.isTaskPinned?.(taskId) === true;
  const allowed = () => context.current() && context.writable() && cards.resolve(taskId).state === 'ready'
   && (kind !== 'timer' || deps.chips.isTaskTracking?.(taskId) === true || deps.getTask(taskId)?.checkbox === 'open');
  controls.push({
   id: `operon-task-${kind}`, icon: kind === 'timer' ? active ? 'square' : 'play' : active ? 'pin-off' : 'pin',
   title: kind === 'timer' ? t('tooltips', active ? 'stopTimer' : 'startTimer') : t('contextMenu', active ? 'unpinTask' : 'pinTask'),
   active, unavailable: context.isBusy() || !allowed(),
   run: () => {
    if (context.isBusy() || !allowed()) return;
    context.setBusy(true);
    void cards.run(taskId, allowed, async () => {
     if (kind === 'timer' && deps.chips.toggleTimer) await deps.chips.toggleTimer(taskId);
     else await deps.onAction(taskId, kind === 'pin' ? 'pinToggle' : 'startTimer', undefined, { canMutate: allowed });
    }).catch(() => { new Notice(t('notifications', 'taskCardActionUnavailable')); }).finally(() => context.setBusy(false));
   },
  });
 }
 for (const actionId of ['openEditor', 'jumpToSource'] as const) {
  const action = CONTEXTUAL_MENU_ACTIONS.find(item => item.id === actionId)!;
  controls.push({ id: `operon-task-${actionId}`,
   icon: actionId === 'openEditor' ? 'settings-2' : getContextualMenuActionIcon(action, cards.deps.getSettings().keyMappings),
   title: getContextualMenuActionLabel(action), unavailable: false,
   run: () => { if (context.current()) cards.activate(taskId, actionId === 'jumpToSource'); },
  });
 }
 return controls;
}
export function taskSelectionControlSignature(controls: readonly TaskSelectionControl[]): string {
 return JSON.stringify(controls.map(({ id, icon, title, active, unavailable }) => [id, icon, title, active, unavailable]));
}
export function bindTaskSelectionControl(button: HTMLButtonElement, control: TaskSelectionControl, life: Component,
 options: { nativeClick?: boolean; bindTheme?: (tooltip: HTMLElement) => () => void } = {}): void {
 button.setAttribute('data-operon-task-action', control.id);
 if (control.active !== undefined) button.setAttribute('aria-pressed', String(control.active));
 button.disabled = control.unavailable;
 button.classList.toggle('is-active', control.active === true);
 setAccessibleLabelWithoutTooltip(button, control.title);
 bindOperonHoverTooltip(button, { title: control.title, taskColor: null, bindTheme: options.bindTheme });
 life.register(() => cleanupOperonHoverTooltips(button));
 life.registerDomEvent(button, 'pointerdown', event => event.stopPropagation());
 life.registerDomEvent(button, 'keydown', event => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); });
 if (!options.nativeClick) life.registerDomEvent(button, 'click', event => { event.preventDefault(); event.stopPropagation(); control.run(); });
}
export function mountTaskSelectionControl(host: HTMLElement, control: TaskSelectionControl, life: Component): void {
 const button = host.createEl('button', { cls: 'clickable-icon', attr: { type: 'button' } });
 setIcon(button, control.icon); bindTaskSelectionControl(button, control, life);
}
