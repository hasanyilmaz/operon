import { createHash, randomUUID } from 'node:crypto';
import {
	appendFileSync,
	existsSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';

import type {
	CliInvocationV1,
	CliResultEnvelopeV1,
	CatalogPoliciesV1,
	ContextPackV1,
	ContextRequestV1,
	ContextRevisionV1,
	FieldDescriptorV1,
	MutationApplyRequestV1,
	MutationPreviewRequestV1,
	OperonCatalogV1,
	SealedMutationPlanV1,
	TaskContextV1,
	TaskFinderResultV1,
	TaskGetResultV1,
} from '../../../src/agent-runtime/contracts/v1';
import {
	canonicalJsonV1,
	computeReceiptTargetDigestV1,
	computeSealedMutationPlanHashV1,
	sha256HexV1,
	toJsonValueV1,
} from '../../../src/agent-runtime/contracts/v1';
import { requestPathForTokenV1 } from '../../../packages/operon-cli/src/protocol';

const token = process.argv
	.find(value => value.startsWith('requestToken='))
	?.slice('requestToken='.length);
if (!token) throw new Error('PHASE7_PTY_REQUEST_TOKEN_REQUIRED');
const requestPath = requestPathForTokenV1(token);
const invocation = JSON.parse(
	readFileSync(requestPath, 'utf8'),
) as CliInvocationV1;
unlinkSync(requestPath);
const result = response(invocation);
if (process.env.OPERON_PHASE7_PTY_TRACE) {
	appendFileSync(
		process.env.OPERON_PHASE7_PTY_TRACE,
		`${JSON.stringify({ command: invocation.command, result })}\n`,
	);
}
process.stdout.write(JSON.stringify(result));

function response(request: CliInvocationV1): CliResultEnvelopeV1 {
	switch (request.command) {
		case 'capabilities':
			return success(request, [
				'tasks.read',
				'tasks.finder',
				'catalog.read',
				'context.build',
				'tasks.inline.relocate.preview',
				'tasks.inline.relocate.apply',
				'tasks.convert.preview',
				'tasks.convert.apply',
					'tasks.delete.preview',
					'tasks.delete.apply',
					'timers.session.preview',
					'timers.session.apply',
				].map(id => ({ id, availability: 'available', stability: 'stable' })));
		case 'tasks.finder':
			return success(request, finderResult(request.requestId));
		case 'task.get':
			return success(request, taskGetResult(request.requestId));
		case 'catalog':
			return success(request, catalogResult(request.requestId));
		case 'context.build':
			return success(
				request,
				contextResult(request.request as ContextRequestV1),
			);
		case 'mutation.preview':
			return success(
				request,
				previewResult(request.request as MutationPreviewRequestV1),
			);
		case 'mutation.apply':
			if (
				scenario().startsWith('recovery-')
				&& !existsSync(recoveryMarker())
			) {
				writeFileSync(recoveryMarker(), 'apply-attempted\n');
				process.exitCode = 1;
				return success(request, { interrupted: true });
			}
			return success(
				request,
				appliedResult(request, request.request as MutationApplyRequestV1),
			);
		default:
			throw new Error(`PHASE7_PTY_UNEXPECTED_COMMAND:${request.command}`);
	}
}

function scenario(): string {
	return process.env.OPERON_PHASE7_PTY_SCENARIO ?? 'delete';
}

function recoveryMarker(): string {
	return process.env.OPERON_PHASE7_PTY_STATE ?? `${process.cwd()}/phase7-recovery-state`;
}

function appliedResult(
	invocation: CliInvocationV1,
	request: MutationApplyRequestV1,
) {
	const completedAt = new Date();
	return {
		contractVersion: 1,
		requestId: invocation.requestId,
		kind: 'mutation-result' as const,
		status: 'applied' as const,
		mutationMayHaveApplied: true,
		retryAllowed: false,
		groupResults: request.plan.atomicGroups.map(group => ({
			groupId: group.groupId,
			status: 'committed' as const,
		})),
		receipt: {
			contractVersion: 1,
			vaultIdentityHash: invocation.expectedVaultSha256,
			clientInstanceId: request.plan.clientInstanceId,
			idempotencyKeyHash: request.plan.idempotencyKeyHash,
			planHash: request.plan.planHash,
			mutationKind: request.plan.mutationKind,
			targetDigest: request.plan.receiptTargetDigest,
			terminalOutcome: 'applied' as const,
			effectiveAt: completedAt.toISOString(),
			completedAt: completedAt.toISOString(),
			expiresAt: new Date(completedAt.getTime() + 86_400_000).toISOString(),
		},
		postflight: {
			status: 'verified' as const,
			observedAt: completedAt.toISOString(),
			contextRevision: revision(),
		},
	};
}

function success(
	invocation: CliInvocationV1,
	result: unknown,
): CliResultEnvelopeV1 {
	return {
		contractVersion: 1,
		kind: 'cli-result',
		requestId: invocation.requestId,
		command: invocation.command,
		ok: true,
		transport: { channel: 'request-file', inputBytes: 256 },
		vaultIdentity: { expectedMatch: true },
		compatibility: {
			contractVersion: 1,
			compatible: true,
			runtimeApi: 1,
		},
		cliContract: 1,
		runtime: {
			appVersion: '1.13.3',
			plugin: { id: 'operon', version: '2.6.0', minAppVersion: '1.8.9' },
			apiVersion: 1,
		},
		timing: { handlerMs: 1 },
		warnings: [],
		result,
	} as CliResultEnvelopeV1;
}

function revision(): ContextRevisionV1 {
	return {
		index: { sessionId: 'phase7-pty', ramGeneration: 1, durable: { status: 'missing' } },
		settingsFingerprint: 'a'.repeat(64),
		pinnedGeneration: 0,
		activeTrackerGeneration: 0,
		repeatSeriesRevision: 0,
		projectSerialGeneration: 0,
		projectSerialSignature: 'b'.repeat(64),
	};
}

function freshness() {
	return {
		source: 'live-runtime' as const,
		coherence: 'verified' as const,
		observedAt: '2026-07-25T12:00:00.000Z',
		settled: true,
	};
}

function task(): TaskContextV1 {
	const currentScenario = scenario();
	const fileRepresentation = currentScenario === 'convert-file';
	const sameFileRelocation = currentScenario === 'relocate-same';
	const locator = fileRepresentation
		? { representation: 'file' as const, filePath: 'Tasks/Source.md' }
		: {
			representation: 'inline' as const,
			filePath: sameFileRelocation ? 'Daily/Target.md' : 'Daily/Source.md',
			lineNumber: 3,
		};
	return {
		identity: { operonId: 'abc1234', validity: 'canonical', mutationAllowed: true },
		description: `Phase 7 PTY ${currentScenario} fixture`,
		representation: locator.representation,
		locator,
		checkbox: 'open',
		workflow: {
			pipeline: { id: 'pipeline-work', label: 'Work' },
			status: { id: 'status-open', label: 'Open' },
		},
		priority: { id: 'priority-normal', label: 'Normal' },
		dates: {},
		datetimes: {},
		relationships: {
			childOperonIds: [],
			blockingOperonIds: [],
			blockedByOperonIds: [],
			relatedOperonIds: [],
		},
		recurrence: { repeating: false },
		tracker: { active: false, sessionCount: 0 },
		pinned: false,
		sourceRevision: { algorithm: 'sha256', contentDigest: 'c'.repeat(64) },
		contextRevision: revision(),
	};
}

function finderResult(requestId: string): TaskFinderResultV1 {
	return {
		contractVersion: 1,
		requestId,
		kind: 'task-finder-result',
		ok: true,
		freshness: freshness(),
		warnings: [],
		contextRevision: revision(),
		rows: [{ kind: 'task', task: task(), score: 1 }],
		page: {
			actualCount: 1,
			returnedCount: 1,
			truncated: false,
			asOf: '2026-07-25T12:00:00.000Z',
		},
		provenance: [],
		truncations: [],
	};
}

function taskGetResult(requestId: string): TaskGetResultV1 {
	return {
		contractVersion: 1,
		requestId,
		kind: 'task-get-result',
		ok: true,
		freshness: freshness(),
		warnings: [],
		contextRevision: revision(),
		task: task(),
		provenance: [],
		truncations: [],
	};
}

function catalogResult(requestId: string): OperonCatalogV1 {
	const settingsFingerprint = 'a'.repeat(64);
	const taxonomy = {
		defaultPipeline: { configuredValue: 'Work', id: 'pipeline-work', status: 'resolved' as const },
		defaultPriority: { configuredValue: 'Normal', id: 'priority-normal', status: 'resolved' as const },
		pipelines: [{
			id: 'pipeline-work',
			name: 'Work',
			description: 'Work tasks',
			order: 0,
			identityStatus: 'resolved' as const,
			statuses: [],
		}],
		priorities: [],
	};
	const fields: FieldDescriptorV1[] = [];
	const policies: CatalogPoliciesV1 = {
		creation: {
			descriptionRequired: true,
			assigneesRequired: false,
			defaultEstimateMinutes: 0,
			defaultToFileTask: false,
			fileTaskTargetFolder: 'Tasks',
			fileTaskTemplateFolder: 'Templates',
			defaultFileTemplateId: 'folder-file-task-template:Templates/Default.md',
			inlineTaskSaveMode: 'specific-file' as const,
			inlineTaskTargetFile: 'Tasks.md',
			inlineTaskHeading: '',
			dailyNoteAddsStartDate: false,
			dailyNoteAddsScheduledDate: false,
			createDailyNotesAsFileTasks: false,
			calendarInlineTaskHeading: '',
			builtInTemplateCandidates: [{
				id: 'builtin-minimal-file-task-template:pipeline-work',
				pipelineId: 'pipeline-work',
				initialStatusId: 'status-open',
			}],
		},
		inheritance: {
			fields: [],
			statusPipelineSource: 'default' as const,
			autoParentFileTask: false,
			autoParentLinkedFileSubtasks: false,
			fileTaskParentInlineTargetMode: 'default' as const,
			fileTaskParentFileTargetMode: 'default' as const,
			inlineTaskParentInlineTargetMode: 'default' as const,
			inlineTaskParentFileTargetMode: 'default' as const,
			inlineTaskParentFileHeadingKeyword: '',
		},
		exclusions: { folders: [] },
		filters: [],
		automation: {
			autoCompleteParentWhenAllChildrenTerminal: false,
			cascadeCancelToDescendants: false,
			newOccurrencePosition: 'below' as const,
			fileTaskAutoArchiveEnabled: false,
			fileTaskArchiveFolder: '',
			fileTaskArchiveDelaySeconds: 0,
			fileTaskArchiveOnlyFromFileTasksFolder: false,
			fileRepeatDestination: 'same-folder' as const,
			fileRepeatCustomFolder: '',
			estimateAutoReallocation: false,
			trackerSplitSessionsAtMidnight: false,
			reminderCatchUpWindowMinutes: 0,
			reminderAutoPinDueTasks: false,
			pinnedDockAutoPin: false,
			pinnedDockAutoUnpinFinished: false,
		},
		reminders: {
			fields: [
				{ canonicalKey: 'reminderDatetimes' as const, availability: 'available' as const },
				{ canonicalKey: 'reminderRules' as const, availability: 'available' as const },
			],
			ruleAnchors: [
				'datetimeStart',
				'datetimeEnd',
				'dateStarted',
				'dateScheduled',
				'dateDue',
			],
			itemActions: ['add', 'replace', 'remove'],
		},
		conversion: {
			directions: ['inline-to-file', 'file-to-inline'] as const,
			templateSelection: 'explicit-or-needs-template' as const,
			targetModes: ['exact-line', 'configured-target'] as const,
			inlineToFileMovesPlainCheckboxes: false,
			fileToInlineRequiresExplicitConfirmation: true,
		},
		taskUpdate: {
			writableKeys: [],
			customKeyPolicy: 'active-valid-nonreserved-text-number-date-datetime-list-checkbox' as const,
		},
		relationships: {
			writableFields: ['parentTask', 'blocking', 'blockedBy'] as const,
			actions: ['replace', 'clear'] as const,
			parentMaxTargets: 1,
			dependencyInverseWrites: true,
		},
		transitions: { actions: ['set-status', 'complete', 'cancel', 'reopen'] as const },
		timer: { actions: ['start', 'stop'] as const },
		inlineRelocation: { target: 'exact-blank-line' as const },
		deletion: {
			requiresExplicitConfirmation: true,
			deleteAdditionalTasks: false,
			referenceCleanup: 'explicit-or-block' as const,
		},
		projectSerialScopes: [],
	};
	const catalogRevision = sha256HexV1(canonicalJsonV1(toJsonValueV1({
		settingsFingerprint,
		taxonomy,
		fields,
		policies,
	})));
	return {
		contractVersion: 1,
		requestId,
		kind: 'catalog-result',
		ok: true,
		freshness: freshness(),
		warnings: [],
		contextRevision: revision(),
		settingsFingerprint,
		catalogRevision,
		taxonomy,
		fields,
		policies,
	} as OperonCatalogV1;
}

function contextResult(request: ContextRequestV1): ContextPackV1 {
	if (request.projection !== 'placement-candidates' || !request.placement) {
		throw new Error('PHASE7_PTY_PLACEMENT_REQUIRED');
	}
	const placement = request.placement.mode === 'files'
		? {
			mode: 'files' as const,
			actualCount: 1,
			returnedCount: 1,
			truncated: false,
			files: [{ filePath: 'Daily/Target.md', noteName: 'Target' }],
		}
		: {
			mode: 'lines' as const,
			filePath: request.placement.filePath,
			sourceRevision: {
				algorithm: 'sha256' as const,
				contentDigest: 'd'.repeat(64),
			},
			actualCount: 1,
			returnedCount: 1,
			truncated: false,
			lines: [{
				locator: {
					representation: 'inline' as const,
					filePath: request.placement.filePath,
					lineNumber: 8,
				},
				heading: 'Tasks',
				contextLabel: 'Under Tasks · blank line 9',
			}],
		};
	return {
		contractVersion: 1,
		requestId: request.requestId,
		kind: 'context-pack',
		ok: true,
		purpose: request.purpose,
		projection: request.projection,
		execution: freshness(),
		contextRevision: revision(),
		entities: [],
		relationships: { explicit: [], derived: [], inferred: [] },
		placement,
		summary: {
			entityCount: 0,
			relationshipCount: 0,
			openCount: 0,
			doneCount: 0,
			cancelledCount: 0,
		},
		provenance: [],
		truncations: [],
		warnings: [],
	};
}

function previewResult(request: MutationPreviewRequestV1) {
	const now = new Date();
	const currentTask = task();
	const currentScenario = scenario();
	const sealedSpec = request.spec.operation === 'relocate-inline'
		&& !('source' in request.spec)
		? {
			operation: 'relocate-inline' as const,
			source: {
				locator: currentTask.locator as Extract<
					TaskContextV1['locator'],
					{ representation: 'inline' }
				>,
				lineDigest: '3'.repeat(64),
				sourceRevision: currentTask.sourceRevision,
			},
			destination: {
				...request.spec.destination,
				lineDigest: '4'.repeat(64),
				sourceRevision: {
					algorithm: 'sha256' as const,
					contentDigest: 'd'.repeat(64),
				},
			},
		}
		: request.spec.operation === 'remove-session'
			? {
				...request.spec,
				expectedTrackers: '2026-07-27T09:00:00/2026-07-27T10:00:00',
				expectedDuration: 3600,
				selectedRawIndex: 0,
				expectedStart: '2026-07-27T09:00:00',
				expectedEnd: '2026-07-27T10:00:00',
				nextTrackers: '',
				nextDuration: 0,
				effectiveAt: '2026-07-27T12:00:00.000Z',
			}
			: request.spec;
	const destructive = request.spec.operation === 'delete'
		|| request.spec.operation === 'remove-session'
		|| (
			request.spec.operation === 'convert'
			&& request.spec.from === 'file'
			&& request.spec.to === 'inline'
		);
	const gatedMove = currentScenario === 'relocate-cross';
	const requiresConfirmation = destructive || gatedMove;
	const resourceKeys = (request.spec.operation === 'relocate-inline'
			? [...new Set([
				currentTask.locator.filePath,
				request.spec.destination.locator.filePath,
		])]
		: request.spec.operation === 'convert'
			? [
				currentTask.locator.filePath,
				request.spec.to === 'inline'
					? request.spec.target.filePath
					: request.spec.targetPath ?? 'Tasks/Converted.md',
			]
			: [currentTask.locator.filePath])
		.filter((resourceKey): resourceKey is string => typeof resourceKey === 'string')
		.sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
	const targets = [{
		operonId: request.target?.operonId,
		locator: request.target?.locator,
		targetDigest: createHash('sha256').update(JSON.stringify(request.target)).digest('hex'),
	}];
	const lossManifest = destructive && request.spec.operation === 'convert'
		? [{ kind: 'body-content' as const, digest: 'e'.repeat(64) }]
		: [];
	const plan: SealedMutationPlanV1 = {
		contractVersion: 1,
		planId: `phase7-pty-${randomUUID()}`,
		planHash: '',
		clientInstanceId: request.clientInstanceId,
		correlationId: request.requestId,
		idempotencyKeyHash: createHash('sha256').update(request.idempotencyKey).digest('hex'),
		receiptTargetDigest: '',
		capability: request.capability,
		mutationKind: request.mutationKind,
		createdAt: now.toISOString(),
		expiresAt: new Date(now.getTime() + 60_000).toISOString(),
		targets,
		contextRevision: revision(),
		affectedResources: resourceKeys.map(resourceKey => ({
			resourceKind: 'task-source',
			resourceKey,
			revision: 'c'.repeat(64),
		})),
		atomicGroups: resourceKeys.map((resourceKey, order) => ({
			groupId: `task-source:${resourceKey}`,
			order,
			resources: [{ resourceKind: 'task-source', resourceKey }],
		})),
		predictedEffects: resourceKeys.map((resourceKey, index) => ({
			resourceKind: 'task-source',
			resourceKey,
			action: request.spec.operation === 'delete'
				? 'trash' as const
				: request.spec.operation === 'convert' && index === 1
					? 'create' as const
					: 'update' as const,
			summary: `Apply ${request.mutationKind} to ${resourceKey}.`,
		})),
		riskLevel: destructive
			? 'destructive'
			: request.spec.operation === 'relocate-inline' && !gatedMove
				? 'routine'
				: 'elevated',
		requiresConfirmation,
		requiredAcknowledgements: requiresConfirmation
			? [`confirm:${request.mutationKind}:abc1234`]
			: [],
		warnings: [],
		spec: sealedSpec,
		...(request.spec.operation === 'convert' ? {
			conversionEffect: {
				direction: request.spec.from === 'inline'
					? 'inline-to-file' as const
					: 'file-to-inline' as const,
				operonId: 'abc1234',
				beforeLocator: currentTask.locator,
				afterLocator: request.spec.to === 'inline'
					? request.spec.target.mode === 'exact-line'
						? {
							representation: 'inline' as const,
							filePath: request.spec.target.filePath,
							lineNumber: request.spec.target.lineNumber,
						}
						: {
							representation: 'inline' as const,
							filePath: request.spec.target.filePath ?? 'Daily/Target.md',
							lineNumber: 8,
						}
					: {
						representation: 'file' as const,
						filePath: request.spec.targetPath ?? 'Tasks/Converted.md',
					},
				plannedTargetDigest: 'f'.repeat(64),
				plannedSourceDigest: '1'.repeat(64),
				settingsFingerprint: revision().settingsFingerprint,
				...(request.spec.to === 'file' ? {
					templateId: request.spec.templateId,
					templateRevision: '2'.repeat(64),
				} : {}),
				resolvedFieldDiff: [],
				lossManifest,
				lossManifestDigest: sha256HexV1(canonicalJsonV1(toJsonValueV1(lossManifest))),
			},
		} : {}),
	};
	plan.receiptTargetDigest = computeReceiptTargetDigestV1(plan.targets);
	plan.planHash = computeSealedMutationPlanHashV1(plan);
	return {
		contractVersion: 1,
		requestId: request.requestId,
		kind: 'mutation-preview-result' as const,
		ok: true as const,
		warnings: [],
		plan,
	};
}
