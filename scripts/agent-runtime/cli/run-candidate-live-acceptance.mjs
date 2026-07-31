#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
	copyFile,
	lstat,
	mkdtemp,
	mkdir,
	readFile,
	readdir,
	rm,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import {
	assertLiveAcceptanceInputsV1,
	execNpmV1,
	installedCliArtifactV1,
	nativePlatformIdentityV1,
	officialObsidianCliIdentityV1,
	runAcceptanceProofV1,
	runCliJsonlV1,
	runCliJsonV1,
	validateDisposableAcceptanceVaultV1,
} from './live-acceptance-platform.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDirectory, '../../..');
const args = process.argv.slice(2);
const tarballArgument = readRequired('--tarball');
const vaultArgument = readRequired('--vault');
const outputArgument = readRequired('--output');
const candidateEvidenceArgument = readRequired('--candidate-evidence');
const publicPluginRootArgument = readOptional('--public-plugin-root');
const profile = readRequired('--profile');
const cellId = readRequired('--cell-id');
const expectedObsidianVersion = readRequired('--expected-obsidian-version');
const expectedOsRef = readRequired('--expected-os-ref');
const mutationHookArgument = readOptional('--mutation-hook')
	?? process.env.OPERON_ACCEPTANCE_MUTATION_HOOK;
const nativeProofHookArgument = readOptional('--native-proof-hook')
	?? process.env.OPERON_ACCEPTANCE_NATIVE_PROOF_HOOK;
assert.ok(
	nativeProofHookArgument,
	'Native acceptance requires --native-proof-hook (or OPERON_ACCEPTANCE_NATIVE_PROOF_HOOK). '
	+ 'The hook must perform real platform-security, interruption/restart, lifecycle, and '
	+ 'Developer API proofs on the native host.',
);
assert.ok(
	mutationHookArgument,
	'Native acceptance requires --mutation-hook (or OPERON_ACCEPTANCE_MUTATION_HOOK). '
	+ 'Full cells require all 12 mutation families; smoke cells require a real routine '
	+ 'preview/apply/receipt-replay and same-plan recovery proof. A full native provider '
	+ 'may compose run-live-stage5-completion.mjs but must also emit the Stage 7 proof counters.',
);
assertLiveAcceptanceInputsV1({
	profile,
	cellId,
	expectedObsidianVersion,
	expectedOsRef,
});
const nativeMatrix = JSON.parse(await readFile(
	path.join(pluginRoot, 'contracts/agent-runtime/native-acceptance-matrix-v1.json'),
	'utf8',
));
const expectedOs = nativeMatrix.operatingSystems.find(os => os.id === expectedOsRef);
assert.ok(expectedOs, `Unknown frozen native OS reference ${expectedOsRef}.`);
const expectedNode = nativeMatrix.nodeVersions.find(
	node => node.major === Number(process.versions.node.split('.')[0]),
);
assert.ok(expectedNode, `Node ${process.versions.node} is outside the frozen native matrix.`);
assert.equal(
	process.version,
	`v${expectedNode.version}`,
	'Native acceptance must use the exact frozen Node patch version.',
);
assert.equal(
	profile,
	expectedNode.nativeProfile === 'compatibility-smoke' ? 'smoke' : expectedNode.nativeProfile,
	'Acceptance profile does not match the frozen Node profile.',
);
const expectedObsidian = nativeMatrix.obsidianVersions.find(
	version => version.version === expectedObsidianVersion,
);
assert.ok(expectedObsidian, `Obsidian ${expectedObsidianVersion} is outside the frozen native matrix.`);
const isPerformanceReference = (
	expectedOs.id === nativeMatrix.performanceReference.osId
	&& expectedObsidian.version === nativeMatrix.performanceReference.obsidianVersion
	&& expectedNode.version === nativeMatrix.performanceReference.nodeVersion
);
const platformIdentity = nativePlatformIdentityV1();
assert.equal(platformIdentity.osRef, expectedOsRef, 'Native runner does not match --expected-os-ref.');
assert.equal(process.platform, expectedOs.platform, 'Native runner platform does not match the frozen OS.');
assert.equal(process.arch, expectedOs.architecture, 'Native runner architecture does not match the frozen OS.');
assert.equal(
	platformIdentity.version,
	expectedOs.version,
	'Observed native OS patch/release does not match the frozen acceptance cell.',
);
if (expectedOs.build) {
	assert.equal(
		platformIdentity.build,
		expectedOs.build,
		'Observed Windows build does not match the frozen acceptance cell.',
	);
}
const tarballPath = path.resolve(tarballArgument);
const disposableVault = validateDisposableAcceptanceVaultV1(vaultArgument);
const vaultPath = disposableVault.vaultPath;
const tempRoot = await mkdtemp(path.join(tmpdir(), 'operon-cli-candidate-live-'));
const prefixRoot = path.join(tempRoot, 'prefix');
const env = {
	...process.env,
	npm_config_cache: path.join(tempRoot, 'npm-cache'),
	OPERON_CONFIG_HOME: path.join(tempRoot, 'config'),
};

try {
	const tarballBytes = await readFile(tarballPath);
	const tarballSha256 = createHash('sha256').update(tarballBytes).digest('hex');
	const candidateEvidenceBytes = await readFile(path.resolve(candidateEvidenceArgument));
	const candidateEvidenceSha256 = createHash('sha256')
		.update(candidateEvidenceBytes)
		.digest('hex');
	const candidateEvidence = JSON.parse(candidateEvidenceBytes.toString('utf8'));
	assert.ok(
		candidateEvidence.kind === 'operon-cli-release-candidate'
			|| candidateEvidence.kind === 'operon-cli-native-candidate',
		'Acceptance permits only a release candidate or an unpublished native candidate.',
	);
	assert.equal(candidateEvidence.source?.trackedTreeClean, true);
	assert.equal(candidateEvidence.sha256, tarballSha256);
	const expectedPlugin = candidateEvidence.compatiblePublicPlugin;
	assert.ok(
		expectedPlugin?.kind === 'operon-public-plugin-release'
			|| expectedPlugin?.kind === 'operon-plugin-native-candidate',
		'Acceptance requires digest-bound public or unpublished native plugin evidence.',
	);
	for (const [fileName, digestKey] of [
		['main.js', 'mainJsSha256'],
		['manifest.json', 'manifestSha256'],
		['styles.css', 'stylesCssSha256'],
	]) {
		const installedBytes = await readFile(
			path.join(vaultPath, '.obsidian/plugins/operon', fileName),
		);
		assert.equal(
			createHash('sha256').update(installedBytes).digest('hex'),
			expectedPlugin[digestKey],
			`Acceptance vault ${fileName} must match the candidate-bound Operon artifact.`,
		);
	}
	if (publicPluginRootArgument) {
		const publicPluginRoot = path.resolve(publicPluginRootArgument);
		for (const [fileName, digestKey] of [
			['main.js', 'mainJsSha256'],
			['manifest.json', 'manifestSha256'],
			['styles.css', 'stylesCssSha256'],
		]) {
			const publicBytes = await readFile(path.join(publicPluginRoot, fileName));
			assert.equal(
				createHash('sha256').update(publicBytes).digest('hex'),
				expectedPlugin[digestKey],
			);
		}
	}
	const nativeOperonArtifactRoot = path.join(tempRoot, 'operon-artifact');
	await mkdir(nativeOperonArtifactRoot, { recursive: true });
	const artifactSourceRoot = publicPluginRootArgument
		? path.resolve(publicPluginRootArgument)
		: path.join(vaultPath, '.obsidian/plugins/operon');
	for (const fileName of ['main.js', 'manifest.json', 'styles.css']) {
		await copyFile(
			path.join(artifactSourceRoot, fileName),
			path.join(nativeOperonArtifactRoot, fileName),
		);
	}
	execNpmV1(['install', '--global', '--prefix', prefixRoot, tarballPath], {
		env,
		stdio: 'inherit',
	});
	const executable = installedCliArtifactV1(prefixRoot, env);
	const version = runJson(executable, ['version', '--json']);
	const manifest = runJson(executable, ['manifest', '--json']);
	assert.equal(version.result.version, manifest.result.package.version);
	assert.equal(
		candidateEvidence.package,
		`${manifest.result.package.name}@${manifest.result.package.version}`,
	);
	const cliManifestPath = path.resolve(path.dirname(executable), '../cli-manifest-v1.json');
	const cliManifestBytes = await readFile(cliManifestPath);
	const cliManifestSha256 = createHash('sha256').update(cliManifestBytes).digest('hex');
	const cliManifestDocument = JSON.parse(cliManifestBytes.toString('utf8'));
	assert.equal(cliManifestDocument.contractDigest, manifest.result.contractDigest);
	if (candidateEvidence.kind === 'operon-cli-native-candidate') {
		assert.equal(candidateEvidence.cliManifestSha256, cliManifestSha256);
		assert.equal(
			candidateEvidence.aggregateContractSha256,
			cliManifestDocument.contractDigest,
		);
	}

	const resourcesBefore = await snapshotQuiescentReadOnlyResources(vaultPath);
	const health = runJson(executable, ['health', '--vault', vaultPath, '--json']);
	assert.equal(health.ok, true);
	assert.equal(health.result.lifecyclePhase, 'ready');
	assert.equal(health.result.v8PersistencePhase, 'idle');
	assert.equal(health.runtime.apiVersion, 1);
	assert.equal(health.runtime.plugin.version, expectedPlugin.pluginVersion);
	assert.equal(
		health.runtime.appVersion,
		expectedObsidianVersion,
		'Running Obsidian does not match the frozen acceptance cell.',
	);
	const officialObsidianCli = officialObsidianCliIdentityV1(expectedObsidianVersion);
	const capabilities = runJson(executable, ['capabilities', '--vault', vaultPath, '--json']);
	assert.equal(capabilities.ok, true);
	assert.equal(
		capabilities.result.find(item => item.id === 'tasks.finder')?.availability,
		'available',
	);
	const finderRequest = {
		contractVersion: 1,
		requestId: `candidate-finder-${randomUUID()}`,
		kind: 'task-finder',
		consistency: 'live-verified',
		filters: { checkbox: ['open'] },
		scope: 'normal',
		limit: 5,
	};
	const finder = runJson(
		executable,
		['finder', '--vault', vaultPath, '--input', '-', '--json'],
		Buffer.from(JSON.stringify(finderRequest), 'utf8'),
	);
	assert.equal(finder.ok, true);
	assert.ok(finder.result.rows.length <= 5);
	const doctor = runJson(executable, ['doctor', '--live', '--vault', vaultPath, '--json']);
	assert.equal(doctor.ok, true);
	assert.equal(doctor.result.security.secure, true);
	assert.equal(doctor.result.live?.ok, true);
	const diagnostics = runJson(executable, ['diagnostics', '--vault', vaultPath, '--json']);
	assert.equal(diagnostics.ok, true);
	const transport = diagnostics.result.transport;
	assert.ok(transport, 'Live diagnostics must publish transport diagnostics.');
	assert.equal(transport.available, true);
	assert.equal(transport.persistentTransportAvailable, true);
	assert.equal(transport.failureReason, undefined);
	assert.equal(
		transport.endpointKind,
		process.platform === 'win32' ? 'windows-named-pipe' : 'unix-domain-socket',
	);
	assert.equal(
		transport.securityBackend,
		process.platform === 'win32' ? 'windows-dacl' : 'posix-mode',
	);
	assert.deepEqual(doctor.result.live.result.transport, transport);
	const forbiddenOneShotBinary = path.join(
		tempRoot,
		'one-shot-fallback-must-not-run',
		process.platform === 'win32' ? 'obsidian.exe' : 'obsidian',
	);
	const singleRead = runCliJsonlV1(executable, [{
		id: 'persistent-single',
		argv: [
			'health',
			'--vault',
			vaultPath,
			'--obsidian-bin',
			forbiddenOneShotBinary,
			'--json',
		],
	}], env);
	assertSessionResults(singleRead, ['persistent-single']);
	const groupTwo = runReadGroup(executable, vaultPath, forbiddenOneShotBinary, 2);
	const groupEight = runReadGroup(executable, vaultPath, forbiddenOneShotBinary, 8);
	const resourcesAfter = await snapshotQuiescentReadOnlyResources(vaultPath);
	assert.deepEqual(resourcesAfter, resourcesBefore, 'Read-only acceptance changed canonical vault resources.');

	const proofEnvironment = {
		OPERON_CLI_EXECUTABLE: executable,
		OPERON_ACCEPTANCE_TARBALL: tarballPath,
		OPERON_ACCEPTANCE_CANDIDATE_EVIDENCE: path.resolve(candidateEvidenceArgument),
		OPERON_ACCEPTANCE_VAULT: vaultPath,
			OPERON_ACCEPTANCE_OBSIDIAN_BIN: officialObsidianCli.executable,
		OPERON_ACCEPTANCE_EXPECTED_OBSIDIAN_VERSION: expectedObsidianVersion,
		OPERON_ACCEPTANCE_EXPECTED_OS_REF: expectedOsRef,
		OPERON_DEVELOPER_API_ACCEPTANCE_CONSUMER_ROOT: path.join(
			pluginRoot,
			'scripts/agent-runtime/developer-api/native-acceptance-consumer',
		),
		OPERON_DEVELOPER_API_ACCEPTANCE_ORCHESTRATOR: path.join(
			pluginRoot,
			'scripts/agent-runtime/cli/run-native-developer-api-acceptance.mjs',
		),
		OPERON_SANITIZED_PLUGIN_ARTIFACT_ROOT: nativeOperonArtifactRoot,
	};
	const mutationProof = runAcceptanceProofV1({
			kind: profile === 'full' ? 'all-mutation-families' : 'node-compatibility-mutation',
			hookPath: mutationHookArgument,
			cwd: pluginRoot,
			env: proofEnvironment,
			cellId,
			profile,
			tarballSha256,
	});
	const mutationCompletion = mutationProof.result;
	assert.equal(mutationCompletion.skipped, 0);
	assert.equal(mutationCompletion.inconclusive, 0);
	assert.ok(
		Number.isSafeInteger(mutationCompletion.tests) && mutationCompletion.tests >= 1,
		'Mutation proof must report a positive executed test count.',
	);
	if (profile === 'full') {
		assert.equal(mutationCompletion.status, 'ok');
		assert.deepEqual(
			[...mutationCompletion.publishedFamilies].sort(),
			[
				'task.convert', 'task.create', 'task.delete', 'task.inline-relocate',
				'task.pinned-state', 'task.recurrence', 'task.relationship',
				'task.reminder-item', 'task.transition', 'task.update',
				'timer.control', 'timer.session',
			],
		);
		assert.equal(mutationCompletion.exactPostflight, true);
		assert.equal(mutationCompletion.receiptReplay, true);
	} else {
		for (const key of ['previewApplyReceiptReplay', 'postDispatchSamePlanRecovery']) {
			assert.equal(mutationCompletion[key], true, `Smoke mutation proof did not prove ${key}.`);
		}
	}
	const nativeProof = runAcceptanceProofV1({
		kind: profile === 'full' ? 'native-full-proof' : 'native-smoke-proof',
		hookPath: nativeProofHookArgument,
		cwd: pluginRoot,
		env: proofEnvironment,
		cellId,
		profile,
		tarballSha256,
	});
	const nativeResult = nativeProof.result;
	assert.equal(nativeResult.skipped, 0);
	assert.equal(nativeResult.inconclusive, 0);
	assert.ok(Number.isSafeInteger(nativeResult.tests) && nativeResult.tests >= 1);
	if (profile === 'full') {
		for (const key of [
			'interruptionRecovery',
			'restartSamePlanRecovery',
			'installRollbackReupgradeUninstall',
		]) assert.equal(nativeResult[key], true, `Native full proof did not prove ${key}.`);
		assert.deepEqual(nativeResult.interruption, {
			preDispatch: { exitCode: 130, recoveryPresent: false },
			postDispatch: {
				exitCode: 5,
				status: 'outcome-unknown',
				samePlanRecovery: true,
			},
		});
		assert.equal(nativeResult.developerApi?.status, 'passed');
		assert.equal(nativeResult.developerApi?.skipped ?? 0, 0);
		assert.equal(nativeResult.developerApi?.inconclusive ?? 0, 0);
		assert.match(
			nativeResult.developerApi?.consumerArtifactSha256 ?? '',
			/^[a-f0-9]{64}$/u,
		);
		for (const key of [
			'registryIdentity',
			'healthCapabilities',
			'exactRead',
			'previewApplyReplay',
			'recoveryRef',
		]) assert.equal(
			nativeResult.developerApi[key],
			true,
			`Native Developer API proof did not prove ${key}.`,
		);
		for (const [key, kind] of [
			['build', 'operon-developer-api-native-consumer-build'],
			['routine', 'operon-developer-api-native-consumer-output'],
			['recovery', 'operon-developer-api-native-consumer-output'],
			['commandTranscript', 'operon-developer-api-native-command-transcript'],
		]) {
			const raw = nativeResult.developerApi?.rawEvidence?.[key];
			assert.equal(raw?.kind, kind, `Native Developer API raw ${key} evidence kind changed.`);
			assert.ok(
				Number.isSafeInteger(raw?.bytes) && raw.bytes > 0,
				`Native Developer API raw ${key} evidence must report bytes.`,
			);
			assert.match(
				raw?.sha256 ?? '',
				/^[a-f0-9]{64}$/u,
				`Native Developer API raw ${key} evidence must be digest-bound.`,
			);
		}
		assert.equal(nativeResult.platformSecurity?.status, 'passed');
		assert.equal(nativeResult.platformSecurity?.skipped, 0);
		assert.equal(nativeResult.platformSecurity?.inconclusive, 0);
		const securityChecks = process.platform === 'win32'
			? [
				'sid-owner',
				'owner-only-dacl',
				'ancestor-reparse',
				'descriptor-tamper',
				'pipe-spoof',
				'hmac-replay',
				'cross-vault-isolation',
				'cross-user-isolation',
				'staging-expiry-capacity',
				'handshake-deadline',
			]
			: [
				'owner-identity',
				'owner-only-mode',
				'nofollow',
				'symlink-rejection',
				'hardlink-rejection',
				'socket-replacement',
			];
		for (const check of securityChecks) {
			assert.ok(
				nativeResult.platformSecurity.passedChecks?.includes(check),
				`Native platform security proof did not prove ${check}.`,
			);
		}
	} else {
		assert.equal(nativeResult.postDispatchSamePlanRecovery, true);
		assert.deepEqual(nativeResult.interruption, {
			postDispatch: {
				exitCode: 5,
				status: 'outcome-unknown',
				samePlanRecovery: true,
			},
		});
	}
	const resourcesAfterMutation = await snapshotQuiescentReadOnlyResources(vaultPath);
	const npmVersion = execNpmV1(['--version'], {
		env,
		encoding: 'utf8',
	}).trim();
	assert.equal(
		npmVersion,
		nativeMatrix.npmVersion,
		'Native acceptance must use the exact frozen npm version.',
	);
	const workflow = workflowEvidence(candidateEvidence);
	const commonPassed = { status: 'passed', skipped: 0, inconclusive: 0 };
	const portablePackage = {
		...commonPassed,
		tests: 8,
		installExactTarball: true,
		versionManifestDoctorHealth: true,
		cliManifestDigestVerified: true,
		aggregateContractDigestVerified: true,
	};
	const node24Full = profile === 'full'
		? {
			...commonPassed,
			tests: mutationCompletion.tests ?? nativeResult.tests,
			mutationFamilies: mutationCompletion.publishedFamilies,
			persistentSingleRead: true,
			orderedJsonlReadGroup: groupTwo.length === 2 && groupEight.length === 8,
			exactPostflight: mutationCompletion.exactPostflight === true,
			receiptReplay: mutationCompletion.receiptReplay === true,
			interruptionRecovery: nativeResult.interruptionRecovery === true,
			interruption: nativeResult.interruption,
			restartSamePlanRecovery: nativeResult.restartSamePlanRecovery === true,
			installRollbackReupgradeUninstall:
				nativeResult.installRollbackReupgradeUninstall === true,
			readOnlyResourcesUnchanged: true,
			developerApi: nativeResult.developerApi,
			platformSecurity: nativeResult.platformSecurity,
			performanceReference: isPerformanceReference
				? mutationCompletion.performanceReference
				: null,
		}
		: null;
	const compatibilitySmoke = profile === 'smoke'
		? {
			...commonPassed,
			tests: mutationCompletion.tests ?? nativeResult.tests,
			installExactTarball: true,
			versionManifestDoctorHealth: true,
			persistentRead: true,
			orderedJsonlReadGroup: groupTwo.length === 2 && groupEight.length === 8,
			previewApplyReceiptReplay: mutationCompletion.previewApplyReceiptReplay === true,
			postDispatchSamePlanRecovery:
				mutationCompletion.postDispatchSamePlanRecovery === true
				&& nativeResult.postDispatchSamePlanRecovery === true,
			interruption: nativeResult.interruption,
		}
		: null;
	const evidence = {
		evidenceVersion: 1,
		kind: 'operon-cli-native-acceptance-cell',
		cellId,
		status: 'passed',
		candidate: {
			candidateKind: candidateEvidence.kind,
			package: `${manifest.result.package.name}@${manifest.result.package.version}`,
			tarballSha256,
			candidateEvidenceSha256,
			sourceRef: candidateEvidence.source.ref,
			sourceCommit: candidateEvidence.source.commit,
			compatiblePublicPlugin: expectedPlugin,
			cliManifestSha256,
			aggregateContractSha256: cliManifestDocument.contractDigest,
			platforms: candidateEvidence.platforms,
		},
		environment: {
			os: acceptanceOsIdentity(platformIdentity, expectedOs),
			node: {
				major: Number(process.versions.node.split('.')[0]),
				version: process.version,
			},
			npmVersion,
			obsidian: {
				version: health.runtime.appVersion,
				build: health.runtime.appVersion,
			},
				officialObsidianCli: {
					enabled: true,
					version: expectedObsidianVersion,
					executableSha256: officialObsidianCli.executableSha256,
					identityBackend: officialObsidianCli.identityBackend,
					identityVerified: officialObsidianCli.identityVerified,
					identityDigest: officialObsidianCli.identityDigest,
					rawVersionSha256: createHash('sha256')
						.update(officialObsidianCli.rawVersion, 'utf8')
						.digest('hex'),
			},
		},
		runner: {
			labels: [...expectedOs.nativeRunnerLabels, expectedObsidian.runnerLabel],
		},
		transport: {
			endpointKind: transport.endpointKind,
			securityBackend: transport.securityBackend,
			persistentAvailable: transport.persistentTransportAvailable,
			failureReason: transport.failureReason ?? null,
		},
		suites: {
			portablePackage,
			node24Full,
			compatibilitySmoke,
		},
			vaultEvidence: {
				fixture: disposableVault.marker,
				before: resourcesBefore,
				after: resourcesAfterMutation,
				readOnlyPhaseUnchanged: true,
		},
		proofProviders: {
			mutation: { ...mutationProof.hook, outputSha256: mutationProof.outputSha256 },
			native: { ...nativeProof.hook, outputSha256: nativeProof.outputSha256 },
		},
		proofEvidence: {
			mutation: mutationCompletion,
			native: nativeResult,
		},
		workflow,
		publishPerformed: false,
	};
	await writeFile(path.resolve(outputArgument), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
	process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
} finally {
	await rm(tempRoot, { recursive: true, force: true });
}

function readRequired(name) {
	const index = args.indexOf(name);
	const value = index >= 0 ? args[index + 1] : undefined;
	assert.ok(value && !value.startsWith('--'), `${name} is required.`);
	return value;
}

function readOptional(name) {
	const index = args.indexOf(name);
	const value = index >= 0 ? args[index + 1] : undefined;
	if (index >= 0) {
		assert.ok(value && !value.startsWith('--'), `${name} requires a value.`);
	}
	return value;
}

function runJson(executable, commandArgs, input) {
	return runCliJsonV1(executable, commandArgs, env, input);
}

function runReadGroup(executable, vault, forbiddenOneShotBinary, size) {
	const ids = Array.from({ length: size }, (_, index) => `group-${size}-${index + 1}`);
	const responses = runCliJsonlV1(executable, [{
		id: `group-${size}`,
		reads: ids.map(id => ({
			id,
			argv: [
				'health',
				'--vault',
				vault,
				'--obsidian-bin',
				forbiddenOneShotBinary,
				'--json',
			],
		})),
	}], env);
	assertSessionResults(responses, ids);
	return responses;
}

function assertSessionResults(responses, expectedIds) {
	assert.deepEqual(responses.map(response => response.id), expectedIds);
	for (const response of responses) {
		assert.equal(response.exitCode, 0);
		assert.equal(response.result?.ok, true);
	}
}

function acceptanceOsIdentity(identity, expected) {
	return {
		id: expected.id,
		family: process.platform,
		platform: process.platform,
		version: identity.version,
		build: String(identity.build),
		kernel: identity.release,
		architecture: process.arch,
	};
}

function workflowEvidence(candidateEvidence) {
	const repository = process.env.GITHUB_REPOSITORY;
	const workflow = process.env.GITHUB_WORKFLOW_REF ?? process.env.GITHUB_WORKFLOW;
	const runId = process.env.GITHUB_RUN_ID;
	const runAttempt = Number(process.env.GITHUB_RUN_ATTEMPT);
	assert.ok(repository?.includes('/'), 'Native acceptance requires GITHUB_REPOSITORY.');
	assert.ok(workflow, 'Native acceptance requires GITHUB_WORKFLOW_REF or GITHUB_WORKFLOW.');
	assert.match(runId ?? '', /^[1-9][0-9]*$/u, 'Native acceptance requires GITHUB_RUN_ID.');
	assert.ok(
		Number.isSafeInteger(runAttempt) && runAttempt >= 1,
		'Native acceptance requires GITHUB_RUN_ATTEMPT.',
	);
	assert.match(candidateEvidence.source?.commit ?? '', /^[a-f0-9]{40}$/u);
	assert.ok(
		typeof candidateEvidence.source?.ref === 'string'
			&& candidateEvidence.source.ref.length > 0,
		'Candidate source ref is required even in unpublished no-tag acceptance mode.',
	);
	return {
		repository,
		workflow,
		runId,
		runAttempt,
		sourceRef: candidateEvidence.source.ref,
		sourceCommit: candidateEvidence.source.commit,
	};
}

async function snapshotReadOnlyResources(vaultPath) {
	const files = [];
	await addIfRegular(files, vaultPath, path.join(vaultPath, '.obsidian/plugins/operon/data.json'));
	await walkFiles(
		files,
		vaultPath,
		path.join(vaultPath, '.obsidian/plugins/operon/state'),
		filePath => filePath.endsWith('.json'),
	);
	await walkFiles(
		files,
		vaultPath,
		vaultPath,
		filePath => filePath.endsWith('.md'),
		relativePath => (
			relativePath === '.obsidian'
			|| relativePath.startsWith('.obsidian/')
			|| relativePath === '.git'
			|| relativePath.startsWith('.git/')
		),
	);
	files.sort((left, right) => left.localeCompare(right));
	const aggregate = createHash('sha256');
	for (const relativePath of files) {
		const bytes = await readFile(path.join(vaultPath, relativePath));
		aggregate.update(relativePath, 'utf8');
		aggregate.update('\0');
		aggregate.update(createHash('sha256').update(bytes).digest('hex'), 'utf8');
		aggregate.update('\0');
	}
	return {
		fileCount: files.length,
		sha256: aggregate.digest('hex'),
	};
}

async function snapshotQuiescentReadOnlyResources(vaultPath) {
	const deadline = Date.now() + 10_000;
	let previous = await snapshotReadOnlyResources(vaultPath);
	while (Date.now() < deadline) {
		await delay(500);
		const current = await snapshotReadOnlyResources(vaultPath);
		if (
			current.fileCount === previous.fileCount
			&& current.sha256 === previous.sha256
		) return current;
		previous = current;
	}
	throw new Error('Acceptance vault resources did not become quiescent within 10 seconds.');
}

async function walkFiles(files, vaultPath, directory, include, skip = () => false) {
	let entries;
	try {
		entries = await readdir(directory, { withFileTypes: true });
	} catch (error) {
		if (error?.code === 'ENOENT') return;
		throw error;
	}
	for (const entry of entries) {
		const filePath = path.join(directory, entry.name);
		const relativePath = path.relative(vaultPath, filePath).split(path.sep).join('/');
		if (skip(relativePath)) continue;
		if (entry.isSymbolicLink()) continue;
		if (entry.isDirectory()) {
			await walkFiles(files, vaultPath, filePath, include, skip);
		} else if (entry.isFile() && include(filePath)) {
			files.push(relativePath);
		}
	}
}

async function addIfRegular(files, vaultPath, filePath) {
	try {
		if ((await lstat(filePath)).isFile()) {
			files.push(path.relative(vaultPath, filePath).split(path.sep).join('/'));
		}
	} catch (error) {
		if (error?.code !== 'ENOENT') throw error;
	}
}
