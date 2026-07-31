#!/usr/bin/env node

import assert from 'node:assert/strict';
import path from 'node:path';

import { verifyHostedPortabilityBundleV1 } from './hosted-portability-lib.mjs';

const [candidateRootArgument, acceptanceRootArgument] = process.argv.slice(2);
assert.ok(candidateRootArgument, 'Candidate directory is required.');
assert.ok(acceptanceRootArgument, 'Hosted portability directory is required.');
const index = await verifyHostedPortabilityBundleV1(
	path.resolve(candidateRootArgument),
	path.resolve(acceptanceRootArgument),
);
process.stdout.write(`${JSON.stringify({
	status: 'ok',
	package: index.candidate.package,
	tarballSha256: index.candidate.tarballSha256,
	hostedPortability: 'passed',
	passedCells: index.summary.passedCells,
	nativeDesktopCertification: index.nativeDesktopCertification,
}, null, 2)}\n`);
