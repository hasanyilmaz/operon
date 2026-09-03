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

interface LongPressTouchGestureOptions {
	target: HTMLElement;
	event: PointerEvent;
	longPressMs: number;
	cancelDistancePx: number;
	onScroll: (deltaX: number, deltaY: number) => void;
	onTap: (event: PointerEvent) => void;
	onActivate: (pointerId: number, clientX: number, clientY: number) => void;
}

export function beginLongPressTouchGesture(options: LongPressTouchGestureOptions): () => void {
	const { target, event } = options;
	event.preventDefault();
	event.stopPropagation();
	const ownerWindow = target.ownerDocument.defaultView ?? window;
	const ownerDocument = target.ownerDocument;
	const pointerId = event.pointerId;
	const fence = new TouchDragSessionFence();
	const generation = fence.begin(pointerId);
	const initialX = event.clientX;
	const initialY = event.clientY;
	const longPressMs = Number.isFinite(options.longPressMs)
		? Math.max(150, Math.min(600, Math.round(options.longPressMs)))
		: 260;
	const cancelDistancePx = Number.isFinite(options.cancelDistancePx)
		? Math.max(4, Math.min(24, Math.round(options.cancelDistancePx)))
		: 10;
	let previousX = initialX;
	let previousY = initialY;
	let latestX = initialX;
	let latestY = initialY;
	let scrolling = false;
	let settled = false;
	let timerId: ReturnType<Window['setTimeout']> | null = null;

	const cleanup = (): void => {
		if (settled) return;
		settled = true;
		if (timerId !== null) ownerWindow.clearTimeout(timerId);
		fence.cancel(generation);
		ownerWindow.removeEventListener('pointermove', onPointerMove, true);
		ownerWindow.removeEventListener('pointerup', onPointerUp, true);
		ownerWindow.removeEventListener('pointercancel', onPointerCancel, true);
		ownerWindow.removeEventListener('pointerdown', onPointerDown, true);
		ownerWindow.removeEventListener('blur', cleanup, true);
		ownerDocument.removeEventListener('visibilitychange', onVisibilityChange, true);
	};
	const onPointerMove = (moveEvent: PointerEvent): void => {
		if (!fence.isCurrent(generation, moveEvent.pointerId)) return;
		if (!target.isConnected) {
			cleanup();
			return;
		}
		moveEvent.preventDefault();
		moveEvent.stopPropagation();
		latestX = moveEvent.clientX;
		latestY = moveEvent.clientY;
		if (!scrolling && Math.hypot(latestX - initialX, latestY - initialY) > cancelDistancePx) {
			scrolling = true;
			if (timerId !== null) ownerWindow.clearTimeout(timerId);
		}
		if (scrolling) options.onScroll(previousX - latestX, previousY - latestY);
		previousX = latestX;
		previousY = latestY;
	};
	const onPointerUp = (upEvent: PointerEvent): void => {
		if (!fence.isCurrent(generation, upEvent.pointerId)) return;
		upEvent.preventDefault();
		upEvent.stopPropagation();
		const tapped = !scrolling
			&& Math.hypot(upEvent.clientX - initialX, upEvent.clientY - initialY) <= cancelDistancePx;
		cleanup();
		if (tapped) options.onTap(upEvent);
	};
	const onPointerCancel = (cancelEvent: PointerEvent): void => {
		if (cancelEvent.pointerId === pointerId) cleanup();
	};
	const onPointerDown = (downEvent: PointerEvent): void => {
		if (isTouchLikePointer(downEvent) && downEvent.pointerId !== pointerId) cleanup();
	};
	const onVisibilityChange = (): void => {
		if (ownerDocument.visibilityState !== 'visible') cleanup();
	};

	timerId = ownerWindow.setTimeout(() => {
		if (scrolling || !target.isConnected || !fence.isCurrent(generation, pointerId)) {
			cleanup();
			return;
		}
		cleanup();
		options.onActivate(pointerId, latestX, latestY);
	}, longPressMs);
	ownerWindow.addEventListener('pointermove', onPointerMove, { capture: true, passive: false });
	ownerWindow.addEventListener('pointerup', onPointerUp, true);
	ownerWindow.addEventListener('pointercancel', onPointerCancel, true);
	ownerWindow.addEventListener('pointerdown', onPointerDown, true);
	ownerWindow.addEventListener('blur', cleanup, true);
	ownerDocument.addEventListener('visibilitychange', onVisibilityChange, true);
	return cleanup;
}

export function scrollTouchSurface(target: HTMLElement, viewportSelector: string, deltaY: number): void {
	if (!Number.isFinite(deltaY) || Math.abs(deltaY) < 0.5) return;
	const viewport = target.closest<HTMLElement>(viewportSelector);
	if (!viewport) return;
	const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
	viewport.scrollTop = Math.max(0, Math.min(maxScrollTop, viewport.scrollTop + deltaY));
}

export function createVerticalTouchAutoScroll(
	target: HTMLElement,
	viewportSelector: string,
	onScroll: (clientX: number, clientY: number) => void,
): { update: (clientX: number, clientY: number) => void; stop: () => void } {
	const ownerWindow = target.ownerDocument.defaultView ?? window;
	let frameId: number | null = null;
	let clientX = 0;
	let clientY = 0;
	const stop = (): void => {
		if (frameId !== null) ownerWindow.cancelAnimationFrame(frameId);
		frameId = null;
	};
	const run = (): void => {
		frameId = null;
		const viewport = target.closest<HTMLElement>(viewportSelector);
		if (!target.isConnected || !viewport) return;
		const rect = viewport.getBoundingClientRect();
		if (clientX < rect.left || clientX > rect.right) return;
		const direction = clientY <= rect.top + 56 ? -1 : clientY >= rect.bottom - 56 ? 1 : 0;
		if (direction === 0) return;
		const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
		const nextTop = Math.max(0, Math.min(maxScrollTop, viewport.scrollTop + (direction * 12)));
		if (nextTop === viewport.scrollTop) return;
		viewport.scrollTop = nextTop;
		onScroll(clientX, clientY);
		frameId = ownerWindow.requestAnimationFrame(run);
	};
	return {
		update: (nextClientX, nextClientY) => {
			clientX = nextClientX;
			clientY = nextClientY;
			if (frameId === null) frameId = ownerWindow.requestAnimationFrame(run);
		},
		stop,
	};
}
