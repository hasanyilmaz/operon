import { getOwnerWindow } from '../../core/dom-compat';
import { bindExpandedDescendantState } from '../expanded-descendant-state';

interface TableToolbarResizeObserverLike {
	observe(target: Element): void;
	disconnect(): void;
}

const TABLE_TOOLBAR_HORIZONTAL_PADDING_PX = 24;
const TABLE_TOOLBAR_GRID_GAP_PX = 12;
const TABLE_TOOLBAR_SEARCH_NATURAL_WIDTH_PX = 224;

type TableToolbarResizeObserverConstructor = new (
	callback: () => void,
) => TableToolbarResizeObserverLike;

function measureTableToolbarGroupWidth(group: HTMLElement): number {
	const children = Array.from(group.children) as HTMLElement[];
	if (children.length === 0) return 0;
	let total = 0;
	for (const child of children) {
		const rectWidth = Math.ceil(child.getBoundingClientRect().width);
		const naturalWidth = Math.ceil(child.scrollWidth || 0);
		const minimumNaturalWidth = child.classList.contains('operon-table-search-wrap')
			? TABLE_TOOLBAR_SEARCH_NATURAL_WIDTH_PX
			: 0;
		total += Math.max(rectWidth, naturalWidth, minimumNaturalWidth);
	}
	return total + Math.max(0, children.length - 1) * 8;
}

export function bindTableToolbarLayout(
	toolbar: HTMLElement,
	start: HTMLElement,
	center: HTMLElement,
	end: HTMLElement,
): () => void {
	const ownerWindow = getOwnerWindow(toolbar);
	let disposed = false;
	const updateLayout = (): void => {
		if (disposed) return;
		const width = Math.max(0, toolbar.clientWidth - TABLE_TOOLBAR_HORIZONTAL_PADDING_PX);
		if (width <= 0) return;
		const hasFavoritePresets = center.childElementCount > 0;
		toolbar.classList.toggle('has-favorite-presets', hasFavoritePresets);
		const startWidth = measureTableToolbarGroupWidth(start);
		const centerWidth = measureTableToolbarGroupWidth(center);
		const endWidth = measureTableToolbarGroupWidth(end);
		const requiredWidth = centerWidth
			+ (Math.max(startWidth, endWidth) * 2)
			+ (TABLE_TOOLBAR_GRID_GAP_PX * 2);
		toolbar.classList.toggle('is-compact', requiredWidth > width);
	};

	updateLayout();
	const animationFrame = ownerWindow.requestAnimationFrame(updateLayout);
	const lateUpdateTimer = ownerWindow.setTimeout(updateLayout, 120);
	const ownerWindowWithObserver = ownerWindow as unknown as {
		ResizeObserver?: TableToolbarResizeObserverConstructor;
	};
	const ResizeObserverCtor = ownerWindowWithObserver.ResizeObserver;
	const observer = ResizeObserverCtor ? new ResizeObserverCtor(updateLayout) : null;
	observer?.observe(toolbar);
	observer?.observe(start);
	observer?.observe(center);
	observer?.observe(end);
	const disposeExpandedState = bindExpandedDescendantState(toolbar);

	return () => {
		disposed = true;
		observer?.disconnect();
		disposeExpandedState();
		ownerWindow.cancelAnimationFrame(animationFrame);
		ownerWindow.clearTimeout(lateUpdateTimer);
	};
}
