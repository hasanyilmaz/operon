import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCliManifestBaseV1 } from './manifest-data';

function packageRootV1(): string {
	const override = process.env.OPERON_CLI_PACKAGE_ROOT;
	if (override) return resolve(override);
	return dirname(dirname(fileURLToPath(import.meta.url)));
}

export function readCliManifestV1(): Record<string, unknown> {
	const value = readJsonAsset(join(packageRootV1(), 'cli-manifest-v1.json'));
	assertCliManifestV1(value);
	return value;
}

export function listCliSchemasV1(): string[] {
	const manifest = readCliManifestV1();
	return (manifest.schemas as Array<{ file: string }>)
		.map(item => item.file)
		.sort();
}

export function listCliSchemaEntrypointsV1(): Array<{ schemaId: string; ref: string }> {
	const manifest = readCliManifestV1();
	if (!isPlainRecord(manifest) || !Array.isArray(manifest.schemaEntrypoints)) return [];
	return manifest.schemaEntrypoints
		.filter(isPlainRecord)
		.filter(entry => typeof entry.schemaId === 'string' && typeof entry.ref === 'string')
		.map(entry => ({ schemaId: String(entry.schemaId), ref: String(entry.ref) }))
		.sort((left, right) => left.schemaId.localeCompare(right.schemaId));
}

export function readCliSchemaV1(schemaId: string): unknown {
	if (!/^[A-Za-z0-9._-]+$/u.test(schemaId)) throw new Error('INVALID_SCHEMA_ID');
	const fileName = schemaId.endsWith('.json') ? schemaId : `${schemaId}.json`;
	const manifest = readCliManifestV1();
	if ((manifest.schemas as Array<{ file: string }>).some(item => item.file === fileName)) {
		return readVerifiedSchemaV1(fileName, manifest);
	}
	const entrypoint = listCliSchemaEntrypointsV1().find(entry => entry.schemaId === schemaId);
	if (!entrypoint) throw new Error('SCHEMA_NOT_FOUND');
	const rawEntrypoint = (manifest.schemaEntrypoints as Array<{
		schemaId: string;
		ref: string;
		file: string;
	}>).find(item => item.schemaId === schemaId);
	if (!rawEntrypoint || !listCliSchemasV1().includes(rawEntrypoint.file)) {
		throw new Error('PACKAGE_ASSET_INVALID');
	}
	return {
		schemaId: entrypoint.schemaId,
		ref: entrypoint.ref,
		document: readVerifiedSchemaV1(rawEntrypoint.file, manifest),
	};
}

function readJsonAsset(path: string): unknown {
	const stat = lstatSync(path);
	if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('PACKAGE_ASSET_INVALID');
	return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function assertCliManifestV1(value: unknown): asserts value is Record<string, unknown> {
	if (!isPlainRecord(value) || !isPlainRecord(value.package) || typeof value.package.version !== 'string') {
		throw new Error('PACKAGE_MANIFEST_INVALID');
	}
	const expectedBase = createCliManifestBaseV1(value.package.version);
	const expectedKeys = new Set([
		...Object.keys(expectedBase),
		'schemas',
		'schemaEntrypoints',
		'contractDigest',
	]);
	if (
		Object.keys(value).some(key => !expectedKeys.has(key))
		|| [...expectedKeys].some(key => !(key in value))
	) throw new Error('PACKAGE_MANIFEST_INVALID');
	for (const [key, expected] of Object.entries(expectedBase)) {
		if (JSON.stringify(value[key]) !== JSON.stringify(expected)) {
			throw new Error('PACKAGE_MANIFEST_INVALID');
		}
	}
	if (
		!Array.isArray(value.schemas)
		|| !Array.isArray(value.schemaEntrypoints)
		|| typeof value.contractDigest !== 'string'
		|| !/^[a-f0-9]{64}$/u.test(value.contractDigest)
		|| !value.schemas.every(isSchemaFile)
		|| !value.schemaEntrypoints.every(isSchemaEntrypoint)
	) throw new Error('PACKAGE_MANIFEST_INVALID');
	const files = value.schemas.map(item => item.file);
	const schemaIds = value.schemaEntrypoints.map(item => item.schemaId);
	if (new Set(files).size !== files.length || new Set(schemaIds).size !== schemaIds.length) {
		throw new Error('PACKAGE_MANIFEST_INVALID');
	}
	const schemaByFile = new Map(value.schemas.map(item => [item.file, item.sha256]));
	for (const entrypoint of value.schemaEntrypoints) {
		if (
			!entrypoint.ref.includes(`:${entrypoint.file}#`)
			|| schemaByFile.get(entrypoint.file) !== entrypoint.sha256
		) throw new Error('PACKAGE_MANIFEST_INVALID');
	}
}

function readVerifiedSchemaV1(fileName: string, manifest: Record<string, unknown>): unknown {
	const schema = (manifest.schemas as Array<{ file: string; sha256: string }>)
		.find(item => item.file === fileName);
	if (!schema) throw new Error('SCHEMA_NOT_FOUND');
	const path = join(packageRootV1(), 'schemas', 'v1', fileName);
	const stat = lstatSync(path);
	if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('PACKAGE_ASSET_INVALID');
	const bytes = readFileSync(path);
	if (createHash('sha256').update(bytes).digest('hex') !== schema.sha256) {
		throw new Error('PACKAGE_ASSET_INVALID');
	}
	return JSON.parse(bytes.toString('utf8')) as unknown;
}

function isSchemaFile(value: unknown): value is { file: string; sha256: string } {
	return isPlainRecord(value)
		&& (
			Object.keys(value).length === 2
			|| (
				Object.keys(value).length === 3
				&& typeof value.id === 'string'
				&& value.id.startsWith('urn:operon:schema:')
			)
		)
		&& typeof value.file === 'string'
		&& /^[A-Za-z0-9._-]+\.json$/u.test(value.file)
		&& typeof value.sha256 === 'string'
		&& /^[a-f0-9]{64}$/u.test(value.sha256);
}

function isSchemaEntrypoint(value: unknown): value is {
	schemaId: string;
	ref: string;
	file: string;
	sha256: string;
	stability: 'stable';
} {
	return isPlainRecord(value)
		&& (
			Object.keys(value).length === 5
			|| (Object.keys(value).length === 6 && isPlainRecord(value.deprecation))
		)
		&& typeof value.schemaId === 'string'
		&& /^[a-z0-9.-]+$/u.test(value.schemaId)
		&& typeof value.ref === 'string'
		&& value.ref.length > 0
		&& typeof value.file === 'string'
		&& /^[A-Za-z0-9._-]+\.json$/u.test(value.file)
		&& typeof value.sha256 === 'string'
		&& /^[a-f0-9]{64}$/u.test(value.sha256)
		&& value.stability === 'stable';
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
	const prototype = Reflect.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}
