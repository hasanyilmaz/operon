import {
	enginePerfLog,
	enginePerfNow,
	isOperonEnginePerfDebugEnabled,
} from '../../core/engine-perf';

export type TableScrollPerformanceSurface = 'workspace' | 'embedded';

export interface TableScrollPerformanceContext {
	ganttEnabled: boolean;
	taskTreeEnabled: boolean;
	itemCount: number;
	columnCount: number;
	rowHeight: number;
}

export type TableScrollPerformanceCounter =
	| 'verticalScrollEvents'
	| 'renderScheduleRequests'
	| 'renderRafScheduled'
	| 'renderRafRuns'
	| 'renderScheduleSkipsCovered'
	| 'virtualWindowRetentions'
	| 'virtualWindowShifts'
	| 'stableVirtualRanges'
	| 'changedVirtualRanges'
	| 'virtualRowsEntered'
	| 'virtualRowsExited'
	| 'tableRowsCreated'
	| 'tableRowsReused'
	| 'tableRowsRemoved'
	| 'tableDomResets'
	| 'tableDomReplacements'
	| 'ganttTimelineRenders'
	| 'ganttRowsCreated'
	| 'ganttRowsReused'
	| 'ganttRowsRemoved'
	| 'ganttBodyResets'
	| 'ganttStaticLayerRebuilds'
	| 'ganttProjectionCacheHits'
	| 'ganttProjectionCacheMisses'
	| 'ganttDependencyModelCacheHits'
	| 'ganttDependencyModelCacheMisses'
	| 'ganttDependencyOverlayRetentions'
	| 'ganttDependencyRebuilds'
	| 'ganttHeaderRenders'
	| 'ganttHeaderReplacements'
	| 'ganttBodyRenders'
	| 'ganttBodyReplacements';

export type TableScrollPerformanceTiming =
	| 'scrollHandler'
	| 'visibleRowsFrame'
	| 'tableDomBuild'
	| 'ganttTotal'
	| 'ganttHeaderBuild'
	| 'ganttBodyBuild';

export interface TableScrollPerformanceTimingSummary {
	count: number;
	totalMs: number;
	p50Ms: number;
	p95Ms: number;
	maxMs: number;
}

export interface TableScrollPerformanceSummary {
	surface: TableScrollPerformanceSurface;
	context: TableScrollPerformanceContext;
	counters: Record<TableScrollPerformanceCounter, number>;
	timings: Record<TableScrollPerformanceTiming, TableScrollPerformanceTimingSummary>;
}

interface TableScrollPerformanceSession {
	context: TableScrollPerformanceContext;
	counters: Record<TableScrollPerformanceCounter, number>;
	timings: Record<TableScrollPerformanceTiming, PerformanceTimingSeries>;
}

interface TableScrollPerformanceDependencies {
	isEnabled: () => boolean;
	now: () => number;
	scheduleIdle: (callback: () => void, delayMs: number) => number;
	cancelIdle: (timerId: number) => void;
	emit: (summary: TableScrollPerformanceSummary) => void;
}

export type TableScrollPerformanceTestDependencies = Partial<TableScrollPerformanceDependencies>;

const TABLE_SCROLL_PERFORMANCE_IDLE_MS = 200;
const TABLE_SCROLL_PERFORMANCE_SAMPLE_LIMIT = 512;

const COUNTERS: readonly TableScrollPerformanceCounter[] = [
	'verticalScrollEvents',
	'renderScheduleRequests',
	'renderRafScheduled',
	'renderRafRuns',
	'renderScheduleSkipsCovered',
	'virtualWindowRetentions',
	'virtualWindowShifts',
	'stableVirtualRanges',
	'changedVirtualRanges',
	'virtualRowsEntered',
	'virtualRowsExited',
	'tableRowsCreated',
	'tableRowsReused',
	'tableRowsRemoved',
	'tableDomResets',
	'tableDomReplacements',
	'ganttTimelineRenders',
	'ganttRowsCreated',
	'ganttRowsReused',
	'ganttRowsRemoved',
	'ganttBodyResets',
	'ganttStaticLayerRebuilds',
	'ganttProjectionCacheHits',
	'ganttProjectionCacheMisses',
	'ganttDependencyModelCacheHits',
	'ganttDependencyModelCacheMisses',
	'ganttDependencyOverlayRetentions',
	'ganttDependencyRebuilds',
	'ganttHeaderRenders',
	'ganttHeaderReplacements',
	'ganttBodyRenders',
	'ganttBodyReplacements',
];

const TIMINGS: readonly TableScrollPerformanceTiming[] = [
	'scrollHandler',
	'visibleRowsFrame',
	'tableDomBuild',
	'ganttTotal',
	'ganttHeaderBuild',
	'ganttBodyBuild',
];

class PerformanceTimingSeries {
	count = 0;
	totalMs = 0;
	maxMs = 0;
	private readonly samples: number[] = [];
	private nextSampleIndex = 0;

	add(durationMs: number): void {
		if (!Number.isFinite(durationMs) || durationMs < 0) return;
		this.count += 1;
		this.totalMs += durationMs;
		this.maxMs = Math.max(this.maxMs, durationMs);
		if (this.samples.length < TABLE_SCROLL_PERFORMANCE_SAMPLE_LIMIT) {
			this.samples.push(durationMs);
			return;
		}
		this.samples[this.nextSampleIndex] = durationMs;
		this.nextSampleIndex = (this.nextSampleIndex + 1) % TABLE_SCROLL_PERFORMANCE_SAMPLE_LIMIT;
	}

	summarize(): TableScrollPerformanceTimingSummary {
		const sorted = [...this.samples].sort((left, right) => left - right);
		return {
			count: this.count,
			totalMs: roundMs(this.totalMs),
			p50Ms: roundMs(resolvePercentile(sorted, 0.5)),
			p95Ms: roundMs(resolvePercentile(sorted, 0.95)),
			maxMs: roundMs(this.maxMs),
		};
	}
}

function roundMs(value: number): number {
	return Math.round(value * 100) / 100;
}

function resolvePercentile(sortedValues: readonly number[], percentile: number): number {
	if (sortedValues.length === 0) return 0;
	const index = Math.max(0, Math.ceil(sortedValues.length * percentile) - 1);
	return sortedValues[index] ?? 0;
}

function createCounterRecord(): Record<TableScrollPerformanceCounter, number> {
	return Object.fromEntries(COUNTERS.map(counter => [counter, 0])) as Record<TableScrollPerformanceCounter, number>;
}

function createTimingRecord(): Record<TableScrollPerformanceTiming, PerformanceTimingSeries> {
	return Object.fromEntries(TIMINGS.map(timing => [timing, new PerformanceTimingSeries()])) as Record<
		TableScrollPerformanceTiming,
		PerformanceTimingSeries
	>;
}

function createSession(context: TableScrollPerformanceContext): TableScrollPerformanceSession {
	return {
		context: { ...context },
		counters: createCounterRecord(),
		timings: createTimingRecord(),
	};
}

function createDefaultDependencies(): TableScrollPerformanceDependencies {
	return {
		isEnabled: isOperonEnginePerfDebugEnabled,
		now: enginePerfNow,
		scheduleIdle: (callback, delayMs) => window.setTimeout(callback, delayMs),
		cancelIdle: timerId => window.clearTimeout(timerId),
		emit: summary => enginePerfLog('table.scroll.session', summary),
	};
}

export class TableScrollPerformanceRecorder {
	private session: TableScrollPerformanceSession | null = null;
	private idleTimer: number | null = null;
	private readonly dependencies: TableScrollPerformanceDependencies;

	constructor(
		private readonly surface: TableScrollPerformanceSurface,
		dependencies: TableScrollPerformanceTestDependencies = {},
	) {
		this.dependencies = { ...createDefaultDependencies(), ...dependencies };
	}

	beginVerticalScroll(context: TableScrollPerformanceContext): number | null {
		if (!this.dependencies.isEnabled()) {
			this.reset();
			return null;
		}
		this.session ??= createSession(context);
		this.session.context = { ...context };
		this.session.counters.verticalScrollEvents += 1;
		return this.dependencies.now();
	}

	endVerticalScroll(startedAt: number | null): void {
		this.endTiming('scrollHandler', startedAt);
		if (!this.session) return;
		if (this.idleTimer !== null) this.dependencies.cancelIdle(this.idleTimer);
		this.idleTimer = this.dependencies.scheduleIdle(() => {
			this.idleTimer = null;
			this.flush();
		}, TABLE_SCROLL_PERFORMANCE_IDLE_MS);
	}

	recordScheduleRequest(scheduled: boolean): void {
		this.recordCounter('renderScheduleRequests');
		if (scheduled) this.recordCounter('renderRafScheduled');
	}

	beginRafRun(): number | null {
		this.recordCounter('renderRafRuns');
		return this.beginTiming();
	}

	endRafRun(startedAt: number | null): void {
		this.endTiming('visibleRowsFrame', startedAt);
	}

	recordVirtualRange(stable: boolean): void {
		this.recordCounter(stable ? 'stableVirtualRanges' : 'changedVirtualRanges');
	}

	recordCounter(counter: TableScrollPerformanceCounter, amount = 1): void {
		if (!this.session) return;
		if (!Number.isFinite(amount) || amount <= 0) return;
		this.session.counters[counter] += Math.floor(amount);
	}

	beginTiming(): number | null {
		return this.session ? this.dependencies.now() : null;
	}

	endTiming(timing: TableScrollPerformanceTiming, startedAt: number | null): void {
		if (startedAt === null || !this.session) return;
		this.session.timings[timing].add(this.dependencies.now() - startedAt);
	}

	flush(): TableScrollPerformanceSummary | null {
		if (!this.session || !this.dependencies.isEnabled()) {
			this.reset();
			return null;
		}
		const summary: TableScrollPerformanceSummary = {
			surface: this.surface,
			context: { ...this.session.context },
			counters: { ...this.session.counters },
			timings: Object.fromEntries(
				TIMINGS.map(timing => [timing, this.session?.timings[timing].summarize()]),
			) as Record<TableScrollPerformanceTiming, TableScrollPerformanceTimingSummary>,
		};
		this.reset();
		this.dependencies.emit(summary);
		return summary;
	}

	destroy(): void {
		this.reset();
	}

	private reset(): void {
		if (this.idleTimer !== null) {
			this.dependencies.cancelIdle(this.idleTimer);
			this.idleTimer = null;
		}
		this.session = null;
	}
}
