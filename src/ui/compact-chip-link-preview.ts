import { App } from 'obsidian';
import { asHTMLElement, getOwnerBody } from '../core/dom-compat';

export const OPERON_COMPACT_CHIP_HOVER_SOURCE = 'operon-compact-chip';
export const OPERON_TASK_TITLE_HOVER_SOURCE = 'operon-task-title';
export const OPERON_TASK_DESCRIPTION_WIKILINK_HOVER_SOURCE = 'operon-task-description-wikilink';
const OPERON_PREVIEW_BINDINGS = Symbol('operon-preview-bindings');

function resolveHoverParent(element: HTMLElement): HTMLElement {
	const hoverParent = asHTMLElement(element.closest(
		'.workspace-leaf-content, .markdown-preview-view, .markdown-embed, .markdown-source-view, .modal',
	), element);
	if (hoverParent) return hoverParent;

	return getOwnerBody(element);
}

function bindModifierHoverLinkPreview(
	app: App,
	element: HTMLElement,
	linktext: string | null,
	sourcePath: string,
	source: string,
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

	const triggerPreview = (event: MouseEvent) => {
		if (!event.metaKey && !event.ctrlKey) return;
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
	};

	element.addEventListener('mouseover', triggerPreview);
	element.addEventListener('mousemove', triggerPreview);
}

export function bindCompactChipLinkPreview(
	app: App,
	element: HTMLElement,
	linktext: string | null,
	sourcePath: string,
): void {
	bindModifierHoverLinkPreview(app, element, linktext, sourcePath, OPERON_COMPACT_CHIP_HOVER_SOURCE);
}

export function bindTaskTitleLinkPreview(
	app: App,
	element: HTMLElement,
	filePath: string | null,
	hoverSourcePath?: string,
): void {
	bindModifierHoverLinkPreview(
		app,
		element,
		filePath,
		hoverSourcePath ?? filePath ?? '',
		OPERON_TASK_TITLE_HOVER_SOURCE,
	);
}

export function bindTaskDescriptionWikilinkPreview(
	app: App,
	element: HTMLElement,
	linktext: string | null,
	sourcePath: string,
): void {
	bindModifierHoverLinkPreview(app, element, linktext, sourcePath, OPERON_TASK_DESCRIPTION_WIKILINK_HOVER_SOURCE);
}
