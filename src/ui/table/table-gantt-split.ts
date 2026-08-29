import type { TableTaskTreeRenderItem } from './table-task-tree';

export const TABLE_GANTT_DEFAULT_SPLIT_PERCENT = 70;
export const TABLE_GANTT_MIN_SPLIT_PERCENT = 20;
export const TABLE_GANTT_MAX_SPLIT_PERCENT = 80;
export const TABLE_GANTT_SCAFFOLD_WIDTH_PX = 1200;
export const TABLE_VIRTUAL_RANGE_GUARD_ROWS = 2;
export const TABLE_GANTT_FALLBACK_VIEWPORT_WIDTH_PX = 400;

export interface TableGanttSessionState {
	enabled: boolean;
	splitPercent: number;
	timelineScrollLeft: number;
	timelineAnchorDate: string | null;
	timelineAnchorDayOffsetRatio: number;
	timelineCenterAnchorDate: string | null;
	timelineCenterAnchorDayOffsetRatio: number;
	timelineViewportAnchorDate: string | null;
	timelineViewportAnchorDayOffsetRatio: number;
	timelineViewportWidth: number;
	timelineViewportRestorePending: boolean;
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

export interface TableRetainedVirtualRangeResult {
	range: TableVirtualRange;
	retained: boolean;
}

export interface TableRetainedVirtualCoverage {
	minScrollTop: number;
	maxScrollTop: number;
}

export type TableVisibleRowsRenderReason = 'required' | 'vertical-scroll';
export type TableVisibleRowsRenderAdmission = 'schedule' | 'coalesce' | 'skip-covered';

interface ResolveTableVisibleRowsRenderAdmissionOptions {
	reason: TableVisibleRowsRenderReason;
	hasPendingFrame: boolean;
	retainedRangeCovered: boolean;
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

export interface TableProxyVerticalKeyOptions {
	key: string;
	shiftKey: boolean;
	scrollTop: number;
	viewportHeight: number;
	contentHeight: number;
	rowHeight: number;
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
		timelineCenterAnchorDate: null,
		timelineCenterAnchorDayOffsetRatio: 0.5,
		timelineViewportAnchorDate: null,
		timelineViewportAnchorDayOffsetRatio: 0.5,
		timelineViewportWidth: 0,
		timelineViewportRestorePending: false,
		timelineInitialized: false,
	};
}

export function resolveTableGanttViewportRenderWidth(
	measuredWidth: number,
	timelineInitialized: boolean,
): number | null {
	if (Number.isFinite(measuredWidth) && measuredWidth > 0) return measuredWidth;
	return timelineInitialized ? null : TABLE_GANTT_FALLBACK_VIEWPORT_WIDTH_PX;
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

export function resolveTableRetainedVirtualRange(
	options: ResolveTableVirtualRangeOptions,
	previousRange: TableVirtualRange | null,
	guardRows = TABLE_VIRTUAL_RANGE_GUARD_ROWS,
): TableRetainedVirtualRangeResult {
	const range = resolveTableVirtualRange(options);
	if (!previousRange) return { range, retained: false };
	const itemCount = Math.max(0, Math.floor(options.itemCount));
	const rowHeight = Math.max(1, options.rowHeight);
	const safeGuardRows = Math.max(0, Math.floor(guardRows));
	const visibleStartIndex = Math.max(0, Math.min(itemCount, Math.floor(range.scrollTop / rowHeight)));
	const visibleEndIndex = Math.max(
		visibleStartIndex,
		Math.min(itemCount, Math.ceil((range.scrollTop + range.viewportHeight) / rowHeight)),
	);
	const previousIsCompatible = previousRange.totalHeight === range.totalHeight
		&& previousRange.viewportHeight === range.viewportHeight
		&& Number.isInteger(previousRange.startIndex)
		&& Number.isInteger(previousRange.endIndex)
		&& previousRange.startIndex >= 0
		&& previousRange.startIndex <= previousRange.endIndex
		&& previousRange.endIndex <= itemCount;
	if (!previousIsCompatible) return { range, retained: false };
	const topCovered = previousRange.startIndex === 0
		? visibleStartIndex >= 0
		: visibleStartIndex >= previousRange.startIndex + safeGuardRows;
	const bottomCovered = previousRange.endIndex === itemCount
		? visibleEndIndex <= itemCount
		: visibleEndIndex <= previousRange.endIndex - safeGuardRows;
	if (!topCovered || !bottomCovered) return { range, retained: false };
	return {
		range: {
			...range,
			startIndex: previousRange.startIndex,
			endIndex: previousRange.endIndex,
		},
		retained: true,
	};
}

export function resolveTableRetainedVirtualCoverage(
	range: TableVirtualRange,
	itemCount: number,
	rowHeight: number,
	guardRows = TABLE_VIRTUAL_RANGE_GUARD_ROWS,
): TableRetainedVirtualCoverage | null {
	const safeItemCount = Math.max(0, Math.floor(itemCount));
	const safeGuardRows = Math.max(0, Math.floor(guardRows));
	if (
		!Number.isFinite(rowHeight)
		|| rowHeight <= 0
		|| !Number.isFinite(range.viewportHeight)
		|| range.viewportHeight < 0
		|| !Number.isFinite(range.totalHeight)
		|| range.totalHeight !== safeItemCount * rowHeight
		|| !Number.isInteger(range.startIndex)
		|| !Number.isInteger(range.endIndex)
		|| range.startIndex < 0
		|| range.startIndex > range.endIndex
		|| range.endIndex > safeItemCount
	) return null;
	const maxTableScrollTop = Math.max(0, range.totalHeight - range.viewportHeight);
	const minScrollTop = range.startIndex === 0
		? 0
		: (range.startIndex + safeGuardRows) * rowHeight;
	const maxScrollTop = range.endIndex === safeItemCount
		? maxTableScrollTop
		: (range.endIndex - safeGuardRows) * rowHeight - range.viewportHeight;
	const clampedMin = Math.min(maxTableScrollTop, Math.max(0, minScrollTop));
	const clampedMax = Math.min(maxTableScrollTop, Math.max(0, maxScrollTop));
	return clampedMin <= clampedMax
		? { minScrollTop: clampedMin, maxScrollTop: clampedMax }
		: null;
}

export function isTableScrollTopWithinRetainedCoverage(
	coverage: TableRetainedVirtualCoverage | null,
	scrollTop: number,
): boolean {
	return coverage !== null
		&& Number.isFinite(scrollTop)
		&& scrollTop >= coverage.minScrollTop
		&& scrollTop <= coverage.maxScrollTop;
}

export function resolveTableVisibleRowsRenderAdmission(
	options: ResolveTableVisibleRowsRenderAdmissionOptions,
): TableVisibleRowsRenderAdmission {
	if (options.hasPendingFrame) return 'coalesce';
	if (options.reason === 'vertical-scroll' && options.retainedRangeCovered) return 'skip-covered';
	return 'schedule';
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
	syncTableGanttCanvasOffsets(scrollTop, canvas);
}

export function syncTableGanttCanvasOffsets(
	scrollTop: number,
	firstCanvas: HTMLElement | null,
	secondCanvas: HTMLElement | null = null,
): void {
	const transform = `translateY(${-Math.max(0, scrollTop)}px)`;
	if (firstCanvas) firstCanvas.style.transform = transform;
	if (secondCanvas) secondCanvas.style.transform = transform;
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

export function resolveTableProxyVerticalKeyScrollTop(
	options: TableProxyVerticalKeyOptions,
): number | null {
	const maxScrollTop = Math.max(0, options.contentHeight - options.viewportHeight);
	const pageDelta = Math.max(1, options.viewportHeight);
	const rowDelta = Math.max(1, options.rowHeight);
	let nextScrollTop: number;
	switch (options.key) {
		case 'ArrowUp':
			nextScrollTop = options.scrollTop - rowDelta;
			break;
		case 'ArrowDown':
			nextScrollTop = options.scrollTop + rowDelta;
			break;
		case 'PageUp':
			nextScrollTop = options.scrollTop - pageDelta;
			break;
		case 'PageDown':
			nextScrollTop = options.scrollTop + pageDelta;
			break;
		case 'Home':
			nextScrollTop = 0;
			break;
		case 'End':
			nextScrollTop = maxScrollTop;
			break;
		case ' ':
			nextScrollTop = options.scrollTop + (options.shiftKey ? -pageDelta : pageDelta);
			break;
		default:
			return null;
	}
	return Math.min(maxScrollTop, Math.max(0, nextScrollTop));
}

export function bindTableProxyVerticalKeyboard(
	pane: HTMLElement,
	verticalScroller: HTMLElement,
	rowHeight: number,
): void {
	pane.addEventListener('keydown', event => {
		if (event.target !== pane || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
		const nextScrollTop = resolveTableProxyVerticalKeyScrollTop({
			key: event.key,
			shiftKey: event.shiftKey,
			scrollTop: verticalScroller.scrollTop,
			viewportHeight: verticalScroller.clientHeight,
			contentHeight: verticalScroller.scrollHeight,
			rowHeight,
		});
		if (nextScrollTop === null) return;
		verticalScroller.scrollTop = nextScrollTop;
		event.preventDefault();
	});
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
