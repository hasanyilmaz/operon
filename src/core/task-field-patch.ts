import { applyFieldRules } from './field-rules';
import { normalizeRepeatIdentityPayload } from './repeat-identity';
import { calculateRepeatEndFromCount, parseRepeatRule } from './repeat-rule';

export interface NormalizeTaskFieldPatchOptions {
	getAllRepeatSeriesIds?: () => Set<string>;
	getRepeatSkipDates?: (repeatSeriesId: string) => string[];
}

export interface ApplyTaskFieldPatchStateOptions extends NormalizeTaskFieldPatchOptions {
	currentFields: Record<string, string>;
	currentTags: string[];
	payload: Record<string, string | string[]>;
}

export interface AppliedTaskFieldPatchState {
	fieldValues: Record<string, string>;
	tags: string[];
}

export type DependencyFieldKey = 'blocking' | 'blockedBy';

export interface NormalizedDependencyPair {
	blocking: string;
	blockedBy: string;
}

export function splitTaskListValue(value: string | undefined): string[] {
	if (!value) return [];
	return value.split(';').map(item => item.trim()).filter(Boolean);
}

export function getOppositeDependencyFieldKey(fieldKey: DependencyFieldKey): DependencyFieldKey {
	return fieldKey === 'blocking' ? 'blockedBy' : 'blocking';
}

export function normalizeDependencyPair(
	fieldKey: DependencyFieldKey,
	fieldValue: string | string[],
	oppositeValue: string | string[],
): NormalizedDependencyPair {
	const nextIds = Array.from(new Set(
		(Array.isArray(fieldValue) ? fieldValue : splitTaskListValue(fieldValue))
			.map(value => value.trim())
			.filter(Boolean),
	));
	const oppositeIds = Array.from(new Set(
		(Array.isArray(oppositeValue) ? oppositeValue : splitTaskListValue(oppositeValue))
			.map(value => value.trim())
			.filter(Boolean),
	)).filter(id => !nextIds.includes(id));
	const nextValue = nextIds.join('; ');
	const nextOppositeValue = oppositeIds.join('; ');
	return fieldKey === 'blocking'
		? { blocking: nextValue, blockedBy: nextOppositeValue }
		: { blocking: nextOppositeValue, blockedBy: nextValue };
}

export function normalizeTaskFieldPatch(
	currentFields: Record<string, string>,
	payload: Record<string, string | string[]>,
	options: NormalizeTaskFieldPatchOptions = {},
): Record<string, string> {
	const normalizedPayload = applyFieldRules({
		current: currentFields,
		patch: Object.fromEntries(
			Object.entries(payload).map(([key, value]) => [key, Array.isArray(value) ? value.join('; ') : value]),
		),
		changedKeys: Object.keys(payload),
	}).patch;

	normalizeRepeatIdentityPayload(
		currentFields,
		normalizedPayload,
		options.getAllRepeatSeriesIds ?? (() => new Set<string>()),
	);

	const merged = {
		...currentFields,
		...normalizedPayload,
	};
	const derivedRepeatEnd = deriveCountModeRepeatEndFromFieldValues(
		merged,
		options.getRepeatSkipDates,
	);
	if (derivedRepeatEnd) {
		normalizedPayload['datetimeRepeatEnd'] = derivedRepeatEnd;
	} else if (parseRepeatRule(merged['repeat'])?.mode === 'count') {
		normalizedPayload['datetimeRepeatEnd'] = '';
	}

	return normalizedPayload;
}

export function applyTaskFieldPatchToState(
	options: ApplyTaskFieldPatchStateOptions,
): AppliedTaskFieldPatchState {
	const patch = normalizeTaskFieldPatch(options.currentFields, options.payload, options);
	const nextFieldValues = { ...options.currentFields };
	let nextTags = [...options.currentTags];

	for (const [key, rawValue] of Object.entries(patch)) {
		if (key === 'tags') {
			nextTags = splitTaskListValue(rawValue.replace(/^#/, ''))
				.map(tag => tag.replace(/^#/, '').trim())
				.filter(Boolean);
			continue;
		}

		const trimmed = rawValue.trim();
		if (!trimmed) {
			delete nextFieldValues[key];
			continue;
		}
		nextFieldValues[key] = trimmed;
	}

	return {
		fieldValues: nextFieldValues,
		tags: Array.from(new Set(nextTags)),
	};
}

export function deriveCountModeRepeatEndFromFieldValues(
	fieldValues: Record<string, string>,
	getRepeatSkipDates?: (repeatSeriesId: string) => string[],
): string {
	const rule = parseRepeatRule(fieldValues['repeat']);
	if (!rule || rule.mode !== 'count' || !rule.count) return '';
	const anchorDate = resolveCountRepeatAnchorDate(fieldValues);
	if (!anchorDate) return '';
	const repeatSeriesId = (fieldValues['repeatSeriesId'] ?? '').trim();
	const endDate = calculateRepeatEndFromCount(
		rule,
		anchorDate,
		rule.count,
		getRepeatSkipDates?.(repeatSeriesId) ?? [],
	);
	return endDate ? `${endDate}T23:59:59` : '';
}

function resolveCountRepeatAnchorDate(fieldValues: Record<string, string>): string {
	return normalizeDateOnly(fieldValues['repeatOccurrenceDate'])
		|| normalizeDateOnly(fieldValues['dateScheduled'])
		|| normalizeDateOnly(fieldValues['dateDue'])
		|| normalizeDateOnly(fieldValues['dateStarted'])
		|| normalizeDateOnly(fieldValues['datetimeStart'])
		|| normalizeDateOnly(fieldValues['datetimeEnd']);
}

function normalizeDateOnly(value: string | null | undefined): string {
	const trimmed = (value ?? '').trim();
	if (/^\d{4}-\d{2}-\d{2}$/u.test(trimmed)) return trimmed;
	if (/^\d{4}-\d{2}-\d{2}T/u.test(trimmed)) return trimmed.slice(0, 10);
	return '';
}
