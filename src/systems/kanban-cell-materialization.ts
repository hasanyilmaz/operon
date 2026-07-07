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
