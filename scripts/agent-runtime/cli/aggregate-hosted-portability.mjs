#!/usr/bin/env node

import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { buildHostedPortabilityIndexV1 } from './hosted-portability-lib.mjs';

const [candidateRootArgument, cellRootArgument, outputArgument] = process.argv.slice(2);
assert.ok(candidateRootArgument, 'Candidate directory is required.');
assert.ok(cellRootArgument, 'Hosted portability cell directory is required.');
assert.ok(outputArgument, 'Aggregate output path is required.');
const index = await buildHostedPortabilityIndexV1({
	candidateRoot: path.resolve(candidateRootArgument),
	cellRoot: path.resolve(cellRootArgument),
});
await writeFile(path.resolve(outputArgument), `${JSON.stringify(index, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(index.summary, null, 2)}\n`);
