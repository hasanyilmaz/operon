import {
	parseAbsoluteReminder,
	parseReminderOffsetInput,
	parseReminderRule,
	REMINDER_RULE_ANCHORS,
	resolveReminderRule,
	type ReminderRuleAnchor,
} from '../../core/reminder-rules';
import type {
	ReminderListItemRef,
	ReminderPickerFieldKey,
} from '../../core/reminder-list-mutation';

export interface ReminderPickerEditingItem extends ReminderListItemRef {
	fieldKey: ReminderPickerFieldKey;
}

export interface ReminderRuleCandidate {
	anchor: ReminderRuleAnchor;
	canonicalRule: string;
	offset: string;
	epochMs: number;
	localDatetime: string;
	isPast: boolean;
}

export type ReminderRuleCandidateStatus =
	| 'empty-input'
	| 'invalid-input'
	| 'no-anchors'
	| 'ready';

export interface ReminderRuleCandidateEvaluation {
	status: ReminderRuleCandidateStatus;
	availableAnchors: ReminderRuleAnchor[];
	candidates: ReminderRuleCandidate[];
}

export interface ReminderPickerModelInput {
	fieldValues: Readonly<Record<string, string | undefined>>;
	reminderDatetimes: readonly string[];
	reminderRules: readonly string[];
	editing?: ReminderPickerEditingItem;
	nowEpochMs?: number;
}

export type AbsoluteReminderSelectionEvaluation =
	| { status: 'valid'; canonical: string; epochMs: number }
	| { status: 'invalid' }
	| { status: 'past'; canonical: string; epochMs: number }
	| { status: 'duplicate'; canonical: string; epochMs: number };

export function getAvailableReminderRuleAnchors(
	fieldValues: Readonly<Record<string, string | undefined>>,
): ReminderRuleAnchor[] {
	return REMINDER_RULE_ANCHORS.filter(anchor =>
		resolveReminderRule(`${anchor}.0m`, fieldValues).status === 'resolved');
}

export function buildReminderRuleCandidates(
	offsetInput: string,
	input: ReminderPickerModelInput,
): ReminderRuleCandidateEvaluation {
	const availableAnchors = getAvailableReminderRuleAnchors(input.fieldValues);
	if (availableAnchors.length === 0) {
		return { status: 'no-anchors', availableAnchors, candidates: [] };
	}
	if (!offsetInput.trim()) {
		return { status: 'empty-input', availableAnchors, candidates: [] };
	}

	const parsedOffset = parseReminderOffsetInput(offsetInput);
	if (!parsedOffset.ok) {
		return { status: 'invalid-input', availableAnchors, candidates: [] };
	}

	const existingCanonicalRules = collectExistingCanonicalRules(input);
	const existingEpochs = collectExistingReminderEpochs(input);
	const nowEpochMs = input.nowEpochMs ?? Date.now();
	const candidates: ReminderRuleCandidate[] = [];

	for (const anchor of availableAnchors) {
		const canonicalRule = `${anchor}.${parsedOffset.value.canonical}`;
		if (existingCanonicalRules.has(canonicalRule)) continue;
		const resolution = resolveReminderRule(canonicalRule, input.fieldValues);
		if (resolution.status !== 'resolved' || existingEpochs.has(resolution.epochMs)) continue;
		candidates.push({
			anchor,
			canonicalRule,
			offset: parsedOffset.value.canonical,
			epochMs: resolution.epochMs,
			localDatetime: resolution.localDatetime,
			isPast: resolution.epochMs <= nowEpochMs,
		});
	}

	return { status: 'ready', availableAnchors, candidates };
}

export function evaluateAbsoluteReminderSelection(
	rawValue: string,
	input: ReminderPickerModelInput,
): AbsoluteReminderSelectionEvaluation {
	const parsed = parseAbsoluteReminder(rawValue);
	if (!parsed.ok) return { status: 'invalid' };
	const value = parsed.value;
	if (input.editing?.fieldKey === 'reminderDatetimes') {
		const current = parseAbsoluteReminder(input.editing.rawValue);
		if (current.ok && current.value.localDatetime === value.localDatetime) {
			return { status: 'valid', canonical: value.localDatetime, epochMs: value.epochMs };
		}
	}
	if (value.epochMs <= (input.nowEpochMs ?? Date.now())) {
		return { status: 'past', canonical: value.localDatetime, epochMs: value.epochMs };
	}
	if (collectExistingReminderEpochs(input).has(value.epochMs)) {
		return { status: 'duplicate', canonical: value.localDatetime, epochMs: value.epochMs };
	}
	return { status: 'valid', canonical: value.localDatetime, epochMs: value.epochMs };
}

function collectExistingCanonicalRules(input: ReminderPickerModelInput): Set<string> {
	const canonicalRules = new Set<string>();
	for (const [index, rawValue] of input.reminderRules.entries()) {
		if (isEditingItem(input.editing, 'reminderRules', index, rawValue)) continue;
		const parsed = parseReminderRule(rawValue);
		if (parsed.ok) canonicalRules.add(parsed.value.canonical);
	}
	return canonicalRules;
}

function collectExistingReminderEpochs(input: ReminderPickerModelInput): Set<number> {
	const epochs = new Set<number>();
	for (const [index, rawValue] of input.reminderDatetimes.entries()) {
		if (isEditingItem(input.editing, 'reminderDatetimes', index, rawValue)) continue;
		const parsed = parseAbsoluteReminder(rawValue);
		if (parsed.ok) epochs.add(parsed.value.epochMs);
	}
	for (const [index, rawValue] of input.reminderRules.entries()) {
		if (isEditingItem(input.editing, 'reminderRules', index, rawValue)) continue;
		const resolution = resolveReminderRule(rawValue, input.fieldValues);
		if (resolution.status === 'resolved') epochs.add(resolution.epochMs);
	}
	return epochs;
}

function isEditingItem(
	editing: ReminderPickerEditingItem | undefined,
	fieldKey: ReminderPickerFieldKey,
	index: number,
	rawValue: string,
): boolean {
	return editing?.fieldKey === fieldKey
		&& editing.index === index
		&& editing.rawValue === rawValue;
}
