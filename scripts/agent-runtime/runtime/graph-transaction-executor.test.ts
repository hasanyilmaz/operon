import assert from 'node:assert/strict';
import {
	executeRuntimeGraphTransactionCommitV1,
	executeRuntimeGraphTransactionRecoveryV1,
	inspectRuntimeGraphTransactionStateV1,
	type GraphTransactionJournalStepV1,
	type GraphTransactionJournalV1,
	type GraphTransactionResourceStateV1,
	type RuntimeGraphTransactionCheckpointWriterV1,
} from '../../../src/agent-runtime/runtime';

declare global {
	var __operonGraphTransactionExecutorTestRun: Promise<void> | undefined;
}

globalThis.__operonGraphTransactionExecutorTestRun = run();

type State = 'before' | 'after' | 'drift' | null;

async function run(): Promise<void> {
	await testCommitCompletesWithOrderedCheckpoints();
	await testCommitFirstStepFailure();
	await testCommitPartialFailure();
	await testCommitAfterStepInterruptionPropagates();
	await testStateInspection();
	await testForwardContinuation();
	await testForwardFailureCompensatesWithoutCheckpointRegression();
	await testPreTrashFailureCompensatesReversiblePrefix();
	await testPostTrashFailureNeverRecreatesSource();
	await testPostTrashTerminalStateForwardFinalizes();
	await testDriftCompensation();
	await testPostflightDriftDoesNotMoveBackToCommitting();
	await testCompensationConflict();
	await testInspectionFailure();
	console.log('Graph transaction executor tests passed');
}

async function testCommitCompletesWithOrderedCheckpoints(): Promise<void> {
	const journal = buildJournal('prepared', 0, 3);
	const events: string[] = [];
	const result = await executeRuntimeGraphTransactionCommitV1(
		journal,
		async (_step, index) => {
			events.push(`forward:${index}`);
			return true;
		},
		async value => {
			events.push(`checkpoint:${value.phase}:${value.completedStepCount}`);
		},
		(_step, index) => {
			events.push(`after:${index}`);
		},
	);
	assert.deepEqual(result, { status: 'committed', completedStepCount: 3 });
	assert.deepEqual(events, [
		'forward:0',
		'checkpoint:committing:1',
		'after:0',
		'forward:1',
		'checkpoint:committing:2',
		'after:1',
		'forward:2',
		'checkpoint:committing:3',
		'after:2',
	]);
}

async function testCommitFirstStepFailure(): Promise<void> {
	const journal = buildJournal('prepared', 0, 3);
	const events: string[] = [];
	const result = await executeRuntimeGraphTransactionCommitV1(
		journal,
		async (_step, index) => {
			events.push(`forward:${index}`);
			return false;
		},
		async value => {
			events.push(`checkpoint:${value.phase}:${value.completedStepCount}`);
		},
	);
	assert.deepEqual(result, { status: 'failed', completedStepCount: 0 });
	assert.deepEqual(events, ['forward:0']);
}

async function testCommitPartialFailure(): Promise<void> {
	const journal = buildJournal('prepared', 0, 3);
	const events: string[] = [];
	const result = await executeRuntimeGraphTransactionCommitV1(
		journal,
		async (_step, index) => {
			events.push(`forward:${index}`);
			return index === 0;
		},
		async value => {
			events.push(`checkpoint:${value.phase}:${value.completedStepCount}`);
		},
		(_step, index) => {
			events.push(`after:${index}`);
		},
	);
	assert.deepEqual(result, { status: 'partial', completedStepCount: 1 });
	assert.deepEqual(events, [
		'forward:0',
		'checkpoint:committing:1',
		'after:0',
		'forward:1',
	]);
}

async function testCommitAfterStepInterruptionPropagates(): Promise<void> {
	const journal = buildJournal('prepared', 0, 3);
	const events: string[] = [];
	const interruption = new Error('probe interruption');
	await assert.rejects(
		executeRuntimeGraphTransactionCommitV1(
			journal,
			async (_step, index) => {
				events.push(`forward:${index}`);
				return true;
			},
			async value => {
				events.push(`checkpoint:${value.phase}:${value.completedStepCount}`);
			},
			(_step, index) => {
				events.push(`after:${index}`);
				throw interruption;
			},
		),
		error => error === interruption,
	);
	assert.deepEqual(events, [
		'forward:0',
		'checkpoint:committing:1',
		'after:0',
	]);
}

async function testStateInspection(): Promise<void> {
	const journal = buildJournal('committing', 1);
	const inspection = await inspectRuntimeGraphTransactionStateV1(
		journal,
		async (_step, index) => index === 0 ? 'after' : 'before',
		stateMatches,
	);
	assert.equal(inspection.completedPrefixLength, 1);
	assert.equal(inspection.untouchedSuffix, true);

	const drifted = await inspectRuntimeGraphTransactionStateV1(
		journal,
		async (_step, index) => index === 0 ? 'before' : 'after',
		stateMatches,
	);
	assert.equal(drifted.completedPrefixLength, 0);
	assert.equal(drifted.untouchedSuffix, false);
}

async function testForwardContinuation(): Promise<void> {
	const journal = buildJournal('committing', 1);
	const states: State[] = ['after', 'before'];
	const events: string[] = [];
	const result = await executeRuntimeGraphTransactionRecoveryV1(
		journal,
		buildPorts(states, events),
	);
	assert.deepEqual(result, {
		status: 'forward-completed',
		completedPrefixLength: 1,
	});
	assert.deepEqual(states, ['after', 'after']);
	assert.deepEqual(events, [
		'forward:1',
		'checkpoint:committing:2',
		'verify:after',
		'checkpoint:postflight:2',
	]);
}

async function testForwardFailureCompensatesWithoutCheckpointRegression(): Promise<void> {
	const journal = buildJournal('prepared', 0, 3);
	const states: State[] = ['before', 'before', 'before'];
	const events: string[] = [];
	const ports = buildPorts(states, events);
	ports.applyForward = async (_step, index) => {
		events.push(`forward:${index}`);
		if (index === 1) throw new Error('write conflict');
		states[index] = 'after';
	};
	const result = await executeRuntimeGraphTransactionRecoveryV1(journal, ports);
	assert.deepEqual(result, {
		status: 'compensated',
		completedPrefixLength: 0,
	});
	assert.deepEqual(states, ['before', 'before', 'before']);
	assert.deepEqual(events, [
		'forward:0',
		'checkpoint:committing:1',
		'forward:1',
		'checkpoint:compensating:1',
		'compensate:0',
		'verify:before',
	]);
}

async function testPreTrashFailureCompensatesReversiblePrefix(): Promise<void> {
	const journal = buildSourceDeleteJournal('committing', 1);
	const states: State[] = ['after', 'before', 'before'];
	const events: string[] = [];
	const ports = buildPorts(states, events);
	ports.applyForward = async (_step, index) => {
		events.push(`forward:${index}`);
		throw new Error('trash did not commit');
	};
	const result = await executeRuntimeGraphTransactionRecoveryV1(journal, ports);
	assert.deepEqual(result, {
		status: 'compensated',
		completedPrefixLength: 1,
	});
	assert.deepEqual(states, ['before', 'before', 'before']);
	assert.deepEqual(events, [
		'forward:1',
		'checkpoint:compensating:1',
		'compensate:0',
		'verify:before',
	]);
}

async function testPostTrashFailureNeverRecreatesSource(): Promise<void> {
	const journal = buildSourceDeleteJournal('committing', 2);
	const states: State[] = ['after', null, 'before'];
	const events: string[] = [];
	const ports = buildPorts(states, events);
	ports.applyForward = async (_step, index) => {
		events.push(`forward:${index}`);
		throw new Error('post-trash auxiliary write conflict');
	};
	const result = await executeRuntimeGraphTransactionRecoveryV1(journal, ports);
	assert.deepEqual(result, {
		status: 'outcome-unknown',
		completedPrefixLength: 2,
		failureStage: 'inspection',
	});
	assert.deepEqual(states, ['after', null, 'before']);
	assert.deepEqual(events, ['forward:2']);
}

async function testPostTrashTerminalStateForwardFinalizes(): Promise<void> {
	const journal = buildSourceDeleteJournal('committing', 2);
	const states: State[] = ['after', null, 'before'];
	const events: string[] = [];
	const ports = buildPorts(states, events);
	ports.verifyState = async expected => {
		events.push(`verify:${expected}`);
		return expected === 'after'
			? states[0] === 'after' && states[1] === null && states[2] === 'after'
			: states.every(state => state === 'before');
	};
	const result = await executeRuntimeGraphTransactionRecoveryV1(
		journal,
		ports,
	);
	assert.deepEqual(result, {
		status: 'forward-completed',
		completedPrefixLength: 2,
	});
	assert.deepEqual(states, ['after', null, 'after']);
	assert.deepEqual(events, [
		'forward:2',
		'checkpoint:committing:3',
		'verify:after',
		'checkpoint:postflight:3',
	]);
}

async function testDriftCompensation(): Promise<void> {
	const journal = buildJournal('committing', 1);
	const states: State[] = ['before', 'after'];
	const events: string[] = [];
	const result = await executeRuntimeGraphTransactionRecoveryV1(
		journal,
		buildPorts(states, events),
	);
	assert.equal(result.status, 'compensated');
	assert.deepEqual(states, ['before', 'before']);
	assert.deepEqual(events, [
		'checkpoint:compensating:1',
		'compensate:1',
		'verify:before',
	]);
}

async function testPostflightDriftDoesNotMoveBackToCommitting(): Promise<void> {
	const journal = buildJournal('postflight', 2);
	const states: State[] = ['after', 'before'];
	const events: string[] = [];
	const result = await executeRuntimeGraphTransactionRecoveryV1(
		journal,
		buildPorts(states, events),
	);
	assert.equal(result.status, 'compensated');
	assert.deepEqual(events, [
		'checkpoint:compensating:2',
		'compensate:0',
		'verify:before',
	]);
}

async function testCompensationConflict(): Promise<void> {
	const journal = buildJournal('compensating', 1);
	const states: State[] = ['drift', 'after'];
	const events: string[] = [];
	const result = await executeRuntimeGraphTransactionRecoveryV1(
		journal,
		buildPorts(states, events),
	);
	assert.deepEqual(result, {
		status: 'outcome-unknown',
		completedPrefixLength: 0,
		failureStage: 'compensation',
	});
	assert.deepEqual(events, [
		'checkpoint:compensating:1',
		'compensate:1',
	]);
}

async function testInspectionFailure(): Promise<void> {
	const journal = buildJournal('committing', 1);
	const ports = buildPorts(['after', 'before'], []);
	ports.readState = async () => {
		throw new Error('read unavailable');
	};
	const result = await executeRuntimeGraphTransactionRecoveryV1(journal, ports);
	assert.deepEqual(result, {
		status: 'outcome-unknown',
		completedPrefixLength: 1,
		failureStage: 'inspection',
	});
}

function buildPorts(
	states: State[],
	events: string[],
): {
	readState(step: GraphTransactionJournalStepV1, index: number): Promise<State>;
	statesMatch(actual: State, expected: GraphTransactionResourceStateV1): boolean;
	applyForward(step: GraphTransactionJournalStepV1, index: number): Promise<void>;
	applyCompensation(step: GraphTransactionJournalStepV1, index: number): Promise<void>;
	checkpoint: RuntimeGraphTransactionCheckpointWriterV1;
	verifyState(expected: 'before' | 'after'): Promise<boolean>;
} {
	return {
		readState: async (_step, index) => states[index],
		statesMatch: stateMatches,
		applyForward: async (_step, index) => {
			events.push(`forward:${index}`);
			states[index] = 'after';
		},
		applyCompensation: async (_step, index) => {
			events.push(`compensate:${index}`);
			states[index] = 'before';
		},
		checkpoint: async value => {
			events.push(`checkpoint:${value.phase}:${value.completedStepCount}`);
		},
		verifyState: async expected => {
			events.push(`verify:${expected}`);
			return states.every(state => state === expected);
		},
	};
}

function stateMatches(
	actual: State,
	expected: GraphTransactionResourceStateV1,
): boolean {
	return actual === expected.content;
}

function buildJournal(
	phase: GraphTransactionJournalV1['phase'],
	completedStepCount: number,
	stepCount = 2,
): GraphTransactionJournalV1 {
	return {
		contractVersion: 1,
		vaultIdentityHash: 'a'.repeat(64),
		clientInstanceId: 'test-client',
		idempotencyKeyHash: 'b'.repeat(64),
		mutationKind: 'task.relationship',
		planHash: 'c'.repeat(64),
		targetDigest: 'd'.repeat(64),
		planId: 'test-plan',
		effectiveAt: '2026-07-27T00:00:00.000Z',
		createdAt: '2026-07-27T00:00:00.000Z',
		phase,
		completedStepCount,
		steps: Array.from({ length: stepCount }, (_, index) => ({
			stepId: `step:${index}`,
			groupId: `group:${index}`,
			resourceKind: 'task-source',
			resourceKey: `Task-${index}.md`,
			operation: 'modify',
			before: resourceState('before'),
			after: resourceState('after'),
		})),
	};
}

function buildSourceDeleteJournal(
	phase: GraphTransactionJournalV1['phase'],
	completedStepCount: number,
): GraphTransactionJournalV1 {
	const journal = buildJournal(phase, completedStepCount, 3);
	journal.mutationKind = 'task.delete';
	journal.steps[1] = {
		...journal.steps[1],
		operation: 'delete',
		before: resourceState('before'),
		after: {
			state: 'absent',
			digest: '0'.repeat(64),
			content: null,
		},
	};
	return journal;
}

function resourceState(content: State): GraphTransactionResourceStateV1 {
	if (content === null) {
		return {
			state: 'absent',
			digest: '0'.repeat(64),
			content: null,
		};
	}
	return {
		state: 'present',
		digest: content === 'before' ? 'e'.repeat(64) : 'f'.repeat(64),
		content,
	};
}
