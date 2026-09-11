export type MarkdownSourceLine = readonly [lineNumber: number, line: string];

export function isMarkdownFenceLine(line: string): boolean {
	return /^\s*```/u.test(line) || /^\s*~~~/u.test(line);
}

/**
 * Iterates the lines treated as executable source. Existing index callers retain
 * legacy fence handling; repair callers require matching closing delimiters.
 */
export function* iterateMarkdownLinesOutsideFences(content: string, requireMatchingFence = false): Iterable<MarkdownSourceLine> {
	let openingFence: string | null = null;
	for (const [lineNumber, line] of content.split('\n').entries()) {
		if (isMarkdownFenceLine(line)) {
			const marker = line.trimStart().match(/^(`{3,}|~{3,})/u)?.[0] ?? '';
			if (!openingFence) openingFence = marker;
			else if (!requireMatchingFence || isMatchingFenceClose(line, openingFence)) openingFence = null;
			continue;
		}
		if (!openingFence) yield [lineNumber, line];
	}
}


function isMatchingFenceClose(line: string, opening: string): boolean {
	const marker = line.trimStart().match(/^(`{3,}|~{3,})/u)?.[0] ?? '';
	return marker[0] === opening[0] && marker.length >= opening.length
		&& line.trimStart().slice(marker.length).trim() === '';
}

export interface MarkdownFencedBlock {
	info: string;
	contentStartLine: number;
	contentEndLine: number;
	contentPrefixes: string[];
}

/** Content ranges exclude delimiters. An unclosed block extends to EOF. */
type MarkdownContainer = { kind: 'quote' } | { kind: 'list'; indent: number };

export function* iterateMarkdownFencedBlocks(content: string): Iterable<MarkdownFencedBlock> {
	const lines = content.split('\n');
	let containers: MarkdownContainer[] = [];
	let opening: { marker: string; info: string; start: number; containers: MarkdownContainer[]; prefixes: string[] } | null = null;
	for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
		const raw = lines[lineNumber];
		if (opening) {
			const stripped = consumeContainers(raw, opening.containers);
			if (stripped.matched < opening.containers.length && raw.trim()) {
				yield { info: opening.info, contentStartLine: opening.start + 1, contentEndLine: lineNumber, contentPrefixes: opening.prefixes };
				opening = null;
				lineNumber--;
				continue;
			}
			if (/^ {0,3}(?:`{3,}|~{3,})/u.test(stripped.text) && isMatchingFenceClose(stripped.text, opening.marker)) {
				yield { info: opening.info, contentStartLine: opening.start + 1, contentEndLine: lineNumber, contentPrefixes: opening.prefixes };
				opening = null;
			} else opening.prefixes.push(stripped.prefix);
			continue;
		}
		if (!raw.trim()) continue;
		const continued = consumeContainers(raw, containers);
		containers = containers.slice(0, continued.matched);
		let text = continued.text;
		for (;;) {
			const quote = /^ {0,3}>[ \t]?/u.exec(text)?.[0];
			if (quote) { containers.push({ kind: 'quote' }); text = text.slice(quote.length); continue; }
			// A thematic break must not establish a list indentation context.
			if (/^ {0,3}(?:(?:\* *){3,}|(?:- *){3,}|(?:_ *){3,})\r?$/u.test(text)) break;
			const list = /^ {0,3}(?:[-+*]|\d{1,9}[.)]) {1,4}(?=\S)/u.exec(text)?.[0];
			if (!list) break;
			containers.push({ kind: 'list', indent: list.length });
			text = text.slice(list.length);
		}
		const match = /^ {0,3}(`{3,}|~{3,})([^\n]*)$/u.exec(text);
		if (match) opening = { marker: match[1], info: match[2].trim(), start: lineNumber, containers: [...containers], prefixes: [] };
	}
	if (opening) yield { info: opening.info, contentStartLine: opening.start + 1, contentEndLine: lines.length, contentPrefixes: opening.prefixes };
}

function consumeContainers(line: string, containers: readonly MarkdownContainer[]): { text: string; prefix: string; matched: number } {
	let text = line;
	let matched = 0;
	for (const container of containers) {
		if (container.kind === 'quote') {
			const prefix = /^ {0,3}>[ \t]?/u.exec(text)?.[0];
			if (!prefix) break;
			text = text.slice(prefix.length);
		} else {
			if (!text.startsWith(' '.repeat(container.indent))) break;
			text = text.slice(container.indent);
		}
		matched++;
	}
	return { text, prefix: line.slice(0, line.length - text.length), matched };
}
