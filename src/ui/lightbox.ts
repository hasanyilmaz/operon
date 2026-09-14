import { setIcon } from 'obsidian';
import { asHTMLElement, getOwnerBody, getOwnerDocument, isHTMLElement } from '../core/dom-compat';
import { t } from '../core/i18n';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';

export interface LightboxOptions {
	title: string;
	className?: string;
	/** Render into the existing shell and return content-specific cleanup. */
	render: (lightbox: HTMLElement, close: () => void) => (() => void) | null;
}

let lightboxId = 0;
const activeLightboxes = new WeakMap<Document, () => void>();

export function openLightbox(anchor: HTMLElement, options: LightboxOptions): () => void {
	const ownerDocument = getOwnerDocument(anchor);
	const previouslyFocused = asHTMLElement(ownerDocument.activeElement, anchor);
	activeLightboxes.get(ownerDocument)?.();
	const lightbox = getOwnerBody(anchor).createDiv('operon-task-media-lightbox');
	if (options.className) lightbox.addClass(options.className);
	lightbox.setAttribute('role', 'dialog');
	lightbox.setAttribute('aria-modal', 'true');
	lightbox.tabIndex = -1;
	const title = lightbox.createDiv({ cls: 'operon-task-media-lightbox-title', text: options.title });
	title.id = `operon-task-media-lightbox-title-${++lightboxId}`;
	lightbox.setAttribute('aria-labelledby', title.id);

	const closeButton = lightbox.createEl('button', {
		cls: 'operon-task-media-lightbox-close',
		attr: { type: 'button' },
	});
	setIcon(closeButton, 'x');
	setAccessibleLabelWithoutTooltip(closeButton, t('buttons', 'close'));

	let isClosed = false;
	let contentCleanup: (() => void) | null = null;
	const close = (): void => {
		if (isClosed) return;
		isClosed = true;
		ownerDocument.removeEventListener('keydown', closeOnKeydown, true);
		ownerDocument.removeEventListener('focusin', keepFocusInside, true);
		const cleanup = contentCleanup;
		contentCleanup = null;
		try {
			cleanup?.();
		} finally {
			lightbox.remove();
			if (activeLightboxes.get(ownerDocument) === close) {
				activeLightboxes.delete(ownerDocument);
			}
			const focusTarget = previouslyFocused?.isConnected
				? previouslyFocused
				: anchor.isConnected ? anchor : null;
			focusTarget?.focus({ preventScroll: true });
		}
	};
	const closeOnKeydown = (event: KeyboardEvent): void => {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			close();
		}
	};
	const keepFocusInside = (event: FocusEvent): void => {
		if (!isHTMLElement(event.target, lightbox) || lightbox.contains(event.target)) return;
		closeButton.focus({ preventScroll: true });
	};
	lightbox.addEventListener('click', (event) => {
		if (event.target === lightbox) close();
	});
	closeButton.addEventListener('click', close);

	ownerDocument.addEventListener('keydown', closeOnKeydown, true);
	ownerDocument.addEventListener('focusin', keepFocusInside, true);
	activeLightboxes.set(ownerDocument, close);
	try {
		const cleanup = options.render(lightbox, close);
		if (isClosed) cleanup?.();
		else contentCleanup = cleanup;
	} catch (error) {
		close();
		throw error;
	}
	if (!isClosed) closeButton.focus({ preventScroll: true });
	return close;
}
