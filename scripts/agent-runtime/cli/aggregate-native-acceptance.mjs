#!/usr/bin/env node

import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
	buildNativeAcceptanceIndexV1,
	loadCanonicalNativeMatrixV1,
} from './native-acceptance-lib.mjs';

const args = process.argv.slice(2);
const named = args.some(argument => argument.startsWith('--'));
const candidateRootArgument = named ? readRequired('--candidate') : args[0];
const matrixArgument = named ? readRequired('--matrix') : args[1];
const cellRootArgument = named ? readRequired('--cells') : args[2];
const outputArgument = named ? readRequired('--output') : args[3];
const expectedSourceCommit = (named ? readOptional('--source-commit') : undefined)
	?? process.env.EXPECTED_SOURCE_COMMIT;
assert.ok(candidateRootArgument, 'Candidate directory is required.');
assert.ok(matrixArgument, 'Frozen native acceptance matrix is required.');
assert.ok(cellRootArgument, 'Native acceptance cell directory is required.');
assert.ok(outputArgument, 'Aggregate evidence output path is required.');

const matrix = await loadCanonicalNativeMatrixV1(path.resolve(matrixArgument));
if (process.env.EXPECTED_CELL_COUNT) {
	assert.match(process.env.EXPECTED_CELL_COUNT, /^[1-9][0-9]*$/u);
	assert.equal(matrix.expectedCells?.native, Number(process.env.EXPECTED_CELL_COUNT));
}
const index = await buildNativeAcceptanceIndexV1({
	candidateRoot: path.resolve(candidateRootArgument),
	matrix,
	cellRoot: path.resolve(cellRootArgument),
});
if (expectedSourceCommit) {
	assert.match(expectedSourceCommit, /^[a-f0-9]{40}$/u);
	assert.equal(index.candidate.sourceCommit, expectedSourceCommit);
}
await writeFile(path.resolve(outputArgument), `${JSON.stringify(index, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({
	status: index.status,
	candidate: index.candidate.package,
	tarballSha256: index.candidate.tarballSha256,
	passedCells: index.summary.passedCells,
	promotionEligible: index.promotionEligible,
}, null, 2)}\n`);

function readRequired(name) {
	const value = readOptional(name);
	assert.ok(value, `${name} is required.`);
	return value;
}

function readOptional(name) {
	const index = args.indexOf(name);
	if (index === -1) return undefined;
	const value = args[index + 1];
	assert.ok(value && !value.startsWith('--'), `${name} requires a value.`);
	return value;
}
