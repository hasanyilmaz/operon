import { setIcon } from 'obsidian';
import { bindDescendantFocusVisible, cleanupDescendantFocusVisible } from './descendant-focus-visible';
import { createOwnerElement, getOwnerBody, getOwnerDocument, getOwnerWindow } from '../core/dom-compat';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { renderCompactTaskMarkdown } from './compact-task-markdown-renderer';

type OperonHoverTooltipColor = string | null | (() => string | null);

interface OperonHoverTooltipOptions {
 bindTheme?: (tooltip: HTMLElement) => void | (() => void);
	title?: string;
	titleIcon?: string;
	content?: string;
	contentEl?: HTMLElement;
	contentElFactory?: () => HTMLElement;
	taskColor: OperonHoverTooltipColor;
	openOnClick?: boolean;
	tooltipClassName?: string;
	preferredHorizontal?: 'auto' | 'left' | 'center' | 'right';
	preferredVertical?: 'auto' | 'above' | 'below';
	floatingHorizontalAnchor?: 'target-center' | 'pointer-entry';
	floatingHorizontalBoundary?: HTMLElement | null;
	constrainToVisualViewport?: boolean;
	owner?: Node | null;
	shouldOpen?: () => boolean;
	onClose?: () => void;
	onCleanup?: () => void;
}

/** Pointer-driven previews share the same shell and placement as ordinary Operon hover tooltips. */
export function showOperonPointerTooltip(target: HTMLElement, options: OperonHoverTooltipOptions): { position(): void; close(): void } {
	const tooltip = createTooltip(options.title, options.titleIcon, options.content, options.contentEl, options.tooltipClassName, target);
	tooltip.classList.add('operon-hover-tooltip--floating', 'is-visible');
	const color = resolveOperonHoverTooltipColor(options.taskColor);
	if (color) tooltip.setCssProps({ '--operon-live-hover-border': color });
	inheritExcalidrawSurfaceTheme(target, tooltip);
 const cleanupTheme = options.bindTheme?.(tooltip);
	getOwnerBody(target).appendChild(tooltip);
	const position = () => positionFloatingTooltip(target, tooltip, options, null);
	position();
	return { position, close: () => { cleanupTheme?.(); tooltip.remove(); } };
}

/** Floating tooltips live outside the native embed, which can override the vault theme. */
export function inheritExcalidrawSurfaceTheme(target: HTMLElement, tooltip: HTMLElement): void {
	if (!target.closest('[data-operon-task-card-excalidraw], [data-operon-excalidraw-pool]')) return;
	const style = getOwnerWindow(target).getComputedStyle(target);
	for (const key of ['--background-primary', '--background-modifier-border', '--text-normal', '--interactive-accent', '--link-color', '--code-background', '--code-normal', '--text-highlight-bg']) {
		const value = style.getPropertyValue(key).trim();
		// Excalidraw injects the native palette with a 90% alpha hex background.
		// Floating Operon surfaces must keep that hue without inheriting translucency.
		const surfaceValue = key === '--background-primary'
			? value.replace(/^#([\da-f]{6})[\da-f]{2}$/i, '#$1').replace(/^#([\da-f]{3})[\da-f]$/i, '#$1') : value;
		if (surfaceValue) tooltip.style.setProperty(key, surfaceValue);
	}
}

interface OperonFloatingTooltipHorizontalPlacementOptions {
	targetLeft: number;
	targetRight: number;
	tooltipWidth: number;
	viewportWidth: number;
	boundaryLeft?: number;
	boundaryRight?: number;
	pointerClientX?: number | null;
	padding?: number;
}

export interface OperonFloatingTooltipHorizontalPlacement {
	left: number;
	availableWidth: number;
}

interface OperonHoverIndicatorOptions extends OperonHoverTooltipOptions {
	icon: string;
}

type BoundTooltipTarget = HTMLElement & {
	_operonHoverCleanup?: () => void;
	_operonHoverClose?: () => void;
	_operonFloatingTooltip?: HTMLElement | null;
};

// Obsidian renders its own black tooltip for any element carrying title or
// aria-label. Move those into the sr-only label pattern so only Operon
// tooltips remain visible while screen readers keep the accessible name.
function suppressNativeTooltip(target: HTMLElement): void {
	target.removeAttribute('title');
	const nativeAriaLabel = target.getAttribute('aria-label');
	if (nativeAriaLabel) setAccessibleLabelWithoutTooltip(target, nativeAriaLabel);
}

function resolveOperonHoverTooltipColor(taskColor: OperonHoverTooltipColor): string | null {
	const resolved = typeof taskColor === 'function' ? taskColor() : taskColor;
	return resolved?.trim() || null;
}

/**
 * Operon tooltip integration contract:
 * - Use wrapWithOperonHoverTooltip for picker and inline controls that need the standard shell tooltip.
 * - Pass taskColor or a resolved surface accent when the tooltip should show the Operon gradient border.
 * - The gradient is driven by --operon-live-hover-border.
 * - Use bindOperonHoverTooltip for chips and controls inside clipped or scrollable surfaces.
 * - Avoid ad-hoc picker tooltip elements; they bypass shell styling, placement, and theme behavior.
 */
export function createOperonHoverIndicator(options: OperonHoverIndicatorOptions): HTMLElement {
	const wrapper = createOperonHoverTooltipShell(options, options.owner);
	wrapper.classList.add('operon-hover-indicator');

	const button = createOwnerElement(wrapper, 'span');
	button.className = 'operon-live-preview-edit operon-live-preview-action operon-hover-trigger operon-task-note-action is-active';
	button.setAttribute('role', 'img');
	setIcon(button, options.icon);
	setAccessibleLabelWithoutTooltip(button, options.title ?? '');
	wrapper.appendChild(button);
	button.setAttribute('tabindex', '0');
	bindOperonHoverTooltip(button, options);

	return wrapper;
}

export function createCompactTaskMarkdownTooltipContent(owner: Node, content: string): HTMLElement {
	const container = createOwnerElement(owner, 'span');
	renderCompactTaskMarkdown(container, {
		value: content,
		mode: 'tooltip',
	});
	return container;
}

export function wrapWithOperonHoverTooltip(
	target: HTMLElement,
	options: OperonHoverTooltipOptions,
): HTMLElement {
	const wrapper = createOperonHoverTooltipShell(options, target);
	wrapper.classList.add('operon-hover-tooltip-anchor');
	suppressNativeTooltip(target);
	wrapper.appendChild(target);
	wrapper.appendChild(createTooltip(options.title, options.titleIcon, options.content, undefined, options.tooltipClassName, wrapper));
	return wrapper;
}

export function wrapWithOperonHoverContent(
	target: HTMLElement,
	options: OperonHoverTooltipOptions,
): HTMLElement {
	const wrapper = createOperonHoverTooltipShell(options, target);
	wrapper.classList.add('operon-hover-tooltip-anchor');
	suppressNativeTooltip(target);
	wrapper.appendChild(target);
	wrapper.appendChild(createTooltip(options.title, options.titleIcon, options.content, options.contentEl, options.tooltipClassName, wrapper));
	if (options.openOnClick) {
		bindInteractiveOpen(wrapper, target);
	}
	return wrapper;
}

export function closeOperonHoverTooltip(wrapper: HTMLElement): void {
	wrapper.classList.remove('is-tooltip-open');
}

export function bindOperonHoverTooltip(
	target: HTMLElement,
	options: OperonHoverTooltipOptions,
): void {
	const typedTarget = target as BoundTooltipTarget;
	typedTarget._operonHoverCleanup?.();
	suppressNativeTooltip(target);

	if (!options.title && !options.content && !options.contentEl && !options.contentElFactory) return;
	let dismissedByAction = false;
	let dismissalDocument: Document | null = null;
	let tooltip: HTMLElement | null = null;
	let tooltipWindow: Window | null = null;
	let visibilityFrame: { owner: Window; id: number | null } | null = null;
	let stopMigration: (() => void) | null = null;
	let disposed = false;

	const clearDismissalListener = (): void => {
		dismissalDocument?.removeEventListener('keydown', resetKeyboardDismissal, true);
		dismissalDocument = null;
	};
	const unbindTooltipWindow = (): void => {
		tooltipWindow?.removeEventListener('scroll', close, true);
		tooltipWindow?.removeEventListener('resize', close, true);
		if (visibilityFrame?.id != null) visibilityFrame.owner.cancelAnimationFrame(visibilityFrame.id);
		visibilityFrame = null;
		tooltipWindow = null;
	};
	const revealTooltip = (): void => {
		if (!tooltip || !tooltipWindow) return;
		const current = tooltip;
		const frame = { owner: tooltipWindow, id: null as number | null };
		visibilityFrame = frame;
		frame.id = frame.owner.requestAnimationFrame(() => {
			if (disposed || visibilityFrame !== frame || tooltip !== current) return;
			visibilityFrame = null;
			current.classList.add('is-visible');
		});
	};
	const bindTooltipWindow = (): void => {
		tooltipWindow = getOwnerWindow(target);
		tooltipWindow.addEventListener('scroll', close, true);
		tooltipWindow.addEventListener('resize', close, true);
	};
	const migrateOwner = (): void => {
		if (disposed) return;
		const doc = getOwnerDocument(target);
		if (dismissalDocument && dismissalDocument !== doc) {
			clearDismissalListener();
			dismissalDocument = doc;
			doc.addEventListener('keydown', resetKeyboardDismissal, true);
		}
		if (tooltip && tooltipWindow !== getOwnerWindow(target)) {
			const pendingReveal = visibilityFrame !== null;
			unbindTooltipWindow();
			getOwnerBody(target).appendChild(tooltip);
			inheritExcalidrawSurfaceTheme(target, tooltip);
			positionFloatingTooltip(target, tooltip, options, null);
			bindTooltipWindow();
			if (pendingReveal) revealTooltip();
		}
	};
	const syncMigrationSubscription = (): void => {
		if (disposed || (!tooltip && !dismissalDocument)) {
			stopMigration?.();
			stopMigration = null;
		} else if (!stopMigration) {
			stopMigration = target.onWindowMigrated?.(migrateOwner) ?? null;
		}
	};
	const close = (event?: Event): void => {
		// Old-window events may arrive before the migration notification; blur still closes immediately.
		if (event && event.type !== 'blur' && event.type !== 'focusout'
			&& tooltipWindow && getOwnerWindow(target) !== tooltipWindow) return;
		unbindTooltipWindow();
		const current = tooltip;
		tooltip = null;
		if (current) {
			current.remove();
			if (typedTarget._operonFloatingTooltip === current) typedTarget._operonFloatingTooltip = null;
		}
		syncMigrationSubscription();
		if (current) options.onClose?.();
	};

	const dismiss = (): void => {
		if (disposed) return;
		dismissedByAction = true;
		const doc = getOwnerDocument(target);
		if (dismissalDocument !== doc) {
			clearDismissalListener();
			dismissalDocument = doc;
			doc.addEventListener('keydown', resetKeyboardDismissal, true);
		}
		close();
	};
	const resetKeyboardDismissal = (event: KeyboardEvent): void => {
		if (event.key !== 'Tab' || getOwnerDocument(target) !== dismissalDocument) return;
		dismissedByAction = false;
		clearDismissalListener();
		syncMigrationSubscription();
	};
	const open = (event?: Event): void => {
		if (disposed) return;
		if (event?.type === 'mouseenter') {
			dismissedByAction = false;
			clearDismissalListener();
		}
		if (dismissedByAction) return;
		if (event?.type === 'focusin' && !target.matches(':focus-visible') && !target.querySelector(':focus-visible')) return;
		if (options.shouldOpen && !options.shouldOpen()) {
			close();
			return;
		}
		const eventClientX = (event as MouseEvent | undefined)?.clientX;
		const pointerClientX = options.floatingHorizontalAnchor === 'pointer-entry'
			&& typeof eventClientX === 'number'
			&& Number.isFinite(eventClientX)
			? eventClientX
			: null;
		if (tooltip) {
			migrateOwner();
			positionFloatingTooltip(target, tooltip, options, pointerClientX);
			return;
		}
		const contentEl = options.contentElFactory?.() ?? options.contentEl;
		tooltip = createTooltip(options.title, options.titleIcon, options.content, contentEl, options.tooltipClassName, target);
		tooltip.classList.add('operon-hover-tooltip--floating');
		const taskColor = resolveOperonHoverTooltipColor(options.taskColor);
		if (taskColor) {
			tooltip.setCssProps({ '--operon-live-hover-border': taskColor });
		}
		inheritExcalidrawSurfaceTheme(target, tooltip);
		getOwnerBody(target).appendChild(tooltip);
		positionFloatingTooltip(target, tooltip, options, pointerClientX);
		typedTarget._operonFloatingTooltip = tooltip;
		bindTooltipWindow();
		syncMigrationSubscription();
		revealTooltip();
	};

	const cleanup = (): void => {
		if (disposed) return;
		disposed = true;
		clearDismissalListener();
		close();
		target.removeEventListener('mouseenter', open);
		target.removeEventListener('mouseleave', close);
		target.removeEventListener('pointerdown', dismiss, true);
		target.removeEventListener('click', dismiss, true);
		target.removeEventListener('focusin', open);
		target.removeEventListener('focusout', close);
		target.removeEventListener('blur', close);
		options.onCleanup?.();
	};

	target.addEventListener('mouseenter', open);
	target.addEventListener('mouseleave', close);
	target.addEventListener('pointerdown', dismiss, true);
	target.addEventListener('click', dismiss, true);
	target.addEventListener('focusin', open);
	target.addEventListener('focusout', close);
	target.addEventListener('blur', close);
	typedTarget._operonHoverClose = close;
	typedTarget._operonHoverCleanup = cleanup;
}

/** Hide retained UI without removing its hover/focus bindings or clock subscriptions. */
export function closeBoundOperonHoverTooltips(root: HTMLElement): void {
 for (const target of [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))]) closeBoundOperonHoverTooltip(target);
}

export function closeBoundOperonHoverTooltip(target: HTMLElement): void {
	(target as BoundTooltipTarget)._operonHoverClose?.();
}

export function resolveOperonFloatingTooltipHorizontalPlacement(
	options: OperonFloatingTooltipHorizontalPlacementOptions,
): OperonFloatingTooltipHorizontalPlacement {
	const padding = options.padding ?? 8;
	const viewportLeft = padding;
	const viewportRight = Math.max(viewportLeft, options.viewportWidth - padding);
	const hasUsableBoundary = typeof options.boundaryLeft === 'number'
		&& Number.isFinite(options.boundaryLeft)
		&& typeof options.boundaryRight === 'number'
		&& Number.isFinite(options.boundaryRight)
		&& options.boundaryRight - options.boundaryLeft > padding * 2;
	const boundaryLeft = hasUsableBoundary ? options.boundaryLeft as number : viewportLeft - padding;
	const boundaryRight = hasUsableBoundary ? options.boundaryRight as number : viewportRight + padding;
	const placementLeft = Math.max(viewportLeft, boundaryLeft + padding);
	const placementRight = Math.min(viewportRight, boundaryRight - padding);
	const availableWidth = Math.max(0, placementRight - placementLeft);
	const tooltipWidth = Math.min(Math.max(0, options.tooltipWidth), availableWidth);
	const targetCenter = options.targetLeft + ((options.targetRight - options.targetLeft) / 2);
	let anchorX = targetCenter;

	if (typeof options.pointerClientX === 'number' && Number.isFinite(options.pointerClientX)) {
		anchorX = options.pointerClientX;
	} else if (hasUsableBoundary) {
		const visibleTargetLeft = Math.max(options.targetLeft, placementLeft);
		const visibleTargetRight = Math.min(options.targetRight, placementRight);
		if (visibleTargetRight > visibleTargetLeft) {
			anchorX = visibleTargetLeft + ((visibleTargetRight - visibleTargetLeft) / 2);
		}
	}

	const desiredLeft = anchorX - (tooltipWidth / 2);
	const maximumLeft = Math.max(placementLeft, placementRight - tooltipWidth);
	return {
		left: Math.max(placementLeft, Math.min(desiredLeft, maximumLeft)),
		availableWidth,
	};
}

export function cleanupOperonHoverTooltips(root: HTMLElement): void {
	cleanupDescendantFocusVisible(root);
	const targets = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))] as BoundTooltipTarget[];
	for (const target of targets) {
		const cleanup = target._operonHoverCleanup;
		if (!cleanup) continue;
		cleanup();
		delete target._operonHoverCleanup;
		delete target._operonHoverClose;
	}
}

export function createOperonHoverTooltipShell(options: OperonHoverTooltipOptions, owner?: Node | null): HTMLElement {
	const wrapper = createOwnerElement(owner, 'span');
	wrapper.className = 'operon-hover-tooltip-shell';
	const cleanupFocus = bindDescendantFocusVisible(wrapper);
	const taskColor = resolveOperonHoverTooltipColor(options.taskColor);
	if (taskColor) wrapper.setCssProps({ '--operon-live-hover-border': taskColor });
	wrapper.dataset.tooltipHorizontal = options.preferredHorizontal ?? 'auto';
	wrapper.dataset.tooltipVertical = options.preferredVertical ?? 'auto';
	const ownerDocument = getOwnerDocument(wrapper);
	const resetDismissal = (): void => {
		wrapper.classList.remove('is-tooltip-dismissed');
		ownerDocument.removeEventListener('keydown', onKeyboardNavigation, true);
	};
	const onKeyboardNavigation = (event: KeyboardEvent): void => {
		if (event.key === 'Tab') resetDismissal();
	};
	const dismiss = (): void => {
		wrapper.classList.add('is-tooltip-dismissed');
		ownerDocument.addEventListener('keydown', onKeyboardNavigation, true);
	};
	wrapper.addEventListener('mouseenter', () => {
		resetDismissal();
		updateTooltipPlacement(wrapper);
	});
	wrapper.addEventListener('focusin', () => updateTooltipPlacement(wrapper));
	wrapper.addEventListener('pointerdown', dismiss, true);
	wrapper.addEventListener('click', dismiss, true);
	(wrapper as BoundTooltipTarget)._operonHoverCleanup = () => {
		cleanupFocus();
		ownerDocument.removeEventListener('keydown', onKeyboardNavigation, true);
	};
	return wrapper;
}

function createTooltip(
	title?: string,
	titleIcon?: string,
	content?: string,
	contentEl?: HTMLElement,
	tooltipClassName?: string,
	owner?: Node | null,
): HTMLElement {
	const tooltip = createOwnerElement(owner, 'div');
	tooltip.className = ['operon-hover-tooltip', tooltipClassName ?? ''].filter(Boolean).join(' ');

	if (title) {
		const tooltipTitle = createOwnerElement(tooltip, 'div');
		tooltipTitle.className = 'operon-hover-tooltip-title';
		if (titleIcon) {
			tooltipTitle.classList.add('operon-hover-tooltip-title--with-icon');
			const titleIconEl = createOwnerElement(tooltipTitle, 'span');
			titleIconEl.className = 'operon-hover-tooltip-title-icon';
			setIcon(titleIconEl, titleIcon);
			tooltipTitle.appendChild(titleIconEl);
			const titleTextEl = createOwnerElement(tooltipTitle, 'span');
			titleTextEl.className = 'operon-hover-tooltip-title-text';
			titleTextEl.textContent = title;
			tooltipTitle.appendChild(titleTextEl);
		} else {
			tooltipTitle.textContent = title;
		}
		tooltip.appendChild(tooltipTitle);
	}

	if (contentEl) {
		const tooltipBody = createOwnerElement(tooltip, 'div');
		tooltipBody.className = 'operon-hover-tooltip-body';
		tooltipBody.appendChild(contentEl);
		tooltip.appendChild(tooltipBody);
	} else if (content) {
		const tooltipBody = createOwnerElement(tooltip, 'div');
		tooltipBody.className = 'operon-hover-tooltip-body';
		tooltipBody.textContent = content;
		tooltip.appendChild(tooltipBody);
	}

	return tooltip;
}

function updateTooltipPlacement(wrapper: HTMLElement): void {
	const tooltip = wrapper.querySelector<HTMLElement>('.operon-hover-tooltip');
	if (!tooltip) return;

	wrapper.classList.remove(
		'is-tooltip-above',
		'is-tooltip-below',
		'is-tooltip-left',
		'is-tooltip-center',
		'is-tooltip-right',
	);
	wrapper.classList.add('is-tooltip-below');
	wrapper.classList.add('is-tooltip-center');

	const wrapperRect = wrapper.getBoundingClientRect();
	const tooltipHeight = tooltip.offsetHeight || 140;
	const tooltipWidth = tooltip.offsetWidth || 220;
	const ownerWindow = getOwnerWindow(wrapper);
	const viewportHeight = ownerWindow.innerHeight;
	const viewportWidth = ownerWindow.innerWidth;
	const spaceBelow = viewportHeight - wrapperRect.bottom;
	const spaceAbove = wrapperRect.top;
	const viewportPadding = 8;
	const preferredVertical = wrapper.dataset.tooltipVertical ?? 'auto';
	const belowFits = spaceBelow >= tooltipHeight + 16;
	const aboveFits = spaceAbove >= tooltipHeight + 16;

	if (
		(preferredVertical === 'above' && (aboveFits || (!belowFits && spaceAbove > spaceBelow)))
		|| (preferredVertical === 'below' && !belowFits && aboveFits)
		|| (preferredVertical === 'auto' && !belowFits && spaceAbove > spaceBelow)
	) {
		wrapper.classList.remove('is-tooltip-below');
		wrapper.classList.add('is-tooltip-above');
	}

	const preferredHorizontal = wrapper.dataset.tooltipHorizontal ?? 'auto';
	if (preferredHorizontal === 'left' || preferredHorizontal === 'center' || preferredHorizontal === 'right') {
		wrapper.classList.remove('is-tooltip-left', 'is-tooltip-center', 'is-tooltip-right');
		wrapper.classList.add(`is-tooltip-${preferredHorizontal}`);
		return;
	}

	const centeredLeft = wrapperRect.left + (wrapperRect.width / 2) - (tooltipWidth / 2);
	const centeredRight = centeredLeft + tooltipWidth;
	if (centeredLeft >= viewportPadding && centeredRight <= viewportWidth - viewportPadding) {
		return;
	}

	const alignLeftRight = wrapperRect.left + tooltipWidth;
	const alignRightLeft = wrapperRect.right - tooltipWidth;
	const fitsLeft = alignLeftRight <= viewportWidth - viewportPadding;
	const fitsRight = alignRightLeft >= viewportPadding;

	wrapper.classList.remove('is-tooltip-center');
	if (fitsRight && (!fitsLeft || wrapperRect.right > viewportWidth * 0.65)) {
		wrapper.classList.add('is-tooltip-right');
		return;
	}

	if (fitsLeft) {
		wrapper.classList.add('is-tooltip-left');
		return;
	}

	wrapper.classList.add(centeredLeft < viewportPadding ? 'is-tooltip-left' : 'is-tooltip-right');
}

function bindInteractiveOpen(wrapper: HTMLElement, target: HTMLElement): void {
	const ownerDocument = getOwnerDocument(wrapper);
	const open = (event?: Event) => {
		event?.preventDefault();
		event?.stopPropagation();
		updateTooltipPlacement(wrapper);
		wrapper.classList.add('is-tooltip-open');
	};
	const closeOnOutside = (event: Event) => {
		if (wrapper.contains(event.target as Node)) return;
		wrapper.classList.remove('is-tooltip-open');
		ownerDocument.removeEventListener('pointerdown', closeOnOutside, true);
		ownerDocument.removeEventListener('touchstart', closeOnOutside, true);
		ownerDocument.removeEventListener('keydown', onKeyDown, true);
	};
	const onKeyDown = (event: Event) => {
		if ((event as KeyboardEvent).key === 'Escape') {
			wrapper.classList.remove('is-tooltip-open');
			ownerDocument.removeEventListener('pointerdown', closeOnOutside, true);
			ownerDocument.removeEventListener('touchstart', closeOnOutside, true);
			ownerDocument.removeEventListener('keydown', onKeyDown, true);
		}
	};
	target.addEventListener('click', (event) => {
		const wasOpen = wrapper.classList.contains('is-tooltip-open');
		if (wasOpen) {
			wrapper.classList.remove('is-tooltip-open');
			return;
		}
		open(event);
		ownerDocument.addEventListener('pointerdown', closeOnOutside, true);
		ownerDocument.addEventListener('touchstart', closeOnOutside, true);
		ownerDocument.addEventListener('keydown', onKeyDown, true);
	});
}

function positionFloatingTooltip(
	target: HTMLElement,
	tooltip: HTMLElement,
	options: OperonHoverTooltipOptions,
	pointerClientX: number | null,
): void {
	const rect = target.getBoundingClientRect();
	const ownerWindow = getOwnerWindow(target);
	const viewportPadding = 8;
	const visual = options.constrainToVisualViewport ? ownerWindow.visualViewport : null;
	const viewportTop = visual?.offsetTop ?? 0, viewportBottom = viewportTop + (visual?.height ?? ownerWindow.innerHeight);
	const viewportLeft = visual?.offsetLeft ?? 0, viewportRight = viewportLeft + (visual?.width ?? ownerWindow.innerWidth);
	const boundary = options.floatingHorizontalBoundary?.getBoundingClientRect();
	const boundaryRect = boundary || visual ? { left: Math.max(boundary?.left ?? viewportLeft, viewportLeft), right: Math.min(boundary?.right ?? viewportRight, viewportRight) } : null;
	if (visual) { tooltip.style.maxHeight = `${Math.max(0, visual.height - 16)}px`; tooltip.classList.add('operon-hover-tooltip--viewport-constrained'); }
	let tooltipWidth = tooltip.offsetWidth || 220;
	let horizontalPlacement = resolveOperonFloatingTooltipHorizontalPlacement({
		targetLeft: rect.left,
		targetRight: rect.right,
		tooltipWidth,
		viewportWidth: ownerWindow.innerWidth,
		...(boundaryRect ? { boundaryLeft: boundaryRect.left, boundaryRight: boundaryRect.right } : {}),
		pointerClientX,
		padding: viewportPadding,
	});
	if (boundaryRect && horizontalPlacement.availableWidth > 0 && tooltipWidth > horizontalPlacement.availableWidth) {
		tooltip.style.maxWidth = `${horizontalPlacement.availableWidth}px`;
		tooltipWidth = tooltip.offsetWidth || horizontalPlacement.availableWidth;
		horizontalPlacement = resolveOperonFloatingTooltipHorizontalPlacement({
			targetLeft: rect.left,
			targetRight: rect.right,
			tooltipWidth,
			viewportWidth: ownerWindow.innerWidth,
			boundaryLeft: boundaryRect.left,
			boundaryRight: boundaryRect.right,
			pointerClientX,
			padding: viewportPadding,
		});
	}
	const tooltipHeight = tooltip.offsetHeight || 56;
	const belowTop = rect.bottom + 8;
	const aboveTop = rect.top - tooltipHeight - 8;
	const canPlaceAbove = aboveTop >= viewportTop + viewportPadding;
	const belowOverflows = belowTop + tooltipHeight > viewportBottom - viewportPadding;
	const preferredVertical = options.preferredVertical ?? 'auto';
	const placeAbove = preferredVertical === 'above'
		? canPlaceAbove || belowOverflows
		: preferredVertical === 'below'
			? false
			: belowOverflows && canPlaceAbove;
	const maxTop = viewportBottom - tooltipHeight - viewportPadding;
	const top = placeAbove
		? Math.max(viewportTop + viewportPadding, visual ? Math.min(aboveTop, maxTop) : aboveTop)
		: Math.max(viewportTop + viewportPadding, Math.min(belowTop, maxTop));

	tooltip.classList.toggle('is-tooltip-above', placeAbove);
	tooltip.style.left = `${horizontalPlacement.left}px`;
	tooltip.style.top = `${top}px`;
}
