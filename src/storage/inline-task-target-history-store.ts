import type { DataAdapter } from 'obsidian';
import { isInlineTargetFilePath, readInlineTargetHistory, type InlineTargetHistory, type InlineTargetUsage } from '../core/inline-task-targets';
import { buildOperonPluginStoragePath } from './operon-storage-paths';
import { writeTextSafely } from './storage-file-ops';
import { WriteQueue } from './write-queue';

type HistoryAdapter = Pick<DataAdapter, 'exists' | 'read' | 'write' | 'rename' | 'remove' | 'mkdir'>;

/** Inert until explicitly loaded and recorded by the Plugin UI; never scans or writes notes. */
export class InlineTaskTargetHistoryStore {
	private entries: InlineTargetUsage[] = [];
	private status: 'unloaded' | 'ready' | 'unavailable' = 'unloaded';
	private expectedContent: string | null = null;
	readonly filePath: string;

	constructor(private adapter: HistoryAdapter, configDir: string, private queue: WriteQueue) {
		this.filePath = buildOperonPluginStoragePath(configDir, 'state', 'inline-task-target-history.json');
	}

	getStatus(): 'unloaded' | 'ready' | 'unavailable' { return this.status; }
	getEntries(): InlineTargetUsage[] { return this.entries.map(entry => ({ ...entry })); }

	async load(): Promise<void> {
		await this.queue.enqueue(this.filePath, async () => {
			if (this.status !== 'unloaded') return;
			try {
				const raw = await this.readContent();
				const parsed = raw === null ? { version: 1, entries: [] } : readInlineTargetHistory(JSON.parse(raw));
				if (!parsed) throw new Error('Unsupported inline target history');
				this.entries = parsed.entries;
				this.expectedContent = raw;
				this.status = 'ready';
			} catch {
				this.status = 'unavailable';
				this.entries = [];
			}
		});
	}

	async recordSuccess(filePath: string, availableFilePaths: readonly string[], now = new Date().toISOString()): Promise<void> {
		// Capture caller-owned inputs before waiting for another write.
		const available = new Set(availableFilePaths.filter(isInlineTargetFilePath));
		await this.queue.enqueue(this.filePath, async () => {
			if (this.status !== 'ready') throw new Error('Inline target history is unavailable');
			if (!available.has(filePath) || !Number.isFinite(Date.parse(now)) || new Date(now).toISOString() !== now) {
				throw new Error('Invalid inline target history update');
			}
			if (await this.readContent() !== this.expectedContent) {
				this.status = 'unavailable';
				this.entries = [];
				throw new Error('Inline target history changed outside this session');
			}
			const next = this.entries.filter(entry => available.has(entry.filePath)).map(entry => ({ ...entry }));
			const previous = next.find(entry => entry.filePath === filePath);
			if (previous) {
				if (previous.count === Number.MAX_SAFE_INTEGER) throw new Error('Inline target history counter overflow');
				previous.count += 1;
				previous.lastUsedAt = now;
			} else next.push({ filePath, count: 1, lastUsedAt: now });
			const data: InlineTargetHistory = { version: 1, entries: next };
			const serialized = JSON.stringify(data, null, '\t');
			const directory = this.filePath.slice(0, this.filePath.lastIndexOf('/'));
			if (!await this.adapter.exists(directory)) await this.adapter.mkdir(directory);
			await writeTextSafely(this.adapter, this.filePath, serialized, { forceAtomicReplacement: true, verifyAtomicReplacement: true });
			this.expectedContent = serialized;
			this.entries = next;
		});
	}

	/** File or folder rename; persistence waits for the next successful UI creation. */
	async renamePath(oldPath: string, newPath: string): Promise<void> {
		await this.queue.enqueue(this.filePath, async () => {
			if (this.status !== 'ready' || !oldPath || !newPath || oldPath === newPath) return;
			const merged = new Map<string, InlineTargetUsage>();
			for (const entry of this.entries) {
				const path = entry.filePath === oldPath || entry.filePath.startsWith(`${oldPath}/`)
					? newPath + entry.filePath.slice(oldPath.length) : entry.filePath;
				if (!isInlineTargetFilePath(path)) continue;
				const prior = merged.get(path);
				merged.set(path, prior ? {
					filePath: path, count: Math.min(Number.MAX_SAFE_INTEGER, prior.count + entry.count),
					lastUsedAt: Date.parse(prior.lastUsedAt) > Date.parse(entry.lastUsedAt) ? prior.lastUsedAt : entry.lastUsedAt,
				} : { ...entry, filePath: path });
			}
			this.entries = [...merged.values()];
		});
	}

	async deletePath(path: string): Promise<void> {
		await this.queue.enqueue(this.filePath, async () => {
			if (this.status !== 'ready' || !path) return;
			this.entries = this.entries.filter(entry => entry.filePath !== path && !entry.filePath.startsWith(`${path}/`));
		});
	}

	private async readContent(): Promise<string | null> {
		return await this.adapter.exists(this.filePath) ? await this.adapter.read(this.filePath) : null;
	}
}
