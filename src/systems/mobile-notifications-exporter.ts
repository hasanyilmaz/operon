import type { App, DataAdapter, Stat } from 'obsidian';
import type { IndexReconciliationEvent, OperonIndexer } from '../indexer/indexer';
import { buildOperonPluginStoragePath } from '../storage/operon-storage-paths';
import { writeTextSafely } from '../storage/storage-file-ops';
import type { OperonSettings } from '../types/settings';
import {
	buildMobileNotificationsSnapshotFromCandidates,
	buildMobileNotificationsTaskCandidate,
	parseExistingMobileNotificationsProducerState,
	resolveMobileNotificationsTimezone,
	validateMobileNotificationsSnapshot,
	type ExistingMobileNotificationsProducerState,
	type MobileNotificationsSnapshot,
	type MobileNotificationsTaskCandidate,
} from '../core/mobile-notifications-snapshot';
import type { ReminderOccurrenceFieldKey } from '../core/reminder-scheduler-model';

const DEFAULT_DEBOUNCE_MS = 500;
const DEFAULT_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_STARTUP_REFRESH_DELAYS_MS = [60_000, 3 * 60_000, 5 * 60_000] as const;
const DEFAULT_MONITOR_STAT_INTERVAL_MS = 30_000;
const DEFAULT_MONITOR_FULL_READ_INTERVAL_MS = 5 * 60_000;
const DEFAULT_RECOVERY_DELAY_MS = 2_000;
const DEFAULT_RECOVERY_ATTEMPTS = 3;

type ExporterIndexer = Pick<
	OperonIndexer,
	'getAllTasks' | 'getTask' | 'hasDuplicateOperonIdConflict' | 'subscribeIndexReconciliation'
>;

type ExporterAppearanceSettings = Pick<
	OperonSettings,
	'fallbackStateIcons' | 'fallbackTaskIconSource' | 'pipelines' | 'priorities'
>;

interface ExporterEventTarget {
	addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
	removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
}

interface ExporterWindow extends ExporterEventTarget {
	setTimeout(callback: () => void, delay?: number): number;
	clearTimeout(id: number): void;
	crypto?: Crypto;
}

interface ExporterDocument extends ExporterEventTarget {
	visibilityState?: DocumentVisibilityState;
}

export interface MobileNotificationsExporterOptions {
	app: App;
	indexer: ExporterIndexer;
	canProduce?: () => boolean;
	producerState: {
		getOrCreateVaultId: (adoptedVaultId?: string | null) => Promise<string>;
	};
	getCatchUpMinutes: () => number;
	getAppearanceSettings: () => ExporterAppearanceSettings;
	isSystemReminderFieldEnabled: (fieldKey: ReminderOccurrenceFieldKey) => boolean;
	getTimezone?: () => string;
	getVaultName?: () => string;
	now?: () => number;
	ownerWindow?: ExporterWindow;
	ownerDocument?: ExporterDocument;
	path?: string;
	debounceMs?: number;
	refreshIntervalMs?: number;
	startupRefreshDelaysMs?: readonly number[];
	monitorStatIntervalMs?: number;
	monitorFullReadIntervalMs?: number;
	recoveryDelayMs?: number;
	recoveryAttempts?: number;
	hashText?: (text: string) => Promise<string>;
}

export class MobileNotificationsExporter {
	private readonly app: App;
	private readonly indexer: ExporterIndexer;
	private readonly canProduce: () => boolean;
	private readonly producerState: MobileNotificationsExporterOptions['producerState'];
	private readonly getCatchUpMinutes: () => number;
	private readonly getAppearanceSettings: () => ExporterAppearanceSettings;
	private readonly isSystemReminderFieldEnabled: (fieldKey: ReminderOccurrenceFieldKey) => boolean;
	private readonly getTimezone: () => string;
	private readonly getVaultName: () => string;
	private readonly now: () => number;
	private readonly ownerWindow: ExporterWindow;
	private readonly ownerDocument: ExporterDocument;
	private readonly path: string;
	private readonly debounceMs: number;
	private readonly refreshIntervalMs: number;
	private readonly startupRefreshDelaysMs: readonly number[];
	private readonly monitorStatIntervalMs: number;
	private readonly monitorFullReadIntervalMs: number;
	private readonly recoveryDelayMs: number;
	private readonly recoveryAttempts: number;
	private readonly hashText: (text: string) => Promise<string>;
	private operationTail: Promise<void> = Promise.resolve();
	private lifecycleTail: Promise<void> = Promise.resolve();
	private unsubscribeIndex: (() => void) | null = null;
	private debounceTimer: number | null = null;
	private refreshTimer: number | null = null;
	private retryTimer: number | null = null;
	private monitorStatTimer: number | null = null;
	private monitorFullReadTimer: number | null = null;
	private recoveryTimer: number | null = null;
	private readonly startupTimers = new Map<number, number>();
	private startupActivatedAtEpochMs = 0;
	private lastGeneratedAtEpochMs = -1;
	private lastSemanticSignature: string | null = null;
	private lastOwnedHash: string | null = null;
	private lastObservedHash: string | null = null;
	private lastObservedStat: string | null = null;
	private recoveryAttempt = 0;
	private vaultId: string | null = null;
	private readonly candidateByOperonId = new Map<string, MobileNotificationsTaskCandidate>();
	private readonly pendingOperonIds = new Set<string>();
	private pendingFullRebuild = false;
	private latestPendingGeneration = -1;
	private started = false;
	private active = false;
	private monitoring = false;
	private destroyed = false;
	private readonly handleFocus = (): void => {
		this.requestMonitorCheck(false);
	};
	private readonly handleVisibilityChange = (): void => {
		if (this.ownerDocument.visibilityState !== 'hidden') this.requestMonitorCheck(false);
	};

	constructor(options: MobileNotificationsExporterOptions) {
		this.app = options.app;
		this.indexer = options.indexer;
		this.canProduce = options.canProduce ?? (() => true);
		this.producerState = options.producerState;
		this.getCatchUpMinutes = options.getCatchUpMinutes;
		this.getAppearanceSettings = options.getAppearanceSettings;
		this.isSystemReminderFieldEnabled = options.isSystemReminderFieldEnabled;
		this.getTimezone = options.getTimezone ?? resolveMobileNotificationsTimezone;
		this.getVaultName = options.getVaultName ?? (() => this.app.vault.getName());
		this.now = options.now ?? (() => Date.now());
		const defaultWindow = options.app.workspace.containerEl.ownerDocument.defaultView ?? window;
		this.ownerWindow = options.ownerWindow ?? defaultWindow;
		this.ownerDocument = options.ownerDocument ?? options.app.workspace.containerEl.ownerDocument;
		this.path = options.path ?? buildOperonPluginStoragePath(
			options.app.vault.configDir,
			'state',
			'mobile-notifications.json',
		);
		this.debounceMs = Math.max(0, options.debounceMs ?? DEFAULT_DEBOUNCE_MS);
		this.refreshIntervalMs = Math.max(60_000, options.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS);
		this.startupRefreshDelaysMs = options.startupRefreshDelaysMs ?? DEFAULT_STARTUP_REFRESH_DELAYS_MS;
		this.monitorStatIntervalMs = Math.max(1, options.monitorStatIntervalMs ?? DEFAULT_MONITOR_STAT_INTERVAL_MS);
		this.monitorFullReadIntervalMs = Math.max(1, options.monitorFullReadIntervalMs ?? DEFAULT_MONITOR_FULL_READ_INTERVAL_MS);
		this.recoveryDelayMs = Math.max(1, options.recoveryDelayMs ?? DEFAULT_RECOVERY_DELAY_MS);
		this.recoveryAttempts = Math.max(1, Math.trunc(options.recoveryAttempts ?? DEFAULT_RECOVERY_ATTEMPTS));
		this.hashText = options.hashText ?? (text => sha256Text(text, this.ownerWindow.crypto));
	}

	async start(): Promise<void> {
		await this.enqueueLifecycle(async () => {
			if (this.started || this.destroyed) return;
			this.started = true;
			if (!this.canProduce()) return;
			await this.activate();
		});
	}

	async handleSettingsChanged(): Promise<void> {
		await this.enqueueLifecycle(async () => {
			if (!this.active || this.destroyed) return;
			this.pendingFullRebuild = true;
			await this.enqueueAndWait(() => this.reconcileAndWrite(false));
		});
	}

	async destroy(): Promise<void> {
		await this.lifecycleTail;
		if (this.destroyed) return;
		await this.flush();
		this.stopTimersAndMonitoring();
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

	/** Test and diagnostics hook; normal callers rely on queued reconciliation. */
	async flush(): Promise<void> {
		await this.lifecycleTail;
		let observedTail: Promise<void>;
		do {
			observedTail = this.operationTail;
			await observedTail;
		} while (observedTail !== this.operationTail);
	}

	private async activate(): Promise<void> {
		if (this.active || this.destroyed) return;
		try {
			const existing = await readExistingMobileNotificationsSnapshot(this.app.vault.adapter, this.path);
			if (existing) {
				this.lastGeneratedAtEpochMs = existing.snapshot.generatedAtEpochMs;
				this.lastObservedHash = await this.hashText(existing.raw);
				this.lastObservedStat = await this.readStatSignature();
			}
			this.vaultId = await this.producerState.getOrCreateVaultId(existing?.snapshot.vault.id);
		} catch (error) {
			this.scheduleRetry();
			console.warn('Operon: mobile notifications identity initialization failed', error);
			return;
		}
		if (this.destroyed) return;
		this.active = true;
		this.unsubscribeIndex = this.indexer.subscribeIndexReconciliation(event => this.handleIndexReconciliation(event));
		this.pendingFullRebuild = true;
		try {
			await this.enqueueAndWait(() => this.reconcileAndWrite(true));
		} catch {
			// The operation queue reports the error and retains full rebuild intent.
		}
		this.scheduleStartupRefreshes();
		this.scheduleRefresh();
	}

	private scheduleStartupRefreshes(): void {
		const delays = [...this.startupRefreshDelaysMs]
			.filter(delay => Number.isFinite(delay) && delay >= 0)
			.sort((left, right) => left - right);
		this.startupActivatedAtEpochMs = this.now();
		const finalDelay = delays.length === 0 ? undefined : delays[delays.length - 1];
		if (finalDelay === undefined) {
			this.startMonitoring();
			return;
		}
		for (const delay of delays) {
			const timer = this.ownerWindow.setTimeout(() => {
				if (!this.startupTimers.has(timer)) return;
				this.startupTimers.delete(timer);
				const elapsed = Math.max(delay, this.now() - this.startupActivatedAtEpochMs);
				for (const [pendingTimer, pendingDelay] of this.startupTimers) {
					if (pendingDelay > elapsed) continue;
					this.ownerWindow.clearTimeout(pendingTimer);
					this.startupTimers.delete(pendingTimer);
				}
				this.enqueue(async () => {
					this.pendingFullRebuild = true;
					try {
						await this.reconcileAndWrite(true);
					} finally {
						if (elapsed >= finalDelay) this.startMonitoring();
					}
				});
			}, delay);
			this.startupTimers.set(timer, delay);
		}
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
		if (!this.active || this.destroyed) return;
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
			const provisionalSnapshot = this.createSnapshot(this.nextGeneratedAt());
			const semanticSignature = semanticSnapshotSignature(provisionalSnapshot);
			if (!forceRefresh && semanticSignature === this.lastSemanticSignature) {
				this.scheduleFollowUpIfNeeded(generationAtStart);
				return;
			}
			await this.persist(provisionalSnapshot);
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

	private nextGeneratedAt(): number {
		return Math.max(this.now(), this.lastGeneratedAtEpochMs + 1);
	}

	private createSnapshot(generatedAtEpochMs: number): MobileNotificationsSnapshot {
		if (!this.vaultId) throw new Error('Operon: mobile notification vault id is unavailable');
		return buildMobileNotificationsSnapshotFromCandidates({
			generatedAtEpochMs,
			vaultId: this.vaultId,
			vaultName: this.getVaultName(),
			timezone: this.getTimezone(),
			catchUpMinutes: this.getCatchUpMinutes(),
			appearanceSettings: this.getAppearanceSettings(),
			isSystemReminderFieldEnabled: this.isSystemReminderFieldEnabled,
			enabled: true,
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
		try {
			const candidate = buildMobileNotificationsTaskCandidate({
				task,
				vaultTimezone: this.getTimezone(),
				appearanceSettings: this.getAppearanceSettings(),
				isDuplicateOperonId: id => this.indexer.hasDuplicateOperonIdConflict(id),
				isSystemReminderFieldEnabled: this.isSystemReminderFieldEnabled,
			})[0];
			if (candidate) this.candidateByOperonId.set(operonId, candidate);
		} catch (error) {
			console.warn('Operon: skipped malformed mobile notification candidate', operonId, error);
		}
	}

	private async persist(snapshot: MobileNotificationsSnapshot): Promise<void> {
		if (!this.canProduce()) throw new Error('Operon: mobile notifications snapshots are unavailable on this platform');
		const serialized = `${JSON.stringify(snapshot, null, 2)}\n`;
		const hash = await this.hashText(serialized);
		await writeMobileNotificationsSnapshotAtomically(this.app.vault.adapter, this.path, serialized);
		this.lastGeneratedAtEpochMs = snapshot.generatedAtEpochMs;
		this.lastOwnedHash = hash;
		this.lastObservedHash = hash;
		try {
			this.lastObservedStat = await this.readStatSignature();
		} catch {
			this.lastObservedStat = null;
		}
		this.clearExternalRecovery();
	}

	private startMonitoring(): void {
		if (this.monitoring || !this.active || this.destroyed) return;
		this.monitoring = true;
		this.ownerWindow.addEventListener('focus', this.handleFocus);
		this.ownerDocument.addEventListener('visibilitychange', this.handleVisibilityChange);
		this.scheduleMonitorStat();
		this.scheduleMonitorFullRead();
	}

	private scheduleMonitorStat(): void {
		if (!this.monitoring || this.destroyed) return;
		this.clearMonitorStat();
		this.monitorStatTimer = this.ownerWindow.setTimeout(() => {
			this.monitorStatTimer = null;
			this.enqueue(async () => {
				try {
					await this.monitorExternalSnapshot(false);
				} finally {
					this.scheduleMonitorStat();
				}
			});
		}, this.monitorStatIntervalMs);
	}

	private scheduleMonitorFullRead(): void {
		if (!this.monitoring || this.destroyed) return;
		this.clearMonitorFullRead();
		this.monitorFullReadTimer = this.ownerWindow.setTimeout(() => {
			this.monitorFullReadTimer = null;
			this.enqueue(async () => {
				try {
					await this.monitorExternalSnapshot(true);
				} finally {
					this.scheduleMonitorFullRead();
				}
			});
		}, this.monitorFullReadIntervalMs);
	}

	private requestMonitorCheck(forceRead: boolean): void {
		if (!this.monitoring || this.destroyed) return;
		this.enqueue(() => this.monitorExternalSnapshot(forceRead));
	}

	private async monitorExternalSnapshot(forceRead: boolean): Promise<void> {
		if (!this.active || this.destroyed) return;
		if (!forceRead && this.ownerDocument.visibilityState === 'hidden') return;
		let statSignature: string | null;
		try {
			statSignature = await this.readStatSignature();
		} catch {
			this.scheduleExternalRecovery();
			return;
		}
		if (!forceRead && statSignature !== null && statSignature === this.lastObservedStat) return;
		if (statSignature === null) {
			this.scheduleExternalRecovery();
			return;
		}
		let raw: string;
		try {
			raw = await this.app.vault.adapter.read(this.path);
		} catch {
			this.scheduleExternalRecovery();
			return;
		}
		let hash: string;
		try {
			hash = await this.hashText(raw);
		} catch {
			this.scheduleExternalRecovery();
			return;
		}
		this.lastObservedStat = statSignature;
		if (hash === this.lastObservedHash) {
			this.clearExternalRecovery();
			return;
		}
		if (hash === this.lastOwnedHash) {
			this.lastObservedHash = hash;
			this.clearExternalRecovery();
			return;
		}
		const external = parseMobileNotificationsSnapshot(raw);
		if (!external) {
			this.scheduleExternalRecovery();
			return;
		}
		this.lastObservedHash = hash;
		this.clearExternalRecovery();
		this.lastGeneratedAtEpochMs = Math.max(this.lastGeneratedAtEpochMs, external.generatedAtEpochMs);
		const externalSemantic = semanticSnapshotSignature(external);
		if (externalSemantic === this.lastSemanticSignature) return;
		this.pendingFullRebuild = true;
		await this.reconcileAndWrite(true);
	}

	private scheduleExternalRecovery(): void {
		if (this.recoveryTimer !== null || this.destroyed || !this.active) return;
		if (this.recoveryAttempt >= this.recoveryAttempts) {
			this.recoveryAttempt = 0;
			this.pendingFullRebuild = true;
			this.enqueue(() => this.reconcileAndWrite(true));
			return;
		}
		this.recoveryAttempt += 1;
		this.recoveryTimer = this.ownerWindow.setTimeout(() => {
			this.recoveryTimer = null;
			this.enqueue(() => this.monitorExternalSnapshot(true));
		}, this.recoveryDelayMs);
	}

	private clearExternalRecovery(): void {
		this.recoveryAttempt = 0;
		if (this.recoveryTimer === null) return;
		this.ownerWindow.clearTimeout(this.recoveryTimer);
		this.recoveryTimer = null;
	}

	private async readStatSignature(): Promise<string | null> {
		const stat = await this.app.vault.adapter.stat(this.path);
		return stat ? statSignature(stat) : null;
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
		this.retryTimer = this.ownerWindow.setTimeout(() => {
			this.retryTimer = null;
			void this.enqueueLifecycle(async () => {
				if (this.active) await this.enqueueAndWait(() => this.reconcileAndWrite(true));
				else await this.activate();
			});
		}, DEFAULT_MONITOR_STAT_INTERVAL_MS);
	}

	private stopTimersAndMonitoring(): void {
		this.clearDebounce();
		this.clearRefresh();
		this.clearRetry();
		this.clearMonitorStat();
		this.clearMonitorFullRead();
		this.clearExternalRecovery();
			for (const timer of this.startupTimers.keys()) this.ownerWindow.clearTimeout(timer);
			this.startupTimers.clear();
		if (this.monitoring) {
			this.ownerWindow.removeEventListener('focus', this.handleFocus);
			this.ownerDocument.removeEventListener('visibilitychange', this.handleVisibilityChange);
			this.monitoring = false;
		}
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

	private clearMonitorStat(): void {
		if (this.monitorStatTimer === null) return;
		this.ownerWindow.clearTimeout(this.monitorStatTimer);
		this.monitorStatTimer = null;
	}

	private clearMonitorFullRead(): void {
		if (this.monitorFullReadTimer === null) return;
		this.ownerWindow.clearTimeout(this.monitorFullReadTimer);
		this.monitorFullReadTimer = null;
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

async function readExistingMobileNotificationsSnapshot(
	adapter: Pick<DataAdapter, 'exists' | 'read'>,
	path: string,
): Promise<{ raw: string; snapshot: MobileNotificationsSnapshot } | null> {
	try {
		if (!await adapter.exists(path)) return null;
		const raw = await adapter.read(path);
		const snapshot = parseMobileNotificationsSnapshot(raw);
		return snapshot ? { raw, snapshot } : null;
	} catch {
		return null;
	}
}

function parseMobileNotificationsSnapshot(raw: string): MobileNotificationsSnapshot | null {
	try {
		const snapshot = JSON.parse(raw) as MobileNotificationsSnapshot;
		validateMobileNotificationsSnapshot(snapshot);
		return snapshot;
	} catch {
		return null;
	}
}

function semanticSnapshotSignature(snapshot: MobileNotificationsSnapshot): string {
	return JSON.stringify({
		schemaVersion: snapshot.schemaVersion,
		enabled: snapshot.enabled,
		authoritative: snapshot.authoritative,
		vault: snapshot.vault,
		timezone: snapshot.timezone,
		window: {
			horizonDays: snapshot.window.horizonDays,
			catchUpMinutes: snapshot.window.catchUpMinutes,
		},
		sourcePolicy: snapshot.sourcePolicy,
		tasks: snapshot.tasks,
	});
}

function statSignature(stat: Stat): string {
	return `${stat.type}:${stat.mtime}:${stat.size}`;
}

async function sha256Text(text: string, preferredCrypto?: Crypto): Promise<string> {
	const cryptoApi = preferredCrypto ?? window.crypto;
	if (!cryptoApi?.subtle) throw new Error('Operon: SHA-256 is unavailable for mobile notification monitoring');
	const digest = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
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
