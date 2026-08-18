import type { CompactTaskTextPolicy } from '../core/compact-task-text';

export type CompactEditorKeyIntent =
	| 'none'
	| 'insert-line-break'
	| 'submit'
	| 'explicit-submit'
	| 'escape'
	| 'focus-next'
	| 'focus-previous';

export interface CompactEditorKeyIntentInput {
	readonly key: string;
	readonly shiftKey?: boolean;
	readonly metaKey?: boolean;
	readonly ctrlKey?: boolean;
	readonly isComposing?: boolean;
	readonly localCompositionActive?: boolean;
	readonly keyCode?: number;
	readonly textPolicy?: CompactTaskTextPolicy;
}

export function resolveCompactEditorKeyIntent(
	input: CompactEditorKeyIntentInput,
): CompactEditorKeyIntent {
	if (input.isComposing || input.localCompositionActive || input.keyCode === 229) {
		return 'none';
	}

	if (input.key === 'Enter') {
		if (input.metaKey || input.ctrlKey) return 'explicit-submit';
		if (input.shiftKey && input.textPolicy === 'task-note') return 'insert-line-break';
		return 'submit';
	}
	if (input.key === 'Escape') return 'escape';
	if (input.key === 'Tab') return input.shiftKey ? 'focus-previous' : 'focus-next';
	return 'none';
}
