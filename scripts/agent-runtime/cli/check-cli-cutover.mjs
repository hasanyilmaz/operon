import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

const scriptPath = fileURLToPath(import.meta.url);
const pluginRoot = path.resolve(path.dirname(scriptPath), '../../..');
const inventoryPath = path.join(pluginRoot, 'contracts', 'agent-runtime', 'cli-cutover-v1.json');
const schemaPath = path.join(pluginRoot, 'contracts', 'agent-runtime', 'cli-cutover-v1.schema.json');
const sourceRoot = ['packages', 'operon-cli'].join('/');
const sourceImportRoot = `${sourceRoot}/src`;
const inventoryRelativePath = 'contracts/agent-runtime/cli-cutover-v1.json';
const inventorySchemaRelativePath = 'contracts/agent-runtime/cli-cutover-v1.schema.json';

export async function checkCliCutover(options = {}) {
	const root = options.pluginRoot ?? pluginRoot;
	const target = options.inventoryPath ?? inventoryPath;
	const schemaTarget = options.schemaPath ?? schemaPath;
	const [inventoryBytes, schemaBytes] = await Promise.all([readFile(target), readFile(schemaTarget)]);
	const inventory = JSON.parse(inventoryBytes.toString('utf8'));
	const schema = JSON.parse(schemaBytes.toString('utf8'));
	const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
	const validate = ajv.compile(schema);
	if (!validate(inventory)) {
		throw new Error(`OPERON_CLI_CUTOVER_SCHEMA_INVALID:${JSON.stringify(validate.errors)}`);
	}
	assert.equal(inventoryAggregate(inventory), inventory.inventoryAggregateSha256, 'OPERON_CLI_CUTOVER_AGGREGATE_INVALID');
	assert.equal(inventory.entries.length, inventory.referenceCount, 'OPERON_CLI_CUTOVER_REFERENCE_COUNT_INVALID');
	assert.equal(inventory.directSourceImports.length, inventory.directSourceImportCount, 'OPERON_CLI_CUTOVER_SOURCE_IMPORT_COUNT_INVALID');
	assertUniqueSortedEntries(inventory.entries, 'OPERON_CLI_CUTOVER_REFERENCE_INVENTORY_INVALID');
	assertUniqueSortedStrings(inventory.directSourceImports, 'OPERON_CLI_CUTOVER_SOURCE_INVENTORY_INVALID');
	const entriesByPath = new Map(inventory.entries.map(entry => [entry.path, entry]));
	for (const sourceImport of inventory.directSourceImports) {
		assert.ok(entriesByPath.has(sourceImport), `OPERON_CLI_CUTOVER_SOURCE_DISPOSITION_MISSING:${sourceImport}`);
	}
	const replacements = inventory.entries.filter(entry => entry.disposition === 'standalone-equivalent');
	assert.equal(
		new Set(replacements.map(entry => entry.replacementPath)).size,
		replacements.length,
		'OPERON_CLI_CUTOVER_STANDALONE_REPLACEMENT_DUPLICATE',
	);
	const counts = Object.fromEntries(Object.keys(inventory.dispositions).map(disposition => [
		disposition,
		inventory.entries.filter(entry => entry.disposition === disposition).length,
	]));
	assert.deepEqual(counts, inventory.counts, 'OPERON_CLI_CUTOVER_DISPOSITION_COUNTS_INVALID');

	const trackedFiles = listRepositoryFiles(root);
	const inventoryFiles = new Set([inventoryRelativePath, inventorySchemaRelativePath]);
	const references = await findReferences(root, trackedFiles, sourceRoot, inventoryFiles);
	assert.deepEqual(references, inventory.entries.map(entry => entry.path), 'OPERON_CLI_CUTOVER_UNCLASSIFIED_REFERENCE');
	const sourceImports = await findReferences(root, trackedFiles, sourceImportRoot, inventoryFiles);
	assert.deepEqual(sourceImports, inventory.directSourceImports, 'OPERON_CLI_CUTOVER_UNCLASSIFIED_SOURCE_IMPORT');

	const externalFiles = trackedFiles.filter(file => (
		file.startsWith('scripts/agent-runtime/cli/published-cli-v1')
		|| file.startsWith('scripts/agent-runtime/cli/check-published-cli-')
	));
	for (const file of externalFiles) {
		const content = await readFile(path.join(root, file), 'utf8');
		assert.ok(!content.includes(sourceImportRoot), `OPERON_CLI_CUTOVER_EXTERNAL_SOURCE_IMPORT:${file}`);
		assert.ok(!content.includes('.local/bin/operon'), `OPERON_CLI_CUTOVER_USER_INSTALL_FALLBACK:${file}`);
		assert.ok(!content.includes('@latest'), `OPERON_CLI_CUTOVER_LATEST_REFERENCE:${file}`);
		assert.ok(!content.includes('OPERON_CLI_EXECUTABLE'), `OPERON_CLI_CUTOVER_UNVERIFIED_EXECUTABLE:${file}`);
	}
	return Object.freeze({
		references: inventory.referenceCount,
		directSourceImports: inventory.directSourceImportCount,
		unmatched: 0,
	});
}

export function inventoryAggregate(inventory) {
	const { inventoryAggregateSha256: _aggregate, ...body } = inventory;
	return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

function listRepositoryFiles(root) {
	const result = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
		cwd: root,
		encoding: 'utf8',
	});
	if (result.error || result.status !== 0) {
		throw new Error(`OPERON_CLI_CUTOVER_GIT_INVENTORY_FAILED:${result.stderr ?? result.error?.message ?? ''}`);
	}
	return result.stdout.split('\0').filter(Boolean).sort();
}

async function findReferences(root, files, needle, excluded) {
	const output = [];
	for (const file of files) {
		if (excluded.has(file)) continue;
		let content;
		try {
			content = await readFile(path.join(root, file), 'utf8');
		} catch (error) {
			if (error?.code === 'EISDIR') continue;
			throw error;
		}
		if (content.includes(needle)) output.push(file);
	}
	return output.sort();
}

function assertUniqueSortedEntries(entries, code) {
	const paths = entries.map(entry => entry.path);
	assert.equal(new Set(paths).size, paths.length, code);
	assert.deepEqual(paths, [...paths].sort(), code);
}

function assertUniqueSortedStrings(values, code) {
	assert.equal(new Set(values).size, values.length, code);
	assert.deepEqual(values, [...values].sort(), code);
}

if (path.resolve(process.argv[1] ?? '') === scriptPath) {
	const result = await checkCliCutover();
	process.stdout.write(`${JSON.stringify({ status: 'ok', ...result })}\n`);
}
