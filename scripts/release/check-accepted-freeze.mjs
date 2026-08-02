#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const defaultPluginRoot = path.resolve(path.dirname(scriptPath), '../..');

export const EXTERNAL_FREEZE_RELATIVE_PATH =
	'contracts/agent-runtime/public-v1-external-freeze.json';
export const PUBLISHED_CLI_BINDING_RELATIVE_PATH =
	'contracts/agent-runtime/published-cli-v1.json';
export const PUBLIC_V1_FREEZE_STALE = 'OPERON_PUBLIC_V1_FREEZE_STALE';
export const RUNTIME_V1_CONTRACT_DIGEST =
	'407f3a222f8c59a9622038e99e9345d0d34882fd358149b38bce5354ae0ca92b';

export function externalFreezeAggregate(freeze) {
	const { inputsAggregateSha256: _aggregate, ...body } = freeze;
	return sha256(Buffer.from(canonicalJson(body), 'utf8'));
}

export function assertAcceptedReleaseFreeze(freeze, options = {}) {
	try {
		assert.equal(freeze?.freezeVersion, 1);
		assert.equal(freeze?.kind, 'operon-public-v1-external-freeze');
		assert.equal(freeze?.state, 'accepted');
		assert.equal(freeze?.runtime?.contractDigest, RUNTIME_V1_CONTRACT_DIGEST);
		assert.equal(
			freeze?.externalCliBinding?.path,
			PUBLISHED_CLI_BINDING_RELATIVE_PATH,
		);
		assert.match(freeze?.externalCliBinding?.sha256 ?? '', /^[a-f0-9]{64}$/u);
		if (options.bindingSha256) {
			assert.equal(freeze.externalCliBinding.sha256, options.bindingSha256);
		}
		assert.equal(freeze?.audit?.validation?.status, 'passed');
		assert.equal(freeze?.audit?.validation?.result?.status, 'accepted-clean');
		assert.equal(freeze?.maintainerAcceptance?.status, 'accepted');
		assert.match(freeze?.maintainerAcceptance?.acceptedBy ?? '', /\S/u);
		assert.match(
			freeze?.maintainerAcceptance?.acceptedAt ?? '',
			/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u,
		);
		assert.equal(
			externalFreezeAggregate(freeze),
			freeze?.inputsAggregateSha256,
		);
		return freeze;
	} catch (error) {
		throw staleFreezeError(error);
	}
}

export async function checkAcceptedReleaseFreeze(options = {}) {
	const pluginRoot = options.pluginRoot ?? defaultPluginRoot;
	const freezePath = options.freezePath
		?? path.join(pluginRoot, EXTERNAL_FREEZE_RELATIVE_PATH);
	const bindingPath = options.bindingPath
		?? path.join(pluginRoot, PUBLISHED_CLI_BINDING_RELATIVE_PATH);

	try {
		const [freezeStats, bindingStats] = await Promise.all([
			lstat(freezePath),
			lstat(bindingPath),
		]);
		assert.ok(freezeStats.isFile() && !freezeStats.isSymbolicLink());
		assert.ok(bindingStats.isFile() && !bindingStats.isSymbolicLink());
		const [freezeBytes, bindingBytes] = await Promise.all([
			readFile(freezePath),
			readFile(bindingPath),
		]);
		const freeze = JSON.parse(freezeBytes.toString('utf8'));
		return assertAcceptedReleaseFreeze(freeze, {
			bindingSha256: sha256(bindingBytes),
		});
	} catch (error) {
		if (error?.message === PUBLIC_V1_FREEZE_STALE) throw error;
		throw staleFreezeError(error);
	}
}

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value) {
	if (value === null || typeof value === 'boolean' || typeof value === 'number') {
		return JSON.stringify(value);
	}
	if (typeof value === 'string') return JSON.stringify(value.normalize('NFC'));
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	return `{${Object.keys(value).sort().map(key => (
		`${JSON.stringify(key.normalize('NFC'))}:${canonicalJson(value[key])}`
	)).join(',')}}`;
}

function staleFreezeError(cause) {
	return new Error(PUBLIC_V1_FREEZE_STALE, { cause });
}

if (path.resolve(process.argv[1] ?? '') === scriptPath) {
	await checkAcceptedReleaseFreeze();
	console.log('Operon accepted external Public V1 freeze verified.');
}
