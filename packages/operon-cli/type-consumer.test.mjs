import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	mkdtemp,
	mkdir,
	readFile,
	readdir,
	rm,
	writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const packageRoot = path.dirname(scriptPath);
const require = createRequire(import.meta.url);
const tscPath = require.resolve('typescript/bin/tsc');
const npmExecPath = process.env.npm_execpath;
if (
	typeof npmExecPath !== 'string'
	|| !path.isAbsolute(npmExecPath)
	|| npmExecPath.includes('\0')
) throw new Error('OPERON_TYPE_CONSUMER_NPM_EXECPATH_REQUIRED');
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'operon-cli-type-consumer-'));
const packRoot = path.join(temporaryRoot, 'pack');
const consumerRoot = path.join(temporaryRoot, 'consumer');
const cleanEnvironment = {
	...process.env,
	npm_config_cache: path.join(temporaryRoot, 'npm-cache'),
	npm_config_fund: 'false',
	npm_config_audit: 'false',
	npm_config_update_notifier: 'false',
	NO_COLOR: '1',
};

try {
	await mkdir(packRoot, { recursive: true });
	await mkdir(consumerRoot, { recursive: true });
	const packResult = runJson(
		process.execPath,
		[npmExecPath, 'pack', '--json', '--pack-destination', packRoot],
		{ cwd: packageRoot },
	)[0];
	assert.equal(packResult.name, 'operon-cli');

	const sourceTypes = await snapshotDeclarationTree(path.join(packageRoot, 'types'));
	const packedTypePaths = packResult.files
		.map(file => file.path)
		.filter(file => file.startsWith('types/'))
		.sort();
	assert.deepEqual(
		packedTypePaths,
		sourceTypes.map(file => `types/${file.path}`),
		'Packed declaration inventory must exactly match the generated declaration tree.',
	);
	const expectedExamplePaths = [
		'examples/developer-api-consumer/README.md',
		'examples/developer-api-consumer/main.ts',
		'examples/developer-api-consumer/manifest.json',
		'examples/developer-api-consumer/package.json',
		'examples/developer-api-consumer/tsconfig.json',
	];
	const packedExamplePaths = packResult.files
		.map(file => file.path)
		.filter(file => file.startsWith('examples/developer-api-consumer/'))
		.sort();
	assert.deepEqual(
		packedExamplePaths,
		expectedExamplePaths,
		'Packed Developer API example inventory must remain source-only and complete.',
	);
	assert.ok(
		packResult.files.every(file => (
			!file.path.includes('/node_modules/')
			&& !file.path.endsWith('/package-lock.json')
			&& !file.path.endsWith('/main.js')
			&& !file.path.endsWith('/main.js.map')
		)),
		'Tarball must not contain example dependencies, lockfiles, or compiled output.',
	);

	const tarballPath = path.join(packRoot, packResult.filename);
	await writeFile(
		path.join(consumerRoot, 'package.json'),
		`${JSON.stringify({ name: 'operon-cli-clean-room-consumer', private: true, type: 'module' }, null, 2)}\n`,
	);
	run(
		process.execPath,
		[
			npmExecPath,
			'install',
			'--ignore-scripts',
			'--no-audit',
			'--no-fund',
			'--package-lock=false',
			tarballPath,
		],
		{ cwd: consumerRoot },
	);

	const installedPackageRoot = path.join(consumerRoot, 'node_modules', 'operon-cli');
	assert.deepEqual(
		await snapshotDeclarationTree(path.join(installedPackageRoot, 'types')),
		sourceTypes,
		'Installed tarball declaration bytes must match the generated declaration tree.',
	);
	const installedExampleMain = path.join(
		installedPackageRoot,
		'examples',
		'developer-api-consumer',
		'main.ts',
	);
	const installedExampleSource = await readFile(installedExampleMain, 'utf8');
	const packageImports = [
		...installedExampleSource.matchAll(/from\s+['"]([^'"]+)['"]/gu),
	].map(match => match[1]).filter(specifier => specifier.startsWith('operon-cli'));
	assert.deepEqual(
		packageImports,
		['operon-cli/contracts/v1/developer-api'],
		'Example may import only the public type-only Developer API entrypoint.',
	);
	assert.doesNotMatch(installedExampleSource, /\b(import|require)\s*\(\s*['"]/u);
	for (const requiredPattern of [
		/getDeveloperApiV1\(this,/u,
		/api\.system\.health\(\)/u,
		/api\.system\.capabilities\(\)/u,
		/api\.tasks\.get\(/u,
		/api\.mutations\.preview\(/u,
		/api\.mutations\.apply\(/u,
		/api\.mutations\.pendingRecoveries\(\)/u,
		/api\.mutations\.recover\(\{ recoveryRef \}\)/u,
		/const RECOVERY_CAPABILITIES = \[\] as const;/u,
		/this\.connect\(RECOVERY_CAPABILITIES\)/u,
	]) {
		assert.match(
			installedExampleSource,
			requiredPattern,
			`Developer API example is missing required flow: ${requiredPattern}`,
		);
	}
	const installedExamplePackage = JSON.parse(await readFile(
		path.join(
			installedPackageRoot,
			'examples',
			'developer-api-consumer',
			'package.json',
		),
		'utf8',
	));
	assert.equal(installedExamplePackage.private, true);
	assert.equal(installedExamplePackage.devDependencies['operon-cli'], '*');

	await writeFile(path.join(consumerRoot, 'obsidian-stub.d.ts'), `
declare module 'obsidian' {
	export class Plugin {
		readonly app: unknown;
		readonly manifest: {
			readonly id: string;
			readonly name: string;
			readonly version: string;
		};
		onload(): void;
		addCommand(command: {
			id: string;
			name: string;
			callback: () => void;
		}): void;
	}
}
`, 'utf8');
	for (const compiler of [
		{ name: 'example-nodenext', module: 'NodeNext', moduleResolution: 'NodeNext' },
		{ name: 'example-bundler', module: 'ESNext', moduleResolution: 'Bundler' },
	]) {
		const configName = `tsconfig.${compiler.name}.json`;
		await writeCompilerConfig(
			configName,
			compiler,
			[
				path.relative(consumerRoot, installedExampleMain),
				'obsidian-stub.d.ts',
			],
			{
				baseUrl: '.',
				paths: { obsidian: ['./obsidian-stub.d.ts'] },
			},
		);
		runTsc(configName);
	}

	await writeFile(path.join(consumerRoot, 'positive.ts'), `
import type {
	RuntimeHealthV1,
	StructuredErrorV1,
	TaskGetRequestV1,
	TaskGetResultV1,
} from 'operon-cli/contracts/v1';
import type {
	DeveloperMutationPreviewInputV1,
	OperonDeveloperApiAccessRequestV1,
	OperonDeveloperApiAccessResultV1,
	OperonDeveloperApiV1,
} from 'operon-cli/contracts/v1/developer-api';
import type {
	CliInvocationV1,
	CliResultEnvelopeV1,
} from 'operon-cli/contracts/v1/cli';

declare const health: RuntimeHealthV1;
declare const request: TaskGetRequestV1;
declare const result: TaskGetResultV1;
declare const error: StructuredErrorV1;
declare const accessRequest: OperonDeveloperApiAccessRequestV1;
declare const accessResult: OperonDeveloperApiAccessResultV1;
declare const api: OperonDeveloperApiV1;
declare const target: import('operon-cli/contracts/v1').ExactMutationTargetV1;
declare const inlineTarget: import('operon-cli/contracts/v1').ExactMutationTargetV1 & {
	locator: import('operon-cli/contracts/v1').InlineTaskSourceLocatorV1;
};
const mutationPreviews: DeveloperMutationPreviewInputV1[] = [
	{ capability: 'tasks.create.preview', mutationKind: 'task.create', spec: { operation: 'create', items: [] } },
	{ capability: 'tasks.update.preview', mutationKind: 'task.update', target, spec: { operation: 'update', changes: [] } },
	{ capability: 'tasks.update.preview', mutationKind: 'task.update', spec: { operation: 'update-batch', items: [] } },
	{ capability: 'tasks.recurrence.preview', mutationKind: 'task.recurrence', target, spec: { operation: 'update-recurrence', scope: 'this-task', changes: [] } },
	{ capability: 'tasks.relationship.preview', mutationKind: 'task.relationship', target, spec: { operation: 'replace-relationships', changes: [] } },
	{ capability: 'tasks.reminder.preview', mutationKind: 'task.reminder-item', target, spec: { operation: 'remove', collection: 'reminderRules', itemId: 'r1' } },
	{ capability: 'tasks.transition.preview', mutationKind: 'task.transition', target, spec: { operation: 'transition', targetStatusId: 'done' } },
	{ capability: 'tasks.pinned.preview', mutationKind: 'task.pinned-state', target, spec: { operation: 'set-pinned', pinned: true } },
	{ capability: 'timers.control.preview', mutationKind: 'timer.control', spec: { operation: 'start' } },
	{ capability: 'timers.session.preview', mutationKind: 'timer.session', target, spec: { operation: 'add-session' } },
	{ capability: 'tasks.convert.preview', mutationKind: 'task.convert', target, spec: { operation: 'convert', from: 'inline', to: 'file', templateId: 'default' } },
	{ capability: 'tasks.inline.relocate.preview', mutationKind: 'task.inline-relocate', target: inlineTarget, spec: { operation: 'relocate-inline', destination: { locator: inlineTarget.locator, mustBeBlank: true } } },
	{ capability: 'tasks.delete.preview', mutationKind: 'task.delete', target, spec: { operation: 'delete', mode: 'delete-exact-task', cascade: false } },
];
declare const invocation: CliInvocationV1;
declare const envelope: CliResultEnvelopeV1;

void [
	health,
	request,
	result,
	error,
	accessRequest,
	accessResult,
	api,
	mutationPreviews,
	invocation,
	envelope,
];
`, 'utf8');

	for (const compiler of [
		{ name: 'nodenext', module: 'NodeNext', moduleResolution: 'NodeNext' },
		{ name: 'bundler', module: 'ESNext', moduleResolution: 'Bundler' },
		{ name: 'typesversions', module: 'ESNext', moduleResolution: 'node' },
	]) {
		const configName = `tsconfig.${compiler.name}.json`;
		await writeCompilerConfig(configName, compiler, ['positive.ts']);
		runTsc(configName);
	}

	const negativeCases = [
		{
			name: 'developer-capability-kind-mismatch',
			source: "import type { DeveloperMutationPreviewInputV1 } from 'operon-cli/contracts/v1/developer-api';\nconst value: DeveloperMutationPreviewInputV1 = { capability: 'tasks.delete.preview', mutationKind: 'task.update', spec: { operation: 'update-batch', items: [] } };\nvoid value;\n",
			marker: 'DeveloperMutationPreviewInputV1',
		},
		{
			name: 'developer-target-required',
			source: "import type { DeveloperMutationPreviewInputV1 } from 'operon-cli/contracts/v1/developer-api';\nconst value: DeveloperMutationPreviewInputV1 = { capability: 'tasks.update.preview', mutationKind: 'task.update', spec: { operation: 'update', changes: [] } };\nvoid value;\n",
			marker: 'DeveloperMutationPreviewInputV1',
		},
		{
			name: 'developer-spec-kind-mismatch',
			source: "import type { DeveloperMutationPreviewInputV1 } from 'operon-cli/contracts/v1/developer-api';\ndeclare const target: import('operon-cli/contracts/v1').ExactMutationTargetV1;\nconst value: DeveloperMutationPreviewInputV1 = { capability: 'tasks.update.preview', mutationKind: 'task.update', target, spec: { operation: 'transition', targetStatusId: 'done' } };\nvoid value;\n",
			marker: 'DeveloperMutationPreviewInputV1',
		},
		{
			name: 'developer-create-target-forbidden',
			source: "import type { DeveloperMutationPreviewInputV1 } from 'operon-cli/contracts/v1/developer-api';\ndeclare const target: import('operon-cli/contracts/v1').ExactMutationTargetV1;\nconst value: DeveloperMutationPreviewInputV1 = { capability: 'tasks.create.preview', mutationKind: 'task.create', target, spec: { operation: 'create', items: [] } };\nvoid value;\n",
			marker: 'DeveloperMutationPreviewInputV1',
		},
		{
			name: 'developer-batch-target-forbidden',
			source: "import type { DeveloperMutationPreviewInputV1 } from 'operon-cli/contracts/v1/developer-api';\ndeclare const target: import('operon-cli/contracts/v1').ExactMutationTargetV1;\nconst value: DeveloperMutationPreviewInputV1 = { capability: 'tasks.update.preview', mutationKind: 'task.update', target, spec: { operation: 'update-batch', items: [] } };\nvoid value;\n",
			marker: 'DeveloperMutationPreviewInputV1',
		},
		{
			name: 'runtime-value-contract',
			source: "import { CONTRACT_VERSION_V1 } from 'operon-cli/contracts/v1';\nvoid CONTRACT_VERSION_V1;\n",
			marker: 'CONTRACT_VERSION_V1',
		},
		{
			name: 'runtime-value-cli',
			source: "import { CLI_EXIT_CODES_V1 } from 'operon-cli/contracts/v1/cli';\nvoid CLI_EXIT_CODES_V1;\n",
			marker: 'CLI_EXIT_CODES_V1',
		},
		{
			name: 'removed-capture-contract',
			source: "import type { CaptureAgentRequestV1 } from 'operon-cli/contracts/v1/capture-agent';\ndeclare const value: CaptureAgentRequestV1;\nvoid value;\n",
			marker: 'capture-agent',
		},
		{
			name: 'private-source',
			source: "import type { JsonValue } from 'operon-cli/src/agent-runtime/contracts/v1/primitives';\ndeclare const value: JsonValue;\nvoid value;\n",
			marker: 'operon-cli/src/agent-runtime/contracts/v1/primitives',
		},
		{
			name: 'private-declaration',
			source: "import type { JsonValue } from 'operon-cli/types/src/agent-runtime/contracts/v1/primitives';\ndeclare const value: JsonValue;\nvoid value;\n",
			marker: 'operon-cli/types/src/agent-runtime/contracts/v1/primitives',
		},
		{
			name: 'package-root',
			source: "import type { RuntimeHealthV1 } from 'operon-cli';\ndeclare const value: RuntimeHealthV1;\nvoid value;\n",
			marker: 'operon-cli',
		},
	];
	for (const negativeCase of negativeCases) {
		const sourceName = `negative-${negativeCase.name}.ts`;
		await writeFile(path.join(consumerRoot, sourceName), negativeCase.source, 'utf8');
		for (const compiler of [
			{ name: 'nodenext', module: 'NodeNext', moduleResolution: 'NodeNext' },
			{ name: 'bundler', module: 'ESNext', moduleResolution: 'Bundler' },
			{ name: 'typesversions', module: 'ESNext', moduleResolution: 'node' },
		]) {
			const configName = `tsconfig.negative-${negativeCase.name}-${compiler.name}.json`;
			await writeCompilerConfig(configName, compiler, [sourceName]);
			const result = runTsc(configName, { expectFailure: true });
			assert.match(
				`${result.stdout}\n${result.stderr}`,
				new RegExp(escapeRegExp(negativeCase.marker), 'u'),
				`Negative compile did not report the rejected symbol: ${negativeCase.name}/${compiler.name}`,
			);
		}
	}

	for (const specifier of [
		'operon-cli',
		'operon-cli/contracts/v1',
		'operon-cli/contracts/v1/developer-api',
		'operon-cli/contracts/v1/cli',
		'operon-cli/contracts/v1/capture-agent',
		'operon-cli/src/agent-runtime/contracts/v1/primitives',
	]) {
		const importResult = run(
			process.execPath,
			[
				'--input-type=module',
				'--eval',
				`await import(${JSON.stringify(specifier)});`,
			],
			{ cwd: consumerRoot, expectFailure: true },
		);
		assert.match(
			`${importResult.stdout}\n${importResult.stderr}`,
			/ERR_PACKAGE_PATH_NOT_EXPORTED/u,
			`Runtime ESM import must be closed: ${specifier}`,
		);
		const requireResult = run(
			process.execPath,
			[
				'--input-type=commonjs',
				'--eval',
				`require(${JSON.stringify(specifier)});`,
			],
			{ cwd: consumerRoot, expectFailure: true },
		);
		assert.match(
			`${requireResult.stdout}\n${requireResult.stderr}`,
			/ERR_PACKAGE_PATH_NOT_EXPORTED/u,
			`Runtime CommonJS require must be closed: ${specifier}`,
		);
	}

	process.stdout.write(`${JSON.stringify({
		status: 'ok',
		package: `${packResult.name}@${packResult.version}`,
		tarballBytes: packResult.size,
		declarationFiles: sourceTypes.length,
		declarationBytes: sourceTypes.reduce((sum, file) => sum + file.size, 0),
		compilers: ['NodeNext', 'Bundler', 'typesVersions'],
	})}\n`);
} finally {
	await rm(temporaryRoot, { recursive: true, force: true });
}

async function writeCompilerConfig(fileName, compiler, files, extraCompilerOptions = {}) {
	await writeFile(
		path.join(consumerRoot, fileName),
		`${JSON.stringify({
			compilerOptions: {
				target: 'ES2020',
				module: compiler.module,
				moduleResolution: compiler.moduleResolution,
				lib: ['ES2020', 'DOM'],
				types: [],
				strict: true,
				noEmit: true,
				skipLibCheck: false,
				verbatimModuleSyntax: true,
				...extraCompilerOptions,
			},
			files,
		}, null, 2)}\n`,
		'utf8',
	);
}

function runTsc(configName, options = {}) {
	return run(
		process.execPath,
		[tscPath, '--project', configName, '--pretty', 'false'],
		{ cwd: consumerRoot, expectFailure: options.expectFailure },
	);
}

function runJson(command, args, options = {}) {
	const result = run(command, args, options);
	return JSON.parse(result.stdout);
}

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: options.cwd,
		encoding: 'utf8',
		env: cleanEnvironment,
	});
	if (result.error) throw result.error;
	if (options.expectFailure) {
		assert.notEqual(
			result.status,
			0,
			`Command unexpectedly succeeded: ${command} ${args.join(' ')}`,
		);
	} else if (result.status !== 0) {
		throw new Error([
			`Command failed (${result.status}): ${command} ${args.join(' ')}`,
			result.stdout,
			result.stderr,
		].filter(Boolean).join('\n'));
	}
	return result;
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

async function snapshotDeclarationTree(root) {
	const files = [];
	await walk(root, '');
	return files.sort((left, right) => left.path.localeCompare(right.path));

	async function walk(directory, relativeDirectory) {
		const entries = await readdir(directory, { withFileTypes: true });
		entries.sort((left, right) => left.name.localeCompare(right.name));
		for (const entry of entries) {
			const relativePath = relativeDirectory
				? path.posix.join(relativeDirectory, entry.name)
				: entry.name;
			if (entry.isDirectory()) {
				await walk(path.join(directory, entry.name), relativePath);
				continue;
			}
			assert.ok(entry.isFile(), `Non-file type artifact is forbidden: ${relativePath}`);
			assert.ok(relativePath.endsWith('.d.ts'), `Runtime artifact leaked into types: ${relativePath}`);
			const bytes = await readFile(path.join(directory, entry.name));
			files.push({
				path: relativePath,
				size: bytes.length,
				sha256: createHash('sha256').update(bytes).digest('hex'),
			});
		}
	}
}
