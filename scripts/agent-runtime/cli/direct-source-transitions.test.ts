import assert from 'node:assert/strict';

import {
	directMarkdownPathV1,
	isExpectedDirectConvertSpecV1,
	isExpectedDirectRelocateSpecV1,
	isExpectedDirectSemanticConfirmationPlanV1,
	resolveExactDirectPlacementV1,
	resolveExactDirectTemplateIdV1,
	runPublicCommandLineV1,
} from '../../../packages/operon-cli/src/command-line';
import { completionCandidatesV1 } from '../../../packages/operon-cli/src/command-registry';
import type {
	ContextPackV1,
	OperonCatalogV1,
	SealedMutationPlanV1,
} from '../../../src/agent-runtime/contracts/v1';

declare global {
	var __operonDirectSourceTransitionTestRun: Promise<void> | undefined;
}

globalThis.__operonDirectSourceTransitionTestRun = Promise.resolve().then(run);

async function run(): Promise<void> {
	assert.equal(directMarkdownPathV1('Tasks/Exact.md'), 'Tasks/Exact.md');
	for (const invalid of ['', '/Exact.md', '../Exact.md', 'Exact.txt', 'Bad\\Exact.md']) {
		assert.throws(() => directMarkdownPathV1(invalid), /DIRECT_TARGET_FILE_INVALID/u);
	}

	const catalog = {
		ok: true,
		policies: {
			creation: {
				fileTaskTemplateCandidates: [
					{ id: 'tpl-a', name: 'Exact Template' },
					{ id: 'tpl-b', name: 'exact template' },
				],
			},
		},
	} as unknown as OperonCatalogV1;
	assert.equal(resolveExactDirectTemplateIdV1(catalog, 'Exact Template'), 'tpl-a');
	assert.throws(
		() => resolveExactDirectTemplateIdV1(catalog, 'EXACT TEMPLATE'),
		/DIRECT_TEMPLATE_UNAVAILABLE/u,
	);
	const ambiguous = {
		...catalog,
		policies: {
			...(catalog.ok ? catalog.policies : {}),
			creation: {
				...(catalog.ok ? catalog.policies.creation : {}),
				fileTaskTemplateCandidates: [
					{ id: 'tpl-a', name: 'Same' },
					{ id: 'tpl-b', name: 'Same' },
				],
			},
		},
	} as OperonCatalogV1;
	assert.throws(
		() => resolveExactDirectTemplateIdV1(ambiguous, 'Same'),
		/DIRECT_TEMPLATE_UNAVAILABLE/u,
	);

	const context = placementContext(false);
	assert.deepEqual(
		resolveExactDirectPlacementV1(context, 'Notes/Target.md', 4).locator,
		{ representation: 'inline', filePath: 'Notes/Target.md', lineNumber: 3 },
	);
	assert.throws(
		() => resolveExactDirectPlacementV1(context, 'Notes/Target.md', 3),
		/DIRECT_PLACEMENT_UNAVAILABLE/u,
	);
	assert.throws(
		() => resolveExactDirectPlacementV1(placementContext(true), 'Notes/Target.md', 4),
		/DIRECT_PLACEMENT_UNAVAILABLE/u,
	);

	const requested = {
		operation: 'relocate-inline',
		destination: {
			locator: { representation: 'inline', filePath: 'Notes/Target.md', lineNumber: 3 },
			mustBeBlank: true,
		},
	} as const;
	const sourceLocator = {
		representation: 'inline' as const,
		filePath: 'Notes/Source.md',
		lineNumber: 1,
	};
	const digest = 'a'.repeat(64);
	const sealed = {
		operation: 'relocate-inline',
		source: {
			locator: sourceLocator,
			lineDigest: digest,
			sourceRevision: { algorithm: 'sha256', contentDigest: digest },
		},
		destination: {
			...requested.destination,
			lineDigest: digest,
			sourceRevision: { algorithm: 'sha256', contentDigest: digest },
		},
	} as const;
	assert.equal(isExpectedDirectRelocateSpecV1(sealed, requested, sourceLocator), true);
	assert.equal(isExpectedDirectRelocateSpecV1({
		...sealed,
		destination: {
			...sealed.destination,
			locator: { ...sealed.destination.locator, lineNumber: 4 },
		},
	}, requested, sourceLocator), false);
	const convert = {
		operation: 'convert',
		from: 'inline',
		to: 'file',
		templateId: 'tpl-a',
		targetPath: 'Tasks/Exact.md',
	} as const;
	assert.equal(isExpectedDirectConvertSpecV1(convert, convert), true);
	assert.equal(isExpectedDirectConvertSpecV1({ ...convert, templateId: 'tpl-b' }, convert), false);
	assert.equal(isExpectedDirectConvertSpecV1(
		{ ...convert, runtimeExtra: true } as unknown as typeof convert,
		convert,
	), false);
	assert.deepEqual(
		completionCandidatesV1(['task', 'convert', '--to', '']),
		['file', 'inline'],
	);
	assert.ok(completionCandidatesV1(['task', 'delete', '']).includes('--preview-only'));

	const deletePlan = destructivePlan('task.delete', {
		operation: 'delete',
		mode: 'delete-exact-task',
		cascade: false,
	}, 'confirm:delete:0123456789abcdef');
	assert.equal(isExpectedDirectSemanticConfirmationPlanV1(
		previewOutcome(deletePlan) as never,
		deletePlan,
	), true);
	const conversionPlan = destructivePlan('task.convert', {
		operation: 'convert',
		from: 'file',
		to: 'inline',
		target: { mode: 'exact-line', filePath: 'Daily.md', lineNumber: 3 },
	}, 'confirm:convert:0123456789abcdef');
	assert.equal(isExpectedDirectSemanticConfirmationPlanV1(
		previewOutcome(conversionPlan) as never,
		conversionPlan,
	), true);
	assert.equal(isExpectedDirectSemanticConfirmationPlanV1(
		previewOutcome({ ...deletePlan, warnings: [{ code: 'unexpected', message: 'Stop.' }] }) as never,
		{ ...deletePlan, warnings: [{ code: 'unexpected', message: 'Stop.' }] },
	), false);
	assert.equal(isExpectedDirectSemanticConfirmationPlanV1(
		previewOutcome({
			...deletePlan,
			requiredAcknowledgements: [...deletePlan.requiredAcknowledgements, 'unexpected'],
		}) as never,
		{
			...deletePlan,
			requiredAcknowledgements: [...deletePlan.requiredAcknowledgements, 'unexpected'],
		},
	), false);

	let processCalls = 0;
	const processMustNotRun = async () => {
		processCalls += 1;
		throw new Error('MUST_NOT_RUN');
	};
	const convertConflict = await runPublicCommandLineV1([
		'task', 'convert',
		'--input', '-',
		'--id', 'abc1234',
		'--to', 'inline',
		'--target-file', 'Daily.md',
		'--line', '4',
		'--json',
	], {
		configRoot: '/tmp/operon-direct-source-transition-conflict',
		input: Buffer.from('{}'),
		runProcess: processMustNotRun,
	});
	assert.equal(convertConflict.exitCode, 2);
	assert.match(convertConflict.human, /Do not combine direct human arguments with --input/u);
	const deleteConflict = await runPublicCommandLineV1([
		'task', 'delete',
		'--input', '-',
		'--id', 'abc1234',
		'--json',
	], {
		configRoot: '/tmp/operon-direct-source-transition-conflict',
		input: Buffer.from('{}'),
		runProcess: processMustNotRun,
	});
	assert.equal(deleteConflict.exitCode, 2);
	assert.match(deleteConflict.human, /Do not combine direct human arguments with --input/u);
	const deleteTargetFlag = await runPublicCommandLineV1([
		'task', 'delete',
		'--id', 'abc1234',
		'--target-file', 'Daily.md',
		'--json',
	], {
		configRoot: '/tmp/operon-direct-source-transition-conflict',
		runProcess: processMustNotRun,
	});
	assert.equal(deleteTargetFlag.exitCode, 2);
	assert.equal(processCalls, 0);
}

function placementContext(truncated: boolean): ContextPackV1 {
	return {
		ok: true,
		warnings: [],
		truncations: [],
		execution: {
			source: 'live-runtime',
			coherence: 'verified',
			settled: true,
			observedAt: '2026-07-27T10:00:00.000Z',
		},
		placement: {
			mode: 'lines',
			filePath: 'Notes/Target.md',
			sourceRevision: { algorithm: 'sha256', contentDigest: 'b'.repeat(64) },
			actualCount: 1,
			returnedCount: 1,
			truncated,
			lines: [{
				locator: {
					representation: 'inline',
					filePath: 'Notes/Target.md',
					lineNumber: 3,
				},
				contextLabel: 'Blank line',
			}],
		},
	} as unknown as ContextPackV1;
}

function destructivePlan(
	mutationKind: 'task.delete' | 'task.convert',
	spec: Record<string, unknown>,
	acknowledgement: string,
): SealedMutationPlanV1 {
	return {
		mutationKind,
		spec,
		riskLevel: 'destructive',
		requiresConfirmation: true,
		requiredAcknowledgements: [acknowledgement],
		warnings: [],
		targets: [{
			operonId: 'abc1234',
			locator: { representation: 'file', filePath: 'Tasks/Source.md' },
		}],
	} as unknown as SealedMutationPlanV1;
}

function previewOutcome(plan: SealedMutationPlanV1): unknown {
	return {
		envelope: {
			kind: 'cli-result',
			warnings: [],
			result: {
				kind: 'mutation-preview-result',
				ok: true,
				warnings: [],
				plan,
			},
		},
	};
}
