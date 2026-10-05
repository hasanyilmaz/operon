import { Notice } from 'obsidian';

const notifiedErrors = new WeakSet<object>();

/** Keep the detailed file failure when the same rejection reaches the preset modal. */
export function notifyTablePresetErrorOnce(error: unknown, message: string): void {
	if (typeof error === 'object' && error !== null) {
		if (notifiedErrors.has(error)) return;
		new Notice(message);
		notifiedErrors.add(error);
		return;
	}
	new Notice(message);
}
