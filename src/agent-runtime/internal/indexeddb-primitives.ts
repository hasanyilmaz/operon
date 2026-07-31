export type IndexedDbErrorMapperV1 = (error: unknown) => Error;

function mapError(error: unknown, mapper?: IndexedDbErrorMapperV1): Error {
	if (mapper) return mapper(error);
	return error instanceof Error ? error : new Error(String(error));
}

export function indexedDbRequestResultV1<T>(
	request: IDBRequest<T>,
	mapper?: IndexedDbErrorMapperV1,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(mapper
			? mapper(request.error)
			: mapError(request.error ?? new Error('IndexedDB request failed.')));
	});
}

export function indexedDbTransactionCompletionV1(
	transaction: IDBTransaction,
	mapper?: IndexedDbErrorMapperV1,
): Promise<void> {
	const completion = new Promise<void>((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onabort = () => reject(mapper
			? mapper(transaction.error)
			: mapError(transaction.error ?? new Error('IndexedDB transaction aborted.')));
		transaction.onerror = () => reject(mapper
			? mapper(transaction.error)
			: mapError(transaction.error ?? new Error('IndexedDB transaction failed.')));
	});
	void completion.catch(() => undefined);
	return completion;
}

export function safeAbortIndexedDbTransactionV1(transaction: IDBTransaction): void {
	try {
		transaction.abort();
	} catch {
		// The transaction may already be inactive.
	}
}

export function normalizeIndexedDbTimeoutV1(
	value: number | undefined,
	defaultValue: number,
): number {
	if (!Number.isFinite(value)) return defaultValue;
	return Math.max(100, Math.min(30_000, Math.floor(value as number)));
}

export async function withIndexedDbOperationTimeoutV1<T>(input: {
	readonly promise: Promise<T>;
	readonly timeoutMs: number;
	readonly transaction?: IDBTransaction;
	readonly onTimeout?: () => void;
	readonly timeoutError: () => Error;
}): Promise<T> {
	let timer: number | null = null;
	const timeout = new Promise<never>((_resolve, reject) => {
		timer = window.setTimeout(() => {
			input.onTimeout?.();
			if (input.transaction) safeAbortIndexedDbTransactionV1(input.transaction);
			reject(input.timeoutError());
		}, input.timeoutMs);
	});
	try {
		return await Promise.race([input.promise, timeout]);
	} finally {
		if (timer !== null) window.clearTimeout(timer);
	}
}
