export const OPERON_ENGINE_PERF_DEBUG = false;

declare global {
	interface Window {
		operonEnginePerfDebug?: boolean;
	}
}

let enginePerfDebugOverride = OPERON_ENGINE_PERF_DEBUG;

export interface EnginePerfTraceMetadata {
	traceId: string;
	taskId: string;
	format: string;
	filePath: string;
	changedKeys: string[];
	reason: string;
}

export interface IndexPerfContext {
	source: string;
	trace?: EnginePerfTraceMetadata | null;
}

export interface WriteJsonMetrics {
	jsonBytes: number;
	stringifyMs: number;
	writeMs: number;
	queueWaitMs: number;
	totalMs: number;
}

export const enginePerfNow = (): number => (
	typeof performance !== 'undefined' ? performance.now() : Date.now()
);

function getEnginePerfWindow(): Window | null {
	return typeof window === 'undefined' ? null : window;
}

export function setOperonEnginePerfDebug(enabled: boolean): void {
	enginePerfDebugOverride = enabled;
	const perfWindow = getEnginePerfWindow();
	if (perfWindow) {
		perfWindow.operonEnginePerfDebug = enabled;
	}
}

export function isOperonEnginePerfDebugEnabled(): boolean {
	const perfWindow = getEnginePerfWindow();
	const globalValue = perfWindow?.operonEnginePerfDebug;
	if (typeof globalValue === 'boolean') return globalValue;
	return enginePerfDebugOverride;
}

export function enginePerfLog(label: string, ...args: unknown[]): void {
	if (!isOperonEnginePerfDebugEnabled()) return;
	console.debug('[Operon engine perf]', label, ...args);
}

export function formatEnginePerfTraceMetadata(trace: EnginePerfTraceMetadata | null | undefined): string[] {
	if (!trace) return [];
	return [
		`traceId=${trace.traceId}`,
		`taskId=${trace.taskId}`,
		`format=${trace.format}`,
		`changedKeys=${trace.changedKeys.length > 0 ? trace.changedKeys.join(',') : 'none'}`,
		`reason=${trace.reason}`,
	];
}

export async function enginePerfMeasure<T>(
	label: string,
	action: () => Promise<T>,
	...args: unknown[]
): Promise<T> {
	const startedAt = enginePerfNow();
	try {
		return await action();
	} finally {
		enginePerfLog(label, `${Math.round(enginePerfNow() - startedAt)}ms`, ...args);
	}
}
