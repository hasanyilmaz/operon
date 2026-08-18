export type FlowTimeCompletionAlertKind = 'focus' | 'break';

export interface FlowTimeCompletionAlertInput {
	kind: FlowTimeCompletionAlertKind;
	occurrenceKey: string;
	elapsedSeconds: number;
	targetSeconds: number;
	enabled: boolean;
}

interface FlowTimeCompletionAlertState {
	identifier: string;
	reached: boolean;
}

/**
 * Tracks a live FlowTime boundary without replaying an alert for an already
 * elapsed target. The view owns its lifetime, so closing the view resets all
 * pending FlowTime and break alert state.
 */
export class FlowTimeCompletionAlertTracker {
	private readonly states = new Map<FlowTimeCompletionAlertKind, FlowTimeCompletionAlertState>();

	observe(input: FlowTimeCompletionAlertInput): boolean {
		const next = this.createState(input);
		const previous = this.states.get(input.kind);
		this.states.set(input.kind, next);
		if (!previous || previous.identifier !== next.identifier) return false;
		return !previous.reached && next.reached && input.enabled;
	}

	/** Seed the current boundary state after a deliberate duration or toggle change. */
	sync(input: FlowTimeCompletionAlertInput): void {
		this.states.set(input.kind, this.createState(input));
	}

	reset(kind?: FlowTimeCompletionAlertKind): void {
		if (kind) {
			this.states.delete(kind);
			return;
		}
		this.states.clear();
	}

	private createState(input: FlowTimeCompletionAlertInput): FlowTimeCompletionAlertState {
		const elapsedSeconds = Math.max(0, input.elapsedSeconds);
		const targetSeconds = Math.max(0, input.targetSeconds);
		return {
			identifier: `${input.occurrenceKey}:${targetSeconds}`,
			reached: elapsedSeconds >= targetSeconds,
		};
	}
}
