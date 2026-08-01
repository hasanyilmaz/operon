import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export const NATIVE_ACCEPTANCE_CELL_KIND_V1 = 'operon-cli-native-acceptance-cell';
export const NATIVE_ACCEPTANCE_INDEX_KIND_V1 = 'operon-cli-native-acceptance-index';

const DIGEST = /^[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/u;
const REQUIRED_MUTATION_FAMILIES = Object.freeze([
	'task.convert',
	'task.create',
	'task.delete',
	'task.inline-relocate',
	'task.pinned-state',
	'task.recurrence',
	'task.relationship',
	'task.reminder-item',
	'task.transition',
	'task.update',
	'timer.control',
	'timer.session',
]);
const POSIX_SECURITY_CHECKS = Object.freeze([
	'owner-identity',
	'owner-only-mode',
	'nofollow',
	'symlink-rejection',
	'hardlink-rejection',
	'socket-replacement',
]);
const WINDOWS_SECURITY_CHECKS = Object.freeze([
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
]);
const CANONICAL_MATRIX_BYTES = await readFile(new URL(
	'../../../contracts/agent-runtime/native-acceptance-matrix-v1.json',
	import.meta.url,
));
const CANONICAL_MATRIX = JSON.parse(CANONICAL_MATRIX_BYTES.toString('utf8'));
export const NATIVE_ACCEPTANCE_MATRIX_SHA256_V1 = sha256(CANONICAL_MATRIX_BYTES);

export function cellIdV1(os, obsidian, nodeMajor) {
	return `${os.id}--obsidian-${obsidian.id}-${obsidian.version}--node-${nodeMajor}`;
}

export function validateNativeMatrixV1(matrix) {
	assert.deepEqual(
		matrix,
		CANONICAL_MATRIX,
		'Native acceptance matrix must exactly match the canonical frozen matrix.',
	);
	assert.equal(matrix?.matrixVersion, 1);
	assert.equal(matrix.kind, 'operon-cli-native-acceptance-freeze');
	assert.match(matrix.frozenAt, /^\d{4}-\d{2}-\d{2}$/u);
	assert.deepEqual(matrix.nodeVersions?.map(item => item.major), [22, 24, 26]);
	assert.deepEqual(
		matrix.nodeVersions.map(item => item.version),
		['22.23.1', '24.18.0', '26.5.0'],
	);
	assert.deepEqual(
		matrix.nodeVersions.map(item => item.nativeProfile),
		['smoke', 'full', 'smoke'],
	);
	assert.equal(matrix.npmVersion, '11.12.1');
	assert.equal(matrix.operatingSystems?.length, 6);
	assert.deepEqual(
		countBy(matrix.operatingSystems, item => item.platform),
		{ darwin: 3, linux: 2, win32: 1 },
	);
	assert.equal(new Set(matrix.operatingSystems.map(item => item.id)).size, 6);
	for (const os of matrix.operatingSystems) {
		assert.match(os.id, /^[a-z0-9.-]+$/u);
		assert.ok(['darwin', 'linux', 'win32'].includes(os.platform));
		assert.ok(typeof os.version === 'string' && os.version.length > 0);
		assert.ok(['x64', 'arm64'].includes(os.architecture));
		assert.ok([
			'sw-vers-build',
			'kernel-release',
			'windows-build',
		].includes(os.buildIdentity?.kind));
		assert.ok(['frozen', 'freeze-required'].includes(os.buildIdentity?.status));
		if (os.buildIdentity.status === 'frozen') {
			assert.ok(typeof os.buildIdentity.value === 'string' && os.buildIdentity.value.length > 0);
		} else {
			assert.equal(os.buildIdentity.value, null);
		}
	}
	assert.deepEqual(matrix.obsidianVersions?.map(item => item.id), ['minimum', 'current-stable']);
	assert.equal(matrix.obsidianVersions[0].version, '1.12.2');
	assert.match(matrix.obsidianVersions[1].version, SEMVER);
	assert.notEqual(matrix.obsidianVersions[1].version, '1.12.2');
	assert.deepEqual(matrix.performanceReference, {
		osId: 'macos-26.5.2-arm64',
		obsidianVersion: '1.12.7',
		nodeVersion: '24.18.0',
		thresholdsMs: {
			previewP95Exclusive: 100,
			routineApplyP95Exclusive: 2000,
			otherApplyP95Exclusive: 3000,
		},
	});
	return matrix;
}

export function assertNativeBuildIdentitiesFrozenV1(matrix) {
	validateNativeMatrixV1(matrix);
	const unresolved = matrix.operatingSystems
		.filter(os => os.buildIdentity.status !== 'frozen')
		.map(os => os.id);
	assert.deepEqual(
		unresolved,
		[],
		`Native OS build/image identities must be frozen before dispatch: ${unresolved.join(', ')}.`,
	);
}

export async function loadCanonicalNativeMatrixV1(matrixPath) {
	const bytes = await readFile(matrixPath);
	assert.equal(
		sha256(bytes),
		NATIVE_ACCEPTANCE_MATRIX_SHA256_V1,
		'Native acceptance matrix bytes differ from the canonical freeze.',
	);
	return validateNativeMatrixV1(JSON.parse(bytes.toString('utf8')));
}

export function isGitSourceCleanV1(repositoryRoot) {
	return execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
		cwd: repositoryRoot,
		encoding: 'utf8',
	}).trim() === '';
}

export function expectedCellsV1(matrix) {
	validateNativeMatrixV1(matrix);
	return matrix.operatingSystems.flatMap(os => (
		matrix.obsidianVersions.flatMap(obsidian => (
			matrix.nodeVersions.map(({ major: nodeMajor, version: nodeVersion }) => ({
				cellId: cellIdV1(os, obsidian, nodeMajor),
				os,
				obsidian,
				nodeMajor,
				nodeVersion,
				npmVersion: matrix.npmVersion,
				runnerLabels: [...os.nativeRunnerLabels, obsidian.runnerLabel],
				performanceReference: (
					os.id === matrix.performanceReference.osId
					&& obsidian.version === matrix.performanceReference.obsidianVersion
					&& nodeVersion === matrix.performanceReference.nodeVersion
				),
				performanceThresholds: matrix.performanceReference.thresholdsMs,
			}))
		))
	));
}

export async function loadCandidateBindingV1(candidateRoot) {
	const evidencePath = path.join(candidateRoot, 'candidate-evidence.json');
	const bytes = await readFile(evidencePath);
	const evidence = JSON.parse(bytes.toString('utf8'));
	assert.ok(
		evidence.kind === 'operon-cli-release-candidate'
			|| evidence.kind === 'operon-cli-native-candidate',
	);
	assert.match(evidence.sha256, DIGEST);
	assert.match(evidence.source?.commit ?? '', COMMIT);
	if (evidence.kind === 'operon-cli-release-candidate') {
		assert.match(
			evidence.source?.ref ?? '',
			/^cli-v[0-9]+\.[0-9]+\.[0-9]+$/u,
		);
	} else {
		assert.ok(
			typeof evidence.source?.ref === 'string' && evidence.source.ref.length > 0,
			'Native candidate evidence requires an exact commit or source ref.',
		);
	}
	assert.equal(evidence.source?.trackedTreeClean, true);
	assert.ok(
		evidence.compatiblePublicPlugin?.kind === 'operon-public-plugin-release'
			|| evidence.compatiblePublicPlugin?.kind === 'operon-plugin-native-candidate',
	);
	assert.equal(evidence.compatiblePublicPlugin.pluginId, 'operon');
	if (evidence.compatiblePublicPlugin.kind === 'operon-public-plugin-release') {
		assert.equal(evidence.compatiblePublicPlugin.evidenceVersion, 2);
	}
	for (const key of ['mainJsSha256', 'manifestSha256', 'stylesCssSha256']) {
		assert.match(evidence.compatiblePublicPlugin[key] ?? '', DIGEST);
	}
	assert.match(evidence.compatiblePublicPlugin.pluginVersion ?? '', SEMVER);
	if (evidence.compatiblePublicPlugin.kind === 'operon-plugin-native-candidate') {
		assert.match(evidence.compatiblePublicPlugin.sourceCommit ?? '', COMMIT);
		assert.equal(evidence.compatiblePublicPlugin.sourceCommit, evidence.source.commit);
	} else {
		assert.match(evidence.compatiblePublicPlugin.releaseTag ?? '', SEMVER);
	}
	assert.equal(
		evidence.compatiblePublicPlugin.kind,
		evidence.kind === 'operon-cli-native-candidate'
			? 'operon-plugin-native-candidate'
			: 'operon-public-plugin-release',
		'Candidate and compatible plugin evidence kinds do not match.',
	);
	const tarballs = (await readdir(candidateRoot)).filter(name => name.endsWith('.tgz'));
	assert.deepEqual(tarballs, [evidence.tarball]);
	const tarballBytes = await readFile(path.join(candidateRoot, evidence.tarball));
	assert.equal(sha256(tarballBytes), evidence.sha256);
	assert.match(evidence.cliManifestSha256 ?? '', DIGEST);
	assert.match(evidence.aggregateContractSha256 ?? '', DIGEST);
	assert.deepEqual(Object.keys(evidence.platforms ?? {}).sort(), [
		'darwin',
		'linux',
		'win32',
		'wsl',
	]);
	assert.ok(['supported', 'acceptance-required'].includes(evidence.platforms.darwin));
	assert.ok(['supported', 'acceptance-required'].includes(evidence.platforms.linux));
	assert.ok(['supported', 'acceptance-required'].includes(evidence.platforms.win32));
	assert.equal(evidence.platforms.wsl, 'unsupported');
	return {
		evidence,
		binding: {
			candidateKind: evidence.kind,
			package: evidence.package,
			tarballSha256: evidence.sha256,
			candidateEvidenceSha256: sha256(bytes),
			sourceRef: evidence.source.ref,
			sourceCommit: evidence.source.commit,
			compatiblePublicPlugin: evidence.compatiblePublicPlugin,
			...(evidence.cliManifestSha256
				? { cliManifestSha256: evidence.cliManifestSha256 }
				: {}),
				...(evidence.aggregateContractSha256
					? { aggregateContractSha256: evidence.aggregateContractSha256 }
					: {}),
				platforms: evidence.platforms,
		},
	};
}

export function validateNativeCellV1(cell, expected, candidateBinding) {
	assert.equal(cell?.evidenceVersion, 1);
	assert.equal(cell.kind, NATIVE_ACCEPTANCE_CELL_KIND_V1);
	assert.equal(cell.cellId, expected.cellId);
	assert.equal(cell.status, 'passed');
	assert.equal(cell.publishPerformed, false);
	assert.equal(cell.candidate?.candidateKind, candidateBinding.candidateKind);
	assert.equal(cell.candidate?.package, candidateBinding.package);
	assert.equal(cell.candidate?.tarballSha256, candidateBinding.tarballSha256);
	assert.equal(cell.candidate?.candidateEvidenceSha256, candidateBinding.candidateEvidenceSha256);
	assert.equal(cell.candidate?.sourceRef, candidateBinding.sourceRef);
	assert.equal(cell.candidate?.sourceCommit, candidateBinding.sourceCommit);
	assert.deepEqual(cell.candidate?.compatiblePublicPlugin, candidateBinding.compatiblePublicPlugin);
	assert.match(cell.candidate?.cliManifestSha256 ?? '', DIGEST);
	assert.match(cell.candidate?.aggregateContractSha256 ?? '', DIGEST);
	if (candidateBinding.cliManifestSha256) {
		assert.equal(cell.candidate.cliManifestSha256, candidateBinding.cliManifestSha256);
	}
	if (candidateBinding.aggregateContractSha256) {
		assert.equal(cell.candidate.aggregateContractSha256, candidateBinding.aggregateContractSha256);
	}
	assert.deepEqual(cell.candidate?.platforms, candidateBinding.platforms);

	const os = cell.environment?.os;
	assert.equal(os?.id, expected.os.id);
	assert.equal(os?.family, expected.os.family);
	assert.equal(os?.platform, expected.os.platform);
	assert.equal(os?.version, expected.os.version);
	assert.ok(typeof os?.build === 'string' && os.build.length > 0);
	assert.ok(typeof os?.kernel === 'string' && os.kernel.length > 0);
	assert.equal(os?.architecture, expected.os.architecture);
	if (expected.os.buildIdentity.status === 'frozen') {
		const observedBuildIdentity = expected.os.buildIdentity.kind === 'kernel-release'
			? os?.kernel
			: os?.build;
		assert.equal(
			observedBuildIdentity,
			expected.os.buildIdentity.value,
			`Observed ${expected.os.id} build identity differs from the freeze.`,
		);
	}
	assert.equal(cell.environment?.node?.major, expected.nodeMajor);
	assert.equal(cell.environment?.node?.version, `v${expected.nodeVersion}`);
	assert.equal(cell.environment?.npmVersion, expected.npmVersion);
	assert.equal(cell.environment?.obsidian?.version, expected.obsidian.version);
	assert.ok(typeof cell.environment?.obsidian?.build === 'string' && cell.environment.obsidian.build.length > 0);
	assert.equal(cell.environment?.officialObsidianCli?.enabled, true);
	assert.equal(cell.environment?.officialObsidianCli?.version, expected.obsidian.version);
	assert.match(cell.environment?.officialObsidianCli?.rawVersionSha256 ?? '', DIGEST);
	assert.deepEqual(cell.runner?.labels, expected.runnerLabels);

	validateVaultEvidence(cell.vaultEvidence);
	validateProofProviders(cell.proofProviders);

	const expectedEndpoint = expected.os.platform === 'win32'
		? 'windows-named-pipe'
		: 'unix-domain-socket';
	const expectedSecurity = expected.os.platform === 'win32' ? 'windows-dacl' : 'posix-mode';
	assert.equal(cell.transport?.endpointKind, expectedEndpoint);
	assert.equal(cell.transport?.securityBackend, expectedSecurity);
	assert.equal(cell.transport?.persistentAvailable, true);
	assert.equal(cell.transport?.failureReason, null);

	validatePassedSuite(cell.suites?.portablePackage, 'portablePackage');
	if (expected.nodeMajor === 24) {
		assert.equal(cell.suites?.compatibilitySmoke, null);
		validateNode24Full(cell.suites?.node24Full, expected);
		validateFullProofEvidence(cell.proofEvidence, cell.suites.node24Full);
	} else {
		assert.equal(cell.suites?.node24Full, null);
		validateCompatibilitySmoke(cell.suites?.compatibilitySmoke);
		validateSmokeProofEvidence(cell.proofEvidence, cell.suites.compatibilitySmoke);
	}
	assertNoSkippedOrInconclusive(cell.suites);

	const workflow = cell.workflow;
	assert.ok(typeof workflow?.repository === 'string' && workflow.repository.includes('/'));
	assert.ok(typeof workflow?.workflow === 'string' && workflow.workflow.length > 0);
	assert.match(String(workflow?.runId ?? ''), /^[1-9][0-9]*$/u);
	assert.ok(Number.isSafeInteger(workflow?.runAttempt) && workflow.runAttempt >= 1);
	assert.equal(workflow?.sourceRef, candidateBinding.sourceRef);
	assert.equal(workflow?.sourceCommit, candidateBinding.sourceCommit);
	return cell;
}

export async function buildNativeAcceptanceIndexV1({
	candidateRoot,
	candidateBinding,
	matrix,
	cellRoot,
	generatedAt = new Date().toISOString(),
}) {
	const binding = candidateBinding
		?? (await loadCandidateBindingV1(candidateRoot)).binding;
	const promotionEligible = (
		binding.platforms.darwin === 'supported'
		&& binding.platforms.linux === 'supported'
		&& binding.platforms.win32 === 'supported'
		&& binding.platforms.wsl === 'unsupported'
	);
	const required = expectedCellsV1(matrix);
	const jsonFiles = (await readdir(cellRoot))
		.filter(name => (
			name.startsWith('native-acceptance-')
			&& name.endsWith('.json')
			&& name !== 'native-acceptance-index.json'
		))
		.sort();
	assert.equal(jsonFiles.length, required.length, 'Native acceptance requires exactly 36 cell files.');
	const expectedById = new Map(required.map(cell => [cell.cellId, cell]));
	const seen = new Set();
	const cells = [];
	let cliManifestSha256 = null;
	let aggregateContractSha256 = null;
	for (const evidenceFile of jsonFiles) {
		assert.equal(path.basename(evidenceFile), evidenceFile);
		const bytes = await readFile(path.join(cellRoot, evidenceFile));
		const cell = JSON.parse(bytes.toString('utf8'));
		const expected = expectedById.get(cell.cellId);
		assert.ok(expected, `Unknown native acceptance cell ${String(cell.cellId)}.`);
		assert.equal(seen.has(cell.cellId), false, `Duplicate native acceptance cell ${cell.cellId}.`);
		seen.add(cell.cellId);
		validateNativeCellV1(cell, expected, binding);
		cliManifestSha256 ??= cell.candidate.cliManifestSha256;
		aggregateContractSha256 ??= cell.candidate.aggregateContractSha256;
		assert.equal(cell.candidate.cliManifestSha256, cliManifestSha256);
		assert.equal(cell.candidate.aggregateContractSha256, aggregateContractSha256);
		cells.push({
			cellId: cell.cellId,
			evidenceFile,
			sha256: sha256(bytes),
			osId: expected.os.id,
			obsidianVersion: expected.obsidian.version,
			nodeMajor: expected.nodeMajor,
			workflow: {
				runId: String(cell.workflow.runId),
				runAttempt: cell.workflow.runAttempt,
			},
		});
	}
	assert.equal(seen.size, required.length);
	cells.sort((left, right) => left.cellId.localeCompare(right.cellId));
	return {
		evidenceVersion: 1,
		kind: NATIVE_ACCEPTANCE_INDEX_KIND_V1,
		status: 'passed',
		generatedAt,
		candidate: {
			...binding,
			cliManifestSha256,
			aggregateContractSha256,
		},
		matrixSha256: NATIVE_ACCEPTANCE_MATRIX_SHA256_V1,
		matrix,
		cells,
		summary: {
			requiredCells: 36,
			passedCells: 36,
			failedCells: 0,
			skippedAssertions: 0,
			inconclusiveAssertions: 0,
			node24FullCells: 12,
			nodeCompatibilitySmokeCells: 24,
			developerApiNativeCells: 12,
		},
		promotionEligible,
		publishPerformed: false,
	};
}

export async function verifyNativeAcceptanceBundleV1(candidateRoot, acceptanceRoot) {
	const indexPath = path.join(acceptanceRoot, 'native-acceptance-index.json');
	const index = JSON.parse(await readFile(indexPath, 'utf8'));
	assert.equal(index.kind, NATIVE_ACCEPTANCE_INDEX_KIND_V1);
	assert.equal(index.status, 'passed');
	assert.match(index.generatedAt, /^\d{4}-\d{2}-\d{2}T/u);
	assert.equal(index.matrixSha256, NATIVE_ACCEPTANCE_MATRIX_SHA256_V1);
	validateNativeMatrixV1(index.matrix);
	const { binding: currentCandidate } = await loadCandidateBindingV1(candidateRoot);
	assertStableCandidateIdentityV1(index.candidate, currentCandidate);
	const rebuilt = await buildNativeAcceptanceIndexV1({
		candidateBinding: index.candidate,
		matrix: index.matrix,
		cellRoot: acceptanceRoot,
		generatedAt: index.generatedAt,
	});
	assert.deepEqual(index, rebuilt);
	return index;
}

export function assertStableCandidateIdentityV1(accepted, current) {
	if (
		accepted.candidateKind === 'operon-cli-native-candidate'
		&& current.candidateKind === 'operon-cli-release-candidate'
	) {
		assert.match(current.sourceRef ?? '', /^cli-v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/u);
		assert.equal(
			current.sourceRef,
			`cli-v${accepted.package.slice(accepted.package.lastIndexOf('@') + 1)}`,
			'Release transition source ref does not match the accepted package version.',
		);
		for (const key of [
			'package',
			'tarballSha256',
				'sourceCommit',
				'cliManifestSha256',
				'aggregateContractSha256',
		]) {
			assert.equal(current[key], accepted[key], `Native-to-release candidate ${key} changed.`);
			}
			assert.deepEqual(current.platforms, accepted.platforms);
		assert.equal(
			accepted.compatiblePublicPlugin?.kind,
			'operon-plugin-native-candidate',
		);
		assert.equal(
			current.compatiblePublicPlugin?.kind,
			'operon-public-plugin-release',
		);
		for (const key of [
			'pluginId',
			'pluginVersion',
			'mainJsSha256',
			'manifestSha256',
			'stylesCssSha256',
		]) {
			assert.equal(
				current.compatiblePublicPlugin?.[key],
				accepted.compatiblePublicPlugin?.[key],
				`Native-to-release plugin ${key} changed.`,
			);
		}
		return;
	}
	assert.equal(
		current.candidateKind,
		accepted.candidateKind,
		'Native acceptance candidate kind changed outside the allowed release transition.',
	);
	for (const key of [
		'package',
		'tarballSha256',
		'candidateEvidenceSha256',
		'sourceRef',
		'sourceCommit',
		'cliManifestSha256',
		'aggregateContractSha256',
	]) {
		assert.equal(current[key], accepted[key], `Native acceptance candidate ${key} changed.`);
	}
	assert.deepEqual(
		current.compatiblePublicPlugin,
		accepted.compatiblePublicPlugin,
		'Native acceptance compatible plugin identity changed.',
	);
	assert.deepEqual(current.platforms, accepted.platforms);
}

function validateNode24Full(suite, expected) {
	validatePassedSuite(suite, 'node24Full');
	assert.deepEqual([...suite.mutationFamilies].sort(), REQUIRED_MUTATION_FAMILIES);
	for (const key of [
		'persistentSingleRead',
		'orderedJsonlReadGroup',
		'exactPostflight',
		'receiptReplay',
		'restartSamePlanRecovery',
		'installRollbackReupgradeUninstall',
		'readOnlyResourcesUnchanged',
	]) assert.equal(suite[key], true, `Node 24 full suite did not prove ${key}.`);
	validateInterruptionEvidence(suite.interruption, true);
	const developer = suite.developerApi;
	assert.equal(developer?.status, 'passed');
	assert.match(developer?.consumerArtifactSha256 ?? '', DIGEST);
	for (const key of ['registryIdentity', 'healthCapabilities', 'exactRead', 'previewApplyReplay', 'recoveryRef']) {
		assert.equal(developer?.[key], true, `Developer API did not prove ${key}.`);
	}
	const security = suite.platformSecurity;
	assert.equal(security?.status, 'passed');
	assert.equal(security?.skipped, 0);
	assert.equal(security?.inconclusive, 0);
	const required = expected.os.platform === 'win32' ? WINDOWS_SECURITY_CHECKS : POSIX_SECURITY_CHECKS;
	for (const check of required) {
		assert.ok(security.passedChecks?.includes(check), `Platform security did not prove ${check}.`);
	}
	if (expected.performanceReference) {
		validatePerformanceReference(suite.performanceReference, expected.performanceThresholds);
	} else {
		assert.equal(
			suite.performanceReference,
			null,
			'Only the frozen reference cell may provide performance reference evidence.',
		);
	}
}

function validatePerformanceReference(reference, thresholds) {
	assert.equal(reference?.status, 'passed');
	assert.ok(Number.isSafeInteger(reference?.samples) && reference.samples >= 20);
	assert.ok(
		Number.isFinite(reference?.previewP95Ms)
			&& reference.previewP95Ms >= 0
			&& reference.previewP95Ms < thresholds.previewP95Exclusive,
		'Reference preview p95 exceeded the frozen threshold.',
	);
	assert.ok(
		Number.isFinite(reference?.routineApplyP95Ms)
			&& reference.routineApplyP95Ms >= 0
			&& reference.routineApplyP95Ms < thresholds.routineApplyP95Exclusive,
		'Reference routine apply p95 exceeded the frozen threshold.',
	);
	assert.ok(
		Number.isFinite(reference?.otherApplyP95Ms)
			&& reference.otherApplyP95Ms >= 0
			&& reference.otherApplyP95Ms < thresholds.otherApplyP95Exclusive,
		'Reference other apply p95 exceeded the frozen threshold.',
	);
}

function validateVaultEvidence(evidence) {
	for (const phase of ['before', 'after']) {
		assert.ok(Number.isSafeInteger(evidence?.[phase]?.fileCount));
		assert.ok(evidence[phase].fileCount >= 0);
		assert.match(evidence[phase].sha256 ?? '', DIGEST);
	}
	assert.equal(evidence.readOnlyPhaseUnchanged, true);
}

function validateProofProviders(providers) {
	for (const key of ['mutation', 'native']) {
		const provider = providers?.[key];
		assert.ok(
			typeof provider?.path === 'string'
				&& provider.path.startsWith('scripts/agent-runtime/')
				&& !provider.path.split('/').includes('..'),
			`${key} proof provider must be a repository-relative agent-runtime path.`,
		);
		assert.match(provider.sha256 ?? '', DIGEST);
		assert.match(provider.outputSha256 ?? '', DIGEST);
	}
}

function validateFullProofEvidence(evidence, suite) {
	const mutation = evidence?.mutation;
	const native = evidence?.native;
	assert.equal(mutation?.status, 'ok');
	assert.equal(mutation?.tests, suite.tests);
	assert.equal(mutation?.skipped, 0);
	assert.equal(mutation?.inconclusive, 0);
	assert.deepEqual([...mutation.publishedFamilies].sort(), [...suite.mutationFamilies].sort());
	assert.equal(mutation.exactPostflight, suite.exactPostflight);
	assert.equal(mutation.receiptReplay, suite.receiptReplay);
	assert.equal(native?.skipped, 0);
	assert.equal(native?.inconclusive, 0);
	assert.deepEqual(native.interruption, suite.interruption);
	assert.equal(native.restartSamePlanRecovery, suite.restartSamePlanRecovery);
	assert.equal(
		native.installRollbackReupgradeUninstall,
		suite.installRollbackReupgradeUninstall,
	);
	assert.deepEqual(native.developerApi, suite.developerApi);
	assert.deepEqual(native.platformSecurity, suite.platformSecurity);
}

function validateSmokeProofEvidence(evidence, suite) {
	const mutation = evidence?.mutation;
	const native = evidence?.native;
	assert.equal(mutation?.tests, suite.tests);
	assert.equal(mutation?.skipped, 0);
	assert.equal(mutation?.inconclusive, 0);
	assert.equal(mutation.previewApplyReceiptReplay, suite.previewApplyReceiptReplay);
	assert.equal(mutation.postDispatchSamePlanRecovery, true);
	assert.equal(native?.skipped, 0);
	assert.equal(native?.inconclusive, 0);
	assert.equal(native.postDispatchSamePlanRecovery, true);
	assert.deepEqual(native.interruption, suite.interruption);
}

function validateCompatibilitySmoke(suite) {
	validatePassedSuite(suite, 'compatibilitySmoke');
	for (const key of [
		'installExactTarball',
		'versionManifestDoctorHealth',
		'persistentRead',
		'orderedJsonlReadGroup',
		'previewApplyReceiptReplay',
	]) assert.equal(suite[key], true, `Compatibility smoke did not prove ${key}.`);
	validateInterruptionEvidence(suite.interruption, false);
}

function validateInterruptionEvidence(interruption, requirePreDispatch) {
	if (requirePreDispatch) {
		assert.deepEqual(interruption?.preDispatch, {
			exitCode: 130,
			recoveryPresent: false,
		});
	}
	assert.deepEqual(interruption?.postDispatch, {
		exitCode: 5,
		status: 'outcome-unknown',
		samePlanRecovery: true,
	});
}

function validatePassedSuite(suite, name) {
	assert.equal(suite?.status, 'passed', `${name} did not pass.`);
	assert.ok(Number.isSafeInteger(suite?.tests) && suite.tests >= 1);
	assert.equal(suite?.skipped, 0, `${name} skipped assertions.`);
	assert.equal(suite?.inconclusive, 0, `${name} has inconclusive assertions.`);
}

function assertNoSkippedOrInconclusive(value, currentPath = 'suites') {
	if (Array.isArray(value)) {
		value.forEach((item, index) => assertNoSkippedOrInconclusive(item, `${currentPath}/${index}`));
		return;
	}
	if (!value || typeof value !== 'object') return;
	for (const [key, child] of Object.entries(value)) {
		if (key === 'skipped' || key === 'inconclusive') {
			assert.equal(child, 0, `${currentPath}/${key} must be zero.`);
		}
		assertNoSkippedOrInconclusive(child, `${currentPath}/${key}`);
	}
}

function countBy(items, keyFor) {
	return items.reduce((counts, item) => {
		const key = keyFor(item);
		counts[key] = (counts[key] ?? 0) + 1;
		return counts;
	}, {});
}

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}
