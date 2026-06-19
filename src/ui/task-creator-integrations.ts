import { Notice } from 'obsidian';
import { t } from '../core/i18n';
import { applyTaskCreatorInheritedTagsToDraft, createEmptyTaskCreatorDraft, TaskCreatorDraft } from './task-creator-modal';
import type { CalendarSlotSelection } from '../types/calendar';
import type { OperonSettings } from '../types/settings';
import { buildCalendarWritebackPlan } from '../systems/calendar-writeback';
import { getSubtaskInheritedFieldKeys, resolveSubtaskInitialFieldsFromParentValues } from '../core/subtask-inheritance';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';

export interface QuickInlineTaskCreationResult {
	operonId: string;
	filePath?: string;
	lineNumber?: number;
}

export interface QuickInlineTaskCreatorInputOptions {
	placeholder: string;
	ariaLabel?: string;
	className?: string;
	submitErrorContext?: string;
	refocusOnSuccess?: boolean;
	submitInBackground?: boolean;
	onSubmit: (draft: TaskCreatorDraft) => Promise<QuickInlineTaskCreationResult | null> | QuickInlineTaskCreationResult | null;
}

export interface QuickInlineTaskCreatorInputControl {
	inputEl: HTMLInputElement;
	focus: () => void;
	getValue: () => string;
	setValue: (value: string) => void;
	destroy: () => void;
}

export interface KanbanTaskCreatorSeed {
	fieldValues: Record<string, string>;
	tags: string[];
	tagsPresent?: boolean;
}

export interface TaskCreatorParentSeed {
	parentTaskId: string;
	parentFieldValues: Record<string, string> | null;
	parentTags?: string[] | null;
	wasCreated?: boolean;
	sourceTitle?: string;
	sourceFilePath?: string;
}

function normalizeTaskCreatorDescription(description: string | null | undefined): string {
	return (description ?? '').replace(/\r?\n+/g, ' ').trim();
}

function normalizeSurfaceFieldValues(values: Record<string, string | undefined>): Record<string, string> {
	const normalized: Record<string, string> = {};
	for (const [key, value] of Object.entries(values)) {
		normalized[key] = (value ?? '').trim();
	}
	return normalized;
}

function buildSurfaceTaskCreatorDraft(
	description: string | null | undefined,
	fieldValues: Record<string, string>,
	tags: string[],
	explicitFieldKeys: string[],
): TaskCreatorDraft {
	const draft = createEmptyTaskCreatorDraft();
	draft.description = normalizeTaskCreatorDescription(description);
	draft.fieldValues = { ...fieldValues };
	draft.tags = [...tags];
	draft.explicitFieldKeys = Array.from(new Set(explicitFieldKeys));
	return draft;
}

export function buildCalendarTaskCreatorDraft(
	selection: CalendarSlotSelection,
	description = '',
): TaskCreatorDraft {
	const fieldValues = normalizeSurfaceFieldValues(buildCalendarWritebackPlan(selection).payload);
	return buildSurfaceTaskCreatorDraft(description, fieldValues, [], Object.keys(fieldValues));
}

export function applyTaskCreatorParentSeedToDraft(
	draft: TaskCreatorDraft,
	seed: TaskCreatorParentSeed | null,
	settings: OperonSettings,
): TaskCreatorDraft {
	const parentTaskId = seed?.parentTaskId.trim() ?? '';
	if (!parentTaskId) return draft;

	const explicitFieldKeys = new Set(draft.explicitFieldKeys);
	const inheritedFieldKeys = new Set(draft.inheritedFieldKeys);
	const inherited = resolveSubtaskInitialFieldsFromParentValues(
		parentTaskId,
		seed?.parentFieldValues,
		settings,
		seed?.parentTags,
	);

	draft.fieldValues['parentTask'] = parentTaskId;
	const candidateKeys = new Set([
		...inheritedFieldKeys,
		...getSubtaskInheritedFieldKeys(inherited),
	]);
	for (const key of candidateKeys) {
		if (explicitFieldKeys.has(key)) continue;
		const rawValue = inherited[key];
		const value = typeof rawValue === 'string' ? rawValue.trim() : '';
		if (value) {
			draft.fieldValues[key] = value;
			inheritedFieldKeys.add(key);
			continue;
		}
		if (inheritedFieldKeys.has(key)) {
			delete draft.fieldValues[key];
		}
	}

	draft.inheritedFieldKeys = Array.from(inheritedFieldKeys);
	if (!explicitFieldKeys.has('tags')) {
		applyTaskCreatorInheritedTagsToDraft(draft, inherited.tags);
	}
	draft.taskIcon = draft.fieldValues['taskIcon'] ?? '';
	draft.taskColor = draft.fieldValues['taskColor'] ?? '';
	return draft;
}

export function buildKanbanTaskCreatorDraft(
	seed: KanbanTaskCreatorSeed,
	description = '',
): TaskCreatorDraft {
	const fieldValues = normalizeSurfaceFieldValues(seed.fieldValues);
	const tags = seed.tags.map(tag => tag.replace(/^#/, '').trim()).filter(Boolean);
	return buildSurfaceTaskCreatorDraft(description, fieldValues, tags, Object.keys(fieldValues));
}

export function buildQuickInlineTaskCreatorDraft(description: string): TaskCreatorDraft {
	const draft = createEmptyTaskCreatorDraft();
	draft.description = normalizeTaskCreatorDescription(description);
	return draft;
}

export function renderQuickInlineTaskCreatorInput(
	container: HTMLElement,
	options: QuickInlineTaskCreatorInputOptions,
): QuickInlineTaskCreatorInputControl {
	const inputEl = container.createEl('input', {
		cls: ['operon-quick-inline-task-input', options.className ?? ''].filter(Boolean).join(' '),
		attr: {
			type: 'text',
			placeholder: options.placeholder,
			autocomplete: 'off',
			spellcheck: 'true',
		},
	});
	setAccessibleLabelWithoutTooltip(inputEl, options.ariaLabel ?? options.placeholder);
	let isSubmitting = false;

	const setSubmitting = (submitting: boolean): void => {
		isSubmitting = submitting;
		inputEl.disabled = submitting;
		inputEl.classList.toggle('is-submitting', submitting);
		inputEl.setAttribute('aria-busy', String(submitting));
	};

	const submit = async (): Promise<void> => {
		if (isSubmitting) return;
		const draft = buildQuickInlineTaskCreatorDraft(inputEl.value);
		if (!draft.description) {
			new Notice(t('notifications', 'taskDescriptionRequired'));
			inputEl.focus();
			return;
		}

		if (options.submitInBackground === true) {
			inputEl.value = '';
			void Promise.resolve(options.onSubmit(draft)).catch((error: unknown) => {
				console.error(`Operon: ${options.submitErrorContext ?? 'quick inline task creation failed'}`, error);
			});
			return;
		}

		setSubmitting(true);
		let shouldClearInput = false;
		let shouldRefocus = false;
		try {
			const result = await options.onSubmit(draft);
			if (!result) {
				shouldRefocus = options.refocusOnSuccess !== false;
				return;
			}
			shouldClearInput = true;
			shouldRefocus = options.refocusOnSuccess !== false;
		} catch (error) {
			console.error(`Operon: ${options.submitErrorContext ?? 'quick inline task creation failed'}`, error);
		} finally {
			setSubmitting(false);
			if (shouldClearInput) inputEl.value = '';
			if (shouldRefocus && inputEl.isConnected) inputEl.focus();
		}
	};

	const handleKeydown = (event: KeyboardEvent): void => {
		if (event.key !== 'Enter' || event.isComposing) return;
		event.preventDefault();
		void submit();
	};

	inputEl.addEventListener('keydown', handleKeydown);

	return {
		inputEl,
		focus: () => inputEl.focus(),
		getValue: () => inputEl.value,
		setValue: (value: string) => {
			inputEl.value = value;
		},
		destroy: () => {
			inputEl.removeEventListener('keydown', handleKeydown);
			inputEl.remove();
		},
	};
}
