import type { TaskContextV1 } from '../../../src/agent-runtime/contracts/v1';
import { OPERON_ID_PATTERN_V1 } from '../../../src/agent-runtime/contracts/v1';
import type { GuidedMutationIntentV1 } from './guided-maintenance';

export const DIRECT_TIMER_SESSION_ACTIONS_V1 = ['add', 'update', 'remove'] as const;
export type DirectTimerSessionActionV1 = typeof DIRECT_TIMER_SESSION_ACTIONS_V1[number];

export interface DirectTimerSessionArgsV1 {
	session?: string;
	start?: string;
	end?: string;
}

export type DirectTimerSessionSpecV1 =
	| {
		operation: 'add-session';
		start: string;
		end: string;
	}
	| {
		operation: 'update-session';
		sessionNumber: number;
		start: string;
		end: string;
	}
	| {
		operation: 'remove-session';
		sessionNumber: number;
	};

export function parseDirectTimerSessionArgsV1(
	action: DirectTimerSessionActionV1,
	args: DirectTimerSessionArgsV1,
): DirectTimerSessionSpecV1 {
	const sessionNumber = args.session === undefined ? undefined : Number(args.session);
	if (
		(action === 'update' || action === 'remove')
		&& (!Number.isSafeInteger(sessionNumber) || (sessionNumber ?? 0) < 1)
	) throw new Error('DIRECT_TIMER_SESSION_NUMBER_INVALID');
	if (action === 'add' && args.session !== undefined) {
		throw new Error('DIRECT_TIMER_SESSION_NUMBER_CONFLICT');
	}
	const start = args.start === undefined ? undefined : canonicalLocalDatetime(args.start);
	const end = args.end === undefined ? undefined : canonicalLocalDatetime(args.end);
	if (action === 'remove') {
		if (start !== undefined || end !== undefined) {
			throw new Error('DIRECT_TIMER_SESSION_RANGE_CONFLICT');
		}
		return {
			operation: 'remove-session',
			sessionNumber: sessionNumber as number,
		};
	}
	if (!start || !end) throw new Error('DIRECT_TIMER_SESSION_RANGE_REQUIRED');
	if (end <= start) throw new Error('DIRECT_TIMER_SESSION_RANGE_INVALID');
	return action === 'add'
		? { operation: 'add-session', start, end }
		: {
			operation: 'update-session',
			sessionNumber: sessionNumber as number,
			start,
			end,
		};
}

export function compileDirectTimerSessionIntentV1(options: {
	spec: DirectTimerSessionSpecV1;
	task: TaskContextV1;
}): GuidedMutationIntentV1 {
	const { spec, task } = options;
	const operonId = task.identity.operonId;
	if (!OPERON_ID_PATTERN_V1.test(operonId) || !task.identity.mutationAllowed) {
		throw new Error('INVALID_OPERON_ID');
	}
	return {
		contractVersion: 1,
		kind: 'mutation-intent',
		reason: 'The user requested a direct human-readable Operon timer session change.',
		target: {
			operonId,
			locator: structuredClone(task.locator),
		},
		spec,
	};
}

function canonicalLocalDatetime(value: string): string {
	const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/u.exec(value.trim());
	if (!match) throw new Error('DIRECT_TIMER_SESSION_DATETIME_INVALID');
	const [, year, month, day, hour, minute, second = '00'] = match;
	const date = new Date(
		Number(year),
		Number(month) - 1,
		Number(day),
		Number(hour),
		Number(minute),
		Number(second),
		0,
	);
	if (
		date.getFullYear() !== Number(year)
		|| date.getMonth() !== Number(month) - 1
		|| date.getDate() !== Number(day)
		|| date.getHours() !== Number(hour)
		|| date.getMinutes() !== Number(minute)
		|| date.getSeconds() !== Number(second)
	) throw new Error('DIRECT_TIMER_SESSION_DATETIME_INVALID');
	return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}
