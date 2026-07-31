import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	copyFile,
	mkdtemp,
	mkdir,
	readFile,
	rm,
	writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const fixtureRoot = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(fixtureRoot, '../../../..');
const cliPackageRoot = path.join(pluginRoot, 'packages', 'operon-cli');
const require = createRequire(import.meta.url);
const tscPath = require.resolve('typescript/bin/tsc');
const options = parseArguments(process.argv.slice(2));
const outputRoot = path.resolve(options.outputRoot ?? path.join(fixtureRoot, 'dist'));
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'operon-developer-api-consumer-build-'));
const cleanEnvironment = {
	...process.env,
	npm_config_cache: path.join(temporaryRoot, 'npm-cache'),
	npm_config_audit: 'false',
	npm_config_fund: 'false',
	npm_config_update_notifier: 'false',
	NO_COLOR: '1',
};

try {
	const tarballPath = options.tarballPath
		? path.resolve(options.tarballPath)
		: await packLocalCli();
	const tarballBytes = await readFile(tarballPath);
	const stagingRoot = path.join(temporaryRoot, 'consumer');
	await mkdir(stagingRoot, { recursive: true });
	for (const fileName of [
		'acceptance.ts',
		'main.ts',
		'runner-contract.ts',
		'tsconfig.json',
	]) await copyFile(path.join(fixtureRoot, fileName), path.join(stagingRoot, fileName));
	for (const shimName of ['node-shim.d.ts', 'obsidian-shim.d.ts']) {
		await copyFile(
			path.join(fixtureRoot, `${shimName}.fixture`),
			path.join(stagingRoot, shimName),
		);
	}
	await writeFile(
		path.join(stagingRoot, 'package.json'),
		'{"name":"operon-native-consumer-build","private":true,"type":"module"}\n',
		'utf8',
	);
	run(
		'npm',
		[
			'install',
			'--ignore-scripts',
			'--no-audit',
			'--no-fund',
			'--package-lock=false',
			tarballPath,
		],
		stagingRoot,
	);
	const installedPackageRoot = path.join(stagingRoot, 'node_modules', 'operon-cli');
	const installedPackage = JSON.parse(await readFile(
		path.join(installedPackageRoot, 'package.json'),
		'utf8',
	));
	assert.equal(
		installedPackage.exports?.['./contracts/v1/developer-api']?.default,
		null,
		'Developer API package subpath must remain type-only.',
	);
	assert.equal(
		installedPackage.exports?.['./contracts/v1/developer-api']?.types,
		'./types/src/agent-runtime/public/v1/developer-api.d.ts',
	);
	await assertPublicTypeImportsOnly(stagingRoot);
	run(
		process.execPath,
		[tscPath, '--project', path.join(stagingRoot, 'tsconfig.json'), '--pretty', 'false'],
		stagingRoot,
	);

	await mkdir(outputRoot, { recursive: true });
	const mainOutputPath = path.join(outputRoot, 'main.js');
	const buildResult = await build({
		entryPoints: [path.join(stagingRoot, 'main.ts')],
		outfile: mainOutputPath,
		bundle: true,
		platform: 'browser',
		format: 'cjs',
		target: ['es2022'],
		charset: 'utf8',
		minify: true,
		sourcemap: false,
		metafile: true,
		external: ['obsidian', 'node:*'],
		logLevel: 'silent',
	});
	const runtimeInputs = Object.keys(buildResult.metafile.inputs)
		.map(input => path.basename(input))
		.sort();
	assert.deepEqual(
		runtimeInputs,
		['acceptance.ts', 'main.ts', 'runner-contract.ts'],
		'Acceptance fixture runtime graph changed unexpectedly.',
	);
	const mainBytes = await readFile(mainOutputPath);
	const mainSource = mainBytes.toString('utf8');
	for (const forbidden of [
		'operon-cli',
		'src/agent-runtime',
		'packages/operon-cli',
	]) assert.equal(mainSource.includes(forbidden), false, `Runtime type dependency leaked: ${forbidden}`);
	await copyFile(path.join(fixtureRoot, 'manifest.json'), path.join(outputRoot, 'manifest.json'));
	const evidence = {
		evidenceVersion: 1,
		kind: 'operon-developer-api-native-consumer-build',
		package: `${installedPackage.name}@${installedPackage.version}`,
		tarball: path.basename(tarballPath),
		tarballSha256: sha256(tarballBytes),
		publicTypesEntrypoint: 'operon-cli/contracts/v1/developer-api',
		runtimeInputs,
		mainJsSha256: sha256(mainBytes),
		mainJsBytes: mainBytes.length,
	};
	await writeFile(
		path.join(outputRoot, 'build-evidence.json'),
		`${JSON.stringify(evidence, null, 2)}\n`,
		'utf8',
	);
	process.stdout.write(`${JSON.stringify({ status: 'ok', ...evidence })}\n`);

	async function packLocalCli() {
		const packRoot = path.join(temporaryRoot, 'pack');
		await mkdir(packRoot, { recursive: true });
		const result = run(
			'npm',
			['pack', '--json', '--pack-destination', packRoot],
			cliPackageRoot,
		);
		const packResult = JSON.parse(result.stdout)[0];
		assert.equal(packResult.name, 'operon-cli');
		return path.join(packRoot, packResult.filename);
	}
} finally {
	await rm(temporaryRoot, { recursive: true, force: true });
}

async function assertPublicTypeImportsOnly(stagingRoot) {
	for (const fileName of ['acceptance.ts', 'main.ts', 'runner-contract.ts']) {
		const source = await readFile(path.join(stagingRoot, fileName), 'utf8');
		for (const match of source.matchAll(/\boperon-cli(?:\/[^'"]*)?/gu)) {
			assert.equal(
				match[0],
				'operon-cli/contracts/v1/developer-api',
				`Fixture imported a non-public or non-Developer-API package path: ${match[0]}`,
			);
		}
		assert.doesNotMatch(source, /\b(?:src|packages)\/agent-runtime\b/u);
	}
}

function parseArguments(args) {
	const parsed = {};
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (argument === '--tarball') {
			parsed.tarballPath = args[index + 1];
			index += 1;
		} else if (argument === '--outdir') {
			parsed.outputRoot = args[index + 1];
			index += 1;
		} else {
			throw new Error(`Unknown argument: ${argument}`);
		}
	}
	if (args.length > 0 && (!parsed.tarballPath || !parsed.outputRoot)) {
		throw new Error('Usage: build.mjs [--tarball <operon-cli.tgz> --outdir <plugin-dir>]');
	}
	return parsed;
}

function run(command, args, cwd) {
	const result = spawnSync(command, args, {
		cwd,
		encoding: 'utf8',
		env: cleanEnvironment,
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error([
			`Command failed (${result.status}): ${command} ${args.join(' ')}`,
			result.stdout,
			result.stderr,
		].filter(Boolean).join('\n'));
	}
	return result;
}

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}
