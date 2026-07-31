import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
	compileCompactCreateBatchIntentV1,
	compileCompactCreateIntentV1,
	parseCompactCreateArgvV1,
	parseCompactCreateInputV1,
	parseCompactCreateLinesInputV1,
	parseCompactListV1,
} from '../../../packages/operon-cli/src/compact-create';
import type { GuidedCreationModelV1 } from '../../../packages/operon-cli/src/guided-creation';
import type { FieldDescriptorV1 } from '../../../src/agent-runtime/contracts/v1';

declare global {
	var __operonCompactCreateTestRun: Promise<void> | undefined;
}

globalThis.__operonCompactCreateTestRun = Promise.resolve().then(run);

interface GoldenCase {
	id: string;
	channel: 'argv' | 'stdin';
	argv?: string[];
	input?: string;
	displayCommand?: string;
	expect: {
		route: 'legacy-guided' | 'compact' | 'error';
		code?: string;
		description?: string;
		representation?: 'inline' | 'file' | null;
		target?: { representation?: 'inline' | 'file'; mode: 'configured-default' };
		assignments?: Array<{
			key: string;
			value: string;
			valueType: string;
			items?: string[];
			canonical?: string;
		}>;
	};
}

function run(): void {
	const golden = JSON.parse(readFileSync(
		path.resolve(process.cwd(), 'scripts/agent-runtime/fixtures/compact-create-golden.json'),
		'utf8',
	)) as { cases: GoldenCase[] };
	testGoldenCases(golden.cases);
	testLists();
	testCompactLines();
	testCompiler();
	testCompilerRefusals();
	console.log('Compact create parser/compiler tests passed');
}

function testCompactLines(): void {
	const lf = parseCompactCreateLinesInputV1(
		'"First" note::"One"\nfile "Second" priority::"A"\n',
	);
	assert.equal(lf.length, 2);
	assert.equal(lf[0]?.description, 'First');
	assert.equal(lf[1]?.description, 'Second');
	assert.equal(lf[1]?.representation, 'file');
	const crlf = parseCompactCreateLinesInputV1('"First"\r\n"Second"\r\n');
	assert.deepEqual(crlf.map(item => item.description), ['First', 'Second']);
	expectCode(
		() => parseCompactCreateLinesInputV1('"First"\n\n"Second"'),
		'COMPACT_BATCH_BLANK_LINE',
	);
	expectCode(() => parseCompactCreateLinesInputV1(''), 'COMPACT_BATCH_EMPTY');
	expectCode(
		() => parseCompactCreateLinesInputV1('"First"\r"Second"'),
		'COMPACT_BATCH_LINE_ENDING_INVALID',
	);
	expectCode(
		() => parseCompactCreateLinesInputV1(
			Array.from({ length: 65 }, (_item, index) => `"Task ${index}"`).join('\n'),
		),
		'COMPACT_BATCH_TOO_MANY_ITEMS',
	);
	const intent = compileCompactCreateBatchIntentV1({
		asts: lf,
		model: creationModel(false),
		itemRefs: ['batch-1', 'batch-2'],
	});
	assert.equal(intent.reason, 'Compact multi-create.');
	assert.deepEqual(
		intent.spec.items.map(item => ({
			itemRef: item.itemRef,
			description: item.description,
			target: item.target,
		})),
		[
			{
				itemRef: 'batch-1',
				description: 'First',
				target: { mode: 'configured-default' },
			},
			{
				itemRef: 'batch-2',
				description: 'Second',
				target: { representation: 'file', mode: 'configured-default' },
			},
		],
	);
	const unavailable = creationModel(false);
	delete unavailable.policies.creation.compactBatchInputFormat;
	expectCode(
		() => compileCompactCreateBatchIntentV1({
			asts: lf,
			model: unavailable,
			itemRefs: ['batch-1', 'batch-2'],
		}),
		'COMPACT_BATCH_CAPABILITY_UNAVAILABLE',
	);
}

function testGoldenCases(cases: GoldenCase[]): void {
	const cliOnly = new Set([
		'compact-positional-input-conflict',
		'input-format-requires-input',
	]);
	for (const testCase of cases) {
		if (cliOnly.has(testCase.id)) continue;
		if (testCase.expect.route === 'error') {
			expectCode(
				() => compileGoldenCase(testCase),
				testCase.expect.code ?? '',
			);
			continue;
		}
		const parsed = parseGoldenCase(testCase);
		assert.equal(parsed.route, testCase.expect.route, testCase.id);
		if (parsed.route === 'legacy-guided') {
			if (testCase.expect.description !== undefined) {
				assert.equal(parsed.initialDescription, testCase.expect.description, testCase.id);
			}
			continue;
		}
		assertGoldenAst(testCase, parsed.ast);
		const intent = compileCompactCreateIntentV1({
			ast: parsed.ast,
			model: creationModel(false),
			itemRef: testCase.id,
		});
		const item = intent.spec.items[0];
		if (testCase.expect.target) {
			assert.deepEqual(item.target, testCase.expect.target, testCase.id);
		}
		assertGoldenCompiledAssignments(testCase, item);
		assertDisplayCommandParity(testCase, item);
	}
}

function assertDisplayCommandParity(
	testCase: GoldenCase,
	expectedItem: ReturnType<typeof compileCompactCreateIntentV1>['spec']['items'][number],
): void {
	if (!testCase.displayCommand) return;
	const tokens = tokenizeHumanCommand(testCase.displayCommand);
	assert.deepEqual(tokens.slice(0, 3), ['operon', 'task', 'create'], testCase.id);
	const parsed = parseCompactCreateArgvV1(tokens.slice(3));
	assert.equal(parsed.route, 'compact', testCase.id);
	if (parsed.route !== 'compact') return;
	const displayIntent = compileCompactCreateIntentV1({
		ast: parsed.ast,
		model: displayCreationModel(testCase.displayCommand),
		itemRef: testCase.id,
	});
	assert.deepEqual(displayIntent.spec.items[0], expectedItem, `${testCase.id}/displayCommand`);
}

function displayCreationModel(command: string): GuidedCreationModelV1 {
	const model = creationModel(false);
	if (command.includes('status::"EXACT LIVE PIPELINE.STATUS"')) {
		model.pipelines[0] = {
			...model.pipelines[0],
			name: 'EXACT LIVE PIPELINE',
			statuses: model.pipelines[0].statuses.map(status => ({
				...status,
				label: 'STATUS',
			})),
		};
	}
	if (command.includes('priority::"EXACT LIVE PRIORITY"')) {
		model.priorities[0] = {
			...model.priorities[0],
			label: 'EXACT LIVE PRIORITY',
		};
	}
	return model;
}

function tokenizeHumanCommand(command: string): string[] {
	const tokens: string[] = [];
	let current = '';
	let quoted = false;
	let started = false;
	for (const character of command) {
		if (character === '"') {
			quoted = !quoted;
			started = true;
		} else if (/\s/u.test(character) && !quoted) {
			if (started) {
				tokens.push(current);
				current = '';
				started = false;
			}
		} else {
			current += character;
			started = true;
		}
	}
	assert.equal(quoted, false, 'displayCommand has an unclosed quote');
	if (started) tokens.push(current);
	return tokens;
}

function parseGoldenCase(testCase: GoldenCase) {
	if (testCase.channel === 'stdin') {
		return { route: 'compact' as const, ast: parseCompactCreateInputV1(testCase.input ?? '') };
	}
	const positionals = (testCase.argv ?? []).slice(2);
	const firstFlag = positionals.findIndex(token => token.startsWith('--'));
	return parseCompactCreateArgvV1(firstFlag < 0 ? positionals : positionals.slice(0, firstFlag));
}

function compileGoldenCase(testCase: GoldenCase): void {
	const parsed = parseGoldenCase(testCase);
	if (parsed.route !== 'compact') throw new Error('EXPECTED_COMPACT_ROUTE');
	compileCompactCreateIntentV1({
		ast: parsed.ast,
		model: creationModel(false),
		itemRef: testCase.id,
	});
}

function assertGoldenAst(
	testCase: GoldenCase,
	ast: ReturnType<typeof compact>,
): void {
	if (testCase.expect.description !== undefined) {
		assert.equal(ast.description, testCase.expect.description, testCase.id);
	}
	if (testCase.expect.representation !== undefined) {
		assert.equal(ast.representation, testCase.expect.representation, testCase.id);
	}
	assert.deepEqual(
		ast.assignments,
		(testCase.expect.assignments ?? []).map(({ key, value }) => ({ key, value })),
		testCase.id,
	);
	for (const assignment of testCase.expect.assignments ?? []) {
		if (!assignment.items) continue;
		assert.deepEqual(parseCompactListV1(assignment.value, assignment.key), {
			items: assignment.items,
			canonical: assignment.canonical,
		}, testCase.id);
	}
}

function assertGoldenCompiledAssignments(
	testCase: GoldenCase,
	item: ReturnType<typeof compileCompactCreateIntentV1>['spec']['items'][number],
): void {
	const fields: unknown[] = [];
	let recurrenceRule: string | undefined;
	let recurrenceEndDatetime: string | undefined;
	for (const assignment of testCase.expect.assignments ?? []) {
		if (assignment.valueType === 'status') {
			assert.equal(item.statusId, 'status-planned', testCase.id);
		} else if (assignment.valueType === 'priority') {
			assert.equal(item.priorityId, 'priority-a', testCase.id);
		} else if (assignment.key === 'tags') {
			assert.deepEqual(item.tags, assignment.items, testCase.id);
		} else if (assignment.key === 'parentTask') {
			assert.deepEqual(
				item.parent,
				{ kind: 'existing', operonId: assignment.value },
				testCase.id,
			);
		} else if (assignment.valueType === 'reminder-datetimes') {
			fields.push({ kind: 'reminder-datetimes', values: assignment.items });
		} else if (assignment.valueType === 'reminder-rules') {
			fields.push({ kind: 'reminder-rules', values: assignment.items });
		} else if (assignment.valueType === 'recurrence-rule') {
			recurrenceRule = assignment.canonical ?? assignment.value;
		} else if (assignment.valueType === 'recurrence-end') {
			recurrenceEndDatetime = assignment.canonical ?? assignment.value;
		} else if (assignment.key === 'review lane') {
			fields.push({
				kind: 'custom',
				field: assignment.key,
				valueType: 'text',
				value: assignment.value,
			});
		} else if (assignment.valueType === 'date' || assignment.valueType === 'datetime') {
			fields.push({
				kind: assignment.valueType,
				field: assignment.key,
				value: assignment.value,
			});
		} else if (assignment.valueType === 'number') {
			fields.push({
				kind: 'number',
				field: assignment.key,
				value: Number(assignment.value),
			});
		} else if (assignment.valueType === 'list') {
			fields.push({ kind: 'list', field: assignment.key, value: assignment.items });
		} else {
			fields.push({ kind: 'text', field: assignment.key, value: assignment.value });
		}
	}
	if (recurrenceRule) {
		fields.push({
			kind: 'recurrence',
			rule: recurrenceRule,
			...(recurrenceEndDatetime ? { endDatetime: recurrenceEndDatetime } : {}),
		});
	}
	assert.deepEqual(item.fields, fields, testCase.id);
}

function testLists(): void {
	assert.deepEqual(
		parseCompactListV1('Customer Support;Mobile Application; Production Environment'),
		{
			items: ['Customer Support', 'Mobile Application', 'Production Environment'],
			canonical: 'Customer Support; Mobile Application; Production Environment',
		},
	);
	assert.deepEqual(parseCompactListV1('Research\\; Development; Operon'), {
		items: ['Research; Development', 'Operon'],
		canonical: 'Research\\; Development; Operon',
	});
	expectCode(() => parseCompactListV1('Operon;;Runtime', 'contexts'), 'EMPTY_LIST_ELEMENT');
	expectCode(() => parseCompactListV1('Operon; Operon', 'contexts'), 'DUPLICATE_LIST_ELEMENT');
}

function testCompiler(): void {
	const ast = compact([
		'Create release task',
		'status::Daily.Planned',
		'priority::A',
		'note::Call Casey; bring invoice',
		'contexts::Customer Support; Operon',
		'customList::One item; Two words',
		'customDone::true',
		'parentTask::abc1234',
	]);
	const intent = compileCompactCreateIntentV1({
		ast,
		model: creationModel(false),
		itemRef: 'compact-1',
	});
	assert.deepEqual(intent.spec, {
		operation: 'create',
		items: [{
			itemRef: 'compact-1',
			description: 'Create release task',
			target: { mode: 'configured-default' },
			fields: [
				{ kind: 'text', field: 'note', value: 'Call Casey; bring invoice' },
				{ kind: 'list', field: 'contexts', value: ['Customer Support', 'Operon'] },
				{
					kind: 'custom',
					field: 'customList',
					valueType: 'list',
					value: ['One item', 'Two words'],
				},
				{
					kind: 'custom',
					field: 'customDone',
					valueType: 'checkbox',
					value: true,
				},
			],
			statusId: 'status-planned',
			priorityId: 'priority-a',
			parent: { kind: 'existing', operonId: 'abc1234' },
		}],
	});

	const explicitFile = compileCompactCreateIntentV1({
		ast: compact(['file', 'File task']),
		model: creationModel(false),
		itemRef: 'compact-2',
	});
	assert.deepEqual(explicitFile.spec.items[0].target, {
		representation: 'file',
		mode: 'configured-default',
	});

	const requiredAssignee = compileCompactCreateIntentV1({
		ast: compact(['Assigned task', 'assignees::Casey Morgan; Operon Agent']),
		model: creationModel(true),
		itemRef: 'compact-3',
	});
	assert.deepEqual(requiredAssignee.spec.items[0].fields, [{
		kind: 'list',
		field: 'assignees',
		value: ['Casey Morgan', 'Operon Agent'],
	}]);

	const valueTypes = compileCompactCreateIntentV1({
		ast: compact([
			'Typed fields',
			'dateDue::2026-08-01',
			'datetimeStart::2026-08-01T09:30:00',
			'estimate::90',
			'links::API documentation; Integration guide',
			'tags::backend; urgent',
			'customText::Needs review',
			'customNumber::2.5',
			'customDate::2026-08-02',
			'customDatetime::2026-08-02T14:00:00',
		]),
		model: creationModel(false),
		itemRef: 'compact-4',
	});
	assert.deepEqual(valueTypes.spec.items[0], {
		itemRef: 'compact-4',
		description: 'Typed fields',
		target: { mode: 'configured-default' },
		fields: [
			{ kind: 'date', field: 'dateDue', value: '2026-08-01' },
			{ kind: 'datetime', field: 'datetimeStart', value: '2026-08-01T09:30:00' },
			{ kind: 'number', field: 'estimate', value: 90 },
			{ kind: 'list', field: 'links', value: ['API documentation', 'Integration guide'] },
			{
				kind: 'custom',
				field: 'customText',
				valueType: 'text',
				value: 'Needs review',
			},
			{
				kind: 'custom',
				field: 'customNumber',
				valueType: 'number',
				value: 2.5,
			},
			{
				kind: 'custom',
				field: 'customDate',
				valueType: 'date',
				value: '2026-08-02',
			},
			{
				kind: 'custom',
				field: 'customDatetime',
				valueType: 'datetime',
				value: '2026-08-02T14:00:00',
			},
		],
		tags: ['backend', 'urgent'],
	});

	const temporal = compileCompactCreateIntentV1({
		ast: compact([
			'Temporal fields',
			'reminderDatetimes::2026-08-02T09:00; 2026-08-01T09:00:00',
			'reminderRules::dateDue.30m; datetimeStart.1h',
			'datetimeRepeatEnd::2026-12-31T23:59',
			'repeat::INTERVAL=1|FREQ=DAY|MODE=SCHEDULE',
		]),
		model: creationModel(false),
		itemRef: 'compact-temporal',
	});
	assert.deepEqual(temporal.spec.items[0].fields, [
		{
			kind: 'reminder-datetimes',
			values: ['2026-08-02T09:00:00', '2026-08-01T09:00:00'],
		},
		{
			kind: 'reminder-rules',
			values: ['dateDue.30m', 'datetimeStart.1h'],
		},
		{
			kind: 'recurrence',
			rule: 'mode=schedule|freq=day|interval=1',
			endDatetime: '2026-12-31T23:59:00',
		},
	]);
}

function testCompilerRefusals(): void {
	const model = creationModel(false);
	expectCompileCode(model, ['Test', 'status::daily.planned'], 'INVALID_STATUS');
	expectCompileCode(model, ['Test', 'priority::a'], 'INVALID_PRIORITY');
	expectCompileCode(model, ['Test', 'parentTask::ABC1234'], 'INVALID_PARENT_TASK');
	expectCompileCode(model, ['Test', 'customDone::yes'], 'INVALID_FIELD_VALUE');
	expectCompileCode(model, ['Test', 'customList::One; One'], 'DUPLICATE_LIST_ELEMENT');
	expectCompileCode(
		creationModel(false, false),
		['Test', 'reminderRules::dateDue.30m'],
		'CREATE_CAPABILITY_UNAVAILABLE',
	);
	expectCompileCode(model, ['Test', 'reminderDatetimes::2026-02-30T09:00'], 'INVALID_FIELD_VALUE');
	expectCompileCode(model, ['Test', 'reminderRules::notAnAnchor.30m'], 'INVALID_FIELD_VALUE');
	expectCompileCode(model, ['Test', 'repeat::mode=schedule|freq=day'], 'INVALID_FIELD_VALUE');
	expectCompileCode(model, ['Test', 'datetimeRepeatEnd::2026-12-31T23:59'], 'INVALID_FIELD_VALUE');
	expectCompileCode(
		model,
		['Test', 'reminderDatetimes::2026-08-01T09:00; 2026-08-01T09:00:00'],
		'DUPLICATE_LIST_ELEMENT',
	);
	expectCompileCode(creationModel(true), ['Test', 'note::Missing assignee'], 'REQUIRED_ASSIGNEES_MISSING');

	const unresolvedPriority = creationModel(false);
	unresolvedPriority.priorities[0].identityStatus = 'ambiguous';
	expectCompileCode(unresolvedPriority, ['Test', 'priority::A'], 'INVALID_PRIORITY');

	const mixedPriority = creationModel(false);
	mixedPriority.priorities.unshift({
		...mixedPriority.priorities[0],
		id: 'priority-a-unresolved',
		identityStatus: 'ambiguous',
	});
	const mixedIntent = compileCompactCreateIntentV1({
		ast: compact(['Test', 'priority::A']),
		model: mixedPriority,
		itemRef: 'mixed-priority',
	});
	assert.equal(mixedIntent.spec.items[0].priorityId, 'priority-a');

	const duplicateResolvedPriority = creationModel(false);
	duplicateResolvedPriority.priorities.push({
		...duplicateResolvedPriority.priorities[0],
		id: 'priority-a-duplicate',
	});
	expectCompileCode(
		duplicateResolvedPriority,
		['Test', 'priority::A'],
		'AMBIGUOUS_PRIORITY',
	);
}

function compact(tokens: string[]) {
	const parsed = parseCompactCreateArgvV1(tokens);
	assert.equal(parsed.route, 'compact');
	if (parsed.route !== 'compact') throw new Error('EXPECTED_COMPACT_ROUTE');
	return parsed.ast;
}

function expectCompileCode(
	model: GuidedCreationModelV1,
	tokens: string[],
	code: string,
): void {
	expectCode(() => compileCompactCreateIntentV1({
		ast: compact(tokens),
		model,
		itemRef: 'compact-error',
	}), code);
}

function expectCode(action: () => unknown, code: string): void {
	assert.throws(action, error => (
		error instanceof Error
		&& 'code' in error
		&& error.code === code
		&& error.message === code
	));
}

function creationModel(
	assigneesRequired: boolean,
	temporalCreateAvailable = true,
): GuidedCreationModelV1 {
	return {
		pipelines: [{
			id: 'pipeline-daily',
			name: 'Daily',
			description: 'Daily pipeline',
			order: 1,
			identityStatus: 'resolved',
			statuses: [{
				id: 'status-planned',
				label: 'Planned',
				order: 1,
				color: '#123456',
				isFinished: false,
				isCancelled: false,
				isScheduledTarget: true,
				isTrackingTarget: false,
				identityStatus: 'resolved',
			}],
		}],
		priorities: [{
			id: 'priority-a',
			label: 'A',
			description: 'High priority',
			order: 1,
			color: '#654321',
			isDefault: true,
			identityStatus: 'resolved',
		}],
		fields: [
			field('status', 'text', 'semantic-capability'),
			field('priority', 'text'),
			field('note', 'text'),
			field('contexts', 'list'),
			field('assignees', 'list'),
			field('tags', 'list'),
			field('dateDue', 'date'),
			field('dateScheduled', 'date'),
			field('dateStarted', 'date'),
			field('datetimeStart', 'datetime'),
			field('datetimeEnd', 'datetime'),
			field('estimate', 'number'),
			field('links', 'list'),
			field('location', 'text'),
			field('taskColor', 'text'),
			field('taskIcon', 'text'),
			field('operonId', 'text', 'runtime-owned'),
			field('customList', 'list', 'general-update', 'custom'),
			field('customDone', 'checkbox', 'general-update', 'custom'),
			field('review lane', 'text', 'general-update', 'custom'),
			field('customText', 'text', 'general-update', 'custom'),
			field('customNumber', 'number', 'general-update', 'custom'),
			field('customDate', 'date', 'general-update', 'custom'),
			field('customDatetime', 'datetime', 'general-update', 'custom'),
		],
		policies: {
			creation: {
				descriptionRequired: true,
				assigneesRequired,
				defaultEstimateMinutes: 30,
				defaultToFileTask: false,
				fileTaskTargetFolder: 'TaskNotes',
				fileTaskTemplateFolder: 'Templates',
				inlineTaskSaveMode: 'daily-notes',
				inlineTaskTargetFile: '',
				inlineTaskHeading: 'Tasks',
				dailyNoteAddsStartDate: false,
				dailyNoteAddsScheduledDate: false,
				createDailyNotesAsFileTasks: false,
				calendarInlineTaskHeading: 'Tasks',
				builtInTemplateCandidates: [],
				compactBatchVersion: 1,
				compactBatchInputFormat: 'compact-lines',
				compactBatchMaxItems: 64,
				...(temporalCreateAvailable
					? {
						temporalCreateVersion: 1 as const,
						temporalCreateKeys: [
							'reminderDatetimes',
							'reminderRules',
							'repeat',
							'datetimeRepeatEnd',
						] as const,
					}
					: {}),
			},
		} as unknown as GuidedCreationModelV1['policies'],
		defaultPipelineId: 'pipeline-daily',
		defaultPipelineState: 'resolved',
		defaultPriorityId: 'priority-a',
		defaultPriorityState: 'resolved',
	};
}

function field(
	canonicalKey: string,
	valueType: FieldDescriptorV1['valueType'],
	mutationClass: FieldDescriptorV1['mutationClass'] = 'general-update',
	source: FieldDescriptorV1['source'] = 'built-in',
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
		requiresStableTaxonomyId: canonicalKey === 'status' || canonicalKey === 'priority',
	};
}
