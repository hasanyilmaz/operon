import {
	CLI_MAX_READINESS_TIMEOUT_MS_V1,
	isCliCommandV1,
	type CliInvocationV1,
} from '../contracts/v1/cli';
import {
	CONTRACT_LIMITS_V1,
	CONTRACT_VERSION_V1,
	REQUEST_ID_PATTERN_V1,
	utf8ByteLengthV1,
	type CompatibilityOfferV1,
} from '../contracts/v1/primitives';
import { validateCliRuntimeRequestV1 } from '../runtime/context-request-validator';

type InvocationValidationV1 =
	| { ok: true; value: CliInvocationV1 }
	| { ok: false };

const INVOCATION_KEYS = [
	'contractVersion',
	'kind',
	'requestId',
	'command',
	'mode',
	'clientVersion',
	'compatibility',
	'cliContract',
	'expectedVaultSha256',
	'readinessTimeoutMs',
	'request',
] as const;

export function validateCliInvocationForTransportV1(value: unknown): InvocationValidationV1 {
	if (
		!isExactObject(value, INVOCATION_KEYS)
		|| value.contractVersion !== CONTRACT_VERSION_V1
		|| value.kind !== 'cli-invocation'
		|| !isBoundedNonEmptyString(value.requestId, CONTRACT_LIMITS_V1.requestIdBytes)
		|| !REQUEST_ID_PATTERN_V1.test(value.requestId)
		|| typeof value.command !== 'string'
		|| !isCliCommandV1(value.command)
		|| value.mode !== 'live'
		|| !isBoundedNonEmptyString(value.clientVersion, 256)
		|| !isCompatibilityOfferV1(value.compatibility)
		|| !isCompatibilityRangeV1(value.cliContract)
		|| value.cliContract.min !== 1
		|| value.cliContract.max !== 1
		|| typeof value.expectedVaultSha256 !== 'string'
		|| !/^[a-f0-9]{64}$/u.test(value.expectedVaultSha256)
		|| !isIntegerInRange(value.readinessTimeoutMs, 1, CLI_MAX_READINESS_TIMEOUT_MS_V1)
	) return { ok: false };

	if (
		value.command === 'health'
		|| value.command === 'capabilities'
		|| value.command === 'diagnostics'
	) {
		if (value.request !== undefined) return { ok: false };
	} else {
		const request = validateCliRuntimeRequestV1(value.command, value.request);
		if (!request.ok || request.value.requestId !== value.requestId) return { ok: false };
	}

	const serialized = serializeWithinInputCap(value);
	if (serialized === null) return { ok: false };
	return {
		ok: true,
		value: JSON.parse(serialized) as CliInvocationV1,
	};
}

function isCompatibilityOfferV1(value: unknown): value is CompatibilityOfferV1 {
	return isExactObject(value, ['contractVersion', 'runtimeApi'])
		&& value.contractVersion === CONTRACT_VERSION_V1
		&& isCompatibilityRangeV1(value.runtimeApi);
}

function isCompatibilityRangeV1(value: unknown): value is { min: number; max: number } {
	return isExactObject(value, ['min', 'max'])
		&& isIntegerInRange(value.min, 1, Number.MAX_SAFE_INTEGER)
		&& isIntegerInRange(value.max, 1, Number.MAX_SAFE_INTEGER)
		&& value.min <= value.max;
}

function isBoundedNonEmptyString(value: unknown, maximumBytes: number): value is string {
	return typeof value === 'string'
		&& value.length > 0
		&& value === value.trim()
		&& utf8ByteLengthV1(value) <= maximumBytes;
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
	return typeof value === 'number'
		&& Number.isSafeInteger(value)
		&& value >= minimum
		&& value <= maximum;
}

function serializeWithinInputCap(value: unknown): string | null {
	try {
		const serialized = JSON.stringify(value);
		return serialized !== undefined
			&& utf8ByteLengthV1(serialized) <= CONTRACT_LIMITS_V1.transportInputBytes
			? serialized
			: null;
	} catch {
		return null;
	}
}

function isExactObject(value: unknown, allowedKeys: readonly string[]): value is Record<string, unknown> {
	if (!isPlainObject(value)) return false;
	const allowed = new Set(allowedKeys);
	return Object.keys(value).every(key => (
		key !== '__proto__'
		&& key !== 'constructor'
		&& key !== 'prototype'
		&& allowed.has(key)
	));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const prototype = Reflect.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}
