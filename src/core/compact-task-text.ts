const LOGICAL_LINE_BREAK_CLUSTER = /[ \t]*(?:(?:\r\n|[\r\n\u2028\u2029])[ \t]*)+/gu;
const TASK_NOTE_LINE_BREAK = /\r\n|[\r\u2028\u2029]/gu;

/**
 * Compact text is single-line by default. Notes are the sole compact surface
 * that may preserve visual line breaks while still using the same draft API.
 */
export type CompactTaskTextPolicy = 'single-line' | 'task-note';

export interface CompactTaskTextDraft {
	readonly sourceValue: string;
	readonly displayValue: string;
	readonly userEdited: boolean;
	readonly persistableValue: string;
}

export interface CompactTaskTextCommit {
	readonly shouldCommit: boolean;
	readonly value: string;
}

export interface CompactTaskTextLineBreakInsertion {
	readonly displayValue: string;
	readonly selectionOffset: number;
}

/**
 * Canonicalizes compact task text for its requested editing policy without
 * collapsing ordinary inner spacing.
 */
export function normalizeCompactTaskText(
	value: string,
	policy: CompactTaskTextPolicy = 'single-line',
): string {
	return projectCompactTaskTextForEditing(value, policy).trim();
}

/**
 * Produces the live compact editor projection while preserving temporary edge
 * whitespace so the user can continue typing the next word.
 */
export function projectCompactTaskTextForEditing(
	value: string,
	policy: CompactTaskTextPolicy = 'single-line',
): string {
	if (policy === 'task-note') return value.replace(TASK_NOTE_LINE_BREAK, '\n');
	return value.replace(LOGICAL_LINE_BREAK_CLUSTER, ' ');
}

/**
 * Applies the historical single-line Enter projection while preserving its
 * caret mapping. This avoids adding a second separator when Enter is pressed
 * next to existing horizontal whitespace.
 */
export function projectCompactTaskTextSingleLineBreakInsertion(
	value: string,
	selectionStart: number,
	selectionEnd: number,
): CompactTaskTextLineBreakInsertion {
	const safeStart = Math.max(0, Math.min(selectionStart, selectionEnd, value.length));
	const safeEnd = Math.max(safeStart, Math.min(Math.max(selectionStart, selectionEnd), value.length));
	const sourceValue = `${value.slice(0, safeStart)}\n${value.slice(safeEnd)}`;
	return {
		displayValue: projectCompactTaskTextForEditing(sourceValue),
		selectionOffset: mapCompactTaskTextOffset(sourceValue, safeStart + 1, false),
	};
}

/**
 * Maps a source offset onto its canonical single-line projection without
 * disturbing unchanged spans between separate newline clusters.
 */
export function mapCompactTaskTextOffset(
	value: string,
	offset: number,
	trimOuterWhitespace = true,
	policy: CompactTaskTextPolicy = 'single-line',
): number {
	if (policy === 'task-note') {
		return mapTaskNoteTextOffset(value, offset, trimOuterWhitespace);
	}
	const safeOffset = Math.max(0, Math.min(offset, value.length));
	const boundaryMap = new Array<number>(value.length + 1);
	let projectedValue = '';
	let sourceCursor = 0;
	let projectedCursor = 0;
	const clusterPattern = new RegExp(
		LOGICAL_LINE_BREAK_CLUSTER.source,
		LOGICAL_LINE_BREAK_CLUSTER.flags,
	);

	for (const match of value.matchAll(clusterPattern)) {
		const clusterStart = match.index;
		const clusterEnd = clusterStart + match[0].length;
		for (let index = sourceCursor; index < clusterStart; index += 1) {
			boundaryMap[index] = projectedCursor;
			projectedValue += value[index];
			projectedCursor += 1;
			boundaryMap[index + 1] = projectedCursor;
		}

		const logicalBreak = /(?:\r\n|[\r\n\u2028\u2029])/u.exec(match[0]);
		const logicalBreakEnd = clusterStart
			+ (logicalBreak?.index ?? 0)
			+ (logicalBreak?.[0].length ?? 1);
		boundaryMap[clusterStart] = projectedCursor;
		projectedValue += ' ';
		projectedCursor += 1;
		for (let boundary = clusterStart + 1; boundary <= clusterEnd; boundary += 1) {
			boundaryMap[boundary] = boundary >= logicalBreakEnd
				? projectedCursor
				: projectedCursor - 1;
		}
		sourceCursor = clusterEnd;
	}

	for (let index = sourceCursor; index < value.length; index += 1) {
		boundaryMap[index] = projectedCursor;
		projectedValue += value[index];
		projectedCursor += 1;
		boundaryMap[index + 1] = projectedCursor;
	}
	boundaryMap[value.length] ??= projectedCursor;

	const projectedOffset = boundaryMap[safeOffset] ?? projectedCursor;
	if (!trimOuterWhitespace) {
		return Math.max(0, Math.min(projectedOffset, projectedValue.length));
	}
	const trimStartLength = projectedValue.length - projectedValue.trimStart().length;
	const normalizedLength = projectedValue.trim().length;
	return Math.max(0, Math.min(projectedOffset - trimStartLength, normalizedLength));
}

/**
 * Creates a lossless draft for legacy values. The display projection may be
 * single-line while the persistable value remains byte-for-byte unchanged.
 */
export function createCompactTaskTextDraft(
	sourceValue: string,
	policy: CompactTaskTextPolicy = 'single-line',
): CompactTaskTextDraft {
	return {
		sourceValue,
		displayValue: normalizeCompactTaskText(sourceValue, policy),
		userEdited: false,
		persistableValue: sourceValue,
	};
}

/**
 * Applies an explicit user edit. Once edited, the draft becomes eligible for
 * canonical single-line persistence.
 */
export function applyCompactTaskTextUserEdit(
	draft: CompactTaskTextDraft,
	value: string,
	policy: CompactTaskTextPolicy = 'single-line',
): CompactTaskTextDraft {
	const displayValue = projectCompactTaskTextForEditing(value, policy);
	return {
		sourceValue: draft.sourceValue,
		displayValue,
		userEdited: true,
		persistableValue: displayValue.trim(),
	};
}

function mapTaskNoteTextOffset(
	value: string,
	offset: number,
	trimOuterWhitespace: boolean,
): number {
	const safeOffset = Math.max(0, Math.min(offset, value.length));
	const boundaryMap = new Array<number>(value.length + 1);
	let projectedValue = '';
	let sourceCursor = 0;
	let projectedCursor = 0;

	while (sourceCursor < value.length) {
		boundaryMap[sourceCursor] = projectedCursor;
		if (value[sourceCursor] === '\r' && value[sourceCursor + 1] === '\n') {
			boundaryMap[sourceCursor + 1] = projectedCursor;
			projectedValue += '\n';
			projectedCursor += 1;
			sourceCursor += 2;
			boundaryMap[sourceCursor] = projectedCursor;
			continue;
		}
		const character = value[sourceCursor];
		projectedValue += character === '\r' || character === '\u2028' || character === '\u2029'
			? '\n'
			: character;
		projectedCursor += 1;
		sourceCursor += 1;
		boundaryMap[sourceCursor] = projectedCursor;
	}

	const projectedOffset = boundaryMap[safeOffset] ?? projectedCursor;
	if (!trimOuterWhitespace) {
		return Math.max(0, Math.min(projectedOffset, projectedValue.length));
	}
	const trimStartLength = projectedValue.length - projectedValue.trimStart().length;
	const normalizedLength = projectedValue.trim().length;
	return Math.max(0, Math.min(projectedOffset - trimStartLength, normalizedLength));
}

/**
 * Resolves the value and write decision without migrating untouched legacy
 * multiline text.
 */
export function resolveCompactTaskTextCommit(
	draft: CompactTaskTextDraft,
): CompactTaskTextCommit {
	return {
		shouldCommit: draft.userEdited && draft.persistableValue !== draft.sourceValue,
		value: draft.persistableValue,
	};
}
