/**
 * Parser-symmetric escaping for the Stage 3 task-data source fields only.
 * Escaping every structural character keeps literal media/task-type text from
 * being interpreted as a field terminator or wikilink nesting by the inline
 * parser. This intentionally does not alter historic generic field encoding.
 */
export function encodeTaskDataInlineValue(value: string, escapeSemicolons = false): string {
	let result = '';
	for (let index = 0; index < value.length; index += 1) {
		const character = value[index];
		if (character === '\\') {
			result += '\\\\';
		} else if (character === '\r') {
			if (index + 1 < value.length && value[index + 1] === '\n') index += 1;
			result += '\\u000A';
		} else if (character === '\n') {
			result += '\\u000A';
		} else if (character === '{' || character === '}' || character === '[' || character === ']') {
			result += `\\${character}`;
		} else if (character === ';' && escapeSemicolons) {
			result += '\\;';
		} else {
			result += character;
		}
	}
	return result;
}

export function decodeTaskDataInlineValue(value: string): string {
	let result = '';
	for (let index = 0; index < value.length; index += 1) {
		if (value[index] !== '\\' || index + 1 >= value.length) {
			result += value[index];
			continue;
		}
		const next = value[index + 1];
		if (value.slice(index + 1, index + 6).toLowerCase() === 'u000a') {
			result += '\n';
			index += 5;
			continue;
		}
		if (next === '}' || next === '{' || next === '[' || next === ']' || next === ';' || next === '\\') {
			result += next;
			index += 1;
			continue;
		}
		result += value[index];
	}
	return result;
}
