export interface TaskEditorDeleteCompanionPlan {
	readonly filePath: string;
	readonly expectedContent: string;
	readonly nextContent: string;
}

export type TaskEditorDeleteCompanionWriteResult =
	| 'committed'
	| 'conflict'
	| 'missing'
	| 'invalid-target'
	| 'failed';

export type TaskEditorDeleteTargetWriteResult =
	| 'committed'
	| 'clean-failure'
	| 'outcome-unknown';

export type TaskEditorDeleteTransactionResult =
	| {
		readonly outcome: 'committed';
		readonly committedCompanionPaths: readonly string[];
	}
	| {
		readonly outcome: 'rolled-back';
		readonly committedCompanionPaths: readonly string[];
	}
	| {
		readonly outcome: 'recovery-required';
		readonly committedCompanionPaths: readonly string[];
		readonly targetMayHaveCommitted: boolean;
	};

export interface ExecuteTaskEditorDeleteTransactionOptions<TPermit> {
	readonly targetFilePath: string;
	readonly companions: readonly TaskEditorDeleteCompanionPlan[];
	readonly runExclusive: <T>(operation: (permit: TPermit) => Promise<T>) => Promise<T>;
	readonly applyCompanion: (
		plan: TaskEditorDeleteCompanionPlan,
		permit: TPermit,
	) => Promise<TaskEditorDeleteCompanionWriteResult>;
	readonly rollbackCompanion: (
		plan: TaskEditorDeleteCompanionPlan,
		permit: TPermit,
	) => Promise<boolean>;
	readonly applyTarget: (permit: TPermit) => Promise<TaskEditorDeleteTargetWriteResult>;
}

function compareUtf16(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

export async function executeTaskEditorDeleteTransaction<TPermit>(
	options: ExecuteTaskEditorDeleteTransactionOptions<TPermit>,
): Promise<TaskEditorDeleteTransactionResult> {
	const targetFilePath = options.targetFilePath.trim();
	const companions = [...options.companions]
		.filter(plan => plan.expectedContent !== plan.nextContent)
		.sort((left, right) => compareUtf16(left.filePath, right.filePath));
	const companionPaths = companions.map(plan => plan.filePath);
	if (
		!targetFilePath
		|| companionPaths.some(filePath => !filePath.trim() || filePath === targetFilePath)
		|| new Set(companionPaths).size !== companionPaths.length
	) {
		return { outcome: 'rolled-back', committedCompanionPaths: [] };
	}

	return await options.runExclusive(async permit => {
		const committed: TaskEditorDeleteCompanionPlan[] = [];
		const rollback = async (): Promise<TaskEditorDeleteTransactionResult> => {
			const unresolvedPaths: string[] = [];
			for (const plan of [...committed].reverse()) {
				try {
					if (!await options.rollbackCompanion(plan, permit)) unresolvedPaths.push(plan.filePath);
				} catch {
					unresolvedPaths.push(plan.filePath);
				}
			}
			return unresolvedPaths.length === 0
				? { outcome: 'rolled-back', committedCompanionPaths: [] }
				: {
					outcome: 'recovery-required',
					committedCompanionPaths: unresolvedPaths.sort(compareUtf16),
					targetMayHaveCommitted: false,
				};
		};

		for (const plan of companions) {
			let result: TaskEditorDeleteCompanionWriteResult;
			try {
				result = await options.applyCompanion(plan, permit);
			} catch {
				return await rollback();
			}
			if (result !== 'committed') return await rollback();
			committed.push(plan);
		}

		let targetResult: TaskEditorDeleteTargetWriteResult;
		try {
			targetResult = await options.applyTarget(permit);
		} catch {
			targetResult = 'outcome-unknown';
		}
		if (targetResult === 'committed') {
			return {
				outcome: 'committed',
				committedCompanionPaths: committed.map(plan => plan.filePath),
			};
		}
		if (targetResult === 'clean-failure') return await rollback();
		return {
			outcome: 'recovery-required',
			committedCompanionPaths: committed.map(plan => plan.filePath),
			targetMayHaveCommitted: true,
		};
	});
}
