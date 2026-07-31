import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, renameSync } from 'node:fs';
import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	unlink,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type {
	CatalogPoliciesV1,
	CliInvocationV1,
	CliResultEnvelopeV1,
	ContextPackV1,
	ContextRevisionV1,
	FieldDescriptorV1,
	MutationApplyRequestV1,
	MutationPreviewRequestV1,
	MutationResultV1,
	MutationSpecV1,
	OperonCatalogV1,
	SealedMutationPlanV1,
	TaskContextV1,
	TaskFinderResultV1,
	TaskGetResultV1,
	TaskQueryResultV1,
} from '../../../src/agent-runtime/contracts/v1';
import {
	canonicalJsonV1,
	computeReceiptTargetDigestV1,
	computeSealedMutationPlanHashV1,
	sha256HexV1,
	toJsonValueV1,
} from '../../../src/agent-runtime/contracts/v1';
import type {
	ProcessResultV1,
	WindowsBrokerClientPortV1,
} from '../../../packages/operon-cli/src/client';
import {
	type PublicCommandPortsV1,
	runPublicCommandLineV1 as runProductionPublicCommandLineV1,
} from '../../../packages/operon-cli/src/command-line';
import { readMutationPlanV1 } from '../../../packages/operon-cli/src/plan-store';
import { requestPathForTokenV1 } from '../../../packages/operon-cli/src/protocol';
import type { InteractiveTerminalPortV1 } from '../../../packages/operon-cli/src/terminal-port';

const GUIDED_COMMANDS = [
	['task', 'update'],
	['task', 'transition'],
	['reminder', 'add'],
	['reminder', 'replace'],
	['reminder', 'remove'],
	['timer', 'start'],
	['timer', 'stop'],
] as const;

const COMMAND_OPERATIONS = new Map<string, string>([
	['task update', 'update'],
	['task transition', 'transition'],
	['reminder add', 'add'],
	['reminder replace', 'replace'],
	['reminder remove', 'remove'],
	['timer start', 'start'],
	['timer stop', 'stop'],
]);

type HarnessWindowsBrokerFrameV1 = {
	invocation: CliInvocationV1;
	state: 'staged' | 'consumed';
};

const WINDOWS_BROKER_FRAMES = new Map<string, HarnessWindowsBrokerFrameV1>();

function runPublicCommandLineV1(
	argv: string[],
	ports: PublicCommandPortsV1 = {},
): ReturnType<typeof runProductionPublicCommandLineV1> {
	if (process.platform !== 'win32' || ports._windowsBrokerClient) {
		return runProductionPublicCommandLineV1(argv, ports);
	}
	return runProductionPublicCommandLineV1(argv, {
		...ports,
		_windowsBrokerClient: createHarnessWindowsBrokerV1(),
	});
}

function createHarnessWindowsBrokerV1(): WindowsBrokerClientPortV1 {
	const ownedTokens = new Set<string>();
	return {
		async stage(invocation) {
			const requestToken = randomUUID().replaceAll('-', '');
			ownedTokens.add(requestToken);
			WINDOWS_BROKER_FRAMES.set(requestToken, {
				invocation: structuredClone(invocation),
				state: 'staged',
			});
			return {
				requestToken,
				stagingReceipt: createHash('sha256').update(requestToken).digest('hex'),
			};
		},
		async status(requestToken) {
			return {
				state: ownedTokens.has(requestToken)
					? WINDOWS_BROKER_FRAMES.get(requestToken)?.state ?? 'unknown'
					: 'unknown',
			};
		},
		async cancel(requestToken) {
			const frame = WINDOWS_BROKER_FRAMES.get(requestToken);
			if (!ownedTokens.has(requestToken) || !frame) {
				return { cancelled: false, state: 'unknown' };
			}
			if (frame.state === 'consumed') {
				return { cancelled: false, state: 'consumed' };
			}
			WINDOWS_BROKER_FRAMES.delete(requestToken);
			return { cancelled: true, state: 'staged' };
		},
		close() {
			for (const requestToken of ownedTokens) {
				WINDOWS_BROKER_FRAMES.delete(requestToken);
			}
		},
	};
}

async function run(): Promise<void> {
	await testGuidedAdmissionMatrix();
	await testLegacyTypedDispatch();
	await testCommandPreviewDeclineAndApply();
	await testGuidedCreationPreviewOnly();
	await testCompactCreationFlows();
	await testCompactCreationTargetDrift();
	await testCompactUpdateFlows();
	await testDirectLifecycleAndReminderFlows();
	await testDirectTimerSessionFlows();
	await testDirectPinnedOrchestration();
	console.log('Operon CLI guided maintenance command tests passed.');
}

async function testCompactCreationTargetDrift(): Promise<void> {
	const root = await createHarnessRoot('compact-create-target-drift');
	try {
		const invocations: CliInvocationV1[] = [];
		const displaced = `${root.vault}-displaced`;
		const outcome = await runPublicCommandLineV1([
			'task',
			'create',
			'inline',
			'Drift-safe compact task',
			'--vault',
			root.vault,
			'--json',
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			runProcess: fixtureRunner(root.requests, invocations, invocation => {
				if (invocation.command !== 'context.build') {
					throw new Error(`Vault drift must stop before ${invocation.command}`);
				}
				const response = compactCreationResponse(invocation, true);
				renameSync(root.vault, displaced);
				mkdirSync(root.vault);
				return response;
			}),
		});
		assert.equal(outcome.exitCode, 4);
		assert.equal(outcome.envelope.kind, 'operon-cli-local-result');
		if (outcome.envelope.kind === 'operon-cli-local-result') {
			assert.equal(outcome.envelope.error?.code, 'vault-mismatch');
			assert.equal(outcome.envelope.error?.action, 'fix-environment');
		}
		assert.deepEqual(invocations.map(item => item.command), ['context.build'], outcome.human);
	} finally {
		await root.cleanup();
	}
}

async function testGuidedAdmissionMatrix(): Promise<void> {
	const root = await createHarnessRoot('admission');
	try {
		for (const command of GUIDED_COMMANDS) {
			let processCalls = 0;
			const nonTty = await runPublicCommandLineV1([
				...command,
				'--vault',
				root.vault,
			], {
				configRoot: root.config,
				requestRoot: root.requests,
				runProcess: async () => {
					processCalls += 1;
					throw new Error('NON_TTY_MUST_NOT_SPAWN');
				},
			});
			assert.equal(nonTty.exitCode, 2, `${command.join(' ')} non-TTY`);
			assert.match(nonTty.human, /interactive terminal/u);
			assert.equal(processCalls, 0);

			const jsonWithoutInput = await runPublicCommandLineV1([
				...command,
				'--vault',
				root.vault,
				'--json',
			], {
				configRoot: root.config,
				requestRoot: root.requests,
				runProcess: async () => {
					processCalls += 1;
					throw new Error('JSON_MISSING_INPUT_MUST_NOT_SPAWN');
				},
			});
			assert.equal(jsonWithoutInput.exitCode, 2, `${command.join(' ')} --json`);
			assert.match(JSON.stringify(jsonWithoutInput.envelope), /input-required/u);
			assert.equal(processCalls, 0);

			const invocations: CliInvocationV1[] = [];
			const interactive = scriptedPort([]);
			const unavailable = await runPublicCommandLineV1([
				...command,
				'--vault',
				root.vault,
			], {
				configRoot: root.config,
				requestRoot: root.requests,
				interactive: interactive.port,
				runProcess: fixtureRunner(root.requests, invocations, invocation => (
					successEnvelope(invocation, [])
				)),
			});
			assert.equal(unavailable.exitCode, 4, `${command.join(' ')} capability refusal`);
    assert.match(
      unavailable.human,
      /capabilities required by this guided operation are not available/u,
    );
			assert.deepEqual(invocations.map(item => item.command), ['capabilities']);
		}
	} finally {
		await root.cleanup();
	}
}

async function testLegacyTypedDispatch(): Promise<void> {
	const root = await createHarnessRoot('typed');
	try {
		for (const command of GUIDED_COMMANDS) {
			const commandName = command.join(' ');
			const operation = COMMAND_OPERATIONS.get(commandName);
			assert.ok(operation);
			const invocations: CliInvocationV1[] = [];
			const outcome = await runPublicCommandLineV1([
				...command,
				'--vault',
				root.vault,
				'--input',
				'-',
				'--json',
			], {
				configRoot: root.config,
				requestRoot: root.requests,
				input: Buffer.from(JSON.stringify(typedIntent(operation)), 'utf8'),
				runProcess: fixtureRunner(root.requests, invocations, () => ({
					exitCode: 1,
					signal: null,
					stdout: Buffer.alloc(0),
					stderr: Buffer.from('synthetic transport refusal'),
					totalMs: 1,
					timedOut: false,
					overflow: false,
				})),
			});
			assert.equal(outcome.exitCode, 3, `${commandName} typed transport refusal`);
			assert.equal(invocations.length, 1);
			assert.equal(invocations[0].command, 'mutation.preview');
			assert.equal(
				(invocations[0].request as MutationPreviewRequestV1).spec.operation,
				operation,
			);
		}
	} finally {
		await root.cleanup();
	}
}

async function testCommandPreviewDeclineAndApply(): Promise<void> {
	for (const apply of [false, true]) {
		const root = await createHarnessRoot(apply ? 'apply' : 'decline');
		try {
			const invocations: CliInvocationV1[] = [];
			const interactive = scriptedPort([
				'',
				'1',
				'1',
				apply ? 'Applied description' : 'Preview-only description',
				'',
				apply ? 'y' : '',
			]);
			const outcome = await runPublicCommandLineV1([
				'task',
				'update',
				'--vault',
				root.vault,
			], {
				configRoot: root.config,
				requestRoot: root.requests,
				interactive: interactive.port,
				runProcess: fixtureRunner(root.requests, invocations, invocation => (
					fixtureResponse(invocation, apply)
				)),
			});
			assert.equal(
				outcome.exitCode,
				0,
				`${outcome.human}\n${JSON.stringify(outcome.envelope)}`,
			);
			const commands = invocations.map(item => item.command);
				assert.deepEqual(commands, apply
					? ['capabilities', 'tasks.finder', 'task.get', 'task.get', 'catalog', 'mutation.preview', 'mutation.apply']
					: ['capabilities', 'tasks.finder', 'task.get', 'task.get', 'catalog', 'mutation.preview']);
			const query = invocations.find(item => item.command === 'tasks.finder');
			assert.deepEqual(query?.request && 'filters' in query.request ? query.request.filters : undefined, {
				checkbox: ['open'],
			});
				const taskGet = invocations.find(item => (
					item.command === 'task.get'
					&& item.request
					&& 'include' in item.request
				));
			assert.deepEqual(taskGet?.request && 'include' in taskGet.request ? taskGet.request.include : undefined, [
				'writable-fields',
			]);
			const preview = invocations.find(item => item.command === 'mutation.preview');
			assert.equal((preview?.request as MutationPreviewRequestV1).spec.operation, 'update');
			assert.match(interactive.output(), /Apply this unchanged plan\?/u);
			if (apply) {
				assert.match(outcome.human, /Status: applied/u);
				assert.match(outcome.human, /Postflight: verified/u);
			} else {
				assert.match(outcome.human, /Plan saved\. Apply it with:/u);
				assert.ok(!commands.includes('mutation.apply'));
			}
		} finally {
			await root.cleanup();
		}
	}
}

async function testGuidedCreationPreviewOnly(): Promise<void> {
	const root = await createHarnessRoot('creation-preview-only');
	try {
		const sourcePath = path.join(root.vault, 'Tasks.md');
		const sourceBefore = 'Existing source sentinel\n';
		await writeFile(sourcePath, sourceBefore);
		const invocations: CliInvocationV1[] = [];
		const interactive = scriptedPort(['', '', '', '', '', '', '']);
		const outcome = await runPublicCommandLineV1([
			'task',
			'create',
			'Preview-only task',
			'--preview-only',
			'--vault',
			root.vault,
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			interactive: interactive.port,
			runProcess: fixtureRunner(root.requests, invocations, invocation => {
				if (invocation.command === 'capabilities') {
					return successEnvelope(invocation, [
						'context.build',
						'tasks.create.preview',
						'tasks.create.apply',
					].map(id => ({ id, availability: 'available', stability: 'stable' })));
				}
				if (invocation.command === 'context.build') {
					return successEnvelope(invocation, creationContext(invocation.requestId));
				}
				if (invocation.command === 'mutation.preview') {
					return successEnvelope(
						invocation,
						creationPreviewResult(invocation.request as MutationPreviewRequestV1),
					);
				}
				throw new Error(`Preview-only flow must not invoke ${invocation.command}`);
			}),
		});
		assert.equal(outcome.exitCode, 0, outcome.human);
		assert.deepEqual(invocations.map(item => item.command), [
			'capabilities',
			'context.build',
			'mutation.preview',
		]);
		assert.match(outcome.human, /No task was created/u);
		assert.ok(outcome.envelope.kind === 'cli-result' && outcome.envelope.client?.planRef);
		const planRef = outcome.envelope.kind === 'cli-result'
			? outcome.envelope.client?.planRef
			: undefined;
		assert.ok(planRef);
		assert.equal(readMutationPlanV1(planRef, root.config).plan.mutationKind, 'task.create');
		assert.equal(await readFile(sourcePath, 'utf8'), sourceBefore);
	} finally {
		await root.cleanup();
	}
}

async function testCompactCreationFlows(): Promise<void> {
	const root = await createHarnessRoot('compact-create');
	try {
		const autoApplyInvocations: CliInvocationV1[] = [];
		const autoApply = await runPublicCommandLineV1([
			'task',
			'create',
			'inline',
			'Compact task',
			'status::Work.Open',
			'priority::Normal',
			'note::A :: B; scalar',
			'contexts::Customer Support; Operon',
			'parentTask::abc1234',
			'--vault',
			root.vault,
			'--json',
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			runProcess: fixtureRunner(root.requests, autoApplyInvocations, invocation => (
				compactCreationResponse(invocation, true)
			)),
		});
		assert.equal(autoApply.exitCode, 0, autoApply.human);
		assert.deepEqual(autoApplyInvocations.map(item => item.command), [
			'context.build',
			'mutation.preview',
			'mutation.apply',
		], autoApply.human);
		const autoPreview = autoApplyInvocations.find(item => item.command === 'mutation.preview');
		assert.ok(autoPreview?.request?.kind === 'mutation-preview');
		if (autoPreview?.request?.kind !== 'mutation-preview') throw new Error('COMPACT_PREVIEW_MISSING');
		assert.equal(autoPreview.request.spec.operation, 'create');
		if (autoPreview.request.spec.operation !== 'create') throw new Error('COMPACT_CREATE_SPEC_MISSING');
		assert.deepEqual(autoPreview.request.spec.items[0], {
			itemRef: autoPreview.request.spec.items[0].itemRef,
			description: 'Compact task',
			target: { representation: 'inline', mode: 'configured-default' },
			fields: [
				{ kind: 'text', field: 'note', value: 'A :: B; scalar' },
				{ kind: 'list', field: 'contexts', value: ['Customer Support', 'Operon'] },
			],
			statusId: 'status-open',
			priorityId: 'priority-normal',
			parent: { kind: 'existing', operonId: 'abc1234' },
		});
		assert.ok(autoApply.envelope.kind === 'cli-result' && autoApply.envelope.client?.planRef);

		const diagnosticInvocations: CliInvocationV1[] = [];
		const diagnosticAutoApply = await runPublicCommandLineV1([
			'task',
			'create',
			'inline',
			'Projected timestamp task',
			'--vault',
			root.vault,
			'--json',
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			runProcess: fixtureRunner(root.requests, diagnosticInvocations, invocation => {
				if (invocation.command === 'mutation.preview') {
					const warning = {
						code: 'apply-time-values-projected',
						message: 'Creation and modified timestamps are projected at preview and captured authoritatively at apply.',
					};
					const result = creationPreviewResult(
						invocation.request as MutationPreviewRequestV1,
					);
					result.warnings = [warning];
					result.plan.warnings = [warning];
					result.plan.planHash = computeSealedMutationPlanHashV1(result.plan);
					const envelope = successEnvelope(invocation, result);
					envelope.warnings = [warning];
					return envelope;
				}
				return compactCreationResponse(invocation, true);
			}),
		});
		assert.equal(diagnosticAutoApply.exitCode, 0, diagnosticAutoApply.human);
		assert.deepEqual(diagnosticInvocations.map(item => item.command), [
			'context.build',
			'mutation.preview',
			'mutation.apply',
		]);

		const recurringInvocations: CliInvocationV1[] = [];
		const recurringAutoApply = await runPublicCommandLineV1([
			'task',
			'create',
			'inline',
			'Recurring compact task',
			'repeat::mode=schedule|freq=day|interval=1',
			'--vault',
			root.vault,
			'--json',
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			runProcess: fixtureRunner(root.requests, recurringInvocations, invocation => {
				if (invocation.command === 'context.build') {
					const result = compactCreationContext(invocation.requestId);
					if (!result.policies) throw new Error('RECURRING_CREATION_POLICIES_MISSING');
					result.policies.creation.temporalCreateVersion = 1;
					result.policies.creation.temporalCreateKeys = [
						'reminderDatetimes',
						'reminderRules',
						'repeat',
						'datetimeRepeatEnd',
					];
					return successEnvelope(invocation, result);
				}
				if (invocation.command === 'mutation.preview') {
					const result = creationPreviewResult(
						invocation.request as MutationPreviewRequestV1,
					);
					result.plan.affectedResources.unshift({
						resourceKind: 'repeat-series',
						resourceKey: 'series-recurring',
						revision: 'f'.repeat(64),
					});
					result.plan.atomicGroups[0].resources.unshift({
						resourceKind: 'repeat-series',
						resourceKey: 'series-recurring',
					});
					if (!result.plan.createEffects?.[0]) {
						throw new Error('RECURRING_CREATE_EFFECT_MISSING');
					}
					result.plan.createEffects[0].repeatSeriesId = 'series-recurring';
					result.plan.predictedEffects.unshift({
						resourceKind: 'repeat-series',
						resourceKey: 'series-recurring',
						action: 'create',
						summary: 'Create one exact repeat series.',
					});
					result.plan.targets[0].targetDigest = sha256HexV1(canonicalJsonV1(
						toJsonValueV1(result.plan.createEffects[0]),
					));
					result.plan.receiptTargetDigest = computeReceiptTargetDigestV1(result.plan.targets);
					result.plan.planHash = computeSealedMutationPlanHashV1(result.plan);
					return successEnvelope(invocation, result);
				}
				return compactCreationResponse(invocation, true);
			}),
		});
		assert.equal(recurringAutoApply.exitCode, 0, recurringAutoApply.human);
		assert.deepEqual(recurringInvocations.map(item => item.command), [
			'context.build',
			'mutation.preview',
			'mutation.apply',
		]);

		const elevatedInvocations: CliInvocationV1[] = [];
		const elevatedPreview = await runPublicCommandLineV1([
			'task',
			'create',
			'inline',
			'Elevated compact task',
			'--vault',
			root.vault,
			'--json',
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			runProcess: fixtureRunner(root.requests, elevatedInvocations, invocation => {
				if (invocation.command === 'mutation.preview') {
					const result = creationPreviewResult(
						invocation.request as MutationPreviewRequestV1,
					);
					result.plan.riskLevel = 'elevated';
					result.plan.planHash = computeSealedMutationPlanHashV1(result.plan);
					return successEnvelope(invocation, result);
				}
				return compactCreationResponse(invocation, false);
			}),
		});
		assert.equal(elevatedPreview.exitCode, 0, elevatedPreview.human);
		assert.deepEqual(elevatedInvocations.map(item => item.command), [
			'context.build',
			'mutation.preview',
		]);
		assert.match(elevatedPreview.human, /requires explicit handling/u);

		const singleAlteredSpecInvocations: CliInvocationV1[] = [];
		const singleAlteredSpecPreview = await runPublicCommandLineV1([
			'task',
			'create',
			'inline',
			'Original compact task',
			'--vault',
			root.vault,
			'--json',
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			runProcess: fixtureRunner(root.requests, singleAlteredSpecInvocations, invocation => {
				if (invocation.command === 'mutation.preview') {
					const result = creationPreviewResult(
						invocation.request as MutationPreviewRequestV1,
					);
					if (result.plan.spec.operation !== 'create') {
						throw new Error('EXPECTED_CREATE_PLAN');
					}
					result.plan.spec.items[0].description = 'Runtime-altered compact task';
					result.plan.planHash = computeSealedMutationPlanHashV1(result.plan);
					return successEnvelope(invocation, result);
				}
				return compactCreationResponse(invocation, false);
			}),
		});
		assert.equal(singleAlteredSpecPreview.exitCode, 0, singleAlteredSpecPreview.human);
		assert.deepEqual(singleAlteredSpecInvocations.map(item => item.command), [
			'context.build',
			'mutation.preview',
		]);
		assert.match(singleAlteredSpecPreview.human, /requires explicit handling/u);

		const gatedCases: Array<{
			label: string;
			mutate: (plan: SealedMutationPlanV1) => void;
		}> = [
			{
				label: 'Destructive compact task',
				mutate: plan => {
					plan.riskLevel = 'destructive';
					plan.requiresConfirmation = true;
					plan.requiredAcknowledgements = ['confirm:cross-source-graph-partial-risk'];
					plan.expiresAt = new Date(
						new Date(plan.createdAt).getTime() + 60_000,
					).toISOString();
				},
			},
			{
				label: 'Confirmation compact task',
				mutate: plan => {
					plan.requiresConfirmation = true;
				},
			},
			{
				label: 'Acknowledgement compact task',
				mutate: plan => {
					plan.requiredAcknowledgements = ['confirm:cross-source-graph-partial-risk'];
				},
			},
			{
				label: 'Unexpected resource compact task',
				mutate: plan => {
					plan.affectedResources.unshift({
						resourceKind: 'pinned',
						resourceKey: 'current-user',
						revision: 'f'.repeat(64),
					});
					plan.atomicGroups[0].resources.unshift({
						resourceKind: 'pinned',
						resourceKey: 'current-user',
					});
				},
			},
			{
				label: 'Altered target digest compact task',
				mutate: plan => {
					plan.targets[0].targetDigest = 'f'.repeat(64);
					plan.receiptTargetDigest = computeReceiptTargetDigestV1(plan.targets);
				},
			},
			{
				label: 'Altered predicted action compact task',
				mutate: plan => {
					plan.predictedEffects[0].action = 'create';
				},
			},
		];
		for (const testCase of gatedCases) {
			const invocations: CliInvocationV1[] = [];
			const outcome = await runPublicCommandLineV1([
				'task',
				'create',
				'inline',
				testCase.label,
				'--vault',
				root.vault,
				'--json',
			], {
				configRoot: root.config,
				requestRoot: root.requests,
				runProcess: fixtureRunner(root.requests, invocations, invocation => {
					if (invocation.command === 'mutation.preview') {
						const result = creationPreviewResult(
							invocation.request as MutationPreviewRequestV1,
						);
						testCase.mutate(result.plan);
						result.plan.planHash = computeSealedMutationPlanHashV1(result.plan);
						return successEnvelope(invocation, result);
					}
					return compactCreationResponse(invocation, false);
				}),
			});
			assert.equal(outcome.exitCode, 0, outcome.human);
			assert.equal(
				invocations.some(item => item.command === 'context.build'),
				true,
				testCase.label,
			);
			assert.equal(
				invocations.some(item => item.command === 'mutation.preview'),
				true,
				testCase.label,
			);
			assert.equal(
				invocations.some(item => item.command === 'mutation.apply'),
				false,
				testCase.label,
			);
			assert.match(outcome.human, /requires explicit handling/u);
			assert.ok(outcome.envelope.kind === 'cli-result' && outcome.envelope.client?.planRef);
		}

		const previewInvocations: CliInvocationV1[] = [];
		const previewGolden = await compactGoldenCase('preview-only-json-is-preview');
		const previewOnly = await runPublicCommandLineV1([
			...previewGolden.argv,
			'--vault',
			root.vault,
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			runProcess: fixtureRunner(root.requests, previewInvocations, invocation => (
				compactCreationResponse(invocation, false)
			)),
		});
		assert.equal(previewOnly.exitCode, 0, previewOnly.human);
		assert.equal(previewGolden.expect.action, 'preview');
		assert.equal(previewOnly.json, previewGolden.expect.output === 'json');
		assert.deepEqual(previewInvocations.map(item => item.command), [
			'context.build',
			'mutation.preview',
		], 'preview-only command sequence');
		assert.equal(
			previewInvocations.some(item => item.command === 'mutation.apply'),
			previewGolden.expect.applies,
		);
		assert.ok(previewOnly.envelope.kind === 'cli-result' && previewOnly.envelope.client?.planRef);

		const stdinInvocations: CliInvocationV1[] = [];
		const stdinPreview = await runPublicCommandLineV1([
			'task',
			'create',
			'--input-format',
			'compact',
			'--input',
			'-',
			'--vault',
			root.vault,
			'--json',
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			input: Buffer.from('"Stdin compact" note::"Raw input" contexts::"One item; Two words"', 'utf8'),
			runProcess: fixtureRunner(root.requests, stdinInvocations, invocation => (
				compactCreationResponse(invocation, false)
			)),
		});
		assert.equal(stdinPreview.exitCode, 0, stdinPreview.human);
		assert.deepEqual(stdinInvocations.map(item => item.command), [
			'context.build',
			'mutation.preview',
		], 'stdin compact command sequence');
		assert.ok(stdinPreview.envelope.kind === 'cli-result' && stdinPreview.envelope.client?.planRef);

		const batchInvocations: CliInvocationV1[] = [];
		const batchPreview = await runPublicCommandLineV1([
			'task',
			'create',
			'--input-format',
			'compact-lines',
			'--input',
			'-',
			'--vault',
			root.vault,
			'--json',
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			input: Buffer.from(
				'"Batch one" note::"First"\r\ninline "Batch two" contexts::"Agent; CLI"\r\n',
				'utf8',
			),
			runProcess: fixtureRunner(root.requests, batchInvocations, invocation => (
				compactCreationResponse(invocation, false)
			)),
		});
		assert.equal(batchPreview.exitCode, 0, batchPreview.human);
		assert.deepEqual(batchInvocations
			.map(item => item.command)
			.filter(command => command !== 'capabilities'), [
			'context.build',
			'mutation.preview',
		], 'batch compact command sequence');
		const batchInvocation = batchInvocations.find(item => item.command === 'mutation.preview');
		const batchRequest = batchInvocation?.request as MutationPreviewRequestV1 | undefined;
		assert.ok(batchRequest?.spec.operation === 'create');
		if (batchRequest?.spec.operation !== 'create') {
			throw new Error('COMPACT_BATCH_PREVIEW_MISSING');
		}
		assert.deepEqual(
			batchRequest.spec.items.map(item => item.description),
			['Batch one', 'Batch two'],
		);
		assert.equal(
			new Set(batchRequest.spec.items.map(item => item.itemRef)).size,
			2,
		);
		assert.match(batchPreview.human, /one sealed source\/atomic group/u);
		assert.ok(
			batchPreview.envelope.kind === 'cli-result'
			&& batchPreview.envelope.client?.planRef,
		);
		if (
			batchPreview.envelope.kind !== 'cli-result'
			|| !batchPreview.envelope.client?.planRef
		) throw new Error('COMPACT_BATCH_PLAN_REF_MISSING');
		const batchPlan = readMutationPlanV1(
			batchPreview.envelope.client.planRef,
			root.config,
		).plan;
		assert.equal(batchPlan.createEffects?.length, 2);
		assert.equal(batchPlan.atomicGroups.length, 1);

		const alteredSpecInvocations: CliInvocationV1[] = [];
		const alteredSpecPreview = await runPublicCommandLineV1([
			'task',
			'create',
			'--input-format',
			'compact-lines',
			'--input',
			'-',
			'--vault',
			root.vault,
			'--json',
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			input: Buffer.from('"Original one"\n"Original two"', 'utf8'),
			runProcess: fixtureRunner(root.requests, alteredSpecInvocations, invocation => {
				if (invocation.command !== 'mutation.preview') {
					return compactCreationResponse(invocation, false);
				}
				const result = creationPreviewResult(
					invocation.request as MutationPreviewRequestV1,
				);
				if (result.plan.spec.operation !== 'create') {
					throw new Error('ALTERED_BATCH_SPEC_MISSING');
				}
				result.plan.spec.items[0] = {
					...result.plan.spec.items[0],
					description: 'Runtime-altered description',
				};
				result.plan.planHash = computeSealedMutationPlanHashV1(result.plan);
				return successEnvelope(invocation, result);
			}),
		});
		assert.equal(alteredSpecPreview.exitCode, 70);
		assert.match(alteredSpecPreview.human, /stored batch plan did not preserve/u);

		const multiSourceInvocations: CliInvocationV1[] = [];
		const multiSourcePreview = await runPublicCommandLineV1([
			'task',
			'create',
			'--input-format',
			'compact-lines',
			'--input',
			'-',
			'--vault',
			root.vault,
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			input: Buffer.from('"First source"\n"Second source"', 'utf8'),
			runProcess: fixtureRunner(root.requests, multiSourceInvocations, invocation => {
				if (invocation.command !== 'mutation.preview') {
					return compactCreationResponse(invocation, false);
				}
				const result = creationPreviewResult(
					invocation.request as MutationPreviewRequestV1,
				);
				const secondLocator = {
					representation: 'inline' as const,
					filePath: 'Other.md',
					lineNumber: 1,
				};
				const secondEffect = result.plan.createEffects?.[1];
				const secondTarget = result.plan.targets[1];
				if (!secondEffect || !secondTarget) throw new Error('SECOND_BATCH_ITEM_MISSING');
				result.plan.createEffects![1] = {
					...secondEffect,
					locator: secondLocator,
				};
				result.plan.targets[1] = {
					...secondTarget,
					locator: secondLocator,
					targetDigest: createHash('sha256')
						.update(JSON.stringify(secondLocator))
						.digest('hex'),
				};
				result.plan.affectedResources = [{
					resourceKind: 'task-source',
					resourceKey: 'Other.md',
					revision: 'f'.repeat(64),
				}, ...result.plan.affectedResources];
				result.plan.atomicGroups = [{
					groupId: 'task-source:Other.md',
					order: 0,
					resources: [{ resourceKind: 'task-source', resourceKey: 'Other.md' }],
				}, {
					...result.plan.atomicGroups[0],
					order: 1,
				}];
				result.plan.predictedEffects.push({
					resourceKind: 'task-source',
					resourceKey: 'Other.md',
					action: 'create',
					summary: 'Create one exact inline task.',
				});
				result.plan.receiptTargetDigest = computeReceiptTargetDigestV1(result.plan.targets);
				result.plan.planHash = computeSealedMutationPlanHashV1(result.plan);
				return successEnvelope(invocation, result);
			}),
		});
		assert.equal(multiSourcePreview.exitCode, 0, multiSourcePreview.human);
		assert.deepEqual(multiSourceInvocations
			.map(item => item.command)
			.filter(command => command !== 'capabilities'), [
			'context.build',
			'mutation.preview',
		]);
		assert.match(multiSourcePreview.human, /Automatic apply is disabled/u);

		const missingAdmissionInvocations: CliInvocationV1[] = [];
		const missingAdmission = await runPublicCommandLineV1([
			'task',
			'create',
			'--input-format',
			'compact-lines',
			'--input',
			'-',
			'--vault',
			root.vault,
			'--json',
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			input: Buffer.from('"Admission required"', 'utf8'),
			runProcess: fixtureRunner(root.requests, missingAdmissionInvocations, invocation => {
				if (invocation.command === 'capabilities') {
					return compactCreationResponse(invocation, false);
				}
				if (invocation.command !== 'context.build') {
					throw new Error(`Missing admission must not invoke ${invocation.command}`);
				}
				const context = compactCreationContext(invocation.requestId);
				if (!context.ok || !context.policies) {
					throw new Error('COMPACT_CREATION_POLICIES_MISSING');
				}
				delete context.policies.creation.compactBatchVersion;
				delete context.policies.creation.compactBatchInputFormat;
				delete context.policies.creation.compactBatchMaxItems;
				return successEnvelope(invocation, context);
			}),
		});
		assert.equal(missingAdmission.exitCode, 4, missingAdmission.human);
		assert.deepEqual(missingAdmissionInvocations
			.map(item => item.command)
			.filter(command => command !== 'capabilities'), [
			'context.build',
		]);

		let invalidBatchCalls = 0;
		const invalidBatch = await runPublicCommandLineV1([
			'task',
			'create',
			'--input-format',
			'compact-lines',
			'--input',
			'-',
			'--json',
		], {
			configRoot: root.config,
			input: Buffer.from('"First"\n\n"Second"', 'utf8'),
			runProcess: async () => {
				invalidBatchCalls += 1;
				throw new Error('INVALID_COMPACT_BATCH_MUST_NOT_SPAWN');
			},
		});
		assert.equal(invalidBatch.exitCode, 2);
		assert.equal(invalidBatchCalls, 0);

		let invalidUtf8BatchCalls = 0;
		const invalidUtf8Batch = await runPublicCommandLineV1([
			'task',
			'create',
			'--input-format',
			'compact-lines',
			'--input',
			'-',
			'--json',
		], {
			configRoot: root.config,
			input: Buffer.from([0xc3, 0x28]),
			runProcess: async () => {
				invalidUtf8BatchCalls += 1;
				throw new Error('INVALID_UTF8_COMPACT_BATCH_MUST_NOT_SPAWN');
			},
		});
		assert.equal(invalidUtf8Batch.exitCode, 2);
		assert.equal(invalidUtf8BatchCalls, 0);
		assert.equal(
			invalidUtf8Batch.envelope.kind === 'operon-cli-local-result'
				? invalidUtf8Batch.envelope.error?.code
				: undefined,
			'invalid-request',
		);
		assert.equal(
			invalidUtf8Batch.envelope.kind === 'operon-cli-local-result'
				? invalidUtf8Batch.envelope.error?.details?.reasonCode
				: undefined,
			'compact-batch-utf8-invalid',
		);

		let localCalls = 0;
		const invalidRaw = await runPublicCommandLineV1([
			'task',
			'create',
			'--input-format',
			'compact',
			'--input',
			'-',
			'--json',
		], {
			configRoot: root.config,
			input: Buffer.from('"Invalid raw" note::unquoted', 'utf8'),
			runProcess: async () => {
				localCalls += 1;
				throw new Error('INVALID_COMPACT_MUST_NOT_SPAWN');
			},
		});
		assert.equal(invalidRaw.exitCode, 2);
		assert.equal(localCalls, 0);
		assert.equal(
			invalidRaw.envelope.kind === 'operon-cli-local-result'
				? invalidRaw.envelope.error?.code
				: undefined,
			'invalid-request',
		);
		assert.equal(
			invalidRaw.envelope.kind === 'operon-cli-local-result'
				? invalidRaw.envelope.error?.details?.reasonCode
				: undefined,
			'compact-value-quote-required',
		);

		const warningInvocations: CliInvocationV1[] = [];
		const warningPreview = await runPublicCommandLineV1([
			'task',
			'create',
			'Warning compact',
			'note::Review first',
			'--vault',
			root.vault,
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			runProcess: fixtureRunner(root.requests, warningInvocations, invocation => {
				if (invocation.command === 'mutation.preview') {
					return successEnvelope(
						invocation,
						creationPreviewResult(
							invocation.request as MutationPreviewRequestV1,
							true,
						),
					);
				}
				return compactCreationResponse(invocation, false);
			}),
		});
		assert.equal(warningPreview.exitCode, 0, warningPreview.human);
		assert.deepEqual(warningInvocations.map(item => item.command), [
			'context.build',
			'mutation.preview',
		]);
		assert.match(warningPreview.human, /requires explicit handling/u);

		const envelopeWarningInvocations: CliInvocationV1[] = [];
		const envelopeWarningPreview = await runPublicCommandLineV1([
			'task',
			'create',
			'Envelope warning compact',
			'note::Review envelope',
			'--vault',
			root.vault,
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			runProcess: fixtureRunner(root.requests, envelopeWarningInvocations, invocation => {
				if (invocation.command === 'mutation.preview') {
					const response = successEnvelope(
						invocation,
						creationPreviewResult(invocation.request as MutationPreviewRequestV1),
					);
					response.warnings = [{
						code: 'transport-review-required',
						message: 'Review the transport warning.',
					}];
					return response;
				}
				return compactCreationResponse(invocation, false);
			}),
		});
		assert.equal(envelopeWarningPreview.exitCode, 0, envelopeWarningPreview.human);
		assert.deepEqual(envelopeWarningInvocations.map(item => item.command), [
			'context.build',
			'mutation.preview',
		]);

		const uncertainInvocations: CliInvocationV1[] = [];
		const uncertain = await runPublicCommandLineV1([
			'task',
			'create',
			'Uncertain compact',
			'note::Recover same plan',
			'--vault',
			root.vault,
			'--json',
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			runProcess: fixtureRunner(root.requests, uncertainInvocations, invocation => {
				if (invocation.command === 'mutation.apply') {
					return {
						exitCode: 1,
						signal: null,
						stdout: Buffer.alloc(0),
						stderr: Buffer.from('synthetic compact apply interruption'),
						totalMs: 1,
						timedOut: false,
						overflow: false,
					};
				}
				return compactCreationResponse(invocation, false);
			}),
		});
		assert.notEqual(uncertain.exitCode, 0);
		assert.deepEqual(uncertainInvocations.map(item => item.command), [
			'context.build',
			'mutation.preview',
			'mutation.apply',
		]);
		assert.ok(uncertain.envelope.kind === 'cli-result' && uncertain.envelope.client?.planRef);
		if (uncertain.envelope.kind !== 'cli-result' || !uncertain.envelope.client?.planRef) {
			throw new Error('COMPACT_UNCERTAIN_PLAN_REF_MISSING');
		}
		const uncertainPlanRef = uncertain.envelope.client.planRef;
		const uncertainRecord = readMutationPlanV1(
			uncertainPlanRef,
			root.config,
			{ allowExpired: true },
		);
		assert.ok(uncertainRecord.applyRequest);
		const repeatedApply = await runPublicCommandLineV1([
			'plan',
			'apply',
			uncertainPlanRef,
			'--json',
		], { configRoot: root.config });
		assert.equal(repeatedApply.exitCode, 5);
		assert.equal(
			repeatedApply.envelope.kind === 'operon-cli-local-result'
				? repeatedApply.envelope.error?.code
				: undefined,
			'outcome-unknown',
		);
		assert.equal(
			repeatedApply.envelope.kind === 'operon-cli-local-result'
				? repeatedApply.envelope.error?.details?.reasonCode
				: undefined,
			'plan-recovery-required',
		);
		assert.deepEqual(repeatedApply.envelope.recovery, {
			required: true,
			planRef: uncertainPlanRef,
			action: 'recover-same-plan',
			mutationMayHaveApplied: true,
		});
		const recoveryInvocations: CliInvocationV1[] = [];
		const recovered = await runPublicCommandLineV1([
			'plan',
			'recover',
			uncertainPlanRef,
			'--json',
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			runProcess: fixtureRunner(root.requests, recoveryInvocations, invocation => (
				compactCreationResponse(invocation, true)
			)),
		});
		assert.equal(recovered.exitCode, 0, recovered.human);
		assert.deepEqual(recoveryInvocations.map(item => item.command), ['mutation.apply']);
		assert.equal(recoveryInvocations[0].request?.kind, 'mutation-apply');
		assert.equal(
			recoveryInvocations[0].request?.kind === 'mutation-apply'
				? recoveryInvocations[0].request.plan.planHash
				: undefined,
			uncertainRecord.plan.planHash,
		);
		const recoveredTombstone = readMutationPlanV1(
			uncertainPlanRef,
			root.config,
			{ allowExpired: true },
		);
		assert.equal(recoveredTombstone.terminalResult?.status, 'applied');
		assert.equal(recoveredTombstone.lastOutcome?.status, 'applied');
		assert.ok(recoveredTombstone.recoveryExpiresAt);

		const refusedApply = await runPublicCommandLineV1([
			'task',
			'create',
			'Runtime refused compact apply',
			'note::Normalize refusal after dispatch',
			'--vault',
			root.vault,
			'--json',
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			runProcess: fixtureRunner(root.requests, [], invocation => (
				invocation.command === 'mutation.apply'
					? capabilityFailureEnvelope(invocation)
					: compactCreationResponse(invocation, false)
			)),
		});
		assert.equal(refusedApply.exitCode, 5, refusedApply.human);
		assert.equal(refusedApply.envelope.kind, 'cli-result');
		if (refusedApply.envelope.kind === 'cli-result') {
			assert.equal(refusedApply.envelope.ok, false);
			if (!refusedApply.envelope.ok) {
				assert.equal(refusedApply.envelope.failure.error.code, 'outcome-unknown');
				assert.equal(refusedApply.envelope.failure.error.retryable, false);
				assert.equal(refusedApply.envelope.failure.error.action, 'recover-same-plan');
				assert.equal(
					refusedApply.envelope.failure.error.details?.originalCode,
					'capability-unavailable',
				);
			}
			assert.ok(refusedApply.envelope.client?.planRef);
			assert.deepEqual(refusedApply.envelope.recovery, {
				required: true,
				planRef: refusedApply.envelope.client?.planRef,
				action: 'recover-same-plan',
				mutationMayHaveApplied: true,
			});
		}
	} finally {
		await root.cleanup();
	}
}

async function testCompactUpdateFlows(): Promise<void> {
	const root = await createHarnessRoot('compact-update');
	try {
		const autoApplyInvocations: CliInvocationV1[] = [];
		const autoApply = await runPublicCommandLineV1([
			'task',
			'update',
			'--id',
			'abc1234',
			'priority::Normal',
			'note::Published :: today; keep scalar',
			'contexts::Operon; Release',
			'--clear',
			'dateDue',
			'--vault',
			root.vault,
			'--json',
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			runProcess: fixtureRunner(root.requests, autoApplyInvocations, invocation => (
				compactUpdateResponse(invocation, true)
			)),
		});
		assert.equal(autoApply.exitCode, 0, autoApply.human);
		assert.deepEqual(autoApplyInvocations.map(item => item.command), [
			'context.build',
			'mutation.preview',
			'mutation.apply',
		]);
		const updatePreview = autoApplyInvocations.find(item => item.command === 'mutation.preview');
		assert.ok(updatePreview?.request?.kind === 'mutation-preview');
		if (updatePreview?.request?.kind !== 'mutation-preview') {
			throw new Error('COMPACT_UPDATE_PREVIEW_MISSING');
		}
		assert.deepEqual(updatePreview.request.spec, {
			operation: 'update',
			changes: [
				{ field: 'priority', valueType: 'text', value: 'priority-normal' },
				{ field: 'note', valueType: 'text', value: 'Published :: today; keep scalar' },
				{ field: 'contexts', valueType: 'list', value: ['Operon', 'Release'] },
				{ operation: 'clear', field: 'dateDue', valueType: 'date' },
			],
		});

		const relationshipInvocations: CliInvocationV1[] = [];
		const relationshipUpdate = await runPublicCommandLineV1([
			'task',
			'update',
			'--id',
			'abc1234',
			'parentTask::par1234',
			'blocking::blk1234; blk5678',
			'--clear',
			'blockedBy',
			'--vault',
			root.vault,
			'--json',
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			runProcess: fixtureRunner(root.requests, relationshipInvocations, invocation => (
				compactRelationshipResponse(invocation, true)
			)),
		});
		assert.equal(relationshipUpdate.exitCode, 0, relationshipUpdate.human);
		assert.deepEqual(relationshipInvocations.map(item => item.command), [
			'task.get',
			'mutation.preview',
			'mutation.apply',
		]);
		const relationshipPreview = relationshipInvocations.find(
			item => item.command === 'mutation.preview',
		);
		assert.ok(relationshipPreview?.request?.kind === 'mutation-preview');
		if (relationshipPreview?.request?.kind !== 'mutation-preview') {
			throw new Error('COMPACT_RELATIONSHIP_PREVIEW_MISSING');
		}
		assert.equal(relationshipPreview.request.mutationKind, 'task.relationship');
		assert.equal(relationshipPreview.request.capability, 'tasks.relationship.preview');
		assert.deepEqual(relationshipPreview.request.spec, {
			operation: 'replace-relationships',
			changes: [
				{ field: 'parentTask', targetOperonIds: ['par1234'] },
				{ field: 'blocking', targetOperonIds: ['blk1234', 'blk5678'] },
				{ field: 'blockedBy', targetOperonIds: [] },
			],
		});

		const relationshipUncertainInvocations: CliInvocationV1[] = [];
		const relationshipUncertain = await runPublicCommandLineV1([
			'task',
			'update',
			'--id',
			'abc1234',
			'blocking::blk1234',
			'--vault',
			root.vault,
			'--json',
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			runProcess: fixtureRunner(root.requests, relationshipUncertainInvocations, invocation => {
				if (invocation.command === 'mutation.apply') {
					return {
						exitCode: 1,
						signal: null,
						stdout: Buffer.alloc(0),
						stderr: Buffer.from('synthetic relationship apply interruption'),
						totalMs: 1,
						timedOut: false,
						overflow: false,
					};
				}
				return compactRelationshipResponse(invocation, true);
			}),
		});
		assert.notEqual(relationshipUncertain.exitCode, 0);
		assert.ok(
			relationshipUncertain.envelope.kind === 'cli-result'
			&& relationshipUncertain.envelope.client?.planRef,
		);
		if (
			relationshipUncertain.envelope.kind !== 'cli-result'
			|| !relationshipUncertain.envelope.client?.planRef
		) {
			throw new Error('COMPACT_RELATIONSHIP_UNCERTAIN_PLAN_REF_MISSING');
		}
		const relationshipPlanRef = relationshipUncertain.envelope.client.planRef;
		const relationshipRecord = readMutationPlanV1(
			relationshipPlanRef,
			root.config,
			{ allowExpired: true },
		);
		assert.equal(relationshipRecord.plan.mutationKind, 'task.relationship');
		assert.ok(relationshipRecord.applyRequest);
		const repeatedRelationshipApply = await runPublicCommandLineV1([
			'plan',
			'apply',
			relationshipPlanRef,
			'--json',
		], { configRoot: root.config });
		assert.equal(repeatedRelationshipApply.exitCode, 5);
		assert.equal(repeatedRelationshipApply.envelope.kind, 'operon-cli-local-result');
		if (repeatedRelationshipApply.envelope.kind === 'operon-cli-local-result') {
			assert.equal(repeatedRelationshipApply.envelope.error?.code, 'outcome-unknown');
			assert.equal(repeatedRelationshipApply.envelope.error?.retryable, false);
			assert.equal(
				repeatedRelationshipApply.envelope.recovery?.planRef,
				relationshipPlanRef,
			);
		}
		const relationshipRecoveryInvocations: CliInvocationV1[] = [];
		const relationshipRecovered = await runPublicCommandLineV1([
			'plan',
			'recover',
			relationshipPlanRef,
			'--json',
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			runProcess: fixtureRunner(
				root.requests,
				relationshipRecoveryInvocations,
				invocation => compactRelationshipResponse(invocation, true),
			),
		});
		assert.equal(relationshipRecovered.exitCode, 0, relationshipRecovered.human);
		assert.deepEqual(
			relationshipRecoveryInvocations.map(item => item.command),
			['mutation.apply'],
		);
		assert.equal(
			relationshipRecoveryInvocations[0].request?.kind === 'mutation-apply'
				? relationshipRecoveryInvocations[0].request.plan.planHash
				: undefined,
			relationshipRecord.plan.planHash,
		);

		const relationshipDescriptionInvocations: CliInvocationV1[] = [];
		const relationshipDescription = await runPublicCommandLineV1([
			'task',
			'update',
			'--description',
			'Command harness task',
			'blockedBy::dep1234',
			'--preview-only',
			'--vault',
			root.vault,
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			runProcess: fixtureRunner(
				root.requests,
				relationshipDescriptionInvocations,
				invocation => compactRelationshipResponse(invocation, false, undefined, true),
			),
		});
		assert.equal(relationshipDescription.exitCode, 0, relationshipDescription.human);
		assert.deepEqual(relationshipDescriptionInvocations.map(item => item.command), [
			'tasks.query',
			'task.get',
			'mutation.preview',
		]);

		const relationshipNoChangeTask = compactRelationshipTask({
			parentOperonId: 'par1234',
			blockingOperonIds: ['blk1234', 'blk5678'],
		});
		const relationshipNoChangeInvocations: CliInvocationV1[] = [];
		const relationshipNoChange = await runPublicCommandLineV1([
			'task',
			'update',
			'--id',
			'abc1234',
			'parentTask::par1234',
			'blocking::blk1234; blk5678',
			'--vault',
			root.vault,
			'--json',
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			runProcess: fixtureRunner(
				root.requests,
				relationshipNoChangeInvocations,
				invocation => compactRelationshipResponse(
					invocation,
					true,
					relationshipNoChangeTask,
				),
			),
		});
		assert.equal(relationshipNoChange.exitCode, 0, relationshipNoChange.human);
		assert.match(relationshipNoChange.human, /No task relationships changed/u);
		assert.deepEqual(relationshipNoChangeInvocations.map(item => item.command), [
			'task.get',
		]);

		const malformedPlanInvocations: CliInvocationV1[] = [];
		const malformedPlan = await runPublicCommandLineV1([
			'task',
			'update',
			'--id',
			'abc1234',
			'blocking::blk1234',
			'--vault',
			root.vault,
			'--json',
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			runProcess: fixtureRunner(root.requests, malformedPlanInvocations, invocation => {
				const response = compactRelationshipResponse(invocation, true);
				if (invocation.command === 'mutation.preview' && 'result' in response) {
					const plan = (response.result as { plan: SealedMutationPlanV1 }).plan;
					if (plan.spec.operation !== 'replace-relationships') {
						throw new Error('COMPACT_RELATIONSHIP_PLAN_EXPECTED');
					}
					plan.spec.affectedOperonIds = ['abc1234'];
					plan.planHash = computeSealedMutationPlanHashV1(plan);
				}
				return response;
			}),
		});
		assert.equal(malformedPlan.exitCode, 0, malformedPlan.human);
		assert.equal(malformedPlanInvocations.some(item => item.command === 'mutation.apply'), false);
		assert.match(malformedPlan.human, /requires explicit handling/u);

		const noChangeInvocations: CliInvocationV1[] = [];
		const noChange = await runPublicCommandLineV1([
			'task',
			'update',
			'--id',
			'abc1234',
			'priority::Low',
			'--clear',
			'note',
			'--vault',
			root.vault,
			'--json',
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			runProcess: fixtureRunner(root.requests, noChangeInvocations, invocation => (
				compactUpdateResponse(invocation, false)
			)),
		});
		assert.equal(noChange.exitCode, 0, noChange.human);
		assert.match(noChange.human, /No task fields changed/u);
		assert.deepEqual(noChangeInvocations.map(item => item.command), [
			'context.build',
		]);

		const descriptionInvocations: CliInvocationV1[] = [];
		const descriptionPreview = await runPublicCommandLineV1([
			'task',
			'update',
			'--description',
			'Command harness task',
			'note::Review first',
			'--preview-only',
			'--vault',
			root.vault,
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			runProcess: fixtureRunner(root.requests, descriptionInvocations, invocation => (
				compactUpdateResponse(invocation, false)
			)),
		});
		assert.equal(
			descriptionPreview.exitCode,
			0,
			JSON.stringify(descriptionPreview.envelope),
		);
		assert.deepEqual(descriptionInvocations.map(item => item.command), [
			'tasks.query',
			'context.build',
			'mutation.preview',
		]);
		assert.match(descriptionPreview.human, /No task fields were updated/u);
		assert.ok(
			descriptionPreview.envelope.kind === 'cli-result'
			&& descriptionPreview.envelope.client?.planRef,
		);

		const catalogWarningInvocations: CliInvocationV1[] = [];
		const catalogWarningPreview = await runPublicCommandLineV1([
			'task',
			'update',
			'--id',
			'abc1234',
			'note::Catalog warning is unrelated',
			'--preview-only',
			'--vault',
			root.vault,
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			runProcess: fixtureRunner(root.requests, catalogWarningInvocations, invocation => {
				if (invocation.command === 'context.build') {
					const context = compactUpdateContext(
						invocation.requestId,
						compactUpdateTask('abc1234'),
					);
					context.warnings.push({
						code: 'taxonomy-default-unresolved',
						message: 'Synthetic unrelated Catalog warning.',
						path: 'taxonomy.defaultPipeline',
					});
					return successEnvelope(invocation, context);
				}
				return compactUpdateResponse(invocation, false);
			}),
		});
		assert.equal(catalogWarningPreview.exitCode, 0, catalogWarningPreview.human);
		assert.deepEqual(catalogWarningInvocations.map(item => item.command), [
			'context.build',
			'mutation.preview',
		]);

		for (const mode of ['renamed', 'warning'] as const) {
			const guardedInvocations: CliInvocationV1[] = [];
			const guarded = await runPublicCommandLineV1([
				'task',
				'update',
				'--description',
				'Command harness task',
				'note::Must not preview',
				'--preview-only',
				'--vault',
				root.vault,
				'--json',
			], {
				configRoot: root.config,
				requestRoot: root.requests,
				runProcess: fixtureRunner(root.requests, guardedInvocations, invocation => {
					if (invocation.command === 'context.build') {
						const context = compactUpdateContext(
							invocation.requestId,
							compactUpdateTask(
								'abc1234',
								mode === 'renamed' ? 'Renamed after query' : 'Command harness task',
							),
						);
						if (mode === 'warning') {
							context.warnings = [{
								code: 'hydration-incomplete',
								message: 'Synthetic hydration warning.',
							}];
						}
						return successEnvelope(invocation, context);
					}
					return compactUpdateResponse(invocation, false);
				}),
			});
			assert.notEqual(guarded.exitCode, 0);
			assert.equal(
				guardedInvocations.some(item => item.command === 'mutation.preview'),
				false,
			);
		}

		const previewCapabilityInvocations: CliInvocationV1[] = [];
		const previewWithoutApplyCapability = await runPublicCommandLineV1([
			'task',
			'update',
			'--id',
			'abc1234',
			'note::Preview capability only',
			'--preview-only',
			'--vault',
			root.vault,
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			runProcess: fixtureRunner(root.requests, previewCapabilityInvocations, invocation => {
				if (invocation.command === 'capabilities') {
					return successEnvelope(invocation, [
						'tasks.update.preview',
						'tasks.read',
						'catalog.read',
					].map(id => ({ id, availability: 'available', stability: 'stable' })));
				}
				return compactUpdateResponse(invocation, false);
			}),
		});
		assert.equal(previewWithoutApplyCapability.exitCode, 0, previewWithoutApplyCapability.human);
		assert.equal(
			previewCapabilityInvocations.some(item => item.command === 'mutation.apply'),
			false,
		);

		const warningInvocations: CliInvocationV1[] = [];
		const warningPreview = await runPublicCommandLineV1([
			'task',
			'update',
			'--id',
			'abc1234',
			'note::Review warning',
			'--vault',
			root.vault,
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			runProcess: fixtureRunner(root.requests, warningInvocations, invocation => {
				if (invocation.command === 'mutation.preview') {
					const response = successEnvelope(
						invocation,
						previewResult(invocation.request as MutationPreviewRequestV1),
					);
					response.warnings = [{
						code: 'review-required',
						message: 'Synthetic update warning.',
					}];
					return response;
				}
				return compactUpdateResponse(invocation, false);
			}),
		});
		assert.equal(warningPreview.exitCode, 0, warningPreview.human);
		assert.equal(warningInvocations.some(item => item.command === 'mutation.apply'), false);
		assert.match(warningPreview.human, /requires explicit handling/u);

		const misplacedDiagnosticInvocations: CliInvocationV1[] = [];
		const misplacedDiagnostic = await runPublicCommandLineV1([
			'task',
			'update',
			'--id',
			'abc1234',
			'note::Misplaced creation diagnostic',
			'--vault',
			root.vault,
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			runProcess: fixtureRunner(
				root.requests,
				misplacedDiagnosticInvocations,
				invocation => {
					if (invocation.command === 'mutation.preview') {
						const response = successEnvelope(
							invocation,
							previewResult(invocation.request as MutationPreviewRequestV1),
						);
						response.warnings = [{
							code: 'apply-time-values-projected',
							message: 'This creation-only diagnostic is invalid on update.',
						}];
						return response;
					}
					return compactUpdateResponse(invocation, false);
				},
			),
		});
		assert.equal(misplacedDiagnostic.exitCode, 0, misplacedDiagnostic.human);
		assert.equal(
			misplacedDiagnosticInvocations.some(item => item.command === 'mutation.apply'),
			false,
		);
		assert.match(misplacedDiagnostic.human, /requires explicit handling/u);

		const ambiguous = await runPublicCommandLineV1([
			'task',
			'update',
			'--description',
			'Command harness task',
			'note::Ambiguous',
			'--vault',
			root.vault,
			'--json',
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			runProcess: fixtureRunner(root.requests, [], invocation => (
				compactUpdateResponse(invocation, false, 2)
			)),
		});
		assert.equal(ambiguous.exitCode, 4);
		assert.match(JSON.stringify(ambiguous.envelope), /abc1234, def5678/u);

		const uncertainInvocations: CliInvocationV1[] = [];
		const uncertain = await runPublicCommandLineV1([
			'task',
			'update',
			'--id',
			'abc1234',
			'note::Recover same update plan',
			'--vault',
			root.vault,
			'--json',
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			runProcess: fixtureRunner(root.requests, uncertainInvocations, invocation => {
				if (invocation.command === 'mutation.apply') {
					return {
						exitCode: 1,
						signal: null,
						stdout: Buffer.alloc(0),
						stderr: Buffer.from('synthetic update apply interruption'),
						totalMs: 1,
						timedOut: false,
						overflow: false,
					};
				}
				return compactUpdateResponse(invocation, false);
			}),
		});
		assert.notEqual(uncertain.exitCode, 0);
		assert.ok(uncertain.envelope.kind === 'cli-result' && uncertain.envelope.client?.planRef);
		if (uncertain.envelope.kind !== 'cli-result' || !uncertain.envelope.client?.planRef) {
			throw new Error('COMPACT_UPDATE_UNCERTAIN_PLAN_REF_MISSING');
		}
		const uncertainPlanRef = uncertain.envelope.client.planRef;
		const uncertainRecord = readMutationPlanV1(
			uncertainPlanRef,
			root.config,
			{ allowExpired: true },
		);
		assert.ok(uncertainRecord.applyRequest);
		const repeatedApply = await runPublicCommandLineV1([
			'plan',
			'apply',
			uncertainPlanRef,
			'--json',
		], { configRoot: root.config });
		assert.equal(repeatedApply.exitCode, 5);
		const recoveryInvocations: CliInvocationV1[] = [];
		const recovered = await runPublicCommandLineV1([
			'plan',
			'recover',
			uncertainPlanRef,
			'--json',
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			runProcess: fixtureRunner(root.requests, recoveryInvocations, invocation => (
				compactUpdateResponse(invocation, true)
			)),
		});
		assert.equal(recovered.exitCode, 0, recovered.human);
		assert.deepEqual(recoveryInvocations.map(item => item.command), ['mutation.apply']);
		assert.equal(
			recoveryInvocations[0].request?.kind === 'mutation-apply'
				? recoveryInvocations[0].request.plan.planHash
				: undefined,
			uncertainRecord.plan.planHash,
		);

		for (const args of [
			['task', 'update', '--id', 'abc1234', '--description', 'Command harness task', 'note::X'],
			['task', 'update', '--description', '   ', 'note::X'],
			['task', 'update', '--id', 'abc1234'],
			['task', 'update', '--id', 'abc1234', 'note::X', '--clear', 'note'],
			['task', 'update', '--id', 'abc1234', 'note::X', 'blocking::blk1234'],
			['task', 'update', '--id', 'abc1234', '--input', '-'],
		]) {
			let processCalls = 0;
			const conflict = await runPublicCommandLineV1([...args, '--json'], {
				configRoot: root.config,
				input: Buffer.from('{}', 'utf8'),
				runProcess: async () => {
					processCalls += 1;
					throw new Error('INVALID_COMPACT_UPDATE_MUST_NOT_SPAWN');
				},
			});
			assert.equal(conflict.exitCode, 2, args.join(' '));
			assert.equal(processCalls, 0, args.join(' '));
		}

		for (const testCase of [
			{
				args: [
					'task', 'update', '--id', 'abc1234',
					'repeat::mode=schedule|freq=day|interval=1',
					'note::mixed',
				],
				code: 'recurrence-general-update-conflict',
				reason: /Do not mix recurrence-owned fields/iu,
			},
			{
				args: [
					'task', 'update', '--id', 'abc1234',
					'--scope', 'future-only',
					'dateScheduled::2026-08-01',
				],
				code: 'recurrence-scope-invalid',
				reason: /this-task or this-and-following/iu,
			},
		]) {
			const outcome = await runPublicCommandLineV1([...testCase.args, '--json'], {
				configRoot: root.config,
				runProcess: async () => {
					throw new Error('RECURRENCE_USAGE_ERROR_MUST_NOT_SPAWN');
				},
			});
			assert.equal(outcome.exitCode, 2, testCase.args.join(' '));
			assert.equal(outcome.envelope.kind, 'operon-cli-local-result');
			if (outcome.envelope.kind === 'operon-cli-local-result') {
				assert.equal(outcome.envelope.error?.code, 'invalid-request');
				assert.equal(
					outcome.envelope.error?.details?.reasonCode,
					testCase.code,
				);
				assert.match(outcome.envelope.error?.reason ?? '', testCase.reason);
			}
		}

		const unavailable = await runPublicCommandLineV1([
			'task', 'update', '--id', 'abc1234',
			'repeat::mode=schedule|freq=day|interval=1',
			'--vault', root.vault, '--json',
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			runProcess: fixtureRunner(root.requests, [], invocation => {
				if (invocation.command === 'context.build') {
					return capabilityFailureEnvelope(invocation);
				}
				throw new Error('RECURRENCE_CAPABILITY_REFUSAL_MUST_STOP');
			}),
		});
		assert.equal(unavailable.exitCode, 4, unavailable.human);
		assert.equal(unavailable.envelope.kind, 'operon-cli-local-result');
		if (unavailable.envelope.kind === 'operon-cli-local-result') {
			assert.equal(unavailable.envelope.error?.code, 'capability-unavailable');
			assert.equal(
				unavailable.envelope.error?.details?.reasonCode,
				'recurrence-capability-unavailable',
			);
			assert.match(unavailable.envelope.error?.reason ?? '', /does not advertise scoped recurrence/iu);
		}

		const incomplete = await runPublicCommandLineV1([
			'task', 'update', '--id', 'abc1234',
			'repeat::mode=schedule|freq=day|interval=1',
			'--vault', root.vault, '--json',
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			runProcess: fixtureRunner(root.requests, [], invocation => {
				if (invocation.command === 'context.build') {
					const result = compactUpdateContext(
						invocation.requestId,
						compactUpdateTask('abc1234'),
					);
					result.warnings.push({
						code: 'hydration-incomplete',
						message: 'Synthetic recurrence hydration warning.',
					});
					return successEnvelope(invocation, result);
				}
				throw new Error('RECURRENCE_TARGET_REFUSAL_MUST_STOP');
			}),
		});
		assert.equal(incomplete.exitCode, 4, incomplete.human);
		assert.equal(incomplete.envelope.kind, 'operon-cli-local-result');
		if (incomplete.envelope.kind === 'operon-cli-local-result') {
			assert.equal(incomplete.envelope.error?.code, 'capability-unavailable');
			assert.equal(
				incomplete.envelope.error?.details?.reasonCode,
				'recurrence-target-incomplete',
			);
			assert.match(incomplete.envelope.error?.reason ?? '', /could not be live-verified completely/iu);
		}
	} finally {
		await root.cleanup();
	}
}

async function testDirectLifecycleAndReminderFlows(): Promise<void> {
	const root = await createHarnessRoot('direct-lifecycle-reminder');
	try {
		const lifecycleInvocations: CliInvocationV1[] = [];
		const completed = await runPublicCommandLineV1([
			'task',
			'complete',
			'--id',
			'abc1234',
			'--vault',
			root.vault,
			'--json',
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			runProcess: fixtureRunner(root.requests, lifecycleInvocations, invocation => (
				directMutationResponse(invocation, true)
			)),
		});
		assert.equal(completed.exitCode, 0, completed.human);
		assert.deepEqual(lifecycleInvocations.map(item => item.command), [
			'capabilities',
			'task.get',
			'catalog',
			'mutation.preview',
			'mutation.apply',
		]);
		const lifecyclePreview = lifecycleInvocations.find(item => item.command === 'mutation.preview');
		assert.ok(lifecyclePreview?.request?.kind === 'mutation-preview');
		assert.deepEqual(
			lifecyclePreview?.request?.kind === 'mutation-preview'
				? lifecyclePreview.request.spec
				: undefined,
			{
				operation: 'transition',
				targetStatusId: 'status-done',
				expectedStatusId: 'status-open',
			},
		);

		for (const [action, statusId, targetStatusId] of [
			['cancel', 'status-open', 'status-cancelled'],
			['reopen', 'status-done', 'status-open'],
		] as const) {
			const invocations: CliInvocationV1[] = [];
			const result = await runPublicCommandLineV1([
				'task',
				action,
				'--description',
				'Command harness task',
				'--vault',
				root.vault,
				'--json',
			], {
				configRoot: root.config,
				requestRoot: root.requests,
				runProcess: fixtureRunner(root.requests, invocations, invocation => (
					directMutationResponse(invocation, true, statusId)
				)),
			});
			assert.equal(result.exitCode, 0, `${action}: ${result.human}`);
			assert.deepEqual(invocations.map(item => item.command), [
				'capabilities',
				'tasks.query',
				'task.get',
				'catalog',
				'mutation.preview',
				'mutation.apply',
			]);
			const preview = invocations.find(item => item.command === 'mutation.preview');
			assert.ok(preview?.request?.kind === 'mutation-preview');
			assert.deepEqual(
				preview?.request?.kind === 'mutation-preview' ? preview.request.spec : undefined,
				{
					operation: 'transition',
					targetStatusId,
					expectedStatusId: statusId,
				},
			);
		}

		const noChangeInvocations: CliInvocationV1[] = [];
		const noChange = await runPublicCommandLineV1([
			'task',
			'complete',
			'--id',
			'abc1234',
			'--vault',
			root.vault,
			'--json',
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			runProcess: fixtureRunner(root.requests, noChangeInvocations, invocation => (
				directMutationResponse(invocation, false, 'status-done')
			)),
		});
		assert.equal(noChange.exitCode, 0, noChange.human);
		assert.deepEqual(noChangeInvocations.map(item => item.command), [
			'capabilities',
			'task.get',
			'catalog',
		]);
		assert.match(noChange.human, /already complete|no change/iu);

		const pinnedInvocations: CliInvocationV1[] = [];
		const pinned = await runPublicCommandLineV1([
			'task',
			'pin',
			'--id',
			'abc1234',
			'--vault',
			root.vault,
			'--json',
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			runProcess: fixtureRunner(root.requests, pinnedInvocations, invocation => (
				directMutationResponse(invocation, true)
			)),
		});
		assert.equal(pinned.exitCode, 0, pinned.human);
		assert.deepEqual(pinnedInvocations.map(item => item.command), [
			'capabilities',
			'task.get',
			'mutation.preview',
			'mutation.apply',
		]);
		const pinnedPreview = pinnedInvocations.find(item => item.command === 'mutation.preview');
		assert.ok(pinnedPreview?.request?.kind === 'mutation-preview');
		assert.deepEqual(
			pinnedPreview?.request?.kind === 'mutation-preview'
				? pinnedPreview.request.spec
				: undefined,
			{ operation: 'set-pinned', pinned: true },
		);

		const pinnedNoChangeInvocations: CliInvocationV1[] = [];
		const pinnedNoChange = await runPublicCommandLineV1([
			'task',
			'pin',
			'--id',
			'abc1234',
			'--vault',
			root.vault,
			'--json',
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			runProcess: fixtureRunner(root.requests, pinnedNoChangeInvocations, invocation => (
				directMutationResponse(invocation, false, 'status-open', false, true)
			)),
		});
		assert.equal(pinnedNoChange.exitCode, 0, pinnedNoChange.human);
		assert.deepEqual(pinnedNoChangeInvocations.map(item => item.command), [
			'capabilities',
			'task.get',
		]);
		assert.match(pinnedNoChange.human, /already pinned/iu);

		const reminderInvocations: CliInvocationV1[] = [];
		const reminderPreview = await runPublicCommandLineV1([
			'reminder',
			'replace',
			'--id',
			'abc1234',
			'--current',
			'dateDue.30m',
			'reminderRules::dateDue.1h',
			'--preview-only',
			'--vault',
			root.vault,
			'--json',
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			runProcess: fixtureRunner(root.requests, reminderInvocations, invocation => (
				directMutationResponse(invocation, false)
			)),
		});
		assert.equal(reminderPreview.exitCode, 0, reminderPreview.human);
		assert.deepEqual(reminderInvocations.map(item => item.command), [
			'capabilities',
			'task.get',
			'mutation.preview',
		]);
		const reminderMutation = reminderInvocations.find(item => item.command === 'mutation.preview');
		assert.ok(reminderMutation?.request?.kind === 'mutation-preview');
		assert.deepEqual(
			reminderMutation?.request?.kind === 'mutation-preview'
				? reminderMutation.request.spec
				: undefined,
			{
				operation: 'replace',
				collection: 'reminderRules',
				itemId: 'reminder-rule-1',
				expectedValue: ' dateDue.30m',
				value: 'dateDue.1h',
			},
		);

		for (const [operation, assignment, expectedSpec] of [
			[
				'add',
				'reminderRules::dateDue.1h',
				{ operation: 'add', collection: 'reminderRules', value: 'dateDue.1h' },
			],
			[
				'remove',
				'reminderRules::dateDue.30m',
				{
					operation: 'remove',
					collection: 'reminderRules',
					itemId: 'reminder-rule-1',
					expectedValue: ' dateDue.30m',
				},
			],
		] as const) {
			const invocations: CliInvocationV1[] = [];
			const result = await runPublicCommandLineV1([
				'reminder',
				operation,
				'--id',
				'abc1234',
				assignment,
				'--vault',
				root.vault,
				'--json',
			], {
				configRoot: root.config,
				requestRoot: root.requests,
				runProcess: fixtureRunner(root.requests, invocations, invocation => (
					directMutationResponse(invocation, true)
				)),
			});
			assert.equal(result.exitCode, 0, `${operation}: ${result.human}`);
			assert.deepEqual(invocations.map(item => item.command), [
				'capabilities',
				'task.get',
				'mutation.preview',
				'mutation.apply',
			]);
			const preview = invocations.find(item => item.command === 'mutation.preview');
			assert.ok(preview?.request?.kind === 'mutation-preview');
			assert.deepEqual(
				preview?.request?.kind === 'mutation-preview' ? preview.request.spec : undefined,
				expectedSpec,
			);
		}

		const warningInvocations: CliInvocationV1[] = [];
		const warning = await runPublicCommandLineV1([
			'task',
			'cancel',
			'--id',
			'abc1234',
			'--vault',
			root.vault,
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			runProcess: fixtureRunner(root.requests, warningInvocations, invocation => (
				directMutationResponse(invocation, false, 'status-open', true)
			)),
		});
		assert.equal(warning.exitCode, 0, warning.human);
		assert.equal(warningInvocations.some(item => item.command === 'mutation.apply'), false);
		assert.match(warning.human, /requires explicit handling/u);

		const uncertainInvocations: CliInvocationV1[] = [];
		const uncertain = await runPublicCommandLineV1([
			'reminder',
			'add',
			'--id',
			'abc1234',
			'reminderRules::dateDue.1h',
			'--vault',
			root.vault,
			'--json',
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			runProcess: fixtureRunner(root.requests, uncertainInvocations, invocation => {
				if (invocation.command === 'mutation.apply') {
					return {
						exitCode: 1,
						signal: null,
						stdout: Buffer.alloc(0),
						stderr: Buffer.from('synthetic direct reminder apply interruption'),
						totalMs: 1,
						timedOut: false,
						overflow: false,
					};
				}
				return directMutationResponse(invocation, false);
			}),
		});
		assert.notEqual(uncertain.exitCode, 0);
		assert.ok(uncertain.envelope.kind === 'cli-result' && uncertain.envelope.client?.planRef);
		if (uncertain.envelope.kind !== 'cli-result' || !uncertain.envelope.client?.planRef) {
			throw new Error('DIRECT_REMINDER_UNCERTAIN_PLAN_REF_MISSING');
		}
		const uncertainPlanRef = uncertain.envelope.client.planRef;
		const uncertainRecord = readMutationPlanV1(
			uncertainPlanRef,
			root.config,
			{ allowExpired: true },
		);
		const recoveryInvocations: CliInvocationV1[] = [];
		const recovered = await runPublicCommandLineV1([
			'plan',
			'recover',
			uncertainPlanRef,
			'--json',
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			runProcess: fixtureRunner(root.requests, recoveryInvocations, invocation => (
				directMutationResponse(invocation, true)
			)),
		});
		assert.equal(recovered.exitCode, 0, recovered.human);
		assert.deepEqual(recoveryInvocations.map(item => item.command), ['mutation.apply']);
		assert.equal(
			recoveryInvocations[0].request?.kind === 'mutation-apply'
				? recoveryInvocations[0].request.plan.planHash
				: undefined,
			uncertainRecord.plan.planHash,
		);

		for (const args of [
			['task', 'complete', '--id', 'abc1234', '--description', 'Command harness task'],
			['task', 'complete', '--id', 'abc1234', 'note::invalid'],
			['task', 'pin', '--id', 'abc1234', '--description', 'Command harness task'],
			['task', 'pin', '--id', 'abc1234', 'pinned::true'],
			['task', 'pin', '--id', 'abc1234', '--input', '-'],
			['reminder', 'add', '--id', 'abc1234'],
			['reminder', 'replace', '--id', 'abc1234', 'reminderRules::dateDue.1h'],
			['reminder', 'remove', '--id', 'abc1234', 'reminderRules::dateDue.30m', '--current', 'dateDue.30m'],
		]) {
			let processCalls = 0;
			const refusal = await runPublicCommandLineV1([...args, '--json'], {
				configRoot: root.config,
				runProcess: async () => {
					processCalls += 1;
					throw new Error('INVALID_DIRECT_MUTATION_MUST_NOT_SPAWN');
				},
			});
			assert.equal(refusal.exitCode, 2, args.join(' '));
			assert.equal(processCalls, 0, args.join(' '));
		}
	} finally {
		await root.cleanup();
	}
}

async function testDirectPinnedOrchestration(): Promise<void> {
	const root = await createHarnessRoot('direct-pinned');
	try {
		for (const testCase of [
			{ action: 'pin' as const, taskPinned: false },
			{ action: 'unpin' as const, taskPinned: true },
		]) {
			const invocations: CliInvocationV1[] = [];
			const outcome = await runPublicCommandLineV1([
				'task',
				testCase.action,
				'--id',
				'abc1234',
				'--vault',
				root.vault,
				'--json',
			], {
				configRoot: root.config,
				requestRoot: root.requests,
				runProcess: fixtureRunner(root.requests, invocations, invocation => (
					directPinnedResponse(invocation, {
						taskPinned: testCase.taskPinned,
						apply: 'success',
					})
				)),
			});
			assert.equal(outcome.exitCode, 0, outcome.human);
			assert.deepEqual(invocations.map(item => item.command), [
				'capabilities',
				'task.get',
				'mutation.preview',
				'mutation.apply',
			]);
		}

		for (const testCase of [
			{ action: 'pin' as const, taskPinned: true },
			{ action: 'unpin' as const, taskPinned: false },
		]) {
			const invocations: CliInvocationV1[] = [];
			const outcome = await runPublicCommandLineV1([
				'task',
				testCase.action,
				'--id',
				'abc1234',
				'--vault',
				root.vault,
			], {
				configRoot: root.config,
				requestRoot: root.requests,
				runProcess: fixtureRunner(root.requests, invocations, invocation => (
					directPinnedResponse(invocation, { taskPinned: testCase.taskPinned })
				)),
			});
			assert.equal(outcome.exitCode, 0, outcome.human);
			assert.deepEqual(invocations.map(item => item.command), [
				'capabilities',
				'task.get',
			]);
			assert.match(outcome.human, /already (?:un)?pinned/iu);
		}

		const descriptionInvocations: CliInvocationV1[] = [];
		const descriptionOutcome = await runPublicCommandLineV1([
			'task',
			'pin',
			'--description',
			'Command harness task',
			'--vault',
			root.vault,
			'--json',
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			runProcess: fixtureRunner(root.requests, descriptionInvocations, invocation => (
				directPinnedResponse(invocation, {
					taskPinned: false,
					descriptionMatches: 1,
					apply: 'success',
				})
			)),
		});
		assert.equal(descriptionOutcome.exitCode, 0, descriptionOutcome.human);
		assert.deepEqual(descriptionInvocations.map(item => item.command), [
			'capabilities',
			'tasks.query',
			'task.get',
			'mutation.preview',
			'mutation.apply',
		]);

		const ambiguousInvocations: CliInvocationV1[] = [];
		const ambiguous = await runPublicCommandLineV1([
			'task',
			'pin',
			'--description',
			'Command harness task',
			'--vault',
			root.vault,
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			runProcess: fixtureRunner(root.requests, ambiguousInvocations, invocation => (
				directPinnedResponse(invocation, {
					taskPinned: false,
					descriptionMatches: 2,
				})
			)),
		});
		assert.equal(ambiguous.exitCode, 4, ambiguous.human);
		assert.deepEqual(ambiguousInvocations.map(item => item.command), [
			'capabilities',
			'tasks.query',
		]);
		assert.match(ambiguous.human, /abc1234, def5678/u);

		const previewInvocations: CliInvocationV1[] = [];
		const preview = await runPublicCommandLineV1([
			'task',
			'unpin',
			'--id',
			'abc1234',
			'--preview-only',
			'--vault',
			root.vault,
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			runProcess: fixtureRunner(root.requests, previewInvocations, invocation => (
				directPinnedResponse(invocation, { taskPinned: true })
			)),
		});
		assert.equal(preview.exitCode, 0, preview.human);
		assert.deepEqual(previewInvocations.map(item => item.command), [
			'capabilities',
			'task.get',
			'mutation.preview',
		]);
		assert.match(preview.human, /was not unpinned/u);

		for (const gate of ['warning', 'acknowledgement', 'confirmation'] as const) {
			const invocations: CliInvocationV1[] = [];
			const outcome = await runPublicCommandLineV1([
				'task',
				'pin',
				'--id',
				'abc1234',
				'--vault',
				root.vault,
			], {
				configRoot: root.config,
				requestRoot: root.requests,
				runProcess: fixtureRunner(root.requests, invocations, invocation => (
					directPinnedResponse(invocation, {
						taskPinned: false,
						previewGate: gate,
					})
				)),
			});
			assert.equal(outcome.exitCode, 0, `${gate}: ${outcome.human}`);
			assert.equal(invocations.some(item => item.command === 'mutation.apply'), false);
			assert.match(outcome.human, /requires explicit handling/u);
		}

		for (const capabilities of [
			[] as string[],
			['tasks.pinned.preview', 'tasks.read'],
		]) {
			const invocations: CliInvocationV1[] = [];
			const blocked = await runPublicCommandLineV1([
				'task',
				'pin',
				'--id',
				'abc1234',
				'--vault',
				root.vault,
			], {
				configRoot: root.config,
				requestRoot: root.requests,
				runProcess: fixtureRunner(root.requests, invocations, invocation => (
					directPinnedResponse(invocation, {
						taskPinned: false,
						capabilities,
					})
				)),
			});
			assert.equal(blocked.exitCode, 4, blocked.human);
			assert.deepEqual(invocations.map(item => item.command), ['capabilities']);
			assert.match(blocked.human, /capabilit/iu);
		}

		const timeoutInvocations: CliInvocationV1[] = [];
		const timeout = await runPublicCommandLineV1([
			'task',
			'unpin',
			'--id',
			'abc1234',
			'--vault',
			root.vault,
			'--json',
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			runProcess: fixtureRunner(root.requests, timeoutInvocations, invocation => (
				directPinnedResponse(invocation, {
					taskPinned: true,
					apply: 'timeout',
				})
			)),
		});
		assert.notEqual(timeout.exitCode, 0);
		assert.ok(timeout.envelope.kind === 'cli-result' && timeout.envelope.client?.planRef);
		if (timeout.envelope.kind !== 'cli-result' || !timeout.envelope.client?.planRef) {
			throw new Error('DIRECT_PINNED_TIMEOUT_PLAN_REF_MISSING');
		}
		const planRef = timeout.envelope.client.planRef;
		const stored = readMutationPlanV1(planRef, root.config, { allowExpired: true });
		const recoveryInvocations: CliInvocationV1[] = [];
		const recovered = await runPublicCommandLineV1([
			'plan',
			'recover',
			planRef,
			'--json',
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			runProcess: fixtureRunner(root.requests, recoveryInvocations, invocation => (
				directPinnedResponse(invocation, {
					taskPinned: true,
					apply: 'success',
				})
			)),
		});
		assert.equal(recovered.exitCode, 0, recovered.human);
		assert.deepEqual(recoveryInvocations.map(item => item.command), ['mutation.apply']);
		assert.equal(
			recoveryInvocations[0].request?.kind === 'mutation-apply'
				? recoveryInvocations[0].request.plan.planHash
				: undefined,
			stored.plan.planHash,
		);
	} finally {
		await root.cleanup();
	}
}

async function testDirectTimerSessionFlows(): Promise<void> {
	const root = await createHarnessRoot('direct-timer-session');
	try {
		for (const testCase of [
			{
				action: 'add',
				args: ['--start', '2026-07-27T11:00', '--end', '2026-07-27T12:00'],
				operation: 'add-session',
			},
			{
				action: 'update',
				args: [
					'--session', '1',
					'--start', '2026-07-27T11:00',
					'--end', '2026-07-27T12:00',
				],
				operation: 'update-session',
			},
		] as const) {
			const invocations: CliInvocationV1[] = [];
			const outcome = await runPublicCommandLineV1([
				'timer',
				'session',
				testCase.action,
				'--id',
				'abc1234',
				...testCase.args,
				'--vault',
				root.vault,
				'--json',
			], {
				configRoot: root.config,
				requestRoot: root.requests,
				runProcess: fixtureRunner(root.requests, invocations, invocation => (
					directMutationResponse(invocation, true)
				)),
			});
			assert.equal(outcome.exitCode, 0, outcome.human);
			assert.deepEqual(invocations.map(item => item.command), [
				'capabilities',
				'task.get',
				'mutation.preview',
				'mutation.apply',
			]);
			const preview = invocations.find(item => item.command === 'mutation.preview');
			assert.equal(
				preview?.request?.kind === 'mutation-preview'
					? preview.request.spec.operation
					: undefined,
				testCase.operation,
			);
		}

		const previewInvocations: CliInvocationV1[] = [];
		const previewOnly = await runPublicCommandLineV1([
			'timer',
			'session',
			'update',
			'--id',
			'abc1234',
			'--session',
			'1',
			'--start',
			'2026-07-27T11:00',
			'--end',
			'2026-07-27T12:00',
			'--preview-only',
			'--vault',
			root.vault,
			'--json',
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			runProcess: fixtureRunner(root.requests, previewInvocations, invocation => (
				directMutationResponse(invocation, false)
			)),
		});
		assert.equal(previewOnly.exitCode, 0, previewOnly.human);
		assert.deepEqual(previewInvocations.map(item => item.command), [
			'capabilities',
			'task.get',
			'mutation.preview',
		]);

		const typedInvocations: CliInvocationV1[] = [];
		const typed = await runPublicCommandLineV1([
			'timer',
			'session',
			'add',
			'--input',
			'-',
			'--vault',
			root.vault,
			'--json',
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			input: Buffer.from(JSON.stringify({
				contractVersion: 1,
				kind: 'mutation-intent',
				target: {
					operonId: 'abc1234',
					locator: {
						representation: 'inline',
						filePath: 'Tasks.md',
						lineNumber: 2,
					},
				},
				spec: {
					operation: 'add-session',
					start: '2026-07-27T11:00:00',
					end: '2026-07-27T12:00:00',
				},
			}), 'utf8'),
			runProcess: fixtureRunner(root.requests, typedInvocations, invocation => (
				directMutationResponse(invocation, false)
			)),
		});
		assert.equal(typed.exitCode, 0, typed.human);
		assert.deepEqual(typedInvocations.map(item => item.command), ['mutation.preview']);
		assert.ok(typed.envelope.kind === 'cli-result' && typed.envelope.client?.planRef);

		for (const args of [
			[
				'timer', 'session', 'add', '--id', 'abc1234',
				'--start', 'invalid', '--end', '2026-07-27T12:00',
			],
			[
				'timer', 'session', 'update', '--id', 'abc1234',
				'--session', '0', '--start', '2026-07-27T11:00', '--end', '2026-07-27T12:00',
			],
			[
				'timer', 'session', 'remove', '--id', 'abc1234',
				'--session', '1', '--start', '2026-07-27T11:00',
			],
			[
				'timer', 'session', 'add', '--input', '-', '--id', 'abc1234',
				'--start', '2026-07-27T11:00', '--end', '2026-07-27T12:00',
			],
		]) {
			let processCalls = 0;
			const refusal = await runPublicCommandLineV1([...args, '--json'], {
				configRoot: root.config,
				input: Buffer.from('{}', 'utf8'),
				runProcess: async () => {
					processCalls += 1;
					throw new Error('INVALID_TIMER_SESSION_MUST_NOT_SPAWN');
				},
			});
			assert.equal(refusal.exitCode, 2, args.join(' '));
			assert.equal(processCalls, 0, args.join(' '));
		}

		const noChangeInvocations: CliInvocationV1[] = [];
		const noChange = await runPublicCommandLineV1([
			'timer',
			'session',
			'update',
			'--id',
			'abc1234',
			'--session',
			'1',
			'--start',
			'2026-07-27T09:00',
			'--end',
			'2026-07-27T10:00',
			'--vault',
			root.vault,
			'--json',
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			runProcess: fixtureRunner(root.requests, noChangeInvocations, invocation => (
				directMutationResponse(invocation, false)
			)),
		});
		assert.equal(noChange.exitCode, 0, noChange.human);
		assert.deepEqual(noChangeInvocations.map(item => item.command), [
			'capabilities',
			'task.get',
			'mutation.preview',
		]);
		assert.equal(
			noChange.envelope.kind === 'operon-cli-local-result'
				&& typeof noChange.envelope.result === 'object'
				&& noChange.envelope.result !== null
				&& 'status' in noChange.envelope.result
				? noChange.envelope.result.status
				: undefined,
			'no-change',
		);

		const removalInvocations: CliInvocationV1[] = [];
		const removal = await runPublicCommandLineV1([
			'timer',
			'session',
			'remove',
			'--id',
			'abc1234',
			'--session',
			'1',
			'--vault',
			root.vault,
			'--json',
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			runProcess: fixtureRunner(root.requests, removalInvocations, invocation => (
				directMutationResponse(invocation, false)
			)),
		});
		assert.equal(removal.exitCode, 0, removal.human);
		assert.deepEqual(removalInvocations.map(item => item.command), [
			'capabilities',
			'task.get',
			'mutation.preview',
		]);
		assert.ok(removal.envelope.kind === 'cli-result' && removal.envelope.client?.planRef);
		assert.equal(
			removal.envelope.kind === 'cli-result'
				&& 'plan' in (removal.envelope.result as Record<string, unknown>)
				? (removal.envelope.result as { plan: SealedMutationPlanV1 }).plan.riskLevel
				: undefined,
			'destructive',
		);

		const uncertainInvocations: CliInvocationV1[] = [];
		const uncertain = await runPublicCommandLineV1([
			'timer',
			'session',
			'add',
			'--id',
			'abc1234',
			'--start',
			'2026-07-27T11:00',
			'--end',
			'2026-07-27T12:00',
			'--vault',
			root.vault,
			'--json',
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			runProcess: fixtureRunner(root.requests, uncertainInvocations, invocation => {
				if (invocation.command === 'mutation.apply') {
					return {
						exitCode: 1,
						signal: null,
						stdout: Buffer.alloc(0),
						stderr: Buffer.from('synthetic timer session apply interruption'),
						totalMs: 1,
						timedOut: false,
						overflow: false,
					};
				}
				return directMutationResponse(invocation, false);
			}),
		});
		assert.notEqual(uncertain.exitCode, 0);
		assert.ok(uncertain.envelope.kind === 'cli-result' && uncertain.envelope.client?.planRef);
		if (uncertain.envelope.kind !== 'cli-result' || !uncertain.envelope.client?.planRef) {
			throw new Error('DIRECT_TIMER_SESSION_UNCERTAIN_PLAN_REF_MISSING');
		}
		const planRef = uncertain.envelope.client.planRef;
		const stored = readMutationPlanV1(planRef, root.config, { allowExpired: true });
		const recoveryInvocations: CliInvocationV1[] = [];
		const recovered = await runPublicCommandLineV1([
			'plan',
			'recover',
			planRef,
			'--json',
		], {
			configRoot: root.config,
			requestRoot: root.requests,
			runProcess: fixtureRunner(root.requests, recoveryInvocations, invocation => (
				directMutationResponse(invocation, true)
			)),
		});
		assert.equal(recovered.exitCode, 0, recovered.human);
		assert.deepEqual(recoveryInvocations.map(item => item.command), ['mutation.apply']);
		assert.equal(
			recoveryInvocations[0].request?.kind === 'mutation-apply'
				? recoveryInvocations[0].request.plan.planHash
				: undefined,
			stored.plan.planHash,
		);
	} finally {
		await root.cleanup();
	}
}

function directPinnedResponse(
	invocation: CliInvocationV1,
	options: {
		taskPinned: boolean;
		descriptionMatches?: number;
		capabilities?: string[];
		previewGate?: 'warning' | 'acknowledgement' | 'confirmation';
		apply?: 'success' | 'timeout';
	},
): CliResultEnvelopeV1 | ProcessResultV1 {
	if (invocation.command === 'capabilities') {
		const capabilities = options.capabilities ?? [
			'tasks.pinned.preview',
			'tasks.pinned.apply',
			'tasks.read',
			'tasks.query',
		];
		return successEnvelope(
			invocation,
			capabilities.map(id => ({ id, availability: 'available', stability: 'stable' })),
		);
	}
	if (invocation.command === 'tasks.query') {
		const matchCount = options.descriptionMatches ?? 1;
		const tasks = [
			...(matchCount >= 1 ? [directTask('status-open', options.taskPinned)] : []),
			...(matchCount >= 2
				? [{
					...directTask('status-open', options.taskPinned),
					identity: {
						...directTask('status-open', options.taskPinned).identity,
						operonId: 'def5678',
					},
				}]
				: []),
		];
		const result: TaskQueryResultV1 = {
			contractVersion: 1,
			requestId: invocation.requestId,
			kind: 'task-query-result',
			ok: true,
			freshness: freshness(),
			warnings: [],
			contextRevision: revision(),
			tasks,
			page: {
				actualCount: tasks.length,
				returnedCount: tasks.length,
				truncated: false,
				asOf: '2026-07-27T12:00:00.000Z',
			},
			provenance: [],
			truncations: [],
		};
		return successEnvelope(invocation, result);
	}
	if (invocation.command === 'task.get') {
		return successEnvelope(invocation, {
			...taskGetResult(invocation.requestId),
			task: directTask('status-open', options.taskPinned),
		});
	}
	if (invocation.command === 'mutation.preview') {
		const result = previewResult(invocation.request as MutationPreviewRequestV1);
		if (options.previewGate === 'acknowledgement') {
			result.plan.requiredAcknowledgements = ['review-pinned-state'];
		}
		if (options.previewGate === 'confirmation') {
			result.plan.requiresConfirmation = true;
		}
		result.plan.planHash = computeSealedMutationPlanHashV1(result.plan);
		const envelope = successEnvelope(invocation, result);
		if (options.previewGate === 'warning') {
			envelope.warnings = [{
				code: 'review-required',
				message: 'Synthetic pinned-state warning.',
			}];
		}
		return envelope;
	}
	if (invocation.command === 'mutation.apply' && options.apply === 'success') {
		return successEnvelope(
			invocation,
			appliedResult(
				invocation.request as MutationApplyRequestV1,
				invocation.expectedVaultSha256,
			),
		);
	}
	if (invocation.command === 'mutation.apply' && options.apply === 'timeout') {
		return {
			exitCode: 1,
			signal: null,
			stdout: Buffer.alloc(0),
			stderr: Buffer.from('synthetic pinned-state apply timeout'),
			totalMs: 30_000,
			timedOut: true,
			overflow: false,
		};
	}
	throw new Error(`Direct pinned flow must not invoke ${invocation.command}`);
}

function directMutationResponse(
	invocation: CliInvocationV1,
	includeApply: boolean,
	taskStatusId = 'status-open',
	warningPreview = false,
	taskPinned = false,
): CliResultEnvelopeV1 | ProcessResultV1 {
	if (invocation.command === 'capabilities') {
		return successEnvelope(invocation, [
			'tasks.transition.preview',
			'tasks.transition.apply',
			'tasks.reminder.preview',
			'tasks.reminder.apply',
				'tasks.pinned.preview',
				'tasks.pinned.apply',
				'timers.session.preview',
				'timers.session.apply',
				'tasks.read',
			'tasks.query',
			'catalog.read',
		].map(id => ({ id, availability: 'available', stability: 'stable' })));
	}
	if (invocation.command === 'tasks.query') {
		const queriedTask = directTask(taskStatusId, taskPinned);
		const result: TaskQueryResultV1 = {
			contractVersion: 1,
			requestId: invocation.requestId,
			kind: 'task-query-result',
			ok: true,
			freshness: freshness(),
			warnings: [],
			contextRevision: revision(),
			tasks: [queriedTask],
			page: {
				actualCount: 1,
				returnedCount: 1,
				truncated: false,
				asOf: '2026-07-25T12:00:00.000Z',
			},
			provenance: [],
			truncations: [],
		};
		return successEnvelope(invocation, result);
	}
	if (invocation.command === 'task.get') {
		return successEnvelope(invocation, {
			...taskGetResult(invocation.requestId),
			task: directTask(taskStatusId, taskPinned),
		});
	}
	if (invocation.command === 'catalog') {
		const catalog = catalogResult(invocation.requestId);
		if (!catalog.ok) throw new Error('DIRECT_CATALOG_FIXTURE_UNAVAILABLE');
		catalog.taxonomy.pipelines[0].statuses.push(
			{
				id: 'status-done',
				label: 'Done',
				order: 1,
				color: '#000000',
				isFinished: true,
				isCancelled: false,
				isScheduledTarget: false,
				isTrackingTarget: false,
				identityStatus: 'resolved',
			},
			{
				id: 'status-cancelled',
				label: 'Cancelled',
				order: 2,
				color: '#000000',
				isFinished: false,
				isCancelled: true,
				isScheduledTarget: false,
				isTrackingTarget: false,
				identityStatus: 'resolved',
			},
		);
		catalog.catalogRevision = sha256HexV1(canonicalJsonV1(toJsonValueV1({
			settingsFingerprint: catalog.settingsFingerprint,
			taxonomy: catalog.taxonomy,
			fields: catalog.fields,
			policies: catalog.policies,
		})));
		return successEnvelope(invocation, catalog);
	}
	if (invocation.command === 'mutation.preview') {
		const result = previewResult(invocation.request as MutationPreviewRequestV1);
		const response = successEnvelope(
			invocation,
			result,
		);
		if (warningPreview) {
			response.warnings = [{
				code: 'review-required',
				message: 'Synthetic direct mutation warning.',
			}];
		}
		return response;
	}
	if (invocation.command === 'mutation.apply' && includeApply) {
		return successEnvelope(
			invocation,
			appliedResult(
				invocation.request as MutationApplyRequestV1,
				invocation.expectedVaultSha256,
			),
		);
	}
	throw new Error(`Direct mutation flow must not invoke ${invocation.command}`);
}

function directTask(statusId: string, pinned = false): TaskContextV1 {
	return {
		...task(),
		pinned,
		workflow: {
			pipeline: { id: 'pipeline-work', label: 'Work' },
			status: { id: statusId, label: statusId },
		},
		reminderItems: [{
			collection: 'reminderRules',
			itemId: 'reminder-rule-1',
			expectedValue: ' dateDue.30m',
		}],
	};
}

function compactUpdateResponse(
	invocation: CliInvocationV1,
	includeApply: boolean,
	descriptionMatchCount = 1,
): CliResultEnvelopeV1 | ProcessResultV1 {
	if (invocation.command === 'capabilities') {
		return successEnvelope(invocation, [
			'tasks.update.preview',
			'tasks.update.apply',
			'tasks.read',
			'tasks.query',
			'catalog.read',
		].map(id => ({ id, availability: 'available', stability: 'stable' })));
	}
	if (invocation.command === 'tasks.query') {
		const tasks = [
			compactUpdateTask('abc1234'),
			...(descriptionMatchCount > 1 ? [compactUpdateTask('def5678')] : []),
		];
		const result: TaskQueryResultV1 = {
			contractVersion: 1,
			requestId: invocation.requestId,
			kind: 'task-query-result',
			ok: true,
			freshness: freshness(),
			warnings: [],
			contextRevision: revision(),
			tasks,
			page: {
				actualCount: tasks.length,
				returnedCount: tasks.length,
				truncated: false,
				asOf: '2026-07-25T12:00:00.000Z',
			},
			provenance: [],
			truncations: [],
		};
		return successEnvelope(invocation, result);
	}
	if (invocation.command === 'task.get') {
		return successEnvelope(invocation, {
			...taskGetResult(invocation.requestId),
			task: compactUpdateTask('abc1234'),
		});
	}
	if (invocation.command === 'context.build') {
		return successEnvelope(
			invocation,
			compactUpdateContext(invocation.requestId, compactUpdateTask('abc1234')),
		);
	}
	if (invocation.command === 'catalog') {
		return successEnvelope(invocation, compactUpdateCatalog(invocation.requestId));
	}
	if (invocation.command === 'mutation.preview') {
		return successEnvelope(
			invocation,
			previewResult(invocation.request as MutationPreviewRequestV1),
		);
	}
	if (invocation.command === 'mutation.apply' && includeApply) {
		return successEnvelope(
			invocation,
			appliedResult(
				invocation.request as MutationApplyRequestV1,
				invocation.expectedVaultSha256,
			),
		);
	}
	throw new Error(`Compact update flow must not invoke ${invocation.command}`);
}

function compactUpdateContext(
	requestId: string,
	taskContext: TaskContextV1,
): ContextPackV1 {
	const catalog = compactUpdateCatalog(requestId);
	if (!catalog.ok) throw new Error('Synthetic compact update catalog must be successful.');
	return {
		contractVersion: 1,
		requestId,
		kind: 'context-pack',
		ok: true,
		purpose: 'mutation-readiness',
		projection: 'mutation-preview',
		execution: freshness(),
		contextRevision: revision(),
		catalogRevision: catalog.catalogRevision,
		entities: [taskContext],
		relationships: { explicit: [], derived: [], inferred: [] },
		catalog: {
			taxonomy: catalog.taxonomy,
			fields: catalog.fields,
		},
		resourceRevisions: [{
			resourceKind: 'task-source',
			resourceKey: taskContext.locator.filePath,
			revision: 'c'.repeat(64),
		}],
		provenance: [],
		truncations: [],
		warnings: [],
	};
}

function compactRelationshipResponse(
	invocation: CliInvocationV1,
	includeApply: boolean,
	taskContext = compactRelationshipTask(),
	includeQueryCapability = false,
): CliResultEnvelopeV1 | ProcessResultV1 {
	if (invocation.command === 'capabilities') {
		return successEnvelope(invocation, [
			'tasks.relationship.preview',
			...(includeApply ? ['tasks.relationship.apply'] : []),
			'tasks.read',
			...(includeQueryCapability ? ['tasks.query'] : []),
		].map(id => ({ id, availability: 'available', stability: 'stable' })));
	}
	if (invocation.command === 'tasks.query') {
		const result: TaskQueryResultV1 = {
			contractVersion: 1,
			requestId: invocation.requestId,
			kind: 'task-query-result',
			ok: true,
			freshness: freshness(),
			warnings: [],
			contextRevision: revision(),
			tasks: [taskContext],
			page: {
				actualCount: 1,
				returnedCount: 1,
				truncated: false,
				asOf: '2026-07-25T12:00:00.000Z',
			},
			provenance: [],
			truncations: [],
		};
		return successEnvelope(invocation, result);
	}
	if (invocation.command === 'task.get') {
		return successEnvelope(invocation, {
			...taskGetResult(invocation.requestId),
			task: taskContext,
		});
	}
	if (invocation.command === 'mutation.preview') {
		return successEnvelope(
			invocation,
			previewResult(invocation.request as MutationPreviewRequestV1),
		);
	}
	if (invocation.command === 'mutation.apply' && includeApply) {
		return successEnvelope(
			invocation,
			appliedResult(
				invocation.request as MutationApplyRequestV1,
				invocation.expectedVaultSha256,
			),
		);
	}
	throw new Error(`Compact relationship flow must not invoke ${invocation.command}`);
}

function compactRelationshipTask(
	relationships: Partial<TaskContextV1['relationships']> = {},
): TaskContextV1 {
	return {
		...compactUpdateTask('abc1234'),
		relationships: {
			childOperonIds: [],
			blockingOperonIds: [],
			blockedByOperonIds: [],
			relatedOperonIds: [],
			...relationships,
		},
	};
}

function compactUpdateTask(
	operonId: string,
	description = 'Command harness task',
): TaskContextV1 {
	return {
		...task(),
		description,
		identity: { operonId, validity: 'canonical', mutationAllowed: true },
		writableFields: [
			{
				canonicalKey: 'description',
				valueType: 'text',
				present: true,
				value: description,
				canClear: false,
			},
			{
				canonicalKey: 'priority',
				valueType: 'text',
				present: true,
				value: 'priority-low',
				canClear: true,
			},
			{
				canonicalKey: 'note',
				valueType: 'text',
				present: false,
				canClear: true,
			},
			{
				canonicalKey: 'contexts',
				valueType: 'list',
				present: false,
				canClear: true,
			},
			{
				canonicalKey: 'dateDue',
				valueType: 'date',
				present: true,
				value: '2026-07-31',
				canClear: true,
			},
		],
	};
}

function compactUpdateCatalog(requestId: string): OperonCatalogV1 {
	const result = catalogResult(requestId);
	if (!result.ok) throw new Error('Synthetic catalog fixture must be successful.');
	result.taxonomy.priorities.push({
		id: 'priority-low',
		label: 'Low',
		description: 'Low priority',
		order: 1,
		color: '#000000',
		isDefault: false,
		identityStatus: 'resolved',
	});
	const updateFields: FieldDescriptorV1[] = [
		['priority', 'Priority', 'text'],
		['note', 'Note', 'text'],
		['contexts', 'Contexts', 'list'],
		['dateDue', 'Due date', 'date'],
	].map(([canonicalKey, displayName, valueType]) => ({
			canonicalKey,
			displayName,
			description: displayName,
			valueType: valueType as FieldDescriptorV1['valueType'],
			source: 'built-in' as const,
			mappingStatus: 'mapped' as const,
			readable: true,
			mutationClass: 'general-update' as const,
			mutationOwner: 'tasks.update' as const,
			requiresStableTaxonomyId: canonicalKey === 'priority',
	}));
	result.fields = [...result.fields, ...updateFields];
	result.catalogRevision = sha256HexV1(canonicalJsonV1(toJsonValueV1({
		settingsFingerprint: result.settingsFingerprint,
		taxonomy: result.taxonomy,
		fields: result.fields,
		policies: result.policies,
	})));
	return result;
}

function compactCreationResponse(
	invocation: CliInvocationV1,
	includeApply: boolean,
): CliResultEnvelopeV1 | ProcessResultV1 {
	if (invocation.command === 'capabilities') {
		return successEnvelope(invocation, [
			'context.build',
			'tasks.create.preview',
			'tasks.create.apply',
		].map(id => ({ id, availability: 'available', stability: 'stable' })));
	}
	if (invocation.command === 'context.build') {
		return successEnvelope(invocation, compactCreationContext(invocation.requestId));
	}
	if (invocation.command === 'mutation.preview') {
		return successEnvelope(
			invocation,
			creationPreviewResult(invocation.request as MutationPreviewRequestV1),
		);
	}
	if (invocation.command === 'mutation.apply' && includeApply) {
		return successEnvelope(
			invocation,
			appliedResult(
				invocation.request as MutationApplyRequestV1,
				invocation.expectedVaultSha256,
			),
		);
	}
	throw new Error(`Compact create flow must not invoke ${invocation.command}`);
}

function compactCreationContext(requestId: string): ContextPackV1 {
	const context = creationContext(requestId);
	if (!context.catalog) throw new Error('COMPACT_CREATION_CATALOG_MISSING');
	context.catalog.fields = [
		...context.catalog.fields,
		{
			canonicalKey: 'note',
			displayName: 'Note',
			description: 'Task note',
			valueType: 'text',
			source: 'built-in',
			mappingStatus: 'mapped',
			readable: true,
			mutationClass: 'general-update',
			mutationOwner: 'tasks.update',
			requiresStableTaxonomyId: false,
		},
		{
			canonicalKey: 'contexts',
			displayName: 'Contexts',
			description: 'Task contexts',
			valueType: 'list',
			source: 'built-in',
			mappingStatus: 'mapped',
			readable: true,
			mutationClass: 'general-update',
			mutationOwner: 'tasks.update',
			requiresStableTaxonomyId: false,
		},
	];
	context.catalog.taxonomy.pipelines.push({
		id: 'pipeline-daily',
		name: 'Daily',
		description: 'Daily pipeline',
		order: 1,
		identityStatus: 'resolved',
		statuses: [{
			id: 'status-planned',
			label: 'Planned',
			order: 0,
			color: '#000000',
			isFinished: false,
			isCancelled: false,
			isScheduledTarget: true,
			isTrackingTarget: false,
			identityStatus: 'resolved',
		}],
	});
	return context;
}

async function compactGoldenCase(caseId: string): Promise<{
	argv: string[];
	expect: { action: 'preview'; output: 'json'; applies: boolean };
}> {
	const golden = JSON.parse(await readFile(
		path.resolve(process.cwd(), 'scripts/agent-runtime/fixtures/compact-create-golden.json'),
		'utf8',
	)) as {
		cases: Array<{
			id: string;
			argv?: string[];
			expect: { action?: 'preview'; output?: 'json'; applies?: boolean };
		}>;
	};
	const testCase = golden.cases.find(candidate => candidate.id === caseId);
	assert.ok(
		testCase?.argv
			&& testCase.expect.action
			&& testCase.expect.output
			&& typeof testCase.expect.applies === 'boolean',
		`Missing compact golden behavior case: ${caseId}`,
	);
	return {
		argv: testCase.argv,
		expect: {
			action: testCase.expect.action,
			output: testCase.expect.output,
			applies: testCase.expect.applies,
		},
	};
}

function typedIntent(operation: string): Record<string, unknown> {
	const target = {
		operonId: 'abc1234',
		locator: { representation: 'inline', filePath: 'Tasks.md', lineNumber: 0 },
	};
	const specByOperation: Record<string, Record<string, unknown>> = {
		update: {
			operation: 'update',
			changes: [{ field: 'description', valueType: 'text', value: 'Typed update' }],
		},
		transition: {
			operation: 'transition',
			targetStatusId: 'status-done',
			expectedStatusId: 'status-open',
		},
		add: { operation: 'add', collection: 'reminderRules', value: 'dateDue.10m' },
		replace: {
			operation: 'replace',
			collection: 'reminderRules',
			itemId: 'reminder-1',
			value: 'dateDue.30m',
			expectedValue: 'dateDue.10m',
		},
		remove: {
			operation: 'remove',
			collection: 'reminderRules',
			itemId: 'reminder-1',
			expectedValue: 'dateDue.10m',
		},
		start: { operation: 'start' },
		stop: { operation: 'stop' },
	};
	return {
		contractVersion: 1,
		kind: 'mutation-intent',
		...(operation === 'start' || operation === 'stop' ? {} : { target }),
		spec: specByOperation[operation],
		reason: 'Synthetic typed compatibility test.',
	};
}

function fixtureResponse(
	invocation: CliInvocationV1,
	includeApply: boolean,
): CliResultEnvelopeV1 | ProcessResultV1 {
	if (invocation.command === 'capabilities') {
		return successEnvelope(invocation, [
			'tasks.read',
			'tasks.finder',
			'catalog.read',
			'tasks.update.preview',
			'tasks.update.apply',
		].map(id => ({ id, availability: 'available', stability: 'stable' })));
	}
	if (invocation.command === 'tasks.finder') {
		return successEnvelope(invocation, taskFinderResult(invocation.requestId));
	}
	if (invocation.command === 'task.get') {
		return successEnvelope(invocation, taskGetResult(invocation.requestId));
	}
	if (invocation.command === 'catalog') {
		return successEnvelope(invocation, catalogResult(invocation.requestId));
	}
	if (invocation.command === 'mutation.preview') {
		return successEnvelope(
			invocation,
			previewResult(invocation.request as MutationPreviewRequestV1),
		);
	}
	if (invocation.command === 'mutation.apply' && includeApply) {
		return successEnvelope(
			invocation,
			appliedResult(invocation.request as MutationApplyRequestV1, invocation.expectedVaultSha256),
		);
	}
	throw new Error(`Unexpected fixture invocation: ${invocation.command}`);
}

function fixtureRunner(
	requestRoot: string,
	invocations: CliInvocationV1[],
	respond: (invocation: CliInvocationV1) => CliResultEnvelopeV1 | ProcessResultV1,
) {
	return async (_executable: string, args: string[]): Promise<ProcessResultV1> => {
		const token = args.find(value => value.startsWith('requestToken='))?.slice('requestToken='.length);
		assert.ok(token);
		let invocation: CliInvocationV1;
		if (process.platform === 'win32') {
			const frame = WINDOWS_BROKER_FRAMES.get(token);
			assert.ok(frame);
			assert.equal(frame.state, 'staged');
			frame.state = 'consumed';
			invocation = frame.invocation;
		} else {
			invocation = JSON.parse(
				await readFile(requestPathForTokenV1(token, requestRoot), 'utf8'),
			) as CliInvocationV1;
			await unlink(requestPathForTokenV1(token, requestRoot));
		}
		invocations.push(structuredClone(invocation));
		const response = respond(invocation);
		if ('stdout' in response) return response;
		return {
			exitCode: 0,
			signal: null,
			stdout: Buffer.from(JSON.stringify(response), 'utf8'),
			stderr: Buffer.alloc(0),
			totalMs: 1,
			timedOut: false,
			overflow: false,
		};
	};
}

function successEnvelope(invocation: CliInvocationV1, result: unknown): CliResultEnvelopeV1 {
	return {
		contractVersion: 1,
		kind: 'cli-result',
		requestId: invocation.requestId,
		command: invocation.command,
		ok: true,
		transport: { channel: 'request-file', inputBytes: 256 },
		vaultIdentity: { expectedMatch: true },
		compatibility: {
			contractVersion: 1,
			compatible: true,
			runtimeApi: 1,
		},
		cliContract: 1,
		runtime: {
			appVersion: '1.13.3',
			plugin: { id: 'operon', version: '2.6.0', minAppVersion: '1.8.9' },
			apiVersion: 1,
		},
		timing: { handlerMs: 1 },
		warnings: [],
		result,
	} as CliResultEnvelopeV1;
}

function capabilityFailureEnvelope(invocation: CliInvocationV1): CliResultEnvelopeV1 {
	return {
		contractVersion: 1,
		kind: 'cli-result',
		requestId: invocation.requestId,
		command: invocation.command,
		ok: false,
		transport: { channel: 'request-file', inputBytes: 256 },
		vaultIdentity: { expectedMatch: true },
		timing: { handlerMs: 1 },
		warnings: [],
		failure: {
			stage: 'capability',
			error: {
				contractVersion: 1,
				code: 'capability-unavailable',
				reason: 'Synthetic capability refusal.',
				retryable: false,
				action: 'rediscover',
			},
		},
	};
}

function revision(): ContextRevisionV1 {
	return {
		index: { sessionId: 'guided-command', ramGeneration: 1, durable: { status: 'missing' } },
		settingsFingerprint: 'a'.repeat(64),
		pinnedGeneration: 0,
		activeTrackerGeneration: 0,
		repeatSeriesRevision: 0,
		projectSerialGeneration: 0,
		projectSerialSignature: 'b'.repeat(64),
	};
}

function task(): TaskContextV1 {
	return {
		identity: { operonId: 'abc1234', validity: 'canonical', mutationAllowed: true },
		description: 'Command harness task',
		representation: 'inline',
		locator: { representation: 'inline', filePath: 'Tasks.md', lineNumber: 0 },
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
		sourceRevision: { algorithm: 'sha256', contentDigest: 'c'.repeat(64) },
		contextRevision: revision(),
		writableFields: [{
			canonicalKey: 'description',
			valueType: 'text',
			present: true,
			value: 'Command harness task',
			canClear: false,
		}],
	};
}

function freshness() {
	return {
		source: 'live-runtime' as const,
		coherence: 'verified' as const,
		observedAt: '2026-07-25T12:00:00.000Z',
		settled: true,
	};
}

function taskFinderResult(requestId: string): TaskFinderResultV1 {
	return {
		contractVersion: 1,
		requestId,
		kind: 'task-finder-result',
		ok: true,
		freshness: freshness(),
		warnings: [],
		contextRevision: revision(),
		rows: [{ kind: 'task', task: task(), score: 1 }],
		page: {
			actualCount: 1,
			returnedCount: 1,
			truncated: false,
			asOf: '2026-07-25T12:00:00.000Z',
		},
		provenance: [],
		truncations: [],
	};
}

function taskGetResult(requestId: string): TaskGetResultV1 {
	return {
		contractVersion: 1,
		requestId,
		kind: 'task-get-result',
		ok: true,
		freshness: freshness(),
		warnings: [],
		contextRevision: revision(),
		task: task(),
		provenance: [],
		truncations: [],
	};
}

function catalogResult(requestId: string): OperonCatalogV1 {
	const result: OperonCatalogV1 = {
		contractVersion: 1,
		requestId,
		kind: 'catalog-result',
		ok: true,
		freshness: freshness(),
		warnings: [],
		contextRevision: revision(),
		settingsFingerprint: 'a'.repeat(64),
		catalogRevision: '0'.repeat(64),
		taxonomy: {
			defaultPipeline: { configuredValue: 'Work', id: 'pipeline-work', status: 'resolved' },
			defaultPriority: { configuredValue: 'Normal', id: 'priority-normal', status: 'resolved' },
			pipelines: [{
				id: 'pipeline-work',
				name: 'Work',
				description: 'Work pipeline',
				order: 0,
				identityStatus: 'resolved',
				statuses: [{
					id: 'status-open',
					label: 'Open',
					order: 0,
					color: '#000000',
					isFinished: false,
					isCancelled: false,
					isScheduledTarget: false,
					isTrackingTarget: false,
					identityStatus: 'resolved',
				}],
			}],
			priorities: [{
				id: 'priority-normal',
				label: 'Normal',
				description: 'Normal priority',
				order: 0,
				color: '#000000',
				isDefault: true,
				identityStatus: 'resolved',
			}],
		},
		fields: [{
			canonicalKey: 'description',
			displayName: 'Description',
			description: 'Task description',
			valueType: 'text',
			source: 'built-in',
			mappingStatus: 'mapped',
			readable: true,
			mutationClass: 'general-update',
			mutationOwner: 'tasks.update',
			requiresStableTaxonomyId: false,
		}],
		policies: catalogPolicies(),
	};
	if (!result.ok) throw new Error('Synthetic catalog fixture must be successful.');
	result.catalogRevision = sha256HexV1(canonicalJsonV1(toJsonValueV1({
		settingsFingerprint: result.settingsFingerprint,
		taxonomy: result.taxonomy,
		fields: result.fields,
		policies: result.policies,
	})));
	return result;
}

function catalogPolicies(): CatalogPoliciesV1 {
	return {
		creation: {
			descriptionRequired: true,
			assigneesRequired: false,
			defaultEstimateMinutes: 0,
			defaultToFileTask: false,
			fileTaskTargetFolder: 'Tasks',
			fileTaskTemplateFolder: 'Templates',
			inlineTaskSaveMode: 'specific-file',
			inlineTaskTargetFile: 'Tasks.md',
			inlineTaskHeading: '',
			dailyNoteAddsStartDate: false,
			dailyNoteAddsScheduledDate: false,
			createDailyNotesAsFileTasks: false,
			calendarInlineTaskHeading: '',
			builtInTemplateCandidates: [],
			compactBatchVersion: 1,
			compactBatchInputFormat: 'compact-lines',
			compactBatchMaxItems: 64,
		},
		inheritance: {
			fields: [],
			statusPipelineSource: 'default',
			autoParentFileTask: false,
			autoParentLinkedFileSubtasks: false,
			fileTaskParentInlineTargetMode: 'default',
			fileTaskParentFileTargetMode: 'default',
			inlineTaskParentInlineTargetMode: 'default',
			inlineTaskParentFileTargetMode: 'default',
			inlineTaskParentFileHeadingKeyword: '',
		},
		exclusions: { folders: [] },
		filters: [],
		automation: {
			autoCompleteParentWhenAllChildrenTerminal: false,
			cascadeCancelToDescendants: false,
			newOccurrencePosition: 'below',
			fileTaskAutoArchiveEnabled: false,
			fileTaskArchiveFolder: '',
			fileTaskArchiveDelaySeconds: 0,
			fileTaskArchiveOnlyFromFileTasksFolder: false,
			fileRepeatDestination: 'same-folder',
			fileRepeatCustomFolder: '',
			estimateAutoReallocation: false,
			trackerSplitSessionsAtMidnight: false,
			reminderCatchUpWindowMinutes: 0,
			reminderAutoPinDueTasks: false,
			pinnedDockAutoPin: false,
			pinnedDockAutoUnpinFinished: false,
		},
		reminders: {
			fields: [
				{ canonicalKey: 'reminderDatetimes', availability: 'available' },
				{ canonicalKey: 'reminderRules', availability: 'available' },
			],
				ruleAnchors: ['datetimeStart', 'datetimeEnd', 'dateStarted', 'dateScheduled', 'dateDue'],
			itemActions: ['add', 'replace', 'remove'],
		},
		conversion: {
			directions: ['inline-to-file', 'file-to-inline'],
			templateSelection: 'explicit-or-needs-template',
			targetModes: ['exact-line', 'configured-target'],
			inlineToFileMovesPlainCheckboxes: false,
			fileToInlineRequiresExplicitConfirmation: true,
		},
		taskUpdate: {
			writableKeys: ['description'],
			customKeyPolicy: 'active-valid-nonreserved-text-number-date-datetime-list-checkbox',
		},
		relationships: {
			writableFields: ['parentTask', 'blocking', 'blockedBy'],
			actions: ['replace', 'clear'],
			parentMaxTargets: 1,
			dependencyInverseWrites: true,
		},
		transitions: { actions: ['set-status', 'complete', 'cancel', 'reopen'] },
		timer: { actions: ['start', 'stop'] },
		inlineRelocation: { target: 'exact-blank-line' },
		deletion: {
			requiresExplicitConfirmation: true,
			deleteAdditionalTasks: false,
			referenceCleanup: 'explicit-or-block',
		},
		projectSerialScopes: [],
	};
}

function creationContext(requestId: string): ContextPackV1 {
	const catalog = catalogResult(requestId);
	if (!catalog.ok) throw new Error('Synthetic creation catalog must be successful.');
	return {
		contractVersion: 1,
		requestId,
		kind: 'context-pack',
		ok: true,
		purpose: 'creation',
		projection: 'creation-context',
		execution: freshness(),
		contextRevision: revision(),
		catalogRevision: catalog.catalogRevision,
		entities: [],
		relationships: { explicit: [], derived: [], inferred: [] },
		catalog: {
			taxonomy: catalog.taxonomy,
			fields: catalog.fields,
		},
		policies: catalog.policies,
		provenance: [],
		truncations: [],
		warnings: [],
	};
}

function creationPreviewResult(request: MutationPreviewRequestV1, withWarning = false) {
	const plan = creationPlan(request);
	if (withWarning) {
		const warning = { code: 'review-required', message: 'Review this plan before apply.' };
		return {
			contractVersion: 1,
			requestId: request.requestId,
			kind: 'mutation-preview-result' as const,
			ok: true as const,
			warnings: [warning],
			plan,
		};
	}
	return {
		contractVersion: 1,
		requestId: request.requestId,
		kind: 'mutation-preview-result' as const,
		ok: true as const,
		warnings: [],
		plan,
	};
}

function creationPlan(request: MutationPreviewRequestV1): SealedMutationPlanV1 {
	if (request.spec.operation !== 'create') {
		throw new Error('Expected a creation preview.');
	}
	const items = request.spec.items;
	const effects = items.map((item, index) => {
		const locator = {
			representation: 'inline' as const,
			filePath: 'Tasks.md',
			lineNumber: index + 1,
		};
		return {
			item,
			locator,
			operonId: `new${String(index).padStart(4, '0')}`,
		};
	});
	const targets = effects.map(effect => ({
		operonId: effect.operonId,
		locator: effect.locator,
		targetDigest: createHash('sha256').update(JSON.stringify(effect.locator)).digest('hex'),
	}));
	const createdAt = new Date();
	const plan: SealedMutationPlanV1 = {
		contractVersion: 1,
		planId: `guided-${randomUUID()}`,
		planHash: '',
		clientInstanceId: request.clientInstanceId,
		correlationId: request.requestId,
		idempotencyKeyHash: createHash('sha256').update(request.idempotencyKey).digest('hex'),
		receiptTargetDigest: '',
		capability: request.capability,
		mutationKind: request.mutationKind,
		createdAt: createdAt.toISOString(),
		expiresAt: new Date(createdAt.getTime() + 300_000).toISOString(),
		targets,
		contextRevision: revision(),
		affectedResources: [{
			resourceKind: 'task-source',
			resourceKey: 'Tasks.md',
			revision: 'c'.repeat(64),
		}],
		atomicGroups: [{
			groupId: 'task-source:Tasks.md',
			order: 0,
			resources: [{ resourceKind: 'task-source', resourceKey: 'Tasks.md' }],
		}],
		predictedEffects: [{
			resourceKind: 'task-source',
			resourceKey: 'Tasks.md',
			action: 'update',
			summary: 'Create one exact inline task.',
		}],
		riskLevel: 'routine',
		requiresConfirmation: false,
		requiredAcknowledgements: [],
		warnings: [],
		spec: request.spec,
		createEffects: effects.map(({ item, locator, operonId }) => ({
			itemRef: item.itemRef,
			operonId,
			locator,
			targetBeforeDigest: 'c'.repeat(64),
			renderedTaskDigest: 'd'.repeat(64),
			plannedSourceDigest: 'e'.repeat(64),
			...(item.parent?.kind === 'existing'
				? { resolvedParentOperonId: item.parent.operonId }
				: {}),
			resolvedRelatedOperonIds: [],
		})),
	};
	plan.targets.forEach((target, index) => {
		const effect = plan.createEffects?.[index];
		if (!effect) throw new Error('CREATION_EFFECT_MISSING');
		target.targetDigest = sha256HexV1(canonicalJsonV1(toJsonValueV1(effect)));
	});
	plan.receiptTargetDigest = computeReceiptTargetDigestV1(plan.targets);
	plan.planHash = computeSealedMutationPlanHashV1(plan);
	return plan;
}

function previewResult(request: MutationPreviewRequestV1) {
	const plan = updatePlan(request);
	return {
		contractVersion: 1,
		requestId: request.requestId,
		kind: 'mutation-preview-result' as const,
		ok: true as const,
		warnings: [],
		plan,
	};
}

function updatePlan(request: MutationPreviewRequestV1): SealedMutationPlanV1 {
	if (request.spec.operation === 'create') {
		throw new Error('The guided command harness requires an exact task mutation.');
	}
	if (request.spec.operation === 'relocate-inline' && !('source' in request.spec)) {
		throw new Error('The guided command harness cannot seal a preview-only relocation intent.');
	}
	const sealedSpec: MutationSpecV1 = request.spec.operation === 'set-pinned'
			? {
			...request.spec,
			expectedPinned: !request.spec.pinned,
			expectedEntryRevision: 'f'.repeat(64),
			effectiveAt: '2026-07-27T12:00:00.000Z',
		}
			: request.spec.operation === 'replace-relationships'
				? {
				...request.spec,
				changes: request.spec.changes.map(change => ({
					...change,
					expectedTargetOperonIds: [],
				})),
				affectedOperonIds: [
					request.target?.operonId ?? '',
					...request.spec.changes.flatMap(change => change.targetOperonIds),
				].filter((value, index, all) => (
					value !== '' && all.indexOf(value) === index
				)).sort((left, right) => left.localeCompare(right)),
				}
				: (
					request.spec.operation === 'add-session'
					|| request.spec.operation === 'update-session'
					|| request.spec.operation === 'remove-session'
				)
					? {
						...request.spec,
						expectedTrackers: request.spec.operation === 'add-session'
							? ''
							: '2026-07-27T09:00:00/2026-07-27T10:00:00',
						expectedDuration: request.spec.operation === 'add-session' ? 0 : 3600,
						...(request.spec.operation === 'add-session' ? {} : {
							selectedRawIndex: 0,
							expectedStart: '2026-07-27T09:00:00',
							expectedEnd: '2026-07-27T10:00:00',
						}),
						nextTrackers: request.spec.operation === 'remove-session'
							? ''
							: request.spec.operation === 'add-session'
								? `${request.spec.start}/${request.spec.end}`
								: `${request.spec.start}/${request.spec.end}`,
						nextDuration: request.spec.operation === 'remove-session'
							? 0
							: 3600,
						effectiveAt: '2026-07-27T12:00:00.000Z',
					}
					: request.spec;
	const targetDigest = createHash('sha256').update(JSON.stringify(request.target)).digest('hex');
	const createdAt = new Date();
	const targets = [{
		operonId: request.target?.operonId,
		locator: request.target?.locator,
		targetDigest,
	}];
	const plan: SealedMutationPlanV1 = {
		contractVersion: 1,
		planId: `guided-${randomUUID()}`,
		planHash: '',
		clientInstanceId: request.clientInstanceId,
		correlationId: request.requestId,
		idempotencyKeyHash: createHash('sha256').update(request.idempotencyKey).digest('hex'),
		receiptTargetDigest: '',
		capability: request.capability,
		mutationKind: request.mutationKind,
		createdAt: createdAt.toISOString(),
		expiresAt: new Date(
			createdAt.getTime() + (request.spec.operation === 'remove-session' ? 60_000 : 300_000),
		).toISOString(),
		targets,
		contextRevision: revision(),
		affectedResources: request.spec.operation === 'set-pinned'
			? [{
				resourceKind: 'pinned',
				resourceKey: request.target?.operonId ?? '',
				revision: 'c'.repeat(64),
			}]
			: [{
				resourceKind: 'task-source',
				resourceKey: 'Tasks.md',
				revision: 'c'.repeat(64),
			}],
		atomicGroups: [{
			groupId: request.spec.operation === 'set-pinned'
				? `pinned:${request.target?.operonId ?? ''}`
				: 'task-source:Tasks.md',
			order: 0,
			resources: request.spec.operation === 'set-pinned'
				? [{ resourceKind: 'pinned', resourceKey: request.target?.operonId ?? '' }]
				: [{ resourceKind: 'task-source', resourceKey: 'Tasks.md' }],
		}],
		predictedEffects: [{
			resourceKind: request.spec.operation === 'set-pinned' ? 'pinned' : 'task-source',
			resourceKey: request.spec.operation === 'set-pinned'
				? request.target?.operonId ?? ''
				: 'Tasks.md',
			action: request.spec.operation === 'set-pinned' ? 'state-change' : 'update',
			summary: `Apply exact ${request.spec.operation} task mutation.`,
		}],
		riskLevel: request.spec.operation === 'remove-session'
			? 'destructive'
			: request.spec.operation === 'transition'
				? 'elevated'
				: 'routine',
		requiresConfirmation: request.spec.operation === 'remove-session',
		requiredAcknowledgements: request.spec.operation === 'remove-session'
			? ['confirm:timer.session:abc1234']
			: [],
		warnings: [],
		spec: sealedSpec,
	};
	plan.receiptTargetDigest = computeReceiptTargetDigestV1(plan.targets);
	plan.planHash = computeSealedMutationPlanHashV1(plan);
	return plan;
}

function appliedResult(
	request: MutationApplyRequestV1,
	vaultIdentityHash: string,
): MutationResultV1 {
	const now = new Date().toISOString();
	const resourceRevisions = request.plan.atomicGroups[0].resources.map(resource => ({
		...resource,
		revision: 'e'.repeat(64),
	}));
	return {
		contractVersion: 1,
		requestId: request.requestId,
		kind: 'mutation-result',
		status: 'applied',
		mutationMayHaveApplied: true,
		retryAllowed: false,
		groupResults: [{
			groupId: request.plan.atomicGroups[0].groupId,
			status: 'committed',
			resourceRevisions,
		}],
		receipt: {
			contractVersion: 1,
			vaultIdentityHash,
			clientInstanceId: request.plan.clientInstanceId,
			idempotencyKeyHash: request.plan.idempotencyKeyHash,
			planHash: request.plan.planHash,
			mutationKind: request.plan.mutationKind,
			targetDigest: request.plan.receiptTargetDigest,
			terminalOutcome: 'applied',
			effectiveAt: now,
			completedAt: now,
			expiresAt: new Date(Date.parse(now) + 86_400_000).toISOString(),
		},
		postflight: {
			status: 'verified',
			observedAt: now,
			contextRevision: revision(),
		},
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

async function createHarnessRoot(label: string) {
	const root = await mkdtemp(path.join(tmpdir(), `operon-guided-${label}-`));
	const vault = path.join(root, 'vault');
	const config = path.join(root, 'config');
	const requests = path.join(root, 'requests');
	await mkdir(path.join(vault, '.obsidian', 'plugins', 'operon'), { recursive: true });
	await mkdir(requests, { recursive: true, mode: 0o700 });
	await writeFile(
		path.join(vault, '.obsidian', 'plugins', 'operon', 'manifest.json'),
		JSON.stringify({ id: 'operon', version: '2.6.0', minAppVersion: '1.8.9' }),
	);
	return {
		root,
		vault: await realpath(vault),
		config,
		requests,
		cleanup: async () => await rm(root, { recursive: true, force: true }),
	};
}

globalThis.__operonGuidedMaintenanceCommandTestRun = run();

declare global {
	var __operonGuidedMaintenanceCommandTestRun: Promise<void> | undefined;
}
