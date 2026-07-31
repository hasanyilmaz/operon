#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { arch, hostname, platform, release } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	assertCliSpeedStage1Vault,
	CLI_SPEED_STAGE1_VAULT,
} from './cli-speed-stage1-core.mjs';
import {
	evaluateStage6Evidence,
	migrateStage6CompactCheckpointV1,
	recoverStage61InterruptedCheckpointV1,
	STAGE6_BASELINES,
	STAGE6_PROFILE,
	STAGE6_REQUIRED_UNITS,
} from './cli-speed-stage6-core.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDirectory, '../../..');
const resultsRoot = '/private/tmp/operon-agent-runtime-results';
const checkpointDirectory = path.join(resultsRoot, 'stage6-close');
const checkpointPath = path.join(checkpointDirectory, 'checkpoint.json');
const finalPath = path.join(resultsRoot, 'cli-speed-stage6.json');
const workerPath = path.join(scriptDirectory, 'cli-speed-stage6-session.mjs');
const candidateCli = path.join(pluginRoot, 'packages/operon-cli/dist/operon.mjs');
const baselineCli = path.join(pluginRoot, 'build/stage51/operon-production.mjs');
const candidatePlugin = path.join(pluginRoot, 'main.js');
const SEALED_STAGE51_CLI_SHA256 =
	'b913aea3e8da77a537cfd90f319232af59c2f45dcef8d3fe5039c9146d9a8f20';
const STAGE6_UNIT_REVISIONS = Object.freeze({
	'compact-single': 3,
	'compact-create5': 4,
	'compact-create20': 4,
	'batch-retention': 5,
	'read-batch': 9,
	soak: 4,
	'negative-contract': 2,
});
const STAGE6_TO_61_COMPACT_SEAL = Object.freeze({
	checkpointRevision: 44,
	identityDigest: 'd439cc7bf73f9bc272f31e8601c921aac0baef86580d6a571c32f634886f85f0',
	units: Object.freeze({
		'compact-single': Object.freeze({
			dependencyDigest: '935590b630d3ff5b44af36a7dd9c8d04129630757c6fd4d1bb73c76b9613cc38',
			evidenceDigest: 'cd4823a967ee0c7684702ae52ec0cd05b600a6bdcba32121385c4bcbec6c630e',
		}),
		'compact-create5': Object.freeze({
			dependencyDigest: '0111211ecf6826b7b66e27d3ae5de521916798dead9cafef7fe6b1caca6c69ed',
			evidenceDigest: '1f424f7f34e630643681b10c094880a7209778e706954ce263eb68d8e67cbad5',
		}),
		'compact-create20': Object.freeze({
			dependencyDigest: 'e97d64fc7261b7f72e219cfe87963ba253af480acbc26b5ad7cca8aedc7c2b3f',
			evidenceDigest: '078e4b4596da8f460f166abad609f1a56e90acd8e10cab038f47bbef8e20fe9c',
		}),
		'batch-retention': Object.freeze({
			dependencyDigest: '82415f1712e9b7b3525a1852736d4df114d4915eaa15026eeb11fd36df11f8db',
			evidenceDigest: '7af6eee9376df6093bc6e67217d500041e4274d7e469403ebda685f4f81f2244',
		}),
	}),
});
const STAGE61_INTERRUPTED_RECOVERY_SEAL = Object.freeze({
	checkpointRevision: 46,
	identityDigest: '0c8531aa53c4b8c5e5f872f34047a159e44d2862ce6bb75faac6d15a685021e6',
	units: Object.freeze({
		'compact-single': Object.freeze({
			dependencyDigest: '51d5843caaf21d8408bbfd7b1a3c34aeefdb419db48eebbe7d63ffd6cb0905c1',
			evidenceDigest: 'ca8950977ae695cbfa64f881beaf8c2736e6a9f4bc3a1b6340e6d0789aba5bbd',
		}),
		'compact-create20': STAGE6_TO_61_COMPACT_SEAL.units['compact-create20'],
		'batch-retention': STAGE6_TO_61_COMPACT_SEAL.units['batch-retention'],
	}),
});

assert.deepEqual(process.argv.slice(2), [], 'Stage 6 live runner accepts no arguments.');
assertCliSpeedStage1Vault(CLI_SPEED_STAGE1_VAULT, { lstatSync, realpathSync });
mkdirSync(checkpointDirectory, { recursive: true });
buildCandidateArtifacts();
for (const target of [candidateCli, baselineCli, candidatePlugin, workerPath]) {
	assert.equal(existsSync(target), true, `Missing Stage 6 dependency: ${target}`);
}
assert.equal(
	sha256File(baselineCli),
	SEALED_STAGE51_CLI_SHA256,
	'Stage 6 requires the sealed Stage 5.1 production CLI baseline.',
);

const identity = buildIdentity();
let checkpoint = loadCheckpoint();
checkpoint = migrateStage6To61CompactEvidence(checkpoint, identity);
checkpoint = recoverInterruptedStage61Evidence(checkpoint, identity);
for (const unit of STAGE6_REQUIRED_UNITS) {
	const digest = dependencyDigest(unit, identity);
	if (validUnit(checkpoint.units[unit], digest)) continue;
	const result = runUnit(unit);
	checkpoint.units[unit] = {
		status: result.status === 0 ? 'passed' : 'failed',
		recordedAt: new Date().toISOString(),
		dependencyDigest: digest,
		evidencePath: result.path,
		evidenceDigest: existsSync(result.path) ? sha256File(result.path) : null,
		...(result.status === 0 ? {} : {
			failure: {
				exitCode: result.status,
				reason: result.reason,
				stdout: result.stdout.slice(-8192),
				stderr: result.stderr.slice(-8192),
			},
		}),
	};
	checkpoint.revision += 1;
	atomicWriteJson(checkpointPath, checkpoint);
	if (result.status !== 0) break;
}

const missing = STAGE6_REQUIRED_UNITS.filter(unit => (
	!validUnit(checkpoint.units[unit], dependencyDigest(unit, identity))
));
const units = Object.fromEntries(STAGE6_REQUIRED_UNITS.map(unit => [
	unit,
	missing.includes(unit)
		? { status: 'missing' }
		: readJson(checkpoint.units[unit].evidencePath),
]));
const gateInput = {
	compactSingle: units['compact-single'],
	compactCreate5: units['compact-create5'],
	compactCreate20: units['compact-create20'],
	batchRetention: units['batch-retention'],
	readBatch: units['read-batch'],
	soak: units.soak,
	negativeContract: units['negative-contract'],
	bundle: { candidateBytes: statSync(candidatePlugin).size },
};
const gates = evaluateStage6Evidence(gateInput);
const evidence = {
	schemaVersion: 1,
	suite: 'operon-cli-speed-stage6',
	status: missing.length === 0 && gates.ok ? 'passed' : 'failed',
	recordedAt: new Date().toISOString(),
	vaultPath: CLI_SPEED_STAGE1_VAULT,
	profile: STAGE6_PROFILE,
	baselines: STAGE6_BASELINES,
	identity,
	checkpoint: { path: checkpointPath, revision: checkpoint.revision },
	units,
	bundle: gateInput.bundle,
	gates,
	...(missing.length > 0 ? { incompleteUnits: missing } : {}),
};
atomicWriteJson(finalPath, evidence);
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
if (evidence.status !== 'passed') process.exitCode = 1;

function runUnit(unit) {
	const destination = path.join(checkpointDirectory, `${unit}.json`);
	const result = spawnSync(process.execPath, [workerPath, '--unit', unit], {
		cwd: pluginRoot,
		encoding: 'utf8',
		env: {
			...process.env,
			OPERON_CLI_STAGE6_CANDIDATE: candidateCli,
			OPERON_CLI_STAGE6_BASELINE: baselineCli,
			OPERON_CLI_STAGE6_RESULT_PATH: destination,
		},
		maxBuffer: 32 * 1024 * 1024,
		timeout: unit === 'soak' ? 20 * 60_000 : 10 * 60_000,
	});
	return {
		status: result.status ?? 1,
		path: destination,
		stdout: result.stdout ?? '',
		stderr: result.stderr ?? '',
		reason: result.error?.message ?? (result.status === 0 ? null : 'stage6-worker-failed'),
	};
}

function buildCandidateArtifacts() {
	for (const args of [
		['packages/operon-cli/build.mjs'],
		['esbuild.config.mjs', 'production'],
	]) {
		const result = spawnSync(process.execPath, args, {
			cwd: pluginRoot,
			encoding: 'utf8',
			env: cleanBuildEnv(),
		});
		assert.equal(result.status, 0, result.stderr || result.stdout);
	}
}

function cleanBuildEnv() {
	const env = { ...process.env };
	delete env.OPERON_CLI_PERSISTENT_READ_BUILD;
	delete env.OPERON_CLI_FRAME_TIMING_BUILD;
	return env;
}

function buildIdentity() {
	const fixtureDigest = sha256Json({
		generator: sha256File(path.join(
			pluginRoot, 'scripts/agent-runtime/create-sanitized-vault.mjs',
		)),
		settings: sha256File(path.join(
			pluginRoot, 'scripts/agent-runtime/sanitized-vault-settings.ts',
		)),
	});
	const members = {
		candidateCli: sha256File(candidateCli),
		baselineCli: sha256File(baselineCli),
		candidatePlugin: sha256File(candidatePlugin),
		harness: sha256File(workerPath),
		core: sha256File(path.join(scriptDirectory, 'cli-speed-stage6-core.mjs')),
		runner: sha256File(fileURLToPath(import.meta.url)),
		productionSwitch: sha256File(path.join(pluginRoot, 'operon-build-config.mjs')),
		fixtureDigest,
		vaultRealpath: realpathSync(CLI_SPEED_STAGE1_VAULT),
		vaultDev: statSync(CLI_SPEED_STAGE1_VAULT).dev,
		vaultIno: statSync(CLI_SPEED_STAGE1_VAULT).ino,
		obsidianSessionDigest: obsidianSessionDigest(),
		scheduleDigest: sha256Json(STAGE6_PROFILE),
		node: process.version,
		platform: `${platform()}-${release()}-${arch()}`,
		host: hostname(),
	};
	return { ...members, digest: sha256Json(members) };
}

function dependencyDigest(unit, identity) {
	const domain = unitDependencyDomain(unit);
	return sha256Json({
		unit,
		unitRevision: STAGE6_UNIT_REVISIONS[unit],
		...(domain.usesBaseline ? { baselineCli: identity.baselineCli } : {}),
		...(domain.usesVault ? {
			fixtureDigest: identity.fixtureDigest,
			vaultRealpath: identity.vaultRealpath,
			obsidianSessionDigest: identity.obsidianSessionDigest,
		} : {}),
		profile: Object.fromEntries(domain.profile.map(key => [key, STAGE6_PROFILE[key]])),
		artifactDomain: sha256Json(domain.artifactFiles.map(relativePath => ({
			relativePath,
			digest: sha256File(path.join(pluginRoot, relativePath)),
		}))),
		workerCode: sourceFunctionsDigest(workerPath, domain.workerFunctions),
		coreCode: sourceFunctionsDigest(
			path.join(scriptDirectory, 'cli-speed-stage6-core.mjs'),
			domain.coreFunctions,
		),
	});
}

function unitDependencyDomain(unit) {
	const sharedSample = ['summarizeStage6Samples', 'summarize', 'diagnoseOutliers'];
	const sharedVaultWorker = ['resetVault', 'benchmarkEnv', 'digestVaultPath'];
	const compactArtifacts = [
		'packages/operon-cli/src/client.ts',
		'packages/operon-cli/src/client-identity.ts',
		'packages/operon-cli/src/command-line.ts',
		'packages/operon-cli/src/command-output.ts',
		'packages/operon-cli/src/command-registry.ts',
		'packages/operon-cli/src/compact-create.ts',
		'packages/operon-cli/src/compact-update.ts',
		'packages/operon-cli/src/config.ts',
		'packages/operon-cli/src/main.ts',
		'packages/operon-cli/src/manifest-data.ts',
		'packages/operon-cli/src/plan-store.ts',
		'packages/operon-cli/src/protocol.ts',
		'src/agent-runtime/runtime/mutation-gateway.ts',
		'src/agent-runtime/runtime/task-creation-adapter.ts',
	];
	const readArtifacts = [
		'operon-build-config.mjs',
		'packages/operon-cli/src/client-identity.ts',
		'packages/operon-cli/src/command-line.ts',
		'packages/operon-cli/src/command-output.ts',
		'packages/operon-cli/src/config.ts',
		'packages/operon-cli/src/main.ts',
		'packages/operon-cli/src/manifest-data.ts',
		'packages/operon-cli/src/session-jsonl.ts',
		'packages/operon-cli/src/persistent-read-client.ts',
		'packages/operon-cli/src/client.ts',
		'packages/operon-cli/src/protocol.ts',
		'src/agent-runtime/transport/persistent-read-server.ts',
		'src/agent-runtime/transport/dispatcher.ts',
		'src/agent-runtime/transport/secure-request-file.ts',
	];
	const domains = {
		'compact-single': {
			usesBaseline: false, usesVault: true, profile: ['workflow'],
			artifactFiles: compactArtifacts,
			workerFunctions: [
				'collectCompactSingle', 'runHumanCreate', 'runHumanUpdate',
				'auditMutation', 'runCli', 'dispatchCount', ...sharedVaultWorker,
			],
			coreFunctions: ['evaluateCompactSingle', 'requireAttempts', 'requireRawAuthoritative', ...sharedSample],
		},
		'compact-create5': {
			usesBaseline: false, usesVault: true, profile: ['workflow'],
			artifactFiles: compactArtifacts,
			workerFunctions: [
				'collectCompactGroup', 'runSequentialEquivalent', 'runCompactBatch',
				'compactDescription', 'auditApply', 'applyPlan', 'runCli',
				'dispatchCount', ...sharedVaultWorker,
			],
			coreFunctions: [
				'evaluateCompactGroup', 'requireAttempts',
				'requireModeledSequentialEquivalent', 'requireRawAuthoritative',
				'auditStage6CreateApply', ...sharedSample,
			],
		},
		'compact-create20': null,
		'batch-retention': {
			usesBaseline: false, usesVault: true, profile: ['batchRetention'],
			artifactFiles: compactArtifacts,
			workerFunctions: [
				'collectBatchRetention', 'runSequentialEquivalent', 'runCompactBatch',
				'compactDescription', 'auditApply', 'applyPlan', 'runCli',
				'dispatchCount', ...sharedVaultWorker,
			],
			coreFunctions: [
				'evaluateRetention', 'requireAttempts', 'requireRawAuthoritative',
				'auditStage6CreateApply', ...sharedSample,
			],
		},
		'read-batch': {
			usesBaseline: false,
			usesVault: true,
			profile: ['readSmoke', 'reads', 'readGroupSize'],
			artifactFiles: readArtifacts,
			workerFunctions: [
				'collectReadBatch', 'collectReadStructuralSmoke', 'startSession',
				'stripInternalReadMetadata', 'readFrame', 'readSemanticKey',
				'readResponseSemanticKey', 'readCommandFamily',
				'readObservedSemanticKey',
				'summarizeTransportEvidence',
				'countReadCommands', ...sharedVaultWorker,
			],
			coreFunctions: [
				'evaluateReads', 'evaluateStage6ReadSmoke',
				'partitionStage6ReadGroups', 'requireAttempts',
				'requireRawAuthoritative', 'rawOuterSummary',
				'improvementPercent', 'canonicalizeStage6ReadSemanticValue',
				'summarizeStage6TransportEvidence', ...sharedSample,
			],
		},
		soak: {
			usesBaseline: false, usesVault: true, profile: ['soak'],
			artifactFiles: readArtifacts,
			workerFunctions: [
				'collectSoak', 'startSession', 'readFrame',
				'processRssBytes', 'processFdCount', 'processUnixFdCount',
				...sharedVaultWorker,
			],
			coreFunctions: ['evaluateSoak', 'requireAttempts', ...sharedSample],
		},
			'negative-contract': {
				usesBaseline: false, usesVault: false, profile: [],
				artifactFiles: [
					'scripts/agent-runtime/cli/run-session-jsonl-tests.mjs',
					'scripts/agent-runtime/cli/run-compact-create-tests.mjs',
					'scripts/agent-runtime/cli/session-jsonl.test.ts',
					'scripts/agent-runtime/cli/cli.test.ts',
					'packages/operon-cli/src/client.ts',
					'packages/operon-cli/src/session-jsonl.ts',
					'packages/operon-cli/src/persistent-read-client.ts',
				],
			workerFunctions: ['collectNegativeContract'],
			coreFunctions: ['evaluateStage6Evidence'],
		},
	};
	domains['compact-create20'] = domains['compact-create5'];
	return domains[unit];
}

function sourceFunctionsDigest(filePath, names) {
	const source = readFileSync(filePath, 'utf8');
	return sha256Json(names.map(name => extractFunctionSource(source, name)));
}

function extractFunctionSource(source, name) {
	const pattern = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`, 'u');
	const match = pattern.exec(source);
	assert.ok(match, `Stage 6 dependency function missing: ${name}`);
	const brace = source.indexOf('{', match.index);
	let depth = 0;
	for (let index = brace; index < source.length; index += 1) {
		if (source[index] === '{') depth += 1;
		if (source[index] === '}') {
			depth -= 1;
			if (depth === 0) return source.slice(match.index, index + 1);
		}
	}
	throw new Error(`Stage 6 dependency function is unterminated: ${name}`);
}

function migrateStage6To61CompactEvidence(checkpoint, identity) {
	if (!existsSync(finalPath)) return checkpoint;
	const previous = readJson(finalPath);
	const compactUnits = Object.keys(STAGE6_TO_61_COMPACT_SEAL.units);
	const actualEvidenceDigests = Object.fromEntries(compactUnits.map(unit => {
		const evidencePath = checkpoint?.units?.[unit]?.evidencePath;
		return [
			unit,
			typeof evidencePath === 'string' && existsSync(evidencePath)
				? sha256File(evidencePath)
				: null,
		];
	}));
	const currentSafetyIdentityMatches = (
		previous?.identity?.baselineCli === identity.baselineCli
		&& previous?.identity?.fixtureDigest === identity.fixtureDigest
		&& previous?.identity?.vaultRealpath === identity.vaultRealpath
		&& previous?.identity?.obsidianSessionDigest === identity.obsidianSessionDigest
	);
	const migration = migrateStage6CompactCheckpointV1({
		checkpoint,
		priorFinal: previous,
		seal: STAGE6_TO_61_COMPACT_SEAL,
		priorIdentityDigest: sha256Json(previous?.identity),
		currentSafetyIdentityMatches,
		actualEvidenceDigests,
		newDependencyDigests: Object.fromEntries(
			compactUnits.map(unit => [unit, dependencyDigest(unit, identity)]),
		),
	});
	if (!migration.migrated) return checkpoint;
	atomicWriteJson(checkpointPath, migration.checkpoint);
	return migration.checkpoint;
}

function recoverInterruptedStage61Evidence(checkpoint, identity) {
	if (!existsSync(finalPath)) return checkpoint;
	const previous = readJson(finalPath);
	const units = Object.keys(STAGE61_INTERRUPTED_RECOVERY_SEAL.units);
	const actualEvidenceDigests = Object.fromEntries(units.map(unit => {
		const evidencePath = checkpoint?.units?.[unit]?.evidencePath;
		return [
			unit,
			typeof evidencePath === 'string' && existsSync(evidencePath)
				? sha256File(evidencePath)
				: null,
		];
	}));
	const currentSafetyIdentityMatches = (
		previous?.identity?.baselineCli === identity.baselineCli
		&& previous?.identity?.fixtureDigest === identity.fixtureDigest
		&& previous?.identity?.vaultRealpath === identity.vaultRealpath
		&& previous?.identity?.obsidianSessionDigest === identity.obsidianSessionDigest
	);
	const migration = recoverStage61InterruptedCheckpointV1({
		checkpoint,
		priorFinal: previous,
		seal: STAGE61_INTERRUPTED_RECOVERY_SEAL,
		priorIdentityDigest: sha256Json(previous?.identity),
		currentSafetyIdentityMatches,
		actualEvidenceDigests,
		newDependencyDigests: Object.fromEntries(
			units.map(unit => [unit, dependencyDigest(unit, identity)]),
		),
	});
	if (!migration.migrated) return checkpoint;
	atomicWriteJson(checkpointPath, migration.checkpoint);
	return migration.checkpoint;
}

function loadCheckpoint() {
	const fresh = {
		schemaVersion: 1,
		kind: 'operon-cli-stage6-checkpoint',
		revision: 0,
		units: {},
	};
	if (!existsSync(checkpointPath)) return fresh;
	const current = readJson(checkpointPath);
	if (current?.kind === fresh.kind && current?.schemaVersion === fresh.schemaVersion) {
		return current;
	}
	renameSync(checkpointPath, `${checkpointPath}.stale-${Date.now()}`);
	return fresh;
}

function validUnit(value, digest) {
	return value?.status === 'passed'
		&& value?.dependencyDigest === digest
		&& typeof value?.evidencePath === 'string'
		&& existsSync(value.evidencePath)
		&& value.evidenceDigest === sha256File(value.evidencePath);
}

function atomicWriteJson(destination, value) {
	const temporary = `${destination}.tmp-${process.pid}`;
	writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
	renameSync(temporary, destination);
}

function readJson(target) {
	return JSON.parse(readFileSync(target, 'utf8'));
}

function sha256File(target) {
	return createHash('sha256').update(readFileSync(target)).digest('hex');
}

function sha256Json(value) {
	return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function obsidianSessionDigest() {
	const result = spawnSync('ps', ['-axo', 'pid=,lstart=,command='], { encoding: 'utf8' });
	assert.equal(result.status, 0, result.stderr);
	return createHash('sha256').update(
		result.stdout.split('\n').filter(line => /Obsidian\.app/u.test(line)).join('\n'),
	).digest('hex');
}
