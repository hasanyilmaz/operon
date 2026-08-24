export interface KanbanRectLike {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

/**
 * Decides whether a kanban cell should render its cards immediately: the
 * cell rect must intersect the scroll viewport rect expanded by marginPx on
 * every side. A zero-sized viewport (hidden leaf) defers all cells to the
 * IntersectionObserver, which fires once the leaf becomes visible.
 */
export function shouldMaterializeKanbanCell(
	viewportRect: KanbanRectLike,
	cellRect: KanbanRectLike,
	marginPx: number,
): boolean {
	if (viewportRect.right - viewportRect.left <= 0 || viewportRect.bottom - viewportRect.top <= 0) return false;
	return cellRect.right >= viewportRect.left - marginPx
		&& cellRect.left <= viewportRect.right + marginPx
		&& cellRect.bottom >= viewportRect.top - marginPx
		&& cellRect.top <= viewportRect.bottom + marginPx;
}

/**
 * Approximates the settled height of a deferred cell so row layout and
 * scroll restoration stay close to the materialized result. Mirrors the
 * cell height limit rules: a finite maxVisibleTasks caps the visible cards,
 * otherwise only the initial render batch is counted.
 */
/**
 * Detects a clamped scroll restore: the browser silently limits
 * scrollLeft/scrollTop assignments to the current content size, so a
 * position that lands short of the target means the grid was not fully
 * sized yet. The tolerance absorbs fractional scroll positions.
 */
export function isKanbanScrollRestoreClamped(
	target: { left: number; top: number },
	actual: { left: number; top: number },
	tolerancePx = 1,
): boolean {
	return Math.abs(actual.left - target.left) > tolerancePx
		|| Math.abs(actual.top - target.top) > tolerancePx;
}

/**
 * Computes how many cards a cell must render on its first pass so a pending
 * per-cell scroll restore does not clamp against lazily rendered content.
 * Without a saved scroll position this mirrors the plain initial limit:
 * max(renderBatchSize, maxVisibleTasks) capped to the task count. With one,
 * enough cards are added to cover the saved depth plus one visible window,
 * so the restored scrollTop lands inside already-rendered content.
 */
export function resolveKanbanCellInitialRenderLimit(options: {
	taskCount: number;
	renderBatchSize: number;
	maxVisibleTasks: number;
	savedScrollTopPx: number;
	cardHeightPx: number;
	cardGapPx: number;
}): number {
	const { taskCount, renderBatchSize, maxVisibleTasks, savedScrollTopPx, cardHeightPx, cardGapPx } = options;
	if (taskCount <= 0) return 0;
	const heightLimited = Number.isFinite(maxVisibleTasks) && maxVisibleTasks >= 1;
	const baseLimit = Math.min(taskCount, Math.max(renderBatchSize, heightLimited ? maxVisibleTasks : 0));
	if (!(savedScrollTopPx > 0) || cardHeightPx <= 0) return baseLimit;
	const cardStridePx = cardHeightPx + Math.max(0, cardGapPx);
	const cardsAboveViewport = Math.ceil(savedScrollTopPx / cardStridePx);
	const visibleWindow = heightLimited ? maxVisibleTasks : renderBatchSize;
	return Math.min(taskCount, Math.max(baseLimit, cardsAboveViewport + Math.max(1, visibleWindow)));
}

export interface KanbanCellScrollAnchor {
	taskId: string;
	viewportOffsetPx: number;
}

export interface KanbanViewportContentAnchor {
	key: string;
	viewportOffsetPx: number;
}

/**
 * Resolves a board scroll coordinate from the first surviving visible content
 * anchor. The map values are content-space offsets in the rebuilt board; the
 * captured viewport offset keeps the same lane or status column stationary.
 */
export function resolveKanbanViewportAnchorScroll(
	anchors: readonly KanbanViewportContentAnchor[],
	contentOffsets: ReadonlyMap<string, number>,
	fallbackScroll: number,
): number {
	for (const anchor of anchors) {
		const contentOffset = contentOffsets.get(anchor.key);
		if (contentOffset === undefined) continue;
		return Math.max(0, contentOffset - anchor.viewportOffsetPx);
	}
	return Math.max(0, fallbackScroll);
}

/**
 * Resolves the scrollTop that keeps the previously visible cards at their
 * previous on-screen offsets. A raw pixel restore shifts the lane content by
 * one card height whenever the moved card leaves (or enters) the area above
 * the viewport; anchoring to the first surviving visible card keeps the
 * cards the user is processing stationary instead. Falls back to the
 * captured pixel position when no anchor card survived the re-render.
 */
export function resolveKanbanCellAnchorScrollTop(
	anchors: readonly KanbanCellScrollAnchor[],
	cardContentTops: ReadonlyMap<string, number>,
	fallbackTop: number,
): number {
	for (const anchor of anchors) {
		const contentTop = cardContentTops.get(anchor.taskId);
		if (contentTop === undefined) continue;
		return Math.max(0, contentTop - anchor.viewportOffsetPx);
	}
	return fallbackTop;
}

export type KanbanCellScrollRestoreOutcome = 'satisfied' | 'retry' | 'expired';

/**
 * Judges one per-cell scroll restore attempt. Expired entries are dropped so
 * a stale position never yanks a cell the user has since scrolled manually.
 * A restore that landed within tolerance is settled. A clamped restore only
 * earns a retry while the cell can still grow (a lazy sentinel remains);
 * once content is complete the clamp is final and the entry is settled.
 */
export function resolveKanbanCellScrollRestore(options: {
	targetTop: number;
	achievedTop: number;
	now: number;
	expiresAt: number;
	canGrow: boolean;
	tolerancePx?: number;
}): KanbanCellScrollRestoreOutcome {
	const { targetTop, achievedTop, now, expiresAt, canGrow, tolerancePx = 1 } = options;
	if (now > expiresAt) return 'expired';
	if (Math.abs(achievedTop - targetTop) <= tolerancePx) return 'satisfied';
	return canGrow ? 'retry' : 'satisfied';
}

export function estimateKanbanCellPlaceholderHeightPx(options: {
	taskCount: number;
	maxVisibleTasks: number;
	renderBatchSize: number;
	cardHeightPx: number;
	cardGapPx: number;
}): number {
	const { taskCount, maxVisibleTasks, renderBatchSize, cardHeightPx, cardGapPx } = options;
	if (taskCount <= 0) return 0;
	const heightLimited = Number.isFinite(maxVisibleTasks) && maxVisibleTasks >= 1;
	const visibleCount = heightLimited
		? Math.min(taskCount, maxVisibleTasks)
		: Math.min(taskCount, Math.max(1, renderBatchSize));
	return (visibleCount * cardHeightPx) + (Math.max(0, visibleCount - 1) * cardGapPx);
}
