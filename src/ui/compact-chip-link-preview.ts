import { App, parseLinktext, setIcon, TFile, type HoverParent } from 'obsidian';
import { asHTMLElement, getOwnerBody, getOwnerDocument, getOwnerWindow } from '../core/dom-compat';
import { t } from '../core/i18n';
import {
	classifyExternalTaskMediaPreviewUrl,
	classifyLocalTaskMediaPreview,
	type TaskMediaPreviewKind,
} from '../core/task-media-preview-kind';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';

export const OPERON_COMPACT_CHIP_HOVER_SOURCE = 'operon-compact-chip';
export const OPERON_TASK_TITLE_HOVER_SOURCE = 'operon-task-title';
export const OPERON_TASK_DESCRIPTION_WIKILINK_HOVER_SOURCE = 'operon-task-description-wikilink';
const OPERON_PREVIEW_BINDINGS = Symbol('operon-preview-bindings');
const hoverParents = new WeakMap<HTMLElement, HoverParent>();
const activeTaskMediaPreviews = new WeakMap<Document, () => void>();
const activeTaskMediaLightboxes = new WeakMap<Document, () => void>();
const TASK_MEDIA_PREVIEW_CLOSE_DELAY_MS = 80;
const TASK_MEDIA_PREVIEW_VIEWPORT_PADDING_PX = 8;
const TASK_MEDIA_LIGHTBOX_MIN_ZOOM = 1;
const TASK_MEDIA_LIGHTBOX_MAX_ZOOM = 8;
const TASK_MEDIA_LIGHTBOX_DOUBLE_CLICK_ZOOM = 2;

function resolveHoverParent(element: HTMLElement): HoverParent {
	const hoverParentEl = asHTMLElement(element.closest(
		'.workspace-leaf-content, .markdown-preview-view, .markdown-embed, .markdown-source-view, .modal',
	), element) ?? getOwnerBody(element);
	const existing = hoverParents.get(hoverParentEl);
	if (existing) return existing;
	const hoverParent: HoverParent = { hoverPopover: null };
	hoverParents.set(hoverParentEl, hoverParent);
	return hoverParent;
}

function bindHoverLinkPreview(
	app: App,
	element: HTMLElement,
	linktext: string | null,
	sourcePath: string,
	source: string,
	requireModifier: boolean,
): void {
	if (!linktext) return;
	const bindingKey = `${source}::${linktext}`;
	const bindings = (element as HTMLElement & {
		[OPERON_PREVIEW_BINDINGS]?: Set<string>;
	})[OPERON_PREVIEW_BINDINGS] ?? new Set<string>();
	if (bindings.has(bindingKey)) return;
	bindings.add(bindingKey);
	(element as HTMLElement & {
		[OPERON_PREVIEW_BINDINGS]?: Set<string>;
	})[OPERON_PREVIEW_BINDINGS] = bindings;

	let isHovered = false;
	let previewTriggered = false;
	const triggerPreview = (event: MouseEvent): boolean => {
		if (requireModifier && !event.metaKey && !event.ctrlKey) return false;
		(app.workspace as unknown as {
			trigger: (name: string, payload: Record<string, unknown>) => void;
		}).trigger('hover-link', {
			event,
			source,
			targetEl: element,
			linktext,
			sourcePath,
			hoverParent: resolveHoverParent(element),
		});
		return true;
	};

	element.addEventListener('mouseover', (event) => {
		const relatedTarget = event.relatedTarget;
		if (relatedTarget && element.contains(relatedTarget as Node)) return;
		isHovered = true;
		previewTriggered = triggerPreview(event);
	});
	element.addEventListener('mousemove', (event) => {
		if (!isHovered || previewTriggered) return;
		previewTriggered = triggerPreview(event);
	});
	element.addEventListener('mouseout', (event) => {
		const relatedTarget = event.relatedTarget;
		if (relatedTarget && element.contains(relatedTarget as Node)) return;
		isHovered = false;
		previewTriggered = false;
	});
}

export function bindCompactChipLinkPreview(
	app: App,
	element: HTMLElement,
	linktext: string | null,
	sourcePath: string,
): void {
	bindHoverLinkPreview(app, element, linktext, sourcePath, OPERON_COMPACT_CHIP_HOVER_SOURCE, true);
}

export interface TaskMediaChipPreviewTarget {
	localLinkTarget?: string | null;
	externalUrl?: string | null;
	sourcePath: string;
}

interface TaskMediaPreviewSource {
	kind: Exclude<TaskMediaPreviewKind, 'unknown'>;
	url: string;
	label: string;
}

/**
 * Media fields intentionally preview on direct hover. Other Operon links keep
 * the host-standard modifier-hover contract.
 */
export function bindTaskMediaChipPreview(
	app: App,
	element: HTMLElement,
	target: TaskMediaChipPreviewTarget,
): void {
	const source = target.externalUrl
		? resolveExternalTaskMediaPreviewSource(target.externalUrl)
		: resolveLocalTaskMediaPreviewSource(app, target.localLinkTarget, target.sourcePath);
	if (source) bindTaskMediaPreview(element, source);
}

function resolveLocalTaskMediaPreviewSource(
	app: App,
	linkTarget: string | null | undefined,
	sourcePath: string,
): TaskMediaPreviewSource | null {
	if (!linkTarget) return null;
	const parsedLink = parseLinktext(linkTarget);
	const file = app.metadataCache.getFirstLinkpathDest(parsedLink.path, sourcePath);
	if (!(file instanceof TFile)) return null;
	const kind = classifyLocalTaskMediaPreview(file.extension);
	if (kind === 'unknown') return null;
	const pdfPage = kind === 'pdf' && /^#page=\d+$/u.test(parsedLink.subpath)
		? parsedLink.subpath
		: '';
	return {
		kind,
		url: `${app.vault.getResourcePath(file)}${pdfPage}`,
		label: linkTarget,
	};
}

function resolveExternalTaskMediaPreviewSource(url: string): TaskMediaPreviewSource | null {
	const kind = classifyExternalTaskMediaPreviewUrl(url);
	return kind === 'unknown' ? null : { kind, url, label: url };
}

export function bindTaskTitleLinkPreview(
	app: App,
	element: HTMLElement,
	filePath: string | null,
	hoverSourcePath?: string,
): void {
	bindHoverLinkPreview(
		app,
		element,
		filePath,
		hoverSourcePath ?? filePath ?? '',
		OPERON_TASK_TITLE_HOVER_SOURCE,
		true,
	);
}

export function bindTaskDescriptionWikilinkPreview(
	app: App,
	element: HTMLElement,
	linktext: string | null,
	sourcePath: string,
): void {
	bindHoverLinkPreview(app, element, linktext, sourcePath, OPERON_TASK_DESCRIPTION_WIKILINK_HOVER_SOURCE, true);
}

function bindTaskMediaPreview(element: HTMLElement, source: TaskMediaPreviewSource): void {
	let previewEl: HTMLElement | null = null;
	let previewCleanup: (() => void) | null = null;
	let closeTimer: number | null = null;
	const ownerDocument = getOwnerDocument(element);
	const ownerWindow = getOwnerWindow(element);

	const cancelScheduledClose = (): void => {
		if (closeTimer === null) return;
		ownerWindow.clearTimeout(closeTimer);
		closeTimer = null;
	};
	const close = (): void => {
		cancelScheduledClose();
		previewCleanup?.();
		previewCleanup = null;
		previewEl?.remove();
		previewEl = null;
		if (activeTaskMediaPreviews.get(ownerDocument) === close) {
			activeTaskMediaPreviews.delete(ownerDocument);
		}
	};
	const scheduleClose = (): void => {
		cancelScheduledClose();
		closeTimer = ownerWindow.setTimeout(close, TASK_MEDIA_PREVIEW_CLOSE_DELAY_MS);
	};
	const open = (): void => {
		cancelScheduledClose();
		if (previewEl?.isConnected) return;
		activeTaskMediaPreviews.get(ownerDocument)?.();

		previewEl = getOwnerBody(element).createDiv('operon-task-media-hover-preview');
		previewEl.addClass(`is-${source.kind}`);
		if (source.kind === 'image') {
			const image = previewEl.createEl('img', {
				attr: {
					alt: '',
					decoding: 'async',
					referrerpolicy: 'no-referrer',
				},
			});
			image.addEventListener('error', close, { once: true });
			image.addEventListener('dblclick', (event) => {
				event.preventDefault();
				event.stopPropagation();
				openTaskMediaLightbox(element, source.url, source.label);
			});
			const zoomButton = previewEl.createEl('button', {
				cls: 'operon-task-media-hover-zoom',
				attr: { type: 'button' },
			});
			setIcon(zoomButton, 'zoom-in');
			setAccessibleLabelWithoutTooltip(zoomButton, t('buttons', 'open'));
			zoomButton.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				openTaskMediaLightbox(element, source.url, source.label);
			});
			image.addEventListener('load', () => {
				if (previewEl?.isConnected) positionTaskMediaPreview(element, previewEl);
			}, { once: true });
			image.src = source.url;
		} else if (source.kind === 'video') {
			const video = previewEl.createEl('video', {
				attr: {
					controls: '',
					playsinline: '',
					preload: 'metadata',
				},
			});
			video.addEventListener('error', close, { once: true });
			video.addEventListener('loadedmetadata', () => {
				if (previewEl?.isConnected) positionTaskMediaPreview(element, previewEl);
			}, { once: true });
			video.src = source.url;
			previewCleanup = () => {
				video.pause();
				video.removeAttribute('src');
				video.load();
			};
		} else {
			const frame = previewEl.createEl('iframe', {
				attr: {
					title: source.label,
					loading: 'eager',
					referrerpolicy: 'no-referrer',
				},
			});
			frame.addEventListener('load', () => {
				if (previewEl?.isConnected) positionTaskMediaPreview(element, previewEl);
			});
			frame.src = source.url;
			previewCleanup = () => frame.removeAttribute('src');
		}
		previewEl.addEventListener('mouseenter', cancelScheduledClose);
		previewEl.addEventListener('mouseleave', scheduleClose);
		positionTaskMediaPreview(element, previewEl);
		activeTaskMediaPreviews.set(ownerDocument, close);
	};

	element.addEventListener('mouseenter', open);
	element.addEventListener('mouseleave', scheduleClose);
	element.addEventListener('focusout', scheduleClose);
}

function openTaskMediaLightbox(anchor: HTMLElement, url: string, label: string): void {
	const ownerDocument = getOwnerDocument(anchor);
	activeTaskMediaLightboxes.get(ownerDocument)?.();

	const previouslyFocused = ownerDocument.activeElement instanceof HTMLElement
		? ownerDocument.activeElement
		: null;
	const lightbox = getOwnerBody(anchor).createDiv('operon-task-media-lightbox');
	lightbox.setAttribute('role', 'dialog');
	lightbox.setAttribute('aria-modal', 'true');
	lightbox.setAttribute(
		'aria-label',
		`${t('settings', 'taskCreatorToolbarTooltip_taskImage')}: ${label}`,
	);
	lightbox.tabIndex = -1;
	const title = lightbox.createDiv({ cls: 'operon-task-media-lightbox-title', text: label });
	title.setAttribute('title', label);
	const image = lightbox.createEl('img', {
		attr: {
			alt: '',
			decoding: 'async',
			draggable: 'false',
			referrerpolicy: 'no-referrer',
		},
	});
	image.src = url;

	const closeButton = lightbox.createEl('button', {
		cls: 'operon-task-media-lightbox-close',
		attr: { type: 'button' },
	});
	setIcon(closeButton, 'x');
	setAccessibleLabelWithoutTooltip(closeButton, t('buttons', 'close'));

	const close = (): void => {
		ownerDocument.removeEventListener('keydown', closeOnKeydown, true);
		lightbox.remove();
		if (activeTaskMediaLightboxes.get(ownerDocument) === close) {
			activeTaskMediaLightboxes.delete(ownerDocument);
		}
		const focusTarget = previouslyFocused?.isConnected
			? previouslyFocused
			: anchor.isConnected ? anchor : null;
		focusTarget?.focus({ preventScroll: true });
	};
	const closeOnKeydown = (event: KeyboardEvent): void => {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			close();
			return;
		}
		if (event.key === 'Tab') {
			event.preventDefault();
			closeButton.focus({ preventScroll: true });
		}
	};
	lightbox.addEventListener('click', (event) => {
		if (event.target === lightbox) close();
	});
	closeButton.addEventListener('click', close);
	image.addEventListener('error', close, { once: true });
	bindTaskMediaLightboxZoom(lightbox, image);
	ownerDocument.addEventListener('keydown', closeOnKeydown, true);
	activeTaskMediaLightboxes.set(ownerDocument, close);
	closeButton.focus({ preventScroll: true });
}

function bindTaskMediaLightboxZoom(lightbox: HTMLElement, image: HTMLImageElement): void {
	let zoom = TASK_MEDIA_LIGHTBOX_MIN_ZOOM;
	let panX = 0;
	let panY = 0;
	let dragPointerId: number | null = null;
	let dragX = 0;
	let dragY = 0;

	const clampPan = (): void => {
		if (zoom <= TASK_MEDIA_LIGHTBOX_MIN_ZOOM) {
			panX = 0;
			panY = 0;
			return;
		}
		const ownerWindow = getOwnerWindow(lightbox);
		const style = ownerWindow.getComputedStyle(lightbox);
		const availableWidth = lightbox.clientWidth
			- Number.parseFloat(style.paddingLeft)
			- Number.parseFloat(style.paddingRight);
		const availableHeight = lightbox.clientHeight
			- Number.parseFloat(style.paddingTop)
			- Number.parseFloat(style.paddingBottom);
		const maxPanX = Math.max(0, (image.offsetWidth * zoom - availableWidth) / 2);
		const maxPanY = Math.max(0, (image.offsetHeight * zoom - availableHeight) / 2);
		panX = Math.max(-maxPanX, Math.min(maxPanX, panX));
		panY = Math.max(-maxPanY, Math.min(maxPanY, panY));
	};
	const applyTransform = (): void => {
		clampPan();
		image.style.transform = `translate3d(${Math.round(panX)}px, ${Math.round(panY)}px, 0) scale(${zoom})`;
		lightbox.toggleClass('is-zoomed', zoom > TASK_MEDIA_LIGHTBOX_MIN_ZOOM);
	};
	const setZoom = (nextZoom: number, clientX: number, clientY: number): void => {
		const clampedZoom = Math.max(
			TASK_MEDIA_LIGHTBOX_MIN_ZOOM,
			Math.min(TASK_MEDIA_LIGHTBOX_MAX_ZOOM, nextZoom),
		);
		if (clampedZoom === zoom) return;
		const bounds = lightbox.getBoundingClientRect();
		const centerX = bounds.left + bounds.width / 2;
		const centerY = bounds.top + bounds.height / 2;
		const ratio = clampedZoom / zoom;
		panX = clientX - centerX - (clientX - centerX - panX) * ratio;
		panY = clientY - centerY - (clientY - centerY - panY) * ratio;
		zoom = clampedZoom;
		applyTransform();
	};

	lightbox.addEventListener('wheel', (event) => {
		event.preventDefault();
		if (event.ctrlKey || event.metaKey) {
			setZoom(zoom * Math.exp(-event.deltaY * 0.004), event.clientX, event.clientY);
			return;
		}
		if (zoom > TASK_MEDIA_LIGHTBOX_MIN_ZOOM) {
			panX -= event.deltaX;
			panY -= event.deltaY;
			applyTransform();
		}
	}, { passive: false });
	image.addEventListener('dblclick', (event) => {
		event.preventDefault();
		event.stopPropagation();
		setZoom(
			zoom > TASK_MEDIA_LIGHTBOX_MIN_ZOOM
				? TASK_MEDIA_LIGHTBOX_MIN_ZOOM
				: TASK_MEDIA_LIGHTBOX_DOUBLE_CLICK_ZOOM,
			event.clientX,
			event.clientY,
		);
	});
	image.addEventListener('pointerdown', (event) => {
		if (zoom <= TASK_MEDIA_LIGHTBOX_MIN_ZOOM || event.button !== 0) return;
		event.preventDefault();
		dragPointerId = event.pointerId;
		dragX = event.clientX;
		dragY = event.clientY;
		image.setPointerCapture(event.pointerId);
		lightbox.addClass('is-dragging');
	});
	image.addEventListener('pointermove', (event) => {
		if (event.pointerId !== dragPointerId) return;
		panX += event.clientX - dragX;
		panY += event.clientY - dragY;
		dragX = event.clientX;
		dragY = event.clientY;
		applyTransform();
	});
	const endDrag = (event: PointerEvent): void => {
		if (event.pointerId !== dragPointerId) return;
		dragPointerId = null;
		lightbox.removeClass('is-dragging');
		if (image.hasPointerCapture(event.pointerId)) image.releasePointerCapture(event.pointerId);
	};
	image.addEventListener('pointerup', endDrag);
	image.addEventListener('pointercancel', endDrag);
}

function positionTaskMediaPreview(anchor: HTMLElement, preview: HTMLElement): void {
	const ownerWindow = getOwnerWindow(anchor);
	const anchorRect = anchor.getBoundingClientRect();
	const previewRect = preview.getBoundingClientRect();
	const maxLeft = Math.max(
		TASK_MEDIA_PREVIEW_VIEWPORT_PADDING_PX,
		ownerWindow.innerWidth - previewRect.width - TASK_MEDIA_PREVIEW_VIEWPORT_PADDING_PX,
	);
	const left = Math.min(
		Math.max(anchorRect.left, TASK_MEDIA_PREVIEW_VIEWPORT_PADDING_PX),
		maxLeft,
	);
	const belowTop = anchorRect.bottom + TASK_MEDIA_PREVIEW_VIEWPORT_PADDING_PX;
	const aboveTop = anchorRect.top - previewRect.height - TASK_MEDIA_PREVIEW_VIEWPORT_PADDING_PX;
	const top = belowTop + previewRect.height <= ownerWindow.innerHeight - TASK_MEDIA_PREVIEW_VIEWPORT_PADDING_PX
		? belowTop
		: Math.max(TASK_MEDIA_PREVIEW_VIEWPORT_PADDING_PX, aboveTop);
	preview.style.left = `${Math.round(left)}px`;
	preview.style.top = `${Math.round(top)}px`;
}
