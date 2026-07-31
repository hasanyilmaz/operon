import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';

import {
	assertNativeBuildIdentitiesFrozenV1,
	assertStableCandidateIdentityV1,
	buildNativeAcceptanceIndexV1,
	expectedCellsV1,
	isGitSourceCleanV1,
	loadCanonicalNativeMatrixV1,
	loadCandidateBindingV1,
	NATIVE_ACCEPTANCE_MATRIX_SHA256_V1,
	verifyNativeAcceptanceBundleV1,
} from './native-acceptance-lib.mjs';

const matrix = JSON.parse(await readFile(
	new URL('../../../contracts/agent-runtime/native-acceptance-matrix-v1.json', import.meta.url),
	'utf8',
));
const evidenceSchema = JSON.parse(await readFile(
	new URL('../../../contracts/agent-runtime/native-acceptance-v1.schema.json', import.meta.url),
	'utf8',
));
const validateEvidence = new Ajv2020({ strict: false }).compile(evidenceSchema);

test('36 digest-bound native cells produce one promotion-eligible aggregate', async () => {
	const fixture = await createFixture();
	try {
		const index = await buildNativeAcceptanceIndexV1({
			candidateRoot: fixture.candidateRoot,
			matrix,
			cellRoot: fixture.acceptanceRoot,
			generatedAt: '2026-07-30T12:00:00.000Z',
		});
		assert.equal(index.cells.length, 36);
		assert.equal(index.summary.node24FullCells, 12);
		assert.equal(index.summary.nodeCompatibilitySmokeCells, 24);
		assert.equal(index.summary.developerApiNativeCells, 12);
		assert.equal(index.promotionEligible, true);
		assert.equal(validateEvidence(index), true, JSON.stringify(validateEvidence.errors));
		await writeFile(
			path.join(fixture.acceptanceRoot, 'native-acceptance-index.json'),
			`${JSON.stringify(index, null, 2)}\n`,
		);
		assert.deepEqual(
			await verifyNativeAcceptanceBundleV1(fixture.candidateRoot, fixture.acceptanceRoot),
			index,
		);
		const nativeEvidence = JSON.parse(await readFile(
			path.join(fixture.candidateRoot, 'candidate-evidence.json'),
			'utf8',
		));
		await writeFile(
			path.join(fixture.candidateRoot, 'candidate-evidence.json'),
			`${JSON.stringify({
				...nativeEvidence,
				kind: 'operon-cli-release-candidate',
				source: { ...nativeEvidence.source, ref: 'cli-v1.0.0' },
				compatiblePublicPlugin: {
					...nativeEvidence.compatiblePublicPlugin,
					kind: 'operon-public-plugin-release',
					releaseTag: '3.0.0',
				},
			}, null, 2)}\n`,
		);
		assert.deepEqual(
			await verifyNativeAcceptanceBundleV1(fixture.candidateRoot, fixture.acceptanceRoot),
			index,
			'The explicit byte-identical native-to-tagged-release transition must retain acceptance.',
		);
	} finally {
		await rm(fixture.root, { recursive: true, force: true });
	}
});

test('aggregate is bound to canonical matrix bytes, digest and exact frozen contents', async () => {
	const fixture = await createFixture();
	try {
		const canonicalPath = new URL(
			'../../../contracts/agent-runtime/native-acceptance-matrix-v1.json',
			import.meta.url,
		);
		assert.deepEqual(await loadCanonicalNativeMatrixV1(canonicalPath), matrix);
		const reformattedPath = path.join(fixture.root, 'reformatted-matrix.json');
		await writeFile(reformattedPath, JSON.stringify(matrix));
		await assert.rejects(
			loadCanonicalNativeMatrixV1(reformattedPath),
			/matrix bytes differ/u,
		);
		const changedMatrix = structuredClone(matrix);
		changedMatrix.nodeVersions[1].version = '24.18.1';
		await assert.rejects(
			buildNativeAcceptanceIndexV1({
				candidateRoot: fixture.candidateRoot,
				matrix: changedMatrix,
				cellRoot: fixture.acceptanceRoot,
			}),
			/exactly match the canonical frozen matrix/u,
		);
		const index = await buildNativeAcceptanceIndexV1({
			candidateRoot: fixture.candidateRoot,
			matrix,
			cellRoot: fixture.acceptanceRoot,
		});
		assert.equal(index.matrixSha256, NATIVE_ACCEPTANCE_MATRIX_SHA256_V1);
	} finally {
		await rm(fixture.root, { recursive: true, force: true });
	}
});

test('native dispatch fails closed until every OS build or image identity is frozen', () => {
	assert.throws(
		() => assertNativeBuildIdentitiesFrozenV1(matrix),
		/build\/image identities must be frozen/u,
	);
});

test('pre-promotion aggregate is retained but cannot become promotion-eligible', async () => {
	const fixture = await createFixture({
		darwin: 'supported',
		linux: 'acceptance-required',
		win32: 'supported',
		wsl: 'unsupported',
	});
	try {
		const index = await buildNativeAcceptanceIndexV1({
			candidateRoot: fixture.candidateRoot,
			matrix,
			cellRoot: fixture.acceptanceRoot,
		});
		assert.equal(index.status, 'passed');
		assert.equal(index.promotionEligible, false);
	} finally {
		await rm(fixture.root, { recursive: true, force: true });
	}
});

test('offline candidate comparison rejects every critical identity change', async () => {
	const fixture = await createFixture();
	try {
		const accepted = structuredClone(fixture.binding);
		const mutations = [
			current => { current.candidateEvidenceSha256 = '9'.repeat(64); },
			current => { current.sourceRef = 'cli-v1.0.0'; },
			current => { current.cliManifestSha256 = '8'.repeat(64); },
			current => { current.aggregateContractSha256 = '7'.repeat(64); },
			current => { current.compatiblePublicPlugin.kind = 'operon-public-plugin-release'; },
			current => { current.compatiblePublicPlugin.sourceCommit = 'b'.repeat(40); },
		];
		for (const mutate of mutations) {
			const current = structuredClone(accepted);
			mutate(current);
			assert.throws(() => assertStableCandidateIdentityV1(accepted, current));
		}
		const release = structuredClone(accepted);
		release.candidateKind = 'operon-cli-release-candidate';
		release.candidateEvidenceSha256 = '9'.repeat(64);
		release.sourceRef = 'cli-v1.0.0';
		release.compatiblePublicPlugin.kind = 'operon-public-plugin-release';
		release.compatiblePublicPlugin.releaseTag = '3.0.0';
		assert.doesNotThrow(() => assertStableCandidateIdentityV1(accepted, release));
		release.cliManifestSha256 = '8'.repeat(64);
		assert.throws(() => assertStableCandidateIdentityV1(accepted, release));
	} finally {
		await rm(fixture.root, { recursive: true, force: true });
	}
});

test('source cleanliness includes untracked files', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'operon-native-cleanliness-'));
	try {
		execFileSync('git', ['init', '--quiet'], { cwd: root });
		assert.equal(isGitSourceCleanV1(root), true);
		await writeFile(path.join(root, 'untracked.txt'), 'must make the candidate dirty\n');
		assert.equal(isGitSourceCleanV1(root), false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('native evidence schema admits canonical cells and rejects incomplete aggregate cardinality', async () => {
	const fixture = await createFixture();
	try {
		const smokeCell = JSON.parse(await readFile(
			path.join(
				fixture.acceptanceRoot,
				`native-acceptance-${expectedCellsV1(matrix)[0].cellId}.json`,
			),
			'utf8',
		));
		assert.equal(validateEvidence(smokeCell), true, JSON.stringify(validateEvidence.errors));
		assertSchemaRejects(smokeCell, cell => {
			delete cell.candidate.candidateKind;
		});
		assertSchemaRejects(smokeCell, cell => {
			cell.environment.npmVersion = '11.12.0';
		});
		assertSchemaRejects(smokeCell, cell => {
			cell.environment.officialObsidianCli.rawVersionSha256 = 'invalid';
		});
		assertSchemaRejects(smokeCell, cell => {
			cell.runner.labels.pop();
		});
		assertSchemaRejects(smokeCell, cell => {
			delete cell.proofProviders.native.outputSha256;
		});
		assertSchemaRejects(smokeCell, cell => {
			delete cell.proofEvidence.mutation;
		});
		assertSchemaRejects(smokeCell, cell => {
			cell.proofEvidence.mutation.taskBody = 'must-not-enter-evidence';
		});
		assertSchemaRejects(smokeCell, cell => {
			cell.suites.compatibilitySmoke.interruption.postDispatch.exitCode = 0;
		});
		const reference = expectedCellsV1(matrix).find(cell => cell.performanceReference);
		assert.ok(reference);
		const referenceCell = JSON.parse(await readFile(
			path.join(
				fixture.acceptanceRoot,
				`native-acceptance-${reference.cellId}.json`,
			),
			'utf8',
		));
		assertSchemaRejects(referenceCell, cell => {
			cell.suites.node24Full.performanceReference.previewP95Ms = 100;
		});
		const index = await buildNativeAcceptanceIndexV1({
			candidateRoot: fixture.candidateRoot,
			matrix,
			cellRoot: fixture.acceptanceRoot,
			generatedAt: '2026-07-30T12:00:00.000Z',
		});
		index.cells.pop();
		assert.equal(validateEvidence(index), false);
	} finally {
		await rm(fixture.root, { recursive: true, force: true });
	}
});

test('missing, duplicate or unknown cells cannot be aggregated', async () => {
	const fixture = await createFixture();
	try {
		await rm(path.join(
			fixture.acceptanceRoot,
			`native-acceptance-${expectedCellsV1(matrix)[0].cellId}.json`,
		));
		await assert.rejects(
			buildNativeAcceptanceIndexV1({
				candidateRoot: fixture.candidateRoot,
				matrix,
				cellRoot: fixture.acceptanceRoot,
			}),
			/exactly 36 cell files/u,
		);
	} finally {
		await rm(fixture.root, { recursive: true, force: true });
	}
});

test('mixed candidate digests and skipped platform security fail closed', async () => {
	const fixture = await createFixture();
	try {
		const target = path.join(
			fixture.acceptanceRoot,
			`native-acceptance-${expectedCellsV1(matrix)[0].cellId}.json`,
		);
		const cell = JSON.parse(await readFile(target, 'utf8'));
		cell.candidate.tarballSha256 = 'e'.repeat(64);
		await writeFile(target, `${JSON.stringify(cell, null, 2)}\n`);
		await assert.rejects(
			buildNativeAcceptanceIndexV1({
				candidateRoot: fixture.candidateRoot,
				matrix,
				cellRoot: fixture.acceptanceRoot,
			}),
		);

		cell.candidate.tarballSha256 = fixture.binding.tarballSha256;
		cell.suites.portablePackage.skipped = 1;
		await writeFile(target, `${JSON.stringify(cell, null, 2)}\n`);
		await assert.rejects(
			buildNativeAcceptanceIndexV1({
				candidateRoot: fixture.candidateRoot,
				matrix,
				cellRoot: fixture.acceptanceRoot,
			}),
			/skipped/u,
		);
	} finally {
		await rm(fixture.root, { recursive: true, force: true });
	}
});

test('Node 24 requires all mutation families, Developer API and native security proof', async () => {
	const fixture = await createFixture();
	try {
		const expected = expectedCellsV1(matrix).find(cell => cell.nodeMajor === 24);
		assert.ok(expected);
		const target = path.join(
			fixture.acceptanceRoot,
			`native-acceptance-${expected.cellId}.json`,
		);
		const cell = JSON.parse(await readFile(target, 'utf8'));
		cell.suites.node24Full.mutationFamilies.pop();
		await writeFile(target, `${JSON.stringify(cell, null, 2)}\n`);
		await assert.rejects(
			buildNativeAcceptanceIndexV1({
				candidateRoot: fixture.candidateRoot,
				matrix,
				cellRoot: fixture.acceptanceRoot,
			}),
		);
		cell.suites.node24Full = fullSuite(expected);
		cell.suites.node24Full.developerApi.recoveryRef = false;
		await writeFile(target, `${JSON.stringify(cell, null, 2)}\n`);
		await assert.rejects(
			buildNativeAcceptanceIndexV1({
				candidateRoot: fixture.candidateRoot,
				matrix,
				cellRoot: fixture.acceptanceRoot,
			}),
			/recoveryRef/u,
		);
	} finally {
		await rm(fixture.root, { recursive: true, force: true });
	}
});

async function createFixture(platforms = {
	darwin: 'supported',
	linux: 'supported',
	win32: 'supported',
	wsl: 'unsupported',
}) {
	const root = await mkdtemp(path.join(tmpdir(), 'operon-native-acceptance-'));
	const candidateRoot = path.join(root, 'candidate');
	const acceptanceRoot = path.join(root, 'acceptance');
	await mkdir(candidateRoot);
	await mkdir(acceptanceRoot);
	const tarball = Buffer.from('immutable candidate tarball\n');
	const tarballName = 'operon-cli-1.0.0.tgz';
	const tarballSha256 = sha256(tarball);
	await writeFile(path.join(candidateRoot, tarballName), tarball);
	const plugin = {
		kind: 'operon-plugin-native-candidate',
		pluginId: 'operon',
		pluginVersion: '3.0.0',
		sourceCommit: 'a'.repeat(40),
		releaseTag: '3.0.0',
		mainJsSha256: '1'.repeat(64),
		manifestSha256: '2'.repeat(64),
		stylesCssSha256: '3'.repeat(64),
	};
	await writeFile(path.join(candidateRoot, 'candidate-evidence.json'), `${JSON.stringify({
		evidenceVersion: 1,
		kind: 'operon-cli-native-candidate',
		package: 'operon-cli@1.0.0',
		tarball: tarballName,
		sha256: tarballSha256,
		cliManifestSha256: 'c'.repeat(64),
		aggregateContractSha256: 'd'.repeat(64),
		platforms,
		source: {
			ref: 'a'.repeat(40),
			commit: 'a'.repeat(40),
			trackedTreeClean: true,
		},
		compatiblePublicPlugin: plugin,
	}, null, 2)}\n`);
	const { binding } = await loadCandidateBindingV1(candidateRoot);
	for (const expected of expectedCellsV1(matrix)) {
		const cell = makeCell(expected, binding);
		await writeFile(
			path.join(acceptanceRoot, `native-acceptance-${expected.cellId}.json`),
			`${JSON.stringify(cell, null, 2)}\n`,
		);
	}
	return { root, candidateRoot, acceptanceRoot, binding };
}

function makeCell(expected, binding) {
	return {
		evidenceVersion: 1,
		kind: 'operon-cli-native-acceptance-cell',
		cellId: expected.cellId,
		status: 'passed',
		candidate: {
			...binding,
			cliManifestSha256: 'c'.repeat(64),
			aggregateContractSha256: 'd'.repeat(64),
			platforms: binding.platforms,
		},
		environment: {
			os: {
				id: expected.os.id,
				family: expected.os.family,
				platform: expected.os.platform,
				version: expected.os.version,
				build: expected.os.buildIdentity.status === 'frozen'
					? expected.os.buildIdentity.value
					: `${expected.os.version}.fixture`,
				kernel: `${expected.os.family}-kernel`,
				architecture: expected.os.architecture,
			},
			node: { major: expected.nodeMajor, version: `v${expected.nodeVersion}` },
			npmVersion: expected.npmVersion,
			obsidian: { version: expected.obsidian.version, build: `${expected.obsidian.version}.fixture` },
			officialObsidianCli: {
				enabled: true,
				version: expected.obsidian.version,
				executableSha256: '0'.repeat(64),
				identityBackend: expected.os.platform === 'win32'
					? 'windows-authenticode'
					: expected.os.platform === 'darwin'
						? 'macos-codesign'
						: 'linux-canonical-executable',
				identityVerified: true,
				identityDigest: '6'.repeat(64),
				rawVersionSha256: '4'.repeat(64),
			},
		},
		runner: { labels: expected.runnerLabels },
		transport: {
			endpointKind: expected.os.platform === 'win32'
				? 'windows-named-pipe'
				: 'unix-domain-socket',
			securityBackend: expected.os.platform === 'win32' ? 'windows-dacl' : 'posix-mode',
			persistentAvailable: true,
			failureReason: null,
		},
		suites: {
			portablePackage: passedSuite(100),
			node24Full: expected.nodeMajor === 24 ? fullSuite(expected) : null,
			compatibilitySmoke: expected.nodeMajor === 24 ? null : {
				...passedSuite(6),
				installExactTarball: true,
				versionManifestDoctorHealth: true,
				persistentRead: true,
				orderedJsonlReadGroup: true,
				previewApplyReceiptReplay: true,
				postDispatchSamePlanRecovery: true,
				interruption: {
					postDispatch: {
						exitCode: 5,
						status: 'outcome-unknown',
						samePlanRecovery: true,
					},
				},
			},
		},
		vaultEvidence: {
			fixture: {
				kind: 'operon-developer-api-native-fixture-vault',
				runId: 'fixture-run',
				nonceSha256: 'b'.repeat(64),
			},
			before: { fileCount: 3, sha256: '5'.repeat(64) },
			after: { fileCount: 3, sha256: '5'.repeat(64) },
			readOnlyPhaseUnchanged: true,
		},
		proofProviders: {
			mutation: {
				path: 'scripts/agent-runtime/cli/run-candidate-live-acceptance.mjs',
				sha256: '7'.repeat(64),
				outputSha256: '9'.repeat(64),
			},
			native: {
				path: 'scripts/agent-runtime/cli/native-acceptance-lib.mjs',
				sha256: '8'.repeat(64),
				outputSha256: 'a'.repeat(64),
			},
		},
		proofEvidence: expected.nodeMajor === 24
			? {
				mutation: {
					status: 'ok',
					tests: 200,
					skipped: 0,
					inconclusive: 0,
					publishedFamilies: fullSuite(expected).mutationFamilies,
					exactPostflight: true,
					receiptReplay: true,
				},
				native: {
					status: 'passed',
					tests: 200,
					skipped: 0,
					inconclusive: 0,
					interruption: fullSuite(expected).interruption,
					restartSamePlanRecovery: true,
					installRollbackReupgradeUninstall: true,
					developerApi: fullSuite(expected).developerApi,
					platformSecurity: fullSuite(expected).platformSecurity,
				},
			}
			: {
				mutation: {
					status: 'passed',
					tests: 6,
					skipped: 0,
					inconclusive: 0,
					previewApplyReceiptReplay: true,
					postDispatchSamePlanRecovery: true,
				},
				native: {
					status: 'passed',
					tests: 6,
					skipped: 0,
					inconclusive: 0,
					postDispatchSamePlanRecovery: true,
					interruption: {
						postDispatch: {
							exitCode: 5,
							status: 'outcome-unknown',
							samePlanRecovery: true,
						},
					},
				},
			},
		workflow: {
			repository: 'owner/operon',
			workflow: '.github/workflows/cli-native-acceptance.yml',
			runId: '12345',
			runAttempt: 1,
			sourceRef: binding.sourceRef,
			sourceCommit: binding.sourceCommit,
		},
		publishPerformed: false,
	};
}

function fullSuite(expected) {
	return {
		...passedSuite(200),
		mutationFamilies: [
			'task.convert', 'task.create', 'task.delete', 'task.inline-relocate',
			'task.pinned-state', 'task.recurrence', 'task.relationship',
			'task.reminder-item', 'task.transition', 'task.update',
			'timer.control', 'timer.session',
		],
		persistentSingleRead: true,
		orderedJsonlReadGroup: true,
		exactPostflight: true,
		receiptReplay: true,
		interruptionRecovery: true,
		interruption: {
			preDispatch: {
				exitCode: 130,
				recoveryPresent: false,
			},
			postDispatch: {
				exitCode: 5,
				status: 'outcome-unknown',
				samePlanRecovery: true,
			},
		},
		restartSamePlanRecovery: true,
		installRollbackReupgradeUninstall: true,
		readOnlyResourcesUnchanged: true,
		developerApi: {
			status: 'passed',
			skipped: 0,
			inconclusive: 0,
			tests: 1,
			consumerArtifactSha256: 'f'.repeat(64),
			registryIdentity: true,
			healthCapabilities: true,
			exactRead: true,
			previewApplyReplay: true,
			recoveryRef: true,
			rawEvidence: {
				build: rawDigestFixture('operon-developer-api-native-consumer-build'),
				routine: rawDigestFixture('operon-developer-api-native-consumer-output'),
				recovery: rawDigestFixture('operon-developer-api-native-consumer-output'),
				commandTranscript: rawDigestFixture(
					'operon-developer-api-native-command-transcript',
				),
			},
		},
		platformSecurity: {
			status: 'passed',
			skipped: 0,
			inconclusive: 0,
			passedChecks: expected.os.platform === 'win32'
				? [
					'sid-owner', 'owner-only-dacl', 'ancestor-reparse',
					'descriptor-tamper', 'pipe-spoof', 'hmac-replay',
					'cross-vault-isolation', 'cross-user-isolation',
					'staging-expiry-capacity', 'handshake-deadline',
				]
				: [
					'owner-identity', 'owner-only-mode', 'nofollow',
					'symlink-rejection', 'hardlink-rejection', 'socket-replacement',
				],
		},
		performanceReference: expected.performanceReference
			? {
				status: 'passed',
				samples: 20,
				previewP95Ms: 99,
				routineApplyP95Ms: 1999,
				otherApplyP95Ms: 2999,
			}
			: null,
	};
}

function passedSuite(tests) {
	return { status: 'passed', tests, skipped: 0, inconclusive: 0 };
}

function rawDigestFixture(kind) {
	return { kind, bytes: 1, sha256: 'e'.repeat(64) };
}

function assertSchemaRejects(value, mutate) {
	const changed = structuredClone(value);
	mutate(changed);
	assert.equal(validateEvidence(changed), false);
}

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}
