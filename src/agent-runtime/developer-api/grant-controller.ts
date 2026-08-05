import type { CapabilityIdV1 } from '../contracts/v1/capabilities';
import type { OperonDeveloperApiConsumerPluginV1 } from '../public/v1/developer-api';
import {
	approveDeveloperApiCapabilities,
	denyDeveloperApiCapabilities,
	evaluateDeveloperApiGrant,
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
} from './grants';
import type { OperonDataPackageV1 } from '../../storage/operon-data-package';

export interface DeveloperApiGrantDataStoreV1 {
	getDataPackage(): OperonDataPackageV1;
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

export type DeveloperApiGrantAuditActionV1 =
	| 'request'
	| 'approve'
	| 'deny'
	| 'revoke'
	| 'version-accepted'
	| 'version-suspended';

export interface DeveloperApiGrantAuditEventV1 {
	readonly phase: 'intent' | 'activated';
	readonly action: DeveloperApiGrantAuditActionV1;
	readonly consumerId: string;
	readonly consumerName: string;
	readonly consumerVersion: string;
	readonly capabilities: readonly CapabilityIdV1[];
	readonly revision: number;
	readonly occurredAt: string;
}

export interface DeveloperApiGrantAuditPortV1 {
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
	private pendingWrites = 0;
	private writeQueue: Promise<void> = Promise.resolve();

	constructor(private readonly options: DeveloperApiGrantControllerOptionsV1) {
		this.grants = normalizeDeveloperApiGrantPackage(
			options.store.getDataPackage().integrations.developerApi,
		);
		const nowIso = this.nowIso();
		for (const transition of options.startupAuditRecoveryTransitions ?? []) {
			this.grants = suspendDeveloperApiGrantForAuditRecovery(
				this.grants,
				transition.consumerId,
				transition.revision,
				nowIso,
			);
		}
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
		requestedCapabilities: readonly CapabilityIdV1[],
	): DeveloperApiGrantEvaluationV1 {
		this.observeConsumerVersion(consumer, requestedCapabilities);
		const evaluation = evaluateDeveloperApiGrant(this.grants, consumer, requestedCapabilities);
		if (
			this.persistenceError === null
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
		requestedCapabilities: readonly CapabilityIdV1[],
	): boolean {
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
		requestedCapabilities: readonly CapabilityIdV1[],
	): void {
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
		capabilities: readonly CapabilityIdV1[],
	): Promise<DeveloperApiGrantRecordV1> {
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
		const next = revokeDeveloperApiGrant(this.grants, consumerId, this.nowIso());
		this.grants = next;
		this.enqueuePersist(next, this.auditTransition('revoke', next, consumerId, []));
		await this.drain();
		return this.grants.consumersById[consumerId] ?? null;
	}

	async approvePending(
		consumerId: string,
		capabilities: readonly CapabilityIdV1[],
	): Promise<DeveloperApiGrantRecordV1> {
		const existing = this.requireRecord(consumerId);
		const pending = new Set(existing.pendingCapabilities);
		const approved = capabilities.filter(capability => pending.has(capability));
		if (approved.length === 0) {
			throw new Error(`No requested Developer API capabilities selected for ${consumerId}`);
		}
		return this.approve({
			id: existing.consumerId,
			name: existing.consumerName,
			version: existing.observedConsumerVersion ?? existing.consumerVersion,
		}, approved);
	}

	async denyPending(
		consumerId: string,
		capabilities: readonly CapabilityIdV1[] | 'all' = 'all',
	): Promise<DeveloperApiGrantRecordV1> {
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
		return Object.values(this.grants.consumersById).map(record => structuredClone(record));
	}

	hasPersistenceError(): boolean {
		return this.persistenceError !== null || this.pendingWrites > 0;
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
		}>,
	): void {
		this.persistenceError = null;
		this.pendingWrites += 1;
		this.writeQueue = this.writeQueue
			.catch(() => undefined)
			.then(async () => {
				if (audit) await this.options.audit?.record(audit.intent);
				await this.options.store.updateDataPackage(dataPackage => ({
					...dataPackage,
					integrations: {
						...dataPackage.integrations,
						developerApi: normalizeDeveloperApiGrantPackage(snapshot),
					},
				}));
				if (audit) await this.options.audit?.record(audit.activated);
				this.pendingWrites -= 1;
				if (this.pendingWrites === 0) this.persistenceError = null;
			})
			.catch(error => {
				this.pendingWrites -= 1;
				this.persistenceError = error instanceof Error ? error : new Error(String(error));
				throw this.persistenceError;
			});
	}

	private auditTransition(
		action: DeveloperApiGrantAuditActionV1,
		snapshot: DeveloperApiGrantPackageV1,
		consumerId: string,
		capabilities: readonly CapabilityIdV1[],
	): { intent: DeveloperApiGrantAuditEventV1; activated: DeveloperApiGrantAuditEventV1 } | undefined {
		if (!this.options.audit) return undefined;
		const record = snapshot.consumersById[consumerId];
		if (!record) return undefined;
		const occurredAt = this.nowIso();
		const base = {
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
