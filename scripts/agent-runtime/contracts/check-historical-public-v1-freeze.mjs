import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const defaultPluginRoot = path.resolve(path.dirname(scriptPath), '../../..');
const FREEZE_RELATIVE_PATH = 'contracts/agent-runtime/public-v1-freeze.json';

export const HISTORICAL_PUBLIC_V1_FREEZE_IDENTITY = Object.freeze({
	bytes: 7178,
	sha256: '41c83bcbcbc8b8117c1e9989d7d430e03f2257c0004ba2af94363f203f4bf71b',
});

export async function checkHistoricalPublicV1Freeze(options = {}) {
	const pluginRoot = options.pluginRoot ?? defaultPluginRoot;
	const freezePath = options.freezePath ?? path.join(pluginRoot, FREEZE_RELATIVE_PATH);
	const stats = await lstat(freezePath);
	assert.ok(
		stats.isFile() && !stats.isSymbolicLink(),
		'OPERON_HISTORICAL_PUBLIC_V1_FREEZE_FILE_INVALID',
	);
	const bytes = await readFile(freezePath);
	assert.equal(
		bytes.length,
		HISTORICAL_PUBLIC_V1_FREEZE_IDENTITY.bytes,
		'OPERON_HISTORICAL_PUBLIC_V1_FREEZE_SIZE_MISMATCH',
	);
	assert.equal(
		sha256(bytes),
		HISTORICAL_PUBLIC_V1_FREEZE_IDENTITY.sha256,
		'OPERON_HISTORICAL_PUBLIC_V1_FREEZE_HASH_MISMATCH',
	);
	const freeze = JSON.parse(bytes.toString('utf8'));
	assert.equal(freeze.freezeVersion, 1);
	assert.equal(freeze.kind, 'operon-public-v1-local-freeze');
	assert.equal(freeze.state, 'accepted');
	assert.equal(freeze.plugin?.version, '3.0.1');
	assert.equal(freeze.cli?.packageVersion, '1.0.7');
	assert.equal(
		freeze.cli?.contractDigest,
		'407f3a222f8c59a9622038e99e9345d0d34882fd358149b38bce5354ae0ca92b',
	);
	assert.equal(
		freeze.cli?.tarball?.sha256,
		'f03c360ec83663d730d76a5e53e27e4544c82f6c6f1ecfbbc0fba1538cd980a8',
	);
	const { inputsAggregateSha256, ...body } = freeze;
	assert.equal(
		sha256(Buffer.from(JSON.stringify(body), 'utf8')),
		inputsAggregateSha256,
		'OPERON_HISTORICAL_PUBLIC_V1_FREEZE_AGGREGATE_MISMATCH',
	);
	return Object.freeze({
		freezeVersion: freeze.freezeVersion,
		pluginVersion: freeze.plugin.version,
		cliVersion: freeze.cli.packageVersion,
		sha256: HISTORICAL_PUBLIC_V1_FREEZE_IDENTITY.sha256,
	});
}

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

if (path.resolve(process.argv[1] ?? '') === scriptPath) {
	const result = await checkHistoricalPublicV1Freeze();
	process.stdout.write(`${JSON.stringify({ status: 'ok', ...result })}\n`);
}
