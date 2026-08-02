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
const checkerRelativePath = 'scripts/agent-runtime/cli/check-cli-cutover.mjs';
const checkerTestRelativePath = 'scripts/agent-runtime/cli/cli-cutover-v1.test.mjs';
const fallbackPolicyFiles = new Set([
	checkerRelativePath,
	'scripts/release-guard.mjs',
]);
const constructedSourceRootPattern = /(['"`])packages\1\s*,\s*(['"`])operon-cli\2/u;
const constructedSourceImportPattern = /(['"`])packages\1\s*,\s*(['"`])operon-cli\2\s*,\s*(['"`])src\3/u;
const runnableTargetPattern = /(?:node|python3)\s+(?:--test\s+)?((?:scripts|packages)\/[A-Za-z0-9_./-]+\.(?:mjs|js|ts|py))/gu;

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
	assertUniqueSortedStrings(
		inventory.semanticClosure.packageScriptTargetsBeforeCutover,
		'OPERON_CLI_CUTOVER_PACKAGE_TARGET_INVENTORY_INVALID',
	);
	assertUniqueSortedWorkflowTargets(
		inventory.semanticClosure.workflowRunnerTargetsBeforeCutover,
		'OPERON_CLI_CUTOVER_WORKFLOW_TARGET_INVENTORY_INVALID',
	);
	assertUniqueSortedEntries(
		inventory.semanticClosure.retiredRunners,
		'OPERON_CLI_CUTOVER_RETIRED_RUNNER_INVENTORY_INVALID',
	);
	assertUniqueSortedStrings(
		inventory.semanticClosure.historicalReferencePaths,
		'OPERON_CLI_CUTOVER_HISTORICAL_REFERENCE_INVENTORY_INVALID',
	);
	assertUniqueSortedStrings(
		inventory.semanticClosure.policyReferencePaths,
		'OPERON_CLI_CUTOVER_POLICY_REFERENCE_INVENTORY_INVALID',
	);
	assertUniqueSortedStrings(
		inventory.semanticClosure.requiredAbsentPaths,
		'OPERON_CLI_CUTOVER_REQUIRED_ABSENT_INVENTORY_INVALID',
	);
	assertUniqueSortedStrings(
		inventory.semanticClosure.requiredRetainedPaths,
		'OPERON_CLI_CUTOVER_REQUIRED_RETAINED_INVENTORY_INVALID',
	);
	const entriesByPath = new Map(inventory.entries.map(entry => [entry.path, entry]));
	for (const sourceImport of inventory.directSourceImports) {
		assert.ok(entriesByPath.has(sourceImport), `OPERON_CLI_CUTOVER_SOURCE_DISPOSITION_MISSING:${sourceImport}`);
	}
	const counts = Object.fromEntries(Object.keys(inventory.dispositions).map(disposition => [
		disposition,
		inventory.entries.filter(entry => entry.disposition === disposition).length,
	]));
	assert.deepEqual(counts, inventory.counts, 'OPERON_CLI_CUTOVER_DISPOSITION_COUNTS_INVALID');

	const trackedFiles = listRepositoryFiles(root);
	const inventoryFiles = new Set([
		inventoryRelativePath,
		inventorySchemaRelativePath,
		checkerRelativePath,
		checkerTestRelativePath,
	]);
	const literalReferences = await findReferences(
		root,
		trackedFiles,
		content => content.includes(sourceRoot),
		inventoryFiles,
	);
	const references = await findReferences(root, trackedFiles, containsCliRootReference, inventoryFiles);
	const sourceImports = await findReferences(root, trackedFiles, containsCliSourceReference, inventoryFiles);
	const packageScriptTargets = await collectPackageScriptTargets(root);
	const workflowRunnerTargets = await collectWorkflowRunnerTargets(root, trackedFiles);
	const historical = new Set(inventory.semanticClosure.historicalReferencePaths);
	const policy = new Set(inventory.semanticClosure.policyReferencePaths);
	const activeReferences = references.filter(reference => !historical.has(reference) && !policy.has(reference));
	const activeSourceImports = sourceImports.filter(reference => !historical.has(reference) && !policy.has(reference));

	if (inventory.state === 'stage-8-ready') {
		assert.equal(literalReferences.length, inventory.literalReferenceCount, 'OPERON_CLI_CUTOVER_LITERAL_REFERENCE_COUNT_INVALID');
		assert.deepEqual(references, inventory.entries.map(entry => entry.path), 'OPERON_CLI_CUTOVER_UNCLASSIFIED_REFERENCE');
		assert.deepEqual(sourceImports, inventory.directSourceImports, 'OPERON_CLI_CUTOVER_UNCLASSIFIED_SOURCE_IMPORT');
		assert.deepEqual(
			packageScriptTargets,
			inventory.semanticClosure.packageScriptTargetsBeforeCutover,
			'OPERON_CLI_CUTOVER_UNCLASSIFIED_PACKAGE_TARGET',
		);
		assert.deepEqual(
			workflowRunnerTargets,
			inventory.semanticClosure.workflowRunnerTargetsBeforeCutover,
			'OPERON_CLI_CUTOVER_UNCLASSIFIED_WORKFLOW_TARGET',
		);
		for (const runner of inventory.semanticClosure.retiredRunners) {
			assert.ok(trackedFiles.includes(runner.path), `OPERON_CLI_CUTOVER_RETIRED_RUNNER_MISSING:${runner.path}`);
		}
	} else {
		assert.equal(inventory.state, inventory.semanticClosure.targetState, 'OPERON_CLI_CUTOVER_STATE_INVALID');
		assert.equal(activeReferences.length, inventory.semanticClosure.targetCounts.activeReferences, 'OPERON_CLI_CUTOVER_ACTIVE_REFERENCE_REMAINS');
		assert.equal(activeSourceImports.length, inventory.semanticClosure.targetCounts.directSourceImports, 'OPERON_CLI_CUTOVER_SOURCE_IMPORT_REMAINS');
		const orphanRunners = inventory.semanticClosure.retiredRunners.filter(runner => trackedFiles.includes(runner.path));
		assert.equal(orphanRunners.length, inventory.semanticClosure.targetCounts.orphanRunners, 'OPERON_CLI_CUTOVER_ORPHAN_RUNNER_REMAINS');
		const forbiddenTargets = new Set([
			...inventory.semanticClosure.retiredRunners.map(runner => runner.path),
			...inventory.entries
				.filter(entry => entry.disposition === 'remove-stage8-workflow-release')
				.map(entry => entry.path),
		]);
		for (const targetPath of packageScriptTargets) {
			assert.ok(!targetPath.startsWith(`${sourceRoot}/`), `OPERON_CLI_CUTOVER_PACKAGE_SOURCE_TARGET_REMAINS:${targetPath}`);
			assert.ok(!forbiddenTargets.has(targetPath), `OPERON_CLI_CUTOVER_PACKAGE_LEGACY_TARGET_REMAINS:${targetPath}`);
			assert.ok(repositoryPathPresent(trackedFiles, targetPath), `OPERON_CLI_CUTOVER_PACKAGE_TARGET_MISSING:${targetPath}`);
		}
		for (const target of workflowRunnerTargets) {
			assert.ok(!target.path.startsWith(`${sourceRoot}/`), `OPERON_CLI_CUTOVER_WORKFLOW_SOURCE_TARGET_REMAINS:${target.workflow}:${target.path}`);
			assert.ok(!forbiddenTargets.has(target.path), `OPERON_CLI_CUTOVER_WORKFLOW_LEGACY_TARGET_REMAINS:${target.workflow}:${target.path}`);
			assert.ok(repositoryPathPresent(trackedFiles, target.path), `OPERON_CLI_CUTOVER_WORKFLOW_TARGET_MISSING:${target.workflow}:${target.path}`);
		}
		for (const requiredAbsentPath of inventory.semanticClosure.requiredAbsentPaths) {
			assert.ok(!repositoryPathPresent(trackedFiles, requiredAbsentPath), `OPERON_CLI_CUTOVER_REQUIRED_PATH_REMAINS:${requiredAbsentPath}`);
		}
		for (const requiredRetainedPath of inventory.semanticClosure.requiredRetainedPaths) {
			assert.ok(repositoryPathPresent(trackedFiles, requiredRetainedPath), `OPERON_CLI_CUTOVER_REQUIRED_PATH_MISSING:${requiredRetainedPath}`);
		}
	}

	const externalFiles = trackedFiles.filter(file => (
		!fallbackPolicyFiles.has(file)
		&& !file.includes('.test.')
		&& (
			file === 'package.json'
			|| file.startsWith('scripts/')
			|| file.startsWith('.github/workflows/')
		)
		&& /(?:\.m?[jt]s|\.py|\.ya?ml|package\.json)$/u.test(file)
	));
	for (const file of externalFiles) {
		const content = await readFile(path.join(root, file), 'utf8');
		assert.ok(!containsCliSourceReference(content), `OPERON_CLI_CUTOVER_EXTERNAL_SOURCE_IMPORT:${file}`);
		assert.ok(!content.includes('.local/bin/operon'), `OPERON_CLI_CUTOVER_USER_INSTALL_FALLBACK:${file}`);
		assert.ok(!content.includes('@latest'), `OPERON_CLI_CUTOVER_LATEST_REFERENCE:${file}`);
		assert.ok(!content.includes('OPERON_CLI_EXECUTABLE'), `OPERON_CLI_CUTOVER_UNVERIFIED_EXECUTABLE:${file}`);
	}
	return Object.freeze({
		references: references.length,
		activeReferences: activeReferences.length,
		literalReferences: literalReferences.length,
		directSourceImports: activeSourceImports.length,
		baselineReferences: inventory.referenceCount,
		baselineDirectSourceImports: inventory.directSourceImportCount,
		packageScriptTargets: packageScriptTargets.length,
		workflowRunnerTargets: workflowRunnerTargets.length,
		completionTarget: inventory.semanticClosure.targetState,
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

export function containsCliRootReference(content) {
	return content.includes(sourceRoot) || constructedSourceRootPattern.test(content);
}

export function containsCliSourceReference(content) {
	return content.includes(sourceImportRoot) || constructedSourceImportPattern.test(content);
}

export async function collectPackageScriptTargets(root) {
	const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
	const targets = new Set();
	for (const command of Object.values(packageJson.scripts ?? {})) {
		for (const match of command.matchAll(runnableTargetPattern)) {
			const target = match[1];
			if (target.startsWith(`${sourceRoot}/`) || target.startsWith('scripts/agent-runtime/cli/')) {
				targets.add(target);
			}
		}
	}
	return [...targets].sort();
}

export async function collectWorkflowRunnerTargets(root, files) {
	const targets = new Map();
	for (const workflow of files.filter(file => /^\.github\/workflows\/cli-.*\.ya?ml$/u.test(file))) {
		const content = await readFile(path.join(root, workflow), 'utf8');
		for (const match of content.matchAll(runnableTargetPattern)) {
			const entry = { workflow, path: match[1] };
			targets.set(`${workflow}\0${entry.path}`, entry);
		}
	}
	return [...targets.values()].sort(compareWorkflowTargets);
}

async function findReferences(root, files, predicate, excluded) {
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
		if (predicate(content)) output.push(file);
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

function assertUniqueSortedWorkflowTargets(values, code) {
	const keys = values.map(value => `${value.workflow}\0${value.path}`);
	assert.equal(new Set(keys).size, keys.length, code);
	assert.deepEqual(values, [...values].sort(compareWorkflowTargets), code);
}

function compareWorkflowTargets(left, right) {
	return left.workflow.localeCompare(right.workflow) || left.path.localeCompare(right.path);
}

function repositoryPathPresent(files, target) {
	return files.includes(target) || files.some(file => file.startsWith(`${target}/`));
}

if (path.resolve(process.argv[1] ?? '') === scriptPath) {
	const result = await checkCliCutover();
	process.stdout.write(`${JSON.stringify({ status: 'ok', ...result })}\n`);
}
