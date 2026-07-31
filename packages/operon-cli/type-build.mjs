import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
	copyFile,
	mkdtemp,
	mkdir,
	readFile,
	readdir,
	rename,
	rm,
	writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const packageRoot = path.dirname(scriptPath);
const pluginRoot = path.resolve(packageRoot, '../..');
const configPath = path.join(packageRoot, 'tsconfig.types.json');
const targetRoot = path.join(packageRoot, 'types');
const declarationEntrypoints = [
	'src/agent-runtime/public/v1/index.d.ts',
	'src/agent-runtime/public/v1/developer-api.d.ts',
	'src/agent-runtime/public/v1/cli.d.ts',
];

export async function buildContractTypesV1(options = {}) {
	const mode = options.mode ?? 'check';
	if (mode !== 'check' && mode !== 'write') {
		throw new Error('OPERON_CLI_TYPE_BUILD_MODE_INVALID');
	}
	const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'operon-cli-types-'));
	const generatedRoot = path.join(temporaryRoot, 'types');
	try {
		compileDeclarations(generatedRoot);
		await normalizeDeclarationImports(generatedRoot);
		await copyFile(
			path.join(packageRoot, 'type-source', 'not-exported.d.ts'),
			path.join(generatedRoot, 'not-exported.d.ts'),
		);
		const generatedFiles = await listFiles(generatedRoot);
		assert.ok(generatedFiles.length > 0, 'No public TypeScript declarations were generated.');
		assert.ok(
			generatedFiles.every(file => file.endsWith('.d.ts')),
			'The public type artifact must contain declarations only.',
		);
		for (const entrypoint of declarationEntrypoints) {
			assert.ok(generatedFiles.includes(entrypoint), `Missing public type entrypoint: ${entrypoint}`);
		}
		await validateDeclarationBoundary(generatedRoot, generatedFiles);
		if (mode === 'check') {
			await assertTreesEqual(generatedRoot, targetRoot);
			return Object.freeze({ mode, files: generatedFiles.length });
		}
		await rm(targetRoot, { recursive: true, force: true });
		await mkdir(path.dirname(targetRoot), { recursive: true });
		await rename(generatedRoot, targetRoot);
		return Object.freeze({ mode, files: generatedFiles.length });
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
}

function compileDeclarations(outDir) {
	const require = createRequire(import.meta.url);
	const tscPath = require.resolve('typescript/bin/tsc');
	const result = spawnSync(
		process.execPath,
		[tscPath, '--project', configPath, '--outDir', outDir],
		{
			cwd: pluginRoot,
			encoding: 'utf8',
			env: {
				...process.env,
				NO_COLOR: '1',
			},
		},
	);
	if (result.error) throw result.error;
	if (result.status !== 0) {
		const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
		throw new Error(`OPERON_CLI_TYPE_DECLARATION_BUILD_FAILED\n${output}`);
	}
}

async function validateDeclarationBoundary(root, files) {
	const forbiddenContent = [
		/\bfrom\s+['"](?:obsidian|electron|node:)/u,
		/\bsrc\/agent-runtime\/runtime\//u,
		/\bpackages\/operon-cli\/src\//u,
		/\bscripts\/agent-runtime\//u,
		new RegExp(escapeRegExp(pluginRoot), 'u'),
	];
	for (const file of files) {
		const content = await readFile(path.join(root, file), 'utf8');
		for (const pattern of forbiddenContent) {
			assert.ok(!pattern.test(content), `Private or host declaration leaked into ${file}: ${pattern}`);
		}
		if (declarationEntrypoints.includes(file)) {
			assert.doesNotMatch(
				content,
				/^export\s+(?:declare\s+)?(?:const|let|var|function|class|enum)\b|^export\s*\{(?!\s*\}\s*;)/mu,
				`Public type entrypoint exposes a runtime value: ${file}`,
			);
		}
	}
}

async function normalizeDeclarationImports(root) {
	for (const file of await listFiles(root)) {
		const absolutePath = path.join(root, file);
		const source = await readFile(absolutePath, 'utf8');
		const normalized = source
			.replace(
				/(\bfrom\s+['"])(\.\.?\/[^'"]+)(['"])/gu,
				(_match, prefix, specifier, suffix) => (
					`${prefix}${withJavaScriptExtension(specifier)}${suffix}`
				),
			)
			.replace(
				/(\bimport\(\s*['"])(\.\.?\/[^'"]+)(['"]\s*\))/gu,
				(_match, prefix, specifier, suffix) => (
					`${prefix}${withJavaScriptExtension(specifier)}${suffix}`
				),
			);
		if (normalized !== source) await writeFile(absolutePath, normalized, 'utf8');
	}
}

function withJavaScriptExtension(specifier) {
	return /\.[a-z0-9]+$/iu.test(specifier) ? specifier : `${specifier}.js`;
}

async function assertTreesEqual(expectedRoot, actualRoot) {
	const expectedFiles = await listFiles(expectedRoot);
	const actualFiles = await listFiles(actualRoot);
	assert.deepEqual(actualFiles, expectedFiles, 'Published TypeScript declaration inventory is stale.');
	for (const file of expectedFiles) {
		assert.deepEqual(
			await readFile(path.join(actualRoot, file)),
			await readFile(path.join(expectedRoot, file)),
			`Published TypeScript declaration is stale: ${file}`,
		);
	}
}

async function listFiles(root) {
	const output = [];
	await walk(root, '');
	return output.sort();

	async function walk(directory, relativeDirectory) {
		const entries = await readdir(directory, { withFileTypes: true });
		entries.sort((left, right) => left.name.localeCompare(right.name));
		for (const entry of entries) {
			const relative = relativeDirectory
				? path.posix.join(relativeDirectory, entry.name)
				: entry.name;
			if (entry.isDirectory()) {
				await walk(path.join(directory, entry.name), relative);
				continue;
			}
			assert.ok(entry.isFile(), `Non-file declaration artifact is forbidden: ${relative}`);
			output.push(relative);
		}
	}
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

if (path.resolve(process.argv[1] ?? '') === scriptPath) {
	const mode = process.argv[2];
	if (mode === '--write') await buildContractTypesV1({ mode: 'write' });
	else if (mode === '--check') await buildContractTypesV1({ mode: 'check' });
	else throw new Error('Usage: type-build.mjs --write|--check');
}
