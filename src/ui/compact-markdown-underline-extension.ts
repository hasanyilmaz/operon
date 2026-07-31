import { RangeSetBuilder, type Extension, type SelectionRange } from '@codemirror/state';
import {
	Decoration,
	type DecorationSet,
	type EditorView,
	ViewPlugin,
	type ViewUpdate,
} from '@codemirror/view';
import { collectMarkdownProtectedRanges } from '../core/markdown-protected-ranges';

export interface CompactMarkdownUnderlineToken {
	from: number;
	contentFrom: number;
	contentTo: number;
	to: number;
}

const MARKER_LENGTH = 2;
const UNDERLINE_MARK = Decoration.mark({
	class: 'operon-compact-markdown-underline',
});
const HIDDEN_MARKER = Decoration.replace({});

/**
 * Adds Operon's compact `++underline++` presentation without rewriting the
 * document. Marker replacement is selection-aware so users can edit the raw
 * syntax whenever the caret or selection is inside its token.
 */
export const compactMarkdownUnderlineExtension: Extension = ViewPlugin.fromClass(class {
	decorations: DecorationSet;

	constructor(view: EditorView) {
		this.decorations = buildUnderlineDecorations(view);
	}

	update(update: ViewUpdate): void {
		if (update.docChanged || update.selectionSet) {
			this.decorations = buildUnderlineDecorations(update.view);
		}
	}
}, {
	decorations: plugin => plugin.decorations,
});

export function findCompactMarkdownUnderlineTokens(
	value: string,
): CompactMarkdownUnderlineToken[] {
	const tokens: CompactMarkdownUnderlineToken[] = [];
	const protectedRanges = collectMarkdownProtectedRanges(value);
	let protectedRangeIndex = 0;
	let cursor = 0;
	let codeDelimiterLength = 0;

	while (cursor < value.length) {
		while (
			protectedRangeIndex < protectedRanges.length
			&& protectedRanges[protectedRangeIndex].to <= cursor
		) {
			protectedRangeIndex += 1;
		}
		const protectedRange = protectedRanges[protectedRangeIndex];
		if (
			protectedRange
			&& cursor >= protectedRange.from
			&& cursor < protectedRange.to
		) {
			cursor = protectedRange.to;
			continue;
		}
		if (value[cursor] === '`' && !isEscaped(value, cursor)) {
			const runLength = countRun(value, cursor, '`');
			if (codeDelimiterLength === 0) {
				codeDelimiterLength = runLength;
			} else if (runLength === codeDelimiterLength) {
				codeDelimiterLength = 0;
			}
			cursor += runLength;
			continue;
		}
		if (
			codeDelimiterLength !== 0
			|| !isOpeningMarker(value, cursor)
		) {
			cursor += 1;
			continue;
		}

		const closingMarker = findClosingMarker(value, cursor + MARKER_LENGTH);
		if (closingMarker === -1) {
			cursor += MARKER_LENGTH;
			continue;
		}
		tokens.push({
			from: cursor,
			contentFrom: cursor + MARKER_LENGTH,
			contentTo: closingMarker,
			to: closingMarker + MARKER_LENGTH,
		});
		cursor = closingMarker + MARKER_LENGTH;
	}

	return tokens;
}

export function isCompactMarkdownUnderlineTokenActive(
	token: CompactMarkdownUnderlineToken,
	ranges: readonly Pick<SelectionRange, 'from' | 'to'>[],
): boolean {
	return ranges.some(range => {
		if (range.from === range.to) {
			return range.from >= token.from && range.from < token.to;
		}
		return range.from < token.to && range.to > token.from;
	});
}

function buildUnderlineDecorations(view: EditorView): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	const tokens = findCompactMarkdownUnderlineTokens(view.state.doc.toString());
	for (const token of tokens) {
		const active = isCompactMarkdownUnderlineTokenActive(
			token,
			view.state.selection.ranges,
		);
		if (!active) {
			builder.add(token.from, token.contentFrom, HIDDEN_MARKER);
		}
		builder.add(token.contentFrom, token.contentTo, UNDERLINE_MARK);
		if (!active) {
			builder.add(token.contentTo, token.to, HIDDEN_MARKER);
		}
	}
	return builder.finish();
}

function findClosingMarker(value: string, contentFrom: number): number {
	let cursor = contentFrom;
	let codeDelimiterLength = 0;
	while (cursor < value.length - 1) {
		if (value[cursor] === '`' && !isEscaped(value, cursor)) {
			const runLength = countRun(value, cursor, '`');
			if (codeDelimiterLength === 0) {
				codeDelimiterLength = runLength;
			} else if (runLength === codeDelimiterLength) {
				codeDelimiterLength = 0;
			}
			cursor += runLength;
			continue;
		}
		if (
			codeDelimiterLength === 0
			&&
			value[cursor] === '+'
			&& value[cursor + 1] === '+'
			&& !isEscaped(value, cursor)
			&& isClosingMarker(value, cursor, contentFrom)
		) {
			return cursor;
		}
		cursor += 1;
	}
	return -1;
}

function isOpeningMarker(value: string, index: number): boolean {
	if (
		value[index] !== '+'
		|| value[index + 1] !== '+'
		|| isEscaped(value, index)
		|| value[index - 1] === '+'
	) {
		return false;
	}
	const firstContentCharacter = value[index + MARKER_LENGTH];
	if (
		firstContentCharacter === undefined
		|| firstContentCharacter === '+'
		|| isWhitespace(firstContentCharacter)
	) {
		return false;
	}
	const precedingCharacter = value[index - 1];
	return precedingCharacter === undefined || !isWordCharacter(precedingCharacter);
}

function isClosingMarker(
	value: string,
	index: number,
	contentFrom: number,
): boolean {
	if (index <= contentFrom || value[index + MARKER_LENGTH] === '+') return false;
	const lastContentCharacter = value[index - 1];
	if (lastContentCharacter === '+' || isWhitespace(lastContentCharacter)) return false;
	const followingCharacter = value[index + MARKER_LENGTH];
	return followingCharacter === undefined || !isWordCharacter(followingCharacter);
}

function isEscaped(value: string, index: number): boolean {
	let slashCount = 0;
	for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) {
		slashCount += 1;
	}
	return slashCount % 2 === 1;
}

function countRun(value: string, index: number, character: string): number {
	let cursor = index;
	while (value[cursor] === character) cursor += 1;
	return cursor - index;
}

function isWhitespace(character: string): boolean {
	return /\s/u.test(character);
}

function isWordCharacter(character: string): boolean {
	return /[\p{L}\p{N}_]/u.test(character);
}
