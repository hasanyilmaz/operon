import {
	decodeMutationApplyRequestV1,
	decodeMutationPreviewRequestV1,
} from '../contracts/v1/decode';
import type {
	MutationApplyRequestV1,
	MutationPreviewRequestV1,
} from '../contracts/v1/mutation';

type MutationValidationV1<T> =
	| { ok: true; value: T }
	| { ok: false };

export function isRuntimeMutationPlanExpiredV1(value: unknown, nowEpochMs: number): boolean {
	if (!isPlainObject(value) || !isPlainObject(value.plan)) return false;
	const expiresAt = parseUtcTimestamp(value.plan.expiresAt);
	return expiresAt !== null && nowEpochMs >= expiresAt;
}

export function validateRuntimeMutationPreviewRequestV1(
	value: unknown,
): MutationValidationV1<MutationPreviewRequestV1> {
	const decoded = decodeMutationPreviewRequestV1(value);
	return decoded.ok
		? { ok: true, value: decoded.value }
		: { ok: false };
}

export function validateRuntimeMutationApplyRequestV1(
	value: unknown,
	nowEpochMs: number,
	options: Readonly<{ allowExpired?: boolean }> = {},
): MutationValidationV1<MutationApplyRequestV1> {
	const decoded = decodeMutationApplyRequestV1(value);
	if (!decoded.ok) return { ok: false };
	if (
		options.allowExpired !== true
		&& isRuntimeMutationPlanExpiredV1(decoded.value, nowEpochMs)
	) return { ok: false };
	return { ok: true, value: decoded.value };
}

function parseUtcTimestamp(value: unknown): number | null {
	if (typeof value !== 'string') return null;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const prototype = Reflect.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}
