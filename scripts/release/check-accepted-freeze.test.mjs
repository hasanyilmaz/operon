import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
	appendFile,
	copyFile,
	mkdtemp,
	mkdir,
	readFile,
	realpath,
	rm,
	symlink,
	writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	checkAcceptedReleaseFreeze,
	externalFreezeAggregate,
	PUBLIC_V1_FREEZE_STALE,
	PUBLISHED_FAMILIES,
	readPluginArtifactIdentity,
} from './check-accepted-freeze.mjs';
import { writeExternalFreeze } from './write-external-freeze.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const auditResult = Object.freeze({
	status: 'accepted-clean',
	failures: [],
	productionVulnerabilities: 0,
	developmentVulnerabilities: 0,
	directRoot: 'eslint-plugin-obsidianmd',
});

test('checker accepts exact schema-valid binding, evidence, semantics, and aggregate read-only', async () => {
	const fixture = await createAcceptedFixture();
	try {
		const paths = [fixture.freezePath, fixture.evidencePath, fixture.bindingPath];
		const before = await Promise.all(paths.map(target => readFile(target)));
		const freeze = await checkAcceptedReleaseFreeze({ pluginRoot: fixture.root });
		assert.equal(freeze.state, 'accepted');
		assert.deepEqual(freeze.liveAcceptance.publishedFamilies, PUBLISHED_FAMILIES);
		const after = await Promise.all(paths.map(target => readFile(target)));
		assert.deepEqual(after, before);
	} finally {
		await rm(fixture.root, { recursive: true, force: true });
	}
});

test('checker maps schema, acceptance, audit, and aggregate drift to the stale code', async () => {
	for (const mutate of [
		freeze => { freeze.unreviewed = true; },
		freeze => { freeze.state = 'provisional'; },
		freeze => { freeze.audit.validation.result.developmentVulnerabilities = 1; },
		freeze => { freeze.maintainerAcceptance.acceptedBy = ''; },
		freeze => { freeze.maintainerAcceptance.acceptedBy = ' Hasan Yilmaz'; },
		freeze => { freeze.maintainerAcceptance.acceptedBy = 'Hasan Yilmaz\u0007'; },
		freeze => { freeze.maintainerAcceptance.acceptedBy = 'Hasan Yilma\u007a\u0307'; },
		freeze => { freeze.maintainerAcceptance.acceptedAt = '2026-08-03T12:03:38Z'; },
		freeze => { freeze.liveAcceptance.publishedFamilies.reverse(); },
		freeze => { freeze.inputsAggregateSha256 = '0'.repeat(64); },
	]) {
		const fixture = await createAcceptedFixture();
		try {
			const freeze = JSON.parse(await readFile(fixture.freezePath, 'utf8'));
			mutate(freeze);
			if (freeze.inputsAggregateSha256 !== '0'.repeat(64)) {
				freeze.inputsAggregateSha256 = externalFreezeAggregate(freeze);
			}
			await writeFile(fixture.freezePath, `${JSON.stringify(freeze, null, 2)}\n`, 'utf8');
			await assertStale(checkAcceptedReleaseFreeze({ pluginRoot: fixture.root }));
		} finally {
			await rm(fixture.root, { recursive: true, force: true });
		}
	}
});

test('checker rejects evidence byte drift and semantic family drift with only the stale code', async () => {
	const byteDrift = await createAcceptedFixture();
	try {
		await appendFile(byteDrift.evidencePath, ' ', 'utf8');
		await assertStale(checkAcceptedReleaseFreeze({ pluginRoot: byteDrift.root }));
	} finally {
		await rm(byteDrift.root, { recursive: true, force: true });
	}

	const semanticDrift = await createAcceptedFixture();
	try {
		const evidence = JSON.parse(await readFile(semanticDrift.evidencePath, 'utf8'));
		evidence.familyResults[0].status = 'failed';
		await writeFile(semanticDrift.evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
		const freeze = JSON.parse(await readFile(semanticDrift.freezePath, 'utf8'));
		const evidenceBytes = await readFile(semanticDrift.evidencePath);
		freeze.liveAcceptance.evidence.bytes = evidenceBytes.byteLength;
		freeze.liveAcceptance.evidence.sha256 = digest(evidenceBytes);
		freeze.inputsAggregateSha256 = externalFreezeAggregate(freeze);
		await writeFile(semanticDrift.freezePath, `${JSON.stringify(freeze, null, 2)}\n`, 'utf8');
		await assertStale(checkAcceptedReleaseFreeze({ pluginRoot: semanticDrift.root }));
	} finally {
		await rm(semanticDrift.root, { recursive: true, force: true });
	}
});

test('checker rejects binding-byte drift, symlink inputs, and missing artifacts with stale code', async () => {
	const pluginArtifactDrift = await createAcceptedFixture();
	try {
		await appendFile(path.join(pluginArtifactDrift.root, 'main.js'), 'drift', 'utf8');
		await assertStale(checkAcceptedReleaseFreeze({ pluginRoot: pluginArtifactDrift.root }));
	} finally {
		await rm(pluginArtifactDrift.root, { recursive: true, force: true });
	}

	const bindingDrift = await createAcceptedFixture();
	try {
		await appendFile(bindingDrift.bindingPath, ' ', 'utf8');
		await assertStale(checkAcceptedReleaseFreeze({ pluginRoot: bindingDrift.root }));
	} finally {
		await rm(bindingDrift.root, { recursive: true, force: true });
	}

	const symlinkFixture = await createAcceptedFixture();
	try {
		const realFreeze = `${symlinkFixture.freezePath}.real`;
		await copyFile(symlinkFixture.freezePath, realFreeze);
		await rm(symlinkFixture.freezePath);
		await symlink(realFreeze, symlinkFixture.freezePath);
		await assertStale(checkAcceptedReleaseFreeze({ pluginRoot: symlinkFixture.root }));
	} finally {
		await rm(symlinkFixture.root, { recursive: true, force: true });
	}

	const parentSymlinkFixture = await createAcceptedFixture();
	const linkedRoot = `${parentSymlinkFixture.root}-link`;
	try {
		await symlink(parentSymlinkFixture.root, linkedRoot);
		await assertStale(checkAcceptedReleaseFreeze({ pluginRoot: linkedRoot }));
	} finally {
		await rm(linkedRoot, { force: true });
		await rm(parentSymlinkFixture.root, { recursive: true, force: true });
	}

	const missingRoot = await mkdtemp(path.join(os.tmpdir(), 'operon-freeze-missing-'));
	try {
		await assertStale(checkAcceptedReleaseFreeze({ pluginRoot: missingRoot }));
	} finally {
		await rm(missingRoot, { recursive: true, force: true });
	}
});

async function createAcceptedFixture() {
	const root = await mkdtemp(path.join(await realpath(os.tmpdir()), 'operon-freeze-checker-'));
	const contracts = path.join(root, 'contracts', 'agent-runtime');
	await mkdir(contracts, { recursive: true });
	for (const file of ['published-cli-v1.json', 'published-cli-v1.schema.json']) {
		await copyFile(
			path.join(pluginRoot, 'scripts', 'release', 'fixtures', 'legacy-cli-1.0.8', file),
			path.join(contracts, file),
		);
	}
	await copyFile(
		path.join(pluginRoot, 'contracts', 'agent-runtime', 'public-v1-external-freeze.schema.json'),
		path.join(contracts, 'public-v1-external-freeze.schema.json'),
	);
	await Promise.all([
		writeFile(path.join(root, 'main.js'), 'fixture-main\n'),
		writeFile(path.join(root, 'manifest.json'), '{"version":"3.0.2"}\n'),
		writeFile(path.join(root, 'styles.css'), 'fixture-styles\n'),
	]);
	const pluginArtifact = await readPluginArtifactIdentity(root);
	const sourcePath = path.join(root, 'source.json');
	await writeFile(sourcePath, `${JSON.stringify(sourceEvidence(pluginArtifact), null, 2)}\n`, { mode: 0o600 });
	const result = await writeExternalFreeze({
		liveEvidencePath: sourcePath,
		acceptedBy: 'Hasan Yilmaz',
		acceptedAt: '2026-08-03T12:03:38.000Z',
	}, { pluginRoot: root, auditResult });
	return {
		root,
		freezePath: result.freezePath,
		evidencePath: result.evidencePath,
		bindingPath: path.join(contracts, 'published-cli-v1.json'),
	};
}

function sourceEvidence(pluginArtifact) {
	const warmPerformance = {
		status: 'ok',
		runtimeSession: 'single-warm-session',
		samplesPerFamily: 20,
		performance: Object.fromEntries(
			['update', 'reminder', 'transition', 'timer', 'relocation', 'conversion', 'delete']
				.map(key => [key, {
					samples: 20,
					previewHandlerP95: 1,
					previewTotalP95: 2,
					applyHandlerP95: 3,
					applyTotalP95: 4,
				}]),
		),
	};
	const interrupted = seed => ({
		status: 'interrupted',
		planRef: seed.repeat(32),
		planFenced: true,
		recoveryOnly: true,
	});
	return {
		kind: 'operon-published-cli-runtime-live-acceptance',
		package: '@stratejya/operon-cli@1.0.8',
		tarballSha256: '8638e108569f7a17de39a8c7981f48fa609dab47dc2d86e18bf2453046c540c8',
		runtimeContractDigest: '407f3a222f8c59a9622038e99e9345d0d34882fd358149b38bce5354ae0ca92b',
		pluginArtifact: JSON.parse(JSON.stringify(pluginArtifact)),
		nodeVersion: '24.18.0',
		npmVersion: '11.12.1',
		acceptance: {
			status: 'ok',
			publishedFamilies: [...PUBLISHED_FAMILIES],
			refusedFamilies: [],
			unavailableFamilies: [],
			familyEvidence: {
				create: {
					status: 'ok',
					vault: 'operon-agent-runtime-phase1-3-0-2',
					manifestGate: true,
					catalogGate: true,
					templateCandidatesContentFree: true,
					exactLineApplied: true,
					templateBodyApplied: true,
					sameSourceGraphAtomic: true,
					mixedFileParentInlineChildShiftVerified: true,
					crossSourceParentRelatedConfirmed: true,
					crossSourceDependencyTransactional: true,
					recoveryStatus: 'applied',
				},
				phase8: {
					status: 'ok',
					publishedFamilies: ['update', 'reminder', 'transition', 'timer', 'relocation', 'conversion', 'delete'],
					refusedFamilies: [],
					unavailableFamilies: [],
					correctnessAcceptance: {
						runtimeSession: 'fresh-restart',
						operations: Object.fromEntries(
							['update', 'reminder', 'transition', 'recurrence', 'timer', 'relocation', 'conversion', 'delete']
								.map(key => [key, {
									preview: { samples: 20, handlerP95: 1, totalP95: 2 },
									apply: { handlerMs: 1, totalMs: 2 },
								}]),
						),
					},
					warmPerformance,
				},
				recurrence: {
					status: 'ok',
					vaultPath: '/private/tmp/cli-test-vault',
					happy: {
						status: 'ok',
						vaultPath: '/private/tmp/cli-test-vault',
						vaultIdentityMatched: true,
						runtimeReady: true,
						persistenceIdle: true,
						requestRootClean: true,
						start: 'applied',
						thisTask: 'applied',
						thisAndFollowing: 'applied',
						clear: 'applied',
						recoveryVerified: false,
						settingsUnchanged: true,
					},
					prepared: interrupted('a'),
					reload: { action: 'reload' },
					recovered: {
						status: 'ok',
						recovery: 'applied',
						replay: 'already-applied',
						samePlan: true,
						sourceAndSeriesVerified: true,
					},
					recoveryVerified: true,
				},
				relationship: {
					status: 'ok',
					happy: {
						status: 'ok',
						vault: 'cli-test-vault',
						parentSetReparentClear: true,
						blockingReciprocalReplaceClear: true,
						blockedByReciprocalReplaceClear: true,
						exactDescriptionSelector: true,
						localNoChange: true,
					},
					prepared: interrupted('b'),
					reload: { action: 'restart' },
					recovered: {
						status: 'ok',
						recovery: 'already-applied',
						samePlan: true,
						reciprocalDependencyVerified: true,
					},
				},
				timerSession: {
					status: 'ok',
					vaultPath: '/private/tmp/cli-test-vault',
					add: 'applied',
					update: 'applied',
					duplicateRange: 'verified',
					remove: 'confirmed-applied',
					lastItemClear: 'verified',
					midnight: 'verified',
					parentAggregate: 'verified',
				},
				pinnedState: { status: 'ok', pin: 'applied', unpin: 'applied' },
			},
			warmPerformance,
		},
	};
}

async function assertStale(promise) {
	await assert.rejects(promise, error => {
		assert.equal(error.message, PUBLIC_V1_FREEZE_STALE);
		return true;
	});
}

function digest(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}
