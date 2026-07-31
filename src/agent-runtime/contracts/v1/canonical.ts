import { JsonValue } from './primitives';
import type { SealedMutationPlanV1 } from './mutation';

export class CanonicalJsonError extends Error {}

export function canonicalJsonV1(value: JsonValue): string {
	return serializeCanonical(normalizeJson(value));
}

export function canonicalPlanHashV1(planWithoutHash: JsonValue): string {
	return sha256HexV1(canonicalJsonV1(planWithoutHash));
}

export type SealedMutationPlanHashMaterialV1 = Omit<SealedMutationPlanV1, 'planHash'>;

export function sealedMutationPlanHashMaterialV1(
	plan: SealedMutationPlanV1,
): SealedMutationPlanHashMaterialV1 {
	const { planHash: _planHash, ...material } = plan;
	return material;
}

export function computeSealedMutationPlanHashV1(plan: SealedMutationPlanV1): string {
	return canonicalPlanHashV1(toJsonValueV1(sealedMutationPlanHashMaterialV1(plan)));
}

export function verifySealedMutationPlanHashV1(plan: SealedMutationPlanV1): boolean {
	return plan.planHash === computeSealedMutationPlanHashV1(plan);
}

export function computeReceiptTargetDigestV1(
	targets: SealedMutationPlanV1['targets'],
): string {
	return sha256HexV1(canonicalJsonV1(toJsonValueV1(targets)));
}

export function toJsonValueV1(value: unknown): JsonValue {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new CanonicalJsonError('JSON numbers must be finite.');
		return value;
	}
	if (Array.isArray(value)) return (value as unknown[]).map(toJsonValueV1);
	if (typeof value !== 'object') throw new CanonicalJsonError('Value is not JSON-safe.');
	const prototype: object | null = Reflect.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new CanonicalJsonError('Only plain JSON objects are supported.');
	}
	const output: Record<string, JsonValue> = {};
	for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
		if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
			throw new CanonicalJsonError('Prototype keys are forbidden.');
		}
		output[key] = toJsonValueV1(item);
	}
	return output;
}

export function sha256HexV1(value: string): string {
	const bytes = utf8Bytes(value);
	const words: number[] = [];
	for (let i = 0; i < bytes.length; i++) {
		words[i >> 2] = (words[i >> 2] ?? 0) | bytes[i] << (24 - (i % 4) * 8);
	}
	const bitLength = bytes.length * 8;
	words[bitLength >> 5] = (words[bitLength >> 5] ?? 0) | 0x80 << (24 - bitLength % 32);
	words[((bitLength + 64 >> 9) << 4) + 15] = bitLength;

	const hash = [
		0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
		0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
	];
	const constants = sha256Constants();
	const schedule = new Array<number>(64);
	for (let offset = 0; offset < words.length; offset += 16) {
		for (let i = 0; i < 64; i++) {
			if (i < 16) {
				schedule[i] = words[offset + i] ?? 0;
			} else {
				const a = schedule[i - 15];
				const b = schedule[i - 2];
				const sigma0 = rotateRight(a, 7) ^ rotateRight(a, 18) ^ a >>> 3;
				const sigma1 = rotateRight(b, 17) ^ rotateRight(b, 19) ^ b >>> 10;
				schedule[i] = (schedule[i - 16] + sigma0 + schedule[i - 7] + sigma1) | 0;
			}
		}
		let [a, b, c, d, e, f, g, h] = hash;
		for (let i = 0; i < 64; i++) {
			const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
			const choice = e & f ^ ~e & g;
			const temp1 = (h + sum1 + choice + constants[i] + schedule[i]) | 0;
			const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
			const majority = a & b ^ a & c ^ b & c;
			const temp2 = (sum0 + majority) | 0;
			h = g;
			g = f;
			f = e;
			e = (d + temp1) | 0;
			d = c;
			c = b;
			b = a;
			a = (temp1 + temp2) | 0;
		}
		hash[0] = (hash[0] + a) | 0;
		hash[1] = (hash[1] + b) | 0;
		hash[2] = (hash[2] + c) | 0;
		hash[3] = (hash[3] + d) | 0;
		hash[4] = (hash[4] + e) | 0;
		hash[5] = (hash[5] + f) | 0;
		hash[6] = (hash[6] + g) | 0;
		hash[7] = (hash[7] + h) | 0;
	}
	return hash.map(item => (item >>> 0).toString(16).padStart(8, '0')).join('');
}

function normalizeJson(value: JsonValue): JsonValue {
	if (typeof value === 'string') return value.normalize('NFC');
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new CanonicalJsonError('Canonical JSON forbids non-finite numbers.');
		return Object.is(value, -0) ? 0 : value;
	}
	if (value === null || typeof value === 'boolean') return value;
	if (Array.isArray(value)) return value.map(normalizeJson);
	const output: Record<string, JsonValue> = {};
	const normalizedKeys = new Set<string>();
	for (const originalKey of Object.keys(value).sort(compareCodeUnits)) {
		const key = originalKey.normalize('NFC');
		if (normalizedKeys.has(key)) throw new CanonicalJsonError('Object keys collide after NFC normalization.');
		normalizedKeys.add(key);
		output[key] = normalizeJson(value[originalKey]);
	}
	return output;
}

function serializeCanonical(value: JsonValue): string {
	if (value === null || typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
	if (typeof value === 'string') return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(serializeCanonical).join(',')}]`;
	const keys = Object.keys(value).sort(compareCodeUnits);
	return `{${keys.map(key => `${JSON.stringify(key)}:${serializeCanonical(value[key])}`).join(',')}}`;
}

function rotateRight(value: number, count: number): number {
	return value >>> count | value << 32 - count;
}

function compareCodeUnits(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function sha256Constants(): number[] {
	const constants: number[] = [];
	for (let candidate = 2; constants.length < 64; candidate++) {
		let prime = true;
		for (let divisor = 2; divisor * divisor <= candidate; divisor++) {
			if (candidate % divisor === 0) {
				prime = false;
				break;
			}
		}
		if (prime) constants.push(Math.floor((Math.cbrt(candidate) % 1) * 0x100000000) | 0);
	}
	return constants;
}

function utf8Bytes(value: string): number[] {
	const bytes: number[] = [];
	for (const character of value) {
		const code = character.codePointAt(0);
		if (code === undefined) continue;
		if (code <= 0x7f) {
			bytes.push(code);
		} else if (code <= 0x7ff) {
			bytes.push(0xc0 | code >> 6, 0x80 | code & 0x3f);
		} else if (code <= 0xffff) {
			bytes.push(0xe0 | code >> 12, 0x80 | code >> 6 & 0x3f, 0x80 | code & 0x3f);
		} else {
			bytes.push(
				0xf0 | code >> 18,
				0x80 | code >> 12 & 0x3f,
				0x80 | code >> 6 & 0x3f,
				0x80 | code & 0x3f,
			);
		}
	}
	return bytes;
}
