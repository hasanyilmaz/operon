import type { App, DataAdapter } from 'obsidian';
import {
	buildReminderSourceLogicalKeyFromSource,
	type ReminderOccurrence,
	type ReminderOccurrenceSource,
} from '../core/reminder-scheduler-model';
import { buildOperonStoragePaths, joinVaultPath } from './operon-storage-paths';
import { preserveInvalidJsonFile, writeJsonSafely } from './storage-file-ops';
import { WriteQueue } from './write-queue';

const REMINDER_DELIVERY_STORE_VERSION = 3;
const REMINDER_DEVICE_ID_STORAGE_KEY = 'operon.reminders.device-id.v1';
const SAFE_DEVICE_ID_RE = /^[a-zA-Z0-9_-]{8,128}$/u;

export type ReminderOccurrenceState = 'pending' | 'delivered' | 'expired' | 'suppressed';
export type ReminderExpirationReason = 'authority-lost' | 'out-of-window' | 'legacy';

export interface ReminderDeliveryRecord extends ReminderOccurrence {
	state: ReminderOccurrenceState;
	expirationReason?: ReminderExpirationReason;
	updatedAt: string;
}

export interface ReminderTaskLifecycle {
	operonId: string;
	state: 'terminal' | 'open';
	terminalObservedAtMs: number;
	reopenCutoffMs?: number;
	updatedAt: string;
}

interface ReminderDeliveryStoreDataV3 {
	version: 3;
	deviceId: string;
	itemsByKey: Record<string, ReminderDeliveryRecord>;
	taskLifecycleByOperonId: Record<string, ReminderTaskLifecycle>;
}

interface LegacyReminderDeliveryRecord {
	key: string;
	logicalKey?: string;
	operonId: string;
	epochMs: number;
	localDatetime: string;
	sources: ReminderOccurrenceSource[];
	state: 'pending' | 'delivered' | 'expired';
	updatedAt: string;
}

export interface ReminderDeliveryMutation {
	pending?: readonly ReminderOccurrence[];
	suppressed?: readonly ReminderOccurrence[];
	expire?: Iterable<{ key: string; reason: ReminderExpirationReason }>;
	deliveredKeys?: Iterable<string>;
	lifecycleUpserts?: readonly Omit<ReminderTaskLifecycle, 'updatedAt'>[];
	deleteLifecycleOperonIds?: Iterable<string>;
	pruneBeforeMs?: number;
	updatedAtMs: number;
}

class UnsupportedReminderLedgerVersionError extends Error {}

function createDeviceId(): string {
	const randomUuid = window.crypto?.randomUUID?.();
	if (randomUuid) return randomUuid;
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

export function getOrCreateReminderDeviceId(storage: Storage | null | undefined): string {
	try {
		const existing = storage?.getItem(REMINDER_DEVICE_ID_STORAGE_KEY) ?? '';
		if (SAFE_DEVICE_ID_RE.test(existing)) return existing;
		const created = createDeviceId();
		storage?.setItem(REMINDER_DEVICE_ID_STORAGE_KEY, created);
		return created;
	} catch {
		return createDeviceId();
	}
}

function isObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isOccurrenceSource(value: unknown): value is ReminderOccurrenceSource {
	if (!isObject(value)) return false;
	return (value.fieldKey === 'reminderDatetimes' || value.fieldKey === 'reminderRules')
		&& Number.isSafeInteger(value.index)
		&& Number(value.index) >= 0
		&& typeof value.rawValue === 'string';
}

function normalizeLocalDatetime(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/u.exec(value);
	if (!match) return null;
	const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
	const year = Number(yearText);
	const month = Number(monthText);
	const day = Number(dayText);
	const hour = Number(hourText);
	const minute = Number(minuteText);
	const second = Number(secondText);
	const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
	const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
	if (month < 1 || month > 12 || day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59) return null;
	return value;
}

function normalizeLegacyRecord(key: string, value: unknown): LegacyReminderDeliveryRecord | null {
	if (!isObject(value)) return null;
	const localDatetime = normalizeLocalDatetime(value.localDatetime);
	if (typeof value.operonId !== 'string' || !value.operonId
		|| typeof value.epochMs !== 'number' || !Number.isFinite(value.epochMs)
		|| typeof value.key !== 'string' || value.key !== key || value.key !== `${value.operonId}@${value.epochMs}`
		|| !localDatetime || !Array.isArray(value.sources) || value.sources.length === 0 || !value.sources.every(isOccurrenceSource)
		|| (value.state !== 'pending' && value.state !== 'delivered' && value.state !== 'expired')
		|| typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) return null;
	return {
		key,
		logicalKey: typeof value.logicalKey === 'string' ? value.logicalKey : undefined,
		operonId: value.operonId,
		epochMs: value.epochMs,
		localDatetime,
		sources: value.sources.map(source => ({ ...source })),
		state: value.state,
		updatedAt: value.updatedAt,
	};
}

function sourceKeysForLegacy(record: LegacyReminderDeliveryRecord): string[] {
	return [...new Set(record.sources.map(source => (
		buildReminderSourceLogicalKeyFromSource(record.operonId, record.localDatetime, source)
	)))];
}

function migrateLegacyRecords(value: Record<string, unknown>, version: 1 | 2): Map<string, ReminderDeliveryRecord> | null {
	const container = version === 1 ? value.itemsByKey : value.itemsByLogicalKey;
	if (!isObject(container)) return null;
	const records = new Map<string, ReminderDeliveryRecord>();
	for (const [containerKey, rawRecord] of Object.entries(container)) {
		if (!isObject(rawRecord) || typeof rawRecord.key !== 'string') return null;
		const record = normalizeLegacyRecord(rawRecord.key, rawRecord);
		if (!record || (version === 2 && record.logicalKey !== containerKey)) return null;
		const migrated: ReminderDeliveryRecord = {
			key: record.key,
			sourceLogicalKeys: sourceKeysForLegacy(record),
			operonId: record.operonId,
			epochMs: record.epochMs,
			localDatetime: record.localDatetime,
			sources: record.sources,
			state: record.state,
			...(record.state === 'expired' ? { expirationReason: 'legacy' as const } : {}),
			updatedAt: record.updatedAt,
		};
		const existing = records.get(migrated.key);
		if (!existing || Date.parse(existing.updatedAt) <= Date.parse(migrated.updatedAt)) {
			records.set(migrated.key, migrated);
		}
	}
	return records;
}

function normalizeV3Record(key: string, value: unknown): ReminderDeliveryRecord | null {
	if (!isObject(value)) return null;
	const localDatetime = normalizeLocalDatetime(value.localDatetime);
	const rawSourceLogicalKeys: unknown[] = Array.isArray(value.sourceLogicalKeys)
		? value.sourceLogicalKeys as unknown[]
		: [];
	if (value.key !== key || typeof value.operonId !== 'string' || !value.operonId
		|| typeof value.epochMs !== 'number' || !Number.isFinite(value.epochMs)
		|| key !== `${value.operonId}@${value.epochMs}` || !localDatetime
		|| !Array.isArray(value.sources) || value.sources.length === 0 || !value.sources.every(isOccurrenceSource)
		|| rawSourceLogicalKeys.length === 0 || !rawSourceLogicalKeys.every(item => typeof item === 'string' && item.length > 0)
		|| (value.state !== 'pending' && value.state !== 'delivered' && value.state !== 'expired' && value.state !== 'suppressed')
		|| typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) return null;
	const expirationReason = value.expirationReason;
	if (value.state === 'expired'
		&& expirationReason !== 'authority-lost'
		&& expirationReason !== 'out-of-window'
		&& expirationReason !== 'legacy') return null;
	const normalizedExpirationReason: ReminderExpirationReason | undefined = value.state === 'expired'
		? expirationReason as ReminderExpirationReason
		: undefined;
	return {
		key,
		sourceLogicalKeys: [...new Set(rawSourceLogicalKeys.map(item => String(item)))],
		operonId: value.operonId,
		epochMs: value.epochMs,
		localDatetime,
		sources: value.sources.map(source => ({ ...source })),
		state: value.state,
		...(normalizedExpirationReason ? { expirationReason: normalizedExpirationReason } : {}),
		updatedAt: value.updatedAt,
	};
}

function normalizeLifecycle(operonId: string, value: unknown): ReminderTaskLifecycle | null {
	if (!isObject(value) || value.operonId !== operonId
		|| (value.state !== 'terminal' && value.state !== 'open')
		|| typeof value.terminalObservedAtMs !== 'number' || !Number.isFinite(value.terminalObservedAtMs)
		|| typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) return null;
	if (value.reopenCutoffMs !== undefined
		&& (typeof value.reopenCutoffMs !== 'number' || !Number.isFinite(value.reopenCutoffMs))) return null;
	return {
		operonId,
		state: value.state,
		terminalObservedAtMs: value.terminalObservedAtMs,
		...(typeof value.reopenCutoffMs === 'number' ? { reopenCutoffMs: value.reopenCutoffMs } : {}),
		updatedAt: value.updatedAt,
	};
}

function parseV3Ledger(value: unknown, deviceId: string): {
	records: Map<string, ReminderDeliveryRecord>;
	lifecycles: Map<string, ReminderTaskLifecycle>;
} | null {
	if (!isObject(value) || value.version !== 3 || value.deviceId !== deviceId
		|| !isObject(value.itemsByKey) || !isObject(value.taskLifecycleByOperonId)) return null;
	const records = new Map<string, ReminderDeliveryRecord>();
	for (const [key, raw] of Object.entries(value.itemsByKey)) {
		const record = normalizeV3Record(key, raw);
		if (!record) return null;
		records.set(key, record);
	}
	const lifecycles = new Map<string, ReminderTaskLifecycle>();
	for (const [operonId, raw] of Object.entries(value.taskLifecycleByOperonId)) {
		const lifecycle = normalizeLifecycle(operonId, raw);
		if (!lifecycle) return null;
		lifecycles.set(operonId, lifecycle);
	}
	return { records, lifecycles };
}

async function ensureFolder(adapter: DataAdapter, path: string): Promise<void> {
	if (await adapter.exists(path)) return;
	await adapter.mkdir(path);
}

export class ReminderDeliveryStore {
	private readonly adapter: DataAdapter;
	private readonly folderPath: string;
	private readonly filePath: string;
	private readonly writeQueue = new WriteQueue();
	private readonly records = new Map<string, ReminderDeliveryRecord>();
	private readonly lifecycles = new Map<string, ReminderTaskLifecycle>();
	private serialized = '';
	private loaded = false;
	private persistenceSuspended = false;

	constructor(app: App, readonly deviceId: string) {
		this.adapter = app.vault.adapter;
		this.folderPath = buildOperonStoragePaths(app.vault.configDir).state.reminderDeliveriesRootPath;
		this.filePath = joinVaultPath(this.folderPath, `${deviceId}.json`);
	}

	async load(): Promise<void> {
		if (this.loaded) return;
		await ensureFolder(this.adapter, this.folderPath);
		if (!(await this.adapter.exists(this.filePath))) { this.loaded = true; return; }
		let raw: string;
		try { raw = await this.adapter.read(this.filePath); } catch (error) {
			console.warn('Operon: Reminder delivery ledger could not be read; persistence is suspended for this session', error);
			this.persistenceSuspended = true;
			this.loaded = true;
			throw error;
		}
		let parsed: unknown;
		try { parsed = JSON.parse(raw) as unknown; } catch {
			await this.preserveAndResetInvalidLedger(raw);
			this.loaded = true;
			return;
		}
		if (isObject(parsed) && typeof parsed.version === 'number' && parsed.version > REMINDER_DELIVERY_STORE_VERSION) {
			this.persistenceSuspended = true;
			this.loaded = true;
			throw new UnsupportedReminderLedgerVersionError(`Unsupported reminder ledger version: ${parsed.version}`);
		}
		if (!isObject(parsed) || (parsed.version !== 1 && parsed.version !== 2 && parsed.version !== 3)
			|| parsed.deviceId !== this.deviceId) {
			await this.preserveAndResetInvalidLedger(raw);
			this.loaded = true;
			return;
		}
		const isLegacy = parsed.version !== 3;
		const next = isLegacy
			? { records: migrateLegacyRecords(parsed, parsed.version as 1 | 2), lifecycles: new Map<string, ReminderTaskLifecycle>() }
			: parseV3Ledger(parsed, this.deviceId);
		if (!next || !next.records) {
			await this.preserveAndResetInvalidLedger(raw);
			this.loaded = true;
			return;
		}
		this.records.clear();
		for (const [key, record] of next.records) this.records.set(key, record);
		this.lifecycles.clear();
		for (const [key, lifecycle] of next.lifecycles) this.lifecycles.set(key, lifecycle);
		const nextSerialized = this.serialize();
		if (isLegacy) {
			try {
				await this.writeQueue.enqueue(`${this.filePath}::__store__`, async () => {
					await writeJsonSafely(this.adapter, this.filePath, JSON.parse(nextSerialized));
				});
			} catch (error) {
				console.warn('Operon: Reminder delivery ledger migration failed', error);
				this.persistenceSuspended = true;
				throw error;
			}
		}
		this.serialized = nextSerialized;
		this.loaded = true;
	}

	get(key: string): ReminderDeliveryRecord | null {
		const record = this.records.get(key);
		return record ? this.cloneRecord(record) : null;
	}

	getPending(): ReminderDeliveryRecord[] {
		return [...this.records.values()].filter(record => record.state === 'pending').map(record => this.cloneRecord(record));
	}

	getLifecycle(operonId: string): ReminderTaskLifecycle | null {
		const lifecycle = this.lifecycles.get(operonId);
		return lifecycle ? { ...lifecycle } : null;
	}

	getLifecycleOperonIds(): string[] { return [...this.lifecycles.keys()]; }

	hasFinalizedSource(sourceLogicalKeys: readonly string[]): boolean {
		const sought = new Set(sourceLogicalKeys);
		return [...this.records.values()].some(record => (
			(record.state === 'delivered' || record.state === 'suppressed')
			&& record.sourceLogicalKeys.some(key => sought.has(key))
		));
	}

	async mutate(mutation: ReminderDeliveryMutation): Promise<void> {
		const updatedAt = new Date(mutation.updatedAtMs).toISOString();
		for (const occurrence of mutation.pending ?? []) this.putPending(occurrence, updatedAt);
		for (const occurrence of mutation.suppressed ?? []) {
			if (this.hasFinalizedSource(occurrence.sourceLogicalKeys)) continue;
			this.records.set(occurrence.key, {
				...occurrence,
				sourceLogicalKeys: [...occurrence.sourceLogicalKeys],
				sources: occurrence.sources.map(source => ({ ...source })),
				state: 'suppressed',
				updatedAt,
			});
		}
		for (const { key, reason } of mutation.expire ?? []) {
			const existing = this.records.get(key);
			if (!existing || existing.state !== 'pending') continue;
			this.records.set(key, { ...existing, state: 'expired', expirationReason: reason, updatedAt });
		}
		for (const key of mutation.deliveredKeys ?? []) {
			const existing = this.records.get(key);
			if (!existing || existing.state !== 'pending') continue;
			const { expirationReason: _unused, ...record } = existing;
			this.records.set(key, { ...record, state: 'delivered', updatedAt });
		}
		for (const lifecycle of mutation.lifecycleUpserts ?? []) {
			this.lifecycles.set(lifecycle.operonId, { ...lifecycle, updatedAt });
		}
		for (const operonId of mutation.deleteLifecycleOperonIds ?? []) this.lifecycles.delete(operonId);
		if (typeof mutation.pruneBeforeMs === 'number') {
			for (const [key, record] of this.records) {
				if (record.state !== 'pending' && Date.parse(record.updatedAt) < mutation.pruneBeforeMs) this.records.delete(key);
			}
		}
		await this.persistIfChanged();
	}

	async drain(): Promise<void> { await this.writeQueue.drain(); }

	private putPending(occurrence: ReminderOccurrence, updatedAt: string): void {
		if (this.hasFinalizedSource(occurrence.sourceLogicalKeys)) return;
		const sourceSet = new Set(occurrence.sourceLogicalKeys);
		let inheritedUpdatedAt = updatedAt;
		for (const [key, record] of this.records) {
			if (record.state !== 'pending' || !record.sourceLogicalKeys.some(item => sourceSet.has(item))) continue;
			inheritedUpdatedAt = record.updatedAt;
			if (key !== occurrence.key) this.records.delete(key);
		}
		const existing = this.records.get(occurrence.key);
		if (existing?.state === 'pending') inheritedUpdatedAt = existing.updatedAt;
		this.records.set(occurrence.key, {
			...occurrence,
			sourceLogicalKeys: [...occurrence.sourceLogicalKeys],
			sources: occurrence.sources.map(source => ({ ...source })),
			state: 'pending',
			updatedAt: inheritedUpdatedAt,
		});
	}

	private cloneRecord(record: ReminderDeliveryRecord): ReminderDeliveryRecord {
		return { ...record, sourceLogicalKeys: [...record.sourceLogicalKeys], sources: record.sources.map(source => ({ ...source })) };
	}

	private async preserveAndResetInvalidLedger(raw: string): Promise<void> {
		console.warn('Operon: Invalid reminder delivery ledger was preserved and reset');
		try { await preserveInvalidJsonFile(this.adapter, this.filePath, raw); } catch (backupError) {
			console.warn('Operon: Reminder delivery ledger backup failed', backupError);
			this.persistenceSuspended = true;
			throw backupError;
		}
		this.records.clear();
		this.lifecycles.clear();
		this.serialized = '';
	}

	private serialize(): string {
		const data: ReminderDeliveryStoreDataV3 = {
			version: REMINDER_DELIVERY_STORE_VERSION,
			deviceId: this.deviceId,
			itemsByKey: Object.fromEntries([...this.records.entries()].sort(([left], [right]) => left.localeCompare(right))),
			taskLifecycleByOperonId: Object.fromEntries([...this.lifecycles.entries()].sort(([left], [right]) => left.localeCompare(right))),
		};
		return JSON.stringify(data, null, '\t');
	}

	private async persistIfChanged(): Promise<void> {
		if (this.persistenceSuspended) return;
		const nextSerialized = this.serialize();
		if (nextSerialized === this.serialized && await this.adapter.exists(this.filePath)) return;
		await this.writeQueue.enqueue(`${this.filePath}::__store__`, async () => {
			await writeJsonSafely(this.adapter, this.filePath, JSON.parse(nextSerialized));
		});
		this.serialized = nextSerialized;
	}
}
