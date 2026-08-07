#!/usr/bin/env node

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

import {
	canonicalJson,
	readRegularFileNoFollow,
	sha256,
} from './check-accepted-freeze.mjs';
import { assertPublishedCliBinding } from '../agent-runtime/cli/published-cli-v1.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const defaultPluginRoot = path.resolve(path.dirname(scriptPath), '../..');
export const RELEASE_FREEZE_REGISTRY_RELATIVE_PATH =
	'contracts/agent-runtime/public-v1-release-freezes.json';
export const CURRENT_PLUGIN_VERSION = '3.1.1';
export const CURRENT_CLI_VERSION = '1.0.9';
export const RELEASE_FREEZE_STALE = 'OPERON_PUBLIC_V1_FREEZE_STALE';
const PREVIOUS_RELEASE_ROOT = 'contracts/agent-runtime/releases/3.1.0';
const CURRENT_RELEASE_ROOT = 'contracts/agent-runtime/releases/3.1.1';
const SHARED_CLI_BINDING_PATH = `${PREVIOUS_RELEASE_ROOT}/published-cli-v1.json`;
const SHARED_CLI_SCHEMA_PATH = `${PREVIOUS_RELEASE_ROOT}/published-cli-v1.schema.json`;
const EXPECTED_HISTORICAL_FILES = Object.freeze([
	Object.freeze({ path: 'contracts/agent-runtime/public-v1-external-freeze.json', bytes: 2490, sha256: '946e3f320d5011c7c2c0dc416f3d65d40bc1f1acb58ece71f0f5a3714e3d4350' }),
	Object.freeze({ path: 'contracts/agent-runtime/public-v1-external-freeze.schema.json', bytes: 10753, sha256: '80f837fc50f1ac30955884c37fc310d337b565327bcf3a9b55edc7f514302968' }),
	Object.freeze({ path: 'contracts/agent-runtime/public-v1-live-acceptance.json', bytes: 2603, sha256: 'c33689f2dd37741b39f7dbd4d76da692d339ceca796bbbbe39dccbb6735fb3d6' }),
	Object.freeze({ path: 'contracts/agent-runtime/published-cli-v1.json', bytes: 18715, sha256: 'b7b446d15218a78d8c696d7c3732461ccffad6c0af6069637a02452c9b3fef98' }),
	Object.freeze({ path: 'contracts/agent-runtime/published-cli-v1.schema.json', bytes: 6870, sha256: '62d8adbc7b736cd910c35db744cb70b4e2c03cc34c7d11a0e86d3a499cedb8e7' }),
]);
const EXPECTED_PREVIOUS_FILES = Object.freeze([
	Object.freeze({ path: `${PREVIOUS_RELEASE_ROOT}/public-v1-external-freeze.json`, bytes: 2154, sha256: '85cf7459987ecd7aa18fdae06fcea08acbbe1318189e3edb2557c60aa3d5abe4' }),
	Object.freeze({ path: `${PREVIOUS_RELEASE_ROOT}/public-v1-external-freeze.schema.json`, bytes: 13326, sha256: '68f02611afe4398662031e4c4ae64e1afe1521490ecbd2f8d5b17e27f1d0d868' }),
	Object.freeze({ path: `${PREVIOUS_RELEASE_ROOT}/paired-release-evidence.json`, bytes: 4254, sha256: '3352c360c9a2ddd01c3ab622f0263c61bec15f1e83b8ac0c669e5f9b64a35ab5' }),
	Object.freeze({ path: SHARED_CLI_BINDING_PATH, bytes: 18715, sha256: '85d693731d538e30cc983d890b4d8e9df5ff7b225e21795dedd77b02c9ce9932' }),
	Object.freeze({ path: SHARED_CLI_SCHEMA_PATH, bytes: 8942, sha256: '6465ced9aa799773e9f296db84bcb56a71f723b309f9d68caa2e09636fdcabce' }),
]);
const EXPECTED_CURRENT_FILES = Object.freeze([
	Object.freeze({ path: `${CURRENT_RELEASE_ROOT}/public-v1-external-freeze.json`, bytes: 2180, sha256: '2bb2b9e1a6516c87ea583f039845c3f26f3f571157785672195c535c0d9f2d28' }),
	Object.freeze({ path: `${CURRENT_RELEASE_ROOT}/public-v1-external-freeze.schema.json`, bytes: 3408, sha256: '875478b67002b9e0231c6b1f0728f4c2e4a5ec61999affb3729acaa6d07dc91f' }),
	Object.freeze({ path: `${CURRENT_RELEASE_ROOT}/paired-release-evidence.json`, bytes: 4538, sha256: 'eeb0eeaefef9aa3937a5d50de6bfc535c7b23d12e449c5b174f769e292e27008' }),
]);

export async function checkCandidateFreezeRegistry(options = {}) {
	return checkFreezeRegistry(options, 'candidate');
}

export async function checkReleaseFreezeRegistry(options = {}) {
	return checkFreezeRegistry(options, 'release');
}

async function checkFreezeRegistry(options, artifactPolicy) {
	assert.ok(artifactPolicy === 'candidate' || artifactPolicy === 'release');
	const pluginRoot = options.pluginRoot ?? defaultPluginRoot;
	try {
		const registryPath = path.join(pluginRoot, RELEASE_FREEZE_REGISTRY_RELATIVE_PATH);
		const registryBytes = await readRegularFileNoFollow(registryPath, pluginRoot);
		const registry = JSON.parse(registryBytes.toString('utf8'));
		assert.deepEqual(Object.keys(registry).sort(), [
			'currentPluginVersion',
			'kind',
			'registryVersion',
			'releases',
		]);
		assert.equal(registry.registryVersion, 1);
		assert.equal(registry.kind, 'operon-public-v1-release-freeze-registry');
		assert.equal(registry.currentPluginVersion, CURRENT_PLUGIN_VERSION);
		assert.deepEqual(registry.releases.map(release => release.pluginVersion), ['3.0.2', '3.1.0', '3.1.1']);
		assert.deepEqual(registry.releases[0], {
			pluginVersion: '3.0.2',
			cliVersion: '1.0.8',
			evidenceKind: 'live-acceptance',
			files: EXPECTED_HISTORICAL_FILES,
		});
		assert.deepEqual(registry.releases[1], {
			pluginVersion: '3.1.0',
			cliVersion: '1.0.9',
			evidenceKind: 'paired-release-validation',
			files: EXPECTED_PREVIOUS_FILES,
		});
		const verifiedFiles = new Map();
		for (const release of registry.releases) {
			assert.deepEqual(Object.keys(release).sort(), ['cliVersion', 'evidenceKind', 'files', 'pluginVersion']);
			assert.ok(Array.isArray(release.files) && release.files.length > 0);
			for (const identity of release.files) {
				assert.deepEqual(Object.keys(identity).sort(), ['bytes', 'path', 'sha256']);
				const bytes = await readRegularFileNoFollow(path.join(pluginRoot, identity.path), pluginRoot);
				assert.equal(bytes.byteLength, identity.bytes);
				assert.equal(sha256(bytes), identity.sha256);
				verifiedFiles.set(identity.path, bytes);
			}
		}

		const current = registry.releases[2];
		assert.equal(current.cliVersion, CURRENT_CLI_VERSION);
		assert.equal(current.evidenceKind, 'paired-automated-validation');
		assert.deepEqual(current.files, EXPECTED_CURRENT_FILES);
		const expectedCurrentPaths = EXPECTED_CURRENT_FILES.map(file => file.path);
		assert.deepEqual(current.files.map(file => file.path), expectedCurrentPaths);
		const [freezeBytes, schemaBytes, evidenceBytes] =
			expectedCurrentPaths.map(filePath => verifiedFiles.get(filePath));
		const bindingBytes = verifiedFiles.get(SHARED_CLI_BINDING_PATH);
		const bindingSchemaBytes = verifiedFiles.get(SHARED_CLI_SCHEMA_PATH);
		assert.ok([freezeBytes, schemaBytes, evidenceBytes, bindingBytes, bindingSchemaBytes]
			.every(Buffer.isBuffer));
		const freeze = JSON.parse(freezeBytes.toString('utf8'));
		const schema = JSON.parse(schemaBytes.toString('utf8'));
		const evidence = JSON.parse(evidenceBytes.toString('utf8'));
		const binding = JSON.parse(bindingBytes.toString('utf8'));
		const bindingSchema = JSON.parse(bindingSchemaBytes.toString('utf8'));
		const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, validateFormats: false });
		ajv.addSchema(schema);
		const validateFreeze = ajv.getSchema(schema.$id);
		const validateEvidence = ajv.getSchema(`${schema.$id}#/$defs/pairedReleaseEvidence`);
		assert.equal(validateFreeze(freeze), true, JSON.stringify(validateFreeze.errors));
		assert.equal(validateEvidence(evidence), true, JSON.stringify(validateEvidence.errors));
		const validateBinding = ajv.compile(bindingSchema);
		assert.equal(validateBinding(binding), true, JSON.stringify(validateBinding.errors));
		assertPublishedCliBinding(binding);
		assert.equal(binding.package.version, CURRENT_CLI_VERSION);
		assert.equal(binding.tarball.sha256, freeze.cli.tarballSha256);
		assert.deepEqual(freeze.runtime, evidence.runtime);
		assert.deepEqual(freeze.runtime, {
			contractVersion: binding.runtime.contractVersion,
			contractDigest: binding.runtime.contractDigest,
		});
		assert.deepEqual(freeze.pluginArtifact, evidence.plugin.artifact);
		assert.deepEqual(freeze.externalCliBinding, {
			path: SHARED_CLI_BINDING_PATH,
			bytes: bindingBytes.byteLength,
			sha256: sha256(bindingBytes),
			bindingAggregateSha256: binding.bindingAggregateSha256,
		});
		assert.deepEqual(freeze.pairedReleaseAcceptance.evidence, {
			path: expectedCurrentPaths[2],
			bytes: evidenceBytes.byteLength,
			sha256: sha256(evidenceBytes),
		});
		assert.equal(evidence.cli.package, `${binding.package.name}@${binding.package.version}`);
		assert.equal(evidence.cli.integratedCommit, binding.source.commit);
		assert.equal(evidence.cli.publication.tag, binding.source.tag);
		assert.equal(evidence.cli.publication.annotatedTagObject, binding.source.annotatedTagObject);
		assert.equal(evidence.cli.publication.canonicalHostedRun, binding.provenance.canonicalHostedRun);
		assert.equal(evidence.cli.publication.publishRun, binding.provenance.publishRun);
		assert.equal(evidence.cli.tarball.bytes, binding.tarball.bytes);
		assert.equal(evidence.cli.tarball.sha256, binding.tarball.sha256);
		assert.equal(evidence.cli.tarball.sha512, binding.tarball.sha512);
		assert.equal(evidence.cli.tarball.inventoryEntries, binding.artifact.inventoryEntries);
		assert.equal(evidence.plugin.productionCandidateCommit, evidence.pairedWindowsValidation.pluginCommit);
		assert.equal(evidence.cli.candidateCommit, evidence.pairedWindowsValidation.cliCandidateCommit);
		assertAutomatedReleaseEvidence({ freeze, evidence, binding });
		if (artifactPolicy === 'release') {
			const workingArtifact = await readReleaseArtifactIdentity(pluginRoot, freeze.pluginArtifact);
			assertReleaseArtifactMatchesFreeze(workingArtifact, freeze.pluginArtifact);
		}
		const { inputsAggregateSha256: aggregate, ...freezeBody } = freeze;
		assert.equal(aggregate, sha256(Buffer.from(canonicalJson(freezeBody), 'utf8')));
		return Object.freeze({ registry, freeze, evidence, binding });
	} catch (cause) {
		if (cause?.message === RELEASE_FREEZE_STALE) throw cause;
		throw new Error(RELEASE_FREEZE_STALE, { cause });
	}
}

export async function readReleaseArtifactIdentity(pluginRoot, frozenArtifact) {
	const manifest = JSON.parse((await readRegularFileNoFollow(path.join(pluginRoot, 'manifest.json'), pluginRoot)).toString('utf8'));
	return {
		version: manifest.version,
		files: await Promise.all(frozenArtifact.files.map(async identity => {
			const bytes = await readRegularFileNoFollow(path.join(pluginRoot, identity.path), pluginRoot);
			return { path: identity.path, bytes: bytes.byteLength, sha256: sha256(bytes) };
		})),
	};
}

export function assertReleaseArtifactMatchesFreeze(workingArtifact, frozenArtifact) {
	assert.deepEqual(workingArtifact, frozenArtifact);
	return true;
}

export function assertAutomatedReleaseEvidence({ freeze, evidence, binding }) {
	assert.deepEqual(Object.keys(evidence).sort(), [
		'$schema', 'acceptance', 'cli', 'evidenceVersion', 'historicalLiveBaseline', 'kind',
		'limitations', 'pairedWindowsValidation', 'plugin', 'runtime', 'state',
	]);
	assert.equal(evidence.evidenceVersion, 2);
	assert.equal(evidence.kind, 'operon-public-v1-paired-release-evidence');
	assert.equal(evidence.state, 'paired-release-accepted');
	assert.deepEqual(Object.keys(evidence.acceptance).sort(), [
		'candidateCommit', 'mode', 'scope', 'status',
	]);
	assert.equal(evidence.acceptance.mode, 'automated-validation');
	assert.equal(evidence.acceptance.scope, 'release-only-packaging');
	assert.equal(evidence.acceptance.status, 'accepted');
	assert.match(evidence.acceptance.candidateCommit, /^[a-f0-9]{40}$/u);
	assert.deepEqual(Object.keys(evidence.plugin).sort(), [
		'artifact', 'productionCandidateCommit', 'validation', 'version',
	]);
	assert.equal(Object.hasOwn(evidence.plugin, 'deployment'), false);
	assert.equal(Object.hasOwn(evidence, 'maintainerAcceptance'), false);
	assert.equal(evidence.plugin.productionCandidateCommit, evidence.acceptance.candidateCommit);
	assert.deepEqual(freeze.runtime, evidence.runtime);
	assert.deepEqual(freeze.pluginArtifact, evidence.plugin.artifact);

	const artifactAggregateSha256 = sha256(Buffer.from(canonicalJson(evidence.plugin.artifact), 'utf8'));
	const { local, hosted } = evidence.plugin.validation;
	assert.deepEqual(Object.keys(evidence.plugin.validation).sort(), ['hosted', 'local']);
	assert.deepEqual(Object.keys(local).sort(), [
		'artifactAggregateSha256', 'audit', 'candidateCommit', 'checkCandidate', 'node', 'npm',
		'npmCi', 'phase5', 'releaseGuard', 'trackedClean',
	]);
	assert.equal(local.candidateCommit, evidence.acceptance.candidateCommit);
	assert.equal(local.trackedClean, true);
	assert.equal(local.node, '24.18.0');
	assert.equal(local.npm, '11.12.1');
	assert.equal(local.npmCi, 'passed');
	assert.equal(local.checkCandidate, 'passed');
	assert.ok(Number.isSafeInteger(local.phase5.passed) && local.phase5.passed > 0);
	assert.equal(local.phase5.total, local.phase5.passed);
	assert.equal(local.releaseGuard, 'passed-candidate-mode');
	assert.deepEqual(local.audit, {
		status: 'accepted-clean',
		productionFindings: 0,
		developmentFindings: 0,
	});
	assert.equal(local.artifactAggregateSha256, artifactAggregateSha256);

	assert.deepEqual(Object.keys(hosted).sort(), [
		'artifactAggregateSha256', 'candidateCommit', 'ci', 'codeql',
	]);
	assert.equal(hosted.candidateCommit, evidence.acceptance.candidateCommit);
	assert.equal(hosted.artifactAggregateSha256, artifactAggregateSha256);
	assert.deepEqual(Object.keys(hosted.ci).sort(), ['headSha', 'jobId', 'runId', 'status']);
	assert.deepEqual(Object.keys(hosted.codeql).sort(), ['headSha', 'runId', 'status']);
	for (const result of [hosted.ci, hosted.codeql]) {
		assert.equal(result.headSha, evidence.acceptance.candidateCommit);
		assert.ok(Number.isSafeInteger(result.runId) && result.runId > 0);
		assert.equal(result.status, 'success');
	}
	assert.ok(Number.isSafeInteger(hosted.ci.jobId) && hosted.ci.jobId > 0);

	const pair = evidence.pairedWindowsValidation;
	assert.deepEqual(Object.keys(pair).sort(), [
		'artifactAggregateSha256', 'cliCandidateCommit', 'cliHosted', 'pluginCommit',
		'pluginNative', 'runId', 'status', 'trackedClean', 'windowsPairJobId',
	]);
	assert.equal(pair.pluginCommit, evidence.acceptance.candidateCommit);
	assert.equal(pair.cliCandidateCommit, evidence.cli.candidateCommit);
	assert.equal(evidence.cli.integratedCommit, binding.source.commit);
	assert.equal(pair.artifactAggregateSha256, artifactAggregateSha256);
	assert.ok(Number.isSafeInteger(pair.runId) && pair.runId > 0);
	assert.ok(Number.isSafeInteger(pair.windowsPairJobId) && pair.windowsPairJobId > 0);
	assert.equal(evidence.cli.treeMatchesCandidate, true);
	assert.match(evidence.cli.integratedTree, /^[a-f0-9]{40}$/u);
	assert.deepEqual(evidence.historicalLiveBaseline, {
		scope: 'historical-runtime-v1-baseline-only',
		pluginVersion: '3.1.0',
		cliVersion: '1.0.9',
		freezePath: `${PREVIOUS_RELEASE_ROOT}/public-v1-external-freeze.json`,
		freezeSha256: EXPECTED_PREVIOUS_FILES[0].sha256,
		evidencePath: `${PREVIOUS_RELEASE_ROOT}/paired-release-evidence.json`,
		evidenceSha256: EXPECTED_PREVIOUS_FILES[2].sha256,
	});
	assert.deepEqual(pair.pluginNative, { tests: 22, failed: 0, cancelled: 0, skipped: 0 });
	assert.deepEqual(pair.cliHosted, { assertions: 4, skipped: 0 });
	assert.equal(pair.trackedClean, true);
	assert.equal(pair.status, 'passed');

	assert.deepEqual(evidence.limitations, {
		liveDeployment: 'not-run',
		manualAcceptance: 'not-run-not-required',
		publishedCliLiveMutationSuite: 'not-rerun',
		cliInstalledInLiveVault: false,
	});
	assert.deepEqual(freeze.releaseAcceptance, {
		mode: 'automated-validation',
		status: 'accepted',
		candidateCommit: evidence.acceptance.candidateCommit,
	});
	return artifactAggregateSha256;
}

if (path.resolve(process.argv[1] ?? '') === scriptPath) {
	const result = await checkReleaseFreezeRegistry();
	console.log(`Operon ${result.freeze.pluginArtifact.version} / CLI ${result.binding.package.version} release freeze registry verified.`);
}
