import type { FlowTimeMode, OperonSettings } from '../types/settings';

export function resolveDefaultFlowTimeSessionMinutes(settings: OperonSettings): number {
	return settings.flowTimeUseLastSelectedDuration ? settings.flowTimeSessionMinutes : settings.flowTimeDefaultSessionMinutes;
}

export function getFlowTimeTargetSeconds(minutes: number): number {
	return Math.max(60, minutes * 60);
}

export function resolveFlowTimeDialState(mode: FlowTimeMode, elapsed: number, targetSeconds: number) {
	const seconds = mode === 'flowtime' ? targetSeconds - elapsed : elapsed;
	const displaySeconds = Math.abs(seconds);
	return {
		mode,
		displaySeconds,
		angleDegrees: ((seconds % 3600) / 3600) * 360,
		overtime: seconds < 0,
	};
}

export type FlowTimeDialState = ReturnType<typeof resolveFlowTimeDialState>;
