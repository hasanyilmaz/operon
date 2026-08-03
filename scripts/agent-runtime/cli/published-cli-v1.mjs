import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	access,
	chmod,
	lstat,
	mkdtemp,
	mkdir,
	readFile,
	readdir,
	rm,
	writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

const modulePath = fileURLToPath(import.meta.url);
export const pluginRoot = path.resolve(path.dirname(modulePath), '../../..');
export const bindingPath = path.join(
	pluginRoot,
	'contracts',
	'agent-runtime',
	'published-cli-v1.json',
);
export const bindingSchemaPath = path.join(
	pluginRoot,
	'contracts',
	'agent-runtime',
	'published-cli-v1.schema.json',
);

export function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

export function sha512(bytes) {
	return createHash('sha512').update(bytes).digest('base64');
}

export function bindingAggregate(binding) {
	const { bindingAggregateSha256: _aggregate, ...body } = binding;
	return sha256(Buffer.from(JSON.stringify(body), 'utf8'));
}

export async function loadPublishedCliBinding(options = {}) {
	const target = options.bindingPath ?? bindingPath;
	const schemaTarget = options.schemaPath ?? bindingSchemaPath;
	const [bindingBytes, schemaBytes] = await Promise.all([
		readFile(target),
		readFile(schemaTarget),
	]);
	const binding = JSON.parse(bindingBytes.toString('utf8'));
	const schema = JSON.parse(schemaBytes.toString('utf8'));
	const ajv = new Ajv2020({
		allErrors: true,
		strict: true,
		strictRequired: false,
		validateFormats: false,
	});
	const validate = ajv.compile(schema);
	if (!validate(binding)) {
		throw new Error(`OPERON_PUBLISHED_CLI_BINDING_SCHEMA_INVALID:${JSON.stringify(validate.errors)}`);
	}
	assertPublishedCliBinding(binding);
	return Object.freeze({ binding, bindingBytes, schemaBytes });
}

export function assertPublishedCliBinding(binding) {
	assert.equal(
		bindingAggregate(binding),
		binding.bindingAggregateSha256,
		'OPERON_PUBLISHED_CLI_BINDING_AGGREGATE_INVALID',
	);
	assert.equal(
		binding.tarball.integrity,
		`sha512-${binding.tarball.sha512}`,
		'OPERON_PUBLISHED_CLI_BINDING_INTEGRITY_INVALID',
	);
	assert.equal(
		binding.source.commit,
		binding.provenance.commit,
		'OPERON_PUBLISHED_CLI_BINDING_COMMIT_MISMATCH',
	);
	assert.equal(
		binding.artifact.inventory.length,
		binding.artifact.inventoryEntries,
		'OPERON_PUBLISHED_CLI_BINDING_INVENTORY_COUNT_INVALID',
	);
	assertUniquePaths(binding.artifact.inventory, 'artifact inventory');
	assertUniqueSortedPaths(binding.runtime.canonicalSchemas, 'canonical schema inventory');
	assertUniqueSortedPaths(binding.runtime.canonicalTypeSources, 'canonical type inventory');
	assertIdentityInInventory(binding.artifact.inventory, binding.artifact.executable);
	assertIdentityInInventory(binding.artifact.inventory, binding.artifact.cliManifest);
	assert.equal(
		artifactInventoryAggregate(binding.artifact.inventory, 'package/schemas/v1/'),
		binding.artifact.schemaAggregateSha256,
		'OPERON_PUBLISHED_CLI_SCHEMA_AGGREGATE_MISMATCH',
	);
	assert.equal(
		artifactInventoryAggregate(binding.artifact.inventory, 'package/types/'),
		binding.artifact.declarationAggregateSha256,
		'OPERON_PUBLISHED_CLI_DECLARATION_AGGREGATE_MISMATCH',
	);
	return binding;
}

export function artifactInventoryAggregate(inventory, prefix) {
	return sha256(Buffer.from(JSON.stringify(
		inventory.filter(item => item.path.startsWith(prefix)),
	), 'utf8'));
}

export async function verifyPublishedCliExecutablePath(executablePath, binding) {
	if (!path.isAbsolute(executablePath) || executablePath.includes('\0')) {
		throw new Error('OPERON_PUBLISHED_CLI_EXECUTABLE_PATH_INVALID');
	}
	const stats = await lstat(executablePath);
	if (!stats.isFile() || stats.isSymbolicLink()) {
		throw new Error('OPERON_PUBLISHED_CLI_EXECUTABLE_PATH_INVALID');
	}
	const bytes = await readFile(executablePath);
	assert.equal(bytes.length, binding.artifact.executable.bytes, 'OPERON_PUBLISHED_CLI_EXECUTABLE_BYTES_MISMATCH');
	assert.equal(sha256(bytes), binding.artifact.executable.sha256, 'OPERON_PUBLISHED_CLI_EXECUTABLE_SHA256_MISMATCH');
	if (process.platform !== 'win32') {
		assert.equal(stats.mode & 0o777, binding.artifact.executable.mode, 'OPERON_PUBLISHED_CLI_EXECUTABLE_MODE_MISMATCH');
	}
	return executablePath;
}

export async function verifyCanonicalPluginInputs(binding, options = {}) {
	const root = options.pluginRoot ?? pluginRoot;
	for (const identity of [
		...binding.runtime.canonicalSchemas,
		...binding.runtime.canonicalTypeSources,
	]) {
		const target = resolveRepositoryPath(root, identity.path);
		const stats = await lstat(target);
		assert.ok(stats.isFile() && !stats.isSymbolicLink(), `OPERON_PUBLISHED_CLI_CANONICAL_FILE_INVALID:${identity.path}`);
		const bytes = await readFile(target);
		assert.equal(bytes.length, identity.bytes, `OPERON_PUBLISHED_CLI_CANONICAL_SIZE_MISMATCH:${identity.path}`);
		assert.equal(sha256(bytes), identity.sha256, `OPERON_PUBLISHED_CLI_CANONICAL_HASH_MISMATCH:${identity.path}`);
		if (process.platform !== 'win32') {
			assert.equal(stats.mode & 0o777, identity.mode, `OPERON_PUBLISHED_CLI_CANONICAL_MODE_MISMATCH:${identity.path}`);
		}
	}
	return true;
}

export async function verifyTarballIdentity(tarballPath, binding) {
	if (!path.isAbsolute(tarballPath) || tarballPath.includes('\0')) {
		throw new Error('OPERON_PUBLISHED_CLI_TARBALL_PATH_INVALID');
	}
	const stats = await lstat(tarballPath);
	if (!stats.isFile() || stats.isSymbolicLink()) {
		throw new Error('OPERON_PUBLISHED_CLI_TARBALL_FILE_INVALID');
	}
	const bytes = await readFile(tarballPath);
	assert.equal(bytes.length, binding.tarball.bytes, 'OPERON_PUBLISHED_CLI_TARBALL_SIZE_MISMATCH');
	assert.equal(sha256(bytes), binding.tarball.sha256, 'OPERON_PUBLISHED_CLI_TARBALL_SHA256_MISMATCH');
	assert.equal(sha512(bytes), binding.tarball.sha512, 'OPERON_PUBLISHED_CLI_TARBALL_SHA512_MISMATCH');
	return bytes;
}

export async function installAndVerifyPublishedCli(tarballPath, binding, options = {}) {
	return withVerifiedPublishedCli(
		tarballPath,
		binding,
		async ({ npmVersion }) => Object.freeze({ npmVersion }),
		options,
	);
}

export async function withVerifiedPublishedCli(tarballPath, binding, callback, options = {}) {
	if (typeof callback !== 'function') {
		throw new TypeError('OPERON_PUBLISHED_CLI_CALLBACK_REQUIRED');
	}
	const verifiedTarballBytes = await verifyTarballIdentity(tarballPath, binding);
	const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'operon cli external ü-'));
	const prefix = path.join(temporaryRoot, 'global prefix ç');
	try {
		await mkdir(prefix, { recursive: true });
		const verifiedTarballPath = path.join(temporaryRoot, 'verified-operon-cli-1.0.8.tgz');
		await writeFile(verifiedTarballPath, verifiedTarballBytes, { mode: 0o600 });
		const npm = await resolveNpmInvocation(options.env ?? process.env);
		const childEnvironment = sanitizedChildEnvironment(options.env ?? process.env);
		childEnvironment.npm_config_cache = path.join(temporaryRoot, 'npm-cache');
		childEnvironment.NPM_CONFIG_USERCONFIG = path.join(temporaryRoot, 'empty.npmrc');
		await writeFile(childEnvironment.NPM_CONFIG_USERCONFIG, '', { mode: 0o600 });
		const result = spawnSync(
			process.execPath,
			[
				npm.path,
				'install',
				'--global',
				'--prefix',
				prefix,
				'--ignore-scripts',
				'--offline',
				'--package-lock=false',
				'--no-audit',
				'--no-fund',
				verifiedTarballPath,
			],
			{
				cwd: temporaryRoot,
				encoding: 'utf8',
				env: childEnvironment,
			},
		);
		assertSpawnSucceeded(result, 'OPERON_PUBLISHED_CLI_NPM_INSTALL_FAILED');
		const packageRoot = path.join(prefix, 'lib', 'node_modules', ...binding.package.name.split('/'));
		await verifyInstalledPackage(packageRoot, binding);
		await verifyRuntimeSchemaParity(packageRoot, binding, options.pluginRoot ?? pluginRoot);
		await verifyDeclarationParity(packageRoot, binding, options.pluginRoot ?? pluginRoot);
		await verifyBlackBoxSurface(packageRoot, binding, options.env ?? process.env);
		await verifyMockTransportSurface(
			packageRoot,
			binding,
			temporaryRoot,
			options.pluginRoot ?? pluginRoot,
			options.env ?? process.env,
		);
		const executable = path.join(packageRoot, 'dist', 'operon.mjs');
		const executableStats = await lstat(executable);
		assert.ok(
			executableStats.isFile() && !executableStats.isSymbolicLink(),
			'OPERON_PUBLISHED_CLI_EXECUTABLE_FILE_INVALID',
		);
		return await callback(Object.freeze({
			packageRoot,
			executable,
			prefix,
			npmVersion: npm.version,
		}));
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
}

export async function verifyDeveloperApiConsumerBuild(tarballPath, binding, options = {}) {
	await verifyTarballIdentity(tarballPath, binding);
	const root = options.pluginRoot ?? pluginRoot;
	const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'operon-developer-api-external-'));
	try {
		const outputRoot = path.join(temporaryRoot, 'plugin');
		const buildScript = path.join(
			root,
			'scripts',
			'agent-runtime',
			'developer-api',
			'native-acceptance-consumer',
			'build.mjs',
		);
		const result = spawnSync(process.execPath, [
			buildScript,
			'--tarball',
			tarballPath,
			'--outdir',
			outputRoot,
		], {
			cwd: root,
			encoding: 'utf8',
			env: sanitizedChildEnvironment(options.env ?? process.env),
		});
		assertSpawnSucceeded(result, 'OPERON_PUBLISHED_CLI_DEVELOPER_API_CONSUMER_BUILD_FAILED');
		const evidence = JSON.parse(await readFile(path.join(outputRoot, 'build-evidence.json'), 'utf8'));
		assert.equal(evidence.kind, 'operon-developer-api-native-consumer-build');
		assert.equal(evidence.package, `${binding.package.name}@${binding.package.version}`);
		assert.equal(evidence.tarballSha256, binding.tarball.sha256);
		assert.deepEqual(evidence.runtimeInputs, ['acceptance.ts', 'main.ts', 'runner-contract.ts']);
		assert.match(evidence.mainJsSha256, /^[a-f0-9]{64}$/u);
		assert.ok(Number.isSafeInteger(evidence.mainJsBytes) && evidence.mainJsBytes > 0);
		return Object.freeze(evidence);
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
}

export async function verifyPublishedCliLifecycle(candidatePath, legacyPath, binding, options = {}) {
	const candidateBytes = await verifyTarballIdentity(candidatePath, binding);
	if (!path.isAbsolute(legacyPath) || legacyPath.includes('\0')) {
		throw new Error('OPERON_PUBLISHED_CLI_LEGACY_PATH_INVALID');
	}
	const legacyStats = await lstat(legacyPath);
	if (!legacyStats.isFile() || legacyStats.isSymbolicLink()) {
		throw new Error('OPERON_PUBLISHED_CLI_LEGACY_FILE_INVALID');
	}
	const legacyBytes = await readFile(legacyPath);
	assert.equal(legacyBytes.length, 213485, 'OPERON_PUBLISHED_CLI_LEGACY_SIZE_MISMATCH');
	assert.equal(
		sha256(legacyBytes),
		'f03c360ec83663d730d76a5e53e27e4544c82f6c6f1ecfbbc0fba1538cd980a8',
		'OPERON_PUBLISHED_CLI_LEGACY_HASH_MISMATCH',
	);
	const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'operon cli lifecycle ü-'));
	const prefix = path.join(temporaryRoot, 'global prefix ç');
	const configRoot = path.join(temporaryRoot, 'config sentinel');
	const sentinel = path.join(temporaryRoot, 'unrelated-sentinel.txt');
	try {
		await Promise.all([
			mkdir(prefix, { recursive: true }),
			mkdir(configRoot, { recursive: true }),
		]);
		await Promise.all([
			writeFile(sentinel, 'preserve\n', 'utf8'),
			writeFile(path.join(configRoot, 'settings.json'), '{}\n', 'utf8'),
		]);
		const verifiedCandidatePath = path.join(temporaryRoot, 'verified-operon-cli-1.0.8.tgz');
		const verifiedLegacyPath = path.join(temporaryRoot, 'verified-operon-cli-1.0.7.tgz');
		await Promise.all([
			writeFile(verifiedCandidatePath, candidateBytes, { mode: 0o600 }),
			writeFile(verifiedLegacyPath, legacyBytes, { mode: 0o600 }),
		]);
		const npm = await resolveNpmInvocation(options.env ?? process.env);
		const childEnvironment = sanitizedChildEnvironment(options.env ?? process.env);
		childEnvironment.npm_config_cache = path.join(temporaryRoot, 'npm-cache');
		childEnvironment.NPM_CONFIG_USERCONFIG = path.join(temporaryRoot, 'empty.npmrc');
		childEnvironment.OPERON_CONFIG_HOME = configRoot;
		await writeFile(childEnvironment.NPM_CONFIG_USERCONFIG, '', { mode: 0o600 });
		for (const [artifact, version] of [
			[verifiedLegacyPath, '1.0.7'],
			[verifiedCandidatePath, binding.package.version],
			[verifiedLegacyPath, '1.0.7'],
			[verifiedCandidatePath, binding.package.version],
		]) {
			const install = spawnSync(process.execPath, [
				npm.path,
				'install',
				'--global',
				'--prefix',
				prefix,
				'--ignore-scripts',
				'--offline',
				'--package-lock=false',
				'--no-audit',
				'--no-fund',
				artifact,
			], { cwd: temporaryRoot, encoding: 'utf8', env: childEnvironment });
			assertSpawnSucceeded(install, 'OPERON_PUBLISHED_CLI_LIFECYCLE_INSTALL_FAILED');
			await assertInstalledVersion(prefix, version, childEnvironment);
		}
		const uninstall = spawnSync(process.execPath, [
			npm.path,
			'uninstall',
			'--global',
			'--prefix',
			prefix,
			binding.package.name,
		], { cwd: temporaryRoot, encoding: 'utf8', env: childEnvironment });
		assertSpawnSucceeded(uninstall, 'OPERON_PUBLISHED_CLI_LIFECYCLE_UNINSTALL_FAILED');
		await assert.rejects(
			access(path.join(prefix, 'lib', 'node_modules', '@stratejya', 'operon-cli')),
			/ENOENT/u,
		);
		await assert.rejects(access(path.join(prefix, 'bin', 'operon')), /ENOENT/u);
		assert.equal(await readFile(sentinel, 'utf8'), 'preserve\n');
		assert.equal(await readFile(path.join(configRoot, 'settings.json'), 'utf8'), '{}\n');
		return Object.freeze({ npmVersion: npm.version, transitions: 4, uninstalled: true });
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
}

export async function verifyInstalledPackage(packageRoot, binding) {
	const actual = await listFileInventory(packageRoot, 'package');
	const expected = [...binding.artifact.inventory].sort(compareInventoryPath);
	assert.deepEqual(actual, expected, 'OPERON_PUBLISHED_CLI_INSTALLED_INVENTORY_MISMATCH');
	const packageJson = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
	assert.equal(packageJson.name, binding.package.name, 'OPERON_PUBLISHED_CLI_PACKAGE_NAME_MISMATCH');
	assert.equal(packageJson.version, binding.package.version, 'OPERON_PUBLISHED_CLI_PACKAGE_VERSION_MISMATCH');
	assert.equal(Object.keys(packageJson.dependencies ?? {}).length, 0, 'OPERON_PUBLISHED_CLI_PRODUCTION_DEPENDENCIES_FORBIDDEN');
	assert.equal(Object.keys(packageJson.optionalDependencies ?? {}).length, 0, 'OPERON_PUBLISHED_CLI_OPTIONAL_DEPENDENCIES_FORBIDDEN');
	assert.equal(packageJson.engines?.node, '^22.0.0 || ^24.0.0 || ^26.0.0', 'OPERON_PUBLISHED_CLI_NODE_ENGINE_MISMATCH');
	assert.equal(
		packageJson.exports?.['./contracts/v1/developer-api']?.types,
		'./types/src/agent-runtime/public/v1/developer-api.d.ts',
		'OPERON_PUBLISHED_CLI_DEVELOPER_API_EXPORT_MISMATCH',
	);
	assert.equal(
		packageJson.exports?.['./contracts/v1/developer-api']?.default,
		null,
		'OPERON_PUBLISHED_CLI_DEVELOPER_API_RUNTIME_EXPORT_FORBIDDEN',
	);
	const readme = await readFile(path.join(packageRoot, 'README.md'), 'utf8');
	assert.match(readme, /npm install --global @stratejya\/operon-cli/u);
	assert.match(readme, /Node(?:\.js)? 22, 24, (?:and|or) 26/iu);
	assert.match(readme, /macOS/u);
	assert.match(readme, /Linux/u);
	assert.match(readme, /Windows 11/u);
	assert.match(readme, /WSL/u);
	assert.match(readme, /public beta/iu);
	assert.match(readme, /recoveryRef/u);
	assert.match(readme, /@stratejya\/operon-cli\/contracts\/v1\/developer-api/u);
	assert.doesNotMatch(readme, /^## \d+\.\d+/mu, 'OPERON_PUBLISHED_CLI_README_VERSION_HEADING_FORBIDDEN');
	return true;
}

export async function verifyRuntimeSchemaParity(packageRoot, binding, root = pluginRoot) {
	for (const identity of binding.runtime.canonicalSchemas) {
		const file = path.basename(identity.path);
		const actual = await readFile(path.join(packageRoot, 'schemas', 'v1', file));
		const expected = await readFile(resolveRepositoryPath(root, identity.path));
		assert.deepEqual(actual, expected, `OPERON_PUBLISHED_CLI_SCHEMA_PARITY_MISMATCH:${file}`);
	}
	return true;
}

export async function verifyDeclarationParity(packageRoot, binding, root = pluginRoot) {
	const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'operon-public-types-'));
	try {
		const generatedRoot = path.join(temporaryRoot, 'types');
		await generatePublicDeclarations(root, generatedRoot);
		const expectedInventory = binding.artifact.inventory
			.filter(item => item.path.startsWith('package/types/'))
			.map(item => ({ ...item, path: item.path.slice('package/types/'.length) }))
			.sort(compareInventoryPath);
		const generatedInventory = await listFileInventory(generatedRoot, '');
		assert.deepEqual(generatedInventory, expectedInventory, 'OPERON_PUBLISHED_CLI_DECLARATION_GENERATION_MISMATCH');
		for (const item of expectedInventory) {
			const actual = await readFile(path.join(packageRoot, 'types', item.path));
			const expected = await readFile(path.join(generatedRoot, item.path));
			assert.deepEqual(actual, expected, `OPERON_PUBLISHED_CLI_DECLARATION_PARITY_MISMATCH:${item.path}`);
		}
		return true;
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
}

export async function generatePublicDeclarations(root, outDir) {
	const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'operon-type-config-'));
	try {
		const configPath = path.join(temporaryRoot, 'tsconfig.json');
		const config = {
			compilerOptions: {
				target: 'ES2020',
				module: 'ESNext',
				moduleResolution: 'node',
				lib: ['ES2020', 'DOM'],
				types: [],
				declaration: true,
				declarationMap: false,
				emitDeclarationOnly: true,
				rootDir: root,
				outDir,
				noEmitOnError: true,
				noImplicitAny: true,
				strictNullChecks: true,
				skipLibCheck: false,
				forceConsistentCasingInFileNames: true,
				newLine: 'lf',
			},
			files: [
				path.join(root, 'src/agent-runtime/public/v1/index.ts'),
				path.join(root, 'src/agent-runtime/public/v1/developer-api.ts'),
				path.join(root, 'src/agent-runtime/public/v1/cli.ts'),
			],
		};
		await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
		const require = createRequire(import.meta.url);
		const tscPath = require.resolve('typescript/bin/tsc');
		const result = spawnSync(process.execPath, [tscPath, '--project', configPath], {
			cwd: root,
			encoding: 'utf8',
			env: sanitizedChildEnvironment(process.env),
		});
		assertSpawnSucceeded(result, 'OPERON_PUBLISHED_CLI_TYPE_BUILD_FAILED');
		await normalizeDeclarationImports(outDir);
		await writeFile(path.join(outDir, 'not-exported.d.ts'), 'export {};\n', { mode: 0o644 });
		return outDir;
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
}

export async function verifyBlackBoxSurface(packageRoot, binding, env = process.env) {
	const executable = path.join(packageRoot, 'dist', 'operon.mjs');
	const version = spawnSync(process.execPath, [executable, 'version'], {
		encoding: 'utf8',
		env: sanitizedChildEnvironment(env),
	});
	assertSpawnSucceeded(version, 'OPERON_PUBLISHED_CLI_VERSION_COMMAND_FAILED');
	assert.equal(
		version.stdout.trim(),
		`operon-cli ${binding.package.version}`,
		'OPERON_PUBLISHED_CLI_VERSION_OUTPUT_MISMATCH',
	);
	const help = spawnSync(process.execPath, [executable, '--help'], {
		encoding: 'utf8',
		env: sanitizedChildEnvironment(env),
	});
	assertSpawnSucceeded(help, 'OPERON_PUBLISHED_CLI_HELP_COMMAND_FAILED');
	assert.match(help.stdout, /Operon CLI/u, 'OPERON_PUBLISHED_CLI_HELP_OUTPUT_INVALID');
	const manifest = JSON.parse(await readFile(path.join(packageRoot, 'cli-manifest-v1.json'), 'utf8'));
	assert.equal(manifest.package?.version, binding.package.version, 'OPERON_PUBLISHED_CLI_MANIFEST_VERSION_MISMATCH');
	assert.equal(manifest.contractDigest, binding.runtime.contractDigest, 'OPERON_PUBLISHED_CLI_MANIFEST_RUNTIME_DIGEST_MISMATCH');
	assert.deepEqual(manifest.platforms, {
		darwin: 'supported',
		linux: 'acceptance-required',
		win32: 'acceptance-required',
		wsl: 'unsupported',
	}, 'OPERON_PUBLISHED_CLI_MANIFEST_PLATFORMS_MISMATCH');
	assert.deepEqual(
		manifest.protocols?.sessionJsonl?.readGroupCommands,
		['health', 'task.get', 'tasks.query', 'context.build'],
		'OPERON_PUBLISHED_CLI_SESSION_READ_COMMANDS_MISMATCH',
	);
	assert.equal(manifest.protocols?.sessionJsonl?.invocation, 'operon session --jsonl');
	assert.equal(manifest.protocols?.sessionJsonl?.readGroupMin, 2);
	assert.equal(manifest.protocols?.sessionJsonl?.readGroupMax, 8);
	assert.equal(manifest.protocols?.sessionJsonl?.abortExitCode, 130);
	assert.equal(
		normalizedCliManifestSha256(manifest),
		binding.artifact.normalizedCliManifestSha256,
		'OPERON_PUBLISHED_CLI_MANIFEST_SEMANTIC_MISMATCH',
	);
	return true;
}

export function normalizedCliManifestSha256(manifest) {
	const normalized = structuredClone(manifest);
	assert.equal(typeof normalized.package?.version, 'string', 'OPERON_PUBLISHED_CLI_MANIFEST_VERSION_MISSING');
	normalized.package.version = '<normalized-version>';
	return sha256(Buffer.from(canonicalJson(normalized), 'utf8'));
}

export async function verifyMockTransportSurface(
	packageRoot,
	binding,
	temporaryRoot,
	root = pluginRoot,
	env = process.env,
) {
	const executable = path.join(packageRoot, 'dist', 'operon.mjs');
	const vault = path.join(temporaryRoot, 'disposable mock vault');
	const configRoot = path.join(temporaryRoot, 'mock config');
	const mockExecutable = path.join(temporaryRoot, 'mock-obsidian');
	const auditPath = path.join(temporaryRoot, 'mock-audit.jsonl');
	await Promise.all([
		mkdir(vault, { recursive: true, mode: 0o700 }),
		mkdir(configRoot, { recursive: true, mode: 0o700 }),
	]);
	const fixtureDocument = JSON.parse(await readFile(
		path.join(root, 'scripts', 'agent-runtime', 'contracts', 'fixtures', 'cases.json'),
		'utf8',
	));
	const fixtures = Object.fromEntries([
		['query', 'valid-task-query-request'],
		['context', 'valid-exact-context-request'],
		['mutation', 'valid-update-preview'],
		['healthResult', 'valid-ready-runtime-health-with-durable-revision'],
		['mutationPlan', 'valid-destructive-delete-plan'],
		['taskContext', 'valid-legacy-invalid-task-context'],
	].map(([name, id]) => {
		const fixture = fixtureDocument.cases.find(candidate => candidate.id === id);
		assert.ok(fixture?.value, `OPERON_PUBLISHED_CLI_MOCK_FIXTURE_MISSING:${id}`);
		return [name, fixture.value];
	}));
	const inputPaths = {};
	for (const [name, value] of Object.entries(fixtures)) {
		const target = path.join(temporaryRoot, `${name}-request.json`);
		await writeFile(target, `${JSON.stringify(value)}\n`, { mode: 0o600 });
		inputPaths[name] = target;
	}
	const runtimeResults = createMockRuntimeResults(fixtures);
	const runtimeResultsPath = path.join(temporaryRoot, 'mock-runtime-results.json');
	await writeFile(runtimeResultsPath, `${JSON.stringify(runtimeResults)}\n`, { mode: 0o600 });
	const mockSource = `#!/usr/bin/env node
import { appendFileSync, chmodSync, readFileSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const token = process.argv.find(value => value.startsWith('requestToken='))?.slice('requestToken='.length);
if (!token || !/^[A-Za-z0-9_-]{32}$/.test(token)) process.exit(64);
const uid = typeof process.getuid === 'function' ? process.getuid() : null;
const user = uid === null ? 'uid-unavailable' : \`uid-\${uid}\`;
const root = path.join(os.tmpdir(), \`operon-agent-runtime-\${user}\`);
const requestPath = path.join(root, \`\${token}.request.json\`);
const body = readFileSync(requestPath);
const invocation = JSON.parse(body.toString('utf8'));
unlinkSync(requestPath);
appendFileSync(process.env.OPERON_EXTERNAL_MOCK_AUDIT, \`\${JSON.stringify({ command: invocation.command, kind: invocation.request?.kind ?? null, requestId: invocation.requestId })}\\n\`, { mode: 0o600 });
chmodSync(process.env.OPERON_EXTERNAL_MOCK_AUDIT, 0o600);
const failure = process.env.OPERON_EXTERNAL_MOCK_FAILURE === '1';
const results = JSON.parse(readFileSync(process.env.OPERON_EXTERNAL_MOCK_RESULTS, 'utf8'));
const commandResult = structuredClone(results[invocation.command]);
if (commandResult && typeof commandResult === 'object' && !Array.isArray(commandResult) && 'requestId' in commandResult) {
  commandResult.requestId = invocation.requestId;
}
const envelope = failure ? {
  contractVersion: 1,
  kind: 'cli-result',
  requestId: invocation.requestId,
  command: invocation.command,
  ok: false,
  transport: { channel: 'request-file', inputBytes: body.byteLength },
  vaultIdentity: { expectedMatch: true },
  timing: { handlerMs: 1 },
  warnings: [],
  failure: {
    stage: 'readiness',
    error: { contractVersion: 1, code: 'live-settling', reason: 'External compatibility mock.', retryable: true, action: 'wait-and-retry' }
  }
} : {
  contractVersion: 1,
  kind: 'cli-result',
  requestId: invocation.requestId,
  command: invocation.command,
  ok: true,
  transport: { channel: 'request-file', inputBytes: body.byteLength },
  vaultIdentity: { expectedMatch: true },
  compatibility: { contractVersion: 1, compatible: true, runtimeApi: 1 },
  cliContract: 1,
  runtime: { appVersion: '1.13.3', plugin: { id: 'operon', version: '3.0.1', minAppVersion: '1.7.2' }, apiVersion: 1 },
  timing: { handlerMs: 1 },
  warnings: [],
  result: commandResult
};
process.stdout.write(JSON.stringify(envelope) + '\\n');
`;
	await writeFile(mockExecutable, mockSource, { mode: 0o700 });
	await chmod(mockExecutable, 0o700);
	const invocations = [
		{ expected: 'health', argv: ['health'] },
		{ expected: 'capabilities', argv: ['capabilities'] },
		{ expected: 'diagnostics', argv: ['diagnostics'] },
		{ expected: 'catalog', kind: 'catalog', argv: ['catalog'] },
		{ expected: 'tasks.query', kind: 'task-query', argv: ['query', '--input', inputPaths.query] },
		{ expected: 'context.build', kind: 'context', argv: ['context', '--input', inputPaths.context] },
		{ expected: 'mutation.preview', kind: 'mutation-preview', argv: ['mutation', 'preview', '--input', inputPaths.mutation] },
		{ expected: 'health', argv: ['health'], failure: true },
	];
	const childEnvironment = sanitizedChildEnvironment(env);
	childEnvironment.OPERON_CONFIG_HOME = configRoot;
	childEnvironment.OPERON_EXTERNAL_MOCK_AUDIT = auditPath;
	childEnvironment.OPERON_EXTERNAL_MOCK_RESULTS = runtimeResultsPath;
	for (const invocation of invocations) {
		const invocationEnvironment = { ...childEnvironment };
		if (invocation.failure) invocationEnvironment.OPERON_EXTERNAL_MOCK_FAILURE = '1';
		const result = spawnSync(process.execPath, [
			executable,
			...invocation.argv,
			'--vault',
			vault,
			'--obsidian-bin',
			mockExecutable,
			'--json',
		], { cwd: vault, encoding: 'utf8', env: invocationEnvironment });
		if (result.error) throw result.error;
		const output = JSON.parse(result.stdout.trim());
		assert.equal(output.kind, 'cli-result');
		assert.equal(output.command, invocation.expected);
		if (invocation.failure) {
			assert.equal(result.status, 3, `OPERON_PUBLISHED_CLI_MOCK_FAILURE_EXIT_MISMATCH:${invocation.expected}`);
			assert.equal(output.ok, false);
			assert.equal(output.failure?.error?.code, 'live-settling');
		} else {
			assert.equal(
				result.status,
				0,
				`OPERON_PUBLISHED_CLI_MOCK_SUCCESS_EXIT_MISMATCH:${invocation.expected}:${result.stderr.trim()}:${result.stdout.trim()}`,
			);
			assert.equal(output.ok, true);
			assertMockCommandResult(output.result, invocation.expected);
		}
	}
	const audit = (await readFile(auditPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
	assert.deepEqual(
		audit.map(item => ({ command: item.command, kind: item.kind })),
		invocations.map(item => ({ command: item.expected, kind: item.kind ?? null })),
		'OPERON_PUBLISHED_CLI_MOCK_TRANSPORT_AUDIT_MISMATCH',
	);
	assert.equal(binding.runtime.contractVersion, 1);
	return true;
}

function createMockRuntimeResults(fixtures) {
	const health = fixtures.healthResult;
	const freshness = health.freshness;
	const contextRevision = health.contextRevision;
	return {
		health,
		capabilities: [],
		diagnostics: {
			contractVersion: 1,
			kind: 'runtime-diagnostics',
			health,
			capabilities: [],
			warnings: [],
		},
		catalog: createMockCatalogResult(freshness, contextRevision),
		'tasks.query': {
			contractVersion: 1,
			requestId: fixtures.query.requestId,
			kind: 'task-query-result',
			ok: true,
			freshness,
			contextRevision,
			tasks: [],
			page: { actualCount: 0, returnedCount: 0, truncated: false, asOf: freshness.observedAt },
			provenance: [],
			truncations: [],
			warnings: [],
		},
		'context.build': {
			contractVersion: 1,
			requestId: fixtures.context.requestId,
			kind: 'context-pack',
			ok: true,
			purpose: fixtures.context.purpose,
			projection: fixtures.context.projection,
			execution: freshness,
			contextRevision,
			entities: [fixtures.taskContext],
			relationships: { explicit: [], derived: [], inferred: [] },
			summary: { entityCount: 1, relationshipCount: 0, openCount: 1, doneCount: 0, cancelledCount: 0 },
			provenance: [],
			truncations: [],
			warnings: [],
		},
		'mutation.preview': {
			contractVersion: 1,
			requestId: fixtures.mutation.requestId,
			kind: 'mutation-preview-result',
			ok: true,
			warnings: [],
			plan: fixtures.mutationPlan,
		},
	};
}

function createMockCatalogResult(freshness, contextRevision) {
	const settingsFingerprint = contextRevision.settingsFingerprint;
	const taxonomy = {
		defaultPipeline: { configuredValue: 'Work', id: 'pipeline-work', status: 'resolved' },
		defaultPriority: { configuredValue: 'Normal', id: 'priority-normal', status: 'resolved' },
		pipelines: [{ id: 'pipeline-work', name: 'Work', description: 'Work tasks', order: 0, identityStatus: 'resolved', statuses: [] }],
		priorities: [],
	};
	const fields = [];
	const policies = {
		creation: {
			descriptionRequired: true,
			assigneesRequired: false,
			defaultEstimateMinutes: 0,
			defaultToFileTask: false,
			fileTaskTargetFolder: 'Tasks',
			fileTaskTemplateFolder: 'Templates',
			defaultFileTemplateId: 'folder-file-task-template:Templates/Default.md',
			inlineTaskSaveMode: 'specific-file',
			inlineTaskTargetFile: 'Tasks.md',
			inlineTaskHeading: '',
			dailyNoteAddsStartDate: false,
			dailyNoteAddsScheduledDate: false,
			createDailyNotesAsFileTasks: false,
			calendarInlineTaskHeading: '',
			builtInTemplateCandidates: [{ id: 'builtin-minimal-file-task-template:pipeline-work', pipelineId: 'pipeline-work', initialStatusId: 'status-open' }],
		},
		inheritance: {
			fields: [], statusPipelineSource: 'default', autoParentFileTask: false,
			autoParentLinkedFileSubtasks: false, fileTaskParentInlineTargetMode: 'default',
			fileTaskParentFileTargetMode: 'default', inlineTaskParentInlineTargetMode: 'default',
			inlineTaskParentFileTargetMode: 'default', inlineTaskParentFileHeadingKeyword: '',
		},
		exclusions: { folders: [] },
		filters: [],
		automation: {
			autoCompleteParentWhenAllChildrenTerminal: false, cascadeCancelToDescendants: false,
			newOccurrencePosition: 'below', fileTaskAutoArchiveEnabled: false, fileTaskArchiveFolder: '',
			fileTaskArchiveDelaySeconds: 0, fileTaskArchiveOnlyFromFileTasksFolder: false,
			fileRepeatDestination: 'same-folder', fileRepeatCustomFolder: '', estimateAutoReallocation: false,
			trackerSplitSessionsAtMidnight: false, reminderCatchUpWindowMinutes: 0,
			reminderAutoPinDueTasks: false, pinnedDockAutoPin: false, pinnedDockAutoUnpinFinished: false,
		},
		reminders: {
			fields: [{ canonicalKey: 'reminderDatetimes', availability: 'available' }, { canonicalKey: 'reminderRules', availability: 'available' }],
			ruleAnchors: ['datetimeStart', 'datetimeEnd', 'dateStarted', 'dateScheduled', 'dateDue'],
			itemActions: ['add', 'replace', 'remove'],
		},
		conversion: {
			directions: ['inline-to-file', 'file-to-inline'], templateSelection: 'explicit-or-needs-template',
			targetModes: ['exact-line', 'configured-target'], inlineToFileMovesPlainCheckboxes: false,
			fileToInlineRequiresExplicitConfirmation: true,
		},
		taskUpdate: { writableKeys: [], customKeyPolicy: 'active-valid-nonreserved-text-number-date-datetime-list-checkbox' },
		relationships: { writableFields: ['parentTask', 'blocking', 'blockedBy'], actions: ['replace', 'clear'], parentMaxTargets: 1, dependencyInverseWrites: true },
		transitions: { actions: ['set-status', 'complete', 'cancel', 'reopen'] },
		timer: { actions: ['start', 'stop'] },
		inlineRelocation: { target: 'exact-blank-line' },
		deletion: { requiresExplicitConfirmation: true, deleteAdditionalTasks: false, referenceCleanup: 'explicit-or-block' },
		projectSerialScopes: [],
	};
	const catalogRevision = sha256(Buffer.from(canonicalJson({ settingsFingerprint, taxonomy, fields, policies }), 'utf8'));
	return {
		contractVersion: 1,
		requestId: 'catalog-external-compatibility',
		kind: 'catalog-result',
		ok: true,
		freshness,
		warnings: [],
		contextRevision,
		settingsFingerprint,
		catalogRevision,
		taxonomy,
		fields,
		policies,
	};
}

function canonicalJson(value) {
	if (value === null || typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value);
	if (typeof value === 'string') return JSON.stringify(value.normalize('NFC'));
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	return `{${Object.keys(value).sort().map(key => (
		`${JSON.stringify(key.normalize('NFC'))}:${canonicalJson(value[key])}`
	)).join(',')}}`;
}

function assertMockCommandResult(result, command) {
	const expectations = {
		health: ['lifecyclePhase', 'freshness', 'admission'],
		capabilities: [],
		diagnostics: ['health', 'capabilities', 'warnings'],
		catalog: ['catalogRevision', 'taxonomy', 'fields', 'policies'],
		'tasks.query': ['tasks', 'page', 'provenance', 'truncations'],
		'context.build': ['entities', 'relationships', 'summary', 'provenance'],
		'mutation.preview': ['plan', 'warnings'],
	};
	assert.ok(Object.hasOwn(expectations, command), `OPERON_PUBLISHED_CLI_MOCK_COMMAND_UNKNOWN:${command}`);
	if (command === 'capabilities') {
		assert.ok(Array.isArray(result), 'OPERON_PUBLISHED_CLI_MOCK_CAPABILITIES_RESULT_INVALID');
		return;
	}
	assert.equal(typeof result, 'object', `OPERON_PUBLISHED_CLI_MOCK_RESULT_INVALID:${command}`);
	for (const field of expectations[command]) {
		assert.ok(Object.hasOwn(result, field), `OPERON_PUBLISHED_CLI_MOCK_RESULT_FIELD_MISSING:${command}:${field}`);
	}
}

export async function resolveNpmInvocation(env = process.env) {
	const npmExecPath = env.npm_execpath;
	if (typeof npmExecPath !== 'string' || !path.isAbsolute(npmExecPath) || npmExecPath.includes('\0')) {
		throw new Error('OPERON_PUBLISHED_CLI_NPM_EXECPATH_INVALID');
	}
	const stats = await lstat(npmExecPath);
	if (!stats.isFile() || stats.isSymbolicLink()) {
		throw new Error('OPERON_PUBLISHED_CLI_NPM_EXECPATH_INVALID');
	}
	const version = spawnSync(process.execPath, [npmExecPath, '--version'], {
		encoding: 'utf8',
		env: sanitizedChildEnvironment(env),
	});
	assertSpawnSucceeded(version, 'OPERON_PUBLISHED_CLI_NPM_EXEC_FAILED');
	assert.equal(version.stdout.trim(), '11.12.1', 'OPERON_PUBLISHED_CLI_NPM_VERSION_MISMATCH');
	return Object.freeze({ path: npmExecPath, version: version.stdout.trim() });
}

export function sanitizedChildEnvironment(env) {
	const output = {};
	let pathValue = '';
	for (const [key, value] of Object.entries(env)) {
		const normalizedKey = key.toLowerCase();
		if (normalizedKey === 'path') {
			pathValue ||= value ?? '';
			continue;
		}
		if (
			normalizedKey === 'node_auth_token'
			|| normalizedKey === 'npm_token'
			|| normalizedKey === 'npm_config_registry'
			|| normalizedKey === 'npm_config_userconfig'
			|| normalizedKey === 'npm_config_globalconfig'
			|| (normalizedKey.startsWith('npm_config_') && /auth|token/u.test(normalizedKey))
		) continue;
		output[key] = value;
	}
	output.PATH = pathValue;
	output.NO_COLOR = '1';
	return output;
}

async function listFileInventory(root, prefix) {
	const output = [];
	await walk(root, '');
	return output.sort(compareInventoryPath);

	async function walk(directory, relativeDirectory) {
		const entries = await readdir(directory, { withFileTypes: true });
		entries.sort((left, right) => left.name.localeCompare(right.name));
		for (const entry of entries) {
			const relative = relativeDirectory
				? path.posix.join(relativeDirectory, entry.name)
				: entry.name;
			const absolute = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				await walk(absolute, relative);
				continue;
			}
			if (!entry.isFile() || entry.isSymbolicLink()) {
				throw new Error(`OPERON_PUBLISHED_CLI_NON_FILE_ARTIFACT:${relative}`);
			}
			const [stats, bytes] = await Promise.all([lstat(absolute), readFile(absolute)]);
			output.push({
				path: prefix ? path.posix.join(prefix, relative) : relative,
				mode: stats.mode & 0o777,
				size: bytes.length,
				sha256: sha256(bytes),
			});
		}
	}
}

async function normalizeDeclarationImports(root) {
	for (const item of await listFileInventory(root, '')) {
		const target = path.join(root, item.path);
		const source = await readFile(target, 'utf8');
		const normalized = source
			.replace(/(\bfrom\s+['"])(\.\.?\/[^'"]+)(['"])/gu, (_match, before, specifier, after) => (
				`${before}${withJavaScriptExtension(specifier)}${after}`
			))
			.replace(/(\bimport\(\s*['"])(\.\.?\/[^'"]+)(['"]\s*\))/gu, (_match, before, specifier, after) => (
				`${before}${withJavaScriptExtension(specifier)}${after}`
			));
		if (normalized !== source) await writeFile(target, normalized, 'utf8');
	}
}

function withJavaScriptExtension(specifier) {
	return /\.[a-z0-9]+$/iu.test(specifier) ? specifier : `${specifier}.js`;
}

function resolveRepositoryPath(root, relative) {
	if (path.posix.normalize(relative) !== relative || relative.startsWith('../') || path.isAbsolute(relative)) {
		throw new Error(`OPERON_PUBLISHED_CLI_REPOSITORY_PATH_INVALID:${relative}`);
	}
	const target = path.resolve(root, relative);
	if (!target.startsWith(`${path.resolve(root)}${path.sep}`)) {
		throw new Error(`OPERON_PUBLISHED_CLI_REPOSITORY_PATH_ESCAPE:${relative}`);
	}
	return target;
}

function assertUniqueSortedPaths(items, label) {
	const paths = items.map(item => item.path);
	assert.equal(new Set(paths).size, paths.length, `OPERON_PUBLISHED_CLI_DUPLICATE_PATH:${label}`);
	assert.deepEqual(paths, [...paths].sort(), `OPERON_PUBLISHED_CLI_UNSORTED_PATHS:${label}`);
}

function assertUniquePaths(items, label) {
	const paths = items.map(item => item.path);
	assert.equal(new Set(paths).size, paths.length, `OPERON_PUBLISHED_CLI_DUPLICATE_PATH:${label}`);
}

function compareInventoryPath(left, right) {
	return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

function assertIdentityInInventory(inventory, identity) {
	const item = inventory.find(candidate => candidate.path === identity.path);
	assert.ok(item, `OPERON_PUBLISHED_CLI_IDENTITY_MISSING:${identity.path}`);
	assert.deepEqual(
		item,
		{ path: identity.path, mode: identity.mode, size: identity.bytes, sha256: identity.sha256 },
		`OPERON_PUBLISHED_CLI_IDENTITY_MISMATCH:${identity.path}`,
	);
}

function assertSpawnSucceeded(result, code) {
	if (result.error) throw new Error(`${code}:${result.error.message}`);
	if (result.status !== 0) {
		const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
		throw new Error(`${code}:${result.status}\n${output}`);
	}
}

async function assertInstalledVersion(prefix, expectedVersion, env) {
	const packageRoot = path.join(prefix, 'lib', 'node_modules', '@stratejya', 'operon-cli');
	const packageJson = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
	assert.equal(packageJson.version, expectedVersion, 'OPERON_PUBLISHED_CLI_LIFECYCLE_PACKAGE_VERSION_MISMATCH');
	const executable = path.join(packageRoot, 'dist', 'operon.mjs');
	const result = spawnSync(process.execPath, [executable, 'version'], { encoding: 'utf8', env });
	assertSpawnSucceeded(result, 'OPERON_PUBLISHED_CLI_LIFECYCLE_VERSION_FAILED');
	assert.equal(result.stdout.trim(), `operon-cli ${expectedVersion}`);
}
