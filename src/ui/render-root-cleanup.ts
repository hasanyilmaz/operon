import { cleanupTaskContextualHoverMenus } from './contextual-hover-menu';
import { closeFloatingPanelsForRoot } from './field-pickers/common';
import { closeIconOnlyChipPreviewsForRoot } from './icon-only-chip-preview';
import { cleanupOperonHoverTooltips } from './operon-hover-tooltip';

export function cleanupOperonRenderRoot(root: HTMLElement): void {
	closeFloatingPanelsForRoot(root);
	closeIconOnlyChipPreviewsForRoot(root);
	cleanupTaskContextualHoverMenus(root);
	cleanupOperonHoverTooltips(root);
}
