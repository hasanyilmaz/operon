import type { SourceRange } from '../types/fields';

export type MarkdownProtectedRange = SourceRange;

const RAW_URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//iu;
const AUTOLINK_URI_SCHEME = /^[a-z][a-z0-9+.-]{1,31}:/iu;

/**
 * Find Markdown constructs whose contents must not be interpreted as task
 * metadata. Ranges are ordered, non-overlapping, and relative to `text`.
 */
export function collectMarkdownProtectedRanges(text: string): MarkdownProtectedRange[] {
	const ranges: MarkdownProtectedRange[] = [];
	let index = 0;

	while (index < text.length) {
		if (text[index] === '\\') {
			const to = Math.min(text.length, index + 2);
			ranges.push({ from: index, to });
			index = to;
			continue;
		}

		if (text[index] === '`') {
			const delimiterLength = countRun(text, index, '`');
			const close = findMatchingBacktickRun(text, index + delimiterLength, delimiterLength);
			if (close !== -1) {
				ranges.push({ from: index, to: close + delimiterLength });
				index = close + delimiterLength;
				continue;
			}
			index += delimiterLength;
			continue;
		}

		if (text.startsWith('[[', index)) {
			const close = findWikiLinkClose(text, index + 2);
			if (close !== -1) {
				ranges.push({ from: index, to: close + 2 });
				index = close + 2;
				continue;
			}
		}

		if (text[index] === '[' && text[index + 1] !== '[') {
			const labelClose = findMarkdownLabelClose(text, index);
			if (labelClose !== -1 && text[labelClose + 1] === '(') {
				const destinationClose = findMarkdownLinkClose(text, labelClose + 1);
				if (destinationClose !== -1) {
					const from = index > 0 && text[index - 1] === '!' ? index - 1 : index;
					ranges.push({ from, to: destinationClose + 1 });
					index = destinationClose + 1;
					continue;
				}
			}
		}

		if (text[index] === '<') {
			const close = findUnescapedCharacter(text, index + 1, '>');
			const body = close === -1 ? '' : text.slice(index + 1, close);
			if (close !== -1 && isRawUrlStart(body) && isValidAutolinkBody(body)) {
				ranges.push({ from: index, to: close + 1 });
				index = close + 1;
				continue;
			}
		}

		const rawUrlLength = getRawUrlLength(text, index);
		if (rawUrlLength > 0) {
			ranges.push({ from: index, to: index + rawUrlLength });
			index += rawUrlLength;
			continue;
		}

		index++;
	}

	return ranges;
}

export function findMarkdownProtectedRangeAt(
	ranges: readonly MarkdownProtectedRange[],
	index: number,
): MarkdownProtectedRange | null {
	for (const range of ranges) {
		if (index < range.from) return null;
		if (index < range.to) return range;
	}
	return null;
}

function countRun(text: string, index: number, char: string): number {
	let length = 0;
	while (text[index + length] === char) length++;
	return length;
}

function findMatchingBacktickRun(text: string, from: number, delimiterLength: number): number {
	for (let index = from; index < text.length;) {
		if (text[index] !== '`') {
			index++;
			continue;
		}
		const runLength = countRun(text, index, '`');
		if (runLength === delimiterLength) return index;
		index += runLength;
	}
	return -1;
}

function findWikiLinkClose(text: string, from: number): number {
	let depth = 1;
	for (let index = from; index < text.length - 1; index++) {
		if (text[index] === '\\') {
			index++;
			continue;
		}
		if (text.startsWith('[[', index)) {
			depth++;
			index++;
			continue;
		}
		if (text.startsWith(']]', index)) {
			depth--;
			if (depth === 0) return index;
			index++;
		}
	}
	return -1;
}

function findMarkdownLabelClose(text: string, from: number): number {
	let depth = 0;
	for (let index = from; index < text.length;) {
		if (text[index] === '\\') {
			index += 2;
			continue;
		}
		if (text[index] === '`') {
			const delimiterLength = countRun(text, index, '`');
			const close = findMatchingBacktickRun(text, index + delimiterLength, delimiterLength);
			if (close !== -1) {
				index = close + delimiterLength;
				continue;
			}
			index += delimiterLength;
			continue;
		}
		if (text[index] === '[') {
			depth++;
			index++;
			continue;
		}
		if (text[index] === ']') {
			depth--;
			if (depth === 0) return index;
		}
		index++;
	}
	return -1;
}

function findMarkdownLinkClose(text: string, openParenIndex: number): number {
	let index = skipWhitespace(text, openParenIndex + 1);
	if (text[index] === ')') return index;

	if (text[index] === '<') {
		const destinationClose = findUnescapedCharacter(text, index + 1, '>');
		if (destinationClose === -1) return -1;
		const destination = text.slice(index + 1, destinationClose);
		if (containsDisallowedLinkCharacter(destination, true)) return -1;
		index = destinationClose + 1;
	} else {
		let depth = 0;
		let sawDestination = false;
		while (index < text.length) {
			if (text[index] === '\\' && isMarkdownEscapablePunctuation(text[index + 1])) {
				sawDestination = true;
				index += 2;
				continue;
			}
			const char = text[index];
			if (/\s/u.test(char)) break;
			if (isDisallowedLinkCharacter(char, false)) return -1;
			if (char === '(') {
				depth++;
				sawDestination = true;
				index++;
				continue;
			}
			if (char === ')') {
				if (depth === 0) return sawDestination ? index : -1;
				depth--;
				sawDestination = true;
				index++;
				continue;
			}
			sawDestination = true;
			index++;
		}
		if (depth !== 0) return -1;
	}

	const titleStart = skipWhitespace(text, index);
	if (text[titleStart] === ')') return titleStart;
	if (titleStart === index) return -1;
	const titleClose = findMarkdownTitleClose(text, titleStart);
	if (titleClose === -1) return -1;
	const outerClose = skipWhitespace(text, titleClose + 1);
	return text[outerClose] === ')' ? outerClose : -1;
}

function findMarkdownTitleClose(text: string, from: number): number {
	const delimiter = text[from];
	if (delimiter !== '"' && delimiter !== '\'' && delimiter !== '(') return -1;
	const close = delimiter === '(' ? ')' : delimiter;
	for (let index = from + 1; index < text.length; index++) {
		if (text[index] === '\\') {
			index++;
			continue;
		}
		if (text[index] === close) return index;
	}
	return -1;
}

function skipWhitespace(text: string, from: number): number {
	let index = from;
	while (index < text.length && /\s/u.test(text[index])) index++;
	return index;
}

function getRawUrlLength(text: string, index: number): number {
	const candidate = text.slice(index);
	const scheme = RAW_URL_SCHEME.exec(candidate);
	if (!scheme) return 0;
	let length = scheme[0].length;
	while (length < candidate.length && !/\s/u.test(candidate[length])) length++;
	return length;
}

function isRawUrlStart(value: string): boolean {
	return AUTOLINK_URI_SCHEME.test(value);
}

function isValidAutolinkBody(value: string): boolean {
	return !containsDisallowedLinkCharacter(value, true);
}

function containsDisallowedLinkCharacter(value: string, rejectWhitespace: boolean): boolean {
	for (const char of value) {
		if (isDisallowedLinkCharacter(char, rejectWhitespace)) return true;
	}
	return false;
}

function isDisallowedLinkCharacter(char: string, rejectWhitespace: boolean): boolean {
	const codePoint = char.codePointAt(0) ?? 0;
	return codePoint <= 0x1F
		|| codePoint === 0x7F
		|| char === '<'
		|| char === '>'
		|| (rejectWhitespace && /\s/u.test(char));
}

function isMarkdownEscapablePunctuation(char: string | undefined): boolean {
	if (!char) return false;
	const codePoint = char.codePointAt(0) ?? 0;
	return (codePoint >= 0x21 && codePoint <= 0x2F)
		|| (codePoint >= 0x3A && codePoint <= 0x40)
		|| (codePoint >= 0x5B && codePoint <= 0x60)
		|| (codePoint >= 0x7B && codePoint <= 0x7E);
}

function findUnescapedCharacter(text: string, from: number, target: string): number {
	for (let index = from; index < text.length; index++) {
		if (text[index] === '\\') {
			index++;
			continue;
		}
		if (text[index] === target) return index;
	}
	return -1;
}
