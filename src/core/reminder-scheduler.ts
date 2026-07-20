import type { App, EventRef } from 'obsidian';
import type { IndexedTask } from '../types/fields';
import type { ReminderCatchUpWindowMinutes } from '../types/settings';
import type { IndexReconciliationEvent, OperonIndexer } from '../indexer/indexer';
import type {
	ReminderDeliveryBatchResult,
	ReminderDeliveryItem,
	ReminderDeliveryPort,
} from '../systems/reminder-delivery';
import {
	buildReminderOccurrences,
	isReminderOccurrenceDue,
	REMINDER_MAX_CATCH_UP_MINUTES,
	type ReminderOccurrence,
} from './reminder-scheduler-model';
import {
	getOrCreateReminderDeviceId,
	ReminderDeliveryStore,
	type ReminderTaskLifecycle,
} from '../storage/reminder-delivery-store';
import { getWorkspaceWindows, isWindowVisibleAndFocused } from './dom-compat';
import { splitTaskListValue } from './task-field-patch';

const MAX_TIMER_DELAY_MS = 24 * 60 * 60 * 1_000;
const LEDGER_RETENTION_MS = 7 * MAX_TIMER_DELAY_MS;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000] as const;

export interface ReminderSchedulerOptions {
	app: App;
	indexer: OperonIndexer;
	deliveryPort: ReminderDeliveryPort;
	getCatchUpWindowMinutes: () => ReminderCatchUpWindowMinutes;
	onDueTasks?: (tasks: readonly IndexedTask[]) => void | Promise<void>;
	isSystemReminderFieldEnabled?: (fieldKey: ReminderOccurrence['sources'][number]['fieldKey']) => boolean;
	ownerWindow?: Window;
	now?: () => number;
}

export class ReminderScheduler {
	private readonly app: App;
	private readonly indexer: OperonIndexer;
	private readonly deliveryPort: ReminderDeliveryPort;
	private readonly getCatchUpWindowMinutes: () => ReminderCatchUpWindowMinutes;
	private readonly onDueTasks: (tasks: readonly IndexedTask[]) => void | Promise<void>;
	private readonly isSystemReminderFieldEnabled: (fieldKey: ReminderOccurrence['sources'][number]['fieldKey']) => boolean;
	private readonly ownerWindow: Window;
	private readonly boundWorkspaceWindows = new Map<Window, () => void>();
	private readonly workspaceEventRefs: EventRef[] = [];
	private readonly now: () => number;
	private readonly store: ReminderDeliveryStore;
	private readonly occurrences = new Map<string, ReminderOccurrence>();
	private readonly occurrenceKeysByTask = new Map<string, Set<string>>();
	private readonly dueTaskAutomationHandledKeys = new Set<string>();
	private unsubscribeIndex: (() => void) | null = null;
	private timer: number | null = null;
	private operationTail: Promise<void> = Promise.resolve();
	private started = false;
	private destroyed = false;
	private catchUpWindowMinutes: ReminderCatchUpWindowMinutes;
	private systemReminderFieldsSignature: string;
	private persistenceRetryAtMs: number | null = null;
	private persistenceRetryIndex = 0;
	private deliveryRetryAtMs: number | null = null;
	private deliveryRetryIndex = 0;

	constructor(options: ReminderSchedulerOptions) {
		this.app = options.app;
		this.indexer = options.indexer;
		this.deliveryPort = options.deliveryPort;
		this.getCatchUpWindowMinutes = options.getCatchUpWindowMinutes;
		this.onDueTasks = options.onDueTasks ?? (() => { });
		this.isSystemReminderFieldEnabled = options.isSystemReminderFieldEnabled ?? (() => true);
		this.ownerWindow = options.ownerWindow
			?? options.app.workspace.containerEl.ownerDocument.defaultView
			?? window;
		this.now = options.now ?? (() => Date.now());
		this.catchUpWindowMinutes = this.getCatchUpWindowMinutes();
		this.systemReminderFieldsSignature = this.getSystemReminderFieldsSignature();
		let localStorage: Storage | null = null;
		try {
			localStorage = this.ownerWindow.localStorage;
		} catch {
			// A restricted WebView may deny local storage; session isolation still remains fail-safe.
		}
		const deviceId = getOrCreateReminderDeviceId(localStorage);
		this.store = new ReminderDeliveryStore(options.app, deviceId);
	}

	async start(): Promise<void> {
		if (this.started || this.destroyed) return;
		try {
			await this.store.load();
		} catch (error) {
			console.warn('Operon: Reminder scheduler startup was skipped because its ledger could not be initialized', error);
			return;
		}
		if (this.destroyed) return Promise.resolve();
		this.started = true;
		this.unsubscribeIndex = this.indexer.subscribeIndexReconciliation(event => {
			this.enqueue(() => this.handleIndexReconciliation(event));
		});
		this.bindKnownWorkspaceWindows();
		this.bindWorkspaceWindowLifecycle();
		await this.enqueueAndWait(() => this.reconcileAll());
	}

	handleSettingsChanged(): void {
		const next = this.getCatchUpWindowMinutes();
		const nextFieldSignature = this.getSystemReminderFieldsSignature();
		if (next === this.catchUpWindowMinutes && nextFieldSignature === this.systemReminderFieldsSignature) return;
		this.catchUpWindowMinutes = next;
		this.systemReminderFieldsSignature = nextFieldSignature;
		this.enqueue(() => this.reconcileAll());
	}

	async destroy(): Promise<void> {
		if (this.destroyed) return;
		this.clearTimer();
		this.unsubscribeIndex?.();
		this.unsubscribeIndex = null;
		for (const cleanup of this.boundWorkspaceWindows.values()) cleanup();
		this.boundWorkspaceWindows.clear();
		for (const eventRef of this.workspaceEventRefs) this.app.workspace.offref(eventRef);
		this.workspaceEventRefs.length = 0;
		await this.operationTail;
		this.started = false;
		this.destroyed = true;
		this.clearTimer();
		await this.store.drain();
	}

	private readonly handleWake = (): void => {
		if (!getWorkspaceWindows(this.app, this.ownerWindow).some(isWindowVisibleAndFocused)) return;
		this.enqueue(() => this.reconcileAll());
	};

	private readonly handleVisibilityChange = (): void => this.handleWake();

	private bindKnownWorkspaceWindows(): void {
		for (const ownerWindow of getWorkspaceWindows(this.app, this.ownerWindow)) {
			this.bindWorkspaceWindow(ownerWindow);
		}
	}

	private bindWorkspaceWindow(ownerWindow: Window): void {
		if (this.boundWorkspaceWindows.has(ownerWindow)) return;
		const ownerDocument = ownerWindow.document;
		ownerWindow.addEventListener('focus', this.handleWake);
		ownerDocument.addEventListener('visibilitychange', this.handleVisibilityChange);
		this.boundWorkspaceWindows.set(ownerWindow, () => {
			ownerWindow.removeEventListener('focus', this.handleWake);
			ownerDocument.removeEventListener('visibilitychange', this.handleVisibilityChange);
		});
	}

	private unbindWorkspaceWindow(ownerWindow: Window): void {
		this.boundWorkspaceWindows.get(ownerWindow)?.();
		this.boundWorkspaceWindows.delete(ownerWindow);
	}

	private bindWorkspaceWindowLifecycle(): void {
		const workspace = this.app.workspace;
		if (typeof workspace.on !== 'function' || typeof workspace.offref !== 'function') return;
		this.workspaceEventRefs.push(
			workspace.on('window-open', (_workspaceWindow, ownerWindow) => {
				this.bindWorkspaceWindow(ownerWindow);
				this.handleWake();
			}),
			workspace.on('window-close', (_workspaceWindow, ownerWindow) => {
				this.unbindWorkspaceWindow(ownerWindow);
			}),
		);
	}

	private enqueue(operation: () => Promise<void>): void {
		void this.enqueueAndWait(operation);
	}

	private enqueueAndWait(operation: () => Promise<void>): Promise<void> {
		if (this.destroyed) return Promise.resolve();
		const next = this.operationTail.then(operation);
		this.operationTail = next.catch(error => {
			console.warn('Operon: Reminder scheduler reconciliation failed', error);
		});
		return next;
	}

	private async handleIndexReconciliation(event: IndexReconciliationEvent): Promise<void> {
		if (!this.started || this.destroyed) return;
		if (event.kind === 'full') {
			await this.reconcileAll();
			return;
		}
		const nowMs = this.now();
		const reconciliation = this.createTaskReconciliation();
		for (const operonId of event.affectedOperonIds) {
			this.reconcileTask(operonId, nowMs, reconciliation);
		}
		await this.reconcileTime(nowMs, reconciliation);
	}

	private async reconcileAll(): Promise<void> {
		if (!this.started || this.destroyed) return;
		const nowMs = this.now();
		const tasks = this.indexer.getAllTasks();
		const liveIds = new Set(tasks.map(task => task.operonId));
		const knownIds = new Set([...this.occurrenceKeysByTask.keys(), ...this.store.getLifecycleOperonIds()]);
		const reconciliation = this.createTaskReconciliation();
		for (const operonId of knownIds) {
			if (!liveIds.has(operonId)) this.reconcileTask(operonId, nowMs, reconciliation);
		}
		for (const task of tasks) {
			this.reconcileTask(task.operonId, nowMs, reconciliation);
		}
		await this.reconcileTime(nowMs, reconciliation);
	}

	private createTaskReconciliation(): {
		suppressed: ReminderOccurrence[];
		lifecycleUpserts: Omit<ReminderTaskLifecycle, 'updatedAt'>[];
		deleteLifecycleOperonIds: Set<string>;
	} {
		return { suppressed: [], lifecycleUpserts: [], deleteLifecycleOperonIds: new Set() };
	}

	private reconcileTask(
		operonId: string,
		nowMs: number,
		reconciliation: ReturnType<ReminderScheduler['createTaskReconciliation']>,
	): void {
		const task = this.indexer.getTask(operonId);
		this.removeTaskOccurrences(operonId);
		if (!task) {
			reconciliation.deleteLifecycleOperonIds.add(operonId);
			return;
		}
		// A duplicate id has no authoritative task instance. Preserve any lifecycle
		// already on disk, but do not infer terminal/reopen transitions from whichever
		// conflicting instance the index currently exposes.
		if (this.indexer.hasDuplicateOperonIdConflict(operonId)) return;
		const lifecycle = this.store.getLifecycle(operonId);
		if (!this.hasReminderSourceTokens(task)) {
			if (lifecycle) reconciliation.deleteLifecycleOperonIds.add(operonId);
			return;
		}
		if (task.checkbox !== 'open') {
			if (lifecycle?.state !== 'terminal') {
				reconciliation.lifecycleUpserts.push({
					operonId,
					state: 'terminal',
					terminalObservedAtMs: nowMs,
				});
			}
			return;
		}
		let reopenCutoffMs = lifecycle?.state === 'open' ? lifecycle.reopenCutoffMs : undefined;
		if (lifecycle?.state === 'terminal') {
			reopenCutoffMs = nowMs;
			reconciliation.lifecycleUpserts.push({
				operonId,
				state: 'open',
				terminalObservedAtMs: lifecycle.terminalObservedAtMs,
				reopenCutoffMs,
			});
		}
		const occurrences = this.buildTaskOccurrences(task);
		const keys = new Set<string>();
		for (const occurrence of occurrences) {
			this.occurrences.set(occurrence.key, occurrence);
			keys.add(occurrence.key);
			if (reopenCutoffMs !== undefined && occurrence.epochMs <= reopenCutoffMs) {
				reconciliation.suppressed.push(occurrence);
			}
		}
		if (keys.size > 0) this.occurrenceKeysByTask.set(operonId, keys);
	}

	private removeTaskOccurrences(operonId: string): void {
	for (const key of this.occurrenceKeysByTask.get(operonId) ?? []) {
			this.occurrences.delete(key);
	}
		this.occurrenceKeysByTask.delete(operonId);
	}

	private async reconcileTime(
		nowMs: number,
		reconciliation = this.createTaskReconciliation(),
	): Promise<void> {
		if (this.destroyed) return;
		const pending: ReminderOccurrence[] = [];
		const dueAutomationCandidates: ReminderOccurrence[] = [];
		const expire = new Map<string, 'authority-lost' | 'out-of-window'>();
		const suppressedKeys = new Set(reconciliation.suppressed.map(occurrence => occurrence.key));

		for (const record of this.store.getPending()) {
			const occurrence = this.occurrences.get(record.key);
			if (!occurrence || !this.getAuthoritativeTask(occurrence)) {
				expire.set(record.key, 'authority-lost');
				continue;
			}
			if (suppressedKeys.has(occurrence.key)) continue;
			pending.push(occurrence);
			if (isReminderOccurrenceDue(occurrence.epochMs, nowMs, this.catchUpWindowMinutes)) {
				dueAutomationCandidates.push(occurrence);
			}
			if (!isReminderOccurrenceDue(occurrence.epochMs, nowMs, this.catchUpWindowMinutes)
				&& occurrence.epochMs <= nowMs) {
				expire.set(record.key, 'out-of-window');
			}
		}

		for (const occurrence of this.occurrences.values()) {
			if (suppressedKeys.has(occurrence.key)) continue;
			if (!isReminderOccurrenceDue(occurrence.epochMs, nowMs, this.catchUpWindowMinutes)) continue;
			const existing = this.store.get(occurrence.key);
			if (existing?.state === 'delivered' || existing?.state === 'pending') continue;
			if (existing?.state === 'suppressed' || this.store.hasFinalizedSource(occurrence.sourceLogicalKeys)) continue;
			if (!this.getAuthoritativeTask(occurrence)) continue;
			pending.push(occurrence);
			dueAutomationCandidates.push(occurrence);
		}

		const expireEntries = [...expire].map(([key, reason]) => ({ key, reason }));
		const persisted = await this.persistMutation({
			pending,
			suppressed: reconciliation.suppressed,
			expire: expireEntries,
			lifecycleUpserts: reconciliation.lifecycleUpserts,
			deleteLifecycleOperonIds: reconciliation.deleteLifecycleOperonIds,
			pruneBeforeMs: nowMs - LEDGER_RETENTION_MS,
			updatedAtMs: nowMs,
		}, nowMs);
		if (persisted) {
			const dueTasksById = new Map<string, IndexedTask>();
			const handledKeys: string[] = [];
			for (const occurrence of dueAutomationCandidates) {
				if (this.dueTaskAutomationHandledKeys.has(occurrence.key)) continue;
				const task = this.getAuthoritativeTask(occurrence);
				if (task) {
					dueTasksById.set(task.operonId, task);
					handledKeys.push(occurrence.key);
				}
			}
			if (dueTasksById.size > 0) {
				try {
					await this.onDueTasks([...dueTasksById.values()]);
					for (const key of handledKeys) this.dueTaskAutomationHandledKeys.add(key);
				} catch (error) {
					console.warn('Operon: due reminder task automation failed', error);
				}
			}
			await this.deliverPending(nowMs);
		}
		this.armNextTimer(nowMs);
	}

	private async deliverPending(nowMs: number): Promise<void> {
		const items: ReminderDeliveryItem[] = [];
		const expire = new Map<string, 'authority-lost' | 'out-of-window'>();
		const pendingRecords = this.store.getPending().sort((left, right) => (
			left.epochMs - right.epochMs || left.key.localeCompare(right.key)
		));
		for (const record of pendingRecords) {
			const occurrence = this.occurrences.get(record.key);
			const task = occurrence ? this.getAuthoritativeTask(occurrence) : null;
			if (!occurrence || !task) {
				expire.set(record.key, 'authority-lost');
				continue;
			}
			if (!isReminderOccurrenceDue(occurrence.epochMs, nowMs, this.catchUpWindowMinutes)) {
				if (occurrence.epochMs <= nowMs) expire.set(record.key, 'out-of-window');
				continue;
			}
			items.push({ occurrence, task });
		}

		if (expire.size > 0) {
			const persisted = await this.persistMutation({
				expire: [...expire].map(([key, reason]) => ({ key, reason })),
				updatedAtMs: nowMs,
			}, nowMs);
			if (!persisted) return;
		}
		if (items.length === 0) {
			this.clearDeliveryRetry();
			return;
		}
		let result: ReminderDeliveryBatchResult;
		try {
			result = await this.deliveryPort.deliverBatch(items);
		} catch (error) {
			console.warn('Operon: Reminder delivery batch failed', error);
			this.scheduleDeliveryRetry(nowMs);
			return;
		}

		const submittedKeys = new Set(items.map(item => item.occurrence.key));
		const deliveredKeys = new Set(
			result.deliveredKeys.filter(key => submittedKeys.has(key)),
		);
		const deferredKeys = new Set(
			result.deferredKeys.filter(key => (
				submittedKeys.has(key) && !deliveredKeys.has(key)
			)),
		);
		const retryKeys = new Set(
			result.retryKeys.filter(key => (
				submittedKeys.has(key)
					&& !deliveredKeys.has(key)
					&& !deferredKeys.has(key)
			)),
		);
		for (const key of submittedKeys) {
			if (!deliveredKeys.has(key) && !deferredKeys.has(key)) {
				retryKeys.add(key);
			}
		}

		if (deliveredKeys.size > 0) {
			await this.persistMutation({ deliveredKeys, updatedAtMs: nowMs }, nowMs);
		}
		if (retryKeys.size > 0) this.scheduleDeliveryRetry(nowMs);
		else this.clearDeliveryRetry();
	}

	private getAuthoritativeTask(occurrence: ReminderOccurrence): IndexedTask | null {
		const task = this.indexer.getTask(occurrence.operonId);
		if (!task || task.checkbox !== 'open') return null;
		if (this.indexer.hasDuplicateOperonIdConflict(occurrence.operonId)) return null;
		return this.buildTaskOccurrences(task).some(candidate => (
			candidate.key === occurrence.key
				&& candidate.sourceLogicalKeys.length === occurrence.sourceLogicalKeys.length
				&& candidate.sourceLogicalKeys.every(key => occurrence.sourceLogicalKeys.includes(key))
		)) ? task : null;
	}

	private buildTaskOccurrences(task: IndexedTask): ReminderOccurrence[] {
		return buildReminderOccurrences(task, this.isSystemReminderFieldEnabled);
	}

	private hasReminderSourceTokens(task: IndexedTask): boolean {
		return (
			this.isSystemReminderFieldEnabled('reminderDatetimes')
			&& splitTaskListValue(task.fieldValues.reminderDatetimes).length > 0
		) || (
			this.isSystemReminderFieldEnabled('reminderRules')
			&& splitTaskListValue(task.fieldValues.reminderRules).length > 0
		);
	}

	private getSystemReminderFieldsSignature(): string {
		return `${Number(this.isSystemReminderFieldEnabled('reminderDatetimes'))}:${Number(this.isSystemReminderFieldEnabled('reminderRules'))}`;
	}

	private async persistMutation(
		mutation: Parameters<ReminderDeliveryStore['mutate']>[0],
		nowMs: number,
	): Promise<boolean> {
		try {
			await this.store.mutate(mutation);
			this.persistenceRetryAtMs = null;
			this.persistenceRetryIndex = 0;
			return true;
		} catch (error) {
			// In-memory ledger state is retained, so the session still deduplicates.
			console.warn('Operon: Reminder delivery ledger write failed', error);
			const retryDelayMs = RETRY_DELAYS_MS[this.persistenceRetryIndex]
				?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
			this.persistenceRetryAtMs = nowMs + retryDelayMs;
			this.persistenceRetryIndex = Math.min(this.persistenceRetryIndex + 1, RETRY_DELAYS_MS.length - 1);
			return false;
		}
	}

	private scheduleDeliveryRetry(nowMs: number): void {
		const retryDelayMs = RETRY_DELAYS_MS[this.deliveryRetryIndex]
			?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
		this.deliveryRetryAtMs = nowMs + retryDelayMs;
		this.deliveryRetryIndex = Math.min(this.deliveryRetryIndex + 1, RETRY_DELAYS_MS.length - 1);
	}

	private clearDeliveryRetry(): void {
		this.deliveryRetryAtMs = null;
		this.deliveryRetryIndex = 0;
	}

	private armNextTimer(nowMs: number): void {
		this.clearTimer();
		let nextEpochMs = Number.POSITIVE_INFINITY;
		for (const occurrence of this.occurrences.values()) {
			if (occurrence.epochMs > nowMs && occurrence.epochMs < nextEpochMs) {
				nextEpochMs = occurrence.epochMs;
			}
		}
		for (const retryAtMs of [this.persistenceRetryAtMs, this.deliveryRetryAtMs]) {
			if (retryAtMs !== null && retryAtMs < nextEpochMs) nextEpochMs = retryAtMs;
		}
		if (!Number.isFinite(nextEpochMs) || this.destroyed) return;
		const delayMs = Math.min(Math.max(0, nextEpochMs - nowMs), MAX_TIMER_DELAY_MS);
		this.timer = this.ownerWindow.setTimeout(() => {
			this.timer = null;
			this.enqueue(() => this.reconcileAll());
		}, delayMs);
	}

	private clearTimer(): void {
		if (this.timer === null) return;
		this.ownerWindow.clearTimeout(this.timer);
		this.timer = null;
	}
}

export function getReminderSchedulerLookbackStart(nowMs: number): number {
	return nowMs - REMINDER_MAX_CATCH_UP_MINUTES * 60_000;
}

export function resolveReminderTaskOccurrences(task: IndexedTask): ReminderOccurrence[] {
	return buildReminderOccurrences(task);
}
