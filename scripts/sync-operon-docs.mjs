import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
export const repoRoot = path.resolve(scriptDir, '..');
const legacySourceDir = path.resolve(repoRoot, '..', '..', '..', 'Operon', 'Operon Docs Source');
export const targetDir = path.join(repoRoot, 'docs', 'operon-docs');

const managedDocPattern = /^DOCS-\d{3} .+\.md$/u;

async function pathExists(targetPath) {
	try {
		await fs.access(targetPath, fsConstants.F_OK);
		return true;
	} catch {
		return false;
	}
}

function sameBuffer(left, right) {
	return left.byteLength === right.byteLength && left.equals(right);
}

function canonicalManifest(manifest) {
	return JSON.stringify({
		schemaVersion: manifest.schemaVersion,
		packageId: manifest.packageId,
		source: manifest.source,
		files: manifest.files,
	});
}

export function parseDocsSyncArguments(argv, options = {}) {
	const environment = options.environment ?? process.env;
	let sourceRoot = environment.OPERON_DOCS_SOURCE_ROOT ?? null;
	for (let index = 0; index < argv.length; index += 1) {
		if (argv[index] !== '--source-root' || index + 1 >= argv.length || argv[index + 1].startsWith('--')) {
			throw new Error('Usage: node scripts/sync-operon-docs.mjs [--source-root <docs-source-directory>]');
		}
		if (sourceRoot !== null) throw new Error('OPERON_DOCS_SOURCE_ROOT_DUPLICATE');
		sourceRoot = argv[index + 1];
		index += 1;
	}
	return Object.freeze({ sourceRoot: sourceRoot ? path.resolve(sourceRoot) : null });
}

export async function resolveSourceDir(options = {}) {
	const requested = options.sourceRoot ?? null;
	if (requested) {
		if (!(await pathExists(requested))) throw new Error(`OPERON_DOCS_SOURCE_ROOT_NOT_FOUND:${requested}`);
		return requested;
	}
	if (await pathExists(legacySourceDir)) return legacySourceDir;
	throw new Error(`OPERON_DOCS_SOURCE_ROOT_REQUIRED: pass --source-root <docs-source-directory> (legacy path unavailable: ${legacySourceDir})`);
}

async function readManagedDocs(sourceDir) {
	const entries = await fs.readdir(sourceDir, { withFileTypes: true });
	const docs = entries
		.filter(entry => entry.isFile() && managedDocPattern.test(entry.name))
		.map(entry => entry.name)
		.sort((a, b) => a.localeCompare(b, 'en'));

	if (docs.length === 0) throw new Error(`No DOCS-*.md files found in ${sourceDir}`);
	return docs;
}

async function removeStaleManagedTargetFiles(destinationDir, sourceDocs) {
	if (!(await pathExists(destinationDir))) return [];
	const expected = new Set(sourceDocs);
	const entries = await fs.readdir(destinationDir, { withFileTypes: true });
	const stale = entries
		.filter(entry => entry.isFile() && managedDocPattern.test(entry.name) && !expected.has(entry.name))
		.map(entry => entry.name);
	await Promise.all(stale.map(fileName => fs.unlink(path.join(destinationDir, fileName))));
	return stale;
}

function buildFileRecord(fileName, contents) {
	return {
		path: fileName,
		sha256: createHash('sha256').update(contents).digest('hex'),
		bytes: contents.byteLength,
	};
}

async function readExistingManifest(manifestPath) {
	try {
		return JSON.parse(await fs.readFile(manifestPath, 'utf8'));
	} catch {
		return null;
	}
}

export async function syncDocs(options) {
	const sourceDir = path.resolve(options.sourceDir);
	const destinationDir = path.resolve(options.targetDir);
	const docs = await readManagedDocs(sourceDir);
	await fs.mkdir(destinationDir, { recursive: true });
	const staleFiles = await removeStaleManagedTargetFiles(destinationDir, docs);

	const files = [];
	let written = 0;
	for (const fileName of docs) {
		const sourcePath = path.join(sourceDir, fileName);
		const destinationPath = path.join(destinationDir, fileName);
		const contents = await fs.readFile(sourcePath);
		let existing = null;
		try {
			existing = await fs.readFile(destinationPath);
		} catch {
			// A missing target is written below.
		}
		if (!existing || !sameBuffer(existing, contents)) {
			await fs.writeFile(destinationPath, contents);
			written += 1;
		}
		files.push(buildFileRecord(fileName, contents));
	}

	const manifestPath = path.join(destinationDir, 'manifest.json');
	const manifestBase = {
		schemaVersion: 1,
		packageId: 'operon-docs',
		source: {
			branch: 'main',
			docsBasePath: 'docs/operon-docs',
			mediaBasePath: 'docs/media',
		},
		files,
	};
	const existingManifest = await readExistingManifest(manifestPath);
	let manifestWritten = false;
	if (!existingManifest || canonicalManifest(existingManifest) !== canonicalManifest(manifestBase)) {
		await fs.writeFile(manifestPath, `${JSON.stringify({
			...manifestBase,
			generatedAt: (options.now ?? (() => new Date()))().toISOString(),
		}, null, 2)}\n`);
		manifestWritten = true;
	}
	return Object.freeze({
		sourceDir,
		targetDir: destinationDir,
		fileCount: files.length,
		written,
		staleFiles,
		manifestWritten,
	});
}

export async function main(options = {}) {
	const arguments_ = parseDocsSyncArguments(options.argv ?? process.argv.slice(2), options);
	const sourceDir = await resolveSourceDir({ sourceRoot: arguments_.sourceRoot });
	const result = await syncDocs({ sourceDir, targetDir, now: options.now });
	const relativeTarget = path.relative(repoRoot, result.targetDir);
	if (result.written === 0 && result.staleFiles.length === 0 && !result.manifestWritten) {
		console.log(`Operon docs package is already current (${result.fileCount} docs in ${relativeTarget})`);
	} else {
		console.log(`Synced ${result.fileCount} Operon docs to ${relativeTarget}`);
		console.log(`Updated ${result.written} docs, removed ${result.staleFiles.length} stale managed docs, manifest ${result.manifestWritten ? 'rewritten' : 'unchanged'}`);
	}
	return result;
}

if (path.resolve(process.argv[1] ?? '') === scriptPath) await main();
