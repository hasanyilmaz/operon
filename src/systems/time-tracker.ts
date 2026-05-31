import { App, Notice } from 'obsidian';
import { OperonIndexer } from '../indexer/indexer';
import { TaskWriter } from '../core/task-writer';
import { localNow } from '../core/local-time';
import { IndexedTask } from '../types/fields';
import { OperonSettings } from '../types/settings';
import { t } from '../core/i18n';
import { resolveAutomationWorkflowStatus, resolveReverseWorkflowFromTerminalDate } from '../types/pipeline';
import { TotalDurationCalculator } from './total-duration';
import { TotalEstimateCalculator } from './total-estimate';
import {
	buildTrackerRange,
	calculateDurationFromTrackers,
	formatDurationHuman,
	isLocalDateInRange,
	normalizeActiveTrackerValue,
	parseLocalDatetime,
	parseTrackerList,
	serializeTrackerList,
	splitTrackerRangeByMidnight,
} from './tracker-utils';
import {
	ActiveTrackerRecord,
	ActiveTrackerState,
	TimeTrackerTransitionState,
	TrackerHistoryDayGroup,
	TrackerSession,
	TrackerSource,
	TrackerStopReason,
} from '../types/tracker';
import { ActiveTrackerStoreLike } from '../storage/active-tracker-store';
import { WindowIntervalHandle, clearWindowInterval, setWindowInterval } from '../core/dom-compat';
import { getAppLocale } from '../core/obsidian-app';
import { enginePerfLog } from '../core/engine-perf';

export type TimeTrackerEvent = 'tick' | 'state' | 'history' | 'transition';
type TimeTrackerListener = (event: TimeTrackerEvent) => void;

interface InternalActiveTracker {
	id: string;
	operonId: string | null;
	start: string;
	source: TrackerSource;
}

interface ResumeFromIndexOptions {
	migrateLegacy?: boolean;
}

interface ReopenTaskResult {
	task: IndexedTask;
	ok: boolean;
}

type ExternalTaskMutationPersist = (payload: Record<string, string>) => Promise<boolean>;
export type TimeTrackerStatusChangeGuard = (
	task: IndexedTask,
	payload: Record<string, string>,
	context: { action: 'timer-start-reopen' | 'timer-start-tracking-status' },
) => Promise<boolean> | boolean;

interface HistoryCacheEntry {
	rangeDays: number;
	generation: number;
	locale: string;
	groups: TrackerHistoryDayGroup[];
}

export class TimeTracker {
	private app: App;
	private indexer: OperonIndexer;
	private writer: TaskWriter;
	private activeTrackerStore: ActiveTrackerStoreLike;
	private totalDurationCalculator: TotalDurationCalculator;
	private getSettings: () => OperonSettings;
	private refreshDurationAggregates: (operonId: string) => Promise<void>;
	private onDuplicateOperonId: ((operonId: string) => void) | null;
	private statusChangeGuard: TimeTrackerStatusChangeGuard | null;
	private listeners: Set<TimeTrackerListener> = new Set();
	private activeTracker: InternalActiveTracker | null = null;
	private tickerInterval: WindowIntervalHandle | null = null;
	private stopPromise: Promise<boolean> | null = null;
	private transitionQueue: Promise<unknown> = Promise.resolve();
	private transitionState: TimeTrackerTransitionState | null = null;
	private finalizedActiveRecordIds: Set<string> = new Set();
	private historyCache: HistoryCacheEntry | null = null;

	constructor(
		app: App,
		indexer: OperonIndexer,
		writer: TaskWriter,
		activeTrackerStore: ActiveTrackerStoreLike,
			totalDurationCalculator: TotalDurationCalculator,
			_totalEstimateCalculator: TotalEstimateCalculator,
			getSettings: () => OperonSettings,
			onDuplicateOperonId?: (operonId: string) => void,
			refreshDurationAggregates?: (operonId: string) => Promise<void>,
			statusChangeGuard?: TimeTrackerStatusChangeGuard,
		) {
		this.app = app;
		this.indexer = indexer;
		this.writer = writer;
			this.activeTrackerStore = activeTrackerStore;
			this.totalDurationCalculator = totalDurationCalculator;
			this.getSettings = getSettings;
			this.refreshDurationAggregates = refreshDurationAggregates ?? ((operonId) => this.refreshAggregateChainsLegacy(operonId));
			this.onDuplicateOperonId = onDuplicateOperonId ?? null;
			this.statusChangeGuard = statusChangeGuard ?? null;
		}

	subscribe(listener: TimeTrackerListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private emit(event: TimeTrackerEvent): void {
		for (const listener of this.listeners) {
			listener(event);
		}
	}

	getTransitionState(): TimeTrackerTransitionState | null {
		return this.transitionState ? { ...this.transitionState } : null;
	}

	private setTransitionState(state: TimeTrackerTransitionState): void {
		this.transitionState = { ...state };
		enginePerfLog(
			'flowtime.optimisticTimer',
			`kind=${state.kind}`,
			'applied=true',
			`taskId=${state.taskId ?? 'none'}`,
			`source=${state.source}`,
			'fallbackReason=none',
		);
		this.emit('transition');
	}

	private clearTransitionState(): void {
		if (!this.transitionState) return;
		this.transitionState = null;
		this.emit('transition');
	}

	private startTicker(): void {
		if (this.tickerInterval) return;
		this.tickerInterval = setWindowInterval(() => {
			if (!this.activeTracker) {
				this.stopTicker();
				return;
			}
			this.emit('tick');
		}, 1000);
	}

	private stopTicker(): void {
		if (!this.tickerInterval) return;
		clearWindowInterval(this.tickerInterval);
		this.tickerInterval = null;
	}

	async resumeFromIndex(options: ResumeFromIndexOptions = {}): Promise<void> {
		const storedActive = this.activeTrackerStore.getActiveForUser();
		if (storedActive) {
			this.activeTracker = this.activeRecordToInternal(storedActive);
			if (this.activeTracker.operonId && !this.indexer.getTask(this.activeTracker.operonId)) {
				await this.clearActiveTracker();
				this.stopTicker();
				this.emit('state');
				return;
			}
			this.startTicker();
			this.emit('state');
			return;
		}

		if (!options.migrateLegacy) {
			this.activeTracker = null;
			this.stopTicker();
			this.emit('state');
			return;
		}

		const activeCandidates = this.indexer
			.getAllTasks()
			.map(task => ({
				task,
				start: normalizeActiveTrackerValue(task.fieldValues['activeTracker']),
			}))
			.filter(candidate => !!candidate.start)
			.sort((a, b) => {
				const aMs = parseLocalDatetime(a.start)?.getTime() ?? 0;
				const bMs = parseLocalDatetime(b.start)?.getTime() ?? 0;
				return bMs - aMs;
			});

		if (activeCandidates.length === 0) {
			if (this.activeTracker && !this.activeTracker.operonId) {
				this.startTicker();
				this.emit('state');
				return;
			}
			this.activeTracker = null;
			this.stopTicker();
			this.emit('state');
			return;
		}

		const [chosen, ...extras] = activeCandidates;
		if (extras.length > 0) {
			new Notice(t('notifications', 'multipleActiveTrackersResolved', { count: String(activeCandidates.length) }));
		}

		try {
			await this.setActiveTracker(chosen.task.operonId, chosen.start, 'command');
		} catch (error) {
			console.error('Operon: Failed to migrate legacy active tracker into runtime store', error);
			new Notice(t('notifications', 'taskSaveFailed'));
			this.activeTracker = null;
			this.stopTicker();
			this.emit('state');
			return;
		}

		for (const candidate of activeCandidates) {
			const cleared = await this.writer.writeTaskFields(candidate.task.operonId, { activeTracker: '' }, {
				reindex: 'none',
				touchAncestors: false,
			});
			if (cleared !== false) {
				await this.indexer.reindexFilePath(candidate.task.primary.filePath);
			} else {
				console.warn(`Operon: Failed to clear legacy activeTracker for ${candidate.task.operonId}`);
			}
		}

		this.startTicker();
		this.emit('state');
	}

	async start(operonId: string, source: TrackerSource = 'command', startOverride?: string | null): Promise<boolean> {
		return this.enqueueTransition(() => this.startInternal(operonId, source, startOverride));
	}

	private async startInternal(operonId: string, source: TrackerSource = 'command', startOverride?: string | null): Promise<boolean> {
		this.syncActiveFromStore();
		if (
			typeof (this.indexer as OperonIndexer & { hasDuplicateOperonIdConflict?: (id: string) => boolean }).hasDuplicateOperonIdConflict === 'function'
			&& (this.indexer as OperonIndexer & { hasDuplicateOperonIdConflict: (id: string) => boolean }).hasDuplicateOperonIdConflict(operonId)
		) {
			this.onDuplicateOperonId?.(operonId);
			return false;
		}
			if (this.activeTracker?.operonId === operonId) {
				return true;
			}

			let task = this.indexer.getTask(operonId);
			if (!task) return false;
			if (!await this.guardTaskStartStatusChanges(task)) {
				return false;
			}

			if (this.activeTracker && this.activeTracker.operonId && this.activeTracker.operonId !== operonId) {
				const stopped = await this.stopActive('switch');
				if (!stopped) return false;
			}

			const previousActiveState = this.getActiveState();
		const previousActive = this.activeTrackerStore.getActiveForUser();
		const start = this.activeTracker && !this.activeTracker.operonId
			? this.activeTracker.start
			: (startOverride?.trim() || localNow());
		try {
			await this.setActiveTracker(operonId, start, source);
			this.setTransitionState({
				kind: 'starting',
				taskId: operonId,
				start,
				source,
				startedAtMs: Date.now(),
				previousActive: previousActiveState,
			});
			this.startTicker();
		} catch (error) {
			console.error('Operon: Failed to start active timer', error);
			new Notice(t('notifications', 'taskSaveFailed'));
			enginePerfLog(
				'flowtime.optimisticTimer',
				'kind=starting',
				'applied=false',
				`taskId=${operonId}`,
				`source=${source}`,
				'fallbackReason=active-store-write-failed',
			);
			this.syncActiveFromStore();
			this.emit('state');
			return false;
		}

		try {
			const reopened = await this.reopenTaskIfTerminal(task);
			if (!reopened.ok) {
				throw new Error('Failed to reopen terminal task before starting timer');
			}
			task = reopened.task;
			const settings = this.getSettings();
			const trackingWorkflow = resolveAutomationWorkflowStatus(
				settings.pipelines,
				task.fieldValues['status'],
				settings.defaultPipelineName,
				'tracking',
			);
			if (trackingWorkflow && (task.fieldValues['status'] ?? '') !== trackingWorkflow.value) {
				const wrote = await this.writer.writeTaskFields(operonId, {
					status: trackingWorkflow.value,
					datetimeModified: localNow(),
				}, { reindex: 'none' });
				if (wrote === false) {
					throw new Error('Failed to write tracking status before starting timer');
				}
				await this.indexer.reindexFilePath(task.primary.filePath);
			}
		} catch (error) {
			console.error('Operon: Failed to apply task updates for timer start', error);
			new Notice(t('notifications', 'taskSaveFailed'));
			await this.restoreActiveRecord(previousActive);
			this.clearTransitionState();
			this.emit('state');
			return false;
		}

		this.clearTransitionState();
		this.startTicker();
		this.emit('state');
		return true;
	}

	private async guardTaskStartStatusChanges(task: IndexedTask): Promise<boolean> {
		if (!this.statusChangeGuard) return true;
		const reopenPayload = this.buildTerminalReopenPayload(task);
		let taskForTracking = task;
		if (reopenPayload) {
			const allowed = await this.statusChangeGuard(task, reopenPayload, { action: 'timer-start-reopen' });
			if (!allowed) return false;
			taskForTracking = this.previewTaskWithPayload(task, reopenPayload);
		}

		const settings = this.getSettings();
		const trackingWorkflow = resolveAutomationWorkflowStatus(
			settings.pipelines,
			taskForTracking.fieldValues['status'],
			settings.defaultPipelineName,
			'tracking',
		);
		if (trackingWorkflow && (taskForTracking.fieldValues['status'] ?? '') !== trackingWorkflow.value) {
			return await this.statusChangeGuard(taskForTracking, {
				status: trackingWorkflow.value,
				datetimeModified: localNow(),
			}, { action: 'timer-start-tracking-status' });
		}
		return true;
	}

	private buildTerminalReopenPayload(task: IndexedTask): Record<string, string> | null {
		if (task.checkbox === 'open') return null;
		const settings = this.getSettings();
		const terminalKey = task.checkbox === 'done' ? 'dateCompleted' : 'dateCancelled';
		const resolution = resolveReverseWorkflowFromTerminalDate(
			settings.pipelines,
			task.fieldValues['status'],
			settings.defaultPipelineName,
			terminalKey,
			'',
		);
		if (!resolution.isValid || !resolution.workflow) return null;
		return {
			status: resolution.workflow.value,
			_checkbox: resolution.checkbox,
			dateCompleted: '',
			dateCancelled: '',
			datetimeModified: localNow(),
		};
	}

	private previewTaskWithPayload(task: IndexedTask, payload: Record<string, string>): IndexedTask {
		const fieldValues = { ...task.fieldValues };
		for (const [key, value] of Object.entries(payload)) {
			if (key.startsWith('_')) continue;
			if (value) {
				fieldValues[key] = value;
			} else {
				delete fieldValues[key];
			}
		}
		return {
			...task,
			checkbox: payload['_checkbox'] === 'open' || payload['_checkbox'] === 'done' || payload['_checkbox'] === 'cancelled'
				? payload['_checkbox']
				: task.checkbox,
			fieldValues,
		};
	}

	async startUnassigned(source: TrackerSource = 'command'): Promise<boolean> {
		return this.enqueueTransition(() => this.startUnassignedInternal(source));
	}

	private async startUnassignedInternal(source: TrackerSource = 'command'): Promise<boolean> {
		this.syncActiveFromStore();
		if (this.activeTracker) {
			return !this.activeTracker.operonId;
		}

		try {
			await this.setActiveTracker(null, localNow(), source);
		} catch (error) {
			console.error('Operon: Failed to start unassigned active timer', error);
			new Notice(t('notifications', 'taskSaveFailed'));
			this.syncActiveFromStore();
			this.emit('state');
			return false;
		}
		this.startTicker();
		this.emit('state');
		return true;
	}

	async stop(_reason: TrackerStopReason = 'manual'): Promise<boolean> {
		if (this.stopPromise) return this.stopPromise;
		this.stopPromise = this.enqueueTransition(() => this.stopActive(_reason)).finally(() => {
			this.stopPromise = null;
		});
		return this.stopPromise;
	}

	async stopActiveWithExternalTaskMutation(
		operonId: string,
		end: string,
		persistPayload: ExternalTaskMutationPersist,
	): Promise<boolean> {
		if (this.stopPromise) return false;
		return await this.enqueueTransition(() => this.stopActiveWithExternalTaskMutationInternal(
			operonId,
			end,
			persistPayload,
		));
	}

	private async stopActive(_reason: TrackerStopReason): Promise<boolean> {
		this.syncActiveFromStore();
		if (!this.activeTracker) return false;

		const current = this.activeTracker;
		const previousActive = this.getActiveState();
		this.setTransitionState({
			kind: 'stopping',
			taskId: current.operonId,
			start: current.start,
			source: current.source,
			startedAtMs: Date.now(),
			previousActive,
		});

		if (!current.operonId) {
			try {
				await this.clearActiveTracker();
			} catch (error) {
				console.error('Operon: Failed to clear unassigned active timer', error);
				new Notice(t('notifications', 'taskSaveFailed'));
				this.clearTransitionState();
				this.startTicker();
				this.emit('state');
				return false;
			}
			this.clearTransitionState();
			this.stopTicker();
			this.emit('state');
			return true;
		}

		const task = this.indexer.getTask(current.operonId);
		if (!task) {
			try {
				await this.clearActiveTracker();
			} catch (error) {
				console.error('Operon: Failed to clear missing-task active timer', error);
				new Notice(t('notifications', 'taskSaveFailed'));
				this.clearTransitionState();
				this.startTicker();
				this.emit('state');
				return false;
			}
			this.clearTransitionState();
			this.stopTicker();
			this.emit('state');
			return false;
		}

		const end = localNow();
		const existingSessions = parseTrackerList(task.fieldValues['trackers'] ?? '');
		const alreadyPersisted = this.finalizedActiveRecordIds.has(current.id)
			|| existingSessions.some(session => session.start === current.start);
		if (!alreadyPersisted) {
			try {
				await this.persistTaskSessions(
					task,
					serializeTrackerList([
						...existingSessions.map(session => session.raw),
						...this.buildStoredSessionRanges(current.start, end),
					]),
					end,
				);
				this.finalizedActiveRecordIds.add(current.id);
			} catch (error) {
				console.error('Operon: Failed to stop time tracker', error);
				new Notice(t('notifications', 'taskSaveFailed'));
				this.clearTransitionState();
				this.startTicker();
				this.emit('state');
				return false;
			}
		}

		try {
			await this.clearActiveTracker();
			this.finalizedActiveRecordIds.delete(current.id);
		} catch (error) {
			console.error('Operon: Failed to clear active timer after saving session', error);
			new Notice(t('notifications', 'taskSaveFailed'));
			this.clearTransitionState();
			this.startTicker();
			this.emit('history');
			this.emit('state');
			return false;
		}
		this.clearTransitionState();
		this.stopTicker();
		this.emit('history');
		this.emit('state');
		return true;
	}

	private async stopActiveWithExternalTaskMutationInternal(
		operonId: string,
		end: string,
		persistPayload: ExternalTaskMutationPersist,
	): Promise<boolean> {
		this.syncActiveFromStore();
		const current = this.activeTracker;
		if (!current || current.operonId !== operonId) return false;
		const previousActive = this.getActiveState();
		this.setTransitionState({
			kind: 'stopping',
			taskId: current.operonId,
			start: current.start,
			source: current.source,
			startedAtMs: Date.now(),
			previousActive,
		});

		const task = this.indexer.getTask(operonId);
		if (!task) {
			this.clearTransitionState();
			return false;
		}

		const existingSessions = parseTrackerList(task.fieldValues['trackers'] ?? '');
		const alreadyPersisted = this.finalizedActiveRecordIds.has(current.id)
			|| existingSessions.some(session => session.start === current.start);
		const timerPayload: Record<string, string> = {};
		if (!alreadyPersisted) {
			const trackers = serializeTrackerList([
				...existingSessions.map(session => session.raw),
				...this.buildStoredSessionRanges(current.start, end),
			]);
			timerPayload['trackers'] = trackers;
			timerPayload['duration'] = trackers ? String(calculateDurationFromTrackers(trackers)) : '';
		}

		let persisted = false;
		try {
			persisted = await persistPayload(timerPayload);
		} catch (error) {
			console.error('Operon: Failed to stop time tracker with external task mutation', error);
			new Notice(t('notifications', 'taskSaveFailed'));
			this.clearTransitionState();
			this.startTicker();
			this.emit('state');
			return false;
		}
		if (!persisted) {
			this.clearTransitionState();
			this.startTicker();
			this.emit('state');
			return false;
		}
		if (!alreadyPersisted) {
			this.finalizedActiveRecordIds.add(current.id);
		}

		try {
			await this.clearActiveTracker();
			this.finalizedActiveRecordIds.delete(current.id);
		} catch (error) {
			console.error('Operon: Failed to clear active timer after external task mutation', error);
			new Notice(t('notifications', 'taskSaveFailed'));
			this.clearTransitionState();
			this.startTicker();
			this.emit('history');
			this.emit('state');
			return false;
		}
		this.invalidateHistoryCache();
		this.clearTransitionState();
		this.stopTicker();
		this.emit('history');
		this.emit('state');
		return true;
	}

	getTaskSessions(operonId: string): TrackerSession[] {
		const task = this.indexer.getTask(operonId);
		if (!task) return [];

		return parseTrackerList(task.fieldValues['trackers'] ?? '')
			.map((session, index) => ({
				operonId: task.operonId,
				sessionIndex: index,
				start: session.start,
				end: session.end,
				durationSeconds: session.durationSeconds,
				task,
			}))
			.sort((a, b) => b.start.localeCompare(a.start));
	}

	async addSession(operonId: string, start: string, end: string): Promise<boolean> {
		const task = this.indexer.getTask(operonId);
		if (!task) return false;

		const existingSessions = parseTrackerList(task.fieldValues['trackers'] ?? '');
		const nextTrackers = serializeTrackerList([
			...existingSessions.map(session => session.raw),
			...this.buildStoredSessionRanges(start, end),
		]);
		await this.persistTaskSessions(task, nextTrackers, localNow());
		this.emit('history');
		this.emit('state');
		return true;
	}

	async updateSession(operonId: string, sessionIndex: number, start: string, end: string): Promise<boolean> {
		const task = this.indexer.getTask(operonId);
		if (!task) return false;

		const sessions = parseTrackerList(task.fieldValues['trackers'] ?? '');
		if (sessionIndex < 0 || sessionIndex >= sessions.length) return false;

		const nextSessionRanges = sessions.map(session => session.raw);
		nextSessionRanges.splice(sessionIndex, 1, ...this.buildStoredSessionRanges(start, end));
		await this.persistTaskSessions(
			task,
			serializeTrackerList(nextSessionRanges),
			localNow(),
		);
		this.emit('history');
		this.emit('state');
		return true;
	}

	async deleteSession(operonId: string, sessionIndex: number): Promise<boolean> {
		const task = this.indexer.getTask(operonId);
		if (!task) return false;

		const sessions = parseTrackerList(task.fieldValues['trackers'] ?? '');
		if (sessionIndex < 0 || sessionIndex >= sessions.length) return false;

		sessions.splice(sessionIndex, 1);
		await this.persistTaskSessions(
			task,
			serializeTrackerList(sessions.map(session => session.raw)),
			localNow(),
		);
		this.emit('history');
		this.emit('state');
		return true;
	}

	getActiveState(): ActiveTrackerState | null {
		this.syncActiveFromStore();
		if (!this.activeTracker) return null;
		const task = this.activeTracker.operonId
			? this.indexer.getTask(this.activeTracker.operonId) ?? null
			: null;
		if (this.activeTracker.operonId && !task) return null;

		return {
			operonId: this.activeTracker.operonId,
			start: this.activeTracker.start,
			task,
			elapsedSeconds: this.getElapsedSeconds(),
			isUnassigned: !this.activeTracker.operonId,
		};
	}

	getHistory(rangeDays: number): TrackerHistoryDayGroup[] {
		const generation = this.getIndexerGeneration();
		const locale = getAppLocale(this.app) ?? '';
		if (
			this.historyCache
			&& this.historyCache.rangeDays === rangeDays
			&& this.historyCache.generation === generation
			&& this.historyCache.locale === locale
		) {
			return this.historyCache.groups;
		}

		const groups = new Map<string, TrackerHistoryDayGroup>();

		for (const task of this.indexer.getAllTasks()) {
			const sessions = parseTrackerList(task.fieldValues['trackers'] ?? '');
			for (let index = 0; index < sessions.length; index++) {
				const session = sessions[index];
				const dateKey = session.start.substring(0, 10);
				if (!isLocalDateInRange(dateKey, rangeDays)) continue;

				let group = groups.get(dateKey);
				if (!group) {
					group = {
						date: dateKey,
						label: this.formatDayLabel(dateKey),
						totalSeconds: 0,
						sessions: [],
					};
					groups.set(dateKey, group);
				}

				const historySession: TrackerSession = {
					operonId: task.operonId,
					sessionIndex: index,
					start: session.start,
					end: session.end,
					durationSeconds: session.durationSeconds,
					task,
				};
				group.totalSeconds += session.durationSeconds;
				group.sessions.push(historySession);
			}
		}

		const result = Array.from(groups.values())
			.sort((a, b) => b.date.localeCompare(a.date))
			.map(group => ({
				...group,
				sessions: group.sessions.sort((a, b) => b.start.localeCompare(a.start)),
			}));
		this.historyCache = {
			rangeDays,
			generation,
			locale,
			groups: result,
		};
		return result;
	}

	getActiveOperonId(): string | null {
		this.syncActiveFromStore();
		return this.activeTracker?.operonId ?? null;
	}

	isTimerRunning(operonId: string): boolean {
		this.syncActiveFromStore();
		return this.activeTracker?.operonId === operonId;
	}

	getElapsedSeconds(): number {
		this.syncActiveFromStore();
		if (!this.activeTracker) return 0;
		const startDate = parseLocalDatetime(this.activeTracker.start);
		if (!startDate) return 0;
		return Math.max(0, Math.floor((Date.now() - startDate.getTime()) / 1000));
	}

	getDisplaySeconds(task: IndexedTask): number {
		const base = parseInt(task.fieldValues['duration'] ?? '0', 10) || 0;
		if (!this.isTimerRunning(task.operonId)) return base;
		return base + this.getElapsedSeconds();
	}

	getActiveSessionSeconds(operonId?: string | null): number {
		this.syncActiveFromStore();
		if (!this.activeTracker) return 0;
		if (operonId && this.activeTracker.operonId !== operonId) return 0;
		return this.getElapsedSeconds();
	}

	describeActiveDuration(): string {
		const state = this.getActiveState();
		if (!state) return '';
		return formatDurationHuman(state.elapsedSeconds);
	}

	async flushPendingTransitions(): Promise<void> {
		await this.transitionQueue;
	}

	destroy(): void {
		this.stopTicker();
		this.listeners.clear();
		this.activeTracker = null;
	}

	private async reopenTaskIfTerminal(task: IndexedTask): Promise<ReopenTaskResult> {
		if (task.checkbox === 'open') return { task, ok: true };

		const settings = this.getSettings();
		const terminalKey = task.checkbox === 'done' ? 'dateCompleted' : 'dateCancelled';
		const resolution = resolveReverseWorkflowFromTerminalDate(
			settings.pipelines,
			task.fieldValues['status'],
			settings.defaultPipelineName,
			terminalKey,
			'',
		);
		if (!resolution.isValid || !resolution.workflow) {
			return { task, ok: true };
		}

		const now = localNow();
		const wrote = await this.writer.writeTaskFields(task.operonId, {
			status: resolution.workflow.value,
			_checkbox: resolution.checkbox,
			dateCompleted: '',
			dateCancelled: '',
			datetimeModified: now,
		}, { reindex: 'none' });
		if (wrote === false) {
			return { task, ok: false };
		}
		await this.indexer.reindexFilePath(task.primary.filePath);
		return { task: this.indexer.getTask(task.operonId) ?? task, ok: true };
	}

	private async persistTaskSessions(
		task: IndexedTask,
		trackers: string,
		now: string,
		extraFields: Record<string, string> = {},
	): Promise<void> {
		const duration = trackers ? String(calculateDurationFromTrackers(trackers)) : '';
		const wrote = await this.writer.writeTaskFields(task.operonId, {
			trackers,
			duration,
			datetimeModified: now,
			...extraFields,
		}, {
			reindex: 'none',
			touchAncestors: false,
		});
		if (wrote === false) {
			throw new Error('Failed to persist tracker sessions');
		}
		await this.indexer.reindexFilePath(task.primary.filePath);
		this.invalidateHistoryCache();
		await this.refreshAggregateChains(task.operonId);
	}

	private activeRecordToInternal(record: ActiveTrackerRecord): InternalActiveTracker {
		return {
			id: record.id,
			operonId: record.taskId,
			start: record.start,
			source: record.source,
		};
	}

	private syncActiveFromStore(): void {
		const record = this.activeTrackerStore.getActiveForUser();
		this.activeTracker = record ? this.activeRecordToInternal(record) : null;
	}

	private async setActiveTracker(operonId: string | null, start: string, source: TrackerSource): Promise<void> {
		const record = await this.activeTrackerStore.setActiveForUser({
			taskId: operonId,
			start,
			source,
			createdAt: start,
			updatedAt: localNow(),
		});
		this.activeTracker = this.activeRecordToInternal(record);
	}

	private async clearActiveTracker(): Promise<void> {
		await this.activeTrackerStore.clearActiveForUser();
		this.activeTracker = null;
	}

	private async restoreActiveRecord(record: ActiveTrackerRecord | null): Promise<void> {
		try {
			if (record) {
				const restored = await this.activeTrackerStore.setActiveForUser(record);
				this.activeTracker = this.activeRecordToInternal(restored);
				this.startTicker();
				return;
			}
			await this.clearActiveTracker();
			this.stopTicker();
		} catch (error) {
			console.error('Operon: Failed to restore previous active timer state', error);
			this.syncActiveFromStore();
			if (this.activeTracker) {
				this.startTicker();
			} else {
				this.stopTicker();
			}
		}
	}

	private async enqueueTransition<T>(operation: () => Promise<T>): Promise<T> {
		const run = this.transitionQueue.then(operation, operation);
		this.transitionQueue = run.catch(() => {});
		return run;
	}

	private buildStoredSessionRanges(start: string, end: string): string[] {
		const fragments = this.getSettings().trackerSplitSessionsAtMidnight
			? splitTrackerRangeByMidnight(start, end)
			: [{ start, end }];
		return fragments.map(fragment => buildTrackerRange(fragment.start, fragment.end));
	}

	private async refreshAggregateChains(operonId: string): Promise<void> {
		await this.refreshDurationAggregates(operonId);
	}

	private async refreshAggregateChainsLegacy(operonId: string): Promise<void> {
		if (this.indexer.secondary.getChildIds(operonId).size > 0) {
			await this.totalDurationCalculator.recalculate(operonId);
			return;
		}
		await this.totalDurationCalculator.recalculateForChild(operonId);
	}

	private invalidateHistoryCache(): void {
		this.historyCache = null;
	}

	private getIndexerGeneration(): number {
		const maybeIndexer = this.indexer as OperonIndexer & { getGeneration?: () => number };
		return typeof maybeIndexer.getGeneration === 'function'
			? maybeIndexer.getGeneration()
			: 0;
	}

	private formatDayLabel(dateKey: string): string {
		const date = parseLocalDatetime(`${dateKey}T00:00:00`);
		if (!date) return dateKey;
		return new Intl.DateTimeFormat(getAppLocale(this.app), {
			weekday: 'short',
			month: 'short',
			day: 'numeric',
		}).format(date);
	}
}
