#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

import { loadPublishedCliBinding } from '../agent-runtime/cli/published-cli-v1.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const defaultPluginRoot = path.resolve(path.dirname(scriptPath), '../..');

export const EXTERNAL_FREEZE_RELATIVE_PATH =
	'contracts/agent-runtime/public-v1-external-freeze.json';
export const EXTERNAL_FREEZE_SCHEMA_RELATIVE_PATH =
	'contracts/agent-runtime/public-v1-external-freeze.schema.json';
export const LIVE_ACCEPTANCE_RELATIVE_PATH =
	'contracts/agent-runtime/public-v1-live-acceptance.json';
export const PUBLISHED_CLI_BINDING_RELATIVE_PATH =
	'contracts/agent-runtime/published-cli-v1.json';
export const PUBLISHED_CLI_BINDING_SCHEMA_RELATIVE_PATH =
	'contracts/agent-runtime/published-cli-v1.schema.json';
export const PUBLIC_V1_FREEZE_STALE = 'OPERON_PUBLIC_V1_FREEZE_STALE';
export const RUNTIME_V1_CONTRACT_DIGEST =
	'407f3a222f8c59a9622038e99e9345d0d34882fd358149b38bce5354ae0ca92b';
export const PUBLISHED_CLI_TARBALL_SHA256 =
	'8638e108569f7a17de39a8c7981f48fa609dab47dc2d86e18bf2453046c540c8';
export const CANONICAL_NODE_VERSION = '24.18.0';
export const CANONICAL_NPM_VERSION = '11.12.1';
export const PLUGIN_RELEASE_VERSION = '3.0.2';
export const PLUGIN_ARTIFACT_PATHS = Object.freeze([
	'main.js',
	'manifest.json',
	'styles.css',
]);
export const PUBLISHED_FAMILIES = Object.freeze([
	'task.create',
	'task.update',
	'task.recurrence',
	'task.relationship',
	'task.reminder-item',
	'task.transition',
	'task.pinned-state',
	'timer.control',
	'timer.session',
	'task.convert',
	'task.inline-relocate',
	'task.delete',
]);
export const FAMILY_RESULTS = Object.freeze([
	Object.freeze({ family: 'task.create', source: 'create', status: 'ok' }),
	Object.freeze({ family: 'task.update', source: 'phase8', status: 'ok' }),
	Object.freeze({ family: 'task.recurrence', source: 'recurrence', status: 'ok' }),
	Object.freeze({ family: 'task.relationship', source: 'relationship', status: 'ok' }),
	Object.freeze({ family: 'task.reminder-item', source: 'phase8', status: 'ok' }),
	Object.freeze({ family: 'task.transition', source: 'phase8', status: 'ok' }),
	Object.freeze({ family: 'task.pinned-state', source: 'pinnedState', status: 'ok' }),
	Object.freeze({ family: 'timer.control', source: 'phase8', status: 'ok' }),
	Object.freeze({ family: 'timer.session', source: 'timerSession', status: 'ok' }),
	Object.freeze({ family: 'task.convert', source: 'phase8', status: 'ok' }),
	Object.freeze({ family: 'task.inline-relocate', source: 'phase8', status: 'ok' }),
	Object.freeze({ family: 'task.delete', source: 'phase8', status: 'ok' }),
]);

export function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

export function canonicalJson(value) {
	if (value === null || typeof value === 'boolean' || typeof value === 'number') {
		return JSON.stringify(value);
	}
	if (typeof value === 'string') return JSON.stringify(value.normalize('NFC'));
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	return `{${Object.keys(value).sort().map(key => (
		`${JSON.stringify(key.normalize('NFC'))}:${canonicalJson(value[key])}`
	)).join(',')}}`;
}

export function externalFreezeAggregate(freeze) {
	const { inputsAggregateSha256: _aggregate, ...body } = freeze;
	return sha256(Buffer.from(canonicalJson(body), 'utf8'));
}

export function validateMaintainerIdentity(value) {
	assert.ok(typeof value === 'string');
	assert.equal(value, value.normalize('NFC'));
	assert.equal(value, value.trim());
	assert.ok(value.length >= 1 && value.length <= 256);
	assert.doesNotMatch(value, /\p{Cc}/u);
	return value;
}

export async function readRegularFileNoFollow(target, trustedRoot) {
	const absoluteTarget = path.resolve(target);
	const absoluteRoot = path.resolve(trustedRoot);
	const rootRealPath = await realpath(absoluteRoot);
	assert.equal(rootRealPath, absoluteRoot);
	const relative = path.relative(absoluteRoot, absoluteTarget);
	assert.ok(
		relative
		&& relative !== '..'
		&& !path.isAbsolute(relative)
		&& !relative.startsWith(`..${path.sep}`),
	);

	let current = absoluteRoot;
	for (const segment of relative.split(path.sep)) {
		current = path.join(current, segment);
		const stats = await lstat(current);
		assert.equal(stats.isSymbolicLink(), false);
		if (current !== absoluteTarget) assert.equal(stats.isDirectory(), true);
	}

	const handle = await open(absoluteTarget, 'r');
	try {
		const [handleStats, targetRealPath] = await Promise.all([
			handle.stat(),
			realpath(absoluteTarget),
		]);
		assert.equal(handleStats.isFile(), true);
		assert.equal(targetRealPath, absoluteTarget);
		const finalStats = await lstat(absoluteTarget);
		assert.equal(finalStats.isFile(), true);
		assert.equal(finalStats.isSymbolicLink(), false);
		if (Number.isSafeInteger(handleStats.ino) && Number.isSafeInteger(finalStats.ino)) {
			assert.equal(handleStats.ino, finalStats.ino);
			assert.equal(handleStats.dev, finalStats.dev);
		}
		return await handle.readFile();
	} finally {
		await handle.close();
	}
}

export async function readPluginArtifactIdentity(artifactRoot = defaultPluginRoot) {
	const entries = await Promise.all(PLUGIN_ARTIFACT_PATHS.map(async relativePath => {
		const bytes = await readRegularFileNoFollow(path.join(artifactRoot, relativePath), artifactRoot);
		return Object.freeze({
			path: relativePath,
			bytes: bytes.byteLength,
			sha256: sha256(bytes),
		});
	}));
	const manifestBytes = await readRegularFileNoFollow(
		path.join(artifactRoot, 'manifest.json'),
		artifactRoot,
	);
	const manifest = JSON.parse(manifestBytes.toString('utf8'));
	assert.equal(manifest.version, PLUGIN_RELEASE_VERSION);
	return Object.freeze({
		version: PLUGIN_RELEASE_VERSION,
		files: Object.freeze(entries),
	});
}

export function validateExternalFreezeDocuments(freeze, evidence, schema) {
	const ajv = new Ajv2020({
		allErrors: true,
		strict: true,
		strictRequired: false,
		validateFormats: false,
	});
	ajv.addSchema(schema);
	const validateFreeze = ajv.getSchema(schema.$id);
	const validateEvidence = ajv.getSchema(`${schema.$id}#/$defs/liveAcceptanceEvidence`);
	assert.equal(typeof validateFreeze, 'function');
	assert.equal(typeof validateEvidence, 'function');
	assert.equal(validateFreeze(freeze), true, JSON.stringify(validateFreeze.errors));
	assert.equal(validateEvidence(evidence), true, JSON.stringify(validateEvidence.errors));
	return true;
}

export function assertAcceptedReleaseFreeze(freeze, options = {}) {
	try {
		const { binding, bindingBytes, evidence, evidenceBytes, pluginArtifact } = options;
		assert.ok(binding && Buffer.isBuffer(bindingBytes));
		assert.ok(evidence && Buffer.isBuffer(evidenceBytes));
		assert.equal(freeze.freezeVersion, 1);
		assert.equal(freeze.kind, 'operon-public-v1-external-freeze');
		assert.equal(freeze.state, 'accepted');
		assert.equal(freeze.runtime.contractVersion, 1);
		assert.equal(freeze.runtime.contractDigest, RUNTIME_V1_CONTRACT_DIGEST);
		assert.deepEqual(freeze.externalCliBinding, {
			path: PUBLISHED_CLI_BINDING_RELATIVE_PATH,
			bytes: bindingBytes.byteLength,
			sha256: sha256(bindingBytes),
			bindingAggregateSha256: binding.bindingAggregateSha256,
		});
		assert.deepEqual(freeze.cli, {
			packageName: binding.package.name,
			packageVersion: binding.package.version,
			tarballSha256: binding.tarball.sha256,
		});
		assert.deepEqual(freeze.pluginArtifact, pluginArtifact);
		assert.deepEqual(freeze.audit, {
			validation: {
				command: 'npm run release:audit-policy',
				status: 'passed',
				result: {
					status: 'accepted-clean',
					productionVulnerabilities: 0,
					developmentVulnerabilities: 0,
					directRoot: 'eslint-plugin-obsidianmd',
				},
			},
		});
		assert.deepEqual(freeze.liveAcceptance, {
			evidence: {
				path: LIVE_ACCEPTANCE_RELATIVE_PATH,
				bytes: evidenceBytes.byteLength,
				sha256: sha256(evidenceBytes),
				sourceEvidenceSha256: evidence.sourceEvidenceSha256,
			},
			publishedFamilies: PUBLISHED_FAMILIES,
		});
		assert.equal(evidence.package, `${binding.package.name}@${binding.package.version}`);
		assert.equal(evidence.tarballSha256, binding.tarball.sha256);
		assert.equal(evidence.runtimeContractDigest, binding.runtime.contractDigest);
		assert.deepEqual(evidence.toolchain, {
			nodeVersion: CANONICAL_NODE_VERSION,
			npmVersion: CANONICAL_NPM_VERSION,
		});
		assert.deepEqual(evidence.pluginArtifact, pluginArtifact);
		assert.deepEqual(evidence.publishedFamilies, PUBLISHED_FAMILIES);
		assert.deepEqual(evidence.familyResults, FAMILY_RESULTS);
		assert.equal(freeze.maintainerAcceptance.status, 'accepted');
		validateMaintainerIdentity(freeze.maintainerAcceptance.acceptedBy);
		assert.match(
			freeze.maintainerAcceptance.acceptedAt,
			/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u,
		);
		assert.equal(
			new Date(freeze.maintainerAcceptance.acceptedAt).toISOString(),
			freeze.maintainerAcceptance.acceptedAt,
		);
		assert.equal(externalFreezeAggregate(freeze), freeze.inputsAggregateSha256);
		return freeze;
	} catch (error) {
		throw staleFreezeError(error);
	}
}

export async function checkAcceptedReleaseFreeze(options = {}) {
	const pluginRoot = options.pluginRoot ?? defaultPluginRoot;
	const freezePath = options.freezePath
		?? path.join(pluginRoot, EXTERNAL_FREEZE_RELATIVE_PATH);
	const freezeSchemaPath = options.freezeSchemaPath
		?? path.join(pluginRoot, EXTERNAL_FREEZE_SCHEMA_RELATIVE_PATH);
	const evidencePath = options.evidencePath
		?? path.join(pluginRoot, LIVE_ACCEPTANCE_RELATIVE_PATH);
	const bindingPath = options.bindingPath
		?? path.join(pluginRoot, PUBLISHED_CLI_BINDING_RELATIVE_PATH);
	const bindingSchemaPath = options.bindingSchemaPath
		?? path.join(pluginRoot, PUBLISHED_CLI_BINDING_SCHEMA_RELATIVE_PATH);

	try {
		const [freezeBytes, freezeSchemaBytes, evidenceBytes, bindingBytes, bindingSchemaBytes, loadedBinding, pluginArtifact] = await Promise.all([
			readRegularFileNoFollow(freezePath, pluginRoot),
			readRegularFileNoFollow(freezeSchemaPath, pluginRoot),
			readRegularFileNoFollow(evidencePath, pluginRoot),
			readRegularFileNoFollow(bindingPath, pluginRoot),
			readRegularFileNoFollow(bindingSchemaPath, pluginRoot),
			loadPublishedCliBinding({ bindingPath, schemaPath: bindingSchemaPath }),
			readPluginArtifactIdentity(pluginRoot),
		]);
		assert.deepEqual(loadedBinding.bindingBytes, bindingBytes);
		assert.deepEqual(loadedBinding.schemaBytes, bindingSchemaBytes);
		const freeze = JSON.parse(freezeBytes.toString('utf8'));
		const schema = JSON.parse(freezeSchemaBytes.toString('utf8'));
		const evidence = JSON.parse(evidenceBytes.toString('utf8'));
		validateExternalFreezeDocuments(freeze, evidence, schema);
		return assertAcceptedReleaseFreeze(freeze, {
			binding: loadedBinding.binding,
			bindingBytes: loadedBinding.bindingBytes,
			evidence,
			evidenceBytes,
			pluginArtifact,
		});
	} catch (error) {
		if (error?.message === PUBLIC_V1_FREEZE_STALE) throw error;
		throw staleFreezeError(error);
	}
}

function staleFreezeError(cause) {
	return new Error(PUBLIC_V1_FREEZE_STALE, { cause });
}

if (path.resolve(process.argv[1] ?? '') === scriptPath) {
	await checkAcceptedReleaseFreeze();
	console.log('Operon accepted external Public V1 freeze verified.');
}
