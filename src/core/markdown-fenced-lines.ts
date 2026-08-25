export type MarkdownSourceLine = readonly [lineNumber: number, line: string];

export function isMarkdownFenceLine(line: string): boolean {
	return /^\s*```/u.test(line) || /^\s*~~~/u.test(line);
}

/** Iterates the Markdown lines that Operon's task index treats as executable source. */
export function* iterateMarkdownLinesOutsideFences(content: string): Iterable<MarkdownSourceLine> {
	let inFencedCodeBlock = false;
	for (const [lineNumber, line] of content.split('\n').entries()) {
		if (isMarkdownFenceLine(line)) {
			inFencedCodeBlock = !inFencedCodeBlock;
			continue;
		}
		if (!inFencedCodeBlock) yield [lineNumber, line];
	}
}
