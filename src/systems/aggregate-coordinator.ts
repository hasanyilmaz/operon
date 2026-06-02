import { TaskWriter } from '../core/task-writer';
import { localNow } from '../core/local-time';
import {
	enginePerfLog,
	enginePerfNow,
	formatEnginePerfTraceMetadata,
	IndexPerfContext,
	isOperonEnginePerfDebugEnabled,
} from '../core/engine-perf';
import { AggregateFieldPatch, OperonIndexer } from '../indexer/indexer';
import { IndexedTask } from '../types/fields';
import { TASK_STATS_CANONICAL_KEYS, TaskStatsCanonicalKey } from '../types/keys';

type AggregateRefreshMode = 'full' | 'duration';

interface AggregateRefreshOptions {
	modifiedTimestamp?: string;
	indexPerfContext?: IndexPerfContext;
	precommittedAggregateIds?: Set<string>;
}

interface RefreshAffectedParentsOptions extends AggregateRefreshOptions {
	forceDatetimeModifiedIds?: Set<string>;
}

interface AggregateSummary {
	hasChildren: boolean;
	childCount: number;
	totalDescendants: number;
	finishedDescendants: number;
	cancelledDescendants: number;
	effectiveDescendants: number;
	progress: string;
	taskStats: Record<TaskStatsCanonicalKey, string>;
	totalDuration: string;
	totalEstimate: string;
}

interface AggregatePayloadResult {
	payload: Record<string, string>;
	summary: AggregateSummary;
}

interface SameFileStatusCycleAggregatePlan {
	eligible: boolean;
	fallbackReason: string;
	parentId: string;
	parentPayload: Record<string, string>;
}

interface AggregateStageTimings {
	calculate: number;
	parentWrite: number;
	indexPatch: number;
	fallbackReindex: number;
}

export interface AggregateRefreshResult {
	parentCount: number;
	writeCount: number;
	failedWriteCount: number;
	fileCount: number;
	indexPatch: boolean;
	fallbackReindex: boolean;
	precommittedWriteCount: number;
	skippedPrecommittedCount: number;
}

export class AggregateCoordinator {
	private indexer: OperonIndexer;
	private writer: TaskWriter;

	constructor(indexer: OperonIndexer, writer: TaskWriter) {
		this.indexer = indexer;
		this.writer = writer;
	}

	async refreshAfterTaskMutation(
		beforeTask: IndexedTask | null,
		afterTask: IndexedTask | null,
		options: AggregateRefreshOptions = {},
	): Promise<AggregateRefreshResult> {
		const affectedIds = new Set<string>();
		this.collectTaskAndAncestors(beforeTask, affectedIds);
		this.collectTaskAndAncestors(afterTask, affectedIds);
		const forceDatetimeModifiedIds = new Set<string>();
		if ((options.modifiedTimestamp ?? '').trim()) {
			this.collectMutationAncestorIds(beforeTask, afterTask, forceDatetimeModifiedIds);
		}
		return await this.refreshAffectedParents(affectedIds, 'full', {
			modifiedTimestamp: options.modifiedTimestamp,
			forceDatetimeModifiedIds,
			indexPerfContext: options.indexPerfContext,
			precommittedAggregateIds: options.precommittedAggregateIds,
		});
	}

	planSameFileStatusCycleAggregate(
		childTask: IndexedTask,
		childPayload: Record<string, string>,
		modifiedTimestamp: string,
	): SameFileStatusCycleAggregatePlan {
		const emptyPlan = (fallbackReason: string): SameFileStatusCycleAggregatePlan => ({
			eligible: false,
			fallbackReason,
			parentId: '',
			parentPayload: {},
		});
		if (childTask.primary.format !== 'inline') return emptyPlan('child-not-inline');
		if (childTask.primary.lineNumber === undefined) return emptyPlan('child-line-missing');
		if (Object.prototype.hasOwnProperty.call(childPayload, 'parentTask')) return emptyPlan('parent-reassignment');
		if (
			childTask.fieldValues['repeat']
			|| childTask.fieldValues['repeatSeriesId']
			|| Object.prototype.hasOwnProperty.call(childPayload, 'repeat')
			|| Object.prototype.hasOwnProperty.call(childPayload, 'repeatSeriesId')
		) {
			return emptyPlan('repeat-task');
		}
		if (this.indexer.secondary.getChildIds(childTask.operonId).size > 0) {
			return emptyPlan('child-has-children');
		}

		const parentId = (childTask.fieldValues['parentTask'] ?? '').trim();
		if (!parentId) return emptyPlan('parent-missing');

		const parentTask = this.indexer.getTask(parentId);
		if (!parentTask) return emptyPlan('parent-missing');
		if (parentTask.primary.format !== 'yaml') return emptyPlan('parent-not-yaml');
		if (parentTask.primary.filePath !== childTask.primary.filePath) return emptyPlan('file-mismatch');

		const timestamp = modifiedTimestamp.trim();
		if (!timestamp) return emptyPlan('modified-timestamp-missing');

		const afterChild = this.buildTaskWithPayload(childTask, childPayload);
		const overrides = new Map<string, IndexedTask>([[afterChild.operonId, afterChild]]);
		const { payload } = this.buildAggregatePayload(parentTask, 'full', overrides);
		payload['datetimeModified'] = timestamp;
		return {
			eligible: true,
			fallbackReason: 'none',
			parentId,
			parentPayload: payload,
		};
	}

	async refreshAfterTaskRemoval(removedTasks: IndexedTask[]): Promise<AggregateRefreshResult> {
		const affectedIds = new Set<string>();
		for (const task of removedTasks) {
			this.collectParentAndAncestors(task.fieldValues['parentTask'], affectedIds);
		}
		return await this.refreshAffectedParents(affectedIds);
	}

	async refreshAfterTaskIds(operonIds: Iterable<string>): Promise<AggregateRefreshResult> {
		const affectedIds = new Set<string>();
		for (const operonId of operonIds) {
			this.collectTaskAndAncestors(this.indexer.getTask(operonId) ?? null, affectedIds);
		}
		return await this.refreshAffectedParents(affectedIds);
	}

	async refreshDurationAfterTaskIds(operonIds: Iterable<string>): Promise<AggregateRefreshResult> {
		const affectedIds = new Set<string>();
		for (const operonId of operonIds) {
			this.collectTaskAndAncestors(this.indexer.getTask(operonId) ?? null, affectedIds);
		}
		return await this.refreshAffectedParents(affectedIds, 'duration');
	}

	private async refreshAffectedParents(
		affectedIds: Set<string>,
		mode: AggregateRefreshMode = 'full',
		options: RefreshAffectedParentsOptions = {},
	): Promise<AggregateRefreshResult> {
		const startedAt = enginePerfNow();
		const traceEnabled = isOperonEnginePerfDebugEnabled();
		const traceMetadata = traceEnabled
			? formatEnginePerfTraceMetadata(options.indexPerfContext?.trace)
			: [];
		const stageTimings: AggregateStageTimings = {
			calculate: 0,
			parentWrite: 0,
			indexPatch: 0,
			fallbackReindex: 0,
		};
		const modifiedTimestamp = (options.modifiedTimestamp ?? '').trim();
		let fallbackTimestamp = '';
		const resolveModifiedTimestamp = (): string => {
			if (modifiedTimestamp) return modifiedTimestamp;
			if (!fallbackTimestamp) {
				fallbackTimestamp = localNow();
			}
			return fallbackTimestamp;
		};
		const forceDatetimeModifiedIds = options.forceDatetimeModifiedIds ?? new Set<string>();
		const precommittedAggregateIds = options.precommittedAggregateIds ?? new Set<string>();
		const filePaths = new Set<string>();
		const patches: AggregateFieldPatch[] = [];
		let writes = 0;
		let failedWrites = 0;
		let skippedPrecommitted = 0;

		for (const operonId of affectedIds) {
			const task = this.indexer.getTask(operonId);
			if (!task) continue;
			if (precommittedAggregateIds.has(operonId)) {
				skippedPrecommitted++;
				if (traceEnabled) {
			enginePerfLog(
				'aggregate.refresh',
						...traceMetadata,
						'stage=parent',
						`parentId=${operonId}`,
						`format=${task.primary.format}`,
						`filePath=${task.primary.filePath}`,
						'children=precommitted',
						'descendants=precommitted',
						'payloadKeys=precommitted',
						'calculateMs=0',
						'writeMs=0',
						'wrote=precommitted',
					);
				}
				continue;
			}

			const calculateStartedAt = enginePerfNow();
			const { payload, summary } = this.buildAggregatePayload(task, mode);
			const calculateMs = Math.round(enginePerfNow() - calculateStartedAt);
			stageTimings.calculate += calculateMs;
			const hasAggregateChanges = Object.keys(payload).length > 0;
			const shouldTouchDatetimeModified = forceDatetimeModifiedIds.has(operonId) || hasAggregateChanges;
			let writeMs = 0;
			let wrote = false;

			if (shouldTouchDatetimeModified) {
				payload['datetimeModified'] = resolveModifiedTimestamp();
				const writeStartedAt = enginePerfNow();
				try {
					wrote = await this.writer.writeTaskFields(operonId, payload, {
						reindex: 'none',
						touchAncestors: false,
						yamlAggregateFastPath: true,
					});
				} catch (error) {
					console.error(`Operon: aggregate parent write failed for ${operonId}`, error);
					wrote = false;
				}
				writeMs = Math.round(enginePerfNow() - writeStartedAt);
				stageTimings.parentWrite += writeMs;
				if (!wrote) {
					failedWrites++;
				} else {
					filePaths.add(task.primary.filePath);
					patches.push({ operonId, payload });
					writes++;
				}
			}

			if (traceEnabled) {
				const payloadKeys = Object.keys(payload);
				enginePerfLog(
					'aggregate.refresh',
					...traceMetadata,
					'stage=parent',
					`parentId=${operonId}`,
					`format=${task.primary.format}`,
					`filePath=${task.primary.filePath}`,
					`children=${summary.childCount}`,
					`descendants=${summary.totalDescendants}`,
					`payloadKeys=${payloadKeys.length > 0 ? payloadKeys.join(',') : 'none'}`,
					`calculateMs=${calculateMs}`,
					`writeMs=${writeMs}`,
					`wrote=${String(wrote)}`,
				);
			}
		}

		let indexPatch = false;
		let fallbackReindex = false;
		if (patches.length > 0) {
			const patchOptions = options.indexPerfContext
				? { perfContext: options.indexPerfContext }
				: undefined;
			const canPatchIndex = typeof this.indexer.commitAggregateFieldPatches === 'function';
			if (canPatchIndex) {
				const indexPatchStartedAt = enginePerfNow();
				indexPatch = await this.indexer.commitAggregateFieldPatches(patches, patchOptions);
				stageTimings.indexPatch += Math.round(enginePerfNow() - indexPatchStartedAt);
			}
			fallbackReindex = !indexPatch;
		}

		if (fallbackReindex && filePaths.size > 0) {
			const fallbackReindexStartedAt = enginePerfNow();
			await this.indexer.reindexFilesBatch(
				Array.from(filePaths),
				options.indexPerfContext
					? { notify: false, perfContext: options.indexPerfContext }
					: { notify: false },
			);
			stageTimings.fallbackReindex += Math.round(enginePerfNow() - fallbackReindexStartedAt);
		}

		const totalMs = Math.round(enginePerfNow() - startedAt);
		if (traceEnabled) {
			this.logAggregateRefreshSummary(totalMs, stageTimings, traceMetadata, {
				parents: affectedIds.size,
				writes,
				failedWrites,
				precommittedWrites: precommittedAggregateIds.size,
				skippedPrecommitted,
			});
		}
		enginePerfLog(
			'aggregate.refresh',
			`${totalMs}ms`,
			...traceMetadata,
			'stage=total',
			`mode=${mode}`,
			`parents=${affectedIds.size}`,
			`writes=${writes}`,
			`files=${filePaths.size}`,
			`indexPatch=${String(indexPatch)}`,
			`fallbackReindex=${String(fallbackReindex)}`,
			`failedWrites=${failedWrites}`,
			`precommittedWrites=${precommittedAggregateIds.size}`,
			`skippedPrecommitted=${skippedPrecommitted}`,
		);
		return {
			parentCount: affectedIds.size,
			writeCount: writes,
			failedWriteCount: failedWrites,
			fileCount: filePaths.size,
			indexPatch,
			fallbackReindex,
			precommittedWriteCount: precommittedAggregateIds.size,
			skippedPrecommittedCount: skippedPrecommitted,
		};
	}

	private buildAggregatePayload(
		parentTask: IndexedTask,
		mode: AggregateRefreshMode,
		overrides: Map<string, IndexedTask> = new Map(),
	): AggregatePayloadResult {
		const payload: Record<string, string> = {};
		const summary = this.calculateAggregateSummary(parentTask, overrides);

		if (mode === 'full' && summary.hasChildren) {
			const currentProgress = parentTask.fieldValues['progress'] ?? '';
			if (currentProgress !== summary.progress) {
				payload['progress'] = summary.progress;
			}
			for (const key of TASK_STATS_CANONICAL_KEYS) {
				const currentValue = parentTask.fieldValues[key] ?? '';
				const nextValue = summary.taskStats[key];
				if (currentValue !== nextValue) {
					payload[key] = nextValue;
				}
			}
		} else if (mode === 'full' && this.hasStoredTaskStats(parentTask)) {
			if ((parentTask.fieldValues['progress'] ?? '') !== '') {
				payload['progress'] = '';
			}
			for (const key of TASK_STATS_CANONICAL_KEYS) {
				if ((parentTask.fieldValues[key] ?? '') !== '') {
					payload[key] = '';
				}
			}
		}

		const currentDuration = parentTask.fieldValues['totalDuration'] ?? '';
		if (currentDuration !== summary.totalDuration) {
			payload['totalDuration'] = summary.totalDuration;
		}

		if (mode === 'full') {
			const currentEstimate = parentTask.fieldValues['totalEstimate'] ?? '';
			if (currentEstimate !== summary.totalEstimate) {
				payload['totalEstimate'] = summary.totalEstimate;
			}
		}

		return { payload, summary };
	}

	private hasStoredTaskStats(task: IndexedTask): boolean {
		return TASK_STATS_CANONICAL_KEYS.some(key => (task.fieldValues[key] ?? '').trim() !== '');
	}

	private calculateAggregateSummary(
		parentTask: IndexedTask,
		overrides: Map<string, IndexedTask> = new Map(),
	): AggregateSummary {
		const childIds = this.indexer.secondary.getChildIds(parentTask.operonId);
		const hasChildren = childIds.size > 0;
		let directSubtaskCount = 0;
		let directDoneSubtaskCount = 0;
		let directOpenSubtaskCount = 0;
		let totalDescendants = 0;
		let finishedDescendants = 0;
		let cancelledDescendants = 0;
		let openDescendants = 0;
		let totalDuration = parseInt(parentTask.fieldValues['duration'] ?? '0', 10) || 0;
		let totalEstimate = parseInt(parentTask.fieldValues['estimate'] ?? '0', 10) || 0;

		if (hasChildren) {
			for (const childId of childIds) {
				const child = overrides.get(childId) ?? this.indexer.getTask(childId);
				if (!child) continue;
				directSubtaskCount++;
				if (child.checkbox === 'done') {
					directDoneSubtaskCount++;
				} else if (child.checkbox === 'open') {
					directOpenSubtaskCount++;
				}
			}
			for (const childId of this.indexer.secondary.getAllDescendantIds(parentTask.operonId)) {
				const child = overrides.get(childId) ?? this.indexer.getTask(childId);
				if (!child) continue;
				totalDescendants++;
				totalDuration += parseInt(child.fieldValues['duration'] ?? '0', 10) || 0;
				totalEstimate += parseInt(child.fieldValues['estimate'] ?? '0', 10) || 0;
				if (child.checkbox === 'done') {
					finishedDescendants++;
				} else if (child.checkbox === 'cancelled') {
					cancelledDescendants++;
				} else if (child.checkbox === 'open') {
					openDescendants++;
				}
			}
		}

		const effectiveTotal = totalDescendants - cancelledDescendants;
		const progress = effectiveTotal > 0
			? Math.round((finishedDescendants / effectiveTotal) * 100)
			: 0;
		return {
			hasChildren,
			childCount: childIds.size,
			totalDescendants,
			finishedDescendants,
			cancelledDescendants,
			effectiveDescendants: effectiveTotal,
			progress: String(progress),
			taskStats: {
				directSubtaskCount: String(directSubtaskCount),
				directDoneSubtaskCount: String(directDoneSubtaskCount),
				directOpenSubtaskCount: String(directOpenSubtaskCount),
				treeDescendantCount: String(totalDescendants),
				treeDoneDescendantCount: String(finishedDescendants),
				treeOpenDescendantCount: String(openDescendants),
			},
			totalDuration: hasChildren && totalDuration > 0 ? String(totalDuration) : '',
			totalEstimate: hasChildren && totalEstimate > 0 ? String(totalEstimate) : '',
		};
	}

	private logAggregateRefreshSummary(
		totalMs: number,
		stageTimings: AggregateStageTimings,
		traceMetadata: string[],
		counts: { parents: number; writes: number; failedWrites: number; precommittedWrites: number; skippedPrecommitted: number },
	): void {
		const entries: Array<[string, number]> = [
			['calculate', stageTimings.calculate],
			['parent-write', stageTimings.parentWrite],
			['index-patch', stageTimings.indexPatch],
			['fallback-reindex', stageTimings.fallbackReindex],
		];
		const [topStage, topStageMs] = entries.reduce(
			(current, next) => (next[1] > current[1] ? next : current),
			entries[0],
		);
		const slow = totalMs >= 50 || entries.some(([, ms]) => ms >= 25);
		enginePerfLog(
			'aggregate.refresh',
			...traceMetadata,
			'stage=summary',
			`totalMs=${totalMs}`,
			`slow=${String(slow)}`,
			`topStage=${topStage}`,
			`topStageMs=${topStageMs}`,
			`stageBreakdown=${entries.map(([stage, ms]) => `${stage}:${ms}`).join(',')}`,
			`parents=${counts.parents}`,
			`writes=${counts.writes}`,
			`failedWrites=${counts.failedWrites}`,
			`precommittedWrites=${counts.precommittedWrites}`,
			`skippedPrecommitted=${counts.skippedPrecommitted}`,
		);
	}

	private buildTaskWithPayload(task: IndexedTask, payload: Record<string, string>): IndexedTask {
		const fieldValues = { ...task.fieldValues };
		let checkbox = task.checkbox;
		for (const [key, value] of Object.entries(payload)) {
			if (key === '_checkbox') {
				checkbox = value as IndexedTask['checkbox'];
				continue;
			}
			if (key.startsWith('_')) continue;
			if (value) {
				fieldValues[key] = value;
			} else {
				delete fieldValues[key];
			}
		}
		return {
			...task,
			checkbox,
			fieldValues,
			datetimeModified: payload['datetimeModified'] || task.datetimeModified,
		};
	}

	private collectTaskAndAncestors(task: IndexedTask | null, output: Set<string>): void {
		if (!task) return;
		output.add(task.operonId);
		this.collectParentAndAncestors(task.fieldValues['parentTask'], output);
	}

	private collectMutationAncestorIds(
		beforeTask: IndexedTask | null,
		afterTask: IndexedTask | null,
		output: Set<string>,
	): void {
		const blockedIds = new Set<string>();
		if (beforeTask?.operonId) blockedIds.add(beforeTask.operonId);
		if (afterTask?.operonId) blockedIds.add(afterTask.operonId);

		this.collectParentAndAncestors(beforeTask?.fieldValues['parentTask'], output, blockedIds);
		this.collectParentAndAncestors(afterTask?.fieldValues['parentTask'], output, blockedIds);
	}

	private collectParentAndAncestors(
		parentId: string | null | undefined,
		output: Set<string>,
		blockedIds: Set<string> = new Set<string>(),
	): void {
		let currentId = (parentId ?? '').trim();
		const visited = new Set<string>();
		let depth = 0;

		while (currentId && depth < 100) {
			if (blockedIds.has(currentId)) return;
			if (visited.has(currentId)) return;
			visited.add(currentId);
			output.add(currentId);
			const currentTask = this.indexer.getTask(currentId);
			currentId = (currentTask?.fieldValues['parentTask'] ?? '').trim();
			depth++;
		}
	}
}
