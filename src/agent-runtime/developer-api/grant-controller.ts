import type { OperonDeveloperApiConsumerPluginV1 } from '../public/v1/developer-api';
import {
	approveDeveloperApiCapabilities,
	denyDeveloperApiCapabilities,
	evaluateDeveloperApiGrant,
	getDeveloperApiGrantApprovalCapabilities,
	isDeveloperApiGrantApprovalRecordCoherent,
	normalizeDeveloperApiGrantPackage,
	reconcileDeveloperApiConsumerVersion,
	recordDeveloperApiGrantRequest,
	revokeDeveloperApiGrant,
	suspendDeveloperApiGrantForAuditRecovery,
	type DeveloperApiConsumerDescriptorV1,
	type DeveloperApiConsumerMetadataV1,
	type DeveloperApiGrantEvaluationV1,
	type DeveloperApiGrantPackageV1,
	type DeveloperApiGrantRecordV1,
	type DeveloperApiGrantCapabilityV1,
} from './grants';
import type { OperonDataPackageV1 } from '../../storage/operon-data-package';

export interface DeveloperApiGrantDataStoreV1 {
	getDataPackage(): OperonDataPackageV1;
	canPersist?(): boolean;
	updateDataPackage(
		mutator: (dataPackage: OperonDataPackageV1) => OperonDataPackageV1,
	): Promise<void>;
}

export interface DeveloperApiConsumerVerifierV1 {
	verify(
		candidate: OperonDeveloperApiConsumerPluginV1,
	): DeveloperApiConsumerDescriptorV1 | null;
	isCurrent(consumer: DeveloperApiConsumerDescriptorV1): boolean;
}

export interface DeveloperApiGrantControllerOptionsV1 {
	readonly store: DeveloperApiGrantDataStoreV1;
	readonly verifier: DeveloperApiConsumerVerifierV1;
	readonly now?: () => Date;
	readonly audit?: DeveloperApiGrantAuditPortV1;
	readonly startupAuditRecoveryTransitions?: readonly Readonly<{
		consumerId: string;
		revision: number;
	}>[];
}

/** Snapshot bound to the Settings render that presented an approval action. */
export interface DeveloperApiGrantApprovalBindingV1 {
	readonly consumerId: string;
	readonly expectedRevision: number;
	readonly expectedConsumerName: string;
	readonly expectedConsumerVersion: string;
	readonly expectedObservedConsumerVersion?: string;
	readonly expectedApprovedMajorVersion: number;
	readonly expectedInstanceEpoch: string;
}

export interface DeveloperApiGrantApprovalRequestV1 extends DeveloperApiGrantApprovalBindingV1 {
	readonly capabilities: readonly DeveloperApiGrantCapabilityV1[];
	/** Freshly revalidated live consumer, captured immediately before approval. */
	readonly consumer: DeveloperApiConsumerDescriptorV1;
}

export type DeveloperApiGrantAuditActionV1 =
	| 'request'
	| 'approve'
	| 'deny'
	| 'revoke'
	| 'version-accepted'
	| 'version-suspended';

export interface DeveloperApiGrantAuditEventV1 {
	readonly phase: 'intent' | 'activated' | 'failed';
	readonly correlationId: string;
	readonly action: DeveloperApiGrantAuditActionV1;
	readonly consumerId: string;
	readonly consumerName: string;
	readonly consumerVersion: string;
	readonly capabilities: readonly DeveloperApiGrantCapabilityV1[];
	readonly revision: number;
	readonly occurredAt: string;
}

export interface DeveloperApiGrantAuditPortV1 {
	createCorrelationId(): string;
	record(event: DeveloperApiGrantAuditEventV1): Promise<void>;
}

/**
 * Host-owned bridge between the synchronous Developer API accessor and the
 * canonical async data.json store. The in-memory package is updated before a
 * persistence request is queued, so revocation closes new admission
 * synchronously.
 */
export class DeveloperApiGrantControllerV1 {
	private grants: DeveloperApiGrantPackageV1;
	private persistenceError: Error | null = null;
	private persistenceErrorRecoverable = false;
	private pendingWrites = 0;
	private writeQueue: Promise<void> = Promise.resolve();
	private readonly startupAuditRecoveryTransitions: readonly Readonly<{
		consumerId: string;
		revision: number;
	}>[];
	private readonly startupAuditRecoveryAt: string;

	constructor(private readonly options: DeveloperApiGrantControllerOptionsV1) {
		this.startupAuditRecoveryTransitions = options.startupAuditRecoveryTransitions ?? [];
		this.startupAuditRecoveryAt = this.nowIso();
		this.grants = this.readGrantsFromStore();
	}

	verifyConsumer(
		candidate: OperonDeveloperApiConsumerPluginV1,
	): DeveloperApiConsumerDescriptorV1 | null {
		return this.options.verifier.verify(candidate);
	}

	isConsumerCurrent(consumer: DeveloperApiConsumerDescriptorV1): boolean {
		return this.options.verifier.isCurrent(consumer);
	}

	evaluate(
		consumer: DeveloperApiConsumerDescriptorV1,
		requestedCapabilities: readonly DeveloperApiGrantCapabilityV1[],
	): DeveloperApiGrantEvaluationV1 {
		this.syncFromStoreIfIdle();
		this.observeConsumerVersion(consumer, requestedCapabilities);
		const evaluation = evaluateDeveloperApiGrant(this.grants, consumer, requestedCapabilities);
		if (
			!this.hasPersistenceFailure()
			&& (evaluation.state !== 'active' || this.pendingWrites === 0)
		) return evaluation;
		return {
			...evaluation,
			state: 'suspended',
			effectiveCapabilities: [],
			reason: 'grant-persistence-unavailable',
		};
	}

	observeConsumerVersion(
		consumer: DeveloperApiConsumerDescriptorV1,
		requestedCapabilities: readonly DeveloperApiGrantCapabilityV1[],
	): boolean {
		this.syncFromStoreIfIdle();
		if (this.isStorePersistenceUnavailable()) return false;
		const reconciliation = reconcileDeveloperApiConsumerVersion(
			this.grants,
			consumer,
			requestedCapabilities,
			this.nowIso(),
		);
		if (reconciliation.changed) {
			this.grants = reconciliation.grantPackage;
			const action = reconciliation.transition === 'accepted'
				? 'version-accepted'
				: 'version-suspended';
			this.enqueuePersist(
				reconciliation.grantPackage,
				this.auditTransition(
					action,
					reconciliation.grantPackage,
					consumer.id,
					reconciliation.capabilities,
				),
			);
		}
		return !this.hasPersistenceError();
	}

	recordPending(
		consumer: DeveloperApiConsumerDescriptorV1,
		requestedCapabilities: readonly DeveloperApiGrantCapabilityV1[],
	): void {
		this.syncFromStoreIfIdle();
		if (this.isStorePersistenceUnavailable()) return;
		const nowIso = this.nowIso();
		const next = recordDeveloperApiGrantRequest(
			this.grants,
			consumer,
			requestedCapabilities,
			nowIso,
		);
		if (JSON.stringify(next) === JSON.stringify(this.grants)) return;
		this.grants = next;
		this.enqueuePersist(next, this.auditTransition('request', next, consumer.id, requestedCapabilities));
	}

	async approve(
		consumer: DeveloperApiConsumerMetadataV1,
		capabilities: readonly DeveloperApiGrantCapabilityV1[],
	): Promise<DeveloperApiGrantRecordV1> {
		this.requirePersistenceAvailable();
		const next = approveDeveloperApiCapabilities(
			this.grants,
			consumer,
			capabilities,
			this.nowIso(),
		);
		this.grants = next;
		this.enqueuePersist(next, this.auditTransition('approve', next, consumer.id, capabilities));
		await this.drain();
		return this.requireRecord(consumer.id);
	}

	async revoke(consumerId: string): Promise<DeveloperApiGrantRecordV1 | null> {
		this.requirePersistenceAvailable();
		const next = revokeDeveloperApiGrant(this.grants, consumerId, this.nowIso());
		this.grants = next;
		this.enqueuePersist(next, this.auditTransition('revoke', next, consumerId, []));
		await this.drain();
		return this.grants.consumersById[consumerId] ?? null;
	}

	async approvePending(
		request: DeveloperApiGrantApprovalRequestV1,
	): Promise<DeveloperApiGrantRecordV1> {
		this.requirePersistenceAvailable();
		const existing = this.requireRecord(request.consumerId);
		this.requireApprovalBinding(existing, request);
		const approvable = new Set(getDeveloperApiGrantApprovalCapabilities(existing));
		const approved = request.capabilities.filter(capability => approvable.has(capability));
		if (approved.length === 0) {
			throw new Error(`No approvable Developer API capabilities selected for ${request.consumerId}`);
		}
		return this.approve({
			id: request.consumer.id,
			name: request.consumer.name,
			version: request.consumer.version,
		}, approved);
	}

	async denyPending(
		consumerId: string,
		capabilities: readonly DeveloperApiGrantCapabilityV1[] | 'all' = 'all',
	): Promise<DeveloperApiGrantRecordV1> {
		this.requirePersistenceAvailable();
		const existing = this.requireRecord(consumerId);
		const next = denyDeveloperApiCapabilities(
			this.grants,
			consumerId,
			capabilities,
			this.nowIso(),
		);
		this.grants = next;
		const denied = capabilities === 'all'
			? existing.pendingCapabilities
			: capabilities;
		this.enqueuePersist(next, this.auditTransition('deny', next, consumerId, denied));
		await this.drain();
		return this.requireRecord(consumerId);
	}

	list(): readonly DeveloperApiGrantRecordV1[] {
		this.syncFromStoreIfIdle();
		if (this.isStorePersistenceUnavailable()) return [];
		return Object.values(this.grants.consumersById).map(record => structuredClone(record));
	}

	hasPersistenceError(): boolean {
		return this.hasPersistenceFailure() || this.pendingWrites > 0;
	}

	getPersistenceError(): Error | null {
		return this.persistenceError;
	}

	async drain(): Promise<void> {
		await this.writeQueue;
		if (this.persistenceError) throw this.persistenceError;
	}

	private enqueuePersist(
		snapshot: DeveloperApiGrantPackageV1,
		audit?: Readonly<{
			intent: DeveloperApiGrantAuditEventV1;
			activated: DeveloperApiGrantAuditEventV1;
			failed: DeveloperApiGrantAuditEventV1;
		}>,
	): void {
		this.persistenceError = null;
		this.persistenceErrorRecoverable = false;
		this.pendingWrites += 1;
		let intentRecorded = false;
		this.writeQueue = this.writeQueue
			.catch(() => undefined)
			.then(async () => {
				if (audit) {
					await this.options.audit?.record(audit.intent);
					intentRecorded = true;
				}
				await this.options.store.updateDataPackage(dataPackage => ({
					...dataPackage,
					integrations: {
						...dataPackage.integrations,
						developerApi: normalizeDeveloperApiGrantPackage(snapshot),
					},
				}));
				if (audit) await this.options.audit?.record(audit.activated);
				this.pendingWrites -= 1;
				if (this.pendingWrites === 0) {
					this.persistenceError = null;
					this.persistenceErrorRecoverable = false;
				}
			})
			.catch(async error => {
				this.pendingWrites -= 1;
				let recoverable = !audit || !intentRecorded;
				if (audit && intentRecorded) {
					const durableGrants = normalizeDeveloperApiGrantPackage(
						this.options.store.getDataPackage().integrations.developerApi,
					);
					const durableSnapshotMatches = JSON.stringify(durableGrants)
						=== JSON.stringify(normalizeDeveloperApiGrantPackage(snapshot));
					if (!durableSnapshotMatches) {
						try {
							await this.options.audit?.record(audit.failed);
							recoverable = true;
						} catch {
							// The unmatched intent remains the fail-closed restart fence.
						}
					}
				}
				this.persistenceError = error instanceof Error ? error : new Error(String(error));
				this.persistenceErrorRecoverable = recoverable;
				throw this.persistenceError;
			});
	}

	private syncFromStoreIfIdle(): void {
		if (this.pendingWrites > 0) return;
		this.grants = this.readGrantsFromStore();
		if (this.persistenceError && this.persistenceErrorRecoverable) {
			this.persistenceError = null;
			this.persistenceErrorRecoverable = false;
		}
	}

	private readGrantsFromStore(): DeveloperApiGrantPackageV1 {
		let grants = normalizeDeveloperApiGrantPackage(
			this.options.store.getDataPackage().integrations.developerApi,
		);
		for (const transition of this.startupAuditRecoveryTransitions) {
			grants = suspendDeveloperApiGrantForAuditRecovery(
				grants,
				transition.consumerId,
				transition.revision,
				this.startupAuditRecoveryAt,
			);
		}
		return grants;
	}

	private isStorePersistenceUnavailable(): boolean {
		return this.options.store.canPersist?.() === false;
	}

	private hasPersistenceFailure(): boolean {
		return this.persistenceError !== null || this.isStorePersistenceUnavailable();
	}

	private requirePersistenceAvailable(): void {
		this.syncFromStoreIfIdle();
		if (this.isStorePersistenceUnavailable()) {
			throw new Error('Developer API grant persistence is unavailable');
		}
	}

	private auditTransition(
		action: DeveloperApiGrantAuditActionV1,
		snapshot: DeveloperApiGrantPackageV1,
		consumerId: string,
		capabilities: readonly DeveloperApiGrantCapabilityV1[],
	): {
		intent: DeveloperApiGrantAuditEventV1;
		activated: DeveloperApiGrantAuditEventV1;
		failed: DeveloperApiGrantAuditEventV1;
	} | undefined {
		if (!this.options.audit) return undefined;
		const record = snapshot.consumersById[consumerId];
		if (!record) return undefined;
		const occurredAt = this.nowIso();
		const correlationId = this.options.audit.createCorrelationId();
		const base = {
			correlationId,
			action,
			consumerId,
			consumerName: record.consumerName,
			consumerVersion: record.consumerVersion,
			capabilities: [...new Set(capabilities)].sort((left, right) => left.localeCompare(right)),
			revision: record.revision,
			occurredAt,
		};
		return {
			intent: { ...base, phase: 'intent' },
			activated: { ...base, phase: 'activated' },
			failed: { ...base, phase: 'failed' },
		};
	}

	private requireRecord(consumerId: string): DeveloperApiGrantRecordV1 {
		const record = this.grants.consumersById[consumerId];
		if (!record) throw new Error(`Developer API grant record missing for ${consumerId}`);
		return structuredClone(record);
	}

	private requireApprovalBinding(
		record: DeveloperApiGrantRecordV1,
		request: DeveloperApiGrantApprovalRequestV1,
	): void {
		if (!isDeveloperApiGrantApprovalRecordCoherent(record)) {
			throw new Error(`Developer API grant record is semantically incoherent for approval: ${request.consumerId}`);
		}
		if (
			record.revision !== request.expectedRevision
			|| record.consumerName !== request.expectedConsumerName
			|| record.consumerVersion !== request.expectedConsumerVersion
			|| record.observedConsumerVersion !== request.expectedObservedConsumerVersion
			|| record.approvedMajorVersion !== request.expectedApprovedMajorVersion
		) {
			throw new Error(`Developer API grant changed before approval for ${request.consumerId}`);
		}
		const expectedLiveVersion = record.observedConsumerVersion ?? record.consumerVersion;
		if (
			request.consumer.id !== record.consumerId
			|| request.consumer.name !== record.consumerName
			|| request.consumer.version !== expectedLiveVersion
			|| request.consumer.instanceEpoch !== request.expectedInstanceEpoch
			|| !this.options.verifier.isCurrent(request.consumer)
		) {
			throw new Error(`Developer API consumer changed before approval for ${request.consumerId}`);
		}
	}

	private nowIso(): string {
		return (this.options.now?.() ?? new Date()).toISOString();
	}
}
