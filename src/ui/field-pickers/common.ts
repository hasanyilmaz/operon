import { App } from 'obsidian';
import {
	asHTMLElement,
	createOwnerElement,
	getActiveDocument,
	getActiveWindow,
	getOwnerBody,
	getOwnerDocument,
	getOwnerWindow,
} from '../../core/dom-compat';
import { getWindowApp } from '../../core/obsidian-app';

export interface FloatingPanel {
	panel: HTMLElement;
	close: () => void;
}

export type FloatingPanelCloseReason = 'outside' | 'escape' | 'window-blur' | 'window-resize';

interface FloatingPanelRecord {
	panel: HTMLElement;
	anchorEl: HTMLElement | null;
	close: () => void;
}

export interface FloatingHostOptions {
	floatingHost?: HTMLElement;
	floatingScrollHost?: HTMLElement | Window;
	constrainToFloatingHost?: boolean;
}

export interface FloatingPositionOptions extends FloatingHostOptions {
	gap?: number;
	margin?: number;
	matchWidth?: number;
}

export interface FloatingPanelOptions extends FloatingHostOptions {
	retainInputFocus?: boolean;
	focusInputSelector?: string;
	closeOnWindowResize?: boolean;
	repositionOnWindowResize?: boolean;
	repositionOnPanelResize?: boolean;
	repositionOnScroll?: boolean;
	shouldClose?: (reason: FloatingPanelCloseReason) => boolean;
}

interface FloatingHostContext {
	host: HTMLElement;
	constrainToHost: boolean;
	scrollHost: HTMLElement | Window;
}

const activeFloatingPanels = new Set<FloatingPanelRecord>();
export const MOBILE_PICKER_OPEN_EVENT = 'operon-mobile-picker-open';
export const MOBILE_PICKER_CLOSE_EVENT = 'operon-mobile-picker-close';
export const TASK_EDITOR_MOBILE_PICKER_OPEN_EVENT = 'operon-task-editor-mobile-picker-open';
export const TASK_EDITOR_MOBILE_PICKER_CLOSE_EVENT = 'operon-task-editor-mobile-picker-close';
const TASK_EDITOR_MOBILE_SURFACE_MIN_WIDTH = 180;
const TASK_EDITOR_MOBILE_DESCRIPTION_SELECTOR = '.operon-task-editor-mobile-description';
const TASK_EDITOR_MOBILE_CORE_TOOLBAR_SELECTOR = '.operon-task-editor-mobile-core-toolbar';
const TASK_CREATOR_MOBILE_SURFACE_MIN_WIDTH = 180;
const TASK_CREATOR_MOBILE_ROOT_SELECTOR = '.operon-task-creator';
const TASK_CREATOR_MOBILE_MODAL_SELECTOR = '.operon-task-creator-modal-mobile';
const TASK_CREATOR_MOBILE_TOOLBAR_SELECTOR = '.operon-task-creator-toolbar';
const TASK_CREATOR_MOBILE_ACTION_ROW_SELECTOR = '.operon-task-creator-action-row';

interface MobilePickerSurfaceContext {
	kind: 'task-editor' | 'task-creator';
	root: HTMLElement;
	panelHost: HTMLElement;
	surfaceClass: string;
	openEvents: string[];
	closeEvents: string[];
}

function isEditablePanelFocus(element: Element | null, panel: HTMLElement): boolean {
	const htmlElement = asHTMLElement(element, panel);
	if (!htmlElement || !panel.contains(htmlElement)) return false;
	return htmlElement.matches('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]');
}

function getTaskEditorMobileRoot(anchorEl: HTMLElement | null): HTMLElement | null {
	return asHTMLElement(anchorEl?.closest('.operon-task-editor-mobile') ?? null, anchorEl);
}

function shouldUseTaskEditorMobileSurface(anchorEl: HTMLElement | null, options: FloatingHostOptions = {}): boolean {
	return !options.floatingHost && getTaskEditorMobileRoot(anchorEl) != null;
}

function getTaskEditorMobilePanelHost(root: HTMLElement | null, fallback: HTMLElement): HTMLElement {
	return asHTMLElement(root?.closest('.operon-task-editor-modal, .modal') ?? null, root) ?? fallback;
}

function getTaskCreatorMobileRoot(anchorEl: HTMLElement | null): HTMLElement | null {
	const root = asHTMLElement(anchorEl?.closest(TASK_CREATOR_MOBILE_ROOT_SELECTOR) ?? null, anchorEl);
	if (!root) return null;
	return root.closest(TASK_CREATOR_MOBILE_MODAL_SELECTOR) ? root : null;
}

function getTaskCreatorMobilePanelHost(root: HTMLElement | null, fallback: HTMLElement): HTMLElement {
	return asHTMLElement(root?.closest('.operon-task-creator-modal, .modal') ?? null, root) ?? fallback;
}

function getMobilePickerSurfaceContext(
	anchorEl: HTMLElement | null,
	options: FloatingHostOptions,
	fallbackHost: HTMLElement,
): MobilePickerSurfaceContext | null {
	if (shouldUseTaskEditorMobileSurface(anchorEl, options)) {
		const root = getTaskEditorMobileRoot(anchorEl);
		if (!root) return null;
		return {
			kind: 'task-editor',
			root,
			panelHost: getTaskEditorMobilePanelHost(root, fallbackHost),
			surfaceClass: 'operon-task-editor-mobile-picker-surface',
			openEvents: [MOBILE_PICKER_OPEN_EVENT, TASK_EDITOR_MOBILE_PICKER_OPEN_EVENT],
			closeEvents: [MOBILE_PICKER_CLOSE_EVENT, TASK_EDITOR_MOBILE_PICKER_CLOSE_EVENT],
		};
	}

	if (!options.floatingHost) {
		const root = getTaskCreatorMobileRoot(anchorEl);
		if (root) {
			return {
				kind: 'task-creator',
				root,
				panelHost: getTaskCreatorMobilePanelHost(root, fallbackHost),
				surfaceClass: 'operon-task-creator-mobile-picker-surface',
				openEvents: [MOBILE_PICKER_OPEN_EVENT],
				closeEvents: [MOBILE_PICKER_CLOSE_EVENT],
			};
		}
	}

	return null;
}

function dispatchMobilePickerEvent(context: MobilePickerSurfaceContext | null, eventNames: string[]): void {
	if (!context) return;
	for (const eventName of eventNames) {
		context.root.dispatchEvent(new CustomEvent(eventName, { bubbles: true }));
	}
}

export function resolvePickerApp(anchor: HTMLElement | DOMRect, app?: App): App | undefined {
	if (app) return app;
	const anchorEl = asHTMLElement(anchor);
	return getWindowApp(anchorEl ? getOwnerWindow(anchorEl) : getActiveWindow());
}

function resolveRect(anchor: HTMLElement | DOMRect): DOMRect {
	const anchorEl = asHTMLElement(anchor);
	if (anchorEl) return anchorEl.getBoundingClientRect();
	return anchor as DOMRect;
}

function resolveHostContext(anchor: HTMLElement | DOMRect, options: FloatingHostOptions = {}): FloatingHostContext {
	if (options.floatingHost) {
		return {
			host: options.floatingHost,
			constrainToHost: options.constrainToFloatingHost ?? false,
			scrollHost: options.floatingScrollHost ?? getOwnerWindow(options.floatingHost),
		};
	}

	const anchorEl = asHTMLElement(anchor);
	if (!anchorEl) {
		return { host: getActiveDocument().body, constrainToHost: false, scrollHost: getActiveWindow() };
	}
	const ownerWindow = getOwnerWindow(anchorEl);

	const taskEditorHost = asHTMLElement(anchorEl.closest(
		'.operon-task-editor-shell',
	), anchorEl);
	if (taskEditorHost) {
		return {
			host: taskEditorHost,
			constrainToHost: true,
			scrollHost: asHTMLElement(anchorEl.closest('.operon-task-editor-main-panel'), anchorEl) ?? ownerWindow,
		};
	}

	const taskCreatorHost = asHTMLElement(anchorEl.closest('.operon-task-creator-modal-container'), anchorEl);
	if (taskCreatorHost) {
		return {
			host: taskCreatorHost,
			constrainToHost: true,
			scrollHost: asHTMLElement(anchorEl.closest('.modal-content'), anchorEl) ?? ownerWindow,
		};
	}

	const obsidianModalHost = asHTMLElement(anchorEl.closest('.modal'), anchorEl);
	if (obsidianModalHost) {
		return {
			host: obsidianModalHost,
			constrainToHost: false,
			scrollHost: asHTMLElement(anchorEl.closest('.vertical-tab-content, .modal-content'), anchorEl) ?? ownerWindow,
		};
	}

	return { host: getOwnerBody(anchorEl), constrainToHost: false, scrollHost: ownerWindow };
}

export function positionFloatingElement(
	panel: HTMLElement,
	anchor: HTMLElement | DOMRect,
	options: FloatingPositionOptions = {},
): void {
	const anchorEl = asHTMLElement(anchor);
	const rect = resolveRect(anchor);
	const { host, constrainToHost } = resolveHostContext(anchor, options);
	const hostWindow = getOwnerWindow(host);
	const hostIsBody = host === getOwnerBody(host);
	const margin = options.margin ?? 8;
	const gap = options.gap ?? 6;
	const useHostBounds = constrainToHost && !hostIsBody;
	const mobileSurfaceContext = getMobilePickerSurfaceContext(anchorEl, options, host);
	if (useHostBounds && mobileSurfaceContext) {
		if (mobileSurfaceContext.kind === 'task-editor') {
			positionTaskEditorMobileSurface(panel, host, hostWindow, margin);
		} else {
			positionTaskCreatorMobileSurface(panel, mobileSurfaceContext.root, hostWindow, margin);
		}
		return;
	}
	const DOMRectCtor = (hostWindow as Window & { DOMRect?: typeof DOMRect }).DOMRect ?? DOMRect;
	const hostRect = useHostBounds
		? host.getBoundingClientRect()
		: new DOMRectCtor(0, 0, hostWindow.innerWidth, hostWindow.innerHeight);
	const hostScrollLeft = useHostBounds ? host.scrollLeft : 0;
	const hostScrollTop = useHostBounds ? host.scrollTop : 0;
	const anchorLeft = useHostBounds ? rect.left - hostRect.left + hostScrollLeft : rect.left;
	const anchorTop = useHostBounds ? rect.top - hostRect.top + hostScrollTop : rect.top;
	const anchorBottom = useHostBounds ? rect.bottom - hostRect.top + hostScrollTop : rect.bottom;
	const availableWidth = useHostBounds ? host.clientWidth : hostWindow.innerWidth;
	const availableHeight = useHostBounds ? host.clientHeight : hostWindow.innerHeight;
	if (typeof options.matchWidth === 'number' && options.matchWidth > 0) {
		panel.style.width = `${Math.round(options.matchWidth)}px`;
	}
	const panelWidth = panel.offsetWidth;
	const panelHeight = panel.offsetHeight;

	const maxHeight = Math.max(160, availableHeight - margin * 2);
	panel.style.maxHeight = `${maxHeight}px`;
	panel.style.overflowY = panelHeight > maxHeight ? 'auto' : '';

	const effectiveHeight = Math.min(panel.offsetHeight, maxHeight);
	const spaceBelow = availableHeight - anchorBottom - margin;
	const spaceAbove = anchorTop - margin;

	let top = anchorBottom + gap;
	if (effectiveHeight > spaceBelow && spaceAbove > spaceBelow) {
		top = anchorTop - effectiveHeight - gap;
	}
	top = Math.max(margin, Math.min(top, availableHeight - effectiveHeight - margin));

	let left = anchorLeft;
	if (left + panelWidth > availableWidth - margin) {
		left = availableWidth - panelWidth - margin;
	}
	left = Math.max(margin, left);

	if (useHostBounds) {
		const minLeft = hostScrollLeft + margin;
		const maxLeft = hostScrollLeft + availableWidth - panelWidth - margin;
		const minTop = hostScrollTop + margin;
		const maxTop = hostScrollTop + availableHeight - effectiveHeight - margin;
		left = Math.max(minLeft, Math.min(left, maxLeft));
		top = Math.max(minTop, Math.min(top, maxTop));
	}

	panel.style.top = `${Math.round(top)}px`;
	panel.style.left = `${Math.round(left)}px`;
}

function positionTaskEditorMobileSurface(
	panel: HTMLElement,
	host: HTMLElement,
	hostWindow: Window,
	margin: number,
): void {
	const hostRect = host.getBoundingClientRect();
	const visibleLeft = Math.max(hostRect.left, 0);
	const visibleRight = Math.min(hostRect.right, hostWindow.innerWidth);
	const visibleTop = Math.max(hostRect.top, 0);
	const visibleBottom = hostWindow.innerHeight;
	const surfaceTop = resolveTaskEditorMobileSurfaceTop(host, visibleTop, visibleBottom);
	const availableWidth = Math.max(
		TASK_EDITOR_MOBILE_SURFACE_MIN_WIDTH,
		visibleRight - visibleLeft - margin * 2,
	);
	const availableHeight = Math.max(1, visibleBottom - surfaceTop - margin * 2);
	const left = visibleLeft + margin;
	const top = surfaceTop + margin;

	panel.style.width = `${Math.round(availableWidth)}px`;
	panel.style.maxWidth = `${Math.round(availableWidth)}px`;
	panel.style.maxHeight = `${Math.round(availableHeight)}px`;
	panel.style.left = `${Math.round(left)}px`;
	panel.style.top = `${Math.round(top)}px`;
}

function resolveTaskEditorMobileSurfaceTop(
	host: HTMLElement,
	visibleTop: number,
	visibleBottom: number,
): number {
	const coreToolbar = asHTMLElement(host.querySelector(TASK_EDITOR_MOBILE_CORE_TOOLBAR_SELECTOR), host);
	if (coreToolbar) {
		const toolbarRect = coreToolbar.getBoundingClientRect();
		if (toolbarRect.bottom > visibleTop && toolbarRect.top < visibleBottom) {
			return Math.max(visibleTop, toolbarRect.bottom);
		}
	}

	const description = asHTMLElement(host.querySelector(TASK_EDITOR_MOBILE_DESCRIPTION_SELECTOR), host);
	if (!description) return visibleTop;
	const descriptionRect = description.getBoundingClientRect();
	if (descriptionRect.bottom <= visibleTop || descriptionRect.top >= visibleBottom) return visibleTop;
	return Math.max(visibleTop, descriptionRect.bottom);
}

function positionTaskCreatorMobileSurface(
	panel: HTMLElement,
	root: HTMLElement,
	hostWindow: Window,
	margin: number,
): void {
	const modal = asHTMLElement(root.closest(TASK_CREATOR_MOBILE_MODAL_SELECTOR), root) ?? root;
	const modalRect = modal.getBoundingClientRect();
	const visibleLeft = Math.max(modalRect.left, 0);
	const visibleRight = Math.min(modalRect.right, hostWindow.innerWidth);
	const visibleTop = Math.max(modalRect.top, 0);
	const visibleBottom = Math.min(modalRect.bottom, hostWindow.innerHeight);
	const surfaceTop = resolveTaskCreatorMobileSurfaceTop(root, visibleTop, visibleBottom);
	const availableWidth = Math.max(
		TASK_CREATOR_MOBILE_SURFACE_MIN_WIDTH,
		visibleRight - visibleLeft - margin * 2,
	);
	const availableHeight = Math.max(1, visibleBottom - surfaceTop - margin * 2);
	const left = visibleLeft + margin;
	const top = surfaceTop + margin;

	panel.style.width = `${Math.round(availableWidth)}px`;
	panel.style.maxWidth = `${Math.round(availableWidth)}px`;
	panel.style.maxHeight = `${Math.round(availableHeight)}px`;
	panel.style.left = `${Math.round(left)}px`;
	panel.style.top = `${Math.round(top)}px`;
}

function resolveTaskCreatorMobileSurfaceTop(
	root: HTMLElement,
	visibleTop: number,
	visibleBottom: number,
): number {
	const actionRow = asHTMLElement(root.querySelector(TASK_CREATOR_MOBILE_ACTION_ROW_SELECTOR), root);
	if (actionRow) {
		const actionRect = actionRow.getBoundingClientRect();
		if (actionRect.bottom > visibleTop && actionRect.top < visibleBottom) {
			return Math.max(visibleTop, actionRect.bottom);
		}
	}

	const toolbar = asHTMLElement(root.querySelector(TASK_CREATOR_MOBILE_TOOLBAR_SELECTOR), root);
	if (!toolbar) return visibleTop;
	const toolbarRect = toolbar.getBoundingClientRect();
	if (toolbarRect.bottom <= visibleTop || toolbarRect.top >= visibleBottom) return visibleTop;
	return Math.max(visibleTop, toolbarRect.bottom);
}

export function createFloatingPanel(
	anchor: HTMLElement | DOMRect,
	className: string,
	onClose?: () => void,
	options: FloatingPanelOptions = {},
): FloatingPanel {
	const anchorEl = asHTMLElement(anchor);
	const { host, constrainToHost, scrollHost } = resolveHostContext(anchor, options);
	const mobileSurfaceContext = getMobilePickerSurfaceContext(anchorEl, options, host);
	const panelHost = mobileSurfaceContext?.panelHost ?? host;
	const panel = createOwnerElement(anchorEl ?? host, 'div');
	panel.className = className;
	if (mobileSurfaceContext) {
		panel.classList.add('operon-mobile-picker-surface', mobileSurfaceContext.surfaceClass);
	}
	const positionOptions: FloatingPositionOptions = {
		floatingHost: options.floatingHost,
		floatingScrollHost: options.floatingScrollHost,
		constrainToFloatingHost: options.constrainToFloatingHost,
	};
	const hostDocument = getOwnerDocument(host);
	const hostWindow = getOwnerWindow(host);
	const visualViewport = mobileSurfaceContext ? hostWindow.visualViewport : null;
	panel.style.position = mobileSurfaceContext || !constrainToHost ? 'fixed' : 'absolute';
	if (mobileSurfaceContext) {
		panel.addClass('is-opening');
		positionFloatingElement(panel, anchor, positionOptions);
	}
	let rafId = 0;
	let focusRetentionTimer = 0;
	let retainedFocusInput: HTMLElement | null = null;
	let closed = false;
	const record: FloatingPanelRecord = {
		panel,
		anchorEl,
		close: () => undefined,
	};
	const isAnchorConnected = (): boolean => !anchorEl || anchorEl.isConnected;
	const schedulePosition = () => {
		if (rafId) return;
		rafId = hostWindow.requestAnimationFrame(() => {
			rafId = 0;
			if (!panel.isConnected) return;
			if (!isAnchorConnected()) {
				cleanup();
				return;
			}
			positionFloatingElement(panel, anchor, positionOptions);
		});
	};
	const sizeObserver = new ResizeObserver(() => schedulePosition());
	const getRetainedFocusInput = (): HTMLElement | null => {
		if (retainedFocusInput?.isConnected && panel.contains(retainedFocusInput)) {
			return retainedFocusInput;
		}
		return panel.querySelector<HTMLElement>(options.focusInputSelector ?? '.operon-floating-input');
	};
	const retainInputFocus = () => {
		if (closed || !panel.isConnected) return;
		const input = getRetainedFocusInput();
		if (input?.isConnected) {
			const activeElement = hostDocument.activeElement;
			if (activeElement !== input && !isEditablePanelFocus(activeElement, panel)) {
				input.focus({ preventScroll: true });
			}
		}
		focusRetentionTimer = hostWindow.setTimeout(retainInputFocus, 120);
	};
	const onPanelFocusIn = (event: FocusEvent) => {
		const target = asHTMLElement(event.target, panel);
		if (!target || !isEditablePanelFocus(target, panel)) return;
		retainedFocusInput = target;
	};
	let onHostWindowResize: () => void = () => undefined;
	let onHostWindowBlur: () => void = () => undefined;

	const cleanup = () => {
		if (closed) return;
		closed = true;
		if (rafId) {
			hostWindow.cancelAnimationFrame(rafId);
			rafId = 0;
		}
		if (focusRetentionTimer) {
			hostWindow.clearTimeout(focusRetentionTimer);
			focusRetentionTimer = 0;
		}
		sizeObserver.disconnect();
		panel.remove();
		activeFloatingPanels.delete(record);
		panel.removeEventListener('focusin', onPanelFocusIn);
		hostDocument.removeEventListener('mousedown', onOutside, true);
		hostDocument.removeEventListener('keydown', onKeyDown, true);
		scrollHost.removeEventListener('scroll', schedulePosition, true);
		hostWindow.removeEventListener('resize', onHostWindowResize);
		visualViewport?.removeEventListener('resize', schedulePosition);
		visualViewport?.removeEventListener('scroll', schedulePosition);
		hostWindow.removeEventListener('blur', onHostWindowBlur);
		onClose?.();
		dispatchMobilePickerEvent(mobileSurfaceContext, mobileSurfaceContext?.closeEvents ?? []);
	};
	record.close = cleanup;

	const requestClose = (reason: FloatingPanelCloseReason): void => {
		if (options.shouldClose?.(reason) === false) return;
		cleanup();
	};

	const onOutside = (event: MouseEvent) => {
		if (!panel.contains(event.target as Node)) {
			requestClose('outside');
		}
	};

	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key === 'Escape') requestClose('escape');
	};

	onHostWindowResize = () => {
		if (mobileSurfaceContext || options.closeOnWindowResize === false) {
			if (options.repositionOnWindowResize !== false) {
				schedulePosition();
			}
			return;
		}
		requestClose('window-resize');
	};
	onHostWindowBlur = () => requestClose('window-blur');

	dispatchMobilePickerEvent(mobileSurfaceContext, mobileSurfaceContext?.openEvents ?? []);
	panelHost.appendChild(panel);
	activeFloatingPanels.add(record);
	if (options.retainInputFocus) {
		panel.addEventListener('focusin', onPanelFocusIn);
		focusRetentionTimer = hostWindow.setTimeout(retainInputFocus, 0);
	}

	hostWindow.requestAnimationFrame(() => {
		if (!panel.isConnected) return;
		if (!isAnchorConnected()) {
			cleanup();
			return;
		}
		positionFloatingElement(panel, anchor, positionOptions);
		if (mobileSurfaceContext) {
			panel.removeClass('is-opening');
		}
		if (options.repositionOnPanelResize !== false) {
			sizeObserver.observe(panel);
		}
		hostDocument.addEventListener('mousedown', onOutside, true);
		hostDocument.addEventListener('keydown', onKeyDown, true);
		if (options.repositionOnScroll !== false) {
			scrollHost.addEventListener('scroll', schedulePosition, true);
		}
		hostWindow.addEventListener('resize', onHostWindowResize);
		if (options.repositionOnWindowResize !== false) {
			visualViewport?.addEventListener('resize', schedulePosition);
		}
		if (options.repositionOnScroll !== false) {
			visualViewport?.addEventListener('scroll', schedulePosition);
		}
		hostWindow.addEventListener('blur', onHostWindowBlur);
	});
	return { panel, close: cleanup };
}

export function focusFloatingInput(input: HTMLElement): void {
	input.focus({ preventScroll: true });
}

export function requestFloatingInputFocus(input: HTMLElement): void {
	const ownerWindow = getOwnerWindow(input);
	ownerWindow.requestAnimationFrame(() => {
		if (!input.isConnected) return;
		focusFloatingInput(input);
	});
}

export function scrollChildIntoView(container: HTMLElement, child: HTMLElement | null | undefined, margin = 4): void {
	if (!child?.isConnected || !container.contains(child)) return;

	const containerRect = container.getBoundingClientRect();
	const childRect = child.getBoundingClientRect();
	const topOverflow = childRect.top - containerRect.top - margin;
	const bottomOverflow = childRect.bottom - containerRect.bottom + margin;

	if (topOverflow < 0) {
		container.scrollTop += topOverflow;
	} else if (bottomOverflow > 0) {
		container.scrollTop += bottomOverflow;
	}
}

export function closeFloatingPanelsForRoot(root: ParentNode): void {
	const rootNode = root as Node;
	for (const record of Array.from(activeFloatingPanels)) {
		if (
			rootNode.contains(record.panel)
			|| (record.anchorEl && rootNode.contains(record.anchorEl))
			|| (record.anchorEl && !record.anchorEl.isConnected)
		) {
			record.close();
		}
	}
}

export function createButton(label: string, className: string, owner?: Node | null): HTMLButtonElement {
	const button = createOwnerElement(owner, 'button');
	button.type = 'button';
	button.className = className;
	button.textContent = label;
	return button;
}

export function createChip(label: string, className: string, owner?: Node | null): HTMLElement {
	const chip = createOwnerElement(owner, 'span');
	chip.className = className;
	chip.textContent = label;
	return chip;
}
