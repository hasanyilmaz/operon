import type { KanbanCardDropResult } from '../types/kanban';

export class KanbanDragInteractionGate {
	private active = false;
	private renderPending = false;

	isActive(): boolean {
		return this.active;
	}

	begin(): void {
		this.active = true;
	}

	deferRenderIfActive(): boolean {
		if (!this.active) return false;
		this.renderPending = true;
		return true;
	}

	end(): boolean {
		if (!this.active) return false;
		this.active = false;
		const renderPending = this.renderPending;
		this.renderPending = false;
		return renderPending;
	}

	reset(): void {
		this.active = false;
		this.renderPending = false;
	}
}

export class KanbanDropPersistenceGate {
	private pending = 0;

	isActive(): boolean {
		return this.pending > 0;
	}

	begin(): void {
		this.pending += 1;
	}

	end(): boolean {
		if (this.pending === 0) return false;
		this.pending -= 1;
		return this.pending === 0;
	}

	reset(): boolean {
		const wasActive = this.pending > 0;
		this.pending = 0;
		return wasActive;
	}
}

export type KanbanDropUiSettlement = 'succeeded' | 'failed' | 'cancelled';

export function classifyKanbanDropCallbackSettlement(
	result: KanbanCardDropResult,
): KanbanDropUiSettlement {
	if (result === 'cancelled') return 'cancelled';
	if (result === 'failed') return 'failed';
	return 'succeeded';
}

export function shouldSuppressKanbanGestureClick(
	sourceTaskId: string,
	clickedTaskId: string | null,
): boolean {
	return sourceTaskId.length > 0 && clickedTaskId === sourceTaskId;
}
