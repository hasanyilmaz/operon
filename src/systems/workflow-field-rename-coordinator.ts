import type {
	FieldRenameJournalStore,
	WorkflowFieldRenameJournalOperation,
	WorkflowFieldRenameTaskMapping,
	WorkflowFieldRenameTaskOutcome,
	WorkflowFieldRenameTaxonomySnapshot,
} from '../storage/field-rename-journal-store';

export type ConditionalWorkflowStatusWriteOutcome =
	| 'updated'
	| 'already-updated'
	| 'conflict'
	| 'missing';

export type WorkflowFieldRenameRunStatus =
	| 'idle'
	| 'complete'
	| 'needs-retry'
	| 'taxonomy-conflict';

export interface WorkflowFieldRenameRunResult {
	status: WorkflowFieldRenameRunStatus;
	operationId: string | null;
	outcomes: Record<WorkflowFieldRenameTaskOutcome, number>;
	lastError?: string;
}

export interface PrepareWorkflowFieldRenameInput {
	id: string;
	oldSnapshot: WorkflowFieldRenameTaxonomySnapshot;
	newSnapshot: WorkflowFieldRenameTaxonomySnapshot;
	taskMappings: Array<Omit<WorkflowFieldRenameTaskMapping, 'outcome' | 'attemptCount' | 'updatedAt' | 'error'>>;
}

export interface WorkflowFieldRenameCoordinatorDeps {
	journal: Pick<FieldRenameJournalStore, 'get' | 'replace' | 'clear' | 'canPersist' | 'getWriteSuspensionReason'>;
	getCurrentTaxonomySnapshot(): WorkflowFieldRenameTaxonomySnapshot;
	commitTaxonomySnapshot(snapshot: WorkflowFieldRenameTaxonomySnapshot): Promise<void>;
	writeTaskStatusIfCurrent(
		mapping: Readonly<WorkflowFieldRenameTaskMapping>,
	): Promise<ConditionalWorkflowStatusWriteOutcome>;
	rebuildIndex(): Promise<void>;
	reconcileAggregates?(): Promise<void>;
	now?: () => Date;
}

export class WorkflowFieldRenameCoordinatorError extends Error {
	constructor(
		message: string,
		readonly code:
			| 'active-operation'
			| 'invalid-operation'
			| 'journal-writes-suspended'
			| 'stale-old-snapshot',
	) {
		super(message);
		this.name = 'WorkflowFieldRenameCoordinatorError';
	}
}

/**
 * Coordinates a durable workflow rename transaction. Taxonomy snapshots are
 * compared structurally: array order is significant while object key order is
 * not. The injected conditional writer must inspect the current task source in
 * the same serialized write operation that applies the update.
 */
export class WorkflowFieldRenameCoordinator {
	private runQueue: Promise<void> = Promise.resolve();

	constructor(private readonly deps: WorkflowFieldRenameCoordinatorDeps) {}

	hasActiveOperation(): boolean {
		return this.deps.journal.get() !== null;
	}

	async prepare(input: PrepareWorkflowFieldRenameInput): Promise<WorkflowFieldRenameJournalOperation> {
		return this.enqueueRun(async () => this.prepareNow(input));
	}

	async prepareAndRun(input: PrepareWorkflowFieldRenameInput): Promise<WorkflowFieldRenameRunResult> {
		return this.enqueueRun(async () => {
			await this.prepareNow(input);
			return this.resumeNow();
		});
	}

	async resume(): Promise<WorkflowFieldRenameRunResult> {
		return this.enqueueRun(async () => this.resumeNow());
	}

	async retry(): Promise<WorkflowFieldRenameRunResult> {
		return this.resume();
	}

	private async prepareNow(input: PrepareWorkflowFieldRenameInput): Promise<WorkflowFieldRenameJournalOperation> {
		this.assertJournalWritable();
		const active = this.deps.journal.get();
		if (active) {
			throw new WorkflowFieldRenameCoordinatorError(
				`Workflow rename operation ${active.id} must be resolved before another rename can start`,
				'active-operation',
			);
		}
		validatePrepareInput(input);
		const currentSnapshot = this.deps.getCurrentTaxonomySnapshot();
		if (!workflowTaxonomySnapshotsEqual(currentSnapshot, input.oldSnapshot)) {
			throw new WorkflowFieldRenameCoordinatorError(
				'Workflow taxonomy changed after the rename preview was created',
				'stale-old-snapshot',
			);
		}

		const timestamp = this.nowIso();
		const operation: WorkflowFieldRenameJournalOperation = {
			id: input.id.trim(),
			kind: 'workflow-status',
			phase: 'prepared',
			oldSnapshot: cloneSnapshot(input.oldSnapshot),
			newSnapshot: cloneSnapshot(input.newSnapshot),
			taskMappings: input.taskMappings.map(mapping => ({
				...mapping,
				operonId: mapping.operonId.trim(),
				filePath: mapping.filePath.trim(),
				outcome: 'pending',
				attemptCount: 0,
			})),
			createdAt: timestamp,
			updatedAt: timestamp,
		};
		await this.deps.journal.replace(operation);
		return cloneOperation(operation);
	}

	private async resumeNow(): Promise<WorkflowFieldRenameRunResult> {
		this.assertJournalWritable();
		let operation = this.deps.journal.get();
		if (!operation) return buildRunResult('idle', null);
		if (operation.phase === 'complete') {
			const hasRetryableTasks = operation.taskMappings.some(
				mapping => mapping.outcome === 'pending' || mapping.outcome === 'failed',
			);
			if (!hasRetryableTasks) {
				await this.deps.journal.clear();
				return buildRunResult('complete', operation);
			}
			operation = await this.persistPhase(
				operation,
				'needsRetry',
				'Completed workflow rename journal contains retryable task outcomes',
			);
		}

		const currentSnapshot = this.deps.getCurrentTaxonomySnapshot();
		const matchesOld = workflowTaxonomySnapshotsEqual(currentSnapshot, operation.oldSnapshot);
		const matchesNew = workflowTaxonomySnapshotsEqual(currentSnapshot, operation.newSnapshot);
		if (!matchesOld && !matchesNew) {
			operation = await this.persistPhase(
				operation,
				'needsRetry',
				'Current workflow taxonomy matches neither the old nor the approved new snapshot',
			);
			return buildRunResult('taxonomy-conflict', operation);
		}

		if (matchesOld) {
			try {
				await this.deps.commitTaxonomySnapshot(cloneSnapshot(operation.newSnapshot));
			} catch (error) {
				operation = await this.persistPhase(operation, 'needsRetry', errorMessage(error));
				return buildRunResult('needs-retry', operation);
			}
		}
		operation = await this.persistPhase(operation, 'taxonomyCommitted');
		operation = await this.persistPhase(operation, 'migrating');

		for (let index = 0; index < operation.taskMappings.length; index++) {
			const mapping = operation.taskMappings[index];
			if (mapping.outcome !== 'pending' && mapping.outcome !== 'failed') continue;
			operation = await this.persistTaskAttempt(operation, index);
			const activeMapping = operation.taskMappings[index];
			try {
				const outcome = await this.deps.writeTaskStatusIfCurrent({ ...activeMapping });
				operation = await this.persistTaskOutcome(operation, index, outcome);
			} catch (error) {
				operation = await this.persistTaskOutcome(operation, index, 'failed', errorMessage(error));
			}
		}

		operation = await this.persistPhase(operation, 'reindexPending');
		try {
			await this.deps.rebuildIndex();
			await this.deps.reconcileAggregates?.();
		} catch (error) {
			operation = await this.persistPhase(operation, 'needsRetry', errorMessage(error));
			return buildRunResult('needs-retry', operation);
		}

		if (operation.taskMappings.some(mapping => mapping.outcome === 'failed')) {
			operation = await this.persistPhase(
				operation,
				'needsRetry',
				'One or more workflow status task updates failed and require retry',
			);
			return buildRunResult('needs-retry', operation);
		}

		operation = await this.persistPhase(operation, 'complete');
		const result = buildRunResult('complete', operation);
		await this.deps.journal.clear();
		return result;
	}

	private async persistPhase(
		operation: WorkflowFieldRenameJournalOperation,
		phase: WorkflowFieldRenameJournalOperation['phase'],
		lastError?: string,
	): Promise<WorkflowFieldRenameJournalOperation> {
		const next: WorkflowFieldRenameJournalOperation = {
			...operation,
			phase,
			updatedAt: this.nowIso(),
		};
		if (lastError) next.lastError = lastError;
		else delete next.lastError;
		await this.deps.journal.replace(next);
		return next;
	}

	private async persistTaskAttempt(
		operation: WorkflowFieldRenameJournalOperation,
		mappingIndex: number,
	): Promise<WorkflowFieldRenameJournalOperation> {
		const timestamp = this.nowIso();
		const taskMappings = operation.taskMappings.map((mapping, index) => {
			if (index !== mappingIndex) return { ...mapping };
			const next: WorkflowFieldRenameTaskMapping = {
				...mapping,
				outcome: 'pending',
				attemptCount: mapping.attemptCount + 1,
				updatedAt: timestamp,
			};
			delete next.error;
			return next;
		});
		const next = { ...operation, taskMappings, updatedAt: timestamp };
		await this.deps.journal.replace(next);
		return next;
	}

	private async persistTaskOutcome(
		operation: WorkflowFieldRenameJournalOperation,
		mappingIndex: number,
		outcome: WorkflowFieldRenameTaskOutcome,
		error?: string,
	): Promise<WorkflowFieldRenameJournalOperation> {
		const timestamp = this.nowIso();
		const taskMappings = operation.taskMappings.map((mapping, index) => {
			if (index !== mappingIndex) return { ...mapping };
			const next: WorkflowFieldRenameTaskMapping = {
				...mapping,
				outcome,
				updatedAt: timestamp,
			};
			if (error) next.error = error;
			else delete next.error;
			return next;
		});
		const next = { ...operation, taskMappings, updatedAt: timestamp };
		await this.deps.journal.replace(next);
		return next;
	}

	private assertJournalWritable(): void {
		if (this.deps.journal.canPersist()) return;
		throw new WorkflowFieldRenameCoordinatorError(
			`Workflow rename journal writes are suspended: ${this.deps.journal.getWriteSuspensionReason() ?? 'unknown reason'}`,
			'journal-writes-suspended',
		);
	}

	private nowIso(): string {
		return (this.deps.now?.() ?? new Date()).toISOString();
	}

	private async enqueueRun<T>(operation: () => Promise<T>): Promise<T> {
		const run = this.runQueue.then(operation);
		this.runQueue = run.then(() => undefined, () => undefined);
		return run;
	}
}

export function workflowTaxonomySnapshotsEqual(
	left: WorkflowFieldRenameTaxonomySnapshot,
	right: WorkflowFieldRenameTaxonomySnapshot,
): boolean {
	return stableSerialize(left) === stableSerialize(right);
}

function validatePrepareInput(input: PrepareWorkflowFieldRenameInput): void {
	if (!input.id.trim()) {
		throw new WorkflowFieldRenameCoordinatorError('Workflow rename operation id is required', 'invalid-operation');
	}
	if (workflowTaxonomySnapshotsEqual(input.oldSnapshot, input.newSnapshot)) {
		throw new WorkflowFieldRenameCoordinatorError(
			'Workflow rename snapshots must describe a taxonomy change',
			'invalid-operation',
		);
	}
	const taskIds = new Set<string>();
	for (const mapping of input.taskMappings) {
		const operonId = mapping.operonId.trim();
		if (!operonId || !mapping.filePath.trim() || mapping.oldValue === mapping.newValue) {
			throw new WorkflowFieldRenameCoordinatorError('Workflow rename contains an invalid task mapping', 'invalid-operation');
		}
		if (taskIds.has(operonId)) {
			throw new WorkflowFieldRenameCoordinatorError(
				`Workflow rename contains duplicate task mapping ${operonId}`,
				'invalid-operation',
			);
		}
		taskIds.add(operonId);
	}
}

function stableSerialize(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map(item => stableSerialize(item)).join(',')}]`;
	}
	if (value && typeof value === 'object') {
		const record = value as Record<string, unknown>;
		return `{${Object.keys(record)
			.filter(key => record[key] !== undefined)
			.sort((left, right) => left.localeCompare(right))
			.map(key => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
			.join(',')}}`;
	}
	return JSON.stringify(value) ?? 'null';
}

function cloneOperation(operation: WorkflowFieldRenameJournalOperation): WorkflowFieldRenameJournalOperation {
	return {
		...operation,
		oldSnapshot: cloneSnapshot(operation.oldSnapshot),
		newSnapshot: cloneSnapshot(operation.newSnapshot),
		taskMappings: operation.taskMappings.map(mapping => ({ ...mapping })),
	};
}

function cloneSnapshot(snapshot: WorkflowFieldRenameTaxonomySnapshot): WorkflowFieldRenameTaxonomySnapshot {
	return {
		pipelines: snapshot.pipelines.map(pipeline => ({
			...pipeline,
			statuses: pipeline.statuses.map(status => ({ ...status })),
		})),
		defaultPipelineName: snapshot.defaultPipelineName,
	};
}

function buildRunResult(
	status: WorkflowFieldRenameRunStatus,
	operation: WorkflowFieldRenameJournalOperation | null,
): WorkflowFieldRenameRunResult {
	const outcomes: Record<WorkflowFieldRenameTaskOutcome, number> = {
		pending: 0,
		updated: 0,
		'already-updated': 0,
		conflict: 0,
		missing: 0,
		failed: 0,
	};
	for (const mapping of operation?.taskMappings ?? []) {
		outcomes[mapping.outcome] += 1;
	}
	return {
		status,
		operationId: operation?.id ?? null,
		outcomes,
		...(operation?.lastError ? { lastError: operation.lastError } : {}),
	};
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
