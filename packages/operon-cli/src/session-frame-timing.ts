import { performance } from 'node:perf_hooks';

export interface JsonlSessionFrameTimingV1 {
	sequence: number;
	id: string | number | null;
	submittedEpochMs: number;
	submittedMs: number;
	serviceStartMs: number;
	serviceEndMs: number;
	serviceStartEpochMs: number;
	serviceEndEpochMs: number;
	transport: 'persistent' | 'request-file-fallback' | 'one-shot';
}

export interface JsonlSessionFrameTimingBatchV1 {
	records: readonly JsonlSessionFrameTimingV1[];
	overflow: number;
	timeOriginMs: number;
	clockOffsetMs: number;
}

type FrameV1 = number;
type TupleV1 = readonly [
	number, string | number | null, number, number, number,
	JsonlSessionFrameTimingV1['transport'],
];

export interface SessionFrameClockV1 {
	submit(): number;
	begin(submitted: number): FrameV1;
	complete(
		frame: FrameV1,
		id: string | number | null,
		transport: JsonlSessionFrameTimingV1['transport'],
	): void;
	flush(): Promise<void>;
}

export function createSessionFrameClockV1(options: unknown): SessionFrameClockV1 {
	const sink = resolveSink(options);
	if (!sink) return NOOP_FRAME_CLOCK_V1;
	const clockOffsetMs = Date.now() - (performance.timeOrigin + performance.now());
	const records = new Array<TupleV1 | undefined>(1_024);
	let count = 0;
	let overflow = 0;
	let sequence = 0;
	return {
		// The authoritative submit epoch is captured by the parent runner. Avoid a
		// redundant child clock read before decode; the service boundary starts here.
		submit: () => 0,
		begin: () => performance.now(),
		complete: (frame, id, transport) => {
			sequence += 1;
			if (count >= records.length) {
				overflow += 1;
				return;
			}
			records[count] = [sequence, id, frame, frame, performance.now(), transport];
			count += 1;
		},
		flush: async () => {
			const timeOriginMs = performance.timeOrigin;
			const expanded: JsonlSessionFrameTimingV1[] = [];
			for (let index = 0; index < count; index += 1) {
				const record = records[index];
				if (!record) continue;
				const [itemSequence, id, submittedMs, serviceStartMs, serviceEndMs, transport] =
					record;
				expanded.push({
					sequence: itemSequence,
					id,
					submittedEpochMs: timeOriginMs + submittedMs,
					submittedMs,
					serviceStartMs,
					serviceEndMs,
					serviceStartEpochMs: timeOriginMs + serviceStartMs,
					serviceEndEpochMs: timeOriginMs + serviceEndMs,
					transport,
				});
			}
			await sink({
				records: Object.freeze(expanded),
				overflow,
				timeOriginMs,
				clockOffsetMs,
			});
		},
	};
}

const NOOP_FRAME_CLOCK_V1: SessionFrameClockV1 = Object.freeze({
	submit: () => 0,
	begin: () => 0,
	complete: () => {},
	flush: () => Promise.resolve(),
});

function resolveSink(
	value: unknown,
): ((batch: JsonlSessionFrameTimingBatchV1) => void | Promise<void>) | undefined {
	if (
		typeof value !== 'object'
		|| value === null
		|| !('frameTiming' in value)
		|| typeof value.frameTiming !== 'function'
	) return undefined;
	return value.frameTiming as (
		batch: JsonlSessionFrameTimingBatchV1
	) => void | Promise<void>;
}
