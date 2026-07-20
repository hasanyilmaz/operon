export const REMINDER_SOUND_PACK_SCHEMA_VERSION = 1;
export const MAX_REMINDER_SOUND_FILE_BYTES = 500_000;
export const MAX_REMINDER_SOUND_PACK_BYTES = 2_000_000;

export interface ReminderSoundPackFile {
	id: string;
	assetName: string;
	fileName: string;
	url: string;
	sha256: string;
	sizeBytes: number;
}

export interface ReminderSoundPackCatalog {
	schemaVersion: number;
	files: ReminderSoundPackFile[];
}

export class ReminderSoundPackError extends Error {
	constructor(
		message: string,
		public readonly kind: 'invalid' | 'integrity' | 'network' | 'storage' | 'conflict' = 'invalid',
	) {
		super(message);
		this.name = 'ReminderSoundPackError';
	}
}

export function validateReminderSoundPackCatalog(value: unknown): ReminderSoundPackCatalog {
	if (!isPlainRecord(value)) throw new ReminderSoundPackError('Reminder sound catalog root must be an object.');
	if (value.schemaVersion !== REMINDER_SOUND_PACK_SCHEMA_VERSION) {
		throw new ReminderSoundPackError('Unsupported reminder sound catalog schema.');
	}
	if (!Array.isArray(value.files) || value.files.length !== 4) {
		throw new ReminderSoundPackError('Reminder sound catalog must contain exactly four files.');
	}

	const ids = new Set<string>();
	const names = new Set<string>();
	let totalBytes = 0;
	for (const entry of value.files) {
		if (!isPlainRecord(entry)
			|| typeof entry.id !== 'string' || !/^[a-z0-9-]+$/u.test(entry.id) || ids.has(entry.id)
			|| typeof entry.assetName !== 'string' || !/^operon-reminder-[1-4]\.mp3$/u.test(entry.assetName)
			|| typeof entry.fileName !== 'string' || !/^Operon Reminder [1-4]\.mp3$/u.test(entry.fileName) || names.has(entry.fileName)
			|| typeof entry.url !== 'string' || !isRepositoryAssetUrl(entry.url, entry.assetName)
			|| typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(entry.sha256)
			|| !Number.isSafeInteger(entry.sizeBytes) || Number(entry.sizeBytes) <= 0 || Number(entry.sizeBytes) > MAX_REMINDER_SOUND_FILE_BYTES) {
			throw new ReminderSoundPackError('Reminder sound catalog contains an invalid file entry.');
		}
		ids.add(entry.id);
		names.add(entry.fileName);
		totalBytes += Number(entry.sizeBytes);
	}
	if (totalBytes > MAX_REMINDER_SOUND_PACK_BYTES) {
		throw new ReminderSoundPackError('Reminder sound catalog exceeds the maximum package size.');
	}

	return value as unknown as ReminderSoundPackCatalog;
}

export async function sha256ReminderSoundBytes(value: ArrayBuffer): Promise<string> {
	const subtle = (typeof window === 'undefined' ? crypto : window.crypto)?.subtle;
	if (!subtle) throw new ReminderSoundPackError('SHA-256 is unavailable in this runtime', 'storage');
	const digest = await subtle.digest('SHA-256', value);
	return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isRepositoryAssetUrl(value: string, assetName: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === 'https:'
			&& url.hostname === 'raw.githubusercontent.com'
			&& url.pathname === `/hasanyilmaz/operon/main/release-assets/reminder-sounds/${assetName}`;
	} catch {
		return false;
	}
}
