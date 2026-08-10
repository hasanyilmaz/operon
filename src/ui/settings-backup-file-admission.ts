export const SETTINGS_BACKUP_JSON_MAX_BYTES = 10 * 1024 * 1024;
export const SETTINGS_BACKUP_ZIP_MAX_BYTES = 50 * 1024 * 1024;

export type SettingsBackupFileKind = 'json' | 'zip';

export function detectSettingsBackupFileKind(head: Uint8Array): SettingsBackupFileKind | null {
	if (head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && (
		(head[2] === 0x03 && head[3] === 0x04)
		|| (head[2] === 0x05 && head[3] === 0x06)
		|| (head[2] === 0x07 && head[3] === 0x08)
	)) return 'zip';
	const text = new TextDecoder('utf-8', { fatal: false }).decode(head).replace(/^\uFEFF/u, '').trimStart();
	return text.startsWith('{') ? 'json' : null;
}

export function isSettingsBackupFileSizeAllowed(kind: SettingsBackupFileKind, size: number): boolean {
	if (!Number.isSafeInteger(size) || size < 0) return false;
	return size <= (kind === 'zip' ? SETTINGS_BACKUP_ZIP_MAX_BYTES : SETTINGS_BACKUP_JSON_MAX_BYTES);
}
