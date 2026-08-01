import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { materializeFrozenCandidate } from './materialize-frozen-candidate.mjs';

test('materializes the accepted canonical tarball without rebuilding it', async () => {
	const fixture = await createFixture();
	try {
		const output = path.join(fixture.root, 'packages/operon-cli/release');
		const result = await materializeFrozenCandidate({ repositoryRoot: fixture.root, outputRoot: output });
		assert.equal(result.fileName, 'operon-cli-1.0.5.tgz');
		assert.deepEqual(await readFile(result.path), fixture.bytes);
		assert.equal(result.sha256, digest(fixture.bytes));
	} finally {
		await rm(fixture.root, { recursive: true, force: true });
	}
});

for (const [name, mutate, message] of [
	['version mismatch', freeze => { freeze.cli.packageVersion = '1.0.4'; }, /version does not match/u],
	['path mismatch', freeze => { freeze.cli.tarball.path = 'packages/operon-cli/freeze/other.tgz'; }, /path is not canonical/u],
	['size mismatch', freeze => { freeze.cli.tarball.bytes += 1; }, /size drifted/u],
	['digest mismatch', freeze => { freeze.cli.tarball.sha256 = '0'.repeat(64); }, /digest drifted/u],
]) {
	test(`rejects ${name}`, async () => {
		const fixture = await createFixture(mutate);
		try {
			await assert.rejects(
				materializeFrozenCandidate({
					repositoryRoot: fixture.root,
					outputRoot: path.join(fixture.root, 'packages/operon-cli/release'),
				}),
				message,
			);
		} finally {
			await rm(fixture.root, { recursive: true, force: true });
		}
	});
}

test('rejects a missing frozen tarball and a non-empty output directory', async () => {
	const missing = await createFixture();
	try {
		await rm(missing.source);
		await assert.rejects(
			materializeFrozenCandidate({
				repositoryRoot: missing.root,
				outputRoot: path.join(missing.root, 'packages/operon-cli/release'),
			}),
			/ENOENT/u,
		);
	} finally {
		await rm(missing.root, { recursive: true, force: true });
	}
	const occupied = await createFixture();
	try {
		const output = path.join(occupied.root, 'packages/operon-cli/release');
		await mkdir(output);
		await writeFile(path.join(output, 'unexpected.tgz'), 'unexpected\n', 'utf8');
		await assert.rejects(
			materializeFrozenCandidate({ repositoryRoot: occupied.root, outputRoot: output }),
			/output directory must be empty/u,
		);
	} finally {
		await rm(occupied.root, { recursive: true, force: true });
	}
});

test('rejects symlinked source and output paths', {
	skip: process.platform === 'win32' ? 'Symlink creation is not portable on Windows CI.' : false,
}, async () => {
	const sourceLink = await createFixture();
	try {
		const external = path.join(sourceLink.root, 'external.tgz');
		await writeFile(external, sourceLink.bytes);
		await rm(sourceLink.source);
		await symlink(external, sourceLink.source);
		await assert.rejects(
			materializeFrozenCandidate({
				repositoryRoot: sourceLink.root,
				outputRoot: path.join(sourceLink.root, 'packages/operon-cli/release'),
			}),
			/cannot be a symlink/u,
		);
	} finally {
		await rm(sourceLink.root, { recursive: true, force: true });
	}
	const outputLink = await createFixture();
	try {
		const external = path.join(outputLink.root, 'external-release');
		await mkdir(external);
		await symlink(external, path.join(outputLink.root, 'packages/operon-cli/release'));
		await assert.rejects(
			materializeFrozenCandidate({
				repositoryRoot: outputLink.root,
				outputRoot: path.join(outputLink.root, 'packages/operon-cli/release'),
			}),
			/cannot be a symlink/u,
		);
	} finally {
		await rm(outputLink.root, { recursive: true, force: true });
	}
});

async function createFixture(mutate) {
	const root = await mkdtemp(path.join(tmpdir(), 'operon-frozen-candidate-'));
	const bytes = Buffer.from('immutable candidate tarball\n');
	const source = path.join(root, 'packages/operon-cli/freeze/operon-cli-1.0.5.tgz');
	await mkdir(path.dirname(source), { recursive: true });
	await mkdir(path.join(root, 'contracts/agent-runtime'), { recursive: true });
	await writeFile(path.join(root, 'packages/operon-cli/package.json'), `${JSON.stringify({
		name: 'operon-cli',
		version: '1.0.5',
	}, null, 2)}\n`, 'utf8');
	await writeFile(source, bytes);
	const freeze = {
		freezeVersion: 1,
		kind: 'operon-public-v1-local-freeze',
		state: 'accepted',
		runtime: {
			contractVersion: 1,
			schemaAggregateSha256: '1'.repeat(64),
		},
		cli: {
			contractVersion: 1,
			contractDigest: '2'.repeat(64),
			packageVersion: '1.0.5',
			tarball: {
				path: 'packages/operon-cli/freeze/operon-cli-1.0.5.tgz',
				bytes: bytes.length,
				sha256: digest(bytes),
			},
		},
		plugin: {
			pluginId: 'operon',
			version: '3.0.1',
			main: { sha256: '3'.repeat(64) },
			manifest: { sha256: '4'.repeat(64) },
			styles: { sha256: '5'.repeat(64) },
		},
		audit: { validation: { status: 'passed' } },
		maintainerAcceptance: {
			status: 'accepted',
			acceptedAt: '2026-08-01T00:00:00.000Z',
		},
	};
	mutate?.(freeze);
	freeze.inputsAggregateSha256 = digest(Buffer.from(JSON.stringify(freeze), 'utf8'));
	await writeFile(
		path.join(root, 'contracts/agent-runtime/public-v1-freeze.json'),
		`${JSON.stringify(freeze, null, 2)}\n`,
		'utf8',
	);
	return { root, source, bytes };
}

function digest(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}
