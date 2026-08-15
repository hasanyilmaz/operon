import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const pluginRoot = path.resolve(path.dirname(scriptPath), '..');
const generatedRoot = path.join(pluginRoot, 'docs', 'operon-docs');
const mediaRoot = path.join(pluginRoot, 'docs', 'media');
const managedPattern = /^DOCS-(\d{3}) .+\.md$/u;

function sha256(contents) {
	return createHash('sha256').update(contents).digest('hex');
}

async function managedFiles(root) {
	return (await readdir(root))
		.filter(file => managedPattern.test(file))
		.sort((left, right) => left.localeCompare(right, 'en'));
}

function assertContiguousFiles(files) {
	assert.ok(files.length > 0, 'Docs package must contain at least one DOCS-### Markdown file.');
	const numbers = files.map(file => Number(managedPattern.exec(file)?.[1]));
	assert.equal(new Set(numbers).size, numbers.length, 'DOCS identifiers must be unique.');
	for (let index = 0; index < numbers.length; index += 1) {
		assert.equal(numbers[index], index + 1, 'DOCS identifiers must be contiguous from DOCS-001.');
	}
}

function docTargetFromWikilink(link) {
	const stem = link.replaceAll('\\|', '|').split('|', 1)[0].split('#', 1)[0].trim();
	return stem.startsWith('DOCS-') ? `${stem}.md` : null;
}

async function regularFile(target) {
	try {
		return (await stat(target)).isFile();
	} catch {
		return false;
	}
}

test('generated docs package has contiguous DOCS IDs and an exact manifest', async () => {
	const files = await managedFiles(generatedRoot);
	assertContiguousFiles(files);
	const manifest = JSON.parse(await readFile(path.join(generatedRoot, 'manifest.json'), 'utf8'));
	assert.equal(manifest.schemaVersion, 1);
	assert.equal(manifest.packageId, 'operon-docs');
	assert.match(manifest.generatedAt, /^\d{4}-\d{2}-\d{2}T/u);
	assert.deepEqual(manifest.source, {
		branch: 'main',
		docsBasePath: 'docs/operon-docs',
		mediaBasePath: 'docs/media',
	});
	assert.equal(manifest.files.length, files.length);
	const records = new Map(manifest.files.map(record => [record.path, record]));
	assert.equal(records.size, manifest.files.length, 'Manifest paths must be unique.');
	assert.deepEqual([...records.keys()].sort((a, b) => a.localeCompare(b, 'en')), files);
	for (const file of files) {
		const contents = await readFile(path.join(generatedRoot, file));
		const record = records.get(file);
		assert.ok(record, `${file} is absent from manifest.json.`);
		assert.equal(record.bytes, contents.byteLength, `${file} byte count drifted.`);
		assert.equal(record.sha256, sha256(contents), `${file} hash drifted.`);
	}
});

test('generated DOCS wikilinks and raw media references resolve inside the package', async () => {
	const files = await managedFiles(generatedRoot);
	const fileSet = new Set(files);
	for (const file of files) {
		const source = await readFile(path.join(generatedRoot, file), 'utf8');
		for (const match of source.matchAll(/\[\[([^\]]+)\]\]/gu)) {
			const target = docTargetFromWikilink(match[1]);
			if (target) assert.ok(fileSet.has(target), `${file} links to missing ${target}.`);
		}
		for (const match of source.matchAll(/https:\/\/raw\.githubusercontent\.com\/hasanyilmaz\/operon\/main\/docs\/media\/([^\s)]+)/gu)) {
			const mediaName = decodeURIComponent(match[1]);
			assert.ok(!mediaName.includes('/') && !mediaName.includes('\\'), `${file} has an unsafe media reference.`);
			assert.equal(await regularFile(path.join(mediaRoot, mediaName)), true, `${file} references missing media ${mediaName}.`);
		}
	}
});

test('explicit source root is byte-identical to the generated package', async () => {
	const sourceRoot = process.env.OPERON_DOCS_SOURCE_ROOT;
	if (!sourceRoot) return;
	const resolvedSourceRoot = path.resolve(sourceRoot);
	assert.equal(existsSync(resolvedSourceRoot), true, `OPERON_DOCS_SOURCE_ROOT_NOT_FOUND:${resolvedSourceRoot}`);
	const sourceFiles = await managedFiles(resolvedSourceRoot);
	const generatedFiles = await managedFiles(generatedRoot);
	assert.deepEqual(generatedFiles, sourceFiles);
	for (const file of sourceFiles) {
		assert.deepEqual(
			await readFile(path.join(generatedRoot, file)),
			await readFile(path.join(resolvedSourceRoot, file)),
			`${file} differs from the explicit canonical source.`,
		);
	}
});

export { assertContiguousFiles, docTargetFromWikilink };
