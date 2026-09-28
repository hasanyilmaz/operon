import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rename, unlink, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { rankInlineTaskTargets, readInlineTargetHistory, type InlineTargetUsage } from '../src/core/inline-task-targets';
import { InlineTaskTargetHistoryStore } from '../src/storage/inline-task-target-history-store';
import { WriteQueue } from '../src/storage/write-queue';

const early = '2026-09-28T10:00:00.000Z';
const late = '2026-09-28T11:00:00.000Z';
const usage = (filePath: string, count = 1, lastUsedAt = early): InlineTargetUsage => ({ filePath, count, lastUsedAt });
const rank = (extra: Partial<Parameters<typeof rankInlineTaskTargets>[0]> = {}) => rankInlineTaskTargets({
	filePaths: ['Active.md', 'Parent.md', 'Recent1.md', 'Recent2.md', 'Frequent.md', 'Other.md'],
	activeFilePath: 'Active.md', parent: { kind: 'inline-parent', filePath: 'Parent.md', parentTaskId: 'parent' },
	headingKeyword: 'Tasks', history: [usage('Recent1.md', 2, late), usage('Recent2.md', 1, '2026-09-28T10:30:00.000Z'), usage('Frequent.md', 20)], ...extra,
});

test('initial order prioritizes active, parent, two recent files, frequency, and unused files', () => {
	const result = rank();
	assert.deepEqual(result.slice(0, 5).map(row => [row.target.filePath, row.reason]), [
		['Active.md', 'active'], ['Parent.md', 'parent'], ['Recent1.md', 'recent'], ['Recent2.md', 'recent'], ['Frequent.md', 'frequent'],
	]);
	assert.deepEqual(result.slice(5).map(row => row.target.filePath), ['Other.md', 'Parent.md']);
	assert.equal(result.at(-1)?.target.kind, 'file');
});
test('same file deduplicates identical heading placement but preserves distinct parent placement', () => {
	const result = rank({ filePaths: ['Active.md'], history: [usage('Active.md')], parent: { kind: 'file-parent', filePath: 'Active.md', parentTaskId: 'p', headingKeyword: 'Tasks' } });
	assert.equal(result.length, 1);
	assert.equal(result[0].reason, 'active');
	assert.equal(rank({ filePaths: ['Active.md'], parent: { kind: 'file-parent', filePath: 'Active.md', parentTaskId: 'p', headingKeyword: 'Backlog' } }).length, 2);
	assert.equal(rank({ filePaths: ['Active.md'], parent: { kind: 'inline-parent', filePath: 'Active.md', parentTaskId: 'p' } }).length, 2);
});
test('missing, excluded, non-Markdown and unsafe paths leave no blank slots', () => {
	assert.deepEqual(rank({ filePaths: ['Other.md', 'image.png', '../secret.md'], excludedFilePath: 'Other.md' }), []);
	assert.deepEqual(rank({ filePaths: ['Other.md'], activeFilePath: null, parent: null }).map(row => row.reason), ['other']);
});
test('frequency ties use recency then deterministic path order without changing inputs', () => {
	const history = [usage('Z.md', 9), usage('A.md', 9), usage('M.md', 9, late), usage('Top1.md', 1, '2026-09-28T12:00:00.000Z'), usage('Top2.md', 1, '2026-09-28T13:00:00.000Z')];
	const snapshot = JSON.stringify(history);
	const result = rank({ filePaths: history.map(entry => entry.filePath), history, activeFilePath: null, parent: null });
	assert.deepEqual(result.map(row => row.target.filePath), ['Top2.md', 'Top1.md', 'M.md', 'A.md', 'Z.md']);
	assert.equal(JSON.stringify(history), snapshot);
});
test('existing Unicode normalization and same basenames in distinct folders are preserved', () => {
	const files = ['One/Note.md', 'Two/Note.md', 'Ünicode/😀.md', 'Cafe\u0301.md'];
	assert.equal(rank({ filePaths: files, history: [], activeFilePath: null, parent: null }).length, 4);
	assert.ok(readInlineTargetHistory({ version: 1, entries: files.map(file => usage(file)) }));
});
test('recent destinations do not repeat an already listed equivalent destination', () => {
	const result = rank({ history: [usage('Active.md', 2, late), usage('Recent1.md')] });
	assert.equal(result.filter(row => row.target.filePath === 'Active.md').length, 1);
	assert.deepEqual(result.filter(row => row.reason === 'recent').map(row => row.target.filePath), ['Recent1.md']);
});

async function fixture() {
	const root = await mkdtemp(path.join(tmpdir(), 'operon-inline-target-history-'));
	await mkdir(path.join(root, '.config/plugins/operon'), { recursive: true });
	let writes = 0;
	let fault: 'write' | 'rename' | null = null;
	const adapter = {
		exists: async (file: string) => { try { await access(path.join(root, file)); return true; } catch { return false; } },
		read: (file: string) => readFile(path.join(root, file), 'utf8'),
		write: async (file: string, data: string) => { writes++; if (fault === 'write') throw new Error('write failure'); await writeFile(path.join(root, file), data); },
		rename: async (from: string, to: string) => { if (fault === 'rename' && from.includes('.tmp-') && !from.includes('.replace-backup')) throw new Error('rename failure'); await rename(path.join(root, from), path.join(root, to)); },
		remove: (file: string) => unlink(path.join(root, file)),
		mkdir: (file: string) => mkdir(path.join(root, file)),
	};
	const queue = new WriteQueue();
	const store = new InlineTaskTargetHistoryStore(adapter, '.config', queue);
	return { root, adapter, store, queue, writes: () => writes, fault: (value: typeof fault) => { fault = value; },
		seed: async (raw: string) => { await mkdir(path.join(root, '.config/plugins/operon/state'), { recursive: true }); await writeFile(path.join(root, store.filePath), raw); },
		close: () => rm(root, { recursive: true, force: true }),
	};
}

test('missing history load is read-only and uses the configured plugin directory', async () => {
	const f = await fixture();
	try {
		assert.equal(f.store.getStatus(), 'unloaded'); await f.store.load(); await f.store.load();
		assert.equal(f.store.getStatus(), 'ready'); assert.deepEqual(f.store.getEntries(), []); assert.equal(f.writes(), 0);
		assert.equal(await f.adapter.exists('.config/plugins/operon/state'), false);
		assert.equal(f.store.filePath, '.config/plugins/operon/state/inline-task-target-history.json');
	} finally { await f.close(); }
});
test('successful records serialize, increment and survive read-only reload', async () => {
	const f = await fixture();
	try {
		await f.store.load();
		await Promise.all([f.store.recordSuccess('A.md', ['A.md'], early), f.store.recordSuccess('A.md', ['A.md'], late)]);
		assert.deepEqual(f.store.getEntries(), [usage('A.md', 2, late)]);
		const before = f.writes(); const next = new InlineTaskTargetHistoryStore(f.adapter, '.config', f.queue); await next.load();
		assert.deepEqual(next.getEntries(), f.store.getEntries()); assert.equal(f.writes(), before);
		next.getEntries()[0].count = 999; assert.equal(next.getEntries()[0].count, 2);
	} finally { await f.close(); }
});
for (const raw of ['{broken', '{"version":2,"entries":[]}', '{"version":1,"entries":{}}', JSON.stringify({ version: 1, entries: [usage('A.md', -1)] }), JSON.stringify({ version: 1, entries: [usage('A.md', 1, 'yesterday')] }), JSON.stringify({ version: 1, entries: [usage('A.md'), usage('A.md')] }), JSON.stringify({ version: 1, entries: [usage('../secret.md')] })]) {
	test(`invalid or unsupported history is preserved with zero writes: ${raw}`, async () => {
		const f = await fixture();
		try {
			await f.seed(raw); await f.store.load(); assert.equal(f.store.getStatus(), 'unavailable'); assert.deepEqual(f.store.getEntries(), []);
			await assert.rejects(f.store.recordSuccess('A.md', ['A.md'], early));
			assert.equal(await f.adapter.read(f.store.filePath), raw); assert.equal(f.writes(), 0);
		} finally { await f.close(); }
	});
}
test('rename and delete update memory only, merge collisions, and persist on the next explicit record', async () => {
	const f = await fixture();
	try {
		const raw = JSON.stringify({ version: 1, entries: [usage('Old/A.md', 2), usage('New/A.md', 3, late), usage('Old/B.md'), usage('Gone.md')] });
		await f.seed(raw); await f.store.load(); await f.store.renamePath('Old', 'New'); await f.store.deletePath('New/B.md'); await f.store.deletePath('Gone.md');
		assert.deepEqual(f.store.getEntries(), [usage('New/A.md', 5, late)]); assert.equal(await f.adapter.read(f.store.filePath), raw); assert.equal(f.writes(), 0);
		await f.store.recordSuccess('New/A.md', ['New/A.md'], late);
		assert.deepEqual(readInlineTargetHistory(JSON.parse(await f.adapter.read(f.store.filePath)))?.entries, [usage('New/A.md', 6, late)]);
	} finally { await f.close(); }
});
test('stale files are pruned only by a successful record, not load or failed record', async () => {
	const f = await fixture();
	try {
		await f.seed(JSON.stringify({ version: 1, entries: [usage('Gone.md')] })); await f.store.load();
		await assert.rejects(f.store.recordSuccess('No.md', ['A.md'], early)); assert.equal(f.store.getEntries().length, 1);
		await f.store.recordSuccess('A.md', ['A.md'], early); assert.deepEqual(f.store.getEntries(), [usage('A.md')]);
	} finally { await f.close(); }
});
for (const fault of ['write', 'rename'] as const) test(`safe ${fault} failure preserves history and the queue accepts the next explicit record`, async () => {
	const f = await fixture();
	try {
		await f.store.load(); await f.store.recordSuccess('A.md', ['A.md'], early); const before = await f.adapter.read(f.store.filePath);
		f.fault(fault); await assert.rejects(f.store.recordSuccess('A.md', ['A.md'], late));
		assert.equal(await f.adapter.read(f.store.filePath), before); assert.deepEqual(f.store.getEntries(), [usage('A.md')]);
		f.fault(null); await f.store.recordSuccess('A.md', ['A.md'], late); assert.deepEqual(f.store.getEntries(), [usage('A.md', 2, late)]);
	} finally { await f.close(); }
});
test('an externally replaced history is not overwritten', async () => {
	const f = await fixture();
	try {
		await f.store.load(); const raw = '{"version":99,"future":true}'; await f.seed(raw);
		await assert.rejects(f.store.recordSuccess('A.md', ['A.md'], early));
		assert.equal(f.store.getStatus(), 'unavailable'); assert.equal(await f.adapter.read(f.store.filePath), raw); assert.equal(f.writes(), 0);
	} finally { await f.close(); }
});

for (const fault of ['write', 'rename'] as const) test(`restart after ${fault} failure reads the committed history without writes`, async () => {
	const f = await fixture();
	try {
		await f.store.load(); await f.store.recordSuccess('A.md', ['A.md'], early);
		const before = await f.adapter.read(f.store.filePath);
		f.fault(fault); await assert.rejects(f.store.recordSuccess('A.md', ['A.md'], late));
		f.fault(null); const count = f.writes();
		const restarted = new InlineTaskTargetHistoryStore(f.adapter, '.config', new WriteQueue());
		await restarted.load(); await restarted.load();
		assert.deepEqual(restarted.getEntries(), [usage('A.md')]);
		assert.equal(f.writes(), count); assert.equal(await f.adapter.read(f.store.filePath), before);
	} finally { await f.close(); }
});
test('orphaned temporary content does not replace the authoritative history on load', async () => {
	const f = await fixture();
	try {
		const committed = JSON.stringify({ version: 1, entries: [usage('A.md')] });
		await f.seed(committed);
		const interrupted = f.store.filePath + '.tmp-interrupted';
		await writeFile(path.join(f.root, interrupted), '{incomplete');
		await f.store.load();
		assert.deepEqual(f.store.getEntries(), [usage('A.md')]); assert.equal(f.writes(), 0);
		assert.equal(await f.adapter.read(interrupted), '{incomplete');
		assert.equal(await f.adapter.read(f.store.filePath), committed);
	} finally { await f.close(); }
});

test('restart during replacement preserves orphaned backup and uses empty history without startup writes', async () => {
	const f = await fixture();
	try {
		const committed = JSON.stringify({ version: 1, entries: [usage('A.md')] });
		await f.seed(committed);
		const backup = f.store.filePath + '.replace-backup.tmp-interrupted';
		const pending = f.store.filePath + '.tmp-interrupted';
		await rename(path.join(f.root, f.store.filePath), path.join(f.root, backup));
		await writeFile(path.join(f.root, pending), JSON.stringify({ version: 1, entries: [usage('A.md', 2)] }));
		await f.store.load();
		assert.equal(f.store.getStatus(), 'ready'); assert.deepEqual(f.store.getEntries(), []); assert.equal(f.writes(), 0);
		assert.equal(await f.adapter.exists(f.store.filePath), false);
		assert.equal(await f.adapter.read(backup), committed); assert.ok(await f.adapter.exists(pending));
	} finally { await f.close(); }
});
