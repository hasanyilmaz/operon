import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	assertAcceptedPublicV1Freeze,
	assertOperonPublicRuntimeV1,
	publicV1FreezeBinding,
} from './release-contract.mjs';

const mainBytes = Buffer.from('frozen plugin main\n');
const manifestBytes = Buffer.from('{"id":"operon","version":"3.0.0"}\n');
const stylesBytes = Buffer.from('frozen plugin styles\n');

test('accepted freeze provides machine-readable Runtime V1 artifact admission', () => {
	const freeze = acceptedFreeze();
	assertAcceptedPublicV1Freeze(freeze);
	assert.deepEqual(
		assertOperonPublicRuntimeV1(
			JSON.parse(manifestBytes),
			{ mainBytes, manifestBytes, stylesBytes },
			freeze,
		),
		{ min: 1, max: 1 },
	);
	const binding = publicV1FreezeBinding(
		freeze,
		Buffer.from(`${JSON.stringify(freeze, null, 2)}\n`),
	);
	assert.equal(binding.kind, 'operon-public-v1-accepted-freeze');
	assert.equal(binding.cliTarballSha256, '4'.repeat(64));
	assert.equal(binding.pluginMainJsSha256, digest(mainBytes));
	assert.deepEqual(binding.runtimeApi, { min: 1, max: 1 });
});

test('artifact admission rejects bundle, manifest and style drift', () => {
	const freeze = acceptedFreeze();
	for (const artifacts of [
		{ mainBytes: Buffer.from('changed\n'), manifestBytes, stylesBytes },
		{ mainBytes, manifestBytes: Buffer.from('{}\n'), stylesBytes },
		{ mainBytes, manifestBytes, stylesBytes: Buffer.from('changed\n') },
	]) {
		assert.throws(
			() => assertOperonPublicRuntimeV1(
				JSON.parse(manifestBytes),
				artifacts,
				freeze,
			),
			/does not match the accepted Public V1 freeze/u,
		);
	}
});

test('provisional or tampered freeze cannot authorize release artifacts', () => {
	const provisional = acceptedFreeze();
	provisional.state = 'provisional';
	provisional.maintainerAcceptance = { status: 'pending' };
	assert.throws(
		() => assertAcceptedPublicV1Freeze(provisional),
		/Public V1 freeze must be accepted/u,
	);

	const tampered = acceptedFreeze();
	tampered.plugin.version = '3.0.1';
	assert.throws(
		() => assertAcceptedPublicV1Freeze(tampered),
		/Public V1 freeze aggregate digest is invalid/u,
	);
});

function acceptedFreeze() {
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
			tarball: { sha256: '4'.repeat(64) },
		},
		plugin: {
			pluginId: 'operon',
			version: '3.0.0',
			main: { sha256: digest(mainBytes) },
			manifest: { sha256: digest(manifestBytes) },
			styles: { sha256: digest(stylesBytes) },
		},
		audit: {
			validation: { status: 'passed' },
		},
		maintainerAcceptance: {
			status: 'accepted',
			acceptedAt: '2026-07-30T12:03:38.000Z',
		},
	};
	freeze.inputsAggregateSha256 = digestJson(freeze);
	return freeze;
}

function digestJson(value) {
	return digest(Buffer.from(JSON.stringify(value), 'utf8'));
}

function digest(value) {
	return createHash('sha256').update(value).digest('hex');
}
