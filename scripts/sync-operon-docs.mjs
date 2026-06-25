import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const vaultRoot = path.resolve(repoRoot, '..', '..', '..');

const sourceDir = path.join(vaultRoot, 'Operon', 'Operon Docs Source');
const targetDir = path.join(repoRoot, 'docs', 'operon-docs');
const manifestPath = path.join(targetDir, 'manifest.json');

const managedDocPattern = /^DOCS-\d{3} .+\.md$/;

async function pathExists(targetPath) {
	try {
		await fs.access(targetPath, fsConstants.F_OK);
		return true;
	} catch {
		return false;
	}
}

async function readManagedDocs() {
	const entries = await fs.readdir(sourceDir, { withFileTypes: true });
	const docs = entries
		.filter(entry => entry.isFile() && managedDocPattern.test(entry.name))
		.map(entry => entry.name)
		.sort((a, b) => a.localeCompare(b, 'en'));

	if (docs.length === 0) {
		throw new Error(`No DOCS-*.md files found in ${sourceDir}`);
	}

	return docs;
}

async function clearManagedTargetFiles() {
	await fs.mkdir(targetDir, { recursive: true });
	const entries = await fs.readdir(targetDir, { withFileTypes: true });

	await Promise.all(entries.map(async entry => {
		if (!entry.isFile()) return;
		if (managedDocPattern.test(entry.name) || entry.name === 'manifest.json') {
			await fs.unlink(path.join(targetDir, entry.name));
		}
	}));
}

function buildFileRecord(fileName, contents) {
	return {
		path: fileName,
		sha256: createHash('sha256').update(contents).digest('hex'),
		bytes: contents.byteLength,
	};
}

async function syncDocs() {
	const docs = await readManagedDocs();
	await clearManagedTargetFiles();

	const files = [];
	for (const fileName of docs) {
		const sourcePath = path.join(sourceDir, fileName);
		const targetPath = path.join(targetDir, fileName);
		const contents = await fs.readFile(sourcePath);
		await fs.writeFile(targetPath, contents);
		files.push(buildFileRecord(fileName, contents));
	}

	const manifest = {
		schemaVersion: 1,
		packageId: 'operon-docs',
		generatedAt: new Date().toISOString(),
		source: {
			branch: 'main',
			docsBasePath: 'docs/operon-docs',
			mediaBasePath: 'docs/media',
		},
		files,
	};

	await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

	console.log(`Synced ${files.length} Operon docs to ${path.relative(repoRoot, targetDir)}`);
	console.log(`Wrote ${path.relative(repoRoot, manifestPath)}`);
}

if (!(await pathExists(sourceDir))) {
	throw new Error(`Missing source directory: ${sourceDir}`);
}

await syncDocs();
