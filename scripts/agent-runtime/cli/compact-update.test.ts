import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
	compactRelationshipUpdateWouldChangeTaskV1,
	compactUpdateRouteV1,
	compileCompactRelationshipUpdateIntentV1,
	compileCompactRecurrenceUpdateIntentV1,
	compileCompactUpdateBatchIntentV1,
	compileCompactUpdateIntentV1,
	parseCompactUpdateArgvV1,
	parseCompactUpdateLinesInputV1,
} from '../../../packages/operon-cli/src/compact-update';
import {
	buildCompactUpdateBatchContextRequestV1,
	isExpectedCompactRecurrencePlan,
} from '../../../packages/operon-cli/src/command-line';
import type {
	FieldDescriptorV1,
	OperonCatalogV1,
	SealedMutationPlanV1,
	TaskContextV1,
	WritableFieldValueV1,
} from '../../../src/agent-runtime/contracts/v1';

declare global {
	var __operonCompactUpdateTestRun: Promise<void> | undefined;
}

globalThis.__operonCompactUpdateTestRun = Promise.resolve().then(run);

interface GoldenCase {
	id: string;
	assignments: string[];
	clear: string[];
	expect: {
		assignments?: Array<{ key: string; value: string }>;
		clear?: string[];
		code?: string;
	};
}

interface BatchGoldenCase {
	id: string;
	input: string;
	expect: {
		operonIds?: string[];
		assignmentKeys?: string[][];
		clearKeys?: string[][];
		code?: string;
	};
}

function run(): void {
	const golden = JSON.parse(readFileSync(
		path.resolve(process.cwd(), 'scripts/agent-runtime/fixtures/compact-update-golden.json'),
		'utf8',
	)) as { version: number; cases: GoldenCase[]; batchCases: BatchGoldenCase[] };
	assert.equal(golden.version, 1);
	for (const testCase of golden.cases) {
		if (testCase.expect.code) {
			expectCode(
				() => parseCompactUpdateArgvV1(testCase.assignments, testCase.clear),
				testCase.expect.code,
			);
			continue;
		}
		const ast = parseCompactUpdateArgvV1(testCase.assignments, testCase.clear);
		assert.deepEqual(ast.assignments, testCase.expect.assignments, testCase.id);
		assert.deepEqual(ast.clearKeys, testCase.expect.clear, testCase.id);
	}
	for (const testCase of golden.batchCases) {
		if (testCase.expect.code) {
			expectCode(
				() => parseCompactUpdateLinesInputV1(testCase.input),
				testCase.expect.code,
			);
			continue;
		}
		const items = parseCompactUpdateLinesInputV1(testCase.input);
		assert.deepEqual(items.map(item => item.operonId), testCase.expect.operonIds, testCase.id);
		assert.deepEqual(
			items.map(item => item.update.assignments.map(assignment => assignment.key)),
			testCase.expect.assignmentKeys,
			testCase.id,
		);
		assert.deepEqual(
			items.map(item => item.update.clearKeys),
			testCase.expect.clearKeys,
			testCase.id,
		);
	}
	testCompiler();
	testBatchCompiler();
	testBatchReadinessRequest();
	testBatchBoundaries();
	testCompilerRefusals();
	testRelationshipCompiler();
	testRelationshipRefusals();
	testRecurrenceCompiler();
	testRecurrenceRefusals();
	testSealedRecurrenceAutoApplyMatch();
	console.log('Compact update parser/compiler tests passed');
}

function testBatchBoundaries(): void {
	const lines = Array.from(
		{ length: 65 },
		(_, index) => `--id "u${String(index).padStart(6, '0')}" note::"value-${index}"`,
	);
	assert.equal(parseCompactUpdateLinesInputV1(lines.slice(0, 64).join('\n')).length, 64);
	expectCode(
		() => parseCompactUpdateLinesInputV1(lines.join('\n')),
		'COMPACT_UPDATE_BATCH_TOO_MANY_ITEMS',
	);
}

function testBatchReadinessRequest(): void {
	const request = buildCompactUpdateBatchContextRequestV1(
		['abc1234', 'def5678'],
		'batch-readiness',
	);
	assert.deepEqual(request, {
		contractVersion: 1,
		requestId: 'batch-readiness',
		kind: 'context',
		consistency: 'live-verified',
		purpose: 'mutation-readiness',
		projection: 'mutation-preview',
		operonIds: ['abc1234', 'def5678'],
		mutationKind: 'task.update',
	});
	assert.equal('limit' in request, false);
}

function testBatchCompiler(): void {
	const catalog = liveCatalog();
	const first = hydratedTask();
	const second = {
		...hydratedTask(),
		identity: { operonId: 'def5678', validity: 'canonical' as const, mutationAllowed: true },
		locator: {
			representation: 'inline' as const,
			filePath: 'Tasks.md',
			line: { lineNumber: 3, operonId: 'def5678' },
		},
	} as unknown as TaskContextV1;
	const input = parseCompactUpdateLinesInputV1(
		'--id "abc1234" note::"Review first"\n'
		+ '--id "def5678" priority::"A" --clear "location"',
	);
	const intent = compileCompactUpdateBatchIntentV1({
		items: input,
		tasks: [first, second],
		catalog,
		itemRefs: ['item-one', 'item-two'],
	});
	assert.equal(intent.target, undefined);
	assert.deepEqual(intent.spec, {
		operation: 'update-batch',
		items: [
			{
				itemRef: 'item-one',
				target: {
					operonId: 'abc1234',
					locator: first.locator,
				},
				changes: [{ field: 'note', valueType: 'text', value: 'Review first' }],
			},
			{
				itemRef: 'item-two',
				target: {
					operonId: 'def5678',
					locator: second.locator,
				},
				changes: [
					{ field: 'priority', valueType: 'text', value: 'priority-a' },
					{ operation: 'clear', field: 'location', valueType: 'text' },
				],
			},
		],
	});
}

function testSealedRecurrenceAutoApplyMatch(): void {
	const task = hydratedTask();
	const intent = compileCompactRecurrenceUpdateIntentV1({
		ast: parseCompactUpdateArgvV1([
			'repeat::mode=schedule|freq=day|interval=1',
		], []),
		task,
		catalog: liveCatalog(),
	});
	const sealedSpec: Record<string, unknown> = {
		operation: 'update-recurrence',
		scope: 'this-and-following',
		changes: [{
			field: 'repeat',
			valueType: 'text',
			value: 'mode=schedule|freq=day|interval=1',
		}],
		expected: {
			fieldValues: {},
			repeatSeriesId: null,
			repeatOccurrenceDate: null,
		},
	};
	const plan = {
		mutationKind: 'task.recurrence',
		targets: [{
			operonId: 'abc1234',
			locator: task.locator,
			targetDigest: 'a'.repeat(64),
		}],
		spec: sealedSpec,
	} as unknown as SealedMutationPlanV1;
	assert.equal(isExpectedCompactRecurrencePlan(plan, intent), true);
	assert.equal(isExpectedCompactRecurrencePlan({
		...plan,
		spec: {
			...sealedSpec,
			scope: 'this-task',
		},
	} as unknown as SealedMutationPlanV1, intent), false);
	assert.equal(isExpectedCompactRecurrencePlan({
		...plan,
		spec: {
			...sealedSpec,
			expected: undefined,
		},
	} as unknown as SealedMutationPlanV1, intent), false);
}

function testRecurrenceCompiler(): void {
	const task = hydratedTask();
	const startAst = parseCompactUpdateArgvV1([
		'repeat::mode=schedule|freq=week|interval=1|days=mo',
		'dateScheduled::2026-08-03',
	], []);
	assert.equal(compactUpdateRouteV1(startAst), 'recurrence-update');
	const start = compileCompactRecurrenceUpdateIntentV1({
		ast: startAst,
		task,
		catalog: liveCatalog(),
	});
	assert.deepEqual(start.spec, {
		operation: 'update-recurrence',
		scope: 'this-and-following',
		changes: [
			{
				field: 'repeat',
				valueType: 'text',
				value: 'mode=schedule|freq=week|interval=1|days=mo',
			},
			{ field: 'dateScheduled', valueType: 'date', value: '2026-08-03' },
		],
	});

	const recurring = {
		...task,
		recurrence: {
			repeating: true,
			seriesId: 'rsabc12',
			occurrenceDate: '2026-07-27',
		},
	};
	const temporalAst = parseCompactUpdateArgvV1(['dateDue::2026-08-05'], ['estimate']);
	assert.equal(compactUpdateRouteV1(temporalAst, 'this-task'), 'recurrence-update');
	const temporal = compileCompactRecurrenceUpdateIntentV1({
		ast: temporalAst,
		task: recurring,
		catalog: liveCatalog(),
		scope: 'this-task',
	});
	assert.deepEqual(temporal.spec, {
		operation: 'update-recurrence',
		scope: 'this-task',
		changes: [
			{ field: 'dateDue', valueType: 'date', value: '2026-08-05' },
			{ operation: 'clear', field: 'estimate', valueType: 'number' },
		],
	});

	const estimate = compileCompactRecurrenceUpdateIntentV1({
		ast: parseCompactUpdateArgvV1(['estimate::3600'], []),
		task: recurring,
		catalog: liveCatalog(),
		scope: 'this-task',
	});
	assert.deepEqual(estimate.spec, {
		operation: 'update-recurrence',
		scope: 'this-task',
		changes: [
			{ field: 'estimate', valueType: 'number', value: 3600 },
		],
	});
}

function testRecurrenceRefusals(): void {
	const task = hydratedTask();
	const recurring = {
		...task,
		recurrence: {
			repeating: true,
			seriesId: 'rsabc12',
			occurrenceDate: '2026-07-27',
		},
	};
	expectCode(() => compactUpdateRouteV1(
		parseCompactUpdateArgvV1(['repeat::mode=schedule|freq=day|interval=1', 'note::mixed'], []),
	), 'RECURRENCE_GENERAL_UPDATE_CONFLICT');
	expectCode(() => compileCompactRecurrenceUpdateIntentV1({
		ast: parseCompactUpdateArgvV1(['dateScheduled::2026-08-01'], []),
		task: recurring,
		catalog: liveCatalog(),
		scope: 'bad-scope',
	}), 'RECURRENCE_SCOPE_INVALID');
	expectCode(() => compileCompactRecurrenceUpdateIntentV1({
		ast: parseCompactUpdateArgvV1(['repeat::mode=schedule|freq=day|interval=1'], []),
		task: recurring,
		catalog: liveCatalog(),
		scope: 'this-task',
	}), 'RECURRENCE_SCOPE_INVALID');
	expectCode(() => compileCompactRecurrenceUpdateIntentV1({
		ast: parseCompactUpdateArgvV1(['dateScheduled::2026-08-01'], []),
		task: recurring,
		catalog: liveCatalog(),
	}), 'RECURRENCE_GENERAL_UPDATE_CONFLICT');
}

function testRelationshipCompiler(): void {
	const task = hydratedTask();
	const ast = parseCompactUpdateArgvV1([
		'parentTask::par1234',
		'blocking::blk1234; blk5678',
	], ['blockedBy']);
	assert.equal(compactUpdateRouteV1(ast), 'relationship-update');
	const intent = compileCompactRelationshipUpdateIntentV1({ ast, task });
	assert.deepEqual(intent.spec, {
		operation: 'replace-relationships',
		changes: [
			{ field: 'parentTask', targetOperonIds: ['par1234'] },
			{ field: 'blocking', targetOperonIds: ['blk1234', 'blk5678'] },
			{ field: 'blockedBy', targetOperonIds: [] },
		],
	});
	assert.equal(compactRelationshipUpdateWouldChangeTaskV1(intent, task), true);
	const noChange = compileCompactRelationshipUpdateIntentV1({
		ast: parseCompactUpdateArgvV1([
			'parentTask::par0001',
			'blocking::blk0001; blk0002',
			'blockedBy::dep0001',
		], []),
		task,
	});
	assert.equal(compactRelationshipUpdateWouldChangeTaskV1(noChange, task), false);
	const clearAbsent = compileCompactRelationshipUpdateIntentV1({
		ast: parseCompactUpdateArgvV1([], ['parentTask']),
		task: {
			...task,
			relationships: { ...task.relationships, parentOperonId: undefined },
		},
	});
	assert.equal(compactRelationshipUpdateWouldChangeTaskV1(
		clearAbsent,
		{
			...task,
			relationships: { ...task.relationships, parentOperonId: undefined },
		},
	), false);
}

function testRelationshipRefusals(): void {
	const task = hydratedTask();
	expectCode(() => compactUpdateRouteV1(parseCompactUpdateArgvV1(
		['parentTask::par1234', 'note::mixed'],
		[],
	)), 'RELATIONSHIP_GENERAL_UPDATE_CONFLICT');
	expectCode(() => compileCompactRelationshipUpdateIntentV1({
		ast: parseCompactUpdateArgvV1(['parentTask::bad'], []),
		task,
	}), 'RELATIONSHIP_TARGET_INVALID');
	expectCode(() => compileCompactRelationshipUpdateIntentV1({
		ast: parseCompactUpdateArgvV1(['blocking::abc1234'], []),
		task,
	}), 'RELATIONSHIP_SELF_REFERENCE');
	expectCode(() => compileCompactRelationshipUpdateIntentV1({
		ast: parseCompactUpdateArgvV1([
			'blocking::same001',
			'blockedBy::same001',
		], []),
		task,
	}), 'RELATIONSHIP_INVERSE_CONFLICT');
	expectCode(() => compileCompactRelationshipUpdateIntentV1({
		ast: parseCompactUpdateArgvV1(['blocking::dep0001'], []),
		task,
	}), 'RELATIONSHIP_INVERSE_CONFLICT');
}

function testCompiler(): void {
	const task = hydratedTask();
	const intent = compileCompactUpdateIntentV1({
		ast: parseCompactUpdateArgvV1([
			'description::Updated task',
			'priority::A',
			'estimate::45',
			'contexts::Research\\; Development; Operon',
			'customDone::false',
			'customText::Readable value',
			'customNumber::12.5',
			'customDate::2026-08-01',
			'customDatetime::2026-08-01T09:30',
			'customList::First item; Second item',
		], ['note', 'location']),
		task,
		catalog: liveCatalog(),
	});
	assert.deepEqual(intent.target, {
		operonId: 'abc1234',
		locator: task.locator,
	});
	assert.deepEqual(intent.spec, {
		operation: 'update',
		changes: [
			{ field: 'description', valueType: 'text', value: 'Updated task' },
			{ field: 'priority', valueType: 'text', value: 'priority-a' },
			{ field: 'estimate', valueType: 'number', value: 45 },
			{
				field: 'contexts',
				valueType: 'list',
				value: ['Research; Development', 'Operon'],
			},
			{ field: 'customDone', valueType: 'checkbox', value: false },
			{ field: 'customText', valueType: 'text', value: 'Readable value' },
			{ field: 'customNumber', valueType: 'number', value: 12.5 },
			{ field: 'customDate', valueType: 'date', value: '2026-08-01' },
			{ field: 'customDatetime', valueType: 'datetime', value: '2026-08-01T09:30' },
			{ field: 'customList', valueType: 'list', value: ['First item', 'Second item'] },
			{ operation: 'clear', field: 'note', valueType: 'text' },
		],
	});
	const noChange = compileCompactUpdateIntentV1({
		ast: parseCompactUpdateArgvV1(['description::Original'], ['location']),
		task,
		catalog: liveCatalog(),
	});
	assert.deepEqual(noChange.spec, { operation: 'update', changes: [] });
}

function testCompilerRefusals(): void {
	const task = hydratedTask();
	const catalog = liveCatalog();
	expectCode(() => compileCompactUpdateIntentV1({
		ast: parseCompactUpdateArgvV1([], ['description']),
		task,
		catalog,
	}), 'DESCRIPTION_CLEAR_UNAVAILABLE');
	expectCode(() => compileCompactUpdateIntentV1({
		ast: parseCompactUpdateArgvV1(['status::Daily.Done'], []),
		task,
		catalog,
	}), 'FIELD_OWNED_BY_OTHER_COMMAND');
	expectCode(() => compileCompactUpdateIntentV1({
		ast: parseCompactUpdateArgvV1(['unknown::value'], []),
		task,
		catalog,
	}), 'FIELD_NOT_WRITABLE');
	expectCode(() => compileCompactUpdateIntentV1({
		ast: parseCompactUpdateArgvV1(['priority::Unknown'], []),
		task,
		catalog,
	}), 'INVALID_PRIORITY');
	expectCode(() => compileCompactUpdateIntentV1({
		ast: parseCompactUpdateArgvV1(['customDone::TRUE'], []),
		task,
		catalog,
	}), 'INVALID_FIELD_VALUE');
	expectCode(() => compileCompactUpdateIntentV1({
		ast: parseCompactUpdateArgvV1(['contexts::Operon; Operon'], []),
		task,
		catalog,
	}), 'DUPLICATE_LIST_ELEMENT');
	expectCode(() => compileCompactUpdateIntentV1({
		ast: parseCompactUpdateArgvV1(['dateDue::2026-08-01'], []),
		task: { ...task, recurrence: { repeating: true, seriesId: 'series1' } },
		catalog,
	}), 'RECURRING_TEMPORAL_REQUIRES_SCOPE');
	expectCode(() => compileCompactUpdateIntentV1({
		ast: parseCompactUpdateArgvV1(['estimate::45'], []),
		task: { ...task, recurrence: { repeating: true, seriesId: 'series1' } },
		catalog,
	}), 'RECURRING_TEMPORAL_REQUIRES_SCOPE');
	expectCode(() => compileCompactUpdateIntentV1({
		ast: parseCompactUpdateArgvV1([], ['estimate']),
		task: { ...task, recurrence: { repeating: true, seriesId: 'series1' } },
		catalog,
	}), 'RECURRING_TEMPORAL_REQUIRES_SCOPE');
	expectCode(() => compileCompactUpdateIntentV1({
		ast: parseCompactUpdateArgvV1(['note::'], []),
		task,
		catalog,
	}), 'INVALID_FIELD_VALUE');
	expectCode(() => compileCompactUpdateIntentV1({
		ast: parseCompactUpdateArgvV1(['note::value'], []),
		task: { ...task, writableFields: undefined },
		catalog,
	}), 'WRITABLE_FIELDS_INCOMPLETE');
}

function liveCatalog(): Extract<OperonCatalogV1, { ok: true }> {
	return {
		ok: true,
		taxonomy: {
			priorities: [{
				id: 'priority-a',
				label: 'A',
				description: 'High',
				order: 0,
				color: '#000000',
				isDefault: true,
				identityStatus: 'resolved',
			}],
		},
		fields: [
			field('description', 'text'),
			field('priority', 'text'),
			field('estimate', 'number'),
			field('contexts', 'list'),
			field('note', 'text'),
			field('location', 'text'),
			field('dateDue', 'date'),
			field('dateScheduled', 'date'),
			field('dateStarted', 'date'),
			field('datetimeStart', 'datetime'),
			field('datetimeEnd', 'datetime'),
			field('repeat', 'text', 'built-in', 'semantic-capability', 'tasks.recurrence'),
			field('datetimeRepeatEnd', 'datetime', 'built-in', 'semantic-capability', 'tasks.recurrence'),
			field('customDone', 'checkbox', 'custom'),
			field('customText', 'text', 'custom'),
			field('customNumber', 'number', 'custom'),
			field('customDate', 'date', 'custom'),
			field('customDatetime', 'datetime', 'custom'),
			field('customList', 'list', 'custom'),
			field('status', 'text', 'built-in', 'semantic-capability', 'tasks.transition'),
		],
		policies: {
			taskUpdate: {
				compactUpdateBatchVersion: 1,
				compactUpdateBatchInputFormat: 'compact-lines',
				compactUpdateBatchMaxItems: 64,
				compactUpdateBatchFeatures: [
					'exact-id-targets',
					'heterogeneous-general-updates',
					'explicit-field-clear',
					'single-source-atomic-plan',
					'per-target-postflight',
					'same-plan-recovery',
				],
			},
		},
	} as unknown as Extract<OperonCatalogV1, { ok: true }>;
}

function hydratedTask(): TaskContextV1 {
	const writableFields: WritableFieldValueV1[] = [
		{ canonicalKey: 'description', valueType: 'text', present: true, value: 'Original', canClear: false },
		{ canonicalKey: 'priority', valueType: 'text', present: true, value: 'priority-b', canClear: true },
		{ canonicalKey: 'estimate', valueType: 'number', present: false, canClear: true },
		{ canonicalKey: 'contexts', valueType: 'list', present: false, canClear: true },
		{ canonicalKey: 'note', valueType: 'text', present: true, value: 'Old note', canClear: true },
		{ canonicalKey: 'location', valueType: 'text', present: false, canClear: true },
		{ canonicalKey: 'dateDue', valueType: 'date', present: false, canClear: true },
		{ canonicalKey: 'customDone', valueType: 'checkbox', present: true, value: true, canClear: true },
		{ canonicalKey: 'customText', valueType: 'text', present: false, canClear: true },
		{ canonicalKey: 'customNumber', valueType: 'number', present: false, canClear: true },
		{ canonicalKey: 'customDate', valueType: 'date', present: false, canClear: true },
		{ canonicalKey: 'customDatetime', valueType: 'datetime', present: false, canClear: true },
		{ canonicalKey: 'customList', valueType: 'list', present: false, canClear: true },
	];
	return {
		identity: { operonId: 'abc1234', validity: 'canonical', mutationAllowed: true },
		description: 'Original',
		locator: {
			representation: 'inline',
			filePath: 'Tasks.md',
			line: { lineNumber: 2, operonId: 'abc1234' },
		},
		recurrence: { repeating: false },
		relationships: {
			parentOperonId: 'par0001',
			childOperonIds: [],
			blockingOperonIds: ['blk0001', 'blk0002'],
			blockedByOperonIds: ['dep0001'],
			relatedOperonIds: [],
		},
		writableFields,
	} as unknown as TaskContextV1;
}

function field(
	canonicalKey: string,
	valueType: FieldDescriptorV1['valueType'],
	source: FieldDescriptorV1['source'] = 'built-in',
	mutationClass: FieldDescriptorV1['mutationClass'] = 'general-update',
	mutationOwner: string = 'tasks.update',
): FieldDescriptorV1 {
	return {
		canonicalKey,
		displayName: canonicalKey,
		description: canonicalKey,
		valueType,
		source,
		mappingStatus: 'mapped',
		readable: true,
		mutationClass,
		mutationOwner,
		requiresStableTaxonomyId: canonicalKey === 'priority',
	};
}

function expectCode(runCase: () => unknown, code: string): void {
	assert.throws(runCase, error => (
		error instanceof Error && error.message === code
	));
}
