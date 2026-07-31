export const AGENT_RUNTIME_DATABASE_VERSION_V1 = 4;
export const AGENT_RUNTIME_DEFAULT_DATABASE_NAME_V1 =
	'operon-agent-runtime-receipts-v1';
export const RECEIPT_OBJECT_STORE_NAME_V1 = 'receipts';
export const JOURNAL_OBJECT_STORE_NAME_V1 = 'graph-transaction-journals';
export const RECEIPT_METADATA_OBJECT_STORE_NAME_V1 = 'receipt-metadata';
export const SECURITY_AUDIT_OBJECT_STORE_NAME_V1 = 'security-audit-events';
export const RECEIPT_GENERATION_KEY_V1 = 'receipt-generation';
const AGENT_RUNTIME_OBJECT_STORE_NAMES_V1 = [
	RECEIPT_OBJECT_STORE_NAME_V1,
	JOURNAL_OBJECT_STORE_NAME_V1,
	RECEIPT_METADATA_OBJECT_STORE_NAME_V1,
	SECURITY_AUDIT_OBJECT_STORE_NAME_V1,
] as const;
const VERIFIED_AGENT_RUNTIME_DATABASES_V1 = new WeakSet<IDBDatabase>();

export function ensureAgentRuntimeObjectStoresV1(database: IDBDatabase): void {
	if (!database.objectStoreNames.contains(RECEIPT_OBJECT_STORE_NAME_V1)) {
		database.createObjectStore(RECEIPT_OBJECT_STORE_NAME_V1, { keyPath: 'key' });
	}
	if (!database.objectStoreNames.contains(JOURNAL_OBJECT_STORE_NAME_V1)) {
		database.createObjectStore(JOURNAL_OBJECT_STORE_NAME_V1, { keyPath: 'key' });
	}
	if (!database.objectStoreNames.contains(RECEIPT_METADATA_OBJECT_STORE_NAME_V1)) {
		const metadataStore = database.createObjectStore(
			RECEIPT_METADATA_OBJECT_STORE_NAME_V1,
			{ keyPath: 'key' },
		);
		const bytes = new Uint8Array(16);
		crypto.getRandomValues(bytes);
		metadataStore.put({
			key: RECEIPT_GENERATION_KEY_V1,
			databaseEpoch: Array.from(
				bytes,
				byte => byte.toString(16).padStart(2, '0'),
			).join(''),
			generation: 0,
		});
	}
	if (!database.objectStoreNames.contains(SECURITY_AUDIT_OBJECT_STORE_NAME_V1)) {
		database.createObjectStore(SECURITY_AUDIT_OBJECT_STORE_NAME_V1, { keyPath: 'key' });
	}
}

export function hasAgentRuntimeObjectStoresV1(database: IDBDatabase): boolean {
	if (
		database.version !== AGENT_RUNTIME_DATABASE_VERSION_V1
		|| AGENT_RUNTIME_OBJECT_STORE_NAMES_V1.some(
			name => !database.objectStoreNames.contains(name),
		)
	) return false;
	if (VERIFIED_AGENT_RUNTIME_DATABASES_V1.has(database)) return true;
	try {
		const transaction = database.transaction(
			[...AGENT_RUNTIME_OBJECT_STORE_NAMES_V1],
			'readonly',
		);
		const valid = AGENT_RUNTIME_OBJECT_STORE_NAMES_V1.every(
			name => transaction.objectStore(name).keyPath === 'key',
		);
		if (valid) VERIFIED_AGENT_RUNTIME_DATABASES_V1.add(database);
		return valid;
	} catch {
		return false;
	}
}
