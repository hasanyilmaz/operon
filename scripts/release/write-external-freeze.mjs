#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
	link,
	lstat,
	open,
	realpath,
	unlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	loadPublishedCliBinding,
	sanitizedChildEnvironment,
} from '../agent-runtime/cli/published-cli-v1.mjs';
import {
	canonicalJson,
	CANONICAL_NODE_VERSION,
	CANONICAL_NPM_VERSION,
	EXTERNAL_FREEZE_RELATIVE_PATH,
	EXTERNAL_FREEZE_SCHEMA_RELATIVE_PATH,
	externalFreezeAggregate,
	FAMILY_RESULTS,
	LIVE_ACCEPTANCE_RELATIVE_PATH,
	PUBLISHED_CLI_BINDING_RELATIVE_PATH,
	PUBLISHED_CLI_BINDING_SCHEMA_RELATIVE_PATH,
	PUBLISHED_FAMILIES,
	readRegularFileNoFollow,
	readPluginArtifactIdentity,
	sha256,
	validateMaintainerIdentity,
	validateExternalFreezeDocuments,
} from './check-accepted-freeze.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const defaultPluginRoot = path.resolve(path.dirname(scriptPath), '../..');
const SOURCE_FAMILY_EVIDENCE_KEYS = Object.freeze([
	'create',
	'phase8',
	'pinnedState',
	'recurrence',
	'relationship',
	'timerSession',
]);
const PHASE8_FAMILIES = Object.freeze([
	'update',
	'reminder',
	'transition',
	'timer',
	'relocation',
	'conversion',
	'delete',
]);

export function readExternalFreezeArguments(argv) {
	const allowed = new Set(['--live-evidence', '--accepted-by', '--accepted-at']);
	const values = new Map();
	if (argv.length !== 6) throw new Error('OPERON_EXTERNAL_FREEZE_USAGE');
	for (let index = 0; index < argv.length; index += 2) {
		const key = argv[index];
		const value = argv[index + 1];
		if (!allowed.has(key) || !value || values.has(key)) {
			throw new Error('OPERON_EXTERNAL_FREEZE_USAGE');
		}
		values.set(key, value);
	}
	return Object.freeze({
		liveEvidencePath: values.get('--live-evidence'),
		acceptedBy: values.get('--accepted-by'),
		acceptedAt: values.get('--accepted-at'),
	});
}

export function sanitizePublishedLiveEvidence(source, sourceBytes, binding, pluginArtifact) {
	validatePublishedLiveAcceptanceSource(source, binding, pluginArtifact);

	return Object.freeze({
		$schema: './public-v1-external-freeze.schema.json#/$defs/liveAcceptanceEvidence',
		evidenceVersion: 1,
		kind: 'operon-public-v1-live-acceptance-evidence',
		sourceEvidenceSha256: sha256(sourceBytes),
		package: source.package,
		tarballSha256: source.tarballSha256,
		runtimeContractDigest: source.runtimeContractDigest,
		pluginArtifact: source.pluginArtifact,
		toolchain: {
			nodeVersion: source.nodeVersion,
			npmVersion: source.npmVersion,
		},
		status: 'ok',
		publishedFamilies: [...PUBLISHED_FAMILIES],
		familyResults: FAMILY_RESULTS.map(result => ({ ...result })),
	});
}

export function validatePublishedLiveAcceptanceSource(source, binding, pluginArtifact) {
	assertExactKeys(source, [
		'acceptance',
		'kind',
		'nodeVersion',
		'npmVersion',
		'package',
		'pluginArtifact',
		'runtimeContractDigest',
		'tarballSha256',
	]);
	assert.equal(source?.kind, 'operon-published-cli-runtime-live-acceptance');
	assert.equal(source?.package, `${binding.package.name}@${binding.package.version}`);
	assert.equal(source?.tarballSha256, binding.tarball.sha256);
	assert.equal(source?.runtimeContractDigest, binding.runtime.contractDigest);
	assert.equal(source?.nodeVersion, CANONICAL_NODE_VERSION);
	assert.equal(source?.npmVersion, CANONICAL_NPM_VERSION);
	assert.deepEqual(source?.pluginArtifact, pluginArtifact);
	assertExactKeys(source.acceptance, [
		'familyEvidence',
		'publishedFamilies',
		'refusedFamilies',
		'status',
		'unavailableFamilies',
		'warmPerformance',
	]);
	assert.equal(source?.acceptance?.status, 'ok');
	assert.deepEqual(source.acceptance.publishedFamilies, PUBLISHED_FAMILIES);
	assert.deepEqual(source.acceptance.refusedFamilies, []);
	assert.deepEqual(source.acceptance.unavailableFamilies, []);
	assert.deepEqual(
		Object.keys(source.acceptance.familyEvidence ?? {}).sort(),
		SOURCE_FAMILY_EVIDENCE_KEYS,
	);
	for (const key of SOURCE_FAMILY_EVIDENCE_KEYS) {
		assert.equal(source.acceptance.familyEvidence[key]?.status, 'ok');
	}
	validateCreateEvidence(source.acceptance.familyEvidence.create);
	validatePhase8Evidence(source.acceptance.familyEvidence.phase8);
	validateRecurrenceEvidence(source.acceptance.familyEvidence.recurrence);
	validateRelationshipEvidence(source.acceptance.familyEvidence.relationship);
	validateTimerSessionEvidence(source.acceptance.familyEvidence.timerSession);
	validatePinnedEvidence(source.acceptance.familyEvidence.pinnedState);
	assert.deepEqual(
		source.acceptance.warmPerformance,
		source.acceptance.familyEvidence.phase8.warmPerformance,
	);
	return source;
}

export async function writeExternalFreeze(arguments_, options = {}) {
	const pluginRoot = options.pluginRoot ?? defaultPluginRoot;
	const liveEvidencePath = arguments_.liveEvidencePath;
	assert.ok(
		typeof liveEvidencePath === 'string'
			&& path.isAbsolute(liveEvidencePath)
			&& !liveEvidencePath.includes('\0'),
		'OPERON_EXTERNAL_FREEZE_LIVE_EVIDENCE_PATH_INVALID',
	);
	const acceptedBy = validateMaintainerIdentity(arguments_.acceptedBy);
	const acceptedAt = validateAcceptedAt(arguments_.acceptedAt);
	const allowedTempRoots = [...new Set(await Promise.all([
		realpath(process.platform === 'darwin' ? '/private/tmp' : tmpdir()),
		realpath(tmpdir()),
	]))].sort((left, right) => right.length - left.length);
	const expectedTempRoot = allowedTempRoots.find(root => {
		const relative = path.relative(root, liveEvidencePath);
		return relative && relative !== '..' && !path.isAbsolute(relative) && !relative.startsWith(`..${path.sep}`);
	});
	assert.ok(expectedTempRoot, 'OPERON_EXTERNAL_FREEZE_LIVE_EVIDENCE_PATH_INVALID');

	const freezePath = path.join(pluginRoot, EXTERNAL_FREEZE_RELATIVE_PATH);
	const evidencePath = path.join(pluginRoot, LIVE_ACCEPTANCE_RELATIVE_PATH);
	const freezeSchemaPath = path.join(pluginRoot, EXTERNAL_FREEZE_SCHEMA_RELATIVE_PATH);
	const bindingPath = path.join(pluginRoot, PUBLISHED_CLI_BINDING_RELATIVE_PATH);
	const bindingSchemaPath = path.join(pluginRoot, PUBLISHED_CLI_BINDING_SCHEMA_RELATIVE_PATH);
	await Promise.all([
		assertDirectory(path.dirname(freezePath)),
		assertAbsent(freezePath),
		assertAbsent(evidencePath),
	]);

	let sourceBytes;
	try {
		sourceBytes = await readRegularFileNoFollow(liveEvidencePath, expectedTempRoot);
	} catch (cause) {
		throw new Error('OPERON_EXTERNAL_FREEZE_LIVE_EVIDENCE_INVALID', { cause });
	}
	const [schemaBytes, bindingBytes, bindingSchemaBytes, loadedBinding, pluginArtifact] = await Promise.all([
		readRegularFileNoFollow(freezeSchemaPath, pluginRoot),
		readRegularFileNoFollow(bindingPath, pluginRoot),
		readRegularFileNoFollow(bindingSchemaPath, pluginRoot),
		loadPublishedCliBinding({ bindingPath, schemaPath: bindingSchemaPath }),
		readPluginArtifactIdentity(pluginRoot),
	]);
	assert.deepEqual(loadedBinding.bindingBytes, bindingBytes);
	assert.deepEqual(loadedBinding.schemaBytes, bindingSchemaBytes);
	const source = JSON.parse(sourceBytes.toString('utf8'));
	const schema = JSON.parse(schemaBytes.toString('utf8'));
	const evidence = sanitizePublishedLiveEvidence(
		source,
		sourceBytes,
		loadedBinding.binding,
		pluginArtifact,
	);
	const auditResult = options.auditResult ?? runReleaseAuditPolicy(pluginRoot);
	const acceptedAuditResult = sanitizeAcceptedAuditResult(auditResult);
	const evidenceBytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
	const freeze = {
		$schema: './public-v1-external-freeze.schema.json',
		freezeVersion: 1,
		kind: 'operon-public-v1-external-freeze',
		state: 'accepted',
		runtime: {
			contractVersion: 1,
			contractDigest: loadedBinding.binding.runtime.contractDigest,
		},
		externalCliBinding: {
			path: PUBLISHED_CLI_BINDING_RELATIVE_PATH,
			bytes: loadedBinding.bindingBytes.byteLength,
			sha256: sha256(loadedBinding.bindingBytes),
			bindingAggregateSha256: loadedBinding.binding.bindingAggregateSha256,
		},
		cli: {
			packageName: loadedBinding.binding.package.name,
			packageVersion: loadedBinding.binding.package.version,
			tarballSha256: loadedBinding.binding.tarball.sha256,
		},
		pluginArtifact,
		audit: {
			validation: {
				command: 'npm run release:audit-policy',
				status: 'passed',
				result: acceptedAuditResult,
			},
		},
		liveAcceptance: {
			evidence: {
				path: LIVE_ACCEPTANCE_RELATIVE_PATH,
				bytes: evidenceBytes.byteLength,
				sha256: sha256(evidenceBytes),
				sourceEvidenceSha256: evidence.sourceEvidenceSha256,
			},
			publishedFamilies: [...PUBLISHED_FAMILIES],
		},
		maintainerAcceptance: {
			status: 'accepted',
			acceptedBy,
			acceptedAt,
		},
	};
	freeze.inputsAggregateSha256 = externalFreezeAggregate(freeze);
	validateExternalFreezeDocuments(freeze, evidence, schema);
	const freezeBytes = Buffer.from(`${JSON.stringify(freeze, null, 2)}\n`, 'utf8');

	await writePairNoOverwrite({ evidencePath, evidenceBytes, freezePath, freezeBytes });
	return Object.freeze({
		freeze,
		freezePath,
		freezeSha256: sha256(freezeBytes),
		evidence,
		evidencePath,
		evidenceSha256: sha256(evidenceBytes),
	});
}

function validateAcceptedAt(value) {
	assert.match(value ?? '', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
	assert.equal(new Date(value).toISOString(), value);
	return value;
}

function sanitizeAcceptedAuditResult(result) {
	assert.deepEqual({
		status: result?.status,
		productionVulnerabilities: result?.productionVulnerabilities,
		developmentVulnerabilities: result?.developmentVulnerabilities,
		directRoot: result?.directRoot,
	}, {
		status: 'accepted-clean',
		productionVulnerabilities: 0,
		developmentVulnerabilities: 0,
		directRoot: 'eslint-plugin-obsidianmd',
	});
	return Object.freeze({
		status: 'accepted-clean',
		productionVulnerabilities: 0,
		developmentVulnerabilities: 0,
		directRoot: 'eslint-plugin-obsidianmd',
	});
}

function validateCreateEvidence(value) {
	assertExactKeys(value, [
		'catalogGate',
		'crossSourceDependencyTransactional',
		'crossSourceParentRelatedConfirmed',
		'exactLineApplied',
		'manifestGate',
		'mixedFileParentInlineChildShiftVerified',
		'recoveryStatus',
		'sameSourceGraphAtomic',
		'status',
		'templateBodyApplied',
		'templateCandidatesContentFree',
		'vault',
	]);
	assert.equal(value.status, 'ok');
	assert.match(value.vault, /^operon-agent-runtime-phase1-[A-Za-z0-9._-]+$/u);
	for (const key of [
		'manifestGate',
		'catalogGate',
		'templateCandidatesContentFree',
		'exactLineApplied',
		'templateBodyApplied',
		'sameSourceGraphAtomic',
		'mixedFileParentInlineChildShiftVerified',
		'crossSourceParentRelatedConfirmed',
		'crossSourceDependencyTransactional',
	]) assert.equal(value[key], true);
	assertMutationStatus(value.recoveryStatus);
}

function validatePhase8Evidence(value) {
	assertExactKeys(value, [
		'correctnessAcceptance',
		'publishedFamilies',
		'refusedFamilies',
		'status',
		'unavailableFamilies',
		'warmPerformance',
	]);
	assert.equal(value.status, 'ok');
	assert.deepEqual(value.publishedFamilies, PHASE8_FAMILIES);
	assert.deepEqual(value.refusedFamilies, []);
	assert.deepEqual(value.unavailableFamilies, []);
	assertExactKeys(value.correctnessAcceptance, ['operations', 'runtimeSession']);
	assert.equal(value.correctnessAcceptance.runtimeSession, 'fresh-restart');
	assertExactKeys(value.correctnessAcceptance.operations, [
		'conversion',
		'delete',
		'recurrence',
		'relocation',
		'reminder',
		'timer',
		'transition',
		'update',
	]);
	for (const timing of Object.values(value.correctnessAcceptance.operations)) {
		assertTimingTree(timing);
	}
	validateWarmPerformance(value.warmPerformance);
}

function validateWarmPerformance(value) {
	assertExactKeys(value, ['performance', 'runtimeSession', 'samplesPerFamily', 'status']);
	assert.equal(value.status, 'ok');
	assert.equal(value.runtimeSession, 'single-warm-session');
	assert.equal(value.samplesPerFamily, 20);
	assertExactKeys(value.performance, PHASE8_FAMILIES);
	for (const metrics of Object.values(value.performance)) {
		assertExactKeys(metrics, [
			'applyHandlerP95',
			'applyTotalP95',
			'previewHandlerP95',
			'previewTotalP95',
			'samples',
		]);
		assert.equal(metrics.samples, 20);
		for (const [key, metric] of Object.entries(metrics)) {
			if (key !== 'samples') assertNonNegativeFinite(metric);
		}
	}
}

function validateRecurrenceEvidence(value) {
	assertExactKeys(value, ['happy', 'prepared', 'recovered', 'recoveryVerified', 'reload', 'status', 'vaultPath']);
	assert.equal(value.status, 'ok');
	assert.equal(value.vaultPath, '/private/tmp/cli-test-vault');
	assert.equal(value.recoveryVerified, true);
	assertExactKeys(value.happy, [
		'clear',
		'persistenceIdle',
		'recoveryVerified',
		'requestRootClean',
		'runtimeReady',
		'settingsUnchanged',
		'start',
		'status',
		'thisAndFollowing',
		'thisTask',
		'vaultIdentityMatched',
		'vaultPath',
	]);
	assert.equal(value.happy.status, 'ok');
	assert.equal(value.happy.vaultPath, '/private/tmp/cli-test-vault');
	for (const key of ['vaultIdentityMatched', 'runtimeReady', 'persistenceIdle', 'requestRootClean', 'settingsUnchanged']) {
		assert.equal(value.happy[key], true);
	}
	for (const key of ['start', 'thisTask', 'thisAndFollowing', 'clear']) assertMutationStatus(value.happy[key]);
	assert.equal(value.happy.recoveryVerified, false);
	validateInterruptedEvidence(value.prepared, true);
	validateReloadEvidence(value.reload);
	assertExactKeys(value.recovered, ['recovery', 'replay', 'samePlan', 'sourceAndSeriesVerified', 'status']);
	assert.equal(value.recovered.status, 'ok');
	assertMutationStatus(value.recovered.recovery);
	assert.equal(value.recovered.replay, 'already-applied');
	assert.equal(value.recovered.samePlan, true);
	assert.equal(value.recovered.sourceAndSeriesVerified, true);
}

function validateRelationshipEvidence(value) {
	assertExactKeys(value, ['happy', 'prepared', 'recovered', 'reload', 'status']);
	assert.equal(value.status, 'ok');
	assertExactKeys(value.happy, [
		'blockedByReciprocalReplaceClear',
		'blockingReciprocalReplaceClear',
		'exactDescriptionSelector',
		'localNoChange',
		'parentSetReparentClear',
		'status',
		'vault',
	]);
	assert.equal(value.happy.status, 'ok');
	assert.equal(value.happy.vault, 'cli-test-vault');
	for (const key of [
		'parentSetReparentClear',
		'blockingReciprocalReplaceClear',
		'blockedByReciprocalReplaceClear',
		'exactDescriptionSelector',
		'localNoChange',
	]) assert.equal(value.happy[key], true);
	validateInterruptedEvidence(value.prepared, true);
	validateReloadEvidence(value.reload);
	assertExactKeys(value.recovered, ['reciprocalDependencyVerified', 'recovery', 'samePlan', 'status']);
	assert.equal(value.recovered.status, 'ok');
	assertMutationStatus(value.recovered.recovery);
	assert.equal(value.recovered.samePlan, true);
	assert.equal(value.recovered.reciprocalDependencyVerified, true);
}

function validateTimerSessionEvidence(value) {
	assertExactKeys(value, [
		'add',
		'duplicateRange',
		'lastItemClear',
		'midnight',
		'parentAggregate',
		'remove',
		'status',
		'update',
		'vaultPath',
	]);
	assert.deepEqual(value, {
		status: 'ok',
		vaultPath: '/private/tmp/cli-test-vault',
		add: 'applied',
		update: 'applied',
		duplicateRange: 'verified',
		remove: 'confirmed-applied',
		lastItemClear: 'verified',
		midnight: 'verified',
		parentAggregate: 'verified',
	});
}

function validatePinnedEvidence(value) {
	assertExactKeys(value, ['pin', 'status', 'unpin']);
	assert.equal(value.status, 'ok');
	assertMutationStatus(value.pin);
	assertMutationStatus(value.unpin);
}

function validateInterruptedEvidence(value, expectFenced) {
	assertExactKeys(value, [
		...(expectFenced ? ['planFenced'] : []),
		'planRef',
		'recoveryOnly',
		'status',
	]);
	assert.equal(value.status, 'interrupted');
	assert.match(value.planRef, /^[A-Za-z0-9_-]{32}$/u);
	assert.equal(value.recoveryOnly, true);
	if (expectFenced) assert.equal(value.planFenced, true);
}

function validateReloadEvidence(value) {
	assertExactKeys(value, ['action']);
	assert.ok(['reload', 'restart'].includes(value.action));
}

function assertMutationStatus(value) {
	assert.ok(['applied', 'already-applied'].includes(value));
}

function assertTimingTree(value) {
	assert.ok(value && typeof value === 'object' && !Array.isArray(value));
	assert.ok(Object.keys(value).length > 0);
	for (const child of Object.values(value)) {
		if (typeof child === 'number') assertNonNegativeFinite(child);
		else assertTimingTree(child);
	}
}

function assertNonNegativeFinite(value) {
	assert.equal(Number.isFinite(value) && value >= 0, true);
}

function assertExactKeys(value, expected) {
	assert.ok(value && typeof value === 'object' && !Array.isArray(value));
	assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
}

function runReleaseAuditPolicy(pluginRoot) {
	const result = spawnSync(
		process.execPath,
		[path.join(pluginRoot, 'scripts', 'check-release-audit-policy.mjs')],
		{
			cwd: pluginRoot,
			encoding: 'utf8',
			env: sanitizedChildEnvironment(process.env),
			maxBuffer: 16 * 1_024 * 1_024,
		},
	);
	assert.equal(
		result.status,
		0,
		`OPERON_EXTERNAL_FREEZE_AUDIT_FAILED:${result.stderr?.trim() ?? ''}`,
	);
	return JSON.parse(result.stdout);
}

async function assertDirectory(target) {
	const stats = await lstat(target);
	assert.ok(stats.isDirectory() && !stats.isSymbolicLink(), 'OPERON_EXTERNAL_FREEZE_OUTPUT_DIRECTORY_INVALID');
}

async function assertAbsent(target) {
	try {
		await lstat(target);
		throw new Error('OPERON_EXTERNAL_FREEZE_EXISTS');
	} catch (error) {
		if (error?.code !== 'ENOENT') throw error;
	}
}

async function writePairNoOverwrite({ evidencePath, evidenceBytes, freezePath, freezeBytes }) {
	const suffix = `${process.pid}-${randomUUID()}.tmp`;
	const evidenceTemporaryPath = `${evidencePath}.${suffix}`;
	const freezeTemporaryPath = `${freezePath}.${suffix}`;
	let evidenceLinked = false;
	try {
		await Promise.all([
			writeTemporary(evidenceTemporaryPath, evidenceBytes),
			writeTemporary(freezeTemporaryPath, freezeBytes),
		]);
		await link(evidenceTemporaryPath, evidencePath);
		evidenceLinked = true;
		await link(freezeTemporaryPath, freezePath);
	} catch (error) {
		if (evidenceLinked) await unlink(evidencePath).catch(() => {});
		if (error?.code === 'EEXIST') throw new Error('OPERON_EXTERNAL_FREEZE_EXISTS', { cause: error });
		throw error;
	} finally {
		await Promise.all([
			unlink(evidenceTemporaryPath).catch(() => {}),
			unlink(freezeTemporaryPath).catch(() => {}),
		]);
	}
}

async function writeTemporary(target, bytes) {
	const handle = await open(target, 'wx', 0o600);
	try {
		await handle.writeFile(bytes);
		await handle.sync();
	} finally {
		await handle.close();
	}
}

if (path.resolve(process.argv[1] ?? '') === scriptPath) {
	const result = await writeExternalFreeze(readExternalFreezeArguments(process.argv.slice(2)));
	process.stdout.write(`${canonicalJson({
		status: 'ok',
		freeze: path.basename(result.freezePath),
		freezeSha256: result.freezeSha256,
		evidence: path.basename(result.evidencePath),
		evidenceSha256: result.evidenceSha256,
	})}\n`);
}
