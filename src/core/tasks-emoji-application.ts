import { ParsedTask, OperonField } from '../types/fields';
import { CANONICAL_KEY_MAP } from '../types/keys';
import {
	Pipeline,
	resolveAutomationWorkflowStatus,
	resolveReverseWorkflowFromTerminalDate,
	shouldTriggerOneShotAutomation,
} from '../types/pipeline';
import { parseRepeatRule } from './repeat-rule';
import { normalizeLegacyCreatedDatetime } from './yaml-fields';

export interface ApplyTasksEmojiConversionOptions {
	task: ParsedTask;
	tags: string[];
	mappedFields: Record<string, string>;
	leftovers: string[];
	previousFieldValues: Record<string, string>;
	pipelines: Pipeline[];
	defaultPipelineName: string;
	defaultPriority: string;
	repeatSeriesIdFactory?: () => string;
}

export interface ApplyTasksEmojiConversionResult {
	ok: boolean;
	errorMessage?: string;
}

function createInlineField(key: string, value: string, type: OperonField['type'] = CANONICAL_KEY_MAP.get(key)?.type ?? 'text'): OperonField {
	return {
		sourceKey: key,
		key,
		value,
		rawValue: value,
		type,
		isCanonical: CANONICAL_KEY_MAP.has(key),
		containerRange: { from: 0, to: 0 },
		valueRange: { from: 0, to: 0 },
	};
}

function normalizeCreatedField(task: ParsedTask, fallbackValue: string): void {
	const existing = task.fields.find(field => field.key === 'datetimeCreated');
	if (!existing) return;
	const normalizedValue = normalizeLegacyCreatedDatetime(existing.value || fallbackValue || '');
	if (normalizedValue) {
		existing.value = normalizedValue;
		existing.rawValue = normalizedValue;
	}
	existing.type = 'datetime';
	if (existing.sourceKey === 'dateCreated') {
		existing.sourceKey = 'datetimeCreated';
	}
}

function setParsedTaskField(
	task: ParsedTask,
	key: string,
	value: string,
	type: OperonField['type'] = CANONICAL_KEY_MAP.get(key)?.type ?? 'text',
): void {
	const existing = task.fields.find(field => field.key === key);
	if (existing) {
		existing.value = value;
		existing.rawValue = value;
		existing.type = type;
		if (key === 'datetimeCreated') normalizeCreatedField(task, value);
		return;
	}
	task.fields.push(createInlineField(key, value, type));
	if (key === 'datetimeCreated') normalizeCreatedField(task, value);
}

function maybeApplyScheduledAutomationToParsedTask(options: ApplyTasksEmojiConversionOptions): void {
	const nextDateScheduled = options.task.fields.find(field => field.key === 'dateScheduled')?.value;
	if (!shouldTriggerOneShotAutomation(options.previousFieldValues['dateScheduled'], nextDateScheduled)) return;
	if (options.task.checkbox !== 'open') return;

	const currentStatus = options.task.fields.find(field => field.key === 'status')?.value;
	const workflow = resolveAutomationWorkflowStatus(
		options.pipelines,
		currentStatus,
		options.defaultPipelineName,
		'scheduled',
	);
	if (!workflow) return;

	setParsedTaskField(options.task, 'status', workflow.value, 'text');
	options.task.checkbox = workflow.checkbox;
}

function applyTerminalDateWorkflow(
	options: ApplyTasksEmojiConversionOptions,
	key: 'dateCompleted' | 'dateCancelled',
	value: string,
): ApplyTasksEmojiConversionResult {
	const currentStatus = options.task.fields.find(field => field.key === 'status')?.value;
	const resolution = resolveReverseWorkflowFromTerminalDate(
		options.pipelines,
		currentStatus,
		options.defaultPipelineName,
		key,
		value,
	);
	if (!resolution.isValid || !resolution.workflow) {
		return { ok: false, errorMessage: resolution.errorMessage };
	}

	setParsedTaskField(options.task, 'status', resolution.workflow.value, 'text');
	if (key === 'dateCompleted') {
		setParsedTaskField(options.task, 'dateCompleted', value, 'date');
		options.task.fields = options.task.fields.filter(field => field.key !== 'dateCancelled');
	} else {
		setParsedTaskField(options.task, 'dateCancelled', value, 'date');
		options.task.fields = options.task.fields.filter(field => field.key !== 'dateCompleted');
	}
	options.task.checkbox = resolution.checkbox;
	return { ok: true };
}

function applyDefaultPriority(task: ParsedTask, mappedFields: Record<string, string>, defaultPriority: string): void {
	if (Object.prototype.hasOwnProperty.call(mappedFields, 'priority')) return;
	const normalizedDefault = defaultPriority.trim();
	if (normalizedDefault) {
		setParsedTaskField(task, 'priority', normalizedDefault, 'text');
		return;
	}
	task.fields = task.fields.filter(field => field.key !== 'priority');
}

function ensureRepeatSeriesId(task: ParsedTask, factory: (() => string) | undefined): void {
	if (!factory) return;
	const repeat = task.fields.find(field => field.key === 'repeat')?.value.trim() ?? '';
	if (!parseRepeatRule(repeat)) return;
	const existingSeriesId = task.fields.find(field => field.key === 'repeatSeriesId')?.value.trim() ?? '';
	if (existingSeriesId) return;
	setParsedTaskField(task, 'repeatSeriesId', factory(), 'text');
}

export function applyTasksEmojiConversionToParsedTask(options: ApplyTasksEmojiConversionOptions): ApplyTasksEmojiConversionResult {
	options.task.tags = [...new Set(options.tags.map(tag => tag.replace(/^#/, '').trim()).filter(Boolean))];

	for (const [key, value] of Object.entries(options.mappedFields)) {
		if (!value.trim()) continue;
		if (key === 'dateCompleted' || key === 'dateCancelled') {
			const terminalResult = applyTerminalDateWorkflow(options, key, value);
			if (!terminalResult.ok) return terminalResult;
			continue;
		}

		setParsedTaskField(options.task, key, value);
		if (key === 'dateScheduled') {
			maybeApplyScheduledAutomationToParsedTask(options);
		}
	}

	applyDefaultPriority(options.task, options.mappedFields, options.defaultPriority);
	ensureRepeatSeriesId(options.task, options.repeatSeriesIdFactory);

	if (options.leftovers.length > 0) {
		setParsedTaskField(options.task, 'note', `Tasks syntax leftovers: ${options.leftovers.join(' | ')}`, 'text');
	}

	return { ok: true };
}
