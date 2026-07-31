import type {
	ReminderItemReferenceV1,
	TaskContextV1,
} from '../../../src/agent-runtime/contracts/v1';
import { OPERON_ID_PATTERN_V1 } from '../../../src/agent-runtime/contracts/v1';
import {
	parseAbsoluteReminder,
	parseReminderRule,
} from '../../../src/core/reminder-rules';
import {
	parseCompactArgvAssignmentV1,
	type CompactCreateAssignmentV1,
} from './compact-create';
import type { GuidedMutationIntentV1 } from './guided-maintenance';

export type DirectReminderOperationV1 = 'add' | 'replace' | 'remove';
export type DirectReminderCollectionV1 = ReminderItemReferenceV1['collection'];

export interface DirectReminderAstV1 {
	operation: DirectReminderOperationV1;
	collection: DirectReminderCollectionV1;
	value?: string;
	currentValue?: string;
}

export type DirectReminderErrorCodeV1 =
	| 'DIRECT_REMINDER_ASSIGNMENT_REQUIRED'
	| 'DIRECT_REMINDER_CURRENT_CONFLICT'
	| 'DIRECT_REMINDER_CURRENT_REQUIRED'
	| 'DIRECT_REMINDER_INVALID_KEY'
	| 'DIRECT_REMINDER_INVALID_OPERON_ID'
	| 'DIRECT_REMINDER_INVALID_VALUE'
	| 'DIRECT_REMINDER_ITEM_AMBIGUOUS'
	| 'DIRECT_REMINDER_ITEM_NOT_FOUND'
	| 'DIRECT_REMINDER_ITEMS_INCOMPLETE'
	| 'DIRECT_REMINDER_MULTI_ITEM_UNAVAILABLE'
	| 'DIRECT_REMINDER_NO_CHANGE'
	| 'DIRECT_REMINDER_SYNTAX_INVALID';

export type DirectReminderErrorV1 = Error & {
	code: DirectReminderErrorCodeV1;
	collection?: DirectReminderCollectionV1;
};

export function parseDirectReminderArgvV1(
	operation: DirectReminderOperationV1,
	assignmentTokens: readonly string[],
	currentValue?: string,
): DirectReminderAstV1 {
	if (assignmentTokens.length !== 1) {
		throw directReminderError('DIRECT_REMINDER_ASSIGNMENT_REQUIRED');
	}
	let assignment: CompactCreateAssignmentV1;
	try {
		assignment = parseCompactArgvAssignmentV1(assignmentTokens[0]);
	} catch {
		throw directReminderError('DIRECT_REMINDER_SYNTAX_INVALID');
	}
	const collection = requireReminderCollection(assignment);
	if (assignment.value.includes(';')) {
		throw directReminderError('DIRECT_REMINDER_MULTI_ITEM_UNAVAILABLE', collection);
	}
	const canonicalValue = canonicalizeReminderValue(collection, assignment.value);
	if (operation === 'add') {
		if (currentValue !== undefined) {
			throw directReminderError('DIRECT_REMINDER_CURRENT_CONFLICT', collection);
		}
		return { operation, collection, value: canonicalValue };
	}
	if (operation === 'remove') {
		if (currentValue !== undefined) {
			throw directReminderError('DIRECT_REMINDER_CURRENT_CONFLICT', collection);
		}
		return { operation, collection, currentValue: canonicalValue };
	}
	if (currentValue === undefined || currentValue.trim().length === 0) {
		throw directReminderError('DIRECT_REMINDER_CURRENT_REQUIRED', collection);
	}
	if (currentValue.includes(';')) {
		throw directReminderError('DIRECT_REMINDER_MULTI_ITEM_UNAVAILABLE', collection);
	}
	return {
		operation,
		collection,
		currentValue: canonicalizeReminderValue(collection, currentValue),
		value: canonicalValue,
	};
}

export function compileDirectReminderIntentV1(options: {
	ast: DirectReminderAstV1;
	task: TaskContextV1;
}): GuidedMutationIntentV1 {
	const { ast, task } = options;
	const operonId = task.identity.operonId;
	if (!OPERON_ID_PATTERN_V1.test(operonId) || !task.identity.mutationAllowed) {
		throw directReminderError('DIRECT_REMINDER_INVALID_OPERON_ID', ast.collection);
	}
	let selected: ReminderItemReferenceV1 | undefined;
	if (ast.operation !== 'add') {
		if (!Array.isArray(task.reminderItems)) {
			throw directReminderError('DIRECT_REMINDER_ITEMS_INCOMPLETE', ast.collection);
		}
		const matches = task.reminderItems.filter(item => (
			item.collection === ast.collection
			&& canonicalizeHydratedValue(item) === ast.currentValue
		));
		if (matches.length === 0) {
			throw directReminderError('DIRECT_REMINDER_ITEM_NOT_FOUND', ast.collection);
		}
		if (matches.length > 1) {
			throw directReminderError('DIRECT_REMINDER_ITEM_AMBIGUOUS', ast.collection);
		}
		selected = matches[0];
		if (
			ast.operation === 'replace'
			&& canonicalizeHydratedValue(selected) === ast.value
		) {
			throw directReminderError('DIRECT_REMINDER_NO_CHANGE', ast.collection);
		}
	}
	return {
		contractVersion: 1,
		kind: 'mutation-intent',
		reason: `The user requested a direct human-readable Operon reminder ${ast.operation}.`,
		target: {
			operonId,
			locator: structuredClone(task.locator),
		},
		spec: {
			operation: ast.operation,
			collection: ast.collection,
			...(selected ? {
				itemId: selected.itemId,
				expectedValue: selected.expectedValue,
			} : {}),
			...(ast.value !== undefined ? { value: ast.value } : {}),
		},
	};
}

function requireReminderCollection(
	assignment: CompactCreateAssignmentV1,
): DirectReminderCollectionV1 {
	if (
		assignment.key !== 'reminderDatetimes'
		&& assignment.key !== 'reminderRules'
	) {
		throw directReminderError('DIRECT_REMINDER_INVALID_KEY');
	}
	return assignment.key;
}

function canonicalizeHydratedValue(item: ReminderItemReferenceV1): string | undefined {
	try {
		return canonicalizeReminderValue(item.collection, item.expectedValue);
	} catch {
		return undefined;
	}
}

function canonicalizeReminderValue(
	collection: DirectReminderCollectionV1,
	value: string,
): string {
	if (collection === 'reminderRules') {
		const parsed = parseReminderRule(value);
		if (parsed.ok) return parsed.value.canonical;
	} else {
		const parsed = parseAbsoluteReminder(value);
		if (parsed.ok) return parsed.value.localDatetime;
	}
	throw directReminderError('DIRECT_REMINDER_INVALID_VALUE', collection);
}

function directReminderError(
	code: DirectReminderErrorCodeV1,
	collection?: DirectReminderCollectionV1,
): DirectReminderErrorV1 {
	return Object.assign(new Error(code), { code, collection });
}
