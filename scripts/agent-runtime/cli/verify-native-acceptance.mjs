#!/usr/bin/env node

import assert from 'node:assert/strict';
import path from 'node:path';

import { verifyNativeAcceptanceBundleV1 } from './native-acceptance-lib.mjs';

const [candidateRootArgument, acceptanceRootArgument] = process.argv.slice(2);
assert.ok(candidateRootArgument, 'Candidate directory is required.');
assert.ok(acceptanceRootArgument, 'Native acceptance directory is required.');

const index = await verifyNativeAcceptanceBundleV1(
	path.resolve(candidateRootArgument),
	path.resolve(acceptanceRootArgument),
);
assert.equal(
	index.promotionEligible,
	true,
	'Native acceptance was run against a pre-promotion platform manifest; rerun all cells with Linux and Windows supported.',
);
process.stdout.write(`${JSON.stringify({
	status: 'ok',
	package: index.candidate.package,
	tarballSha256: index.candidate.tarballSha256,
	nativeAcceptance: 'passed',
	passedCells: index.summary.passedCells,
	promotionEligible: index.promotionEligible,
}, null, 2)}\n`);
