import type { OperonField, ParsedTask } from '../types/fields';

export interface TaskEditorSourceState {
	description: string;
	checkbox: ParsedTask['checkbox'];
	tags: string[];
	fieldValues: Record<string, string>;
	sourceFields?: readonly OperonField[];
}

export interface TaskEditorSourceSnapshot {
	state: TaskEditorSourceState;
	filePath: string;
	lineNumber: number;
	format: 'inline' | 'yaml';
}

/** Internal edit intent, never a Runtime DTO or stored setting. */
export interface TaskEditorSourceIntent {
	operonId: string;
	baseline: TaskEditorSourceState;
	changedKeys: readonly string[];
}

const ignoredFields = new Set(['operonId', 'pinned', 'datetimeModified', 'trackers', 'duration', 'activeTracker', 'totalEstimate', 'totalDuration']);
const equalTags = (left: readonly string[], right: readonly string[]): boolean =>
	left.length === right.length && left.every((value, index) => value === right[index]);

export function taskEditorChangedKeys(before: TaskEditorSourceState, after: TaskEditorSourceState): string[] {
	const keys: string[] = [];
	if (before.description.trim() !== after.description.trim()) keys.push('_description');
	if (before.checkbox !== after.checkbox) keys.push('_checkbox');
	if (!equalTags(before.tags, after.tags)) keys.push('_tags');
	for (const key of new Set([...Object.keys(before.fieldValues), ...Object.keys(after.fieldValues)])) {
		if (!ignoredFields.has(key) && before.fieldValues[key] !== after.fieldValues[key]) keys.push(key);
	}
	return keys;
}

/** Latest source supplies untouched fields; explicit local edits win per field. */
export function mergeTaskEditorSource(
	latest: TaskEditorSourceState, draft: TaskEditorSourceState, changedKeys: readonly string[],
): TaskEditorSourceState {
	const changed = new Set(changedKeys);
	const fields = { ...latest.fieldValues };
	for (const key of changed) {
		if (key.startsWith('_') || ignoredFields.has(key)) continue;
		if (Object.prototype.hasOwnProperty.call(draft.fieldValues, key)) fields[key] = draft.fieldValues[key];
		else delete fields[key];
	}
	return {
		description: changed.has('_description') ? draft.description : latest.description,
		checkbox: changed.has('_checkbox') ? draft.checkbox : latest.checkbox,
		tags: [...(changed.has('_tags') ? draft.tags : latest.tags)],
		fieldValues: fields,
		sourceFields: latest.sourceFields,
	};
}
