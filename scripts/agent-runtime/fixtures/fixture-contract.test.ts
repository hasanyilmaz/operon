import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { buildTaskLine } from '../../../src/core/serializer';
import { parseListValue, parseTaskLine } from '../../../src/core/parser';
import {
	buildMergedFileTaskDraft,
	parseFrontmatterDocument,
} from '../../../src/core/file-task-template-merge';
import {
	isManagedTaskFieldCanonicalKey,
	isReadableTaskFieldCanonicalKey,
} from '../../../src/core/managed-task-fields';
import { resolveSubtaskInitialFieldsFromParentValues } from '../../../src/core/subtask-inheritance';
import { parseAbsoluteReminder, parseReminderRule } from '../../../src/core/reminder-rules';
import { parseRepeatRule } from '../../../src/core/repeat-rule';
import { DEFAULT_SETTINGS, type KeyMapping, type OperonSettings } from '../../../src/types/settings';
import type { Pipeline } from '../../../src/types/pipeline';
import { decodeMutationPreviewRequestV1 } from '../../../src/agent-runtime/contracts/v1/decode';

interface CanonicalGolden {
	inline: {
		remindersCustomUnicode: {
			id: string;
			description: string;
			checkbox: 'open' | 'done' | 'cancelled';
			tags: string[];
			fields: Record<string, string>;
			expected: string;
		};
		checkboxes: Array<{
			state: 'open' | 'done' | 'cancelled';
			expectedPrefix: string;
		}>;
	};
	inheritance: {
		parentTaskId: string;
		parentFields: Record<string, string>;
		parentTags: string[];
		expected: Record<string, string | string[]>;
	};
	fileTask: {
		expectedOrderedYamlKeys: string[];
		expectedBody: string;
	};
}

interface CompactCreateGolden {
	schemaVersion: 1;
	contract: {
		command: 'operon task create';
		representation: 'optional-inline-or-file';
		fieldKeys: 'canonical-only';
		duplicateKeys: 'reject';
		listDelimiter: 'semicolon-canonical-space';
		rawStdinQuotes: 'straight-double-required';
		inlineValueParity: 'semantic-values-only';
		temporalCreate: 'atomic-v1';
		temporalCreateVersion: 1;
		temporalCreateKeys: [
			'reminderDatetimes',
			'reminderRules',
			'repeat',
			'datetimeRepeatEnd',
		];
	};
	serializerFixture: {
		file: 'canonical-golden.json';
		caseId: string;
	};
	cases: Array<{
		id: string;
		channel: 'argv' | 'stdin';
		argv?: string[];
		inputFormat?: 'compact';
		input?: string;
		expect: {
			route: 'legacy-guided' | 'compact' | 'error';
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
			action?: 'preview';
			output?: 'json';
			applies?: boolean;
			capability?: 'create-capability-unavailable';
			code?: string;
		};
	}>;
}

interface CompactUpdateGolden {
	version: 1;
	cases: Array<{
		id: string;
		assignments: string[];
		clear: string[];
		expect: {
			assignments?: Array<{ key: string; value: string }>;
			clear?: string[];
			code?: string;
		};
	}>;
}

interface TypedCreateGolden {
	schemaVersion: 1;
	contract: {
		command: 'operon task create';
		inputFormat: 'typed-json';
		typedCreateVersion: 1;
		typedCreateFeatures: string[];
		lineNumberBase: 'zero';
		linePlacement: 'insert-before';
		fileBodyMaxUtf8Bytes: 65_536;
		crossSourceParentRelated: 'fresh-confirmation';
		crossSourceDependency: 'graph-transaction-gated';
	};
	cases: Array<{
		id: string;
		feature: string;
		templateCandidate?: {
			id: string;
			name: string;
			kind: 'builtin-pipeline-minimal' | 'folder';
			sourcePath?: string;
			pipelineId?: string;
			initialStatusId?: string;
		};
		intent: {
			contractVersion: 1;
			kind: 'mutation-intent';
			reason: string;
			spec: unknown;
		};
		expect: Record<string, unknown>;
	}>;
}

const fixtureRoot = process.env.OPERON_FIXTURE_ROOT;
if (!fixtureRoot) throw new Error('OPERON_FIXTURE_ROOT is required.');

const golden = JSON.parse(
	readFileSync(path.join(fixtureRoot, 'canonical-golden.json'), 'utf8'),
) as CanonicalGolden;
const compactCreateGolden = JSON.parse(
	readFileSync(path.join(fixtureRoot, 'compact-create-golden.json'), 'utf8'),
) as CompactCreateGolden;
const compactUpdateGolden = JSON.parse(
	readFileSync(path.join(fixtureRoot, 'compact-update-golden.json'), 'utf8'),
) as CompactUpdateGolden;
const typedCreateGolden = JSON.parse(
	readFileSync(path.join(fixtureRoot, 'typed-create-golden.json'), 'utf8'),
) as TypedCreateGolden;
const graphTransactionGolden = JSON.parse(
	readFileSync(path.join(fixtureRoot, 'graph-transaction-golden.json'), 'utf8'),
) as {
	schemaVersion: 1;
	contract: {
		graphTransactionVersion: 1;
		graphTransactionFeatures: string[];
		maxJournalUtf8Bytes: 8_388_608;
		recoveryPlanPolicy: 'same-plan-only';
	};
	cases: Array<{
		id: string;
		typedCreateCaseId: string;
		phase: string;
		expect: 'forward-completed' | 'compensated' | 'unresolved';
	}>;
};
const templateContent = readFileSync(path.join(fixtureRoot, 'template-fixture-task.md'), 'utf8');

const visibleNames: Record<string, string> = {
	operonId: 'Operon ID',
	status: 'Status',
	priority: 'Priority',
	reminderDatetimes: 'Reminder Datetimes',
	reminderRules: 'Reminder Rules',
	datetimeCreated: 'Created',
	datetimeModified: 'Updated',
};
const systemMappings = DEFAULT_SETTINGS.keyMappings.map(mapping => ({
	...mapping,
	visiblePropertyName: visibleNames[mapping.canonicalKey] ?? mapping.visiblePropertyName,
}));
const fixtureTopicMapping = {
	canonicalKey: 'fixtureTopic',
	visiblePropertyName: 'Fixture Topic',
	type: 'text',
	description: 'Portable custom field used only by Phase 1 fixtures.',
	isSystem: false,
	isInternal: false,
	customOrder: 0,
} as unknown as KeyMapping;
const keyMappings = [...systemMappings, fixtureTopicMapping];

const richInline = golden.inline.remindersCustomUnicode;
assert.equal(
	buildTaskLine(richInline.description, richInline.fields, {
		checkbox: richInline.checkbox,
		tags: richInline.tags,
		keyMappings,
	}),
	richInline.expected,
	'canonical rich inline task output drifted',
);

for (const checkbox of golden.inline.checkboxes) {
	const line = buildTaskLine('Checkbox baseline', { operonId: 'state01' }, {
		checkbox: checkbox.state,
		keyMappings,
	});
	assert.ok(line.startsWith(checkbox.expectedPrefix), `checkbox ${checkbox.state} drifted`);
}

assert.equal(isManagedTaskFieldCanonicalKey('reminders', keyMappings), false);
assert.equal(isManagedTaskFieldCanonicalKey('reminderDatetimes', keyMappings), true);
assert.equal(isManagedTaskFieldCanonicalKey('reminderRules', keyMappings), true);
assert.equal(isManagedTaskFieldCanonicalKey('fixtureTopic', keyMappings), true);
assert.equal(
	keyMappings.find(mapping => mapping.canonicalKey === 'reminderDatetimes')?.type,
	'list',
);
assert.equal(
	keyMappings.find(mapping => mapping.canonicalKey === 'reminderRules')?.type,
	'list',
);

const workPipeline: Pipeline = {
	id: 'pipeline-work',
	name: 'Work',
	description: 'Synthetic fixture workflow.',
	statuses: [
		{
			id: 'status-inbox',
			label: 'Inbox',
			color: '#808080',
			isFinished: false,
			isCancelled: false,
			isScheduledTarget: false,
			isTrackingTarget: false,
			propertyMapping: null,
		},
		{
			id: 'status-active',
			label: 'Active',
			color: '#336699',
			isFinished: false,
			isCancelled: false,
			isScheduledTarget: false,
			isTrackingTarget: true,
			propertyMapping: null,
		},
		{
			id: 'status-done',
			label: 'Done',
			color: '#339966',
			isFinished: true,
			isCancelled: false,
			isScheduledTarget: false,
			isTrackingTarget: false,
			propertyMapping: null,
		},
	],
};
const inheritanceSettings = {
	...DEFAULT_SETTINGS,
	pipelines: [workPipeline],
	defaultPipelineName: 'Work',
	defaultPriority: 'P2',
	keyMappings,
	childTaskInheritanceFields: [
		'status',
		'priority',
		'taskIcon',
		'taskColor',
		'fixtureTopic',
		'tags',
	],
	childTaskInheritanceStatusPipelineSource: 'parent',
} as OperonSettings;
assert.deepEqual(
	resolveSubtaskInitialFieldsFromParentValues(
		golden.inheritance.parentTaskId,
		golden.inheritance.parentFields,
		inheritanceSettings,
		golden.inheritance.parentTags,
	),
	golden.inheritance.expected,
	'canonical child inheritance drifted',
);

const template = parseFrontmatterDocument(templateContent, keyMappings);
const fileFields: Record<string, string> = {
	status: 'Work.Active',
	priority: 'P1',
	reminderDatetimes: '2026-01-16T09:00:00; 2026-01-17T10:30:00',
	reminderRules: 'dateDue.30m',
	fixtureTopic: 'Templates',
	datetimeCreated: '2026-01-15T10:20:30',
	datetimeModified: '2026-01-15T10:20:30',
};
const merged = buildMergedFileTaskDraft({
	source: {
		description: 'Template task',
		fieldValues: fileFields,
		fieldPresence: new Set(Object.keys(fileFields)),
		tags: ['fixture', 'preserved'],
		tagsPresent: true,
	},
	template,
	defaults: {
		operonId: 'file001',
		status: 'Work.Inbox',
		priority: 'P2',
		datetimeCreated: '2026-01-15T10:20:30',
		datetimeModified: '2026-01-15T10:20:30',
	},
	keyMappings,
	bodyStrategy: 'use-template',
});
assert.deepEqual(
	merged.orderedYamlKeys,
	golden.fileTask.expectedOrderedYamlKeys,
	'canonical file-task property order drifted',
);
assert.equal(merged.body, golden.fileTask.expectedBody);
assert.match(merged.content, /Unmanaged Field: Keep me/);
assert.match(merged.content, /Reminder Datetimes:/);
assert.match(merged.content, /Reminder Rules:/);
assert.match(
	merged.content,
	/Reminder Datetimes:\n {2}- 2026-01-16T09:00:00\n {2}- 2026-01-17T10:30:00/u,
);
assert.match(merged.content, /Reminder Rules:\n {2}- dateDue.30m/u);
const reminderRoundTrip = parseFrontmatterDocument(merged.content, keyMappings);
assert.equal(
	reminderRoundTrip.managedFieldValues.reminderDatetimes,
	'2026-01-16T09:00:00; 2026-01-17T10:30:00',
);
assert.equal(reminderRoundTrip.managedFieldValues.reminderRules, 'dateDue.30m');
assert.match(merged.content, /Fixture Topic: Templates/);

assert.equal(compactCreateGolden.schemaVersion, 1);
assert.deepEqual(compactCreateGolden.contract, {
	command: 'operon task create',
	representation: 'optional-inline-or-file',
	fieldKeys: 'canonical-only',
	duplicateKeys: 'reject',
	listDelimiter: 'semicolon-canonical-space',
	rawStdinQuotes: 'straight-double-required',
	inlineValueParity: 'semantic-values-only',
	temporalCreate: 'atomic-v1',
	temporalCreateVersion: 1,
	temporalCreateKeys: [
		'reminderDatetimes',
		'reminderRules',
		'repeat',
		'datetimeRepeatEnd',
	],
});
assert.deepEqual(compactCreateGolden.serializerFixture, {
	file: 'canonical-golden.json',
	caseId: golden.inline.remindersCustomUnicode.id,
});
const compactCases = new Map(compactCreateGolden.cases.map(item => [item.id, item]));
const compactUpdateCases = new Map(compactUpdateGolden.cases.map(item => [item.id, item]));
assert.equal(compactUpdateGolden.version, 1);
assert.equal(compactUpdateCases.size, compactUpdateGolden.cases.length);
assert.deepEqual(compactUpdateCases.get('multi-set-clear')?.expect.clear, ['dateDue', 'location']);
assert.equal(compactUpdateCases.get('duplicate-set')?.expect.code, 'DUPLICATE_KEY');
assert.equal(compactUpdateCases.get('duplicate-clear')?.expect.code, 'DUPLICATE_CLEAR');
assert.equal(compactUpdateCases.get('set-clear-conflict')?.expect.code, 'SET_CLEAR_CONFLICT');
assert.equal(compactUpdateCases.get('empty-update')?.expect.code, 'UPDATE_CHANGES_REQUIRED');
assert.equal(compactCases.get('legacy-empty-create')?.expect.route, 'legacy-guided');
assert.equal(compactCases.get('legacy-single-description')?.expect.route, 'legacy-guided');
assert.equal(compactCases.get('legacy-single-inline-word')?.expect.route, 'legacy-guided');
assert.deepEqual(compactCases.get('configured-default-representation')?.expect, {
	route: 'compact',
	description: 'Test task',
	representation: null,
	target: { mode: 'configured-default' },
	assignments: [{ key: 'status', value: 'Daily.Planned', valueType: 'status' }],
});
assert.deepEqual(compactCases.get('explicit-inline-without-fields')?.expect.target, {
	representation: 'inline',
	mode: 'configured-default',
});
assert.equal(compactCases.get('inline-description-with-omitted-representation')?.expect.representation, null);

const expectedCanonicalLists: Record<string, string> = {
	'list-spacing-and-multiword-items': 'Customer Support; Mobile Application; Production Environment',
	'list-escaped-semicolon': 'Research\\; Development; Operon',
	'raw-compact-stdin-valid': 'Customer Support; Operon',
};
for (const caseId of Object.keys(expectedCanonicalLists)) {
	const assignment = compactCases.get(caseId)?.expect.assignments?.find(item => item.valueType === 'list');
	assert.ok(assignment?.items, `missing list expectation for ${caseId}`);
	assert.deepEqual(parseListValue(assignment.value), assignment.items);
	assert.equal(assignment.canonical, expectedCanonicalLists[caseId]);
}

assert.equal(
	compactCases.get('scalar-semicolon-literal')?.expect.assignments?.[0]?.value,
	'Call contact; bring the invoice',
);
assert.equal(
	compactCases.get('scalar-double-colon-value')?.expect.assignments?.[0]?.value,
	'English :: note',
);
assert.equal(compactCases.get('empty-list-element-rejected')?.expect.code, 'EMPTY_LIST_ELEMENT');
assert.equal(compactCases.get('duplicate-key-rejected')?.expect.code, 'DUPLICATE_KEY');
assert.equal(compactCases.get('unknown-canonical-key-rejected')?.expect.code, 'UNKNOWN_CANONICAL_KEY');
assert.equal(compactCases.get('visible-property-name-rejected')?.expect.code, 'UNKNOWN_CANONICAL_KEY');
assert.equal(compactCases.get('runtime-owned-key-rejected')?.expect.code, 'FIELD_NOT_WRITABLE');
assert.equal(compactCases.get('raw-compact-stdin-valid')?.expect.route, 'compact');
assert.equal(compactCases.get('raw-compact-stdin-missing-quotes')?.expect.code, 'COMPACT_VALUE_QUOTE_REQUIRED');
assert.equal(compactCases.get('raw-compact-stdin-smart-quotes')?.expect.code, 'COMPACT_VALUE_QUOTE_REQUIRED');
assert.equal(compactCases.get('compact-positional-input-conflict')?.expect.code, 'COMPACT_INPUT_CONFLICT');
assert.equal(compactCases.get('input-format-requires-input')?.expect.code, 'INPUT_FORMAT_REQUIRES_INPUT');
assert.deepEqual(compactCases.get('preview-only-json-is-preview')?.expect, {
	route: 'compact',
	description: 'Test task',
	representation: null,
	target: { mode: 'configured-default' },
	assignments: [{ key: 'status', value: 'Daily.Planned', valueType: 'status' }],
	action: 'preview',
	output: 'json',
	applies: false,
});
for (const caseId of [
	'absolute-reminder-create-valid',
	'reminder-rule-create-valid',
	'recurrence-create-valid',
	'repeat-end-create-valid',
]) {
	assert.equal(compactCases.get(caseId)?.expect.route, 'compact');
}
assert.ok(compactCases.get('reminder-rule-create-valid')?.expect.assignments?.some(
	assignment => assignment.key === 'dateDue',
));
assert.ok(compactCases.get('repeat-end-create-valid')?.expect.assignments?.some(
	assignment => assignment.key === 'repeat',
));
assert.equal(parseAbsoluteReminder('2026-08-01T09:00:00').ok, true);
assert.equal(parseReminderRule('dateDue.30m').ok, true);
assert.ok(parseRepeatRule('mode=schedule|freq=day|interval=1'));
assert.equal(isManagedTaskFieldCanonicalKey('related', keyMappings), false);
assert.equal(isReadableTaskFieldCanonicalKey('related', keyMappings), true);
const canonicalSerializerCase = golden.inline.remindersCustomUnicode;
assert.equal(canonicalSerializerCase.id, compactCreateGolden.serializerFixture.caseId);
assert.equal(
	parseTaskLine(canonicalSerializerCase.expected, 0, 'Fixture.md', keyMappings)?.fields
		.find(field => field.key === 'reminderRules')?.value,
	'dateDue.30m',
);

const expectedTypedCreateFeatures = [
	'exact-inline-placement',
	'exact-file-target',
	'deterministic-file-template',
	'file-body-replacement',
	'same-source-task-graph',
	'cross-source-parent-related',
];
const expectedGraphTransactionFeatures = [
	'vault-wide-graph-transaction',
	'compare-aware-compensation',
	'same-plan-safe-continuation',
	'cross-source-reciprocal-dependency',
];
assert.equal(typedCreateGolden.schemaVersion, 1);
assert.deepEqual(typedCreateGolden.contract, {
	command: 'operon task create',
	inputFormat: 'typed-json',
	typedCreateVersion: 1,
	typedCreateFeatures: expectedTypedCreateFeatures,
	lineNumberBase: 'zero',
	linePlacement: 'insert-before',
	fileBodyMaxUtf8Bytes: 65_536,
	crossSourceParentRelated: 'fresh-confirmation',
	crossSourceDependency: 'graph-transaction-gated',
	graphTransactionVersion: 1,
	graphTransactionFeatures: expectedGraphTransactionFeatures,
});
const typedCases = new Map(typedCreateGolden.cases.map(item => [item.id, item]));
assert.equal(typedCases.size, typedCreateGolden.cases.length);
assert.deepEqual(
	[...typedCases.keys()],
	[
		'typed-exact-inline-append',
		'typed-exact-inline-line',
		'typed-exact-file-target',
		'typed-builtin-file-template',
		'typed-folder-file-template',
		'typed-file-body-replacement',
		'typed-same-source-parent-child',
		'typed-same-source-related-graph',
		'typed-same-source-dependency-chain',
		'typed-cross-source-parent-warning',
		'typed-cross-source-parent-legacy-blocker',
		'typed-cross-source-dependency-blocker',
		'typed-cross-source-dependency-transaction',
	],
);
for (const [index, fixtureCase] of typedCreateGolden.cases.entries()) {
	assert.equal(fixtureCase.intent.contractVersion, 1);
	assert.equal(fixtureCase.intent.kind, 'mutation-intent');
	assert.ok(fixtureCase.intent.reason.length > 0);
	assert.ok(
		expectedTypedCreateFeatures.includes(fixtureCase.feature),
		`unknown typed create feature in ${fixtureCase.id}`,
	);
	const decoded = decodeMutationPreviewRequestV1({
		contractVersion: 1,
		requestId: `typed-create-fixture-${index}`,
		kind: 'mutation-preview',
		clientInstanceId: 'typed-create-fixture',
		idempotencyKey: `typed-create-fixture-${index}`,
		capability: 'tasks.create.preview',
		mutationKind: 'task.create',
		spec: fixtureCase.intent.spec,
		authorization: {
			basis: 'user-explicit-request',
			reason: fixtureCase.intent.reason,
		},
	});
	assert.equal(
		decoded.ok,
		true,
		`${fixtureCase.id} typed intent drifted: ${decoded.ok ? '' : JSON.stringify(decoded.issues)}`,
	);
}
assert.deepEqual(typedCases.get('typed-exact-inline-line')?.expect, {
	route: 'typed-preview',
	representation: 'inline',
	filePath: '20 Projects/Runtime review.md',
	lineNumber: 7,
	placement: 'insert-before',
	candidateSource: 'placement-candidates',
	riskLevel: 'routine',
});
assert.deepEqual(typedCases.get('typed-cross-source-parent-warning')?.expect, {
	route: 'typed-preview',
	riskLevel: 'elevated',
	warning: 'cross-source-graph-partial-risk',
	requiredAcknowledgement: 'cross-source-graph-partial-risk',
	requiresConfirmation: true,
	freshUserTurn: true,
	requiresGraphTransactionVersion: 1,
	requiresGraphTransactionFeatures: expectedGraphTransactionFeatures,
	sourceGroupOrder: [
		'20 Projects/A parent source.md',
		'20 Projects/Z child source.md',
	],
});
assert.deepEqual(typedCases.get('typed-cross-source-parent-legacy-blocker')?.expect, {
	route: 'error',
	code: 'capability-unavailable',
	feature: 'vault-wide-graph-transaction',
	requiresGraphTransactionVersion: 1,
	safeFallback: null,
});
assert.deepEqual(typedCases.get('typed-cross-source-dependency-blocker')?.expect, {
	route: 'error',
	code: 'capability-unavailable',
	feature: 'vault-wide-graph-transaction',
	requiresGraphTransactionVersion: 1,
	safeFallback: null,
});
assert.deepEqual(typedCases.get('typed-cross-source-dependency-transaction')?.expect, {
	route: 'typed-preview',
	riskLevel: 'elevated',
	warning: 'cross-source-graph-partial-risk',
	requiredAcknowledgement: 'cross-source-graph-partial-risk',
	requiresConfirmation: true,
	freshUserTurn: true,
	requiresGraphTransactionVersion: 1,
	requiresGraphTransactionFeatures: expectedGraphTransactionFeatures,
	sourceGroupOrder: [
		'20 Projects/A transaction acceptance.md',
		'20 Projects/Z transaction contract.md',
	],
	safeFallback: null,
});
assert.equal(graphTransactionGolden.schemaVersion, 1);
assert.deepEqual(graphTransactionGolden.contract, {
	graphTransactionVersion: 1,
	graphTransactionFeatures: expectedGraphTransactionFeatures,
	maxJournalUtf8Bytes: 8_388_608,
	recoveryPlanPolicy: 'same-plan-only',
});
assert.deepEqual(graphTransactionGolden.cases, [
	{
		id: 'graph-before-first-write',
		typedCreateCaseId: 'typed-cross-source-dependency-transaction',
		phase: 'prepared',
		expect: 'forward-completed',
	},
	{
		id: 'graph-exact-committed-prefix',
		typedCreateCaseId: 'typed-cross-source-dependency-transaction',
		phase: 'committing',
		expect: 'forward-completed',
	},
	{
		id: 'graph-all-committed-before-receipt',
		typedCreateCaseId: 'typed-cross-source-dependency-transaction',
		phase: 'postflight',
		expect: 'forward-completed',
	},
	{
		id: 'graph-divergent-suffix-compensation',
		typedCreateCaseId: 'typed-cross-source-dependency-transaction',
		phase: 'committing',
		expect: 'compensated',
	},
	{
		id: 'graph-mid-compensation-resume',
		typedCreateCaseId: 'typed-cross-source-dependency-transaction',
		phase: 'compensating',
		expect: 'compensated',
	},
	{
		id: 'graph-compensation-race',
		typedCreateCaseId: 'typed-cross-source-dependency-transaction',
		phase: 'compensating',
		expect: 'unresolved',
	},
	{
		id: 'graph-receipt-persist-failure',
		typedCreateCaseId: 'typed-cross-source-dependency-transaction',
		phase: 'finalizing',
		expect: 'unresolved',
	},
]);
for (const transactionCase of graphTransactionGolden.cases) {
	assert.equal(
		typedCases.has(transactionCase.typedCreateCaseId),
		true,
		`${transactionCase.id} references an unknown typed create fixture`,
	);
}
for (const templateCaseId of [
	'typed-builtin-file-template',
	'typed-folder-file-template',
]) {
	const fixtureCase = typedCases.get(templateCaseId);
	assert.ok(fixtureCase?.templateCandidate);
	assert.equal(fixtureCase.expect.templateSource, 'fileTaskTemplateCandidates');
	assert.equal(fixtureCase.expect.templateRevisionSealed, true);
	assert.equal('content' in fixtureCase.templateCandidate, false);
}

const numericIdDraft = buildMergedFileTaskDraft({
	source: {
		description: 'Numeric ID task',
		fieldValues: {},
		fieldPresence: new Set(),
		tags: [],
		tagsPresent: false,
	},
	template: null,
	defaults: {
		operonId: '2394595',
		status: 'Work.Inbox',
		priority: 'P2',
		datetimeCreated: '2026-01-15T10:20:30',
		datetimeModified: '2026-01-15T10:20:30',
	},
	keyMappings,
	bodyStrategy: 'preserve-source',
});
assert.match(
	numericIdDraft.content,
	/(?:^|\n)Operon ID: "2394595"(?:\n|$)/u,
	'All-numeric canonical IDs must remain YAML strings.',
);

console.log('Operon Agent Runtime fixture contract tests passed.');
