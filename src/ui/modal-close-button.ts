const MODAL_CLOSE_BUTTON_SELECTOR = '.modal-close-button';
const SUPPRESSED_CLOSE_BUTTON_CLASS = 'operon-native-modal-close-hidden';

export function suppressNativeModalCloseButton(containerEl: HTMLElement, modalEl: HTMLElement): () => void {
	const ownerDocument = containerEl.ownerDocument;
	const ownerWindow = ownerDocument.defaultView;
	const hiddenCloseButtons = new Map<HTMLElement, CloseButtonRestoreState>();
	let animationFrame: number | null = null;
	let timeoutId: number | null = null;

	const hideCloseButtons = (): void => {
		const roots = new Set<HTMLElement>([containerEl, modalEl]);
		for (const root of roots) {
			for (const closeButton of Array.from(root.querySelectorAll<HTMLElement>(MODAL_CLOSE_BUTTON_SELECTOR))) {
				hideCloseButton(closeButton, hiddenCloseButtons);
			}
		}
		hideNearbyDocumentCloseButtons(ownerDocument, containerEl, modalEl, hiddenCloseButtons);
	};

	const observer = new MutationObserver(hideCloseButtons);
	observer.observe(containerEl, { childList: true, subtree: true });
	if (!containerEl.contains(modalEl)) {
		observer.observe(modalEl, { childList: true, subtree: true });
	}

	hideCloseButtons();
	if (ownerWindow) {
		animationFrame = ownerWindow.requestAnimationFrame(hideCloseButtons);
		timeoutId = ownerWindow.setTimeout(hideCloseButtons, 50);
	}

	return () => {
		observer.disconnect();
		if (ownerWindow && animationFrame !== null) {
			ownerWindow.cancelAnimationFrame(animationFrame);
		}
		if (ownerWindow && timeoutId !== null) {
			ownerWindow.clearTimeout(timeoutId);
		}
		for (const [closeButton, restoreState] of hiddenCloseButtons) {
			restoreCloseButton(closeButton, restoreState);
		}
		hiddenCloseButtons.clear();
	};
}

type CloseButtonRestoreState = {
	ariaHidden: string | null;
	hadSuppressedClass: boolean;
	tabIndex: string | null;
};

function hideCloseButton(closeButton: HTMLElement, hiddenCloseButtons: Map<HTMLElement, CloseButtonRestoreState>): void {
	if (!hiddenCloseButtons.has(closeButton)) {
		hiddenCloseButtons.set(closeButton, {
			ariaHidden: closeButton.getAttribute('aria-hidden'),
			hadSuppressedClass: closeButton.classList.contains(SUPPRESSED_CLOSE_BUTTON_CLASS),
			tabIndex: closeButton.getAttribute('tabindex'),
		});
	}
	closeButton.classList.add(SUPPRESSED_CLOSE_BUTTON_CLASS);
	closeButton.setAttribute('aria-hidden', 'true');
	closeButton.setAttribute('tabindex', '-1');
}

function restoreCloseButton(closeButton: HTMLElement, restoreState: CloseButtonRestoreState): void {
	if (!restoreState.hadSuppressedClass) {
		closeButton.classList.remove(SUPPRESSED_CLOSE_BUTTON_CLASS);
	}
	if (restoreState.ariaHidden === null) {
		closeButton.removeAttribute('aria-hidden');
	} else {
		closeButton.setAttribute('aria-hidden', restoreState.ariaHidden);
	}
	if (restoreState.tabIndex === null) {
		closeButton.removeAttribute('tabindex');
	} else {
		closeButton.setAttribute('tabindex', restoreState.tabIndex);
	}
}

function hideNearbyDocumentCloseButtons(
	ownerDocument: Document,
	containerEl: HTMLElement,
	modalEl: HTMLElement,
	hiddenCloseButtons: Map<HTMLElement, CloseButtonRestoreState>,
): void {
	const modalRect = modalEl.getBoundingClientRect();
	if (modalRect.width <= 0 || modalRect.height <= 0) return;

	for (const closeButton of Array.from(ownerDocument.querySelectorAll<HTMLElement>(MODAL_CLOSE_BUTTON_SELECTOR))) {
		if (modalEl.contains(closeButton)) continue;
		const modalContainer = closeButton.closest('.modal-container');
		if (modalContainer && modalContainer !== containerEl) continue;
		const modalAncestor = closeButton.closest('.modal');
		if (modalAncestor && modalAncestor !== modalEl) continue;
		const buttonRect = closeButton.getBoundingClientRect();
		const isNearModalTopRight = buttonRect.left >= modalRect.right - 96
			&& buttonRect.right <= modalRect.right + 24
			&& buttonRect.top >= modalRect.top - 24
			&& buttonRect.bottom <= modalRect.top + 80;
		if (isNearModalTopRight) hideCloseButton(closeButton, hiddenCloseButtons);
	}
}
