import assert from 'node:assert/strict';
import test from 'node:test';

import {
	assertAcceptedReleaseFreeze,
	checkAcceptedReleaseFreeze,
} from './check-accepted-freeze.mjs';

function acceptedFreeze() {
	return {
		state: 'accepted',
		audit: {
			validation: {
				status: 'passed',
				result: { status: 'accepted-development-exception' },
			},
		},
		maintainerAcceptance: {
			status: 'accepted',
			acceptedBy: 'Maintainer',
			acceptedAt: '2026-07-30T12:03:38.000Z',
		},
	};
}

test('accepts a maintainer-approved freeze with a passed audit', () => {
	const freeze = acceptedFreeze();
	assert.equal(assertAcceptedReleaseFreeze(freeze), freeze);
});

test('rejects provisional, unaudited, or unsigned release freezes', () => {
	for (const mutate of [
		freeze => { freeze.state = 'provisional'; },
		freeze => { freeze.audit.validation.status = 'pending'; },
		freeze => { freeze.audit.validation.result.status = 'pending'; },
		freeze => { freeze.maintainerAcceptance.status = 'pending'; },
		freeze => { freeze.maintainerAcceptance.acceptedBy = ''; },
		freeze => { freeze.maintainerAcceptance.acceptedAt = 'invalid'; },
	]) {
		const freeze = acceptedFreeze();
		mutate(freeze);
		assert.throws(
			() => assertAcceptedReleaseFreeze(freeze),
			/OPERON_RELEASE_ACCEPTED_FREEZE_REQUIRED/u,
		);
	}
});

test('release freeze check prepares source artifacts before validating accepted bytes', async () => {
	const order = [];
	const freeze = acceptedFreeze();
	assert.equal(await checkAcceptedReleaseFreeze({
		pluginRoot: '/fixture/plugin',
		prepareArtifacts: async root => {
			assert.equal(root, '/fixture/plugin');
			order.push('prepare');
		},
		checkFreeze: async options => {
			assert.equal(options.pluginRoot, '/fixture/plugin');
			order.push('check');
			return freeze;
		},
	}), freeze);
	assert.deepEqual(order, ['prepare', 'check']);
});
