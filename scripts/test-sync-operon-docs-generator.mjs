import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { parseDocsSyncArguments, syncDocs } from './sync-operon-docs.mjs';

test('generator accepts an explicit source root and preserves a no-op manifest', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'operon-docs-generator-'));
	try {
		const sourceDir = path.join(root, 'source');
		const targetDir = path.join(root, 'target');
		await mkdir(sourceDir, { recursive: true });
		await mkdir(targetDir, { recursive: true });
		await writeFile(path.join(sourceDir, 'DOCS-001 Start.md'), '# Start\n');
		await writeFile(path.join(sourceDir, 'DOCS-002 Continue.md'), '# Continue\n');
		await writeFile(path.join(targetDir, 'DOCS-999 Stale.md'), '# Stale\n');
		const first = await syncDocs({
			sourceDir,
			targetDir,
			now: () => new Date('2026-08-14T12:00:00.000Z'),
		});
		assert.equal(first.written, 2);
		assert.deepEqual(first.staleFiles, ['DOCS-999 Stale.md']);
		assert.equal(first.manifestWritten, true);
		const initialManifest = await readFile(path.join(targetDir, 'manifest.json'), 'utf8');

		const second = await syncDocs({
			sourceDir,
			targetDir,
			now: () => new Date('2026-08-14T13:00:00.000Z'),
		});
		assert.equal(second.written, 0);
		assert.equal(second.manifestWritten, false);
		assert.equal(await readFile(path.join(targetDir, 'manifest.json'), 'utf8'), initialManifest);

		await writeFile(path.join(sourceDir, 'DOCS-002 Continue.md'), '# Changed\n');
		const third = await syncDocs({
			sourceDir,
			targetDir,
			now: () => new Date('2026-08-14T14:00:00.000Z'),
		});
		assert.equal(third.written, 1);
		assert.equal(third.manifestWritten, true);
		assert.notEqual(await readFile(path.join(targetDir, 'manifest.json'), 'utf8'), initialManifest);
		assert.deepEqual(
			parseDocsSyncArguments(['--source-root', sourceDir], { environment: {} }),
			{ sourceRoot: path.resolve(sourceDir) },
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
