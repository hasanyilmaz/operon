export class TablePresetMutationQueue {
	private queue: Promise<void> = Promise.resolve();

	enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const run = this.queue.then(operation, operation);
		this.queue = run.then(() => undefined, () => undefined);
		return run;
	}
}
