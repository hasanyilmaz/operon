import type { IndexedTask } from '../types/fields';
import { normalizeTaskFieldColor } from '../core/task-color-source';
import { normalizeTaskIconValue } from '../core/task-icon-value';
import { getConfiguredKeyMappingIcon } from '../core/key-mapping-icons';
import { setIcon } from 'obsidian';
import { t } from '../core/i18n';
import { humanizeUpcomingCountdown, type UpcomingTaskStatusSnapshot } from '../core/upcoming-task-status';
import { canSelectFlowTimeTask, type FlowTimeBreakSnapshot } from '../systems/flow-time-break';
import { formatDurationHuman } from '../systems/tracker-utils';
import { resolveStatusDockClickAction, type OperonSettings } from '../types/settings';
import type { ActiveTrackerState } from '../types/tracker';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { bindOperonHoverTooltip, cleanupOperonHoverTooltips, closeBoundOperonHoverTooltip } from './operon-hover-tooltip';
import { bindDescendantFocusVisible, cleanupDescendantFocusVisible } from './descendant-focus-visible';
import { renderCompactTaskMarkdown } from './compact-task-markdown-renderer';

export type StatusDockAlert = { state: 'hidden' | 'conflict' | 'resolved'; count: number };
export interface StatusDockSnapshot {
	settings: OperonSettings;
	active: ActiveTrackerState | null;
	breakSnapshot: FlowTimeBreakSnapshot;
	breakSeconds: number;
	pendingDescription: string | null;
	upcoming: UpcomingTaskStatusSnapshot;
	alert: StatusDockAlert;
	actionPending: boolean;
}
export interface StatusDockActions {
	findTask: (anchor: HTMLElement) => void | Promise<void>;
	openTracker: (anchor: HTMLElement) => void | Promise<void>;
	toggleTimer: () => void | Promise<void>;
	toggleBreak: (anchor: HTMLElement) => void | Promise<void>;
	startTask: (taskId: string, anchor: HTMLElement) => void | Promise<void>;
	openCurrentTask: (taskId: string, anchor: HTMLElement) => void | Promise<void>;
	openNextUpcoming: (anchor: HTMLElement) => void | Promise<void>;
	openUpcoming: (anchor: HTMLElement) => void | Promise<void>;
	openConflicts: () => void;
	createTask: (anchor: HTMLElement) => void | Promise<void>;
}

type CalendarTaskControl = { shell: HTMLElement; play: HTMLButtonElement; taskId: string | null };

function sourceLabelForSettings(settings: OperonSettings): string {
	const behavior = resolveStatusDockClickAction(settings.statusDockClickAction);
	return t('settings', behavior === 'source' ? 'taskFinderResultSourceOnly' : behavior === 'editor' ? 'taskFinderResultEditorOnly' : 'taskFinderResultSourceAndEditor');
}

function text(el: HTMLElement, value: string): void { if (el.textContent !== value) el.textContent = value; }

/** Persistent controls: ticks only patch text, attributes and visibility. */
export class StatusDockWidget {
	readonly slot: HTMLElement;
	readonly root: HTMLElement;
	private readonly grip: HTMLButtonElement;
	private readonly tracker: HTMLElement;
	private readonly trackerTime: HTMLElement;
	private readonly trackerName: HTMLElement;
	private readonly coffee: HTMLButtonElement;
	private readonly breakFinder: HTMLButtonElement;
	private readonly selectionDivider: HTMLElement;
	private readonly creator: HTMLButtonElement;
	private readonly timerAction: HTMLButtonElement;
	private readonly taskArea: HTMLElement;
	private readonly currentHost: HTMLElement;
	private readonly currentReadings = new Map<string, { host: HTMLElement; button: HTMLElement; icon: HTMLElement; time: HTMLElement; name: HTMLElement; divider: HTMLElement }>();
	private readonly createCurrentReading: (id: string) => { host: HTMLElement; button: HTMLElement; icon: HTMLElement; time: HTMLElement; name: HTMLElement; divider: HTMLElement };
	private readonly upcoming: HTMLElement;
	private readonly upcomingTime: HTMLElement;
	private readonly upcomingName: HTMLElement;
	private readonly nextUpcoming: HTMLElement;
	private readonly nextTime: HTMLElement;
	private readonly nextName: HTMLElement;
	private readonly nextDivider: HTMLElement;
	private readonly firstDivider: HTMLElement;
	private readonly alertDivider: HTMLElement;
	private readonly alert: HTMLButtonElement;
	private readonly alertIcon: HTMLElement;
	private readonly alertCount: HTMLElement;
	private readonly calendarControls = new Map<HTMLElement, CalendarTaskControl>();
	private readonly tooltipKeys = new Map<HTMLElement, string>();
	private readonly icons = new Map<HTMLElement, string>();
	private readonly nameKeys = new Map<HTMLElement, string>();
	private lastSnapshot: StatusDockSnapshot | null = null;
	private width = 0;
	private visible = true;
	private viewport = { width: 0, height: 0, left: 0, top: 0 };
	private position: { x: number; y: number } | null = null;
	private stopDrag: (() => void) | null = null;
	private readonly resizeObserver: ResizeObserver;

	constructor(doc: Document, actions: StatusDockActions, onError: (error: unknown) => void) {
		this.slot = doc.win.createDiv(); this.slot.className = 'operon-status-dock-slot';
		this.root = this.slot.createDiv('operon-status-dock');
		this.root.setAttribute('role', 'toolbar');
		setAccessibleLabelWithoutTooltip(this.root, t('settings', 'statusDockSection'));
		const button = (parent: HTMLElement, cls: string, action: (anchor: HTMLElement) => void | Promise<void>) => {
			const el = parent.createEl('button', { cls, attr: { type: 'button' } });
			el.addEventListener('click', event => {
				event.stopPropagation();
				try { const result = action(el); if (result) void result.catch(onError); } catch (error) { onError(error); }
			});
			return el;
		};
		const reading = (parent: HTMLElement, cls: string, icon: string | null, action: (anchor: HTMLElement) => void | Promise<void>, plainable = false) => {
			const shell = plainable ? parent : parent.createSpan('operon-status-dock-calendar-task');
			const el = shell.createSpan(`operon-status-dock-reading ${cls}`);
			if (icon) this.icon(el.createSpan('operon-status-dock-leading-icon'), icon);
			const copy = el.createSpan('operon-status-dock-copy');
			const duration = copy.createSpan('operon-status-dock-time');
			const name = copy.createSpan('operon-status-dock-name');
			if (!plainable) { name.setAttribute('role', 'button'); name.tabIndex = 0; }
			name.addEventListener('click', event => {
				if (name.getAttribute('role') !== 'button') return;
				event.stopPropagation();
				try { const result = action(name); if (result) void result.catch(onError); } catch (error) { onError(error); }
			});
			name.addEventListener('keydown', event => {
				if (name.getAttribute('role') !== 'button' || (event.key !== 'Enter' && event.key !== ' ')) return;
				event.preventDefault(); event.stopPropagation(); name.click();
			});
			if (!plainable) {
				const control: CalendarTaskControl = { shell, play: button(shell, 'operon-status-dock-action operon-status-dock-task-play', anchor => {
					if (control.taskId && !control.play.disabled && !control.play.hidden) return actions.startTask(control.taskId, anchor);
				}), taskId: null };
				this.icon(control.play, 'play'); this.calendarControls.set(el, control);
				bindDescendantFocusVisible(shell);
			}
			return { el, duration, name };
		};
		this.grip = button(this.root, 'operon-status-dock-action operon-status-dock-grip', () => {});
		this.icon(this.grip, 'grip-vertical');
		this.grip.addEventListener('pointerdown', event => this.startDrag(event, doc.win));
		this.grip.addEventListener('keydown', event => {
			const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
			const direction = directions[event.key];
			if (event.key !== 'Home' && !direction) return;
			event.preventDefault(); event.stopPropagation(); this.stopDrag?.(); this.closeTooltips();
			if (event.key === 'Home') { this.position = null; this.root.style.removeProperty('transform'); return; }
			const start = this.currentPosition(), step = event.shiftKey ? 1 : 10;
			this.position = { x: start.x + direction[0] * step, y: start.y + direction[1] * step }; this.place();
		});
		this.tracker = this.root.createDiv('operon-status-dock-tracker');
		this.timerAction = button(this.tracker, 'operon-status-dock-action operon-status-dock-timer-action', actions.toggleTimer);
		const tracker = reading(this.tracker, 'operon-status-dock-tracker-reading', null, actions.openTracker, true);
		this.trackerTime = tracker.duration; this.trackerName = tracker.name;
		const controls = this.tracker.createDiv('operon-status-dock-timer-controls');
		this.coffee = button(controls, 'operon-status-dock-action', actions.toggleBreak); this.icon(this.coffee, 'coffee');
		this.selectionDivider = controls.createSpan('operon-status-dock-divider operon-status-dock-selection-divider'); this.selectionDivider.setAttribute('aria-hidden', 'true');
		this.breakFinder = button(controls, 'operon-status-dock-action operon-status-dock-break-finder', actions.findTask); this.icon(this.breakFinder, 'scan-search');
		this.creator = button(controls, 'operon-status-dock-action operon-status-dock-creator', actions.createTask); this.icon(this.creator, 'list-plus');
		this.firstDivider = this.root.createSpan('operon-status-dock-divider'); this.firstDivider.setAttribute('aria-hidden', 'true');
		this.taskArea = this.root.createDiv('operon-status-dock-task-area');
		this.taskArea.tabIndex = 0; this.taskArea.setAttribute('role', 'group');
		setAccessibleLabelWithoutTooltip(this.taskArea, t('settings', 'tabUpcoming'));
		this.taskArea.addEventListener('scroll', () => this.closeTooltips(), { passive: true });
		this.taskArea.addEventListener('wheel', event => {
			if (event.ctrlKey || event.metaKey || event.shiftKey || event.deltaX || this.taskArea.scrollWidth <= this.taskArea.clientWidth) return;
			const before = this.taskArea.scrollLeft; this.taskArea.scrollLeft += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.taskArea.clientWidth : 1);
			if (this.taskArea.scrollLeft !== before) event.preventDefault();
		}, { passive: false });
		const upcoming = reading(this.taskArea, 'operon-status-dock-upcoming', 'calendar-clock', actions.openUpcoming);
		this.upcoming = upcoming.el; this.upcomingTime = upcoming.duration; this.upcomingName = upcoming.name;
		this.currentHost = this.taskArea.createDiv('operon-status-dock-current-items');
		this.createCurrentReading = id => {
			const host = this.currentHost.createDiv('operon-status-dock-current-item'); host.dataset.taskId = id;
			const divider = host.createSpan('operon-status-dock-divider'); divider.setAttribute('aria-hidden', 'true');
			const item = reading(host, 'operon-status-dock-upcoming operon-status-dock-current is-current', 'calendar-clock', anchor => actions.openCurrentTask(id, anchor));
			return { host, button: item.el, icon: item.el.querySelector<HTMLElement>('.operon-status-dock-leading-icon')!, time: item.duration, name: item.name, divider };
		};
		this.nextDivider = this.taskArea.createSpan('operon-status-dock-divider operon-status-dock-next-divider'); this.nextDivider.setAttribute('aria-hidden', 'true');
		const next = reading(this.taskArea, 'operon-status-dock-next', 'calendar', actions.openNextUpcoming);
		this.nextUpcoming = next.el; this.nextTime = next.duration; this.nextName = next.name;
		this.alertDivider = this.root.createSpan('operon-status-dock-divider'); this.alertDivider.setAttribute('aria-hidden', 'true');
		this.alert = button(this.root, 'operon-status-dock-alert', actions.openConflicts);
		this.alertIcon = this.alert.createSpan('operon-status-dock-leading-icon'); this.alertCount = this.alert.createSpan();
		const Resize = (doc.win as Window & { ResizeObserver: typeof ResizeObserver }).ResizeObserver;
		this.resizeObserver = new Resize(() => this.place());
		this.resizeObserver.observe(this.root);
	}

	setVisible(visible: boolean): void {
		this.visible = visible; this.slot.hidden = !visible;
		if (!visible) { this.stopDrag?.(); this.closeTooltips(); }
		else this.place();
	}

	setViewport(width: number, height: number, left: number, top: number): void {
		this.viewport = { width, height, left, top }; this.setWidth(width); this.place();
	}

	setWidth(width: number): void {
		if (width === this.width) return;
		this.width = width;
		if (this.lastSnapshot) this.update(this.lastSnapshot);
	}

	update(snapshot: StatusDockSnapshot): void {
		this.lastSnapshot = snapshot;
		const { settings, active, breakSnapshot, upcoming, alert } = snapshot;
		const ongoing = upcoming.ongoing ?? [];
		const upcomingVisible = settings.upcomingShowStatusBar && (upcoming.task !== null || ongoing.length > 0);
		this.taskArea.hidden = !upcomingVisible; this.root.classList.toggle('has-calendar-tasks', upcomingVisible);
		this.updateCurrentTasks(settings.upcomingShowStatusBar ? ongoing : [], settings, sourceLabelForSettings(settings));
		const nextVisible = upcomingVisible && !!upcoming.next;
		this.nextUpcoming.hidden = !nextVisible; this.nextDivider.hidden = !nextVisible;
		const alertVisible = alert.state !== 'hidden';
		this.slot.hidden = !this.visible;
		this.tracker.hidden = false; this.upcoming.hidden = !upcomingVisible || ongoing.length > 0; this.alert.hidden = !alertVisible;
		this.firstDivider.hidden = !upcomingVisible;
		this.alertDivider.hidden = !alertVisible;
		setAccessibleLabelWithoutTooltip(this.grip, t('settings', 'statusDockMove'));
		this.timerAction.classList.toggle('is-running', !!active);
		this.root.classList.toggle('is-break', !!breakSnapshot.breakState);
		this.root.classList.toggle('is-idle', !active && !breakSnapshot.breakState);
		const description = active?.task?.description || (active?.isUnassigned ? t('taskEditor', 'dockSelectTask')
			: snapshot.pendingDescription || t('taskEditor', 'trackerIdleLabel'));
		const elapsedSeconds = active?.elapsedSeconds ?? (breakSnapshot.breakState ? snapshot.breakSeconds : 0);
		const elapsed = formatDurationHuman(elapsedSeconds, elapsedSeconds < 60 ? 'seconds' : 'minutes');
		text(this.trackerTime, elapsed);
		this.trackerTime.hidden = !active && !breakSnapshot.breakState;
		const hasTask = !!(active?.operonId || breakSnapshot.pendingTaskId);
		if (hasTask) this.name(this.trackerName, description, settings.language);
		else { this.nameKeys.delete(this.trackerName); text(this.trackerName, description); }
		const sourceLabel = sourceLabelForSettings(settings);
		const trackerAction = active?.operonId || breakSnapshot.pendingTaskId ? sourceLabel : t('commands', 'openTaskFinder');
		const finderHint = t('commands', 'trackDifferentTask');
		if (hasTask) {
			this.trackerName.setAttribute('role', 'button'); this.trackerName.tabIndex = 0;
			this.label(this.trackerName, trackerAction, hasTask ? description : finderHint,
			hasTask ? `${trackerAction}: ${this.trackerTime.hidden ? '' : elapsed + ', '}${description}` : `${trackerAction}: ${finderHint}`);
		} else {
			this.trackerName.removeAttribute('role'); this.trackerName.removeAttribute('tabindex');
			cleanupOperonHoverTooltips(this.trackerName); this.tooltipKeys.delete(this.trackerName);
			setAccessibleLabelWithoutTooltip(this.trackerName, '', this.trackerName.parentElement ?? undefined);
		}
		const busy = snapshot.actionPending || breakSnapshot.actionPending;
		const choosing = canSelectFlowTimeTask(active, breakSnapshot);
		const primaryFinder = choosing && !breakSnapshot.breakState;
		this.icon(this.coffee, primaryFinder ? 'scan-search' : 'coffee');
		this.breakFinder.hidden = !choosing || !breakSnapshot.breakState; this.breakFinder.disabled = busy;
		this.selectionDivider.hidden = !choosing;
		this.label(this.breakFinder, t('commands', 'openTaskFinder'), finderHint);
		this.coffee.disabled = busy || (!choosing && !breakSnapshot.breakState && !active?.operonId);
		this.creator.hidden = !choosing; this.creator.disabled = busy;
		this.label(this.creator, t('taskEditor', 'dockTaskCreatorTitle'), t('taskEditor', 'dockCreateAndTrack'));
		if (primaryFinder) this.coffee.removeAttribute('aria-pressed');
		else this.coffee.setAttribute('aria-pressed', String(!!breakSnapshot.breakState));
		this.label(this.coffee, primaryFinder ? t('commands', 'openTaskFinder') : t('taskEditor', breakSnapshot.breakState ? 'flowTimeEndBreak' : 'flowTimeStartBreak'),
			primaryFinder ? finderHint : undefined);
		this.timerAction.disabled = busy;
		this.icon(this.timerAction, active ? 'square' : 'play');
		this.label(this.timerAction, t('taskEditor', active ? 'stopActiveTracker' : 'startTracker'));
		const current = upcoming.current ?? upcoming.due;
		this.upcoming.classList.toggle('is-current', current);
		this.upcoming.querySelector<HTMLElement>('.operon-status-dock-leading-icon')!.style.color = normalizeTaskFieldColor(upcoming.task?.fieldValues.taskColor) ?? '';
		this.nextUpcoming.querySelector<HTMLElement>('.operon-status-dock-leading-icon')!.style.color = normalizeTaskFieldColor(upcoming.next?.task.fieldValues.taskColor) ?? '';
		this.icon(this.upcoming.querySelector<HTMLElement>('.operon-status-dock-leading-icon')!, normalizeTaskIconValue(upcoming.task?.fieldValues.taskIcon) || getConfiguredKeyMappingIcon(current ? 'dateScheduled' : 'dateDue', settings.keyMappings) || (current ? 'calendar-clock' : 'calendar'));
		this.icon(this.nextUpcoming.querySelector<HTMLElement>('.operon-status-dock-leading-icon')!, normalizeTaskIconValue(upcoming.next?.task.fieldValues.taskIcon) || getConfiguredKeyMappingIcon('dateDue', settings.keyMappings) || 'calendar');
		const nextRemaining = humanizeUpcomingCountdown(upcoming.next?.countdown ?? null, upcoming.next?.countdown?.startsWith('00:00:') === true);
		text(this.nextTime, nextRemaining ?? ''); this.nextTime.hidden = nextRemaining === null;
		const nextTitle = upcoming.next?.task.description || t('pinnedTasks', 'untitledTask');
		this.name(this.nextName, nextTitle, settings.language);
		this.label(this.nextName, t('taskEditor', 'dockNextTask'), nextTitle,
			`${t('taskEditor', 'dockNextTask')}: ${nextTitle}${nextRemaining ? `, ${nextRemaining}` : ''}`);
		if (!nextVisible) closeBoundOperonHoverTooltip(this.nextName);
		const remaining = current ? null
			: humanizeUpcomingCountdown(upcoming.countdown, upcoming.countdown?.startsWith('00:00:') === true);
		text(this.upcomingTime, remaining ?? '');
		this.upcomingTime.hidden = remaining === null;
		const nextDescription = upcoming.task?.description || t('pinnedTasks', 'untitledTask');
		this.name(this.upcomingName, nextDescription, settings.language);
		this.upcoming.classList.toggle('is-due', upcoming.due);
		this.label(this.upcomingName, sourceLabel, current ? `${t('taskEditor', 'trackerNow')}: ${nextDescription}` : nextDescription, `${sourceLabel}: ${current ? t('taskEditor', 'trackerNow') + ': ' : ''}${nextDescription}${remaining ? `, ${remaining}` : ''}`);
		this.updateCalendarControl(this.upcoming, upcoming.task, snapshot);
		this.updateCalendarControl(this.nextUpcoming, upcoming.next?.task ?? null, snapshot);
		for (const task of ongoing) {
			const item = this.currentReadings.get(task.operonId);
			if (item) this.updateCalendarControl(item.button, task, snapshot);
		}
		this.icon(this.alertIcon, alert.state === 'resolved' ? 'shield-check' : 'shield-alert');
		this.alert.classList.toggle('is-resolved', alert.state === 'resolved');
		text(this.alertCount, alert.state === 'conflict' ? String(alert.count) : '');
		this.label(this.alert, alert.state === 'conflict' ? t('duplicateOperonId', 'statusBarConflictLabel', { count: String(alert.count) })
			: t('duplicateOperonId', 'statusBarResolvedLabel'));
		if (this.breakFinder.hidden) closeBoundOperonHoverTooltip(this.breakFinder);
		if (this.creator.hidden) closeBoundOperonHoverTooltip(this.creator);
		if (this.upcoming.hidden) closeBoundOperonHoverTooltip(this.upcomingName);
		if (!alertVisible) closeBoundOperonHoverTooltip(this.alert);
	}

	closeTooltips(): void {
		this.closeTrackerTooltips();
		for (const { play } of this.calendarControls.values()) closeBoundOperonHoverTooltip(play);
		for (const item of this.currentReadings.values()) closeBoundOperonHoverTooltip(item.name);
		for (const el of [this.upcomingName, this.nextName, this.alert]) closeBoundOperonHoverTooltip(el);
	}

	private updateCalendarControl(button: HTMLElement, task: IndexedTask | null, snapshot: StatusDockSnapshot): void {
		const control = this.calendarControls.get(button)!;
		control.shell.hidden = button.hidden;
		control.taskId = task?.operonId ?? null;
		control.play.hidden = button.hidden || !task || snapshot.active?.operonId === task.operonId;
		control.play.disabled = snapshot.actionPending || snapshot.breakSnapshot.actionPending;
		control.shell.classList.toggle('has-task-play', !control.play.hidden && !control.play.disabled);
		control.play.style.color = normalizeTaskFieldColor(task?.fieldValues.taskColor) ?? '';
		this.label(control.play, t('taskEditor', 'startTracker'), task?.description || t('pinnedTasks', 'untitledTask'));
		if (control.play.hidden || control.play.disabled) closeBoundOperonHoverTooltip(control.play);
	}

	private updateCurrentTasks(tasks: readonly IndexedTask[], settings: OperonSettings, sourceLabel: string): void {
		const wanted = new Set(tasks.map(task => task.operonId));
		for (const [id, item] of this.currentReadings) {
			if (wanted.has(id)) continue;
			cleanupOperonHoverTooltips(item.host); cleanupDescendantFocusVisible(item.host);
			const control = this.calendarControls.get(item.button)!;
			this.icons.delete(control.play); this.tooltipKeys.delete(control.play); this.calendarControls.delete(item.button);
			this.icons.delete(item.icon); this.nameKeys.delete(item.name); this.tooltipKeys.delete(item.name);
			item.host.remove(); this.currentReadings.delete(id);
		}
		this.currentHost.hidden = tasks.length === 0;
		for (const [index, task] of tasks.entries()) {
			let item = this.currentReadings.get(task.operonId);
			if (!item) { item = this.createCurrentReading(task.operonId); this.currentReadings.set(task.operonId, item); }
			if (this.currentHost.children[index] !== item.host) this.currentHost.insertBefore(item.host, this.currentHost.children[index] ?? null);
			item.divider.hidden = index === 0;
			this.icon(item.icon, normalizeTaskIconValue(task.fieldValues.taskIcon) || getConfiguredKeyMappingIcon('dateScheduled', settings.keyMappings) || 'calendar-clock');
			item.icon.style.color = normalizeTaskFieldColor(task.fieldValues.taskColor) ?? '';
			const now = `${t('taskEditor', 'trackerNow')}:`, description = task.description || t('pinnedTasks', 'untitledTask');
			text(item.time, ''); item.time.hidden = true; this.name(item.name, description, settings.language);
			this.label(item.name, sourceLabel, `${now} ${description}`, `${sourceLabel}: ${now} ${description}`);
		}
	}

	/** Window-local coordinates are deliberately never persisted. */
	private currentPosition(): { x: number; y: number } {
		const rect = this.root.getBoundingClientRect();
		return { x: rect.left - this.viewport.left, y: rect.top - this.viewport.top };
	}

	private place(): void {
		if (!this.position || this.slot.hidden || !this.viewport.width) return;
		const { width, height } = this.root.getBoundingClientRect();
		// Retain a small edge inset whenever the window has room for it.
		const insetX = Math.min(12, Math.max(0, (this.viewport.width - width) / 2));
		const insetY = Math.min(12, Math.max(0, (this.viewport.height - height) / 2));
		const x = Math.max(insetX, Math.min(this.position.x, this.viewport.width - width - insetX));
		const y = Math.max(insetY, Math.min(this.position.y, this.viewport.height - height - insetY));
		this.position = { x, y };
		this.root.style.transform = `translate(${x - (this.viewport.width - width) / 2}px, ${y - (this.viewport.height - 12 - height)}px)`;
	}

	private startDrag(event: PointerEvent, owner: Window): void {
		if (event.button !== 0 || event.isPrimary === false || this.stopDrag) return;
		event.preventDefault(); event.stopPropagation(); this.closeTooltips();
		const start = this.currentPosition(), previous = this.position, pointerId = event.pointerId;
		this.root.classList.add('is-dragging'); this.grip.setPointerCapture?.(pointerId);
		const move = (next: PointerEvent) => {
			if (next.pointerId !== pointerId) return;
			this.position = { x: start.x + next.clientX - event.clientX, y: start.y + next.clientY - event.clientY }; this.place();
		};
		const finish = (next: PointerEvent) => { if (next.pointerId === pointerId) this.stopDrag?.(); };
		const cancel = () => this.stopDrag?.();
		const key = (next: KeyboardEvent) => {
			if (next.key !== 'Escape') return;
			next.preventDefault(); next.stopPropagation(); cancel(); this.position = previous;
			this.root.style.removeProperty('transform'); this.place();
		};
		this.stopDrag = () => {
			this.stopDrag = null; this.root.classList.remove('is-dragging');
			owner.removeEventListener('pointermove', move); owner.removeEventListener('pointerup', finish);
			owner.removeEventListener('pointercancel', finish); owner.removeEventListener('blur', cancel);
			owner.removeEventListener('keydown', key, true);
			if (this.grip.hasPointerCapture?.(pointerId)) this.grip.releasePointerCapture(pointerId);
		};
		owner.addEventListener('pointermove', move); owner.addEventListener('pointerup', finish);
		owner.addEventListener('pointercancel', finish); owner.addEventListener('blur', cancel);
		owner.addEventListener('keydown', key, true);
	}

	destroy(): void { this.stopDrag?.(); this.resizeObserver.disconnect(); cleanupOperonHoverTooltips(this.slot); cleanupDescendantFocusVisible(this.slot); this.slot.remove(); }
	private closeTrackerTooltips(): void {
		for (const el of [this.trackerName, this.coffee, this.breakFinder, this.creator, this.timerAction]) closeBoundOperonHoverTooltip(el);
	}
	private icon(el: HTMLElement, icon: string): void {
		if (this.icons.get(el) === icon) return;
		this.icons.set(el, icon);
		// Obsidian appends SVGs; replace only the old glyph and retain labels/tooltips.
		for (const child of Array.from(el.children)) if (child.tagName.toLowerCase() === 'svg') child.remove();
		setIcon(el, icon);
	}
	private name(el: HTMLElement, value: string, language: string): void {
		const key = JSON.stringify([value, language]);
		if (this.nameKeys.get(el) === key) return;
		this.nameKeys.set(el, key); el.empty(); renderCompactTaskMarkdown(el, { value, mode: 'visual-only', maxCharacters: 24 });
	}
	private label(el: HTMLElement, title: string, content?: string, accessible?: string): void {
		setAccessibleLabelWithoutTooltip(el, accessible ?? title, el.classList.contains('operon-status-dock-name') ? el.parentElement ?? undefined : undefined);
		const key = JSON.stringify([title, content]);
		if (this.tooltipKeys.get(el) === key) return;
		this.tooltipKeys.set(el, key); bindOperonHoverTooltip(el, { title, content, taskColor: null });
	}
}
