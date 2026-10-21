export function markdownBodyStartLine(lines: readonly string[], exactFences = false): number | null {
	const isFence = (line: string | undefined): boolean => exactFences ? line === '---' : line?.trim() === '---';
	if (!isFence(lines[0])) return 0;
	const closing = lines.findIndex((line, index) => index > 0 && isFence(line));
	return closing < 0 ? null : closing + 1;
}

export function isBlankMarkdownBodyLine(content: string, lineNumber: number): boolean {
	if (!Number.isSafeInteger(lineNumber) || lineNumber < 0) return false;
	const lines = content.split(/\r?\n/u);
	const bodyStart = markdownBodyStartLine(lines);
	return bodyStart !== null
		&& lineNumber >= bodyStart
		&& lineNumber < lines.length
		&& !(lineNumber === lines.length - 1 && lines[lineNumber] === '')
		&& (lines[lineNumber] ?? '').trim() === '';
}
