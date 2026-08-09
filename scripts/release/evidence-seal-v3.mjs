#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import { assertPublishedCliBinding } from '../agent-runtime/cli/published-cli-v1.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const pluginRoot = path.resolve(path.dirname(scriptPath), '../..');
const registryRelativePath = 'contracts/agent-runtime/public-v1-release-freezes.json';
const bindingRelativePath = 'contracts/agent-runtime/published-cli-v1.json';
const artifactPaths = Object.freeze(['main.js', 'manifest.json', 'styles.css']);
const shaPattern = /^[a-f0-9]{40}$/u;

export function sealPaths(version) {
	assertVersion(version);
	const root = `contracts/agent-runtime/releases/${version}`;
	return Object.freeze([
		registryRelativePath,
		`${root}/paired-release-evidence.json`,
		`${root}/public-v1-external-freeze.json`,
		`${root}/public-v1-external-freeze.schema.json`,
	]);
}

export async function writeEvidenceSealV3(receiptPath, options = {}) {
	const root = options.pluginRoot ?? pluginRoot;
	const receipt = await readJsonNoFollow(path.resolve(required(receiptPath)), path.dirname(path.resolve(required(receiptPath))));
	validateReceipt(receipt);
	const version = receipt.version;
	const head = git(root, ['rev-parse', 'HEAD']);
	assert.equal(head, receipt.candidateCommit, 'OPERON_EVIDENCE_SEAL_CANDIDATE_HEAD_MISMATCH');
	assert.equal(git(root, ['status', '--porcelain=v1', '--untracked-files=all']), '', 'OPERON_EVIDENCE_SEAL_CANDIDATE_DIRTY');
	assert.equal(JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version, version, 'OPERON_EVIDENCE_SEAL_VERSION_MISMATCH');

	const bindingBytes = await readRegular(path.join(root, bindingRelativePath), root);
	const binding = JSON.parse(bindingBytes.toString('utf8'));
	assertPublishedCliBinding(binding);
	assert.equal(receipt.cli.integratedCommit, binding.source.commit, 'OPERON_EVIDENCE_SEAL_CLI_COMMIT_MISMATCH');
	assert.equal(receipt.cli.treeMatchesCandidate, true, 'OPERON_EVIDENCE_SEAL_CLI_TREE_MISMATCH');
	assert.equal(receipt.windowsPairProof.pluginCommit, head, 'OPERON_EVIDENCE_SEAL_PAIR_PLUGIN_MISMATCH');
	assert.equal(receipt.windowsPairProof.cliCandidateCommit, receipt.cli.candidateCommit, 'OPERON_EVIDENCE_SEAL_PAIR_CLI_MISMATCH');

	const artifact = await artifactIdentity(root, version);
	assert.deepEqual(receipt.localValidation.artifact, artifact, 'OPERON_EVIDENCE_SEAL_LOCAL_ARTIFACT_MISMATCH');
	const artifactAggregateSha256 = digest(Buffer.from(canonicalJson(artifact), 'utf8'));
	const previousRegistryBytes = await readRegular(path.join(root, registryRelativePath), root);
	const registry = JSON.parse(previousRegistryBytes.toString('utf8'));
	validateHistoricalRegistry(registry, version);
	const previous = registry.releases.at(-1);

	const evidence = buildEvidence({ receipt, binding, artifact, artifactAggregateSha256, previous });
	const evidenceBytes = jsonBytes(evidence);
	const releaseRoot = `contracts/agent-runtime/releases/${version}`;
	const evidenceRelativePath = `${releaseRoot}/paired-release-evidence.json`;
	const schema = evidenceSchema(version);
	const schemaBytes = jsonBytes(schema);
	const freeze = buildFreeze({ receipt, binding, bindingBytes, artifact, evidenceBytes, evidenceRelativePath, artifactAggregateSha256 });
	const freezeBytes = jsonBytes(freeze);
	const files = [
		{ path: `${releaseRoot}/public-v1-external-freeze.json`, bytes: freezeBytes },
		{ path: `${releaseRoot}/public-v1-external-freeze.schema.json`, bytes: schemaBytes },
		{ path: evidenceRelativePath, bytes: evidenceBytes },
	].sort((left, right) => left.path.localeCompare(right.path, 'en'));
	registry.currentPluginVersion = version;
	registry.releases.push({
		pluginVersion: version,
		cliVersion: binding.package.version,
		evidenceKind: 'paired-evidence-seal-v3',
		files: files.map(item => ({ path: item.path, bytes: item.bytes.byteLength, sha256: digest(item.bytes) })),
	});
	const registryBytes = jsonBytes(registry);

	const outputs = [
		{ path: registryRelativePath, bytes: registryBytes, replace: true },
		...files.map(item => ({ ...item, replace: false })),
	];
	await transactionalWrite(root, outputs, previousRegistryBytes);
	return Object.freeze({
		status: 'written',
		version,
		candidateCommit: head,
		paths: sealPaths(version),
		artifactAggregateSha256,
	});
}

export async function classifyEvidenceSealV3(options = {}) {
	const root = options.pluginRoot ?? pluginRoot;
	const head = git(root, ['rev-parse', 'HEAD']);
	const parentLine = git(root, ['rev-list', '--parents', '-n', '1', 'HEAD']).split(' ');
	if (parentLine.length !== 2) return Object.freeze({ mode: 'candidate', reason: 'HEAD is not a single-parent commit' });
	const candidateCommit = parentLine[1];
	const changed = git(root, ['diff-tree', '--no-commit-id', '--name-only', '-r', candidateCommit, head]).split('\n').filter(Boolean).sort();
	const packageVersion = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
	const expected = [...sealPaths(packageVersion)].sort();
	if (JSON.stringify(changed) !== JSON.stringify(expected)) {
		return Object.freeze({ mode: 'candidate', reason: 'HEAD does not change the exact evidence-seal allowlist' });
	}
	try {
		const checked = await checkEvidenceSealV3({ pluginRoot: root, requireHead: false });
		assert.equal(checked.candidateCommit, candidateCommit);
		return Object.freeze({ mode: 'evidence-seal', version: packageVersion, candidateCommit, sealCommit: head });
	} catch (error) {
		return Object.freeze({ mode: 'candidate', reason: error?.message ?? 'evidence seal validation failed' });
	}
}

export async function checkEvidenceSealV3(options = {}) {
	const root = options.pluginRoot ?? pluginRoot;
	const version = options.version ?? JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
	assertVersion(version);
	const [registry, binding, evidence, freeze, schema] = await Promise.all([
		readJsonNoFollow(path.join(root, registryRelativePath), root),
		readJsonNoFollow(path.join(root, bindingRelativePath), root),
		readJsonNoFollow(path.join(root, `contracts/agent-runtime/releases/${version}/paired-release-evidence.json`), root),
		readJsonNoFollow(path.join(root, `contracts/agent-runtime/releases/${version}/public-v1-external-freeze.json`), root),
		readJsonNoFollow(path.join(root, `contracts/agent-runtime/releases/${version}/public-v1-external-freeze.schema.json`), root),
	]);
	assertPublishedCliBinding(binding);
	assert.equal(schema.$id, `urn:operon:schema:public-v1-evidence-seal:v3:${version}`);
	assert.deepEqual(schema, evidenceSchema(version));
	const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, validateFormats: false });
	ajv.addSchema(schema);
	const validateFreeze = ajv.getSchema(schema.$id);
	const validateEvidence = ajv.getSchema(`${schema.$id}#/$defs/pairedReleaseEvidence`);
	assert.equal(validateFreeze(freeze), true, JSON.stringify(validateFreeze.errors));
	assert.equal(validateEvidence(evidence), true, JSON.stringify(validateEvidence.errors));
	assert.equal(evidence.evidenceVersion, 3);
	assert.equal(evidence.kind, 'operon-public-v1-paired-release-evidence');
	assert.equal(evidence.state, 'paired-release-sealed');
	assert.equal(freeze.evidenceVersion, 3);
	assert.equal(freeze.state, 'accepted');
	assertExactKeys(registry, ['currentPluginVersion', 'kind', 'registryVersion', 'releases']);
	assert.equal(registry.registryVersion, 1);
	assert.equal(registry.kind, 'operon-public-v1-release-freeze-registry');
	assert.equal(registry.currentPluginVersion, version);
	const entry = registry.releases.at(-1);
	assertExactKeys(entry, ['cliVersion', 'evidenceKind', 'files', 'pluginVersion']);
	assert.equal(entry.pluginVersion, version);
	assert.equal(entry.cliVersion, binding.package.version);
	assert.equal(entry.evidenceKind, 'paired-evidence-seal-v3');
	assert.deepEqual(entry.files.map(item => item.path).sort(), sealPaths(version).slice(1).sort());
	for (const identity of entry.files) {
		assertExactKeys(identity, ['bytes', 'path', 'sha256']);
		assert.ok(Number.isSafeInteger(identity.bytes) && identity.bytes > 0);
		assert.match(identity.sha256 ?? '', /^[a-f0-9]{64}$/u);
		const bytes = await readRegular(path.join(root, identity.path), root);
		assert.equal(bytes.byteLength, identity.bytes);
		assert.equal(digest(bytes), identity.sha256);
	}
	assert.deepEqual(freeze.runtime, evidence.runtime);
	assert.deepEqual(evidence.runtime, {
		contractVersion: binding.runtime.contractVersion,
		contractDigest: binding.runtime.contractDigest,
	});
	assert.equal(evidence.plugin.version, version);
	assert.deepEqual(freeze.pluginArtifact, evidence.plugin.artifact);
	assert.equal(freeze.releaseAcceptance.candidateCommit, evidence.acceptance.candidateCommit);
	assert.equal(freeze.releaseAcceptance.artifactAggregateSha256, evidence.plugin.validation.local.artifactAggregateSha256);
	assert.equal(freeze.pairedReleaseAcceptance.evidence.sha256, digest(jsonBytes(evidence)));
	assert.equal(freeze.externalCliBinding.sha256, digest(await readRegular(path.join(root, bindingRelativePath), root)));
	assert.equal(evidence.cli.integratedCommit, binding.source.commit);
	assert.equal(evidence.cli.package, `${binding.package.name}@${binding.package.version}`);
	assert.deepEqual(evidence.cli.tarball, {
		bytes: binding.tarball.bytes,
		sha256: binding.tarball.sha256,
		sha512: binding.tarball.sha512,
		inventoryEntries: binding.artifact.inventoryEntries,
	});
	validateReceiptDerivedEvidence(evidence);
	assert.deepEqual(evidence.cli.publication, {
		tag: binding.source.tag,
		tagObject: binding.source.tagObject,
		releaseUrl: binding.source.releaseUrl,
		canonicalHostedRun: binding.provenance.canonicalHostedRun,
		publishRun: binding.provenance.publishRun,
		publishRunAttempt: binding.provenance.publishRunAttempt,
		status: 'verified',
	});
	assert.deepEqual(evidence.limitations, expectedLimitations());
	const artifactAggregateSha256 = digest(Buffer.from(canonicalJson(evidence.plugin.artifact), 'utf8'));
	assert.equal(evidence.plugin.validation.local.artifactAggregateSha256, artifactAggregateSha256);
	assert.equal(evidence.plugin.validation.hosted.artifactAggregateSha256, artifactAggregateSha256);
	assert.equal(evidence.pairedWindowsValidation.artifactAggregateSha256, artifactAggregateSha256);
	const candidateCommit = evidence.acceptance.candidateCommit;
	assert.deepEqual(evidence.plugin.artifact, await artifactIdentity(root, version));
	const parentRegistry = JSON.parse(gitBlob(root, candidateCommit, registryRelativePath).toString('utf8'));
	assert.deepEqual(registry.releases.slice(0, -1), parentRegistry.releases);
	assert.equal(parentRegistry.currentPluginVersion, parentRegistry.releases.at(-1)?.pluginVersion);
	const previous = parentRegistry.releases.at(-1);
	assert.deepEqual(evidence.historicalReleaseBaseline, {
		pluginVersion: previous.pluginVersion,
		cliVersion: previous.cliVersion,
		registryEntrySha256: digest(Buffer.from(canonicalJson(previous), 'utf8')),
	});
	const { inputsAggregateSha256, ...freezeBody } = freeze;
	assert.equal(inputsAggregateSha256, digest(Buffer.from(canonicalJson(freezeBody), 'utf8')));
	assert.deepEqual(freeze.externalCliBinding, {
		path: bindingRelativePath,
		bytes: (await readRegular(path.join(root, bindingRelativePath), root)).byteLength,
		sha256: digest(await readRegular(path.join(root, bindingRelativePath), root)),
		bindingAggregateSha256: binding.bindingAggregateSha256,
	});
	assert.deepEqual(freeze.cli, {
		packageName: binding.package.name,
		packageVersion: binding.package.version,
		tarballSha256: binding.tarball.sha256,
	});
	assert.deepEqual(freeze.audit, {
		validation: {
			command: 'npm run release:audit-policy',
			status: 'passed',
			result: { status: 'accepted-clean', productionVulnerabilities: 0, developmentVulnerabilities: 0 },
		},
	});
	assert.deepEqual(freeze.releaseAcceptance, {
		mode: 'automated-validation',
		status: 'accepted',
		candidateCommit,
		artifactAggregateSha256,
	});
	assert.deepEqual(freeze.pairedReleaseAcceptance, {
		evidence: {
			path: `contracts/agent-runtime/releases/${version}/paired-release-evidence.json`,
			bytes: jsonBytes(evidence).byteLength,
			sha256: digest(jsonBytes(evidence)),
		},
		scope: 'plugin-local-hosted-and-paired-automated',
	});
	for (const release of registry.releases) {
		assertExactKeys(release, ['cliVersion', 'evidenceKind', 'files', 'pluginVersion']);
		for (const identity of release.files) assertExactKeys(identity, ['bytes', 'path', 'sha256']);
	}
	for (const identity of evidence.plugin.artifact.files) {
		const bytes = await readRegular(path.join(root, identity.path), root);
		assert.equal(bytes.byteLength, identity.bytes);
		assert.equal(digest(bytes), identity.sha256);
	}
	if (options.requireHead !== false) {
		const classification = await classifyEvidenceSealV3({ pluginRoot: root });
		assert.equal(classification.mode, 'evidence-seal', classification.reason);
	}
	return Object.freeze({ status: 'passed', version, candidateCommit, artifactAggregateSha256, evidence, freeze });
}

function buildEvidence({ receipt, binding, artifact, artifactAggregateSha256, previous }) {
	return {
		$schema: './public-v1-external-freeze.schema.json#/$defs/pairedReleaseEvidence',
		evidenceVersion: 3,
		kind: 'operon-public-v1-paired-release-evidence',
		state: 'paired-release-sealed',
		runtime: { contractVersion: binding.runtime.contractVersion, contractDigest: binding.runtime.contractDigest },
		acceptance: { mode: 'automated-validation', scope: 'release-only-packaging', status: 'accepted', candidateCommit: receipt.candidateCommit },
		plugin: {
			version: receipt.version,
			productionCandidateCommit: receipt.candidateCommit,
			artifact,
			validation: {
				local: { ...receipt.localValidation, artifactAggregateSha256 },
				hosted: { ...receipt.hostedValidation, artifactAggregateSha256 },
			},
		},
		cli: {
			package: `${binding.package.name}@${binding.package.version}`,
			...receipt.cli,
			tarball: { bytes: binding.tarball.bytes, sha256: binding.tarball.sha256, sha512: binding.tarball.sha512, inventoryEntries: binding.artifact.inventoryEntries },
			publication: {
				tag: binding.source.tag,
				tagObject: binding.source.tagObject,
				releaseUrl: binding.source.releaseUrl,
				canonicalHostedRun: binding.provenance.canonicalHostedRun,
				publishRun: binding.provenance.publishRun,
				publishRunAttempt: binding.provenance.publishRunAttempt,
				status: 'verified',
			},
		},
		pairedWindowsValidation: { ...receipt.windowsPairProof, artifactAggregateSha256 },
		historicalReleaseBaseline: {
			pluginVersion: previous.pluginVersion,
			cliVersion: previous.cliVersion,
			registryEntrySha256: digest(Buffer.from(canonicalJson(previous), 'utf8')),
		},
		limitations: receipt.limitations,
	};
}

function buildFreeze({ receipt, binding, bindingBytes, artifact, evidenceBytes, evidenceRelativePath, artifactAggregateSha256 }) {
	const body = {
		$schema: './public-v1-external-freeze.schema.json',
		freezeVersion: 1,
		evidenceVersion: 3,
		kind: 'operon-public-v1-external-freeze',
		state: 'accepted',
		runtime: { contractVersion: binding.runtime.contractVersion, contractDigest: binding.runtime.contractDigest },
		externalCliBinding: { path: bindingRelativePath, bytes: bindingBytes.byteLength, sha256: digest(bindingBytes), bindingAggregateSha256: binding.bindingAggregateSha256 },
		cli: { packageName: binding.package.name, packageVersion: binding.package.version, tarballSha256: binding.tarball.sha256 },
		pluginArtifact: artifact,
		audit: { validation: { command: 'npm run release:audit-policy', status: 'passed', result: { status: 'accepted-clean', productionVulnerabilities: 0, developmentVulnerabilities: 0 } } },
		pairedReleaseAcceptance: { evidence: { path: evidenceRelativePath, bytes: evidenceBytes.byteLength, sha256: digest(evidenceBytes) }, scope: 'plugin-local-hosted-and-paired-automated' },
		releaseAcceptance: { mode: 'automated-validation', status: 'accepted', candidateCommit: receipt.candidateCommit, artifactAggregateSha256 },
	};
	return { ...body, inputsAggregateSha256: digest(Buffer.from(canonicalJson(body), 'utf8')) };
}

function evidenceSchema(version) {
	return {
		$schema: 'https://json-schema.org/draft/2020-12/schema',
		$id: `urn:operon:schema:public-v1-evidence-seal:v3:${version}`,
		title: `Operon Public Runtime V1 Evidence Seal ${version}`,
		type: 'object', additionalProperties: false,
		required: ['$schema', 'freezeVersion', 'evidenceVersion', 'kind', 'state', 'runtime', 'externalCliBinding', 'cli', 'pluginArtifact', 'audit', 'pairedReleaseAcceptance', 'releaseAcceptance', 'inputsAggregateSha256'],
		properties: {
			$schema: { const: './public-v1-external-freeze.schema.json' },
			freezeVersion: { const: 1 },
			evidenceVersion: { const: 3 },
			kind: { const: 'operon-public-v1-external-freeze' },
			state: { const: 'accepted' },
			runtime: { type: 'object' },
			externalCliBinding: { type: 'object' },
			cli: { type: 'object' },
			pluginArtifact: { type: 'object' },
			audit: { type: 'object' },
			pairedReleaseAcceptance: { type: 'object' },
			releaseAcceptance: { type: 'object' },
			inputsAggregateSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
		},
		$defs: {
			pairedReleaseEvidence: {
				type: 'object', additionalProperties: false,
				required: ['$schema', 'evidenceVersion', 'kind', 'state', 'runtime', 'acceptance', 'plugin', 'cli', 'pairedWindowsValidation', 'historicalReleaseBaseline', 'limitations'],
				properties: {
					$schema: { const: './public-v1-external-freeze.schema.json#/$defs/pairedReleaseEvidence' },
					evidenceVersion: { const: 3 },
					kind: { const: 'operon-public-v1-paired-release-evidence' },
					state: { const: 'paired-release-sealed' },
					runtime: { type: 'object' },
					acceptance: { type: 'object' },
					plugin: { type: 'object' },
					cli: { type: 'object' },
					pairedWindowsValidation: { type: 'object' },
					historicalReleaseBaseline: { type: 'object' },
					limitations: { type: 'object' },
				},
			},
		},
	};
}

function validateReceipt(receipt) {
	assertExactKeys(receipt, ['candidateCommit', 'cli', 'hostedValidation', 'kind', 'limitations', 'localValidation', 'receiptVersion', 'version', 'windowsPairProof']);
	assert.equal(receipt.receiptVersion, 3);
	assert.equal(receipt.kind, 'operon-release-evidence-receipt');
	assertVersion(receipt.version);
	assertSha(receipt.candidateCommit);
	assertExactKeys(receipt.localValidation, ['artifact', 'audit', 'candidateCommit', 'checkCandidate', 'node', 'npm', 'npmCi', 'phase5', 'releaseGuard', 'trackedClean']);
	assert.equal(receipt.localValidation.candidateCommit, receipt.candidateCommit);
	assert.equal(receipt.localValidation.trackedClean, true);
	assert.equal(receipt.localValidation.node, '24.18.0');
	assert.equal(receipt.localValidation.npm, '11.12.1');
	for (const key of ['npmCi', 'checkCandidate']) assert.equal(receipt.localValidation[key], 'passed');
	assert.equal(receipt.localValidation.releaseGuard, 'passed-candidate-mode');
	assert.ok(Number.isSafeInteger(receipt.localValidation.phase5?.passed) && receipt.localValidation.phase5.passed > 0);
	assert.equal(receipt.localValidation.phase5.total, receipt.localValidation.phase5.passed);
	assert.deepEqual(receipt.localValidation.audit, { status: 'accepted-clean', productionFindings: 0, developmentFindings: 0 });
	assertExactKeys(receipt.hostedValidation, ['candidateCommit', 'ci', 'codeql']);
	assert.equal(receipt.hostedValidation.candidateCommit, receipt.candidateCommit);
	validateHostedProof(receipt.hostedValidation.ci, receipt.candidateCommit, 'hasanyilmaz/operon');
	validateHostedProof(receipt.hostedValidation.codeql, receipt.candidateCommit, 'hasanyilmaz/operon');
	assert.equal(receipt.hostedValidation.ci.workflowPath, '.github/workflows/ci.yml');
	assert.equal(receipt.hostedValidation.ci.jobName, 'Validation gate');
	assert.equal(receipt.hostedValidation.codeql.workflowPath, '.github/workflows/codeql.yml');
	assert.equal(receipt.hostedValidation.codeql.jobName, 'CodeQL gate');
	assertExactKeys(receipt.cli, ['candidateCommit', 'integratedCommit', 'integratedTree', 'treeMatchesCandidate']);
	for (const key of ['candidateCommit', 'integratedCommit', 'integratedTree']) assertSha(receipt.cli[key]);
	assert.equal(receipt.cli.treeMatchesCandidate, true);
	validateHostedProof(receipt.windowsPairProof, receipt.cli.candidateCommit, 'hasanyilmaz/operon-cli', true);
	assert.equal(receipt.windowsPairProof.workflowPath, '.github/workflows/windows-pair-validation.yml');
	assert.equal(receipt.windowsPairProof.jobName, 'Validate exact Windows pair');
	assert.equal(receipt.windowsPairProof.pluginCommit, receipt.candidateCommit);
	assert.equal(receipt.windowsPairProof.cliCandidateCommit, receipt.cli.candidateCommit);
	assert.deepEqual(receipt.limitations, expectedLimitations());
}

function validateHostedProof(proof, candidateCommit, repository, pair = false) {
	const keys = pair
		? ['cliCandidateCommit', 'cliHosted', 'headSha', 'jobId', 'jobName', 'pluginCommit', 'pluginNative', 'repository', 'runAttempt', 'runId', 'status', 'trackedClean', 'workflowPath']
		: ['headSha', 'jobId', 'jobName', 'repository', 'runAttempt', 'runId', 'status', 'workflowPath'];
	if (pair && Object.hasOwn(proof, 'artifactAggregateSha256')) keys.push('artifactAggregateSha256');
	assertExactKeys(proof, keys);
	assert.equal(proof.repository, repository);
	assert.equal(proof.headSha, candidateCommit);
	assert.ok(Number.isSafeInteger(proof.runId) && proof.runId > 0);
	assert.ok(Number.isSafeInteger(proof.runAttempt) && proof.runAttempt > 0);
	assert.ok(Number.isSafeInteger(proof.jobId) && proof.jobId > 0);
	assert.ok(typeof proof.jobName === 'string' && proof.jobName.length > 0);
	assert.ok(/^\.github\/workflows\/[a-z0-9._-]+\.ya?ml$/u.test(proof.workflowPath));
	assert.equal(proof.status, 'success');
	if (pair) {
		assert.equal(proof.trackedClean, true);
		assert.deepEqual(proof.pluginNative, { tests: 22, failed: 0, cancelled: 0, skipped: 0 });
		assert.deepEqual(proof.cliHosted, { assertions: 4, skipped: 0 });
	}
}

function validateReceiptDerivedEvidence(evidence) {
	assertExactKeys(evidence, ['$schema', 'acceptance', 'cli', 'evidenceVersion', 'historicalReleaseBaseline', 'kind', 'limitations', 'pairedWindowsValidation', 'plugin', 'runtime', 'state']);
	assertExactKeys(evidence.runtime, ['contractDigest', 'contractVersion']);
	assertExactKeys(evidence.acceptance, ['candidateCommit', 'mode', 'scope', 'status']);
	assert.equal(evidence.acceptance.mode, 'automated-validation');
	assert.equal(evidence.acceptance.scope, 'release-only-packaging');
	assert.equal(evidence.acceptance.status, 'accepted');
	assertSha(evidence.acceptance.candidateCommit);
	assertExactKeys(evidence.plugin, ['artifact', 'productionCandidateCommit', 'validation', 'version']);
	assertVersion(evidence.plugin.version);
	validateArtifactEvidence(evidence.plugin.artifact, evidence.plugin.version);
	assertExactKeys(evidence.plugin.validation, ['hosted', 'local']);
	assertExactKeys(evidence.plugin.validation.local, ['artifact', 'artifactAggregateSha256', 'audit', 'candidateCommit', 'checkCandidate', 'node', 'npm', 'npmCi', 'phase5', 'releaseGuard', 'trackedClean']);
	assert.equal(evidence.plugin.productionCandidateCommit, evidence.acceptance.candidateCommit);
	assert.equal(evidence.plugin.validation.local.candidateCommit, evidence.acceptance.candidateCommit);
	assert.equal(evidence.plugin.validation.local.trackedClean, true);
	assert.equal(evidence.plugin.validation.local.node, '24.18.0');
	assert.equal(evidence.plugin.validation.local.npm, '11.12.1');
	assert.equal(evidence.plugin.validation.local.npmCi, 'passed');
	assert.equal(evidence.plugin.validation.local.checkCandidate, 'passed');
	assert.equal(evidence.plugin.validation.local.releaseGuard, 'passed-candidate-mode');
	assert.ok(Number.isSafeInteger(evidence.plugin.validation.local.phase5?.passed) && evidence.plugin.validation.local.phase5.passed > 0);
	assert.equal(evidence.plugin.validation.local.phase5.total, evidence.plugin.validation.local.phase5.passed);
	assert.deepEqual(evidence.plugin.validation.local.audit, { status: 'accepted-clean', productionFindings: 0, developmentFindings: 0 });
	assert.deepEqual(evidence.plugin.validation.local.artifact, evidence.plugin.artifact);
	assertExactKeys(evidence.plugin.validation.hosted, ['artifactAggregateSha256', 'candidateCommit', 'ci', 'codeql']);
	assert.equal(evidence.plugin.validation.hosted.candidateCommit, evidence.acceptance.candidateCommit);
	validateHostedProof(evidence.plugin.validation.hosted.ci, evidence.acceptance.candidateCommit, 'hasanyilmaz/operon');
	validateHostedProof(evidence.plugin.validation.hosted.codeql, evidence.acceptance.candidateCommit, 'hasanyilmaz/operon');
	assert.equal(evidence.plugin.validation.hosted.ci.workflowPath, '.github/workflows/ci.yml');
	assert.equal(evidence.plugin.validation.hosted.ci.jobName, 'Validation gate');
	assert.equal(evidence.plugin.validation.hosted.codeql.workflowPath, '.github/workflows/codeql.yml');
	assert.equal(evidence.plugin.validation.hosted.codeql.jobName, 'CodeQL gate');
	assertExactKeys(evidence.cli, ['candidateCommit', 'integratedCommit', 'integratedTree', 'package', 'publication', 'tarball', 'treeMatchesCandidate']);
	for (const key of ['candidateCommit', 'integratedCommit', 'integratedTree']) assertSha(evidence.cli[key]);
	assert.equal(evidence.cli.treeMatchesCandidate, true);
	assertExactKeys(evidence.cli.tarball, ['bytes', 'inventoryEntries', 'sha256', 'sha512']);
	assert.ok(Number.isSafeInteger(evidence.cli.tarball.bytes) && evidence.cli.tarball.bytes > 0);
	assert.ok(Number.isSafeInteger(evidence.cli.tarball.inventoryEntries) && evidence.cli.tarball.inventoryEntries > 0);
	assert.match(evidence.cli.tarball.sha256 ?? '', /^[a-f0-9]{64}$/u);
	assert.ok(typeof evidence.cli.tarball.sha512 === 'string' && evidence.cli.tarball.sha512.length > 0);
	assertExactKeys(evidence.cli.publication, ['canonicalHostedRun', 'publishRun', 'publishRunAttempt', 'releaseUrl', 'status', 'tag', 'tagObject']);
	validateHostedProof(evidence.pairedWindowsValidation, evidence.cli.candidateCommit, 'hasanyilmaz/operon-cli', true);
	assert.equal(evidence.pairedWindowsValidation.workflowPath, '.github/workflows/windows-pair-validation.yml');
	assert.equal(evidence.pairedWindowsValidation.jobName, 'Validate exact Windows pair');
	assert.equal(evidence.pairedWindowsValidation.pluginCommit, evidence.acceptance.candidateCommit);
	assert.equal(evidence.pairedWindowsValidation.cliCandidateCommit, evidence.cli.candidateCommit);
	assertExactKeys(evidence.historicalReleaseBaseline, ['cliVersion', 'pluginVersion', 'registryEntrySha256']);
	assertVersion(evidence.historicalReleaseBaseline.pluginVersion);
	assertVersion(evidence.historicalReleaseBaseline.cliVersion);
	assert.match(evidence.historicalReleaseBaseline.registryEntrySha256 ?? '', /^[a-f0-9]{64}$/u);
	assert.deepEqual(evidence.limitations, expectedLimitations());
}

function validateArtifactEvidence(artifact, version) {
	assertExactKeys(artifact, ['files', 'version']);
	assert.equal(artifact.version, version);
	assert.ok(Array.isArray(artifact.files));
	assert.deepEqual(artifact.files.map(identity => identity.path), artifactPaths);
	for (const identity of artifact.files) {
		assertExactKeys(identity, ['bytes', 'path', 'sha256']);
		assert.ok(Number.isSafeInteger(identity.bytes) && identity.bytes > 0);
		assert.match(identity.sha256 ?? '', /^[a-f0-9]{64}$/u);
	}
}

function expectedLimitations() {
	return { liveDeployment: 'not-run', manualAcceptance: 'not-run-not-required', publishedCliLiveMutationSuite: 'not-rerun', cliInstalledInLiveVault: false };
}

function validateHistoricalRegistry(registry, version) {
	assertExactKeys(registry, ['currentPluginVersion', 'kind', 'registryVersion', 'releases']);
	assert.equal(registry.registryVersion, 1);
	assert.equal(registry.kind, 'operon-public-v1-release-freeze-registry');
	assert.ok(Array.isArray(registry.releases) && registry.releases.length > 0);
	assert.equal(registry.releases.some(item => item.pluginVersion === version), false, 'OPERON_EVIDENCE_SEAL_VERSION_EXISTS');
}

async function artifactIdentity(root, version) {
	return { version, files: await Promise.all(artifactPaths.map(async relativePath => {
		const bytes = await readRegular(path.join(root, relativePath), root);
		return { path: relativePath, bytes: bytes.byteLength, sha256: digest(bytes) };
	})) };
}

async function transactionalWrite(root, outputs, previousRegistryBytes) {
	const staged = [];
	const created = [];
	try {
		for (const output of outputs) {
			const target = path.join(root, output.path);
			await assertSafeParentChain(root, target);
			await mkdir(path.dirname(target), { recursive: true });
			if (!output.replace) await assertAbsent(target);
			const temporary = `${target}.tmp-${randomUUID()}`;
			await writeFile(temporary, output.bytes, { flag: 'wx', mode: 0o644 });
			staged.push({ ...output, target, temporary });
		}
		for (const output of staged.filter(item => !item.replace)) {
			await rename(output.temporary, output.target);
			created.push(output.target);
		}
		const registryOutput = staged.find(item => item.replace);
		assert.ok(registryOutput);
		await rename(registryOutput.temporary, registryOutput.target);
		for (const output of staged) {
			if (output === registryOutput || created.includes(output.target)) continue;
			await rm(output.temporary, { force: true });
		}
	} catch (error) {
		await Promise.all(staged.map(output => rm(output.temporary, { force: true })));
		await Promise.all(created.map(target => rm(target, { force: true })));
		const registryTarget = path.join(root, registryRelativePath);
		const restore = `${registryTarget}.tmp-${randomUUID()}`;
		await writeFile(restore, previousRegistryBytes, { flag: 'wx', mode: 0o644 });
		await rename(restore, registryTarget);
		throw error;
	}
}

async function assertSafeParentChain(trustedRoot, target) {
	const root = path.resolve(trustedRoot);
	const parent = path.dirname(path.resolve(target));
	const relative = path.relative(root, parent);
	assert.ok(relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
	let current = root;
	for (const segment of relative.split(path.sep).filter(Boolean)) {
		current = path.join(current, segment);
		try {
			const stat = await lstat(current);
			assert.equal(stat.isSymbolicLink(), false, `OPERON_EVIDENCE_SEAL_PARENT_SYMLINK:${current}`);
			assert.equal(stat.isDirectory(), true, `OPERON_EVIDENCE_SEAL_PARENT_NOT_DIRECTORY:${current}`);
		} catch (error) {
			if (error?.code !== 'ENOENT') throw error;
		}
	}
}

async function readJsonNoFollow(target, trustedRoot) {
	return JSON.parse((await readRegular(target, trustedRoot)).toString('utf8'));
}

async function readRegular(target, trustedRoot) {
	const absolute = path.resolve(target);
	const relative = path.relative(path.resolve(trustedRoot), absolute);
	assert.ok(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
	const stat = await lstat(absolute);
	assert.equal(stat.isFile(), true);
	assert.equal(stat.isSymbolicLink(), false);
	return readFile(absolute);
}

async function assertAbsent(target) {
	try { await lstat(target); } catch (error) { if (error?.code === 'ENOENT') return; throw error; }
	throw new Error(`OPERON_EVIDENCE_SEAL_TARGET_EXISTS:${target}`);
}

function git(root, args) {
	const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', shell: false });
	if (result.status !== 0) throw new Error(`OPERON_EVIDENCE_SEAL_GIT_FAILED:${args.join(':')}:${result.stderr}`);
	return result.stdout.trim();
}

function gitBlob(root, commit, relativePath) {
	assertSha(commit);
	assert.ok(!relativePath.includes('\0') && !path.isAbsolute(relativePath) && !relativePath.split('/').includes('..'));
	const result = spawnSync('git', ['show', `${commit}:${relativePath}`], { cwd: root, encoding: null, shell: false, maxBuffer: 16 * 1024 * 1024 });
	if (result.status !== 0) throw new Error(`OPERON_EVIDENCE_SEAL_GIT_BLOB_FAILED:${relativePath}:${result.stderr?.toString('utf8') ?? ''}`);
	return result.stdout;
}

function jsonBytes(value) { return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
function digest(value) { return createHash('sha256').update(value).digest('hex'); }
function required(value) { if (!value) throw new Error('OPERON_EVIDENCE_SEAL_ARGUMENT_REQUIRED'); return value; }
function assertVersion(value) { assert.match(value ?? '', /^[0-9]+\.[0-9]+\.[0-9]+$/u); }
function assertSha(value) { assert.match(value ?? '', shaPattern); }
function assertExactKeys(value, keys) { assert.deepEqual(Object.keys(value ?? {}).sort(), [...keys].sort()); }

export function canonicalJson(value) {
	if (value === null || typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value);
	if (typeof value === 'string') return JSON.stringify(value.normalize('NFC'));
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key.normalize('NFC'))}:${canonicalJson(value[key])}`).join(',')}}`;
}

if (path.resolve(process.argv[1] ?? '') === scriptPath) {
	const [command, ...args] = process.argv.slice(2);
	let result;
	if (command === 'write') result = await writeEvidenceSealV3(argumentValue(args, '--receipt'));
	else if (command === 'classify') result = await classifyEvidenceSealV3();
	else if (command === 'check') result = await checkEvidenceSealV3();
	else throw new Error(`OPERON_EVIDENCE_SEAL_COMMAND_INVALID:${command ?? ''}`);
	console.log(JSON.stringify(result));
}

function argumentValue(args, name) {
	assert.equal(args.length, 2);
	assert.equal(args[0], name);
	return required(args[1]);
}
