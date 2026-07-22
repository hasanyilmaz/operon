import { setIcon } from 'obsidian';
import { createOwnerElement, getOwnerBody, getOwnerDocument, getOwnerWindow } from '../core/dom-compat';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';

type OperonHoverTooltipColor = string | null | (() => string | null);

interface OperonHoverTooltipOptions {
	title?: string;
	titleIcon?: string;
	content?: string;
	contentEl?: HTMLElement;
	taskColor: OperonHoverTooltipColor;
	openOnClick?: boolean;
	tooltipClassName?: string;
	preferredHorizontal?: 'auto' | 'left' | 'center' | 'right';
	preferredVertical?: 'auto' | 'above' | 'below';
	owner?: Node | null;
	shouldOpen?: () => boolean;
}

interface OperonHoverIndicatorOptions extends OperonHoverTooltipOptions {
	icon: string;
}

type BoundTooltipTarget = HTMLElement & {
	_operonHoverCleanup?: () => void;
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
 * - Use bindOperonHoverTooltip only when wrapping the target would break layout or ownership.
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
	wrapper.appendChild(createTooltip(options.title, options.titleIcon, options.content, options.contentEl, options.tooltipClassName, wrapper));

	return wrapper;
}

export function createNonInteractiveMarkdownLinkContent(owner: Node, content: string): HTMLElement {
	const container = createOwnerElement(owner, 'span');
	let cursor = 0;
	const appendText = (text: string): void => {
		const segment = createOwnerElement(container, 'span');
		segment.textContent = text;
		container.appendChild(segment);
	};

	for (const link of scanMarkdownExternalLinks(content)) {
		if (link.start > cursor) {
			appendText(content.slice(cursor, link.start));
		}
		const label = createOwnerElement(container, 'span');
		label.className = 'operon-hover-tooltip-link-label';
		label.textContent = link.label;
		container.appendChild(label);
		cursor = link.end;
	}

	if (cursor < content.length) {
		appendText(content.slice(cursor));
	}
	return container;
}

interface MarkdownExternalLinkMatch {
	start: number;
	end: number;
	label: string;
}

function scanMarkdownExternalLinks(content: string): MarkdownExternalLinkMatch[] {
	const matches: MarkdownExternalLinkMatch[] = [];
	let searchFrom = 0;
	while (searchFrom < content.length) {
		const start = content.indexOf('[', searchFrom);
		if (start < 0) break;
		if (start > 0 && content[start - 1] === '!') {
			searchFrom = start + 1;
			continue;
		}
		const labelEnd = content.indexOf('](', start + 1);
		if (labelEnd < 0) break;
		if (content.slice(start + 1, labelEnd).includes('\n')) {
			searchFrom = start + 1;
			continue;
		}
		const label = content.slice(start + 1, labelEnd);
		if (!label || label.includes('[') || label.includes(']')) {
			searchFrom = start + 1;
			continue;
		}

		let depth = 1;
		let destinationEnd = labelEnd + 2;
		for (; destinationEnd < content.length; destinationEnd += 1) {
			const char = content[destinationEnd];
			if (char === '\n') break;
			if (char === '\\') {
				destinationEnd += 1;
				continue;
			}
			if (char === '(') depth += 1;
			if (char === ')') {
				depth -= 1;
				if (depth === 0) break;
			}
		}
		if (depth !== 0) {
			searchFrom = start + 1;
			continue;
		}
		const destination = content.slice(labelEnd + 2, destinationEnd).trim();
		if (!/^https?:\/\/\S+$/iu.test(destination)) {
			searchFrom = start + 1;
			continue;
		}
		matches.push({ start, end: destinationEnd + 1, label });
		searchFrom = destinationEnd + 1;
	}
	return matches;
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

	if (!options.title && !options.content && !options.contentEl) return;
	const ownerWindow = getOwnerWindow(target);

	const close = (): void => {
		ownerWindow.removeEventListener('scroll', close, true);
		ownerWindow.removeEventListener('resize', close, true);
		const tooltip = typedTarget._operonFloatingTooltip;
		if (!tooltip) return;
		tooltip.remove();
		typedTarget._operonFloatingTooltip = null;
	};

	const open = (): void => {
		if (options.shouldOpen && !options.shouldOpen()) {
			close();
			return;
		}
		if (typedTarget._operonFloatingTooltip) {
			positionFloatingTooltip(target, typedTarget._operonFloatingTooltip, options.preferredVertical ?? 'auto');
			return;
		}
		const tooltip = createTooltip(options.title, options.titleIcon, options.content, options.contentEl, options.tooltipClassName, target);
		tooltip.classList.add('operon-hover-tooltip--floating');
		const taskColor = resolveOperonHoverTooltipColor(options.taskColor);
		if (taskColor) {
			tooltip.setCssProps({ '--operon-live-hover-border': taskColor });
		}
		getOwnerBody(target).appendChild(tooltip);
		positionFloatingTooltip(target, tooltip, options.preferredVertical ?? 'auto');
		ownerWindow.addEventListener('scroll', close, true);
		ownerWindow.addEventListener('resize', close, true);
		ownerWindow.requestAnimationFrame(() => tooltip.classList.add('is-visible'));
		typedTarget._operonFloatingTooltip = tooltip;
	};

	const cleanup = (): void => {
		close();
		target.removeEventListener('mouseenter', open);
		target.removeEventListener('mouseleave', close);
		target.removeEventListener('pointerdown', close);
		target.removeEventListener('click', close);
		target.removeEventListener('focusin', open);
		target.removeEventListener('focusout', close);
		target.removeEventListener('blur', close);
	};

	target.addEventListener('mouseenter', open);
	target.addEventListener('mouseleave', close);
	target.addEventListener('pointerdown', close);
	target.addEventListener('click', close);
	target.addEventListener('focusin', open);
	target.addEventListener('focusout', close);
	target.addEventListener('blur', close);
	typedTarget._operonHoverCleanup = cleanup;
}

export function cleanupOperonHoverTooltips(root: HTMLElement): void {
	const targets = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))] as BoundTooltipTarget[];
	for (const target of targets) {
		const cleanup = target._operonHoverCleanup;
		if (!cleanup) continue;
		cleanup();
		delete target._operonHoverCleanup;
	}
}

export function createOperonHoverTooltipShell(options: OperonHoverTooltipOptions, owner?: Node | null): HTMLElement {
	const wrapper = createOwnerElement(owner, 'span');
	wrapper.className = 'operon-hover-tooltip-shell';
	const taskColor = resolveOperonHoverTooltipColor(options.taskColor);
	if (taskColor) wrapper.setCssProps({ '--operon-live-hover-border': taskColor });
	wrapper.dataset.tooltipHorizontal = options.preferredHorizontal ?? 'auto';
	wrapper.dataset.tooltipVertical = options.preferredVertical ?? 'auto';
	wrapper.addEventListener('mouseenter', () => updateTooltipPlacement(wrapper));
	wrapper.addEventListener('focusin', () => updateTooltipPlacement(wrapper));
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
	preferredVertical: 'auto' | 'above' | 'below' = 'auto',
): void {
	const rect = target.getBoundingClientRect();
	const tooltipWidth = tooltip.offsetWidth || 220;
	const tooltipHeight = tooltip.offsetHeight || 56;
	const ownerWindow = getOwnerWindow(target);
	const viewportPadding = 8;
	const availableWidth = ownerWindow.innerWidth - viewportPadding * 2;
	const clampedWidth = Math.min(tooltipWidth, availableWidth);
	const centeredLeft = rect.left + (rect.width / 2) - (clampedWidth / 2);
	const left = Math.max(viewportPadding, Math.min(centeredLeft, ownerWindow.innerWidth - clampedWidth - viewportPadding));
	const belowTop = rect.bottom + 8;
	const aboveTop = rect.top - tooltipHeight - 8;
	const canPlaceAbove = aboveTop >= viewportPadding;
	const belowOverflows = belowTop + tooltipHeight > ownerWindow.innerHeight - viewportPadding;
	const placeAbove = preferredVertical === 'above'
		? canPlaceAbove || belowOverflows
		: preferredVertical === 'below'
			? false
			: belowOverflows && canPlaceAbove;
	const maxTop = ownerWindow.innerHeight - tooltipHeight - viewportPadding;
	const top = placeAbove
		? Math.max(viewportPadding, aboveTop)
		: Math.max(viewportPadding, Math.min(belowTop, maxTop));

	tooltip.classList.toggle('is-tooltip-above', placeAbove);
	tooltip.style.left = `${left}px`;
	tooltip.style.top = `${top}px`;
}
