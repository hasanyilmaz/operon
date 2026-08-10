import { sha256HexV1 } from '../contracts/v1/canonical';
import type {
	CatalogProjectionV1,
} from './catalog-builder';
import type {
	MutationPreviewRequestV1,
	PredictedEffectV1,
	ReminderItemSpecV1,
	SealedConversionEffectV1,
	SealedUpdateBatchEffectV1,
	TransitionTaskSpecV1,
	UpdateTaskBatchSpecV1,
	UpdateTaskSpecV1,
} from '../contracts/v1/mutation';
import type { StructuredErrorCodeV1 } from '../contracts/v1/primitives';
import {
	sameTaskSourceLocatorV1,
	type TaskSourceLocatorV1,
} from '../contracts/v1/identity';
import { applyReminderListMutation } from '../../core/reminder-list-mutation';
import {
	normalizeTaskFieldPatch,
	splitTaskListValue,
} from '../../core/task-field-patch';
import {
	parseAbsoluteReminder,
	resolveReminderRule,
} from '../../core/reminder-rules';
import { composeStatusValue } from '../../core/workflow-status-value';
import { canonicalizeLocalDatetime } from '../../core/local-time';
import { parseTaskLine } from '../../core/parser';
import { getManagedYamlAliases } from '../../core/yaml-fields';
import { CANONICAL_KEYS } from '../../types/keys';
import type { KeyMapping } from '../../types/settings';
import type {
	RuntimeMutationSettlementWindowV1,
	RuntimePreparedMutationCommitV1,
	RuntimePreparedMutationV1,
} from './mutation-gateway';

const STRICT_LOCAL_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/u;

function parseStrictCanonicalLocalDatetime(value: string): string | null {
	const match = STRICT_LOCAL_DATETIME_RE.exec(value);
	if (!match) return null;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const hour = Number(match[4]);
	const minute = Number(match[5]);
	const second = Number(match[6] ?? 0);
	if (
		year < 1
		|| month < 1
		|| month > 12
		|| hour > 23
		|| minute > 59
		|| second > 59
	) return null;
	const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
	const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
	if (day < 1 || day > daysInMonth) return null;
	return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${String(second).padStart(2, '0')}`;
}

function resolveBoundedModifiedTimeFrontmatterDriftV1(
	committedLines: readonly string[],
	observedLines: readonly string[],
	driftLineNumber: number,
	modifiedTimeFrontmatterKeys: readonly string[],
	keyMappings: readonly KeyMapping[],
	settlementWindow: RuntimeMutationSettlementWindowV1 | undefined,
): boolean {
	if (
		committedLines[0]?.replace(/\r$/u, '') !== '---'
		|| observedLines[0]?.replace(/\r$/u, '') !== '---'
	) return false;
	const closingLineNumber = committedLines.findIndex((line, index) => (
		index > 0 && line.replace(/\r$/u, '') === '---'
	));
	if (
		closingLineNumber < 0
		|| observedLines[closingLineNumber]?.replace(/\r$/u, '') !== '---'
		|| driftLineNumber <= 0
		|| driftLineNumber >= closingLineNumber
	) return false;
	if (!settlementWindow) return false;
	const windowDurationMs = settlementWindow.settlementObservedAtEpochMs
		- settlementWindow.applyStartedAtEpochMs;
	if (
		!Number.isFinite(settlementWindow.applyStartedAtEpochMs)
		|| !Number.isFinite(settlementWindow.settlementObservedAtEpochMs)
		|| windowDurationMs < 0
		|| windowDurationMs > 5 * 60 * 1000
	) return false;
	const applyStartedAt = toLocalDatetime(
		new Date(settlementWindow.applyStartedAtEpochMs).toISOString(),
	);
	const settlementObservedAt = toLocalDatetime(
		new Date(settlementWindow.settlementObservedAtEpochMs).toISOString(),
	);
	const managedCanonicalKeys = new Set([
		...CANONICAL_KEYS.map(key => key.name),
		...keyMappings.map(mapping => mapping.canonicalKey),
	]);
	const managedTaskKeys = new Set([
		'tags',
		...[...managedCanonicalKeys].flatMap(canonicalKey => (
			getManagedYamlAliases(canonicalKey, [...keyMappings])
		)),
	]);
	const permittedKeys = [...new Set(modifiedTimeFrontmatterKeys)].filter(key => (
		key.trim() === key
		&& key.length > 0
		&& !/[\r\n:]/u.test(key)
		&& !managedTaskKeys.has(key)
	));
	for (const key of permittedKeys) {
		const prefix = `${key}:`;
		const matchingCommittedLines = committedLines.slice(1, closingLineNumber)
			.filter(line => line.startsWith(prefix));
		const matchingObservedLines = observedLines.slice(1, closingLineNumber)
			.filter(line => line.startsWith(prefix));
		if (matchingCommittedLines.length !== 1 || matchingObservedLines.length !== 1) continue;
		const committedLine = committedLines[driftLineNumber] ?? '';
		const observedLine = observedLines[driftLineNumber] ?? '';
		if (!committedLine.startsWith(prefix) || !observedLine.startsWith(prefix)) continue;
		const committedRaw = committedLine.slice(prefix.length).replace(/\r$/u, '').trim();
		const observedRaw = observedLine.slice(prefix.length).replace(/\r$/u, '').trim();
		const committedCanonical = parseStrictCanonicalLocalDatetime(committedRaw);
		const observedCanonical = parseStrictCanonicalLocalDatetime(observedRaw);
		const observedMatch = STRICT_LOCAL_DATETIME_RE.exec(observedRaw);
		const observedAtOrAfterApply = observedMatch?.[6] === undefined
			? observedCanonical?.slice(0, 16).localeCompare(applyStartedAt.slice(0, 16)) ?? -1
			: observedCanonical?.localeCompare(applyStartedAt) ?? -1;
		const observedAtOrBeforeSettlement = observedMatch?.[6] === undefined
			? observedCanonical?.slice(0, 16).localeCompare(settlementObservedAt.slice(0, 16)) ?? 1
			: observedCanonical?.localeCompare(settlementObservedAt) ?? 1;
		if (
			!committedCanonical
			|| !observedCanonical
			|| observedCanonical.localeCompare(committedCanonical) <= 0
			|| observedAtOrAfterApply < 0
			|| observedAtOrBeforeSettlement > 0
		) continue;
		return true;
	}
	return false;
}

export interface RuntimeExactTaskMutationSnapshotV1 {
	readonly operonId: string;
	readonly locator: TaskSourceLocatorV1;
	readonly description: string;
	readonly checkbox: 'open' | 'done' | 'cancelled';
	readonly fieldValues: Readonly<Record<string, string>>;
	readonly tags: readonly string[];
	readonly sourceContent: string;
	readonly duplicate: boolean;
	readonly activeTimerStart?: string;
}

export interface RuntimeTaskFieldMutationPreparationV1 {
	readonly kind: 'task-fields';
	readonly operation: 'update' | 'reminder-item' | 'transition';
	readonly task: RuntimeExactTaskMutationSnapshotV1;
	readonly fieldValues: Readonly<Record<string, string>>;
	readonly sourceRevision: string;
	readonly targetDigest: string;
	readonly summary: string;
	readonly noChange: boolean;
	readonly parentOperonId?: string;
	readonly parentTask?: RuntimeExactTaskMutationSnapshotV1;
	readonly scheduledAutomation?: {
		readonly fromStatusId: string | null;
		readonly toStatusId: string;
	};
	readonly reminder?: {
		readonly collection: ReminderItemSpecV1['collection'];
		readonly itemOperation: ReminderItemSpecV1['operation'];
	};
	readonly transition?: {
		readonly fromStatusId: string | null;
		readonly toStatusId: string;
		readonly fromCheckbox: RuntimeExactTaskMutationSnapshotV1['checkbox'];
		readonly toCheckbox: RuntimeExactTaskMutationSnapshotV1['checkbox'];
		readonly terminal: boolean;
		readonly finalizeActiveTimer: boolean;
		readonly materializeRecurrence: boolean;
		readonly autoUnpin: boolean;
	};
}

export interface RuntimeTaskFieldMutationPostflightRequirementsV1 {
	readonly primaryTaskState: true;
	readonly parentModified: boolean;
	readonly reminderSchedulerSettled: boolean;
	readonly scheduledAutomationSettled: boolean;
	readonly timerFinalized: boolean;
	readonly recurrenceMaterialized: boolean;
	readonly finishedTaskUnpinned: boolean;
}

export interface RuntimeTaskFieldMutationPostflightEvidenceV1 {
	readonly committedSourceRevision: string;
	readonly observedSourceRevision: string;
	/** Exact later inline timestamp proven by bounded settlement reconciliation. */
	readonly settlementDatetimeModified?: string;
}

export interface RuntimeTaskUpdateBatchItemPreparationV1 {
	readonly itemRef: string;
	readonly requestedCanonicalFields: readonly string[];
	readonly preparation: RuntimeTaskFieldMutationPreparationV1;
}

export interface RuntimeTaskUpdateBatchPreparationV1 {
	readonly kind: 'task-field-batch';
	readonly operation: 'update-batch';
	readonly filePath: string;
	readonly sourceContent: string;
	readonly sourceRevision: string;
	readonly items: readonly RuntimeTaskUpdateBatchItemPreparationV1[];
	readonly parentTasks: readonly RuntimeExactTaskMutationSnapshotV1[];
	readonly noChange: boolean;
}

export type RuntimeTaskUpdateBatchPreparationResultV1 =
	| { ok: true; value: RuntimeTaskUpdateBatchPreparationV1 }
	| {
		ok: false;
		code: StructuredErrorCodeV1;
		reason: string;
		retryable?: boolean;
	};

export function resolveRuntimeTaskFieldMutationPostflightEvidenceV1(
	filePath: string,
	resourceRevisions: readonly {
		readonly resourceKind: string;
		readonly resourceKey: string;
		readonly revision: string;
	}[],
	observedSourceContent: string | null,
): RuntimeTaskFieldMutationPostflightEvidenceV1 | null {
	if (observedSourceContent === null) return null;
	const matchingRevisions = resourceRevisions.filter(resource => (
		resource.resourceKind === 'task-source'
		&& resource.resourceKey === filePath
	));
	if (matchingRevisions.length !== 1) return null;
	const committedSourceRevision = matchingRevisions[0]?.revision ?? '';
	const observedSourceRevision = sha256HexV1(observedSourceContent);
	if (
		!/^[a-f0-9]{64}$/u.test(committedSourceRevision)
		|| observedSourceRevision !== committedSourceRevision
	) return null;
	return {
		committedSourceRevision,
		observedSourceRevision,
	};
}

export function resolveRuntimeInlineTaskUpdateSettlementEvidenceV1(
	prepared: RuntimeTaskFieldMutationPreparationV1,
	committedSourceContent: string,
	committedSourceRevision: string,
	observedSourceContent: string,
	keyMappings: readonly KeyMapping[],
	modifiedTimeFrontmatterKeys: readonly string[] = [],
	settlementWindow?: RuntimeMutationSettlementWindowV1,
): { revision: string; datetimeModified?: string } | null {
	if (
		(prepared.operation !== 'update' && prepared.operation !== 'transition')
		|| sha256HexV1(committedSourceContent) !== committedSourceRevision
	) return null;
	if (observedSourceContent === committedSourceContent) {
		return { revision: sha256HexV1(observedSourceContent) };
	}
	const lineNumber = prepared.task.locator.representation === 'inline'
		? prepared.task.locator.lineNumber
		: -1;
	const committedLines = committedSourceContent.split('\n');
	const observedLines = observedSourceContent.split('\n');
	if (committedLines.length !== observedLines.length) return null;
	if (prepared.task.locator.representation === 'file') {
		const driftLineNumbers = committedLines.flatMap((line, index) => (
			line !== observedLines[index] ? [index] : []
		));
		if (driftLineNumbers.length !== 1) return null;
		const driftLineNumber = driftLineNumbers[0];
		if (
			driftLineNumber === undefined
			|| !resolveBoundedModifiedTimeFrontmatterDriftV1(
				committedLines,
				observedLines,
				driftLineNumber,
				modifiedTimeFrontmatterKeys,
				keyMappings,
				settlementWindow,
			)
		) return null;
		const restoredObservedLines = [...observedLines];
		restoredObservedLines[driftLineNumber] = committedLines[driftLineNumber] ?? '';
		return restoredObservedLines.join('\n') === committedSourceContent
			? { revision: sha256HexV1(observedSourceContent) }
			: null;
	}
	if (lineNumber < 0 || lineNumber >= committedLines.length) return null;
	const nonTargetDriftLineNumbers = committedLines.flatMap((line, index) => (
		index !== lineNumber && line !== observedLines[index] ? [index] : []
	));
	if (nonTargetDriftLineNumbers.length > 1) return null;
	const filePath = prepared.task.locator.filePath;
	const committedLine = committedLines[lineNumber] ?? '';
	const observedLine = observedLines[lineNumber] ?? '';
	const committedTask = parseTaskLine(committedLine, lineNumber, filePath, [...keyMappings]);
	const observedTask = parseTaskLine(observedLine, lineNumber, filePath, [...keyMappings]);
	if (
		!committedTask
		|| !observedTask
		|| committedTask.operonId !== prepared.task.operonId
		|| observedTask.operonId !== prepared.task.operonId
	) return null;
	const committedModified = committedTask.fields.filter(field => field.key === 'datetimeModified');
	const observedModified = observedTask.fields.filter(field => field.key === 'datetimeModified');
	if (committedModified.length !== 1 || observedModified.length !== 1) return null;
	const committedField = committedModified[0];
	const observedField = observedModified[0];
	const expectedModified = prepared.fieldValues['datetimeModified'] ?? '';
	const committedCanonical = committedField
		? parseStrictCanonicalLocalDatetime(committedField.value)
		: null;
	const observedCanonical = observedField
		? parseStrictCanonicalLocalDatetime(observedField.value)
		: null;
	const targetLineChanged = observedLine !== committedLine;
	if (
		!committedField
		|| !observedField
		|| committedField.sourceKey !== observedField.sourceKey
		|| committedCanonical !== expectedModified
		|| observedCanonical !== observedField.value
		|| (
			targetLineChanged
				? observedCanonical.localeCompare(committedCanonical) <= 0
				: observedCanonical !== committedCanonical
		)
	) return null;
	const restoredObservedTaskLine = [
		observedLine.slice(0, observedField.valueRange.from),
		committedField.rawValue,
		observedLine.slice(observedField.valueRange.to),
	].join('');
	const restoredObservedLines = [...observedLines];
	restoredObservedLines[lineNumber] = restoredObservedTaskLine;
	const frontmatterDriftLineNumber = nonTargetDriftLineNumbers[0];
	if (frontmatterDriftLineNumber !== undefined) {
		if (!resolveBoundedModifiedTimeFrontmatterDriftV1(
			committedLines,
			observedLines,
			frontmatterDriftLineNumber,
			modifiedTimeFrontmatterKeys,
			keyMappings,
			settlementWindow,
		)) return null;
		restoredObservedLines[frontmatterDriftLineNumber] = committedLines[frontmatterDriftLineNumber] ?? '';
	}
	return restoredObservedLines.join('\n') === committedSourceContent
		? {
			revision: sha256HexV1(observedSourceContent),
			...(targetLineChanged ? { datetimeModified: observedCanonical } : {}),
		}
		: null;
}

export function resolveRuntimeInlineTaskUpdateSettlementRevisionV1(
	prepared: RuntimeTaskFieldMutationPreparationV1,
	committedSourceContent: string,
	committedSourceRevision: string,
	observedSourceContent: string,
	keyMappings: readonly KeyMapping[],
	modifiedTimeFrontmatterKeys: readonly string[] = [],
	settlementWindow?: RuntimeMutationSettlementWindowV1,
): string | null {
	return resolveRuntimeInlineTaskUpdateSettlementEvidenceV1(
		prepared,
		committedSourceContent,
		committedSourceRevision,
		observedSourceContent,
		keyMappings,
		modifiedTimeFrontmatterKeys,
		settlementWindow,
	)?.revision ?? null;
}

export function runtimeInlineTaskUpdateSettlementEvidenceSourceV1(
	preparedMutation: RuntimePreparedMutationV1,
	commit: RuntimePreparedMutationCommitV1,
): { preparation: RuntimeTaskFieldMutationPreparationV1; resourceKey: string } | null {
	const token = preparedMutation.token as {
		kind?: unknown;
		prepared?: RuntimeTaskFieldMutationPreparationV1;
	};
	const prepared = token?.kind === 'semantic-transition-plan'
		? token.prepared
		: token as RuntimeTaskFieldMutationPreparationV1;
	const evidence = commit.primaryTaskSourceCommitEvidence;
	if (
		!prepared
		|| prepared.kind !== 'task-fields'
		|| (prepared.operation !== 'update' && prepared.operation !== 'transition')
		|| !evidence
		|| evidence.resourceKey !== prepared.task.locator.filePath
		|| sha256HexV1(evidence.content) !== evidence.revision
	) return null;
	const matchingResources = commit.groupResults.flatMap(
		group => group.resourceRevisions ?? [],
	).filter(resource => (
		resource.resourceKind === 'task-source'
		&& resource.resourceKey === evidence.resourceKey
	));
	if (
		matchingResources.length !== 1
		|| matchingResources[0]?.revision !== evidence.revision
	) return null;
	return { preparation: prepared, resourceKey: evidence.resourceKey };
}

export function refreshRuntimeInlineTaskUpdateSettlementEvidenceV1(
	preparedMutation: RuntimePreparedMutationV1,
	commit: RuntimePreparedMutationCommitV1,
	observedSourceContent: string | null,
	keyMappings: readonly KeyMapping[],
	modifiedTimeFrontmatterKeys: readonly string[] = [],
	settlementWindow?: RuntimeMutationSettlementWindowV1,
): RuntimePreparedMutationCommitV1 {
	const source = runtimeInlineTaskUpdateSettlementEvidenceSourceV1(preparedMutation, commit);
	const evidence = commit.primaryTaskSourceCommitEvidence;
	if (!source || !evidence || observedSourceContent === null) return commit;
	const revision = resolveRuntimeInlineTaskUpdateSettlementRevisionV1(
		source.preparation,
		evidence.content,
		evidence.revision,
		observedSourceContent,
		keyMappings,
		modifiedTimeFrontmatterKeys,
		settlementWindow,
	);
	if (!revision || revision === evidence.revision) return commit;
	return {
		...commit,
		groupResults: commit.groupResults.map(group => ({
			...group,
			...(group.resourceRevisions
				? {
					resourceRevisions: group.resourceRevisions.map(resource => (
						resource.resourceKind === 'task-source'
						&& resource.resourceKey === evidence.resourceKey
							? { ...resource, revision }
							: resource
					)),
				}
				: {}),
		})),
	};
}

export interface RuntimeTaskDependencySnapshotV1 {
	readonly operonId: string;
	readonly checkbox: RuntimeExactTaskMutationSnapshotV1['checkbox'];
	readonly fieldValues: Readonly<Record<string, string>>;
}

export function runtimeTaskTargetDigestV1(task: {
	readonly operonId: string;
	readonly locator: TaskSourceLocatorV1;
	readonly sourceContent: string;
}): string {
	return sha256HexV1([
		task.operonId,
		task.locator.representation,
		task.locator.filePath,
		task.locator.representation === 'inline' ? String(task.locator.lineNumber) : '',
		sha256HexV1(task.sourceContent),
	].join('\0'));
}

export interface RuntimeTimerMutationPreparationV1 {
	readonly kind: 'timer';
	readonly operation: 'start' | 'stop';
	/** Null means the canonical unassigned timer for start, or the current active timer for stop. */
	readonly targetOperonId: string | null;
	readonly expectedActive: {
		operonId: string | null;
		start: string;
		isUnassigned: boolean;
	} | null;
	readonly noChange: boolean;
	readonly affectedFilePaths: readonly string[];
}

export interface RuntimeSourceTransitionGroupV1 {
	readonly filePath: string;
	readonly expectedContent: string | null;
	readonly nextContent?: string;
	readonly action: 'create' | 'modify' | 'trash';
}

export interface RuntimeSourceTransitionPreparationV1 {
	readonly kind: 'source-transition';
	readonly operation: 'relocate-inline' | 'convert' | 'delete';
	readonly operonId: string;
	readonly beforeLocator: TaskSourceLocatorV1;
	readonly afterLocator?: TaskSourceLocatorV1;
	readonly groups: readonly RuntimeSourceTransitionGroupV1[];
	readonly expectedDescription?: string;
	readonly cleanupPinned?: boolean;
	readonly cleanupPinnedEntry?: {
		readonly pinned: boolean;
		readonly updatedAt: string;
	};
	readonly conversionEffect?: SealedConversionEffectV1;
	readonly rollbackCreatedTargetOnFailure?: boolean;
	readonly parentTask?: RuntimeExactTaskMutationSnapshotV1;
	readonly ancestorTasks?: readonly RuntimeExactTaskMutationSnapshotV1[];
	readonly repeatSeriesId?: string;
	readonly expectedTaskState?: {
		readonly checkbox: RuntimeExactTaskMutationSnapshotV1['checkbox'];
		readonly fieldValues: Readonly<Record<string, string>>;
		readonly tags: readonly string[];
	};
}

export type RuntimeTaskFieldMutationPreparationResultV1 =
	| { ok: true; value: RuntimeTaskFieldMutationPreparationV1 }
	| {
		ok: false;
		code: StructuredErrorCodeV1;
		reason: string;
		retryable?: boolean;
	};

export interface RuntimeTaskMutationAdapterPortsV1 {
	readonly catalog: CatalogProjectionV1;
	getTask(operonId: string): RuntimeExactTaskMutationSnapshotV1 | null;
	getDependencyTask?(operonId: string): RuntimeTaskDependencySnapshotV1 | null;
	getAllDependencyTasks?(): readonly RuntimeTaskDependencySnapshotV1[];
}

export function prepareRuntimeTaskFieldMutationV1(
	request: MutationPreviewRequestV1,
	effectiveAt: string,
	ports: RuntimeTaskMutationAdapterPortsV1,
): RuntimeTaskFieldMutationPreparationResultV1 {
	if (!request.target) {
		return failure('invalid-request', 'This mutation requires an exact task target.');
	}
	const task = ports.getTask(request.target.operonId);
	if (!task) return failure('entity-not-found', 'The exact Operon task does not exist.');
	if (task.duplicate) {
		return failure('duplicate-operon-id', 'Duplicate operonId instances block mutation.');
	}
	if (!sameTaskSourceLocatorV1(task.locator, request.target.locator)) {
		return failure('stale-source', 'The exact task locator changed before preview.');
	}
	const sourceRevision = sha256HexV1(task.sourceContent);
	const spec = request.spec;
	let prepared:
		| {
			ok: true;
			operation: RuntimeTaskFieldMutationPreparationV1['operation'];
			fieldValues: Record<string, string>;
			summary: string;
			scheduledAutomation?: RuntimeTaskFieldMutationPreparationV1['scheduledAutomation'];
			reminder?: RuntimeTaskFieldMutationPreparationV1['reminder'];
			transition?: RuntimeTaskFieldMutationPreparationV1['transition'];
		}
		| { ok: false; code: StructuredErrorCodeV1; reason: string };
	if (spec.operation === 'update') {
		prepared = prepareUpdate(spec, task, ports);
	} else if (spec.operation === 'add' || spec.operation === 'replace' || spec.operation === 'remove') {
		prepared = prepareReminder(spec, task, ports.catalog, effectiveAt);
	} else if (spec.operation === 'transition') {
		prepared = prepareTransition(spec, task, ports, effectiveAt);
	} else {
		return failure('mutation-kind-mismatch', 'This adapter handles task field mutations only.');
	}
	if (!prepared.ok) return prepared;
	const noChange = !hasTaskFieldChange(task, prepared.fieldValues);
	const fieldValues = noChange
		? {}
		: {
			...prepared.fieldValues,
			datetimeModified: toLocalDatetime(effectiveAt),
		};
	const rawParent = (task.fieldValues['parentTask'] ?? '').trim();
	const parentOperonId = resolveSingleOperonId(rawParent);
	if (rawParent && !parentOperonId) {
		return failure(
			'invalid-request',
			'The task has an invalid or ambiguous parentTask relation, so parent postflight cannot be sealed.',
		);
	}
	return {
		ok: true,
		value: {
			kind: 'task-fields',
			operation: prepared.operation,
			task,
			fieldValues,
			sourceRevision,
			targetDigest: runtimeTaskTargetDigestV1(task),
			summary: noChange
				? `${prepared.summary} No durable task-source change is required.`
				: prepared.summary,
			noChange,
			...(parentOperonId ? { parentOperonId } : {}),
			...(prepared.scheduledAutomation
				? { scheduledAutomation: prepared.scheduledAutomation }
				: {}),
			...(prepared.reminder ? { reminder: prepared.reminder } : {}),
			...(prepared.transition ? { transition: prepared.transition } : {}),
		},
	};
}

export function prepareRuntimeTaskUpdateBatchV1(
	request: MutationPreviewRequestV1,
	effectiveAt: string,
	ports: RuntimeTaskMutationAdapterPortsV1,
): RuntimeTaskUpdateBatchPreparationResultV1 {
	if (request.spec.operation !== 'update-batch') {
		return failure('mutation-kind-mismatch', 'This adapter requires an update-batch spec.');
	}
	if (request.target) {
		return failure('invalid-request', 'update-batch owns its exact item targets.');
	}
	const spec: UpdateTaskBatchSpecV1 = request.spec;
	if (spec.items.length < 2 || spec.items.length > 64) {
		return failure('invalid-request', 'update-batch requires between 2 and 64 exact items.');
	}
	const itemRefs = new Set<string>();
	const operonIds = new Set<string>();
	const items: RuntimeTaskUpdateBatchItemPreparationV1[] = [];
	for (const item of spec.items) {
		if (itemRefs.has(item.itemRef) || operonIds.has(item.target.operonId)) {
			return failure('invalid-request', 'update-batch itemRef and target operonId values must be unique.');
		}
		itemRefs.add(item.itemRef);
		operonIds.add(item.target.operonId);
		if (item.target.locator.representation !== 'inline') {
			return failure('invalid-request', 'update-batch supports inline tasks only.');
		}
		const singleRequest: MutationPreviewRequestV1 = {
			...request,
			target: item.target,
			spec: { operation: 'update', changes: item.changes },
		};
		const prepared = prepareRuntimeTaskFieldMutationV1(singleRequest, effectiveAt, ports);
		if (!prepared.ok) return prepared;
		items.push({
			itemRef: item.itemRef,
			requestedCanonicalFields: item.changes.map(change => change.field),
			preparation: prepared.value,
		});
	}
	const first = items[0]?.preparation;
	if (!first) return failure('invalid-request', 'update-batch has no exact items.');
	const filePath = first.task.locator.filePath;
	const sourceContent = first.task.sourceContent;
	const sourceRevision = first.sourceRevision;
	if (items.some(item => (
		item.preparation.task.locator.representation !== 'inline'
		|| item.preparation.task.locator.filePath !== filePath
		|| item.preparation.task.sourceContent !== sourceContent
		|| item.preparation.sourceRevision !== sourceRevision
	))) {
		return failure('stale-source', 'update-batch targets must share one coherent inline Markdown source.');
	}
	const parentTasks = new Map<string, RuntimeExactTaskMutationSnapshotV1>();
	for (const item of items) {
		const prepared = item.preparation;
		if (prepared.noChange || !prepared.parentOperonId) continue;
		const parent = ports.getTask(prepared.parentOperonId);
		if (
			!parent
			|| parent.duplicate
			|| parent.locator.representation !== 'inline'
			|| parent.locator.filePath !== filePath
			|| parent.sourceContent !== sourceContent
		) {
			return failure(
				'invalid-request',
				'update-batch cannot induce a parent modification outside its exact common source.',
			);
		}
		parentTasks.set(parent.operonId, parent);
	}
	return {
		ok: true,
		value: {
			kind: 'task-field-batch',
			operation: 'update-batch',
			filePath,
			sourceContent,
			sourceRevision,
			items,
			parentTasks: [...parentTasks.values()],
			noChange: items.every(item => item.preparation.noChange),
		},
	};
}

export function buildRuntimeTaskUpdateBatchEffectsV1(
	prepared: RuntimeTaskUpdateBatchPreparationV1,
	plannedSourceDigest: string,
): SealedUpdateBatchEffectV1[] {
	const inducedParentIds = new Set(prepared.parentTasks.map(task => task.operonId));
	return prepared.items.map(item => ({
		itemRef: item.itemRef,
		operonId: item.preparation.task.operonId,
		locator: item.preparation.task.locator as Extract<TaskSourceLocatorV1, { representation: 'inline' }>,
		beforeDigest: item.preparation.targetDigest,
		requestedCanonicalFields: [...item.requestedCanonicalFields],
		action: item.preparation.noChange && !inducedParentIds.has(item.preparation.task.operonId)
			? 'no-change'
			: 'update',
		directChange: !item.preparation.noChange,
		plannedSourceDigest,
	}));
}

export function buildRuntimeConversionAncestorPredictedEffectsV1(
	sourceGroupPaths: readonly string[],
	ancestorFilePaths: readonly string[],
): PredictedEffectV1[] {
	const coveredSourcePaths = new Set(sourceGroupPaths);
	return [...new Set(ancestorFilePaths)]
		.filter(filePath => !coveredSourcePaths.has(filePath))
		.map(filePath => ({
			resourceKind: 'task-source',
			resourceKey: filePath,
			action: 'update',
			summary: 'Refresh sealed conversion ancestor timestamps and hierarchy aggregates.',
		}));
}

export function verifyRuntimeTaskUpdateBatchPrimaryPostflightV1(
	prepared: RuntimeTaskUpdateBatchPreparationV1,
	getTask: (operonId: string) => RuntimeExactTaskMutationSnapshotV1 | null,
	evidence?: RuntimeTaskFieldMutationPostflightEvidenceV1,
): boolean {
	return prepared.items.every(item => verifyRuntimeTaskFieldMutationPrimaryPostflightV1(
		item.preparation,
		getTask(item.preparation.task.operonId),
		evidence,
	));
}

function prepareUpdate(
	spec: UpdateTaskSpecV1,
	task: RuntimeExactTaskMutationSnapshotV1,
	ports: RuntimeTaskMutationAdapterPortsV1,
):
	| {
		ok: true;
		operation: 'update';
		fieldValues: Record<string, string>;
		summary: string;
		scheduledAutomation?: RuntimeTaskFieldMutationPreparationV1['scheduledAutomation'];
	}
	| { ok: false; code: StructuredErrorCodeV1; reason: string } {
	const { catalog } = ports;
	if (spec.changes.length === 0) {
		return failure('invalid-request', 'Task update requires at least one field change.');
	}
	const seenFields = new Set<string>();
	if (
		(task.fieldValues['repeat'] ?? '').trim()
		&& spec.changes.some(change => [
			'dateDue', 'dateScheduled', 'dateStarted', 'datetimeStart', 'datetimeEnd', 'estimate',
		].includes(change.field))
	) {
		return failure(
			'field-not-writable',
			'Recurring task temporal fields require an explicit recurrence scope that V1 does not yet define.',
		);
	}
	const payload: Record<string, string | string[]> = {};
	for (const change of spec.changes) {
		if (seenFields.has(change.field)) {
			return failure('invalid-request', `Task update contains the field more than once: ${change.field}`);
		}
		seenFields.add(change.field);
		const descriptor = catalog.fields.find(field => field.canonicalKey === change.field);
		if (
			!descriptor
			|| descriptor.mappingStatus !== 'mapped'
			|| !descriptor.readable
			|| descriptor.mutationClass !== 'general-update'
			|| descriptor.mutationOwner !== 'tasks.update'
			|| descriptor.valueType !== change.valueType
		) {
			return failure('field-not-writable', `Field is not writable through tasks.update: ${change.field}`);
		}
		if (!('value' in change)) {
			if (change.field === 'description') {
				return failure('field-not-writable', 'Task description cannot be cleared.');
			}
			if (change.field === 'tags') payload['_tags'] = '';
			else payload[change.field] = '';
			continue;
		}
		if (change.field === 'priority') {
			if (typeof change.value !== 'string') {
				return failure('invalid-request', 'Priority update requires one stable priority ID.');
			}
			const matches = catalog.taxonomy.priorities.filter(priority => priority.id === change.value);
			if (matches.length !== 1) {
				return failure('invalid-request', 'Priority stable ID is missing or ambiguous.');
			}
			payload[change.field] = matches[0].label;
			continue;
		}
		const serialized = serializeUpdateValue(change.valueType, change.value);
		if (serialized === null) {
			return failure('invalid-request', `Field value does not match its declared type: ${change.field}`);
		}
		if (
			change.field === 'description'
			&& (
				typeof serialized !== 'string'
				|| !serialized.trim()
				|| containsRuntimeUnsafeScalarCharacter(serialized)
			)
		) {
			return failure('invalid-request', 'Task description must be non-empty and single-line.');
		}
		if (
			change.field === 'tags'
			&& (
				!Array.isArray(change.value)
				|| change.value.some(tag => (
					typeof tag !== 'string'
					|| !/^[\p{L}\p{N}_/-]+$/u.test(tag.replace(/^#/u, ''))
				))
			)
		) {
			return failure('invalid-request', 'Tags must use portable Obsidian tag-token characters.');
		}
		if (change.field === 'description') payload['_description'] = serialized;
		else if (change.field === 'tags') payload['_tags'] = serialized;
		else payload[change.field] = serialized;
	}
	const fieldValues = normalizeTaskFieldPatch(
		task.fieldValues,
		payload,
	);
	const scheduledAutomation = resolveScheduledAutomation(task, fieldValues, catalog);
	if (scheduledAutomation) {
		const blockers = resolveActiveBlockerIds(task, ports, catalog);
		if (blockers.length > 0) {
			return failure(
				'invalid-request',
				`Scheduled-status automation is blocked by active dependencies: ${blockers.join(', ')}.`,
			);
		}
		fieldValues['status'] = scheduledAutomation.statusValue;
		fieldValues['_checkbox'] = 'open';
	}
	return {
		ok: true,
		operation: 'update',
		fieldValues,
		summary: `Update ${spec.changes.length} allowed field(s) on ${task.operonId}.`,
		...(scheduledAutomation
			? {
				scheduledAutomation: {
					fromStatusId: resolveCurrentStatusId(task.fieldValues['status'] ?? '', catalog),
					toStatusId: scheduledAutomation.statusId,
				},
			}
			: {}),
	};
}

function containsRuntimeUnsafeScalarCharacter(value: string): boolean {
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (code <= 31 || code === 127) return true;
	}
	return false;
}

function prepareReminder(
	spec: ReminderItemSpecV1,
	task: RuntimeExactTaskMutationSnapshotV1,
	catalog: CatalogProjectionV1,
	effectiveAt: string,
):
	| {
		ok: true;
		operation: 'reminder-item';
		fieldValues: Record<string, string>;
		summary: string;
		reminder: RuntimeTaskFieldMutationPreparationV1['reminder'];
	}
	| { ok: false; code: StructuredErrorCodeV1; reason: string } {
	const policy = catalog.policies.reminders.fields.find(
		field => field.canonicalKey === spec.collection,
	);
	if (policy?.availability !== 'available') {
		return failure('capability-unavailable', 'The reminder property mapping is unavailable or ambiguous.');
	}
	const currentValue = task.fieldValues[spec.collection] ?? '';
	const current = spec.operation === 'add'
		? undefined
		: resolveReminderItemRef(spec.itemId, spec.expectedValue);
	if (spec.operation !== 'add' && !current) {
		return failure('invalid-request', 'Reminder replace/remove requires a sealed item ID and expected value.');
	}
	if (
		(spec.operation === 'add' || spec.operation === 'replace')
		&& spec.value === undefined
	) {
		return failure('invalid-request', 'Reminder add/replace requires a new item value.');
	}
	if (
		spec.collection === 'reminderDatetimes'
		&& spec.operation !== 'remove'
		&& isPastAbsoluteReminder(spec.value ?? '', effectiveAt)
	) {
		return failure('invalid-request', 'Past absolute reminder datetimes cannot be added or replaced.');
	}
	if (spec.collection === 'reminderRules' && spec.operation !== 'remove') {
		const resolution = resolveReminderRule(spec.value ?? '', task.fieldValues);
		if (resolution.status === 'missing-anchor') {
			return failure(
				'invalid-request',
				`Reminder rule requires a populated ${resolution.anchor} anchor on the target task.`,
			);
		}
		if (resolution.status === 'invalid-anchor') {
			return failure(
				'invalid-request',
				`Reminder rule anchor ${resolution.anchor} is not a valid date or datetime.`,
			);
		}
	}
	const mutation = spec.operation === 'add'
		? { action: 'add' as const, nextValue: spec.value ?? '' }
		: spec.operation === 'replace'
			? { action: 'replace' as const, current: current!, nextValue: spec.value ?? '' }
			: { action: 'remove' as const, current: current! };
	const result = applyReminderListMutation({
		fieldKey: spec.collection,
		currentValue,
		mutation,
	});
	if (!result.ok) {
		return failure(
			result.reason === 'stale-item' ? 'stale-source' : 'invalid-request',
			`Reminder item mutation failed: ${result.reason}.`,
		);
	}
	return {
		ok: true,
		operation: 'reminder-item',
		fieldValues: { [spec.collection]: result.fieldValue },
		summary: `${spec.operation} one ${spec.collection} item on ${task.operonId}.`,
		reminder: {
			collection: spec.collection,
			itemOperation: spec.operation,
		},
	};
}

function prepareTransition(
	spec: TransitionTaskSpecV1,
	task: RuntimeExactTaskMutationSnapshotV1,
	ports: RuntimeTaskMutationAdapterPortsV1,
	effectiveAt: string,
):
	| {
		ok: true;
		operation: 'transition';
		fieldValues: Record<string, string>;
		summary: string;
		transition: RuntimeTaskFieldMutationPreparationV1['transition'];
	}
	| { ok: false; code: StructuredErrorCodeV1; reason: string } {
	const { catalog } = ports;
	const matches = catalog.taxonomy.pipelines.flatMap(pipeline => (
		pipeline.statuses
			.filter(status => status.id === spec.targetStatusId)
			.map(status => ({ pipeline, status }))
	));
	if (
		matches.length !== 1
		|| matches[0].pipeline.identityStatus !== 'resolved'
		|| matches[0].status.identityStatus !== 'resolved'
	) {
		return failure('invalid-request', 'Target status stable ID is missing or ambiguous.');
	}
	const current = resolveCurrentStatusId(task.fieldValues['status'] ?? '', catalog);
	if (spec.expectedStatusId !== undefined && current !== spec.expectedStatusId) {
		return failure('stale-source', 'Current status no longer matches expectedStatusId.');
	}
	const blockers = resolveActiveBlockerIds(task, ports, catalog);
	if (current !== spec.targetStatusId && blockers.length > 0) {
		return failure(
			'invalid-request',
			`Semantic transition is blocked by active dependencies: ${blockers.join(', ')}.`,
		);
	}
	const { pipeline, status } = matches[0];
	const companion = spec.changes && spec.changes.length > 0
		? prepareUpdate(
			{ operation: 'update', changes: spec.changes },
			task,
			ports,
		)
		: null;
	if (companion && !companion.ok) return companion;
	const checkbox = status.isFinished ? 'done' : status.isCancelled ? 'cancelled' : 'open';
	const local = toLocalDatetime(effectiveAt);
	const today = local.slice(0, 10);
	const fieldValues: Record<string, string> = {
		...(companion?.ok ? companion.fieldValues : {}),
		status: composeStatusValue(pipeline.name, status.label),
		_checkbox: checkbox,
		dateCompleted: checkbox === 'done' ? (task.fieldValues['dateCompleted'] || today) : '',
		dateCancelled: checkbox === 'cancelled' ? (task.fieldValues['dateCancelled'] || today) : '',
	};
	return {
		ok: true,
		operation: 'transition',
		fieldValues,
		summary: `Transition ${task.operonId} to status ${status.id}`
			+ `${companion?.ok ? ` with ${spec.changes?.length ?? 0} allowlisted field change(s)` : ''}.`,
		transition: {
			fromStatusId: current,
			toStatusId: status.id,
			fromCheckbox: task.checkbox,
			toCheckbox: checkbox,
			terminal: checkbox !== 'open',
			finalizeActiveTimer: checkbox !== 'open' && task.activeTimerStart !== undefined,
			materializeRecurrence: (
				checkbox !== 'open'
				&& task.checkbox === 'open'
				&& !!(task.fieldValues['repeat'] ?? '').trim()
			),
			autoUnpin: checkbox !== 'open' && catalog.policies.automation.pinnedDockAutoUnpinFinished,
		},
	};
}

function resolveScheduledAutomation(
	task: RuntimeExactTaskMutationSnapshotV1,
	fieldValues: Readonly<Record<string, string>>,
	catalog: CatalogProjectionV1,
): { statusId: string; statusValue: string } | null {
	const previous = (task.fieldValues['dateScheduled'] ?? '').trim();
	const next = (fieldValues['dateScheduled'] ?? task.fieldValues['dateScheduled'] ?? '').trim();
	if (previous || !next || task.checkbox !== 'open') return null;
	const currentStatus = (fieldValues['status'] ?? task.fieldValues['status'] ?? '').trim();
	const currentPipelineMatches = catalog.taxonomy.pipelines.filter(pipeline => (
		pipeline.identityStatus === 'resolved'
		&& pipeline.statuses.some(status => (
			status.identityStatus === 'resolved'
			&& composeStatusValue(pipeline.name, status.label) === currentStatus
		))
	));
	const currentPipeline = currentPipelineMatches.length === 1
		? currentPipelineMatches[0]
		: undefined;
	const defaultPipeline = catalog.taxonomy.defaultPipeline.id
		? catalog.taxonomy.pipelines.find(pipeline => pipeline.id === catalog.taxonomy.defaultPipeline.id)
		: undefined;
	const pipeline = currentPipeline ?? defaultPipeline;
	if (!pipeline || pipeline.identityStatus !== 'resolved') return null;
	const targets = pipeline.statuses.filter(status => (
		status.identityStatus === 'resolved'
		&& status.isScheduledTarget
		&& !status.isFinished
		&& !status.isCancelled
	));
	if (targets.length !== 1) return null;
	return {
		statusId: targets[0].id,
		statusValue: composeStatusValue(pipeline.name, targets[0].label),
	};
}

function resolveActiveBlockerIds(
	task: RuntimeExactTaskMutationSnapshotV1,
	ports: RuntimeTaskMutationAdapterPortsV1,
	catalog: CatalogProjectionV1,
): string[] {
	const blockerIds = new Set(splitTaskListValue(task.fieldValues['blockedBy']));
	for (const candidate of ports.getAllDependencyTasks?.() ?? []) {
		if (
			candidate.operonId !== task.operonId
			&& splitTaskListValue(candidate.fieldValues['blocking']).includes(task.operonId)
		) blockerIds.add(candidate.operonId);
	}
	return [...blockerIds]
		.filter(blockerId => !isResolvedBlocker(
			ports.getDependencyTask?.(blockerId) ?? ports.getTask(blockerId),
			catalog,
		))
		.sort((left, right) => left.localeCompare(right));
}

function isResolvedBlocker(
	task: RuntimeTaskDependencySnapshotV1 | null,
	catalog: CatalogProjectionV1,
): boolean {
	if (!task) return false;
	const statusId = resolveCurrentStatusId(task.fieldValues['status'] ?? '', catalog);
	if (statusId) {
		const status = catalog.taxonomy.pipelines
			.flatMap(pipeline => pipeline.statuses)
			.find(candidate => candidate.id === statusId);
		if (status) return status.isFinished || status.isCancelled;
	}
	return task.checkbox !== 'open'
		|| !!(task.fieldValues['dateCompleted'] ?? '').trim()
		|| !!(task.fieldValues['dateCancelled'] ?? '').trim();
}

function isPastAbsoluteReminder(value: string, effectiveAt: string): boolean {
	const parsed = parseAbsoluteReminder(value);
	if (!parsed.ok) return false;
	const reminderEpoch = new Date(parsed.value.localDatetime).getTime();
	const effectiveEpoch = Date.parse(effectiveAt);
	return Number.isFinite(reminderEpoch)
		&& Number.isFinite(effectiveEpoch)
		&& reminderEpoch <= effectiveEpoch;
}

function hasTaskFieldChange(
	task: RuntimeExactTaskMutationSnapshotV1,
	fieldValues: Readonly<Record<string, string>>,
): boolean {
	for (const [field, next] of Object.entries(fieldValues)) {
		if (field === '_description') {
			if (task.description !== next) return true;
		} else if (field === '_tags') {
			if (task.tags.join('; ') !== next) return true;
		} else if (field === '_checkbox') {
			if (task.checkbox !== next) return true;
		} else if ((task.fieldValues[field] ?? '') !== next) {
			return true;
		}
	}
	return false;
}

function resolveSingleOperonId(value: string | undefined): string | null {
	const ids = splitTaskListValue(value);
	return ids.length === 1 && /^[a-z0-9]{7}$/u.test(ids[0]) ? ids[0] : null;
}

function resolveCurrentStatusId(value: string, catalog: CatalogProjectionV1): string | null {
	const matches = catalog.taxonomy.pipelines.flatMap(pipeline => (
		pipeline.statuses
			.filter(status => composeStatusValue(pipeline.name, status.label) === value)
			.map(status => status.id)
	));
	return matches.length === 1 ? matches[0] : null;
}

function resolveReminderItemRef(
	itemId: string | undefined,
	expectedValue: string | undefined,
): { index: number; rawValue: string } | null {
	if (!itemId || expectedValue === undefined) return null;
	const match = /^item-(\d+)-([a-f0-9]{64})$/u.exec(itemId);
	if (!match) return null;
	const index = Number.parseInt(match[1], 10);
	if (!Number.isSafeInteger(index)) return null;
	if (sha256HexV1(`${index}\0${expectedValue.trim()}`) !== match[2]) return null;
	return { index, rawValue: expectedValue };
}

export function reminderItemIdV1(index: number, rawValue: string): string {
	return `item-${index}-${sha256HexV1(`${index}\0${rawValue.trim()}`)}`;
}

export function getRuntimeTaskFieldMutationPostflightRequirementsV1(
	prepared: RuntimeTaskFieldMutationPreparationV1,
): RuntimeTaskFieldMutationPostflightRequirementsV1 {
	return {
		primaryTaskState: true,
		parentModified: !prepared.noChange && prepared.parentOperonId !== undefined,
		reminderSchedulerSettled: !prepared.noChange && prepared.operation === 'reminder-item',
		scheduledAutomationSettled: !prepared.noChange && prepared.scheduledAutomation !== undefined,
		timerFinalized: !prepared.noChange && prepared.transition?.finalizeActiveTimer === true,
		recurrenceMaterialized: !prepared.noChange && prepared.transition?.materializeRecurrence === true,
		finishedTaskUnpinned: !prepared.noChange && prepared.transition?.autoUnpin === true,
	};
}

export function verifyRuntimeTaskFieldMutationPrimaryPostflightV1(
	prepared: RuntimeTaskFieldMutationPreparationV1,
	task: RuntimeExactTaskMutationSnapshotV1 | null,
	evidence?: RuntimeTaskFieldMutationPostflightEvidenceV1,
): boolean {
	if (
		!task
		|| task.duplicate
		|| task.operonId !== prepared.task.operonId
		|| !sameTaskSourceLocatorV1(task.locator, prepared.task.locator)
	) return false;
	for (const [field, expected] of Object.entries(prepared.fieldValues)) {
		if (field === '_description') {
			if (task.description !== expected) return false;
		} else if (field === '_tags') {
			const expectedTags = splitTaskListValue(expected);
			if (
				expectedTags.length !== task.tags.length
				|| expectedTags.some((tag, index) => task.tags[index] !== tag)
			) return false;
		} else if (field === '_checkbox') {
			if (task.checkbox !== expected) return false;
		} else {
			const observed = task.fieldValues[field] ?? '';
			const boundedInlineSettlement = field === 'datetimeModified'
				&& task.locator.representation === 'inline'
				&& evidence?.settlementDatetimeModified === observed;
			if (
				observed !== expected
				&& !(
					field === 'datetimeModified'
					&& evidence !== undefined
					&& /^[a-f0-9]{64}$/u.test(evidence.committedSourceRevision)
					&& evidence.observedSourceRevision === evidence.committedSourceRevision
					&& parseStrictCanonicalLocalDatetime(observed) === observed
					&& parseStrictCanonicalLocalDatetime(expected) === expected
					&& observed.localeCompare(expected) > 0
					&& (
						task.locator.representation === 'file'
						|| boundedInlineSettlement
					)
				)
			) return false;
		}
	}
	return true;
}

function serializeUpdateValue(
	valueType: string,
	value: string | number | boolean | string[],
): string | string[] | null {
	if (valueType === 'list') return Array.isArray(value) ? value : null;
	if (valueType === 'number') return typeof value === 'number' && Number.isFinite(value) ? String(value) : null;
	if (valueType === 'checkbox') return typeof value === 'boolean' ? String(value) : null;
	if (valueType === 'datetime') return typeof value === 'string'
		? canonicalizeLocalDatetime(value)
		: null;
	return typeof value === 'string' ? value : null;
}

function toLocalDatetime(value: string): string {
	const date = new Date(value);
	const pad = (part: number): string => String(part).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
		+ `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function failure(
	code: StructuredErrorCodeV1,
	reason: string,
): { ok: false; code: StructuredErrorCodeV1; reason: string } {
	return { ok: false, code, reason };
}
