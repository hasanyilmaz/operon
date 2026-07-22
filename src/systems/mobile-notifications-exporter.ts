import type { App, DataAdapter } from 'obsidian';
import type { IndexReconciliationEvent, OperonIndexer } from '../indexer/indexer';
import { buildOperonPluginStoragePath } from '../storage/operon-storage-paths';
import { writeTextSafely } from '../storage/storage-file-ops';
import type { OperonSettings } from '../types/settings';
import {
	buildMobileNotificationsSnapshotFromCandidates,
	buildMobileNotificationsTaskCandidate,
	parseExistingMobileNotificationsProducerState,
	resolveMobileNotificationsTimezone,
	type MobileNotificationsSnapshot,
	type MobileNotificationsTaskCandidate,
	type ExistingMobileNotificationsProducerState,
} from '../core/mobile-notifications-snapshot';
import type { ReminderOccurrenceFieldKey } from '../core/reminder-scheduler-model';

const DEFAULT_DEBOUNCE_MS = 500;
const DEFAULT_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const RETRY_DELAY_MS = 30_000;

type ExporterIndexer = Pick<
	OperonIndexer,
	'getAllTasks' | 'getTask' | 'hasDuplicateOperonIdConflict' | 'subscribeIndexReconciliation'
>;

type ExporterAppearanceSettings = Pick<
	OperonSettings,
	'fallbackStateIcons' | 'fallbackTaskIconSource' | 'pipelines' | 'priorities'
>;

export interface MobileNotificationsExporterOptions {
	app: App;
	indexer: ExporterIndexer;
	canProduce?: () => boolean;
	getEnabled: () => boolean;
	producerState: {
		getOrCreateVaultId: () => Promise<string>;
		reserveGeneratedAtEpochMs: (nowEpochMs: number, minimumExclusive: number) => Promise<number>;
		isCancelPending?: () => boolean;
		markCancelAllPublished?: () => Promise<void>;
	};
	getCatchUpMinutes: () => number;
	getAppearanceSettings: () => ExporterAppearanceSettings;
	isSystemReminderFieldEnabled: (fieldKey: ReminderOccurrenceFieldKey) => boolean;
	getTimezone?: () => string;
	getVaultName?: () => string;
	now?: () => number;
	ownerWindow?: Pick<Window, 'setTimeout' | 'clearTimeout'>;
	path?: string;
	debounceMs?: number;
	refreshIntervalMs?: number;
}

export class MobileNotificationsExporter {
	private readonly app: App;
	private readonly indexer: ExporterIndexer;
	private readonly canProduce: () => boolean;
	private readonly getEnabled: () => boolean;
	private readonly producerState: MobileNotificationsExporterOptions['producerState'];
	private readonly getCatchUpMinutes: () => number;
	private readonly getAppearanceSettings: () => ExporterAppearanceSettings;
	private readonly isSystemReminderFieldEnabled: (fieldKey: ReminderOccurrenceFieldKey) => boolean;
	private readonly getTimezone: () => string;
	private readonly getVaultName: () => string;
	private readonly now: () => number;
	private readonly ownerWindow: Pick<Window, 'setTimeout' | 'clearTimeout'>;
	private readonly path: string;
	private readonly debounceMs: number;
	private readonly refreshIntervalMs: number;
	private operationTail: Promise<void> = Promise.resolve();
	private lifecycleTail: Promise<void> = Promise.resolve();
	private unsubscribeIndex: (() => void) | null = null;
	private debounceTimer: number | null = null;
	private refreshTimer: number | null = null;
	private retryTimer: number | null = null;
	private lastGeneratedAtEpochMs = -1;
	private lastSemanticSignature: string | null = null;
	private vaultId: string | null = null;
	private readonly candidateByOperonId = new Map<string, MobileNotificationsTaskCandidate>();
	private readonly pendingOperonIds = new Set<string>();
	private pendingFullRebuild = false;
	private latestPendingGeneration = -1;
	private started = false;
	private active = false;
	private destroyed = false;

	constructor(options: MobileNotificationsExporterOptions) {
		this.app = options.app;
		this.indexer = options.indexer;
		this.canProduce = options.canProduce ?? (() => true);
		this.getEnabled = options.getEnabled;
		this.producerState = options.producerState;
		this.getCatchUpMinutes = options.getCatchUpMinutes;
		this.getAppearanceSettings = options.getAppearanceSettings;
		this.isSystemReminderFieldEnabled = options.isSystemReminderFieldEnabled;
		this.getTimezone = options.getTimezone ?? resolveMobileNotificationsTimezone;
		this.getVaultName = options.getVaultName ?? (() => this.app.vault.getName());
		this.now = options.now ?? (() => Date.now());
		this.ownerWindow = options.ownerWindow
			?? options.app.workspace.containerEl.ownerDocument.defaultView
			?? window;
		this.path = options.path ?? buildOperonPluginStoragePath(
			options.app.vault.configDir,
			'state',
			'mobile-notifications.json',
		);
		this.debounceMs = Math.max(0, options.debounceMs ?? DEFAULT_DEBOUNCE_MS);
		this.refreshIntervalMs = Math.max(60_000, options.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS);
	}

	async start(): Promise<void> {
		await this.enqueueLifecycle(async () => {
			if (this.started || this.destroyed) return;
			this.started = true;
			await this.applyDesiredEnabledState();
		});
	}

	async handleSettingsChanged(): Promise<void> {
		await this.enqueueLifecycle(async () => {
			if (!this.started || this.destroyed) return;
			await this.applyDesiredEnabledState();
		});
	}

	async destroy(): Promise<void> {
		await this.lifecycleTail;
		if (this.destroyed) return;
		this.clearDebounce();
		this.clearRefresh();
		this.clearRetry();
		this.unsubscribeIndex?.();
		this.unsubscribeIndex = null;
		if (this.active && (this.pendingFullRebuild || this.pendingOperonIds.size > 0)) {
			await this.enqueueAndWait(() => this.reconcileAndWrite(false));
		}
		this.active = false;
		await this.operationTail;
		this.destroyed = true;
		this.started = false;
	}

	/** Test and diagnostics hook; normal callers rely on debounced reconciliation. */
	async flush(): Promise<void> {
		await this.lifecycleTail;
		await this.operationTail;
	}

	private async activate(): Promise<void> {
		if (this.active || this.destroyed) return;
		try {
			this.vaultId = await this.producerState.getOrCreateVaultId();
		} catch (error) {
			this.scheduleRetry();
			console.warn('Operon: mobile notifications identity initialization failed', error);
			return;
		}
		if (!this.getEnabled() || this.destroyed) return;
		this.active = true;
		this.unsubscribeIndex = this.indexer.subscribeIndexReconciliation(event => this.handleIndexReconciliation(event));
		this.pendingFullRebuild = true;
		try {
			await this.enqueueAndWait(() => this.reconcileAndWrite(true));
		} catch {
			// The operation queue reports the error; retained full intent is retried below.
		}
		this.scheduleRefresh();
	}

	private async applyDesiredEnabledState(): Promise<void> {
		if (!this.canProduce()) return;
		if (this.getEnabled()) {
			if (!this.active) await this.activate();
			else {
				this.pendingFullRebuild = true;
				try {
					await this.enqueueAndWait(() => this.reconcileAndWrite(false));
				} catch {
					// Retry is owned by the exporter and the last valid snapshot remains live.
				}
			}
			if (!this.getEnabled()) await this.applyDesiredEnabledState();
			return;
		}
		if (!this.active) {
			if (this.producerState.isCancelPending?.()) await this.completePendingCancellation();
			return;
		}
		try {
			await this.enqueueAndWait(() => this.writeDisabledSnapshot());
		} catch {
			this.scheduleRetry();
			return;
		}
		if (this.getEnabled()) {
			this.pendingFullRebuild = true;
			await this.applyDesiredEnabledState();
			return;
		}
		this.deactivate();
	}

	private deactivate(): void {
		this.active = false;
		this.unsubscribeIndex?.();
		this.unsubscribeIndex = null;
		this.clearDebounce();
		this.clearRefresh();
		this.clearRetry();
		this.lastSemanticSignature = null;
		this.candidateByOperonId.clear();
		this.pendingOperonIds.clear();
		this.pendingFullRebuild = false;
	}

	private handleIndexReconciliation(event: IndexReconciliationEvent): void {
		if (!this.active || this.destroyed) return;
		this.latestPendingGeneration = Math.max(this.latestPendingGeneration, event.generation);
		if (event.kind === 'full') {
			this.pendingFullRebuild = true;
			this.pendingOperonIds.clear();
		} else if (!this.pendingFullRebuild) {
			for (const operonId of event.affectedOperonIds) this.pendingOperonIds.add(operonId);
		}
		if (this.debounceTimer !== null) return;
		this.debounceTimer = this.ownerWindow.setTimeout(() => {
			this.debounceTimer = null;
			this.enqueue(() => this.reconcileAndWrite(false));
		}, this.debounceMs);
	}

	private scheduleRefresh(): void {
		this.clearRefresh();
		if (!this.active || this.destroyed) return;
		this.refreshTimer = this.ownerWindow.setTimeout(() => {
			this.refreshTimer = null;
			this.enqueue(async () => {
				this.pendingFullRebuild = true;
				await this.reconcileAndWrite(true);
				this.scheduleRefresh();
			});
		}, this.refreshIntervalMs);
	}

	private async reconcileAndWrite(forceRefresh: boolean): Promise<void> {
		if (!this.active || this.destroyed || !this.getEnabled()) return;
		const generationAtStart = this.latestPendingGeneration;
		try {
			if (this.pendingFullRebuild) {
				this.rebuildAllCandidates();
				this.pendingFullRebuild = false;
				this.pendingOperonIds.clear();
			} else {
				const affectedIds = [...this.pendingOperonIds];
				this.pendingOperonIds.clear();
				for (const operonId of affectedIds) this.rebuildCandidate(operonId);
			}
			const provisionalSnapshot = this.createSnapshot(true, this.nextProvisionalGeneratedAt());
			const semanticSignature = JSON.stringify({
				vault: provisionalSnapshot.vault,
				timezone: provisionalSnapshot.timezone,
				catchUpMinutes: provisionalSnapshot.window.catchUpMinutes,
				sourcePolicy: provisionalSnapshot.sourcePolicy,
				tasks: provisionalSnapshot.tasks,
			});
			if (!forceRefresh && semanticSignature === this.lastSemanticSignature) {
				this.scheduleFollowUpIfNeeded(generationAtStart);
				return;
			}
			const snapshot = await this.reserveAndBuildSnapshot(true);
			await this.persist(snapshot);
			this.lastSemanticSignature = semanticSignature;
			this.clearRetry();
			if (this.refreshTimer === null) this.scheduleRefresh();
			this.scheduleFollowUpIfNeeded(generationAtStart);
		} catch (error) {
			this.pendingFullRebuild = true;
			this.scheduleRetry();
			throw error;
		}
	}

	private async writeDisabledSnapshot(): Promise<void> {
		await this.persist(await this.reserveAndBuildSnapshot(false));
		this.lastSemanticSignature = null;
	}

	private async completePendingCancellation(): Promise<void> {
		try {
			this.vaultId ??= await this.producerState.getOrCreateVaultId();
			await this.enqueueAndWait(() => this.writeDisabledSnapshot());
			this.clearRetry();
		} catch {
			this.scheduleRetry();
		}
	}

	private nextProvisionalGeneratedAt(): number {
		const nowEpochMs = this.now();
		if (this.lastGeneratedAtEpochMs > nowEpochMs + 5 * 60_000) {
			throw new Error('Operon: mobile notification watermark is more than five minutes ahead of the system clock');
		}
		return Math.max(nowEpochMs, this.lastGeneratedAtEpochMs + 1);
	}

	private async reserveAndBuildSnapshot(enabled: boolean): Promise<MobileNotificationsSnapshot> {
		const nowEpochMs = this.now();
		this.nextProvisionalGeneratedAt();
		const generatedAtEpochMs = await this.producerState.reserveGeneratedAtEpochMs(
			nowEpochMs,
			this.lastGeneratedAtEpochMs,
		);
		if (!Number.isSafeInteger(generatedAtEpochMs)
			|| generatedAtEpochMs < nowEpochMs
			|| generatedAtEpochMs <= this.lastGeneratedAtEpochMs
			|| generatedAtEpochMs > nowEpochMs + 5 * 60_000) {
			throw new Error('Operon: invalid reserved mobile notification generation watermark');
		}
		if (!this.vaultId) throw new Error('Operon: mobile notification vault id is unavailable');
		return this.createSnapshot(enabled, generatedAtEpochMs);
	}

	private createSnapshot(enabled: boolean, generatedAtEpochMs: number): MobileNotificationsSnapshot {
		if (!this.vaultId) throw new Error('Operon: mobile notification vault id is unavailable');
		return buildMobileNotificationsSnapshotFromCandidates({
			generatedAtEpochMs,
			vaultId: this.vaultId,
			vaultName: this.getVaultName(),
			timezone: this.getTimezone(),
			catchUpMinutes: this.getCatchUpMinutes(),
			appearanceSettings: this.getAppearanceSettings(),
			isSystemReminderFieldEnabled: this.isSystemReminderFieldEnabled,
			enabled,
		}, [...this.candidateByOperonId.values()]);
	}

	private scheduleFollowUpIfNeeded(generationAtStart: number): void {
		if (this.latestPendingGeneration > generationAtStart || this.pendingFullRebuild || this.pendingOperonIds.size > 0) {
			this.enqueue(() => this.reconcileAndWrite(false));
		}
	}

	private rebuildAllCandidates(): void {
		this.candidateByOperonId.clear();
		for (const task of this.indexer.getAllTasks()) this.rebuildCandidate(task.operonId);
	}

	private rebuildCandidate(operonId: string): void {
		this.candidateByOperonId.delete(operonId);
		const task = this.indexer.getTask(operonId);
		if (!task) return;
		const vaultTimezone = this.getTimezone();
		const appearanceSettings = this.getAppearanceSettings();
		try {
			const candidate = buildMobileNotificationsTaskCandidate({
				task,
				vaultTimezone,
				appearanceSettings,
				isDuplicateOperonId: id => this.indexer.hasDuplicateOperonIdConflict(id),
				isSystemReminderFieldEnabled: this.isSystemReminderFieldEnabled,
			})[0];
			if (candidate) this.candidateByOperonId.set(operonId, candidate);
		} catch (error) {
			console.warn('Operon: skipped malformed mobile notification candidate', operonId, error);
		}
	}

	private async persist(snapshot: MobileNotificationsSnapshot): Promise<void> {
		if (!this.canProduce()) throw new Error('Operon: mobile notifications snapshots are desktop-only');
		const serialized = `${JSON.stringify(snapshot, null, 2)}\n`;
		await writeMobileNotificationsSnapshotAtomically(this.app.vault.adapter, this.path, serialized);
		if (!snapshot.enabled) await this.producerState.markCancelAllPublished?.();
		this.lastGeneratedAtEpochMs = snapshot.generatedAtEpochMs;
	}

	private enqueue(operation: () => Promise<void>): void {
		void this.enqueueAndWait(operation);
	}

	private enqueueAndWait(operation: () => Promise<void>): Promise<void> {
		const next = this.operationTail.then(operation);
		this.operationTail = next.catch(error => {
			console.warn('Operon: mobile notifications snapshot export failed', error);
		});
		return next;
	}

	private enqueueLifecycle(operation: () => Promise<void>): Promise<void> {
		const next = this.lifecycleTail.then(operation);
		this.lifecycleTail = next.catch(error => {
			console.warn('Operon: mobile notifications exporter lifecycle failed', error);
		});
		return next;
	}

	private scheduleRetry(): void {
		if (this.destroyed || !this.started || !this.canProduce() || this.retryTimer !== null) return;
		if (!this.active && !this.getEnabled() && !this.producerState.isCancelPending?.()) return;
		this.retryTimer = this.ownerWindow.setTimeout(() => {
			this.retryTimer = null;
			void this.enqueueLifecycle(() => this.applyDesiredEnabledState());
		}, RETRY_DELAY_MS);
	}

	private clearDebounce(): void {
		if (this.debounceTimer === null) return;
		this.ownerWindow.clearTimeout(this.debounceTimer);
		this.debounceTimer = null;
	}

	private clearRefresh(): void {
		if (this.refreshTimer === null) return;
		this.ownerWindow.clearTimeout(this.refreshTimer);
		this.refreshTimer = null;
	}

	private clearRetry(): void {
		if (this.retryTimer === null) return;
		this.ownerWindow.clearTimeout(this.retryTimer);
		this.retryTimer = null;
	}
}

type AtomicSnapshotAdapter = Pick<DataAdapter, 'exists' | 'mkdir' | 'write' | 'remove' | 'rename'>;

export async function writeMobileNotificationsSnapshotAtomically(
	adapter: AtomicSnapshotAdapter,
	path: string,
	serialized: string,
): Promise<void> {
	await ensureParentDirectory(adapter, path);
	await writeTextSafely(adapter, path, serialized, { forceAtomicReplacement: true });
}

export async function readExistingMobileNotificationsVaultId(
	adapter: Pick<DataAdapter, 'exists' | 'read'>,
	path: string,
): Promise<string | null> {
	return (await readExistingMobileNotificationsProducerState(adapter, path))?.vaultId ?? null;
}

export async function readExistingMobileNotificationsProducerState(
	adapter: Pick<DataAdapter, 'exists' | 'read'>,
	path: string,
): Promise<ExistingMobileNotificationsProducerState | null> {
	try {
		if (!await adapter.exists(path)) return null;
		return parseExistingMobileNotificationsProducerState(await adapter.read(path));
	} catch {
		return null;
	}
}

async function ensureParentDirectory(adapter: AtomicSnapshotAdapter, path: string): Promise<void> {
	const segments = path.split('/').filter(Boolean);
	segments.pop();
	let current = '';
	for (const segment of segments) {
		current = current ? `${current}/${segment}` : segment;
		if (!await adapter.exists(current)) await adapter.mkdir(current);
	}
}
