import { AggregateCoordinator, AggregateRefreshResult } from './aggregate-coordinator';
import { OperonIndexer } from '../indexer/indexer';
import {
	CURRENT_TASK_STATS_BACKFILL_VERSION,
	OperonSettings,
} from '../types/settings';
import { TASK_STATS_CANONICAL_KEYS } from '../types/keys';

export interface TaskStatsBackfillResult extends AggregateRefreshResult {
	parentTaskCount: number;
	completed: boolean;
	skipped: boolean;
}

export interface TaskStatsBackfillRunnerOptions {
	force?: boolean;
}

export class TaskStatsBackfillRunner {
	private indexer: OperonIndexer;
	private aggregateCoordinator: AggregateCoordinator;
	private getSettings: () => OperonSettings;
	private markComplete: (version: number) => Promise<void>;

	constructor(
		indexer: OperonIndexer,
		aggregateCoordinator: AggregateCoordinator,
		getSettings: () => OperonSettings,
		markComplete: (version: number) => Promise<void>,
	) {
		this.indexer = indexer;
		this.aggregateCoordinator = aggregateCoordinator;
		this.getSettings = getSettings;
		this.markComplete = markComplete;
	}

	async run(options: TaskStatsBackfillRunnerOptions = {}): Promise<TaskStatsBackfillResult> {
		if (!options.force && this.getSettings().taskStatsBackfillVersion >= CURRENT_TASK_STATS_BACKFILL_VERSION) {
			return this.emptyResult(true, true);
		}

		const parentIds = this.collectParentTaskIds();
		const aggregateResult = await this.aggregateCoordinator.refreshAfterTaskIds(parentIds);
		const completed = aggregateResult.failedWriteCount === 0;
		if (completed) {
			await this.markComplete(CURRENT_TASK_STATS_BACKFILL_VERSION);
		}
		return {
			...aggregateResult,
			parentTaskCount: parentIds.length,
			completed,
			skipped: false,
		};
	}

	private collectParentTaskIds(): string[] {
		return this.indexer.getAllTasks()
			.filter(task => (
				this.indexer.secondary.getChildIds(task.operonId).size > 0
				|| this.hasStoredTaskStats(task)
			))
			.map(task => task.operonId)
			.sort((left, right) => left.localeCompare(right));
	}

	private hasStoredTaskStats(task: { fieldValues: Record<string, string | undefined> }): boolean {
		return TASK_STATS_CANONICAL_KEYS.some(key => (task.fieldValues[key] ?? '').trim() !== '');
	}

	private emptyResult(completed: boolean, skipped: boolean): TaskStatsBackfillResult {
		return {
			parentCount: 0,
			parentTaskCount: 0,
			writeCount: 0,
			failedWriteCount: 0,
			fileCount: 0,
			indexPatch: false,
			fallbackReindex: false,
			precommittedWriteCount: 0,
			skippedPrecommittedCount: 0,
			completed,
			skipped,
		};
	}
}
