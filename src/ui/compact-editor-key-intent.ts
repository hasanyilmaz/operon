export type CompactEditorKeyIntent =
	| 'none'
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
}

export function resolveCompactEditorKeyIntent(
	input: CompactEditorKeyIntentInput,
): CompactEditorKeyIntent {
	if (input.isComposing || input.localCompositionActive || input.keyCode === 229) {
		return 'none';
	}

	if (input.key === 'Enter') {
		return input.metaKey || input.ctrlKey ? 'explicit-submit' : 'submit';
	}
	if (input.key === 'Escape') return 'escape';
	if (input.key === 'Tab') return input.shiftKey ? 'focus-previous' : 'focus-next';
	return 'none';
}
