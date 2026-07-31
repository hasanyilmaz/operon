import { CONTRACT_LIMITS_V1 } from '../contracts/v1/primitives';

const STAGING_TTL_MS_V1 = 30_000;
const STAGING_CAPACITY_V1 = 64;
const TOKEN_PATTERN_V1 = /^[A-Za-z0-9_-]{32}$/u;

export type WindowsBrokerStageStateV1 =
	| 'staged'
	| 'consumed'
	| 'dispatch-started'
	| 'unknown';

export interface WindowsBrokerScopeV1 {
	readonly serverInstanceId: string;
	readonly vaultSha256: string;
}

interface StagedInvocationV1 {
	readonly raw: string;
	readonly inputBytes: number;
	readonly receipt: string;
	readonly expiresAt: number;
	readonly scope: WindowsBrokerScopeV1;
	state: WindowsBrokerStageStateV1;
}

const stagedInvocationsV1 = new Map<string, StagedInvocationV1>();
const activeScopeByVaultV1 = new Map<string, string>();

export function registerWindowsBrokerScopeV1(scope: WindowsBrokerScopeV1): void {
	activeScopeByVaultV1.set(scope.vaultSha256, scope.serverInstanceId);
}

export function unregisterWindowsBrokerScopeV1(scope: WindowsBrokerScopeV1): void {
	if (activeScopeByVaultV1.get(scope.vaultSha256) === scope.serverInstanceId) {
		activeScopeByVaultV1.delete(scope.vaultSha256);
	}
	for (const [token, staged] of stagedInvocationsV1) {
		if (sameScopeV1(staged.scope, scope) && staged.state === 'staged') {
			stagedInvocationsV1.delete(token);
		}
	}
}

export function stageWindowsBrokerInvocationV1(input: {
	readonly token: string;
	readonly raw: string;
	readonly receipt: string;
	readonly scope: WindowsBrokerScopeV1;
	readonly now?: number;
}): void {
	const now = input.now ?? Date.now();
	pruneWindowsBrokerStagesV1(now);
	if (!TOKEN_PATTERN_V1.test(input.token)) throw new Error('broker-token-invalid');
	const inputBytes = new TextEncoder().encode(input.raw).byteLength;
	if (inputBytes > CONTRACT_LIMITS_V1.transportInputBytes) throw new Error('broker-payload-too-large');
	if (stagedInvocationsV1.size >= STAGING_CAPACITY_V1) throw new Error('broker-capacity-full');
	if (stagedInvocationsV1.has(input.token)) throw new Error('broker-token-reused');
	stagedInvocationsV1.set(input.token, {
		raw: input.raw,
		inputBytes,
		receipt: input.receipt,
		expiresAt: now + STAGING_TTL_MS_V1,
		scope: input.scope,
		state: 'staged',
	});
}

export function consumeWindowsBrokerInvocationV1(
	token: string,
	expected: WindowsBrokerScopeV1 | string,
	now: number = Date.now(),
): { raw: string; inputBytes: number; scope: WindowsBrokerScopeV1 } | null {
	pruneWindowsBrokerStagesV1(now);
	const staged = stagedInvocationsV1.get(token);
	if (
		!staged
		|| staged.state !== 'staged'
		|| !matchesExpectedScopeV1(staged.scope, expected)
	) return null;
	staged.state = 'consumed';
	return { raw: staged.raw, inputBytes: staged.inputBytes, scope: staged.scope };
}

export function markWindowsBrokerDispatchStartedV1(
	token: string,
	scope: WindowsBrokerScopeV1,
): void {
	const staged = stagedInvocationsV1.get(token);
	if (staged?.state === 'consumed' && sameScopeV1(staged.scope, scope)) {
		staged.state = 'dispatch-started';
	}
}

export function getWindowsBrokerStageStateV1(
	token: string,
	scope: WindowsBrokerScopeV1,
	now: number = Date.now(),
): WindowsBrokerStageStateV1 {
	pruneWindowsBrokerStagesV1(now);
	const staged = stagedInvocationsV1.get(token);
	return staged && sameScopeV1(staged.scope, scope) ? staged.state : 'unknown';
}

export function cancelWindowsBrokerStageV1(
	token: string,
	scope: WindowsBrokerScopeV1,
	now: number = Date.now(),
): { cancelled: boolean; state: WindowsBrokerStageStateV1 } {
	pruneWindowsBrokerStagesV1(now);
	const staged = stagedInvocationsV1.get(token);
	if (!staged || !sameScopeV1(staged.scope, scope)) {
		return { cancelled: false, state: 'unknown' };
	}
	if (staged.state !== 'staged') return { cancelled: false, state: staged.state };
	stagedInvocationsV1.delete(token);
	return { cancelled: true, state: 'staged' };
}

export function pruneWindowsBrokerStagesV1(now: number = Date.now()): void {
	for (const [token, staged] of stagedInvocationsV1) {
		if (staged.expiresAt <= now) stagedInvocationsV1.delete(token);
	}
}

export function clearWindowsBrokerStagesForTestsV1(): void {
	stagedInvocationsV1.clear();
	activeScopeByVaultV1.clear();
}

function matchesExpectedScopeV1(
	actual: WindowsBrokerScopeV1,
	expected: WindowsBrokerScopeV1 | string,
): boolean {
	if (typeof expected !== 'string') return sameScopeV1(actual, expected);
	return actual.vaultSha256 === expected
		&& activeScopeByVaultV1.get(expected) === actual.serverInstanceId;
}

function sameScopeV1(left: WindowsBrokerScopeV1, right: WindowsBrokerScopeV1): boolean {
	return left.serverInstanceId === right.serverInstanceId
		&& left.vaultSha256 === right.vaultSha256;
}
