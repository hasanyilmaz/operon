import type {
	GraphTransactionJournalPhaseV1,
	GraphTransactionJournalStepV1,
	GraphTransactionJournalV1,
	GraphTransactionResourceStateV1,
} from './receipts';

export interface RuntimeGraphTransactionCheckpointWriterV1 {
	(value: {
		phase: GraphTransactionJournalPhaseV1;
		completedStepCount: number;
	}): Promise<void>;
}

export interface RuntimeGraphTransactionStateInspectionV1<State> {
	readonly states: readonly State[];
	readonly completedPrefixLength: number;
	readonly untouchedSuffix: boolean;
}

export interface RuntimeGraphTransactionExecutorPortsV1<State> {
	readState(
		step: GraphTransactionJournalStepV1,
		index: number,
	): Promise<State>;
	statesMatch(
		actual: State,
		expected: GraphTransactionResourceStateV1,
	): boolean;
	/** Rebuilds domain projections for the exact committed prefix before recovery advances. */
	afterInspection?(
		inspection: RuntimeGraphTransactionStateInspectionV1<State>,
	): Promise<void>;
	applyForward(
		step: GraphTransactionJournalStepV1,
		index: number,
	): Promise<void>;
	applyCompensation(
		step: GraphTransactionJournalStepV1,
		index: number,
	): Promise<void>;
	checkpoint: RuntimeGraphTransactionCheckpointWriterV1;
	verifyState(expected: 'before' | 'after'): Promise<boolean>;
	/** Optional semantic verification performed before the postflight checkpoint. */
	verifyForward?(): Promise<boolean>;
	/** Optional domain verification performed before reporting full compensation. */
	verifyCompensation?(): Promise<boolean>;
}

export type RuntimeGraphTransactionExecutionResultV1 =
	| {
		readonly status: 'forward-completed';
		readonly completedPrefixLength: number;
	}
	| {
		readonly status: 'compensated';
		readonly completedPrefixLength: number;
	}
	| {
		readonly status: 'outcome-unknown';
		readonly completedPrefixLength: number;
		readonly failureStage: 'inspection' | 'compensation';
	};

export async function executeRuntimeGraphTransactionCommitV1(
	journal: GraphTransactionJournalV1,
	applyForward: (
		step: GraphTransactionJournalStepV1,
		index: number,
	) => Promise<boolean>,
	checkpoint: RuntimeGraphTransactionCheckpointWriterV1,
	afterStep?: (
		step: GraphTransactionJournalStepV1,
		index: number,
	) => Promise<void> | void,
): Promise<{ status: 'committed' | 'failed' | 'partial'; completedStepCount: number }> {
	for (const [index, step] of journal.steps.entries()) {
		if (!await applyForward(step, index)) {
			return {
				status: index === 0 ? 'failed' : 'partial',
				completedStepCount: index,
			};
		}
		await checkpoint({ phase: 'committing', completedStepCount: index + 1 });
		await afterStep?.(step, index);
	}
	return { status: 'committed', completedStepCount: journal.steps.length };
}

export async function inspectRuntimeGraphTransactionStateV1<State>(
	journal: GraphTransactionJournalV1,
	readState: RuntimeGraphTransactionExecutorPortsV1<State>['readState'],
	statesMatch: RuntimeGraphTransactionExecutorPortsV1<State>['statesMatch'],
): Promise<RuntimeGraphTransactionStateInspectionV1<State>> {
	const states = await Promise.all(journal.steps.map(readState));
	let completedPrefixLength = 0;
	while (
		completedPrefixLength < journal.steps.length
		&& statesMatch(
			states[completedPrefixLength],
			journal.steps[completedPrefixLength].after,
		)
	) {
		completedPrefixLength += 1;
	}
	const untouchedSuffix = journal.steps
		.slice(completedPrefixLength)
		.every((step, index) => (
			statesMatch(states[completedPrefixLength + index], step.before)
		));
	return {
		states,
		completedPrefixLength,
		untouchedSuffix,
	};
}

/**
 * Executes the shared compare-aware recovery mechanics for a sealed graph
 * journal. Resource-specific reads and writes remain in the caller.
 */
export async function executeRuntimeGraphTransactionRecoveryV1<State>(
	journal: GraphTransactionJournalV1,
	ports: RuntimeGraphTransactionExecutorPortsV1<State>,
): Promise<RuntimeGraphTransactionExecutionResultV1> {
	let inspection: RuntimeGraphTransactionStateInspectionV1<State>;
	try {
		inspection = await inspectRuntimeGraphTransactionStateV1(
			journal,
			(step, index) => ports.readState(step, index),
			(actual, expected) => ports.statesMatch(actual, expected),
		);
	} catch {
		return {
			status: 'outcome-unknown',
			completedPrefixLength: journal.completedStepCount,
			failureStage: 'inspection',
		};
	}
	try {
		await ports.afterInspection?.(inspection);
	} catch {
		return {
			status: 'outcome-unknown',
			completedPrefixLength: inspection.completedPrefixLength,
			failureStage: 'inspection',
		};
	}

	const prefix = inspection.completedPrefixLength;
	const irreversibleDeleteObserved = journal.steps.some((step, index) => (
		step.resourceKind === 'task-source'
		&& step.operation === 'delete'
		&& ports.statesMatch(inspection.states[index], step.after)
	));
	let checkpointPhase = journal.phase;
	let checkpointCount = Math.max(prefix, journal.completedStepCount);
	const checkpoint = async (
		phase: GraphTransactionJournalPhaseV1,
		completedStepCount: number,
	): Promise<void> => {
		await ports.checkpoint({ phase, completedStepCount });
		checkpointPhase = phase;
		checkpointCount = completedStepCount;
	};

	if (
		journal.phase !== 'compensating'
		&& (
			prefix === journal.steps.length
			|| (journal.phase !== 'postflight' && inspection.untouchedSuffix)
		)
	) {
		try {
			for (let index = prefix; index < journal.steps.length; index += 1) {
				await ports.applyForward(journal.steps[index], index);
				await checkpoint('committing', index + 1);
			}
			if (!await ports.verifyState('after')) {
				throw new Error('Graph forward state did not verify.');
			}
			if (ports.verifyForward && !await ports.verifyForward()) {
				throw new Error('Graph forward postflight did not verify.');
			}
			if (checkpointPhase === 'prepared') {
				await checkpoint('committing', journal.steps.length);
			}
			await checkpoint('postflight', journal.steps.length);
			return {
				status: 'forward-completed',
				completedPrefixLength: prefix,
			};
		} catch {
			// A compare-aware reverse pass below resolves any partial forward work.
		}
	}
	if (irreversibleDeleteObserved) {
		return {
			status: 'outcome-unknown',
			completedPrefixLength: prefix,
			failureStage: 'inspection',
		};
	}

	try {
		await checkpoint('compensating', checkpointCount);
		for (let index = journal.steps.length - 1; index >= 0; index -= 1) {
			const step = journal.steps[index];
			const current = await ports.readState(step, index);
			if (ports.statesMatch(current, step.before)) continue;
			if (!ports.statesMatch(current, step.after)) {
				throw new Error('Graph compensation encountered an unsealed state.');
			}
			await ports.applyCompensation(step, index);
		}
		if (!await ports.verifyState('before')) {
			throw new Error('Graph compensation state did not verify.');
		}
		if (ports.verifyCompensation && !await ports.verifyCompensation()) {
			throw new Error('Graph compensation postflight did not verify.');
		}
		return {
			status: 'compensated',
			completedPrefixLength: prefix,
		};
	} catch {
		return {
			status: 'outcome-unknown',
			completedPrefixLength: prefix,
			failureStage: 'compensation',
		};
	}
}
