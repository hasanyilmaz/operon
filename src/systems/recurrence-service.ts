import { App, TFile } from 'obsidian';
import { OperonIndexer } from '../indexer/indexer';
import { TaskWriter } from '../core/task-writer';
import { OperonStorage } from '../storage/operon-storage';
import { IndexedTask, OperonField, ParsedTask } from '../types/fields';
import { KeyMapping, OperonSettings } from '../types/settings';
import { CANONICAL_KEY_MAP, TASK_STATS_CANONICAL_KEYS } from '../types/keys';
import { parseTaskLine } from '../core/parser';
import { serializeTask } from '../core/serializer';
import { generateOperonId } from '../core/id-generator';
import { t } from '../core/i18n';
import { localNow } from '../core/local-time';
import { extractDatePart } from '../core/scheduling-rules';
import {
	RepeatRule,
	calculateNextRepeatDate,
	calculateRepeatEndFromCount,
	formatRepeatRuleSummary,
	parseRepeatRule,
	serializeRepeatRule,
} from '../core/repeat-rule';
import { InlineRepeatCompletionMode, RepeatSeriesEntry, RepeatTemporalTemplate } from '../storage/repeat-series-store';
import { resolveFileTaskDefaults } from '../core/file-task-defaults';
import {
	applyRawYamlValueRemovals,
	buildMergedFileTaskDraft,
	ParsedFrontmatterDocument,
	parseFrontmatterDocument,
} from '../core/file-task-template-merge';
import { composeStatusValue, parseStatusValue, Pipeline } from '../types/pipeline';
import {
	buildWorkflowStatusIdentityIndex,
	resolveConfiguredPipelineNameIdentity,
	resolveWorkflowPipelineIdentity,
} from '../core/workflow-status-identity';
import {
	deriveTemporalTemplateFromTaskAtOccurrence,
	getTaskRepeatOccurrenceDate,
	resolveOccurrencePlan,
} from './recurrence-domain';
import {
	detectRepeatSeriesNamingConfig,
	RepeatSeriesNamingConfig,
	renderCompletedPlainArchiveTitle,
	renderRepeatSeriesTitle,
	resolveRecurringFileDisplayDate,
	resolveLatestRepeatSeriesNamingConfig,
} from './recurring-file-naming';

const COPIED_FIELDS = new Set([
	'repeat',
	'repeatSeriesId',
	'datetimeRepeatEnd',
	'priority',
	'dateStarted',
	'dateDue',
	'assignees',
	'contexts',
	'estimate',
	'datetimeStart',
	'datetimeEnd',
	'note',
	'taskIcon',
	'taskColor',
	'parentTask',
]);

const RESET_FIELDS = new Set([
	'dateCompleted',
	'dateCancelled',
	'duration',
	'trackers',
	'activeTracker',
	'progress',
	...TASK_STATS_CANONICAL_KEYS,
	'totalEstimate',
	'totalDuration',
	'blocking',
	'blockedBy',
]);

const BODY_CLONE_RESET_FIELDS = new Set([
	...RESET_FIELDS,
	'repeat',
	'repeatSeriesId',
	'datetimeRepeatEnd',
]);

const FILE_REPEAT_PROTECTED_CLEAR_CANONICAL_FIELDS = new Set([
	'operonId',
	'datetimeCreated',
	'dateScheduled',
	'datetimeModified',
	'repeatSeriesId',
	'repeatOccurrenceDate',
	'status',
	'repeat',
	'datetimeRepeatEnd',
	'dateStarted',
	'dateDue',
	'datetimeStart',
	'datetimeEnd',
]);

const USER_DATE_FIELDS = new Set([
	'dateScheduled',
	'dateStarted',
	'dateDue',
	'dateCompleted',
	'dateCancelled',
	'datetimeStart',
	'datetimeEnd',
	'datetimeRepeatEnd',
]);

export interface RecurrenceMaterializationResult {
	created: boolean;
	reason:
		| 'created'
		| 'not-recurring'
		| 'invalid-rule'
		| 'missing-anchor'
		| 'ended'
		| 'unsupported'
		| 'source-missing';
	seriesId?: string;
	nextDate?: string;
	createdTaskId?: string;
	createdFilePath?: string;
	materializationMode?: InlineOccurrenceMaterializationMode;
	summary?: string;
}

export type InlineOccurrenceMaterializationMode = 'inserted' | 'replaced';

interface InlineOccurrenceMaterializationResult {
	taskId: string;
	mode: InlineOccurrenceMaterializationMode;
}

export interface InlineOccurrenceLineMaterializationOptions {
	replaceCompleted: boolean;
	newOccurrencePosition: 'above' | 'below';
}

export interface InlineOccurrenceLineMaterializationResult {
	lines: string[];
	mode: InlineOccurrenceMaterializationMode;
}

export function materializeInlineOccurrenceLines(
	lines: string[],
	sourceLineIndex: number,
	newOccurrenceLine: string,
	options: InlineOccurrenceLineMaterializationOptions,
): InlineOccurrenceLineMaterializationResult {
	const nextLines = [...lines];
	if (options.replaceCompleted) {
		nextLines.splice(sourceLineIndex, 1, newOccurrenceLine);
		return { lines: nextLines, mode: 'replaced' };
	}
	const insertIndex = options.newOccurrencePosition === 'above'
		? sourceLineIndex
		: sourceLineIndex + 1;
	nextLines.splice(insertIndex, 0, newOccurrenceLine);
	return { lines: nextLines, mode: 'inserted' };
}

interface PlannedOccurrence {
	rule: RepeatRule;
	seriesId: string;
	nextDate: string;
	nextOccurrenceDate: string;
	temporalTemplate: RepeatTemporalTemplate;
	fieldValues: Record<string, string>;
	description: string;
	tags: string[];
	timePrefix: string | null;
	sourceTask: IndexedTask;
	baseTitle: string | null;
	naming: RepeatSeriesNamingConfig | null;
	inlineCompletionMode: InlineRepeatCompletionMode;
}

export type RecurringBodyTaskKind = 'owned-subtask' | 'foreign-operon-task' | 'plain-content';

export interface RecurringBodyTransformResult {
	body: string;
	clonedSubtaskCount: number;
	removedForeignTaskCount: number;
}

export interface RecurringFileBodyTransformOptions {
	sourceBody: string;
	sourceFilePath: string;
	oldRootOperonId: string;
	newRootOperonId: string;
	oldRootFieldValues: Record<string, string>;
	newRootFieldValues: Record<string, string>;
	rootSeriesId: string;
	keyMappings: KeyMapping[];
	pipelines: Pipeline[];
	defaultPipelineName: string;
	now: string;
	generateOperonId?: () => string;
}

interface RecurringBodyTransformLinesResult {
	lines: string[];
	clonedSubtaskCount: number;
	removedForeignTaskCount: number;
}

function getTaskFieldValue(task: ParsedTask, key: string): string {
	return task.fields.find(field => field.key === key)?.value ?? '';
}

function getTaskSourceKeyMap(task: ParsedTask): Map<string, string> {
	return new Map(task.fields.map(field => [field.key, field.sourceKey]));
}

function isFenceDelimiter(line: string): boolean {
	return /^\s*```/.test(line) || /^\s*~~~/.test(line);
}

function isOperonInlineTask(parsed: ParsedTask | null): parsed is ParsedTask {
	return !!parsed && (!!parsed.operonId || parsed.fields.length > 0);
}

function getLineIndentWidth(line: string): number {
	const match = line.match(/^\s*/u);
	return match?.[0].length ?? 0;
}

function collectIndentedSubtree(lines: string[], startIndex: number, parentIndent: number): { lines: string[]; nextIndex: number } {
	let end = startIndex;
	while (end < lines.length) {
		const current = lines[end];
		if (!current.trim()) {
			end += 1;
			continue;
		}
		if (getLineIndentWidth(current) <= parentIndent) break;
		end += 1;
	}
	return {
		lines: lines.slice(startIndex, end),
		nextIndex: end,
	};
}

function resetPlainMarkdownCheckboxes(line: string): string {
	return line.replace(/^(\s*- \[)([xX-])(\])/u, '$1 $3');
}

function normalizeDateOnly(value: string | null | undefined): string {
	const trimmed = (value ?? '').trim();
	if (/^\d{4}-\d{2}-\d{2}$/u.test(trimmed)) return trimmed;
	if (/^\d{4}-\d{2}-\d{2}T/u.test(trimmed)) return trimmed.slice(0, 10);
	return '';
}

function dateToUtcDay(value: string): number {
	const [year, month, day] = value.split('-').map(Number);
	return Math.trunc(Date.UTC(year, month - 1, day) / 86400000);
}

function addDaysToDate(value: string, deltaDays: number): string {
	const [year, month, day] = value.split('-').map(Number);
	const date = new Date(Date.UTC(year, month - 1, day + deltaDays));
	const yyyy = date.getUTCFullYear();
	const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
	const dd = String(date.getUTCDate()).padStart(2, '0');
	return `${yyyy}-${mm}-${dd}`;
}

function resolveRootOccurrenceAnchor(fieldValues: Record<string, string>): string {
	return normalizeDateOnly(fieldValues['repeatOccurrenceDate'])
		|| normalizeDateOnly(fieldValues['dateScheduled'])
		|| normalizeDateOnly(fieldValues['dateDue'])
		|| normalizeDateOnly(fieldValues['dateStarted'])
		|| normalizeDateOnly(fieldValues['datetimeStart'])
		|| normalizeDateOnly(fieldValues['datetimeEnd']);
}

function resolveMaterializationSourceAnchor(rule: RepeatRule, fieldValues: Record<string, string>): string {
	if (rule.mode === 'done') {
		return normalizeDateOnly(fieldValues['repeatOccurrenceDate'])
			|| normalizeDateOnly(fieldValues['dateScheduled']);
	}
	return resolveRootOccurrenceAnchor(fieldValues);
}

function resolveMaterializationTemporalAnchor(rule: RepeatRule, fieldValues: Record<string, string>): string {
	if (rule.mode === 'done') {
		return normalizeDateOnly(fieldValues['repeatOccurrenceDate'])
			|| normalizeDateOnly(fieldValues['dateScheduled'])
			|| normalizeDateOnly(fieldValues['dateStarted'])
			|| normalizeDateOnly(fieldValues['dateDue'])
			|| normalizeDateOnly(fieldValues['datetimeStart'])
			|| normalizeDateOnly(fieldValues['datetimeEnd']);
	}
	return resolveMaterializationSourceAnchor(rule, fieldValues);
}

function shiftDateByRootOccurrenceDelta(
	oldRootFieldValues: Record<string, string>,
	oldChildDate: string | null | undefined,
	newRootFieldValues: Record<string, string>,
): string {
	const oldRoot = resolveRootOccurrenceAnchor(oldRootFieldValues);
	const oldChild = normalizeDateOnly(oldChildDate);
	const nextRoot = resolveRootOccurrenceAnchor(newRootFieldValues);
	if (!oldRoot || !oldChild || !nextRoot) return '';
	const deltaDays = dateToUtcDay(oldChild) - dateToUtcDay(oldRoot);
	return addDaysToDate(nextRoot, deltaDays);
}

function shiftDatetimeByRootOccurrenceDelta(
	fieldValues: Record<string, string>,
	key: 'datetimeStart' | 'datetimeEnd',
	oldRootFieldValues: Record<string, string>,
	newRootFieldValues: Record<string, string>,
): void {
	const value = fieldValues[key];
	if (!value) return;
	if (/^\d{2}:\d{2}(?::\d{2})?$/u.test(value.trim())) return;
	if (!/^\d{4}-\d{2}-\d{2}T/u.test(value)) {
		delete fieldValues[key];
		return;
	}
	const oldRoot = resolveRootOccurrenceAnchor(oldRootFieldValues);
	const nextRoot = resolveRootOccurrenceAnchor(newRootFieldValues);
	if (!oldRoot || !nextRoot) {
		delete fieldValues[key];
		return;
	}
	const currentDate = normalizeDateOnly(value);
	if (!currentDate) {
		delete fieldValues[key];
		return;
	}
	const deltaDays = dateToUtcDay(nextRoot) - dateToUtcDay(oldRoot);
	fieldValues[key] = `${addDaysToDate(currentDate, deltaDays)}${value.slice(10)}`;
}

type RecurringPipelineResolution =
	| { kind: 'pipeline'; pipeline: Pipeline }
	| { kind: 'ambiguous'; value: string }
	| { kind: 'missing' };

function resolveRecurringPipeline(
	pipelines: Pipeline[],
	defaultPipelineName: string,
	currentStatus: string | undefined,
	previousStatus?: string,
): RecurringPipelineResolution {
	const identityIndex = buildWorkflowStatusIdentityIndex(pipelines);
	const candidates = [currentStatus, previousStatus]
		.map(value => value?.trim() ?? '')
		.filter(Boolean);
	for (const candidate of candidates) {
		const identity = resolveWorkflowPipelineIdentity(candidate, identityIndex);
		if (identity.kind === 'ambiguous') return { kind: 'ambiguous', value: identity.value };
		if (identity.kind === 'configured' && identity.pipeline.statuses.length > 0) {
			return { kind: 'pipeline', pipeline: identity.pipeline };
		}
		const parsed = identity.kind === 'unknown' ? parseStatusValue(identity.value) : null;
		if (!parsed) continue;
		const pipelineIdentity = resolveConfiguredPipelineNameIdentity(parsed.pipeline, identityIndex);
		if (pipelineIdentity.kind === 'ambiguous') return { kind: 'ambiguous', value: identity.value };
		if (pipelineIdentity.kind === 'configured' && pipelineIdentity.pipeline.statuses.length > 0) {
			return { kind: 'pipeline', pipeline: pipelineIdentity.pipeline };
		}
	}
	const explicitDefault = resolveConfiguredPipelineNameIdentity(defaultPipelineName, identityIndex);
	if (explicitDefault.kind === 'ambiguous') {
		return { kind: 'ambiguous', value: candidates[0] ?? '' };
	}
	const fallback = explicitDefault.kind === 'configured' && explicitDefault.pipeline.statuses.length > 0
		? explicitDefault.pipeline
		: pipelines.find(entry => entry.statuses.length > 0) ?? null;
	return fallback ? { kind: 'pipeline', pipeline: fallback } : { kind: 'missing' };
}

export function resolveRecurringStatusValue(
	pipelines: Pipeline[],
	defaultPipelineName: string,
	currentStatus: string | undefined,
	previousStatus?: string,
	preferScheduledTarget = true,
): string {
	const resolution = resolveRecurringPipeline(pipelines, defaultPipelineName, currentStatus, previousStatus);
	if (resolution.kind === 'ambiguous') return resolution.value;
	if (resolution.kind === 'missing') return '';
	const { pipeline } = resolution;
	const scheduledTarget = preferScheduledTarget
		? pipeline.statuses.find(status => !status.isFinished && !status.isCancelled && status.isScheduledTarget)
		: null;
	const target = scheduledTarget ?? pipeline.statuses[0];
	return target ? composeStatusValue(pipeline.name, target.label) : '';
}

function getRecurringTaskSeriesId(task: ParsedTask): string {
	return getTaskFieldValue(task, 'repeatSeriesId').trim();
}

function getRecurringHistoryGroupKey(task: ParsedTask): string {
	const seriesId = getRecurringTaskSeriesId(task);
	if (!seriesId) return '';
	const description = task.description.trim().toLowerCase();
	if (!description) return '';
	return `${seriesId}::${description}`;
}

function isSeriesLatestCandidate(next: ParsedTask, current: ParsedTask): boolean {
	const nextScheduled = normalizeDateOnly(getTaskFieldValue(next, 'dateScheduled'));
	const currentScheduled = normalizeDateOnly(getTaskFieldValue(current, 'dateScheduled'));
	if (nextScheduled && currentScheduled && nextScheduled !== currentScheduled) {
		return nextScheduled > currentScheduled;
	}

	const nextCompleted = normalizeDateOnly(getTaskFieldValue(next, 'dateCompleted'));
	const currentCompleted = normalizeDateOnly(getTaskFieldValue(current, 'dateCompleted'));
	if (nextCompleted && currentCompleted && nextCompleted !== currentCompleted) {
		return nextCompleted > currentCompleted;
	}

	const nextModified = (getTaskFieldValue(next, 'datetimeModified') || '').trim();
	const currentModified = (getTaskFieldValue(current, 'datetimeModified') || '').trim();
	if (nextModified && currentModified && nextModified !== currentModified) {
		return nextModified > currentModified;
	}

	return next.lineNumber < current.lineNumber;
}

function collectLatestOwnedSubtaskSeries(
	lines: string[],
	options: RecurringFileBodyTransformOptions,
): Set<string> {
	const latestByGroup = new Map<string, ParsedTask>();
	let inFencedCodeBlock = false;

	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i];
		if (isFenceDelimiter(line)) {
			inFencedCodeBlock = !inFencedCodeBlock;
			continue;
		}
		if (inFencedCodeBlock) continue;

		const parsed = parseTaskLine(line, i, options.sourceFilePath, options.keyMappings);
		if (!isOperonInlineTask(parsed)) continue;
		if (getTaskFieldValue(parsed, 'parentTask') !== options.oldRootOperonId) continue;
		const groupKey = getRecurringHistoryGroupKey(parsed);
		if (!groupKey) continue;
		const current = latestByGroup.get(groupKey);
		if (!current || isSeriesLatestCandidate(parsed, current)) {
			latestByGroup.set(groupKey, parsed);
		}
	}

	const latestIds = [...latestByGroup.values()]
		.map(task => task.operonId)
		.filter((value): value is string => typeof value === 'string' && value.length > 0);
	return new Set(latestIds);
}

function cloneRecurringInlineBodySubtask(
	task: ParsedTask,
	options: RecurringFileBodyTransformOptions,
): string {
	const sourceKeys = getTaskSourceKeyMap(task);
	const originalFields = Object.fromEntries(task.fields.map(field => [field.key, field.value]));
	const nextFields: Record<string, string> = { ...originalFields };
	const childScheduled = shiftDateByRootOccurrenceDelta(options.oldRootFieldValues, originalFields['dateScheduled'], options.newRootFieldValues);
	const childStarted = shiftDateByRootOccurrenceDelta(options.oldRootFieldValues, originalFields['dateStarted'], options.newRootFieldValues);
	const childDue = shiftDateByRootOccurrenceDelta(options.oldRootFieldValues, originalFields['dateDue'], options.newRootFieldValues);

	for (const key of BODY_CLONE_RESET_FIELDS) {
		delete nextFields[key];
	}

	nextFields['operonId'] = (options.generateOperonId ?? generateOperonId)();
	nextFields['parentTask'] = options.newRootOperonId;
	nextFields['datetimeModified'] = options.now;

	const nextStatus = resolveRecurringStatusValue(
		options.pipelines,
		options.defaultPipelineName,
		originalFields['status'],
		undefined,
		!!childScheduled,
	);
	if (nextStatus) nextFields['status'] = nextStatus;
	else delete nextFields['status'];

	if (childScheduled) {
		nextFields['dateScheduled'] = childScheduled;
	} else {
		delete nextFields['dateScheduled'];
	}
	if (childStarted) nextFields['dateStarted'] = childStarted;
	else delete nextFields['dateStarted'];
	if (childDue) nextFields['dateDue'] = childDue;
	else delete nextFields['dateDue'];
	shiftDatetimeByRootOccurrenceDelta(nextFields, 'datetimeStart', options.oldRootFieldValues, options.newRootFieldValues);
	shiftDatetimeByRootOccurrenceDelta(nextFields, 'datetimeEnd', options.oldRootFieldValues, options.newRootFieldValues);

	const fields: OperonField[] = Object.entries(nextFields)
		.filter(([, value]) => !!value)
		.map(([key, value]) => ({
			sourceKey: sourceKeys.get(key) ?? key,
			key,
			value,
			rawValue: value,
			type: CANONICAL_KEY_MAP.get(key)?.type ?? 'text',
			isCanonical: CANONICAL_KEY_MAP.has(key),
			containerRange: { from: 0, to: 0 },
			valueRange: { from: 0, to: 0 },
		}));

	const cloned: ParsedTask = {
		checkbox: 'open',
		checkboxRange: { from: 0, to: 0 },
		timePrefix: task.timePrefix ? { ...task.timePrefix } : null,
		timePrefixRange: null,
		description: task.description,
		descriptionRange: { from: 0, to: 0 },
		tags: [...task.tags],
		tagTokens: [],
		fields,
		metadataTailRange: null,
		operonId: nextFields['operonId'],
		filePath: options.sourceFilePath,
		lineNumber: 0,
		rawLine: '',
	};

	const indent = task.rawLine.match(/^\s*/u)?.[0] ?? '';
	return `${indent}${serializeTask(cloned, options.keyMappings)}`;
}

function transformRecurringBodyLines(
	lines: string[],
	options: RecurringFileBodyTransformOptions,
	allowOwnedSubtasks: boolean,
	latestOwnedRecurringIds: Set<string>,
): RecurringBodyTransformLinesResult {
	const out: string[] = [];
	let clonedSubtaskCount = 0;
	let removedForeignTaskCount = 0;
	let inFencedCodeBlock = false;

	for (let i = 0; i < lines.length;) {
		const line = lines[i];
		if (isFenceDelimiter(line)) {
			inFencedCodeBlock = !inFencedCodeBlock;
			out.push(line);
			i += 1;
			continue;
		}
		if (inFencedCodeBlock) {
			out.push(line);
			i += 1;
			continue;
		}

		const parsed = parseTaskLine(line, i, options.sourceFilePath, options.keyMappings);
		if (isOperonInlineTask(parsed)) {
			const indent = getLineIndentWidth(line);
			const subtree = collectIndentedSubtree(lines, i + 1, indent);
			const historyGroupKey = getRecurringHistoryGroupKey(parsed);
			const isStaleRecurringOwnedSubtask = !!historyGroupKey
				&& getTaskFieldValue(parsed, 'parentTask') === options.oldRootOperonId
				&& !!parsed.operonId
				&& !latestOwnedRecurringIds.has(parsed.operonId);
			const isOwnedSubtask = allowOwnedSubtasks
				&& getTaskFieldValue(parsed, 'parentTask') === options.oldRootOperonId
				&& !isStaleRecurringOwnedSubtask;
			if (isOwnedSubtask) {
				out.push(cloneRecurringInlineBodySubtask(parsed, options));
				clonedSubtaskCount += 1;
				if (subtree.lines.length > 0) {
					const transformedSubtree = transformRecurringBodyLines(subtree.lines, options, false, latestOwnedRecurringIds);
					out.push(...transformedSubtree.lines);
					clonedSubtaskCount += transformedSubtree.clonedSubtaskCount;
					removedForeignTaskCount += transformedSubtree.removedForeignTaskCount;
				}
			} else {
				removedForeignTaskCount += 1;
			}
			i = subtree.nextIndex;
			continue;
		}

		out.push(parsed ? resetPlainMarkdownCheckboxes(line) : line);
		i += 1;
	}

	return {
		lines: out,
		clonedSubtaskCount,
		removedForeignTaskCount,
	};
}

export function transformRecurringFileBody(
	options: RecurringFileBodyTransformOptions,
): RecurringBodyTransformResult {
	const latestOwnedRecurringIds = collectLatestOwnedSubtaskSeries(
		options.sourceBody.split('\n'),
		options,
	);
	const transformed = transformRecurringBodyLines(
		options.sourceBody.split('\n'),
		options,
		true,
		latestOwnedRecurringIds,
	);
	return {
		body: transformed.lines.join('\n'),
		clonedSubtaskCount: transformed.clonedSubtaskCount,
		removedForeignTaskCount: transformed.removedForeignTaskCount,
	};
}

export function buildRecurringFileFieldPresence(
	plannedFieldValues: Record<string, string>,
	sourceDocument: Pick<ParsedFrontmatterDocument, 'managedFieldValues' | 'managedFieldPresence'>,
): Set<string> {
	const presence = new Set(Object.keys(plannedFieldValues));
	for (const key of sourceDocument.managedFieldPresence) {
		if (USER_DATE_FIELDS.has(key)) continue;
		if ((sourceDocument.managedFieldValues[key] ?? '') === '') {
			presence.add(key);
		}
	}
	return presence;
}

export class RecurrenceService {
	private app: App;
	private indexer: OperonIndexer;
	private writer: TaskWriter;
	private storage: OperonStorage;
	private getSettings: () => OperonSettings;
	private onBeforeCreatedTaskReindex: (operonId: string) => void;

	constructor(
		app: App,
		indexer: OperonIndexer,
		writer: TaskWriter,
		storage: OperonStorage,
		getSettings: () => OperonSettings,
		onBeforeCreatedTaskReindex: (operonId: string) => void = () => {},
	) {
		this.app = app;
		this.indexer = indexer;
		this.writer = writer;
		this.storage = storage;
		this.getSettings = getSettings;
		this.onBeforeCreatedTaskReindex = onBeforeCreatedTaskReindex;
	}

	async ensureSeriesEntry(task: IndexedTask, preferredSeriesId?: string | null): Promise<RepeatSeriesEntry | null> {
		const rule = parseRepeatRule(task.fieldValues['repeat']);
		if (!rule) return null;
		const now = localNow();
		const yamlBaseName = task.primary.format === 'yaml'
			? this.getFileBaseName(task.primary.filePath)
			: null;
		const inlineDescription = task.primary.format === 'inline'
			? task.description.trim()
			: null;
		return await this.storage.repeatSeries.ensureSeries({
			seriesId: preferredSeriesId ?? task.fieldValues['repeatSeriesId'],
			sourceTaskId: task.operonId,
			sourceFormat: task.primary.format,
			baseTitle: task.primary.format === 'yaml' ? this.deriveBaseTitle(task.primary.filePath) : null,
			lastMaterializedTitle: task.primary.format === 'yaml' ? this.getFileBaseName(task.primary.filePath) : task.description.trim(),
			naming: yamlBaseName
				? detectRepeatSeriesNamingConfig(yamlBaseName)
				: inlineDescription
					? detectRepeatSeriesNamingConfig(inlineDescription)
					: null,
			baseTemporalTemplate: deriveTemporalTemplateFromTaskAtOccurrence(task, resolveMaterializationTemporalAnchor(rule, task.fieldValues)),
			now,
		});
	}

	async reconcileStoredSeries(): Promise<void> {
		const materializedSeriesIds = new Set(
			this.indexer.getAllTasks()
				.map(task => (task.fieldValues['repeatSeriesId'] ?? '').trim())
				.filter(Boolean),
		);
		await this.storage.repeatSeries.reconcileSeriesEntries(materializedSeriesIds);
	}

	getRepeatSummary(raw: string | null | undefined): string {
		return formatRepeatRuleSummary(parseRepeatRule(raw));
	}

	async materializeNextOccurrence(
		beforeTask: IndexedTask,
		completedTask: IndexedTask,
		completionTimestamp: string,
	): Promise<RecurrenceMaterializationResult> {
		const planned = await this.planNextOccurrence(beforeTask, completedTask, completionTimestamp);
		if (!planned) {
			const rule = parseRepeatRule(completedTask.fieldValues['repeat']);
			if (!completedTask.fieldValues['repeat']) return { created: false, reason: 'not-recurring' };
			if (!rule) return { created: false, reason: 'invalid-rule' };
			const anchor = this.resolveNextOccurrenceAnchorDate(rule, completedTask, completionTimestamp);
			if (!anchor) return { created: false, reason: 'missing-anchor' };
			const next = calculateNextRepeatDate(rule, {
				anchorDate: anchor,
				skipDates: this.storage.repeatSeries.getSkipDates(completedTask.fieldValues['repeatSeriesId']),
				repeatEnd: completedTask.fieldValues['datetimeRepeatEnd'],
			});
			return {
				created: false,
				reason: next ? 'unsupported' : 'ended',
				summary: formatRepeatRuleSummary(rule),
			};
		}

		if (planned.sourceTask.primary.format === 'inline') {
			const created = await this.materializeInlineOccurrence(planned);
			if (!created) return { created: false, reason: 'source-missing', seriesId: planned.seriesId };
			return {
				created: true,
				reason: 'created',
				seriesId: planned.seriesId,
				nextDate: planned.nextDate,
				createdTaskId: created.taskId,
				materializationMode: created.mode,
				summary: formatRepeatRuleSummary(planned.rule),
			};
		}

		const created = await this.materializeFileOccurrence(planned);
		if (!created) return { created: false, reason: 'source-missing', seriesId: planned.seriesId };
		return {
			created: true,
			reason: 'created',
			seriesId: planned.seriesId,
			nextDate: planned.nextDate,
			createdTaskId: planned.fieldValues['operonId'],
			createdFilePath: created,
			materializationMode: 'inserted',
			summary: formatRepeatRuleSummary(planned.rule),
		};
	}

	private resolveNextOccurrenceAnchorDate(
		rule: RepeatRule,
		completedTask: IndexedTask,
		completionTimestamp: string,
	): string {
		if (rule.mode === 'schedule' || rule.mode === 'count') {
			return resolveMaterializationSourceAnchor(rule, completedTask.fieldValues);
		}
		if (completedTask.checkbox !== 'done') return completionTimestamp;
		const occurrenceDate = getTaskRepeatOccurrenceDate(completedTask);
		const completionDate = extractDatePart(completionTimestamp);
		if (occurrenceDate && completionDate && occurrenceDate > completionDate) {
			return occurrenceDate;
		}
		return completionTimestamp;
	}

	private async planNextOccurrence(
		beforeTask: IndexedTask,
		completedTask: IndexedTask,
		completionTimestamp: string,
	): Promise<PlannedOccurrence | null> {
		if (completedTask.checkbox !== 'done' && completedTask.checkbox !== 'cancelled') return null;

		const rule = parseRepeatRule(completedTask.fieldValues['repeat']);
		if (!rule) return null;
		if (rule.mode === 'count' && (!rule.count || rule.count <= 1)) return null;

		const series = await this.ensureSeriesEntry(completedTask, completedTask.fieldValues['repeatSeriesId']);
		if (!series) return null;

		const anchorDate = this.resolveNextOccurrenceAnchorDate(rule, completedTask, completionTimestamp);
		if (!anchorDate) return null;

		const nextOccurrenceDate = calculateNextRepeatDate(rule, {
			anchorDate,
			skipDates: series.skipDates,
			repeatEnd: completedTask.fieldValues['datetimeRepeatEnd'],
		});
		if (!nextOccurrenceDate) return null;

		const baseTemplate = await this.resolveSeriesBaseTemporalTemplate(series, completedTask);
		if (!baseTemplate) return null;
		const occurrencePlan = resolveOccurrencePlan({
			entry: series,
			occurrenceDate: nextOccurrenceDate,
			fallbackTemplate: baseTemplate,
		});
		if (!occurrencePlan) return null;
		const temporalTemplate = occurrencePlan.temporalTemplate;
		const nextDate = occurrencePlan.scheduledDate;
		const nextFieldValues = this.buildNextOccurrenceFieldValues(
			beforeTask,
			completedTask,
			rule,
			series,
			nextOccurrenceDate,
			nextDate,
			temporalTemplate,
		);
		return {
			rule,
			seriesId: series.seriesId,
			nextDate,
			nextOccurrenceDate,
			temporalTemplate,
			fieldValues: nextFieldValues,
			description: this.resolveNextOccurrenceDescription(completedTask, series, nextDate, nextOccurrenceDate),
			tags: [...completedTask.tags],
			timePrefix: null,
			sourceTask: completedTask,
			baseTitle: series.baseTitle,
			naming: series.naming,
			inlineCompletionMode: series.inlineCompletionMode,
		};
	}

	private buildNextOccurrenceFieldValues(
		beforeTask: IndexedTask,
		completedTask: IndexedTask,
		rule: RepeatRule,
		series: RepeatSeriesEntry,
		nextOccurrenceDate: string,
		nextDate: string,
		temporalTemplate: RepeatTemporalTemplate,
	): Record<string, string> {
		const now = localNow();
		const hasSourceScheduledDate = !!normalizeDateOnly(completedTask.fieldValues['dateScheduled']);
		const sourceTemporalAnchor = resolveMaterializationTemporalAnchor(rule, completedTask.fieldValues);
		const hasSourceTemporalAnchor = !!sourceTemporalAnchor;
		const fieldValues: Record<string, string> = {
			operonId: generateOperonId(),
			datetimeCreated: now,
			datetimeModified: now,
			repeatSeriesId: series.seriesId,
			repeatOccurrenceDate: nextOccurrenceDate,
		};
		if (hasSourceScheduledDate) {
			fieldValues['dateScheduled'] = nextDate;
		}

		for (const [key, value] of Object.entries(completedTask.fieldValues)) {
			if (!value) continue;
			if (key === 'operonId' || key === 'datetimeCreated' || key === 'dateScheduled' || key === 'datetimeModified') continue;
			if (RESET_FIELDS.has(key)) continue;
			if (!COPIED_FIELDS.has(key)) continue;
			fieldValues[key] = value;
		}

		const nextStatus = resolveRecurringStatusValue(
			this.getSettings().pipelines,
			this.getSettings().defaultPipelineName,
			completedTask.fieldValues['status'],
			beforeTask.fieldValues['status'],
			hasSourceScheduledDate,
		);
		if (nextStatus) {
			fieldValues['status'] = nextStatus;
		} else {
			delete fieldValues['status'];
		}

		for (const key of RESET_FIELDS) {
			delete fieldValues[key];
		}

		if (hasSourceTemporalAnchor) {
			this.applyTemporalTemplateToFieldValues(fieldValues, nextOccurrenceDate, nextDate, temporalTemplate, hasSourceScheduledDate);
		}

		if (rule.mode === 'count' && rule.count) {
			const nextCount = Math.max(1, rule.count - 1);
			const nextRule: RepeatRule = {
				...rule,
				count: nextCount,
			};
			fieldValues['repeat'] = serializeRepeatRule(nextRule);
			const derivedEnd = calculateRepeatEndFromCount(nextRule, nextOccurrenceDate, nextCount, series.skipDates);
			if (derivedEnd) {
				fieldValues['datetimeRepeatEnd'] = `${derivedEnd}T23:59:59`;
			} else {
				delete fieldValues['datetimeRepeatEnd'];
			}
		}

		return fieldValues;
	}

	private async resolveSeriesBaseTemporalTemplate(
		series: RepeatSeriesEntry,
		contextTask: IndexedTask,
	): Promise<RepeatTemporalTemplate | null> {
		if (series.baseTemporalTemplate) {
			return { ...series.baseTemporalTemplate };
		}
		const contextRule = parseRepeatRule(contextTask.fieldValues['repeat']);
		const materializedTasks = this.indexer.getAllTasks()
			.filter(task => (task.fieldValues['repeatSeriesId'] ?? '').trim() === series.seriesId)
			.sort((left, right) => {
				const leftRule = parseRepeatRule(left.fieldValues['repeat']) ?? contextRule;
				const rightRule = parseRepeatRule(right.fieldValues['repeat']) ?? contextRule;
				const leftDate = leftRule
					? resolveMaterializationTemporalAnchor(leftRule, left.fieldValues)
					: getTaskRepeatOccurrenceDate(left);
				const rightDate = rightRule
					? resolveMaterializationTemporalAnchor(rightRule, right.fieldValues)
					: getTaskRepeatOccurrenceDate(right);
				if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
				return left.operonId.localeCompare(right.operonId);
			});
		const seedTask = materializedTasks[0] ?? contextTask;
		if (!seedTask) return null;
		const seedRule = parseRepeatRule(seedTask.fieldValues['repeat']) ?? parseRepeatRule(contextTask.fieldValues['repeat']);
		const seedAnchor = seedRule
			? resolveMaterializationTemporalAnchor(seedRule, seedTask.fieldValues)
			: getTaskRepeatOccurrenceDate(seedTask);
		const template = deriveTemporalTemplateFromTaskAtOccurrence(seedTask, seedAnchor);
		await this.storage.repeatSeries.updateBaseTemporalTemplate(series.seriesId, template, localNow());
		return template;
	}

	private applyTemporalTemplateToFieldValues(
		fieldValues: Record<string, string>,
		occurrenceDate: string,
		scheduledDate: string,
		template: RepeatTemporalTemplate,
		includeScheduledDate: boolean,
	): void {
		if (includeScheduledDate) {
			fieldValues['dateScheduled'] = scheduledDate;
		} else {
			delete fieldValues['dateScheduled'];
		}
		const allDayStartDate = addDaysToDate(occurrenceDate, template.startDateShiftDays);
		const allDayEndDate = addDaysToDate(occurrenceDate, template.endDateShiftDays);
		if (template.mode === 'allDay') {
			if (Object.prototype.hasOwnProperty.call(fieldValues, 'dateStarted')) {
				fieldValues['dateStarted'] = allDayStartDate;
			}
			if (Object.prototype.hasOwnProperty.call(fieldValues, 'dateDue')) {
				fieldValues['dateDue'] = allDayEndDate;
			}
			if (Object.prototype.hasOwnProperty.call(fieldValues, 'datetimeStart')) {
				if (template.startTime) {
					fieldValues['datetimeStart'] = this.isTimeOnlyValue(fieldValues['datetimeStart'])
						? template.startTime.slice(0, 5)
						: `${allDayStartDate}T${template.startTime}`;
				} else {
					delete fieldValues['datetimeStart'];
				}
			}
			if (Object.prototype.hasOwnProperty.call(fieldValues, 'datetimeEnd')) {
				if (template.endTime) {
					fieldValues['datetimeEnd'] = this.isTimeOnlyValue(fieldValues['datetimeEnd'])
						? template.endTime.slice(0, 5)
						: `${allDayEndDate}T${template.endTime}`;
				} else {
					delete fieldValues['datetimeEnd'];
				}
			}
			return;
		}
		if (Object.prototype.hasOwnProperty.call(fieldValues, 'dateStarted')) {
			fieldValues['dateStarted'] = allDayStartDate;
		}
		if (Object.prototype.hasOwnProperty.call(fieldValues, 'dateDue')) {
			fieldValues['dateDue'] = allDayEndDate;
		}
		const hasDatetimeStart = 'datetimeStart' in fieldValues;
		const hasDatetimeEnd = 'datetimeEnd' in fieldValues;
		const preserveTimeOnly = (hasDatetimeStart || hasDatetimeEnd)
			&& (!hasDatetimeStart || this.isTimeOnlyValue(fieldValues['datetimeStart']))
			&& (!hasDatetimeEnd || this.isTimeOnlyValue(fieldValues['datetimeEnd']));
		if (preserveTimeOnly) {
			if (hasDatetimeStart) {
				if (template.startTime) fieldValues['datetimeStart'] = template.startTime.slice(0, 5);
				else delete fieldValues['datetimeStart'];
			}
			if (hasDatetimeEnd) {
				if (template.endTime) fieldValues['datetimeEnd'] = template.endTime.slice(0, 5);
				else delete fieldValues['datetimeEnd'];
			}
			return;
		}
		if (hasDatetimeStart) {
			if (template.startTime) fieldValues['datetimeStart'] = `${allDayStartDate}T${template.startTime}`;
			else delete fieldValues['datetimeStart'];
		}
		if (hasDatetimeEnd) {
			if (template.endTime) fieldValues['datetimeEnd'] = `${allDayEndDate}T${template.endTime}`;
			else delete fieldValues['datetimeEnd'];
		}
	}

	private isTimeOnlyValue(value: string | null | undefined): boolean {
		const trimmed = (value ?? '').trim();
		return /^\d{2}:\d{2}(?::\d{2})?$/u.test(trimmed);
	}

	private resolveNextOccurrenceDescription(
		completedTask: IndexedTask,
		series: RepeatSeriesEntry,
		nextDate: string,
		nextOccurrenceDate: string,
	): string {
		if (completedTask.primary.format !== 'inline') {
			return completedTask.description;
		}
		const naming = resolveLatestRepeatSeriesNamingConfig(completedTask.description, series.naming);
		if (!naming) return completedTask.description;
		const displayDate = resolveRecurringFileDisplayDate({
			dateScheduled: nextDate,
			repeatOccurrenceDate: nextOccurrenceDate,
		});
		return displayDate ? renderRepeatSeriesTitle(naming, displayDate) : completedTask.description;
	}

	private async materializeInlineOccurrence(plan: PlannedOccurrence): Promise<InlineOccurrenceMaterializationResult | null> {
		const file = this.app.vault.getAbstractFileByPath(plan.sourceTask.primary.filePath);
		if (!(file instanceof TFile)) return null;

		const content = await this.app.vault.cachedRead(file);
		const lines = content.split('\n');
		const lineIndex = this.findTaskLine(lines, plan.sourceTask.primary.filePath, plan.sourceTask.operonId, plan.sourceTask.primary.lineNumber);
		if (lineIndex === -1) return null;
		const parsedSource = parseTaskLine(lines[lineIndex], lineIndex, plan.sourceTask.primary.filePath, this.getSettings().keyMappings);

		const line = this.buildInlineTaskLine(plan, parsedSource);
		const shouldReplace = this.shouldReplaceCompletedInlineOccurrence(plan);
		const materialized = materializeInlineOccurrenceLines(lines, lineIndex, line, {
			replaceCompleted: shouldReplace,
			newOccurrencePosition: this.getSettings().newOccurrencePosition,
		});
		await this.app.vault.modify(file, materialized.lines.join('\n'));
		this.onBeforeCreatedTaskReindex(plan.fieldValues['operonId']);
		await this.indexer.reindexFilePath(plan.sourceTask.primary.filePath);
		return {
			taskId: plan.fieldValues['operonId'],
			mode: materialized.mode,
		};
	}

	private shouldReplaceCompletedInlineOccurrence(plan: PlannedOccurrence): boolean {
		return plan.rule.mode === 'done'
			&& plan.sourceTask.checkbox === 'done'
			&& plan.inlineCompletionMode === 'replace-completed';
	}

	private buildInlineTaskLine(plan: PlannedOccurrence, sourceTask: ParsedTask | null): string {
		const fields: OperonField[] = Object.entries(plan.fieldValues).map(([key, value]) => ({
			sourceKey: key,
			key,
			value,
			rawValue: value,
			type: CANONICAL_KEY_MAP.get(key)?.type ?? 'text',
			isCanonical: CANONICAL_KEY_MAP.has(key),
			containerRange: { from: 0, to: 0 },
			valueRange: { from: 0, to: 0 },
		}));

		const task: ParsedTask = {
			checkbox: 'open',
			checkboxRange: sourceTask?.checkboxRange ?? { from: 0, to: 0 },
			timePrefix: sourceTask?.timePrefix ?? null,
			timePrefixRange: sourceTask?.timePrefixRange ?? null,
			description: plan.description,
			descriptionRange: { from: 0, to: 0 },
			tags: [...plan.tags],
			tagTokens: [],
			fields,
			metadataTailRange: null,
			operonId: plan.fieldValues['operonId'],
			filePath: plan.sourceTask.primary.filePath,
			lineNumber: 0,
			rawLine: sourceTask?.rawLine ?? '',
		};

		return serializeTask(task, this.getSettings().keyMappings);
	}

	private async materializeFileOccurrence(plan: PlannedOccurrence): Promise<string | null> {
		const sourceFile = this.app.vault.getAbstractFileByPath(plan.sourceTask.primary.filePath);
		if (!(sourceFile instanceof TFile)) return null;

		const folder = await this.ensureRepeatFolder(this.resolveRepeatFolder(sourceFile));
		const naming = resolveLatestRepeatSeriesNamingConfig(this.getFileBaseName(sourceFile.path), plan.naming);
		const currentDisplayDate = resolveRecurringFileDisplayDate(plan.sourceTask.fieldValues);
		const nextDisplayDate = resolveRecurringFileDisplayDate(plan.fieldValues);
		if (!currentDisplayDate || !nextDisplayDate) return null;
		const nextTitle = naming
			? renderRepeatSeriesTitle(naming, nextDisplayDate)
			: (plan.baseTitle ?? this.deriveBaseTitle(sourceFile.path));

		const content = await this.app.vault.cachedRead(sourceFile);
		const sourceDocument = parseFrontmatterDocument(content, this.getSettings().keyMappings);
		const originalSourcePath = plan.sourceTask.primary.filePath;
		if (naming?.mode === 'plain') {
			const archiveTitle = renderCompletedPlainArchiveTitle(naming, currentDisplayDate);
			const archivePath = this.getUniqueRepeatFilePath(folder, this.sanitizeTaskFileName(archiveTitle));
			await this.app.fileManager.renameFile(sourceFile, archivePath);
		}
		const filePath = this.getUniqueRepeatFilePath(folder, this.sanitizeTaskFileName(nextTitle));
		const sourceDocumentWithYamlRemovals = sourceDocument.hasFrontmatter
			? applyRawYamlValueRemovals(
				sourceDocument,
				this.resolveYamlPropertyValueRemovalsForSeries(plan.seriesId),
				this.collectProtectedRawYamlKeysForRecurringFileTask(sourceDocument),
			)
			: sourceDocument;
		const transformedBody = transformRecurringFileBody({
			sourceBody: sourceDocumentWithYamlRemovals.body,
			sourceFilePath: originalSourcePath,
			oldRootOperonId: plan.sourceTask.operonId,
			newRootOperonId: plan.fieldValues['operonId'],
			oldRootFieldValues: plan.sourceTask.fieldValues,
			newRootFieldValues: plan.fieldValues,
			rootSeriesId: plan.seriesId,
			keyMappings: this.getSettings().keyMappings,
			pipelines: this.getSettings().pipelines,
			defaultPipelineName: this.getSettings().defaultPipelineName,
			now: plan.fieldValues['datetimeModified'],
			generateOperonId: () => generateOperonId(),
		});
		const draft = buildMergedFileTaskDraft({
			source: {
				description: nextTitle,
				fieldValues: plan.fieldValues,
				fieldPresence: buildRecurringFileFieldPresence(plan.fieldValues, sourceDocumentWithYamlRemovals),
				tags: [...plan.tags],
				tagsPresent: plan.tags.length > 0,
					frontmatterDocument: {
						...sourceDocumentWithYamlRemovals,
						body: transformedBody.body,
					},
			},
			template: null,
			defaults: resolveFileTaskDefaults({
				sourceFieldValues: plan.fieldValues,
				templateFieldValues: {},
				existingOperonId: plan.fieldValues['operonId'],
				defaultPipelineName: this.getSettings().defaultPipelineName,
				defaultPriority: this.getSettings().defaultPriority,
				pipelines: this.getSettings().pipelines,
				now: plan.fieldValues['datetimeModified'],
				generateOperonId: () => plan.fieldValues['operonId'],
			}),
			keyMappings: this.getSettings().keyMappings,
			bodyStrategy: 'preserve-source',
			preserveSourceKeyChoices: true,
		});

		await this.app.vault.create(filePath, draft.content);
		await this.storage.repeatSeries.updateLastMaterializedTitle(plan.seriesId, nextTitle, plan.fieldValues['datetimeModified']);
		this.onBeforeCreatedTaskReindex(plan.fieldValues['operonId']);
		this.indexer.scheduleReindex(filePath);
		return filePath;
	}

	private resolveYamlPropertyValueRemovalsForSeries(seriesId: string): string[] {
		return this.storage.repeatSeries.getEntry(seriesId)?.yamlPropertyValueRemovals ?? [];
	}

	private collectProtectedRawYamlKeysForRecurringFileTask(document: ParsedFrontmatterDocument): string[] {
		const protectedKeys = new Set<string>();
		for (const section of document.sections) {
			if (section.kind !== 'managed' || !section.canonicalKey) continue;
			if (!FILE_REPEAT_PROTECTED_CLEAR_CANONICAL_FIELDS.has(section.canonicalKey)) continue;
			protectedKeys.add(section.yamlKey);
		}
		return [...protectedKeys];
	}

	private async ensureRepeatFolder(folder: string): Promise<string> {
		if (!folder) return '';
		const existing = this.app.vault.getAbstractFileByPath(folder);
		if (existing) return folder;

		const parts = folder.split('/').filter(Boolean);
		let current = '';
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			if (this.app.vault.getAbstractFileByPath(current)) continue;
			await this.app.vault.createFolder(current);
		}
		return folder;
	}

	private resolveRepeatFolder(sourceFile: TFile): string {
		const settings = this.getSettings();
		if (settings.fileRepeatDestination === 'custom-folder' && settings.fileRepeatCustomFolder.trim()) {
			return settings.fileRepeatCustomFolder.trim();
		}
		return sourceFile.parent?.path ?? '';
	}

	private getUniqueRepeatFilePath(folder: string, baseName: string): string {
		const prefix = folder ? `${folder}/` : '';
		let counter = 1;
		let candidate = `${prefix}${baseName}.md`;
		while (this.app.vault.getAbstractFileByPath(candidate)) {
			counter += 1;
			candidate = `${prefix}${baseName} (${counter}).md`;
		}
		return candidate;
	}

	private getFileBaseName(filePath: string): string {
		const abstract = this.app.vault.getAbstractFileByPath(filePath);
		return abstract instanceof TFile
			? abstract.basename
			: filePath.split('/').pop()?.replace(/\.md$/i, '') ?? t('taskEditor', 'untitledTaskFile');
	}

	private deriveBaseTitle(filePath: string): string {
		const basename = this.getFileBaseName(filePath);
		return basename.replace(/ - \d{4}-\d{2}-\d{2}(?: \(\d+\))?$/u, '').trim() || basename;
	}

	private sanitizeTaskFileName(name: string): string {
		return name
			.replace(/[\\/:*?"<>|]/g, '')
			.replace(/\s+/g, ' ')
			.trim()
			.substring(0, 100);
	}

	private findTaskLine(lines: string[], filePath: string, operonId: string, lineHint: number): number {
		if (lineHint >= 0 && lineHint < lines.length) {
			const hinted = parseTaskLine(lines[lineHint], lineHint, filePath, this.getSettings().keyMappings);
			if (hinted?.operonId === operonId) return lineHint;
		}

		for (let i = 0; i < lines.length; i++) {
			const parsed = parseTaskLine(lines[i], i, filePath, this.getSettings().keyMappings);
			if (parsed?.operonId === operonId) return i;
		}
		return -1;
	}
}
