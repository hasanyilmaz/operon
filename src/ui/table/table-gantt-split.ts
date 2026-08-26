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
		timelineInitialized: false,
	};
}

export function clampTableGanttSplitPercent(value: number): number {
	if (!Number.isFinite(value)) return TABLE_GANTT_DEFAULT_SPLIT_PERCENT;
	return Math.min(TABLE_GANTT_MAX_SPLIT_PERCENT, Math.max(TABLE_GANTT_MIN_SPLIT_PERCENT, value));
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
	pane.addEventListener('wheel', event => {
		const intent = resolveTableGanttWheelIntent(
			event.deltaX,
			event.deltaY,
			event.deltaMode,
			event.shiftKey,
			verticalScroller.clientHeight,
		);
		const previousHorizontal = pane.scrollLeft;
		const previousVertical = verticalScroller.scrollTop;
		if (intent.horizontalDelta !== 0) pane.scrollLeft += intent.horizontalDelta;
		if (intent.verticalDelta !== 0) verticalScroller.scrollTop += intent.verticalDelta;
		if (pane.scrollLeft !== previousHorizontal || verticalScroller.scrollTop !== previousVertical) {
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
