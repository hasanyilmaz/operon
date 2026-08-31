import type { OperonDeveloperApiConsumerPluginV1 } from '../public/v1/developer-api';
import {
	approveDeveloperApiCapabilities,
	createDeveloperApiGrantApprovalBinding,
	denyDeveloperApiCapabilities,
	evaluateDeveloperApiGrant,
	getDeveloperApiGrantApprovalCapabilities,
	normalizeDeveloperApiGrantPackage,
	reconcileDeveloperApiConsumerVersion,
	recordDeveloperApiGrantRequest,
	revokeDeveloperApiGrant,
	suspendDeveloperApiGrantForAuditRecovery,
	type DeveloperApiConsumerDescriptorV1,
	type DeveloperApiConsumerMetadataV1,
	type DeveloperApiGrantApprovalBindingV1,
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

export interface DeveloperApiGrantBoundApprovalRequestV1 {
	readonly binding: DeveloperApiGrantApprovalBindingV1;
	readonly capabilities: readonly DeveloperApiGrantCapabilityV1[];
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
	private readonly persistenceFencesByConsumerId = new Map<string, Error>();
	private readonly deferredPendingRequests = new Map<string, {
		consumer: DeveloperApiConsumerMetadataV1;
		capabilities: DeveloperApiGrantCapabilityV1[];
	}>();
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
		if (this.pendingWrites > 0 || this.hasPersistenceFailure()) return false;
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
		if (this.pendingWrites === 0 && !this.hasPersistenceFailure()) {
			this.flushDeferredPendingRequests();
		}
		if (this.pendingWrites > 0) {
			this.deferPendingRequest(consumer, requestedCapabilities);
			return;
		}
		if (this.hasPersistenceFailure()) return;
		this.applyPendingRequest(consumer, requestedCapabilities);
	}

	private applyPendingRequest(
		consumer: DeveloperApiConsumerMetadataV1,
		requestedCapabilities: readonly DeveloperApiGrantCapabilityV1[],
	): boolean {
		const nowIso = this.nowIso();
		const next = recordDeveloperApiGrantRequest(
			this.grants,
			consumer,
			requestedCapabilities,
			nowIso,
		);
		if (JSON.stringify(next) === JSON.stringify(this.grants)) return false;
		this.grants = next;
		this.enqueuePersist(
			next,
			this.auditTransition('request', next, consumer.id, requestedCapabilities),
			{ consumer, capabilities: [...requestedCapabilities] },
		);
		return true;
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
		this.requireRevocationPersistenceAvailable();
		const next = revokeDeveloperApiGrant(this.grants, consumerId, this.nowIso());
		this.grants = next;
		this.enqueuePersist(next, this.auditTransition('revoke', next, consumerId, []));
		await this.drain();
		this.persistenceFencesByConsumerId.delete(consumerId);
		this.flushDeferredPendingRequests();
		await this.drain();
		return this.grants.consumersById[consumerId] ?? null;
	}

	async approveBound(
		request: DeveloperApiGrantBoundApprovalRequestV1,
	): Promise<DeveloperApiGrantRecordV1> {
		this.requirePersistenceAvailable();
		const existing = this.requireRecord(request.binding.consumerId);
		if (!this.options.verifier.isCurrent(request.consumer)) {
			throw new Error(`Developer API consumer changed before approval for ${request.binding.consumerId}`);
		}
		const currentBinding = createDeveloperApiGrantApprovalBinding(existing, request.consumer);
		if (!currentBinding || !approvalBindingsEqual(currentBinding, request.binding)) {
			throw new Error(`Developer API grant changed before approval for ${request.binding.consumerId}`);
		}
		const approvable = new Set(getDeveloperApiGrantApprovalCapabilities(existing));
		const requested = [...request.capabilities];
		if (
			requested.length === 0
			|| new Set(requested).size !== requested.length
			|| requested.some(capability => !approvable.has(capability))
		) {
			throw new Error(`Developer API approval scope is invalid for ${request.binding.consumerId}`);
		}
		const selected = currentBinding.expectedApprovableCapabilities
			.filter(capability => requested.includes(capability));
		return this.approve({
			id: request.consumer.id,
			name: request.consumer.name,
			version: request.consumer.version,
		}, selected);
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
		if (this.persistenceError) return this.persistenceError;
		for (const error of this.persistenceFencesByConsumerId.values()) return error;
		return null;
	}

	async drain(): Promise<void> {
		for (;;) {
			const observedQueue = this.writeQueue;
			await observedQueue;
			if (this.persistenceError) throw this.persistenceError;
			if (observedQueue === this.writeQueue && this.pendingWrites === 0) return;
		}
	}

	private enqueuePersist(
		snapshot: DeveloperApiGrantPackageV1,
		audit?: Readonly<{
			intent: DeveloperApiGrantAuditEventV1;
			activated: DeveloperApiGrantAuditEventV1;
			failed: DeveloperApiGrantAuditEventV1;
		}>,
		recoverablePendingRequest?: Readonly<{
			consumer: DeveloperApiConsumerMetadataV1;
			capabilities: readonly DeveloperApiGrantCapabilityV1[];
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
					this.flushDeferredPendingRequests();
				}
			})
			.catch(async error => {
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
				this.pendingWrites -= 1;
				this.persistenceError = error instanceof Error ? error : new Error(String(error));
				this.persistenceErrorRecoverable = recoverable;
				if (recoverable && recoverablePendingRequest) {
					this.deferPendingRequest(
						recoverablePendingRequest.consumer,
						recoverablePendingRequest.capabilities,
					);
				}
				if (!recoverable && audit) {
					this.persistenceFencesByConsumerId.set(audit.failed.consumerId, this.persistenceError);
				}
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
		return this.persistenceError !== null
			|| this.persistenceFencesByConsumerId.size > 0
			|| this.isStorePersistenceUnavailable();
	}

	private requirePersistenceAvailable(): void {
		this.syncFromStoreIfIdle();
		if (this.pendingWrites > 0 || this.hasPersistenceFailure()) {
			throw new Error('Developer API grant persistence is unavailable');
		}
	}

	private requireRevocationPersistenceAvailable(): void {
		this.syncFromStoreIfIdle();
		if (this.pendingWrites > 0 || this.isStorePersistenceUnavailable()) {
			throw new Error('Developer API grant persistence is unavailable');
		}
	}

	private deferPendingRequest(
		consumer: DeveloperApiConsumerMetadataV1,
		requestedCapabilities: readonly DeveloperApiGrantCapabilityV1[],
	): void {
		const existing = this.deferredPendingRequests.get(consumer.id);
		this.deferredPendingRequests.set(consumer.id, {
			consumer: { ...consumer },
			capabilities: [...new Set([
				...(existing?.capabilities ?? []),
				...requestedCapabilities,
			])],
		});
	}

	private flushDeferredPendingRequests(): void {
		while (this.pendingWrites === 0 && !this.hasPersistenceFailure()) {
			const next = this.deferredPendingRequests.entries().next();
			if (next.done) return;
			const [consumerId, request] = next.value;
			this.deferredPendingRequests.delete(consumerId);
			if (this.applyPendingRequest(request.consumer, request.capabilities)) return;
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

	private nowIso(): string {
		return (this.options.now?.() ?? new Date()).toISOString();
	}
}

function approvalBindingsEqual(
	left: DeveloperApiGrantApprovalBindingV1,
	right: DeveloperApiGrantApprovalBindingV1,
): boolean {
	return left.consumerId === right.consumerId
		&& left.expectedRevision === right.expectedRevision
		&& left.expectedConsumerName === right.expectedConsumerName
		&& left.expectedConsumerVersion === right.expectedConsumerVersion
		&& left.expectedObservedConsumerVersion === right.expectedObservedConsumerVersion
		&& left.expectedApprovedMajorVersion === right.expectedApprovedMajorVersion
		&& left.expectedState === right.expectedState
		&& left.expectedSuspensionReason === right.expectedSuspensionReason
		&& left.expectedLiveConsumerName === right.expectedLiveConsumerName
		&& left.expectedLiveConsumerVersion === right.expectedLiveConsumerVersion
		&& left.expectedInstanceEpoch === right.expectedInstanceEpoch
		&& capabilityListsEqual(left.expectedGrantedCapabilities, right.expectedGrantedCapabilities)
		&& capabilityListsEqual(left.expectedPendingCapabilities, right.expectedPendingCapabilities)
		&& capabilityListsEqual(left.expectedApprovableCapabilities, right.expectedApprovableCapabilities);
}

function capabilityListsEqual(
	left: readonly DeveloperApiGrantCapabilityV1[],
	right: readonly DeveloperApiGrantCapabilityV1[],
): boolean {
	return left.length === right.length
		&& left.every((capability, index) => capability === right[index]);
}
