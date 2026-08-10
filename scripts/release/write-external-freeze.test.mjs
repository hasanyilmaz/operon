import assert from 'node:assert/strict';
import {
	copyFile,
	lstat,
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
	EXTERNAL_FREEZE_RELATIVE_PATH,
	LIVE_ACCEPTANCE_RELATIVE_PATH,
	PUBLISHED_FAMILIES,
	readPluginArtifactIdentity,
} from './check-accepted-freeze.mjs';
import {
	readExternalFreezeArguments,
	sanitizePublishedLiveEvidence,
	writeExternalFreeze,
} from './write-external-freeze.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const acceptedAuditResult = Object.freeze({
	status: 'accepted-clean',
	failures: [],
	productionVulnerabilities: 0,
	developmentVulnerabilities: 0,
	directRoot: 'eslint-plugin-obsidianmd',
});

function sourceEvidence(pluginArtifact) {
	const warmPerformance = createWarmPerformance();
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
					publishedFamilies: [
						'update',
						'reminder',
						'transition',
						'timer',
						'relocation',
						'conversion',
						'delete',
					],
					refusedFamilies: [],
					unavailableFamilies: [],
					correctnessAcceptance: {
						runtimeSession: 'fresh-restart',
						operations: createOperationTimings(),
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
					prepared: interruptedEvidence('a'),
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
					prepared: interruptedEvidence('b'),
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

function interruptedEvidence(seed) {
	return {
		status: 'interrupted',
		planRef: seed.repeat(32),
		planFenced: true,
		recoveryOnly: true,
	};
}

function createOperationTimings() {
	return Object.fromEntries([
		'update',
		'reminder',
		'transition',
		'recurrence',
		'timer',
		'relocation',
		'conversion',
		'delete',
	].map(key => [key, { preview: { samples: 20, handlerP95: 1, totalP95: 2 }, apply: { handlerMs: 1, totalMs: 2 } }]));
}

function createWarmPerformance() {
	return {
		status: 'ok',
		runtimeSession: 'single-warm-session',
		samplesPerFamily: 20,
		performance: Object.fromEntries([
			'update',
			'reminder',
			'transition',
			'timer',
			'relocation',
			'conversion',
			'delete',
		].map(key => [key, {
			samples: 20,
			previewHandlerP95: 1,
			previewTotalP95: 2,
			applyHandlerP95: 3,
			applyTotalP95: 4,
		}])),
	};
}

test('external freeze arguments require exact non-duplicated acceptance inputs', () => {
	assert.deepEqual(readExternalFreezeArguments([
		'--live-evidence', '/private/tmp/evidence.json',
		'--accepted-by', 'Hasan Yilmaz',
		'--accepted-at', '2026-08-03T12:03:38.000Z',
	]), {
		liveEvidencePath: '/private/tmp/evidence.json',
		acceptedBy: 'Hasan Yilmaz',
		acceptedAt: '2026-08-03T12:03:38.000Z',
	});
	for (const argv of [
		[],
		['--live-evidence', '/tmp/a', '--accepted-by', 'Maintainer'],
		['--live-evidence', '/tmp/a', '--live-evidence', '/tmp/b', '--accepted-at', 'now'],
		['--unknown', '/tmp/a', '--accepted-by', 'Maintainer', '--accepted-at', 'now'],
	]) {
		assert.throws(() => readExternalFreezeArguments(argv), /OPERON_EXTERNAL_FREEZE_USAGE/u);
	}
});

test('sanitization preserves exact family proof without private live-vault details', async () => {
	const fixture = await createFixture();
	try {
		const pluginArtifact = await readPluginArtifactIdentity(fixture.root);
		const source = sourceEvidence(pluginArtifact);
		const sourceBytes = Buffer.from(`${JSON.stringify(source)}\n`, 'utf8');
		const binding = JSON.parse(await readFile(
			path.join(fixture.root, 'contracts/agent-runtime/published-cli-v1.json'),
			'utf8',
		));
		const sanitized = sanitizePublishedLiveEvidence(source, sourceBytes, binding, pluginArtifact);
		assert.deepEqual(sanitized.publishedFamilies, PUBLISHED_FAMILIES);
		assert.equal(sanitized.familyResults.length, 12);
		assert.deepEqual(sanitized.pluginArtifact, pluginArtifact);
		assert.doesNotMatch(JSON.stringify(sanitized), /private-(?:create|recurrence|relationship|timer)-vault/u);
		assert.match(sanitized.sourceEvidenceSha256, /^[a-f0-9]{64}$/u);
	} finally {
		await rm(fixture.root, { recursive: true, force: true });
	}
});

test('writer creates validated evidence and accepted freeze once with restrictive modes', async () => {
	const fixture = await createFixture();
	try {
		const result = await writeExternalFreeze({
			liveEvidencePath: fixture.sourcePath,
			acceptedBy: 'Hasan Yilmaz',
			acceptedAt: '2026-08-03T12:03:38.000Z',
		}, {
			pluginRoot: fixture.root,
			auditResult: acceptedAuditResult,
		});
		assert.equal(result.freeze.state, 'accepted');
		assert.equal(result.evidence.familyResults.length, 12);
		const freezeStats = await lstat(result.freezePath);
		const evidenceStats = await lstat(result.evidencePath);
		assert.equal(freezeStats.isFile(), true);
		assert.equal(evidenceStats.isFile(), true);
		if (process.platform !== 'win32') {
			assert.equal(freezeStats.mode & 0o777, 0o600);
			assert.equal(evidenceStats.mode & 0o777, 0o600);
		}
		assert.deepEqual(await checkAcceptedReleaseFreeze({ pluginRoot: fixture.root }), result.freeze);
		const before = await Promise.all([
			readFile(result.freezePath),
			readFile(result.evidencePath),
		]);
		await assert.rejects(
			writeExternalFreeze({
				liveEvidencePath: fixture.sourcePath,
				acceptedBy: 'Hasan Yilmaz',
				acceptedAt: '2026-08-03T12:03:38.000Z',
			}, { pluginRoot: fixture.root, auditResult: acceptedAuditResult }),
			/OPERON_EXTERNAL_FREEZE_EXISTS/u,
		);
		assert.deepEqual(await readFile(result.freezePath), before[0]);
		assert.deepEqual(await readFile(result.evidencePath), before[1]);
	} finally {
		await rm(fixture.root, { recursive: true, force: true });
	}
});

test('writer fails closed before output for identity, family, audit, and acceptance drift', async () => {
	for (const mutate of [
		source => { source.tarballSha256 = '0'.repeat(64); },
		source => { source.nodeVersion = '26.0.0'; },
		source => { source.npmVersion = '9.0.0'; },
		source => { source.pluginArtifact.files[0].sha256 = '0'.repeat(64); },
		source => { source.acceptance.publishedFamilies.pop(); },
		source => { source.acceptance.refusedFamilies.push('task.delete'); },
		source => { source.acceptance.familyEvidence.phase8.status = 'failed'; },
		source => { source.acceptance.familyEvidence.phase8.publishedFamilies.reverse(); },
		source => { source.acceptance.familyEvidence.create.exactLineApplied = false; },
		source => { delete source.acceptance.familyEvidence.phase8.correctnessAcceptance.operations.delete; },
		source => { source.acceptance.familyEvidence.recurrence.recovered.samePlan = false; },
		source => { source.acceptance.familyEvidence.timerSession.parentAggregate = 'missing'; },
		source => { source.acceptance.warmPerformance.samplesPerFamily = 19; },
	]) {
		const fixture = await createFixture(mutate);
		try {
			await assert.rejects(
				writeExternalFreeze({
					liveEvidencePath: fixture.sourcePath,
					acceptedBy: 'Hasan Yilmaz',
					acceptedAt: '2026-08-03T12:03:38.000Z',
				}, { pluginRoot: fixture.root, auditResult: acceptedAuditResult }),
			);
			await assertMissingOutputs(fixture.root);
		} finally {
			await rm(fixture.root, { recursive: true, force: true });
		}
	}

	const fixture = await createFixture();
	try {
		await assert.rejects(
			writeExternalFreeze({
				liveEvidencePath: fixture.sourcePath,
				acceptedBy: 'Hasan Yilmaz',
				acceptedAt: '2026-08-03T12:03:38.000Z',
			}, {
				pluginRoot: fixture.root,
				auditResult: { ...acceptedAuditResult, developmentVulnerabilities: 1 },
			}),
		);
		await assertMissingOutputs(fixture.root);
		await assert.rejects(
			writeExternalFreeze({
				liveEvidencePath: fixture.sourcePath,
				acceptedBy: ' Hasan Yilmaz ',
				acceptedAt: '2026-08-03T12:03:38Z',
			}, { pluginRoot: fixture.root, auditResult: acceptedAuditResult }),
		);
		await assertMissingOutputs(fixture.root);
		for (const acceptedBy of ['Hasan Yilmaz\u0007', 'Hasan Yilmaz ', 'Hasan Yilma\u007a\u0307']) {
			await assert.rejects(
				writeExternalFreeze({
					liveEvidencePath: fixture.sourcePath,
					acceptedBy,
					acceptedAt: '2026-08-03T12:03:38.000Z',
				}, { pluginRoot: fixture.root, auditResult: acceptedAuditResult }),
			);
			await assertMissingOutputs(fixture.root);
		}
	} finally {
		await rm(fixture.root, { recursive: true, force: true });
	}
});

test('writer rejects relative and symlink live evidence paths', async () => {
	const fixture = await createFixture();
	try {
		await assert.rejects(
			writeExternalFreeze({
				liveEvidencePath: 'relative-evidence.json',
				acceptedBy: 'Hasan Yilmaz',
				acceptedAt: '2026-08-03T12:03:38.000Z',
			}, { pluginRoot: fixture.root, auditResult: acceptedAuditResult }),
			/OPERON_EXTERNAL_FREEZE_LIVE_EVIDENCE_PATH_INVALID/u,
		);
		const linkPath = path.join(fixture.root, 'source-link.json');
		await symlink(fixture.sourcePath, linkPath);
		await assert.rejects(
			writeExternalFreeze({
				liveEvidencePath: linkPath,
				acceptedBy: 'Hasan Yilmaz',
				acceptedAt: '2026-08-03T12:03:38.000Z',
			}, { pluginRoot: fixture.root, auditResult: acceptedAuditResult }),
			/OPERON_EXTERNAL_FREEZE_LIVE_EVIDENCE_INVALID/u,
		);
		const parentLink = path.join(await realpath(os.tmpdir()), `operon-freeze-parent-link-${process.pid}`);
		await symlink(fixture.root, parentLink);
		try {
			await assert.rejects(
				writeExternalFreeze({
					liveEvidencePath: path.join(parentLink, path.basename(fixture.sourcePath)),
					acceptedBy: 'Hasan Yilmaz',
					acceptedAt: '2026-08-03T12:03:38.000Z',
				}, { pluginRoot: fixture.root, auditResult: acceptedAuditResult }),
				/OPERON_EXTERNAL_FREEZE_LIVE_EVIDENCE_INVALID/u,
			);
		} finally {
			await rm(parentLink);
		}
		await assertMissingOutputs(fixture.root);
	} finally {
		await rm(fixture.root, { recursive: true, force: true });
	}
});

async function createFixture(mutate = () => {}) {
	const root = await mkdtemp(path.join(await realpath(os.tmpdir()), 'operon-freeze-writer-'));
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
	const source = sourceEvidence(pluginArtifact);
	mutate(source);
	const sourcePath = path.join(root, 'source-live-evidence.json');
	await writeFile(sourcePath, `${JSON.stringify(source, null, 2)}\n`, { mode: 0o600 });
	return { root, sourcePath };
}

async function assertMissingOutputs(root) {
	for (const relativePath of [EXTERNAL_FREEZE_RELATIVE_PATH, LIVE_ACCEPTANCE_RELATIVE_PATH]) {
		await assert.rejects(lstat(path.join(root, relativePath)), /ENOENT/u);
	}
}
