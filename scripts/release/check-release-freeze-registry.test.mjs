import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, copyFile, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	assertReleaseArtifactMatchesFreeze,
	checkCandidateFreezeRegistry,
	readReleaseArtifactIdentity,
	RELEASE_FREEZE_STALE,
} from './check-release-freeze-registry.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('candidate registry validates historical byte identity and current paired evidence read-only', async () => {
	const protectedPaths = [
		'contracts/agent-runtime/public-v1-release-freezes.json',
		'contracts/agent-runtime/releases/3.1.0/public-v1-external-freeze.json',
		'contracts/agent-runtime/releases/3.1.0/paired-release-evidence.json',
		'contracts/agent-runtime/releases/3.1.0/published-cli-v1.json',
	];
	const before = await Promise.all(protectedPaths.map(relativePath => readFile(path.join(pluginRoot, relativePath))));
	const result = await checkCandidateFreezeRegistry({ pluginRoot });
	assert.equal(result.registry.releases.length, 2);
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
		assert.equal(result.freeze.pluginArtifact.version, '3.1.0');
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

test('release artifact reader enforces no-follow identity for every working artifact', async () => {
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
		await rm(path.join(root, 'manifest.json'));
		const validManifestTarget = path.join(root, 'manifest-target.json');
		await writeFile(validManifestTarget, contents['manifest.json']);
		await symlink(validManifestTarget, path.join(root, 'manifest.json'));
		await assert.rejects(readReleaseArtifactIdentity(root, frozen));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('release registry maps registry and historical byte drift to stale', async () => {
	for (const targetPath of [
		'contracts/agent-runtime/public-v1-release-freezes.json',
		'contracts/agent-runtime/public-v1-live-acceptance.json',
		'contracts/agent-runtime/releases/3.1.0/paired-release-evidence.json',
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
		const evidencePath = 'contracts/agent-runtime/releases/3.1.0/paired-release-evidence.json';
		const registryPath = 'contracts/agent-runtime/public-v1-release-freezes.json';
		const evidence = JSON.parse(await readFile(path.join(root, evidencePath), 'utf8'));
		evidence.limitations.cliInstalledInLiveVault = true;
		const evidenceBytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`);
		await writeFile(path.join(root, evidencePath), evidenceBytes);
		const registry = JSON.parse(await readFile(path.join(root, registryPath), 'utf8'));
		const identity = registry.releases[1].files.find(file => file.path === evidencePath);
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

test('release registry rejects symlinked current binding input', async () => {
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
	];
	for (const relativePath of files) {
		await mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
		await copyFile(path.join(pluginRoot, relativePath), path.join(root, relativePath));
	}
	return root;
}
