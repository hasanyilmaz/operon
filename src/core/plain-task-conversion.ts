import type { ParsedTask } from '../types/fields';
import type { KeyMapping } from '../types/settings';
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
