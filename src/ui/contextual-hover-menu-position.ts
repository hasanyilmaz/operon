export interface ContextualHoverMenuRect {
	left: number;
	top: number;
	right: number;
	bottom: number;
	width: number;
	height: number;
}

export interface ContextualHoverMenuPositionOptions {
	viewportPadding?: number;
	iconGap?: number;
	minWidth?: number;
	minHeight?: number;
}

export interface ContextualHoverMenuPosition {
	left: number;
	top: number;
	width: number;
	maxHeight: number;
}

interface ContextualHoverMenuPositionCandidate {
	left: number;
	top: number;
	maxHeight: number;
	order: number;
}

export const CONTEXTUAL_HOVER_MENU_POSITION_DEFAULTS = {
	viewportPadding: 8,
	iconGap: 8,
	minWidth: 168,
	minHeight: 48,
} as const;

export function resolveVisibleContextualHoverAnchorRect(
	anchorRect: ContextualHoverMenuRect,
	protectedAnchorRect?: ContextualHoverMenuRect | null,
	clipRect?: ContextualHoverMenuRect | null,
): ContextualHoverMenuRect {
	const baseRect = normalizeRect(protectedAnchorRect ?? anchorRect);
	if (!clipRect) return baseRect;
	return intersectRects(baseRect, normalizeRect(clipRect)) ?? baseRect;
}

export function resolveContextualHoverMenuPosition(
	anchorRect: ContextualHoverMenuRect,
	viewportRect: ContextualHoverMenuRect,
	menuRect: ContextualHoverMenuRect,
	options: ContextualHoverMenuPositionOptions = {},
): ContextualHoverMenuPosition | null {
	const viewportPadding = options.viewportPadding ?? CONTEXTUAL_HOVER_MENU_POSITION_DEFAULTS.viewportPadding;
	const iconGap = options.iconGap ?? CONTEXTUAL_HOVER_MENU_POSITION_DEFAULTS.iconGap;
	const minWidth = options.minWidth ?? CONTEXTUAL_HOVER_MENU_POSITION_DEFAULTS.minWidth;
	const minHeight = options.minHeight ?? CONTEXTUAL_HOVER_MENU_POSITION_DEFAULTS.minHeight;
	const anchor = normalizeRect(anchorRect);
	const viewport = normalizeRect(viewportRect);
	const width = Math.min(Math.max(minWidth, Math.ceil(menuRect.width)), viewport.width - viewportPadding * 2);
	const renderedHeight = Math.max(1, Math.ceil(menuRect.height));
	const minLeft = viewport.left + viewportPadding;
	const maxRight = viewport.right - viewportPadding;
	const minTop = viewport.top + viewportPadding;
	const maxBottom = viewport.bottom - viewportPadding;
	const maxLeft = maxRight - width;
	const interiorHeight = maxBottom - minTop;
	const minUsableHeight = Math.min(renderedHeight, minHeight);

	if (width < minWidth || maxLeft < minLeft || interiorHeight < minUsableHeight) {
		return null;
	}

	const protectedAnchor = expandRect(anchor, iconGap);
	const unconstrained = selectPositionCandidate(
		buildPositionCandidates(anchor, width, renderedHeight, minLeft, maxLeft, minTop, maxBottom, iconGap, false),
		width,
		renderedHeight,
		minUsableHeight,
		protectedAnchor,
		false,
	);
	if (unconstrained) return unconstrained;

	return selectPositionCandidate(
		buildPositionCandidates(anchor, width, renderedHeight, minLeft, maxLeft, minTop, maxBottom, iconGap, true),
		width,
		renderedHeight,
		minUsableHeight,
		protectedAnchor,
		true,
	);
}

function buildPositionCandidates(
	anchor: ContextualHoverMenuRect,
	width: number,
	renderedHeight: number,
	minLeft: number,
	maxLeft: number,
	minTop: number,
	maxBottom: number,
	iconGap: number,
	allowConstrainedHeight: boolean,
): ContextualHoverMenuPositionCandidate[] {
	const belowMaxHeight = maxBottom - (anchor.bottom + iconGap);
	const aboveMaxHeight = anchor.top - iconGap - minTop;
	const sideMaxHeight = maxBottom - minTop;
	const belowHeight = resolveCandidateHeight(renderedHeight, belowMaxHeight, allowConstrainedHeight);
	const aboveHeight = resolveCandidateHeight(renderedHeight, aboveMaxHeight, allowConstrainedHeight);
	const sideHeight = resolveCandidateHeight(renderedHeight, sideMaxHeight, allowConstrainedHeight);
	const candidates: ContextualHoverMenuPositionCandidate[] = [];
	const addCandidate = (
		left: number,
		top: number,
		maxHeight: number,
		order: number,
	): void => {
		candidates.push({ left, top, maxHeight, order });
	};

	if (belowHeight !== null) {
		addCandidate(
			clamp(anchor.left, minLeft, maxLeft),
			anchor.bottom + iconGap,
			belowMaxHeight,
			0,
		);
	}

	if (sideHeight !== null && anchor.right + iconGap + width <= maxLeft + width) {
		addCandidate(
			anchor.right + iconGap,
			clamp(anchor.top, minTop, maxBottom - sideHeight),
			sideMaxHeight,
			1,
		);
	}

	if (sideHeight !== null && anchor.left - iconGap - width >= minLeft) {
		addCandidate(
			anchor.left - iconGap - width,
			clamp(anchor.top, minTop, maxBottom - sideHeight),
			sideMaxHeight,
			2,
		);
	}

	if (aboveHeight !== null) {
		addCandidate(
			clamp(anchor.left, minLeft, maxLeft),
			anchor.top - iconGap - aboveHeight,
			aboveMaxHeight,
			3,
		);
	}

	if (belowHeight !== null) {
		addCandidate(
			clamp(anchor.right - width, minLeft, maxLeft),
			anchor.bottom + iconGap,
			belowMaxHeight,
			4,
		);
	}

	if (sideHeight !== null && anchor.right + iconGap + width <= maxLeft + width) {
		addCandidate(
			anchor.right + iconGap,
			clamp(anchor.bottom - sideHeight, minTop, maxBottom - sideHeight),
			sideMaxHeight,
			5,
		);
	}

	if (sideHeight !== null && anchor.left - iconGap - width >= minLeft) {
		addCandidate(
			anchor.left - iconGap - width,
			clamp(anchor.bottom - sideHeight, minTop, maxBottom - sideHeight),
			sideMaxHeight,
			6,
		);
	}

	if (aboveHeight !== null) {
		addCandidate(
			clamp(anchor.right - width, minLeft, maxLeft),
			anchor.top - iconGap - aboveHeight,
			aboveMaxHeight,
			7,
		);
	}

	return candidates;
}

function selectPositionCandidate(
	candidates: ContextualHoverMenuPositionCandidate[],
	width: number,
	renderedHeight: number,
	minUsableHeight: number,
	protectedAnchor: ContextualHoverMenuRect,
	preferTallest: boolean,
): ContextualHoverMenuPosition | null {
	let bestCandidate: ContextualHoverMenuPositionCandidate | null = null;
	let bestHeight = 0;
	for (const candidate of candidates) {
		if (candidate.maxHeight < minUsableHeight) continue;
		const height = Math.min(renderedHeight, candidate.maxHeight);
		const candidateRect = buildRect(candidate.left, candidate.top, width, height);
		if (rectsOverlap(candidateRect, protectedAnchor)) continue;
		if (!bestCandidate) {
			bestCandidate = candidate;
			bestHeight = candidate.maxHeight;
			continue;
		}
		if (!preferTallest) continue;
		if (candidate.maxHeight > bestHeight || (candidate.maxHeight === bestHeight && candidate.order < bestCandidate.order)) {
			bestCandidate = candidate;
			bestHeight = candidate.maxHeight;
		}
	}
	if (!bestCandidate) return null;
	return {
		left: bestCandidate.left,
		top: bestCandidate.top,
		width,
		maxHeight: bestCandidate.maxHeight,
	};
}

function resolveCandidateHeight(renderedHeight: number, maxHeight: number, allowConstrainedHeight: boolean): number | null {
	if (maxHeight <= 0) return null;
	if (!allowConstrainedHeight && maxHeight < renderedHeight) return null;
	return Math.min(renderedHeight, maxHeight);
}

function normalizeRect(rect: ContextualHoverMenuRect): ContextualHoverMenuRect {
	const left = Math.min(rect.left, rect.right);
	const right = Math.max(rect.left, rect.right);
	const top = Math.min(rect.top, rect.bottom);
	const bottom = Math.max(rect.top, rect.bottom);
	return {
		left,
		top,
		right,
		bottom,
		width: right - left,
		height: bottom - top,
	};
}

function intersectRects(left: ContextualHoverMenuRect, right: ContextualHoverMenuRect): ContextualHoverMenuRect | null {
	const intersectionLeft = Math.max(left.left, right.left);
	const intersectionRight = Math.min(left.right, right.right);
	const intersectionTop = Math.max(left.top, right.top);
	const intersectionBottom = Math.min(left.bottom, right.bottom);
	if (intersectionRight <= intersectionLeft || intersectionBottom <= intersectionTop) return null;
	return buildRect(
		intersectionLeft,
		intersectionTop,
		intersectionRight - intersectionLeft,
		intersectionBottom - intersectionTop,
	);
}

function expandRect(rect: ContextualHoverMenuRect, amount: number): ContextualHoverMenuRect {
	return {
		left: rect.left - amount,
		top: rect.top - amount,
		right: rect.right + amount,
		bottom: rect.bottom + amount,
		width: rect.width + amount * 2,
		height: rect.height + amount * 2,
	};
}

function buildRect(left: number, top: number, width: number, height: number): ContextualHoverMenuRect {
	return {
		left,
		top,
		right: left + width,
		bottom: top + height,
		width,
		height,
	};
}

function rectsOverlap(left: ContextualHoverMenuRect, right: ContextualHoverMenuRect): boolean {
	return left.left < right.right
		&& left.right > right.left
		&& left.top < right.bottom
		&& left.bottom > right.top;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}
