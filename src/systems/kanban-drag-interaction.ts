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
