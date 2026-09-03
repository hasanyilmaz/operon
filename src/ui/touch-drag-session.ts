export type TouchDragIntent = 'pending' | 'scroll-x' | 'scroll-y';

interface TouchPointerLike {
	button: number;
	isPrimary?: boolean;
	pointerType: string;
}

export function isPrimaryTouchLikePointer(event: TouchPointerLike): boolean {
	return event.button === 0
		&& event.isPrimary !== false
		&& isTouchLikePointer(event);
}

export function isTouchLikePointer(event: Pick<TouchPointerLike, 'pointerType'>): boolean {
	return event.pointerType === 'touch' || event.pointerType === 'pen';
}

export function resolveTouchDragIntent(
	deltaX: number,
	deltaY: number,
	horizontalThresholdPx: number,
	generalThresholdPx: number,
): TouchDragIntent {
	const absoluteX = Math.abs(deltaX);
	const absoluteY = Math.abs(deltaY);
	if (absoluteX > horizontalThresholdPx && absoluteX >= absoluteY) return 'scroll-x';
	if (Math.hypot(absoluteX, absoluteY) > generalThresholdPx) return 'scroll-y';
	return 'pending';
}

export class TouchDragSessionFence {
	private generation = 0;
	private pointerId: number | null = null;

	begin(pointerId: number): number {
		this.pointerId = pointerId;
		this.generation += 1;
		return this.generation;
	}

	isCurrent(generation: number, pointerId?: number): boolean {
		return generation === this.generation
			&& this.pointerId !== null
			&& (pointerId === undefined || pointerId === this.pointerId);
	}

	cancel(generation?: number): void {
		if (generation !== undefined && generation !== this.generation) return;
		this.pointerId = null;
		this.generation += 1;
	}
}
