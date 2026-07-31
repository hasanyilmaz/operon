import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const OPERON_PUBLIC_V1_MINIMUM_VERSION = '3.0.0';
export const OPERON_PUBLIC_RUNTIME_API_V1 = Object.freeze({ min: 1, max: 1 });
export const PUBLIC_V1_FREEZE_RELATIVE_PATH =
	'contracts/agent-runtime/public-v1-freeze.json';

export async function readAcceptedPublicV1Freeze(repositoryRoot) {
	const freezePath = path.join(repositoryRoot, PUBLIC_V1_FREEZE_RELATIVE_PATH);
	const bytes = await readFile(freezePath);
	const freeze = JSON.parse(bytes.toString('utf8'));
	assertAcceptedPublicV1Freeze(freeze);
	return {
		freeze,
		bytes,
		binding: publicV1FreezeBinding(freeze, bytes),
	};
}

export function assertAcceptedPublicV1Freeze(freeze) {
	assert.equal(freeze?.freezeVersion, 1, 'Public V1 freeze version must be 1.');
	assert.equal(
		freeze?.kind,
		'operon-public-v1-local-freeze',
		'Public V1 freeze kind is invalid.',
	);
	assert.equal(freeze?.state, 'accepted', 'Public V1 freeze must be accepted.');
	assert.equal(
		freeze?.maintainerAcceptance?.status,
		'accepted',
		'Public V1 maintainer acceptance is required.',
	);
	assert.equal(
		freeze?.audit?.validation?.status,
		'passed',
		'Public V1 audit must have passed.',
	);
	assert.equal(freeze?.runtime?.contractVersion, 1, 'Runtime contract version must be 1.');
	assert.equal(freeze?.cli?.contractVersion, 1, 'CLI contract version must be 1.');
	assert.match(freeze?.inputsAggregateSha256 ?? '', /^[a-f0-9]{64}$/u);
	const { inputsAggregateSha256, ...indexWithoutAggregate } = freeze;
	assert.equal(
		hashJson(indexWithoutAggregate),
		inputsAggregateSha256,
		'Public V1 freeze aggregate digest is invalid.',
	);
	return freeze;
}

export function assertOperonPublicRuntimeV1(manifest, artifacts, freeze) {
	assertAcceptedPublicV1Freeze(freeze);
	assert.equal(manifest.id, 'operon', 'Public plugin artifact must be Operon.');
	assert.equal(
		manifest.version,
		freeze.plugin.version,
		'Public Operon version must equal the accepted Public V1 freeze.',
	);
	assert.equal(freeze.plugin.pluginId, manifest.id);
	assert.equal(
		hash(artifacts.mainBytes),
		freeze.plugin.main.sha256,
		'Public Operon main.js does not match the accepted Public V1 freeze.',
	);
	assert.equal(
		hash(artifacts.manifestBytes),
		freeze.plugin.manifest.sha256,
		'Public Operon manifest.json does not match the accepted Public V1 freeze.',
	);
	assert.equal(
		hash(artifacts.stylesBytes),
		freeze.plugin.styles.sha256,
		'Public Operon styles.css does not match the accepted Public V1 freeze.',
	);
	return OPERON_PUBLIC_RUNTIME_API_V1;
}

export function publicV1FreezeBinding(freeze, bytes) {
	assertAcceptedPublicV1Freeze(freeze);
	return {
		kind: 'operon-public-v1-accepted-freeze',
		freezeVersion: freeze.freezeVersion,
		sha256: hash(bytes),
		inputsAggregateSha256: freeze.inputsAggregateSha256,
		acceptedAt: freeze.maintainerAcceptance.acceptedAt,
		runtimeApi: OPERON_PUBLIC_RUNTIME_API_V1,
		runtimeSchemaAggregateSha256: freeze.runtime.schemaAggregateSha256,
		cliContractDigest: freeze.cli.contractDigest,
		cliTarballSha256: freeze.cli.tarball.sha256,
		pluginVersion: freeze.plugin.version,
		pluginMainJsSha256: freeze.plugin.main.sha256,
		pluginManifestSha256: freeze.plugin.manifest.sha256,
		pluginStylesCssSha256: freeze.plugin.styles.sha256,
	};
}

function hash(value) {
	return createHash('sha256').update(value).digest('hex');
}

function hashJson(value) {
	return hash(Buffer.from(JSON.stringify(value), 'utf8'));
}
