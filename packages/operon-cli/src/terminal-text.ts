export function sanitizeTerminalTextV1(value: string): string {
	let result = '';
	let pendingLineBreak = false;
	for (const character of value) {
		const codePoint = character.codePointAt(0) as number;
		if (codePoint === 9 || codePoint === 10 || codePoint === 13) {
			pendingLineBreak = true;
			continue;
		}
		const isTerminalControl = codePoint <= 8
			|| codePoint === 11
			|| codePoint === 12
			|| (codePoint >= 14 && codePoint <= 31)
			|| (codePoint >= 127 && codePoint <= 159);
		const isBidirectionalControl = codePoint === 0x061c
			|| codePoint === 0x200e
			|| codePoint === 0x200f
			|| (codePoint >= 0x202a && codePoint <= 0x202e)
			|| (codePoint >= 0x2066 && codePoint <= 0x2069);
		const isFormatOrLineSeparator = /[\p{Cf}\p{Zl}\p{Zp}]/u.test(character);
		if (isTerminalControl || isBidirectionalControl || isFormatOrLineSeparator) continue;
		if (pendingLineBreak && result.length > 0 && !result.endsWith(' ')) result += ' ';
		pendingLineBreak = false;
		result += character;
	}
	return result;
}

const PROCESS_DIAGNOSTIC_MAX_CODE_POINTS_V1 = 240;
const REQUEST_TOKEN_ASSIGNMENT_V1 =
	/(?<![A-Za-z0-9_-])requestToken=[A-Za-z0-9_-]{32}(?![A-Za-z0-9_-])/gu;
const REQUEST_TOKEN_V1 =
	/(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{32}(?![A-Za-z0-9_-])/gu;

export function sanitizeProcessDiagnosticV1(value: string): string {
	const sanitized = sanitizeTerminalTextV1(value)
		.normalize('NFC')
		.replace(/\s+/gu, ' ')
		.replace(REQUEST_TOKEN_ASSIGNMENT_V1, 'requestToken=[redacted]')
		.replace(REQUEST_TOKEN_V1, '[redacted]')
		.trim();
	const codePoints = [...sanitized];
	if (codePoints.length <= PROCESS_DIAGNOSTIC_MAX_CODE_POINTS_V1) return sanitized;
	return `${codePoints.slice(0, PROCESS_DIAGNOSTIC_MAX_CODE_POINTS_V1 - 1).join('')}…`;
}
