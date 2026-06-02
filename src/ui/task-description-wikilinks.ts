import { App } from 'obsidian';
import { createOwnerElement } from '../core/dom-compat';
import { bindTaskDescriptionWikilinkPreview } from './compact-chip-link-preview';
import { scanTaskWikiLinksInLine } from './task-wikilink-scanner';

export interface TaskDescriptionWikilinkRenderOptions {
	app: App;
	description: string;
	sourcePath: string;
	containerClassName?: string;
	linkClassName?: string;
}

export function renderTaskDescriptionWikilinks(
	container: HTMLElement,
	options: TaskDescriptionWikilinkRenderOptions,
): boolean {
	const matches = scanTaskWikiLinksInLine(options.description, { includeEmbeds: false });
	if (matches.length === 0) return false;

	container.addClass('operon-task-description-markdown');
	if (options.containerClassName) {
		container.addClass(options.containerClassName);
	}

	let cursor = 0;
	for (const match of matches) {
		appendTaskDescriptionText(container, options.description.slice(cursor, match.from));
		appendTaskDescriptionWikilink(container, match.linktext, match.alias, options);
		cursor = match.to;
	}
	appendTaskDescriptionText(container, options.description.slice(cursor));
	return true;
}

export function isTaskDescriptionWikilinkEventTarget(target: EventTarget | null, root: HTMLElement): boolean {
	if (!target || typeof (target as HTMLElement).closest !== 'function') return false;
	const link = (target as HTMLElement).closest('a.internal-link, a.external-link');
	return !!link && root.contains(link);
}

function appendTaskDescriptionText(container: HTMLElement, text: string): void {
	if (!text) return;
	const textEl = createOwnerElement(container, 'span');
	textEl.textContent = text;
	container.appendChild(textEl);
}

function appendTaskDescriptionWikilink(
	container: HTMLElement,
	linktext: string,
	alias: string | null,
	options: TaskDescriptionWikilinkRenderOptions,
): void {
	const anchor = createOwnerElement(container, 'a');
	anchor.classList.add('internal-link', 'operon-task-description-wikilink');
	if (options.linkClassName) {
		anchor.classList.add(options.linkClassName);
	}
	anchor.textContent = alias ?? linktext;
	anchor.setAttribute('data-href', linktext);
	anchor.setAttribute('href', linktext);
	anchor.setAttribute('draggable', 'false');
	anchor.draggable = false;
	anchor.addEventListener('pointerdown', (event) => {
		event.stopPropagation();
	});
	anchor.addEventListener('dragstart', (event) => {
		event.preventDefault();
		event.stopPropagation();
	});
	anchor.addEventListener('mouseover', (event) => {
		event.stopPropagation();
	});
	anchor.addEventListener('mousemove', (event) => {
		event.stopPropagation();
	});
	anchor.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		void options.app.workspace.openLinkText(linktext, options.sourcePath, false);
	});
	bindTaskDescriptionWikilinkPreview(options.app, anchor, linktext, options.sourcePath);
	container.appendChild(anchor);
}
