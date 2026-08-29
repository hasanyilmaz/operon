import assert from 'node:assert/strict';
import test from 'node:test';

import type { MutationPreviewRequestV1 } from '../../../src/agent-runtime/contracts/v1';
import { buildLivePropertyCatalogV1 } from '../../../src/agent-runtime/runtime/catalog-builder';
import {
	getRuntimeTaskFieldMutationPostflightRequirementsV1,
	buildRuntimeConversionAncestorPredictedEffectsV1,
	buildRuntimeTaskUpdateBatchEffectsV1,
	prepareRuntimeTaskFieldMutationV1,
	prepareRuntimeTaskUpdateBatchV1,
	refreshRuntimeInlineTaskUpdateSettlementEvidenceV1,
	reminderItemIdV1,
	resolveRuntimeInlineTaskUpdateSettlementEvidenceV1,
	resolveRuntimeInlineTaskUpdateSettlementRevisionV1,
	resolveRuntimeTaskFieldMutationPostflightEvidenceV1,
	type RuntimeExactTaskMutationSnapshotV1,
	type RuntimeTaskFieldMutationPreparationV1,
	verifyRuntimeTaskFieldMutationPrimaryPostflightV1,
} from '../../../src/agent-runtime/runtime/task-mutation-adapter';
import { sha256HexV1 } from '../../../src/agent-runtime/contracts/v1/canonical';
import { DEFAULT_SETTINGS } from '../../../src/types/settings';

const catalogResult = buildLivePropertyCatalogV1(structuredClone(DEFAULT_SETTINGS));
assert.equal(catalogResult.ok, true);
if (!catalogResult.ok) throw new Error('Default catalog is required by mutation adapter tests.');
const catalog = catalogResult.value;
const locator = { representation: 'inline' as const, filePath: 'Tasks.md', lineNumber: 2 };
const task: RuntimeExactTaskMutationSnapshotV1 = {
	operonId: 'abc1234',
	locator,
	description: 'Adapter fixture',
	checkbox: 'open',
	fieldValues: {
		status: `${DEFAULT_SETTINGS.pipelines[0].name}.${DEFAULT_SETTINGS.pipelines[0].statuses[0].label}`,
		priority: DEFAULT_SETTINGS.priorities[0].label,
		dateDue: '2026-07-26',
		reminderRules: 'dateDue.45m; invalid-legacy-token',
	},
	tags: ['fixture'],
	sourceContent: '# Tasks\n\n- [ ] Adapter fixture {{operonId:: abc1234}}\n',
	duplicate: false,
};

function request(
	mutationKind: MutationPreviewRequestV1['mutationKind'],
	capability: MutationPreviewRequestV1['capability'],
	spec: MutationPreviewRequestV1['spec'],
): MutationPreviewRequestV1 {
	return {
		contractVersion: 1,
		requestId: `adapter-${mutationKind}`,
		kind: 'mutation-preview',
		clientInstanceId: 'adapter-test',
		idempotencyKey: `adapter-${mutationKind}-key`,
		capability,
		mutationKind,
		target: { operonId: task.operonId, locator },
		spec,
		authorization: { basis: 'user-explicit-request' },
	};
}

test('general update resolves stable priority identity, task data, and rejects semantic fields', () => {
	const priority = catalog.taxonomy.priorities.at(-1);
	assert.ok(priority);
	const result = prepareRuntimeTaskFieldMutationV1(
		request('task.update', 'tasks.update.preview', {
			operation: 'update',
			changes: [
				{ field: 'description', valueType: 'text', value: 'Updated fixture' },
				{ field: 'priority', valueType: 'text', value: priority.id },
			],
		}),
		'2026-07-24T12:00:00.000Z',
		{ catalog, getTask: () => task },
	);
	assert.equal(result.ok, true);
	if (result.ok) {
		assert.equal(result.value.fieldValues['_description'], 'Updated fixture');
		assert.equal(result.value.fieldValues['priority'], priority.label);
		assert.equal(result.value.operation, 'update');
		assert.equal(result.value.noChange, false);
	}

	const rejected = prepareRuntimeTaskFieldMutationV1(
		request('task.update', 'tasks.update.preview', {
			operation: 'update',
			changes: [{ field: 'status', valueType: 'text', value: 'forged' }],
		}),
		'2026-07-24T12:00:00.000Z',
		{ catalog, getTask: () => task },
	);
	assert.equal(rejected.ok, false);
	if (!rejected.ok) assert.equal(rejected.code, 'field-not-writable');

	for (const [change, expected] of [
		[
			{ field: 'taskType', valueType: 'text' as const, value: 'Project' },
			'Project',
		],
		[
			{ field: 'taskImage', valueType: 'text' as const, value: 'https://example.test/task.png' },
			'https://example.test/task.png',
		],
		[
			{
				field: 'taskGallery',
				valueType: 'list' as const,
				value: ['Assets/one;detail.png', 'Assets/one;detail.png', 'https://example.test/two.png'] as string[],
			},
			'Assets/one\\;detail.png; https://example.test/two.png',
		],
	] as const) {
		const prepared = prepareRuntimeTaskFieldMutationV1(
			request('task.update', 'tasks.update.preview', {
				operation: 'update',
				changes: [change],
			}),
			'2026-07-24T12:00:00.000Z',
			{ catalog, getTask: () => task },
		);
		assert.equal(prepared.ok, true);
		if (prepared.ok) {
			assert.equal(prepared.value.fieldValues[change.field], expected);
			assert.equal(verifyRuntimeTaskFieldMutationPrimaryPostflightV1(
				prepared.value,
				{ ...task, fieldValues: { ...task.fieldValues, ...prepared.value.fieldValues } },
			), true);
		}
	}
});

test('File Task description changes fail closed without affecting supported update paths', () => {
	const fileLocator = { representation: 'file' as const, filePath: 'Tasks/Adapter fixture.md' };
	const fileTask: RuntimeExactTaskMutationSnapshotV1 = {
		...task,
		locator: fileLocator,
		description: 'Adapter fixture',
		sourceContent: [
			'---',
			'operonId: abc1234',
			`priority: ${task.fieldValues.priority}`,
			'---',
			'',
		].join('\n'),
	};
	const originalFileTask = structuredClone(fileTask);
	const fileRequest = (
		mutationKind: MutationPreviewRequestV1['mutationKind'],
		capability: MutationPreviewRequestV1['capability'],
		spec: MutationPreviewRequestV1['spec'],
	): MutationPreviewRequestV1 => ({
		...request(mutationKind, capability, spec),
		target: { operonId: fileTask.operonId, locator: fileLocator },
	});
	const ports = { catalog, getTask: () => fileTask };
	const fileTaskWithData: RuntimeExactTaskMutationSnapshotV1 = {
		...fileTask,
		fieldValues: {
			...fileTask.fieldValues,
			taskType: 'Reference',
			taskImage: 'Assets/cover.png',
			taskGallery: 'Assets/one\\;detail.png',
		},
	};
	const fileTaskDataUpdate = prepareRuntimeTaskFieldMutationV1(
		fileRequest('task.update', 'tasks.update.preview', {
			operation: 'update',
			changes: [
				{ field: 'taskType', valueType: 'text', value: 'Project' },
				{ field: 'taskImage', valueType: 'text', value: 'https://example.test/cover.png' },
				{
					field: 'taskGallery',
					valueType: 'list',
					value: ['Assets/one;detail.png', 'Assets/one;detail.png', 'https://example.test/two.png'],
				},
			],
		}),
		'2026-07-24T12:00:00.000Z',
		{ catalog, getTask: () => fileTaskWithData },
	);
	assert.equal(fileTaskDataUpdate.ok, true);
	if (fileTaskDataUpdate.ok) {
		assert.deepEqual({
			taskType: fileTaskDataUpdate.value.fieldValues.taskType,
			taskImage: fileTaskDataUpdate.value.fieldValues.taskImage,
			taskGallery: fileTaskDataUpdate.value.fieldValues.taskGallery,
		}, {
			taskType: 'Project',
			taskImage: 'https://example.test/cover.png',
			taskGallery: 'Assets/one\\;detail.png; https://example.test/two.png',
		});
	}
	const fileTaskDataClear = prepareRuntimeTaskFieldMutationV1(
		fileRequest('task.update', 'tasks.update.preview', {
			operation: 'update',
			changes: [
				{ operation: 'clear', field: 'taskType', valueType: 'text' },
				{ operation: 'clear', field: 'taskImage', valueType: 'text' },
				{ operation: 'clear', field: 'taskGallery', valueType: 'list' },
			],
		}),
		'2026-07-24T12:00:00.000Z',
		{ catalog, getTask: () => fileTaskWithData },
	);
	assert.equal(fileTaskDataClear.ok, true);
	if (fileTaskDataClear.ok) {
		assert.deepEqual({
			taskType: fileTaskDataClear.value.fieldValues.taskType,
			taskImage: fileTaskDataClear.value.fieldValues.taskImage,
			taskGallery: fileTaskDataClear.value.fieldValues.taskGallery,
		}, {
			taskType: '',
			taskImage: '',
			taskGallery: '',
		});
	}

	const changedDescription = prepareRuntimeTaskFieldMutationV1(
		fileRequest('task.update', 'tasks.update.preview', {
			operation: 'update',
			changes: [{ field: 'description', valueType: 'text', value: 'Renamed fixture' }],
		}),
		'2026-07-24T12:00:00.000Z',
		ports,
	);
	assert.equal(changedDescription.ok, false);
	if (!changedDescription.ok) {
		assert.equal(changedDescription.code, 'field-not-writable');
		assert.match(changedDescription.reason, /explicit rename contract/u);
	}
	assert.deepEqual(fileTask, originalFileTask, 'preview preparation must not mutate the File Task snapshot');

	const unchangedDescription = prepareRuntimeTaskFieldMutationV1(
		fileRequest('task.update', 'tasks.update.preview', {
			operation: 'update',
			changes: [{ field: 'description', valueType: 'text', value: fileTask.description }],
		}),
		'2026-07-24T12:00:00.000Z',
		ports,
	);
	assert.equal(unchangedDescription.ok, true);
	if (unchangedDescription.ok) {
		assert.equal(unchangedDescription.value.noChange, true);
		assert.deepEqual(unchangedDescription.value.fieldValues, {});
	}

	const priority = catalog.taxonomy.priorities.at(-1);
	assert.ok(priority);
	const supportedFileField = prepareRuntimeTaskFieldMutationV1(
		fileRequest('task.update', 'tasks.update.preview', {
			operation: 'update',
			changes: [
				{ field: 'description', valueType: 'text', value: fileTask.description },
				{ field: 'priority', valueType: 'text', value: priority.id },
			],
		}),
		'2026-07-24T12:00:00.000Z',
		ports,
	);
	assert.equal(supportedFileField.ok, true);
	if (supportedFileField.ok) {
		assert.equal(supportedFileField.value.noChange, false);
		assert.equal(supportedFileField.value.fieldValues['priority'], priority.label);
		assert.equal(supportedFileField.value.fieldValues['_description'], fileTask.description);
		assert.equal(typeof supportedFileField.value.fieldValues['datetimeModified'], 'string');
	}

	for (const changes of [
		[
			{ field: 'priority' as const, valueType: 'text' as const, value: priority.id },
			{ field: 'description' as const, valueType: 'text' as const, value: 'Renamed fixture' },
		],
		[
			{ field: 'description' as const, valueType: 'text' as const, value: 'Renamed fixture' },
			{ field: 'priority' as const, valueType: 'text' as const, value: priority.id },
		],
	]) {
		const mixed = prepareRuntimeTaskFieldMutationV1(
			fileRequest('task.update', 'tasks.update.preview', { operation: 'update', changes }),
			'2026-07-24T12:00:00.000Z',
			ports,
		);
		assert.equal(mixed.ok, false, 'a refused rename must reject the complete update atomically');
		if (!mixed.ok) assert.equal(mixed.code, 'field-not-writable');
	}

	const invalidDescription = prepareRuntimeTaskFieldMutationV1(
		fileRequest('task.update', 'tasks.update.preview', {
			operation: 'update',
			changes: [{ field: 'description', valueType: 'text', value: 'Invalid\nrename' }],
		}),
		'2026-07-24T12:00:00.000Z',
		ports,
	);
	assert.equal(invalidDescription.ok, false);
	if (!invalidDescription.ok) assert.equal(invalidDescription.code, 'invalid-request');

	const terminal = catalog.taxonomy.pipelines
		.flatMap(pipeline => pipeline.statuses)
		.find(status => status.isFinished);
	assert.ok(terminal);
	const transitionRename = prepareRuntimeTaskFieldMutationV1(
		fileRequest('task.transition', 'tasks.transition.preview', {
			operation: 'transition',
			targetStatusId: terminal.id,
			changes: [{ field: 'description', valueType: 'text', value: 'Renamed fixture' }],
		}),
		'2026-07-24T12:00:00.000Z',
		ports,
	);
	assert.equal(transitionRename.ok, false);
	if (!transitionRename.ok) assert.equal(transitionRename.code, 'field-not-writable');
	assert.deepEqual(fileTask, originalFileTask);
});

test('conversion ancestor effects exclude source groups and coalesce shared ancestor files', () => {
	const effects = buildRuntimeConversionAncestorPredictedEffectsV1(
		['Daily/Today.md', 'Converted/Task.md'],
		[
			'Daily/Today.md',
			'Parents/Project.md',
			'Parents/Project.md',
			'Parents/Area.md',
		],
	);
	assert.deepEqual(effects, [{
		resourceKind: 'task-source',
		resourceKey: 'Parents/Project.md',
		action: 'update',
		summary: 'Refresh sealed conversion ancestor timestamps and hierarchy aggregates.',
	}, {
		resourceKind: 'task-source',
		resourceKey: 'Parents/Area.md',
		action: 'update',
		summary: 'Refresh sealed conversion ancestor timestamps and hierarchy aggregates.',
	}]);
	assert.equal(
		new Set(effects.map(effect => `${effect.resourceKind}\0${effect.resourceKey}\0${effect.action}`)).size,
		effects.length,
	);
});

test('general update canonicalizes built-in and custom datetimes before no-op and postflight', () => {
	const catalogWithCustomDatetime = {
		...catalog,
		fields: [...catalog.fields, {
			canonicalKey: 'customDatetime',
			displayName: 'Custom datetime',
			description: 'Synthetic custom datetime field.',
			valueType: 'datetime' as const,
			source: 'custom' as const,
			mappingStatus: 'mapped' as const,
			readable: true,
			mutationClass: 'general-update' as const,
			mutationOwner: 'tasks.update',
			requiresStableTaxonomyId: false,
		}],
	};
	const update = prepareRuntimeTaskFieldMutationV1(
		request('task.update', 'tasks.update.preview', {
			operation: 'update',
			changes: [
				{ field: 'datetimeStart', valueType: 'datetime', value: '2026-07-26T09:30' },
				{ field: 'customDatetime', valueType: 'datetime', value: '2026-07-26T10:45' },
			],
		}),
		'2026-07-24T12:00:00.000Z',
		{ catalog: catalogWithCustomDatetime, getTask: () => task },
	);
	assert.equal(update.ok, true);
	if (!update.ok) return;
	assert.equal(update.value.fieldValues.datetimeStart, '2026-07-26T09:30:00');
	assert.equal(update.value.fieldValues.customDatetime, '2026-07-26T10:45:00');
	const committed = {
		...task,
		fieldValues: { ...task.fieldValues, ...update.value.fieldValues },
	};
	assert.equal(verifyRuntimeTaskFieldMutationPrimaryPostflightV1(
		update.value,
		committed,
	), true);

	const replay = prepareRuntimeTaskFieldMutationV1(
		request('task.update', 'tasks.update.preview', {
			operation: 'update',
			changes: [
				{ field: 'datetimeStart', valueType: 'datetime', value: '2026-07-26T09:30' },
				{ field: 'customDatetime', valueType: 'datetime', value: '2026-07-26T10:45' },
			],
		}),
		'2026-07-24T12:00:00.000Z',
		{ catalog: catalogWithCustomDatetime, getTask: () => committed },
	);
	assert.equal(replay.ok, true);
	if (replay.ok) assert.equal(replay.value.noChange, true);
});

test('update-batch prepares ordered same-source inline updates and sealed effects', () => {
	const secondTask: RuntimeExactTaskMutationSnapshotV1 = {
		...task,
		operonId: 'def5678',
		locator: { ...locator, lineNumber: 3 },
		description: 'Second fixture',
	};
	const batchRequest: MutationPreviewRequestV1 = {
		contractVersion: 1,
		requestId: 'adapter-update-batch',
		kind: 'mutation-preview',
		clientInstanceId: 'adapter-test',
		idempotencyKey: 'adapter-update-batch-key',
		capability: 'tasks.update.preview',
		mutationKind: 'task.update',
		spec: {
			operation: 'update-batch',
			items: [
				{
					itemRef: 'first',
					target: { operonId: task.operonId, locator: task.locator },
					changes: [
						{ field: 'description', valueType: 'text', value: 'Updated first' },
						{ field: 'datetimeStart', valueType: 'datetime', value: '2026-07-26T09:30' },
					],
				},
				{
					itemRef: 'second',
					target: { operonId: secondTask.operonId, locator: secondTask.locator },
					changes: [{ field: 'note', valueType: 'text', value: 'Updated note' }],
				},
			],
		},
		authorization: { basis: 'user-explicit-request' },
	};
	const result = prepareRuntimeTaskUpdateBatchV1(
		batchRequest,
		'2026-07-24T12:00:00.000Z',
		{
			catalog,
			getTask: operonId => (
				operonId === task.operonId ? task
					: operonId === secondTask.operonId ? secondTask
						: null
			),
		},
	);
	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.equal(result.value.filePath, 'Tasks.md');
	assert.deepEqual(result.value.items.map(item => item.itemRef), ['first', 'second']);
	assert.equal(
		result.value.items[0].preparation.fieldValues.datetimeStart,
		'2026-07-26T09:30:00',
	);
	const plannedSourceDigest = sha256HexV1('planned source');
	const effects = buildRuntimeTaskUpdateBatchEffectsV1(result.value, plannedSourceDigest);
	assert.deepEqual(effects.map(effect => effect.operonId), ['abc1234', 'def5678']);
	assert.ok(effects.every(effect => effect.plannedSourceDigest === plannedSourceDigest));
});

test('update-batch rejects file, cross-source, and duplicate exact targets', () => {
	const batchBase = {
		contractVersion: 1 as const,
		requestId: 'adapter-update-batch-reject',
		kind: 'mutation-preview' as const,
		clientInstanceId: 'adapter-test',
		idempotencyKey: 'adapter-update-batch-reject-key',
		capability: 'tasks.update.preview' as const,
		mutationKind: 'task.update' as const,
		authorization: { basis: 'user-explicit-request' as const },
	};
	const duplicate = prepareRuntimeTaskUpdateBatchV1({
		...batchBase,
		spec: {
			operation: 'update-batch',
			items: ['first', 'second'].map(itemRef => ({
				itemRef,
				target: { operonId: task.operonId, locator: task.locator },
				changes: [{ field: 'note' as const, valueType: 'text' as const, value: itemRef }],
			})),
		},
	}, '2026-07-24T12:00:00.000Z', { catalog, getTask: () => task });
	assert.equal(duplicate.ok, false);

	const other: RuntimeExactTaskMutationSnapshotV1 = {
		...task,
		operonId: 'def5678',
		locator: { ...locator, filePath: 'Other.md' },
	};
	const crossSource = prepareRuntimeTaskUpdateBatchV1({
		...batchBase,
		spec: {
			operation: 'update-batch',
			items: [
				{ itemRef: 'first', target: { operonId: task.operonId, locator: task.locator }, changes: [{ field: 'note', valueType: 'text', value: 'one' }] },
				{ itemRef: 'second', target: { operonId: other.operonId, locator: other.locator }, changes: [{ field: 'note', valueType: 'text', value: 'two' }] },
			],
		},
	}, '2026-07-24T12:00:00.000Z', {
		catalog,
		getTask: operonId => operonId === task.operonId ? task : other,
	});
	assert.equal(crossSource.ok, false);
});

test('general update rejects duplicate fields and treats an exact replay as a no-op', () => {
	const duplicate = prepareRuntimeTaskFieldMutationV1(
		request('task.update', 'tasks.update.preview', {
			operation: 'update',
			changes: [
				{ field: 'description', valueType: 'text', value: 'One' },
				{ field: 'description', valueType: 'text', value: 'Two' },
			],
		}),
		'2026-07-24T12:00:00.000Z',
		{ catalog, getTask: () => task },
	);
	assert.equal(duplicate.ok, false);
	if (!duplicate.ok) assert.equal(duplicate.code, 'invalid-request');

	const replay = prepareRuntimeTaskFieldMutationV1(
		request('task.update', 'tasks.update.preview', {
			operation: 'update',
			changes: [{ field: 'description', valueType: 'text', value: task.description }],
		}),
		'2026-07-24T12:00:00.000Z',
		{ catalog, getTask: () => task },
	);
	assert.equal(replay.ok, true);
	if (replay.ok) {
		assert.equal(replay.value.noChange, true);
		assert.deepEqual(replay.value.fieldValues, {});
		assert.match(replay.value.summary, /No durable task-source change/u);
	}
});

test('general update clears allowlisted fields without changing the legacy set shape', () => {
	const cleared = prepareRuntimeTaskFieldMutationV1(
		request('task.update', 'tasks.update.preview', {
			operation: 'update',
			changes: [
				{ operation: 'clear', field: 'dateDue', valueType: 'date' },
				{ operation: 'clear', field: 'priority', valueType: 'text' },
			],
		}),
		'2026-07-24T12:00:00.000Z',
		{ catalog, getTask: () => task },
	);
	assert.equal(cleared.ok, true);
	if (cleared.ok) {
		assert.equal(cleared.value.fieldValues['dateDue'], '');
		assert.equal(cleared.value.fieldValues['priority'], '');
		assert.equal(cleared.value.noChange, false);
	}

	const taskWithData = {
		...task,
		fieldValues: {
			...task.fieldValues,
			taskType: 'Reference',
			taskImage: '![[Assets/cover.png]]',
			taskGallery: 'Assets/one\\;detail.png; https://example.test/two.png',
		},
	};
	const clearedTaskData = prepareRuntimeTaskFieldMutationV1(
		request('task.update', 'tasks.update.preview', {
			operation: 'update',
			changes: [
				{ operation: 'clear', field: 'taskType', valueType: 'text' },
				{ operation: 'clear', field: 'taskImage', valueType: 'text' },
				{ operation: 'clear', field: 'taskGallery', valueType: 'list' },
			],
		}),
		'2026-07-24T12:00:00.000Z',
		{ catalog, getTask: () => taskWithData },
	);
	assert.equal(clearedTaskData.ok, true);
	if (clearedTaskData.ok) {
		assert.deepEqual({
			taskType: clearedTaskData.value.fieldValues.taskType,
			taskImage: clearedTaskData.value.fieldValues.taskImage,
			taskGallery: clearedTaskData.value.fieldValues.taskGallery,
		}, {
			taskType: '',
			taskImage: '',
			taskGallery: '',
		});
		assert.equal(clearedTaskData.value.noChange, false);
	}

	const description = prepareRuntimeTaskFieldMutationV1(
		request('task.update', 'tasks.update.preview', {
			operation: 'update',
			changes: [{ operation: 'clear', field: 'description', valueType: 'text' }],
		}),
		'2026-07-24T12:00:00.000Z',
		{ catalog, getTask: () => task },
	);
	assert.equal(description.ok, false);
	if (!description.ok) assert.equal(description.code, 'field-not-writable');

	const absent = prepareRuntimeTaskFieldMutationV1(
		request('task.update', 'tasks.update.preview', {
			operation: 'update',
			changes: [{ operation: 'clear', field: 'note', valueType: 'text' }],
		}),
		'2026-07-24T12:00:00.000Z',
		{ catalog, getTask: () => task },
	);
	assert.equal(absent.ok, true);
	if (absent.ok) assert.equal(absent.value.noChange, true);
});

test('general update rejects task-line injection through description and tags', () => {
	const descriptionInjection = prepareRuntimeTaskFieldMutationV1(
		request('task.update', 'tasks.update.preview', {
			operation: 'update',
			changes: [{
				field: 'description',
				valueType: 'text',
				value: 'Safe title\n- [ ] injected sibling {{operonId:: bad0001}}',
			}],
		}),
		'2026-07-24T12:00:00.000Z',
		{ catalog, getTask: () => task },
	);
	assert.equal(descriptionInjection.ok, false);
	if (!descriptionInjection.ok) assert.equal(descriptionInjection.code, 'invalid-request');

	const tagInjection = prepareRuntimeTaskFieldMutationV1(
		request('task.update', 'tasks.update.preview', {
			operation: 'update',
			changes: [{
				field: 'tags',
				valueType: 'list',
				value: ['safe', 'bad tag\n- [ ] injected'],
			}],
		}),
		'2026-07-24T12:00:00.000Z',
		{ catalog, getTask: () => task },
	);
	assert.equal(tagInjection.ok, false);
	if (!tagInjection.ok) assert.equal(tagInjection.code, 'invalid-request');
});

test('scheduled date applies one-shot scheduled status and exposes its semantic effect', () => {
	const scheduled = catalog.taxonomy.pipelines[0].statuses.find(status => status.isScheduledTarget);
	assert.ok(scheduled);
	const result = prepareRuntimeTaskFieldMutationV1(
		request('task.update', 'tasks.update.preview', {
			operation: 'update',
			changes: [{ field: 'dateScheduled', valueType: 'date', value: '2026-07-25' }],
		}),
		'2026-07-24T12:00:00.000Z',
		{ catalog, getTask: () => task },
	);
	assert.equal(result.ok, true);
	if (result.ok) {
		assert.equal(result.value.fieldValues['dateScheduled'], '2026-07-25');
		assert.equal(result.value.fieldValues['status'], `${DEFAULT_SETTINGS.pipelines[0].name}.${scheduled.label}`);
		assert.equal(result.value.fieldValues['_checkbox'], 'open');
		assert.equal(result.value.scheduledAutomation?.toStatusId, scheduled.id);
	}

	const alreadyScheduled = {
		...task,
		fieldValues: { ...task.fieldValues, dateScheduled: '2026-07-24' },
	};
	const oneShot = prepareRuntimeTaskFieldMutationV1(
		request('task.update', 'tasks.update.preview', {
			operation: 'update',
			changes: [{ field: 'dateScheduled', valueType: 'date', value: '2026-07-25' }],
		}),
		'2026-07-24T12:00:00.000Z',
		{ catalog, getTask: () => alreadyScheduled },
	);
	assert.equal(oneShot.ok, true);
	if (oneShot.ok) assert.equal(oneShot.value.scheduledAutomation, undefined);
});

test('scheduled-status automation remains available with active or missing dependency blockers', () => {
	const blocked = {
		...task,
		fieldValues: { ...task.fieldValues, blockedBy: 'blk0001' },
	};
	const scheduled = catalog.taxonomy.pipelines[0].statuses.find(status => status.isScheduledTarget);
	assert.ok(scheduled);
	const result = prepareRuntimeTaskFieldMutationV1(
		request('task.update', 'tasks.update.preview', {
			operation: 'update',
			changes: [{ field: 'dateScheduled', valueType: 'date', value: '2026-07-25' }],
		}),
		'2026-07-24T12:00:00.000Z',
		{ catalog, getTask: operonId => operonId === task.operonId ? blocked : null },
	);
	assert.equal(result.ok, true);
	if (result.ok) {
		assert.equal(result.value.fieldValues['dateScheduled'], '2026-07-25');
		assert.equal(result.value.fieldValues['status'], `${DEFAULT_SETTINGS.pipelines[0].name}.${scheduled.label}`);
		assert.equal(result.value.fieldValues['_checkbox'], 'open');
		assert.equal(result.value.scheduledAutomation?.toStatusId, scheduled.id);
	}
});

test('scheduled-status transition accepts its scheduled date companion while blocked', () => {
	const current = catalog.taxonomy.pipelines[0].statuses[0];
	const scheduled = catalog.taxonomy.pipelines[0].statuses.find(status => status.isScheduledTarget);
	assert.ok(current);
	assert.ok(scheduled);
	const otherOpen = catalog.taxonomy.pipelines[0].statuses.find(status => (
		status.id !== current.id
		&& !status.isScheduledTarget
		&& !status.isFinished
		&& !status.isCancelled
	));
	assert.ok(otherOpen);
	const blocked = {
		...task,
		fieldValues: { ...task.fieldValues, blockedBy: 'blk0001' },
	};
	const result = prepareRuntimeTaskFieldMutationV1(
		request('task.transition', 'tasks.transition.preview', {
			operation: 'transition',
			targetStatusId: scheduled.id,
			expectedStatusId: current.id,
			changes: [{ field: 'dateScheduled', valueType: 'date', value: '2026-07-25' }],
		}),
		'2026-07-24T12:00:00.000Z',
		{ catalog, getTask: operonId => operonId === task.operonId ? blocked : null },
	);
	assert.equal(result.ok, true);
	if (result.ok) {
		assert.equal(result.value.fieldValues['dateScheduled'], '2026-07-25');
		assert.equal(result.value.fieldValues['status'], `${DEFAULT_SETTINGS.pipelines[0].name}.${scheduled.label}`);
		assert.equal(result.value.fieldValues['_checkbox'], 'open');
	}

	const alreadyScheduled = prepareRuntimeTaskFieldMutationV1(
		request('task.transition', 'tasks.transition.preview', {
			operation: 'transition',
			targetStatusId: scheduled.id,
			expectedStatusId: current.id,
			changes: [{ field: 'dateScheduled', valueType: 'date', value: '2026-07-25' }],
		}),
		'2026-07-24T12:00:00.000Z',
		{
			catalog,
			getTask: operonId => operonId === task.operonId
				? { ...blocked, fieldValues: { ...blocked.fieldValues, dateScheduled: '2026-07-24' } }
				: null,
		},
	);
	assert.equal(alreadyScheduled.ok, false);

	const unrelatedTransition = prepareRuntimeTaskFieldMutationV1(
		request('task.transition', 'tasks.transition.preview', {
			operation: 'transition',
			targetStatusId: otherOpen.id,
			expectedStatusId: current.id,
			changes: [{ field: 'dateScheduled', valueType: 'date', value: '2026-07-25' }],
		}),
		'2026-07-24T12:00:00.000Z',
		{ catalog, getTask: operonId => operonId === task.operonId ? blocked : null },
	);
	assert.equal(unrelatedTransition.ok, false);
});

test('reminder item IDs bind index and raw value while preserving invalid siblings', () => {
	const expectedValue = 'dateDue.45m';
	const result = prepareRuntimeTaskFieldMutationV1(
		request('task.reminder-item', 'tasks.reminder.preview', {
			operation: 'replace',
			collection: 'reminderRules',
			itemId: reminderItemIdV1(0, expectedValue),
			expectedValue,
			value: 'dateDue.30m',
		}),
		'2026-07-24T12:00:00.000Z',
		{ catalog, getTask: () => task },
	);
	assert.equal(result.ok, true);
	if (result.ok) {
		assert.equal(result.value.fieldValues['reminderRules'], 'dateDue.30m; invalid-legacy-token');
		assert.equal(result.value.reminder?.collection, 'reminderRules');
		assert.equal(result.value.reminder?.itemOperation, 'replace');
	}

	const stale = prepareRuntimeTaskFieldMutationV1(
		request('task.reminder-item', 'tasks.reminder.preview', {
			operation: 'remove',
			collection: 'reminderRules',
			itemId: reminderItemIdV1(1, 'different'),
			expectedValue: 'different',
		}),
		'2026-07-24T12:00:00.000Z',
		{ catalog, getTask: () => task },
	);
	assert.equal(stale.ok, false);
	if (!stale.ok) assert.equal(stale.code, 'stale-source');
});

test('reminder mutations reject duplicate, past, and missing-anchor additions', () => {
	const duplicate = prepareRuntimeTaskFieldMutationV1(
		request('task.reminder-item', 'tasks.reminder.preview', {
			operation: 'add',
			collection: 'reminderRules',
			value: 'dateDue.45m',
		}),
		'2026-07-24T12:00:00.000Z',
		{ catalog, getTask: () => task },
	);
	assert.equal(duplicate.ok, false);
	if (!duplicate.ok) assert.equal(duplicate.code, 'invalid-request');

	const past = prepareRuntimeTaskFieldMutationV1(
		request('task.reminder-item', 'tasks.reminder.preview', {
			operation: 'add',
			collection: 'reminderDatetimes',
			value: '2026-07-24T11:59:59',
		}),
		'2026-07-24T12:00:00',
		{ catalog, getTask: () => task },
	);
	assert.equal(past.ok, false);
	if (!past.ok) assert.equal(past.code, 'invalid-request');

	const missingAnchorTask = {
		...task,
		fieldValues: { ...task.fieldValues, dateDue: '' },
	};
	const missingAnchor = prepareRuntimeTaskFieldMutationV1(
		request('task.reminder-item', 'tasks.reminder.preview', {
			operation: 'add',
			collection: 'reminderRules',
			value: 'dateDue.30m',
		}),
		'2026-07-24T12:00:00.000Z',
		{ catalog, getTask: () => missingAnchorTask },
	);
	assert.equal(missingAnchor.ok, false);
	if (!missingAnchor.ok) {
		assert.equal(missingAnchor.code, 'invalid-request');
		assert.match(missingAnchor.reason, /dateDue/u);
	}
});

test('reminder removal permits an invalid legacy token and replacement no-op stays durable-write free', () => {
	const invalidValue = 'invalid-legacy-token';
	const removal = prepareRuntimeTaskFieldMutationV1(
		request('task.reminder-item', 'tasks.reminder.preview', {
			operation: 'remove',
			collection: 'reminderRules',
			itemId: reminderItemIdV1(1, invalidValue),
			expectedValue: invalidValue,
		}),
		'2026-07-24T12:00:00.000Z',
		{ catalog, getTask: () => task },
	);
	assert.equal(removal.ok, true);
	if (removal.ok) {
		assert.equal(removal.value.fieldValues['reminderRules'], 'dateDue.45m');
		assert.equal(removal.value.noChange, false);
	}

	const noChange = prepareRuntimeTaskFieldMutationV1(
		request('task.reminder-item', 'tasks.reminder.preview', {
			operation: 'replace',
			collection: 'reminderRules',
			itemId: reminderItemIdV1(0, 'dateDue.45m'),
			expectedValue: 'dateDue.45m',
			value: 'dateDue.45m',
		}),
		'2026-07-24T12:00:00.000Z',
		{ catalog, getTask: () => task },
	);
	assert.equal(noChange.ok, true);
	if (noChange.ok) {
		assert.equal(noChange.value.noChange, true);
		assert.deepEqual(noChange.value.fieldValues, {});
	}
});

test('semantic transition resolves one stable status and derives terminal state', () => {
	const terminal = catalog.taxonomy.pipelines
		.flatMap(pipeline => pipeline.statuses)
		.find(status => status.isFinished);
	assert.ok(terminal);
	const result = prepareRuntimeTaskFieldMutationV1(
		request('task.transition', 'tasks.transition.preview', {
			operation: 'transition',
			targetStatusId: terminal.id,
			changes: [
				{ field: 'description', valueType: 'text', value: 'Transitioned fixture' },
				{ field: 'tags', valueType: 'list', value: ['fixture', 'done'] },
			],
		}),
		'2026-07-24T12:00:00.000Z',
		{ catalog, getTask: () => task },
	);
	assert.equal(result.ok, true);
	if (result.ok) {
		assert.equal(result.value.fieldValues['_checkbox'], 'done');
		assert.equal(result.value.fieldValues['dateCompleted'], '2026-07-24');
		assert.equal(result.value.fieldValues['dateCancelled'], '');
		assert.equal(result.value.fieldValues['_description'], 'Transitioned fixture');
		assert.equal(result.value.fieldValues['_tags'], 'fixture; done');
		assert.equal(result.value.operation, 'transition');
		assert.equal(result.value.transition?.terminal, true);
		assert.equal(result.value.transition?.toCheckbox, 'done');
	}
});

test('semantic transition enforces expected status and clears terminal dates on reopen', () => {
	const terminal = catalog.taxonomy.pipelines
		.flatMap(pipeline => pipeline.statuses)
		.find(status => status.isFinished);
	const open = catalog.taxonomy.pipelines
		.flatMap(pipeline => pipeline.statuses)
		.find(status => !status.isFinished && !status.isCancelled);
	assert.ok(terminal);
	assert.ok(open);
	const terminalTask = {
		...task,
		checkbox: 'done' as const,
		fieldValues: {
			...task.fieldValues,
			status: `${DEFAULT_SETTINGS.pipelines[0].name}.${terminal.label}`,
			dateCompleted: '2026-07-23',
		},
	};
	const stale = prepareRuntimeTaskFieldMutationV1(
		request('task.transition', 'tasks.transition.preview', {
			operation: 'transition',
			targetStatusId: open.id,
			expectedStatusId: 'st_missing',
		}),
		'2026-07-24T12:00:00.000Z',
		{ catalog, getTask: () => terminalTask },
	);
	assert.equal(stale.ok, false);
	if (!stale.ok) assert.equal(stale.code, 'stale-source');

	const reopened = prepareRuntimeTaskFieldMutationV1(
		request('task.transition', 'tasks.transition.preview', {
			operation: 'transition',
			targetStatusId: open.id,
			expectedStatusId: terminal.id,
		}),
		'2026-07-24T12:00:00.000Z',
		{ catalog, getTask: () => terminalTask },
	);
	assert.equal(reopened.ok, true);
	if (reopened.ok) {
		assert.equal(reopened.value.fieldValues['_checkbox'], 'open');
		assert.equal(reopened.value.fieldValues['dateCompleted'], '');
		assert.equal(reopened.value.fieldValues['dateCancelled'], '');
		assert.equal(reopened.value.transition?.fromStatusId, terminal.id);
		assert.equal(reopened.value.transition?.toStatusId, open.id);
	}
});

test('semantic transition reports canonical compound effects', () => {
	const terminal = catalog.taxonomy.pipelines
		.flatMap(pipeline => pipeline.statuses)
		.find(status => status.isFinished);
	assert.ok(terminal);
	const recurringTimedTask = {
		...task,
		activeTimerStart: '2026-07-24T11:00:00',
		fieldValues: {
			...task.fieldValues,
			repeat: 'FREQ=WEEKLY',
			parentTask: 'par0001',
		},
	};
	const result = prepareRuntimeTaskFieldMutationV1(
		request('task.transition', 'tasks.transition.preview', {
			operation: 'transition',
			targetStatusId: terminal.id,
		}),
		'2026-07-24T12:00:00.000Z',
		{ catalog, getTask: () => recurringTimedTask },
	);
	assert.equal(result.ok, true);
	if (result.ok) {
		assert.equal(result.value.parentOperonId, 'par0001');
		assert.equal(result.value.transition?.finalizeActiveTimer, true);
		assert.equal(result.value.transition?.materializeRecurrence, true);
		assert.equal(
			result.value.transition?.autoUnpin,
			catalog.policies.automation.pinnedDockAutoUnpinFinished,
		);
		assert.deepEqual(
			getRuntimeTaskFieldMutationPostflightRequirementsV1(result.value),
			{
				primaryTaskState: true,
				parentModified: true,
				reminderSchedulerSettled: false,
				scheduledAutomationSettled: false,
				timerFinalized: true,
				recurrenceMaterialized: true,
				finishedTaskUnpinned: catalog.policies.automation.pinnedDockAutoUnpinFinished,
			},
		);
	}
});

test('semantic transition fails closed for active dependencies but accepts resolved blockers', () => {
	const targetStatus = catalog.taxonomy.pipelines
		.flatMap(pipeline => pipeline.statuses)
		.find(status => status.isFinished);
	const finishedStatus = targetStatus;
	assert.ok(targetStatus);
	assert.ok(finishedStatus);
	const blocked = {
		...task,
		fieldValues: { ...task.fieldValues, blockedBy: 'blk0001' },
	};
	const activeBlocker: RuntimeExactTaskMutationSnapshotV1 = {
		...task,
		operonId: 'blk0001',
		description: 'Active blocker',
	};
	const blockedResult = prepareRuntimeTaskFieldMutationV1(
		request('task.transition', 'tasks.transition.preview', {
			operation: 'transition',
			targetStatusId: targetStatus.id,
		}),
		'2026-07-24T12:00:00.000Z',
		{
			catalog,
			getTask: operonId => operonId === task.operonId ? blocked : activeBlocker,
		},
	);
	assert.equal(blockedResult.ok, false);
	if (!blockedResult.ok) {
		assert.equal(blockedResult.code, 'invalid-request');
		assert.match(blockedResult.reason, /blk0001/u);
	}

	const resolvedBlocker: RuntimeExactTaskMutationSnapshotV1 = {
		...activeBlocker,
		checkbox: 'done',
		fieldValues: {
			...activeBlocker.fieldValues,
			status: `${DEFAULT_SETTINGS.pipelines[0].name}.${finishedStatus.label}`,
			dateCompleted: '2026-07-24',
		},
	};
	const accepted = prepareRuntimeTaskFieldMutationV1(
		request('task.transition', 'tasks.transition.preview', {
			operation: 'transition',
			targetStatusId: targetStatus.id,
		}),
		'2026-07-24T12:00:00.000Z',
		{
			catalog,
			getTask: operonId => operonId === task.operonId ? blocked : resolvedBlocker,
		},
	);
	assert.equal(accepted.ok, true);
});

test('semantic transition detects an inverse blocking edge without hydrating task sources', () => {
	const targetStatus = catalog.taxonomy.pipelines
		.flatMap(pipeline => pipeline.statuses)
		.find(status => status.isFinished);
	assert.ok(targetStatus);
	const inverseBlocker = {
		operonId: 'inv0001',
		checkbox: 'open' as const,
		fieldValues: {
			status: task.fieldValues['status'],
			blocking: task.operonId,
		},
	};
	const result = prepareRuntimeTaskFieldMutationV1(
		request('task.transition', 'tasks.transition.preview', {
			operation: 'transition',
			targetStatusId: targetStatus.id,
		}),
		'2026-07-24T12:00:00.000Z',
		{
			catalog,
			getTask: operonId => operonId === task.operonId ? task : null,
			getDependencyTask: operonId => operonId === inverseBlocker.operonId ? inverseBlocker : null,
			getAllDependencyTasks: () => [inverseBlocker],
		},
	);
	assert.equal(result.ok, false);
	if (!result.ok) assert.match(result.reason, /inv0001/u);
});

test('primary postflight verifies exact locator, duplicate state, pseudo-fields, and field values', () => {
	const priority = catalog.taxonomy.priorities.at(-1);
	assert.ok(priority);
	const result = prepareRuntimeTaskFieldMutationV1(
		request('task.update', 'tasks.update.preview', {
			operation: 'update',
			changes: [
				{ field: 'description', valueType: 'text', value: 'Postflight fixture' },
				{ field: 'tags', valueType: 'list', value: ['one', 'two'] },
				{ field: 'priority', valueType: 'text', value: priority.id },
			],
		}),
		'2026-07-24T12:00:00.000Z',
		{ catalog, getTask: () => task },
	);
	assert.equal(result.ok, true);
	if (!result.ok) return;
	const indexedAfter: RuntimeExactTaskMutationSnapshotV1 = {
		...task,
		description: 'Postflight fixture',
		tags: ['one', 'two'],
		fieldValues: {
			...task.fieldValues,
			priority: priority.label,
			datetimeModified: result.value.fieldValues['datetimeModified'],
		},
	};
	assert.equal(
		verifyRuntimeTaskFieldMutationPrimaryPostflightV1(result.value, indexedAfter),
		true,
	);
	assert.equal(
		verifyRuntimeTaskFieldMutationPrimaryPostflightV1(
			result.value,
			{ ...indexedAfter, duplicate: true },
		),
		false,
	);
	assert.equal(
		verifyRuntimeTaskFieldMutationPrimaryPostflightV1(
			result.value,
			{ ...indexedAfter, description: 'Drifted' },
		),
		false,
	);
	assert.equal(
		verifyRuntimeTaskFieldMutationPrimaryPostflightV1(
			result.value,
			{
				...indexedAfter,
				locator: { ...locator, lineNumber: locator.lineNumber + 1 },
			},
		),
		false,
	);
});

test('File Task postflight admits a later effective mtime only with the exact committed source revision', () => {
	const priority = catalog.taxonomy.priorities.at(-1);
	assert.ok(priority);
	const fileLocator = {
		representation: 'file' as const,
		filePath: 'Tasks/File boundary fixture.md',
	};
	const fileTask: RuntimeExactTaskMutationSnapshotV1 = {
		...task,
		locator: fileLocator,
		description: 'File boundary fixture',
		sourceContent: [
			'---',
			'operonId: abc1234',
			`priority: ${task.fieldValues.priority}`,
			'datetimeModified: 2026-07-24T11:59:59',
			'---',
			'',
		].join('\n'),
	};
	const result = prepareRuntimeTaskFieldMutationV1(
		{
			...request('task.update', 'tasks.update.preview', {
				operation: 'update',
				changes: [{ field: 'priority', valueType: 'text', value: priority.id }],
			}),
			target: { operonId: fileTask.operonId, locator: fileLocator },
		},
		'2026-07-24T12:00:00.000Z',
		{ catalog, getTask: () => fileTask },
	);
	assert.equal(result.ok, true);
	if (!result.ok) return;
	const committedSourceRevision = 'a'.repeat(64);
	const expectedModified = result.value.fieldValues['datetimeModified'];
	assert.match(expectedModified, /:00$/u);
	const indexedAfter: RuntimeExactTaskMutationSnapshotV1 = {
		...fileTask,
		fieldValues: {
			...fileTask.fieldValues,
			priority: priority.label,
			// Deterministically model the physical write crossing into the next
			// second, so YAML's effective mtime is later than the sealed value.
			datetimeModified: `${expectedModified.slice(0, -2)}01`,
		},
	};
	assert.equal(
		verifyRuntimeTaskFieldMutationPrimaryPostflightV1(result.value, indexedAfter),
		false,
		'A later YAML timestamp is not trusted without exact source-revision evidence.',
	);
	assert.equal(
		verifyRuntimeTaskFieldMutationPrimaryPostflightV1(result.value, indexedAfter, {
			committedSourceRevision,
			observedSourceRevision: 'b'.repeat(64),
		}),
		false,
		'A different observed source revision must keep postflight unresolved.',
	);
	assert.equal(
		verifyRuntimeTaskFieldMutationPrimaryPostflightV1(result.value, indexedAfter, {
			committedSourceRevision,
			observedSourceRevision: committedSourceRevision,
		}),
		true,
	);
	assert.equal(
		verifyRuntimeTaskFieldMutationPrimaryPostflightV1(
			result.value,
			{
				...indexedAfter,
				fieldValues: { ...indexedAfter.fieldValues, priority: 'Drifted' },
			},
			{
				committedSourceRevision,
				observedSourceRevision: committedSourceRevision,
			},
		),
		false,
		'Exact requested fields remain mandatory when timestamp tolerance is used.',
	);
	assert.equal(
		verifyRuntimeTaskFieldMutationPrimaryPostflightV1(
			result.value,
			{
				...indexedAfter,
				locator: { ...fileLocator, filePath: 'Tasks/Drifted.md' },
			},
			{
				committedSourceRevision,
				observedSourceRevision: committedSourceRevision,
			},
		),
		false,
		'The exact File Task locator remains mandatory when timestamp tolerance is used.',
	);
	assert.equal(
		verifyRuntimeTaskFieldMutationPrimaryPostflightV1(
			result.value,
			{
				...indexedAfter,
				fieldValues: {
					...indexedAfter.fieldValues,
					datetimeModified: '0001-01-01T00:00:00',
				},
			},
			{
				committedSourceRevision,
				observedSourceRevision: committedSourceRevision,
			},
		),
		false,
		'An older observed timestamp must never satisfy postflight.',
	);
});

test('File Task postflight evidence requires one exact committed revision and an unchanged reread', () => {
	const filePath = 'Tasks/File boundary fixture.md';
	const committedContent = [
		'---',
		'operonId: abc1234',
		'priority: P2',
		'---',
		'',
	].join('\n');
	const committedRevision = sha256HexV1(committedContent);
	const exactRevision = {
		resourceKind: 'task-source' as const,
		resourceKey: filePath,
		revision: committedRevision,
	};
	assert.deepEqual(
		resolveRuntimeTaskFieldMutationPostflightEvidenceV1(
			filePath,
			[
				{ resourceKind: 'active-tracker', resourceKey: 'current-user', revision: 'a'.repeat(64) },
				exactRevision,
			],
			committedContent,
		),
		{
			committedSourceRevision: committedRevision,
			observedSourceRevision: committedRevision,
		},
	);
	assert.equal(
		resolveRuntimeTaskFieldMutationPostflightEvidenceV1(filePath, [], committedContent),
		null,
		'A missing primary task-source revision must fail closed.',
	);
	assert.equal(
		resolveRuntimeTaskFieldMutationPostflightEvidenceV1(
			filePath,
			[exactRevision, exactRevision],
			committedContent,
		),
		null,
		'Duplicate primary task-source revisions must fail closed.',
	);
	assert.equal(
		resolveRuntimeTaskFieldMutationPostflightEvidenceV1(
			filePath,
			[{ ...exactRevision, revision: 'b'.repeat(64) }],
			committedContent,
		),
		null,
		'A wrong committed revision must fail closed.',
	);
	assert.equal(
		resolveRuntimeTaskFieldMutationPostflightEvidenceV1(
			filePath,
			[exactRevision],
			`${committedContent}\nPost-commit drift`,
		),
		null,
		'Post-commit source drift must fail closed.',
	);
	assert.equal(
		resolveRuntimeTaskFieldMutationPostflightEvidenceV1(filePath, [exactRevision], null),
		null,
		'A missing canonical reread must fail closed.',
	);
});

test('inline task exact-byte evidence records metadata settlement and unrelated source drift separately', () => {
	const filePath = 'Tasks.md';
	const committedContent = [
		'# Tasks',
		'',
		'- [ ] Updated description {{operonId:: abc1234}} {{datetimeModified:: 2026-07-24T12:00:00}}',
		'- [ ] Unrelated task {{operonId:: def5678}}',
		'',
	].join('\n');
	const metadataSettledContent = committedContent.replace(
		'2026-07-24T12:00:00',
		'2026-07-24T12:00:01',
	);
	const unrelatedDriftContent = metadataSettledContent.replace(
		'Unrelated task',
		'Concurrent unrelated edit',
	);
	const committedRevision = sha256HexV1(committedContent);
	const prepared: RuntimeTaskFieldMutationPreparationV1 = {
		kind: 'task-fields',
		operation: 'update',
		task: {
			...task,
			locator: { representation: 'inline', filePath, lineNumber: 2 },
			description: 'Before update',
			sourceContent: committedContent,
		},
		fieldValues: {
			_description: 'Updated description',
			datetimeModified: '2026-07-24T12:00:00',
		},
		sourceRevision: 'a'.repeat(64),
		targetDigest: 'b'.repeat(64),
		summary: 'Update the task description.',
		noChange: false,
	};
	const exactRevision = {
		resourceKind: 'task-source' as const,
		resourceKey: filePath,
		revision: committedRevision,
	};
	assert.notEqual(sha256HexV1(metadataSettledContent), committedRevision);
	assert.notEqual(
		sha256HexV1(unrelatedDriftContent),
		sha256HexV1(metadataSettledContent),
	);
	assert.equal(
		resolveRuntimeInlineTaskUpdateSettlementRevisionV1(
			prepared,
			committedContent,
			committedRevision,
			committedContent,
			DEFAULT_SETTINGS.keyMappings,
		),
		committedRevision,
		'An unchanged exact reread remains valid without refreshing evidence.',
	);
	assert.equal(
		resolveRuntimeInlineTaskUpdateSettlementRevisionV1(
			prepared,
			committedContent,
			committedRevision,
			metadataSettledContent,
			DEFAULT_SETTINGS.keyMappings,
		),
		sha256HexV1(metadataSettledContent),
		'Only the exact target datetimeModified value may advance after settlement.',
	);
	const rejectedObservedSources = [
		metadataSettledContent.replace('2026-07-24T12:00:01', '2026-07-24T11:59:59'),
		metadataSettledContent.replace('2026-07-24T12:00:01', 'not-a-datetime'),
		metadataSettledContent.replace(
			' {{datetimeModified:: 2026-07-24T12:00:01}}',
			'',
		),
		metadataSettledContent.replace(
			'{{datetimeModified:: 2026-07-24T12:00:01}}',
			'{{datetimeModified:: 2026-07-24T12:00:01}} {{datetimeModified:: 2026-07-24T12:00:02}}',
		),
		metadataSettledContent.replace('Updated description', 'Concurrent description edit'),
		unrelatedDriftContent,
	];
	for (const observedContent of rejectedObservedSources) {
		assert.equal(
			resolveRuntimeInlineTaskUpdateSettlementRevisionV1(
				prepared,
				committedContent,
				committedRevision,
				observedContent,
				DEFAULT_SETTINGS.keyMappings,
			),
			null,
		);
	}
	assert.equal(
		resolveRuntimeInlineTaskUpdateSettlementRevisionV1(
			{
				...prepared,
				task: {
					...prepared.task,
					locator: { representation: 'inline', filePath, lineNumber: 1 },
				},
			},
			committedContent,
			committedRevision,
			metadataSettledContent,
			DEFAULT_SETTINGS.keyMappings,
		),
		null,
		'A shifted target locator must not authorize evidence refresh.',
	);
	assert.equal(
		resolveRuntimeInlineTaskUpdateSettlementRevisionV1(
			prepared,
			committedContent,
			'c'.repeat(64),
			metadataSettledContent,
			DEFAULT_SETTINGS.keyMappings,
		),
		null,
		'The exact committed content must remain bound to its writer revision.',
	);
	const preparedMutation = {
		target: {
			operonId: prepared.task.operonId,
			locator: prepared.task.locator,
			targetDigest: prepared.targetDigest,
		},
		affectedResources: [exactRevision],
		predictedEffects: [],
		warnings: [],
		token: prepared,
	};
	const commit = {
		status: 'committed' as const,
		groupResults: [{
			groupId: `task-source:${filePath}`,
			status: 'committed' as const,
			resourceRevisions: [
				{ resourceKind: 'pinned' as const, resourceKey: 'abc1234', revision: 'd'.repeat(64) },
				exactRevision,
				{ resourceKind: 'task-source' as const, resourceKey: 'Other.md', revision: 'e'.repeat(64) },
			],
		}],
		affectedFilePaths: [filePath],
		primaryTaskSourceCommitEvidence: {
			resourceKey: filePath,
			content: committedContent,
			revision: committedRevision,
		},
	};
	const refreshedCommit = refreshRuntimeInlineTaskUpdateSettlementEvidenceV1(
		preparedMutation,
		commit,
		metadataSettledContent,
		DEFAULT_SETTINGS.keyMappings,
	);
	assert.equal(
		refreshedCommit.groupResults[0]?.resourceRevisions?.[1]?.revision,
		sha256HexV1(metadataSettledContent),
	);
	const refreshedTransitionCommit = refreshRuntimeInlineTaskUpdateSettlementEvidenceV1(
		{
			...preparedMutation,
			token: {
				kind: 'semantic-transition-plan' as const,
				prepared: {
					...prepared,
					operation: 'transition' as const,
				},
			},
		},
		commit,
		metadataSettledContent,
		DEFAULT_SETTINGS.keyMappings,
	);
	assert.equal(
		refreshedTransitionCommit.groupResults[0]?.resourceRevisions?.[1]?.revision,
		sha256HexV1(metadataSettledContent),
		'Semantic transitions must receive the same bounded metadata settlement as updates.',
	);
	assert.deepEqual(
		refreshedCommit.groupResults[0]?.resourceRevisions?.filter((_, index) => index !== 1),
		commit.groupResults[0]?.resourceRevisions?.filter((_, index) => index !== 1),
		'Non-primary and non-source revisions must be preserved exactly.',
	);
	assert.equal(
		refreshRuntimeInlineTaskUpdateSettlementEvidenceV1(
			preparedMutation,
			commit,
			null,
			DEFAULT_SETTINGS.keyMappings,
		),
		commit,
		'A missing source reread must leave commit evidence unchanged.',
	);
	for (const guardedCommit of [{
		...commit,
		groupResults: [{
			...commit.groupResults[0],
			resourceRevisions: [...(commit.groupResults[0]?.resourceRevisions ?? []), exactRevision],
		}],
	}, {
		...commit,
		groupResults: [{
			...commit.groupResults[0],
			resourceRevisions: commit.groupResults[0]?.resourceRevisions?.map(resource => (
				resource === exactRevision ? { ...resource, revision: 'f'.repeat(64) } : resource
			)),
		}],
	}, {
		...commit,
		primaryTaskSourceCommitEvidence: {
			...commit.primaryTaskSourceCommitEvidence,
			revision: '0'.repeat(64),
		},
	}]) {
		assert.equal(
			refreshRuntimeInlineTaskUpdateSettlementEvidenceV1(
				preparedMutation,
				guardedCommit,
				metadataSettledContent,
				DEFAULT_SETTINGS.keyMappings,
			),
			guardedCommit,
			'Duplicate, stale, or hash-mismatched source evidence must remain unchanged.',
		);
	}
	const boundedSettlement = resolveRuntimeInlineTaskUpdateSettlementEvidenceV1(
		prepared,
		committedContent,
		committedRevision,
		metadataSettledContent,
		DEFAULT_SETTINGS.keyMappings,
	);
	assert.equal(boundedSettlement?.datetimeModified, '2026-07-24T12:00:01');
	assert.equal(verifyRuntimeTaskFieldMutationPrimaryPostflightV1(
		prepared,
		{
			...prepared.task,
			description: 'Updated description',
			fieldValues: { datetimeModified: '2026-07-24T12:00:01' },
		},
		{
			committedSourceRevision: sha256HexV1(metadataSettledContent),
			observedSourceRevision: sha256HexV1(metadataSettledContent),
			settlementDatetimeModified: boundedSettlement?.datetimeModified,
		},
	), true, 'The real inline semantic verifier accepts only the bounded settlement timestamp.');
	assert.equal(verifyRuntimeTaskFieldMutationPrimaryPostflightV1(
		prepared,
		{
			...prepared.task,
			description: 'Updated description',
			fieldValues: { datetimeModified: '2026-07-24T12:00:02' },
		},
		{
			committedSourceRevision: sha256HexV1(metadataSettledContent),
			observedSourceRevision: sha256HexV1(metadataSettledContent),
			settlementDatetimeModified: boundedSettlement?.datetimeModified,
		},
	), false, 'A later indexed value not proven by the bounded source evidence is rejected.');
	assert.equal(
		resolveRuntimeTaskFieldMutationPostflightEvidenceV1(
			filePath,
			[exactRevision],
			metadataSettledContent,
		),
		null,
		'Current exact-byte evidence exposes the false uncertainty after metadata settlement.',
	);
	assert.equal(
		resolveRuntimeTaskFieldMutationPostflightEvidenceV1(
			filePath,
			[exactRevision],
			unrelatedDriftContent,
		),
		null,
		'Unrelated same-source drift must remain unverified.',
	);
});

test('inline task settlement accepts only the configured Update time on edit frontmatter drift', () => {
	const filePath = 'Tasks.md';
	const committedContent = [
		'---',
		'created: 2026-07-24T09:00',
		'modification: 2026-07-24T11:59',
		'---',
		'# Tasks',
		'- [ ] Updated description {{operonId:: abc1234}} {{datetimeModified:: 2026-07-24T12:00:00}}',
		'- [ ] Unrelated task {{operonId:: def5678}}',
		'',
	].join('\n');
	const settledContent = committedContent
		.replace('modification: 2026-07-24T11:59', 'modification: 2026-07-24T12:00')
		.replace('2026-07-24T12:00:00', '2026-07-24T12:00:01');
	const frontmatterOnlySettledContent = committedContent.replace(
		'modification: 2026-07-24T11:59',
		'modification: 2026-07-24T12:00',
	);
	const committedRevision = sha256HexV1(committedContent);
	const settlementWindow = {
		applyStartedAtEpochMs: new Date(2026, 6, 24, 12, 0, 0).getTime(),
		settlementObservedAtEpochMs: new Date(2026, 6, 24, 12, 0, 2).getTime(),
	};
	const prepared: RuntimeTaskFieldMutationPreparationV1 = {
		kind: 'task-fields',
		operation: 'update',
		task: {
			...task,
			locator: { representation: 'inline', filePath, lineNumber: 5 },
			description: 'Before update',
			sourceContent: committedContent,
		},
		fieldValues: {
			_description: 'Updated description',
			datetimeModified: '2026-07-24T12:00:00',
		},
		sourceRevision: 'a'.repeat(64),
		targetDigest: 'b'.repeat(64),
		summary: 'Update the task description.',
		noChange: false,
	};
	assert.equal(
		resolveRuntimeInlineTaskUpdateSettlementRevisionV1(
			prepared,
			committedContent,
			committedRevision,
			settledContent,
			DEFAULT_SETTINGS.keyMappings,
			['modification'],
			settlementWindow,
		),
		sha256HexV1(settledContent),
		'The configured modified-time property and target task timestamp may settle together.',
	);
	assert.deepEqual(
		resolveRuntimeInlineTaskUpdateSettlementEvidenceV1(
			prepared,
			committedContent,
			committedRevision,
			frontmatterOnlySettledContent,
			DEFAULT_SETTINGS.keyMappings,
			['modification'],
			settlementWindow,
		),
		{ revision: sha256HexV1(frontmatterOnlySettledContent) },
		'The configured modified-time property may settle without a second task timestamp write.',
	);
	assert.equal(
		resolveRuntimeInlineTaskUpdateSettlementRevisionV1(
			prepared,
			committedContent,
			committedRevision,
			frontmatterOnlySettledContent,
			DEFAULT_SETTINGS.keyMappings,
			['modification'],
		),
		null,
		'Modified-time frontmatter drift requires a bounded apply-time window.',
	);
	for (const [label, observedContent, permittedKeys] of [
		['missing provider evidence', settledContent, []],
		['wrong configured property', settledContent, ['updated']],
		[
			'unrelated frontmatter datetime',
			settledContent.replace('created: 2026-07-24T09:00', 'created: 2026-07-24T12:00'),
			['modification'],
		],
		[
			'different settlement minute',
			settledContent.replace('modification: 2026-07-24T12:00', 'modification: 2026-07-24T12:01'),
			['modification'],
		],
		[
			'unrelated body drift',
			settledContent.replace('Unrelated task', 'Concurrent unrelated edit'),
			['modification'],
		],
	] as const) {
		assert.equal(
			resolveRuntimeInlineTaskUpdateSettlementRevisionV1(
				prepared,
				committedContent,
				committedRevision,
				observedContent,
				DEFAULT_SETTINGS.keyMappings,
				permittedKeys,
				settlementWindow,
			),
			null,
			label,
		);
	}
});

test('File Task settlement accepts only one bounded configured modified-time frontmatter drift', () => {
	const filePath = 'Efforts/Projets/_Operon/Adapter fixture.md';
	const committedContent = [
		'---',
		'operonId: abc1234',
		'priority: F',
		'datetimeModified: 2026-07-24T12:00:00',
		'modification: 2026-07-24T11:59',
		'---',
		'',
	].join('\n');
	const settledContent = committedContent.replace(
		'modification: 2026-07-24T11:59',
		'modification: 2026-07-24T12:00',
	);
	const settlementWindow = {
		applyStartedAtEpochMs: new Date(2026, 6, 24, 12, 0, 0).getTime(),
		settlementObservedAtEpochMs: new Date(2026, 6, 24, 12, 0, 2).getTime(),
	};
	const prepared: RuntimeTaskFieldMutationPreparationV1 = {
		kind: 'task-fields',
		operation: 'update',
		task: {
			...task,
			locator: { representation: 'file', filePath },
			description: 'Adapter fixture',
			sourceContent: committedContent,
		},
		fieldValues: {
			priority: 'F',
			datetimeModified: '2026-07-24T12:00:00',
		},
		sourceRevision: 'a'.repeat(64),
		targetDigest: 'b'.repeat(64),
		summary: 'Update the File Task priority.',
		noChange: false,
	};
	assert.equal(
		resolveRuntimeInlineTaskUpdateSettlementRevisionV1(
			prepared,
			committedContent,
			sha256HexV1(committedContent),
			settledContent,
			DEFAULT_SETTINGS.keyMappings,
			['modification'],
			settlementWindow,
		),
		sha256HexV1(settledContent),
	);
	assert.equal(
		resolveRuntimeInlineTaskUpdateSettlementRevisionV1(
			prepared,
			committedContent,
			sha256HexV1(committedContent),
			settledContent.replace('priority: F', 'priority: A'),
			DEFAULT_SETTINGS.keyMappings,
			['modification'],
			settlementWindow,
		),
		null,
		'Concurrent File Task field drift remains unverified.',
	);
	assert.equal(
		resolveRuntimeInlineTaskUpdateSettlementRevisionV1(
			prepared,
			committedContent,
			sha256HexV1(committedContent),
			committedContent.replace(
				'datetimeModified: 2026-07-24T12:00:00',
				'datetimeModified: 2026-07-24T12:00:01',
			),
			DEFAULT_SETTINGS.keyMappings,
			['datetimeModified'],
			settlementWindow,
		),
		null,
		'A plugin property that collides with an Operon-managed File Task key must not be admitted.',
	);
	const taskTypeContent = committedContent.replace(
		'modification: 2026-07-24T11:59',
		'taskType: 2026-07-24T11:59',
	);
	const taskTypeSettledContent = taskTypeContent.replace(
		'taskType: 2026-07-24T11:59',
		'taskType: 2026-07-24T12:00',
	);
	assert.equal(
		resolveRuntimeInlineTaskUpdateSettlementRevisionV1(
			prepared,
			taskTypeContent,
			sha256HexV1(taskTypeContent),
			taskTypeSettledContent,
			DEFAULT_SETTINGS.keyMappings,
			['taskType'],
			settlementWindow,
		),
		null,
		'A published task-data key is managed task state and cannot be admitted as modified-time drift.',
	);
	assert.equal(
		resolveRuntimeInlineTaskUpdateSettlementRevisionV1(
			prepared,
			taskTypeContent,
			sha256HexV1(taskTypeContent),
			taskTypeSettledContent.replace('priority: F', 'priority: A'),
			DEFAULT_SETTINGS.keyMappings,
			['taskType'],
			settlementWindow,
		),
		null,
		'Concurrent source drift remains fail-closed when task-data state differs.',
	);
	const mappedSettings = {
		...DEFAULT_SETTINGS,
		keyMappings: DEFAULT_SETTINGS.keyMappings.map(mapping => (
			mapping.canonicalKey === 'datetimeCreated'
				? { ...mapping, visiblePropertyName: 'createdAt' }
				: mapping
		)),
	};
	const mappedCollisionContent = committedContent.replace(
		'modification: 2026-07-24T11:59',
		'createdAt: 2026-07-24T11:59',
	);
	assert.equal(
		resolveRuntimeInlineTaskUpdateSettlementRevisionV1(
			prepared,
			mappedCollisionContent,
			sha256HexV1(mappedCollisionContent),
			mappedCollisionContent.replace(
				'createdAt: 2026-07-24T11:59',
				'createdAt: 2026-07-24T12:00',
			),
			mappedSettings.keyMappings,
			['createdAt'],
			settlementWindow,
		),
		null,
		'A configured visible name for an Operon-managed key must also remain fail-closed.',
	);
	for (const reservedKey of ['tags', 'related'] as const) {
		const reservedCollisionContent = committedContent.replace(
			'modification: 2026-07-24T11:59',
			`${reservedKey}: 2026-07-24T11:59`,
		);
		assert.equal(
			resolveRuntimeInlineTaskUpdateSettlementRevisionV1(
				prepared,
				reservedCollisionContent,
				sha256HexV1(reservedCollisionContent),
				reservedCollisionContent.replace(
					`${reservedKey}: 2026-07-24T11:59`,
					`${reservedKey}: 2026-07-24T12:00`,
				),
				DEFAULT_SETTINGS.keyMappings,
				[reservedKey],
				settlementWindow,
			),
			null,
			`${reservedKey} remains reserved task state even when it is absent from active key mappings.`,
		);
	}
	const customSettings = {
		...DEFAULT_SETTINGS,
		keyMappings: [...DEFAULT_SETTINGS.keyMappings, {
			canonicalKey: 'reviewScore',
			visiblePropertyName: 'reviewScoreVisible',
			type: 'datetime' as const,
			sync: 'yes' as const,
			enabled: true,
			isSystem: false,
		}],
	};
	for (const customKey of ['reviewScore', 'reviewScoreVisible'] as const) {
		const customCollisionContent = committedContent.replace(
			'modification: 2026-07-24T11:59',
			`${customKey}: 2026-07-24T11:59`,
		);
		assert.equal(
			resolveRuntimeInlineTaskUpdateSettlementRevisionV1(
				prepared,
				customCollisionContent,
				sha256HexV1(customCollisionContent),
				customCollisionContent.replace(
					`${customKey}: 2026-07-24T11:59`,
					`${customKey}: 2026-07-24T12:00`,
				),
				customSettings.keyMappings,
				[customKey],
				settlementWindow,
			),
			null,
			`${customKey} remains managed task state for settlement collision checks.`,
		);
	}
});
