import { Component, Notice } from 'obsidian';
import { t } from '../core/i18n';
import { getOwnerWindow } from '../core/dom-compat';
import type { PropertyPoolFavorite } from '../core/property-value-pool';
import type { PropertyPoolTaskBridge, PropertyPoolTaskPlan, PropertyPoolTaskResult } from '../core/property-pool-task-operation';
import { canvasRelationTaskId } from '../systems/canvas-task-relations';
import type { CanvasTaskNode, TaskCanvasView } from './canvas-task-adapter';
import { CanvasTaskHistory } from './canvas-task-history';
import { showOperonPointerTooltip } from './operon-hover-tooltip';

export class CanvasPropertyValueDrop extends Component {
	private cancelDrag: (() => void) | null = null;
	private busy = false;
	private active = true;
	private revision = 0;
	constructor(private view: TaskCanvasView, private history: CanvasTaskHistory, private bridge: PropertyPoolTaskBridge, private isCurrent: () => boolean) { super(); }
	get dragging(): boolean { return this.cancelDrag !== null; }
	cancel(): void { this.cancelDrag?.(); }
	invalidate(): void { this.revision++; this.cancel(); }
	private writable(): boolean { return this.active && this.isCurrent() && !this.view.canvas.readonly && this.history.supported; }
	private notice(result: PropertyPoolTaskResult): void {
		if (result.status !== 'committed' || result.warning) new Notice(t('settings', result.status === 'committed' ? 'propertyPoolRefreshWarning' : 'propertyPoolDropFailed'));
	}
	start(event: PointerEvent, value: PropertyPoolFavorite, alive: () => boolean): void {
		if (!this.active || this.busy || this.history.isBusy || event.button !== 0 || event.isPrimary === false
			|| event.pointerType === 'touch' || (event.target as HTMLElement).closest('button, a, input')) return;
		this.cancel();
		const doc = this.view.contentEl.ownerDocument, win = getOwnerWindow(this.view.contentEl);
		const file = this.view.file, path = file?.path, canvas = this.view.canvas;
		const readonly = canvas.readonly;
		const valid = () => this.active && alive() && this.isCurrent() && this.view.file === file && file?.path === path && this.view.canvas === canvas && canvas.readonly === readonly;
		let moved = false, ghost: HTMLElement | null = null, target: CanvasTaskNode | null = null, plan: PropertyPoolTaskPlan | null = null;
		let tooltip: ReturnType<typeof showOperonPointerTooltip> | null = null;
		const clearTarget = () => { tooltip?.close(); tooltip = null; target = null; plan = null; };
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
			if (node !== target) {
				clearTarget(); target = node;
				if (node) {
					plan = this.bridge.prepare(canvasRelationTaskId(node)!, value);
					const reason = !this.history.supported ? 'propertyPoolHistoryUnavailable' : !this.writable() ? 'propertyPoolReadOnly'
						: !plan ? 'propertyPoolValueUnavailable' : plan.reason === 'already-present' ? 'propertyPoolAlreadyPresent'
							: plan.reason === 'workflow' ? 'propertyPoolWorkflowBlocked' : plan.reason ? 'propertyPoolValueUnavailable' : null;
					tooltip = showOperonPointerTooltip(node.nodeEl, { title: value.label, content: reason ? t('settings', reason) : plan?.label,
						taskColor: null, preferredVertical: 'above', floatingHorizontalBoundary: this.view.contentEl });
				}
			}
			tooltip?.position();
		};
		const move = (next: PointerEvent) => {
			if (next.pointerId !== event.pointerId) return;
			if ((next.buttons & 1) === 0) { cancel(); return; }
			if (!moved && Math.hypot(next.clientX - event.clientX, next.clientY - event.clientY) < 5) return;
			moved = true; next.preventDefault(); next.stopImmediatePropagation();
			ghost ??= doc.body.createDiv({ cls: 'operon-canvas-property-pool-drag', text: value.label });
			ghost.style.left = `${next.clientX + 14}px`; ghost.style.top = `${next.clientY + 14}px`;
			update(next);
		};
		const cancel = () => {
			doc.removeEventListener('pointermove', move, true); doc.removeEventListener('pointerup', up, true);
			doc.removeEventListener('pointercancel', pointerCancel, true); doc.removeEventListener('pointerdown', additional, true);
			doc.removeEventListener('keydown', key, true); win.removeEventListener('blur', cancel);
			ghost?.remove(); clearTarget(); this.cancelDrag = null;
		};
		const up = (next: PointerEvent) => {
			if (next.pointerId !== event.pointerId) return;
			if (moved) { next.preventDefault(); next.stopImmediatePropagation(); }
			// Never prepare a new, unseen mutation at release time.
			const captured = plan, node = target;
			const apply = moved && valid() && node && node === targetAt(next.clientX, next.clientY) && captured && !captured.reason && this.writable();
			cancel();
			if (apply && node && captured) void this.commit(captured, node, file, path);
		};
		const pointerCancel = (next: PointerEvent) => { if (next.pointerId === event.pointerId) cancel(); };
		const additional = () => cancel();
		const key = (next: KeyboardEvent) => { if (next.key === 'Escape') { next.preventDefault(); next.stopImmediatePropagation(); cancel(); } };
		this.cancelDrag = cancel;
		event.preventDefault(); event.stopPropagation();
		doc.addEventListener('pointermove', move, true); doc.addEventListener('pointerup', up, true);
		doc.addEventListener('pointercancel', pointerCancel, true); doc.addEventListener('pointerdown', additional, true);
		doc.addEventListener('keydown', key, true); win.addEventListener('blur', cancel);
	}
	private async commit(plan: PropertyPoolTaskPlan, node: CanvasTaskNode, file: TaskCanvasView['file'], path: string | undefined): Promise<void> {
		if (this.busy || this.history.isBusy) return;
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
	onunload(): void { this.active = false; this.cancel(); }
}
