import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const bundlePath = path.join(os.tmpdir(), `operon-docs-sync-${process.pid}-${Date.now()}.mjs`);

await build({
	entryPoints: [path.join(rootDir, 'src/systems/operon-docs-sync.ts')],
	bundle: true,
	format: 'esm',
	platform: 'node',
	outfile: bundlePath,
	logLevel: 'silent',
});

const docsSync = await import(pathToFileURL(bundlePath).href);

function hashText(text) {
	return createHash('sha256').update(text).digest('hex');
}

function buildManifest(docs) {
	return {
		schemaVersion: 1,
		packageId: 'operon-docs',
		generatedAt: '2026-06-25T12:00:00.000Z',
		source: {
			branch: 'main',
			docsBasePath: 'docs/operon-docs',
			mediaBasePath: 'docs/media',
		},
		files: Object.entries(docs)
			.map(([docPath, content]) => ({
				path: docPath,
				sha256: hashText(content),
				bytes: Buffer.byteLength(content),
			}))
			.sort((left, right) => left.path.localeCompare(right.path, 'en')),
	};
}

function createMemoryAdapter() {
	const files = new Map();
	const folders = new Set();
	const writes = [];
	let renameCount = 0;
	let failRenameAt = null;
	const normalize = (value) => value.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
	const adapter = {
		async exists(targetPath) {
			const normalized = normalize(targetPath);
			return files.has(normalized) || folders.has(normalized);
		},
		async read(targetPath) {
			const normalized = normalize(targetPath);
			if (!files.has(normalized)) throw new Error(`Missing file: ${normalized}`);
			return files.get(normalized);
		},
		async write(targetPath, data) {
			const normalized = normalize(targetPath);
			files.set(normalized, data);
			writes.push(normalized);
		},
		async remove(targetPath) {
			files.delete(normalize(targetPath));
		},
		async mkdir(targetPath) {
			folders.add(normalize(targetPath));
		},
		async rename(oldPath, newPath) {
			renameCount += 1;
			if (failRenameAt === renameCount) {
				throw new Error(`Forced rename failure: ${oldPath}`);
			}
			const oldNormalized = normalize(oldPath);
			const newNormalized = normalize(newPath);
			if (!files.has(oldNormalized)) throw new Error(`Missing file: ${oldNormalized}`);
			if (files.has(newNormalized)) throw new Error(`Destination exists: ${newNormalized}`);
			files.set(newNormalized, files.get(oldNormalized));
			files.delete(oldNormalized);
			const pendingWriteIndex = writes.lastIndexOf(oldNormalized);
			if (pendingWriteIndex >= 0) writes[pendingWriteIndex] = newNormalized;
		},
	};
	return {
		adapter,
		files,
		folders,
		writes,
		failRenameAt: (count) => {
			failRenameAt = renameCount + count;
		},
	};
}

function createRequestText(docs, manifestOverride = null) {
	return async (url) => {
		if (url === docsSync.OPERON_DOCS_MANIFEST_URL) {
			return JSON.stringify(manifestOverride ?? buildManifest(docs));
		}
		for (const [docPath, content] of Object.entries(docs)) {
			if (url === docsSync.buildOperonDocsRawFileUrl(docPath)) {
				return content;
			}
		}
		throw new Error(`Unexpected URL: ${url}`);
	};
}

async function runSync(memory, docs, manifestOverride = null, keyMappings = [], targetRoot = undefined) {
	return docsSync.syncOperonDocs({
		app: {
			vault: {
				configDir: '.obsidian',
				adapter: memory.adapter,
			},
		},
		requestText: createRequestText(docs, manifestOverride),
		keyMappings,
		targetRoot,
		hashText: async (text) => hashText(text),
		now: () => new Date('2026-06-25T12:30:00.000Z'),
	});
}

function readState(memory) {
	return JSON.parse(memory.files.get('.obsidian/plugins/operon/state/docs-sync.json'));
}

async function test(name, fn) {
	try {
		await fn();
		console.log(`PASS ${name}`);
	} catch (error) {
		console.error(`FAIL ${name}`);
		throw error;
	}
}

const sourceDocOne = [
	'---',
	'Up:',
	'  - "[[DOCS-001 Operon Docs MOC|Operon Docs MOC]]"',
	'Notes: Root index and reading path',
	'Icon: book-open',
	'Color: "#334155"',
	'tags:',
	'  - operon',
	'  - start',
	'Updated: 2026-06-25T16:47:21',
	'---',
	'',
	'# Operon Docs',
	'',
	'Body mention stays as Up: and MEDIA-DOCS-001-1.',
	'',
	'```yaml',
	'Up:',
	'  - "[[Literal example]]"',
	'Updated: keep-literal',
	'```',
	'',
].join('\n');

const localizedDefaultDocOne = [
	'---',
	'contexts:',
	'  - "[[DOCS-001 Operon Docs MOC|Operon Docs MOC]]"',
	'note: Root index and reading path',
	'taskIcon: book-open',
	'taskColor: "#334155"',
	'tags:',
	'  - operon',
	'  - start',
	'datetimeModified: 2026-06-25T16:47:21',
	'---',
	'',
	'# Operon Docs',
	'',
	'Body mention stays as Up: and MEDIA-DOCS-001-1.',
	'',
	'```yaml',
	'Up:',
	'  - "[[Literal example]]"',
	'Updated: keep-literal',
	'```',
	'',
].join('\n');

const customMappings = [
	{ canonicalKey: 'contexts', visiblePropertyName: 'Project Up' },
	{ canonicalKey: 'note', visiblePropertyName: 'Doc Note' },
	{ canonicalKey: 'taskIcon', visiblePropertyName: 'Doc Icon' },
	{ canonicalKey: 'taskColor', visiblePropertyName: 'Doc Color' },
	{ canonicalKey: 'datetimeModified', visiblePropertyName: 'Doc Updated' },
	{ canonicalKey: 'tags', visiblePropertyName: 'Custom Tags' },
];

const localizedCustomDocOne = [
	'---',
	'Project Up:',
	'  - "[[DOCS-001 Operon Docs MOC|Operon Docs MOC]]"',
	'Doc Note: Root index and reading path',
	'Doc Icon: book-open',
	'Doc Color: "#334155"',
	'tags:',
	'  - operon',
	'  - start',
	'Doc Updated: 2026-06-25T16:47:21',
	'---',
	'',
	'# Operon Docs',
	'',
	'Body mention stays as Up: and MEDIA-DOCS-001-1.',
	'',
	'```yaml',
	'Up:',
	'  - "[[Literal example]]"',
	'Updated: keep-literal',
	'```',
	'',
].join('\n');

const baseDocs = {
	'DOCS-001 Operon Docs MOC.md': sourceDocOne,
	'DOCS-002 How to use these docs.md': '# How to use these docs\n',
};

await test('initial sync writes docs and state', async () => {
	const memory = createMemoryAdapter();
	const result = await runSync(memory, baseDocs);
	assert.equal(result.written.length, 2);
	assert.equal(result.skipped.length, 0);
	assert.equal(memory.files.get('Operon/Docs/DOCS-001 Operon Docs MOC.md'), localizedDefaultDocOne);
	assert.ok(memory.files.has('.obsidian/plugins/operon/state/docs-sync.json'));
});

await test('second sync skips matching docs', async () => {
	const memory = createMemoryAdapter();
	await runSync(memory, baseDocs);
	memory.writes.length = 0;
	const result = await runSync(memory, baseDocs);
	assert.equal(result.written.length, 0);
	assert.equal(result.skipped.length, 2);
	assert.equal(memory.writes.length, 1);
	assert.ok(memory.writes[0].startsWith('.obsidian/plugins/operon/state/docs-sync.json'));
});

await test('custom target root is used for docs and state', async () => {
	const memory = createMemoryAdapter();
	const result = await runSync(memory, baseDocs, null, [], 'Guides/Operon');
	assert.equal(result.targetRoot, 'Guides/Operon');
	assert.ok(memory.files.has('Guides/Operon/DOCS-001 Operon Docs MOC.md'));
	assert.equal(readState(memory).files['DOCS-001 Operon Docs MOC.md'].targetPath, 'Guides/Operon/DOCS-001 Operon Docs MOC.md');
});

await test('managed docs move without touching personal files and can roll back', async () => {
	const memory = createMemoryAdapter();
	await runSync(memory, baseDocs);
	memory.files.set('Operon/Docs/Personal note.md', 'keep me');
	const preview = await docsSync.previewOperonDocsFolderMove({
		app: { vault: { configDir: '.obsidian', adapter: memory.adapter } },
		oldRoot: 'Operon/Docs',
		newRoot: 'Guides/Operon',
	});
	assert.equal(preview.files.length, 2);
	const transaction = await docsSync.moveOperonDocsFolder({
		app: { vault: { configDir: '.obsidian', adapter: memory.adapter } },
	}, preview);
	assert.ok(memory.files.has('Guides/Operon/DOCS-001 Operon Docs MOC.md'));
	assert.ok(memory.files.has('Operon/Docs/Personal note.md'));
	assert.equal(readState(memory).files['DOCS-001 Operon Docs MOC.md'].targetPath, 'Guides/Operon/DOCS-001 Operon Docs MOC.md');
	await transaction.rollback();
	assert.ok(memory.files.has('Operon/Docs/DOCS-001 Operon Docs MOC.md'));
	assert.equal(readState(memory).files['DOCS-001 Operon Docs MOC.md'].targetPath, 'Operon/Docs/DOCS-001 Operon Docs MOC.md');
});

await test('folder move aborts before rename when a destination file exists', async () => {
	const memory = createMemoryAdapter();
	await runSync(memory, baseDocs);
	memory.files.set('Guides/Operon/DOCS-001 Operon Docs MOC.md', 'existing');
	const preview = await docsSync.previewOperonDocsFolderMove({
		app: { vault: { configDir: '.obsidian', adapter: memory.adapter } },
		oldRoot: 'Operon/Docs',
		newRoot: 'Guides/Operon',
	});
	await assert.rejects(
		() => docsSync.moveOperonDocsFolder({ app: { vault: { configDir: '.obsidian', adapter: memory.adapter } } }, preview),
		/destination conflict/u,
	);
	assert.ok(memory.files.has('Operon/Docs/DOCS-001 Operon Docs MOC.md'));
	assert.ok(memory.files.has('Operon/Docs/DOCS-002 How to use these docs.md'));
});

await test('folder move rolls back files after a later rename fails', async () => {
	const memory = createMemoryAdapter();
	await runSync(memory, baseDocs);
	memory.failRenameAt(2);
	const preview = await docsSync.previewOperonDocsFolderMove({
		app: { vault: { configDir: '.obsidian', adapter: memory.adapter } },
		oldRoot: 'Operon/Docs',
		newRoot: 'Guides/Operon',
	});
	await assert.rejects(
		() => docsSync.moveOperonDocsFolder({ app: { vault: { configDir: '.obsidian', adapter: memory.adapter } } }, preview),
		/Forced rename failure/u,
	);
	assert.ok(memory.files.has('Operon/Docs/DOCS-001 Operon Docs MOC.md'));
	assert.ok(memory.files.has('Operon/Docs/DOCS-002 How to use these docs.md'));
});

await test('local managed edit is overwritten', async () => {
	const memory = createMemoryAdapter();
	await runSync(memory, baseDocs);
	memory.files.set('Operon/Docs/DOCS-001 Operon Docs MOC.md', 'local edit');
	const result = await runSync(memory, baseDocs);
	assert.deepEqual(result.written.map((file) => file.reason), ['local-edited']);
	assert.equal(memory.files.get('Operon/Docs/DOCS-001 Operon Docs MOC.md'), localizedDefaultDocOne);
});

await test('default localization rewrites only top-level frontmatter keys', async () => {
	const memory = createMemoryAdapter();
	const result = await runSync(memory, baseDocs);
	assert.equal(result.warnings.length, 0);
	const content = memory.files.get('Operon/Docs/DOCS-001 Operon Docs MOC.md');
	assert.equal(content, localizedDefaultDocOne);
	assert.ok(content.includes('Body mention stays as Up: and MEDIA-DOCS-001-1.'));
	assert.ok(content.includes('```yaml\nUp:\n  - "[[Literal example]]"\nUpdated: keep-literal\n```'));
});

await test('custom localization uses user visible property names and keeps tags stable', async () => {
	const memory = createMemoryAdapter();
	await runSync(memory, baseDocs, null, customMappings);
	const content = memory.files.get('Operon/Docs/DOCS-001 Operon Docs MOC.md');
	assert.equal(content, localizedCustomDocOne);
	assert.ok(content.includes('\ntags:\n  - operon\n'));
	assert.equal(content.includes('Custom Tags:'), false);
});

await test('state keeps remote source hash separate from localized local hash', async () => {
	const memory = createMemoryAdapter();
	await runSync(memory, baseDocs, null, customMappings);
	const state = readState(memory);
	const entry = state.files['DOCS-001 Operon Docs MOC.md'];
	assert.equal(entry.sourceSha256, hashText(sourceDocOne));
	assert.equal(entry.sourceBytes, Buffer.byteLength(sourceDocOne));
	assert.equal(entry.localSha256, hashText(localizedCustomDocOne));
	assert.equal(entry.localBytes, Buffer.byteLength(localizedCustomDocOne));
	assert.equal(entry.localizationSignature, state.localizationSignature);
	assert.notEqual(entry.sourceSha256, entry.localSha256);
});

await test('key mapping signature changes rewrite managed docs without remote changes', async () => {
	const memory = createMemoryAdapter();
	await runSync(memory, baseDocs);
	memory.writes.length = 0;
	const result = await runSync(memory, baseDocs, null, customMappings);
	assert.equal(result.written.length, 2);
	assert.equal(memory.files.get('Operon/Docs/DOCS-001 Operon Docs MOC.md'), localizedCustomDocOne);
	assert.ok(memory.writes.includes('Operon/Docs/DOCS-001 Operon Docs MOC.md'));
});

await test('non-doc files in target folder are preserved', async () => {
	const memory = createMemoryAdapter();
	memory.files.set('Operon/Docs/Personal note.md', 'keep me');
	await runSync(memory, baseDocs);
	assert.equal(memory.files.get('Operon/Docs/Personal note.md'), 'keep me');
});

await test('invalid manifest path is rejected before writing docs', async () => {
	const memory = createMemoryAdapter();
	const invalidManifest = buildManifest(baseDocs);
	invalidManifest.files[0].path = '../escape.md';
	await assert.rejects(() => runSync(memory, baseDocs, invalidManifest), /Unsafe Operon docs manifest path/u);
	assert.equal(memory.files.has('Operon/Docs/../escape.md'), false);
	assert.equal(memory.folders.has('Operon/Docs'), false);
});

await test('download hash mismatch is rejected before writing docs', async () => {
	const memory = createMemoryAdapter();
	const invalidManifest = buildManifest(baseDocs);
	invalidManifest.files[0].sha256 = '0'.repeat(64);
	await assert.rejects(() => runSync(memory, baseDocs, invalidManifest), /hash mismatch/u);
	assert.equal(memory.files.has('Operon/Docs/DOCS-001 Operon Docs MOC.md'), false);
	assert.equal(memory.folders.has('Operon/Docs'), false);
});

await test('manifest removals are reported as stale but not deleted', async () => {
	const memory = createMemoryAdapter();
	await runSync(memory, baseDocs);
	const reducedDocs = {
		'DOCS-001 Operon Docs MOC.md': baseDocs['DOCS-001 Operon Docs MOC.md'],
	};
	const result = await runSync(memory, reducedDocs);
	assert.deepEqual(result.staleManagedFiles, ['DOCS-002 How to use these docs.md']);
	assert.equal(memory.files.get('Operon/Docs/DOCS-002 How to use these docs.md'), baseDocs['DOCS-002 How to use these docs.md']);
});

await test('frontmatter key collisions fall back and warn when canonical also exists', async () => {
	const memory = createMemoryAdapter();
	const collisionDocs = {
		'DOCS-003 Collision case.md': '---\nUp:\n  - "[[A]]"\nNotes: source note\ncontexts: existing canonical\n---\n\nBody Up: unchanged\n',
	};
	const collisionMappings = [
		{ canonicalKey: 'contexts', visiblePropertyName: 'Notes' },
		{ canonicalKey: 'note', visiblePropertyName: 'Doc Note' },
	];
	const result = await runSync(memory, collisionDocs, null, collisionMappings);
	const content = memory.files.get('Operon/Docs/DOCS-003 Collision case.md');
	assert.ok(content.startsWith('---\nUp:\n  - "[[A]]"\nDoc Note: source note\ncontexts: existing canonical\n---'));
	assert.equal(result.warnings.length, 1);
	assert.equal(result.warnings[0].reason, 'frontmatter-key-collision');
	assert.equal(result.warnings[0].sourceKey, 'Up');
	assert.equal(result.warnings[0].preferredKey, 'Notes');
	assert.equal(result.warnings[0].canonicalKey, 'contexts');
});

await fs.rm(bundlePath, { force: true });
console.log('Operon docs sync tests passed.');
