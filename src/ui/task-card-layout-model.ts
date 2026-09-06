/** Shared, non-persistent placement options for task cards. */
export interface TaskCardLayoutOptions {
	width: number;
	align: 'left' | 'center' | 'right';
	wrap: boolean;
}

export interface TaskCardLayoutProbeOptions extends TaskCardLayoutOptions {
	height: number;
}

export type TaskCardPlacementError = 'width' | 'align' | 'wrap' | 'centerWrap';

export function readTaskCardPlacement(values: ReadonlyMap<string, string>, defaults: TaskCardLayoutOptions = { width: 320, align: 'left', wrap: false }): TaskCardLayoutOptions | TaskCardPlacementError {
	const width = values.get('width') ?? String(defaults.width);
	if (!/^\d+$/.test(width) || !Number.isSafeInteger(Number(width)) || Number(width) < 1 || Number(width) > 2000) return 'width';
	const align = values.get('align') ?? defaults.align;
	if (align !== 'left' && align !== 'center' && align !== 'right') return 'align';
	const wrap = values.get('wrap') ?? String(defaults.wrap);
	if (wrap !== 'true' && wrap !== 'false') return 'wrap';
	if (wrap === 'true' && align === 'center') return 'centerWrap';
	return { width: Number(width), align, wrap: wrap === 'true' };
}

export function parseTaskCardLayoutOptions(source: string): TaskCardLayoutProbeOptions {
	const values = new Map<string, string>();
	for (const line of source.split('\n')) {
		if (!line.trim()) continue;
		const match = /^\s*(width|align|wrap|height):\s*(.*?)\s*$/.exec(line);
		if (!match) throw new Error('Use width, align, wrap or height in this layout experiment.');
		const [, key, value] = match;
		if (values.has(key)) throw new Error(`Duplicate option: ${key}`);
		values.set(key, value);
	}
	const placement = readTaskCardPlacement(values);
	if (typeof placement === 'string') throw new Error(`Invalid layout option: ${placement}`);
	const height = values.get('height') ?? '260';
	if (!/^\d+$/.test(height) || Number(height) < 1 || Number(height) > 2000) throw new Error('height must be an integer from 1 to 2000 pixels.');
	return { ...placement, height: Number(height) };
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
