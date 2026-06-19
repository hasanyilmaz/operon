import type { App } from 'obsidian';
import {
	createEmptyProjectSerialState,
	getProjectSerialSignature,
	normalizeProjectSerialState,
	reconcileProjectSerialAssignments,
	resolveStoredProjectSerialDisplay,
	type ProjectSerialDisplay,
	type ProjectSerialReconcileResult,
	type ProjectSerialScopeSummary,
	type ProjectSerialState,
} from '../core/project-serials';
import type { IndexedTask } from '../types/fields';
import type { ProjectSerialScope } from '../types/settings';
import { preserveInvalidJsonFile, writeJsonSafely } from './storage-file-ops';
import { WriteQueue } from './write-queue';

export class ProjectSerialStore {
	private app: App;
	private writeQueue: WriteQueue;
	private data: ProjectSerialState = createEmptyProjectSerialState();
	private generation = 0;
	private mutationQueue: Promise<void> = Promise.resolve();
	private writesSuspended = false;
	private displaysByTaskId: Map<string, ProjectSerialDisplay> = new Map();
	private summariesByScopeId: Map<string, ProjectSerialScopeSummary> = new Map();
	private listeners: Set<() => void> = new Set();
	private readonly filePath: string;

	constructor(app: App, writeQueue: WriteQueue, filePath: string) {
		this.app = app;
		this.writeQueue = writeQueue;
		this.filePath = filePath;
	}

	async load(): Promise<void> {
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(this.filePath))) {
			this.data = createEmptyProjectSerialState();
			this.resetRuntimeCache();
			return;
		}

		let raw = '';
		try {
			raw = await adapter.read(this.filePath);
			this.data = normalizeProjectSerialState(JSON.parse(raw));
			this.writesSuspended = false;
			this.resetRuntimeCache();
		} catch {
			console.warn('Operon: Failed to parse project-serials.json, preserving invalid file as backup and starting empty');
			this.data = createEmptyProjectSerialState();
			this.resetRuntimeCache();
			try {
				await preserveInvalidJsonFile(adapter, this.filePath, raw);
				this.writesSuspended = false;
			} catch {
				console.warn('Operon: Failed to preserve invalid project-serials.json backup; project serial writes suspended');
				this.writesSuspended = true;
			}
		}
	}

	async reconcile(
		scopes: readonly ProjectSerialScope[],
		tasks: readonly IndexedTask[],
		now = new Date().toISOString(),
	): Promise<ProjectSerialReconcileResult> {
		const run = this.mutationQueue.then(async () => {
			const previousDisplaySignature = this.getSignature();
			const workingState = normalizeProjectSerialState(this.data);
			const result = reconcileProjectSerialAssignments({
				scopes,
				state: workingState,
				tasks,
				now,
			});
			if (result.changed) {
				await this.flush(workingState);
				this.data = workingState;
			} else {
				this.data = workingState;
			}
			this.displaysByTaskId = result.displaysByTaskId;
			this.summariesByScopeId = result.summariesByScopeId;
			if (result.changed || previousDisplaySignature !== this.getSignature()) {
				this.bumpGeneration();
			}
			return result;
		});
		this.mutationQueue = run.then(() => undefined, () => undefined);
		return await run;
	}

	getDisplayForTask(operonId: string | null | undefined): ProjectSerialDisplay | null {
		const normalizedId = operonId?.trim() ?? '';
		if (!normalizedId) return null;
		return this.displaysByTaskId.get(normalizedId) ?? null;
	}

	getDisplayForTaskWithFallback(
		operonId: string | null | undefined,
		scopes: readonly ProjectSerialScope[],
		getTaskById: (operonId: string) => IndexedTask | null | undefined,
	): ProjectSerialDisplay | null {
		return this.getDisplayForTask(operonId)
			?? resolveStoredProjectSerialDisplay({
				scopes,
				state: this.data,
				operonId,
				getTaskById,
			});
	}

	getSummary(scopeId: string | null | undefined): ProjectSerialScopeSummary | null {
		const normalizedId = scopeId?.trim() ?? '';
		if (!normalizedId) return null;
		return this.summariesByScopeId.get(normalizedId) ?? null;
	}

	getGeneration(): number {
		return this.generation;
	}

	getSignature(): string {
		return getProjectSerialSignature(this.displaysByTaskId.values());
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	async drain(): Promise<void> {
		await this.mutationQueue;
	}

	private async flush(data: ProjectSerialState): Promise<void> {
		if (this.writesSuspended) {
			throw new Error('Project serial writes are suspended');
		}
		await this.writeQueue.enqueue(this.filePath, async () => {
			await writeJsonSafely(this.app.vault.adapter, this.filePath, data);
		});
	}

	private resetRuntimeCache(): void {
		this.displaysByTaskId = new Map();
		this.summariesByScopeId = new Map();
		this.generation = 0;
	}

	private bumpGeneration(): void {
		this.generation += 1;
		for (const listener of this.listeners) {
			listener();
		}
	}
}
