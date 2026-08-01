import {
	chmod,
	copyFile,
	mkdir,
	readFile,
	readdir,
	rm,
	stat,
	writeFile,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { builtinModules, createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { build } from 'esbuild';
import {
	OPERON_PRODUCTION_CLI_PERSISTENT_READ,
} from '../../operon-build-config.mjs';
import {
	OPERON_CLI_EXECUTABLE_SOFT_LIMIT_BYTES,
	classifyOperonCliExecutableSize,
} from './size-policy.mjs';
import {
	checkRuntimeSchemaManifestV1,
} from '../../scripts/agent-runtime/contracts/generate-schema-manifest.mjs';
import {
	buildCliManifestDocumentV1,
	CLI_SCHEMA_ENTRYPOINTS_V1,
} from './contract-manifest.mjs';
import { buildContractTypesV1 } from './type-build.mjs';

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pluginRoot = path.resolve(packageRoot, '../..');
const distRoot = path.join(packageRoot, 'dist');
await rm(distRoot, { recursive: true, force: true });
await mkdir(distRoot, { recursive: true });
const packageDocument = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
if (packageDocument.name !== 'operon-cli' || typeof packageDocument.version !== 'string') {
	throw new Error('OPERON_CLI_PACKAGE_METADATA_INVALID');
}
const frameTimingBuild = process.env.OPERON_CLI_FRAME_TIMING_BUILD === '1';
const persistentReadOverride = process.env.OPERON_CLI_PERSISTENT_READ_BUILD;
if (
	persistentReadOverride !== undefined
	&& persistentReadOverride !== '0'
	&& persistentReadOverride !== '1'
) throw new Error('OPERON_CLI_PERSISTENT_READ_BUILD_INVALID');
const persistentReadBuild = persistentReadOverride === undefined
	? OPERON_PRODUCTION_CLI_PERSISTENT_READ
	: persistentReadOverride === '1';

const stripPersistentReadClientPlugin = {
	name: 'strip-persistent-read-client',
	setup(buildContext) {
		buildContext.onResolve(
			{ filter: /^\.\/persistent-read-client$/ },
			() => ({
				path: 'persistent-read-client-disabled',
				namespace: 'operon-persistent-build-gate',
			}),
		);
		buildContext.onLoad(
			{ filter: /.*/, namespace: 'operon-persistent-build-gate' },
			() => ({
				contents: `
					export class PersistentReadTransportErrorV1 extends Error {
						constructor(message, frameSent = false) {
							super(message);
							this.frameSent = frameSent;
						}
					}
					export class PersistentReadTransportV1 {
						invoke() { throw new Error("FEATURE_BUILD_DISABLED"); }
						noteFallback() {}
						consumeLastEvidence() { return null; }
						close() {}
					}
				`,
				loader: 'js',
			}),
		);
	},
};
const stripFrameTimingPlugin = {
	name: 'strip-frame-timing',
	setup(buildContext) {
		buildContext.onResolve(
			{ filter: /^\.\/session-frame-timing$/ },
			() => ({
				path: 'session-frame-timing-disabled',
				namespace: 'operon-timing-build-gate',
			}),
		);
		buildContext.onLoad(
			{ filter: /session-frame-timing-disabled/, namespace: 'operon-timing-build-gate' },
			() => ({
				contents: `
					const state = Object.freeze({
						submit: () => 0,
						begin: () => [0, 0],
						complete: () => {},
						flush: () => Promise.resolve(),
					});
					export function createSessionFrameClockV1() { return state; }
				`,
				loader: 'js',
			}),
		);
	},
};

const outfile = path.join(distRoot, 'operon.mjs');
const buildResult = await build({
	entryPoints: [path.join(packageRoot, 'src/main.ts')],
	outdir: distRoot,
	entryNames: 'operon',
	chunkNames: 'chunks/chunk-[hash]',
	outExtension: { '.js': '.mjs' },
	bundle: true,
	splitting: true,
	platform: 'node',
	format: 'esm',
	target: 'node22',
	charset: 'utf8',
	minify: true,
	sourcemap: false,
	metafile: true,
	banner: { js: '#!/usr/bin/env node' },
	define: {
		__OPERON_CLI_VERSION__: JSON.stringify(packageDocument.version),
		__OPERON_CLI_FRAME_TIMING__: frameTimingBuild ? 'true' : 'false',
		__OPERON_CLI_PERSISTENT_READ__: persistentReadBuild ? 'true' : 'false',
	},
	plugins: [
		...(persistentReadBuild ? [] : [stripPersistentReadClientPlugin]),
		...(frameTimingBuild ? [] : [stripFrameTimingPlugin]),
	],
	external: [
		...builtinModules,
		...builtinModules.map(moduleName => `node:${moduleName}`),
	],
});
if (process.env.OPERON_CLI_ESBUILD_METAFILE) {
	await writeFile(process.env.OPERON_CLI_ESBUILD_METAFILE, JSON.stringify(buildResult.metafile));
}

const forbiddenInput = Object.keys(buildResult.metafile.inputs).find(input => (
	/(?:^|\/)node_modules\/(?:electron|obsidian)(?:\/|$)/u.test(input)
));
if (forbiddenInput) {
	throw new Error(`OPERON_CLI_FORBIDDEN_RUNTIME_INPUT:${forbiddenInput}`);
}
const forbiddenOutputPattern = /(?:from|import)\s*["'](?:electron|obsidian)["']|\b(?:document|window)\s*\.|\bHTMLElement\b/u;
for (const outputPath of Object.keys(buildResult.metafile.outputs)) {
	if (!outputPath.endsWith('.mjs')) continue;
	const output = await readFile(
		path.isAbsolute(outputPath) ? outputPath : path.resolve(outputPath),
		'utf8',
	);
	if (forbiddenOutputPattern.test(output)) {
		throw new Error('OPERON_CLI_FORBIDDEN_BROWSER_OR_OBSIDIAN_RUNTIME');
	}
	if (!persistentReadBuild) {
		for (const marker of [
			'PERSISTENT_COMMAND_NOT_ALLOWED',
			'persistent-read-descriptor',
			'persistent-read-socket',
		]) {
			if (output.includes(marker)) {
				throw new Error(`OPERON_CLI_DISABLED_PERSISTENT_READ_LEAK:${marker}`);
			}
		}
	}
	if (!frameTimingBuild) {
		for (const marker of [
			'OPERON_CLI_STAGE51_TIMING_FD',
			'frameTiming',
			'timeOriginMs',
			'submittedEpochMs',
			'serviceStartEpochMs',
			'serviceEndEpochMs',
			'clockOffsetMs',
		]) {
			if (output.includes(marker)) {
				throw new Error(`OPERON_CLI_DISABLED_FRAME_TIMING_LEAK:${marker}`);
			}
		}
	}
}
await chmod(outfile, 0o755);
const executableStat = await stat(outfile);
const executableSizeStatus = classifyOperonCliExecutableSize(executableStat.size);
if (executableSizeStatus === 'fail') {
	throw new Error(`OPERON_CLI_EXECUTABLE_TOO_LARGE:${executableStat.size}`);
}
if (executableSizeStatus === 'warn') {
	console.warn(
		`Operon CLI executable exceeds the ${OPERON_CLI_EXECUTABLE_SOFT_LIMIT_BYTES / 1_000} KB target: ${executableStat.size} bytes.`,
	);
}

const schemaTargetRoot = path.join(packageRoot, 'schemas', 'v1');
await checkRuntimeSchemaManifestV1();
await rm(schemaTargetRoot, { recursive: true, force: true });
await mkdir(schemaTargetRoot, { recursive: true });
const copiedSchemaFileNames = new Set();
for (const sourceRoot of [
	path.join(pluginRoot, 'contracts', 'agent-runtime', 'v1'),
	path.join(packageRoot, 'schema-source'),
]) {
	for (const fileName of await readdir(sourceRoot)) {
		if (!fileName.endsWith('.json')) continue;
		if (copiedSchemaFileNames.has(fileName)) {
			throw new Error(`OPERON_CLI_SCHEMA_FILENAME_COLLISION:${fileName}`);
		}
		copiedSchemaFileNames.add(fileName);
		const schemaTargetPath = path.join(schemaTargetRoot, fileName);
		await copyFile(path.join(sourceRoot, fileName), schemaTargetPath);
		await chmod(schemaTargetPath, 0o644);
		if (process.platform !== 'win32' && ((await stat(schemaTargetPath)).mode & 0o777) !== 0o644) {
			throw new Error(`OPERON_CLI_SCHEMA_MODE_INVALID:${fileName}`);
		}
	}
}

const manifestModulePath = path.join(distRoot, '.manifest-data.cjs');
await build({
	entryPoints: [path.join(packageRoot, 'src', 'manifest-data.ts')],
	outfile: manifestModulePath,
	bundle: true,
	platform: 'node',
	format: 'cjs',
	target: 'node22',
	minify: true,
});
const manifestModule = require(manifestModulePath);
await rm(manifestModulePath, { force: true });
const schemaFiles = (await readdir(schemaTargetRoot)).filter(name => name.endsWith('.json')).sort();
const schemas = [];
const schemaDigests = new Map();
const schemaDocumentsById = new Map();
for (const fileName of schemaFiles) {
	const bytes = await readFile(path.join(schemaTargetRoot, fileName));
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	schemaDigests.set(fileName, sha256);
	const document = JSON.parse(bytes.toString('utf8'));
	if (typeof document?.$id === 'string') {
		if (schemaDocumentsById.has(document.$id)) {
			throw new Error(`OPERON_CLI_SCHEMA_DUPLICATE_ID:${document.$id}`);
		}
		schemaDocumentsById.set(document.$id, { file: fileName, sha256, document });
	}
	schemas.push({
		file: fileName,
		...(typeof document?.$id === 'string' ? { id: document.$id } : {}),
		sha256,
	});
}
const runtimeSchemaManifest = JSON.parse(
	await readFile(path.join(schemaTargetRoot, 'schema-manifest.json'), 'utf8'),
);
const schemaEntrypoints = [
	...runtimeSchemaManifest.entrypoints,
	...CLI_SCHEMA_ENTRYPOINTS_V1,
].map(entrypoint => {
	const [documentId] = entrypoint.ref.split('#', 1);
	const document = schemaDocumentsById.get(documentId);
	if (!document) {
		throw new Error(`OPERON_CLI_SCHEMA_ENTRYPOINT_INVALID:${entrypoint.schemaId}`);
	}
	const fragment = entrypoint.ref.includes('#') ? entrypoint.ref.split('#', 2)[1] : '';
	if (fragment && resolveJsonPointer(document.document, fragment) === undefined) {
		throw new Error(`OPERON_CLI_SCHEMA_FRAGMENT_MISSING:${entrypoint.schemaId}`);
	}
	return {
		schemaId: entrypoint.schemaId,
		ref: entrypoint.ref,
		file: document.file,
		sha256: document.sha256,
		stability: entrypoint.stability ?? 'stable',
		...(entrypoint.deprecation ? { deprecation: entrypoint.deprecation } : {}),
	};
}).sort((left, right) => left.schemaId.localeCompare(right.schemaId));
const manifestBase = manifestModule.createCliManifestBaseV1(packageDocument.version);
const manifest = buildCliManifestDocumentV1(manifestBase, schemas, schemaEntrypoints);
await writeFile(
	path.join(packageRoot, 'cli-manifest-v1.json'),
	`${JSON.stringify(manifest, null, 2)}\n`,
	'utf8',
);

function resolveJsonPointer(document, fragment) {
	if (fragment === '') return document;
	if (!fragment.startsWith('/')) return undefined;
	let current = document;
	for (const rawToken of fragment.slice(1).split('/')) {
		const token = rawToken.replaceAll('~1', '/').replaceAll('~0', '~');
		if (current === null || typeof current !== 'object' || !(token in current)) return undefined;
		current = current[token];
	}
	return current;
}
await copyFile(path.join(pluginRoot, 'LICENSE'), path.join(packageRoot, 'LICENSE'));
await buildContractTypesV1({ mode: 'write' });
