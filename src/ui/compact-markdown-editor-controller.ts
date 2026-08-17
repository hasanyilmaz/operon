import {
	applyCompactTaskTextUserEdit,
	createCompactTaskTextDraft,
	mapCompactTaskTextOffset,
	normalizeCompactTaskText,
	projectCompactTaskTextForEditing,
	resolveCompactTaskTextCommit,
	type CompactTaskTextPolicy,
	type CompactTaskTextCommit,
	type CompactTaskTextDraft,
} from '../core/compact-task-text';

export type CompactSourceSyncResult = 'applied' | 'conflict';

export interface CompactTextSelection {
	anchor: number;
	head: number;
}

export interface CompactTextInputResult {
	readonly draft: CompactTaskTextDraft;
	readonly displayValue: string;
	readonly selection: CompactTextSelection;
}

export class CompactMarkdownEditorController {
	private draft: CompactTaskTextDraft;
	private compositionActive = false;
	private compositionStartDisplayValue = '';

	constructor(
		sourceValue: string,
		private readonly textPolicy: CompactTaskTextPolicy = 'single-line',
	) {
		this.draft = createCompactTaskTextDraft(sourceValue, this.textPolicy);
	}

	getDraft(): CompactTaskTextDraft {
		return this.draft;
	}

	getCommit(): CompactTaskTextCommit {
		return resolveCompactTaskTextCommit(this.draft);
	}

	isCompositionActive(): boolean {
		return this.compositionActive;
	}

	beginComposition(): void {
		this.compositionActive = true;
		this.compositionStartDisplayValue = this.draft.displayValue;
	}

	applyUserInput(value: string, selection: CompactTextSelection): CompactTextInputResult | null {
		if (this.compositionActive) {
			return null;
		}
		return this.applyCompletedUserInput(value, selection);
	}

	endComposition(
		value: string,
		selection: CompactTextSelection,
	): CompactTextInputResult | null {
		this.compositionActive = false;
		if (projectCompactTaskTextForEditing(value, this.textPolicy) === this.compositionStartDisplayValue) {
			return null;
		}
		return this.applyCompletedUserInput(value, selection);
	}

	setSourceValue(sourceValue: string): CompactSourceSyncResult {
		const commit = this.getCommit();
		if (this.compositionActive) {
			return 'conflict';
		}
		if (commit.shouldCommit) {
			if (sourceValue !== this.draft.sourceValue) return 'conflict';
			return 'applied';
		}
		this.draft = createCompactTaskTextDraft(sourceValue, this.textPolicy);
		return 'applied';
	}

	acceptCommittedValue(value: string): void {
		this.draft = createCompactTaskTextDraft(normalizeCompactTaskText(value, this.textPolicy), this.textPolicy);
		this.compositionActive = false;
	}

	private applyCompletedUserInput(
		value: string,
		selection: CompactTextSelection,
	): CompactTextInputResult {
		this.draft = applyCompactTaskTextUserEdit(this.draft, value, this.textPolicy);
		return {
			draft: this.draft,
			displayValue: this.draft.displayValue,
			selection: normalizeCompactTextSelection(value, selection, false, this.textPolicy),
		};
	}
}

export function normalizeCompactTextSelection(
	value: string,
	selection: CompactTextSelection,
	trimOuterWhitespace = true,
	textPolicy: CompactTaskTextPolicy = 'single-line',
): CompactTextSelection {
	return {
		anchor: normalizeCompactTextOffset(value, selection.anchor, trimOuterWhitespace, textPolicy),
		head: normalizeCompactTextOffset(value, selection.head, trimOuterWhitespace, textPolicy),
	};
}

function normalizeCompactTextOffset(
	value: string,
	offset: number,
	trimOuterWhitespace: boolean,
	textPolicy: CompactTaskTextPolicy,
): number {
	return mapCompactTaskTextOffset(value, offset, trimOuterWhitespace, textPolicy);
}
