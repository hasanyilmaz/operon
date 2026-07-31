import type {
	ContextRevisionV1,
	DurableIndexRevisionV1,
	IndexRevisionV1,
} from '../contracts/v1/identity';
import { sha256HexV1 } from '../contracts/v1/canonical';
import type {
	RuntimeRevisionPortsV1,
	RuntimeRevisionSnapshotV1,
} from './types';

export function createAgentRuntimeSessionId(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return `runtime-${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

export class SealedIndexRevisionV1 {
	private ramGeneration = 0;
	private durable: DurableIndexRevisionV1;

	constructor(
		private readonly sessionId: string,
		initial: DurableIndexRevisionV1,
	) {
		this.durable = cloneDurable(initial);
	}

	updateRamGeneration(generation: number): void {
		assertGeneration(generation);
		if (generation < this.ramGeneration) {
			throw new Error('Runtime RAM generation cannot move backwards within one session.');
		}
		this.ramGeneration = generation;
	}

	sealDurableRevision(revision: DurableIndexRevisionV1): void {
		this.durable = cloneDurable(revision);
	}

	snapshot(): IndexRevisionV1 {
		return {
			sessionId: this.sessionId,
			ramGeneration: this.ramGeneration,
			durable: cloneDurable(this.durable),
		};
	}
}

export function sampleRuntimeRevisionV1(ports: RuntimeRevisionPortsV1): RuntimeRevisionSnapshotV1 {
	const contextRevision: ContextRevisionV1 = {
		index: cloneIndexRevision(ports.indexRevision()),
		settingsFingerprint: ports.settingsFingerprint(),
		pinnedGeneration: ports.pinnedGeneration(),
		activeTrackerGeneration: ports.activeTrackerGeneration(),
		repeatSeriesRevision: ports.repeatSeriesRevision(),
		projectSerialGeneration: ports.projectSerialGeneration(),
		projectSerialSignature: ports.projectSerialSignature(),
	};
	return {
		contextRevision,
		packageRevision: ports.packageRevision(),
	};
}

export function hashProjectSerialSignatureV1(value: string): string {
	return sha256HexV1(value);
}

export function equalRuntimeRevisionV1(
	left: RuntimeRevisionSnapshotV1,
	right: RuntimeRevisionSnapshotV1,
): boolean {
	return left.packageRevision === right.packageRevision
		&& equalContextRevision(left.contextRevision, right.contextRevision);
}

export function cloneRuntimeRevisionV1(revision: RuntimeRevisionSnapshotV1): RuntimeRevisionSnapshotV1 {
	return {
		contextRevision: {
			...revision.contextRevision,
			index: cloneIndexRevision(revision.contextRevision.index),
		},
		packageRevision: revision.packageRevision,
	};
}

function equalContextRevision(left: ContextRevisionV1, right: ContextRevisionV1): boolean {
	return left.settingsFingerprint === right.settingsFingerprint
		&& left.pinnedGeneration === right.pinnedGeneration
		&& left.activeTrackerGeneration === right.activeTrackerGeneration
		&& left.repeatSeriesRevision === right.repeatSeriesRevision
		&& left.projectSerialGeneration === right.projectSerialGeneration
		&& left.projectSerialSignature === right.projectSerialSignature
		&& left.index.sessionId === right.index.sessionId
		&& left.index.ramGeneration === right.index.ramGeneration
		&& equalDurableIndexRevision(left.index.durable, right.index.durable);
}

function cloneIndexRevision(revision: IndexRevisionV1): IndexRevisionV1 {
	return {
		...revision,
		durable: cloneDurable(revision.durable),
	};
}

function cloneDurable(revision: DurableIndexRevisionV1): DurableIndexRevisionV1 {
	return { ...revision };
}

function equalDurableIndexRevision(
	left: DurableIndexRevisionV1,
	right: DurableIndexRevisionV1,
): boolean {
	if (left.status !== right.status) return false;
	if (left.status !== 'available' || right.status !== 'available') return true;
	return left.snapshotId === right.snapshotId && left.committedAt === right.committedAt;
}

function assertGeneration(generation: number): void {
	if (!Number.isSafeInteger(generation) || generation < 0) {
		throw new Error('Runtime RAM generation must be a non-negative safe integer.');
	}
}
