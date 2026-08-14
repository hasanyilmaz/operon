export type InlineEditorSaveRetryOutcome = 'persisted' | 'failed';

export interface InlineEditorSaveRetryOptions {
	expectedContent: string;
	save: () => Promise<void>;
	readPersistedContent: () => Promise<string | null>;
	fallback?: {
		expectedPersistedContent: string;
		writeExpectedContent: () => Promise<void>;
	};
}

/**
 * Retry an editor save once after a committed transaction. A rejected save is
 * only accepted when the backing file already contains the exact new buffer,
 * or a guarded fallback writes it from the unchanged pre-transaction source.
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
		const persistedContent = await options.readPersistedContent().catch(() => null);
		if (persistedContent === options.expectedContent) return 'persisted';
		if (
			options.fallback
			&& persistedContent === options.fallback.expectedPersistedContent
		) {
			try {
				await options.fallback.writeExpectedContent();
				return 'persisted';
			} catch {
				const afterFallbackContent = await options.readPersistedContent().catch(() => null);
				if (afterFallbackContent === options.expectedContent) return 'persisted';
				return 'failed';
			}
		}
		return 'failed';
	}
}
