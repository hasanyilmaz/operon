import type { DataAdapter } from 'obsidian';
import { isSafeVaultRelativeMarkdownPath } from '../core/vault-path-safety';
import { writeTextSafely } from './storage-file-ops';
import type { WriteQueue } from './write-queue';

export const PERIODIC_NOTE_CONTAINER_REGISTRY_VERSION = 1 as const;

type PeriodicNoteKind = 'daily' | 'weekly';
export type PeriodicNoteContainerRegistryKind = PeriodicNoteKind | 'ambiguous';
export type PeriodicNoteContainerRegistrySource = 'operon' | 'core-daily-notes';

export interface PeriodicNoteContainerRegistryEntryV1 {
	operonId: string;
	kind: PeriodicNoteContainerRegistryKind;
	lastKnownPath: string;
	anchorDateKey?: string;
	source?: PeriodicNoteContainerRegistrySource;
}

export interface PeriodicNoteContainerRegistryDataV1 {
	version: typeof PERIODIC_NOTE_CONTAINER_REGISTRY_VERSION;
	containers: PeriodicNoteContainerRegistryEntryV1[];
}

export type PeriodicNoteContainerRegistryHealth = 'healthy' | 'suspended';

export type PeriodicNoteContainerRegistryLookup =
	| { kind: 'unhealthy' }
	| { kind: 'none' }
	| { kind: 'mismatch' }
	| { kind: 'ambiguous' }
	| {
		kind: 'periodic';
		periodicKind: PeriodicNoteKind;
		anchorDateKey: string;
		source?: PeriodicNoteContainerRegistrySource;
	};

export interface PeriodicNoteContainerRegistryLoadResult {
	status: 'missing' | 'loaded' | 'invalid' | 'future-version' | 'read-failed';
}

export type PeriodicNoteContainerRegistryPersistenceResult =
	| { status: 'committed'; acknowledgement: 'direct' | 'candidate-after-error' }
	| { status: 'clean-failure'; message: string }
	| { status: 'uncertain'; message: string; recoveryRequired: true };

export interface PeriodicNoteContainerRegistryBackfillResult {
	added: number;
	conflicted: number;
	persistence: PeriodicNoteContainerRegistryPersistenceResult;
}

export type PeriodicNoteContainerRegistryLifecycleResult =
	| PeriodicNoteContainerRegistryPersistenceResult
	| { status: 'not-applicable' };

type RegistryStorageAdapter = Pick<DataAdapter, 'exists' | 'read' | 'write' | 'remove'>
	& Partial<Pick<DataAdapter, 'process' | 'rename'>>;

type RegistryDiskState = { kind: 'missing' } | { kind: 'present'; raw: string };

const REGISTRY_ROOT_KEYS = new Set(['version', 'containers']);
const REGISTRY_ENTRY_KEYS = new Set(['operonId', 'kind', 'lastKnownPath', 'anchorDateKey', 'source']);
const ISO_DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/u;

/**
 * Internal, restart-safe identity for Daily/Weekly File Task containers.
 * It deliberately never writes a marker into the user's markdown frontmatter.
 */
export class PeriodicNoteContainerRegistry {
	private entriesByOperonId = new Map<string, PeriodicNoteContainerRegistryEntryV1>();
	private health: PeriodicNoteContainerRegistryHealth = 'healthy';
	private suspensionReason: string | null = null;
	private lastAcknowledgedDiskState: RegistryDiskState | null = null;
	private mutationQueue: Promise<void> = Promise.resolve();

	constructor(
		private readonly adapter: RegistryStorageAdapter,
		private readonly writeQueue: WriteQueue,
		private readonly filePath: string,
	) {}

	async load(): Promise<PeriodicNoteContainerRegistryLoadResult> {
		return await this.enqueueMutation(async () => {
			let exists: boolean;
			try {
				exists = await this.adapter.exists(this.filePath);
			} catch (error) {
				this.suspend(errorMessage(error, 'Could not inspect periodic container registry.'));
				return { status: 'read-failed' };
			}
			if (!exists) {
				this.entriesByOperonId = new Map();
				this.lastAcknowledgedDiskState = { kind: 'missing' };
				this.resume();
				return { status: 'missing' };
			}

			let raw: string;
			try {
				raw = await this.adapter.read(this.filePath);
			} catch (error) {
				this.suspend(errorMessage(error, 'Could not read periodic container registry.'));
				return { status: 'read-failed' };
			}
			const inspected = inspectPeriodicNoteContainerRegistryV1(raw);
			if (inspected.kind === 'future-version') {
				this.suspend('Periodic container registry has a newer unsupported version.');
				return { status: 'future-version' };
			}
			if (inspected.kind !== 'valid') {
				this.suspend('Periodic container registry is malformed or unsupported.');
				return { status: 'invalid' };
			}
			this.entriesByOperonId = entriesToMap(inspected.data.containers);
			this.lastAcknowledgedDiskState = { kind: 'present', raw };
			this.resume();
			return { status: 'loaded' };
		});
	}

	isHealthy(): boolean {
		return this.health === 'healthy';
	}

	getHealth(): PeriodicNoteContainerRegistryHealth {
		return this.health;
	}

	getSuspensionReason(): string | null {
		return this.suspensionReason;
	}

	/** Runtime identity/adoption failures must pause the mover without rewriting state. */
	suspendForRuntimeFailure(reason: string): void {
		this.suspend(reason);
	}

	getEntry(operonId: string): PeriodicNoteContainerRegistryEntryV1 | null {
		if (!this.isHealthy()) return null;
		const entry = this.entriesByOperonId.get(operonId.trim());
		return entry ? cloneEntry(entry) : null;
	}

	lookup(task: {
		operonId: string;
		primary: { format: 'inline' | 'yaml'; filePath: string };
	}): PeriodicNoteContainerRegistryLookup {
		if (!this.isHealthy()) return { kind: 'unhealthy' };
		if (task.primary.format !== 'yaml') return { kind: 'none' };
		const entry = this.entriesByOperonId.get(task.operonId.trim());
		if (!entry) return { kind: 'none' };
		if (entry.lastKnownPath !== task.primary.filePath) return { kind: 'mismatch' };
		if (entry.kind === 'ambiguous') return { kind: 'ambiguous' };
		return {
			kind: 'periodic',
			periodicKind: entry.kind,
			anchorDateKey: entry.anchorDateKey!,
			...(entry.source ? { source: entry.source } : {}),
		};
	}

	/** Add verified legacy candidates without rewriting pre-existing identity. */
	async backfill(entries: readonly PeriodicNoteContainerRegistryEntryV1[]): Promise<PeriodicNoteContainerRegistryBackfillResult> {
		return await this.enqueueMutation(async () => {
			this.assertHealthy();
			const uniqueInputs = new Map<string, PeriodicNoteContainerRegistryEntryV1>();
			const conflictingInputIds = new Set<string>();
			for (const input of entries) {
				const entry = normalizePeriodicNoteContainerRegistryEntryV1(input);
				if (!entry) throw new Error('Cannot backfill an invalid periodic container identity.');
				const previous = uniqueInputs.get(entry.operonId);
				if (!previous) {
					uniqueInputs.set(entry.operonId, entry);
				} else if (!sameEntry(previous, entry)) {
					conflictingInputIds.add(entry.operonId);
				}
			}
			const next = cloneEntriesMap(this.entriesByOperonId);
			let added = 0;
			let conflicted = 0;
			for (const entry of uniqueInputs.values()) {
				if (conflictingInputIds.has(entry.operonId)) {
					conflicted += 1;
					continue;
				}
				const existing = next.get(entry.operonId);
				if (!existing) {
					next.set(entry.operonId, entry);
					added += 1;
					continue;
				}
				if (!sameEntry(existing, entry)) conflicted += 1;
			}
			if (added === 0) {
				return { added, conflicted, persistence: { status: 'committed', acknowledgement: 'direct' } };
			}
			const persistence = await this.persist(next);
			return {
				added: persistence.status === 'committed' ? added : 0,
				conflicted,
				persistence,
			};
		});
	}

	/** Register only an exact, already-indexed File Task container. */
	async register(entryInput: PeriodicNoteContainerRegistryEntryV1): Promise<PeriodicNoteContainerRegistryPersistenceResult> {
		return await this.enqueueMutation(async () => {
			this.assertHealthy();
			const entry = normalizePeriodicNoteContainerRegistryEntryV1(entryInput);
			if (!entry) throw new Error('Cannot register an invalid periodic container identity.');
			const existing = this.entriesByOperonId.get(entry.operonId);
			if (existing) {
				if (sameIdentity(existing, entry)) {
					if (existing.source || !entry.source || existing.source === entry.source) {
						return { status: 'committed', acknowledgement: 'direct' };
					}
					const next = cloneEntriesMap(this.entriesByOperonId);
					next.set(entry.operonId, { ...existing, source: entry.source });
					return await this.persist(next);
				}
				throw new Error(`Periodic container identity already exists for ${entry.operonId}.`);
			}
			const next = cloneEntriesMap(this.entriesByOperonId);
			next.set(entry.operonId, entry);
			return await this.persist(next);
		});
	}

	/** A vault rename is authoritative only when the indexed old identity matches exactly. */
	async recordVerifiedRename(
		operonId: string,
		oldPath: string,
		newPath: string,
	): Promise<PeriodicNoteContainerRegistryLifecycleResult> {
		return await this.enqueueMutation(async () => {
			if (!this.isHealthy()) return { status: 'not-applicable' };
			if (!isSafeVaultRelativeMarkdownPath(newPath)) return { status: 'not-applicable' };
			const entry = this.entriesByOperonId.get(operonId.trim());
			if (!entry || entry.lastKnownPath !== oldPath) return { status: 'not-applicable' };
			const next = cloneEntriesMap(this.entriesByOperonId);
			next.set(entry.operonId, { ...entry, lastKnownPath: newPath });
			return await this.persist(next);
		});
	}

	/** Delete only an exact, verified vault identity; incomplete indexing never prunes state. */
	async recordVerifiedDelete(
		operonId: string,
		filePath: string,
	): Promise<PeriodicNoteContainerRegistryLifecycleResult> {
		return await this.enqueueMutation(async () => {
			if (!this.isHealthy()) return { status: 'not-applicable' };
			const entry = this.entriesByOperonId.get(operonId.trim());
			if (!entry || entry.lastKnownPath !== filePath) return { status: 'not-applicable' };
			const next = cloneEntriesMap(this.entriesByOperonId);
			next.delete(entry.operonId);
			return await this.persist(next);
		});
	}

	/**
	 * Vault events can deliver delete before the index observes a preceding rename.
	 * The serialized registry path is still authoritative when exactly one stable
	 * container identity owns the deleted path.
	 */
	async recordVerifiedDeleteByPath(filePath: string): Promise<PeriodicNoteContainerRegistryLifecycleResult> {
		return await this.enqueueMutation(async () => {
			if (!this.isHealthy()) return { status: 'not-applicable' };
			const matches = [...this.entriesByOperonId.values()].filter(entry => entry.lastKnownPath === filePath);
			if (matches.length !== 1) return { status: 'not-applicable' };
			const next = cloneEntriesMap(this.entriesByOperonId);
			next.delete(matches[0].operonId);
			return await this.persist(next);
		});
	}

	async drain(): Promise<void> {
		await this.mutationQueue;
	}

	private async persist(
		next: ReadonlyMap<string, PeriodicNoteContainerRegistryEntryV1>,
	): Promise<PeriodicNoteContainerRegistryPersistenceResult> {
		const data: PeriodicNoteContainerRegistryDataV1 = {
			version: PERIODIC_NOTE_CONTAINER_REGISTRY_VERSION,
			containers: [...next.values()].map(cloneEntry).sort(compareEntries),
		};
		const serialized = JSON.stringify(data, null, '\t');
		const observed = await this.captureExactCurrentState();
		if (!observed.ok) {
			this.suspend(observed.message);
			return { status: 'uncertain', message: observed.message, recoveryRequired: true };
		}
		const previous = this.lastAcknowledgedDiskState;
		if (!previous || !sameDiskState(observed.state, previous)) {
			const message = 'Periodic container registry changed outside the current session before write.';
			this.suspend(message);
			return { status: 'uncertain', message, recoveryRequired: true };
		}
		try {
			await this.writeQueue.enqueue(this.filePath, async () => {
				await writeTextSafely(this.adapter, this.filePath, serialized, { forceAtomicReplacement: true });
				const readback = await this.adapter.read(this.filePath);
				if (readback !== serialized) {
					throw new Error('Periodic container registry write acknowledgement did not match the candidate.');
				}
			});
		} catch (error) {
			const acknowledgement = await this.readAcknowledgement(serialized, previous);
			if (acknowledgement === 'candidate') {
				this.entriesByOperonId = cloneEntriesMap(next);
				this.lastAcknowledgedDiskState = { kind: 'present', raw: serialized };
				return { status: 'committed', acknowledgement: 'candidate-after-error' };
			}
			if (acknowledgement === 'previous') {
				return { status: 'clean-failure', message: errorMessage(error, 'Periodic container registry write failed.') };
			}
			const message = errorMessage(error, 'Periodic container registry write failed.');
			this.suspend(message);
			return { status: 'uncertain', message, recoveryRequired: true };
		}
		this.entriesByOperonId = cloneEntriesMap(next);
		this.lastAcknowledgedDiskState = { kind: 'present', raw: serialized };
		return { status: 'committed', acknowledgement: 'direct' };
	}

	private async captureExactCurrentState(): Promise<
		| { ok: true; state: { kind: 'missing' } | { kind: 'present'; raw: string } }
		| { ok: false; message: string }
	> {
		try {
			if (!await this.adapter.exists(this.filePath)) return { ok: true, state: { kind: 'missing' } };
			return { ok: true, state: { kind: 'present', raw: await this.adapter.read(this.filePath) } };
		} catch (error) {
			return { ok: false, message: errorMessage(error, 'Could not capture periodic container registry state before write.') };
		}
	}

	private async readAcknowledgement(
		candidate: string,
		previous: { kind: 'missing' } | { kind: 'present'; raw: string },
	): Promise<'candidate' | 'previous' | 'foreign' | 'unreadable'> {
		try {
			const exists = await this.adapter.exists(this.filePath);
			if (!exists) return previous.kind === 'missing' ? 'previous' : 'foreign';
			const raw = await this.adapter.read(this.filePath);
			if (raw === candidate) return 'candidate';
			if (previous.kind === 'present' && raw === previous.raw) return 'previous';
			return 'foreign';
		} catch {
			return 'unreadable';
		}
	}

	private async enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
		const run = this.mutationQueue.then(operation, operation);
		this.mutationQueue = run.then(() => undefined, () => undefined);
		return await run;
	}

	private assertHealthy(): void {
		if (!this.isHealthy()) {
			throw new Error(`Periodic container registry writes are suspended: ${this.suspensionReason ?? 'registry is unhealthy'}`);
		}
	}

	private suspend(reason: string): void {
		this.health = 'suspended';
		this.suspensionReason = reason.trim() || 'Periodic container registry is unhealthy.';
	}

	private resume(): void {
		this.health = 'healthy';
		this.suspensionReason = null;
	}
}

export function parsePeriodicNoteContainerRegistryV1(raw: string): PeriodicNoteContainerRegistryDataV1 | null {
	const inspected = inspectPeriodicNoteContainerRegistryV1(raw);
	return inspected.kind === 'valid' ? inspected.data : null;
}

function inspectPeriodicNoteContainerRegistryV1(raw: string):
	| { kind: 'valid'; data: PeriodicNoteContainerRegistryDataV1 }
	| { kind: 'invalid' }
	| { kind: 'future-version' } {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw) as unknown;
	} catch {
		return { kind: 'invalid' };
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { kind: 'invalid' };
	const root = parsed as Record<string, unknown>;
	if (typeof root.version === 'number' && Number.isInteger(root.version) && root.version > PERIODIC_NOTE_CONTAINER_REGISTRY_VERSION) {
		return { kind: 'future-version' };
	}
	if (
		root.version !== PERIODIC_NOTE_CONTAINER_REGISTRY_VERSION
		|| !Array.isArray(root.containers)
		|| !hasExactKeys(root, REGISTRY_ROOT_KEYS)
	) return { kind: 'invalid' };
	const containers: PeriodicNoteContainerRegistryEntryV1[] = [];
	const seen = new Set<string>();
	for (const candidate of root.containers) {
		const entry = normalizePeriodicNoteContainerRegistryEntryV1(candidate);
		if (!entry || seen.has(entry.operonId)) return { kind: 'invalid' };
		seen.add(entry.operonId);
		containers.push(entry);
	}
	return {
		kind: 'valid',
		data: {
			version: PERIODIC_NOTE_CONTAINER_REGISTRY_VERSION,
			containers: containers.sort(compareEntries),
		},
	};
}

function normalizePeriodicNoteContainerRegistryEntryV1(input: unknown): PeriodicNoteContainerRegistryEntryV1 | null {
	if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
	const record = input as Record<string, unknown>;
	if (!hasAllowedKeys(record, REGISTRY_ENTRY_KEYS)) return null;
	const operonId = typeof record.operonId === 'string' ? record.operonId.trim() : '';
	const kind = record.kind;
	const lastKnownPath = typeof record.lastKnownPath === 'string' ? record.lastKnownPath.trim() : '';
	if (!operonId || !isSafeVaultRelativeMarkdownPath(lastKnownPath)) return null;
	if (kind !== 'daily' && kind !== 'weekly' && kind !== 'ambiguous') return null;
	const anchorDateKey = record.anchorDateKey === undefined
		? undefined
		: typeof record.anchorDateKey === 'string' ? record.anchorDateKey.trim() : null;
	const source = record.source === undefined
		? undefined
		: record.source === 'operon' || record.source === 'core-daily-notes' ? record.source : null;
	if (anchorDateKey === null || source === null) return null;
	if (kind === 'ambiguous') {
		if (anchorDateKey !== undefined || source !== undefined) return null;
		return { operonId, kind, lastKnownPath };
	}
	if (!anchorDateKey || !isStrictIsoDateKey(anchorDateKey)) return null;
	return {
		operonId,
		kind,
		lastKnownPath,
		anchorDateKey,
		...(source ? { source } : {}),
	};
}

/** Keeps this internal store independent of Moment/Obsidian so Runtime Node tests can load it safely. */
function isStrictIsoDateKey(value: string | undefined): boolean {
	const match = value?.match(ISO_DATE_KEY_RE);
	if (!match) return false;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	if (year < 1 || month < 1 || month > 12 || day < 1) return false;
	const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
	return day <= daysInMonth;
}

function isLeapYear(year: number): boolean {
	return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function entriesToMap(entries: readonly PeriodicNoteContainerRegistryEntryV1[]): Map<string, PeriodicNoteContainerRegistryEntryV1> {
	return new Map(entries.map(entry => [entry.operonId, cloneEntry(entry)]));
}

function cloneEntriesMap(
	entries: ReadonlyMap<string, PeriodicNoteContainerRegistryEntryV1>,
): Map<string, PeriodicNoteContainerRegistryEntryV1> {
	return new Map([...entries.entries()].map(([operonId, entry]) => [operonId, cloneEntry(entry)]));
}

function cloneEntry(entry: PeriodicNoteContainerRegistryEntryV1): PeriodicNoteContainerRegistryEntryV1 {
	return {
		operonId: entry.operonId,
		kind: entry.kind,
		lastKnownPath: entry.lastKnownPath,
		...(entry.anchorDateKey ? { anchorDateKey: entry.anchorDateKey } : {}),
		...(entry.source ? { source: entry.source } : {}),
	};
}

function compareEntries(left: PeriodicNoteContainerRegistryEntryV1, right: PeriodicNoteContainerRegistryEntryV1): number {
	return left.operonId.localeCompare(right.operonId);
}

function sameEntry(left: PeriodicNoteContainerRegistryEntryV1, right: PeriodicNoteContainerRegistryEntryV1): boolean {
	return sameIdentity(left, right)
		&& left.source === right.source;
}

function sameIdentity(left: PeriodicNoteContainerRegistryEntryV1, right: PeriodicNoteContainerRegistryEntryV1): boolean {
	return left.operonId === right.operonId
		&& left.kind === right.kind
		&& left.lastKnownPath === right.lastKnownPath
		&& left.anchorDateKey === right.anchorDateKey;
}

function sameDiskState(left: RegistryDiskState, right: RegistryDiskState): boolean {
	if (left.kind !== right.kind) return false;
	if (left.kind === 'missing') return true;
	return right.kind === 'present' && left.raw === right.raw;
}

function hasExactKeys(record: Record<string, unknown>, expected: ReadonlySet<string>): boolean {
	return hasAllowedKeys(record, expected) && Object.keys(record).length === expected.size;
}

function hasAllowedKeys(record: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
	return Object.keys(record).every(key => allowed.has(key));
}

function errorMessage(error: unknown, fallback: string): string {
	return error instanceof Error && error.message.trim() ? error.message : fallback;
}
