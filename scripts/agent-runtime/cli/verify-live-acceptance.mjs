#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { verifyNativeAcceptanceBundleV1 } from './native-acceptance-lib.mjs';

const [candidateRootArgument, acceptanceRootArgument] = process.argv.slice(2);
assert.ok(candidateRootArgument, 'Candidate directory is required.');
assert.ok(acceptanceRootArgument, 'Acceptance directory is required.');

const candidateRoot = path.resolve(candidateRootArgument);
const acceptanceRoot = path.resolve(acceptanceRootArgument);
if (await fileExists(path.join(acceptanceRoot, 'native-acceptance-index.json'))) {
	const index = await verifyNativeAcceptanceBundleV1(candidateRoot, acceptanceRoot);
	process.stdout.write(`${JSON.stringify({
		status: 'ok',
		package: index.candidate.package,
		tarballSha256: index.candidate.tarballSha256,
		nativeAcceptance: 'passed',
		passedCells: index.summary.passedCells,
		promotionEligible: index.promotionEligible,
	}, null, 2)}\n`);
} else {
	await verifyLegacyMacAcceptance();
}

async function verifyLegacyMacAcceptance() {
	const candidate = JSON.parse(
		await readFile(path.join(candidateRoot, 'candidate-evidence.json'), 'utf8'),
	);
	const acceptance = JSON.parse(
		await readFile(path.join(acceptanceRoot, 'candidate-live-acceptance.json'), 'utf8'),
	);

	assert.equal(acceptance.kind, 'operon-cli-candidate-live-acceptance');
	assert.equal(acceptance.package, candidate.package);
	assert.equal(acceptance.tarballSha256, candidate.sha256);
	assert.deepEqual(acceptance.compatiblePublicPlugin, candidate.compatiblePublicPlugin);
	assert.equal(candidate.compatiblePublicPlugin?.kind, 'operon-public-plugin-release');
	assert.equal(
		acceptance.runtime?.pluginVersion,
		candidate.compatiblePublicPlugin?.pluginVersion,
	);
	assert.equal(acceptance.platform, 'darwin');
	assert.equal(acceptance.runtime?.phase, 'ready');
	assert.equal(acceptance.runtime?.v8Persistence, 'idle');
	assert.equal(acceptance.tasksFinder?.availability, 'available');
	assert.equal(acceptance.readOnlyResources?.unchanged, true);
	assert.ok(acceptance.readOnlyResources?.fileCount > 0);
	assert.match(acceptance.readOnlyResources?.sha256 ?? '', /^[a-f0-9]{64}$/u);
	const completion = acceptance.sanitizedMutationCompletion;
	assert.equal(completion?.status, 'passed');
	assert.deepEqual(
		[...completion.publishedFamilies].sort(),
		[
			'task.convert',
			'task.create',
			'task.delete',
			'task.inline-relocate',
			'task.pinned-state',
			'task.recurrence',
			'task.relationship',
			'task.reminder-item',
			'task.transition',
			'task.update',
			'timer.control',
			'timer.session',
		],
	);
	assert.deepEqual(completion.refusedFamilies, []);
	assert.deepEqual(completion.unavailableFamilies, []);
	assert.ok(completion.samplesPerFamily >= 20);
	assert.deepEqual(
		Object.keys(completion.performance).sort(),
		['conversion', 'delete', 'relocation', 'reminder', 'timer', 'transition', 'update'],
	);
	for (const [family, performance] of Object.entries(completion.performance)) {
		assert.ok(performance.samples >= 20, `${family} has fewer than 20 warm samples.`);
		assert.ok(performance.previewHandlerP95 < 100, `${family} preview p95 exceeded 100ms.`);
		const applyLimit = ['update', 'reminder', 'transition', 'timer'].includes(family)
			? 2_000
			: 3_000;
		assert.ok(
			performance.applyHandlerP95 < applyLimit,
			`${family} apply p95 exceeded ${applyLimit}ms.`,
		);
	}
	assert.equal(acceptance.publishPerformed, false);

	process.stdout.write(`${JSON.stringify({
		status: 'ok',
		package: acceptance.package,
		tarballSha256: acceptance.tarballSha256,
		liveAcceptance: 'passed',
	}, null, 2)}\n`);
}

async function fileExists(filePath) {
	try {
		await readFile(filePath);
		return true;
	} catch (error) {
		if (error?.code === 'ENOENT') return false;
		throw error;
	}
}
