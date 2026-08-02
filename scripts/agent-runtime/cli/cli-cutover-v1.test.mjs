import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
	checkCliCutover,
	containsCliRootReference,
	containsCliSourceReference,
	inventoryAggregate,
} from './check-cli-cutover.mjs';

test('every duplicate CLI reference has a Stage 8 disposition', async () => {
	const result = await checkCliCutover();
	assert.equal(result.unmatched, 0);
	assert.equal(result.completionTarget, 'cutover-complete');
	assert.equal(result.baselineReferences, 86);
	assert.equal(result.baselineDirectSourceImports, 20);
});

test('cutover inventory self aggregate changes with its contents', async () => {
	const inventory = JSON.parse(await readFile(
		new URL('../../../contracts/agent-runtime/cli-cutover-v1.json', import.meta.url),
		'utf8',
	));
	const original = inventoryAggregate(inventory);
	inventory.entries[0].stage8Action = 'unreviewed mutation';
	assert.notEqual(inventoryAggregate(inventory), original);
});

test('standalone removals have exact replacements and direct imports use one master disposition', async () => {
	const inventory = JSON.parse(await readFile(
		new URL('../../../contracts/agent-runtime/cli-cutover-v1.json', import.meta.url),
		'utf8',
	));
	const entries = new Map(inventory.entries.map(entry => [entry.path, entry]));
	for (const path of inventory.directSourceImports) {
		assert.equal(typeof path, 'string');
		assert.ok(entries.has(path), path);
	}
	for (const entry of inventory.entries.filter(candidate => candidate.disposition === 'standalone-equivalent')) {
		assert.match(entry.replacementPath, /^(?:src|test|scripts|docs)\//u);
	}
	assert.equal(entries.get('scripts/agent-runtime/cli/cli.test.ts').disposition, 'convert-to-external-artifact');
	assert.equal(entries.get('scripts/agent-runtime/cli/phase9-client.test.ts').disposition, 'convert-to-external-artifact');
	assert.equal(entries.get('scripts/analyze-production-bundle.test.mjs').disposition, 'retain-plugin-runtime-contract');
});

test('semantic reference matching covers static and constructed package paths', () => {
	assert.equal(containsCliRootReference("const root = 'packages/operon-cli';"), true);
	assert.equal(containsCliRootReference("path.join('packages', 'operon-cli', 'dist')"), true);
	assert.equal(containsCliRootReference("path.join('packages', packageName)"), false);
	assert.equal(containsCliSourceReference("import x from 'packages/operon-cli/src/client';"), true);
	assert.equal(containsCliSourceReference("path.join('packages', 'operon-cli', 'src', 'client.ts')"), true);
	assert.equal(containsCliSourceReference("path.join('packages', 'operon-cli', 'test')"), false);
});

test('cutover target closes package scripts, workflow runners, and orphan runners', async () => {
	const inventory = JSON.parse(await readFile(
		new URL('../../../contracts/agent-runtime/cli-cutover-v1.json', import.meta.url),
		'utf8',
	));
	assert.equal(inventory.standaloneEvidence.coverageCommit, '851e8cc163d89caa6f833a8280311db28e888061');
	assert.equal(inventory.semanticClosure.targetState, 'cutover-complete');
	assert.deepEqual(inventory.semanticClosure.targetCounts, {
		activeReferences: 0,
		directSourceImports: 0,
		orphanRunners: 0,
	});
	assert.ok(inventory.semanticClosure.packageScriptTargetsBeforeCutover.includes('packages/operon-cli/build.mjs'));
	assert.ok(inventory.semanticClosure.packageScriptTargetsBeforeCutover.includes('scripts/agent-runtime/cli/run-phase9-client-tests.mjs'));
	assert.ok(inventory.semanticClosure.workflowRunnerTargetsBeforeCutover.some(target => (
		target.workflow === '.github/workflows/cli-ci.yml'
		&& target.path === 'scripts/agent-runtime/cli/run-phase9-client-tests.mjs'
	)));
	assert.ok(inventory.semanticClosure.retiredRunners.some(runner => (
		runner.path === 'scripts/agent-runtime/cli/run-guided-source-transition-pty-tests.mjs'
		&& runner.replacementPath === 'scripts/run-process-tests.mjs'
	)));
	assert.deepEqual(inventory.semanticClosure.historicalReferencePaths, [
		'contracts/agent-runtime/public-v1-freeze.json',
	]);
	assert.deepEqual(inventory.semanticClosure.policyReferencePaths, [
		'scripts/agent-runtime/contracts/run-contract-tests.mjs',
		'scripts/analyze-production-bundle.test.mjs',
		'scripts/release-guard.mjs',
	]);
});

test('cutover-complete state accepts only historical references and fails closed on an orphan runner', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'operon-cli-cutover-complete-'));
	const inventory = JSON.parse(await readFile(
		new URL('../../../contracts/agent-runtime/cli-cutover-v1.json', import.meta.url),
		'utf8',
	));
	const schema = await readFile(
		new URL('../../../contracts/agent-runtime/cli-cutover-v1.schema.json', import.meta.url),
		'utf8',
	);
	inventory.state = 'cutover-complete';
	inventory.inventoryAggregateSha256 = inventoryAggregate(inventory);
	const files = new Map([
		['.github/workflows/cli-external-compatibility.yml', 'name: external compatibility\n'],
		['contracts/agent-runtime/cli-cutover-v1.json', `${JSON.stringify(inventory, null, 2)}\n`],
		['contracts/agent-runtime/cli-cutover-v1.schema.json', schema],
		['contracts/agent-runtime/public-v1-freeze.json', '{"historicalRoot":"packages/operon-cli"}\n'],
		['contracts/agent-runtime/published-cli-v1.json', '{}\n'],
		['contracts/agent-runtime/published-cli-v1.schema.json', '{}\n'],
		['package.json', '{"scripts":{}}\n'],
		['scripts/agent-runtime/cli/check-published-cli-binding.mjs', 'export {};\n'],
		['scripts/agent-runtime/cli/run-meeting-agent-acceptance.mjs', 'export {};\n'],
		['scripts/agent-runtime/contracts/run-contract-tests.mjs', 'export const forbidden = "packages/operon-cli";\n'],
		['scripts/analyze-production-bundle.test.mjs', 'export const fixture = "packages/operon-cli/src";\n'],
		['scripts/release/run-published-cli-live-acceptance.mjs', 'export {};\n'],
		['scripts/release/run-published-cli-stage7-performance.mjs', 'export {};\n'],
	]);
	for (const [relativePath, content] of files) {
		const target = path.join(root, relativePath);
		await mkdir(path.dirname(target), { recursive: true });
		await writeFile(target, content);
	}
	const gitInit = spawnSync('git', ['init', '--quiet'], { cwd: root, encoding: 'utf8' });
	assert.equal(gitInit.status, 0, gitInit.stderr);
	const result = await checkCliCutover({
		pluginRoot: root,
		inventoryPath: path.join(root, 'contracts/agent-runtime/cli-cutover-v1.json'),
		schemaPath: path.join(root, 'contracts/agent-runtime/cli-cutover-v1.schema.json'),
	});
	assert.equal(result.activeReferences, 0);
	assert.equal(result.directSourceImports, 0);

	const externalConsumer = path.join(root, 'scripts/release/run-published-cli-live-acceptance.mjs');
	const externalConsumerSource = await readFile(externalConsumer, 'utf8');
	for (const [marker, code] of [
		['.local/bin/operon', 'OPERON_CLI_CUTOVER_USER_INSTALL_FALLBACK'],
		['@latest', 'OPERON_CLI_CUTOVER_LATEST_REFERENCE'],
		['OPERON_CLI_EXECUTABLE', 'OPERON_CLI_CUTOVER_UNVERIFIED_EXECUTABLE'],
	]) {
		await writeFile(externalConsumer, `${externalConsumerSource}\n// ${marker}\n`);
		await assert.rejects(
			checkCliCutover({
				pluginRoot: root,
				inventoryPath: path.join(root, 'contracts/agent-runtime/cli-cutover-v1.json'),
				schemaPath: path.join(root, 'contracts/agent-runtime/cli-cutover-v1.schema.json'),
			}),
			new RegExp(code, 'u'),
		);
	}
	await writeFile(externalConsumer, externalConsumerSource);

	const orphan = path.join(root, inventory.semanticClosure.retiredRunners[0].path);
	await mkdir(path.dirname(orphan), { recursive: true });
	await writeFile(orphan, 'export {};\n');
	await assert.rejects(
		checkCliCutover({
			pluginRoot: root,
			inventoryPath: path.join(root, 'contracts/agent-runtime/cli-cutover-v1.json'),
			schemaPath: path.join(root, 'contracts/agent-runtime/cli-cutover-v1.schema.json'),
		}),
		/OPERON_CLI_CUTOVER_ORPHAN_RUNNER_REMAINS/u,
	);
});
