import assert from 'node:assert/strict';

import type {
	CatalogPoliciesV1,
	ContextRevisionV1,
	OperonCatalogV1,
	PlacementCandidateRequestV1,
	PlacementCandidatesV1,
	TaskContextV1,
} from '../../../src/agent-runtime/contracts/v1';
import {
	runGuidedConvertWizardV1,
	runGuidedDeleteWizardV1,
	runGuidedRelocateWizardV1,
} from '../../../packages/operon-cli/src/guided-source-transitions';
import type { InteractiveTerminalPortV1 } from '../../../packages/operon-cli/src/terminal-port';

async function run(): Promise<void> {
	await testRelocation();
	await testConversion();
	await testDeletion();
	console.log('Operon CLI guided source-transition model tests passed.');
}

async function testRelocation(): Promise<void> {
	const requests: PlacementCandidateRequestV1[] = [];
	const terminal = scriptedPort(['', '1', '1', '']);
	const result = await runGuidedRelocateWizardV1({
		port: terminal.port,
		task: inlineTask(),
		loadPlacement: placementLoader(requests),
	});
	assert.equal(result.status, 'ready');
	if (result.status !== 'ready') throw new Error('GUIDED_RELOCATION_NOT_READY');
	assert.deepEqual(requests, [
		{ mode: 'files' },
		{ mode: 'lines', filePath: 'Daily/Target.md' },
	]);
	assert.deepEqual(result.intent, {
		contractVersion: 1,
		kind: 'mutation-intent',
		reason: 'The user completed the guided Operon inline relocation flow.',
		target: {
			operonId: 'abc1234',
			locator: { representation: 'inline', filePath: 'Daily/Source.md', lineNumber: 3 },
		},
		spec: {
			operation: 'relocate-inline',
			destination: {
				locator: {
					representation: 'inline',
					filePath: 'Daily/Target.md',
					lineNumber: 8,
				},
				mustBeBlank: true,
			},
		},
	});
	assert.match(terminal.output(), /Line 9/u);
	assert.doesNotMatch(JSON.stringify(result.intent), /sourceRevision|lineDigest/u);

	await assert.rejects(
		() => runGuidedRelocateWizardV1({
			port: scriptedPort([]).port,
			task: fileTask(),
			loadPlacement: placementLoader([]),
		}),
		/GUIDED_INLINE_TASK_REQUIRED/u,
	);

	const cancelled = await runGuidedRelocateWizardV1({
		port: scriptedPort(['q']).port,
		task: inlineTask(),
		loadPlacement: placementLoader([]),
	});
	assert.equal(cancelled.status, 'cancelled');
}

async function testConversion(): Promise<void> {
	const configured = scriptedPort(['', '', '']);
	const inlineConfigured = await runGuidedConvertWizardV1({
		port: configured.port,
		task: inlineTask(),
		catalog: catalog(),
		loadPlacement: placementLoader([]),
	});
	assert.equal(inlineConfigured.status, 'ready');
	if (inlineConfigured.status !== 'ready') throw new Error('GUIDED_INLINE_CONVERSION_NOT_READY');
	assert.deepEqual(inlineConfigured.intent.spec, {
		operation: 'convert',
		from: 'inline',
		to: 'file',
		templateId: 'folder-file-task-template:Templates/Default.md',
	});

	const exact = scriptedPort(['2', 'n', 'Tasks/Converted.md', '']);
	const inlineExact = await runGuidedConvertWizardV1({
		port: exact.port,
		task: inlineTask(),
		catalog: catalog(),
		loadPlacement: placementLoader([]),
	});
	assert.equal(inlineExact.status, 'ready');
	if (inlineExact.status !== 'ready') throw new Error('GUIDED_INLINE_EXACT_CONVERSION_NOT_READY');
	assert.deepEqual(inlineExact.intent.spec, {
		operation: 'convert',
		from: 'inline',
		to: 'file',
		templateId: 'builtin-minimal-file-task-template:pipeline-work',
		targetPath: 'Tasks/Converted.md',
	});

	await assert.rejects(
		() => runGuidedConvertWizardV1({
			port: scriptedPort([]).port,
			task: inlineTask(),
			catalog: catalog({ templates: false }),
			loadPlacement: placementLoader([]),
		}),
		/GUIDED_TEMPLATE_UNAVAILABLE/u,
	);

	const placementRequests: PlacementCandidateRequestV1[] = [];
	const destructive = scriptedPort(['', '1', '1', 'y']);
	const fileToInline = await runGuidedConvertWizardV1({
		port: destructive.port,
		task: fileTask(),
		catalog: catalog(),
		loadPlacement: placementLoader(placementRequests),
	});
	assert.equal(fileToInline.status, 'ready');
	if (fileToInline.status !== 'ready') throw new Error('GUIDED_FILE_CONVERSION_NOT_READY');
	assert.deepEqual(placementRequests, [
		{ mode: 'files' },
		{ mode: 'lines', filePath: 'Daily/Target.md' },
	]);
	assert.deepEqual(fileToInline.intent.spec, {
		operation: 'convert',
		from: 'file',
		to: 'inline',
		target: {
			mode: 'exact-line',
			filePath: 'Daily/Target.md',
			lineNumber: 8,
		},
	});
	assert.match(destructive.output(), /trashes the source File Task/u);
	assert.match(destructive.output(), /exact loss manifest/u);

	const declined = await runGuidedConvertWizardV1({
		port: scriptedPort(['', '1', '1', '']).port,
		task: fileTask(),
		catalog: catalog(),
		loadPlacement: placementLoader([]),
	});
	assert.equal(declined.status, 'cancelled');
}

async function testDeletion(): Promise<void> {
	const defaultNo = scriptedPort(['']);
	const cancelled = await runGuidedDeleteWizardV1({
		port: defaultNo.port,
		task: fileTask(),
	});
	assert.equal(cancelled.status, 'cancelled');
	assert.match(defaultNo.output(), /complete File Task will be moved to trash/u);

	const accepted = scriptedPort(['DELETE']);
	const invalidWord = await runGuidedDeleteWizardV1({
		port: accepted.port,
		task: inlineTask(),
	});
	assert.equal(invalidWord.status, 'cancelled');
	assert.doesNotMatch(accepted.output(), /receipt|digest|token/iu);

	const preview = await runGuidedDeleteWizardV1({
		port: scriptedPort(['y']).port,
		task: inlineTask(),
	});
	assert.equal(preview.status, 'ready');
	if (preview.status !== 'ready') throw new Error('GUIDED_DELETE_NOT_READY');
	assert.deepEqual(preview.intent.spec, {
		operation: 'delete',
		mode: 'delete-exact-task',
		cascade: false,
	});
	assert.equal(preview.intent.target?.operonId, 'abc1234');
}

function placementLoader(requests: PlacementCandidateRequestV1[]) {
	return async (request: PlacementCandidateRequestV1): Promise<PlacementCandidatesV1> => {
		requests.push(structuredClone(request));
		if (request.mode === 'files') {
			return {
				mode: 'files',
				actualCount: 1,
				returnedCount: 1,
				truncated: false,
				files: [{ filePath: 'Daily/Target.md', noteName: 'Target' }],
			};
		}
		return {
			mode: 'lines',
			filePath: request.filePath,
			sourceRevision: { algorithm: 'sha256', contentDigest: 'a'.repeat(64) },
			actualCount: 1,
			returnedCount: 1,
			truncated: false,
			lines: [{
				locator: {
					representation: 'inline',
					filePath: request.filePath,
					lineNumber: 8,
				},
				heading: 'Tasks',
				contextLabel: 'Blank line after Tasks',
			}],
		};
	};
}

function inlineTask(): TaskContextV1 {
	return {
		...baseTask(),
		representation: 'inline',
		locator: { representation: 'inline', filePath: 'Daily/Source.md', lineNumber: 3 },
	};
}

function fileTask(): TaskContextV1 {
	return {
		...baseTask(),
		representation: 'file',
		locator: { representation: 'file', filePath: 'Tasks/Source.md' },
	};
}

function baseTask(): Omit<TaskContextV1, 'representation' | 'locator'> {
	return {
		identity: { operonId: 'abc1234', validity: 'canonical', mutationAllowed: true },
		description: 'Private\ntransition task',
		checkbox: 'open',
		workflow: {
			pipeline: { id: 'pipeline-work', label: 'Work' },
			status: { id: 'status-open', label: 'Open' },
		},
		priority: { id: 'priority-normal', label: 'Normal' },
		dates: {},
		datetimes: {},
		relationships: {
			childOperonIds: [],
			blockingOperonIds: [],
			blockedByOperonIds: [],
			relatedOperonIds: [],
		},
		recurrence: { repeating: false },
		tracker: { active: false, sessionCount: 0 },
		pinned: false,
		sourceRevision: { algorithm: 'sha256', contentDigest: 'b'.repeat(64) },
		contextRevision: revision(),
	};
}

function revision(): ContextRevisionV1 {
	return {
		index: { sessionId: 'phase7-guided', ramGeneration: 1, durable: { status: 'missing' } },
		settingsFingerprint: 'c'.repeat(64),
		pinnedGeneration: 0,
		activeTrackerGeneration: 0,
		repeatSeriesRevision: 0,
		projectSerialGeneration: 0,
		projectSerialSignature: 'd'.repeat(64),
	};
}

function catalog(options: { templates?: boolean } = {}): OperonCatalogV1 {
	const templates = options.templates ?? true;
	const policies: CatalogPoliciesV1 = {
		creation: {
			descriptionRequired: true,
			assigneesRequired: false,
			defaultEstimateMinutes: 0,
			defaultToFileTask: false,
			fileTaskTargetFolder: 'Tasks',
			fileTaskTemplateFolder: 'Templates',
			...(templates ? {
				defaultFileTemplateId: 'folder-file-task-template:Templates/Default.md',
			} : {}),
			inlineTaskSaveMode: 'specific-file',
			inlineTaskTargetFile: 'Daily/Source.md',
			inlineTaskHeading: '',
			dailyNoteAddsStartDate: false,
			dailyNoteAddsScheduledDate: false,
			createDailyNotesAsFileTasks: false,
			calendarInlineTaskHeading: '',
			builtInTemplateCandidates: templates ? [{
				id: 'builtin-minimal-file-task-template:pipeline-work',
				pipelineId: 'pipeline-work',
				initialStatusId: 'status-open',
			}] : [],
		},
	} as CatalogPoliciesV1;
	return {
		contractVersion: 1,
		requestId: 'phase7-catalog',
		kind: 'catalog-result',
		ok: true,
		freshness: {
			source: 'live-runtime',
			coherence: 'verified',
			observedAt: '2026-07-25T12:00:00.000Z',
			settled: true,
		},
		warnings: [],
		contextRevision: revision(),
		settingsFingerprint: 'c'.repeat(64),
		catalogRevision: 'e'.repeat(64),
		taxonomy: {
			defaultPipeline: { configuredValue: 'Work', id: 'pipeline-work', status: 'resolved' },
			defaultPriority: { configuredValue: 'Normal', id: 'priority-normal', status: 'resolved' },
			pipelines: [{
				id: 'pipeline-work',
				name: 'Work',
				description: 'Work tasks',
				order: 0,
				identityStatus: 'resolved',
				statuses: [],
			}],
			priorities: [],
		},
		fields: [],
		policies,
	};
}

function scriptedPort(answers: string[]): {
	port: InteractiveTerminalPortV1;
	output(): string;
} {
	let index = 0;
	let output = '';
	return {
		port: {
			ask(prompt: string): Promise<string | null> {
				output += prompt;
				return Promise.resolve(index < answers.length ? answers[index++] : null);
			},
			write(value: string): void {
				output += value;
			},
		},
		output: () => output,
	};
}

globalThis.__operonGuidedSourceTransitionTestRun = run();

declare global {
	var __operonGuidedSourceTransitionTestRun: Promise<void> | undefined;
}
