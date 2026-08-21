export interface InlineHeadingKeywordInsertionResult {
	content: string;
	insertedLineNumber: number;
	headingLineNumber: number;
	headingWasCreated: boolean;
}

export interface InlineExactHeadingInsertionResult {
	content: string;
	insertedLineNumber: number;
}

const MARKDOWN_HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

function splitPreservingEmptyTrailingLine(content: string): string[] {
	if (!content.length) return [];
	return content.split('\n');
}

export function normalizeMarkdownHeadingKeyword(raw: string, fallback: string): string {
	const trimmed = raw.trim();
	const withoutHeadingMarker = trimmed.replace(/^#{1,6}\s+/, '').trim();
	return withoutHeadingMarker || fallback.trim();
}

export function insertInlineTaskUnderFirstHeadingKeyword(
	content: string,
	keyword: string,
	taskLine: string,
	headingLevel = 2,
): InlineHeadingKeywordInsertionResult {
	const safeKeyword = keyword.trim();
	const headingSearch = safeKeyword.toLowerCase();
	const lines = splitPreservingEmptyTrailingLine(content);

	for (let index = 0; index < lines.length; index++) {
		const match = lines[index].trim().match(MARKDOWN_HEADING_RE);
		if (!match) continue;
		const headingText = match[2].trim().toLowerCase();
		if (!headingText.includes(headingSearch)) continue;

		const insertIndex = index + 1;
		lines.splice(insertIndex, 0, taskLine);
		return {
			content: lines.join('\n'),
			insertedLineNumber: insertIndex,
			headingLineNumber: index,
			headingWasCreated: false,
		};
	}

	const nextLines = [...lines];
	while (nextLines.length > 0 && !nextLines[nextLines.length - 1].trim()) {
		nextLines.pop();
	}
	if (nextLines.length > 0) {
		nextLines.push('');
	}

	const headingDepth = Math.max(1, Math.min(6, Math.floor(headingLevel)));
	nextLines.push(`${'#'.repeat(headingDepth)} ${safeKeyword}`);
	nextLines.push(taskLine);

	return {
		content: nextLines.join('\n'),
		insertedLineNumber: nextLines.length - 1,
		headingLineNumber: nextLines.length - 2,
		headingWasCreated: true,
	};
}

export function insertInlineTaskUnderHeading(
	content: string,
	heading: string,
	taskLine: string,
): InlineExactHeadingInsertionResult {
	const lines = splitPreservingEmptyTrailingLine(content);
	const normalizedHeading = heading.trim();
	const headingIndex = lines.findIndex(line => line.trim() === normalizedHeading);
	if (headingIndex >= 0) {
		const insertedLineNumber = headingIndex + 1;
		lines.splice(insertedLineNumber, 0, taskLine);
		return { content: lines.join('\n'), insertedLineNumber };
	}
	while (lines.length > 0 && !lines[lines.length - 1].trim()) lines.pop();
	if (lines.length > 0) lines.push('');
	lines.push(normalizedHeading, taskLine);
	return { content: lines.join('\n'), insertedLineNumber: lines.length - 1 };
}
