import { getActiveWindow } from '../core/dom-compat';

/** Established Task Editor source-width threshold, shared by both editor hosts. */
export function isWideEditorSourceViewport(root: HTMLElement | null): boolean {
	const modal = root?.closest<HTMLElement>('.operon-task-editor-modal');
	const container = modal?.parentElement;
	if (!modal || !container || !root) return false;
	const owner = modal.ownerDocument.defaultView ?? getActiveWindow();
	const modalStyle = owner.getComputedStyle(modal);
	const containerStyle = owner.getComputedStyle(container);
	const rootStyle = owner.getComputedStyle(root);
	const px = (value: string): number => Number.parseFloat(value) || 0;
	const mainWidth = px(modalStyle.getPropertyValue('--operon-task-editor-main-column-width'));
	const bodyMin = px(modalStyle.getPropertyValue('--operon-task-editor-file-column-min-width'));
	const gap = px(modalStyle.getPropertyValue('--operon-task-editor-split-gap'));
	const padding = px(rootStyle.paddingLeft) + px(rootStyle.paddingRight)
		+ px(modalStyle.paddingLeft) + px(modalStyle.paddingRight);
	const borders = px(modalStyle.borderLeftWidth) + px(modalStyle.borderRightWidth);
	const available = container.clientWidth - px(containerStyle.paddingLeft) - px(containerStyle.paddingRight);
	const maxValue = modalStyle.maxWidth;
	// Preserve the established compact editor width threshold under theme constraints.
	if (maxValue !== 'none' && !maxValue.endsWith('px') && !maxValue.endsWith('%')) return false;
	const maxWidth = maxValue.endsWith('px') ? px(maxValue)
		: maxValue.endsWith('%') ? available * px(maxValue) / 100 : Infinity;
	const preferredWidth = mainWidth + gap
		+ px(modalStyle.getPropertyValue('--operon-task-editor-file-column-width'))
		+ px(modalStyle.getPropertyValue('--operon-task-editor-horizontal-padding'));
	// Use the original capacity threshold without depending on the rendered editor width.
	const expandedWidth = Math.min(owner.innerWidth * 0.94, available, maxWidth, preferredWidth);
	return mainWidth > 0 && bodyMin > 0 && expandedWidth - padding - borders - mainWidth - gap >= bodyMin;
}
