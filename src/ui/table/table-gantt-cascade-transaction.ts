export interface TableGanttCascadeFilePlan {
	filePath: string;
	expectedContent: string;
	nextContent: string;
}

export interface TableGanttCascadeRecurrencePlan<TTransaction> {
	seriesId: string;
	begin: () => Promise<TTransaction | null>;
	rollback: (transaction: TTransaction) => Promise<boolean>;
}

export type TableGanttCascadeWriteResult = 'committed' | 'conflict' | 'missing' | 'invalid-target' | 'failed';
export type TableGanttCascadeTransactionOutcome =
	| 'committed'
	| 'rolled-back'
	| 'recovery-required';

const CASCADE_TEMPORAL_KEYS = new Set([
	'dateStarted',
	'dateScheduled',
	'dateDue',
	'datetimeStart',
	'datetimeEnd',
	'estimate',
]);

export function normalizeTableGanttCascadeTemporalPayload(
	currentFields: Readonly<Record<string, string>>,
	payload: Readonly<Record<string, string>>,
	modifiedTimestamp: string,
): Record<string, string> | null {
	if (Object.keys(payload).some(key => !CASCADE_TEMPORAL_KEYS.has(key))) return null;
	if (
		Object.prototype.hasOwnProperty.call(payload, 'estimate')
		&& payload['estimate'] !== (currentFields['estimate'] ?? '')
	) return null;
	return {
		...payload,
		datetimeModified: modifiedTimestamp,
	};
}

export interface ExecuteTableGanttCascadeTransactionOptions<TPermit, TTransaction> {
	files: readonly TableGanttCascadeFilePlan[];
	recurrences: readonly TableGanttCascadeRecurrencePlan<TTransaction>[];
	runExclusive: <T>(operation: (permit: TPermit) => Promise<T>) => Promise<T>;
	applyFile: (plan: TableGanttCascadeFilePlan, permit: TPermit) => Promise<TableGanttCascadeWriteResult>;
	rollbackFile: (plan: TableGanttCascadeFilePlan, permit: TPermit) => Promise<boolean>;
}

export async function executeTableGanttCascadeTransaction<TPermit, TTransaction>(
	options: ExecuteTableGanttCascadeTransactionOptions<TPermit, TTransaction>,
): Promise<TableGanttCascadeTransactionOutcome> {
	const files = [...options.files].sort((left, right) => left.filePath.localeCompare(right.filePath));
	const recurrences = [...options.recurrences].sort((left, right) => left.seriesId.localeCompare(right.seriesId));
	return options.runExclusive(async permit => {
		const begunRecurrences: Array<{
			plan: TableGanttCascadeRecurrencePlan<TTransaction>;
			transaction: TTransaction;
		}> = [];
		const committedFiles: TableGanttCascadeFilePlan[] = [];

		const rollback = async (): Promise<TableGanttCascadeTransactionOutcome> => {
			let complete = true;
			for (const file of [...committedFiles].reverse()) {
				try {
					if (!await options.rollbackFile(file, permit)) complete = false;
				} catch {
					complete = false;
				}
			}
			for (const entry of [...begunRecurrences].reverse()) {
				try {
					if (!await entry.plan.rollback(entry.transaction)) complete = false;
				} catch {
					complete = false;
				}
			}
			return complete ? 'rolled-back' : 'recovery-required';
		};

		for (const plan of recurrences) {
			let transaction: TTransaction | null;
			try {
				transaction = await plan.begin();
			} catch {
				return rollback();
			}
			if (!transaction) return rollback();
			begunRecurrences.push({ plan, transaction });
		}
		for (const file of files) {
			if (file.expectedContent === file.nextContent) continue;
			let result: TableGanttCascadeWriteResult;
			try {
				result = await options.applyFile(file, permit);
			} catch {
				return rollback();
			}
			if (result !== 'committed') return rollback();
			committedFiles.push(file);
		}
		return 'committed';
	});
}
