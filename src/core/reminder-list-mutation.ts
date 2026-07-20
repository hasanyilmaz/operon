import {
	parseAbsoluteReminder,
	parseReminderRule,
	type AbsoluteReminderParseErrorReason,
	type ReminderRuleParseErrorReason,
} from './reminder-rules';

export type ReminderListFieldKey = 'reminderDatetimes' | 'reminderRules';
export type ReminderPickerFieldKey = ReminderListFieldKey;

export interface ReminderListItemRef {
	index: number;
	rawValue: string;
}

export type ReminderListMutation =
	| { action: 'add'; nextValue: string }
	| { action: 'replace'; current: ReminderListItemRef; nextValue: string }
	| { action: 'remove'; current: ReminderListItemRef };

export interface ApplyReminderListMutationInput {
	fieldKey: ReminderListFieldKey;
	currentValue: string | undefined;
	mutation: ReminderListMutation;
}

export interface ReminderListMutationSuccess {
	ok: true;
	fieldKey: ReminderListFieldKey;
	fieldValue: string;
	canonicalItem?: string;
	changed: boolean;
}

export type ReminderListItemValidationReason =
	| AbsoluteReminderParseErrorReason
	| ReminderRuleParseErrorReason;

export type ReminderListMutationFailure =
	| {
		ok: false;
		fieldKey: ReminderListFieldKey;
		reason: 'invalid-item';
		rawValue: string;
		itemReason: ReminderListItemValidationReason;
	}
	| {
		ok: false;
		fieldKey: ReminderListFieldKey;
		reason: 'duplicate';
		canonicalItem: string;
		duplicateIndex: number;
	}
	| {
		ok: false;
		fieldKey: ReminderListFieldKey;
		reason: 'stale-item';
		current: ReminderListItemRef;
	};

export type ReminderListMutationResult = ReminderListMutationSuccess | ReminderListMutationFailure;

interface CanonicalReminderListItem {
	canonical: string;
}

/**
 * Apply one atomic reminder-list edit.
 *
 * Only the added or replaced value is canonicalized. Existing sibling tokens,
 * including invalid tokens, retain their value and relative source order.
 */
export function applyReminderListMutation(input: ApplyReminderListMutationInput): ReminderListMutationResult {
	const items = parseReminderListItems(input.currentValue);
	const { fieldKey, mutation } = input;

	if (mutation.action === 'remove') {
		if (!matchesReminderListItemRef(items, mutation.current)) {
			return { ok: false, fieldKey, reason: 'stale-item', current: mutation.current };
		}
		items.splice(mutation.current.index, 1);
		return buildSuccess(fieldKey, input.currentValue, items);
	}
	if (mutation.action === 'replace' && !matchesReminderListItemRef(items, mutation.current)) {
		return { ok: false, fieldKey, reason: 'stale-item', current: mutation.current };
	}

	const parsedNext = canonicalizeReminderListItem(fieldKey, mutation.nextValue);
	if (!parsedNext.ok) {
		return {
			ok: false,
			fieldKey,
			reason: 'invalid-item',
			rawValue: mutation.nextValue,
			itemReason: parsedNext.reason,
		};
	}
	if (mutation.action === 'replace') {
		const parsedCurrent = canonicalizeReminderListItem(fieldKey, items[mutation.current.index]);
		if (parsedCurrent.ok && parsedCurrent.value.canonical === parsedNext.value.canonical) {
			return {
				ok: true,
				fieldKey,
				fieldValue: input.currentValue ?? serializeReminderListItems(items),
				canonicalItem: parsedNext.value.canonical,
				changed: false,
			};
		}
	}

	const excludedIndex = mutation.action === 'replace' ? mutation.current.index : null;
	const duplicateIndex = findCanonicalDuplicateIndex(items, fieldKey, parsedNext.value.canonical, excludedIndex);
	if (duplicateIndex !== null) {
		return {
			ok: false,
			fieldKey,
			reason: 'duplicate',
			canonicalItem: parsedNext.value.canonical,
			duplicateIndex,
		};
	}

	if (mutation.action === 'add') {
		items.push(parsedNext.value.canonical);
	} else {
		items[mutation.current.index] = parsedNext.value.canonical;
	}

	return buildSuccess(fieldKey, input.currentValue, items, parsedNext.value.canonical);
}

function parseReminderListItems(value: string | undefined): string[] {
	if (!value) return [];
	return value
		.split(';')
		.map(item => item.trim())
		.filter(Boolean);
}

function serializeReminderListItems(items: readonly string[]): string {
	return items.join('; ');
}

function matchesReminderListItemRef(items: readonly string[], ref: ReminderListItemRef): boolean {
	return Number.isInteger(ref.index)
		&& ref.index >= 0
		&& ref.index < items.length
		&& items[ref.index] === ref.rawValue.trim();
}

function canonicalizeReminderListItem(
	fieldKey: ReminderListFieldKey,
	rawValue: string,
):
	| { ok: true; value: CanonicalReminderListItem }
	| { ok: false; reason: ReminderListItemValidationReason } {
	if (fieldKey === 'reminderDatetimes') {
		const parsed = parseAbsoluteReminder(rawValue);
		return parsed.ok
			? { ok: true, value: { canonical: parsed.value.localDatetime } }
			: { ok: false, reason: parsed.reason };
	}

	const parsed = parseReminderRule(rawValue);
	return parsed.ok
		? { ok: true, value: { canonical: parsed.value.canonical } }
		: { ok: false, reason: parsed.reason };
}

function findCanonicalDuplicateIndex(
	items: readonly string[],
	fieldKey: ReminderListFieldKey,
	canonicalItem: string,
	excludedIndex: number | null,
): number | null {
	for (const [index, item] of items.entries()) {
		if (index === excludedIndex) continue;
		const parsed = canonicalizeReminderListItem(fieldKey, item);
		if (parsed.ok && parsed.value.canonical === canonicalItem) return index;
	}
	return null;
}

function buildSuccess(
	fieldKey: ReminderListFieldKey,
	currentValue: string | undefined,
	items: readonly string[],
	canonicalItem?: string,
): ReminderListMutationSuccess {
	const fieldValue = serializeReminderListItems(items);
	return {
		ok: true,
		fieldKey,
		fieldValue,
		...(canonicalItem ? { canonicalItem } : {}),
		changed: fieldValue !== (currentValue ?? ''),
	};
}
