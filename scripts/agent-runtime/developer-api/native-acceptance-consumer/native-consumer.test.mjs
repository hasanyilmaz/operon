import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build } from 'esbuild';

const fixtureRoot = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(fixtureRoot, '../../../..');
const cliPackageRoot = path.join(pluginRoot, 'packages', 'operon-cli');
const moduleRoot = await mkdtemp(path.join(tmpdir(), 'operon-native-consumer-module-'));
const modulePath = path.join(moduleRoot, 'acceptance.mjs');
await build({
	entryPoints: [path.join(fixtureRoot, 'acceptance.ts')],
	outfile: modulePath,
	bundle: true,
	platform: 'node',
	format: 'esm',
	target: ['node22'],
	logLevel: 'silent',
});
const {
	ACCEPTANCE_INPUT_KIND_V1,
	parseRunnerInputV1,
	runAcceptanceV1,
} = await import(pathToFileURL(modulePath).href);

test.after(async () => {
	await rm(moduleRoot, { recursive: true, force: true });
});

test('build consumes an exact operon-cli tarball and emits an isolated Obsidian plugin', async () => {
	const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'operon-native-consumer-build-test-'));
	try {
		const packRoot = path.join(temporaryRoot, 'pack');
		const outputRoot = path.join(temporaryRoot, 'plugin');
		await mkdir(packRoot);
		const packResult = JSON.parse(run(
			'npm',
			['pack', '--json', '--pack-destination', packRoot],
			cliPackageRoot,
			temporaryRoot,
		).stdout)[0];
		const tarballPath = path.join(packRoot, packResult.filename);
		run(
			process.execPath,
			[
				path.join(fixtureRoot, 'build.mjs'),
				'--tarball',
				tarballPath,
				'--outdir',
				outputRoot,
			],
			fixtureRoot,
			temporaryRoot,
		);
		const evidence = JSON.parse(await readFile(
			path.join(outputRoot, 'build-evidence.json'),
			'utf8',
		));
		assert.equal(evidence.kind, 'operon-developer-api-native-consumer-build');
		assert.equal(evidence.package, `${packResult.name}@${packResult.version}`);
		assert.equal(
			evidence.publicTypesEntrypoint,
			'@stratejya/operon-cli/contracts/v1/developer-api',
		);
		assert.deepEqual(evidence.runtimeInputs, [
			'acceptance.ts',
			'main.ts',
			'runner-contract.ts',
		]);
		assert.match(evidence.tarballSha256, /^[0-9a-f]{64}$/u);
		assert.match(evidence.mainJsSha256, /^[0-9a-f]{64}$/u);
		assert.ok(evidence.mainJsBytes > 0);
		const mainSource = await readFile(path.join(outputRoot, 'main.js'), 'utf8');
		assert.doesNotMatch(mainSource, /operon-cli|src\/agent-runtime|packages\/operon-cli/u);
		const manifest = JSON.parse(await readFile(path.join(outputRoot, 'manifest.json'), 'utf8'));
		assert.equal(manifest.id, 'operon-developer-api-native-acceptance-consumer');
		assert.equal(manifest.minAppVersion, '1.12.2');
		assert.equal(manifest.isDesktopOnly, true);
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
});

test('runner contract is strict and rejects caller security material', () => {
	const input = routineInput();
	assert.deepEqual(parseRunnerInputV1(input), input);
	assert.throws(
		() => parseRunnerInputV1({ ...input, authorization: { basis: 'host-policy' } }),
		/INPUT_KEYS_INVALID/u,
	);
	assert.throws(
		() => parseRunnerInputV1({ ...input, recoveryRef: `dvr1_${'a'.repeat(48)}` }),
		/INPUT_KEYS_INVALID/u,
	);
	assert.throws(
		() => parseRunnerInputV1({
			...input,
			mutation: {
				...input.mutation,
				spec: {
					...input.mutation.spec,
					authorization: { basis: 'host-policy' },
				},
			},
		}),
		/MUTATION_HOST_OWNED_FIELD_INVALID/u,
	);
});

test('missing exact grant produces fail-closed evidence without a domain or mutation call', async () => {
	const counters = { taskReads: 0, previews: 0, applies: 0 };
	const host = fakeHost({
		grantState: 'pending',
		counters,
	});
	const output = await runAcceptanceV1(routineInput(), host);
	assert.equal(output.status, 'blocked');
	assert.equal(output.failClosed?.error.code, 'authority-insufficient');
	assert.equal(output.failClosed?.writeAttempted, false);
	assert.equal(output.registryIdentity?.exactInstance, true);
	assert.equal(output.registryIdentity?.forgedCopyRejected, true);
	assert.equal(output.baseline?.health, true);
	assert.equal(output.baseline?.capabilities, true);
	assert.deepEqual(counters, { taskReads: 0, previews: 0, applies: 0 });
});

test('routine plan applies once and same-handle replay leaves the source revision unchanged', async () => {
	const counters = { taskReads: 0, previews: 0, applies: 0 };
	const host = fakeHost({
		grantState: 'active',
		counters,
	});
	const output = await runAcceptanceV1(routineInput(), host);
	assert.equal(output.status, 'passed');
	assert.equal(output.exactRead?.ok, true);
	assert.equal(output.routine?.previewed, true);
	assert.equal(output.routine?.applied, true);
	assert.equal(output.routine?.replayed, true);
	assert.equal(output.routine?.writeFreeReplay, true);
	assert.equal(output.routine?.sourceRevisionStableAfterReplay, true);
	assert.equal(output.routine?.applyPlanDigestMatched, true);
	assert.equal(output.routine?.applyReceiptOutcomeMatched, true);
	assert.equal(output.routine?.replayPlanDigestMatched, true);
	assert.equal(output.routine?.applyPostflightVerified, true);
	assert.equal(output.routine?.replayPostflightVerified, true);
	assert.equal(output.routine?.finalStateVerified, true);
	assert.equal(output.runtimeSessionId, 'session-routine');
	assert.match(output.routine?.recoveryRef ?? '', /^dvr1_[0-9a-f]{48}$/u);
	assert.deepEqual(counters, { taskReads: 3, previews: 1, applies: 2 });
});

test('new session recovers the terminal routine receipt by runner-saved recoveryRef', async () => {
	const counters = { taskReads: 0, previews: 0, applies: 0 };
	const host = fakeHost({
		grantState: 'active',
		counters,
		recovery: true,
	});
	const output = await runAcceptanceV1(recoveryInput(), host);
	assert.equal(output.status, 'passed');
	assert.equal(output.recovery?.receiptReplayed, true);
	assert.equal(output.recovery?.status, 'already-applied');
	assert.equal(output.recovery?.listedPendingAfter, false);
	assert.equal(output.recovery?.receiptPlanDigestMatched, true);
	assert.equal(output.recovery?.sessionChanged, true);
	assert.equal(output.recovery?.instanceChanged, true);
	assert.equal(output.recovery?.finalStateVerified, true);
	assert.equal(counters.taskReads, 1);
});

test('recovery fails closed when the runtime session or consumer instance did not change', async () => {
	const counters = { taskReads: 0, previews: 0, applies: 0 };
	const input = recoveryInput();
	const host = fakeHost({
		grantState: 'active',
		counters,
		recovery: false,
	});
	const output = await runAcceptanceV1({
		...input,
		routineEvidence: {
			...input.routineEvidence,
			sessionId: 'session-routine',
			instanceEpoch: 'instance-epoch',
		},
	}, host);
	assert.equal(output.status, 'failed');
	assert.equal(output.error?.code, 'RESTART_RECOVERY_REF_NOT_PROVEN');
	assert.equal(output.recovery?.sessionChanged, false);
	assert.equal(output.recovery?.instanceChanged, false);
});

test('routine rejects a contradictory first-apply receipt outcome', async () => {
	const counters = { taskReads: 0, previews: 0, applies: 0 };
	const output = await runAcceptanceV1(routineInput(), fakeHost({
		grantState: 'active',
		counters,
		contradictoryApplyReceipt: true,
	}));
	assert.equal(output.status, 'failed');
	assert.equal(output.error?.code, 'ROUTINE_FINAL_PROOF_NOT_VERIFIED');
	assert.equal(output.routine?.applyReceiptOutcomeMatched, false);
});

function routineInput() {
	return {
		contractVersion: 1,
		kind: ACCEPTANCE_INPUT_KIND_V1,
		runId: 'native-run-001',
		phase: 'routine',
		expectedConsumer: {
			id: 'operon-developer-api-native-acceptance-consumer',
			version: '1.0.0',
		},
		fixtureVault: {
			root: '/tmp/operon-native-fixture',
			markerNonce: 'native-nonce-001',
		},
		requestedCapabilities: [
			'system.health',
			'system.capabilities',
			'tasks.read',
			'tasks.update.preview',
			'tasks.update.apply',
		],
		expectedTask: {
			operonId: '00000000-0000-4000-8000-000000000001',
			representation: 'inline',
		},
		expectedFinalState: {
			note: 'native acceptance',
		},
		exactRead: {
			contractVersion: 1,
			requestId: 'exact-read-001',
			kind: 'task-get',
			consistency: 'strict',
			selector: {
				kind: 'operon-id',
				operonId: '00000000-0000-4000-8000-000000000001',
			},
		},
		mutation: {
			capability: 'tasks.update.preview',
			mutationKind: 'task.update',
			target: {
				operonId: '00000000-0000-4000-8000-000000000001',
				locator: {
					representation: 'inline',
					filePath: 'Tasks.md',
					lineNumber: 0,
				},
			},
			spec: {
				operation: 'update',
				changes: [{ field: 'note', valueType: 'text', value: 'native acceptance' }],
			},
		},
	};
}

function recoveryInput() {
	const { mutation: _mutation, ...input } = routineInput();
	return {
		...input,
		phase: 'recovery',
		recoveryRef: `dvr1_${'a'.repeat(48)}`,
		routineEvidence: {
			runId: 'native-run-001',
			sha256: 'b'.repeat(64),
			recoveryRef: `dvr1_${'a'.repeat(48)}`,
			planDigest: 'plan-digest',
			sessionId: 'session-routine',
			instanceEpoch: 'instance-epoch',
		},
	};
}

function fakeHost({
	grantState,
	counters,
	recovery = false,
	contradictoryApplyReceipt = false,
}) {
	const consumerPlugin = {
		manifest: {
			id: 'operon-developer-api-native-acceptance-consumer',
			name: 'Operon Developer API Native Acceptance Consumer',
			version: '1.0.0',
		},
	};
	const api = fakeApi(counters, recovery, contradictoryApplyReceipt);
	return {
		consumerPlugin,
		registeredConsumer: consumerPlugin,
		accessor: {
			getDeveloperApiV1(candidate, request) {
				if (candidate !== consumerPlugin) {
					const error = structuredError('authority-insufficient');
					return {
						contractVersion: 1,
						kind: 'developer-api-access-result',
						ok: false,
						status: status('revoked', request.requestedCapabilities, recovery),
						error,
					};
				}
				const baseline = request.requestedCapabilities.every(capability => (
					capability === 'system.health' || capability === 'system.capabilities'
				));
				if (!baseline && grantState !== 'active') {
					const error = structuredError('authority-insufficient');
					return {
						contractVersion: 1,
						kind: 'developer-api-access-result',
						ok: false,
						status: status(grantState, request.requestedCapabilities, recovery),
						error,
					};
				}
				return {
					contractVersion: 1,
					kind: 'developer-api-access-result',
					ok: true,
					status: status(
						baseline ? 'active' : grantState,
						request.requestedCapabilities,
						recovery,
					),
					api,
				};
			},
		},
	};
}

function fakeApi(counters, recovery, contradictoryApplyReceipt = false) {
	const recoveryRef = `dvr1_${'a'.repeat(48)}`;
	return {
		contractVersion: 1,
		runtimeApiVersion: 1,
		sessionId: recovery ? 'session-restarted' : 'session-routine',
		hasCapability: () => true,
		channel: { status: () => status('active', []) },
		system: {
			health: async () => ({
				apiVersion: 1,
				contractVersion: 1,
				ok: true,
				lifecyclePhase: 'ready',
				v8PersistencePhase: 'idle',
				compatibility: { contractVersion: 1, runtimeApi: { min: 1, max: 1 } },
				capabilities: [{ id: 'system.health', availability: 'available', stability: 'stable' }],
				freshness: {
					source: 'live-runtime',
					coherence: 'verified',
					observedAt: '2026-07-30T00:00:00.000Z',
					settled: true,
				},
				admission: { reads: true, writes: true },
				warnings: [],
			}),
			capabilities: () => [
				{ id: 'system.health', availability: 'available', stability: 'stable' },
				{ id: 'system.capabilities', availability: 'available', stability: 'stable' },
			],
		},
		tasks: {
			get: async () => {
				counters.taskReads += 1;
				return taskRead(counters.applies === 0 ? 'revision-before' : 'revision-after');
			},
		},
		mutations: {
			preview: async () => {
				counters.previews += 1;
				return {
					contractVersion: 1,
					kind: 'developer-mutation-preview-result',
					requestId: 'preview',
					ok: true,
					plan: {
						contractVersion: 1,
						kind: 'developer-mutation-plan',
						recoveryRef,
						planDigest: 'plan-digest',
						capability: 'tasks.update.preview',
						mutationKind: 'task.update',
						createdAt: '2026-07-30T00:00:00.000Z',
						expiresAt: '2026-07-30T01:00:00.000Z',
						riskLevel: 'routine',
						requiresConsent: false,
						targets: [],
						predictedEffects: [],
						warnings: [],
					},
					warnings: [],
				};
			},
			apply: async () => {
				counters.applies += 1;
				const status = counters.applies === 1 ? 'applied' : 'already-applied';
				return mutationResult(
					status,
					contradictoryApplyReceipt && status === 'applied'
						? 'already-applied'
						: status,
				);
			},
			pendingRecoveries: async () => ({
				contractVersion: 1,
				kind: 'developer-mutation-pending-recoveries-result',
				ok: true,
				recoveries: [],
			}),
			recover: async () => mutationResult('already-applied'),
		},
	};
}

function taskRead(revision) {
	return {
		contractVersion: 1,
		requestId: 'read',
		kind: 'task-get-result',
		ok: true,
		freshness: {
			source: 'live-runtime',
			coherence: 'verified',
			observedAt: '2026-07-30T00:00:00.000Z',
			settled: true,
		},
		warnings: [],
		contextRevision: {},
		task: {
			identity: {
				operonId: '00000000-0000-4000-8000-000000000001',
				validity: 'canonical',
				mutationAllowed: true,
			},
			representation: 'inline',
			note: 'native acceptance',
			sourceRevision: { algorithm: 'sha256', contentDigest: revision },
		},
		provenance: [],
		truncations: [],
	};
}

function mutationResult(status, terminalOutcome = status) {
	return {
		contractVersion: 1,
		kind: 'developer-mutation-execution-result',
		requestId: `mutation-${status}`,
		status,
		mutationMayHaveApplied: true,
		retryAllowed: false,
		groupResults: [],
		receipt: {
			contractVersion: 1,
			planDigest: 'plan-digest',
			mutationKind: 'task.update',
			targetDigest: 'target-digest',
			terminalOutcome,
			effectiveAt: '2026-07-30T00:00:01.000Z',
			completedAt: '2026-07-30T00:00:02.000Z',
			expiresAt: '2026-07-31T00:00:02.000Z',
		},
		postflight: status === 'applied'
			? {
				status: 'verified',
				observedAt: '2026-07-30T00:00:02.000Z',
				contextRevision: {},
			}
			: { status: 'receipt-replay' },
	};
}

function status(grantState, requestedCapabilities, recovery = false) {
	const active = grantState === 'active';
	return {
		contractVersion: 1,
		kind: 'developer-api-channel-status',
		runtimeApiVersion: 1,
		availability: 'available',
		reason: 'ready',
		lifecyclePhase: 'ready',
		authority: active ? 'granted' : 'revoked',
		consumer: {
			id: 'operon-developer-api-native-acceptance-consumer',
			name: 'Operon Developer API Native Acceptance Consumer',
			version: '1.0.0',
			instanceEpoch: recovery ? 'instance-epoch-restarted' : 'instance-epoch',
		},
		grant: {
			state: grantState,
			revision: active ? 7 : 0,
			requestedCapabilities,
			grantedCapabilities: active ? requestedCapabilities : [],
			effectiveCapabilities: active ? requestedCapabilities : [],
		},
		admission: { reads: active, writes: active },
		capabilities: [],
	};
}

function structuredError(code) {
	return {
		code,
		message: code,
		retryable: false,
		action: code === 'authority-insufficient' ? 'request-authority' : 'inspect',
	};
}

function run(command, args, cwd, cacheRoot) {
	const result = spawnSync(command, args, {
		cwd,
		encoding: 'utf8',
		env: {
			...process.env,
			npm_config_cache: path.join(cacheRoot, 'npm-cache'),
			npm_config_audit: 'false',
			npm_config_fund: 'false',
			npm_config_update_notifier: 'false',
			NO_COLOR: '1',
		},
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error([
			`Command failed (${result.status}): ${command} ${args.join(' ')}`,
			result.stdout,
			result.stderr,
		].filter(Boolean).join('\n'));
	}
	return result;
}
