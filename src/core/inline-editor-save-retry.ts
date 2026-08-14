export type InlineEditorSaveRetryOutcome = 'persisted' | 'failed';

export interface InlineEditorSaveRetryOptions {
	expectedContent: string;
	save: () => Promise<void>;
	readPersistedContent: () => Promise<string | null>;
	requestSave: () => void;
}

/**
 * Retry an editor save once after a committed transaction. A rejected save is
 * only accepted when the backing file already contains the exact new buffer.
 */
export async function retryInlineEditorSave(
	options: InlineEditorSaveRetryOptions,
): Promise<InlineEditorSaveRetryOutcome> {
	try {
		await options.save();
		return 'persisted';
	} catch {
		// Leave the transaction's dispatch before retrying the view save once.
		await Promise.resolve();
	}

	try {
		await options.save();
		return 'persisted';
	} catch {
		try {
			if (await options.readPersistedContent() === options.expectedContent) {
				return 'persisted';
			}
		} catch {
			// Request the normal Obsidian save path below even if inspection fails.
		}
		try {
			options.requestSave();
		} catch {
			// The caller remains fail-closed when the deferred request also fails.
		}
		return 'failed';
	}
}
