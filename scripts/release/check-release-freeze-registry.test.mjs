import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, copyFile, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { canonicalJson } from './check-accepted-freeze.mjs';

import {
	assertAutomatedReleaseEvidence,
	assertReleaseArtifactMatchesFreeze,
	checkCandidateFreezeRegistry,
	checkReleaseFreezeRegistry,
	readReleaseArtifactIdentity,
	RELEASE_FREEZE_STALE,
} from './check-release-freeze-registry.mjs';
import { symlinkCapabilityUnavailableReason } from '../test-symlink-capability.mjs';

test('automated release evidence binds one exact local, hosted, and Windows identity without live claims', () => {
	const candidateCommit = 'a'.repeat(40);
	const artifact = {
		version: '3.1.1',
		files: [
			{ path: 'main.js', bytes: 10, sha256: '1'.repeat(64) },
			{ path: 'manifest.json', bytes: 20, sha256: '2'.repeat(64) },
			{ path: 'styles.css', bytes: 30, sha256: '3'.repeat(64) },
		],
	};
	const artifactAggregateSha256 = createHash('sha256')
		.update(canonicalJson(artifact))
		.digest('hex');
	const binding = { source: { commit: 'b'.repeat(40) } };
	const cliCandidateCommit = 'd'.repeat(40);
	const freeze = {
		runtime: { contractVersion: 1, contractDigest: 'c'.repeat(64) },
		pluginArtifact: artifact,
		releaseAcceptance: {
			mode: 'automated-validation',
			status: 'accepted',
			candidateCommit,
		},
	};
	const evidence = {
		$schema: './public-v1-external-freeze.schema.json#/$defs/pairedReleaseEvidence',
		evidenceVersion: 2,
		kind: 'operon-public-v1-paired-release-evidence',
		state: 'paired-release-accepted',
		runtime: structuredClone(freeze.runtime),
		acceptance: {
			mode: 'automated-validation',
			scope: 'release-only-packaging',
			status: 'accepted',
			candidateCommit,
		},
		plugin: {
			version: '3.1.1',
			productionCandidateCommit: candidateCommit,
			artifact: structuredClone(artifact),
			validation: {
				local: {
					candidateCommit,
					trackedClean: true,
					node: '24.18.0',
					npm: '11.12.1',
					npmCi: 'passed',
					checkCandidate: 'passed',
					phase5: { passed: 1526, total: 1526 },
					releaseGuard: 'passed-candidate-mode',
					audit: { status: 'accepted-clean', productionFindings: 0, developmentFindings: 0 },
					artifactAggregateSha256,
				},
				hosted: {
					candidateCommit,
					ci: { runId: 1, jobId: 6, headSha: candidateCommit, status: 'success' },
					codeql: { runId: 2, headSha: candidateCommit, status: 'success' },
					artifactAggregateSha256,
				},
			},
		},
		cli: {
			candidateCommit: cliCandidateCommit,
			integratedCommit: binding.source.commit,
			integratedTree: 'e'.repeat(40),
			treeMatchesCandidate: true,
		},
		pairedWindowsValidation: {
			runId: 3,
			windowsPairJobId: 4,
			pluginCommit: candidateCommit,
			cliCandidateCommit,
			pluginNative: { tests: 22, failed: 0, cancelled: 0, skipped: 0 },
			cliHosted: { assertions: 4, skipped: 0 },
			trackedClean: true,
			status: 'passed',
			artifactAggregateSha256,
		},
		historicalLiveBaseline: {
			scope: 'historical-runtime-v1-baseline-only',
			pluginVersion: '3.1.0',
			cliVersion: '1.0.9',
			freezePath: 'contracts/agent-runtime/releases/3.1.0/public-v1-external-freeze.json',
			freezeSha256: '85cf7459987ecd7aa18fdae06fcea08acbbe1318189e3edb2557c60aa3d5abe4',
			evidencePath: 'contracts/agent-runtime/releases/3.1.0/paired-release-evidence.json',
			evidenceSha256: '3352c360c9a2ddd01c3ab622f0263c61bec15f1e83b8ac0c669e5f9b64a35ab5',
		},
		limitations: {
			liveDeployment: 'not-run',
			manualAcceptance: 'not-run-not-required',
			publishedCliLiveMutationSuite: 'not-rerun',
			cliInstalledInLiveVault: false,
		},
	};
	assert.equal(assertAutomatedReleaseEvidence({ freeze, evidence, binding }), artifactAggregateSha256);

	for (const mutate of [
		input => { input.plugin.deployment = {}; },
		input => { input.plugin.validation.hosted.codeql.status = 'failed'; },
		input => { input.pairedWindowsValidation.pluginNative.skipped = 1; },
		input => { input.plugin.validation.local.artifactAggregateSha256 = 'f'.repeat(64); },
	]) {
		const drift = structuredClone(evidence);
		mutate(drift);
		assert.throws(() => assertAutomatedReleaseEvidence({ freeze, evidence: drift, binding }));
	}
});

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('candidate registry validates historical byte identity and 3.1.1 paired evidence read-only', async () => {
	const protectedPaths = [
		'contracts/agent-runtime/public-v1-release-freezes.json',
		'contracts/agent-runtime/releases/3.1.0/public-v1-external-freeze.json',
		'contracts/agent-runtime/releases/3.1.0/paired-release-evidence.json',
		'contracts/agent-runtime/releases/3.1.0/published-cli-v1.json',
		'contracts/agent-runtime/releases/3.1.1/public-v1-external-freeze.json',
		'contracts/agent-runtime/releases/3.1.1/public-v1-external-freeze.schema.json',
		'contracts/agent-runtime/releases/3.1.1/paired-release-evidence.json',
	];
	const before = await Promise.all(protectedPaths.map(relativePath => readFile(path.join(pluginRoot, relativePath))));
	const result = await checkCandidateFreezeRegistry({ pluginRoot });
	assert.deepEqual(
		result.registry.releases.slice(0, 3).map(release => release.pluginVersion),
		['3.0.2', '3.1.0', '3.1.1'],
	);
	assert.equal(
		result.registry.currentPluginVersion,
		result.registry.releases.at(-1)?.pluginVersion,
	);
	assert.equal(result.freeze.pluginArtifact.version, '3.1.1');
	assert.equal(result.freeze.releaseAcceptance.mode, 'automated-validation');
	assert.equal(result.evidence.limitations.publishedCliLiveMutationSuite, 'not-rerun');
	assert.equal(result.evidence.limitations.cliInstalledInLiveVault, false);
	const after = await Promise.all(protectedPaths.map(relativePath => readFile(path.join(pluginRoot, relativePath))));
	assert.deepEqual(after, before);
});

test('candidate registry accepts working artifact drift and absence', async () => {
	const root = await createFixture();
	try {
		await Promise.all([
			appendFile(path.join(root, 'main.js'), 'candidate drift\n'),
			writeFile(path.join(root, 'manifest.json'), '{"version":"9.9.9"}\n'),
			rm(path.join(root, 'styles.css')),
		]);
		const result = await checkCandidateFreezeRegistry({ pluginRoot: root });
		assert.equal(result.freeze.pluginArtifact.version, '3.1.1');
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('historical registry rejects malformed or non-monotonic appended releases', async () => {
	for (const mutate of [
		registry => {
			registry.releases[3].pluginVersion = '3.1.1';
			registry.currentPluginVersion = '3.1.1';
		},
		registry => {
			registry.releases[3].pluginVersion = '3.0.9';
			registry.currentPluginVersion = '3.0.9';
		},
		registry => {
			registry.releases[3].pluginVersion = '4.0.0';
			registry.currentPluginVersion = '4.0.0';
		},
		registry => {
			registry.releases[3].files = [];
		},
		registry => {
			delete registry.releases[3].evidenceKind;
		},
	]) {
		const root = await createFixture();
		try {
			const registryPath = path.join(root, 'contracts/agent-runtime/public-v1-release-freezes.json');
			const registry = JSON.parse(await readFile(registryPath, 'utf8'));
			mutate(registry);
			await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
			await assert.rejects(
				checkCandidateFreezeRegistry({ pluginRoot: root }),
				new RegExp(RELEASE_FREEZE_STALE, 'u'),
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}
});

test('release registry production path rejects working artifact drift', async () => {
	const root = await createFixture();
	try {
		await appendFile(path.join(root, 'main.js'), 'release drift\n');
		await assert.rejects(
			checkReleaseFreezeRegistry({ pluginRoot: root }),
			new RegExp(RELEASE_FREEZE_STALE, 'u'),
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('release artifact comparison accepts exact identity and rejects every artifact drift', () => {
	const frozen = {
		version: '3.1.0',
		files: [
			{ path: 'main.js', bytes: 10, sha256: 'a'.repeat(64) },
			{ path: 'manifest.json', bytes: 20, sha256: 'b'.repeat(64) },
			{ path: 'styles.css', bytes: 30, sha256: 'c'.repeat(64) },
		],
	};
	assert.equal(assertReleaseArtifactMatchesFreeze(structuredClone(frozen), frozen), true);
	for (const mutate of [
		artifact => { artifact.files[0].bytes += 1; },
		artifact => { artifact.files[1].sha256 = 'd'.repeat(64); },
		artifact => { artifact.files[2].bytes += 1; },
		artifact => { artifact.version = '3.1.1'; },
	]) {
		const drift = structuredClone(frozen);
		mutate(drift);
		assert.throws(() => assertReleaseArtifactMatchesFreeze(drift, frozen));
	}
});

test('release artifact reader enforces no-follow identity for every working artifact', async t => {
	const root = await mkdtemp(path.join(await realpath(os.tmpdir()), 'operon-release-artifact-reader-'));
	try {
		const contents = {
			'main.js': 'release-main\n',
			'manifest.json': '{"version":"3.1.0"}\n',
			'styles.css': 'release-styles\n',
		};
		await Promise.all(Object.entries(contents).map(([file, bytes]) => writeFile(path.join(root, file), bytes)));
		const frozen = {
			version: '3.1.0',
			files: Object.entries(contents).map(([file, bytes]) => ({
				path: file,
				bytes: Buffer.byteLength(bytes),
				sha256: createHash('sha256').update(bytes).digest('hex'),
			})),
		};
		assert.equal(
			assertReleaseArtifactMatchesFreeze(await readReleaseArtifactIdentity(root, frozen), frozen),
			true,
		);

		for (const file of Object.keys(contents)) {
			await appendFile(path.join(root, file), 'drift');
			if (file === 'manifest.json') {
				await assert.rejects(readReleaseArtifactIdentity(root, frozen));
			} else {
				const drift = await readReleaseArtifactIdentity(root, frozen);
				assert.throws(() => assertReleaseArtifactMatchesFreeze(drift, frozen));
			}
			await writeFile(path.join(root, file), contents[file]);
		}

		await rm(path.join(root, 'styles.css'));
		await assert.rejects(readReleaseArtifactIdentity(root, frozen));
		await writeFile(path.join(root, 'styles.css'), contents['styles.css']);
		await t.test('release artifact reader rejects a symlinked artifact', {
			skip: symlinkCapabilityUnavailableReason(),
		}, async () => {
			await rm(path.join(root, 'manifest.json'));
			const validManifestTarget = path.join(root, 'manifest-target.json');
			await writeFile(validManifestTarget, contents['manifest.json']);
			await symlink(validManifestTarget, path.join(root, 'manifest.json'));
			await assert.rejects(readReleaseArtifactIdentity(root, frozen));
		});
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('release registry maps registry and historical byte drift to stale', async () => {
	for (const targetPath of [
		'contracts/agent-runtime/public-v1-release-freezes.json',
		'contracts/agent-runtime/public-v1-live-acceptance.json',
		'contracts/agent-runtime/releases/3.1.0/paired-release-evidence.json',
		'contracts/agent-runtime/releases/3.1.1/paired-release-evidence.json',
	]) {
		const root = await createFixture();
		try {
			await writeFile(path.join(root, targetPath), 'drift\n', 'utf8');
			await assert.rejects(
				checkCandidateFreezeRegistry({ pluginRoot: root }),
				new RegExp(RELEASE_FREEZE_STALE, 'u'),
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}
});

test('release registry rejects self-consistent current evidence and registry drift', async () => {
	const root = await createFixture();
	try {
		const evidencePath = 'contracts/agent-runtime/releases/3.1.1/paired-release-evidence.json';
		const registryPath = 'contracts/agent-runtime/public-v1-release-freezes.json';
		const evidence = JSON.parse(await readFile(path.join(root, evidencePath), 'utf8'));
		evidence.limitations.cliInstalledInLiveVault = true;
		const evidenceBytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`);
		await writeFile(path.join(root, evidencePath), evidenceBytes);
		const registry = JSON.parse(await readFile(path.join(root, registryPath), 'utf8'));
		const identity = registry.releases[2].files.find(file => file.path === evidencePath);
		identity.bytes = evidenceBytes.byteLength;
		identity.sha256 = createHash('sha256').update(evidenceBytes).digest('hex');
		await writeFile(path.join(root, registryPath), `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
		await assert.rejects(
			checkCandidateFreezeRegistry({ pluginRoot: root }),
			new RegExp(RELEASE_FREEZE_STALE, 'u'),
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('release registry rejects symlinked current binding input', {
	skip: symlinkCapabilityUnavailableReason(),
}, async () => {
	const root = await createFixture();
	try {
		const relativePath = 'contracts/agent-runtime/releases/3.1.0/published-cli-v1.json';
		const target = path.join(root, relativePath);
		await rm(target);
		await symlink(path.join(pluginRoot, relativePath), target);
		await assert.rejects(
			checkCandidateFreezeRegistry({ pluginRoot: root }),
			new RegExp(RELEASE_FREEZE_STALE, 'u'),
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

async function createFixture() {
	const root = await mkdtemp(path.join(await realpath(os.tmpdir()), 'operon-release-freeze-registry-'));
	const files = [
		'main.js',
		'manifest.json',
		'styles.css',
		'contracts/agent-runtime/public-v1-release-freezes.json',
		'contracts/agent-runtime/public-v1-external-freeze.json',
		'contracts/agent-runtime/public-v1-external-freeze.schema.json',
		'contracts/agent-runtime/public-v1-live-acceptance.json',
		'contracts/agent-runtime/published-cli-v1.json',
		'contracts/agent-runtime/published-cli-v1.schema.json',
		'contracts/agent-runtime/releases/3.1.0/public-v1-external-freeze.json',
		'contracts/agent-runtime/releases/3.1.0/public-v1-external-freeze.schema.json',
		'contracts/agent-runtime/releases/3.1.0/paired-release-evidence.json',
		'contracts/agent-runtime/releases/3.1.0/published-cli-v1.json',
		'contracts/agent-runtime/releases/3.1.0/published-cli-v1.schema.json',
		'contracts/agent-runtime/releases/3.1.1/public-v1-external-freeze.json',
		'contracts/agent-runtime/releases/3.1.1/public-v1-external-freeze.schema.json',
		'contracts/agent-runtime/releases/3.1.1/paired-release-evidence.json',
	];
	for (const relativePath of files) {
		await mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
		await copyFile(path.join(pluginRoot, relativePath), path.join(root, relativePath));
	}
	return root;
}
