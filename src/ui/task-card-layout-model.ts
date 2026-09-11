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

/** Paragraphs, headings and lists can flow beside a card; complex blocks end the flow. */
export function findTaskCardParagraphEnd(lines: readonly string[], start: number): number {
 let listContentIndent: number | null = null;
 for (let index = start; index < lines.length; index++) {
  const line = lines[index];
  if (!line.trim()) continue;
  const indent = /^( *)/.exec(line)![1].length;
  const marker = /^( *)(?:[-+*]|\d+[.)])([ \t]+)/.exec(line);
  if (marker) listContentIndent = marker[0].length;
  else if (listContentIndent !== null && indent < listContentIndent) listContentIndent = null;
  const content = listContentIndent !== null && indent >= listContentIndent ? line.slice(listContentIndent) : line;
  if (/^ {0,3}(?:>|`{3,}|~{3,}|<|!\[|\$\$|\[\^[^\]]+\]:)/.test(content)
   || /^(?: {4}|\t)/.test(content) && !marker
   || /^\s*(?:[-*_]\s*){3,}$/.test(line)
   || /^\s*\[[^\]]+\]:/.test(line)) return index;
  const next = lines[index + 1] ?? '';
  if (line.includes('|') && /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)+\|?\s*$/.test(next)) return index;
  // Consume the underline together with a setext heading, not as a horizontal rule.
  if (/^ {0,3}(?:=+|-+)\s*$/.test(next) && !marker) index++;
 }
 return lines.length;
}
