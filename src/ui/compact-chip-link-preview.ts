import { App, type HoverParent } from 'obsidian';
import { asHTMLElement, getOwnerBody, getOwnerDocument, getOwnerWindow } from '../core/dom-compat';

export const OPERON_COMPACT_CHIP_HOVER_SOURCE = 'operon-compact-chip';
export const OPERON_TASK_TITLE_HOVER_SOURCE = 'operon-task-title';
export const OPERON_TASK_DESCRIPTION_WIKILINK_HOVER_SOURCE = 'operon-task-description-wikilink';
export const OPERON_TASK_MEDIA_HOVER_SOURCE = 'operon-task-media';
const OPERON_PREVIEW_BINDINGS = Symbol('operon-preview-bindings');
const hoverParents = new WeakMap<HTMLElement, HoverParent>();
const activeRemoteMediaPreviews = new WeakMap<Document, () => void>();
const REMOTE_MEDIA_PREVIEW_CLOSE_DELAY_MS = 80;
const REMOTE_MEDIA_PREVIEW_VIEWPORT_PADDING_PX = 8;

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

/**
 * Media fields intentionally preview on direct hover. Other Operon links keep
 * the host-standard modifier-hover contract.
 */
export function bindTaskMediaChipPreview(
	app: App,
	element: HTMLElement,
	target: TaskMediaChipPreviewTarget,
): void {
	if (target.localLinkTarget) {
		bindHoverLinkPreview(
			app,
			element,
			target.localLinkTarget,
			target.sourcePath,
			OPERON_TASK_MEDIA_HOVER_SOURCE,
			false,
		);
		return;
	}
	if (target.externalUrl) {
		bindRemoteTaskMediaPreview(element, target.externalUrl);
	}
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

function bindRemoteTaskMediaPreview(element: HTMLElement, url: string): void {
	let previewEl: HTMLElement | null = null;
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
		previewEl?.remove();
		previewEl = null;
		if (activeRemoteMediaPreviews.get(ownerDocument) === close) {
			activeRemoteMediaPreviews.delete(ownerDocument);
		}
	};
	const scheduleClose = (): void => {
		cancelScheduledClose();
		closeTimer = ownerWindow.setTimeout(close, REMOTE_MEDIA_PREVIEW_CLOSE_DELAY_MS);
	};
	const open = (): void => {
		cancelScheduledClose();
		if (previewEl?.isConnected) return;
		activeRemoteMediaPreviews.get(ownerDocument)?.();

		previewEl = getOwnerBody(element).createDiv('operon-task-media-hover-preview');
		previewEl.setAttribute('role', 'img');
		const image = previewEl.createEl('img', {
			attr: {
				alt: '',
				decoding: 'async',
				referrerpolicy: 'no-referrer',
			},
		});
		image.addEventListener('error', close, { once: true });
		image.addEventListener('load', () => {
			if (previewEl?.isConnected) positionRemoteTaskMediaPreview(element, previewEl);
		}, { once: true });
		image.src = url;
		previewEl.addEventListener('mouseenter', cancelScheduledClose);
		previewEl.addEventListener('mouseleave', scheduleClose);
		positionRemoteTaskMediaPreview(element, previewEl);
		activeRemoteMediaPreviews.set(ownerDocument, close);
	};

	element.addEventListener('mouseenter', open);
	element.addEventListener('mouseleave', scheduleClose);
	element.addEventListener('focusout', scheduleClose);
}

function positionRemoteTaskMediaPreview(anchor: HTMLElement, preview: HTMLElement): void {
	const ownerWindow = getOwnerWindow(anchor);
	const anchorRect = anchor.getBoundingClientRect();
	const previewRect = preview.getBoundingClientRect();
	const maxLeft = Math.max(
		REMOTE_MEDIA_PREVIEW_VIEWPORT_PADDING_PX,
		ownerWindow.innerWidth - previewRect.width - REMOTE_MEDIA_PREVIEW_VIEWPORT_PADDING_PX,
	);
	const left = Math.min(
		Math.max(anchorRect.left, REMOTE_MEDIA_PREVIEW_VIEWPORT_PADDING_PX),
		maxLeft,
	);
	const belowTop = anchorRect.bottom + REMOTE_MEDIA_PREVIEW_VIEWPORT_PADDING_PX;
	const aboveTop = anchorRect.top - previewRect.height - REMOTE_MEDIA_PREVIEW_VIEWPORT_PADDING_PX;
	const top = belowTop + previewRect.height <= ownerWindow.innerHeight - REMOTE_MEDIA_PREVIEW_VIEWPORT_PADDING_PX
		? belowTop
		: Math.max(REMOTE_MEDIA_PREVIEW_VIEWPORT_PADDING_PX, aboveTop);
	preview.style.left = `${Math.round(left)}px`;
	preview.style.top = `${Math.round(top)}px`;
}
