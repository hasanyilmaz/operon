import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	checkReleaseFreezeRegistry,
	RELEASE_FREEZE_STALE,
} from './check-release-freeze-registry.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('release registry validates historical byte identity and current paired evidence', async () => {
	const result = await checkReleaseFreezeRegistry({ pluginRoot });
	assert.equal(result.registry.releases.length, 2);
	assert.equal(result.evidence.limitations.publishedCliLiveMutationSuite, 'not-rerun');
	assert.equal(result.evidence.limitations.cliInstalledInLiveVault, false);
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
				checkReleaseFreezeRegistry({ pluginRoot: root }),
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
			checkReleaseFreezeRegistry({ pluginRoot: root }),
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
			checkReleaseFreezeRegistry({ pluginRoot: root }),
			new RegExp(RELEASE_FREEZE_STALE, 'u'),
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

async function createFixture() {
	const root = await mkdtemp(path.join(os.tmpdir(), 'operon-release-freeze-registry-'));
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
