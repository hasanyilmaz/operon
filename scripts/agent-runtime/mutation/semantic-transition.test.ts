import assert from 'node:assert/strict';
import test from 'node:test';

import { sha256HexV1 } from '../../../src/agent-runtime/contracts/v1/canonical';
import {
	executeRuntimeSemanticTransitionV1,
	planRuntimeSemanticTransitionV1,
	runtimeSemanticTransitionStepIdsV1,
	classifyRuntimeMaterializedRecurrenceRecoveryPostflightV1,
	verifyRuntimeMaterializedRecurrenceSeriesStatePostflightV1,
	verifyRuntimeMaterializedRecurrenceSuccessorPostflightV1,
	verifyRuntimeSemanticTransitionPostflightV1,
	type RuntimeSemanticTransitionCoordinatorPortsV1,
	type RuntimeSemanticTransitionPlanV1,
	type RuntimeSemanticTransitionPlannerPortsV1,
	type RuntimeSemanticTransitionRecurrencePlanningResultV1,
	type RuntimeSemanticTransitionRecurrencePlanningRequestV1,
	type RuntimeSemanticTransitionStepResultV1,
} from '../../../src/agent-runtime/runtime/semantic-transition';
import type {
	RuntimeExactTaskMutationSnapshotV1,
	RuntimeTaskFieldMutationPreparationV1,
} from '../../../src/agent-runtime/runtime/task-mutation-adapter';
import { sourceRevisionForTaskCreationV1 } from '../../../src/agent-runtime/runtime/task-creation-adapter';
import {
	buildWorkflowStatusIdentityIndex,
	resolveConfiguredStatusIdentity,
} from '../../../src/core/workflow-status-identity';
import { calculateNextRepeatDate, parseRepeatRule } from '../../../src/core/repeat-rule';
import type { Pipeline } from '../../../src/types/pipeline';
import { createFixtureRecurrencePlannerV1 } from './fixture-recurrence-planner';

const EFFECTIVE_AT = '2026-07-24T12:00:00.000Z';

const TASK_PIPELINE: Pipeline = {
	id: 'pipeline-task',
	name: 'Task',
	statuses: [
		{
			id: 'status-open',
			label: 'Open',
			color: '#32AE60',
			isFinished: false,
			isCancelled: false,
			isScheduledTarget: false,
			isTrackingTarget: false,
			propertyMapping: null,
		},
		{
			id: 'status-done',
			label: 'Done',
			color: '#777777',
			isFinished: true,
			isCancelled: false,
			isScheduledTarget: false,
			isTrackingTarget: false,
			propertyMapping: null,
		},
	],
};

function successorStatusIsOpen(value: string, pipelines: readonly Pipeline[] = [TASK_PIPELINE]): boolean {
	const identity = resolveConfiguredStatusIdentity(
		value,
		buildWorkflowStatusIdentityIndex(pipelines),
	);
	return identity.kind === 'configured'
		? !identity.status.isFinished && !identity.status.isCancelled
		: identity.kind === 'unknown';
}

function task(
	operonId: string,
	filePath: string,
	parentTask = '',
	options: {
		checkbox?: RuntimeExactTaskMutationSnapshotV1['checkbox'];
		repeat?: string;
		repeatSeriesId?: string;
		activeTimerStart?: string;
		duplicate?: boolean;
	} = {},
): RuntimeExactTaskMutationSnapshotV1 {
	const sourceContent = `- [ ] ${operonId} {{operonId:: ${operonId}}}\n`;
	return {
		operonId,
		locator: { representation: 'inline', filePath, lineNumber: 0 },
		description: operonId,
		checkbox: options.checkbox ?? 'open',
		fieldValues: {
			status: 'Projects.Open',
			...(parentTask ? { parentTask } : {}),
			...(options.repeat ? { repeat: options.repeat } : {}),
			...(options.repeatSeriesId ? { repeatSeriesId: options.repeatSeriesId } : {}),
		},
		tags: [],
		sourceContent,
		duplicate: options.duplicate ?? false,
		...(options.activeTimerStart ? { activeTimerStart: options.activeTimerStart } : {}),
	};
}

function prepared(
	source: RuntimeExactTaskMutationSnapshotV1,
	options: {
		from: RuntimeExactTaskMutationSnapshotV1['checkbox'];
		to: RuntimeExactTaskMutationSnapshotV1['checkbox'];
		noChange?: boolean;
		recurrence?: boolean;
		autoUnpin?: boolean;
		timer?: boolean;
		fromStatusId?: string;
		toStatusId?: string;
		terminal?: boolean;
	} = { from: 'open', to: 'done' },
): RuntimeTaskFieldMutationPreparationV1 {
	const noChange = options.noChange ?? false;
	return {
		kind: 'task-fields',
		operation: 'transition',
		task: source,
		fieldValues: noChange
			? {}
			: {
				status: options.to === 'open' ? 'Projects.Open' : `Projects.${options.to}`,
				_checkbox: options.to,
				dateCompleted: options.to === 'done' ? '2026-07-24' : '',
				dateCancelled: options.to === 'cancelled' ? '2026-07-24' : '',
				datetimeModified: '2026-07-24T14:00:00',
			},
		sourceRevision: sha256HexV1(source.sourceContent),
		targetDigest: sha256HexV1(source.operonId),
		summary: `Transition ${source.operonId}.`,
		noChange,
		...(source.fieldValues['parentTask']
			? { parentOperonId: source.fieldValues['parentTask'] }
			: {}),
		transition: {
			fromStatusId: options.fromStatusId
				?? (options.from === 'open' ? 'status-open' : `status-${options.from}`),
			toStatusId: options.toStatusId
				?? (options.to === 'open' ? 'status-open' : `status-${options.to}`),
			fromCheckbox: options.from,
			toCheckbox: options.to,
			terminal: options.terminal ?? options.to !== 'open',
			finalizeActiveTimer: options.timer ?? false,
			materializeRecurrence: options.recurrence ?? false,
			autoUnpin: options.autoUnpin ?? false,
		},
	};
}

function plannerPorts(
	tasks: readonly RuntimeExactTaskMutationSnapshotV1[],
	pinned = false,
	recurrencePlanner: (
		request: RuntimeSemanticTransitionRecurrencePlanningRequestV1,
	) => Promise<RuntimeSemanticTransitionRecurrencePlanningResultV1> = (
		createFixtureRecurrencePlannerV1()
	),
	projectSerialScopes = true,
	allowUnavailableAncestors = false,
): RuntimeSemanticTransitionPlannerPortsV1 {
	const byId = new Map(tasks.map(item => [item.operonId, item]));
	return {
		getTask: operonId => byId.get(operonId) ?? null,
		allowUnavailableAncestors,
		isPinned: () => pinned,
		hasProjectSerialScopes: () => projectSerialScopes,
		stateRevisions: () => ({
			activeTracker: 'tracker-rev',
			repeatSeries: 'repeat-rev',
			pinned: 'pinned-rev',
			projectSerial: 'serial-rev',
		}),
		planRecurrence: recurrencePlanner,
	};
}

function requirePlan(
	result: Awaited<ReturnType<typeof planRuntimeSemanticTransitionV1>>,
): RuntimeSemanticTransitionPlanV1 {
	if (!result.ok) throw new Error(result.reason);
	return result.value;
}

async function fullPlan(
	recurrenceDisposition: 'materialize' | 'ended' = 'materialize',
): Promise<RuntimeSemanticTransitionPlanV1> {
	const source = task('tsk0001', 'Tasks.md', 'par0001', {
		repeat: 'FREQ=WEEKLY',
		repeatSeriesId: 'series-a',
		activeTimerStart: '2026-07-24T11:00:00',
	});
	const parent = task('par0001', 'Projects/Parent.md', 'gra0001');
	const grandparent = task('gra0001', 'Projects/Grandparent.md');
	return requirePlan(await planRuntimeSemanticTransitionV1(
		prepared(source, {
			from: 'open',
			to: 'done',
			recurrence: true,
			autoUnpin: true,
			timer: true,
		}),
		EFFECTIVE_AT,
		plannerPorts(
			[source, parent, grandparent],
			true,
			createFixtureRecurrencePlannerV1({ disposition: recurrenceDisposition }),
		),
	));
}

async function coLocatedAncestorPlan(): Promise<RuntimeSemanticTransitionPlanV1> {
	const sharedContent = [
		'- [ ] child {{operonId:: tsk0001}} {{parentTask:: par0001}}',
		'- [ ] parent {{operonId:: par0001}}',
	].join('\n');
	const source = {
		...task('tsk0001', 'Hierarchy.md', 'par0001'),
		sourceContent: sharedContent,
	};
	const parent = {
		...task('par0001', 'Hierarchy.md'),
		sourceContent: sharedContent,
	};
	return requirePlan(await planRuntimeSemanticTransitionV1(
		{
			...prepared(source),
			sourceRevision: sha256HexV1(sharedContent),
		},
		EFFECTIVE_AT,
		plannerPorts([source, parent]),
	));
}

function success(
	affectedFilePaths: readonly string[] = [],
): RuntimeSemanticTransitionStepResultV1 {
	return { ok: true, affectedFilePaths };
}

function coordinatorPorts(
	record: string[],
	options: {
		failGroupId?: string;
		recurrenceDisposition?: 'created' | 'ended';
	} = {},
): RuntimeSemanticTransitionCoordinatorPortsV1 {
	const run = (
		groupId: string,
		affectedFilePaths: readonly string[] = [],
	): RuntimeSemanticTransitionStepResultV1 => {
		record.push(groupId);
		return options.failGroupId === groupId
			? { ok: false, reason: `fault:${groupId}` }
			: success(affectedFilePaths);
	};
	return {
		commitPrimary: plan => Promise.resolve(run(
			plan.primaryGroup.groupId,
			[plan.prepared.task.locator.filePath],
		)),
		materializeRecurrence: effect => {
			const result = run(effect.groupId, ['Tasks.md']);
			return Promise.resolve(result.ok
				? {
					...result,
					disposition: options.recurrenceDisposition ?? 'created',
				}
				: result);
		},
		reconcilePrimaryAncestors: plan => Promise.resolve(run(
			`${plan.primaryGroup.groupId}:ancestors`,
			[plan.prepared.task.locator.filePath],
		)),
		reconcileAncestorGroup: group => Promise.resolve(run(group.groupId, [group.filePath])),
		removePinned: (operonId) => Promise.resolve(run(`pinned:${operonId}`)),
		settleProjectSerial: () => Promise.resolve(run('project-serial:global')),
	};
}

test('planner models no-op, open, done, cancel, and reopen semantics without changing the wire spec', async () => {
	const scenarios = [
		{
			name: 'no-op',
			source: task('tsk0001', 'Tasks.md'),
			options: { from: 'open' as const, to: 'open' as const, noChange: true },
			recurrence: false,
			projectSerial: false,
		},
		{
			name: 'open',
			source: task('tsk0001', 'Tasks.md'),
			options: { from: 'open' as const, to: 'open' as const },
			recurrence: false,
			projectSerial: true,
		},
		{
			name: 'done',
			source: task('tsk0001', 'Tasks.md', '', { repeat: 'FREQ=DAILY' }),
			options: { from: 'open' as const, to: 'done' as const, recurrence: true },
			recurrence: true,
			projectSerial: true,
		},
		{
			name: 'cancel',
			source: task('tsk0001', 'Tasks.md', '', { repeat: 'FREQ=DAILY' }),
			options: { from: 'open' as const, to: 'cancelled' as const, recurrence: true },
			recurrence: true,
			projectSerial: true,
		},
		{
			name: 'reopen',
			source: task('tsk0001', 'Tasks.md', '', { checkbox: 'done', repeat: 'FREQ=DAILY' }),
			options: { from: 'done' as const, to: 'open' as const },
			recurrence: false,
			projectSerial: true,
		},
	];

	for (const scenario of scenarios) {
		const plan = requirePlan(await planRuntimeSemanticTransitionV1(
			prepared(scenario.source, scenario.options),
			EFFECTIVE_AT,
			plannerPorts([scenario.source]),
		));
		assert.equal(plan.operation, 'task.transition', scenario.name);
		assert.equal(plan.recurrence !== null, scenario.recurrence, scenario.name);
		assert.equal(plan.projectSerialGroup !== null, scenario.projectSerial, scenario.name);
	}

	const noOp = requirePlan(await planRuntimeSemanticTransitionV1(
		prepared(task('tsk0001', 'Tasks.md'), {
			from: 'open',
			to: 'open',
			noChange: true,
		}),
		EFFECTIVE_AT,
		plannerPorts([]),
	));
	const calls: string[] = [];
	const result = await executeRuntimeSemanticTransitionV1(noOp, coordinatorPorts(calls));
	assert.equal(result.status, 'committed');
	assert.deepEqual(calls, []);
	assert.deepEqual(result.affectedFilePaths, []);

	const timedReplaySource = task('tsk0001', 'Tasks.md', '', {
		activeTimerStart: '2026-07-24T11:00:00',
	});
	const timedReplay = requirePlan(await planRuntimeSemanticTransitionV1(
		prepared(timedReplaySource, {
			from: 'open',
			to: 'open',
			noChange: true,
			timer: true,
		}),
		EFFECTIVE_AT,
		plannerPorts([timedReplaySource]),
	));
	assert.equal(timedReplay.noChange, false);
	assert.equal(
		timedReplay.atomicGroups[0].resources.some(resource => (
			resource.resourceKind === 'active-tracker'
		)),
		true,
	);
});

test('planner seals recurrence, two ancestors, pinned cleanup, and project-serial settlement in behavior order', async () => {
	const plan = await fullPlan();
	assert.deepEqual(
		plan.atomicGroups.map(group => group.groupId),
		[
			'task-transition:tsk0001',
			'repeat-series:tsk0001',
			'ancestor-source:Projects/Parent.md',
			'ancestor-source:Projects/Grandparent.md',
			'pinned:tsk0001',
			'project-serial:global',
		],
	);
	assert.deepEqual(
		plan.ancestorGroups.flatMap(group => group.ancestors.map(item => item.operonId)),
		['par0001', 'gra0001'],
	);
	assert.equal(plan.recurrence?.seriesId, 'series-a');
	assert.equal(plan.recurrence?.terminalCheckbox, 'done');
	assert.equal(plan.recurrence?.preview.disposition, 'materialize');
	if (plan.recurrence?.preview.disposition === 'materialize') {
		assert.equal(plan.recurrence.preview.nextOperonId, 'nxt0001');
		assert.equal(plan.recurrence.preview.nextLocator.filePath, 'Tasks.md');
		assert.equal(plan.recurrence.preview.coalescedWithPrimarySource, true);
		assert.equal(
			plan.recurrence.preview.plannedSourceRevision,
			sha256HexV1(plan.recurrence.preview.plannedSourceContent),
		);
		assert.equal(
			plan.predictedEffects.some(effect => (
				effect.summary.includes(plan.recurrence!.preview.disposition === 'materialize'
					? plan.recurrence!.preview.plannedSourceRevision
					: '')
			)),
			true,
		);
	}
	assert.equal(
		plan.affectedResources.some(resource => resource.resourceKind === 'repeat-series'),
		true,
	);
});

test('unscoped non-terminal transition omits project serial and cannot wait on its settlement', async () => {
	const source = task('tsk0001', 'Tasks.md');
	const transition = prepared(source, {
		from: 'open',
		to: 'open',
		fromStatusId: 'status-backlog',
		toStatusId: 'status-in-progress',
		terminal: false,
	});
	const unscoped = requirePlan(await planRuntimeSemanticTransitionV1(
		transition,
		EFFECTIVE_AT,
		plannerPorts([source], false, createFixtureRecurrencePlannerV1(), false),
	));
	assert.equal(unscoped.projectSerialGroup, null);
	assert.deepEqual(runtimeSemanticTransitionStepIdsV1(unscoped), ['primary']);
	assert.equal(
		unscoped.atomicGroups.some(group => group.groupId === 'project-serial:global'),
		false,
	);
	assert.equal(
		unscoped.affectedResources.some(resource => resource.resourceKind === 'project-serial'),
		false,
	);
	assert.equal(
		unscoped.predictedEffects.some(effect => effect.resourceKind === 'project-serial'),
		false,
	);

	const calls: string[] = [];
	let projectSerialCalls = 0;
	const coordinator = coordinatorPorts(calls);
	const neverSettles = new Promise<RuntimeSemanticTransitionStepResultV1>(() => undefined);
	const timeoutMarker = Symbol('timeout');
	let timeout: ReturnType<typeof setTimeout> | undefined;
	const bounded = new Promise<typeof timeoutMarker>(resolve => {
		timeout = setTimeout(() => resolve(timeoutMarker), 250);
	});
	const execution = executeRuntimeSemanticTransitionV1(unscoped, {
		...coordinator,
		settleProjectSerial: () => {
			projectSerialCalls += 1;
			return neverSettles;
		},
	});
	const result = await Promise.race([execution, bounded]);
	if (timeout) clearTimeout(timeout);
	assert.notEqual(result, timeoutMarker, 'unscoped transition must not await project-serial settlement');
	if (result === timeoutMarker) return;
	assert.equal(result.status, 'committed');
	assert.deepEqual(calls, ['task-transition:tsk0001']);
	assert.equal(projectSerialCalls, 0);

	const scoped = requirePlan(await planRuntimeSemanticTransitionV1(
		transition,
		EFFECTIVE_AT,
		plannerPorts([source]),
	));
	assert.equal(scoped.projectSerialGroup?.groupId, 'project-serial:global');
	assert.deepEqual(runtimeSemanticTransitionStepIdsV1(scoped), ['primary', 'project-serial']);
	const scopedCalls: string[] = [];
	const scopedResult = await executeRuntimeSemanticTransitionV1(scoped, coordinatorPorts(scopedCalls));
	assert.equal(scopedResult.status, 'committed');
	assert.deepEqual(scopedCalls, ['task-transition:tsk0001', 'project-serial:global']);
});

test('empty scopes omit only project serial from terminal and compound transition plans', async () => {
	const terminalSource = task('tsk0001', 'Terminal.md');
	const terminal = requirePlan(await planRuntimeSemanticTransitionV1(
		prepared(terminalSource, { from: 'open', to: 'done' }),
		EFFECTIVE_AT,
		plannerPorts([terminalSource], false, createFixtureRecurrencePlannerV1(), false),
	));
	assert.equal(terminal.projectSerialGroup, null);
	assert.equal(
		terminal.predictedEffects.some(effect => effect.resourceKind === 'project-serial'),
		false,
	);

	const compound = requirePlan(await planRuntimeSemanticTransitionV1(
		(await fullPlan()).prepared,
		EFFECTIVE_AT,
		plannerPorts(
			[
				task('tsk0001', 'Tasks.md', 'par0001', {
					repeat: 'FREQ=WEEKLY',
					repeatSeriesId: 'series-a',
					activeTimerStart: '2026-07-24T11:00:00',
				}),
				task('par0001', 'Projects/Parent.md', 'gra0001'),
				task('gra0001', 'Projects/Grandparent.md'),
			],
			true,
			createFixtureRecurrencePlannerV1(),
			false,
		),
	));
	assert.equal(compound.projectSerialGroup, null);
	assert.deepEqual(
		compound.atomicGroups.map(group => group.groupId),
		[
			'task-transition:tsk0001',
			'repeat-series:tsk0001',
			'ancestor-source:Projects/Parent.md',
			'ancestor-source:Projects/Grandparent.md',
			'pinned:tsk0001',
		],
	);
	assert.equal(
		compound.affectedResources.some(resource => resource.resourceKind === 'project-serial'),
		false,
	);
	assert.equal(
		compound.predictedEffects.some(effect => effect.resourceKind === 'project-serial'),
		false,
	);
});

test('read-only recurrence preview seals an exact new source and rejects ID or path collisions', async () => {
	const source = task('tsk0001', 'Recurring/Current.md', '', {
		repeat: 'FREQ=WEEKLY',
		repeatSeriesId: 'series-a',
	});
	const externalLocator = {
		representation: 'file' as const,
		filePath: 'Recurring/Next.md',
	};
	const exact = requirePlan(await planRuntimeSemanticTransitionV1(
		prepared(source, { from: 'open', to: 'done', recurrence: true }),
		EFFECTIVE_AT,
		plannerPorts(
			[source],
			false,
			createFixtureRecurrencePlannerV1({
				nextOperonId: 'nxt0001',
				nextLocator: externalLocator,
				plannedSourceContent: '---\noperonId: nxt0001\n---\n',
			}),
		),
	));
	assert.equal(exact.recurrence?.preview.disposition, 'materialize');
	assert.deepEqual(
		exact.atomicGroups.find(group => group.groupId === 'repeat-series:tsk0001')?.resources,
		[
			{ resourceKind: 'repeat-series', resourceKey: 'series-a' },
			{ resourceKind: 'task-source', resourceKey: 'Recurring/Next.md' },
		],
	);
	assert.equal(
		exact.predictedEffects.some(effect => (
			effect.resourceKind === 'task-source'
				&& effect.resourceKey === 'Recurring/Next.md'
				&& effect.action === 'create'
		)),
		true,
	);

	const idCollision = await planRuntimeSemanticTransitionV1(
		prepared(source, { from: 'open', to: 'done', recurrence: true }),
		EFFECTIVE_AT,
		plannerPorts(
			[source],
			false,
			createFixtureRecurrencePlannerV1({
				nextOperonId: 'nxt0001',
				occupiedOperonIds: new Set(['nxt0001']),
			}),
		),
	);
	assert.equal(idCollision.ok, false);
	if (!idCollision.ok) assert.equal(idCollision.code, 'duplicate-operon-id');

	const pathCollision = await planRuntimeSemanticTransitionV1(
		prepared(source, { from: 'open', to: 'done', recurrence: true }),
		EFFECTIVE_AT,
		plannerPorts(
			[source],
			false,
			createFixtureRecurrencePlannerV1({
				nextLocator: externalLocator,
				occupiedFilePaths: new Set(['Recurring/Next.md']),
			}),
		),
	);
	assert.equal(pathCollision.ok, false);
	if (!pathCollision.ok) assert.equal(pathCollision.code, 'stale-source');
});

test('planner fails closed when active-timer finalization would lose a replaced inline occurrence', async () => {
	const source = task('tsk0001', 'Tasks.md');
	const result = await planRuntimeSemanticTransitionV1(
		prepared(source, {
			from: 'open',
			to: 'done',
			recurrence: true,
			timer: true,
		}),
		EFFECTIVE_AT,
		{
			...plannerPorts([source]),
			planRecurrence: async () => ({
				ok: true,
				value: {
					disposition: 'materialize',
					seriesId: 'series-1',
					nextOperonId: 'nxt0001',
					nextLocator: {
						representation: 'inline',
						filePath: 'Tasks.md',
						lineNumber: 0,
					},
					plannedSourceContent: 'next',
					plannedSourceRevision: sha256HexV1('next'),
					applyExpectedSourceContent: source.sourceContent,
					sourcePrecondition: {
						expectedSourceRevision: sourceRevisionForTaskCreationV1(
							'Tasks.md',
							source.sourceContent,
						),
					},
					sourceTaskRetained: false,
					coalescedWithPrimarySource: true,
				},
			}),
		},
	);
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.code, 'capability-unavailable');
		assert.match(result.reason, /active timer/i);
	}
});

test('ancestors sharing one source become one atomic source group in descendant-first order', async () => {
	const source = task('tsk0001', 'Tasks.md', 'par0001');
	const sharedContent = [
		'- [ ] parent {{operonId:: par0001}}',
		'- [ ] grandparent {{operonId:: gra0001}}',
	].join('\n');
	const parent = {
		...task('par0001', 'Projects/Hierarchy.md', 'gra0001'),
		sourceContent: sharedContent,
	};
	const grandparent = {
		...task('gra0001', 'Projects/Hierarchy.md'),
		sourceContent: sharedContent,
	};
	const plan = requirePlan(await planRuntimeSemanticTransitionV1(
		prepared(source),
		EFFECTIVE_AT,
		plannerPorts([source, parent, grandparent]),
	));
	assert.equal(plan.ancestorGroups.length, 1);
	assert.deepEqual(
		plan.ancestorGroups[0].ancestors.map(item => item.operonId),
		['par0001', 'gra0001'],
	);
});

test('co-located ancestors stay modeled in the primary group and remain mandatory postflight evidence', async () => {
	const sharedContent = [
		'- [ ] child {{operonId:: tsk0001}} {{parentTask:: par0001}}',
		'- [ ] parent {{operonId:: par0001}} {{parentTask:: gra0001}}',
		'- [ ] grandparent {{operonId:: gra0001}}',
	].join('\n');
	const source = {
		...task('tsk0001', 'Hierarchy.md', 'par0001'),
		sourceContent: sharedContent,
	};
	const parent = {
		...task('par0001', 'Hierarchy.md', 'gra0001'),
		sourceContent: sharedContent,
	};
	const grandparent = {
		...task('gra0001', 'Hierarchy.md'),
		sourceContent: sharedContent,
	};
	const plan = requirePlan(await planRuntimeSemanticTransitionV1(
		{
			...prepared(source),
			sourceRevision: sha256HexV1(sharedContent),
		},
		EFFECTIVE_AT,
		plannerPorts([source, parent, grandparent]),
	));
	assert.deepEqual(
		plan.primaryAncestors.map(item => item.operonId),
		['par0001', 'gra0001'],
	);
	assert.deepEqual(plan.ancestorGroups, []);
	assert.deepEqual(
		verifyRuntimeSemanticTransitionPostflightV1(plan, {
			primaryVerified: true,
			verifiedAncestorOperonIds: ['par0001'],
			pinned: false,
			projectSerialRevision: 'a'.repeat(64),
			committedProjectSerialRevision: 'a'.repeat(64),
		}),
		{ ok: false, failures: ['ancestors'] },
	);
});

test('planner fails closed for a missing, duplicate, cyclic, or snapshot-incoherent ancestor', async () => {
	const source = task('tsk0001', 'Tasks.md', 'par0001');
	const missing = await planRuntimeSemanticTransitionV1(
		prepared(source),
		EFFECTIVE_AT,
		plannerPorts([source]),
	);
	assert.equal(missing.ok, false);
	if (!missing.ok) assert.equal(missing.code, 'entity-not-found');

	const duplicateParent = task('par0001', 'Parent.md', '', { duplicate: true });
	const duplicate = await planRuntimeSemanticTransitionV1(
		prepared(source),
		EFFECTIVE_AT,
		plannerPorts([source, duplicateParent]),
	);
	assert.equal(duplicate.ok, false);
	if (!duplicate.ok) assert.equal(duplicate.code, 'duplicate-operon-id');

	const cyclicParent = task('par0001', 'Parent.md', 'tsk0001');
	const cycle = await planRuntimeSemanticTransitionV1(
		prepared(source),
		EFFECTIVE_AT,
		plannerPorts([source, cyclicParent]),
	);
	assert.equal(cycle.ok, false);
	if (!cycle.ok) assert.match(cycle.reason, /cycle/u);

	const sharedParent = task('par0001', 'Hierarchy.md', 'gra0001');
	const driftingGrandparent = task('gra0001', 'Hierarchy.md');
	const incoherent = await planRuntimeSemanticTransitionV1(
		prepared(source),
		EFFECTIVE_AT,
		plannerPorts([source, sharedParent, driftingGrandparent]),
	);
	assert.equal(incoherent.ok, false);
	if (!incoherent.ok) assert.equal(incoherent.code, 'stale-source');

	const coLocatedDrift = await planRuntimeSemanticTransitionV1(
		prepared(source),
		EFFECTIVE_AT,
		plannerPorts([
			source,
			{
				...task('par0001', 'Tasks.md'),
				sourceContent: 'drifted shared source',
			},
		]),
	);
	assert.equal(coLocatedDrift.ok, false);
	if (!coLocatedDrift.ok) assert.equal(coLocatedDrift.code, 'stale-source');
});

test('internal tolerant planning bounds missing ancestors while preserving parent links and resolved ancestors', async () => {
	for (const description of [
		'Plain task description',
		'Task with **bold text**',
		'Task with [[Project Wiki Link]]',
	]) {
		const source = {
			...task('tsk0001', 'Tasks.md', 'par0001'),
			description,
		};
		const plan = requirePlan(await planRuntimeSemanticTransitionV1(
			prepared(source),
			EFFECTIVE_AT,
			plannerPorts(
				[source],
				false,
				createFixtureRecurrencePlannerV1(),
				true,
				true,
			),
		));
		assert.equal(plan.unavailableAncestorOperonId, 'par0001', description);
		assert.equal(plan.prepared.task.fieldValues['parentTask'], 'par0001', description);
		assert.deepEqual(plan.primaryAncestors, [], description);
		assert.deepEqual(plan.ancestorGroups, [], description);
		assert.equal(
			plan.affectedResources.some(resource => resource.resourceKey.includes('par0001')),
			false,
			description,
		);
	}

	const source = task('tsk0001', 'Tasks.md', 'par0001');
	const parent = task('par0001', 'Projects/Parent.md', 'gra0001');
	const plan = requirePlan(await planRuntimeSemanticTransitionV1(
		prepared(source),
		EFFECTIVE_AT,
		plannerPorts(
			[source, parent],
			false,
			createFixtureRecurrencePlannerV1(),
			true,
			true,
		),
	));
	assert.equal(plan.unavailableAncestorOperonId, 'gra0001');
	assert.deepEqual(
		plan.ancestorGroups.flatMap(group => group.ancestors.map(item => item.operonId)),
		['par0001'],
	);
	assert.equal(
		plan.affectedResources.some(resource => resource.resourceKey.includes('Grandparent')),
		false,
	);
});

test('internal tolerance does not relax invalid, duplicate, cycle, or stale-source safety failures', async () => {
	const source = task('tsk0001', 'Tasks.md', 'par0001');
	const tolerantPorts = (ancestors: readonly RuntimeExactTaskMutationSnapshotV1[]) => plannerPorts(
		[source, ...ancestors],
		false,
		createFixtureRecurrencePlannerV1(),
		true,
		true,
	);
	const duplicate = await planRuntimeSemanticTransitionV1(
		prepared(source),
		EFFECTIVE_AT,
		tolerantPorts([task('par0001', 'Parent.md', '', { duplicate: true })]),
	);
	assert.equal(duplicate.ok, false);
	if (!duplicate.ok) assert.equal(duplicate.code, 'duplicate-operon-id');

	const cycle = await planRuntimeSemanticTransitionV1(
		prepared(source),
		EFFECTIVE_AT,
		tolerantPorts([task('par0001', 'Parent.md', 'tsk0001')]),
	);
	assert.equal(cycle.ok, false);
	if (!cycle.ok) assert.match(cycle.reason, /cycle/u);

	const invalidSource = task('tsk0002', 'Invalid.md', 'not-an-operon-id');
	const invalid = await planRuntimeSemanticTransitionV1(
		prepared(invalidSource),
		EFFECTIVE_AT,
		plannerPorts(
			[invalidSource],
			false,
			createFixtureRecurrencePlannerV1(),
			true,
			true,
		),
	);
	assert.equal(invalid.ok, false);
	if (!invalid.ok) assert.equal(invalid.code, 'invalid-request');

	const staleSource = await planRuntimeSemanticTransitionV1(
		prepared(source),
		EFFECTIVE_AT,
		tolerantPorts([{
			...task('par0001', 'Tasks.md'),
			sourceContent: 'drifted shared source',
		}]),
	);
	assert.equal(staleSource.ok, false);
	if (!staleSource.ok) assert.equal(staleSource.code, 'stale-source');
});

test('terminal transition keeps recurrence, timer, pinned, and project-serial effects with a missing ancestor boundary', async () => {
	const source = task('tsk0001', 'Tasks.md', 'par0001', {
		repeat: 'FREQ=WEEKLY',
		repeatSeriesId: 'series-a',
		activeTimerStart: '2026-07-24T11:00:00',
	});
	const plan = requirePlan(await planRuntimeSemanticTransitionV1(
		prepared(source, {
			from: 'open',
			to: 'done',
			recurrence: true,
			autoUnpin: true,
			timer: true,
		}),
		EFFECTIVE_AT,
		plannerPorts(
			[source],
			true,
			createFixtureRecurrencePlannerV1(),
			true,
			true,
		),
	));
	assert.equal(plan.unavailableAncestorOperonId, 'par0001');
	assert.notEqual(plan.recurrence, null);
	assert.equal(
		plan.primaryGroup.resources.some(resource => resource.resourceKind === 'active-tracker'),
		true,
	);
	assert.notEqual(plan.pinnedGroup, null);
	assert.notEqual(plan.projectSerialGroup, null);

	const calls: string[] = [];
	const result = await executeRuntimeSemanticTransitionV1(plan, coordinatorPorts(calls));
	assert.equal(result.status, 'committed');
	assert.deepEqual(calls, [
		'task-transition:tsk0001',
		'repeat-series:tsk0001',
		'pinned:tsk0001',
		'project-serial:global',
	]);
});

test('coordinator accepts both recurrence materialization and a cleanly ended series', async () => {
	for (const disposition of ['created', 'ended'] as const) {
		const calls: string[] = [];
		const result = await executeRuntimeSemanticTransitionV1(
			await fullPlan(disposition === 'created' ? 'materialize' : 'ended'),
			coordinatorPorts(calls, { recurrenceDisposition: disposition }),
		);
		assert.equal(result.status, 'committed');
		assert.equal(result.recurrenceDisposition, disposition);
		assert.equal(
			result.groupResults.every(group => group.resourceRevisions === undefined),
			true,
		);
		assert.deepEqual(calls, [
			'task-transition:tsk0001',
			'repeat-series:tsk0001',
			'ancestor-source:Projects/Parent.md',
			'ancestor-source:Projects/Grandparent.md',
			'pinned:tsk0001',
			'project-serial:global',
		]);
	}
});

test('same-plan semantic recovery resumes after a durable primary or recurrence prefix', async () => {
	const plan = await fullPlan();
	const ordered = runtimeSemanticTransitionStepIdsV1(plan);
	assert.deepEqual(ordered.slice(0, 2), ['primary', 'recurrence']);
	for (const crashAfter of ['primary', 'recurrence'] as const) {
		const firstCalls: string[] = [];
		const durablePrefix: string[] = [];
		await assert.rejects(
			executeRuntimeSemanticTransitionV1(
				plan,
				coordinatorPorts(firstCalls),
				{
					onStepCommitted: (stepId) => {
						durablePrefix.push(stepId);
						if (stepId === crashAfter) throw new Error(`crash:${stepId}`);
						return Promise.resolve();
					},
				},
			),
			new RegExp(`crash:${crashAfter}`, 'u'),
		);
		const recoveredCalls: string[] = [];
		const recovered = await executeRuntimeSemanticTransitionV1(
			plan,
			coordinatorPorts(recoveredCalls),
			{ completedStepIds: durablePrefix },
		);
		assert.equal(recovered.status, 'committed');
		assert.equal(
			recoveredCalls.includes('task-transition:tsk0001'),
			false,
			`${crashAfter}: primary must not repeat`,
		);
		assert.equal(
			recoveredCalls.includes('repeat-series:tsk0001'),
			crashAfter === 'primary',
			`${crashAfter}: recurrence repeats only when it was not checkpointed`,
		);
	}
});

test('same-plan semantic recovery verifies every effect committed before checkpoint persistence', async () => {
	for (const plan of [await fullPlan(), await coLocatedAncestorPlan()]) {
		const ordered = runtimeSemanticTransitionStepIdsV1(plan);
		for (const crashAfter of ordered) {
			const observedAfter = new Set<string>();
			const durablePrefix: string[] = [];
			const firstCalls: string[] = [];
			await assert.rejects(executeRuntimeSemanticTransitionV1(
				plan,
				coordinatorPorts(firstCalls),
				{
					onStepCommitted: (stepId) => {
						observedAfter.add(stepId);
						if (stepId === crashAfter) throw new Error('checkpoint-persist-failed');
						durablePrefix.push(stepId);
						return Promise.resolve();
					},
				},
			), /checkpoint-persist-failed/u);
			const recoveredCalls: string[] = [];
			const recovered = await executeRuntimeSemanticTransitionV1(
				plan,
				coordinatorPorts(recoveredCalls),
				{
					completedStepIds: durablePrefix,
					classifyUncheckpointedStep: stepId => Promise.resolve(
						observedAfter.has(stepId) ? 'after' : 'before',
					),
				},
			);
			assert.equal(recovered.status, 'committed');
			assert.equal(
				recoveredCalls.length,
				ordered.length - ordered.indexOf(crashAfter) - 1,
				`${crashAfter}: only later semantic steps should execute`,
			);
		}
	}
});

test('coordinator stops at a fault in every compound-effect group and reports post-primary uncertainty', async () => {
	const plan = await fullPlan();
	for (const [index, group] of plan.atomicGroups.entries()) {
		const calls: string[] = [];
		const result = await executeRuntimeSemanticTransitionV1(
			plan,
			coordinatorPorts(calls, { failGroupId: group.groupId }),
		);
		assert.equal(
			result.status,
			index === 0 ? 'failed' : 'partial',
			group.groupId,
		);
		assert.equal(result.groupResults.at(-1)?.groupId, group.groupId);
		assert.equal(result.groupResults.at(-1)?.status, 'failed');
		assert.equal(calls.at(-1), group.groupId);
		assert.equal(calls.length, index + 1);
	}
});

test('timed done recurrence requires an exact open successor before repeat state or success-refresh eligibility', async () => {
	const meditate = {
		operonId: '359cc8d',
		fieldValues: {
			status: 'Task.Open',
			dateScheduled: '2026-08-16',
			datetimeStart: '2026-08-16T08:45:00',
			datetimeEnd: '2026-08-16T09:00:00',
			estimate: '900',
			repeat: 'mode=done|freq=day|interval=1',
			repeatSeriesId: 'rsn0hm4',
			repeatOccurrenceDate: '2026-08-16',
		},
	};
	const expectedSuccessor = {
		operonId: 'nxt0001',
		locator: {
			representation: 'inline' as const,
			filePath: 'Daily/2026-08-16.md',
			lineNumber: 43,
		},
		checkbox: 'open' as const,
	};
	assert.equal(meditate.fieldValues.status, 'Task.Open');
	assert.equal(meditate.fieldValues.datetimeStart, '2026-08-16T08:45:00');
	assert.equal(meditate.fieldValues.datetimeEnd, '2026-08-16T09:00:00');
	assert.equal(meditate.fieldValues.repeat, 'mode=done|freq=day|interval=1');
	assert.equal(successorStatusIsOpen(meditate.fieldValues.status), true);

	const doneRule = parseRepeatRule(meditate.fieldValues.repeat);
	assert.ok(doneRule);
	assert.equal(
		calculateNextRepeatDate(doneRule, { anchorDate: meditate.fieldValues.repeatOccurrenceDate }),
		'2026-08-17',
		'An early completion must retain the occurrence-date anchor for a done-mode daily recurrence.',
	);

	for (const { completionMode, newOccurrencePosition, lineNumber } of [
		{ completionMode: 'keep-completed', newOccurrencePosition: 'below', lineNumber: 43 },
		{ completionMode: 'keep-completed', newOccurrencePosition: 'above', lineNumber: 42 },
		{ completionMode: 'replace-completed', newOccurrencePosition: 'below', lineNumber: 42 },
	] as const) {
		const expected = {
			...expectedSuccessor,
			locator: { ...expectedSuccessor.locator, lineNumber },
		};
		assert.equal(
			verifyRuntimeMaterializedRecurrenceSuccessorPostflightV1({
				expectedOperonId: expected.operonId,
				expectedLocator: expected.locator,
				successor: expected,
				hasDuplicateOperonIdConflict: false,
				statusIsOpen: successorStatusIsOpen('Task.Open'),
			}),
			true,
			`${completionMode}/${newOccurrencePosition} must accept the exact same-file successor locator.`,
		);
	}

	assert.equal(successorStatusIsOpen('Legacy.Open'), true, 'Legacy status values remain valid when the checkbox is open.');
	assert.equal(successorStatusIsOpen('Task.Done'), false, 'Configured terminal status cannot certify an open successor.');
	assert.equal(
		successorStatusIsOpen('Task.Open', [TASK_PIPELINE, { ...TASK_PIPELINE, id: 'pipeline-task-copy' }]),
		false,
		'Ambiguous configured status must fail closed.',
	);
	assert.equal(
		verifyRuntimeMaterializedRecurrenceSuccessorPostflightV1({
			expectedOperonId: expectedSuccessor.operonId,
			expectedLocator: expectedSuccessor.locator,
			successor: null,
			hasDuplicateOperonIdConflict: false,
			statusIsOpen: true,
		}),
		false,
		'A forced index-resolution miss must not be treated as recurrence success.',
	);
	assert.equal(
		verifyRuntimeMaterializedRecurrenceSuccessorPostflightV1({
			expectedOperonId: expectedSuccessor.operonId,
			expectedLocator: expectedSuccessor.locator,
			successor: expectedSuccessor,
			hasDuplicateOperonIdConflict: true,
			statusIsOpen: true,
		}),
		false,
		'A duplicate successor identity must not be treated as a unique indexed task.',
	);

	const plan = await fullPlan();
	const calls: string[] = [];
	const result = await executeRuntimeSemanticTransitionV1(plan, {
		...coordinatorPorts(calls),
		materializeRecurrence: async effect => {
			calls.push(effect.groupId);
			return {
				ok: false,
				outcomeUnknown: true,
				reason: 'Forced successor index-resolution miss.',
			};
		},
	});
	assert.equal(result.status, 'outcome-unknown');
	assert.deepEqual(calls, ['task-transition:tsk0001', 'repeat-series:tsk0001']);
	const successfulCalendarRefreshEligible = (status: string): boolean => status === 'committed';
	assert.equal(
		successfulCalendarRefreshEligible(result.status),
		false,
		'A forced successor miss must not become eligible for a successful Calendar refresh.',
	);
});

test('recurrence recovery refuses a source-written materialization without indexed successor or repeat state', async () => {
	const plan = await fullPlan();
	assert.equal(plan.recurrence?.preview.disposition, 'materialize');
	if (plan.recurrence?.preview.disposition !== 'materialize') {
		throw new Error('Materialized recurrence preview is required.');
	}
	const preview = plan.recurrence.preview;
	const successor = {
		operonId: preview.nextOperonId,
		locator: preview.nextLocator,
		checkbox: 'open' as const,
	};
	const existingSeriesStateIsNotAfter = verifyRuntimeMaterializedRecurrenceSeriesStatePostflightV1({
		expectedSourceTaskId: plan.prepared.task.operonId,
		expectedSourceFormat: 'inline',
		effectiveAt: '2026-07-24T12:00:00',
		sealedRepeatSeriesRevision: 'repeat-before',
		currentRepeatSeriesRevision: 'repeat-before',
		entry: {
			sourceTaskId: plan.prepared.task.operonId,
			sourceFormat: 'inline',
			updatedAt: '2026-07-24T12:00:01',
		},
	});
	assert.equal(
		existingSeriesStateIsNotAfter,
		false,
		'An existing series with matching ownership is still pre-state until its sealed revision changes.',
	);
	const committedSeriesStateIsAfter = verifyRuntimeMaterializedRecurrenceSeriesStatePostflightV1({
		expectedSourceTaskId: plan.prepared.task.operonId,
		expectedSourceFormat: 'inline',
		effectiveAt: '2026-07-24T12:00:00',
		sealedRepeatSeriesRevision: 'repeat-before',
		currentRepeatSeriesRevision: 'repeat-after',
		entry: {
			sourceTaskId: plan.prepared.task.operonId,
			sourceFormat: 'inline',
			updatedAt: '2026-07-24T12:00:01',
		},
	});
	assert.equal(committedSeriesStateIsAfter, true);
	assert.equal(
		classifyRuntimeMaterializedRecurrenceRecoveryPostflightV1({
			sourceMatches: true,
			archiveMatches: true,
			expectedOperonId: preview.nextOperonId,
			expectedLocator: preview.nextLocator,
			successor: null,
			hasDuplicateOperonIdConflict: false,
			statusIsOpen: true,
			repeatSeriesStateVerified: true,
		}),
		'other',
		'A source-written index miss must not classify the recurrence step as after.',
	);
	const sourceWrittenStateMissing = classifyRuntimeMaterializedRecurrenceRecoveryPostflightV1({
			sourceMatches: true,
			archiveMatches: true,
			expectedOperonId: preview.nextOperonId,
			expectedLocator: preview.nextLocator,
			successor,
			hasDuplicateOperonIdConflict: false,
			statusIsOpen: true,
			repeatSeriesStateVerified: existingSeriesStateIsNotAfter,
		});
	assert.equal(
		sourceWrittenStateMissing,
		'other',
		'A source-written recurrence with an unchanged existing-series revision must not checkpoint as after.',
	);
	assert.equal(
		classifyRuntimeMaterializedRecurrenceRecoveryPostflightV1({
			sourceMatches: true,
			archiveMatches: true,
			expectedOperonId: preview.nextOperonId,
			expectedLocator: preview.nextLocator,
			successor,
			hasDuplicateOperonIdConflict: false,
			statusIsOpen: true,
			repeatSeriesStateVerified: committedSeriesStateIsAfter,
		}),
		'after',
		'Only the exact indexed open successor with repeat-series state can checkpoint recovery.',
	);

	const calls: string[] = [];
	const checkpoints: string[] = [];
	const recovered = await executeRuntimeSemanticTransitionV1(
		plan,
		coordinatorPorts(calls),
		{
			completedStepIds: ['primary'],
			classifyUncheckpointedStep: stepId => Promise.resolve(
				stepId === 'recurrence' ? sourceWrittenStateMissing : 'before',
			),
			onStepCommitted: stepId => {
				checkpoints.push(stepId);
				return Promise.resolve();
			},
		},
	);
	assert.equal(recovered.status, 'outcome-unknown');
	assert.deepEqual(calls, []);
	assert.deepEqual(checkpoints, []);
});

test('postflight requires primary, recurrence, every ancestor, unpin, and project-serial evidence', async () => {
	const plan = await fullPlan();
	assert.equal(plan.recurrence?.preview.disposition, 'materialize');
	if (plan.recurrence?.preview.disposition !== 'materialize') {
		throw new Error('Materialized recurrence preview is required.');
	}
	const materializedRecurrenceEvidence = {
		disposition: 'created' as const,
		nextOperonId: plan.recurrence.preview.nextOperonId,
		nextLocator: plan.recurrence.preview.nextLocator,
		successor: {
			operonId: plan.recurrence.preview.nextOperonId,
			locator: plan.recurrence.preview.nextLocator,
			checkbox: 'open' as const,
		},
		hasDuplicateSuccessorOperonIdConflict: false,
		successorStatusIsOpen: true,
		sourceRevision: plan.recurrence.preview.plannedSourceRevision,
		committedSourceRevision: plan.recurrence.preview.plannedSourceRevision,
		stateVerified: true,
	};
	const completeEvidence = {
		primaryVerified: true,
		timer: {
			activeTrackerCleared: true,
			sessionStateVerified: true,
			activeTrackerRevision: 'tracker-final',
			committedActiveTrackerRevision: 'tracker-final',
		},
		recurrence: materializedRecurrenceEvidence,
		verifiedAncestorOperonIds: ['par0001', 'gra0001'],
		pinned: false,
		projectSerialRevision: 'a'.repeat(64),
		committedProjectSerialRevision: 'a'.repeat(64),
	};
	const complete = verifyRuntimeSemanticTransitionPostflightV1(plan, completeEvidence);
	assert.deepEqual(complete, { ok: true, failures: [] });
	assert.deepEqual(
		verifyRuntimeSemanticTransitionPostflightV1(plan, {
			...completeEvidence,
			recurrence: { ...materializedRecurrenceEvidence, successor: null },
		}),
		{ ok: false, failures: ['recurrence'] },
		'Final postflight must refuse a missing indexed successor even when repeat-series revision/state is valid.',
	);

	const unscopedPlan = {
		...plan,
		projectSerialGroup: null,
		atomicGroups: plan.atomicGroups.filter(group => group.groupId !== 'project-serial:global'),
		affectedResources: plan.affectedResources.filter(resource => resource.resourceKind !== 'project-serial'),
		predictedEffects: plan.predictedEffects.filter(effect => effect.resourceKind !== 'project-serial'),
	};
	assert.deepEqual(
		verifyRuntimeSemanticTransitionPostflightV1(unscopedPlan, {
			primaryVerified: true,
			timer: complete.ok ? {
				activeTrackerCleared: true,
				sessionStateVerified: true,
				activeTrackerRevision: 'tracker-final',
				committedActiveTrackerRevision: 'tracker-final',
			} : undefined,
			recurrence: {
				disposition: 'created',
				nextOperonId: plan.recurrence.preview.nextOperonId,
				nextLocator: plan.recurrence.preview.nextLocator,
				successor: {
					operonId: plan.recurrence.preview.nextOperonId,
					locator: plan.recurrence.preview.nextLocator,
					checkbox: 'open',
				},
				hasDuplicateSuccessorOperonIdConflict: false,
				successorStatusIsOpen: true,
				sourceRevision: plan.recurrence.preview.plannedSourceRevision,
				committedSourceRevision: plan.recurrence.preview.plannedSourceRevision,
				stateVerified: true,
			},
			verifiedAncestorOperonIds: ['par0001', 'gra0001'],
			pinned: false,
		}),
		{ ok: true, failures: [] },
	);

	const incomplete = verifyRuntimeSemanticTransitionPostflightV1(plan, {
		primaryVerified: false,
		verifiedAncestorOperonIds: ['par0001'],
		pinned: true,
		projectSerialRevision: 'a'.repeat(64),
		committedProjectSerialRevision: 'b'.repeat(64),
	});
	assert.deepEqual(incomplete, {
		ok: false,
		failures: ['primary', 'timer', 'recurrence', 'ancestors', 'pinned', 'project-serial'],
	});

	const endedPlan = await fullPlan('ended');
	assert.deepEqual(
		verifyRuntimeSemanticTransitionPostflightV1(endedPlan, {
			primaryVerified: true,
			timer: {
				activeTrackerCleared: true,
				sessionStateVerified: true,
				activeTrackerRevision: 'tracker-final',
				committedActiveTrackerRevision: 'tracker-final',
			},
			recurrence: { disposition: 'ended', stateVerified: true },
			verifiedAncestorOperonIds: ['par0001', 'gra0001'],
			pinned: false,
			projectSerialRevision: 'a'.repeat(64),
			committedProjectSerialRevision: 'a'.repeat(64),
		}),
		{ ok: true, failures: [] },
	);
});
