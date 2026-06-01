import { splitRawWikiLinkBody } from './task-file-wikilink-shared';

export interface TaskWikiLinkMatch {
	from: number;
	to: number;
	linktext: string;
	alias: string | null;
}

export interface TaskWikiLinkScanOptions {
	includeEmbeds?: boolean;
}

export function scanTaskWikiLinksInLine(
	text: string,
	options: TaskWikiLinkScanOptions = {},
): TaskWikiLinkMatch[] {
	const matches: TaskWikiLinkMatch[] = [];
	const includeEmbeds = options.includeEmbeds === true;
	let i = 0;
	let codeDelimiter = 0;

	while (i < text.length) {
		const ch = text[i];

		if (ch === '\\') {
			i += 2;
			continue;
		}

		if (ch === '`') {
			const runLength = countRun(text, i, '`');
			if (codeDelimiter === 0) {
				codeDelimiter = runLength;
			} else if (runLength === codeDelimiter) {
				codeDelimiter = 0;
			}
			i += runLength;
			continue;
		}

		if (codeDelimiter === 0 && ch === '[' && i + 1 < text.length && text[i + 1] === '[') {
			if (!includeEmbeds && i > 0 && text[i - 1] === '!') {
				i++;
				continue;
			}

			const closeIndex = findWikiLinkClose(text, i + 2);
			if (closeIndex === -1) break;

			const body = text.slice(i + 2, closeIndex);
			const { linktext, alias } = splitRawWikiLinkBody(body);
			if (linktext) {
				matches.push({
					from: i,
					to: closeIndex + 2,
					linktext,
					alias,
				});
			}

			i = closeIndex + 2;
			continue;
		}

		i++;
	}

	return matches;
}

function countRun(text: string, index: number, char: string): number {
	let run = 0;
	while (index + run < text.length && text[index + run] === char) run++;
	return run;
}

function findWikiLinkClose(text: string, start: number): number {
	for (let i = start; i < text.length - 1; i++) {
		if (text[i] === '\\') {
			i++;
			continue;
		}
		if (text[i] === ']' && text[i + 1] === ']') {
			return i;
		}
	}
	return -1;
}
