import { App, TFile, TFolder } from 'obsidian';
import type { OperonIndexer } from '../indexer/indexer';
import { clearWindowTimeout, setWindowTimeout, type WindowTimeoutHandle } from '../core/dom-compat';
import { resolveFileTaskArchiveLocation } from '../core/file-task-pipeline-location';
import { normalizeSettingsFolderPath } from '../core/settings-folder-rules';
import { writeTextSafely } from '../storage/storage-file-ops';
import { buildOperonPluginStoragePath } from '../storage/operon-storage-paths';
import type { IndexedTask } from '../types/fields';
import type { OperonSettings } from '../types/settings';

export const FILE_TASK_ARCHIVE_DELAY_MS = 5_000;
export const FILE_TASK_ARCHIVE_MAX_CONCURRENT_MOVES = 4;
const FILE_TASK_ARCHIVE_RECONCILE_MARKER_FILE_NAME = 'file-task-archive-reconcile.json';

export interface FileTaskArchiveReconciliationMarkerV1 {
	version: 1;
	requestedAt: string;
}

export function parseFileTaskArchiveReconciliationMarkerV1(raw: string): FileTaskArchiveReconciliationMarkerV1 | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw) as unknown;
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
	const record = parsed as Record<string, unknown>;
	if (
		record.version !== 1
		|| typeof record.requestedAt !== 'string'
		|| Object.keys(record).length !== 2
		|| !Object.prototype.hasOwnProperty.call(record, 'version')
		|| !Object.prototype.hasOwnProperty.call(record, 'requestedAt')
	) return null;
	try {
		if (new Date(record.requestedAt).toISOString() !== record.requestedAt) return null;
	} catch {
		return null;
	}
	return { version: 1, requestedAt: record.requestedAt };
}

interface PendingArchive {
	timer: WindowTimeoutHandle;
	trigger: string;
	reconciliationGeneration: number | null;
}

interface QueuedArchive {
	operonId: string;
	trigger: string;
	reconciliationGeneration: number | null;
}

type ArchiveOutcome = 'completed' | 'skipped' | 'rescheduled' | 'failed';

interface FileTaskArchiverOptions {
	isTaskActive?: (operonId: string) => boolean;
	onMoveError?: (task: IndexedTask, error: unknown) => void;
}

/** Keeps terminal YAML File Tasks in their configured archive destination. */
export class FileTaskArchiver {
	private static readonly MAX_RENAME_ATTEMPTS = 5;
	private readonly pendingByTaskId = new Map<string, PendingArchive>();
	private readonly serialByTaskId = new Map<string, Promise<ArchiveOutcome>>();
	private readonly readyQueue: QueuedArchive[] = [];
	private readonly reconciliationPendingTaskIds = new Set<string>();
	private markerOperationSerial: Promise<void> = Promise.resolve();
	private activeMoveCount = 0;
	private reconciliationGeneration = 0;
	private reconciliationFailed = false;
	private destroyed = false;

	constructor(
		private readonly app: App,
		private readonly indexer: OperonIndexer,
		private readonly getSettings: () => OperonSettings,
		private readonly options: FileTaskArchiverOptions = {},
	) {}

	scheduleForIndexedChange(beforeTask: IndexedTask | null, afterTask: IndexedTask | null): void {
		if (!afterTask) {
			if (beforeTask) this.cancelPending(beforeTask.operonId);
			return;
		}
		if (!this.isCandidate(afterTask)) {
			this.cancelPending(afterTask.operonId);
			return;
		}
		const trigger = this.trigger(afterTask);
		if (beforeTask && this.trigger(beforeTask) === trigger) return;
		this.schedule(afterTask.operonId, trigger);
	}

	/** Persist a settings-triggered bulk request before its fixed 5-second delay. */
	async requestSettingsReconcileAll(): Promise<void> {
		const generation = this.claimSettingsReconciliationGeneration();
		try {
			await this.enqueueMarkerOperation(async () => {
				if (this.destroyed || generation !== this.reconciliationGeneration) return;
				await this.writeReconciliationMarker();
			});
		} catch (error) {
			console.warn('Operon: could not persist file task archive reconciliation marker', error);
			return;
		}
		if (!this.destroyed && generation === this.reconciliationGeneration) {
			this.startSettingsReconciliation(generation);
		}
	}

	async resumePendingReconciliation(): Promise<void> {
		try {
			const adapter = this.app.vault.adapter;
			if (!await adapter.exists(this.reconciliationMarkerPath)) return;
			const raw = await adapter.read(this.reconciliationMarkerPath);
			if (!parseFileTaskArchiveReconciliationMarkerV1(raw)) {
				console.warn('Operon: file task archive reconciliation marker is invalid or unsupported; preserving it');
				return;
			}
		} catch (error) {
			console.warn('Operon: could not read file task archive reconciliation marker', error);
			return;
		}
		this.startSettingsReconciliation();
	}

	destroy(): void {
		this.destroyed = true;
		for (const pending of this.pendingByTaskId.values()) clearWindowTimeout(pending.timer);
		this.pendingByTaskId.clear();
		this.readyQueue.length = 0;
	}

	private claimSettingsReconciliationGeneration(): number {
		return ++this.reconciliationGeneration;
	}

	private startSettingsReconciliation(generation = this.claimSettingsReconciliationGeneration()): void {
		if (this.destroyed || generation !== this.reconciliationGeneration) return;
		this.reconciliationFailed = false;
		this.reconciliationPendingTaskIds.clear();
		for (const [operonId, pending] of this.pendingByTaskId) {
			if (pending.reconciliationGeneration !== null) this.cancelPending(operonId, false);
		}
		for (const task of this.indexer.getAllTasks()) {
			if (!this.isCandidate(task)) continue;
			this.reconciliationPendingTaskIds.add(task.operonId);
			this.schedule(task.operonId, this.trigger(task), generation);
		}
		void this.completeReconciliationIfReady(generation);
	}

	private schedule(operonId: string, trigger: string, reconciliationGeneration: number | null = null): void {
		if (this.destroyed) return;
		const replaced = this.cancelPending(operonId, false);
		const generation = reconciliationGeneration ?? (
			replaced?.reconciliationGeneration === this.reconciliationGeneration
				? replaced.reconciliationGeneration
				: null
		);
		const timer = setWindowTimeout(() => {
			this.pendingByTaskId.delete(operonId);
			this.readyQueue.push({ operonId, trigger, reconciliationGeneration: generation });
			this.drainQueue();
		}, FILE_TASK_ARCHIVE_DELAY_MS);
		this.pendingByTaskId.set(operonId, { timer, trigger, reconciliationGeneration: generation });
	}

	private drainQueue(): void {
		while (!this.destroyed && this.activeMoveCount < FILE_TASK_ARCHIVE_MAX_CONCURRENT_MOVES) {
			const queued = this.readyQueue.shift();
			if (!queued) return;
			this.activeMoveCount += 1;
			void this.enqueue(queued).then(
				outcome => this.finishQueuedArchive(queued, outcome),
				error => {
					console.warn('Operon: file task archive reconciliation failed unexpectedly', queued.operonId, error);
					this.finishQueuedArchive(queued, 'failed');
				},
			).finally(() => {
				this.activeMoveCount -= 1;
				this.drainQueue();
			});
		}
	}

	private enqueue(queued: QueuedArchive): Promise<ArchiveOutcome> {
		const previous = this.serialByTaskId.get(queued.operonId) ?? Promise.resolve<ArchiveOutcome>('completed');
		const next = previous.catch(() => 'failed' as const).then(() => this.archiveIfStillEligible(queued));
		this.serialByTaskId.set(queued.operonId, next);
		void next.finally(() => {
			if (this.serialByTaskId.get(queued.operonId) === next) this.serialByTaskId.delete(queued.operonId);
		});
		return next;
	}

	private async archiveIfStillEligible(queued: QueuedArchive): Promise<ArchiveOutcome> {
		if (
			queued.reconciliationGeneration !== null
			&& queued.reconciliationGeneration !== this.reconciliationGeneration
		) return 'skipped';
		const task = this.indexer.getTask(queued.operonId);
		if (!task || !this.isCandidate(task)) return 'skipped';
		if (this.indexer.hasDuplicateOperonIdConflict(task.operonId)) {
			console.warn('Operon: duplicate operonId blocks file task archiving', task.operonId);
			return 'failed';
		}
		const nextTrigger = this.trigger(task);
		if (nextTrigger !== queued.trigger) {
			this.schedule(task.operonId, nextTrigger, queued.reconciliationGeneration);
			return 'rescheduled';
		}
		const targetFolder = this.resolveTargetFolder(task);
		if (targetFolder === null) return 'skipped';
		const sourceFile = this.app.vault.getAbstractFileByPath(task.primary.filePath);
		if (!(sourceFile instanceof TFile) || sourceFile.extension !== 'md') return 'failed';
		if (this.isWithinArchiveTarget(sourceFile.path, targetFolder)) return 'completed';
		try {
			await this.ensureFolderExists(targetFolder);
			await this.moveToUniqueArchivePath(sourceFile, targetFolder);
			return 'completed';
		} catch (error) {
			console.warn('Operon: failed to archive file task', task.operonId, error);
			this.options.onMoveError?.(task, error);
			return 'failed';
		}
	}

	private finishQueuedArchive(queued: QueuedArchive, outcome: ArchiveOutcome): void {
		const generation = queued.reconciliationGeneration;
		if (generation === null || generation !== this.reconciliationGeneration) return;
		if (outcome === 'failed') {
			this.reconciliationFailed = true;
			return;
		}
		if (outcome === 'rescheduled') return;
		this.reconciliationPendingTaskIds.delete(queued.operonId);
		void this.completeReconciliationIfReady(generation);
	}

	private async completeReconciliationIfReady(generation: number): Promise<void> {
		if (
			generation !== this.reconciliationGeneration
			|| this.reconciliationFailed
			|| this.reconciliationPendingTaskIds.size > 0
			|| this.destroyed
		) return;
		try {
			await this.enqueueMarkerOperation(async () => {
				if (
					generation !== this.reconciliationGeneration
					|| this.reconciliationFailed
					|| this.reconciliationPendingTaskIds.size > 0
					|| this.destroyed
				) return;
				await this.removeReconciliationMarker();
			});
		} catch (error) {
			console.warn('Operon: could not clear file task archive reconciliation marker', error);
		}
	}

	private isCandidate(task: IndexedTask): boolean {
		return task.primary.format === 'yaml'
			&& this.isTerminal(task)
			&& !this.isTaskActive(task.operonId)
			&& this.resolveTargetFolder(task) !== null;
	}

	private resolveTargetFolder(task: IndexedTask): string | null {
		const resolution = resolveFileTaskArchiveLocation(this.getSettings(), task.fieldValues);
		return resolution.kind === 'unsafe-rule' ? null : resolution.folder;
	}

	private isTerminal(task: IndexedTask): boolean {
		return task.checkbox === 'done'
			|| task.checkbox === 'cancelled'
			|| !!task.fieldValues['dateCompleted']?.trim()
			|| !!task.fieldValues['dateCancelled']?.trim();
	}

	private trigger(task: IndexedTask): string {
		return [
			task.primary.filePath,
			task.checkbox,
			task.fieldValues['status'] ?? '',
			task.fieldValues['dateCompleted'] ?? '',
			task.fieldValues['dateCancelled'] ?? '',
			this.resolveTargetFolder(task) ?? '',
		].join('|');
	}

	private isTaskActive(operonId: string): boolean {
		return this.options.isTaskActive?.(operonId) ?? false;
	}

	private async ensureFolderExists(folderPath: string): Promise<void> {
		const existing = this.app.vault.getAbstractFileByPath(folderPath);
		if (existing instanceof TFolder) return;
		let currentPath = '';
		for (const part of folderPath.split('/').filter(Boolean)) {
			currentPath = currentPath ? `${currentPath}/${part}` : part;
			const node = this.app.vault.getAbstractFileByPath(currentPath);
			if (node instanceof TFolder) continue;
			if (node) throw new Error(`Cannot create archive folder "${currentPath}" because a file exists at this path`);
			try {
				await this.app.vault.createFolder(currentPath);
			} catch (error) {
				const retryNode = this.app.vault.getAbstractFileByPath(currentPath);
				if (retryNode instanceof TFolder || await this.app.vault.adapter.exists(currentPath)) continue;
				throw error;
			}
		}
	}

	private async moveToUniqueArchivePath(sourceFile: TFile, archiveFolder: string): Promise<void> {
		for (let attempt = 0; attempt < FileTaskArchiver.MAX_RENAME_ATTEMPTS; attempt += 1) {
			const targetPath = this.getUniqueArchivePath(archiveFolder, sourceFile.basename);
			try {
				await this.app.fileManager.renameFile(sourceFile, targetPath);
				return;
			} catch (error) {
				const sourceStillExists = this.app.vault.getAbstractFileByPath(sourceFile.path) instanceof TFile;
				if (!sourceStillExists || attempt === FileTaskArchiver.MAX_RENAME_ATTEMPTS - 1) throw error;
			}
		}
	}

	private getUniqueArchivePath(folderPath: string, basename: string): string {
		let candidate = `${folderPath}/${basename}.md`;
		let index = 1;
		while (this.app.vault.getAbstractFileByPath(candidate)) {
			candidate = `${folderPath}/${basename} (${index}).md`;
			index += 1;
		}
		return candidate;
	}

	private getFolder(path: string): string {
		const slash = path.lastIndexOf('/');
		return slash < 0 ? '' : path.slice(0, slash);
	}

	private isWithinArchiveTarget(filePath: string, targetFolder: string): boolean {
		const normalizedTarget = normalizeSettingsFolderPath(targetFolder).toLowerCase();
		if (!normalizedTarget) return false;
		const normalizedSourceFolder = normalizeSettingsFolderPath(this.getFolder(filePath)).toLowerCase();
		return normalizedSourceFolder === normalizedTarget
			|| normalizedSourceFolder.startsWith(`${normalizedTarget}/`);
	}

	private cancelPending(operonId: string, settleReconciliation = true): PendingArchive | null {
		const pending = this.pendingByTaskId.get(operonId);
		if (!pending) return null;
		clearWindowTimeout(pending.timer);
		this.pendingByTaskId.delete(operonId);
		if (
			settleReconciliation
			&& pending.reconciliationGeneration !== null
			&& pending.reconciliationGeneration === this.reconciliationGeneration
		) {
			this.reconciliationPendingTaskIds.delete(operonId);
			void this.completeReconciliationIfReady(pending.reconciliationGeneration);
		}
		return pending;
	}

	private get reconciliationMarkerPath(): string {
		return buildOperonPluginStoragePath(
			this.app.vault.configDir,
			'state',
			FILE_TASK_ARCHIVE_RECONCILE_MARKER_FILE_NAME,
		);
	}

	private async writeReconciliationMarker(): Promise<void> {
		const folder = buildOperonPluginStoragePath(this.app.vault.configDir, 'state');
		const adapter = this.app.vault.adapter;
		if (!await adapter.exists(folder)) await adapter.mkdir(folder);
		const serialized = JSON.stringify({
			version: 1,
			requestedAt: new Date().toISOString(),
		});
		await writeTextSafely(adapter, this.reconciliationMarkerPath, serialized, {
			forceAtomicReplacement: true,
			verifyAtomicReplacement: true,
		});
		if (await adapter.read(this.reconciliationMarkerPath) !== serialized) {
			throw new Error('File task archive reconciliation marker write was not observed exactly');
		}
	}

	private async enqueueMarkerOperation<T>(operation: () => Promise<T>): Promise<T> {
		const next = this.markerOperationSerial.then(operation, operation);
		this.markerOperationSerial = next.then(() => undefined, () => undefined);
		return await next;
	}

	private async removeReconciliationMarker(): Promise<void> {
		const adapter = this.app.vault.adapter;
		if (await adapter.exists(this.reconciliationMarkerPath)) {
			await adapter.remove(this.reconciliationMarkerPath);
		}
		if (await adapter.exists(this.reconciliationMarkerPath)) {
			throw new Error('File task archive reconciliation marker removal was not observed');
		}
	}
}
