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
import { resolveDefaultFileTaskStatus } from '../../../src/core/file-task-defaults';
import { resolveOperonIdPlaceholders } from '../../../src/core/operon-id-placeholders';
import { parseTaskLine } from '../../../src/core/parser';
import {
	compensateRuntimeTaskCreationFailureV1,
	prepareRuntimeTaskCreationV1,
	sealedTemplateIdentityGenerationQueueV1,
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
			'dateStarted',
			'dateScheduled',
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

const identityPlaceholders = prepareCanonicalTaskCreation(
	{
		requestId: 'file-task-identity-placeholders',
		items: [{
			itemKey: 'identity-file',
			description: 'Identity placeholder file',
			target: {
				representation: 'file',
				source: { filePath: 'Tasks/Identity.md', content: null, revision: 'missing' },
				identityPlaceholderPolicy: 'resolve-operon-id-v1',
				template: {
					templateId: 'identity-placeholders',
					revision: 'sha256:identity-placeholders',
					content: [
						'---',
						'IdentityA: {{operonIdA}}',
						'Identitya: {{operonIda}}',
						'---',
						'- [ ] Parent {{operonIdA}}',
						'- [ ] Child {{operonId0}} {{parentTask:: {{operonIdA}}}}',
						'- [ ] Lower {{operonIda}} and upper {{operonIdA}}',
						'- [ ] Fresh {{operonId}} then {{operonId}} and nine {{operonId9}}',
						'Date {{date}}',
						'```md',
						'- [ ] Literal {{operonIdA}}',
						'```',
					].join('\n'),
				},
			},
		}],
	},
	createOptions(['fil0002', 'upa0001', 'loa0001', 'num0001', 'new0001', 'new0002', 'num0009']),
);
assert.equal(identityPlaceholders.ok, true, identityPlaceholders.ok ? '' : JSON.stringify(identityPlaceholders.blockers));
if (!identityPlaceholders.ok) throw new Error('Expected identity placeholders to resolve.');
const identityTask = identityPlaceholders.plan.tasks[0];
const identityContent = identityPlaceholders.plan.sourceGroups[0].resultingContent;
assert.equal(identityTask.templateIdentityAllocations?.length, 10);
assert.notEqual(
	identityTask.templateIdentityAllocations?.find(allocation => allocation.suffix === 'A')?.operonId,
	identityTask.templateIdentityAllocations?.find(allocation => allocation.suffix === 'a')?.operonId,
	'uppercase and lowercase suffixes must remain distinct',
);
assert.equal(
	new Set(identityTask.templateIdentityAllocations?.filter(allocation => allocation.suffix === 'A').map(allocation => allocation.operonId)).size,
	1,
	'repeated suffixes must reuse one ID',
);
assert.match(identityContent, /\{\{parentTask:: upa0001\}\}/u);
assert.match(identityContent, /```md\n- \[ \] Literal \{\{operonIdA\}\}\n```/u);
assert.match(identityContent, /2026-07-24/u, 'existing date variables must still resolve');

const allIdentitySuffixes = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'.split('');
const allIdentitySuffixAllocations: Array<{ occurrence: number; suffix?: string; operonId: string }> = [];
let allIdentitySuffixCursor = 0;
const allIdentitySuffixContent = resolveOperonIdPlaceholders(
	`---\n---\n- [ ] All suffixes ${allIdentitySuffixes.map(suffix => `{{operonId${suffix}}}`).join(' ')}`,
	{
		generateOperonId: () => `x${(allIdentitySuffixCursor++).toString(36).padStart(6, '0')}`,
		onIdentityAllocation: allocation => allIdentitySuffixAllocations.push(allocation),
	},
);
assert.deepEqual(
	allIdentitySuffixAllocations.map(allocation => allocation.suffix),
	allIdentitySuffixes,
	'every documented numeric, uppercase, and lowercase identity suffix must resolve',
);
assert.doesNotMatch(allIdentitySuffixContent, /\{\{operonId/u);

const fileIdentityGraphRequest: CanonicalTaskCreationRequest = {
	requestId: 'file-task-primary-identity-graph',
	items: [{
		itemKey: 'file-identity-graph',
		description: 'Identity Graph',
		target: {
			representation: 'file',
			source: { filePath: 'Tasks/Identity Graph.md', content: null, revision: 'missing' },
			identityPlaceholderPolicy: 'resolve-operon-id-v1',
			template: {
				templateId: 'file-identity-graph-template',
				revision: 'sha256:file-identity-graph-template',
				content: [
					'---',
					'operonId: {{operonId1}}',
					'---',
					'Context {{title}} {{date}} {{time}} {{datetime}} {{taskDescription}} {{note}} {{dateStarted}} {{dateScheduled}} {{dateDue}} {{status}} {{priority}}',
					'## Group One',
					'- [ ] Root A {{operonId:: {{operonIdA}}}} {{parentTask:: {{operonId1}}}}',
					'- [ ] Child B {{operonId:: {{operonIdB}}}} {{parentTask:: {{operonIdA}}}}',
					'## Group Two',
					'- [ ] Root C {{operonId:: {{operonIdC}}}} {{parentTask:: {{operonId1}}}}',
					'- [ ] Child D {{operonId:: {{operonIdD}}}} {{parentTask:: {{operonIdC}}}}',
					'## Independent Group',
					'- [ ] Root E {{operonId:: {{operonIdE}}}}',
				].join('\n'),
			},
		},
		fields: {
			note: 'Graph note',
			dateStarted: '2026-07-20',
			dateScheduled: '2026-07-25',
			dateDue: '2026-07-30',
			status: 'Pipeline 1.Not Started',
			priority: 'A',
		},
	}],
};
const fileIdentityGraph = prepareCanonicalTaskCreation(
	fileIdentityGraphRequest,
	createOptions(['fil0003', 'gra0001', 'grb0001', 'grc0001', 'grd0001', 'gre0001', 'grf0001']),
);
assert.equal(fileIdentityGraph.ok, true, fileIdentityGraph.ok ? '' : JSON.stringify(fileIdentityGraph.blockers));
if (!fileIdentityGraph.ok) throw new Error('Expected File Task identity graph to resolve.');
const fileIdentityGraphTask = fileIdentityGraph.plan.tasks[0];
const fileIdentityGraphContent = fileIdentityGraph.plan.sourceGroups[0].resultingContent;
assert.equal(fileIdentityGraphTask.operonId, 'fil0003');
assert.match(fileIdentityGraphContent, /^operonId: fil0003$/mu);
assert.equal(
	fileIdentityGraphTask.templateIdentityAllocations
		?.find(allocation => allocation.suffix === '1')?.operonId,
	'fil0003',
	'canonical File Task identity suffix must resolve to the sealed File Task ID',
);
const graphInlineTasks = fileIdentityGraphContent.split('\n').flatMap((line, lineNumber) => {
	const parsed = parseTaskLine(line, lineNumber, 'Tasks/Identity Graph.md', DEFAULT_SETTINGS.keyMappings);
	return parsed ? [parsed] : [];
});
const graphTaskByDescription = new Map(graphInlineTasks.map(task => [task.description, task]));
const parentOf = (description: string): string | undefined => (
	graphTaskByDescription.get(description)?.fields.find(field => field.key === 'parentTask')?.value
);
assert.equal(graphTaskByDescription.get('Root A')?.operonId, 'gra0001');
assert.equal(parentOf('Root A'), 'fil0003');
assert.equal(graphTaskByDescription.get('Child B')?.operonId, 'grb0001');
assert.equal(parentOf('Child B'), 'gra0001');
assert.equal(graphTaskByDescription.get('Root C')?.operonId, 'grc0001');
assert.equal(parentOf('Root C'), 'fil0003');
assert.equal(graphTaskByDescription.get('Child D')?.operonId, 'grd0001');
assert.equal(parentOf('Child D'), 'grc0001');
assert.equal(graphTaskByDescription.get('Root E')?.operonId, 'gre0001');
assert.equal(parentOf('Root E'), undefined);
assert.match(
	fileIdentityGraphContent,
	/Context Identity Graph 2026-07-24 10:20 2026-07-24T10:20:30 Identity Graph Graph note 2026-07-20 2026-07-25 2026-07-30 Pipeline 1\.Not Started A/u,
	'all deterministic File Task variables must continue to resolve alongside identity graphs',
);
const replayIdentityQueue = [
	fileIdentityGraphTask.operonId,
	...sealedTemplateIdentityGenerationQueueV1(
		fileIdentityGraphRequest.items,
		new Map([[
			fileIdentityGraphTask.itemKey,
			fileIdentityGraphTask.templateIdentityAllocations ?? [],
		]]),
	),
];
const replayedFileIdentityGraph = prepareCanonicalTaskCreation(
	fileIdentityGraphRequest,
	createOptions(replayIdentityQueue),
);
assert.equal(
	replayedFileIdentityGraph.ok,
	true,
	replayedFileIdentityGraph.ok ? '' : JSON.stringify(replayedFileIdentityGraph.blockers),
);
if (!replayedFileIdentityGraph.ok) throw new Error('Expected sealed File Task identity graph replay to resolve.');
assert.equal(
	replayedFileIdentityGraph.plan.sourceGroups[0].resultingContent,
	fileIdentityGraphContent,
	'preview/apply replay must preserve every File Task and inline graph identity',
);
assert.deepEqual(
	sealedTemplateIdentityGenerationQueueV1([
		{
			itemKey: 'child',
			description: 'Child',
			target: { representation: 'file', source: { filePath: 'Child.md', content: null, revision: 'missing' } },
			parent: { kind: 'local', itemKey: 'parent' },
		},
		{
			itemKey: 'parent',
			description: 'Parent',
			target: { representation: 'file', source: { filePath: 'Parent.md', content: null, revision: 'missing' } },
		},
	], new Map([
		['parent', [
			{ occurrence: 0, suffix: 'A', operonId: 'parenta' },
			{ occurrence: 1, suffix: 'A', operonId: 'parenta' },
			{ occurrence: 2, operonId: 'parentb' },
		]],
		['child', [{ occurrence: 0, suffix: 'a', operonId: 'childaa' }]],
	])),
	['parenta', 'parentb', 'childaa'],
	'sealed placeholder IDs must replay once per unique suffix in parent-first preparation order',
);
assert.deepEqual(
	sealedTemplateIdentityGenerationQueueV1([
		{
			itemKey: 'left',
			description: 'Left',
			target: { representation: 'file', source: { filePath: 'Left.md', content: null, revision: 'missing' } },
			parent: { kind: 'local', itemKey: 'right' },
		},
		{
			itemKey: 'right',
			description: 'Right',
			target: { representation: 'file', source: { filePath: 'Right.md', content: null, revision: 'missing' } },
			parent: { kind: 'local', itemKey: 'left' },
		},
	], new Map()),
	[],
	'invalid local cycles must remain bounded until canonical validation rejects them',
);

const invalidIdentityPlaceholder = prepareCanonicalTaskCreation(
	{
		requestId: 'invalid-file-task-identity-placeholder',
		items: [{
			itemKey: 'invalid-identity',
			description: 'Invalid identity placeholder',
			target: {
				representation: 'file',
				source: { filePath: 'Tasks/Invalid Identity.md', content: null, revision: 'missing' },
				identityPlaceholderPolicy: 'resolve-operon-id-v1',
				template: {
					templateId: 'invalid-identity-placeholder',
					revision: 'sha256:invalid-identity-placeholder',
					content: '---\n---\n- [ ] Invalid {{operonIdAA}}',
				},
			},
		}],
	},
	createOptions(['fil0003']),
);
assert.equal(invalidIdentityPlaceholder.ok, false);
if (!invalidIdentityPlaceholder.ok) {
	assert.ok(invalidIdentityPlaceholder.blockers.some(blocker => blocker.code === 'template-placeholder-unsupported'));
}

const visibleTemplateKey = (canonicalKey: string): string => (
	DEFAULT_SETTINGS.keyMappings.find(mapping => mapping.canonicalKey === canonicalKey)
		?.visiblePropertyName ?? canonicalKey
);
const deterministicVariableValues = {
	note: 'Variable note',
	dateStarted: '2026-07-20',
	dateScheduled: '2026-07-25',
	dateDue: '2026-07-30',
	status: 'Pipeline 1.Not Started',
	priority: 'A',
} as const;
const deterministicVariables = prepareCanonicalTaskCreation(
	{
		requestId: 'deterministic-operon-variables',
		items: [{
			itemKey: 'variables',
			description: 'Resolve every deterministic variable',
			target: {
				representation: 'file',
				source: {
					filePath: 'Tasks/Deterministic variables.md',
					content: null,
					revision: 'missing',
				},
				template: {
					templateId: 'deterministic-variables',
					revision: 'sha256:deterministic-variables',
					content: [
						'---',
						`${visibleTemplateKey('note')}: "{{note}}"`,
						`${visibleTemplateKey('dateStarted')}: "{{dateStarted}}"`,
						`${visibleTemplateKey('dateScheduled')}: "{{dateScheduled}}"`,
						`${visibleTemplateKey('dateDue')}: "{{dateDue}}"`,
						`${visibleTemplateKey('status')}: "{{status}}"`,
						`${visibleTemplateKey('priority')}: "{{priority}}"`,
						'---',
						'Date={{date}} Time={{time}} Datetime={{datetime}}',
						'Description={{taskDescription}}',
						'Note={{note}} Started={{dateStarted}} Scheduled={{dateScheduled}} Due={{dateDue}}',
						'Status={{status}} Priority={{priority}}',
						'- [ ] {{taskDescription}} | {{date}} | {{time}} | {{datetime}} | {{note}} | {{dateStarted}} | {{dateScheduled}} | {{dateDue}} | {{status}} | {{priority}}',
						'```md',
						'Literal {{note}} {{dateDue}} {{status}}',
						'```',
					].join('\n'),
				},
			},
			fields: deterministicVariableValues,
		}],
	},
	createOptions(['var0001']),
);
assert.equal(deterministicVariables.ok, true);
if (!deterministicVariables.ok) throw new Error('Expected deterministic Operon variables to resolve.');
const deterministicVariableContent = deterministicVariables.plan.sourceGroups[0].resultingContent;
assert.match(deterministicVariableContent, /Date=2026-07-24 Time=10:20 Datetime=2026-07-24T10:20:30/u);
assert.match(deterministicVariableContent, /Description=Resolve every deterministic variable/u);
assert.match(
	deterministicVariableContent,
	/Note=Variable note Started=2026-07-20 Scheduled=2026-07-25 Due=2026-07-30/u,
);
assert.match(deterministicVariableContent, /Status=Pipeline 1\.Not Started Priority=A/u);
for (const [canonicalKey, value] of Object.entries(deterministicVariableValues)) {
	assert.ok(
		deterministicVariableContent.split('\n').includes(`${visibleTemplateKey(canonicalKey)}: ${value}`),
		`${canonicalKey} frontmatter must use the final merged value`,
	);
}
assert.match(
	deterministicVariableContent,
	/- \[ \] Resolve every deterministic variable \| 2026-07-24 \| 10:20 \| 2026-07-24T10:20:30 \| Variable note \| 2026-07-20 \| 2026-07-25 \| 2026-07-30 \| Pipeline 1\.Not Started \| A/u,
);
assert.match(deterministicVariableContent, /Literal \{\{note\}\} \{\{dateDue\}\} \{\{status\}\}/u);
assert.doesNotMatch(
	deterministicVariableContent.replace(/```md[\s\S]*?```/gu, ''),
	/\{\{(?:date|time|datetime|taskDescription|note|dateStarted|dateScheduled|dateDue|status|priority)\}\}/u,
);

const literalTemplateDefaults = prepareCanonicalTaskCreation(
	{
		requestId: 'literal-template-defaults',
		items: [{
			itemKey: 'literal-defaults',
			description: 'Preserve literal template defaults',
			target: {
				representation: 'file',
				source: {
					filePath: 'Tasks/Literal template defaults.md',
					content: null,
					revision: 'missing',
				},
				template: {
					templateId: 'literal-template-defaults',
					revision: 'sha256:literal-template-defaults',
					content: [
						'---',
						`${visibleTemplateKey('note')}: Literal template note`,
						`${visibleTemplateKey('dateDue')}: 2026-08-01`,
						`${visibleTemplateKey('status')}: Project.Brainstorming`,
						`${visibleTemplateKey('priority')}: C`,
						'---',
					].join('\n'),
				},
			},
		}],
	},
	createOptions(['var0004']),
);
assert.equal(literalTemplateDefaults.ok, true);
if (!literalTemplateDefaults.ok) throw new Error('Expected literal template defaults to remain valid.');
const literalTemplateTask = literalTemplateDefaults.plan.tasks[0];
const literalTemplateContent = literalTemplateDefaults.plan.sourceGroups[0].resultingContent;
assert.equal(literalTemplateTask.fieldValues.note, 'Literal template note');
assert.equal(literalTemplateTask.fieldValues.dateDue, '2026-08-01');
assert.equal(literalTemplateTask.fieldValues.status, 'Project.Brainstorming');
assert.equal(literalTemplateTask.fieldValues.priority, 'C');
assert.ok(
	literalTemplateContent.split('\n').includes(`${visibleTemplateKey('note')}: Literal template note`),
);
assert.doesNotMatch(
	literalTemplateContent,
	new RegExp(`^${visibleTemplateKey('dateStarted')}:`, 'mu'),
);

const unknownDeterministicVariable = prepareCanonicalTaskCreation(
	{
		requestId: 'unknown-deterministic-operon-variable',
		items: [{
			itemKey: 'unknown-variable',
			description: 'Reject an unknown deterministic variable',
			target: {
				representation: 'file',
				source: {
					filePath: 'Tasks/Unknown deterministic variable.md',
					content: null,
					revision: 'missing',
				},
				template: {
					templateId: 'unknown-deterministic-variable',
					revision: 'sha256:unknown-deterministic-variable',
					content: 'Unknown={{unknownOperonVariable}}',
				},
			},
		}],
	},
	createOptions(['var0003']),
);
assert.equal(unknownDeterministicVariable.ok, false);
if (!unknownDeterministicVariable.ok) {
	assert.ok(
		unknownDeterministicVariable.blockers.some(
			blocker => blocker.code === 'template-placeholder-unsupported',
		),
	);
}

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
	const configuredFinalRouteCalls: Array<Readonly<Record<string, string>>> = [];
	const configuredTemplatePipelineAndRecurrence = await prepareRuntimeTaskCreationV1(
		'runtime-configured-template-pipeline-recurrence',
		{
			operation: 'create',
			items: [{
				itemRef: 'configured-template-repeat',
				description: 'Configured template repeat',
				target: {
					representation: 'file',
					mode: 'configured-default',
					templateId: 'pipeline-template',
				},
				fields: [],
			}],
		},
		{
			...runtimePorts,
			settings: () => ({
				...runtimeSettings,
				fileTaskPipelineLocations: [{ pipelineId: 'pl_project', folder: 'Pipeline/Tasks' }],
			}),
			resolveConfiguredFilePath: async (description, _parent, finalFields = {}) => {
				configuredFinalRouteCalls.push({ ...finalFields });
				const folder = finalFields['status'] === 'Project.Brainstorming'
					&& finalFields['repeat']
					&& finalFields['repeatSeriesId']
					&& finalFields['dateScheduled'] === '2026-07-30'
					? 'Pipeline/Tasks'
					: 'Operon/Tasks';
				return `${folder}/${description}.md`;
			},
			readTemplate: async templateId => templateId === 'pipeline-template'
				? {
					templateId,
					content: [
						'---',
						`${visibleTemplateKey('repeat')}: mode=schedule|freq=week|interval=1`,
						`${visibleTemplateKey('dateScheduled')}: 2026-07-30`,
						'---',
						'',
					].join('\n'),
					revision: 'template:pipeline-template',
				}
				: null,
		},
	);
	assert.equal(
		configuredTemplatePipelineAndRecurrence.ok,
		true,
		JSON.stringify(configuredTemplatePipelineAndRecurrence),
	);
	if (configuredTemplatePipelineAndRecurrence.ok) {
		const finalRouteFields = configuredFinalRouteCalls.at(-1);
		assert.equal(
			finalRouteFields?.['status'],
			'Project.Brainstorming',
		);
		assert.equal(finalRouteFields?.['repeat'], 'mode=schedule|freq=week|interval=1');
		assert.equal(finalRouteFields?.['repeatSeriesId'], 'series-2');
		assert.equal(finalRouteFields?.['dateScheduled'], '2026-07-30');
		assert.equal(
			configuredTemplatePipelineAndRecurrence.plan.tasks[0].filePath,
			'Pipeline/Tasks/Configured template repeat.md',
			'configured Runtime File Tasks must route after template and recurrence fields are final',
		);
	}
	const provisionalReads: string[] = [];
	const configuredFinalRouteAvoidsProvisionalCollision = await prepareRuntimeTaskCreationV1(
		'runtime-configured-final-route-avoids-provisional-collision',
		{
			operation: 'create',
			items: [{
				itemRef: 'configured-final-route',
				description: 'Configured final route',
				target: {
					representation: 'file',
					mode: 'configured-default',
					templateId: 'final-route-template',
				},
				fields: [],
			}],
		},
		{
			...runtimePorts,
			resolveConfiguredFilePath: async (description, _parent, finalFields = {}) => {
				const folder = finalFields['status'] === 'Project.Brainstorming'
					&& finalFields['repeat']
					&& finalFields['repeatSeriesId']
					&& finalFields['dateScheduled'] === '2026-07-30'
					? 'Pipeline/Tasks'
					: 'Operon/Tasks';
				return `${folder}/${description}.md`;
			},
			readSource: async filePath => {
				provisionalReads.push(filePath);
				return {
					filePath,
					content: filePath === 'Operon/Tasks/Configured final route.md'
						? '---\noperonId: occupied\n---\n'
						: null,
				};
			},
			readTemplate: async templateId => templateId === 'final-route-template'
				? {
					templateId,
					content: [
						'---',
						`${visibleTemplateKey('repeat')}: mode=schedule|freq=week|interval=1`,
						`${visibleTemplateKey('dateScheduled')}: 2026-07-30`,
						'---',
						'',
					].join('\n'),
					revision: 'template:final-route-template',
				}
				: null,
		},
	);
	assert.equal(
		configuredFinalRouteAvoidsProvisionalCollision.ok,
		true,
		JSON.stringify(configuredFinalRouteAvoidsProvisionalCollision),
	);
	if (configuredFinalRouteAvoidsProvisionalCollision.ok) {
		assert.equal(
			configuredFinalRouteAvoidsProvisionalCollision.plan.tasks[0].filePath,
			'Pipeline/Tasks/Configured final route.md',
		);
		assert.equal(
			provisionalReads.includes('Operon/Tasks/Configured final route.md'),
			false,
			'an occupied provisional fallback must not reject the final template/recurrence pipeline route',
		);
		assert.equal(provisionalReads.includes('Pipeline/Tasks/Configured final route.md'), true);
	}
	const twoItemFinalRouteFields: Array<Readonly<Record<string, string>>> = [];
	const configuredTwoItemPipelineRoutes = await prepareRuntimeTaskCreationV1(
		'runtime-configured-two-item-final-pipeline-routes',
		{
			operation: 'create',
			items: [
				{
					itemRef: 'pipeline-a',
					description: 'Same description',
					target: { representation: 'file', mode: 'configured-default', templateId: 'pipeline-a-template' },
					fields: [],
				},
				{
					itemRef: 'pipeline-b',
					description: 'Same description',
					target: { representation: 'file', mode: 'configured-default', templateId: 'pipeline-b-template' },
					fields: [],
				},
			],
		},
		{
			...runtimePorts,
		generateOperonId: (() => {
			let cursor = 0;
			return () => `rt${String(++cursor).padStart(5, '0')}`;
		})(),
		resolveConfiguredFilePath: async (description, _parent, finalFields = {}) => {
			twoItemFinalRouteFields.push({ ...finalFields });
			const folder = finalFields['dateScheduled'] === '2026-07-30'
				? 'Pipeline/A'
				: finalFields['dateScheduled'] === '2026-08-06'
					? 'Pipeline/B'
						: 'Operon/Tasks';
				return `${folder}/${description}.md`;
		},
		readTemplate: async templateId => {
			const dateScheduled = templateId === 'pipeline-a-template'
					? '2026-07-30'
					: templateId === 'pipeline-b-template'
						? '2026-08-06'
						: null;
				return dateScheduled
					? {
						templateId,
						content: `---\n${visibleTemplateKey('dateScheduled')}: ${dateScheduled}\n---\n`,
						revision: `template:${templateId}`,
					}
					: null;
			},
		},
	);
	assert.equal(
		configuredTwoItemPipelineRoutes.ok,
		true,
		`${JSON.stringify(configuredTwoItemPipelineRoutes)} ${JSON.stringify(twoItemFinalRouteFields)}`,
	);
	if (configuredTwoItemPipelineRoutes.ok) {
		assert.deepEqual(
			configuredTwoItemPipelineRoutes.plan.tasks.map(task => [task.itemKey, task.filePath]),
			[
				['pipeline-a', 'Pipeline/A/Same description.md'],
				['pipeline-b', 'Pipeline/B/Same description.md'],
			],
			'equal configured-default descriptions may share a provisional fallback only after final template routes diverge',
		);
		assert.deepEqual(
			twoItemFinalRouteFields.slice(-2).map(fields => fields['dateScheduled']),
			['2026-07-30', '2026-08-06'],
			'each final route receives its template-derived field values',
		);
	}
	const configuredDatetimeDefault = await prepareRuntimeTaskCreationV1(
		'runtime-configured-datetime-default',
		{
			operation: 'create',
			items: [{
				itemRef: 'configured-datetime',
				description: 'Configured datetime default',
				target: { mode: 'configured-default' },
				fields: [],
			}],
		},
		{
			...runtimePorts,
			settings: () => ({ ...runtimeSettings, taskCreatorDefaultToFileTask: false }),
			resolveConfiguredInlineTarget: async () => ({
				filePath: 'Tasks/Configured datetime.md',
				placement: { kind: 'append' },
				defaultFields: {
					datetimeStart: '2026-07-26T09:30',
					customDatetime: '2026-07-26T10:45',
				},
			}),
			creationFieldCatalog: () => [
				{
					canonicalKey: 'datetimeStart',
					displayName: 'Starts at',
					description: 'Built-in start datetime.',
					valueType: 'datetime',
					source: 'built-in',
					mappingStatus: 'mapped',
					readable: true,
					mutationClass: 'general-update',
					mutationOwner: 'tasks.update',
					requiresStableTaxonomyId: false,
				},
				{
					canonicalKey: 'customDatetime',
					displayName: 'Custom datetime',
					description: 'Synthetic custom datetime field.',
					valueType: 'datetime',
					source: 'custom',
					mappingStatus: 'mapped',
					readable: true,
					mutationClass: 'general-update',
					mutationOwner: 'tasks.update',
					requiresStableTaxonomyId: false,
				},
			],
		},
	);
	assert.equal(configuredDatetimeDefault.ok, true, JSON.stringify(configuredDatetimeDefault));
	if (configuredDatetimeDefault.ok) {
		assert.equal(
			configuredDatetimeDefault.plan.tasks[0].fieldValues.datetimeStart,
			'2026-07-26T09:30:00',
		);
		assert.equal(
			configuredDatetimeDefault.plan.tasks[0].fieldValues.customDatetime,
			'2026-07-26T10:45:00',
		);
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
						kind: 'datetime',
						field: 'datetimeStart',
						value: '2026-07-26T09:30',
					},
					{
						kind: 'datetime',
						field: 'datetimeEnd',
						value: '2026-07-26T10:45:30',
					},
					{
						kind: 'custom',
						field: 'customDatetime',
						valueType: 'datetime',
						value: '2026-07-26T11:15',
					},
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
		{
			...runtimePorts,
			creationFieldCatalog: () => [
				...['datetimeStart', 'datetimeEnd'].map(field => ({
					canonicalKey: field,
					displayName: field,
					description: `Built-in ${field} field.`,
					valueType: 'datetime' as const,
					source: 'built-in' as const,
					mappingStatus: 'mapped' as const,
					readable: true,
					mutationClass: 'general-update' as const,
					mutationOwner: 'tasks.update',
					requiresStableTaxonomyId: false,
				})),
				{
					canonicalKey: 'customDatetime',
					displayName: 'Custom datetime',
					description: 'Synthetic custom datetime field.',
					valueType: 'datetime',
					source: 'custom',
					mappingStatus: 'mapped',
					readable: true,
					mutationClass: 'general-update',
					mutationOwner: 'tasks.update',
					requiresStableTaxonomyId: false,
				},
			],
		},
	);
	assert.equal(temporalCreation.ok, true, JSON.stringify(temporalCreation));
	if (temporalCreation.ok) {
		const temporalTask = temporalCreation.plan.tasks[0];
		assert.equal(temporalTask.fieldValues['datetimeStart'], '2026-07-26T09:30:00');
		assert.equal(temporalTask.fieldValues['datetimeEnd'], '2026-07-26T10:45:30');
		assert.equal(temporalTask.fieldValues['customDatetime'], '2026-07-26T11:15:00');
		assert.equal(
			temporalTask.fieldValues['reminderDatetimes'],
			'2026-07-26T09:00:00; 2026-07-25T08:00:00',
			'canonical reminder values preserve request order',
		);
		assert.equal(temporalTask.fieldValues['repeatOccurrenceDate'], '2026-07-26');
		assert.equal(temporalTask.fieldValues['repeatSeriesId'], 'series-2');
		assert.equal(temporalCreation.createEffects[0].repeatSeriesId, 'series-2');
		assert.equal(temporalCreation.recurrenceResources[0].seriesId, 'series-2');
		assert.equal(
			temporalCreation.recurrenceResources[0].baseTemporalTemplate.mode,
			'timed',
		);
	}
	const temporalFileCreation = await prepareRuntimeTaskCreationV1(
		'runtime-temporal-file-create',
		{
			operation: 'create',
			items: [{
				itemRef: 'temporal-file',
				description: 'Temporal file task',
				target: {
					representation: 'file',
					mode: 'exact-path',
					filePath: 'Tasks/Temporal file task.md',
				},
				fields: [{
					kind: 'datetime',
					field: 'datetimeStart',
					value: '2026-07-26T09:30',
				}, {
					kind: 'custom',
					field: 'customDatetime',
					valueType: 'datetime',
					value: '2026-07-26T10:45',
				}],
			}],
		},
		{
			...runtimePorts,
			settings: () => ({
				...runtimeSettings,
				keyMappings: [...runtimeSettings.keyMappings, {
					canonicalKey: 'customDatetime',
					visiblePropertyName: 'CustomDatetime',
					type: 'datetime',
					sync: 'yes',
					enabled: true,
					isSystem: false,
					customOrder: 0,
				}],
			}),
			creationFieldCatalog: () => [{
				canonicalKey: 'datetimeStart',
				displayName: 'Starts at',
				description: 'Built-in start datetime.',
				valueType: 'datetime',
				source: 'built-in',
				mappingStatus: 'mapped',
				readable: true,
				mutationClass: 'general-update',
				mutationOwner: 'tasks.update',
				requiresStableTaxonomyId: false,
			}, {
				canonicalKey: 'customDatetime',
				displayName: 'Custom datetime',
				description: 'Synthetic custom datetime field.',
				valueType: 'datetime',
				source: 'custom',
				mappingStatus: 'mapped',
				readable: true,
				mutationClass: 'general-update',
				mutationOwner: 'tasks.update',
				requiresStableTaxonomyId: false,
			}],
		},
	);
	assert.equal(temporalFileCreation.ok, true, JSON.stringify(temporalFileCreation));
	if (temporalFileCreation.ok) {
		assert.equal(
			temporalFileCreation.plan.tasks[0].fieldValues['datetimeStart'],
			'2026-07-26T09:30:00',
			'inline and file task plans must share canonical datetime storage',
		);
		assert.equal(
			temporalFileCreation.plan.tasks[0].fieldValues['customDatetime'],
			'2026-07-26T10:45:00',
		);
		const renderedFile = temporalFileCreation.plan.tasks[0].renderedFileContent ?? '';
		assert.match(renderedFile, /^datetimeStart: 2026-07-26T09:30:00$/mu);
		assert.match(renderedFile, /^CustomDatetime: 2026-07-26T10:45:00$/mu);
		assert.equal(
			temporalFileCreation.plan.sourceGroups[0]?.resultingContent,
			renderedFile,
			'File Task source group must commit the exact canonical rendered content.',
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

	const emptyDeterministicVariables = prepareCanonicalTaskCreation(
		{
			requestId: 'empty-deterministic-operon-variables',
			items: [{
				itemKey: 'empty-variables',
				description: 'Resolve empty deterministic variables',
				target: {
					representation: 'file',
					source: {
						filePath: 'Tasks/Empty deterministic variables.md',
						content: null,
						revision: 'missing',
					},
					template: {
						templateId: 'empty-deterministic-variables',
						revision: 'sha256:empty-deterministic-variables',
						content: [
							'---',
							`${visibleTemplateKey('note')}: "{{note}}"`,
							`${visibleTemplateKey('dateStarted')}: "{{dateStarted}}"`,
							`${visibleTemplateKey('dateScheduled')}: "{{dateScheduled}}"`,
							`${visibleTemplateKey('dateDue')}: "{{dateDue}}"`,
							`${visibleTemplateKey('status')}: "{{status}}"`,
							`${visibleTemplateKey('priority')}: "{{priority}}"`,
							'---',
							'Optional={{note}}/{{dateStarted}}/{{dateScheduled}}/{{dateDue}}',
							'Defaults={{status}}/{{priority}}',
						].join('\n'),
					},
				},
			}],
		},
		createOptions(['var0002']),
	);
	assert.equal(
		emptyDeterministicVariables.ok,
		true,
		emptyDeterministicVariables.ok
			? 'Empty optional fields and defaulted status/priority must resolve without leaving placeholders.'
			: JSON.stringify(emptyDeterministicVariables.blockers),
	);
	if (emptyDeterministicVariables.ok) {
		const emptyVariableContent = emptyDeterministicVariables.plan.sourceGroups[0].resultingContent;
		const emptyVariableTask = emptyDeterministicVariables.plan.tasks[0];
		const expectedDefaultStatus = resolveDefaultFileTaskStatus(
			DEFAULT_SETTINGS.pipelines,
			DEFAULT_SETTINGS.defaultPipelineName,
		);
		assert.ok(expectedDefaultStatus);
		for (const canonicalKey of ['note', 'dateStarted', 'dateScheduled', 'dateDue']) {
			assert.equal(emptyVariableTask.fieldValues[canonicalKey] ?? '', '');
			assert.ok(
				emptyVariableContent.split('\n').includes(`${visibleTemplateKey(canonicalKey)}:`),
				`${canonicalKey} frontmatter must resolve to an empty scalar`,
			);
		}
		assert.equal(emptyVariableTask.fieldValues.status, expectedDefaultStatus);
		assert.equal(emptyVariableTask.fieldValues.priority, DEFAULT_SETTINGS.defaultPriority);
		assert.ok(
			emptyVariableContent.split('\n').includes(
				`${visibleTemplateKey('status')}: ${expectedDefaultStatus}`,
			),
		);
		assert.ok(
			emptyVariableContent.split('\n').includes(
				`${visibleTemplateKey('priority')}: ${DEFAULT_SETTINGS.defaultPriority}`,
			),
		);
		assert.match(emptyVariableContent, /Optional=\/\/\//u);
		assert.ok(
			emptyVariableContent.includes(
				`Defaults=${expectedDefaultStatus}/${DEFAULT_SETTINGS.defaultPriority}`,
			),
		);
		assert.doesNotMatch(
			emptyVariableContent,
			/\{\{(?:note|dateStarted|dateScheduled|dateDue|status|priority)\}\}/u,
		);
	}

	console.log('Operon canonical task creation domain tests passed.');
}

const creationTestGlobal = globalThis as typeof globalThis & {
	__operonTaskCreationDomainTestRun?: Promise<void>;
};
creationTestGlobal.__operonTaskCreationDomainTestRun = runCommitPortTests();
