import { parseLocalTimestamp } from '../../core/local-time';
import { parseListValue } from '../../core/parser';
import {
	buildWorkflowStatusIdentityIndex,
	type WorkflowStatusIdentityIndex,
} from '../../core/workflow-status-identity';
import type { IndexedTask } from '../../types/fields';
import { resolveWorkflowStatus } from '../../types/pipeline';
import type { OperonSettings } from '../../types/settings';
import type { TableColumn, TablePreset, TableSummaryFunction, TableSummaryRule } from '../../types/table';
import { formatTableSummaryNumber, formatTableTaskValueForDisplay, isTableDurationLikeTaskField } from './table-display';
import {
	getEffectiveTableTaskField,
	getTableTaskField,
	normalizeTableTaskFieldKey,
	type TableTaskField,
} from './table-field-catalog';
import { createTableTaskLookup, getTableTaskRawValue } from './table-value-adapter';
import {
	decodeTableFilePropertyColumnKey,
	type TableFilePropertyField,
	type TableFilePropertyValueState,
} from './table-file-property';

export interface TableSummaryCell {
	key: string;
	label: TableSummaryFunction;
	value: string;
	title: string;
	function: TableSummaryFunction;
}

export type TableSummaryFunctionGroup =
	| 'basic'
	| 'numeric-date'
	| 'task-state'
	| 'distribution';

export interface TableSummaryEvaluationInput {
	rows: readonly IndexedTask[];
	rules: readonly TableSummaryRule[];
	allTasks: readonly IndexedTask[];
	settings: TableSummarySettings;
	valueResolver?: TableSummaryValueResolver;
	workflowStatusIdentityIndex?: WorkflowStatusIdentityIndex;
}

export type TableSummarySettings = Pick<OperonSettings, 'keyMappings' | 'pipelines'>;

export interface TableSummaryValueResolver {
	readonly workflowStatusIdentityIndex?: WorkflowStatusIdentityIndex;
	getRawValue(task: IndexedTask, key: string): string;
	getFilePropertyField?(key: string): TableFilePropertyField | null;
	getFilePropertyValueState?(task: IndexedTask, key: string): TableFilePropertyValueState | null;
}

const ANY_FIELD_SUMMARIES: TableSummaryFunction[] = ['Count', 'Filled', 'Empty', 'Unique'];
const NUMBER_SUMMARIES: TableSummaryFunction[] = ['Sum', 'Average', 'Median', 'Min', 'Max', 'Range', 'Stddev'];
const DATE_SUMMARIES: TableSummaryFunction[] = ['Earliest', 'Latest'];
const TASK_STATE_SUMMARIES: TableSummaryFunction[] = ['OpenCount', 'FinishedCount', 'CancelledCount', 'TerminalCount', 'CompletionRate'];
const TOP_VALUE_SUMMARIES: TableSummaryFunction[] = ['TopValues'];
const LIST_SUMMARIES: TableSummaryFunction[] = ['ListItemCount'];

function resolveTableSummaryIdentityIndex(
	functions: readonly TableSummaryFunction[],
	settings: TableSummarySettings,
	existing: WorkflowStatusIdentityIndex | undefined,
): WorkflowStatusIdentityIndex | undefined {
	if (!functions.some(summaryFunction => TASK_STATE_SUMMARIES.includes(summaryFunction))) return undefined;
	return existing ?? buildWorkflowStatusIdentityIndex(settings.pipelines);
}

export const TABLE_SUMMARY_DEFERRED_REFRESH_DELAY_MS = 75;

export function getTableSummaryIdleDelayMs(_rowCount: number): number {
	return TABLE_SUMMARY_DEFERRED_REFRESH_DELAY_MS;
}

export function evaluateTableSummaries(input: TableSummaryEvaluationInput): Map<string, TableSummaryCell> {
	const result = new Map<string, TableSummaryCell>();
	const rules = filterCompatibleTableSummaryRules(input.rules, input.settings, input.valueResolver);
	const workflowStatusIdentityIndex = resolveTableSummaryIdentityIndex(
		rules.map(rule => rule.function),
		input.settings,
		input.workflowStatusIdentityIndex ?? input.valueResolver?.workflowStatusIdentityIndex,
	);
	for (const rule of rules) {
		const cell = evaluateTableSummaryCell({
			rows: input.rows,
			rule,
			allTasks: input.allTasks,
			settings: input.settings,
			valueResolver: input.valueResolver,
			workflowStatusIdentityIndex,
		});
		if (cell) result.set(getTableSummaryCellKey(rule.key), cell);
	}
	return result;
}

export function evaluateTableSummaryCell(input: {
	rows: readonly IndexedTask[];
	rule: TableSummaryRule;
	allTasks: readonly IndexedTask[];
	settings: TableSummarySettings;
	valueResolver?: TableSummaryValueResolver;
	workflowStatusIdentityIndex?: WorkflowStatusIdentityIndex;
}): TableSummaryCell | null {
	const key = resolveTableSummaryFieldKey(input.rule.key, input.settings);
	const filePropertyField = key ? input.valueResolver?.getFilePropertyField?.(key) ?? null : null;
	if (!key || !getTableSummaryFunctionsForField(
		key,
		input.settings,
		filePropertyField ? [filePropertyField] : [],
	).includes(input.rule.function)) return null;
	const workflowStatusIdentityIndex = resolveTableSummaryIdentityIndex(
		[input.rule.function],
		input.settings,
		input.workflowStatusIdentityIndex ?? input.valueResolver?.workflowStatusIdentityIndex,
	);
	const context: SummaryCalculationContext = {
		rows: input.rows,
		allTasks: input.allTasks,
		key,
		settings: input.settings,
		workflowStatusIdentityIndex,
	};
	const typedStates = filePropertyField && input.valueResolver?.getFilePropertyValueState
		? input.rows.map(row => input.valueResolver?.getFilePropertyValueState?.(row, key) ?? { kind: 'unsupported', value: undefined } as const)
		: null;
	const values = typedStates
		? []
		: input.rows.map(row => (input.valueResolver?.getRawValue(row, key) ?? getTableTaskRawValue(row, key)).trim());
	const value = typedStates
		? calculateFilePropertySummaryValue(typedStates, input.rule.function, context, filePropertyField)
		: calculateSummaryValue(values, input.rule.function, context);
	const titleValue = typedStates
		? calculateFilePropertySummaryTitleValue(typedStates, input.rule.function, context, filePropertyField)
		: calculateSummaryTitleValue(values, input.rule.function, context) || value || '--';
	const resolvedTitleValue = titleValue || value || '--';
	return {
		key: getTableSummaryCellKey(key),
		label: input.rule.function,
		value,
		title: `${input.rule.function}: ${resolvedTitleValue}`,
		function: input.rule.function,
	};
}

export interface TableSummaryPickerValueCache {
	/** undefined = not evaluated yet; null = function not applicable to the field. */
	get(summaryFunction: TableSummaryFunction): TableSummaryCell | null | undefined;
	hasPending(): boolean;
	/** Evaluates pending functions until the budget is spent; returns what finished. */
	evaluatePending(budgetMs: number, now?: () => number): TableSummaryFunction[];
}

// The summary picker shows one aggregate per candidate function over every table row.
// Evaluating all of them synchronously on open — and again on each filter keystroke —
// freezes large vaults, so each value is computed once, lazily, inside a time budget,
// and keystrokes only re-read the memo.
export function createTableSummaryPickerValueCache(input: {
	fieldKey: string;
	functions: readonly TableSummaryFunction[];
	rows: readonly IndexedTask[];
	allTasks: readonly IndexedTask[];
	settings: TableSummarySettings;
	valueResolver?: TableSummaryValueResolver;
}): TableSummaryPickerValueCache {
	const cells = new Map<TableSummaryFunction, TableSummaryCell | null>();
	const pending = [...input.functions];
	const workflowStatusIdentityIndex = resolveTableSummaryIdentityIndex(
		input.functions,
		input.settings,
		input.valueResolver?.workflowStatusIdentityIndex,
	);
	return {
		get: summaryFunction => (cells.has(summaryFunction) ? cells.get(summaryFunction) : undefined),
		hasPending: () => pending.length > 0,
		evaluatePending(budgetMs, now = () => Date.now()) {
			const startedAt = now();
			const completed: TableSummaryFunction[] = [];
			while (pending.length > 0) {
				const summaryFunction = pending.shift();
				if (summaryFunction === undefined) break;
				cells.set(summaryFunction, evaluateTableSummaryCell({
					rows: input.rows,
					rule: { key: input.fieldKey, function: summaryFunction },
					allTasks: input.allTasks,
					settings: input.settings,
					workflowStatusIdentityIndex,
					...(input.valueResolver ? { valueResolver: input.valueResolver } : {}),
				}));
				completed.push(summaryFunction);
				if (now() - startedAt >= budgetMs) break;
			}
			return completed;
		},
	};
}

export function normalizeTableSummaryRules(
	rules: readonly TableSummaryRule[],
	settings: Pick<OperonSettings, 'keyMappings'>,
): TableSummaryRule[] {
	const normalized: TableSummaryRule[] = [];
	const seen = new Set<string>();
	for (const rule of rules) {
		const key = resolveTableSummaryFieldKey(rule.key, settings);
		if (!key || seen.has(key)) continue;
		seen.add(key);
		normalized.push({ key, function: rule.function });
	}
	return normalized;
}

export function filterCompatibleTableSummaryRules(
	rules: readonly TableSummaryRule[],
	settings: Pick<OperonSettings, 'keyMappings'>,
	valueResolver?: Pick<TableSummaryValueResolver, 'getFilePropertyField'>,
): TableSummaryRule[] {
	const compatible: TableSummaryRule[] = [];
	const seen = new Set<string>();
	for (const rule of rules) {
		const key = resolveTableSummaryFieldKey(rule.key, settings);
		if (!key || seen.has(key)) continue;
		const filePropertyField = valueResolver?.getFilePropertyField?.(key) ?? null;
		if (decodeTableFilePropertyColumnKey(key) && !filePropertyField) continue;
		if (!getTableSummaryFunctionsForField(
			key,
			settings,
			filePropertyField ? [filePropertyField] : [],
		).includes(rule.function)) continue;
		seen.add(key);
		compatible.push({ key, function: rule.function });
	}
	return compatible;
}

export function getTableSummaryCellKey(key: string): string {
	return key;
}

export function getTableSummaryFunctionsForField(
	key: string,
	settings: Pick<OperonSettings, 'keyMappings'>,
	additionalFields: readonly TableTaskField[] = [],
): TableSummaryFunction[] {
	const field = getEffectiveTableTaskField(key, settings, additionalFields);
	if (!field) return [];
	const stateSummaries = isTaskStateField(key) ? TASK_STATE_SUMMARIES : [];
	const listSummaries = field.type === 'list' || field.type === 'tags' ? LIST_SUMMARIES : [];
	if (field.type === 'number') return [...ANY_FIELD_SUMMARIES, ...NUMBER_SUMMARIES, ...TOP_VALUE_SUMMARIES];
	if (field.type === 'date' || field.type === 'datetime') return [...ANY_FIELD_SUMMARIES, ...DATE_SUMMARIES, ...TOP_VALUE_SUMMARIES];
	return [...ANY_FIELD_SUMMARIES, ...stateSummaries, ...TOP_VALUE_SUMMARIES, ...listSummaries];
}

function resolveTableSummaryFieldKey(
	value: string | null | undefined,
	settings: Pick<OperonSettings, 'keyMappings'>,
): string | null {
	const raw = value?.trim();
	if (!raw) return null;
	return decodeTableFilePropertyColumnKey(raw) ? raw : normalizeTableTaskFieldKey(raw, settings);
}

export function getTableSummaryFunctionGroup(summaryFunction: TableSummaryFunction): TableSummaryFunctionGroup {
	if (ANY_FIELD_SUMMARIES.includes(summaryFunction)) return 'basic';
	if (NUMBER_SUMMARIES.includes(summaryFunction) || DATE_SUMMARIES.includes(summaryFunction)) return 'numeric-date';
	if (TASK_STATE_SUMMARIES.includes(summaryFunction)) return 'task-state';
	return 'distribution';
}

export function getTablePresetSummaryFunction(
	column: TableColumn,
	settings: Pick<OperonSettings, 'keyMappings'>,
): TableSummaryFunction | null {
	if (column.key === 'status') return 'CompletionRate';
	if (column.key === 'priority' || column.key === 'contexts' || column.key === 'tags') return 'TopValues';
	if (isTableDurationLikeTaskField(column.key, settings)) return 'Sum';
	if (column.key === 'dateDue' || column.key === 'dateStarted' || column.key === 'datetimeStart') return 'Earliest';
	if (column.key === 'dateScheduled' || column.key === 'dateCompleted' || column.key === 'dateCancelled' || column.key === 'datetimeEnd') return 'Latest';
	return null;
}

export function applyTableSummaryPreset(
	preset: TablePreset,
	columns: readonly TableColumn[],
	settings: Pick<OperonSettings, 'keyMappings'>,
): TablePreset {
	const summaries: TableSummaryRule[] = [];
	const seen = new Set<string>();
	for (const column of columns) {
		const summaryFunction = getTablePresetSummaryFunction(column, settings);
		if (!summaryFunction || seen.has(column.key)) continue;
		seen.add(column.key);
		summaries.push({ key: column.key, function: summaryFunction });
	}
	return { ...preset, summaries };
}

interface SummaryCalculationContext {
	rows: readonly IndexedTask[];
	allTasks: readonly IndexedTask[];
	key: string;
	settings: TableSummarySettings;
	workflowStatusIdentityIndex?: WorkflowStatusIdentityIndex;
}

function calculateFilePropertySummaryValue(
	states: readonly TableFilePropertyValueState[],
	summaryFunction: TableSummaryFunction,
	context: SummaryCalculationContext,
	field: TableFilePropertyField | null,
): string {
	if (!field) return '';
	const validStates = states.filter((state): state is Extract<TableFilePropertyValueState, { kind: 'valid' }> => (
		state.kind === 'valid'
	));
	switch (summaryFunction) {
		case 'Count':
			return formatInteger(states.length);
		case 'Filled':
			return formatInteger(states.filter(state => state.kind !== 'empty').length);
		case 'Empty':
			return formatInteger(states.filter(state => state.kind === 'empty').length);
		case 'Unique':
			return formatInteger(new Set(validStates.map(state => stableFilePropertySummaryIdentity(state.value))).size);
		case 'Sum':
			return formatFilePropertyNumericSummary(validStates, numbers => numbers.reduce((sum, value) => sum + value, 0), context);
		case 'Average':
			return formatFilePropertyNumericSummary(
				validStates,
				numbers => numbers.reduce((sum, value) => sum + value, 0) / numbers.length,
				context,
			);
		case 'Median':
			return formatFilePropertyNumericSummary(validStates, numbers => {
				const sorted = [...numbers].sort((left, right) => left - right);
				const middle = Math.floor(sorted.length / 2);
				return sorted.length % 2 === 0
					? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
					: sorted[middle] ?? 0;
			}, context);
		case 'Min':
			return formatFilePropertyNumericSummary(validStates, numbers => Math.min(...numbers), context);
		case 'Max':
			return formatFilePropertyNumericSummary(validStates, numbers => Math.max(...numbers), context);
		case 'Range':
			return formatFilePropertyNumericSummary(validStates, numbers => Math.max(...numbers) - Math.min(...numbers), context);
		case 'Stddev':
			return formatFilePropertyNumericSummary(validStates, numbers => {
				const average = numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
				const variance = numbers.reduce((sum, value) => sum + ((value - average) ** 2), 0) / numbers.length;
				return Math.sqrt(variance);
			}, context);
		case 'Earliest':
			return formatFilePropertyDateSummary(validStates, Math.min);
		case 'Latest':
			return formatFilePropertyDateSummary(validStates, Math.max);
		case 'TopValues':
			return formatFilePropertyTopValues(validStates, field, 3);
		case 'ListItemCount':
			return field.type === 'list' || field.type === 'tags'
				? formatInteger(collectFilePropertyListItems(validStates).length)
				: '';
		case 'OpenCount':
		case 'FinishedCount':
		case 'CancelledCount':
		case 'TerminalCount':
		case 'CompletionRate':
			return '';
	}
}

function calculateFilePropertySummaryTitleValue(
	states: readonly TableFilePropertyValueState[],
	summaryFunction: TableSummaryFunction,
	_context: SummaryCalculationContext,
	field: TableFilePropertyField | null,
): string {
	if (summaryFunction !== 'TopValues' || !field) return '';
	const validStates = states.filter((state): state is Extract<TableFilePropertyValueState, { kind: 'valid' }> => (
		state.kind === 'valid'
	));
	return formatFilePropertyTopValues(validStates, field, null);
}

function formatFilePropertyNumericSummary(
	states: readonly Extract<TableFilePropertyValueState, { kind: 'valid' }>[],
	calculate: (numbers: readonly number[]) => number,
	context: SummaryCalculationContext,
): string {
	const numbers = states
		.map(state => state.value)
		.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
	return numbers.length > 0 ? formatSummaryNumber(calculate(numbers), context) : '';
}

function formatFilePropertyDateSummary(
	states: readonly Extract<TableFilePropertyValueState, { kind: 'valid' }>[],
	calculate: (...values: number[]) => number,
): string {
	const dates = states.flatMap(state => {
		if (typeof state.value !== 'string') return [];
		const value = state.value.trim();
		const time = parseLocalTimestamp(value);
		return time === null ? [] : [{ time, value }];
	});
	if (dates.length === 0) return '';
	const selectedTime = calculate(...dates.map(date => date.time));
	return dates.find(date => date.time === selectedTime)?.value ?? '';
}

function formatFilePropertyTopValues(
	states: readonly Extract<TableFilePropertyValueState, { kind: 'valid' }>[],
	field: TableFilePropertyField,
	limit: number | null,
): string {
	const values = field.type === 'list' || field.type === 'tags'
		? collectFilePropertyListItems(states)
		: states.flatMap(state => Array.isArray(state.value) ? [] : [state.value]);
	const counts = new Map<string, { label: string; count: number }>();
	for (const value of values) {
		if (value === null) continue;
		const label = typeof value === 'string' ? value.trim() : String(value);
		if (!label) continue;
		const key = `${typeof value}:${label.toLocaleLowerCase()}`;
		const existing = counts.get(key);
		if (existing) existing.count += 1;
		else counts.set(key, { label, count: 1 });
	}
	return formatTopValueEntries(
		[...counts.values()].sort((left, right) => right.count - left.count || left.label.localeCompare(right.label)),
		limit,
	);
}

function collectFilePropertyListItems(
	states: readonly Extract<TableFilePropertyValueState, { kind: 'valid' }>[],
): Array<string | number | boolean> {
	return states.flatMap(state => (
		Array.isArray(state.value)
			? state.value.filter((item): item is string | number | boolean => (
				item !== null && (typeof item !== 'string' || item.trim().length > 0)
			))
			: []
	));
}

function stableFilePropertySummaryIdentity(value: unknown): string {
	if (Array.isArray(value)) {
		const items: unknown[] = value;
		return `array:${JSON.stringify(items.map(item => (
			typeof item === 'string' ? item.trim().toLocaleLowerCase() : item
		)))}`;
	}
	if (typeof value === 'string') return `string:${value.trim().toLocaleLowerCase()}`;
	return `${typeof value}:${String(value)}`;
}

function calculateSummaryValue(
	values: readonly string[],
	summaryFunction: TableSummaryFunction,
	context: SummaryCalculationContext,
): string {
	switch (summaryFunction) {
		case 'Count':
			return formatInteger(values.length);
		case 'Filled':
			return formatInteger(values.filter(isFilledValue).length);
		case 'Empty':
			return formatInteger(values.filter(value => !isFilledValue(value)).length);
		case 'Unique':
			return formatInteger(new Set(values.filter(isFilledValue).map(normalizeComparableValue)).size);
		case 'Sum':
			return formatNumericSummary(values, numbers => numbers.reduce((sum, value) => sum + value, 0), context);
		case 'Average': {
			const numbers = collectNumbers(values);
			if (numbers.length === 0) return '';
			return formatSummaryNumber(numbers.reduce((sum, value) => sum + value, 0) / numbers.length, context);
		}
		case 'Median': {
			const numbers = collectNumbers(values).sort((left, right) => left - right);
			if (numbers.length === 0) return '';
			const middle = Math.floor(numbers.length / 2);
			const median = numbers.length % 2 === 0
				? ((numbers[middle - 1] ?? 0) + (numbers[middle] ?? 0)) / 2
				: numbers[middle] ?? 0;
			return formatSummaryNumber(median, context);
		}
		case 'Min': {
			const numbers = collectNumbers(values);
			return numbers.length > 0 ? formatSummaryNumber(Math.min(...numbers), context) : '';
		}
		case 'Max': {
			const numbers = collectNumbers(values);
			return numbers.length > 0 ? formatSummaryNumber(Math.max(...numbers), context) : '';
		}
		case 'Range': {
			const numbers = collectNumbers(values);
			return numbers.length > 0 ? formatSummaryNumber(Math.max(...numbers) - Math.min(...numbers), context) : '';
		}
		case 'Stddev': {
			const numbers = collectNumbers(values);
			if (numbers.length === 0) return '';
			const average = numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
			const variance = numbers.reduce((sum, value) => sum + ((value - average) ** 2), 0) / numbers.length;
			return formatSummaryNumber(Math.sqrt(variance), context);
		}
		case 'Earliest': {
			const dates = collectDates(values);
			return dates.length > 0 ? formatDateSummary(Math.min(...dates.map(date => date.time)), dates) : '';
		}
		case 'Latest': {
			const dates = collectDates(values);
			return dates.length > 0 ? formatDateSummary(Math.max(...dates.map(date => date.time)), dates) : '';
		}
		case 'OpenCount':
			return formatInteger(getTaskStateCounts(context.rows, context.settings, context.workflowStatusIdentityIndex).open);
		case 'FinishedCount':
			return formatInteger(getTaskStateCounts(context.rows, context.settings, context.workflowStatusIdentityIndex).finished);
		case 'CancelledCount':
			return formatInteger(getTaskStateCounts(context.rows, context.settings, context.workflowStatusIdentityIndex).cancelled);
		case 'TerminalCount': {
			const counts = getTaskStateCounts(context.rows, context.settings, context.workflowStatusIdentityIndex);
			return formatInteger(counts.finished + counts.cancelled);
		}
		case 'CompletionRate':
			return formatCompletionRate(getTaskStateCounts(context.rows, context.settings, context.workflowStatusIdentityIndex));
		case 'TopValues':
			return formatTopValues(values, context);
		case 'ListItemCount':
			return isListSummaryField(context.key, context.settings)
				? formatInteger(collectListItems(values).length)
				: '';
	}
}

function calculateSummaryTitleValue(
	values: readonly string[],
	summaryFunction: TableSummaryFunction,
	context: SummaryCalculationContext,
): string {
	if (summaryFunction !== 'TopValues') return '';
	return formatTopValues(values, context, null);
}

function formatNumericSummary(
	values: readonly string[],
	calculate: (numbers: readonly number[]) => number,
	context: SummaryCalculationContext,
): string {
	const numbers = collectNumbers(values);
	return numbers.length > 0 ? formatSummaryNumber(calculate(numbers), context) : '';
}

function formatSummaryNumber(value: number, context: SummaryCalculationContext): string {
	return formatTableSummaryNumber(context.key, value, { settings: context.settings }, formatNumber);
}

function formatTopValues(
	values: readonly string[],
	context: SummaryCalculationContext,
	limit: number | null = 3,
): string {
	return formatTopValueEntries(
		collectTopValueEntries(values, isListSummaryField(context.key, context.settings), context),
		limit,
	);
}

function collectTopValueEntries(
	values: readonly string[],
	listMode: boolean,
	context: SummaryCalculationContext,
): Array<{ label: string; count: number }> {
	const rawItems = listMode ? collectListItems(values) : values.map(value => value.trim()).filter(isFilledValue);
	const taskLookup = createTableTaskLookup(context.allTasks);
	const counts = new Map<string, { label: string; count: number }>();
	for (const item of rawItems) {
		const displayItem = formatTableTaskValueForDisplay(context.key, item, { settings: context.settings, taskLookup }).trim();
		const key = normalizeComparableValue(displayItem);
		if (!key) continue;
		const existing = counts.get(key);
		if (existing) {
			existing.count += 1;
		} else {
			counts.set(key, { label: displayItem, count: 1 });
		}
	}
	return [...counts.values()].sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function formatTopValueEntries(entries: readonly { label: string; count: number }[], limit: number | null): string {
	const visibleEntries = limit === null ? entries : entries.slice(0, limit);
	return visibleEntries
		.map(entry => `${entry.label}: ${formatInteger(entry.count)}`)
		.join(', ');
}

interface TaskStateCounts {
	open: number;
	finished: number;
	cancelled: number;
}

function getTaskStateCounts(
	rows: readonly IndexedTask[],
	settings: TableSummarySettings,
	workflowStatusIdentityIndex = buildWorkflowStatusIdentityIndex(settings.pipelines),
): TaskStateCounts {
	const counts: TaskStateCounts = {
		open: 0,
		finished: 0,
		cancelled: 0,
	};
	for (const row of rows) {
		const state = resolveTaskSummaryState(row, settings, workflowStatusIdentityIndex);
		counts[state] += 1;
	}
	return counts;
}

function resolveTaskSummaryState(
	row: IndexedTask,
	settings: TableSummarySettings,
	workflowStatusIdentityIndex: WorkflowStatusIdentityIndex,
): keyof TaskStateCounts {
	const workflow = resolveWorkflowStatus(settings.pipelines, row.fieldValues['status'], workflowStatusIdentityIndex);
	if (workflow?.definition.isFinished === true) return 'finished';
	if (workflow?.definition.isCancelled === true) return 'cancelled';
	if (workflow) return 'open';
	if (row.checkbox === 'done') return 'finished';
	if (row.checkbox === 'cancelled') return 'cancelled';
	return 'open';
}

function formatCompletionRate(counts: TaskStateCounts): string {
	const actionable = counts.open + counts.finished;
	if (actionable === 0) return '';
	return `${formatNumber((counts.finished / actionable) * 100)}%`;
}

function isTaskStateField(key: string): boolean {
	return key === 'status' || key === 'checkbox';
}

function isListSummaryField(key: string, settings: Pick<OperonSettings, 'keyMappings'>): boolean {
	const field = getTableTaskField(key, settings);
	return field?.type === 'list' || field?.type === 'tags';
}

function collectListItems(values: readonly string[]): string[] {
	return values
		.flatMap(value => parseListValue(value))
		.map(value => value.trim())
		.filter(isFilledValue);
}

function collectNumbers(values: readonly string[]): number[] {
	return values
		.map(value => value.trim())
		.filter(value => value.length > 0)
		.map(value => Number(value))
		.filter(Number.isFinite);
}

function collectDates(values: readonly string[]): Array<{ time: number; value: string }> {
	return values
		.map(value => {
			const trimmed = value.trim();
			const time = parseLocalTimestamp(trimmed);
			if (time === null) return null;
			return { time, value: trimmed };
		})
		.filter((value): value is { time: number; value: string } => value !== null);
}

function formatDateSummary(time: number, dates: readonly { time: number; value: string }[]): string {
	return dates.find(date => date.time === time)?.value ?? '';
}

function isFilledValue(value: string): boolean {
	return value.trim().length > 0;
}

function normalizeComparableValue(value: string): string {
	return value.trim().toLocaleLowerCase();
}

function formatInteger(value: number): string {
	return value.toLocaleString();
}

function formatNumber(value: number): string {
	if (!Number.isFinite(value)) return '';
	return Number.isInteger(value)
		? value.toLocaleString()
		: value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
