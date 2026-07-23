export interface ExactLineRemovalResult {
	content: string;
	removed: boolean;
}

/**
 * Remove a line only when both its identity matcher and byte-normalized content
 * still match the state captured before a multi-file mutation began.
 */
export function removeExactMatchingLine(
	content: string,
	lineHint: number,
	expectedLine: string,
	matchesIdentity: (line: string, lineNumber: number) => boolean,
): ExactLineRemovalResult {
	const lines = content.split('\n');
	const matchesExpectedLine = (line: string): boolean => line.replace(/\r$/u, '') === expectedLine;
	const matches = (line: string, lineNumber: number): boolean => (
		matchesExpectedLine(line) && matchesIdentity(line, lineNumber)
	);

	let targetLine = -1;
	if (lineHint >= 0 && lineHint < lines.length && matches(lines[lineHint] ?? '', lineHint)) {
		targetLine = lineHint;
	}
	if (targetLine === -1) {
		targetLine = lines.findIndex((line, lineNumber) => matches(line, lineNumber));
	}
	if (targetLine === -1) return { content, removed: false };

	lines.splice(targetLine, 1);
	return { content: lines.join('\n'), removed: true };
}
