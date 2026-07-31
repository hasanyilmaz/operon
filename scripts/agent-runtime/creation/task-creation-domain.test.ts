import assert from 'node:assert/strict';
import typedCreateGolden from '../fixtures/typed-create-golden.json';

import {
	commitPreparedTaskCreationPlan,
	MAX_CANONICAL_TASK_CREATION_ITEMS,
	prepareCanonicalTaskCreation,
	type CanonicalTaskCreationRequest,
	type PrepareCanonicalTaskCreationOptions,
	type TaskCreationCommitPort,
} from '../../../src/core/task-creation-domain';
import {
	compensateRuntimeTaskCreationFailureV1,
	prepareRuntimeTaskCreationV1,
	sourceRevisionForTaskCreationV1,
	type RuntimeTaskCreationAdapterPortsV1,
} from '../../../src/agent-runtime/runtime/task-creation-adapter';
import type { CreateTaskSpecV1 } from '../../../src/agent-runtime/contracts/v1/mutation';
import { DEFAULT_SETTINGS } from '../../../src/types/settings';
import { RepeatSeriesStore } from '../../../src/storage/repeat-series-store';
import { WriteQueue } from '../../../src/storage/write-queue';

const now = '2026-07-24T10:20:30';

function resolveCoreFixtureVariables(
	content: string,
	context: { title: string; date: string; now: string },
): string {
	let inFence = false;
	return content.split('\n').map(line => {
		if (/^\s*```/u.test(line) || /^\s*~~~/u.test(line)) {
			inFence = !inFence;
			return line;
		}
		if (inFence) return line;
		return line
			.replace(/\{\{title\}\}/gu, context.title)
			.replace(/\{\{date\}\}/gu, context.date)
			.replace(/\{\{time\}\}/gu, context.now.slice(11, 16))
			.replace(/\{\{date:YYYY\/MM\/DD\}\}/gu, context.date.replace(/-/gu, '/'))
			.replace(/\{\{time:HH\.mm\}\}/gu, context.now.slice(11, 16).replace(':', '.'));
	}).join('\n');
}

function createOptions(ids: string[]): PrepareCanonicalTaskCreationOptions {
	let cursor = 0;
	return {
		settings: {
			...DEFAULT_SETTINGS,
			childTaskInheritanceFields: [
				...DEFAULT_SETTINGS.childTaskInheritanceFields,
				'tags',
			],
		},
		now,
		existingOperonIds: new Set(['old0001']),
		existingTasks: new Map([
			[
				'old0001',
				{
					operonId: 'old0001',
					fieldValues: {
						status: 'Pipeline 1.Not Started',
						priority: 'B',
						taskIcon: 'circle',
					},
					tags: ['existing-parent'],
				},
			],
		]),
		generateOperonId: () => ids[cursor++] ?? 'invalid',
		resolveCoreTemplateVariables: resolveCoreFixtureVariables,
		allowedFieldKeys: [
			'status',
			'priority',
			'note',
			'dateDue',
			'taskIcon',
			'taskColor',
			'estimate',
		],
	};
}

const graphRequest: CanonicalTaskCreationRequest = {
	requestId: 'creation-graph',
	items: [
		{
			itemKey: 'parent',
			description: 'Parent task',
			target: {
				representation: 'inline',
				source: {
					filePath: 'Tasks/Graph.md',
					content: '# Tasks\n',
					revision: 'sha256:source-a',
				},
				placement: { kind: 'append' },
				allowCreateFile: false,
			},
			fields: { priority: 'A' },
			tags: ['graph'],
		},
		{
			itemKey: 'child',
			description: 'Child task',
			target: {
				representation: 'inline',
				source: {
					filePath: 'Tasks/Graph.md',
					content: '# Tasks\n',
					revision: 'sha256:source-a',
				},
				placement: { kind: 'after-item', itemKey: 'parent' },
				allowCreateFile: false,
			},
			parent: { kind: 'local', itemKey: 'parent' },
			related: [
				{ kind: 'local', itemKey: 'parent' },
				{ kind: 'existing', operonId: 'old0001' },
			],
			fields: { note: 'Local graph' },
		},
	],
};

const graph = prepareCanonicalTaskCreation(
	graphRequest,
	createOptions(['par0001', 'chi0001']),
);
assert.equal(graph.ok, true);
if (!graph.ok) throw new Error('Expected graph preparation to succeed.');
const graphPlan = graph.plan;
assert.equal(graphPlan.tasks.length, 2);
assert.equal(graphPlan.sourceGroups.length, 1, 'same-file tasks must share one source group');
assert.deepEqual(graphPlan.sourceGroups[0].taskItemKeys, ['parent', 'child']);
assert.equal(graphPlan.tasks[0].lineNumber, 1);
assert.equal(graphPlan.tasks[1].lineNumber, 2);
assert.equal(graphPlan.tasks[1].parentOperonId, 'par0001');
assert.equal(graphPlan.tasks[1].fieldValues.parentTask, 'par0001');
assert.equal(graphPlan.tasks[1].fieldValues.related, 'par0001; old0001');
assert.match(graphPlan.sourceGroups[0].resultingContent, /\{\{operonId:: par0001\}\}/u);
assert.match(graphPlan.sourceGroups[0].resultingContent, /\{\{operonId:: chi0001\}\}/u);
assert.ok(
	graphPlan.sourceGroups[0].resultingContent.indexOf('Parent task')
		< graphPlan.sourceGroups[0].resultingContent.indexOf('Child task'),
	'request order must remain deterministic for equal insertion points',
);

const reversedNestedGraph = prepareCanonicalTaskCreation(
	{
		requestId: 'reversed-nested-local-graph',
		items: [
			{
				itemKey: 'grandchild',
				description: 'Grandchild task',
				target: {
					representation: 'inline',
					source: { filePath: 'Tasks/Nested.md', content: '', revision: 'sha256:empty' },
					placement: { kind: 'after-item', itemKey: 'child' },
					allowCreateFile: false,
				},
				parent: { kind: 'local', itemKey: 'child' },
			},
			{
				itemKey: 'parent',
				description: 'Parent task',
				target: {
					representation: 'inline',
					source: { filePath: 'Tasks/Nested.md', content: '', revision: 'sha256:empty' },
					placement: { kind: 'append' },
					allowCreateFile: false,
				},
			},
			{
				itemKey: 'child',
				description: 'Child task',
				target: {
					representation: 'inline',
					source: { filePath: 'Tasks/Nested.md', content: '', revision: 'sha256:empty' },
					placement: { kind: 'after-item', itemKey: 'parent' },
					allowCreateFile: false,
				},
				parent: { kind: 'local', itemKey: 'parent' },
			},
		],
	},
	createOptions(['grn0001', 'par0002', 'chi0002']),
);
assert.equal(reversedNestedGraph.ok, true);
if (reversedNestedGraph.ok) {
	const content = reversedNestedGraph.plan.sourceGroups[0].resultingContent;
	assert.ok(content.indexOf('Parent task') < content.indexOf('Child task'));
	assert.ok(content.indexOf('Child task') < content.indexOf('Grandchild task'));
}

const mixedParentSource = prepareCanonicalTaskCreation(
	{
		requestId: 'mixed-file-parent-inline-child',
		items: [
			{
				itemKey: 'file-parent',
				description: 'Mixed File Parent',
				target: {
					representation: 'file',
					source: {
						filePath: 'Tasks/Mixed File Parent.md',
						content: null,
						revision: 'sha256:absent',
					},
					template: {
						templateId: 'mixed-template',
						revision: 'sha256:mixed-template',
						content: '---\n---\n\n# Subtasks\n',
					},
				},
			},
			{
				itemKey: 'inline-child',
				description: 'Inline child inside parent file',
				target: {
					representation: 'inline',
					source: {
						filePath: 'Tasks/Mixed File Parent.md',
						content: null,
						revision: 'sha256:absent',
					},
					placement: { kind: 'under-heading', headingKeyword: 'Subtasks' },
					allowCreateFile: true,
				},
				parent: { kind: 'local', itemKey: 'file-parent' },
			},
		],
	},
	createOptions(['mix0001', 'mix0002']),
);
assert.equal(mixedParentSource.ok, true);
if (mixedParentSource.ok) {
	assert.equal(mixedParentSource.plan.sourceGroups.length, 1);
	assert.deepEqual(
		mixedParentSource.plan.sourceGroups[0].taskItemKeys,
		['file-parent', 'inline-child'],
	);
	assert.match(
		mixedParentSource.plan.sourceGroups[0].resultingContent,
		/# Subtasks\n- \[ \] Inline child inside parent file/u,
	);
}

const inherited = prepareCanonicalTaskCreation(
	{
		requestId: 'existing-parent',
		items: [
			{
				itemKey: 'child',
				description: 'Existing parent child',
				target: {
					representation: 'inline',
					source: {
						filePath: 'Tasks/Child.md',
						content: '',
						revision: 'sha256:empty',
					},
					placement: { kind: 'append' },
					allowCreateFile: false,
				},
				parent: { kind: 'existing', operonId: 'old0001' },
			},
		],
	},
	createOptions(['chi0002']),
);
assert.equal(inherited.ok, true);
if (inherited.ok) {
	assert.equal(inherited.plan.tasks[0].fieldValues.parentTask, 'old0001');
	assert.deepEqual(inherited.plan.tasks[0].tags, ['existing-parent']);
}

const file = prepareCanonicalTaskCreation(
	{
		requestId: 'deterministic-template',
		items: [
			{
				itemKey: 'file',
				description: 'Deterministic file task',
				target: {
					representation: 'file',
					source: {
						filePath: 'Tasks/Deterministic.md',
						content: null,
						revision: 'missing',
					},
					template: {
						templateId: 'portable-template',
						revision: 'sha256:template',
						content: [
							'---',
							'Title: "{{title}}"',
							'Unmanaged: Keep',
							'---',
							'# {{title}}',
							'Created {{date}} at {{time}}.',
							'Formatted {{date:YYYY/MM/DD}} at {{time:HH.mm}}.',
							'```md',
							'Literal {{date:YYYY/MM/DD}} and {{taskDescription}}.',
							'```',
						].join('\n'),
					},
				},
				fields: {
					status: 'Pipeline 1.Not Started',
					priority: 'A',
				},
				tags: ['portable'],
				related: [{ kind: 'existing', operonId: 'old0001' }],
			},
		],
	},
	createOptions(['fil0001']),
);
assert.equal(file.ok, true);
if (!file.ok) throw new Error('Expected deterministic template to succeed.');
assert.equal(file.plan.sourceGroups[0].operation, 'create');
assert.equal(file.plan.sourceGroups[0].expectedState, 'absent');
assert.match(file.plan.sourceGroups[0].resultingContent, /Title: "Deterministic"/u);
assert.match(file.plan.sourceGroups[0].resultingContent, /Unmanaged: Keep/u);
assert.match(file.plan.sourceGroups[0].resultingContent, /related: old0001/u);
assert.match(file.plan.sourceGroups[0].resultingContent, /Created 2026-07-24 at 10:20\./u);
assert.match(file.plan.sourceGroups[0].resultingContent, /Formatted 2026\/07\/24 at 10\.20\./u);
assert.match(
	file.plan.sourceGroups[0].resultingContent,
	/Literal \{\{date:YYYY\/MM\/DD\}\} and \{\{taskDescription\}\}\./u,
);
assert.doesNotMatch(file.plan.sourceGroups[0].resultingContent, /\{\{title\}\}/u);

const visibleTemplateKey = (canonicalKey: string): string => (
	DEFAULT_SETTINGS.keyMappings.find(mapping => mapping.canonicalKey === canonicalKey)
		?.visiblePropertyName ?? canonicalKey
);
const recurringTemplate = prepareCanonicalTaskCreation(
	{
		requestId: 'recurring-template-anchor',
		items: [{
			itemKey: 'recurring-template',
			description: 'Recurring template anchor',
			target: {
				representation: 'file',
				source: {
					filePath: 'Tasks/Recurring template anchor.md',
					content: null,
					revision: 'missing',
				},
				template: {
					templateId: 'recurring-template',
					revision: 'sha256:recurring-template',
					content: [
						'---',
						`${visibleTemplateKey('repeat')}: mode=count|freq=day|interval=1|count=3`,
						`${visibleTemplateKey('dateScheduled')}: 2026-08-01`,
						'---',
					].join('\n'),
				},
			},
		}],
	},
	createOptions(['rpt0001']),
);
assert.equal(recurringTemplate.ok, true);
if (recurringTemplate.ok) {
	assert.equal(recurringTemplate.plan.tasks[0].fieldValues['repeatOccurrenceDate'], '2026-08-01');
	assert.equal(recurringTemplate.plan.tasks[0].fieldValues['datetimeRepeatEnd'], '2026-08-03T23:59:59');
}

const terminalStatus = prepareCanonicalTaskCreation(
	{
		requestId: 'terminal-status-checkbox',
		items: [{
			itemKey: 'finished',
			description: 'Finished at creation',
			target: {
				representation: 'inline',
				source: { filePath: 'Tasks/Finished.md', content: '', revision: 'sha256:empty' },
				placement: { kind: 'append' },
				allowCreateFile: false,
			},
			fields: { status: 'Project.Finished' },
		}],
	},
	createOptions(['fin0001']),
);
assert.equal(terminalStatus.ok, true);
if (terminalStatus.ok) {
	assert.equal(terminalStatus.plan.tasks[0].checkbox, 'done');
	assert.match(terminalStatus.plan.tasks[0].renderedTaskLine ?? '', /^- \[x\]/u);
}

const dynamicTemplate = prepareCanonicalTaskCreation(
	{
		requestId: 'templater-block',
		items: [
			{
				itemKey: 'file',
				description: 'Blocked template',
				target: {
					representation: 'file',
					source: {
						filePath: 'Tasks/Blocked.md',
						content: null,
						revision: 'missing',
					},
					template: {
						templateId: 'templater',
						revision: 'sha256:templater',
						content: '<% tp.file.title %>',
					},
				},
			},
		],
	},
	createOptions(['fil0002']),
);
assert.equal(dynamicTemplate.ok, false);
if (!dynamicTemplate.ok) {
	assert.ok(dynamicTemplate.blockers.some(blocker => blocker.code === 'template-processing-required'));
}

const collision = prepareCanonicalTaskCreation(
	{
		requestId: 'collision',
		items: [
			{
				itemKey: 'file',
				description: 'Collision',
				target: {
					representation: 'file',
					source: {
						filePath: 'Tasks/Existing.md',
						content: 'existing',
						revision: 'sha256:existing',
					},
				},
			},
		],
	},
	createOptions(['fil0003']),
);
assert.equal(collision.ok, false);
if (!collision.ok) {
	assert.ok(collision.blockers.some(blocker => blocker.code === 'target-collision'));
}

const parentCycle = prepareCanonicalTaskCreation(
	{
		requestId: 'cycle',
		items: [
			{
				itemKey: 'a',
				description: 'A',
				target: {
					representation: 'inline',
					source: { filePath: 'Tasks/Cycle.md', content: '', revision: 'sha256:empty' },
					placement: { kind: 'append' },
					allowCreateFile: false,
				},
				parent: { kind: 'local', itemKey: 'b' },
			},
			{
				itemKey: 'b',
				description: 'B',
				target: {
					representation: 'inline',
					source: { filePath: 'Tasks/Cycle.md', content: '', revision: 'sha256:empty' },
					placement: { kind: 'append' },
					allowCreateFile: false,
				},
				parent: { kind: 'local', itemKey: 'a' },
			},
		],
	},
	createOptions(['aaa0001', 'bbb0001']),
);
assert.equal(parentCycle.ok, false);
if (!parentCycle.ok) {
	assert.ok(parentCycle.blockers.some(blocker => blocker.code === 'parent-cycle'));
}

const disallowedField = prepareCanonicalTaskCreation(
	{
		requestId: 'runtime-owned-field',
		items: [
			{
				itemKey: 'task',
				description: 'Unsafe',
				target: {
					representation: 'inline',
					source: { filePath: 'Tasks/Unsafe.md', content: '', revision: 'sha256:empty' },
					placement: { kind: 'append' },
					allowCreateFile: false,
				},
				fields: { operonId: 'bad0001' },
			},
		],
	},
	createOptions(['safe001']),
);
assert.equal(disallowedField.ok, false);
if (!disallowedField.ok) {
	assert.ok(disallowedField.blockers.some(blocker => blocker.code === 'field-not-allowed'));
}

const tooManyItems = Array.from({ length: MAX_CANONICAL_TASK_CREATION_ITEMS + 1 }, (_, index) => ({
	itemKey: `task-${index}`,
	description: `Task ${index}`,
	target: {
		representation: 'inline' as const,
		source: { filePath: 'Tasks/Bound.md', content: '', revision: 'sha256:empty' },
		placement: { kind: 'append' as const },
		allowCreateFile: false,
	},
}));
const bounded = prepareCanonicalTaskCreation(
	{ requestId: 'bounded', items: tooManyItems },
	createOptions([]),
);
assert.equal(bounded.ok, false);
if (!bounded.ok) {
	assert.ok(bounded.blockers.some(blocker => blocker.code === 'too-many-items'));
}

const fileBodyReplacement = prepareCanonicalTaskCreation(
	{
		requestId: 'file-body-replacement',
		items: [{
			itemKey: 'file',
			description: 'Body replacement',
			target: {
				representation: 'file',
				source: {
					filePath: 'Tasks/Body replacement.md',
					content: null,
					revision: 'sha256:absent',
				},
				template: {
					templateId: 'body-template',
					revision: 'sha256:body-template',
					content: '---\ntitle: "{{title}}"\n---\nTemplate body',
				},
			},
			bodyMarkdown: '# Requested body\n\nExact replacement.',
		}],
	},
	createOptions(['body001']),
);
assert.equal(fileBodyReplacement.ok, true);
if (fileBodyReplacement.ok) {
	const content = fileBodyReplacement.plan.tasks[0].renderedFileContent ?? '';
	assert.match(content, /title: "Body replacement"/u);
	assert.match(content, /---\n# Requested body\n\nExact replacement\.$/u);
	assert.doesNotMatch(content, /Template body/u);
}

const dependencyGraph = prepareCanonicalTaskCreation(
	{
		requestId: 'dependency-graph',
		items: [
			{
				itemKey: 'blocker',
				description: 'Blocker',
				target: {
					representation: 'inline',
					source: { filePath: 'Tasks/Dependencies.md', content: '', revision: 'sha256:empty' },
					placement: { kind: 'append' },
					allowCreateFile: false,
				},
				dependencies: [
					{ relation: 'blocks', target: { kind: 'local', itemKey: 'blocked' } },
					{ relation: 'blocks', target: { kind: 'existing', operonId: 'old0001' } },
				],
			},
			{
				itemKey: 'blocked',
				description: 'Blocked',
				target: {
					representation: 'inline',
					source: { filePath: 'Tasks/Dependencies.md', content: '', revision: 'sha256:empty' },
					placement: { kind: 'append' },
					allowCreateFile: false,
				},
			},
		],
	},
	createOptions(['dep0001', 'dep0002']),
);
assert.equal(dependencyGraph.ok, true);
if (dependencyGraph.ok) {
	assert.equal(dependencyGraph.plan.tasks[0].fieldValues.blocking, 'dep0002; old0001');
	assert.equal(dependencyGraph.plan.tasks[1].fieldValues.blockedBy, 'dep0001');
}

const dependencyCycle = prepareCanonicalTaskCreation(
	{
		requestId: 'dependency-cycle',
		items: [
			{
				itemKey: 'left',
				description: 'Left',
				target: {
					representation: 'inline',
					source: { filePath: 'Tasks/Cycle.md', content: '', revision: 'sha256:empty' },
					placement: { kind: 'append' },
					allowCreateFile: false,
				},
				dependencies: [{ relation: 'blocks', target: { kind: 'local', itemKey: 'right' } }],
			},
			{
				itemKey: 'right',
				description: 'Right',
				target: {
					representation: 'inline',
					source: { filePath: 'Tasks/Cycle.md', content: '', revision: 'sha256:empty' },
					placement: { kind: 'append' },
					allowCreateFile: false,
				},
				dependencies: [{ relation: 'blocks', target: { kind: 'local', itemKey: 'left' } }],
			},
		],
	},
	createOptions(['cyc0001', 'cyc0002']),
);
assert.equal(dependencyCycle.ok, false);
if (!dependencyCycle.ok) {
	assert.ok(dependencyCycle.blockers.some(blocker => blocker.code === 'invalid-dependency'));
}

const fullGraphOptions = createOptions(['new0001']);
fullGraphOptions.existingOperonIds = new Set(['ext0001', 'ext0002']);
fullGraphOptions.existingTasks = new Map([
	[
		'ext0001',
		{
			operonId: 'ext0001',
			fieldValues: { blocking: 'ext0002' },
			tags: [],
		},
	],
]);
fullGraphOptions.dependencyGraphTasks = [
	{
		operonId: 'ext0001',
		fieldValues: { blocking: 'ext0002' },
		tags: [],
	},
	{
		operonId: 'ext0002',
		fieldValues: { blocking: 'new0001' },
		tags: [],
	},
];
const fullGraphDependencyCycle = prepareCanonicalTaskCreation(
	{
		requestId: 'full-graph-dependency-cycle',
		items: [{
			itemKey: 'new',
			description: 'New task',
			target: {
				representation: 'inline',
				source: { filePath: 'Tasks/Full graph.md', content: '', revision: 'sha256:empty' },
				placement: { kind: 'append' },
				allowCreateFile: false,
			},
			dependencies: [{ relation: 'blocks', target: { kind: 'existing', operonId: 'ext0001' } }],
		}],
	},
	fullGraphOptions,
);
assert.equal(fullGraphDependencyCycle.ok, false);
if (!fullGraphDependencyCycle.ok) {
	assert.ok(fullGraphDependencyCycle.blockers.some(blocker => blocker.code === 'invalid-dependency'));
}

async function runCommitPortTests(): Promise<void> {
	const persisted = new Map<string, string>();
	let failNextRepeatWrite = false;
	const repeatStore = new RepeatSeriesStore(
		{
			vault: {
				configDir: '.obsidian',
				adapter: {
					exists: async (path: string) => persisted.has(path),
						read: async (path: string) => persisted.get(path) ?? '',
						write: async (path: string, value: string) => {
							if (failNextRepeatWrite) {
								failNextRepeatWrite = false;
								throw new Error('REPEAT_WRITE_FAILED');
							}
							persisted.set(path, value);
					},
					remove: async (path: string) => {
						persisted.delete(path);
					},
				},
			},
		} as never,
		new WriteQueue(),
		'.obsidian/plugins/operon/state/repeat-series.json',
	);
	const creationTransaction = await repeatStore.beginCreationTransaction({
		seriesId: 'transaction-series',
		sourceTaskId: 'tx00001',
		sourceFormat: 'inline',
		baseTitle: null,
		lastMaterializedTitle: 'Transactional repeat',
		naming: {
			mode: 'plain',
			template: 'Transactional repeat',
			weekTokenCase: null,
		},
		now,
	});
	assert.ok(creationTransaction);
	assert.equal(repeatStore.getEntry('transaction-series')?.sourceTaskId, 'tx00001');
	assert.equal(
		await repeatStore.rollbackCreationTransaction(creationTransaction!),
		true,
		'unchanged tentative series must roll back',
	);
	assert.equal(repeatStore.getEntry('transaction-series'), null);
	const racedTransaction = await repeatStore.beginCreationTransaction({
		seriesId: 'raced-series',
		sourceTaskId: 'tx00002',
		sourceFormat: 'inline',
		baseTitle: null,
		lastMaterializedTitle: 'Raced repeat',
		now,
	});
	assert.ok(racedTransaction);
	await repeatStore.ensureSeries({
		seriesId: 'raced-series',
		sourceTaskId: 'tx00002',
		sourceFormat: 'inline',
		baseTitle: null,
		lastMaterializedTitle: 'Raced repeat',
		now: '2026-07-24T10:21:00',
	});
	assert.equal(
		await repeatStore.rollbackCreationTransaction(racedTransaction!),
		false,
		'compare-aware rollback must preserve a concurrently changed series',
	);
	assert.equal(repeatStore.getEntry('raced-series')?.updatedAt, '2026-07-24T10:21:00');
	const batchTransaction = await repeatStore.beginCreationBatchTransaction([
		{
			seriesId: 'batch-series-a',
			sourceTaskId: 'tx00003',
			sourceFormat: 'inline',
			baseTitle: null,
			lastMaterializedTitle: 'Batch A',
			now,
		},
		{
			seriesId: 'batch-series-b',
			sourceTaskId: 'tx00004',
			sourceFormat: 'inline',
			baseTitle: null,
			lastMaterializedTitle: 'Batch B',
			now,
		},
	]);
	assert.equal(batchTransaction?.entries.length, 2);
	assert.equal(await repeatStore.rollbackCreationBatchTransaction(batchTransaction!), true);
	assert.equal(repeatStore.getEntry('batch-series-a'), null);
	assert.equal(repeatStore.getEntry('batch-series-b'), null);
	const rollbackWriteFailure = await repeatStore.beginCreationTransaction({
		seriesId: 'rollback-write-failure',
		sourceTaskId: 'tx00005',
		sourceFormat: 'inline',
		baseTitle: null,
		lastMaterializedTitle: 'Rollback write failure',
		now,
	});
	assert.ok(rollbackWriteFailure);
	failNextRepeatWrite = true;
	await assert.rejects(
		repeatStore.rollbackCreationTransaction(rollbackWriteFailure!),
		/REPEAT_WRITE_FAILED/u,
	);
	assert.ok(
		repeatStore.getEntry('rollback-write-failure'),
		'failed rollback persistence must restore the in-memory entry',
	);
	const casEntry = repeatStore.planCreationEntry({
		seriesId: 'cas-series',
		sourceTaskId: 'tx00006',
		sourceFormat: 'inline',
		baseTitle: null,
		lastMaterializedTitle: 'CAS repeat',
		now,
	});
	failNextRepeatWrite = true;
	await assert.rejects(
		repeatStore.compareAndSetEntry('cas-series', null, casEntry),
		/REPEAT_WRITE_FAILED/u,
	);
	assert.equal(
		repeatStore.getEntry('cas-series'),
		null,
		'failed CAS creation persistence must restore the absent in-memory state',
	);
	assert.equal(
		await repeatStore.compareAndSetEntry('cas-series', null, casEntry),
		'committed',
	);
	const reorderedCasEntry = {
		...casEntry,
		overrides: {
			following: [...casEntry.overrides.following],
			single: { ...casEntry.overrides.single },
		},
	};
	const updatedCasEntry = {
		...casEntry,
		updatedAt: '2026-07-24T10:22:00',
	};
	assert.equal(
		await repeatStore.compareAndSetEntry('cas-series', reorderedCasEntry, updatedCasEntry),
		'committed',
		'CAS equality must ignore JSON object property order',
	);
	failNextRepeatWrite = true;
	await assert.rejects(
		repeatStore.compareAndSetEntry('cas-series', updatedCasEntry, null),
		/REPEAT_WRITE_FAILED/u,
	);
	assert.deepEqual(
		repeatStore.getEntry('cas-series'),
		updatedCasEntry,
		'failed CAS deletion persistence must restore the prior in-memory entry',
	);
	let stateRollbackCalls = 0;
	let sourceRollbackCalls = 0;
	let reindexCalls = 0;
	const cleanWithoutState = await compensateRuntimeTaskCreationFailureV1(null, {
		rollbackState: async () => {
			stateRollbackCalls += 1;
			return true;
		},
		rollbackSource: async () => {
			sourceRollbackCalls += 1;
			return true;
		},
		reindexSource: async () => {
			reindexCalls += 1;
		},
	});
	assert.equal(cleanWithoutState, 'failed');
	assert.deepEqual(
		[stateRollbackCalls, sourceRollbackCalls, reindexCalls],
		[0, 1, 1],
		'clean compensation without tentative state must roll back and reindex the source',
	);
	const stateTransaction = {
		entries: [
			{ tentative: { seriesId: 'batch-series-a' } },
			{ tentative: { seriesId: 'batch-series-b' } },
		],
	};
	const cleanWithState = await compensateRuntimeTaskCreationFailureV1(stateTransaction, {
		rollbackState: async transaction => {
			assert.equal(transaction, stateTransaction);
			return true;
		},
		rollbackSource: async () => true,
		reindexSource: async () => undefined,
	});
	assert.equal(cleanWithState, 'failed');
	for (const rollbackState of [
		async () => false,
		async (): Promise<boolean> => {
			throw new Error('STATE_ROLLBACK_FAILED');
		},
	]) {
		sourceRollbackCalls = 0;
		assert.equal(
			await compensateRuntimeTaskCreationFailureV1(stateTransaction, {
				rollbackState,
				rollbackSource: async () => {
					sourceRollbackCalls += 1;
					return true;
				},
				reindexSource: async () => undefined,
			}),
			'outcome-unknown',
		);
		assert.equal(
			sourceRollbackCalls,
			0,
			'failed or rejected state rollback must not remove the committed source',
		);
	}
	reindexCalls = 0;
	assert.equal(
		await compensateRuntimeTaskCreationFailureV1(null, {
			rollbackState: async () => true,
			rollbackSource: async () => false,
			reindexSource: async () => {
				reindexCalls += 1;
			},
		}),
		'outcome-unknown',
	);
	assert.equal(reindexCalls, 0, 'failed source CAS rollback must not claim a clean reindex');
	assert.equal(
		await compensateRuntimeTaskCreationFailureV1(null, {
			rollbackState: async () => true,
			rollbackSource: async () => true,
			reindexSource: async () => {
				throw new Error('REINDEX_FAILED');
			},
		}),
		'outcome-unknown',
	);

	const existingDependencyLine = '- [ ] Existing dependency {{operonId:: ext0001}}';
	const runtimeSettings = { ...DEFAULT_SETTINGS, taskCreatorDefaultToFileTask: true };
	const runtimePorts: RuntimeTaskCreationAdapterPortsV1 = {
		settings: () => runtimeSettings,
		listOperonIds: () => new Set(['ext0001']),
		listDependencyGraphTasks: () => [{
			operonId: 'ext0001',
			fieldValues: {},
			tags: [],
		}],
		getExistingTask: operonId => operonId === 'ext0001'
			? {
				operonId,
				fieldValues: {},
				tags: [],
				duplicate: false,
				filePath: 'Tasks/Existing.md',
				representation: 'inline',
				lineNumber: 0,
			}
			: null,
		readSource: async filePath => ({
			filePath,
			content: filePath === 'Tasks/Existing.md'
				? existingDependencyLine
				: filePath === 'Tasks/New.md' ? '' : null,
		}),
		resolveConfiguredInlineTarget: async () => ({
			filePath: 'Tasks/Configured inline.md',
			placement: { kind: 'append' },
		}),
		resolveConfiguredFilePath: async description => `Tasks/${description}.md`,
		readTemplate: async () => null,
		creationFieldCatalog: () => [],
		resolveCoreTemplateVariables: resolveCoreFixtureVariables,
		generateOperonId: () => 'new0002',
		listRepeatSeriesIds: () => new Set(['existing-series']),
		generateRepeatSeriesId: usedIds => `series-${usedIds.size + 1}`,
		repeatSeriesRevision: () => 'repeat-revision-1',
		now: () => now,
	};
	const configuredDefault = await prepareRuntimeTaskCreationV1(
		'runtime-configured-default',
		{
			operation: 'create',
			items: [{
				itemRef: 'default',
				description: 'Configured default',
				target: { mode: 'configured-default' },
				fields: [],
			}],
		},
		runtimePorts,
	);
	assert.equal(configuredDefault.ok, true, JSON.stringify(configuredDefault));
	if (configuredDefault.ok) {
		assert.equal(configuredDefault.plan.tasks[0].representation, 'file');
		assert.equal(configuredDefault.plan.tasks[0].filePath, 'Tasks/Configured default.md');
	}
	let sameSourceReadCount = 0;
	let sameSourceCatalogCount = 0;
	let sameSourceId = 0;
	const sameSourceBatch = await prepareRuntimeTaskCreationV1(
		'runtime-same-source-batch',
		{
			operation: 'create',
			items: Array.from({ length: MAX_CANONICAL_TASK_CREATION_ITEMS }, (_, index) => ({
				itemRef: `batch-${index}`,
				description: `Batch task ${index}`,
				target: {
					representation: 'inline' as const,
					mode: 'exact-path' as const,
					filePath: 'Tasks/Same source batch.md',
				},
				fields: [],
			})),
		},
		{
			...runtimePorts,
			listOperonIds: () => new Set(),
			listDependencyGraphTasks: () => [],
			getExistingTask: () => null,
			readSource: async filePath => {
				sameSourceReadCount += 1;
				return {
					filePath,
					content: sameSourceReadCount === 1 ? 'Seed' : 'Changed after first read',
				};
			},
			creationFieldCatalog: () => {
				sameSourceCatalogCount += 1;
				return [];
			},
			generateOperonId: () => `bt${String(++sameSourceId).padStart(5, '0')}`,
		},
	);
	assert.equal(sameSourceBatch.ok, true, JSON.stringify(sameSourceBatch));
	assert.equal(sameSourceReadCount, 1, 'one preparation must read a shared source once');
	assert.equal(sameSourceCatalogCount, 1, 'one preparation must capture the creation Catalog once');
	if (sameSourceBatch.ok) {
		assert.equal(sameSourceBatch.plan.sourceGroups.length, 1);
		assert.equal(
			sameSourceBatch.plan.sourceGroups[0].expectedRevision,
			sourceRevisionForTaskCreationV1('Tasks/Same source batch.md', 'Seed'),
			'the cached first source snapshot must remain the sealed revision authority',
		);
		assert.deepEqual(
			sameSourceBatch.plan.tasks.map(task => task.lineNumber),
			Array.from({ length: MAX_CANONICAL_TASK_CREATION_ITEMS }, (_, index) => index + 1),
		);
		assert.equal(
			new Set(sameSourceBatch.createEffects.map(effect => effect.plannedSourceDigest)).size,
			1,
			'all same-source effects must bind the same resulting source digest',
		);
	}
	const exactInlineSpec = (lineNumber: number): CreateTaskSpecV1 => ({
		operation: 'create',
		items: [{
			itemRef: 'exact-line',
			description: 'Exact line task',
			target: {
				representation: 'inline',
				mode: 'exact-path',
				filePath: 'Tasks/Exact line.md',
				lineNumber,
			},
			fields: [],
		}],
	});
	for (const [caseId, content, lineNumber] of [
		['frontmatter', '---\nStatus: active\n---\n\nBody', 0],
		['nonblank-body', '---\nStatus: active\n---\nBody', 3],
		['out-of-range', '---\nStatus: active\n---\n\nBody', 99],
		['empty-source', '', 0],
		['trailing-body-newline', 'Body\n', 1],
		['trailing-frontmatter-newline', '---\nStatus: active\n---\n', 3],
	] as const) {
		const rejected = await prepareRuntimeTaskCreationV1(
			`runtime-exact-line-${caseId}`,
			exactInlineSpec(lineNumber),
			{
				...runtimePorts,
				readSource: async filePath => ({ filePath, content }),
			},
		);
		assert.equal(rejected.ok, false, caseId);
		if (!rejected.ok) {
			assert.equal(rejected.code, 'stale-source', caseId);
			assert.match(rejected.reason, /blank-body placement candidate/u, caseId);
		}
	}
	const validBlankBodyLine = await prepareRuntimeTaskCreationV1(
		'runtime-exact-line-valid-blank-body',
		exactInlineSpec(3),
		{
			...runtimePorts,
			readSource: async filePath => ({
				filePath,
				content: '---\nStatus: active\n---\n\nBody',
			}),
		},
	);
	assert.equal(validBlankBodyLine.ok, true, JSON.stringify(validBlankBodyLine));
	if (validBlankBodyLine.ok) {
		assert.equal(validBlankBodyLine.plan.tasks[0].lineNumber, 3);
	}
	const shiftedParentSource = [
		'',
		existingDependencyLine,
	].join('\n');
	const shiftedExistingParent = await prepareRuntimeTaskCreationV1(
		'runtime-existing-parent-shifted-by-exact-insert',
		{
			operation: 'create',
			items: [{
				itemRef: 'shift-parent',
				description: 'Child before existing parent',
				target: {
					representation: 'inline',
					mode: 'exact-path',
					filePath: 'Tasks/Existing.md',
					lineNumber: 0,
				},
				fields: [],
				parent: { kind: 'existing', operonId: 'ext0001' },
			}],
		},
		{
			...runtimePorts,
			getExistingTask: operonId => operonId === 'ext0001'
				? {
					operonId,
					fieldValues: {},
					tags: [],
					duplicate: false,
					filePath: 'Tasks/Existing.md',
					representation: 'inline',
					lineNumber: 1,
				}
				: null,
			readSource: async filePath => ({
				filePath,
				content: filePath === 'Tasks/Existing.md' ? shiftedParentSource : null,
			}),
		},
	);
	assert.equal(shiftedExistingParent.ok, true, JSON.stringify(shiftedExistingParent));
	if (shiftedExistingParent.ok) {
		const parentResource = shiftedExistingParent.parentResources[0];
		assert.equal(parentResource?.lineNumber, 2);
		const group = shiftedExistingParent.plan.sourceGroups.find(
			sourceGroup => sourceGroup.filePath === 'Tasks/Existing.md',
		);
		assert.ok(group);
		assert.match(
			group?.resultingContent.split(/\r?\n/u)[parentResource?.lineNumber ?? -1] ?? '',
			/\{\{operonId:: ext0001\}\}/u,
			'sealed parent locator must point at the parent after insertion projection',
		);
	}
	const temporalCreation = await prepareRuntimeTaskCreationV1(
		'runtime-temporal-create',
		{
			operation: 'create',
			items: [{
				itemRef: 'temporal',
				description: 'Temporal task',
				target: {
					representation: 'inline',
					mode: 'exact-path',
					filePath: 'Tasks/New.md',
				},
				fields: [
					{
						kind: 'reminder-datetimes',
						values: ['2026-07-26T09:00:00', '2026-07-25T08:00:00'],
					},
					{
						kind: 'recurrence',
						rule: 'mode=schedule|freq=day|interval=1',
					},
				],
			}],
		},
		runtimePorts,
	);
	assert.equal(temporalCreation.ok, true, JSON.stringify(temporalCreation));
	if (temporalCreation.ok) {
		const temporalTask = temporalCreation.plan.tasks[0];
		assert.equal(
			temporalTask.fieldValues['reminderDatetimes'],
			'2026-07-26T09:00:00; 2026-07-25T08:00:00',
			'canonical reminder values preserve request order',
		);
		assert.equal(temporalTask.fieldValues['repeatOccurrenceDate'], '2026-07-24');
		assert.equal(temporalTask.fieldValues['repeatSeriesId'], 'series-2');
		assert.equal(temporalCreation.createEffects[0].repeatSeriesId, 'series-2');
		assert.equal(temporalCreation.recurrenceResources[0].seriesId, 'series-2');
		assert.equal(
			temporalCreation.recurrenceResources[0].baseTemporalTemplate.mode,
			'allDay',
		);
	}
	const duplicateReminder = await prepareRuntimeTaskCreationV1(
		'runtime-duplicate-reminder',
		{
			operation: 'create',
			items: [{
				itemRef: 'duplicate-reminder',
				description: 'Duplicate reminder',
				target: {
					representation: 'inline',
					mode: 'exact-path',
					filePath: 'Tasks/New.md',
				},
				fields: [{
					kind: 'reminder-datetimes',
					values: ['2026-07-25T08:00', '2026-07-25T08:00:00'],
				}],
			}],
		},
		runtimePorts,
	);
	assert.equal(duplicateReminder.ok, false);
	if (!duplicateReminder.ok) {
		assert.match(duplicateReminder.reason, /canonical duplicates/u);
	}
	const inheritedRecurrence = await prepareRuntimeTaskCreationV1(
		'runtime-inherited-recurrence',
		{
			operation: 'create',
			items: [{
				itemRef: 'inherited-repeat',
				description: 'Inherited repeat',
				target: {
					representation: 'inline',
					mode: 'exact-path',
					filePath: 'Tasks/New.md',
				},
				fields: [],
				parent: { kind: 'existing', operonId: 'ext0001' },
			}],
		},
		{
			...runtimePorts,
			settings: () => ({
				...runtimeSettings,
				childTaskInheritanceFields: [
					...runtimeSettings.childTaskInheritanceFields,
					'repeat',
					'dateScheduled',
				],
			}),
			getExistingTask: operonId => operonId === 'ext0001'
				? {
					operonId,
					fieldValues: {
						repeat: 'mode=schedule|freq=week|interval=1',
						repeatSeriesId: 'parent-series',
						dateScheduled: '2026-07-28',
					},
					tags: [],
					duplicate: false,
					filePath: 'Tasks/Existing.md',
					representation: 'inline',
					lineNumber: 0,
				}
				: null,
		},
	);
	assert.equal(inheritedRecurrence.ok, true, JSON.stringify(inheritedRecurrence));
	if (inheritedRecurrence.ok) {
		assert.equal(inheritedRecurrence.plan.tasks[0].fieldValues['repeatOccurrenceDate'], '2026-07-28');
		assert.equal(inheritedRecurrence.plan.tasks[0].fieldValues['repeatSeriesId'], 'series-2');
		assert.notEqual(inheritedRecurrence.plan.tasks[0].fieldValues['repeatSeriesId'], 'parent-series');
		assert.equal(inheritedRecurrence.recurrenceResources.length, 1);
	}
	const configuredRecurrence = await prepareRuntimeTaskCreationV1(
		'runtime-configured-recurrence',
		{
			operation: 'create',
			items: [{
				itemRef: 'configured-repeat',
				description: 'Configured repeat',
				target: {
					representation: 'inline',
					mode: 'configured-default',
				},
				fields: [],
			}],
		},
		{
			...runtimePorts,
			resolveConfiguredInlineTarget: async () => ({
				filePath: 'Tasks/Configured inline.md',
				placement: { kind: 'append' },
				defaultFields: {
					repeat: 'MODE=SCHEDULE|FREQ=DAY|INTERVAL=1',
				},
			}),
			readSource: async filePath => ({
				filePath,
				content: filePath === 'Tasks/Configured inline.md' ? '' : null,
			}),
		},
	);
	assert.equal(configuredRecurrence.ok, true, JSON.stringify(configuredRecurrence));
	if (configuredRecurrence.ok) {
		assert.equal(
			configuredRecurrence.plan.tasks[0].fieldValues['repeat'],
			'mode=schedule|freq=day|interval=1',
		);
		assert.equal(configuredRecurrence.plan.tasks[0].fieldValues['repeatOccurrenceDate'], '2026-07-24');
		assert.equal(configuredRecurrence.plan.tasks[0].fieldValues['repeatSeriesId'], 'series-2');
	}
	const configuredDuplicateReminder = await prepareRuntimeTaskCreationV1(
		'runtime-configured-duplicate-reminder',
		{
			operation: 'create',
			items: [{
				itemRef: 'configured-duplicate-reminder',
				description: 'Configured duplicate reminder',
				target: {
					representation: 'inline',
					mode: 'configured-default',
				},
				fields: [],
			}],
		},
		{
			...runtimePorts,
			resolveConfiguredInlineTarget: async () => ({
				filePath: 'Tasks/Configured inline.md',
				placement: { kind: 'append' },
				defaultFields: {
					reminderDatetimes: '2026-07-25T08:00; 2026-07-25T08:00:00',
				},
			}),
			readSource: async filePath => ({
				filePath,
				content: filePath === 'Tasks/Configured inline.md' ? '' : null,
			}),
		},
	);
	assert.equal(configuredDuplicateReminder.ok, false);
	if (!configuredDuplicateReminder.ok) {
		assert.match(configuredDuplicateReminder.reason, /canonical duplicates/u);
	}
	const runtimeBody = await prepareRuntimeTaskCreationV1(
		'runtime-body',
		{
			operation: 'create',
			items: [{
				itemRef: 'body',
				description: 'Runtime body',
				target: {
					representation: 'file',
					mode: 'exact-path',
					filePath: 'Tasks/Runtime body.md',
				},
				fields: [],
				bodyMarkdown: 'Body ✓',
			}],
		},
		runtimePorts,
	);
	assert.equal(runtimeBody.ok, true, JSON.stringify(runtimeBody));
	if (runtimeBody.ok) {
		assert.deepEqual(runtimeBody.createEffects[0].bodyMarkdownSummary, {
			utf8Bytes: 8,
			sha256: runtimeBody.createEffects[0].bodyMarkdownSummary?.sha256,
		});
		assert.equal(runtimeBody.createEffects[0].bodyMarkdownSummary?.sha256.length, 64);
		assert.match(runtimeBody.plan.tasks[0].renderedFileContent ?? '', /---\nBody ✓$/u);
	}
	const injectedBodyTask = await prepareRuntimeTaskCreationV1(
		'runtime-body-injected-task',
		{
			operation: 'create',
			items: [{
				itemRef: 'body-injection',
				description: 'Runtime body injection',
				target: {
					representation: 'file',
					mode: 'exact-path',
					filePath: 'Tasks/Runtime body injection.md',
				},
				fields: [],
				bodyMarkdown: '- [ ] Smuggled task {{operonId:: ext0001}}',
			}],
		},
		runtimePorts,
	);
	assert.equal(injectedBodyTask.ok, false);
	if (!injectedBodyTask.ok) {
		assert.equal(injectedBodyTask.code, 'invalid-request');
		assert.match(injectedBodyTask.reason, /additional Operon task/u);
	}

	let graphId = 0;
	const crossSourceGraph = await prepareRuntimeTaskCreationV1(
		'runtime-cross-source-graph',
		{
			operation: 'create',
			items: [{
				itemRef: 'parent',
				description: 'Z Parent',
				target: {
					representation: 'file',
					mode: 'exact-path',
					filePath: 'Tasks/Z Parent.md',
				},
				fields: [],
			}, {
				itemRef: 'child',
				description: 'A Child',
				target: {
					representation: 'file',
					mode: 'exact-path',
					filePath: 'Tasks/A Child.md',
				},
				fields: [],
				parent: { kind: 'created', itemRef: 'parent' },
			}, {
				itemRef: 'related-owner',
				description: 'B Related',
				target: {
					representation: 'file',
					mode: 'exact-path',
					filePath: 'Tasks/B Related.md',
				},
				fields: [],
				related: [{ kind: 'created', itemRef: 'child' }],
			}],
		},
		{
			...runtimePorts,
			generateOperonId: () => `new10${String(++graphId).padStart(2, '0')}`,
		},
	);
	assert.equal(crossSourceGraph.ok, true, JSON.stringify(crossSourceGraph));
	if (crossSourceGraph.ok) {
		assert.deepEqual(crossSourceGraph.sourceGroupGraph.sourceOrder, [
			'Tasks/Z Parent.md',
			'Tasks/A Child.md',
			'Tasks/B Related.md',
		]);
		assert.deepEqual(crossSourceGraph.sourceGroupGraph.edges, [{
			fromFilePath: 'Tasks/A Child.md',
			toFilePath: 'Tasks/B Related.md',
			relation: 'related',
		}, {
			fromFilePath: 'Tasks/Z Parent.md',
			toFilePath: 'Tasks/A Child.md',
			relation: 'parent',
		}]);
		assert.equal(crossSourceGraph.sourceGroupGraph.crossSourcePartialRisk, true);
	}
	let cyclicGraphId = 0;
	const cyclicSourceGraph = await prepareRuntimeTaskCreationV1(
		'runtime-cyclic-source-graph',
		{
			operation: 'create',
			items: [{
				itemRef: 'related-a',
				description: 'Related A',
				target: {
					representation: 'file',
					mode: 'exact-path',
					filePath: 'Tasks/Related A.md',
				},
				fields: [],
				related: [{ kind: 'created', itemRef: 'related-b' }],
			}, {
				itemRef: 'related-b',
				description: 'Related B',
				target: {
					representation: 'file',
					mode: 'exact-path',
					filePath: 'Tasks/Related B.md',
				},
				fields: [],
				related: [{ kind: 'created', itemRef: 'related-a' }],
			}],
		},
		{
			...runtimePorts,
			generateOperonId: () => `new30${String(++cyclicGraphId).padStart(2, '0')}`,
		},
	);
	assert.equal(cyclicSourceGraph.ok, false);
	if (!cyclicSourceGraph.ok) {
		assert.equal(cyclicSourceGraph.code, 'capability-unavailable');
		assert.deepEqual(cyclicSourceGraph.details, {
			feature: 'cross-source-parent-related-order',
			requiredScope: 'acyclic-source-graph',
		});
	}

	const crossSourceDependency = await prepareRuntimeTaskCreationV1(
		'runtime-cross-source-dependency',
		{
			operation: 'create',
			items: [{
				itemRef: 'new',
				description: 'New blocker',
				target: {
					representation: 'inline',
					mode: 'exact-path',
					filePath: 'Tasks/New.md',
				},
				fields: [],
				dependencies: [{
					relation: 'blocks',
					target: { kind: 'existing', operonId: 'ext0001' },
				}],
			}],
		},
		runtimePorts,
	);
	assert.equal(crossSourceDependency.ok, true, JSON.stringify(crossSourceDependency));
	if (crossSourceDependency.ok) {
		assert.equal(crossSourceDependency.sourceGroupGraph.crossSourcePartialRisk, true);
		assert.deepEqual(crossSourceDependency.sourceGroupGraph.sourceOrder, [
			'Tasks/Existing.md',
			'Tasks/New.md',
		]);
		assert.deepEqual(crossSourceDependency.dependencyResources, [{
			operonId: 'ext0001',
			filePath: 'Tasks/Existing.md',
			format: 'inline',
			lineNumber: 0,
			additions: {
				blocking: [],
				blockedBy: ['new0002'],
			},
			expectedModifiedAt: now,
		}]);
	}
	let createdDependencyId = 0;
	const crossSourceCreatedDependency = await prepareRuntimeTaskCreationV1(
		'runtime-cross-source-created-dependency',
		{
			operation: 'create',
			items: [{
				itemRef: 'blocker',
				description: 'Blocker',
				target: {
					representation: 'file',
					mode: 'exact-path',
					filePath: 'Tasks/Blocker.md',
				},
				fields: [],
			}, {
				itemRef: 'blocked',
				description: 'Blocked',
				target: {
					representation: 'file',
					mode: 'exact-path',
					filePath: 'Tasks/Blocked.md',
				},
				fields: [],
				dependencies: [{
					relation: 'blocked-by',
					target: { kind: 'created', itemRef: 'blocker' },
				}],
			}],
		},
		{
			...runtimePorts,
			generateOperonId: () => `new20${String(++createdDependencyId).padStart(2, '0')}`,
		},
	);
	assert.equal(
		crossSourceCreatedDependency.ok,
		true,
		JSON.stringify(crossSourceCreatedDependency),
	);
	if (crossSourceCreatedDependency.ok) {
		assert.equal(crossSourceCreatedDependency.sourceGroupGraph.crossSourcePartialRisk, true);
		assert.deepEqual(crossSourceCreatedDependency.sourceGroupGraph.sourceOrder, [
			'Tasks/Blocked.md',
			'Tasks/Blocker.md',
		]);
		const blocker = crossSourceCreatedDependency.plan.tasks.find(
			task => task.itemKey === 'blocker',
		);
		const blocked = crossSourceCreatedDependency.plan.tasks.find(
			task => task.itemKey === 'blocked',
		);
		assert.equal(blocker?.fieldValues.blocking, blocked?.operonId);
		assert.equal(blocked?.fieldValues.blockedBy, blocker?.operonId);
	}

	const externalDependency = await prepareRuntimeTaskCreationV1(
		'runtime-existing-dependency',
		{
			operation: 'create',
			items: [{
				itemRef: 'new',
				description: 'New blocker',
				target: {
					representation: 'inline',
					mode: 'exact-path',
					filePath: 'Tasks/Existing.md',
				},
				fields: [],
				dependencies: [{
					relation: 'blocks',
					target: { kind: 'existing', operonId: 'ext0001' },
				}],
			}],
		},
		runtimePorts,
	);
	assert.equal(externalDependency.ok, true, JSON.stringify(externalDependency));
	if (externalDependency.ok) {
		assert.deepEqual(externalDependency.createEffects[0].resolvedDependencies, [{
			relation: 'blocks',
			operonId: 'ext0001',
		}]);
		const existingGroup = externalDependency.plan.sourceGroups.find(
			group => group.filePath === 'Tasks/Existing.md',
		);
		assert.ok(existingGroup);
		assert.match(existingGroup?.resultingContent ?? '', /\{\{blockedBy:: new0002\}\}/u);
		assert.match(existingGroup?.resultingContent ?? '', /\{\{datetimeModified::/u);
		assert.deepEqual(externalDependency.dependencyResources, [{
			operonId: 'ext0001',
			filePath: 'Tasks/Existing.md',
			format: 'inline',
			lineNumber: 0,
			additions: { blocking: [], blockedBy: ['new0002'] },
			expectedModifiedAt: now,
		}]);
	}

	const visibleKey = (canonicalKey: string): string => (
		runtimeSettings.keyMappings.find(mapping => mapping.canonicalKey === canonicalKey)
			?.visiblePropertyName ?? canonicalKey
	);
	const existingFileSource = [
		'---',
		`${visibleKey('operonId')}: ext0001`,
		`${visibleKey('description')}: Existing dependency`,
		`${visibleKey('status')}:`,
		`${visibleKey('priority')}:`,
		`${visibleKey('note')}: Fresh source value`,
		'Unmanaged: Preserve me',
		'---',
		'Existing body',
	].join('\n');
	const fileDependency = await prepareRuntimeTaskCreationV1(
		'runtime-existing-file-dependency',
		{
			operation: 'create',
			items: [{
				itemRef: 'new-file-target',
				description: 'New blocker for File Task',
				target: {
					representation: 'inline',
					mode: 'exact-path',
					filePath: 'Tasks/New.md',
				},
				fields: [],
				dependencies: [{
					relation: 'blocks',
					target: { kind: 'existing', operonId: 'ext0001' },
				}],
			}],
		},
		{
			...runtimePorts,
			getExistingTask: operonId => operonId === 'ext0001'
				? {
					operonId,
					fieldValues: {
						status: 'Pipeline 1.Not Started',
						priority: 'A',
						note: 'Stale index value',
					},
					tags: ['stale-index-tag'],
					duplicate: false,
					filePath: 'Tasks/Existing file.md',
					representation: 'file',
				}
				: null,
			readSource: async filePath => ({
				filePath,
				content: filePath === 'Tasks/Existing file.md'
					? existingFileSource
					: filePath === 'Tasks/New.md' ? '' : null,
			}),
		},
	);
	assert.equal(fileDependency.ok, true);
	if (fileDependency.ok) {
		assert.equal(fileDependency.sourceGroupGraph.crossSourcePartialRisk, true);
		assert.deepEqual(fileDependency.sourceGroupGraph.sourceOrder, [
			'Tasks/Existing file.md',
			'Tasks/New.md',
		]);
		assert.deepEqual(
			fileDependency.dependencyResources,
			[{
				operonId: 'ext0001',
				filePath: 'Tasks/Existing file.md',
				format: 'yaml',
				additions: { blocking: [], blockedBy: ['new0002'] },
				expectedModifiedAt: '2026-07-24T10:20:30',
			}],
		);
	}

	const typedGoldenCases = typedCreateGolden.cases as Array<{
		id: string;
		intent: { spec: CreateTaskSpecV1 };
		expect: Record<string, unknown>;
	}>;
	let typedGoldenId = 0;
	const typedGoldenPorts: RuntimeTaskCreationAdapterPortsV1 = {
		...runtimePorts,
		listOperonIds: () => new Set(),
		listDependencyGraphTasks: () => [],
		getExistingTask: () => null,
		readSource: async filePath => ({
			filePath,
			content: [
				'20 Projects/Exact file target.md',
				'20 Projects/Built in template task.md',
				'20 Projects/Folder template task.md',
				'20 Projects/Body replacement task.md',
			].includes(filePath)
				? null
				: Array.from({ length: 12 }, () => '').join('\n'),
		}),
		readTemplate: async templateId => ({
			templateId,
			content: '---\nfixture: true\n---\nTemplate body.',
			revision: `template:${templateId}`,
		}),
		generateOperonId: () => `tg${String(++typedGoldenId).padStart(5, '0')}`,
	};
	for (const fixtureCase of typedGoldenCases) {
		const prepared = await prepareRuntimeTaskCreationV1(
			`runtime-${fixtureCase.id}`,
			fixtureCase.intent.spec,
			typedGoldenPorts,
		);
		if (
			fixtureCase.id === 'typed-cross-source-parent-legacy-blocker'
			|| fixtureCase.id === 'typed-cross-source-dependency-blocker'
		) {
			assert.equal(fixtureCase.expect.route, 'error');
			assert.equal(fixtureCase.expect.code, 'capability-unavailable');
			assert.equal(
				prepared.ok,
				true,
				`${fixtureCase.id}: domain preparation stays capability-agnostic; CLI/Catalog admission owns this blocker`,
			);
			continue;
		}
		assert.equal(prepared.ok, true, `${fixtureCase.id}: ${JSON.stringify(prepared)}`);
		if (!prepared.ok) continue;
		if (fixtureCase.id === 'typed-exact-inline-line') {
			const locator = prepared.createEffects[0]?.locator;
			assert.equal(locator?.representation, 'inline');
			assert.equal(
				locator?.representation === 'inline' ? locator.lineNumber : undefined,
				fixtureCase.expect.lineNumber,
			);
		}
		if (
			fixtureCase.id === 'typed-cross-source-parent-warning'
			|| fixtureCase.id === 'typed-cross-source-dependency-transaction'
		) {
			assert.equal(prepared.sourceGroupGraph.crossSourcePartialRisk, true);
			assert.deepEqual(
				prepared.sourceGroupGraph.sourceOrder,
				fixtureCase.expect.sourceGroupOrder,
			);
		}
		if (fixtureCase.id.includes('template')) {
			assert.ok(prepared.createEffects[0]?.templateDigest);
		}
	}

	const commits: string[] = [];
	const successfulPort: TaskCreationCommitPort = {
		async commitSourceGroup(group) {
			commits.push(group.groupId);
			return { status: 'committed', resultingRevision: `after:${group.filePath}` };
		},
	};
	const committed = await commitPreparedTaskCreationPlan(graphPlan, successfulPort);
	assert.equal(committed.status, 'committed');
	assert.deepEqual(commits, ['task-source:Tasks/Graph.md']);

	const partialPlan = {
		...graphPlan,
		sourceGroups: [
			graphPlan.sourceGroups[0],
			{
				...graphPlan.sourceGroups[0],
				groupId: 'task-source:Tasks/Second.md',
				filePath: 'Tasks/Second.md',
			},
			{
				...graphPlan.sourceGroups[0],
				groupId: 'task-source:Tasks/Third.md',
				filePath: 'Tasks/Third.md',
			},
		],
	};
	let commitCount = 0;
	const conflictingPort: TaskCreationCommitPort = {
		async commitSourceGroup() {
			commitCount += 1;
			return commitCount === 1
				? { status: 'committed', resultingRevision: 'after:first' }
				: { status: 'conflict', reason: 'source drifted' };
		},
	};
	const partial = await commitPreparedTaskCreationPlan(partialPlan, conflictingPort);
	assert.equal(partial.status, 'partial');
	assert.equal(commitCount, 2, 'commit must stop at the first non-committed group');
	assert.deepEqual(partial.remainingGroupIds, ['task-source:Tasks/Third.md']);

	console.log('Operon canonical task creation domain tests passed.');
}

const creationTestGlobal = globalThis as typeof globalThis & {
	__operonTaskCreationDomainTestRun?: Promise<void>;
};
creationTestGlobal.__operonTaskCreationDomainTestRun = runCommitPortTests();
