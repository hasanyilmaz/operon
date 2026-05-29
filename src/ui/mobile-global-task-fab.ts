import { App, Component, Platform, setIcon } from 'obsidian';
import { clearWindowTimeout, createOwnerElement, getOwnerBody, getOwnerDocument, getOwnerWindow, isHTMLElement, setWindowTimeout, type WindowTimeoutHandle } from '../core/dom-compat';
import { t } from '../core/i18n';
import { OperonSettings, type MobileGlobalTaskFabPosition } from '../types/settings';

const MOBILE_GLOBAL_TASK_FAB_EDGE_MARGIN_PX = 14;
const MOBILE_GLOBAL_TASK_FAB_DRAG_THRESHOLD_PX = 8;
const MOBILE_GLOBAL_TASK_FAB_CLICK_SUPPRESSION_MS = 500;

export interface MobileGlobalTaskFabCallbacks {
	openTaskCreator: () => void;
	shouldHideForActiveView: () => boolean;
	onPositionChange: (position: MobileGlobalTaskFabPosition) => void | Promise<void>;
}

export class MobileGlobalTaskFab extends Component {
	private buttonEl: HTMLButtonElement | null = null;
	private refreshTimer: WindowTimeoutHandle | null = null;
	private dragState: {
		pointerId: number;
		initialClientX: number;
		initialClientY: number;
		startLeft: number;
		startTop: number;
		dragging: boolean;
	} | null = null;
	private suppressClickUntil = 0;

	constructor(
		private app: App,
		private settings: OperonSettings,
		private callbacks: MobileGlobalTaskFabCallbacks,
	) {
		super();
	}

	onload(): void {
		if (!Platform.isPhone) return;

		const el = createOwnerElement(null, 'button');
		el.type = 'button';
		el.className = 'operon-mobile-global-task-fab is-hidden';
		setIcon(el, 'plus');
		this.buttonEl = el;
		this.refreshLabel();
		getOwnerBody(el).appendChild(el);

		const ownerDocument = getOwnerDocument(el);
		const ownerWindow = getOwnerWindow(el);
		const ownerBody = getOwnerBody(el);

		this.registerDomEvent(el, 'pointerdown', (event: PointerEvent) => this.handlePointerDown(event));
		this.registerDomEvent(el, 'pointermove', (event: PointerEvent) => this.handlePointerMove(event));
		this.registerDomEvent(el, 'pointerup', (event: PointerEvent) => this.finishPointerDrag(event, true));
		this.registerDomEvent(el, 'pointercancel', (event: PointerEvent) => this.finishPointerDrag(event, false));
		this.registerDomEvent(el, 'click', (event: MouseEvent) => {
			event.preventDefault();
			event.stopPropagation();
			if (Date.now() < this.suppressClickUntil) return;
			this.callbacks.openTaskCreator();
			this.scheduleRefresh();
		});
		this.registerDomEvent(ownerWindow, 'resize', () => this.scheduleRefresh());
		this.registerDomEvent(ownerDocument, 'focusin', () => this.scheduleRefresh());
		this.registerDomEvent(ownerDocument, 'focusout', () => this.scheduleRefresh());
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.scheduleRefresh()));
		this.registerEvent(this.app.workspace.on('layout-change', () => this.scheduleRefresh()));

		const visualViewport = ownerWindow.visualViewport;
		if (visualViewport) {
			const handleViewportChange = () => this.scheduleRefresh();
			visualViewport.addEventListener('resize', handleViewportChange);
			visualViewport.addEventListener('scroll', handleViewportChange);
			this.register(() => {
				visualViewport.removeEventListener('resize', handleViewportChange);
				visualViewport.removeEventListener('scroll', handleViewportChange);
			});
		}

		const modalObserver = new MutationObserver(() => this.scheduleRefresh());
		modalObserver.observe(ownerBody, { childList: true });
		this.register(() => modalObserver.disconnect());

		this.refresh();
	}

	onunload(): void {
		clearWindowTimeout(this.refreshTimer);
		this.refreshTimer = null;
		this.buttonEl?.remove();
		this.buttonEl = null;
	}

	refresh(): void {
		this.refreshLabel();
		const hidden = this.shouldHide();
		this.refreshVisibility(hidden);
		if (!hidden) this.applyStoredPosition();
	}

	private scheduleRefresh(): void {
		if (this.refreshTimer) return;
		this.refreshTimer = setWindowTimeout(() => {
			this.refreshTimer = null;
			this.refresh();
		}, 0);
	}

	private refreshLabel(): void {
		if (!this.buttonEl) return;
		const label = t('commands', 'openTaskCreator');
		this.buttonEl.setAttribute('aria-label', label);
		this.buttonEl.setAttribute('title', label);
	}

	private refreshVisibility(hidden: boolean): void {
		if (!this.buttonEl) return;
		this.buttonEl.classList.toggle('is-hidden', hidden);
		this.buttonEl.setAttribute('aria-hidden', hidden ? 'true' : 'false');
		this.buttonEl.tabIndex = hidden ? -1 : 0;
	}

	private handlePointerDown(event: PointerEvent): void {
		if (!this.buttonEl || event.button !== 0 || this.shouldHide()) return;
		const rect = this.buttonEl.getBoundingClientRect();
		this.dragState = {
			pointerId: event.pointerId,
			initialClientX: event.clientX,
			initialClientY: event.clientY,
			startLeft: rect.left,
			startTop: rect.top,
			dragging: false,
		};
		try {
			this.buttonEl.setPointerCapture?.(event.pointerId);
		} catch {
			// Pointer capture is best-effort in mobile WebViews.
		}
	}

	private handlePointerMove(event: PointerEvent): void {
		if (!this.buttonEl || !this.dragState || this.dragState.pointerId !== event.pointerId) return;
		const deltaX = event.clientX - this.dragState.initialClientX;
		const deltaY = event.clientY - this.dragState.initialClientY;
		if (!this.dragState.dragging) {
			const distance = Math.hypot(deltaX, deltaY);
			if (distance < MOBILE_GLOBAL_TASK_FAB_DRAG_THRESHOLD_PX) return;
			this.dragState.dragging = true;
			this.buttonEl.addClass('is-dragging');
		}
		event.preventDefault();
		event.stopPropagation();
		const bounds = this.resolvePositionBounds(this.buttonEl);
		this.applyFixedPosition(
			this.clamp(this.dragState.startLeft + deltaX, bounds.minLeft, bounds.maxLeft),
			this.clamp(this.dragState.startTop + deltaY, bounds.minTop, bounds.maxTop),
		);
	}

	private finishPointerDrag(event: PointerEvent, commit: boolean): void {
		if (!this.buttonEl || !this.dragState || this.dragState.pointerId !== event.pointerId) return;
		const wasDragging = this.dragState.dragging;
		this.dragState = null;
		this.buttonEl.removeClass('is-dragging');
		try {
			this.buttonEl.releasePointerCapture?.(event.pointerId);
		} catch {
			// Pointer capture is best-effort in mobile WebViews.
		}
		if (!wasDragging) return;
		event.preventDefault();
		event.stopPropagation();
		this.suppressClickUntil = Date.now() + MOBILE_GLOBAL_TASK_FAB_CLICK_SUPPRESSION_MS;
		if (commit) {
			this.persistCurrentPosition();
		} else {
			this.applyStoredPosition();
		}
	}

	private applyStoredPosition(): void {
		if (!this.buttonEl || this.dragState?.dragging) return;
		const position = this.settings.mobileGlobalTaskFabPosition;
		if (!position) {
			this.buttonEl.removeClass('is-positioned');
			this.buttonEl.style.removeProperty('--operon-mobile-global-task-fab-left');
			this.buttonEl.style.removeProperty('--operon-mobile-global-task-fab-top');
			return;
		}
		const bounds = this.resolvePositionBounds(this.buttonEl);
		const left = bounds.viewportLeft + (bounds.viewportWidth * position.xRatio) - (bounds.width / 2);
		const top = bounds.viewportTop + (bounds.viewportHeight * position.yRatio) - (bounds.height / 2);
		this.applyFixedPosition(
			this.clamp(left, bounds.minLeft, bounds.maxLeft),
			this.clamp(top, bounds.minTop, bounds.maxTop),
		);
	}

	private applyFixedPosition(left: number, top: number): void {
		if (!this.buttonEl) return;
		this.buttonEl.addClass('is-positioned');
		this.buttonEl.setCssProps({
			'--operon-mobile-global-task-fab-left': `${Math.round(left)}px`,
			'--operon-mobile-global-task-fab-top': `${Math.round(top)}px`,
		});
	}

	private persistCurrentPosition(): void {
		if (!this.buttonEl) return;
		const bounds = this.resolvePositionBounds(this.buttonEl);
		const rect = this.buttonEl.getBoundingClientRect();
		const position: MobileGlobalTaskFabPosition = {
			xRatio: this.clamp(((rect.left + (bounds.width / 2)) - bounds.viewportLeft) / bounds.viewportWidth, 0, 1),
			yRatio: this.clamp(((rect.top + (bounds.height / 2)) - bounds.viewportTop) / bounds.viewportHeight, 0, 1),
		};
		this.settings.mobileGlobalTaskFabPosition = position;
		void Promise.resolve(this.callbacks.onPositionChange(position)).catch(error => {
			console.error('Operon: mobile quick-create button position save failed', error);
		});
	}

	private resolvePositionBounds(el: HTMLElement): {
		width: number;
		height: number;
		viewportLeft: number;
		viewportTop: number;
		viewportWidth: number;
		viewportHeight: number;
		minLeft: number;
		maxLeft: number;
		minTop: number;
		maxTop: number;
	} {
		const ownerWindow = getOwnerWindow(el);
		const visualViewport = ownerWindow.visualViewport;
		const rect = el.getBoundingClientRect();
		const width = Math.max(1, rect.width || 56);
		const height = Math.max(1, rect.height || 56);
		const viewportLeft = Math.max(0, visualViewport?.offsetLeft ?? 0);
		const viewportTop = Math.max(0, visualViewport?.offsetTop ?? 0);
		const viewportWidth = Math.max(width, visualViewport?.width ?? ownerWindow.innerWidth);
		const viewportHeight = Math.max(height, visualViewport?.height ?? ownerWindow.innerHeight);
		const minLeft = viewportLeft + MOBILE_GLOBAL_TASK_FAB_EDGE_MARGIN_PX;
		const minTop = viewportTop + MOBILE_GLOBAL_TASK_FAB_EDGE_MARGIN_PX;
		const maxLeft = Math.max(minLeft, viewportLeft + viewportWidth - width - MOBILE_GLOBAL_TASK_FAB_EDGE_MARGIN_PX);
		const maxTop = Math.max(minTop, viewportTop + viewportHeight - height - MOBILE_GLOBAL_TASK_FAB_EDGE_MARGIN_PX);
		return {
			width,
			height,
			viewportLeft,
			viewportTop,
			viewportWidth,
			viewportHeight,
			minLeft,
			maxLeft,
			minTop,
			maxTop,
		};
	}

	private clamp(value: number, min: number, max: number): number {
		return Math.max(min, Math.min(max, value));
	}

	private shouldHide(): boolean {
		if (!Platform.isPhone) return true;
		if (this.settings.mobileGlobalTaskFabEnabled !== true) return true;
		if (this.callbacks.shouldHideForActiveView()) return true;
		if (this.hasOpenModal()) return true;
		return this.isKeyboardLikelyOpen();
	}

	private hasOpenModal(): boolean {
		if (!this.buttonEl) return false;
		const ownerDocument = getOwnerDocument(this.buttonEl);
		const ownerWindow = getOwnerWindow(this.buttonEl);
		for (const modalEl of Array.from(ownerDocument.querySelectorAll<HTMLElement>('.modal-container'))) {
			if (!modalEl.isConnected) continue;
			const style = ownerWindow.getComputedStyle(modalEl);
			if (style.display === 'none' || style.visibility === 'hidden') continue;
			return true;
		}
		return false;
	}

	private isKeyboardLikelyOpen(): boolean {
		if (!this.buttonEl) return false;
		const ownerDocument = getOwnerDocument(this.buttonEl);
		const activeEl = ownerDocument.activeElement;
		if (!isHTMLElement(activeEl, this.buttonEl) || !this.isEditableElement(activeEl)) return false;
		const ownerWindow = getOwnerWindow(this.buttonEl);
		const visualViewport = ownerWindow.visualViewport;
		if (!visualViewport) return true;
		const heightDelta = Math.max(0, ownerWindow.innerHeight - visualViewport.height);
		return heightDelta > 96 || visualViewport.offsetTop > 24;
	}

	private isEditableElement(el: HTMLElement): boolean {
		const tagName = el.tagName.toLowerCase();
		return tagName === 'input'
			|| tagName === 'textarea'
			|| tagName === 'select'
			|| el.isContentEditable
			|| el.closest('[contenteditable="true"], .cm-content') != null;
	}
}
