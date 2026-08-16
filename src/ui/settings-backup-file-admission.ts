export const SETTINGS_BACKUP_JSON_MAX_BYTES = 10 * 1024 * 1024;

export type SettingsBackupFileKind = 'json';
export type SettingsBackupFileAdmissionErrorCode =
	| 'unsupported-content'
	| 'json-size-limit'
	| 'provider-read-failed';

export class SettingsBackupFileAdmissionError extends Error {
	readonly code: SettingsBackupFileAdmissionErrorCode;

	constructor(code: SettingsBackupFileAdmissionErrorCode) {
		super(code);
		this.name = 'SettingsBackupFileAdmissionError';
		this.code = code;
	}
}

export interface SettingsBackupFilePickerSettlement<T> {
	settle(value: T | null): boolean;
}

export function createSettingsBackupFilePickerSettlement<T>(
	onSettled: (value: T | null) => void,
): SettingsBackupFilePickerSettlement<T> {
	let settled = false;
	const settle = (value: T | null): boolean => {
		if (settled) return false;
		settled = true;
		onSettled(value);
		return true;
	};
	return {
		settle,
	};
}

export interface SettingsBackupFilePickerRegistry<K extends object> {
	register(key: K, cancelPending: () => void): () => void;
}

export function createSettingsBackupFilePickerRegistry<K extends object>(): SettingsBackupFilePickerRegistry<K> {
	const pending = new WeakMap<K, () => void>();
	return {
		register(key, cancelPending) {
			pending.get(key)?.();
			pending.set(key, cancelPending);
			return () => {
				if (pending.get(key) === cancelPending) pending.delete(key);
			};
		},
	};
}

export function detectSettingsBackupFileKind(head: Uint8Array): SettingsBackupFileKind | null {
	const text = new TextDecoder('utf-8', { fatal: false }).decode(head).replace(/^\uFEFF/u, '').trimStart();
	return text.startsWith('{') ? 'json' : null;
}

export function isSettingsBackupFileSizeAllowed(kind: SettingsBackupFileKind, size: number): boolean {
	if (!Number.isSafeInteger(size) || size < 0) return false;
	return kind === 'json' && size <= SETTINGS_BACKUP_JSON_MAX_BYTES;
}
