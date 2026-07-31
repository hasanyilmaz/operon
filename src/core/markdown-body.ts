export function markdownBodyStartLine(lines: readonly string[]): number | null {
	if (lines[0]?.trim() !== '---') return 0;
	const closing = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
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
