import { resolvePropertyPoolDate } from '../core/property-pool-dates';
import { renderPropertyPoolValueVisual } from './property-pool-value-visual';
import { Component, Notice } from 'obsidian';
import { t } from '../core/i18n';
import { getOwnerWindow } from '../core/dom-compat';
import type { PropertyPoolFavorite } from '../core/property-value-pool';
import type { PropertyPoolTaskBridge, PropertyPoolTaskPlan, PropertyPoolTaskResult } from '../core/property-pool-task-operation';
import { canvasRelationTaskId } from '../systems/canvas-task-relations';
import type { CanvasTaskNode, TaskCanvasView, CanvasPoint } from './canvas-task-adapter';
import { CanvasTaskHistory } from './canvas-task-history';
import { beginLongPressTouchGesture, scrollTouchSurface } from './touch-drag-session';
import { showOperonPointerTooltip } from './operon-hover-tooltip';

import type { CanvasGroups } from './canvas-groups';
type GroupPreview = NonNullable<ReturnType<CanvasGroups['prepareCreate']>>;
type PrepareGroup = (value: PropertyPoolFavorite, point: CanvasPoint) => GroupPreview | null;

interface DragAppearance { width: number; height: number; icon: string }

export class CanvasPropertyValueDrop extends Component {
	private cancelDrag: (() => void) | null = null;
	private clearTouchSuppression: (() => void) | null = null;
	private busy = false;
	private active = true;
	private revision = 0;
 private groupBlocked = false;
 private groupSession = 0;
 resetGroupSession(): void { this.invalidate(); this.groupSession++; this.groupBlocked = false; }
	constructor(private view: TaskCanvasView, private history: CanvasTaskHistory, private bridge: PropertyPoolTaskBridge, private isCurrent: () => boolean, private prepareGroup?: PrepareGroup) { super(); }
	get dragging(): boolean { return this.cancelDrag !== null; }
	cancel(): void { this.cancelDrag?.(); }
	invalidate(): void { this.revision++; this.cancel(); }
	invalidateSources(): void { if (!this.busy) this.revision++; this.cancel(); }
	private writable(): boolean { return this.active && this.isCurrent() && !this.view.canvas.readonly && this.history.supported; }
	private notice(result: PropertyPoolTaskResult): void {
        if (result.periodicNote) new Notice(t('notifications', 'periodicNoteRecoveryRequired', {
            kind: t('settings', result.periodicNote.kind === 'weekly' ? 'fileTaskWeeklyNotes' : 'fileTaskDailyNotes'), path: result.periodicNote.path,
        }));
		if (result.status !== 'committed' || result.warning) new Notice(t('settings', result.status === 'committed' ? 'propertyPoolRefreshWarning' : 'propertyPoolDropFailed'));
	}
	start(event: PointerEvent, value: PropertyPoolFavorite, alive: () => boolean): void {
		if (!this.active || this.busy || this.history.isInputBusy || event.button !== 0 || event.isPrimary === false
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
		const file = this.view.file, path = file?.path, canvas = this.view.canvas, revision = this.revision;
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
				if (this.active && alive() && this.isCurrent() && this.view.file === file && file?.path === path && this.view.canvas === canvas && revision === this.revision && !this.busy && !this.history.isInputBusy) this.beginDrag(event, value, alive, appearance, true);
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
		const doc = this.view.contentEl.ownerDocument, win = getOwnerWindow(this.view.contentEl);
		const file = this.view.file, path = file?.path, canvas = this.view.canvas;
		const { width, height, icon } = appearance;
		const readonly = canvas.readonly;
		const valid = () => this.active && alive() && this.isCurrent() && this.view.file === file && file?.path === path && this.view.canvas === canvas && canvas.readonly === readonly;
		let preparation = 0;
		let moved = touch, ghost: HTMLElement | null = null, target: CanvasTaskNode | null = null, plan: PropertyPoolTaskPlan | null = null;
		let group: GroupPreview | null = null, draft: HTMLElement | null = null;
  let lastClient: CanvasPoint | null = null;
  const clearGroup = () => { group = null; draft?.remove(); draft = null; lastClient = null; };
  const backgroundAt = (x: number, y: number): boolean => {
   const hit = doc.elementFromPoint(x, y);
   if (!hit || !canvas.wrapperEl?.contains(hit) || !this.view.contentEl.contains(hit)
    || hit.closest('.operon-canvas-property-pool, .operon-canvas-task-pool, .operon-floating-panel, .operon-contextual-hover-menu, .menu, .canvas-controls, .canvas-control-group, .canvas-card-menu')
    || canvas.canvasControlsEl?.contains(hit) || canvas.cardMenuEl?.contains(hit)) return false;
   return ![...canvas.nodes.values()].some(node => node.nodeEl.contains(hit));
  };
  const updateGroup = (next: PointerEvent) => {
   group = null; lastClient = null;
   if (!this.prepareGroup || !backgroundAt(next.clientX, next.clientY)) { clearGroup(); return; }
   const point = canvas.posFromClient?.({ x: next.clientX, y: next.clientY });
   if (!point || ![point.x, point.y].every(Number.isFinite) || !canvas.canvasEl) { clearGroup(); return; }
   group = this.prepareGroup(value, point);
   const reason = this.groupBlocked ? t('notifications', 'canvasGroupSaveFailed') : group?.reason() ?? (!group ? t('notifications', 'canvasGroupUnavailable') : null);
   if (group) {
    lastClient = { x: next.clientX, y: next.clientY };
    if (!draft) { draft = canvas.canvasEl.createDiv('operon-canvas-group-draft'); draft.createDiv('operon-canvas-group-draft-label'); }
    Object.assign(draft.style, { left: point.x + 'px', top: point.y + 'px', width: group.size.width + 'px', height: group.size.height + 'px' });
    draft.firstElementChild!.textContent = group.title ?? value.label;
    draft.classList.toggle('is-blocked', !!reason);
   }
   if (!group) clearGroup();
   if (reason && ghost) tooltip = showOperonPointerTooltip(ghost, { title: value.label, content: reason, taskColor: null, floatingHorizontalBoundary: this.view.contentEl, constrainToVisualViewport: true });
  };
  let tooltip: ReturnType<typeof showOperonPointerTooltip> | null = null;
		const clearTarget = () => { preparation++; tooltip?.close(); tooltip = null; target = null; plan = null; };
		const targetAt = (x: number, y: number): CanvasTaskNode | null => {
			const hit = doc.elementFromPoint(x, y);
			if (!hit || !this.view.contentEl.contains(hit)) return null;
			for (const node of canvas.nodes.values()) {
				if (node.getData().type === 'text' && node.nodeEl.contains(hit) && canvasRelationTaskId(node)) return node;
			}
			return null;
		};
		const update = (next: PointerEvent) => {
			if (!valid()) { cancel(); return; }
			const node = targetAt(next.clientX, next.clientY);
			if (!node) { clearTarget(); updateGroup(next); return; }
   clearGroup();
			if (node !== target) {
				clearTarget(); target = node;
				if (node) {
                    const ticket = preparation;
                    const showPlan = (prepared: PropertyPoolTaskPlan | null) => {
                        if (!valid() || ticket !== preparation || target !== node) return;
                        plan = prepared;
                        const reason = !this.history.supported ? 'propertyPoolHistoryUnavailable' : !this.writable() ? 'propertyPoolReadOnly'
                            : !plan ? 'propertyPoolValueUnavailable' : plan.reason === 'already-present' ? 'propertyPoolAlreadyPresent'
                                : plan.reason === 'workflow' ? 'propertyPoolWorkflowBlocked' : plan.reason ? 'propertyPoolValueUnavailable' : null;
                        const reminderReason = plan?.reason === 'reminder-missing' ? 'missingAnchor' : plan?.reason === 'reminder-invalid' ? 'invalidAnchor' : plan?.reason === 'reminder-past' ? 'futureTimeRequired' : plan?.reason === 'reminder-duplicate' ? 'duplicateReminder' : null;
                        tooltip = showOperonPointerTooltip(node.nodeEl, { title: value.label, content: this.history.supported && this.writable() && reminderReason ? t('reminders', reminderReason) : reason ? t('settings', reason) : plan?.label,
                            taskColor: null, preferredVertical: 'above', floatingHorizontalBoundary: this.view.contentEl, constrainToVisualViewport: true });
                    };
                    try {
                        const prepared = this.bridge.prepare(canvasRelationTaskId(node)!, value);
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
			ghost?.remove(); clearTarget(); clearGroup(); this.cancelDrag = null;
		};
		const up = (next: PointerEvent) => {
			if (next.pointerId !== event.pointerId) return;
			if (moved) { next.preventDefault(); next.stopImmediatePropagation(); }
			// Never prepare a new, unseen mutation at release time.
			const captured = plan, node = target, candidate = group;
   const point = canvas.posFromClient?.({ x: next.clientX, y: next.clientY });
   const create = moved && valid() && !node && candidate && !this.groupBlocked && !this.busy && this.writable()
    && lastClient?.x === next.clientX && lastClient.y === next.clientY && backgroundAt(next.clientX, next.clientY)
    && point?.x === candidate.point.x && point.y === candidate.point.y && !candidate.reason();
			const apply = moved && valid() && node && node === targetAt(next.clientX, next.clientY) && captured && !captured.reason && this.writable();
			cancel();
			if (apply && node && captured) void this.commit(captured, node, file, path);
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
	private async commit(plan: PropertyPoolTaskPlan, node: CanvasTaskNode, file: TaskCanvasView['file'], path: string | undefined): Promise<void> {
		if (this.busy || this.history.isInputBusy || this.history.isTaskPending(plan.id)) return;
		const revision = this.revision;
		const valid = () => revision === this.revision && this.writable() && this.view.file === file && file?.path === path
			&& this.view.canvas.nodes.get(node.id) === node && canvasRelationTaskId(node) === plan.id;
		this.busy = true;
		const release = this.history.reserve(), unlock = this.history.lockInput();
		try {
			const result = await this.bridge.apply(plan, 'drop', valid);
			if (result.status === 'committed') {
				const recorded = this.history.recordSourceChange(async direction => {
					const historyValid = () => this.writable() && this.view.file === file && file?.path === path;
					const outcome = await this.bridge.apply(plan, direction, historyValid); this.notice(outcome);
					return outcome.status === 'committed';
				});
				if (!recorded) result.warning = true;
			}
			this.notice(result);
		} catch (error) { console.error('Operon: property pool drop failed', error); this.notice({ status: 'failed' }); }
		finally { unlock(); release(); this.busy = false; }
	}
	onunload(): void { this.active = false; this.cancel(); this.clearTouchSuppression?.(); }
}
