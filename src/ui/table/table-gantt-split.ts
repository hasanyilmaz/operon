import type { TableTaskTreeRenderItem } from './table-task-tree';

export const TABLE_GANTT_DEFAULT_SPLIT_PERCENT = 70;
export const TABLE_GANTT_MIN_SPLIT_PERCENT = 20;
export const TABLE_GANTT_MAX_SPLIT_PERCENT = 80;
export const TABLE_GANTT_SCAFFOLD_WIDTH_PX = 1200;

export interface TableGanttSessionState {
	enabled: boolean;
	splitPercent: number;
	timelineScrollLeft: number;
	timelineAnchorDate: string | null;
	timelineAnchorDayOffsetRatio: number;
	timelineInitialized: boolean;
}

export interface TableVirtualRange {
	startIndex: number;
	endIndex: number;
	scrollTop: number;
	viewportHeight: number;
	totalHeight: number;
}

export interface ResolveTableVirtualRangeOptions {
	itemCount: number;
	rowHeight: number;
	viewportHeight: number;
	scrollTop: number;
	overscanRows: number;
}

export interface TableGanttWheelIntent {
	horizontalDelta: number;
	verticalDelta: number;
}

export type TableGanttWheelAxis = 'pending' | 'horizontal' | 'vertical' | 'free';

export interface TableGanttWheelGestureState {
	axis: TableGanttWheelAxis;
	accumulatedX: number;
	accumulatedY: number;
	lastTimestamp: number;
}

export interface TableGanttWheelGestureResult {
	state: TableGanttWheelGestureState;
	intent: TableGanttWheelIntent;
}

const TABLE_GANTT_WHEEL_GESTURE_RESET_MS = 140;
const TABLE_GANTT_WHEEL_LOCK_MIN_PX = 6;
const TABLE_GANTT_WHEEL_DOMINANCE_RATIO = 1.5;
const TABLE_GANTT_WHEEL_PENDING_BIAS_RATIO = 1.15;
const TABLE_GANTT_WHEEL_DIAGONAL_MIN_PX = 18;
const TABLE_GANTT_WHEEL_DIAGONAL_BREAKOUT_RATIO = 0.65;

interface BindTableGanttDividerOptions {
	divider: HTMLElement;
	track: HTMLElement;
	getPercent: () => number;
	onChange: (percent: number) => void;
	onCommit?: (percent: number) => void;
	onInteraction?: () => void;
}

export function createTableGanttSessionState(): TableGanttSessionState {
	return {
		enabled: false,
		splitPercent: TABLE_GANTT_DEFAULT_SPLIT_PERCENT,
		timelineScrollLeft: 0,
		timelineAnchorDate: null,
		timelineAnchorDayOffsetRatio: 0,
		timelineInitialized: false,
	};
}

export function clampTableGanttSplitPercent(value: number): number {
	if (!Number.isFinite(value)) return TABLE_GANTT_DEFAULT_SPLIT_PERCENT;
	const clamped = Math.min(TABLE_GANTT_MAX_SPLIT_PERCENT, Math.max(TABLE_GANTT_MIN_SPLIT_PERCENT, value));
	return Math.round(clamped * 100) / 100;
}

export function resolveTableGanttDividerKey(
	currentPercent: number,
	key: string,
	shiftKey: boolean,
): number | null {
	const current = clampTableGanttSplitPercent(currentPercent);
	if (key === 'Home') return TABLE_GANTT_MIN_SPLIT_PERCENT;
	if (key === 'End') return TABLE_GANTT_MAX_SPLIT_PERCENT;
	const step = shiftKey ? 5 : 1;
	if (key === 'ArrowLeft') return clampTableGanttSplitPercent(current - step);
	if (key === 'ArrowRight') return clampTableGanttSplitPercent(current + step);
	return null;
}

export function resolveTableVirtualRange(options: ResolveTableVirtualRangeOptions): TableVirtualRange {
	const itemCount = Math.max(0, Math.floor(options.itemCount));
	const rowHeight = Math.max(1, options.rowHeight);
	const viewportHeight = Math.max(0, options.viewportHeight);
	const totalHeight = itemCount * rowHeight;
	const maxScrollTop = Math.max(0, totalHeight - viewportHeight);
	const scrollTop = Math.min(maxScrollTop, Math.max(0, options.scrollTop));
	const overscanRows = Math.max(0, Math.floor(options.overscanRows));
	return {
		startIndex: Math.max(0, Math.floor(scrollTop / rowHeight) - overscanRows),
		endIndex: Math.min(itemCount, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscanRows),
		scrollTop,
		viewportHeight,
		totalHeight,
	};
}

export function resolveTableGanttWheelIntent(
	deltaX: number,
	deltaY: number,
	deltaMode: number,
	shiftKey: boolean,
	viewportHeight: number,
): TableGanttWheelIntent {
	const scale = deltaMode === 1
		? 16
		: deltaMode === 2
			? Math.max(1, viewportHeight)
			: 1;
	const normalizedX = deltaX * scale;
	const normalizedY = deltaY * scale;
	return shiftKey
		? { horizontalDelta: normalizedX + normalizedY, verticalDelta: 0 }
		: { horizontalDelta: normalizedX, verticalDelta: normalizedY };
}

export function createTableGanttWheelGestureState(): TableGanttWheelGestureState {
	return {
		axis: 'pending',
		accumulatedX: 0,
		accumulatedY: 0,
		lastTimestamp: Number.NEGATIVE_INFINITY,
	};
}

export function resolveTableGanttWheelGesture(
	previous: TableGanttWheelGestureState,
	intent: TableGanttWheelIntent,
	timestamp: number,
): TableGanttWheelGestureResult {
	const reset = !Number.isFinite(previous.lastTimestamp)
		|| !Number.isFinite(timestamp)
		|| timestamp < previous.lastTimestamp
		|| timestamp - previous.lastTimestamp > TABLE_GANTT_WHEEL_GESTURE_RESET_MS;
	let axis: TableGanttWheelAxis = reset ? 'pending' : previous.axis;
	const accumulatedX = (reset ? 0 : previous.accumulatedX) + Math.abs(intent.horizontalDelta);
	const accumulatedY = (reset ? 0 : previous.accumulatedY) + Math.abs(intent.verticalDelta);
	if (axis === 'pending') {
		if (
			accumulatedX >= TABLE_GANTT_WHEEL_LOCK_MIN_PX
			&& accumulatedX >= accumulatedY * TABLE_GANTT_WHEEL_DOMINANCE_RATIO
		) {
			axis = 'horizontal';
		} else if (
			accumulatedY >= TABLE_GANTT_WHEEL_LOCK_MIN_PX
			&& accumulatedY >= accumulatedX * TABLE_GANTT_WHEEL_DOMINANCE_RATIO
		) {
			axis = 'vertical';
		} else if (
			accumulatedX >= TABLE_GANTT_WHEEL_DIAGONAL_MIN_PX
			&& accumulatedY >= TABLE_GANTT_WHEEL_DIAGONAL_MIN_PX
		) {
			axis = 'free';
		}
	} else if (
		axis === 'horizontal'
		&& accumulatedY >= TABLE_GANTT_WHEEL_DIAGONAL_MIN_PX
		&& accumulatedY >= accumulatedX * TABLE_GANTT_WHEEL_DIAGONAL_BREAKOUT_RATIO
	) {
		axis = 'free';
	} else if (
		axis === 'vertical'
		&& accumulatedX >= TABLE_GANTT_WHEEL_DIAGONAL_MIN_PX
		&& accumulatedX >= accumulatedY * TABLE_GANTT_WHEEL_DIAGONAL_BREAKOUT_RATIO
	) {
		axis = 'free';
	}

	let resolvedIntent: TableGanttWheelIntent;
	if (axis === 'horizontal') {
		resolvedIntent = { horizontalDelta: intent.horizontalDelta, verticalDelta: 0 };
	} else if (axis === 'vertical') {
		resolvedIntent = { horizontalDelta: 0, verticalDelta: intent.verticalDelta };
	} else if (axis === 'free') {
		resolvedIntent = intent;
	} else if (Math.abs(intent.horizontalDelta) >= Math.abs(intent.verticalDelta) * TABLE_GANTT_WHEEL_PENDING_BIAS_RATIO) {
		resolvedIntent = { horizontalDelta: intent.horizontalDelta, verticalDelta: 0 };
	} else if (Math.abs(intent.verticalDelta) >= Math.abs(intent.horizontalDelta) * TABLE_GANTT_WHEEL_PENDING_BIAS_RATIO) {
		resolvedIntent = { horizontalDelta: 0, verticalDelta: intent.verticalDelta };
	} else {
		resolvedIntent = { horizontalDelta: 0, verticalDelta: 0 };
	}
	return {
		state: { axis, accumulatedX, accumulatedY, lastTimestamp: timestamp },
		intent: resolvedIntent,
	};
}

export function applyTableGanttSplitPercent(track: HTMLElement, percent: number): number {
	const clamped = clampTableGanttSplitPercent(percent);
	track.style.setProperty('--operon-table-gantt-left-fr', `${clamped}fr`);
	track.style.setProperty('--operon-table-gantt-right-fr', `${100 - clamped}fr`);
	return clamped;
}

export function syncTableGanttCanvasOffset(canvas: HTMLElement | null, scrollTop: number): void {
	if (!canvas) return;
	canvas.style.transform = `translateY(${-Math.max(0, scrollTop)}px)`;
}

export function resolveTableGanttHoverRowIndex(
	clientY: number,
	canvasTop: number,
	rowHeight: number,
): number | null {
	if (!Number.isFinite(clientY) || !Number.isFinite(canvasTop) || !Number.isFinite(rowHeight) || rowHeight <= 0) {
		return null;
	}
	const index = Math.floor((clientY - canvasTop) / rowHeight);
	return index >= 0 ? index : null;
}

export function bindTableGanttLinkedRowHover(
	tableCanvas: HTMLElement,
	timelineCanvas: HTMLElement,
	rowHeight: number,
): void {
	const linkedClass = 'is-operon-linked-row-hover';
	let activeIndex: number | null = null;
	let activeElements: HTMLElement[] = [];
	const clearLinkedHover = (): void => {
		for (const hovered of activeElements) hovered.classList.remove(linkedClass);
		activeElements = [];
		activeIndex = null;
	};
	const applyLinkedHover = (index: number | null): void => {
		if (index !== null && index === activeIndex && activeElements.every(element => element.isConnected)) return;
		clearLinkedHover();
		if (index === null) return;
		const selector = `[data-operon-row-index="${index}"]`;
		const tableRow = tableCanvas.querySelector<HTMLElement>(`.operon-table-row${selector}`);
		if (!tableRow) return;
		tableRow.classList.add(linkedClass);
		activeElements.push(tableRow);
		for (const timelineElement of Array.from(timelineCanvas.querySelectorAll<HTMLElement>(selector))) {
			timelineElement.classList.add(linkedClass);
			activeElements.push(timelineElement);
		}
		activeIndex = index;
	};
	tableCanvas.addEventListener('pointermove', event => {
		const target = event.target instanceof Element
			? event.target.closest<HTMLElement>('.operon-table-row[data-operon-row-index]')
			: null;
		const index = target?.dataset.operonRowIndex;
		applyLinkedHover(index && /^\d+$/u.test(index) ? Number(index) : null);
	});
	tableCanvas.addEventListener('pointerleave', clearLinkedHover);
	timelineCanvas.addEventListener('pointermove', event => {
		applyLinkedHover(resolveTableGanttHoverRowIndex(
			event.clientY,
			timelineCanvas.getBoundingClientRect().top,
			rowHeight,
		));
	});
	timelineCanvas.addEventListener('pointerleave', clearLinkedHover);
}

export function bindTableGanttDivider(options: BindTableGanttDividerOptions): void {
	let keyboardCommitTimer: number | null = null;
	const applyPercent = (value: number): void => {
		const percent = applyTableGanttSplitPercent(options.track, value);
		options.divider.setAttribute('aria-valuenow', String(Math.round(percent)));
		options.onChange(percent);
	};
	applyPercent(options.getPercent());
	options.divider.addEventListener('pointerdown', event => {
		if (event.button !== 0) return;
		options.onInteraction?.();
		options.divider.setPointerCapture(event.pointerId);
		event.preventDefault();
	});
	options.divider.addEventListener('pointermove', event => {
		if (!options.divider.hasPointerCapture(event.pointerId)) return;
		const rect = options.track.getBoundingClientRect();
		if (rect.width <= 0) return;
		applyPercent(((event.clientX - rect.left) / rect.width) * 100);
	});
	options.divider.addEventListener('pointerup', event => {
		if (!options.divider.hasPointerCapture(event.pointerId)) return;
		options.divider.releasePointerCapture(event.pointerId);
		options.onCommit?.(clampTableGanttSplitPercent(options.getPercent()));
	});
	options.divider.addEventListener('pointercancel', event => {
		if (!options.divider.hasPointerCapture(event.pointerId)) return;
		options.divider.releasePointerCapture(event.pointerId);
		options.onCommit?.(clampTableGanttSplitPercent(options.getPercent()));
	});
	options.divider.addEventListener('keydown', event => {
		const next = resolveTableGanttDividerKey(options.getPercent(), event.key, event.shiftKey);
		if (next === null) return;
		options.onInteraction?.();
		applyPercent(next);
		const commitPercent = clampTableGanttSplitPercent(options.getPercent());
		if (keyboardCommitTimer !== null) options.divider.ownerDocument.win.clearTimeout(keyboardCommitTimer);
		keyboardCommitTimer = options.divider.ownerDocument.win.setTimeout(() => {
			keyboardCommitTimer = null;
			options.onCommit?.(commitPercent);
		}, 180);
		event.preventDefault();
	});
}

export function bindTableGanttPaneWheel(pane: HTMLElement, verticalScroller: HTMLElement): void {
	let gesture = createTableGanttWheelGestureState();
	pane.addEventListener('wheel', event => {
		const rawIntent = resolveTableGanttWheelIntent(
			event.deltaX,
			event.deltaY,
			event.deltaMode,
			event.shiftKey,
			verticalScroller.clientHeight,
		);
		const resolved = resolveTableGanttWheelGesture(gesture, rawIntent, event.timeStamp);
		gesture = resolved.state;
		const intent = resolved.intent;
		const axisFiltered = intent.horizontalDelta !== rawIntent.horizontalDelta
			|| intent.verticalDelta !== rawIntent.verticalDelta;
		const previousHorizontal = pane.scrollLeft;
		const previousVertical = verticalScroller.scrollTop;
		if (intent.horizontalDelta !== 0) pane.scrollLeft += intent.horizontalDelta;
		if (intent.verticalDelta !== 0) verticalScroller.scrollTop += intent.verticalDelta;
		if (
			axisFiltered
			|| pane.scrollLeft !== previousHorizontal
			|| verticalScroller.scrollTop !== previousVertical
		) {
			event.preventDefault();
		}
	}, { passive: false });
}

export function renderTableGanttScaffoldRows(
	canvas: HTMLElement,
	items: readonly TableTaskTreeRenderItem[],
	range: Pick<TableVirtualRange, 'startIndex' | 'endIndex' | 'totalHeight'>,
	rowHeight: number,
): void {
	const content = canvas.ownerDocument.win.createDiv();
	for (let index = range.startIndex; index < range.endIndex; index += 1) {
		const item = items[index];
		if (!item) continue;
		const row = content.createDiv(getTableGanttLaneClassName(item));
		row.style.height = `${rowHeight}px`;
		row.style.transform = `translateY(${index * rowHeight}px)`;
	}
	canvas.style.height = `${range.totalHeight}px`;
	canvas.replaceChildren(...Array.from(content.childNodes));
}

export function getTableGanttLaneClassName(item: Pick<TableTaskTreeRenderItem, 'kind'>): string {
	return `operon-table-gantt-lane operon-table-gantt-lane-${item.kind}`;
}
