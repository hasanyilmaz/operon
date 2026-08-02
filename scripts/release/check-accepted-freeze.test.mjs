import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
	assertAcceptedReleaseFreeze,
	checkAcceptedReleaseFreeze,
	externalFreezeAggregate,
	PUBLIC_V1_FREEZE_STALE,
	PUBLISHED_CLI_BINDING_RELATIVE_PATH,
	RUNTIME_V1_CONTRACT_DIGEST,
} from './check-accepted-freeze.mjs';

function acceptedFreeze(bindingSha256 = 'a'.repeat(64)) {
	const freeze = {
		freezeVersion: 1,
		kind: 'operon-public-v1-external-freeze',
		state: 'accepted',
		runtime: {
			contractDigest: RUNTIME_V1_CONTRACT_DIGEST,
		},
		externalCliBinding: {
			path: PUBLISHED_CLI_BINDING_RELATIVE_PATH,
			sha256: bindingSha256,
		},
		audit: {
			validation: {
				status: 'passed',
				result: { status: 'accepted-clean' },
			},
		},
		maintainerAcceptance: {
			status: 'accepted',
			acceptedBy: 'Maintainer',
			acceptedAt: '2026-08-03T12:03:38.000Z',
		},
	};
	freeze.inputsAggregateSha256 = externalFreezeAggregate(freeze);
	return freeze;
}

test('accepts a maintainer-approved external freeze bound to the published CLI identity', () => {
	const freeze = acceptedFreeze();
	assert.equal(assertAcceptedReleaseFreeze(freeze, {
		bindingSha256: 'a'.repeat(64),
	}), freeze);
});

test('maps provisional, unaudited, unbound, or unsigned freezes to the stale gate', () => {
	for (const mutate of [
		freeze => { freeze.state = 'provisional'; },
		freeze => { freeze.runtime.contractDigest = '0'.repeat(64); },
		freeze => { freeze.externalCliBinding.path = 'unreviewed.json'; },
		freeze => { freeze.externalCliBinding.sha256 = '0'.repeat(64); },
		freeze => { freeze.audit.validation.status = 'pending'; },
		freeze => { freeze.audit.validation.result.status = 'pending'; },
		freeze => { freeze.maintainerAcceptance.status = 'pending'; },
		freeze => { freeze.maintainerAcceptance.acceptedBy = ''; },
		freeze => { freeze.maintainerAcceptance.acceptedAt = 'invalid'; },
		freeze => { freeze.inputsAggregateSha256 = '0'.repeat(64); },
	]) {
		const freeze = acceptedFreeze();
		mutate(freeze);
		if (freeze.inputsAggregateSha256 !== '0'.repeat(64)) {
			freeze.inputsAggregateSha256 = externalFreezeAggregate(freeze);
		}
		assert.throws(
			() => assertAcceptedReleaseFreeze(freeze, {
				bindingSha256: 'a'.repeat(64),
			}),
			new RegExp(PUBLIC_V1_FREEZE_STALE, 'u'),
		);
	}
});

test('release freeze check is read-only and verifies exact binding bytes', async () => {
	const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'operon-external-freeze-'));
	try {
		const contracts = path.join(temporaryRoot, 'contracts', 'agent-runtime');
		await mkdir(contracts, { recursive: true });
		const bindingBytes = Buffer.from('{"binding":"fixture"}\n', 'utf8');
		const bindingSha256 = createHash('sha256').update(bindingBytes).digest('hex');
		const freeze = acceptedFreeze(bindingSha256);
		await Promise.all([
			writeFile(path.join(contracts, 'published-cli-v1.json'), bindingBytes),
			writeFile(
				path.join(contracts, 'public-v1-external-freeze.json'),
				`${JSON.stringify(freeze, null, 2)}\n`,
				'utf8',
			),
		]);
		assert.deepEqual(await checkAcceptedReleaseFreeze({ pluginRoot: temporaryRoot }), freeze);
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
});

test('missing external freeze fails only with the public stale gate code', async () => {
	const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'operon-external-freeze-missing-'));
	try {
		await assert.rejects(
			checkAcceptedReleaseFreeze({ pluginRoot: temporaryRoot }),
			new RegExp(PUBLIC_V1_FREEZE_STALE, 'u'),
		);
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
});

test('external freeze rejects symlink inputs and binding-byte drift with the stale code', async () => {
	const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'operon-external-freeze-negative-'));
	try {
		const contracts = path.join(temporaryRoot, 'contracts', 'agent-runtime');
		await mkdir(contracts, { recursive: true });
		const bindingPath = path.join(contracts, 'published-cli-v1.json');
		const freezePath = path.join(contracts, 'public-v1-external-freeze.json');
		const realFreezePath = path.join(contracts, 'real-freeze.json');
		const accepted = acceptedFreeze('a'.repeat(64));
		await Promise.all([
			writeFile(bindingPath, '{"drifted":true}\n', 'utf8'),
			writeFile(realFreezePath, `${JSON.stringify(accepted)}\n`, 'utf8'),
		]);
		await symlink(realFreezePath, freezePath);
		await assert.rejects(
			checkAcceptedReleaseFreeze({ pluginRoot: temporaryRoot }),
			new RegExp(PUBLIC_V1_FREEZE_STALE, 'u'),
		);
		await rm(freezePath);
		await writeFile(freezePath, `${JSON.stringify(accepted)}\n`, 'utf8');
		await assert.rejects(
			checkAcceptedReleaseFreeze({ pluginRoot: temporaryRoot }),
			new RegExp(PUBLIC_V1_FREEZE_STALE, 'u'),
		);
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
});
