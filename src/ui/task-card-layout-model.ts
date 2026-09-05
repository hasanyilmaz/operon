/** Development-only layout experiment. No task data or persisted settings. */
export interface TaskCardLayoutOptions {
	width: number;
	align: 'left' | 'center' | 'right';
	wrap: boolean;
	height: number;
}

export function parseTaskCardLayoutOptions(source: string): TaskCardLayoutOptions {
	const options: TaskCardLayoutOptions = { width: 320, align: 'left', wrap: false, height: 260 };
	const seen = new Set<string>();
	for (const line of source.split('\n')) {
		if (!line.trim()) continue;
		const match = /^\s*(width|align|wrap|height):\s*(.*?)\s*$/.exec(line);
		if (!match) throw new Error('Use width, align, wrap or height in this layout experiment.');
		const [, key, value] = match;
		if (seen.has(key)) throw new Error(`Duplicate option: ${key}`);
		seen.add(key);
		if (key === 'width' || key === 'height') {
			const number = Number(value);
			if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < 1 || number > 2000) {
				throw new Error(`${key} must be an integer from 1 to 2000 pixels.`);
			}
			options[key] = number;
		} else if (key === 'align') {
			if (value !== 'left' && value !== 'center' && value !== 'right') throw new Error('align must be left, center or right.');
			options.align = value;
		} else {
			if (value !== 'true' && value !== 'false') throw new Error('wrap must be true or false.');
			options.wrap = value === 'true';
		}
	}
	if (options.wrap && options.align === 'center') throw new Error('Text wrapping requires align: left or align: right.');
	return options;
}

export function resolveTaskCardLayout(options: TaskCardLayoutOptions, availableWidth: number): { width: number; wrap: boolean } {
	const available = Number.isFinite(availableWidth) ? Math.max(0, availableWidth) : 0;
	const width = Math.min(options.width, available);
	return { width, wrap: options.wrap && available - width - 16 >= 240 };
}

/** Conservative paragraph scope: complex Markdown blocks always terminate wrapping. */
export function findTaskCardParagraphEnd(lines: readonly string[], start: number): number {
	for (let index = start; index < lines.length; index++) {
		const line = lines[index];
		if (!line.trim()) continue;
		if (/^(?: {4}|\t| {0,3}(?:#{1,6}(?:\s|$)|>|[-+*]\s|\d+[.)]\s|`{3,}|~{3,}|<|!\[|\$\$|\[\^[^\]]+\]:))/.test(line)
			|| /^\s*(?:(?:[-*_]\s*){3,}|=+)\s*$/.test(line)
			|| /^\s*\[[^\]]+\]:/.test(line)) return index;
		const next = lines[index + 1] ?? '';
		if (/^\s*(?:=+|-+)\s*$/.test(next)
			|| (line.includes('|') && /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)+\|?\s*$/.test(next))) return index;
	}
	return lines.length;
}
