import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { loadCandidateBindingV1 } from './native-acceptance-lib.mjs';

export const HOSTED_PORTABILITY_CELL_KIND_V1 = 'operon-cli-hosted-portability-cell';
export const HOSTED_PORTABILITY_INDEX_KIND_V1 = 'operon-cli-hosted-portability-index';

const DIGEST = /^[a-f0-9]{64}$/u;
const PORTABILITY_POLICY = JSON.parse(await readFile(new URL(
	'../../../contracts/agent-runtime/native-acceptance-matrix-v1.json',
	import.meta.url,
)));
const HOSTED_RUNNERS = Object.freeze(PORTABILITY_POLICY.hostedPortability.map(item => ({
	osRef: item.id,
	platform: item.platform,
	runner: item.runner,
})));
const NODE_VERSIONS = Object.freeze(PORTABILITY_POLICY.nodeVersions.map(item => ({
	major: item.major,
	version: item.version,
})));

export function hostedPortabilityCellsV1() {
	const cells = HOSTED_RUNNERS.flatMap(os => NODE_VERSIONS.map(node => ({
		...os,
		nodeMajor: node.major,
		nodeVersion: node.version,
		cellId: `${os.osRef}-node-${node.major}`,
	})));
	assert.equal(cells.length, PORTABILITY_POLICY.expectedCells.hostedPortability);
	assert.equal(cells.length, 9);
	return cells;
}

export function validateHostedPortabilityCellV1(cell, expected, candidate) {
	assert.equal(cell?.evidenceVersion, 1);
	assert.equal(cell.kind, HOSTED_PORTABILITY_CELL_KIND_V1);
	assert.equal(cell.status, 'passed');
	assert.equal(cell.cellId, expected.cellId);
	assert.equal(cell.environment?.osRef, expected.osRef);
	assert.equal(cell.environment?.platform, expected.platform);
	assert.equal(cell.environment?.runner, expected.runner);
	assert.equal(cell.environment?.nodeMajor, expected.nodeMajor);
	assert.equal(cell.environment?.nodeVersion, `v${expected.nodeVersion}`);
	assert.equal(cell.environment?.npmVersion, '11.12.1');
	assert.deepEqual(cell.candidate, candidate);
	assert.deepEqual(cell.checks, {
		immutableTarballInstall: true,
		manifestAndSchemaParity: true,
		packageLifecycle: true,
		transport: true,
		platformSecurity: true,
		noSkippedAssertions: true,
	});
	assert.equal(cell.publishPerformed, false);
	assert.ok(typeof cell.workflow?.repository === 'string' && cell.workflow.repository.includes('/'));
	assert.match(String(cell.workflow?.runId ?? ''), /^[1-9][0-9]*$/u);
	assert.ok(Number.isSafeInteger(cell.workflow?.runAttempt) && cell.workflow.runAttempt >= 1);
	assert.equal(cell.workflow?.sourceCommit, candidate.sourceCommit);
	return cell;
}

export async function buildHostedPortabilityIndexV1({
	candidateRoot,
	cellRoot,
	generatedAt = new Date().toISOString(),
}) {
	const { binding: candidate } = await loadCandidateBindingV1(candidateRoot);
	const expected = hostedPortabilityCellsV1();
	const expectedById = new Map(expected.map(cell => [cell.cellId, cell]));
	const names = (await readdir(cellRoot))
		.filter(name => name.startsWith('hosted-portability-') && name.endsWith('.json'))
		.filter(name => name !== 'hosted-portability-index.json')
		.sort();
	assert.equal(names.length, 9, 'Hosted portability requires exactly 9 cell files.');
	const cells = [];
	const seen = new Set();
	for (const name of names) {
		const bytes = await readFile(path.join(cellRoot, name));
		const cell = JSON.parse(bytes.toString('utf8'));
		const expectedCell = expectedById.get(cell.cellId);
		assert.ok(expectedCell, `Unknown hosted portability cell ${String(cell.cellId)}.`);
		assert.equal(seen.has(cell.cellId), false, `Duplicate hosted portability cell ${cell.cellId}.`);
		seen.add(cell.cellId);
		validateHostedPortabilityCellV1(cell, expectedCell, candidate);
		cells.push({
			cellId: cell.cellId,
			evidenceFile: name,
			sha256: sha256(bytes),
			osRef: expectedCell.osRef,
			nodeMajor: expectedCell.nodeMajor,
		});
	}
	assert.equal(seen.size, 9);
	cells.sort((left, right) => left.cellId.localeCompare(right.cellId));
	return {
		evidenceVersion: 1,
		kind: HOSTED_PORTABILITY_INDEX_KIND_V1,
		status: 'passed',
		generatedAt,
		candidate,
		cells,
		summary: {
			requiredCells: 9,
			passedCells: 9,
			failedCells: 0,
			skippedAssertions: 0,
			platforms: ['darwin', 'linux', 'win32'],
			nodeMajors: [22, 24, 26],
		},
		nativeDesktopCertification: 'optional-not-required-for-public-beta',
		publishPerformed: false,
	};
}

export async function verifyHostedPortabilityBundleV1(candidateRoot, acceptanceRoot) {
	const index = JSON.parse(await readFile(
		path.join(acceptanceRoot, 'hosted-portability-index.json'),
		'utf8',
	));
	assert.equal(index.kind, HOSTED_PORTABILITY_INDEX_KIND_V1);
	assert.equal(index.status, 'passed');
	assert.match(index.generatedAt, /^\d{4}-\d{2}-\d{2}T/u);
	const rebuilt = await buildHostedPortabilityIndexV1({
		candidateRoot,
		cellRoot: acceptanceRoot,
		generatedAt: index.generatedAt,
	});
	assert.deepEqual(index, rebuilt);
	assert.equal(index.candidate.platforms.darwin, 'supported');
	assert.equal(index.candidate.platforms.linux, 'acceptance-required');
	assert.equal(index.candidate.platforms.win32, 'acceptance-required');
	assert.equal(index.candidate.platforms.wsl, 'unsupported');
	for (const key of [
		'tarballSha256',
		'candidateEvidenceSha256',
		'cliManifestSha256',
		'aggregateContractSha256',
	]) assert.match(index.candidate[key] ?? '', DIGEST);
	return index;
}

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}
