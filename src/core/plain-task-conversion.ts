import type { ParsedTask } from '../types/fields';
import type { KeyMapping } from '../types/settings';
import { parseTaskLine } from './parser';
import { serializeTask } from './serializer';

/** Render an inline Operon task as a native Markdown checkbox with no metadata. */
export function serializePlainCheckboxTask(task: ParsedTask, keyMappings: KeyMapping[]): string {
	return serializeTask({
		...task,
		timePrefix: null,
		timePrefixRange: null,
		fields: [],
		metadataTailRange: null,
		operonId: null,
	}, keyMappings);
}

export type PlainInlineTaskConversionPlan =
	| { outcome: 'converted'; nextContent: string; plainLine: string }
	| { outcome: 'conflict'; reason: 'missing' | 'duplicate' | 'stale' };

/** Build a guarded whole-file replacement for exactly one inline Operon task. */
export function planInlineTaskToPlain(
	content: string,
	operonId: string,
	expectedRawLine: string,
	keyMappings: KeyMapping[],
): PlainInlineTaskConversionPlan {
	const lines = content.split('\n');
	const matches: Array<{ index: number; task: ParsedTask }> = [];
	for (let index = 0; index < lines.length; index += 1) {
		const parsed = parseTaskLine(lines[index] ?? '', index, '', keyMappings);
		if (parsed?.operonId === operonId) matches.push({ index, task: parsed });
	}
	if (matches.length === 0) return { outcome: 'conflict', reason: 'missing' };
	if (matches.length > 1) return { outcome: 'conflict', reason: 'duplicate' };
	const match = matches[0];
	if (!match || lines[match.index] !== expectedRawLine) {
		return { outcome: 'conflict', reason: 'stale' };
	}
	const plainLine = serializePlainCheckboxTask(match.task, keyMappings);
	lines[match.index] = plainLine;
	return { outcome: 'converted', nextContent: lines.join('\n'), plainLine };
}
