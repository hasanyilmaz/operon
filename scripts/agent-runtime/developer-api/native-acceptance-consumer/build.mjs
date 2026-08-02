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
import {
	loadPublishedCliBinding,
	resolveNpmInvocation,
	sanitizedChildEnvironment,
	verifyTarballIdentity,
} from '../../cli/published-cli-v1.mjs';

const fixtureRoot = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const tscPath = require.resolve('typescript/bin/tsc');
const options = parseArguments(process.argv.slice(2));
const outputRoot = path.resolve(options.outputRoot ?? path.join(fixtureRoot, 'dist'));
const { binding } = await loadPublishedCliBinding();
const requestedTarballPath = path.resolve(options.tarballPath);
const tarballBytes = await verifyTarballIdentity(requestedTarballPath, binding);
const npm = await resolveNpmInvocation(process.env);
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'operon-developer-api-consumer-build-'));
const cleanEnvironment = {
	...sanitizedChildEnvironment(process.env),
	npm_config_cache: path.join(temporaryRoot, 'npm-cache'),
	npm_config_audit: 'false',
	npm_config_fund: 'false',
	npm_config_update_notifier: 'false',
	NO_COLOR: '1',
};

try {
	const tarballPath = path.join(temporaryRoot, 'verified-operon-cli-1.0.8.tgz');
	await writeFile(tarballPath, tarballBytes, { mode: 0o600 });
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
		process.execPath,
		[
			npm.path,
			'install',
			'--ignore-scripts',
			'--offline',
			'--no-audit',
			'--no-fund',
			'--package-lock=false',
			tarballPath,
		],
		stagingRoot,
	);
	const installedPackageRoot = path.join(
		stagingRoot,
		'node_modules',
		...binding.package.name.split('/'),
	);
	const installedPackage = JSON.parse(await readFile(
		path.join(installedPackageRoot, 'package.json'),
		'utf8',
	));
	assert.equal(
		installedPackage.name,
		binding.package.name,
		'Installed Developer API package name differs from the published binding.',
	);
	assert.equal(
		installedPackage.version,
		binding.package.version,
		'Installed Developer API package version differs from the published binding.',
	);
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
	]) assert.equal(mainSource.includes(forbidden), false, `Runtime type dependency leaked: ${forbidden}`);
	await copyFile(path.join(fixtureRoot, 'manifest.json'), path.join(outputRoot, 'manifest.json'));
	const evidence = {
		evidenceVersion: 1,
		kind: 'operon-developer-api-native-consumer-build',
		package: `${installedPackage.name}@${installedPackage.version}`,
		tarball: path.basename(requestedTarballPath),
		tarballSha256: sha256(tarballBytes),
		publicTypesEntrypoint: '@stratejya/operon-cli/contracts/v1/developer-api',
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
} finally {
	await rm(temporaryRoot, { recursive: true, force: true });
}

async function assertPublicTypeImportsOnly(stagingRoot) {
	for (const fileName of ['acceptance.ts', 'main.ts', 'runner-contract.ts']) {
		const source = await readFile(path.join(stagingRoot, fileName), 'utf8');
		for (const match of source.matchAll(/@stratejya\/operon-cli(?:\/[^'"]*)?/gu)) {
			assert.equal(
				match[0],
				'@stratejya/operon-cli/contracts/v1/developer-api',
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
	if (!parsed.tarballPath || !parsed.outputRoot) {
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
