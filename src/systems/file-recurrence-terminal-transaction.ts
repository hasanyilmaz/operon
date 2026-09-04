import type { TaskSourceMutation, TaskSourceMutationResult } from '../core/task-writer';

export interface FileRecurrenceTerminalWrite {
	filePath: string;
	content: string;
}

export type FileRecurrenceTerminalTransactionResult =
	| {
		outcome: 'committed';
		firstWrite: TaskSourceMutationResult;
		sourceWrite: TaskSourceMutationResult;
	}
	| {
		outcome: 'failed';
		rollback: 'not-needed' | 'committed' | 'failed';
	};

export async function executeFileRecurrenceTerminalTransaction(input: {
	first: FileRecurrenceTerminalWrite;
	source: FileRecurrenceTerminalWrite & { expectedContent: string };
	write: (mutation: TaskSourceMutation) => Promise<TaskSourceMutationResult>;
	onRollback?: (filePath: string) => Promise<void>;
}): Promise<FileRecurrenceTerminalTransactionResult> {
	const firstWrite = await input.write({
		kind: 'create',
		filePath: input.first.filePath,
		nextContent: input.first.content,
	});
	if (firstWrite.outcome !== 'committed') {
		return { outcome: 'failed', rollback: 'not-needed' };
	}

	const sourceWrite = await input.write({
		kind: 'modify',
		filePath: input.source.filePath,
		expectedContent: input.source.expectedContent,
		nextContent: input.source.content,
	});
	if (sourceWrite.outcome === 'committed') {
		return { outcome: 'committed', firstWrite, sourceWrite };
	}

	const rollback = await input.write({
		kind: 'trash',
		filePath: input.first.filePath,
		expectedContent: input.first.content,
	});
	if (rollback.outcome !== 'committed') {
		return { outcome: 'failed', rollback: 'failed' };
	}
	await input.onRollback?.(input.first.filePath);
	return { outcome: 'failed', rollback: 'committed' };
}
