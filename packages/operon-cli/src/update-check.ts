import {
	lstatSync,
	readFileSync,
} from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { join } from 'node:path';
import process from 'node:process';

import {
	compareOperonVersions,
	isValidOperonVersion,
} from '../../../src/systems/release-check';
import { OPERON_CLI_VERSION } from './client';
import {
	operonCliConfigRootV1,
	writeJsonAtomic,
} from './config';
import { assertSecureFileV1 } from './secure-storage';

export const OPERON_CLI_DIST_TAGS_URL =
	'https://registry.npmjs.org/-/package/operon-cli/dist-tags';

const UPDATE_CACHE_FILE_V1 = 'update-check-v1.json';
const SUCCESS_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const FAILURE_CACHE_TTL_MS = 60 * 60 * 1_000;
const REQUEST_TIMEOUT_MS = 1_000;
const RESPONSE_BYTE_LIMIT = 16_384;
const VERSION_LIMIT = 96;

export interface CliUpdateNoticeV1 {
	currentVersion: string;
	availableVersion: string;
	channel: 'latest' | 'beta';
	updateCommand: string;
	releaseUrl: string;
}

interface DistTagsV1 {
	latest?: string;
	beta?: string;
}

interface UpdateCheckCacheV1 {
	version: 1;
	checkedAt: string;
	status: 'success' | 'failure';
	distTags: DistTagsV1;
}

export interface CliUpdateCheckOptionsV1 {
	currentVersion?: string;
	configRoot?: string;
	env?: NodeJS.ProcessEnv;
	now?: Date;
	requestJson?: (url: string) => Promise<unknown>;
}

export async function checkForCliUpdateV1(
	options: CliUpdateCheckOptionsV1 = {},
): Promise<CliUpdateNoticeV1 | null> {
	const currentVersion = normalizeVersion(options.currentVersion ?? OPERON_CLI_VERSION);
	if (!currentVersion || updateCheckDisabled(options.env ?? process.env)) return null;
	const configRoot = options.configRoot ?? operonCliConfigRootV1();
	const now = options.now ?? new Date();
	const cache = readUpdateCache(configRoot);
	if (cache && cacheIsFresh(cache, now)) {
		return selectCliUpdateNoticeV1(currentVersion, cache.distTags);
	}

	try {
		const response = await (options.requestJson ?? requestRegistryDistTags)(
			OPERON_CLI_DIST_TAGS_URL,
		);
		const distTags = normalizeDistTags(response);
		if (!distTags.latest && !distTags.beta) {
			throw new Error('UPDATE_CHECK_DIST_TAGS_INVALID');
		}
		writeUpdateCache(configRoot, {
			version: 1,
			checkedAt: now.toISOString(),
			status: 'success',
			distTags,
		});
		return selectCliUpdateNoticeV1(currentVersion, distTags);
	} catch {
		writeUpdateCache(configRoot, {
			version: 1,
			checkedAt: now.toISOString(),
			status: 'failure',
			distTags: cache?.distTags ?? {},
		});
		return cache
			? selectCliUpdateNoticeV1(currentVersion, cache.distTags)
			: null;
	}
}

export function selectCliUpdateNoticeV1(
	currentVersion: string,
	value: unknown,
): CliUpdateNoticeV1 | null {
	const normalizedCurrent = normalizeVersion(currentVersion);
	if (!normalizedCurrent) return null;
	const distTags = normalizeDistTags(value);
	const latest = distTags.latest;
	if (latest && compareOperonVersions(latest, normalizedCurrent) > 0) {
		return createNotice(normalizedCurrent, latest, 'latest');
	}
	const beta = distTags.beta;
	if (
		isPrerelease(normalizedCurrent)
		&& beta
		&& compareOperonVersions(beta, normalizedCurrent) > 0
	) {
		return createNotice(normalizedCurrent, beta, 'beta');
	}
	return null;
}

async function requestRegistryDistTags(url: string): Promise<unknown> {
	return await new Promise<unknown>((resolve, reject) => {
		let settled = false;
		let deadline: ReturnType<typeof setTimeout> | null = null;
		const finish = (error: Error | null, value?: unknown) => {
			if (settled) return;
			settled = true;
			if (deadline) clearTimeout(deadline);
			if (error) reject(error);
			else resolve(value);
		};
		const request = httpsRequest(url, {
			method: 'GET',
			headers: {
				accept: 'application/json',
			},
		}, response => {
			const statusCode = response.statusCode ?? 0;
			const contentLength = Number(response.headers['content-length']);
			if (
				statusCode < 200
				|| statusCode >= 300
				|| (Number.isFinite(contentLength) && contentLength > RESPONSE_BYTE_LIMIT)
			) {
				response.resume();
				finish(new Error(statusCode < 200 || statusCode >= 300
					? 'UPDATE_CHECK_HTTP_FAILURE'
					: 'UPDATE_CHECK_RESPONSE_TOO_LARGE'));
				return;
			}
			const chunks: Buffer[] = [];
			let receivedBytes = 0;
			response.on('data', (chunk: Buffer | string) => {
				const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
				receivedBytes += bytes.length;
				if (receivedBytes > RESPONSE_BYTE_LIMIT) {
					response.destroy();
					finish(new Error('UPDATE_CHECK_RESPONSE_TOO_LARGE'));
					return;
				}
				chunks.push(bytes);
			});
			response.once('error', error => finish(error));
			response.once('end', () => {
				try {
					finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
				} catch {
					finish(new Error('UPDATE_CHECK_RESPONSE_INVALID'));
				}
			});
		});
		request.setTimeout(REQUEST_TIMEOUT_MS, () => {
			request.destroy(new Error('UPDATE_CHECK_TIMEOUT'));
		});
		deadline = setTimeout(() => {
			request.destroy(new Error('UPDATE_CHECK_TIMEOUT'));
		}, REQUEST_TIMEOUT_MS);
		deadline.unref();
		request.once('error', error => finish(error));
		request.end();
	});
}

function createNotice(
	currentVersion: string,
	availableVersion: string,
	channel: CliUpdateNoticeV1['channel'],
): CliUpdateNoticeV1 {
	return {
		currentVersion,
		availableVersion,
		channel,
		updateCommand: channel === 'latest'
			? 'npm install --global operon-cli'
			: 'npm install --global operon-cli@beta',
		releaseUrl: `https://www.npmjs.com/package/operon-cli/v/${availableVersion}`,
	};
}

function normalizeDistTags(value: unknown): DistTagsV1 {
	if (!isRecord(value)) return {};
	const latest = normalizeVersion(value.latest);
	const beta = normalizeVersion(value.beta);
	return {
		...(latest ? { latest } : {}),
		...(beta ? { beta } : {}),
	};
}

function normalizeVersion(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const version = value.trim();
	if (
		version.length === 0
		|| version.length > VERSION_LIMIT
		|| !isValidOperonVersion(version)
	) return null;
	return version;
}

function isPrerelease(version: string): boolean {
	return version.split('+', 1)[0]?.includes('-') === true;
}

function updateCheckDisabled(env: NodeJS.ProcessEnv): boolean {
	return env.OPERON_CLI_UPDATE_CHECK === '0'
		|| env.NO_UPDATE_NOTIFIER === '1';
}

function cacheIsFresh(cache: UpdateCheckCacheV1, now: Date): boolean {
	const checkedAt = Date.parse(cache.checkedAt);
	const age = now.getTime() - checkedAt;
	if (!Number.isFinite(checkedAt) || age < 0) return false;
	const ttl = cache.status === 'success'
		? SUCCESS_CACHE_TTL_MS
		: FAILURE_CACHE_TTL_MS;
	return age <= ttl;
}

function readUpdateCache(configRoot: string): UpdateCheckCacheV1 | null {
	const path = join(configRoot, UPDATE_CACHE_FILE_V1);
	try {
		assertSecureFileV1(path);
		const stat = lstatSync(path);
		if (!stat.isFile() || stat.isSymbolicLink()) return null;
		if (stat.size > RESPONSE_BYTE_LIMIT) return null;
		if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) return null;
		if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) return null;
		return decodeUpdateCache(JSON.parse(readFileSync(path, 'utf8')) as unknown);
	} catch {
		return null;
	}
}

function writeUpdateCache(configRoot: string, cache: UpdateCheckCacheV1): void {
	try {
		writeJsonAtomic(join(configRoot, UPDATE_CACHE_FILE_V1), cache);
	} catch {
		// Update checks must never change shell availability.
	}
}

function decodeUpdateCache(value: unknown): UpdateCheckCacheV1 | null {
	if (!isRecord(value)) return null;
	if (
		value.version !== 1
		|| typeof value.checkedAt !== 'string'
		|| (value.status !== 'success' && value.status !== 'failure')
	) return null;
	const distTags = normalizeDistTags(value.distTags);
	if (
		Object.keys(value).some(key => !['version', 'checkedAt', 'status', 'distTags'].includes(key))
	) return null;
	return {
		version: 1,
		checkedAt: value.checkedAt,
		status: value.status,
		distTags,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
