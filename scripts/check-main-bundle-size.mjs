import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const WARN_MAIN_BUNDLE_BYTES = 5_000_000;

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultBundlePath = path.join(rootDir, 'main.js');
const numberFormatter = new Intl.NumberFormat('en-US');

function formatByteCount(bytes) {
	return `${numberFormatter.format(bytes)} ${bytes === 1 ? 'byte' : 'bytes'}`;
}

export function evaluateBundleSize(
	actualBytes,
	warningBytes = WARN_MAIN_BUNDLE_BYTES,
) {
	if (!Number.isSafeInteger(actualBytes) || actualBytes < 0) {
		throw new TypeError('actualBytes must be a non-negative safe integer.');
	}
	if (!Number.isSafeInteger(warningBytes) || warningBytes < 0) {
		throw new TypeError('warningBytes must be a non-negative safe integer.');
	}

	if (actualBytes < warningBytes) {
		return {
			ok: true,
			status: 'pass',
			actualBytes,
			warningBytes,
			remainingBeforeWarningBytes: warningBytes - actualBytes,
		};
	}

	return {
		ok: true,
		status: 'warning',
		actualBytes,
		warningBytes,
		overWarningBytes: actualBytes - warningBytes,
	};
}

export function inspectBundleFile(bundlePath = defaultBundlePath, statSync = fs.statSync) {
	try {
		const stats = statSync(bundlePath);
		if (!stats.isFile()) {
			return { ok: false, reason: 'missing', bundlePath };
		}
		return { ...evaluateBundleSize(stats.size), bundlePath };
	} catch (error) {
		if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
			return { ok: false, reason: 'missing', bundlePath };
		}
		return {
			ok: false,
			reason: 'read-error',
			bundlePath,
			message: error instanceof Error ? error.message : String(error),
		};
	}
}

export function formatBundleSizeResult(result) {
	if (result.reason === 'missing') {
		return 'Operon main.js bundle size failed: main.js not found. Run npm run build first.';
	}
	if (result.reason === 'read-error') {
		return `Operon main.js bundle size failed: could not inspect main.js (${result.message}).`;
	}

	const actual = numberFormatter.format(result.actualBytes);
	const warning = numberFormatter.format(result.warningBytes);
	if (result.status === 'pass') {
		return `Operon main.js bundle size passed: ${actual} bytes (`
			+ `${formatByteCount(result.remainingBeforeWarningBytes)} before the ${warning}-byte warning threshold).`;
	}
	return `Operon main.js bundle size warning: ${actual} bytes exceeds the ${warning}-byte warning threshold by `
		+ `${formatByteCount(result.overWarningBytes)}; review is required.`;
}

export function runBundleSizeCheck(
	bundlePath = defaultBundlePath,
	logger = console,
	environment = process.env,
	inspect = inspectBundleFile,
) {
	const result = inspect(bundlePath);
	const output = formatBundleSizeResult(result);
	if (result.status === 'pass') {
		logger.log(output);
		return 0;
	}
	if (result.status === 'warning') {
		logger.warn(output);
		if (environment.GITHUB_ACTIONS === 'true') {
			logger.warn(`::warning title=Operon main.js bundle size::${output}`);
		}
		return 0;
	}

	logger.error(output);
	return 1;
}

const invokedUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedUrl) {
	process.exitCode = runBundleSizeCheck();
}
