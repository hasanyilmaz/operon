export type PinnedTaskReorderAxis = 'horizontal' | 'vertical' | 'grid';

export interface PinnedTaskReorderOptions {
	itemSelector: string;
	getAxis: () => PinnedTaskReorderAxis;
	isEnabled: () => boolean;
	onCommit: (orderedTaskIds: string[]) => Promise<void>;
	onInteractionStart?: () => void;
	onInteractionEnd?: () => void;
	onSettled?: () => void;
	enableTouch?: boolean;
}

export interface PinnedTaskReorderController {
	isActive(): boolean;
	destroy(): void;
}

interface ActiveDrag {
	kind: 'native' | 'touch';
	item: HTMLElement;
	snapshot: string[];
	dropping: boolean;
	pointerId: number | null;
	latestX: number;
	latestY: number;
}

interface PendingTouch {
	item: HTMLElement;
	pointerId: number;
	startX: number;
	startY: number;
	latestX: number;
	latestY: number;
	timer: number;
	wasDraggable: boolean;
}

const INTERACTIVE_TARGET_SELECTOR = [
	'button',
	'a',
	'input',
	'textarea',
	'select',
	'[contenteditable="true"]',
	'.operon-calendar-hover-menu',
].join(',');

const TOUCH_LONG_PRESS_MS = 260;
const TOUCH_SCROLL_INTENT_PX = 10;
const EDGE_SCROLL_ZONE_PX = 64;
const EDGE_SCROLL_MAX_STEP_PX = 18;
const CLICK_SUPPRESSION_MS = 350;
const DROP_POSITION_CLASSES = [
	'operon-pinned-drop-position--horizontal',
	'operon-pinned-drop-position--vertical',
	'operon-pinned-drop-position--grid',
] as const;

function asElement(target: EventTarget | null): Element | null {
	if (typeof target !== 'object' || target === null) return null;
	return (target as Node).nodeType === 1 ? target as Element : null;
}

function getTaskId(item: HTMLElement): string {
	return item.dataset.operonPinnedTaskId?.trim() ?? '';
}

function getItems(container: HTMLElement, selector: string): HTMLElement[] {
	return Array.from(container.querySelectorAll<HTMLElement>(`:scope > ${selector}`));
}

function getOrder(container: HTMLElement, selector: string): string[] {
	return getItems(container, selector).map(getTaskId).filter(Boolean);
}

function ordersEqual(left: string[], right: string[]): boolean {
	return left.length === right.length && left.every((id, index) => id === right[index]);
}

function clearDropPosition(item: HTMLElement): void {
	item.classList.remove(...DROP_POSITION_CLASSES);
}

function showDropPosition(item: HTMLElement, axis: PinnedTaskReorderAxis): void {
	clearDropPosition(item);
	item.classList.add(`operon-pinned-drop-position--${axis}`);
}

function restoreOrder(container: HTMLElement, selector: string, snapshot: string[]): void {
	const items = getItems(container, selector);
	const byId = new Map(items.map(item => [getTaskId(item), item]));
	for (const id of snapshot) {
		const item = byId.get(id);
		if (!item) continue;
		container.appendChild(item);
		byId.delete(id);
	}
	for (const item of items) {
		if (byId.has(getTaskId(item))) container.appendChild(item);
	}
}

function isInteractiveTarget(target: EventTarget | null, item: HTMLElement): boolean {
	const element = asElement(target);
	if (!element || element === item) return false;
	const interactive = element.closest(INTERACTIVE_TARGET_SELECTOR);
	return !!interactive && item.contains(interactive);
}

function resolveLinearBefore(
	items: HTMLElement[],
	coordinate: number,
	axis: 'horizontal' | 'vertical',
): HTMLElement | null {
	for (const item of items) {
		const rect = item.getBoundingClientRect();
		const midpoint = axis === 'horizontal'
			? rect.left + rect.width / 2
			: rect.top + rect.height / 2;
		if (coordinate < midpoint) return item;
	}
	return null;
}

function resolveGridBefore(items: HTMLElement[], clientX: number, clientY: number): HTMLElement | null {
	if (items.length === 0) return null;
	const rows: Array<{ items: HTMLElement[]; top: number; bottom: number; center: number }> = [];
	for (const item of items) {
		const rect = item.getBoundingClientRect();
		const previous = rows[rows.length - 1];
		const rowTolerance = Math.max(8, rect.height * 0.4);
		if (!previous || Math.abs(rect.top - previous.top) > rowTolerance) {
			rows.push({
				items: [item],
				top: rect.top,
				bottom: rect.bottom,
				center: rect.top + rect.height / 2,
			});
			continue;
		}
		previous.items.push(item);
		previous.top = Math.min(previous.top, rect.top);
		previous.bottom = Math.max(previous.bottom, rect.bottom);
		previous.center = (previous.top + previous.bottom) / 2;
	}

	if (clientY < rows[0].top) return rows[0].items[0] ?? null;
	const lastRow = rows[rows.length - 1];
	if (lastRow && clientY > lastRow.bottom) return null;

	let rowIndex = rows.length - 1;
	for (let index = 0; index < rows.length - 1; index += 1) {
		const boundary = (rows[index].center + rows[index + 1].center) / 2;
		if (clientY < boundary) {
			rowIndex = index;
			break;
		}
	}
	const row = rows[rowIndex];
	for (const item of row.items) {
		const rect = item.getBoundingClientRect();
		if (clientX < rect.left + rect.width / 2) return item;
	}
	return rows[rowIndex + 1]?.items[0] ?? null;
}

function resolveBefore(
	container: HTMLElement,
	selector: string,
	draggedItem: HTMLElement,
	axis: PinnedTaskReorderAxis,
	clientX: number,
	clientY: number,
): HTMLElement | null {
	const items = getItems(container, selector).filter(item => item !== draggedItem);
	if (axis === 'horizontal') return resolveLinearBefore(items, clientX, 'horizontal');
	if (axis === 'vertical') return resolveLinearBefore(items, clientY, 'vertical');
	return resolveGridBefore(items, clientX, clientY);
}

function moveItem(container: HTMLElement, item: HTMLElement, before: HTMLElement | null): void {
	if (before === item || item.nextElementSibling === before) return;
	if (before) container.insertBefore(item, before);
	else if (item !== container.lastElementChild) container.appendChild(item);
}

function edgeScroll(
	container: HTMLElement,
	axis: PinnedTaskReorderAxis,
	clientX: number,
	clientY: number,
): void {
	const rect = container.getBoundingClientRect();
	const scrollAxis = axis === 'horizontal' ? 'horizontal' : 'vertical';
	const coordinate = scrollAxis === 'horizontal' ? clientX : clientY;
	const start = scrollAxis === 'horizontal' ? rect.left : rect.top;
	const end = scrollAxis === 'horizontal' ? rect.right : rect.bottom;
	const zone = Math.min(EDGE_SCROLL_ZONE_PX, Math.max(0, (end - start) / 2));
	if (zone === 0) return;
	const distanceFromStart = coordinate - start;
	const distanceFromEnd = end - coordinate;
	let direction = 0;
	let proximity = 0;
	if (distanceFromStart < zone && distanceFromStart <= distanceFromEnd) {
		direction = -1;
		proximity = Math.min(1, Math.max(0, (zone - distanceFromStart) / zone));
	} else if (distanceFromEnd < zone) {
		direction = 1;
		proximity = Math.min(1, Math.max(0, (zone - distanceFromEnd) / zone));
	}
	if (direction === 0) return;
	const step = direction * Math.max(4, Math.round(EDGE_SCROLL_MAX_STEP_PX * proximity));
	if (scrollAxis === 'horizontal') container.scrollLeft += step;
	else container.scrollTop += step;
}

function suppressNextClick(ownerWindow: Window, itemSelector: string): () => void {
	let timer: number | null = null;
	const cleanup = (): void => {
		ownerWindow.removeEventListener('click', onClick, true);
		if (timer !== null) ownerWindow.clearTimeout(timer);
		timer = null;
	};
	const onClick = (event: MouseEvent): void => {
		const target = asElement(event.target);
		if (!target?.closest(itemSelector)) return;
		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();
		cleanup();
	};
	ownerWindow.addEventListener('click', onClick, true);
	timer = ownerWindow.setTimeout(cleanup, CLICK_SUPPRESSION_MS);
	return cleanup;
}

export function bindPinnedTaskReorder(
	container: HTMLElement,
	options: PinnedTaskReorderOptions,
): PinnedTaskReorderController {
	const ownerWindow = container.ownerDocument.defaultView ?? window;
	let active: ActiveDrag | null = null;
	let pendingTouch: PendingTouch | null = null;
	let clickSuppressionCleanup: (() => void) | null = null;
	let touchScrollFrame: number | null = null;
	let settledTimer: number | null = null;
	let shieldedItem: HTMLElement | null = null;

	const armClickSuppression = (): void => {
		clickSuppressionCleanup?.();
		clickSuppressionCleanup = suppressNextClick(ownerWindow, options.itemSelector);
	};

	const findItem = (target: EventTarget | null): HTMLElement | null => {
		const element = asElement(target);
		const item = element?.closest<HTMLElement>(options.itemSelector) ?? null;
		return item && container.contains(item) ? item : null;
	};

	const stopTouchScrollLoop = (): void => {
		if (touchScrollFrame === null) return;
		ownerWindow.cancelAnimationFrame(touchScrollFrame);
		touchScrollFrame = null;
	};

	const runTouchScrollLoop = (): void => {
		touchScrollFrame = null;
		if (!active || active.kind !== 'touch') return;
		edgeScroll(container, options.getAxis(), active.latestX, active.latestY);
		const before = resolveBefore(
			container,
			options.itemSelector,
			active.item,
			options.getAxis(),
			active.latestX,
			active.latestY,
		);
		moveItem(container, active.item, before);
		touchScrollFrame = ownerWindow.requestAnimationFrame(runTouchScrollLoop);
	};

	const startTouchScrollLoop = (): void => {
		if (touchScrollFrame !== null) return;
		touchScrollFrame = ownerWindow.requestAnimationFrame(runTouchScrollLoop);
	};

	const restoreShieldedItem = (): void => {
		ownerWindow.removeEventListener('pointerup', restoreShieldedItem, true);
		ownerWindow.removeEventListener('pointercancel', restoreShieldedItem, true);
		ownerWindow.removeEventListener('blur', restoreShieldedItem, true);
		if (!shieldedItem) return;
		shieldedItem.draggable = options.isEnabled();
		shieldedItem = null;
	};

	const removeTouchWindowListeners = (): void => {
		ownerWindow.removeEventListener('pointermove', onTouchPointerMove, true);
		ownerWindow.removeEventListener('pointerup', onTouchPointerUp, true);
		ownerWindow.removeEventListener('pointercancel', onTouchPointerCancel, true);
		ownerWindow.removeEventListener('blur', onWindowBlur, true);
	};

	const clearPendingTouch = (): void => {
		if (!pendingTouch) return;
		const pending = pendingTouch;
		ownerWindow.clearTimeout(pending.timer);
		pendingTouch = null;
		if (!active || active.item !== pending.item) {
			pending.item.draggable = pending.wasDraggable && options.isEnabled();
		}
		removeTouchWindowListeners();
	};

	const finishInteraction = (restore: boolean): void => {
		const current = active;
		if (!current) return;
		stopTouchScrollLoop();
		if (current.kind === 'touch') removeTouchWindowListeners();
		clearDropPosition(current.item);
		if (restore) restoreOrder(container, options.itemSelector, current.snapshot);
		try {
			if (current.pointerId !== null) current.item.releasePointerCapture?.(current.pointerId);
		} catch {
			// Pointer capture is best-effort in embedded WebViews.
		}
		current.item.draggable = options.isEnabled();
		active = null;
		options.onInteractionEnd?.();
		if (settledTimer !== null) ownerWindow.clearTimeout(settledTimer);
		settledTimer = ownerWindow.setTimeout(() => {
			settledTimer = null;
			options.onSettled?.();
		}, 0);
	};

	const commitActive = async (): Promise<void> => {
		const current = active;
		if (!current || current.dropping) return;
		const nextOrder = getOrder(container, options.itemSelector);
		if (ordersEqual(current.snapshot, nextOrder)) {
			armClickSuppression();
			finishInteraction(false);
			return;
		}
		current.dropping = true;
		armClickSuppression();
		try {
			await options.onCommit(nextOrder);
			if (active === current) finishInteraction(false);
		} catch (error) {
			console.error('Operon: failed to reorder pinned task', error);
			if (active === current) finishInteraction(true);
		}
	};

	const beginActive = (
		kind: ActiveDrag['kind'],
		item: HTMLElement,
		clientX: number,
		clientY: number,
		pointerId: number | null,
	): boolean => {
		const taskId = getTaskId(item);
		if (!taskId || !options.isEnabled()) return false;
		active = {
			kind,
			item,
			snapshot: getOrder(container, options.itemSelector),
			dropping: false,
			pointerId,
			latestX: clientX,
			latestY: clientY,
		};
		showDropPosition(item, options.getAxis());
		armClickSuppression();
		options.onInteractionStart?.();
		return true;
	};

	const onPointerDownCapture = (event: PointerEvent): void => {
		if (!options.isEnabled()) return;
		const item = findItem(event.target);
		if (!item) return;
		if (isInteractiveTarget(event.target, item)) {
			if (item.draggable) {
				shieldedItem = item;
				item.draggable = false;
				ownerWindow.addEventListener('pointerup', restoreShieldedItem, { capture: true, once: true });
				ownerWindow.addEventListener('pointercancel', restoreShieldedItem, { capture: true, once: true });
				ownerWindow.addEventListener('blur', restoreShieldedItem, { capture: true, once: true });
			}
			return;
		}
		if (
			options.enableTouch !== true
			|| event.button !== 0
			|| (event.pointerType !== 'touch' && event.pointerType !== 'pen')
		) return;
		clearPendingTouch();
		const pending: PendingTouch = {
			item,
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			latestX: event.clientX,
			latestY: event.clientY,
			timer: 0,
			wasDraggable: item.draggable,
		};
		item.draggable = false;
		pending.timer = ownerWindow.setTimeout(() => {
			if (pendingTouch !== pending) return;
			pendingTouch = null;
			if (!beginActive('touch', item, pending.latestX, pending.latestY, pending.pointerId)) {
				item.draggable = pending.wasDraggable && options.isEnabled();
				return;
			}
			try {
				item.setPointerCapture?.(pending.pointerId);
			} catch {
				// Pointer capture is best-effort in embedded WebViews.
			}
			startTouchScrollLoop();
		}, TOUCH_LONG_PRESS_MS);
		pendingTouch = pending;
		ownerWindow.addEventListener('pointermove', onTouchPointerMove, { capture: true, passive: false });
		ownerWindow.addEventListener('pointerup', onTouchPointerUp, true);
		ownerWindow.addEventListener('pointercancel', onTouchPointerCancel, true);
		ownerWindow.addEventListener('blur', onWindowBlur, true);
	};

	function onTouchPointerMove(event: PointerEvent): void {
		if (pendingTouch && event.pointerId === pendingTouch.pointerId) {
			pendingTouch.latestX = event.clientX;
			pendingTouch.latestY = event.clientY;
			if (Math.hypot(event.clientX - pendingTouch.startX, event.clientY - pendingTouch.startY) > TOUCH_SCROLL_INTENT_PX) {
				clearPendingTouch();
			}
			return;
		}
		if (!active || active.kind !== 'touch' || event.pointerId !== active.pointerId) return;
		event.preventDefault();
		event.stopPropagation();
		active.latestX = event.clientX;
		active.latestY = event.clientY;
		const before = resolveBefore(
			container,
			options.itemSelector,
			active.item,
			options.getAxis(),
			event.clientX,
			event.clientY,
		);
		moveItem(container, active.item, before);
	}

	function onTouchPointerUp(event: PointerEvent): void {
		if (pendingTouch && event.pointerId === pendingTouch.pointerId) {
			clearPendingTouch();
			return;
		}
		if (!active || active.kind !== 'touch' || event.pointerId !== active.pointerId) return;
		event.preventDefault();
		event.stopPropagation();
		clearPendingTouch();
		void commitActive();
	}

	function onTouchPointerCancel(event: PointerEvent): void {
		if (pendingTouch && event.pointerId === pendingTouch.pointerId) {
			clearPendingTouch();
			return;
		}
		if (!active || active.kind !== 'touch' || event.pointerId !== active.pointerId) return;
		clearPendingTouch();
		finishInteraction(true);
	}

	function onWindowBlur(): void {
		clearPendingTouch();
		if (active?.kind === 'touch') finishInteraction(true);
		restoreShieldedItem();
	}

	const onDragStart = (event: DragEvent): void => {
		const item = findItem(event.target);
		if (!item || !item.draggable || !beginActive('native', item, event.clientX, event.clientY, null)) {
			event.preventDefault();
			return;
		}
		event.dataTransfer?.setData('text/plain', getTaskId(item));
		if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
	};

	const onDragOver = (event: DragEvent): void => {
		if (!active || active.kind !== 'native') return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
		edgeScroll(container, options.getAxis(), event.clientX, event.clientY);
		const before = resolveBefore(
			container,
			options.itemSelector,
			active.item,
			options.getAxis(),
			event.clientX,
			event.clientY,
		);
		moveItem(container, active.item, before);
	};

	const onDrop = (event: DragEvent): void => {
		if (!active || active.kind !== 'native') return;
		event.preventDefault();
		event.stopPropagation();
		void commitActive();
	};

	const onDragEnd = (): void => {
		if (!active || active.kind !== 'native' || active.dropping) return;
		armClickSuppression();
		finishInteraction(true);
	};

	const onContextMenu = (event: MouseEvent): void => {
		if (!active || active.kind !== 'touch') return;
		event.preventDefault();
		event.stopPropagation();
	};

	container.addEventListener('pointerdown', onPointerDownCapture, true);
	container.addEventListener('dragstart', onDragStart);
	container.addEventListener('dragover', onDragOver);
	container.addEventListener('drop', onDrop);
	container.addEventListener('dragend', onDragEnd);
	container.addEventListener('contextmenu', onContextMenu);

	return {
		isActive: () => active !== null,
		destroy: () => {
			clearPendingTouch();
			if (active) finishInteraction(true);
			for (const item of getItems(container, options.itemSelector)) clearDropPosition(item);
			stopTouchScrollLoop();
			if (settledTimer !== null) ownerWindow.clearTimeout(settledTimer);
			settledTimer = null;
			clickSuppressionCleanup?.();
			clickSuppressionCleanup = null;
			restoreShieldedItem();
			container.removeEventListener('pointerdown', onPointerDownCapture, true);
			container.removeEventListener('dragstart', onDragStart);
			container.removeEventListener('dragover', onDragOver);
			container.removeEventListener('drop', onDrop);
			container.removeEventListener('dragend', onDragEnd);
			container.removeEventListener('contextmenu', onContextMenu);
		},
	};
}
