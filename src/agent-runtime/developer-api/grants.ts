import {
	isCapabilityIdV1,
	type CapabilityIdV1,
} from '../contracts/v1/capabilities';
import { isTaskWorkflowCapabilityIdV1, type TaskWorkflowCapabilityIdV1 } from '../extensions/task-workflows-v1';

export type DeveloperApiGrantCapabilityV1 = CapabilityIdV1 | TaskWorkflowCapabilityIdV1;

export const DEVELOPER_API_GRANT_PACKAGE_VERSION = 1 as const;

export type DeveloperApiPersistedGrantStateV1 = 'active' | 'suspended' | 'revoked';
export type DeveloperApiGrantSuspensionReasonV1 =
	| 'consumer-version-invalid'
	| 'consumer-major-version-changed'
	| 'consumer-version-regressed'
	| 'audit-activation-incomplete';

export interface DeveloperApiConsumerDescriptorV1 {
	readonly id: string;
	readonly name: string;
	readonly version: string;
	readonly instanceEpoch: string;
}
export type DeveloperApiConsumerMetadataV1 = Pick<
	DeveloperApiConsumerDescriptorV1,
	'id' | 'name' | 'version'
>;

export interface DeveloperApiGrantRecordV1 {
	readonly consumerId: string;
	readonly consumerName: string;
	readonly consumerVersion: string;
	readonly observedConsumerVersion?: string;
	readonly approvedMajorVersion: number;
	readonly state: DeveloperApiPersistedGrantStateV1;
	readonly suspensionReason?: DeveloperApiGrantSuspensionReasonV1;
	readonly revision: number;
	readonly grantedCapabilities: readonly DeveloperApiGrantCapabilityV1[];
	readonly pendingCapabilities: readonly DeveloperApiGrantCapabilityV1[];
	readonly createdAt: string;
	readonly updatedAt: string;
}

export interface DeveloperApiGrantPackageV1 {
	readonly version: typeof DEVELOPER_API_GRANT_PACKAGE_VERSION;
	readonly consumersById: Readonly<Record<string, DeveloperApiGrantRecordV1>>;
}

export interface DeveloperApiGrantEvaluationV1 {
	readonly state: 'pending' | DeveloperApiPersistedGrantStateV1;
	readonly revision: number;
	readonly grantedCapabilities: readonly DeveloperApiGrantCapabilityV1[];
	readonly effectiveCapabilities: readonly DeveloperApiGrantCapabilityV1[];
	readonly pendingCapabilities: readonly DeveloperApiGrantCapabilityV1[];
	readonly reason:
		| 'active'
		| 'capability-approval-required'
		| 'consumer-version-invalid'
		| 'consumer-major-version-changed'
		| 'consumer-version-regressed'
		| 'audit-activation-incomplete'
		| 'grant-persistence-unavailable'
		| 'revoked';
}

export function createEmptyDeveloperApiGrantPackage(): DeveloperApiGrantPackageV1 {
	return {
		version: DEVELOPER_API_GRANT_PACKAGE_VERSION,
		consumersById: {},
	};
}

export function isUnsupportedDeveloperApiGrantPackage(value: unknown): boolean {
	if (value === undefined) return false;
	if (!isRecord(value)) return true;
	const version: unknown = value.version;
	if (!Object.prototype.hasOwnProperty.call(value, 'version')) return true;
	return version !== DEVELOPER_API_GRANT_PACKAGE_VERSION;
}

export function normalizeDeveloperApiGrantPackage(value: unknown): DeveloperApiGrantPackageV1 {
	if (
		!isRecord(value)
		|| isUnsupportedDeveloperApiGrantPackage(value)
		|| !isRecord(value.consumersById)
	) {
		return createEmptyDeveloperApiGrantPackage();
	}
	const consumersById: Record<string, DeveloperApiGrantRecordV1> = {};
	for (const [rawConsumerId, rawRecord] of Object.entries(value.consumersById)) {
		const consumerId = normalizeConsumerId(rawConsumerId);
		const record = normalizeGrantRecord(rawRecord, consumerId);
		if (record) consumersById[consumerId] = record;
	}
	return {
		version: DEVELOPER_API_GRANT_PACKAGE_VERSION,
		consumersById: sortRecord(consumersById),
	};
}

export function evaluateDeveloperApiGrant(
	value: unknown,
	consumer: DeveloperApiConsumerMetadataV1,
	requestedCapabilities: readonly DeveloperApiGrantCapabilityV1[],
): DeveloperApiGrantEvaluationV1 {
	const grantPackage = normalizeDeveloperApiGrantPackage(value);
	const record = grantPackage.consumersById[consumer.id];
	const requested = normalizeCapabilities(requestedCapabilities);
	if (!record) {
		return {
			state: 'pending',
			revision: 0,
			grantedCapabilities: [],
			effectiveCapabilities: [],
			pendingCapabilities: requested,
			reason: 'capability-approval-required',
		};
	}
	if (record.state === 'revoked') {
		return {
			state: 'revoked',
			revision: record.revision,
			grantedCapabilities: record.grantedCapabilities,
			effectiveCapabilities: [],
			pendingCapabilities: [],
			reason: 'revoked',
		};
	}
	const currentVersion = parseStrictSemver(consumer.version);
	const approvedVersion = parseStrictSemver(record.consumerVersion);
	if (record.state === 'suspended') {
		return suspendedEvaluation(
			record,
			record.suspensionReason ?? 'consumer-major-version-changed',
		);
	}
	if (!currentVersion || !approvedVersion) {
		return suspendedEvaluation(record, 'consumer-version-invalid');
	}
	if (currentVersion.major !== record.approvedMajorVersion) {
		return suspendedEvaluation(record, 'consumer-major-version-changed');
	}
	if (compareSemver(currentVersion, approvedVersion) < 0) {
		return suspendedEvaluation(record, 'consumer-version-regressed');
	}
	const granted = new Set(record.grantedCapabilities);
	const pendingCapabilities = requested.filter(capability => !granted.has(capability));
	if (pendingCapabilities.length > 0) {
		return {
			state: 'pending',
			revision: record.revision,
			grantedCapabilities: record.grantedCapabilities,
			effectiveCapabilities: [],
			pendingCapabilities,
			reason: 'capability-approval-required',
		};
	}
	return {
		state: 'active',
		revision: record.revision,
		grantedCapabilities: record.grantedCapabilities,
		effectiveCapabilities: requested,
		pendingCapabilities: [],
		reason: 'active',
	};
}

export function recordDeveloperApiGrantRequest(
	value: unknown,
	consumer: DeveloperApiConsumerMetadataV1,
	requestedCapabilities: readonly DeveloperApiGrantCapabilityV1[],
	nowIso: string,
): DeveloperApiGrantPackageV1 {
	const grantPackage = normalizeDeveloperApiGrantPackage(value);
	const existing = grantPackage.consumersById[consumer.id];
	if (existing?.state === 'revoked') return grantPackage;
	const requested = normalizeCapabilities(requestedCapabilities);
	const currentVersion = parseStrictSemver(consumer.version);
	const reconciled = reconcileDeveloperApiConsumerVersion(
		grantPackage,
		consumer,
		requested,
		nowIso,
	).grantPackage;
	const reconciledExisting = reconciled.consumersById[consumer.id];
	const evaluation = evaluateDeveloperApiGrant(reconciled, consumer, requested);
	const pendingCapabilities = normalizeCapabilities([
		...(reconciledExisting?.pendingCapabilities ?? []),
		...evaluation.pendingCapabilities,
		...(evaluation.state === 'suspended' ? requested : []),
	]);
	const next: DeveloperApiGrantRecordV1 = {
		consumerId: consumer.id,
		consumerName: consumer.name,
		consumerVersion: reconciledExisting?.consumerVersion
			?? (currentVersion ? consumer.version : '0.0.0'),
		...(reconciledExisting?.observedConsumerVersion
			? { observedConsumerVersion: reconciledExisting.observedConsumerVersion }
			: !currentVersion
				? { observedConsumerVersion: consumer.version }
				: {}),
		approvedMajorVersion: reconciledExisting?.approvedMajorVersion
			?? currentVersion?.major
			?? 0,
		state: reconciledExisting?.state ?? (currentVersion ? 'active' : 'suspended'),
		...(reconciledExisting?.suspensionReason
			? { suspensionReason: reconciledExisting.suspensionReason }
			: !currentVersion
				? { suspensionReason: 'consumer-version-invalid' as const }
				: {}),
		revision: reconciledExisting?.revision ?? 0,
		grantedCapabilities: reconciledExisting?.grantedCapabilities ?? [],
		pendingCapabilities,
		createdAt: reconciledExisting?.createdAt ?? nowIso,
		updatedAt: nowIso,
	};
	if (reconciledExisting && grantRecordsEqualExceptUpdatedAt(next, reconciledExisting)) {
		return reconciled;
	}
	return replaceRecord(reconciled, next);
}

function grantRecordsEqualExceptUpdatedAt(
	left: DeveloperApiGrantRecordV1,
	right: DeveloperApiGrantRecordV1,
): boolean {
	return left.consumerId === right.consumerId
		&& left.consumerName === right.consumerName
		&& left.consumerVersion === right.consumerVersion
		&& left.observedConsumerVersion === right.observedConsumerVersion
		&& left.approvedMajorVersion === right.approvedMajorVersion
		&& left.state === right.state
		&& left.suspensionReason === right.suspensionReason
		&& left.revision === right.revision
		&& left.createdAt === right.createdAt
		&& left.grantedCapabilities.length === right.grantedCapabilities.length
		&& left.grantedCapabilities.every((capability, index) => (
			capability === right.grantedCapabilities[index]
		))
		&& left.pendingCapabilities.length === right.pendingCapabilities.length
		&& left.pendingCapabilities.every((capability, index) => (
			capability === right.pendingCapabilities[index]
		));
}

export function suspendDeveloperApiGrantForAuditRecovery(
	value: unknown,
	consumerId: string,
	expectedRevision: number,
	nowIso: string,
): DeveloperApiGrantPackageV1 {
	const grantPackage = normalizeDeveloperApiGrantPackage(value);
	const existing = grantPackage.consumersById[consumerId];
	if (
		!existing
		|| existing.state === 'revoked'
		|| existing.revision !== expectedRevision
	) return grantPackage;
	return replaceRecord(grantPackage, {
		...existing,
		state: 'suspended',
		suspensionReason: 'audit-activation-incomplete',
		revision: existing.revision + 1,
		updatedAt: nowIso,
	});
}

export interface DeveloperApiConsumerVersionReconciliationV1 {
	readonly grantPackage: DeveloperApiGrantPackageV1;
	readonly changed: boolean;
	readonly transition?: 'accepted' | 'suspended';
	readonly capabilities: readonly DeveloperApiGrantCapabilityV1[];
}

export function reconcileDeveloperApiConsumerVersion(
	value: unknown,
	consumer: DeveloperApiConsumerMetadataV1,
	requestedCapabilities: readonly DeveloperApiGrantCapabilityV1[],
	nowIso: string,
): DeveloperApiConsumerVersionReconciliationV1 {
	const grantPackage = normalizeDeveloperApiGrantPackage(value);
	const existing = grantPackage.consumersById[consumer.id];
	if (!existing || existing.state === 'revoked') {
		return { grantPackage, changed: false, capabilities: [] };
	}
	const currentVersion = parseStrictSemver(consumer.version);
	const acceptedVersion = parseStrictSemver(existing.consumerVersion);
	let suspensionReason: DeveloperApiGrantSuspensionReasonV1 | undefined;
	if (!currentVersion || !acceptedVersion) {
		suspensionReason = 'consumer-version-invalid';
	} else if (currentVersion.major !== existing.approvedMajorVersion) {
		suspensionReason = 'consumer-major-version-changed';
	} else if (compareSemver(currentVersion, acceptedVersion) < 0) {
		suspensionReason = 'consumer-version-regressed';
	}
	const requested = normalizeCapabilities(requestedCapabilities);
	if (suspensionReason) {
		if (
			existing.state === 'suspended'
			&& existing.suspensionReason === suspensionReason
			&& existing.observedConsumerVersion === consumer.version
			&& requested.every(capability => existing.pendingCapabilities.includes(capability))
		) {
			return { grantPackage, changed: false, capabilities: requested };
		}
		const next = replaceRecord(grantPackage, {
			...existing,
			consumerName: consumer.name,
			observedConsumerVersion: consumer.version,
			state: 'suspended',
			suspensionReason,
			revision: existing.revision + 1,
			pendingCapabilities: normalizeCapabilities([
				...existing.pendingCapabilities,
				...requested,
			]),
			updatedAt: nowIso,
		});
		return {
			grantPackage: next,
			changed: true,
			transition: 'suspended',
			capabilities: requested,
		};
	}
	if (!currentVersion || !acceptedVersion) {
		return { grantPackage, changed: false, capabilities: [] };
	}
	const comparison = compareSemver(currentVersion, acceptedVersion);
	if (comparison <= 0 || existing.state !== 'active') {
		return { grantPackage, changed: false, capabilities: [] };
	}
	const next = replaceRecord(grantPackage, {
		...existing,
		consumerName: consumer.name,
		consumerVersion: consumer.version,
		state: 'active',
		revision: existing.revision + 1,
		updatedAt: nowIso,
	});
	return {
		grantPackage: next,
		changed: true,
		transition: 'accepted',
		capabilities: requested,
	};
}

export function approveDeveloperApiCapabilities(
	value: unknown,
	consumer: DeveloperApiConsumerMetadataV1,
	capabilities: readonly DeveloperApiGrantCapabilityV1[],
	nowIso: string,
): DeveloperApiGrantPackageV1 {
	const version = parseStrictSemver(consumer.version);
	if (!version) throw new Error('Developer API consumer version must be valid SemVer');
	const grantPackage = normalizeDeveloperApiGrantPackage(value);
	const existing = grantPackage.consumersById[consumer.id];
	const approved = normalizeCapabilities(capabilities);
	const approvedSet = new Set(approved);
	const next: DeveloperApiGrantRecordV1 = {
		consumerId: consumer.id,
		consumerName: consumer.name,
		consumerVersion: consumer.version,
		approvedMajorVersion: version.major,
		state: 'active',
		revision: (existing?.revision ?? 0) + 1,
		grantedCapabilities: existing?.state === 'suspended'
			? approved
			: normalizeCapabilities([
				...(existing?.grantedCapabilities ?? []),
				...approved,
			]),
		pendingCapabilities: (existing?.pendingCapabilities ?? [])
			.filter(capability => !approvedSet.has(capability)),
		createdAt: existing?.createdAt ?? nowIso,
		updatedAt: nowIso,
	};
	return replaceRecord(grantPackage, next);
}

export function revokeDeveloperApiGrant(
	value: unknown,
	consumerId: string,
	nowIso: string,
): DeveloperApiGrantPackageV1 {
	const grantPackage = normalizeDeveloperApiGrantPackage(value);
	const existing = grantPackage.consumersById[consumerId];
	if (!existing) return grantPackage;
	return replaceRecord(grantPackage, {
		...existing,
		state: 'revoked',
		revision: existing.revision + 1,
		pendingCapabilities: [],
		updatedAt: nowIso,
	});
}

export function denyDeveloperApiCapabilities(
	value: unknown,
	consumerId: string,
	capabilities: readonly DeveloperApiGrantCapabilityV1[] | 'all',
	nowIso: string,
): DeveloperApiGrantPackageV1 {
	const grantPackage = normalizeDeveloperApiGrantPackage(value);
	const existing = grantPackage.consumersById[consumerId];
	if (!existing) return grantPackage;
	const denied = capabilities === 'all'
		? new Set(existing.pendingCapabilities)
		: new Set(normalizeCapabilities(capabilities));
	const pendingCapabilities = existing.pendingCapabilities
		.filter(capability => !denied.has(capability));
	const revokeEmptyPendingConsumer = capabilities === 'all'
		&& existing.grantedCapabilities.length === 0;
	return replaceRecord(grantPackage, {
		...existing,
		state: revokeEmptyPendingConsumer ? 'revoked' : existing.state,
		revision: existing.revision + 1,
		pendingCapabilities,
		updatedAt: nowIso,
	});
}

function suspendedEvaluation(
	record: DeveloperApiGrantRecordV1,
	reason: DeveloperApiGrantEvaluationV1['reason'],
): DeveloperApiGrantEvaluationV1 {
	return {
		state: 'suspended',
		revision: record.revision,
		grantedCapabilities: record.grantedCapabilities,
		effectiveCapabilities: [],
		pendingCapabilities: record.pendingCapabilities,
		reason,
	};
}

function normalizeGrantRecord(
	value: unknown,
	consumerId: string,
): DeveloperApiGrantRecordV1 | null {
	if (!consumerId || !isRecord(value)) return null;
	const version = readString(value.consumerVersion);
	const parsedVersion = parseStrictSemver(version);
	const state = value.state === 'active' || value.state === 'suspended' || value.state === 'revoked'
		? value.state
		: null;
	if (
		!state
		|| readString(value.consumerId) !== consumerId
		|| !readString(value.consumerName)
		|| !parsedVersion
		|| !Number.isSafeInteger(value.approvedMajorVersion)
		|| (value.approvedMajorVersion as number) < 0
		|| !Number.isSafeInteger(value.revision)
		|| (value.revision as number) < 0
		|| !isIsoTimestamp(value.createdAt)
		|| !isIsoTimestamp(value.updatedAt)
	) {
		return null;
	}
	return {
		consumerId,
		consumerName: readString(value.consumerName),
		consumerVersion: version,
		...(typeof value.observedConsumerVersion === 'string'
			? { observedConsumerVersion: value.observedConsumerVersion }
			: {}),
		approvedMajorVersion: value.approvedMajorVersion as number,
		state,
		...(value.suspensionReason === 'consumer-version-invalid'
			|| value.suspensionReason === 'consumer-major-version-changed'
			|| value.suspensionReason === 'consumer-version-regressed'
			|| value.suspensionReason === 'audit-activation-incomplete'
			? { suspensionReason: value.suspensionReason }
			: {}),
		revision: value.revision as number,
		grantedCapabilities: normalizeCapabilities(value.grantedCapabilities),
		pendingCapabilities: normalizeCapabilities(value.pendingCapabilities),
		createdAt: value.createdAt as string,
		updatedAt: value.updatedAt as string,
	};
}

function replaceRecord(
	grantPackage: DeveloperApiGrantPackageV1,
	record: DeveloperApiGrantRecordV1,
): DeveloperApiGrantPackageV1 {
	return {
		version: DEVELOPER_API_GRANT_PACKAGE_VERSION,
		consumersById: sortRecord({
			...grantPackage.consumersById,
			[record.consumerId]: record,
		}),
	};
}

function normalizeCapabilities(value: unknown): DeveloperApiGrantCapabilityV1[] {
	if (!Array.isArray(value)) return [];
	return [...new Set(value.filter((item): item is DeveloperApiGrantCapabilityV1 => (
		typeof item === 'string' && (isCapabilityIdV1(item) || isTaskWorkflowCapabilityIdV1(item))
	)))].sort((left, right) => left.localeCompare(right));
}

function normalizeConsumerId(value: string): string {
	return value.trim();
}

interface ParsedSemver {
	major: number;
	minor: number;
	patch: number;
	prerelease: readonly (string | number)[];
}

function parseStrictSemver(value: string): ParsedSemver | null {
	const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.exec(value);
	if (!match) return null;
	const prerelease = match[4]
		? match[4].split('.').map(part => /^\d+$/u.test(part) ? Number(part) : part)
		: [];
	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
		prerelease,
	};
}

function compareSemver(left: ParsedSemver, right: ParsedSemver): number {
	for (const key of ['major', 'minor', 'patch'] as const) {
		if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
	}
	if (left.prerelease.length === 0) return right.prerelease.length === 0 ? 0 : 1;
	if (right.prerelease.length === 0) return -1;
	const length = Math.max(left.prerelease.length, right.prerelease.length);
	for (let index = 0; index < length; index += 1) {
		const leftPart = left.prerelease[index];
		const rightPart = right.prerelease[index];
		if (leftPart === undefined) return -1;
		if (rightPart === undefined) return 1;
		if (leftPart === rightPart) continue;
		if (typeof leftPart === 'number' && typeof rightPart === 'string') return -1;
		if (typeof leftPart === 'string' && typeof rightPart === 'number') return 1;
		return leftPart < rightPart ? -1 : 1;
	}
	return 0;
}

function readString(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function isIsoTimestamp(value: unknown): boolean {
	return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sortRecord<T>(value: Record<string, T>): Record<string, T> {
	return Object.fromEntries(
		Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
	);
}
