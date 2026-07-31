import type { App } from 'obsidian';
import { createOwnerElement } from '../core/dom-compat';
import { collectMarkdownProtectedRanges } from '../core/markdown-protected-ranges';
import { bindTaskDescriptionWikilinkPreview } from './compact-chip-link-preview';
import { scanTaskWikiLinksInLine, type TaskWikiLinkMatch } from './task-wikilink-scanner';

export type CompactTaskMarkdownInteractionMode = 'interactive' | 'visual-only' | 'tooltip';

export type CompactTaskMarkdownNode =
	| { type: 'text'; value: string }
	| { type: 'code'; value: string }
	| { type: 'strong' | 'emphasis' | 'strikethrough' | 'underline'; children: CompactTaskMarkdownNode[] }
	| { type: 'wikilink'; target: string; label: string }
	| { type: 'markdown-link'; destination: string; label: string; external: boolean };

export interface CompactTaskMarkdownRenderOptions {
	app?: App;
	value: string;
	sourcePath?: string;
	mode: CompactTaskMarkdownInteractionMode;
	containerClassName?: string;
	linkClassName?: string;
}

export interface CompactTaskMarkdownRenderResult {
	formatted: boolean;
	hasLinks: boolean;
}

interface MarkdownLinkMatch {
	end: number;
	label: string;
	destination: string;
	external: boolean;
}

const ESCAPABLE_PUNCTUATION = /[!-/:-@[-`{-~]/u;
const URI_SCHEME = /^[a-z][a-z0-9+.-]*:/iu;
const SAFE_EXTERNAL_SCHEME = /^https?:\/\//iu;

/**
 * Parses only Operon's deliberately small, inline task-text Markdown subset.
 * It is synchronous, does not invoke Obsidian's Markdown post-processors, and
 * never materializes HTML, embeds, media, blocks, headings, or lists.
 */
export function parseCompactTaskMarkdown(value: string): CompactTaskMarkdownNode[] {
	return parseInline(value);
}

export function renderCompactTaskMarkdown(
	container: HTMLElement,
	options: CompactTaskMarkdownRenderOptions,
): CompactTaskMarkdownRenderResult {
	const nodes = parseCompactTaskMarkdown(options.value);
	const inspected = inspectNodes(nodes);
	const result = {
		formatted: inspected.formatted || flattenVisibleText(nodes) !== options.value,
		hasLinks: inspected.hasLinks,
	};
	container.addClass('operon-compact-task-markdown');
	container.addClass(`operon-compact-task-markdown--${options.mode}`);
	if (options.containerClassName) container.addClass(options.containerClassName);
	if (result.formatted) {
		appendNodes(container, nodes, options);
	} else {
		container.textContent = options.value;
	}
	return result;
}

export function isCompactTaskMarkdownLinkEventTarget(
	target: EventTarget | null,
	root: HTMLElement,
): boolean {
	if (!target || typeof (target as HTMLElement).closest !== 'function') return false;
	const link = (target as HTMLElement).closest('a.internal-link, a.external-link');
	return !!link && root.contains(link);
}

function parseInline(value: string): CompactTaskMarkdownNode[] {
	const nodes: CompactTaskMarkdownNode[] = [];
	const protectedRanges = new Map(
		collectMarkdownProtectedRanges(value).map(range => [range.from, range]),
	);
	const wikilinks = new Map<number, TaskWikiLinkMatch>(
		scanTaskWikiLinksInLine(value, { includeEmbeds: false }).map(match => [match.from, match]),
	);
	let cursor = 0;
	let textStart = 0;

	const flushText = (to: number): void => {
		appendTextNode(nodes, value.slice(textStart, to));
	};

	while (cursor < value.length) {
		if (value[cursor] === '\\' && isEscapable(value[cursor + 1])) {
			flushText(cursor);
			appendTextNode(nodes, value[cursor + 1] ?? '');
			cursor += 2;
			textStart = cursor;
			continue;
		}

		const code = value[cursor] === '`' ? findCodeSpan(value, cursor) : null;
		if (code) {
			flushText(cursor);
			nodes.push({ type: 'code', value: code.value });
			cursor = code.end;
			textStart = cursor;
			continue;
		}

		const wikilink = wikilinks.get(cursor);
		if (wikilink) {
			flushText(cursor);
			nodes.push({
				type: 'wikilink',
				target: wikilink.linktext,
				label: wikilink.alias ?? wikilink.linktext,
			});
			cursor = wikilink.to;
			textStart = cursor;
			continue;
		}

		if (value[cursor] === '[' && value[cursor - 1] !== '!') {
			const markdownLink = findMarkdownLink(value, cursor);
			if (markdownLink) {
				flushText(cursor);
				if (isSafeLinkDestination(markdownLink.destination)) {
					nodes.push({
						type: 'markdown-link',
						destination: markdownLink.destination,
						label: markdownLink.label,
						external: markdownLink.external,
					});
				} else {
					appendTextNode(nodes, value.slice(cursor, markdownLink.end));
				}
				cursor = markdownLink.end;
				textStart = cursor;
				continue;
			}
		}

		const protectedRange = protectedRanges.get(cursor);
		if (protectedRange) {
			flushText(cursor);
			appendTextNode(nodes, value.slice(protectedRange.from, protectedRange.to));
			cursor = protectedRange.to;
			textStart = cursor;
			continue;
		}

		const format = findFormat(value, cursor);
		if (format) {
			flushText(cursor);
			nodes.push({
				type: format.type,
				children: parseInline(value.slice(format.contentStart, format.contentEnd)),
			});
			cursor = format.end;
			textStart = cursor;
			continue;
		}

		cursor++;
	}
	flushText(value.length);
	return nodes;
}

function findCodeSpan(value: string, start: number): { end: number; value: string } | null {
	const delimiterLength = countRun(value, start, '`');
	const delimiter = '`'.repeat(delimiterLength);
	let close = start + delimiterLength;
	while (close < value.length) {
		close = value.indexOf(delimiter, close);
		if (close < 0) return null;
		if (countRun(value, close, '`') === delimiterLength) {
			return {
				end: close + delimiterLength,
				value: value.slice(start + delimiterLength, close),
			};
		}
		close += delimiterLength;
	}
	return null;
}

function findMarkdownLink(value: string, start: number): MarkdownLinkMatch | null {
	let labelEnd = start + 1;
	for (; labelEnd < value.length; labelEnd++) {
		if (value[labelEnd] === '\\') {
			labelEnd++;
			continue;
		}
		if (value[labelEnd] === '\n' || value[labelEnd] === '\r' || value[labelEnd] === '[') return null;
		if (value[labelEnd] === ']') break;
	}
	if (labelEnd >= value.length || value[labelEnd + 1] !== '(') return null;
	const label = unescapeMarkdown(value.slice(start + 1, labelEnd));
	if (!label) return null;

	let depth = 1;
	let destinationEnd = labelEnd + 2;
	for (; destinationEnd < value.length; destinationEnd++) {
		const character = value[destinationEnd];
		if (character === '\\') {
			destinationEnd++;
			continue;
		}
		if (character === '\n' || character === '\r') return null;
		if (character === '(') depth++;
		if (character === ')') {
			depth--;
			if (depth === 0) break;
		}
	}
	if (depth !== 0) return null;
	const destination = unescapeMarkdown(value.slice(labelEnd + 2, destinationEnd).trim());
	if (!destination || /\s/u.test(destination)) return null;
	return {
		end: destinationEnd + 1,
		label,
		destination,
		external: SAFE_EXTERNAL_SCHEME.test(destination),
	};
}

function findFormat(
	value: string,
	start: number,
): {
	type: 'strong' | 'emphasis' | 'strikethrough' | 'underline';
	contentStart: number;
	contentEnd: number;
	end: number;
} | null {
	const candidates: Array<{
		delimiter: string;
		type: 'strong' | 'emphasis' | 'strikethrough' | 'underline';
		wordBoundary: boolean;
	}> = [
		{ delimiter: '**', type: 'strong', wordBoundary: false },
		{ delimiter: '__', type: 'strong', wordBoundary: true },
		{ delimiter: '~~', type: 'strikethrough', wordBoundary: false },
		{ delimiter: '++', type: 'underline', wordBoundary: true },
		{ delimiter: '*', type: 'emphasis', wordBoundary: false },
		{ delimiter: '_', type: 'emphasis', wordBoundary: true },
	];

	for (const candidate of candidates) {
		if (!value.startsWith(candidate.delimiter, start)) continue;
		if (!isOpeningDelimiter(value, start, candidate.delimiter, candidate.wordBoundary)) continue;
		const contentStart = start + candidate.delimiter.length;
		const contentEnd = findClosingDelimiter(value, contentStart, candidate.delimiter, candidate.wordBoundary);
		if (contentEnd < 0) continue;
		return {
			type: candidate.type,
			contentStart,
			contentEnd,
			end: contentEnd + candidate.delimiter.length,
		};
	}
	return null;
}

function findClosingDelimiter(
	value: string,
	from: number,
	delimiter: string,
	wordBoundary: boolean,
): number {
	for (let cursor = from; cursor <= value.length - delimiter.length; cursor++) {
		if (value[cursor] === '\\') {
			cursor++;
			continue;
		}
		if (value[cursor] === '`') {
			const code = findCodeSpan(value, cursor);
			if (code) {
				cursor = code.end - 1;
				continue;
			}
		}
		if (!value.startsWith(delimiter, cursor)) continue;
		if (cursor === from || /\s/u.test(value[cursor - 1] ?? '')) continue;
		if (
			delimiter === '++'
			&& (value[cursor - 1] === '+' || value[cursor + delimiter.length] === '+')
		) continue;
		if (wordBoundary && isWordCharacter(value[cursor + delimiter.length])) continue;
		return cursor;
	}
	return -1;
}

function isOpeningDelimiter(value: string, start: number, delimiter: string, wordBoundary: boolean): boolean {
	const after = value[start + delimiter.length];
	if (!after || /\s/u.test(after) || after === delimiter[0]) return false;
	if (delimiter === '++' && value[start - 1] === '+') return false;
	if (wordBoundary && isWordCharacter(value[start - 1])) return false;
	return true;
}

function isSafeLinkDestination(destination: string): boolean {
	for (const character of destination) {
		const codePoint = character.codePointAt(0) ?? 0;
		if (codePoint <= 0x1F || codePoint === 0x7F) return false;
	}
	const scheme = URI_SCHEME.exec(destination);
	return !scheme || SAFE_EXTERNAL_SCHEME.test(destination);
}

function unescapeMarkdown(value: string): string {
	return value.replace(/\\([!-/:-@[-`{-~])/gu, '$1');
}

function isEscapable(value: string | undefined): boolean {
	return Boolean(value && ESCAPABLE_PUNCTUATION.test(value));
}

function isWordCharacter(value: string | undefined): boolean {
	return Boolean(value && /[\p{L}\p{N}_]/u.test(value));
}

function countRun(value: string, start: number, character: string): number {
	let length = 0;
	while (value[start + length] === character) length++;
	return length;
}

function appendTextNode(nodes: CompactTaskMarkdownNode[], value: string): void {
	if (!value) return;
	const previous = nodes[nodes.length - 1];
	if (previous?.type === 'text') {
		previous.value += value;
	} else {
		nodes.push({ type: 'text', value });
	}
}

function inspectNodes(nodes: readonly CompactTaskMarkdownNode[]): CompactTaskMarkdownRenderResult {
	let formatted = false;
	let hasLinks = false;
	for (const node of nodes) {
		if (node.type !== 'text') formatted = true;
		if (node.type === 'wikilink' || node.type === 'markdown-link') hasLinks = true;
		if ('children' in node) {
			const childResult = inspectNodes(node.children);
			formatted ||= childResult.formatted;
			hasLinks ||= childResult.hasLinks;
		}
	}
	return { formatted, hasLinks };
}

function flattenVisibleText(nodes: readonly CompactTaskMarkdownNode[]): string {
	return nodes.map(node => {
		if (node.type === 'text' || node.type === 'code') return node.value;
		if (node.type === 'wikilink') return node.label;
		if (node.type === 'markdown-link') return node.label;
		return flattenVisibleText(node.children);
	}).join('');
}

function appendNodes(
	container: HTMLElement,
	nodes: readonly CompactTaskMarkdownNode[],
	options: CompactTaskMarkdownRenderOptions,
): void {
	for (const node of nodes) {
		if (node.type === 'text') {
			appendText(container, node.value);
			continue;
		}
		if (node.type === 'code') {
			appendElement(container, 'code', 'operon-compact-task-markdown-code', node.value);
			continue;
		}
		if (node.type === 'wikilink' || node.type === 'markdown-link') {
			appendLink(container, node, options);
			continue;
		}
		const tagName = node.type === 'strong'
			? 'strong'
			: node.type === 'emphasis'
				? 'em'
				: node.type === 'strikethrough'
					? 's'
					: 'span';
		const className = `operon-compact-task-markdown-${node.type}`;
		const element = createOwnerElement(container, tagName);
		element.className = className;
		container.appendChild(element);
		appendNodes(element, node.children, options);
	}
}

function appendText(container: HTMLElement, value: string): void {
	if (!value) return;
	const span = createOwnerElement(container, 'span');
	span.textContent = value;
	container.appendChild(span);
}

function appendElement<K extends keyof HTMLElementTagNameMap>(
	container: HTMLElement,
	tagName: K,
	className: string,
	value: string,
): void {
	const element = createOwnerElement(container, tagName);
	element.className = className;
	element.textContent = value;
	container.appendChild(element);
}

function appendLink(
	container: HTMLElement,
	node: Extract<CompactTaskMarkdownNode, { type: 'wikilink' | 'markdown-link' }>,
	options: CompactTaskMarkdownRenderOptions,
): void {
	if (options.mode !== 'interactive' || !canActivateLink(node, options)) {
		const label = createOwnerElement(container, 'span');
		label.className = [
			'operon-compact-task-markdown-link-label',
			options.mode === 'tooltip' ? 'operon-hover-tooltip-link-label' : '',
			options.linkClassName ?? '',
		].filter(Boolean).join(' ');
		label.textContent = node.label;
		container.appendChild(label);
		return;
	}

	const anchor = createOwnerElement(container, 'a');
	anchor.classList.add(
		node.type === 'wikilink' || !node.external ? 'internal-link' : 'external-link',
		'operon-compact-task-markdown-link',
	);
	if (options.linkClassName) anchor.classList.add(options.linkClassName);
	anchor.textContent = node.label;
	anchor.setAttribute('draggable', 'false');
	anchor.draggable = false;
	anchor.addEventListener('pointerdown', stopPropagation);
	anchor.addEventListener('dragstart', preventDrag);
	anchor.addEventListener('mouseover', stopPropagation);
	anchor.addEventListener('mousemove', stopPropagation);
	if (node.type === 'wikilink' || !node.external) {
		anchor.setAttribute('data-href', node.type === 'wikilink' ? node.target : node.destination);
		anchor.setAttribute('href', node.type === 'wikilink' ? node.target : node.destination);
		anchor.addEventListener('click', event => {
			event.preventDefault();
			event.stopPropagation();
			const destination = node.type === 'wikilink' ? node.target : node.destination;
			void options.app?.workspace.openLinkText(destination, options.sourcePath ?? '', false);
		});
		bindTaskDescriptionWikilinkPreview(
			options.app as App,
			anchor,
			node.type === 'wikilink' ? node.target : node.destination,
			options.sourcePath ?? '',
		);
	} else {
		anchor.setAttribute('href', node.destination);
		anchor.setAttribute('target', '_blank');
		anchor.setAttribute('rel', 'noopener noreferrer');
		anchor.addEventListener('click', stopPropagation);
	}
	container.appendChild(anchor);
}

function canActivateLink(
	node: Extract<CompactTaskMarkdownNode, { type: 'wikilink' | 'markdown-link' }>,
	options: CompactTaskMarkdownRenderOptions,
): boolean {
	if (node.type === 'markdown-link' && node.external) return true;
	return Boolean(options.app && options.sourcePath);
}

function stopPropagation(event: Event): void {
	event.stopPropagation();
}

function preventDrag(event: Event): void {
	event.preventDefault();
	event.stopPropagation();
}
