import type { App } from 'obsidian';
import type { Pipeline, StatusDefinition } from '../types/pipeline';
import { preserveInvalidJsonFile, writeJsonSafely } from './storage-file-ops';
import type { WriteQueue } from './write-queue';

export const FIELD_RENAME_JOURNAL_VERSION = 1 as const;

export type WorkflowFieldRenameJournalPhase =
	| 'prepared'
	| 'taxonomyCommitted'
	| 'migrating'
	| 'reindexPending'
	| 'needsRetry'
	| 'complete';

export type WorkflowFieldRenameTaskOutcome =
	| 'pending'
	| 'updated'
	| 'already-updated'
	| 'conflict'
	| 'missing'
	| 'failed';

export interface WorkflowFieldRenameTaxonomySnapshot {
	pipelines: Pipeline[];
	defaultPipelineName: string;
}

export interface WorkflowFieldRenameTaskMapping {
	operonId: string;
	filePath: string;
	format: 'inline' | 'yaml';
	oldValue: string;
	newValue: string;
	outcome: WorkflowFieldRenameTaskOutcome;
	attemptCount: number;
	updatedAt?: string;
	error?: string;
}

export interface WorkflowFieldRenameJournalOperation {
	id: string;
	kind: 'workflow-status';
	phase: WorkflowFieldRenameJournalPhase;
	oldSnapshot: WorkflowFieldRenameTaxonomySnapshot;
	newSnapshot: WorkflowFieldRenameTaxonomySnapshot;
	taskMappings: WorkflowFieldRenameTaskMapping[];
	createdAt: string;
	updatedAt: string;
	lastError?: string;
}

export interface FieldRenameJournalDataV1 {
	version: typeof FIELD_RENAME_JOURNAL_VERSION;
	active: WorkflowFieldRenameJournalOperation | null;
	recoveryRequired?: FieldRenameJournalRecoveryRequired;
}

export interface FieldRenameJournalRecoveryRequired {
	kind: 'invalid-backup';
	backupPath: string;
	detectedAt: string;
}

export class FieldRenameJournalStore {
	private active: WorkflowFieldRenameJournalOperation | null = null;
	private mutationQueue: Promise<void> = Promise.resolve();
	private writesSuspended = false;
	private writeSuspensionReason: string | null = null;
	private recoveryRequired: FieldRenameJournalRecoveryRequired | null = null;

	constructor(
		private readonly app: App,
		private readonly writeQueue: WriteQueue,
		private readonly filePath: string,
	) {}

	async load(): Promise<WorkflowFieldRenameJournalOperation | null> {
		return this.enqueueMutation(async () => {
			const adapter = this.app.vault.adapter;
			if (!(await adapter.exists(this.filePath))) {
				this.active = null;
				this.recoveryRequired = null;
				this.resumeWrites();
				return null;
			}

			let raw: string;
			try {
				raw = await adapter.read(this.filePath);
			} catch (error) {
				this.active = null;
				this.suspendWrites(error instanceof Error ? error.message : String(error));
				console.warn('Operon: Failed to read field-rename-journal.json; journal writes suspended');
				return null;
			}

			try {
				const parsed: unknown = JSON.parse(raw);
				if (!isFieldRenameJournalDataV1(parsed)) {
					throw new Error('Unsupported or invalid field rename journal');
				}
				this.active = cloneOperation(parsed.active);
				this.recoveryRequired = cloneRecoveryRequired(parsed.recoveryRequired ?? null);
				if (this.recoveryRequired) {
					this.suspendWrites(`Field rename journal recovery is required; backup: ${this.recoveryRequired.backupPath}`);
				} else {
					this.resumeWrites();
				}
				return this.get();
			} catch (error) {
				console.warn('Operon: Failed to load field-rename-journal.json, preserving invalid file as backup');
				this.active = null;
				this.recoveryRequired = null;
				try {
					const recoveryRequired = await this.writeQueue.enqueue(this.filePath, async () => {
						const backupPath = await preserveInvalidJsonFile(adapter, this.filePath, raw);
						const recovery: FieldRenameJournalRecoveryRequired = {
							kind: 'invalid-backup',
							backupPath,
							detectedAt: new Date().toISOString(),
						};
						await writeJsonSafely(adapter, this.filePath, {
							version: FIELD_RENAME_JOURNAL_VERSION,
							active: null,
							recoveryRequired: recovery,
						} satisfies FieldRenameJournalDataV1);
						return recovery;
					});
					this.recoveryRequired = recoveryRequired;
					this.suspendWrites(`Field rename journal recovery is required; backup: ${recoveryRequired.backupPath}`);
				} catch (backupError) {
					console.warn('Operon: Failed to preserve invalid field rename journal backup; journal writes suspended');
					this.suspendWrites(backupError instanceof Error ? backupError.message : String(backupError));
				}
				if (error instanceof Error) {
					console.warn(`Operon: ${error.message}`);
				}
				return null;
			}
		});
	}

	get(): WorkflowFieldRenameJournalOperation | null {
		return cloneOperation(this.active);
	}

	canPersist(): boolean {
		return !this.writesSuspended;
	}

	getWriteSuspensionReason(): string | null {
		return this.writeSuspensionReason;
	}

	getRecoveryRequired(): FieldRenameJournalRecoveryRequired | null {
		return cloneRecoveryRequired(this.recoveryRequired);
	}

	async replace(operation: WorkflowFieldRenameJournalOperation): Promise<void> {
		if (!isWorkflowFieldRenameJournalOperation(operation)) {
			throw new Error('Cannot persist an invalid workflow field rename journal operation');
		}
		const candidate = cloneOperation(operation)!;
		await this.enqueueMutation(async () => {
			if (this.active && this.active.id !== candidate.id) {
				throw new Error(`Cannot replace active workflow field rename operation ${this.active.id}`);
			}
			await this.flush(candidate);
			this.active = candidate;
		});
	}

	async clear(): Promise<void> {
		await this.enqueueMutation(async () => {
			await this.flush(null, this.recoveryRequired !== null);
			this.active = null;
			this.recoveryRequired = null;
			this.resumeWrites();
		});
	}

	async drain(): Promise<void> {
		await this.mutationQueue;
	}

	private async flush(
		active: WorkflowFieldRenameJournalOperation | null,
		allowRecoveryClear = false,
	): Promise<void> {
		if (this.writesSuspended && !allowRecoveryClear) {
			throw new Error(`Field rename journal writes are suspended: ${this.writeSuspensionReason ?? 'invalid journal backup failed'}`);
		}
		if (allowRecoveryClear && !this.recoveryRequired) {
			throw new Error('Field rename journal recovery cannot be cleared without a preserved backup');
		}
		const data: FieldRenameJournalDataV1 = {
			version: FIELD_RENAME_JOURNAL_VERSION,
			active: cloneOperation(active),
		};
		await this.writeQueue.enqueue(this.filePath, async () => {
			await writeJsonSafely(this.app.vault.adapter, this.filePath, data);
		});
	}

	private async enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
		const run = this.mutationQueue.then(operation);
		this.mutationQueue = run.then(() => undefined, () => undefined);
		return run;
	}

	private suspendWrites(reason: string): void {
		this.writesSuspended = true;
		this.writeSuspensionReason = reason.trim() || 'Invalid field rename journal backup failed';
	}

	private resumeWrites(): void {
		this.writesSuspended = false;
		this.writeSuspensionReason = null;
	}
}

function cloneOperation(
	operation: WorkflowFieldRenameJournalOperation | null,
): WorkflowFieldRenameJournalOperation | null {
	if (!operation) return null;
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

function cloneRecoveryRequired(
	recovery: FieldRenameJournalRecoveryRequired | null,
): FieldRenameJournalRecoveryRequired | null {
	return recovery ? { ...recovery } : null;
}

function isFieldRenameJournalDataV1(value: unknown): value is FieldRenameJournalDataV1 {
	if (!isRecord(value)) return false;
	if (value.version !== FIELD_RENAME_JOURNAL_VERSION) return false;
	if (value.active !== null && !isWorkflowFieldRenameJournalOperation(value.active)) return false;
	if (value.recoveryRequired !== undefined && !isRecoveryRequired(value.recoveryRequired)) return false;
	return !(value.active && value.recoveryRequired);
}

function isRecoveryRequired(value: unknown): value is FieldRenameJournalRecoveryRequired {
	return isRecord(value)
		&& value.kind === 'invalid-backup'
		&& isNonEmptyString(value.backupPath)
		&& isNonEmptyString(value.detectedAt);
}

function isWorkflowFieldRenameJournalOperation(value: unknown): value is WorkflowFieldRenameJournalOperation {
	if (!isRecord(value)) return false;
	return isNonEmptyString(value.id)
		&& value.kind === 'workflow-status'
		&& isWorkflowFieldRenameJournalPhase(value.phase)
		&& isTaxonomySnapshot(value.oldSnapshot)
		&& isTaxonomySnapshot(value.newSnapshot)
		&& Array.isArray(value.taskMappings)
		&& value.taskMappings.every(isTaskMapping)
		&& isNonEmptyString(value.createdAt)
		&& isNonEmptyString(value.updatedAt)
		&& isOptionalString(value.lastError);
}

function isWorkflowFieldRenameJournalPhase(value: unknown): value is WorkflowFieldRenameJournalPhase {
	return value === 'prepared'
		|| value === 'taxonomyCommitted'
		|| value === 'migrating'
		|| value === 'reindexPending'
		|| value === 'needsRetry'
		|| value === 'complete';
}

function isWorkflowFieldRenameTaskOutcome(value: unknown): value is WorkflowFieldRenameTaskOutcome {
	return value === 'pending'
		|| value === 'updated'
		|| value === 'already-updated'
		|| value === 'conflict'
		|| value === 'missing'
		|| value === 'failed';
}

function isTaxonomySnapshot(value: unknown): value is WorkflowFieldRenameTaxonomySnapshot {
	return isRecord(value)
		&& Array.isArray(value.pipelines)
		&& value.pipelines.every(isPipeline)
		&& typeof value.defaultPipelineName === 'string';
}

function isPipeline(value: unknown): value is Pipeline {
	return isRecord(value)
		&& isNonEmptyString(value.id)
		&& isNonEmptyString(value.name)
		&& isOptionalString(value.description)
		&& Array.isArray(value.statuses)
		&& value.statuses.every(isStatusDefinition);
}

function isStatusDefinition(value: unknown): value is StatusDefinition {
	return isRecord(value)
		&& isNonEmptyString(value.id)
		&& isNonEmptyString(value.label)
		&& isNonEmptyString(value.color)
		&& isOptionalString(value.pipelineStatusIcon)
		&& typeof value.isFinished === 'boolean'
		&& typeof value.isCancelled === 'boolean'
		&& typeof value.isScheduledTarget === 'boolean'
		&& typeof value.isTrackingTarget === 'boolean'
		&& (value.propertyMapping === null || typeof value.propertyMapping === 'string');
}

function isTaskMapping(value: unknown): value is WorkflowFieldRenameTaskMapping {
	return isRecord(value)
		&& isNonEmptyString(value.operonId)
		&& isNonEmptyString(value.filePath)
		&& (value.format === 'inline' || value.format === 'yaml')
		&& typeof value.oldValue === 'string'
		&& typeof value.newValue === 'string'
		&& isWorkflowFieldRenameTaskOutcome(value.outcome)
		&& typeof value.attemptCount === 'number'
		&& Number.isInteger(value.attemptCount)
		&& value.attemptCount >= 0
		&& isOptionalString(value.updatedAt)
		&& isOptionalString(value.error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

function isOptionalString(value: unknown): value is string | undefined {
	return value === undefined || typeof value === 'string';
}
