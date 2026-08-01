import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';

import {
	HOSTED_PORTABILITY_CELL_KIND_V1,
	buildHostedPortabilityIndexV1,
	hostedPortabilityCellsV1,
	verifyHostedPortabilityBundleV1,
} from './hosted-portability-lib.mjs';

const schema = JSON.parse(await readFile(
	new URL('../../../contracts/agent-runtime/hosted-portability-v1.schema.json', import.meta.url),
	'utf8',
));

test('hosted portability defines exactly three platforms by three Node majors', () => {
	const cells = hostedPortabilityCellsV1();
	assert.equal(cells.length, 9);
	assert.deepEqual([...new Set(cells.map(cell => cell.platform))].sort(), ['darwin', 'linux', 'win32']);
	assert.deepEqual([...new Set(cells.map(cell => cell.nodeMajor))].sort(), [22, 24, 26]);
	assert.equal(new Set(cells.map(cell => cell.cellId)).size, 9);
});

test('hosted portability aggregate is schema-valid and rejects candidate drift', async () => {
	const fixture = await createFixture();
	try {
		const index = await buildHostedPortabilityIndexV1(fixture);
		await writeFile(
			path.join(fixture.cellRoot, 'hosted-portability-index.json'),
			`${JSON.stringify(index, null, 2)}\n`,
		);
		const ajv = new Ajv2020({ strict: true, validateFormats: false });
		const validate = ajv.compile(schema);
		assert.equal(validate(index), true, JSON.stringify(validate.errors));
		const verified = await verifyHostedPortabilityBundleV1(
			fixture.candidateRoot,
			fixture.cellRoot,
		);
		assert.equal(verified.summary.passedCells, 9);
		const first = path.join(
			fixture.cellRoot,
			`hosted-portability-${hostedPortabilityCellsV1()[0].cellId}.json`,
		);
		const cell = JSON.parse(await readFile(first, 'utf8'));
		cell.candidate.tarballSha256 = '0'.repeat(64);
		await writeFile(first, `${JSON.stringify(cell, null, 2)}\n`);
		await assert.rejects(
			verifyHostedPortabilityBundleV1(fixture.candidateRoot, fixture.cellRoot),
		/Tarball|Expected values|deep-equal|actual/u,
		);
	} finally {
		await rm(fixture.root, { recursive: true, force: true });
	}
});

async function createFixture() {
	const root = await mkdtemp(path.join(tmpdir(), 'operon-hosted-portability-'));
	const candidateRoot = path.join(root, 'candidate');
	const cellRoot = path.join(root, 'cells');
	await mkdir(candidateRoot);
	await mkdir(cellRoot);
	const tarball = 'operon-cli-9.8.7.tgz';
	const tarballBytes = Buffer.from('immutable hosted candidate\n');
	await writeFile(path.join(candidateRoot, tarball), tarballBytes);
	const digest = value => createHash('sha256').update(value).digest('hex');
	const evidence = {
		evidenceVersion: 1,
		kind: 'operon-cli-release-candidate',
		package: 'operon-cli@9.8.7',
		tarball,
		sha256: digest(tarballBytes),
		cliManifestSha256: '1'.repeat(64),
		aggregateContractSha256: '2'.repeat(64),
		platforms: {
			darwin: 'supported',
			linux: 'acceptance-required',
			win32: 'acceptance-required',
			wsl: 'unsupported',
		},
		source: {
			ref: 'cli-v9.8.7',
			commit: 'a'.repeat(40),
			trackedTreeClean: true,
		},
		compatiblePublicPlugin: {
			evidenceVersion: 2,
			kind: 'operon-public-plugin-release',
			pluginId: 'operon',
			pluginVersion: '9.8.7',
			releaseTag: '9.8.7',
			mainJsSha256: '3'.repeat(64),
			manifestSha256: '4'.repeat(64),
			stylesCssSha256: '5'.repeat(64),
		},
	};
	const evidenceBytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`);
	await writeFile(path.join(candidateRoot, 'candidate-evidence.json'), evidenceBytes);
	const candidate = {
		candidateKind: evidence.kind,
		package: evidence.package,
		tarballSha256: evidence.sha256,
		candidateEvidenceSha256: digest(evidenceBytes),
		sourceRef: evidence.source.ref,
		sourceCommit: evidence.source.commit,
		compatiblePublicPlugin: evidence.compatiblePublicPlugin,
		cliManifestSha256: evidence.cliManifestSha256,
		aggregateContractSha256: evidence.aggregateContractSha256,
		platforms: evidence.platforms,
	};
	for (const expected of hostedPortabilityCellsV1()) {
		const cell = {
			evidenceVersion: 1,
			kind: HOSTED_PORTABILITY_CELL_KIND_V1,
			status: 'passed',
			cellId: expected.cellId,
			environment: {
				osRef: expected.osRef,
				platform: expected.platform,
				runner: expected.runner,
				nodeMajor: expected.nodeMajor,
				nodeVersion: `v${expected.nodeVersion}`,
				npmVersion: '11.12.1',
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
				repository: 'hasanyilmaz/operon',
				workflow: 'Operon CLI candidate artifact',
				runId: '123',
				runAttempt: 1,
				sourceCommit: evidence.source.commit,
			},
			publishPerformed: false,
		};
		await writeFile(
			path.join(cellRoot, `hosted-portability-${expected.cellId}.json`),
			`${JSON.stringify(cell, null, 2)}\n`,
		);
	}
	return { root, candidateRoot, cellRoot };
}
