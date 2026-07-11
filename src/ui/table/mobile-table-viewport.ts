import { Platform } from 'obsidian';
import { getOwnerWindow } from '../../core/dom-compat';

const TABLE_PHONE_VIEWPORT_CLASS = 'operon-table-phone-viewport';
const TABLE_PHONE_VIEWPORT_HEIGHT_PROPERTY = '--operon-table-phone-viewport-height';

export function getMobileTableViewportHeight(
	rootTop: number,
	viewportTop: number,
	viewportHeight: number,
): number {
	return Math.max(0, Math.floor(viewportTop + viewportHeight - rootTop));
}

export function isMobileTableTextInputFocused(root: HTMLElement): boolean {
	if (!Platform.isPhone) return false;
	const activeElement = root.ownerDocument.activeElement;
	return activeElement instanceof HTMLInputElement
		&& root.contains(activeElement)
		&& activeElement.matches('.operon-table-search-input, .operon-table-description-input');
}

export function bindMobileTableViewport(root: HTMLElement, onGeometryChange: () => void): () => void {
	if (!Platform.isPhone) return () => {};
	const ownerWindow = getOwnerWindow(root);
	const visualViewport = ownerWindow.visualViewport;
	let frame: number | null = null;
	let destroyed = false;

	const sync = (): void => {
		frame = null;
		if (destroyed || !root.isConnected) return;
		const hasFocusedTextInput = isMobileTableTextInputFocused(root);
		root.classList.toggle(TABLE_PHONE_VIEWPORT_CLASS, hasFocusedTextInput);
		if (!hasFocusedTextInput) {
			root.style.removeProperty(TABLE_PHONE_VIEWPORT_HEIGHT_PROPERTY);
			onGeometryChange();
			return;
		}
		const viewportTop = visualViewport?.offsetTop ?? 0;
		const viewportHeight = visualViewport?.height ?? ownerWindow.innerHeight;
		if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return;
		const height = getMobileTableViewportHeight(root.getBoundingClientRect().top, viewportTop, viewportHeight);
		root.style.setProperty(TABLE_PHONE_VIEWPORT_HEIGHT_PROPERTY, `${Math.max(220, height)}px`);
		onGeometryChange();
	};

	const scheduleSync = (): void => {
		if (destroyed || frame !== null) return;
		frame = ownerWindow.requestAnimationFrame(sync);
	};

	ownerWindow.addEventListener('resize', scheduleSync);
	visualViewport?.addEventListener('resize', scheduleSync);
	visualViewport?.addEventListener('scroll', scheduleSync);
	root.addEventListener('focusin', scheduleSync);
	root.addEventListener('focusout', scheduleSync);
	scheduleSync();

	return () => {
		destroyed = true;
		if (frame !== null) {
			ownerWindow.cancelAnimationFrame(frame);
			frame = null;
		}
		ownerWindow.removeEventListener('resize', scheduleSync);
		visualViewport?.removeEventListener('resize', scheduleSync);
		visualViewport?.removeEventListener('scroll', scheduleSync);
		root.removeEventListener('focusin', scheduleSync);
		root.removeEventListener('focusout', scheduleSync);
		root.classList.remove(TABLE_PHONE_VIEWPORT_CLASS);
		root.style.removeProperty(TABLE_PHONE_VIEWPORT_HEIGHT_PROPERTY);
	};
}
