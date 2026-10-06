import { resolvePropertyPoolDate } from '../core/property-pool-dates';
import { renderPropertyPoolValueVisual } from './property-pool-value-visual';
import { Component, Notice } from 'obsidian';
import { t } from '../core/i18n';
import { getOwnerWindow } from '../core/dom-compat';
import type { PropertyPoolFavorite } from '../core/property-value-pool';
import type { PropertyPoolTaskBridge, PropertyPoolTaskPlan, PropertyPoolTaskResult } from '../core/property-pool-task-operation';
import type { CanvasTaskNode, TaskCanvas, CanvasPoint } from './canvas-task-adapter';
import type { TFile } from 'obsidian';
import { beginLongPressTouchGesture, scrollTouchSurface } from './touch-drag-session';
import { showOperonPointerTooltip } from './operon-hover-tooltip';

import type { CanvasGroups } from './canvas-groups';
type GroupPreview = NonNullable<ReturnType<CanvasGroups['prepareCreate']>> & { node?: CanvasTaskNode | null; current?: () => boolean };
export type PrepareGroup = (value: PropertyPoolFavorite, point: CanvasPoint) => GroupPreview | null;

interface DragAppearance { width: number; height: number; icon: string }

export interface PropertyDropTarget {
 id: string;
 taskId: string;
 readOnly?(): boolean;
 nodeEl: HTMLElement;
 current(): boolean;
}
export interface PropertyDropSurface {
 contentEl: HTMLElement;
 file(): TFile | null;
 identity(): object;
 isCurrent(): boolean;
 readOnly(): boolean;
 supported(): boolean;
 unavailable?(): string;
 busy(): boolean;
 targetAt(x: number, y: number): PropertyDropTarget | null;
 apply(plan: PropertyPoolTaskPlan, allowed: () => boolean, notice: (result: PropertyPoolTaskResult) => void): Promise<PropertyPoolTaskResult>;
 bindTheme?(element: HTMLElement, lifetime: Component): void;
 groups?: { canvas(): TaskCanvas; prepare: PrepareGroup };
}

export class SurfacePropertyValueDrop extends Component {
	private cancelDrag: (() => void) | null = null;
	private clearTouchSuppression: (() => void) | null = null;
	private busy = false;
	private active = true;
	private revision = 0;
 private groupBlocked = false;
 private groupSession = 0;
 resetGroupSession(): void { this.invalidate(); this.groupSession++; this.groupBlocked = false; }
	constructor(private surface: PropertyDropSurface, private bridge: PropertyPoolTaskBridge) { super(); }
	get dragging(): boolean { return this.cancelDrag !== null; }
	cancel(): void { this.cancelDrag?.(); }
	invalidate(): void { this.revision++; this.cancel(); }
	invalidateSources(): void { if (!this.busy) this.revision++; this.cancel(); }
	private writable(): boolean { return this.active && this.surface.isCurrent() && !this.surface.readOnly() && this.surface.supported(); }
	private notice(result: PropertyPoolTaskResult): void {
        if (result.periodicNote) new Notice(t('notifications', 'periodicNoteRecoveryRequired', {
            kind: t('settings', result.periodicNote.kind === 'weekly' ? 'fileTaskWeeklyNotes' : 'fileTaskDailyNotes'), path: result.periodicNote.path,
        }));
		if (result.status !== 'committed' || result.warning) new Notice(t('settings', result.status === 'committed' ? 'propertyPoolRefreshWarning' : 'propertyPoolDropFailed'));
	}
	start(event: PointerEvent, value: PropertyPoolFavorite, alive: () => boolean): void {
		if (!this.active || this.busy || this.surface.busy() || event.button !== 0 || event.isPrimary === false
			|| (event.target as HTMLElement).closest('button, a, input')) return;
		this.cancel();
		const surface = (event.target as HTMLElement).closest<HTMLElement>('.operon-canvas-property-pool-drag-surface');
		const rect = surface?.getBoundingClientRect();
		const appearance = { width: rect?.width || 240, height: rect?.height || 42, icon: surface?.dataset.poolIcon ?? 'text' };
		if (event.pointerType === 'touch') { this.startTouch(event, value, alive, appearance); return; }
		this.beginDrag(event, value, alive, appearance);
	}
	private startTouch(event: PointerEvent, value: PropertyPoolFavorite, alive: () => boolean, appearance: DragAppearance): void {
		const source = event.currentTarget as HTMLElement || event.target as HTMLElement;
		const target = source.closest<HTMLElement>('.operon-canvas-property-pool-list') ?? source;
		const doc = target.ownerDocument, win = getOwnerWindow(target), viewport = win.visualViewport;
		const file = this.surface.file(), path = file?.path, canvas = this.surface.identity(), revision = this.revision;
		let finish: (() => void) | null = null;
		const cancel = () => finish?.();
		const key = (next: KeyboardEvent) => { if (next.key === 'Escape') { next.preventDefault(); next.stopImmediatePropagation(); cancel(); } };
		const additional = () => cancel();
		finish = beginLongPressTouchGesture({
			target, event, longPressMs: 260, cancelDistancePx: 10,
			onScroll: (_x, y) => scrollTouchSurface(target, '.operon-canvas-property-pool-list', y),
			onTap: () => {},
			onFinish: () => {
				doc.removeEventListener('keydown', key, true); doc.removeEventListener('pointerdown', additional, true);
				win.removeEventListener('resize', cancel); viewport?.removeEventListener('resize', cancel); viewport?.removeEventListener('scroll', cancel);
				this.cancelDrag = null;
			},
			onActivate: () => {
				if (this.active && alive() && this.surface.isCurrent() && this.surface.file() === file && file?.path === path && this.surface.identity() === canvas && revision === this.revision && !this.busy && !this.surface.busy()) this.beginDrag(event, value, alive, appearance, true);
			},
		});
		this.cancelDrag = cancel;
		doc.addEventListener('keydown', key, true); doc.addEventListener('pointerdown', additional, true);
		win.addEventListener('resize', cancel); viewport?.addEventListener('resize', cancel); viewport?.addEventListener('scroll', cancel);
	}
	private suppressTouchClick(doc: Document): void {
		this.clearTouchSuppression?.();
		const win = doc.defaultView!;
		const stop = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
		const clear = () => { win.clearTimeout(timer); doc.removeEventListener('click', stop, true); doc.removeEventListener('contextmenu', stop, true); doc.removeEventListener('pointerdown', clear, true); this.clearTouchSuppression = null; };
		const timer = win.setTimeout(clear, 400);
		doc.addEventListener('click', stop, true); doc.addEventListener('contextmenu', stop, true); doc.addEventListener('pointerdown', clear, true);
		this.clearTouchSuppression = clear;
	}
	private beginDrag(event: PointerEvent, value: PropertyPoolFavorite, alive: () => boolean, appearance: DragAppearance, touch = false): void {
		const doc = this.surface.contentEl.ownerDocument, win = getOwnerWindow(this.surface.contentEl);
		const file = this.surface.file(), path = file?.path, canvas = this.surface.identity();
		const { width, height, icon } = appearance;
		const readonly = this.surface.readOnly();
  const groupCanvas = this.surface.groups?.canvas();
  const theme = new Component(); theme.load();
		const valid = () => this.active && alive() && this.surface.isCurrent() && this.surface.file() === file && file?.path === path && this.surface.identity() === canvas && this.surface.readOnly() === readonly;
		let preparation = 0;
		let moved = touch, ghost: HTMLElement | null = null, target: PropertyDropTarget | null = null, plan: PropertyPoolTaskPlan | null = null;
		let group: GroupPreview | null = null, draft: HTMLElement | null = null;
  let lastClient: CanvasPoint | null = null, highlighted: CanvasTaskNode | null = null;
  const clearGroup = () => { highlighted?.nodeEl.classList.remove('operon-canvas-group-drop-target'); highlighted = null; group = null; draft?.remove(); draft = null; lastClient = null; };
  const backgroundAt = (x: number, y: number): boolean => {
   if (!groupCanvas) return false;
   const hit = doc.elementFromPoint(x, y);
   if (!hit || !groupCanvas.wrapperEl?.contains(hit) || !this.surface.contentEl.contains(hit)
    || hit.closest('.operon-canvas-property-pool, .operon-canvas-task-pool, .operon-floating-panel, .operon-contextual-hover-menu, .menu, .canvas-controls, .canvas-control-group, .canvas-card-menu, .canvas-node-label, .operon-canvas-group-editor, input, textarea, [contenteditable="true"]')
    || groupCanvas.canvasControlsEl?.contains(hit) || groupCanvas.cardMenuEl?.contains(hit)) return false;
   return ![...groupCanvas.nodes.values()].some(node => (node as { labelEl?: HTMLElement }).labelEl?.contains(hit) || node.nodeEl.contains(hit) && node.getData().type !== 'group');
  };
  const updateGroup = (next: PointerEvent) => {
   highlighted?.nodeEl.classList.remove('operon-canvas-group-drop-target'); highlighted = null;
   group = null; lastClient = null;
   if (!groupCanvas || !this.surface.groups?.prepare || !backgroundAt(next.clientX, next.clientY)) { clearGroup(); return; }
   const point = groupCanvas.posFromClient?.({ x: next.clientX, y: next.clientY });
   if (!point || ![point.x, point.y].every(Number.isFinite) || !groupCanvas.canvasEl) { clearGroup(); return; }
   group = this.surface.groups?.prepare(value, point);
   const reason = this.groupBlocked ? t('notifications', 'canvasGroupSaveFailed') : group?.reason() ?? (!group ? t('notifications', 'canvasGroupUnavailable') : null);
   if (group) {
    lastClient = { x: next.clientX, y: next.clientY };
    if (group.node) {
     draft?.remove(); draft = null;
     highlighted = group.node; highlighted.nodeEl.classList.add('operon-canvas-group-drop-target');
    } else {
    if (!draft) { draft = groupCanvas.canvasEl.createDiv('operon-canvas-group-draft'); draft.createDiv('operon-canvas-group-draft-label'); }
    Object.assign(draft.style, { left: point.x + 'px', top: point.y + 'px', width: group.size.width + 'px', height: group.size.height + 'px' });
    draft.firstElementChild!.textContent = group.title ?? value.label;
    draft.classList.toggle('is-blocked', !!reason);
    }
   }
   if (!group) clearGroup();
   if ((reason || group?.node) && ghost) tooltip = showOperonPointerTooltip(group?.node?.nodeEl ?? ghost, { title: value.label, content: reason ?? group?.title ?? '', taskColor: null, floatingHorizontalBoundary: this.surface.contentEl, constrainToVisualViewport: true });
  };
  let tooltip: ReturnType<typeof showOperonPointerTooltip> | null = null;
		const clearTarget = () => { preparation++; tooltip?.close(); tooltip = null; target = null; plan = null; };
  const targetAt = (x: number, y: number) => this.surface.targetAt(x, y);
  const sameTarget = (a: PropertyDropTarget | null, b: PropertyDropTarget | null) => !!a && !!b && a.id === b.id && a.taskId === b.taskId && a.nodeEl === b.nodeEl && a.current() && b.current();
		const update = (next: PointerEvent) => {
			if (!valid() || group?.current && !group.current()) { cancel(); return; }
			const node = targetAt(next.clientX, next.clientY);
			if (!node) {
    clearTarget(); updateGroup(next);
    if (ghost && this.surface.unavailable) tooltip = showOperonPointerTooltip(ghost, { title: value.label, content: this.surface.unavailable(), taskColor: null,
     floatingHorizontalBoundary: this.surface.contentEl, constrainToVisualViewport: true,
     bindTheme: this.surface.bindTheme ? element => { const lifetime = new Component(); lifetime.load(); this.surface.bindTheme!(element, lifetime); return () => lifetime.unload(); } : undefined });
    return;
   }
   clearGroup();
			if (!sameTarget(node, target)) {
				clearTarget(); target = node;
				if (node) {
                    const ticket = preparation;
                    const showPlan = (prepared: PropertyPoolTaskPlan | null) => {
                        if (!valid() || ticket !== preparation || !sameTarget(target, node)) return;
                        plan = prepared;
                        const reason = !this.surface.supported() ? 'propertyPoolHistoryUnavailable' : (!this.writable() || node.readOnly?.()) ? 'propertyPoolReadOnly'
                            : !plan ? 'propertyPoolValueUnavailable' : plan.reason === 'already-present' ? 'propertyPoolAlreadyPresent'
                                : plan.reason === 'workflow' ? 'propertyPoolWorkflowBlocked' : plan.reason ? 'propertyPoolValueUnavailable' : null;
                        const reminderReason = plan?.reason === 'reminder-missing' ? 'missingAnchor' : plan?.reason === 'reminder-invalid' ? 'invalidAnchor' : plan?.reason === 'reminder-past' ? 'futureTimeRequired' : plan?.reason === 'reminder-duplicate' ? 'duplicateReminder' : null;
                        tooltip = showOperonPointerTooltip(node.nodeEl, { title: value.label, content: this.surface.supported() && this.writable() && reminderReason ? t('reminders', reminderReason) : reason ? t('settings', reason) : plan?.label,
                            taskColor: null, preferredVertical: 'above', floatingHorizontalBoundary: this.surface.contentEl, constrainToVisualViewport: true, bindTheme: this.surface.bindTheme ? element => { const lifetime = new Component(); lifetime.load(); this.surface.bindTheme!(element, lifetime); return () => lifetime.unload(); } : undefined });
                    };
                    try {
                        const prepared = this.bridge.prepare(node.taskId, value);
                        if (prepared instanceof Promise) void prepared.then(showPlan, error => { console.error('Operon: property pool preview failed', error); showPlan(null); });
                        else showPlan(prepared);
                    } catch (error) { console.error('Operon: property pool preview failed', error); showPlan(null); }
				}
			}
			tooltip?.position();
		};
		const move = (next: PointerEvent) => {
			if (next.pointerId !== event.pointerId) return;
			if (!touch && (next.buttons & 1) === 0) { cancel(); return; }
			if (!moved && Math.hypot(next.clientX - event.clientX, next.clientY - event.clientY) < 5) return;
			moved = true; next.preventDefault(); next.stopImmediatePropagation();
			showGhost(next.clientX, next.clientY);
			update(next);
		};
		const showGhost = (x: number, y: number) => {
			if (!ghost) {
				ghost = doc.body.createDiv('operon-canvas-property-pool-drag');
    this.surface.bindTheme?.(ghost, theme);
				ghost.style.width = `${width}px`; ghost.style.height = `${height}px`;
				renderPropertyPoolValueVisual(ghost, value, icon);
				const label = ghost.createSpan({ cls: 'operon-canvas-property-pool-drag-label', text: value.label });
				if (value.type === 'date') label.createEl('small', { cls: 'operon-canvas-property-pool-date-detail', text: resolvePropertyPoolDate(value.key, value.value) ?? '' });
			}
			const viewport = win.visualViewport, left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
			ghost.style.maxWidth = `${Math.max(0, Math.min(width, (viewport?.width ?? win.innerWidth) - 16))}px`;
			ghost.style.left = `${Math.max(left + 8, Math.min(x + 14, left + (viewport?.width ?? win.innerWidth) - ghost.offsetWidth - 8))}px`;
			ghost.style.top = `${Math.max(top + 8, Math.min(y + 14, top + (viewport?.height ?? win.innerHeight) - ghost.offsetHeight - 8))}px`;
		};
		const cancel = () => {
			doc.removeEventListener('pointermove', move, true); doc.removeEventListener('pointerup', up, true);
			doc.removeEventListener('pointercancel', pointerCancel, true); doc.removeEventListener('pointerdown', additional, true);
			doc.removeEventListener('keydown', key, true); win.removeEventListener('blur', cancel); win.removeEventListener('resize', cancel);
			win.visualViewport?.removeEventListener('resize', cancel); win.visualViewport?.removeEventListener('scroll', cancel);
			doc.removeEventListener('visibilitychange', visibility); doc.removeEventListener('contextmenu', context, true);
			if (touch) this.suppressTouchClick(doc);
			theme.unload(); ghost?.remove(); clearTarget(); clearGroup(); this.cancelDrag = null;
		};
		const up = (next: PointerEvent) => {
			if (next.pointerId !== event.pointerId) return;
			if (moved) { next.preventDefault(); next.stopImmediatePropagation(); }
			// Never prepare a new, unseen mutation at release time.
			const captured = plan, node = target, candidate = group;
   const point = groupCanvas?.posFromClient?.({ x: next.clientX, y: next.clientY });
   const create = moved && valid() && !node && candidate && !this.groupBlocked && !this.busy && this.writable()
    && lastClient?.x === next.clientX && lastClient.y === next.clientY && backgroundAt(next.clientX, next.clientY)
    && point?.x === candidate.point.x && point.y === candidate.point.y && !candidate.reason();
			const apply = moved && valid() && node && sameTarget(node, targetAt(next.clientX, next.clientY)) && captured && !captured.reason && !node.readOnly?.() && this.writable();
			cancel();
			if (apply && node && captured) void this.commit(captured, node, valid);
   else if (create && candidate) {
    this.busy = true;
    const sessionRevision = this.groupSession;
    void candidate.commit().then(result => {
     if (result === 'closed' && sessionRevision === this.groupSession) this.groupBlocked = true;
    }, error => {
     console.error('Operon: property pool group drop failed', error);
     if (sessionRevision === this.groupSession) this.groupBlocked = true;
     new Notice(t('notifications', 'canvasGroupSaveFailed'));
    }).finally(() => { this.busy = false; });
   }
		};
		const pointerCancel = (next: PointerEvent) => { if (next.pointerId === event.pointerId) cancel(); };
		const additional = () => cancel();
		const visibility = () => { if (doc.visibilityState !== 'visible') cancel(); };
		const context = (next: Event) => { if (touch) { next.preventDefault(); next.stopImmediatePropagation(); } };
		const key = (next: KeyboardEvent) => { if (next.key === 'Escape') { next.preventDefault(); next.stopImmediatePropagation(); cancel(); } };
		this.cancelDrag = cancel;
		event.preventDefault(); event.stopPropagation();
		doc.addEventListener('pointermove', move, { capture: true, passive: false }); doc.addEventListener('pointerup', up, true);
		doc.addEventListener('pointercancel', pointerCancel, true); doc.addEventListener('pointerdown', additional, true);
		doc.addEventListener('keydown', key, true); win.addEventListener('blur', cancel); win.addEventListener('resize', cancel);
		win.visualViewport?.addEventListener('resize', cancel); win.visualViewport?.addEventListener('scroll', cancel);
		doc.addEventListener('visibilitychange', visibility); doc.addEventListener('contextmenu', context, true);
		if (touch) showGhost(event.clientX, event.clientY);
	}
 private async commit(plan: PropertyPoolTaskPlan, node: PropertyDropTarget, alive: () => boolean): Promise<void> {
  if (this.busy || this.surface.busy()) return;
  const revision = this.revision;
  const valid = () => revision === this.revision && alive() && this.writable() && !node.readOnly?.() && node.current() && node.taskId === plan.id;
  if (!valid()) return;
  this.busy = true;
  try { this.notice(await this.surface.apply(plan, valid, result => this.notice(result))); }
  catch (error) { console.error('Operon: property pool drop failed', error); this.notice({ status: 'failed' }); }
  finally { this.busy = false; }
 }
	onunload(): void { this.active = false; this.cancel(); this.clearTouchSuppression?.(); }
}
