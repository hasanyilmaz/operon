import { App, TFile, TFolder } from 'obsidian';
import type { OperonIndexer } from '../indexer/indexer';
import type { IndexedTask } from '../types/fields';
import type { OperonSettings } from '../types/settings';
import { normalizeSettingsFolderPath } from '../core/settings-folder-rules';
import { resolveFileTaskPipelineLocation } from '../core/file-task-pipeline-location';
import { isSafeVaultRelativePath } from '../core/vault-path-safety';
import { clearWindowTimeout, setWindowTimeout, type WindowTimeoutHandle } from '../core/dom-compat';
import { buildOperonPluginStoragePath } from '../storage/operon-storage-paths';
import { writeTextSafely } from '../storage/storage-file-ops';

export const FILE_TASK_PIPELINE_MOVE_DELAY_MS = 5_000;
export const FILE_TASK_PIPELINE_MAX_CONCURRENT_MOVES = 4;
const FILE_TASK_PIPELINE_RECONCILE_MARKER_FILE_NAME = 'file-task-pipeline-location-reconcile.json';

export interface FileTaskPipelineReconciliationMarkerV1 {
	version: 1;
	requestedAt: string;
}

export interface FileTaskPipelineReconciliationMarkerV2 {
	version: 2;
	requestedAt: string;
	pipelineIds: string[];
}

function normalizePipelineIds(pipelineIds: Iterable<string>): string[] {
	return [...new Set([...pipelineIds].map(pipelineId => pipelineId.trim()).filter(Boolean))].sort();
}

function isCanonicalPipelineIdList(value: unknown): value is string[] {
	if (!Array.isArray(value) || value.length === 0 || value.some(item => typeof item !== 'string')) return false;
	const pipelineIds = value as string[];
	const normalized = normalizePipelineIds(pipelineIds);
	return normalized.length === pipelineIds.length
		&& normalized.every((pipelineId, index) => pipelineId === pipelineIds[index]);
}

export function parseFileTaskPipelineReconciliationMarkerV2(
	raw: string,
): FileTaskPipelineReconciliationMarkerV2 | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw) as unknown;
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
	const record = parsed as Record<string, unknown>;
	if (
		record.version !== 2
		|| typeof record.requestedAt !== 'string'
		|| !isCanonicalPipelineIdList(record.pipelineIds)
		|| Object.keys(record).length !== 3
		|| !Object.prototype.hasOwnProperty.call(record, 'version')
		|| !Object.prototype.hasOwnProperty.call(record, 'requestedAt')
		|| !Object.prototype.hasOwnProperty.call(record, 'pipelineIds')
	) return null;
	try {
		if (new Date(record.requestedAt).toISOString() !== record.requestedAt) return null;
	} catch {
		return null;
	}
	return { version: 2, requestedAt: record.requestedAt, pipelineIds: [...record.pipelineIds] };
}

export function parseFileTaskPipelineReconciliationMarkerV1(
	raw: string,
): FileTaskPipelineReconciliationMarkerV1 | null {
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

interface PendingMove {
	timer: WindowTimeoutHandle;
	trigger: string;
	intent: MoveIntent;
	reconciliationGeneration: number | null;
	epoch: number;
	sourcePath: string;
}

interface QueuedMove {
	operonId: string;
	trigger: string;
	intent: MoveIntent;
	reconciliationGeneration: number | null;
	epoch: number;
	sourcePath: string;
}

interface ScheduleOptions {
	intent?: MoveIntent;
	reconciliationGeneration?: number | null;
}

type MoveIntent = 'pipeline-rule' | 'converted-note';
type ResolvedMoveTarget =
	| { kind: 'target'; folder: string }
	| { kind: 'none' }
	| { kind: 'unsafe' };

type MoveOutcome = 'completed' | 'skipped' | 'rescheduled' | 'failed' | 'suspended';

export interface FileTaskPipelineMoverOptions {
	/** Uses the shared effective Daily/Weekly provider chain, including Core Daily fallback. */
	isPeriodicContainer: (task: IndexedTask) => boolean | Promise<boolean>;
	/** A suspended periodic-container registry must block every mover entrypoint. */
	canReconcile?: () => boolean;
	onReconcileUnavailable?: () => void;
	awaitReindexSettlement?: () => Promise<void>;
	onMoveError?: (task: IndexedTask, error: unknown) => void;
}

/** Keeps open YAML File Tasks in their configured pipeline folders. */
export class FileTaskPipelineMover {
	private static readonly MAX_RENAME_ATTEMPTS = 5;
	private readonly pendingByTaskId = new Map<string, PendingMove>();
	private readonly serialByTaskId = new Map<string, Promise<MoveOutcome>>();
	private readonly readyQueue: QueuedMove[] = [];
	private readonly reconciliationPendingTaskIds = new Set<string>();
	private readonly taskEpochById = new Map<string, number>();
	private readonly ownedRenameByTaskId = new Map<string, { sourcePath: string; targetPath: string }>();
	private nextTaskEpoch = 0;
	private markerOperationSerial: Promise<void> = Promise.resolve();
	private activeMoveCount = 0;
	private reconciliationGeneration = 0;
	private activeReconciliationPipelineIds: string[] = [];
	private reconciliationFailed = false;
	private destroyed = false;

	constructor(
		private readonly app: App,
		private readonly indexer: OperonIndexer,
		private readonly getSettings: () => OperonSettings,
		private readonly options: FileTaskPipelineMoverOptions,
	) {}

	scheduleForIndexedChange(before: IndexedTask | null, after: IndexedTask | null): void {
		if (!after) {
			if (before) this.cancelTaskWork(before.operonId);
			return;
		}
		if (!this.canReconcile()) return;
		if (!before) return;
		if (before.primary.format !== 'yaml') {
			if (after.primary.format !== 'yaml' || !this.getSettings().moveConvertedNotesToPipelineLocation) return;
			const target = this.resolveTarget(after, 'converted-note');
			if (target.kind === 'none') return;
			this.schedule(after.operonId, this.trigger(after, 'converted-note'), { intent: 'converted-note' });
			return;
		}
		if (!this.isCandidate(after)) {
			this.cancelTaskWork(after.operonId);
			return;
		}
		const beforeTarget = this.resolveTarget(before, 'pipeline-rule');
		const afterTarget = this.resolveTarget(after, 'pipeline-rule');
		if (afterTarget.kind !== 'target') {
			this.cancelTaskWork(after.operonId);
			return;
		}
		if (this.targetTrigger(beforeTarget) === this.targetTrigger(afterTarget)) {
			if (before.primary.filePath !== after.primary.filePath) {
				this.cancelTaskWork(after.operonId);
			}
			return;
		}
		this.schedule(after.operonId, this.trigger(after, 'pipeline-rule'));
	}

	/** A user-initiated vault rename owns the new location and cancels stale automatic movement. */
	preserveManualLocation(operonId: string, oldPath?: string, newPath?: string): void {
		const ownedRename = this.ownedRenameByTaskId.get(operonId);
		if (ownedRename && ownedRename.sourcePath === oldPath && ownedRename.targetPath === newPath) return;
		this.cancelTaskWork(operonId);
	}

	/** Index removal invalidates timers, queued work, and work already crossing an await boundary. */
	cancelForTaskRemoval(operonId: string): void {
		this.cancelTaskWork(operonId);
	}

	scheduleConvertedNote(operonId: string): void {
		if (!this.canReconcile()) return;
		if (!this.getSettings().moveConvertedNotesToPipelineLocation) return;
		const task = this.indexer.getTask(operonId);
		if (!task || !this.isCandidate(task)) return;
		if (this.resolveTarget(task, 'converted-note').kind === 'none') return;
		this.schedule(task.operonId, this.trigger(task, 'converted-note'), { intent: 'converted-note' });
	}

	/** Persist the settings request before its debounce. */
	async requestSettingsReconcilePipelineIds(pipelineIds: readonly string[]): Promise<void> {
		const requestedPipelineIds = normalizePipelineIds(pipelineIds);
		if (requestedPipelineIds.length === 0 || this.destroyed) return;
		// Claim before the serialized merge so an older generation cannot clear the
		// marker. Every request still performs its merge, even if a newer one exists.
		const generation = this.claimSettingsReconciliationGeneration();
		let mergedPipelineIds: string[] | null = null;
		try {
			await this.enqueueMarkerOperation(async () => {
				if (this.destroyed) return;
				const adapter = this.app.vault.adapter;
				let pendingPipelineIds: string[] = [];
				if (await adapter.exists(this.reconciliationMarkerPath)) {
					const raw = await adapter.read(this.reconciliationMarkerPath);
					const existing = parseFileTaskPipelineReconciliationMarkerV2(raw);
					if (existing) {
						pendingPipelineIds = existing.pipelineIds;
					} else if (!parseFileTaskPipelineReconciliationMarkerV1(raw)) {
						throw new Error('Existing File Task pipeline marker is invalid or unsupported.');
					}
				}
				mergedPipelineIds = normalizePipelineIds([...pendingPipelineIds, ...requestedPipelineIds]);
				await this.writeReconciliationMarker(mergedPipelineIds);
			});
		} catch (error) {
			console.warn('Operon: could not persist file task pipeline reconciliation marker', error);
			return;
		}
		if (!mergedPipelineIds || this.destroyed || generation !== this.reconciliationGeneration) return;
		try {
			await this.options.awaitReindexSettlement?.();
		} catch (error) {
			console.warn('Operon: settings reindex did not settle before pipeline reconciliation', error);
			return;
		}
		if (this.destroyed || generation !== this.reconciliationGeneration || !this.canReconcile()) return;
		this.startSettingsReconciliation(generation, new Set(mergedPipelineIds));
	}

	async resumePendingReconciliation(): Promise<void> {
		if (this.destroyed) return;
		let marker: FileTaskPipelineReconciliationMarkerV2 | null = null;
		try {
			const adapter = this.app.vault.adapter;
			if (!(await adapter.exists(this.reconciliationMarkerPath))) return;
			const raw = await adapter.read(this.reconciliationMarkerPath);
			marker = parseFileTaskPipelineReconciliationMarkerV2(raw);
			if (!marker) {
				const reason = parseFileTaskPipelineReconciliationMarkerV1(raw)
					? 'legacy version-one'
					: 'invalid or unsupported';
				console.warn(`Operon: file task pipeline reconciliation marker is ${reason}; preserving it`);
				return;
			}
		} catch (error) {
			console.warn('Operon: could not read file task pipeline reconciliation marker', error);
			return;
		}
		const generation = this.claimSettingsReconciliationGeneration();
		try {
			await this.options.awaitReindexSettlement?.();
		} catch (error) {
			console.warn('Operon: settings reindex did not settle before pipeline reconciliation resume', error);
			return;
		}
		if (this.destroyed || generation !== this.reconciliationGeneration || !this.canReconcile()) return;
		this.startSettingsReconciliation(generation, new Set(marker.pipelineIds));
	}

	destroy(): void {
		this.destroyed = true;
		for (const pending of this.pendingByTaskId.values()) clearWindowTimeout(pending.timer);
		this.pendingByTaskId.clear();
		this.readyQueue.length = 0;
		this.taskEpochById.clear();
		this.ownedRenameByTaskId.clear();
	}

	private claimSettingsReconciliationGeneration(): number {
		return ++this.reconciliationGeneration;
	}

	private startSettingsReconciliation(
		generation: number,
		pipelineIds: ReadonlySet<string>,
	): void {
		if (!this.canReconcile() || this.destroyed || generation !== this.reconciliationGeneration) return;
		this.activeReconciliationPipelineIds = normalizePipelineIds(pipelineIds);
		this.reconciliationFailed = false;
		this.reconciliationPendingTaskIds.clear();
		for (const [operonId, pending] of this.pendingByTaskId) {
			if (pending.reconciliationGeneration !== null) this.cancelPending(operonId, false);
		}
		for (const task of this.indexer.getAllTasks()) {
			if (!this.isCandidate(task)) continue;
			const resolution = resolveFileTaskPipelineLocation(this.getSettings(), task.fieldValues);
			if (resolution.kind !== 'pipeline-rule') continue;
			if (!pipelineIds.has(resolution.pipelineId)) continue;
			this.reconciliationPendingTaskIds.add(task.operonId);
			this.schedule(task.operonId, this.trigger(task, 'pipeline-rule'), { reconciliationGeneration: generation });
		}
		void this.completeReconciliationIfReady(generation);
	}

	private schedule(
		operonId: string,
		trigger: string,
		options: ScheduleOptions = {},
	): void {
		if (!this.canReconcile() || this.destroyed) return;
		const replaced = this.invalidateTaskWork(operonId);
		const intent = options.intent ?? replaced?.intent ?? 'pipeline-rule';
		const reconciliationGeneration = options.reconciliationGeneration
			?? (
				replaced?.reconciliationGeneration === this.reconciliationGeneration
					? replaced.reconciliationGeneration
					: null
			);
		const sourcePath = this.indexer.getTask(operonId)?.primary.filePath ?? '';
		if (!sourcePath) {
			this.taskEpochById.delete(operonId);
			return;
		}
		const epoch = this.currentTaskEpoch(operonId);
		const timer = setWindowTimeout(() => {
			if (!this.isEpochCurrent(operonId, epoch) || this.destroyed) return;
			this.pendingByTaskId.delete(operonId);
			this.readyQueue.push({
				operonId,
				trigger,
				intent,
				reconciliationGeneration,
				epoch,
				sourcePath,
			});
			this.drainQueue();
		}, FILE_TASK_PIPELINE_MOVE_DELAY_MS);
		this.pendingByTaskId.set(operonId, {
			timer,
			trigger,
			intent,
			reconciliationGeneration,
			epoch,
			sourcePath,
		});
	}

	private drainQueue(): void {
		while (!this.destroyed && this.activeMoveCount < FILE_TASK_PIPELINE_MAX_CONCURRENT_MOVES) {
			const queued = this.readyQueue.shift();
			if (!queued) return;
			this.activeMoveCount += 1;
			void this.enqueue(queued).then(
				outcome => this.finishQueuedMove(queued, outcome),
				error => {
					console.warn('Operon: pipeline-location reconciliation failed unexpectedly', queued.operonId, error);
					this.finishQueuedMove(queued, 'failed');
				},
			).finally(() => {
				this.activeMoveCount -= 1;
				this.drainQueue();
			});
		}
	}

	private enqueue(queued: QueuedMove): Promise<MoveOutcome> {
		const previous = this.serialByTaskId.get(queued.operonId) ?? Promise.resolve<MoveOutcome>('completed');
		const next = previous.catch(() => 'failed' as const).then(async () => {
			return await this.moveIfStillEligible(queued);
		});
		this.serialByTaskId.set(queued.operonId, next);
		void next.finally(() => {
			if (this.serialByTaskId.get(queued.operonId) === next) this.serialByTaskId.delete(queued.operonId);
		});
		return next;
	}

	private async moveIfStillEligible(queued: QueuedMove): Promise<MoveOutcome> {
		if (!this.isEpochCurrent(queued.operonId, queued.epoch) || this.destroyed) return 'skipped';
		if (!this.canReconcile()) return 'suspended';
		const task = this.indexer.getTask(queued.operonId);
		if (!task || task.primary.filePath !== queued.sourcePath || !await this.isEligible(task)) return 'skipped';
		if (queued.reconciliationGeneration !== null) {
			if (queued.reconciliationGeneration !== this.reconciliationGeneration) return 'skipped';
			const resolution = resolveFileTaskPipelineLocation(this.getSettings(), task.fieldValues);
			if (
				resolution.kind !== 'pipeline-rule'
				|| !this.activeReconciliationPipelineIds.includes(resolution.pipelineId)
			) return 'skipped';
		}
		if (this.indexer.hasDuplicateOperonIdConflict(task.operonId)) {
			console.warn('Operon: duplicate operonId blocks pipeline-location reconciliation', task.operonId);
			return 'failed';
		}
		if (this.trigger(task, queued.intent) !== queued.trigger) {
			this.schedule(task.operonId, this.trigger(task, queued.intent), {
				intent: queued.intent,
				reconciliationGeneration: queued.reconciliationGeneration,
			});
			return 'rescheduled';
		}
		const source = this.app.vault.getAbstractFileByPath(task.primary.filePath);
		if (!(source instanceof TFile) || source.extension !== 'md' || source.path !== queued.sourcePath) return 'failed';
		const target = this.resolveTarget(task, queued.intent);
		if (target.kind === 'none') return 'skipped';
		if (target.kind === 'unsafe') {
			const error = new Error('Configured File Task destination is not a safe vault-relative folder.');
			console.warn('Operon: unsafe file task pipeline destination blocks reconciliation', task.operonId);
			this.options.onMoveError?.(task, error);
			return 'skipped';
		}
		const targetFolder = target.folder;
		if (this.getFolder(source.path) === targetFolder) return 'completed';
		try {
			const canMutate = async (): Promise<boolean> => await this.isQueuedMoveCurrent(queued, source);
			if (!await canMutate()) return this.cancelledMoveOutcome();
			if (!await this.ensureFolder(targetFolder, canMutate)) return this.cancelledMoveOutcome();
			if (!await canMutate()) return this.cancelledMoveOutcome();
			if (!await this.renameToExactPath(queued.operonId, source, targetFolder, canMutate)) {
				return this.cancelledMoveOutcome();
			}
			return 'completed';
		} catch (error) {
			console.warn('Operon: failed to move file task to its pipeline location', task.operonId, error);
			this.options.onMoveError?.(task, error);
			return 'failed';
		}
	}

	private finishQueuedMove(queued: QueuedMove, outcome: MoveOutcome): void {
		if (!this.isEpochCurrent(queued.operonId, queued.epoch)) return;
		const generation = queued.reconciliationGeneration;
		if (generation === null || generation !== this.reconciliationGeneration) {
			this.taskEpochById.delete(queued.operonId);
			return;
		}
		if (outcome === 'failed' || outcome === 'suspended') {
			this.reconciliationFailed = true;
			this.taskEpochById.delete(queued.operonId);
			return;
		}
		if (outcome === 'rescheduled') return;
		this.reconciliationPendingTaskIds.delete(queued.operonId);
		this.taskEpochById.delete(queued.operonId);
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
				await this.removeReconciliationMarker(this.activeReconciliationPipelineIds);
			});
		} catch (error) {
			console.warn('Operon: could not clear file task pipeline reconciliation marker', error);
		}
	}

	private resolveTarget(task: IndexedTask, intent: MoveIntent): ResolvedMoveTarget {
		const settings = this.getSettings();
		const pipeline = resolveFileTaskPipelineLocation(settings, task.fieldValues);
		if (pipeline.kind === 'pipeline-rule') return this.safeTarget(pipeline.folder ?? '');
		if (pipeline.kind === 'unsafe-rule') return { kind: 'unsafe' };
		if (intent === 'pipeline-rule') return { kind: 'none' };
		return this.safeTarget(settings.fileTasksFolder);
	}

	private safeTarget(folder: string): ResolvedMoveTarget {
		if (folder === '') return { kind: 'target', folder: '' };
		if (!isSafeVaultRelativePath(folder)) return { kind: 'unsafe' };
		return { kind: 'target', folder: normalizeSettingsFolderPath(folder) };
	}

	private isCandidate(task: IndexedTask): boolean {
		return task.primary.format === 'yaml' && !this.isTerminal(task);
	}

	private async isEligible(task: IndexedTask): Promise<boolean> {
		return this.isCandidate(task) && !await this.options.isPeriodicContainer(task);
	}

	private canReconcile(): boolean {
		if (this.options.canReconcile?.() !== false) return true;
		this.options.onReconcileUnavailable?.();
		return false;
	}

	private cancelledMoveOutcome(): MoveOutcome {
		return !this.destroyed && this.options.canReconcile?.() === false ? 'suspended' : 'skipped';
	}

	private isTerminal(task: IndexedTask): boolean {
		return task.checkbox === 'done'
			|| task.checkbox === 'cancelled'
			|| !!task.fieldValues['dateCompleted']?.trim()
			|| !!task.fieldValues['dateCancelled']?.trim();
	}

	private trigger(task: IndexedTask, intent: MoveIntent): string {
		return [
			this.getFolder(task.primary.filePath),
			task.primary.format,
			this.isTerminal(task) ? 'terminal' : 'open',
			intent,
			this.targetTrigger(this.resolveTarget(task, intent)),
		].join('|');
	}

	private targetTrigger(target: ResolvedMoveTarget): string {
		return target.kind === 'target' ? `target:${target.folder}` : target.kind;
	}

	private async ensureFolder(folder: string, canMutate: () => Promise<boolean>): Promise<boolean> {
		if (!folder) return await canMutate();
		let path = '';
		for (const part of folder.split('/').filter(Boolean)) {
			path = path ? `${path}/${part}` : part;
			const existing = this.app.vault.getAbstractFileByPath(path);
			if (existing instanceof TFolder) continue;
			if (existing) throw new Error(`A file blocks the target folder: ${path}`);
			if (!await canMutate()) return false;
			try {
				await this.app.vault.createFolder(path);
			} catch (error) {
				if (!(this.app.vault.getAbstractFileByPath(path) instanceof TFolder)) throw error;
			}
			if (!await canMutate()) return false;
		}
		return true;
	}

	private async renameToExactPath(
		operonId: string,
		source: TFile,
		folder: string,
		canMutate: () => Promise<boolean>,
	): Promise<boolean> {
		const target = folder ? `${folder}/${source.basename}.md` : `${source.basename}.md`;
		if (this.app.vault.getAbstractFileByPath(target)) {
			throw new Error(`File Task pipeline destination already exists: ${target}`);
		}
		for (let attempt = 0; attempt < FileTaskPipelineMover.MAX_RENAME_ATTEMPTS; attempt += 1) {
			if (!await canMutate()) return false;
			const ownedRename = { sourcePath: source.path, targetPath: target };
			this.ownedRenameByTaskId.set(operonId, ownedRename);
			try {
				await this.app.fileManager.renameFile(source, target);
				return true;
			} catch (error) {
				const sourceStillExists = this.app.vault.getAbstractFileByPath(source.path) instanceof TFile;
				if (!sourceStillExists || attempt === FileTaskPipelineMover.MAX_RENAME_ATTEMPTS - 1) throw error;
			} finally {
				if (this.ownedRenameByTaskId.get(operonId) === ownedRename) this.ownedRenameByTaskId.delete(operonId);
			}
		}
		return false;
	}

	private async isQueuedMoveCurrent(queued: QueuedMove, source: TFile): Promise<boolean> {
		if (this.destroyed || !this.isEpochCurrent(queued.operonId, queued.epoch)) return false;
		if (
			queued.reconciliationGeneration !== null
			&& queued.reconciliationGeneration !== this.reconciliationGeneration
		) return false;
		const task = this.indexer.getTask(queued.operonId);
		if (!task || task.primary.filePath !== queued.sourcePath || source.path !== queued.sourcePath) return false;
		if (!await this.isEligible(task) || this.trigger(task, queued.intent) !== queued.trigger) return false;
		return !this.indexer.hasDuplicateOperonIdConflict(task.operonId) && this.canReconcile();
	}

	private getFolder(path: string): string {
		const slash = path.lastIndexOf('/');
		return slash < 0 ? '' : path.slice(0, slash);
	}

	/**
	 * Replacements keep the active bulk generation attached to the new debounce.
	 * Terminal/delete cancellation instead settles that generation so its durable
	 * marker cannot remain stranded behind a timer that will never drain.
	 */
	private cancelPending(operonId: string, settleReconciliation = true): PendingMove | null {
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

	private currentTaskEpoch(operonId: string): number {
		return this.taskEpochById.get(operonId) ?? 0;
	}

	private isEpochCurrent(operonId: string, epoch: number): boolean {
		return this.currentTaskEpoch(operonId) === epoch;
	}

	private invalidateTaskWork(operonId: string): PendingMove | null {
		const replaced = this.cancelPending(operonId, false);
		this.nextTaskEpoch += 1;
		this.taskEpochById.set(operonId, this.nextTaskEpoch);
		for (let index = this.readyQueue.length - 1; index >= 0; index -= 1) {
			if (this.readyQueue[index]?.operonId === operonId) this.readyQueue.splice(index, 1);
		}
		return replaced;
	}

	private cancelTaskWork(operonId: string): void {
		this.invalidateTaskWork(operonId);
		this.taskEpochById.delete(operonId);
		if (this.reconciliationPendingTaskIds.delete(operonId)) {
			void this.completeReconciliationIfReady(this.reconciliationGeneration);
		}
	}

	private get reconciliationMarkerPath(): string {
		return buildOperonPluginStoragePath(
			this.app.vault.configDir,
			'state',
			FILE_TASK_PIPELINE_RECONCILE_MARKER_FILE_NAME,
		);
	}

	private async writeReconciliationMarker(pipelineIds: readonly string[]): Promise<void> {
		const folder = buildOperonPluginStoragePath(this.app.vault.configDir, 'state');
		const adapter = this.app.vault.adapter;
		if (!await adapter.exists(folder)) await adapter.mkdir(folder);
		const serialized = JSON.stringify({
			version: 2,
			requestedAt: new Date().toISOString(),
			pipelineIds: normalizePipelineIds(pipelineIds),
		});
		await writeTextSafely(adapter, this.reconciliationMarkerPath, serialized, {
			forceAtomicReplacement: true,
			verifyAtomicReplacement: true,
		});
		if (await adapter.read(this.reconciliationMarkerPath) !== serialized) {
			throw new Error('File Task pipeline reconciliation marker readback mismatch.');
		}
	}

	private async enqueueMarkerOperation<T>(operation: () => Promise<T>): Promise<T> {
		const next = this.markerOperationSerial.then(operation, operation);
		this.markerOperationSerial = next.then(
			() => undefined,
			() => undefined,
		);
		return await next;
	}

	private async removeReconciliationMarker(expectedPipelineIds: readonly string[]): Promise<void> {
		const adapter = this.app.vault.adapter;
		if (!await adapter.exists(this.reconciliationMarkerPath)) return;
		const marker = parseFileTaskPipelineReconciliationMarkerV2(await adapter.read(this.reconciliationMarkerPath));
		if (!marker || marker.pipelineIds.join('\n') !== normalizePipelineIds(expectedPipelineIds).join('\n')) {
			throw new Error('File Task pipeline reconciliation marker changed before removal.');
		}
		try {
			await adapter.remove(this.reconciliationMarkerPath);
		} catch (error) {
			if (await adapter.exists(this.reconciliationMarkerPath)) throw error;
			return;
		}
		if (await adapter.exists(this.reconciliationMarkerPath)) {
			throw new Error('File Task pipeline reconciliation marker removal was not observed.');
		}
	}
}
