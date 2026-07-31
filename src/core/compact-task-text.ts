const LOGICAL_LINE_BREAK_CLUSTER = /[ \t]*(?:(?:\r\n|[\r\n\u2028\u2029])[ \t]*)+/gu;

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

/**
 * Canonicalizes compact task text to one logical line without collapsing
 * ordinary inner spacing.
 */
export function normalizeCompactTaskText(value: string): string {
	return projectCompactTaskTextForEditing(value).trim();
}

/**
 * Produces the live single-line editor projection while preserving temporary
 * edge whitespace so the user can continue typing the next word.
 */
export function projectCompactTaskTextForEditing(value: string): string {
	return value.replace(LOGICAL_LINE_BREAK_CLUSTER, ' ');
}

/**
 * Maps a source offset onto its canonical single-line projection without
 * disturbing unchanged spans between separate newline clusters.
 */
export function mapCompactTaskTextOffset(
	value: string,
	offset: number,
	trimOuterWhitespace = true,
): number {
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
export function createCompactTaskTextDraft(sourceValue: string): CompactTaskTextDraft {
	return {
		sourceValue,
		displayValue: normalizeCompactTaskText(sourceValue),
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
): CompactTaskTextDraft {
	const displayValue = projectCompactTaskTextForEditing(value);
	return {
		sourceValue: draft.sourceValue,
		displayValue,
		userEdited: true,
		persistableValue: displayValue.trim(),
	};
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
