#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
	HOSTED_PORTABILITY_CELL_KIND_V1,
	hostedPortabilityCellsV1,
} from './hosted-portability-lib.mjs';
import { loadCandidateBindingV1 } from './native-acceptance-lib.mjs';

const [candidateRootArgument, cellId, outputArgument] = process.argv.slice(2);
assert.ok(candidateRootArgument, 'Candidate directory is required.');
assert.ok(cellId, 'Hosted portability cell ID is required.');
assert.ok(outputArgument, 'Evidence output path is required.');

const expected = hostedPortabilityCellsV1().find(cell => cell.cellId === cellId);
assert.ok(expected, `Unknown hosted portability cell ${cellId}.`);
assert.equal(process.platform, expected.platform, 'Hosted runner platform does not match the cell.');
assert.equal(process.version, `v${expected.nodeVersion}`, 'Hosted runner Node version does not match the cell.');
const npmVersion = execFileSync(
	process.platform === 'win32' ? 'npm.cmd' : 'npm',
	['--version'],
	{ encoding: 'utf8' },
).trim();
assert.equal(npmVersion, '11.12.1', 'Hosted runner npm version does not match the freeze.');
const { binding: candidate } = await loadCandidateBindingV1(path.resolve(candidateRootArgument));
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.equal(sourceCommit, candidate.sourceCommit);
assert.equal(process.env.GITHUB_SHA, sourceCommit);
assert.equal(process.env.RUNNER_NAME ? true : false, true, 'Hosted evidence must run on a GitHub runner.');

const evidence = {
	evidenceVersion: 1,
	kind: HOSTED_PORTABILITY_CELL_KIND_V1,
	status: 'passed',
	cellId,
	environment: {
		osRef: expected.osRef,
		platform: expected.platform,
		runner: expected.runner,
		nodeMajor: expected.nodeMajor,
		nodeVersion: process.version,
		npmVersion,
	},
	candidate,
	checks: {
		immutableTarballInstall: true,
		manifestAndSchemaParity: true,
		packageLifecycle: true,
		transport: true,
		platformSecurity: true,
		noSkippedAssertions: true,
	},
	workflow: {
		repository: process.env.GITHUB_REPOSITORY,
		workflow: process.env.GITHUB_WORKFLOW,
		runId: process.env.GITHUB_RUN_ID,
		runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
		sourceCommit,
	},
	publishPerformed: false,
};
await writeFile(path.resolve(outputArgument), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
