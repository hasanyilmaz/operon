import { getOwnerDocument, getOwnerWindow } from '../core/dom-compat';
import { bindOperonHoverTooltip } from './operon-hover-tooltip';

type IconOnlyPreviewChip = HTMLElement & {
	_operonCloseOnOutside?: (event: Event) => void;
	_operonCloseOnEscape?: (event: Event) => void;
	_operonCloseDocument?: Document;
	_operonHoverCleanup?: () => void;
	_operonIconOnlyExpansionSuppressed?: boolean;
};

const ICON_ONLY_EXPANSION_VIEWPORT_PADDING_PX = 8;

export function bindIconOnlyChipPreview(chip: HTMLElement): void {
	chip.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		if (chip.classList.contains('is-peek-open')) {
			closeIconOnlyChipPreview(chip);
			return;
		}
		openIconOnlyChipPreview(chip);
	});
}

export function bindAdaptiveIconOnlyExpansion(
	chip: HTMLElement,
	label?: string,
	taskColor?: string | null,
	options: { showTooltip?: boolean } = {},
): void {
	const typed = chip as IconOnlyPreviewChip;
	const openHover = (): void => {
		typed._operonIconOnlyExpansionSuppressed = false;
		if (chip.classList.contains('is-peek-open')) {
			chip.classList.add('is-hover-open');
			return;
		}
		if (!canExpandIconOnlyChipInline(chip)) {
			typed._operonIconOnlyExpansionSuppressed = true;
			chip.classList.remove('is-hover-open');
			return;
		}
		chip.classList.add('is-hover-open');
	};
	const closeHover = (): void => {
		typed._operonIconOnlyExpansionSuppressed = false;
		chip.classList.remove('is-measuring-expand');
		chip.classList.remove('is-floating-expand');
		if (chip.classList.contains('is-peek-open')) return;
		chip.classList.remove('is-hover-open');
	};
	chip.addEventListener('mouseenter', openHover);
	chip.addEventListener('mouseleave', closeHover);
	chip.addEventListener('focusin', openHover);
	chip.addEventListener('focusout', closeHover);

	const tooltipLabel = label?.trim();
	if (tooltipLabel && options.showTooltip !== false && !typed._operonHoverCleanup) {
		bindOperonHoverTooltip(chip, {
			content: tooltipLabel,
			taskColor: taskColor ?? null,
			shouldOpen: () => isIconOnlyChipExpansionSuppressed(chip),
		});
	}
}

function canExpandIconOnlyChipInline(chip: HTMLElement): boolean {
	const parent = chip.parentElement;
	if (!parent) return true;

	const collapsedRect = chip.getBoundingClientRect();
	const parentRect = parent.getBoundingClientRect();
	if (collapsedRect.width <= 0 || parentRect.width <= 0) return true;

	let expandedWidth = collapsedRect.width;
	chip.classList.add('is-measuring-expand');
	try {
		const expandedRect = chip.getBoundingClientRect();
		expandedWidth = Math.max(
			getPositiveFiniteSize(expandedRect.width),
			getPositiveFiniteSize(chip.scrollWidth),
			getPositiveFiniteSize(chip.offsetWidth),
			getPositiveFiniteSize(collapsedRect.width),
		);
	} finally {
		chip.classList.remove('is-measuring-expand');
	}

	const ownerWindow = getOwnerWindow(chip);
	const viewportRight = ownerWindow.innerWidth > 0
		? ownerWindow.innerWidth - ICON_ONLY_EXPANSION_VIEWPORT_PADDING_PX
		: parentRect.right;
	const boundaryRight = Math.min(parentRect.right, viewportRight);
	return collapsedRect.left + Math.ceil(expandedWidth) <= boundaryRight + 1;
}

function getPositiveFiniteSize(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

export function shouldOpenIconOnlyChipPreview(chip: HTMLElement): boolean {
	return !chip.classList.contains('is-peek-open') && !chip.matches(':hover');
}

export function isIconOnlyChipExpansionSuppressed(chip: HTMLElement): boolean {
	return (chip as IconOnlyPreviewChip)._operonIconOnlyExpansionSuppressed === true;
}

export function openIconOnlyChipPreview(chip: HTMLElement): void {
	closeIconOnlyChipPreview(chip);
	chip.classList.add('is-peek-open');
	const closeOnOutside = (event: Event): void => {
		if (chip.contains(event.target as Node)) return;
		closeIconOnlyChipPreview(chip);
	};
	const closeOnEscape = (event: Event): void => {
		if (!('key' in event) || event.key !== 'Escape') return;
		closeIconOnlyChipPreview(chip);
	};
	const ownerDocument = getOwnerDocument(chip);
	const typed = chip as IconOnlyPreviewChip;
	typed._operonCloseOnOutside = closeOnOutside;
	typed._operonCloseOnEscape = closeOnEscape;
	typed._operonCloseDocument = ownerDocument;
	ownerDocument.addEventListener('pointerdown', closeOnOutside, true);
	ownerDocument.addEventListener('keydown', closeOnEscape, true);
}

export function closeIconOnlyChipPreview(chip: HTMLElement): void {
	chip.classList.remove('is-peek-open');
	chip.classList.remove('is-hover-open');
	chip.classList.remove('is-measuring-expand');
	chip.classList.remove('is-floating-expand');
	const typed = chip as IconOnlyPreviewChip;
	typed._operonIconOnlyExpansionSuppressed = false;
	const ownerDocument = typed._operonCloseDocument ?? getOwnerDocument(chip);
	if (typed._operonCloseOnOutside) {
		ownerDocument.removeEventListener('pointerdown', typed._operonCloseOnOutside, true);
	}
	if (typed._operonCloseOnEscape) {
		ownerDocument.removeEventListener('keydown', typed._operonCloseOnEscape, true);
	}
	delete typed._operonCloseOnOutside;
	delete typed._operonCloseOnEscape;
	delete typed._operonCloseDocument;
}

export function closeIconOnlyChipPreviewsForRoot(root: ParentNode): void {
	const rootNode = root as Node;
	const chips = Array.from(root.querySelectorAll<HTMLElement>('.operon-inline-compact-chip.is-peek-open'));
	for (const chip of chips) {
		if (rootNode.contains(chip)) {
			closeIconOnlyChipPreview(chip);
		}
	}
}
