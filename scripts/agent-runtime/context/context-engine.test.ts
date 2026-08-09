import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
	decodeContextRequestV1,
	decodeContextPackV1,
	decodeEntityResolveRequestV1,
	decodeEntityResolutionResultV1,
	decodeRelationshipRequestV1,
	decodeRelationshipResultV1,
	decodeTaskGetRequestV1,
	decodeTaskGetResultV1,
	decodeTaskQueryRequestV1,
	decodeTaskQueryResultV1,
} from '../../../src/agent-runtime/contracts/v1/decode';
import { decodeTaskFilterQueryResultExtensionV1 as decodeTaskFilterQueryResultV1 } from '../../../src/agent-runtime/extensions/task-workflows-v1';
import { structuredErrorV1 } from '../../../src/agent-runtime/contracts/v1/primitives';
import type { ContextRevisionV1 } from '../../../src/agent-runtime/contracts/v1/identity';
import type {
	ContextRequestV1,
	TaskQueryRequestV1,
} from '../../../src/agent-runtime/contracts/v1/context';
import { buildLivePropertyCatalogV1 } from '../../../src/agent-runtime/runtime/catalog-builder';
import { ContextBridgeV1 } from '../../../src/agent-runtime/runtime/context-bridge';
import { RuntimeContextCursorCodecV1 } from '../../../src/agent-runtime/runtime/context-cursor';
import {
	validateContextRequestV1,
	validateEntityResolveRequestV1,
	validateRelationshipRequestV1,
	validateTaskGetRequestV1,
	validateTaskQueryRequestV1,
} from '../../../src/agent-runtime/runtime/context-request-validator';
import {
	LiveIndexContextProviderV1,
	type IndexContextReadPortV1,
} from '../../../src/agent-runtime/runtime/context-provider';
import { RuntimeSourceHydratorV1 } from '../../../src/agent-runtime/runtime/context-source';
import { readLosslessYamlListField } from '../../../src/core/yaml-fields';
import type { IndexedTask, IndexedTaskInstance } from '../../../src/types/fields';
import { DEFAULT_SETTINGS, type OperonSettings } from '../../../src/types/settings';

declare global {
	var __operonAgentRuntimeContextTestRun: Promise<void> | undefined;
}

globalThis.__operonAgentRuntimeContextTestRun = Promise.resolve().then(run);

async function run(): Promise<void> {
	testProductionRequestValidatorParity();
	const fixture = createFixture();
	await testEntityTaskAndRelationships(fixture);
	await testLegacyMinuteDatetimeRead(createFixture());
	await testReminderItemHydration(createFixture());
	await testReminderItemHydrationBounds();
	await testWritableFieldHydration(createFixture());
	await testWritableFieldBulkRefusal(createFixture());
	await testQueryCursorAndTamper(fixture);
	await testSavedFilterQuery(fixture);
	await testQueryBuildsCatalogOnce();
	await testFinderProjectRootAmbiguity();
	testRelatedReferencesRejectDuplicateIds();
	await testPaginationBeyondFiveHundred();
	await testContextProjections(fixture);
	await testExactMultiTaskMutationReadiness(fixture);
	await testPlacementCandidates(fixture);
	await testSourceDrift(fixture);
	await testDerivedIndexFieldsDoNotCauseSourceDrift();
	testLosslessTrackerHydration();
	await testRelationshipContractAtHardLimit();
	console.log('Agent Runtime Context Engine tests passed');
}

async function testLegacyMinuteDatetimeRead(fixture: Fixture): Promise<void> {
	const legacyDatetime = '2026-07-31T22:00';
	const root = fixture.index.getTaskSnapshot('root001');
	assert.ok(root);
	root.fieldValues['datetimeStart'] = legacyDatetime;
	const lines = fixture.sources.get('Tasks.md')?.split('\n');
	assert.ok(lines);
	lines[0] += ` {{datetimeStart:: ${legacyDatetime}}}`;
	fixture.sources.set('Tasks.md', lines.join('\n'));

	const result = await fixture.bridge.getTask({
		contractVersion: 1,
		requestId: 'task-legacy-minute-datetime',
		kind: 'task-get',
		consistency: 'live-verified',
		selector: { kind: 'operon-id', operonId: 'root001' },
		include: ['source-markdown', 'writable-fields'],
	}, fixture.execution);
	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.equal(result.task.datetimes.start, legacyDatetime);
	assert.match(result.task.sourceMarkdown ?? '', /\{\{datetimeStart:: 2026-07-31T22:00\}\}/u);
	assert.equal(
		result.task.writableFields?.find(field => field.canonicalKey === 'datetimeStart')?.value,
		legacyDatetime,
		'Legacy minute-precision storage must remain readable without an implicit repair write.',
	);
	assert.equal(decodeTaskGetResultV1(result).ok, true);
}

function testLosslessTrackerHydration(): void {
	const mappings = structuredClone(DEFAULT_SETTINGS.keyMappings);
	assert.deepEqual(readLosslessYamlListField({ trackers: null }, 'trackers', mappings), {
		ok: true,
		value: '',
	});
	assert.deepEqual(readLosslessYamlListField({
		trackers: [
			'2026-07-27T09:00:00/2026-07-27T10:00:00',
			'2026-07-27T10:00:00/2026-07-27T11:00:00',
		],
	}, 'trackers', mappings), {
		ok: true,
		value: [
			'2026-07-27T09:00:00/2026-07-27T10:00:00',
			'2026-07-27T10:00:00/2026-07-27T11:00:00',
		].join('; '),
	});
	assert.deepEqual(readLosslessYamlListField({
		trackers: ['2026-07-27T09:00:00/2026-07-27T10:00:00', { truncated: true }],
	}, 'trackers', mappings), { ok: false });
	const aliasMappings = mappings.map(mapping => mapping.canonicalKey === 'trackers'
		? { ...mapping, visiblePropertyName: 'Trackers' }
		: mapping);
	assert.deepEqual(readLosslessYamlListField({
		trackers: '2026-07-27T09:00:00/2026-07-27T10:00:00',
		Trackers: '2026-07-27T10:00:00/2026-07-27T11:00:00',
	}, 'trackers', aliasMappings), { ok: false });
}

async function testFinderProjectRootAmbiguity(): Promise<void> {
	const fixture = createFixture();
	fixture.index.markDuplicate('root001');
	const result = await fixture.bridge.findTasks({
		contractVersion: 1,
		requestId: 'finder-duplicate-project-root',
		kind: 'task-finder',
		consistency: 'live-verified',
		project: { mode: 'tree', rootOperonId: 'root001' },
	}, fixture.execution);
	assert.equal(result.ok, false);
	assert.equal(!result.ok && result.error.code, 'ambiguous-selector');
}

function testRelatedReferencesRejectDuplicateIds(): void {
	const fixture = createFixture();
	const root = fixture.index.getTaskSnapshot('root001');
	assert.ok(root);
	root.fieldValues['related'] = 'child01';
	assert.deepEqual(
		fixture.provider.buildRelationships(root, { kinds: ['related'], depth: 0 })
			.explicit.map(relation => relation.targetOperonId),
		['child01'],
	);
	fixture.index.markDuplicate('child01');
	assert.deepEqual(
		fixture.provider.buildRelationships(root, { kinds: ['related'], depth: 0 }).explicit,
		[],
		'exact operonId references must fail closed when the ID is duplicated',
	);

	for (const [operonId, filePath, reference] of [
		['path001', 'References/Exact path.md', 'References/Exact path.md'],
		['name001', 'References/Exact name.md', 'Exact name'],
	] as const) {
		fixture.index.addTask({
			...task(operonId, reference, 0, '', '', ''),
			primary: { format: 'inline', filePath, lineNumber: 0 },
		});
		fixture.index.markDuplicate(operonId);
		root.fieldValues['related'] = reference;
		assert.deepEqual(
			fixture.provider.buildRelationships(root, { kinds: ['related'], depth: 0 }).explicit,
			[],
			`${reference} must fail closed when its candidate ID is duplicated`,
		);
	}
}

function testProductionRequestValidatorParity(): void {
	const base = {
		contractVersion: 1,
		requestId: 'validator-parity',
		consistency: 'live-verified',
	};
	const matrices: Array<{
		portable: (value: unknown) => { ok: boolean };
		runtime: (value: unknown) => { ok: boolean };
		values: unknown[];
	}> = [
		{
			portable: decodeEntityResolveRequestV1,
			runtime: validateEntityResolveRequestV1,
			values: [
				{ ...base, kind: 'entity-resolve', selector: { kind: 'operon-id', operonId: 'root001' } },
				{ ...base, requestId: 'invalid request', kind: 'entity-resolve', selector: { kind: 'operon-id', operonId: 'root001' } },
				{ ...base, kind: 'entity-resolve', selector: { kind: 'operon-id', operonId: 'INVALID' } },
				{ ...base, kind: 'entity-resolve', selector: { kind: 'search', query: 'task', limit: 501 } },
			],
		},
		{
			portable: decodeTaskGetRequestV1,
			runtime: validateTaskGetRequestV1,
			values: [
				{ ...base, kind: 'task-get', selector: { kind: 'exact-path', filePath: 'Tasks.md' }, include: ['notes'] },
				{ ...base, kind: 'task-get', selector: { kind: 'operon-id', operonId: 'root001' }, include: ['writable-fields'] },
				{ ...base, kind: 'task-get', selector: { kind: 'exact-path', filePath: '../Tasks.md' } },
				{ ...base, kind: 'task-get', selector: { kind: 'operon-id', operonId: 'root001' }, include: ['notes', 'notes'] },
			],
		},
		{
			portable: decodeTaskQueryRequestV1,
			runtime: validateTaskQueryRequestV1,
			values: [
				{ ...base, kind: 'task-query', filters: { due: { from: '2026-07-23' } }, limit: 250 },
				{ ...base, kind: 'task-query', include: ['writable-fields'] },
				{ ...base, kind: 'task-query', filters: { due: { from: '2026-02-30' } } },
				{ ...base, kind: 'task-query', cursor: 'too-short' },
			],
		},
		{
			portable: decodeRelationshipRequestV1,
			runtime: validateRelationshipRequestV1,
			values: [
				{ ...base, kind: 'relationship', selector: { kind: 'operon-id', operonId: 'root001' }, kinds: ['child'], depth: 6 },
				{ ...base, kind: 'relationship', selector: { kind: 'operon-id', operonId: 'root001' }, kinds: ['child', 'child'] },
				{ ...base, kind: 'relationship', selector: { kind: 'operon-id', operonId: 'root001' }, depth: 7 },
			],
		},
		{
			portable: decodeContextRequestV1,
			runtime: validateContextRequestV1,
			values: [
				{
					...base,
					kind: 'context',
					purpose: 'analysis',
					projection: 'task-neighborhood',
					selector: { kind: 'operon-id', operonId: 'root001' },
				},
				{ ...base, kind: 'context', purpose: 'analysis', projection: 'task-neighborhood' },
				{
					...base,
					kind: 'context',
					purpose: 'mutation-readiness',
					projection: 'mutation-preview',
					selector: { kind: 'operon-id', operonId: 'root001' },
				},
				{
					...base,
					kind: 'context',
					purpose: 'mutation-readiness',
					projection: 'mutation-preview',
					mutationKind: 'task.update',
					operonIds: ['root001', 'child01'],
				},
				{
					...base,
					kind: 'context',
					purpose: 'mutation-readiness',
					projection: 'mutation-preview',
					mutationKind: 'task.update',
					selector: { kind: 'operon-id', operonId: 'root001' },
					operonIds: ['root001', 'child01'],
				},
				{
					...base,
					kind: 'context',
					purpose: 'mutation-readiness',
					projection: 'placement-candidates',
					placement: { mode: 'files', query: 'daily' },
				},
				{
					...base,
					kind: 'context',
					purpose: 'mutation-readiness',
					projection: 'placement-candidates',
					placement: { mode: 'lines', filePath: 'Daily/2026-07-25.md' },
				},
				{
					...base,
					kind: 'context',
					purpose: 'mutation-readiness',
					projection: 'placement-candidates',
					placement: { mode: 'lines', filePath: '../Daily.md' },
				},
				{
					...base,
					kind: 'context',
					purpose: 'analysis',
					projection: 'placement-candidates',
					placement: { mode: 'files' },
				},
				{ ...base, kind: 'context', purpose: 'planning', projection: 'planning-workload', unexpected: true },
				{ ...base, kind: 'context', purpose: 'planning', projection: 'planning-workload', include: ['writable-fields'] },
			],
		},
	];
	for (const matrix of matrices) {
		for (const value of matrix.values) {
			assert.equal(
				matrix.runtime(value).ok,
				matrix.portable(value).ok,
				`Runtime validator parity failed for ${JSON.stringify(value)}`,
			);
		}
	}
}

async function testExactMultiTaskMutationReadiness(fixture: Fixture): Promise<void> {
	const request: ContextRequestV1 = {
		contractVersion: 1,
		requestId: 'context-batch-readiness',
		kind: 'context',
		consistency: 'live-verified',
		purpose: 'mutation-readiness',
		projection: 'mutation-preview',
		mutationKind: 'task.update',
		operonIds: ['child01', 'root001'],
	};
	assert.equal(decodeContextRequestV1(request).ok, true);
	assert.equal(validateContextRequestV1(request).ok, true);
	const result = await fixture.bridge.buildContext(request, fixture.execution);
	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.deepEqual(result.entities.map(entity => entity.identity.operonId), ['child01', 'root001']);
	assert.ok(result.entities.every(entity => entity.writableFields !== undefined));
	assert.equal(new Set(result.entities.map(entity => entity.sourceRevision.contentDigest)).size, 1);

	const missing = await fixture.bridge.buildContext({
		...request,
		requestId: 'context-batch-readiness-missing',
		operonIds: ['child01', 'miss001'],
	}, fixture.execution);
	assert.equal(missing.ok, false);
	assert.equal(!missing.ok && missing.error.code, 'entity-not-found');
}

async function testEntityTaskAndRelationships(fixture: Fixture): Promise<void> {
	const resolved = await fixture.bridge.resolveEntity({
		contractVersion: 1,
		requestId: 'resolve-1',
		kind: 'entity-resolve',
		consistency: 'live-verified',
		selector: { kind: 'operon-id', operonId: 'root001' },
	}, fixture.execution);
	assert.equal(resolved.ok, true);
	assert.equal(resolved.ok && resolved.resolution, 'resolved');
	assert.equal(decodeEntityResolutionResultV1(resolved).ok, true);

	const task = await fixture.bridge.getTask({
		contractVersion: 1,
		requestId: 'task-1',
		kind: 'task-get',
		consistency: 'live-verified',
		selector: { kind: 'exact-path', filePath: 'Tasks.md', expectedOperonId: 'root001' },
		include: ['notes', 'source-markdown'],
	}, fixture.execution);
	assert.equal(task.ok, true);
	assert.equal(task.ok && task.task.sourceMarkdown?.startsWith('- [ ] Root task'), true);
	assert.equal(task.ok && task.task.reminderItems, undefined);
	assert.equal(decodeTaskGetResultV1(task).ok, true);

	const searchedTask = await fixture.bridge.getTask({
		contractVersion: 1,
		requestId: 'task-search-1',
		kind: 'task-get',
		consistency: 'live-verified',
		selector: { kind: 'search', query: 'Root task', limit: 1 },
	}, fixture.execution);
	assert.equal(searchedTask.ok, true);
	assert.equal(searchedTask.ok && searchedTask.task.identity.operonId, 'root001');

	const relationships = await fixture.bridge.getRelationships({
		contractVersion: 1,
		requestId: 'relations-1',
		kind: 'relationship',
		consistency: 'live-verified',
		selector: { kind: 'operon-id', operonId: 'root001' },
		kinds: ['child'],
		depth: 1,
	}, fixture.execution);
	assert.equal(relationships.ok, true);
	assert.deepEqual(
		relationships.ok ? relationships.relationships.derived.map(edge => edge.targetOperonId) : [],
		['child01'],
	);
	assert.equal(decodeRelationshipResultV1(relationships).ok, true);
}

async function testWritableFieldHydration(fixture: Fixture): Promise<void> {
	const withoutHydration = await fixture.bridge.getTask({
		contractVersion: 1,
		requestId: 'task-writable-default',
		kind: 'task-get',
		consistency: 'live-verified',
		selector: { kind: 'operon-id', operonId: 'root001' },
	}, fixture.execution);
	assert.equal(withoutHydration.ok, true);
	assert.equal(withoutHydration.ok && withoutHydration.task.writableFields, undefined);

	const result = await fixture.bridge.getTask({
		contractVersion: 1,
		requestId: 'task-writable-explicit',
		kind: 'task-get',
		consistency: 'live-verified',
		selector: { kind: 'operon-id', operonId: 'root001' },
		include: ['writable-fields'],
	}, fixture.execution);
	assert.equal(result.ok, true);
	if (!result.ok) return;
	const byKey = new Map(result.task.writableFields?.map(field => [field.canonicalKey, field]));
	assert.deepEqual(byKey.get('description'), {
		canonicalKey: 'description',
		valueType: 'text',
		present: true,
		value: 'Root task',
		canClear: false,
	});
	assert.equal(byKey.get('priority')?.value, fixture.settings.priorities[0].id);
	assert.equal(byKey.get('note')?.value, 'memo');
	assert.equal(byKey.get('dateDue')?.present, false);
	assert.equal(byKey.has('status'), false);
	assert.equal(byKey.has('reminderRules'), false);
	assert.equal(decodeTaskGetResultV1(result).ok, true);

	const invalid = structuredClone(result);
	if (invalid.ok && invalid.task.writableFields) {
		const description = invalid.task.writableFields.find(field => field.canonicalKey === 'description');
		if (description) description.canClear = true;
	}
	assert.equal(decodeTaskGetResultV1(invalid).ok, false);
}

async function testWritableFieldBulkRefusal(fixture: Fixture): Promise<void> {
	const query = await fixture.bridge.queryTasks({
		contractVersion: 1,
		requestId: 'task-writable-query-refusal',
		kind: 'task-query',
		consistency: 'live-verified',
		include: ['writable-fields'],
	} as unknown as TaskQueryRequestV1, fixture.execution);
	assert.equal(query.ok, false);
	assert.equal(!query.ok && query.error.code, 'invalid-request');

	const context = await fixture.bridge.buildContext({
		contractVersion: 1,
		requestId: 'task-writable-context-refusal',
		kind: 'context',
		purpose: 'planning',
		projection: 'planning-workload',
		consistency: 'live-verified',
		include: ['writable-fields'],
	} as unknown as ContextRequestV1, fixture.execution);
	assert.equal(context.ok, false);
	assert.equal(!context.ok && context.error.code, 'invalid-request');
}

async function testReminderItemHydration(fixture: Fixture): Promise<void> {
	setRootReminderFields(fixture, {
		reminderDatetimes: '2026-07-25T09:00; broken legacy datetime',
		reminderRules: 'dateDue.30m; invalid-legacy-token',
	});
	const result = await fixture.bridge.getTask({
		contractVersion: 1,
		requestId: 'task-reminders-1',
		kind: 'task-get',
		consistency: 'live-verified',
		selector: { kind: 'operon-id', operonId: 'root001' },
		include: ['reminder-items'],
	}, fixture.execution);
	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.deepEqual(
		result.task.reminderItems?.map(item => [item.collection, item.expectedValue]),
		[
			['reminderDatetimes', '2026-07-25T09:00'],
			['reminderDatetimes', ' broken legacy datetime'],
			['reminderRules', 'dateDue.30m'],
			['reminderRules', ' invalid-legacy-token'],
		],
		'Reminder hydration preserves deterministic collection/source order and invalid legacy tokens.',
	);
	assert.equal(result.task.reminderItems?.every(item => /^item-\d+-[a-f0-9]{64}$/u.test(item.itemId)), true);
	assert.equal(decodeTaskGetResultV1(result).ok, true);

	setRootReminderFields(fixture, {
		reminderDatetimes: ' 2026-07-25T09:00 ;  legacy whitespace token  ',
	});
	const rawResult = await fixture.bridge.getTask({
		contractVersion: 1,
		requestId: 'task-reminders-raw-source',
		kind: 'task-get',
		consistency: 'live-verified',
		selector: { kind: 'operon-id', operonId: 'root001' },
		include: ['reminder-items'],
	}, fixture.execution);
	assert.equal(rawResult.ok, true);
	assert.deepEqual(
		rawResult.ok ? rawResult.task.reminderItems?.map(item => item.expectedValue) : [],
		[
			' 2026-07-25T09:00 ',
			'  legacy whitespace token  ',
			'dateDue.30m',
			' invalid-legacy-token',
		],
		'Reminder hydration returns meaningful source tokens without trimming them.',
	);
	assert.equal(decodeTaskGetResultV1(rawResult).ok, true);

	const invalid = structuredClone(result);
	if (invalid.ok && invalid.task.reminderItems) {
		invalid.task.reminderItems[0].expectedValue = 'x'.repeat(4_097);
	}
	assert.equal(decodeTaskGetResultV1(invalid).ok, false, 'Reminder item value caps are decoder-enforced.');
}

async function testReminderItemHydrationBounds(): Promise<void> {
	const countFixture = createFixture();
	setRootReminderFields(countFixture, {
		reminderRules: Array.from({ length: 300 }, (_, index) => `legacy-${index}`).join('; '),
	});
	const countResult = await countFixture.bridge.getTask({
		contractVersion: 1,
		requestId: 'task-reminders-count',
		kind: 'task-get',
		consistency: 'live-verified',
		selector: { kind: 'operon-id', operonId: 'root001' },
		include: ['reminder-items'],
	}, countFixture.execution);
	assert.equal(countResult.ok, true);
	assert.equal(countResult.ok && countResult.task.reminderItems?.length, 256);
	assert.equal(countResult.ok && countResult.truncations.some(item => item.path.endsWith('.reminderItems')), true);

	const byteFixture = createFixture();
	setRootReminderFields(byteFixture, {
		reminderRules: Array.from({ length: 30 }, (_, index) => `${index}-${'x'.repeat(2_990)}`).join('; '),
	});
	const byteResult = await byteFixture.bridge.getTask({
		contractVersion: 1,
		requestId: 'task-reminders-bytes',
		kind: 'task-get',
		consistency: 'live-verified',
		selector: { kind: 'operon-id', operonId: 'root001' },
		include: ['reminder-items'],
	}, byteFixture.execution);
	assert.equal(byteResult.ok, true);
	if (!byteResult.ok) return;
	assert.ok((byteResult.task.reminderItems?.length ?? 0) < 30);
	assert.ok(Buffer.byteLength(JSON.stringify(byteResult.task.reminderItems), 'utf8') <= 64 * 1024);
	assert.equal(byteResult.truncations.some(item => item.path.endsWith('.reminderItems')), true);
	assert.equal(decodeTaskGetResultV1(byteResult).ok, true);

	const itemFixture = createFixture();
	setRootReminderFields(itemFixture, {
		reminderRules: `${'x'.repeat(4_097)}; invalid-token-after-oversized`,
	});
	const itemResult = await itemFixture.bridge.getTask({
		contractVersion: 1,
		requestId: 'task-reminders-item-bytes',
		kind: 'task-get',
		consistency: 'live-verified',
		selector: { kind: 'operon-id', operonId: 'root001' },
		include: ['reminder-items'],
	}, itemFixture.execution);
	assert.equal(itemResult.ok, true);
	assert.deepEqual(
		itemResult.ok ? itemResult.task.reminderItems?.map(item => item.expectedValue) : [],
		[' invalid-token-after-oversized'],
	);
	assert.equal(
		itemResult.ok && itemResult.truncations.some(item => item.path.includes('.reminderItems.0')),
		true,
	);
}

async function testQueryCursorAndTamper(fixture: Fixture): Promise<void> {
	const first = await fixture.bridge.queryTasks({
		contractVersion: 1,
		requestId: 'query-1',
		kind: 'task-query',
		consistency: 'live-verified',
		limit: 1,
	}, fixture.execution);
	assert.equal(first.ok, true);
	assert.equal(first.ok && first.tasks.length, 1);
	assert.equal(first.ok && !!first.page.nextCursor, true);
	assert.equal(decodeTaskQueryResultV1(first).ok, true);
	if (!first.ok || !first.page.nextCursor) return;

	const second = await fixture.bridge.queryTasks({
		contractVersion: 1,
		requestId: 'query-2',
		kind: 'task-query',
		consistency: 'live-verified',
		limit: 1,
		cursor: first.page.nextCursor,
	}, fixture.execution);
	assert.equal(second.ok, true);
	assert.notEqual(
		second.ok ? second.tasks[0]?.identity.operonId : '',
		first.tasks[0]?.identity.operonId,
	);

	const tampered = await fixture.bridge.queryTasks({
		contractVersion: 1,
		requestId: 'query-3',
		kind: 'task-query',
		consistency: 'live-verified',
		limit: 1,
		cursor: `${first.page.nextCursor[0] === 'A' ? 'B' : 'A'}${first.page.nextCursor.slice(1)}`,
	}, fixture.execution);
	assert.equal(tampered.ok, false);
	assert.equal(!tampered.ok && tampered.error.code, 'stale-cursor');
}

async function testSavedFilterQuery(fixture: Fixture): Promise<void> {
	const catalog = buildLivePropertyCatalogV1(fixture.settings);
	if (!catalog.ok) throw new Error(catalog.error.reason);
	let definitionDigest = 'a'.repeat(64);
	const bridge = new ContextBridgeV1(
		fixture.provider,
		() => catalog.value,
		new RuntimeContextCursorCodecV1(webcrypto as unknown as Crypto, new Uint8Array(32).fill(9)),
		request => {
			if (request.filterSetId !== 'saved-filter') {
				return { ok: false, error: structuredErrorV1('entity-not-found', 'Saved filter does not exist.') };
			}
			const scoped = fixture.index.getAllTaskSnapshots().filter(taskValue => {
				if (!request.scope) return true;
				if (request.scope.kind === 'exact-file') return taskValue.primary.filePath === request.scope.path;
				return taskValue.primary.filePath === request.scope.path
					|| taskValue.primary.filePath.startsWith(`${request.scope.path}/`);
			});
			return {
				ok: true,
				tasks: [scoped[1], scoped[0], scoped[1]].filter((taskValue): taskValue is IndexedTask => !!taskValue),
				queryDigest: definitionDigest,
			};
		},
	);
	const first = await bridge.filterQueryTasks({
		contractVersion: 1,
		requestId: 'saved-filter-first',
		kind: 'task-filter-query',
		consistency: 'live-verified',
		filterSetId: 'saved-filter',
		scope: { kind: 'exact-file', path: 'Tasks.md' },
		limit: 1,
	}, fixture.execution);
	assert.equal(first.ok, true);
	assert.equal(first.ok && first.tasks[0]?.identity.operonId, 'child01', 'native evaluator order must be retained');
	assert.equal(first.ok && first.page.actualCount, 2, 'duplicate evaluator rows must be unique by operonId');
	assert.equal(decodeTaskFilterQueryResultV1(first).ok, true);
	if (!first.ok || !first.page.nextCursor) return;
	const second = await bridge.filterQueryTasks({
		contractVersion: 1,
		requestId: 'saved-filter-second',
		kind: 'task-filter-query',
		consistency: 'live-verified',
		filterSetId: 'saved-filter',
		scope: { kind: 'exact-file', path: 'Tasks.md' },
		limit: 1,
		cursor: first.page.nextCursor,
	}, fixture.execution);
	assert.equal(second.ok, true);
	assert.equal(second.ok && second.tasks[0]?.identity.operonId, 'root001');
	definitionDigest = 'b'.repeat(64);
	const stale = await bridge.filterQueryTasks({
		contractVersion: 1,
		requestId: 'saved-filter-stale',
		kind: 'task-filter-query',
		consistency: 'live-verified',
		filterSetId: 'saved-filter',
		scope: { kind: 'exact-file', path: 'Tasks.md' },
		limit: 1,
		cursor: first.page.nextCursor,
	}, fixture.execution);
	assert.equal(stale.ok, false);
	assert.equal(!stale.ok && stale.error.code, 'stale-cursor');
	assert.equal(!stale.ok && stale.error.retryable, false);
	assert.equal(!stale.ok && stale.error.action, 'refresh-state');
	const missing = await bridge.filterQueryTasks({
		contractVersion: 1,
		requestId: 'saved-filter-missing',
		kind: 'task-filter-query',
		consistency: 'live-verified',
		filterSetId: 'missing',
	}, fixture.execution);
	assert.equal(missing.ok, false);
	assert.equal(!missing.ok && missing.error.code, 'entity-not-found');
}

async function testQueryBuildsCatalogOnce(): Promise<void> {
	const fixture = createFixture(100);
	const catalog = buildLivePropertyCatalogV1(fixture.settings);
	if (!catalog.ok) throw new Error(catalog.error.reason);
	let catalogBuilds = 0;
	const provider = new LiveIndexContextProviderV1(
		fixture.index,
		{
			isPinned: () => false,
			getActiveTrackerTaskId: () => null,
		},
		fixture.sourceHydrator,
		() => fixture.settings,
		() => {
			catalogBuilds += 1;
			return catalog.value;
		},
	);
	const projection = provider.query({}, 25);
	assert.equal(projection.tasks.length, 25);
	assert.equal(catalogBuilds, 1);
}

async function testContextProjections(fixture: Fixture): Promise<void> {
	fixture.readCounts.set('Tasks.md', 0);
	const neighborhood = await fixture.bridge.buildContext({
		contractVersion: 1,
		requestId: 'context-1',
		kind: 'context',
		consistency: 'live-verified',
		purpose: 'analysis',
		projection: 'task-neighborhood',
		selector: { kind: 'operon-id', operonId: 'root001' },
	}, fixture.execution);
	assert.equal(neighborhood.ok, true);
	assert.equal(neighborhood.ok && neighborhood.entities.length, 2);
	assert.equal(fixture.readCounts.get('Tasks.md'), 1);
	assert.equal(decodeContextPackV1(neighborhood).ok, true);

	const readiness = await fixture.bridge.buildContext({
		contractVersion: 1,
		requestId: 'context-2',
		kind: 'context',
		consistency: 'live-verified',
		purpose: 'mutation-readiness',
		projection: 'mutation-preview',
		selector: { kind: 'operon-id', operonId: 'child01' },
		mutationKind: 'task.update',
		limit: 1,
	}, fixture.execution);
	assert.equal(readiness.ok, true);
	assert.equal(
		readiness.ok && readiness.resourceRevisions?.some(item => item.resourceKind === 'task-source'),
		true,
	);
	assert.equal(readiness.ok && !!readiness.catalog, true);
	assert.equal(
		readiness.ok && Array.isArray(readiness.entities[0]?.writableFields),
		true,
	);
	assert.equal(decodeContextPackV1(readiness).ok, true);

	const unboundedReadiness = await fixture.bridge.buildContext({
		contractVersion: 1,
		requestId: 'context-2-unbounded',
		kind: 'context',
		consistency: 'live-verified',
		purpose: 'mutation-readiness',
		projection: 'mutation-preview',
		selector: { kind: 'operon-id', operonId: 'child01' },
		mutationKind: 'task.update',
	}, fixture.execution);
	assert.equal(unboundedReadiness.ok, true);
	assert.equal(
		unboundedReadiness.ok && unboundedReadiness.entities[0]?.writableFields,
		undefined,
	);
}

async function testPlacementCandidates(fixture: Fixture): Promise<void> {
	const dailyPath = 'Daily/2026-07-25.md';
	fixture.readCounts.set(dailyPath, 0);
	const files = await fixture.bridge.buildContext({
		contractVersion: 1,
		requestId: 'placement-files',
		kind: 'context',
		consistency: 'live-verified',
		purpose: 'mutation-readiness',
		projection: 'placement-candidates',
		placement: { mode: 'files', query: '2026 07' },
	}, fixture.execution);
	assert.equal(files.ok, true);
	assert.deepEqual(
		files.ok && files.placement?.mode === 'files'
			? files.placement.files
			: [],
		[{ filePath: dailyPath, noteName: '2026-07-25' }],
	);
	assert.equal(files.ok && files.entities.length, 0);
	assert.equal(fixture.readCounts.get(dailyPath), 0);
	assert.equal(decodeContextPackV1(files).ok, true);

	const lines = await fixture.bridge.buildContext({
		contractVersion: 1,
		requestId: 'placement-lines',
		kind: 'context',
		consistency: 'live-verified',
		purpose: 'mutation-readiness',
		projection: 'placement-candidates',
		placement: { mode: 'lines', filePath: dailyPath },
		limit: 2,
	}, fixture.execution);
	assert.equal(lines.ok, true);
	assert.equal(fixture.readCounts.get(dailyPath), 1);
	if (!lines.ok || lines.placement?.mode !== 'lines') {
		throw new Error('Expected line placement candidates');
	}
	assert.match(lines.placement.sourceRevision.contentDigest, /^[a-f0-9]{64}$/u);
	assert.equal(lines.placement.actualCount, 2);
	assert.equal(lines.placement.returnedCount, 2);
	assert.equal(lines.placement.truncated, false);
	assert.deepEqual(lines.placement.lines, [
		{
			locator: {
				representation: 'inline',
				filePath: dailyPath,
				lineNumber: 4,
			},
			heading: 'Today',
			contextLabel: 'Under Today · blank line 5',
		},
		{
			locator: {
				representation: 'inline',
				filePath: dailyPath,
				lineNumber: 6,
			},
			heading: 'Today',
			contextLabel: 'Under Today · blank line 7',
		},
	]);
	assert.equal('sourceMarkdown' in lines.placement, false);
	assert.deepEqual(lines.truncations, []);
	assert.equal(decodeContextPackV1(lines).ok, true);

	for (const [caseId, filePath, content, expectedLines] of [
		['body', 'Trailing body.md', 'Body\n', []],
		['frontmatter', 'Trailing frontmatter.md', '---\nType: Note\n---\n', []],
		['internal', 'Internal blank.md', 'Body\n\nAfter\n', [1]],
	] as const) {
		fixture.sources.set(filePath, content);
		const trailing = await fixture.bridge.buildContext({
			contractVersion: 1,
			requestId: `placement-terminal-${caseId}`,
			kind: 'context',
			consistency: 'live-verified',
			purpose: 'mutation-readiness',
			projection: 'placement-candidates',
			placement: { mode: 'lines', filePath },
		}, fixture.execution);
		assert.equal(trailing.ok, true, filePath);
		assert.deepEqual(
			trailing.ok && trailing.placement?.mode === 'lines'
				? trailing.placement.lines.map(candidate => candidate.locator.lineNumber)
				: [],
			expectedLines,
			filePath,
		);
	}

	const previousExcludedFolders = [...fixture.settings.excludedFolders];
	fixture.settings.excludedFolders = ['Daily'];
	try {
		fixture.readCounts.set(dailyPath, 0);
		const excludedFiles = await fixture.bridge.buildContext({
			contractVersion: 1,
			requestId: 'placement-files-excluded',
			kind: 'context',
			consistency: 'live-verified',
			purpose: 'mutation-readiness',
			projection: 'placement-candidates',
			placement: { mode: 'files', query: '2026-07-25' },
		}, fixture.execution);
		assert.equal(excludedFiles.ok, true);
		assert.deepEqual(
			excludedFiles.ok && excludedFiles.placement?.mode === 'files'
				? excludedFiles.placement.files
				: [],
			[],
		);

		const excludedLines = await fixture.bridge.buildContext({
			contractVersion: 1,
			requestId: 'placement-lines-excluded',
			kind: 'context',
			consistency: 'live-verified',
			purpose: 'mutation-readiness',
			projection: 'placement-candidates',
			placement: { mode: 'lines', filePath: dailyPath },
		}, fixture.execution);
		assert.equal(excludedLines.ok, false);
		assert.equal(!excludedLines.ok && excludedLines.error.code, 'entity-not-found');
		assert.equal(fixture.readCounts.get(dailyPath), 0);
		assert.equal(decodeContextPackV1(excludedLines).ok, true);
	} finally {
		fixture.settings.excludedFolders = previousExcludedFolders;
	}
}

async function testPaginationBeyondFiveHundred(): Promise<void> {
	const fixture = createFixture(501);
	let cursor: string | undefined;
	const seen = new Set<string>();
	for (let page = 0; page < 3; page++) {
		const result = await fixture.bridge.queryTasks({
			contractVersion: 1,
			requestId: `query-large-${page}`,
			kind: 'task-query',
			consistency: 'live-verified',
			limit: 250,
			...(cursor ? { cursor } : {}),
		}, fixture.execution);
		assert.equal(result.ok, true);
		if (!result.ok) return;
		for (const taskValue of result.tasks) seen.add(taskValue.identity.operonId);
		cursor = result.page.nextCursor;
	}
	assert.equal(seen.size, 503);
	assert.equal(cursor, undefined);
}

async function testRelationshipContractAtHardLimit(): Promise<void> {
	const fixture = createFixture(505, true);
	const result = await fixture.bridge.getRelationships({
		contractVersion: 1,
		requestId: 'relations-hard-limit',
		kind: 'relationship',
		consistency: 'live-verified',
		selector: { kind: 'operon-id', operonId: 'root001' },
		limit: 500,
		depth: 1,
	}, fixture.execution);
	assert.equal(result.ok, true);
	assert.equal(result.ok && result.tasks.length <= 500, true);
	assert.equal(decodeRelationshipResultV1(result).ok, true);
}

async function testSourceDrift(fixture: Fixture): Promise<void> {
	const original = fixture.sources.get('Tasks.md');
	assert.ok(original);
	fixture.sources.set('Tasks.md', original.replace('Root task', 'Root tast'));
	const sameMetadataStale = await fixture.bridge.getTask({
		contractVersion: 1,
		requestId: 'task-stale',
		kind: 'task-get',
		consistency: 'live-verified',
		selector: { kind: 'operon-id', operonId: 'root001' },
	}, fixture.execution);
	assert.equal(sameMetadataStale.ok, false);
	assert.equal(!sameMetadataStale.ok && sameMetadataStale.error.code, 'stale-source');
	fixture.sources.set('Tasks.md', original);
	const restored = await fixture.bridge.getTask({
		contractVersion: 1,
		requestId: 'task-restored',
		kind: 'task-get',
		consistency: 'live-verified',
		selector: { kind: 'operon-id', operonId: 'root001' },
	}, fixture.execution);
	assert.equal(restored.ok, true);
	fixture.sources.set('Tasks.md', original.replace(' {{note:: memo}}', ''));
	const removedField = await fixture.bridge.getTask({
		contractVersion: 1,
		requestId: 'task-removed-field',
		kind: 'task-get',
		consistency: 'live-verified',
		selector: { kind: 'operon-id', operonId: 'root001' },
		include: ['notes'],
	}, fixture.execution);
	assert.equal(removedField.ok, false);
	assert.equal(!removedField.ok && removedField.error.code, 'stale-source');
	assert.equal(fixture.reindexed.includes('Tasks.md'), true);
}

async function testDerivedIndexFieldsDoNotCauseSourceDrift(): Promise<void> {
	const fixture = createFixture();
	const root = fixture.index.getTaskSnapshot('root001');
	assert.ok(root);
	root.fieldValues['progress'] = '50';
	root.fieldValues['totalEstimate'] = '900';
	root.fieldValues['totalDuration'] = '600';
	root.fieldValues['directSubtaskCount'] = '1';
	root.fieldValues['treeDescendantCount'] = '1';
	root.fieldValues['datetimeCreated'] = '2026-07-23T12:00:00';
	root.fieldValues['datetimeModified'] = '2026-07-23T12:30:00';
	fixture.sources.set(
		'Tasks.md',
		fixture.sources.get('Tasks.md')?.replace(
			' {{note:: memo}}',
			' {{note:: memo}} {{datetimeCreated:: 2026-01-01T09:00:00}} {{datetimeModified:: 2026-01-01T10:00:00}}',
		) ?? '',
	);
	const result = await fixture.bridge.getTask({
		contractVersion: 1,
		requestId: 'task-derived-index-fields',
		kind: 'task-get',
		consistency: 'live-verified',
		selector: { kind: 'operon-id', operonId: 'root001' },
	}, fixture.execution);
	assert.equal(result.ok, true);
	assert.equal(fixture.reindexed.length, 0);
}

interface Fixture {
	bridge: ContextBridgeV1;
	provider: LiveIndexContextProviderV1;
	index: FixtureIndex;
	settings: OperonSettings;
	sourceHydrator: RuntimeSourceHydratorV1;
	execution: {
		revision: ContextRevisionV1;
		freshness: {
			source: 'live-runtime';
			coherence: 'verified';
			observedAt: string;
			settled: true;
		};
	};
	sources: Map<string, string>;
	reindexed: string[];
	readCounts: Map<string, number>;
}

function setRootReminderFields(
	fixture: Fixture,
	fields: {
		reminderDatetimes?: string;
		reminderRules?: string;
	},
): void {
	const root = fixture.index.getTaskSnapshot('root001');
	assert.ok(root);
	const lines = fixture.sources.get('Tasks.md')?.split('\n');
	assert.ok(lines);
	for (const [key, value] of Object.entries(fields)) {
		if (!value) continue;
		root.fieldValues[key] = value;
		lines[0] += ` {{${key}:: ${value}}}`;
	}
	fixture.sources.set('Tasks.md', lines.join('\n'));
}

function createFixture(extraCount = 0, extraChildren = false): Fixture {
	const settings: OperonSettings = structuredClone(DEFAULT_SETTINGS);
	const pipeline = settings.pipelines[0];
	const status = pipeline.statuses[0];
	const statusValue = `${pipeline.name}.${status.label}`;
	const priorityValue = settings.priorities[0].label;
	const rootLine = `${taskLine('Root task', 'root001', statusValue, priorityValue, '')} {{note:: memo}}`;
	const childLine = taskLine('Child task', 'child01', statusValue, priorityValue, 'root001');
	const lines = [rootLine, childLine];
	const root = task('root001', 'Root task', 0, statusValue, priorityValue, '');
	root.fieldValues['note'] = 'memo';
	const child = task('child01', 'Child task', 1, statusValue, priorityValue, 'root001');
	const tasks = [root, child];
	for (let index = 0; index < extraCount; index++) {
		const operonId = `e${String(index).padStart(6, '0')}`;
		const description = `Extra task ${index}`;
		const parentTask = extraChildren ? 'root001' : '';
		lines.push(taskLine(description, operonId, statusValue, priorityValue, parentTask));
		tasks.push(task(operonId, description, index + 2, statusValue, priorityValue, parentTask));
	}
	const sources = new Map([
		['Tasks.md', lines.join('\n')],
		[
			'Daily/2026-07-25.md',
			[
				'---',
				'Type: Daily',
				'---',
				'# [[Today|Today]]',
				'',
				'Plan',
				'',
				'## Later <span>private</span>',
				'',
			].join('\n'),
		],
	]);
	const index = new FixtureIndex(tasks);
	const reindexed: string[] = [];
	const readCounts = new Map<string, number>();
	const source = new RuntimeSourceHydratorV1({
		read: async filePath => {
			readCounts.set(filePath, (readCounts.get(filePath) ?? 0) + 1);
			const content = sources.get(filePath);
			return content === undefined
				? null
				: {
					content,
					mtimeMs: 1,
					sizeBytes: 1_000_000,
					stable: true,
				};
		},
		onMismatch: async filePath => {
			reindexed.push(filePath);
		},
	});
	const catalog = buildLivePropertyCatalogV1(settings);
	if (!catalog.ok) throw new Error(catalog.error.reason);
	const provider = new LiveIndexContextProviderV1(
		index,
		{
			isPinned: operonId => operonId === 'root001',
			getActiveTrackerTaskId: () => 'child01',
		},
		source,
		() => settings,
		() => catalog.value,
		{
			listMarkdownFilePaths: () => [...sources.keys()],
		},
	);
	const bridge = new ContextBridgeV1(
		provider,
		() => catalog.value,
		new RuntimeContextCursorCodecV1(webcrypto as unknown as Crypto, new Uint8Array(32).fill(7)),
	);
	const revision: ContextRevisionV1 = {
		index: {
			sessionId: 'session-test',
			ramGeneration: 3,
			durable: { status: 'missing' },
		},
		settingsFingerprint: 'a'.repeat(64),
		pinnedGeneration: 1,
		activeTrackerGeneration: 1,
		repeatSeriesRevision: 1,
		projectSerialGeneration: 1,
		projectSerialSignature: 'b'.repeat(64),
	};
	return {
		bridge,
		provider,
		index,
		settings,
		sourceHydrator: source,
		execution: {
			revision,
			freshness: {
				source: 'live-runtime',
				coherence: 'verified',
				observedAt: '2026-01-15T10:20:30.000Z',
				settled: true,
			},
		},
		sources,
		reindexed,
		readCounts,
	};
}

class FixtureIndex implements IndexContextReadPortV1 {
	private readonly byId: Map<string, IndexedTask>;
	private readonly duplicateIds = new Set<string>();

	constructor(tasks: IndexedTask[]) {
		this.byId = new Map(tasks.map(taskValue => [taskValue.operonId, taskValue]));
	}

	getTaskSnapshot(operonId: string): IndexedTask | undefined {
		return this.byId.get(operonId);
	}

	markDuplicate(operonId: string): void {
		this.duplicateIds.add(operonId);
	}

	addTask(taskValue: IndexedTask): void {
		this.byId.set(taskValue.operonId, taskValue);
	}

	getAllTaskSnapshots(): readonly IndexedTask[] {
		return [...this.byId.values()];
	}

	getDuplicateInstanceSnapshots(operonId: string): readonly IndexedTaskInstance[] {
		const taskValue = this.byId.get(operonId);
		return this.duplicateIds.has(operonId) && taskValue ? [asInstance(taskValue)] : [];
	}

	getAllDuplicateInstanceSnapshots(): readonly IndexedTaskInstance[] {
		return [...this.duplicateIds]
			.map(operonId => this.byId.get(operonId))
			.filter((taskValue): taskValue is IndexedTask => !!taskValue)
			.map(asInstance);
	}

	getTaskIdsInFileSnapshot(filePath: string): readonly string[] {
		return [...this.byId.values()].filter(value => value.primary.filePath === filePath).map(value => value.operonId);
	}

	getChildIdsSnapshot(parentOperonId: string): readonly string[] {
		return [...this.byId.values()]
			.filter(value => value.fieldValues['parentTask'] === parentOperonId)
			.map(value => value.operonId);
	}

	getTaskIdsByWorkflowStatusSnapshot(statusValue: string): readonly string[] {
		return [...this.byId.values()].filter(value => value.fieldValues['status'] === statusValue).map(value => value.operonId);
	}

	getTaskIdsByPrioritySnapshot(priorityValue: string): readonly string[] {
		return [...this.byId.values()].filter(value => value.fieldValues['priority'] === priorityValue).map(value => value.operonId);
	}

	getTaskIdsDueInRangeSnapshot(_startDate: string, _endDate: string): readonly string[] {
		return [];
	}

	getOpenTaskIdsSnapshot(): readonly string[] {
		return [...this.byId.values()].filter(value => value.checkbox === 'open').map(value => value.operonId);
	}

	getLiveReadAuthoritySnapshot() {
		return { state: 'verified' as const, ramGeneration: 3 };
	}
}

function asInstance(taskValue: IndexedTask): IndexedTaskInstance {
	return {
		...taskValue,
		instanceKey: [
			taskValue.primary.filePath,
			taskValue.primary.lineNumber,
			taskValue.primary.format,
		].join('\u0000'),
	};
}

function task(
	operonId: string,
	description: string,
	lineNumber: number,
	status: string,
	priority: string,
	parentTask: string,
): IndexedTask {
	return {
		operonId,
		description,
		checkbox: 'open',
		fieldValues: {
			operonId,
			status,
			priority,
			...(parentTask ? { parentTask } : {}),
		},
		tags: [],
		primary: { format: 'inline', filePath: 'Tasks.md', lineNumber },
		datetimeModified: '',
		tier: 'hot',
	};
}

function taskLine(
	description: string,
	operonId: string,
	status: string,
	priority: string,
	parentTask: string,
): string {
	return `- [ ] ${description} {{operonId:: ${operonId}}} {{status:: ${status}}} {{priority:: ${priority}}}${parentTask ? ` {{parentTask:: ${parentTask}}}` : ''}`;
}
