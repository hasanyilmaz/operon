import { Platform, setIcon } from 'obsidian';
import { localNow } from '../core/local-time';
import {
	resolveContextualMenu,
	type ContextualMenuActionHandler,
	type ContextualMenuContext,
	type ContextualMenuSurface,
	type ContextualTaskActionSource,
	type ResolvedContextualMenuAction,
} from '../core/contextual-menu-engine';
import type { OperonSettings } from '../types/settings';
import {
	WindowTimeoutHandle,
	clearWindowTimeout,
	getOwnerBody,
	getOwnerDocument,
	getOwnerWindow,
	setWindowTimeout,
} from '../core/dom-compat';
import { normalizeTaskFieldColor } from '../core/task-color-source';
import { resolveContextualHoverMenuPosition } from './contextual-hover-menu-position';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';

const CONTEXTUAL_MENU_MOBILE_MOVE_TOLERANCE_PX = 12;
const CONTEXTUAL_MENU_MOBILE_SELECTION_GUARD_CLASS = 'operon-contextual-menu-mobile-active';

type ContextualHoverMenuSettings = Pick<
	OperonSettings,
	| 'contextualMenuActionAllowlist'
	| 'contextualMenuSurfaceActionMatrix'
	| 'contextualMenuOpenDelayMs'
	| 'contextualMenuMobileEnabled'
	| 'contextualMenuMobileLongPressMs'
	| 'contextualMenuMobileTransitionGraceMs'
	| 'contextualMenuMobileAutoHideMs'
>;

interface ContextualHoverMenuBindOptions {
	surface: ContextualMenuSurface;
	taskId: string;
	getTask: () => ContextualTaskActionSource | null;
	getSettings: () => ContextualHoverMenuSettings;
	onAction: ContextualMenuActionHandler;
	isPinned?: () => boolean;
	hasSubtasks?: () => boolean;
	resolveAnchorRect?: () => DOMRect;
}

interface ContextualHoverMenuControllerOptions {
	getDelayMs: () => number;
	getHost?: () => HTMLElement | null;
	getNow?: () => number;
	positionMenu: (anchorRect: DOMRect, menu: HTMLElement) => boolean;
	menuClassName?: string;
	menuPosition?: 'fixed';
}

interface ContextualHoverMenuShowOptions {
	key: string;
	taskId: string;
	actions: ResolvedContextualMenuAction[];
	anchorRect: DOMRect;
	host?: HTMLElement | null;
	context?: ContextualMenuContext;
	onAction: ContextualMenuActionHandler;
	mobileInteraction?: {
		transitionGraceMs: number;
		autoHideMs: number;
		guardTargets?: HTMLElement[];
	};
}

type ContextualHoverMenuTrigger = HTMLElement & {
	_operonContextualHoverCleanup?: () => void;
};

export class ContextualHoverMenuController {
	private readonly options: ContextualHoverMenuControllerOptions;
	private activeMenuEl: HTMLElement | null = null;
	private activeKey: string | null = null;
	private activeMenuHideTimer: WindowTimeoutHandle | null = null;
	private activeMenuAutoHideTimer: WindowTimeoutHandle | null = null;
	private activeMenuShowTimer: WindowTimeoutHandle | null = null;
	private activeMenuDocument: Document | null = null;
	private activeMenuWindow: Window | null = null;
	private activeMenuKeydownHandler: ((event: KeyboardEvent) => void) | null = null;
	private activeMenuScrollHandler: ((event: Event) => void) | null = null;
	private activeMenuResizeHandler: (() => void) | null = null;
	private activeMenuOutsidePointerHandler: ((event: Event) => void) | null = null;
	private activeMenuOutsideTouchHandler: ((event: Event) => void) | null = null;
	private activeMenuOutsideEventRoot: HTMLElement | null = null;
	private activeMenuGuardTargets: HTMLElement[] = [];
	private activeMenuTransitionGraceUntil = 0;
	private activeMenuUsesPointerLeaveHide = true;
	private activeMenuSelectionGuardElements: HTMLElement[] = [];

	constructor(options: ContextualHoverMenuControllerOptions) {
		this.options = options;
	}

	private getNow(): number {
		return this.options.getNow?.() ?? Date.now();
	}

	isActive(key: string): boolean {
		return this.activeKey === key && !!this.activeMenuEl;
	}

	contains(target: EventTarget | null): boolean {
		const menu = this.activeMenuEl;
		if (!menu || typeof target !== 'object' || target === null) return false;
		const ownerWindow = getOwnerWindow(menu) as Window & { Node?: typeof Node };
		const NodeCtor = ownerWindow.Node;
		if (!NodeCtor || !Object.prototype.isPrototypeOf.call(NodeCtor.prototype, target)) return false;
		return menu.contains(target as Node);
	}

	clearShowTimer(): void {
		if (this.activeMenuShowTimer === null) return;
		clearWindowTimeout(this.activeMenuShowTimer);
		this.activeMenuShowTimer = null;
	}

	clearHideTimer(): void {
		if (this.activeMenuHideTimer === null) return;
		clearWindowTimeout(this.activeMenuHideTimer);
		this.activeMenuHideTimer = null;
	}

	private clearAutoHideTimer(): void {
		if (this.activeMenuAutoHideTimer === null) return;
		clearWindowTimeout(this.activeMenuAutoHideTimer);
		this.activeMenuAutoHideTimer = null;
	}

	scheduleShow(callback: () => void): void {
		this.clearShowTimer();
		const delay = Math.max(0, this.options.getDelayMs());
		this.activeMenuShowTimer = setWindowTimeout(() => {
			this.activeMenuShowTimer = null;
			callback();
		}, delay);
	}

	scheduleHide(): void {
		if (!this.activeMenuEl) return;
		this.clearHideTimer();
		const delay = Math.max(0, this.options.getDelayMs());
		this.activeMenuHideTimer = setWindowTimeout(() => {
			this.activeMenuHideTimer = null;
			this.hide(true);
		}, delay);
	}

	hide(immediate = true): void {
		if (!immediate) {
			this.scheduleHide();
			return;
		}
		this.clearShowTimer();
		this.clearHideTimer();
		this.clearAutoHideTimer();
		this.activeMenuEl?.remove();
		this.activeMenuEl = null;
		this.activeKey = null;
		if (this.activeMenuKeydownHandler) {
			this.activeMenuDocument?.removeEventListener('keydown', this.activeMenuKeydownHandler, true);
			this.activeMenuKeydownHandler = null;
		}
		if (this.activeMenuScrollHandler) {
			this.activeMenuDocument?.removeEventListener('scroll', this.activeMenuScrollHandler, true);
			this.activeMenuScrollHandler = null;
		}
		if (this.activeMenuResizeHandler) {
			this.activeMenuWindow?.removeEventListener('resize', this.activeMenuResizeHandler, true);
			this.activeMenuResizeHandler = null;
		}
		if (this.activeMenuOutsidePointerHandler) {
			this.activeMenuOutsideEventRoot?.removeEventListener('pointerdown', this.activeMenuOutsidePointerHandler, true);
			this.activeMenuOutsidePointerHandler = null;
		}
		if (this.activeMenuOutsideTouchHandler) {
			this.activeMenuOutsideEventRoot?.removeEventListener('touchstart', this.activeMenuOutsideTouchHandler, true);
			this.activeMenuOutsideTouchHandler = null;
		}
		this.activeMenuOutsideEventRoot = null;
		for (const element of this.activeMenuSelectionGuardElements) {
			element.classList.remove(CONTEXTUAL_MENU_MOBILE_SELECTION_GUARD_CLASS);
		}
		this.activeMenuSelectionGuardElements = [];
		this.activeMenuGuardTargets = [];
		this.activeMenuTransitionGraceUntil = 0;
		this.activeMenuUsesPointerLeaveHide = true;
		this.activeMenuDocument = null;
		this.activeMenuWindow = null;
	}

	show(options: ContextualHoverMenuShowOptions): boolean {
		if (options.actions.length === 0) {
			if (this.activeKey === options.key) this.hide(true);
			return false;
		}

		this.clearHideTimer();
		this.clearAutoHideTimer();
		if (this.isActive(options.key) && this.activeMenuEl) {
			applyContextualMenuAccent(this.activeMenuEl, options.context);
			if (!this.options.positionMenu(options.anchorRect, this.activeMenuEl)) {
				this.hide(true);
				return false;
			}
			if (options.mobileInteraction) {
				const autoHideMs = Math.round(options.mobileInteraction.autoHideMs);
				if (autoHideMs > 0) {
					this.activeMenuAutoHideTimer = setWindowTimeout(() => {
						this.activeMenuAutoHideTimer = null;
						this.hide(true);
					}, autoHideMs);
				}
			}
			return true;
		}

		this.hide(true);
		const host = options.host ?? this.options.getHost?.() ?? null;
		if (!host) return false;
		const hostDocument = getOwnerDocument(host);

		const menu = hostDocument.createElement('div');
		menu.className = this.options.menuClassName ?? 'operon-calendar-hover-menu';
		menu.tabIndex = -1;
		applyContextualMenuAccent(menu, options.context);
		const usesPointerLeaveHide = !options.mobileInteraction;
		if (this.options.menuPosition) {
			menu.style.position = this.options.menuPosition;
		}
		menu.addEventListener('pointerenter', () => {
			if (!usesPointerLeaveHide) return;
			this.clearHideTimer();
		});
		menu.addEventListener('pointerleave', () => {
			if (!usesPointerLeaveHide) return;
			this.scheduleHide();
		});
		menu.addEventListener('pointerdown', event => {
			event.preventDefault();
			event.stopPropagation();
		});

		for (const action of options.actions) {
			const button = hostDocument.createElement('button');
			button.className = 'operon-calendar-hover-menu-item';
			button.type = 'button';
			button.setAttribute('data-action-id', action.id);

			const iconWrap = hostDocument.createElement('span');
			iconWrap.className = 'operon-calendar-hover-menu-icon';
			setIcon(iconWrap, action.icon);
			button.appendChild(iconWrap);

			const label = hostDocument.createElement('span');
			label.className = 'operon-calendar-hover-menu-label';
			label.textContent = action.label;
			button.appendChild(label);
			setAccessibleLabelWithoutTooltip(button, action.label);

			button.addEventListener('click', event => {
				event.preventDefault();
				event.stopPropagation();
				const invocation = {
					actionAnchor: button,
					actionAnchorRect: button.getBoundingClientRect(),
				};
				this.hide(true);
				void options.onAction(options.taskId, action.id, options.context, invocation);
			});

			menu.appendChild(button);
		}

		host.appendChild(menu);
		this.activeMenuEl = menu;
		this.activeKey = options.key;
		this.activeMenuDocument = hostDocument;
		this.activeMenuWindow = getOwnerWindow(menu);
		this.activeMenuKeydownHandler = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return;
			this.hide(true);
		};
		this.activeMenuScrollHandler = (event: Event) => {
			if (this.contains(event.target)) return;
			this.hide(true);
		};
		this.activeMenuResizeHandler = () => {
			this.hide(true);
		};
		this.activeMenuUsesPointerLeaveHide = usesPointerLeaveHide;
		this.activeMenuGuardTargets = options.mobileInteraction?.guardTargets ?? [];
		this.activeMenuTransitionGraceUntil = options.mobileInteraction
			? this.getNow() + Math.max(0, options.mobileInteraction.transitionGraceMs)
			: 0;
		if (options.mobileInteraction) {
			this.activeMenuSelectionGuardElements = [menu, ...this.activeMenuGuardTargets];
			for (const element of this.activeMenuSelectionGuardElements) {
				element.classList.add(CONTEXTUAL_MENU_MOBILE_SELECTION_GUARD_CLASS);
			}
			this.activeMenuOutsideEventRoot = getOwnerBody(menu);
			const closeOnOutside = (event: Event): void => {
				const eventTarget = event.target;
				if (this.contains(eventTarget)) return;
				const withinGuardTarget = this.activeMenuGuardTargets.some(target => {
					const ownerWindow = getOwnerWindow(target) as Window & { Node?: typeof Node };
					const NodeCtor = ownerWindow.Node;
					return !!NodeCtor
						&& typeof eventTarget === 'object'
						&& eventTarget !== null
						&& Object.prototype.isPrototypeOf.call(NodeCtor.prototype, eventTarget)
						&& target.contains(eventTarget as Node);
				});
				if (withinGuardTarget) {
					if (this.getNow() < this.activeMenuTransitionGraceUntil) {
						event.preventDefault?.();
						event.stopPropagation?.();
						return;
					}
					this.hide(true);
					return;
				}
				if (this.getNow() < this.activeMenuTransitionGraceUntil) {
					event.preventDefault?.();
					event.stopPropagation?.();
					return;
				}
				this.hide(true);
			};
			this.activeMenuOutsidePointerHandler = closeOnOutside;
			this.activeMenuOutsideTouchHandler = closeOnOutside;
			this.activeMenuOutsideEventRoot.addEventListener('pointerdown', this.activeMenuOutsidePointerHandler, true);
			this.activeMenuOutsideEventRoot.addEventListener('touchstart', this.activeMenuOutsideTouchHandler, true);
			const autoHideMs = Math.round(options.mobileInteraction.autoHideMs);
			if (autoHideMs > 0) {
				this.activeMenuAutoHideTimer = setWindowTimeout(() => {
					this.activeMenuAutoHideTimer = null;
					this.hide(true);
				}, autoHideMs);
			}
		}
		hostDocument.addEventListener('keydown', this.activeMenuKeydownHandler, true);
		hostDocument.addEventListener('scroll', this.activeMenuScrollHandler, true);
		this.activeMenuWindow.addEventListener('resize', this.activeMenuResizeHandler, true);
		if (!this.options.positionMenu(options.anchorRect, menu)) {
			this.hide(true);
			return false;
		}
		return true;
	}
}

function applyContextualMenuAccent(menu: HTMLElement, context: ContextualMenuContext | undefined): void {
	const taskColor = normalizeTaskFieldColor(context?.task?.fieldValues['taskColor']);
	if (taskColor) {
		menu.style.setProperty('--operon-contextual-menu-accent', taskColor);
		return;
	}
	menu.style.removeProperty('--operon-contextual-menu-accent');
}

function isContextualMenuMobilePlatform(): boolean {
	return Platform.isMobile || Platform.isMobileApp || Platform.isPhone;
}

function isTouchLikePointer(event: PointerEvent, mobilePlatform: boolean): boolean {
	if (event.pointerType === 'touch' || event.pointerType === 'pen') return true;
	return mobilePlatform && !event.pointerType;
}

interface BindContextualHoverMenuTriggerOptions {
	controller: ContextualHoverMenuController;
	triggerEl: HTMLElement;
	menuKey: string;
	getSettings: () => ContextualHoverMenuSettings;
	openMenu: (interaction: { mobile: boolean }) => boolean;
	getNow?: () => number;
	isMobilePlatform?: () => boolean;
}

export function bindContextualHoverMenuTrigger(
	options: BindContextualHoverMenuTriggerOptions,
): () => void {
	let showTimer: WindowTimeoutHandle | null = null;
	let pendingLongPress:
		| {
			pointerId: number;
			initialClientX: number;
			initialClientY: number;
			timer: WindowTimeoutHandle;
			interactionRoot: HTMLElement;
			onPointerMove: (event: PointerEvent) => void;
			onPointerUp: (event: PointerEvent) => void;
			onPointerCancel: (event: PointerEvent) => void;
			onWindowBlur: () => void;
		}
		| null = null;
	let suppressNextClickUntil = 0;

	const now = (): number => options.getNow?.() ?? Date.now();
	const isMobileInteractionEnabled = (): boolean => {
		const settings = options.getSettings();
		return settings.contextualMenuMobileEnabled !== false
			&& (options.isMobilePlatform?.() ?? isContextualMenuMobilePlatform());
	};
	const clearShowTimer = (): void => {
		if (showTimer === null) return;
		clearWindowTimeout(showTimer);
		showTimer = null;
	};
	const clearPendingLongPress = (): void => {
		if (!pendingLongPress) return;
		clearWindowTimeout(pendingLongPress.timer);
		pendingLongPress.interactionRoot.removeEventListener('pointermove', pendingLongPress.onPointerMove, true);
		pendingLongPress.interactionRoot.removeEventListener('pointerup', pendingLongPress.onPointerUp, true);
		pendingLongPress.interactionRoot.removeEventListener('pointercancel', pendingLongPress.onPointerCancel, true);
		getOwnerWindow(options.triggerEl).removeEventListener('blur', pendingLongPress.onWindowBlur, true);
		pendingLongPress = null;
	};

	const handlePointerEnter = (): void => {
		if (isMobileInteractionEnabled()) return;
		if (options.controller.isActive(options.menuKey)) {
			options.controller.clearHideTimer();
			return;
		}
		clearShowTimer();
		const delay = Math.max(0, options.getSettings().contextualMenuOpenDelayMs);
		showTimer = setWindowTimeout(() => {
			showTimer = null;
			options.openMenu({ mobile: false });
		}, delay);
	};

	const handlePointerLeave = (event: PointerEvent): void => {
		if (isMobileInteractionEnabled()) return;
		clearShowTimer();
		const related = event.relatedTarget;
		if (options.controller.contains(related)) {
			options.controller.clearHideTimer();
			return;
		}
		options.controller.scheduleHide();
	};

	const handlePointerDown = (event: PointerEvent): void => {
		if (!isMobileInteractionEnabled()) return;
		if (event.button !== 0) return;
		const mobilePlatform = options.isMobilePlatform?.() ?? isContextualMenuMobilePlatform();
		if (!isTouchLikePointer(event, mobilePlatform)) return;
		clearShowTimer();
		clearPendingLongPress();
		const settings = options.getSettings();
		const interactionRoot = getOwnerBody(options.triggerEl);
		const ownerWindow = getOwnerWindow(options.triggerEl);
		const pointerId = event.pointerId;
		const initialClientX = event.clientX;
		const initialClientY = event.clientY;
		const onPointerMove = (moveEvent: PointerEvent): void => {
			if (moveEvent.pointerId !== pointerId) return;
			const deltaX = moveEvent.clientX - initialClientX;
			const deltaY = moveEvent.clientY - initialClientY;
			if (Math.hypot(deltaX, deltaY) <= CONTEXTUAL_MENU_MOBILE_MOVE_TOLERANCE_PX) return;
			clearPendingLongPress();
		};
		const onPointerUp = (upEvent: PointerEvent): void => {
			if (upEvent.pointerId !== pointerId) return;
			if (now() < suppressNextClickUntil) {
				upEvent.preventDefault();
				upEvent.stopPropagation();
			}
			clearPendingLongPress();
		};
		const onPointerCancel = (cancelEvent: PointerEvent): void => {
			if (cancelEvent.pointerId !== pointerId) return;
			clearPendingLongPress();
		};
		const onWindowBlur = (): void => clearPendingLongPress();
		const timer = setWindowTimeout(() => {
			if (!pendingLongPress || pendingLongPress.pointerId !== pointerId) return;
			const opened = options.openMenu({ mobile: true });
			if (opened) {
				const graceMs = Math.max(0, settings.contextualMenuMobileTransitionGraceMs);
				suppressNextClickUntil = now() + Math.max(graceMs, 350);
			}
		}, Math.max(0, settings.contextualMenuMobileLongPressMs));
		pendingLongPress = {
			pointerId,
			initialClientX,
			initialClientY,
			timer,
			interactionRoot,
			onPointerMove,
			onPointerUp,
			onPointerCancel,
			onWindowBlur,
		};
		interactionRoot.addEventListener('pointermove', onPointerMove, true);
		interactionRoot.addEventListener('pointerup', onPointerUp, true);
		interactionRoot.addEventListener('pointercancel', onPointerCancel, true);
		ownerWindow.addEventListener('blur', onWindowBlur, true);
	};

	const handleClick = (event: MouseEvent): void => {
		if (now() >= suppressNextClickUntil) return;
		event.preventDefault();
		event.stopPropagation();
		suppressNextClickUntil = 0;
	};

	const handleContextMenu = (event: Event): void => {
		if (!isMobileInteractionEnabled()) return;
		event.preventDefault?.();
	};

	options.triggerEl.addEventListener('pointerenter', handlePointerEnter);
	options.triggerEl.addEventListener('pointerleave', handlePointerLeave);
	options.triggerEl.addEventListener('pointerdown', handlePointerDown);
	options.triggerEl.addEventListener('click', handleClick, true);
	options.triggerEl.addEventListener('contextmenu', handleContextMenu);

	return () => {
		clearShowTimer();
		clearPendingLongPress();
		options.triggerEl.removeEventListener('pointerenter', handlePointerEnter);
		options.triggerEl.removeEventListener('pointerleave', handlePointerLeave);
		options.triggerEl.removeEventListener('pointerdown', handlePointerDown);
		options.triggerEl.removeEventListener('click', handleClick, true);
		options.triggerEl.removeEventListener('contextmenu', handleContextMenu);
		if (options.controller.isActive(options.menuKey)) {
			options.controller.hide(true);
		}
	};
}

let sharedHoverMenuDelayMs = 0;

const sharedTaskHoverMenu = new ContextualHoverMenuController({
	getDelayMs: () => sharedHoverMenuDelayMs,
	menuClassName: 'operon-calendar-hover-menu operon-contextual-hover-menu',
	menuPosition: 'fixed',
	positionMenu: (anchorRect, menu) => {
		const ownerWindow = getOwnerWindow(menu);
		const menuRect = menu.getBoundingClientRect();
		const position = resolveContextualHoverMenuPosition(
			anchorRect,
			{
				left: 0,
				top: 0,
				right: ownerWindow.innerWidth,
				bottom: ownerWindow.innerHeight,
				width: ownerWindow.innerWidth,
				height: ownerWindow.innerHeight,
			},
			menuRect,
		);
		if (!position) return false;
		menu.style.left = `${position.left}px`;
		menu.style.top = `${position.top}px`;
		menu.style.width = `${position.width}px`;
		menu.style.maxHeight = `${Math.floor(position.maxHeight)}px`;
		return true;
	},
});

export function hideTaskContextualHoverMenu(immediate = true): void {
	sharedTaskHoverMenu.hide(immediate);
}

export function cleanupTaskContextualHoverMenus(root: HTMLElement): void {
	const targets = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))] as ContextualHoverMenuTrigger[];
	for (const target of targets) {
		target._operonContextualHoverCleanup?.();
	}
}

export function bindTaskContextualHoverMenu(
	triggerEl: HTMLElement,
	options: ContextualHoverMenuBindOptions,
): () => void {
	const typedTrigger = triggerEl as ContextualHoverMenuTrigger;
	typedTrigger._operonContextualHoverCleanup?.();
	const menuKey = `${options.surface}:${options.taskId}`;
	const cleanup = bindContextualHoverMenuTrigger({
		controller: sharedTaskHoverMenu,
		triggerEl,
		menuKey,
		getSettings: options.getSettings,
		openMenu: ({ mobile }) => {
			const task = options.getTask();
			if (!task) return false;
			sharedHoverMenuDelayMs = Math.max(0, options.getSettings().contextualMenuOpenDelayMs);
			const context: ContextualMenuContext = {
				surface: options.surface,
				taskId: options.taskId,
				task,
				now: localNow(),
				isPinned: options.isPinned?.(),
				hasSubtasks: options.hasSubtasks?.() === true,
			};
			const settings = options.getSettings();
			const actions = resolveContextualMenu(
				context,
				settings.contextualMenuActionAllowlist,
				settings.contextualMenuSurfaceActionMatrix,
			);
			return sharedTaskHoverMenu.show({
				key: menuKey,
				taskId: options.taskId,
				actions,
				anchorRect: options.resolveAnchorRect?.() ?? triggerEl.getBoundingClientRect(),
				host: getOwnerBody(triggerEl),
				context,
				onAction: options.onAction,
				mobileInteraction: mobile
					? {
						transitionGraceMs: settings.contextualMenuMobileTransitionGraceMs,
						autoHideMs: settings.contextualMenuMobileAutoHideMs,
						guardTargets: [triggerEl],
					}
					: undefined,
			});
		},
	});
	const storedCleanup = (): void => {
		cleanup();
		if (typedTrigger._operonContextualHoverCleanup === storedCleanup) {
			delete typedTrigger._operonContextualHoverCleanup;
		}
	};
	typedTrigger._operonContextualHoverCleanup = storedCleanup;
	return storedCleanup;
}
