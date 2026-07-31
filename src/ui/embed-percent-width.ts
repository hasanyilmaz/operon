import { getOwnerWindow } from '../core/dom-compat';

export type EmbedWidthPercent = number;

export interface EmbedPercentWidthGeometryInput {
	lineLeftPx: number;
	lineWidthPx: number;
	paneLeftPx: number;
	paneRightPx: number;
	widthPercent: EmbedWidthPercent;
}

export interface EmbedPercentWidthGeometry {
	widthPx: number;
	offsetXPx: number;
}

export interface BindEmbedPercentWidthOptions {
	onGeometryChange?: () => void;
}

interface InlineStyleSnapshot {
	property: string;
	value: string;
	priority: string;
}

interface EmbedPercentWidthBinding {
	refresh: () => void;
	cleanup: () => void;
}

interface EmbedResizeObserverLike {
	observe(target: Element): void;
	disconnect(): void;
}

interface EmbedMutationObserverLike {
	observe(target: Node, options?: MutationObserverInit): void;
	disconnect(): void;
}

type EmbedResizeObserverConstructor = new (callback: () => void) => EmbedResizeObserverLike;
type EmbedMutationObserverConstructor = new (callback: () => void) => EmbedMutationObserverLike;

const EMBED_PANE_INLINE_INSET_PX = 12;
const EMBED_WIDTH_STYLE_PROPERTIES = [
	'box-sizing',
	'position',
	'left',
	'right',
	'width',
	'max-width',
] as const;
const activeBindings = new Set<EmbedPercentWidthBinding>();

export function parseEmbedWidthPercent(value: string | undefined): EmbedWidthPercent | null {
	let normalized = value?.trim() ?? '';
	if (!normalized) return null;
	if (
		(normalized.startsWith('"') && normalized.endsWith('"'))
		|| (normalized.startsWith("'") && normalized.endsWith("'"))
	) {
		normalized = normalized.slice(1, -1).trim();
	}
	const match = normalized.match(/^([1-9]\d*)%$/u);
	if (!match) return null;
	const parsed = Number(match[1]);
	return Number.isSafeInteger(parsed) && parsed >= 100 ? parsed : null;
}

export function resolveEmbedPercentWidthGeometry(
	input: EmbedPercentWidthGeometryInput,
): EmbedPercentWidthGeometry | null {
	const {
		lineLeftPx,
		lineWidthPx,
		paneLeftPx,
		paneRightPx,
		widthPercent,
	} = input;
	if (
		![lineLeftPx, lineWidthPx, paneLeftPx, paneRightPx, widthPercent].every(Number.isFinite)
		|| lineWidthPx <= 0
		|| paneRightPx <= paneLeftPx
		|| !Number.isSafeInteger(widthPercent)
		|| widthPercent < 100
	) {
		return null;
	}

	const lineCenterPx = lineLeftPx + lineWidthPx / 2;
	const symmetricCapacityPx = 2 * Math.min(
		lineCenterPx - paneLeftPx,
		paneRightPx - lineCenterPx,
	);
	if (symmetricCapacityPx <= lineWidthPx) {
		return {
			widthPx: Math.max(1, Math.round(lineWidthPx)),
			offsetXPx: 0,
		};
	}
	const requestedWidthPx = lineWidthPx * (widthPercent / 100);
	const widthPx = Math.max(1, Math.round(Math.min(requestedWidthPx, symmetricCapacityPx)));
	return {
		widthPx,
		offsetXPx: Math.round((lineWidthPx - widthPx) / 2),
	};
}

export function bindEmbedPercentWidth(
	host: HTMLElement,
	widthPercent: EmbedWidthPercent | null,
	options: BindEmbedPercentWidthOptions = {},
): () => void {
	if (widthPercent === null || widthPercent === 100) return () => undefined;

	const ownerWindow = getOwnerWindow(host);
	let animationFrame = 0;
	let disposed = false;
	let styledTarget: HTMLElement | null = null;
	let styleSnapshot: InlineStyleSnapshot[] = [];
	let lastGeometrySignature = 'natural';
	const observedElements = new Set<Element>();
	const mutationObservedElements = new Set<Element>();

	const notifyGeometryChange = (signature: string): void => {
		if (signature === lastGeometrySignature) return;
		lastGeometrySignature = signature;
		options.onGeometryChange?.();
	};
	const restoreStyledTarget = (): void => {
		if (!styledTarget) return;
		restoreInlineStyles(styledTarget, styleSnapshot);
		styledTarget = null;
		styleSnapshot = [];
	};
	const observeElement = (element: Element | null, observer: EmbedResizeObserverLike | null): void => {
		if (!element || !observer || observedElements.has(element)) return;
		observedElements.add(element);
		observer.observe(element);
	};
	let resizeObserver: EmbedResizeObserverLike | null = null;
	let mutationObserver: EmbedMutationObserverLike | null = null;
	const observeLayoutMutations = (element: Element | null): void => {
		if (!element || !mutationObserver || mutationObservedElements.has(element)) return;
		mutationObservedElements.add(element);
		mutationObserver.observe(element, {
			attributes: true,
			attributeFilter: ['class', 'style'],
		});
	};

	const refresh = (): void => {
		if (disposed) return;
		const target = getEmbedWidthLayoutHost(host);
		const paneBounds = resolveEmbedPaneBounds(host);
		if (!target || !paneBounds) {
			restoreStyledTarget();
			notifyGeometryChange('natural');
			return;
		}
		for (const element of paneBounds.observedElements) {
			observeElement(element, resizeObserver);
			observeLayoutMutations(element);
		}
		observeElement(target.parentElement, resizeObserver);
		observeLayoutMutations(target.parentElement);
		if (styledTarget !== target) {
			restoreStyledTarget();
			styledTarget = target;
			styleSnapshot = snapshotInlineStyles(target, EMBED_WIDTH_STYLE_PROPERTIES);
		} else {
			restoreInlineStyles(target, styleSnapshot);
		}
		const lineRect = target.getBoundingClientRect();
		if (lineRect.width <= 0) {
			restoreStyledTarget();
			notifyGeometryChange('natural');
			return;
		}
		const geometry = resolveEmbedPercentWidthGeometry({
			lineLeftPx: lineRect.left,
			lineWidthPx: lineRect.width,
			paneLeftPx: paneBounds.left,
			paneRightPx: paneBounds.right,
			widthPercent,
		});
		if (!geometry) {
			restoreStyledTarget();
			notifyGeometryChange('natural');
			return;
		}
		if (geometry.widthPx <= Math.round(lineRect.width) && geometry.offsetXPx === 0) {
			restoreStyledTarget();
			notifyGeometryChange('natural');
			return;
		}

		target.setCssStyles({
			boxSizing: 'border-box',
			position: 'relative',
			left: '0px',
			right: 'auto',
			width: `${geometry.widthPx}px`,
			maxWidth: `${geometry.widthPx}px`,
		});

		// Themes such as Minimal center readable-line children with important
		// auto-margins. Measure that post-width flow position before applying the
		// final relative offset so the original line center remains authoritative.
		const widenedRect = target.getBoundingClientRect();
		if (widenedRect.width <= 0) {
			restoreStyledTarget();
			notifyGeometryChange('natural');
			return;
		}
		const desiredLeftPx = lineRect.left + geometry.offsetXPx;
		const correctedOffsetPx = Math.round((desiredLeftPx - widenedRect.left) * 1000) / 1000;
		target.setCssStyles({ left: `${correctedOffsetPx}px` });
		notifyGeometryChange(`${geometry.widthPx}:${correctedOffsetPx}`);
	};
	const scheduleRefresh = (): void => {
		if (disposed || animationFrame !== 0) return;
		animationFrame = ownerWindow.requestAnimationFrame(() => {
			animationFrame = 0;
			refresh();
		});
	};

	const ownerWindowWithObservers = ownerWindow as unknown as {
		ResizeObserver?: EmbedResizeObserverConstructor;
		MutationObserver?: EmbedMutationObserverConstructor;
	};
	const ResizeObserverCtor = ownerWindowWithObservers.ResizeObserver;
	resizeObserver = ResizeObserverCtor ? new ResizeObserverCtor(scheduleRefresh) : null;
	const MutationObserverCtor = ownerWindowWithObservers.MutationObserver;
	mutationObserver = MutationObserverCtor ? new MutationObserverCtor(scheduleRefresh) : null;
	mutationObserver?.observe(host, { childList: true });
	ownerWindow.addEventListener('resize', scheduleRefresh);

	const binding: EmbedPercentWidthBinding = {
		refresh,
		cleanup: () => {
			if (disposed) return;
			disposed = true;
			if (animationFrame !== 0) ownerWindow.cancelAnimationFrame(animationFrame);
			animationFrame = 0;
			resizeObserver?.disconnect();
			mutationObserver?.disconnect();
			ownerWindow.removeEventListener('resize', scheduleRefresh);
			restoreStyledTarget();
			activeBindings.delete(binding);
		},
	};
	activeBindings.add(binding);
	refresh();
	scheduleRefresh();
	return binding.cleanup;
}

export function refreshActiveEmbedPercentWidths(): void {
	for (const binding of activeBindings) binding.refresh();
}

function getEmbedWidthLayoutHost(host: HTMLElement): HTMLElement | null {
	let candidate: HTMLElement | null = host;
	while (candidate?.parentElement) {
		const parentElement: HTMLElement = candidate.parentElement;
		if (parentElement.matches('.markdown-preview-sizer, .cm-content')) return candidate;
		if (parentElement.matches('.markdown-preview-view, .markdown-source-view')) break;
		candidate = parentElement;
	}
	return null;
}

function snapshotInlineStyles(
	element: HTMLElement,
	properties: readonly string[],
): InlineStyleSnapshot[] {
	return properties.map(property => ({
		property,
		value: element.style.getPropertyValue(property),
		priority: element.style.getPropertyPriority(property),
	}));
}

function restoreInlineStyles(element: HTMLElement, snapshots: InlineStyleSnapshot[]): void {
	for (const snapshot of snapshots) {
		if (snapshot.value) {
			element.style.setProperty(snapshot.property, snapshot.value, snapshot.priority);
		} else {
			element.style.removeProperty(snapshot.property);
		}
	}
}

function resolveEmbedPaneBounds(host: HTMLElement): {
	left: number;
	right: number;
	observedElements: HTMLElement[];
} | null {
	const candidates: HTMLElement[] = [];
	const addClosest = (selector: string): void => {
		const candidate = host.closest<HTMLElement>(selector);
		if (candidate && !candidates.includes(candidate)) candidates.push(candidate);
	};

	addClosest('.markdown-preview-view');
	addClosest('.cm-scroller');
	addClosest('.markdown-source-view');
	addClosest('.markdown-embed-content');
	addClosest('.popover-content');
	addClosest('.view-content');

	if (candidates.length === 0) return null;

	let left = Number.NEGATIVE_INFINITY;
	let right = Number.POSITIVE_INFINITY;
	const observedElements: HTMLElement[] = [];
	const ownerWindow = getOwnerWindow(host);
	for (const candidate of candidates) {
		const rect = candidate.getBoundingClientRect();
		const clientWidth = candidate.clientWidth;
		if (rect.width <= 0 || clientWidth <= 0) continue;
		const computedStyle = ownerWindow.getComputedStyle(candidate);
		const paddingLeft = parseFinitePixelValue(computedStyle.paddingLeft);
		const paddingRight = parseFinitePixelValue(computedStyle.paddingRight);
		const clientLeft = rect.left + candidate.clientLeft;
		const candidateLeft = clientLeft + paddingLeft;
		const candidateRight = Math.min(rect.right, clientLeft + clientWidth) - paddingRight;
		left = Math.max(left, candidateLeft);
		right = Math.min(right, candidateRight);
		observedElements.push(candidate);
	}
	if (!Number.isFinite(left) || !Number.isFinite(right)) return null;

	const scroller = host.closest<HTMLElement>('.cm-scroller');
	const editor = host.closest<HTMLElement>('.cm-editor');
	const gutter = editor?.querySelector<HTMLElement>('.cm-gutters') ?? null;
	if (scroller && gutter) {
		const scrollerRect = scroller.getBoundingClientRect();
		const gutterRect = gutter.getBoundingClientRect();
		if (gutterRect.width > 0 && gutterRect.right > scrollerRect.left && gutterRect.left < scrollerRect.right) {
			const gutterIsOnPhysicalLeft = (
				gutterRect.left + gutterRect.width / 2
				< scrollerRect.left + scrollerRect.width / 2
			);
			if (gutterIsOnPhysicalLeft) {
				left = Math.max(left, gutterRect.right);
			} else {
				right = Math.min(right, gutterRect.left);
			}
			observedElements.push(gutter);
		}
	}

	left += EMBED_PANE_INLINE_INSET_PX;
	right -= EMBED_PANE_INLINE_INSET_PX;
	return right > left ? { left, right, observedElements } : null;
}

function parseFinitePixelValue(value: string): number {
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}
