import { App } from 'obsidian';
import { normalizeTaskIconValue } from '../core/task-icon-value';
import { CANONICAL_KEYS } from '../types/keys';
import { KeyMapping } from '../types/settings';
import { WriteQueue } from './write-queue';
import { preserveInvalidJsonFile, shouldSkipStoreWrite, writeJsonSafely, type RecoveredStoreWriteOptions } from './storage-file-ops';
import type { OperonKeyMappingsPackageV1 } from './operon-data-package';

const KEY_MAPPINGS_FILE = '.operon/key-mappings.json';
const KEY_MAPPING_STORE_VERSION = 1;
const KEY_MAPPING_STORE_QUEUE_KEY = `${KEY_MAPPINGS_FILE}::__store__`;
const CANONICAL_KEY_ORDER = new Map(CANONICAL_KEYS.map((key, index) => [key.name, index]));

interface KeyMappingStoreData {
	version: number;
	system: KeyMapping[];
	custom: KeyMapping[];
}

function cloneKeyMapping(mapping: KeyMapping): KeyMapping {
	return {
		...mapping,
		icon: normalizeTaskIconValue(mapping.icon),
		hideInFileTaskView: mapping.hideInFileTaskView === true,
		isInternal: mapping.isInternal === true,
	};
}

function cloneKeyMappings(mappings: KeyMapping[]): KeyMapping[] {
	return mappings.map(cloneKeyMapping);
}

function coerceKeyMapping(raw: unknown): KeyMapping | null {
	if (!raw || typeof raw !== 'object') return null;
	const src = raw as Record<string, unknown>;
	const canonicalKey = typeof src.canonicalKey === 'string' ? src.canonicalKey.trim() : '';
	if (!canonicalKey) return null;
	const visiblePropertyName = typeof src.visiblePropertyName === 'string'
		? src.visiblePropertyName
		: canonicalKey;
	const type = src.type === 'number'
		|| src.type === 'date'
		|| src.type === 'datetime'
		|| src.type === 'list'
		? src.type
		: 'text';
	const sync = src.sync === 'yes' || src.sync === 'no' ? src.sync : 'auto';
	return {
		canonicalKey,
		visiblePropertyName,
		type,
		sync,
		enabled: true,
		hideInFileTaskView: src.hideInFileTaskView === true,
		icon: normalizeTaskIconValue(typeof src.icon === 'string' ? src.icon : ''),
		isSystem: src.isSystem !== false,
		isInternal: src.isInternal === true,
	};
}

function readSection(raw: unknown): KeyMapping[] {
	if (!Array.isArray(raw)) return [];
	const mappings: KeyMapping[] = [];
	for (const entry of raw) {
		const mapping = coerceKeyMapping(entry);
		if (mapping) mappings.push(mapping);
	}
	return mappings;
}

function splitKeyMappings(mappings: KeyMapping[]): { system: KeyMapping[]; custom: KeyMapping[] } {
	const system: KeyMapping[] = [];
	const custom: KeyMapping[] = [];
	for (const mapping of mappings) {
		const clone = cloneKeyMapping(mapping);
		if (clone.isSystem) {
			system.push(clone);
		} else {
			custom.push(clone);
		}
	}
	system.sort((left, right) => {
		const leftIndex = CANONICAL_KEY_ORDER.get(left.canonicalKey) ?? Number.MAX_SAFE_INTEGER;
		const rightIndex = CANONICAL_KEY_ORDER.get(right.canonicalKey) ?? Number.MAX_SAFE_INTEGER;
		if (leftIndex !== rightIndex) return leftIndex - rightIndex;
		return left.canonicalKey.localeCompare(right.canonicalKey);
	});
	return { system, custom };
}

export class KeyMappingStore {
	private app: App;
	private writeQueue: WriteQueue;
	private system: KeyMapping[] = [];
	private custom: KeyMapping[] = [];
	private serializedStore = '{"system":[],"custom":[]}';
	private recoveredFromMalformed = false;
	private packagePersist: ((keyMappings: KeyMapping[]) => Promise<void>) | null = null;

	constructor(app: App, writeQueue: WriteQueue) {
		this.app = app;
		this.writeQueue = writeQueue;
	}

	getAll(): KeyMapping[] {
		return [
			...cloneKeyMappings(this.system),
			...cloneKeyMappings(this.custom),
		];
	}

	setPackagePersistence(persist: (keyMappings: KeyMapping[]) => Promise<void>): void {
		this.packagePersist = persist;
	}

	loadFromPackage(keyMappings: OperonKeyMappingsPackageV1): void {
		this.system = readSection(keyMappings.system);
		this.custom = readSection(keyMappings.custom);
		this.serializedStore = JSON.stringify({
			system: this.system,
			custom: this.custom,
		});
		this.recoveredFromMalformed = false;
	}

	async load(legacyKeyMappings: KeyMapping[] | null = null, defaultSeed: KeyMapping[] = []): Promise<void> {
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(KEY_MAPPINGS_FILE))) {
			const seed = legacyKeyMappings && legacyKeyMappings.length > 0
				? cloneKeyMappings(legacyKeyMappings)
				: cloneKeyMappings(defaultSeed);
			const split = splitKeyMappings(seed);
			this.system = split.system;
			this.custom = split.custom;
			this.serializedStore = JSON.stringify({
				system: this.system,
				custom: this.custom,
			});
			this.recoveredFromMalformed = false;
			await this.persist();
			return;
		}

		let raw = '';
		try {
			raw = await adapter.read(KEY_MAPPINGS_FILE);
			const parsed = JSON.parse(raw) as Partial<KeyMappingStoreData>;
			this.system = readSection(parsed.system);
			this.custom = readSection(parsed.custom);
			this.serializedStore = JSON.stringify({
				system: this.system,
				custom: this.custom,
			});
			this.recoveredFromMalformed = false;
		} catch {
			console.warn('Operon: Failed to parse key mappings store, preserving invalid file as backup and recovering from runtime defaults');
			await preserveInvalidJsonFile(adapter, KEY_MAPPINGS_FILE, raw);
			const seed = legacyKeyMappings && legacyKeyMappings.length > 0
				? cloneKeyMappings(legacyKeyMappings)
				: cloneKeyMappings(defaultSeed);
			const split = splitKeyMappings(seed);
			this.system = split.system;
			this.custom = split.custom;
			this.serializedStore = JSON.stringify({
				system: this.system,
				custom: this.custom,
			});
			this.recoveredFromMalformed = true;
		}
	}

	async replaceAll(mappings: KeyMapping[], options: RecoveredStoreWriteOptions = {}): Promise<void> {
		const split = splitKeyMappings(mappings);
		const nextSerializedStore = JSON.stringify({
			system: split.system,
			custom: split.custom,
		});
		const adapter = this.app.vault.adapter;
		if (shouldSkipStoreWrite(
			nextSerializedStore === this.serializedStore,
			await adapter.exists(KEY_MAPPINGS_FILE),
			this.recoveredFromMalformed,
			options,
		)) {
			this.system = split.system;
			this.custom = split.custom;
			return;
		}
		this.system = split.system;
		this.custom = split.custom;
		this.serializedStore = nextSerializedStore;
		if (this.packagePersist) {
			await this.packagePersist(this.getAll());
			this.recoveredFromMalformed = false;
			return;
		}
		await this.persist();
	}

	private async persist(): Promise<void> {
		const adapter = this.app.vault.adapter;
		const data: KeyMappingStoreData = {
			version: KEY_MAPPING_STORE_VERSION,
			system: cloneKeyMappings(this.system),
			custom: cloneKeyMappings(this.custom),
		};
		await this.writeQueue.enqueue(KEY_MAPPING_STORE_QUEUE_KEY, async () => {
			await writeJsonSafely(adapter, KEY_MAPPINGS_FILE, data);
		});
		this.recoveredFromMalformed = false;
	}
}
